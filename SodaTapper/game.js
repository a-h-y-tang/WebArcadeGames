// ---------------------------------------------------------------------------
// Soda Tapper — a four-counter bar game on an HTML5 canvas.
//
// You work the taps at the right-hand end of four parallel counters. Customers
// push in from the far end and walk toward you; pull the tap and a full mug
// slides down to meet them. They catch it, get shoved back while they drink,
// and lob the empty back at you — which you have to be standing in the right
// lane to catch. A spilled mug, a smashed empty or a customer who reaches the
// taps each costs a life.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright specs as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. All motion is expressed per-second and applied
// by `step(dt)`, so the specs can simulate frames deterministically rather than
// waiting on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Layout --------------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 480;

const LANE_COUNT = 4;
const LANE_TOP = 96;          // y of the top counter's surface
const LANE_SPACING = 98;
const BAR_LEFT = 48;          // far end: customers enter, full mugs spill
const BAR_RIGHT = 588;        // the taps
const TAP_X = BAR_RIGHT;

const laneY = (lane) => LANE_TOP + lane * LANE_SPACING;

// --- Sizes ---------------------------------------------------------------
const MUG_HW = 9;             // mug half-width
const MUG_H = 24;
const CUST_HW = 14;           // customer half-width
const CUST_H = 46;

// --- Speeds and timings (per second) -------------------------------------
const MUG_SPEED = 300;        // full mug, travelling away from the taps
const EMPTY_SPEED = 230;      // empty mug, coming back
const PUSH_SPEED = 250;       // how fast a drinking customer is shoved back
const DRINK_TIME = 0.75;
const POUR_COOLDOWN = 0.25;
const DYING_TIME = 1.2;
const WAVE_CLEAR_TIME = 1.6;
const FIRST_SPAWN = 1.2;
const EMPTY_GAP = 30;         // spacing between mugs thrown back together
const POP_TIME = 0.9;

// --- Scoring -------------------------------------------------------------
const START_LIVES = 3;
const SERVE_POINTS = 50;      // a customer catches a mug
const CATCH_POINTS = 25;      // you catch an empty
const CUSTOMER_POINTS = 150;  // a customer is seen off the far end
const BEST_KEY = 'sodatapper-best';

const waveSize = (lvl) => Math.min(4 + 2 * lvl, 16);
const customerSpeed = (lvl) => Math.min(30 + 7 * (lvl - 1), 95);
const spawnInterval = (lvl) => Math.max(3.4 - 0.28 * (lvl - 1), 1.3);
const waveBonus = (lvl) => 250 * lvl;

// --- State ---------------------------------------------------------------
// 'idle' | 'running' | 'paused' | 'dying' | 'waveclear' | 'over'
let state = 'idle';
let score = 0;
let lives = START_LIVES;
let level = 1;
let best = 0;
let lastLoss = '';

let barman = { lane: 0, x: TAP_X };
let mugs = [];
let customers = [];
let pops = [];

let spawned = 0;              // customers released this wave
let spawnTimer = FIRST_SPAWN;
let pourTimer = 0;
let deathTimer = 0;
let clearTimer = 0;
let flash = 0;
let shine = 0;                // free-running clock for small animations

// Test hooks — inert in normal play. `autoStep` lets a spec own the clock,
// `spawnEnabled` switches off automatic arrivals.
let autoStep = true;
let spawnEnabled = true;

// --- DOM -----------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

function spawnCustomer(lane, x = BAR_LEFT) {
    const c = {
        lane,
        x,
        state: 'advancing',
        drink: 0,
        hold: 0,
        kind: customers.length % 4,
        bob: Math.random() * Math.PI * 2,
    };
    customers.push(c);
    spawned++;
    return c;
}

function spawnMug(lane, x, full) {
    const m = { lane, x, full, spin: 0 };
    mugs.push(m);
    return m;
}

// Pull the tap regardless of the cooldown. `pour()` is the player-facing
// version; this one exists for the specs and for internal use.
function pourNow() {
    pourTimer = POUR_COOLDOWN;
    return spawnMug(barman.lane, TAP_X - MUG_HW - 3, true);
}

function pour() {
    if (state !== 'running' || pourTimer > 0) return null;
    return pourNow();
}

function moveBarman(delta) {
    if (state !== 'running') return;
    barman.lane = Math.max(0, Math.min(LANE_COUNT - 1, barman.lane + delta));
}

