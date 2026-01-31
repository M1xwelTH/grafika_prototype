// =====================
// BASIC SETUP
// =====================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf2f2f2);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

camera.position.set(0, 12, 18);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// =====================
// LIGHTING
// =====================
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

// =====================
// FLOOR
// =====================
const floorGeometry = new THREE.PlaneGeometry(30, 20);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xe0e0e0 });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// =====================
// AREA APOTEK
// =====================
function createArea(label, x, color) {
  const geometry = new THREE.BoxGeometry(4, 0.5, 3);
  const material = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, 0.25, 0);
  scene.add(mesh);

  return mesh;
}

const inboundTable  = createArea("Inbound",  -8, 0x87ceeb);
const rackArea      = createArea("Rack",      0, 0xaaaaaa);
const outboundTable = createArea("Outbound",  8, 0x90ee90);

// =====================
// DRUG CONFIG
// =====================
const DRUG_TYPES = {
  keras:       0xff0000,
  paracetamol: 0xffff00,
  bebas:       0x00aa00
};

function createDrug(type) {
  const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const material = new THREE.MeshStandardMaterial({
    color: DRUG_TYPES[type]
  });
  const drug = new THREE.Mesh(geometry, material);
  scene.add(drug);
  return drug;
}

// =====================
// SIMULATION CLASS
// =====================
class DrugSimulation {
  constructor(drug) {
    this.drug = drug;
    this.state = "receive";
    this.speed = 0.04;
    this.waitStart = null;
  }

  update() {
    switch (this.state) {

      case "receive":
        this.moveTo(new THREE.Vector3(-8, 1, 0), "toRack");
        break;

      case "toRack":
        this.moveTo(new THREE.Vector3(0, 1, 0), "stored");
        break;

      case "stored":
        if (!this.waitStart) this.waitStart = Date.now();
        if (Date.now() - this.waitStart > 2000) {
          this.waitStart = null;
          this.state = "toOutbound";
        }
        break;

      case "toOutbound":
        this.moveTo(new THREE.Vector3(8, 1, 0), "done");
        break;

      case "done":
        // selesai
        break;
    }
  }

  moveTo(target, nextState) {
    this.drug.position.lerp(target, this.speed);
    if (this.drug.position.distanceTo(target) < 0.1) {
      this.state = nextState;
    }
  }
}

// =====================
// CREATE MULTIPLE DRUGS
// =====================
const simulations = [];

function spawnDrug(type, zOffset) {
  const drug = createDrug(type);
  drug.position.set(-8, 1, zOffset);
  simulations.push(new DrugSimulation(drug));
}

spawnDrug("paracetamol", -2);
spawnDrug("keras", 0);
spawnDrug("bebas", 2);

// =====================
// RENDER LOOP
// =====================
function animate() {
  requestAnimationFrame(animate);

  simulations.forEach(sim => sim.update());
  renderer.render(scene, camera);
}

animate();

// =====================
// RESIZE HANDLER
// =====================
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
