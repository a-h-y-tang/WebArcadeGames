// ---------------------------------------------------------------------------
// Cavern Raider — a side-scrolling cave flight on an HTML5 canvas.
//
// You fly a scout ship rightwards through an endless winding cave. The rock
// closes in from above and below; touching it wrecks the ship. Missile bases on
// the cave floor launch at you as you approach, and your fuel burns the whole
// time — the only way to top it up is to blow up the fuel tanks stashed on the
// floor. Score comes from distance flown and from everything you destroy.
//
// Written as a single classic (non-module) script so the state and the logic are
// reachable from the Playwright tests as plain globals, mirroring Slime Volley,
// Kaboom and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)` in fixed sub-steps, so the tests can simulate
// frames deterministically without depending on requestAnimationFrame timing.
//
// Coordinates: the cave lives in *world* space, an ever-growing strip of
// COL_W-wide columns starting at x = 0. `world.scrollX` is the world x of the
// left edge of the screen. The ship is tracked in *screen* space (`ship.x`), so
// its world position is `world.scrollX + ship.x`; every other moving thing
// (bullets, bombs, missiles, tanks) is stored in world space.
// ---------------------------------------------------------------------------

// --- Canvas & cave geometry ---
const CANVAS_W = 720;
const CANVAS_H = 440;
const COL_W = 12;                   // width of one generated cave column
const WALL_PAD = 8;                 // rock is always at least this thick
const MIN_GAP = 130;                // tightest the cave may ever squeeze
const MAX_GAP = 300;                // widest it may open out
const SAFE_GAP = 200;               // ...and how open the launch stretch is
const SAFE_COLS = 24;               // columns of easy cave at the very start
const CENTRE_DRIFT = 2.2;           // px the cave's mid-line may wander/column
const WAVE_LONG = 42;               // amplitude of the cave's long, slow snake
const WAVE_SHORT = 14;              // ...and of the ripple riding on top of it
const GAP_DRIFT = 4.5;              // px the cave's height may change/column
const RUBBLE = 7;                   // px of ragged rock hanging into the cave
const GAP_SQUEEZE = 22;             // px the cave's ceiling gap loses per depth

// --- Ship ---
const SHIP_W = 30;
const SHIP_H = 14;
const SHIP_START_X = 140;
const SHIP_MIN_X = 40;
const SHIP_MAX_X = 430;
const SHIP_SPEED_X = 190;
const SHIP_SPEED_Y = 205;

// --- Run ---
const START_LIVES = 3;
const RESPAWN_DELAY = 1.2;          // seconds of wreckage before the next ship
const BASE_SCROLL = 130;            // px/s the cave flows past at depth 1
const LEVEL_SPEED = 18;             // ...and how much faster each depth is
const LEVEL_DIST = 2400;            // px of cave per depth level
const DIST_PER_POINT = 20;          // px flown per point of distance score

// --- Fuel ---
const FUEL_MAX = 100;
const FUEL_BURN = 2.6;              // units/s — a full tank lasts ~38 s
const FUEL_BONUS = 26;              // units for popping a fuel tank

// --- Weapons ---
const BULLET_SPEED = 480;
const BULLET_COOLDOWN = 0.18;
const BULLET_W = 10;
const BULLET_H = 3;
const BOMB_COOLDOWN = 0.45;
const BOMB_GRAVITY = 320;
const BOMB_VY0 = 30;
const BOMB_LEAD = 40;               // forward throw on top of the ship's speed
const BOMB_R = 4;

