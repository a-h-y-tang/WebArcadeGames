// ---------------------------------------------------------------------------
// 15 Puzzle (Sliding Tile Puzzle)
//
// Globals are intentionally left on `window` so the Playwright suite can drive
// the same code paths the UI uses. board[i]: 0 = empty gap, 1..15 = tiles.
// ---------------------------------------------------------------------------

const SIZE = 4;
const TILE_COUNT = SIZE * SIZE;              // 16
const SOLVED = [...Array(TILE_COUNT - 1).keys()].map(n => n + 1).concat(0);

// --- Canvas / layout --------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const BOARD_PX = 500;
const OUTER = 16;   // padding inside the canvas
const GAP = 8;      // gap between tiles
const TILE = Math.floor((BOARD_PX - 2 * OUTER - (SIZE - 1) * GAP) / SIZE);

const movesEl = document.getElementById('moves');
const timeEl = document.getElementById('time');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');

const CLR = {
    bg:        '#161b22',
    slot:      '#21262d',
    tile:      '#1f6feb',
    tileMove:  '#388bfd',
    tileEdge:  '#153e8a',
    text:      '#ffffff',
};

// --- State ------------------------------------------------------------------
let board = SOLVED.slice();
let blankIndex = TILE_COUNT - 1;
let moves = 0;
let state = 'playing';      // 'playing' | 'won'
let startTime = null;       // ms of first move; null until the player acts
let elapsedMs = 0;          // frozen elapsed time on win

// --- Geometry helpers -------------------------------------------------------
const rowOf = i => Math.floor(i / SIZE);
const colOf = i => i % SIZE;

function tileXY(index) {
    return {
        x: OUTER + colOf(index) * (TILE + GAP),
        y: OUTER + rowOf(index) * (TILE + GAP),
    };
}

function cellCenter(index) {
    const { x, y } = tileXY(index);
    return { x: x + TILE / 2, y: y + TILE / 2 };
}

function indexAtPixel(px, py) {
    for (let i = 0; i < TILE_COUNT; i++) {
        const { x, y } = tileXY(i);
        if (px >= x && px < x + TILE && py >= y && py < y + TILE) return i;
    }
    return null;
}

// --- Core logic -------------------------------------------------------------
function isSolved() {
    for (let i = 0; i < TILE_COUNT; i++) {
        if (board[i] !== SOLVED[i]) return false;
    }
    return true;
}

// A tile at `index` can move iff it is orthogonally adjacent to the blank.
function canSlide(index) {
    if (index < 0 || index >= TILE_COUNT || index === blankIndex) return false;
    const dr = Math.abs(rowOf(index) - rowOf(blankIndex));
    const dc = Math.abs(colOf(index) - colOf(blankIndex));
    return dr + dc === 1;
}

// Raw swap of a tile into the blank — no move counting, no win check.
// Used by the shuffler.
function rawSlide(index) {
    board[blankIndex] = board[index];
    board[index] = 0;
    blankIndex = index;
}

// Player-facing slide: counts the move and checks for a win.
function slideTile(index) {
    if (state !== 'playing') return false;
    if (!canSlide(index)) return false;
    ensureTimerStarted();
    rawSlide(index);
    moves++;
    movesEl.textContent = moves;
    afterMove();
    return true;
}

// Arrow names the direction a TILE moves into the blank.
function moveByArrow(key) {
    if (state !== 'playing') return false;
    let index = null;
    const br = rowOf(blankIndex);
    const bc = colOf(blankIndex);
    if (key === 'ArrowRight' && bc > 0)        index = blankIndex - 1;      // tile left of gap moves right
    else if (key === 'ArrowLeft' && bc < SIZE - 1) index = blankIndex + 1;  // tile right of gap moves left
    else if (key === 'ArrowDown' && br > 0)    index = blankIndex - SIZE;   // tile above gap moves down
    else if (key === 'ArrowUp' && br < SIZE - 1)   index = blankIndex + SIZE; // tile below gap moves up
    if (index === null) return false;
    return slideTile(index);
}

function afterMove() {
    draw();
    if (isSolved()) win();
}

