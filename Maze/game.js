// Maze — navigate a procedurally generated maze to the exit before time runs
// out. State is kept in top-level globals (matching the other games in this
// repo) so the Playwright suite can read `maze`, `player`, `exit`, etc. and
// drive the game deterministically via `movePlayer()` and `solvePath()`.

const CANVAS = 500;
const BASE_SIZE = 10;   // starting maze is BASE_SIZE × BASE_SIZE cells
const MAX_SIZE = 20;    // cap so cells stay large enough to see
const SECONDS_PER_CELL = 2.5; // time budget scales with maze width

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const levelEl = document.getElementById('level');
const scoreEl = document.getElementById('score');
const timeEl = document.getElementById('time');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// Wall order per cell: [top, right, bottom, left].
// Each move knows which wall it must cross and the delta it applies.
const MOVES = {
    ArrowUp:    { dx: 0, dy: -1, wall: 0 },
    ArrowRight: { dx: 1, dy: 0, wall: 1 },
    ArrowDown:  { dx: 0, dy: 1, wall: 2 },
    ArrowLeft:  { dx: -1, dy: 0, wall: 3 },
    w: { dx: 0, dy: -1, wall: 0 },
    d: { dx: 1, dy: 0, wall: 1 },
    s: { dx: 0, dy: 1, wall: 2 },
    a: { dx: -1, dy: 0, wall: 3 },
};

// --- State ---
let maze, player, exit, COLS, ROWS, CELL;
let level, score, best, state, timeLeft, timeLimit, lastTs, animId;

function sizeForLevel(l) {
    return Math.min(MAX_SIZE, BASE_SIZE + (l - 1) * 2);
}

function timeForLevel(l) {
    return sizeForLevel(l) * SECONDS_PER_CELL;
}

// Iterative recursive-backtracker: carves a perfect maze (one path between any
// two cells). Border walls are never removed, so the maze is always enclosed.
function generateMaze(cols, rows) {
    const grid = [];
    for (let y = 0; y < rows; y++) {
        const row = [];
        for (let x = 0; x < cols; x++) {
            row.push({ walls: [true, true, true, true], visited: false });
        }
        grid.push(row);
    }

    const stack = [];
    let cx = 0;
    let cy = 0;
    grid[0][0].visited = true;
    let visited = 1;
    const total = cols * rows;

    while (visited < total) {
        const neighbors = [];
        if (cy > 0 && !grid[cy - 1][cx].visited) neighbors.push({ nx: cx, ny: cy - 1, wall: 0, opp: 2 });
        if (cx < cols - 1 && !grid[cy][cx + 1].visited) neighbors.push({ nx: cx + 1, ny: cy, wall: 1, opp: 3 });
        if (cy < rows - 1 && !grid[cy + 1][cx].visited) neighbors.push({ nx: cx, ny: cy + 1, wall: 2, opp: 0 });
        if (cx > 0 && !grid[cy][cx - 1].visited) neighbors.push({ nx: cx - 1, ny: cy, wall: 3, opp: 1 });

        if (neighbors.length) {
            const n = neighbors[Math.floor(Math.random() * neighbors.length)];
            grid[cy][cx].walls[n.wall] = false;
            grid[n.ny][n.nx].walls[n.opp] = false;
            grid[n.ny][n.nx].visited = true;
            visited++;
            stack.push({ x: cx, y: cy });
            cx = n.nx;
            cy = n.ny;
        } else {
            const back = stack.pop();
            cx = back.x;
            cy = back.y;
        }
    }
    return grid;
}

// Breadth-first shortest path of move keys from the player to the exit.
// Tests replay this to solve a level without depending on the random layout.
function solvePath() {
    const key = (x, y) => y * COLS + x;
    const dirs = [
        { k: 'ArrowUp', dx: 0, dy: -1, wall: 0 },
        { k: 'ArrowRight', dx: 1, dy: 0, wall: 1 },
        { k: 'ArrowDown', dx: 0, dy: 1, wall: 2 },
        { k: 'ArrowLeft', dx: -1, dy: 0, wall: 3 },
    ];
    const prev = new Map();
    const seen = new Set([key(player.x, player.y)]);
    const queue = [{ x: player.x, y: player.y }];

    while (queue.length) {
        const cur = queue.shift();
        if (cur.x === exit.x && cur.y === exit.y) break;
        const cell = maze[cur.y][cur.x];
        for (const d of dirs) {
            if (cell.walls[d.wall]) continue;
            const nx = cur.x + d.dx;
            const ny = cur.y + d.dy;
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
            const kk = key(nx, ny);
            if (seen.has(kk)) continue;
            seen.add(kk);
            prev.set(kk, { px: cur.x, py: cur.y, dir: d.k });
            queue.push({ x: nx, y: ny });
        }
    }

    const path = [];
    let ck = key(exit.x, exit.y);
    while (prev.has(ck)) {
        const p = prev.get(ck);
        path.unshift(p.dir);
        ck = key(p.px, p.py);
    }
    return path;
}

