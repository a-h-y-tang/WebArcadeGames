// ---------------------------------------------------------------------------
// Tapper — a four-bar serving game on an HTML5 canvas.
//
// You are the bartender at the tap end (right) of four long bars. Customers
// shuffle in from the far end and walk towards you; a poured mug slides down
// the bar, and whoever catches it is shoved back down the bar while they
// drink. Shove a customer clean off the far end and they leave happy. Every
// mug they finish comes sliding back — catch it at the tap or it shatters.
// Over-pour and the mug smashes at the far end instead. Both cost a life, as
// does letting a customer reach the taps.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Kaboom! and Snake in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Layout --------------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 460;

const LANE_COUNT = 4;
const LANE_TOP = 92;
const LANE_SPACING = 96;

const BAR_LEFT = 48;          // far end of the bar (where customers appear)
const BAR_RIGHT = 600;        // tap end of the bar (where the bartender works)
const BAR_H = 14;             // thickness of the counter top

const TAP_X = 592;            // where mugs are poured and empties are caught
const SPAWN_X = 54;           // where a new customer steps up to the bar
const LEAVE_X = 34;           // pushed this far back and the customer leaves
const WASTE_X = 42;           // a full mug nobody caught smashes here
const GRAB_X = TAP_X - 26;    // a customer this close to the taps grabs you

// --- Mugs ----------------------------------------------------------------
const MUG_SPEED = 280;        // full mug sliding away from the tap (px/s)
const EMPTY_SPEED = 190;      // empty mug sliding back towards the tap (px/s)
const MUG_HW = 9;
const POUR_COOLDOWN = 0.2;
const MAX_FULL_PER_LANE = 3;

// --- Customers -----------------------------------------------------------
const CUST_HW = 14;
const CUST_H = 40;
const CUST_SPEED = 30;        // level 1 walking speed (px/s)
const CUST_SPEED_STEP = 6;
const CUST_SPEED_CAP = 78;
const PUSHBACK = 96;          // how far one mug shoves a customer back
const PUSH_SPEED = 150;       // how fast they slide while drinking (px/s)
const DRINK_DWELL = 0.8;      // pause at the end of the slide before the empty
const CATCH_DIST = CUST_HW + MUG_HW;

// --- Waves ---------------------------------------------------------------
const FIRST_SPAWN = 1.2;
const SPAWN_BASE = 2.4, SPAWN_STEP = 0.18, SPAWN_MIN = 0.9;
const WAVE_BASE = 6, WAVE_STEP = 2;

// --- Scoring / run structure ---------------------------------------------
const SERVE_POINTS = 100;
const CATCH_POINTS = 50;
const LEVEL_BONUS = 250;
const START_LIVES = 3;
const DEATH_PAUSE = 1.2;
const CLEAR_PAUSE = 1.5;

// --- Colours -------------------------------------------------------------
const BAR_COLOR = '#6b4726';
const BAR_EDGE = '#8a5f34';
const CUST_COLORS = ['#e35d4b', '#4bb3e3', '#9b7ae0', '#5bc27a', '#e0a23f'];

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const leftEl = document.getElementById('left');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'dying' | 'levelclear' | 'over'
let state, score, best, lives, level;
let remaining, spawnTimer, deathTimer, clearTimer;

// `spawnEnabled` is a test seam: specs that measure a single mug or customer
// turn wave spawning off so long simulations stay deterministic.
let spawnEnabled = true;

// `autoStep` is the other test seam: with it off the animation loop keeps
// painting but stops advancing the simulation, so the specs own the clock and
// step(dt) by hand. It is only ever switched off from the tests.
let autoStep = true;

const bartender = { lane: 0, pourCooldown: 0, pourFlash: 0 };
const customers = [];
const mugs = [];
const shards = [];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function laneY(lane) { return LANE_TOP + lane * LANE_SPACING; }

// A tiny seeded generator so a run is reproducible when seeded by hand.
let rngState = 1;

function seedRng(n) { rngState = (n >>> 0) || 1; }

function rng() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
}

// --- Difficulty curve (pure) ---------------------------------------------

