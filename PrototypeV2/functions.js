//Overall Functions
/* 
Includes: Simulation State, Manual Order Functions, Automated Order Functions (inc. generated), Failsafe Functions, Order Exe Functions
Don't forget to change things to consumption (order) and restock (delivery and arrival) for readibility
*/


//Sim State
let simulationTime = 0;
let lastDeliverySummary = "None";
let lastOrderSummary = "None";
const overflowQueue = [];
function delay(ms){ return new Promise(res=>setTimeout(res,ms)); } //Delay Helper
function tickSimulation(delta){ simulationTime += delta; } //Runtime
//Manual State (For Testing)
let manualBatch = []; // temp list for UI

//Camera functions
let target = { x: 0, y: 0, z: 0 };
let radius = 10;
let yaw = 0;
let pitch = 0;
function updateCamera(camera) //helper
{
    camera.position.x = target.x + radius * Math.cos(pitch) * Math.sin(yaw);
    camera.position.y = target.y + radius * Math.sin(pitch);
    camera.position.z = target.z + radius * Math.cos(pitch) * Math.cos(yaw);
    camera.lookAt(target.x, target.y, target.z);
}
function camMovements(camera, renderer)
{
    const dom = renderer.domElement;
    let isDragging = false;
    let dragButton = null;
    let previousMousePosition = { x: 0, y: 0 };
    // Disable right-click menu
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
    dom.addEventListener("mousedown", (e) =>
    {
        isDragging = true;
        dragButton = e.button; //0 = left, 2 = right
        previousMousePosition = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener("mouseup", () => 
    {
        isDragging = false;
        dragButton = null;
    });
    dom.addEventListener("mousemove", (e) =>
    {
        if (!isDragging) return;
        const deltaMove =
        {
            x: e.clientX - previousMousePosition.x,
            y: e.clientY - previousMousePosition.y
        };
        //Panning using left click
        if (dragButton === 0)
        {
            const panSpeed = 0.01;
            target.x -= deltaMove.x * panSpeed;
            target.y += deltaMove.y * panSpeed;
            updateCamera(camera);
        }
        //Rotate using right click
        if (dragButton === 2)
        {
            const rotateSpeed = 0.005;
            yaw -= deltaMove.x * rotateSpeed;
            pitch -= deltaMove.y * rotateSpeed;
            pitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, pitch));
            updateCamera(camera);
        }
        previousMousePosition = { x: e.clientX, y: e.clientY };
    });
    //Zoom (In&Out, yum)
    dom.addEventListener("wheel", (e) =>
    {
        const zoomSpeed = 0.01;
        radius += e.deltaY * zoomSpeed;
        radius = Math.max(2, radius); //prevent going through target
        updateCamera(camera);
    });
}
const keys = {};
window.addEventListener("keydown", (e) => { keys[e.key.toLowerCase()] = true; });
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
function moveTarget(camera) //Move centre
{
    const moveSpeed = 0.1;
    //forward vector (camera -> target)
    let forward =
    {
        x: target.x - camera.position.x,
        y: 0,
        z: target.z - camera.position.z
    };
    //normalize
    const length = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
    forward.x /= length;
    forward.z /= length;
    //right vector
    let right =
    {
        x: forward.z,
        z: -forward.x
    };
    if (keys["arrowup"] || keys["w"])
    {
        target.x += forward.x * moveSpeed;
        target.z += forward.z * moveSpeed;
    }
    if (keys["arrowdown"] || keys["s"])
    {
        target.x -= forward.x * moveSpeed;
        target.z -= forward.z * moveSpeed;
    }
    if (keys["arrowright"] || keys["d"])
    {
        target.x -= right.x * moveSpeed;
        target.z -= right.z * moveSpeed;
    }
    if (keys["arrowleft"] || keys["a"])
    {
        target.x += right.x * moveSpeed;
        target.z += right.z * moveSpeed;
    }
    updateCamera(camera);
}

