// ---------------------------------------------------------------------------
// Soda Tapper — a four-counter soda bar on an HTML5 canvas.
//
// You are the soda jerk at the taps on the right. Patrons shove their way in at
// the far end of each counter and walk toward you. Slide a full mug down a
// counter to stop one: they drink, get shoved backwards, and send the empty
// glass sliding back at you. Be in the lane to catch it.
//
// Three ways to lose a life, and they pull against each other:
//   * a patron reaches the taps and grabs you,
//   * a mug slid down an empty counter smashes on the far end,
//   * a returning empty arrives in a lane you are not standing in.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Snake, Tetris,
// BurgerTime and Gold Runner in this repo. All motion is expressed per second
// and advanced through `step(dt)`, so the tests can simulate frames
// deterministically without depending on requestAnimationFrame wall-clock time.
//
// Positions are a lane index plus a pixel x along that lane, so every
// interaction is a one-dimensional overlap test inside a single lane. There is
// no grid and no 2-D collision, which keeps the rules decidable.
// ---------------------------------------------------------------------------

// --- Geometry ------------------------------------------------------------
const CANVAS_W = 760;
const CANVAS_H = 470;
const LANES = 4;
const LANE_TOP = 26;        // y of the first counter band
const LANE_H = 108;         // height of one counter band
const BAR_LEFT = 70;        // far end: patrons enter here, mugs smash here
const BAR_RIGHT = 672;      // tap end: empties are caught, patrons grab you
const BARMAN_X = 724;       // where the barman is drawn, right of the taps
const CUST_R = 18;          // patron collision half-width
const MUG_R = 9;            // mug collision half-width
const MIN_GAP = 2 * CUST_R + 10;   // closest two patrons are ever placed

// --- Speeds (pixels per second) and timings (seconds) --------------------
const MUG_SPEED = 300;
const EMPTY_SPEED = 215;
const CUST_BASE_SPEED = 26;
const CUST_SPEED_STEP = 5.5;
const PUSH_BACK = 86;       // how far a drink shoves a patron back
const PUSH_SPEED = 170;
const DRINK_TIME = 0.9;
const LEAVE_SPEED = 150;
const POUR_COOLDOWN = 0.22;
const LIFE_PAUSE = 1.1;
const CLEAR_PAUSE = 1.5;
const LIFE_PUSHBACK = 60;   // breathing room given back after a lost life

// --- Scoring and run structure -------------------------------------------
const START_LIVES = 3;
const SERVE_POINTS = 50;
const CATCH_POINTS = 25;
const SATISFIED_POINTS = 100;
const LEVEL_BONUS = 750;
const BEST_KEY = 'sodatapper-best';

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const leftEl = document.getElementById('left');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const startBtn = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
// 'idle' | 'playing' | 'paused' | 'life' | 'clear' | 'gameover'
let state = 'idle';
let score = 0;
let lives = START_LIVES;
let level = 1;
let best = 0;
let served = 0;              // patrons satisfied this run
let spawnedThisLevel = 0;    // guards the level-clear test
let phaseTimer = 0;          // counts down the 'life' and 'clear' interludes
let pourCd = 0;
let spawnTimer = 0;
let autoStep = true;         // tests switch the real clock off

const barman = { lane: 1 };
const customers = [];        // { lane, x, speed, thirst, mode, timer, push }
const mugs = [];             // { lane, x, vx }  vx < 0, sliding away from taps
const empties = [];          // { lane, x, vx }  vx > 0, sliding back to taps
const pending = [];          // { lane, thirst, at }  queued arrivals
const splashes = [];         // { lane, x, t, good }  short-lived effects

// --- Seeded RNG ----------------------------------------------------------
// A tiny LCG so a run is reproducible and a spec can pin the arrival order.
let seed = (Date.now() >>> 0) || 1;
function setSeed(n) {
    seed = (n >>> 0) || 1;
}
function rng() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
}

// --- Level shape ---------------------------------------------------------
const customersForLevel = (l) => 6 + 2 * l;
const spawnInterval = (l) => Math.max(1.05, 2.6 - 0.18 * (l - 1));
const custSpeed = (l) => CUST_BASE_SPEED + CUST_SPEED_STEP * (l - 1);
const thirstChance = (l) => Math.min(0.5, 0.12 * (l - 1));

