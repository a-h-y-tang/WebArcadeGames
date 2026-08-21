// ---------------------------------------------------------------------------
// Peg Blast — a Peggle-style aim-and-drop physics game on an HTML5 canvas.
//
// A cannon at the top of the board swings left and right; firing drops a ball
// that ricochets down through a field of pegs under gravity. Blue pegs are
// points, orange pegs are the targets — clear every orange peg to finish the
// level. A bucket slides along the bottom and returns any ball it catches.
//
// Written as a single classic (non-module) script so state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Slime
// Volley, Kaboom and Tetris in this repo. All motion is expressed per second
// and advanced through `step(dt)` in fixed sub-steps, so the simulation is
// frame-rate independent and tests can drive it deterministically.
// ---------------------------------------------------------------------------

// --- Board geometry ---
const CANVAS_W = 640;
const CANVAS_H = 720;
const CANNON_X = CANVAS_W / 2;
const CANNON_Y = 48;
const CANNON_LEN = 34;              // barrel length, drawing only

// --- Ball ---
const BALL_R = 8;
const GRAVITY = 760;                // px/s² pulling the ball down
const LAUNCH_SPEED = 340;           // px/s the cannon imparts
const MAX_SPEED = 1150;             // px/s ceiling, so a lucky chain stays sane
const PEG_RESTITUTION = 0.72;       // bounciness of a peg
const WALL_RESTITUTION = 0.85;      // ...and of the walls and ceiling
const SUB_DT = 1 / 240;             // physics sub-step
const MAX_SHOT_TIME = 20;           // seconds before a wedged ball is released

// --- Pegs ---
const PEG_R = 10;
const ORANGE_TARGET = 12;           // orange pegs per level
const BLUE_POINTS = 10;
const ORANGE_POINTS = 100;
// Multiplier thresholds, richest first: [oranges cleared, multiplier].
const MULTIPLIER_STEPS = [[ORANGE_TARGET, 10], [11, 5], [8, 3], [4, 2]];

// --- Aiming ---
const AIM_LIMIT = (75 * Math.PI) / 180;   // ±75° from straight down
const AIM_SPEED = 1.1;                    // radians/s while a key is held

// --- Bucket ---
const BUCKET_W = 96;
const BUCKET_H = 24;
const BUCKET_Y = CANVAS_H - 46;
const BUCKET_SPEED = 150;           // px/s

// --- Run ---
const BALLS_PER_LEVEL = 10;
const CLEAR_BONUS_PER_BALL = 500;
const BEST_KEY = 'peg-blast-best';

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const levelEl = document.getElementById('level');
const ballsEl = document.getElementById('balls');
const orangesEl = document.getElementById('oranges');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'aiming' | 'shooting' | 'paused' | 'cleared' | 'over'
let state = 'idle';
let score = 0;
let bestScore = 0;
let level = 1;
let ballsLeft = BALLS_PER_LEVEL;
let orangesCleared = 0;
let aimAngle = 0;                   // radians from straight down, + is right
let aimDir = 0;                     // -1 / 0 / +1 from the held arrow keys
let shotTime = 0;                   // seconds the current shot has been live
let resumeState = 'aiming';         // what P returns to
let pegs = [];
const ball = { x: CANNON_X, y: CANNON_Y, vx: 0, vy: 0 };
const bucket = { x: CANVAS_W / 2, vx: BUCKET_SPEED };
const sparks = [];

// Testing hook: the animation loop only advances time while this is true, so
// a test can set it to false and drive `step(dt)` itself. Gameplay never
// touches it.
let autoAdvance = true;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Seeded RNG — a level number always produces the same board.
// ---------------------------------------------------------------------------

let rngState = 1;

function srand(seed) {
    rngState = (seed >>> 0) || 1;
}

function rand() {
    // xorshift32, scaled into [0, 1)
    rngState ^= rngState << 13; rngState >>>= 0;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5; rngState >>>= 0;
    return rngState / 4294967296;
}

// ---------------------------------------------------------------------------
// Level layouts
//
// Every layout staggers its rows, so no peg ever sits directly above another
// and the ball always has a way through.
// ---------------------------------------------------------------------------

function peg(x, y) {
    return { x, y, type: 'blue', hit: false };
}

function gridLayout() {
    const out = [];
    const cols = 9;
    const gapX = 56;
    const startX = (CANVAS_W - (cols - 1) * gapX) / 2;
    for (let row = 0; row < 7; row++) {
        const offset = (row % 2) * (gapX / 2);
        for (let col = 0; col < cols; col++) {
            out.push(peg(startX + col * gapX + offset, 205 + row * 58));
        }
    }
    return out;
}

