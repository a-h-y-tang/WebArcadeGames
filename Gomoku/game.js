// ---------------------------------------------------------------------------
// Gomoku (Five in a Row) — you are Black against a heuristic AI (White).
// Top-level declarations live in the page's global scope so the Playwright
// suite can drive and inspect the game directly (same convention as the other
// games in this repo).
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const BOARD_SIZE = 15;        // 15 x 15 intersections
const CELL = 34;              // pixel pitch between intersections
const MARGIN = 32;            // border from the canvas edge to the first line
const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;

const BLACK = 1;             // the human
const WHITE = 2;             // the AI

const STAR_POINTS = [3, 7, 11]; // hoshi coordinates for a 15x15 board

const COLORS = {
    board: '#d9a441',
    line: '#4a3410',
    star: '#3a2a0c',
    blackStone: '#161b22',
    blackEdge: '#000000',
    whiteStone: '#f4f6fb',
    whiteEdge: '#9aa4b2',
    lastRing: '#e0453a',
};

// DOM ----------------------------------------------------------------------
const turnEl = document.getElementById('turn');
const movesEl = document.getElementById('moves');
const winsEl = document.getElementById('wins');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// State --------------------------------------------------------------------
let board, currentPlayer, winner, moveCount, wins, state, lastMove;

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

function makeBoard() {
    const grid = [];
    for (let r = 0; r < BOARD_SIZE; r++) grid.push(new Array(BOARD_SIZE).fill(0));
    return grid;
}

function inBounds(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

// Five (or more) contiguous `player` stones through (r, c) along any axis.
function checkWin(r, c, player) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
        let count = 1;
        let nr = r + dr;
        let nc = c + dc;
        while (inBounds(nr, nc) && board[nr][nc] === player) { count++; nr += dr; nc += dc; }
        nr = r - dr; nc = c - dc;
        while (inBounds(nr, nc) && board[nr][nc] === player) { count++; nr -= dr; nc -= dc; }
        if (count >= 5) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Core move logic (no AI side-effects — tests drive both colours directly)
// ---------------------------------------------------------------------------

function placeStone(r, c) {
    if (state !== 'playing') return false;
    if (!inBounds(r, c)) return false;
    if (board[r][c] !== 0) return false;

    const p = currentPlayer;
    board[r][c] = p;
    moveCount++;
    lastMove = { r, c };

    if (checkWin(r, c, p)) {
        endGame(p);
        render();
        return true;
    }
    if (moveCount >= TOTAL_CELLS) {
        endGame(0);
        render();
        return true;
    }

    currentPlayer = p === BLACK ? WHITE : BLACK;
    updateHud();
    render();
    return true;
}

// ---------------------------------------------------------------------------
// AI opponent (deterministic heuristic)
// ---------------------------------------------------------------------------

// Would placing `p` at (r, c) immediately win?
function wouldWin(r, c, p) {
    board[r][c] = p;
    const win = checkWin(r, c, p);
    board[r][c] = 0;
    return win;
}

// Value of the run `p` would build through an empty (r, c) along one axis.
function lineValue(r, c, p) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    let score = 0;
    for (const [dr, dc] of dirs) {
        let count = 1;
        let open = 0;
        let nr = r + dr;
        let nc = c + dc;
        while (inBounds(nr, nc) && board[nr][nc] === p) { count++; nr += dr; nc += dc; }
        if (inBounds(nr, nc) && board[nr][nc] === 0) open++;
        nr = r - dr; nc = c - dc;
        while (inBounds(nr, nc) && board[nr][nc] === p) { count++; nr -= dr; nc -= dc; }
        if (inBounds(nr, nc) && board[nr][nc] === 0) open++;
        if (open === 0 && count < 5) continue;      // fully blocked run — worthless
        score += Math.pow(10, Math.min(count, 5)) * (open + 1);
    }
    return score;
}

function bestMove(me) {
    const opp = me === BLACK ? WHITE : BLACK;

    // 1. Take an immediate win.
    for (let r = 0; r < BOARD_SIZE; r++)
        for (let c = 0; c < BOARD_SIZE; c++)
            if (board[r][c] === 0 && wouldWin(r, c, me)) return { r, c };

    // 2. Block the opponent's immediate win.
    for (let r = 0; r < BOARD_SIZE; r++)
        for (let c = 0; c < BOARD_SIZE; c++)
            if (board[r][c] === 0 && wouldWin(r, c, opp)) return { r, c };

    // 3. Otherwise maximise our own potential while denying theirs, pulled
    //    gently toward the centre. Scan order breaks ties deterministically.
    const mid = (BOARD_SIZE - 1) / 2;
    let best = null;
    let bestScore = -Infinity;
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r][c] !== 0) continue;
            const s = lineValue(r, c, me)
                + lineValue(r, c, opp) * 0.9
                - (Math.abs(r - mid) + Math.abs(c - mid));
            if (s > bestScore) { bestScore = s; best = { r, c }; }
        }
    }
    return best;
}

