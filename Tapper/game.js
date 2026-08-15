// Tapper — serve the thirsty crowd across four bars without breaking a glass.
//
// Everything the simulation needs lives in plain globals so the Playwright specs
// can drive the game directly: `step(dt)` advances one frame's worth of physics
// and `draw()` paints, with requestAnimationFrame doing nothing but supplying dt.

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 460;

const LANES = 4;
const LANE_Y = [95, 190, 285, 380]; // y of each bar top (the sliding surface)

const BAR_LEFT = 40; // far end of the bar, where customers walk in
const BAR_RIGHT = 560; // near end, where the taps are
const BARKEEP_X = 596; // the barkeep stands just past the taps

const MUG_START_X = BAR_RIGHT - 8; // a fresh mug leaves the tap here
const GRAB_X = BAR_RIGHT - 10; // a customer this far along grabs the barkeep
const LEAVE_X = BAR_LEFT - 8; // pushed past here and a customer is done
const SPAWN_X = BAR_LEFT + 8; // where a new customer steps up to the bar
const CATCH_X = BAR_RIGHT - 12; // the barkeep's reach for returning glassware
const SMASH_X = BARKEEP_X; // past the barkeep's reach: the floor

const CUSTOMER_W = 26;
const CATCH_R = 17; // a mug within this of a customer's centre is taken

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const MUG_SPEED = 230; // full mug, sliding away from the taps
const EMPTY_SPEED = 200; // empty glass, sliding back toward the taps
const TIP_SPEED = 170; // a coin left on the bar
const DRINK_SPEED = 95; // how fast a drinking customer is pushed back
const DRINK_TIME = 2; // seconds spent drinking one mug
const POUR_COOLDOWN = 0.25; // seconds between pours
const DEATH_PAUSE = 1.5;
const CLEAR_PAUSE = 1.6;
const START_LIVES = 3;

const SERVE_POINTS = 50; // a customer takes a mug
const LEAVE_POINTS = 200; // a customer is pushed off the end, happy
const EMPTY_POINTS = 25; // an empty glass caught at the taps
const TIP_POINTS = 300; // a tip collected
const TIP_EVERY = 4; // every Nth happy customer leaves one

const BEST_KEY = 'tapper-best';

const customersForLevel = (l) => 5 + l;
const customerSpeed = () => Math.min(22 + 4 * (level - 1), 55);
const spawnInterval = () => Math.max(0.8, 2.0 - 0.15 * (level - 1));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const el = {
    score: document.getElementById('score'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    remaining: document.getElementById('remaining'),
    best: document.getElementById('best'),
    overlay: document.getElementById('overlay'),
    title: document.getElementById('overlay-title'),
    overlayScore: document.getElementById('overlay-score'),
    sub: document.getElementById('overlay-sub'),
    start: document.getElementById('btn-start'),
};

let state = 'idle'; // idle | running | paused | dying | levelclear | over
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let served = 0; // happy customers this level
let spawnEnabled = true;
let spawnTimer = 0;
let tapCooldown = 0;
let deathTimer = 0;
let clearTimer = 0;
let flash = 0; // brief highlight after a smash
let mishap = ''; // what went wrong on the last life lost

const barkeep = { lane: 0, x: BARKEEP_X, y: LANE_Y[0], pour: 0 };
let customers = [];
let mugs = [];
let empties = [];
let tips = [];

const remaining = () => Math.max(0, customersForLevel(level) - served);

// ---------------------------------------------------------------------------
// Spawning helpers (also the specs' seams into the world)
// ---------------------------------------------------------------------------
function spawnCustomer(lane, x) {
    const c = {
        lane,
        x,
        state: 'advancing', // advancing | drinking
        drink: 0,
        bob: Math.random() * Math.PI * 2,
        tone: Math.floor(Math.random() * 4),
    };
    customers.push(c);
    return c;
}

function spawnEmpty(lane, x) {
    const e = { lane, x };
    empties.push(e);
    return e;
}

function spawnTip(lane, x) {
    const t = { lane, x, spin: 0 };
    tips.push(t);
    return t;
}

function placeBarkeep(lane) {
    barkeep.lane = Math.max(0, Math.min(LANES - 1, lane));
    barkeep.y = LANE_Y[barkeep.lane];
    return barkeep;
}

function pour() {
    if (state !== 'running' || tapCooldown > 0) return null;
    tapCooldown = POUR_COOLDOWN;
    barkeep.pour = 0.18;
    const m = { lane: barkeep.lane, x: MUG_START_X };
    mugs.push(m);
    return m;
}

function clearBar() {
    customers = [];
    mugs = [];
    empties = [];
    tips = [];
    spawnTimer = 0.8;
    tapCooldown = 0;
}

// Used by the specs to fast-forward a level's quota of happy customers.
function serveEveryoneForTest() {
    served = customersForLevel(level);
    clearBar();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    served = 0;
    spawnEnabled = true;
    flash = 0;
    placeBarkeep(0);
    clearBar();
    state = 'running';
    syncHud();
    hideOverlay();
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

function loseLife(reason) {
    if (state !== 'running') return;
    lives--;
    flash = 0.4;
    state = 'dying';
    deathTimer = DEATH_PAUSE;
    mishap = reason;
    syncHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage unavailable — keep the in-memory best */
        }
    }
    syncHud();
    showOverlay('LAST ORDERS', `Score ${score}`, 'Press Space or Enter to play again');
}

