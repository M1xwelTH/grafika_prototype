//Lists of Function section line placement in code:
//1) 2D coordinates testruns //line7
//2) Class and Objects //line ...
//3) Pathfinding

//2D coordinates
function getWebGLCoords(e)
{
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const x = (mouseX - rect.width / 2) / (rect.width / 2);
    const y = -(mouseY - rect.height / 2) / (rect.height / 2);
    return { x, y };
}

//Class and Objects here

//Pathfinding (divide graph into tiles later, ask GPT if must)