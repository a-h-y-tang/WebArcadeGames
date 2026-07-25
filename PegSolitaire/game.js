// ---------------------------------------------------------------------------
// Peg Solitaire — the English (cross) board
// ---------------------------------------------------------------------------

const SIZE = 7;
const CELL = 60;                 // pixels per cell (7 * 60 = 420)
const INVALID = -1, EMPTY = 0, PEG = 1;
const START_PEGS = 32;

// Orthogonal jump directions (two cells away).
const JUMPS = [[-2, 0], [2, 0], [0, -2], [0, 2]];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const pegsEl = document.getElementById('pegs');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const statusEl = document.getElementById('status');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- Colors ---
const CLR = {
    board: '#3a2417',
    holeShadow: '#241409',
    hole: '#2c1a0e',
    pegHi: '#ffd9a8',
    peg: '#e08a3c',
    pegDark: '#a85e1f',
    selectRing: '#ffe08a',
    hint: 'rgba(255, 224, 138, 0.35)',
};

// --- State ---
let board;                 // board[r][c] in {INVALID, EMPTY, PEG}
let state;                 // 'idle' | 'playing' | 'over'
let score;                 // pegs removed
let best;                  // most pegs ever removed
let selected;              // { r, c } of the currently selected peg, or null

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------
function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

// A real hole is in the vertical bar (cols 2-4) or the horizontal bar (rows 2-4).
function isHole(r, c) {
    if (!inBounds(r, c)) return false;
    return (r >= 2 && r <= 4) || (c >= 2 && c <= 4);
}

function initBoard() {
    board = [];
    for (let r = 0; r < SIZE; r++) {
        const row = [];
        for (let c = 0; c < SIZE; c++) {
            row.push(isHole(r, c) ? PEG : INVALID);
        }
        board.push(row);
    }
    board[3][3] = EMPTY; // centre starts empty
    selected = null;
}

function pegsLeft() {
    let n = 0;
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (board[r][c] === PEG) n++;
    return n;
}

// Returns the jumped middle cell {r,c} if (fr,fc)->(tr,tc) is a legal jump, else null.
function jumpTarget(fr, fc, tr, tc) {
    if (!isHole(fr, fc) || !isHole(tr, tc)) return null;
    if (board[fr][fc] !== PEG || board[tr][tc] !== EMPTY) return null;
    const dr = tr - fr, dc = tc - fc;
    const isOrthoJump =
        (Math.abs(dr) === 2 && dc === 0) || (Math.abs(dc) === 2 && dr === 0);
    if (!isOrthoJump) return null;
    const mr = fr + dr / 2, mc = fc + dc / 2;
    if (board[mr][mc] !== PEG) return null;
    return { r: mr, c: mc };
}

function movesFrom(r, c) {
    const targets = [];
    if (board[r] === undefined || board[r][c] !== PEG) return targets;
    for (const [dr, dc] of JUMPS) {
        const tr = r + dr, tc = c + dc;
        if (jumpTarget(r, c, tr, tc)) targets.push({ r: tr, c: tc });
    }
    return targets;
}

function allMoves() {
    const moves = [];
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (board[r][c] === PEG)
                for (const t of movesFrom(r, c))
                    moves.push({ from: { r, c }, to: t });
    return moves;
}

function hasAnyMove() {
    return allMoves().length > 0;
}

