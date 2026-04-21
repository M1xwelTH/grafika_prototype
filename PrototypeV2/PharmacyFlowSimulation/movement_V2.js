//movement_temp5.js — Unified Movement System
//Owns all routing, tile occupation, transit enforcement, storage logic, and IA soft zones.
//worker.js exposes only moveToWorldPosition() as a low-level primitive.
//functions.js calls: moveWorkerToIA(), moveTo(), runStorageTrip(), occupyInitialTile(), registerIA()
//
//moveWorkerToIA(worker, key)             — navigate to any registered IA; handles state labels + currentRack
//moveTo(worker, x, z, exactX?, exactZ?) — non-IA destinations only (idle slots, corridor waypoints)

// ============================================================
// SECTION 1 — GRID SETUP
// ============================================================
const TILE_SIZE = 2;
const GRID_WIDTH = 60 / TILE_SIZE; // 30 tiles across X
const GRID_HEIGHT = 30 / TILE_SIZE; // 15 tiles across Z
const HALF_WIDTH = 30;
const HALF_HEIGHT = 15;
const tileCount = GRID_WIDTH * GRID_HEIGHT;
const grid = new Uint8Array(tileCount);    // 0=walkable, 1=blocked
const gridCost = new Float32Array(tileCount);  // 1.0=normal, 3.0=discouraged
const cameFrom = new Int16Array(tileCount);
const gScore = new Float32Array(tileCount);
const WORKER_HALF_X = 1.0; //Physical collision half-width (used by moveToWorldPosition and isColliding)
const WORKER_HALF_Z = 1.0;
const TILE_COST_NORMAL = 1.0;
const TILE_COST_DISCOURAGED = 5.0;
const forcedBlockedTiles = new Set();

function worldToGrid(x, z)
{
    const gx = Math.floor((x + HALF_WIDTH)  / TILE_SIZE);
    const gz = Math.floor((z + HALF_HEIGHT) / TILE_SIZE);
    return gz * GRID_WIDTH + gx;
}
function gridToWorld(index)
{
    const gx = index % GRID_WIDTH;
    const gz = Math.floor(index / GRID_WIDTH);
    return { x: gx * TILE_SIZE - HALF_WIDTH + TILE_SIZE / 2, z: gz * TILE_SIZE - HALF_HEIGHT + TILE_SIZE / 2 };
}

//Static obstacle collision — called by moveToWorldPosition in worker.js and by registerIA
function isColliding(x, z)
{
    if (!window.obstacles) return false;
    for (const obs of window.obstacles)
    {
        if (Math.abs(x - obs.cx) < WORKER_HALF_X + obs.halfX &&
            Math.abs(z - obs.cz) < WORKER_HALF_Z + obs.halfZ) return true;
    }
    return false;
}

function isTileBlocked(tileX, tileZ)
{
    const worldX   = tileX * TILE_SIZE - HALF_WIDTH  + TILE_SIZE / 2;
    const worldZ   = tileZ * TILE_SIZE - HALF_HEIGHT + TILE_SIZE / 2;
    const tileMinX = worldX - TILE_SIZE / 2, tileMaxX = worldX + TILE_SIZE / 2;
    const tileMinZ = worldZ - TILE_SIZE / 2, tileMaxZ = worldZ + TILE_SIZE / 2;
    for (const obs of obstacles)
    {
        const obsMinX = obs.cx - obs.halfX, obsMaxX = obs.cx + obs.halfX;
        const obsMinZ = obs.cz - obs.halfZ, obsMaxZ = obs.cz + obs.halfZ;
        if (tileMinX >= obsMinX && tileMaxX <= obsMaxX &&
            tileMinZ >= obsMinZ && tileMaxZ <= obsMaxZ) return true;
    }
    return false;
}

function getTileCost(tileX, tileZ)
{
    const worldX   = tileX * TILE_SIZE - HALF_WIDTH  + TILE_SIZE / 2;
    const worldZ   = tileZ * TILE_SIZE - HALF_HEIGHT + TILE_SIZE / 2;
    const tileMinX = worldX - TILE_SIZE / 2, tileMaxX = worldX + TILE_SIZE / 2;
    const tileMinZ = worldZ - TILE_SIZE / 2, tileMaxZ = worldZ + TILE_SIZE / 2;
    for (const obs of obstacles)
    {
        const obsMinX = obs.cx - obs.halfX, obsMaxX = obs.cx + obs.halfX;
        const obsMinZ = obs.cz - obs.halfZ, obsMaxZ = obs.cz + obs.halfZ;
        if (tileMaxX > obsMinX && tileMinX < obsMaxX &&
            tileMaxZ > obsMinZ && tileMinZ < obsMaxZ) return TILE_COST_DISCOURAGED;
    }
    return TILE_COST_NORMAL;
}

function markBlockedArea(minX, maxX, minZ, maxZ)
{
    const startGX = Math.floor((minX + HALF_WIDTH) / TILE_SIZE);
    const endGX   = Math.floor((maxX + HALF_WIDTH) / TILE_SIZE);
    const startGZ = Math.floor((minZ + HALF_HEIGHT) / TILE_SIZE);
    const endGZ   = Math.floor((maxZ + HALF_HEIGHT) / TILE_SIZE);
    for (let gz = startGZ; gz <= endGZ; gz++)
    {
        for (let gx = startGX; gx <= endGX; gx++)
        {
            const idx = gz * GRID_WIDTH + gx;
            forcedBlockedTiles.add(idx);
        }
    }
}

function buildGrid()
{
    for (let z = 0; z < GRID_HEIGHT; z++)
    {
        for (let x = 0; x < GRID_WIDTH; x++)
        {
            const index = z * GRID_WIDTH + x;
            grid[index]     = isTileBlocked(x, z) ? 1 : 0;
            gridCost[index] = grid[index] === 1 ? TILE_COST_NORMAL : getTileCost(x, z);
        }
    }
}

