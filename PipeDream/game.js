// =============================================================================
// Pipe Dream — lay pipe to route flowing ooze as far as you can before it leaks.
//
// The whole simulation is a deterministic state machine exposed on `window`, so
// Playwright can drive it without depending on timers or rendered pixels. See
// DESIGN.md for the full model.
// =============================================================================

// --- side bit flags ----------------------------------------------------------
const N = 1, E = 2, S = 4, W = 8;

// open sides for each piece type
const OPEN = {
    h: E | W,
    v: N | S,
    ne: N | E,
    es: E | S,
    sw: S | W,
    wn: W | N,
    cross: N | E | S | W,
};

// the bag of pieces the queue draws from (curves + straights common, cross rare)
const BAG = ['h', 'v', 'ne', 'es', 'sw', 'wn', 'h', 'v', 'ne', 'es', 'sw', 'wn', 'cross'];

const COLS = 9;
const ROWS = 7;
const CELL = 64;
const QLEN = 5;

const POINTS_PER_PIPE = 50;
const CLEAR_BONUS = 250;
const COUNTDOWN_SECONDS = 15;
const TICK_MS = 700;

// --- direction helpers -------------------------------------------------------
function opposite(dir) {
    return dir === N ? S : dir === S ? N : dir === E ? W : E;
}
function step(row, col, dir) {
    if (dir === N) return { row: row - 1, col };
    if (dir === S) return { row: row + 1, col };
    if (dir === E) return { row, col: col + 1 };
    return { row, col: col - 1 };
}
function axisOf(dir) {
    return dir === N || dir === S ? 'v' : 'h';
}

