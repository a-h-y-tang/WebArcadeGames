// ---------------------------------------------------------------------------
// Canyon Raider — a vertically scrolling river-canyon flight shooter.
//
// You fly a jet up a winding river. The canyon walls are lethal, so is anything
// floating or flying in the water lane, and the tank drains the whole time —
// the only way to keep going is to skim the fuel depots moored in the river.
// Bridges seal each section of the canyon: blow one up and the next section
// opens, a little faster and a little busier than the last.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Slime Volley,
// Kaboom and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)` in fixed sub-steps, so tests can simulate frames
// deterministically without depending on requestAnimationFrame timing.
//
// Coordinates: the canvas is the window, but the canyon lives in a *world* whose
// y axis grows in the direction of flight. `scroll` is how far the world has
// slid past the bottom of the canvas, so screen y = CANVAS_H - (worldY - scroll)
// and the plane — pinned to a fixed screen row — climbs steadily through world
// space. Everything in the canyon is stored in world coordinates, which means
// scrolling is a single number and nothing has to be nudged frame by frame.
// ---------------------------------------------------------------------------

// --- Canvas ---
const CANVAS_W = 480;
const CANVAS_H = 640;

// --- Canyon geometry ---
const ROW_H = 16;                   // one generated slice of river
const BANK_MARGIN = 12;             // rock is always at least this thick
const MIN_RIVER_W = 110;
const MAX_RIVER_W = 330;
const LOOKAHEAD = 480;              // world px of canyon kept ready above the view
const SECTION_ROWS = 110;           // rows between bridges

// --- Plane ---
const PLANE_Y = 560;                // fixed screen row the plane flies on
const PLANE_W = 30;
const PLANE_H = 34;
const PLANE_SPEED = 260;            // px/s of sideways steering

// --- Flight ---
const MIN_SPEED = 120;              // px/s of scroll at idle throttle
const BASE_SPEED = 190;
const MAX_SPEED = 320;
const THROTTLE_RATE = 150;          // px/s² the throttle changes speed by

// --- Weapons ---
const BULLET_SPEED = 520;           // px/s up the screen
const BULLET_W = 3;
const BULLET_H = 12;
const MAX_BULLETS = 6;

// --- Fuel ---
const MAX_FUEL = 100;
const FUEL_BURN = 5.2;              // units/s at base speed (scales with throttle)
const FUEL_REFILL = 42;             // units/s while skimming a depot

// --- Scoring ---
const SHIP_SCORE = 30;
const CHOPPER_SCORE = 60;
const FUEL_SCORE = 80;
const BRIDGE_SCORE = 500;

// --- Lives ---
const START_LIVES = 3;
const RESPAWN_DELAY = 1.2;          // seconds the wreck burns before you fly again
const CLEAR_AHEAD = 520;            // world px swept clear when you respawn
const START_SAFE = 700;             // ...and at the start of a run

// --- Entity sizes ---
const SIZES = {
    ship: { w: 54, h: 16 },
    chopper: { w: 40, h: 18 },
    fuel: { w: 26, h: 40 },
    bridge: { w: CANVAS_W, h: 26 },
};

const SCORES = {
    ship: SHIP_SCORE,
    chopper: CHOPPER_SCORE,
    fuel: FUEL_SCORE,
    bridge: BRIDGE_SCORE,
};

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const sectionEl = document.getElementById('section');
const distanceEl = document.getElementById('distance');
const fuelBar = document.getElementById('fuel-bar');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'crashed' | 'over'
let state, score, best, lives, section, fuel, scroll, scrollSpeed;
let crashTimer, spawnBlockUntil, lastSpawnRow, throttleInput, elapsed;
const plane = { x: CANVAS_W / 2, y: PLANE_Y, dir: 0 };
const rows = [];                    // one entry per ROW_H of canyon, index 0 = start
const entities = [];
const bullets = [];
const particles = [];

// Generation cursors (advanced only by `generateRow`).
let genCenter, genWidth, genTargetCenter, genTargetWidth, genHold;
let terrainRng, entityRng;

