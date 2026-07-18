// --- Field & object dimensions ---
const WIDTH = 600;
const HEIGHT = 500;
const groundY = HEIGHT - 40;   // y of the lunar surface

const LANDER_W = 22;
const LANDER_H = 24;

// Motion is expressed in pixels-per-millisecond so play is frame-rate
// independent. Accelerations are px / ms².
const GRAVITY_BASE = 0.00004;  // downward pull at level 1
const THRUST = 0.00013;        // main-engine acceleration (must beat gravity)
const ROT_SPEED = 0.0026;      // radians per ms
const FUEL_START = 1000;
const FUEL_BURN = 0.14;        // fuel units per ms while thrusting

// Touchdown tolerances — exceed any of them and the module is wrecked.
const MAX_LAND_VX = 0.03;
const MAX_LAND_VY = 0.06;
const MAX_LAND_ANGLE = 0.25;   // radians from upright (~14°)

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const fuelEl = document.getElementById('fuel');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let lander, pad, score, best, lives, level, state, lastTime, animId;
let rotInput = 0;              // -1 / 0 / 1, set from the keyboard each frame
const keys = {};

// A fixed star field, generated once so the backdrop is stable (no per-frame RNG).
const stars = [];
(function seedStars() {
    let s = 1234567;
    const rnd = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
    for (let i = 0; i < 70; i++) {
        stars.push({ x: rnd() * WIDTH, y: rnd() * (groundY - 20), r: rnd() * 1.2 + 0.2 });
    }
})();

// -----------------------------------------------------------------------
// Setup helpers
// -----------------------------------------------------------------------
function gravityForLevel(lvl) {
    return GRAVITY_BASE * (1 + (lvl - 1) * 0.12);
}

function resetLander() {
    lander = {
        x: WIDTH / 2,
        y: 60,
        vx: 0,
        vy: 0,
        angle: 0,
        fuel: FUEL_START,
        thrusting: false,
    };
}

function placePad() {
    const w = Math.max(50, 110 - (level - 1) * 12);
    const x = 20 + Math.random() * (WIDTH - w - 40);
    pad = { x, w, y: groundY };
}

function normalizeAngle(a) {
    a %= Math.PI * 2;
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    return a;
}

function updateFuelHud() {
    fuelEl.textContent = Math.max(0, Math.ceil((lander.fuel / FUEL_START) * 100));
}

// -----------------------------------------------------------------------
// Game lifecycle
// -----------------------------------------------------------------------
function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    placePad();
    resetLander();
    state = 'running';

    scoreEl.textContent = score;
    livesEl.textContent = lives;
    levelEl.textContent = level;
    updateFuelHud();
    overlay.classList.remove('visible');

    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function landSuccess() {
    const bonus = 50 + level * 10 + Math.floor(lander.fuel / 20);
    score += bonus;
    scoreEl.textContent = score;
    level++;
    levelEl.textContent = level;
    placePad();
    resetLander();
    updateFuelHud();
}

