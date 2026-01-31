class Entity {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.radius = 15;
        this.path = [];
    }

    getHitbox() {
        return {
            x: this.x - this.radius,
            y: this.y - this.radius,
            w: this.radius * 2,
            h: this.radius * 2
        };
    }

    moveToward(tx, ty, speed) {
        const dx = tx - this.x;
        const dy = ty - this.y;
        const d = Math.hypot(dx, dy);
        if (d < 2) return true;
        this.vx = (dx / d) * speed;
        this.vy = (dy / d) * speed;
        return false;
    }

    update(dt) {
        if (this.path.length) {
            if (this.moveToward(this.path[0].x, this.path[0].y, 60)) {
                this.path.shift();
            }
        }
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        resolveWallCollision(this, walls);
    }
}

/* =====================
   MEDICINE
===================== */
class Medicine extends Entity {
    constructor(x, y, type) {
        super(x, y);
        this.color =
            type === "red" ? [1,0,0,1] :
            type === "green" ? [0,1,0,1] :
            [0,0,1,1];
        this.locked = false;
    }

    update(dt) {
        tryAssignWorkerToMedicine(this);
        super.update(dt);
    }

    draw(gl) {
        drawRect(gl, this.x-7, this.y-7, 14, 14, this.color);
    }
}

/* =====================
   CUSTOMER
===================== */
class Customer extends Entity {
    constructor(x, y) {
        super(x, y);
        this.locked = false;
    }

    update(dt) {
        tryAssignDeskWorker(this);
        super.update(dt);
    }

    draw(gl) {
        drawCircle(gl, this.x, this.y, 15, [1,0,0,1]);
    }
}

/* =====================
   WORKER
===================== */
class Worker extends Entity {
    constructor(x, y, role) {
        super(x, y);
        this.role = role;
        this.free = true;
        this.color = role === "desk"
            ? [0,0.2,0.5,1]
            : [0.4,0.8,1,1];
    }

    update(dt) {
        if (this.target) {
            this.path = [...doorways, this.target];
        }
        super.update(dt);
    }

    draw(gl) {
        drawCircle(gl, this.x, this.y, 15, this.color);
    }
}

/* =====================
   STATIC OBJECTS
===================== */
class StorageArea {
    constructor(x,y,w,h){this.x=x;this.y=y;this.w=w;this.h=h;}
    draw(gl){ drawRect(gl,this.x,this.y,this.w,this.h,[0.55,0.27,0.07,1]);}
}

class Wall {
    constructor(x,y,w,h){this.x=x;this.y=y;this.w=w;this.h=h;}
    draw(gl){ drawRect(gl,this.x,this.y,this.w,this.h,[0.2,0.2,0.2,1]);}
}
