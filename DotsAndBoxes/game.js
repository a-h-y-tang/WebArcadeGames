// Dots and Boxes — deterministic human (Blue) vs computer (Red).
// Core state and helpers are page-level globals so the Playwright suite can
// drive and inspect the game via page.evaluate.

const SIZE = 4;              // boxes per side (4x4 = 16 boxes, 5x5 dots)
const GAP = 90;             // pixels between adjacent dots
const MARGIN = 45;         // border padding to the outer dots
const HIT = 40;            // click hit-radius to the nearest edge midpoint

const HUMAN = 1;   // blue
const AI = 2;      // red

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const scoreBlueEl = document.getElementById('score-blue');
const scoreRedEl = document.getElementById('score-red');
const turnEl = document.getElementById('turn');

const CLR = {
    bg:        '#0d1117',
    dot:       '#30363d',
    edgeEmpty: '#1c2330',
    blue:      '#38bdf8',
    red:       '#f87171',
    blueFill:  'rgba(56, 189, 248, 0.22)',
    redFill:   'rgba(248, 113, 113, 0.22)',
    hover:     '#e6edf3',
};

// --- State ---
let hEdges;         // hEdges[r][c], r in 0..SIZE, c in 0..SIZE-1
let vEdges;         // vEdges[r][c], r in 0..SIZE-1, c in 0..SIZE
let boxes;          // boxes[r][c], r,c in 0..SIZE-1
let currentPlayer;  // HUMAN or AI
let state;          // 'idle' | 'playing' | 'over'
let scores;         // { 1: blue, 2: red }
let winner;         // 0 none/draw, 1 blue, 2 red
let hover;          // { type, r, c } nearest edge under the pointer, or null

function makeGrid(rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(0));
}

// --- Edge helpers ------------------------------------------------------
function edgeInRange(type, r, c) {
    if (type === 'h') return r >= 0 && r <= SIZE && c >= 0 && c < SIZE;
    if (type === 'v') return r >= 0 && r < SIZE && c >= 0 && c <= SIZE;
    return false;
}

function edgeGet(type, r, c) {
    return type === 'h' ? hEdges[r][c] : vEdges[r][c];
}

function edgeSet(type, r, c, value) {
    if (type === 'h') hEdges[r][c] = value;
    else vEdges[r][c] = value;
}

function edgeDrawn(type, r, c) {
    return edgeInRange(type, r, c) && edgeGet(type, r, c) !== 0;
}

// Number of drawn sides of box (r, c).
function sidesOfBox(r, c) {
    let n = 0;
    if (hEdges[r][c]) n++;       // top
    if (hEdges[r + 1][c]) n++;   // bottom
    if (vEdges[r][c]) n++;       // left
    if (vEdges[r][c + 1]) n++;   // right
    return n;
}

// The boxes adjacent to an edge (0, 1, or 2 of them).
function boxesTouching(type, r, c) {
    const out = [];
    if (type === 'h') {
        if (r - 1 >= 0) out.push([r - 1, c]);      // box above
        if (r < SIZE) out.push([r, c]);            // box below
    } else {
        if (c - 1 >= 0) out.push([r, c - 1]);      // box left
        if (c < SIZE) out.push([r, c]);            // box right
    }
    return out;
}

function isBoardFull() {
    return boxes.every((row) => row.every((v) => v !== 0));
}

// Draw one edge for the current player. Returns the number of boxes completed
// (0, 1, or 2), or -1 for an illegal/duplicate move.
function drawEdge(type, r, c) {
    if (state === 'over') return -1;
    if (!edgeInRange(type, r, c)) return -1;
    if (edgeGet(type, r, c) !== 0) return -1;

    const player = currentPlayer;
    edgeSet(type, r, c, player);

    let completed = 0;
    for (const [br, bc] of boxesTouching(type, r, c)) {
        if (boxes[br][bc] === 0 && sidesOfBox(br, bc) === 4) {
            boxes[br][bc] = player;
            scores[player]++;
            completed++;
        }
    }

    if (isBoardFull()) {
        state = 'over';
        winner = scores[1] > scores[2] ? 1 : scores[2] > scores[1] ? 2 : 0;
    } else if (completed === 0) {
        currentPlayer = player === HUMAN ? AI : HUMAN;
    }
    return completed;
}

