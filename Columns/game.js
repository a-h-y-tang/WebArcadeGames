// --- Board & cell dimensions ---
const COLS = 6;
const ROWS = 14;
const CELL = 40;

// The falling group always enters at the top of this column.
const SPAWN_COL = Math.floor((COLS - 1) / 2);

// Jewel palette. NUM_COLORS is the number of distinct colours a jewel can be.
const COLORS = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];
const NUM_COLORS = COLORS.length;

// Difficulty: clearing this many jewels raises the level by one, and each level
// shortens the gravity interval (down to a floor).
const JEWELS_PER_LEVEL = 30;
const BASE_INTERVAL = 800;   // ms per gravity step at level 1
const LEVEL_STEP = 70;       // ms shaved off per level
const MIN_INTERVAL = 120;    // fastest the group can fall

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let board, piece, score, level, cleared, best, state;
let dropInterval, dropTimer;
let lastTime, animId;

// -----------------------------------------------------------------------
// Seeded RNG (mulberry32) — keeps colour generation self-contained and
// reseedable, matching the other games in this repo.
// -----------------------------------------------------------------------
let rngState = 0x9e3779b9;
function seedRng(s) {
    rngState = s >>> 0;
}
function rand() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randColor() {
    return Math.floor(rand() * NUM_COLORS);
}

// -----------------------------------------------------------------------
// Board helpers
// -----------------------------------------------------------------------
function makeBoard() {
    const b = [];
    for (let r = 0; r < ROWS; r++) {
        b.push(new Array(COLS).fill(null));
    }
    return b;
}

function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

// The group occupies cells (row, col), (row+1, col), (row+2, col). It can fall
// when the cell just below the bottom jewel is on the board and empty.
function canFall() {
    if (!piece) return false;
    const below = piece.row + 3;
    return below <= ROWS - 1 && board[below][piece.col] === null;
}

// -----------------------------------------------------------------------
// Group actions
// -----------------------------------------------------------------------
function spawnPiece() {
    const col = SPAWN_COL;
    // If the entrance cells are occupied, the group cannot enter — game over.
    if (board[0][col] !== null || board[1][col] !== null || board[2][col] !== null) {
        piece = null;
        endGame();
        return false;
    }
    piece = { col, row: 0, cells: [randColor(), randColor(), randColor()] };
    return true;
}

function movePiece(dir) {
    if (!piece) return false;
    const nc = piece.col + dir;
    if (nc < 0 || nc >= COLS) return false;
    if (board[piece.row][nc] !== null ||
        board[piece.row + 1][nc] !== null ||
        board[piece.row + 2][nc] !== null) {
        return false;
    }
    piece.col = nc;
    return true;
}

function cyclePiece() {
    if (!piece) return;
    const [a, b, c] = piece.cells;
    piece.cells = [c, a, b]; // bottom jewel wraps to the top
}

function softDrop() {
    if (!piece || !canFall()) return false;
    piece.row += 1;
    return true;
}

function lockPiece() {
    board[piece.row][piece.col] = piece.cells[0];
    board[piece.row + 1][piece.col] = piece.cells[1];
    board[piece.row + 2][piece.col] = piece.cells[2];
    piece = null;
}

// -----------------------------------------------------------------------
// Matching, clearing, collapsing
// -----------------------------------------------------------------------
const MATCH_DIRS = [
    [0, 1],   // horizontal
    [1, 0],   // vertical
    [1, 1],   // diagonal ↘
    [1, -1],  // diagonal ↙
];

// Return every cell that belongs to a run of three or more same-colour jewels
// in any of the four directions, de-duplicated.
function findMatches() {
    const marked = new Set();
    for (const [dr, dc] of MATCH_DIRS) {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const color = board[r][c];
                if (color === null) continue;
                // Only start counting at the beginning of a run.
                const pr = r - dr, pc = c - dc;
                if (inBounds(pr, pc) && board[pr][pc] === color) continue;
                // Measure the run forward.
                let len = 0, rr = r, cc = c;
                while (inBounds(rr, cc) && board[rr][cc] === color) {
                    len++; rr += dr; cc += dc;
                }
                if (len >= 3) {
                    rr = r; cc = c;
                    for (let k = 0; k < len; k++) {
                        marked.add(rr + ',' + cc);
                        rr += dr; cc += dc;
                    }
                }
            }
        }
    }
    return [...marked].map(s => {
        const [r, c] = s.split(',').map(Number);
        return { r, c };
    });
}

// Settle every column: surviving jewels fall to the bottom, gaps close.
function collapse() {
    for (let c = 0; c < COLS; c++) {
        const stack = [];
        for (let r = ROWS - 1; r >= 0; r--) {
            if (board[r][c] !== null) stack.push(board[r][c]);
        }
        for (let r = ROWS - 1; r >= 0; r--) {
            const idx = ROWS - 1 - r;
            board[r][c] = idx < stack.length ? stack[idx] : null;
        }
    }
}

