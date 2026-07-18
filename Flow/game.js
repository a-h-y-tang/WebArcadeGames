/* Flow (Numberlink / Flow Free) — connect matching dots and fill the board.
 *
 * Globals are intentionally exposed for the Playwright test suite:
 *   State:   SIZE, state, level, cellColor, endpointColor, paths, moves, LEVELS
 *   Actions: startGame, beginPath, extendPath, endDrag
 *   Queries: isConnected, connectedCount, filledCount, isSolved, pointerToCell
 */

// ---------------------------------------------------------------------------
// Level definitions. Each colour's endpoints are `a` and `b`. Every level is a
// hand-crafted full-cover puzzle: colour 0 snakes along the top row and right
// column, the remaining colours fill the interior rows. This guarantees a
// solution that fills the whole board.
// ---------------------------------------------------------------------------
function makeLevel(size) {
    const ends = [];
    // Colour 0: top row (0,0)->(0,size-1) then right column down to (size-2,size-1).
    ends.push({ color: 0, a: [0, 0], b: [size - 2, size - 1] });
    // Interior rows 1..size-2 across columns 0..size-2.
    for (let r = 1; r <= size - 2; r++) {
        ends.push({ color: ends.length, a: [r, 0], b: [r, size - 2] });
    }
    // Bottom row (size-1): full width.
    ends.push({ color: ends.length, a: [size - 1, 0], b: [size - 1, size - 1] });
    return { size, ends };
}

const LEVELS = [makeLevel(5), makeLevel(6), makeLevel(7)];

// A palette large enough for the biggest level.
const PALETTE = [
    '#ff4d5e', // red
    '#4dc3ff', // blue
    '#7be06a', // green
    '#ffd24d', // yellow
    '#c07bff', // purple
    '#ff9d3d', // orange
    '#4de0c3', // teal
    '#ff7bd0', // pink
];

const CANVAS_PX = 560;

// ---------------------------------------------------------------------------
// Mutable game state
// ---------------------------------------------------------------------------
let SIZE = LEVELS[0].size;
let level = 0;
let state = 'ready'; // 'ready' | 'running' | 'won'
let cellColor = [];  // SIZE x SIZE, colour index or -1
let endpointColor = []; // SIZE x SIZE, colour index or -1 (dot cells)
let paths = {};      // colour -> ordered [[r,c], ...] from the endpoint dragged first
let drag = null;     // { color } while a pointer drag is active
let moves = 0;

let canvas, ctx;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function inBounds(r, c) {
    return r >= 0 && c >= 0 && r < SIZE && c < SIZE;
}

function indexOfCell(pipe, r, c) {
    for (let i = 0; i < pipe.length; i++) {
        if (pipe[i][0] === r && pipe[i][1] === c) return i;
    }
    return -1;
}

function numColors() {
    return LEVELS[level].ends.length;
}

// Remove the tail of `color`'s pipe starting at index i (inclusive), clearing
// the erased non-endpoint cells.
function truncateFrom(color, i) {
    const pipe = paths[color];
    for (let k = i; k < pipe.length; k++) {
        const [rr, cc] = pipe[k];
        if (endpointColor[rr][cc] < 0) cellColor[rr][cc] = -1;
    }
    pipe.length = i;
}

