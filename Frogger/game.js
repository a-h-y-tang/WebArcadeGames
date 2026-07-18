// ---------------------------------------------------------------------------
// Frogger — hop across a busy road and a log-strewn river to the home bays.
// Top-level declarations live in the page's global scope so the Playwright
// suite can drive and inspect the game directly (same convention as the other
// games in this repo).
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const COLS = 13;
const ROWS = 13;
const CELL = 40;
const W = COLS * CELL; // 520
const H = ROWS * CELL; // 520

const START_COL = 6;            // frog spawns in the middle column
const BAY_COLS = [2, 4, 6, 8, 10]; // five home bays across the goal row (row 0)
const START_LIVES = 3;

const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// Static lane definitions — no randomness, so the world is reproducible.
// row, type, direction (+1 right / −1 left), base speed (px/s), count, length (cells)
const LANES = [
    { row: 1, type: 'log', dir:  1, speed: 55, count: 2, len: 3 },
    { row: 2, type: 'log', dir: -1, speed: 90, count: 3, len: 2 },
    { row: 3, type: 'log', dir:  1, speed: 70, count: 2, len: 4 },
    { row: 4, type: 'log', dir: -1, speed: 100, count: 3, len: 2 },
    { row: 5, type: 'log', dir:  1, speed: 60, count: 2, len: 3 },
    // row 6 is the safe median
    { row: 7,  type: 'car', dir: -1, speed: 110, count: 3, len: 1 },
    { row: 8,  type: 'car', dir:  1, speed: 80,  count: 2, len: 2 },
    { row: 9,  type: 'car', dir: -1, speed: 135, count: 3, len: 1 },
    { row: 10, type: 'car', dir:  1, speed: 95,  count: 2, len: 2 },
    { row: 11, type: 'car', dir: -1, speed: 105, count: 3, len: 1 },
];

const COLORS = {
    grass: '#14432a',
    road: '#1c2128',
    water: '#0e3a5c',
    goal: '#0d2818',
    lane: '#ffffff10',
    log: '#8b5a2b',
    logDark: '#6b4423',
    bayEmpty: '#0a3d24',
    frog: '#4ade80',
    frogDark: '#16a34a',
    cars: ['#ef4444', '#f59e0b', '#eab308', '#38bdf8', '#a78bfa'],
};

// --- State ---
let frog, obstacles, bays, score, best, lives, level, maxRow, state, lastTime, animId;