// ---------------------------------------------------------------------------
// Deterministic randomness
//
// A tiny mulberry32 so a seed reproduces a canyon exactly. Terrain and entity
// placement draw from *separate* streams: whether a gunboat gets skipped near a
// respawn must never shift the shape of the river.
// ---------------------------------------------------------------------------

function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function rng() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (rng, lo, hi) => lo + rng() * (hi - lo);

// A stateless hash in [0, 1) — used by the renderer for scenery that must look
// random but stay put as the canyon scrolls past.
function hash01(n) {
    let x = (n ^ 0x27d4eb2d) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
    x = Math.imul(x ^ (x >>> 12), 0x297a2d39) >>> 0;
    return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// World <-> screen
// ---------------------------------------------------------------------------

function screenY(worldY) {
    return CANVAS_H - (worldY - scroll);
}

function planeWorldY() {
    return scroll + (CANVAS_H - PLANE_Y);
}

function rowIndexAtWorld(worldY) {
    return Math.floor(worldY / ROW_H);
}

// The banks at a given world height. Rows are generated on demand so callers
// (including the tests) can ask about canyon that is still off-screen.
function riverBoundsAtWorld(worldY) {
    const idx = clamp(rowIndexAtWorld(worldY), 0, Number.MAX_SAFE_INTEGER);
    while (rows.length <= idx) generateRow();
    return rows[idx];
}

// ---------------------------------------------------------------------------
// Canyon generation
//
// The river is a random walk with inertia: every so often the generator picks a
// new target centre and width, then eases towards it a fraction of a pixel per
// row. Slow drift is what makes the canyon flyable — a wall never appears
// somewhere the plane could not have steered away from.
// ---------------------------------------------------------------------------

const MAX_CENTER_DRIFT = 0.5;       // px per row
const MAX_WIDTH_DRIFT = 1.0;        // px per row

function generateRow() {
    const index = rows.length;
    const isBridgeRow = index > 0 && index % SECTION_ROWS === 0;

    if (genHold <= 0) {
        genTargetWidth = rand(terrainRng, MIN_RIVER_W + 10, MAX_RIVER_W - 10);
        genTargetCenter = rand(terrainRng, BANK_MARGIN + genTargetWidth / 2,
            CANVAS_W - BANK_MARGIN - genTargetWidth / 2);
        genHold = Math.floor(rand(terrainRng, 22, 60));
    }
    genHold--;

    // Bridges span a calm, straight stretch so they are always shootable.
    if (isBridgeRow) {
        genTargetWidth = clamp(genTargetWidth, MIN_RIVER_W + 40, MAX_RIVER_W - 60);
        genTargetCenter = CANVAS_W / 2;
        genHold = 10;
    }

    genWidth += clamp(genTargetWidth - genWidth, -MAX_WIDTH_DRIFT, MAX_WIDTH_DRIFT);
    genCenter += clamp(genTargetCenter - genCenter, -MAX_CENTER_DRIFT, MAX_CENTER_DRIFT);
    genWidth = clamp(genWidth, MIN_RIVER_W, MAX_RIVER_W);
    genCenter = clamp(genCenter, BANK_MARGIN + genWidth / 2, CANVAS_W - BANK_MARGIN - genWidth / 2);

    const row = {
        left: genCenter - genWidth / 2,
        right: genCenter + genWidth / 2,
        bridge: isBridgeRow,
    };
    rows.push(row);
    populateRow(index, row);
    return row;
}

// Decide what — if anything — is moored in a freshly generated row.
function populateRow(index, row) {
    const worldY = index * ROW_H + ROW_H / 2;
    const roll = entityRng();               // always drawn, so streams stay aligned
    const place = entityRng();
    if (worldY < spawnBlockUntil) return;   // start line / respawn breathing room

    if (row.bridge) {
        spawnEntityAt('bridge', CANVAS_W / 2, worldY);
        lastSpawnRow = index;
        return;
    }
    if (index - lastSpawnRow < 7) return;

    const busy = Math.min(0.06 + section * 0.008, 0.11);
    let type = null;
    if (roll < busy) type = 'ship';
    else if (roll < busy * 1.7) type = 'chopper';
    else if (roll < busy * 2.3) type = 'fuel';
    if (!type) return;

    const size = SIZES[type];
    const span = row.right - row.left - size.w - 8;
    if (span <= 0) return;
    spawnEntityAt(type, row.left + 4 + size.w / 2 + place * span, worldY);
    lastSpawnRow = index;
}

// Put one thing in the canyon. Also the hook the tests use to stage a scene.
function spawnEntityAt(type, x, worldY) {
    const size = SIZES[type];
    const speed = type === 'chopper' ? rand(entityRng, 55, 95) : rand(entityRng, 30, 60);
    const entity = {
        type,
        x,
        worldY,
        w: size.w,
        h: size.h,
        vx: type === 'ship' || type === 'chopper' ? speed * (entityRng() < 0.5 ? -1 : 1) * (1 + section * 0.08) : 0,
        alive: true,
        phase: entityRng() * Math.PI * 2,
    };
    entities.push(entity);
    return entity;
}

function fillCanyon() {
    const need = scroll + CANVAS_H + LOOKAHEAD;
    while (rows.length * ROW_H < need) generateRow();
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function movePlane(dir) {
    plane.dir = dir;
}

function setThrottle(dir) {
    throttleInput = dir;
}

function fire() {
    if (state !== 'running') return null;
    if (bullets.length >= MAX_BULLETS) return null;
    const bullet = { x: plane.x, worldY: planeWorldY() + PLANE_H / 2 };
    bullets.push(bullet);
    return bullet;
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', 'Press P or click Resume to keep flying', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function startGame(seed) {
    const s = seed === undefined ? Math.floor(Math.random() * 0x7fffffff) : seed;
    terrainRng = makeRng(s);
    entityRng = makeRng(s + 0x9e3779b9);

    rows.length = 0;
    entities.length = 0;
    bullets.length = 0;
    particles.length = 0;

    score = 0;
    lives = START_LIVES;
    section = 1;
    fuel = MAX_FUEL;
    scroll = 0;
    elapsed = 0;
    scrollSpeed = BASE_SPEED;
    throttleInput = 0;
    crashTimer = 0;
    lastSpawnRow = -99;
    spawnBlockUntil = START_SAFE;

    genWidth = 240;
    genCenter = CANVAS_W / 2;
    genTargetWidth = 240;
    genTargetCenter = CANVAS_W / 2;
    genHold = 24;

    fillCanyon();
    plane.dir = 0;
    const bounds = riverBoundsAtWorld(planeWorldY());
    plane.x = (bounds.left + bounds.right) / 2;

    state = 'running';
    hideOverlay();
    updateHud();
}

function crash() {
    if (state !== 'running') return;
    lives--;
    state = 'crashed';
    crashTimer = RESPAWN_DELAY;
    burst(plane.x, PLANE_Y, 26, '#ffb347');
    bullets.length = 0;
    updateHud();
}

function respawn() {
    const worldY = planeWorldY();
    const bounds = riverBoundsAtWorld(worldY);
    plane.x = (bounds.left + bounds.right) / 2;
    plane.dir = 0;
    fuel = MAX_FUEL;
    scrollSpeed = BASE_SPEED;
    throttleInput = 0;

    // Sweep the stretch you are about to fly through, and hold off new spawns
    // until past it, so you never respawn straight into a gunboat.
    spawnBlockUntil = worldY + CLEAR_AHEAD;
    for (let i = entities.length - 1; i >= 0; i--) {
        const e = entities[i];
        if (e.worldY > worldY - 120 && e.worldY < spawnBlockUntil) entities.splice(i, 1);
    }
    state = 'running';
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem('canyon-raider-best', String(best));
        } catch (err) {
            /* storage unavailable — the score just isn't remembered */
        }
    }
    updateHud();
    showOverlay('GAME OVER', 'Press Space or click Fly Again for a new canyon', 'Fly Again',
        `Score ${score} · Section ${section} · ${Math.floor(scroll / 10)} km`);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const MAX_SUBSTEP = 1 / 120;

function step(dt) {
    const total = Math.min(Math.max(dt, 0), 0.05);
    if (state === 'crashed') {
        crashTimer -= total;
        updateParticles(total);
        if (crashTimer <= 0) {
            if (lives > 0) respawn();
            else gameOver();
        }
        return;
    }
    if (state !== 'running') return;

    let remaining = total;
    while (remaining > 0) {
        const h = Math.min(remaining, MAX_SUBSTEP);
        tick(h);
        remaining -= h;
        if (state !== 'running') break;      // a crash ends the frame early
    }
    updateParticles(total);
    updateHud();
}

function tick(dt) {
    elapsed += dt;

    // Throttle and scroll.
    scrollSpeed = clamp(scrollSpeed + throttleInput * THROTTLE_RATE * dt, MIN_SPEED, MAX_SPEED);
    scroll += scrollSpeed * dt;
    fillCanyon();

    // Steering.
    plane.x = clamp(plane.x + plane.dir * PLANE_SPEED * dt, PLANE_W / 2, CANVAS_W - PLANE_W / 2);

    // Fuel burns faster the harder you push the throttle.
    fuel -= FUEL_BURN * (scrollSpeed / BASE_SPEED) * dt;

    updateEntities(dt);
    updateBullets(dt);
    collidePlane();
    if (state !== 'running') return;

    if (fuel <= 0) {
        fuel = 0;
        crash();
    }
}

function updateEntities(dt) {
    for (let i = entities.length - 1; i >= 0; i--) {
        const e = entities[i];
        if (!e.alive || screenY(e.worldY) > CANVAS_H + 80) {
            entities.splice(i, 1);
            continue;
        }
        if (!e.vx) continue;
        e.x += e.vx * dt;
        const b = riverBoundsAtWorld(e.worldY);
        if (e.x - e.w / 2 < b.left) {
            e.x = b.left + e.w / 2;
            e.vx = Math.abs(e.vx);
        } else if (e.x + e.w / 2 > b.right) {
            e.x = b.right - e.w / 2;
            e.vx = -Math.abs(e.vx);
        }
    }
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        // Bullets are given the scroll speed on top of their own so they climb
        // the *screen* at a constant rate whatever the throttle is doing.
        b.worldY += (BULLET_SPEED + scrollSpeed) * dt;
        if (screenY(b.worldY) < -BULLET_H) {
            bullets.splice(i, 1);
            continue;
        }
        if (hitSomething(b)) bullets.splice(i, 1);
    }
}

