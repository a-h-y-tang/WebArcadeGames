// ---------------------------------------------------------------------------
// Tapper — a four-bar drink-slinging arcade game on an HTML5 canvas.
//
// The bartender works the right-hand end of four parallel bars. Thirsty
// customers walk in from the left and keep coming until they are served; a
// poured mug slides down the bar and pushes back the first customer it meets.
// A mug that misses everyone shatters at the far end, an empty mug slid back by
// a satisfied customer has to be caught, and a customer who reaches the taps
// hauls the bartender over the counter. Each mistake costs a life.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Layout --------------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 460;

const LANES = 4;
const LANE_TOP = 76;
const LANE_SPACING = 100;
const LANE_Y = Array.from({ length: LANES }, (_, i) => LANE_TOP + i * LANE_SPACING);
const BAR_H = 16;

const BAR_LEFT = 56;    // where customers walk in and stray mugs shatter
const BAR_RIGHT = 592;  // right-hand lip of the counter
const TAP_X = 588;      // where a poured mug appears
const CATCH_X = 578;    // an empty mug reaching here is caught or lost
const GRAB_X = 572;     // a customer reaching here grabs the bartender
const TENDER_X = 612;   // the bartender stands behind the taps

// --- Speeds / sizes ------------------------------------------------------
const MUG_SPEED = 300;      // px/s, full mug sliding away from the taps
const EMPTY_SPEED = 220;    // px/s, empty mug sliding back
const MUG_HW = 11;
const MUG_H = 22;
const CUST_HW = 15;
const CUST_H = 40;
const CATCH_DIST = MUG_HW + CUST_HW;

const CUST_SPEED_BASE = 28;
const CUST_SPEED_STEP = 4;
const CUST_SPEED_CAP = 130;   // deliberately well under MUG_SPEED
const PUSH_SPEED = 90;        // how fast drinking pushes a customer back
const LEAVE_SPEED = 165;
const DRINK_TIME = 1.0;

const POUR_COOLDOWN = 0.35;
const POUR_ANIM = 0.18;

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const DEATH_PAUSE = 1.5;
const CLEAR_PAUSE = 1.8;
const FIRST_SPAWN = 1.0;
const SPAWN_BASE = 2.4, SPAWN_STEP = 0.15, SPAWN_MIN = 0.9;
const CROWD_BASE = 6, CROWD_STEP = 2, CROWD_CAP = 20;

const SERVE_POINTS = 100;
const CATCH_POINTS = 50;
const LEVEL_BONUS = 500;

// Fixed rotation rather than Math.random, so a run replays identically for the
// tests and the difficulty stays evenly spread across the four bars.
const LANE_PATTERN = [0, 2, 1, 3, 2, 0, 3, 1, 1, 2, 0, 3];

const SMASH_LIFE = 0.5;
const POP_LIFE = 0.8;
const POP_RISE = 34;

// --- Colours -------------------------------------------------------------
const BAR_TOP_COLOR = '#8b5a2b';
const BAR_EDGE_COLOR = '#5d3a1a';
const SHIRT_COLORS = ['#4f8fd1', '#c85c8e', '#69a84f', '#d1913c', '#8c6fd1'];

// --- DOM -----------------------------------------------------------------
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

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'dying' | 'levelclear' | 'over'
let state, score, best, lives, level;
let levelTarget, servedThisLevel, spawnedThisLevel;
let spawnEnabled, spawnTimer, spawnIndex, custIndex;
let deathTimer, clearTimer, shakeTimer;
let bartender, customers, mugs, smashes, pops;

// ---------------------------------------------------------------------------
// Difficulty curve
// ---------------------------------------------------------------------------

function customersForLevel(l) {
    return Math.min(CROWD_BASE + CROWD_STEP * (l - 1), CROWD_CAP);
}

function customerSpeed() {
    return Math.min(CUST_SPEED_BASE + CUST_SPEED_STEP * (level - 1), CUST_SPEED_CAP);
}