function nextLevel() {
    level++;
    served = 0;
    clearBar();
    state = 'running';
    syncHud();
    hideOverlay();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function step(dt) {
    if (flash > 0) flash = Math.max(0, flash - dt);

    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) {
            if (lives <= 0) gameOver();
            else {
                clearBar();
                state = 'running';
            }
        }
        return;
    }

    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        return;
    }

    if (state !== 'running') return;

    if (tapCooldown > 0) tapCooldown = Math.max(0, tapCooldown - dt);
    if (barkeep.pour > 0) barkeep.pour = Math.max(0, barkeep.pour - dt);

    stepSpawning(dt);
    stepCustomers(dt);
    stepMugs(dt);
    if (state !== 'running') return; // a smash ended the round mid-update
    stepEmpties(dt);
    if (state !== 'running') return;
    stepTips(dt);
    checkLevelClear();
    syncHud();
}

function stepSpawning(dt) {
    if (!spawnEnabled) return;
    if (served + customers.length >= customersForLevel(level)) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval();

    // Prefer a bar whose far end is clear so arrivals never overlap.
    const free = [];
    for (let lane = 0; lane < LANES; lane++) {
        if (!customers.some((c) => c.lane === lane && c.x < SPAWN_X + 48)) free.push(lane);
    }
    if (!free.length) return;
    spawnCustomer(free[Math.floor(Math.random() * free.length)], SPAWN_X);
}

function stepCustomers(dt) {
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        c.bob += dt * 6;
        if (c.state === 'drinking') {
            c.x -= DRINK_SPEED * dt;
            c.drink -= dt;
            if (c.x <= LEAVE_X) {
                customers.splice(i, 1);
                happyCustomer(c);
                continue;
            }
            if (c.drink <= 0) c.state = 'advancing';
        } else {
            c.x += customerSpeed() * dt;
            if (c.x >= GRAB_X) {
                loseLife('grabbed');
                return;
            }
        }
    }
}

function happyCustomer(c) {
    served++;
    score += LEAVE_POINTS;
    if (served % TIP_EVERY === 0) spawnTip(c.lane, BAR_LEFT + 20);
}

function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x -= MUG_SPEED * dt;

        const taker = customerAt(m.lane, m.x);
        if (taker) {
            mugs.splice(i, 1);
            taker.state = 'drinking';
            taker.drink = DRINK_TIME;
            score += SERVE_POINTS;
            spawnEmpty(taker.lane, taker.x);
            continue;
        }

        if (m.x <= BAR_LEFT) {
            mugs.splice(i, 1);
            loseLife('spilled');
            return;
        }
    }
}

