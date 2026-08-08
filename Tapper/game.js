// ---------------------------------------------------------------------------
// Tapper — a lane-based bar-serving arcade game on an HTML5 canvas.
//
// The player is a bartender working four bars at once. Thirsty customers push
// in through the doors at the far (left) end of each bar and shuffle toward the
// taps. The bartender slides a full mug down whichever bar they are standing at;
// a customer who catches one is knocked back toward the door while they drink.
// Push a customer all the way out and they slide their empty mug back down the
// bar — catch it, or it smashes on the floor.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, which runs fixed sub-steps internally, so tests
// can simulate frames deterministically without depending on
// requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 400;

const BARS = 4;              // number of bars (lanes)
const BAR_TOP = 62;          // y of the first bar's surface
const BAR_GAP = 88;          // vertical distance between bars
const BAR_LEFT = 44;         // far end of a bar — the door customers come in by
const TAP_X = 596;           // near end of a bar — where the bartender stands

const MUG_W = 18;
const MUG_H = 22;
const CUST_W = 26;
const CUST_H = 44;

const REACH = (CUST_W + MUG_W) / 2; // how close a mug gets before it is grabbed
const GRAB_DIST = 46;               // how near the tap a customer may get
const CATCH_X = TAP_X - 26;         // where the bartender can grab an empty mug

// --- Player ---
const POUR_COOLDOWN = 0.25;  // seconds between pours

// --- Customers ---
const DRINK_TIME = 1.1;      // seconds a caught mug keeps a customer busy
const PUSHBACK_SPEED = 150;  // px/s a drinking customer slides back
const MAX_PER_LANE = 3;      // crowd limit per bar
const SPAWN_CLEAR = 34;      // keep the doorway clear by this much when spawning

// --- Difficulty scaling (all pure functions of `level`) ---
const MUG_BASE = 300, MUG_STEP = 18;      // full mugs sliding away from the tap
const EMPTY_BASE = 210, EMPTY_STEP = 14;  // empties coming back
const CUST_BASE = 28, CUST_STEP = 7;      // customers advancing
const SPAWN_BASE = 2.4, SPAWN_STEP = 0.18, SPAWN_MIN = 0.85;

const CUSTOMERS_PER_LEVEL = 6;
const START_LIVES = 3;
const MAX_LIVES = 5;

// --- Scoring (also scaled by level) ---
const SERVE_POINTS = 10;   // a customer catches a full mug
const LEAVE_POINTS = 25;   // a customer is pushed out of the door
const TIP_POINTS = 5;      // the bartender catches a returning empty

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
let state, score, best, level, lives, served, spawnTimer, pourTimer;
const bartender = { lane: 0, bob: 0 };
const mugs = [];
const customers = [];
const splashes = [];

// ---------------------------------------------------------------------------
// Geometry & difficulty helpers
// ---------------------------------------------------------------------------

function barY(i) { return BAR_TOP + i * BAR_GAP; }

function mugSpeed() { return MUG_BASE + (level - 1) * MUG_STEP; }
function emptySpeed() { return EMPTY_BASE + (level - 1) * EMPTY_STEP; }
function customerSpeed() { return CUST_BASE + (level - 1) * CUST_STEP; }
function spawnInterval() { return Math.max(SPAWN_MIN, SPAWN_BASE - (level - 1) * SPAWN_STEP); }

function servePoints() { return SERVE_POINTS * level; }
function leavePoints() { return LEAVE_POINTS * level; }
function tipPoints() { return TIP_POINTS * level; }

// ---------------------------------------------------------------------------
// Bartender
// ---------------------------------------------------------------------------

function setLane(lane) {
    bartender.lane = Math.max(0, Math.min(BARS - 1, lane));
}

function moveBartender(delta) {
    setLane(bartender.lane + delta);
}

function pourMug() {
    if (state !== 'running' || pourTimer > 0) return null;
    pourTimer = POUR_COOLDOWN;
    const mug = { lane: bartender.lane, x: TAP_X - 22, dir: -1, empty: false, past: false, wobble: 0 };
    mugs.push(mug);
    return mug;
}

// ---------------------------------------------------------------------------
// Mugs
// ---------------------------------------------------------------------------

function spawnEmpty(opts) {
    opts = opts || {};
    const mug = {
        lane: opts.lane || 0,
        x: opts.x != null ? opts.x : BAR_LEFT,
        dir: 1,
        empty: true,
        past: false,
        wobble: 0,
    };
    mugs.push(mug);
    return mug;
}

