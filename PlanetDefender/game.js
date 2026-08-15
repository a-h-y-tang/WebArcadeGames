// ---------------------------------------------------------------------------
// Planet Defender — a side-scrolling rescue shooter on a wrapping planet.
//
// The world is four screens wide and joined end to end. Alien landers hunt the
// humanoids standing on the surface, carry them to the top of the atmosphere and
// return as mutants. Shoot a carrier and its captive falls: catch it in mid-air
// and set it down, or watch it hit the ground. A scanner across the top of the
// canvas shows the whole planet, because the fight is always happening somewhere
// you cannot see.
//
// Written as a single classic (non-module) script so state and helpers are
// reachable from the Playwright specs as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. All motion is expressed per second and applied
// by `step(dt)`, so the tests can advance the simulation frame by frame without
// depending on requestAnimationFrame wall-clock timing (`autoStep = false`
// hands the clock entirely to the tests).
// ---------------------------------------------------------------------------

// --- World ---------------------------------------------------------------
const CANVAS_W = 800;
const CANVAS_H = 480;
const WORLD_W = 3200;            // planet circumference: 4 screens, wraps
const SCANNER_TOP = 8;
const SCANNER_H = 56;
const SCANNER_MARGIN = 12;
const VIEW_TOP = 76;             // top of the play area, below the scanner
const GROUND_Y = 436;            // mean surface height the humanoids stand on
const TERRAIN_STEP = 40;         // spacing of the terrain height samples
const SHIP_MIN_Y = 92;
const SHIP_MAX_Y = 424;
const ABDUCT_Y = 84;             // altitude at which a lifting lander escapes
const CAM_LEAD = 150;
const CAM_EASE = 4;

// --- Ship ----------------------------------------------------------------
const THRUST = 700;
const MAX_VX = 400;
const DRAG_X = 0.25;             // velocity multiplier per second when coasting
const VTHRUST = 900;
const MAX_VY = 280;
const DRAG_Y = 0.05;
const SHIP_HW = 15;
const SHIP_HH = 6;
const RESPAWN_INVULN = 2;

// --- Laser ---------------------------------------------------------------
const BULLET_SPEED = 940;
const BULLET_LIFE = 0.6;
const BULLET_COOLDOWN = 0.14;
const MAX_BULLETS = 8;
const BULLET_LEN = 28;

// --- Enemies -------------------------------------------------------------
const ENEMY_R = 13;
const LANDER_SPEED = 70;
const LANDER_DESCEND = 90;
const LANDER_LIFT = 78;
const GRAB_DX = 6;
const GRAB_DY = 10;
const MUTANT_ACCEL = 320;
const MUTANT_MAX = 230;
const MUTANT_JITTER = 120;
const BAITER_SPEED = 330;
const BAITER_AFTER = 25;         // seconds before a wave starts attracting baiters
const BAITER_INTERVAL = 12;
const MAX_BAITERS = 3;
const ENEMY_BULLET_SPEED = 300;
const ENEMY_BULLET_LIFE = 2.6;
const FIRE_RANGE = 560;
const FIRE_RATE = { lander: 0.22, mutant: 0.12, baiter: 0.45 }; // shots per second

// --- Humanoids -----------------------------------------------------------
const HUMANOID_COUNT = 10;
const HUM_HW = 4;
const HUM_H = 14;
const HUM_WALK = 16;
const HUM_GRAVITY = 260;
const HUM_MAX_FALL = 320;
const FATAL_FALL = 130;          // a longer drop than this kills on impact
const CATCH_R = 22;
const CARRY_OFFSET = 20;
const SET_DOWN_Y = GROUND_Y - 40;

// --- Scoring / run structure ---------------------------------------------
const POINTS = { lander: 150, mutant: 150, baiter: 200 };
const CATCH_POINTS = 500;
const RETURN_POINTS = 500;
const WAVE_BONUS = 100;          // × wave × surviving humanoids
const EXTRA_LIFE_EVERY = 10000;
const START_LIVES = 3;
const START_BOMBS = 3;
const MAX_BOMBS = 6;
const DEATH_PAUSE = 1.6;
const WAVE_PAUSE = 2.4;
const SHIP_START_X = 400;
const SAFE_SPAWN_GAP = 420;      // no wave lander starts closer than this to the ship

