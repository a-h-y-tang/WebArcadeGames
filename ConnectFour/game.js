// --- Board geometry ---
const ROWS = 6;
const COLS = 7;
const CELL = 80;
const W = COLS * CELL; // 560
const H = ROWS * CELL; // 480
const RADIUS = 32;

// Centre-out column preference for the AI.
const CENTER_ORDER = [3, 2, 4, 1, 5, 0, 6];

const COLORS = {
    board: '#0a3d91',
    hole: '#0a1226',
    1: '#e5484d', // red (human)
    2: '#f5c518', // yellow (AI)
};

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const redWinsEl = document.getElementById('red-wins');
const yellowWinsEl = document.getElementById('yellow-wins');
const drawsEl = document.getElementById('draws');
const btnNew = document.getElementById('btn-new');

// --- State (var so tests can read/assign them as globals) ---
var board, currentPlayer, state, winner, scores;
var aiThinking, hoverCol, winCells;

// -----------------------------------------------------------------------
// Board helpers
// -----------------------------------------------------------------------
function emptyBoard() {
    const b = [];
    for (let r = 0; r < ROWS; r++) b.push(new Array(COLS).fill(0));
    return b;
}

function setCell(row, col, player) {
    board[row][col] = player;
}

function lowestEmptyRow(col) {
    for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r][col] === 0) return r;
    }
    return -1;
}

function isColumnFull(col) {
    return board[0][col] !== 0;
}

function legalColumns() {
    const out = [];
    for (let c = 0; c < COLS; c++) if (!isColumnFull(c)) out.push(c);
    return out;
}

function isBoardFull() {
    return legalColumns().length === 0;
}

// -----------------------------------------------------------------------
// Win detection
// -----------------------------------------------------------------------
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

function fourFrom(r, c, dr, dc) {
    const p = board[r][c];
    if (p === 0) return null;
    const cells = [[r, c]];
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === p) {
        cells.push([rr, cc]);
        if (cells.length === 4) return cells;
        rr += dr; cc += dc;
    }
    return null;
}

// Returns 0 (no result), 1, 2, or 'draw'. Records the winning cells.
function checkWinner() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (board[r][c] === 0) continue;
            for (const [dr, dc] of DIRS) {
                const cells = fourFrom(r, c, dr, dc);
                if (cells) {
                    winCells = cells;
                    return board[r][c];
                }
            }
        }
    }
    if (isBoardFull()) return 'draw';
    return 0;
}

// Would `player` win by dropping into `col`? (Non-mutating check.)
function wouldWin(col, player) {
    const row = lowestEmptyRow(col);
    if (row === -1) return false;
    board[row][col] = player;
    let win = false;
    for (const [dr, dc] of DIRS) {
        // Check lines passing through the placed disc.
        if (lineLengthThrough(row, col, dr, dc, player) >= 4) { win = true; break; }
    }
    board[row][col] = 0;
    return win;
}

function lineLengthThrough(r, c, dr, dc, player) {
    let count = 1;
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === player) {
        count++; rr += dr; cc += dc;
    }
    rr = r - dr; cc = c - dc;
    while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === player) {
        count++; rr -= dr; cc -= dc;
    }
    return count;
}

// -----------------------------------------------------------------------
// Moves
// -----------------------------------------------------------------------
function dropDisc(col) {
    if (state !== 'playing') return -1;
    if (col < 0 || col >= COLS) return -1;
    const row = lowestEmptyRow(col);
    if (row === -1) return -1;

    board[row][col] = currentPlayer;

    const result = checkWinner();
    if (result !== 0) {
        endGame(result);
    } else {
        currentPlayer = currentPlayer === 1 ? 2 : 1;
        updateStatus();
    }
    draw();
    return row;
}

// -----------------------------------------------------------------------
// AI (deterministic one-ply heuristic)
// -----------------------------------------------------------------------
function aiChooseColumn() {
    const legal = legalColumns();
    if (legal.length === 0) return -1;

    // 1. Win now.
    for (const c of legal) if (wouldWin(c, 2)) return c;
    // 2. Block the opponent's immediate win.
    for (const c of legal) if (wouldWin(c, 1)) return c;
    // 3. Prefer the centre.
    for (const c of CENTER_ORDER) if (legal.includes(c)) return c;
    return legal[0];
}

function aiMove() {
    if (state !== 'playing' || currentPlayer !== 2) return;
    const col = aiChooseColumn();
    if (col >= 0) dropDisc(col);
}

