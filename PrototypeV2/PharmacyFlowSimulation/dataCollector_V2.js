//dataCollector.js
//Collects simulation data and prepares it for export

class DataCollector {
  constructor() {
    this.records = []; //Sheet 1
    this.startTime = performance.now();
    this.fpsRecords = [];
    this.peakHoursActive = false; //Injected by HTML on peak toggle
    this.customerRecords = []; //Sheet 2
    this.errorRecords = []; //Sheet 3
    this.heatmapRecords = []; //Sheet 4
    this.movementRecords = []; // Sheet 5
  }
  get situation() { return this.peakHoursActive ? 'peak' : 'normal'; }

  /*
  //Log generic event
  logEvent(type, workerId = null, itemId = null, rack = null) {
    const timeNow = performance.now();

    const record = {
      time: ((timeNow - this.startTime) / 1000).toFixed(2),
      event: type,
      worker: workerId,
      item: itemId,
      rack: rack,
    };

    this.records.push(record);
    console.log("[DATA]", record);
  }
  */
  //New Logging More Detailed
  logEvent(flowType, workerId = null, activity = null, items = [])
  {
    if (!automationRunning) return; //Only log during active simulation
    const timeNow = performance.now();
    const record =
    {
        runtime: ((timeNow - this.startTime) / 1000).toFixed(2), //Actual runtime, for debugging
        time_min: ((timeNow - this.startTime) / 1000 * SIM_SPEED / 60).toFixed(2),
        situation: this.situation,
        flow_type: flowType,
        worker: workerId !== null ? `Worker ${workerId}` : null,
        activity: activity,
        items: items.map(item => {
            if (typeof item === 'object' && item.qty != null) return `${item.qty}x ${item.id}`;
            return item; // plain ID fallback for calls that don't provide qty
        }).join(', '),
    };
    this.records.push(record);
    console.log("[DATA]", record);
  }

  logFPS(fps) //For FPS/performance tracking
  {
    if (!automationRunning) return; //Only log during active simulation
    this.fpsRecords.push({ runtime: ((performance.now() - this.startTime) / 1000).toFixed(2), fps: fps.toFixed(1)});
  }

  logCustomer(customer, state)
  {
    if (!automationRunning) return;
    const now = performance.now();
    this.customerRecords.push({
        time_min: ((now - this.startTime) / 1000 * SIM_SPEED / 60).toFixed(2),
        customer_id: customer.id,
        flow_type: customer.flowType ?? '?',
        items: customer.orders.map(o => typeof o === 'object' ? `${o.qty}x ${o.id}` : o).join(', '),
        pending_sim_min: customer.pendingDuration !== null
            ? (customer.pendingDuration / 1000 * SIM_SPEED / 60).toFixed(2)
            : customer.pendingTimer !== null
                ? ((now - customer.pendingTimer) / 1000 * SIM_SPEED / 60).toFixed(2)
                : null,
        service_sim_min: customer.serviceDuration !== null
            ? (customer.serviceDuration / 1000 * SIM_SPEED / 60).toFixed(2)
            : customer.serviceTimer !== null
                ? ((now - customer.serviceTimer) / 1000 * SIM_SPEED / 60).toFixed(2)
                : null,
        wait_sim_min: customer.waitTimer !== null
            ? customer.waitSimMin().toFixed(2)
            : null,
        state: state,
        location: customer.location,
    });
  }

  logError(source, message, workerId = null)
  {
    if (!automationRunning) return;
    this.errorRecords.push({
        runtime: ((performance.now() - this.startTime) / 1000).toFixed(2), //Actual runtime, for debugging
        source,
        worker: workerId !== null ? `Worker ${workerId}` : null,
        message,
    });
  }

  logHeatmap()
  {
    if (!automationRunning || !workerPool) return;
    const time_min = ((performance.now() - this.startTime) / 1000 * SIM_SPEED / 60).toFixed(2);
    workerPool.workers.forEach(w=>{
        if (!w.position) return;
        this.heatmapRecords.push({
            runtime: ((performance.now() - this.startTime) / 1000).toFixed(2), //Actual runtime, for debugging
            time_min,
            worker: `Worker ${w.id}`,
            world_x: w.position.x.toFixed(2),
            world_z: w.position.z.toFixed(2),
            tile_idx: worldToGrid(w.position.x, w.position.z),
            state: w.state,
        });
    });
  }

  logMovement(workerId, from, to, tiles, congestion, duration)
  {
      if (!automationRunning) return;
      const METERS_PER_TILE = 0.5; // 1 tile = 0.5 m IRL
      const distance_m = tiles * METERS_PER_TILE;
      const duration_sim_min = (duration * SIM_SPEED / 60).toFixed(2);
      const speed_ms = duration > 0 ? (distance_m / duration).toFixed(3) : null;
      const congestion_rate = tiles > 0 ? (congestion  / tiles).toFixed(3) : null;
      const record = {
          time_min: ((performance.now() - this.startTime) / 1000 * SIM_SPEED / 60).toFixed(2),
          situation: this.situation,
          worker: `Worker ${workerId}`,
          from, // origin IA key
          to, // destination IA key
          tiles_traversed: tiles,
          distance_m: distance_m.toFixed(2),
          congestion_events: congestion,
          congestion_rate, // sidesteps per tile
          duration_irl_s: duration.toFixed(3),
          duration_sim_min,
          speed_ms, // m/s IRL (null if instant)
      };
      this.movementRecords.push(record);
      console.log("[MOVE]", record);
  }

  //Get all records
  getData() {
    return this.records;
  }

  //Clear data
  clear() {
    this.records = [];
    this.fpsRecords = [];
    this.customerRecords = [];
    this.errorRecords = [];
    this.heatmapRecords = [];
    this.movementRecords = [];
    this.startTime = performance.now();
  }
}

//Global instance
const dataCollector = new DataCollector();