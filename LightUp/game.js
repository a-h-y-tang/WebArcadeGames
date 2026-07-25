// ---------------------------------------------------------------------------
// Light Up (Akari) — Nikoli's binary-determination logic puzzle on a 7×7 grid,
// drawn with the HTML5 Canvas 2D API.
//
// You place light bulbs on white cells so that every white cell is illuminated,
// no bulb shines on another, and each numbered wall touches exactly its number
// of bulbs. Akari has no animation, so the rules are small pure functions over
// integer grids (isWall / wallNum / computeLit / bulbConflict / adjBulbCount /
// wallSatisfied / isSolved) kept strictly separate from rendering — which lets
// the Playwright suite build an exact position and assert the outcome with zero
// timing dependence.
//
// The four shipped puzzles were produced offline by a solution-first generator
// and each verified to have a UNIQUE solution; both the grid and its verified
// solution are embedded here.
// ---------------------------------------------------------------------------

const N = 7;                   // board is N×N
const CELL = 60;               // cell size in pixels
const PAD = 22;                // outer margin
const W = PAD * 2 + N * CELL;  // canvas dimensions (square)
const H = W;

const CLR = {
    bg:        '#0e1120',
    grid:      '#20263f',
    white:     '#171c30',
    lit:       '#3a3618',
    litGlow:   '#5c5418',
    wall:      '#2b3350',
    wallEdge:  '#3d4770',
    wallText:  '#c9d2ec',
    good:      '#56d98a',
    bad:       '#ff5d73',
    bulb:      '#ffd257',
    bulbEdge:  '#a9791a',
    mark:      '#6b7290',
};

// --- Puzzles (grid + verified unique solution) -----------------------------
// Grid chars: '.' white cell, '0'..'4' numbered wall, 'X' blank wall.
const levels = [
    {
        grid: ['1.3...1', '1..3.2.', '.......', '.......', '0...10.', '0......', '0....0.'],
        sol: [[0, 1], [0, 3], [1, 2], [1, 4], [1, 6], [2, 0], [3, 3], [5, 4]],
    },
    {
        grid: ['.2.3..0', '.1.....', '.....2.', '...1..3', '.....2.', '.....1.', '...0...'],
        sol: [[0, 0], [0, 2], [0, 4], [1, 3], [2, 1], [2, 6], [3, 5], [4, 3], [4, 6], [6, 5]],
    },
    {
        grid: ['.3.2...', '3...2..', '.3..12.', '.......', '....2..', '.......', '.0.....'],
        sol: [[0, 0], [0, 2], [0, 4], [1, 1], [1, 5], [2, 0], [2, 3], [2, 6], [3, 1], [4, 5], [5, 4]],
    },
    {
        grid: ['.3..1..', '.......', '1.11...', '.3.....', '...1...', '1...2..', '.1....0'],
        sol: [[0, 0], [0, 2], [0, 5], [1, 1], [2, 4], [3, 0], [3, 2], [4, 1], [4, 6], [5, 3], [6, 0], [6, 4]],
    },
];

// --- DOM -------------------------------------------------------------------
const canvas       = document.getElementById('canvas');
const ctx          = canvas.getContext('2d');
const levelEl      = document.getElementById('level');
const bulbsEl      = document.getElementById('bulbs');
const overlay      = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub   = document.getElementById('overlay-sub');
const btnStart     = document.getElementById('btn-start');

canvas.width = W;
canvas.height = H;

// --- State (var so tests can reach it as window.*) -------------------------
var wall;          // N×N boolean — is this cell a wall?
var num;           // N×N — null (white), -1 (blank wall), or 0..4 (numbered)
var bulbs;         // N×N boolean — bulb placed?
var marks;         // N×N boolean — player's "no bulb" dot marks
var state;         // 'idle' | 'playing' | 'won'
var levelIndex;    // current puzzle index

