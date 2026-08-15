// ---------------------------------------------------------------------------
// Scramble — fly a jet through a scrolling cavern, bomb the fuel dumps that
// keep you airborne and reach the base at the end of the run.
//
// Everything lives in the top-level script scope so the Playwright suite can
// poke at the simulation directly (`step(dt)`, `ship`, `terrain`, ...) instead
// of racing the animation loop.
// ---------------------------------------------------------------------------

// --- World -----------------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 400;
const COL_W = 20;                       // terrain is a heightmap of columns
const LEVEL_COLS = 320;
const LEVEL_LENGTH = LEVEL_COLS * COL_W;
const FINISH_X = LEVEL_LENGTH - 120;    // the landing strip at the far end
const MIN_GAP = 130;                    // the cave is never tighter than this
const INTRO_COLS = 10;                  // flat, open runway to take off from
const OUTRO_COLS = 10;                  // ...and to land on
const TERRAIN_EASE = 0.16;              // how fast the rock walks to its target
const TERRAIN_STEP = 8;                 // columns between new rock targets
const LEVEL_SEED = 1337;                // one fixed cave, so runs are learnable

const ZONES = ['CAVERNS', 'PEAKS', 'TUNNEL', 'CITY'];
const ZONE_COLS = LEVEL_COLS / ZONES.length;
const ZONE_PROFILES = [
    { groundMin: 40, groundMax: 105, ceilMin: 0, ceilMax: 18 },
    { groundMin: 60, groundMax: 170, ceilMin: 0, ceilMax: 34 },
    { groundMin: 45, groundMax: 115, ceilMin: 40, ceilMax: 110 },
    { groundMin: 70, groundMax: 155, ceilMin: 8, ceilMax: 55 },
];

// --- Ship ------------------------------------------------------------------
const SHIP_W = 30;
const SHIP_H = 14;
const SHIP_SPEED = 168;                 // px/s of pilot input
const SCROLL_SPEED = 92;                // px/s the world drags you forward
const SHIP_MIN_SCREEN = 40;             // how far back you may drop
const SHIP_MAX_SCREEN = 400;            // ...and how far forward you may push
const START_X = 140;

// --- Fuel ------------------------------------------------------------------
const FUEL_MAX = 100;
const FUEL_RATE = 2.2;                  // units burned per second
const FUEL_PER_TANK = 22;               // only bombs crack a tank open

// --- Weapons ---------------------------------------------------------------
const LASER_SPEED = 430;
const LASER_MAX = 4;
const LASER_COOLDOWN = 0.16;
const BOMB_MAX = 3;
const BOMB_COOLDOWN = 0.3;
const BOMB_VX = 80;
const BOMB_VY = 30;
const BOMB_GRAVITY = 400;

// --- Enemies ---------------------------------------------------------------
const TANK_W = 22;
const TANK_H = 16;
const ROCKET_W = 14;
const ROCKET_H = 20;
const ROCKET_TRIGGER = 210;             // rockets wake when you get this close
const ROCKET_SPEED = 78;
const UFO_W = 26;
const UFO_H = 12;
const UFO_SPEED = 55;
const ACTIVE_RANGE = 900;               // enemies only think near the camera

// --- Scoring ---------------------------------------------------------------
const SCORE_TANK = 80;
const SCORE_ROCKET = 50;
const SCORE_UFO = 100;
const SCORE_FINISH = 1000;
const FUEL_BONUS = 5;                   // points per unit of fuel left over
const LIVES_START = 3;
const DEATH_DELAY = 1.2;
const BEST_KEY = 'scramble-best';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const zoneEl = document.getElementById('zone');
const fuelEl = document.getElementById('fuel');
const fuelBar = document.getElementById('fuel-bar');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Mutable state
// ---------------------------------------------------------------------------
let state;                              // idle | running | paused | dead | over | won
let score, best, lives, fuel;
let camX, checkpointX, zoneIndex, deathTimer;
let laserCooldown, bombCooldown;
let keyX = 0, keyY = 0;

