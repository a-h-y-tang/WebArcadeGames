// ---------------------------------------------------------------------------
// SameGame — a click-to-clear connected-group tile puzzle on an HTML5 canvas.
// A single classic (non-module) script so the game state is reachable from the
// Playwright tests as globals, mirroring the other games in this repo.
// ---------------------------------------------------------------------------

const COLS = 14;
const ROWS = 10;
const CELL = 36; // pixels per tile
const NUM_COLORS = 4;
const CLEAR_BONUS = 1000;

// Tile fills and their glossy highlight tints.
const COLORS = ['#ff5a6a', '#ffd23f', '#4ade80', '#38bdf8'];
const HILITE = ['#ffd0d6', '#fff2b8', '#c6f6d5', '#bde8fc'];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const scoreEl = document.getElementById('score');
const previewEl = document.getElementById('preview');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

const BEST_KEY = 'samegame-best';
const START_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Spacebar', 'Enter']);

// --- State ---
// board[r][c] is a colour index 0..NUM_COLORS-1, or null for an empty cell.
let board, score, best, state, hover;

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

function clearBoard() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function fillBoard() {
    board = Array.from({ length: ROWS }, () =>
        Array.from({ length: COLS }, () => Math.floor(Math.random() * NUM_COLORS)));
}

function tilesLeft() {
    return board.flat().filter(v => v !== null).length;
}

function isCleared() {
    return tilesLeft() === 0;
}

function scoreFor(n) {
    return n * (n - 1);
}

// Flood-fill the connected same-colour region containing (r, c). Returns the
// cells as [r, c] pairs (size >= 1, or empty if the cell is blank).
function groupAt(r, c) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return [];
    const color = board[r][c];
    if (color === null) return [];
    const seen = new Set([r + ',' + c]);
    const stack = [[r, c]];
    const out = [];
    while (stack.length) {
        const [y, x] = stack.pop();
        out.push([y, x]);
        for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const ny = y + dy, nx = x + dx;
            if (ny < 0 || ny >= ROWS || nx < 0 || nx >= COLS) continue;
            const key = ny + ',' + nx;
            if (seen.has(key)) continue;
            if (board[ny][nx] === color) { seen.add(key); stack.push([ny, nx]); }
        }
    }
    return out;
}

// Let each column's tiles fall to rest on the floor / on tiles below them.
function applyGravity() {
    for (let c = 0; c < COLS; c++) {
        const col = [];
        for (let r = 0; r < ROWS; r++) if (board[r][c] !== null) col.push(board[r][c]);
        const top = ROWS - col.length;
        for (let r = 0; r < ROWS; r++) board[r][c] = r >= top ? col[r - top] : null;
    }
}

// Remove fully-empty columns by packing the remaining columns to the left.
function collapseColumns() {
    const kept = [];
    for (let c = 0; c < COLS; c++) {
        let empty = true;
        for (let r = 0; r < ROWS; r++) if (board[r][c] !== null) { empty = false; break; }
        if (!empty) kept.push(c);
    }
    const next = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    for (let i = 0; i < kept.length; i++) {
        for (let r = 0; r < ROWS; r++) next[r][i] = board[r][kept[i]];
    }
    board = next;
}

// True if any group of >= 2 same-colour tiles exists (a legal move remains).
function hasMoves() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const v = board[r][c];
            if (v === null) continue;
            if (r + 1 < ROWS && board[r + 1][c] === v) return true;
            if (c + 1 < COLS && board[r][c + 1] === v) return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Playing a move
// ---------------------------------------------------------------------------

// Remove the group at (r, c) if it has >= 2 tiles. Settles the board, scores,
// and handles board-clear / game-over. Returns the number of tiles removed.
function removeGroup(r, c) {
    if (state !== 'running') return 0;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] === null) return 0;
    const group = groupAt(r, c);
    if (group.length < 2) return 0;

    for (const [y, x] of group) board[y][x] = null;
    score += scoreFor(group.length);
    applyGravity();
    collapseColumns();
    hover = null;

    if (isCleared()) {
        score += CLEAR_BONUS;
        updateHud();
        endGame(true);
    } else {
        updateHud();
        if (!hasMoves()) endGame(false);
        else draw();
    }
    return group.length;
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
    let p = 0;
    if (state === 'running' && hover) {
        const g = groupAt(hover.r, hover.c);
        if (g.length >= 2) p = scoreFor(g.length);
    }
    previewEl.textContent = p;
}

function showOverlay(title, scoreText, sub, btn) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText || '';
    overlaySub.textContent = sub;
    btnStart.textContent = btn;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

function startGame() {
    do { fillBoard(); } while (!hasMoves());
    score = 0;
    hover = null;
    state = 'running';
    hideOverlay();
    updateHud();
    draw();
}

function endGame(cleared) {
    state = 'over';
    hover = null;
    if (score > best) {
        best = score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    draw();
    if (cleared) {
        showOverlay('Board Cleared!', 'Score: ' + score,
            'You removed every tile — nice work!', 'Play Again');
    } else {
        showOverlay('Game Over', 'Score: ' + score,
            'No moves left · ' + tilesLeft() + ' tiles remain', 'Play Again');
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawTile(px, py, colorIdx, highlighted) {
    const inset = highlighted ? 1 : 2;
    const x = px + inset, y = py + inset, s = CELL - inset * 2, r = 6;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + s, y, x + s, y + s, r);
    ctx.arcTo(x + s, y + s, x, y + s, r);
    ctx.arcTo(x, y + s, x, y, r);
    ctx.arcTo(x, y, x + s, y, r);
    ctx.closePath();
    ctx.fillStyle = COLORS[colorIdx];
    ctx.fill();
    if (highlighted) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x + s * 0.32, y + s * 0.3, s * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = HILITE[colorIdx];
    ctx.globalAlpha = highlighted ? 0.95 : 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;
}

function draw() {
    if (!ctx) return;
    ctx.fillStyle = '#05060d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Which cells are in the hovered group?
    let hi = null;
    if (state === 'running' && hover) {
        const g = groupAt(hover.r, hover.c);
        if (g.length >= 2) hi = new Set(g.map(([y, x]) => y + ',' + x));
    }

    if (board) {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (board[r][c] === null) continue;
                const on = hi && hi.has(r + ',' + c);
                drawTile(c * CELL, r * CELL, board[r][c], on);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const c = Math.floor(px / CELL);
    const r = Math.floor(py / CELL);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return { r, c };
}

canvas.addEventListener('click', (e) => {
    if (state === 'idle' || state === 'over') { startGame(); return; }
    if (state !== 'running') return;
    const cell = cellFromEvent(e);
    if (cell) removeGroup(cell.r, cell.c);
});

canvas.addEventListener('mousemove', (e) => {
    if (state !== 'running') return;
    const cell = cellFromEvent(e);
    const changed = (cell && (!hover || hover.r !== cell.r || hover.c !== cell.c)) ||
        (!cell && hover);
    hover = cell;
    if (changed) { updateHud(); draw(); }
});

canvas.addEventListener('mouseleave', () => {
    if (hover) { hover = null; updateHud(); draw(); }
});

document.addEventListener('keydown', (e) => {
    if ((state === 'idle' || state === 'over') && START_KEYS.has(e.key)) {
        e.preventDefault();
        startGame();
    }
});

btnStart.addEventListener('click', () => startGame());

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
    fillBoard();       // colourful backdrop behind the start overlay
    score = 0;
    hover = null;
    state = 'idle';
    const stored = parseInt(localStorage.getItem(BEST_KEY), 10);
    best = Number.isFinite(stored) ? stored : 0;
    updateHud();
    draw();
}

init();
