// -----------------------------------------------------------------------
// Maze. Legend: '#' wall, '.' pellet, 'o' power pellet, 'P' pac start,
// 'G' ghost start, ' ' open (no pellet). The border is fully walled; the
// whole open area is one connected region (validated when authored).
// -----------------------------------------------------------------------
const MAZE = [
    '###################',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o##.###.#.###.##o#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#.##.#...#...#.##.#',
    '#....#.#...#.#....#',
    '####.#.#GGG#.#.####',
    '#......#. .#......#',
    '####.#.#####.#.####',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o.#.........#...o#',
    '##.#.#.#####.#.#.##',
    '#....#...#...#....#',
    '#.######.#.######.#',
    '#........P........#',
    '#.####.#####.####.#',
    '#.................#',
    '###################',
];

const ROWS = MAZE.length;      // 21
const COLS = MAZE[0].length;   // 19
const TILE = 24;
const WIDTH = COLS * TILE;     // 456
const HEIGHT = ROWS * TILE;    // 504

// Timing / scoring
const BASE_STEP = 150;   // ms per one-tile move at level 1
const FRIGHT_MS = 6000;  // power-pellet frightened duration
const POINTS_PELLET = 10;
const POINTS_POWER = 50;
const POINTS_GHOST = 200;

// Directions and a fixed evaluation order for deterministic ghost tie-breaks.
const UP = { dx: 0, dy: -1 };
const DOWN = { dx: 0, dy: 1 };
const LEFT = { dx: -1, dy: 0 };
const RIGHT = { dx: 1, dy: 0 };
const ORDER = [UP, DOWN, LEFT, RIGHT];

// The little foxes (Song of Songs 2:15); the code keeps the genre's name "ghost".
const GHOST_COLORS = ['#e8742c', '#c2410c', '#d97706'];

// Parse fixed spawn points from the maze.
let PAC_START = { col: 9, row: 17 };
const GHOST_HOMES = [];
for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
        const ch = MAZE[r][c];
        if (ch === 'P') PAC_START = { col: c, row: r };
        if (ch === 'G') GHOST_HOMES.push({ col: c, row: r });
    }
}

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let pac, ghosts, pellets, dotsLeft, score, best, lives, level, state;
let frightTimer, stepMs, moveAcc, animT, lastTime, animId;

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
function isWall(col, row) {
    if (row < 0 || col < 0 || row >= ROWS || col >= COLS) return true;
    return MAZE[row][col] === '#';
}

function canMove(col, row, dir) {
    return !isWall(col + dir.dx, row + dir.dy);
}

function buildPellets() {
    pellets = [];
    dotsLeft = 0;
    for (let r = 0; r < ROWS; r++) {
        pellets[r] = [];
        for (let c = 0; c < COLS; c++) {
            const ch = MAZE[r][c];
            if (ch === '.') {
                pellets[r][c] = 1;
                dotsLeft++;
            } else if (ch === 'o') {
                pellets[r][c] = 2;
                dotsLeft++;
            } else {
                pellets[r][c] = 0;
            }
        }
    }
}

function resetPositions() {
    pac = {
        col: PAC_START.col,
        row: PAC_START.row,
        prevCol: PAC_START.col,
        prevRow: PAC_START.row,
        dir: { ...LEFT },
        nextDir: { ...LEFT },
    };
    ghosts = GHOST_HOMES.map((h, i) => ({
        col: h.col,
        row: h.row,
        prevCol: h.col,
        prevRow: h.row,
        dir: { ...UP },
        home: { col: h.col, row: h.row },
        eaten: false,
        color: GHOST_COLORS[i % GHOST_COLORS.length],
    }));
    frightTimer = 0;
}

// -----------------------------------------------------------------------
// HUD
// -----------------------------------------------------------------------
function updateScore() { scoreEl.textContent = score; }
function updateLives() { livesEl.textContent = Math.max(0, lives); }
function updateLevel() { levelEl.textContent = level; }

// -----------------------------------------------------------------------
// Game lifecycle
// -----------------------------------------------------------------------
function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    stepMs = BASE_STEP;
    moveAcc = 0;
    animT = 0;
    buildPellets();
    resetPositions();
    state = 'running';

    updateScore();
    updateLives();
    updateLevel();
    overlay.classList.remove('visible');

    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function nextLevel() {
    level++;
    updateLevel();
    buildPellets();
    resetPositions();
    stepMs = Math.max(80, BASE_STEP - (level - 1) * 12);
    moveAcc = 0;
}

