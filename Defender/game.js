// ---------------------------------------------------------------------------
// Defender — a side-scrolling planetary rescue shooter on an HTML5 canvas.
//
// You fly over a wrapping mountain landscape guarding ten humanoids. Landers
// drop out of the sky, grab a humanoid and haul it to the top of the screen; a
// lander that gets there mutates into a fast mutant and the humanoid is lost
// for good. Shoot a carrier and the humanoid falls — catch it and set it back
// down for a bonus. The world is four screens wide, so the scanner strip across
// the top of the canvas is where you actually watch the planet.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Snake, Tetris
// and BurgerTime in this repo. All motion is expressed per-second and advanced
// through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World / layout ------------------------------------------------------
const CANVAS_W = 760;
const CANVAS_H = 520;
const RADAR_H = 64;
const SKY_TOP = 70;              // first pixel row of the play field
const WORLD_W = 4 * CANVAS_W;    // 3040 — the planet wraps at this width
const RADAR_SCALE = CANVAS_W / WORLD_W;
const TERRAIN_STEP = 40;
const TERRAIN_POINTS = WORLD_W / TERRAIN_STEP;
const TERRAIN_MIN = 440;
const TERRAIN_MAX = 500;
const MUTATE_Y = SKY_TOP + 14;   // a carrier crossing this line mutates

// --- Ship ----------------------------------------------------------------
const START_X = WORLD_W / 2;
const START_Y = SKY_TOP + 180;
const ACCEL_X = 900;
const MAX_VX = 420;
const MAX_VY = 300;
const DRAG_X = 2.2;              // exponential decay per second
const LIFT_RESPONSE = 9;         // how fast the climb rate reaches the target
const SHIP_HW = 15;
const SHIP_HH = 7;
const CEILING = SKY_TOP + 10;
const GROUND_CLEARANCE = 12;     // how close the hull may get to the rock

// --- Guns ----------------------------------------------------------------
const BULLET_SPEED = 900;
const BULLET_LIFE = 0.55;
const MAX_BULLETS = 6;
const FIRE_COOLDOWN = 0.16;
const ALIEN_SHOT_SPEED = 190;
const ALIEN_SHOT_LIFE = 4;
const ALIEN_FIRE_MIN = 1.4;
const ALIEN_FIRE_VAR = 1.8;

// --- Aliens --------------------------------------------------------------
const ALIEN_HW = 16;
const ALIEN_HH = 14;
const LANDER_VX = 70;
const LANDER_VY = 75;
const LANDER_LIFT = 60;
const MUTANT_SPEED = 150;
const GRAB_DX = 10;
const GRAB_DY = 18;
const PATROL_TOP = SKY_TOP + 30;
const PATROL_BOTTOM = 360;

// --- Humanoids -----------------------------------------------------------
const HUMANOID_COUNT = 10;
const HUMANOID_LIFT = 9;         // how far the feet sit above the terrain line
const HUMANOID_WALK = 12;
const GRAVITY = 210;
const CATCH_DX = 22;
const CATCH_DY = 16;
const DROP_HEIGHT = 26;          // fly this close to the rock to set one down

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const START_BOMBS = 3;
const DEATH_PAUSE = 1.6;
const WAVECLEAR_PAUSE = 2;
const BLAST_RADIUS = 130;
const LANDER_SCORE = 150;
const MUTANT_SCORE = 250;
const CATCH_SCORE = 250;
const RESCUE_SCORE = 500;
const HUMANOID_BONUS = 100;
const BOMB_EVERY = 3;            // waves between smart-bomb resupplies

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const waveEl = document.getElementById('wave');
const livesEl = document.getElementById('lives');
const bombsEl = document.getElementById('bombs');
const humansEl = document.getElementById('humans');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Seeded RNG — the planet, its stars and the spawn positions are reproducible.
// ---------------------------------------------------------------------------

let seed = 0x5eed1234;

function setSeed(n) {
    seed = n >>> 0 || 1;
}

function rand() {
    // xorshift32: small, fast and deterministic across browsers.
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
}

const randRange = (lo, hi) => lo + rand() * (hi - lo);

// ---------------------------------------------------------------------------
// World helpers
// ---------------------------------------------------------------------------

