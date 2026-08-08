// ---------------------------------------------------------------------------
// Soda Tapper — a four-lane counter-service arcade game on an HTML5 canvas.
//
// Customers push in through the doors on the left of each lane and shuffle right
// toward the taps. The player is the soda jerk: they stand in one lane at a time
// and slide mugs leftward down it. A mug knocks its customer back toward the
// doors and bounces an empty mug back, which has to be caught.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 720;
const CANVAS_H = 440;
const LANE_COUNT = 4;
const LANE_TOP = 48;               // y of the first lane's top edge
const LANE_H = 96;                 // height of one lane
const BAR_LEFT = 60;               // x of the doors (customers enter here)
const BAR_RIGHT = 660;             // x of the taps (the bartender stands here)

// --- Entities ---
const CUSTOMER_W = 26;
const MUG_W = 16;
const HIT_DIST = (CUSTOMER_W + MUG_W) / 2;  // mug/customer overlap threshold

// --- Speeds (px per second) ---
const MUG_SPEED = 380;             // full mugs sliding toward the doors
const EMPTY_SPEED = 210;           // empties sliding back toward the taps
const KNOCKBACK = 90;              // how far one mug pushes a customer back

// --- Pouring ---
const POUR_COOLDOWN = 0.22;        // seconds between mugs

// --- Lives ---
const START_LIVES = 3;
const MAX_LIVES = 5;

// --- Scoring ---
const POINTS_HIT = 10;             // a mug connects
const POINTS_SERVED = 50;          // a customer leaves happy
const POINTS_EMPTY = 25;           // an empty mug caught
const POINTS_LEVEL = 100;          // × level, for clearing a level

// --- Difficulty scaling (all pure functions of `level`) ---
const CUSTOMER_BASE = 34, CUSTOMER_STEP = 7, CUSTOMER_MAX = 95;
const SPAWN_BASE = 2.2, SPAWN_STEP = 0.18, SPAWN_MIN = 0.8;
const SPAWN_LEAD = 1.0;            // grace period before the first customer
const LEVEL_CUSTOMER_BASE = 4, LEVEL_CUSTOMER_STEP = 2;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, level, lives;
let spawnedThisLevel, servedThisLevel, spawnTimer, pourTimer, flash;
const player = { lane: 0 };
const customers = [];
const mugs = [];
const empties = [];
const splashes = [];   // purely decorative smash/serve puffs

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

function laneY(i) { return LANE_TOP + i * LANE_H + LANE_H / 2; }
function customerSpeed() { return Math.min(CUSTOMER_MAX, CUSTOMER_BASE + (level - 1) * CUSTOMER_STEP); }
function spawnInterval() { return Math.max(SPAWN_MIN, SPAWN_BASE - (level - 1) * SPAWN_STEP); }
function customersForLevel() { return LEVEL_CUSTOMER_BASE + LEVEL_CUSTOMER_STEP * level; }

// ---------------------------------------------------------------------------
// Entity factories
// ---------------------------------------------------------------------------

function spawnCustomer(lane, x) {
    const customer = { lane, x, bob: Math.random() * Math.PI * 2, tint: Math.floor(Math.random() * 4) };
    customers.push(customer);
    return customer;
}

function spawnMug(lane, x) {
    const mug = { lane, x };
    mugs.push(mug);
    return mug;
}

function spawnEmpty(lane, x) {
    const empty = { lane, x };
    empties.push(empty);
    return empty;
}

