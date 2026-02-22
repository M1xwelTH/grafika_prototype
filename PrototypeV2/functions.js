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
//Manual State
let manualBatch = []; // temp list for UI

//Manual Functions
function populateLocationDropdown(boxObjects)
{
    const select = document.getElementById("boxSelect");
    if(!select) return;
    select.innerHTML = "";
    boxObjects.forEach(box => {
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
        if(a.type !== b.type) return a.type === "order" ? -1 : 1; //Sort Order first
        return a.id.localeCompare(b.id); //Sort by ID
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

//Automated Restock Functions
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
    const batch = generateDeliveryBatch(boxObjects).map(item => ({ ...item, type: "restock" }));
    await executeBatch(batch, "auto");
}

//Automated Order Functions
function generateOrderBatch(boxObjects)
{
    const roll = Math.random();
    if(roll < 0.35){ return [{ id: "A1", qty: 10 }, { id: "B3", qty: 5 }]; } //Predef1 (35%)
    else if(roll < 0.5){ return [{ id: "B1", qty: 8 }, { id: "C2", qty: 4 }, { id: "D4", qty: 5 }]; } //Predef2 (15%)
    else if(roll < 0.8){ return [{ id: "C4", qty: 10 }, { id: "D1", qty: 2 }]; } //Predef3 (30%)
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
    boxObjects.forEach(box =>
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
    if(rackOccupied || arrivalWorker.busy) return;
    if(supplierQueue.length === 0) return;
    const task = supplierQueue.shift();
    await executeBatch([task], "auto");
    pendingSupplier.delete(task.id); //remove from array
}

//Order Execution Functions
async function executeBatch(batch, source)
{
    for(const task of batch)
    {
        const worker = task.type === "order" ? orderWorker : arrivalWorker;
        if(worker.busy || rackOccupied) return;
        await simulateSearch(worker, [task.id], boxObjects);
        const box = boxObjects.find(b => b.id === task.id);
        if(task.type === "order")
        {
            let fulfilled = 0;
            while(fulfilled < task.qty && box.count > 0) { box.count--; fulfilled++; }
            if(source === "manual") lastOrderSummary = `[MANUAL] ${fulfilled}/${task.qty} ${box.id}`;
            else lastOrderSummary = `${fulfilled}/${task.qty} ${box.id}`;
        }
        else
        {
            let space = box.capacity - box.count;
            let toStore = Math.min(space, task.qty);
            let overflow = task.qty - toStore;
            box.count += toStore;
            if(overflow > 0) overflowQueue.push({ id: box.id, qty: overflow });
            if(source === "manual") lastDeliverySummary = `[MANUAL] ${task.qty} ${box.id}`;
            else lastDeliverySummary = `${task.qty} ${box.id}`;
        }
        updateBoxes(boxObjects);
    }
}