function pop(x, y, text) {
    pops.push({ x, y, text, life: POP_TIME });
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function resetWave() {
    mugs = [];
    customers = [];
    spawned = 0;
    spawnTimer = FIRST_SPAWN;
    pourTimer = 0;
    barman.lane = 0;
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    lastLoss = '';
    pops = [];
    flash = 0;
    resetWave();
    state = 'running';
    updateHud();
    hideOverlay();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to pour again');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function loseLife(reason) {
    lives--;
    lastLoss = reason;
    mugs = [];
    customers = [];
    state = 'dying';
    deathTimer = DYING_TIME;
    flash = 1;
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (e) {
            /* private browsing — the run just isn't remembered */
        }
    }
    updateHud();
    showOverlay('LAST ORDERS', `Score ${score} — best ${best}`, 'Press Space or Enter to play again');
}

const LOSS_TEXT = {
    spill: 'Mug spilled!',
    shatter: 'Mug smashed!',
    grabbed: 'Customer got you!',
};

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function updatePops(dt) {
    for (const p of pops) p.life -= dt;
    pops = pops.filter((p) => p.life > 0);
}

// The mugs a customer is holding are thrown back one after another.
function throwBackEmpties(c) {
    for (let i = 0; i < c.hold; i++) spawnMug(c.lane, c.x + i * EMPTY_GAP, false);
    c.hold = 0;
}

function updateCustomers(dt) {
    const speed = customerSpeed(level);
    for (const c of customers) {
        if (c.state === 'drinking') {
            c.x -= PUSH_SPEED * dt;
            c.drink -= dt;
            if (c.x <= BAR_LEFT) {
                // Shoved off the far end — they leave happy, mugs and all.
                c.x = BAR_LEFT;
                c.gone = true;
                throwBackEmpties(c);
                score += CUSTOMER_POINTS;
                pop(c.x, laneY(c.lane) - CUST_H, `+${CUSTOMER_POINTS}`);
            } else if (c.drink <= 0) {
                throwBackEmpties(c);
                c.state = 'advancing';
            }
        } else {
            c.x += speed * dt;
            if (c.x + CUST_HW >= TAP_X) {
                loseLife('grabbed');
                return true;
            }
        }
    }
    if (customers.some((c) => c.gone)) {
        customers = customers.filter((c) => !c.gone);
        updateHud();
    }
    return false;
}

// The customer nearest the taps in this lane whose body the mug has reached.
function catcherFor(mug) {
    let best_ = null;
    for (const c of customers) {
        if (c.lane !== mug.lane) continue;
        if (mug.x - MUG_HW > c.x + CUST_HW) continue;
        if (!best_ || c.x > best_.x) best_ = c;
    }
    return best_;
}

function updateMugs(dt) {
    const survivors = [];
    for (const m of mugs) {
        if (m.full) {
            m.x -= MUG_SPEED * dt;
            const c = catcherFor(m);
            if (c) {
                c.state = 'drinking';
                c.drink = DRINK_TIME;
                c.hold++;
                score += SERVE_POINTS;
                pop(c.x, laneY(c.lane) - CUST_H, `+${SERVE_POINTS}`);
                updateHud();
                continue;
            }
            if (m.x - MUG_HW <= BAR_LEFT) {
                loseLife('spill');
                return true;
            }
        } else {
            m.x += EMPTY_SPEED * dt;
            m.spin += dt * 6;
            if (m.x + MUG_HW >= TAP_X) {
                if (m.lane === barman.lane) {
                    score += CATCH_POINTS;
                    pop(TAP_X - 30, laneY(m.lane) - MUG_H - 10, `+${CATCH_POINTS}`);
                    updateHud();
                    continue;
                }
                loseLife('shatter');
                return true;
            }
        }
        survivors.push(m);
    }
    mugs = survivors;
    return false;
}

function step(dt) {
    shine += dt;
    if (flash > 0) flash = Math.max(0, flash - dt * 2);
    updatePops(dt);

    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) {
            if (lives <= 0) gameOver();
            else {
                resetWave();
                state = 'running';
            }
        }
        return;
    }

    if (state === 'waveclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) {
            level++;
            resetWave();
            state = 'running';
            updateHud();
            hideOverlay();
        }
        return;
    }

    if (state !== 'running') return;

    if (pourTimer > 0) pourTimer -= dt;

    if (spawnEnabled && spawned < waveSize(level)) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            spawnCustomer(Math.floor(Math.random() * LANE_COUNT));
            spawnTimer = spawnInterval(level);
        }
    }

    // A life lost clears the counters, so the frame stops there: one frame can
    // never cost two lives.
    if (updateCustomers(dt)) return;
    if (updateMugs(dt)) return;

    if (spawned >= waveSize(level) && customers.length === 0 && mugs.length === 0) {
        score += waveBonus(level);
        state = 'waveclear';
        clearTimer = WAVE_CLEAR_TIME;
        updateHud();
        showOverlay(`WAVE ${level} CLEAR`, `Score ${score}`, 'Next round coming up…');
    }
}

