//Rack and worker related
/* 
Includes: Rack Layout, Dual Worker System, Visualization, Traversal and Worker Search Function, Initialization
*/

//Rack Layout
const LEVEL_IDS = ["A","B","C","D"];
const BOX_COLUMNS = 4;

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

//Visual Helpers
let workerShadow = null;
let searchIndicator = null;
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
    //Save original color if not already saved
    if(!box._originalColor){ box._originalColor = box.mesh.material.color.clone(); }
    box.mesh.material.color.set(colorHex);
}
function restoreBoxColor(box)
{
    if(box._originalColor)
    { box.mesh.material.color.copy(box._originalColor); box._originalColor = null; }
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
    //Tracks where worker currently is
    let currentIndex = 0;
    for(const targetID of targetIDs){
        let found = false;
        let scannedCount = 0;
        while(!found && scannedCount < traversal.length){
            const box = traversal[currentIndex];
            worker.state = `Searching ${box.id}`;
            searchIndicator.visible = true;
            searchIndicator.position.copy(box.mesh.position);
            setBoxTempColor(box,0xffffff); //Color white for search
            await delay(SEARCH_DELAY);
            if(box.id !== targetID){ restoreBoxColor(box); } //Not yet found, continue search
            if(box.id === targetID)
            {
                worker.state = `Interacting ${box.id}`;
                setBoxTempColor(box,0xff8800);
                await delay(INTERACTION_DELAY);
                restoreBoxColor(box);
                found = true;
            }
            //Move forward through rack
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