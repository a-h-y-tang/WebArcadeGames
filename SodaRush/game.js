// ---------------------------------------------------------------------------
// Soda Rush — a one-person soda counter under siege.
//
// Four counters run left to right across the screen. Thirsty customers come in
// through the doors on the left and walk towards the fountain on the right,
// where the server stands. Slide a soda down a counter and the customer it
// reaches is knocked back a few paces while they drink; push them past the
// door and they leave satisfied — but they slide their empty glass straight
// back, and an empty that reaches the fountain unclaimed hits the floor.
//
// Let a customer reach the fountain, or a returning empty smash, and it costs
// a life. A soda that runs the whole counter without finding anyone spills and
// costs points.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Pooyan,
// BurgerTime and Snake in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Canvas --------------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 480;
const WALL_H = 88;              // back wall above the counters

// --- Counters ------------------------------------------------------------
const LANE_COUNT = 4;
const LANE_TOP = 132;           // y of the top counter surface
const LANE_GAP = 92;
const LANE_LEFT = 54;           // the doorway end of a counter
const LANE_RIGHT = 596;         // the fountain end of a counter
const COUNTER_H = 16;

// --- The server (player) -------------------------------------------------
const SERVER_X = 616;           // centre; the server only changes counter
const SERVER_W = 34;
const SERVER_H = 56;
const SERVE_X = 572;            // where a soda appears, just off the tap
const SERVE_COOLDOWN = 0.18;    // s between serves
const MAX_SODAS_PER_LANE = 2;
const START_LIVES = 3;

// --- Sodas ---------------------------------------------------------------
const SODA_W = 20;
const SODA_H = 26;
const SODA_SPEED = 300;         // px/s, travelling left

// --- Empty glasses -------------------------------------------------------
const MUG_W = 20;
const MUG_H = 24;
const MUG_SPEED = 210;          // px/s, travelling right
const CATCH_X = 566;            // an empty reaching here is caught, if manned

// --- Customers -----------------------------------------------------------
const CUSTOMER_W = 34;
const CUSTOMER_H = 52;
const CUSTOMER_BASE_SPEED = 36; // px/s on wave 1
const CUSTOMER_SPEED_STEP = 6;
const CUSTOMER_SPEED_CAP = 78;
const SPAWN_X = LANE_LEFT + CUSTOMER_W / 2;
const GRAB_X = 556;             // a customer reaching here grabs the server
const KNOCKBACK = 96;           // px a served customer is pushed back
const DRINK_TIME = 0.55;        // s a customer stands still drinking

// --- Waves ---------------------------------------------------------------
const QUOTA_BASE = 6;
const QUOTA_STEP = 2;
const QUOTA_CAP = 18;
const SPAWN_BASE = 2.1, SPAWN_STEP = 0.13, SPAWN_MIN = 0.9;
const FIRST_SPAWN = 0.8;
const WAVE_PAUSE = 1.2;         // s of calm between waves
const DEATH_PAUSE = 0.9;        // s of calm after losing a life

// --- Scoring -------------------------------------------------------------
const SCORE_SATISFY = 100;
const SCORE_MUG = 50;
const WAVE_BONUS = 250;         // multiplied by the wave just finished
const SPILL_PENALTY = 25;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';   // idle | running | paused | dying | waveclear | over
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let served = 0;       // customers satisfied this wave
let caught = 0;       // empties caught this game
let spills = 0;       // sodas lost off the far end this game

let server = { lane: 0, cooldown: 0 };
const customers = [];
const sodas = [];
const mugs = [];
const popups = [];      // purely cosmetic floating score text

const POPUP_LIFE = 0.9; // s

let spawnEnabled = true;
let spawnTimer = FIRST_SPAWN;
let deathTimer = 0;
let clearTimer = 0;

// ---------------------------------------------------------------------------
// Deterministic RNG — spawn jitter is repeatable for a given seed, so the
// tests can assert on a whole wave's worth of arrivals.
// ---------------------------------------------------------------------------

let rngSeed = 1;

function srand(seed) {
    rngSeed = (seed >>> 0) || 1;
}

function rand() {
    // Park–Miller style LCG; good enough for spawn jitter and fully repeatable.
    rngSeed = (rngSeed * 1664525 + 1013904223) >>> 0;
    return rngSeed / 4294967296;
}