// Clear the counters and mark the wave fully served — the shortest path to the
// wave-clear transition, for the specs.
function serveWaveForTest() {
    customers = [];
    mugs = [];
    spawned = waveSize(level);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const CUST_COLORS = ['#e46a6a', '#6fb2e4', '#8ad07a', '#d79ae0'];

function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#132133');
    g.addColorStop(1, '#080f18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Panelling on the back wall.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 1;
    for (let x = 20; x < CANVAS_W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CANVAS_H);
        ctx.stroke();
    }
}

function drawCounter(lane) {
    const y = laneY(lane);
    // Counter body.
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(BAR_LEFT - 10, y, BAR_RIGHT - BAR_LEFT + 20, 16);
    // Polished top.
    const g = ctx.createLinearGradient(0, y - 6, 0, y + 4);
    g.addColorStop(0, '#a9743f');
    g.addColorStop(1, '#7a4c28');
    ctx.fillStyle = g;
    ctx.fillRect(BAR_LEFT - 10, y - 6, BAR_RIGHT - BAR_LEFT + 20, 8);
    ctx.fillStyle = 'rgba(255, 226, 178, 0.35)';
    ctx.fillRect(BAR_LEFT - 10, y - 6, BAR_RIGHT - BAR_LEFT + 20, 2);
    // Shadow under the counter.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(BAR_LEFT - 10, y + 16, BAR_RIGHT - BAR_LEFT + 20, 10);
    // The far end, where mugs are lost.
    ctx.fillStyle = '#2c1a10';
    ctx.fillRect(BAR_LEFT - 14, y - 8, 6, 26);
}