// --- seeded RNG (mulberry32) so the queue is reproducible for tests ----------
let rngState = 0x9e3779b9 >>> 0;
function rand() {
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function setSeed(n) {
    rngState = (n >>> 0) || 1;
}

// =============================================================================
// Game state (all mirrored on window for the test harness)
// =============================================================================
window.grid = [];                 // grid[row][col] = null | { type, filled, filledAxes }
window.queue = [];                // upcoming piece types; queue[0] is placed next
window.source = { row: 3, col: 0, dir: E };
window.cursor = { row: 3, col: 1 };
window.state = 'ready';           // 'ready' | 'flowing' | 'won' | 'lost'
window.flowLength = 0;
window.score = 0;
window.level = 1;
window.target = 8;

let flowHead = null;              // { row, col, dir } — dir is the exit/travel side
let countdownTimer = null;
let flowTimer = null;
let countdownLeft = COUNTDOWN_SECONDS;

function targetForLevel(lvl) {
    return 8 + 2 * (lvl - 1);
}

// --- board construction ------------------------------------------------------
function makeCell(type) {
    return { type, filled: false, filledAxes: { h: false, v: false } };
}

function drawPiece() {
    return BAG[Math.floor(rand() * BAG.length)];
}

function refillQueue() {
    while (window.queue.length < QLEN) window.queue.push(drawPiece());
}

function blankGrid(rows, cols) {
    const g = [];
    for (let r = 0; r < rows; r++) {
        g.push(new Array(cols).fill(null));
    }
    return g;
}

function buildLevel() {
    clearTimers();
    window.grid = blankGrid(ROWS, COLS);
    window.source = { row: Math.floor(ROWS / 2), col: 0, dir: E };
    window.cursor = { row: window.source.row, col: 1 };
    window.queue = [];
    refillQueue();
    window.flowLength = 0;
    window.target = targetForLevel(window.level);
    flowHead = null;
    countdownLeft = COUNTDOWN_SECONDS;
    window.state = 'ready';
}

// =============================================================================
// Placement
// =============================================================================
function inBounds(row, col) {
    return (
        row >= 0 &&
        col >= 0 &&
        row < window.grid.length &&
        col < window.grid[0].length
    );
}
function isSource(row, col) {
    return row === window.source.row && col === window.source.col;
}

function placeAt(row, col) {
    if (window.state !== 'ready' && window.state !== 'flowing') return false;
    if (!inBounds(row, col)) return false;
    if (isSource(row, col)) return false;
    const cell = window.grid[row][col];
    if (cell !== null) {
        // Cannot overwrite; but never touch a cell the ooze has already reached.
        return false;
    }
    window.grid[row][col] = makeCell(window.queue.shift());
    refillQueue();
    render();
    updateHud();
    return true;
}

// =============================================================================
// Flow simulation
// =============================================================================
function startFlow() {
    if (window.state !== 'ready') return;
    window.state = 'flowing';
    window.flowLength = 0;
    flowHead = { row: window.source.row, col: window.source.col, dir: window.source.dir };
    updateHud();
    render();
}

function leak() {
    window.state = 'lost';
    flowHead = null;
    updateHud();
    render();
    return false;
}

function win() {
    window.state = 'won';
    window.score += CLEAR_BONUS;
    flowHead = null;
    updateHud();
    render();
}

// Advance the ooze by one pipe. Returns true if it advanced, false if it stopped.
function flowStep() {
    if (window.state !== 'flowing' || !flowHead) return false;

    const next = step(flowHead.row, flowHead.col, flowHead.dir);
    if (!inBounds(next.row, next.col)) return leak();
    if (isSource(next.row, next.col)) return leak();

    const cell = window.grid[next.row][next.col];
    if (cell === null) return leak();

    const entrySide = opposite(flowHead.dir);
    const openings = OPEN[cell.type];
    if ((openings & entrySide) === 0) return leak();

    if (cell.type === 'cross') {
        const axis = axisOf(entrySide);
        if (cell.filledAxes[axis]) return leak(); // already used on this axis
        cell.filledAxes[axis] = true;
    } else if (cell.filled) {
        return leak(); // loop back into a filled pipe
    }

    cell.filled = true;
    window.flowLength += 1;
    window.score += POINTS_PER_PIPE;

    let exitSide;
    if (cell.type === 'cross') {
        exitSide = opposite(entrySide); // straight through
    } else {
        exitSide = openings ^ entrySide; // the other of the two openings
    }
    flowHead = { row: next.row, col: next.col, dir: exitSide };

    if (window.flowLength >= window.target) {
        win();
        return false;
    }
    updateHud();
    render();
    return true;
}

// Step until the flow stops (win or leak). Guarded against runaway loops.
function runFlow() {
    let guard = 0;
    while (window.state === 'flowing' && guard < 100000) {
        flowStep();
        guard += 1;
    }
}

// =============================================================================
// Lifecycle
// =============================================================================
function reset() {
    window.score = 0;
    buildLevel();
    hideOverlay();
    showOverlay('Pipe Dream', 'Lay pipe to guide the ooze — the longer the connected path, the higher the score.');
    updateHud();
    render();
}

function nextLevel() {
    if (window.state !== 'won') return;
    window.level += 1;
    buildLevel();
    hideOverlay();
    updateHud();
    render();
}

// =============================================================================
// Real-time play: countdown + auto-advance (never armed by loadTest / tests)
// =============================================================================
function clearTimers() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (flowTimer) { clearInterval(flowTimer); flowTimer = null; }
}

function startGame() {
    if (window.state === 'won' || window.state === 'lost') reset();
    hideOverlay();
    window.state = 'ready';
    countdownLeft = COUNTDOWN_SECONDS;
    clearTimers();
    countdownTimer = setInterval(() => {
        countdownLeft -= 1;
        if (countdownLeft <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            releaseFlow();
        }
        updateHud();
    }, 1000);
    updateHud();
    render();
}

function releaseFlow() {
    if (window.state !== 'ready') return;
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    startFlow();
    flowTimer = setInterval(() => {
        flowStep();
        if (window.state !== 'flowing') {
            clearInterval(flowTimer);
            flowTimer = null;
            onFlowEnd();
        }
    }, TICK_MS);
}

function onFlowEnd() {
    if (window.state === 'won') {
        showOverlay('Level Clear!', `Score ${window.score}. Ready for level ${window.level + 1}?`);
        overlayButton('Next Level', nextLevel);
    } else {
        showOverlay('Leak!', `The ooze escaped after ${window.flowLength} pipes. Score ${window.score}.`);
        overlayButton('Try Again', () => { window.level = 1; startGame(); });
    }
}

