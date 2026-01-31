function createMedicineRack() {
    const rackGroup = new THREE.Group();

    // Materials
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const shelfMaterial = new THREE.MeshStandardMaterial({ color: 0xdddddd });
    const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x4caf50 });

    // Rack dimensions
    const rackWidth = 4;
    const rackHeight = 5;
    const rackDepth = 1;

    // Frame (4 vertical poles)
    const poleGeometry = new THREE.BoxGeometry(0.1, rackHeight, 0.1);

    const polePositions = [
        [-rackWidth / 2, rackHeight / 2, -rackDepth / 2],
        [ rackWidth / 2, rackHeight / 2, -rackDepth / 2],
        [-rackWidth / 2, rackHeight / 2,  rackDepth / 2],
        [ rackWidth / 2, rackHeight / 2,  rackDepth / 2],
    ];

    polePositions.forEach(pos => {
        const pole = new THREE.Mesh(poleGeometry, frameMaterial);
        pole.position.set(pos[0], pos[1], pos[2]);
        rackGroup.add(pole);
    });

    // Shelves
    const shelfCount = 4;
    const shelfGeometry = new THREE.BoxGeometry(rackWidth, 0.1, rackDepth);

    for (let i = 0; i < shelfCount; i++) {
        const shelf = new THREE.Mesh(shelfGeometry, shelfMaterial);
        shelf.position.y = 1 + i * 1.2;
        rackGroup.add(shelf);

        // Medicine boxes on each shelf
        for (let j = 0; j < 5; j++) {
            const boxGeometry = new THREE.BoxGeometry(0.5, 0.4, 0.6);
            const box = new THREE.Mesh(boxGeometry, boxMaterial);

            box.position.set(
                -1.6 + j * 0.8,
                shelf.position.y + 0.25,
                0
            );

            rackGroup.add(box);
        }
    }

    return rackGroup;
}