function aiMove() {
    if (state !== 'playing') return;
    const move = bestMove(currentPlayer);
    if (move) placeStone(move.r, move.c);
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    board = makeBoard();
    currentPlayer = BLACK;
    winner = 0;
    moveCount = 0;
    lastMove = null;
    state = 'playing';
    hideOverlay();
    updateHud();
    render();
}

function endGame(w) {
    state = 'over';
    winner = w;
    if (w === BLACK) {
        wins++;
        try { localStorage.setItem('gomoku.wins', String(wins)); } catch (e) { /* ignore */ }
    }
    updateHud();

    let title;
    let sub;
    if (w === BLACK) {
        title = 'Black Wins — You Win!';
        sub = 'Five in a row. Play again?';
    } else if (w === WHITE) {
        title = 'White Wins — AI Wins';
        sub = 'The computer got five first. Try again?';
    } else {
        title = 'Draw';
        sub = 'The board filled with no five in a row.';
    }
    showOverlay(title, sub, '', 'Play Again');
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    turnEl.textContent = currentPlayer === BLACK ? 'Black' : 'White';
    movesEl.textContent = moveCount;
    winsEl.textContent = wins;
}

function showOverlay(title, sub, scoreText, buttonLabel) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlayScore.textContent = scoreText || '';
    btnStart.textContent = buttonLabel || 'Start Game';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function cellToPixel(r, c) {
    return { x: MARGIN + c * CELL, y: MARGIN + r * CELL };
}

function pixelToCell(x, y) {
    const c = Math.round((x - MARGIN) / CELL);
    const r = Math.round((y - MARGIN) / CELL);
    if (!inBounds(r, c)) return null;
    const { x: px, y: py } = cellToPixel(r, c);
    if (Math.hypot(px - x, py - y) > CELL * 0.5) return null;
    return { r, c };
}

function drawStone(r, c, player) {
    const { x, y } = cellToPixel(r, c);
    const rad = CELL * 0.42;

    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.1, x, y, rad);
    if (player === BLACK) {
        g.addColorStop(0, '#3b434e');
        g.addColorStop(1, COLORS.blackStone);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = COLORS.blackEdge;
    } else {
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, COLORS.whiteStone);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = COLORS.whiteEdge;
    }
    ctx.lineWidth = 1;
    ctx.stroke();
}

function render() {
    // Wood board
    ctx.fillStyle = COLORS.board;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid lines
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    const start = MARGIN;
    const end = MARGIN + (BOARD_SIZE - 1) * CELL;
    ctx.beginPath();
    for (let i = 0; i < BOARD_SIZE; i++) {
        const p = MARGIN + i * CELL;
        ctx.moveTo(start, p); ctx.lineTo(end, p);   // horizontal
        ctx.moveTo(p, start); ctx.lineTo(p, end);   // vertical
    }
    ctx.stroke();

    // Star points
    ctx.fillStyle = COLORS.star;
    for (const r of STAR_POINTS)
        for (const c of STAR_POINTS) {
            const { x, y } = cellToPixel(r, c);
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            ctx.fill();
        }

    if (!board) return;

    // Stones
    for (let r = 0; r < BOARD_SIZE; r++)
        for (let c = 0; c < BOARD_SIZE; c++)
            if (board[r][c] !== 0) drawStone(r, c, board[r][c]);

    // Last-move marker
    if (lastMove) {
        const { x, y } = cellToPixel(lastMove.r, lastMove.c);
        ctx.strokeStyle = COLORS.lastRing;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, CELL * 0.5, 0, Math.PI * 2);
        ctx.stroke();
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

canvas.addEventListener('click', (e) => {
    if (state !== 'playing' || currentPlayer !== BLACK) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const cell = pixelToCell(x, y);
    if (!cell) return;

    const placed = placeStone(cell.r, cell.c);
    if (placed && state === 'playing' && currentPlayer === WHITE) {
        setTimeout(aiMove, 250);
    }
});

window.addEventListener('keydown', (e) => {
    if (state === 'idle' || state === 'over') {
        if (e.key === 'Enter' || e.key === ' ') {
            startGame();
            e.preventDefault();
        }
    }
});

btnStart.addEventListener('click', startGame);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function init() {
    board = makeBoard();
    currentPlayer = BLACK;
    winner = 0;
    moveCount = 0;
    lastMove = null;
    state = 'idle';

    wins = 0;
    try {
        const stored = localStorage.getItem('gomoku.wins');
        if (stored !== null) wins = Number(stored) || 0;
    } catch (e) { /* ignore */ }

    updateHud();
    showOverlay('Gomoku',
        'You are Black — line up five in a row. Click the board or press Start to start.',
        '', 'Start Game');
    render();
}

init();