function addSplash(lane, x, color) {
    splashes.push({ lane, x, color, life: 0.35 });
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function setLane(i) {
    player.lane = Math.max(0, Math.min(LANE_COUNT - 1, i));
}

function moveLane(delta) {
    setLane(player.lane + delta);
}

// Pours a mug into the bartender's lane. Returns whether one was actually
// poured — the cooldown (and any non-running state) can refuse it.
function pourMug() {
    if (state !== 'running' || pourTimer > 0) return false;
    spawnMug(player.lane, BAR_RIGHT);
    pourTimer = POUR_COOLDOWN;
    return true;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

// The customer a mug is currently touching, or null. When a mug overlaps more
// than one, it serves the rightmost — the one it would physically meet first.
function mugTarget(mug) {
    let best = null;
    for (const customer of customers) {
        if (customer.lane !== mug.lane) continue;
        if (Math.abs(mug.x - customer.x) >= HIT_DIST) continue;
        if (!best || customer.x > best.x) best = customer;
    }
    return best;
}

function serveCustomer(customer) {
    score += POINTS_HIT;
    spawnEmpty(customer.lane, customer.x);
    addSplash(customer.lane, customer.x, '#f0a828');
    customer.x -= KNOCKBACK;
    if (customer.x <= BAR_LEFT) {
        customers.splice(customers.indexOf(customer), 1);
        score += POINTS_SERVED;
        servedThisLevel++;
    }
}

function loseLife() {
    lives = Math.max(0, lives - 1);
    mugs.length = 0;
    empties.length = 0;
    flash = 0.3;
    updateHud();
    if (lives === 0) endGame();
}

function nextLevel() {
    score += POINTS_LEVEL * level;
    level++;
    lives = Math.min(MAX_LIVES, lives + 1);
    spawnedThisLevel = 0;
    servedThisLevel = 0;
    spawnTimer = SPAWN_LEAD;
    mugs.length = 0;
    empties.length = 0;
}

// Picks a lane whose doorway is clear, so arrivals never stack on top of each
// other. Returns -1 when every doorway is occupied.
function freeSpawnLane() {
    const open = [];
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const blocked = customers.some(
            (c) => c.lane === lane && c.x < BAR_LEFT + CUSTOMER_W * 1.5);
        if (!blocked) open.push(lane);
    }
    if (!open.length) return -1;
    return open[Math.floor(Math.random() * open.length)];
}

function step(dt) {
    if (state !== 'running') return;

    pourTimer = Math.max(0, pourTimer - dt);
    flash = Math.max(0, flash - dt);
    for (let i = splashes.length - 1; i >= 0; i--) {
        splashes[i].life -= dt;
        if (splashes[i].life <= 0) splashes.splice(i, 1);
    }

    // --- Arrivals ---
    if (spawnedThisLevel < customersForLevel()) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            const lane = freeSpawnLane();
            if (lane >= 0) {
                spawnCustomer(lane, BAR_LEFT);
                spawnedThisLevel++;
                spawnTimer = spawnInterval();
            } else {
                spawnTimer = 0.2;   // doorways full — try again shortly
            }
        }
    }

    // Life losses are counted up and applied after every array has been walked,
    // so a single frame can never mutate a list mid-iteration (loseLife clears
    // the mugs and empties) nor double-charge the player.
    let lost = 0;

    // --- Customers walk toward the taps ---
    const walk = customerSpeed() * dt;
    for (let i = customers.length - 1; i >= 0; i--) {
        const customer = customers[i];
        customer.x += walk;
        customer.bob += dt * 9;
        if (customer.x >= BAR_RIGHT) {
            customers.splice(i, 1);
            addSplash(customer.lane, BAR_RIGHT, '#ef6b4b');
            lost++;
        }
    }

    // --- Full mugs slide toward the doors ---
    for (let i = mugs.length - 1; i >= 0; i--) {
        const mug = mugs[i];
        mug.x -= MUG_SPEED * dt;
        const target = mugTarget(mug);
        if (target) {
            mugs.splice(i, 1);
            serveCustomer(target);
            continue;
        }
        if (mug.x <= BAR_LEFT) {
            mugs.splice(i, 1);
            addSplash(mug.lane, BAR_LEFT, '#ef6b4b');
            lost++;
        }
    }

    // --- Empty mugs slide back toward the taps ---
    for (let i = empties.length - 1; i >= 0; i--) {
        const empty = empties[i];
        empty.x += EMPTY_SPEED * dt;
        if (empty.x >= BAR_RIGHT) {
            empties.splice(i, 1);
            if (empty.lane === player.lane) {
                score += POINTS_EMPTY;
                addSplash(empty.lane, BAR_RIGHT, '#7fd4a0');
            } else {
                addSplash(empty.lane, BAR_RIGHT, '#ef6b4b');
                lost++;
            }
        }
    }

    for (let i = 0; i < lost && state === 'running'; i++) loseLife();

    // --- Level complete? ---
    // Keyed on every customer for the level having arrived and the counter being
    // clear, so a customer lost to the taps can't leave the level unwinnable.
    if (state === 'running' && spawnedThisLevel >= customersForLevel() && customers.length === 0) {
        nextLevel();
    }

    updateHud();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    lives = START_LIVES;
    spawnedThisLevel = 0;
    servedThisLevel = 0;
    spawnTimer = SPAWN_LEAD;
    pourTimer = 0;
    flash = 0;
    customers.length = 0;
    mugs.length = 0;
    empties.length = 0;
    splashes.length = 0;
    player.lane = 0;
    hideOverlay();
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('soda-tapper-best', String(best)); } catch (e) { /* private mode */ }
    }
    updateHud();
    showOverlay('SHIFT OVER', `Score ${score} · Level ${level}`, 'Press Space to pull another shift', 'Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to get back behind the bar', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    bestEl.textContent = String(best);
}

