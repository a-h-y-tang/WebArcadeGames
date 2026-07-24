// ---------------------------------------------------------------------------
// Chain Reaction — two-player hotseat strategy on a grid.
//
// Players drop orbs into cells; a cell explodes when it holds as many orbs as
// it has orthogonal neighbours, pushing one orb into each neighbour and
// capturing them. Explosions cascade. Capture every orb to win.
//
// applyMove() resolves the whole placement + cascade + win check synchronously,
// so the logic has no dependence on timers — the rAF-free design keeps tests
// deterministic. Key state is exposed as top-level bindings for the tests.
// ---------------------------------------------------------------------------

// --- Board dimensions -------------------------------------------------------
const ROWS = 6;
const COLS = 6;
const CELL = 68;
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL;

const RED = 0;
const BLUE = 1;
const COLORS = ['#ff5566', '#4d9fff'];
const NAMES = ['Red', 'Blue'];

// --- Mutable state (exposed for tests) --------------------------------------
let grid = [];
let current = RED;
let state = 'playing';   // 'playing' | 'over'
let winner = null;       // null | 0 | 1
let moveCount = 0;

// --- DOM --------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const boardWrap = document.querySelector('.board-wrap');
const turnEl = document.getElementById('turn');
const turnLabel = document.getElementById('turn-label');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const btnNew = document.getElementById('btn-new');
const btnAgain = document.getElementById('btn-again');

// --- Grid helpers -----------------------------------------------------------
function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function neighbors(r, c) {
    const out = [];
    if (r > 0) out.push([r - 1, c]);
    if (r < ROWS - 1) out.push([r + 1, c]);
    if (c > 0) out.push([r, c - 1]);
    if (c < COLS - 1) out.push([r, c + 1]);
    return out;
}

function criticalMass(r, c) {
    return neighbors(r, c).length;
}

function canPlace(r, c, player) {
    if (!inBounds(r, c)) return false;
    const cell = grid[r][c];
    return cell.owner === null || cell.owner === player;
}

function cellsOwnedBy(player) {
    let n = 0;
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            if (grid[r][c].owner === player) n++;
    return n;
}

function totalOrbs() {
    let n = 0;
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            n += grid[r][c].count;
    return n;
}

// --- Core move logic --------------------------------------------------------
function newGame() {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) row.push({ count: 0, owner: null });
        grid.push(row);
    }
    current = RED;
    state = 'playing';
    winner = null;
    moveCount = 0;
    render();
    updateHud();
}

// Resolve every unstable cell until the board is stable or the game is decided.
function settle(player) {
    // Safety cap: the win check below normally halts a decided game, but this
    // prevents any theoretical infinite cascade from hanging the loop.
    const cap = ROWS * COLS * 64;
    for (let iter = 0; iter < cap; iter++) {
        const unstable = [];
        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++)
                if (grid[r][c].count >= criticalMass(r, c) && grid[r][c].count > 0)
                    unstable.push([r, c]);

        if (unstable.length === 0) return;

        for (const [r, c] of unstable) {
            const cm = criticalMass(r, c);
            grid[r][c].count -= cm;
            if (grid[r][c].count === 0) grid[r][c].owner = null;
            for (const [nr, nc] of neighbors(r, c)) {
                grid[nr][nc].count += 1;
                grid[nr][nc].owner = player;
            }
        }

        // If the mover now owns every orb, the game is over — stop cascading.
        if (moveCount >= 2 && cellsOwnedBy(1 - player) === 0 && cellsOwnedBy(player) > 0) {
            return;
        }
    }
}

function applyMove(r, c) {
    if (state !== 'playing') return false;
    if (!canPlace(r, c, current)) return false;

    const player = current;
    grid[r][c].count += 1;
    grid[r][c].owner = player;
    moveCount += 1;

    settle(player);

    // Win check — only once both players have had a move.
    if (moveCount >= 2 && cellsOwnedBy(1 - player) === 0 && cellsOwnedBy(player) > 0) {
        state = 'over';
        winner = player;
        render();
        updateHud();
        showOverlay();
        return true;
    }

    current = 1 - player;
    render();
    updateHud();
    return true;
}

// --- Rendering --------------------------------------------------------------
// Positions of orbs within a cell for counts 1..3 (cells never rest at >= 4).
const ORB_LAYOUT = {
    1: [[0, 0]],
    2: [[-0.22, 0], [0.22, 0]],
    3: [[0, -0.24], [-0.22, 0.16], [0.22, 0.16]],
};

function drawCell(r, c) {
    const x = c * CELL;
    const y = r * CELL;
    ctx.strokeStyle = '#1d2942';
    ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);

    const cell = grid[r][c];
    if (cell.count === 0 || cell.owner === null) return;

    const color = COLORS[cell.owner];
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const rad = CELL * 0.14;
    const layout = ORB_LAYOUT[Math.min(cell.count, 3)] || ORB_LAYOUT[3];
    const nearCrit = cell.count >= criticalMass(r, c) - 1;

    for (const [dx, dy] of layout) {
        const ox = cx + dx * CELL;
        const oy = cy + dy * CELL;
        ctx.beginPath();
        ctx.arc(ox, oy, rad, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = nearCrit ? 14 : 6;
        ctx.fill();
        ctx.shadowBlur = 0;
        // highlight
        ctx.beginPath();
        ctx.arc(ox - rad * 0.3, oy - rad * 0.3, rad * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fill();
    }
}

function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            drawCell(r, c);
}

function updateHud() {
    turnEl.classList.toggle('turn-red', current === RED);
    turnEl.classList.toggle('turn-blue', current === BLUE);
    boardWrap.classList.toggle('glow-red', state === 'playing' && current === RED);
    boardWrap.classList.toggle('glow-blue', state === 'playing' && current === BLUE);
    turnLabel.textContent = state === 'over'
        ? NAMES[winner] + ' wins!'
        : NAMES[current] + "'s turn";
}

function showOverlay() {
    overlayTitle.textContent = NAMES[winner] + ' wins!';
    overlayTitle.style.color = COLORS[winner];
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// --- Input ------------------------------------------------------------------
function onCanvasClick(e) {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    applyMove(r, c);
}

function onKeyDown(e) {
    if (e.key === 'r' || e.key === 'R') {
        hideOverlay();
        newGame();
    }
}

function reset() {
    hideOverlay();
    newGame();
}

// --- Wire up ----------------------------------------------------------------
canvas.addEventListener('click', onCanvasClick);
window.addEventListener('keydown', onKeyDown);
btnNew.addEventListener('click', reset);
btnAgain.addEventListener('click', reset);

newGame();
