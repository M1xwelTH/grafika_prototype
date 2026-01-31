const TABLE_STATES = {
  EMPTY: 'empty',
  OCCUPIED: 'occupied',
  ORDERED: 'ordered'
};

class Entity3D {
  constructor(x, y, z) {
    this.pos = new THREE.Vector3(x, y, z);
  }

  distanceTo(v) {
    return this.pos.distanceTo(v);
  }
}

class Table3D extends Entity3D {
  constructor(scene, id, x, z) {
    super(x, 0, z);
    this.id = id;
    this.size = 12;
    this.height = 8;
    this.state = TABLE_STATES.EMPTY;
    this.timer = 5;
    this.targeted = false;

    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(this.size, this.height, this.size),
      new THREE.MeshStandardMaterial({ color: 0xffaa00 })
    );
    this.mesh.position.set(x, this.height / 2, z);
    scene.add(this.mesh);
  }

  center() {
    return new THREE.Vector3(this.pos.x, this.height / 2, this.pos.z);
  }

  update(dt) {
    this.timer -= dt;

    if (this.state === TABLE_STATES.ORDERED && this.timer <= 0) {
      this.state = TABLE_STATES.EMPTY;
      this.timer = 5;
      this.targeted = false;
    }

    if (this.state === TABLE_STATES.EMPTY && this.timer <= 0) {
      this.state = TABLE_STATES.OCCUPIED;
      this.timer = Infinity;
    }

    this.mesh.material.color.set(
      this.state === TABLE_STATES.EMPTY ? 0xffff00 :
      this.state === TABLE_STATES.OCCUPIED ? 0xff8800 :
      0xff0000
    );
  }
}

class Waiter3D extends Entity3D {
  constructor(scene, id, x, z) {
    super(x, 2, z);
    this.id = id;
    this.radius = 3;
    this.speed = 30;
    this.state = 'free';
    this.target = null;
    this.table = null;

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0x44aaff })
    );
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
  }

  move(dt, tables, waiters) {
    if (!this.target) return;

    let dir = new THREE.Vector3().subVectors(this.target, this.pos);
    let dist = dir.length();
    if (dist < 1) return;

    dir.normalize();

    // table avoidance
    tables.forEach(t => {
      const d = this.pos.distanceTo(t.center());
      const min = this.radius + t.size * 0.6;
      if (d < min) {
        const push = new THREE.Vector3()
          .subVectors(this.pos, t.center())
          .normalize()
          .multiplyScalar(0.6);
        dir.add(push);
      }
    });

    // waiter avoidance
    waiters.forEach(w => {
      if (w === this) return;
      const d = this.pos.distanceTo(w.pos);
      const min = this.radius * 2;
      if (d < min) {
        const push = new THREE.Vector3()
          .subVectors(this.pos, w.pos)
          .normalize()
          .multiplyScalar(0.8);
        dir.add(push);
      }
    });

    dir.normalize();
    this.pos.addScaledVector(dir, this.speed * dt);
    this.mesh.position.copy(this.pos);
  }
}

class Kitchen3D {
  constructor(scene, x, y, z) {
    this.pos = new THREE.Vector3(x, y, z);
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(30, 10, 20),
      new THREE.MeshStandardMaterial({ color: 0x888888 })
    );
    this.mesh.position.set(x, 5, z);
    scene.add(this.mesh);
  }

  center() {
    return new THREE.Vector3(this.pos.x, 5, this.pos.z);
  }
}
