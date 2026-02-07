// =====================================================
// 3D MEDICINE RACK WITH WORKER SIMULATION
// =====================================================


// =========================
// Rack Layout
// =========================
const LEVEL_IDS = ["A","B","C","D"];
const BOX_COLUMNS = 4;


// =========================
// Simulation State
// =========================
let simulationTime = 0;
let lastDeliverySummary = "None";
let lastOrderSummary = "None";

const overflowQueue = [];


// =========================
// Worker System
// =========================
let rackOccupied = false;

const SEARCH_DELAY = 400;
const INTERACTION_DELAY = 600;

const arrivalWorker = { type:"arrival", busy:false };
const orderWorker = { type:"order", busy:false };

let workerShadow = null;
let searchIndicator = null;


// =========================
// Delay Helper
// =========================
function delay(ms){
    return new Promise(res=>setTimeout(res,ms));
}


// =========================
// Visual Helpers
// =========================
function createWorkerShadow(scene){

    const geo = new THREE.CylinderGeometry(0.6,0.6,0.05,20);
    const mat = new THREE.MeshBasicMaterial({color:0x000000});

    workerShadow = new THREE.Mesh(geo,mat);
    workerShadow.position.set(0,0.02,1.2);
    workerShadow.visible = false;

    scene.add(workerShadow);
}

function createSearchIndicator(scene){

    const geo = new THREE.SphereGeometry(0.08,12,12);
    const mat = new THREE.MeshBasicMaterial({color:0xff0000});

    searchIndicator = new THREE.Mesh(geo,mat);
    searchIndicator.visible = false;

    scene.add(searchIndicator);
}

function highlightInteraction(box){

    const originalColor = box.mesh.material.color.clone();

    // flash white
    box.mesh.material.color.set(0xffffff);

    setTimeout(()=>{
        box.mesh.material.color.copy(originalColor);
    },300);
}

function highlightRecognition(box){

    const originalColor = box.mesh.material.color.clone();

    box.mesh.material.color.set(0xff8800); // orange glow

    setTimeout(()=>{
        box.mesh.material.color.copy(originalColor);
    },400);
}



// =========================
// Gradient Color
// =========================
function getGradientColor(ratio){

    const red = new THREE.Color(1,0,0);
    const yellow = new THREE.Color(1,1,0);
    const green = new THREE.Color(0,1,0);

    if(ratio<=0.5) return red.clone().lerp(yellow,ratio*2);
    return yellow.clone().lerp(green,(ratio-0.5)*2);
}


// =========================
// Update Box Colors
// =========================
function updateBoxes(boxObjects){

    boxObjects.forEach(box=>{
        const ratio = box.count/box.capacity;
        box.mesh.material.color.copy(getGradientColor(ratio));
    });
}


// =========================
// Traversal Order
// =========================
function getTraversalOrder(boxObjects){

    return [...boxObjects].sort((a,b)=>a.id.localeCompare(b.id));
}


// =========================
// Worker Search Simulation
// =========================
async function simulateSearch(worker,targetIDs,boxObjects){

    rackOccupied = true;
    worker.busy = true;

    workerShadow.visible = true;

    const traversal = getTraversalOrder(boxObjects);

    for(const targetID of targetIDs){

        for(const box of traversal){

            searchIndicator.visible = true;
            searchIndicator.position.copy(box.mesh.position);

            await delay(SEARCH_DELAY);

            if(box.id === targetID){

            // Recognition moment
            highlightRecognition(box);
            await delay(400); // human recognition delay

            // Interaction moment
            highlightInteraction(box);
            await delay(INTERACTION_DELAY);

            break;
        }

        }
    }

    searchIndicator.visible = false;
    workerShadow.visible = false;

    worker.busy = false;
    rackOccupied = false;
}


// =========================
// DELIVERY
// =========================
async function processDelivery(boxObjects){

    if(rackOccupied || arrivalWorker.busy) return;

    const batch = [
        {id:"A1",qty:3},
        {id:"B3",qty:2}
    ];

    await simulateSearch(arrivalWorker,batch.map(b=>b.id),boxObjects);

    let summary=[];

    batch.forEach(item=>{

        const box = boxObjects.find(b=>b.id===item.id);

        for(let i=0;i<item.qty;i++){
            if(box.count < box.capacity) box.count++;
            else overflowQueue.push({id:box.id});
        }

        summary.push(`${item.qty} ${box.id}`);
    });

    lastDeliverySummary = summary.join(", ");
}


// =========================
// ORDER
// =========================
async function processOrder(boxObjects){

    if(rackOccupied || orderWorker.busy) return;

    const randomBox = boxObjects[Math.floor(Math.random()*boxObjects.length)];
    const batch = [{id:randomBox.id,qty:3}];

    await simulateSearch(orderWorker,batch.map(b=>b.id),boxObjects);

    let summary=[];

    batch.forEach(item=>{

        const box = boxObjects.find(b=>b.id===item.id);

        let fulfilled=0;

        while(fulfilled < item.qty && box.count>0){
            box.count--;
            fulfilled++;
        }

        summary.push(`${fulfilled}/${item.qty} ${box.id}`);
    });

    lastOrderSummary = summary.join(", ");
}


// =========================
// Overflow Restock
// =========================
function processOverflow(boxObjects){

    if(!overflowQueue.length) return;

    const item = overflowQueue.shift();
    const box = boxObjects.find(b=>b.id===item.id);

    if(box.count < box.capacity) box.count++;
}


// =========================
// Runtime
// =========================
function tickSimulation(delta){
    simulationTime += delta;
}


// =========================
// Rack Creation
// =========================
function createMedicineRack(){

    const rackGroup = new THREE.Group();
    const shelves=[];
    const boxObjects=[];

    const frameMat = new THREE.MeshStandardMaterial({color:0x555555});
    const shelfMat = new THREE.MeshStandardMaterial({color:0xdddddd});

    const rackHeight = 5;

    // ----- POLES -----
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

    // ----- Shelves + Boxes -----
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

            // Label
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
            const label=new THREE.Mesh(
                new THREE.PlaneGeometry(0.35,0.18),
                new THREE.MeshBasicMaterial({map:texture})
            );

            label.position.set(0,0,0.31);
            box.add(label);

            boxObjects.push({
                id:id,
                capacity:100,
                count:40,
                mesh:box
            });
        }
    }

    updateBoxes(boxObjects);

    return {rackGroup,shelves,boxObjects};
}