function diamondLayout() {
    const out = [];
    const counts = [3, 4, 5, 6, 7, 6, 5, 4, 3];
    const gapX = 58;
    counts.forEach((count, row) => {
        const startX = CANVAS_W / 2 - ((count - 1) * gapX) / 2;
        for (let col = 0; col < count; col++) {
            out.push(peg(startX + col * gapX, 200 + row * 52));
        }
    });
    return out;
}

function archLayout() {
    const out = [];
    const cols = 10;
    const gapX = 54;
    const startX = (CANVAS_W - (cols - 1) * gapX) / 2;
    for (let row = 0; row < 6; row++) {
        const offset = (row % 2) * (gapX / 2);
        for (let col = 0; col < cols; col++) {
            const x = startX + col * gapX + offset;
            const wave = 46 * Math.sin(((x - 40) / 560) * Math.PI);
            out.push(peg(x, 200 + row * 66 + wave));
        }
    }
    return out;
}

const LAYOUTS = [gridLayout, diamondLayout, archLayout];

// Build the board for level `n`: pick the layout, then paint ORANGE_TARGET of
// its pegs orange using a seed derived from the level number.
function buildLevel(n) {
    pegs = LAYOUTS[(n - 1) % LAYOUTS.length]();
    srand(n * 7919 + 13);
    const order = pegs.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < Math.min(ORANGE_TARGET, order.length); i++) {
        pegs[order[i]].type = 'orange';
    }
    orangesCleared = 0;
    sparks.length = 0;
}

const orangesLeft = () => pegs.filter((p) => p.type === 'orange').length;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function multiplier() {
    for (const [threshold, mult] of MULTIPLIER_STEPS) {
        if (orangesCleared >= threshold) return mult;
    }
    return 1;
}

function scorePeg(p) {
    p.hit = true;
    if (p.type === 'orange') orangesCleared++;
    score += (p.type === 'orange' ? ORANGE_POINTS : BLUE_POINTS) * multiplier();
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        sparks.push({ x: p.x, y: p.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: 0.45, type: p.type });
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Aiming and firing
// ---------------------------------------------------------------------------

function aimBy(delta) {
    aimAngle = clamp(aimAngle + delta, -AIM_LIMIT, AIM_LIMIT);
}

// Point the cannon at a board coordinate (used by the mouse).
function aimAt(x, y) {
    const dy = Math.max(y - CANNON_Y, 1);
    aimAngle = clamp(Math.atan2(x - CANNON_X, dy), -AIM_LIMIT, AIM_LIMIT);
}

function parkBall() {
    ball.x = CANNON_X;
    ball.y = CANNON_Y;
    ball.vx = 0;
    ball.vy = 0;
}

function fire() {
    if (state !== 'aiming' || ballsLeft <= 0) return;
    parkBall();
    ball.vx = Math.sin(aimAngle) * LAUNCH_SPEED;
    ball.vy = Math.cos(aimAngle) * LAUNCH_SPEED;
    ballsLeft--;
    shotTime = 0;
    state = 'shooting';
    updateHud();
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

function capSpeed() {
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > MAX_SPEED) {
        ball.vx = (ball.vx / speed) * MAX_SPEED;
        ball.vy = (ball.vy / speed) * MAX_SPEED;
    }
}

function bounceWalls() {
    if (ball.x < BALL_R) {
        ball.x = BALL_R;
        ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
    } else if (ball.x > CANVAS_W - BALL_R) {
        ball.x = CANVAS_W - BALL_R;
        ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
    }
    if (ball.y < BALL_R) {
        ball.y = BALL_R;
        ball.vy = Math.abs(ball.vy) * WALL_RESTITUTION;
    }
}

// Circle-vs-circle against every peg: push the ball out to exactly touching,
// then reflect its velocity about the contact normal.
function bouncePegs() {
    for (const p of pegs) {
        const dx = ball.x - p.x;
        const dy = ball.y - p.y;
        const dist = Math.hypot(dx, dy);
        const minDist = PEG_R + BALL_R;
        if (dist >= minDist) continue;

        const nx = dist > 0.0001 ? dx / dist : 0;
        const ny = dist > 0.0001 ? dy / dist : -1;
        ball.x = p.x + nx * minDist;
        ball.y = p.y + ny * minDist;

        const vn = ball.vx * nx + ball.vy * ny;
        if (vn < 0) {
            ball.vx -= (1 + PEG_RESTITUTION) * vn * nx;
            ball.vy -= (1 + PEG_RESTITUTION) * vn * ny;
        }
        if (!p.hit) scorePeg(p);
    }
}

function inBucket() {
    return ball.y + BALL_R >= BUCKET_Y
        && ball.y - BALL_R <= BUCKET_Y + BUCKET_H
        && Math.abs(ball.x - bucket.x) <= BUCKET_W / 2;
}

function stepBall(dt) {
    ball.vy += GRAVITY * dt;
    capSpeed();
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    bounceWalls();
    bouncePegs();

    if (inBucket()) { endShot(true); return; }
    if (ball.y - BALL_R > CANVAS_H) { endShot(false); return; }

    shotTime += dt;
    if (shotTime >= MAX_SHOT_TIME) endShot(false);
}

function stepBucket(dt) {
    bucket.x += bucket.vx * dt;
    if (bucket.x < BUCKET_W / 2) {
        bucket.x = BUCKET_W / 2;
        bucket.vx = Math.abs(bucket.vx);
    } else if (bucket.x > CANVAS_W - BUCKET_W / 2) {
        bucket.x = CANVAS_W - BUCKET_W / 2;
        bucket.vx = -Math.abs(bucket.vx);
    }
}

function stepSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 200 * dt;
        s.life -= dt;
        if (s.life <= 0) sparks.splice(i, 1);
    }
}

