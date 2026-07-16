// --- Constants ---
const CANVAS_W = 400;
const CANVAS_H = 600;
const BLOCK_H = 40;        // pixel height of every block row
const INITIAL_W = 120;     // starting (and maximum) block width
const PERFECT_TOL = 6;     // px: within this, a drop counts as "perfect"
const PERFECT_REGROW = 8;  // px width recovered on a perfect drop

// Horizontal speed of the moving block (px/sec), scaling with score.
const SPEED_BASE = 140;
const SPEED_STEP = 10;
const SPEED_MAX = 380;

// Where the moving block sits on screen; the camera scrolls to keep it here.
const ACTIVE_SCREEN_Y = 150;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let tower;      // array of placed { x, w } blocks; tower[0] is the base
let current;    // the moving { x, w, dir } block
let score;
let best;
let state;      // 'idle' | 'running' | 'over'
let lastTime;
let animId;

function speed(s) {
    return Math.min(SPEED_MAX, SPEED_BASE + s * SPEED_STEP);
}

function spawnBlock() {
    // New block inherits the width of the block it will land on, and slides in
    // from the left wall.
    const top = tower[tower.length - 1];
    current = { x: 0, w: top.w, dir: 1 };
}

function startGame() {
    tower = [{ x: (CANVAS_W - INITIAL_W) / 2, w: INITIAL_W }];
    score = 0;
    spawnBlock();
    state = 'running';
    lastTime = null;

    scoreEl.textContent = score;
    overlay.classList.remove('visible');

    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('tower-stack-best', best);
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} pts`;
    overlaySub.textContent = 'Press space (or tap) to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

// Drop the moving block onto the tower top. Trims the overhang; a near-perfect
// alignment keeps (and slightly regrows) the width and scores a bonus.
function dropBlock() {
    if (state !== 'running') return;

    const top = tower[tower.length - 1];
    const overlapLeft = Math.max(current.x, top.x);
    const overlapRight = Math.min(current.x + current.w, top.x + top.w);
    const overlap = overlapRight - overlapLeft;

    if (overlap <= 0) {
        endGame();
        return;
    }

    let placed;
    if (Math.abs(current.x - top.x) <= PERFECT_TOL) {
        // Perfect: snap onto the block below, regrow a little (capped), bonus.
        const w = Math.min(INITIAL_W, top.w + PERFECT_REGROW);
        const x = top.x - (w - top.w) / 2; // stay centered over the block below
        placed = { x, w };
        score += 2;
    } else {
        placed = { x: overlapLeft, w: overlap };
        score += 1;
    }

    tower.push(placed);
    scoreEl.textContent = score;
    spawnBlock();
}

// --- Game loop (timestamp-driven) ---
function loop(timestamp) {
    if (state !== 'running') return;

    if (lastTime == null) lastTime = timestamp;
    const dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    // Move + bounce the active block.
    current.x += current.dir * speed(score) * dt;
    if (current.x <= 0) {
        current.x = 0;
        current.dir = 1;
    } else if (current.x + current.w >= CANVAS_W) {
        current.x = CANVAS_W - current.w;
        current.dir = -1;
    }

    draw();
    animId = requestAnimationFrame(loop);
}

// --- Rendering ---
function blockColor(row) {
    const hue = (200 + row * 12) % 360;
    return `hsl(${hue}, 65%, 58%)`;
}

function cameraOffset() {
    const activeRow = tower.length; // the moving block's row
    return Math.max(0, (activeRow + 1) * BLOCK_H - (CANVAS_H - ACTIVE_SCREEN_Y));
}

function drawBlock(x, w, row, offset, color) {
    const y = CANVAS_H - (row + 1) * BLOCK_H + offset;
    if (y > CANVAS_H || y + BLOCK_H < 0) return; // off-screen, skip
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y + 1, w, BLOCK_H - 2, 4);
    ctx.fill();
    ctx.stroke();
    // Glossy top edge.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.roundRect(x, y + 1, w, (BLOCK_H - 2) / 2, 4);
    ctx.fill();
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#141b26');
    grad.addColorStop(1, '#0d1117');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const offset = cameraOffset();
    for (let i = 0; i < tower.length; i++) {
        drawBlock(tower[i].x, tower[i].w, i, offset, blockColor(i));
    }
    if (state === 'running' && current) {
        drawBlock(current.x, current.w, tower.length, offset, blockColor(tower.length));
    }
}

// --- Input ---
function handleAction() {
    if (state === 'running') {
        dropBlock();
    } else {
        startGame();
    }
}

document.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        handleAction();
    }
});

canvas.addEventListener('click', () => handleAction());
canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    handleAction();
}, { passive: false });

btnStart.addEventListener('click', () => startGame());

// --- Init ---
best = parseInt(localStorage.getItem('tower-stack-best') || '0', 10);
bestEl.textContent = best;
state = 'idle';
score = 0;

// Seed a valid model so the first draw (and the initial-state tests) work.
tower = [{ x: (CANVAS_W - INITIAL_W) / 2, w: INITIAL_W }];
current = { x: 0, w: INITIAL_W, dir: 1 };
draw();