const tileMeshes = [];
function createTileDebug(scene)
{
    const geo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
    for (let z = 0; z < GRID_HEIGHT; z++)
    {
        for (let x = 0; x < GRID_WIDTH; x++)
        {
            const index = z * GRID_WIDTH + x;
            let color;
            if (grid[index] === 1)          color = 0xff0000;
            else if (gridCost[index] > 1.0) color = 0xffaa00;
            else                            color = 0x00ff00;
            const mat  = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3 });
            const mesh = new THREE.Mesh(geo, mat);
            const world = gridToWorld(index);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.set(world.x, 0.01, world.z);
            scene.add(mesh);
            tileMeshes.push(mesh);
        }
    }
}

// ============================================================
// SECTION 2 — TILE OCCUPATION LAYER
// ============================================================
//0 = free. Positive int = the worker ID currently standing on this tile.
//Never read by A* — only by the walk loop.
const tileOccupants = new Int16Array(tileCount);

function occupyTile(tileIdx, workerId) { tileOccupants[tileIdx] = workerId; }
function freeTile(tileIdx)             { tileOccupants[tileIdx] = 0; }
function getTileOccupant(tileIdx)      { return tileOccupants[tileIdx]; }
function isTileFree(tileIdx)           { return tileOccupants[tileIdx] === 0; }

function occupyInitialTile(worker)
{
    if (!worker.position) return;
    const idx = worldToGrid(worker.position.x, worker.position.z);
    occupyTile(idx, worker.id);
}

function resetTileOccupants()
{
    tileOccupants.fill(0);
    storageWorkerCount = 0;
}

//Helper — re-syncs tileOccupants after any moveToWorldPosition that could drift across a tile boundary.
//Call after every physical move with the tile index that was claimed before moving.
function _resyncTile(worker, claimedIdx)
{
    const actualIdx = worldToGrid(worker.position.x, worker.position.z);
    if (worker._movementSession) { worker._movementSession.tiles += 1; }
    if (actualIdx !== claimedIdx)
    {
        freeTile(claimedIdx);
        const claimedCenter = gridToWorld(claimedIdx);
        const dx = worker.position.x - claimedCenter.x;
        const dz = worker.position.z - claimedCenter.z;
        const distSq = dx*dx + dz*dz;
        //Ignore tiny drift
        //if (distSq < 0.01) {return claimedIdx;}
        // Only occupy actual tile if it's free, otherwise stay on claimed
        if (isTileFree(actualIdx))
        {
            freeTile(claimedIdx);
            occupyTile(actualIdx, worker.id);
            return actualIdx;
        }
        else {return claimedIdx;}
    }
    //return actualIdx; //may be able to be removed since the if block above does the job
}

// ============================================================
// SECTION 3 — TRANSIT & DOORWAY TILES
// ============================================================
const transitTiles         = new Set();
const DOORWAY_TILE_INDICES = new Set();

function markTransitTile(worldX, worldZ) { transitTiles.add(worldToGrid(worldX, worldZ)); }
function isTileTransit(tileIdx)          { return transitTiles.has(tileIdx); }
function isDoorwayTile(tileIdx)          { return DOORWAY_TILE_INDICES.has(tileIdx); }

function initDoorwayTiles()
{
    const coords = [
        { x: 13, z: -2 }, //Main floor approach tile
        { x: 15, z: -2 }, //Doorway mouth
        { x: 17, z: -2 }, //First tile inside storage wall
    ];
    coords.forEach(({ x, z }) =>
    {
        const idx = worldToGrid(x, z);
        DOORWAY_TILE_INDICES.add(idx);
        transitTiles.add(idx);
    });
}

function initTransitTiles() //Reserved corridor tiles, add special ones in HTML directly for rack layouts with rack corridors
{
    [
        { x: 19, z: -2 },
        { x: 21, z: -2 },
        { x: 21, z: -4 },
        { x: 23, z: -6 },
    ].forEach(({ x, z }) => markTransitTile(x, z));
}

// ============================================================
// SECTION 4 — STORAGE LOGIC
// ============================================================
const STORAGE_MAX_WORKERS = 2;
let storageWorkerCount = 0;

function isInStorageZone(worldX, worldZ)
{
    return worldX > 17 && worldX < 30 && worldZ > -15 && worldZ < 0;
}

//Checks if any worker on a doorway tile currently has exiting_storage intent.
//Used to give storage-exiting workers priority over entering workers.
function _doorwayHasExitingWorker()
{
    for (const idx of DOORWAY_TILE_INDICES)
    {
        const id = getTileOccupant(idx);
        if (id === 0) continue;
        const w = workerPool.workers.find(w => w.id === id);
        if (w?.intent === 'exiting_storage') return true;
    }
    return false;
}

// ============================================================
// SECTION 5 — A* PATHFINDING
// ============================================================
//A* reads only the static grid — tileOccupants never checked here.
function _isTileStaticPassable(tileIdx) { return grid[tileIdx] !== 1 && !forcedBlockedTiles.has(tileIdx); }

function heuristic(idxA, idxB)
{
    const ax = idxA % GRID_WIDTH, az = Math.floor(idxA / GRID_WIDTH);
    const bx = idxB % GRID_WIDTH, bz = Math.floor(idxB / GRID_WIDTH);
    return TILE_SIZE * (Math.abs(ax - bx) + Math.abs(az - bz));
}

