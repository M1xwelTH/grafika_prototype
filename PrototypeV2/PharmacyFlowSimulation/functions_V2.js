//functions_temp2.js
//Includes most things related to flows of outbounds and inbound, including batching and customer
//All movement calls delegate to movement.js.
//  moveWorkerToIA(worker, key)  — for all IA destinations (desk, counter, staging_N, outbound, rack_N)
//                                 sets worker.state labels and worker.currentRack automatically
//  moveTo(worker, x, z)        — for non-IA destinations only (corridor waypoints)
//  returnToIdle(worker)        — dynamic post-task idle scatter via BFS
//  runStorageTrip(...)          — full storage round trip
//No routing logic here — only task orchestration.

//Sim State
const SIM_SPEED = 60; //Time scaling, 1 sim sec = 1 IRL min
const CUSTOMER_TRAVEL_MIN_SIM_MIN = 3; //Fastest a customer can arrive after being told to wait
const CUSTOMER_TRAVEL_MAX_SIM_MIN = 20; //Slowest — some customers take a while to get there
const PEAK_HOURS_SIM_MIN = 60;  //1 simulated hour of peak pressure
const PEAK_HOURS_IRL_MS = (PEAK_HOURS_SIM_MIN / SIM_SPEED) * 60 * 1000; //Actual simulated time, 60000ms
function simDelay(irl_ms) { return delay(irl_ms / SIM_SPEED); }
// Pending queue timeout — 60 IRL min (60 sim-sec) — flow expires if no worker picks it up
const PENDING_TIMEOUT_SIM_S  = 60;
const PENDING_TIMEOUT_IRL_MS = (PENDING_TIMEOUT_SIM_S / SIM_SPEED) * 60 * 1000; //Actual simulated time, 60000ms
// Waiting room timeout — 45 IRL min (45 sim-sec) — customer gives up if not served in time
const WAITROOM_TIMEOUT_SIM_S  = 45;
const WAITROOM_TIMEOUT_IRL_MS = (WAITROOM_TIMEOUT_SIM_S / SIM_SPEED) * 60 * 1000; //Actual simulated time, 45000ms
const AREA_LOCK_TIMEOUT = 25000; //25 seconds IRL — if an area lock is held longer than this, log a warning and force-release to prevent bug
const FLOW_WEIGHTS =
{
    'outflow_1': 40, //desk --> rack --> staging --> outbound
    'outflow_2': 40, //counter --> rack --> staging --> outbound
    'retrieval': 5, //outbound rack --> counter (special call in place already)
    'inbound': 20, //storage --> rack restock
    'pack_return': 5, //outbound --> storage (not urgent, will have it's own enqueue at some point after abandonment)
    //'emergency_restock': 999, //not a real flow type, but used as a trigger for some, see checkReorderTriggers()
};
const PREDEFINED_BATCHES = [
    // Profile 1 — Daily consumption A (painkillers, other common pills/remedies, etc.) (30%)
    { weight: 30, items: [
        { id: "2B1", qty: 14 },
        { id: "3A2", qty: 12 },
        { id: "1C3", qty: 10 },
    ]},
    // Profile 2 — Daily consumption B (vitamines, etc.) (30%)
    { weight: 30, items: [
        { id: "4D2", qty: 8 },
        { id: "2A4", qty: 14 },
    ]},
    // Profile 3 — Respiratory medication (10%)
    { weight: 10, items: [
        { id: "7B3", qty:  1 }, // inhaler/device
        { id: "6A1", qty: 14 },
        { id: "1D1", qty: 14 },
    ]},
    // Profile 4 — Medicine packages A (10%)
    { weight: 10, items: [
        { id: "3C4", qty: 14 },
        { id: "4B2", qty: 8 },
        { id: "6D3", qty: 8 },
    ]},
    // Profile 5 — Medicine packages B (10%)
    { weight: 10, items: [
        { id: "5C2", qty: 14 },
        { id: "5A3", qty: 14 },
    ]},
    // Profile 6 — Uncommon high dosage medications (5%)
    { weight: 5, items: [
        { id: "1B4", qty: 14 },
        { id: "2C1", qty: 8 },
    ]},
    // Profile 7 — Rare low dosage medications (4%)
    { weight: 4, items: [
        { id: "8A2", qty: 1 }, // device/rare
        { id: "8C1", qty: 2 }, // rare low dose
    ]},
    // Profile 8 — Very rare medications (1%)
    { weight: 1, items: [
        { id: "7D1", qty: 1 }, // device/rare
    ]},
];

// Enqueues a single random flow type, with probabilities derived from FLOW_WEIGHTS.
// Replaces the hardcoded if/else chain in the HTML enqueue interval.
function enqueueWeightedRandom()
{
    const types = Object.keys(FLOW_WEIGHTS);
    const total = types.reduce((sum, t) => sum + FLOW_WEIGHTS[t], 0);
    let roll = Math.random() * total;
    for (const type of types)
    {
        roll -= FLOW_WEIGHTS[type];
        if (roll <= 0)
        {
            if (type === 'outflow_1') return enqueueOutflow1();
            if (type === 'outflow_2') return enqueueOutflow2();
            if (type === 'inbound')   return enqueueInbound();
            //pack_return and retrieval are intentionally excluded — they have their own self-enqueue calls
        }
    }
    // Floating point fallback
    enqueueOutflow1();
}
let lastDeliverySummary = "None";
let lastOrderSummary = "None";
const overflowQueue = [];
function delay(ms){ return new Promise(res=>setTimeout(res,ms)); }

//Populate boxes
function populateLocationDropdown(boxObjects)
{
    const select = document.getElementById("boxSelect");
    if(!select) return;
    select.innerHTML = "";
    boxObjects.forEach(box =>{
        const option = document.createElement("option");
        option.value = box.id;
        option.textContent = box.id;
        select.appendChild(option);
    });
}

