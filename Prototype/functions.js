/* =====================
   SPAWN
===================== */
function spawnMedicine() {
    const t = ["red","green","blue"][Math.floor(Math.random()*3)];
    medicines.push(new Medicine(50, 80, t));
}
function spawnCustomer() {
    customers.push(new Customer(50, 380));
}

/* =====================
   DRAW HELPERS
===================== */
function drawRect(gl,x,y,w,h,c){
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([
        x,y,x+w,y,x,y+h,
        x,y+h,x+w,y,x+w,y+h
    ]),gl.STATIC_DRAW);
    gl.uniform4fv(colorLocation,c);
    gl.drawArrays(gl.TRIANGLES,0,6);
}
function drawCircle(gl,cx,cy,r,c){
    const v=[];
    for(let i=0;i<=24;i++){
        const a=i/24*Math.PI*2;
        v.push(cx,cy,cx+Math.cos(a)*r,cy+Math.sin(a)*r);
    }
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(v),gl.STATIC_DRAW);
    gl.uniform4fv(colorLocation,c);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,v.length/2);
}

/* =====================
   COLLISION
===================== */
function aabbIntersect(a,b){
    return a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y;
}
function resolveWallCollision(e,walls){
    const hb=e.getHitbox();
    for(const w of walls){
        if(aabbIntersect(hb,w)){ e.vx=0; e.vy=0; }
    }
}

/* =====================
   LOCKING
===================== */
function findNearestFreeWorker(ws,t){
    let best=null,bd=1e9;
    for(const w of ws){
        if(!w.free)continue;
        const d=Math.hypot(w.x-t.x,w.y-t.y);
        if(d<bd){bd=d;best=w;}
    }
    return best;
}

function tryAssignWorkerToMedicine(m){
    if(m.locked) return;
    const w=findNearestFreeWorker(storeWorkers,m);
    if(!w) return;
    m.locked=true;
    w.free=false;
    w.target=m;
}

function tryAssignDeskWorker(c){
    if(c.locked) return;
    const w=findNearestFreeWorker(deskWorkers,c);
    if(!w) return;
    c.locked=true;
    w.free=false;
    w.target=c;
}