// --- Colours -------------------------------------------------------------
const COLOR = {
    lander: '#ff8a3d',
    mutant: '#ff4d6d',
    baiter: '#c56bff',
    ship: '#4ce0d2',
    human: '#8dff6b',
    laser: '#ffffff',
    enemyShot: '#ffd166',
};

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const waveEl = document.getElementById('wave');
const livesEl = document.getElementById('lives');
const bombsEl = document.getElementById('bombs');
const peopleEl = document.getElementById('people');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'dying' | 'wavecleared' | 'over'
let state, score, best, lives, wave, smartBombs, nextExtraLife;
let ship, bullets, enemies, enemyBullets, humanoids, particles;
let camX, fireCooldown, invuln, deathTimer, waveClearTimer;
let waveActive, waveTimer, baiterTimer, planetDestroyed, bombFlash;
let terrain, ridge, stars;

// Test hooks: switch off the pieces that would otherwise be time- or
// chance-driven so a spec can own the clock completely.
let autoStep = true;
let spawnEnabled = true;
let enemyFireEnabled = true;

const heldKeys = new Set();

// ---------------------------------------------------------------------------
// Deterministic PRNG — the game never calls Math.random, so a spec can pin the
// whole run with setSeed().
// ---------------------------------------------------------------------------

let seed = 1;

function setSeed(n) {
    seed = (n >>> 0) || 1;
}

function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
}

function randRange(lo, hi) {
    return lo + rand() * (hi - lo);
}

// ---------------------------------------------------------------------------
// Wrap-aware geometry
// ---------------------------------------------------------------------------

function wrapX(x) {
    return ((x % WORLD_W) + WORLD_W) % WORLD_W;
}

// Shortest signed distance from world x `from` to world x `to`, in
// [-WORLD_W/2, WORLD_W/2). Positive means `to` lies to the right of `from`.
function wrapDX(from, to) {
    const half = WORLD_W / 2;
    return ((((to - from) + half) % WORLD_W) + WORLD_W) % WORLD_W - half;
}

function worldToScreen(x) {
    return CANVAS_W / 2 + wrapDX(wrapX(camX + CANVAS_W / 2), x);
}

function onScreen(x, margin = 40) {
    const sx = worldToScreen(x);
    return sx > -margin && sx < CANVAS_W + margin;
}

function scannerX(x) {
    return SCANNER_MARGIN + (wrapX(x) / WORLD_W) * (CANVAS_W - 2 * SCANNER_MARGIN);
}