// --- Game flow ---
function setupLevel() {
    const size = sizeForLevel(level);
    COLS = size;
    ROWS = size;
    CELL = Math.floor(CANVAS / size);
    maze = generateMaze(COLS, ROWS);
    player = { x: 0, y: 0 };
    exit = { x: COLS - 1, y: ROWS - 1 };
    timeLimit = timeForLevel(level);
    timeLeft = timeLimit;
    lastTs = null;
    updateHud();
    draw();
}

function startGame() {
    level = 1;
    score = 0;
    state = 'playing';
    overlay.classList.remove('visible');
    setupLevel();
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function nextLevel() {
    score++;
    level++;
    setupLevel();
}

function endGame() {
    state = 'over';
    cancelAnimationFrame(animId);
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        try { localStorage.setItem('maze-best', String(best)); } catch (e) {}
    }
    overlayTitle.textContent = "Time's Up!";
    overlayScore.textContent = `${score} solved`;
    overlaySub.textContent = 'Press an arrow key or click Play Again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    draw();
}

// Attempt a move. Returns true if the player actually moved.
function movePlayer(k) {
    if (state !== 'playing') return false;
    const m = MOVES[k];
    if (!m) return false;
    const cell = maze[player.y][player.x];
    if (cell.walls[m.wall]) return false; // wall in the way
    const nx = player.x + m.dx;
    const ny = player.y + m.dy;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return false;
    player.x = nx;
    player.y = ny;
    if (player.x === exit.x && player.y === exit.y) {
        nextLevel();
    } else {
        draw();
    }
    return true;
}

// --- Timer loop ---
function loop(ts) {
    if (state !== 'playing') return;
    if (lastTs == null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    timeLeft -= dt;
    if (timeLeft <= 0) {
        timeLeft = 0;
        timeEl.textContent = '0';
        endGame();
        return;
    }
    timeEl.textContent = String(Math.ceil(timeLeft));
    animId = requestAnimationFrame(loop);
}

// --- Rendering ---
function updateHud() {
    levelEl.textContent = level;
    scoreEl.textContent = score;
    timeEl.textContent = String(Math.ceil(timeLeft));
}

function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

function draw() {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, CANVAS, CANVAS);

    const ox = Math.floor((CANVAS - CELL * COLS) / 2);
    const oy = Math.floor((CANVAS - CELL * ROWS) / 2);

    // Exit goal (glowing).
    if (exit) {
        ctx.save();
        ctx.shadowColor = '#22c55e';
        ctx.shadowBlur = 22;
        ctx.fillStyle = '#16a34a';
        ctx.fillRect(ox + exit.x * CELL + 3, oy + exit.y * CELL + 3, CELL - 6, CELL - 6);
        ctx.restore();
    }

    // Walls.
    ctx.strokeStyle = '#8b949e';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const c = maze[y][x];
            const px = ox + x * CELL;
            const py = oy + y * CELL;
            if (c.walls[0]) line(px, py, px + CELL, py);
            if (c.walls[1]) line(px + CELL, py, px + CELL, py + CELL);
            if (c.walls[2]) line(px, py + CELL, px + CELL, py + CELL);
            if (c.walls[3]) line(px, py, px, py + CELL);
        }
    }

    // Player.
    if (player) {
        ctx.fillStyle = '#38bdf8';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(
            ox + player.x * CELL + CELL / 2,
            oy + player.y * CELL + CELL / 2,
            Math.max(3, CELL * 0.28),
            0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }
}

// --- Input ---
document.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!(k in MOVES)) return;
    e.preventDefault();
    if (state === 'idle' || state === 'over') {
        startGame();
        return;
    }
    if (state === 'playing') {
        movePlayer(k);
    }
});

btnStart.addEventListener('click', startGame);

// --- Init ---
best = parseInt((() => {
    try { return localStorage.getItem('maze-best') || '0'; } catch (e) { return '0'; }
})(), 10);
if (!Number.isFinite(best)) best = 0;
bestEl.textContent = best;

level = 1;
score = 0;
state = 'idle';
timeLeft = 0;
COLS = BASE_SIZE;
ROWS = BASE_SIZE;
CELL = Math.floor(CANVAS / BASE_SIZE);
maze = generateMaze(COLS, ROWS);
player = { x: 0, y: 0 };
exit = { x: COLS - 1, y: ROWS - 1 };
updateHud();
draw();
