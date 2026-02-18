const canvas = document.getElementById("glcanvas");
//Match internal canvas resolution with CSS size
canvas.width = 1000;
canvas.height = 600;
const gl = canvas.getContext("webgl");
const coordsDisp = document.getElementById("coordsDisp");
if (!gl) { alert("WebGL not supported"); }
function makeShader3D(gl, type, src)
{
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
}
const prog3D = gl3D.createProgram();
gl3D.attachShader(prog3D, makeShader3D(gl3D, gl3D.VERTEX_SHADER, vs3D));
gl3D.attachShader(prog3D, makeShader3D(gl3D, gl3D.FRAGMENT_SHADER, fs3D));
gl3D.linkProgram(prog3D);
gl3D.useProgram(prog3D);
//Convert Mouse → WebGL Coordinates
function getWebGLCoords(e)
{
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const x = (mouseX / rect.width) * 2 - 1;
    const y = -((mouseY / rect.height) * 2 - 1);
    return { x, y };
}
//Mouse Tracking
canvas.addEventListener
("mousemove", (e) => {
    const coords = getWebGLCoords(e);
    coordsDisp.textContent = `X: ${coords.x.toFixed(3)} , Y: ${coords.y.toFixed(3)}`;
});