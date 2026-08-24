// ---------------------------------------------------------------------------
// Soda Tapper — a one-server diner rush on an HTML5 canvas.
//
// Four counters, one soda jerk. Customers walk in at the far end of a counter
// and advance on your station; you slide full mugs down the counter to push
// them back. Push one off the far end and they leave happy — but they send the
// empty mug sliding back, and you have to be standing in that lane to catch
// it. A customer reaching you, a full mug running off the end, or an empty mug
// crashing past you each costs a life.
//
// Written as a single classic (non-module) script so that state and logic are
// reachable from the Playwright tests as plain globals, mirroring Slime Volley
// and Kaboom in this repo. All motion is per-second and advanced through
// `step(dt)` in fixed sub-steps, so tests can simulate frames deterministically
// without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Canvas & counter geometry ---
const CANVAS_W = 720;
const CANVAS_H = 480;
const LANE_COUNT = 4;
const LANE_TOP = 112;               // centre line of the top counter
const LANE_H = 96;                  // spacing between counters
const EXIT_X = 30;                  // far lip: customers leave, mugs smash
const COUNTER_LEFT = 70;            // where a new customer steps on
const GRAB_X = 596;                 // a customer this close has got you
const SERVER_X = 650;               // your station and the tap
const CATCH_X = 616;                // an empty mug is catchable from here
const MUG_START_X = SERVER_X - 28;
const MUG_SMASH_X = SERVER_X + 12;  // an empty mug past this is on the floor

// --- Speeds ---
const MUG_SPEED = 330;              // full mug, sliding away from the tap
const EMPTY_SPEED = 230;            // empty mug, sliding back at you
const PUSHBACK_SPEED = 170;         // how fast a drinking customer retreats
const PUSHBACK_DIST = 130;          // ground one mug takes off a customer
const CUSTOMER_SPEED_BASE = 22;
const CUSTOMER_SPEED_STEP = 5;      // per level
const HIT_DIST = 22;                // mug/customer contact distance

// --- Rhythm ---
const TAP_COOLDOWN = 0.16;
const RESPAWN_DELAY = 1.3;          // quiet beat after losing a life
const INTERLUDE_TIME = 1.5;         // between levels
const SPAWN_BASE = 3.2;
const SPAWN_STEP = 0.25;            // per level
const SPAWN_MIN = 1.1;
const MAX_CUSTOMERS = 7;
const SPAWN_CLEARANCE = 46;         // keep arrivals from landing on each other

// --- Scoring ---
const SERVE_POINTS = 50;            // × level, for a satisfied customer
const CATCH_POINTS = 100;           // × level, for catching an empty
const LEVEL_BONUS = 200;            // × level, for clearing a level
const LEVEL_BASE = 4;               // level n needs LEVEL_BASE + 2n served
const START_LIVES = 3;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const levelEl = document.getElementById('level');
const servedEl = document.getElementById('served');
const livesEl = document.getElementById('lives');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'interlude' | 'over'
let state = 'idle';
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let served = 0;
let target = LEVEL_BASE + 2;
let spawnEnabled = true;            // test seam: switch off the arrival timer
let spawnTimer = 1.0;
let tapCooldown = 0;
let interludeTimer = 0;
let flashText = '';
let flashTimer = 0;
let shakeTimer = 0;

const player = { lane: 0, pourAnim: 0 };
const customers = [];
const mugs = [];
const splashes = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Centre line of counter `i`.
function laneY(i) {
    return LANE_TOP + i * LANE_H;
}

// Seconds between arrivals at a given level, never tighter than SPAWN_MIN.
function spawnInterval(lvl) {
    return Math.max(SPAWN_MIN, SPAWN_BASE - lvl * SPAWN_STEP);
}

function customerSpeed() {
    return CUSTOMER_SPEED_BASE + level * CUSTOMER_SPEED_STEP;
}

function serveTargetFor(lvl) {
    return LEVEL_BASE + 2 * lvl;
}

function flash(text) {
    flashText = text;
    flashTimer = 1.4;
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    levelEl.textContent = String(level);
    servedEl.textContent = `${served} / ${target}`;
    livesEl.textContent = String(lives);
}

