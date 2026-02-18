// ===Functions Below=== \\

//Rack Layout
const LEVEL_IDS = ["A","B","C","D"];
const BOX_COLUMNS = 4;

//Sim State
let simulationTime = 0;
let lastDeliverySummary = "None";
let lastOrderSummary = "None";
const overflowQueue = [];

//Worker System
let rackOccupied = false;
const SEARCH_DELAY = 400;
const INTERACTION_DELAY = 600;
const arrivalWorker =
{
    type:"arrival",
    busy:false,
    state:"Idle"
};
const orderWorker =
{
    type:"order",
    busy:false,
    state:"Idle"
};
let workerShadow = null;
let searchIndicator = null;

//Delay Helper
function delay(ms){ return new Promise(res=>setTimeout(res,ms)); }

//Visual Helpers
function createWorkerShadow(scene)
{
    const geo = new THREE.CylinderGeometry(0.6,0.6,0.05,20);
    const mat = new THREE.MeshBasicMaterial({color:0x000000});
    workerShadow = new THREE.Mesh(geo,mat);
    workerShadow.position.set(0,0.02,1.2);
    workerShadow.visible = false;
    scene.add(workerShadow);
}

function createSearchIndicator(scene)
{
    const geo = new THREE.SphereGeometry(0.08,12,12);
    const mat = new THREE.MeshBasicMaterial({color:0xff0000});
    searchIndicator = new THREE.Mesh(geo,mat);
    searchIndicator.visible = false;
    scene.add(searchIndicator);
}

function setBoxTempColor(box, colorHex)
{
    // Save original color if not already saved
    if(!box._originalColor){ box._originalColor = box.mesh.material.color.clone(); }
    box.mesh.material.color.set(colorHex);
}

function restoreBoxColor(box)
{
    if(box._originalColor){
        box.mesh.material.color.copy(box._originalColor);
        box._originalColor = null;
    }
}

//Gradient Color
function getGradientColor(ratio)
{
    const red = new THREE.Color(1,0,0);
    const yellow = new THREE.Color(1,1,0);
    const green = new THREE.Color(0,1,0);
    if(ratio<=0.5) return red.clone().lerp(yellow,ratio*2);
    return yellow.clone().lerp(green,(ratio-0.5)*2);
}

//Box Color Updates
function updateBoxes(boxObjects)
{
    boxObjects.forEach(box=>{
        const ratio = box.count/box.capacity;
        box.mesh.material.color.copy(getGradientColor(ratio));
    });
}

//Traversal Order
function getTraversalOrder(boxObjects){ return [...boxObjects].sort((a,b)=>a.id.localeCompare(b.id)); }

//Worker Search Simulation Related
async function simulateSearch(worker,targetIDs,boxObjects)
{
    const startTime = performance.now();
    console.log( `[SEARCH START] Worker: ${worker.type} | Targets: ${targetIDs.join(", ")} | Time: ${startTime.toFixed(2)}` );
    rackOccupied = true;
    worker.busy = true;
    worker.state = "Searching";
    workerShadow.visible = true;
    const traversal = getTraversalOrder(boxObjects);
    // Tracks where worker currently is
    let currentIndex = 0;
    for(const targetID of targetIDs){
        let found = false;
        let scannedCount = 0;
        while(!found && scannedCount < traversal.length){
            const box = traversal[currentIndex];
            worker.state = `Searching ${box.id}`;
            searchIndicator.visible = true;
            searchIndicator.position.copy(box.mesh.position);
            // SEARCH WHITE
            setBoxTempColor(box,0xffffff);
            await delay(SEARCH_DELAY);
            // Not correct box
            if(box.id !== targetID){ restoreBoxColor(box); }
            // Found correct box
            if(box.id === targetID)
            {
                worker.state = `Interacting ${box.id}`;
                setBoxTempColor(box,0xff8800);
                await delay(INTERACTION_DELAY);
                restoreBoxColor(box);
                found = true;
            }
            // Move forward through rack
            currentIndex = (currentIndex + 1) % traversal.length;
            scannedCount++;
        }
    }
    const endTime = performance.now();
    const duration = ((endTime-startTime)/1000).toFixed(2);
    console.log( `[SEARCH END] Worker: ${worker.type} | Duration: ${duration}s` );
    searchIndicator.visible = false;
    workerShadow.visible = false;
    worker.busy = false;
    worker.state = "Idle";
    rackOccupied = false;
}

//Restock Functions
const supplierQueue = [];
function checkReorderTriggers(boxObjects)
{
    boxObjects.forEach(box => {
        // Only trigger if exactly at threshold
        if(box.count <= 10)
        {
            // Prevent duplicate queue entries
            const alreadyQueued = supplierQueue.some(item => item.id === box.id);
            if(!alreadyQueued) {console.log(`[SUPPLIER ORDER] ${box.id} scheduled for +40`); supplierQueue.push({ id: box.id, qty: 40 });}
        }
    });
}

function weightedRandomBox(boxObjects)
{
    // Build weight list
    let weightedList = [];
    let totalWeight = 0;
    boxObjects.forEach(box => {
        const emptiness = 1 - (box.count / box.capacity);
        // Prevent zero chance completely
        const weight = Math.max(emptiness, 0.05);
        weightedList.push({ box: box, weight: weight });
        totalWeight += weight;
    });
    // Roll weighted random
    let roll = Math.random() * totalWeight;
    for(const entry of weightedList) { if(roll < entry.weight){ return entry.box; } roll -= entry.weight; }
    return weightedList[0].box;
}