function findPath(startX, startZ, endX, endZ)
{
    const startIdx = worldToGrid(startX, startZ);
    let   endIdx   = worldToGrid(endX,   endZ);
    if (startIdx === endIdx) return [];
    if (!_isTileStaticPassable(endIdx))
    {
        const fallback = _findPassableTileNear(endX, endZ);
        if (!fallback) return [];
        endIdx = fallback.idx;
        console.warn(`[PATH] Dest tile blocked, rerouting to nearest passable tile`);
    }
    const fScore = new Float32Array(tileCount).fill(Infinity);
    gScore.fill(Infinity);
    cameFrom.fill(-1);
    gScore[startIdx] = 0;
    fScore[startIdx] = heuristic(startIdx, endIdx);
    const openSet    = new Set([startIdx]);

    while (openSet.size > 0)
    {
        let current = -1, bestF = Infinity;
        for (const idx of openSet) { if (fScore[idx] < bestF) { bestF = fScore[idx]; current = idx; } }
        openSet.delete(current);
        if (current === endIdx)
        {
            const path = [];
            let node = endIdx;
            while (node !== startIdx && node !== -1) { path.unshift(gridToWorld(node)); node = cameFrom[node]; }
            return path;
        }
        const cx = current % GRID_WIDTH;
        const cz = Math.floor(current / GRID_WIDTH);
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]])
        {
            const nx = cx + dx, nz = cz + dz;
            if (nx < 0 || nx >= GRID_WIDTH || nz < 0 || nz >= GRID_HEIGHT) continue;
            const neighbor = nz * GRID_WIDTH + nx;
            if (!_isTileStaticPassable(neighbor)) continue;
            const tentativeG = gScore[current] + TILE_SIZE * gridCost[neighbor];
            if (tentativeG < gScore[neighbor])
            {
                cameFrom[neighbor] = current;
                gScore[neighbor]   = tentativeG;
                fScore[neighbor]   = tentativeG + heuristic(neighbor, endIdx);
                openSet.add(neighbor);
            }
        }
    }
    return [];
}

// ============================================================
// SECTION 6 — HELPERS: WAIT TILE, PASSABLE TILE, IA REGISTRY, EVICTION
// ============================================================

//BFS — nearest free non-transit non-blocked tile from worker's current position.
//Used for doorway backup and transit sidestep.
const _WAIT_TILE_MAX_RADIUS = 4;
const _WAIT_TILE_MAX_RADIUS_WIDE = 6;
function _findNearestWaitTile(worker, radius = _WAIT_TILE_MAX_RADIUS)
{
    const startX = Math.floor((worker.position.x + HALF_WIDTH)  / TILE_SIZE);
    const startZ = Math.floor((worker.position.z + HALF_HEIGHT) / TILE_SIZE);
    const startIdx = startZ * GRID_WIDTH + startX;
    const visited = new Set([startIdx]);
    const queue = [{ gx: startX, gz: startZ, dist: 0 }];
    while (queue.length > 0)
    {
        const { gx, gz, dist } = queue.shift();
        if (dist >= radius) continue;
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]])
        {
            const nx = gx + dx, nz = gz + dz;
            if (nx < 0 || nx >= GRID_WIDTH || nz < 0 || nz >= GRID_HEIGHT) continue;
            const idx = nz * GRID_WIDTH + nx;
            if (visited.has(idx)) continue;
            visited.add(idx);
            const center = gridToWorld(idx); //Tile center in world space
            if (grid[idx] === 1 || isColliding(center.x, center.z)) continue; //Blocked, skip and don't expand
            if (!isTileTransit(idx) && isTileFree(idx) && gridCost[idx] < TILE_COST_DISCOURAGED) return { idx, pos: center };
            queue.push({ gx: nx, gz: nz, dist: dist + 1 }); //Transit or occupied — expand through
        }
    }
    return null;
}

//BFS — nearest passable tile from a blocked destination.
//No radius cap — always finds something in a valid layout.
function _findPassableTileNear(destX, destZ)
{
    const dgx      = Math.floor((destX + HALF_WIDTH)  / TILE_SIZE);
    const dgz      = Math.floor((destZ + HALF_HEIGHT) / TILE_SIZE);
    const startIdx = dgz * GRID_WIDTH + dgx;
    const visited  = new Set([startIdx]);
    const queue    = [{ gx: dgx, gz: dgz }];

    while (queue.length > 0)
    {
        const { gx, gz } = queue.shift();
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]])
        {
            const nx = gx + dx, nz = gz + dz;
            if (nx < 0 || nx >= GRID_WIDTH || nz < 0 || nz >= GRID_HEIGHT) continue;
            const idx = nz * GRID_WIDTH + nx;
            if (visited.has(idx)) continue;
            visited.add(idx);
            if (grid[idx] !== 1) return { idx, pos: gridToWorld(idx) };
            queue.push({ gx: nx, gz: nz });
        }
    }
    return null;
}

// --- IA SOFT ZONE REGISTRY ---
//Each IA has a key, an exact world position, and a precomputed list of physically
//reachable candidate tiles sorted by distance from the IA center.
//Candidates exclude tiles whose center sits inside any worker+obstacle collision zone.
//
//Call registerIA() once per IA from HTML after buildGrid() and obstacles are set up:
//  registerIA('rack_1', rackIAWorldPos.x, rackIAWorldPos.z);
//  registerIA('desk',   deskIAWorldPos.x,  deskIAWorldPos.z);
//  etc.
const _iaRegistry = new Map(); // key → { iaExact:{x,z}, candidates:[{idx, center:{x,z}}] }

function registerIA(key, worldX, worldZ)
{
    const cgx = Math.floor((worldX + HALF_WIDTH)  / TILE_SIZE);
    const cgz = Math.floor((worldZ + HALF_HEIGHT) / TILE_SIZE);
    const candidates = [];

    //Check the containing tile and its 4 cardinal neighbours
    for (const [dx, dz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]])
    {
        const nx = cgx + dx, nz = cgz + dz;
        if (nx < 0 || nx >= GRID_WIDTH || nz < 0 || nz >= GRID_HEIGHT) continue;
        const idx    = nz * GRID_WIDTH + nx;
        if (grid[idx] === 1) continue; //Hard blocked
        const center = gridToWorld(idx);
        //Physical reachability: tile center must be outside worker+obstacle collision zone
        if (isColliding(center.x, center.z)) continue;
        candidates.push({ idx, center, distToIA: Math.hypot(center.x - worldX, center.z - worldZ) });
    }
    candidates.sort((a, b) => a.distToIA - b.distToIA);
    _iaRegistry.set(key, { iaExact: { x: worldX, z: worldZ }, candidates });
    console.log(`[IA] Registered '${key}' with ${candidates.length} candidate tile(s)`);
}