function showOverlay(title, sub, scoreLine) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlayScore.textContent = scoreLine || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    lives = START_LIVES;
    level = 1;
    served = 0;
    target = serveTargetFor(level);
    customers.length = 0;
    mugs.length = 0;
    splashes.length = 0;
    player.lane = 0;
    player.pourAnim = 0;
    spawnTimer = 1.0;
    tapCooldown = 0;
    interludeTimer = 0;
    flashTimer = 0;
    shakeTimer = 0;
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', 'Press P or click Resume to carry on', `Score ${score}`);
        btnStart.textContent = 'Resume';
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
        btnStart.textContent = 'Start Shift';
    }
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('soda-tapper-best', String(best));
        } catch (err) {
            /* storage unavailable (private mode) — the run just isn't saved */
        }
    }
    btnStart.textContent = 'Play Again';
    showOverlay('CLOSING TIME', 'Press Space or click to run the diner again',
        `Score ${score} · Level ${level} · Best ${best}`);
    updateHud();
}

function loseLife(reason) {
    lives -= 1;
    customers.length = 0;
    mugs.length = 0;
    spawnTimer = RESPAWN_DELAY;
    tapCooldown = 0;
    shakeTimer = 0.35;
    updateHud();
    if (lives <= 0) {
        gameOver();
    } else {
        flash(reason);
    }
}

function completeLevel() {
    score += LEVEL_BONUS * level;
    level += 1;
    served = 0;
    target = serveTargetFor(level);
    customers.length = 0;
    mugs.length = 0;
    state = 'interlude';
    interludeTimer = INTERLUDE_TIME;
    flash(`LEVEL ${level}`);
    updateHud();
}

