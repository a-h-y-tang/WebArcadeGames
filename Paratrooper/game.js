// ---------------------------------------------------------------------------
// Paratrooper — defend a lone tower from an airborne invasion.
//
// Helicopters cross the sky from both edges and drop paratroopers. Every man
// who reaches the sand walks to the tower and joins the pile on his side; four
// on the same side scale the wall and the run is over. The gun on the tower
// cannot depress below the horizon, so a trooper who lands is a trooper you
// keep — the game is about clearing the sky in time.
//
// Written as a single classic (non-module) script so every piece of state and
// every function is a plain global, reachable from the Playwright specs the
// same way Slime Volley, Kaboom and Tetris are in this repo. All motion is
// expressed per second and advanced through `step(dt)` in fixed sub-steps, so
// tests can simulate frames deterministically without leaning on
// requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Field geometry ---
const CANVAS_W = 640;
const CANVAS_H = 420;
const GROUND_Y = 380;               // the sand line troopers stand on
const TOWER_X = CANVAS_W / 2;       // the tower is dead centre
const TOWER_HALF_W = 14;
const TOWER_TOP = 300;
const PIVOT_Y = TOWER_TOP;          // the gun pivots on the tower roof

// --- Gun ---
const BARREL_LEN = 30;
const MAX_ANGLE = 1.2;              // radians from vertical — never the horizon
const TURRET_SPEED = 2.4;           // rad/s of swing
const BULLET_SPEED = 430;
const BULLET_R = 3;
const MAX_BULLETS = 5;              // shells in flight at once
const FIRE_COOLDOWN = 0.14;         // seconds between shots

// --- Helicopters ---
const HELI_W = 48;
const HELI_H = 16;
const HELI_MIN_Y = 50;
const HELI_MAX_Y = 180;             // comfortably above TOWER_TOP
const HELI_CAPACITY = 2;            // troopers carried
const HELI_BASE_SPEED = 78;         // px/s at wave 1
const HELI_WAVE_SPEED = 9;          // extra px/s per wave
const HELI_MAX_SPEED = 190;
const DROP_INTERVAL = 1.15;         // seconds between a helicopter's drops
const DROP_MARGIN = 70;             // no drops this close to a screen edge
const TOWER_SAFE = 40;              // ...nor this close to the tower centre

// --- Paratroopers ---
const TROOPER_R = 7;
const CHUTE_FALL = 52;              // px/s under a parachute
const WALK_SPEED = 30;              // px/s once on the sand
const STACK_STEP = 15;              // spacing between stacked bodies
const STACK_GAP = 8;                // gap between the tower and the first body
const STACK_LIMIT = 4;              // this many on one side storms the tower

// --- Match ---
const WAVE_SECONDS = 20;            // how long a wave lasts
const SPAWN_BASE = 3.8;             // seconds between helicopters at wave 1
const SPAWN_WAVE_STEP = 0.22;       // ...shortened by this much per wave
const SPAWN_MIN = 1.1;
const SPAWN_JITTER = 0.6;
const FIRST_SPAWN = 1.6;            // grace period at the start of a run
const SCORE_HELI = 20;
const SCORE_TROOPER = 5;
const MAX_SUBSTEP = 0.02;           // physics slice, keeps fast objects honest
const MAX_FRAME_DT = 0.05;          // a backgrounded tab must not leap ahead

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const waveEl = document.getElementById('wave');
const stackLeftEl = document.getElementById('stack-left');
const stackRightEl = document.getElementById('stack-right');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State (var, so the specs can also reach it as window.<name>) ---
var state = 'idle';                 // 'idle' | 'running' | 'paused' | 'over'
var score = 0;
var best = 0;
var wave = 1;
var elapsed = 0;                    // seconds of play in this run
var spawnTimer = FIRST_SPAWN;
var turret = { angle: 0, dir: 0, cooldown: 0 };
var bullets = [];
var helicopters = [];
var troopers = [];
var particles = [];
var heldKeys = new Set();

// ---------------------------------------------------------------------------
// Deterministic randomness
//
// Everything random goes through rng() so a test can seed it and replay an
// identical wave. mulberry32 — small, fast, good enough for arcade jitter.
// ---------------------------------------------------------------------------

var rngState = 0x9e3779b9;

function seedRng(seed) {
    rngState = seed >>> 0;
}

