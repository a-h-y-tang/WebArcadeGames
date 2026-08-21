// ---------------------------------------------------------------------------
// Tapper — a four-lane tavern arcade game on an HTML5 canvas.
//
// You are the bartender, penned in at the right-hand end of four parallel bars.
// Patrons walk in from the doors on the left and shuffle towards you. Pull the
// tap to slide a full mug down a bar: it shoves the patron it reaches back
// towards the door and buys you a few seconds while they drink. Every drink
// comes back as an empty mug, and an empty you fail to catch shatters and costs
// a life — as does a patron who reaches you, or a mug slid down an empty bar.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Snake, Tetris,
// Kaboom! and BurgerTime in this repo. All motion is expressed per second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Layout --------------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 480;

const LANE_COUNT = 4;
const LANE_TOP = 84;
const LANE_SPACING = 100;
const LANE_Y = Array.from({ length: LANE_COUNT }, (_, i) => LANE_TOP + i * LANE_SPACING);

const BAR_LEFT = 44;    // the door end — patrons walk in here
const BAR_RIGHT = 572;  // the tap end
const TAP_X = BAR_RIGHT - 10;   // where a freshly poured mug appears
const CATCH_X = BAR_RIGHT - 4;  // an empty mug or tip is caught here
const GRAB_X = BAR_RIGHT - 40;  // a patron who gets this far grabs you
const BARTENDER_X = 600;

// --- Mugs ----------------------------------------------------------------
const MUG_SPEED = 265;   // px/s, full mug travelling left
const EMPTY_SPEED = 300; // px/s, empty mug travelling right
const MUG_HW = 9;        // half-width
const MUG_H = 24;
const MAX_MUGS_PER_LANE = 2;

// --- Patrons -------------------------------------------------------------
const CUSTOMER_SPEED = 26;      // px/s at level 1
const CUSTOMER_SPEED_STEP = 5;  // extra px/s per level
const CUSTOMER_SPEED_CAP = 70;
const CUST_HW = 13;
const CUST_H = 46;
const PUSHBACK = 120;   // how far a mug shoves a patron
const DRINK_TIME = 0.7; // seconds spent drinking

// --- Tips ----------------------------------------------------------------
const TIP_SPEED = 220;
const TIP_EVERY = 3;    // every Nth satisfied patron leaves one
const TIP_R = 8;

// --- Scoring -------------------------------------------------------------
const SERVE_POINTS = 50;
const SATISFIED_POINTS = 200;
const CATCH_POINTS = 25;
const TIP_POINTS = 500;
const LEVEL_BONUS = 300;

// --- Waves ---------------------------------------------------------------
const START_LIVES = 3;
const BASE_QUOTA = 4;
const SPAWN_BASE = 3.0;
const SPAWN_STEP = 0.18;
const SPAWN_MIN = 1.1;
const MAX_PER_LANE = 3;
const FIRST_SPAWN = 1.2;
const RESPAWN_DELAY = 1.4;
const RETRY_DELAY = 0.25;   // all bars full — look again shortly

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';          // 'idle' | 'playing' | 'paused' | 'over'
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;

let levelQuota = quotaFor(1);
let spawnedCount = 0;        // patrons let in this wave
let satisfied = 0;           // patrons shoved back out of the door this wave
let tipCounter = 0;          // drives the deterministic tip drops
let spawnCursor = 0;         // drives the deterministic lane rotation
let spawnTimer = FIRST_SPAWN;
let spawnEnabled = true;     // tests close the door to keep runs deterministic

const bartender = { lane: 0 };
const mugs = [];       // { lane, x, dir }  dir -1 = full going left, +1 = empty
const customers = [];  // { lane, x, drinking, drinkTimer, served }
const tips = [];       // { lane, x }
const effects = [];    // purely cosmetic { x, y, life, kind }

let autoStep = true;   // the specs switch the real animation loop off

// ---------------------------------------------------------------------------
// Difficulty curves
// ---------------------------------------------------------------------------

function quotaFor(lvl) {
    return BASE_QUOTA + 2 * lvl;
}

function customerSpeed(lvl) {
    return Math.min(CUSTOMER_SPEED_CAP, CUSTOMER_SPEED + CUSTOMER_SPEED_STEP * (lvl - 1));
}

