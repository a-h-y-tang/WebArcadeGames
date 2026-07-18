// ---------------------------------------------------------------------------
// Dino Run — an endless side-scrolling runner on an HTML5 canvas.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring the
// Snake and Tetris games in this repo. All physics is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 200;
const GROUND_Y = 170;          // y of the floor line — the dino's feet rest here

// --- Dino ---
const DINO_X = 50;             // fixed horizontal position (the world scrolls, not the dino)
const DINO_W = 44;
const DINO_H = 47;             // standing height
const DUCK_H = 26;             // crouched height

// --- Physics (units per second) ---
const GRAVITY = 2400;          // downward acceleration
const JUMP_V = -760;           // upward impulse applied on a jump
const DUCK_GRAVITY = 2400;     // extra downward pull while ducking in mid-air (fast-fall)

// --- Scrolling ---
const BASE_SPEED = 340;        // starting world speed (px/s)
const MAX_SPEED = 720;
const SPEED_RAMP = 0.02;       // speed gained per pixel of distance travelled

// --- Obstacles ---
const CACTUS_W = 24;
const CACTUS_H = 40;
const BIRD_W = 36;
const BIRD_H = 28;
const INITIAL_SPAWN = 420;     // grace distance before the first obstacle
const MIN_GAP = 300;           // minimum distance between obstacles (keeps it survivable)
const RAND_GAP = 320;          // extra random gap on top of the minimum
const BIRD_HEIGHTS = [GROUND_Y - DINO_H - 8, GROUND_Y - 62, GROUND_Y - BIRD_H];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

const START_KEYS = new Set([' ', 'Spacebar', 'ArrowUp', 'w', 'W']);
const DUCK_KEYS = new Set(['ArrowDown', 's', 'S']);

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, distance, speed, nextSpawnDist;
const dino = { x: DINO_X, y: GROUND_Y, vy: 0, onGround: true, ducking: false };
const obstacles = [];
const clouds = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dinoHitbox() {
    const h = dino.ducking ? DUCK_H : DINO_H;
    // A little forgiveness inset so grazes near the edges don't count as hits.
    return { x: dino.x + 2, y: dino.y - h + 2, w: DINO_W - 4, h: h - 4 };
}

function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
}

function rand(min, max) {
    return min + Math.random() * (max - min);
}

// ---------------------------------------------------------------------------
// Obstacles
// ---------------------------------------------------------------------------

function spawnObstacle(type, opts) {
    opts = opts || {};
    const x = opts.x != null ? opts.x : CANVAS_W;
    if (type === 'bird') {
        const y = opts.y != null ? opts.y
            : BIRD_HEIGHTS[Math.floor(Math.random() * BIRD_HEIGHTS.length)];
        obstacles.push({ type: 'bird', x, y, w: BIRD_W, h: BIRD_H, flap: 0 });
    } else {
        const y = GROUND_Y - CACTUS_H;
        obstacles.push({ type: 'cactus', x, y, w: CACTUS_W, h: CACTUS_H });
    }
    return obstacles[obstacles.length - 1];
}

function scheduleNextSpawn() {
    nextSpawnDist = distance + MIN_GAP + Math.random() * RAND_GAP;
}

function autoSpawn() {
    // Birds only appear once the run is under way and the world has some pace.
    const type = distance > 900 && Math.random() < 0.3 ? 'bird' : 'cactus';
    spawnObstacle(type);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    // Vertical physics.
    let g = GRAVITY;
    if (dino.ducking && !dino.onGround) g += DUCK_GRAVITY;
    dino.vy += g * h;
    dino.y += dino.vy * h;
    if (dino.y >= GROUND_Y) {
        dino.y = GROUND_Y;
        dino.vy = 0;
        dino.onGround = true;
    }

    // Advance the world.
    distance += speed * h;
    speed = Math.min(MAX_SPEED, BASE_SPEED + distance * SPEED_RAMP);
    for (const o of obstacles) {
        o.x -= speed * h;
        if (o.type === 'bird') o.flap += h * 12;
    }
    for (let i = obstacles.length - 1; i >= 0; i--) {
        if (obstacles[i].x + obstacles[i].w < 0) obstacles.splice(i, 1);
    }
    for (const c of clouds) c.x -= speed * 0.35 * h;
    for (let i = clouds.length - 1; i >= 0; i--) {
        if (clouds[i].x + 60 < 0) clouds.splice(i, 1);
    }

    // Spawn on a distance-based timer.
    if (distance >= nextSpawnDist) {
        autoSpawn();
        scheduleNextSpawn();
    }

    score = Math.floor(distance / 10);

    // Collision.
    const hb = dinoHitbox();
    for (const o of obstacles) {
        if (aabb(hb, o)) {
            endGame();
            return;
        }
    }
}

