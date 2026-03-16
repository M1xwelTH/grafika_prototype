//movement.js, here be movement specific patches, still no pathfinding but slightly guardrailed simple movement
//well the slightly does a lot of lifting, it's a patchwork of messy deadlock preventions
//implementation still at functions.js btw, so is the heavily patched moveToWorldPosition in worker.js

const DOOR_OUTSIDE = { x: 14.5, z: -2 }; //Main floor side of storage entrance
const DOOR_INSIDE = { x: 18.5, z: -2 }; //Inside storage room corridor
const DOOR_WAIT = { x: 11, z: -2 }; //Waiting point allowing leaving worker passage

function isColliding(x, z)
{
    if (!window.obstacles) return false;
    for (const obs of window.obstacles)
    { if (Math.abs(x - obs.cx) < WORKER_HALF_X + obs.halfX && Math.abs(z - obs.cz) < WORKER_HALF_Z + obs.halfZ) return true; }
    return false;
}
function isCollidingWithWorkers(x, z, selfId)
{
    for (const other of workerPool.workers)
    {
        if (other.id === selfId) continue; //skip self
        if (!other.position) continue; //skip uninitialized
        if (!other.model.visible) continue; //skip hidden workers
        if (other._escaping) continue; //ignore workers currently performing escape maneuvers to prevent mutual blocking
        //The last above prevents missfire causing worker to get stuck inside other's hitbox
        if (other._passableAt !== null && performance.now() > other._passableAt) continue;
        //Above supposed to prevent clipping also at certain points (like worker interacting with staging area)?
        if (Math.abs(x - other.position.x) <= WORKER_HALF_X * 2 + 0.2 && Math.abs(z - other.position.z) <= WORKER_HALF_Z * 2 + 0.2)
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

function getStorageWaypoints(storageX, storageZ)
{
    return[
        { x: DOOR_OUTSIDE.x, z: DOOR_OUTSIDE.z }, //Approach door from main floor
        { x: DOOR_INSIDE.x,  z: DOOR_INSIDE.z }, //Step inside storage room
        { x: storageX, z: storageZ }, //Reach storage area
        { x: DOOR_INSIDE.x, z: DOOR_INSIDE.z  }, //Return to corridor
        { x: DOOR_OUTSIDE.x, z: DOOR_OUTSIDE.z }, //Exit back to main floor
    ];
}

const doorwayManager = //Doorway special pathing, the first actual patch
{
    leavingCount: 0,
    enterLocked: false,
    _enterLockedAt: null,
    _leavingStartedAt: [],
    async requestEnter(worker)
    {
        //Block until no workers are crossing outward AND no other worker is crossing inward
        const MAX_WAIT_MS = 15000; //15 seconds max wait before force-proceed
        const startedWaiting = performance.now();
        while (this.leavingCount > 0 || this.enterLocked)
        {
            //Force-clear stale enterLocked, if the lock holder got stuck it will never call finishEntering
            if (this.enterLocked && this._enterLockedAt && performance.now() - this._enterLockedAt > 8000)
            {
                console.warn("[DOORWAY] enterLocked stale, force-releasing");
                this.enterLocked = false;
                this._enterLockedAt = null;
            }
            //Force-clear stale leavingCount, each leaving worker tracks its own timer
            const now = performance.now();
            this._leavingStartedAt = this._leavingStartedAt.filter(t =>
            {
                if (now - t > 10000)
                {
                    console.warn("[DOORWAY] leavingCount stale entry, force-decrementing");
                    this.leavingCount = Math.max(0, this.leavingCount - 1);
                    return false;
                }
                return true;
            });
            //Hard timeout, if waiting too long just proceed anyway
            if (performance.now() - startedWaiting > MAX_WAIT_MS)
            { console.warn(`[DOORWAY] Worker ${worker.id} waited too long, force-entering`); break; }
            worker.state = "Waiting at doorway";
            await delay(200);
            this._enterLockedAt = null;
        }
        this.enterLocked = true;
        this._enterLockedAt = performance.now();
    },
    //Release inward lock once safely past DOOR_INSIDE — next entrant can now proceed
    finishEntering() { this.enterLocked = false; this._enterLockedAt = null; },
    startLeaving() { this.leavingCount++; this._leavingStartedAt.push(performance.now()); },
    finishLeaving()
    {
        this.leavingCount = Math.max(0, this.leavingCount - 1);
        //Remove oldest timestamp entry
        if (this._leavingStartedAt.length > 0) this._leavingStartedAt.shift();
    }
};
async function followWaypointsWithTimeout(worker, waypoints, maxMs) //followWaypoints but prevents doorway permanent lock
{
    const deadline = performance.now() + maxMs;
    for (const waypoint of waypoints)
    {
        //If already past deadline, stop trying, let finally blocks clean up
        if (performance.now() > deadline)
        {
            console.warn(`[WORKER ${worker.id}] Doorway waypoint timeout, aborting`);
            break;
        }
        //Set deadline on the worker so moveToWorldPosition's internal check can also break out if stuck mid-waypoint
        const remainingMs = deadline - performance.now();
        worker._moveDeadline = performance.now() + remainingMs;
        await worker.moveToWorldPosition(waypoint.x, waypoint.z);
        worker._moveDeadline = null;
        if (waypoint.pauseMs) await delay(waypoint.pauseMs);
    }
    worker._moveDeadline = null; // ensure clean state on any exit path
}
async function moveWithTimeout(worker, targetX, targetZ, maxMs = 8000)
{
    const deadline = performance.now() + maxMs;
    worker._moveDeadline = deadline;
    await worker.moveToWorldPosition(targetX, targetZ);
    worker._moveDeadline = null;
}
//Staging bypass: routes worker around the staging table when the direct path crosses it
//Staging collision zone (worker half included): x=[-6.05,6.05], z=[-4.05,4.05]
async function moveAroundStaging(worker, tx, tz)
{
    const STAGING_HX = 6.1; //staging halfX(5.05) + workerHalf(1.0) + small buffer
    const BYPASS_X_POS =  12; //positive side, clear of outbound at x=9
    const BYPASS_X_NEG = -8; //negative side, clear of rack5 collision (ends at x=-8.0)
    //const RACK_CLEAR_Z = -7; //safe Z between rack row (z≈-12.4) and staging (z≈-4.05)
    const wx = worker.position.x;
    const wz = worker.position.z;
    //Bypass needed when crossing the staging Z band (either direction)
    //and at least one endpoint is within the staging X range
    if (wz < -10)
    {
        const exitLaneZ = wx < -15 ? -7 : -9.5;
        await worker.moveToWorldPosition(wx, exitLaneZ);
    }
    //Entering rack zone — align X first at safe Z, then descend straight down
    if (tz < -10 && worker.position.z > -10)
    {
        const laneZ = tx < -15 ? -7 : -9.5;
        if (Math.abs(worker.position.z - laneZ) > 0.5)
        {
            //If descending through staging X range, bypass first
            const needsBypass = Math.abs(worker.position.x) < 6.1 || Math.abs(tx) < 6.1;
            if (needsBypass)
            {
                const bpX = tx >= 0 ? 12 : -8;
                if (Math.abs(worker.position.x - bpX) > 0.5)
                    await worker.moveToWorldPosition(bpX, worker.position.z);
                await worker.moveToWorldPosition(bpX, laneZ);
            }
            else
            {
                await worker.moveToWorldPosition(worker.position.x, laneZ);
            }
        }
        if (Math.abs(worker.position.x - tx) > 0.5)
        {await worker.moveToWorldPosition(tx, laneZ);}
        await worker.moveToWorldPosition(tx, tz);
        return;
    }
    const crossingNorth = worker.position.z < -3.5 && tz > 0;
    const crossingSouth = worker.position.z >  3.5 && tz < 0;
    const xInRange = Math.abs(worker.position.x) < STAGING_HX || Math.abs(tx) < STAGING_HX;
    if ((crossingNorth || crossingSouth) && xInRange)
    {
        const bpX = tx >= 0 ? BYPASS_X_POS : BYPASS_X_NEG;
        if (Math.abs(wx - bpX) > 0.5) //only step sideways if not already clear
        {await worker.moveToWorldPosition(bpX, worker.position.z);}
        await worker.moveToWorldPosition(bpX, tz);
        await worker.moveToWorldPosition(tx, tz);
        return;
    }
    await worker.moveToWorldPosition(tx, tz);
}
//waitDoorwayExit: call before any path that crosses x=12-19, z=-2 band going southward
//Waits until no workers are currently exiting storage before proceeding
async function waitDoorwayExit(worker)
{
    const MAX_WAIT_MS = 12000;
    const startedWaiting = performance.now();
    while (doorwayManager.leavingCount > 0)
    {
        if (performance.now() - startedWaiting > MAX_WAIT_MS)
        {
            console.warn(`[WORKER ${worker.id}] waitDoorwayExit timeout, proceeding`);
            break;
        }
        worker.state = "Waiting for doorway exit";
        await delay(200);
    }
}