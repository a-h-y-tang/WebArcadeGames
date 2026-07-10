// ---------------------------------------------------------------------------
// Tron Light Cycles — a grid-based duel. You (cyan) vs. an AI (orange). Both
// cycles move one cell per tick and leave an impassable wall of light behind.
// The whole simulation advances through a single pure `step()` that moves both
// cycles exactly one cell, so tests can drive it deterministically with no
// reliance on wall-clock time or animation frames.
// ---------------------------------------------------------------------------

const WIDTH = 700;
const HEIGHT = 500;
const CELL = 10;
const COLS = WIDTH / CELL;   // 70
const ROWS = HEIGHT / CELL;  // 50

// Fixed simulation speed (seconds per grid step) — decoupled from frame rate.
const TICK = 0.09;

// How far ahead the CPU peers when scoring a candidate heading.
const AI_LOOKAHEAD = 12;

// Cell contents
const EMPTY = 0;
const P_TRAIL = 1;
const C_TRAIL = 2;

const DIRS = {
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
};

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const winsEl = document.getElementById('wins');
const lossesEl = document.getElementById('losses');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let grid, player, cpu, playerAlive, cpuAlive;
let wins, losses, streak, bestStreak, state;
let acc, lastTime, animId, cpuThinks;

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------
function inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

function cellAt(x, y) {
    if (!inBounds(x, y)) return -1;
    return grid[y * COLS + x];
}

function setCell(x, y, v) {
    if (inBounds(x, y)) grid[y * COLS + x] = v;
}

function clearGrid() {
    grid = new Array(COLS * ROWS).fill(EMPTY);
}

function gridFilledCount() {
    let n = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] !== EMPTY) n++;
    return n;
}

function isOpposite(a, b) {
    return a.dx === -b.dx && a.dy === -b.dy;
}

// Freeze the AI (tests use this to set up a deterministic cycle-vs-cycle case).
function stopCpuThinking() {
    cpuThinks = false;
}

// ---------------------------------------------------------------------------
// The CPU: greedily pick the safe heading with the most open space ahead.
// Never reverses; tie-breaks straight → left → right.
// ---------------------------------------------------------------------------
function freeAhead(x, y, dir) {
    // Count consecutive empty cells straight ahead, up to AI_LOOKAHEAD.
    let n = 0;
    let cx = x, cy = y;
    for (let i = 0; i < AI_LOOKAHEAD; i++) {
        cx += dir.dx; cy += dir.dy;
        if (cellAt(cx, cy) !== EMPTY) break; // wall or trail (or out of bounds)
        n++;
    }
    return n;
}

function leftOf(dir) {
    return { dx: dir.dy, dy: -dir.dx };
}

function rightOf(dir) {
    return { dx: -dir.dy, dy: dir.dx };
}

function cpuChooseDir() {
    const straight = cpu.dir;
    const candidates = [straight, leftOf(straight), rightOf(straight)];
    let best = straight;
    let bestScore = -1;
    for (const c of candidates) {
        const score = freeAhead(cpu.x, cpu.y, c);
        if (score > bestScore) {
            bestScore = score;
            best = c;
        }
    }
    cpu.nextDir = best;
}

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------
function queueTurn(who, dir) {
    if (isOpposite(dir, who.dir)) return; // no instant U-turn into your own wall
    who.nextDir = dir;
}

function queuePlayerTurn(name) {
    queueTurn(player, DIRS[name]);
}

