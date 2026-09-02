// ---------------------------------------------------------------------------
// Defender — a wrap-around scrolling shooter on an HTML5 canvas.
//
// You fly a lone ship over a planet three screens wide that wraps horizontally.
// Alien landers descend on the eight humanoids below, haul them to the top of
// the sky and mutate into fast hunters. Shoot a lander while it carries a
// humanoid and the humanoid falls — catch it in mid-air and set it down gently.
// A radar strip across the top shows the whole planet at once.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Slime Volley,
// Kaboom and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so tests can simulate frames deterministically
// without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Canvas & world ---
const CANVAS_W = 800;
const CANVAS_H = 420;
const RADAR_H = 56;                 // radar strip across the top
const PLAY_TOP = RADAR_H;           // sky ceiling for everything that flies
const WORLD_W = 2400;               // three screens, wrapping at the seam
const TERRAIN_STEP = 60;            // spacing of the ridge vertices
const CAM_LEAD = 120;               // how far ahead of the ship the camera looks
const CAM_EASE = 6;                 // camera catch-up rate (1/s)

// --- Ship ---
const SHIP_W = 26;
const SHIP_H = 10;
const SHIP_ACCEL = 900;             // px/s² of thrust
const SHIP_MAX_SPEED = 380;         // px/s
const SHIP_DRAG = 2.5;              // coasting decay (1/s)
const VERT_SPEED = 240;             // px/s of climb / dive
const SHIP_CLEARANCE = 8;           // how close the hull gets to the ridge
const RESPAWN_TIME = 1.4;           // seconds between losing a ship and the next
const INVULN_TIME = 2.0;            // seconds of grace after re-materialising

// --- Weapons ---
const BULLET_SPEED = 900;
const BULLET_LIFE = 0.9;            // seconds — a shot never laps the planet
const MAX_BULLETS = 4;
const ENEMY_BULLET_SPEED = 260;
const ENEMY_BULLET_LIFE = 3.5;
const FIRE_RANGE = 480;             // aliens only shoot at a ship this close
const LANDER_FIRE_CD = 2.2;         // seconds between lander shots
const MUTANT_FIRE_CD = 1.4;         // mutants are twitchier

// --- Aliens ---
const LANDER_SPEED = 70;            // horizontal seek speed
const LANDER_DESCEND = 62;          // descent onto a humanoid
const LANDER_LIFT = 60;             // climb while carrying a humanoid
const LANDER_HUNT_SPEED = 110;      // speed when there is nobody left to abduct
const MUTANT_SPEED = 210;
const MUTANT_ACCEL = 420;
const MUTATE_Y = PLAY_TOP + 8;      // a carried humanoid lost above this line
const GRAB_DIST = 14;
const ALIEN_R = 12;

// --- Humanoids ---
const HUMAN_COUNT = 8;
const HUMAN_WALK = 14;              // px/s of aimless strolling
const HUMAN_GRAVITY = 420;
const SAFE_FALL_SPEED = 150;        // impact speed a humanoid survives
const CATCH_DX = 20;                // ship catch box around a falling humanoid
const CATCH_DY = 16;
const CARRY_OFFSET = 12;            // how far below the ship a rescue rides
const DROP_HEIGHT = 20;             // fly this close to the ridge to set one down

// --- Game rules ---
const START_LIVES = 3;
const START_BOMBS = 3;
const MAX_BOMBS = 6;
const MAX_WAVE_LANDERS = 15;
const WAVE_CLEAR_DELAY = 1.2;       // beat between clearing a wave and the next
const SCORE_LANDER = 150;
const SCORE_MUTANT = 150;
const SCORE_RESCUE = 500;
const SCORE_HUMAN_BONUS = 100;
const HIGH_SCORE_KEY = 'defender-highscore';

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const highEl = document.getElementById('high');
const waveEl = document.getElementById('wave');
const livesEl = document.getElementById('lives');
const bombsEl = document.getElementById('bombs');
const humansEl = document.getElementById('humans');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, highScore, lives, wave, bombs, camX, carried, planetLost;
let waveTimer, respawnTimer, clock;
const ship = {
    x: WORLD_W / 2, y: 200, vx: 0, dir: 1,
    thrust: 0, climb: 0, dead: false, invuln: 0,
};
const bullets = [];
const enemyBullets = [];
const landers = [];
const mutants = [];
const humans = [];
const particles = [];
const stars = [];

