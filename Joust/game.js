// ===========================================================================
// Joust — flap-to-fly combat arcade game
// ---------------------------------------------------------------------------
// Top-level bindings (state, player, enemies, eggs, step, flap, …) are
// intentionally global so the Playwright suite can drive the game
// deterministically, exactly as the other games in this repo do.
// ===========================================================================

// --- Dimensions ------------------------------------------------------------
const WIDTH = 700;
const HEIGHT = 500;
const LAVA_Y = 476; // feet at or below this = lava death

// --- Physics (pixels & milliseconds) --------------------------------------
const GRAVITY = 0.0016;      // px/ms²
const FLAP_IMPULSE = 0.44;   // px/ms subtracted from vy per flap
const MAX_UP = 0.75;         // px/ms cap on rise speed
const ACCEL = 0.0022;        // horizontal acceleration
const MAX_VX = 0.34;         // horizontal speed cap
const FRICTION = 0.0018;     // horizontal coast-down
const BOUNCE = 0.26;         // knock-apart speed on an equal joust

const ENEMY_ACCEL = 0.0012;
const ENEMY_MAX_VX = 0.22;
const ENEMY_FLAP = 0.4;
const ENEMY_BOUNCE = 0.22;

const COMBAT_THRESHOLD = 8;  // centre-height difference that decides a joust
const ENEMY_POINTS = 500;
const EGG_POINTS = 250;
const HATCH_TIME = 4000;     // ms a landed egg survives before hatching
const START_LIVES = 3;
const MAX_ENEMIES = 5;

// --- Layout ----------------------------------------------------------------
const platforms = [
    { x: 270, y: 330, w: 160, h: 16 }, // central start ledge
    { x: 20,  y: 410, w: 190, h: 16 }, // low left
    { x: 490, y: 410, w: 190, h: 16 }, // low right
    { x: 55,  y: 235, w: 160, h: 16 }, // high left
    { x: 485, y: 235, w: 160, h: 16 }, // high right
    { x: 290, y: 140, w: 120, h: 16 }, // top
];

const SPAWN_POINTS = [
    { x: 120, y: 180 }, { x: 545, y: 180 }, { x: 330, y: 80 },
    { x: 90, y: 360 }, { x: 560, y: 360 },
];

const START = { x: 333, y: 298 };

// --- Colours ---------------------------------------------------------------
const BG = '#0d1117';
const LAVA = '#e5484d';

// --- Mutable state ---------------------------------------------------------
let state = 'idle'; // 'idle' | 'running' | 'paused' | 'over'
let score = 0;
let lives = START_LIVES;
let wave = 1;
let best = 0;

let player = { x: START.x, y: START.y, w: 34, h: 32, vx: 0, vy: 0, facing: 1, onGround: true };
let enemies = [];
let eggs = [];

const input = { left: false, right: false };

// Seeded RNG: play varies but logic stays deterministic for tests.
let seed = 0x51ed270b;
function rng() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
}

// --- DOM -------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const waveEl = document.getElementById('wave');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ===========================================================================
// Helpers
// ===========================================================================
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function overlap(a, b) {
    return a.x + a.w > b.x && a.x < b.x + b.w && a.y + a.h > b.y && a.y < b.y + b.h;
}

function wrapX(o) {
    if (o.x + o.w < 0) o.x = WIDTH;
    else if (o.x > WIDTH) o.x = -o.w;
}

function makeEnemy(x, y) {
    return {
        x, y, w: 34, h: 30,
        vx: (rng() - 0.5) * 0.2,
        vy: 0,
        facing: rng() < 0.5 ? -1 : 1,
        flapT: 0,
        flapInterval: 480 + rng() * 420,
    };
}

// ===========================================================================
// Spawning / waves
// ===========================================================================
function spawnWave() {
    const n = Math.min(2 + wave, MAX_ENEMIES);
    for (let i = 0; i < n; i++) {
        const p = SPAWN_POINTS[i % SPAWN_POINTS.length];
        enemies.push(makeEnemy(p.x, p.y));
    }
}

function nextWave() {
    wave++;
    spawnWave();
    updateHUD();
}

function spawnEgg(x, y) {
    eggs.push({ x, y, vx: 0, vy: 0, w: 22, h: 24, landed: false, hatchT: 0 });
}

// ===========================================================================
// Player
// ===========================================================================
function flap() {
    if (state !== 'running') return;
    player.vy = Math.max(player.vy - FLAP_IMPULSE, -MAX_UP);
    player.onGround = false;
}

function respawn() {
    player.x = START.x;
    player.y = START.y;
    player.vx = 0;
    player.vy = 0;
    player.onGround = true;
    input.left = false;
    input.right = false;
}

