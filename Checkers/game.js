// ---------------------------------------------------------------------------
// Checkers (American / English draughts)
// ---------------------------------------------------------------------------
// board[row][col], row 0 = top. Only dark squares ((r+c)%2===1) are used.
// Cell values: 0 empty, 1 red man, 3 red king (human), 2 black man, 4 black king (AI).
// Red moves UP (toward row 0); black moves DOWN (toward row 7).
// ---------------------------------------------------------------------------

const ROWS = 8;
const COLS = 8;
const SQUARE = 70;
const AI_DEPTH = 6;
const AI_DELAY = 320;

const RED = 1;
const BLACK = 2;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const redCountEl = document.getElementById('red-count');
const blackCountEl = document.getElementById('black-count');
const turnEl = document.getElementById('turn-indicator');

// --- Colors ---
const CLR = {
    light: '#e9d8b6',
    dark: '#7c4a24',
    red: '#ef4444',
    redDark: '#991b1b',
    black: '#1f2937',
    blackDark: '#0b0f16',
    crown: '#fbbf24',
    select: 'rgba(250, 204, 21, 0.55)',
    target: 'rgba(74, 222, 128, 0.55)',
};

// --- State ---
let board, currentPlayer, state, winner, selected;
let aiEnabled = true;
let aiTimer = null;
let gameId = 0;

// ---------------------------------------------------------------------------
// Piece helpers
// ---------------------------------------------------------------------------

function ownerOf(v) {
    if (v === 1 || v === 3) return 1;
    if (v === 2 || v === 4) return 2;
    return 0;
}

function isKing(v) {
    return v === 3 || v === 4;
}

function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function dirsFor(v) {
    if (isKing(v)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    if (v === 1) return [[-1, -1], [-1, 1]]; // red moves up
    return [[1, -1], [1, 1]]; // black moves down
}

function willPromote(v, row) {
    return (v === 1 && row === 0) || (v === 2 && row === ROWS - 1);
}

function kingOf(v) {
    return v === 1 ? 3 : v === 2 ? 4 : v;
}

function countPieces(player) {
    let n = 0;
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            if (ownerOf(board[r][c]) === player) n++;
    return n;
}

// ---------------------------------------------------------------------------
// Move generation
// ---------------------------------------------------------------------------

// All maximal jump sequences for the piece at (r,c) on board `bd`.
// Returns [{ to: [r,c], captures: [[r,c],...] }, ...].
function findJumps(r, c, v, bd) {
    const seqs = [];
    for (const [dr, dc] of dirsFor(v)) {
        const mr = r + dr, mc = c + dc;
        const lr = r + 2 * dr, lc = c + 2 * dc;
        if (!inBounds(lr, lc) || bd[lr][lc] !== 0) continue;
        const mid = inBounds(mr, mc) ? bd[mr][mc] : 0;
        if (mid === 0 || ownerOf(mid) === ownerOf(v)) continue;

        const nb = bd.map((row) => row.slice());
        nb[r][c] = 0;
        nb[mr][mc] = 0;
        let nv = v;
        let promoted = false;
        if (!isKing(v) && willPromote(v, lr)) {
            nv = kingOf(v);
            promoted = true;
        }
        nb[lr][lc] = nv;

        const cont = promoted ? [] : findJumps(lr, lc, nv, nb);
        if (cont.length) {
            for (const seq of cont) {
                seqs.push({ to: seq.to, captures: [[mr, mc], ...seq.captures] });
            }
        } else {
            seqs.push({ to: [lr, lc], captures: [[mr, mc]] });
        }
    }
    return seqs;
}

function simpleMoves(r, c, v, bd) {
    const out = [];
    for (const [dr, dc] of dirsFor(v)) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc) && bd[nr][nc] === 0) {
            out.push({ from: [r, c], to: [nr, nc], captures: [] });
        }
    }
    return out;
}

// Legal moves for `player` on board `bd`, enforcing mandatory capture.
function movesForBoard(bd, player) {
    const captures = [];
    const simples = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const v = bd[r][c];
            if (ownerOf(v) !== player) continue;
            const js = findJumps(r, c, v, bd);
            for (const seq of js) {
                captures.push({ from: [r, c], to: seq.to, captures: seq.captures });
            }
            if (captures.length === 0) {
                simples.push(...simpleMoves(r, c, v, bd));
            }
        }
    }
    return captures.length ? captures : simples;
}