function applyJump(fr, fc, tr, tc) {
    const mid = jumpTarget(fr, fc, tr, tc);
    if (!mid) return false;
    board[fr][fc] = EMPTY;
    board[mid.r][mid.c] = EMPTY;
    board[tr][tc] = PEG;
    score++;
    return true;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------
function handleClick(r, c) {
    if (state !== 'playing' || !isHole(r, c)) return;

    if (board[r][c] === PEG) {
        // Select a peg (only if it has at least one move, otherwise ignore).
        selected = movesFrom(r, c).length > 0 ? { r, c } : selected;
        draw();
        return;
    }

    // Empty hole: try to jump the selected peg here.
    if (board[r][c] === EMPTY && selected) {
        if (applyJump(selected.r, selected.c, r, c)) {
            selected = null;
            updateHud();
            draw();
            checkGameEnd();
        } else {
            selected = null;
            draw();
        }
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function startGame() {
    initBoard();
    score = 0;
    state = 'playing';
    updateHud();
    overlay.classList.remove('visible');
    draw();
}

function checkGameEnd() {
    if (!hasAnyMove()) endGame();
}

function endGame() {
    state = 'over';
    const left = pegsLeft();

    if (score > best) {
        best = score;
        localStorage.setItem('peg-solitaire-best', best);
    }
    bestEl.textContent = best;

    let title, sub;
    if (left === 1) {
        title = 'Solved!';
        sub = board[3][3] === PEG
            ? 'Perfect — the last peg is in the centre!'
            : 'One peg left. Click Play Again for a fresh board.';
    } else {
        title = 'Stuck!';
        sub = 'No moves left. Click Play Again to try again.';
    }

    overlayTitle.textContent = title;
    overlayScore.textContent = `${left} peg${left === 1 ? '' : 's'} left`;
    overlaySub.textContent = sub;
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    updateHud();
    draw();
}

function updateHud() {
    pegsEl.textContent = pegsLeft();
    scoreEl.textContent = score;
    bestEl.textContent = best;
    if (state === 'playing') {
        statusEl.textContent = selected
            ? 'Click a highlighted hole'
            : 'Click a peg to select it';
    } else if (state === 'over') {
        statusEl.textContent = 'Game over';
    } else {
        statusEl.textContent = 'Clear the board to a single peg';
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function cellCenter(r, c) {
    return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
}

function drawHole(r, c) {
    const { x, y } = cellCenter(r, c);
    ctx.fillStyle = CLR.holeShadow;
    ctx.beginPath();
    ctx.arc(x, y, CELL / 2 - 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CLR.hole;
    ctx.beginPath();
    ctx.arc(x, y, CELL / 2 - 15, 0, Math.PI * 2);
    ctx.fill();
}

function drawPeg(r, c, isSelected) {
    const { x, y } = cellCenter(r, c);
    const rad = CELL / 2 - 12;

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 3, rad, rad * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createRadialGradient(
        x - rad * 0.3, y - rad * 0.35, rad * 0.2, x, y, rad
    );
    grad.addColorStop(0, CLR.pegHi);
    grad.addColorStop(0.5, CLR.peg);
    grad.addColorStop(1, CLR.pegDark);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();

    if (isSelected) {
        ctx.strokeStyle = CLR.selectRing;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, rad + 3, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function draw() {
    ctx.fillStyle = CLR.board;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!board) return;

    // Holes first.
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (board[r][c] !== INVALID) drawHole(r, c);

    // Target hints for the selected peg.
    if (state === 'playing' && selected) {
        ctx.fillStyle = CLR.hint;
        for (const t of movesFrom(selected.r, selected.c)) {
            const { x, y } = cellCenter(t.r, t.c);
            ctx.beginPath();
            ctx.arc(x, y, 10, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Pegs on top.
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (board[r][c] === PEG) {
                const sel = selected && selected.r === r && selected.c === c;
                drawPeg(r, c, sel);
            }
}

// ---------------------------------------------------------------------------
// Input wiring
// ---------------------------------------------------------------------------
canvas.addEventListener('click', e => {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    if (inBounds(r, c)) handleClick(r, c);
});

document.addEventListener('keydown', e => {
    if (state === 'idle' || state === 'over') {
        startGame();
        e.preventDefault();
    }
});

btnStart.addEventListener('click', startGame);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
best = parseInt(localStorage.getItem('peg-solitaire-best') || '0', 10);
score = 0;
state = 'idle';
initBoard();
updateHud();
draw();