// --- Deterministic computer opponent -----------------------------------
// All undrawn edges, in a fixed order: horizontals row-major, then verticals.
function availableEdges() {
    const out = [];
    for (let r = 0; r <= SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (hEdges[r][c] === 0) out.push({ type: 'h', r, c });
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c <= SIZE; c++)
            if (vEdges[r][c] === 0) out.push({ type: 'v', r, c });
    return out;
}

// Highest side-count this edge would raise any adjacent box to.
function resultingMaxSides(type, r, c) {
    let max = 0;
    for (const [br, bc] of boxesTouching(type, r, c)) {
        if (boxes[br][bc] !== 0) continue;
        const after = sidesOfBox(br, bc) + 1;
        if (after > max) max = after;
    }
    return max;
}

// Deterministic heuristic: take a box > play safe > give the least.
function chooseAiMove() {
    const edges = availableEdges();
    if (edges.length === 0) return null;

    // 1. Complete a box if possible.
    for (const e of edges) if (resultingMaxSides(e.type, e.r, e.c) === 4) return e;

    // 2. Otherwise a safe edge that does not hand a box its third side.
    for (const e of edges) if (resultingMaxSides(e.type, e.r, e.c) < 3) return e;

    // 3. Everything left is unsafe — give away the first available edge.
    return edges[0];
}

function aiTurn() {
    if (state !== 'playing' || currentPlayer !== AI) return;
    const move = chooseAiMove();
    if (!move) return;
    drawEdge(move.type, move.r, move.c);
    updateHud();
    draw();
    if (state === 'over') {
        endGame();
    } else if (currentPlayer === AI) {
        setTimeout(aiTurn, 400); // completed a box → chain another move
    }
}

// --- Game flow ---------------------------------------------------------
function startGame() {
    hEdges = makeGrid(SIZE + 1, SIZE);
    vEdges = makeGrid(SIZE, SIZE + 1);
    boxes = makeGrid(SIZE, SIZE);
    currentPlayer = HUMAN;
    state = 'playing';
    scores = { 1: 0, 2: 0 };
    winner = 0;
    hover = null;
    overlay.classList.remove('visible');
    updateHud();
    draw();
}

function endGame() {
    state = 'over';
    if (winner === HUMAN) {
        overlayTitle.textContent = 'You win!';
        overlaySub.textContent = `You took ${scores[1]} boxes to ${scores[2]}.`;
    } else if (winner === AI) {
        overlayTitle.textContent = 'Computer wins';
        overlaySub.textContent = `The computer took ${scores[2]} boxes to ${scores[1]}.`;
    } else {
        overlayTitle.textContent = "It's a draw!";
        overlaySub.textContent = `Both sides took ${scores[1]} boxes.`;
    }
    btnStart.textContent = 'New Game';
    overlay.classList.add('visible');
}

function updateHud() {
    scoreBlueEl.textContent = scores[1];
    scoreRedEl.textContent = scores[2];
    if (state !== 'playing') return;
    turnEl.textContent = currentPlayer === HUMAN ? 'Your turn' : 'CPU thinking…';
}

// Human commits one edge, then (if the turn passed) the computer replies.
function humanMove(type, r, c) {
    if (state !== 'playing' || currentPlayer !== HUMAN) return;
    const completed = drawEdge(type, r, c);
    if (completed === -1) return;
    updateHud();
    draw();
    if (state === 'over') {
        endGame();
        return;
    }
    if (currentPlayer === AI) setTimeout(aiTurn, 400);
}

// --- Geometry ----------------------------------------------------------
function dotX(c) { return MARGIN + c * GAP; }
function dotY(r) { return MARGIN + r * GAP; }

// Midpoint of an edge in canvas coordinates.
function edgeMidpoint(type, r, c) {
    if (type === 'h') return { x: dotX(c) + GAP / 2, y: dotY(r) };
    return { x: dotX(c), y: dotY(r) + GAP / 2 };
}

