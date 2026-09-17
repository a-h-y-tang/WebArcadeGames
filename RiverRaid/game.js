// ---------------------------------------------------------------------------
// River Raid — a vertical-scrolling river flight on an HTML5 canvas.
//
// You fly a jet upstream along a procedurally carved river. The banks meander,
// islands split the channel in two, and the only fuel you will ever get is in
// the depots floating below you: fly over one to fill the tank, or shoot it for
// points and go thirsty. Every section of river ends at a bridge that has to be
// blown out of the way before you reach it.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. All motion is expressed per second and applied
// through `step(dt)`, so the tests can simulate frames deterministically. The
// tests also set `autoLoop = false` to stop requestAnimationFrame from stepping
// (it keeps painting), which hands the clock to the spec, and `spawnEnabled`
// switches off the random traffic so a spec sees only what it put on the water.
// ---------------------------------------------------------------------------

// --- Canvas / world ------------------------------------------------------
const CANVAS_W = 480;
const CANVAS_H = 600;

// The river is stored as horizontal slices, one every ROW_H world pixels. World
// y grows upstream; a row at world y `wy` is drawn at screen y
// CANVAS_H - (wy - scrollY), so the world scrolls down past a fixed jet.
const ROW_H = 20;
const EDGE = 24;            // land kept on each side of the canvas
const MIN_RIVER = 150;
const MAX_RIVER = 360;
const BANK_STEP = 4.5;      // how far a bank may shift from one row to the next
const ISLAND_MARGIN = 46;   // clear water kept between an island and each bank
                            // (the jet is 22px wide: a lane must be flyable, not a slot)
const ISLAND_COOLDOWN = 30; // rows of open river guaranteed after an island ends
const OPEN_START_ROWS = 30; // clear water at the mouth of the river, before any island
const CHANNEL_W = 180;      // straightened river width at a bridge
const CHANNEL_LEAD = 25;    // rows spent straightening before the bridge
const SECTION_ROWS = 100;   // a bridge closes the river every this many rows
const TERRAIN_SEED = 0x5eed1e; // the river on the title screen, and the one the
                               // tests fly: startGame() draws a fresh seed

// --- Jet -----------------------------------------------------------------
const JET_SCREEN_Y = 500;   // the jet holds this screen row; the world moves
const JET_HW = 11;          // half-width
const JET_HH = 13;          // half-height
const STEER_SPEED = 195;    // px/s sideways

// --- Throttle ------------------------------------------------------------
const SPEED_SLOW = 95;
const SPEED_NORMAL = 150;
const SPEED_FAST = 240;

// --- Guns ----------------------------------------------------------------
const BULLET_SPEED = 520;   // world px/s; the river slides the other way
const FIRE_COOLDOWN = 0.25;

// --- Fuel ----------------------------------------------------------------
const FUEL_MAX = 100;
const FUEL_BURN = 4.5;      // per second at cruising speed
const REFUEL_RATE = 130;    // per second while over a depot — one pass at cruise
                            // is most of a tank, and throttling down fills more
const DEPOT_MAX_GAP = 60;   // rows without fuel before the next spawn must be a depot

// --- Lives ---------------------------------------------------------------
const START_LIVES = 3;
const DYING_TIME = 1.1;
const RESPAWN_REWIND = 130; // world px given back so you do not respawn on the hazard
const RESPAWN_INVULN = 1.6;

// --- Targets -------------------------------------------------------------
const BRIDGE_H = 18;
const POINTS = { ship: 30, heli: 60, jet: 100, depot: 80, bridge: 500 };
const SIZES = {
    ship: { w: 44, h: 16 },
    heli: { w: 34, h: 18 },
    jet: { w: 36, h: 14 },
    depot: { w: 26, h: 42 },
};
const PATROL_SPEED = { ship: 26, heli: 60, jet: 130, depot: 0 };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';         // idle | running | paused | dying | over
let score = 0;
let best = 0;
let lives = START_LIVES;
let section = 1;
let fuel = FUEL_MAX;
let scrollY = 0;            // how far upstream the camera has travelled
let dyingTimer = 0;
let fireTimer = 0;
let invuln = 0;

const jet = { x: CANVAS_W / 2, alive: true, tilt: 0 };

