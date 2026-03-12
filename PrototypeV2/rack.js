//rack.js, rack related

//Rack Layout
const LEVEL_IDS = ["A","B","C","D"];
const BOX_COLUMNS = 4;

//Visual Helpers
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

//InitRack
function createMedicineRack(rackNumber)
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
    for(let i=0;i<LEVEL_IDS.length;i++)
    {
        const shelf = new THREE.Mesh(shelfGeo,shelfMat);
        shelf.position.y = 1+(LEVEL_IDS.length-1-i)*1.2;
        rackGroup.add(shelf);
        shelves.push(shelf);
        for(let j=0;j<BOX_COLUMNS;j++)
        {
            const id = `${rackNumber}${LEVEL_IDS[i]}${j+1}`;
            const boxMat = new THREE.MeshStandardMaterial({color:0xff0000});
            const box = new THREE.Mesh(boxGeo,boxMat);
            box.position.set(-1.2+j*0.8,shelf.position.y+0.25,0);
            rackGroup.add(box);
            //Labeling
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
            boxObjects.push({ id:id, rack:rackNumber, capacity:100, count:40, mesh:box });
            //Set initial value for box above
        }
    }
    updateBoxes(boxObjects);
    //Shelve Hitbox Temp
    function _buildHitbox(scene)
    {
        //Hitbox, following the dimension of the shelves
        const geo = new THREE.BoxGeometry(4.1, 0.05, 1.1);
        const edges = new THREE.EdgesGeometry(geo);
        const hitbox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ffff })); //Cyan, following worker
        hitbox.visible = false;  //Initially hidden
        scene.add(hitbox);
        return hitbox;
    }
    //Interaction Area, smaller than hitbox for interaction checks
    function _buildInteractionArea(scene)
    {
        const geo = new THREE.BoxGeometry(2, 0.05, 2);
        const edges = new THREE.EdgesGeometry(geo);
        const interactionArea = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ff00 }));  //Green
        interactionArea.position.set(0, 0, 1.55);
        //Above offset in front of hitbox (Z=1), 1.55 is chosen due to +0.1/2 in hitbox and +1/2 in IA
        interactionArea.visible = false; //Initially hidden
        scene.add(interactionArea);
        return interactionArea;
    }
    const hitbox = _buildHitbox(scene);
    const interactionArea = _buildInteractionArea(scene);
    rackGroup.add(hitbox);
    rackGroup.add(interactionArea);
    return { rackGroup, shelves, boxObjects, hitbox, interactionArea };
}