// --- Board helpers ---------------------------------------------------------
function makeGrid(v) { return Array.from({ length: N }, () => Array(N).fill(v)); }
function inBounds(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
function isWall(r, c) { return wall[r][c]; }
function wallNum(r, c) { return num[r][c]; }   // null for white cells

// Parse a level's string grid into the wall/num arrays and clear the board.
function loadLevel(i) {
    levelIndex = ((i % levels.length) + levels.length) % levels.length;
    const grid = levels[levelIndex].grid;
    wall = makeGrid(false);
    num = makeGrid(null);
    bulbs = makeGrid(false);
    marks = makeGrid(false);
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            const ch = grid[r][c];
            if (ch === '.') continue;
            wall[r][c] = true;
            num[r][c] = ch === 'X' ? -1 : parseInt(ch, 10);
        }
    }
    draw();
}

// --- Mutators --------------------------------------------------------------
function toggleBulb(r, c) {
    if (state !== 'playing') return;
    if (!inBounds(r, c) || wall[r][c]) return;
    bulbs[r][c] = !bulbs[r][c];
    if (bulbs[r][c]) marks[r][c] = false;   // a bulb clears any mark
    checkWin();
    draw();
}

function toggleMark(r, c) {
    if (state !== 'playing') return;
    if (!inBounds(r, c) || wall[r][c] || bulbs[r][c]) return;
    marks[r][c] = !marks[r][c];
    draw();
}

// --- Rules (pure) ----------------------------------------------------------
const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];

// Is cell (r,c) illuminated? A white cell is lit if it holds a bulb or a bulb
// shines onto it along a row/column with no wall in between.
function isLit(r, c) {
    if (bulbs[r][c]) return true;
    for (const [dr, dc] of DIRS) {
        let rr = r + dr, cc = c + dc;
        while (inBounds(rr, cc) && !wall[rr][cc]) {
            if (bulbs[rr][cc]) return true;
            rr += dr; cc += dc;
        }
    }
    return false;
}

function computeLit() {
    const lit = makeGrid(false);
    for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++)
            if (!wall[r][c]) lit[r][c] = isLit(r, c);
    return lit;
}

// Does the bulb at (r,c) shine on another bulb (illegal)?
function bulbConflict(r, c) {
    if (!bulbs[r][c]) return false;
    for (const [dr, dc] of DIRS) {
        let rr = r + dr, cc = c + dc;
        while (inBounds(rr, cc) && !wall[rr][cc]) {
            if (bulbs[rr][cc]) return true;
            rr += dr; cc += dc;
        }
    }
    return false;
}

// Bulbs orthogonally adjacent to a wall (for its number constraint).
function adjBulbCount(r, c) {
    let n = 0;
    for (const [dr, dc] of DIRS) {
        const rr = r + dr, cc = c + dc;
        if (inBounds(rr, cc) && bulbs[rr][cc]) n++;
    }
    return n;
}

function wallSatisfied(r, c) {
    if (num[r][c] == null || num[r][c] < 0) return true;   // white / blank wall
    return adjBulbCount(r, c) === num[r][c];
}

// The puzzle is solved when every white cell is lit, no bulb sees another, and
// every numbered wall has exactly its required number of adjacent bulbs.
function isSolved() {
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            if (wall[r][c]) {
                if (!wallSatisfied(r, c)) return false;
            } else {
                if (!isLit(r, c)) return false;
                if (bulbs[r][c] && bulbConflict(r, c)) return false;
            }
        }
    }
    return true;
}

// --- Lifecycle -------------------------------------------------------------
function checkWin() {
    if (state === 'playing' && isSolved()) {
        state = 'won';
        const last = levelIndex === levels.length - 1;
        showOverlay('PUZZLE SOLVED', last ? 'Every cell lit! Play again from puzzle 1.' : 'Every cell lit — nicely done!',
            last ? 'Play Again' : 'Next Puzzle');
    }
}

function startGame() {
    loadLevel(0);
    state = 'playing';
    hideOverlay();
    draw();
}

function resetLevel() {
    loadLevel(levelIndex);
    state = 'playing';
    hideOverlay();
    draw();
}

function nextLevel() {
    loadLevel(levelIndex + 1);
    state = 'playing';
    hideOverlay();
    draw();
}

