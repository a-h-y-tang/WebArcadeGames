// ---------------------------------------------------------------------------
// Stacker — the arcade tower-builder. A block slides back and forth at the top
// of the tower; tap to drop it. Any overhang past the block below is sliced off,
// so the tower narrows with every imperfect drop. Miss entirely and it's over.
//
// Motion is time-based (pixels per second) and integrated by `update(dt)`
// (seconds), which only slides the active block. The core game logic lives in
// `drop()` — a pure, event-driven step with no `state` gate — so tests can set
// up an exact geometry and assert the trim / score / game-over result.
// ---------------------------------------------------------------------------

const WIDTH = 480;
const HEIGHT = 640;

// Tunables
const BLOCK_H = 40;              // block height (px)
const BASE_W = 200;              // full / starting block width (px)
const START_SPEED = 120;         // slide speed of the first block (px / second)
const SPEED_RAMP = 12;           // added slide speed per block placed
const PERFECT_TOL = 4;           // px of misalignment still counted as "perfect"
const GROW = 8;                  // width regained (toward BASE_W) on a perfect drop
const ACTIVE_ROW_Y = HEIGHT * 0.30; // fixed screen y where the sliding block sits
const VISIBLE_ROWS = Math.ceil((HEIGHT - ACTIVE_ROW_Y) / BLOCK_H) + 1;

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
// tower: array of { x, w } bottom-to-top (geometry only; y is derived at draw).
// active: the sliding block { x, w, vx } waiting to be dropped.
let tower, active, score, best, state, lastTime, animId;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function updateScore() {
    scoreEl.textContent = score;
}

function updateBest() {
    bestEl.textContent = best;
}

// Spawn the next sliding block: it matches the current top width and starts at
// the left wall, sliding right. Speed ramps up with the tower's height.
function spawnActive() {
    const top = tower[tower.length - 1];
    const speed = START_SPEED + (tower.length - 1) * SPEED_RAMP;
    active = { x: 0, w: top.w, vx: speed };
}

// ---------------------------------------------------------------------------
// Physics — slide the active block. No `state` gating on purpose.
// ---------------------------------------------------------------------------
function update(dt) {
    active.x += active.vx * dt;
    if (active.x < 0) {
        active.x = 0;
        active.vx = Math.abs(active.vx);
    } else if (active.x + active.w > WIDTH) {
        active.x = WIDTH - active.w;
        active.vx = -Math.abs(active.vx);
    }
}

// ---------------------------------------------------------------------------
// Drop — the core trim / score / spawn / game-over step.
// ---------------------------------------------------------------------------
function drop() {
    const top = tower[tower.length - 1];
    const left = Math.max(active.x, top.x);
    const right = Math.min(active.x + active.w, top.x + top.w);
    const overlap = right - left;

    if (overlap <= 0) {
        endGame();
        return;
    }

    let newX = left;
    let newW = overlap;

    // A near-perfect drop keeps its width and regrows a little toward BASE_W,
    // centred on the block below, so a skilled player can recover from trims.
    if (Math.abs(active.x - top.x) <= PERFECT_TOL) {
        newW = Math.min(BASE_W, top.w + GROW);
        newX = clamp(top.x - (newW - top.w) / 2, 0, WIDTH - newW);
    }

    tower.push({ x: newX, w: newW });
    score++;
    updateScore();
    spawnActive();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function startGame() {
    tower = [{ x: (WIDTH - BASE_W) / 2, w: BASE_W }];
    score = 0;
    updateScore();
    spawnActive();

    overlay.classList.remove('visible');
    state = 'running';
    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        localStorage.setItem('stacker-best', best);
        updateBest();
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = score;
    overlaySub.textContent = 'Nice tower! Press Space to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function pauseGame() {
    state = 'paused';
    overlayTitle.textContent = 'Paused';
    overlayScore.textContent = '';
    overlaySub.textContent = 'Press P to resume';
    btnStart.textContent = 'Resume';
    overlay.classList.add('visible');
}

function resumeGame() {
    state = 'running';
    lastTime = null;
    overlay.classList.remove('visible');
    animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
function loop(timestamp) {
    if (state !== 'running') return;
    if (lastTime == null) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.05) dt = 0.05; // clamp big gaps (tab switches)

    update(dt);
    draw();
    if (state === 'running') animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Rendering — the top of the tower is drawn just below the sliding block, and
// each lower block one row further down, giving the illusion of a rising camera.
// ---------------------------------------------------------------------------
const HUES = [199, 152, 33, 280, 340, 48]; // cycle of block colours

function blockColor(index) {
    return `hsl(${HUES[index % HUES.length]}, 70%, 58%)`;
}

function draw() {
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const topIndex = tower.length - 1;
    for (let d = 0; d < VISIBLE_ROWS; d++) {
        const i = topIndex - d;
        if (i < 0) break;
        const b = tower[i];
        const y = ACTIVE_ROW_Y + BLOCK_H + d * BLOCK_H;
        drawBlock(b.x, y, b.w, blockColor(i));
    }

    // The sliding block (only while there is a live game).
    if (state === 'running' || state === 'paused') {
        drawBlock(active.x, ACTIVE_ROW_Y, active.w, blockColor(tower.length), true);
    }
}

function drawBlock(x, y, w, color, glow) {
    if (glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
    }
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, BLOCK_H - 2);
    ctx.shadowBlur = 0;
    // a subtle top highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.fillRect(x, y, w, 5);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function isDropKey(k) {
    return k === ' ' || k === 'Spacebar' || k === 'Enter' || k === 'ArrowDown';
}

function handleAction() {
    if (state === 'running') drop();
    else if (state !== 'paused') startGame(); // idle / over → new game
}

document.addEventListener('keydown', e => {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    if (isDropKey(k)) {
        e.preventDefault();
        handleAction();
    }
});

canvas.addEventListener('pointerdown', () => {
    if (state === 'paused') return;
    handleAction();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init — a still frame behind the start overlay.
// ---------------------------------------------------------------------------
best = parseInt(localStorage.getItem('stacker-best') || '0', 10);
updateBest();
score = 0;
tower = [{ x: (WIDTH - BASE_W) / 2, w: BASE_W }];
spawnActive();
state = 'idle';
draw();