//Select the best available IA tile for a given key.
//Prefers free tiles (by distance from IA), falls back to closest if all occupied.
//Returns { idx, center, iaExact } or null if key not registered or no candidates.
function selectIATile(key)
{
    const entry = _iaRegistry.get(key);
    if (!entry || entry.candidates.length === 0)
    {
        console.warn(`[IA] No candidates registered for key '${key}'`);
        return null;
    }
    for (const c of entry.candidates)
    {
        if (isTileFree(c.idx) && !isTileTransit(c.idx)) return { idx: c.idx, center: c.center, iaExact: entry.iaExact };
    }
    //Fallback: any free candidate (including transit if no non-transit is free)
    for (const c of entry.candidates)
    {
        if (isTileFree(c.idx))
            return { idx: c.idx, center: c.center, iaExact: entry.iaExact };
    }
    return null; //All candidates occupied — return null so the caller waits
}

// --- IDLE EVICTION ---
// BFS — same as _findNearestWaitTile but tries perpendicular directions first.
// evictorDX/evictorDZ: the evictor's movement delta in grid units (+1/-1 on one axis, 0 on the other).
// If evictor moves on X (evictorDX != 0), prefer ±Z expansion first.
// If evictor moves on Z (evictorDZ != 0), prefer ±X expansion first.
// Falls back to all four directions if no perpendicular tile is found.
function _findSidestepTile(worker, evictorDX, evictorDZ, radius = _WAIT_TILE_MAX_RADIUS_WIDE)
{
    const startX   = Math.floor((worker.position.x + HALF_WIDTH)  / TILE_SIZE);
    const startZ   = Math.floor((worker.position.z + HALF_HEIGHT) / TILE_SIZE);
    const startIdx = startZ * GRID_WIDTH + startX;
    const visited  = new Set([startIdx]);
    // Build expansion order: perpendicular axes first, then parallel.
    // If evictor moves on X → prefer Z-axis neighbours [0,+1],[0,-1] before [+1,0],[-1,0].
    // If evictor moves on Z → prefer X-axis neighbours [+1,0],[-1,0] before [0,+1],[0,-1].
    const perpFirst = (evictorDX !== 0)
        ? [[0,1],[0,-1],[1,0],[-1,0]]   // evictor on X → sidestep on Z
        : [[1,0],[-1,0],[0,1],[0,-1]];  // evictor on Z → sidestep on X
    const queue = [{ gx: startX, gz: startZ, dist: 0 }];
    while (queue.length > 0)
    {
        const { gx, gz, dist } = queue.shift();
        if (dist >= radius) continue;
        for (const [dx, dz] of perpFirst)
        {
            const nx = gx + dx, nz = gz + dz;
            if (nx < 0 || nx >= GRID_WIDTH || nz < 0 || nz >= GRID_HEIGHT) continue;
            const idx = nz * GRID_WIDTH + nx;
            if (visited.has(idx)) continue;
            visited.add(idx);
            const center = gridToWorld(idx);
            if (grid[idx] === 1 || isColliding(center.x, center.z)) continue;
            if (isTileFree(idx))
            {
                dataCollector.logEvent(
                    "movement",
                    worker.id,
                    "sidestep",
                    [`to_tile_${idx}`]
                );
                if (worker._movementSession) {worker._movementSession.congestion += 1;}
                return { idx, pos: center };
            }
            queue.push({ gx: nx, gz: nz, dist: dist + 1 });
        }
    }
    return null; // No sidestep tile found — caller falls back to standard _findNearestWaitTile
}
//Evict an idle worker, preferring perpendicular movement to the evictor's travel axis, freeing tile for requesting worker.
//evictorCurrentIdx: the tile the evictor is currently on (used to derive direction).
//evictorTargetIdx:  the tile the evictor wants to step into (the one the idle worker is blocking).
async function _evictIdleWorker(idleWorker, evictorCurrentIdx = null, evictorTargetIdx = null)
{
    // Respect busy — don't evict a worker that is mid-flow
    if (idleWorker.intent === 'moving' || idleWorker.intent === 'exiting_storage') return false;
    if (idleWorker.intent !== 'idle') return false; // only evict workers that are genuinely standing still
    if (idleWorker._evictedAt && performance.now() - idleWorker._evictedAt < 700) return false; // 0.7s cooldown
    // Derive evictor's movement direction in grid units
    let waitTile = null;
    if (evictorCurrentIdx !== null && evictorTargetIdx !== null)
    {
        const fromX = evictorCurrentIdx % GRID_WIDTH;
        const fromZ = Math.floor(evictorCurrentIdx / GRID_WIDTH);
        const toX = evictorTargetIdx   % GRID_WIDTH;
        const toZ = Math.floor(evictorTargetIdx   / GRID_WIDTH);
        const dX = toX - fromX; // Will be +1, -1, or 0
        const dZ = toZ - fromZ; // Will be +1, -1, or 0
        waitTile = _findSidestepTile(idleWorker, dX, dZ, _WAIT_TILE_MAX_RADIUS_WIDE);
    }
    // Fallback to standard BFS if no directional info or sidestep found nothing
    if (!waitTile) waitTile = _findNearestWaitTile(idleWorker, _WAIT_TILE_MAX_RADIUS_WIDE);
    if (!waitTile)
    {
        dataCollector.logEvent(
            "movement",
            idleWorker.id,
            "unable_to_evict_no_space",
            []
        );
        return false;
    } //No room to evict to — requesting worker will keep retrying
    const prevIdx = idleWorker._reservedTileIdx 
    ?? worldToGrid(idleWorker.position.x, idleWorker.position.z);
    const evictorId = getTileOccupant(evictorTargetIdx); // this is the evictor
    const evictor = workerPool.workers.find(w => w.id === evictorId);
    if (evictor?._movementSession) { evictor._movementSession.congestion += 1; }
        dataCollector.logEvent(
            "movement",
            idleWorker.id,
            `evicted_by_worker_${getTileOccupant(evictorTargetIdx)}`,
            [`from_tile_${prevIdx}`, `to_tile_${waitTile.idx}`]
        );
    idleWorker.intent = 'moving';
    idleWorker.state = 'evicted';
    occupyTile(waitTile.idx, idleWorker.id);
    await idleWorker.moveToWorldPosition(waitTile.pos.x, waitTile.pos.z);
    freeTile(prevIdx);
    idleWorker._reservedTileIdx = null; //Prevent returnToReservedTile from re-claiming a stale tile
    idleWorker._reservedTileCenter = null;
    _resyncTile(idleWorker, waitTile.idx);
    idleWorker._evictedAt = performance.now();
    idleWorker.intent = 'idle';
    idleWorker.state = 'Idle';
    return true;
}