function spawnInterval() {
    return Math.max(SPAWN_BASE - SPAWN_STEP * (level - 1), SPAWN_MIN);
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function spawnCustomer(lane) {
    const c = {
        lane,
        x: BAR_LEFT,
        state: 'advancing', // 'advancing' | 'drinking' | 'leaving'
        drinkTimer: 0,
        shirt: SHIRT_COLORS[custIndex % SHIRT_COLORS.length],
        bob: custIndex * 0.7,
    };
    custIndex++;
    spawnedThisLevel++;
    customers.push(c);
    return c;
}

function spawnEmpty(lane, x) {
    const m = { lane, x, full: false };
    mugs.push(m);
    return m;
}

function pour() {
    if (state !== 'running' || bartender.cooldown > 0) return null;
    bartender.cooldown = POUR_COOLDOWN;
    bartender.pourAnim = POUR_ANIM;
    const m = { lane: bartender.lane, x: TAP_X, full: true };
    mugs.push(m);
    return m;
}

function moveLane(delta) {
    if (state !== 'running') return;
    bartender.lane = Math.max(0, Math.min(LANES - 1, bartender.lane + delta));
}

function smash(lane, x) {
    smashes.push({ lane, x, t: SMASH_LIFE });
}

function pop(lane, x, text) {
    pops.push({ x, y: LANE_Y[lane] - 30, text, t: POP_LIFE });
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'idle' || state === 'paused' || state === 'over') return;

    for (let i = smashes.length - 1; i >= 0; i--) {
        smashes[i].t -= dt;
        if (smashes[i].t <= 0) smashes.splice(i, 1);
    }
    for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].t -= dt;
        if (pops[i].t <= 0) pops.splice(i, 1);
    }
    shakeTimer = Math.max(0, shakeTimer - dt);
    bartender.catchAnim = Math.max(0, bartender.catchAnim - dt);

    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) finishDeath();
        return;
    }

    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        return;
    }

    bartender.cooldown = Math.max(0, bartender.cooldown - dt);
    bartender.pourAnim = Math.max(0, bartender.pourAnim - dt);

    if (spawnEnabled && spawnedThisLevel < levelTarget) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            spawnCustomer(LANE_PATTERN[spawnIndex % LANE_PATTERN.length]);
            spawnIndex++;
            spawnTimer = spawnInterval();
        }
    }

    updateCustomers(dt);
    if (state !== 'running') return;
    updateMugs(dt);
    if (state !== 'running') return;
    checkLevelClear();
}

function updateCustomers(dt) {
    const speed = customerSpeed();
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        c.bob += dt * 6;
        if (c.state === 'advancing') {
            c.x += speed * dt;
            if (c.x >= GRAB_X) {
                c.x = GRAB_X;
                loseLife();
                return;
            }
        } else if (c.state === 'drinking') {
            c.x = Math.max(BAR_LEFT, c.x - PUSH_SPEED * dt);
            c.drinkTimer -= dt;
            if (c.drinkTimer <= 0) {
                spawnEmpty(c.lane, c.x);
                c.state = 'leaving';
            }
        } else {
            c.x -= LEAVE_SPEED * dt;
            if (c.x < BAR_LEFT - 40) customers.splice(i, 1);
        }
    }
}

function updateMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        if (m.full) {
            m.x -= MUG_SPEED * dt;
            const target = firstThirstyCustomer(m);
            if (target) {
                serve(target);
                mugs.splice(i, 1);
            } else if (m.x <= BAR_LEFT) {
                smash(m.lane, BAR_LEFT);
                mugs.splice(i, 1);
                loseLife();
                return;
            }
        } else {
            m.x += EMPTY_SPEED * dt;
            if (m.x >= CATCH_X) {
                mugs.splice(i, 1);
                if (bartender.lane === m.lane) {
                    score += CATCH_POINTS;
                    bartender.catchAnim = POUR_ANIM;
                    pop(m.lane, CATCH_X - 20, `+${CATCH_POINTS}`);
                    updateHud();
                } else {
                    smash(m.lane, CATCH_X);
                    loseLife();
                    return;
                }
            }
        }
    }
}

