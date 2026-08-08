// ---------------------------------------------------------------------------
// Defender — a scrolling-world arcade shooter.
//
// The playfield is a horizontally wrapping planet, four screens wide. The
// player flies a ship over the terrain, shoots landers before they can abduct
// the ten humanoids on the ground, and catches any humanoid that falls.
//
// Everything below is deliberately kept in the global scope: the Playwright
// suite drives the simulation directly (startGame(), update(dt), fire(), ...)
// instead of relying on wall-clock animation frames.
// ---------------------------------------------------------------------------

// --- Geometry ---------------------------------------------------------------
const CANVAS_W = 800;
const CANVAS_H = 460;
const RADAR_H = 70;          // scanner strip along the top of the canvas
const PLAY_TOP = RADAR_H;    // first row of the flyable playfield
const WORLD_W = 3200;        // four screens wide, wraps around
const TERRAIN_N = 128;
const TERRAIN_STEP = WORLD_W / TERRAIN_N;

// --- Ship -------------------------------------------------------------------
const ACCEL_X = 900;
const MAX_VX = 380;
const DRAG_X = 2.2;
const ACCEL_Y = 900;
const MAX_VY = 260;
const DRAG_Y = 5;
const SHIP_R = 10;
const RESPAWN_INVULN = 2.5;
const HYPER_COOLDOWN = 3;

// --- Weapons ----------------------------------------------------------------
const BULLET_V = 900;
const BULLET_LIFE = 0.55;
const MAX_BULLETS = 6;
const ENEMY_BULLET_V = 250;
const ENEMY_BULLET_LIFE = 3.5;
const BOMB_RANGE = CANVAS_W / 2;   // smart bombs clear this far from the ship

// --- Enemies ----------------------------------------------------------------
const LANDER_R = 12;
const LANDER_VX = 70;
const LANDER_DESCEND = 55;
const LANDER_CLIMB = 70;
const MUTANT_R = 12;
const MUTANT_SPEED = 150;
const MUTANT_ACCEL = 260;
const GRAB_R = LANDER_R + 12;
const CARRY_OFFSET = LANDER_R + 8;

// --- Humanoids --------------------------------------------------------------
const HUMANOID_COUNT = 10;
const FALL_G = 200;
const FALL_MAX = 220;
const SAFE_IMPACT = 150;     // impact speed a humanoid can walk away from
const CATCH_R = 20;
const DROP_H = 34;           // fly this close to the ground to set one down

// --- Scoring / pacing -------------------------------------------------------
const SCORE_LANDER = 150;
const SCORE_MUTANT = 150;
const SCORE_RESCUE = 500;
const SCORE_SURVIVOR = 100;
const START_LIVES = 3;
const START_BOMBS = 3;
const MAX_BOMBS = 6;
const WAVE_DELAY = 2.5;      // pause between a cleared wave and the next one

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = 'idle';          // idle | running | paused | gameover
let score = 0;
let best = 0;
let lives = START_LIVES;
let smartBombs = START_BOMBS;
let wave = 1;
let clearTimer = 0;
let cameraX = 0;
let seed = 1;
let terrain = [];

const player = {
    x: 0, y: 0, vx: 0, vy: 0, dir: 1,
    invuln: 0, hyperCooldown: 0, carrying: null,
};
const input = { left: false, right: false, up: false, down: false };

let bullets = [];
let enemyBullets = [];
let landers = [];
let mutants = [];
let humanoids = [];
let explosions = [];
let stars = [];
let banner = { text: '', t: 0 };

function setBanner(text) {
    banner = { text, t: 1.8 };
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elWave = document.getElementById('wave');
const elLives = document.getElementById('lives');
const elBombs = document.getElementById('bombs');
const elHumans = document.getElementById('humans');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) — seeding it reproduces a whole planet
// ---------------------------------------------------------------------------
function setSeed(n) {
    seed = n >>> 0;
}

