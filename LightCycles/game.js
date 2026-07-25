// ---------------------------------------------------------------------------
// Light Cycles — a Tron-style grid duel.
//
// State lives in top-level globals so the Playwright suite can drive the
// simulation deterministically (see tests/light-cycles.spec.js).
// ---------------------------------------------------------------------------

// --- Board geometry --------------------------------------------------------
const CELL = 20;
const COLS = 30;
const ROWS = 30;
const WIDTH = COLS * CELL;   // 600
const HEIGHT = ROWS * CELL;  // 600

// --- Tuning ----------------------------------------------------------------
const STEP_INTERVAL = 0.07;  // seconds between grid steps
const WIN_SCORE = 5;         // round wins needed to take the match
const BEST_KEY = 'light-cycles-best';

// --- Directions (screen coordinates, y grows downward) ---------------------
const DIRS = {
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
};

// --- Cell ownership in the occupancy grid ----------------------------------
const EMPTY = 0;
const PLAYER_ID = 1;
const CPU_ID = 2;

// --- Cycles ----------------------------------------------------------------
const player = { x: 5, y: 15, dir: DIRS.right, alive: true, id: PLAYER_ID, trail: 0 };
const cpu = { x: 24, y: 15, dir: DIRS.left, alive: true, id: CPU_ID, trail: 0 };

// --- Mutable game state ----------------------------------------------------
let grid = makeGrid();
let state = 'ready';        // 'ready' | 'running' | 'paused' | 'over'
let aiEnabled = true;
let playerScore = 0;
let cpuScore = 0;
let streak = 0;
let bestStreak = loadBest();
let lastTime = 0;
let stepTimer = 0;

// --- DOM refs --------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const elScoreP = document.getElementById('score-player');
const elScoreC = document.getElementById('score-cpu');
const elBest = document.getElementById('best');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeGrid() {
    const g = [];
    for (let y = 0; y < ROWS; y++) g.push(new Array(COLS).fill(EMPTY));
    return g;
}

function loadBest() {
    const v = parseInt(localStorage.getItem(BEST_KEY), 10);
    return Number.isFinite(v) ? v : 0;
}

function saveBest() {
    localStorage.setItem(BEST_KEY, String(bestStreak));
}

function isReverse(a, b) {
    return a.dx === -b.dx && a.dy === -b.dy;
}

function turnLeft(d) {
    return { dx: d.dy, dy: -d.dx };
}

function turnRight(d) {
    return { dx: -d.dy, dy: d.dx };
}

function inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

function isSafe(x, y) {
    return inBounds(x, y) && grid[y][x] === EMPTY;
}

// ---------------------------------------------------------------------------
// Round / match lifecycle
// ---------------------------------------------------------------------------
function resetRound() {
    grid = makeGrid();

    player.x = 5;
    player.y = 15;
    player.dir = DIRS.right;
    player.alive = true;
    player.trail = 0;

    cpu.x = COLS - 6;
    cpu.y = 15;
    cpu.dir = DIRS.left;
    cpu.alive = true;
    cpu.trail = 0;

    grid[player.y][player.x] = PLAYER_ID;
    grid[cpu.y][cpu.x] = CPU_ID;

    stepTimer = 0;
}

function startGame() {
    playerScore = 0;
    cpuScore = 0;
    streak = 0;
    aiEnabled = true;
    resetRound();
    updateHUD();
    hideOverlay();
    state = 'running';
    lastTime = 0;
}

function endMatch(winner) {
    state = 'over';
    const won = winner === 'player';
    overlayTitle.textContent = won ? 'You Win!' : 'Game Over';
    overlayScore.textContent = `${playerScore} — ${cpuScore}`;
    overlaySub.textContent = won
        ? 'You out-ran the grid. Ride again?'
        : 'The CPU boxed you in. Try again?';
    btnStart.textContent = 'Play Again';
    showOverlay();
}

