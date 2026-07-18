// ---------------------------------------------------------------------------
// Gem Match — a Bejeweled-style match-three puzzle.
//
// All board logic is expressed as small pure functions over `grid`, with no
// dependence on animation or wall-clock timing, so tests can inject an exact
// board, call `trySwap` / `findMatches` / `collapseColumns` / `refill`, and
// assert on the result deterministically.
// ---------------------------------------------------------------------------

const SIZE = 8;             // 8×8 board
const CELL = 60;            // pixels per cell → 480×480 canvas
const WIDTH = SIZE * CELL;
const GEM_TYPES = 6;        // number of gem colours
const EMPTY = -1;           // sentinel for a momentarily-empty cell
const MAX_MOVES = 25;       // move budget for a game
const BASE_POINTS = 10;     // points per cleared gem, ×cascade depth

const GEM_COLORS = [
    '#f87171', // red
    '#fbbf24', // amber
    '#34d399', // green
    '#60a5fa', // blue
    '#a78bfa', // violet
    '#f472b6', // pink
];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const movesEl = document.getElementById('moves');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let grid;              // grid[r][c] = gem type 0..5, or EMPTY
let score, movesLeft, best, state;
let selected;          // {r,c} of the currently-selected gem, or null
let cursor;            // {r,c} keyboard cursor
let rngState;          // seed for the PRNG

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32). New gems draw from it; tests never depend
// on the values, only on structural outcomes.
// ---------------------------------------------------------------------------
function rng() {
    rngState |= 0;
    rngState = (rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randGem() {
    return Math.floor(rng() * GEM_TYPES);
}

// ---------------------------------------------------------------------------
// Pure board helpers
// ---------------------------------------------------------------------------
function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function isAdjacent(a, b) {
    const dr = Math.abs(a.r - b.r);
    const dc = Math.abs(a.c - b.c);
    return dr + dc === 1;
}

// Longest run of `type` that passes through (r,c), considered horizontally and
// vertically. Used for match-free generation/refill.
function runThrough(r, c, type) {
    let h = 1;
    for (let cc = c - 1; cc >= 0 && grid[r][cc] === type; cc--) h++;
    for (let cc = c + 1; cc < SIZE && grid[r][cc] === type; cc++) h++;
    let v = 1;
    for (let rr = r - 1; rr >= 0 && grid[rr][c] === type; rr--) v++;
    for (let rr = r + 1; rr < SIZE && grid[rr][c] === type; rr++) v++;
    return Math.max(h, v);
}

function createsMatch(r, c, type) {
    return runThrough(r, c, type) >= 3;
}

// Every gem that belongs to a horizontal or vertical run of 3+.
function findMatches() {
    const matched = new Set();

    // Horizontal runs
    for (let r = 0; r < SIZE; r++) {
        let runStart = 0;
        for (let c = 1; c <= SIZE; c++) {
            const same = c < SIZE && grid[r][c] !== EMPTY && grid[r][c] === grid[r][runStart];
            if (!same) {
                if (c - runStart >= 3) {
                    for (let k = runStart; k < c; k++) matched.add(r + ',' + k);
                }
                runStart = c;
            }
        }
    }
    // Vertical runs
    for (let c = 0; c < SIZE; c++) {
        let runStart = 0;
        for (let r = 1; r <= SIZE; r++) {
            const same = r < SIZE && grid[r][c] !== EMPTY && grid[r][c] === grid[runStart][c];
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

// Gravity: within each column slide non-empty gems to the bottom, leaving
// EMPTY cells at the top.
function collapseColumns() {
    for (let c = 0; c < SIZE; c++) {
        let write = SIZE - 1;
        for (let r = SIZE - 1; r >= 0; r--) {
            if (grid[r][c] !== EMPTY) {
                grid[write][c] = grid[r][c];
                if (write !== r) grid[r][c] = EMPTY;
                write--;
            }
        }
        for (let r = write; r >= 0; r--) grid[r][c] = EMPTY;
    }
}

// Fill every EMPTY cell with a new gem that does not form an immediate match.
function refill() {
    for (let c = 0; c < SIZE; c++) {
        for (let r = 0; r < SIZE; r++) {
            if (grid[r][c] !== EMPTY) continue;
            const start = randGem();
            let chosen = start;
            for (let i = 0; i < GEM_TYPES; i++) {
                const type = (start + i) % GEM_TYPES;
                if (!createsMatch(r, c, type)) { chosen = type; break; }
            }
            grid[r][c] = chosen;
        }
    }
}

// The cascade loop: clear all matches, collapse, refill, repeat until stable.
// Each successive cascade step is worth progressively more.
function resolveBoard() {
    let cascade = 0;
    while (true) {
        const matches = findMatches();
        if (matches.size === 0) break;
        cascade++;
        score += matches.size * BASE_POINTS * cascade;
        for (const key of matches) {
            const [r, c] = key.split(',').map(Number);
            grid[r][c] = EMPTY;
        }
        collapseColumns();
        refill();
    }
    updateHud();
}

// Is any legal (match-making) swap available anywhere on the board?
function hasAvailableMove() {
    const trySwapCells = (r1, c1, r2, c2) => {
        const t = grid[r1][c1]; grid[r1][c1] = grid[r2][c2]; grid[r2][c2] = t;
        const made = findMatches().size > 0;
        const u = grid[r1][c1]; grid[r1][c1] = grid[r2][c2]; grid[r2][c2] = u;
        return made;
    };
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (c + 1 < SIZE && trySwapCells(r, c, r, c + 1)) return true;
            if (r + 1 < SIZE && trySwapCells(r, c, r + 1, c)) return true;
        }
    }
    return false;
}

// Build a fresh board: no pre-made matches and at least one legal move.
function newBoard() {
    do {
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) grid[r][c] = EMPTY;
        }
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const start = randGem();
                for (let i = 0; i < GEM_TYPES; i++) {
                    const type = (start + i) % GEM_TYPES;
                    if (!createsMatch(r, c, type)) { grid[r][c] = type; break; }
                }
                if (grid[r][c] === EMPTY) grid[r][c] = randGem();
            }
        }
    } while (!hasAvailableMove());
}

