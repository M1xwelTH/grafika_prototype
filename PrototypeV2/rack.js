// =========================
// Medicine Data
// =========================
const MAX_COUNT = 30;

const medicines = {
    A: {
        count: 0,
        max: MAX_COUNT,
        colors: {
            light: 0xb2fab4,
            medium: 0x66bb6a,
            dark: 0x1b5e20
        }
    },
    B: {
        count: 0,
        max: MAX_COUNT,
        colors: {
            light: 0xffcdd2,
            medium: 0xe57373,
            dark: 0xb71c1c
        }
    },
    C: {
        count: 0,
        max: MAX_COUNT,
        colors: {
            light: 0xbbdefb,
            medium: 0x64b5f6,
            dark: 0x0d47a1
        }
    },
    D: {
        count: 0,
        max: MAX_COUNT,
        colors: {
            light: 0xf8bbd0,
            medium: 0xf06292,
            dark: 0x880e4f
        }
    }
};

// Rack level → medicine mapping (bottom → top)
const rackLevels = ["D", "C", "B", "A"];

// =========================
// Medicine Logic
// =========================
function addRandomMedicine() {
    const keys = Object.keys(medicines);
    const key = keys[Math.floor(Math.random() * keys.length)];
    const med = medicines[key];

    if (med.count < med.max) {
        med.count++;
        console.log(`+1 ${key} (now ${med.count})`);
    }
}

function getRackLevelColor(medKey) {
    const med = medicines[medKey];
    const ratio = med.count / med.max;

    if (med.count === 0) return med.colors.light;
    if (ratio < 0.5) return med.colors.light;
    if (ratio < 1) return med.colors.medium;
    return med.colors.dark;
}

function updateRackColors(shelves) {
    rackLevels.forEach((medKey, index) => {
        const color = getRackLevelColor(medKey);
        shelves[index].material.color.setHex(color);
    });
}

// =========================
// Rack Creation
// =========================
function createMedicineRack() {
    const rackGroup = new THREE.Group();
    const shelves = [];

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });

    const rackWidth = 4;
    const rackHeight = 5;
    const rackDepth = 1;

    // Frame poles
    const poleGeo = new THREE.BoxGeometry(0.1, rackHeight, 0.1);
    const polePositions = [
        [-rackWidth / 2, rackHeight / 2, -rackDepth / 2],
        [ rackWidth / 2, rackHeight / 2, -rackDepth / 2],
        [-rackWidth / 2, rackHeight / 2,  rackDepth / 2],
        [ rackWidth / 2, rackHeight / 2,  rackDepth / 2],
    ];

    polePositions.forEach(pos => {
        const pole = new THREE.Mesh(poleGeo, frameMat);
        pole.position.set(...pos);
        rackGroup.add(pole);
    });

    // Shelves
    const shelfGeo = new THREE.BoxGeometry(rackWidth, 0.12, rackDepth);

    for (let i = 0; i < 4; i++) {
        const shelf = new THREE.Mesh(shelfGeo, shelfMat.clone());
        shelf.position.y = 1 + i * 1.2;
        rackGroup.add(shelf);
        shelves.push(shelf);
    }

    // Initial color sync
    updateRackColors(shelves);

    return { rackGroup, shelves };
}
