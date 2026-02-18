//Grid vars
const cols = 12;
const rows = 7;
const wallSize = 6;
const cellW = (canvas.width - (cols + 1) * wallSize) / cols;
const cellH = (canvas.height - (rows + 1) * wallSize) / rows;
//Grid Class
class GridCell
{
    constructor(row, col)
    {
        this.row = row;
        this.col = col;
        this.id = `${row+1}-${col+1}`; // user requested 1-1 style
        this.debugColor = null;
    }
    getX() { return wallSize + this.col * (cellW + wallSize); }
    getY() { return wallSize + this.row * (cellH + wallSize); }
}
//GridArrayCreator
const grid = [];
for (let r = 0; r < rows; r++)
{
    const rowArr = [];
    for (let c = 0; c < cols; c++) { rowArr.push(new GridCell(r, c)); }
    grid.push(rowArr);
}
const gridOverlay = document.getElementById("gridOverlay");
//Grid labeling
gridOverlay.style.width = canvas.width + "px";
gridOverlay.style.height = canvas.height + "px";
function buildGridLabels()
{
    gridOverlay.innerHTML = "";
    for (let r = 0; r < rows; r++)
    {
        for (let c = 0; c < cols; c++)
        {
            const cell = grid[r][c];
            const label = document.createElement("div");
            label.className = "gridLabel";
            label.textContent = cell.id;
            label.style.left = cell.getX() + "px";
            label.style.top = cell.getY() + "px";
            gridOverlay.appendChild(label);
        }
    }
}
buildGridLabels(); //Grid showing
let workers = []; //Declaration
//Wall stuffs
const walls = new Map();
let cachedWallRects = [];
function wallKey(idA, idB) { return [idA, idB].sort().join("|"); }
function createWall(idA, idB, active = false) { walls.set(wallKey(idA, idB), {active}); }
function hasWall(idA, idB) { return walls.has(wallKey(idA, idB)); }
function setWallActive(idA, idB, active = true)
{ const key = wallKey(idA, idB); if (walls.has(key)) { walls.get(key).active = active; } }
function buildAllWalls()
{
    for (let r = 0; r < rows; r++)
    {
        for (let c = 0; c < cols; c++)
        {
            const cell = grid[r][c];
            if (c < cols - 1)
            { const right = grid[r][c+1]; createWall(cell.id, right.id, false); }
            if (r < rows - 1)
            { const bottom = grid[r+1][c]; createWall(cell.id, bottom.id, false); }
        }
    }
}
function randomizeWallStates(chance = 0.3) { walls.forEach((wallData) => { wallData.active = Math.random() < chance; }); }
function getWallRects()
{
    const rects = [];
    walls.forEach
    ((wallData, key) => {
        if (!wallData.active) return;
        const [idA, idB] = key.split("|");
        const A = findCellByID(idA);
        const B = findCellByID(idB);
        let x, y, w, h;
        if (A.row === B.row)
        {
            const left = A.col < B.col ? A : B;
            x = left.getX() + cellW;
            y = left.getY();
            w = wallSize;
            h = cellH;
        }
        else
        {
            const top = A.row < B.row ? A : B;
            x = top.getX();
            y = top.getY() + cellH;
            w = cellW;
            h = wallSize;
        }
        rects.push({x, y, w, h});
    });
    return rects;
}
//Misc
function getCellFromPixel(x, y)
{
    const col = Math.floor((x - wallSize) / (cellW + wallSize));
    const row = Math.floor((y - wallSize) / (cellH + wallSize));
    if (row < 0 || col < 0 || row >= rows || col >= cols) return null;
    return grid[row][col];
}
function findCellByID(id)
{
    const [r, c] = id.split("-").map(v => parseInt(v) - 1);
    if (r < 0 || c < 0 || r >= rows || c >= cols) { return null; }
    return grid[r][c];
}
function colorGrid(id, color = "red") { const cell = findCellByID(id); if (cell) cell.debugColor = color; } //For debug
//Direction fetcher
function getNeighbors(cell, ignoreWorkers = false)
{
    const neighbors = [];
    const directions = [ [-1,0], [1,0], [0,-1], [0,1] ]; // N, S, W, E
    for (const [dr, dc] of directions)
    {
        const nr = cell.row + dr;
        const nc = cell.col + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const neighbor = grid[nr][nc];
        if 
        ( !walls.get(wallKey(cell.id, neighbor.id))?.active && (ignoreWorkers || !isCellOccupied(neighbor, workers)))
        { neighbors.push(neighbor); }
    }
    return neighbors;
}