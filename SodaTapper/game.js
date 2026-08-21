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
const CUST_TOP = -58;         // top of the head, relative to the counter surface
const CUST_FOOT = 14;         // feet, below the surface: the counter hides the legs

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
        hold: 0,      // mugs caught but not yet thrown back
        gone: false,  // shoved off the far end, waiting to be swept up
        kind: customers.length % 4,
        bob: Math.random() * Math.PI * 2,
    };
    customers.push(c);
    spawned++;
    return c;
}

function spawnMug(lane, x, full) {
    const m = { lane, x, full };
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
                pop(c.x, laneY(c.lane) + CUST_TOP - 10, `+${CUSTOMER_POINTS}`);
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
    let nearest = null;
    for (const c of customers) {
        if (c.lane !== mug.lane) continue;
        if (mug.x - MUG_HW > c.x + CUST_HW) continue;
        if (!nearest || c.x > nearest.x) nearest = c;
    }
    return nearest;
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
                pop(c.x, laneY(c.lane) + CUST_TOP - 10, `+${SERVE_POINTS}`);
                updateHud();
                continue;
            }
            if (m.x - MUG_HW <= BAR_LEFT) {
                loseLife('spill');
                return true;
            }
        } else {
            m.x += EMPTY_SPEED * dt;
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

const CUST_COLORS = ['#e4695f', '#5fa8e4', '#7fc96e', '#c98ae0'];
function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#16273b');
    g.addColorStop(1, '#070e17');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Wall panelling.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let x = 24; x < CANVAS_W; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CANVAS_H);
        ctx.stroke();
    }

    // The doorway each queue files in through.
    for (let l = 0; l < LANE_COUNT; l++) {
        const y = laneY(l);
        ctx.fillStyle = '#0a1420';
        roundRect(BAR_LEFT - 42, y - 66, 34, 80, 15);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 182, 72, 0.18)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

function drawCounter(lane) {
    const y = laneY(lane);
    const x0 = BAR_LEFT - 22;
    const w = BAR_RIGHT - x0 + 14;

    // Front panel, with a little grain.
    ctx.fillStyle = '#4a2f1c';
    ctx.fillRect(x0, y - 2, w, 18);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 1;
    for (let x = x0 + 12; x < x0 + w; x += 26) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y + 2);
        ctx.lineTo(x + 0.5, y + 14);
        ctx.stroke();
    }

    // Polished top.
    const g = ctx.createLinearGradient(0, y - 8, 0, y);
    g.addColorStop(0, '#b98046');
    g.addColorStop(1, '#7d4f29');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y - 8, w, 8);
    ctx.fillStyle = 'rgba(255, 232, 194, 0.4)';
    ctx.fillRect(x0, y - 8, w, 2);

    // The lip at the far end, where a mug goes over.
    ctx.fillStyle = '#25150c';
    ctx.fillRect(x0 - 6, y - 12, 8, 28);

    // Shadow cast onto the floor below.
    const s = ctx.createLinearGradient(0, y + 16, 0, y + 32);
    s.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
    s.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = s;
    ctx.fillRect(x0, y + 16, w, 16);
}