// One bullet, one target: the first thing it overlaps stops it.
function hitSomething(bullet) {
    const by = screenY(bullet.worldY);
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (!e.alive) continue;
        const ey = screenY(e.worldY);
        if (Math.abs(bullet.x - e.x) > (e.w + BULLET_W) / 2) continue;
        if (Math.abs(by - ey) > (e.h + BULLET_H) / 2) continue;
        destroy(e);
        return true;
    }
    return false;
}

function destroy(entity) {
    entity.alive = false;
    score += SCORES[entity.type] || 0;
    const colour = entity.type === 'fuel' ? '#ffb347' : entity.type === 'bridge' ? '#c98a52' : '#ff5d47';
    burst(entity.x, screenY(entity.worldY), entity.type === 'bridge' ? 34 : 14, colour);
    if (entity.type === 'bridge') {
        section++;
        // Each cleared section runs a shade quicker and a shade busier.
        scrollSpeed = clamp(scrollSpeed + 8, MIN_SPEED, MAX_SPEED);
    }
    const i = entities.indexOf(entity);
    if (i >= 0) entities.splice(i, 1);
    updateHud();
}

function collidePlane() {
    const worldY = planeWorldY();
    const left = plane.x - PLANE_W / 2;
    const right = plane.x + PLANE_W / 2;

    // Canyon walls — checked along the whole length of the fuselage.
    for (let dy = -PLANE_H / 2; dy <= PLANE_H / 2; dy += ROW_H / 2) {
        const b = riverBoundsAtWorld(worldY + dy);
        if (left < b.left || right > b.right) {
            crash();
            return;
        }
    }

    for (let i = entities.length - 1; i >= 0; i--) {
        const e = entities[i];
        if (!e.alive) continue;
        if (Math.abs(plane.x - e.x) > (e.w + PLANE_W) / 2) continue;
        if (Math.abs(worldY - e.worldY) > (e.h + PLANE_H) / 2) continue;
        if (e.type === 'fuel') {
            fuel = Math.min(MAX_FUEL, fuel + FUEL_REFILL * MAX_SUBSTEP);
        } else {
            crash();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

function burst(x, y, count, colour) {
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random();
        const speed = 60 + Math.random() * 190;
        particles.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 0.4 + Math.random() * 0.5,
            age: 0,
            colour,
        });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) {
            particles.splice(i, 1);
            continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 220 * dt;
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    livesEl.textContent = String(Math.max(0, lives));
    sectionEl.textContent = String(section);
    distanceEl.textContent = String(Math.floor(scroll / 10));
    fuelBar.style.width = `${clamp((fuel / MAX_FUEL) * 100, 0, 100)}%`;
}

function showOverlay(title, sub, button, scoreLine) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlayScore.textContent = scoreLine || '';
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawCanyon();
    drawEntities();
    drawBullets();
    if (state !== 'crashed' && state !== 'idle') drawPlane();
    drawParticles();
}