function spawnInterval(lvl) {
    return Math.max(SPAWN_MIN, SPAWN_BASE - SPAWN_STEP * (lvl - 1));
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function serve() {
    if (state !== 'playing') return false;
    const inLane = mugs.filter((m) => m.lane === bartender.lane && m.dir === -1).length;
    if (inLane >= MAX_MUGS_PER_LANE) return false;
    mugs.push({ lane: bartender.lane, x: TAP_X, dir: -1 });
    return true;
}

function spawnCustomer(lane) {
    customers.push({ lane, x: BAR_LEFT, drinking: false, drinkTimer: 0, served: 0 });
}

function spawnTip(lane, x = BAR_LEFT) {
    tips.push({ lane, x });
}

function burst(lane, x, kind) {
    effects.push({ x, y: LANE_Y[lane], life: 0.45, kind });
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'playing') return;

    updateMugs(dt);
    if (state !== 'playing') return;

    updateCustomers(dt);
    if (state !== 'playing') return;

    updateTips(dt);
    updateSpawning(dt);
    updateEffects(dt);
    checkLevelClear();
    updateHud();
}

// A full mug slides away from the tap until it meets a patron or falls off the
// far end; an empty slides back and must be caught at the tap.
function updateMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const mug = mugs[i];

        if (mug.dir === -1) {
            mug.x -= MUG_SPEED * dt;
            const hit = patronInFrontOf(mug);
            if (hit) {
                mugs.splice(i, 1);
                shove(hit);
                continue;
            }
            if (mug.x <= BAR_LEFT) {
                mugs.splice(i, 1);
                burst(mug.lane, BAR_LEFT, 'shatter');
                loseLife();
                return;
            }
        } else {
            mug.x += EMPTY_SPEED * dt;
            if (mug.x >= CATCH_X) {
                mugs.splice(i, 1);
                if (bartender.lane === mug.lane) {
                    score += CATCH_POINTS;
                    burst(mug.lane, CATCH_X, 'catch');
                } else {
                    burst(mug.lane, CATCH_X, 'shatter');
                    loseLife();
                    return;
                }
            }
        }
    }
}

// The rightmost patron the mug currently overlaps, if any. Drinking patrons are
// fair game — a well-timed follow-up pour shoves them again.
function patronInFrontOf(mug) {
    let best = null;
    for (const c of customers) {
        if (c.lane !== mug.lane) continue;
        if (mug.x - MUG_HW > c.x + CUST_HW) continue;
        if (mug.x + MUG_HW < c.x - CUST_HW) continue;
        if (!best || c.x > best.x) best = c;
    }
    return best;
}

function shove(customer) {
    score += SERVE_POINTS;
    customer.served += 1;
    customer.x = Math.max(BAR_LEFT - 10, customer.x - PUSHBACK);
    customer.drinking = true;
    customer.drinkTimer = DRINK_TIME;
    burst(customer.lane, customer.x, 'serve');
}

function updateCustomers(dt) {
    const speed = customerSpeed(level);

    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];

        if (c.drinking) {
            c.drinkTimer -= dt;
            if (c.drinkTimer <= 0) {
                c.drinking = false;
                mugs.push({ lane: c.lane, x: c.x, dir: 1 });
                if (c.x <= BAR_LEFT) {
                    customers.splice(i, 1);
                    leaveSatisfied(c);
                }
            }
            continue;
        }

        c.x += speed * dt;
        if (c.x >= GRAB_X) {
            burst(c.lane, GRAB_X, 'grab');
            loseLife();
            return;
        }
    }
}

function leaveSatisfied(customer) {
    satisfied += 1;
    score += SATISFIED_POINTS;
    tipCounter += 1;
    if (tipCounter % TIP_EVERY === 0) spawnTip(customer.lane, BAR_LEFT + 6);
}

function updateTips(dt) {
    for (let i = tips.length - 1; i >= 0; i--) {
        const tip = tips[i];
        tip.x += TIP_SPEED * dt;
        if (tip.x >= CATCH_X) {
            tips.splice(i, 1);
            if (bartender.lane === tip.lane) {
                score += TIP_POINTS;
                burst(tip.lane, CATCH_X, 'tip');
            }
        }
    }
}

// Lane choice is a fixed rotation rather than a random draw, so a replayed
// sequence of inputs always produces exactly the same game.
function updateSpawning(dt) {
    if (!spawnEnabled) return;
    if (spawnedCount >= levelQuota) return;

    spawnTimer -= dt;
    if (spawnTimer > 0) return;

    const start = (spawnCursor * 3 + level) % LANE_COUNT;
    for (let i = 0; i < LANE_COUNT; i++) {
        const lane = (start + i) % LANE_COUNT;
        if (customers.filter((c) => c.lane === lane).length >= MAX_PER_LANE) continue;
        spawnCustomer(lane);
        spawnedCount += 1;
        spawnCursor += 1;
        spawnTimer = spawnInterval(level);
        return;
    }
    spawnTimer = RETRY_DELAY;
}

