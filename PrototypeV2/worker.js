//worker.js, worker related
const SEARCH_DELAY = 400;
const INTERACTION_DELAY = 600;
let workerShadow = null;
let searchIndicator = null;
let debugHitboxVisible = false;

//Set-up, please change depending on where this is
const RACK_WORLD_X = { 1: -6, 2: 0, 3: 6 }; //rack1 at x=-6, rack2 at x=0, rack3 at x=6

//Traversal Order
function getTraversalOrder(boxObjects){ return [...boxObjects].sort((a,b)=>a.id.localeCompare(b.id)); }

//Worker Class
class Worker
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

    //How many racks away is this worker from a target rack? Workers that have never moved default to rack 2 (center)
    distanceTo(rackNumber)
    {
        const from = this.currentRack ?? 2;
        return Math.abs(from - rackNumber);
    }
    //RackMovement Functions
    async moveToRack(rackNumber)
    {
        //Get interaction area position
        const interactPos = workerPool.getInteractionPosition(rackNumber);
        if (interactPos) { this._showAt(interactPos.x, interactPos.z);}  //Position at interaction area
        else //Fallback to old logic if needed
        {
            const rackX = RACK_WORLD_X[rackNumber] ?? 0;
            this._showAt(rackX, 0);
        }
        if (this.currentRack === rackNumber) { this._showAt(interactPos.x, interactPos.z); return}; //already there, skip travel
        console.log(`[WORKER ${this.id}] Moving from Rack ${this.currentRack ?? "base"} → Rack ${rackNumber}`);
        this.state = `Moving to Rack ${rackNumber}`;
        this.lastIndex = 0; //reset search position when changing racks
        await delay(4000);  //Travel time
        this.currentRack = rackNumber;
    }
    async searchAndInteract(targetIDs, boxObjects)
    {
        const startTime = performance.now();
        console.log(`[WORKER ${this.id}] Search start | Targets: ${targetIDs.join(", ")}`);
        this.state = "Searching";
        //Get the interaction area's Z for the current rack to stay aligned
        const rack = racks.find(r => r.boxObjects[0]?.rack === this.currentRack);
        const interactionZ = rack ? (() =>
        {
            const worldPos = new THREE.Vector3();
            rack.interactionArea.getWorldPosition(worldPos);
            return worldPos.z;
        })() : 0;  //Fallback to 0 if rack not found
        const interactionX = rack ? (() =>
        {
            const worldPos = new THREE.Vector3();
            rack.interactionArea.getWorldPosition(worldPos);
            return worldPos.x;
        })() : 0;  //Fallback to 0 if rack not found
        //getTraversalOrder is defined in rack.js — still shared utility
        const traversal = getTraversalOrder(boxObjects);
        let currentIndex = this.lastIndex;
        for (const targetID of targetIDs)
        {
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
        this._hide();
        this.lastIndex = currentIndex; //to not reset search after finding a box
        this.state = "Idle";
    }
}

//WorkerPool
class WorkerPool
{
    constructor(scene, count = 2)
    {
        const COLORS = [0x3366ff, 0xff6633, 0x33cc66, 0xcc33ff];
        this.workers = Array.from({ length: count }, (_, i) => new Worker(i + 1, scene, COLORS[i % COLORS.length]) );
        this.occupiedRacks = new Set(); //rack numbers currently being worked on
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
}

//Initializer (for call in framework.html after scene)
let workerPool = null;
function initWorkerPool(scene, count)
{
    workerPool = new WorkerPool(scene, count);
    console.log(`[POOL] Initialized with ${count} worker(s)`);
    return workerPool;
}