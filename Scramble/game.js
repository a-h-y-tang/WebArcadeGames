// ---------------------------------------------------------------------------
// Scramble — a side-scrolling cave flyer on an HTML5 canvas.
//
// The jet flies right through a winding cave that never stops scrolling. Fuel
// drains the whole time, and the only way to top it up is to blow open the fuel
// tanks parked on the cave floor — so the ship has to dive at the ground it is
// trying not to hit. Rockets standing on the floor launch as the jet closes in.
// Reaching the end of a cave clears the level and opens a longer, faster one.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Kaboom! and Snake in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Canvas / cave layout ------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 400;
const COL_W = 16;                 // width of one terrain column
const MIN_GAP = 110;              // narrowest cave the generator may produce
const OPENING_GAP = 150;          // the calm stretch the ship flies into
const OPENING_COLS = 18;          // how many columns stay calm at the mouth
const OPENING_CEIL = 40;
const OPENING_GROUND = 340;
const CEIL_MIN = 16, CEIL_MAX = 150;
const GROUND_MIN = 210, GROUND_MAX = 384;
const RUNOUT = CANVAS_W;          // extra cave drawn past the finish line

// --- Ship ----------------------------------------------------------------
const SHIP_HW = 16;               // half-width  (nose to centre)
const SHIP_HH = 7;                // half-height
const SHIP_DY = 150;              // px/s climb / dive
const SHIP_DX = 110;              // px/s of forward trim on top of the scroll
const SHIP_MIN_SX = 40;           // ship's screen-x limits
const SHIP_MAX_SX = 420;
const SHIP_START_SX = 120;
const SHIP_START_Y = 200;

// --- Weapons -------------------------------------------------------------
const MAX_BULLETS = 4;
const BULLET_SPEED = 430;         // px/s, flat
const BOMB_VY0 = 40;              // px/s, released with a little downward push
const BOMB_GRAVITY = 300;         // px/s²
const HIT_HW = 14;                // target hit box, half-width
const HIT_ABOVE = 24;             // ... and how far above its base it reaches
const HIT_BELOW = 6;

// --- Targets -------------------------------------------------------------
const TANK_POINTS = 150;
const ROCKET_POINTS = 80;
const FUEL_PICKUP = 25;
const LAUNCH_RANGE = 260;         // how close the jet gets before a rocket goes
const ROCKET_SPEED = 90;          // px/s climb
const ROCKET_DRIFT = 26;          // px/s of lean towards the jet
const ROCKET_HIT_X = 20, ROCKET_HIT_Y = 16;
const FIRST_TARGET_COL = 40;      // nothing parked in the opening stretch
const TARGET_GAP_MIN = 9, TARGET_GAP_MAX = 17;   // columns between targets

// --- Fuel ----------------------------------------------------------------
const FUEL_MAX = 100;
const FUEL_BURN = 3.0;            // units per second

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const CLEAR_BONUS = 500;
const FUEL_BONUS = 5;             // per unit of fuel left at the finish line
const DEATH_PAUSE = 1.4;
const CLEAR_PAUSE = 1.6;
const BASE_SPEED = 78;            // level 1 scroll, px/s
const SPEED_STEP = 12;
const SPEED_CAP = 170;
const BASE_LENGTH = 2600;         // level 1 cave length, px
const LENGTH_STEP = 500;

// --- Colours -------------------------------------------------------------
const COL_SKY_TOP = '#050a1c';
const COL_SKY_BOTTOM = '#0d1b3a';
const COL_ROCK = '#2f6b3c';
const COL_ROCK_EDGE = '#63c96b';
const COL_SHIP = '#e8f1ff';
const COL_TANK = '#f5b942';
const COL_ROCKET = '#ef5b4c';

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const fuelEl = document.getElementById('fuel');
const fuelBarEl = document.getElementById('fuel-bar');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'dying' | 'cleared' | 'over'
let state, score, best, lives, level, fuel, scrollX, pauseTimer;
let terrain = [];
let tanks = [];
let rockets = [];
let bullets = [];
let bombs = [];
let blasts = [];
let stars = [];
const ship = { x: 0, y: SHIP_START_Y, dir: { x: 0, y: 0 } };

// ---------------------------------------------------------------------------
// Level generation
//
// Everything about a cave comes from a seed derived from its level number, so
// a level looks the same whether it is being played for the first time or
// restarted after a crash — and the tests can rely on that.
// ---------------------------------------------------------------------------

