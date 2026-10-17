// ---------------------------------------------------------------------------
// Soda Tapper — four counters, one pair of hands.
//
// Customers push in through the doors at the far (left) end of each counter and
// walk towards the taps on the right. A drink slid down the counter pushes one
// of them back; push a customer out of the door and they leave satisfied. The
// catch is that every drink comes back as an empty glass sliding towards you,
// and an empty that arrives at a tap you are not standing at smashes.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Gold Runner,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Geometry ------------------------------------------------------------
const CANVAS_W = 720;
const CANVAS_H = 480;

const LANES = 4;
const LANE_H = 96;          // counter pitch
const LANE_TOP = 48;        // y of the first counter's band
const COUNTER_LEFT = 60;    // far end: customers enter, glasses smash
const COUNTER_RIGHT = 620;  // tap end: the bartender's side

// Centre line of counter `i`.
function laneY(i) {
    return LANE_TOP + LANE_H * i + LANE_H / 2;
}

// Top surface of counter `i`. Everything on the bar — glasses, the feet of the
// people standing behind it — is positioned against this line.
function slabY(i) {
    return laneY(i) + 14;
}

// --- Tuning --------------------------------------------------------------
const MUG_SPEED = 260;      // a full drink sliding away from the taps
const EMPTY_SPEED = 200;    // an empty glass sliding back towards them
const SLIDE_SPEED = 180;    // a drinking customer skidding backwards
const PUSH_DIST = 150;      // how far one drink pushes a customer
const CATCH_DIST = 16;      // reach of a customer for a passing drink
const SERVE_COOLDOWN = 0.18;
const BANNER_TIME = 1.5;    // quiet pause at the top of each wave

const START_LIVES = 3;
const SERVE_POINTS = 50;
const EMPTY_POINTS = 10;
const EXIT_POINTS = 100;
const LEVEL_BONUS = 200;

const WAVE_BASE = 6;        // customers in wave 1
const WAVE_STEP = 2;
const SPAWN_BASE = 2.4;     // seconds between arrivals in wave 1
const SPAWN_STEP = 0.15;
const SPAWN_MIN = 0.8;
const CUSTOMER_SPEED_BASE = 28;
const CUSTOMER_SPEED_STEP = 5;

function spawnIntervalFor(lvl) {
    return Math.max(SPAWN_MIN, SPAWN_BASE - SPAWN_STEP * (lvl - 1));
}

function waveSizeFor(lvl) {
    return WAVE_BASE + WAVE_STEP * (lvl - 1);
}

function customerSpeedFor(lvl) {
    return CUSTOMER_SPEED_BASE + CUSTOMER_SPEED_STEP * (lvl - 1);
}

// --- State ---------------------------------------------------------------
let state = 'idle';         // idle | playing | paused | gameover
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let served = 0;

let bartenderLane = 0;
let customers = [];         // { lane, x, state: 'advancing' | 'sliding', slideLeft }
let mugs = [];              // { lane, x } travelling left
let empties = [];           // { lane, x } travelling right

let spawned = 0;            // customers released in the current wave
let waveSize = WAVE_BASE;
let spawnTimer = 0;
let customerSpeed = CUSTOMER_SPEED_BASE;
let serveTimer = 0;
let bannerTimer = 0;
let banner = '';
let autoStep = true;        // the tests drive step() themselves with this off

// --- Seeded RNG ----------------------------------------------------------
// A plain LCG so a spec can replay the same sequence of lanes.
let rngSeed = 1;

function setSeed(n) {
    rngSeed = (n >>> 0) || 1;
}

function rand() {
    rngSeed = (Math.imul(rngSeed, 1664525) + 1013904223) >>> 0;
    return rngSeed / 4294967296;
}

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elServed = document.getElementById('served');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

function updateHud() {
    elScore.textContent = score;
    elServed.textContent = served;
    elLevel.textContent = level;
    elLives.textContent = Math.max(0, lives);
    elBest.textContent = best;
}