const ship = { x: START_X, y: CANVAS_H / 2, alive: true };
const bullets = [];
const bombs = [];
const sparks = [];
let terrain = { ceiling: [], ground: [] };
let entities = [];
let stars = [];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Level generation — a tiny LCG keeps the cave identical between runs (and
// between test assertions) while still looking hand-carved.
// ---------------------------------------------------------------------------
function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function generateTerrain(seed) {
    const rnd = makeRng(seed);
    const ceiling = new Array(LEVEL_COLS);
    const ground = new Array(LEVEL_COLS);
    let g = 70, c = 0, gTarget = 70, cTarget = 0;

    for (let i = 0; i < LEVEL_COLS; i++) {
        const profile = ZONE_PROFILES[Math.min(ZONES.length - 1, Math.floor(i / ZONE_COLS))];
        if (i % TERRAIN_STEP === 0) {
            gTarget = profile.groundMin + rnd() * (profile.groundMax - profile.groundMin);
            cTarget = profile.ceilMin + rnd() * (profile.ceilMax - profile.ceilMin);
        }
        g += (gTarget - g) * TERRAIN_EASE;
        c += (cTarget - c) * TERRAIN_EASE;

        if (i < INTRO_COLS || i >= LEVEL_COLS - OUTRO_COLS) { g = 70; c = 0; }

        let gg = Math.round(g);
        let cc = Math.round(c);
        // Never carve a passage the jet cannot physically fit through.
        const squeeze = MIN_GAP - (CANVAS_H - cc - gg);
        if (squeeze > 0) {
            const fromCeiling = Math.min(cc, Math.ceil(squeeze / 2));
            cc -= fromCeiling;
            gg -= squeeze - fromCeiling;
        }
        ceiling[i] = Math.max(0, cc);
        ground[i] = Math.max(0, gg);
    }
    return { ceiling, ground };
}

function generateEntities(seed, terr) {
    const rnd = makeRng(seed ^ 0x9e3779b9);
    const list = [];
    for (let i = INTRO_COLS + 4; i < LEVEL_COLS - OUTRO_COLS; i += 2) {
        const x = i * COL_W;
        const groundY = CANVAS_H - terr.ground[i];
        const ceilingY = terr.ceiling[i];
        const roll = rnd();

        if (roll < 0.17) {
            list.push({ type: 'tank', x, y: groundY - TANK_H, w: TANK_W, h: TANK_H, alive: true });
        } else if (roll < 0.32) {
            list.push({
                type: 'rocket', x: x + 3, y: groundY - ROCKET_H,
                w: ROCKET_W, h: ROCKET_H, alive: true, launched: false,
            });
        } else if (roll < 0.39 && i > ZONE_COLS) {
            const top = ceilingY + 16;
            const bottom = groundY - UFO_H - 34;
            const y = bottom > top ? top + rnd() * (bottom - top) : top;
            list.push({
                type: 'ufo', x, y, w: UFO_W, h: UFO_H, alive: true,
                baseY: y, phase: rnd() * Math.PI * 2,
            });
        }
    }
    return list;
}

function generateStars(seed) {
    const rnd = makeRng(seed ^ 0x2545f491);
    const list = [];
    for (let i = 0; i < 140; i++) {
        list.push({
            x: rnd() * LEVEL_LENGTH,
            y: rnd() * (CANVAS_H - 120),
            depth: 0.25 + rnd() * 0.45,
            size: rnd() < 0.8 ? 1 : 2,
        });
    }
    return list;
}

function generateLevel(seed) {
    terrain = generateTerrain(seed);
    entities = generateEntities(seed, terrain);
    stars = generateStars(seed);
}

// ---------------------------------------------------------------------------
// Terrain queries
// ---------------------------------------------------------------------------
function colIndex(worldX) {
    return clamp(Math.floor(worldX / COL_W), 0, LEVEL_COLS - 1);
}

function terrainAt(worldX) {
    const i = colIndex(worldX);
    return { ceilingY: terrain.ceiling[i], groundY: CANVAS_H - terrain.ground[i] };
}

function hitsTerrain(x, y, w, h) {
    const from = colIndex(x);
    const to = colIndex(x + w);
    for (let i = from; i <= to; i++) {
        if (y < terrain.ceiling[i] || y + h > CANVAS_H - terrain.ground[i]) return true;
    }
    return false;
}

function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ---------------------------------------------------------------------------
// Ship placement
// ---------------------------------------------------------------------------
function placeShipAt(worldX) {
    ship.x = worldX;
    ship.y = middleOfCave(worldX);
    ship.alive = true;
    camX = worldX - 100;
}

function middleOfCave(worldX) {
    const t = terrainAt(worldX + SHIP_W / 2);
    return (t.ceilingY + t.groundY) / 2 - SHIP_H / 2;
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------
function fireLaser() {
    if (state !== 'running' || laserCooldown > 0 || bullets.length >= LASER_MAX) return false;
    bullets.push({ x: ship.x + SHIP_W, y: ship.y + SHIP_H / 2, vx: LASER_SPEED });
    laserCooldown = LASER_COOLDOWN;
    return true;
}

function dropBomb() {
    if (state !== 'running' || bombCooldown > 0 || bombs.length >= BOMB_MAX) return false;
    bombs.push({ x: ship.x + SHIP_W / 2, y: ship.y + SHIP_H, vx: BOMB_VX, vy: BOMB_VY });
    bombCooldown = BOMB_COOLDOWN;
    return true;
}

function burst(x, y, colour, count) {
    for (let i = 0; i < count; i++) {
        const a = (Math.PI * 2 * i) / count;
        const speed = 60 + (i % 4) * 34;
        sparks.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 0.5, colour });
    }
}

