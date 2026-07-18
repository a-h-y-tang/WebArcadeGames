// ---------------------------------------------------------------------------
// Tetris — classic falling-block puzzle on an HTML5 canvas.
// A single classic (non-module) script so the game state is reachable from the
// Playwright tests as globals, mirroring the Snake game in this repo.
// ---------------------------------------------------------------------------

const COLS = 10;
const ROWS = 20;
const CELL = 25; // pixels per grid cell

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nctx = nextCanvas.getContext('2d');

const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// Tetromino shapes as square 0/1 matrices (spawn orientation).
const SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};

const TYPES = Object.keys(SHAPES);

// Per-piece colors.
const CLR = {
    I: '#22d3ee', O: '#facc15', T: '#c084fc', S: '#4ade80',
    Z: '#f87171', J: '#60a5fa', L: '#fb923c',
    bg: '#0a0e14', grid: '#161b22', ghost: '#ffffff14',
};

// Points awarded for clearing 1..4 rows, before the level multiplier.
const LINE_POINTS = [0, 100, 300, 500, 800];

const START_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ']);

// --- State ---
let board, current, nextType, score, lines, level, best, state, lastTime, animId;

// ---------------------------------------------------------------------------
// Board & piece helpers
// ---------------------------------------------------------------------------

function emptyBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function randomType() {
    return TYPES[Math.floor(Math.random() * TYPES.length)];
}

// Rotate a square matrix 90° clockwise.
function rotateMatrix(m) {
    const n = m.length;
    const out = Array.from({ length: n }, () => Array(n).fill(0));
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            out[x][n - 1 - y] = m[y][x];
        }
    }
    return out;
}

// Absolute filled cells of a piece on the board.
function cellsOf(piece) {
    const cells = [];
    const m = piece.matrix;
    for (let y = 0; y < m.length; y++) {
        for (let x = 0; x < m[y].length; x++) {
            if (m[y][x]) cells.push({ x: piece.x + x, y: piece.y + y });
        }
    }
    return cells;
}

// A piece collides if any cell leaves the well or overlaps a locked cell.
// Cells above the ceiling (y < 0) are allowed so pieces can spawn/rotate there.
function collides(piece) {
    for (const c of cellsOf(piece)) {
        if (c.x < 0 || c.x >= COLS || c.y >= ROWS) return true;
        if (c.y >= 0 && board[c.y][c.x]) return true;
    }
    return false;
}

function newPiece(type) {
    const matrix = SHAPES[type].map(row => row.slice());
    const x = Math.floor((COLS - matrix[0].length) / 2);
    return { type, matrix, x, y: 0 };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function move(dx, dy) {
    const moved = { ...current, x: current.x + dx, y: current.y + dy };
    if (collides(moved)) return false;
    current = moved;
    return true;
}

function rotateCurrent() {
    const rotated = { ...current, matrix: rotateMatrix(current.matrix) };
    for (const kick of [0, -1, 1, -2, 2]) {
        const test = { ...rotated, x: rotated.x + kick };
        if (!collides(test)) {
            current = test;
            draw();
            return true;
        }
    }
    return false;
}

function hardDrop() {
    let dropped = 0;
    while (move(0, 1)) dropped++;
    if (dropped) { score += dropped * 2; updateHud(); }
    lock();
}

// Write the current piece into the board, clear lines, and spawn the next one.
function lock() {
    for (const c of cellsOf(current)) {
        if (c.y < 0) { endGame(); return; } // locked above the ceiling
        board[c.y][c.x] = current.type;
    }
    clearLines();
    spawn();
}

// Remove every completed row; returns the number cleared and updates scoring.
function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
        if (board[y].every(Boolean)) {
            board.splice(y, 1);
            board.unshift(Array(COLS).fill(0));
            cleared++;
            y++; // re-check the row that dropped into this index
        }
    }
    if (cleared > 0) {
        lines += cleared;
        level = Math.floor(lines / 10) + 1;
        score += LINE_POINTS[cleared] * level;
        updateHud();
    }
    return cleared;
}

// Bring the next piece into play (or a specific type, for tests).
function spawn(type) {
    const t = type || nextType;
    if (!type) nextType = randomType();
    current = newPiece(t);
    if (collides(current)) { endGame(); return; }
    drawNext();
}

