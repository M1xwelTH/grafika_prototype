//worker.js, worker related
const SEARCH_DELAY = 400;
const INTERACTION_DELAY = 600;
let workerShadow = null;
let searchIndicator = null;
let debugHitboxVisible = false;

//Collision <simple>
const WORKER_HALF_X = 1.0;
const WORKER_HALF_Z = 1.0;
function isColliding(x, z)
{
    if (!window.obstacles) return false;
    for (const obs of window.obstacles)
    {
        if (Math.abs(x - obs.cx) < WORKER_HALF_X + obs.halfX &&
            Math.abs(z - obs.cz) < WORKER_HALF_Z + obs.halfZ)
            return true;
    }
    return false;
}
function isCollidingWithWorkers(x, z, selfId)
{
    const WORKER_HALF_X = 1.0;
    const WORKER_HALF_Z = 1.0;
    for (const other of workerPool.workers)
    {
        if (other.id === selfId) continue; //skip self
        if (!other.position) continue; //skip uninitialized
        if (!other.model.visible) continue; //skip hidden workers
        if (Math.abs(x - other.position.x) < WORKER_HALF_X * 2 && Math.abs(z - other.position.z) < WORKER_HALF_Z * 2)
        { return true; }
    }
    return false;
}

//Storage Area handling
function isWorkerFullyInsideArea(workerPos, areaWorldPos, areaHalfX, areaHalfZ)
{
    return Math.abs(workerPos.x - areaWorldPos.x) < areaHalfX - WORKER_HALF_X &&
           Math.abs(workerPos.z - areaWorldPos.z) < areaHalfZ - WORKER_HALF_Z;
}
 
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
        this.model = this._buildModel(scene, color);
        this.shadow = this._buildShadow(scene);
        this.indicator = this._buildIndicator(scene);
        this.position = null; //Positioning
        this.hitbox = this._buildHitbox(scene);
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
        await this.moveToWorldPosition(interactPos.x, interactPos.z);
        this.currentRack = rackNumber;
    }
    async searchAndInteract(targetIDs, boxObjects)
    {
        const startTime = performance.now();
        console.log(`[WORKER ${this.id}] Search start | Targets: ${targetIDs.join(", ")}`);
        this.state = "Searching";
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
            dataCollector.logEvent(
                "SEARCH",
                this.id,
                targetID,
                this.currentRack
            );

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
                    this._showAt(worldPos.x, interactionZ); //X follows box
                    await delay(INTERACTION_DELAY);
                    restoreBoxColor(box);
                    this._showAt(interactionX, interactionZ); //returns X base
                    found = true;

                    dataCollector.logEvent(
                        "PICKUP",
                        this.id,
                        box.id,
                        this.currentRack
                    );  
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
        this.state = "Idle";
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
                this.model.position.x += nx; this.model.position.z += nz;
                this.shadow.position.x += nx; this.shadow.position.z += nz;
                this.hitbox.position.x += nx; this.hitbox.position.z += nz;
                this.position.x += nx; this.position.z += nz;
            }
            else if (!blockedX)
            {
                this.model.position.x += nx; this.shadow.position.x += nx;
                this.hitbox.position.x += nx; this.position.x += nx;
            }
            else if (!blockedZ)
            {
                this.model.position.z += nz; this.shadow.position.z += nz;
                this.hitbox.position.z += nz; this.position.z += nz;
            }
            //else: fully blocked this tick, wait for other worker to move
            await delay(16);
        }
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
        //If worker has visited a rack, idle just behind that rack's interaction area
        if (worker.currentRack !== null)
        {
            const rack = racks.find(r => r.boxObjects[0]?.rack === worker.currentRack && r.boxObjects[0]?.type === 'medicine');
            if (rack)
            {
                const worldPos = new THREE.Vector3();
                rack.interactionArea.getWorldPosition(worldPos);
                //Step back 2 units away from the rack (positive Z = toward open floor)
                return { x: worldPos.x, z: worldPos.z + 2 };
            }
        }
        //Fallback: stay at current position if no rack visited yet
        return { x: worker.position.x, z: worker.position.z };
    }
    async repositionAllIdle()
    {
        for (let i = 0; i < this.workers.length; i++)
        {
            const worker = this.workers[i];
            if (worker.busy) continue;
            if (!worker._isInAnyInteractionArea()) continue;
            const idlePos = this.getIdlePosition(worker); //pass worker, not index
            await worker.moveToWorldPosition(idlePos.x, idlePos.z);
        }
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
}
 
//Initializer (for call in framework.html after scene)
let workerPool = null;
function initWorkerPool(scene, count)
{
    workerPool = new WorkerPool(scene, count);
    console.log(`[POOL] Initialized with ${count} worker(s)`);
    return workerPool;
}