//Manual Functions (For Testing)
function populateLocationDropdown(boxObjects)
{
    const select = document.getElementById("boxSelect");
    if(!select) return;
    select.innerHTML = "";
    boxObjects.forEach(box =>
        {
        const option = document.createElement("option");
        option.value = box.id;
        option.textContent = box.id;
        select.appendChild(option);
    });
}
function addPick() //Consumption conf
{
    const select = document.getElementById("boxSelect");
    const qtyInput = document.getElementById("pickQty");
    const id = select.value;
    const qty = parseInt(qtyInput.value);
    if(!id || qty <= 0) return;
    manualBatch.push({ id, qty, type: "order" });
    renderManualList();
}
function addPick2() //Restock conf
{
    const select = document.getElementById("boxSelect");
    const qtyInput = document.getElementById("pickQty");
    const id = select.value;
    const qty = parseInt(qtyInput.value);
    if(!id || qty <= 0) return;
    manualBatch.push({ id, qty, type: "restock" });
    renderManualList();
}
function renderManualList()
{
    const container = document.getElementById("pickList");
    if(manualBatch.length === 0) { container.innerHTML = "Belum ada task"; return; }
    container.innerHTML = manualBatch .map((item, i) => `${i+1}. [${item.type.toUpperCase()}] ${item.id} - ${item.qty}` ) .join("<br>");
}
async function submitManualBatch()
{
    if(manualBatch.length === 0) return;
    if(rackOccupied) return;
    manualBatch.sort((a, b) =>
    {
        const rackA = parseInt(a.id.match(/^\d+/)[0]); //This is said to help with more than single digit int Rack ID
        const rackB = parseInt(b.id.match(/^\d+/)[0]);
        if(a.type !== b.type) return a.type === "order" ? -1 : 1; //Sort Order first
        if(rackA !== rackB) return rackA - rackB; //Sort by Rack ID
        return a.id.localeCompare(b.id); //Sort by Box ID
    });
    const analysis = analyzeBatch(manualBatch, boxObjects); //Analyze Batch in case meeting FailSafe situations
    if(analysis.willOverflow || analysis.willUnderflow)
    {
        const proceed = confirm(
            "Warning:\n" +
            (analysis.willOverflow ? "• Will cause overflow\n" : "") +
            (analysis.willUnderflow ? "• Will cause underflow\n" : "") +
            "\nProceed and activate failsafe protocol?"
        );
        if(!proceed) return;
    }
    const batchCopy = [...manualBatch];
    manualBatch = [];
    renderManualList();
    await executeBatch(batchCopy, "manual");
}

//Random Batch Generator
//Determine batch size (1-4 items per batch, weighted toward smaller batches)
function getRandomBatchSize()
{
    const roll = Math.random();
    if (roll < 0.4) return 1; //40% single-type item
    if (roll < 0.75) return 2; //35% two-type items
    if (roll < 0.9) return 3; //15% three-type items
    return 4; //10% four-type items
}
function generateRandomMultiTypeBatch(boxObjects, batchType = "order")
{
    const medicineBoxes = boxObjects.filter(box => box.type === 'medicine');
    const batchSize = getRandomBatchSize();
    //Randomly select N unique boxes
    const shuffled = [...medicineBoxes].sort(() => Math.random() - 0.5);
    const selectedBoxes = shuffled.slice(0, Math.min(batchSize, medicineBoxes.length));
    //Generate quantities based on batch type
    return selectedBoxes.map(box => (
    {
        id: box.id,
        qty: batchType === "order" 
            ? Math.floor(Math.random() * 12) + 1 //1-12 items
            : Math.floor(Math.random() * 15) + 5 //5-19 items for restock
    }));
}
function generateWeightedRandomBatch(boxObjects, batchType = "order")
{
    const medicineBoxes = boxObjects.filter(box => box.type === 'medicine');
    const batchSize = getRandomBatchSize();
    //Create weighted selection pool
    let candidates = medicineBoxes.map(box =>
    {
        let weight;
        if (batchType === "order") { weight = Math.max(1, 100 - box.count);} // Prefer low inventory
        else { weight = Math.max(1, box.capacity - box.count);} // Prefer empty space
        return { box, weight };
    });
    const batch = [];
    const used = new Set();
    //Pick N unique items with weighted probability
    for (let i = 0; i < batchSize && candidates.length > 0; i++)
    {
        const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
        let roll = Math.random() * totalWeight;
        for (const candidate of candidates)
        {
            if (roll < candidate.weight)
            {
                batch.push(
                {
                    id: candidate.box.id,
                    qty: batchType === "order" 
                        ? Math.floor(Math.random() * 12) + 1
                        : Math.floor(Math.random() * 15) + 5
                });
                used.add(candidate.box.id);
                candidates = candidates.filter(c => !used.has(c.box.id));
                break;
            }
            roll -= candidate.weight;
        }
    }
    return batch;
}

