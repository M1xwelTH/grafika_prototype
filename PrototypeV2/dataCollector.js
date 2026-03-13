//dataCollector.js
//Collects simulation data and prepares it for export

class DataCollector {
  constructor() {
    this.records = [];
    this.startTime = performance.now();
  }

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

  //Get all records
  getData() {
    return this.records;
  }

  //Clear data
  clear() {
    this.records = [];
    this.startTime = performance.now();
  }
}

//Global instance
const dataCollector = new DataCollector();