function drawMug(m) {
    const y = laneY(m.lane) - 6;
    const w = MUG_HW * 2;
    const top = y - MUG_H;
    ctx.save();
    ctx.translate(m.x, 0);
    if (!m.full) ctx.rotate(0); // empties travel upright; the wobble is the foam
    // Glass.
    ctx.fillStyle = m.full ? '#c8862f' : 'rgba(214, 232, 245, 0.35)';
    ctx.fillRect(-MUG_HW, top, w, MUG_H);
    ctx.strokeStyle = '#eaf4ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(-MUG_HW, top, w, MUG_H);
    // Handle.
    ctx.beginPath();
    ctx.arc(MUG_HW + 3, top + MUG_H / 2, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    if (m.full) {
        // Foam head, with a wobble as it slides.
        ctx.fillStyle = '#fff6e2';
        const wob = Math.sin(m.x * 0.08) * 1.5;
        ctx.fillRect(-MUG_HW, top - 3 + wob, w, 6);
    }
    ctx.restore();
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const drinking = c.state === 'drinking';
    const bob = drinking ? 0 : Math.sin(shine * 6 + c.bob) * 1.5;
    const top = y - CUST_H + bob;
    const color = CUST_COLORS[c.kind % CUST_COLORS.length];

    ctx.save();
    ctx.translate(c.x, 0);
    // Body.
    ctx.fillStyle = color;
    ctx.fillRect(-CUST_HW, top + 14, CUST_HW * 2, CUST_H - 14);
    // Head.
    ctx.fillStyle = '#f2cfa4';
    ctx.beginPath();
    ctx.arc(0, top + 8, 9, 0, Math.PI * 2);
    ctx.fill();
    // Hat brim, so the silhouette reads at a glance.
    ctx.fillStyle = '#2b3442';
    ctx.fillRect(-11, top - 1, 22, 3);
    ctx.fillRect(-7, top - 7, 14, 6);
    // Arm reaching toward the taps, or a raised mug while drinking.
    ctx.fillStyle = color;
    if (drinking) {
        ctx.fillRect(2, top + 6, 6, 14);
        ctx.fillStyle = '#c8862f';
        ctx.fillRect(6, top - 2, 10, 12);
        ctx.strokeStyle = '#eaf4ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(6, top - 2, 10, 12);
    } else {
        ctx.fillRect(CUST_HW - 2, top + 20, 12, 6);
    }
    // Held mugs waiting to be thrown back.
    for (let i = 1; i < c.hold; i++) {
        ctx.fillStyle = 'rgba(214, 232, 245, 0.5)';
        ctx.fillRect(-CUST_HW - 6 * i, y - 12, 5, 12);
    }
    ctx.restore();
}

function drawTaps() {
    // The tap station running down the right-hand edge.
    ctx.fillStyle = '#1b2937';
    ctx.fillRect(TAP_X + 4, 40, 48, CANVAS_H - 70);
    ctx.fillStyle = '#26384b';
    ctx.fillRect(TAP_X + 4, 40, 48, 6);
    for (let l = 0; l < LANE_COUNT; l++) {
        const y = laneY(l);
        ctx.fillStyle = '#9fb6c9';
        ctx.fillRect(TAP_X + 12, y - 40, 6, 24);
        ctx.fillStyle = l === barman.lane ? '#ffb648' : '#5d7285';
        ctx.fillRect(TAP_X + 8, y - 44, 14, 6);
    }
}

function drawBarman() {
    const y = laneY(barman.lane);
    const x = TAP_X + 28;
    const top = y - CUST_H - 2;
    // Head.
    ctx.fillStyle = '#f2cfa4';
    ctx.beginPath();
    ctx.arc(x, top + 8, 9, 0, Math.PI * 2);
    ctx.fill();
    // Cap.
    ctx.fillStyle = '#eef4fa';
    ctx.fillRect(x - 10, top - 1, 20, 4);
    ctx.fillRect(x - 7, top - 6, 14, 6);
    // Shirt and apron.
    ctx.fillStyle = '#2f4a63';
    ctx.fillRect(x - 13, top + 16, 26, CUST_H - 14);
    ctx.fillStyle = '#eef4fa';
    ctx.fillRect(x - 10, top + 26, 20, CUST_H - 24);
    // Arm on the tap.
    ctx.fillStyle = '#f2cfa4';
    ctx.fillRect(x - 26, top + 20, 16, 6);
    // A glow so the active lane is unmistakable.
    ctx.strokeStyle = 'rgba(255, 182, 72, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(BAR_LEFT - 10, y - 7);
    ctx.lineTo(BAR_RIGHT + 10, y - 7);
    ctx.stroke();
}

function drawPops() {
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px "Segoe UI", system-ui, sans-serif';
    for (const p of pops) {
        const t = p.life / POP_TIME;
        ctx.fillStyle = `rgba(255, 214, 138, ${t.toFixed(3)})`;
        ctx.fillText(p.text, p.x, p.y - (1 - t) * 26);
    }
    ctx.textAlign = 'left';
}

function drawBanner(text, sub) {
    ctx.fillStyle = 'rgba(6, 12, 20, 0.55)';
    ctx.fillRect(0, CANVAS_H / 2 - 46, CANVAS_W, 92);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffb648';
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2);
    if (sub) {
        ctx.fillStyle = '#c9dbe9';
        ctx.font = '15px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(sub, CANVAS_W / 2, CANVAS_H / 2 + 28);
    }
    ctx.textAlign = 'left';
}

function draw() {
    drawBackground();
    for (let l = 0; l < LANE_COUNT; l++) drawCounter(l);
    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m);
    drawTaps();
    if (state !== 'dying' || Math.floor(deathTimer * 8) % 2 === 0) drawBarman();
    drawPops();

    if (state === 'idle') drawBanner('SODA TAPPER', 'Four counters. One of you.');
    if (state === 'dying') drawBanner(LOSS_TEXT[lastLoss] || 'Lost a life', `${Math.max(0, lives)} left`);
    if (state === 'waveclear') drawBanner(`WAVE ${level} CLEAR`, `+${waveBonus(level)}`);

    if (flash > 0) {
        ctx.fillStyle = `rgba(239, 91, 76, ${(flash * 0.35).toFixed(3)})`;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if (e.key === 'Enter') {
        if (state === 'paused') togglePause();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.code === 'Space') {
        if (state === 'running') pour();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (UP_KEYS.includes(e.key)) {
        moveBarman(-1);
        e.preventDefault();
        return;
    }
    if (DOWN_KEYS.includes(e.key)) {
        moveBarman(1);
        e.preventDefault();
    }
});

function laneFromY(y) {
    let lane = 0;
    let bestGap = Infinity;
    for (let l = 0; l < LANE_COUNT; l++) {
        const gap = Math.abs(laneY(l) - y);
        if (gap < bestGap) {
            bestGap = gap;
            lane = l;
        }
    }
    return lane;
}

canvas.addEventListener('click', (e) => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    barman.lane = laneFromY(y);
    pour();
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
    if (autoStep) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
updateHud();
showOverlay('SODA TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
