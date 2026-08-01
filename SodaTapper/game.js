// ---------------------------------------------------------------------------
// Soda Tapper — a lane-based serving arcade game on an HTML5 canvas.
//
// Four bars run across the screen. Thirsty customers shuffle in from the far
// (left) end and walk toward the tap; the server stands at the tap end and
// slides full mugs of soda down whichever bar they are standing at. A mug that
// reaches a customer knocks them back down the bar while they drink; knock a
// customer clean off the end and they leave, sliding their empty mug back for
// the server to catch. Drop an empty, let a mug smash against the far wall, or
// let a customer reach the tap and you lose a life.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 400;

const LANE_COUNT = 4;
const LANE_TOP = 74;            // y of the first bar's surface
const LANE_GAP = 86;            // vertical distance between bars
const BAR_LEFT = 60;            // far end of a bar (where customers walk on)
const TAP_X = 520;              // the tap / server station
const CATCH_X = 508;            // empties are caught once they reach here

// --- Server ---
const START_LIVES = 3;
const MUG_TRAY = 4;             // mugs the server can have in flight at once
const SERVE_COOLDOWN = 0.3;     // seconds between pours

// --- Mugs ---
const MUG_SPEED = 260;          // px/s, full mugs sliding away from the tap
const EMPTY_SPEED = 210;        // px/s, empties sliding back toward the tap
const MUG_W = 16;
const MUG_H = 20;

// --- Customers ---
const CUSTOMER_W = 26;
const CUSTOMER_BASE = 22;       // px/s walk speed at level 0
const CUSTOMER_STEP = 4;        // px/s added per level
const PUSH_KNOCK = 60;          // instant knock-back when a mug lands
const PUSH_SPEED = 120;         // px/s the customer slides back while drinking
const PUSH_TIME = 0.7;          // seconds of drinking per mug
const SPAWN_FIRST = 2.5;        // grace period before the first customer walks on
const CUSTOMER_COLORS = ['#c9857a', '#8d7ec0', '#c2a04a', '#5f93b5', '#b06f9a'];

// --- Scoring ---
const HIT_SCORE = 25;           // landing a mug on a customer
const SERVE_SCORE = 100;        // knocking a customer off the end of the bar
const CATCH_SCORE = 50;         // catching a returned empty
const LEVEL_BONUS = 200;        // per level cleared

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
let state, score, best, level, lives, mugsLeft;
let serveCooldown, spawnTimer, spawnedThisLevel, servedThisLevel;
const player = { lane: 0, pourAnim: 0 };
const customers = [];
const mugs = [];
const empties = [];
const particles = [];

// ---------------------------------------------------------------------------
// Geometry & difficulty helpers (pure functions of state)
// ---------------------------------------------------------------------------

function laneY(i) {
    return LANE_TOP + i * LANE_GAP;
}

function customerSpeed() {
    return CUSTOMER_BASE + level * CUSTOMER_STEP;
}

function customersThisLevel() {
    return 4 + level * 2;
}

function spawnInterval() {
    return Math.max(1.0, 3.2 - level * 0.25);
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

function spawnCustomer(lane, x) {
    customers.push({
        lane,
        x: x === undefined ? BAR_LEFT - 18 : x,
        pushTimer: 0,
        sips: 0,
        bob: Math.random() * Math.PI * 2,
        style: Math.floor(Math.random() * CUSTOMER_COLORS.length),
    });
}

function spawnEmpty(lane, x) {
    empties.push({ lane, x, wobble: 0 });
}

function spawnMug(lane) {
    mugs.push({ lane, x: TAP_X - 8, fizz: 0 });
}

// Pick a bar that has room at its far end, so customers never stack on top of
// each other as they walk on.
function pickSpawnLane() {
    const free = [];
    for (let i = 0; i < LANE_COUNT; i++) {
        const crowded = customers.some((c) => c.lane === i && c.x < BAR_LEFT + 34);
        if (!crowded) free.push(i);
    }
    if (!free.length) return -1;
    return free[Math.floor(Math.random() * free.length)];
}

function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 130;
        particles.push({
            x, y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 40,
            life: 0.5 + Math.random() * 0.3,
            age: 0,
            color,
        });
    }
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function moveLane(delta) {
    if (state !== 'running') return;
    player.lane = Math.max(0, Math.min(LANE_COUNT - 1, player.lane + delta));
}

function setLane(lane) {
    if (state !== 'running') return;
    player.lane = Math.max(0, Math.min(LANE_COUNT - 1, lane));
}