function levelCustomers(lv) { return WAVE_BASE + (lv - 1) * WAVE_STEP; }

function customerSpeed(lv) {
    return Math.min(CUST_SPEED_CAP, CUST_SPEED + (lv - 1) * CUST_SPEED_STEP);
}

function spawnInterval(lv) {
    return Math.max(SPAWN_MIN, SPAWN_BASE - (lv - 1) * SPAWN_STEP);
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

function spawnCustomer(lane, x = SPAWN_X) {
    const c = {
        lane,
        x,
        drinking: false,
        drinkTimer: 0,
        drinkCount: 0,
        pushTarget: x,
        tint: CUST_COLORS[Math.floor(rng() * CUST_COLORS.length)],
        bob: rng() * Math.PI * 2,
    };
    customers.push(c);
    return c;
}

// Prefer a bar whose entrance is clear, so arrivals do not stack on top of
// each other; after a few tries any bar will do.
function pickLane() {
    for (let i = 0; i < 8; i++) {
        const lane = Math.floor(rng() * LANE_COUNT) % LANE_COUNT;
        const crowded = customers.some(
            (c) => c.lane === lane && c.x < SPAWN_X + CUST_HW * 2.5
        );
        if (!crowded) return lane;
    }
    return Math.floor(rng() * LANE_COUNT) % LANE_COUNT;
}

function updateSpawning(dt) {
    if (!spawnEnabled || remaining <= 0) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnCustomer(pickLane(), SPAWN_X);
    remaining--;
    spawnTimer = spawnInterval(level);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function addShards(lane, x) {
    for (let i = 0; i < 8; i++) {
        shards.push({
            x,
            y: laneY(lane) - 6,
            vx: (rng() - 0.5) * 160,
            vy: -40 - rng() * 120,
            life: 0.5,
        });
    }
}

// Returns true when the life loss ended the frame's simulation.
function loseLife(lane, x) {
    if (lane !== undefined) addShards(lane, x);
    lives--;
    if (lives <= 0) {
        lives = 0;
        gameOver();
    } else {
        state = 'dying';
        deathTimer = DEATH_PAUSE;
    }
    updateHud();
    return true;
}

// The customer nearest the taps who still has a free hand. A mug is only in
// reach while it is still sliding towards someone — once it has slipped past,
// even a customer who has just drained their last mug cannot grab it.
function catcherFor(mug) {
    let best = null;
    for (const c of customers) {
        if (c.lane !== mug.lane || c.drinking) continue;
        if (mug.x < c.x || mug.x > c.x + CATCH_DIST) continue;
        if (!best || c.x > best.x) best = c;
    }
    return best;
}

function updateMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const mug = mugs[i];
        if (mug.full) {
            mug.x -= MUG_SPEED * dt;
            const catcher = catcherFor(mug);
            if (catcher) {
                catcher.drinking = true;
                catcher.drinkCount++;
                catcher.drinkTimer = DRINK_DWELL;
                catcher.pushTarget = catcher.x - PUSHBACK;
                mugs.splice(i, 1);
                continue;
            }
            if (mug.x <= WASTE_X) {
                mugs.splice(i, 1);
                return loseLife(mug.lane, WASTE_X);
            }
        } else {
            mug.x += EMPTY_SPEED * dt;
            if (mug.x >= TAP_X) {
                mugs.splice(i, 1);
                if (bartender.lane === mug.lane) {
                    score += CATCH_POINTS;
                    bartender.pourFlash = 0.18;
                } else {
                    return loseLife(mug.lane, TAP_X);
                }
            }
        }
    }
    return false;
}

function updateCustomers(dt) {
    const speed = customerSpeed(level);
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        if (c.drinking) {
            if (c.x > c.pushTarget) {
                c.x = Math.max(c.pushTarget, c.x - PUSH_SPEED * dt);
            }
            if (c.x <= LEAVE_X) {
                // Shoved clean off the end of the bar: a happy customer.
                customers.splice(i, 1);
                score += SERVE_POINTS;
                continue;
            }
            if (c.x <= c.pushTarget) {
                c.drinkTimer -= dt;
                if (c.drinkTimer <= 0) {
                    c.drinking = false;
                    mugs.push({ lane: c.lane, x: c.x, full: false });
                }
            }
        } else {
            c.x += speed * dt;
            if (c.x >= GRAB_X) {
                customers.splice(i, 1);
                return loseLife(c.lane, GRAB_X);
            }
        }
    }
    return false;
}

