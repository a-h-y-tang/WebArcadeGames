// ---------------------------------------------------------------------------
// Scramble — a side-scrolling cave flyer on an HTML5 canvas.
//
// The jet is dragged forward through a procedurally generated canyon at a fixed
// speed; the player only chooses where inside the canyon to sit. Fuel drains
// the whole time and the only way to top it up is to blow up the fuel dumps on
// the canyon floor, so every run is a trade between flying the safe line and
// diving low enough to bomb the tanks that keep you airborne.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Kaboom!,
// BurgerTime and Snake in this repo. All motion is expressed per second and
// applied by `step(dt)`, so the specs can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Canvas / world ------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 420;

const COL_W = 20;                 // width of one terrain column
const LEVEL_COLS = 180;           // columns the player must fly past
const MARGIN_COLS = 40;           // extra columns so the far edge is never blank
const LEVEL_LEN = LEVEL_COLS * COL_W;
const SAFE_COLS = 12;             // flat, open launch strip at the start
const RAMP_COLS = 6;              // columns the ceiling fades in over
const GROUND_MIN = 40;
const GROUND_MAX = 150;
const CEIL_MIN = 15;
const CEIL_MAX = 110;
const MIN_GAP = 150;              // guaranteed flyable corridor height

// --- Ship ----------------------------------------------------------------
const SHIP_HW = 17;               // half width
const SHIP_HH = 8;                // half height
const SHIP_SPEED = 150;           // px/s of player input
const SHIP_MIN_SX = 40;           // window the ship may occupy on screen
const SHIP_MAX_SX = 280;
const SPAWN_SX = 90;
const SPAWN_Y = 150;
const START_LIVES = 3;
const RESPAWN_DELAY = 1.2;

// --- Scrolling -----------------------------------------------------------
const SCROLL_BASE = 105;
const SCROLL_STEP = 12;           // extra px/s per level

// --- Fuel ----------------------------------------------------------------
const FUEL_MAX = 100;
// A full tank just about outlasts a clean run through level 1, so the dumps are
// the difference between finishing comfortably and coasting in on fumes.
const FUEL_DRAIN = 2.6;           // units per second
const FUEL_PER_TANK = 15;

// --- Weapons -------------------------------------------------------------
const BULLET_SPEED = 420;
const BULLET_MAX = 4;
const BULLET_LEN = 10;
const BOMB_MAX = 3;
const BOMB_VX = 70;               // forward push on top of the scroll speed
const BOMB_GRAVITY = 320;
const BOMB_R = 4;
const BLAST_R = 34;
const BLAST_LIFE = 0.4;

// --- Targets -------------------------------------------------------------
const TANK_W = 22;
const TANK_H = 18;
const ROCKET_W = 12;
const ROCKET_H = 22;
const ROCKET_SPEED = 70;
const ROCKET_SPEED_STEP = 8;
const ROCKET_TRIGGER = 240;       // world px of warning before a rocket lifts off

// --- Scoring -------------------------------------------------------------
const TANK_POINTS = 100;
const ROCKET_POINTS = 80;
const LEVEL_BONUS = 500;
const FUEL_BONUS_MULT = 5;

const BEST_KEY = 'scramble-best';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';               // idle | running | paused | over
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let fuel = FUEL_MAX;
let camX = 0;                     // world x of the left screen edge
let respawnTimer = 0;
let fuelDrainEnabled = true;
let crashReason = '';
let flashText = '';
let flashTimer = 0;
let starPhase = 0;

const ship = { x: SPAWN_SX, y: SPAWN_Y, alive: true, dir: { x: 0, y: 0 }, tilt: 0 };
const terrain = [];               // [{ ground, ceil }] per column
const tanks = [];
const rockets = [];
const bullets = [];
const bombs = [];
const blasts = [];
const stars = [];
const hills = [];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elFuel = document.getElementById('fuel');
const elBest = document.getElementById('best');
const elFuelFill = document.getElementById('fuel-fill');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Small deterministic PRNG so a level number always yields the same canyon.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function columnIndexAt(worldX) {
    return clamp(Math.floor(worldX / COL_W), 0, terrain.length - 1);
}

function groundHeightAt(worldX) {
    return terrain[columnIndexAt(worldX)].ground;
}

function ceilHeightAt(worldX) {
    return terrain[columnIndexAt(worldX)].ceil;
}

function scrollSpeed() {
    return SCROLL_BASE + (level - 1) * SCROLL_STEP;
}