function killEntity(e, byBomb) {
    e.alive = false;
    if (e.type === 'tank') {
        score += SCORE_TANK;
        if (byBomb) fuel = Math.min(FUEL_MAX, fuel + FUEL_PER_TANK);
        burst(e.x + e.w / 2, e.y + e.h / 2, byBomb ? '#ffd166' : '#ff8f4d', 12);
    } else if (e.type === 'rocket') {
        score += SCORE_ROCKET;
        burst(e.x + e.w / 2, e.y + e.h / 2, '#ff6b6b', 10);
    } else {
        score += SCORE_UFO;
        burst(e.x + e.w / 2, e.y + e.h / 2, '#9af7ff', 10);
    }
}

function hitEntityAt(x, y, w, h, byBomb) {
    for (const e of entities) {
        if (!e.alive) continue;
        if (overlaps(x, y, w, h, e.x, e.y, e.w, e.h)) {
            killEntity(e, byBomb);
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function step(dt) {
    if (state === 'dead') {
        updateSparks(dt);
        deathTimer -= dt;
        if (deathTimer <= 0) respawn();
        return;
    }
    if (state !== 'running') return;

    camX += SCROLL_SPEED * dt;
    ship.x += (SCROLL_SPEED + keyX * SHIP_SPEED) * dt;
    ship.y += keyY * SHIP_SPEED * dt;
    ship.x = clamp(ship.x, camX + SHIP_MIN_SCREEN, camX + SHIP_MAX_SCREEN);
    ship.y = clamp(ship.y, 0, CANVAS_H - SHIP_H);

    fuel -= FUEL_RATE * dt;
    if (fuel <= 0) {
        fuel = 0;
        crash();
        return;
    }

    laserCooldown = Math.max(0, laserCooldown - dt);
    bombCooldown = Math.max(0, bombCooldown - dt);

    updateBullets(dt);
    updateBombs(dt);
    updateEntities(dt);
    updateSparks(dt);
    updateCheckpoint();

    if (hitsTerrain(ship.x, ship.y, SHIP_W, SHIP_H)
        || hitEntityAt(ship.x, ship.y, SHIP_W, SHIP_H, false)) {
        crash();
        return;
    }

    if (ship.x >= FINISH_X) {
        winMission();
        return;
    }

    updateHud();
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        const t = terrainAt(b.x);
        const gone = b.x > camX + CANVAS_W + 24 || b.x < camX - 24
            || b.y <= t.ceilingY || b.y >= t.groundY;
        if (gone || hitEntityAt(b.x - 3, b.y - 1, 6, 3, false)) bullets.splice(i, 1);
    }
}

function updateBombs(dt) {
    for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.vy += BOMB_GRAVITY * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        if (hitEntityAt(b.x - 4, b.y - 4, 8, 8, true)) {
            bombs.splice(i, 1);
            continue;
        }
        const t = terrainAt(b.x);
        if (b.y >= t.groundY || b.y <= t.ceilingY
            || b.x < camX - 24 || b.x > camX + CANVAS_W + 40) {
            burst(b.x, b.y, '#ffb020', 8);
            bombs.splice(i, 1);
        }
    }
}

function updateEntities(dt) {
    for (const e of entities) {
        if (!e.alive) continue;
        if (e.x < camX - 200 || e.x > camX + ACTIVE_RANGE) continue;

        if (e.type === 'rocket') {
            if (!e.launched && Math.abs(e.x - ship.x) < ROCKET_TRIGGER) e.launched = true;
            if (e.launched) {
                e.y -= ROCKET_SPEED * dt;
                if (e.y + e.h < -10) e.alive = false;
            }
        } else if (e.type === 'ufo') {
            e.x -= UFO_SPEED * dt;
            e.phase += dt * 2.2;
            const t = terrainAt(e.x + e.w / 2);
            e.y = clamp(e.baseY + Math.sin(e.phase) * 26,
                t.ceilingY + 4, t.groundY - e.h - 4);
            if (e.x + e.w < camX - 60) e.alive = false;
        }
    }
}

function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 180 * dt;
        if (s.life <= 0) sparks.splice(i, 1);
    }
}

