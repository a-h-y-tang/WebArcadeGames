// ---------------------------------------------------------------------------
// Scramble — an auto-scrolling cave shooter on an HTML5 canvas.
//
// The world scrolls forward on its own across four terrain sections: hills,
// mountains, a stalactite cave and a tunnel guarded by an enemy base. You steer
// inside the visible window, shoot forward with a laser and lob bombs at the
// ground. Fuel drains the whole time, so the fuel dumps below are not scenery —
// bombing them is the only way to keep flying.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Kaboom! and Snake in this repo. All motion is expressed per second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 420;
const COLUMN_W = 16;
const SECTION_COLUMNS = 64;
const SECTIONS = 4;
const LEVEL_COLUMNS = SECTION_COLUMNS * SECTIONS;   // 256
const WORLD_W = LEVEL_COLUMNS * COLUMN_W;           // 4096
const SECTION_W = SECTION_COLUMNS * COLUMN_W;       // 1024

const MIN_GAP = 120;        // narrowest flyable corridor the generator emits
const START_COLUMNS = 6;    // flat, open sky at the mouth of the level
const BASE_COLUMNS = 10;    // flat, open sky around the base at the end
const BASE_GROUND = 80;

// Ground height band (measured up from the bottom) per section, and the
// ceiling band (measured down from the top) — null means open sky.
const GROUND_BANDS = [
    [40, 90],
    [50, 130],
    [50, 150],
    [60, 120],
];
const CEIL_BANDS = [null, null, [30, 110], [30, 110]];
const GROUND_STEP = 16;
const CEIL_STEP = 14;
const CAVE_RAMP = 8;        // columns the cave roof takes to close in

// --- Ship ----------------------------------------------------------------
const SHIP_HW = 14;
const SHIP_HH = 8;
const SHIP_SPEED_X = 90;    // px/s the player adds on top of the scroll
const SHIP_SPEED_Y = 150;
const SHIP_MIN_Y = 14;
const SHIP_MAX_Y = CANVAS_H - 14;
const SHIP_MIN_SX = 40;     // screen-space window the ship is held inside
const SHIP_MAX_SX = 384;
const SHIP_START_SX = 90;
const RESPAWN_INVULN = 1.5;

// --- Scrolling -----------------------------------------------------------
const SCROLL_BASE = 100;
const SCROLL_STEP = 12;
const SCROLL_MAX = 190;

// --- Fuel ----------------------------------------------------------------
const FUEL_MAX = 100;
const FUEL_DRAIN = 4;
const FUEL_PER_TANK = 18;

// --- Weapons -------------------------------------------------------------
const LASER_SPEED = 420;
const LASER_COOLDOWN = 0.18;
const MAX_BULLETS = 4;
const BOMB_GRAVITY = 520;
const BOMB_COOLDOWN = 0.3;
const MAX_BOMBS = 3;
const BLAST_R = 34;

// --- Targets -------------------------------------------------------------
const TANK_W = 26, TANK_H = 22;
const ROCKET_W = 12, ROCKET_H = 24;
const BASE_W = 88, BASE_H = 46;
const TANK_GAP = 11;        // columns between fuel dumps
const ROCKET_GAP_BASE = 14; // columns between rockets at level 1
const ROCKET_GAP_MIN = 6;
const LAUNCH_RANGE = 140;
const ROCKET_SPEED_BASE = 60;
const ROCKET_SPEED_STEP = 8;

const TANK_POINTS = 100;
const ROCKET_LASER_POINTS = 50;
const ROCKET_BOMB_POINTS = 80;   // harder to aim, so worth more
const BASE_POINTS = 800;
const LEVEL_BONUS = 500;

// --- Timing --------------------------------------------------------------
const DEATH_PAUSE = 1.2;
const CLEAR_PAUSE = 2.0;
const EXPLOSION_LIFE = 0.5;
const START_LIVES = 3;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';          // idle | running | paused | dying | levelclear | over
let score = 0;
let best = 0;
let level = 1;
let lives = START_LIVES;
let fuel = FUEL_MAX;
let scrollX = 0;