function rowType(row) {
    if (row === 0) return 'goal';
    if (row >= 1 && row <= 5) return 'water';
    if (row >= 7 && row <= 11) return 'road';
    return 'safe'; // rows 6 and 12
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function buildObstacles() {
    obstacles = [];
    let carColor = 0;
    for (const L of LANES) {
        const speed = L.speed * (1 + (level - 1) * 0.15);
        const w = L.len * CELL;
        const gap = W / L.count;
        for (let i = 0; i < L.count; i++) {
            obstacles.push({
                row: L.row,
                x: i * gap,
                w,
                dir: L.dir,
                speed,
                type: L.type,
                color: L.type === 'car' ? COLORS.cars[carColor++ % COLORS.cars.length] : COLORS.log,
            });
        }
    }
}

function resetFrog() {
    frog = { x: START_COL * CELL, y: (ROWS - 1) * CELL };
    maxRow = ROWS - 1;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function moveFrog(dx, dy) {
    if (state !== 'running') return;

    let nx = frog.x + dx * CELL;
    let ny = frog.y + dy * CELL;

    // Clamp horizontally and to the bottom start row; the top edge is the goal.
    nx = Math.max(0, Math.min((COLS - 1) * CELL, nx));
    ny = Math.min((ROWS - 1) * CELL, ny);
    if (ny < 0) ny = 0;

    frog.x = nx;
    frog.y = ny;

    const row = Math.round(frog.y / CELL);
    if (row === 0) {
        resolveGoal();
        return;
    }
    // Award points for reaching a row nearer the goal than ever this trip.
    if (row < maxRow) {
        maxRow = row;
        score += 10;
        scoreEl.textContent = score;
    }
}

function resolveGoal() {
    const col = Math.round(frog.x / CELL);
    const bi = BAY_COLS.indexOf(col);
    if (bi >= 0 && !bays[bi]) {
        bays[bi] = true;
        score += 50;
        if (bays.every(Boolean)) {
            // Whole set complete: bonus, next (faster) level, fresh bays.
            score += 100;
            level++;
            bays = bays.map(() => false);
            buildObstacles();
        }
        scoreEl.textContent = score;
        resetFrog();
    } else {
        die();
    }
}

function die() {
    lives--;
    livesEl.textContent = Math.max(0, lives);
    if (lives <= 0) {
        endGame();
        return;
    }
    resetFrog();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function frogCenterX() {
    return frog.x + CELL / 2;
}

function onObstacle(o) {
    const fc = frogCenterX();
    return fc >= o.x && fc <= o.x + o.w;
}

function update(dt) {
    // Move every obstacle and wrap it around the screen edges.
    for (const o of obstacles) {
        o.x += o.dir * o.speed * dt;
        if (o.dir > 0 && o.x > W) o.x = -o.w;
        else if (o.dir < 0 && o.x + o.w < 0) o.x = W;
    }

    const row = Math.round(frog.y / CELL);
    const type = rowType(row);

    if (type === 'road') {
        for (const o of obstacles) {
            if (o.row === row && onObstacle(o)) {
                die();
                return;
            }
        }
    } else if (type === 'water') {
        let log = null;
        for (const o of obstacles) {
            if (o.row === row && onObstacle(o)) { log = o; break; }
        }
        if (log) {
            frog.x += log.dir * log.speed * dt;
            if (frog.x < 0 || frog.x > (COLS - 1) * CELL) {
                die();
                return;
            }
        } else {
            die();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    // Lane backgrounds
    for (let r = 0; r < ROWS; r++) {
        const t = rowType(r);
        ctx.fillStyle = t === 'water' ? COLORS.water
            : t === 'road' ? COLORS.road
            : t === 'goal' ? COLORS.goal
            : COLORS.grass;
        ctx.fillRect(0, r * CELL, W, CELL);
    }

    // Home bays on the goal row
    for (let i = 0; i < BAY_COLS.length; i++) {
        const x = BAY_COLS[i] * CELL;
        ctx.fillStyle = COLORS.bayEmpty;
        roundRect(x + 3, 3, CELL - 6, CELL - 6, 6);
        ctx.fill();
        if (bays[i]) drawFrogShape(x, 0, COLORS.frogDark);
    }

    // Obstacles
    for (const o of obstacles) {
        const y = o.row * CELL;
        if (o.type === 'log') {
            ctx.fillStyle = COLORS.log;
            roundRect(o.x, y + 5, o.w, CELL - 10, 8);
            ctx.fill();
            ctx.strokeStyle = COLORS.logDark;
            ctx.lineWidth = 2;
            for (let gx = o.x + CELL; gx < o.x + o.w; gx += CELL) {
                ctx.beginPath();
                ctx.moveTo(gx, y + 6);
                ctx.lineTo(gx, y + CELL - 6);
                ctx.stroke();
            }
        } else {
            ctx.fillStyle = o.color;
            roundRect(o.x + 3, y + 6, o.w - 6, CELL - 12, 5);
            ctx.fill();
        }
    }

    // Frog
    if (state !== 'idle') drawFrogShape(frog.x, frog.y, COLORS.frog);
    else drawFrogShape(frog.x, frog.y, COLORS.frog);
}

function drawFrogShape(x, y, color) {
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    ctx.fillStyle = color;
    roundRect(x + 6, y + 6, CELL - 12, CELL - 12, 8);
    ctx.fill();
    // Eyes
    ctx.fillStyle = '#0d1117';
    ctx.beginPath();
    ctx.arc(cx - 5, cy - 5, 2.4, 0, Math.PI * 2);
    ctx.arc(cx + 5, cy - 5, 2.4, 0, Math.PI * 2);
    ctx.fill();
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------

function loop(ts) {
    if (state !== 'running') return;
    if (lastTime == null) lastTime = ts;
    let dt = (ts - lastTime) / 1000;
    lastTime = ts;
    if (dt > 0.05) dt = 0.05;

    update(dt);
    draw();
    animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    bays = BAY_COLS.map(() => false);
    buildObstacles();
    resetFrog();
    state = 'running';
    lastTime = null;

    scoreEl.textContent = score;
    livesEl.textContent = lives;
    overlay.classList.remove('visible');

    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('frogger-best', best);
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} pts`;
    overlaySub.textContent = 'Press an arrow key or WASD to play again';
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
    cancelAnimationFrame(animId);
}

function resumeGame() {
    state = 'running';
    lastTime = null;
    overlay.classList.remove('visible');
    animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const MOVES = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
};

function normKey(k) {
    return k.length === 1 ? k.toLowerCase() : k;
}

document.addEventListener('keydown', e => {
    const k = normKey(e.key);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
    }

    // Pause toggle
    if (k === 'p') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    // Start / restart from the idle or game-over screen
    if (state === 'idle' || state === 'over') {
        if (MOVES[k]) startGame();
        return;
    }

    if (state === 'paused') return; // ignore hops while paused

    // Running: hop
    if (MOVES[k]) {
        const [dx, dy] = MOVES[k];
        moveFrog(dx, dy);
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init — seed a world so the idle start screen has something behind the
// overlay, then draw one frame.
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('frogger-best') || '0', 10);
bestEl.textContent = best;

score = 0;
lives = START_LIVES;
level = 1;
bays = BAY_COLS.map(() => false);
buildObstacles();
resetFrog();
state = 'idle';
draw();
