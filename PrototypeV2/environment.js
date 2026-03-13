//pharmaceutical.js - Additional elements for the simulation

//Walls
function createWall(X,Y)
{
    const wallGroup = new THREE.Group();    
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x888888 }); //Wall material: Gray concrete-like
    const wallGeo = new THREE.BoxGeometry(X, Y, 1); //(X,Y,thickness)
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, Y/2, 0);  //Center at Y=4 for floor-level placement
    wallGroup.add(wall);
    //Hitbox: Cyan wireframe, tight fit around the wall
    const hitboxGeo = new THREE.BoxGeometry(X, Y, 1); //Same dimensions as wall
    const hitboxEdges = new THREE.EdgesGeometry(hitboxGeo);
    const hitbox = new THREE.LineSegments(hitboxEdges, new THREE.LineBasicMaterial({ color: 0x00ffff })); //Cyan
    hitbox.position.set(0, Y/2, 0); //Same position as wall
    hitbox.visible = false;
    hitbox._collisionSize = { halfX: X/2, halfZ: 0.5 };
    wallGroup.add(hitbox);
    return { wallGroup, wall, hitbox };
}

//Staging Area
function createStagingArea()
{
    const tableGroup = new THREE.Group();    
    //Materials coloring
    const topMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 }); //Brown wood
    const legMat = new THREE.MeshStandardMaterial({ color: 0x555555 }); //Gray metal
    const topGeo = new THREE.BoxGeometry(10, 0.2, 6); //(X,thickness,Z)
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.set(0, 2.8, 0); // Top at Y=3-thickness
    tableGroup.add(top);
    //Legs: 4 at corners, 0.1x2.8x0.1 each
    const legGeo = new THREE.BoxGeometry(0.2, 2.7, 0.2);
    const legPositions =
    [
        [-3.9, 1.35, -2.4], // Front-left
        [-3.9, 1.35, 2.4], // Front-right
        [3.9, 1.35, -2.4], // Back-left
        [3.9, 1.35, 2.4] // Back-right
    ];
    legPositions.forEach(pos =>
    {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(...pos);
        tableGroup.add(leg);
    });
    //Hitbox: Cyan wireframe around the entire staging area
    const hitboxGeo = new THREE.BoxGeometry(10.1, 0.1, 6.1); //Slightly larger than table for coverage
    const hitboxEdges = new THREE.EdgesGeometry(hitboxGeo);
    const hitbox = new THREE.LineSegments(hitboxEdges, new THREE.LineBasicMaterial({ color: 0x00ffff })); //Cyan
    hitbox.visible = false;
    hitbox._collisionSize = { halfX: 5.05, halfZ: 3.05 };
    tableGroup.add(hitbox);
    //Interaction Areas: 4 areas - one per X side, two per Z side
    const interactionAreas = [];
    const iaGeo = new THREE.BoxGeometry(2, 0.05, 2);
    const iaEdges = new THREE.EdgesGeometry(iaGeo);
    const iaMat = new THREE.LineBasicMaterial({ color: 0x00ff00 }); //Green
    //Left X
    const iaLeft = new THREE.LineSegments(iaEdges, iaMat);
    iaLeft.position.set(-6.1, 0, 0); //Offset left
    iaLeft.visible = false;
    tableGroup.add(iaLeft);
    interactionAreas.push(iaLeft);
    //Right X
    const iaRight = new THREE.LineSegments(iaEdges, iaMat);
    iaRight.position.set(6.1, 0, 0); //Offset right
    iaRight.visible = false;
    tableGroup.add(iaRight);
    interactionAreas.push(iaRight);
    //Front Z (two)
    const iaFront1 = new THREE.LineSegments(iaEdges, iaMat);
    iaFront1.position.set(-2, 0, -4.1); //Offset front-left
    iaFront1.visible = false;
    tableGroup.add(iaFront1);
    interactionAreas.push(iaFront1);
    const iaFront2 = new THREE.LineSegments(iaEdges, iaMat);
    iaFront2.position.set(2, 0, -4.1); //Offset front-right
    iaFront2.visible = false;
    tableGroup.add(iaFront2);
    interactionAreas.push(iaFront2);
    //Back Z (two)
    const iaBack1 = new THREE.LineSegments(iaEdges, iaMat);
    iaBack1.position.set(-2, 0, 4.1); //Offset back-left
    iaBack1.visible = false;
    tableGroup.add(iaBack1);
    interactionAreas.push(iaBack1);
    const iaBack2 = new THREE.LineSegments(iaEdges, iaMat);
    iaBack2.position.set(2, 0, 4.1); //Offset back-right
    iaBack2.visible = false;
    tableGroup.add(iaBack2);
    interactionAreas.push(iaBack2);
    return { tableGroup, top, legs: legPositions.map(() => null), hitbox, interactionAreas };
}