// ---------------------------------------------------------------------------
// Simulation — one deterministic grid step for both cycles.
// ---------------------------------------------------------------------------
function step() {
    if (!playerAlive || !cpuAlive) return;

    if (cpuThinks) cpuChooseDir();

    // Commit queued turns.
    player.dir = player.nextDir;
    cpu.dir = cpu.nextDir;

    const pn = { x: player.x + player.dir.dx, y: player.y + player.dir.dy };
    const cn = { x: cpu.x + cpu.dir.dx, y: cpu.y + cpu.dir.dy };

    // A cell is fatal if it's off the board or already carries any trail.
    let pDead = cellAt(pn.x, pn.y) !== EMPTY;
    let cDead = cellAt(cn.x, cn.y) !== EMPTY;

    // Cycle-vs-cycle: head-on into the same cell, or swapping cells.
    if (pn.x === cn.x && pn.y === cn.y) { pDead = true; cDead = true; }
    if (pn.x === cpu.x && pn.y === cpu.y && cn.x === player.x && cn.y === player.y) {
        pDead = true; cDead = true;
    }

    // Advance survivors, stamping their new cell as trail.
    if (!pDead) { player.x = pn.x; player.y = pn.y; setCell(pn.x, pn.y, P_TRAIL); }
    if (!cDead) { cpu.x = cn.x; cpu.y = cn.y; setCell(cn.x, cn.y, C_TRAIL); }

    if (pDead) playerAlive = false;
    if (cDead) cpuAlive = false;

    if (!playerAlive || !cpuAlive) endRound();
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------
function endRound() {
    state = 'over';
    let title, sub;

    if (!playerAlive && !cpuAlive) {
        // Draw — a simultaneous crash. Counts as neither win nor loss.
        streak = 0;
        title = 'Draw';
        sub = 'You both crashed — press Space to race again';
    } else if (!cpuAlive) {
        // Player wins.
        wins++;
        streak++;
        if (streak > bestStreak) {
            bestStreak = streak;
            localStorage.setItem('tron-best-streak', bestStreak);
        }
        title = 'You Win!';
        sub = 'The CPU crashed — press Space to race again';
    } else {
        // Player crashed.
        losses++;
        streak = 0;
        title = 'Crashed!';
        sub = 'You hit a wall — press Space to try again';
    }

    updateHud();
    overlayTitle.textContent = title;
    overlayScore.textContent = streak > 0 ? `Streak: ${streak}` : '';
    overlaySub.textContent = sub;
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    draw();
}

function updateHud() {
    winsEl.textContent = wins;
    lossesEl.textContent = losses;
    bestEl.textContent = bestStreak;
}

function placeCycles() {
    const midY = Math.floor(ROWS / 2);
    player = { x: 10, y: midY, dir: DIRS.right, nextDir: DIRS.right };
    cpu = { x: COLS - 11, y: midY, dir: DIRS.left, nextDir: DIRS.left };
    setCell(player.x, player.y, P_TRAIL);
    setCell(cpu.x, cpu.y, C_TRAIL);
}

function startGame() {
    clearGrid();
    placeCycles();
    playerAlive = true;
    cpuAlive = true;
    cpuThinks = true;

    overlay.classList.remove('visible');
    state = 'running';
    acc = 0;
    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
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
// Game loop — accumulate real time and take fixed-size simulation steps.
// ---------------------------------------------------------------------------
function loop(timestamp) {
    if (state !== 'running') return;
    if (lastTime == null) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.25) dt = 0.25; // clamp big gaps (tab switches)

    acc += dt;
    while (acc >= TICK && state === 'running') {
        step();
        acc -= TICK;
    }

    draw();
    if (state === 'running') animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function draw() {
    // Background
    ctx.fillStyle = '#04070d';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Faint grid
    ctx.strokeStyle = '#0d1b2a';
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

    // Trails
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const v = grid[y * COLS + x];
            if (v === EMPTY) continue;
            ctx.fillStyle = v === P_TRAIL ? '#0e7490' : '#9a3412';
            ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
    }

    // Cycle heads (brighter, with glow)
    drawHead(player, '#22d3ee');
    drawHead(cpu, '#f97316');
}

function drawHead(c, color) {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillRect(c.x * CELL, c.y * CELL, CELL, CELL);
    ctx.shadowBlur = 0;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const TURN_KEYS = {
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
};

function isStartKey(k) {
    return k in TURN_KEYS || k === ' ' || k === 'Spacebar' || k === 'Enter';
}

document.addEventListener('keydown', e => {
    const k = e.key;

    // Pause toggle
    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    // Start / restart from an overlay
    if (state !== 'running' && state !== 'paused') {
        if (isStartKey(k)) {
            startGame();
            // fall through so the same key can also steer
        } else {
            return;
        }
    }

    if (k in TURN_KEYS) {
        queuePlayerTurn(TURN_KEYS[k]);
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init — a still arena behind the start overlay.
// ---------------------------------------------------------------------------
bestStreak = parseInt(localStorage.getItem('tron-best-streak') || '0', 10);
wins = 0;
losses = 0;
streak = 0;
clearGrid();
placeCycles();
playerAlive = true;
cpuAlive = true;
cpuThinks = true;
state = 'idle';
updateHud();
draw();
