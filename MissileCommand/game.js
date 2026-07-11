// --- Field & object dimensions ---
const WIDTH = 600;
const HEIGHT = 500;
const GROUND_Y = HEIGHT - 30;

const NUM_CITIES = 6;
const CITY_W = 46;
const CITY_H = 26;
// Six cities: three on each side of the central battery.
const CITY_XS = [40, 120, 200, 356, 436, 516];

const BASE = { x: WIDTH / 2, y: GROUND_Y };

// Motion is expressed in pixels-per-millisecond so it is frame-rate independent.
const INTERCEPTOR_SPEED = 0.55; // player counter-missiles
const ENEMY_BASE_SPEED = 0.055; // falling enemy missiles at wave 1
const EXPLOSION_MAX_R = 42;     // maximum blast radius
const EXPLOSION_GROW = 0.09;    // blast radius change per millisecond

const AMMO_PER_WAVE = 25;
const MISSILE_POINTS = 25; // points per intercepted missile
const CITY_BONUS = 100;    // end-of-wave bonus per surviving city
const BASE_WAVE_MISSILES = 8;

// Random enemy spawn cadence (ms) — used only by the animation loop, never step().
const FIRST_SPAWN_DELAY = 1000;
const SPAWN_INTERVAL_MIN = 600;
const SPAWN_INTERVAL_MAX = 1500;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const citiesEl = document.getElementById('cities');
const ammoEl = document.getElementById('ammo');
const waveEl = document.getElementById('wave');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let cities, enemyMissiles, interceptors, explosions;
let score, best, wave, ammo, state, lastTime, animId;
let spawnedThisWave, waveTotal, spawnTimer;
let mouse = { x: WIDTH / 2, y: HEIGHT / 2 };

// -----------------------------------------------------------------------
// Setup helpers
// -----------------------------------------------------------------------
function buildCities() {
    cities = CITY_XS.map(x => ({
        x,
        y: GROUND_Y - CITY_H,
        w: CITY_W,
        h: CITY_H,
        alive: true,
    }));
}

function enemySpeed() {
    return ENEMY_BASE_SPEED * (1 + (wave - 1) * 0.15);
}

function citiesAlive() {
    return cities.filter(c => c.alive).length;
}

function updateCitiesHud() {
    citiesEl.textContent = citiesAlive();
}

// -----------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------
function fireInterceptor(tx, ty) {
    if (state !== 'running') return;
    if (ammo <= 0) return;
    const dx = tx - BASE.x;
    const dy = ty - BASE.y;
    const d = Math.hypot(dx, dy) || 1;
    interceptors.push({
        x: BASE.x,
        y: BASE.y,
        tx,
        ty,
        vx: (dx / d) * INTERCEPTOR_SPEED,
        vy: (dy / d) * INTERCEPTOR_SPEED,
    });
    ammo--;
    ammoEl.textContent = ammo;
}

function spawnExplosion(x, y) {
    explosions.push({ x, y, r: 0, maxR: EXPLOSION_MAX_R, phase: 'grow' });
}

// Launch an enemy missile from the top toward a random surviving city (or the
// bare ground if none remain). Uses randomness, so it is only ever called from
// the animation loop (or directly by tests).
function spawnEnemyMissile() {
    const sx = Math.random() * WIDTH;
    const alive = cities.map((c, i) => ({ c, i })).filter(o => o.c.alive);
    let tx, ty, cityIndex;
    if (alive.length > 0) {
        const pick = alive[Math.floor(Math.random() * alive.length)];
        tx = pick.c.x + pick.c.w / 2;
        ty = pick.c.y;
        cityIndex = pick.i;
    } else {
        tx = Math.random() * WIDTH;
        ty = GROUND_Y;
        cityIndex = null;
    }
    const dx = tx - sx;
    const dy = ty - 0;
    const d = Math.hypot(dx, dy) || 1;
    const spd = enemySpeed();
    enemyMissiles.push({
        x: sx,
        y: 0,
        sx,
        sy: 0,
        vx: (dx / d) * spd,
        vy: (dy / d) * spd,
        targetX: tx,
        targetY: ty,
        cityIndex,
    });
}