function scannerY(y) {
    const t = (y - VIEW_TOP) / (CANVAS_H - VIEW_TOP);
    return SCANNER_TOP + Math.max(0, Math.min(1, t)) * SCANNER_H;
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

// Height of the rolling surface at a world x, interpolated between samples, so
// humanoids stand on the terrain rather than on a notional flat line.
function groundYAt(x) {
    const w = wrapX(x);
    const i = Math.floor(w / TERRAIN_STEP);
    const a = terrain[i];
    const b = terrain[i + 1] || terrain[0];
    return a.y + (b.y - a.y) * ((w - i * TERRAIN_STEP) / TERRAIN_STEP);
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeHumanoid(x) {
    return {
        x: wrapX(x),
        y: groundYAt(x),
        vy: 0,
        dir: rand() < 0.5 ? -1 : 1,
        turnTimer: randRange(1, 3),
        state: 'ground',   // 'ground' | 'carried' | 'falling' | 'held'
        carrier: null,
        releaseY: groundYAt(x),
    };
}

function makeLander(x, y) {
    return {
        type: 'lander',
        x: wrapX(x),
        y,
        vx: 0,
        vy: 0,
        state: 'hunt',     // 'hunt' | 'lift'
        carrying: null,
        wobble: rand() * Math.PI * 2,
    };
}

function makeMutant(x, y) {
    return {
        type: 'mutant',
        x: wrapX(x),
        y,
        vx: 0,
        vy: 0,
        state: 'chase',
        carrying: null,
        wobble: rand() * Math.PI * 2,
    };
}

function makeBaiter(x, y) {
    return {
        type: 'baiter',
        x: wrapX(x),
        y,
        vx: 0,
        vy: 0,
        state: 'chase',
        carrying: null,
        wobble: rand() * Math.PI * 2,
    };
}

function spawnLander(x, y) {
    const e = makeLander(x, y);
    enemies.push(e);
    return e;
}

function spawnMutant(x, y) {
    const e = makeMutant(x, y);
    enemies.push(e);
    return e;
}

function spawnBaiter(x, y) {
    const e = makeBaiter(x, y);
    enemies.push(e);
    return e;
}

function burst(x, y, color, count = 12, speed = 150) {
    for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2;
        const s = randRange(speed * 0.3, speed);
        particles.push({
            x, y,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s,
            life: randRange(0.25, 0.7),
            color,
        });
    }
}

// ---------------------------------------------------------------------------
// World setup
// ---------------------------------------------------------------------------

function buildScenery() {
    terrain = [];
    for (let x = 0; x <= WORLD_W; x += TERRAIN_STEP) {
        terrain.push({ x, y: GROUND_Y + randRange(-8, 12) });
    }
    terrain[terrain.length - 1].y = terrain[0].y; // seam matches on wrap

    ridge = [];
    for (let x = 0; x <= WORLD_W; x += 80) {
        ridge.push({ x, y: GROUND_Y - randRange(20, 96) });
    }
    ridge[ridge.length - 1].y = ridge[0].y;

    stars = [];
    for (let i = 0; i < 160; i++) {
        stars.push({
            x: rand() * WORLD_W,
            y: randRange(VIEW_TOP + 4, GROUND_Y - 40),
            r: randRange(0.5, 1.6),
            depth: randRange(0.3, 0.8),
        });
    }
}

function stockPlanet() {
    humanoids = [];
    const slot = WORLD_W / HUMANOID_COUNT;
    for (let i = 0; i < HUMANOID_COUNT; i++) {
        humanoids.push(makeHumanoid(i * slot + slot / 2 + randRange(-slot / 4, slot / 4)));
    }
    planetDestroyed = false;
}

function resetShip() {
    ship.x = wrapX(camX + CANVAS_W / 2);
    ship.y = (VIEW_TOP + GROUND_Y) / 2;
    ship.vx = 0;
    ship.vy = 0;
    ship.held = null;
}

function startWave() {
    waveActive = true;
    waveTimer = 0;
    baiterTimer = 0;   // the first baiter arrives as soon as BAITER_AFTER passes
    const count = Math.min(4 + wave, 12);
    for (let i = 0; i < count; i++) {
        // Keep the wave off the player's doorstep: a lander that materialised on
        // top of the ship would kill it before the wave had started.
        let x = rand() * WORLD_W;
        for (let tries = 0; tries < 8 && Math.abs(wrapDX(x, ship.x)) < SAFE_SPAWN_GAP; tries++) {
            x = rand() * WORLD_W;
        }
        spawnLander(x, randRange(VIEW_TOP + 20, VIEW_TOP + 180));
    }
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    wave = 1;
    smartBombs = START_BOMBS;
    nextExtraLife = EXTRA_LIFE_EVERY;
    bullets = [];
    enemies = [];
    enemyBullets = [];
    particles = [];
    fireCooldown = 0;
    invuln = 0;
    deathTimer = 0;
    waveClearTimer = 0;
    bombFlash = 0;
    buildScenery();
    stockPlanet();
    ship.facing = 1;
    ship.x = SHIP_START_X;
    camX = wrapX(SHIP_START_X - CANVAS_W / 2 + CAM_LEAD);
    resetShip();
    ship.x = SHIP_START_X;
    startWave();
    state = 'running';
    hideOverlay();
    updateHud();
}

// ---------------------------------------------------------------------------
// Score, HUD, overlay
// ---------------------------------------------------------------------------

function addScore(points) {
    score += points;
    while (score >= nextExtraLife) {
        lives++;
        nextExtraLife += EXTRA_LIFE_EVERY;
    }
    updateHud();
}

function updateHud() {
    scoreEl.textContent = String(score);
    waveEl.textContent = String(wave);
    livesEl.textContent = String(lives);
    bombsEl.textContent = String(smartBombs);
    peopleEl.textContent = String(humanoids ? humanoids.length : 0);
    bestEl.textContent = String(best);
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

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('planet-defender-best', String(best));
        } catch (err) {
            /* storage unavailable — keep the in-memory best */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} — Best ${best}`, 'Press Space to play again');
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

function fire() {
    if (state !== 'running') return;
    if (fireCooldown > 0 || bullets.length >= MAX_BULLETS) return;
    fireCooldown = BULLET_COOLDOWN;
    bullets.push({
        x: wrapX(ship.x + ship.facing * (SHIP_HW + 4)),
        y: ship.y,
        vx: ship.facing * BULLET_SPEED,
        life: BULLET_LIFE,
    });
}

function smartBomb() {
    if (state !== 'running' || smartBombs <= 0) return;
    smartBombs--;
    bombFlash = 0.35;
    for (const e of enemies.slice()) {
        if (onScreen(e.x, 0)) killEnemy(e);
    }
    enemyBullets.length = 0;
    updateHud();
}

// ---------------------------------------------------------------------------
// Deaths
// ---------------------------------------------------------------------------

// `award` is false when the enemy dies by flying into the ship — that costs a
// life, so it should not also pay out.
function killEnemy(e, award = true) {
    const i = enemies.indexOf(e);
    if (i === -1) return;
    enemies.splice(i, 1);
    if (e.carrying) dropHumanoid(e.carrying);
    burst(e.x, e.y, COLOR[e.type]);
    if (award) addScore(POINTS[e.type]);
}

function dropHumanoid(h) {
    h.state = 'falling';
    h.carrier = null;
    h.vy = 0;
    h.releaseY = h.y;
}

function killHumanoid(h) {
    const i = humanoids.indexOf(h);
    if (i === -1) return;
    humanoids.splice(i, 1);
    burst(h.x, h.y, COLOR.human, 8, 90);
    updateHud();
    if (humanoids.length === 0 && !planetDestroyed) destroyPlanet();
}

// The last humanoid is gone: the planet is lost, every lander on the field
// mutates on the spot and the wave becomes a pure survival fight.
function destroyPlanet() {
    planetDestroyed = true;
    for (const e of enemies) {
        if (e.type === 'lander') {
            e.type = 'mutant';
            e.state = 'chase';
            e.carrying = null;
            e.vx = 0;
            e.vy = 0;
        }
    }
    for (const t of terrain) t.y = GROUND_Y + randRange(-10, 14);
}

function killShip() {
    if (state !== 'running' || invuln > 0) return;
    lives--;
    if (ship.held) {
        dropHumanoid(ship.held);
        ship.held = null;
    }
    burst(ship.x, ship.y, COLOR.ship, 24, 220);
    updateHud();
    if (lives <= 0) {
        gameOver();
    } else {
        state = 'dying';
        deathTimer = DEATH_PAUSE;
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        deathTimer -= dt;
        updateEnemies(dt, false);
        updateBullets(dt);
        updateHumanoids(dt, false);
        updateParticles(dt);
        if (deathTimer <= 0) {
            resetShip();
            invuln = RESPAWN_INVULN;
            state = 'running';
        }
        return;
    }

    if (state === 'wavecleared') {
        waveClearTimer -= dt;
        updateParticles(dt);
        if (waveClearTimer <= 0) nextWave();
        return;
    }

    if (state !== 'running') return;

    if (invuln > 0) invuln -= dt;
    if (fireCooldown > 0) fireCooldown -= dt;
    if (bombFlash > 0) bombFlash -= dt;
    if (waveActive) waveTimer += dt;

    updateShip(dt);
    updateCamera(dt);
    updateBullets(dt);
    updateEnemies(dt, true);
    updateEnemyBullets(dt);
    updateHumanoids(dt, true);
    updateParticles(dt);
    maybeSpawnBaiter(dt);
    checkCollisions();
    checkWaveComplete();
}

function inputAxis(negKeys, posKeys) {
    const neg = negKeys.some((k) => heldKeys.has(k));
    const pos = posKeys.some((k) => heldKeys.has(k));
    return (pos ? 1 : 0) - (neg ? 1 : 0);
}

function updateShip(dt) {
    const ax = inputAxis(['ArrowLeft', 'a'], ['ArrowRight', 'd']);
    if (ax) {
        ship.facing = ax;
        ship.vx += ax * THRUST * dt;
    } else {
        ship.vx *= Math.pow(DRAG_X, dt);
    }
    ship.vx = clamp(ship.vx, -MAX_VX, MAX_VX);

    const ay = inputAxis(['ArrowUp', 'w'], ['ArrowDown', 's']);
    if (ay) {
        ship.vy += ay * VTHRUST * dt;
    } else {
        ship.vy *= Math.pow(DRAG_Y, dt);
    }
    ship.vy = clamp(ship.vy, -MAX_VY, MAX_VY);

    ship.x = wrapX(ship.x + ship.vx * dt);
    ship.y += ship.vy * dt;
    if (ship.y < SHIP_MIN_Y) {
        ship.y = SHIP_MIN_Y;
        ship.vy = 0;
    }
    if (ship.y > SHIP_MAX_Y) {
        ship.y = SHIP_MAX_Y;
        ship.vy = 0;
    }
}

function updateCamera(dt) {
    const target = wrapX(ship.x - CANVAS_W / 2 + ship.facing * CAM_LEAD);
    camX = wrapX(camX + wrapDX(camX, target) * Math.min(1, CAM_EASE * dt));
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x = wrapX(b.x + b.vx * dt);
        b.life -= dt;
        if (b.life <= 0) bullets.splice(i, 1);
    }
}

function updateEnemyBullets(dt) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.x = wrapX(b.x + b.vx * dt);
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0 || b.y < VIEW_TOP || b.y > CANVAS_H) enemyBullets.splice(i, 1);
    }
}

function nearestGroundHumanoid(x) {
    let best = null;
    let bestD = Infinity;
    for (const h of humanoids) {
        if (h.state !== 'ground') continue;
        const d = Math.abs(wrapDX(x, h.x));
        if (d < bestD) {
            bestD = d;
            best = h;
        }
    }
    return best;
}

function updateEnemies(dt, shipAlive) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        e.wobble += dt * 4;

        if (e.type === 'lander') {
            updateLander(e, dt, i);
        } else if (e.type === 'mutant') {
            chase(e, dt, MUTANT_ACCEL, MUTANT_MAX, MUTANT_JITTER, shipAlive);
        } else {
            chase(e, dt, BAITER_SPEED * 2, BAITER_SPEED, 60, shipAlive);
        }

        if (shipAlive) maybeEnemyFire(e, dt);
    }
}

function updateLander(e, dt, index) {
    if (e.state === 'hunt') {
        const target = nearestGroundHumanoid(e.x);
        if (!target) {
            // Nothing to abduct: drift along the sky, waiting.
            e.x = wrapX(e.x + Math.sign(Math.cos(e.wobble * 0.2) || 1) * LANDER_SPEED * dt);
            return;
        }
        const dx = wrapDX(e.x, target.x);
        const stepX = Math.sign(dx) * Math.min(LANDER_SPEED * dt, Math.abs(dx));
        e.x = wrapX(e.x + stepX);

        const wantY = target.y - GRAB_DY;
        const dy = wantY - e.y;
        e.y += Math.sign(dy) * Math.min(LANDER_DESCEND * dt, Math.abs(dy));

        if (Math.abs(wrapDX(e.x, target.x)) < GRAB_DX && Math.abs(target.y - e.y) < GRAB_DY + 4) {
            e.state = 'lift';
            e.carrying = target;
            target.state = 'carried';
            target.carrier = e;
        }
        return;
    }

    // 'lift' — haul the captive to the top of the atmosphere.
    e.y -= LANDER_LIFT * dt;
    if (e.carrying) {
        e.carrying.x = e.x;
        e.carrying.y = e.y + CARRY_OFFSET;
    }
    if (e.y <= ABDUCT_Y) {
        const captive = e.carrying;
        const at = { x: e.x, y: Math.max(ABDUCT_Y, VIEW_TOP + 10) };
        enemies.splice(index, 1);
        if (captive) {
            captive.carrier = null;
            const i = humanoids.indexOf(captive);
            if (i !== -1) humanoids.splice(i, 1);
            burst(captive.x, captive.y, COLOR.human, 8, 90);
            updateHud();
        }
        spawnMutant(at.x, at.y + 16);
        if (humanoids.length === 0 && !planetDestroyed) destroyPlanet();
    }
}

function chase(e, dt, accel, maxSpeed, jitter, shipAlive) {
    if (!shipAlive) {
        e.x = wrapX(e.x + e.vx * dt);
        e.y = clamp(e.y + e.vy * dt, VIEW_TOP + 8, GROUND_Y - 6);
        return;
    }
    const dx = wrapDX(e.x, ship.x);
    const dy = ship.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.vx += (dx / d) * accel * dt + (rand() - 0.5) * jitter * dt;
    e.vy += (dy / d) * accel * dt + (rand() - 0.5) * jitter * dt;
    const speed = Math.hypot(e.vx, e.vy);
    if (speed > maxSpeed) {
        e.vx = (e.vx / speed) * maxSpeed;
        e.vy = (e.vy / speed) * maxSpeed;
    }
    e.x = wrapX(e.x + e.vx * dt);
    e.y = clamp(e.y + e.vy * dt, VIEW_TOP + 8, GROUND_Y - 6);
}

function maybeEnemyFire(e, dt) {
    if (!enemyFireEnabled || state !== 'running') return;
    if (e.type === 'lander' && e.state === 'lift') return;
    const dx = wrapDX(e.x, ship.x);
    if (Math.abs(dx) > FIRE_RANGE || !onScreen(e.x, 0)) return;
    if (rand() >= FIRE_RATE[e.type] * dt) return;
    const dy = ship.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    enemyBullets.push({
        x: e.x,
        y: e.y,
        vx: (dx / d) * ENEMY_BULLET_SPEED,
        vy: (dy / d) * ENEMY_BULLET_SPEED,
        life: ENEMY_BULLET_LIFE,
    });
}

function maybeSpawnBaiter(dt) {
    if (!spawnEnabled || !waveActive || waveTimer < BAITER_AFTER) return;
    baiterTimer -= dt;
    if (baiterTimer > 0) return;
    baiterTimer = BAITER_INTERVAL;
    if (enemies.filter((e) => e.type === 'baiter').length >= MAX_BAITERS) return;
    const side = rand() < 0.5 ? -1 : 1;
    spawnBaiter(ship.x + side * (CANVAS_W / 2 + 60), randRange(VIEW_TOP + 30, GROUND_Y - 60));
}

function updateHumanoids(dt, shipAlive) {
    for (let i = humanoids.length - 1; i >= 0; i--) {
        const h = humanoids[i];

        if (h.state === 'ground') {
            h.turnTimer -= dt;
            if (h.turnTimer <= 0) {
                h.turnTimer = randRange(1, 3);
                h.dir = -h.dir;
            }
            h.x = wrapX(h.x + h.dir * HUM_WALK * dt);
            h.y = groundYAt(h.x);
        } else if (h.state === 'carried') {
            if (!h.carrier || enemies.indexOf(h.carrier) === -1) dropHumanoid(h);
        } else if (h.state === 'held') {
            if (!shipAlive) continue;
            h.x = ship.x;
            h.y = ship.y + CARRY_OFFSET;
            if (ship.y >= SET_DOWN_Y) {
                h.state = 'ground';
                h.y = groundYAt(h.x);
                h.carrier = null;
                ship.held = null;
                addScore(RETURN_POINTS);
            }
        } else if (h.state === 'falling') {
            h.vy = Math.min(HUM_MAX_FALL, h.vy + HUM_GRAVITY * dt);
            h.y += h.vy * dt;
            if (shipAlive && !ship.held && Math.abs(wrapDX(h.x, ship.x)) < CATCH_R &&
                Math.abs(h.y - ship.y) < CATCH_R) {
                h.state = 'held';
                h.vy = 0;
                ship.held = h;
                addScore(CATCH_POINTS);
                continue;
            }
            const floorY = groundYAt(h.x);
            if (h.y >= floorY) {
                if (floorY - h.releaseY > FATAL_FALL) {
                    killHumanoid(h);
                } else {
                    h.state = 'ground';
                    h.y = floorY;
                    h.vy = 0;
                }
            }
        }
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x = wrapX(p.x + p.vx * dt);
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function checkCollisions() {
    // Laser vs enemies.
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        for (const e of enemies) {
            if (Math.abs(wrapDX(b.x, e.x)) < ENEMY_R + 8 && Math.abs(b.y - e.y) < ENEMY_R) {
                bullets.splice(i, 1);
                killEnemy(e);
                break;
            }
        }
    }

    if (invuln > 0) return;

    // Enemies vs ship.
    for (const e of enemies) {
        if (Math.abs(wrapDX(e.x, ship.x)) < ENEMY_R + SHIP_HW * 0.6 &&
            Math.abs(e.y - ship.y) < ENEMY_R + SHIP_HH) {
            killEnemy(e, false);
            killShip();
            return;
        }
    }

    // Enemy fire vs ship.
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        if (Math.abs(wrapDX(b.x, ship.x)) < SHIP_HW * 0.7 && Math.abs(b.y - ship.y) < SHIP_HH + 4) {
            enemyBullets.splice(i, 1);
            killShip();
            return;
        }
    }
}

function checkWaveComplete() {
    if (!waveActive) return;
    if (enemies.some((e) => e.type === 'lander' || e.type === 'mutant')) return;
    waveActive = false;
    enemies.length = 0;      // any surviving baiter is swept away with the wave
    enemyBullets.length = 0;
    const survivors = humanoids.length;
    addScore(WAVE_BONUS * wave * survivors);
    state = 'wavecleared';
    waveClearTimer = WAVE_PAUSE;
    showOverlay(
        `WAVE ${wave} CLEARED`,
        `${survivors} humanoid${survivors === 1 ? '' : 's'} safe — bonus ${WAVE_BONUS * wave * survivors}`,
        'Stand by…'
    );
}

function nextWave() {
    wave++;
    smartBombs = Math.min(MAX_BOMBS, smartBombs + 1);
    if (planetDestroyed || humanoids.length === 0) {
        buildScenery();
        stockPlanet();
    }
    bullets = [];
    enemyBullets = [];
    invuln = RESPAWN_INVULN;
    startWave();
    state = 'running';
    hideOverlay();
    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    ctx.fillStyle = '#04060f';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawScanner();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, VIEW_TOP, CANVAS_W, CANVAS_H - VIEW_TOP);
    ctx.clip();

    drawStars();
    drawRidge();
    drawTerrain();
    drawHumanoids();
    drawEnemyBullets();
    drawEnemies();
    drawBullets();
    drawParticles();
    if (state !== 'dying') drawShip();

    ctx.restore();

    if (bombFlash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, bombFlash) * 0.7})`;
        ctx.fillRect(0, VIEW_TOP, CANVAS_W, CANVAS_H - VIEW_TOP);
    }
}