//Flow Queue
class FlowQueue
{
    constructor()
    {
        this._queue   = [];   // { id, flowType, batch, enqueuedAt, status }
        this._counter = 0;
        this._failed  = [];   // archived expired entries, useful for export
    }
    // Enqueue a new flow request.
    // flowType  — one of: 'outflow_1' | 'outflow_2' | 'retrieval' | 'inbound'
    // batch     — array of task objects (may be null for retrieval/generated-on-dispatch flows)
    enqueue(flowType, batch = null)
    {
        const entry =
        {
            id: ++this._counter,
            flowType,
            batch,
            enqueuedAt: performance.now(),
            status: 'pending', // pending | dispatched | failed
        };
        this._queue.push(entry);
        console.log(`[FLOWQ] #${entry.id} queued — type: ${flowType}, batch: ${batch ? batch.map(t=>t.id).join(',') : 'auto'}`);
        return entry.id;
    }
    //Purge any entries that have exceeded the timeout and log them as failed.
    expireStale()
    {
        const now = performance.now();
        this._queue = this._queue.filter(entry => {
            if (entry.status !== 'pending') return true; //already dispatched, keep until removed
            const age = now - entry.enqueuedAt;
            if (age > PENDING_TIMEOUT_IRL_MS && entry.flowType !== 'inbound' && entry.flowType !== 'pack_return')
            {
                entry.status = 'failed';
                this._failed.push(entry);
                console.warn(`[FLOWQ] #${entry.id} EXPIRED — ${entry.flowType} waited ${(age/1000).toFixed(1)}s IRL / ${(age/1000 * SIM_SPEED / 60).toFixed(1)} sim-min`);
                dataCollector.logEvent(entry.flowType, null, 'flow expired — not fulfilled in time', entry.batch ? entry.batch.map(t=>t.id) : []);
                return false; // remove from active queue
            }
            return true;
        });
    }
    // Register a flow as active when dispatched.
    // workerId — the worker.id assigned to handle it
    trackActive(id, flowType, workerId)
    {
        this._active = this._active ?? new Map();
        this._active.set(id, {
            id,
            flowType,
            workerId,
            stage: 'dispatched',       // updated as flow progresses
            dispatchedAt: performance.now(),
        });
    }
    // Update the stage label of an active flow.
    // Call this at each meaningful step inside dispatchNextFlow / executeBatch.
    setStage(id, stage)
    { if (!this._active?.has(id)) return; this._active.get(id).stage = stage; }
    // Remove from active tracking when the flow fully completes or is abandoned.
    untrackActive(id) { this._active?.delete(id); }
    // How long an active flow has been running, in sim-minutes
    _activeAgeSimMin(entry) { return ((performance.now() - entry.dispatchedAt) / 1000 * SIM_SPEED / 60).toFixed(1); }
    //Pick the next pending entry to dispatch, weighted by FLOW_WEIGHTS.
    //Returns the entry object (still marked 'pending') or null if nothing is pending.
    pickNext()
    {
        this.expireStale();
        const pending = this._queue.filter(e => e.status === 'pending');
        if (pending.length === 0) return null;
        //Retrieval priority
        const pendingRetrieval = pending.find(e => e.flowType === 'retrieval');
        if (pendingRetrieval && getNextEligibleCustomer(outboundRack.boxObjects))
        return pendingRetrieval;
        //Emergency restock (stock critically low)
        const pendingEmergency = pending.find(e => e.flowType === 'emergency_restock');
        if (pendingEmergency) return pendingEmergency;
        //Build weighted pool from pending entries.
        const totalWeight = pending.reduce((sum, e) => sum + (FLOW_WEIGHTS[e.flowType] ?? 1), 0);
        let roll = Math.random() * totalWeight;
        for (const entry of pending)
        {
            roll -= (FLOW_WEIGHTS[entry.flowType] ?? 1);
            if (roll <= 0) return entry;
        }
        return pending[pending.length - 1]; //fallback (floating point edge)
    }
    //Mark an entry as dispatched and remove it from the active queue.
    markDispatched(id)
    {
        const idx = this._queue.findIndex(e => e.id === id);
        if (idx !== -1) this._queue.splice(idx, 1);
    }
    get pendingCount() { return this._queue.filter(e => e.status === 'pending').length; }
    get failedCount()  { return this._failed.length; }
    //UI-friendly summary
    getStatusHTML()
    {
        let html = '';
        // Active (dispatched, in progress)
        if (this._active?.size > 0)
        {
            html += this._active.size === 1 ? '<em>1 active:</em><br>' : `<em>${this._active.size} active:</em><br>`;
            this._active.forEach(e => {
                const age = this._activeAgeSimMin(e);
                html += `#${e.id} [${e.flowType}] W${e.workerId} — ${e.stage} (${age}sim-min)<br>`;
            });
        }
        // Pending (waiting to be dispatched)
        const pending = this._queue.filter(e => e.status === 'pending');
        if (pending.length > 0)
        {
            html += pending.length === 1 ? '<em>1 pending:</em><br>' : `<em>${pending.length} pending:</em><br>`;
            pending.forEach(e => {
                const ageSimS = ((performance.now() - e.enqueuedAt) / 1000 * SIM_SPEED / 60).toFixed(1);
                const remaining = Math.max(0, PENDING_TIMEOUT_SIM_S - ageSimS).toFixed(1);
                html += `#${e.id} [${e.flowType}] waiting ${ageSimS}sim-min — ${remaining}sim-min left<br>`;
            });
        }
        if (!html) return '<em>Queue empty</em>';
        return html;
    }
    // Reset between simulation runs
    clear()
    {
        this._queue  = [];
        this._failed = [];
        this._active = new Map();
        this._counter = 0;
    }
}
const flowQueue = new FlowQueue(); //Global instance

