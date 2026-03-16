//worker.js, worker related
const SEARCH_DELAY = 400;
const INTERACTION_DELAY = 600;
let workerShadow = null;
let searchIndicator = null;
let debugHitboxVisible = false;

//Collision <simple>
const WORKER_HALF_X = 1.0;
const WORKER_HALF_Z = 1.0;
 
//Traversal Order
function getTraversalOrder(boxObjects){ return [...boxObjects].sort((a,b)=>a.id.localeCompare(b.id)); }
 
//Worker Class
class SimulationWorker
{
    constructor(id, scene, color = 0x3366ff)
    {
        this.id = id;
        this.busy = false;
        this.state = "Idle";
        this.lastIndex = 0;
        this.currentRack = null; // last rack number visited (null = not yet assigned)
        this._stuckTicks = 0;
        this.model = this._buildModel(scene, color);
        this.shadow = this._buildShadow(scene);
        this.indicator = this._buildIndicator(scene);
        this.position = null; //Positioning
        this.hitbox = this._buildHitbox(scene);
        this._escaping = false;
        this._escapeCooldown = 0;
        this._escapeAttempts = 0;
        this._moveDeadline = null;
        this._passableAt = null;
        this._isRepositioning = false;
        //this.pathCache = new Map(); // {targetKey: path}
    }
    //Visual builders
    _buildModel(scene, color)
    {
        const group = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({ color });
        const headMat = new THREE.MeshStandardMaterial({ color: 0xffcc99 });
        //LowerBodyCylinder
        const body = new THREE.Mesh( new THREE.CylinderGeometry(0.9, 0.75, 4, 24), bodyMat );
        body.position.y = 2;
        group.add(body);
        //Half-SphereShoulders
        const shoulder = new THREE.Mesh( new THREE.SphereGeometry(0.9, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat );
        shoulder.scale.y = 0.5;
        shoulder.position.y = 4;
        group.add(shoulder);
        //Sphere/Ball-Head
        const head = new THREE.Mesh( new THREE.SphereGeometry(0.6, 24, 24), headMat );
        head.position.y = 4.75;
        group.add(head);
        group.visible = false;
        scene.add(group);
        return group;
    }
    _buildShadow(scene)
    {
        const shadow = new THREE.Mesh(
            new THREE.CylinderGeometry(0.6, 0.6, 0.05, 20),
            new THREE.MeshBasicMaterial({ color: 0x000000 })
        );
        shadow.visible = false;
        scene.add(shadow);
        return shadow;
    }
    _buildHitbox(scene)
    {
        //XZ footprint matching the cylinder radius (1 unit), flat in Y
        const geo = new THREE.BoxGeometry(2, 0.05, 2); //X=2, Z=2, Y=thin
        const edges = new THREE.EdgesGeometry(geo);
        const hitbox = new THREE.LineSegments( edges, new THREE.LineBasicMaterial({ color: 0x00ffff }) );
        //Above chosen cyan color, so it's easily visible
        hitbox.visible = false;
        scene.add(hitbox);
        return hitbox;
    }
    _buildIndicator(scene) //Search Indicator
    {
        const indicator = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        indicator.visible = false;
        scene.add(indicator);
        return indicator;
    }
    //Position helpers
    //Places model and shadow at a world-space position in front of a shelf
    _showAt(worldX, worldZ)
    {
        this.model.position.set(worldX, 0, worldZ);
        this.shadow.position.set(worldX, 0, worldZ);
        this.model.visible  = true;
        this.shadow.visible = true;
        this.position = { x: worldX, y: 0, z: worldZ };
        this.hitbox.position.set(worldX, 0, worldZ);
        this.hitbox.visible = debugHitboxVisible; //For Debug Purp, seek top to toggle
    }
    _hide()
    {
        this.model.visible = false;
        this.shadow.visible = false;
        this.indicator.visible = false;
        this.hitbox.visible = false; //Hide when worker despawns
    }
    //How many racks away is this worker from a target rack? Workers that have never moved default to rack 2 (placeholder)
    distanceTo(rackNumber)
    {
        const from = this.currentRack ?? 2;
        return Math.abs(from - rackNumber);
    }
    //RackMovement Functions
    async moveToRack(rackNumber)
    {
        const interactPos = workerPool.getInteractionPosition(rackNumber);
        if (!interactPos)
        {
            console.warn(`[WORKER ${this.id}] Could not get interaction position for rack ${rackNumber}`);
            return;
        }
        console.log(`[WORKER ${this.id}] Moving from Rack ${this.currentRack ?? "base"} → Rack ${rackNumber}`);
        this.state = `Moving to Rack ${rackNumber}`;
        this.lastIndex = 0;
        await moveAroundStaging(this, interactPos.x, interactPos.z);
        this.currentRack = rackNumber;
    }
    async searchAndInteract(targetIDs, boxObjects)
    {
        const startTime = performance.now();
        console.log(`[WORKER ${this.id}] Search start | Targets: ${targetIDs.join(", ")}`);
        this.state = "Searching";
        this._passableAt = performance.now() + 5000; // passable after 5s, covers long multi-box searches
        //Get the interaction area's Z for the current rack to stay aligned
        const rack = racks.find(r => r.boxObjects[0]?.rack === this.currentRack && r.boxObjects[0]?.type === 'medicine');
        const interactionZ = rack ? (() =>
        {
            const worldPos = new THREE.Vector3();
            rack.interactionArea.getWorldPosition(worldPos);
            return worldPos.z;
        })() : 0; //Fallback to 0 if rack not found
        const interactionX = rack ? (() =>
        {
            const worldPos = new THREE.Vector3();
            rack.interactionArea.getWorldPosition(worldPos);
            return worldPos.x;
        })() : 0; //Fallback to 0 if rack not found
        //getTraversalOrder is defined in rack.js — still shared utility
        const traversal = getTraversalOrder(boxObjects);
        let currentIndex = this.lastIndex;
        for (const targetID of targetIDs)
        {
            /*
            dataCollector.logEvent(
                "SEARCH",
                this.id,
                targetID,
                this.currentRack
            );
            */ //Changed format, currently unused anymore
            let found = false;
            let scannedCount = 0;
            while (!found && scannedCount < traversal.length)
            {
                const box = traversal[currentIndex];
                this.state = `Searching ${box.id}`;
                //Get world-space position of the box mesh (works for all racks)
                const worldPos = new THREE.Vector3();
                box.mesh.getWorldPosition(worldPos);
                this.indicator.visible = true;
                this.indicator.position.set(worldPos.x, worldPos.y + 0.3, worldPos.z);
                setBoxTempColor(box, 0xffffff); //white = scanning
                await delay(SEARCH_DELAY);
                if (box.id === targetID)
                {
                    this.state = `Interacting ${box.id}`;
                    setBoxTempColor(box, 0xff8800); //orange = interacting
                    await delay(INTERACTION_DELAY);
                    restoreBoxColor(box);
                    found = true;

                    /*
                    dataCollector.logEvent(
                        "PICKUP",
                        this.id,
                        box.id,
                        this.currentRack
                    );  
                    */ //Changed format, currently unused anymore
                }
                else { restoreBoxColor(box); }
                currentIndex = (currentIndex + 1) % traversal.length;
                scannedCount++;
            }
            if (!found) { console.warn(`[WORKER ${this.id}] Target ${targetID} not found in traversal`); }
        }
        const duration = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`[WORKER ${this.id}] Search done | ${duration}s`);
        this.indicator.visible = false;
        //this._hide(); //After movement no longer needed
        this.lastIndex = currentIndex; //to not reset search after finding a box
        this._passableAt = performance.now() + 1500; //brief exit window after search ends
        this.state = "Done Searching"; //caller set next state
    }
    _isInAnyInteractionArea()
    {
        for (const rack of racks)
        {
            const worldPos = new THREE.Vector3();
            rack.interactionArea.getWorldPosition(worldPos);
            //Interaction area is BoxGeometry(2,0.05,2) → halfX=1, halfZ=1
            if (Math.abs(this.position.x - worldPos.x) < 1 && Math.abs(this.position.z - worldPos.z) < 1) return true;
        }
        return false;
    }
    async moveToWorldPosition(targetX, targetZ)
    {
        if (!this.position)
        {
            console.warn(`[WORKER ${this.id}] moveToWorldPosition called before position set`);
            return;
        }
        const MOVE_SPEED = 0.15;
        const TOLERANCE  = 0.3;
        this.state = "Moving";
        while (true)
        {
            const dx = targetX - this.position.x;
            const dz = targetZ - this.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < TOLERANCE) break;
            // Timeout check — force snap and exit if deadline exceeded
            if (this._moveDeadline && performance.now() > this._moveDeadline)
            {
                console.warn(`[WORKER ${this.id}] Move timeout, snapping to (${targetX},${targetZ})`);
                this._showAt(targetX, targetZ);
                break;
            }
            const step = Math.min(MOVE_SPEED, dist);
            const nx = (dx / dist) * step;
            const nz = (dz / dist) * step;
            const blockedFull = isColliding(this.position.x + nx, this.position.z + nz)
                            || isCollidingWithWorkers(this.position.x + nx, this.position.z + nz, this.id);
            const blockedX    = isColliding(this.position.x + nx, this.position.z)
                            || isCollidingWithWorkers(this.position.x + nx, this.position.z, this.id);
            const blockedZ    = isColliding(this.position.x, this.position.z + nz)
                            || isCollidingWithWorkers(this.position.x, this.position.z + nz, this.id);

            if (!blockedFull)
            {
                const prevDist = dist;
                this.model.position.x += nx; this.model.position.z += nz;
                this.shadow.position.x += nx; this.shadow.position.z += nz;
                this.hitbox.position.x += nx; this.hitbox.position.z += nz;
                this.position.x += nx; this.position.z += nz;
                const newDist = Math.sqrt(
                    (targetX - this.position.x) ** 2 +
                    (targetZ - this.position.z) ** 2
                );
                //Only reset if progressing AND no worker is still touching us at new position
                //Prevents tango from resetting the counter on momentary diagonal clearance
                const stillTouching = workerPool.workers.some(other =>
                    other.id !== this.id && other.position && other.model.visible &&
                    !other._escaping &&
                    (other._passableAt === null || performance.now() <= other._passableAt) &&
                    Math.abs(this.position.x - other.position.x) <= WORKER_HALF_X * 2 + 2 &&
                    Math.abs(this.position.z - other.position.z) <= WORKER_HALF_Z * 2 + 2
                );
                if (newDist < prevDist - 0.01 && !stillTouching)
                    this._stuckTicks = 0;
                else
                    this._stuckTicks++;
            }
            else if (!blockedX)
            {
                this.model.position.x += nx; this.shadow.position.x += nx;
                this.hitbox.position.x += nx; this.position.x += nx;
                this._stuckTicks++;
            }
            else if (!blockedZ)
            {
                this.model.position.z += nz; this.shadow.position.z += nz;
                this.hitbox.position.z += nz; this.position.z += nz;
                this._stuckTicks++;
            }
            else { this._stuckTicks++; }
            if (dist < MOVE_SPEED * 3 && this._stuckTicks >= 10)
            {
                this._showAt(targetX, targetZ);
                break;
            }
            //Last resort — snap after prolonged stuck regardless of zone or nearby workers
            if (this._stuckTicks >= 150)
            {
                console.warn(`[WORKER ${this.id}] Force snap after prolonged stuck at (${this.position.x.toFixed(1)},${this.position.z.toFixed(1)})`);
                this._showAt(targetX, targetZ);
                break;
            }
            //Diagonal escape — fires regardless of which branch ran above, triggers after 20 ticks of any non-full movement
            if (this._escapeCooldown > 0) this._escapeCooldown--;
            if (this._stuckTicks >= 20 && this._escapeCooldown <= 0 && !this._escaping)
            {
                //Only attempt escape if there's actually a worker nearby
                const workerNearby = workerPool.workers.some(other =>
                    other.id !== this.id &&
                    other.position &&
                    other.model.visible &&
                    Math.abs(this.position.x - other.position.x) <= WORKER_HALF_X * 2 + 2 &&
                    Math.abs(this.position.z - other.position.z) <= WORKER_HALF_Z * 2 + 2
                );
                const inRestrictedZone =
                    (this.position.x > 12.5 && Math.abs(this.position.z - (-2)) < 5) || //doorway entrance corridor (z: -7 to +3)
                    (this.position.x > 19 && this.position.z < -4); //storage interior
                    //(Math.abs(this.position.x) < 8 && Math.abs(this.position.z) < 6) || //staging zone
                    //(this.position.z < -10 && this.position.x < 6) || //rack corridor
                    //(this.position.x > 15 && this.position.x < 21 && this.position.z > 9) || //counter zone
                    //(this.position.x < -26 && this.position.z > 9); //desk zone
                if (workerNearby && !inRestrictedZone)
                {
                    const blocker = workerPool.workers.find(other =>
                        other.id !== this.id &&
                        other.position &&
                        other.model.visible &&
                        Math.abs(this.position.x - other.position.x) < WORKER_HALF_X * 2 + 0.5 &&
                        Math.abs(this.position.z - other.position.z) < WORKER_HALF_Z * 2 + 0.5
                    );
                    //ID determines priority so two workers always pick from opposite ends of the list, guaranteeing divergence
                    const allCandidates =
                    [
                        { x: this.position.x + 3, z: this.position.z + 3 },
                        { x: this.position.x - 3, z: this.position.z - 3 },
                        { x: this.position.x - 3, z: this.position.z + 3 },
                        { x: this.position.x + 3, z: this.position.z - 3 },
                    ];
                    //Higher ID picks from front of list, lower ID picks from back, said to guarantee divergance
                    const ordered = blocker && this.id > blocker.id ? allCandidates : [...allCandidates].reverse();
                    //_escapeAttempts rotates through ordered list on repeated failures
                    const startIndex = (this._escapeAttempts || 0) % ordered.length;
                    const rotated = [...ordered.slice(startIndex), ...ordered.slice(0, startIndex)];
                    const valid = rotated.filter(c =>
                        !isColliding(c.x, c.z) && !isCollidingWithWorkers(c.x, c.z, this.id)
                    );
                    if (valid.length > 0)
                    {
                        const pick = valid[0]; // takefirst valid from ordered list, not random
                        this._stuckTicks = 0;
                        console.log(`[WORKER ${this.id}] Diagonal escape to (${pick.x},${pick.z})`);
                        this._escaping = true;
                        await this.moveToWorldPosition(pick.x, pick.z);
                        this._escaping = false;
                        this._escapeCooldown = 60; // ~960ms at 16ms/tick, prevents immediate re-trigger
                        this.state = "Moving";
                    }
                    else
                    {
                        //All blocked — rotate start index next attempt
                        this._escapeAttempts = (this._escapeAttempts || 0) + 1;
                    }
                }
                else if (!workerNearby && this._stuckTicks >= 50 && this._escapeCooldown <= 0)
                {
                    const wallEscapeCandidates =
                    [
                        { x: this.position.x - 2, z: this.position.z     },
                        { x: this.position.x + 2, z: this.position.z     },
                        { x: this.position.x,     z: this.position.z + 2 },
                        { x: this.position.x,     z: this.position.z - 2 },
                        { x: this.position.x - 2, z: this.position.z + 2 },
                        { x: this.position.x + 2, z: this.position.z + 2 },
                        { x: this.position.x - 2, z: this.position.z - 2 },
                        { x: this.position.x + 2, z: this.position.z - 2 },
                    ];
                    //I'll let the clutter above for now because dear Lord I'm not hitting my head again for the hundreth time again 
                    const valid = wallEscapeCandidates.filter(c =>
                        !isColliding(c.x, c.z) && !isCollidingWithWorkers(c.x, c.z, this.id)
                    );
                    if (valid.length > 0)
                    {
                        this._stuckTicks = 0;
                        this._escaping = true;
                        await this.moveToWorldPosition(valid[0].x, valid[0].z);
                        this._escaping = false;
                        this._escapeCooldown = 60;
                        this.state = "Moving";
                    }
                }
            }
            await delay(16); //Tickrate?
        }
        this._escapeAttempts = 0; // arrived at destination, fresh start next movement
        this._showAt(targetX, targetZ);
        this.state = "Idle";
        console.log(`[WORKER ${this.id}] Arrived at (${targetX.toFixed(1)},${targetZ.toFixed(1)})`);
    }
    async followWaypoints(waypoints)
    {
        for (const waypoint of waypoints)
        {
            await this.moveToWorldPosition(waypoint.x, waypoint.z);
            if (waypoint.pauseMs) await delay(waypoint.pauseMs);
        }
    }
}
 