function rocketSpeed() {
    return ROCKET_SPEED + (level - 1) * ROCKET_SPEED_STEP;
}

function shipScreenX() {
    return ship.x - camX;
}

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

function buildLevel() {
    const rand = mulberry32(level * 1000003 + 12345);
    const hasCeil = level >= 2;

    terrain.length = 0;
    let ground = GROUND_MIN;
    let ceil = CEIL_MIN + 25;

    for (let i = 0; i < LEVEL_COLS + MARGIN_COLS; i++) {
        if (i < SAFE_COLS) {
            terrain.push({ ground: GROUND_MIN, ceil: 0 });
            continue;
        }
        // Small per-column steps: the walls must never close faster than the
        // ship can climb or dive out of the way.
        ground = clamp(ground + Math.round((rand() - 0.5) * 20), GROUND_MIN, GROUND_MAX);
        if (hasCeil) {
            ceil = clamp(ceil + Math.round((rand() - 0.5) * 20), CEIL_MIN, CEIL_MAX);
        } else {
            rand();
            ceil = 0;
        }
        // Fade the roof in so the safe strip doesn't end in a sheer wall.
        const ramp = clamp((i - SAFE_COLS) / RAMP_COLS, 0, 1);
        terrain.push({ ground, ceil: Math.round(ceil * ramp) });
        trimCeil(terrain[i]);
    }

    stockTargets(rand);
    buildStars();
    buildHills();
}

// Keep a flyable corridor no matter how tall the floor got.
function trimCeil(col) {
    col.ceil = clamp(col.ceil, 0, Math.max(0, CANVAS_H - col.ground - MIN_GAP));
}

// Fuel dumps and rockets alternate so a level always has some of each.
function stockTargets(rand) {
    tanks.length = 0;
    rockets.length = 0;

    let col = SAFE_COLS + 6;
    let n = 0;
    while (col < LEVEL_COLS - 6) {
        // Flatten the pad so the target isn't standing on a slope.
        const g = terrain[col].ground;
        for (let i = col - 1; i <= col + 1; i++) {
            terrain[i].ground = g;
            trimCeil(terrain[i]);
        }

        const x = col * COL_W + COL_W / 2;
        const floorY = CANVAS_H - g;
        if (n % 2 === 0) {
            tanks.push({
                kind: 'tank', x, y: floorY - TANK_H, y0: floorY - TANK_H,
                w: TANK_W, h: TANK_H, alive: true,
            });
        } else {
            rockets.push({
                kind: 'rocket', x, y: floorY - ROCKET_H, y0: floorY - ROCKET_H,
                w: ROCKET_W, h: ROCKET_H, alive: true, launched: false,
            });
        }
        n++;
        col += 8 + Math.floor(rand() * 9);
    }
}

function restoreTargets() {
    for (const t of [...tanks, ...rockets]) {
        t.alive = true;
        t.y = t.y0;
        if (t.kind === 'rocket') t.launched = false;
    }
}

// A second, purely decorative height profile drawn at half the scroll speed.
function buildHills() {
    const rand = mulberry32(level * 6151 + 31);
    hills.length = 0;
    let h = 90;
    for (let i = 0; i < LEVEL_COLS + MARGIN_COLS; i++) {
        h = clamp(h + Math.round((rand() - 0.5) * 22), 55, 165);
        hills.push(h);
    }
}