// -----------------------------------------------------------------------
// Game lifecycle
// -----------------------------------------------------------------------
function startGame() {
    score = 0;
    wave = 1;
    ammo = AMMO_PER_WAVE;
    buildCities();
    enemyMissiles = [];
    interceptors = [];
    explosions = [];
    spawnedThisWave = 0;
    waveTotal = BASE_WAVE_MISSILES;
    spawnTimer = FIRST_SPAWN_DELAY;
    state = 'running';

    scoreEl.textContent = score;
    waveEl.textContent = wave;
    ammoEl.textContent = ammo;
    updateCitiesHud();
    overlay.classList.remove('visible');

    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function nextWave() {
    // Bonus for every city still standing.
    score += citiesAlive() * CITY_BONUS;
    scoreEl.textContent = score;

    wave++;
    waveEl.textContent = wave;
    ammo = AMMO_PER_WAVE;
    ammoEl.textContent = ammo;
    spawnedThisWave = 0;
    waveTotal = BASE_WAVE_MISSILES + (wave - 1) * 3;
    spawnTimer = FIRST_SPAWN_DELAY;
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('missile-command-best', best);
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
// Simulation — advance the world by dt milliseconds. Fully deterministic.
// -----------------------------------------------------------------------
function updateExplosions(dt) {
    for (let i = explosions.length - 1; i >= 0; i--) {
        const e = explosions[i];
        if (e.phase === 'grow') {
            e.r += EXPLOSION_GROW * dt;
            if (e.r >= e.maxR) {
                // Carry any leftover time straight into the shrink phase so a
                // single large dt can fully resolve the blast.
                const overshoot = (e.r - e.maxR) / EXPLOSION_GROW;
                e.r = e.maxR - EXPLOSION_GROW * overshoot;
                e.phase = 'shrink';
            }
        } else {
            e.r -= EXPLOSION_GROW * dt;
        }
        if (e.phase === 'shrink' && e.r <= 0) {
            explosions.splice(i, 1);
        }
    }
}

function moveInterceptors(dt) {
    for (let i = interceptors.length - 1; i >= 0; i--) {
        const m = interceptors[i];
        const remaining = Math.hypot(m.tx - m.x, m.ty - m.y);
        const travel = INTERCEPTOR_SPEED * dt;
        if (travel >= remaining) {
            spawnExplosion(m.tx, m.ty);
            interceptors.splice(i, 1);
        } else {
            m.x += m.vx * dt;
            m.y += m.vy * dt;
        }
    }
}

function step(dt) {
    if (state !== 'running') return;

    // Advance existing blasts first; interceptors that detonate this frame
    // create fresh blasts that only become active next frame.
    updateExplosions(dt);
    moveInterceptors(dt);

    // Enemy missiles: caught by a blast, else fall and possibly hit a city.
    for (let i = enemyMissiles.length - 1; i >= 0; i--) {
        const m = enemyMissiles[i];

        let caught = false;
        for (const e of explosions) {
            if (Math.hypot(m.x - e.x, m.y - e.y) <= e.r) {
                caught = true;
                break;
            }
        }
        if (caught) {
            enemyMissiles.splice(i, 1);
            score += MISSILE_POINTS;
            scoreEl.textContent = score;
            continue;
        }

        m.x += m.vx * dt;
        m.y += m.vy * dt;

        if (m.y >= m.targetY) {
            if (m.cityIndex != null && cities[m.cityIndex].alive) {
                cities[m.cityIndex].alive = false;
                updateCitiesHud();
            }
            enemyMissiles.splice(i, 1);
        }
    }

    if (citiesAlive() === 0) {
        endGame();
        return;
    }

    maybeAdvanceWave();
}

function maybeAdvanceWave() {
    if (
        spawnedThisWave >= waveTotal &&
        enemyMissiles.length === 0 &&
        explosions.length === 0
    ) {
        nextWave();
    }
}

// -----------------------------------------------------------------------
// Non-deterministic timing (enemy spawning) — loop-only, never in step().
// -----------------------------------------------------------------------
function updateSpawning(dt) {
    if (spawnedThisWave >= waveTotal) return;
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawnEnemyMissile();
        spawnedThisWave++;
        spawnTimer = SPAWN_INTERVAL_MIN + Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);
    }
}

