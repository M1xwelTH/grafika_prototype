//worker.js, worker related
const SEARCH_DELAY = 4000/60; //4 secs irl looking
const INTERACTION_DELAY = 5000/60; //5 secs irl taking meds
let workerShadow = null;
let searchIndicator = null;
let debugHitboxVisible = false;

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
        this.lastSearchRack = null;
        this.currentRack = null;
        this.model = this._buildModel(scene, color);
        this.shadow = this._buildShadow(scene);
        this.indicator = this._buildIndicator(scene);
        this.position = null;
        this.hitbox = this._buildHitbox(scene);
        this._idleReturnPos = null; //For dynamic idle return targeting
        //--- Intent system ---
        //'idle' : standing still, not assigned, evictable by moving workers
        //'moving' : following a tile path (set by moveTo)
        //'exiting_storage' : returning through doorway, has priority over entering workers
        this.intent = 'idle';
        //--- Remaining state used by movement.js ---
        this._remainingWaypoints = 0;   //tracked by moveToNextTile for yield decisions
        this.tileIdx = null; //logical tile — only updated by tile system, never derived from position
        this._reservedTileIdx = null; //tile currently reserved for movement, to prevent double reservation
        this._reservedTileCenter = null; //world coords of tile center if currently reserved for movement
        this._evictedAt = null; //timestamp of last eviction, to prevent immediate re-eviction
        this._movementSession = null;
        this._isleavingIA = false; // Whether the worker is currently in the process of leaving an interaction area, prioritized
    }

    //Visual builders
    _buildModel(scene, color)
    {
        const group = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({ color });
        const headMat = new THREE.MeshStandardMaterial({ color: 0xffcc99 });
        const body = new THREE.Mesh( new THREE.CylinderGeometry(0.9, 0.75, 4, 24), bodyMat );
        body.position.y = 2;
        group.add(body);
        const shoulder = new THREE.Mesh( new THREE.SphereGeometry(0.9, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat );
        shoulder.scale.y = 0.5;
        shoulder.position.y = 4;
        group.add(shoulder);
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
        const geo = new THREE.BoxGeometry(2, 0.05, 2);
        const edges = new THREE.EdgesGeometry(geo);
        const hitbox = new THREE.LineSegments( edges, new THREE.LineBasicMaterial({ color: 0x00ffff }) );
        hitbox.visible = false;
        scene.add(hitbox);
        return hitbox;
    }
    _buildIndicator(scene)
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
    _showAt(worldX, worldZ)
    {
        this.model.position.set(worldX, 0, worldZ);
        this.shadow.position.set(worldX, 0, worldZ);
        this.model.visible  = true;
        this.shadow.visible = true;
        this.position = { x: worldX, y: 0, z: worldZ };
        this.hitbox.position.set(worldX, 0, worldZ);
        this.hitbox.visible = debugHitboxVisible;
    }
    _hide()
    {
        this.model.visible = false;
        this.shadow.visible = false;
        this.indicator.visible = false;
        this.hitbox.visible = false;
    }

    //How many racks away is this worker from a target rack?
    distanceTo(rackNumber)
    {
        const from = this.currentRack ?? 2;
        return Math.abs(from - rackNumber);
    }

    //True if worker is inside any rack interaction area (used by repositionAllIdle)
    _isInAnyInteractionArea()
    {
        for (const rack of racks)
        {
            const worldPos = new THREE.Vector3();
            rack.interactionArea.getWorldPosition(worldPos);
            if (Math.abs(this.position.x - worldPos.x) < 1 &&
                Math.abs(this.position.z - worldPos.z) < 1) return true;
        }
        return false;
    }

    //Primitive mover — straight line to target, slides along static obstacles only.
    //All routing, waiting, and worker-to-worker avoidance handled by movement.js.
    async moveToWorldPosition(targetX, targetZ)
    {
        if (!this.position)
        {
            console.warn(`[WORKER ${this.id}] moveToWorldPosition called before position set`);
            return;
        }
        const MOVE_SPEED = 0.15; //Move speed is 0.15 units per tick (16ms)
        const TOLERANCE = 0.3; //How close is "close enough" to the target position to stop moving?
        this.state = "Moving";
        let stuckTicks = 0;
        while (true)
        {
            const dx = targetX - this.position.x;
            const dz = targetZ - this.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < TOLERANCE) break;
            const step = Math.min(MOVE_SPEED, dist);
            const nx = (dx / dist) * step;
            const nz = (dz / dist) * step;
            const blockedFull = isColliding(this.position.x + nx, this.position.z + nz);
            const blockedX = isColliding(this.position.x + nx, this.position.z);
            const blockedZ = isColliding(this.position.x, this.position.z + nz);
            if (!blockedFull)
            {
                this.model.position.x += nx; this.model.position.z += nz;
                this.shadow.position.x += nx; this.shadow.position.z += nz;
                this.hitbox.position.x += nx; this.hitbox.position.z += nz;
                this.position.x += nx; this.position.z += nz;
                stuckTicks = 0;
            }
            else if (!blockedX)
            {
                this.model.position.x += nx; this.shadow.position.x += nx;
                this.hitbox.position.x += nx; this.position.x += nx;
                stuckTicks++;
            }
            else if (!blockedZ)
            {
                this.model.position.z += nz; this.shadow.position.z += nz;
                this.hitbox.position.z += nz; this.position.z += nz;
                stuckTicks++;
            }
            else { stuckTicks++; }
            if (dist < MOVE_SPEED * 3 && stuckTicks >= 10) { this._showAt(targetX, targetZ); break; }
            if (stuckTicks >= 150)
            {
                console.warn(`[WORKER ${this.id}] Hard snap at (${this.position.x.toFixed(1)},${this.position.z.toFixed(1)})`);
                this._showAt(targetX, targetZ);
                break;
            }
            await delay(16);
        }
    }

    //Rack search and item interaction — no movement decisions here
    async searchAndInteract(targetIDs, boxObjects)
    {
        // Reset search position if worker has moved to a different rack
        if (this.currentRack !== this.lastSearchRack)
        {
            this.lastIndex = 0;
            this.lastSearchRack = this.currentRack;
        }
        const startTime = performance.now();
        console.log(`[WORKER ${this.id}] Search start | Targets: ${targetIDs.join(", ")}`);
        this.state = "Searching";
        this.intent = 'searching'; //Not evictable
        const traversal = getTraversalOrder(boxObjects);
        let currentIndex = this.lastIndex;
        for (const targetID of targetIDs)
        {
            let found = false, scannedCount = 0;
            while (!found && scannedCount < traversal.length)
            {
                const box = traversal[currentIndex];
                this.state = `Searching ${box.id}`;
                const worldPos = new THREE.Vector3();
                box.mesh.getWorldPosition(worldPos);
                this.indicator.visible = true;
                this.indicator.position.set(worldPos.x, worldPos.y + 0.3, worldPos.z);
                setBoxTempColor(box, 0xffffff);
                await delay(SEARCH_DELAY);
                if (box.id === targetID)
                {
                    this.state = `Interacting ${box.id}`;
                    setBoxTempColor(box, 0xff8800);
                    await delay(INTERACTION_DELAY);
                    restoreBoxColor(box);
                    found = true;
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
        this.lastIndex = currentIndex;
        this.state = "Done Searching";
        this.intent = 'idle';
    }
}

// ============================================================
// WorkerPool
// ============================================================
class WorkerPool
{
    constructor(scene, count = 2)
    {
        const COLORS = [
            0x3366ff, // Worker 1 — blue
            0xff6633, // Worker 2 — orange
            0x33cc66, // Worker 3 — green
            0xcc33ff, // Worker 4 — purple
            0xff3333, // Worker 5 — red
            0xffcc00, // Worker 6 — yellow
            0x00cccc, // Worker 7 — teal
            0xff66aa, // Worker 8 — pink
        ];
        this.workers = Array.from({ length: count }, (_, i) => new SimulationWorker(i + 1, scene, COLORS[i % COLORS.length]));
        this.occupiedRacks = new Set();
        this.occupiedAreas = new Set();
        this._isRepositioning = false;
    }
    getNearestWorker(worldX, worldZ)
    {
        const free = this.workers.filter(w => !w.busy);
        if (free.length === 0) return null;
        free.sort((a, b) => {
            const da = Math.hypot(a.position.x - worldX, a.position.z - worldZ);
            const db = Math.hypot(b.position.x - worldX, b.position.z - worldZ);
            return da - db;
        });
        return free[0];
    }
    hasFreeWorker() { return this.workers.some(w => !w.busy); }
    lockRack(rackNumber) { this.occupiedRacks.add(rackNumber); }
    unlockRack(rackNumber) { this.occupiedRacks.delete(rackNumber); }
    isRackFree(rackNumber) { return !this.occupiedRacks.has(rackNumber); }
    unlockArea(key) { this.occupiedAreas.delete(key); }
    isAreaFree(key) { return !this.occupiedAreas.has(key); }
    tryLockArea(key)
    {
        if (this.occupiedAreas.has(key)) return false;
        this.occupiedAreas.add(key); // claim atomically — no await between check and add
        return true;
    }
    getStatusHTML()
    {
        return this.workers
            .map(w => `<strong>Worker ${w.id}:</strong> ${w.state} [${w.intent}]`)
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
    }
    getInteractionPosition(rackNumber)
    {
        const rack = racks.find(r => r.boxObjects[0]?.rack === rackNumber);
        if (!rack) return null;
        const worldPos = new THREE.Vector3();
        rack.interactionArea.getWorldPosition(worldPos);
        return worldPos;
    }
    getIdlePosition(worker) { return IDLE_SLOTS[(worker.id - 1) % IDLE_SLOTS.length]; }
    //Connected to the same name of function in movement file
    async repositionAllIdle()
    {
        if (this._isRepositioning) return;
        this._isRepositioning = true;
        try { await repositionIdleWorkers(this.workers); }
        finally { this._isRepositioning = false; }
    }
    //Nearest free (unlocked) staging IA.
    //Returns { key, pos, index } where index is the IA array index for 'staging_N' key.
    getNearestFreeStagingIA(worker)
    {
        let best = null, bestDist = Infinity;
        staging.interactionAreas.forEach((ia, i)=>{
            const key = `staging_${i}`;
            if (!this.isAreaFree(key)) return;
            const iaPos = new THREE.Vector3();
            ia.getWorldPosition(iaPos);
            const d = Math.hypot(worker.position.x - iaPos.x, worker.position.z - iaPos.z);
            if (d < bestDist) { bestDist = d; best = { key, pos: iaPos, index: i }; }
        });
        return best;
    }
    resetAll(positions)
    {
        this.occupiedRacks.clear();
        this.occupiedAreas.clear();
        this.workers.forEach((worker, i)=>{
            worker.busy = false;
            worker.state = "Idle";
            worker.intent = 'idle'; //Reset intent to idle on sim reset
            worker.lastIndex = 0;
            worker.lastSearchRack = null;
            worker.targetTileIdx = null;
            worker.currentRack = null;
            worker._remainingWaypoints = 0;
            worker.indicator.visible = false;
            worker._idleReturnPos = null;
            worker.tileIdx = null;
            worker._reservedTileIdx = null;
            worker._reservedTileCenter = null;
            worker._evictedAt = null;
            worker._movementSession = null;
            worker._isleavingIA = false;
            const pos = positions[i % positions.length];
            worker._showAt(pos.x, pos.z);
        });
    }
}

//Initializer
let workerPool = null;
function initWorkerPool(scene, count)
{
    workerPool = new WorkerPool(scene, count);
    console.log(`[POOL] Initialized with ${count} worker(s)`);
    return workerPool;
}