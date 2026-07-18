// ---------------------------------------------------------------------------
// Kaboom! — a bomb-catching reflex arcade game on an HTML5 canvas.
//
// A Mad Bomber paces across the top of the screen dropping bombs; the player
// slides a stack of buckets along the bottom to catch them. Written as a single
// classic (non-module) script so the game state and logic are reachable from the
// Playwright tests as plain globals, mirroring Dino Run, Snake and Tetris in this
// repo. All motion is expressed per-second and advanced through `step(dt)`, so
// the tests can simulate frames deterministically without depending on
// requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 400;

// --- Bomber (drops bombs from the top) ---
const BOMBER_Y = 40;
const BOMBER_W = 44;
const BOMBER_H = 24;

// --- Player / bucket stack ---
const PADDLE_W = 74;           // horizontal reach of the bucket stack
const PADDLE_H = 46;
const CATCH_Y = CANVAS_H - 46; // y of the catch line (top of the buckets)
const PLAYER_SPEED = 480;      // px/s of keyboard movement

// --- Bombs ---
const BOMB_R = 8;

// --- Difficulty scaling (all pure functions of `wave`) ---
const BOMB_BASE = 120, BOMB_STEP = 30;       // fall speed
const BOMBER_BASE = 130, BOMBER_STEP = 22;   // bomber horizontal speed
const DROP_BASE = 1.2, DROP_STEP = 0.1, DROP_MIN = 0.4; // seconds between drops

const BOMBS_PER_WAVE = 10;     // catch this many to clear a wave
const START_BUCKETS = 3;
const MAX_BUCKETS = 5;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const waveEl = document.getElementById('wave');
const bucketsEl = document.getElementById('buckets');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, wave, buckets, caughtThisWave, dropTimer;
const player = { x: CANVAS_W / 2, dir: 0 };
const bomber = { x: CANVAS_W / 2, dir: 1 };
const bombs = [];
const particles = [];

// ---------------------------------------------------------------------------
// Difficulty helpers
// ---------------------------------------------------------------------------

function bombSpeed() { return BOMB_BASE + (wave - 1) * BOMB_STEP; }
function bomberSpeed() { return BOMBER_BASE + (wave - 1) * BOMBER_STEP; }
function dropInterval() { return Math.max(DROP_MIN, DROP_BASE - (wave - 1) * DROP_STEP); }
function pointsPerBomb() { return wave; }
function catchLineY() { return CATCH_Y; }

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function clampPlayer(x) {
    return Math.max(PADDLE_W / 2, Math.min(CANVAS_W - PADDLE_W / 2, x));
}

function setPlayerX(x) {
    player.x = clampPlayer(x);
}

function movePlayer(dir) {
    player.dir = dir;
}

// ---------------------------------------------------------------------------
// Bombs
// ---------------------------------------------------------------------------

function spawnBomb(opts) {
    opts = opts || {};
    const x = opts.x != null ? opts.x : bomber.x;
    const y = opts.y != null ? opts.y : BOMBER_Y + BOMBER_H;
    bombs.push({ x, y, past: false });
    return bombs[bombs.length - 1];
}

function catchBomb(index) {
    bombs.splice(index, 1);
    score += pointsPerBomb();
    caughtThisWave += 1;
    if (caughtThisWave >= BOMBS_PER_WAVE) completeWave();
}

// A missed bomb destroys a bucket and detonates every bomb still on screen.
function missBomb() {
    spawnExplosion();
    bombs.length = 0;
    caughtThisWave = 0;
    dropTimer = dropInterval();
    buckets -= 1;
    if (buckets <= 0) {
        buckets = 0;
        endGame();
    }
}

