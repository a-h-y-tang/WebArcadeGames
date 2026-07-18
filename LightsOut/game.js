// ---------------------------------------------------------------------------
// Lights Out — the classic 5×5 light-toggle puzzle on the HTML5 canvas.
//
// The rules are tiny pure functions (toggle / press / lightsOn / checkWin)
// operating on a global boolean grid, kept deliberately separate from
// rendering. There is no animation-driven logic, so the Playwright suite can
// build an exact board, call press(), and assert the result with zero timing
// dependence.
// ---------------------------------------------------------------------------

const SIZE = 5;
const CELL = 80;              // 400 / 5
const W = SIZE * CELL;
const H = SIZE * CELL;

const CLR = {
    bg:      '#060912',
    tileOff: '#141c30',
    tileOffEdge: '#0c1222',
    tileOn:  '#fbbf24',
    tileOnEdge: '#fde68a',
    glow:    '#f59e0b',
};

// --- DOM -------------------------------------------------------------------
const canvas       = document.getElementById('canvas');
const ctx          = canvas.getContext('2d');
const movesEl      = document.getElementById('moves');
const levelEl      = document.getElementById('level');
const bestEl       = document.getElementById('best');
const overlay      = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub   = document.getElementById('overlay-sub');
const btnStart     = document.getElementById('btn-start');

// --- State (var so tests can reach it as window.*) -------------------------
var grid, initialGrid;
var moves, level, best, state;

// --- Board helpers ---------------------------------------------------------
function emptyBoard() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
}

function cloneBoard(g) {
    return g.map(row => row.slice());
}

function countOn(g) {
    let n = 0;
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (g[r][c]) n++;
    return n;
}

function lightsOn() {
    return countOn(grid);
}

// Flip one in-bounds cell of the given board.
function flip(g, r, c) {
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) g[r][c] = !g[r][c];
}

// Apply the Lights Out cross (cell + orthogonal neighbours) to a board.
function cross(g, r, c) {
    flip(g, r, c);
    flip(g, r - 1, c);
    flip(g, r + 1, c);
    flip(g, r, c - 1);
    flip(g, r, c + 1);
}

// Every board built this way is guaranteed solvable: it is reachable from the
// all-off board, and a press is its own inverse.
function generateBoard(scrambles) {
    let g;
    do {
        g = emptyBoard();
        for (let i = 0; i < scrambles; i++) {
            const r = Math.floor(Math.random() * SIZE);
            const c = Math.floor(Math.random() * SIZE);
            cross(g, r, c);
        }
    } while (countOn(g) === 0); // never start already solved
    return g;
}

// --- Public rule functions -------------------------------------------------
function toggle(r, c) {
    flip(grid, r, c);
}

function press(r, c) {
    if (state !== 'playing') return;
    cross(grid, r, c);
    moves++;
    updateHud();
    draw();
    checkWin();
}

function checkWin() {
    if (lightsOn() === 0) win();
}

// --- Lifecycle -------------------------------------------------------------
function beginLevel() {
    const scrambles = 3 + level * 2;
    grid = generateBoard(scrambles);
    initialGrid = cloneBoard(grid);
    moves = 0;
    state = 'playing';
    overlay.classList.remove('visible');
    btnStart.blur();
    updateHud();
    draw();
}

function startGame() {
    level = 1;
    beginLevel();
}

function nextLevel() {
    level++;
    beginLevel();
}

function resetPuzzle() {
    grid = cloneBoard(initialGrid);
    moves = 0;
    state = 'playing';
    updateHud();
    draw();
}

function win() {
    state = 'won';
    if (best === null || moves < best) {
        best = moves;
        localStorage.setItem('lightsout-best', best);
    }
    updateHud();
    draw();
    overlayTitle.textContent = 'Solved!';
    overlayScore.textContent = `${moves} move${moves === 1 ? '' : 's'}`;
    overlaySub.textContent = 'Press any key or the button for the next level';
    btnStart.textContent = 'Next Level';
    overlay.classList.add('visible');
}

function updateHud() {
    movesEl.textContent = moves;
    levelEl.textContent = level;
    bestEl.textContent = best === null ? '—' : best;
}

// --- Rendering -------------------------------------------------------------
function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, W, H);

    const inset = 6;
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const x = c * CELL + inset;
            const y = r * CELL + inset;
            const s = CELL - inset * 2;
            const on = grid[r][c];

            if (on) {
                ctx.shadowColor = CLR.glow;
                ctx.shadowBlur = 22;
                const grad = ctx.createLinearGradient(x, y, x, y + s);
                grad.addColorStop(0, CLR.tileOnEdge);
                grad.addColorStop(1, CLR.tileOn);
                ctx.fillStyle = grad;
            } else {
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                const grad = ctx.createLinearGradient(x, y, x, y + s);
                grad.addColorStop(0, CLR.tileOff);
                grad.addColorStop(1, CLR.tileOffEdge);
                ctx.fillStyle = grad;
            }
            roundRect(x, y, s, s, 12);
            ctx.fill();

            // Subtle rim
            ctx.shadowBlur = 0;
            ctx.lineWidth = 1;
            ctx.strokeStyle = on ? 'rgba(255,255,255,0.35)' : 'rgba(120,140,180,0.12)';
            roundRect(x + 0.5, y + 0.5, s - 1, s - 1, 12);
            ctx.stroke();
        }
    }
    ctx.shadowBlur = 0;
}

// --- Input -----------------------------------------------------------------
canvas.addEventListener('click', e => {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) press(r, c);
});

document.addEventListener('keydown', e => {
    if (state === 'idle') { startGame(); return; }
    if (state === 'won') { nextLevel(); return; }
    // playing
    if (e.key === 'n' || e.key === 'N') { beginLevel(); }
    else if (e.key === 'r' || e.key === 'R') { resetPuzzle(); }
});

btnStart.addEventListener('click', () => {
    if (state === 'won') nextLevel();
    else startGame();
    btnStart.blur();
});

// --- Init ------------------------------------------------------------------
const storedBest = localStorage.getItem('lightsout-best');
best = storedBest === null ? null : parseInt(storedBest, 10);
level = 1;
moves = 0;
state = 'idle';
grid = generateBoard(8);          // decorative board behind the title overlay
initialGrid = cloneBoard(grid);
updateHud();
draw();
