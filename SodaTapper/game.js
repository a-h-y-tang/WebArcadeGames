// ---------------------------------------------------------------------------
// Soda Tapper
//
// Four counters, one bartender. Slide full mugs left to push advancing
// customers back toward the door, and catch the empties they shove back.
//
// All state is deliberately kept as top-level globals and the simulation is a
// single pure-ish `step(dt)`, separate from `draw()` and from the animation
// frame loop, so the Playwright specs can drive the game deterministically.
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elServed = document.getElementById('served');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const LANE_COUNT = 4;
const LANE_Y = [118, 212, 306, 400]; // y of the counter surface each lane sits on
const BAR_LEFT = 70;
const BAR_RIGHT = 566;
const COUNTER_H = 16;
const MUG_W = 16;
const MUG_H = 22;
const CUSTOMER_W = 26;
const CATCH_DIST = 24; // how close a sliding mug gets before a customer grabs it

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const START_LIVES = 3;
const MUG_SPEED = 260; // px/s, full mug sliding left
const EMPTY_SPEED = 200; // px/s, empty mug sliding back right
const SERVE_COOLDOWN = 0.18; // s between pours
const DRINK_TIME = 0.7; // s a customer stands still drinking
const PUSH_BACK = 86; // px a customer is shoved back per drink
const FLASH_TIME = 0.35; // s a lane stays highlighted after a mistake
const LEVEL_PAUSE = 1.6; // s of "shift complete" interlude

const SCORE_SERVE = 50; // a customer catches a mug
const SCORE_CATCH = 25; // an empty mug is caught
const SCORE_CLEAR = 100; // a customer is pushed out of the door

const CUSTOMER_SPEED_BASE = 26; // px/s on shift 1
const CUSTOMER_SPEED_STEP = 6; // px/s added per shift
const SPAWN_BASE = 2.6; // s between arrivals on shift 1
const SPAWN_STEP = 0.25; // s removed per shift
const SPAWN_MIN = 0.9; // s floor between arrivals
const FIRST_SPAWN = 1.2; // s before the first arrival of a shift
const LEVEL_TOTAL_MAX = 14;

const STORAGE_KEY = 'sodatapper-best';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle'; // idle | running | paused | interlude | over
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let served = 0; // customers sent home this shift
let spawned = 0; // customers that have arrived this shift

let levelTotal = 6; // customers this shift will send
let customerSpeed = CUSTOMER_SPEED_BASE;
let spawnInterval = SPAWN_BASE;
let spawnTimer = FIRST_SPAWN;
let serveTimer = 0;
let interludeTimer = 0;

let spawnEnabled = true; // specs switch the shift spawner off
let autoStep = true; // specs drive step() themselves instead of the raf loop

const bartender = { lane: 0, pour: 0 };
const mugs = []; // { lane, x } sliding left
const empties = []; // { lane, x } sliding right
const customers = []; // { lane, x, speed, mode, drinkTimer, bob }
const laneFlash = [0, 0, 0, 0];
const shards = []; // purely decorative smash particles

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elLives.textContent = String(lives);
    elServed.textContent = String(served);
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

function smash(lane, x) {
    laneFlash[lane] = FLASH_TIME;
    for (let i = 0; i < 8; i++) {
        shards.push({
            x,
            y: LANE_Y[lane],
            vx: (Math.random() - 0.5) * 160,
            vy: -60 - Math.random() * 120,
            life: 0.5,
        });
    }
}

// ---------------------------------------------------------------------------
// Game setup
// ---------------------------------------------------------------------------

function startLevel(n) {
    level = n;
    levelTotal = Math.min(LEVEL_TOTAL_MAX, 4 + 2 * n);
    customerSpeed = CUSTOMER_SPEED_BASE + (n - 1) * CUSTOMER_SPEED_STEP;
    spawnInterval = Math.max(SPAWN_MIN, SPAWN_BASE - (n - 1) * SPAWN_STEP);

    spawned = 0;
    served = 0;
    spawnTimer = FIRST_SPAWN;
    serveTimer = 0;
    interludeTimer = 0;

    customers.length = 0;
    mugs.length = 0;
    empties.length = 0;
    shards.length = 0;
    for (let i = 0; i < LANE_COUNT; i++) laneFlash[i] = 0;

    state = 'running';
    hideOverlay();
    updateHud();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    bartender.lane = 0;
    bartender.pour = 0;
    spawnEnabled = true;
    startLevel(1);
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(STORAGE_KEY, String(best));
        } catch (e) {
            /* private mode — the run just does not persist */
        }
    }
    updateHud();
    showOverlay('BAR CLOSED', `Score ${score}`, 'Press Space to open up again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P or click Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function serve() {
    if (state !== 'running') return false;
    if (serveTimer > 0) return false;
    mugs.push({ lane: bartender.lane, x: BAR_RIGHT });
    serveTimer = SERVE_COOLDOWN;
    bartender.pour = 0.18;
    return true;
}