function getMoves(player) {
    return movesForBoard(board, player);
}

function getPieceMoves(r, c) {
    const owner = ownerOf(board[r][c]);
    if (owner === 0) return [];
    return getMoves(owner).filter((m) => m.from[0] === r && m.from[1] === c);
}

function hasAnyCapture(player) {
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            if (ownerOf(board[r][c]) === player &&
                findJumps(r, c, board[r][c], board).length) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Applying moves
// ---------------------------------------------------------------------------

function applyMoveToBoard(bd, move) {
    const nb = bd.map((row) => row.slice());
    const [fr, fc] = move.from;
    const [tr, tc] = move.to;
    let v = nb[fr][fc];
    nb[fr][fc] = 0;
    for (const [cr, cc] of move.captures) nb[cr][cc] = 0;
    if (!isKing(v) && willPromote(v, tr)) v = kingOf(v);
    nb[tr][tc] = v;
    return nb;
}

// Apply a move for the piece's owner, switch turns, and resolve end/AI.
function applyMove(move) {
    const [fr, fc] = move.from;
    const mover = ownerOf(board[fr][fc]) || currentPlayer;
    board = applyMoveToBoard(board, move);
    selected = null;
    currentPlayer = mover === RED ? BLACK : RED;
    updateHud();

    if (getMoves(currentPlayer).length === 0) {
        winner = mover;
        endGame();
    } else if (currentPlayer === BLACK && state === 'playing' && aiEnabled) {
        scheduleAI();
    }
}

function scheduleAI() {
    const id = gameId;
    clearTimeout(aiTimer);
    state = 'thinking';
    updateHud();
    aiTimer = setTimeout(() => {
        if (gameId !== id || state !== 'thinking') return;
        const move = bestMove(BLACK);
        state = 'playing';
        if (move) applyMove(move);
    }, AI_DELAY);
}

// ---------------------------------------------------------------------------
// AI — minimax with alpha-beta pruning (deterministic)
// ---------------------------------------------------------------------------

function evaluateBoard(bd, ai) {
    let score = 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const v = bd[r][c];
            if (v === 0) continue;
            const owner = ownerOf(v);
            let val = isKing(v) ? 12 : 5;
            if (!isKing(v)) {
                // Reward advancement toward promotion.
                val += v === 1 ? (ROWS - 1 - r) * 0.2 : r * 0.2;
            }
            score += owner === ai ? val : -val;
        }
    }
    return score;
}

function minimax(bd, depth, alpha, beta, player, ai) {
    const moves = movesForBoard(bd, player);
    if (moves.length === 0) {
        // The side to move has lost.
        return player === ai ? -100000 - depth : 100000 + depth;
    }
    if (depth === 0) return evaluateBoard(bd, ai);
    const next = player === RED ? BLACK : RED;

    if (player === ai) {
        let best = -Infinity;
        for (const m of moves) {
            const nb = applyMoveToBoard(bd, m);
            best = Math.max(best, minimax(nb, depth - 1, alpha, beta, next, ai));
            alpha = Math.max(alpha, best);
            if (alpha >= beta) break;
        }
        return best;
    }
    let best = Infinity;
    for (const m of moves) {
        const nb = applyMoveToBoard(bd, m);
        best = Math.min(best, minimax(nb, depth - 1, alpha, beta, next, ai));
        beta = Math.min(beta, best);
        if (alpha >= beta) break;
    }
    return best;
}