function drawMug(m) {
    const base = laneY(m.lane) - 8;
    const top = base - MUG_H;
    const w = MUG_HW * 2;

    ctx.save();
    ctx.translate(m.x, 0);
    // Handle first, so the glass sits over it.
    ctx.strokeStyle = m.full ? '#f0d9b0' : '#cfe2f2';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(MUG_HW + 3, top + MUG_H * 0.55, 5.5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    // Glass.
    ctx.fillStyle = m.full ? '#d08a2c' : 'rgba(198, 224, 244, 0.42)';
    ctx.fillRect(-MUG_HW, top, w, MUG_H);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(-MUG_HW + 2, top + 3, 3, MUG_H - 8);
    ctx.strokeStyle = m.full ? '#ffe6b8' : '#cfe2f2';
    ctx.lineWidth = 2;
    ctx.strokeRect(-MUG_HW, top, w, MUG_H);

    if (m.full) {
        // Foam head, wobbling as the mug slides.
        const wob = Math.sin(m.x * 0.09) * 1.5;
        ctx.fillStyle = '#fff6e2';
        ctx.beginPath();
        ctx.ellipse(0, top + wob, MUG_HW + 1, 5, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const drinking = c.state === 'drinking';
    const bob = drinking ? Math.sin(shine * 18) * 1.2 : Math.sin(shine * 6 + c.bob) * 1.5;
    const top = y + CUST_TOP + bob;
    const color = CUST_COLORS[c.kind % CUST_COLORS.length];

    ctx.save();
    ctx.translate(c.x, 0);

    // Torso.
    ctx.fillStyle = color;
    roundRect(-CUST_HW, top + 22, CUST_HW * 2, y + CUST_FOOT - (top + 22), 5);
    ctx.fill();
    // Collar.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(-CUST_HW, top + 22, CUST_HW * 2, 3);

    // Head and hat.
    ctx.fillStyle = '#f2cfa4';
    ctx.beginPath();
    ctx.arc(0, top + 12, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#28313d';
    ctx.fillRect(-13, top + 1, 26, 4);
    ctx.fillRect(-8, top - 6, 16, 7);

    if (drinking) {
        // Arm up, mug at the lips — kept clear of the face.
        ctx.fillStyle = color;
        ctx.fillRect(10, top + 18, 8, 14);
        ctx.fillStyle = '#d08a2c';
        ctx.fillRect(13, top + 6, 13, 15);
        ctx.strokeStyle = '#ffe6b8';
        ctx.lineWidth = 2;
        ctx.strokeRect(13, top + 6, 13, 15);
    } else {
        // Arm out, reaching toward the taps.
        ctx.fillStyle = color;
        ctx.fillRect(CUST_HW - 3, top + 28, 14, 7);
    }

    // Empties still waiting to be thrown back.
    for (let i = 1; i < c.hold; i++) {
        ctx.fillStyle = 'rgba(190, 218, 240, 0.45)';
        ctx.fillRect(-CUST_HW - 7 * i, y - 22, 5, 14);
    }
    ctx.restore();
}

function drawTapStation() {
    const x = TAP_X + 6;
    const w = CANVAS_W - x;

    ctx.fillStyle = '#182635';
    ctx.fillRect(x, 24, w, CANVAS_H - 48);
    ctx.fillStyle = '#22364a';
    ctx.fillRect(x, 24, w, 8);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, 24.5, w - 1, CANVAS_H - 49);

    for (let l = 0; l < LANE_COUNT; l++) {
        const y = laneY(l);
        const live = l === barman.lane;
        // Spout and handle.
        ctx.fillStyle = '#9fb6c9';
        ctx.fillRect(x + 8, y - 44, 6, 26);
        ctx.fillStyle = live ? '#ffb648' : '#5d7285';
        ctx.fillRect(x + 3, y - 50, 16, 7);
        if (live && pourTimer > POUR_COOLDOWN * 0.45) {
            // A splash of soda while the tap is still running.
            ctx.fillStyle = 'rgba(233, 176, 88, 0.75)';
            ctx.fillRect(x + 9, y - 20, 4, 12);
        }
    }
}

function drawBarman() {
    const y = laneY(barman.lane);
    const x = TAP_X + 24;
    const top = y + CUST_TOP - 4;

    // A lit pad behind you, so the counter you are working is unmistakable.
    ctx.fillStyle = 'rgba(255, 182, 72, 0.14)';
    roundRect(x - 19, top - 12, 38, y + CUST_FOOT + 8 - (top - 12), 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 182, 72, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Reaching arm, behind the body.
    ctx.fillStyle = '#f2cfa4';
    ctx.fillRect(x - 32, top + 30, 22, 7);

    // Torso and apron.
    ctx.fillStyle = '#31506c';
    roundRect(x - 14, top + 22, 28, y + CUST_FOOT - (top + 22), 5);
    ctx.fill();
    ctx.fillStyle = '#eef4fa';
    ctx.fillRect(x - 11, top + 34, 22, y + CUST_FOOT - (top + 34));

    // Head and cap.
    ctx.fillStyle = '#f2cfa4';
    ctx.beginPath();
    ctx.arc(x, top + 12, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6c96a';
    ctx.fillRect(x - 13, top + 1, 26, 4);
    ctx.fillStyle = '#eef4fa';
    ctx.fillRect(x - 9, top - 7, 18, 8);

    // The counter you are standing at, lit up.
    ctx.strokeStyle = 'rgba(255, 182, 72, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(BAR_LEFT - 22, y - 9);
    ctx.lineTo(BAR_RIGHT + 6, y - 9);
    ctx.stroke();
}

function drawPops() {
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
    for (const p of pops) {
        const t = Math.max(0, p.life / POP_TIME);
        ctx.fillStyle = `rgba(255, 214, 138, ${t.toFixed(3)})`;
        ctx.fillText(p.text, p.x, p.y - (1 - t) * 26);
    }
    ctx.textAlign = 'left';
}

function drawBanner(text, sub) {
    ctx.fillStyle = 'rgba(6, 12, 20, 0.62)';
    ctx.fillRect(0, CANVAS_H / 2 - 48, CANVAS_W, 96);
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
    // Per lane: the customers stand behind the bar, so the counter is painted
    // over their legs and the mugs on top of everything.
    for (let l = 0; l < LANE_COUNT; l++) {
        for (const c of customers) if (c.lane === l) drawCustomer(c);
        drawCounter(l);
        for (const m of mugs) if (m.lane === l) drawMug(m);
    }
    drawTapStation();
    if (state !== 'dying' || Math.floor(deathTimer * 8) % 2 === 0) drawBarman();
    drawPops();

    if (state === 'idle') drawBanner('SODA TAPPER', 'Four counters. One of you.');
    if (state === 'dying') {
        drawBanner(LOSS_TEXT[lastLoss] || 'Lost a life', `${Math.max(0, lives)} left`);
    }
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