function showOverlay(title, scoreLine, sub, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    btnStart.textContent = button || 'Start Shift';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Wave management
// ---------------------------------------------------------------------------

function startWave() {
    waveSize = waveSizeFor(level);
    customerSpeed = customerSpeedFor(level);
    spawned = 0;
    spawnTimer = spawnIntervalFor(level);
    bannerTimer = BANNER_TIME;
    banner = 'LEVEL ' + level;
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    served = 0;
    bartenderLane = 0;
    customers = [];
    mugs = [];
    empties = [];
    serveTimer = 0;
    state = 'playing';
    startWave();
    updateHud();
    hideOverlay();
}

function spawnCustomer(lane) {
    customers.push({ lane, x: COUNTER_LEFT, state: 'advancing', slideLeft: 0 });
}

// Release the next customer of the wave into a randomly chosen counter.
function spawnNextCustomer() {
    spawnCustomer(Math.floor(rand() * LANES));
    spawned++;
}

// A wave is over once everybody has walked in and the bar is clear — no
// customers, no drinks still sliding and no empties still to be caught.
function waveIsClear() {
    return spawned >= waveSize &&
        customers.length === 0 &&
        mugs.length === 0 &&
        empties.length === 0;
}

function clearBar() {
    customers.length = 0;
    mugs.length = 0;
    empties.length = 0;
}

function loseLife() {
    lives--;
    clearBar();
    updateHud();
    if (lives <= 0) {
        gameOver();
    }
}

function gameOver() {
    state = 'gameover';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('sodatapper-best', String(best));
        } catch (e) {
            /* private mode — the run just will not be remembered */
        }
    }
    updateHud();
    showOverlay('SHIFT OVER', 'Score ' + score + ' · Served ' + served,
        'Press Space to work another shift', 'Play Again');
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function serve() {
    if (state !== 'playing' || serveTimer > 0) return;
    mugs.push({ lane: bartenderLane, x: COUNTER_RIGHT });
    serveTimer = SERVE_COOLDOWN;
}

function moveBartender(delta) {
    if (state !== 'playing') return;
    bartenderLane = Math.max(0, Math.min(LANES - 1, bartenderLane + delta));
}

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to get back to work', 'Resume');
    } else if (state === 'paused') {
        state = 'playing';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

// A drink only ever moves left and customers only ever start to its left, so
// the test is monotone and cannot tunnel: the drink is taken by the right-most
// customer in the lane it has reached.
function catcherFor(mug) {
    let best = null;
    for (const c of customers) {
        if (c.lane !== mug.lane) continue;
        if (c.x < mug.x - CATCH_DIST) continue;
        if (!best || c.x > best.x) best = c;
    }
    return best;
}

function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const mug = mugs[i];
        mug.x -= MUG_SPEED * dt;

        const customer = catcherFor(mug);
        if (customer) {
            mugs.splice(i, 1);
            customer.state = 'sliding';
            customer.slideLeft = PUSH_DIST;
            empties.push({ lane: customer.lane, x: customer.x });
            score += SERVE_POINTS;
            updateHud();
            continue;
        }

        if (mug.x <= COUNTER_LEFT) {
            mugs.splice(i, 1);
            loseLife();
            return;             // the bar was just cleared
        }
    }
}

function stepCustomers(dt) {
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];

        if (c.state === 'sliding') {
            const slid = Math.min(SLIDE_SPEED * dt, c.slideLeft);
            c.x -= slid;
            c.slideLeft -= slid;
            if (c.slideLeft <= 0) c.state = 'advancing';

            if (c.x <= COUNTER_LEFT) {
                customers.splice(i, 1);
                served++;
                score += EXIT_POINTS;
                updateHud();
            }
            continue;
        }

        c.x += customerSpeed * dt;
        if (c.x >= COUNTER_RIGHT) {
            loseLife();
            return;             // the bar was just cleared
        }
    }
}

function stepEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const empty = empties[i];
        empty.x += EMPTY_SPEED * dt;
        if (empty.x < COUNTER_RIGHT) continue;

        const caught = empty.lane === bartenderLane;
        empties.splice(i, 1);
        if (caught) {
            score += EMPTY_POINTS;
            updateHud();
        } else {
            loseLife();
            return;             // the bar was just cleared
        }
    }
}

function stepSpawning(dt) {
    if (bannerTimer > 0) {
        bannerTimer = Math.max(0, bannerTimer - dt);
        return;
    }
    if (spawned >= waveSize) return;
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawnNextCustomer();
        spawnTimer = spawnIntervalFor(level);
    }
}