function moveBartender(delta) {
    if (state !== 'running') return;
    bartender.lane = Math.max(0, Math.min(LANE_COUNT - 1, bartender.lane + delta));
}

function spawnCustomer(lane) {
    const customer = {
        lane,
        x: BAR_LEFT,
        speed: customerSpeed,
        mode: 'advancing',
        drinkTimer: 0,
        bob: Math.random() * Math.PI * 2,
    };
    customers.push(customer);
    spawned++;
    return customer;
}

function loseLife(lane, x) {
    smash(lane, x === undefined ? BAR_RIGHT : x);
    lives--;
    if (lives <= 0) {
        lives = 0;
        updateHud();
        gameOver();
        return;
    }
    updateHud();
}

// A customer grabs a full mug: score, shove them back, send the empty home.
function takeDrink(customer) {
    score += SCORE_SERVE;
    empties.push({ lane: customer.lane, x: customer.x });
    customer.mode = 'drinking';
    customer.drinkTimer = DRINK_TIME;
    customer.x -= PUSH_BACK;

    if (customer.x <= BAR_LEFT) {
        const i = customers.indexOf(customer);
        if (i >= 0) customers.splice(i, 1);
        served++;
        score += SCORE_CLEAR;
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function updateMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const mug = mugs[i];
        mug.x -= MUG_SPEED * dt;

        const target = customers.find(
            (c) => c.lane === mug.lane && c.mode === 'advancing' && Math.abs(c.x - mug.x) <= CATCH_DIST
        );
        if (target) {
            mugs.splice(i, 1);
            takeDrink(target);
            continue;
        }

        if (mug.x <= BAR_LEFT) {
            mugs.splice(i, 1);
            loseLife(mug.lane, BAR_LEFT);
        }
    }
}

function updateCustomers(dt) {
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        if (c.mode === 'drinking') {
            c.drinkTimer -= dt;
            if (c.drinkTimer <= 0) {
                c.drinkTimer = 0;
                c.mode = 'advancing';
            }
            continue;
        }
        c.x += c.speed * dt;
        if (c.x >= BAR_RIGHT) {
            customers.splice(i, 1);
            loseLife(c.lane, BAR_RIGHT);
        }
    }
}

function updateEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const empty = empties[i];
        empty.x += EMPTY_SPEED * dt;
        if (empty.x >= BAR_RIGHT) {
            empties.splice(i, 1);
            if (empty.lane === bartender.lane) {
                score += SCORE_CATCH;
            } else {
                loseLife(empty.lane, BAR_RIGHT);
            }
        }
    }
}

function updateShards(dt) {
    for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        s.life -= dt;
        if (s.life <= 0) {
            shards.splice(i, 1);
            continue;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 520 * dt;
    }
}

function levelComplete() {
    return (
        spawned >= levelTotal &&
        customers.length === 0 &&
        mugs.length === 0 &&
        empties.length === 0
    );
}

function step(dt) {
    if (state === 'interlude') {
        interludeTimer -= dt;
        updateShards(dt);
        if (interludeTimer <= 0) startLevel(level + 1);
        return;
    }
    if (state !== 'running') return;

    serveTimer = Math.max(0, serveTimer - dt);
    bartender.pour = Math.max(0, bartender.pour - dt);
    for (let i = 0; i < LANE_COUNT; i++) laneFlash[i] = Math.max(0, laneFlash[i] - dt);

    if (spawnEnabled && spawned < levelTotal) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            spawnCustomer(pickLane());
            spawnTimer = spawnInterval;
        }
    }

    updateMugs(dt);
    updateCustomers(dt);
    updateEmpties(dt);
    updateShards(dt);

    if (state !== 'running') return; // a mistake may have ended the game

    if (levelComplete()) {
        state = 'interlude';
        interludeTimer = LEVEL_PAUSE;
        showOverlay('SHIFT COMPLETE', `Score ${score}`, `Shift ${level + 1} starting…`);
    }

    updateHud();
}

