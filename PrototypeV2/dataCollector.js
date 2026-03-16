//dataCollector.js
//Collects simulation data and prepares it for export

class DataCollector {
  constructor() {
    this.records = [];
    this.startTime = performance.now();
    this.fpsRecords = [];
  }

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
      time: ((timeNow - this.startTime) / 1000).toFixed(2),
      flow_type: flowType,
      worker: workerId !== null ? `Worker ${workerId}` : null,
      activity: activity,
      items: items.join(", "),
    };
    this.records.push(record);
    console.log("[DATA]", record);
  }

  logFPS(fps) //For FPS/performance tracking
  {
    if (!automationRunning) return; //Only log during active simulation
    this.fpsRecords.push({ time: ((performance.now() - this.startTime) / 1000).toFixed(2), fps: fps.toFixed(1)});
  }

  //Get all records
  getData() {
    return this.records;
  }

  //Clear data
  clear() {
    this.records = [];
    this.fpsRecords = [];
    this.startTime = performance.now();
  }
}

//Global instance
const dataCollector = new DataCollector();