// ============================================================
// Customer System
// ============================================================
//location:  'external'     — not yet at the pharmacy
//           'waiting_room' — physically present, waiting to be called
//status:    'waiting'      — order being fulfilled
//           'being_served' — worker has called them, now at counter
//           'done'         — medicine handed over, remove from queue
class Customer
{
    constructor(id, orders)
    {
        this.id = id; //Unique customer/order ID
        this.orders = orders; //Array of medicine box IDs, e.g. ["1A1","2B3"]
        this.location = 'external'; //Start outside until they are told to come in
        this.status = 'waiting';
        this.waitTimer = null; //performance.now() timestamp when wait interval started
        this.flowType = null; //Which outflow created this customer ('outflow_1'|'outflow_2')
        this._arrivalTimeout = null;
        this._waitroomTimeout = null;
        this.pendingTimer = performance.now(); //Starts at creation — this is the pending clock
        this.pendingDuration = null; //Set when pending phase ends — freezes the measurement
        this._pendingTimeout = null;
        this.serviceTimer = null; //Set when order confirmed at desk/counter — total fulfillment clock
        this.serviceDuration = null; //Frozen when medicine handed over — total service time
    }
    //Called by outflow_1 preRack: customer is NOT in waiting room yet.
    //Their wait interval starts immediately when the desk worker finishes.
    startWaitExternal()
    {
        this.serviceTimer = performance.now(); //Service clock starts at order confirmation
        //Random travel time — customer makes their own way to the waiting room independently
        const travelSimMin = CUSTOMER_TRAVEL_MIN_SIM_MIN + Math.random() * (CUSTOMER_TRAVEL_MAX_SIM_MIN - CUSTOMER_TRAVEL_MIN_SIM_MIN);
        const travelIrlMs = (travelSimMin / SIM_SPEED) * 60 * 1000;
        this._arrivalTimeout = setTimeout(() => { if (this.status === 'waiting') this.arrive(); }, travelIrlMs);
        console.log(`[CUSTOMER ${this.id}] Wait started (external — arriving in ~${travelSimMin.toFixed(1)} sim-min)`);
        dataCollector.logCustomer(this, 'online order processed via desk');
    }
    //Called by outflow_2 preRack: customer IS already in the waiting room.
    //Their wait interval began when they arrived, passed in as a timestamp.
    startWaitInWaitingRoom(arrivedAt)
    {
        this.location = 'waiting_room';
        this.waitTimer = arrivedAt; //Physical arrival clock — customer already present
        this.serviceTimer = arrivedAt; //Service clock — starts simultaneously for outflow_2
        this.startWaitTimeout(); //Begin the waiting room countdown
        console.log(`[CUSTOMER ${this.id}] Wait started (in waiting room — timer backdated)`);
        dataCollector.logCustomer(this, 'ordered in counter, begin waiting');
    }
    //Starts the waiting room countdown — customer gives up after WAITROOM_TIMEOUT_IRL_MS
    startWaitTimeout()
    {
        if (this._waitroomTimeout) return; // Guard: don't start twice
        this._waitroomTimeout = setTimeout(() => {
            if (this.status === 'waiting')
            {
                this.status = 'abandoned';
                dataCollector.logEvent(this.flowType, null,
                    `customer #${this.id} abandoned — waited ${this.waitSimMin().toFixed(1)} sim-min`,
                    this.orders);
                console.warn(`[CUSTOMER ${this.id}] Abandoned, waited too long in waiting room`);
                dataCollector.logCustomer(this, 'abandoned order'); //Failed flow, logged to see which failed and time spent in flow
                customerQueue.remove(this.id); enqueuePackReturn();
            }
        }, WAITROOM_TIMEOUT_IRL_MS);
    }
    //Starts the pending countdown — customer gives up if not served within PENDING_TIMEOUT_IRL_MS
    startPendingTimeout()
    {
        if (this._pendingTimeout) return;
        this._pendingTimeout = setTimeout(() => {
            if (this.status === 'waiting' && this.location === 'external')
            {
                this.status = 'expired';
                //Failed flow, logged to see unattended flows
                dataCollector.logCustomer(this, 'order expired — never reached desk/counter');
                console.warn(`[CUSTOMER ${this.id}] Expired — pending too long`);
                customerQueue.remove(this.id); enqueuePackReturn();
            }
        }, PENDING_TIMEOUT_IRL_MS);
    }
    //How long has this customer been waiting, in sim-minutes
    waitSimMin()
    {
        if (this.waitTimer === null) return 0;
        return ((performance.now() - this.waitTimer) / 1000 * SIM_SPEED / 60);
    }
    serviceSimMin()
    {
        if (this.serviceDuration !== null) return (this.serviceDuration / 1000 * SIM_SPEED / 60);
        if (this.serviceTimer === null) return 0;
        return ((performance.now() - this.serviceTimer) / 1000 * SIM_SPEED / 60);
    }
    //Mark customer as arrived at waiting room (called externally when they walk in)
    arrive()
    {
        if (this.location === 'waiting_room') return; //Guardrail, avoids duplicate
        this.location = 'waiting_room';
        this.waitTimer = performance.now();
        this.startWaitTimeout(); //Begin the waiting room countdown for outflow1
        console.log(`[CUSTOMER ${this.id}] Arrived at waiting room`);
        dataCollector.logCustomer(this, 'arrived at waiting room');
    }
    //Called when the retrieval worker is about to go to the counter
    call()
    {
        this.status = 'being_served';
        console.log(`[CUSTOMER ${this.id}] Called to counter`);
        dataCollector.logCustomer(this, 'picking up order at counter');
    }
    //Called when medicine has been handed over
    complete()
    {
        this.status = 'done';
        this.serviceDuration = this.serviceTimer !== null ? performance.now() - this.serviceTimer : null;
        if (this._arrivalTimeout) { clearTimeout(this._arrivalTimeout);  this._arrivalTimeout  = null; }
        if (this._waitroomTimeout) { clearTimeout(this._waitroomTimeout); this._waitroomTimeout = null; }
        if (this._pendingTimeout) { clearTimeout(this._pendingTimeout); this._pendingTimeout = null; }
        console.log(`[CUSTOMER ${this.id}] Order complete — served after ${this.waitSimMin().toFixed(1)} sim-min`);
        dataCollector.logCustomer(this, 'order completed');
    }
    //UI-friendly summary string
    getStatusText()
    {
        const waited    = this.waitSimMin().toFixed(1);
        const serviced  = this.serviceSimMin().toFixed(1);
        const waitRemaining = this.location === 'waiting_room' && this.status === 'waiting'
            ? ` — ${Math.max(0, WAITROOM_TIMEOUT_SIM_S - this.waitSimMin()).toFixed(1)}sim-min left`
            : '';
        const pendingDisplay = this.location === 'external' && this.status === 'waiting'
            ? ` — pending ${((performance.now() - this.pendingTimer) / 1000 * SIM_SPEED / 60).toFixed(1)}/${PENDING_TIMEOUT_SIM_S}sim-min`
            : '';
        return `#${this.id} [${this.flowType ?? '?'}] loc:${this.location} status:${this.status}
            svc:${serviced}sim-min waited:${waited}sim-min${waitRemaining}${pendingDisplay}`;
    }
}
class CustomerQueue
{
    constructor()
    {
        this._queue  = [];
        this._counter = 0;
    }
    //Create and enqueue a new customer, returns the Customer instance
    add(orders, flowType)
    {
        const customer = new Customer(++this._counter, orders);
        customer.flowType = flowType;
        this._queue.push(customer);
        customer.startPendingTimeout(); //Customer starts pending countdown immediately upon creation
        console.log(`[CUSTOMERQ] #${customer.id} added — orders: ${orders.join(', ')} via ${flowType}`);
        dataCollector.logCustomer(customer, 'created');
        return customer;
    }
    //Find the customer whose outbound slot is ready to be retrieved
    //First customer in 'waiting' status whose location is 'waiting_room'
    getNextForRetrieval()
    { return this._queue.find(c => c.status === 'waiting' && c.location === 'waiting_room') ?? null; }
    //Remove a completed customer from the active queue
    remove(customerId)
    {
        const idx = this._queue.findIndex(c => c.id === customerId);
        if (idx !== -1) this._queue.splice(idx, 1);
    }
    //UI summary for HUD
    getStatusHTML()
    {
        if (this._queue.length === 0) return '<em>No active customers</em>';
        return this._queue.map(c => c.getStatusText()).join('<br>');
    }
    get activeCount() { return this._queue.length; }
    clear()
    {
        this._queue.forEach(c => {
            if (c._arrivalTimeout) { clearTimeout(c._arrivalTimeout); c._arrivalTimeout = null; }
            if (c._waitroomTimeout) { clearTimeout(c._waitroomTimeout); c._waitroomTimeout = null; }
            if (c._pendingTimeout) { clearTimeout(c._pendingTimeout); c._pendingTimeout = null; }
        });
        this._queue = []; this._counter = 0;
    }
}
const customerQueue = new CustomerQueue(); //Global instance

