// --- Board dimensions ---
const GRID = 8;               // 8×8 board
const CELL = 60;              // pixels per cell
const WIDTH = GRID * CELL;    // 480
const HEIGHT = GRID * CELL;   // 480
const NUM_TYPES = 6;          // gem colours
const MAX_MOVES = 20;         // move-limited high-score chase

// Gem palette (index = gem type).
const GEM_COLORS = ['#f85149', '#f0883e', '#f2cc60', '#3fb950', '#58a6ff', '#bc8cff'];
const GEM_GLYPHS = ['#ff9d97', '#ffb689', '#ffe08a', '#7ee787', '#a5d6ff', '#d2a8ff'];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const movesEl = document.getElementById('moves');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let board;                    // board[r][c] = gem type 0..NUM_TYPES-1, or -1 empty
let score, best, movesLeft, state, selected;
let autoRefill = true;        // drop in fresh gems when resolving (test hook: off)

// -----------------------------------------------------------------------
// Seeded PRNG (mulberry32) — reproducible gem generation for tests.
// -----------------------------------------------------------------------
let rngState = 0;
function setSeed(n) {
    rngState = n >>> 0;
}
function rng() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randInt(n) {
    return Math.floor(rng() * n);
}

// -----------------------------------------------------------------------
// Board construction
// -----------------------------------------------------------------------
// Fill the grid so that no run of three already exists and at least one legal
// move is available. Depth of retries is tiny in practice.
function newBoard() {
    board = [];
    for (let r = 0; r < GRID; r++) {
        const row = [];
        for (let c = 0; c < GRID; c++) {
            let t;
            do {
                t = randInt(NUM_TYPES);
            } while (
                (c >= 2 && row[c - 1] === t && row[c - 2] === t) ||
                (r >= 2 && board[r - 1][c] === t && board[r - 2][c] === t)
            );
            row.push(t);
        }
        board.push(row);
    }
    if (!hasPossibleMove()) newBoard();
}

// Test hook: load an exact board from an array of GRID strings. Digits are gem
// types; '.' is an empty cell.
function loadBoard(rows) {
    board = rows.map((s) => s.split('').map((ch) => (ch === '.' ? -1 : parseInt(ch, 10))));
    draw();
}

// -----------------------------------------------------------------------
// Match logic
// -----------------------------------------------------------------------
function inBounds(r, c) {
    return r >= 0 && r < GRID && c >= 0 && c < GRID;
}

// Return an array of {r,c} for every cell that is part of a horizontal or
// vertical run of three or more equal, non-empty gems.
function findMatches() {
    const hit = new Set();

    // Horizontal runs
    for (let r = 0; r < GRID; r++) {
        let run = 1;
        for (let c = 1; c <= GRID; c++) {
            const same = c < GRID && board[r][c] >= 0 && board[r][c] === board[r][c - 1];
            if (same) {
                run++;
            } else {
                if (run >= 3) for (let k = c - run; k < c; k++) hit.add(r * GRID + k);
                run = 1;
            }
        }
    }

    // Vertical runs
    for (let c = 0; c < GRID; c++) {
        let run = 1;
        for (let r = 1; r <= GRID; r++) {
            const same = r < GRID && board[r][c] >= 0 && board[r][c] === board[r - 1][c];
            if (same) {
                run++;
            } else {
                if (run >= 3) for (let k = r - run; k < r; k++) hit.add(k * GRID + c);
                run = 1;
            }
        }
    }

    return [...hit].map((v) => ({ r: Math.floor(v / GRID), c: v % GRID }));
}

function clearMatches(matches) {
    for (const { r, c } of matches) board[r][c] = -1;
    return matches.length;
}

// Collapse each column so gems rest at the bottom, empties bubble to the top.
function applyGravity() {
    for (let c = 0; c < GRID; c++) {
        const gems = [];
        for (let r = GRID - 1; r >= 0; r--) {
            if (board[r][c] >= 0) gems.push(board[r][c]);
        }
        for (let r = GRID - 1; r >= 0; r--) {
            board[r][c] = gems.length ? gems.shift() : -1;
        }
    }
}

function refill() {
    for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
            if (board[r][c] < 0) board[r][c] = randInt(NUM_TYPES);
        }
    }
}

// Clear all matches, letting cascades chain. Each cascade step scores
// (cleared gems × 10 × step). Returns the total points gained.
function resolveBoard() {
    let gained = 0;
    let step = 1;
    while (true) {
        const matches = findMatches();
        if (matches.length === 0) break;
        gained += matches.length * 10 * step;
        clearMatches(matches);
        applyGravity();
        if (autoRefill) refill();
        step++;
    }
    score += gained;
    if (autoRefill && !hasPossibleMove()) reshuffle();
    updateHud();
    draw();
    return gained;
}

// -----------------------------------------------------------------------
// Moves & swapping
// -----------------------------------------------------------------------
function areAdjacent(a, b) {
    const dr = Math.abs(a.r - b.r);
    const dc = Math.abs(a.c - b.c);
    return dr + dc === 1;
}