// The rightmost customer on `lane` whose body the mug has reached, if any.
function customerAt(lane, x) {
    let best = null;
    for (const c of customers) {
        if (c.lane !== lane) continue;
        if (x > c.x + CATCH_R || x < c.x - CATCH_R) continue;
        if (!best || c.x > best.x) best = c;
    }
    return best;
}

function stepEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const e = empties[i];
        e.x += EMPTY_SPEED * dt;
        if (e.x >= CATCH_X && barkeep.lane === e.lane) {
            empties.splice(i, 1);
            score += EMPTY_POINTS;
            continue;
        }
        if (e.x >= SMASH_X) {
            empties.splice(i, 1);
            loseLife('smashed');
            return;
        }
    }
}

function stepTips(dt) {
    for (let i = tips.length - 1; i >= 0; i--) {
        const t = tips[i];
        t.x += TIP_SPEED * dt;
        t.spin += dt * 10;
        if (t.x >= CATCH_X && barkeep.lane === t.lane) {
            tips.splice(i, 1);
            score += TIP_POINTS;
            continue;
        }
        if (t.x >= SMASH_X) tips.splice(i, 1); // rolled away, no harm done
    }
}

function checkLevelClear() {
    if (served < customersForLevel(level)) return;
    if (customers.length || mugs.length) return;
    state = 'levelclear';
    clearTimer = CLEAR_PAUSE;
    showOverlay(`BAR ${level} CLEAR`, `Score ${score}`, 'Next round coming up…');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const WOOD = ['#8a5527', '#7d4c22', '#8f5a2b', '#77471f'];

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    drawRoom();
    drawTapWall();
    for (let lane = 0; lane < LANES; lane++) drawBar(lane);

    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m.x, LANE_Y[m.lane], true);
    for (const e of empties) drawMug(e.x, LANE_Y[e.lane], false);
    for (const t of tips) drawTip(t);

    drawBarkeep();

    if (flash > 0) {
        ctx.fillStyle = `rgba(229, 89, 74, ${0.35 * flash})`;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    if (state === 'idle') drawBanner('Tapper', 'Space to start pulling pints');
    if (state === 'dying') {
        const left = `${lives} ${lives === 1 ? 'life' : 'lives'} left`;
        drawBanner(MISHAP[mishap] || 'BROKEN GLASS!', left);
    }
}