// Advance the simulation by `dt` seconds, in small fixed sub-steps so the
// integration is stable and resolution-independent.
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
// Player actions
// ---------------------------------------------------------------------------

function jump() {
    if (state !== 'running') return;
    if (dino.onGround) {
        dino.vy = JUMP_V;
        dino.onGround = false;
    }
}

function setDuck(on) {
    dino.ducking = !!on;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    distance = 0;
    score = 0;
    speed = BASE_SPEED;
    nextSpawnDist = INITIAL_SPAWN;
    obstacles.length = 0;
    dino.y = GROUND_Y;
    dino.vy = 0;
    dino.onGround = true;
    dino.ducking = false;
    if (clouds.length === 0) seedClouds();
    hideOverlay();
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('dino-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Score ' + score, 'Press Space to run again', 'Play Again');
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
// Rendering
// ---------------------------------------------------------------------------

function seedClouds() {
    clouds.length = 0;
    for (let i = 0; i < 4; i++) {
        clouds.push({ x: Math.random() * CANVAS_W, y: 20 + Math.random() * 60 });
    }
}

function draw() {
    // Sky.
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Clouds.
    ctx.fillStyle = '#1c2540';
    for (const c of clouds) {
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, 26, 10, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Ground line.
    ctx.strokeStyle = '#3b4a6b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 1);
    ctx.lineTo(CANVAS_W, GROUND_Y + 1);
    ctx.stroke();
    // Dashed motion markers on the floor.
    ctx.strokeStyle = '#26314d';
    ctx.setLineDash([12, 18]);
    ctx.lineDashOffset = -((distance || 0) % 30);
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 10);
    ctx.lineTo(CANVAS_W, GROUND_Y + 10);
    ctx.stroke();
    ctx.setLineDash([]);

    // Obstacles.
    for (const o of obstacles) {
        if (o.type === 'cactus') {
            ctx.fillStyle = '#4ade80';
            ctx.fillRect(o.x + o.w / 2 - 4, o.y, 8, o.h);           // trunk
            ctx.fillRect(o.x, o.y + o.h * 0.35, 6, o.h * 0.35);     // left arm
            ctx.fillRect(o.x + o.w - 6, o.y + o.h * 0.2, 6, o.h * 0.4); // right arm
        } else {
            ctx.fillStyle = '#f472b6';
            const flapUp = Math.sin(o.flap) > 0;
            ctx.fillRect(o.x, o.y + o.h / 2 - 3, o.w, 6);           // body
            ctx.fillRect(o.x + 6, flapUp ? o.y : o.y + o.h - 8, o.w - 18, 8); // wing
        }
    }

    // Dino.
    const hb = dinoHitbox();
    ctx.fillStyle = state === 'over' ? '#ef4444' : '#e2e8f0';
    ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
    // Eye.
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(hb.x + hb.w - 12, hb.y + 6, 5, 5);
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
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (START_KEYS.has(e.key)) {
        if (state === 'running') jump();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (DUCK_KEYS.has(e.key)) {
        if (state === 'running') { setDuck(true); e.preventDefault(); }
    }
});

window.addEventListener('keyup', (e) => {
    if (DUCK_KEYS.has(e.key)) setDuck(false);
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('dino-best') || '0', 10) || 0;
state = 'idle';
score = 0;
distance = 0;
speed = BASE_SPEED;
nextSpawnDist = INITIAL_SPAWN;
seedClouds();
updateHud();
requestAnimationFrame(frame);
