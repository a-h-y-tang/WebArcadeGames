const ROWS = 8;
const COLS = 8;
const CELL = 60; // pixels per grid cell (canvas is 480x480)

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// Six gem colours, each with a distinct shape so the board is readable without
// relying on colour alone.
const COLORS = [
    { fill: '#ef4444', glow: '#ef444466', shape: 'circle' },   // red
    { fill: '#f59e0b', glow: '#f59e0b66', shape: 'diamond' },  // amber
    { fill: '#eab308', glow: '#eab30866', shape: 'square' },   // yellow
    { fill: '#22c55e', glow: '#22c55e66', shape: 'triangle' }, // green
    { fill: '#3b82f6', glow: '#3b82f666', shape: 'hexagon' },  // blue
    { fill: '#a855f7', glow: '#a855f766', shape: 'star' },     // purple
];

// --- State ---
let board;        // board[row][col] = colour index, or null mid-resolve
let selected;     // { r, c } of the currently highlighted gem, or null
let score;
let best;
let state;        // 'idle' | 'running' | 'over'

// -----------------------------------------------------------------------
// Board generation
// -----------------------------------------------------------------------
function randColor() {
    return Math.floor(Math.random() * COLORS.length);
}

// Build a fresh board with no pre-existing matches. Retry until the board also
// has at least one valid move (a deadlocked start would be unfair).
function newBoard() {
    let b;
    do {
        b = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                let v, tries = 0;
                do {
                    v = randColor();
                    tries++;
                } while (
                    tries < 50 && (
                        (c >= 2 && b[r][c - 1] === v && b[r][c - 2] === v) ||
                        (r >= 2 && b[r - 1][c] === v && b[r - 2][c] === v)
                    )
                );
                b[r][c] = v;
            }
        }
    } while (findMatches(b).size > 0 || !hasValidMove(b));
    return b;
}

// -----------------------------------------------------------------------
// Core match-3 logic — all operate on the board array they are handed, using
// its own dimensions, so tests can inject small boards deterministically.
// -----------------------------------------------------------------------
function findMatches(b) {
    const R = b.length, C = b[0].length;
    const matched = new Set();

    // Horizontal runs
    for (let r = 0; r < R; r++) {
        let runStart = 0;
        for (let c = 1; c <= C; c++) {
            const same = c < C && b[r][c] != null && b[r][c] === b[r][runStart];
            if (!same) {
                if (c - runStart >= 3) {
                    for (let k = runStart; k < c; k++) matched.add(r + ',' + k);
                }
                runStart = c;
            }
        }
    }

    // Vertical runs
    for (let c = 0; c < C; c++) {
        let runStart = 0;
        for (let r = 1; r <= R; r++) {
            const same = r < R && b[r][c] != null && b[r][c] === b[runStart][c];
            if (!same) {
                if (r - runStart >= 3) {
                    for (let k = runStart; k < r; k++) matched.add(k + ',' + c);
                }
                runStart = r;
            }
        }
    }

    return matched;
}

function applyGravity(b) {
    const R = b.length, C = b[0].length;
    for (let c = 0; c < C; c++) {
        const stack = [];
        for (let r = R - 1; r >= 0; r--) {
            if (b[r][c] != null) stack.push(b[r][c]); // bottom-most first
        }
        for (let r = R - 1; r >= 0; r--) {
            b[r][c] = stack.length ? stack.shift() : null;
        }
    }
}

function refill(b) {
    const R = b.length, C = b[0].length;
    for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
            if (b[r][c] == null) b[r][c] = randColor();
        }
    }
}

// Resolve the global board: repeatedly clear matches, drop, and refill.
// Each chained clear scores progressively more (cascade multiplier).
function resolveBoard() {
    let combo = 1;
    let gained = 0;
    while (true) {
        const matches = findMatches(board);
        if (matches.size === 0) break;
        gained += matches.size * 10 * combo;
        for (const key of matches) {
            const [r, c] = key.split(',').map(Number);
            board[r][c] = null;
        }
        applyGravity(board);
        refill(board);
        combo++;
    }
    if (gained > 0) {
        score += gained;
        scoreEl.textContent = score;
    }
    return gained;
}