// A mug travels right-to-left, so the customer nearest the taps is the one it
// meets first. Only customers still walking in can take a drink.
function firstThirstyCustomer(mug) {
    let nearest = null;
    for (const c of customers) {
        if (c.lane !== mug.lane || c.state !== 'advancing') continue;
        if (Math.abs(c.x - mug.x) > CATCH_DIST) continue;
        if (!nearest || c.x > nearest.x) nearest = c;
    }
    return nearest;
}

function serve(c) {
    c.state = 'drinking';
    c.drinkTimer = DRINK_TIME;
    score += SERVE_POINTS;
    servedThisLevel++;
    pop(c.lane, c.x, `+${SERVE_POINTS}`);
    updateHud();
}

function loseLife() {
    lives = Math.max(0, lives - 1);
    customers.length = 0;
    mugs.length = 0;
    bartender.cooldown = 0;
    state = 'dying';
    deathTimer = DEATH_PAUSE;
    shakeTimer = 0.35;
    updateHud();
}

function finishDeath() {
    if (lives <= 0) {
        gameOver();
        return;
    }
    state = 'running';
    spawnTimer = FIRST_SPAWN;
}

function checkLevelClear() {
    if (spawnedThisLevel < levelTarget) return;
    if (customers.length > 0 || mugs.length > 0) return;
    score += LEVEL_BONUS;
    state = 'levelclear';
    clearTimer = CLEAR_PAUSE;
    updateHud();
}

function nextLevel() {
    level++;
    levelTarget = customersForLevel(level);
    servedThisLevel = 0;
    spawnedThisLevel = 0;
    spawnTimer = FIRST_SPAWN;
    customers.length = 0;
    mugs.length = 0;
    state = 'running';
    updateHud();
}

// Test helper: pretend the whole crowd has been served and sent home.
function serveEverythingForTest() {
    customers.length = 0;
    mugs.length = 0;
    spawnedThisLevel = levelTarget;
    servedThisLevel = levelTarget;
    updateHud();
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    levelTarget = customersForLevel(1);
    servedThisLevel = 0;
    spawnedThisLevel = 0;
    spawnEnabled = true;
    spawnTimer = FIRST_SPAWN;
    spawnIndex = 0;
    custIndex = 0;
    deathTimer = 0;
    clearTimer = 0;
    shakeTimer = 0;
    customers = [];
    mugs = [];
    smashes = [];
    pops = [];
    bartender = { lane: 0, cooldown: 0, pourAnim: 0, catchAnim: 0 };
    state = 'running';
    hideOverlay();
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('tapper-best', String(best));
        } catch (e) {
            /* private mode — the best score just does not persist */
        }
    }
    updateHud();
    showOverlay('LAST CALL', `Score ${score} · Level ${level}`, 'Press Space or Enter to play again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    livesEl.textContent = lives;
    servedEl.textContent = `${servedThisLevel}/${levelTarget}`;
    bestEl.textContent = best;
}

function showOverlay(title, sub, hint) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub;
    overlaySub.textContent = hint;
    overlay.classList.add('visible');
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Game';
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    ctx.save();
    if (shakeTimer > 0) {
        const k = shakeTimer * 12;
        ctx.translate(Math.sin(k * 3) * 3, Math.cos(k * 5) * 2);
    }

    drawRoom();
    // Customers go down before the counters, so the bars cut across their legs
    // and they read as standing at the bar rather than on top of it.
    for (const c of customers) drawCustomer(c);
    for (let lane = 0; lane < LANES; lane++) drawBar(lane);
    for (const m of mugs) drawMug(m);
    for (const s of smashes) drawSmash(s);
    drawBartender();
    drawPops();

    ctx.restore();

    if (state === 'levelclear') banner('ROUND CLEAR', `+${LEVEL_BONUS} bonus`);
    if (state === 'dying') banner('BROKEN GLASS', lives > 0 ? `${lives} left` : 'no lives left');
}