let groundH = [];
let ceilH = [];
let tanks = [];
let rockets = [];
let base = null;

let bullets = [];
let bombs = [];
let explosions = [];

let ship = { x: 0, y: 0, dir: { x: 0, y: 0 }, invuln: 0 };
let laserCool = 0;
let bombCool = 0;
let deathTimer = 0;
let clearTimer = 0;

// Test seams: `launchEnabled` keeps rockets on the ground so long simulations
// stay deterministic, `autoRun` detaches the animation loop so the specs own
// the clock. Both are on for a real player.
let launchEnabled = true;
let autoRun = true;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elFuel = document.getElementById('fuel');
const elBest = document.getElementById('best');

// ---------------------------------------------------------------------------
// Level generation
// ---------------------------------------------------------------------------

// Small, fast, seedable PRNG. Keying it on the level number makes level N the
// same level N every run — replayable for the player, fixture-free for tests.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sectionOf = (col) => Math.min(SECTIONS - 1, Math.floor(col / SECTION_COLUMNS));

function buildLevel(lv) {
    const rng = mulberry32((0x5ca3 ^ Math.imul(lv, 2654435761)) >>> 0);
    const lastOpen = LEVEL_COLUMNS - BASE_COLUMNS;

    groundH = new Array(LEVEL_COLUMNS);
    ceilH = new Array(LEVEL_COLUMNS).fill(0);

    let g = GROUND_BANDS[0][0];
    for (let c = 0; c < LEVEL_COLUMNS; c++) {
        if (c < START_COLUMNS) {
            g = GROUND_BANDS[0][0];
        } else if (c >= lastOpen) {
            g = BASE_GROUND;
        } else {
            const [lo, hi] = GROUND_BANDS[sectionOf(c)];
            g = clamp(g + (rng() * 2 - 1) * GROUND_STEP, lo, hi);
        }
        groundH[c] = Math.round(g);
    }

    let k = CEIL_BANDS[2][0];
    for (let c = 0; c < LEVEL_COLUMNS; c++) {
        const band = CEIL_BANDS[sectionOf(c)];
        if (!band || c >= lastOpen) continue;
        k = clamp(k + (rng() * 2 - 1) * CEIL_STEP, band[0], band[1]);
        // The cave mouth closes in — and opens back out before the base —
        // over a few columns, instead of dropping a wall in front of the
        // player or ending in one.
        const into = c - 2 * SECTION_COLUMNS;
        const outOf = lastOpen - c;
        const ramp = Math.min(
            into < CAVE_RAMP ? into / CAVE_RAMP : 1,
            outOf < CAVE_RAMP ? outOf / CAVE_RAMP : 1
        );
        // Never let the roof squeeze the corridor below MIN_GAP.
        const room = CANVAS_H - groundH[c] - MIN_GAP;
        ceilH[c] = Math.max(0, Math.round(Math.min(k * ramp, room)));
    }

    tanks = [];
    rockets = [];

    const taken = new Set();
    const free = (c) => {
        for (let i = c - 2; i <= c + 2; i++) if (taken.has(i)) return false;
        return c >= START_COLUMNS + 4 && c < lastOpen - 2;
    };
    const claim = (c) => {
        for (let i = c; i < c + 2; i++) taken.add(i);
    };
    // Objects need level ground under them or they float.
    const flatten = (c) => {
        groundH[c + 1] = groundH[c];
    };

    for (let c = START_COLUMNS + 8; c < lastOpen - 2; c += TANK_GAP) {
        const col = c + Math.floor(rng() * 3);
        if (!free(col)) continue;
        claim(col);
        flatten(col);
        tanks.push({
            kind: 'tank',
            x: col * COLUMN_W + 2,
            y: CANVAS_H - groundH[col] - TANK_H,
            w: TANK_W,
            h: TANK_H,
            alive: true,
        });
    }

    const rocketGap = Math.max(ROCKET_GAP_MIN, ROCKET_GAP_BASE - lv);
    for (let c = START_COLUMNS + 5; c < lastOpen - 2; c += rocketGap) {
        const col = c + Math.floor(rng() * 3);
        if (!free(col)) continue;
        claim(col);
        flatten(col);
        rockets.push({
            kind: 'rocket',
            x: col * COLUMN_W + 2,
            y: CANVAS_H - groundH[col] - ROCKET_H,
            w: ROCKET_W,
            h: ROCKET_H,
            alive: true,
            launched: false,
            frozen: false,
            groundY: CANVAS_H - groundH[col],
        });
    }

    const baseCol = LEVEL_COLUMNS - BASE_COLUMNS + 2;
    base = {
        kind: 'base',
        x: baseCol * COLUMN_W,
        y: CANVAS_H - BASE_GROUND - BASE_H,
        w: BASE_W,
        h: BASE_H,
        alive: true,
    };
}