function bestMove(player) {
    const moves = movesForBoard(board, player);
    if (moves.length === 0) return null;
    const next = player === RED ? BLACK : RED;
    let bestScore = -Infinity;
    let best = moves[0];
    for (const m of moves) {
        const nb = applyMoveToBoard(board, m);
        const score = minimax(nb, AI_DEPTH - 1, -Infinity, Infinity, next, player);
        if (score > bestScore) {
            bestScore = score;
            best = m;
        }
    }
    return best;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function selectPiece(r, c) {
    if (state !== 'playing' || currentPlayer !== RED) return;
    if (ownerOf(board[r][c]) === RED && getPieceMoves(r, c).length) {
        selected = [r, c];
    }
}

function clickSquare(r, c) {
    if (state !== 'playing' || currentPlayer !== RED) return;
    if (selected) {
        const moves = getPieceMoves(selected[0], selected[1]);
        const mv = moves.find((m) => m.to[0] === r && m.to[1] === c);
        if (mv) {
            applyMove(mv);
            return;
        }
    }
    if (ownerOf(board[r][c]) === RED && getPieceMoves(r, c).length) {
        selected = [r, c];
    } else {
        selected = null;
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function initialBoard() {
    const b = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    for (let r = 0; r < 3; r++)
        for (let c = 0; c < COLS; c++)
            if ((r + c) % 2 === 1) b[r][c] = BLACK;
    for (let r = ROWS - 3; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            if ((r + c) % 2 === 1) b[r][c] = RED;
    return b;
}

function startGame() {
    gameId++;
    clearTimeout(aiTimer);
    board = initialBoard();
    currentPlayer = RED;
    winner = null;
    selected = null;
    aiEnabled = true;
    state = 'playing';
    overlay.classList.remove('visible');
    updateHud();
}

function restart() {
    startGame();
}

function endGame() {
    state = 'over';
    clearTimeout(aiTimer);
    updateHud();
    if (winner === RED) {
        overlayTitle.textContent = 'You win! 🎉';
        overlaySub.textContent = 'You captured the computer. Nicely played.';
    } else {
        overlayTitle.textContent = 'AI wins';
        overlaySub.textContent = 'The computer boxed you in. Try again!';
    }
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function updateHud() {
    if (redCountEl) redCountEl.textContent = countPieces(RED);
    if (blackCountEl) blackCountEl.textContent = countPieces(BLACK);
    if (state === 'playing') {
        turnEl.textContent = 'Your move';
        turnEl.classList.remove('ai');
    } else if (state === 'thinking') {
        turnEl.textContent = 'AI thinking…';
        turnEl.classList.add('ai');
    }
}

// ---------------------------------------------------------------------------
// Input handlers
// ---------------------------------------------------------------------------

btnStart.addEventListener('click', (e) => {
    e.stopPropagation();
    startGame();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        startGame();
    }
});

canvas.addEventListener('click', (e) => {
    if (state === 'ready' || state === 'over') {
        startGame();
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const c = Math.floor(x / SQUARE);
    const r = Math.floor(y / SQUARE);
    if (inBounds(r, c)) clickSquare(r, c);
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawPiece(r, c, v) {
    const cx = c * SQUARE + SQUARE / 2;
    const cy = r * SQUARE + SQUARE / 2;
    const rad = SQUARE * 0.36;
    const [main, dark] = ownerOf(v) === RED
        ? [CLR.red, CLR.redDark]
        : [CLR.black, CLR.blackDark];
    const grad = ctx.createRadialGradient(cx - 8, cy - 8, 4, cx, cy, rad);
    grad.addColorStop(0, main);
    grad.addColorStop(1, dark);
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    // Inner ring detail.
    ctx.beginPath();
    ctx.arc(cx, cy, rad * 0.62, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (isKing(v)) {
        ctx.fillStyle = CLR.crown;
        ctx.font = `${Math.round(SQUARE * 0.34)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('♚', cx, cy + 1);
    }
}

function render() {
    // Squares.
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            ctx.fillStyle = (r + c) % 2 === 0 ? CLR.light : CLR.dark;
            ctx.fillRect(c * SQUARE, r * SQUARE, SQUARE, SQUARE);
        }
    }

    // Selection + legal targets.
    if (selected && board) {
        const [sr, sc] = selected;
        ctx.fillStyle = CLR.select;
        ctx.fillRect(sc * SQUARE, sr * SQUARE, SQUARE, SQUARE);
        for (const m of getPieceMoves(sr, sc)) {
            const [tr, tc] = m.to;
            ctx.beginPath();
            ctx.arc(tc * SQUARE + SQUARE / 2, tr * SQUARE + SQUARE / 2, SQUARE * 0.16, 0, Math.PI * 2);
            ctx.fillStyle = CLR.target;
            ctx.fill();
        }
    }

    // Pieces.
    if (board) {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (board[r][c] !== 0) drawPiece(r, c, board[r][c]);
            }
        }
    }

    requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
    board = initialBoard();
    currentPlayer = RED;
    state = 'ready';
    winner = null;
    selected = null;
    updateHud();
    requestAnimationFrame(render);
}

init();