// =============================================================================
// Test entry point — install an exact scenario with NO timers armed.
// =============================================================================
function loadTest(cfg) {
    clearTimers();
    const rows = cfg.grid;
    window.grid = rows.map((row) => row.map((t) => (t === null ? null : makeCell(t))));
    window.source = { row: cfg.source.row, col: cfg.source.col, dir: cfg.source.dir };
    window.queue = (cfg.queue || []).slice();
    window.target = cfg.target != null ? cfg.target : 8;
    window.cursor = { row: window.source.row, col: Math.min(1, window.grid[0].length - 1) };
    window.flowLength = 0;
    window.state = 'ready';
    flowHead = null;
    hideOverlay();
    updateHud();
    render();
}

// =============================================================================
// Rendering
// =============================================================================
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const queueCanvas = document.getElementById('queue');
const qctx = queueCanvas.getContext('2d');

function cellCenter(row, col) {
    return { x: (col + 0.5) * CELL, y: (row + 0.5) * CELL };
}
function cellFromPixel(x, y) {
    return { row: Math.floor(y / CELL), col: Math.floor(x / CELL) };
}

function drawPipeShape(c, cx, cy, type, size, filled) {
    const half = size / 2;
    const thick = Math.max(8, size * 0.34);
    c.lineCap = 'round';
    c.lineWidth = thick;
    c.strokeStyle = filled ? '#9be15d' : '#5a6f92';
    const ends = {
        [N]: [cx, cy - half],
        [S]: [cx, cy + half],
        [E]: [cx + half, cy],
        [W]: [cx - half, cy],
    };
    const openings = OPEN[type];
    const dirs = [N, E, S, W].filter((d) => openings & d);
    if (type === 'cross') {
        c.beginPath(); c.moveTo(...ends[N]); c.lineTo(...ends[S]); c.stroke();
        c.beginPath(); c.moveTo(...ends[E]); c.lineTo(...ends[W]); c.stroke();
    } else {
        c.beginPath();
        c.moveTo(...ends[dirs[0]]);
        c.lineTo(cx, cy);
        c.lineTo(...ends[dirs[1]]);
        c.stroke();
    }
}

function drawSource(cx, cy) {
    ctx.fillStyle = '#35e0c8';
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.28, 0, Math.PI * 2);
    ctx.fill();
    // nozzle in the flow direction
    const s = step(0, 0, window.source.dir);
    ctx.strokeStyle = '#35e0c8';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + s.col * CELL * 0.45, cy + s.row * CELL * 0.45);
    ctx.stroke();
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const rows = window.grid.length;
    const cols = window.grid[0] ? window.grid[0].length : 0;

    // grid background cells
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = c * CELL, y = r * CELL;
            ctx.fillStyle = '#223049';
            ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        }
    }
    // grid lines
    ctx.strokeStyle = '#2e415f';
    ctx.lineWidth = 1;
    for (let r = 0; r <= rows; r++) {
        ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(cols * CELL, r * CELL); ctx.stroke();
    }
    for (let c = 0; c <= cols; c++) {
        ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, rows * CELL); ctx.stroke();
    }

    // pipes
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = window.grid[r][c];
            if (!cell) continue;
            const { x, y } = cellCenter(r, c);
            drawPipeShape(ctx, x, y, cell.type, CELL * 0.9, cell.filled);
        }
    }

    // cursor highlight (only while placing)
    if (window.state === 'ready' && inBounds(window.cursor.row, window.cursor.col)) {
        ctx.strokeStyle = '#35e0c8';
        ctx.lineWidth = 3;
        ctx.strokeRect(
            window.cursor.col * CELL + 2,
            window.cursor.row * CELL + 2,
            CELL - 4,
            CELL - 4,
        );
    }

    // source on top
    const sc = cellCenter(window.source.row, window.source.col);
    drawSource(sc.x, sc.y);

    // flow head marker
    if (flowHead) {
        const fc = cellCenter(flowHead.row, flowHead.col);
        ctx.fillStyle = 'rgba(155,225,93,0.9)';
        ctx.beginPath();
        ctx.arc(fc.x, fc.y, 6, 0, Math.PI * 2);
        ctx.fill();
    }

    renderQueue();
}