function drawRoom() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#2a1f2e');
    g.addColorStop(1, '#120d0a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Panelling on the back wall.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
    for (let x = 0; x < CANVAS_W; x += 44) ctx.fillRect(x, 0, 22, CANVAS_H);

    // A warm lamp hanging over each bar.
    for (let lane = 0; lane < LANES; lane++) {
        const y = LANE_Y[lane];
        const lamp = ctx.createRadialGradient(CANVAS_W / 2, y - 70, 4, CANVAS_W / 2, y - 10, 320);
        lamp.addColorStop(0, 'rgba(255, 196, 92, 0.16)');
        lamp.addColorStop(1, 'rgba(255, 196, 92, 0)');
        ctx.fillStyle = lamp;
        ctx.fillRect(0, y - 90, CANVAS_W, 100);
    }

    // The tap station running down the right-hand side.
    ctx.fillStyle = '#2b2033';
    ctx.fillRect(BAR_RIGHT, 0, CANVAS_W - BAR_RIGHT, CANVAS_H);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(BAR_RIGHT, 0, 4, CANVAS_H);
}

function drawBar(lane) {
    const y = LANE_Y[lane];
    const left = BAR_LEFT - 24;
    const w = BAR_RIGHT - left;

    // Counter top, front face and the shadow it throws.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(left, y + BAR_H, w, 8);
    const g = ctx.createLinearGradient(0, y, 0, y + BAR_H);
    g.addColorStop(0, '#a06a33');
    g.addColorStop(0.45, BAR_TOP_COLOR);
    g.addColorStop(1, BAR_EDGE_COLOR);
    ctx.fillStyle = g;
    ctx.fillRect(left, y, w, BAR_H);
    ctx.fillStyle = 'rgba(255, 226, 180, 0.35)';
    ctx.fillRect(left, y, w, 2);

    // Wood grain.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    for (let x = left + 8; x < BAR_RIGHT - 8; x += 30) ctx.fillRect(x, y + 6, 16, 2);

    // Tap head at the near end.
    ctx.fillStyle = '#3a3348';
    ctx.fillRect(BAR_RIGHT - 12, y - 28, 16, 28);
    ctx.fillStyle = '#c9c2b0';
    ctx.fillRect(BAR_RIGHT - 8, y - 22, 6, 22);
    ctx.fillStyle = '#ffc247';
    ctx.fillRect(BAR_RIGHT - 12, y - 30, 16, 6);

    // Doorway the customers come through.
    const door = ctx.createLinearGradient(0, y - 58, 0, y);
    door.addColorStop(0, 'rgba(255, 194, 71, 0.02)');
    door.addColorStop(1, 'rgba(255, 194, 71, 0.16)');
    ctx.fillStyle = door;
    ctx.fillRect(0, y - 58, 26, 58);
}

function drawCustomer(c) {
    const y = LANE_Y[c.lane];
    const walking = c.state === 'advancing' || c.state === 'leaving';
    const swing = walking ? Math.sin(c.bob) : 0;
    const feet = y + 14;
    const top = feet - CUST_H;

    // Legs
    ctx.fillStyle = '#33303d';
    ctx.fillRect(c.x - 9 + swing * 3, top + 30, 7, 12);
    ctx.fillRect(c.x + 2 - swing * 3, top + 30, 7, 12);

    // Body
    ctx.fillStyle = c.shirt;
    ctx.fillRect(c.x - CUST_HW, top + 12, CUST_HW * 2, 20);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.fillRect(c.x - CUST_HW, top + 26, CUST_HW * 2, 6);

    // Head
    ctx.fillStyle = '#e8c39e';
    ctx.beginPath();
    ctx.arc(c.x, top + 5, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2c2432';
    ctx.fillRect(c.x - 6, top + 1, 12, 4);
    ctx.fillRect(c.x + (c.state === 'leaving' ? -5 : 2), top + 6, 3, 3);

    if (c.state === 'drinking') {
        ctx.fillStyle = '#f0b13c';
        ctx.fillRect(c.x + 5, top + 1, 11, 13);
        ctx.fillStyle = '#fffaf0';
        ctx.fillRect(c.x + 5, top - 2, 11, 4);
    } else if (c.state === 'advancing') {
        // Impatient arm reaching for the taps.
        ctx.fillStyle = '#e8c39e';
        ctx.fillRect(c.x + CUST_HW - 3, top + 15, 11, 5);
    }
}

function drawMug(m) {
    const y = LANE_Y[m.lane];
    const top = y - MUG_H + 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(m.x - MUG_HW, y + 1, MUG_HW * 2, 3);

    ctx.fillStyle = m.full ? '#f0b13c' : '#8e8676';
    ctx.fillRect(m.x - MUG_HW, top, MUG_HW * 2, MUG_H - 2);
    ctx.fillStyle = m.full ? 'rgba(255, 240, 190, 0.5)' : 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(m.x - MUG_HW + 2, top + 3, 3, MUG_H - 8);
    ctx.fillStyle = m.full ? '#fffdf4' : '#a9a294';
    ctx.fillRect(m.x - MUG_HW, top - 4, MUG_HW * 2, 5);

    ctx.strokeStyle = m.full ? '#c98a26' : '#6f695d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(m.x + MUG_HW + 1, top + MUG_H / 2 - 1, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawSmash(s) {
    const y = LANE_Y[s.lane];
    const k = 1 - s.t / SMASH_LIFE;
    ctx.fillStyle = `rgba(255, 240, 200, ${Math.max(0, 1 - k)})`;
    for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const r = 6 + k * 26;
        ctx.fillRect(s.x + Math.cos(a) * r, y - 10 + Math.sin(a) * r * 0.6, 4, 4);
    }
}