function buildStars() {
    const rand = mulberry32(level * 7919 + 77);
    stars.length = 0;
    for (let i = 0; i < 70; i++) {
        stars.push({
            x: rand() * (LEVEL_LEN + CANVAS_W),
            y: rand() * (CANVAS_H - 120),
            r: 0.6 + rand() * 1.2,
            p: rand(),
        });
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function clearShots() {
    bullets.length = 0;
    bombs.length = 0;
    blasts.length = 0;
}

function resetShip() {
    ship.x = camX + SPAWN_SX;
    ship.y = SPAWN_Y;
    ship.alive = true;
    ship.tilt = 0;
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    fuel = FUEL_MAX;
    camX = 0;
    respawnTimer = 0;
    state = 'running';
    buildLevel();
    clearShots();
    resetShip();
    flash('LEVEL 1', 1.2);
    hideOverlay();
    updateHud();
}

function nextLevel() {
    score += LEVEL_BONUS + Math.round(fuel) * FUEL_BONUS_MULT;
    level++;
    fuel = FUEL_MAX;
    camX = 0;
    buildLevel();
    clearShots();
    resetShip();
    flash('LEVEL ' + level, 1.6);
    updateHud();
}

// A crash costs a life and restarts the current level from its safe strip.
function crash(reason) {
    if (state !== 'running' || !ship.alive) return;
    crashReason = reason || 'CRASHED';
    flash(crashReason, RESPAWN_DELAY);
    ship.alive = false;
    lives--;
    respawnTimer = RESPAWN_DELAY;
    blasts.push({ x: ship.x, y: ship.y, t: 0, big: true });
    updateHud();
    if (lives <= 0) gameOver();
}

function respawnShip() {
    camX = 0;
    fuel = FUEL_MAX;
    restoreTargets();
    clearShots();
    resetShip();
    updateHud();
}

function gameOver() {
    lives = 0;
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* private browsing — the run just isn't remembered */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Best ${best}`, 'Press Space to fly again');
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

function flash(text, time) {
    flashText = text;
    flashTimer = time;
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

function fire() {
    if (state !== 'running' || !ship.alive) return;
    if (bullets.length >= BULLET_MAX) return;
    bullets.push({ x: ship.x + SHIP_HW, y: ship.y });
}

function dropBomb() {
    if (state !== 'running' || !ship.alive) return;
    if (bombs.length >= BOMB_MAX) return;
    bombs.push({ x: ship.x, y: ship.y + SHIP_HH, vx: scrollSpeed() + BOMB_VX, vy: 0 });
}

function destroyTarget(target) {
    if (!target.alive) return;
    target.alive = false;
    if (target.kind === 'tank') {
        score += TANK_POINTS;
        fuel = Math.min(FUEL_MAX, fuel + FUEL_PER_TANK);
    } else {
        score += ROCKET_POINTS;
    }
    blasts.push({ x: target.x, y: target.y + target.h / 2, t: 0, big: false });
    updateHud();
}

function explode(x, y) {
    blasts.push({ x, y, t: 0, big: true });
    for (const target of [...tanks, ...rockets]) {
        if (target.alive && rectDistance(x, y, target) < BLAST_R) destroyTarget(target);
    }
}

// Distance from a point to the nearest edge of a target's box.
function rectDistance(x, y, t) {
    const dx = Math.max(Math.abs(x - t.x) - t.w / 2, 0);
    const dy = Math.max(Math.abs(y - (t.y + t.h / 2)) - t.h / 2, 0);
    return Math.hypot(dx, dy);
}

function hitsTarget(x, y, t) {
    return (
        x > t.x - t.w / 2 && x < t.x + t.w / 2 &&
        y > t.y && y < t.y + t.h
    );
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    // Checked before anything moves, so the finish line can be crossed in the
    // same frame the ship reaches it.
    if (ship.alive && ship.x >= LEVEL_LEN) {
        nextLevel();
        return;
    }

    const speed = scrollSpeed();
    camX += speed * dt;
    starPhase += dt;
    if (flashTimer > 0) flashTimer = Math.max(0, flashTimer - dt);

    if (ship.alive) {
        ship.x += (speed + ship.dir.x * SHIP_SPEED) * dt;
        ship.y += ship.dir.y * SHIP_SPEED * dt;
        ship.x = clamp(ship.x, camX + SHIP_MIN_SX, camX + SHIP_MAX_SX);
        ship.y = clamp(ship.y, SHIP_HH, CANVAS_H - SHIP_HH);
        ship.tilt += (ship.dir.y * 0.3 - ship.tilt) * Math.min(1, dt * 8);

        if (fuelDrainEnabled) {
            fuel -= FUEL_DRAIN * dt;
            if (fuel <= 0) {
                fuel = 0;
                crash('OUT OF FUEL');
            }
        }
    } else {
        respawnTimer -= dt;
        if (respawnTimer <= 0 && state === 'running') respawnShip();
    }

    updateBullets(dt);
    updateBombs(dt);
    updateBlasts(dt);
    updateRockets(dt);

    if (ship.alive) checkShipCollisions();
    updateHud();
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += BULLET_SPEED * dt;

        if (b.x - camX > CANVAS_W || b.y > CANVAS_H - groundHeightAt(b.x) || b.y < ceilHeightAt(b.x)) {
            bullets.splice(i, 1);
            continue;
        }
        let hit = null;
        for (const target of [...tanks, ...rockets]) {
            if (target.alive && hitsTarget(b.x, b.y, target)) {
                hit = target;
                break;
            }
        }
        if (hit) {
            destroyTarget(hit);
            bullets.splice(i, 1);
        }
    }
}

function updateBombs(dt) {
    for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.x += b.vx * dt;
        b.vy += BOMB_GRAVITY * dt;
        b.y += b.vy * dt;

        const floorY = CANVAS_H - groundHeightAt(b.x);
        if (b.y >= floorY) {
            explode(b.x, floorY);
            bombs.splice(i, 1);
        } else if (b.x - camX > CANVAS_W) {
            bombs.splice(i, 1);
        }
    }
}

function updateBlasts(dt) {
    for (let i = blasts.length - 1; i >= 0; i--) {
        blasts[i].t += dt;
        if (blasts[i].t >= BLAST_LIFE) blasts.splice(i, 1);
    }
}

function updateRockets(dt) {
    for (const rocket of rockets) {
        if (!rocket.alive) continue;

        if (!rocket.launched && ship.alive) {
            const lead = rocket.x - ship.x;
            if (lead <= ROCKET_TRIGGER && lead > -60) rocket.launched = true;
        }
        if (rocket.launched) {
            rocket.y -= rocketSpeed() * dt;
            // Spent on the roof of the cave, or gone off the top of an open sky.
            if (rocket.y + rocket.h < 0 || rocket.y < ceilHeightAt(rocket.x)) {
                rocket.alive = false;
            }
        }
    }
}

function checkShipCollisions() {
    const first = columnIndexAt(ship.x - SHIP_HW);
    const last = columnIndexAt(ship.x + SHIP_HW);
    for (let i = first; i <= last; i++) {
        const col = terrain[i];
        if (ship.y + SHIP_HH > CANVAS_H - col.ground || ship.y - SHIP_HH < col.ceil) {
            crash('CRASHED');
            return;
        }
    }
    for (const target of [...tanks, ...rockets]) {
        if (!target.alive) continue;
        if (
            Math.abs(ship.x - target.x) < SHIP_HW + target.w / 2 &&
            ship.y + SHIP_HH > target.y &&
            ship.y - SHIP_HH < target.y + target.h
        ) {
            crash(target.kind === 'rocket' ? 'SHOT DOWN' : 'CRASHED');
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    const shown = Math.max(0, Math.round(fuel));
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elLives.textContent = String(Math.max(0, lives));
    elFuel.textContent = String(shown);
    elBest.textContent = String(best);

    const pct = clamp((fuel / FUEL_MAX) * 100, 0, 100);
    elFuelFill.style.width = `${pct}%`;
    elFuelFill.classList.toggle('low', pct < 40 && pct >= 20);
    elFuelFill.classList.toggle('critical', pct < 20);
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

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    drawSky();
    drawStars();
    drawHills();
    drawTerrain();
    drawTargets();
    drawBombs();
    drawBullets();
    if (ship.alive) drawShip();
    drawBlasts();
    drawProgress();
    drawFlash();
}

function drawSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#050a16');
    sky.addColorStop(0.6, '#0b1730');
    sky.addColorStop(1, '#132445');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawStars() {
    for (const s of stars) {
        const sx = s.x - camX * 0.35;
        if (sx < -4 || sx > CANVAS_W + 4) continue;
        const twinkle = 0.35 + 0.35 * Math.sin(starPhase * 2 + s.p * 9);
        ctx.fillStyle = `rgba(190, 220, 255, ${twinkle})`;
        ctx.beginPath();
        ctx.arc(sx, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawHills() {
    const parallax = camX * 0.5;
    const first = Math.max(0, Math.floor(parallax / COL_W) - 1);
    const last = Math.min(hills.length - 1, first + Math.ceil(CANVAS_W / COL_W) + 2);
    if (last <= first) return;

    ctx.beginPath();
    ctx.moveTo(first * COL_W - parallax, CANVAS_H);
    for (let i = first; i <= last; i++) {
        const x = i * COL_W - parallax;
        ctx.lineTo(x, CANVAS_H - hills[i]);
        ctx.lineTo(x + COL_W, CANVAS_H - hills[i]);
    }
    ctx.lineTo(last * COL_W + COL_W - parallax, CANVAS_H);
    ctx.closePath();
    ctx.fillStyle = '#16233f';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 160, 220, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawTerrain() {
    const first = Math.max(0, Math.floor(camX / COL_W) - 1);
    const last = Math.min(terrain.length - 1, first + Math.ceil(CANVAS_W / COL_W) + 2);

    // Floor
    ctx.beginPath();
    ctx.moveTo(first * COL_W - camX, CANVAS_H);
    for (let i = first; i <= last; i++) {
        const x = i * COL_W - camX;
        ctx.lineTo(x, CANVAS_H - terrain[i].ground);
        ctx.lineTo(x + COL_W, CANVAS_H - terrain[i].ground);
    }
    ctx.lineTo(last * COL_W + COL_W - camX, CANVAS_H);
    ctx.closePath();
    const rock = ctx.createLinearGradient(0, CANVAS_H - GROUND_MAX, 0, CANVAS_H);
    rock.addColorStop(0, '#3f7a4a');
    rock.addColorStop(1, '#16341f');
    ctx.fillStyle = rock;
    ctx.fill();
    ctx.strokeStyle = '#7ee08a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // A little grain so the floor doesn't read as a flat slab.
    ctx.strokeStyle = 'rgba(10, 30, 16, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = first; i <= last; i++) {
        const x = i * COL_W - camX;
        ctx.moveTo(x, CANVAS_H - terrain[i].ground + 3);
        ctx.lineTo(x, CANVAS_H);
    }
    ctx.stroke();

    // Ceiling
    if (terrain.some((c) => c.ceil > 0)) {
        ctx.beginPath();
        ctx.moveTo(first * COL_W - camX, 0);
        for (let i = first; i <= last; i++) {
            const x = i * COL_W - camX;
            ctx.lineTo(x, terrain[i].ceil);
            ctx.lineTo(x + COL_W, terrain[i].ceil);
        }
        ctx.lineTo(last * COL_W + COL_W - camX, 0);
        ctx.closePath();
        const roof = ctx.createLinearGradient(0, 0, 0, CEIL_MAX);
        roof.addColorStop(0, '#4a3f78');
        roof.addColorStop(1, '#2a2247');
        ctx.fillStyle = roof;
        ctx.fill();
        ctx.strokeStyle = '#b3a6ff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(20, 16, 40, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = first; i <= last; i++) {
            if (terrain[i].ceil <= 0) continue;
            const x = i * COL_W - camX;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, terrain[i].ceil - 3);
        }
        ctx.stroke();
    }
}

function drawTargets() {
    for (const t of tanks) {
        if (!t.alive) continue;
        const x = t.x - camX;
        if (x < -40 || x > CANVAS_W + 40) continue;
        ctx.fillStyle = '#d9433a';
        ctx.fillRect(x - t.w / 2, t.y, t.w, t.h);
        ctx.fillStyle = '#ffd7a0';
        ctx.fillRect(x - t.w / 2, t.y + 3, t.w, 3);
        ctx.fillStyle = '#2b0f0c';
        ctx.font = 'bold 8px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('FUEL', x, t.y + t.h - 4);
        ctx.textAlign = 'left';
    }

    for (const r of rockets) {
        if (!r.alive) continue;
        const x = r.x - camX;
        if (x < -40 || x > CANVAS_W + 40) continue;
        ctx.fillStyle = r.launched ? '#ffe07a' : '#cfd8ea';
        ctx.beginPath();
        ctx.moveTo(x, r.y);
        ctx.lineTo(x + r.w / 2, r.y + r.h * 0.45);
        ctx.lineTo(x + r.w / 2, r.y + r.h);
        ctx.lineTo(x - r.w / 2, r.y + r.h);
        ctx.lineTo(x - r.w / 2, r.y + r.h * 0.45);
        ctx.closePath();
        ctx.fill();
        if (r.launched) {
            ctx.fillStyle = '#ff9330';
            ctx.beginPath();
            ctx.moveTo(x - 4, r.y + r.h);
            ctx.lineTo(x + 4, r.y + r.h);
            ctx.lineTo(x, r.y + r.h + 10 + Math.random() * 6);
            ctx.closePath();
            ctx.fill();
        }
    }
}

function drawShip() {
    const x = shipScreenX();
    const y = ship.y;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ship.tilt);

    // Exhaust
    ctx.fillStyle = '#ff9330';
    ctx.beginPath();
    ctx.moveTo(-SHIP_HW, -3);
    ctx.lineTo(-SHIP_HW, 3);
    ctx.lineTo(-SHIP_HW - 8 - Math.random() * 7, 0);
    ctx.closePath();
    ctx.fill();

    // Fuselage
    ctx.fillStyle = '#e9f2ff';
    ctx.beginPath();
    ctx.moveTo(SHIP_HW, 0);
    ctx.lineTo(0, -SHIP_HH);
    ctx.lineTo(-SHIP_HW, -2);
    ctx.lineTo(-SHIP_HW, SHIP_HH);
    ctx.lineTo(4, SHIP_HH);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#7f93b5';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Tail fin and canopy
    ctx.fillStyle = '#b9c8de';
    ctx.beginPath();
    ctx.moveTo(-SHIP_HW + 2, -2);
    ctx.lineTo(-SHIP_HW + 8, -SHIP_HH - 5);
    ctx.lineTo(-SHIP_HW + 12, -2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#4fd0ff';
    ctx.fillRect(-2, -5, 9, 4);
    ctx.restore();
}

function drawBullets() {
    ctx.lineCap = 'round';
    for (const b of bullets) {
        const x = b.x - camX;
        ctx.strokeStyle = 'rgba(120, 255, 220, 0.25)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x - BULLET_LEN - 4, b.y);
        ctx.lineTo(x, b.y);
        ctx.stroke();

        ctx.strokeStyle = '#d8fff4';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - BULLET_LEN, b.y);
        ctx.lineTo(x, b.y);
        ctx.stroke();
    }
    ctx.lineCap = 'butt';
}

function drawBombs() {
    ctx.fillStyle = '#ffd45e';
    for (const b of bombs) {
        ctx.beginPath();
        ctx.ellipse(b.x - camX, b.y, BOMB_R + 1, BOMB_R, 0.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBlasts() {
    for (const b of blasts) {
        const k = clamp(b.t / BLAST_LIFE, 0, 1);
        const r = (b.big ? BLAST_R : BLAST_R * 0.65) * (0.4 + k * 0.9);
        const x = b.x - camX;
        const fade = 1 - k;

        const glow = ctx.createRadialGradient(x, b.y, 0, x, b.y, r);
        glow.addColorStop(0, `rgba(255, 250, 220, ${0.95 * fade})`);
        glow.addColorStop(0.35, `rgba(255, 190, 70, ${0.8 * fade})`);
        glow.addColorStop(0.7, `rgba(233, 96, 40, ${0.45 * fade})`);
        glow.addColorStop(1, 'rgba(120, 30, 10, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, b.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Sparks fly out along fixed spokes so the burst reads as an explosion.
        ctx.strokeStyle = `rgba(255, 214, 130, ${0.7 * fade})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + (b.big ? 0.2 : 0.5);
            ctx.moveTo(x + Math.cos(a) * r * 0.7, b.y + Math.sin(a) * r * 0.7);
            ctx.lineTo(x + Math.cos(a) * r * 1.25, b.y + Math.sin(a) * r * 1.25);
        }
        ctx.stroke();
    }
}

function drawProgress() {
    const pct = clamp(ship.x / LEVEL_LEN, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(12, 12, CANVAS_W - 24, 4);
    ctx.fillStyle = '#4fd0ff';
    ctx.fillRect(12, 12, (CANVAS_W - 24) * pct, 4);
}

function drawFlash() {
    if (flashTimer <= 0) return;
    ctx.globalAlpha = Math.min(1, flashTimer * 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(flashText, CANVAS_W / 2, 70);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const MOVE_KEYS = [
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'w', 'a', 's', 'd', 'W', 'A', 'S', 'D',
];
const heldKeys = new Set();

function refreshDir() {
    const up = heldKeys.has('ArrowUp') || heldKeys.has('w') || heldKeys.has('W');
    const down = heldKeys.has('ArrowDown') || heldKeys.has('s') || heldKeys.has('S');
    const left = heldKeys.has('ArrowLeft') || heldKeys.has('a') || heldKeys.has('A');
    const right = heldKeys.has('ArrowRight') || heldKeys.has('d') || heldKeys.has('D');
    ship.dir.x = (right ? 1 : 0) - (left ? 1 : 0);
    ship.dir.y = (down ? 1 : 0) - (up ? 1 : 0);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if (e.key === 'b' || e.key === 'B') {
        dropBomb();
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
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
fuel = FUEL_MAX;
camX = 0;
buildLevel();
resetShip();
updateHud();
showOverlay('SCRAMBLE', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