function rng() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randRange(lo, hi) {
    return lo + rng() * (hi - lo);
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

function spawnInterval() {
    const base = Math.max(SPAWN_MIN, SPAWN_BASE - SPAWN_WAVE_STEP * (wave - 1));
    return base + rng() * SPAWN_JITTER;
}

function heliSpeed() {
    return Math.min(HELI_MAX_SPEED, HELI_BASE_SPEED + HELI_WAVE_SPEED * (wave - 1));
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

function spawnHelicopter(side, y) {
    const from = side || (rng() < 0.5 ? 'left' : 'right');
    const alt = y === undefined ? randRange(HELI_MIN_Y, HELI_MAX_Y) : y;
    const speed = heliSpeed();
    helicopters.push({
        x: from === 'left' ? -HELI_W : CANVAS_W + HELI_W,
        y: alt,
        vx: from === 'left' ? speed : -speed,
        troopsLeft: HELI_CAPACITY,
        dropTimer: randRange(0.4, DROP_INTERVAL),
        rotor: rng() * Math.PI * 2,
    });
}

function spawnTrooper(x, y) {
    troopers.push({
        x,
        y,
        phase: 'chute',
        side: null,
        stackIndex: -1,
        sway: rng() * Math.PI * 2,
        step: rng() * Math.PI * 2,     // walk-cycle phase, for the legs
    });
}

function burst(x, y, colour, count) {
    for (let i = 0; i < count; i++) {
        const a = rng() * Math.PI * 2;
        const speed = randRange(40, 190);
        particles.push({
            x, y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed - 40,
            life: randRange(0.25, 0.7),
            age: 0,
            colour,
        });
    }
}

// ---------------------------------------------------------------------------
// The stack beside the tower
// ---------------------------------------------------------------------------

function countStack(side) {
    let n = 0;
    for (const t of troopers) {
        if (t.phase === 'stacked' && t.side === side) n++;
    }
    return n;
}

function stackX(side, index) {
    const offset = TOWER_HALF_W + STACK_GAP + index * STACK_STEP;
    return side === 'left' ? TOWER_X - offset : TOWER_X + offset;
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function fire() {
    if (state !== 'running') return;
    if (turret.cooldown > 0 || bullets.length >= MAX_BULLETS) return;
    const sin = Math.sin(turret.angle);
    const cos = Math.cos(turret.angle);
    bullets.push({
        x: TOWER_X + sin * BARREL_LEN,
        y: PIVOT_Y - cos * BARREL_LEN,
        vx: sin * BULLET_SPEED,
        vy: -cos * BULLET_SPEED,
    });
    turret.cooldown = FIRE_COOLDOWN;
}

function refreshKeyDir() {
    let dir = 0;
    if (heldKeys.has('ArrowLeft') || heldKeys.has('a') || heldKeys.has('A')) dir -= 1;
    if (heldKeys.has('ArrowRight') || heldKeys.has('d') || heldKeys.has('D')) dir += 1;
    turret.dir = dir;
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    elapsed += dt;
    wave = Math.floor(elapsed / WAVE_SECONDS) + 1;

    let remaining = dt;
    while (remaining > 0 && state === 'running') {
        const slice = Math.min(MAX_SUBSTEP, remaining);
        remaining -= slice;
        substep(slice);
    }

    updateHud();
}

function substep(dt) {
    // Gun
    if (turret.dir !== 0) {
        turret.angle += turret.dir * TURRET_SPEED * dt;
        turret.angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, turret.angle));
    }
    if (turret.cooldown > 0) turret.cooldown -= dt;

    // Reinforcements
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawnHelicopter();
        spawnTimer = spawnInterval();
    }

    stepBullets(dt);
    stepHelicopters(dt);
    stepTroopers(dt);
    stepParticles(dt);
    resolveHits();

    if (countStack('left') >= STACK_LIMIT || countStack('right') >= STACK_LIMIT) {
        gameOver();
    }
}

function stepBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x < -12 || b.x > CANVAS_W + 12 || b.y < -12 || b.y > GROUND_Y) {
            bullets.splice(i, 1);
        }
    }
}

function stepHelicopters(dt) {
    for (let i = helicopters.length - 1; i >= 0; i--) {
        const h = helicopters[i];
        h.x += h.vx * dt;
        h.rotor += dt * 26;

        h.dropTimer -= dt;
        if (h.dropTimer <= 0 && h.troopsLeft > 0 && canDropAt(h.x)) {
            spawnTrooper(h.x, h.y + HELI_H / 2);
            h.troopsLeft--;
            h.dropTimer = DROP_INTERVAL;
        }

        if (h.x < -HELI_W * 2 || h.x > CANVAS_W + HELI_W * 2) {
            helicopters.splice(i, 1);
        }
    }
}

function canDropAt(x) {
    if (x < DROP_MARGIN || x > CANVAS_W - DROP_MARGIN) return false;
    return Math.abs(x - TOWER_X) >= TOWER_SAFE;
}