// ---------------------------------------------------------------------------
// Geometry helpers — everything spatial goes through these, so the seam in the
// world is invisible to the rest of the code.
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Normalise a world coordinate into [0, WORLD_W).
function wrapX(x) {
    return ((x % WORLD_W) + WORLD_W) % WORLD_W;
}

// Shortest signed distance from a to b, taking the seam into account.
function worldDelta(a, b) {
    let d = wrapX(b - a);
    if (d > WORLD_W / 2) d -= WORLD_W;
    return d;
}

// World x → screen x, relative to the camera and across the seam.
function screenX(x) {
    return wrapX(x - camX);
}

// A deterministic ridge: vertices from a small seeded LCG, sampled with linear
// interpolation. The last vertex repeats the first so the ridge is continuous.
const TERRAIN = (() => {
    const n = Math.round(WORLD_W / TERRAIN_STEP);
    const pts = [];
    let seed = 20260901;
    for (let i = 0; i < n; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        pts.push(330 + (seed % 1000) / 1000 * 62);
    }
    pts.push(pts[0]);
    return pts;
})();

// Height of the ridge under a world coordinate.
function terrainAt(x) {
    const t = wrapX(x) / TERRAIN_STEP;
    const i = Math.floor(t);
    const f = t - i;
    return TERRAIN[i] * (1 - f) + TERRAIN[i + 1] * f;
}

// ---------------------------------------------------------------------------
// Entity factories
// ---------------------------------------------------------------------------

function makeHuman(x) {
    return {
        x: wrapX(x),
        y: terrainAt(x),
        vx: Math.random() < 0.5 ? -HUMAN_WALK : HUMAN_WALK,
        vy: 0,
        state: 'ground',
    };
}

function spawnLander(x, y) {
    const l = {
        x: wrapX(x),
        y,
        vy: 0,
        state: 'seek',
        human: null,
        fireTimer: 1 + Math.random() * LANDER_FIRE_CD,
        phase: Math.random() * Math.PI * 2,
    };
    landers.push(l);
    return l;
}

function spawnMutant(x, y) {
    const m = {
        x: wrapX(x),
        y,
        vx: 0,
        vy: 0,
        fireTimer: 0.6 + Math.random() * MUTANT_FIRE_CD,
        phase: Math.random() * Math.PI * 2,
    };
    mutants.push(m);
    return m;
}

function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random();
        const sp = 60 + Math.random() * 180;
        particles.push({
            x: wrapX(x), y,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 0.4 + Math.random() * 0.4, color,
        });
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    lives = START_LIVES;
    wave = 1;
    bombs = START_BOMBS;
    planetLost = false;
    waveTimer = 0;
    respawnTimer = 0;
    clock = 0;
    carried = null;

    bullets.length = 0;
    enemyBullets.length = 0;
    landers.length = 0;
    mutants.length = 0;
    humans.length = 0;
    particles.length = 0;

    for (let i = 0; i < HUMAN_COUNT; i++) {
        humans.push(makeHuman((i + 0.5) * (WORLD_W / HUMAN_COUNT)));
    }

    ship.x = WORLD_W / 2;
    ship.y = 200;
    ship.vx = 0;
    ship.dir = 1;
    ship.thrust = 0;
    ship.climb = 0;
    ship.dead = false;
    ship.invuln = INVULN_TIME;
    camX = wrapX(ship.x - CANVAS_W / 2);

    spawnWave();
    hideOverlay();
    updateHud();
}

// How many landers a wave sends — steadily more, up to a ceiling.
function landerCount(w) {
    return Math.min(5 + 2 * w, MAX_WAVE_LANDERS);
}

function spawnWave() {
    const n = landerCount(wave);
    for (let i = 0; i < n; i++) {
        const x = wrapX(ship.x + WORLD_W / 4 + (i / n) * (WORLD_W / 2) + Math.random() * 60);
        spawnLander(x, PLAY_TOP + 20 + Math.random() * 110);
    }
}

// Called when the sky is clear: pay the humanoid bonus, restock a bomb and
// send in the next, larger wave.
function nextWave() {
    addScore(humans.length * SCORE_HUMAN_BONUS);
    wave += 1;
    bombs = Math.min(bombs + 1, MAX_BOMBS);
    waveTimer = 0;
    spawnWave();
    updateHud();
}

