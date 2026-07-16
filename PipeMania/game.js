// ---------------------------------------------------------------------------
// Pipe Mania — lay pipe ahead of the flooding water.
//
// The rules are pure functions (opposite / connects / exitDir / placePiece /
// stepFlow) over a small set of globals kept deliberately separate from the
// rendering. `startFlow()` seeds the water WITHOUT starting a timer, so the
// Playwright suite can build an exact board, call stepFlow() by hand, and
// assert the outcome with zero timing dependence. The real-time loop
// (releaseWater) is just startFlow() + a stepFlow() interval.
// ---------------------------------------------------------------------------

const COLS = 9;
const ROWS = 7;
const CELL = 60;
const W = COLS * CELL;   // 540
const H = ROWS * CELL;   // 420

const BUILD_MS = 6000;   // grace period before the water auto-releases

const CLR = {
    bg:       '#0a1120',
    grid:     '#16213a',
    cellHi:   '#1d2b4a',
    pipe:     '#5b7bb5',
    pipeEdge: '#8fb0e6',
    water:    '#2dd4bf',
    waterEdge:'#99f6e4',
    source:   '#f59e0b',
    sourceEdge:'#fde68a',
};

// --- Direction helpers -----------------------------------------------------
const DIRS = { N: [-1, 0], E: [0, 1], S: [1, 0], W: [0, -1] };
const OPP  = { N: 'S', S: 'N', E: 'W', W: 'E' };

function opposite(d) { return OPP[d]; }

// Open sides of every piece type. Source pieces (sN…sW) have one opening.
const OPENINGS = {
    H:  ['E', 'W'],
    V:  ['N', 'S'],
    NE: ['N', 'E'],
    ES: ['E', 'S'],
    SW: ['S', 'W'],
    WN: ['W', 'N'],
    X:  ['N', 'E', 'S', 'W'],
    sN: ['N'], sE: ['E'], sS: ['S'], sW: ['W'],
};

// Playable pieces the queue can deal.
const BAG = ['H', 'V', 'NE', 'ES', 'SW', 'WN', 'X'];

function connects(type, dir) {
    return !!OPENINGS[type] && OPENINGS[type].indexOf(dir) !== -1;
}

// Given the side water ENTERS a piece from, the side it leaves by (or null
// if the piece is not open on the entry side).
function exitDir(type, entryDir) {
    const open = OPENINGS[type];
    if (!open || open.indexOf(entryDir) === -1) return null;
    if (type === 'X') return OPP[entryDir];          // straight through
    if (open.length === 2) return open[0] === entryDir ? open[1] : open[0];
    return null;                                      // a source has no through-path
}

// --- DOM -------------------------------------------------------------------
const canvas       = document.getElementById('canvas');
const ctx          = canvas.getContext('2d');
const queueCanvas  = document.getElementById('queue');
const qctx         = queueCanvas.getContext('2d');
const scoreEl      = document.getElementById('score');
const goalEl       = document.getElementById('goal');
const levelEl      = document.getElementById('level');
const bestEl       = document.getElementById('best');
const timerFill    = document.getElementById('timer-fill');
const overlay      = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub   = document.getElementById('overlay-sub');
const btnStart     = document.getElementById('btn-start');

// --- State (var so tests can reach it as window.*) -------------------------
var grid;                         // grid[r][c] = type string | null
var queue;                        // upcoming piece types
var filled;                       // filled[r][c] = bool (water passed)
var flowHead;                     // { r, c, fromDir } next cell to flood
var startR, startC, startDir;     // the source
var pipesFilled, goal, level, best, state;
var flowTimer = null, buildTimer = null, buildEnd = 0;

// --- Board helpers ---------------------------------------------------------
function emptyGrid() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}
function emptyFilled() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(false));
}
function randPiece() {
    return BAG[Math.floor(Math.random() * BAG.length)];
}
function goalForLevel(lv) {
    return 5 + (lv - 1) * 2;
}
function flowSpeed(lv) {
    return Math.max(220, 620 - (lv - 1) * 60);
}

// --- Level setup -----------------------------------------------------------
function buildLevel() {
    grid   = emptyGrid();
    filled = emptyFilled();
    queue  = Array.from({ length: 6 }, randPiece);
    pipesFilled = 0;
    goal = goalForLevel(level);

    // Source: column 0, random row, always flowing East (see DESIGN).
    startR = Math.floor(Math.random() * ROWS);
    startC = 0;
    startDir = 'E';
    grid[startR][startC] = 's' + startDir;
    flowHead = null;
}

function startGame() {
    level = 1;
    beginLevel();
}

function beginLevel() {
    stopTimers();
    buildLevel();
    state = 'building';
    hideOverlay();
    buildEnd = nowMs() + BUILD_MS;
    buildTimer = setInterval(tickBuild, 80);
    updateHud();
    draw();
    drawQueue();
}

