// =========================
// Medicine Data
// =========================
const MAX_COUNT = 30;

const medicines = {
    A: { count: 0, max: MAX_COUNT, colors: { light: 0xb2fab4, medium: 0x66bb6a, dark: 0x1b5e20 }},
    B: { count: 0, max: MAX_COUNT, colors: { light: 0xffcdd2, medium: 0xe57373, dark: 0xb71c1c }},
    C: { count: 0, max: MAX_COUNT, colors: { light: 0xbbdefb, medium: 0x64b5f6, dark: 0x0d47a1 }},
    D: { count: 0, max: MAX_COUNT, colors: { light: 0xf8bbd0, medium: 0xf06292, dark: 0x880e4f }}
};

// Bottom → top
const rackLevels = ["D", "C", "B", "A"];

// =========================
// Medicine Logic
// =========================
function addRandomMedicine() {
    const keys = Object.keys(medicines);
    const key = keys[Math.floor(Math.random() * keys.length)];
    if (medicines[key].count < medicines[key].max) {
        medicines[key].count++;
    }
}

function consumeRandomMedicine() {
    const available = Object.keys(medicines).filter(
        k => medicines[k].count > 0
    );
    if (available.length === 0) return;

    const key = available[Math.floor(Math.random() * available.length)];
    medicines[key].count--;
}

function getColorForMedicine(key) {
    const med = medicines[key];
    const ratio = med.count / med.max;

    if (ratio === 0) return med.colors.light;
    if (ratio < 0.5) return med.colors.light;
    if (ratio < 1) return med.colors.medium;
    return med.colors.dark;
}

// =========================
// Box Update Logic
// =========================
function updateBoxes(boxesByLevel) {
    rackLevels.forEach((medKey, levelIndex) => {
        const color = getColorForMedicine(medKey);
        boxesByLevel[levelIndex].forEach(box => {
            box.material.color.setHex(color);
        });
    });
}

// =========================
// Rack Creation
// =========================
function createMedicineRack() {
    const rackGroup = new THREE.Group();
    const shelves = [];
    const boxesByLevel = [];

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

    // Shelves + boxes
    const shelfGeo = new THREE.BoxGeometry(rackWidth, 0.12, rackDepth);
    const boxGeo = new THREE.BoxGeometry(0.5, 0.4, 0.6);

    for (let i = 0; i < 4; i++) {
        const shelf = new THREE.Mesh(shelfGeo, shelfMat);
        shelf.position.y = 1 + i * 1.2;
        rackGroup.add(shelf);
        shelves.push(shelf);

        const boxes = [];
        for (let j = 0; j < 5; j++) {
            const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
            const box = new THREE.Mesh(boxGeo, boxMat);
            box.position.set(-1.6 + j * 0.8, shelf.position.y + 0.3, 0);
            rackGroup.add(box);
            boxes.push(box);
        }
        boxesByLevel.push(boxes);
    }

    updateBoxes(boxesByLevel);

    return { rackGroup, shelves, boxesByLevel };
}