function updateCheckpoint() {
    const zone = Math.min(ZONES.length - 1, Math.floor(colIndex(ship.x) / ZONE_COLS));
    if (zone > zoneIndex) {
        zoneIndex = zone;
        checkpointX = zone * ZONE_COLS * COL_W + 40;
    }
}

// ---------------------------------------------------------------------------
// Life cycle
// ---------------------------------------------------------------------------
function crash() {
    if (state !== 'running') return;
    ship.alive = false;
    lives -= 1;
    state = 'dead';
    deathTimer = DEATH_DELAY;
    bullets.length = 0;
    bombs.length = 0;
    burst(ship.x + SHIP_W / 2, ship.y + SHIP_H / 2, '#ff5a5a', 18);
    updateHud();
}

function respawn() {
    if (lives <= 0) {
        gameOver();
        return;
    }
    placeShipAt(checkpointX);
    fuel = FUEL_MAX;
    laserCooldown = 0;
    bombCooldown = 0;
    bullets.length = 0;
    bombs.length = 0;
    for (const e of entities) {
        if (e.alive && e.type === 'rocket' && e.launched) {
            e.launched = false;
            e.y = terrainAt(e.x + e.w / 2).groundY - e.h;
        }
    }
    state = 'running';
    hideOverlay();
    updateHud();
}

function startGame() {
    generateLevel(LEVEL_SEED);
    score = 0;
    lives = LIVES_START;
    fuel = FUEL_MAX;
    zoneIndex = 0;
    checkpointX = START_X;
    laserCooldown = 0;
    bombCooldown = 0;
    deathTimer = 0;
    bullets.length = 0;
    bombs.length = 0;
    sparks.length = 0;
    placeShipAt(START_X);
    state = 'running';
    hideOverlay();
    updateHud();
}

function gameOver() {
    state = 'over';
    lives = 0;
    saveBest();
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to fly again', 'Fly Again');
}