// The rightmost customer in the mug's lane that the mug has slid into, or -1.
function findCustomerHit(mug) {
    let hit = -1;
    for (let i = 0; i < customers.length; i++) {
        const c = customers[i];
        if (c.lane !== mug.lane) continue;
        if (mug.x > c.x + REACH || mug.x < c.x - CUST_W) continue;
        if (hit === -1 || c.x > customers[hit].x) hit = i;
    }
    return hit;
}

function catchEmpty(index) {
    const mug = mugs[index];
    mugs.splice(index, 1);
    score += tipPoints();
    spawnSparkle(TAP_X - 20, barY(mug.lane) - 14, '#ffe08a');
}

function smashMug(index) {
    const mug = mugs[index];
    mugs.splice(index, 1);
    spawnSparkle(mug.x, barY(mug.lane) - 10, '#9fd4ff');
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

function spawnCustomer(opts) {
    opts = opts || {};
    const cust = {
        lane: opts.lane || 0,
        x: opts.x != null ? opts.x : BAR_LEFT,
        state: 'advancing',   // 'advancing' | 'drinking'
        drinkTimer: 0,
        step: 0,              // walk-cycle phase, cosmetic only
    };
    customers.push(cust);
    return cust;
}

// Pick a bar with room and a clear doorway, preferring the emptiest one.
function autoSpawnCustomer() {
    const open = [];
    let fewest = Infinity;
    for (let lane = 0; lane < BARS; lane++) {
        const inLane = customers.filter((c) => c.lane === lane);
        if (inLane.length >= MAX_PER_LANE) continue;
        if (inLane.some((c) => c.x < BAR_LEFT + SPAWN_CLEAR)) continue;
        if (inLane.length < fewest) { fewest = inLane.length; open.length = 0; }
        if (inLane.length === fewest) open.push(lane);
    }
    if (!open.length) return null;
    return spawnCustomer({ lane: open[Math.floor(Math.random() * open.length)] });
}

function serveCustomer(custIndex, mugIndex) {
    const cust = customers[custIndex];
    mugs.splice(mugIndex, 1);
    cust.state = 'drinking';
    cust.drinkTimer = DRINK_TIME;
    score += servePoints();
    spawnSparkle(cust.x + 10, barY(cust.lane) - 16, '#ffd166');
}

// Returns true when this departure cleared the level — the caller must stop
// walking the customer/mug arrays, because `nextLevel()` has emptied them.
function leaveCustomer(index) {
    const cust = customers[index];
    customers.splice(index, 1);
    score += leavePoints();
    served += 1;
    spawnEmpty({ lane: cust.lane, x: BAR_LEFT });
    if (served >= CUSTOMERS_PER_LEVEL) {
        nextLevel();
        return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function nextLevel() {
    level += 1;
    served = 0;
    lives = Math.min(MAX_LIVES, lives + 1);
    customers.length = 0;
    mugs.length = 0;
    spawnTimer = spawnInterval();
    pourTimer = 0;
}

// A smashed mug or a customer reaching the tap clears the bars and costs a life.
function loseLife() {
    for (const c of customers) spawnSparkle(c.x, barY(c.lane) - 20, '#ff8f6b');
    mugs.length = 0;
    customers.length = 0;
    spawnTimer = spawnInterval();
    pourTimer = 0;
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        endGame();
    }
}

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    lives = START_LIVES;
    served = 0;
    mugs.length = 0;
    customers.length = 0;
    splashes.length = 0;
    bartender.lane = 0;
    bartender.bob = 0;
    spawnTimer = spawnInterval();
    pourTimer = 0;
    hideOverlay();
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('tapper-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Score ' + score + ' · Level ' + level, 'Press Space to pull another shift', 'Play Again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    if (pourTimer > 0) pourTimer = Math.max(0, pourTimer - h);

    spawnTimer -= h;
    if (spawnTimer <= 0) {
        autoSpawnCustomer();
        spawnTimer += spawnInterval();
    }

    // Customers: advance toward the tap, or slide back while drinking.
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        if (c.state === 'drinking') {
            c.x -= PUSHBACK_SPEED * h;
            c.drinkTimer -= h;
            if (c.x <= BAR_LEFT) {
                // Out of the door — an empty comes back down the bar.
                if (leaveCustomer(i)) return;   // level cleared: bars are wiped
                continue;
            }
            if (c.drinkTimer <= 0) c.state = 'advancing';
        } else {
            c.x += customerSpeed() * h;
            c.step += h;
            if (c.x >= TAP_X - GRAB_DIST) {
                loseLife();             // grabbed the bartender
                return;
            }
        }
    }

    // Mugs: full ones slide away from the tap, empties come back to it.
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x += m.dir * (m.empty ? emptySpeed() : mugSpeed()) * h;
        m.wobble += h;
        if (!m.empty) {
            const hit = findCustomerHit(m);
            if (hit !== -1) {
                serveCustomer(hit, i);
                continue;
            }
            if (m.x <= BAR_LEFT) {
                smashMug(i);
                loseLife();
                return;
            }
        } else {
            if (!m.past && m.x >= CATCH_X) {
                if (bartender.lane === m.lane) {
                    catchEmpty(i);
                    continue;
                }
                m.past = true;          // slid past the bartender — doomed
            }
            if (m.x > CANVAS_W + MUG_W) {
                smashMug(i);
                loseLife();
                return;
            }
        }
    }
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so mug /
// customer crossings are never skipped and the integration is
// resolution-independent.
function step(dt) {
    if (state !== 'running') return;
    const SUB = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-6) {
        const h = Math.min(SUB, remaining);
        substep(h);
        remaining -= h;
        if (state !== 'running') break;
    }
    updateSplashes(dt);
    updateHud();
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
// Sparkles (purely cosmetic)
// ---------------------------------------------------------------------------

function spawnSparkle(x, y, color) {
    for (let i = 0; i < 8; i++) {
        splashes.push({
            x, y,
            vx: (Math.random() - 0.5) * 180,
            vy: -Math.random() * 140,
            life: 0.45,
            color,
        });
    }
}

function updateSplashes(dt) {
    for (let i = splashes.length - 1; i >= 0; i--) {
        const p = splashes[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 620 * dt;
        p.life -= dt;
        if (p.life <= 0) splashes.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawBackground() {
    const room = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    room.addColorStop(0, '#2a1d34');
    room.addColorStop(1, '#150f1d');
    ctx.fillStyle = room;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Doorways down the left — where the thirsty crowd comes in.
    ctx.fillStyle = '#150d1c';
    ctx.fillRect(0, 0, BAR_LEFT - 16, CANVAS_H);
    for (let lane = 0; lane < BARS; lane++) {
        const y = barY(lane);
        ctx.fillStyle = '#0c0712';
        ctx.beginPath();
        ctx.moveTo(4, y);
        ctx.lineTo(4, y - 40);
        ctx.quadraticCurveTo(14, y - 58, 24, y - 40);
        ctx.lineTo(24, y);
        ctx.closePath();
        ctx.fill();
    }

    // Keg wall running down the right-hand side.
    ctx.fillStyle = '#3a2a44';
    ctx.fillRect(TAP_X + 22, 0, CANVAS_W - TAP_X - 22, CANVAS_H);
    ctx.fillStyle = '#573f66';
    ctx.fillRect(TAP_X + 22, 0, 3, CANVAS_H);
}

// A soft glow marking the bar the bartender is currently working.
function drawActiveLane() {
    const y = barY(bartender.lane);
    const glow = ctx.createLinearGradient(0, y - 52, 0, y + 6);
    glow.addColorStop(0, 'rgba(255, 179, 64, 0)');
    glow.addColorStop(1, 'rgba(255, 179, 64, 0.14)');
    ctx.fillStyle = glow;
    ctx.fillRect(BAR_LEFT - 20, y - 52, TAP_X - BAR_LEFT + 40, 58);
}

function drawBar(lane) {
    const y = barY(lane);
    const x0 = BAR_LEFT - 18;
    const w = TAP_X - BAR_LEFT + 36;

    // Counter top, front edge and polished highlight.
    ctx.fillStyle = '#b5793f';
    ctx.fillRect(x0, y, w, 12);
    ctx.fillStyle = '#7d4d24';
    ctx.fillRect(x0, y + 12, w, 7);
    ctx.fillStyle = 'rgba(255, 226, 180, 0.35)';
    ctx.fillRect(x0, y, w, 2);

    // Brass tap hanging over the near end of the bar.
    ctx.fillStyle = '#caa14a';
    ctx.fillRect(TAP_X + 6, y - 34, 9, 24);
    ctx.fillRect(TAP_X - 4, y - 16, 20, 6);
    ctx.fillStyle = '#8d6c26';
    ctx.fillRect(TAP_X - 4, y - 10, 6, 5);
    ctx.fillStyle = '#f0d68a';
    ctx.fillRect(TAP_X + 6, y - 34, 3, 24);
}

function drawShadow(x, y, w) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(x, y + 3, w / 2, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawMug(mug) {
    const y = barY(mug.lane) - MUG_H + 2;
    const x = mug.x - MUG_W / 2;
    drawShadow(mug.x, barY(mug.lane), MUG_W + 6);
    // Glass.
    ctx.fillStyle = mug.empty ? 'rgba(226, 236, 255, 0.35)' : '#e9a227';
    ctx.fillRect(x, y, MUG_W, MUG_H);
    if (!mug.empty) {
        ctx.fillStyle = '#fff4d6';       // foam head
        ctx.fillRect(x, y, MUG_W, 5);
    }
    ctx.strokeStyle = '#f2f4ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, y + 0.5, MUG_W - 1, MUG_H - 1);
    // Handle.
    ctx.beginPath();
    ctx.arc(x + MUG_W + 2, y + MUG_H / 2, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawPerson(x, y, body, head, lean) {
    drawShadow(x, y, 26);
    // Legs.
    ctx.fillStyle = '#2b2233';
    ctx.fillRect(x - 8, y - 12, 6, 12);
    ctx.fillRect(x + 2, y - 12, 6, 12);
    // Body.
    ctx.fillStyle = body;
    ctx.fillRect(x - 11, y - CUST_H + 12, 22, CUST_H - 24);
    // Arms.
    ctx.fillStyle = body;
    ctx.fillRect(x + 9, y - CUST_H + 16 + lean, 8, 6);
    // Head.
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(x, y - CUST_H + 6, 9, 0, Math.PI * 2);
    ctx.fill();
}

function drawCustomer(cust) {
    const y = barY(cust.lane);
    const drinking = cust.state === 'drinking';
    const bob = drinking ? 0 : Math.sin(cust.step * 9) * 2;
    drawPerson(cust.x, y + bob, drinking ? '#6fbf8b' : '#c9556b', '#f0c9a4', drinking ? -6 : 0);
    if (drinking) {
        ctx.fillStyle = '#e9a227';
        ctx.fillRect(cust.x + 8, y - CUST_H + 4, 10, 12);
    }
}

function drawBartender() {
    const y = barY(bartender.lane);
    drawPerson(TAP_X + 2, y, '#4a7fd4', '#f0c9a4', 0);
    // Apron and barman's cap, so the player can pick themselves out at a glance.
    ctx.fillStyle = '#f2f4ff';
    ctx.fillRect(TAP_X - 8, y - 22, 16, 12);
    ctx.fillRect(TAP_X - 7, y - CUST_H + 1, 18, 5);
}

function drawSplashes() {
    for (const p of splashes) {
        ctx.globalAlpha = Math.max(0, p.life / 0.45);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

// Mugs served toward the next level, shown as a row of pips.
function drawServedMeter() {
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#a08fae';
    ctx.textBaseline = 'top';
    ctx.fillText('SERVED', 14, 12);
    for (let i = 0; i < CUSTOMERS_PER_LEVEL; i++) {
        ctx.fillStyle = i < served ? '#ffd166' : 'rgba(255, 209, 102, 0.22)';
        ctx.fillRect(62 + i * 14, 12, 10, 10);
    }
}

function draw() {
    drawBackground();
    drawActiveLane();
    for (let lane = 0; lane < BARS; lane++) drawBar(lane);
    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m);
    drawBartender();
    drawSplashes();
    drawServedMeter();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    const key = e.key;
    if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        if (state === 'running') pourMug();
        else if (state !== 'paused') startGame();
        return;
    }
    if (key === 'p' || key === 'P') {
        togglePause();
        return;
    }
    if (state !== 'running') return;
    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        e.preventDefault();
        moveBartender(-1);
    } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
        e.preventDefault();
        moveBartender(1);
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

canvas.addEventListener('mousedown', () => {
    if (state === 'running') pourMug();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function loadBest() {
    try {
        const raw = localStorage.getItem('tapper-best');
        const n = raw == null ? 0 : parseInt(raw, 10);
        return Number.isFinite(n) ? n : 0;
    } catch (e) {
        return 0;
    }
}

state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
served = 0;
spawnTimer = 0;
pourTimer = 0;
best = loadBest();
updateHud();
draw();

let lastTime = 0;
function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    step(dt);
    if (state !== 'running') updateSplashes(dt);
    draw();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