function drawCanyon() {
    // Rock first, then carve the water out of it row by row.
    const rock = ctx.createLinearGradient(0, 0, CANVAS_W, 0);
    rock.addColorStop(0, '#3a2519');
    rock.addColorStop(0.5, '#5b3a24');
    rock.addColorStop(1, '#3a2519');
    ctx.fillStyle = '#4a2f1e';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = rock;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const firstRow = Math.max(0, rowIndexAtWorld(scroll) - 1);
    const lastRow = rowIndexAtWorld(scroll + CANVAS_H) + 1;

    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H);
    for (let i = firstRow; i <= lastRow; i++) {
        const row = rows[i];
        if (!row) break;
        const y = screenY(i * ROW_H);
        ctx.lineTo(row.left, y);
    }
    for (let i = lastRow; i >= firstRow; i--) {
        const row = rows[i];
        if (!row) continue;
        const y = screenY(i * ROW_H);
        ctx.lineTo(row.right, y);
    }
    ctx.closePath();
    const water = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    water.addColorStop(0, '#1d5c9c');
    water.addColorStop(1, '#2f7fd6');
    ctx.fillStyle = water;
    ctx.fill();
    ctx.strokeStyle = '#8a5c37';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Rock texture: a deterministic hash per row scatters boulders along both
    // banks, so the walls have grain that scrolls with the canyon instead of
    // being flat brown.
    for (let i = firstRow; i <= lastRow; i++) {
        const row = rows[i];
        if (!row) break;
        const y = screenY(i * ROW_H);
        const h = hash01(i * 2654435761);
        const g = hash01(i * 40503 + 7);
        if (h > 0.62) {
            const size = 4 + g * 18;
            ctx.fillStyle = g > 0.5 ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 214, 170, 0.07)';
            ctx.fillRect(row.left - 8 - size - g * (row.left - 10), y, size, size * 0.7);
        }
        if (g > 0.62) {
            const size = 4 + h * 18;
            ctx.fillStyle = h > 0.5 ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 214, 170, 0.07)';
            ctx.fillRect(row.right + 8 + h * (CANVAS_W - row.right - 20), y - 4, size, size * 0.7);
        }
    }

    // Shallows: a paler lip of water hugging each bank.
    ctx.strokeStyle = 'rgba(160, 214, 255, 0.25)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = firstRow; i <= lastRow; i++) {
        const row = rows[i];
        if (!row) break;
        const y = screenY(i * ROW_H);
        if (i === firstRow) ctx.moveTo(row.left + 3, y);
        else ctx.lineTo(row.left + 3, y);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let i = firstRow; i <= lastRow; i++) {
        const row = rows[i];
        if (!row) break;
        const y = screenY(i * ROW_H);
        if (i === firstRow) ctx.moveTo(row.right - 3, y);
        else ctx.lineTo(row.right - 3, y);
    }
    ctx.stroke();

    // Ripples: short dashes that slide down with the current.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 2;
    for (let i = firstRow; i <= lastRow; i += 3) {
        const row = rows[i];
        if (!row) break;
        const y = screenY(i * ROW_H);
        const wobble = Math.sin(i * 0.7 + scroll * 0.02) * 0.5 + 0.5;
        const x = row.left + 14 + wobble * Math.max(0, row.right - row.left - 46);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 18, y);
        ctx.stroke();
    }
}