function makeRng(seed) {
    let a = seed >>> 0;
    return function rng() {
        a += 0x6d2b79f5;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function levelLength(lvl) {
    return BASE_LENGTH + LENGTH_STEP * (lvl - 1);
}

function scrollSpeed(lvl) {
    return Math.min(SPEED_CAP, BASE_SPEED + SPEED_STEP * (lvl - 1));
}

function progress() {
    return Math.max(0, Math.min(1, scrollX / levelLength(level)));
}

// Random walk towards a target height, re-aimed every few columns. Higher
// levels aim at rougher targets and are allowed to climb faster, which is what
// makes the later caves tight instead of merely long.
function buildTerrain(lvl) {
    const rng = makeRng(0x5c2a11 + lvl * 7919);
    const cols = Math.ceil((levelLength(lvl) + RUNOUT) / COL_W) + 2;
    const rough = Math.min(1, 0.3 + 0.1 * (lvl - 1));
    const stepMax = 3 + 2.5 * rough;
    const rows = [];

    let ceil = OPENING_CEIL;
    let ground = OPENING_GROUND;
    let ceilTarget = ceil;
    let groundTarget = ground;
    let retarget = OPENING_COLS;

    for (let i = 0; i < cols; i++) {
        if (i >= OPENING_COLS) {
            if (i >= retarget) {
                retarget = i + 5 + Math.floor(rng() * 14);
                ceilTarget = CEIL_MIN + rng() * (CEIL_MAX - CEIL_MIN) * rough * 1.6;
                groundTarget = GROUND_MAX - rng() * (GROUND_MAX - GROUND_MIN) * rough * 1.6;
            }
            ceil += Math.max(-stepMax, Math.min(stepMax, ceilTarget - ceil));
            ground += Math.max(-stepMax, Math.min(stepMax, groundTarget - ground));
        }

        // Round first, then open the gap, so rounding can never pinch a column
        // below the guaranteed clearance.
        const g = Math.round(Math.max(GROUND_MIN, Math.min(CANVAS_H, ground)));
        let c = Math.round(Math.max(0, Math.min(CEIL_MAX, ceil)));
        if (g - c < MIN_GAP) c = g - MIN_GAP;               // never seal the cave
        if (i < OPENING_COLS && g - c < OPENING_GAP) c = g - OPENING_GAP;

        rows.push({ ceil: c, ground: g });
    }
    return rows;
}

// Fuel tanks and rockets are parked on the floor at seeded intervals. Tanks
// outnumber rockets slightly: a cave you cannot refuel in is not a cave, it is
// a countdown.
function buildTargets(lvl) {
    const rng = makeRng(0x1f83d9 + lvl * 104729);
    const lastCol = Math.floor(levelLength(lvl) / COL_W) - 2;
    const newTanks = [];
    const newRockets = [];

    for (let col = FIRST_TARGET_COL; col <= lastCol; ) {
        const x = col * COL_W + COL_W / 2;
        const y = terrain[col].ground;
        if (rng() < 0.45) newTanks.push({ x, y, alive: true });
        else newRockets.push({ x, y, launched: false, alive: true });
        col += TARGET_GAP_MIN + Math.floor(rng() * (TARGET_GAP_MAX - TARGET_GAP_MIN + 1));
    }

    // A cave always holds at least one of each, however the dice fall.
    if (!newTanks.length) {
        const col = FIRST_TARGET_COL;
        newTanks.push({ x: col * COL_W + COL_W / 2, y: terrain[col].ground, alive: true });
    }
    if (!newRockets.length) {
        const col = FIRST_TARGET_COL + TARGET_GAP_MIN;
        newRockets.push({ x: col * COL_W + COL_W / 2, y: terrain[col].ground, launched: false, alive: true });
    }
    return { newTanks, newRockets };
}

function buildStars(lvl) {
    const rng = makeRng(0x2b0ff1 + lvl);
    return Array.from({ length: 70 }, () => ({
        x: rng() * (levelLength(lvl) + RUNOUT),
        y: rng() * CANVAS_H,
        r: 0.6 + rng() * 1.2,
    }));
}

function buildLevel(lvl) {
    terrain = buildTerrain(lvl);
    const { newTanks, newRockets } = buildTargets(lvl);
    tanks = newTanks;
    rockets = newRockets;
    stars = buildStars(lvl);
    bullets = [];
    bombs = [];
    blasts = [];
    scrollX = 0;
    resetShip();
}

// Test hook: iron the cave flat so a spec can be about one behaviour instead of
// about whichever rock face happened to be under the ship.
function flattenTerrain() {
    for (const col of terrain) {
        col.ceil = OPENING_CEIL;
        col.ground = OPENING_GROUND;
    }
}

function colIndex(worldX) {
    return Math.max(0, Math.min(terrain.length - 1, Math.floor(worldX / COL_W)));
}

function groundAt(worldX) {
    return terrain[colIndex(worldX)].ground;
}

function ceilAt(worldX) {
    return terrain[colIndex(worldX)].ceil;
}

function resetShip() {
    ship.x = scrollX + SHIP_START_SX;
    ship.y = SHIP_START_Y;
    ship.dir.x = 0;
    ship.dir.y = 0;
}

// ---------------------------------------------------------------------------
// Run control
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    fuel = FUEL_MAX;
    pauseTimer = 0;
    buildLevel(level);
    state = 'running';
    hideOverlay();
    updateHud();
}

function restartLevel() {
    fuel = FUEL_MAX;
    buildLevel(level);
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    fuel = FUEL_MAX;
    buildLevel(level);
    state = 'running';
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P or click Resume to continue');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function crash() {
    if (state !== 'running') return;
    lives -= 1;
    boom(ship.x, ship.y, 16);
    state = 'dying';
    pauseTimer = DEATH_PAUSE;
    updateHud();
}

function clearLevel() {
    score += CLEAR_BONUS + Math.floor(fuel) * FUEL_BONUS;
    state = 'cleared';
    pauseTimer = CLEAR_PAUSE;
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        localStorage.setItem('scramble-best', String(best));
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space to fly again');
}

function boom(x, y, size) {
    for (let i = 0; i < 12; i++) {
        const a = (Math.PI * 2 * i) / 12;
        blasts.push({
            x,
            y,
            vx: Math.cos(a) * (30 + size * 2),
            vy: Math.sin(a) * (30 + size * 2),
            life: 0.5,
            r: 2 + size / 8,
        });
    }
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

function fire() {
    if (state !== 'running') return;
    if (bullets.length >= MAX_BULLETS) return;
    bullets.push({ x: ship.x + SHIP_HW, y: ship.y });
}

function dropBomb() {
    if (state !== 'running') return;
    bombs.push({
        x: ship.x,
        y: ship.y + SHIP_HH,
        vx: scrollSpeed(level) * 0.7,
        vy: BOMB_VY0,
    });
}

function hitsTarget(t, x, y) {
    return t.alive && Math.abs(x - t.x) < HIT_HW && y > t.y - HIT_ABOVE && y < t.y + HIT_BELOW;
}

// A shot is spent on whatever it hits first; returns true when it is gone.
function resolveHit(x, y) {
    for (const t of tanks) {
        if (hitsTarget(t, x, y)) {
            t.alive = false;
            fuel = Math.min(FUEL_MAX, fuel + FUEL_PICKUP);
            score += TANK_POINTS;
            boom(t.x, t.y - 8, 12);
            return true;
        }
    }
    for (const r of rockets) {
        if (hitsTarget(r, x, y)) {
            r.alive = false;
            score += ROCKET_POINTS;
            boom(r.x, r.y - 8, 10);
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'running') {
        updateRun(dt);
        updateBlasts(dt);
        updateHud();
        return;
    }
    if (state === 'dying' || state === 'cleared') {
        updateBlasts(dt);
        pauseTimer -= dt;
        if (pauseTimer <= 0) {
            if (state === 'dying') {
                if (lives <= 0) gameOver();
                else restartLevel();
            } else {
                nextLevel();
            }
        }
    }
}

function updateRun(dt) {
    const speed = scrollSpeed(level);
    scrollX += speed * dt;

    // --- ship -----------------------------------------------------------
    ship.x += (speed + ship.dir.x * SHIP_DX) * dt;
    ship.x = Math.max(scrollX + SHIP_MIN_SX, Math.min(scrollX + SHIP_MAX_SX, ship.x));
    ship.y += ship.dir.y * SHIP_DY * dt;
    ship.y = Math.max(SHIP_HH, Math.min(CANVAS_H - SHIP_HH, ship.y));

    // --- fuel -----------------------------------------------------------
    fuel -= FUEL_BURN * dt;
    if (fuel <= 0) {
        fuel = 0;
        crash();
        return;
    }

    // --- shots ----------------------------------------------------------
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += BULLET_SPEED * dt;
        const spent =
            resolveHit(b.x, b.y) ||
            b.x - scrollX > CANVAS_W ||
            b.y > groundAt(b.x) ||
            b.y < ceilAt(b.x);
        if (spent) bullets.splice(i, 1);
    }

    for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.vy += BOMB_GRAVITY * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (resolveHit(b.x, b.y)) {
            bombs.splice(i, 1);
        } else if (b.y >= groundAt(b.x) || b.y >= CANVAS_H || b.x - scrollX > CANVAS_W) {
            boom(b.x, Math.min(b.y, groundAt(b.x)), 8);
            bombs.splice(i, 1);
        }
    }

    // --- rockets --------------------------------------------------------
    for (const r of rockets) {
        if (!r.alive) continue;
        if (!r.launched && r.x - ship.x <= LAUNCH_RANGE) r.launched = true;
        if (r.launched) {
            r.y -= ROCKET_SPEED * dt;
            r.x += Math.sign(ship.x - r.x) * ROCKET_DRIFT * dt;
            if (r.y < ceilAt(r.x)) r.alive = false;
        }
        if (
            Math.abs(r.x - ship.x) < ROCKET_HIT_X &&
            Math.abs(r.y - ship.y) < ROCKET_HIT_Y &&
            r.alive
        ) {
            r.alive = false;
            boom(r.x, r.y, 12);
            crash();
            return;
        }
    }

    // --- housekeeping ---------------------------------------------------
    // Wrecks are kept until they scroll off the back of the cave: dropping them
    // the instant they die would make a destroyed target vanish mid-explosion.
    const behind = scrollX - 100;
    tanks = tanks.filter((t) => t.x > behind);
    rockets = rockets.filter((r) => r.x > behind);

    // --- cave collision -------------------------------------------------
    for (let x = ship.x - SHIP_HW; x <= ship.x + SHIP_HW; x += COL_W / 2) {
        if (ship.y + SHIP_HH > groundAt(x) || ship.y - SHIP_HH < ceilAt(x)) {
            crash();
            return;
        }
    }

    // --- finish line ----------------------------------------------------
    if (scrollX >= levelLength(level)) clearLevel();
}

function updateBlasts(dt) {
    for (let i = blasts.length - 1; i >= 0; i--) {
        const p = blasts[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 60 * dt;
        p.life -= dt;
        if (p.life <= 0) blasts.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, COL_SKY_TOP);
    sky.addColorStop(1, COL_SKY_BOTTOM);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawStars();
    drawCave();
    drawTargets();
    drawShots();
    if (state !== 'dying' && state !== 'over') drawShip();
    drawBlasts();
    drawProgress();
}

function drawStars() {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    for (const s of stars) {
        const sx = s.x - scrollX * 0.35;
        if (sx < -4 || sx > CANVAS_W + 4) continue;
        ctx.beginPath();
        ctx.arc(sx, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawCave() {
    const first = colIndex(scrollX);
    const last = colIndex(scrollX + CANVAS_W) + 1;

    // ground
    ctx.beginPath();
    ctx.moveTo(first * COL_W - scrollX, CANVAS_H);
    for (let i = first; i <= last; i++) {
        ctx.lineTo(i * COL_W - scrollX, terrain[i].ground);
        ctx.lineTo((i + 1) * COL_W - scrollX, terrain[i].ground);
    }
    ctx.lineTo((last + 1) * COL_W - scrollX, CANVAS_H);
    ctx.closePath();
    ctx.fillStyle = COL_ROCK;
    ctx.fill();
    ctx.strokeStyle = COL_ROCK_EDGE;
    ctx.lineWidth = 2;
    ctx.stroke();

    // ceiling
    ctx.beginPath();
    ctx.moveTo(first * COL_W - scrollX, 0);
    for (let i = first; i <= last; i++) {
        ctx.lineTo(i * COL_W - scrollX, terrain[i].ceil);
        ctx.lineTo((i + 1) * COL_W - scrollX, terrain[i].ceil);
    }
    ctx.lineTo((last + 1) * COL_W - scrollX, 0);
    ctx.closePath();
    ctx.fillStyle = COL_ROCK;
    ctx.fill();
    ctx.stroke();
}

function drawTargets() {
    for (const t of tanks) {
        const x = t.x - scrollX;
        if (!t.alive || x < -30 || x > CANVAS_W + 30) continue;
        ctx.fillStyle = COL_TANK;
        ctx.fillRect(x - 9, t.y - 20, 18, 20);
        ctx.fillStyle = '#7a4d10';
        ctx.fillRect(x - 9, t.y - 13, 18, 4);
        ctx.fillStyle = '#2a1a05';
        ctx.font = 'bold 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('F', x, t.y - 3);
    }

    for (const r of rockets) {
        const x = r.x - scrollX;
        if (!r.alive || x < -30 || x > CANVAS_W + 30) continue;
        ctx.fillStyle = COL_ROCKET;
        ctx.beginPath();
        ctx.moveTo(x, r.y - 26);
        ctx.lineTo(x + 7, r.y - 6);
        ctx.lineTo(x - 7, r.y - 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#8c2f24';
        ctx.fillRect(x - 8, r.y - 6, 16, 6);
        if (r.launched) {
            ctx.fillStyle = '#ffd166';
            ctx.beginPath();
            ctx.moveTo(x - 4, r.y);
            ctx.lineTo(x + 4, r.y);
            ctx.lineTo(x, r.y + 12);
            ctx.closePath();
            ctx.fill();
        }
    }
}

function drawShots() {
    ctx.fillStyle = '#8ef7ff';
    for (const b of bullets) ctx.fillRect(b.x - scrollX - 6, b.y - 1.5, 12, 3);
    ctx.fillStyle = '#ffd166';
    for (const b of bombs) {
        ctx.beginPath();
        ctx.arc(b.x - scrollX, b.y, 4, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawShip() {
    const x = ship.x - scrollX;
    const y = ship.y;
    ctx.fillStyle = '#ff8a3d';
    ctx.beginPath();
    ctx.moveTo(x - SHIP_HW, y - 3);
    ctx.lineTo(x - SHIP_HW - 10 - Math.random() * 6, y);
    ctx.lineTo(x - SHIP_HW, y + 3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = COL_SHIP;
    ctx.beginPath();
    ctx.moveTo(x + SHIP_HW, y);
    ctx.lineTo(x - SHIP_HW, y - SHIP_HH);
    ctx.lineTo(x - SHIP_HW + 6, y);
    ctx.lineTo(x - SHIP_HW, y + SHIP_HH);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#4aa3ff';
    ctx.fillRect(x - 2, y - 3, 8, 3);
}

function drawBlasts() {
    for (const p of blasts) {
        ctx.globalAlpha = Math.max(0, p.life / 0.5);
        ctx.fillStyle = p.life > 0.3 ? '#fff1a8' : '#ef5b4c';
        ctx.beginPath();
        ctx.arc(p.x - scrollX, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawProgress() {
    const w = CANVAS_W - 24;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(12, CANVAS_H - 10, w, 4);
    ctx.fillStyle = COL_ROCK_EDGE;
    ctx.fillRect(12, CANVAS_H - 10, w * progress(), 4);
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    fuelEl.textContent = String(Math.max(0, Math.floor(fuel)));
    fuelBarEl.style.width = `${Math.max(0, Math.min(100, (fuel / FUEL_MAX) * 100))}%`;
    bestEl.textContent = String(best);
}

function showOverlay(title, sub, hint) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub;
    overlaySub.textContent = hint;
    overlay.classList.add('visible');
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Game';
}

function hideOverlay() {
    overlay.classList.remove('visible');
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

function refreshDir() {
    const held = (keys) => keys.some((k) => heldKeys.has(k));
    ship.dir.x = (held(RIGHT_KEYS) ? 1 : 0) - (held(LEFT_KEYS) ? 1 : 0);
    ship.dir.y = (held(DOWN_KEYS) ? 1 : 0) - (held(UP_KEYS) ? 1 : 0);
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

best = parseInt(localStorage.getItem('scramble-best') || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
fuel = FUEL_MAX;
pauseTimer = 0;
buildLevel(level);
updateHud();
showOverlay('SCRAMBLE', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
