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
const IDLE_SLOTS = //Open spaces for waiting
[
    { x: -3, z: 11 }, //worker 1, starting position
    { x: -18, z: 7 }, //worker 2, mid-left open floor
    { x: -14, z: 10 }, //worker 3, centre-left open floor
    { x: 5, z: 12 }, //worker 4, near starting position
];

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

/*
//Automated Order Functions
function generateOrderBatch(boxObjects) { return generateWeightedRandomBatch(boxObjects, "order"); }
async function processOrder(boxObjects)
{
    if(!workerPool.hasFreeWorker()) return;
    const batch = generateOrderBatch(boxObjects).map(item => ({ ...item, type: "order" }));
    await executeBatch(batch, "auto");
}
*/

//Outbound, advanced version of order
function getInteractionPos(interactionArea) //Outbound Helper: get world position of any single interactionArea mesh
{
    const pos = new THREE.Vector3();
    interactionArea.getWorldPosition(pos);
    return pos;
}
async function processOutbound(allBoxes)
{
    if (!workerPool.hasFreeWorker()) return;
    const roll = Math.random();
    const flowType = roll < 0.4 ? 'desk' : roll < 0.8 ? 'counter' : 'outbound_to_counter';
    //Flow 3: Outbound (3s) → Counter (5s), no rack visit — handled separately
    if (flowType === 'outbound_to_counter')
    {
        const worker = workerPool.getNearestWorker(1);
        if (!worker) return;
        worker.busy = true;
        try
        {
            while (!workerPool.isAreaFree('outbound')) { await delay(500); }
            workerPool.lockArea('outbound');
            try
            {
                const outboundPos = getInteractionPos(outboundRack.interactionArea);
                worker.state = "Going to Outbound";
                await worker.moveToWorldPosition(outboundPos.x, outboundPos.z);
                worker.state = "At Outbound";
                await delay(3000);
                dataCollector.logEvent("retrieval", worker.id, "take medicine pack", []);
                const idlePos = IDLE_SLOTS[(worker.id - 1) % IDLE_SLOTS.length];
                await moveAroundStaging(worker, idlePos.x, idlePos.z);
            }
            finally { workerPool.unlockArea('outbound'); }
            while (!workerPool.isAreaFree('counter')) { await delay(500); }
            workerPool.lockArea('counter');
            try
            {
                const counterPos = getInteractionPos(counter.interactionArea);
                worker.state = "Going to Counter";
                await worker.moveToWorldPosition(counterPos.x, counterPos.z);
                worker.state = "At Counter";
                worker._passableAt = performance.now() + 2000;
                await delay(5000);
                worker._passableAt = null;
                dataCollector.logEvent("retrieval", worker.id, "give medicine pack", []);
                const idlePos = IDLE_SLOTS[(worker.id - 1) % IDLE_SLOTS.length];
                worker.state = "Returning to Idle";
                await moveAroundStaging(worker, idlePos.x, idlePos.z);
                worker.state = "Idle";
            }
            finally { workerPool.unlockArea('counter'); }
        }
        finally { worker.busy = false; }
        return;
    }

    //Flows 1 & 2: Desk/Counter (5s) → Rack → Staging (items * 2s) → Outbound (3s)
    const batch = generateWeightedRandomBatch(allBoxes, "order").map(item => ({ ...item, type: "order" }));
    if (!batch || batch.length === 0) return;
    const label = flowType === 'desk' ? 'Desk' : 'Counter';
    const flowLabel = flowType === 'desk' ? 'outflow 1' : 'outflow 2';
    const batchIds = batch.map(t => t.id);
    console.log(`[POOL] Flow ${flowType === 'desk' ? 1 : 2}: ${label} → Rack → Staging → Outbound`);
    await executeBatch(batch, "outbound",
    {
        flowLabel: flowLabel,
        preRack: async (worker) =>
        {
            const areaKey = flowType === 'desk' ? 'desk' : 'counter';
            const areaIA  = flowType === 'desk' ? desk.interactionArea : counter.interactionArea;
            while (!workerPool.isAreaFree(areaKey)) { await delay(500); }
            workerPool.lockArea(areaKey);
            try
            {
                const startPos = getInteractionPos(areaIA);
                worker.state = `Going to ${label}`;
                if (flowType === 'desk')
                {
                    //Always approach desk from south — desk collision zone starts at z=10.45
                    //Step to z=9 at current X, align X to desk IA, then ascend to desk
                    if (Math.abs(worker.position.z - 9) > 1)
                    { await moveAroundStaging(worker, worker.position.x, 9); }
                    await worker.moveToWorldPosition(startPos.x, 9);
                    await worker.moveToWorldPosition(startPos.x, startPos.z);
                }
                else { await worker.moveToWorldPosition(startPos.x, startPos.z); }
                worker.state = `At ${label}`;
                worker._passableAt = performance.now() + 2000;
                await delay(5000);
                await worker.moveToWorldPosition(12, 8); //pinpoint to guard against wall issue
                await waitDoorwayExit(worker);
                worker._passableAt = null;
                const orderActivity = flowType === 'desk' ? "receiving order online" : "receiving order from counter";
                dataCollector.logEvent(flowLabel, worker.id, orderActivity, batchIds);
            }
            finally { workerPool.unlockArea(areaKey); }
        },
        postRack: async (worker, batch) =>
        {
            // Wait for nearest free staging slot
            let stagingSlot = null;
            while (!stagingSlot)
            {
                stagingSlot = workerPool.getNearestFreeStagingIA(worker);
                if (!stagingSlot) { await delay(500); }
            }
            workerPool.lockArea(stagingSlot.key);
            try
            {
                worker.state = "Going to Staging";
                await moveAroundStaging(worker, stagingSlot.pos.x, stagingSlot.pos.z);
                worker.state = "At Staging";
                worker._passableAt = performance.now() + 3000; //passable after 3s, shorter since staging is long
                console.log(`[WORKER ${worker.id}] Staging wait: ${batch.length} item(s) x 2s`);
                await delay(batch.length * 2000);
                worker._passableAt = null;
                dataCollector.logEvent(flowLabel, worker.id, "medicine pack organized", batchIds);
            }
            finally { workerPool.unlockArea(stagingSlot.key); }
            // Outbound rack
            while (!workerPool.isAreaFree('outbound')) { await delay(500); }
            workerPool.lockArea('outbound');
            try
            {
                const outboundPos = getInteractionPos(outboundRack.interactionArea);
                worker.state = "Going to Outbound";
                await moveAroundStaging(worker, outboundPos.x, outboundPos.z);
                worker.state = "At Outbound";
                await delay(3000);
                dataCollector.logEvent(flowLabel, worker.id, "placing pack on outbound", batchIds);
                const idlePos = IDLE_SLOTS[(worker.id - 1) % IDLE_SLOTS.length];
                await moveAroundStaging(worker, idlePos.x, idlePos.z);
            }
            finally { workerPool.unlockArea('outbound'); }
        }
    });
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
async function executeBatch(batch, source, flowContext = null)
{
    if (!batch || batch.length === 0) return;
    const firstRack = parseInt(batch[0].id.match(/\d+/)[0]);
    const worker = workerPool.getNearestWorker(firstRack);
    if (!worker) { console.warn("[POOL] No free worker available"); return; }
    worker.busy = true;
    //Data Collection
    const flowLabel = flowContext?.flowLabel ?? (batch.some(t => t.type === "restock") ? "inbound" : "outflow");
    const batchIds = batch.map(t => t.id);
    dataCollector.logEvent(flowLabel, worker.id, "flow received", batchIds);
    try
    {
        //Pre-rack hook: outbound flows pass their desk/counter visit here
        //Default: delivery flow visits storage area
        if (flowContext?.preRack) { await flowContext.preRack(worker); }
        else if (batch.some(t => t.type === "restock"))
        {
            const storagePos = getInteractionPos(storageArea.interactionArea);
            const storageWaypoints = getStorageWaypoints(storagePos.x, storagePos.z);
            worker.state = "Going to Storage";
            if (worker.position.x < -5) //Avoid stuck at staging area
            {
                const bypassZ = worker.position.z >= 0 ? 7 : -7;
                await moveAroundStaging(worker, 0, bypassZ);
            }
            await moveAroundStaging(worker, DOOR_WAIT.x, DOOR_WAIT.z);
            //Now poll — leaving workers still need to fully clear DOOR_OUTSIDE before we proceed
            const doorwaitStart = simulationTime;
            await doorwayManager.requestEnter(worker);
            if (simulationTime - doorwaitStart > 0.3) dataCollector.logEvent(flowLabel, worker.id, "doorway wait done", batchIds);
            try
            {
                //Cross DOOR_OUTSIDE → DOOR_INSIDE — doorway is now confirmed empty
                await followWaypointsWithTimeout(worker, storageWaypoints.slice(0, 2), 8000);
            }
            finally { doorwayManager.finishEntering(); }
            //Reach storage, do work
            await worker.followWaypoints(storageWaypoints.slice(2, 3));
            const storageIAWorldPos = new THREE.Vector3();
            storageArea.interactionArea.getWorldPosition(storageIAWorldPos);
            while (!isWorkerFullyInsideArea(worker.position, storageIAWorldPos, 5, 5))
            { await delay(16); }
            worker.state = "At Storage";
            await delay(3000);
            dataCollector.logEvent(flowLabel, worker.id, "took stocks from storage", batchIds);
            //Register as leaving, then cross back out
            doorwayManager.startLeaving();
            //Waypoints [3] DOOR_INSIDE → [4] DOOR_OUTSIDE
            await followWaypointsWithTimeout(worker, storageWaypoints.slice(3), 8000);
            worker._moveDeadline = performance.now() + 6000;
            await worker.moveToWorldPosition(9, DOOR_OUTSIDE.z - 4); //Waiting point outside, clear doorway
            worker._moveDeadline = null;
            doorwayManager.finishLeaving();
        }
        //Rack loop
        const rackGroups = groupTasksByRack(batch);
        const rackNumbers = Object.keys(rackGroups).sort((a, b) => a - b);
        for (const rackNumber of rackNumbers)
        {
            const tasks = rackGroups[rackNumber];
            // Poll until free — no lock held yet so we don't block ourselves
            let hadToWait = false;
            while (!workerPool.isRackFree(Number(rackNumber)))
            {
                hadToWait = true;
                if (worker.state !== `Waiting Rack ${rackNumber}`)
                {
                    //Pick slot by worker ID so workers spread out, not cluster
                    const slot = IDLE_SLOTS[(worker.id - 1) % IDLE_SLOTS.length];
                    await moveAroundStaging(worker, slot.x, slot.z);
                    worker.state = `Waiting Rack ${rackNumber}`;
                }
                console.warn(`[WORKER ${worker.id}] Rack ${rackNumber} busy, waiting...`);
                await delay(500);
            }
            if (hadToWait) dataCollector.logEvent(flowLabel, worker.id, `rack ${rackNumber} wait done`, batchIds);
            //Lock immediately when free — before any await that could let another worker in
            workerPool.lockRack(Number(rackNumber));
            try
            {
                dataCollector.logEvent(flowLabel, worker.id, `arrived rack ${rackNumber}`, batchIds);
                await worker.moveToRack(Number(rackNumber));
                const rackBoxes = boxObjects.filter(b => b.rack === Number(rackNumber) && b.type === 'medicine');
                const ids = tasks.map(t => t.id);
                await worker.searchAndInteract(ids, rackBoxes);
                dataCollector.logEvent(flowLabel, worker.id, `left rack ${rackNumber}`, batchIds);
                worker._passableAt = performance.now() + 3000;
                await delay(1000);
                const isLastRack = rackNumbers.indexOf(rackNumber) === rackNumbers.length - 1;
                if (!isLastRack)
                {
                    //More racks remain — just clear the corridor so incoming worker can reach this rack
                    await worker.moveToWorldPosition(worker.position.x, -7);
                }
                //await delay(1000);
                worker._passableAt = null;
                for (const task of tasks)
                {
                    const box = boxObjects.find(b => b.id === task.id);
                    if (!box) continue;
                    if (task.type === "order") { box.count -= Math.min(task.qty, box.count); }
                    else
                    {
                        const space = box.capacity - box.count;
                        const toStore = Math.min(space, task.qty);
                        const overflow = task.qty - toStore;
                        box.count += toStore;
                        if (overflow > 0) overflowQueue.push({ id: box.id, qty: overflow });
                    }
                }
                updateBoxes(boxObjects);
            }
            finally { workerPool.unlockRack(Number(rackNumber)); }
        }
        //Log rack activities after all racks are done
        if (batch.some(t => t.type === "restock"))
        {dataCollector.logEvent(flowLabel, worker.id, "restock medicine racks", batchIds);}
        else
        {dataCollector.logEvent(flowLabel, worker.id, "took medicine from racks", batchIds);}
        //Post-rack hook: outbound flows pass their staging + outbound visit here
        if (flowContext?.postRack) { await flowContext.postRack(worker, batch); }
        if (!flowContext?.postRack)
        {
            const idlePos = IDLE_SLOTS[(worker.id - 1) % IDLE_SLOTS.length];
            worker.state = "Returning to Idle";
            await moveAroundStaging(worker, idlePos.x, idlePos.z);
            worker.state = "Idle";
        }
    }
    finally { worker.busy = false; }
}
