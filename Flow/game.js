// ---------------------------------------------------------------------------
// Flow — a grid logic puzzle on an HTML5 canvas.
// Connect every pair of matching-colour endpoints with a pipe (a path of
// orthogonally adjacent cells) without crossing, filling the whole board.
//
// A single classic (non-module) script so the game state and pure helpers are
// reachable as globals from the Playwright tests, mirroring the other games in
// this repo.
// ---------------------------------------------------------------------------

const SIZE_PX = 480; // fixed canvas size; cell size = SIZE_PX / level size

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const levelEl = document.getElementById('level');
const movesEl = document.getElementById('moves');
const pipeEl = document.getElementById('pipe');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// Colour palette, keyed by the single letter stored in the board.
const CLR = {
    R: '#ef4444', G: '#22c55e', B: '#3b82f6',
    Y: '#eab308', P: '#a855f7', C: '#06b6d4',
};

// Authored levels. Each was built from a full-coverage solution that tiles the
// entire grid, so every level is guaranteed solvable with 100% coverage. Only
// the endpoints (a, b as [row, col]) are needed to define play.
const LEVELS = [
    { size: 5, flows: [
        { color: 'R', a: [0, 0], b: [4, 1] },
        { color: 'G', a: [0, 1], b: [0, 4] },
        { color: 'B', a: [1, 4], b: [4, 2] },
        { color: 'Y', a: [1, 1], b: [3, 3] },
        { color: 'P', a: [2, 1], b: [3, 1] },
    ] },
    { size: 5, flows: [
        { color: 'R', a: [0, 0], b: [0, 4] },
        { color: 'G', a: [1, 0], b: [1, 4] },
        { color: 'B', a: [1, 1], b: [1, 3] },
        { color: 'Y', a: [2, 1], b: [2, 3] },
        { color: 'P', a: [3, 1], b: [3, 3] },
    ] },
    { size: 6, flows: [
        { color: 'R', a: [0, 0], b: [0, 5] },
        { color: 'G', a: [1, 0], b: [1, 5] },
        { color: 'B', a: [1, 1], b: [1, 4] },
        { color: 'Y', a: [2, 1], b: [2, 4] },
        { color: 'P', a: [3, 1], b: [3, 4] },
        { color: 'C', a: [4, 1], b: [4, 4] },
    ] },
];

// --- State ---
let levelIndex, size, COLORS, ep, endpointColor, paths, board, moves, best, state, active, dragging;

// ---------------------------------------------------------------------------
// Level setup
// ---------------------------------------------------------------------------

function emptyGrid(n) {
    return Array.from({ length: n }, () => Array(n).fill(null));
}

function loadLevel(i) {
    levelIndex = i;
    const lvl = LEVELS[i];
    size = lvl.size;
    COLORS = lvl.flows.map(f => f.color);
    ep = {};
    endpointColor = emptyGrid(size);
    paths = {};
    for (const f of lvl.flows) {
        ep[f.color] = [f.a.slice(), f.b.slice()];
        endpointColor[f.a[0]][f.a[1]] = f.color;
        endpointColor[f.b[0]][f.b[1]] = f.color;
        paths[f.color] = [];
    }
    moves = 0;
    active = null;
    dragging = false;
    const stored = localStorage.getItem('flow-best-' + (i + 1));
    best = stored ? parseInt(stored, 10) : null;
    rebuildBoard();
    updateHud();
    render();
}

function resetLevel() {
    loadLevel(levelIndex);
}

function nextLevel() {
    loadLevel(levelIndex < LEVELS.length - 1 ? levelIndex + 1 : 0);
    state = 'playing';
    overlay.classList.remove('visible');
    render();
}

// Rebuild the ownership grid from endpoints (always owned) plus drawn paths.
function rebuildBoard() {
    board = emptyGrid(size);
    for (const color of COLORS) {
        for (const [r, c] of ep[color]) board[r][c] = color;
    }
    for (const color of COLORS) {
        for (const [r, c] of paths[color]) board[r][c] = color;
    }
}

// ---------------------------------------------------------------------------
// Pipe drawing
// ---------------------------------------------------------------------------

function cellsEqual(a, b) {
    return a[0] === b[0] && a[1] === b[1];
}

// Begin (or resume) drawing a pipe at the given cell. Returns true if a gesture
// started. Starting on an endpoint restarts that colour from the endpoint;
// starting on an owned cell resumes that colour from there.
function startPath(r, c) {
    let color;
    if (endpointColor[r][c] != null) {
        color = endpointColor[r][c];
        paths[color] = [[r, c]];
    } else if (board[r][c] != null) {
        color = board[r][c];
        const idx = paths[color].findIndex(cell => cell[0] === r && cell[1] === c);
        if (idx === -1) return false;
        paths[color] = paths[color].slice(0, idx + 1);
    } else {
        return false;
    }
    active = color;
    dragging = true;
    moves += 1;
    rebuildBoard();
    updateHud();
    return true;
}