// -----------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------
function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = Math.min(50, timestamp - lastTime); // clamp big frame gaps
    lastTime = timestamp;

    if (state === 'running') {
        updateSpawning(elapsed);
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
    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, '#05070c');
    sky.addColorStop(1, '#0a1024');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Ground
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y);

    // Cities
    for (const c of cities) {
        drawCity(c);
    }

    // Battery
    drawBattery();

    // Enemy missile trails
    ctx.lineWidth = 2;
    for (const m of enemyMissiles) {
        const sx = m.sx ?? m.x;
        const sy = m.sy ?? 0;
        ctx.strokeStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(m.x, m.y);
        ctx.stroke();
        ctx.fillStyle = '#fca5a5';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // Interceptor trails
    for (const m of interceptors) {
        ctx.strokeStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(BASE.x, BASE.y);
        ctx.lineTo(m.x, m.y);
        ctx.stroke();
        ctx.fillStyle = '#e0f2fe';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // Blasts
    for (const e of explosions) {
        const alpha = e.phase === 'grow' ? 0.85 : 0.85 * (e.r / e.maxR);
        ctx.fillStyle = `rgba(249, 158, 22, ${Math.max(0, alpha)})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, Math.max(0, e.r), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, alpha * 0.6)})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, Math.max(0, e.r * 0.45), 0, Math.PI * 2);
        ctx.fill();
    }

    // Targeting reticle
    if (state === 'running') {
        ctx.strokeStyle = '#f97316aa';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(mouse.x - 8, mouse.y);
        ctx.lineTo(mouse.x + 8, mouse.y);
        ctx.moveTo(mouse.x, mouse.y - 8);
        ctx.lineTo(mouse.x, mouse.y + 8);
        ctx.stroke();
    }
}

function drawCity(c) {
    if (c.alive) {
        ctx.fillStyle = '#22d3ee';
        ctx.shadowColor = '#22d3ee88';
        ctx.shadowBlur = 8;
        // A little skyline: three blocks of varying height.
        ctx.fillRect(c.x, c.y + 10, c.w, c.h - 10);
        ctx.fillRect(c.x + 4, c.y + 2, 10, c.h - 2);
        ctx.fillRect(c.x + c.w / 2 - 5, c.y, 10, c.h);
        ctx.fillRect(c.x + c.w - 14, c.y + 6, 10, c.h - 6);
        ctx.shadowBlur = 0;
    } else {
        // Rubble
        ctx.fillStyle = '#374151';
        ctx.fillRect(c.x, c.y + c.h - 6, c.w, 6);
        ctx.fillRect(c.x + 6, c.y + c.h - 11, 12, 5);
        ctx.fillRect(c.x + c.w - 18, c.y + c.h - 10, 12, 4);
    }
}

function drawBattery() {
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.moveTo(BASE.x, BASE.y - 18);
    ctx.lineTo(BASE.x - 16, BASE.y);
    ctx.lineTo(BASE.x + 16, BASE.y);
    ctx.closePath();
    ctx.fill();
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
const START_KEYS = [' ', 'Enter'];

function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (WIDTH / rect.width),
        y: (e.clientY - rect.top) * (HEIGHT / rect.height),
    };
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
    }
});

canvas.addEventListener('mousemove', e => {
    mouse = canvasPoint(e);
});

canvas.addEventListener('mousedown', e => {
    const p = canvasPoint(e);
    mouse = p;
    if (state === 'running') {
        fireInterceptor(p.x, p.y);
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
best = parseInt(localStorage.getItem('missile-command-best') || '0', 10);
bestEl.textContent = best;
score = 0;
wave = 1;
ammo = AMMO_PER_WAVE;
state = 'idle';
enemyMissiles = [];
interceptors = [];
explosions = [];
spawnedThisWave = 0;
waveTotal = BASE_WAVE_MISSILES;
spawnTimer = FIRST_SPAWN_DELAY;
buildCities();
updateCitiesHud();
ammoEl.textContent = ammo;
draw();
