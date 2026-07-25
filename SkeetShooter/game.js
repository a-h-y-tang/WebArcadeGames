// ---------------------------------------------------------------------------
// Skeet Shooter — a clay-pigeon shooting gallery. Clays arc across the range
// under gravity; swing the crosshair with the mouse and click to shatter them
// before they escape. All motion is time-based (pixels per second) integrated
// with a delta time `dt` (seconds). `update(dt)` and `fireAt(x, y)` are pure
// world functions with no `state` gating, so tests can drive them directly.
// Clays are stored by their CENTRE (x, y) plus radius r.
// ---------------------------------------------------------------------------

const WIDTH = 700;
const HEIGHT = 500;

// Tunables
const CLAY_R = 16;              // clay radius, px
const HIT_SLOP = 8;             // extra aim forgiveness beyond the clay edge, px
const MAX_MISSES = 5;           // escaped clays allowed before game over
const GRAVITY = 380;            // px / second²
const LAUNCH_VY_MIN = 430;      // upward launch speed range, px / second
const LAUNCH_VY_MAX = 520;
const LAUNCH_VX_MIN = 120;      // inward launch speed range, px / second
const LAUNCH_VX_MAX = 220;
const SPAWN_BASE = 1.4;         // seconds between clays at score 0
const SPAWN_MIN = 0.55;         // fastest spawn cadence
const SPAWN_RAMP = 0.03;        // seconds shaved off the interval per point

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const missesEl = document.getElementById('misses');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let clays, debris, score, misses, best, state, mouse, spawnTimer, lastTime, animId, rng;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — fixed seed → identical launch sequence.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function rand(lo, hi) {
    return lo + rng() * (hi - lo);
}

function spawnInterval() {
    return Math.max(SPAWN_MIN, SPAWN_BASE - score * SPAWN_RAMP);
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
function spawnClay() {
    const left = rng() < 0.5;
    const x = left ? 40 : WIDTH - 40;
    const vx = (left ? 1 : -1) * rand(LAUNCH_VX_MIN, LAUNCH_VX_MAX);
    const vy = -rand(LAUNCH_VY_MIN, LAUNCH_VY_MAX);
    clays.push({ x, y: HEIGHT - 8, vx, vy, r: CLAY_R, alive: true });
}

function spawnDebris(clay) {
    for (let i = 0; i < 10; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = rand(60, 220);
        debris.push({ x: clay.x, y: clay.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 });
    }
}

function offScreen(c) {
    return c.y - c.r > HEIGHT || c.y + c.r < 0 || c.x + c.r < 0 || c.x - c.r > WIDTH;
}

// ---------------------------------------------------------------------------
// Scoring / HUD
// ---------------------------------------------------------------------------
function updateScore() {
    scoreEl.textContent = score;
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('skeet-best', best);
    }
}

function updateMisses() {
    missesEl.textContent = misses;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function startGame() {
    rng = mulberry32(0x51ee7);
    clays = [];
    debris = [];
    score = 0;
    misses = 0;
    spawnTimer = 0.4;
    scoreEl.textContent = '0';
    missesEl.textContent = '0';

    overlay.classList.remove('visible');
    state = 'running';
    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    updateScore();
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = score;
    overlaySub.textContent = `You shattered ${score} clay${score === 1 ? '' : 's'} · click or press Space to play again`;
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
    lastTime = null;
    overlay.classList.remove('visible');
    animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Shooting — pure, no `state` gating.
// ---------------------------------------------------------------------------
function fireAt(x, y) {
    let bestIdx = -1, bestD = Infinity;
    for (let i = 0; i < clays.length; i++) {
        const c = clays[i];
        if (!c.alive) continue;
        const d = Math.hypot(x - c.x, y - c.y);
        if (d <= c.r + HIT_SLOP && d < bestD) {
            bestD = d;
            bestIdx = i;
        }
    }
    if (bestIdx < 0) return false;

    spawnDebris(clays[bestIdx]);
    clays.splice(bestIdx, 1);
    score++;
    updateScore();
    return true;
}

// ---------------------------------------------------------------------------
// Physics — one deterministic step. No `state` gating on purpose.
// ---------------------------------------------------------------------------
function update(dt) {
    // Spawn on a cadence that quickens with the score.
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawnClay();
        spawnTimer = spawnInterval();
    }

    // Move clays; retire any that leave the range (a live escapee is a miss).
    for (let i = clays.length - 1; i >= 0; i--) {
        const c = clays[i];
        c.vy += GRAVITY * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        if (offScreen(c)) {
            if (c.alive) {
                misses++;
                updateMisses();
            }
            clays.splice(i, 1);
        }
    }

    // Advance shatter debris.
    for (let i = debris.length - 1; i >= 0; i--) {
        const p = debris[i];
        p.vy += GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) debris.splice(i, 1);
    }

    if (misses >= MAX_MISSES) endGame();
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
function loop(timestamp) {
    if (state !== 'running') return;
    if (lastTime == null) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.05) dt = 0.05; // clamp big gaps (tab switches)

    update(dt);
    draw();
    animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function draw() {
    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, '#0a1120');
    sky.addColorStop(1, '#111d33');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Ground strip + trap houses in the corners
    ctx.fillStyle = '#132033';
    ctx.fillRect(0, HEIGHT - 24, WIDTH, 24);
    ctx.fillStyle = '#1b2b45';
    ctx.fillRect(8, HEIGHT - 40, 64, 32);
    ctx.fillRect(WIDTH - 72, HEIGHT - 40, 64, 32);

    // Debris
    for (const p of debris) {
        ctx.globalAlpha = Math.max(0, p.life / 0.5);
        ctx.fillStyle = '#f0b429';
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // Clays
    for (const c of clays) {
        if (!c.alive) continue;
        ctx.fillStyle = '#f0b429';
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#c88a12';
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r * 0.55, 0, Math.PI * 2);
        ctx.fill();
    }

    // Crosshair
    if (state === 'running') drawCrosshair(mouse.x, mouse.y);
}

function drawCrosshair(x, y) {
    ctx.strokeStyle = '#ff5c5c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.moveTo(x - 18, y); ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y); ctx.lineTo(x + 18, y);
    ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 6);
    ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 18);
    ctx.stroke();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function isStartKey(k) {
    return k === ' ' || k === 'Spacebar' || k === 'Enter';
}

function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
}

document.addEventListener('keydown', e => {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    if (state !== 'running' && state !== 'paused' && isStartKey(k)) {
        startGame();
        e.preventDefault();
    }
});

canvas.addEventListener('mousemove', e => {
    const p = canvasPoint(e);
    mouse.x = p.x;
    mouse.y = p.y;
});

canvas.addEventListener('mousedown', e => {
    const p = canvasPoint(e);
    mouse.x = p.x;
    mouse.y = p.y;
    if (state === 'running') fireAt(p.x, p.y);
    else if (state !== 'paused') startGame();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init — a still, empty range behind the start overlay.
// ---------------------------------------------------------------------------
best = parseInt(localStorage.getItem('skeet-best') || '0', 10);
bestEl.textContent = best;
score = 0;
misses = 0;
clays = [];
debris = [];
spawnTimer = SPAWN_BASE;
mouse = { x: WIDTH / 2, y: HEIGHT / 2 };
rng = mulberry32(0x51ee7);
state = 'idle';
draw();