const laneMid = (i) => LANE_TOP + i * LANE_H + LANE_H * 0.5;
const barY = (i) => laneMid(i) + 28;     // the counter's top surface
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
function buildLevel(l) {
    customers.length = 0;
    mugs.length = 0;
    empties.length = 0;
    pending.length = 0;
    splashes.length = 0;
    spawnedThisLevel = 0;
    spawnTimer = 0;
    pourCd = 0;

    let at = 0.6;
    const count = customersForLevel(l);
    for (let i = 0; i < count; i++) {
        pending.push({
            lane: Math.floor(rng() * LANES),
            thirst: rng() < thirstChance(l) ? 2 : 1,
            at,
        });
        at += spawnInterval(l) * (0.75 + rng() * 0.5);
    }
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    served = 0;
    phaseTimer = 0;
    barman.lane = 1;
    buildLevel(level);
    state = 'playing';
    hideOverlay();
    updateHud();
}

function spawnCustomer(lane, thirst) {
    customers.push({
        lane,
        x: BAR_LEFT + 4,
        speed: custSpeed(level),
        thirst,
        mode: 'advancing',
        timer: 0,
        push: 0,
    });
    spawnedThisLevel++;
}

const laneEntryBlocked = (lane) =>
    customers.some((c) => c.lane === lane && c.x < BAR_LEFT + MIN_GAP);

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------
function moveBarman(dir) {
    if (state !== 'playing') return;
    barman.lane = clamp(barman.lane + dir, 0, LANES - 1);
}