//Automated Restock Functions
function generateDeliveryBatch(boxObjects)
{
    //Prioritize supplier queue first
    if(supplierQueue.length > 0){ const supplierOrder = supplierQueue.shift(); return [{ id: supplierOrder.id, qty: supplierOrder.qty } ]; }
    //Otherwise do weighted normal delivery
    const selectedBox = generateWeightedRandomBatch(boxObjects, "restock");
    return selectedBox.length > 0 ? selectedBox : [{ id: boxObjects[0].id, qty: 10 }];
}
async function processDelivery(boxObjects)
{
    if(!workerPool.hasFreeWorker()) return;
    const batch = generateDeliveryBatch(boxObjects).map(item => ({ ...item, type: "restock" }));
    await executeBatch(batch, "auto");
}

//Automated Order Functions
function generateOrderBatch(boxObjects)
{
    /*
    const medicineBoxes = boxObjects.filter(box => box.type === 'medicine'); //Filter to medicine only
    const roll = Math.random();
    if(roll < 0.35){ return [{ id: "1A1", qty: 10 }, { id: "3B3", qty: 5 }]; } //Predef1 (35%)
    else if(roll < 0.5){ return [{ id: "1B1", qty: 8 }, { id: "1C2", qty: 4 }, { id: "1D4", qty: 5 }]; } //Predef2 (15%)
    else if(roll < 0.8){ return [{ id: "2C4", qty: 10 }, { id: "2D1", qty: 2 }]; } //Predef3 (30%)
    //Random Batch (20%)
    else
    {
        const randomBox = medicineBoxes[Math.floor(Math.random() * medicineBoxes.length)];
        const qty = Math.floor(Math.random() * 10) + 1;
        return [{ id: randomBox.id, qty: qty }];
    }
    */
    return generateWeightedRandomBatch(boxObjects, "order");
}
async function processOrder(boxObjects)
{
    if(!workerPool.hasFreeWorker()) return;
    const batch = generateOrderBatch(boxObjects).map(item => ({ ...item, type: "order" }));
    await executeBatch(batch, "auto");
}

//Failsafe Checker for Manual
function analyzeBatch(batch, boxObjects)
{
    let willOverflow = false;
    let willUnderflow = false;
    batch.forEach(task => {
        const box = boxObjects.find(b => b.id === task.id);
        if(task.type === "restock") { if(box.count + task.qty > box.capacity) willOverflow = true; }
        if(task.type === "order") { if(box.count - task.qty <= 10) willUnderflow = true; }
    });

    return { willOverflow, willUnderflow };
}
//FailSafe Overflow Restock
function processOverflow(boxObjects)
{
    if(!overflowQueue.length) return;
    const item = overflowQueue[0]; //look first
    const box = boxObjects.find(b=>b.id===item.id);
    if(box.count >= box.capacity) return;
    let space = box.capacity - box.count;
    let toStore = Math.min(space, item.qty);
    box.count += toStore;
    item.qty -= toStore;
    if(item.qty <= 0) {overflowQueue.shift(); console.log("Overflow queue left:", overflowQueue); }
}
//Failsafe Restock Functions
const supplierQueue = [];
const pendingSupplier = new Set(); //prevents duplicates
function checkReorderTriggers(boxObjects)
{
    const medicineBoxes = boxObjects.filter(box => box.type === 'medicine'); //Filter to medicine only
    medicineBoxes.forEach(box =>
    {
        if(box.count <= 10) //can be adjusted later, personally thinks 10 is good though
        {
            if(!pendingSupplier.has(box.id))
            {
                console.log(`[SUPPLIER ORDER] ${box.id} scheduled for +40`);
                supplierQueue.push({ id: box.id, qty: 40, type: "restock" });
                pendingSupplier.add(box.id);
            }
        }
    });
}
async function processSupplierQueue()
{
    if(!workerPool.hasFreeWorker()) return;
    if(supplierQueue.length === 0) return;
    const task = supplierQueue.shift();
    await executeBatch([task], "auto");
    pendingSupplier.delete(task.id); //remove from array
}