function renderQueue() {
    qctx.clearRect(0, 0, queueCanvas.width, queueCanvas.height);
    const slot = 72;
    for (let i = 0; i < Math.min(QLEN, window.queue.length); i++) {
        const cy = i * slot + slot / 2;
        qctx.fillStyle = i === 0 ? '#233355' : '#182034';
        qctx.fillRect(6, i * slot + 6, slot - 12, slot - 12);
        drawPipeShape(qctx, slot / 2, cy, window.queue[i], slot * 0.6, false);
    }
}

// =============================================================================
// HUD
// =============================================================================
const $level = document.getElementById('level');
const $score = document.getElementById('score');
const $length = document.getElementById('length');
const $target = document.getElementById('target');
const $countdown = document.getElementById('countdown');

function updateHud() {
    $level.textContent = window.level;
    $score.textContent = window.score;
    $length.textContent = window.flowLength;
    $target.textContent = window.target;
    if (window.state === 'flowing' || window.state === 'won' || window.state === 'lost') {
        $countdown.textContent = window.state === 'flowing' ? 'go!' : '–';
    } else if (countdownTimer) {
        $countdown.textContent = countdownLeft + 's';
    } else {
        $countdown.textContent = '–';
    }
}

// =============================================================================
// Overlay
// =============================================================================
const overlay = document.getElementById('overlay');
const $overlayTitle = document.getElementById('overlay-title');
const $overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

function showOverlay(title, sub) {
    $overlayTitle.textContent = title;
    $overlaySub.textContent = sub;
    overlay.classList.add('visible');
}
function hideOverlay() {
    overlay.classList.remove('visible');
}
function overlayButton(label, handler) {
    btnStart.textContent = label;
    btnStart.onclick = () => { handler(); };
}

// =============================================================================
// Input
// =============================================================================
function handleClick(x, y) {
    if (window.state !== 'ready' && window.state !== 'flowing') return;
    const { row, col } = cellFromPixel(x, y);
    if (placeAt(row, col)) {
        window.cursor = { row, col };
        render();
    }
}

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    handleClick(e.clientX - rect.left, e.clientY - rect.top);
});

function moveCursor(dr, dc) {
    const row = Math.max(0, Math.min(window.grid.length - 1, window.cursor.row + dr));
    const col = Math.max(0, Math.min(window.grid[0].length - 1, window.cursor.col + dc));
    window.cursor = { row, col };
    render();
}

function setCursor(row, col) {
    window.cursor = { row, col };
    render();
}

document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (overlay.classList.contains('visible')) {
        if (k === 'enter' || k === ' ') { btnStart.click(); e.preventDefault(); }
        return;
    }
    if (k === 'arrowup' || k === 'w') { moveCursor(-1, 0); e.preventDefault(); }
    else if (k === 'arrowdown' || k === 's') { moveCursor(1, 0); e.preventDefault(); }
    else if (k === 'arrowleft' || k === 'a') { moveCursor(0, -1); e.preventDefault(); }
    else if (k === 'arrowright' || k === 'd') { moveCursor(0, 1); e.preventDefault(); }
    else if (k === ' ' || k === 'enter') {
        placeAt(window.cursor.row, window.cursor.col); e.preventDefault();
    }
    else if (k === 'f') { releaseFlow(); }
    else if (k === 'r') { window.level = 1; reset(); }
});

btnStart.onclick = () => { startGame(); };
document.getElementById('btn-flow').addEventListener('click', releaseFlow);
document.getElementById('btn-reset').addEventListener('click', () => { window.level = 1; reset(); });

// convenience helpers used by tests to simulate a canvas click precisely
window.cellCenter = cellCenter;
window.dispatchCanvasClick = handleClick;
window.setCursor = setCursor;

// =============================================================================
// Expose API for tests
// =============================================================================
window.placeAt = placeAt;
window.startFlow = startFlow;
window.flowStep = flowStep;
window.runFlow = runFlow;
window.reset = reset;
window.nextLevel = nextLevel;
window.setSeed = setSeed;
window.loadTest = loadTest;

// =============================================================================
// Boot
// =============================================================================
setSeed(0x1a2b3c4d);
buildLevel();
showOverlay('Pipe Dream', 'Lay pipe to guide the ooze — the longer the connected path, the higher the score.');
updateHud();
render();