function dropInterval() {
    return Math.max(100, 800 - (level - 1) * 70);
}

// Gravity step: fall one row, or lock if blocked.
function tick() {
    if (!move(0, 1)) lock();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    board = emptyBoard();
    score = 0;
    lines = 0;
    level = 1;
    nextType = randomType();
    state = 'running';
    lastTime = null;
    updateHud();
    overlay.classList.remove('visible');
    spawn();
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function resumeGame() {
    state = 'running';
    lastTime = null;
    overlay.classList.remove('visible');
    animId = requestAnimationFrame(loop);
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        resumeGame();
    }
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        localStorage.setItem('tetris-best', best);
    }
    bestEl.textContent = best;
    showOverlay('Game Over', `${score} pts`, 'Press any arrow key or Space to play again', 'Play Again');
}

function showOverlay(title, scoreText, sub, btn) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = btn;
    overlay.classList.add('visible');
}

function updateHud() {
    scoreEl.textContent = score;
    linesEl.textContent = lines;
    levelEl.textContent = level;
    bestEl.textContent = best;
}

// Timestamp-driven loop (matches the Snake game; no setInterval).
function loop(timestamp) {
    if (state !== 'running') return;
    if (!lastTime) lastTime = timestamp;
    if (timestamp - lastTime >= dropInterval()) {
        lastTime = timestamp;
        tick();
    }
    draw();
    animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawCell(context, x, y, color, size) {
    const px = x * size;
    const py = y * size;
    context.fillStyle = color;
    context.beginPath();
    context.roundRect(px + 1, py + 1, size - 2, size - 2, 4);
    context.fill();
    // subtle top highlight
    context.fillStyle = 'rgba(255,255,255,0.18)';
    context.beginPath();
    context.roundRect(px + 1, py + 1, size - 2, (size - 2) / 3, 4);
    context.fill();
}

function draw() {
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // grid
    ctx.strokeStyle = CLR.grid;
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= COLS; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CELL, 0);
        ctx.lineTo(x * CELL, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CELL);
        ctx.lineTo(canvas.width, y * CELL);
        ctx.stroke();
    }

    // locked stack
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (board[y][x]) drawCell(ctx, x, y, CLR[board[y][x]], CELL);
        }
    }

    // ghost piece (landing preview)
    if (current) {
        const ghost = { ...current };
        while (true) {
            const next = { ...ghost, y: ghost.y + 1 };
            if (collides(next)) break;
            ghost.y = next.y;
        }
        for (const c of cellsOf(ghost)) {
            if (c.y >= 0) {
                ctx.fillStyle = CLR.ghost;
                ctx.beginPath();
                ctx.roundRect(c.x * CELL + 1, c.y * CELL + 1, CELL - 2, CELL - 2, 4);
                ctx.fill();
            }
        }
        // active piece
        for (const c of cellsOf(current)) {
            if (c.y >= 0) drawCell(ctx, c.x, c.y, CLR[current.type], CELL);
        }
    }
}

function drawNext() {
    nctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!nextType) return;
    const m = SHAPES[nextType];
    const size = 22;
    const w = m[0].length;
    const h = m.length;
    const offX = (nextCanvas.width - w * size) / 2;
    const offY = (nextCanvas.height - h * size) / 2;
    nctx.save();
    nctx.translate(offX, offY);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (m[y][x]) drawCell(nctx, x, y, CLR[nextType], size);
        }
    }
    nctx.restore();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

document.addEventListener('keydown', e => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }

    if (state !== 'running') {
        if (START_KEYS.has(e.key)) {
            startGame();
            e.preventDefault();
        }
        return;
    }

    switch (e.key) {
        case 'ArrowLeft':  move(-1, 0); draw(); e.preventDefault(); break;
        case 'ArrowRight': move(1, 0);  draw(); e.preventDefault(); break;
        case 'ArrowDown':  if (move(0, 1)) { score += 1; updateHud(); } draw(); e.preventDefault(); break;
        case 'ArrowUp':    rotateCurrent(); e.preventDefault(); break;
        case ' ':          hardDrop(); draw(); e.preventDefault(); break;
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('tetris-best') || '0', 10);
board = emptyBoard();
current = null;
nextType = null;
score = 0;
lines = 0;
level = 1;
state = 'idle';
updateHud();
draw();