const wrapX = (x) => ((x % WORLD_W) + WORLD_W) % WORLD_W;

// Shortest signed distance from `from` to `to` around the wrapping world.
function signedDelta(to, from) {
    let d = wrapX(to) - wrapX(from);
    if (d > WORLD_W / 2) d -= WORLD_W;
    if (d < -WORLD_W / 2) d += WORLD_W;
    return d;
}

let terrain = [];
let backTerrain = [];
let stars = [];

// One ridge line: `count` summed sine waves at whole-number frequencies, so the
// profile is jagged but exactly periodic and joins up where the world wraps.
function ridge(mid, spread) {
    const waves = [];
    for (const freq of [1, 2, 3, 5, 8, 13]) {
        waves.push({ freq, amp: randRange(3, spread) / freq ** 0.35, phase: rand() * Math.PI * 2 });
    }
    const points = [];
    for (let i = 0; i < TERRAIN_POINTS; i++) {
        const t = (i / TERRAIN_POINTS) * Math.PI * 2;
        let h = mid;
        for (const w of waves) h += Math.sin(t * w.freq + w.phase) * w.amp;
        points.push(h);
    }
    return points;
}

function buildTerrain() {
    setSeed(0x5eed1234);
    const mid = (TERRAIN_MIN + TERRAIN_MAX) / 2;
    terrain = ridge(mid, 30).map((h) => Math.max(TERRAIN_MIN, Math.min(TERRAIN_MAX, h)));
    // A dimmer range behind the playfield, scrolled at half speed for depth.
    backTerrain = ridge(TERRAIN_MIN - 46, 44).map((h) => Math.min(TERRAIN_MAX, h));
    stars = [];
    for (let i = 0; i < 160; i++) {
        stars.push({
            x: rand() * WORLD_W,
            y: SKY_TOP + rand() * (TERRAIN_MIN - SKY_TOP - 40),
            r: randRange(0.6, 1.6),
            depth: randRange(0.3, 0.7),
        });
    }
}

// Height of a ridge line at any world x, linearly interpolated between points.
function sampleRidge(points, x) {
    const p = wrapX(x) / TERRAIN_STEP;
    const i = Math.floor(p);
    const t = p - i;
    const a = points[i % TERRAIN_POINTS];
    const b = points[(i + 1) % TERRAIN_POINTS];
    return a + (b - a) * t;
}

// The rock surface the ship, the humanoids and the landers all live on.
const terrainY = (x) => sampleRidge(terrain, x);

// Screen x for a world x, given the camera. Points a little to the left of the
// camera come back negative so entities slide off the edge instead of jumping.
function screenX(x) {
    let d = wrapX(x - cameraX);
    if (d > WORLD_W - 240) d -= WORLD_W;
    return d;
}

