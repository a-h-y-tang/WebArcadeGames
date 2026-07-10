// =============================================================================
// Pipe Dream
//
// Lay pipe across the board to build the longest possible run before the green
// ooze — which starts flowing from the source after a short head start — leaks
// out of a dead end or an open tile. Race the flow: keep connecting pipe ahead
// of it and reach the target length to win.
//
// All globals and functions are top-level (var / function declarations) so the
// Playwright tests can set up exact board states and drive the pure simulation
// (`flowStep()`, `placeAt()`) directly, without relying on wall-clock timing or
// randomness. See design.md.
// =============================================================================

// --- Board geometry ----------------------------------------------------------
var CELL = 56;                 // pixel size of one tile
var COLS = 12;                 // board width  (12 * 56 = 672)
var ROWS = 9;                  // board height (9  * 56 = 504)
var WIDTH = COLS * CELL;       // 672
var HEIGHT = ROWS * CELL;      // 504

// --- Tuning ------------------------------------------------------------------
var QUEUE_LEN = 5;             // pieces shown in the upcoming tray
var TARGET = 20;              // pipes to fill to win
var FLOW_START_DELAY = 6;      // seconds of head start before the ooze flows
var FLOW_TIME = 0.85;          // seconds the ooze takes to fill one pipe

// --- Directions --------------------------------------------------------------
var DVEC = {
    N: { dx: 0, dy: -1 },
    E: { dx: 1, dy: 0 },
    S: { dx: 0, dy: 1 },
    W: { dx: -1, dy: 0 },
};
var OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };

// --- Pieces: which sides each pipe type connects -----------------------------
var PIECES = {
    h: ['E', 'W'],       // straight ─
    v: ['N', 'S'],       // straight │
    ne: ['N', 'E'],      // curve └
    es: ['E', 'S'],      // curve ┌
    sw: ['S', 'W'],      // curve ┐
    nw: ['N', 'W'],      // curve ┘
    x: ['N', 'E', 'S', 'W'], // cross ┼ (flow passes straight through)
    source: [],          // filled at start with the single START.dir opening
};

// Draw pool for the queue — curves/straights common, cross rare. Deterministic.
var DRAW_POOL = ['h', 'h', 'v', 'v', 'ne', 'es', 'sw', 'nw', 'ne', 'es', 'sw', 'nw', 'x'];

// --- State -------------------------------------------------------------------
// 'idle' | 'running' | 'paused' | 'over' | 'win'
var state = 'idle';
var grid = [];                 // grid[y][x] = null | { type, filled }
var queue = [];                // upcoming piece types
var START = { x: 1, y: 4, dir: 'E' };
var flow = { x: START.x, y: START.y, dir: START.dir };

var score = 0;                 // pipes the ooze has filled
var best = 0;                  // best score ever (persisted)
var endResult = null;          // 'win' | 'over' when finished

var flowDelay = 0;             // head-start countdown (s)
var flowAccum = 0;             // accumulator toward the next flow step

// --- Deterministic RNG (LCG) so the queue is reproducible in tests -----------
var rngSeed = 1;
function rng() {
    rngSeed = (rngSeed * 1103515245 + 12345) & 0x7fffffff;
    return rngSeed / 0x7fffffff;
}
function drawPiece() {
    return DRAW_POOL[Math.floor(rng() * DRAW_POOL.length)];
}

// --- Timing ------------------------------------------------------------------
var lastTs = 0;

// --- DOM ---------------------------------------------------------------------
var canvas, ctx;
var overlay, overlayTitle, overlayScore, overlaySub, btnStart;
var elScore, elBest, elTarget, elQueue;

// =============================================================================
// Board helpers
// =============================================================================
function makeGrid() {
    grid = [];
    for (var y = 0; y < ROWS; y++) {
        var row = [];
        for (var x = 0; x < COLS; x++) row.push(null);
        grid.push(row);
    }
}

function inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

// Openings of a placed cell (source uses its single START.dir opening).
function openingsOf(cell) {
    if (!cell) return null;
    if (cell.type === 'source') return [START.dir];
    return PIECES[cell.type];
}

// =============================================================================
// Lifecycle
// =============================================================================
function startGame() {
    makeGrid();
    grid[START.y][START.x] = { type: 'source', filled: true };
    flow = { x: START.x, y: START.y, dir: START.dir };

    score = 0;
    endResult = null;
    rngSeed = 1;
    queue = [];
    for (var i = 0; i < QUEUE_LEN; i++) queue.push(drawPiece());

    flowDelay = FLOW_START_DELAY;
    flowAccum = 0;
    state = 'running';

    updateHud();
    renderQueue();
    hideOverlay();
}