// Resolve the outcome of the step that was just applied. Called from step().
function resolveRound() {
    const pDead = !player.alive;
    const cDead = !cpu.alive;

    if (!pDead && !cDead) return; // both still riding — round continues

    if (pDead && cDead) {
        // draw — no score, streak unchanged
    } else if (pDead) {
        cpuScore++;
        streak = 0;
    } else if (cDead) {
        playerScore++;
        streak++;
        if (streak > bestStreak) {
            bestStreak = streak;
            saveBest();
        }
    }

    updateHUD();

    if (playerScore >= WIN_SCORE) { endMatch('player'); return; }
    if (cpuScore >= WIN_SCORE) { endMatch('cpu'); return; }

    resetRound();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function cpuThink() {
    if (!cpu.alive) return;
    // Greedy, deterministic: prefer straight, then left, then right.
    const options = [cpu.dir, turnLeft(cpu.dir), turnRight(cpu.dir)];
    for (const d of options) {
        if (isSafe(cpu.x + d.dx, cpu.y + d.dy)) {
            cpu.dir = d;
            return;
        }
    }
    // No safe move — keep going straight and crash.
}

// Advance the whole board by exactly one grid cell.
function step() {
    if (state === 'over') return;

    if (aiEnabled) cpuThink();

    const movers = [player, cpu].filter((c) => c.alive);
    const plans = movers.map((c) => ({
        c,
        nx: c.x + c.dir.dx,
        ny: c.y + c.dir.dy,
        dead: false,
    }));

    // Independent crashes: wall or an occupied cell.
    for (const p of plans) {
        if (!isSafe(p.nx, p.ny)) p.dead = true;
    }

    // Head-on: two cycles entering the same cell this step.
    if (plans.length === 2 &&
        plans[0].nx === plans[1].nx &&
        plans[0].ny === plans[1].ny) {
        plans[0].dead = true;
        plans[1].dead = true;
    }

    // Apply.
    for (const p of plans) {
        if (p.dead) {
            p.c.alive = false;
        } else {
            p.c.x = p.nx;
            p.c.y = p.ny;
            grid[p.ny][p.nx] = p.c.id;
            p.c.trail++;
        }
    }

    resolveRound();
}

function update(dt) {
    stepTimer += dt;
    // Guard against huge dt (e.g. tab regaining focus) running away.
    if (stepTimer > STEP_INTERVAL * 5) stepTimer = STEP_INTERVAL * 5;
    while (stepTimer >= STEP_INTERVAL) {
        stepTimer -= STEP_INTERVAL;
        step();
        if (state !== 'running' && state !== 'paused') break;
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawGrid() {
    ctx.strokeStyle = '#0c1830';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= COLS; x++) {
        ctx.moveTo(x * CELL + 0.5, 0);
        ctx.lineTo(x * CELL + 0.5, HEIGHT);
    }
    for (let y = 0; y <= ROWS; y++) {
        ctx.moveTo(0, y * CELL + 0.5);
        ctx.lineTo(WIDTH, y * CELL + 0.5);
    }
    ctx.stroke();
}

function drawTrails() {
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const v = grid[y][x];
            if (v === EMPTY) continue;
            ctx.fillStyle = v === PLAYER_ID ? '#0e7490' : '#9a3412';
            ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
        }
    }
}

function drawHead(c, color, glow) {
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    ctx.fillRect(c.x * CELL + 1, c.y * CELL + 1, CELL - 2, CELL - 2);
    ctx.restore();
}

function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawGrid();
    drawTrails();
    if (player.alive) drawHead(player, '#22d3ee', '#22d3ee');
    if (cpu.alive) drawHead(cpu, '#fb923c', '#fb923c');
}

// ---------------------------------------------------------------------------
// Overlay & HUD
// ---------------------------------------------------------------------------
function updateHUD() {
    elScoreP.textContent = String(playerScore);
    elScoreC.textContent = String(cpuScore);
    elBest.textContent = String(bestStreak);
}

function showOverlay() { overlay.classList.add('visible'); }
function hideOverlay() { overlay.classList.remove('visible'); }

function pauseGame() {
    if (state !== 'running') return;
    state = 'paused';
    overlayTitle.textContent = 'Paused';
    overlayScore.textContent = '';
    overlaySub.textContent = 'Press P to resume';
    btnStart.textContent = 'Resume';
    showOverlay();
}

function resumeGame() {
    if (state !== 'paused') return;
    state = 'running';
    hideOverlay();
    lastTime = 0;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function steer(dir) {
    if (!player.alive) return;
    if (isReverse(dir, player.dir)) return; // no direct 180° flip
    player.dir = dir;
}

const KEY_DIRS = {
    ArrowUp: DIRS.up, w: DIRS.up, W: DIRS.up,
    ArrowDown: DIRS.down, s: DIRS.down, S: DIRS.down,
    ArrowLeft: DIRS.left, a: DIRS.left, A: DIRS.left,
    ArrowRight: DIRS.right, d: DIRS.right, D: DIRS.right,
};

window.addEventListener('keydown', (e) => {
    const key = e.key;

    if (key === 'p' || key === 'P') {
        e.preventDefault();
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        if (state === 'ready' || state === 'over') startGame();
        return;
    }

    const dir = KEY_DIRS[key];
    if (!dir) return;
    e.preventDefault();

    if (state === 'ready' || state === 'over') {
        startGame();
    }
    if (state === 'running') {
        steer(dir);
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function loop(ts) {
    if (!lastTime) lastTime = ts;
    const dt = Math.min((ts - lastTime) / 1000, 0.1);
    lastTime = ts;

    if (state === 'running') update(dt);
    render();

    requestAnimationFrame(loop);
}

updateHUD();
resetRound();
render();
requestAnimationFrame(loop);