// --- Shuffle / new game -----------------------------------------------------
function shuffle(n) {
    for (let k = 0; k < n; k++) {
        // Collect the blank's orthogonal neighbours and slide a random one.
        const neighbours = [];
        const br = rowOf(blankIndex);
        const bc = colOf(blankIndex);
        if (br > 0)        neighbours.push(blankIndex - SIZE);
        if (br < SIZE - 1) neighbours.push(blankIndex + SIZE);
        if (bc > 0)        neighbours.push(blankIndex - 1);
        if (bc < SIZE - 1) neighbours.push(blankIndex + 1);
        rawSlide(neighbours[Math.floor(Math.random() * neighbours.length)]);
    }
}

function newGame() {
    board = SOLVED.slice();
    blankIndex = TILE_COUNT - 1;
    do {
        shuffle(200);
    } while (isSolved());          // never hand back a solved board
    moves = 0;
    state = 'playing';
    startTime = null;
    elapsedMs = 0;
    movesEl.textContent = '0';
    overlay.classList.remove('visible');
    updateTimerDisplay();
    draw();
}

// Test/helper: set an exact board and reset play state.
function setBoard(arr) {
    board = arr.slice();
    blankIndex = board.indexOf(0);
    moves = 0;
    state = 'playing';
    startTime = null;
    elapsedMs = 0;
    movesEl.textContent = '0';
    overlay.classList.remove('visible');
    updateTimerDisplay();
    draw();
}

// --- Win / best -------------------------------------------------------------
function win() {
    state = 'won';
    elapsedMs = startTime === null ? 0 : Date.now() - startTime;
    recordBest();
    overlayTitle.textContent = 'Solved!';
    overlaySub.textContent = `${moves} moves · ${formatTime(elapsedMs)}`;
    overlay.classList.add('visible');
    updateTimerDisplay();
    draw();
}

function recordBest() {
    const bm = localStorage.getItem('fifteen-best-moves');
    if (bm === null || moves < parseInt(bm, 10)) {
        localStorage.setItem('fifteen-best-moves', String(moves));
    }
    const bt = localStorage.getItem('fifteen-best-time');
    if (bt === null || elapsedMs < parseInt(bt, 10)) {
        localStorage.setItem('fifteen-best-time', String(elapsedMs));
    }
    loadBest();
}

function loadBest() {
    const bm = localStorage.getItem('fifteen-best-moves');
    bestEl.textContent = bm === null ? '--' : `${bm} moves`;
}

// --- Timer ------------------------------------------------------------------
function ensureTimerStarted() {
    if (startTime === null) startTime = Date.now();
}

function currentElapsedMs() {
    if (state === 'won') return elapsedMs;
    if (startTime === null) return 0;
    return Date.now() - startTime;
}

function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
}

function updateTimerDisplay() {
    timeEl.textContent = formatTime(currentElapsedMs());
}

// rAF drives the clock — headless Chromium throttles setInterval on background
// tabs but keeps requestAnimationFrame ticking.
function timerLoop() {
    updateTimerDisplay();
    requestAnimationFrame(timerLoop);
}
requestAnimationFrame(timerLoop);

// --- Rendering --------------------------------------------------------------
function draw() {
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < TILE_COUNT; i++) {
        const { x, y } = tileXY(i);
        if (board[i] === 0) {
            // empty slot
            ctx.fillStyle = CLR.slot;
            roundRect(x, y, TILE, TILE, 10);
            ctx.fill();
            continue;
        }
        const movable = canSlide(i);
        ctx.fillStyle = movable ? CLR.tileMove : CLR.tile;
        roundRect(x, y, TILE, TILE, 10);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = CLR.tileEdge;
        ctx.stroke();

        ctx.fillStyle = CLR.text;
        ctx.font = `bold ${Math.floor(TILE * 0.4)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(board[i]), x + TILE / 2, y + TILE / 2 + 2);
    }
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

// --- Input ------------------------------------------------------------------
canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const idx = indexAtPixel(x, y);
    if (idx !== null) slideTile(idx);
});

document.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        moveByArrow(e.key);
        e.preventDefault();
    }
});

document.getElementById('btn-new').addEventListener('click', newGame);
document.getElementById('btn-overlay-new').addEventListener('click', newGame);

// --- Init -------------------------------------------------------------------
loadBest();
newGame();