let rows = [];              // rows[i] = { left, right, island }
let bullets = [];
let enemies = [];           // ships, helicopters and enemy jets
let depots = [];            // fuel depots
let bridges = [];
let particles = [];

// Test seams: `autoLoop` lets a spec own the clock, `spawnEnabled` clears the
// river of random traffic. Both stay true in normal play.
let autoLoop = true;
let spawnEnabled = true;

const heldKeys = new Set();

// --- Terrain generator bookkeeping ---------------------------------------
let genRow = 0;             // next row index to carve
let genLeft = 0;
let genRight = 0;
let targetLeft = 0;
let targetRight = 0;
let holdRows = 0;
let channelRows = 0;        // rows left in the straightened run up to a bridge
let bridgeRow = SECTION_ROWS;
let islandRows = 0;
let islandCooldown = 0;
let islandCenter = 0;
let islandHalf = 0;
let spawnGap = 0;
let lastDepotRow = 0;      // row of the most recent fuel depot

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elSection = document.getElementById('section');
const elLives = document.getElementById('lives');
const elFuel = document.getElementById('fuel');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Two independent seeded generators: the river must carve identically whether
// or not traffic is spawning, so spawns never draw from the terrain stream.
let riverSeed = TERRAIN_SEED;
let terrainState = riverSeed;
let spawnState = riverSeed;

function terrainRnd() {
    terrainState = (terrainState * 1664525 + 1013904223) >>> 0;
    return terrainState / 4294967296;
}

function spawnRnd() {
    spawnState = (spawnState * 1664525 + 1013904223) >>> 0;
    return spawnState / 4294967296;
}

const rowIndexAt = (worldY) => Math.max(0, Math.floor(worldY / ROW_H));

const jetWorldY = () => scrollY + (CANVAS_H - JET_SCREEN_Y);

const screenYOf = (worldY) => CANVAS_H - (worldY - scrollY);

const clampJetX = (x) => clamp(x, JET_HW, CANVAS_W - JET_HW);

const currentSpeed = () => {
    if (heldKeys.has('ArrowUp') || heldKeys.has('w')) return SPEED_FAST;
    if (heldKeys.has('ArrowDown') || heldKeys.has('s')) return SPEED_SLOW;
    return SPEED_NORMAL;
};

const steerInput = () => {
    let dir = 0;
    if (heldKeys.has('ArrowLeft') || heldKeys.has('a')) dir -= 1;
    if (heldKeys.has('ArrowRight') || heldKeys.has('d')) dir += 1;
    return dir;
};

// Water edges at a world y, interpolated between the two rows that straddle it.
function riverBoundsAt(worldY) {
    const i = rowIndexAt(worldY);
    ensureRows(i + 1);
    const a = rows[i] || rows[rows.length - 1];
    const b = rows[i + 1] || a;
    const t = clamp(worldY / ROW_H - i, 0, 1);
    return {
        left: a.left + (b.left - a.left) * t,
        right: a.right + (b.right - a.right) * t,
        // A row's island covers the slice drawn for that row and no further, so
        // the next row's island must not reach back and sink the jet early.
        island: a.island || null,
    };
}

// True when a jet centred at `x` would be over land — either bank or an island.
function hitsLand(x, worldY) {
    const i = rowIndexAt(worldY);
    ensureRows(i + 1);
    const b = riverBoundsAt(worldY);
    if (x - JET_HW < b.left || x + JET_HW > b.right) return true;
    const island = rows[i] && rows[i].island;
    return !!island && x + JET_HW > island.left && x - JET_HW < island.right;
}

// The lanes of open water across one slice: one channel, or two around an island.
function lanesOfSlice(slice) {
    if (!slice.island) return [{ left: slice.left, right: slice.right }];
    return [
        { left: slice.left, right: slice.island.left },
        { left: slice.island.right, right: slice.right },
    ];
}

const lanesAt = (worldY) => lanesOfSlice(riverBoundsAt(worldY));

// Narrow a lane down to the water that stays open all the way up `span`, so a
// lane that an island or a closing bank swallows two seconds from now scores as
// the dead end it is.
function corridorFrom(lane, worldY, span) {
    let left = lane.left;
    let right = lane.right;
    for (let wy = worldY + ROW_H; wy <= worldY + span; wy += ROW_H) {
        let bestLeft = 0;
        let bestRight = 0;
        let bestOverlap = 0;
        for (const cand of lanesAt(wy)) {
            const overlap = Math.min(right, cand.right) - Math.max(left, cand.left);
            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                bestLeft = cand.left;
                bestRight = cand.right;
            }
        }
        if (bestOverlap <= 0) return { left, right, width: 0 };
        left = Math.max(left, bestLeft);
        right = Math.min(right, bestRight);
    }
    return { left, right, width: right - left };
}