// Panelled saloon wall, a doorway at the far end of every bar, and a lamp above
// each counter so the four playfields read as separate rooms of one room.
function drawRoom() {
    const bg = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    bg.addColorStop(0, '#2a1d13');
    bg.addColorStop(1, '#140e09');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    for (let x = 0; x < CANVAS_W; x += 32) ctx.fillRect(x, 0, 2, CANVAS_H);

    for (let lane = 0; lane < LANES; lane++) {
        const y = LANE_Y[lane];

        // Lamp glow over the counter.
        const glow = ctx.createRadialGradient(CANVAS_W / 2, y - 70, 6, CANVAS_W / 2, y - 20, 210);
        glow.addColorStop(0, 'rgba(255, 206, 120, 0.16)');
        glow.addColorStop(1, 'rgba(255, 206, 120, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, y - 90, CANVAS_W, 100);

        // Swing door the customers come through.
        ctx.fillStyle = '#1b120b';
        ctx.fillRect(6, y - 62, 28, 62);
        ctx.fillStyle = '#5c3a1c';
        ctx.fillRect(6, y - 62, 28, 4);
        ctx.fillRect(6, y - 34, 28, 5);
    }
}

function drawTapWall() {
    ctx.fillStyle = '#33210f';
    ctx.fillRect(BAR_RIGHT + 4, 0, CANVAS_W - BAR_RIGHT - 4, CANVAS_H);
    ctx.fillStyle = '#4a3016';
    ctx.fillRect(BAR_RIGHT + 4, 0, 4, CANVAS_H);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    for (let y = 0; y < CANVAS_H; y += 26) ctx.fillRect(BAR_RIGHT + 8, y, CANVAS_W, 2);
}

function drawBar(lane) {
    const y = LANE_Y[lane];
    const w = BAR_RIGHT - BAR_LEFT;

    // Counter top, front panel and a couple of legs.
    const top = ctx.createLinearGradient(0, y - 2, 0, y + 12);
    top.addColorStop(0, '#b07a3d');
    top.addColorStop(0.4, WOOD[lane % WOOD.length]);
    top.addColorStop(1, '#5e3616');
    ctx.fillStyle = top;
    ctx.fillRect(BAR_LEFT, y, w, 12);
    ctx.fillStyle = 'rgba(255, 240, 210, 0.22)';
    ctx.fillRect(BAR_LEFT, y, w, 2);
    ctx.fillStyle = '#3d2410';
    ctx.fillRect(BAR_LEFT, y + 12, w, 7);
    ctx.fillStyle = '#2c1a0b';
    for (let x = BAR_LEFT + 30; x < BAR_RIGHT; x += 120) ctx.fillRect(x, y + 19, 8, 12);

    // Tap head at the near end, dripping while it pours.
    ctx.fillStyle = '#d8b23a';
    ctx.fillRect(BAR_RIGHT - 7, y - 30, 7, 30);
    ctx.fillRect(BAR_RIGHT - 15, y - 34, 22, 6);
    ctx.fillStyle = '#8d6c17';
    ctx.fillRect(BAR_RIGHT - 7, y - 30, 2, 30);
    if (barkeep.lane === lane && barkeep.pour > 0) {
        ctx.fillStyle = '#f6dc9c';
        ctx.fillRect(BAR_RIGHT - 6, y - 14, 4, 14);
    }
}

const SHIRTS = ['#4a7fd0', '#c65b4a', '#5aa35e', '#9c5fbf'];
const HATS = ['#2b4d86', '#7d3327', '#33643a', '#5d3775'];

function drawCustomer(c) {
    const y = LANE_Y[c.lane];
    const drinking = c.state === 'drinking';
    const stride = Math.sin(c.bob) * 2;
    const lift = drinking ? 0 : stride;

    // Legs, striding while they advance.
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(c.x - 9, y - 12, 6, 12 + (drinking ? 0 : stride));
    ctx.fillRect(c.x + 3, y - 12, 6, 12 - (drinking ? 0 : stride));

    ctx.fillStyle = SHIRTS[c.tone % SHIRTS.length];
    ctx.fillRect(c.x - CUSTOMER_W / 2, y - 34 + lift, CUSTOMER_W, 24);

    ctx.fillStyle = '#e6bd94';
    ctx.beginPath();
    ctx.arc(c.x, y - 43 + lift, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = HATS[c.tone % HATS.length];
    ctx.fillRect(c.x - 11, y - 52 + lift, 22, 6);
    ctx.fillRect(c.x - 7, y - 57 + lift, 14, 5);

    if (drinking) {
        // Mug tipped up to the customer's face.
        ctx.fillStyle = '#e8a13a';
        ctx.fillRect(c.x + 7, y - 50, 10, 13);
        ctx.fillStyle = '#fff4dd';
        ctx.fillRect(c.x + 7, y - 50, 10, 3);
    } else {
        // An impatient fist thumping the bar.
        ctx.fillStyle = '#e6bd94';
        ctx.fillRect(c.x + CUSTOMER_W / 2 - 3, y - 18 + lift, 9, 7);
    }
}

function drawMug(x, y, full) {
    const top = y - 19;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(x - 8, y - 1, 18, 3);

    ctx.fillStyle = full ? '#e29a2f' : 'rgba(216, 226, 232, 0.5)';
    ctx.fillRect(x - 8, top, 16, 19);
    if (full) {
        ctx.fillStyle = '#f6bd58';
        ctx.fillRect(x - 8, top, 5, 19);
        ctx.fillStyle = '#fff6e2';
        ctx.fillRect(x - 8, top - 5, 16, 6);
    } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillRect(x - 6, top + 2, 3, 15);
    }

    // Handle.
    ctx.strokeStyle = full ? '#c07f22' : 'rgba(216, 226, 232, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + 8, top + 9, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 8.5, top - 0.5, 17, 20);
}

function drawTip(t) {
    const y = LANE_Y[t.lane];
    const w = 3 + Math.abs(Math.cos(t.spin)) * 5;
    ctx.fillStyle = '#f5d33f';
    ctx.beginPath();
    ctx.ellipse(t.x, y - 8, w, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a67c12';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillRect(t.x - w / 3, y - 12, Math.max(1, w / 3), 3);
}

function drawBarkeep() {
    const x = barkeep.x;
    const y = barkeep.y;
    const pouring = barkeep.pour > 0;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x - 14, y - 2, 28, 4);

    ctx.fillStyle = '#2f2118';
    ctx.fillRect(x - 10, y - 12, 7, 12);
    ctx.fillRect(x + 3, y - 12, 7, 12);

    ctx.fillStyle = '#f4f0e6'; // apron
    ctx.fillRect(x - 13, y - 38, 26, 26);
    ctx.fillStyle = '#c94f3d'; // waist sash
    ctx.fillRect(x - 13, y - 20, 26, 7);

    ctx.fillStyle = '#e6bd94';
    ctx.beginPath();
    ctx.arc(x, y - 47, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f0e6'; // barkeep's cap
    ctx.fillRect(x - 11, y - 60, 22, 10);
    ctx.fillRect(x - 13, y - 51, 26, 4);

    // Arm on the tap handle, dipping as the mug fills.
    ctx.fillStyle = '#e6bd94';
    ctx.fillRect(x - 26, y - 34 + (pouring ? 6 : 0), 15, 7);
}

const MISHAP = {
    grabbed: 'GRABBED!',
    spilled: 'SPILLED!',
    smashed: 'BROKEN GLASS!',
};

function drawBanner(title, sub) {
    ctx.fillStyle = 'rgba(8, 6, 4, 0.55)';
    ctx.fillRect(0, CANVAS_H / 2 - 42, CANVAS_W, 84);
    ctx.fillStyle = '#f0a63c';
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, CANVAS_W / 2, CANVAS_H / 2 - 4);
    ctx.fillStyle = '#c8b49c';
    ctx.font = '14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(sub, CANVAS_W / 2, CANVAS_H / 2 + 24);
    ctx.textAlign = 'start';
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------
function syncHud() {
    el.score.textContent = String(score);
    el.level.textContent = String(level);
    el.lives.textContent = String(Math.max(0, lives));
    el.remaining.textContent = String(remaining());
    el.best.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    el.title.textContent = title;
    el.overlayScore.textContent = scoreLine;
    el.sub.textContent = sub;
    el.overlay.classList.add('visible');
    el.start.textContent = state === 'paused' ? 'Resume' : 'Start Game';
}

function hideOverlay() {
    el.overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function moveBarkeep(delta) {
    placeBarkeep(barkeep.lane + delta);
}

document.addEventListener('keydown', (e) => {
    const key = e.key;

    if (key === ' ' || key === 'Spacebar' || key === 'ArrowUp' || key === 'ArrowDown') {
        e.preventDefault();
    }

    if (key === 'p' || key === 'P') {
        togglePause();
        return;
    }

    if (state === 'idle' || state === 'over') {
        if (key === ' ' || key === 'Spacebar' || key === 'Enter') startGame();
        return;
    }

    if (state !== 'running') return;

    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        if (!e.repeat) moveBarkeep(-1);
    } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
        if (!e.repeat) moveBarkeep(1);
    } else if (key === ' ' || key === 'Spacebar') {
        pour();
    }
});

el.start.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else if (state !== 'running') startGame();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
try {
    best = Number(window.localStorage.getItem(BEST_KEY)) || 0;
} catch (err) {
    best = 0;
}

placeBarkeep(0);
syncHud();

let last = 0;
function frame(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 0;
    last = now;
    if (dt > 0) step(dt);
    draw();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