function updateShards(dt) {
    for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 620 * dt;
        s.life -= dt;
        if (s.life <= 0) shards.splice(i, 1);
    }
}

function waveCleared() {
    return remaining <= 0 && customers.length === 0;
}

function step(dt) {
    updateShards(dt);

    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) resumeAfterDeath();
        return;
    }
    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        return;
    }
    if (state !== 'running') return;

    bartender.pourCooldown = Math.max(0, bartender.pourCooldown - dt);
    bartender.pourFlash = Math.max(0, bartender.pourFlash - dt);

    updateSpawning(dt);
    if (updateCustomers(dt)) return;
    if (updateMugs(dt)) return;

    if (waveCleared()) {
        score += LEVEL_BONUS * level;
        state = 'levelclear';
        clearTimer = CLEAR_PAUSE;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function pour() {
    if (state !== 'running') return false;
    if (bartender.pourCooldown > 0) return false;
    const lane = bartender.lane;
    const onBar = mugs.filter((m) => m.full && m.lane === lane).length;
    if (onBar >= MAX_FULL_PER_LANE) return false;
    mugs.push({ lane, x: TAP_X - 8, full: true });
    bartender.pourCooldown = POUR_COOLDOWN;
    bartender.pourFlash = 0.12;
    return true;
}

function moveBartender(delta) {
    if (state !== 'running') return;
    bartender.lane = clamp(bartender.lane + delta, 0, LANE_COUNT - 1);
}

// ---------------------------------------------------------------------------
// Run structure
// ---------------------------------------------------------------------------

function clearBar() {
    customers.length = 0;
    mugs.length = 0;
}

function beginWave() {
    remaining = levelCustomers(level);
    spawnTimer = FIRST_SPAWN;
    bartender.pourCooldown = 0;
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    bartender.lane = 0;
    bartender.pourFlash = 0;
    spawnEnabled = true;
    shards.length = 0;
    clearBar();
    beginWave();
    state = 'running';
    hideOverlay();
    updateHud();
}

function resumeAfterDeath() {
    clearBar();
    beginWave();
    state = 'running';
    updateHud();
}

function nextLevel() {
    level++;
    clearBar();
    beginWave();
    state = 'running';
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('tapper-best', String(best));
        } catch (err) {
            /* storage may be unavailable; the run still ends cleanly */
        }
    }
    updateHud();
    showOverlay('LAST ORDERS', `Score ${score} · Best ${best}`, 'Press Space to serve another shift');
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
// Drawing
// ---------------------------------------------------------------------------

function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#16202b');
    sky.addColorStop(1, '#090d12');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Back wall panelling.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 1;
    for (let x = 16; x < CANVAS_W; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CANVAS_H);
        ctx.stroke();
    }

    // A lamp over every bar, brighter above the one being worked.
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const y = laneY(lane);
        const active = lane === bartender.lane;
        const glow = ctx.createRadialGradient(330, y - 58, 4, 330, y - 10, 210);
        glow.addColorStop(0, active ? 'rgba(240, 168, 48, 0.26)' : 'rgba(240, 168, 48, 0.12)');
        glow.addColorStop(1, 'rgba(240, 168, 48, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(BAR_LEFT - 40, y - 78, BAR_RIGHT - BAR_LEFT + 60, 84);

        ctx.strokeStyle = '#3c4c5d';
        ctx.beginPath();
        ctx.moveTo(330, y - 92);
        ctx.lineTo(330, y - 74);
        ctx.stroke();
        ctx.fillStyle = active ? '#f0a830' : '#6e5934';
        ctx.beginPath();
        ctx.moveTo(318, y - 66);
        ctx.lineTo(342, y - 66);
        ctx.lineTo(334, y - 76);
        ctx.lineTo(326, y - 76);
        ctx.closePath();
        ctx.fill();
    }
}