// ---------------------------------------------------------------------------
// Terrain queries
// ---------------------------------------------------------------------------

const colAt = (worldX) => clamp(Math.floor(worldX / COLUMN_W), 0, LEVEL_COLUMNS - 1);
const groundYAt = (worldX) => CANVAS_H - groundH[colAt(worldX)];
const ceilingYAt = (worldX) => ceilH[colAt(worldX)];
const corridorMidY = (worldX) => (ceilingYAt(worldX) + groundYAt(worldX)) / 2;
const screenX = (worldX) => worldX - scrollX;

function hitsTerrain(x, y, hw, hh) {
    for (const wx of [x - hw, x, x + hw]) {
        if (y + hh > groundYAt(wx)) return true;
        if (y - hh < ceilingYAt(wx)) return true;
    }
    return false;
}

const scrollSpeed = () => Math.min(SCROLL_MAX, SCROLL_BASE + SCROLL_STEP * (level - 1));
const rocketSpeed = () => ROCKET_SPEED_BASE + ROCKET_SPEED_STEP * (level - 1);
const checkpointX = () =>
    Math.min(SECTIONS - 1, Math.floor(scrollX / SECTION_W)) * SECTION_W;

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

function liveTargets() {
    const out = [];
    for (const t of tanks) if (t.alive) out.push(t);
    for (const r of rockets) if (r.alive) out.push(r);
    if (base && base.alive) out.push(base);
    return out;
}

function spawnTank(worldX) {
    const t = {
        kind: 'tank',
        x: worldX,
        y: groundYAt(worldX + TANK_W / 2) - TANK_H,
        w: TANK_W,
        h: TANK_H,
        alive: true,
    };
    tanks.push(t);
    return t;
}

function spawnRocket(worldX) {
    const groundY = groundYAt(worldX + ROCKET_W / 2);
    const r = {
        kind: 'rocket',
        x: worldX,
        y: groundY - ROCKET_H,
        w: ROCKET_W,
        h: ROCKET_H,
        alive: true,
        launched: false,
        frozen: false,
        groundY,
    };
    rockets.push(r);
    return r;
}

// Empties the world of generated targets so a spec can place exactly the one
// it is about — otherwise a blast radius can quietly collect a neighbour.
function clearTargetsForTest() {
    tanks = [];
    rockets = [];
}

function pointsFor(target, weapon) {
    if (target.kind === 'tank') return TANK_POINTS;
    if (target.kind === 'base') return BASE_POINTS;
    return weapon === 'bomb' ? ROCKET_BOMB_POINTS : ROCKET_LASER_POINTS;
}

function destroyTarget(target, weapon) {
    if (!target.alive) return;
    target.alive = false;
    score += pointsFor(target, weapon);
    if (target.kind === 'tank') fuel = Math.min(FUEL_MAX, fuel + FUEL_PER_TANK);
    addExplosion(target.x + target.w / 2, target.y + target.h / 2, target.kind === 'base' ? 1.6 : 1);
}