// --- Overlay / HUD ---------------------------------------------------------
function showOverlay(title, sub, btn) {
    overlayTitle.textContent = title;
    overlayScore.textContent = '';
    overlaySub.textContent = sub;
    if (btn) btnStart.textContent = btn;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function updateHUD() {
    levelEl.textContent = `${levelIndex + 1} / ${levels.length}`;
    bulbsEl.textContent = bulbs.flat().filter(Boolean).length;
}

// --- Coordinate mapping ----------------------------------------------------
function cellCenter(r, c) {
    return { x: PAD + c * CELL + CELL / 2, y: PAD + r * CELL + CELL / 2 };
}

function cellAt(x, y) {
    const c = Math.floor((x - PAD) / CELL);
    const r = Math.floor((y - PAD) / CELL);
    return inBounds(r, c) ? { r, c } : null;
}

// --- Rendering -------------------------------------------------------------
function draw() {
    updateHUD();

    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, W, H);

    const lit = computeLit();

    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            const x = PAD + c * CELL, y = PAD + r * CELL;

            if (wall[r][c]) {
                drawWall(r, c, x, y);
            } else {
                // white cell — warm glow if lit
                ctx.fillStyle = lit[r][c] ? CLR.lit : CLR.white;
                ctx.fillRect(x, y, CELL, CELL);
                if (lit[r][c]) {
                    ctx.fillStyle = 'rgba(255,210,87,0.10)';
                    ctx.fillRect(x, y, CELL, CELL);
                }
            }
            // grid line
            ctx.strokeStyle = CLR.grid;
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, CELL, CELL);
        }
    }

    // Bulbs and marks (drawn on top so glow underlays them).
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            if (wall[r][c]) continue;
            const { x, y } = cellCenter(r, c);
            if (bulbs[r][c]) drawBulb(x, y, bulbConflict(r, c));
            else if (marks[r][c]) drawMark(x, y);
        }
    }
}

function drawWall(r, c, x, y) {
    ctx.fillStyle = CLR.wall;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.strokeStyle = CLR.wallEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);

    const n = num[r][c];
    if (n != null && n >= 0) {
        const cnt = adjBulbCount(r, c);
        ctx.fillStyle = cnt === n ? CLR.good : (cnt > n ? CLR.bad : CLR.wallText);
        ctx.font = '700 26px Segoe UI, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n), x + CELL / 2, y + CELL / 2 + 1);
    }
}

function drawBulb(cx, cy, conflict) {
    // glow halo
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, CELL * 0.55);
    g.addColorStop(0, conflict ? 'rgba(255,93,115,0.55)' : 'rgba(255,210,87,0.55)');
    g.addColorStop(1, 'rgba(255,210,87,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - CELL / 2, cy - CELL / 2, CELL, CELL);

    // bulb glass
    ctx.fillStyle = conflict ? '#ff8a99' : CLR.bulb;
    ctx.beginPath();
    ctx.arc(cx, cy - 3, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = conflict ? CLR.bad : CLR.bulbEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
    // filament highlight
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(cx - 3, cy - 6, 3, 0, Math.PI * 2);
    ctx.fill();
    // base
    ctx.fillStyle = '#6b6b6b';
    ctx.fillRect(cx - 6, cy + 8, 12, 6);
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(cx - 6, cy + 11, 12, 3);

    if (conflict) {
        ctx.strokeStyle = CLR.bad;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, CELL * 0.42, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawMark(cx, cy) {
    ctx.strokeStyle = CLR.mark;
    ctx.lineWidth = 2.5;
    const s = 7;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
    ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s);
    ctx.stroke();
}

// --- Input -----------------------------------------------------------------
function canvasCell(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    return cellAt(x, y);
}

canvas.addEventListener('click', (e) => {
    if (state !== 'playing') return;
    const cell = canvasCell(e);
    if (cell) toggleBulb(cell.r, cell.c);
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (state !== 'playing') return;
    const cell = canvasCell(e);
    if (cell) toggleMark(cell.r, cell.c);
});

document.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'r' || k === 'R') { resetLevel(); return; }
    if (k === 'n' || k === 'N') { if (state === 'won') nextLevel(); return; }
    if ((k === 'Enter' || k === ' ') && state !== 'playing') {
        if (state === 'won') nextLevel(); else startGame();
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'won') nextLevel();
    else startGame();
});

// --- Boot ------------------------------------------------------------------
loadLevel(0);
state = 'idle';
draw();