// -----------------------------------------------------------------------
// Game flow
// -----------------------------------------------------------------------
function endGame(result) {
    winner = result;
    state = 'over';
    if (result === 1) scores.red++;
    else if (result === 2) scores.yellow++;
    else if (result === 'draw') scores.draws++;
    saveScores();
    updateScoreDisplay();
    updateStatus();
}

function reset() {
    board = emptyBoard();
    currentPlayer = 1;
    state = 'playing';
    winner = 0;
    winCells = null;
    aiThinking = false;
    updateStatus();
    draw();
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
function handleHumanDrop(col) {
    if (state !== 'playing' || currentPlayer !== 1 || aiThinking) return;
    const row = dropDisc(col);
    if (row === -1) return;
    if (state === 'playing' && currentPlayer === 2) {
        aiThinking = true;
        setTimeout(() => {
            aiMove();
            aiThinking = false;
            draw();
        }, 300);
    }
}

canvas.addEventListener('click', e => {
    const col = Math.floor(e.offsetX / CELL);
    if (col >= 0 && col < COLS) handleHumanDrop(col);
});

canvas.addEventListener('mousemove', e => {
    const col = Math.floor(e.offsetX / CELL);
    if (col !== hoverCol) {
        hoverCol = (col >= 0 && col < COLS) ? col : -1;
        draw();
    }
});

canvas.addEventListener('mouseleave', () => {
    hoverCol = -1;
    draw();
});

document.addEventListener('keydown', e => {
    if (e.key >= '1' && e.key <= '7') {
        handleHumanDrop(parseInt(e.key, 10) - 1);
    } else if (e.key === 'r' || e.key === 'R') {
        reset();
    }
});

btnNew.addEventListener('click', reset);

// -----------------------------------------------------------------------
// HUD
// -----------------------------------------------------------------------
function updateStatus() {
    if (state === 'over') {
        if (winner === 1) statusEl.textContent = 'Red wins!';
        else if (winner === 2) statusEl.textContent = 'Yellow wins!';
        else statusEl.textContent = "It's a draw!";
    } else {
        statusEl.textContent = (currentPlayer === 1 ? 'Red' : 'Yellow') + ' to move';
    }
}

function updateScoreDisplay() {
    redWinsEl.textContent = scores.red;
    yellowWinsEl.textContent = scores.yellow;
    drawsEl.textContent = scores.draws;
}

function saveScores() {
    try {
        localStorage.setItem('connect-four-score', JSON.stringify(scores));
    } catch (e) {}
}

function loadScores() {
    try {
        const raw = localStorage.getItem('connect-four-score');
        if (raw) {
            const s = JSON.parse(raw);
            return { red: s.red | 0, yellow: s.yellow | 0, draws: s.draws | 0 };
        }
    } catch (e) {}
    return { red: 0, yellow: 0, draws: 0 };
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function isWinCell(r, c) {
    return winCells && winCells.some(([wr, wc]) => wr === r && wc === c);
}

function drawDisc(r, c, player, ghost) {
    const cx = c * CELL + CELL / 2;
    const cy = r * CELL + CELL / 2;
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = COLORS[player];
    if (!ghost && isWinCell(r, c)) {
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 22;
    }
    ctx.fill();
    // Subtle inner highlight.
    if (!ghost) {
        ctx.beginPath();
        ctx.arc(cx - RADIUS * 0.28, cy - RADIUS * 0.28, RADIUS * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fill();
    }
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, W, H);

    // Blue board.
    ctx.fillStyle = COLORS.board;
    roundRectPath(0, 0, W, H, 14);
    ctx.fill();

    // Ghost preview of the human's pending drop.
    if (state === 'playing' && currentPlayer === 1 && !aiThinking &&
        hoverCol >= 0 && !isColumnFull(hoverCol)) {
        drawDisc(lowestEmptyRow(hoverCol), hoverCol, 1, true);
    }

    // Discs and empty holes.
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const v = board[r][c];
            if (v === 0) {
                const cx = c * CELL + CELL / 2;
                const cy = r * CELL + CELL / 2;
                ctx.beginPath();
                ctx.arc(cx, cy, RADIUS, 0, Math.PI * 2);
                ctx.fillStyle = COLORS.hole;
                ctx.fill();
            } else {
                drawDisc(r, c, v, false);
            }
        }
    }
}

// -----------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------
scores = loadScores();
hoverCol = -1;
reset();
updateScoreDisplay();