const overlaps = (ax, ay, aw, ah, bx, by, bw, bh) =>
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

function addExplosion(x, y, scale) {
    explosions.push({ x, y, t: 0, scale: scale || 1 });
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

function fireLaser() {
    if (state !== 'running') return;
    if (laserCool > 0 || bullets.length >= MAX_BULLETS) return;
    laserCool = LASER_COOLDOWN;
    bullets.push({ x: ship.x + SHIP_HW + 8, y: ship.y });
}

function dropBomb() {
    if (state !== 'running') return;
    if (bombCool > 0 || bombs.length >= MAX_BOMBS) return;
    bombCool = BOMB_COOLDOWN;
    bombs.push({ x: ship.x, y: ship.y + SHIP_HH, vx: scrollSpeed() * 0.8, vy: 40 });
}

function explodeBomb(bomb) {
    addExplosion(bomb.x, bomb.y, 1.2);
    for (const t of liveTargets()) {
        const cx = t.x + t.w / 2;
        const cy = t.y + t.h / 2;
        if (Math.hypot(cx - bomb.x, cy - bomb.y) <= BLAST_R + Math.max(t.w, t.h) / 2) {
            destroyTarget(t, 'bomb');
        }
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        updateExplosions(dt);
        deathTimer -= dt;
        if (deathTimer <= 0) (lives > 0 ? respawn : gameOver)();
        return;
    }
    if (state === 'levelclear') {
        updateExplosions(dt);
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        return;
    }
    if (state !== 'running') return;

    // Scroll. Reaching the far edge of the world clears the level.
    scrollX += scrollSpeed() * dt;
    if (scrollX >= WORLD_W - CANVAS_W) {
        scrollX = WORLD_W - CANVAS_W;
        levelClear();
        return;
    }

    // Fuel. An empty tank is fatal, invulnerable or not.
    fuel = Math.max(0, fuel - FUEL_DRAIN * dt);
    if (fuel === 0) {
        crash();
        return;
    }

    moveShip(dt);

    laserCool = Math.max(0, laserCool - dt);
    bombCool = Math.max(0, bombCool - dt);

    updateBullets(dt);
    updateBombs(dt);
    updateRockets(dt);
    updateExplosions(dt);

    if (ship.invuln > 0) {
        ship.invuln = Math.max(0, ship.invuln - dt);
    } else if (shipIsHit()) {
        crash();
        return;
    }

    updateHud();
}

function moveShip(dt) {
    ship.x += (scrollSpeed() + ship.dir.x * SHIP_SPEED_X) * dt;
    ship.y = clamp(ship.y + ship.dir.y * SHIP_SPEED_Y * dt, SHIP_MIN_Y, SHIP_MAX_Y);
    ship.x = clamp(ship.x, scrollX + SHIP_MIN_SX, scrollX + SHIP_MAX_SX);
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += LASER_SPEED * dt;

        if (screenX(b.x) > CANVAS_W || b.x >= WORLD_W) {
            bullets.splice(i, 1);
            continue;
        }
        if (b.y >= groundYAt(b.x) || b.y <= ceilingYAt(b.x)) {
            addExplosion(b.x, b.y, 0.5);
            bullets.splice(i, 1);
            continue;
        }
        const hit = liveTargets().find((t) => overlaps(b.x - 2, b.y - 1, 6, 3, t.x, t.y, t.w, t.h));
        if (hit) {
            destroyTarget(hit, 'laser');
            bullets.splice(i, 1);
        }
    }
}

function updateBombs(dt) {
    for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.vy += BOMB_GRAVITY * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        const hitGround = b.y >= groundYAt(b.x) || b.y <= ceilingYAt(b.x);
        const hitTarget = liveTargets().some((t) =>
            overlaps(b.x - 3, b.y - 3, 6, 6, t.x, t.y, t.w, t.h)
        );
        if (hitGround || hitTarget || screenX(b.x) < 0 || b.x >= WORLD_W) {
            explodeBomb(b);
            bombs.splice(i, 1);
        }
    }
}