// Favour lanes that are not already crowded so a shift stays playable.
function pickLane() {
    const counts = [0, 0, 0, 0];
    for (const c of customers) counts[c.lane]++;
    const fewest = Math.min(...counts);
    const options = [];
    for (let i = 0; i < LANE_COUNT; i++) if (counts[i] === fewest) options.push(i);
    return options[Math.floor(Math.random() * options.length)];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#151d29');
    sky.addColorStop(1, '#0a0e15');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Back wall panelling.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let x = 20; x < canvas.width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, canvas.height);
        ctx.stroke();
    }

    // Doorway the customers come in through.
    ctx.fillStyle = '#0d131c';
    ctx.fillRect(0, 0, BAR_LEFT - 14, canvas.height);
    ctx.fillStyle = 'rgba(255, 198, 77, 0.10)';
    ctx.fillRect(BAR_LEFT - 20, 0, 6, canvas.height);
    ctx.fillStyle = 'rgba(255, 198, 77, 0.45)';
    ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DOOR', 27, 44);
    // Chevrons showing which way the queue walks.
    ctx.strokeStyle = 'rgba(255, 198, 77, 0.35)';
    ctx.lineWidth = 2;
    for (const y of LANE_Y) {
        for (let i = 0; i < 2; i++) {
            const cx = 18 + i * 12;
            ctx.beginPath();
            ctx.moveTo(cx, y - 22);
            ctx.lineTo(cx + 6, y - 14);
            ctx.lineTo(cx, y - 6);
            ctx.stroke();
        }
    }
    ctx.textAlign = 'left';

    // Tap station the bartender works from.
    ctx.fillStyle = '#111823';
    ctx.fillRect(BAR_RIGHT + 6, 0, canvas.width - BAR_RIGHT - 6, canvas.height);
    ctx.fillStyle = 'rgba(255, 198, 77, 0.12)';
    ctx.fillRect(BAR_RIGHT + 6, 0, 3, canvas.height);

    // Syrup tanks feeding the taps.
    for (let i = 0; i < 3; i++) {
        const tx = BAR_RIGHT + 16 + i * 18;
        ctx.fillStyle = ['#2f4a63', '#3d5a3f', '#5a3a4a'][i];
        ctx.fillRect(tx, 18, 14, 34);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.fillRect(tx + 2, 20, 3, 30);
    }
}