function swapCells(a, b) {
    const tmp = board[a.r][a.c];
    board[a.r][a.c] = board[b.r][b.c];
    board[b.r][b.c] = tmp;
}

// The player's move: swap two adjacent gems only if it creates a match.
// Returns true when the swap was accepted (and a move spent).
function trySwap(a, b) {
    if (state !== 'running') return false;
    if (!inBounds(a.r, a.c) || !inBounds(b.r, b.c)) return false;
    if (!areAdjacent(a, b)) return false;

    swapCells(a, b);
    if (findMatches().length === 0) {
        swapCells(a, b); // revert — not a legal match
        return false;
    }

    resolveBoard();
    movesLeft--;
    updateHud();
    if (movesLeft <= 0) endGame();
    draw();
    return true;
}

// Is there any single adjacent swap that would create a match?
function hasPossibleMove() {
    for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
            if (c + 1 < GRID) {
                swapCells({ r, c }, { r, c: c + 1 });
                const ok = findMatches().length > 0;
                swapCells({ r, c }, { r, c: c + 1 });
                if (ok) return true;
            }
            if (r + 1 < GRID) {
                swapCells({ r, c }, { r: r + 1, c });
                const ok = findMatches().length > 0;
                swapCells({ r, c }, { r: r + 1, c });
                if (ok) return true;
            }
        }
    }
    return false;
}

// Shuffle gems until the board has a legal move and no free matches.
function reshuffle() {
    const flat = board.flat().filter((v) => v >= 0);
    do {
        for (let i = flat.length - 1; i > 0; i--) {
            const j = randInt(i + 1);
            [flat[i], flat[j]] = [flat[j], flat[i]];
        }
        let k = 0;
        for (let r = 0; r < GRID; r++) {
            for (let c = 0; c < GRID; c++) board[r][c] = flat[k++];
        }
    } while (findMatches().length > 0 || !hasPossibleMove());
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
function clickCell(r, c) {
    if (state !== 'running') return;
    if (!inBounds(r, c)) return;

    if (!selected) {
        selected = { r, c };
    } else if (selected.r === r && selected.c === c) {
        selected = null;
    } else if (areAdjacent(selected, { r, c })) {
        trySwap(selected, { r, c });
        selected = null;
    } else {
        selected = { r, c };
    }
    draw();
}

// -----------------------------------------------------------------------
// Game lifecycle
// -----------------------------------------------------------------------
function startGame() {
    setSeed((Date.now() ^ (score || 0)) >>> 0);
    score = 0;
    movesLeft = MAX_MOVES;
    selected = null;
    state = 'running';
    autoRefill = true;
    newBoard();
    updateHud();
    overlay.classList.remove('visible');
    draw();
}

function endGame() {
    state = 'over';
    selected = null;
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('match3-best', String(best));
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} pts`;
    overlaySub.textContent = 'Press Space to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    draw();
}

function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
    movesEl.textContent = Math.max(0, movesLeft);
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function draw() {
    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // subtle checkerboard cells
    for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
            ctx.fillStyle = (r + c) % 2 === 0 ? '#1b222c' : '#161b22';
            ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
        }
    }

    if (board) {
        for (let r = 0; r < GRID; r++) {
            for (let c = 0; c < GRID; c++) {
                const t = board[r][c];
                if (t < 0) continue;
                drawGem(r, c, t);
            }
        }
    }

    // selection highlight
    if (selected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.strokeRect(selected.c * CELL + 2, selected.r * CELL + 2, CELL - 4, CELL - 4);
    }
}

function drawGem(r, c, t) {
    const x = c * CELL;
    const y = r * CELL;
    const pad = 8;
    const grad = ctx.createLinearGradient(x + pad, y + pad, x + CELL - pad, y + CELL - pad);
    grad.addColorStop(0, GEM_GLYPHS[t]);
    grad.addColorStop(1, GEM_COLORS[t]);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 12);
    ctx.fill();

    // glossy corner highlight
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(x + CELL * 0.38, y + CELL * 0.34, CELL * 0.12, CELL * 0.08, -0.6, 0, Math.PI * 2);
    ctx.fill();
}

// -----------------------------------------------------------------------
// Wiring
// -----------------------------------------------------------------------
canvas.addEventListener('mousedown', (e) => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (WIDTH / rect.width);
    const y = (e.clientY - rect.top) * (HEIGHT / rect.height);
    clickCell(Math.floor(y / CELL), Math.floor(x / CELL));
});

document.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && state !== 'running') {
        startGame();
        e.preventDefault();
    }
});

btnStart.addEventListener('click', startGame);

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
best = parseInt(localStorage.getItem('match3-best') || '0', 10);
score = 0;
movesLeft = MAX_MOVES;
state = 'idle';
selected = null;
updateHud();
draw();
