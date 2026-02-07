// =========================
// Rack Layout
// =========================
const LEVEL_IDS = ["A", "B", "C", "D"]; // top -> bottom
const BOX_COLUMNS = 4;

// =========================
// Helper: Gradient Color
// =========================
function getGradientColor(ratio) {
    const red = new THREE.Color(1, 0, 0);
    const yellow = new THREE.Color(1, 1, 0);
    const green = new THREE.Color(0, 1, 0);

    if (ratio <= 0.5) {
        return red.clone().lerp(yellow, ratio * 2);
    }
    return yellow.clone().lerp(green, (ratio - 0.5) * 2);
}

// =========================
// Label Creator
// =========================
function createLabel(text) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "black";
    ctx.font = "40px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);

    const mat = new THREE.MeshBasicMaterial({ map: texture });
    const geo = new THREE.PlaneGeometry(0.35, 0.18);

    return new THREE.Mesh(geo, mat);
}

// =========================
// Update Box Colors
// =========================
function updateBoxes(boxObjects) {
    boxObjects.forEach(box => {
        const ratio = box.count / box.capacity;
        const color = getGradientColor(ratio);
        box.mesh.material.color.copy(color);
    });
}

// =========================
// Random Simulation
// =========================
function addRandomMedicine(boxObjects) {
    const available = boxObjects.filter(b => b.count < b.capacity);
    if (!available.length) return;

    const box = available[Math.floor(Math.random() * available.length)];
    box.count++;
}

function consumeRandomMedicine(boxObjects) {
    const available = boxObjects.filter(b => b.count > 0);
    if (!available.length) return;

    const box = available[Math.floor(Math.random() * available.length)];
    box.count--;
}

// =========================
// Rack Creation
// =========================
function createMedicineRack() {

    const rackGroup = new THREE.Group();
    const shelves = [];
    const boxObjects = [];

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xdddddd });

    const rackWidth = 4;
    const rackHeight = 5;
    const rackDepth = 1;

    // Frame poles
    const poleGeo = new THREE.BoxGeometry(0.1, rackHeight, 0.1);
    [
        [-2, rackHeight / 2, -0.5],
        [ 2, rackHeight / 2, -0.5],
        [-2, rackHeight / 2,  0.5],
        [ 2, rackHeight / 2,  0.5],
    ].forEach(p => {
        const pole = new THREE.Mesh(poleGeo, frameMat);
        pole.position.set(...p);
        rackGroup.add(pole);
    });

    const shelfGeo = new THREE.BoxGeometry(rackWidth, 0.12, rackDepth);
    const boxGeo = new THREE.BoxGeometry(0.5, 0.4, 0.6);

    for (let i = 0; i < LEVEL_IDS.length; i++) {

        const levelLetter = LEVEL_IDS[i];

        const shelf = new THREE.Mesh(shelfGeo, shelfMat);
        shelf.position.y = 1 + (LEVEL_IDS.length - 1 - i) * 1.2;
        rackGroup.add(shelf);
        shelves.push(shelf);

        for (let j = 0; j < BOX_COLUMNS; j++) {

            const id = `${levelLetter}${j + 1}`;

            const boxMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
            const box = new THREE.Mesh(boxGeo, boxMat);

            box.position.set(-1.2 + j * 0.8, shelf.position.y + 0.3, 0);
            rackGroup.add(box);

            // Label
            const label = createLabel(id);
            label.position.set(0, 0, 0.31);
            box.add(label);

            // Box object model
            boxObjects.push({
                id: id,
                capacity: 10,
                count: 0,
                mesh: box,
                labelMesh: label
            });
        }
    }

    updateBoxes(boxObjects);

    return { rackGroup, shelves, boxObjects };
}