function drawCounter(lane) {
    const y = LANE_Y[lane];
    const grad = ctx.createLinearGradient(0, y, 0, y + COUNTER_H);
    grad.addColorStop(0, '#7a5230');
    grad.addColorStop(0.35, '#5c3d24');
    grad.addColorStop(1, '#33210f');
    ctx.fillStyle = grad;
    ctx.fillRect(BAR_LEFT - 16, y, BAR_RIGHT - BAR_LEFT + 40, COUNTER_H);

    ctx.fillStyle = 'rgba(255, 232, 190, 0.28)';
    ctx.fillRect(BAR_LEFT - 16, y, BAR_RIGHT - BAR_LEFT + 40, 2);

    // Underside shadow so the counter reads as a solid slab.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(BAR_LEFT - 16, y + COUNTER_H, BAR_RIGHT - BAR_LEFT + 40, 5);

    if (laneFlash[lane] > 0) {
        const a = laneFlash[lane] / FLASH_TIME;
        ctx.fillStyle = `rgba(255, 95, 86, ${0.18 * a})`;
        ctx.fillRect(BAR_LEFT - 16, y - 40, BAR_RIGHT - BAR_LEFT + 40, 40 + COUNTER_H);
        ctx.strokeStyle = `rgba(255, 95, 86, ${0.9 * a})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(BAR_LEFT - 15, y - 39, BAR_RIGHT - BAR_LEFT + 38, 38 + COUNTER_H);
    }

    // Tap head at the bartender's end of every counter.
    ctx.fillStyle = '#9fb3c8';
    ctx.fillRect(BAR_RIGHT + 10, y - 30, 6, 24);
    ctx.fillRect(BAR_RIGHT + 6, y - 12, 14, 5);
}

function drawMug(x, y, full) {
    const left = x - MUG_W / 2;
    const top = y - MUG_H;

    ctx.fillStyle = full ? '#c9741d' : 'rgba(190, 210, 230, 0.35)';
    ctx.fillRect(left, top, MUG_W, MUG_H);

    if (full) {
        ctx.fillStyle = '#fff3d6';
        ctx.fillRect(left, top, MUG_W, 5);
    }

    ctx.strokeStyle = 'rgba(233, 244, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, MUG_W, MUG_H);

    // Handle.
    ctx.beginPath();
    ctx.arc(left + MUG_W + 2, top + MUG_H / 2, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawCustomer(c) {
    const y = LANE_Y[c.lane];
    const drinking = c.mode === 'drinking';
    const sway = drinking ? 0 : Math.sin(c.x / 14 + c.bob) * 2;
    const x = c.x;

    // Body.
    ctx.fillStyle = drinking ? '#6fbf73' : '#4f7fd1';
    ctx.fillRect(x - CUSTOMER_W / 2, y - 34 + sway, CUSTOMER_W, 34);

    // Head.
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(x, y - 42 + sway, 9, 0, Math.PI * 2);
    ctx.fill();

    // Hat brim so the silhouette reads at a glance.
    ctx.fillStyle = drinking ? '#2f6b3a' : '#2b4a86';
    ctx.fillRect(x - 12, y - 48 + sway, 24, 4);

    if (drinking) {
        drawMug(x + 16, y + sway, true);
    } else {
        // Impatient arm reaching toward the taps.
        ctx.fillStyle = '#f0c9a0';
        ctx.fillRect(x + CUSTOMER_W / 2, y - 26 + sway, 10, 5);
    }
}

function drawBartender() {
    const y = LANE_Y[bartender.lane];
    const x = BAR_RIGHT + 30;
    const lean = bartender.pour > 0 ? -4 : 0;

    ctx.fillStyle = '#e9eef7';
    ctx.fillRect(x - 13 + lean, y - 36, 26, 22);
    ctx.fillStyle = '#ffc64d';
    ctx.fillRect(x - 13 + lean, y - 14, 26, 14);

    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(x + lean, y - 44, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#33241a';
    ctx.fillRect(x - 11 + lean, y - 52, 22, 5);

    // Arm on the tap.
    ctx.fillStyle = '#f0c9a0';
    ctx.fillRect(x - 24 + lean, y - 30, 12, 5);

    if (bartender.pour > 0) {
        ctx.fillStyle = 'rgba(255, 198, 77, 0.8)';
        ctx.fillRect(BAR_RIGHT + 8, y - 20, 4, 14);
    }
}

function drawShards() {
    for (const s of shards) {
        ctx.fillStyle = `rgba(233, 244, 255, ${Math.max(0, s.life / 0.5)})`;
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
}

function drawStatusText() {
    ctx.fillStyle = 'rgba(234, 242, 255, 0.5)';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Shift ${level}`, BAR_LEFT - 4, 22);
    ctx.textAlign = 'right';
    const left = Math.max(0, levelTotal - served);
    ctx.fillText(`${left} still thirsty`, BAR_RIGHT - 4, 22);
    ctx.textAlign = 'left';
}

function draw() {
    drawBackground();
    for (let lane = 0; lane < LANE_COUNT; lane++) drawCounter(lane);
    for (const c of customers) drawCustomer(c);
    for (const mug of mugs) drawMug(mug.x, LANE_Y[mug.lane], true);
    for (const empty of empties) drawMug(empty.x, LANE_Y[empty.lane], false);
    drawBartender();
    drawShards();
    drawStatusText();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    const key = e.key;

    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        moveBartender(-1);
        e.preventDefault();
        return;
    }
    if (key === 'ArrowDown' || key === 's' || key === 'S') {
        moveBartender(1);
        e.preventDefault();
        return;
    }
    if (key === 'p' || key === 'P') {
        togglePause();
        e.preventDefault();
        return;
    }
    if (key === ' ' || e.code === 'Space') {
        if (state === 'running') serve();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else if (state !== 'running') startGame();
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

best = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
served = 0;
spawned = 0;
levelTotal = Math.min(LEVEL_TOTAL_MAX, 4 + 2 * level);
customerSpeed = CUSTOMER_SPEED_BASE;
spawnInterval = SPAWN_BASE;
spawnTimer = FIRST_SPAWN;
updateHud();
showOverlay('SODA TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
