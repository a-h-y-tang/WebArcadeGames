// ===========================================================================
// Q*bert — an isometric cube-hopping arcade game on HTML5 canvas.
// All state and helpers live at the top level so the Playwright suite can drive
// and inspect the game directly (the convention used across this repo).
// ===========================================================================

// --- Board geometry ---
const ROWS = 7;          // pyramid rows (apex = row 0); 28 cubes total
const TARGET = 1;        // colour level a cube must reach to count as complete

const HW = 40;           // half-width of a cube's top face (2:1 isometric)
const HH = 20;           // half-height of the top face
const SH = 44;           // height of a cube's front (side) faces
const V_STEP = HH + SH;  // vertical distance between successive rows
const ORIGIN_X = 310;    // screen position of the apex cube's centre
const ORIGIN_Y = 96;

// --- Colours ---
const CLR = {
    bg: '#05070d',
    cubeTop0: '#3b82f6', cubeLeft0: '#1e40af', cubeRight0: '#16308a',
    cubeTop1: '#fbbf24', cubeLeft1: '#b45309', cubeRight1: '#8a3d06',
    qbert: '#f97316', qbertDark: '#c2410c', qbertFoot: '#7c2d12',
    enemy: '#ef4444', enemyDark: '#991b1b',
    eye: '#ffffff', pupil: '#111111',
    shadow: 'rgba(0,0,0,0.35)',
};

// --- Direction map (classic 45°-rotated joystick) ---
const KEY_DIR = {
    ArrowUp: 'upRight', w: 'upRight', W: 'upRight',
    ArrowRight: 'downRight', d: 'downRight', D: 'downRight',
    ArrowDown: 'downLeft', s: 'downLeft', S: 'downLeft',
    ArrowLeft: 'upLeft', a: 'upLeft', A: 'upLeft',
};

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
let cubes;              // cubes[r][c] -> colour level
let qbert;             // { r, c, px, py, animFrom, animTo, animStart }
let enemies;           // [{ r, c, px, py, animFrom, animTo, animStart }]
let state;             // 'idle' | 'running' | 'paused' | 'over' | 'won'
let score, best, lives, level;
let autoSpawn;         // enemy spawner on/off (suspended by tests)
let spawnMs, enemyHopMs;
let lastSpawn, lastEnemyHop, lastTime;

const HOP_MS = 130;    // visual jump duration

// --- Geometry helpers ---
function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c <= r;
}

function neighborOf(r, c, dir) {
    switch (dir) {
        case 'upLeft':    return { r: r - 1, c: c - 1 };
        case 'upRight':   return { r: r - 1, c: c };
        case 'downLeft':  return { r: r + 1, c: c };
        case 'downRight': return { r: r + 1, c: c + 1 };
    }
    return { r, c };
}

function cubeCenter(r, c) {
    return {
        x: ORIGIN_X + (2 * c - r) * HW,
        y: ORIGIN_Y + r * V_STEP,
    };
}

// Point where a creature standing on cube (r,c) rests (a little above centre).
function standPoint(r, c) {
    const p = cubeCenter(r, c);
    return { x: p.x, y: p.y - 14 };
}

function completedCount() {
    let n = 0;
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c <= r; c++)
            if (cubes[r][c] >= TARGET) n++;
    return n;
}

// --- Setup ---
function makeCubes() {
    const grid = [];
    for (let r = 0; r < ROWS; r++) grid.push(new Array(r + 1).fill(0));
    return grid;
}

function placeQbert(r, c) {
    const p = standPoint(r, c);
    qbert = { r, c, px: p.x, py: p.y, animFrom: null, animTo: null, animStart: 0 };
}

function resetLevel() {
    cubes = makeCubes();
    cubes[0][0] = TARGET;   // apex is coloured because Q*bert stands on it
    enemies = [];
    placeQbert(0, 0);
    spawnMs = Math.max(1400, 3200 - (level - 1) * 400);
    enemyHopMs = Math.max(320, 620 - (level - 1) * 60);
    lastSpawn = lastEnemyHop = lastTime = 0;
}

function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    autoSpawn = true;
    resetLevel();
    state = 'running';
    hideOverlay();
    syncHud();
}

function nextLevel() {
    level += 1;
    resetLevel();
    state = 'running';
    hideOverlay();
    syncHud();
}