function nextLevel() {
    level += 1;
    beginLevel();
}

// The build countdown auto-releases the water when it hits zero.
function tickBuild() {
    if (state !== 'building') { clearInterval(buildTimer); buildTimer = null; return; }
    const remain = Math.max(0, buildEnd - nowMs());
    if (timerFill) timerFill.style.width = (100 * remain / BUILD_MS) + '%';
    if (remain <= 0) releaseWater();
}

// --- Placing pipes ---------------------------------------------------------
function placePiece(r, c) {
    if (state !== 'building' && state !== 'flowing') return;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    if (grid[r][c] !== null) return;          // occupied (incl. the source)
    if (filled[r][c]) return;                 // already flooded
    grid[r][c] = queue.shift();
    queue.push(randPiece());
    draw();
    drawQueue();
}

// --- The flow --------------------------------------------------------------
// Seed the water just past the source. Does NOT start a timer, so tests can
// drive stepFlow() deterministically.
function startFlow() {
    if (buildTimer) { clearInterval(buildTimer); buildTimer = null; }
    filled = emptyFilled();
    filled[startR][startC] = true;
    pipesFilled = 0;
    const [dr, dc] = DIRS[startDir];
    flowHead = { r: startR + dr, c: startC + dc, fromDir: OPP[startDir] };
    state = 'flowing';
    if (timerFill) timerFill.style.width = '0%';
    updateHud();
}

// Advance the water one cell. Returns 'advanced' | 'won' | 'lost' | 'idle'.
function stepFlow() {
    if (state !== 'flowing') return 'idle';
    const { r, c, fromDir } = flowHead;

    const off = r < 0 || r >= ROWS || c < 0 || c >= COLS;
    const type = off ? null : grid[r][c];
    if (off || type === null || filled[r][c] || !connects(type, fromDir)) {
        return endFlow(false);
    }

    filled[r][c] = true;
    pipesFilled += 1;
    updateHud();

    if (pipesFilled >= goal) return endFlow(true);

    const ex = exitDir(type, fromDir);
    if (ex === null) return endFlow(false);       // defensive; shouldn't happen
    const [dr, dc] = DIRS[ex];
    flowHead = { r: r + dr, c: c + dc, fromDir: OPP[ex] };
    return 'advanced';
}

function endFlow(won) {
    state = won ? 'won' : 'lost';
    stopTimers();
    recordBest();
    draw();
    showEndOverlay(won);
    return won ? 'won' : 'lost';
}

function recordBest() {
    if (best === null || pipesFilled > best) {
        best = pipesFilled;
        localStorage.setItem('pipemania-best', String(best));
    }
    updateHud();
}

// --- Real-time driver ------------------------------------------------------
function releaseWater() {
    if (state !== 'building') return;
    startFlow();
    draw();
    flowTimer = setInterval(() => {
        stepFlow();
        draw();
        if (state !== 'flowing' && flowTimer) { clearInterval(flowTimer); flowTimer = null; }
    }, flowSpeed(level));
}

function stopTimers() {
    if (flowTimer)  { clearInterval(flowTimer);  flowTimer = null; }
    if (buildTimer) { clearInterval(buildTimer); buildTimer = null; }
}

// nowMs is wrapped so the rest of the code never touches Date directly.
function nowMs() { return performance.now(); }

// --- HUD / overlay ---------------------------------------------------------
function updateHud() {
    if (scoreEl) scoreEl.textContent = String(pipesFilled);
    if (goalEl)  goalEl.textContent  = String(goal);
    if (levelEl) levelEl.textContent = String(level);
    if (bestEl)  bestEl.textContent  = best === null ? '—' : String(best);
}

function hideOverlay() { overlay.classList.remove('visible'); }

function showEndOverlay(won) {
    overlayTitle.textContent = won ? 'Level Clear!' : 'Water Spilled!';
    overlayScore.textContent = won
        ? `Filled ${pipesFilled} pipes — goal reached`
        : `Filled ${pipesFilled} pipe${pipesFilled === 1 ? '' : 's'} · Best ${best}`;
    overlaySub.textContent = won
        ? 'Press Space or Start for the next level'
        : 'Press Space or Start to try again';
    btnStart.textContent = won ? 'Next Level' : 'Retry';
    overlay.classList.add('visible');
}

