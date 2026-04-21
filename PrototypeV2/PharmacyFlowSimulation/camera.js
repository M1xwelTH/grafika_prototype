//camera.js
//Camera related stuffs

//Camera
let target = { x: 0, y: 0, z: 0 };
let radius = 10;
let yaw = 0;
let pitch = 0;
function updateCamera(camera)
{
    camera.position.x = target.x + radius * Math.cos(pitch) * Math.sin(yaw);
    camera.position.y = target.y + radius * Math.sin(pitch);
    camera.position.z = target.z + radius * Math.cos(pitch) * Math.cos(yaw);
    camera.lookAt(target.x, target.y, target.z);
}
function camMovements(camera, renderer)
{
    const dom = renderer.domElement;
    let isDragging = false, dragButton = null;
    let previousMousePosition = { x: 0, y: 0 };
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
    dom.addEventListener("mousedown", (e) => {
        isDragging = true; dragButton = e.button;
        previousMousePosition = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener("mouseup", () => { isDragging = false; dragButton = null; });
    dom.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        const deltaMove = { x: e.clientX - previousMousePosition.x, y: e.clientY - previousMousePosition.y };
        if (dragButton === 0)
        {
            const panSpeed = 0.01;
            target.x -= deltaMove.x * panSpeed;
            target.y += deltaMove.y * panSpeed;
            updateCamera(camera);
        }
        if (dragButton === 2)
        {
            const rotateSpeed = 0.005;
            yaw   -= deltaMove.x * rotateSpeed;
            pitch -= deltaMove.y * rotateSpeed;
            pitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, pitch));
            updateCamera(camera);
        }
        previousMousePosition = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener("wheel", (e) => {
        const zoomSpeed = 0.01;
        radius += e.deltaY * zoomSpeed;
        radius = Math.max(2, radius);
        updateCamera(camera);
    });
}
const keys = {};
window.addEventListener("keydown", (e) => { keys[e.key.toLowerCase()] = true; });
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
function moveTarget(camera)
{
    const moveSpeed = 0.1;
    let forward = { x: target.x - camera.position.x, y: 0, z: target.z - camera.position.z };
    const length = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
    forward.x /= length; forward.z /= length;
    let right = { x: forward.z, z: -forward.x };
    if (keys["arrowup"] || keys["w"]) { target.x += forward.x * moveSpeed; target.z += forward.z * moveSpeed; }
    if (keys["arrowdown"] || keys["s"]) { target.x -= forward.x * moveSpeed; target.z -= forward.z * moveSpeed; }
    if (keys["arrowright"] || keys["d"]) { target.x -= right.x * moveSpeed;   target.z -= right.z * moveSpeed; }
    if (keys["arrowleft"] || keys["a"]) { target.x += right.x * moveSpeed;   target.z += right.z * moveSpeed; }
    updateCamera(camera);
}