function loseLife() {
    lives--;
    updateHUD();
    if (lives <= 0) {
        endGame();
        return;
    }
    respawn();
}

function landOnPlatforms(o, prevBottom, bounceVy) {
    if (o.vy < 0) return false;
    for (const p of platforms) {
        const overlapX = o.x + o.w > p.x && o.x < p.x + p.w;
        const bottom = o.y + o.h;
        if (overlapX && prevBottom <= p.y + 2 && bottom >= p.y && bottom <= p.y + p.h + 12) {
            o.y = p.y - o.h;
            o.vy = bounceVy;
            return true;
        }
    }
    return false;
}

function updatePlayer(dt) {
    if (input.left && !input.right) { player.vx -= ACCEL * dt; player.facing = -1; }
    else if (input.right && !input.left) { player.vx += ACCEL * dt; player.facing = 1; }
    else if (player.vx > 0) { player.vx = Math.max(0, player.vx - FRICTION * dt); }
    else if (player.vx < 0) { player.vx = Math.min(0, player.vx + FRICTION * dt); }
    player.vx = clamp(player.vx, -MAX_VX, MAX_VX);

    player.vy += GRAVITY * dt;
    const prevBottom = player.y + player.h;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    wrapX(player);

    player.onGround = landOnPlatforms(player, prevBottom, 0);
}

// ===========================================================================
// Enemies
// ===========================================================================
function updateEnemies(dt) {
    for (const e of enemies) {
        const dir = player.x > e.x ? 1 : -1;
        e.vx = clamp(e.vx + dir * ENEMY_ACCEL * dt, -ENEMY_MAX_VX, ENEMY_MAX_VX);
        e.facing = e.vx >= 0 ? 1 : -1;

        e.vy += GRAVITY * dt;
        e.flapT += dt;
        if (e.flapT >= e.flapInterval) {
            e.flapT = 0;
            if (player.y < e.y - 4) e.vy = Math.max(e.vy - ENEMY_FLAP, -MAX_UP);
        }

        const prevBottom = e.y + e.h;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        wrapX(e);

        landOnPlatforms(e, prevBottom, -ENEMY_BOUNCE);

        // Enemies never die in the lava; they bounce back up off it.
        if (e.y + e.h >= LAVA_Y) {
            e.y = LAVA_Y - e.h;
            e.vy = -ENEMY_FLAP;
        }
    }
}

// ===========================================================================
// Combat
// ===========================================================================
function combatOutcome(e) {
    const py = player.y + player.h / 2;
    const ey = e.y + e.h / 2;
    if (py < ey - COMBAT_THRESHOLD) return 'win';
    if (py > ey + COMBAT_THRESHOLD) return 'lose';
    return 'bounce';
}

function resolveCombat() {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (!overlap(player, e)) continue;
        const outcome = combatOutcome(e);
        if (outcome === 'win') {
            enemies.splice(i, 1);
            spawnEgg(e.x, e.y);
            addScore(ENEMY_POINTS);
        } else if (outcome === 'lose') {
            loseLife();
            return;
        } else {
            const dir = player.x < e.x ? -1 : 1;
            player.vx = dir * BOUNCE;
            e.vx = -dir * BOUNCE;
        }
    }
}

// ===========================================================================
// Eggs
// ===========================================================================
function updateEggs(dt) {
    for (let i = eggs.length - 1; i >= 0; i--) {
        const g = eggs[i];
        if (!g.landed) {
            g.vy += GRAVITY * dt;
            const prevBottom = g.y + g.h;
            g.y += g.vy * dt;
            if (landOnPlatforms(g, prevBottom, 0)) g.landed = true;
            if (g.y + g.h >= LAVA_Y) { eggs.splice(i, 1); continue; } // lost in the lava
        } else {
            g.hatchT += dt;
            if (g.hatchT >= HATCH_TIME) {
                eggs.splice(i, 1);
                enemies.push(makeEnemy(g.x, g.y - 6));
                continue;
            }
        }
        if (overlap(player, g)) {
            eggs.splice(i, 1);
            addScore(EGG_POINTS);
        }
    }
}

// ===========================================================================
// Simulation step (the deterministic testing seam)
// ===========================================================================
function step(dt) {
    if (state !== 'running') return;

    updatePlayer(dt);

    if (player.y + player.h >= LAVA_Y) {
        loseLife();
        return;
    }

    updateEnemies(dt);
    updateEggs(dt);
    resolveCombat();

    if (enemies.length === 0 && eggs.length === 0) nextWave();
}