function endGame(result) {
    endResult = result;
    state = (result === 'win') ? 'win' : 'over';
    if (score > best) { best = score; persistBest(); }
    updateHud();
    showOverlay();
}

// =============================================================================
// Placing pipe
// =============================================================================
function placeAt(col, row) {
    if (state !== 'running' && state !== 'paused') return false;
    if (!inBounds(col, row)) return false;
    if (grid[row][col]) return false; // occupied (incl. the source)

    grid[row][col] = { type: queue[0], filled: false };
    queue.shift();
    queue.push(drawPiece());
    renderQueue();
    return true;
}

// =============================================================================
// The flow — one deterministic advance of the ooze. State-agnostic so tests can
// drive it directly. Returns 'flow' | 'leak' | 'win'.
// =============================================================================
function flowStep() {
    var dir = flow.dir;
    var v = DVEC[dir];
    var nx = flow.x + v.dx;
    var ny = flow.y + v.dy;
    var entrySide = OPP[dir];

    // Off the board, or an empty tile ahead → leak.
    if (!inBounds(nx, ny) || !grid[ny][nx]) {
        endGame('over');
        return 'leak';
    }

    var cell = grid[ny][nx];
    var ops = openingsOf(cell);

    // The pipe must accept the ooze on the side it arrives from.
    if (ops.indexOf(entrySide) === -1) {
        endGame('over');
        return 'leak';
    }

    // Fill it.
    if (!cell.filled) {
        cell.filled = true;
        score++;
        updateHud();
    }

    // Choose the exit: a cross runs straight through, otherwise the other end.
    var exit;
    if (cell.type === 'x') {
        exit = dir;
    } else {
        exit = ops[0] === entrySide ? ops[1] : ops[0];
    }

    flow.x = nx;
    flow.y = ny;
    flow.dir = exit;

    if (score >= TARGET) {
        endGame('win');
        return 'win';
    }
    return 'flow';
}

// =============================================================================
// Real-time driver (tests bypass this via flowStep()).
// =============================================================================
function update(dt) {
    if (state !== 'running') return;

    if (flowDelay > 0) {
        flowDelay -= dt;
        return; // still the head-start window — place pipe now!
    }

    flowAccum += dt;
    while (flowAccum >= FLOW_TIME) {
        flowAccum -= FLOW_TIME;
        flowStep();
        if (state !== 'running') { flowAccum = 0; break; }
    }
}

function loop(ts) {
    var dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0;
    lastTs = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
}

// =============================================================================
// Rendering
// =============================================================================
function draw() {
    if (!ctx) return;

    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Tile grid.
    ctx.strokeStyle = 'rgba(28, 39, 64, 0.9)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= COLS; gx++) {
        ctx.beginPath();
        ctx.moveTo(gx * CELL + 0.5, 0);
        ctx.lineTo(gx * CELL + 0.5, HEIGHT);
        ctx.stroke();
    }
    for (var gy = 0; gy <= ROWS; gy++) {
        ctx.beginPath();
        ctx.moveTo(0, gy * CELL + 0.5);
        ctx.lineTo(WIDTH, gy * CELL + 0.5);
        ctx.stroke();
    }

    // Pipes.
    for (var y = 0; y < ROWS; y++) {
        for (var x = 0; x < COLS; x++) {
            var cell = grid[y][x];
            if (cell) drawPipe(ctx, x * CELL, y * CELL, CELL, cell);
        }
    }

    // Highlight the flow head so the danger is visible.
    if (state === 'running' && flowDelay <= 0) {
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2;
        ctx.strokeRect(flow.x * CELL + 2, flow.y * CELL + 2, CELL - 4, CELL - 4);
    }
}