function addScore(n) {
    score += n;
    updateHud();
}

function killPlayer() {
    if (state !== 'running' || ship.dead) return;
    burst(ship.x, ship.y, '#6ee7ff', 22);
    dropCarried();
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        updateHud();
        endGame();
        return;
    }
    ship.dead = true;
    ship.vx = 0;
    ship.thrust = 0;
    ship.climb = 0;
    respawnTimer = RESPAWN_TIME;
    updateHud();
}

function respawn() {
    ship.dead = false;
    ship.y = 200;
    ship.vx = 0;
    ship.invuln = INVULN_TIME;
    camX = wrapX(ship.x - CANVAS_W / 2);
}

function endGame() {
    state = 'over';
    if (score > highScore) {
        highScore = score;
        try { localStorage.setItem(HIGH_SCORE_KEY, String(highScore)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} — wave ${wave}`, 'Press Space to fly again', 'Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function setThrust(dir) {
    ship.thrust = dir;
    if (dir !== 0) ship.dir = dir < 0 ? -1 : 1;
}

function setClimb(dir) {
    ship.climb = dir;
}

function fire() {
    if (state !== 'running' || ship.dead) return;
    if (bullets.length >= MAX_BULLETS) return;
    bullets.push({
        x: wrapX(ship.x + ship.dir * (SHIP_W / 2)),
        y: ship.y,
        vx: ship.dir * BULLET_SPEED,
        life: BULLET_LIFE,
    });
}

// Wipe out every alien currently on screen.
function smartBomb() {
    if (state !== 'running' || bombs <= 0) return;
    bombs -= 1;
    const onScreen = (e) => screenX(e.x) >= 0 && screenX(e.x) <= CANVAS_W;
    for (let i = landers.length - 1; i >= 0; i--) {
        if (!onScreen(landers[i])) continue;
        const l = landers[i];
        if (l.human) l.human.state = 'falling';
        burst(l.x, l.y, '#f97362', 10);
        landers.splice(i, 1);
        addScore(SCORE_LANDER);
    }
    for (let i = mutants.length - 1; i >= 0; i--) {
        if (!onScreen(mutants[i])) continue;
        burst(mutants[i].x, mutants[i].y, '#c084fc', 10);
        mutants.splice(i, 1);
        addScore(SCORE_MUTANT);
    }
    burst(ship.x, ship.y, '#ffffff', 26);
    updateHud();
}

function dropCarried() {
    if (!carried) return;
    carried.state = 'falling';
    carried.vy = 0;
    carried = null;
}

// ---------------------------------------------------------------------------
// Simulation — `step` is the only entry point into the physics.
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    clock += dt;
    updateShip(dt);
    updateBullets(dt);
    updateLanders(dt);
    updateMutants(dt);
    updateEnemyBullets(dt);
    updateHumans(dt);
    updateParticles(dt);
    checkPlanetLost();
    checkShipCollisions();
    updateCamera(dt);
    updateWave(dt);
    updateHud();
}

function updateShip(dt) {
    if (ship.dead) {
        respawnTimer -= dt;
        if (respawnTimer <= 0) respawn();
        return;
    }
    ship.invuln = Math.max(0, ship.invuln - dt);

    if (ship.thrust !== 0) {
        ship.vx += ship.thrust * SHIP_ACCEL * dt;
        ship.vx = clamp(ship.vx, -SHIP_MAX_SPEED, SHIP_MAX_SPEED);
    } else {
        ship.vx *= Math.exp(-SHIP_DRAG * dt);
        if (Math.abs(ship.vx) < 0.5) ship.vx = 0;
    }
    ship.x = wrapX(ship.x + ship.vx * dt);
    ship.y += ship.climb * VERT_SPEED * dt;
    ship.y = clamp(ship.y, PLAY_TOP + SHIP_H, terrainAt(ship.x) - SHIP_CLEARANCE);

    // Carrying a humanoid low over the ridge sets it down safely.
    if (carried) {
        carried.x = ship.x;
        carried.y = ship.y + CARRY_OFFSET;
        if (ship.y >= terrainAt(ship.x) - DROP_HEIGHT) {
            carried.state = 'ground';
            carried.y = terrainAt(carried.x);
            carried.vy = 0;
            carried = null;
            addScore(SCORE_RESCUE);
            burst(ship.x, ship.y + CARRY_OFFSET, '#ffd166', 12);
        }
    }
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x = wrapX(b.x + b.vx * dt);
        b.life -= dt;
        if (b.life <= 0) { bullets.splice(i, 1); continue; }
        if (hitAlien(b)) bullets.splice(i, 1);
    }
}

// Does this shot destroy an alien? Returns true if the shot was consumed.
function hitAlien(b) {
    for (let i = landers.length - 1; i >= 0; i--) {
        const l = landers[i];
        if (Math.abs(worldDelta(b.x, l.x)) > 16 || Math.abs(b.y - l.y) > 12) continue;
        if (l.human) {
            l.human.state = 'falling';
            l.human.vy = 0;
            l.human = null;
        }
        burst(l.x, l.y, '#f97362', 10);
        landers.splice(i, 1);
        addScore(SCORE_LANDER);
        return true;
    }
    for (let i = mutants.length - 1; i >= 0; i--) {
        const m = mutants[i];
        if (Math.abs(worldDelta(b.x, m.x)) > 16 || Math.abs(b.y - m.y) > 12) continue;
        burst(m.x, m.y, '#c084fc', 10);
        mutants.splice(i, 1);
        addScore(SCORE_MUTANT);
        return true;
    }
    return false;
}

// Nearest humanoid still standing on the ground, or null.
function nearestGroundHuman(x) {
    let best = null;
    let bestD = Infinity;
    for (const h of humans) {
        if (h.state !== 'ground') continue;
        const d = Math.abs(worldDelta(x, h.x));
        if (d < bestD) { bestD = d; best = h; }
    }
    return best;
}

function updateLanders(dt) {
    for (let i = landers.length - 1; i >= 0; i--) {
        const l = landers[i];

        if (l.state === 'carry') {
            if (!l.human || l.human.state !== 'grabbed') {
                // The captive was shot loose — go looking for another.
                l.human = null;
                l.state = 'seek';
            } else {
                l.y -= LANDER_LIFT * dt;
                l.human.x = l.x;
                l.human.y = l.y + 14;
                if (l.y <= MUTATE_Y) {
                    // The humanoid is gone; the lander becomes a mutant.
                    const idx = humans.indexOf(l.human);
                    if (idx >= 0) humans.splice(idx, 1);
                    burst(l.x, l.y, '#c084fc', 14);
                    landers.splice(i, 1);
                    spawnMutant(l.x, MUTATE_Y + 12);
                    continue;
                }
            }
        }

        if (l.state === 'seek') {
            const target = nearestGroundHuman(l.x);
            if (target) {
                const dx = worldDelta(l.x, target.x);
                l.x = wrapX(l.x + clamp(dx, -1, 1) * LANDER_SPEED * dt);
                if (l.y < target.y - 2) l.y += LANDER_DESCEND * dt;
                if (Math.abs(worldDelta(l.x, target.x)) < GRAB_DIST
                    && Math.abs(l.y - target.y) < GRAB_DIST) {
                    target.state = 'grabbed';
                    l.human = target;
                    l.state = 'carry';
                }
            } else {
                // Nobody left to abduct — hunt the ship instead.
                const dx = worldDelta(l.x, ship.x);
                const dy = ship.y - l.y;
                const d = Math.max(1, Math.hypot(dx, dy));
                l.x = wrapX(l.x + (dx / d) * LANDER_HUNT_SPEED * dt);
                l.y += (dy / d) * LANDER_HUNT_SPEED * dt;
            }
        }

        l.y = clamp(l.y, MUTATE_Y, terrainAt(l.x) - 6);
        alienFire(l, dt, LANDER_FIRE_CD);
    }
}

function updateMutants(dt) {
    for (const m of mutants) {
        const dx = worldDelta(m.x, ship.x);
        const dy = ship.y - m.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        // A jittered heading, so mutants weave instead of homing perfectly.
        const wobble = Math.sin(clock * 4 + m.phase) * 0.35;
        m.vx += ((dx / d) + wobble * (dy / d)) * MUTANT_ACCEL * dt;
        m.vy += ((dy / d) - wobble * (dx / d)) * MUTANT_ACCEL * dt;
        const sp = Math.hypot(m.vx, m.vy);
        if (sp > MUTANT_SPEED) {
            m.vx = (m.vx / sp) * MUTANT_SPEED;
            m.vy = (m.vy / sp) * MUTANT_SPEED;
        }
        m.x = wrapX(m.x + m.vx * dt);
        m.y = clamp(m.y + m.vy * dt, PLAY_TOP + 6, terrainAt(m.x) - 6);
        alienFire(m, dt, MUTANT_FIRE_CD);
    }
}

// Aliens shoot on a cooldown whenever the ship is within range — no randomness
// in the decision, so every shot in the tests is reproducible.
function alienFire(e, dt, cooldown) {
    e.fireTimer -= dt;
    if (e.fireTimer > 0) return;
    e.fireTimer = cooldown + Math.random() * cooldown;
    if (ship.dead || Math.abs(worldDelta(e.x, ship.x)) > FIRE_RANGE) return;
    const dx = worldDelta(e.x, ship.x);
    const dy = ship.y - e.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    enemyBullets.push({
        x: e.x,
        y: e.y,
        vx: (dx / d) * ENEMY_BULLET_SPEED,
        vy: (dy / d) * ENEMY_BULLET_SPEED,
        life: ENEMY_BULLET_LIFE,
    });
}

function updateEnemyBullets(dt) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.x = wrapX(b.x + b.vx * dt);
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0 || b.y < PLAY_TOP || b.y > terrainAt(b.x)) enemyBullets.splice(i, 1);
    }
}

function updateHumans(dt) {
    for (let i = humans.length - 1; i >= 0; i--) {
        const h = humans[i];

        if (h.state === 'ground') {
            h.x = wrapX(h.x + h.vx * dt);
            h.y = terrainAt(h.x);
            if (Math.random() < 0.004) h.vx = -h.vx;
        } else if (h.state === 'falling') {
            h.vy += HUMAN_GRAVITY * dt;
            h.y += h.vy * dt;
            const ground = terrainAt(h.x);
            if (!ship.dead && !carried && canCatch(h)) {
                h.state = 'carried';
                h.vy = 0;
                carried = h;
            } else if (h.y >= ground) {
                if (h.vy > SAFE_FALL_SPEED) {
                    burst(h.x, ground, '#ffd166', 10);
                    humans.splice(i, 1);
                    continue;
                }
                h.y = ground;
                h.vy = 0;
                h.state = 'ground';
            }
        }
        // 'grabbed' and 'carried' humanoids are moved by their captor / rescuer.
    }
}

function canCatch(h) {
    return Math.abs(worldDelta(h.x, ship.x)) < CATCH_DX && Math.abs(h.y - ship.y) < CATCH_DY;
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

// Lose every humanoid and the planet is lost: the surviving landers have
// nothing to abduct, so they all mutate at once.
function checkPlanetLost() {
    if (planetLost || humans.length > 0) return;
    planetLost = true;
    for (let i = landers.length - 1; i >= 0; i--) {
        const l = landers[i];
        burst(l.x, l.y, '#c084fc', 12);
        landers.splice(i, 1);
        spawnMutant(l.x, l.y);
    }
}

function checkShipCollisions() {
    if (ship.dead || ship.invuln > 0) return;
    const hits = (x, y, rx, ry) =>
        Math.abs(worldDelta(x, ship.x)) < rx && Math.abs(y - ship.y) < ry;

    for (const l of landers) {
        if (hits(l.x, l.y, SHIP_W / 2 + ALIEN_R / 2, SHIP_H + ALIEN_R / 2)) { killPlayer(); return; }
    }
    for (const m of mutants) {
        if (hits(m.x, m.y, SHIP_W / 2 + ALIEN_R / 2, SHIP_H + ALIEN_R / 2)) { killPlayer(); return; }
    }
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        if (!hits(b.x, b.y, SHIP_W / 2, SHIP_H)) continue;
        enemyBullets.splice(i, 1);
        killPlayer();
        return;
    }
}

function updateCamera(dt) {
    const target = wrapX(ship.x - CANVAS_W / 2 + ship.dir * CAM_LEAD);
    camX = wrapX(camX + worldDelta(camX, target) * Math.min(1, CAM_EASE * dt));
}

function updateWave(dt) {
    if (landers.length > 0 || mutants.length > 0) {
        waveTimer = 0;
        return;
    }
    waveTimer += dt;
    if (waveTimer >= WAVE_CLEAR_DELAY) nextWave();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    highEl.textContent = String(Math.max(highScore, score));
    waveEl.textContent = String(wave);
    livesEl.textContent = String(lives);
    bombsEl.textContent = String(bombs);
    humansEl.textContent = String(humans.length);
}

function showOverlay(title, scoreLine, sub, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering — never mutates simulation state.
// ---------------------------------------------------------------------------

for (let i = 0; i < 90; i++) {
    stars.push({
        x: Math.random() * WORLD_W,
        y: PLAY_TOP + 6 + Math.random() * 200,
        r: Math.random() < 0.75 ? 1 : 1.6,
    });
}

function draw() {
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawStars();
    drawTerrain();
    drawAliens();
    drawHumans();       // above the aliens, so a dangling captive stays visible
    drawShots();
    drawParticles();
    if (!ship.dead && state !== 'idle') drawShip();
    drawRadar();
}

function drawStars() {
    ctx.fillStyle = '#1d2b45';
    for (const s of stars) {
        const sx = screenX(s.x);
        if (sx < -2 || sx > CANVAS_W + 2) continue;
        ctx.fillRect(sx, s.y, s.r, s.r);
    }
}

function drawTerrain() {
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H);
    for (let sx = 0; sx <= CANVAS_W; sx += 4) {
        ctx.lineTo(sx, terrainAt(camX + sx));
    }
    ctx.lineTo(CANVAS_W, CANVAS_H);
    ctx.closePath();
    ctx.fillStyle = '#0d1a2b';
    ctx.fill();
    ctx.strokeStyle = '#2f6f8f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let sx = 0; sx <= CANVAS_W; sx += 4) {
        const y = terrainAt(camX + sx);
        if (sx === 0) ctx.moveTo(sx, y); else ctx.lineTo(sx, y);
    }
    ctx.stroke();
}

function drawShip() {
    const sx = screenX(ship.x);
    if (sx < -40 || sx > CANVAS_W + 40) return;
    ctx.save();
    ctx.translate(sx, ship.y);
    ctx.scale(ship.dir, 1);
    ctx.globalAlpha = ship.invuln > 0 && Math.floor(ship.invuln * 12) % 2 === 0 ? 0.4 : 1;
    ctx.fillStyle = '#6ee7ff';
    ctx.beginPath();
    ctx.moveTo(SHIP_W / 2, 0);
    ctx.lineTo(-SHIP_W / 4, -SHIP_H / 2);
    ctx.lineTo(-SHIP_W / 2, -SHIP_H / 2);
    ctx.lineTo(-SHIP_W / 2, SHIP_H / 2);
    ctx.lineTo(-SHIP_W / 4, SHIP_H / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-SHIP_W / 4, -2, SHIP_W / 3, 4);
    if (ship.thrust !== 0) {
        ctx.fillStyle = '#ffb703';
        ctx.beginPath();
        ctx.moveTo(-SHIP_W / 2, -3);
        ctx.lineTo(-SHIP_W / 2 - 10 - Math.random() * 6, 0);
        ctx.lineTo(-SHIP_W / 2, 3);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

function drawAliens() {
    for (const l of landers) {
        const sx = screenX(l.x);
        if (sx < -20 || sx > CANVAS_W + 20) continue;
        ctx.fillStyle = '#f97362';
        ctx.beginPath();
        ctx.moveTo(sx - 11, l.y + 6);
        ctx.lineTo(sx, l.y - 8);
        ctx.lineTo(sx + 11, l.y + 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffe066';
        ctx.fillRect(sx - 3, l.y - 1, 6, 4);
        if (l.human) {
            ctx.strokeStyle = '#f97362';
            ctx.beginPath();
            ctx.moveTo(sx, l.y + 6);
            ctx.lineTo(sx, l.y + 14);
            ctx.stroke();
        }
    }
    for (const m of mutants) {
        const sx = screenX(m.x);
        if (sx < -20 || sx > CANVAS_W + 20) continue;
        ctx.fillStyle = '#c084fc';
        ctx.fillRect(sx - 8, m.y - 8, 16, 16);
        ctx.fillStyle = '#2b0f3f';
        ctx.fillRect(sx - 4, m.y - 3, 8, 4);
    }
}

function drawHumans() {
    for (const h of humans) {
        const sx = screenX(h.x);
        if (sx < -12 || sx > CANVAS_W + 12) continue;
        ctx.fillStyle = h.state === 'falling' ? '#fff1b8' : '#ffd166';
        ctx.fillRect(sx - 2, h.y - 10, 4, 6);      // head + body
        ctx.fillRect(sx - 4, h.y - 4, 8, 4);       // legs
    }
}

function drawShots() {
    ctx.fillStyle = '#e6f9ff';
    for (const b of bullets) {
        const sx = screenX(b.x);
        ctx.fillRect(sx - (b.vx > 0 ? 0 : 14), b.y - 1, 14, 2);
    }
    ctx.fillStyle = '#ff7b6b';
    for (const b of enemyBullets) {
        const sx = screenX(b.x);
        ctx.fillRect(sx - 2, b.y - 2, 4, 4);
    }
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
        ctx.fillStyle = p.color;
        ctx.fillRect(screenX(p.x) - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
}

// The radar shows the whole planet squeezed into the top strip, centred on the
// ship so the seam never splits what you are looking at.
function drawRadar() {
    ctx.fillStyle = '#080d18';
    ctx.fillRect(0, 0, CANVAS_W, RADAR_H);
    ctx.strokeStyle = '#22344f';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, CANVAS_W - 1, RADAR_H - 1);

    const scale = CANVAS_W / WORLD_W;
    const rx = (x) => CANVAS_W / 2 + worldDelta(ship.x, x) * scale;
    const ry = (y) => 6 + (y / CANVAS_H) * (RADAR_H - 12);

    // A faint ridge, so the radar reads as the same planet you are flying over.
    ctx.strokeStyle = '#16283d';
    ctx.beginPath();
    for (let i = 0; i <= CANVAS_W; i += 8) {
        const y = ry(terrainAt(ship.x + (i - CANVAS_W / 2) / scale));
        if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
    }
    ctx.stroke();

    // The slice of world currently on screen.
    ctx.strokeStyle = '#2c4b6b';
    ctx.strokeRect(rx(camX), 2, CANVAS_W * scale, RADAR_H - 4);

    ctx.fillStyle = '#ffd166';
    for (const h of humans) ctx.fillRect(rx(h.x) - 1, ry(h.y) - 2, 2, 4);
    ctx.fillStyle = '#f97362';
    for (const l of landers) ctx.fillRect(rx(l.x) - 2, ry(l.y) - 2, 4, 4);
    ctx.fillStyle = '#c084fc';
    for (const m of mutants) ctx.fillRect(rx(m.x) - 2, ry(m.y) - 2, 4, 4);

    if (!ship.dead && state !== 'idle') {
        ctx.fillStyle = '#6ee7ff';
        ctx.fillRect(CANVAS_W / 2 - 3, ry(ship.y) - 2, 6, 4);
    }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const heldKeys = new Set();

function refreshKeys() {
    const left = heldKeys.has('ArrowLeft') || heldKeys.has('a');
    const right = heldKeys.has('ArrowRight') || heldKeys.has('d');
    const up = heldKeys.has('ArrowUp') || heldKeys.has('w');
    const down = heldKeys.has('ArrowDown') || heldKeys.has('s');
    setThrust((right ? 1 : 0) - (left ? 1 : 0));
    setClimb((down ? 1 : 0) - (up ? 1 : 0));
}

const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's'];

window.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (key === 'p') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (key === ' ' || key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') fire();
        e.preventDefault();
        return;
    }
    if (key === 'b') {
        smartBomb();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(key)) {
        heldKeys.add(key);
        refreshKeys();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (heldKeys.delete(key)) refreshKeys();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

highScore = parseInt(localStorage.getItem(HIGH_SCORE_KEY) || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
wave = 1;
bombs = START_BOMBS;
carried = null;
planetLost = false;
waveTimer = 0;
respawnTimer = 0;
clock = 0;
camX = wrapX(ship.x - CANVAS_W / 2);
for (let i = 0; i < HUMAN_COUNT; i++) {
    humans.push(makeHuman((i + 0.5) * (WORLD_W / HUMAN_COUNT)));
}
updateHud();
requestAnimationFrame(frame);