// Scans all idle workers sitting inside any rack IA and moves each one to the
// nearest free non-transit tile found by BFS. Safer than fixed IDLE_SLOTS because
// it respects actual tile occupancy at the moment of the call.
// Called by WorkerPool.repositionAllIdle() — lives here because it uses tile-layer internals.
async function repositionIdleWorkers(workers)
{
    for (const worker of workers)
    {
        if (worker.busy) continue;
        if (worker.intent !== 'idle') continue;
        if (!worker._isInAnyInteractionArea()) continue;
        const waitTile = _findNearestWaitTile(worker);
        if (!waitTile)
        {
            console.warn(`[REPOS] Worker ${worker.id} stuck in IA — no free tile nearby`);
            dataCollector.logError('movement/repos', 'worker stuck in IA — no free tile nearby', worker.id);
            continue;
        }
        console.log(`[REPOS] Worker ${worker.id} drifted into IA, moving to tile (${waitTile.pos.x.toFixed(1)}, ${waitTile.pos.z.toFixed(1)})`);
        worker.busy  = true;
        worker.state = 'Repositioning';
        try
        {
            const prevIdx = worldToGrid(worker.position.x, worker.position.z);
            occupyTile(waitTile.idx, worker.id);
            freeTile(prevIdx);
            await worker.moveToWorldPosition(waitTile.pos.x, waitTile.pos.z);
            _resyncTile(worker, waitTile.idx);
            worker.state  = 'Idle';
            worker.intent = 'idle';
        }
        finally { worker.busy = false; }
    }
}

// ============================================================
// SECTION 7 — PATH WALKING
// ============================================================

//Single tile step — all per-tile logic lives here.
//Returns 'done' when the step completed normally.
//Returns 'replan' when a sidestep or backup was taken and A* must re-run from new position.
async function moveToNextTile(worker, wp, remainingCount)
{
    const targetIdx = worldToGrid(wp.x, wp.z);
    const currentIdx = worldToGrid(worker.position.x, worker.position.z);
    worker.targetTileIdx = targetIdx; // add near the top, after computing targetIdx
    worker._remainingWaypoints = remainingCount;
    // --- DOORWAY PRIORITY ---
    //Entering workers yield entirely to any worker currently exiting storage.
    if (isDoorwayTile(targetIdx) && worker.intent !== 'exiting_storage')
    {
        if (_doorwayHasExitingWorker())
        {
            const backup = _findNearestWaitTile(worker);
            if (backup)
            {
                occupyTile(backup.idx, worker.id);
                freeTile(currentIdx);
                worker.state = 'backing_up_for_exit';
                await worker.moveToWorldPosition(backup.pos.x, backup.pos.z);
                _resyncTile(worker, backup.idx);
                while (_doorwayHasExitingWorker()) { worker.state = 'waiting_doorway_exit'; await delay(100); }
            }
            return 'replan';
        }
    }
    /*
    // --- NO-IDLE TRANSIT ENFORCEMENT ---
    //If standing on a transit tile and the next tile is occupied, we cannot wait here.
    if (isTileTransit(currentIdx) && !isTileFree(targetIdx))
    {
        const side = _findNearestWaitTile(worker);
        if (side)
        {
            occupyTile(side.idx, worker.id);
            freeTile(currentIdx);
            worker.state = 'sidestepping';
            await worker.moveToWorldPosition(side.pos.x, side.pos.z);
            _resyncTile(worker, side.idx);
            return 'replan';
        }
        console.warn(`[Worker ${worker.id}] Stuck on transit tile ${currentIdx}, no wait tile found`);
        dataCollector.logError('movement/transit', 'stuck on transit tile, no wait tile found', worker.id)
        //Fall through — try to claim anyway
    }
    */ //May be removed later if idle eviction and sidestepping are effective enough at preventing transit blockages
    // --- TWO-PHASE TILE CLAIM WITH IDLE EVICTION ---
    const MAX_ATTEMPTS = 80; //~4 seconds at 50ms intervals
    let claimed = false;
    let attempts = 0;
    while (!claimed && attempts < MAX_ATTEMPTS)
    {
        if (isTileFree(targetIdx))
        {
            //Phase 1: write claim
            occupyTile(targetIdx, worker.id);
            //Phase 2: re-read after 10ms — catches simultaneous claims
            await delay(10);
            const occupant = getTileOccupant(targetIdx);
            if (occupant === worker.id)                  { claimed = true; }
            else if (worker.id < occupant)               { occupyTile(targetIdx, worker.id); claimed = true; }
            //else: lost conflict — fall through
        }
        if (!claimed)
        {
            const occupantId = getTileOccupant(targetIdx);
            /*
            if (worker.isLeavingIA && !isTileFree(nextIdx))
            {
                const other = getWorkerById(getTileOccupant(nextIdx));
                if (other) {
                    await evictWorker(other);
                    return 'retry';
                }
            }
            */ //Questionable
            if (occupantId !== 0)
            {
                const occupantWorker = workerPool.workers.find(w => w.id === occupantId);
                if (occupantWorker?.intent === 'idle')
                {
                    const evicted = await _evictIdleWorker(occupantWorker, currentIdx, targetIdx);
                    if (evicted) { attempts = 0; continue; } // reset counter — eviction clears the tile, no replan needed
                    // Eviction failed (no sidestep room) — replan around them
                    return 'replan';
                }
                if (occupantWorker?.intent === 'moving')
                {
                    const headOn = occupantWorker.targetTileIdx === currentIdx;
                    if (headOn && worker.id > occupantWorker.id)
                    {
                        // This worker yields — step aside and replan
                        const side = _findSidestepTile(worker,
                            (targetIdx % GRID_WIDTH) - (currentIdx % GRID_WIDTH),
                            Math.floor(targetIdx / GRID_WIDTH) - Math.floor(currentIdx / GRID_WIDTH),
                            _WAIT_TILE_MAX_RADIUS_WIDE
                        ) ?? _findNearestWaitTile(worker, _WAIT_TILE_MAX_RADIUS_WIDE);
                        if (side)
                        {
                            occupyTile(side.idx, worker.id);
                            freeTile(currentIdx);
                            worker.state = 'yielding';
                            await worker.moveToWorldPosition(side.pos.x, side.pos.z);
                            _resyncTile(worker, side.idx);
                            return 'replan';
                        }
                    }
                    // No head-on or this worker wins — give the yielding worker time to clear
                    await delay(100);
                    if (attempts >= MAX_ATTEMPTS / 2) return 'replan';
                }
            }
            /*
            //If currently on a transit tile, sidestep rather than waiting
            if (isTileTransit(worldToGrid(worker.position.x, worker.position.z)))
            {
                const side = _findSidestepTile(worker,
                    (targetIdx % GRID_WIDTH) - (currentIdx % GRID_WIDTH),
                    Math.floor(targetIdx / GRID_WIDTH) - Math.floor(currentIdx / GRID_WIDTH)
                ) ?? _findNearestWaitTile(worker);
                if (side)
                {
                    const prevIdx = worldToGrid(worker.position.x, worker.position.z);
                    occupyTile(side.idx, worker.id);
                    freeTile(prevIdx);
                    worker.state = 'sidestepping';
                    await worker.moveToWorldPosition(side.pos.x, side.pos.z);
                    _resyncTile(worker, side.idx);
                    return 'replan';
                }
            }
            */ //May be removed due to causing osscillation in narrow corridors with multiple workers
            attempts++;
            await delay(100);
            if (attempts >= MAX_ATTEMPTS / 2) return 'stuck';
        }
    }
    if (!claimed)
    {
        console.warn(`[Worker ${worker.id}] Claim timeout, force-claiming tile ${targetIdx}`);
        dataCollector.logError('movement/claim', `claim timeout, force-claiming tile ${targetIdx}`, worker.id);
        occupyTile(targetIdx, worker.id);
    }
    // --- MOVE ---
    await worker.moveToWorldPosition(wp.x, wp.z);
    // --- FREE PREVIOUS TILE and re-sync current ---
    freeTile(currentIdx);
    _resyncTile(worker, targetIdx);
    return 'done';
}