function stepTroopers(dt) {
    for (const t of troopers) {
        if (t.phase === 'chute') {
            t.y += CHUTE_FALL * dt;
            t.sway += dt * 1.6;
            if (t.y >= GROUND_Y) {
                t.y = GROUND_Y;
                t.phase = 'walk';
                t.side = t.x < TOWER_X ? 'left' : 'right';
            }
        } else if (t.phase === 'walk') {
            const index = countStack(t.side);
            const target = stackX(t.side, index);
            const dir = t.side === 'left' ? 1 : -1;
            t.x += dir * WALK_SPEED * dt;
            t.step += dt * 7;
            if ((dir > 0 && t.x >= target) || (dir < 0 && t.x <= target)) {
                t.x = target;
                t.phase = 'stacked';
                t.stackIndex = index;
            }
        }
    }
}

function stepParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) {
            particles.splice(i, 1);
            continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 420 * dt;
    }
}

function resolveHits() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        let hit = false;

        for (let j = helicopters.length - 1; j >= 0 && !hit; j--) {
            const h = helicopters[j];
            if (Math.abs(b.x - h.x) <= HELI_W / 2 && Math.abs(b.y - h.y) <= HELI_H / 2) {
                helicopters.splice(j, 1);
                burst(h.x, h.y, '#ff9a3c', 22);
                score += SCORE_HELI;
                hit = true;
            }
        }

        for (let j = troopers.length - 1; j >= 0 && !hit; j--) {
            const t = troopers[j];
            if (t.phase !== 'chute') continue;      // the gun cannot reach the sand
            const dx = b.x - t.x;
            const dy = b.y - t.y;
            if (dx * dx + dy * dy <= (TROOPER_R + BULLET_R) * (TROOPER_R + BULLET_R)) {
                troopers.splice(j, 1);
                burst(t.x, t.y, '#ffd76a', 12);
                score += SCORE_TROOPER;
                hit = true;
            }
        }

        if (hit) bullets.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Match flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    wave = 1;
    elapsed = 0;
    spawnTimer = FIRST_SPAWN;
    turret = { angle: 0, dir: 0, cooldown: 0 };
    bullets = [];
    helicopters = [];
    troopers = [];
    particles = [];
    refreshKeyDir();
    hideOverlay();
    updateHud();
}

function gameOver() {
    state = 'over';
    burst(TOWER_X, TOWER_TOP + 20, '#f2705f', 40);
    if (score > best) {
        best = score;
        saveBest(best);
    }
    showOverlay(
        'TOWER OVERRUN',
        `Score ${score} · Best ${best} · Wave ${wave}`,
        'Press Space or R to defend again',
    );
    updateHud();
}

function saveBest(value) {
    try {
        localStorage.setItem('paratrooper-best', String(value));
    } catch (err) {
        /* private mode or a file:// sandbox — the run still stands */
    }
}