function rng() {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// World helpers
// ---------------------------------------------------------------------------
function wrapX(x) {
    return ((x % WORLD_W) + WORLD_W) % WORLD_W;
}

/** Shortest signed distance travelling from `a` to `b` around the planet. */
function wrapDelta(a, b) {
    let d = wrapX(b) - wrapX(a);
    if (d > WORLD_W / 2) d -= WORLD_W;
    if (d < -WORLD_W / 2) d += WORLD_W;
    return d;
}

function buildTerrain() {
    terrain = new Array(TERRAIN_N);
    let y = 400;
    for (let i = 0; i < TERRAIN_N; i++) {
        y += (rng() - 0.5) * 60;
        y = Math.max(355, Math.min(435, y));
        terrain[i] = y;
    }
    // Blend the tail into the head so the seam is invisible when wrapping.
    const blend = 12;
    for (let k = 0; k < blend; k++) {
        const i = TERRAIN_N - blend + k;
        const w = (k + 1) / (blend + 1);
        terrain[i] = terrain[i] * (1 - w) + terrain[0] * w;
    }
    for (let pass = 0; pass < 2; pass++) {
        const copy = terrain.slice();
        for (let i = 0; i < TERRAIN_N; i++) {
            const a = copy[(i - 1 + TERRAIN_N) % TERRAIN_N];
            const b = copy[(i + 1) % TERRAIN_N];
            terrain[i] = (a + copy[i] * 2 + b) / 4;
        }
    }
}

function groundY(x) {
    const p = wrapX(x) / TERRAIN_STEP;
    const i = Math.floor(p);
    const t = p - i;
    const a = terrain[i % TERRAIN_N];
    const b = terrain[(i + 1) % TERRAIN_N];
    return a + (b - a) * t;
}

/** Maps a world x to its position on the scanner (player always centred). */
function radarX(x) {
    return CANVAS_W / 2 + (wrapDelta(player.x, x) / WORLD_W) * CANVAS_W;
}

function screenX(x) {
    return wrapDelta(cameraX, x);
}

function onScreen(x, margin) {
    const sx = screenX(x);
    return sx > -(margin || 40) && sx < CANVAS_W + (margin || 40);
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------
function makeLander(x, y) {
    return {
        x: wrapX(x), y, state: 'hunting', human: null,
        fireT: 1 + rng() * 2, wobble: rng() * Math.PI * 2,
    };
}

function makeMutant(x, y) {
    return {
        x: wrapX(x), y, vx: 0, vy: 0,
        fireT: 1 + rng() * 2, wobble: rng() * Math.PI * 2,
    };
}

function makeHumanoid(x) {
    return { x: wrapX(x), y: groundY(x), vy: 0, state: 'ground' };
}

function landerCountForWave(w) {
    return Math.min(18, 4 + w * 2);
}

// ---------------------------------------------------------------------------
// Set-up
// ---------------------------------------------------------------------------
function buildStars() {
    stars = [];
    for (let i = 0; i < 90; i++) {
        stars.push({
            x: rng() * WORLD_W,
            y: PLAY_TOP + rng() * (CANVAS_H - PLAY_TOP - 90),
            r: rng() < 0.8 ? 1 : 1.6,
        });
    }
}

function placeHumanoids() {
    humanoids = [];
    for (let i = 0; i < HUMANOID_COUNT; i++) {
        const x = wrapX((i + 0.5) * (WORLD_W / HUMANOID_COUNT) + (rng() - 0.5) * 120);
        humanoids.push(makeHumanoid(x));
    }
}

function spawnWave() {
    const n = landerCountForWave(wave);
    for (let i = 0; i < n; i++) {
        const x = wrapX(player.x + WORLD_W * (0.25 + rng() * 0.5));
        landers.push(makeLander(x, PLAY_TOP + 20 + rng() * 110));
    }
}

function resetPlayer(keepX) {
    if (!keepX) player.x = wrapX(WORLD_W / 2);
    player.y = PLAY_TOP + 130;
    player.vx = 0;
    player.vy = 0;
    player.dir = 1;
    player.invuln = RESPAWN_INVULN;
    player.carrying = null;
    snapCamera();
}

function snapCamera() {
    cameraX = wrapX(player.x - (player.dir > 0 ? 0.32 : 0.68) * CANVAS_W);
}

function startGame() {
    setSeed(Math.floor(Math.random() * 0xFFFFFFFF));
    score = 0;
    lives = START_LIVES;
    smartBombs = START_BOMBS;
    wave = 1;
    clearTimer = 0;
    bullets = [];
    enemyBullets = [];
    landers = [];
    mutants = [];
    explosions = [];
    buildTerrain();
    buildStars();
    resetPlayer(false);
    player.hyperCooldown = 0;
    placeHumanoids();
    spawnWave();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextWave() {
    score += humanoids.length * SCORE_SURVIVOR;
    wave += 1;
    clearTimer = 0;
    smartBombs = Math.min(MAX_BOMBS, smartBombs + 1);
    bullets = [];
    enemyBullets = [];
    spawnWave();
    setBanner(`WAVE ${wave}`);
    updateHud();
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------
function fire() {
    if (state !== 'running') return;
    if (bullets.length >= MAX_BULLETS) return;
    bullets.push({
        x: wrapX(player.x + player.dir * 18),
        y: player.y,
        vx: player.dir * BULLET_V,
        life: BULLET_LIFE,
    });
}

function useSmartBomb() {
    if (state !== 'running') return;
    if (smartBombs <= 0) return;
    smartBombs -= 1;
    for (let i = landers.length - 1; i >= 0; i--) {
        if (Math.abs(wrapDelta(player.x, landers[i].x)) <= BOMB_RANGE) killLander(landers[i]);
    }
    for (let i = mutants.length - 1; i >= 0; i--) {
        if (Math.abs(wrapDelta(player.x, mutants[i].x)) <= BOMB_RANGE) killMutant(mutants[i]);
    }
    addExplosion(player.x, player.y, 26);
    updateHud();
}

function hyperspace() {
    if (state !== 'running') return;
    if (player.hyperCooldown > 0) return;
    player.hyperCooldown = HYPER_COOLDOWN;
    const x = wrapX(player.x + WORLD_W * (0.2 + rng() * 0.6));
    player.x = x;
    player.y = Math.min(PLAY_TOP + 60 + rng() * 120, groundY(x) - 40);
    player.vx = 0;
    player.vy = 0;
    player.invuln = Math.max(player.invuln, 1);
    addExplosion(x, player.y, 14);
    snapCamera();
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
// Destruction
// ---------------------------------------------------------------------------
function addExplosion(x, y, n) {
    const parts = [];
    for (let i = 0; i < (n || 14); i++) {
        const a = rng() * Math.PI * 2;
        const v = 40 + rng() * 150;
        parts.push({ vx: Math.cos(a) * v, vy: Math.sin(a) * v });
    }
    explosions.push({ x: wrapX(x), y, t: 0, dur: 0.55, parts });
}

function killLander(l) {
    const i = landers.indexOf(l);
    if (i === -1) return;
    landers.splice(i, 1);
    if (l.state === 'carrying' && l.human) {
        l.human.state = 'falling';
        l.human.vy = 0;
        l.human = null;
    }
    score += SCORE_LANDER;
    addExplosion(l.x, l.y);
    updateHud();
}

function killMutant(m) {
    const i = mutants.indexOf(m);
    if (i === -1) return;
    mutants.splice(i, 1);
    score += SCORE_MUTANT;
    addExplosion(m.x, m.y);
    updateHud();
}

function removeHumanoid(h) {
    const i = humanoids.indexOf(h);
    if (i !== -1) humanoids.splice(i, 1);
    if (player.carrying === h) player.carrying = null;
}

function killPlayer() {
    addExplosion(player.x, player.y, 30);
    if (player.carrying) {
        player.carrying.state = 'falling';
        player.carrying.vy = 0;
        player.carrying = null;
    }
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        updateHud();
        gameOver();
        return;
    }
    resetPlayer(true);
    updateHud();
}

function gameOver() {
    state = 'gameover';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('defender-best', String(best));
        } catch (e) { /* storage unavailable — keep the in-memory best */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Wave ${wave}`, 'Press Space to defend again');
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function update(dt) {
    if (state !== 'running') return;

    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);
    if (player.hyperCooldown > 0) player.hyperCooldown = Math.max(0, player.hyperCooldown - dt);

    updatePlayer(dt);
    updateCamera(dt);
    updateBullets(dt);
    updateEnemyBullets(dt);
    updateLanders(dt);
    updateMutants(dt);
    updateHumanoids(dt);
    checkPlayerCollisions();
    checkPlanet();
    updateExplosions(dt);

    if (state !== 'running') return;

    if (banner.t > 0) banner.t = Math.max(0, banner.t - dt);

    if (landers.length === 0 && mutants.length === 0) {
        if (clearTimer === 0) setBanner('WAVE CLEARED');
        clearTimer += dt;
        if (clearTimer >= WAVE_DELAY) nextWave();
    } else {
        clearTimer = 0;
    }
    updateHud();
}

function updatePlayer(dt) {
    if (input.right) {
        player.dir = 1;
        player.vx += ACCEL_X * dt;
    } else if (input.left) {
        player.dir = -1;
        player.vx -= ACCEL_X * dt;
    } else {
        player.vx -= player.vx * Math.min(1, DRAG_X * dt);
    }
    player.vx = Math.max(-MAX_VX, Math.min(MAX_VX, player.vx));

    if (input.up) player.vy -= ACCEL_Y * dt;
    else if (input.down) player.vy += ACCEL_Y * dt;
    else player.vy -= player.vy * Math.min(1, DRAG_Y * dt);
    player.vy = Math.max(-MAX_VY, Math.min(MAX_VY, player.vy));

    player.x = wrapX(player.x + player.vx * dt);
    player.y += player.vy * dt;

    const floor = groundY(player.x) - 12;
    const ceiling = PLAY_TOP + 10;
    if (player.y < ceiling) {
        player.y = ceiling;
        player.vy = Math.max(0, player.vy);
    }
    if (player.y > floor) {
        player.y = floor;
        player.vy = Math.min(0, player.vy);
    }

    // Set a carried humanoid down when flying low over the terrain.
    if (player.carrying && player.y >= groundY(player.x) - DROP_H) {
        const h = player.carrying;
        h.state = 'ground';
        h.x = wrapX(player.x);
        h.y = groundY(h.x);
        h.vy = 0;
        player.carrying = null;
        score += SCORE_RESCUE;
        setBanner(`RESCUED  +${SCORE_RESCUE}`);
        updateHud();
    }
}

function updateCamera(dt) {
    const target = wrapX(player.x - (player.dir > 0 ? 0.32 : 0.68) * CANVAS_W);
    cameraX = wrapX(cameraX + wrapDelta(cameraX, target) * Math.min(1, dt * 4));
    const d = wrapDelta(cameraX, player.x);
    if (d < 0.12 * CANVAS_W) cameraX = wrapX(player.x - 0.12 * CANVAS_W);
    else if (d > 0.88 * CANVAS_W) cameraX = wrapX(player.x - 0.88 * CANVAS_W);
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x = wrapX(b.x + b.vx * dt);
        b.life -= dt;
        if (b.life <= 0) {
            bullets.splice(i, 1);
            continue;
        }
        let hit = false;
        for (let j = landers.length - 1; j >= 0 && !hit; j--) {
            const l = landers[j];
            if (Math.abs(wrapDelta(b.x, l.x)) < LANDER_R + 4 && Math.abs(b.y - l.y) < LANDER_R + 4) {
                killLander(l);
                hit = true;
            }
        }
        for (let j = mutants.length - 1; j >= 0 && !hit; j--) {
            const m = mutants[j];
            if (Math.abs(wrapDelta(b.x, m.x)) < MUTANT_R + 4 && Math.abs(b.y - m.y) < MUTANT_R + 4) {
                killMutant(m);
                hit = true;
            }
        }
        if (hit) bullets.splice(i, 1);
    }
}

function updateEnemyBullets(dt) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.x = wrapX(b.x + b.vx * dt);
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0 || b.y > groundY(b.x) || b.y < PLAY_TOP) {
            enemyBullets.splice(i, 1);
            continue;
        }
        if (player.invuln <= 0
            && Math.abs(wrapDelta(b.x, player.x)) < SHIP_R
            && Math.abs(b.y - player.y) < SHIP_R) {
            enemyBullets.splice(i, 1);
            killPlayer();
            return;
        }
    }
}

function enemyShoot(e, dt) {
    e.fireT -= dt;
    if (e.fireT > 0) return;
    e.fireT = 1.6 + rng() * 2.2;
    const dx = wrapDelta(e.x, player.x);
    const dy = player.y - e.y;
    if (Math.abs(dx) > CANVAS_W * 0.6) return;
    const len = Math.hypot(dx, dy) || 1;
    enemyBullets.push({
        x: e.x,
        y: e.y,
        vx: (dx / len) * ENEMY_BULLET_V,
        vy: (dy / len) * ENEMY_BULLET_V,
        life: ENEMY_BULLET_LIFE,
    });
}

function nearestHumanoid(x) {
    let bestH = null;
    let bestD = Infinity;
    for (const h of humanoids) {
        if (h.state !== 'ground') continue;
        const d = Math.abs(wrapDelta(x, h.x));
        if (d < bestD) {
            bestD = d;
            bestH = h;
        }
    }
    return bestH;
}

function updateLanders(dt) {
    for (let i = landers.length - 1; i >= 0; i--) {
        const l = landers[i];
        l.wobble += dt * 3;

        if (l.state === 'carrying') {
            l.y -= LANDER_CLIMB * dt;
            if (l.y <= PLAY_TOP + 8) {
                // The humanoid is gone — the lander mutates into a hunter.
                if (l.human) removeHumanoid(l.human);
                landers.splice(i, 1);
                mutants.push(makeMutant(l.x, PLAY_TOP + 20));
                addExplosion(l.x, PLAY_TOP + 12, 10);
                continue;
            }
        } else {
            const target = l.human && l.human.state === 'ground' ? l.human : nearestHumanoid(l.x);
            l.human = target;
            if (target) {
                const dx = wrapDelta(l.x, target.x);
                if (Math.abs(dx) > 4) l.x = wrapX(l.x + Math.sign(dx) * LANDER_VX * dt);
                if (l.y < target.y) l.y += LANDER_DESCEND * dt;
                if (Math.abs(wrapDelta(l.x, target.x)) < GRAB_R && Math.abs(l.y - target.y) < GRAB_R) {
                    l.state = 'carrying';
                    target.state = 'abducted';
                }
            } else {
                // Nobody left to abduct — drift and hover.
                l.x = wrapX(l.x + Math.sin(l.wobble) * LANDER_VX * dt);
                const hover = PLAY_TOP + 90;
                l.y += Math.sign(hover - l.y) * LANDER_DESCEND * dt * 0.5;
            }
        }
        enemyShoot(l, dt);
    }
}

function updateMutants(dt) {
    for (const m of mutants) {
        m.wobble += dt * 6;
        const dx = wrapDelta(m.x, player.x);
        const dy = player.y - m.y;
        const len = Math.hypot(dx, dy) || 1;
        m.vx += (dx / len) * MUTANT_ACCEL * dt;
        m.vy += (dy / len) * MUTANT_ACCEL * dt + Math.sin(m.wobble) * 12 * dt;
        const speed = Math.hypot(m.vx, m.vy);
        if (speed > MUTANT_SPEED) {
            m.vx = (m.vx / speed) * MUTANT_SPEED;
            m.vy = (m.vy / speed) * MUTANT_SPEED;
        }
        m.x = wrapX(m.x + m.vx * dt);
        m.y += m.vy * dt;
        const floor = groundY(m.x) - MUTANT_R;
        if (m.y > floor) {
            m.y = floor;
            m.vy = Math.min(0, m.vy);
        }
        if (m.y < PLAY_TOP + MUTANT_R) {
            m.y = PLAY_TOP + MUTANT_R;
            m.vy = Math.max(0, m.vy);
        }
        enemyShoot(m, dt);
    }
}

function updateHumanoids(dt) {
    for (let i = humanoids.length - 1; i >= 0; i--) {
        const h = humanoids[i];
        if (h.state === 'abducted') {
            const carrier = landers.find((l) => l.human === h && l.state === 'carrying');
            if (!carrier) {
                h.state = 'falling';
                h.vy = 0;
            } else {
                h.x = carrier.x;
                h.y = carrier.y + CARRY_OFFSET;
            }
        } else if (h.state === 'carried') {
            h.x = player.x;
            h.y = player.y + 14;
        } else if (h.state === 'falling') {
            h.vy = Math.min(FALL_MAX, h.vy + FALL_G * dt);
            h.y += h.vy * dt;
            const floor = groundY(h.x);
            if (!player.carrying
                && Math.abs(wrapDelta(h.x, player.x)) < CATCH_R
                && Math.abs(h.y - player.y) < CATCH_R) {
                h.state = 'carried';
                h.vy = 0;
                player.carrying = h;
                continue;
            }
            if (h.y >= floor) {
                if (h.vy > SAFE_IMPACT) {
                    addExplosion(h.x, floor, 10);
                    humanoids.splice(i, 1);
                } else {
                    h.y = floor;
                    h.vy = 0;
                    h.state = 'ground';
                }
            }
        } else {
            h.y = groundY(h.x);
        }
    }
}

function checkPlayerCollisions() {
    if (player.invuln > 0) return;
    for (const l of landers) {
        if (Math.abs(wrapDelta(l.x, player.x)) < SHIP_R + LANDER_R
            && Math.abs(l.y - player.y) < SHIP_R + LANDER_R) {
            killLander(l);
            killPlayer();
            return;
        }
    }
    for (const m of mutants) {
        if (Math.abs(wrapDelta(m.x, player.x)) < SHIP_R + MUTANT_R
            && Math.abs(m.y - player.y) < SHIP_R + MUTANT_R) {
            killMutant(m);
            killPlayer();
            return;
        }
    }
}

/** With every humanoid gone the planet falls: survivors all turn into mutants. */
function checkPlanet() {
    if (humanoids.length > 0 || landers.length === 0) return;
    for (const l of landers) mutants.push(makeMutant(l.x, l.y));
    landers = [];
}

function updateExplosions(dt) {
    for (let i = explosions.length - 1; i >= 0; i--) {
        explosions[i].t += dt;
        if (explosions[i].t >= explosions[i].dur) explosions.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function draw() {
    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawStars();
    drawTerrain();
    drawHumanoids();
    drawLanders();
    drawMutants();
    drawBullets();
    drawExplosions();
    drawShip();
    drawRadar();
    drawBanner();
}

function drawBanner() {
    if (banner.t <= 0 || !banner.text) return;
    const fade = Math.min(1, banner.t / 0.6);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#6cf3ff';
    ctx.font = 'bold 24px "Segoe UI", Tahoma, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(banner.text, CANVAS_W / 2, PLAY_TOP + 52);
    ctx.restore();
}

function drawStars() {
    ctx.fillStyle = '#33406b';
    for (const s of stars) {
        const sx = wrapDelta(cameraX * 0.5, s.x * 0.5);
        if (sx < -4 || sx > CANVAS_W + 4) continue;
        ctx.fillRect(sx, s.y, s.r, s.r);
    }
}

function drawTerrain() {
    ctx.beginPath();
    ctx.moveTo(-30, CANVAS_H);
    for (let sx = -30; sx <= CANVAS_W + 30; sx += 8) {
        ctx.lineTo(sx, groundY(cameraX + sx));
    }
    ctx.lineTo(CANVAS_W + 30, CANVAS_H);
    ctx.closePath();
    ctx.fillStyle = '#0b1226';
    ctx.fill();
    ctx.strokeStyle = '#3ad4a0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let sx = -30; sx <= CANVAS_W + 30; sx += 8) {
        const y = groundY(cameraX + sx);
        if (sx === -30) ctx.moveTo(sx, y);
        else ctx.lineTo(sx, y);
    }
    ctx.stroke();
}

function drawHumanoids() {
    for (const h of humanoids) {
        if (!onScreen(h.x)) continue;
        const sx = screenX(h.x);
        ctx.fillStyle = h.state === 'ground' ? '#ffd166' : '#ffe9a8';
        ctx.fillRect(sx - 2, h.y - 10, 4, 6);
        ctx.fillRect(sx - 3, h.y - 4, 6, 4);
    }
}

function drawLanders() {
    for (const l of landers) {
        if (!onScreen(l.x)) continue;
        const sx = screenX(l.x);
        ctx.fillStyle = l.state === 'carrying' ? '#7bff8a' : '#4ade80';
        ctx.beginPath();
        ctx.moveTo(sx, l.y - LANDER_R);
        ctx.lineTo(sx + LANDER_R, l.y);
        ctx.lineTo(sx, l.y + LANDER_R);
        ctx.lineTo(sx - LANDER_R, l.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#052014';
        ctx.fillRect(sx - 3, l.y - 2, 6, 4);
    }
}

function drawMutants() {
    for (const m of mutants) {
        if (!onScreen(m.x)) continue;
        const sx = screenX(m.x);
        ctx.fillStyle = '#ff5ce1';
        ctx.beginPath();
        ctx.arc(sx, m.y, MUTANT_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2a0a24';
        ctx.fillRect(sx - 5, m.y - 3, 10, 3);
    }
}

function drawBullets() {
    ctx.fillStyle = '#ffffff';
    for (const b of bullets) {
        if (!onScreen(b.x, 20)) continue;
        const sx = screenX(b.x);
        ctx.fillRect(sx - Math.sign(b.vx) * 14, b.y - 1, 14, 2);
    }
    ctx.fillStyle = '#ff6b6b';
    for (const b of enemyBullets) {
        if (!onScreen(b.x, 20)) continue;
        ctx.fillRect(screenX(b.x) - 2, b.y - 2, 4, 4);
    }
}

function drawExplosions() {
    for (const e of explosions) {
        if (!onScreen(e.x, 60)) continue;
        const p = e.t / e.dur;
        const sx = screenX(e.x);
        ctx.fillStyle = `rgba(255, ${Math.round(200 - 120 * p)}, 80, ${1 - p})`;
        for (const part of e.parts) {
            ctx.fillRect(sx + part.vx * e.t, e.y + part.vy * e.t, 3, 3);
        }
    }
}

function drawShip() {
    if (state === 'idle') return;
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) return;
    const sx = screenX(player.x);
    const d = player.dir;
    ctx.fillStyle = '#6cf3ff';
    ctx.beginPath();
    ctx.moveTo(sx + d * 16, player.y);
    ctx.lineTo(sx - d * 8, player.y - 7);
    ctx.lineTo(sx - d * 14, player.y - 2);
    ctx.lineTo(sx - d * 14, player.y + 4);
    ctx.lineTo(sx - d * 8, player.y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + d * 2 - 2, player.y - 2, 4, 4);
    if (input.left || input.right) {
        ctx.fillStyle = '#ffb347';
        ctx.fillRect(sx - d * 20, player.y - 2, 6, 4);
    }
    if (player.carrying) {
        // Tractor line down to the humanoid riding under the ship.
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, player.y + 4);
        ctx.lineTo(sx, player.y + 12);
        ctx.stroke();
    }
}

function drawRadar() {
    ctx.fillStyle = '#080d1a';
    ctx.fillRect(0, 0, CANVAS_W, RADAR_H);
    ctx.strokeStyle = '#233458';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, CANVAS_W - 1, RADAR_H - 1);

    const scaleY = (y) => 6 + ((y - PLAY_TOP) / (CANVAS_H - PLAY_TOP)) * (RADAR_H - 12);

    // Terrain trace across the whole planet.
    ctx.strokeStyle = '#1d6b53';
    ctx.beginPath();
    for (let i = 0; i <= 160; i++) {
        const worldOffset = (i / 160 - 0.5) * WORLD_W;
        const x = (i / 160) * CANVAS_W;
        const y = scaleY(groundY(player.x + worldOffset));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Visible-window bracket.
    ctx.strokeStyle = '#2f4a7d';
    const left = radarX(cameraX);
    const right = radarX(cameraX + CANVAS_W);
    ctx.strokeRect(left, 4, Math.max(2, right - left), RADAR_H - 8);

    for (const h of humanoids) {
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(radarX(h.x) - 1, scaleY(h.y) - 1, 2, 3);
    }
    for (const l of landers) {
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(radarX(l.x) - 2, scaleY(l.y) - 2, 4, 4);
    }
    for (const m of mutants) {
        ctx.fillStyle = '#ff5ce1';
        ctx.fillRect(radarX(m.x) - 2, scaleY(m.y) - 2, 4, 4);
    }
    if (state !== 'idle') {
        ctx.fillStyle = '#6cf3ff';
        ctx.fillRect(radarX(player.x) - 3, scaleY(player.y) - 2, 6, 4);
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------
function updateHud() {
    elScore.textContent = String(score);
    elWave.textContent = String(wave);
    elLives.textContent = String(lives);
    elBombs.textContent = String(smartBombs);
    elHumans.textContent = String(humanoids.length);
    elBest.textContent = String(best);
}

function showOverlay(title, sub, hint) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub || '';
    overlaySub.textContent = hint || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const KEY_LEFT = ['arrowleft', 'a'];
const KEY_RIGHT = ['arrowright', 'd'];
const KEY_UP = ['arrowup', 'w'];
const KEY_DOWN = ['arrowdown', 's'];

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (KEY_LEFT.includes(k)) {
        input.left = true;
        player.dir = -1;
        e.preventDefault();
    } else if (KEY_RIGHT.includes(k)) {
        input.right = true;
        player.dir = 1;
        e.preventDefault();
    } else if (KEY_UP.includes(k)) {
        input.up = true;
        e.preventDefault();
    } else if (KEY_DOWN.includes(k)) {
        input.down = true;
        e.preventDefault();
    } else if (k === ' ' || k === 'spacebar') {
        e.preventDefault();
        if (state === 'running') fire();
        else if (state === 'paused') togglePause();
        else startGame();
    } else if (k === 'b') {
        useSmartBomb();
    } else if (k === 'h') {
        hyperspace();
    } else if (k === 'p') {
        togglePause();
    }
});

window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (KEY_LEFT.includes(k)) input.left = false;
    else if (KEY_RIGHT.includes(k)) input.right = false;
    else if (KEY_UP.includes(k)) input.up = false;
    else if (KEY_DOWN.includes(k)) input.down = false;
});

window.addEventListener('blur', () => {
    input.left = input.right = input.up = input.down = false;
});

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
    update(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
setSeed(20260808);
best = parseInt(localStorage.getItem('defender-best') || '0', 10) || 0;
buildTerrain();
buildStars();
player.x = wrapX(WORLD_W / 2);
player.y = PLAY_TOP + 130;
snapCamera();
updateHud();
requestAnimationFrame(frame);