//Batch Generators
function getRandomBatchSize()
{
    const roll = Math.random();
    if (roll < 0.40) return 1;
    if (roll < 0.75) return 2;
    if (roll < 0.90) return 3;
    return 4;
}
function generateWeightedRandomBatch(boxObjects, batchType = "order")
{
    const medicineBoxes = boxObjects.filter(box => box.type === 'medicine');
    const batchSize = getRandomBatchSize();
    //Per-rack dispensing rules for order batches. 1-6 common high dosage/consumption, 7/8 rare/specialty/devices low dosage/consumption
    //rackWeight: multiplier applied on top of stock-level weight — lower = less likely to be picked.
    //qtyMin/qtyMax: realistic dispensing quantity range for this rack's medicine type.
    const RACK_RULES = {
        1: { rackWeight: 1.0, qtyMin: 5, qtyMax: 14 },
        2: { rackWeight: 1.0, qtyMin: 5, qtyMax: 14 },
        3: { rackWeight: 1.0, qtyMin: 5, qtyMax: 14 },
        4: { rackWeight: 1.0, qtyMin: 5, qtyMax: 14 },
        5: { rackWeight: 1.0, qtyMin: 5, qtyMax: 14 },
        6: { rackWeight: 1.0, qtyMin: 5, qtyMax: 14 },
        7: { rackWeight: 0.2, qtyMin:  1, qtyMax:  2 },
        8: { rackWeight: 0.2, qtyMin:  1, qtyMax:  2 },
    };
    const DEFAULT_RULE = { rackWeight: 0.5, qtyMin: 5, qtyMax: 14 };
    let candidates = medicineBoxes.map(box =>
    {
        const rackNum = box.rack; // assumes box.rack is the integer rack number
        const rule = RACK_RULES[rackNum] ?? DEFAULT_RULE;
        const stockWeight = batchType === "order"
            ? Math.max(1, 100 - box.count)
            : Math.max(1, box.capacity - box.count);
        return { box, rule, weight: stockWeight * rule.rackWeight };
    });
    const batch = [];
    const used = new Set();
    for (let i = 0; i < batchSize && candidates.length > 0; i++)
    {
        const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
        let roll = Math.random() * totalWeight;
        for (const candidate of candidates)
        {
            if (roll < candidate.weight)
            {
                const rule = candidate.rule;
                const qty = batchType === "order"
                    ? Math.floor(Math.random() * (rule.qtyMax - rule.qtyMin + 1)) + rule.qtyMin
                    : Math.floor(Math.random() * 15) + 5; // restock keeps existing range
                batch.push({ id: candidate.box.id, qty });
                used.add(candidate.box.id);
                candidates = candidates.filter(c => !used.has(c.box.id));
                break;
            }
            roll -= candidate.weight;
        }
    }
    return batch;
}
function generatePredefinedBatch()
{
    const total = PREDEFINED_BATCHES.reduce((sum, p) => sum + p.weight, 0);
    let roll = Math.random() * total;
    for (const profile of PREDEFINED_BATCHES)
    {
        roll -= profile.weight;
        if (roll <= 0) return profile.items.map(item => ({ ...item })); // shallow copy so original is never mutated
    }
    return PREDEFINED_BATCHES[PREDEFINED_BATCHES.length - 1].items.map(item => ({ ...item })); // float fallback
}
function generateOrderBatch(boxObjects)
{
    // 40% predefined, 60% random
    return Math.random() < 0.40
        ? generatePredefinedBatch()
        : generateWeightedRandomBatch(boxObjects, "order");
}

//Automated Restock
function generateDeliveryBatch(boxObjects)
{
    const sel = generateWeightedRandomBatch(boxObjects, "restock");
    return sel.length > 0 ? sel : [{ id: boxObjects[0].id, qty: 10 }];
}

//Path to IA
function getInteractionPos(interactionArea)
{
    const pos = new THREE.Vector3();
    interactionArea.getWorldPosition(pos);
    return pos;
}