// Clear matches, score them, collapse, and repeat — each repeat is one cascade
// link, worth progressively more. Returns the total jewels cleared.
function resolveBoard() {
    let chain = 0;
    let total = 0;
    while (true) {
        const matches = findMatches();
        if (matches.length === 0) break;
        chain += 1;
        for (const { r, c } of matches) board[r][c] = null;
        score += matches.length * 10 * chain;
        cleared += matches.length;
        total += matches.length;
        collapse();
    }
    if (total > 0) {
        updateLevel();
        scoreEl.textContent = score;
    }
    return total;
}

// -----------------------------------------------------------------------
// Levels
// -----------------------------------------------------------------------
function dropIntervalFor(lvl) {
    return Math.max(MIN_INTERVAL, BASE_INTERVAL - (lvl - 1) * LEVEL_STEP);
}

function updateLevel() {
    level = 1 + Math.floor(cleared / JEWELS_PER_LEVEL);
    levelEl.textContent = level;
    dropInterval = dropIntervalFor(level);
}

// -----------------------------------------------------------------------
// Gravity — one discrete step
// -----------------------------------------------------------------------
function gravityDrop() {
    if (state !== 'running') return;
    if (!piece) {
        spawnPiece();
        return;
    }
    if (canFall()) {
        piece.row += 1;
    } else {
        lockPiece();
        resolveBoard();
        spawnPiece();
    }
}

// -----------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------
function resetWorld() {
    board = makeBoard();
    piece = null;
    score = 0;
    level = 1;
    cleared = 0;
    dropInterval = dropIntervalFor(level);
    dropTimer = 0;

    scoreEl.textContent = score;
    levelEl.textContent = level;
}

function startGame() {
    seedRng((0x9e3779b9 ^ (performance.now() * 1000)) >>> 0);
    resetWorld();
    state = 'running';
    overlay.classList.remove('visible');
    spawnPiece();

    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('columns-best', best);
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} pts`;
    overlaySub.textContent = 'Press Space to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function pauseGame() {
    state = 'paused';
    overlayTitle.textContent = 'Paused';
    overlayScore.textContent = '';
    overlaySub.textContent = 'Press P to resume';
    btnStart.textContent = 'Resume';
    overlay.classList.add('visible');
}

function resumeGame() {
    state = 'running';
    overlay.classList.remove('visible');
    lastTime = null;
    animId = requestAnimationFrame(loop);
}

// -----------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------
function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = Math.min(100, timestamp - lastTime); // clamp big frame gaps
    lastTime = timestamp;

    if (state === 'running') {
        dropTimer += elapsed;
        while (dropTimer >= dropInterval) {
            dropTimer -= dropInterval;
            gravityDrop();
        }
    }

    draw();

    if (state === 'running') {
        animId = requestAnimationFrame(loop);
    }
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function draw() {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

    // Faint grid.
    ctx.strokeStyle = '#161b22';
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(c * CELL, 0);
        ctx.lineTo(c * CELL, ROWS * CELL);
        ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * CELL);
        ctx.lineTo(COLS * CELL, r * CELL);
        ctx.stroke();
    }

    // Settled jewels.
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (board[r][c] !== null) drawJewel(c, r, board[r][c]);
        }
    }

    // The falling group.
    if (piece) {
        for (let i = 0; i < 3; i++) {
            drawJewel(piece.col, piece.row + i, piece.cells[i]);
        }
    }
}

function drawJewel(c, r, color) {
    const x = c * CELL;
    const y = r * CELL;
    const pad = 3;

    ctx.fillStyle = COLORS[color];
    roundRect(ctx, x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 7);

    // Glossy highlight.
    ctx.fillStyle = '#ffffff55';
    roundRect(ctx, x + pad + 4, y + pad + 4, CELL - pad * 2 - 18, 7, 4);

    // Rim.
    ctx.strokeStyle = '#00000044';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 7);
    ctx.stroke();
}

function roundRect(cx, x, y, w, h, r) {
    cx.beginPath();
    cx.roundRect(x, y, w, h, r);
    cx.fill();
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
const START_KEYS = [' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'A', 'd', 'D', 'w', 'W', 's', 'S'];

document.addEventListener('keydown', e => {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    if (state !== 'running' && state !== 'paused' && START_KEYS.includes(k)) {
        startGame();
        e.preventDefault();
        return;
    }

    if (state !== 'running') return;

    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
        movePiece(-1); e.preventDefault();
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
        movePiece(1); e.preventDefault();
    } else if (k === 'ArrowUp' || k === 'w' || k === 'W') {
        cyclePiece(); e.preventDefault();
    } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
        softDrop(); e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
best = parseInt(localStorage.getItem('columns-best') || '0', 10);
bestEl.textContent = best;
state = 'idle';
resetWorld();
draw();