// Nearest undrawn edge to a canvas point, within HIT pixels, or null.
function nearestEdge(x, y) {
    let best = null;
    let bestDist = HIT;
    for (const e of availableEdges()) {
        const m = edgeMidpoint(e.type, e.r, e.c);
        const d = Math.hypot(m.x - x, m.y - y);
        if (d < bestDist) {
            bestDist = d;
            best = e;
        }
    }
    return best;
}

// --- Rendering ---------------------------------------------------------
function playerColor(v) {
    return v === HUMAN ? CLR.blue : v === AI ? CLR.red : CLR.edgeEmpty;
}

function drawLine(type, r, c, color, width) {
    const a = type === 'h'
        ? { x: dotX(c), y: dotY(r) }
        : { x: dotX(c), y: dotY(r) };
    const b = type === 'h'
        ? { x: dotX(c + 1), y: dotY(r) }
        : { x: dotX(c), y: dotY(r + 1) };
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.stroke();
}

function draw() {
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Claimed box fills.
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (boxes[r][c] === 0) continue;
            ctx.fillStyle = boxes[r][c] === HUMAN ? CLR.blueFill : CLR.redFill;
            ctx.fillRect(dotX(c) + 4, dotY(r) + 4, GAP - 8, GAP - 8);
            // Owner initial.
            ctx.fillStyle = boxes[r][c] === HUMAN ? CLR.blue : CLR.red;
            ctx.font = '600 22px Segoe UI, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(
                boxes[r][c] === HUMAN ? 'You' : 'CPU',
                dotX(c) + GAP / 2,
                dotY(r) + GAP / 2
            );
        }
    }

    // Undrawn edge tracks (faint).
    for (let r = 0; r <= SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (!hEdges[r][c]) drawLine('h', r, c, CLR.edgeEmpty, 4);
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c <= SIZE; c++)
            if (!vEdges[r][c]) drawLine('v', r, c, CLR.edgeEmpty, 4);

    // Hover preview.
    if (state === 'playing' && currentPlayer === HUMAN && hover) {
        drawLine(hover.type, hover.r, hover.c, CLR.hover, 6);
    }

    // Drawn edges (colored by owner).
    for (let r = 0; r <= SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (hEdges[r][c]) drawLine('h', r, c, playerColor(hEdges[r][c]), 6);
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c <= SIZE; c++)
            if (vEdges[r][c]) drawLine('v', r, c, playerColor(vEdges[r][c]), 6);

    // Dots on top.
    ctx.fillStyle = CLR.dot;
    for (let r = 0; r <= SIZE; r++) {
        for (let c = 0; c <= SIZE; c++) {
            ctx.beginPath();
            ctx.arc(dotX(c), dotY(r), 5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// --- Input -------------------------------------------------------------
function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

canvas.addEventListener('mousemove', (e) => {
    if (state !== 'playing' || currentPlayer !== HUMAN) {
        if (hover) { hover = null; draw(); }
        return;
    }
    const { x, y } = pointerPos(e);
    const near = nearestEdge(x, y);
    const changed =
        (near && (!hover || near.type !== hover.type || near.r !== hover.r || near.c !== hover.c)) ||
        (!near && hover);
    hover = near;
    if (changed) draw();
});

canvas.addEventListener('mouseleave', () => {
    if (hover) { hover = null; draw(); }
});

canvas.addEventListener('click', (e) => {
    if (state !== 'playing' || currentPlayer !== HUMAN) return;
    const { x, y } = pointerPos(e);
    const near = nearestEdge(x, y);
    if (near) humanMove(near.type, near.r, near.c);
});

btnStart.addEventListener('click', startGame);

// --- Init --------------------------------------------------------------
hEdges = makeGrid(SIZE + 1, SIZE);
vEdges = makeGrid(SIZE, SIZE + 1);
boxes = makeGrid(SIZE, SIZE);
currentPlayer = HUMAN;
state = 'idle';
scores = { 1: 0, 2: 0 };
winner = 0;
hover = null;
draw();
