//Worker related
class Worker
{
    constructor(gridPath)
    {
        if (!gridPath || gridPath.length === 0) {throw new Error("Worker created with empty path")};
        this.gridPath = gridPath;
        this.movePath = buildMovementPath(gridPath);
        this.pathIndex = 0;
        this.speed = 120;
        this.radius = Math.min(cellW, cellH) * 0.25;
        this.x = this.movePath[0].x;
        this.y = this.movePath[0].y;
        this.repathCooldown = 0;
        this.state = "idle";
        this.targetCell = null;
        this.onArrival = null;
    }
    update(dt)
    {
        if (this.pathIndex >= this.movePath.length)
        {
            if (this.state === "moving" && this.onArrival) { this.onArrival(this); }
            this.state = "idle";
            return;
        }
        const target = this.movePath[this.pathIndex];
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < this.speed * dt) { this.x = target.x; this.y = target.y; this.pathIndex++; }
        else if (dist > 0.0001)
        { const nx = dx / dist; const ny = dy / dist; this.x += nx * this.speed * dt; this.y += ny * this.speed * dt; }
        this.repathCooldown -= dt;
        if (collidesWithWalls(this) && this.repathCooldown <= 0) { this.recalculatePath(); this.repathCooldown = 0.3; }
        if (pathBlockedByWorker(this) && this.repathCooldown <= 0) { this.recalculatePath(); this.repathCooldown = 0.3; }
    }
    recalculatePath()
    {
        const currentCell = getCellFromPixel(this.x, this.y);
        const goalCell = this.gridPath.at(-1);
        if (!currentCell || !goalCell) return;
        const newPath = pathfind(currentCell.id, goalCell.id);
        if (!newPath || newPath.length === 0) return;
        this.gridPath = newPath;
        this.movePath = buildMovementPath(newPath);
        this.pathIndex = 0;
        // Start at closest movement point instead of hard reset
        let closestIndex = 0;
        let minDist = Infinity;
        for (let i = 0; i < this.movePath.length; i++)
        {
            const p = this.movePath[i];
            const d = Math.hypot(p.x - this.x, p.y - this.y);
            if (d < minDist) { minDist = d; closestIndex = i; }
        }
        this.pathIndex = closestIndex;
    }
    assignTask(targetCell, onArrival)
    {
        const currentCell = getCellFromPixel(this.x, this.y);
        const newPath = pathfind(currentCell.id, targetCell.id);
        if (!newPath || newPath.length === 0) return;
        this.gridPath = newPath;
        this.movePath = buildMovementPath(newPath);
        this.pathIndex = 0;
        this.targetCell = targetCell;
        this.onArrival = onArrival;
        this.state = "moving";
    }
    render(vertexArray)
    {
        if (!Number.isFinite(this.x) || !Number.isFinite(this.y)) return;
        vertexArray.push( ...circleVertices(this.x, this.y, this.radius, 24, [0, 1, 0, 1]));
    }
}
function distance(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function pathBlockedByWorker(worker)
{
    if (worker.pathIndex >= worker.movePath.length) return false;
    const next = worker.movePath[worker.pathIndex];
    return workers.some(other => other !== worker && distance(other.x, other.y, next.x, next.y) < other.radius * 2 );
}
function circleRectCollision(cx, cy, r, rect)
{
    const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx*dx + dy*dy < r*r;
}
function collidesWithWalls(worker) {return cachedWallRects.some(rect => circleRectCollision(worker.x, worker.y, worker.radius, rect));}
function isCellOccupied(cell, workers)
{ return workers.some(w => { const workerCell = getCellFromPixel(w.x, w.y); return workerCell && workerCell.id === cell.id; });}
/*
worker.assignTask(pointA.cell, (w) => {
    console.log("Arrived at A, stocking");
    setTimeout(() => {
        w.assignTask(pointB.cell, (w2) => {
            console.log("Arrived at B, moving to counter");
            w2.assignTask(pointC.cell, () => { console.log("Finished full chain"); });
        });
    }, 1000); // stocking delay
});
*/