function showOverlay(title, sub1, sub2, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub1;
    overlaySub.textContent = sub2;
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const CUSTOMER_TINTS = ['#6fa8dc', '#c98bd8', '#7fd4a0', '#e0b464'];

// Every lane is drawn around a single reference line: `laneY(i)` is the counter
// surface. Customers stand behind it (up the screen), mugs slide along it.
const SURFACE = 10;   // counter top, relative to laneY
const BAR_TH = 14;    // counter thickness

function drawCounter() {
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const y = laneY(lane);
        const top = LANE_TOP + lane * LANE_H;

        // lane floor
        ctx.fillStyle = lane % 2 ? '#1b120b' : '#1f150d';
        ctx.fillRect(0, top, CANVAS_W, LANE_H);
        ctx.fillStyle = '#100b06';
        ctx.fillRect(0, top, CANVAS_W, 2);

        // the doors on the left
        ctx.fillStyle = '#2c1d12';
        ctx.fillRect(8, top + 10, 38, LANE_H - 26);
        ctx.strokeStyle = '#4a3524';
        ctx.lineWidth = 2;
        ctx.strokeRect(8, top + 10, 38, LANE_H - 26);
        ctx.fillStyle = '#4a3524';
        ctx.fillRect(26, top + 18, 3, LANE_H - 42);

        // the counter itself
        ctx.fillStyle = '#5c3a1e';
        ctx.fillRect(BAR_LEFT - 14, y + SURFACE, BAR_RIGHT - BAR_LEFT + 32, BAR_TH);
        ctx.fillStyle = '#8a5a2f';
        ctx.fillRect(BAR_LEFT - 14, y + SURFACE, BAR_RIGHT - BAR_LEFT + 32, 4);
        ctx.fillStyle = '#3a2412';
        ctx.fillRect(BAR_LEFT - 14, y + SURFACE + BAR_TH - 3, BAR_RIGHT - BAR_LEFT + 32, 3);

        // the tap on the right
        ctx.fillStyle = '#3a2a18';
        ctx.fillRect(BAR_RIGHT + 6, top + 12, 10, LANE_H - 34);
        ctx.fillStyle = '#f0a828';
        ctx.fillRect(BAR_RIGHT + 2, y - 10, 14, 6);
        ctx.fillRect(BAR_RIGHT + 2, y - 4, 5, 10);
    }
}

function drawBartender() {
    const y = laneY(player.lane);
    const x = BAR_RIGHT + 42;
    const base = y + SURFACE;
    ctx.fillStyle = '#f0a828';
    ctx.fillRect(x - 12, base - 26, 24, 26);        // apron / body
    ctx.fillStyle = '#e8c9a0';
    ctx.fillRect(x - 9, base - 42, 18, 16);         // head
    ctx.fillStyle = '#f4e9d8';
    ctx.fillRect(x - 11, base - 46, 22, 5);         // soda-jerk cap
    ctx.fillStyle = '#241505';
    ctx.fillRect(x - 7, base - 37, 3, 3);           // eyes, facing the counter
    ctx.fillRect(x - 1, base - 37, 3, 3);
    // arm reaching over the counter, pumping while the tap is recharging
    const reach = pourTimer > 0 ? 22 : 15;
    ctx.fillStyle = '#e8c9a0';
    ctx.fillRect(x - 12 - reach, base - 20, reach, 6);
}