//Walk a full tile path. Returns true when fully completed, false when a replan is needed.
async function _walkTilePath(worker, waypoints, perTileHook = null)
{
    for (let i = 0; i < waypoints.length; i++)
    {
        if (perTileHook) await perTileHook(worker);
        const result = await moveToNextTile(worker, waypoints[i], waypoints.length - i);
        if (result === 'stuck') { return 'stuck'; }
        if (result === 'replan') { return false; }
    }
    worker._remainingWaypoints = 0;
    return true;
}

// ============================================================
// SECTION 8 — PUBLIC API
// ============================================================
const MOVE_MAX_REPLANS = 8;
const RACK_LOCK_RADIUS = 10; //World units. Worker acquires rack lock when within this distance of the IA.

//Primary movement function. Sets intent to 'moving' for the duration.
//Optional exactX/exactZ: after tile path completes, takes a final sub-tile step to
//land at the precise world coordinate (e.g. exact IA position).
async function moveTo(worker, destX, destZ, exactX = null, exactZ = null, perTileHook = null)
{
    worker.intent = 'moving';
    try
    {
        let replans = 0;
        while (replans < MOVE_MAX_REPLANS)
        {
            const path = findPath(worker.position.x, worker.position.z, destX, destZ);
            if (path.length === 0) break;
            const posBefore = { x: worker.position.x, z: worker.position.z };
            const completed = await _walkTilePath(worker, path, perTileHook);
            if (completed === true) break;
            if (completed === 'stuck')
            {
                const movedDist = Math.hypot(worker.position.x - posBefore.x, worker.position.z - posBefore.z);
                if (movedDist < TILE_SIZE * 0.5) replans++;
            }
            // else false: legitimate replan (eviction, yield, doorway) — don't count, just retry
        }
        if (replans >= MOVE_MAX_REPLANS)
        {
            console.warn(`[Worker ${worker.id}] moveTo hit replan limit, snapping to (${destX},${destZ})`);
            dataCollector.logError('movement/replan', `replan limit hit, snapping to (${destX}, ${destZ})`, worker.id);
            const currentIdx = worldToGrid(worker.position.x, worker.position.z);
            const destIdx    = worldToGrid(destX, destZ);
            freeTile(currentIdx);
            occupyTile(destIdx, worker.id);
            worker._showAt(destX, destZ);
        }
        //Final sub-tile step to exact destination (e.g. IA world position)
        if (exactX !== null && exactZ !== null)
        {
            await worker.moveToWorldPosition(exactX, exactZ);
            //No _resyncTile — candidate tile remains the logical occupied tile.
            //Sub-tile step is visual positioning only; tileOccupants stays on candidate tile.
        }
    }
    finally {worker.intent = 'idle';}
}

// Dynamic idle return — finds the nearest free non-transit tile via BFS.
// Replaces all IDLE_SLOTS-based moveTo calls in functions.js.
async function returnToIdle(worker)
{
    const waitTile = _findNearestWaitTile(worker);
    if (!waitTile)
    {
        // Nowhere to go — just mark idle in place (rare, only if map is very congested)
        worker.state  = 'Idle';
        worker.intent = 'idle';
        return;
    }
    worker.state = 'Returning to Idle';
    await moveTo(worker, waitTile.pos.x, waitTile.pos.z);
    worker.state  = 'Idle';
    worker.intent = 'idle';
}