//Failsafe
function analyzeBatch(batch, boxObjects)
{
    let willOverflow = false, willUnderflow = false;
    batch.forEach(task =>
    {
        const box = boxObjects.find(b => b.id === task.id);
        if(task.type === "restock") { if(box.count + task.qty > box.capacity) willOverflow  = true; }
        if(task.type === "order") { if(box.count - task.qty <= 10) willUnderflow = true; }
    });
    return { willOverflow, willUnderflow };
}
function processOverflow(boxObjects)
{
    if(!overflowQueue.length) return;
    const item = overflowQueue[0];
    const box  = boxObjects.find(b => b.id === item.id);
    if(box.count >= box.capacity) return;
    const space   = box.capacity - box.count;
    const toStore = Math.min(space, item.qty);
    box.count  += toStore;
    item.qty   -= toStore;
    if(item.qty <= 0) { overflowQueue.shift(); console.log("Overflow queue left:", overflowQueue); }
}
const pendingSupplier = new Set();
function checkReorderTriggers(boxObjects)
{
    boxObjects.filter(box => box.type === 'medicine').forEach(box =>
    {
        if(box.count <= 20 && !pendingSupplier.has(box.id))
        {
            console.log(`[SUPPLIER ORDER] ${box.id} scheduled for emergency restock`);
            pendingSupplier.add(box.id);
            flowQueue.enqueue('emergency_restock', [{ id: box.id, qty: 40, type: "restock" }]);
        }
    });
}

// ============================================================
// Outbound Slot Linking (Option 2 — strict customer-pack matching)
// ============================================================
// Tag the first available empty outbound slot with a customer ID.
// Call this at the end of postRack, after the worker places the pack.
// outboundBoxes — the boxObjects array of the outbound rack (type === 'outbound')
// customerId    — the customer.id to tag the slot with
// Returns the tagged box object, or null if no empty slot was found.
function tagOutboundSlot(outboundBoxes, customerId)
{
    const slot = outboundBoxes.find(b => b.type === 'outbound' && b.count === 0 && !b.customerId);
    if (!slot)
    {
        console.warn(`[OUTBOUND] No empty slot available to tag for customer #${customerId}`);
        dataCollector.logError('outbound', `no slot for customer #${customerId}`);
        return null;
    }
    slot.customerId = customerId;
    slot.count = 1; // Mark as occupied
    updateBoxes(outboundRack.boxObjects);
    console.log(`[OUTBOUND] Slot ${slot.id} tagged for customer #${customerId}`);
    return slot;
}
// Find the outbound slot currently tagged for a specific customer.
// Returns the box object, or null if not found (pack not ready yet).
function findOutboundSlotFor(outboundBoxes, customerId)
{ return outboundBoxes.find(b => b.type === 'outbound' && b.customerId === customerId) ?? null; }
// Clear a slot after the retrieval worker picks up the pack.
// Call this inside the retrieval case after simDelay at the outbound rack,
// before moving to the counter.
function clearOutboundSlot(outboundBoxes, customerId)
{
    const slot = findOutboundSlotFor(outboundBoxes, customerId);
    if (!slot)
    {
        console.warn(`[OUTBOUND] clearOutboundSlot: no slot found for customer #${customerId}`);
        dataCollector.logError('outbound', `clearOutboundSlot: no slot found for customer #${customerId}`);
        return;
    }
    slot.customerId = null;
    slot.count = 0; // Mark as empty again
    updateBoxes(outboundRack.boxObjects);
    console.log(`[OUTBOUND] Slot ${slot.id} cleared after pickup for customer #${customerId}`);
}
// Strict retrieval eligibility check.
// Returns the highest-priority customer who BOTH has waiting_room status
// AND has a confirmed tagged slot in the outbound rack.
// Priority rule: earliest waitTimer wins (longest waiting first).
// outboundBoxes — same outbound boxObjects array
function getNextEligibleCustomer(outboundBoxes)
{
    const eligible = customerQueue._queue.filter(c =>
        c.status === 'waiting' &&
        c.location === 'waiting_room' &&
        findOutboundSlotFor(outboundBoxes, c.id) !== null
    );
    if (eligible.length === 0) return null;
    // Sort by waitTimer ascending — smallest timestamp = waited longest
    eligible.sort((a, b) => a.waitTimer - b.waitTimer);
    return eligible[0];
}
// Returns array of slot objects whose customer has abandoned or been removed.
// Does NOT clear them — clearing is done physically by the worker in the pack_return flow.
function getOrphanedOutboundSlots(outboundBoxes)
{
    return outboundBoxes.filter(slot => {
        if (slot.type !== 'outbound' || !slot.customerId) return false;
        const customer = customerQueue._queue.find(c => c.id === slot.customerId);
        return !customer || customer.status === 'abandoned' || customer.status === 'expired';
    });
}

// ============================================================
// Unified Outflow Helper (shared by outflow_1 and outflow_2)
// iaKey      — 'desk' for outflow_1, 'counter' for outflow_2
// flowLabel  — 'outflow 1' | 'outflow 2'
// stageLabel — 'at desk' | 'at counter'
// entry      — the FlowQueue entry object
// ============================================================
async function _dispatchOutflow(entry, iaKey, flowLabel, stageLabel)
{
    const batch = (entry.batch ?? generateOrderBatch(boxObjects)).map(item => ({ ...item, type: "order" }));
    if (!batch.length) return;
    const batchIds = batch.map(t => ({ id: t.id, qty: t.qty }));
    const firstDestIA = selectIATile(iaKey);
    const firstDestPos = firstDestIA?.iaExact ?? null;
    //Create customer immediately — before any async work so the record exists from the start
    const customer = customerQueue.add(batchIds, entry.flowType);
    //outflow_2: customer already physically present, timer backdates to now
    //outflow_1: customer is external, timer starts after desk interaction (see preRack below)
    if (entry.flowType === 'outflow_2') customer.startWaitInWaitingRoom(performance.now());
    await executeBatch(batch, "outbound",
    {
        flowLabel, flowId: entry.id, firstDestPos,
        preRack: async (worker) => {
            flowQueue.setStage(entry.id, `travelling to ${iaKey}`);
            const areaWaitStart = performance.now();
            while (!workerPool.tryLockArea(iaKey))
            {
                worker.state = `Waiting ${iaKey}`;
                worker.intent = 'idle'; // evictable while waiting for area lock
                if (performance.now() - areaWaitStart > AREA_LOCK_TIMEOUT)
                {
                    console.warn(`[Worker ${worker.id}] Area '${iaKey}' wait timeout — proceeding anyway`);
                    dataCollector.logError('movement/area_lock', `area '${iaKey}' wait timeout`, worker.id);
                    break;
                }
                await delay(500);
            }
            try
            {
                await moveWorkerToIA(worker, iaKey);
                flowQueue.setStage(entry.id, stageLabel);
                dataCollector.logEvent(flowLabel, worker.id, `receiving order via ${iaKey}`, batchIds);
                await simDelay(120000); //2 min IRL order receipt interaction
                customer.pendingDuration = performance.now() - customer.pendingTimer;
                if (customer._pendingTimeout) { clearTimeout(customer._pendingTimeout); customer._pendingTimeout = null; }
                if (entry.flowType === 'outflow_2') dataCollector.logCustomer(customer, 'order processed via counter');
                dataCollector.logEvent(flowLabel, worker.id, `received order via ${iaKey}`, batchIds);
                //outflow_1 only: customer told to wait after order is confirmed at desk
                if (entry.flowType === 'outflow_1') customer.startWaitExternal();
                await returnToReservedTile(worker); 
            } finally { workerPool.unlockArea(iaKey); }
            await returnToIdle(worker);
        },
        postRack: _postRack(flowLabel, batchIds, entry.id, customer),
    });
    flowQueue.untrackActive(entry.id);
}