// --- Rendering -------------------------------------------------------------
function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Draw a pipe (or source) filling one cell of `context`, at pixel (px,py).
function drawPiece(context, px, py, size, type, isFilled, isSource) {
    const cx = px + size / 2;
    const cy = py + size / 2;
    const thick = Math.max(10, size * 0.3);
    const open = OPENINGS[type] || [];

    context.lineCap = 'round';
    context.lineWidth = thick;
    let stroke = CLR.pipe, edge = CLR.pipeEdge;
    if (isSource) { stroke = CLR.source; edge = CLR.sourceEdge; }
    else if (isFilled) { stroke = CLR.water; edge = CLR.waterEdge; }

    // Outer casing.
    context.strokeStyle = edge;
    context.lineWidth = thick;
    for (const d of open) {
        const [dr, dc] = DIRS[d];
        context.beginPath();
        context.moveTo(cx, cy);
        context.lineTo(cx + dc * size / 2, cy + dr * size / 2);
        context.stroke();
    }
    // Inner fluid/metal.
    context.strokeStyle = stroke;
    context.lineWidth = thick * 0.58;
    for (const d of open) {
        const [dr, dc] = DIRS[d];
        context.beginPath();
        context.moveTo(cx, cy);
        context.lineTo(cx + dc * size / 2, cy + dr * size / 2);
        context.stroke();
    }
    // Hub.
    context.fillStyle = isSource ? CLR.sourceEdge : (isFilled ? CLR.waterEdge : CLR.pipeEdge);
    context.beginPath();
    context.arc(cx, cy, thick * 0.34, 0, Math.PI * 2);
    context.fill();
}

function draw() {
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = c * CELL, y = r * CELL;
            ctx.fillStyle = (r + c) % 2 === 0 ? CLR.grid : CLR.cellHi;
            roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 8);
            ctx.fill();

            const type = grid[r][c];
            if (type) {
                const isSource = type[0] === 's';
                drawPiece(ctx, x, y, CELL, type, filled && filled[r][c], isSource);
            }
        }
    }

    // Head marker while flowing.
    if (state === 'flowing' && flowHead) {
        const { r, c } = flowHead;
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
            ctx.strokeStyle = CLR.waterEdge;
            ctx.lineWidth = 3;
            roundRect(c * CELL + 4, r * CELL + 4, CELL - 8, CELL - 8, 8);
            ctx.stroke();
        }
    }
}

function drawQueue() {
    const cw = queueCanvas.width, ch = queueCanvas.height;
    qctx.fillStyle = CLR.bg;
    qctx.fillRect(0, 0, cw, ch);
    const n = Math.min(5, queue.length);
    const size = cw;
    for (let i = 0; i < n; i++) {
        const y = i * size;
        qctx.fillStyle = i === 0 ? CLR.cellHi : CLR.grid;
        qctx.fillRect(2, y + 2, size - 4, size - 4);
        if (i === 0) {
            qctx.strokeStyle = CLR.source;
            qctx.lineWidth = 2;
            qctx.strokeRect(2, y + 2, size - 4, size - 4);
        }
        // drawPiece uses ctx-scoped helpers only via context param.
        drawPieceOn(qctx, 0, y, size, queue[i], false, false);
    }
}

// A context-agnostic clone of drawPiece for the queue canvas.
function drawPieceOn(context, px, py, size, type, isFilled, isSource) {
    const cx = px + size / 2, cy = py + size / 2;
    const thick = Math.max(8, size * 0.26);
    const open = OPENINGS[type] || [];
    context.lineCap = 'round';
    context.strokeStyle = CLR.pipeEdge;
    context.lineWidth = thick;
    for (const d of open) {
        const [dr, dc] = DIRS[d];
        context.beginPath(); context.moveTo(cx, cy);
        context.lineTo(cx + dc * size / 2, cy + dr * size / 2); context.stroke();
    }
    context.strokeStyle = CLR.pipe;
    context.lineWidth = thick * 0.58;
    for (const d of open) {
        const [dr, dc] = DIRS[d];
        context.beginPath(); context.moveTo(cx, cy);
        context.lineTo(cx + dc * size / 2, cy + dr * size / 2); context.stroke();
    }
    context.fillStyle = CLR.pipeEdge;
    context.beginPath(); context.arc(cx, cy, thick * 0.34, 0, Math.PI * 2); context.fill();
}

// --- Input -----------------------------------------------------------------
canvas.addEventListener('click', e => {
    if (state !== 'building' && state !== 'flowing') return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    placePiece(r, c);
});

document.addEventListener('keydown', e => {
    if (e.key === ' ') e.preventDefault();
    if (state === 'idle') { startGame(); return; }
    if (state === 'won')  { nextLevel(); return; }
    if (state === 'lost') { beginLevel(); return; }
    // building / flowing
    if (e.key === ' ') { if (state === 'building') releaseWater(); }
    else if (e.key === 'r' || e.key === 'R') { beginLevel(); }
});

btnStart.addEventListener('click', () => {
    if (state === 'idle') startGame();
    else if (state === 'won') nextLevel();
    else beginLevel();
    btnStart.blur();
});

// --- Init ------------------------------------------------------------------
const storedBest = localStorage.getItem('pipemania-best');
best = storedBest === null ? null : parseInt(storedBest, 10);
level = 1;
state = 'idle';
buildLevel();                 // decorative board behind the title overlay
updateHud();
draw();
drawQueue();