// ---------------------------------------------------------------------------
// A move
// ---------------------------------------------------------------------------
function swapCells(a, b) {
    const t = grid[a.r][a.c];
    grid[a.r][a.c] = grid[b.r][b.c];
    grid[b.r][b.c] = t;
}

// The single entry point for a player move. Returns true if the swap was kept
// (i.e. it made a match and gems cleared), false otherwise.
function trySwap(a, b) {
    if (state !== 'running') return false;
    if (!inBounds(a.r, a.c) || !inBounds(b.r, b.c)) return false;
    if (!isAdjacent(a, b)) return false;

    swapCells(a, b);
    if (findMatches().size === 0) {
        swapCells(a, b); // no match → revert, no move spent
        return false;
    }

    movesLeft--;
    resolveBoard();

    // Never leave the player stuck.
    if (movesLeft > 0 && !hasAvailableMove()) newBoard();

    updateHud();
    if (movesLeft <= 0) endGame();
    return true;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function startGame() {
    rngState = (Date.now() & 0x7fffffff) || 1;
    score = 0;
    movesLeft = MAX_MOVES;
    selected = null;
    cursor = { r: 0, c: 0 };
    newBoard();

    updateHud();
    overlay.classList.remove('visible');
    state = 'running';
    render();
}

function endGame() {
    state = 'over';
    selected = null;
    if (score > best) {
        best = score;
        localStorage.setItem('gemmatch-best', String(best));
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = String(score);
    overlaySub.textContent = score >= best
        ? 'A new best! Press the button to play again'
        : `Best: ${best} · press the button to play again`;
    btnStart.textContent = 'Play Again';
    updateHud();
    overlay.classList.add('visible');
    render();
}

function updateHud() {
    scoreEl.textContent = String(score);
    movesEl.textContent = String(Math.max(0, movesLeft));
    bestEl.textContent = String(best);
}

// ---------------------------------------------------------------------------
// Rendering — a pure function of `grid` + selection.
// ---------------------------------------------------------------------------
function drawGem(r, c, type) {
    const x = c * CELL, y = r * CELL;
    const pad = 7;
    const rad = 10;
    const x0 = x + pad, y0 = y + pad, w = CELL - 2 * pad;
    ctx.fillStyle = GEM_COLORS[type % GEM_COLORS.length];
    ctx.beginPath();
    ctx.moveTo(x0 + rad, y0);
    ctx.arcTo(x0 + w, y0, x0 + w, y0 + w, rad);
    ctx.arcTo(x0 + w, y0 + w, x0, y0 + w, rad);
    ctx.arcTo(x0, y0 + w, x0, y0, rad);
    ctx.arcTo(x0, y0, x0 + w, y0, rad);
    ctx.closePath();
    ctx.fill();
    // Glossy highlight
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.arc(x0 + w * 0.34, y0 + w * 0.32, w * 0.16, 0, Math.PI * 2);
    ctx.fill();
}

function render() {
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, WIDTH, WIDTH);

    // Board grid lines
    ctx.strokeStyle = '#161b22';
    ctx.lineWidth = 1;
    for (let i = 1; i < SIZE; i++) {
        ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, WIDTH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(WIDTH, i * CELL); ctx.stroke();
    }

    if (!grid) return;
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (grid[r][c] !== EMPTY) drawGem(r, c, grid[r][c]);
        }
    }

    // Selection ring
    if (selected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.strokeRect(selected.c * CELL + 3, selected.r * CELL + 3, CELL - 6, CELL - 6);
    }

    // Keyboard cursor
    if (state === 'running' && cursor) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(cursor.c * CELL + 2, cursor.r * CELL + 2, CELL - 4, CELL - 4);
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function pickCell(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const c = Math.floor((clientX - rect.left) / CELL);
    const r = Math.floor((clientY - rect.top) / CELL);
    if (!inBounds(r, c)) return null;
    return { r, c };
}

