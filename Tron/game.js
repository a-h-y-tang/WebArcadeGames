// --- Arena dimensions ---
const COLS = 40;
const ROWS = 40;
const CELL = 12;                 // 40 * 12 = 480px canvas
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL;

// --- Match rules & timing ---
const TARGET_WINS = 5;           // first to this many round wins takes the match
const TICK_MS = 60;              // real-time cadence of one simulation tick
const ROUND_BREAK = 1100;        // pause (ms) shown between rounds

// Occupancy codes.
const EMPTY = 0;
const P_TRAIL = 1;               // player trail / head
const C_TRAIL = 2;               // cpu trail / head

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const youEl = document.getElementById('you');
const cpuEl = document.getElementById('cpu');
const roundEl = document.getElementById('round');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State (exposed as page globals for the test suite) ---
let player, cpu, occupied, youWins, cpuWins, round, best, state;
let lastRoundWinner = null;
let lastTime, acc, breakTimer, animId;

// -----------------------------------------------------------------------
// Geometry helpers
// -----------------------------------------------------------------------
function inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

function cellBlocked(x, y) {
    return !inBounds(x, y) || occupied[y][x] !== EMPTY;
}

function turnLeft(d) {
    return { dx: d.dy, dy: -d.dx };
}

function turnRight(d) {
    return { dx: -d.dy, dy: d.dx };
}

function isReverse(a, b) {
    return a.dx === -b.dx && a.dy === -b.dy;
}

// -----------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------
function spawnCycles() {
    occupied = Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
    const midY = Math.floor(ROWS / 2);
    player = { x: 5, y: midY, dir: { dx: 1, dy: 0 }, pendingDir: null, alive: true, id: P_TRAIL };
    cpu = { x: COLS - 6, y: midY, dir: { dx: -1, dy: 0 }, pendingDir: null, alive: true, id: C_TRAIL };
    occupied[player.y][player.x] = P_TRAIL;
    occupied[cpu.y][cpu.x] = C_TRAIL;
}

function updateHud() {
    youEl.textContent = youWins;
    cpuEl.textContent = cpuWins;
    roundEl.textContent = round;
    bestEl.textContent = best;
}

// -----------------------------------------------------------------------
// Simulation — one tick moves both cycles a single cell
// -----------------------------------------------------------------------
function applyPending(cyc) {
    if (cyc.pendingDir && !isReverse(cyc.pendingDir, cyc.dir)) {
        cyc.dir = cyc.pendingDir;
    }
    cyc.pendingDir = null;
}

// Deterministic 1-step look-ahead: straight, else left, else right.
function aiDecide() {
    if (!cpu.alive) return;
    const options = [cpu.dir, turnLeft(cpu.dir), turnRight(cpu.dir)];
    for (const d of options) {
        if (!cellBlocked(cpu.x + d.dx, cpu.y + d.dy)) {
            cpu.pendingDir = d;
            return;
        }
    }
    cpu.pendingDir = cpu.dir; // boxed in — drive straight and perish
}

function step() {
    if (state !== 'running') return;

    aiDecide();
    applyPending(player);
    applyPending(cpu);

    const cycles = [player, cpu].filter(c => c.alive);
    const moves = cycles.map(c => ({ c, x: c.x + c.dir.dx, y: c.y + c.dir.dy, dead: false }));

    // Walls & existing trails (includes each cycle's current head cell).
    for (const m of moves) {
        if (cellBlocked(m.x, m.y)) m.dead = true;
    }
    // Head-on: two cycles targeting the same cell this tick both die.
    for (let i = 0; i < moves.length; i++) {
        for (let j = i + 1; j < moves.length; j++) {
            if (moves[i].x === moves[j].x && moves[i].y === moves[j].y) {
                moves[i].dead = true;
                moves[j].dead = true;
            }
        }
    }
    // Commit surviving moves.
    for (const m of moves) {
        if (m.dead) {
            m.c.alive = false;
        } else {
            m.c.x = m.x;
            m.c.y = m.y;
            occupied[m.y][m.x] = m.c.id;
        }
    }

    if (!player.alive || !cpu.alive) resolveRound();
}