function drawScanner() {
    const h = SCANNER_H;
    ctx.fillStyle = '#070c1a';
    ctx.fillRect(SCANNER_MARGIN, SCANNER_TOP, CANVAS_W - 2 * SCANNER_MARGIN, h);
    ctx.strokeStyle = '#22345c';
    ctx.lineWidth = 1;
    ctx.strokeRect(SCANNER_MARGIN + 0.5, SCANNER_TOP + 0.5, CANVAS_W - 2 * SCANNER_MARGIN - 1, h - 1);

    // The slice of planet currently on screen.
    const left = scannerX(camX);
    const width = (CANVAS_W / WORLD_W) * (CANVAS_W - 2 * SCANNER_MARGIN);
    ctx.strokeStyle = 'rgba(76,224,210,0.55)';
    for (const off of [0, CANVAS_W - 2 * SCANNER_MARGIN, -(CANVAS_W - 2 * SCANNER_MARGIN)]) {
        ctx.strokeRect(left + off, SCANNER_TOP + 1, width, h - 2);
    }

    ctx.fillStyle = '#1b3a2a';
    ctx.fillRect(SCANNER_MARGIN, SCANNER_TOP + h - 6, CANVAS_W - 2 * SCANNER_MARGIN, 2);

    for (const hm of humanoids) {
        ctx.fillStyle = hm.state === 'carried' ? '#ffd166' : COLOR.human;
        ctx.fillRect(scannerX(hm.x) - 1, scannerY(hm.y) - 2, 2, 4);
    }
    for (const e of enemies) {
        ctx.fillStyle = COLOR[e.type];
        ctx.fillRect(scannerX(e.x) - 2, scannerY(e.y) - 2, 4, 4);
    }
    if (state === 'running' || state === 'paused') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(scannerX(ship.x) - 2, scannerY(ship.y) - 2, 5, 4);
    }
}