// Extend the active pipe into an adjacent cell. Returns true if it changed.
function extendPath(r, c) {
    if (active == null) return false;
    const p = paths[active];
    const head = p[p.length - 1];

    // Must be orthogonally adjacent to the current head.
    if (Math.abs(r - head[0]) + Math.abs(c - head[1]) !== 1) return false;

    // Backtracking onto the previous cell erases the head.
    if (p.length >= 2 && cellsEqual(p[p.length - 2], [r, c])) {
        p.pop();
        rebuildBoard();
        updateHud();
        return true;
    }

    // Never route through another colour's endpoint.
    if (endpointColor[r][c] != null && endpointColor[r][c] !== active) return false;

    // Never loop back onto our own pipe.
    if (board[r][c] === active && p.some(cell => cell[0] === r && cell[1] === c)) return false;

    // Once the head sits on one of our own endpoints, the pipe is terminal.
    if (endpointColor[head[0]][head[1]] === active && p.length >= 2) return false;

    // Crossing another colour's pipe cuts it at the crossing point.
    const owner = board[r][c];
    if (owner != null && owner !== active) {
        const op = paths[owner];
        const idx = op.findIndex(cell => cell[0] === r && cell[1] === c);
        if (idx !== -1) paths[owner] = op.slice(0, idx);
    }

    p.push([r, c]);
    rebuildBoard();
    updateHud();
    return true;
}

function endPath() {
    dragging = false;
    active = null;
    maybeSolve();
    render();
}

// ---------------------------------------------------------------------------
// Win detection
// ---------------------------------------------------------------------------

function isConnected(color) {
    const p = paths[color];
    if (!p || p.length < 2) return false;
    const [a, b] = ep[color];
    const tail = p[0], head = p[p.length - 1];
    return (cellsEqual(tail, a) && cellsEqual(head, b)) ||
           (cellsEqual(tail, b) && cellsEqual(head, a));
}

// Cells covered by a real pipe segment (a lone endpoint dot does not count).
function filledCount() {
    const covered = new Set();
    for (const color of COLORS) {
        const p = paths[color];
        if (p && p.length >= 2) for (const [r, c] of p) covered.add(r * size + c);
    }
    return covered.size;
}

function pipePercent() {
    return Math.round((filledCount() / (size * size)) * 100);
}

function isSolved() {
    for (const color of COLORS) if (!isConnected(color)) return false;
    return filledCount() === size * size;
}

function maybeSolve() {
    if (!isSolved()) return;
    state = 'solved';
    const key = 'flow-best-' + (levelIndex + 1);
    const prev = parseInt(localStorage.getItem(key) || '0', 10);
    if (!prev || moves < prev) localStorage.setItem(key, moves);
    best = parseInt(localStorage.getItem(key), 10);
    const last = levelIndex === LEVELS.length - 1;
    showOverlay(
        last ? 'You Win!' : 'Level Solved',
        `${moves} moves`,
        last ? 'You completed every level! Press Enter to play again.' : 'Press N or Enter for the next level',
        last ? 'Play Again' : 'Next Level',
    );
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'playing';
    overlay.classList.remove('visible');
    render();
}

function showOverlay(title, scoreText, sub, btn) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = btn;
    overlay.classList.add('visible');
}

function updateHud() {
    levelEl.textContent = levelIndex + 1;
    movesEl.textContent = moves;
    pipeEl.textContent = pipePercent() + '%';
    bestEl.textContent = best != null ? best : '–';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function cellFromXY(x, y) {
    const cs = SIZE_PX / size;
    const c = Math.max(0, Math.min(size - 1, Math.floor(x / cs)));
    const r = Math.max(0, Math.min(size - 1, Math.floor(y / cs)));
    return { r, c };
}

function render() {
    const cs = SIZE_PX / size;

    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, SIZE_PX, SIZE_PX);

    // Grid.
    ctx.strokeStyle = '#1b2430';
    ctx.lineWidth = 2;
    for (let i = 0; i <= size; i++) {
        ctx.beginPath(); ctx.moveTo(i * cs, 0); ctx.lineTo(i * cs, SIZE_PX); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * cs); ctx.lineTo(SIZE_PX, i * cs); ctx.stroke();
    }

    // Pipes.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const color of COLORS) {
        const p = paths[color];
        if (!p || p.length < 2) continue;
        ctx.strokeStyle = CLR[color];
        ctx.lineWidth = cs * 0.34;
        ctx.beginPath();
        p.forEach(([r, c], i) => {
            const x = c * cs + cs / 2, y = r * cs + cs / 2;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    // Endpoint discs.
    for (const color of COLORS) {
        for (const [r, c] of ep[color]) {
            const x = c * cs + cs / 2, y = r * cs + cs / 2;
            ctx.fillStyle = CLR[color];
            ctx.beginPath();
            ctx.arc(x, y, cs * 0.30, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.22)';
            ctx.beginPath();
            ctx.arc(x - cs * 0.08, y - cs * 0.09, cs * 0.09, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Active head highlight.
    if (dragging && active && paths[active].length) {
        const [r, c] = paths[active][paths[active].length - 1];
        const x = c * cs + cs / 2, y = r * cs + cs / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, cs * 0.42, 0, Math.PI * 2);
        ctx.stroke();
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing') return;
    const { r, c } = cellFromXY(e.offsetX, e.offsetY);
    startPath(r, c);
    render();
});

canvas.addEventListener('pointermove', e => {
    if (state !== 'playing' || !dragging) return;
    const { r, c } = cellFromXY(e.offsetX, e.offsetY);
    extendPath(r, c);
    render();
    if (isSolved()) endPath();
});

window.addEventListener('pointerup', () => {
    if (dragging) endPath();
});

document.addEventListener('keydown', e => {
    if (state === 'idle') {
        startGame();
        e.preventDefault();
        return;
    }
    if (e.key === 'r' || e.key === 'R') {
        resetLevel();
        state = 'playing';
        overlay.classList.remove('visible');
        e.preventDefault();
        return;
    }
    if (state === 'solved' && (e.key === 'n' || e.key === 'N' || e.key === 'Enter')) {
        nextLevel();
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'solved') nextLevel();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

loadLevel(0);
state = 'idle';
updateHud();
render();