function loseLife() {
    lives--;
    updateLives();
    if (lives <= 0) {
        endGame();
        return;
    }
    resetPositions();
    moveAcc = 0;
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('pacman-best', best);
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} pts`;
    overlaySub.textContent = 'Press Space to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function winWave() {
    // Cleared every pellet — advance to a faster wave.
    nextLevel();
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
// Simulation — everything advances in whole-tile ticks.
// -----------------------------------------------------------------------
function eatAt(col, row) {
    const p = pellets[row][col];
    if (p === 1) {
        pellets[row][col] = 0;
        dotsLeft--;
        score += POINTS_PELLET;
        updateScore();
    } else if (p === 2) {
        pellets[row][col] = 0;
        dotsLeft--;
        score += POINTS_POWER;
        updateScore();
        frightTimer = FRIGHT_MS;
    }
    if (dotsLeft <= 0) winWave();
}

function movePac() {
    if (canMove(pac.col, pac.row, pac.nextDir)) pac.dir = { ...pac.nextDir };
    pac.prevCol = pac.col;
    pac.prevRow = pac.row;
    if (canMove(pac.col, pac.row, pac.dir)) {
        pac.col += pac.dir.dx;
        pac.row += pac.dir.dy;
    }
    eatAt(pac.col, pac.row);
}

function moveGhost(g) {
    // Revive an eaten ghost once its eyes reach home.
    if (g.eaten && g.col === g.home.col && g.row === g.home.row) g.eaten = false;

    const flee = !g.eaten && frightTimer > 0;
    const target = g.eaten ? g.home : { col: pac.col, row: pac.row };
    const rev = { dx: -g.dir.dx, dy: -g.dir.dy };
    const moving = !(g.dir.dx === 0 && g.dir.dy === 0);

    // Prefer not to reverse; only reverse at a dead end.
    let cands = ORDER.filter(
        d => canMove(g.col, g.row, d) && !(moving && d.dx === rev.dx && d.dy === rev.dy)
    );
    if (cands.length === 0) cands = ORDER.filter(d => canMove(g.col, g.row, d));
    if (cands.length === 0) return; // fully boxed in

    let best = cands[0];
    let bestScore = Infinity;
    for (const d of cands) {
        const nc = g.col + d.dx;
        const nr = g.row + d.dy;
        const dist = Math.abs(nc - target.col) + Math.abs(nr - target.row);
        const sc = flee ? -dist : dist;
        if (sc < bestScore) {
            bestScore = sc;
            best = d;
        }
    }
    g.prevCol = g.col;
    g.prevRow = g.row;
    g.dir = best;
    g.col += best.dx;
    g.row += best.dy;
}

function handleCollisions() {
    for (const g of ghosts) {
        const same = g.col === pac.col && g.row === pac.row;
        const swap =
            g.col === pac.prevCol &&
            g.row === pac.prevRow &&
            pac.col === g.prevCol &&
            pac.row === g.prevRow;
        if (!same && !swap) continue;

        if (g.eaten) continue; // just eyes; harmless
        if (frightTimer > 0) {
            score += POINTS_GHOST;
            updateScore();
            g.eaten = true; // becomes eyes, heads home
        } else {
            loseLife();
            return; // positions were reset
        }
    }
}

// Advance the whole world by exactly one tile-tick.
function moveOnce() {
    movePac();
    if (state !== 'running') return; // winWave/loseLife may have reset things
    for (const g of ghosts) moveGhost(g);
    handleCollisions();
}

function step(dt) {
    if (state !== 'running') return;
    if (frightTimer > 0) frightTimer = Math.max(0, frightTimer - dt);
    moveAcc += dt;
    let guard = 0;
    while (moveAcc >= stepMs && state === 'running' && guard < 100) {
        moveAcc -= stepMs;
        moveOnce();
        guard++;
    }
}

// -----------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------
function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = Math.min(50, timestamp - lastTime);
    lastTime = timestamp;

    if (state === 'running') {
        animT += elapsed;
        step(elapsed);
    }

    draw();

    if (state === 'running') {
        animId = requestAnimationFrame(loop);
    }
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function lerp(a, b, t) { return a + (b - a) * t; }

function tileCenter(e) {
    const frac = stepMs ? Math.min(1, moveAcc / stepMs) : 0;
    return {
        x: (lerp(e.prevCol, e.col, frac) + 0.5) * TILE,
        y: (lerp(e.prevRow, e.row, frac) + 0.5) * TILE,
    };
}

function draw() {
    ctx.fillStyle = '#3d3214';            // harvested field
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Walls
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (MAZE[r][c] === '#') {
                ctx.fillStyle = '#3f6b2e';    // hedgerows
                ctx.strokeStyle = '#6a9a4a';
                ctx.lineWidth = 2;
                const x = c * TILE;
                const y = r * TILE;
                ctx.beginPath();
                ctx.roundRect(x + 2, y + 2, TILE - 4, TILE - 4, 5);
                ctx.fill();
                ctx.stroke();
            }
        }
    }

    // Pellets
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const p = pellets[r][c];
            if (!p) continue;
            const x = (c + 0.5) * TILE;
            const y = (r + 0.5) * TILE;
            ctx.beginPath();
            if (p === 2) {
                // an oil lamp with a flickering flame
                const blink = Math.floor(animT / 250) % 2 === 0 ? 1 : 0.7;
                ctx.fillStyle = '#b5652d';
                ctx.ellipse(x, y + 2, 6, 3.5, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffd166';
                ctx.beginPath();
                ctx.ellipse(x + 3, y - 3, 2.2 * blink, 4 * blink, 0, 0, Math.PI * 2);
            } else {
                // a grain of barley
                ctx.fillStyle = '#f5d48a';
                ctx.ellipse(x, y, 1.6, 3, 0.5, 0, Math.PI * 2);
            }
            ctx.fill();
        }
    }

    // Ghosts
    for (const g of ghosts) drawGhost(g);

    // Pac-Man
    if (pac) drawPac();
}

// Ruth the gleaner: a face framed by a blue head covering, facing her way.
function drawPac() {
    const { x, y } = tileCenter(pac);
    const rad = TILE * 0.42;
    const step = Math.sin(animT / 90) * 1.2;

    ctx.fillStyle = '#3b6fb6';            // head covering
    ctx.shadowColor = '#fde68aaa';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y + step * 0.3, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#f2c9a0';            // face
    ctx.beginPath();
    ctx.arc(x + pac.dir.dx * rad * 0.18, y + pac.dir.dy * rad * 0.18 + step * 0.3, rad * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b2a1f';            // eyes, looking where she walks
    for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + s * rad * 0.22 + pac.dir.dx * rad * 0.3, y - rad * 0.08 + pac.dir.dy * rad * 0.3, rad * 0.09, 0, Math.PI * 2);
        ctx.fill();
    }
}

// A little fox: pointed ears, a pale muzzle and a bushy tail. A frightened
// fox turns grey and flees; a caught fox shows only its eyes running home.
function drawGhost(g) {
    const { x, y } = tileCenter(g);
    const rad = TILE * 0.42;
    const frightened = !g.eaten && frightTimer > 0;

    if (!g.eaten) {
        let body = g.color;
        if (frightened) {
            // Flash near the end of the frightened window.
            const ending = frightTimer < 1500 && Math.floor(frightTimer / 200) % 2 === 0;
            body = ending ? '#e6edf3' : '#8a94a6';
        }
        ctx.fillStyle = body;
        // tail
        ctx.beginPath();
        ctx.ellipse(x - rad * 0.75, y + rad * 0.45, rad * 0.45, rad * 0.22, -0.6, 0, Math.PI * 2);
        ctx.fill();
        // head
        ctx.beginPath();
        ctx.arc(x, y, rad * 0.8, 0, Math.PI * 2);
        ctx.fill();
        // ears
        for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(x + s * rad * 0.75, y - rad * 0.2);
            ctx.lineTo(x + s * rad * 0.55, y - rad * 1.05);
            ctx.lineTo(x + s * rad * 0.15, y - rad * 0.65);
            ctx.closePath();
            ctx.fill();
        }
        // muzzle
        ctx.fillStyle = '#fff7ed';
        ctx.beginPath();
        ctx.ellipse(x, y + rad * 0.35, rad * 0.38, rad * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1f1610';
        ctx.beginPath();
        ctx.arc(x, y + rad * 0.3, rad * 0.1, 0, Math.PI * 2);
        ctx.fill();
    }

    // Eyes (always drawn; for caught foxes, only eyes show)
    const ex = Math.sign(g.dir.dx) * 1.5;
    const ey = Math.sign(g.dir.dy) * 1.5;
    for (const s of [-1, 1]) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x + s * rad * 0.3, y - rad * 0.2, rad * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1f1610';
        ctx.beginPath();
        ctx.arc(x + s * rad * 0.3 + ex, y - rad * 0.2 + ey, rad * 0.1, 0, Math.PI * 2);
        ctx.fill();
    }
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
const START_KEYS = [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'W', 'a', 'A', 's', 'S', 'd', 'D'];

function dirForKey(k) {
    if (k === 'ArrowUp' || k === 'w' || k === 'W') return UP;
    if (k === 'ArrowDown' || k === 's' || k === 'S') return DOWN;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') return LEFT;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') return RIGHT;
    return null;
}

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

    if (state === 'running') {
        const d = dirForKey(k);
        if (d) {
            pac.nextDir = { ...d };
            e.preventDefault();
        }
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
best = parseInt(localStorage.getItem('pacman-best') || '0', 10);
bestEl.textContent = best;
score = 0;
lives = 3;
level = 1;
stepMs = BASE_STEP;
moveAcc = 0;
animT = 0;
state = 'idle';
buildPellets();
resetPositions();
draw();