function drawStars() {
    for (const s of stars) {
        const sx = worldToScreen(wrapX(s.x * s.depth + camX * (1 - s.depth)));
        if (sx < -4 || sx > CANVAS_W + 4) continue;
        ctx.fillStyle = `rgba(190,215,255,${0.25 + s.depth * 0.5})`;
        ctx.fillRect(sx, s.y, s.r, s.r);
    }
}

function drawPolyline(points, fillStyle, baseline) {
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    let started = false;
    for (const p of points) {
        const sx = worldToScreen(p.x);
        if (sx < -120 || sx > CANVAS_W + 120) continue;
        if (!started) {
            ctx.moveTo(sx, baseline);
            ctx.lineTo(sx, p.y);
            started = true;
        } else {
            ctx.lineTo(sx, p.y);
        }
        ctx.lineTo(sx, p.y);
    }
    if (!started) return;
    ctx.lineTo(CANVAS_W + 120, baseline);
    ctx.closePath();
    ctx.fill();
}

function drawRidge() {
    drawPolyline(ridge, '#101a33', CANVAS_H);
}

function drawTerrain() {
    drawPolyline(terrain, planetDestroyed ? '#3a1520' : '#14304a', CANVAS_H);
    ctx.strokeStyle = planetDestroyed ? '#7a2740' : '#2f6ea0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (const p of terrain) {
        const sx = worldToScreen(p.x);
        if (sx < -120 || sx > CANVAS_W + 120) continue;
        if (!started) {
            ctx.moveTo(sx, p.y);
            started = true;
        } else {
            ctx.lineTo(sx, p.y);
        }
    }
    if (started) ctx.stroke();
}