const randRange = (lo, hi) => lo + rand() * (hi - lo);
const randInt = (n) => Math.floor(rand() * n) % n;

// ---------------------------------------------------------------------------
// Geometry and difficulty curves
// ---------------------------------------------------------------------------

const laneY = (lane) => LANE_TOP + lane * LANE_GAP;

const quotaFor = (lvl) => Math.min(QUOTA_CAP, QUOTA_BASE + (lvl - 1) * QUOTA_STEP);

const customerSpeedFor = (lvl) =>
    Math.min(CUSTOMER_SPEED_CAP, CUSTOMER_BASE_SPEED + (lvl - 1) * CUSTOMER_SPEED_STEP);

const spawnIntervalFor = (lvl) =>
    Math.max(SPAWN_MIN, SPAWN_BASE - (lvl - 1) * SPAWN_STEP);

// ---------------------------------------------------------------------------
// DOM handles
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const remainingEl = document.getElementById('remaining');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

function clearCounter() {
    customers.length = 0;
    sodas.length = 0;
    mugs.length = 0;
    popups.length = 0;
}

function popup(x, lane, text, colour) {
    popups.push({ x, y: laneY(lane) - 30, text, colour, life: POPUP_LIFE });
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    served = 0;
    caught = 0;
    spills = 0;
    server = { lane: 0, cooldown: 0 };
    clearCounter();
    spawnEnabled = true;
    spawnTimer = FIRST_SPAWN;
    deathTimer = 0;
    clearTimer = 0;
    state = 'running';
    hideOverlay();
    updateHud();
}

function clearWave() {
    score += WAVE_BONUS * level;
    state = 'waveclear';
    clearTimer = WAVE_PAUSE;
    showOverlay(`WAVE ${level + 1}`, `Wave ${level} cleared — +${WAVE_BONUS * level}`, 'Get ready');
    updateHud();
}

function loseLife() {
    clearCounter();
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        gameOver();
    } else {
        state = 'dying';
        deathTimer = DEATH_PAUSE;
        showOverlay('OOPS!', `${lives} ${lives === 1 ? 'life' : 'lives'} left`, 'Back to the counter');
    }
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('soda-rush-best', String(best));
        } catch (err) {
            /* private browsing — the run just will not be remembered */
        }
    }
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to play again');
    updateHud();
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

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function moveLane(delta) {
    if (state !== 'running') return;
    server.lane = Math.max(0, Math.min(LANE_COUNT - 1, server.lane + delta));
}

function serve() {
    if (state !== 'running') return;
    if (server.cooldown > 0) return;
    let inLane = 0;
    for (const s of sodas) if (s.lane === server.lane) inLane += 1;
    if (inLane >= MAX_SODAS_PER_LANE) return;
    sodas.push({ lane: server.lane, x: SERVE_X });
    server.cooldown = SERVE_COOLDOWN;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) {
            spawnTimer = FIRST_SPAWN;
            state = 'running';
            hideOverlay();
        }
        return;
    }

    if (state === 'waveclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) {
            level += 1;
            served = 0;
            clearCounter();
            spawnTimer = FIRST_SPAWN;
            state = 'running';
            hideOverlay();
            updateHud();
        }
        return;
    }

    if (state !== 'running') return;

    if (server.cooldown > 0) server.cooldown = Math.max(0, server.cooldown - dt);

    moveSodas(dt);
    resolveHits();
    // Satisfying the last customer of a wave ends the frame: the rest of it
    // belongs to the break, not to the wave that just finished.
    if (state !== 'running') return;

    moveCustomers(dt);
    if (state !== 'running') return;

    moveMugs(dt);
    if (state !== 'running') return;

    for (let i = popups.length - 1; i >= 0; i--) {
        popups[i].life -= dt;
        popups[i].y -= 26 * dt;
        if (popups[i].life <= 0) popups.splice(i, 1);
    }

    spawnTick(dt);
    updateHud();
}

function moveSodas(dt) {
    for (let i = sodas.length - 1; i >= 0; i--) {
        const s = sodas[i];
        s.x -= SODA_SPEED * dt;
        if (s.x + SODA_W / 2 < LANE_LEFT) {
            sodas.splice(i, 1);
            spills += 1;
            score = Math.max(0, score - SPILL_PENALTY);
            popup(LANE_LEFT + 14, s.lane, `-${SPILL_PENALTY}`, '#ef7b5b');
        }
    }
}