const onScreen = (x, margin = 24) => {
    const sx = screenX(x);
    return sx >= -margin && sx <= CANVAS_W + margin;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// state: 'idle' | 'running' | 'paused' | 'dying' | 'waveclear' | 'over'
let state, score, best, lives, wave, smartBombs, planetDead;
let ship, bullets, alienShots, aliens, humanoids, particles;
let cameraX, leadOffset, fireTimer, stateTimer, elapsed, waveSpawned;

// Test seams: switch off spawning / alien fire, or drive step() by hand.
let spawnEnabled = true;
let alienFireEnabled = true;
let autoStep = true;

const input = { left: false, right: false, up: false, down: false };

function resetShip() {
    ship = {
        x: cameraX === undefined ? START_X : wrapX(cameraX + CANVAS_W * 0.4),
        y: START_Y,
        vx: 0,
        vy: 0,
        facing: 1,
    };
}

function resetHumanoids() {
    humanoids = [];
    for (let i = 0; i < HUMANOID_COUNT; i++) {
        const x = wrapX((i + 0.5) * (WORLD_W / HUMANOID_COUNT) + randRange(-60, 60));
        humanoids.push({
            x,
            y: terrainY(x) - HUMANOID_LIFT,
            vy: 0,
            dir: rand() < 0.5 ? -1 : 1,
            turnIn: randRange(1, 3),
            state: 'ground',
        });
    }
}

const humansAlive = () => humanoids.filter((h) => h.state !== 'lost').length;

// ---------------------------------------------------------------------------
// Run / wave lifecycle
// ---------------------------------------------------------------------------

function startGame() {
    setSeed(0xa17e5);
    state = 'running';
    score = 0;
    lives = START_LIVES;
    wave = 1;
    smartBombs = START_BOMBS;
    planetDead = false;
    bullets = [];
    alienShots = [];
    aliens = [];
    particles = [];
    cameraX = wrapX(START_X - CANVAS_W * 0.4);
    leadOffset = CANVAS_W * 0.4;
    fireTimer = 0;
    stateTimer = 0;
    elapsed = 0;
    waveSpawned = 0;
    resetHumanoids();
    resetShip();
    spawnWave();
    hideOverlay();
    updateHud();
}

function spawnWave() {
    if (!spawnEnabled) return;
    const count = Math.min(4 + wave, 12);
    for (let i = 0; i < count; i++) {
        const x = wrapX(ship.x + randRange(400, WORLD_W - 400));
        spawnLander(x, SKY_TOP + randRange(20, 150));
    }
}

function spawnLander(x, y) {
    const alien = {
        type: 'lander',
        x: wrapX(x),
        y,
        vx: 0,
        vy: 0,
        mode: 'hunt',
        carrying: null,
        dir: rand() < 0.5 ? -1 : 1,
        phase: rand() * Math.PI * 2,
        fireTimer: ALIEN_FIRE_MIN + rand() * ALIEN_FIRE_VAR,
    };
    aliens.push(alien);
    waveSpawned++;
    return alien;
}

function beginWaveClear() {
    state = 'waveclear';
    stateTimer = WAVECLEAR_PAUSE;
    score += humansAlive() * HUMANOID_BONUS;
    updateHud();
}

function nextWave() {
    wave++;
    if (wave % BOMB_EVERY === 0) smartBombs++;
    waveSpawned = 0;
    alienShots = [];
    state = 'running';
    stateTimer = 0;
    spawnWave();
    updateHud();
}

function killShip() {
    if (state !== 'running') return;
    lives--;
    state = 'dying';
    stateTimer = DEATH_PAUSE;
    alienShots = [];
    explode(ship.x, ship.y, 26, '#7fe9ff');
    for (const h of humanoids) {
        if (h.state === 'aboard') {
            h.state = 'falling';
            h.vy = 0;
        }
    }
    // Anything close enough is caught in the blast, so the replacement ship
    // never materialises inside the alien that just killed it.
    for (let i = aliens.length - 1; i >= 0; i--) {
        if (Math.abs(signedDelta(aliens[i].x, ship.x)) < BLAST_RADIUS &&
            Math.abs(aliens[i].y - ship.y) < BLAST_RADIUS) {
            killAlien(aliens[i], false);
        }
    }
    updateHud();
}

function respawn() {
    resetShip();
    fireTimer = 0;
    state = 'running';
    stateTimer = 0;
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        localStorage.setItem('defender-best', String(best));
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Wave ${wave}`, 'Press Space to fly again');
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

function fire() {
    if (state !== 'running') return false;
    if (fireTimer > 0 || bullets.length >= MAX_BULLETS) return false;
    fireTimer = FIRE_COOLDOWN;
    bullets.push({
        x: wrapX(ship.x + ship.facing * 20),
        y: ship.y,
        vx: ship.facing * BULLET_SPEED,
        life: BULLET_LIFE,
    });
    return true;
}

function useSmartBomb() {
    if (state !== 'running' || smartBombs <= 0) return false;
    smartBombs--;
    for (let i = aliens.length - 1; i >= 0; i--) {
        if (onScreen(aliens[i].x)) killAlien(aliens[i], true);
    }
    for (let i = alienShots.length - 1; i >= 0; i--) {
        if (onScreen(alienShots[i].x)) alienShots.splice(i, 1);
    }
    flash = 0.35;
    updateHud();
    return true;
}

function alienScore(alien) {
    return alien.type === 'mutant' ? MUTANT_SCORE : LANDER_SCORE;
}

function killAlien(alien, award) {
    const i = aliens.indexOf(alien);
    if (i === -1) return;
    aliens.splice(i, 1);
    if (alien.carrying) {
        alien.carrying.state = 'falling';
        alien.carrying.vy = 0;
        alien.carrying = null;
    }
    if (award) {
        score += alienScore(alien);
        updateHud();
    }
    explode(alien.x, alien.y, 18, alien.type === 'mutant' ? '#ff8a4a' : '#7cff9b');
}

function loseHumanoid(h) {
    if (h.state === 'lost') return;
    h.state = 'lost';
    if (humansAlive() === 0) {
        planetDead = true;
        // With nobody left to abduct, every lander turns hunter.
        for (const a of aliens) {
            if (a.type === 'lander') {
                a.type = 'mutant';
                a.mode = 'hunt';
                a.carrying = null;
            }
        }
    }
    updateHud();
}

function explode(x, y, count, color) {
    for (let i = 0; i < count; i++) {
        const angle = rand() * Math.PI * 2;
        const speed = randRange(40, 260);
        particles.push({
            x: wrapX(x),
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: randRange(0.3, 0.8),
            maxLife: 0.8,
            color,
        });
    }
}

let flash = 0;

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running' && state !== 'dying' && state !== 'waveclear') return;
    elapsed += dt;
    if (flash > 0) flash = Math.max(0, flash - dt);

    // The camera is refreshed before the aliens move: their "am I on screen?"
    // checks have to agree with where the ship actually is this frame.
    if (state === 'running') updateShip(dt);
    updateCamera(dt);
    if (state === 'running') {
        updateBullets(dt);
        updateAliens(dt);
        updateAlienShots(dt);
    }
    updateHumanoids(dt);
    updateParticles(dt);

    if (state === 'running') {
        checkShipCollisions();
        if (state === 'running' && waveSpawned > 0 && aliens.length === 0) beginWaveClear();
    } else {
        stateTimer -= dt;
        if (stateTimer <= 0) {
            if (state === 'dying') {
                if (lives <= 0) gameOver();
                else respawn();
            } else if (state === 'waveclear') {
                nextWave();
            }
        }
    }
}

function updateShip(dt) {
    if (fireTimer > 0) fireTimer -= dt;

    const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const ay = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (ax !== 0) ship.facing = ax;

    // Horizontal flight carries momentum — that inertia is the whole feel of
    // the game — while the climb is deliberately crisp, so threading a gap in
    // the mountains never turns into a wrestling match with the ship.
    if (ax !== 0) ship.vx += ax * ACCEL_X * dt;
    else ship.vx *= Math.exp(-DRAG_X * dt);
    const targetVy = ay * MAX_VY;
    ship.vy += (targetVy - ship.vy) * Math.min(1, dt * LIFT_RESPONSE);

    ship.vx = Math.max(-MAX_VX, Math.min(MAX_VX, ship.vx));
    ship.vy = Math.max(-MAX_VY, Math.min(MAX_VY, ship.vy));

    ship.x = wrapX(ship.x + ship.vx * dt);
    ship.y += ship.vy * dt;

    const floor = terrainY(ship.x) - GROUND_CLEARANCE;
    if (ship.y < CEILING) {
        ship.y = CEILING;
        if (ship.vy < 0) ship.vy = 0;
    }
    if (ship.y > floor) {
        ship.y = floor;
        if (ship.vy > 0) ship.vy = 0;
    }
}

function updateCamera(dt) {
    const target = ship.facing === 1 ? CANVAS_W * 0.4 : CANVAS_W * 0.6;
    leadOffset += (target - leadOffset) * Math.min(1, dt * 3);
    cameraX = wrapX(ship.x - leadOffset);
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
        let spent = false;
        for (let j = aliens.length - 1; j >= 0 && !spent; j--) {
            const a = aliens[j];
            if (Math.abs(signedDelta(b.x, a.x)) < ALIEN_HW + 4 && Math.abs(b.y - a.y) < ALIEN_HH) {
                killAlien(a, true);
                spent = true;
            }
        }
        for (let j = alienShots.length - 1; j >= 0 && !spent; j--) {
            const s = alienShots[j];
            if (Math.abs(signedDelta(b.x, s.x)) < 14 && Math.abs(b.y - s.y) < 10) {
                alienShots.splice(j, 1);
                explode(s.x, s.y, 5, '#ffd166');
                spent = true;
            }
        }
        if (spent) bullets.splice(i, 1);
    }
}

function nearestTarget(alien) {
    let best = null;
    let bestDist = Infinity;
    for (const h of humanoids) {
        if (h.state !== 'ground') continue;
        const d = Math.abs(signedDelta(h.x, alien.x));
        if (d < bestDist) {
            bestDist = d;
            best = h;
        }
    }
    return best;
}

function updateAliens(dt) {
    for (const a of aliens) {
        if (a.type === 'mutant') updateMutant(a, dt);
        else if (a.mode === 'lift') updateCarrier(a, dt);
        else updateHunter(a, dt);

        a.x = wrapX(a.x + a.vx * dt);
        a.y += a.vy * dt;

        if (a.mode === 'lift' && a.carrying) {
            a.carrying.x = a.x;
            a.carrying.y = a.y + 16;
            if (a.y <= MUTATE_Y) {
                a.type = 'mutant';
                a.mode = 'hunt';
                loseHumanoid(a.carrying);
                a.carrying = null;
            }
        }
        updateAlienGun(a, dt);
    }
}

function updateHunter(a, dt) {
    const target = nearestTarget(a);
    if (!target) {
        // Nothing to abduct: patrol at altitude until the tide turns.
        a.vx = a.dir * LANDER_VX * 0.7;
        a.vy = Math.sin(elapsed * 1.6 + a.phase) * 30;
        if (a.y < PATROL_TOP) a.vy = Math.abs(a.vy);
        if (a.y > PATROL_BOTTOM) a.vy = -Math.abs(a.vy);
        return;
    }
    const dx = signedDelta(target.x, a.x);
    const dy = target.y - a.y;
    a.vx = Math.abs(dx) < 4 ? 0 : Math.sign(dx) * LANDER_VX;
    a.vy = dy > 12 ? LANDER_VY : (dy < -12 ? -LANDER_VY : 0);
    if (Math.abs(dx) < GRAB_DX && Math.abs(dy) < GRAB_DY) {
        target.state = 'abducted';
        a.carrying = target;
        a.mode = 'lift';
        a.vx = 0;
        a.vy = -LANDER_LIFT;
    }
}

function updateCarrier(a, dt) {
    if (!a.carrying) {
        a.mode = 'hunt';
        return;
    }
    a.vx = 0;
    a.vy = -LANDER_LIFT;
}

function updateMutant(a, dt) {
    const dx = signedDelta(ship.x, a.x);
    const dy = ship.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    a.vx = (dx / len) * MUTANT_SPEED;
    a.vy = (dy / len) * MUTANT_SPEED + Math.sin(elapsed * 7 + a.phase) * 60;
}

function updateAlienGun(a, dt) {
    a.fireTimer -= dt;
    if (a.fireTimer > 0) return;
    a.fireTimer = ALIEN_FIRE_MIN + rand() * ALIEN_FIRE_VAR;
    if (!alienFireEnabled || !onScreen(a.x, 40)) return;
    const dx = signedDelta(ship.x, a.x);
    const dy = ship.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    alienShots.push({
        x: a.x,
        y: a.y,
        vx: (dx / len) * ALIEN_SHOT_SPEED,
        vy: (dy / len) * ALIEN_SHOT_SPEED,
        life: ALIEN_SHOT_LIFE,
    });
}

function updateAlienShots(dt) {
    for (let i = alienShots.length - 1; i >= 0; i--) {
        const s = alienShots[i];
        s.x = wrapX(s.x + s.vx * dt);
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0) alienShots.splice(i, 1);
    }
}

function updateHumanoids(dt) {
    for (const h of humanoids) {
        if (h.state === 'lost' || h.state === 'abducted') continue;

        if (h.state === 'ground') {
            h.turnIn -= dt;
            if (h.turnIn <= 0) {
                h.dir = -h.dir;
                h.turnIn = randRange(1.5, 4);
            }
            h.x = wrapX(h.x + h.dir * HUMANOID_WALK * dt);
            h.y = terrainY(h.x) - HUMANOID_LIFT;
            continue;
        }

        if (h.state === 'falling') {
            h.vy += GRAVITY * dt;
            h.y += h.vy * dt;
            if (state === 'running' &&
                Math.abs(signedDelta(h.x, ship.x)) < CATCH_DX &&
                Math.abs(h.y - ship.y) < CATCH_DY) {
                h.state = 'aboard';
                h.vy = 0;
                score += CATCH_SCORE;
                updateHud();
                continue;
            }
            const ground = terrainY(h.x) - HUMANOID_LIFT;
            if (h.y >= ground) {
                h.y = ground;
                h.vy = 0;
                h.state = 'ground';
            }
            continue;
        }

        if (h.state === 'aboard') {
            h.x = ship.x;
            h.y = ship.y + 12;
            if (state === 'running' && ship.y >= terrainY(ship.x) - DROP_HEIGHT) {
                h.state = 'ground';
                h.y = terrainY(h.x) - HUMANOID_LIFT;
                h.vy = 0;
                score += RESCUE_SCORE;
                updateHud();
            }
        }
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x = wrapX(p.x + p.vx * dt);
        p.y += p.vy * dt;
        p.vy += 60 * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function checkShipCollisions() {
    for (const a of aliens) {
        if (Math.abs(signedDelta(a.x, ship.x)) < SHIP_HW + ALIEN_HW - 8 &&
            Math.abs(a.y - ship.y) < SHIP_HH + ALIEN_HH) {
            killShip();
            return;
        }
    }
    for (const s of alienShots) {
        if (Math.abs(signedDelta(s.x, ship.x)) < SHIP_HW &&
            Math.abs(s.y - ship.y) < SHIP_HH + 4) {
            killShip();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#04070f';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawStars();
    drawTerrain();
    drawHumanoids();
    for (const a of aliens) drawAlien(a);
    drawShots();
    drawParticles();
    if (state !== 'dying' && state !== 'idle') drawShip();
    drawScanner();
    ctx.fillStyle = 'rgba(69, 224, 255, 0.28)';
    ctx.fillRect(0, RADAR_H, CANVAS_W, 1);

    if (flash > 0) {
        ctx.fillStyle = `rgba(220, 240, 255, ${flash * 0.7})`;
        ctx.fillRect(0, RADAR_H, CANVAS_W, CANVAS_H - RADAR_H);
    }

    if (state === 'dying') drawBanner('SHIP LOST', `${Math.max(0, lives)} left`);
    if (state === 'waveclear') drawBanner(`WAVE ${wave} CLEAR`, `${humansAlive()} humanoids saved`);
    if (planetDead && state !== 'idle') {
        ctx.fillStyle = 'rgba(255, 90, 110, 0.6)';
        ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PLANET LOST — MUTANTS EVERYWHERE', CANVAS_W / 2, RADAR_H + 24);
        ctx.textAlign = 'start';
    }
}

function drawStars() {
    for (const s of stars) {
        const sx = wrapX(s.x - cameraX * s.depth);
        const x = sx > CANVAS_W ? sx - WORLD_W : sx;
        if (x < -4 || x > CANVAS_W + 4) continue;
        ctx.globalAlpha = 0.35 + s.depth * 0.5;
        ctx.fillStyle = '#9fc7ff';
        ctx.fillRect(x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
}

function drawTerrain() {
    const first = Math.floor(cameraX / TERRAIN_STEP) - 1;
    const span = Math.ceil(CANVAS_W / TERRAIN_STEP) + 3;

    // Distant range, scrolled at half speed.
    const backFirst = Math.floor((cameraX * 0.5) / TERRAIN_STEP) - 1;
    ctx.beginPath();
    ctx.moveTo(-TERRAIN_STEP, CANVAS_H);
    for (let i = 0; i <= span; i++) {
        const worldX = (backFirst + i) * TERRAIN_STEP;
        ctx.lineTo(worldX - cameraX * 0.5, sampleRidge(backTerrain, worldX));
    }
    ctx.lineTo(CANVAS_W + TERRAIN_STEP, CANVAS_H);
    ctx.closePath();
    ctx.fillStyle = planetDead ? '#1a0a10' : '#08111d';
    ctx.fill();
    ctx.strokeStyle = planetDead ? 'rgba(255, 90, 110, 0.35)' : 'rgba(63, 224, 176, 0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-TERRAIN_STEP, CANVAS_H);
    for (let i = 0; i <= span; i++) {
        const worldX = (first + i) * TERRAIN_STEP;
        ctx.lineTo(screenX(worldX), terrainY(worldX));
    }
    ctx.lineTo(CANVAS_W + TERRAIN_STEP, CANVAS_H);
    ctx.closePath();
    ctx.fillStyle = planetDead ? '#2a0f14' : '#0d1a2c';
    ctx.fill();
    ctx.strokeStyle = planetDead ? '#ff5a6e' : '#3fe0b0';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawHumanoids() {
    for (const h of humanoids) {
        if (h.state === 'lost') continue;
        const x = screenX(h.x);
        if (x < -20 || x > CANVAS_W + 20) continue;
        ctx.fillStyle = h.state === 'falling' ? '#ffd166' : '#f5a3c7';
        ctx.fillRect(x - 3, h.y, 6, 5);       // body
        ctx.fillRect(x - 2, h.y - 5, 4, 4);   // head
        ctx.fillRect(x - 3, h.y + 5, 2, 4);   // legs
        ctx.fillRect(x + 1, h.y + 5, 2, 4);
    }
}

function drawAlien(a) {
    const x = screenX(a.x);
    if (x < -30 || x > CANVAS_W + 30) return;
    if (a.type === 'mutant') {
        ctx.fillStyle = '#ff8a4a';
        ctx.beginPath();
        ctx.moveTo(x, a.y - 10);
        ctx.lineTo(x + 12, a.y);
        ctx.lineTo(x, a.y + 10);
        ctx.lineTo(x - 12, a.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffe1a8';
        ctx.fillRect(x - 3, a.y - 2, 6, 4);
        return;
    }
    ctx.fillStyle = '#7cff9b';
    ctx.fillRect(x - 11, a.y - 3, 22, 7);          // hull
    ctx.fillRect(x - 5, a.y - 10, 10, 7);          // dome
    ctx.fillStyle = '#0d1a2c';
    ctx.fillRect(x - 2, a.y - 8, 4, 4);            // eye
    ctx.fillStyle = '#3fe0b0';
    ctx.fillRect(x - 9, a.y + 4, 3, 5);            // legs
    ctx.fillRect(x + 6, a.y + 4, 3, 5);
    if (a.carrying) {
        ctx.strokeStyle = 'rgba(124, 255, 155, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, a.y + 6);
        ctx.lineTo(x, a.y + 16);
        ctx.stroke();
    }
}

function drawShip() {
    const x = screenX(ship.x);
    const f = ship.facing;
    ctx.fillStyle = '#e8f4ff';
    ctx.beginPath();
    ctx.moveTo(x + f * 16, ship.y);
    ctx.lineTo(x - f * 10, ship.y - 7);
    ctx.lineTo(x - f * 4, ship.y);
    ctx.lineTo(x - f * 10, ship.y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#45e0ff';
    ctx.fillRect(x - f * 4, ship.y - 2, f * 12, 4);
    if (input.left || input.right) {
        ctx.fillStyle = 'rgba(255, 190, 80, 0.9)';
        ctx.fillRect(x - f * 16, ship.y - 2, -f * 8, 4);
    }
}

function drawShots() {
    ctx.fillStyle = '#8ef6ff';
    for (const b of bullets) {
        const x = screenX(b.x);
        const len = Math.sign(b.vx) * 26;
        ctx.fillRect(Math.min(x, x + len), b.y - 1, Math.abs(len), 3);
    }
    ctx.fillStyle = '#ffd166';
    for (const s of alienShots) {
        const x = screenX(s.x);
        if (x < -10 || x > CANVAS_W + 10) continue;
        ctx.fillRect(x - 2, s.y - 2, 4, 4);
    }
}

function drawParticles() {
    for (const p of particles) {
        const x = screenX(p.x);
        if (x < -10 || x > CANVAS_W + 10) continue;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
        ctx.fillStyle = p.color;
        ctx.fillRect(x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
}

function drawScanner() {
    ctx.fillStyle = '#060b16';
    ctx.fillRect(0, 0, CANVAS_W, RADAR_H);
    ctx.strokeStyle = '#1d2b47';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, CANVAS_W - 1, RADAR_H - 1);

    const mapY = (y) => 6 + ((y - SKY_TOP) / (TERRAIN_MAX - SKY_TOP)) * (RADAR_H - 12);

    // Terrain silhouette.
    ctx.beginPath();
    ctx.moveTo(0, RADAR_H);
    for (let i = 0; i <= TERRAIN_POINTS; i++) {
        const worldX = i * TERRAIN_STEP;
        ctx.lineTo(worldX * RADAR_SCALE, mapY(terrainY(worldX)));
    }
    ctx.lineTo(CANVAS_W, RADAR_H);
    ctx.closePath();
    ctx.fillStyle = planetDead ? 'rgba(255, 90, 110, 0.18)' : 'rgba(63, 224, 176, 0.16)';
    ctx.fill();

    for (const h of humanoids) {
        if (h.state === 'lost') continue;
        ctx.fillStyle = '#f5a3c7';
        ctx.fillRect(h.x * RADAR_SCALE - 1, mapY(h.y) - 1, 2, 3);
    }
    for (const a of aliens) {
        ctx.fillStyle = a.type === 'mutant' ? '#ff8a4a' : '#7cff9b';
        ctx.fillRect(a.x * RADAR_SCALE - 2, mapY(a.y) - 2, 4, 4);
    }
    if (state !== 'idle' && state !== 'dying') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(ship.x * RADAR_SCALE - 2, mapY(ship.y) - 1, 5, 3);
    }

    // The slice of the planet currently on screen.
    ctx.strokeStyle = 'rgba(219, 231, 255, 0.55)';
    const vx = cameraX * RADAR_SCALE;
    const vw = CANVAS_W * RADAR_SCALE;
    ctx.strokeRect(vx + 0.5, 2.5, vw, RADAR_H - 5);
    if (vx + vw > CANVAS_W) ctx.strokeRect(vx - CANVAS_W + 0.5, 2.5, vw, RADAR_H - 5);
}

function drawBanner(text, sub) {
    ctx.fillStyle = 'rgba(4, 7, 15, 0.62)';
    ctx.fillRect(0, CANVAS_H / 2 - 46, CANVAS_W, 92);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#45e0ff';
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2 + 2);
    if (sub) {
        ctx.fillStyle = '#dbe7ff';
        ctx.font = '15px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(sub, CANVAS_W / 2, CANVAS_H / 2 + 28);
    }
    ctx.textAlign = 'start';
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    waveEl.textContent = String(wave);
    livesEl.textContent = String(Math.max(0, lives));
    bombsEl.textContent = String(smartBombs);
    humansEl.textContent = String(humansAlive());
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Game';
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P or Enter to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];

function setInput(key, down) {
    if (LEFT_KEYS.includes(key)) {
        input.left = down;
        // Turn on the key press, not on the next simulation step, so a shot
        // fired the instant you flip round already goes the new way.
        if (down && ship) ship.facing = -1;
    } else if (RIGHT_KEYS.includes(key)) {
        input.right = down;
        if (down && ship) ship.facing = 1;
    }
    else if (UP_KEYS.includes(key)) input.up = down;
    else if (DOWN_KEYS.includes(key)) input.down = down;
    else return false;
    return true;
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if (e.key === 'b' || e.key === 'B') {
        useSmartBomb();
        return;
    }
    if (e.key === 'Enter') {
        if (state === 'paused') togglePause();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.code === 'Space') {
        if (state === 'running') fire();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (setInput(e.key, true)) e.preventDefault();
});

window.addEventListener('keyup', (e) => {
    setInput(e.key, false);
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
    if (autoStep) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('defender-best') || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
wave = 1;
smartBombs = START_BOMBS;
planetDead = false;
bullets = [];
alienShots = [];
aliens = [];
particles = [];
cameraX = wrapX(START_X - CANVAS_W * 0.4);
leadOffset = CANVAS_W * 0.4;
fireTimer = 0;
stateTimer = 0;
elapsed = 0;
waveSpawned = 0;
buildTerrain();
setSeed(0xa17e5);
resetHumanoids();
resetShip();
updateHud();
showOverlay('DEFENDER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