function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
        effects[i].life -= dt;
        if (effects[i].life <= 0) effects.splice(i, 1);
    }
}

function checkLevelClear() {
    if (spawnedCount < levelQuota) return;
    if (satisfied < levelQuota) return;
    if (customers.length > 0) return;

    score += LEVEL_BONUS * level;
    level += 1;
    startWave();
}

function startWave() {
    levelQuota = quotaFor(level);
    spawnedCount = 0;
    satisfied = 0;
    spawnTimer = FIRST_SPAWN;
}

// A life costs you the whole bar top: everything in play is swept away, but the
// wave keeps the progress you had already made towards the quota.
function loseLife() {
    lives -= 1;
    mugs.length = 0;
    customers.length = 0;
    tips.length = 0;
    spawnTimer = RESPAWN_DELAY;
    updateHud();
    if (lives <= 0) endGame();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'playing';
    score = 0;
    lives = START_LIVES;
    level = 1;
    tipCounter = 0;
    spawnCursor = 0;
    spawnEnabled = true;
    bartender.lane = 0;
    mugs.length = 0;
    customers.length = 0;
    tips.length = 0;
    effects.length = 0;
    startWave();
    hideOverlay();
    updateHud();
}

function endGame() {
    state = 'over';
    mugs.length = 0;
    customers.length = 0;
    tips.length = 0;
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('tapper-best', String(best));
        } catch (err) {
            /* private browsing — the run just does not keep a best score */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Best ${best}`, 'Press Space to play again');
}

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume');
    } else if (state === 'paused') {
        state = 'playing';
        hideOverlay();
    }
}

function moveBartender(delta) {
    if (state !== 'playing') return;
    bartender.lane = Math.max(0, Math.min(LANE_COUNT - 1, bartender.lane + delta));
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const servedEl = document.getElementById('served');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    servedEl.textContent = `${Math.min(satisfied, levelQuota)} / ${levelQuota}`;
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Game';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    drawRoom();
    for (let lane = 0; lane < LANE_COUNT; lane++) drawBar(lane);

    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m);
    for (const t of tips) drawTip(t);
    drawBartender();
    drawEffects();
}

function drawRoom() {
    const wall = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    wall.addColorStop(0, '#2b1a10');
    wall.addColorStop(1, '#150d07');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Panelled wall behind the bars.
    ctx.strokeStyle = 'rgba(255, 210, 150, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 20; x < CANVAS_W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CANVAS_H);
        ctx.stroke();
    }

    // The bartender's alley on the right.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(BAR_RIGHT + 6, 0, CANVAS_W - BAR_RIGHT - 6, CANVAS_H);
}

function drawBar(lane) {
    const y = LANE_Y[lane];

    // Doorway at the far end, lit from the street outside.
    const door = ctx.createLinearGradient(0, y - 62, 0, y);
    door.addColorStop(0, '#3b2a17');
    door.addColorStop(1, '#0b0704');
    ctx.fillStyle = door;
    ctx.fillRect(BAR_LEFT - 40, y - 62, 30, 62);
    ctx.strokeStyle = '#5c3d22';
    ctx.lineWidth = 2;
    ctx.strokeRect(BAR_LEFT - 40, y - 62, 30, 62);
    ctx.fillStyle = 'rgba(240, 168, 40, 0.16)';
    ctx.fillRect(BAR_LEFT - 36, y - 58, 22, 26);

    // Counter top.
    const top = ctx.createLinearGradient(0, y, 0, y + 14);
    top.addColorStop(0, '#a4703c');
    top.addColorStop(1, '#6d451f');
    ctx.fillStyle = top;
    ctx.fillRect(BAR_LEFT - 12, y, BAR_RIGHT - BAR_LEFT + 36, 14);

    ctx.fillStyle = 'rgba(255, 226, 180, 0.22)';
    ctx.fillRect(BAR_LEFT - 12, y, BAR_RIGHT - BAR_LEFT + 36, 3);

    ctx.fillStyle = '#3d2612';
    ctx.fillRect(BAR_LEFT - 12, y + 14, BAR_RIGHT - BAR_LEFT + 36, 5);

    // The tap.
    ctx.fillStyle = '#d9a441';
    ctx.fillRect(BAR_RIGHT + 2, y - 30, 7, 30);
    ctx.fillRect(BAR_RIGHT - 6, y - 30, 16, 6);
}

// A soft ellipse under a figure, so it reads as standing at the bar rather than
// floating in front of it.
function drawShadow(x, y, w) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.beginPath();
    ctx.ellipse(x, y + 3, w, 4, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawCustomer(c) {
    const y = LANE_Y[c.lane];
    const baseY = y + 2;
    const hue = ['#c8553d', '#4f7f9c', '#7c9a55', '#9b6ea8'][(c.lane + c.served) % 4];

    drawShadow(c.x, baseY, CUST_HW + 3);

    // Body.
    ctx.fillStyle = hue;
    roundRect(c.x - CUST_HW, baseY - CUST_H + 14, CUST_HW * 2, CUST_H - 14, 5);
    ctx.fill();

    // Head.
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(c.x, baseY - CUST_H + 6, 9, 0, Math.PI * 2);
    ctx.fill();

    // Hat brim, so patrons read clearly against the wall.
    ctx.fillStyle = '#2e1d12';
    ctx.fillRect(c.x - 12, baseY - CUST_H - 1, 24, 3);
    ctx.fillRect(c.x - 8, baseY - CUST_H - 7, 16, 6);

    if (c.drinking) {
        // Raised mug while they drink.
        ctx.fillStyle = '#f0a828';
        roundRect(c.x + 8, baseY - CUST_H + 4, 11, 13, 2);
        ctx.fill();
        ctx.fillStyle = '#fdf3e0';
        ctx.fillRect(c.x + 8, baseY - CUST_H + 4, 11, 3);
    } else {
        // Arms reaching for the next one.
        ctx.strokeStyle = hue;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(c.x + CUST_HW - 2, baseY - CUST_H + 20);
        ctx.lineTo(c.x + CUST_HW + 8, baseY - CUST_H + 15);
        ctx.stroke();
    }
}

function drawMug(mug) {
    const y = LANE_Y[mug.lane];
    const baseY = y + 1;
    const full = mug.dir === -1;

    ctx.fillStyle = full ? '#e2941f' : '#6f5636';
    roundRect(mug.x - MUG_HW, baseY - MUG_H, MUG_HW * 2, MUG_H, 3);
    ctx.fill();

    ctx.fillStyle = full ? '#fdf6e6' : '#8d7048';
    ctx.fillRect(mug.x - MUG_HW, baseY - MUG_H, MUG_HW * 2, full ? 6 : 3);

    // Handle.
    ctx.strokeStyle = full ? '#b8761a' : '#5b452b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(mug.x + MUG_HW + 1, baseY - MUG_H / 2 - 2, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawTip(tip) {
    const y = LANE_Y[tip.lane] - TIP_R;
    ctx.fillStyle = '#f4d03f';
    ctx.beginPath();
    ctx.arc(tip.x, y, TIP_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a5811a';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawBartender() {
    const y = LANE_Y[bartender.lane];
    const baseY = y + 2;

    drawShadow(BARTENDER_X, baseY, 17);

    ctx.fillStyle = '#f2efe6';
    roundRect(BARTENDER_X - 14, baseY - 46, 28, 34, 5);
    ctx.fill();

    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(BARTENDER_X, baseY - 54, 10, 0, Math.PI * 2);
    ctx.fill();

    // Apron.
    ctx.fillStyle = '#c8553d';
    ctx.fillRect(BARTENDER_X - 12, baseY - 20, 24, 18);

    // Arm on the tap.
    ctx.strokeStyle = '#f2efe6';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(BARTENDER_X - 12, baseY - 38);
    ctx.lineTo(BAR_RIGHT + 6, baseY - 30);
    ctx.stroke();
}

function drawEffects() {
    for (const fx of effects) {
        const t = Math.max(0, fx.life / 0.45);
        ctx.globalAlpha = t;
        if (fx.kind === 'shatter' || fx.kind === 'grab') {
            ctx.strokeStyle = fx.kind === 'grab' ? '#e2543f' : '#f0d6a8';
            ctx.lineWidth = 2;
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                const r = 6 + (1 - t) * 20;
                ctx.beginPath();
                ctx.moveTo(fx.x, fx.y - 8);
                ctx.lineTo(fx.x + Math.cos(a) * r, fx.y - 8 + Math.sin(a) * r);
                ctx.stroke();
            }
        } else {
            ctx.fillStyle = fx.kind === 'tip' ? '#f4d03f' : '#f0a828';
            ctx.beginPath();
            ctx.arc(fx.x, fx.y - 12 - (1 - t) * 14, 4 + t * 4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const HANDLED_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar', 'Enter',
]);

document.addEventListener('keydown', (e) => {
    if (HANDLED_KEYS.has(e.key)) e.preventDefault();

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (key === 'ArrowUp' || key === 'w') moveBartender(-1);
    else if (key === 'ArrowDown' || key === 's') moveBartender(1);
    else if (key === 'p') togglePause();
    else if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'playing') serve();
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
    if (autoStep) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('tapper-best') || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
startWave();
updateHud();
showOverlay('TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