// --- Core actions ---
function hop(dir) {
    if (state !== 'running') return;
    const n = neighborOf(qbert.r, qbert.c, dir);

    if (!inBounds(n.r, n.c)) {   // hopped off the pyramid
        loseLife();
        return;
    }

    moveQbertTo(n.r, n.c);

    // Colour the cube on arrival.
    if (cubes[n.r][n.c] < TARGET) {
        cubes[n.r][n.c] = TARGET;
        score += 25;
        syncHud();
        if (completedCount() === totalCubes()) {
            winLevel();
            return;
        }
    }

    // Collision with an enemy already on this cube.
    if (enemies.some(e => e.r === qbert.r && e.c === qbert.c)) {
        loseLife();
    }
}

function moveQbertTo(r, c) {
    const from = { x: qbert.px, y: qbert.py };
    const to = standPoint(r, c);
    qbert.r = r;
    qbert.c = c;
    qbert.animFrom = from;
    qbert.animTo = to;
    qbert.animStart = lastTime;
}

function totalCubes() {
    return (ROWS * (ROWS + 1)) / 2;
}

function loseLife() {
    lives -= 1;
    syncHud();
    if (lives <= 0) {
        gameOver();
        return;
    }
    // Respawn on the apex; keep coloured cubes, clear enemies.
    enemies = [];
    placeQbert(0, 0);
}

function winLevel() {
    state = 'won';
    if (score > best) { best = score; saveBest(); }
    syncHud();
    showOverlay(`Level ${level} Complete!`, `${score}`,
        'Press any key for the next level', 'Continue');
}

function gameOver() {
    state = 'over';
    if (score > best) { best = score; saveBest(); }
    syncHud();
    showOverlay('Game Over', `${score}`, 'Press any key to play again', 'Play Again');
}

// --- Enemies ---
function spawnEnemy(r, c) {
    if (r === undefined) {
        // Random top-ish spawn: apex or one of row-1's cubes.
        const opts = [{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 1, c: 1 }];
        const pick = opts[Math.floor(Math.random() * opts.length)];
        r = pick.r; c = pick.c;
    }
    const p = standPoint(r, c);
    enemies.push({ r, c, px: p.x, py: p.y, animFrom: null, animTo: null, animStart: 0 });
}

function hopEnemies() {
    for (const e of enemies) {
        const dirs = [];
        if (inBounds(e.r + 1, e.c)) dirs.push('downLeft');
        if (inBounds(e.r + 1, e.c + 1)) dirs.push('downRight');
        if (dirs.length === 0) { e.done = true; continue; }
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        const n = neighborOf(e.r, e.c, dir);
        const from = { x: e.px, y: e.py };
        const to = standPoint(n.r, n.c);
        e.r = n.r; e.c = n.c;
        e.animFrom = from; e.animTo = to; e.animStart = lastTime;
    }
    enemies = enemies.filter(e => !e.done && e.r < ROWS);
    // Any enemy landing on Q*bert costs a life.
    if (enemies.some(e => e.r === qbert.r && e.c === qbert.c)) {
        loseLife();
    }
}

// --- HUD & overlay ---
function syncHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
    livesEl.textContent = Math.max(0, lives);
    levelEl.textContent = level;
}

function showOverlay(title, scoreText, sub, btn) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText || '';
    overlaySub.textContent = sub;
    btnStart.textContent = btn;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// --- Persistence ---
function loadBest() {
    const v = parseInt(localStorage.getItem('qbert-best') || '0', 10);
    return Number.isFinite(v) ? v : 0;
}
function saveBest() {
    try { localStorage.setItem('qbert-best', String(best)); } catch (_) {}
}

// --- Rendering ---
function drawCube(r, c) {
    const p = cubeCenter(r, c);
    const coloured = cubes[r][c] >= TARGET;
    const top = coloured ? CLR.cubeTop1 : CLR.cubeTop0;
    const left = coloured ? CLR.cubeLeft1 : CLR.cubeLeft0;
    const right = coloured ? CLR.cubeRight1 : CLR.cubeRight0;

    // Left face
    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(p.x - HW, p.y);
    ctx.lineTo(p.x, p.y + HH);
    ctx.lineTo(p.x, p.y + HH + SH);
    ctx.lineTo(p.x - HW, p.y + SH);
    ctx.closePath();
    ctx.fill();

    // Right face
    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(p.x + HW, p.y);
    ctx.lineTo(p.x, p.y + HH);
    ctx.lineTo(p.x, p.y + HH + SH);
    ctx.lineTo(p.x + HW, p.y + SH);
    ctx.closePath();
    ctx.fill();

    // Top face
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - HH);
    ctx.lineTo(p.x + HW, p.y);
    ctx.lineTo(p.x, p.y + HH);
    ctx.lineTo(p.x - HW, p.y);
    ctx.closePath();
    ctx.fill();
}