// Act on a chosen cell — the shared logic for a mouse click or a keyboard
// select. First choice selects; a neighbour swaps; the same cell deselects.
function chooseCell(cell) {
    if (state !== 'running') return;
    if (!selected) {
        selected = cell;
    } else if (selected.r === cell.r && selected.c === cell.c) {
        selected = null;
    } else if (isAdjacent(selected, cell)) {
        trySwap(selected, cell);
        selected = null;
    } else {
        selected = cell; // re-select a distant gem
    }
    render();
}

canvas.addEventListener('click', e => {
    const cell = pickCell(e.clientX, e.clientY);
    if (cell) chooseCell(cell);
});

document.addEventListener('keydown', e => {
    if (state !== 'running') return;
    switch (e.key) {
        case 'ArrowUp':    cursor.r = Math.max(0, cursor.r - 1); e.preventDefault(); break;
        case 'ArrowDown':  cursor.r = Math.min(SIZE - 1, cursor.r + 1); e.preventDefault(); break;
        case 'ArrowLeft':  cursor.c = Math.max(0, cursor.c - 1); e.preventDefault(); break;
        case 'ArrowRight': cursor.c = Math.min(SIZE - 1, cursor.c + 1); e.preventDefault(); break;
        case ' ':
        case 'Enter':
            chooseCell({ r: cursor.r, c: cursor.c });
            e.preventDefault();
            return;
        default:
            return;
    }
    render();
});

btnStart.addEventListener('click', startGame);

// ---------------------------------------------------------------------------
// Init — a still board behind the start overlay.
// ---------------------------------------------------------------------------
best = parseInt(localStorage.getItem('gemmatch-best') || '0', 10);
score = 0;
movesLeft = MAX_MOVES;
selected = null;
cursor = { r: 0, c: 0 };
state = 'idle';
grid = Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY));
rngState = 0x9e3779b9;
newBoard();
updateHud();
render();