// A soda is stopped by the customer closest to the fountain, so the queue is
// served front to back and a soda never sails past somebody.
function resolveHits() {
    for (let i = sodas.length - 1; i >= 0; i--) {
        const s = sodas[i];
        let target = null;
        for (const c of customers) {
            if (c.lane !== s.lane) continue;
            if (s.x - SODA_W / 2 > c.x + CUSTOMER_W / 2) continue;
            if (s.x + SODA_W / 2 < c.x - CUSTOMER_W / 2) continue;
            if (!target || c.x > target.x) target = c;
        }
        if (!target) continue;

        sodas.splice(i, 1);
        target.drinks += 1;
        target.x -= KNOCKBACK;
        target.state = 'drinking';
        target.timer = DRINK_TIME;
        if (target.x <= LANE_LEFT) satisfy(target);
        if (state !== 'running') return;
    }
}

function satisfy(customer) {
    const at = customers.indexOf(customer);
    if (at >= 0) customers.splice(at, 1);
    score += SCORE_SATISFY;
    served += 1;
    mugs.push({ lane: customer.lane, x: LANE_LEFT + MUG_W / 2 });
    popup(LANE_LEFT + 30, customer.lane, `+${SCORE_SATISFY}`, '#ffd27a');
    updateHud();
    if (served >= quotaFor(level)) clearWave();
}

function moveCustomers(dt) {
    const speed = customerSpeedFor(level);
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        if (c.state === 'drinking') {
            c.timer -= dt;
            if (c.timer <= 0) {
                c.state = 'walking';
                c.timer = 0;
            }
            continue;
        }
        c.x += speed * dt;
        if (c.x >= GRAB_X) {
            customers.splice(i, 1);
            loseLife();
            return;
        }
    }
}

function moveMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x += MUG_SPEED * dt;
        if (m.lane === server.lane && m.x >= CATCH_X) {
            mugs.splice(i, 1);
            caught += 1;
            score += SCORE_MUG;
            popup(CATCH_X - 24, m.lane, `+${SCORE_MUG}`, '#9fe6b4');
            continue;
        }
        if (m.x - MUG_W / 2 > LANE_RIGHT) {
            mugs.splice(i, 1);
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Arrivals
// ---------------------------------------------------------------------------

function spawnCustomer(lane) {
    customers.push({ lane, x: SPAWN_X, state: 'walking', timer: 0, drinks: 0 });
}

const laneHasRoom = (lane) =>
    !customers.some((c) => c.lane === lane && c.x < SPAWN_X + CUSTOMER_W + 8);

function spawnTick(dt) {
    if (!spawnEnabled) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnIntervalFor(level) * randRange(0.8, 1.2);

    const open = [];
    for (let lane = 0; lane < LANE_COUNT; lane++) if (laneHasRoom(lane)) open.push(lane);
    if (open.length === 0) return;
    spawnCustomer(open[randInt(open.length)]);
}

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    livesEl.textContent = lives;
    remainingEl.textContent = Math.max(0, quotaFor(level) - served);
    bestEl.textContent = Math.max(best, score);
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
// Rendering — every sprite is drawn from canvas primitives, so the game runs
// straight from file:// with no assets to load.
// ---------------------------------------------------------------------------

function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

function draw() {
    drawRoom();
    for (let lane = 0; lane < LANE_COUNT; lane++) drawCounter(lane);
    for (const m of mugs) drawMug(m);
    for (const s of sodas) drawSoda(s);
    for (const c of customers) drawCustomer(c);
    drawServer();
    drawPopups();
}

function drawRoom() {
    const wall = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    wall.addColorStop(0, '#452a18');
    wall.addColorStop(0.45, '#2a190e');
    wall.addColorStop(1, '#170d07');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Tiled back wall above the shelf.
    ctx.strokeStyle = 'rgba(255, 220, 170, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_W; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, WALL_H - 18);
        ctx.stroke();
    }

    // Shelf of bottles along the back wall.
    const bottleColours = ['#e85d4a', '#f2b23c', '#6fd08c', '#59b6e8', '#c879e0'];
    for (let i = 0; i < 22; i++) {
        const x = 16 + i * 28;
        const h = 22 + ((i * 7) % 14);
        ctx.fillStyle = bottleColours[i % bottleColours.length];
        ctx.globalAlpha = 0.8;
        roundRect(x, WALL_H - 16 - h, 11, h, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.fillRect(x + 2, WALL_H - 14 - h, 2, h - 4);
    }
    ctx.fillStyle = '#5a3419';
    ctx.fillRect(0, WALL_H - 16, CANVAS_W, 9);
    ctx.fillStyle = 'rgba(255, 220, 170, 0.22)';
    ctx.fillRect(0, WALL_H - 16, CANVAS_W, 2);

    // Fountain column on the right, behind the taps.
    const col = ctx.createLinearGradient(CANVAS_W - 56, 0, CANVAS_W, 0);
    col.addColorStop(0, '#50301a');
    col.addColorStop(1, '#2a1810');
    ctx.fillStyle = col;
    ctx.fillRect(CANVAS_W - 56, WALL_H - 8, 56, CANVAS_H - WALL_H + 8);
    ctx.fillStyle = 'rgba(255, 220, 170, 0.14)';
    ctx.fillRect(CANVAS_W - 56, WALL_H - 8, 3, CANVAS_H - WALL_H + 8);

    // Doorway on the left: the queue comes in and leaves through it.
    const doorW = LANE_LEFT - 14;
    const glow = ctx.createLinearGradient(0, 0, doorW, 0);
    glow.addColorStop(0, '#1b1b2e');
    glow.addColorStop(1, '#0c0905');
    ctx.fillStyle = glow;
    ctx.fillRect(0, WALL_H - 8, doorW, CANVAS_H - WALL_H + 8);
    ctx.strokeStyle = '#6b4222';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, WALL_H - 6.5, doorW, CANVAS_H - WALL_H + 5);
    ctx.fillStyle = 'rgba(120, 160, 220, 0.12)';
    ctx.fillRect(4, WALL_H - 4, doorW - 6, CANVAS_H - WALL_H);
}