//Derives human-readable HUD state labels from an IA key.
//Moving label is set before routing begins; arrival label is set on arrival.
//Generic fallback handles any key not explicitly listed.
function _iaStateLabel(key)
{
    if (key === 'desk')     return { moving: 'Moving to Desk',     at: 'At Desk'     };
    if (key === 'counter')  return { moving: 'Moving to Counter',  at: 'At Counter'  };
    if (key === 'outbound') return { moving: 'Moving to Outbound', at: 'At Outbound' };
    if (key === 'storage')  return { moving: 'Moving to Storage',  at: 'At Storage'  };
    if (key === 'pack_return') return { moving: 'Returning Abandoned Pack', at: 'At Outbound (Pack Return)' };
    const rackMatch    = key.match(/^rack_(\d+)$/);
    if (rackMatch)    return { moving: `Moving to Rack ${rackMatch[1]}`,       at: `At Rack ${rackMatch[1]}`       };
    const stagingMatch = key.match(/^staging_(\d+)$/);
    if (stagingMatch) return { moving: `Moving to Staging ${stagingMatch[1]}`, at: `At Staging ${stagingMatch[1]}` };
    return { moving: `Moving to ${key}`, at: `At ${key}` }; //Generic fallback for any unrecognised key
}

//Single IA navigation function — handles all registered interaction areas.
//  key : the registered IA key ('rack_1', 'desk', 'counter', 'staging_0', 'outbound', 'storage', ...)
//Automatically:
//  - Sets worker.state to a readable label before and after movement
//  - Sets worker.currentRack for rack_N keys
//  - Falls back to raw getInteractionPosition() for unregistered rack keys
//Routes via tile-based A* to the best candidate tile, then takes a final sub-tile step
//to land at the precise IA world position.
//Returns the selected slot { idx, center, iaExact }, or null on failure.
async function moveWorkerToIA(worker, key)
{
    const labels = _iaStateLabel(key);
    worker.state = labels.moving;
    //const slot = selectIATile(key);
    let slot = null;
    const slotStart = performance.now();
    while (!slot)
    {
        slot = selectIATile(key); // returns null if all occupied
        if (!slot)
        {
            if (performance.now() - slotStart > 20000) break; // timeout guard
            worker.intent = 'idle'; // evictable while waiting for a slot — busy flag covers task assignment
            worker.state = `Waiting for ${key}`;
            await delay(200);
        }
    }
    if (!slot)
    {
        //Fallback for unregistered rack keys — use raw world position from WorkerPool
        const rackMatch = key.match(/^rack_(\d+)$/);
        if (rackMatch)
        {
            const rackNumber  = Number(rackMatch[1]);
            const interactPos = workerPool.getInteractionPosition(rackNumber);
            if (interactPos)
            {
                console.warn(`[Worker ${worker.id}] IA '${key}' not registered, using raw rack position`);
                dataCollector.logError('movement/ia', `IA '${key}' not registered, using raw rack position`, worker.id);
                await moveTo(worker, interactPos.x, interactPos.z, interactPos.x, interactPos.z);
                worker.currentRack = rackNumber;
                worker.state = labels.at;
                return null;
            }
        }
        console.warn(`[Worker ${worker.id}] No IA registered for key '${key}', cannot move`);
        dataCollector.logError('movement/ia', `No IA registered for key '${key}', cannot move`, worker.id);
        return null;
    }
    // Build proximity lock hook for rack keys only
    const rackMatch = key.match(/^rack_(\d+)$/);
    let lockAcquired = false;
    let perTileHook  = null;
    if (rackMatch)
    {
        const rackNumber = Number(rackMatch[1]);
        const iaExact = slot.iaExact;
        //Wait until the rack is free BEFORE starting movement.
        //Ensuring moveTo never blocks mid-path waiting for a rack lock, so replans cannot trap the hook in a spin-wait with a stale path.
        const prevState = worker.state;
        const RACK_FALLBACK_TIMEOUT = 15000; // 15 IRL seconds
        const fallbackStart = performance.now();
        worker.intent = 'idle'; //Waiting — allows other workers to evict if needed, prevents deadlock
        while (!workerPool.isRackFree(rackNumber))
        {
            if (performance.now() - fallbackStart > RACK_FALLBACK_TIMEOUT)
            {
                console.warn(`[Worker ${worker.id}] Rack ${rackNumber} fallback lock timeout — force-acquiring`);
                dataCollector.logError('movement/rack_lock', `rack ${rackNumber} fallback timeout, force-acquiring`, worker.id);
                break;
            }
            worker.state = `Waiting Rack ${rackNumber}`;
            await delay(200);
        }
        worker.intent = 'moving'; //Now moving — prevents eviction and allows the hook to acquire the lock when we get close
        worker.state = prevState;
        //Locking afterwards, rack is supposed to be free
        perTileHook = async (w)=>{
            if (lockAcquired) return; // Already locked — nothing to do
            const dist = Math.hypot(w.position.x - iaExact.x, w.position.z - iaExact.z);
            if (dist > RACK_LOCK_RADIUS) return; // Not close enough yet — keep walking
            //Guard against the simultaneous-clear race: one brief re-check, no spin loop.
            //That is due to previous bug of looping failed lock attempts and replans
            //(hook would trigger on stale path after waiting, but rack no longer free)
            if (!workerPool.isRackFree(rackNumber)) return; //lost race — hook will retry next tile
            workerPool.lockRack(rackNumber);
            lockAcquired = true;
            w.state = prevState; //Restore "Moving to Rack N" label
        };
    }
    //Reserve candidate return tiles to prevent other claimants before moving to IA, released in returnToReservedTile
    worker._reservedTileIdx = slot.idx;
    worker._reservedTileCenter = slot.center;
    //Route via tile A* then final sub-tile step to exact IA position
    worker._movementSession = {
        from: worker._lastIA || "unknown",
        to: key,
        tiles: 0,
        congestion: 0,
        startTime: performance.now()
    };
    await moveTo(worker, slot.center.x, slot.center.z, slot.iaExact.x, slot.iaExact.z, perTileHook);
    worker.intent = 'moving'; // protect snap-back from eviction
    // Snap worker back to candidate tile center after sub-tile IA step.
    // The sub-tile step (moveToWorldPosition to iaExact) can drift the worker's physical
    // position across a tile boundary or into an obstacle zone. Without this snap-back,
    // the next findPath call uses the drifted position as its start tile, which may be
    // blocked, have no valid path, or (worst case) be the same tile as the destination —
    // causing findPath to return [] and skipping the full tile path entirely, leaving the
    // worker to attempt a straight-line walk through obstacles via moveToWorldPosition.
    await worker.moveToWorldPosition(slot.center.x, slot.center.z);
    _resyncTile(worker, slot.idx);
    worker.intent = 'idle';
    const session = worker._movementSession;
    if (session)
    {
        const duration = (performance.now() - session.startTime) / 1000;
        dataCollector.logMovement(
            worker.id,
            session.from,
            session.to,
            session.tiles,
            session.congestion,
            duration
        );
        worker._movementSession = null;
    }
    /*
    const session = worker._movementSession;
    if (session)
    {
        const duration = (performance.now() - session.startTime) / 1000;
        dataCollector.logEvent(
            "movement_summary",
            worker.id,
            `${session.from} -> ${session.to}`,
            [
                `tiles_${session.tiles}`,
                `congestion_${session.congestion}`,
                `duration_${duration.toFixed(2)}`
            ]
        );
        worker._movementSession = null;
    }
    */ //Old logging
    // Edge case: path was empty (worker already adjacent) — hook never fired
    if (rackMatch && !lockAcquired)
    {
        const rackNumber = Number(rackMatch[1]);
        const RACK_FALLBACK_TIMEOUT = 15000; // 15 IRL seconds
        const fallbackStart = performance.now();
        while (!workerPool.isRackFree(rackNumber))
        {
            if (performance.now() - fallbackStart > RACK_FALLBACK_TIMEOUT)
            {
                console.warn(`[Worker ${worker.id}] Rack ${rackNumber} fallback lock timeout — force-acquiring`);
                dataCollector.logError('movement/rack_lock', `rack ${rackNumber} fallback timeout, force-acquiring`, worker.id);
                break;
            }
            await delay(200);
        }
        workerPool.lockRack(rackNumber);
    }
    if (rackMatch) worker.currentRack = Number(rackMatch[1]);
    worker.state = labels.at;
    worker._lastIA = key;
    return slot;
}
async function returnToReservedTile(worker)
{
    const idx = worker._reservedTileIdx;
    const center = worker._reservedTileCenter;
    if (!idx || !center)
    {
        //Was evicted post IA interaction, reserved tile freed by the eviction, re-sync from current physical position before returnToIdle
        const fallbackIdx = worldToGrid(worker.position.x, worker.position.z);
        if (isTileFree(fallbackIdx)) occupyTile(fallbackIdx, worker.id);
        _resyncTile(worker, fallbackIdx);
        return;
    }
    worker.intent = 'moving'; //protect from eviction during snap-back
    await worker.moveToWorldPosition(center.x, center.z);
    _resyncTile(worker, idx);
    worker.intent = 'idle';
    worker._reservedTileIdx = null;
    worker._reservedTileCenter = null;
}