// The single place time passes. Everything else reads state or draws it.
function step(dt) {
    if (state !== 'aiming' && state !== 'shooting') return;
    const total = Math.min(dt, 0.05);

    if (state === 'aiming' && aimDir !== 0) aimBy(aimDir * AIM_SPEED * total);

    let left = total;
    while (left > 0) {
        const sub = Math.min(SUB_DT, left);
        left -= sub;
        stepBucket(sub);
        stepSparks(sub);
        if (state === 'shooting') stepBall(sub);
        else break;
    }
}

// ---------------------------------------------------------------------------
// Shot and level lifecycle
// ---------------------------------------------------------------------------

function endShot(caught) {
    pegs = pegs.filter((p) => !p.hit);
    if (caught) ballsLeft++;

    if (orangesLeft() === 0) {
        score += ballsLeft * CLEAR_BONUS_PER_BALL;
        state = 'cleared';
        showOverlay('LEVEL CLEAR', `Score ${score} · ${ballsLeft} ball${ballsLeft === 1 ? '' : 's'} spare`,
            'Press Space for the next level');
    } else if (ballsLeft <= 0) {
        gameOver();
    } else {
        state = 'aiming';
        parkBall();
    }
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > bestScore) {
        bestScore = score;
        try { window.localStorage.setItem(BEST_KEY, String(bestScore)); } catch (e) { /* private mode */ }
    }
    showOverlay('GAME OVER', `Score ${score} · Best ${bestScore}`, 'Press Space to play again');
}

function startGame() {
    score = 0;
    level = 1;
    ballsLeft = BALLS_PER_LEVEL;
    aimAngle = 0;
    aimDir = 0;
    buildLevel(level);
    parkBall();
    state = 'aiming';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level++;
    ballsLeft = BALLS_PER_LEVEL;
    aimAngle = 0;
    aimDir = 0;
    buildLevel(level);
    parkBall();
    state = 'aiming';
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'aiming' || state === 'shooting') {
        resumeState = state;
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = resumeState;
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(bestScore);
    levelEl.textContent = String(level);
    ballsEl.textContent = String(ballsLeft);
    orangesEl.textContent = String(orangesLeft());
}

function showOverlay(title, sub2, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub2;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#181040');
    sky.addColorStop(0.55, '#0d0a24');
    sky.addColorStop(1, '#070512');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.strokeStyle = 'rgba(120, 100, 220, 0.08)';
    ctx.lineWidth = 1;
    for (let y = 80; y < CANVAS_H; y += 80) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(CANVAS_W, y + 0.5);
        ctx.stroke();
    }
}