// Draw a pipe tile: a stub from centre to each opening, plus a hub.
function drawPipe(c, px, py, size, cell) {
    var cx = px + size / 2;
    var cy = py + size / 2;
    var w = Math.max(8, size * 0.34);
    var openings = openingsOf(cell);

    var color;
    if (cell.type === 'source') color = '#fbbf24';
    else if (cell.filled) color = '#34d399';
    else color = '#7c8aa5';

    c.strokeStyle = color;
    c.lineWidth = w;
    c.lineCap = 'round';
    if (cell.filled || cell.type === 'source') {
        c.shadowColor = color;
        c.shadowBlur = 10;
    }

    for (var i = 0; i < openings.length; i++) {
        var d = DVEC[openings[i]];
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx + d.dx * size / 2, cy + d.dy * size / 2);
        c.stroke();
    }
    c.shadowBlur = 0;

    // Hub.
    c.fillStyle = color;
    c.beginPath();
    c.arc(cx, cy, w * 0.55, 0, Math.PI * 2);
    c.fill();
}

// The upcoming-pieces tray (small DOM canvases).
function renderQueue() {
    if (!elQueue) return;
    elQueue.innerHTML = '';
    for (var i = 0; i < queue.length; i++) {
        var mini = document.createElement('canvas');
        var s = 44;
        mini.width = s; mini.height = s;
        var mc = mini.getContext('2d');
        mc.fillStyle = '#0f1524';
        mc.fillRect(0, 0, s, s);
        drawPipe(mc, 0, 0, s, { type: queue[i], filled: false });
        elQueue.appendChild(mini);
    }
}

// =============================================================================
// HUD & overlay
// =============================================================================
function updateHud() {
    if (elScore) elScore.textContent = String(score);
    if (elBest) elBest.textContent = String(best);
    if (elTarget) elTarget.textContent = String(TARGET);
}

function showOverlay() {
    if (!overlay) return;
    var title = 'Pipe Dream';
    var sub = 'Click empty tiles to lay pipe and race the ooze — connect enough pipe before it leaks';
    var scoreLine = '';

    if (state === 'paused') {
        title = 'Paused';
        sub = 'Press P to resume';
    } else if (state === 'win') {
        title = 'You Win!';
        scoreLine = 'You connected ' + score + ' pipes';
        sub = 'Best: ' + best;
    } else if (state === 'over') {
        title = 'Game Over';
        scoreLine = 'The ooze leaked after ' + score + ' pipes';
        sub = 'Best: ' + best;
    }

    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    btnStart.textContent = (state === 'win' || state === 'over') ? 'Play Again' : 'Start Game';
    btnStart.style.display = (state === 'paused') ? 'none' : '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    if (overlay) overlay.classList.remove('visible');
}

// =============================================================================
// Persistence
// =============================================================================
function loadBest() {
    try {
        var v = parseInt(localStorage.getItem('pipe-best'), 10);
        best = isNaN(v) ? 0 : v;
    } catch (e) { best = 0; }
}

function persistBest() {
    try { localStorage.setItem('pipe-best', String(best)); } catch (e) { /* ignore */ }
}

// =============================================================================
// Input
// =============================================================================
function togglePause() {
    if (state === 'running') { state = 'paused'; showOverlay(); }
    else if (state === 'paused') { state = 'running'; hideOverlay(); }
}

function onKeyDown(e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'p' && (state === 'running' || state === 'paused')) {
        togglePause();
        e.preventDefault();
    }
}

function onCanvasClick(e) {
    if (state === 'idle' || state === 'win' || state === 'over') {
        startGame();
        return;
    }
    if (state !== 'running') return;
    var rect = canvas.getBoundingClientRect();
    var col = Math.floor((e.clientX - rect.left) * (WIDTH / rect.width) / CELL);
    var row = Math.floor((e.clientY - rect.top) * (HEIGHT / rect.height) / CELL);
    placeAt(col, row);
}

// =============================================================================
// Boot
// =============================================================================
function init() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    overlay = document.getElementById('overlay');
    overlayTitle = document.getElementById('overlay-title');
    overlayScore = document.getElementById('overlay-score');
    overlaySub = document.getElementById('overlay-sub');
    btnStart = document.getElementById('btn-start');
    elScore = document.getElementById('score-pipes');
    elBest = document.getElementById('best');
    elTarget = document.getElementById('target');
    elQueue = document.getElementById('queue');

    loadBest();
    makeGrid();
    grid[START.y][START.x] = { type: 'source', filled: true };
    // Preview the upcoming pieces on the idle screen.
    queue = [];
    for (var i = 0; i < QUEUE_LEN; i++) queue.push(drawPiece());
    updateHud();
    renderQueue();

    btnStart.addEventListener('click', startGame);
    canvas.addEventListener('click', onCanvasClick);
    document.addEventListener('keydown', onKeyDown);

    requestAnimationFrame(loop);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