function drawPops() {
    ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const p of pops) {
        const k = 1 - p.t / POP_LIFE;
        ctx.fillStyle = `rgba(255, 226, 150, ${Math.max(0, 1 - k)})`;
        ctx.fillText(p.text, p.x, p.y - k * POP_RISE);
    }
    ctx.textAlign = 'left';
}

function drawBartender() {
    const y = LANE_Y[bartender.lane];
    const top = y - 52;
    const busy = bartender.pourAnim > 0 || bartender.catchAnim > 0;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(TENDER_X, y + 6, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Apron over a striped shirt.
    ctx.fillStyle = '#3d6fa8';
    ctx.fillRect(TENDER_X - 15, top + 14, 30, 14);
    ctx.fillStyle = '#f2ecdf';
    ctx.fillRect(TENDER_X - 13, top + 26, 26, 26);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(TENDER_X - 13, top + 44, 26, 8);

    // Head, with a flat cap.
    ctx.fillStyle = '#e8c39e';
    ctx.beginPath();
    ctx.arc(TENDER_X, top + 6, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2c2432';
    ctx.fillRect(TENDER_X - 11, top - 3, 22, 5);
    ctx.fillRect(TENDER_X - 16, top + 2, 12, 3);

    // Arm on the tap handle; it lifts while pouring or catching.
    ctx.fillStyle = '#e8c39e';
    ctx.fillRect(TENDER_X - 28, top + (busy ? 18 : 24), 16, 6);
    if (bartender.pourAnim > 0) {
        ctx.fillStyle = '#ffc247';
        ctx.fillRect(BAR_RIGHT - 6, y - 20, 4, 20);
    }
}

function banner(title, sub) {
    ctx.fillStyle = 'rgba(12, 9, 16, 0.72)';
    ctx.fillRect(0, CANVAS_H / 2 - 46, CANVAS_W, 92);
    ctx.fillStyle = '#ffc247';
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, CANVAS_W / 2, CANVAS_H / 2);
    ctx.fillStyle = '#9a8ea6';
    ctx.font = '15px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(sub, CANVAS_W / 2, CANVAS_H / 2 + 26);
    ctx.textAlign = 'left';
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
        moveLane(-1);
        e.preventDefault();
    } else if (DOWN_KEYS.includes(e.key)) {
        moveLane(1);
        e.preventDefault();
    }
});

canvas.addEventListener('click', () => {
    if (state === 'running') pour();
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
    step(dt);
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
levelTarget = customersForLevel(1);
servedThisLevel = 0;
spawnedThisLevel = 0;
spawnEnabled = true;
spawnTimer = FIRST_SPAWN;
spawnIndex = 0;
custIndex = 0;
deathTimer = 0;
clearTimer = 0;
shakeTimer = 0;
customers = [];
mugs = [];
smashes = [];
pops = [];
bartender = { lane: 0, cooldown: 0, pourAnim: 0, catchAnim: 0 };
updateHud();
showOverlay('TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