//Unified Dispatcher
async function dispatchNextFlow()
{
    if (!workerPool.hasFreeWorker()) return;
    const entry = flowQueue.pickNext();
    if (!entry) return; // nothing pending
    flowQueue.markDispatched(entry.id);
    flowQueue.trackActive(entry.id, entry.flowType, null);
    console.log(`[FLOWQ] Dispatching #${entry.id} — ${entry.flowType}`);
    switch (entry.flowType)
    {
        //Outflow 1: Desk → Rack → Staging → Outbound
        case 'outflow_1':
            await _dispatchOutflow(entry, 'desk',    'outflow 1', 'at desk');
            break;
        //Outflow 2: Counter → Rack → Staging → Outbound
        case 'outflow_2':
            await _dispatchOutflow(entry, 'counter', 'outflow 2', 'at counter');
            break;
        //Outflow 3 / Retrieval: Outbound rack → Counter
        case 'retrieval':
        {
            //Strict check: only proceed if a waiting_room customer has a tagged outbound slot
            const outboundBoxes = outboundRack.boxObjects;
            const customer = getNextEligibleCustomer(outboundBoxes);
            if (!customer) {return;}
            /*{
                console.log('[FLOWQ] Retrieval skipped — no waiting_room customer with ready outbound slot');
                flowQueue.untrackActive(entry.id);
                return;
            }*/ //Old system when retrieval was independent call or less integrated
            customer.status = 'being_claimed'; //Prevents multiple retrievals targeting the same customer/slot
            const outboundPos = selectIATile('outbound');
            if (!outboundPos)
            { console.warn("[FLOWQ] Could not resolve outbound position"); customer.status ='waiting';
                 flowQueue.untrackActive(entry.id); return; }
            //Above is Guardrail
            const worker = workerPool.getNearestWorker(outboundPos.x, outboundPos.z);
            if (!worker) { customer.status = 'waiting'; flowQueue.untrackActive(entry.id); return; }
            //Below guard against concurrent dispatch picking the same worker before busy flag write visible to the other coroutine.
            if (worker.busy) { flowQueue.untrackActive(entry.id); return; }
            worker.busy = true;
            flowQueue.trackActive(entry.id, entry.flowType, worker.id);
            try
            {
                let areaWaitStart = performance.now();
                while (!workerPool.tryLockArea('outbound'))
                {
                    worker.state = `Waiting ${'outbound'}`;
                    worker.intent = 'idle'; // evictable while waiting for area lock
                    if (performance.now() - areaWaitStart > AREA_LOCK_TIMEOUT)
                    {
                        console.warn(`[Worker ${worker.id}] Area '${'outbound'}' wait timeout — proceeding anyway`);
                        dataCollector.logError('movement/area_lock', `area '${'outbound'}' wait timeout`, worker.id);
                        break;
                    }
                    await delay(500);
                }
                try
                {
                    flowQueue.setStage(entry.id, 'travelling to outbound');
                    await moveWorkerToIA(worker, 'outbound');
                    flowQueue.setStage(entry.id, 'picking up pack');
                    dataCollector.logEvent("retrieval", worker.id, `taking pack for customer #${customer.id}`, customer.orders);
                    await simDelay(35000); //35*1000/60, Pack pickup interaction
                    //Clear the outbound slot now that the pack is physically taken
                    clearOutboundSlot(outboundBoxes, customer.id);
                    dataCollector.logEvent("retrieval", worker.id, `took pack for customer #${customer.id}`, customer.orders);
                    await returnToReservedTile(worker);
                }
                finally { workerPool.unlockArea('outbound'); }
                await returnToIdle(worker);
                //Notify customer before walking to counter
                customer.call();
                dataCollector.logEvent("retrieval", worker.id, `called customer #${customer.id}`, customer.orders);
                areaWaitStart = performance.now();
                while (!workerPool.tryLockArea('counter'))
                {
                    worker.state = `Waiting ${'counter'}`;
                    worker.intent = 'idle'; // evictable while waiting for area lock
                    if (performance.now() - areaWaitStart > AREA_LOCK_TIMEOUT)
                    {
                        console.warn(`[Worker ${worker.id}] Area '${'counter'}' wait timeout — proceeding anyway`);
                        dataCollector.logError('movement/area_lock', `area '${'counter'}' wait timeout`, worker.id);
                        break;
                    }
                    await delay(500);
                }
                try
                {
                    flowQueue.setStage(entry.id, 'travelling to counter');
                    await moveWorkerToIA(worker, 'counter');
                    flowQueue.setStage(entry.id, 'giving medicine');
                    dataCollector.logEvent("retrieval", worker.id, `handing medicine to customer #${customer.id}`, customer.orders);
                    await simDelay(60000); //60*1000/60, Handover interaction
                    //Complete and remove customer
                    customer.complete();
                    dataCollector.logEvent("retrieval", worker.id, `customer #${customer.id} served`, customer.orders);
                    customerQueue.remove(customer.id);
                    await returnToReservedTile(worker); 
                } finally { workerPool.unlockArea('counter'); }
                worker.state = "Returning to Idle";
                await returnToIdle(worker);
            }
            finally { worker.busy = false; }
            flowQueue.untrackActive(entry.id);
            break;
        }
        //Inbound: Storage → Rack restock
        case 'inbound':
        {
            const batch = (entry.batch ?? generateDeliveryBatch(boxObjects)).map(item => ({ ...item, type: "restock" }));
            if (!batch.length) return;
            await executeBatch(batch, "auto"); //executeBatch handles storage trip for restocks
            flowQueue.untrackActive(entry.id);
            break;
        }
        case 'pack_return':
        {
            const outboundBoxes = outboundRack.boxObjects;
            const orphans = getOrphanedOutboundSlots(outboundBoxes);
            if (orphans.length === 0) //Customer was already served by the time this fired — nothing to do
            { flowQueue.untrackActive(entry.id); return; }
            const outboundPos = selectIATile('outbound');
            if (!outboundPos) { flowQueue.untrackActive(entry.id); return; }
            const worker = workerPool.getNearestWorker(outboundPos.iaExact.x, outboundPos.iaExact.z);
            if (!worker || worker.busy) { flowQueue.untrackActive(entry.id); return; }
            worker.busy = true;
            flowQueue.trackActive(entry.id, entry.flowType, worker.id);
            try
            {
                const areaWaitStart = performance.now();
                while (!workerPool.tryLockArea('outbound'))
                {
                    worker.state = `Waiting ${'outbound'}`;
                    worker.intent = 'idle'; // evictable while waiting for area lock
                    if (performance.now() - areaWaitStart > AREA_LOCK_TIMEOUT)
                    {
                        console.warn(`[Worker ${worker.id}] Area '${'outbound'}' wait timeout — proceeding anyway`);
                        dataCollector.logError('movement/area_lock', `area '${'outbound'}' wait timeout`, worker.id);
                        break;
                    }
                    await delay(500);
                }
                try
                {
                    flowQueue.setStage(entry.id, 'travelling to outbound');
                    await moveWorkerToIA(worker, 'outbound');
                    flowQueue.setStage(entry.id, 'removing abandoned pack');
                    //Re-check orphans now that worker has arrived — race guard
                    const confirmed = getOrphanedOutboundSlots(outboundBoxes);
                    for (const slot of confirmed)
                    {
                        dataCollector.logEvent('pack_return', worker.id,
                            `removing abandoned pack from slot ${slot.id} (customer #${slot.customerId})`, []);
                        await simDelay(35000); //Same interaction time as placement/retrieval
                        slot.customerId = null;
                        slot.count = 0;
                    }
                    updateBoxes(outboundRack.boxObjects);
                    await returnToReservedTile(worker);
                }
                finally { workerPool.unlockArea('outbound'); }
                // Return pack to storage — reuses runStorageTrip which exits to x:11, z:-2 before returnToIdle
                flowQueue.setStage(entry.id, 'returning pack to storage');
                const storageSlot = selectIATile('storage');
                const storagePos  = storageSlot ? storageSlot.iaExact : getInteractionPos(storageArea.interactionArea);
                await runStorageTrip(
                    worker,
                    storagePos.x, storagePos.z,
                    async (w) => {
                        dataCollector.logEvent('pack_return', w.id, 'returning abandoned pack to storage', []);
                        flowQueue.setStage(entry.id, 'storing pack');
                        await simDelay(35000); //Storage deposit interaction
                        dataCollector.logEvent('pack_return', w.id, 'abandoned pack stored', []);
                    },
                );
            }
            finally { worker.busy = false; }
            flowQueue.untrackActive(entry.id);
            break;
        }
        case 'emergency_restock':
        {
            // Start with the already-dispatched entry's items
            let mergedBatch = [...entry.batch];
            // Pull in up to 2 more pending emergency restocks → 3 total per trip
            // Change .slice(0, 2) to nothing / remove the slice to merge ALL pending ones
            const extras = flowQueue._queue
                .filter(e => e.status === 'pending' && e.flowType === 'emergency_restock')
                .slice(0, 2);
            extras.forEach(e => {
                mergedBatch.push(...e.batch);
                flowQueue.markDispatched(e.id); // Remove from queue so they don't fire again
            });
            mergedBatch = mergedBatch.map(item => ({ ...item, type: "restock" }));
            if (!mergedBatch.length) { flowQueue.untrackActive(entry.id); return; }
            await executeBatch(mergedBatch, "auto", { flowLabel: 'emergency_restock', flowId: entry.id });
            mergedBatch.forEach(t => pendingSupplier.delete(t.id));
            flowQueue.untrackActive(entry.id);
            break;
        }
        default: console.warn(`[FLOWQ] Unknown flow type: ${entry.flowType}`);
    }
}
function _postRack(flowLabel, batchIds, flowID, customer) //Shared postRack builder used by outflow 1 & 2
{
    return async (worker, batch) => {
        let stagingSlot = null;
        while (!stagingSlot)
        {
            stagingSlot = workerPool.getNearestFreeStagingIA(worker);
            if (!stagingSlot) { await delay(500); }
        }
        workerPool.tryLockArea(stagingSlot.key);
        try
        {
            await moveWorkerToIA(worker, stagingSlot.key);
            flowQueue.setStage(flowID, 'staging');
            dataCollector.logEvent(flowLabel, worker.id, "organizing medicine pack at staging", batchIds);
            await simDelay(batch.length * 30000); //Staging interaction, 30*1000/60*n millisec, n = number of med pack
            dataCollector.logEvent(flowLabel, worker.id, "medicine pack organized", batchIds);
            await returnToReservedTile(worker);
        }
        finally { workerPool.unlockArea(stagingSlot.key); }
        const areaWaitStart = performance.now();
        while (!workerPool.tryLockArea('outbound'))
        {
            worker.state = `Waiting ${'outbound'}`;
            worker.intent = 'idle'; // evictable while waiting for area lock
            if (performance.now() - areaWaitStart > AREA_LOCK_TIMEOUT)
            {
                console.warn(`[Worker ${worker.id}] Area '${'outbound'}' wait timeout — proceeding anyway`);
                dataCollector.logError('movement/area_lock', `area '${'outbound'}' wait timeout`, worker.id);
                break;
            }
            await delay(500);
        }
        try
        {
            flowQueue.setStage(flowID, 'travelling to outbound');
            await moveWorkerToIA(worker, 'outbound');
            flowQueue.setStage(flowID, 'outbound placement');
            dataCollector.logEvent(flowLabel, worker.id, "placing pack on outbound", batchIds);
            await simDelay(35000); //Placing at outbound, 35*1000/60 millisec
            //Tag the outbound slot with this customer's ID — pack is now physically placed
            const slot = tagOutboundSlot(outboundRack.boxObjects, customer.id);
            if (slot)
            {
                dataCollector.logEvent(flowLabel, worker.id, `pack placed in slot ${slot.id} for customer #${customer.id}`, batchIds);
            }
            else
            {
                //No slot available — log but continue, retrieval will be blocked until space frees
                dataCollector.logEvent(flowLabel, worker.id, `no outbound slot available for customer #${customer.id}`, batchIds);
            }
            //outflow_1 customer was external — now that pack is ready, they can come in
            if (customer.location === 'external') customer.arrive();
            if (slot) enqueueRetrieval(); // Pack is confirmed placed — trigger retrieval immediately
            await returnToReservedTile(worker); 
        } finally { workerPool.unlockArea('outbound'); }
        await returnToIdle(worker);
    };
}

