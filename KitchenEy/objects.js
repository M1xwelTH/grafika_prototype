const TABLE_STATES = {
  EMPTY: 'empty',
  OCCUPIED: 'occupied',
  ORDERED: 'ordered'
};

class Entity {
  distanceTo(p) {
    return Math.hypot(this.x - p.x, this.y - p.y);
  }
}

class Table extends Entity {
  constructor(id, x, y) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
    this.size = 40;
    this.state = TABLE_STATES.EMPTY;
    this.timer = 5;
    this.reservations = 0;
    this.targeted = false; // is a waiter already heading here?
  }

  center() {
    return { x: this.x + this.size / 2, y: this.y + this.size / 2 };
  }

  update(dt) {
    if (this.timer > 0) this.timer -= dt;

    if (this.state === TABLE_STATES.ORDERED && this.timer <= 0) {
      this.state = TABLE_STATES.EMPTY;
      this.timer = 5;
    }

    if (this.state === TABLE_STATES.EMPTY && this.timer <= 0 && this.reservations < 20) {
      this.state = TABLE_STATES.OCCUPIED;
      this.timer = Infinity;
      this.reservations++;
    }
  }

  draw(ctx) {
    ctx.fillStyle = this.state === TABLE_STATES.EMPTY ? 'yellow'
      : this.state === TABLE_STATES.OCCUPIED ? 'orange' : 'red';
    ctx.fillRect(this.x, this.y, this.size, this.size);
  }
}

class Waiter extends Entity {
  constructor(id, x, y) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
    this.radius = 8;
    this.speed = 80;
    this.state = 'free';
    this.target = null;
    this.table = null;
    this.food = null;
  }

  move(dt, tables, waiters) {
    if (!this.target) return;

    let dx = this.target.x - this.x;
    let dy = this.target.y - this.y;
    let d = Math.hypot(dx, dy);
    if (d < 1) return;

    dx /= d; dy /= d;

    // avoid tables (circle-rectangle approximation)
    tables.forEach(t => {
      const c = t.center();
      const dxT = this.x - c.x;
      const dyT = this.y - c.y;
      const dist = Math.hypot(dxT, dyT);
      const minDist = this.radius + t.size * 0.5 + 4;
      if (dist < minDist && dist > 0) {
        dx += (dxT / dist) * 0.6;
        dy += (dyT / dist) * 0.6;
      }
    });
    // avoid other waiters
    waiters.forEach(w => {
      if (w === this) return;
      const dxW = this.x - w.x;
      const dyW = this.y - w.y;
      const dist = Math.hypot(dxW, dyW);
      const minDist = this.radius + w.radius + 4;
      if (dist < minDist && dist > 0) {
        dx += (dxW / dist) * 0.8;
        dy += (dyW / dist) * 0.8;
      }
    });

    this.x += dx * this.speed * dt;
    this.y += dy * this.speed * dt;
  }

  draw(ctx) {
    ctx.fillStyle = this.state === 'free' ? '#7fdfff' : '#0044aa';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

class Kitchen {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
  }

  center() {
    return { x: this.x + this.w / 2, y: this.y + this.h / 2 };
  }

  draw(ctx) {
    ctx.fillStyle = '#888';
    ctx.fillRect(this.x, this.y, this.w, this.h);
  }
}