function loadBest() {
    try {
        return parseInt(localStorage.getItem('paratrooper-best') || '0', 10) || 0;
    } catch (err) {
        return 0;
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    waveEl.textContent = String(wave);
    stackLeftEl.textContent = String(countStack('left'));
    stackRightEl.textContent = String(countStack('right'));
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    drawSky();
    drawGround();
    drawTower();
    for (const h of helicopters) drawHelicopter(h);
    for (const t of troopers) drawTrooper(t);
    drawBullets();
    drawParticles();
    updateHud();
}

function drawSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, '#0a1a30');
    sky.addColorStop(0.55, '#153a5e');
    sky.addColorStop(1, '#3d6f8e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, GROUND_Y);

    // A low moon and a few stars, drawn from fixed positions so the backdrop
    // never flickers between frames.
    ctx.fillStyle = '#f6f2d8';
    ctx.beginPath();
    ctx.arc(78, 62, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#dfe9f5';
    for (let i = 0; i < 34; i++) {
        const x = (i * 149) % CANVAS_W;
        const y = (i * 71) % 190;
        ctx.fillRect(x, y, 2, 2);
    }
}

function drawGround() {
    const sand = ctx.createLinearGradient(0, GROUND_Y, 0, CANVAS_H);
    sand.addColorStop(0, '#c8a463');
    sand.addColorStop(1, '#7d6437');
    ctx.fillStyle = sand;
    ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(0, GROUND_Y, CANVAS_W, 3);
}

function drawTower() {
    // Body
    ctx.fillStyle = '#5b6b86';
    ctx.fillRect(TOWER_X - TOWER_HALF_W, TOWER_TOP, TOWER_HALF_W * 2, GROUND_Y - TOWER_TOP);
    ctx.fillStyle = '#43506a';
    for (let y = TOWER_TOP + 10; y < GROUND_Y; y += 16) {
        ctx.fillRect(TOWER_X - TOWER_HALF_W, y, TOWER_HALF_W * 2, 3);
    }

    // Roof and gun mount
    ctx.fillStyle = '#8494b2';
    ctx.fillRect(TOWER_X - TOWER_HALF_W - 6, TOWER_TOP - 6, (TOWER_HALF_W + 6) * 2, 6);

    // Barrel
    ctx.save();
    ctx.translate(TOWER_X, PIVOT_Y);
    ctx.rotate(turret.angle);
    ctx.fillStyle = '#ffcf5c';
    ctx.fillRect(-4, -BARREL_LEN, 8, BARREL_LEN);
    ctx.restore();
    ctx.fillStyle = '#ffcf5c';
    ctx.beginPath();
    ctx.arc(TOWER_X, PIVOT_Y, 9, Math.PI, Math.PI * 2);
    ctx.fill();
}

function drawHelicopter(h) {
    const facing = h.vx >= 0 ? 1 : -1;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.scale(facing, 1);

    // Tail boom and fin
    ctx.fillStyle = '#39506f';
    ctx.fillRect(-HELI_W / 2, -2, HELI_W * 0.45, 4);
    ctx.fillRect(-HELI_W / 2, -10, 4, 10);

    // Cabin
    ctx.fillStyle = '#6f88ad';
    ctx.beginPath();
    ctx.ellipse(6, 0, HELI_W * 0.3, HELI_H * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cockpit glass
    ctx.fillStyle = '#cfe6ff';
    ctx.beginPath();
    ctx.ellipse(13, -1, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Skids
    ctx.strokeStyle = '#2b3d57';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4, 9);
    ctx.lineTo(16, 9);
    ctx.stroke();

    // Rotor — a squashed blade so the spin reads at a glance
    const span = Math.abs(Math.cos(h.rotor)) * 22 + 4;
    ctx.fillStyle = '#dfe9f5';
    ctx.fillRect(6 - span, -11, span * 2, 2);
    ctx.fillRect(4, -11, 3, 5);

    ctx.restore();
}

function drawTrooper(t) {
    const swing = t.phase === 'chute' ? Math.sin(t.sway) * 5 : 0;

    if (t.phase === 'chute') {
        // Canopy
        ctx.fillStyle = '#f2705f';
        ctx.beginPath();
        ctx.arc(t.x + swing, t.y - 30, 15, Math.PI, Math.PI * 2);
        ctx.fill();
        // Rigging
        ctx.strokeStyle = '#e8eef8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(t.x + swing - 14, t.y - 30);
        ctx.lineTo(t.x, t.y - 12);
        ctx.moveTo(t.x + swing + 14, t.y - 30);
        ctx.lineTo(t.x, t.y - 12);
        ctx.stroke();
    }

    // Body — y is the feet, so the man is drawn upward from there
    ctx.fillStyle = '#d8dee9';
    ctx.fillRect(t.x - 3, t.y - 12, 6, 8);
    ctx.beginPath();
    ctx.arc(t.x, t.y - 15, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#d8dee9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (t.phase === 'walk') {
        const stride = Math.sin(t.step) * 3;
        ctx.moveTo(t.x, t.y - 4);
        ctx.lineTo(t.x - stride, t.y);
        ctx.moveTo(t.x, t.y - 4);
        ctx.lineTo(t.x + stride, t.y);
    } else {
        ctx.moveTo(t.x - 2, t.y - 4);
        ctx.lineTo(t.x - 2, t.y);
        ctx.moveTo(t.x + 2, t.y - 4);
        ctx.lineTo(t.x + 2, t.y);
    }
    ctx.stroke();
}

function drawBullets() {
    ctx.fillStyle = '#ffe9a8';
    for (const b of bullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
        ctx.fillStyle = p.colour;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Frame driver
// ---------------------------------------------------------------------------

var lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min(MAX_FRAME_DT, (now - lastTime) / 1000) : 0;
    lastTime = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    if (e.repeat && e.key === ' ') {
        e.preventDefault();
        return;
    }

    if (e.key === ' ' || e.code === 'Space') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') fire();
        e.preventDefault();
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        e.preventDefault();
        return;
    }
    if (e.key === 'r' || e.key === 'R') {
        if (state !== 'idle') startGame();
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

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

seedRng((Date.now() ^ 0x5f3759df) >>> 0);
best = loadBest();
state = 'idle';
updateHud();
draw();
requestAnimationFrame(frame);