function drawEntities() {
    for (const e of entities) {
        const y = screenY(e.worldY);
        if (y < -60 || y > CANVAS_H + 60) continue;
        if (e.type === 'ship') drawShip(e, y);
        else if (e.type === 'chopper') drawChopper(e, y);
        else if (e.type === 'fuel') drawDepot(e, y);
        else if (e.type === 'bridge') drawBridge(e, y);
    }
}

function drawShip(e, y) {
    ctx.fillStyle = '#d8dee9';
    ctx.beginPath();
    ctx.moveTo(e.x - e.w / 2, y - e.h / 2 + 4);
    ctx.lineTo(e.x + e.w / 2, y - e.h / 2 + 4);
    ctx.lineTo(e.x + e.w / 2 - 8, y + e.h / 2);
    ctx.lineTo(e.x - e.w / 2 + 8, y + e.h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7f8ea3';
    ctx.fillRect(e.x - 10, y - e.h / 2 - 4, 20, 8);
    ctx.fillStyle = '#ff5d47';
    ctx.fillRect(e.x - 2, y - e.h / 2 - 9, 4, 6);
}

function drawChopper(e, y) {
    // Tail boom, then the cabin, then a blurred rotor disc with one blade
    // picked out so the spin reads at a glance.
    ctx.fillStyle = '#4f7f55';
    ctx.fillRect(e.x + e.w / 2 - 12, y - 2, 16, 4);
    ctx.fillRect(e.x + e.w / 2 + 1, y - 7, 3, 10);

    ctx.fillStyle = '#8fd694';
    ctx.beginPath();
    ctx.ellipse(e.x, y, e.w / 2 - 6, e.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b4a30';
    ctx.beginPath();
    ctx.ellipse(e.x - 4, y - 1, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    const spin = Math.sin(elapsed * 22 + e.phase);
    ctx.strokeStyle = 'rgba(232, 244, 233, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(e.x - e.w / 2, y - e.h / 2 - 4);
    ctx.lineTo(e.x + e.w / 2, y - e.h / 2 - 4);
    ctx.stroke();
    ctx.strokeStyle = '#e8f4e9';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(e.x - (e.w / 2) * spin, y - e.h / 2 - 4);
    ctx.lineTo(e.x + (e.w / 2) * spin, y - e.h / 2 - 4);
    ctx.stroke();
}

function drawDepot(e, y) {
    ctx.fillStyle = '#ffb347';
    ctx.fillRect(e.x - e.w / 2, y - e.h / 2, e.w, e.h);
    ctx.fillStyle = '#7a4a12';
    ctx.fillRect(e.x - e.w / 2, y - 4, e.w, 8);
    ctx.fillStyle = '#2b1602';
    ctx.font = 'bold 15px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('F', e.x, y - e.h / 2 + 11);
}

function drawBridge(e, y) {
    const b = riverBoundsAtWorld(e.worldY);
    ctx.fillStyle = '#c98a52';
    ctx.fillRect(0, y - e.h / 2, CANVAS_W, e.h);
    ctx.fillStyle = '#8a5c37';
    ctx.fillRect(0, y - e.h / 2, CANVAS_W, 5);
    ctx.fillRect(0, y + e.h / 2 - 5, CANVAS_W, 5);
    ctx.strokeStyle = '#7a4a12';
    ctx.lineWidth = 2;
    for (let x = b.left; x < b.right; x += 22) {
        ctx.beginPath();
        ctx.moveTo(x, y - e.h / 2);
        ctx.lineTo(Math.min(x + 22, b.right), y + e.h / 2);
        ctx.stroke();
    }
}

function drawBullets() {
    ctx.fillStyle = '#fff2c2';
    for (const b of bullets) {
        ctx.fillRect(b.x - BULLET_W / 2, screenY(b.worldY) - BULLET_H / 2, BULLET_W, BULLET_H);
    }
}

function drawPlane() {
    const x = plane.x;
    const y = PLANE_Y;
    // A shadow on the water sells the altitude.
    ctx.fillStyle = 'rgba(0, 20, 45, 0.28)';
    ctx.beginPath();
    ctx.ellipse(x + 12, y + 16, PLANE_W / 2.4, PLANE_H / 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Exhaust grows with the throttle.
    const heat = (scrollSpeed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
    ctx.fillStyle = '#ff8a3d';
    ctx.beginPath();
    ctx.moveTo(x - 5, y + PLANE_H / 2 - 2);
    ctx.lineTo(x + 5, y + PLANE_H / 2 - 2);
    ctx.lineTo(x, y + PLANE_H / 2 + 8 + heat * 14);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#f6ece2';
    ctx.beginPath();
    ctx.moveTo(x, y - PLANE_H / 2);
    ctx.lineTo(x + 7, y + 4);
    ctx.lineTo(x + PLANE_W / 2, y + 10);
    ctx.lineTo(x + 5, y + 12);
    ctx.lineTo(x + 6, y + PLANE_H / 2);
    ctx.lineTo(x - 6, y + PLANE_H / 2);
    ctx.lineTo(x - 5, y + 12);
    ctx.lineTo(x - PLANE_W / 2, y + 10);
    ctx.lineTo(x - 7, y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffb347';
    ctx.fillRect(x - 3, y - 6, 6, 14);
}

function drawParticles() {
    for (const p of particles) {
        const fade = 1 - p.age / p.life;
        ctx.globalAlpha = Math.max(0, fade);
        ctx.fillStyle = p.colour;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

let lastFrame = 0;

function frame(now) {
    const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
    lastFrame = now;
    if (state === 'running' || state === 'crashed') step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const heldKeys = new Set();

function refreshKeys() {
    const left = heldKeys.has('ArrowLeft') || heldKeys.has('a') || heldKeys.has('A');
    const right = heldKeys.has('ArrowRight') || heldKeys.has('d') || heldKeys.has('D');
    const up = heldKeys.has('ArrowUp') || heldKeys.has('w') || heldKeys.has('W');
    const down = heldKeys.has('ArrowDown') || heldKeys.has('s') || heldKeys.has('S');
    movePlane((right ? 1 : 0) - (left ? 1 : 0));
    setThrottle((up ? 1 : 0) - (down ? 1 : 0));
}

const STEER_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'a', 'A', 'd', 'D', 'w', 'W', 's', 'S'];

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else fire();
        e.preventDefault();
        return;
    }
    if (STEER_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshKeys();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.delete(e.key)) refreshKeys();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(window.localStorage.getItem('canyon-raider-best') || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
section = 1;
fuel = MAX_FUEL;
scroll = 0;
elapsed = 0;
scrollSpeed = BASE_SPEED;
throttleInput = 0;
crashTimer = 0;
lastSpawnRow = -99;
spawnBlockUntil = START_SAFE;
genWidth = 240;
genCenter = CANVAS_W / 2;
genTargetWidth = 240;
genTargetCenter = CANVAS_W / 2;
genHold = 24;
terrainRng = makeRng(1);
entityRng = makeRng(2);
fillCanyon();
updateHud();
requestAnimationFrame(frame);