function drawHumanoids() {
    for (const h of humanoids) {
        const sx = worldToScreen(h.x);
        if (sx < -20 || sx > CANVAS_W + 20) continue;
        ctx.fillStyle = h.state === 'carried' ? '#ffd166' : COLOR.human;
        ctx.fillRect(sx - HUM_HW, h.y - HUM_H, HUM_HW * 2, HUM_H * 0.5);
        ctx.fillRect(sx - 1.5, h.y - HUM_H * 0.5, 3, HUM_H * 0.5);
        if (h.state === 'falling') {
            ctx.fillRect(sx - HUM_HW - 3, h.y - HUM_H, 3, 3);
            ctx.fillRect(sx + HUM_HW, h.y - HUM_H, 3, 3);
        }
    }
}

function drawEnemies() {
    for (const e of enemies) {
        const sx = worldToScreen(e.x);
        if (sx < -30 || sx > CANVAS_W + 30) continue;
        ctx.fillStyle = COLOR[e.type];
        if (e.type === 'lander') {
            ctx.beginPath();
            ctx.moveTo(sx, e.y - 10);
            ctx.lineTo(sx + 11, e.y + 4);
            ctx.lineTo(sx - 11, e.y + 4);
            ctx.closePath();
            ctx.fill();
            ctx.fillRect(sx - 3, e.y + 4, 6, 7);
            ctx.fillStyle = '#fff2d6';
            ctx.fillRect(sx - 2, e.y - 4, 4, 4);
        } else if (e.type === 'mutant') {
            const wob = Math.sin(e.wobble) * 3;
            ctx.beginPath();
            ctx.arc(sx, e.y, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#2a0713';
            ctx.fillRect(sx - 5 + wob, e.y - 3, 3, 3);
            ctx.fillRect(sx + 2 + wob, e.y - 3, 3, 3);
        } else {
            ctx.beginPath();
            ctx.moveTo(sx - 12, e.y);
            ctx.lineTo(sx, e.y - 9);
            ctx.lineTo(sx + 12, e.y);
            ctx.lineTo(sx, e.y + 9);
            ctx.closePath();
            ctx.fill();
        }
    }
}

function drawBullets() {
    ctx.fillStyle = COLOR.laser;
    for (const b of bullets) {
        const sx = worldToScreen(b.x);
        if (sx < -BULLET_LEN || sx > CANVAS_W + BULLET_LEN) continue;
        const len = b.vx > 0 ? -BULLET_LEN : BULLET_LEN;
        ctx.fillRect(Math.min(sx, sx + len), b.y - 1.5, BULLET_LEN, 3);
    }
}

function drawEnemyBullets() {
    ctx.fillStyle = COLOR.enemyShot;
    for (const b of enemyBullets) {
        const sx = worldToScreen(b.x);
        if (sx < -10 || sx > CANVAS_W + 10) continue;
        ctx.fillRect(sx - 2, b.y - 2, 4, 4);
    }
}

function drawParticles() {
    for (const p of particles) {
        const sx = worldToScreen(p.x);
        if (sx < -10 || sx > CANVAS_W + 10) continue;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
        ctx.fillStyle = p.color;
        ctx.fillRect(sx - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
}

function drawShip() {
    const sx = worldToScreen(ship.x);
    const f = ship.facing;
    if (invuln > 0 && Math.floor(invuln * 12) % 2 === 0) return;

    ctx.fillStyle = COLOR.ship;
    ctx.beginPath();
    ctx.moveTo(sx + f * SHIP_HW, ship.y);
    ctx.lineTo(sx - f * SHIP_HW * 0.4, ship.y - SHIP_HH);
    ctx.lineTo(sx - f * SHIP_HW, ship.y - SHIP_HH * 0.4);
    ctx.lineTo(sx - f * SHIP_HW, ship.y + SHIP_HH * 0.6);
    ctx.lineTo(sx - f * SHIP_HW * 0.4, ship.y + SHIP_HH);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + f * 2, ship.y - 2, 4, 4);

    // Thrust flame when accelerating against the facing direction.
    if (Math.abs(ship.vx) > 40) {
        ctx.fillStyle = '#ffd166';
        const back = sx - f * (SHIP_HW + 2);
        ctx.fillRect(Math.min(back, back - f * 8), ship.y - 2, 8, 4);
    }

    if (ship.held) {
        ctx.strokeStyle = 'rgba(141,255,107,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, ship.y + SHIP_HH);
        ctx.lineTo(sx, ship.y + CARRY_OFFSET - HUM_H);
        ctx.stroke();
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's'];

function normalizeKey(e) {
    return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

window.addEventListener('keydown', (e) => {
    const key = normalizeKey(e);

    if (key === 'p') {
        togglePause();
        e.preventDefault();
        return;
    }
    if (key === 'b') {
        smartBomb();
        e.preventDefault();
        return;
    }
    if (key === ' ' || e.code === 'Space') {
        if (state === 'running') fire();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(key)) {
        heldKeys.add(key);
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    heldKeys.delete(normalizeKey(e));
});

window.addEventListener('blur', () => heldKeys.clear());

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    if (autoStep) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('planet-defender-best') || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
wave = 1;
smartBombs = START_BOMBS;
nextExtraLife = EXTRA_LIFE_EVERY;
ship = { x: SHIP_START_X, y: (VIEW_TOP + GROUND_Y) / 2, vx: 0, vy: 0, facing: 1, held: null };
bullets = [];
enemies = [];
enemyBullets = [];
particles = [];
camX = wrapX(SHIP_START_X - CANVAS_W / 2);
fireCooldown = 0;
invuln = 0;
deathTimer = 0;
waveClearTimer = 0;
waveActive = false;
waveTimer = 0;
baiterTimer = BAITER_INTERVAL;
bombFlash = 0;
setSeed(20260815);
buildScenery();
stockPlanet();
updateHud();
showOverlay('PLANET DEFENDER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