function drawAimGuide() {
    if (state !== 'aiming') return;
    const dx = Math.sin(aimAngle);
    const dy = Math.cos(aimAngle);
    ctx.fillStyle = 'rgba(255, 166, 61, 0.55)';
    for (let d = CANNON_LEN + 18; d < CANNON_LEN + 150; d += 16) {
        const r = 3 * (1 - (d - CANNON_LEN) / 190);
        ctx.beginPath();
        ctx.arc(CANNON_X + dx * d, CANNON_Y + dy * d, Math.max(r, 1), 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawCannon() {
    const dx = Math.sin(aimAngle);
    const dy = Math.cos(aimAngle);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#6f5fd0';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(CANNON_X, CANNON_Y);
    ctx.lineTo(CANNON_X + dx * CANNON_LEN, CANNON_Y + dy * CANNON_LEN);
    ctx.stroke();
    ctx.strokeStyle = '#a394ff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(CANNON_X, CANNON_Y);
    ctx.lineTo(CANNON_X + dx * CANNON_LEN, CANNON_Y + dy * CANNON_LEN);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#3b2f7a';
    ctx.beginPath();
    ctx.arc(CANNON_X, CANNON_Y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b9aaff';
    ctx.beginPath();
    ctx.arc(CANNON_X, CANNON_Y, 7, 0, Math.PI * 2);
    ctx.fill();
}

function drawPegs() {
    for (const p of pegs) {
        const orange = p.type === 'orange';
        if (p.hit) {
            ctx.fillStyle = orange ? 'rgba(255, 214, 150, 0.95)' : 'rgba(190, 225, 255, 0.95)';
            ctx.shadowBlur = 18;
            ctx.shadowColor = orange ? '#ffa63d' : '#4aa8ff';
        } else {
            ctx.fillStyle = orange ? '#ffa63d' : '#4aa8ff';
            ctx.shadowBlur = 8;
            ctx.shadowColor = orange ? 'rgba(255, 166, 61, 0.6)' : 'rgba(74, 168, 255, 0.45)';
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, PEG_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.arc(p.x - PEG_R * 0.3, p.y - PEG_R * 0.3, PEG_R * 0.3, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawSparks() {
    for (const s of sparks) {
        ctx.globalAlpha = Math.max(s.life / 0.45, 0);
        ctx.fillStyle = s.type === 'orange' ? '#ffd08a' : '#a8d8ff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawBucket() {
    const left = bucket.x - BUCKET_W / 2;
    ctx.fillStyle = '#2a2150';
    ctx.fillRect(left, BUCKET_Y, BUCKET_W, BUCKET_H);
    ctx.fillStyle = '#38e0a0';
    ctx.fillRect(left, BUCKET_Y, BUCKET_W, 5);
    ctx.fillStyle = '#6f5fd0';
    ctx.fillRect(left - 5, BUCKET_Y - 8, 5, BUCKET_H + 8);
    ctx.fillRect(left + BUCKET_W, BUCKET_Y - 8, 5, BUCKET_H + 8);
}

function drawBall() {
    if (state === 'idle' || state === 'over') return;
    ctx.fillStyle = '#fff6e5';
    ctx.shadowBlur = 14;
    ctx.shadowColor = '#ffd08a';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
}

function draw() {
    drawBackground();
    drawAimGuide();
    drawPegs();
    drawSparks();
    drawBucket();
    drawBall();
    drawCannon();
}

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
    lastTime = now;
    if (autoAdvance) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const heldKeys = new Set();

function refreshAimDir() {
    const left = LEFT_KEYS.some((k) => heldKeys.has(k));
    const right = RIGHT_KEYS.some((k) => heldKeys.has(k));
    aimDir = (right ? 1 : 0) - (left ? 1 : 0);
}

function primaryAction() {
    if (state === 'idle' || state === 'over') startGame();
    else if (state === 'cleared') nextLevel();
    else if (state === 'aiming') fire();
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        primaryAction();
        e.preventDefault();
        return;
    }
    if (LEFT_KEYS.includes(e.key) || RIGHT_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshAimDir();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshAimDir();
    }
});

function boardPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
        y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    };
}

canvas.addEventListener('mousemove', (e) => {
    if (state !== 'aiming') return;
    const p = boardPoint(e);
    aimAt(p.x, p.y);
});

canvas.addEventListener('click', (e) => {
    if (state === 'aiming') {
        const p = boardPoint(e);
        aimAt(p.x, p.y);
    }
    primaryAction();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else primaryAction();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

try {
    bestScore = parseInt(window.localStorage.getItem(BEST_KEY) || '0', 10) || 0;
} catch (e) {
    bestScore = 0;
}
buildLevel(level);
parkBall();
updateHud();
requestAnimationFrame(frame);