//Computer Desk
function createComputerDesk()
{
    const deskGroup = new THREE.Group();    
    //Materials/coloring
    const topMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 }); //Brown wood
    const legMat = new THREE.MeshStandardMaterial({ color: 0x555555 }); //Gray metal
    const pcMat = new THREE.MeshStandardMaterial({ color: 0x666666 }); //Gray metal for PC
    const topGeo = new THREE.BoxGeometry(3, 0.1, 2); //(X,thickness,Z)
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.set(0, 3, 0); //Top at Y=3
    deskGroup.add(top);
    //Legs: 4 at corners, 0.1x3x0.1 each
    const legGeo = new THREE.BoxGeometry(0.1, 3, 0.1);
    const legPositions =
    [
        [-1.4, 1.5, -0.9], //Front-left
        [1.4, 1.5, -0.9], //Front-right
        [-1.4, 1.5, 0.9], //Back-left
        [1.4, 1.5, 0.9] //Back-right
    ];
    legPositions.forEach(pos =>
    {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(...pos);
        deskGroup.add(leg);
    });
    //PC: Simple square box on top
    const pcGeo = new THREE.BoxGeometry(2.8, 2, 0.2); //(X,Y,Z)
    const pc = new THREE.Mesh(pcGeo, pcMat);
    pc.position.set(0, 4.05, 0); //Centered on desk top (Y=3 + 0.05 + 1)
    deskGroup.add(pc);
    //Hitbox: Cyan wireframe around the entire desk
    const hitboxGeo = new THREE.BoxGeometry(3.1, 0.1, 2.1); //Slightly larger than desk
    const hitboxEdges = new THREE.EdgesGeometry(hitboxGeo);
    const hitbox = new THREE.LineSegments(hitboxEdges, new THREE.LineBasicMaterial({ color: 0x00ffff })); //Cyan
    hitbox.visible = false;
    hitbox._collisionSize = { halfX: 1.55, halfZ: 1.05 };
    deskGroup.add(hitbox);
    //Interaction Area: 1 area in front (green)
    const iaGeo = new THREE.BoxGeometry(2, 0.05, 2);
    const iaEdges = new THREE.EdgesGeometry(iaGeo);
    const interactionArea = new THREE.LineSegments(iaEdges, new THREE.LineBasicMaterial({ color: 0x00ff00 })); //Green
    interactionArea.position.set(0, 0, 2.1); //Facing desk
    interactionArea.visible = false;
    deskGroup.add(interactionArea);
    return { deskGroup, top, legs: legPositions.map(() => null), pc, hitbox, interactionArea };
}

//Counter
function createCounter()
{
    const counterGroup = new THREE.Group();    
    //Materials: All metal gray
    const mat = new THREE.MeshStandardMaterial({ color: 0x666666 });
    const topGeo = new THREE.BoxGeometry(4, 0.5, 2); //(X,thickness,Z)
    const top = new THREE.Mesh(topGeo, mat);
    top.position.set(0, 3.5, 0); //Top at Y=4-thickness
    counterGroup.add(top);
    //Legs: 4 at corners, 0.2x3.5x0.2 each
    const legGeo = new THREE.BoxGeometry(0.2, 3.5, 0.2);
    const legPositions =
    [
        [-1.9, 1.75, -0.9], //Front-left
        [1.9, 1.75, -0.9], //Front-right
        [-1.9, 1.75, 0.9], //Back-left
        [1.9, 1.75, 0.9] //Back-right
    ];
    legPositions.forEach(pos =>
    {
        const leg = new THREE.Mesh(legGeo, mat);
        leg.position.set(...pos);
        counterGroup.add(leg);
    });
    //Hitbox: Cyan wireframe around the entire counter
    const hitboxGeo = new THREE.BoxGeometry(4.1, 0.1, 2.1); //Slightly larger
    const hitboxEdges = new THREE.EdgesGeometry(hitboxGeo);
    const hitbox = new THREE.LineSegments(hitboxEdges, new THREE.LineBasicMaterial({ color: 0x00ffff })); //Cyan
    hitbox.visible = false;
    hitbox._collisionSize = { halfX: 2.05, halfZ: 1.05 };
    counterGroup.add(hitbox);
    //Interaction Area: 1 area in front (green)
    const iaGeo = new THREE.BoxGeometry(2, 0.05, 2);
    const iaEdges = new THREE.EdgesGeometry(iaGeo);
    const interactionArea = new THREE.LineSegments(iaEdges, new THREE.LineBasicMaterial({ color: 0x00ff00 })); //Green
    interactionArea.position.set(0, 0, -2.1); //Behind counter
    interactionArea.visible = false;
    counterGroup.add(interactionArea);
    return { counterGroup, top, legs: legPositions.map(() => null), hitbox, interactionArea };
}

//Storage Area
function createStorageArea()
{
    const storageGroup = new THREE.Group();
    //Rug material: Dark green carpet-like (current representation)
    const rugMat = new THREE.MeshStandardMaterial({ color: 0x2F4F2F }); //Dark green
    const rugGeo = new THREE.BoxGeometry(10, 0.05, 10); //(X, thickness, Z)
    const rug = new THREE.Mesh(rugGeo, rugMat);
    rug.position.set(0, 0.025, 0); //Slightly above floor for visibility
    storageGroup.add(rug);
    //Interaction Area: The whole rug (green wireframe)
    const iaGeo = new THREE.BoxGeometry(10, 0.1, 10); //Matches rug size
    const iaEdges = new THREE.EdgesGeometry(iaGeo);
    const interactionArea = new THREE.LineSegments(iaEdges, new THREE.LineBasicMaterial({ color: 0x00ff00 })); //Green
    interactionArea.visible = false;
    storageGroup.add(interactionArea);
    return { storageGroup, rug, interactionArea }; //No hitbox for rug
}