function beginLevel() {
    state = 'running';
    spawnTimer = 1.0;
    tapCooldown = 0;
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function moveLane(delta) {
    if (state !== 'running') return;
    player.lane = clamp(player.lane + delta, 0, LANE_COUNT - 1);
}

function pour() {
    if (state !== 'running') return;
    if (tapCooldown > 0) return;
    tapCooldown = TAP_COOLDOWN;
    player.pourAnim = 0.22;
    mugs.push({ lane: player.lane, x: MUG_START_X, full: true, spin: 0 });
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

// Place a customer at the far end of a counter. Also the tests' way of setting
// up a board without waiting on the arrival timer.
function spawnCustomer(lane) {
    const c = {
        lane,
        x: COUNTER_LEFT,
        drinking: false,
        pushRemaining: 0,
        drinkTimer: 0,
        hue: 20 + ((customers.length * 67 + lane * 41) % 300),
        bob: (lane * 0.7) % 1,
    };
    customers.push(c);
    return c;
}

// A lane is only free to receive an arrival if nobody is loitering on the step.
function laneIsClear(lane) {
    return !customers.some((c) => c.lane === lane && c.x < COUNTER_LEFT + SPAWN_CLEARANCE);
}

function pickSpawnLane() {
    const free = [];
    for (let i = 0; i < LANE_COUNT; i++) if (laneIsClear(i)) free.push(i);
    if (!free.length) return -1;
    return free[Math.floor(Math.random() * free.length)];
}

// The customer nearest the tap in this lane that is close enough to grab a
// sliding mug.
function customerForMug(mug) {
    let nearest = null;
    for (const c of customers) {
        if (c.lane !== mug.lane) continue;
        if (Math.abs(c.x - mug.x) > HIT_DIST) continue;
        if (!nearest || c.x > nearest.x) nearest = c;
    }
    return nearest;
}

function serveCustomer(c, index) {
    customers.splice(index, 1);
    served += 1;
    score += SERVE_POINTS * level;
    mugs.push({ lane: c.lane, x: EXIT_X + 8, full: false, spin: 0 });
    splash(EXIT_X + 8, counterY(c.lane), '#ffd27a');
    updateHud();
    if (served >= target) completeLevel();
}

function splash(x, y, color) {
    for (let i = 0; i < 10; i++) {
        splashes.push({
            x,
            y,
            vx: (Math.random() - 0.5) * 220,
            vy: -Math.random() * 180,
            life: 0.45,
            color,
        });
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const MAX_SUBSTEP = 1 / 120;

// Advance the world by `dt` seconds. Split into fixed sub-steps so that a
// large delta (a stalled tab, or a test taking one big stride) cannot let a
// fast mug tunnel past a customer or past the end of a counter.
function step(dt) {
    if (state === 'interlude') {
        interludeTimer -= dt;
        decayEffects(dt);
        if (interludeTimer <= 0) beginLevel();
        return;
    }
    if (state !== 'running') return;

    let remaining = Math.max(0, dt);
    while (remaining > 0) {
        const slice = Math.min(MAX_SUBSTEP, remaining);
        simulate(slice);
        remaining -= slice;
        if (state !== 'running') break;
    }
}

function decayEffects(dt) {
    if (flashTimer > 0) flashTimer -= dt;
    if (shakeTimer > 0) shakeTimer -= dt;
    if (player.pourAnim > 0) player.pourAnim -= dt;
    for (let i = splashes.length - 1; i >= 0; i--) {
        const p = splashes[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 900 * dt;
        if (p.life <= 0) splashes.splice(i, 1);
    }
}

function simulate(dt) {
    decayEffects(dt);
    if (tapCooldown > 0) tapCooldown -= dt;

    updateSpawning(dt);
    updateCustomers(dt);
    updateMugs(dt);
}

function updateSpawning(dt) {
    if (!spawnEnabled) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval(level);
    if (customers.length >= MAX_CUSTOMERS) return;
    const lane = pickSpawnLane();
    if (lane >= 0) spawnCustomer(lane);
}

function updateCustomers(dt) {
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        c.bob = (c.bob + dt * 2) % 1;

        if (c.drinking) {
            const move = PUSHBACK_SPEED * dt;
            c.x -= move;
            c.pushRemaining -= move;
            c.drinkTimer -= dt;
            if (c.x <= EXIT_X) {
                serveCustomer(c, i);
                if (state !== 'running') return;
                continue;
            }
            if (c.pushRemaining <= 0 && c.drinkTimer <= 0) c.drinking = false;
        } else {
            c.x += customerSpeed() * dt;
            if (c.x >= GRAB_X) {
                loseLife('A CUSTOMER GOT TO YOU!');
                return;
            }
        }
    }
}

function updateMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        if (m.full) {
            m.x -= MUG_SPEED * dt;
            m.spin = (m.spin || 0) - dt * 6;
            const drinker = customerForMug(m);
            if (drinker) {
                mugs.splice(i, 1);
                drinker.drinking = true;
                drinker.pushRemaining = Math.max(0, drinker.pushRemaining) + PUSHBACK_DIST;
                drinker.drinkTimer = PUSHBACK_DIST / PUSHBACK_SPEED;
                splash(m.x, counterY(m.lane), '#ffd27a');
                continue;
            }
            if (m.x <= EXIT_X) {
                mugs.splice(i, 1);
                splash(EXIT_X, counterY(m.lane), '#8fd8ff');
                loseLife('A MUG HIT THE FLOOR!');
                return;
            }
        } else {
            m.x += EMPTY_SPEED * dt;
            m.spin = (m.spin || 0) + dt * 6;
            if (m.x >= CATCH_X && player.lane === m.lane) {
                mugs.splice(i, 1);
                score += CATCH_POINTS * level;
                splash(CATCH_X, counterY(m.lane), '#8fd8ff');
                updateHud();
                continue;
            }
            if (m.x >= MUG_SMASH_X) {
                mugs.splice(i, 1);
                splash(MUG_SMASH_X, counterY(m.lane), '#8fd8ff');
                loseLife('YOU MISSED AN EMPTY!');
                return;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const COUNTER_TOP_OFFSET = 26;      // counter surface, relative to the lane line
const COUNTER_THICKNESS = 12;

function counterY(lane) {
    return laneY(lane) + COUNTER_TOP_OFFSET;
}

function draw() {
    ctx.save();
    if (shakeTimer > 0) {
        const s = shakeTimer * 12;
        ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    drawRoom();
    // One lane at a time, back to front: the crowd stands behind its counter,
    // the mugs slide along the top of it.
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        drawLaneFloor(lane);
        for (const c of customers) if (c.lane === lane) drawCustomer(c);
        drawCounter(lane);
        for (const m of mugs) if (m.lane === lane) drawMug(m);
    }
    drawServer();
    drawSplashes();
    drawFlash();

    ctx.restore();
}

function drawRoom() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#33200f');
    g.addColorStop(0.5, '#22150c');
    g.addColorStop(1, '#160e08');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Wall panelling.
    ctx.strokeStyle = 'rgba(255, 214, 160, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_W; x += 36) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CANVAS_H);
        ctx.stroke();
    }

    // The doorway the customers come through, on the far left.
    const door = ctx.createLinearGradient(0, 0, EXIT_X + 12, 0);
    door.addColorStop(0, 'rgba(140, 210, 255, 0.20)');
    door.addColorStop(1, 'rgba(140, 210, 255, 0)');
    ctx.fillStyle = door;
    ctx.fillRect(0, 0, EXIT_X + 12, CANVAS_H);
    ctx.strokeStyle = 'rgba(160, 220, 255, 0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(EXIT_X - 8.5, 0);
    ctx.lineTo(EXIT_X - 8.5, CANVAS_H);
    ctx.stroke();

    // The service station, on the right.
    const bar = ctx.createLinearGradient(SERVER_X - 20, 0, CANVAS_W, 0);
    bar.addColorStop(0, 'rgba(255, 181, 69, 0.04)');
    bar.addColorStop(1, 'rgba(255, 181, 69, 0.14)');
    ctx.fillStyle = bar;
    ctx.fillRect(SERVER_X - 20, 0, CANVAS_W - SERVER_X + 20, CANVAS_H);
    ctx.strokeStyle = 'rgba(255, 181, 69, 0.25)';
    ctx.beginPath();
    ctx.moveTo(SERVER_X - 20.5, 0);
    ctx.lineTo(SERVER_X - 20.5, CANVAS_H);
    ctx.stroke();
}

function drawLaneFloor(lane) {
    const y = counterY(lane);
    // A pool of light over each counter, so four lanes read as four rooms.
    const glow = ctx.createRadialGradient(CANVAS_W / 2, y - 60, 10, CANVAS_W / 2, y - 60, 330);
    glow.addColorStop(0, 'rgba(255, 205, 130, 0.10)');
    glow.addColorStop(1, 'rgba(255, 205, 130, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, y - 96, CANVAS_W, 110);
}

function drawCounter(lane) {
    const y = counterY(lane);
    const x0 = EXIT_X - 8;
    const x1 = SERVER_X - 12;
    const w = x1 - x0;

    // Front face, then the polished top.
    ctx.fillStyle = '#4a2a16';
    ctx.fillRect(x0, y + COUNTER_THICKNESS, w, 16);
    ctx.fillStyle = '#7b4a27';
    ctx.fillRect(x0, y, w, COUNTER_THICKNESS);
    const sheen = ctx.createLinearGradient(0, y, 0, y + COUNTER_THICKNESS);
    sheen.addColorStop(0, 'rgba(255, 226, 180, 0.45)');
    sheen.addColorStop(0.35, 'rgba(255, 226, 180, 0.06)');
    sheen.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x0, y, w, COUNTER_THICKNESS);

    // Grain.
    ctx.strokeStyle = 'rgba(60, 32, 16, 0.35)';
    ctx.lineWidth = 1;
    for (let x = x0 + 18; x < x1; x += 46) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y + COUNTER_THICKNESS + 3);
        ctx.lineTo(x + 0.5, y + COUNTER_THICKNESS + 14);
        ctx.stroke();
    }

    // The counter you are standing at gets a warm edge.
    if (lane === player.lane && state !== 'over') {
        ctx.strokeStyle = 'rgba(255, 181, 69, 0.65)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + 1, y - 1, w - 2, COUNTER_THICKNESS + 2);
    }
}

function drawCustomer(c) {
    const base = counterY(c.lane) + 6;        // feet tuck in behind the counter
    const bob = c.drinking ? 0 : Math.sin(c.bob * Math.PI * 2) * 2;
    const y = base + bob;
    const body = `hsl(${c.hue}, 48%, 44%)`;
    const shade = `hsl(${c.hue}, 48%, 30%)`;

    // Shadow on the floor.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(c.x, base + 8, 13, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Arms — one on the counter, waiting.
    ctx.strokeStyle = shade;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c.x + 8, y - 34);
    ctx.lineTo(c.x + 16, y - 22);
    ctx.stroke();

    // Torso
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(c.x - 12, y - 42, 24, 40, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(c.x - 12, y - 14, 24, 12);

    // Head
    ctx.fillStyle = '#f2c69c';
    ctx.beginPath();
    ctx.arc(c.x, y - 52, 10, 0, Math.PI * 2);
    ctx.fill();

    // Cap
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.roundRect(c.x - 11, y - 62, 22, 8, 3);
    ctx.fill();
    ctx.fillRect(c.x - 2, y - 62, 13, 3);

    if (c.drinking) {
        // Mug tipped up, and a couple of happy bubbles.
        ctx.fillStyle = '#ffd27a';
        ctx.beginPath();
        ctx.roundRect(c.x + 5, y - 60, 10, 12, 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 240, 200, 0.7)';
        ctx.beginPath();
        ctx.arc(c.x + 16, y - 66 - (c.bob * 6), 2.2, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.fillStyle = '#2b1a10';
        ctx.fillRect(c.x + 1, y - 55, 2.5, 3.5);
        ctx.fillRect(c.x + 6, y - 55, 2.5, 3.5);
        // A frown that deepens the closer they get to the station.
        const impatience = clamp((c.x - COUNTER_LEFT) / (GRAB_X - COUNTER_LEFT), 0, 1);
        ctx.strokeStyle = `rgba(120, 40, 30, ${0.35 + impatience * 0.65})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(c.x + 4, y - 45 + impatience * 3, 4, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
    }
}

function drawMug(m) {
    const y = counterY(m.lane) - 2;           // sitting on the counter top
    const wobble = Math.sin(m.spin || 0) * 1.2;
    const top = y - 18 + wobble;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(m.x, y + 1, 9, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Handle behind the glass.
    ctx.strokeStyle = m.full ? '#eae2d2' : '#b9c2cb';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(m.x + 9, top + 9, 4.5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    // Glass
    ctx.fillStyle = m.full ? 'rgba(246, 241, 230, 0.95)' : 'rgba(190, 200, 210, 0.75)';
    ctx.beginPath();
    ctx.roundRect(m.x - 8, top, 16, 18, 3);
    ctx.fill();

    if (m.full) {
        ctx.fillStyle = '#e0912a';
        ctx.beginPath();
        ctx.roundRect(m.x - 6, top + 7, 12, 9, 2);
        ctx.fill();
        ctx.fillStyle = '#fffaf0';
        ctx.beginPath();
        ctx.roundRect(m.x - 7, top + 1, 14, 7, 3);
        ctx.fill();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(m.x - 5, top + 3);
    ctx.lineTo(m.x - 5, top + 15);
    ctx.stroke();
}

function drawServer() {
    const y = counterY(player.lane) + 6;
    const pouring = player.pourAnim > 0;
    const lean = pouring ? -3 : 0;

    // The tap rig.
    ctx.fillStyle = '#c9d3dd';
    ctx.fillRect(SERVER_X - 26, y - 62, 6, 34);
    ctx.beginPath();
    ctx.roundRect(SERVER_X - 32, y - 66, 20, 6, 3);
    ctx.fill();
    ctx.fillStyle = '#8e9aa6';
    ctx.fillRect(SERVER_X - 30, y - 30, 14, 4);
    if (pouring) {
        ctx.fillStyle = '#ffcf6b';
        ctx.fillRect(SERVER_X - 25, y - 30, 4, 14);
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(SERVER_X + 10, y + 8, 16, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body, apron, arm reaching for the tap.
    ctx.fillStyle = '#f2f4f8';
    ctx.beginPath();
    ctx.roundRect(SERVER_X - 4 + lean, y - 44, 28, 44, 7);
    ctx.fill();
    ctx.fillStyle = '#ffb545';
    ctx.beginPath();
    ctx.roundRect(SERVER_X - 4 + lean, y - 20, 28, 20, 4);
    ctx.fill();

    ctx.strokeStyle = '#f2f4f8';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(SERVER_X - 2 + lean, y - 38);
    ctx.lineTo(SERVER_X - 20, pouring ? y - 34 : y - 26);
    ctx.stroke();

    // Head & soda-jerk cap.
    ctx.fillStyle = '#f2c69c';
    ctx.beginPath();
    ctx.arc(SERVER_X + 10 + lean, y - 54, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b1a10';
    ctx.fillRect(SERVER_X + 2 + lean, y - 57, 2.5, 3.5);
    ctx.fillRect(SERVER_X + 8 + lean, y - 57, 2.5, 3.5);
    ctx.fillStyle = '#f2f4f8';
    ctx.beginPath();
    ctx.roundRect(SERVER_X - 1 + lean, y - 70, 22, 9, 3);
    ctx.fill();
    ctx.fillStyle = '#ffb545';
    ctx.fillRect(SERVER_X - 1 + lean, y - 63, 22, 2.5);
}

function drawSplashes() {
    for (const p of splashes) {
        ctx.globalAlpha = clamp(p.life / 0.45, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

function drawFlash() {
    if (flashTimer <= 0 || !flashText) return;
    ctx.globalAlpha = clamp(flashTimer / 1.4, 0, 1);
    ctx.textAlign = 'center';
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillText(flashText, CANVAS_W / 2 + 2, 50);
    ctx.fillStyle = '#ffb545';
    ctx.fillText(flashText, CANVAS_W / 2, 48);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
}


// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTs = 0;

function frame(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running' || state === 'paused') {
            togglePause();
            e.preventDefault();
        }
        return;
    }

    if (k === ' ' || k === 'Spacebar' || k === 'f' || k === 'F') {
        if (state === 'idle' || state === 'over') startGame();
        else pour();
        e.preventDefault();
        return;
    }

    if (k === 'ArrowUp' || k === 'w' || k === 'W') {
        moveLane(-1);
        e.preventDefault();
        return;
    }

    if (k === 'ArrowDown' || k === 's' || k === 'S') {
        moveLane(1);
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else if (state !== 'running') startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

try {
    best = parseInt(localStorage.getItem('soda-tapper-best') || '0', 10) || 0;
} catch (err) {
    best = 0;
}
updateHud();
requestAnimationFrame(frame);