function laneAtY(y) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < LANE_COUNT; i++) {
        const d = Math.abs(laneY(i) - y);
        if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
}

function serve() {
    if (state !== 'running') return;
    if (serveCooldown > 0 || mugsLeft <= 0) return;
    mugsLeft--;
    serveCooldown = SERVE_COOLDOWN;
    player.pourAnim = 0.22;
    spawnMug(player.lane);
}

// ---------------------------------------------------------------------------
// Life cycle
// ---------------------------------------------------------------------------

function clearBars() {
    customers.length = 0;
    mugs.length = 0;
    empties.length = 0;
}

function resetRound() {
    clearBars();
    mugsLeft = MUG_TRAY;
    serveCooldown = 0;
    spawnTimer = SPAWN_FIRST;
}

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    lives = START_LIVES;
    spawnedThisLevel = 0;
    servedThisLevel = 0;
    player.lane = LANE_COUNT - 1;
    player.pourAnim = 0;
    particles.length = 0;
    resetRound();
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level++;
    score += LEVEL_BONUS * (level - 1);
    spawnedThisLevel = 0;
    servedThisLevel = 0;
    resetRound();
    updateHud();
}

function loseLife() {
    lives--;
    resetRound();
    updateHud();
    if (lives <= 0) endGame();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('soda-tapper-best', String(best)); } catch (e) { /* private mode */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} — Level ${level}`, 'Press Space to play again', 'Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation — one deterministic slice of the world
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    if (serveCooldown > 0) serveCooldown = Math.max(0, serveCooldown - dt);
    if (player.pourAnim > 0) player.pourAnim = Math.max(0, player.pourAnim - dt);

    stepSpawning(dt);
    stepMugs(dt);
    stepCustomers(dt);
    stepEmpties(dt);
    stepParticles(dt);

    if (state === 'running' && levelCleared()) nextLevel();
}

function stepSpawning(dt) {
    if (spawnedThisLevel >= customersThisLevel()) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    const lane = pickSpawnLane();
    spawnTimer = spawnInterval();
    if (lane < 0) return;   // every bar busy — try again next interval
    spawnCustomer(lane);
    spawnedThisLevel++;
}

function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const mug = mugs[i];
        mug.x -= MUG_SPEED * dt;
        mug.fizz += dt;

        const target = frontCustomer(mug);
        if (target) {
            mugs.splice(i, 1);
            drink(target);
            continue;
        }

        if (mug.x <= BAR_LEFT - 6) {
            mugs.splice(i, 1);
            burst(BAR_LEFT, laneY(mug.lane) - 6, '#e6b46b', 12);
            loseLife();
            return;         // the bars were just cleared — nothing left to walk
        }
    }
}

// The right-most customer on this mug's bar that the mug has caught up with.
function frontCustomer(mug) {
    let found = null;
    for (const c of customers) {
        if (c.lane !== mug.lane) continue;
        if (mug.x > c.x + CUSTOMER_W / 2) continue;
        if (mug.x < c.x - CUSTOMER_W) continue;
        if (!found || c.x > found.x) found = c;
    }
    return found;
}

function drink(customer) {
    customer.x -= PUSH_KNOCK;
    customer.pushTimer = PUSH_TIME;
    customer.sips++;
    score += HIT_SCORE;
    burst(customer.x, laneY(customer.lane) - 14, '#7fd4ff', 8);
    updateHud();
}

function stepCustomers(dt) {
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        c.bob += dt * 6;

        if (c.pushTimer > 0) {
            c.pushTimer = Math.max(0, c.pushTimer - dt);
            c.x -= PUSH_SPEED * dt;
            if (c.x <= BAR_LEFT - 12) {
                customers.splice(i, 1);
                servedThisLevel++;
                score += SERVE_SCORE;
                spawnEmpty(c.lane, BAR_LEFT);
                burst(BAR_LEFT + 10, laneY(c.lane) - 16, '#f7a83c', 10);
                updateHud();
            }
            continue;
        }

        c.x += customerSpeed() * dt;
        if (c.x >= TAP_X - 20) {
            burst(TAP_X - 30, laneY(c.lane) - 16, '#ef6a5a', 14);
            loseLife();
            return;         // bars cleared
        }
    }
}

function stepEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const e = empties[i];
        e.x += EMPTY_SPEED * dt;
        e.wobble += dt * 12;

        if (e.x >= CATCH_X && e.lane === player.lane) {
            empties.splice(i, 1);
            score += CATCH_SCORE;
            mugsLeft = Math.min(MUG_TRAY, mugsLeft + 1);
            updateHud();
            continue;
        }

        if (e.x > TAP_X + 4) {
            empties.splice(i, 1);
            burst(TAP_X, laneY(e.lane) - 6, '#c9d6e8', 12);
            loseLife();
            return;         // bars cleared
        }
    }
}

function stepParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) { particles.splice(i, 1); continue; }
        p.vy += 420 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }
}

function levelCleared() {
    return servedThisLevel >= customersThisLevel()
        && customers.length === 0
        && mugs.length === 0
        && empties.length === 0;
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    bestEl.textContent = String(best);
}

function showOverlay(title, sub, hint, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub;
    overlaySub.textContent = hint;
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawRoom();

    for (let i = 0; i < LANE_COUNT; i++) drawBar(i);

    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m.x, laneY(m.lane), true, m.fizz);
    for (const e of empties) drawMug(e.x, laneY(e.lane), false, e.wobble);

    drawServer();
    drawParticles();
    drawTray();
}

function drawRoom() {
    const wall = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    wall.addColorStop(0, '#311c12');
    wall.addColorStop(1, '#150c09');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // vertical wood panelling
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    for (let x = 0; x < CANVAS_W; x += 24) ctx.fillRect(x, 0, 2, CANVAS_H);

    // service alley behind the tap, where the server walks
    ctx.fillStyle = 'rgba(255, 214, 150, 0.05)';
    ctx.fillRect(TAP_X + 12, 0, CANVAS_W - TAP_X - 12, CANVAS_H);
    ctx.fillStyle = 'rgba(255, 214, 150, 0.09)';
    ctx.fillRect(TAP_X + 12, 0, 2, CANVAS_H);

    // the bar the server is standing at, lit up (fades out at both edges so the
    // highlight reads as a pool of light rather than a band)
    const y = laneY(player.lane);
    const glow = ctx.createLinearGradient(0, y - 58, 0, y + 24);
    glow.addColorStop(0, 'rgba(247, 168, 60, 0)');
    glow.addColorStop(0.72, 'rgba(247, 168, 60, 0.14)');
    glow.addColorStop(1, 'rgba(247, 168, 60, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, y - 58, CANVAS_W, 82);
}

function drawBar(i) {
    const y = laneY(i);
    const left = BAR_LEFT - 30;
    const w = TAP_X - left + 16;

    // counter top, front edge and drop shadow
    ctx.fillStyle = '#8a5227';
    ctx.fillRect(left, y, w, 11);
    ctx.fillStyle = '#b5762f';
    ctx.fillRect(left, y, w, 4);
    ctx.fillStyle = '#5d3418';
    ctx.fillRect(left, y + 11, w, 5);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(left, y + 16, w, 7);

    // brass rail along the front
    ctx.fillStyle = 'rgba(247, 200, 120, 0.35)';
    ctx.fillRect(left + 6, y + 13, w - 12, 1);

    // end post where mugs smash
    ctx.fillStyle = '#4d2c16';
    ctx.fillRect(left - 6, y - 12, 8, 30);
    ctx.fillStyle = '#6b3d1e';
    ctx.fillRect(left - 6, y - 12, 8, 3);
}

function drawServer() {
    const y = laneY(player.lane);
    const x = TAP_X + 26;
    const pouring = player.pourAnim > 0;

    // tap tower
    ctx.fillStyle = '#c9d6e8';
    ctx.fillRect(TAP_X + 4, y - 30, 7, 26);
    ctx.fillRect(TAP_X - 2, y - 14, 12, 5);
    if (pouring) {
        ctx.fillStyle = '#f7a83c';
        ctx.fillRect(TAP_X - 2, y - 9, 4, 9);
    }

    // server
    ctx.fillStyle = '#f2d3b0';
    ctx.beginPath();
    ctx.arc(x, y - 34, 8, 0, Math.PI * 2);   // head
    ctx.fill();
    ctx.fillStyle = '#e8e2d6';
    ctx.fillRect(x - 9, y - 26, 18, 22);      // apron
    ctx.fillStyle = '#3f6f9a';
    ctx.fillRect(x - 9, y - 26, 18, 7);       // shirt
    ctx.fillStyle = '#f2d3b0';
    ctx.fillRect(x - 16, y - 24, 8, 5);       // pouring arm
    ctx.fillStyle = '#2a1a12';
    ctx.fillRect(x - 8, y - 4, 6, 6);
    ctx.fillRect(x + 2, y - 4, 6, 6);         // shoes
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const drinking = c.pushTimer > 0;
    const stride = drinking ? 0 : Math.sin(c.bob) * 1.6;
    const shirt = CUSTOMER_COLORS[c.style % CUSTOMER_COLORS.length];

    ctx.save();
    ctx.translate(c.x, y);
    if (drinking) ctx.rotate(-0.08);          // leaning back mid-gulp

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 12, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2a1a12';                // legs
    ctx.fillRect(-8 + stride, -10, 6, 10);
    ctx.fillRect(2 - stride, -10, 6, 10);

    ctx.fillStyle = shirt;                    // body
    ctx.fillRect(-10, -28, 20, 19);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.fillRect(-10, -28, 20, 4);

    ctx.fillStyle = '#f2d3b0';                // head
    ctx.beginPath();
    ctx.arc(0, -35, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a2418';                // hair
    ctx.fillRect(-8, -43, 16, 5);

    if (drinking) {
        ctx.fillStyle = '#e9edf5';            // mug raised to the lips
        ctx.fillRect(4, -40, 9, 11);
        ctx.fillStyle = '#8b4a17';
        ctx.fillRect(6, -37, 5, 7);
    } else {
        ctx.fillStyle = '#f2d3b0';            // arm out, waiting for a drink
        ctx.fillRect(-16, -25, 7, 5);
    }
    ctx.restore();
}

function drawMug(x, y, full, phase) {
    const h = MUG_H;

    // slide trail
    ctx.fillStyle = full ? 'rgba(247, 168, 60, 0.16)' : 'rgba(201, 214, 232, 0.14)';
    const dir = full ? 1 : -1;
    ctx.fillRect(x + dir * MUG_W / 2, y - 5, dir * 16, 3);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(x - MUG_W / 2, y - 2, MUG_W, 3);

    ctx.strokeStyle = '#b9c3d3';              // handle
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + MUG_W / 2 + 2, y - h / 2, 4, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    ctx.fillStyle = '#e9edf5';                // glass
    ctx.fillRect(x - MUG_W / 2, y - h, MUG_W, h);
    if (full) {
        ctx.fillStyle = '#8b4a17';            // soda
        ctx.fillRect(x - MUG_W / 2 + 2, y - h + 7, MUG_W - 4, h - 9);
        ctx.fillStyle = '#fff6e0';            // foam head
        const foam = Math.sin(phase * 14) * 1.2;
        ctx.fillRect(x - MUG_W / 2 + 1, y - h + 3 + foam, MUG_W - 2, 5);
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillRect(x - MUG_W / 2 + 2, y - h + 2, 2, h - 5);
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

function drawTray() {
    ctx.fillStyle = 'rgba(245, 233, 220, 0.5)';
    ctx.font = '9px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MUGS', 562, 336);

    // mugs still on the tray, stacked beside the tap
    for (let i = 0; i < mugsLeft; i++) {
        const x = 552 + (i % 2) * 20;
        const y = 380 - Math.floor(i / 2) * 26;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(x - 7, y, 14, 3);
        ctx.fillStyle = '#e9edf5';
        ctx.fillRect(x - 6, y - 15, 12, 15);
        ctx.fillStyle = '#8b4a17';
        ctx.fillRect(x - 4, y - 10, 8, 9);
        ctx.fillStyle = '#fff6e0';
        ctx.fillRect(x - 4, y - 12, 8, 3);
    }
}

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
// Input
// ---------------------------------------------------------------------------

function startOrResume() {
    if (state === 'paused') togglePause();
    else if (state !== 'running') startGame();
}

window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        if (state === 'running') serve();
        else startOrResume();
        return;
    }
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { moveLane(-1); e.preventDefault(); return; }
    if (k === 'ArrowDown' || k === 's' || k === 'S') { moveLane(1); e.preventDefault(); return; }
    if (k === 'p' || k === 'P') { togglePause(); return; }
    if (k === 'Enter') { startOrResume(); }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    setLane(laneAtY(y));
});

canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (state === 'running') serve();
    else startOrResume();
});

btnStart.addEventListener('click', startOrResume);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = 0;
try { best = parseInt(localStorage.getItem('soda-tapper-best') || '0', 10) || 0; } catch (e) { /* private mode */ }
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
spawnedThisLevel = 0;
servedThisLevel = 0;
player.lane = LANE_COUNT - 1;
resetRound();
updateHud();
requestAnimationFrame(frame);