function step(dt) {
    if (state !== 'playing') return;

    if (serveTimer > 0) serveTimer = Math.max(0, serveTimer - dt);

    stepMugs(dt);
    if (state !== 'playing') return;
    stepCustomers(dt);
    if (state !== 'playing') return;
    stepEmpties(dt);
    if (state !== 'playing') return;
    stepSpawning(dt);

    if (waveIsClear()) {
        level++;
        score += LEVEL_BONUS;
        startWave();
        updateHud();
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawBackground() {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#1e1430');
    grad.addColorStop(1, '#120d1b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Back wall panelling, just enough to stop the room reading as a void.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 1;
    for (let x = 20; x < CANVAS_W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CANVAS_H);
        ctx.stroke();
    }

    // The tap bank runs the full height of the bar behind the bartender.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(COUNTER_RIGHT + 24, 0, CANVAS_W - COUNTER_RIGHT - 24, CANVAS_H);
}

// The room around the counters: trim and lamps above, the plumbing that feeds
// the taps on the right, and a floor with a few crates of empties below.
function drawRoom() {
    ctx.fillStyle = 'rgba(255, 179, 71, 0.10)';
    ctx.fillRect(0, 0, CANVAS_W, 5);

    for (let x = 90; x < CANVAS_W - 60; x += 170) {
        ctx.fillStyle = '#2b2040';
        ctx.fillRect(x - 1, 5, 2, 15);
        ctx.fillStyle = 'rgba(255, 202, 128, 0.45)';
        ctx.beginPath();
        ctx.moveTo(x - 11, 31);
        ctx.lineTo(x + 11, 31);
        ctx.lineTo(x + 5, 20);
        ctx.lineTo(x - 5, 20);
        ctx.closePath();
        ctx.fill();
    }

    ctx.fillStyle = '#3c485c';
    ctx.fillRect(COUNTER_RIGHT + 17, 26, 7, CANVAS_H - 86);

    const floorY = CANVAS_H - 46;
    ctx.fillStyle = '#15101f';
    ctx.fillRect(0, floorY, CANVAS_W, 46);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(0, floorY, CANVAS_W, 2);

    for (const [cx, cy] of [[64, floorY + 6], [112, floorY + 14], [540, floorY + 10]]) {
        ctx.fillStyle = '#3b2a18';
        ctx.fillRect(cx, cy, 34, 26);
        ctx.strokeStyle = '#5d4426';
        ctx.lineWidth = 2;
        ctx.strokeRect(cx, cy, 34, 26);
        ctx.beginPath();
        ctx.moveTo(cx, cy + 13);
        ctx.lineTo(cx + 34, cy + 13);
        ctx.moveTo(cx + 17, cy);
        ctx.lineTo(cx + 17, cy + 26);
        ctx.stroke();
    }
}

function drawDoor(i) {
    const y = laneY(i);
    const bottom = slabY(i) + 8;

    ctx.fillStyle = '#241a36';
    ctx.fillRect(12, y - 46, 40, bottom - (y - 46));
    ctx.strokeStyle = '#44335f';
    ctx.lineWidth = 2;
    ctx.strokeRect(12, y - 46, 40, bottom - (y - 46));

    // A sliver of street light in the doorway.
    ctx.fillStyle = 'rgba(255, 179, 71, 0.16)';
    ctx.fillRect(16, y - 42, 8, bottom - (y - 42) - 4);
}

function drawTap(i) {
    const y = laneY(i);
    const x = COUNTER_RIGHT + 14;

    ctx.fillStyle = '#56657f';
    ctx.fillRect(x, y - 40, 9, 30);
    ctx.fillRect(x - 10, y - 20, 19, 7);
    ctx.fillStyle = '#a8bbd6';
    ctx.fillRect(x - 3, y - 45, 15, 6);
}

function drawCounter(i) {
    const slab = slabY(i);
    const left = COUNTER_LEFT - 26;
    const width = COUNTER_RIGHT - left + 34;

    // Counter front, then the slab on top of it.
    ctx.fillStyle = '#39220f';
    ctx.fillRect(left, slab, width, 14);

    const wood = ctx.createLinearGradient(0, slab - 11, 0, slab);
    wood.addColorStop(0, '#9a6630');
    wood.addColorStop(1, '#67401c');
    ctx.fillStyle = wood;
    ctx.fillRect(left, slab - 11, width, 11);

    ctx.fillStyle = 'rgba(255, 221, 173, 0.3)';
    ctx.fillRect(left, slab - 11, width, 3);
}

function drawCustomer(c) {
    const base = slabY(c.lane) - 10;      // feet tuck in behind the counter
    const drinking = c.state === 'sliding';
    const lean = drinking ? 4 : 0;

    ctx.save();
    ctx.translate(c.x, base);

    // Body.
    ctx.fillStyle = drinking ? '#6fd3a1' : '#e5657b';
    ctx.beginPath();
    ctx.ellipse(lean, -16, 11, 17, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head.
    ctx.fillStyle = '#f4d9b8';
    ctx.beginPath();
    ctx.arc(lean, -40, 8, 0, Math.PI * 2);
    ctx.fill();

    // A raised glass while drinking.
    if (drinking) {
        ctx.strokeStyle = '#ffe2a8';
        ctx.lineWidth = 2;
        ctx.strokeRect(lean + 9, -46, 7, 9);
    }

    ctx.restore();
}

function drawMug(m, full) {
    const base = slabY(m.lane) - 11;      // standing on the slab
    ctx.save();
    ctx.translate(m.x, base);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#dce8ff';

    if (full) {
        ctx.fillStyle = '#e0922f';
        ctx.fillRect(-6, -14, 12, 14);
        ctx.fillStyle = '#fff3d6';
        ctx.fillRect(-7, -18, 14, 5);
    }
    ctx.strokeRect(-6, -14, 12, 14);

    // Handle.
    ctx.beginPath();
    ctx.arc(8, -8, 4, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    ctx.restore();
}

function drawBartender() {
    const base = slabY(bartenderLane) - 10;
    const x = COUNTER_RIGHT + 52;

    ctx.save();
    ctx.translate(x, base);

    // Body and apron.
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.ellipse(0, -18, 13, 19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff3d6';
    ctx.fillRect(-9, -14, 18, 14);

    // Head and cap, so the lane the player is in reads at a glance.
    ctx.fillStyle = '#f4d9b8';
    ctx.beginPath();
    ctx.arc(0, -44, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff3d6';
    ctx.fillRect(-10, -56, 20, 5);

    ctx.restore();
}

function drawBanner() {
    if (bannerTimer <= 0 || state !== 'playing') return;
    ctx.fillStyle = 'rgba(10, 7, 16, 0.62)';
    ctx.fillRect(0, CANVAS_H / 2 - 34, CANVAS_W, 68);
    ctx.fillStyle = '#ffb347';
    ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner, CANVAS_W / 2, CANVAS_H / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

function draw() {
    drawBackground();
    drawRoom();
    for (let i = 0; i < LANES; i++) {
        drawDoor(i);
        drawTap(i);
    }
    // People and glasses are drawn before the counters so the counters overlap
    // their feet and everything looks like it is standing at the bar.
    for (const c of customers) drawCustomer(c);
    drawBartender();
    for (const m of mugs) drawMug(m, true);
    for (const e of empties) drawMug(e, false);
    for (let i = 0; i < LANES; i++) drawCounter(i);
    drawBanner();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (key === ' ' || key === 'Enter' || key === 'Spacebar') {
        e.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else serve();
        return;
    }

    if (key === 'p') {
        togglePause();
        return;
    }

    if (key === 'ArrowUp' || key === 'w') {
        e.preventDefault();
        moveBartender(-1);
    } else if (key === 'ArrowDown' || key === 's') {
        e.preventDefault();
        moveBartender(1);
    }
});

btnStart.addEventListener('click', () => {
    // Without this the button keeps keyboard focus and the next Space — which
    // the player means as "pour a drink" — would press it again.
    btnStart.blur();
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

best = parseInt(localStorage.getItem('sodatapper-best') || '0', 10) || 0;
setSeed(Date.now() % 2147483647);
waveSize = waveSizeFor(1);
customerSpeed = customerSpeedFor(1);
updateHud();
showOverlay('SODA TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