function drawCustomer(customer) {
    const base = laneY(customer.lane) + SURFACE + Math.sin(customer.bob) * 1.5;
    const x = customer.x;
    ctx.fillStyle = CUSTOMER_TINTS[customer.tint % CUSTOMER_TINTS.length];
    ctx.fillRect(x - CUSTOMER_W / 2, base - 24, CUSTOMER_W, 24);   // body
    ctx.fillStyle = '#e8c9a0';
    ctx.fillRect(x - 9, base - 40, 18, 16);                        // head
    ctx.fillStyle = '#241505';
    ctx.fillRect(x + 1, base - 35, 3, 3);                          // eyes, facing the taps
    ctx.fillRect(x + 6, base - 35, 3, 3);
    ctx.fillStyle = '#e8c9a0';
    ctx.fillRect(x + CUSTOMER_W / 2 - 2, base - 18, 8, 5);         // outstretched hand
}

function drawMug(mug, full) {
    const y = laneY(mug.lane) + SURFACE;
    const x = mug.x;
    ctx.fillStyle = '#d8dde6';
    ctx.fillRect(x - MUG_W / 2, y - 18, MUG_W, 18);
    if (full) {
        ctx.fillStyle = '#c2701c';
        ctx.fillRect(x - MUG_W / 2 + 2, y - 12, MUG_W - 4, 10);
        ctx.fillStyle = '#fff6e2';
        ctx.fillRect(x - MUG_W / 2 + 2, y - 16, MUG_W - 4, 4);     // foam
    } else {
        ctx.fillStyle = '#a9b0bb';
        ctx.fillRect(x - MUG_W / 2 + 2, y - 5, MUG_W - 4, 3);      // dregs
    }
    ctx.fillStyle = '#8f97a3';
    ctx.fillRect(x + MUG_W / 2, y - 14, 5, 3);                     // handle
    ctx.fillRect(x + MUG_W / 2 + 2, y - 14, 3, 9);
    ctx.fillRect(x + MUG_W / 2, y - 8, 5, 3);
}

function drawSplash(splash) {
    const y = laneY(splash.lane) + SURFACE - 8;
    const t = splash.life / 0.35;
    ctx.globalAlpha = Math.max(0, t);
    ctx.fillStyle = splash.color;
    const r = 6 + (1 - t) * 16;
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.fillRect(splash.x + Math.cos(a) * r - 2, y + Math.sin(a) * r - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

function draw() {
    ctx.fillStyle = '#120c07';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawCounter();
    for (const customer of customers) drawCustomer(customer);
    for (const mug of mugs) drawMug(mug, true);
    for (const empty of empties) drawMug(empty, false);
    for (const splash of splashes) drawSplash(splash);
    drawBartender();

    // level banner
    ctx.fillStyle = '#9c8871';
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    if (state === 'idle') {
        ctx.fillText('Serve them before they reach the taps', 12, 30);
    } else {
        const left = Math.max(0, customersForLevel() - spawnedThisLevel) + customers.length;
        ctx.fillText(`Level ${level} — ${left} customer${left === 1 ? '' : 's'} left`, 12, 30);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f0a828';
    ctx.fillText('♥'.repeat(Math.max(0, lives)), CANVAS_W - 12, 30);
    ctx.textAlign = 'left';

    if (flash > 0) {
        ctx.fillStyle = `rgba(239, 107, 75, ${Math.min(0.45, flash)})`;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
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

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') pourMug();
        e.preventDefault();
        return;
    }
    if (['ArrowUp', 'w', 'W'].includes(e.key)) {
        moveLane(-1);
        e.preventDefault();
        return;
    }
    if (['ArrowDown', 's', 'S'].includes(e.key)) {
        moveLane(1);
        e.preventDefault();
    }
});

canvas.addEventListener('mousedown', (e) => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    setLane(Math.floor((y - LANE_TOP) / LANE_H));
    pourMug();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = 0;
try { best = parseInt(localStorage.getItem('soda-tapper-best') || '0', 10) || 0; } catch (e) { /* private mode */ }
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
spawnedThisLevel = 0;
servedThisLevel = 0;
spawnTimer = SPAWN_LEAD;
pourTimer = 0;
flash = 0;
updateHud();
requestAnimationFrame(frame);