// Middle of the lane with the most room ahead of it — where the jet starts and
// where it respawns. Respawning into a lane that is about to close is how a
// single crash turns into a death loop.
function safeCenter(worldY, span = 260) {
    const lanes = lanesAt(worldY);
    let best = null;
    for (const lane of lanes) {
        const corridor = corridorFrom(lane, worldY, span);
        if (!best || corridor.width > best.width) best = corridor;
    }
    if (!best || best.width <= 0) {
        const widest = lanes.reduce((a, b) => (b.right - b.left > a.right - a.left ? b : a));
        return clampJetX((widest.left + widest.right) / 2);
    }
    return clampJetX((best.left + best.right) / 2);
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

function resetTerrain() {
    terrainState = riverSeed;
    // The spawn stream is decorrelated from the terrain stream but tied to the
    // same seed, so one seed reproduces the whole flight.
    spawnState = (riverSeed ^ 0x9e3779b9) >>> 0;
    rows = [];
    bridges = [];
    genRow = 0;
    holdRows = 0;
    channelRows = 0;
    islandRows = 0;
    islandCooldown = 0;
    bridgeRow = SECTION_ROWS;
    spawnGap = 14;
    lastDepotRow = 0;
    const width = 240;
    genLeft = (CANVAS_W - width) / 2;
    genRight = genLeft + width;
    targetLeft = genLeft;
    targetRight = genRight;
}

function pickBankTargets() {
    const width = MIN_RIVER + terrainRnd() * (MAX_RIVER - MIN_RIVER);
    const span = CANVAS_W - 2 * EDGE - width;
    const center = EDGE + width / 2 + terrainRnd() * span;
    targetLeft = center - width / 2;
    targetRight = center + width / 2;
    holdRows = 8 + Math.floor(terrainRnd() * 14);
}

// Straighten the river into a fixed-width channel around the current centre so
// the bridge ahead is always reachable from wherever the player already is.
function lockChannel() {
    const center = clamp(
        (genLeft + genRight) / 2,
        EDGE + CHANNEL_W / 2,
        CANVAS_W - EDGE - CHANNEL_W / 2
    );
    targetLeft = center - CHANNEL_W / 2;
    targetRight = center + CHANNEL_W / 2;
    channelRows = CHANNEL_LEAD + 8;
    holdRows = channelRows;
    islandRows = 0;
}

// Carve every row up to and including `index`. Carving a row never needs a row
// beyond itself, so a nested call (a lookup made while carving) is a no-op
// rather than a re-entrant carve that would scramble the generator's state.
let carving = false;

function ensureRows(index) {
    if (carving) return;
    carving = true;
    while (genRow <= index) {
        carveRow(genRow);
        genRow++;
    }
    carving = false;
}

function carveRow(i) {
    if (channelRows > 0) channelRows--;
    else if (bridgeRow - i === CHANNEL_LEAD) lockChannel();
    else if (holdRows <= 0) pickBankTargets();
    holdRows--;

    genLeft += clamp(targetLeft - genLeft, -BANK_STEP, BANK_STEP);
    genRight += clamp(targetRight - genRight, -BANK_STEP, BANK_STEP);

    // The banks move independently, so the width is re-squared every row: a
    // river that is briefly too narrow to fly is worse than one that snaps.
    if (genRight - genLeft < MIN_RIVER) genRight = genLeft + MIN_RIVER;
    if (genRight - genLeft > MAX_RIVER) genRight = genLeft + MAX_RIVER;
    if (genRight > CANVAS_W - EDGE) {
        genRight = CANVAS_W - EDGE;
        genLeft = Math.min(genLeft, genRight - MIN_RIVER);
    }
    if (genLeft < EDGE) {
        genLeft = EDGE;
        genRight = Math.max(genRight, genLeft + MIN_RIVER);
    }

    const row = { left: genLeft, right: genRight, island: null };
    rows[i] = row;

    const inChannel = channelRows > 0;
    if (islandCooldown > 0) islandCooldown--;
    // The opening stretch stays open water: the first island is held back until
    // it can scroll into view with a few seconds of reaction time behind it.
    if (!inChannel && i >= OPEN_START_ROWS && islandRows <= 0 && islandCooldown <= 0 &&
        row.right - row.left >= 240 && terrainRnd() < 0.04) {
        islandHalf = 25 + terrainRnd() * 20;
        islandCenter = (row.left + row.right) / 2 + (terrainRnd() - 0.5) * 40;
        islandRows = 12 + Math.floor(terrainRnd() * 14);
    }
    if (islandRows > 0) {
        islandRows--;
        const left = islandCenter - islandHalf;
        const right = islandCenter + islandHalf;
        if (left > row.left + ISLAND_MARGIN && right < row.right - ISLAND_MARGIN) {
            row.island = { left, right };
        } else {
            islandRows = 0; // the banks closed in; let the island run out
        }
        if (islandRows <= 0) islandCooldown = ISLAND_COOLDOWN;
    }

    if (i === bridgeRow) {
        bridges.push({
            x: row.left,
            w: row.right - row.left,
            y: i * ROW_H,
            h: BRIDGE_H,
            alive: true,
        });
        bridgeRow += SECTION_ROWS;
    }

    maybeSpawn(i, row, inChannel);
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

function maybeSpawn(i, row, inChannel) {
    // The idle title screen carves terrain too; nothing should be on the water
    // until the player is actually flying.
    if (!spawnEnabled || state !== 'running' || inChannel || i < 16) return;
    if (--spawnGap > 0) return;
    spawnGap = 8 + Math.floor(spawnRnd() * 14);

    const roll = spawnRnd();
    // Fuel first: running dry is the clock this game plays against, so a long
    // unlucky run of warships cannot leave the player with nowhere to refuel.
    const kind =
        i - lastDepotRow >= DEPOT_MAX_GAP || roll < 0.22
            ? 'depot'
            : roll < 0.58
              ? 'ship'
              : roll < 0.85
                ? 'heli'
                : 'jet';
    if (kind === 'depot') lastDepotRow = i;
    // The row being carved is the one the target sits on, so its lanes come
    // straight from it — asking for interpolated bounds here would reach for a
    // row that does not exist yet.
    const lanes = lanesOfSlice(row);
    const lane = lanes[Math.floor(spawnRnd() * lanes.length)] || lanes[0];
    const x = lane.left + spawnRnd() * (lane.right - lane.left);
    const e = spawnEnemy(kind, x, i * ROW_H, row);
    if (e.vx !== 0) e.vx = Math.sign(spawnRnd() - 0.5 || 1) * Math.abs(e.vx);
}

// Put a target on the water. Its patrol is fenced to the lane it spawned in, so
// nothing ever drifts over an island or a bank. `slice` is the river cross
// section to fence against, defaulting to the water at `worldY`.
function spawnEnemy(kind, x, worldY, slice) {
    const size = SIZES[kind];
    const lanes = slice ? lanesOfSlice(slice) : lanesAt(worldY);
    let lane = lanes.find((l) => x >= l.left && x <= l.right);
    if (!lane) {
        lane = lanes.reduce((a, b) => (b.right - b.left > a.right - a.left ? b : a));
    }
    const half = size.w / 2;
    const minX = lane.left + half;
    const maxX = Math.max(minX, lane.right - half);
    const speed = PATROL_SPEED[kind] * (1 + (section - 1) * 0.12);
    const e = {
        kind,
        x: clamp(x, minX, maxX),
        y: worldY,
        w: size.w,
        h: size.h,
        vx: kind === 'depot' ? 0 : speed,
        minX,
        maxX,
        phase: spawnRnd() * Math.PI * 2,
    };
    (kind === 'depot' ? depots : enemies).push(e);
    return e;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

// `seed` is optional: pass one to fly a river again, leave it out for a new one.
function startGame(seed) {
    riverSeed = seed === undefined ? (Math.random() * 0xffffffff) >>> 0 : seed >>> 0;
    state = 'running';
    score = 0;
    lives = START_LIVES;
    section = 1;
    fuel = FUEL_MAX;
    scrollY = 0;
    dyingTimer = 0;
    fireTimer = 0;
    invuln = 0;
    bullets = [];
    enemies = [];
    depots = [];
    particles = [];
    resetTerrain();
    ensureRows(rowIndexAt(CANVAS_H + 240));
    jet.x = safeCenter(jetWorldY());
    jet.tilt = 0;
    hideOverlay();
    updateHud();
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

function crash() {
    if (state !== 'running') return;
    state = 'dying';
    dyingTimer = DYING_TIME;
    burst(jet.x, jetWorldY(), 26, '#ffd166');
}

function respawnOrEnd() {
    lives--;
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    scrollY = Math.max(0, scrollY - RESPAWN_REWIND);
    fuel = FUEL_MAX;
    bullets = [];
    const wy = jetWorldY();
    // Sweep the stretch the jet is about to re-fly so it does not respawn into
    // the very thing that just killed it.
    const clear = (list) => list.filter((o) => o.y < wy - 40 || o.y > wy + 300);
    enemies = clear(enemies);
    depots = clear(depots);
    jet.x = safeCenter(wy);
    invuln = RESPAWN_INVULN;
    state = 'running';
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('riverraid-best', String(best));
        } catch (err) {
            /* private mode: keep the score in memory only */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Section ${section}`, 'Press Space to fly again');
}

function fire() {
    if (state !== 'running' || fireTimer > 0) return;
    fireTimer = FIRE_COOLDOWN;
    bullets.push({ x: jet.x, y: jetWorldY() + 16 });
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        stepParticles(dt);
        dyingTimer -= dt;
        if (dyingTimer <= 0) respawnOrEnd();
        return;
    }
    if (state !== 'running') return;

    const speed = currentSpeed();
    scrollY += speed * dt;
    ensureRows(rowIndexAt(scrollY + CANVAS_H + 240));

    const dir = steerInput();
    jet.x = clampJetX(jet.x + dir * STEER_SPEED * dt);
    jet.tilt += (dir - jet.tilt) * Math.min(1, dt * 12);

    fireTimer -= dt;
    invuln -= dt;
    fuel -= FUEL_BURN * (speed / SPEED_NORMAL) * dt;

    stepBullets(dt);
    stepTargets(dt);
    stepParticles(dt);
    collide(dt);
    cull();

    if (fuel <= 0 && state === 'running') {
        fuel = 0;
        crash();
    }
    updateHud();
}

function stepBullets(dt) {
    for (const b of bullets) b.y += BULLET_SPEED * dt;
}

function stepTargets(dt) {
    for (const e of enemies) {
        if (!e.vx) continue;
        e.x += e.vx * dt;
        if (e.x < e.minX) {
            e.x = e.minX;
            e.vx = Math.abs(e.vx);
        } else if (e.x > e.maxX) {
            e.x = e.maxX;
            e.vx = -Math.abs(e.vx);
        }
    }
}

function stepParticles(dt) {
    for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy -= 40 * dt;
        p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
}

function burst(x, worldY, count, color) {
    for (let i = 0; i < count; i++) {
        const a = (Math.PI * 2 * i) / count + Math.random() * 0.4;
        const sp = 40 + Math.random() * 130;
        particles.push({
            x,
            y: worldY,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 0.4 + Math.random() * 0.5,
            color,
        });
    }
}

const overlaps = (ax, ay, ahw, ahh, bx, by, bhw, bhh) =>
    Math.abs(ax - bx) < ahw + bhw && Math.abs(ay - by) < ahh + bhh;

function collide(dt) {
    // Shots first, so a target destroyed this frame cannot also kill the jet.
    for (const b of bullets) {
        if (b.hit) continue;
        for (const bridge of bridges) {
            if (!bridge.alive) continue;
            if (b.x >= bridge.x && b.x <= bridge.x + bridge.w &&
                Math.abs(b.y - bridge.y) < bridge.h / 2 + 6) {
                bridge.alive = false;
                b.hit = true;
                score += POINTS.bridge;
                section++;
                burst(b.x, bridge.y, 34, '#f5b942');
                break;
            }
        }
        if (b.hit) continue;
        for (const list of [enemies, depots]) {
            const target = list.find(
                (e) => !e.hit && overlaps(b.x, b.y, 2, 5, e.x, e.y, e.w / 2, e.h / 2)
            );
            if (target) {
                target.hit = true;
                b.hit = true;
                score += POINTS[target.kind];
                burst(target.x, target.y, target.kind === 'depot' ? 22 : 16,
                    target.kind === 'depot' ? '#ff8a3d' : '#ffe08a');
                break;
            }
        }
    }
    bullets = bullets.filter((b) => !b.hit);
    enemies = enemies.filter((e) => !e.hit);
    depots = depots.filter((d) => !d.hit);

    const wy = jetWorldY();

    if (hitsLand(jet.x, wy)) {
        crash();
        return;
    }

    for (const bridge of bridges) {
        if (!bridge.alive) continue;
        if (jet.x + JET_HW > bridge.x && jet.x - JET_HW < bridge.x + bridge.w &&
            Math.abs(wy - bridge.y) < bridge.h / 2 + JET_HH) {
            crash();
            return;
        }
    }

    if (invuln <= 0) {
        for (const e of enemies) {
            if (overlaps(jet.x, wy, JET_HW, JET_HH, e.x, e.y, e.w / 2, e.h / 2)) {
                burst(e.x, e.y, 18, '#ffe08a');
                crash();
                return;
            }
        }
    }

    for (const d of depots) {
        if (overlaps(jet.x, wy, JET_HW, JET_HH, d.x, d.y, d.w / 2, d.h / 2)) {
            fuel = Math.min(FUEL_MAX, fuel + REFUEL_RATE * dt);
        }
    }
}

function cull() {
    const behind = scrollY - 80;
    bullets = bullets.filter((b) => b.y - scrollY <= CANVAS_H);
    enemies = enemies.filter((e) => e.y > behind);
    depots = depots.filter((d) => d.y > behind);
    bridges = bridges.filter((b) => b.alive && b.y > scrollY - 40);
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elSection.textContent = String(section);
    elLives.textContent = String(lives);
    elFuel.textContent = String(Math.max(0, Math.ceil(fuel)));
    elBest.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Game';
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const LAND = '#2c6b36';
const LAND_DARK = '#215128';
const WATER = '#15497f';
const WATER_LIGHT = '#1d61a6';

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawLand();
    drawRiver();
    drawTrees(...visibleRowRange());
    drawBridges();
    drawDepots();
    drawEnemies();
    drawBullets();
    if (state !== 'dying' || Math.floor(dyingTimer * 12) % 2 === 0) drawJet();
    drawParticles();
    drawFuelGauge();
}

function drawLand() {
    ctx.fillStyle = LAND;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // Darker scrub along the outer edges gives the banks some depth.
    const edge = ctx.createLinearGradient(0, 0, CANVAS_W, 0);
    edge.addColorStop(0, LAND_DARK);
    edge.addColorStop(0.12, LAND);
    edge.addColorStop(0.88, LAND);
    edge.addColorStop(1, LAND_DARK);
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

// Cheap deterministic hash, so the trees on a stretch of bank are the same
// every time that stretch scrolls past — no per-frame jitter, no stored state.
function hash2(a, b) {
    let h = (a * 374761393 + b * 668265263) >>> 0;
    h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// A sandbank is one shape, not a stack of row slices: rows are walked out to the
// real ends of the run (past the visible range) so a long island keeps its
// rounded caps off-screen instead of growing one mid-canvas.
function drawIslands(first, last) {
    let i = first;
    while (i <= last) {
        if (!rows[i] || !rows[i].island) {
            i++;
            continue;
        }
        let startRow = i;
        let endRow = i;
        while (startRow > 0 && rows[startRow - 1] && rows[startRow - 1].island) startRow--;
        while (rows[endRow + 1] && rows[endRow + 1].island) endRow++;
        const island = rows[startRow].island;
        const bottom = screenYOf(startRow * ROW_H);
        const top = screenYOf((endRow + 1) * ROW_H);
        const w = island.right - island.left;
        const radius = Math.min(w / 2, 16);

        ctx.fillStyle = '#c8b487';
        ctx.beginPath();
        ctx.roundRect(island.left - 5, top - 5, w + 10, bottom - top + 10, radius + 4);
        ctx.fill();
        ctx.fillStyle = LAND;
        ctx.beginPath();
        ctx.roundRect(island.left, top, w, bottom - top, radius);
        ctx.fill();

        i = endRow + 1;
    }
}

function tree(x, y, radius) {
    ctx.fillStyle = '#12351b';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4d8a3a';
    ctx.beginPath();
    ctx.arc(x - radius * 0.25, y - radius * 0.3, radius * 0.62, 0, Math.PI * 2);
    ctx.fill();
}

// Trees are drawn after the water so they can hug the shoreline without any
// risk of a stale bank position painting green over the river.
function drawTrees(first, last) {
    for (let i = first; i <= last; i += 2) {
        const r = rows[i];
        if (!r) continue;
        const y = screenYOf(i * ROW_H);
        for (let side = 0; side < 2; side++) {
            if (hash2(i, side) > 0.62) continue;
            const bandLeft = side === 0 ? 4 : r.right + 10;
            const bandRight = side === 0 ? r.left - 10 : CANVAS_W - 4;
            if (bandRight - bandLeft < 18) continue;
            const radius = 5 + hash2(i, side + 13) * 4;
            const x = bandLeft + radius + hash2(i, side + 7) * (bandRight - bandLeft - 2 * radius);
            tree(x, y, radius);
        }
        if (r.island && i % 4 === 0 && r.island.right - r.island.left > 44) {
            tree((r.island.left + r.island.right) / 2, y, 5);
        }
    }
}

function visibleRowRange() {
    const first = Math.max(0, rowIndexAt(scrollY) - 1);
    const last = rowIndexAt(scrollY + CANVAS_H) + 1;
    ensureRows(last);
    return [first, last];
}

function drawRiver() {
    const [first, last] = visibleRowRange();

    // Sandy shoreline: the same polygon, fattened, painted under the water.
    ctx.beginPath();
    for (let i = first; i <= last; i++) {
        const y = screenYOf(i * ROW_H);
        if (i === first) ctx.moveTo(rows[i].left - 4, y);
        else ctx.lineTo(rows[i].left - 4, y);
    }
    for (let i = last; i >= first; i--) {
        ctx.lineTo(rows[i].right + 4, screenYOf(i * ROW_H));
    }
    ctx.closePath();
    ctx.fillStyle = '#c8b487';
    ctx.fill();

    ctx.beginPath();
    for (let i = first; i <= last; i++) {
        const r = rows[i];
        const y = screenYOf(i * ROW_H);
        if (i === first) ctx.moveTo(r.left, y);
        else ctx.lineTo(r.left, y);
    }
    for (let i = last; i >= first; i--) {
        const r = rows[i];
        ctx.lineTo(r.right, screenYOf(i * ROW_H));
    }
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, WATER);
    grad.addColorStop(1, WATER_LIGHT);
    ctx.fillStyle = grad;
    ctx.fill();

    drawIslands(first, last);

    // Wake lines on the water.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    const spacing = 70;
    const offset = scrollY % spacing;
    for (let y = -spacing; y < CANVAS_H + spacing; y += spacing) {
        const wy = scrollY + (CANVAS_H - (y + offset));
        const b = riverBoundsAt(Math.max(0, wy));
        ctx.fillRect(b.left + 18, y + offset, 22, 3);
        ctx.fillRect(b.right - 40, y + offset + 26, 22, 3);
    }
}

function drawBridges() {
    for (const bridge of bridges) {
        const y = screenYOf(bridge.y);
        if (y < -40 || y > CANVAS_H + 40) continue;
        ctx.fillStyle = '#b4452f';
        ctx.fillRect(bridge.x, y - bridge.h / 2, bridge.w, bridge.h);
        ctx.fillStyle = '#7d2c1d';
        for (let x = bridge.x + 4; x < bridge.x + bridge.w - 4; x += 12) {
            ctx.fillRect(x, y - bridge.h / 2, 5, bridge.h);
        }
        ctx.fillStyle = '#e0dcd2';
        ctx.fillRect(bridge.x, y - bridge.h / 2 - 3, bridge.w, 3);
        ctx.fillRect(bridge.x, y + bridge.h / 2, bridge.w, 3);
    }
}

function drawDepots() {
    for (const d of depots) {
        const y = screenYOf(d.y);
        if (y < -40 || y > CANVAS_H + 40) continue;
        ctx.fillStyle = '#e8402f';
        ctx.fillRect(d.x - d.w / 2, y - d.h / 2, d.w, d.h);
        ctx.fillStyle = '#b52a1c';
        ctx.fillRect(d.x - d.w / 2, y - d.h / 2, 4, d.h);
        ctx.fillRect(d.x + d.w / 2 - 4, y - d.h / 2, 4, d.h);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(d.x - d.w / 2 + 4, y - 9, d.w - 8, 18);
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#c1301f';
        ctx.fillText('F', d.x, y + 1);
    }
}

function drawEnemies() {
    for (const e of enemies) {
        const y = screenYOf(e.y);
        if (y < -40 || y > CANVAS_H + 40) continue;
        const facing = e.vx < 0 ? -1 : 1;
        if (e.kind === 'ship') {
            ctx.fillStyle = '#d8dde6';
            ctx.beginPath();
            ctx.moveTo(e.x - e.w / 2, y - e.h / 2);
            ctx.lineTo(e.x + e.w / 2, y - e.h / 2);
            ctx.lineTo(e.x + e.w / 2 - 8, y + e.h / 2);
            ctx.lineTo(e.x - e.w / 2 + 8, y + e.h / 2);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#6d7b8d';
            ctx.fillRect(e.x - 6, y - e.h / 2 - 5, 12, 6);
        } else if (e.kind === 'heli') {
            ctx.fillStyle = '#f0c24b';
            ctx.beginPath();
            ctx.ellipse(e.x, y, e.w / 2 - 4, e.h / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillRect(e.x - facing * (e.w / 2), y - 2, e.w / 2, 4);
            ctx.fillStyle = '#3c3120';
            ctx.fillRect(e.x - e.w / 2, y - e.h / 2 - 4, e.w, 3);
        } else {
            ctx.fillStyle = '#ef6f5b';
            ctx.beginPath();
            ctx.moveTo(e.x + facing * (e.w / 2), y);
            ctx.lineTo(e.x - facing * (e.w / 2), y - e.h / 2);
            ctx.lineTo(e.x - facing * (e.w / 4), y);
            ctx.lineTo(e.x - facing * (e.w / 2), y + e.h / 2);
            ctx.closePath();
            ctx.fill();
        }
    }
}

function drawBullets() {
    ctx.fillStyle = '#ffe98a';
    for (const b of bullets) {
        const y = screenYOf(b.y);
        ctx.fillRect(b.x - 2, y - 8, 4, 12);
    }
}

function drawJet() {
    if (state === 'over') return;
    const y = JET_SCREEN_Y;
    const blink = invuln > 0 && Math.floor(invuln * 14) % 2 === 0;
    ctx.save();
    ctx.translate(jet.x, y);
    ctx.rotate(jet.tilt * 0.18);
    ctx.globalAlpha = blink ? 0.45 : 1;
    ctx.fillStyle = '#e8eef6';
    ctx.beginPath();
    ctx.moveTo(0, -JET_HH);
    ctx.lineTo(JET_HW, JET_HH);
    ctx.lineTo(0, JET_HH - 6);
    ctx.lineTo(-JET_HW, JET_HH);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#45d6c8';
    ctx.fillRect(-2.5, -JET_HH + 4, 5, 12);
    ctx.fillStyle = '#ef6f5b';
    ctx.fillRect(-5, JET_HH - 4, 10, 4);
    ctx.restore();
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, screenYOf(p.y) - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

function drawFuelGauge() {
    const w = 220;
    const h = 14;
    const x = (CANVAS_W - w) / 2;
    const y = CANVAS_H - 26;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    const pct = clamp(fuel / FUEL_MAX, 0, 1);
    ctx.fillStyle = pct > 0.35 ? '#5ad06a' : pct > 0.15 ? '#f0c24b' : '#ef5b4c';
    ctx.fillRect(x, y, w * pct, h);
    ctx.strokeStyle = '#dce8f2';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#dce8f2';
    ctx.fillText('E', x - 12, y + h / 2);
    ctx.textAlign = 'right';
    ctx.fillText('F', x + w + 12, y + h / 2);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's'];

window.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (key === 'p') {
        togglePause();
        e.preventDefault();
        return;
    }
    if (key === 'Enter') {
        if (state !== 'running') startGame();
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
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    heldKeys.delete(key);
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
    if (autoLoop) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('riverraid-best') || '0', 10) || 0;
state = 'idle';
resetTerrain();
ensureRows(rowIndexAt(CANVAS_H + 240));
jet.x = safeCenter(jetWorldY());
updateHud();
showOverlay('RIVER RAID', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