function drawShadow(cx, cy) {
    ctx.fillStyle = CLR.shadow;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 12, 16, 7, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawQbert(x, y) {
    drawShadow(x, y);
    // Body
    ctx.fillStyle = CLR.qbert;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();
    // Snout
    ctx.fillStyle = CLR.qbertDark;
    ctx.beginPath();
    ctx.ellipse(x, y + 6, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Eyes
    ctx.fillStyle = CLR.eye;
    ctx.beginPath();
    ctx.arc(x - 6, y - 5, 5, 0, Math.PI * 2);
    ctx.arc(x + 6, y - 5, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CLR.pupil;
    ctx.beginPath();
    ctx.arc(x - 4, y - 4, 2.2, 0, Math.PI * 2);
    ctx.arc(x + 8, y - 4, 2.2, 0, Math.PI * 2);
    ctx.fill();
}

function drawEnemy(x, y) {
    drawShadow(x, y);
    const g = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, 15);
    g.addColorStop(0, CLR.enemy);
    g.addColorStop(1, CLR.enemyDark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
}

// Interpolated sprite position, with a parabolic jump arc.
function spritePos(sprite, now) {
    if (!sprite.animFrom) return { x: sprite.px, y: sprite.py };
    const t = Math.min(1, (now - sprite.animStart) / HOP_MS);
    const x = sprite.animFrom.x + (sprite.animTo.x - sprite.animFrom.x) * t;
    const y = sprite.animFrom.y + (sprite.animTo.y - sprite.animFrom.y) * t;
    const lift = Math.sin(t * Math.PI) * 22;
    if (t >= 1) { sprite.px = sprite.animTo.x; sprite.py = sprite.animTo.y; sprite.animFrom = null; }
    return { x, y: y - lift };
}

function render(now) {
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Cubes drawn back-to-front (top rows first) so lower cubes overlap.
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c <= r; c++)
            drawCube(r, c);

    // Enemies then Q*bert.
    for (const e of enemies) {
        const p = spritePos(e, now);
        drawEnemy(p.x, p.y);
    }
    const q = spritePos(qbert, now);
    drawQbert(q.x, q.y);
}

// --- Main loop ---
function loop(now) {
    lastTime = now;
    if (state === 'running') {
        if (autoSpawn && enemies.length < 3 && now - lastSpawn > spawnMs) {
            spawnEnemy();
            lastSpawn = now;
        }
        if (now - lastEnemyHop > enemyHopMs) {
            if (enemies.length) hopEnemies();
            lastEnemyHop = now;
        }
    }
    render(now);
    requestAnimationFrame(loop);
}

// --- Input ---
function onKey(e) {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running') {
            state = 'paused';
            showOverlay('Paused', '', 'Press P to resume', 'Resume');
        } else if (state === 'paused') {
            state = 'running';
            lastSpawn = lastEnemyHop = lastTime;
            hideOverlay();
        }
        e.preventDefault();
        return;
    }

    if (state === 'idle') {
        if (KEY_DIR[k]) { startGame(); e.preventDefault(); }
        return;
    }
    if (state === 'over') { startGame(); e.preventDefault(); return; }
    if (state === 'won') { nextLevel(); e.preventDefault(); return; }

    if (state === 'running' && KEY_DIR[k]) {
        hop(KEY_DIR[k]);
        e.preventDefault();
    }
}

function onButton() {
    if (state === 'idle' || state === 'over') startGame();
    else if (state === 'won') nextLevel();
    else if (state === 'paused') {
        state = 'running';
        lastSpawn = lastEnemyHop = lastTime;
        hideOverlay();
    }
}

// --- Boot ---
function init() {
    best = loadBest();
    score = 0;
    lives = 3;
    level = 1;
    autoSpawn = true;
    cubes = makeCubes();       // apex uncoloured while idle
    placeQbert(0, 0);
    enemies = [];
    spawnMs = 3200;
    enemyHopMs = 620;
    lastSpawn = lastEnemyHop = lastTime = 0;
    state = 'idle';
    syncHud();
    showOverlay('Q*bert', '', 'Press an arrow key or WASD to start', 'Start Game');
    window.addEventListener('keydown', onKey);
    btnStart.addEventListener('click', onButton);
    requestAnimationFrame(loop);
}

init();