function completeWave() {
    wave += 1;
    caughtThisWave = 0;
    buckets = Math.min(MAX_BUCKETS, buckets + 1);
    dropTimer = dropInterval();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    // Player.
    if (player.dir !== 0) {
        player.x = clampPlayer(player.x + player.dir * PLAYER_SPEED * h);
    }

    // Bomber paces and bounces off the walls.
    const min = BOMBER_W / 2, max = CANVAS_W - BOMBER_W / 2;
    bomber.x += bomber.dir * bomberSpeed() * h;
    if (bomber.x <= min) { bomber.x = min; bomber.dir = 1; }
    else if (bomber.x >= max) { bomber.x = max; bomber.dir = -1; }

    // Drop timer.
    dropTimer -= h;
    if (dropTimer <= 0) {
        spawnBomb();
        dropTimer += dropInterval();
    }

    // Bombs fall; resolve catches and misses.
    const v = bombSpeed();
    for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.y += v * h;
        if (!b.past && b.y >= CATCH_Y) {
            if (Math.abs(b.x - player.x) <= PADDLE_W / 2 + BOMB_R) {
                catchBomb(i);
                continue;
            }
            b.past = true; // slipped by the buckets — now doomed to hit the floor
        }
        if (b.y > CANVAS_H + BOMB_R) {
            missBomb();     // clears every bomb, so stop scanning this step
            return;
        }
    }
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so bomb/paddle
// crossings are never skipped and the integration is resolution-independent.
function step(dt) {
    if (state !== 'running') return;
    const SUB = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-6) {
        const h = Math.min(SUB, remaining);
        substep(h);
        remaining -= h;
        if (state !== 'running') break;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    wave = 1;
    buckets = START_BUCKETS;
    caughtThisWave = 0;
    bombs.length = 0;
    particles.length = 0;
    player.x = CANVAS_W / 2;
    player.dir = 0;
    bomber.x = CANVAS_W / 2;
    bomber.dir = 1;
    dropTimer = dropInterval();
    hideOverlay();
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('kaboom-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Score ' + score + ' · Wave ' + wave, 'Press Space to play again', 'Play Again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    waveEl.textContent = String(wave);
    bucketsEl.textContent = String(buckets);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreText, sub, buttonText) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = buttonText;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Explosion particles (purely cosmetic)
// ---------------------------------------------------------------------------

function spawnExplosion() {
    for (const b of bombs) {
        for (let i = 0; i < 6; i++) {
            particles.push({
                x: b.x, y: b.y,
                vx: (Math.random() - 0.5) * 220,
                vy: (Math.random() - 0.5) * 220,
                life: 0.5,
            });
        }
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Catch-line ground shading.
    ctx.fillStyle = '#111a2e';
    ctx.fillRect(0, CATCH_Y + PADDLE_H, CANVAS_W, CANVAS_H - CATCH_Y - PADDLE_H);

    // Bomber.
    ctx.fillStyle = '#f87171';
    ctx.fillRect(bomber.x - BOMBER_W / 2, BOMBER_Y - BOMBER_H / 2, BOMBER_W, BOMBER_H);
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(bomber.x - 10, BOMBER_Y - 3, 5, 5);
    ctx.fillRect(bomber.x + 5, BOMBER_Y - 3, 5, 5);

    // Bombs.
    for (const b of bombs) {
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.arc(b.x, b.y, BOMB_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(b.x, b.y - BOMB_R);
        ctx.lineTo(b.x + 4, b.y - BOMB_R - 5);
        ctx.stroke();
    }

    // Explosion particles.
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // Bucket stack (one bucket per remaining life).
    const bw = PADDLE_W;
    for (let i = 0; i < buckets; i++) {
        const y = CATCH_Y + i * ((PADDLE_H - 6) / Math.max(1, MAX_BUCKETS)) * 0.9;
        const w = bw * (1 - i * 0.06);
        ctx.fillStyle = i === 0 ? '#fbbf24' : '#c88a10';
        ctx.beginPath();
        ctx.moveTo(player.x - w / 2, y);
        ctx.lineTo(player.x + w / 2, y);
        ctx.lineTo(player.x + w / 2 - 8, y + 12);
        ctx.lineTo(player.x - w / 2 + 8, y + 12);
        ctx.closePath();
        ctx.fill();
    }
}

// ---------------------------------------------------------------------------
// Main loop (real-time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    if (state === 'running') step(dt);
    updateParticles(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const heldKeys = new Set();

function refreshKeyDir() {
    const left = heldKeys.has('ArrowLeft') || heldKeys.has('a') || heldKeys.has('A');
    const right = heldKeys.has('ArrowRight') || heldKeys.has('d') || heldKeys.has('D');
    movePlayer((right ? 1 : 0) - (left ? 1 : 0));
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (['ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D'].includes(e.key)) {
        heldKeys.add(e.key);
        refreshKeyDir();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshKeyDir();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    player.dir = 0;
    heldKeys.clear();
    setPlayerX(x);
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('kaboom-best') || '0', 10) || 0;
state = 'idle';
score = 0;
wave = 1;
buckets = START_BUCKETS;
caughtThisWave = 0;
dropTimer = DROP_BASE;
updateHud();
requestAnimationFrame(frame);