// --- Targets ---
const ROCKET_POINTS = 50;
const FUEL_POINTS = 30;
const ROCKET_TRIGGER = 300;         // how close before a missile base fires
const ROCKET_SPEED = 95;
const ROCKET_BEHIND = 60;           // missiles this far behind you stay put
const SPAWN_EVERY = 4;              // one spawn roll every N columns
const SPAWN_ROCKET_P = 0.20;
const SPAWN_FUEL_P = 0.34;          // rolls between the two chances are tanks
const CULL_BEHIND = 100;            // px behind the screen before we forget

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const fuelBarEl = document.getElementById('fuel-bar');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, killScore, best, lives, fuel, level, respawnTimer;
let gunCooldown, bombCooldown, shakeTimer;
const world = { scrollX: 0, spawnedTo: 0 };
const ship = { x: SHIP_START_X, y: CANVAS_H / 2, dirX: 0, dirY: 0, alive: true, tilt: 0 };
const bullets = [];
const bombs = [];
const entities = [];
const sparks = [];
const spawnCount = { rocket: 0, fuel: 0 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// The cave
//
// The cave is a chain of columns, each holding a mid-line and a gap height.
// Both wander by a bounded amount per column, so the cave snakes and pinches
// but can never jump — which is what makes it flyable, and what lets a ship
// parked in the middle of the gap survive the couple of seconds it takes to
// respawn. Columns are generated lazily and memoised, and everything is driven
// by a seeded PRNG so a given seed always yields exactly the same cave.
// ---------------------------------------------------------------------------

const terrain = { seed: 1, pinned: false, columns: [] };

// mulberry32 — small, fast, and good enough for cave noise.
function rng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// A value in [0, 1) fixed by (seed, column, channel) — independent of the order
// columns happen to be asked for.
function noise(col, channel) {
    return rng(terrain.seed ^ Math.imul(col + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b))();
}

// Pin the cave to a chosen seed (used by the tests) and forget what was built.
function setSeed(seed) {
    terrain.seed = seed >>> 0;
    terrain.pinned = true;
    terrain.columns.length = 0;
}

function reseed() {
    if (!terrain.pinned) terrain.seed = (Math.random() * 0xffffffff) >>> 0;
    terrain.columns.length = 0;
}

// One column of cave: a smooth mid-line and gap that each wander by a bounded
// amount, plus a ragged lip of rock biting into the gap from either side. The
// lip is *baked into* the ceiling and floor rather than drawn on top, so the
// jagged edge the player sees is exactly the edge that wrecks the ship. The gap
// is widened by the worst-case lip before it is clamped, so the clear channel
// is never tighter than MIN_GAP however the rubble falls.
function buildColumn(i, prev) {
    let gap, base;
    if (!prev) {
        gap = SAFE_GAP + 40;
        base = CANVAS_H / 2;
    } else {
        gap = prev.gap + (noise(i, 1) * 2 - 1) * GAP_DRIFT;
        base = prev.base + (noise(i, 2) * 2 - 1) * CENTRE_DRIFT;
    }
    // Two sine waves over the wandering base give the cave a long snaking sweep
    // with a shorter ripple on it. Both have a gentle enough slope that the
    // channel stays flyable at any depth.
    let centre = base + Math.sin(i / 32) * WAVE_LONG + Math.sin(i / 10.2) * WAVE_SHORT;
    // The deeper the cave runs, the less room it allows — depth comes from the
    // column index, so a column's shape never depends on when it was built.
    const depth = 1 + Math.floor((i * COL_W) / LEVEL_DIST);
    const floorGap = (i < SAFE_COLS ? SAFE_GAP : MIN_GAP) + RUBBLE * 2;
    const roofGap = Math.max(floorGap, MAX_GAP - (depth - 1) * GAP_SQUEEZE);
    gap = clamp(gap, floorGap, roofGap);
    const half = gap / 2;
    base = clamp(base, WALL_PAD + half, CANVAS_H - WALL_PAD - half);
    centre = clamp(centre, WALL_PAD + half, CANVAS_H - WALL_PAD - half);
    return {
        gap,
        base,
        centre,
        ceiling: centre - half + noise(i, 3) * RUBBLE,
        floor: centre + half - noise(i, 4) * RUBBLE,
    };
}

// Column `i` of the cave, generating (and memoising) everything up to it.
function terrainColumn(i) {
    const idx = Math.max(0, Math.floor(i));
    const cols = terrain.columns;
    for (let k = cols.length; k <= idx; k++) cols[k] = buildColumn(k, cols[k - 1]);
    return cols[idx];
}

const columnIndexAt = (worldX) => Math.floor(worldX / COL_W);
const ceilingAt = (worldX) => terrainColumn(columnIndexAt(worldX)).ceiling;
const floorAt = (worldX) => terrainColumn(columnIndexAt(worldX)).floor;

// ---------------------------------------------------------------------------
// Targets on the cave floor
// ---------------------------------------------------------------------------

// `y` is the *bottom* of the target: it sits on the cave floor until it flies.
function makeEntity(type, worldX) {
    const fuelTank = type === 'fuel';
    return {
        type,
        x: worldX,
        y: floorAt(worldX),
        w: fuelTank ? 24 : 16,
        h: fuelTank ? 20 : 22,
        alive: true,
        launched: false,
        vx: 0,
        vy: 0,
    };
}

const boxOf = (e) => ({ l: e.x - e.w / 2, r: e.x + e.w / 2, t: e.y - e.h, b: e.y });

const overlaps = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

function shipBox() {
    const wx = world.scrollX + ship.x;
    return { l: wx - SHIP_W / 2, r: wx + SHIP_W / 2, t: ship.y - SHIP_H / 2, b: ship.y + SHIP_H / 2 };
}

// Stock the cave ahead of the screen. Rolls are keyed off the column index, so
// the same seed always plants the same targets in the same places.
function spawnAhead() {
    const target = columnIndexAt(world.scrollX + CANVAS_W + 120);
    while (world.spawnedTo <= target) {
        const k = world.spawnedTo++;
        if (k % SPAWN_EVERY !== 0 || k < SAFE_COLS + 8) continue;
        const roll = noise(k, 7);
        if (roll < SPAWN_ROCKET_P) {
            entities.push(makeEntity('rocket', k * COL_W + COL_W / 2));
            spawnCount.rocket += 1;
        } else if (roll < SPAWN_FUEL_P) {
            entities.push(makeEntity('fuel', k * COL_W + COL_W / 2));
            spawnCount.fuel += 1;
        }
    }
}

function destroyEntity(e) {
    e.alive = false;
    if (e.type === 'fuel') {
        killScore += FUEL_POINTS;
        fuel = Math.min(FUEL_MAX, fuel + FUEL_BONUS);
        spawnSparks(e.x - world.scrollX, e.y - e.h / 2, 14, '#ffb02e');
    } else {
        killScore += ROCKET_POINTS;
        spawnSparks(e.x - world.scrollX, e.y - e.h / 2, 12, '#ff7a3d');
    }
}

function updateEntities(h) {
    const shipWorldX = world.scrollX + ship.x;
    for (let i = entities.length - 1; i >= 0; i--) {
        const e = entities[i];

        // A missile base wakes up once the ship is close enough and not already
        // well past it.
        if (e.alive && e.type === 'rocket' && !e.launched && ship.alive) {
            const dx = e.x - shipWorldX;
            if (dx > -ROCKET_BEHIND && dx < ROCKET_TRIGGER) {
                e.launched = true;
                e.vy = -(ROCKET_SPEED + level * 7);
                e.vx = clamp((shipWorldX - e.x) * 0.25, -34, 34);
            }
        }

        if (e.launched) {
            e.x += e.vx * h;
            e.y += e.vy * h;
            e.vy -= 22 * h;         // missiles keep accelerating upward
            if (e.y - e.h <= ceilingAt(e.x)) {
                spawnSparks(e.x - world.scrollX, e.y - e.h, 8, '#ff7a3d');
                entities.splice(i, 1);
                continue;
            }
        }

        if (e.x < world.scrollX - CULL_BEHIND) entities.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

function fire() {
    if (state !== 'running' || !ship.alive || gunCooldown > 0) return;
    gunCooldown = BULLET_COOLDOWN;
    bullets.push({ x: world.scrollX + ship.x + SHIP_W / 2, y: ship.y });
}

function dropBomb() {
    if (state !== 'running' || !ship.alive || bombCooldown > 0) return;
    bombCooldown = BOMB_COOLDOWN;
    bombs.push({
        x: world.scrollX + ship.x,
        y: ship.y + SHIP_H / 2,
        vx: scrollSpeed() + BOMB_LEAD,
        vy: BOMB_VY0,
    });
}

// A shot or a bomb against everything it can hit. Returns true when it is spent.
function hitTargets(box) {
    for (const e of entities) {
        if (!e.alive) continue;
        if (overlaps(box, boxOf(e))) {
            destroyEntity(e);
            return true;
        }
    }
    return false;
}

function updateBullets(h) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += BULLET_SPEED * h;
        const box = { l: b.x - BULLET_W / 2, r: b.x + BULLET_W / 2, t: b.y - BULLET_H / 2, b: b.y + BULLET_H / 2 };
        const spent =
            b.x > world.scrollX + CANVAS_W ||
            b.y <= ceilingAt(b.x) ||
            b.y >= floorAt(b.x) ||
            hitTargets(box);
        if (spent) bullets.splice(i, 1);
    }
}

function updateBombs(h) {
    for (let i = bombs.length - 1; i >= 0; i--) {
        const m = bombs[i];
        m.vy += BOMB_GRAVITY * h;
        m.x += m.vx * h;
        m.y += m.vy * h;
        const box = { l: m.x - BOMB_R, r: m.x + BOMB_R, t: m.y - BOMB_R, b: m.y + BOMB_R };
        let spent = m.x > world.scrollX + CANVAS_W || hitTargets(box);
        if (!spent && m.y >= floorAt(m.x)) {
            spawnSparks(m.x - world.scrollX, m.y, 9, '#ff7a3d');
            spent = true;
        }
        if (spent) bombs.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// The ship
// ---------------------------------------------------------------------------

// dirX / dirY are -1, 0 or 1 — held until the player lets go.
function steer(dx, dy) {
    ship.dirX = Math.sign(dx || 0);
    ship.dirY = Math.sign(dy || 0);
}

function moveShip(h) {
    ship.x = clamp(ship.x + ship.dirX * SHIP_SPEED_X * h, SHIP_MIN_X, SHIP_MAX_X);
    ship.y = clamp(ship.y + ship.dirY * SHIP_SPEED_Y * h, WALL_PAD, CANVAS_H - WALL_PAD);
    ship.tilt += (ship.dirY * 0.28 - ship.tilt) * Math.min(1, h * 10);
}

// The ship is wrecked by rock at any of its three probe points, so a nose-first
// clip into a wall counts even when the tail is still in clear air.
function hitsCave() {
    const box = shipBox();
    for (const x of [box.l, (box.l + box.r) / 2, box.r]) {
        if (box.t <= ceilingAt(x) || box.b >= floorAt(x)) return true;
    }
    return false;
}

function hitsTarget() {
    const box = shipBox();
    for (const e of entities) {
        if (e.alive && overlaps(box, boxOf(e))) return e;
    }
    return null;
}

function crash() {
    if (!ship.alive) return;
    ship.alive = false;
    respawnTimer = RESPAWN_DELAY;
    shakeTimer = 0.4;
    lives = Math.max(0, lives - 1);
    spawnSparks(ship.x, ship.y, 26, '#ff5b5b');
    if (lives <= 0) endGame();
}

function respawn() {
    ship.x = SHIP_START_X;
    const wx = world.scrollX + ship.x;
    ship.y = (ceilingAt(wx) + floorAt(wx)) / 2;
    ship.dirX = 0;
    ship.dirY = 0;
    ship.tilt = 0;
    ship.alive = true;
    fuel = FUEL_MAX;
    bullets.length = 0;
    bombs.length = 0;
    // Missiles already in the air would be an unfair welcome.
    for (let i = entities.length - 1; i >= 0; i--) {
        if (entities[i].launched) entities.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function scrollSpeed() {
    return BASE_SCROLL + (level - 1) * LEVEL_SPEED;
}

function substep(h) {
    gunCooldown = Math.max(0, gunCooldown - h);
    bombCooldown = Math.max(0, bombCooldown - h);

    // While the wreckage burns the cave holds still; the run picks up again
    // where it left off.
    if (!ship.alive) {
        respawnTimer -= h;
        if (respawnTimer <= 0) respawn();
        return;
    }

    world.scrollX += scrollSpeed() * h;
    level = 1 + Math.floor(world.scrollX / LEVEL_DIST);
    spawnAhead();

    moveShip(h);
    updateBullets(h);
    updateBombs(h);
    updateEntities(h);

    fuel = Math.max(0, fuel - FUEL_BURN * h);
    score = killScore + Math.floor(world.scrollX / DIST_PER_POINT);

    if (fuel <= 0) { crash(); return; }
    if (hitsCave()) { crash(); return; }
    const struck = hitsTarget();
    if (struck) {
        struck.alive = false;
        crash();
    }
}

// Advance the simulation by `dt` seconds in small fixed sub-steps, so a fast
// bullet can never tunnel through a wall and the integration does not depend on
// the frame rate.
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
    level = 1 + Math.floor(world.scrollX / LEVEL_DIST);
    score = killScore + Math.floor(world.scrollX / DIST_PER_POINT);
    updateHud();
}

// ---------------------------------------------------------------------------
// Run flow
// ---------------------------------------------------------------------------

function startGame() {
    reseed();
    state = 'running';
    score = 0;
    killScore = 0;
    lives = START_LIVES;
    fuel = FUEL_MAX;
    level = 1;
    respawnTimer = 0;
    gunCooldown = 0;
    bombCooldown = 0;
    shakeTimer = 0;
    world.scrollX = 0;
    world.spawnedTo = 0;
    bullets.length = 0;
    bombs.length = 0;
    entities.length = 0;
    sparks.length = 0;
    spawnCount.rocket = 0;
    spawnCount.fuel = 0;
    ship.x = SHIP_START_X;
    ship.y = (ceilingAt(ship.x) + floorAt(ship.x)) / 2;
    ship.dirX = 0;
    ship.dirY = 0;
    ship.tilt = 0;
    ship.alive = true;
    spawnAhead();
    hideOverlay();
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) saveBest(score);
    showOverlay('Game Over', 'Score ' + score + ' · Depth ' + level, 'Press Space to fly again', 'Fly Again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', 'Score ' + score, 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function saveBest(value) {
    best = value;
    try { localStorage.setItem('cavern-raider-best', String(best)); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    livesEl.textContent = String(lives);
    levelEl.textContent = String(level);
    fuelBarEl.style.width = clamp((fuel / FUEL_MAX) * 100, 0, 100).toFixed(1) + '%';
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
// Sparks (purely cosmetic — screen space, so they scroll away with the cave)
// ---------------------------------------------------------------------------

function spawnSparks(x, y, count, colour) {
    for (let i = 0; i < count; i++) {
        sparks.push({
            x, y,
            vx: (Math.random() - 0.5) * 240,
            vy: (Math.random() - 0.5) * 240,
            life: 0.25 + Math.random() * 0.3,
            colour,
        });
    }
}

function updateSparks(dt) {
    const drift = state === 'running' && ship.alive ? scrollSpeed() : 0;
    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += (s.vx - drift) * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0) sparks.splice(i, 1);
    }
    if (shakeTimer > 0) shakeTimer = Math.max(0, shakeTimer - dt);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawCave() {
    const first = columnIndexAt(world.scrollX) - 1;
    const last = columnIndexAt(world.scrollX + CANVAS_W) + 1;

    const rock = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    rock.addColorStop(0, '#4a3767');
    rock.addColorStop(0.5, '#241a36');
    rock.addColorStop(1, '#4a3767');

    // Roof and floor, drawn straight off the collision line.
    ctx.fillStyle = rock;
    for (const key of ['ceiling', 'floor']) {
        const outside = key === 'ceiling' ? -2 : CANVAS_H + 2;
        ctx.beginPath();
        ctx.moveTo(-COL_W, outside);
        for (let i = first; i <= last; i++) {
            ctx.lineTo(i * COL_W - world.scrollX, terrainColumn(i)[key]);
        }
        ctx.lineTo(CANVAS_W + COL_W, outside);
        ctx.closePath();
        ctx.fill();
    }

    // Speckled rock face just inside each edge, for depth.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    for (let i = first; i <= last; i++) {
        if (i % 2) continue;
        const col = terrainColumn(i);
        const x = i * COL_W - world.scrollX;
        ctx.fillRect(x, col.ceiling - 6 - noise(i, 5) * 22, 3, 3);
        ctx.fillRect(x, col.floor + 4 + noise(i, 6) * 22, 3, 3);
    }

    // Glowing rims along both rock faces.
    ctx.strokeStyle = 'rgba(126, 214, 255, 0.45)';
    ctx.lineWidth = 2;
    for (const key of ['ceiling', 'floor']) {
        ctx.beginPath();
        for (let i = first; i <= last; i++) {
            const x = i * COL_W - world.scrollX;
            const y = terrainColumn(i)[key];
            if (i === first) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}

// Slow parallax dust in the cave air, drawn from a fixed lattice so it never
// flickers between frames.
function drawParallax() {
    ctx.fillStyle = 'rgba(150, 190, 255, 0.16)';
    const span = 137;
    const startX = Math.floor(world.scrollX * 0.35 / span) * span;
    for (let i = 0; i < 14; i++) {
        const wx = startX + i * span;
        const x = wx - world.scrollX * 0.35;
        const y = 40 + ((i * 97) % (CANVAS_H - 80));
        ctx.fillRect(x, y, 2, 2);
    }
}

function drawShip() {
    const x = ship.x;
    const y = ship.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ship.tilt * 0.5);

    // Engine flame.
    const flame = 10 + Math.random() * 8;
    const fg = ctx.createLinearGradient(-SHIP_W / 2 - flame, 0, -SHIP_W / 2 + 4, 0);
    fg.addColorStop(0, 'rgba(255, 122, 61, 0)');
    fg.addColorStop(1, '#ffd25e');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-SHIP_W / 2 - flame, 0);
    ctx.lineTo(-SHIP_W / 2 + 2, -4);
    ctx.lineTo(-SHIP_W / 2 + 2, 4);
    ctx.closePath();
    ctx.fill();

    // Hull.
    ctx.fillStyle = '#d8e4ff';
    ctx.beginPath();
    ctx.moveTo(SHIP_W / 2, 0);
    ctx.lineTo(0, -SHIP_H / 2);
    ctx.lineTo(-SHIP_W / 2, -SHIP_H / 2 + 2);
    ctx.lineTo(-SHIP_W / 2, SHIP_H / 2 - 2);
    ctx.lineTo(0, SHIP_H / 2);
    ctx.closePath();
    ctx.fill();

    // Canopy and stripe.
    ctx.fillStyle = '#59f2ff';
    ctx.beginPath();
    ctx.ellipse(3, -1, 6, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(90, 110, 160, 0.7)';
    ctx.fillRect(-SHIP_W / 2, -1, SHIP_W * 0.55, 2);
    ctx.restore();
}

function drawEntity(e) {
    const x = e.x - world.scrollX;
    const y = e.y;
    if (!e.alive) return;
    if (e.type === 'fuel') {
        ctx.fillStyle = '#ffb02e';
        ctx.fillRect(x - e.w / 2, y - e.h, e.w, e.h);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(x - e.w / 2, y - e.h + 5, e.w, 3);
        ctx.fillStyle = '#2a1500';
        ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('F', x, y - 4);
        ctx.textAlign = 'left';
    } else {
        // Missile: a body with a nose cone and fins.
        ctx.fillStyle = e.launched ? '#ff8f6b' : '#c9d3ee';
        ctx.beginPath();
        ctx.moveTo(x, y - e.h);
        ctx.lineTo(x + e.w / 2 - 2, y - e.h + 9);
        ctx.lineTo(x + e.w / 2 - 2, y);
        ctx.lineTo(x - e.w / 2 + 2, y);
        ctx.lineTo(x - e.w / 2 + 2, y - e.h + 9);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ff5b5b';
        ctx.fillRect(x - e.w / 2 + 2, y - e.h + 10, e.w - 4, 3);
        if (e.launched) {
            ctx.fillStyle = 'rgba(255, 180, 90, 0.75)';
            ctx.beginPath();
            ctx.moveTo(x, y + 10 + Math.random() * 6);
            ctx.lineTo(x - 4, y);
            ctx.lineTo(x + 4, y);
            ctx.closePath();
            ctx.fill();
        }
    }
}

function draw() {
    ctx.save();
    if (shakeTimer > 0) {
        ctx.translate((Math.random() - 0.5) * 8 * shakeTimer, (Math.random() - 0.5) * 8 * shakeTimer);
    }

    // Cave air.
    const air = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    air.addColorStop(0, '#0a1020');
    air.addColorStop(1, '#120a1c');
    ctx.fillStyle = air;
    ctx.fillRect(-10, -10, CANVAS_W + 20, CANVAS_H + 20);

    drawParallax();
    drawCave();

    for (const e of entities) drawEntity(e);

    // Bombs.
    for (const m of bombs) {
        ctx.fillStyle = '#ffd25e';
        ctx.beginPath();
        ctx.arc(m.x - world.scrollX, m.y, BOMB_R, 0, Math.PI * 2);
        ctx.fill();
    }

    // Bullets.
    ctx.fillStyle = '#59f2ff';
    for (const b of bullets) {
        ctx.fillRect(b.x - world.scrollX - BULLET_W / 2, b.y - BULLET_H / 2, BULLET_W, BULLET_H);
    }

    if (ship.alive) drawShip();

    // Sparks.
    for (const s of sparks) {
        ctx.globalAlpha = clamp(s.life * 2.6, 0, 1);
        ctx.fillStyle = s.colour || '#ffd25e';
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // Ship counter, drawn as little hulls in the corner.
    ctx.fillStyle = 'rgba(216, 228, 255, 0.75)';
    for (let i = 0; i < Math.max(0, lives - 1); i++) {
        const bx = 14 + i * 20;
        ctx.beginPath();
        ctx.moveTo(bx + 10, CANVAS_H - 16);
        ctx.lineTo(bx, CANVAS_H - 21);
        ctx.lineTo(bx, CANVAS_H - 11);
        ctx.closePath();
        ctx.fill();
    }

    if (state === 'running' && !ship.alive) {
        ctx.fillStyle = 'rgba(255, 91, 91, 0.85)';
        ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SHIP LOST', CANVAS_W / 2, 60);
        ctx.textAlign = 'left';
    }

    if (state === 'running' && fuel < 25) {
        ctx.fillStyle = 'rgba(255, 91, 91, ' + (0.45 + 0.35 * Math.sin(Date.now() / 120)).toFixed(3) + ')';
        ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('LOW FUEL', CANVAS_W / 2, CANVAS_H - 24);
        ctx.textAlign = 'left';
    }

    ctx.restore();
}

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    if (state === 'running') step(dt);
    updateSparks(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const heldKeys = new Set();

const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];
const MOVE_KEYS = [...LEFT_KEYS, ...RIGHT_KEYS, ...UP_KEYS, ...DOWN_KEYS];

const anyHeld = (keys) => keys.some((k) => heldKeys.has(k));

function refreshKeyDir() {
    steer(
        (anyHeld(RIGHT_KEYS) ? 1 : 0) - (anyHeld(LEFT_KEYS) ? 1 : 0),
        (anyHeld(DOWN_KEYS) ? 1 : 0) - (anyHeld(UP_KEYS) ? 1 : 0),
    );
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else fire();
        e.preventDefault();
        return;
    }
    if (e.key === 'x' || e.key === 'X' || e.key === 'b' || e.key === 'B') {
        dropBomb();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
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

window.addEventListener('blur', () => {
    heldKeys.clear();
    refreshKeyDir();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('cavern-raider-best') || '0', 10) || 0;
state = 'idle';
score = 0;
killScore = 0;
lives = START_LIVES;
fuel = FUEL_MAX;
level = 1;
respawnTimer = 0;
gunCooldown = 0;
bombCooldown = 0;
shakeTimer = 0;
ship.y = (ceilingAt(ship.x) + floorAt(ship.x)) / 2;
updateHud();
requestAnimationFrame(frame);