function updateRockets(dt) {
    for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        if (!r.alive) {
            rockets.splice(i, 1);
            continue;
        }
        if (r.frozen) continue;

        if (!r.launched) {
            if (launchEnabled && Math.abs(r.x - ship.x) < LAUNCH_RANGE) r.launched = true;
        } else {
            r.y -= rocketSpeed() * dt;
            if (r.y + r.h < 0) rockets.splice(i, 1);
        }
    }
}

function updateExplosions(dt) {
    for (let i = explosions.length - 1; i >= 0; i--) {
        explosions[i].t += dt;
        if (explosions[i].t >= EXPLOSION_LIFE) explosions.splice(i, 1);
    }
}

function shipIsHit() {
    if (hitsTerrain(ship.x, ship.y, SHIP_HW, SHIP_HH)) return true;
    return liveTargets().some((t) =>
        overlaps(ship.x - SHIP_HW, ship.y - SHIP_HH, SHIP_HW * 2, SHIP_HH * 2, t.x, t.y, t.w, t.h)
    );
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

function placeShip(worldX, y) {
    ship.x = worldX;
    ship.y = y;
}

function resetShip() {
    const x = scrollX + SHIP_START_SX;
    placeShip(x, clamp(corridorMidY(x), SHIP_MIN_Y, SHIP_MAX_Y));
    ship.dir.x = 0;
    ship.dir.y = 0;
    ship.invuln = 0;
    bullets = [];
    bombs = [];
    laserCool = 0;
    bombCool = 0;
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    scrollX = 0;
    fuel = FUEL_MAX;
    explosions = [];
    buildLevel(level);
    resetShip();
    state = 'running';
    hideOverlay();
    updateHud();
}

function crash() {
    lives = Math.max(0, lives - 1);
    addExplosion(ship.x, ship.y, 1.6);
    bullets = [];
    bombs = [];
    state = 'dying';
    deathTimer = DEATH_PAUSE;
    updateHud();
}

function respawn() {
    // Sections double as checkpoints: the run restarts at the section mouth
    // with every target from there on restored.
    scrollX = checkpointX();
    fuel = FUEL_MAX;
    for (const t of tanks) if (t.x >= scrollX) t.alive = true;
    for (const r of rockets) {
        if (r.x >= scrollX) {
            r.alive = true;
            r.launched = false;
            r.y = r.groundY - r.h;
        }
    }
    rockets = rockets.filter((r) => r.alive);
    resetShip();
    // Only a respawn is protected: a fresh run and a new level both start in
    // open sky, so there is nothing to be invulnerable to.
    ship.invuln = RESPAWN_INVULN;
    state = 'running';
    updateHud();
}

function levelClear() {
    score += LEVEL_BONUS * level;
    state = 'levelclear';
    clearTimer = CLEAR_PAUSE;
    updateHud();
}

function nextLevel() {
    level += 1;
    scrollX = 0;
    fuel = FUEL_MAX;
    explosions = [];
    buildLevel(level);
    resetShip();
    state = 'running';
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('scramble-best', String(best));
        } catch (e) {
            /* storage disabled — the run still ends cleanly */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Best ${best}`, 'Press Space or Enter to fly again');
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

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elLives.textContent = String(lives);
    elFuel.textContent = String(Math.round(fuel));
    elBest.textContent = String(best);
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const STARS = (() => {
    const rng = mulberry32(0x51a25);
    return Array.from({ length: 90 }, () => ({
        x: rng() * CANVAS_W * 2,
        y: rng() * CANVAS_H * 0.7,
        r: rng() < 0.2 ? 1.6 : 0.9,
    }));
})();

function drawSky() {
    const sec = sectionOf(colAt(scrollX + CANVAS_W / 2));
    const grd = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    if (sec >= 2) {
        grd.addColorStop(0, '#100a1e');
        grd.addColorStop(1, '#241033');
    } else {
        grd.addColorStop(0, '#050a1e');
        grd.addColorStop(1, '#131e3f');
    }
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const drift = (scrollX * 0.25) % (CANVAS_W * 2);
    for (const s of STARS) {
        let x = s.x - drift;
        if (x < 0) x += CANVAS_W * 2;
        if (x > CANVAS_W) continue;
        ctx.fillRect(x, s.y, s.r, s.r);
    }
}

function drawTerrain() {
    const first = colAt(scrollX);
    const last = colAt(scrollX + CANVAS_W) + 1;

    // Ground
    ctx.beginPath();
    ctx.moveTo(first * COLUMN_W - scrollX, CANVAS_H);
    for (let c = first; c <= last && c < LEVEL_COLUMNS; c++) {
        const x = c * COLUMN_W - scrollX;
        ctx.lineTo(x, CANVAS_H - groundH[c]);
        ctx.lineTo(x + COLUMN_W, CANVAS_H - groundH[c]);
    }
    ctx.lineTo(Math.min(CANVAS_W, WORLD_W - scrollX), CANVAS_H);
    ctx.closePath();
    ctx.fillStyle = '#1f7a3d';
    ctx.fill();
    ctx.strokeStyle = '#5ff08a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Ceiling
    if (ceilH.slice(first, last + 1).some((h) => h > 0)) {
        ctx.beginPath();
        ctx.moveTo(first * COLUMN_W - scrollX, 0);
        for (let c = first; c <= last && c < LEVEL_COLUMNS; c++) {
            const x = c * COLUMN_W - scrollX;
            ctx.lineTo(x, ceilH[c]);
            ctx.lineTo(x + COLUMN_W, ceilH[c]);
        }
        ctx.lineTo(Math.min(CANVAS_W, WORLD_W - scrollX), 0);
        ctx.closePath();
        ctx.fillStyle = '#4a2c63';
        ctx.fill();
        ctx.strokeStyle = '#a978d0';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

function drawTargets() {
    for (const t of tanks) {
        if (!t.alive) continue;
        const x = screenX(t.x);
        if (x < -TANK_W || x > CANVAS_W) continue;
        ctx.fillStyle = '#f2c14e';
        ctx.fillRect(x, t.y, t.w, t.h);
        ctx.fillStyle = '#7a4b12';
        ctx.fillRect(x + 3, t.y + 6, t.w - 6, 4);
        ctx.fillStyle = '#241a06';
        ctx.font = 'bold 9px monospace';
        ctx.fillText('FUEL', x + 2, t.y + t.h - 5);
    }

    for (const r of rockets) {
        if (!r.alive) continue;
        const x = screenX(r.x);
        if (x < -ROCKET_W * 2 || x > CANVAS_W) continue;
        ctx.fillStyle = '#d8dee9';
        ctx.fillRect(x, r.y + 6, r.w, r.h - 6);
        ctx.beginPath();
        ctx.moveTo(x, r.y + 6);
        ctx.lineTo(x + r.w / 2, r.y - 4);
        ctx.lineTo(x + r.w, r.y + 6);
        ctx.closePath();
        ctx.fillStyle = '#e05c4a';
        ctx.fill();
        if (r.launched) {
            ctx.beginPath();
            ctx.moveTo(x + 1, r.y + r.h);
            ctx.lineTo(x + r.w / 2, r.y + r.h + 12);
            ctx.lineTo(x + r.w - 1, r.y + r.h);
            ctx.closePath();
            ctx.fillStyle = '#ffb03a';
            ctx.fill();
        }
    }

    if (base && base.alive) {
        const x = screenX(base.x);
        if (x > -BASE_W && x < CANVAS_W) {
            ctx.fillStyle = '#6b7280';
            ctx.fillRect(x, base.y, base.w, base.h);
            ctx.fillStyle = '#9aa3af';
            ctx.fillRect(x + 8, base.y - 10, base.w - 16, 12);
            ctx.fillStyle = '#e05c4a';
            ctx.fillRect(x + base.w / 2 - 4, base.y - 24, 8, 16);
            ctx.fillStyle = '#141821';
            for (let i = 0; i < 4; i++) ctx.fillRect(x + 10 + i * 20, base.y + 16, 10, 14);
        }
    }
}

function drawShip() {
    if (state === 'dying') return;
    // A respawned ship blinks while it is invulnerable.
    if (ship.invuln > 0 && Math.floor(ship.invuln * 12) % 2 === 0) return;

    const x = screenX(ship.x);
    const y = ship.y;
    ctx.beginPath();
    ctx.moveTo(x + SHIP_HW, y);
    ctx.lineTo(x - SHIP_HW, y - SHIP_HH);
    ctx.lineTo(x - SHIP_HW + 6, y);
    ctx.lineTo(x - SHIP_HW, y + SHIP_HH);
    ctx.closePath();
    ctx.fillStyle = '#5ad6ff';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 2, y - 3, 8, 3);

    ctx.beginPath();
    ctx.moveTo(x - SHIP_HW + 6, y - 3);
    ctx.lineTo(x - SHIP_HW - 8, y);
    ctx.lineTo(x - SHIP_HW + 6, y + 3);
    ctx.closePath();
    ctx.fillStyle = '#ffb03a';
    ctx.fill();
}

function drawShots() {
    ctx.fillStyle = '#ffe66d';
    for (const b of bullets) ctx.fillRect(screenX(b.x) - 5, b.y - 1, 10, 2);

    ctx.fillStyle = '#f0f0f0';
    for (const b of bombs) {
        ctx.beginPath();
        ctx.arc(screenX(b.x), b.y, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    for (const e of explosions) {
        const p = e.t / EXPLOSION_LIFE;
        ctx.globalAlpha = 1 - p;
        ctx.beginPath();
        ctx.arc(screenX(e.x), e.y, 6 + p * 26 * e.scale, 0, Math.PI * 2);
        ctx.fillStyle = p < 0.5 ? '#ffd166' : '#e05c4a';
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function drawFuelBar() {
    const w = 200, h = 12, x = 16, y = CANVAS_H - 24;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    const p = fuel / FUEL_MAX;
    ctx.fillStyle = p < 0.25 ? '#e05c4a' : '#5ff08a';
    ctx.fillRect(x, y, w * p, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('FUEL', x + w + 10, y + h - 1);
}

function drawBanner(text) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, CANVAS_H / 2 - 34, CANVAS_W, 68);
    ctx.fillStyle = '#ffe66d';
    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2 + 10);
    ctx.textAlign = 'left';
}

function draw() {
    drawSky();
    drawTerrain();
    drawTargets();
    drawShots();
    drawShip();
    drawFuelBar();

    if (state === 'levelclear') drawBanner(`SECTOR ${level} CLEARED`);
    if (state === 'dying') drawBanner(lives > 0 ? `SHIPS LEFT ${lives}` : 'LAST SHIP DOWN');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const MOVE_KEYS = [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'a',
    'd',
    'w',
    's',
    'A',
    'D',
    'W',
    'S',
];
const heldKeys = new Set();

function refreshDir() {
    const held = (...keys) => keys.some((k) => heldKeys.has(k));
    ship.dir.x = (held('ArrowRight', 'd', 'D') ? 1 : 0) - (held('ArrowLeft', 'a', 'A') ? 1 : 0);
    ship.dir.y = (held('ArrowDown', 's', 'S') ? 1 : 0) - (held('ArrowUp', 'w', 'W') ? 1 : 0);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if (e.key === 'b' || e.key === 'B') {
        dropBomb();
        e.preventDefault();
        return;
    }
    if (e.key === 'Enter') {
        if (state === 'paused') togglePause();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.code === 'Space') {
        if (state === 'running') fireLaser();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshDir();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshDir();
    }
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
    if (autoRun) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('scramble-best') || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
fuel = FUEL_MAX;
scrollX = 0;
buildLevel(level);
resetShip();
updateHud();
showOverlay('SCRAMBLE', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