//Full storage round trip. Sets intent appropriately for each leg.
async function runStorageTrip(worker, storageX, storageZ, onArrival, returnX, returnZ)
{
    while (storageWorkerCount >= STORAGE_MAX_WORKERS)
    {
        worker.state  = 'waiting_storage_access';
        worker.intent = 'idle'; //Waiting — evictable if needed
        await delay(200);
    }
    storageWorkerCount++;
    try
    {
        worker.state  = 'Going to Storage';
        worker.intent = 'moving'; //moveTo will manage intent internally, but set it explicitly here for clarity
        await moveTo(worker, storageX, storageZ, storageX, storageZ);

        worker.state  = 'Working in Storage';
        worker.intent = 'idle'; //In place, doing work — evictable
        if (onArrival) await onArrival(worker);

        worker.intent = 'exiting_storage'; //Now exiting — grants doorway priority
        worker.state  = 'Exiting Storage';
        returnX = 11, returnZ = -2; //Exit point
        await moveTo(worker, returnX, returnZ, returnX, returnZ); //Land at doorway-clear point, then scatter from there
        await returnToIdle(worker);
    }
    finally
    {
        storageWorkerCount--;
        worker.intent = 'idle';
    }
}

// ============================================================
// SECTION 9 — INIT SEQUENCE
// ============================================================
//Call order in temp.html after all scene objects are created:
//
//  buildGrid();
//  initDoorwayTiles();
//  initTransitTiles();
//
//  //Register every IA after buildGrid() — needs obstacle data and grid to be ready
//  //Use getWorldPosition() on each IA mesh to get world coords:
//  const rackIAPos = new THREE.Vector3();
//  rack1.interactionArea.getWorldPosition(rackIAPos);
//  registerIA('rack_1', rackIAPos.x, rackIAPos.z);
//  ...repeat for rack_2 through rack_8...
//  registerIA('desk',    deskIAPos.x,    deskIAPos.z);
//  registerIA('counter', counterIAPos.x, counterIAPos.z);
//  registerIA('storage', storageIAPos.x, storageIAPos.z);
//  //Staging has 6 IAs:
//  staging.interactionAreas.forEach((ia, i) => {
//      const p = new THREE.Vector3(); ia.getWorldPosition(p);
//      registerIA('staging_' + i, p.x, p.z);
//  });
//
//  createTileDebug(scene);
//  workerPool.setInitialPositions(INITIAL_POSITIONS);
//  workerPool.workers.forEach(w => occupyInitialTile(w));
//
//In resetSimulation():
//  resetTileOccupants();
//  workerPool.resetAll(INITIAL_POSITIONS);
//  workerPool.workers.forEach(w => occupyInitialTile(w));
//
//In functions.js, replace direct moveTo() calls for furniture with moveWorkerToIA():
//  await moveWorkerToIA(worker, 'desk');
//  await moveWorkerToIA(worker, 'counter');
//  await moveWorkerToIA(worker, 'staging_' + stagingSlot.index);