//Enqueue helper, use setInterval / automation trigger
function enqueueOutflow1(batch = null) { return flowQueue.enqueue('outflow_1', batch); }
function enqueueOutflow2(batch = null) { return flowQueue.enqueue('outflow_2', batch); }
function enqueueRetrieval() { return flowQueue.enqueue('retrieval', null); }
function enqueueInbound(batch = null) { return flowQueue.enqueue('inbound', batch); }
function enqueuePackReturn() { return flowQueue.enqueue('pack_return', null); }

//Order Execution
function groupTasksByRack(batch)
{
    const groups = {};
    batch.forEach(task =>{
        const match = task.id.match(/\d+/);
        const rackNumber = match ? parseInt(match[0]) : null;
        if (rackNumber === null) { console.warn(`[BATCH] Could not parse rack from ID: ${task.id}`); return; }
        if (!groups[rackNumber]) groups[rackNumber] = [];
        groups[rackNumber].push(task);
    });
    return groups;
}
async function executeBatch(batch, source, flowContext = null)
{
    if (!batch || batch.length === 0) return;
    const firstRack = parseInt(batch[0].id.match(/\d+/)[0]);
    const firstDestPos = flowContext?.firstDestPos ?? selectIATile('rack_' + firstRack)?.iaExact;
    if (!firstDestPos) { console.warn("[BATCH] Could not resolve first destination position"); return; } //Guardrail, may be removed later
    const worker = workerPool.getNearestWorker(firstDestPos.x, firstDestPos.z);
    if (!worker)
    { console.warn("[POOL] No free worker available"); dataCollector.logError('dispatch', 'no free worker available for batch'); return; }
    worker.busy = true;
    if (flowContext?.flowId != null) flowQueue.trackActive(flowContext.flowId, flowContext.flowLabel, worker.id);
    const flowLabel = flowContext?.flowLabel ?? (batch.some(t => t.type === "restock") ? "inbound" : "outflow");
    const batchIds = batch.map(t => ({ id: t.id, qty: t.qty }));
    dataCollector.logEvent(flowLabel, worker.id, "flow received", batchIds);
    try
    {
        //Pre-rack hook (desk/counter visit for outbound flows)
        if (flowContext?.preRack) { await flowContext.preRack(worker); }
        //Default restock pre-rack: storage trip
        else if (batch.some(t => t.type === "restock"))
        {
            const storageSlot = selectIATile('storage');
            const storagePos  = storageSlot ? storageSlot.iaExact : getInteractionPos(storageArea.interactionArea);
            flowQueue.setStage(flowContext?.flowId, 'moving to storage');
            await runStorageTrip(
                worker,
                storagePos.x, storagePos.z,
                async (w) =>{
                    dataCollector.logEvent(flowLabel, w.id, "taking medicines from storage", batchIds);
                    flowQueue.setStage(flowContext?.flowId, 'taking medicine from storage');
                    await simDelay(120000); //2 mins (60*2*1000) storage area interaction time
                    dataCollector.logEvent(flowLabel, w.id, "took medicines from storage", batchIds);
                },
            );
        }
        //Rack loop
        const rackGroups  = groupTasksByRack(batch);
        const rackNumbers = Object.keys(rackGroups).sort((a, b) => a - b);
        for (const rackNumber of rackNumbers)
        {
            const tasks = rackGroups[rackNumber];
            //Previous Lock Rack is now on movement file within moveWorkerToIA
            try
            {
                flowQueue.setStage(flowContext?.flowId, 'travelling to rack');
                await moveWorkerToIA(worker, 'rack_' + rackNumber);
                dataCollector.logEvent(flowLabel, worker.id, `arrived rack ${rackNumber}`, batchIds);
                const rackBoxes = boxObjects.filter(b => b.rack === Number(rackNumber) && b.type === 'medicine');
                flowQueue.setStage(flowContext?.flowId, 'rack search');
                await worker.searchAndInteract(tasks.map(t => t.id), rackBoxes);
                dataCollector.logEvent(flowLabel, worker.id, `left rack ${rackNumber}`, batchIds);
                 // Always snap back to the reserved candidate tile after every rack visit,
                // including the last one. Without this, the worker's physical position stays
                // at iaExact (the rack IA exact pos, inside the rack zone) when postRack begins.
                // findPath then uses that drifted position as its start tile, which is often
                // blocked or identical to the staging destination tile, producing an empty path
                // and collapsing to a straight-line walk that gets stuck against the rack obstacle.
                await returnToReservedTile(worker);
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
        if (batch.some(t => t.type === "restock"))
        { dataCollector.logEvent(flowLabel, worker.id, "done restocking medicine racks", batchIds); }
        else
        { dataCollector.logEvent(flowLabel, worker.id, "done taking medicine from racks", batchIds); }
        //Post-rack hook (staging + outbound for outbound flows)
        if (flowContext?.postRack) { await flowContext.postRack(worker, batch); }
        else { await returnToIdle(worker); }
    }
    finally { worker.busy = false; }
}