//WorkerPool
class WorkerPool
{
    constructor(scene, count = 2) //2 temp placeholder
    {
        const COLORS = [0x3366ff, 0xff6633, 0x33cc66, 0xcc33ff];
        this.workers = Array.from({ length: count }, (_, i) => new SimulationWorker(i + 1, scene, COLORS[i % COLORS.length]) );
        this.occupiedRacks = new Set(); //rack numbers currently being worked on
        this.occupiedAreas = new Set(); //same with above but more variable
    }
    // Returns the nearest free worker to a given rack, or null if none available
    getNearestWorker(rackNumber)
    {
        const free = this.workers.filter(w => !w.busy);
        if (free.length === 0) return null;
        free.sort((a, b) => a.distanceTo(rackNumber) - b.distanceTo(rackNumber));
        return free[0];
    }
    hasFreeWorker() { return this.workers.some(w => !w.busy); }
    lockRack(rackNumber) { this.occupiedRacks.add(rackNumber); }
    unlockRack(rackNumber) { this.occupiedRacks.delete(rackNumber); }
    isRackFree(rackNumber) { return !this.occupiedRacks.has(rackNumber); }
    //Returns a readable status for all workers, later on for debug I guess
    getStatusHTML()
    {
        return this.workers
            .map(w => `<strong>Worker ${w.id}:</strong> ${w.state}`)
            .join("<br>");
    }
    setInitialPositions(positions)
    {
        this.workers.forEach((worker, i) => {
            const pos = positions[i % positions.length];
            worker._showAt(pos.x, pos.z);
        });
    }
    toggleHitboxes()
    {
        debugHitboxVisible = !debugHitboxVisible;
        this.workers.forEach(w => { if (w.model.visible) w.hitbox.visible = debugHitboxVisible; });
        //Above is for only showing if worker is visible
    }
    getInteractionPosition(rackNumber)
    {
        const rack = racks.find(r => r.boxObjects[0]?.rack === rackNumber);  // Find rack by number
        if (!rack) return null;
        const worldPos = new THREE.Vector3();
        rack.interactionArea.getWorldPosition(worldPos);  // Get world position of interaction area
        return worldPos;
    }
    //Idle Positioning: spread workers so they don't block each other, still doesn't work LMAO
    getIdlePosition(worker)
    {
        //Use IDLE_SLOTS defined in functions.js, accessible globally, worker ID determines which slot, spreading workers out
        return IDLE_SLOTS[(worker.id - 1) % IDLE_SLOTS.length];
    }
    async repositionAllIdle()
    {
        if (this._isRepositioning) return;
        this._isRepositioning = true;
        try
        {
            for (let i = 0; i < this.workers.length; i++)
            {
                const worker = this.workers[i];
                if (worker.busy) continue;
                //Extended doorway zone: x between 14.5-2 and 17+2, z near -2
                //Any idle worker parked here gets pushed to x:11 on the main floor
                const inDoorway = worker.position.x > 12.5 && worker.position.x < 19 && Math.abs(worker.position.z - (-2)) < 2;
                if (inDoorway)
                {
                    console.log(`[WORKER ${worker.id}] Clearing doorway`);
                    worker.state = "Clearing doorway";
                    await worker.moveToWorldPosition(11, -2);
                    worker.state = "Idle";
                    continue; // skip the interaction area check below for this worker
                }
                if (!worker._isInAnyInteractionArea()) continue;
                const idlePos = this.getIdlePosition(worker); //pass worker, not index
                await moveAroundStaging(worker, idlePos.x, idlePos.z);
                worker.state = "Idle";
            }
        }
        finally { this._isRepositioning = false; }
    }
    //Area occupancy, same pattern as rack locks
    lockArea(key) { this.occupiedAreas.add(key); }
    unlockArea(key) { this.occupiedAreas.delete(key); }
    isAreaFree(key) { return !this.occupiedAreas.has(key); }
    //Nearest free staging InteractionArea, null if all occupied
    getNearestFreeStagingIA(worker)
    {
        let best = null, bestDist = Infinity;
        staging.interactionAreas.forEach((ia, i) =>
        {
            const key = `staging_${i}`;
            if (!this.isAreaFree(key)) return;
            const iaPos = new THREE.Vector3();
            ia.getWorldPosition(iaPos);
            const d = Math.hypot(worker.position.x - iaPos.x, worker.position.z - iaPos.z);
            if (d < bestDist) { bestDist = d; best = { key, pos: iaPos }; }
        });
        return best;
    }
    //ResetAll
    resetAll(positions)
    {
        this.occupiedRacks.clear();
        this.occupiedAreas.clear();
        this.workers.forEach((worker, i) =>
        {
            worker.busy = false;
            worker.state = "Idle";
            worker.lastIndex = 0;
            worker.currentRack = null;
            worker._stuckTicks = 0;
            worker._escapeCooldown = 0;
            worker._escapeAttempts = 0;
            worker._moveDeadline = null;
            worker._escaping = false;
            worker.indicator.visible = false;
            worker._passableAt = null;
            const pos = positions[i % positions.length];
            worker._showAt(pos.x, pos.z);
        });
    }
}
 
//Initializer (for call in framework.html after scene)
let workerPool = null;
function initWorkerPool(scene, count)
{
    workerPool = new WorkerPool(scene, count);
    console.log(`[POOL] Initialized with ${count} worker(s)`);
    return workerPool;
}