function crash() {
    lives--;
    livesEl.textContent = Math.max(0, lives);
    if (lives <= 0) {
        endGame();
        return;
    }
    resetLander();  // retry the same level
    updateFuelHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('lunar-lander-best', best);
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
// Physics — advance the world by dt milliseconds
// -----------------------------------------------------------------------
function resolveTouchdown() {
    lander.y = groundY - LANDER_H / 2;
    const overPad = lander.x >= pad.x && lander.x <= pad.x + pad.w;
    const angle = normalizeAngle(lander.angle);
    const safe =
        Math.abs(lander.vx) <= MAX_LAND_VX &&
        lander.vy <= MAX_LAND_VY &&
        Math.abs(angle) <= MAX_LAND_ANGLE;

    if (overPad && safe) {
        landSuccess();
    } else {
        crash();
    }
}

function step(dt) {
    if (state !== 'running') return;

    // Rotation
    lander.angle += rotInput * ROT_SPEED * dt;

    // Thrust (only with fuel)
    if (lander.thrusting && lander.fuel > 0) {
        lander.vx += Math.sin(lander.angle) * THRUST * dt;
        lander.vy += -Math.cos(lander.angle) * THRUST * dt;
        lander.fuel = Math.max(0, lander.fuel - FUEL_BURN * dt);
    }

    // Gravity
    lander.vy += gravityForLevel(level) * dt;

    // Integrate
    lander.x += lander.vx * dt;
    lander.y += lander.vy * dt;

    // Side walls — clamp, don't wrap
    if (lander.x < 0) { lander.x = 0; lander.vx = 0; }
    if (lander.x > WIDTH) { lander.x = WIDTH; lander.vx = 0; }

    // Ceiling
    if (lander.y < LANDER_H / 2) {
        lander.y = LANDER_H / 2;
        if (lander.vy < 0) lander.vy = 0;
    }

    // Ground
    if (lander.y + LANDER_H / 2 >= groundY) {
        resolveTouchdown();
    }

    updateFuelHud();
}

// -----------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------
function readInput() {
    lander.thrusting = !!(keys['ArrowUp'] || keys['w'] || keys['W'] || keys[' ']);
    rotInput = 0;
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) rotInput -= 1;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) rotInput += 1;
}

function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = Math.min(50, timestamp - lastTime); // clamp big frame gaps
    lastTime = timestamp;

    if (state === 'running') {
        readInput();
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
function draw() {
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Stars
    ctx.fillStyle = '#8ea3bd';
    for (const s of stars) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Surface
    ctx.strokeStyle = '#3b4a5a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(WIDTH, groundY);
    ctx.stroke();

    // Landing pad
    ctx.fillStyle = '#38f28d';
    ctx.shadowColor = '#38f28daa';
    ctx.shadowBlur = 10;
    ctx.fillRect(pad.x, pad.y - 3, pad.w, 6);
    ctx.shadowBlur = 0;

    drawLander();
}

function drawLander() {
    const flying = state === 'running' || state === 'paused' || state === 'over';
    if (!flying && state !== 'idle') return;

    ctx.save();
    ctx.translate(lander.x, lander.y);
    ctx.rotate(lander.angle);

    // Flame
    if (lander.thrusting && lander.fuel > 0 && state === 'running') {
        ctx.fillStyle = '#ffb347';
        ctx.beginPath();
        ctx.moveTo(-5, LANDER_H / 2);
        ctx.lineTo(5, LANDER_H / 2);
        ctx.lineTo(0, LANDER_H / 2 + 12);
        ctx.closePath();
        ctx.fill();
    }

    // Body (capsule triangle)
    ctx.fillStyle = '#d6e2f0';
    ctx.beginPath();
    ctx.moveTo(0, -LANDER_H / 2);
    ctx.lineTo(LANDER_W / 2, LANDER_H / 4);
    ctx.lineTo(-LANDER_W / 2, LANDER_H / 4);
    ctx.closePath();
    ctx.fill();

    // Legs
    ctx.strokeStyle = '#8ab4f8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-LANDER_W / 2 + 2, LANDER_H / 4);
    ctx.lineTo(-LANDER_W / 2 - 3, LANDER_H / 2);
    ctx.moveTo(LANDER_W / 2 - 2, LANDER_H / 4);
    ctx.lineTo(LANDER_W / 2 + 3, LANDER_H / 2);
    ctx.stroke();

    ctx.restore();
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
const START_KEYS = [' ', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'w', 'W', 'a', 'A', 'd', 'D'];
const CONTROL_KEYS = [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'w', 'W', 's', 'S', 'a', 'A', 'd', 'D'];

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

    if (state === 'running' && CONTROL_KEYS.includes(k)) {
        keys[k] = true;
        e.preventDefault();
    }
});

document.addEventListener('keyup', e => {
    keys[e.key] = false;
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
best = parseInt(localStorage.getItem('lunar-lander-best') || '0', 10);
bestEl.textContent = best;
score = 0;
lives = 3;
level = 1;
state = 'idle';
placePad();
resetLander();
updateFuelHud();
draw();