// -----------------------------------------------------------------------
// Round & match lifecycle
// -----------------------------------------------------------------------
function resolveRound() {
    if (!player.alive && !cpu.alive) {
        lastRoundWinner = 'tie';
    } else if (!player.alive) {
        lastRoundWinner = 'cpu';
        cpuWins++;
    } else {
        lastRoundWinner = 'you';
        youWins++;
    }
    updateHud();

    if (youWins >= TARGET_WINS || cpuWins >= TARGET_WINS) {
        endGame();
    } else {
        state = 'roundover';
        breakTimer = ROUND_BREAK;
    }
}

function nextRound() {
    round++;
    spawnCycles();
    updateHud();
    state = 'running';
    lastTime = null;
    acc = 0;
}

function startGame() {
    youWins = 0;
    cpuWins = 0;
    round = 1;
    lastRoundWinner = null;
    spawnCycles();
    updateHud();
    state = 'running';
    overlay.classList.remove('visible');
    lastTime = null;
    acc = 0;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    if (youWins > best) {
        best = youWins;
        localStorage.setItem('tron-best', best);
    }
    const win = youWins > cpuWins;
    overlayTitle.textContent = win ? 'You Win!' : 'CPU Wins';
    overlayScore.textContent = `${youWins} – ${cpuWins}`;
    overlaySub.textContent = 'Press Space to play again';
    btnStart.textContent = 'Play Again';
    updateHud();
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
    overlay.classList.remove('visible');
    lastTime = null;
    animId = requestAnimationFrame(loop);
}

// -----------------------------------------------------------------------
// Main loop — fixed-timestep accumulator
// -----------------------------------------------------------------------
function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = Math.min(200, timestamp - lastTime);
    lastTime = timestamp;

    if (state === 'running') {
        acc += elapsed;
        while (acc >= TICK_MS) {
            acc -= TICK_MS;
            step();
            if (state !== 'running') break;
        }
    } else if (state === 'roundover') {
        breakTimer -= elapsed;
        if (breakTimer <= 0) nextRound();
    }

    draw();

    if (state === 'running' || state === 'roundover') {
        animId = requestAnimationFrame(loop);
    }
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function draw() {
    ctx.fillStyle = '#06080f';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Faint grid.
    ctx.strokeStyle = '#0d1a2b';
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

    // Trails.
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const v = occupied[y][x];
            if (v === EMPTY) continue;
            ctx.fillStyle = v === P_TRAIL ? '#0e7490' : '#9a3412';
            ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
    }

    // Cycle heads with a glow.
    drawHead(player, '#22d3ee', '#22d3ee');
    drawHead(cpu, '#fb923c', '#f97316');

    if (state === 'roundover') {
        ctx.fillStyle = 'rgba(6, 8, 15, 0.35)';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
}

function drawHead(cyc, color, glow) {
    if (!cyc) return;
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = cyc.alive ? 14 : 0;
    ctx.fillStyle = cyc.alive ? color : '#4b5563';
    ctx.fillRect(cyc.x * CELL, cyc.y * CELL, CELL, CELL);
    ctx.restore();
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
const DIR_KEYS = {
    ArrowUp: { dx: 0, dy: -1 }, w: { dx: 0, dy: -1 }, W: { dx: 0, dy: -1 },
    ArrowDown: { dx: 0, dy: 1 }, s: { dx: 0, dy: 1 }, S: { dx: 0, dy: 1 },
    ArrowLeft: { dx: -1, dy: 0 }, a: { dx: -1, dy: 0 }, A: { dx: -1, dy: 0 },
    ArrowRight: { dx: 1, dy: 0 }, d: { dx: 1, dy: 0 }, D: { dx: 1, dy: 0 },
};
const START_KEYS = [' ', ...Object.keys(DIR_KEYS)];

document.addEventListener('keydown', e => {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    if ((state === 'idle' || state === 'over') && START_KEYS.includes(k)) {
        startGame();
        e.preventDefault();
        return;
    }

    if (state === 'running' && DIR_KEYS[k]) {
        player.pendingDir = DIR_KEYS[k];
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
best = parseInt(localStorage.getItem('tron-best') || '0', 10);
youWins = 0;
cpuWins = 0;
round = 1;
state = 'idle';
spawnCycles();
updateHud();
draw();