function tryServe() {
    if (state !== 'playing') return false;
    if (pourCd > 0) return false;
    pourCd = POUR_COOLDOWN;
    mugs.push({ lane: barman.lane, x: BAR_RIGHT - 16, vx: -MUG_SPEED });
    return true;
}

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to get back to the taps');
    } else if (state === 'paused') {
        state = 'playing';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function step(dt) {
    if (state === 'life' || state === 'clear') {
        phaseTimer -= dt;
        if (phaseTimer <= 0) {
            if (state === 'clear') {
                level++;
                buildLevel(level);
            }
            state = 'playing';
            updateHud();
        }
        decaySplashes(dt);
        return;
    }
    if (state !== 'playing') return;

    pourCd = Math.max(0, pourCd - dt);
    spawnTimer += dt;
    decaySplashes(dt);

    while (pending.length && spawnTimer >= pending[0].at) {
        const next = pending[0];
        if (laneEntryBlocked(next.lane)) {
            next.at = spawnTimer + 0.35;   // the doorway is busy; try again shortly
            break;
        }
        pending.shift();
        spawnCustomer(next.lane, next.thirst);
    }

    for (let i = customers.length - 1; i >= 0; i--) {
        if (state !== 'playing') break;
        stepCustomer(customers[i], dt, i);
    }
    for (let i = mugs.length - 1; i >= 0; i--) {
        if (state !== 'playing') break;
        stepMug(mugs[i], dt, i);
    }
    for (let i = empties.length - 1; i >= 0; i--) {
        if (state !== 'playing') break;
        stepEmpty(empties[i], dt, i);
    }

    if (state === 'playing' && spawnedThisLevel > 0 && !pending.length &&
        !customers.length && !mugs.length && !empties.length) {
        score += LEVEL_BONUS;
        state = 'clear';
        phaseTimer = CLEAR_PAUSE;
    }
    updateHud();
}

function stepCustomer(c, dt, i) {
    if (c.mode === 'advancing') {
        c.x += c.speed * dt;
        if (c.x >= BAR_RIGHT - CUST_R * 0.5) {
            customers.splice(i, 1);
            splash(c.lane, BAR_RIGHT - 24, false);
            loseLife();
        }
        return;
    }
    if (c.mode === 'drinking') {
        if (c.push > 0) {
            const d = Math.min(c.push, PUSH_SPEED * dt);
            c.x = Math.max(BAR_LEFT, c.x - d);
            c.push -= d;
        }
        c.timer -= dt;
        if (c.timer <= 0) {
            empties.push({ lane: c.lane, x: Math.min(c.x + 6, BAR_RIGHT - 2), vx: EMPTY_SPEED });
            c.thirst -= 1;
            c.mode = c.thirst <= 0 ? 'leaving' : 'advancing';
            c.timer = 0;
        }
        return;
    }
    // leaving
    c.x -= LEAVE_SPEED * dt;
    if (c.x < BAR_LEFT - 34) {
        customers.splice(i, 1);
        served++;
        score += SATISFIED_POINTS;
    }
}

function stepMug(m, dt, i) {
    m.x += m.vx * dt;
    const target = frontAdvancing(m.lane);
    if (target && m.x - MUG_R <= target.x + CUST_R) {
        mugs.splice(i, 1);
        target.mode = 'drinking';
        target.timer = DRINK_TIME;
        target.push = PUSH_BACK;
        score += SERVE_POINTS;
        splash(target.lane, target.x, true);
        return;
    }
    if (m.x <= BAR_LEFT) {
        mugs.splice(i, 1);
        splash(m.lane, BAR_LEFT, false);
        loseLife();
    }
}

function stepEmpty(e, dt, i) {
    e.x += e.vx * dt;
    if (e.x < BAR_RIGHT) return;
    empties.splice(i, 1);
    if (barman.lane === e.lane) {
        score += CATCH_POINTS;
        splash(e.lane, BAR_RIGHT - 6, true);
    } else {
        splash(e.lane, BAR_RIGHT - 6, false);
        loseLife();
    }
}

// The mug slides away from the taps, so it meets the patron nearest the taps
// first. Patrons that are drinking or walking out are ignored: a mug slides
// straight past them, which is what makes a wasted mug a real mistake.
function frontAdvancing(lane) {
    let front = null;
    for (const c of customers) {
        if (c.lane !== lane || c.mode !== 'advancing') continue;
        if (!front || c.x > front.x) front = c;
    }
    return front;
}

function loseLife() {
    lives = Math.max(0, lives - 1);
    mugs.length = 0;
    empties.length = 0;
    pushPatronsBack();

    if (lives <= 0) {
        state = 'gameover';
        saveBest();
        showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space to pull another shift');
    } else {
        state = 'life';
        phaseTimer = LIFE_PAUSE;
    }
    updateHud();
}

// Shove everyone back so play never resumes with a patron on top of the taps,
// then sweep each lane front-to-back so the clamp at the far end cannot stack
// two patrons in the same spot.
function pushPatronsBack() {
    for (const c of customers) c.x = Math.max(BAR_LEFT, c.x - LIFE_PUSHBACK);
    for (let lane = 0; lane < LANES; lane++) {
        const inLane = customers.filter((c) => c.lane === lane).sort((a, b) => a.x - b.x);
        let floorX = BAR_LEFT;
        for (const c of inLane) {
            c.x = Math.max(c.x, floorX);
            floorX = c.x + MIN_GAP;
        }
    }
}

function splash(lane, x, good) {
    splashes.push({ lane, x, t: good ? 0.32 : 0.55, life: good ? 0.32 : 0.55, good });
}

function decaySplashes(dt) {
    for (let i = splashes.length - 1; i >= 0; i--) {
        splashes[i].t -= dt;
        if (splashes[i].t <= 0) splashes.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------
function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    leftEl.textContent = String(pending.length + customers.length);
    livesEl.textContent = String(lives);
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

function loadBest() {
    const raw = Number(window.localStorage.getItem(BEST_KEY));
    best = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

function saveBest() {
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* private browsing: the run still counts, it just is not remembered */
        }
    }
}

// ---------------------------------------------------------------------------
// Rendering — a pure function of state; nothing here mutates the simulation.
// ---------------------------------------------------------------------------
function draw() {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#2b1f3d');
    sky.addColorStop(1, '#130d1d');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    for (let i = 0; i < LANES; i++) drawLane(i);
    drawTapColumn();
    drawBarman();
    drawSplashes();

    if (state === 'life') {
        ctx.fillStyle = 'rgba(255, 90, 90, 0.10)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
}

function drawLane(i) {
    const top = LANE_TOP + i * LANE_H;
    const y = barY(i);
    const lit = i === barman.lane && state !== 'idle';

    // Back wall of this counter's alcove.
    const wall = ctx.createLinearGradient(0, top, 0, top + LANE_H - 4);
    wall.addColorStop(0, i % 2 ? '#2b2040' : '#251b3a');
    wall.addColorStop(1, '#1a1228');
    ctx.fillStyle = wall;
    ctx.fillRect(0, top, CANVAS_W, LANE_H - 4);
    ctx.fillStyle = lit ? 'rgba(255, 180, 61, 0.08)' : 'rgba(255, 255, 255, 0.015)';
    ctx.fillRect(0, top, CANVAS_W, LANE_H - 4);

    // Neon strip along the top of the booth.
    ctx.fillStyle = lit ? 'rgba(255, 180, 61, 0.55)' : 'rgba(126, 94, 170, 0.35)';
    ctx.fillRect(BAR_LEFT - 30, top + 4, BAR_RIGHT + 22 - (BAR_LEFT - 30), 2);

    // Doorway the patrons come through, at the far end.
    ctx.fillStyle = '#120c1b';
    ctx.beginPath();
    ctx.roundRect(BAR_LEFT - 58, top + 12, 44, LANE_H - 34, 10);
    ctx.fill();
    ctx.strokeStyle = '#3c2b55';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Patrons stand behind the counter, so they are drawn before the plank.
    for (const c of customers) if (c.lane === i) drawCustomer(c);

    // The counter itself: a plank with grain and a lip.
    const wood = ctx.createLinearGradient(0, y - 4, 0, y + 16);
    wood.addColorStop(0, '#9d6334');
    wood.addColorStop(0.45, '#7d4a26');
    wood.addColorStop(1, '#4e2d17');
    ctx.fillStyle = wood;
    ctx.fillRect(BAR_LEFT - 30, y - 4, BAR_RIGHT + 22 - (BAR_LEFT - 30), 18);
    ctx.fillStyle = 'rgba(255, 220, 170, 0.16)';
    ctx.fillRect(BAR_LEFT - 30, y - 4, BAR_RIGHT + 22 - (BAR_LEFT - 30), 2);
    ctx.strokeStyle = 'rgba(60, 30, 10, 0.35)';
    ctx.lineWidth = 1;
    for (let gx = BAR_LEFT - 24; gx < BAR_RIGHT + 16; gx += 34) {
        ctx.beginPath();
        ctx.moveTo(gx, y + 3);
        ctx.lineTo(gx + 22, y + 3);
        ctx.stroke();
    }
    // Front face of the counter, below the lip.
    ctx.fillStyle = '#301a0d';
    ctx.fillRect(BAR_LEFT - 30, y + 14, BAR_RIGHT + 22 - (BAR_LEFT - 30), 4);
    ctx.fillStyle = '#26160c';
    ctx.fillRect(BAR_LEFT - 30, y + 18, BAR_RIGHT + 22 - (BAR_LEFT - 30), 16);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    for (let px = BAR_LEFT - 24; px < BAR_RIGHT + 14; px += 56) ctx.fillRect(px, y + 22, 34, 9);

    // Glassware rides on top of the plank.
    for (const m of mugs) if (m.lane === i) drawMug(m.x, y, true);
    for (const e of empties) if (e.lane === i) drawMug(e.x, y, false);
}

function drawCustomer(c) {
    const y = barY(c.lane);
    const bodyH = c.mode === 'drinking' ? 40 : 44;
    const top = y - bodyH - 10;
    const shirt = ['#e05b5b', '#4f9de0', '#63b265', '#d58ae0', '#e0a94f'][
        Math.abs(Math.round(c.x / 37) + c.lane) % 5
    ];

    // Shadow on the floor behind the bar.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(c.x, y + 2, CUST_R * 0.9, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Torso.
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.roundRect(c.x - CUST_R + 2, top + 16, CUST_R * 2 - 4, bodyH, 6);
    ctx.fill();

    // Head and hat.
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(c.x, top + 8, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d2135';
    ctx.fillRect(c.x - 13, top - 3, 26, 4);
    ctx.fillRect(c.x - 9, top - 11, 18, 9);

    // A mug at the lips while drinking, or a wave on the way out.
    if (c.mode === 'drinking') {
        ctx.fillStyle = '#f2a93b';
        ctx.fillRect(c.x + 6, top + 4, 10, 12);
        ctx.fillStyle = '#fff6e0';
        ctx.fillRect(c.x + 6, top + 2, 10, 3);
    } else if (c.mode === 'leaving') {
        ctx.fillStyle = '#f0c9a0';
        ctx.beginPath();
        ctx.arc(c.x - CUST_R - 2, top + 14, 5, 0, Math.PI * 2);
        ctx.fill();
    }

    // Hands resting on the counter while they wait.
    if (c.mode === 'advancing') {
        ctx.fillStyle = '#f0c9a0';
        ctx.fillRect(c.x - CUST_R + 1, y - 9, 6, 6);
        ctx.fillRect(c.x + CUST_R - 7, y - 9, 6, 6);
    }

    // Eyes, facing the taps (or the exit).
    const dir = c.mode === 'leaving' ? -1 : 1;
    ctx.fillStyle = '#20141c';
    ctx.fillRect(c.x + dir * 2 - 1, top + 5, 2, 3);
    ctx.fillRect(c.x + dir * 7 - 1, top + 5, 2, 3);
}

function drawMug(x, y, full) {
    const h = 20;
    const top = y - h;

    // Handle first, so the glass body overlaps its inner edge.
    ctx.strokeStyle = full ? '#ffe2a8' : 'rgba(225, 240, 250, 0.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x + MUG_R + 2, top + h * 0.55, 5.5, -Math.PI * 0.55, Math.PI * 0.55);
    ctx.stroke();

    if (full) {
        const soda = ctx.createLinearGradient(x - MUG_R, 0, x + MUG_R, 0);
        soda.addColorStop(0, '#d8821f');
        soda.addColorStop(0.4, '#f6b24a');
        soda.addColorStop(1, '#c4761c');
        ctx.fillStyle = soda;
    } else {
        ctx.fillStyle = 'rgba(190, 212, 230, 0.3)';
    }
    ctx.beginPath();
    ctx.roundRect(x - MUG_R, top, MUG_R * 2, h, 3);
    ctx.fill();

    ctx.strokeStyle = full ? '#ffe2a8' : 'rgba(228, 242, 252, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Glass highlight down the left wall.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillRect(x - MUG_R + 2.5, top + 3, 2, h - 7);

    if (full) {
        ctx.fillStyle = '#fff8e8';
        ctx.beginPath();
        ctx.roundRect(x - MUG_R - 1, top - 5, MUG_R * 2 + 2, 8, 4);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(x - 3, top - 5, 3.5, 0, Math.PI * 2);
        ctx.arc(x + 4, top - 4, 3, 0, Math.PI * 2);
        ctx.fill();
    } else {
        // A last swallow left in the bottom of the glass.
        ctx.fillStyle = 'rgba(214, 150, 60, 0.45)';
        ctx.fillRect(x - MUG_R + 2, top + h - 5, MUG_R * 2 - 4, 3);
    }
}

function drawTapColumn() {
    // The fountain the barman works: one tap head per counter, on a chrome
    // riser that runs the height of the bar.
    const colX = BAR_RIGHT + 4;
    const colW = 18;
    const metal = ctx.createLinearGradient(colX, 0, colX + colW, 0);
    metal.addColorStop(0, '#5a6680');
    metal.addColorStop(0.45, '#aab7cc');
    metal.addColorStop(1, '#49536a');
    ctx.fillStyle = metal;
    ctx.fillRect(colX, LANE_TOP - 10, colW, LANES * LANE_H + 8);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(colX + 3, LANE_TOP - 10, 2, LANES * LANE_H + 8);

    for (let i = 0; i < LANES; i++) {
        const y = barY(i);
        const live = i === barman.lane && state !== 'idle';
        // Spout reaching out over the counter.
        ctx.fillStyle = live ? '#ffb43d' : '#8c96ab';
        ctx.beginPath();
        ctx.roundRect(colX - 20, y - 38, 22, 9, 3);
        ctx.fill();
        ctx.fillStyle = live ? '#ffd79a' : '#b4bdcd';
        ctx.fillRect(colX - 18, y - 29, 5, 13);
        // Handle on the riser.
        ctx.fillStyle = live ? '#ff8f3d' : '#6f7a90';
        ctx.beginPath();
        ctx.roundRect(colX + 2, y - 46, 5, 16, 2);
        ctx.fill();
        if (live && pourCd > 0) {
            ctx.fillStyle = 'rgba(242, 169, 59, 0.75)';
            ctx.fillRect(colX - 17, y - 16, 3, 14);
        }
    }
}

function drawBarman() {
    if (state === 'idle') return;
    const y = barY(barman.lane);
    const top = y - 58;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(BARMAN_X, y + 10, 20, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Apron and shirt.
    ctx.fillStyle = '#2f3f5c';
    ctx.beginPath();
    ctx.roundRect(BARMAN_X - 17, top + 18, 34, 48, 6);
    ctx.fill();
    ctx.fillStyle = '#f4f1e6';
    ctx.beginPath();
    ctx.roundRect(BARMAN_X - 12, top + 32, 24, 34, 5);
    ctx.fill();

    // Head and paper hat.
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(BARMAN_X, top + 10, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fdfdf7';
    ctx.beginPath();
    ctx.moveTo(BARMAN_X - 14, top - 1);
    ctx.lineTo(BARMAN_X + 14, top - 1);
    ctx.lineTo(BARMAN_X + 9, top - 13);
    ctx.lineTo(BARMAN_X - 9, top - 13);
    ctx.closePath();
    ctx.fill();

    // Pouring arm reaches for the tap while the cooldown runs.
    ctx.strokeStyle = '#f0c9a0';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(BARMAN_X - 10, top + 28);
    if (pourCd > 0) ctx.lineTo(BARMAN_X - 32, top + 20);
    else ctx.lineTo(BARMAN_X - 26, top + 34);
    ctx.stroke();
    ctx.lineWidth = 1;

    // Eyes.
    ctx.fillStyle = '#20141c';
    ctx.fillRect(BARMAN_X - 6, top + 8, 2, 3);
    ctx.fillRect(BARMAN_X + 3, top + 8, 2, 3);
}

function drawSplashes() {
    for (const s of splashes) {
        const k = Math.max(0, s.t / s.life);
        const y = barY(s.lane) - 6;
        ctx.globalAlpha = k;
        if (s.good) {
            ctx.strokeStyle = '#ffe7a8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(s.x, y, 10 + (1 - k) * 16, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.fillStyle = '#e8f3ff';
            for (let i = 0; i < 7; i++) {
                const a = (i / 7) * Math.PI * 2;
                const r = (1 - k) * 26;
                ctx.fillRect(s.x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6, 3, 3);
            }
            ctx.strokeStyle = 'rgba(255, 120, 120, 0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(s.x, y, 6 + (1 - k) * 20, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === ' ' || k === 'Spacebar' || k === 'ArrowUp' || k === 'ArrowDown') e.preventDefault();

    if (state === 'idle' || state === 'gameover') {
        if (k === ' ' || k === 'Spacebar' || k === 'Enter') startGame();
        return;
    }
    if (k === 'p' || k === 'P') {
        togglePause();
        return;
    }
    if (state !== 'playing') return;

    if (k === 'ArrowUp' || k === 'w' || k === 'W') moveBarman(-1);
    else if (k === 'ArrowDown' || k === 's' || k === 'S') moveBarman(1);
    else if (k === ' ' || k === 'Spacebar' || k === 'Enter') tryServe();
});

canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (state === 'idle' || state === 'gameover') startGame();
    else if (state === 'playing') tryServe();
});

startBtn.addEventListener('click', () => startGame());

// ---------------------------------------------------------------------------
// Main loop — `autoStep` lets the tests take the clock away.
// ---------------------------------------------------------------------------
let lastFrame = 0;
function frame(now) {
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (autoStep) step(dt);
    draw();
    requestAnimationFrame(frame);
}

loadBest();
updateHud();
showOverlay('SODA TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
