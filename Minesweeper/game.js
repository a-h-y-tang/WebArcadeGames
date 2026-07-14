// ---------------------------------------------------------------------------
// Minesweeper — HTML5 Canvas
//
// Top-level `let` bindings (board, state, minesPlaced, ...) and the core
// functions (reveal, toggleFlag, computeAdjacency, ...) are intentionally
// global so the Playwright suite can build deterministic boards and drive the
// game via page.evaluate(), matching the convention used by the other games in
// this repo.
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const COLS = 9;
const ROWS = 9;
const MINES = 10;
const CELL = 40;           // 9 * 40 = 360, matching the canvas size

// --- State -----------------------------------------------------------------
let state = 'idle';        // idle | running | won | lost
let board = [];            // board[row][col] = { mine, revealed, flagged, adjacent }
let minesPlaced = false;
let flagCount = 0;
let startTime = 0;         // ms timestamp of the first reveal (0 = not started)
let best = readBest();

// --- DOM -------------------------------------------------------------------
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const minesEl = document.getElementById('mines');
const timeEl = document.getElementById('time');
const bestEl = document.getElementById('best');

// Classic per-number colours.
const NUM_COLORS = {
    1: '#3b82f6', 2: '#22c55e', 3: '#ef4444', 4: '#a855f7',
    5: '#f97316', 6: '#14b8a6', 7: '#e6edf3', 8: '#94a3b8',
};

// ---------------------------------------------------------------------------
// Board setup
// ---------------------------------------------------------------------------
function newBoard() {
    board = [];
    minesPlaced = false;
    flagCount = 0;
    startTime = 0;
    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
            row.push({ mine: false, revealed: false, flagged: false, adjacent: 0 });
        }
        board.push(row);
    }
}

function inBounds(c, r) {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS;
}

function* neighbors(c, r) {
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dc === 0 && dr === 0) continue;
            const nc = c + dc;
            const nr = r + dr;
            if (inBounds(nc, nr)) yield [nc, nr];
        }
    }
}

// Scatter MINES mines, keeping the first-clicked cell and its neighbours clear
// so the opening move always reveals an area rather than ending the game.
function placeMines(safeC, safeR) {
    const forbidden = new Set([`${safeC},${safeR}`]);
    for (const [nc, nr] of neighbors(safeC, safeR)) forbidden.add(`${nc},${nr}`);

    let placed = 0;
    while (placed < MINES) {
        const c = Math.floor(Math.random() * COLS);
        const r = Math.floor(Math.random() * ROWS);
        if (forbidden.has(`${c},${r}`) || board[r][c].mine) continue;
        board[r][c].mine = true;
        placed++;
    }
    computeAdjacency();
    minesPlaced = true;
}

function computeAdjacency() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            let n = 0;
            for (const [nc, nr] of neighbors(c, r)) {
                if (board[nr][nc].mine) n++;
            }
            board[r][c].adjacent = n;
        }
    }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function reveal(c, r) {
    if (state !== 'running' || !inBounds(c, r)) return;
    if (!minesPlaced) placeMines(c, r);

    const cell = board[r][c];
    if (cell.revealed || cell.flagged) return;

    if (!startTime) startTime = Date.now();

    cell.revealed = true;

    if (cell.mine) {
        lose();
        return;
    }

    if (cell.adjacent === 0) floodReveal(c, r);
    checkWin();
    render();
}

// Iterative flood fill: an opened blank cell auto-reveals its neighbours, and
// any neighbour that is itself blank keeps the cascade going.
function floodReveal(sc, sr) {
    const stack = [[sc, sr]];
    while (stack.length) {
        const [c, r] = stack.pop();
        for (const [nc, nr] of neighbors(c, r)) {
            const cell = board[nr][nc];
            if (cell.revealed || cell.flagged || cell.mine) continue;
            cell.revealed = true;
            if (cell.adjacent === 0) stack.push([nc, nr]);
        }
    }
}

function toggleFlag(c, r) {
    if (state !== 'running' || !inBounds(c, r)) return;
    const cell = board[r][c];
    if (cell.revealed) return;
    cell.flagged = !cell.flagged;
    flagCount += cell.flagged ? 1 : -1;
    renderHud();
    render();
}