// Clear every non-endpoint cell of a colour's pipe and empty the pipe list.
function clearPipe(color) {
    if (paths[color]) truncateFrom(color, 0);
    paths[color] = [];
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------
function startGame(lv) {
    if (lv != null) level = lv;
    const def = LEVELS[level];
    SIZE = def.size;

    cellColor = [];
    endpointColor = [];
    for (let r = 0; r < SIZE; r++) {
        cellColor.push(new Array(SIZE).fill(-1));
        endpointColor.push(new Array(SIZE).fill(-1));
    }
    paths = {};
    for (const e of def.ends) {
        endpointColor[e.a[0]][e.a[1]] = e.color;
        endpointColor[e.b[0]][e.b[1]] = e.color;
        cellColor[e.a[0]][e.a[1]] = e.color;
        cellColor[e.b[0]][e.b[1]] = e.color;
        paths[e.color] = [];
    }

    drag = null;
    moves = 0;
    state = 'running';

    hideOverlay();
    updateHUD();
    updateLevelButtons();
    render();
}

// ---------------------------------------------------------------------------
// Interaction primitives (also driven directly by the tests)
// ---------------------------------------------------------------------------
function beginPath(r, c) {
    if (state !== 'running' || !inBounds(r, c)) return;

    const ep = endpointColor[r][c];
    const cc = cellColor[r][c];
    let color;

    if (ep >= 0) {
        // Grab an endpoint: (re)start this colour's pipe here.
        color = ep;
        clearPipe(color);
        paths[color] = [[r, c]];
        cellColor[r][c] = color;
    } else if (cc >= 0) {
        // Grab mid-pipe: truncate so this cell becomes the new head.
        color = cc;
        const i = indexOfCell(paths[color], r, c);
        if (i < 0) return;
        truncateFrom(color, i + 1);
    } else {
        return; // empty, non-endpoint cell — nothing to grab
    }

    drag = { color };
    render();
}

function extendPath(r, c) {
    if (state !== 'running' || !drag || !inBounds(r, c)) return;

    const color = drag.color;
    const pipe = paths[color];
    if (pipe.length === 0) return;
    const head = pipe[pipe.length - 1];

    if (head[0] === r && head[1] === c) return; // no movement

    // Backtrack onto the previous cell.
    if (pipe.length >= 2) {
        const prev = pipe[pipe.length - 2];
        if (prev[0] === r && prev[1] === c) {
            const removed = pipe.pop();
            if (endpointColor[removed[0]][removed[1]] < 0) cellColor[removed[0]][removed[1]] = -1;
            render();
            return;
        }
    }

    // Must be orthogonally adjacent to the head.
    if (Math.abs(r - head[0]) + Math.abs(c - head[1]) !== 1) return;

    // A completed pipe cannot grow further.
    if (isConnected(color)) return;

    const ep = endpointColor[r][c];
    if (ep >= 0 && ep !== color) return; // cannot cross another colour's dot

    // Cannot loop back onto our own body.
    if (indexOfCell(pipe, r, c) >= 0) return;

    // Overwrite another colour: truncate it where we intersect.
    const cc = cellColor[r][c];
    if (cc >= 0 && cc !== color) {
        const i = indexOfCell(paths[cc], r, c);
        if (i >= 0) truncateFrom(cc, i);
    }

    pipe.push([r, c]);
    cellColor[r][c] = color;

    checkWin();
    render();
}

function endDrag() {
    if (drag) {
        moves++;
        drag = null;
        updateHUD();
        render();
    }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
function isConnected(color) {
    const pipe = paths[color];
    if (!pipe || pipe.length < 2) return false;
    const a = pipe[0];
    const b = pipe[pipe.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return false;
    return endpointColor[a[0]][a[1]] === color && endpointColor[b[0]][b[1]] === color;
}

function connectedCount() {
    let n = 0;
    for (let color = 0; color < numColors(); color++) {
        if (isConnected(color)) n++;
    }
    return n;
}

function filledCount() {
    let n = 0;
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (cellColor[r][c] >= 0) n++;
        }
    }
    return n;
}

function isSolved() {
    return connectedCount() === numColors() && filledCount() === SIZE * SIZE;
}

function pointerToCell(x, y) {
    const cell = CANVAS_PX / SIZE;
    return { r: Math.floor(y / cell), c: Math.floor(x / cell) };
}

// ---------------------------------------------------------------------------
// Win handling
// ---------------------------------------------------------------------------
function checkWin() {
    if (state === 'running' && isSolved()) {
        state = 'won';
        recordBest();
        showWinOverlay();
        updateHUD();
    }
}

function bestKey() {
    return 'flow-best-' + level;
}

function recordBest() {
    let best = null;
    try {
        best = localStorage.getItem(bestKey());
    } catch (e) {}
    const prev = best == null ? Infinity : parseInt(best, 10);
    if (moves < prev) {
        try {
            localStorage.setItem(bestKey(), String(moves));
        } catch (e) {}
    }
}

function readBest() {
    try {
        return localStorage.getItem(bestKey());
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// DOM / HUD
// ---------------------------------------------------------------------------
function updateHUD() {
    const flowsEl = document.getElementById('flows');
    const movesEl = document.getElementById('moves');
    const bestEl = document.getElementById('best');
    if (flowsEl) flowsEl.textContent = connectedCount() + ' / ' + numColors();
    if (movesEl) movesEl.textContent = String(moves);
    if (bestEl) {
        const b = readBest();
        bestEl.textContent = b == null ? '—' : b;
    }
}

function showOverlay(title, score, sub, btnLabel) {
    const overlay = document.getElementById('overlay');
    document.getElementById('overlay-title').textContent = title;
    document.getElementById('overlay-score').textContent = score || '';
    document.getElementById('overlay-sub').textContent = sub || '';
    document.getElementById('btn-start').textContent = btnLabel || 'Start Game';
    overlay.classList.add('visible');
}

function hideOverlay() {
    document.getElementById('overlay').classList.remove('visible');
}

function showWinOverlay() {
    showOverlay(
        'Solved!',
        'Level ' + (level + 1) + ' in ' + moves + ' move' + (moves === 1 ? '' : 's'),
        level < LEVELS.length - 1 ? 'Press N or Start for the next level' : 'You cleared every level!',
        level < LEVELS.length - 1 ? 'Next Level' : 'Play Again'
    );
}

function buildLevelButtons() {
    const wrap = document.getElementById('levels');
    if (!wrap) return;
    wrap.innerHTML = '';
    LEVELS.forEach((lv, i) => {
        const btn = document.createElement('button');
        btn.className = 'level-btn';
        btn.dataset.level = String(i);
        btn.textContent = lv.size + '×' + lv.size;
        btn.addEventListener('click', () => startGame(i));
        wrap.appendChild(btn);
    });
    updateLevelButtons();
}

function updateLevelButtons() {
    document.querySelectorAll('.level-btn').forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.level) === level);
    });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
    if (!ctx) return;
    const cell = CANVAS_PX / SIZE;

    ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);

    // background
    ctx.fillStyle = '#12152c';
    ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

    // grid lines
    ctx.strokeStyle = '#242a52';
    ctx.lineWidth = 1;
    for (let i = 0; i <= SIZE; i++) {
        const p = i * cell;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, CANVAS_PX);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(CANVAS_PX, p);
        ctx.stroke();
    }

    // pipes: draw as thick rounded lines through cell centres
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = cell * 0.34;
    for (let color = 0; color < numColors(); color++) {
        const pipe = paths[color];
        if (!pipe || pipe.length === 0) continue;
        ctx.strokeStyle = PALETTE[color % PALETTE.length];
        ctx.beginPath();
        for (let k = 0; k < pipe.length; k++) {
            const x = (pipe[k][1] + 0.5) * cell;
            const y = (pipe[k][0] + 0.5) * cell;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        // a single-cell pipe still gets a dot via the endpoint pass below
        if (pipe.length > 1) ctx.stroke();
    }

    // endpoint dots on top
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const color = endpointColor[r][c];
            if (color < 0) continue;
            const x = (c + 0.5) * cell;
            const y = (r + 0.5) * cell;
            ctx.fillStyle = PALETTE[color % PALETTE.length];
            ctx.beginPath();
            ctx.arc(x, y, cell * 0.3, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// ---------------------------------------------------------------------------
// Pointer + keyboard wiring
// ---------------------------------------------------------------------------
let pointerDown = false;

function eventCell(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (CANVAS_PX / rect.width);
    const y = (ev.clientY - rect.top) * (CANVAS_PX / rect.height);
    return pointerToCell(x, y);
}

function initInput() {
    canvas.addEventListener('pointerdown', (ev) => {
        if (state !== 'running') return;
        ev.preventDefault();
        pointerDown = true;
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
        const { r, c } = eventCell(ev);
        beginPath(r, c);
    });

    canvas.addEventListener('pointermove', (ev) => {
        if (!pointerDown || !drag) return;
        const { r, c } = eventCell(ev);
        extendPath(r, c);
    });

    const finish = () => {
        if (pointerDown) {
            pointerDown = false;
            endDrag();
        }
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    document.addEventListener('keydown', (ev) => {
        const k = ev.key.toLowerCase();
        if (k === 'r') {
            startGame(level);
        } else if (k === 'n') {
            startGame((level + 1) % LEVELS.length);
        }
    });

    document.getElementById('btn-start').addEventListener('click', () => {
        if (state === 'won') {
            startGame(level < LEVELS.length - 1 ? level + 1 : 0);
        } else {
            startGame(level);
        }
    });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function init() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    buildLevelButtons();
    initInput();
    // Prime the display with the current level's board (behind the overlay).
    const def = LEVELS[level];
    SIZE = def.size;
    cellColor = [];
    endpointColor = [];
    for (let r = 0; r < SIZE; r++) {
        cellColor.push(new Array(SIZE).fill(-1));
        endpointColor.push(new Array(SIZE).fill(-1));
    }
    paths = {};
    for (const e of def.ends) {
        endpointColor[e.a[0]][e.a[1]] = e.color;
        endpointColor[e.b[0]][e.b[1]] = e.color;
        cellColor[e.a[0]][e.a[1]] = e.color;
        cellColor[e.b[0]][e.b[1]] = e.color;
        paths[e.color] = [];
    }
    updateHUD();
    render();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