function drawBars() {
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const y = laneY(lane);
        const left = BAR_LEFT - 16;
        const width = BAR_RIGHT - BAR_LEFT + 28;

        // Doorway the customers file in through.
        ctx.fillStyle = '#1b242f';
        ctx.fillRect(left - 20, y - 62, 22, 62);
        ctx.strokeStyle = '#3a4d60';
        ctx.lineWidth = 2;
        ctx.strokeRect(left - 20, y - 62, 22, 62);
        ctx.lineWidth = 1;

        // Counter top with a little grain.
        const wood = ctx.createLinearGradient(0, y, 0, y + BAR_H);
        wood.addColorStop(0, BAR_EDGE);
        wood.addColorStop(1, BAR_COLOR);
        ctx.fillStyle = wood;
        ctx.fillRect(left, y, width, BAR_H);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
        for (let x = left + 10; x < left + width; x += 26) {
            ctx.beginPath();
            ctx.moveTo(x, y + 4);
            ctx.lineTo(x + 14, y + 4);
            ctx.stroke();
        }

        // Front panel and its shadow.
        ctx.fillStyle = '#4a3019';
        ctx.fillRect(left, y + BAR_H, width, 10);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(left, y + BAR_H + 10, width, 5);

        if (lane === bartender.lane) {
            ctx.fillStyle = 'rgba(240, 168, 48, 0.3)';
            ctx.fillRect(left, y, width, 2);
        }
    }
}

function drawTapStation() {
    const x = BAR_RIGHT + 4;
    const panel = ctx.createLinearGradient(x, 0, x + 36, 0);
    panel.addColorStop(0, '#2c3b4c');
    panel.addColorStop(1, '#1a2430');
    ctx.fillStyle = panel;
    ctx.fillRect(x, 26, 36, CANVAS_H - 52);
    ctx.strokeStyle = '#3f5265';
    ctx.strokeRect(x + 0.5, 26.5, 36, CANVAS_H - 53);

    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const y = laneY(lane);
        const active = lane === bartender.lane;
        ctx.fillStyle = active ? '#f0a830' : '#8a6a3c';
        ctx.fillRect(x + 8, y - 30, 7, 24);          // spout
        ctx.fillRect(x + 4, y - 34, 15, 5);          // body
        ctx.fillStyle = active ? '#ffd88a' : '#5d4728';
        ctx.fillRect(x + 6, y - 44, 11, 10);         // handle

        if (active && bartender.pourFlash > 0) {
            ctx.fillStyle = 'rgba(240, 192, 64, 0.85)';
            ctx.fillRect(x + 10, y - 8, 3, 8);
        }
    }
}

function drawBartender() {
    const y = laneY(bartender.lane);
    const x = BAR_RIGHT + 28;

    // Apron and body.
    ctx.fillStyle = '#d9e4ec';
    ctx.fillRect(x - 11, y - 38, 22, 20);
    ctx.fillStyle = bartender.pourFlash > 0 ? '#f0a830' : '#b9c8d4';
    ctx.fillRect(x - 11, y - 20, 22, 14);
    ctx.fillStyle = '#2c3a49';
    ctx.fillRect(x - 11, y - 8, 22, 8);

    // Head, hair and moustache — the house style.
    ctx.fillStyle = '#f1d7bd';
    ctx.beginPath();
    ctx.arc(x, y - 47, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a3423';
    ctx.fillRect(x - 9, y - 55, 18, 5);
    ctx.fillRect(x - 6, y - 43, 12, 3);

    // Arm reaching over the bar towards the tap.
    ctx.strokeStyle = '#f1d7bd';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 9, y - 32);
    ctx.lineTo(x - 24, y - 22);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1;
}