function winMission() {
    state = 'won';
    score += SCORE_FINISH + Math.round(fuel) * FUEL_BONUS;
    saveBest();
    updateHud();
    showOverlay('MISSION COMPLETE', `Score ${score}`, 'Press Space to fly again', 'Fly Again');
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

function saveBest() {
    if (score > best) {
        best = score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (err) { /* private mode */ }
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------
function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
    livesEl.textContent = Math.max(0, lives);
    zoneEl.textContent = ZONES[zoneIndex];
    fuelEl.textContent = Math.round(fuel);
    fuelBar.style.width = `${clamp(fuel / FUEL_MAX, 0, 1) * 100}%`;
    fuelBar.classList.toggle('low', fuel <= 25);
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
// Rendering
// ---------------------------------------------------------------------------
function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawSky();
    drawStars();
    drawTerrain();
    drawEntities();
    drawBombs();
    drawBullets();
    if (ship.alive && state !== 'idle') drawShip();
    drawSparks();
    if (state === 'idle') drawTitleHint();
}

function drawSky() {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#0a1730');
    grad.addColorStop(1, '#050a16');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawStars() {
    ctx.fillStyle = '#8fa8d8';
    for (const s of stars) {
        const x = s.x - camX * s.depth;
        const wrapped = ((x % LEVEL_LENGTH) + LEVEL_LENGTH) % LEVEL_LENGTH;
        if (wrapped > CANVAS_W) continue;
        ctx.globalAlpha = 0.25 + s.depth * 0.6;
        ctx.fillRect(wrapped, s.y, s.size, s.size);
    }
    ctx.globalAlpha = 1;
}

function drawTerrain() {
    const first = colIndex(camX) - 1;
    const last = colIndex(camX + CANVAS_W) + 1;

    ctx.fillStyle = '#1d3a2a';
    ctx.strokeStyle = '#4ce08a';
    ctx.lineWidth = 2;

    // Ground
    ctx.beginPath();
    ctx.moveTo(first * COL_W - camX, CANVAS_H);
    for (let i = Math.max(0, first); i <= Math.min(LEVEL_COLS - 1, last); i++) {
        const x = i * COL_W - camX;
        const y = CANVAS_H - terrain.ground[i];
        ctx.lineTo(x, y);
        ctx.lineTo(x + COL_W, y);
    }
    ctx.lineTo(last * COL_W - camX, CANVAS_H);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Ceiling
    ctx.fillStyle = '#26243d';
    ctx.strokeStyle = '#7a76c8';
    ctx.beginPath();
    ctx.moveTo(first * COL_W - camX, 0);
    for (let i = Math.max(0, first); i <= Math.min(LEVEL_COLS - 1, last); i++) {
        const x = i * COL_W - camX;
        const y = terrain.ceiling[i];
        ctx.lineTo(x, y);
        ctx.lineTo(x + COL_W, y);
    }
    ctx.lineTo(last * COL_W - camX, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Landing strip
    const padX = FINISH_X - camX;
    if (padX < CANVAS_W && padX > -200) {
        ctx.fillStyle = '#58e2ff';
        ctx.fillRect(padX, CANVAS_H - terrain.ground[colIndex(FINISH_X)] - 4, 120, 4);
    }
}

function drawEntities() {
    for (const e of entities) {
        if (!e.alive) continue;
        const x = e.x - camX;
        if (x < -60 || x > CANVAS_W + 60) continue;

        if (e.type === 'tank') {
            ctx.fillStyle = '#ffb020';
            ctx.fillRect(x, e.y, e.w, e.h);
            ctx.fillStyle = '#7a4a00';
            ctx.fillRect(x + 4, e.y + 4, e.w - 8, 4);
            ctx.fillStyle = '#fff3d0';
            ctx.font = 'bold 9px monospace';
            ctx.fillText('F', x + e.w / 2 - 3, e.y + e.h - 3);
        } else if (e.type === 'rocket') {
            ctx.fillStyle = e.launched ? '#ff8f8f' : '#c8d2e8';
            ctx.beginPath();
            ctx.moveTo(x + e.w / 2, e.y);
            ctx.lineTo(x + e.w, e.y + e.h);
            ctx.lineTo(x, e.y + e.h);
            ctx.closePath();
            ctx.fill();
            if (e.launched) {
                ctx.fillStyle = '#ffcf6b';
                ctx.fillRect(x + e.w / 2 - 2, e.y + e.h, 4, 6);
            }
        } else {
            ctx.fillStyle = '#9af7ff';
            ctx.beginPath();
            ctx.ellipse(x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#2a6f88';
            ctx.fillRect(x + 6, e.y + e.h / 2 - 1, e.w - 12, 2);
        }
    }
}

function drawBullets() {
    ctx.fillStyle = '#fdfd96';
    for (const b of bullets) ctx.fillRect(b.x - camX, b.y - 1, 10, 2);
}

function drawBombs() {
    ctx.fillStyle = '#ffb020';
    for (const b of bombs) {
        ctx.beginPath();
        ctx.arc(b.x - camX, b.y, 4, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawShip() {
    const x = ship.x - camX;
    const y = ship.y;

    // exhaust
    ctx.fillStyle = '#ff9f43';
    ctx.beginPath();
    ctx.moveTo(x - 2, y + SHIP_H / 2);
    ctx.lineTo(x - 12 - Math.random() * 5, y + SHIP_H / 2);
    ctx.lineTo(x - 2, y + SHIP_H / 2 + 3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#e7edf9';
    ctx.beginPath();
    ctx.moveTo(x + SHIP_W, y + SHIP_H / 2);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x, y + SHIP_H / 2);
    ctx.lineTo(x + 6, y + SHIP_H);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#58e2ff';
    ctx.fillRect(x + 8, y + SHIP_H / 2 - 2, 10, 4);
}

function drawSparks() {
    for (const s of sparks) {
        ctx.globalAlpha = clamp(s.life / 0.5, 0, 1);
        ctx.fillStyle = s.colour;
        ctx.fillRect(s.x - camX - 1, s.y - 1, 3, 3);
    }
    ctx.globalAlpha = 1;
}

function drawTitleHint() {
    ctx.fillStyle = 'rgba(88, 226, 255, 0.35)';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('BOMB THE FUEL DUMPS', 20, 30);
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
const held = new Set();
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];
const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const MOVE_KEYS = [...UP_KEYS, ...DOWN_KEYS, ...LEFT_KEYS, ...RIGHT_KEYS];

function refreshInput() {
    const any = (keys) => keys.some((k) => held.has(k));
    keyY = (any(DOWN_KEYS) ? 1 : 0) - (any(UP_KEYS) ? 1 : 0);
    keyX = (any(RIGHT_KEYS) ? 1 : 0) - (any(LEFT_KEYS) ? 1 : 0);
}

window.addEventListener('keydown', (e) => {
    if (MOVE_KEYS.includes(e.key)) {
        held.add(e.key);
        refreshInput();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.code === 'Space') {
        if (state === 'running') fireLaser();
        else if (state !== 'paused' && state !== 'dead') startGame();
        e.preventDefault();
    } else if (e.key === 'b' || e.key === 'B' || e.key === 'x' || e.key === 'X') {
        dropBomb();
        e.preventDefault();
    } else if (e.key === 'p' || e.key === 'P') {
        togglePause();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (held.has(e.key)) {
        held.delete(e.key);
        refreshInput();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
generateLevel(LEVEL_SEED);
state = 'idle';
score = 0;
lives = LIVES_START;
fuel = FUEL_MAX;
zoneIndex = 0;
checkpointX = START_X;
deathTimer = 0;
laserCooldown = 0;
bombCooldown = 0;
camX = START_X - 100;
ship.x = START_X;
ship.y = middleOfCave(START_X);
updateHud();
requestAnimationFrame(frame);