function drawCounter(lane) {
    const y = laneY(lane);
    const x0 = LANE_LEFT - 18;
    const w = LANE_RIGHT - LANE_LEFT + 36;
    const manned = server.lane === lane;

    if (manned) {
        ctx.fillStyle = 'rgba(255, 196, 92, 0.12)';
        roundRect(x0 - 2, y - 56, w + 4, 62, 10);
        ctx.fill();
    }

    // Counter top, then the darker front face below it.
    const top = ctx.createLinearGradient(0, y, 0, y + COUNTER_H);
    top.addColorStop(0, manned ? '#e0a052' : '#c9873f');
    top.addColorStop(1, '#8a5522');
    ctx.fillStyle = top;
    roundRect(x0, y, w, COUNTER_H, 6);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 232, 186, 0.4)';
    ctx.fillRect(x0 + 6, y + 2, w - 12, 2);

    ctx.fillStyle = '#4d2d12';
    ctx.fillRect(x0 + 5, y + COUNTER_H, w - 10, 8);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(x0 + 5, y + COUNTER_H + 6, w - 10, 2);

    // The tap at the fountain end, lit when the server is standing here.
    const tapX = LANE_RIGHT - 34;
    ctx.fillStyle = manned ? '#ffd27a' : '#86705c';
    ctx.fillRect(tapX + 16, y - 34, 8, 34);     // riser
    ctx.fillRect(tapX, y - 34, 24, 8);          // arm
    ctx.fillRect(tapX, y - 26, 7, 11);          // nozzle
    if (manned) {
        ctx.fillStyle = 'rgba(255, 210, 122, 0.6)';
        ctx.beginPath();
        ctx.arc(tapX + 3.5, y - 11, 3.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const x = c.x;
    const feet = y + 2;
    const bodyH = CUSTOMER_H - 18;
    const shirt = ['#5b8dd6', '#d6775b', '#7fb86a', '#b084d6'][c.drinks % 4];

    // Shadow on the counter top.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x, feet, CUSTOMER_W / 2, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = shirt;
    roundRect(x - CUSTOMER_W / 2 + 4, feet - bodyH, CUSTOMER_W - 8, bodyH, 6);
    ctx.fill();

    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(x + 2, feet - bodyH - 9, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#3a2a1c';
    ctx.beginPath();
    ctx.arc(x + 2, feet - bodyH - 13, 10, Math.PI, Math.PI * 2);
    ctx.fill();

    // Eyes, looking towards the fountain.
    ctx.fillStyle = '#1d1208';
    ctx.fillRect(x + 5, feet - bodyH - 11, 2, 3);
    ctx.fillRect(x + 9, feet - bodyH - 11, 2, 3);

    if (c.state === 'drinking') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        roundRect(x + 10, feet - bodyH - 6, 9, 12, 2);
        ctx.fill();
        ctx.fillStyle = '#ffb545';
        ctx.fillRect(x + 11, feet - bodyH - 2, 7, 7);
    }
}

function drawSoda(s) {
    const y = laneY(s.lane);
    const top = y - SODA_H + 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(s.x, y + 2, SODA_W / 2, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Glass, fill, foam and a straw.
    ctx.fillStyle = 'rgba(232, 244, 255, 0.9)';
    roundRect(s.x - SODA_W / 2, top, SODA_W, SODA_H, 4);
    ctx.fill();

    const fizz = ctx.createLinearGradient(0, top, 0, y);
    fizz.addColorStop(0, '#f0a63c');
    fizz.addColorStop(1, '#b65d14');
    ctx.fillStyle = fizz;
    roundRect(s.x - SODA_W / 2 + 2.5, top + 7, SODA_W - 5, SODA_H - 10, 3);
    ctx.fill();

    ctx.fillStyle = '#fff6e2';
    roundRect(s.x - SODA_W / 2 + 1.5, top + 2, SODA_W - 3, 6, 3);
    ctx.fill();

    ctx.strokeStyle = '#e8574a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(s.x + 3, top - 6);
    ctx.lineTo(s.x - 2, top + 10);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(s.x - 4 + i * 4, top + 12 + ((i * 5) % 8), 1.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawMug(m) {
    const y = laneY(m.lane);
    const top = y - MUG_H + 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(m.x, y + 2, MUG_W / 2, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // An empty glass: outline, a dreg of soda and a handle.
    ctx.fillStyle = 'rgba(206, 232, 255, 0.16)';
    roundRect(m.x - MUG_W / 2, top, MUG_W, MUG_H, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(222, 242, 255, 0.95)';
    ctx.lineWidth = 2;
    roundRect(m.x - MUG_W / 2, top, MUG_W, MUG_H, 4);
    ctx.stroke();

    ctx.fillStyle = 'rgba(214, 130, 36, 0.75)';
    roundRect(m.x - MUG_W / 2 + 2.5, y - 6, MUG_W - 5, 4, 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(m.x + MUG_W / 2 + 2, top + MUG_H / 2, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawPopups() {
    ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const p of popups) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / (POPUP_LIFE * 0.6)));
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillText(p.text, p.x + 1, p.y + 1);
        ctx.fillStyle = p.colour;
        ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
}

function drawServer() {
    const y = laneY(server.lane);
    const feet = y + 4;
    const bodyH = SERVER_H - 18;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(SERVER_X, feet, SERVER_W / 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e8e2d6';
    roundRect(SERVER_X - SERVER_W / 2 + 4, feet - bodyH, SERVER_W - 8, bodyH, 6);
    ctx.fill();

    ctx.fillStyle = '#ffb545';
    ctx.fillRect(SERVER_X - SERVER_W / 2 + 4, feet - bodyH / 2, SERVER_W - 8, bodyH / 2);

    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(SERVER_X - 2, feet - bodyH - 10, 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(SERVER_X - 15, feet - bodyH - 22, 26, 7);

    ctx.fillStyle = '#1d1208';
    ctx.fillRect(SERVER_X - 8, feet - bodyH - 12, 2, 3);
    ctx.fillRect(SERVER_X - 3, feet - bodyH - 12, 2, 3);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    const k = e.key;

    if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else serve();
        return;
    }

    if (k === 'p' || k === 'P') {
        togglePause();
        return;
    }

    if (k === 'ArrowUp' || k === 'w' || k === 'W') {
        e.preventDefault();
        moveLane(-1);
    } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
        e.preventDefault();
        moveLane(1);
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
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

try {
    best = parseInt(localStorage.getItem('soda-rush-best') || '0', 10) || 0;
} catch (err) {
    best = 0;
}
srand(Date.now() % 2147483647);
updateHud();
showOverlay('SODA RUSH', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