function drawMug(mug) {
    const y = laneY(mug.lane);
    const top = y - 19;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(mug.x - 8, y - 2, 17, 3);

    // Handle.
    ctx.strokeStyle = '#e8eef4';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(mug.x + 9, top + 10, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    // Glass, with the beer level inside it.
    ctx.fillStyle = 'rgba(226, 240, 250, 0.22)';
    ctx.fillRect(mug.x - 7, top, 14, 19);
    if (mug.full) {
        ctx.fillStyle = '#f0b429';
        ctx.fillRect(mug.x - 6, top + 5, 12, 13);
        ctx.fillStyle = '#fff6e2';
        ctx.fillRect(mug.x - 7, top - 3, 14, 7);
    }
    ctx.strokeStyle = '#e8eef4';
    ctx.lineWidth = 2;
    ctx.strokeRect(mug.x - 7, top, 14, 19);
    ctx.lineWidth = 1;
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const bob = c.drinking ? 0 : Math.sin(c.bob + c.x * 0.06) * 1.6;
    const top = y - CUST_H + bob;

    // Body, with a darker vest panel so the sprites read at a glance.
    ctx.fillStyle = c.tint;
    ctx.fillRect(c.x - CUST_HW, top + 12, CUST_HW * 2, CUST_H - 12);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(c.x - 4, top + 12, 8, CUST_H - 12);

    // Head and hair.
    ctx.fillStyle = '#f1d7bd';
    ctx.beginPath();
    ctx.arc(c.x, top + 5, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(c.x - 9, top - 3, 18, 5);

    if (c.drinking) {
        // Mug tipped up to the face.
        ctx.fillStyle = '#f0b429';
        ctx.fillRect(c.x + 5, top + 1, 11, 13);
        ctx.strokeStyle = '#e8eef4';
        ctx.lineWidth = 2;
        ctx.strokeRect(c.x + 5, top + 1, 11, 13);
        ctx.lineWidth = 1;
    } else {
        // An impatient customer drums the bar.
        ctx.strokeStyle = c.tint;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(c.x + CUST_HW - 3, top + 20);
        ctx.lineTo(c.x + CUST_HW + 7, y - 3);
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.lineWidth = 1;
    }
}

function drawShards() {
    for (const s of shards) {
        ctx.fillStyle = `rgba(232, 240, 248, ${Math.max(0, s.life * 2)})`;
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
}

function drawBanner(title, sub) {
    ctx.fillStyle = 'rgba(7, 10, 14, 0.7)';
    ctx.fillRect(0, CANVAS_H / 2 - 52, CANVAS_W, 104);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f0a830';
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(title, CANVAS_W / 2, CANVAS_H / 2 - 6);
    ctx.fillStyle = '#8296a6';
    ctx.font = '15px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(sub, CANVAS_W / 2, CANVAS_H / 2 + 26);
    ctx.textAlign = 'start';
}

function draw() {
    drawBackground();
    drawBars();
    drawTapStation();
    for (const c of customers) drawCustomer(c);
    for (const mug of mugs) drawMug(mug);
    drawShards();
    drawBartender();

    if (state === 'dying') {
        drawBanner('MUG DOWN!', `${lives} ${lives === 1 ? 'life' : 'lives'} left`);
    }
    if (state === 'levelclear') drawBanner('SHIFT OVER!', `Level ${level} served`);
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    leftEl.textContent = String(Math.max(0, remaining));
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Game';
}

function hideOverlay() {
    overlay.classList.remove('visible');
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
        moveBartender(-1);
        e.preventDefault();
        return;
    }
    if (DOWN_KEYS.includes(e.key)) {
        moveBartender(1);
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// Clicking a bar jumps the bartender to it, so the game is playable with a
// mouse or on a touch screen.
canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    let nearest = 0;
    for (let lane = 1; lane < LANE_COUNT; lane++) {
        if (Math.abs(laneY(lane) - y) < Math.abs(laneY(nearest) - y)) nearest = lane;
    }
    if (nearest === bartender.lane) pour();
    else bartender.lane = nearest;
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

best = (() => {
    try {
        return parseInt(localStorage.getItem('tapper-best') || '0', 10) || 0;
    } catch (err) {
        return 0;
    }
})();

seedRng(Date.now());
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
remaining = 0;
spawnTimer = FIRST_SPAWN;
deathTimer = 0;
clearTimer = 0;
updateHud();
showOverlay('TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
