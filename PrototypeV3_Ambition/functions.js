//Early mapping pathfinding
function heuristic(a, b) { return Math.hypot(a.row - b.row, a.col - b.col); }
function pathfind(startID, endID, ignoreWorkers = false)
{
    const start = findCellByID(startID);
    const goal = findCellByID(endID);
    const open = [start];
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    gScore.set(start.id, 0);
    fScore.set(start.id, heuristic(start, goal));
    while (open.length > 0)
    {
        open.sort((a,b) => fScore.get(a.id) - fScore.get(b.id));
        const current = open.shift();
        if (current.id === goal.id) { return reconstructPath(cameFrom, current); }
        for (const neighbor of getNeighbors(current, ignoreWorkers))
        {
            const tentative = gScore.get(current.id) + 1;
            if (tentative < (gScore.get(neighbor.id) ?? Infinity))
            {
                cameFrom.set(neighbor.id, current);
                gScore.set(neighbor.id, tentative);
                fScore.set(neighbor.id, tentative + heuristic(neighbor, goal));
                if (!open.includes(neighbor)) { open.push(neighbor); }
            }
        }
    }
    return [];
}
function reconstructPath(cameFrom, current)
{
    const path = [current];
    while (cameFrom.has(current.id)) { current = cameFrom.get(current.id); path.unshift(current); }
    return path;
}
function colorPath(path) { path.forEach(cell => cell.debugColor = "blue"); } //For debug
//Object movement pathfinding
function getCellCenter(cell) { return { x: cell.getX() + cellW / 2, y: cell.getY() + cellH / 2 }; }
function getTransitionPoint(fromCell, toCell)
{
    const from = getCellCenter(fromCell);
    const to = getCellCenter(toCell);
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);
    return { x: from.x + dx * (cellW / 2), y: from.y + dy * (cellH / 2) };
}
function buildMovementPath(gridPath)
{
    const path = [];
    for (let i = 0; i < gridPath.length - 1; i++) { path.push(getTransitionPoint(gridPath[i], gridPath[i+1])); }
    // final destination = center
    path.push(getCellCenter(gridPath.at(-1)));
    return path;
}
//Grid functions convertor, Canvas2D logic to WebGL Render
function pxToGL(x, y) { return [ (x / canvas.width) * 2 - 1, -((y / canvas.height) * 2 - 1) ]; } //grid funcs coord conv
function rectVertices(x, y, w, h, color)
{
    const A = pxToGL(x, y);
    const B = pxToGL(x + w, y);
    const C = pxToGL(x, y + h);
    const D = pxToGL(x + w, y + h);
    return [
        ...A, ...color,
        ...B, ...color,
        ...C, ...color,
        ...B, ...color,
        ...D, ...color,
        ...C, ...color
    ];
}
function renderGrid()
{
    let vertices = [];
    for (let r = 0; r < rows; r++)
    {
        for (let c = 0; c < cols; c++)
        {
            const cell = grid[r][c];
            const color = cell.debugColor ? colorToGL(cell.debugColor) : [0.4, 0.4, 0.4, 1];
            vertices.push( ...rectVertices( cell.getX(), cell.getY(), cellW, cellH, color ) );
        }
    }
    return vertices;
}
function renderWalls()
{
    let vertices = [];
    walls.forEach
    ((wallData, key) => {
        const [idA, idB] = key.split("|");
        const A = findCellByID(idA);
        const B = findCellByID(idB);
        if (!A || !B) return;
        const color = wallData.active ? [1, 0.3, 0.3, 1] : [1, 1, 1, 1]; //Active red, inactive white
        let x, y, w, h;
        // SAME ROW → vertical wall
        if (A.row === B.row)
        {
            const leftCell = A.col < B.col ? A : B;
            x = leftCell.getX() + cellW;
            y = leftCell.getY();
            w = wallSize;
            h = cellH;
        }
        // SAME COLUMN → horizontal wall
        else if (A.col === B.col)
        {
            const topCell = A.row < B.row ? A : B;
            x = topCell.getX();
            y = topCell.getY() + cellH;
            w = cellW;
            h = wallSize;
        }
        //Ignore diagonal walls visually (possibly subjected to future change)
        else return;
        vertices.push(...rectVertices(x, y, w, h, color));
    });

    return vertices;
}
function colorToGL(name)
{
    if (name === "red") return [1,0,0,1];
    if (name === "blue") return [0,0,1,1];
    if (name === "green") return [0,1,0,1];
    return [0.5,0.5,0.5,1];
}
function circleVertices(cx, cy, radius, segments, color)
{
    const verts = [];
    const center = pxToGL(cx, cy);
    for (let i = 0; i < segments; i++)
    {
        const a1 = (i / segments) * Math.PI * 2;
        const a2 = ((i + 1) / segments) * Math.PI * 2;
        const p1 = pxToGL(cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius);
        const p2 = pxToGL(cx + Math.cos(a2) * radius, cy + Math.sin(a2) * radius);
        verts.push( ...center, ...color, ...p1, ...color, ...p2, ...color );
    }
    return verts;
}
//Scenario Generator
class SpecialPoint
{
    constructor(cell, color) { this.cell = cell; this.color = color; }
    render() 
    {
        const center = getCellCenter(this.cell);
        return circleVertices(center.x, center.y, Math.min(cellW, cellH) * 0.18, 20, this.color);
    }
}
function getUniqueCells(count)
{
    const set = new Set();
    while (set.size < count)
    { const cell = getRandomCell(); set.add(cell); }
    return [...set];
}
function getRandomCell() { const r = Math.floor(Math.random() * rows); const c = Math.floor(Math.random() * cols); return grid[r][c]; }
function areAllConnected(cells)
{
    for (let i = 0; i < cells.length; i++)
    {
        for (let j = i + 1; j < cells.length; j++)
        { const path = pathfind(cells[i].id, cells[j].id, true); if (!path || path.length === 0) { return false; } }
    }
    return true;
}
function generateConnectedScenario(workerCount = 2)
{
    let attempts = 0;
    while (attempts < 200)
    {
        attempts++;
        randomizeWallStates(0.25);
        cachedWallRects = getWallRects();
        const used = new Set();
        function getUniqueCellGlobal()
        {
            let cell;
            do { cell = getRandomCell(); }
            while (used.has(cell.id));
            used.add(cell.id);
            return cell;
        }
        const points = [ getUniqueCellGlobal(), getUniqueCellGlobal(), getUniqueCellGlobal() ];
        const workerStarts = [];
        for (let i = 0; i < workerCount; i++) workerStarts.push(getUniqueCellGlobal());
        const testCells = [...points, ...workerStarts];
        if (areAllConnected(testCells))
        {
            return {
                pointA: points[0],
                pointB: points[1],
                pointC: points[2],
                workerStarts
            };
        }
    }
    throw new Error("Failed to generate connected scenario");
}