// ==================== Konstanta ====================
const LEVEL_IDS = ["A","B","C","D"];
const BOX_COLUMNS = 4;

let selectedItems = {};

// ==================== Fungsi warna gradien ====================
function getGradientColor(ratio){
    const red = new THREE.Color(1,0,0);
    const yellow = new THREE.Color(1,1,0);
    const green = new THREE.Color(0,1,0);
    if(ratio<=0.5) return red.clone().lerp(yellow, ratio*2);
    return yellow.clone().lerp(green, (ratio-0.5)*2);
}

// ==================== Fungsi update kotak ====================
function updateBoxes(boxObjects){
    boxObjects.forEach(box=>{
        const ratio = box.count / box.capacity;
        box.mesh.material.color.copy(getGradientColor(ratio));
    });
}

// ==================== Fungsi buat rak obat ====================
function createMedicineRack(){
    
    const rackGroup = new THREE.Group();
    const boxObjects = []; // Untuk update warna nanti
    const frameMat = new THREE.MeshStandardMaterial({color:0x555555});
    const shelfMat = new THREE.MeshStandardMaterial({color:0xdddddd});
    const rackHeight = 5;

    

    // ===== Tiang rak =====
    const poleGeo = new THREE.BoxGeometry(0.1, rackHeight, 0.1);
    [
        [-2, rackHeight/2, -0.5],
        [ 2, rackHeight/2, -0.5],
        [-2, rackHeight/2,  0.5],
        [ 2, rackHeight/2,  0.5]
    ].forEach(p=>{
        const pole = new THREE.Mesh(poleGeo, frameMat);
        pole.position.set(...p);
        rackGroup.add(pole);
    });

    // ===== Rak dan kotak =====
    const shelfGeo = new THREE.BoxGeometry(4,0.12,1);
    const boxGeo = new THREE.BoxGeometry(0.5,0.4,0.6);

    for(let i=0; i<LEVEL_IDS.length; i++){
        const shelf = new THREE.Mesh(shelfGeo, shelfMat);
        shelf.position.y = 1 + (LEVEL_IDS.length-1-i)*1.2;
        rackGroup.add(shelf);

        for(let j=0; j<BOX_COLUMNS; j++){
            const id = `${LEVEL_IDS[i]}${j+1}`;
            const boxMat = new THREE.MeshStandardMaterial({color:0x88cc44});
            const mesh = new THREE.Mesh(boxGeo, boxMat);
            mesh.position.set(-1.2 + j*0.8, shelf.position.y + 0.3, 0);
            rackGroup.add(mesh);

            // Tambahkan properti count & capacity agar bisa di-update
            boxObjects.push({
                id,
                mesh,
                count: Math.floor(Math.random()*101),    // Contoh: jumlah saat ini
                capacity: 100                              // Contoh kapasitas maksimal
            });
            // ======== Buat label =========
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.font = '28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(id, canvas.width/2, canvas.height/2);

    const texture = new THREE.CanvasTexture(canvas);
    const materialLabel = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(materialLabel);

    // Posisi label sedikit di atas kotak
    sprite.position.set(mesh.position.x, mesh.position.y + 0.35, mesh.position.z);
    sprite.scale.set(0.5, 0.25, 1);  // skala sprite agar proporsional

    rackGroup.add(sprite);
        
        }
    }

    return {rackGroup, boxObjects};
}

// ==================== Isi dropdown lokasi ====================
function populateLocationDropdown(boxObjects){
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



// ==================== Inisialisasi Scene ====================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 100);
camera.position.set(1, 3, 8);

const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0xffffff);
document.body.appendChild(renderer.domElement);


// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
directionalLight.position.set(5,10,5);
scene.add(directionalLight);

// ==================== Buat rak ====================
const {rackGroup, boxObjects} = createMedicineRack();
scene.add(rackGroup);

// isi dropdown lokasi
window.addEventListener("DOMContentLoaded", () => {
    populateLocationDropdown(boxObjects);
});

function syncStockInputs(boxObjects){
    boxObjects.forEach(box => {
        const input = document.getElementById(box.id);
        if(input){
            input.value = box.count;
        }
    });
}


// ==================== Fungsi untuk update kotak dari input ====================
function updateAllBoxes() {
    boxObjects.forEach(box => {
        const input = document.getElementById(box.id);
        if(input) {
            box.count = Number(input.value);   // update jumlah
        }
    });
    updateBoxes(boxObjects);  // update warna sesuai jumlah
}

function addPick(){

    const id = document.getElementById("boxSelect").value;
    const qty = Number(document.getElementById("pickQty").value);

    const box = boxObjects.find(b => b.id === id);

    if(!box) return;

    if(qty <= 0) return;

    if(qty > box.count){
        alert("Stock tidak cukup");
        return;
    }

    if(!selectedItems[id]){
        selectedItems[id] = 0;
    }

    selectedItems[id] += qty;

    renderPickList();
}

function renderPickList(){

    const panel = document.getElementById("pickList");

    if(Object.keys(selectedItems).length === 0){
        panel.innerHTML = "Belum ada item";
        return;
    }

    panel.innerHTML = "";

    for(const id in selectedItems){
        const div = document.createElement("div");
        div.textContent = id + " qty: " + selectedItems[id];
        panel.appendChild(div);
    }
}

function submitOrder(){

    for(const id in selectedItems){

        const box = boxObjects.find(b => b.id === id);
        if(!box) continue;

        // kurangi stok
        box.count -= selectedItems[id];

        if(box.count < 0) box.count = 0;

        // update panel current stock (kiri)
        const input = document.getElementById(id);
        if(input){
            input.value = box.count;
        }
    }

    // kosongkan daftar pick
    selectedItems = {};
    renderPickList();
}


// ==================== Animation Loop ====================
function animate(){
    requestAnimationFrame(animate);

    // Contoh: update warna kotak secara realtime (opsional)
    updateBoxes(boxObjects);

    renderer.render(scene, camera);
}
animate();

// ==================== Responsif saat resize ====================
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