function generateDeliveryBatch(boxObjects)
{
    // Prioritize supplier queue first
    if(supplierQueue.length > 0){ const supplierOrder = supplierQueue.shift(); return [{ id: supplierOrder.id, qty: supplierOrder.qty } ]; }
    // Otherwise do weighted normal delivery
    const selectedBox = weightedRandomBox(boxObjects);
    return [{ id: selectedBox.id, qty: 10 }];
}

async function processDelivery(boxObjects)
{
    if(rackOccupied || arrivalWorker.busy) return;
    const batch = generateDeliveryBatch(boxObjects);
    await simulateSearch(arrivalWorker,batch.map(b=>b.id),boxObjects);
    let summary=[];
    batch.forEach(item=>{
        const box = boxObjects.find(b=>b.id===item.id);
        for(let i=0;i<item.qty;i++){ if(box.count < box.capacity) box.count++; else overflowQueue.push({id:box.id}); }
        summary.push(`${item.qty} ${box.id}`);
    });
    lastDeliverySummary = summary.join(", ");
}

//Order Functions
function generateOrderBatch(boxObjects)
{
    const roll = Math.random() * 100;
    //Predef Batch 1 (35%)
    if(roll < 35){ return [{ id: "A1", qty: 10 }, { id: "B3", qty: 5 }]; }
    //Predef Batch 2 (15%)
    else if(roll < 50){ return [{ id: "B1", qty: 8 }, { id: "C2", qty: 4 }, { id: "D4", qty: 5 }]; }
    //Predef Batch 3 (30%)
    else if(roll < 80){ return [{ id: "C4", qty: 10 }, { id: "D1", qty: 2 }]; }
    //Random Batch (20%)
    else
    {
        const randomBox = boxObjects[Math.floor(Math.random() * boxObjects.length)];
        const qty = Math.floor(Math.random() * 10) + 1;
        return [{ id: randomBox.id, qty: qty }];
    }
}

async function processOrder(boxObjects)
{
    if(rackOccupied || orderWorker.busy) return;
    const batch = generateOrderBatch(boxObjects);
    await simulateSearch(orderWorker,batch.map(b=>b.id),boxObjects);
    let summary=[];
    batch.forEach(item=>{
        const box = boxObjects.find(b=>b.id===item.id);
        let fulfilled=0;
        while(fulfilled < item.qty && box.count>0){ box.count--; fulfilled++; }
        summary.push(`${fulfilled}/${item.qty} ${box.id}`);
    });
    lastOrderSummary = summary.join(", ");
}

//FailSafe Overflow Restock
function processOverflow(boxObjects)
{
    if(!overflowQueue.length) return;
    const item = overflowQueue.shift();
    const box = boxObjects.find(b=>b.id===item.id);
    if(box.count < box.capacity) box.count++;
}

//Runtime
function tickSimulation(delta){ simulationTime += delta; }

//InitRack
function createMedicineRack()
{
    const rackGroup = new THREE.Group();
    const shelves=[];
    const boxObjects=[];
    const frameMat = new THREE.MeshStandardMaterial({color:0x555555});
    const shelfMat = new THREE.MeshStandardMaterial({color:0xdddddd});
    const rackHeight = 5;
    //POLES
    const poleGeo = new THREE.BoxGeometry(0.1,rackHeight,0.1);
    [
        [-2,rackHeight/2,-0.5],
        [ 2,rackHeight/2,-0.5],
        [-2,rackHeight/2, 0.5],
        [ 2,rackHeight/2, 0.5]
    ].forEach(p=>{
        const pole = new THREE.Mesh(poleGeo,frameMat);
        pole.position.set(...p);
        rackGroup.add(pole);
    });
    //SHELVES+BOXES
    const shelfGeo = new THREE.BoxGeometry(4,0.12,1);
    const boxGeo = new THREE.BoxGeometry(0.5,0.4,0.6);
    for(let i=0;i<LEVEL_IDS.length;i++){
        const shelf = new THREE.Mesh(shelfGeo,shelfMat);
        shelf.position.y = 1+(LEVEL_IDS.length-1-i)*1.2;
        rackGroup.add(shelf);
        shelves.push(shelf);
        for(let j=0;j<BOX_COLUMNS;j++){
            const id = `${LEVEL_IDS[i]}${j+1}`;
            const boxMat = new THREE.MeshStandardMaterial({color:0xff0000});
            const box = new THREE.Mesh(boxGeo,boxMat);
            box.position.set(-1.2+j*0.8,shelf.position.y+0.3,0);
            rackGroup.add(box);
            // Labeling
            const canvas=document.createElement("canvas");
            canvas.width=128;
            canvas.height=64;
            const ctx=canvas.getContext("2d");
            ctx.fillStyle="white";
            ctx.fillRect(0,0,128,64);
            ctx.fillStyle="black";
            ctx.font="40px Arial";
            ctx.textAlign="center";
            ctx.textBaseline="middle";
            ctx.fillText(id,64,32);
            const texture=new THREE.CanvasTexture(canvas);
            const label=new THREE.Mesh( new THREE.PlaneGeometry(0.35,0.18), new THREE.MeshBasicMaterial({map:texture}) );
            label.position.set(0,0,0.31);
            box.add(label);
            boxObjects.push({ id:id, capacity:100, count:40, mesh:box });
        }
    }
    updateBoxes(boxObjects);
    return {rackGroup,shelves,boxObjects};
}
