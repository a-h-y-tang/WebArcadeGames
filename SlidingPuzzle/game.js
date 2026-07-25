// ---------------------------------------------------------------------------
// Sliding Puzzle (15-puzzle) — slide numbered tiles back into order.
//
// The board is a flat array `tiles` of length SIZE*SIZE. Each entry is the
// number on that cell; 0 is the empty space. index = row * SIZE + col.
// ---------------------------------------------------------------------------

const SIZE = 4;
const CANVAS = 480;
const TILE = CANVAS / SIZE; // 120
const BEST_KEY = 'sliding-puzzle-best';

// The solved arrangement: 1..15 in order, blank last.
const GOAL = [...Array(SIZE * SIZE).keys()].map((n) => (n + 1) % (SIZE * SIZE));

const CLR = {
    bg:        '#161b22',
    gap:       '#0d1117',
    tile:      '#1f6feb',
    tileHome:  '#238636',   // tile already in its goal position
    tileEdge:  '#0d1117',
    text:      '#f0f6fc',
};

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const movesEl = document.getElementById('moves');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnNew = document.getElementById('btn-new');

// --- State ---
let tiles;
let moves;
let state;   // 'playing' | 'won'
let best;    // number | null

// --- Helpers -------------------------------------------------------------

const blankPos = () => tiles.indexOf(0);
const rowOf = (i) => Math.floor(i / SIZE);
const colOf = (i) => i % SIZE;

function isSolved() {
    return tiles.every((v, i) => v === GOAL[i]);
}

// --- Movement ------------------------------------------------------------

// Slide the tile at `index` (and any tiles between it and the blank) toward the
// blank. Only works when `index` shares a row or column with the blank.
// Returns true if the board changed.
function moveTile(index) {
    if (state === 'won') return false;
    if (tiles[index] === 0) return false;

    const blank = blankPos();
    let step;
    if (rowOf(index) === rowOf(blank)) {
        step = colOf(blank) > colOf(index) ? -1 : 1;
    } else if (colOf(index) === colOf(blank)) {
        step = rowOf(blank) > rowOf(index) ? -SIZE : SIZE;
    } else {
        return false; // not aligned with the blank
    }

    // Walk the blank toward the target one cell at a time, dragging tiles.
    let bi = blank;
    while (bi !== index) {
        const ni = bi + step;
        tiles[bi] = tiles[ni];
        tiles[ni] = 0;
        bi = ni;
    }

    moves++;
    updateHud();
    draw();

    if (isSolved()) onWin();
    return true;
}

// Arrow input: slide the single tile neighbouring the blank in the given
// direction into the gap. The arrow points where the tile travels.
function slide(dir) {
    const blank = blankPos();
    const r = rowOf(blank);
    const c = colOf(blank);
    let target = -1;
    if (dir === 'up'    && r < SIZE - 1) target = blank + SIZE; // tile below moves up
    if (dir === 'down'  && r > 0)        target = blank - SIZE; // tile above moves down
    if (dir === 'left'  && c < SIZE - 1) target = blank + 1;    // tile right moves left
    if (dir === 'right' && c > 0)        target = blank - 1;    // tile left moves right
    if (target !== -1) moveTile(target);
}

// --- Win / scoring -------------------------------------------------------

function onWin() {
    state = 'won';
    if (best === null || moves < best) {
        best = moves;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    const label = moves === 1 ? '1 move' : `${moves} moves`;
    showOverlay('Solved!', `Completed in ${label}`);
}

// --- Board setup ---------------------------------------------------------

// Set an explicit board (used by tests and internally). Resets the round.
function setBoard(arr) {
    tiles = arr.slice();
    moves = 0;
    state = 'playing';
    hideOverlay();
    updateHud();
    draw();
}

// Scramble from the solved state with random legal slides, guaranteeing the
// puzzle is solvable and not already complete.
function scramble() {
    tiles = GOAL.slice();
    let blank = tiles.length - 1;
    let prev = -1;
    const total = 400 + Math.floor(Math.random() * 100);
    for (let k = 0; k < total; k++) {
        const r = rowOf(blank);
        const c = colOf(blank);
        const nbrs = [];
        if (r > 0) nbrs.push(blank - SIZE);
        if (r < SIZE - 1) nbrs.push(blank + SIZE);
        if (c > 0) nbrs.push(blank - 1);
        if (c < SIZE - 1) nbrs.push(blank + 1);
        // Avoid immediately undoing the previous move for a better shuffle.
        const choices = nbrs.filter((n) => n !== prev);
        const pick = choices[Math.floor(Math.random() * choices.length)];
        tiles[blank] = tiles[pick];
        tiles[pick] = 0;
        prev = blank;
        blank = pick;
    }
    if (isSolved()) scramble();
}

function newGame() {
    scramble();
    moves = 0;
    state = 'playing';
    hideOverlay();
    updateHud();
    draw();
}

// --- HUD & overlay -------------------------------------------------------

function updateHud() {
    movesEl.textContent = String(moves);
    bestEl.textContent = best === null ? '—' : String(best);
}

function showOverlay(title, sub) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// --- Rendering -----------------------------------------------------------

function draw() {
    ctx.fillStyle = CLR.gap;
    ctx.fillRect(0, 0, CANVAS, CANVAS);

    for (let i = 0; i < tiles.length; i++) {
        const v = tiles[i];
        if (v === 0) continue;
        const x = colOf(i) * TILE;
        const y = rowOf(i) * TILE;
        const pad = 4;

        ctx.fillStyle = v === GOAL[i] ? CLR.tileHome : CLR.tile;
        ctx.beginPath();
        ctx.roundRect(x + pad, y + pad, TILE - 2 * pad, TILE - 2 * pad, 12);
        ctx.fill();

        ctx.fillStyle = CLR.text;
        ctx.font = '700 44px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), x + TILE / 2, y + TILE / 2 + 2);
    }
}

// --- Input ---------------------------------------------------------------

const KEY_DIR = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
};

window.addEventListener('keydown', (e) => {
    if (KEY_DIR[e.key]) {
        e.preventDefault();
        slide(KEY_DIR[e.key]);
    } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        newGame();
    }
});

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    // Account for any CSS scaling of the canvas.
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const col = Math.floor(px / TILE);
    const row = Math.floor(py / TILE);
    if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return;
    moveTile(row * SIZE + col);
});

btnNew.addEventListener('click', () => newGame());

// --- Boot ---
best = null;
try {
    const stored = localStorage.getItem(BEST_KEY);
    if (stored !== null) best = Number(stored);
} catch (e) { /* ignore */ }

newGame();