function areAdjacent(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

// Swap two adjacent cells on the global board. If it produces a match the swap
// sticks and the board resolves; otherwise it is reverted. Returns whether the
// swap stuck.
function trySwap(a, b) {
    if (!areAdjacent(a, b)) return false;
    const tmp = board[a.r][a.c];
    board[a.r][a.c] = board[b.r][b.c];
    board[b.r][b.c] = tmp;

    if (findMatches(board).size > 0) {
        resolveBoard();
        return true;
    }

    // Revert
    board[b.r][b.c] = board[a.r][a.c];
    board[a.r][a.c] = tmp;
    return false;
}

// True if any single adjacent swap anywhere could create a match.
function hasValidMove(b) {
    const R = b.length, C = b[0].length;
    const test = (r1, c1, r2, c2) => {
        const clone = b.map(row => row.slice());
        const t = clone[r1][c1];
        clone[r1][c1] = clone[r2][c2];
        clone[r2][c2] = t;
        return findMatches(clone).size > 0;
    };
    for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
            if (c < C - 1 && test(r, c, r, c + 1)) return true;
            if (r < R - 1 && test(r, c, r + 1, c)) return true;
        }
    }
    return false;
}

// -----------------------------------------------------------------------
// Game flow
// -----------------------------------------------------------------------
function startGame() {
    board = newBoard();
    selected = null;
    score = 0;
    state = 'running';
    scoreEl.textContent = score;
    overlay.classList.remove('visible');
    draw();
}

function checkGameOver() {
    if (!hasValidMove(board)) {
        endGame();
    }
}

function endGame() {
    state = 'over';
    selected = null;
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('gemcrush-best', best);
    }
    overlayTitle.textContent = 'No Moves Left!';
    overlayScore.textContent = `${score} pts`;
    overlaySub.textContent = 'The board is deadlocked';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    draw();
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
function handleCellClick(r, c) {
    if (state !== 'running') return;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;

    if (selected === null) {
        selected = { r, c };
        draw();
        return;
    }

    if (selected.r === r && selected.c === c) {
        selected = null; // clicking the selected gem deselects
        draw();
        return;
    }

    if (areAdjacent(selected, { r, c })) {
        const a = selected;
        selected = null;
        trySwap(a, { r, c });
        checkGameOver();
        draw();
        return;
    }

    // Non-adjacent: move the selection instead
    selected = { r, c };
    draw();
}

canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    handleCellClick(r, c);
});

document.addEventListener('keydown', () => {
    if (state !== 'running') startGame();
});

btnStart.addEventListener('click', startGame);

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function draw() {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Board cells
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = c * CELL;
            const y = r * CELL;

            // Cell backing
            ctx.fillStyle = (r + c) % 2 === 0 ? '#161b22' : '#12161d';
            ctx.fillRect(x, y, CELL, CELL);

            const v = board[r][c];
            if (v == null) continue;
            drawGem(v, x, y);
        }
    }

    // Selection highlight
    if (selected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.strokeRect(selected.c * CELL + 2, selected.r * CELL + 2, CELL - 4, CELL - 4);
    }
}

function drawGem(v, x, y) {
    const color = COLORS[v];
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const rad = CELL / 2 - 9;

    ctx.save();
    ctx.shadowColor = color.glow;
    ctx.shadowBlur = 8;
    ctx.fillStyle = color.fill;
    ctx.beginPath();

    switch (color.shape) {
        case 'circle':
            ctx.arc(cx, cy, rad, 0, Math.PI * 2);
            break;
        case 'square':
            ctx.rect(cx - rad, cy - rad, rad * 2, rad * 2);
            break;
        case 'diamond':
            ctx.moveTo(cx, cy - rad);
            ctx.lineTo(cx + rad, cy);
            ctx.lineTo(cx, cy + rad);
            ctx.lineTo(cx - rad, cy);
            ctx.closePath();
            break;
        case 'triangle':
            ctx.moveTo(cx, cy - rad);
            ctx.lineTo(cx + rad, cy + rad);
            ctx.lineTo(cx - rad, cy + rad);
            ctx.closePath();
            break;
        case 'hexagon':
            for (let i = 0; i < 6; i++) {
                const ang = Math.PI / 180 * (60 * i - 30);
                const px = cx + rad * Math.cos(ang);
                const py = cy + rad * Math.sin(ang);
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.closePath();
            break;
        case 'star':
            for (let i = 0; i < 10; i++) {
                const rr = i % 2 === 0 ? rad : rad / 2.2;
                const ang = Math.PI / 180 * (36 * i - 90);
                const px = cx + rr * Math.cos(ang);
                const py = cy + rr * Math.sin(ang);
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.closePath();
            break;
    }

    ctx.fill();
    // Subtle highlight for a glassy look
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(cx - rad / 3, cy - rad / 3, rad / 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// -----------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------
best = parseInt(localStorage.getItem('gemcrush-best') || '0', 10);
bestEl.textContent = best;
state = 'idle';
selected = null;
board = newBoard();
draw();