function checkWin() {
    // Won once every non-mine cell has been revealed.
    for (const cell of board.flat()) {
        if (!cell.mine && !cell.revealed) return;
    }
    win();
}

// ---------------------------------------------------------------------------
// Endings
// ---------------------------------------------------------------------------
function elapsedSeconds() {
    return startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
}

function win() {
    state = 'won';
    // Flag every mine for a tidy finished board.
    for (const cell of board.flat()) {
        if (cell.mine && !cell.flagged) { cell.flagged = true; flagCount++; }
    }
    const secs = elapsedSeconds();
    if (best === null || secs < best) {
        best = secs;
        localStorage.setItem('minesweeper-best', String(best));
    }
    renderHud();
    showOverlay('You Win!', formatTime(secs), 'Press any key to play again', 'Play Again');
    render();
}

function lose() {
    state = 'lost';
    for (const cell of board.flat()) {
        if (cell.mine) cell.revealed = true;
    }
    renderHud();
    showOverlay('Game Over', '', 'Press any key to play again', 'Play Again');
    render();
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------
function startGame() {
    newBoard();
    state = 'running';
    hideOverlay();
    renderHud();
    render();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------
function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function renderHud() {
    minesEl.textContent = Math.max(0, MINES - flagCount);
    bestEl.textContent = best === null ? '—' : formatTime(best);
}

function readBest() {
    const raw = localStorage.getItem('minesweeper-best');
    if (raw === null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
}

function showOverlay(title, big, sub, btn) {
    overlayTitle.textContent = title;
    overlayScore.textContent = big;
    overlaySub.textContent = sub;
    btnStart.textContent = btn;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            drawCell(c, r, board[r][c]);
        }
    }
}

function drawCell(c, r, cell) {
    const x = c * CELL;
    const y = r * CELL;

    if (cell.revealed) {
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(x, y, CELL, CELL);
        if (cell.mine) {
            drawMine(x, y, state === 'lost');
        } else if (cell.adjacent > 0) {
            ctx.fillStyle = NUM_COLORS[cell.adjacent] || '#e6edf3';
            ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(cell.adjacent), x + CELL / 2, y + CELL / 2 + 1);
        }
    } else {
        // Raised, unrevealed tile.
        ctx.fillStyle = '#30363d';
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        ctx.fillStyle = '#3d444d';
        ctx.fillRect(x + 1, y + 1, CELL - 2, 3);
        ctx.fillStyle = '#22262c';
        ctx.fillRect(x + 1, y + CELL - 4, CELL - 2, 3);
        if (cell.flagged) drawFlag(x, y);
    }

    // Grid lines.
    ctx.strokeStyle = '#161b22';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, CELL, CELL);
}

function drawMine(x, y, hit) {
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    if (hit) {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(x, y, CELL, CELL);
    }
    ctx.fillStyle = '#0d1117';
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0d1117';
    ctx.lineWidth = 2;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 5, cy + Math.sin(a) * 5);
        ctx.lineTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12);
        ctx.stroke();
    }
    ctx.fillStyle = '#e6edf3';
    ctx.beginPath();
    ctx.arc(cx - 2, cy - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
}

function drawFlag(x, y) {
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + CELL / 2, y + 9);
    ctx.lineTo(x + CELL / 2, y + CELL - 9);
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(x + CELL / 2, y + 9);
    ctx.lineTo(x + CELL / 2 + 11, y + 14);
    ctx.lineTo(x + CELL / 2, y + 19);
    ctx.closePath();
    ctx.fill();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return [Math.floor(px / CELL), Math.floor(py / CELL)];
}

canvas.addEventListener('mousedown', (e) => {
    if (state !== 'running') return;
    const [c, r] = cellFromEvent(e);
    if (e.button === 2) toggleFlag(c, r);
    else if (e.button === 0) reveal(c, r);
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', () => {
    if (state !== 'running') startGame();
});

btnStart.addEventListener('click', () => startGame());

// ---------------------------------------------------------------------------
// Live timer
// ---------------------------------------------------------------------------
function tickTimer() {
    timeEl.textContent = formatTime(state === 'running' ? elapsedSeconds() : elapsedSeconds());
    requestAnimationFrame(tickTimer);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
newBoard();
renderHud();
render();
requestAnimationFrame(tickTimer);