//Order Execution Functions
function groupTasksByRack(batch)
{
    const groups = {};
    batch.forEach(task =>
    {
        const match = task.id.match(/\d+/); //First number anywhere in the ID, handles "O1A1" too
        const rackNumber = match ? parseInt(match[0]) : null;
        if (rackNumber === null) { console.warn(`[BATCH] Could not parse rack from ID: ${task.id}`); return; }
        if (!groups[rackNumber]) { groups[rackNumber] = []; }
        groups[rackNumber].push(task);
    });
    return groups;
}
async function executeBatch(batch, source)
{
    if (!batch || batch.length === 0) return;
    const firstRack = parseInt(batch[0].id.match(/\d+/)[0]);
    const worker = workerPool.getNearestWorker(firstRack);
    if (!worker) { console.warn("[POOL] No free worker available"); return; }
    worker.busy = true;
    try
    {
        //Delivery flow: visit storage area first before going to any rack
        if (batch.some(t => t.type === "restock"))
        {
            const storagePos = new THREE.Vector3();
            storageArea.interactionArea.getWorldPosition(storagePos);
            worker.state = "Going to Storage";
            console.log(`[WORKER ${worker.id}] Heading to storage area`);
            await worker.moveToWorldPosition(storagePos.x, storagePos.z);
            worker.state = "At Storage";
            console.log(`[WORKER ${worker.id}] Waiting at storage (3s)`);
            await delay(3000);
        }
        const rackGroups  = groupTasksByRack(batch);
        const rackNumbers = Object.keys(rackGroups).sort((a, b) => a - b);
        for (const rackNumber of rackNumbers)
        {
            const tasks = rackGroups[rackNumber];
            //Lock this rack while a worker is on it
            if (!workerPool.isRackFree(Number(rackNumber)))
            {
                //Another worker is already on this rack — wait and retry
                while (!workerPool.isRackFree(Number(rackNumber)))
                {
                    console.warn(`[WORKER ${worker.id}] Rack ${rackNumber} busy, waiting...`);
                    await delay(500); //Shorter poll, only one worker proceeds since lockRack is called immediately on exit
                }
                workerPool.lockRack(Number(rackNumber));
            }
            workerPool.lockRack(Number(rackNumber));
            try
            {
                //Move worker to the rack (skipped automatically if already there)
                await worker.moveToRack(Number(rackNumber));
                //Pull the rack-local box objects for traversal
                const rackBoxes = boxObjects.filter(b => b.rack === Number(rackNumber));
                const ids = tasks.map(t => t.id);
                await worker.searchAndInteract(ids, rackBoxes);
                //Apply stock changes after the physical interaction is done
                for (const task of tasks)
                {
                    const box = boxObjects.find(b => b.id === task.id);
                    if (!box) continue;
                    if (task.type === "order")
                    {
                        const fulfilled = Math.min(task.qty, box.count);
                        box.count -= fulfilled;
                    }
                    else //restock
                    {
                        const space = box.capacity - box.count;
                        const toStore = Math.min(space, task.qty);
                        const overflow = task.qty - toStore;
                        box.count += toStore;
                        if (overflow > 0) overflowQueue.push({ id: box.id, qty: overflow });
                    }
                }
                updateBoxes(boxObjects); //refresh gradient colors
            }
            finally { workerPool.unlockRack(Number(rackNumber)); }
        }
    }
    finally { worker.busy = false; }
}