// ===========================================================================
// Scoring / HUD / overlay
// ===========================================================================
function addScore(n) {
    score += n;
    updateHUD();
}

function updateHUD() {
    scoreEl.textContent = score;
    livesEl.textContent = lives;
    waveEl.textContent = wave;
    bestEl.textContent = best;
}

function showOverlay(title, scoreText, sub, btnLabel) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = btnLabel;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ===========================================================================
// Game flow
// ===========================================================================
function startGame() {
    score = 0;
    lives = START_LIVES;
    wave = 1;
    enemies = [];
    eggs = [];
    respawn();
    spawnWave();
    state = 'running';
    hideOverlay();
    updateHUD();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('joust-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHUD();
    showOverlay('Game Over', score + ' pts', 'Press Space to play again', 'Play Again');
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

// ===========================================================================
// Input
// ===========================================================================
const START_KEYS = new Set([
    ' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',
]);

window.addEventListener('keydown', (e) => {
    const k = e.key;

    if (state === 'idle' || state === 'over') {
        if (START_KEYS.has(k)) { e.preventDefault(); startGame(); }
        return;
    }

    if (k === 'p' || k === 'P') { togglePause(); return; }
    if (state !== 'running') return;

    if (k === ' ' || k === 'Spacebar' || k === 'ArrowUp' || k === 'w' || k === 'W') {
        e.preventDefault();
        if (!e.repeat) flap();
        return;
    }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { input.left = true; e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { input.right = true; e.preventDefault(); }
});

window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') input.left = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') input.right = false;
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ===========================================================================
// Rendering
// ===========================================================================
function drawPlatform(p) {
    ctx.fillStyle = '#3d4c63';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#59708f';
    ctx.fillRect(p.x, p.y, p.w, 4);
}

function drawRider(x, y, w, h, facing, bodyColor, mountColor) {
    const cx = x + w / 2;
    // mount body
    ctx.fillStyle = mountColor;
    ctx.beginPath();
    ctx.ellipse(cx, y + h - 8, w / 2, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    // neck + head
    const hx = facing >= 0 ? x + w - 6 : x + 6;
    ctx.strokeStyle = mountColor;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx, y + h - 10);
    ctx.lineTo(hx, y + 6);
    ctx.stroke();
    ctx.fillStyle = mountColor;
    ctx.beginPath();
    ctx.arc(hx, y + 6, 5, 0, Math.PI * 2);
    ctx.fill();
    // beak
    ctx.fillStyle = '#f2b90c';
    ctx.beginPath();
    ctx.moveTo(hx + facing * 3, y + 4);
    ctx.lineTo(hx + facing * 12, y + 6);
    ctx.lineTo(hx + facing * 3, y + 9);
    ctx.closePath();
    ctx.fill();
    // rider
    ctx.fillStyle = bodyColor;
    ctx.fillRect(cx - 4, y, 8, 12);
}

function drawEgg(g) {
    ctx.fillStyle = '#f0ead6';
    ctx.beginPath();
    ctx.ellipse(g.x + g.w / 2, g.y + g.h / 2, g.w / 2, g.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cbbf9a';
    ctx.beginPath();
    ctx.ellipse(g.x + g.w / 2 + 3, g.y + g.h / 2 + 3, g.w / 4, g.h / 5, 0, 0, Math.PI * 2);
    ctx.fill();
}

function render() {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // lava
    const lavaGrad = ctx.createLinearGradient(0, LAVA_Y, 0, HEIGHT);
    lavaGrad.addColorStop(0, '#ff7a1a');
    lavaGrad.addColorStop(1, LAVA);
    ctx.fillStyle = lavaGrad;
    ctx.fillRect(0, LAVA_Y, WIDTH, HEIGHT - LAVA_Y);

    for (const p of platforms) drawPlatform(p);
    for (const g of eggs) drawEgg(g);
    for (const e of enemies) drawRider(e.x, e.y, e.w, e.h, e.facing, '#c9d1d9', '#e5484d');
    if (state !== 'idle') drawRider(player.x, player.y, player.w, player.h, player.facing, '#0d1117', '#f2b90c');
}

// ===========================================================================
// Main loop
// ===========================================================================
let last = 0;
function loop(ts) {
    if (!last) last = ts;
    let dt = ts - last;
    last = ts;
    if (dt > 50) dt = 50; // clamp long frames
    step(dt);
    render();
    requestAnimationFrame(loop);
}

// ===========================================================================
// Boot
// ===========================================================================
function init() {
    best = parseInt(localStorage.getItem('joust-best'), 10) || 0;
    updateHUD();
    render();
    requestAnimationFrame(loop);
}

init();
