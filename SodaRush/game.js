// ---------------------------------------------------------------------------
// Soda Rush — a four-counter diner shift on an HTML5 canvas.
//
// You are the only server in a very busy soda bar. Four counters run away from
// your taps; thirsty customers shuffle up each one towards you. Pour a soda and
// it slides down the counter: a customer who meets it grabs it and is shoved
// back towards the door. Satisfied customers leave — and shove their empty mug
// back up the counter, which you have to be standing in front of to catch.
//
// Three ways to lose a life: let a customer reach your taps, slide a soda past
// everybody so it smashes off the far end, or let a returning empty roll in to
// a counter you are not standing at.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Gold Runner,
// Snake and Tetris in this repo. All motion is expressed per-second and advanced
// through `step(dt)`, so the tests can simulate frames deterministically without
// depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Geometry ------------------------------------------------------------
const CANVAS_W = 720;
const CANVAS_H = 480;

const LANES = 4;
const LANE_Y = [96, 192, 288, 384];   // vertical centre of each counter top
const COUNTER_H = 18;                 // thickness of the counter slab

const BAR_LEFT = 70;                  // far end: the door, and the drop-off edge
const BAR_RIGHT = 640;                // serving end: where the taps are
const SERVER_X = 676;                 // where the server is drawn

// --- Speeds and rules ----------------------------------------------------
const MUG_SPEED = 340;                // a poured soda slides this fast (left)
const EMPTY_SPEED = 240;              // a returned empty rolls this fast (right)
const RETREAT_SPEED = 90;             // a satisfied customer walks out this fast
const PUSH_BACK = 70;                 // how far a caught soda shoves a customer
const CATCH_DIST = 22;                // mug/customer overlap that counts as a catch
const CUSTOMER_LIMIT = BAR_RIGHT - 34;// a customer this far up has reached you
const MAX_PER_LANE = 3;               // customers allowed on one counter at once

const SERVE_POINTS = 100;             // a customer served and shown the door
const CATCH_POINTS = 50;              // an empty mug caught at the taps

// --- Elements ------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const scoreEl = document.getElementById('score');
const servedEl = document.getElementById('served');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');

// --- State ---------------------------------------------------------------
// 'idle' | 'playing' | 'paused' | 'over'
let state = 'idle';
let score = 0;
let lives = 3;
let level = 1;
let best = 0;

let served = 0;     // customers sent home this wave
let spawned = 0;    // customers released this wave
let goal = 0;       // customers to serve to clear the wave
let spawnTimer = 0; // seconds until the next customer walks in

const server = { lane: 0 };
let customers = [];
let mugs = [];      // both full sodas (vx < 0) and returning empties (vx > 0)

// Test hooks: `autoStep` lets a spec own the clock, `autoSpawn` lets it own the
// customer stream. Neither is touched by startGame().
let autoStep = true;
let autoSpawn = true;

// Purely cosmetic: splashes left by smashed mugs and bubbles above the taps.
let splashes = [];
let shift = 0;

// ---------------------------------------------------------------------------
// Wave shape
// ---------------------------------------------------------------------------

// Later levels send more customers, faster, and thirstier.
const waveGoal = (lvl) => 4 + lvl * 2;
const customerSpeed = (lvl) => 22 + lvl * 6;
const spawnInterval = (lvl) => Math.max(1.1, 3.4 - lvl * 0.25);
const customerThirst = (lvl) => (lvl >= 3 ? 2 : 1);

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function spawnCustomer(lane) {
    const inLane = customers.filter((c) => c.lane === lane).length;
    if (inLane >= MAX_PER_LANE) return null;

    const customer = {
        lane,
        x: BAR_LEFT,
        state: 'advancing',           // 'advancing' | 'retreating'
        thirst: customerThirst(level),
        speed: customerSpeed(level),
        bob: Math.random() * Math.PI * 2,
        tint: Math.floor(Math.random() * 4),
    };
    customers.push(customer);
    spawned++;
    return customer;
}

function spawnEmpty(lane, x) {
    const mug = { lane, x, vx: EMPTY_SPEED, empty: true };
    mugs.push(mug);
    return mug;
}

function serveSoda() {
    if (state !== 'playing') return false;
    mugs.push({ lane: server.lane, x: BAR_RIGHT, vx: -MUG_SPEED, empty: false });
    return true;
}

function setLane(lane) {
    server.lane = Math.max(0, Math.min(LANES - 1, lane));
    return server.lane;
}

function splash(lane, x, color) {
    splashes.push({ lane, x, color, life: 0.5 });
}

// ---------------------------------------------------------------------------
// Life cycle
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    served = 0;
    spawned = 0;
    goal = waveGoal(level);
    spawnTimer = 0.8;
    customers = [];
    mugs = [];
    splashes = [];
    setLane(0);
    state = 'playing';
    hideOverlay();
    updateHud();
}

// A lost life clears the counters so the next wave starts from a clean board.
// `spawned` winds back to `served` so the customers wiped off the counter are
// re-sent and the wave can still be completed.
function loseLife() {
    lives--;
    customers = [];
    mugs = [];
    spawned = served;
    spawnTimer = 1.2;
    updateHud();
    if (lives <= 0) {
        lives = 0;
        gameOver();
    }
}

function advanceLevel() {
    level++;
    served = 0;
    spawned = 0;
    goal = waveGoal(level);
    spawnTimer = 1.2;
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('sodarush-best', String(best));
        } catch (err) {
            /* private browsing — the run just does not persist */
        }
    }
    updateHud();
    showOverlay('SHIFT OVER', `Score ${score} · Level ${level}`, 'Press Space to work another shift');
}

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P or Space to resume');
    } else if (state === 'paused') {
        state = 'playing';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'playing') return;
    shift += dt;

    if (autoSpawn) stepSpawning(dt);
    if (stepMugs(dt)) return;      // a life was lost: the board is already clear
    if (stepCustomers(dt)) return;
    stepSplashes(dt);

    if (served >= goal && spawned >= goal && customers.length === 0 && mugs.length === 0) {
        advanceLevel();
    }
}

function stepSpawning(dt) {
    if (spawned >= goal) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval(level);

    // Prefer a counter that is not already crowded, so all four stay in play.
    const open = [];
    for (let lane = 0; lane < LANES; lane++) {
        if (customers.filter((c) => c.lane === lane).length < MAX_PER_LANE) open.push(lane);
    }
    if (open.length === 0) return;
    spawnCustomer(open[Math.floor(Math.random() * open.length)]);
}

// Returns true when a life was lost (and the caller should stop stepping).
function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const mug = mugs[i];
        mug.x += mug.vx * dt;

        if (mug.empty) {
            // Rolling back up the counter towards the taps.
            if (mug.x >= BAR_RIGHT) {
                mugs.splice(i, 1);
                if (mug.lane === server.lane) {
                    score += CATCH_POINTS;
                    splash(mug.lane, BAR_RIGHT, '#4fd6c8');
                    updateHud();
                } else {
                    splash(mug.lane, BAR_RIGHT, '#ff5a8a');
                    loseLife();
                    return true;
                }
            }
            continue;
        }

        // A full soda: the first thirsty customer it meets grabs it.
        const taker = customers.find(
            (c) => c.lane === mug.lane && c.state === 'advancing' && Math.abs(c.x - mug.x) <= CATCH_DIST
        );
        if (taker) {
            mugs.splice(i, 1);
            taker.thirst--;
            taker.x = Math.max(BAR_LEFT, taker.x - PUSH_BACK);
            if (taker.thirst <= 0) taker.state = 'retreating';
            continue;
        }

        if (mug.x <= BAR_LEFT) {
            mugs.splice(i, 1);
            splash(mug.lane, BAR_LEFT, '#ffd447');
            loseLife();
            return true;
        }
    }
    return false;
}

// Returns true when a life was lost (and the caller should stop stepping).
function stepCustomers(dt) {
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        c.bob += dt * 6;

        if (c.state === 'advancing') {
            c.x += c.speed * dt;
            if (c.x >= CUSTOMER_LIMIT) {
                splash(c.lane, CUSTOMER_LIMIT, '#ff5a8a');
                loseLife();
                return true;
            }
            continue;
        }

        // Retreating: walking out of the door, mug in hand.
        c.x -= RETREAT_SPEED * dt;
        if (c.x <= BAR_LEFT) {
            customers.splice(i, 1);
            served++;
            score += SERVE_POINTS * level;
            spawnEmpty(c.lane, BAR_LEFT);
            updateHud();
        }
    }
    return false;
}

function stepSplashes(dt) {
    for (let i = splashes.length - 1; i >= 0; i--) {
        splashes[i].life -= dt;
        if (splashes[i].life <= 0) splashes.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    servedEl.textContent = `${served} / ${goal || waveGoal(level)}`;
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    overlaySub.textContent = sub || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

const CUSTOMER_TINTS = ['#ffd447', '#8ad7ff', '#c69cff', '#ff9f68'];

function draw() {
    // Back wall.
    const wall = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    wall.addColorStop(0, '#2a1630');
    wall.addColorStop(1, '#120a18');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawFloor();
    drawDoor();
    for (let lane = 0; lane < LANES; lane++) drawCounter(lane);
    drawTaps();

    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m);
    for (const s of splashes) drawSplash(s);

    drawServer();
}

// The tiled strip of floor below the bottom counter, so the room has a bottom.
function drawFloor() {
    const top = LANE_Y[LANES - 1] + COUNTER_H + 28;
    ctx.fillStyle = '#1c1024';
    ctx.fillRect(0, top, CANVAS_W, CANVAS_H - top);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    for (let x = ((shift * 8) % 72) - 72; x < CANVAS_W; x += 72) {
        ctx.fillRect(x, top, 36, CANVAS_H - top);
    }
    ctx.strokeStyle = 'rgba(255, 220, 170, 0.14)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(CANVAS_W, top);
    ctx.stroke();
}

function drawDoor() {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(0, 0, BAR_LEFT - 18, CANVAS_H);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(BAR_LEFT - 18, 0);
    ctx.lineTo(BAR_LEFT - 18, CANVAS_H);
    ctx.stroke();

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.translate(26, CANVAS_H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('D O O R', 0, 0);
    ctx.restore();
}

function drawCounter(lane) {
    const y = LANE_Y[lane];

    // The counter the server is standing at is the one that can take a catch,
    // so it gets a wash of light along its whole length.
    if (server.lane === lane && state === 'playing') {
        const glow = ctx.createLinearGradient(BAR_LEFT, y - 46, BAR_RIGHT, y - 46);
        glow.addColorStop(0, 'rgba(79, 214, 200, 0)');
        glow.addColorStop(1, 'rgba(79, 214, 200, 0.16)');
        ctx.fillStyle = glow;
        ctx.fillRect(BAR_LEFT - 18, y - 56, BAR_RIGHT + 36 - BAR_LEFT, 56 + COUNTER_H);
    }

    const grad = ctx.createLinearGradient(0, y, 0, y + COUNTER_H);
    grad.addColorStop(0, '#6c4524');
    grad.addColorStop(1, '#3a2313');
    ctx.fillStyle = grad;
    ctx.fillRect(BAR_LEFT - 18, y, BAR_RIGHT + 18 - (BAR_LEFT - 18), COUNTER_H);

    ctx.fillStyle = 'rgba(255, 220, 170, 0.22)';
    ctx.fillRect(BAR_LEFT - 18, y, BAR_RIGHT + 18 - (BAR_LEFT - 18), 3);

    // The spot a returning empty has to be caught at.
    ctx.fillStyle = server.lane === lane ? 'rgba(79, 214, 200, 0.5)' : 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(BAR_RIGHT - 4, y - 4, 10, COUNTER_H + 8);
}

function drawTaps() {
    for (let lane = 0; lane < LANES; lane++) {
        const y = LANE_Y[lane];
        ctx.fillStyle = '#58436a';
        ctx.fillRect(BAR_RIGHT + 14, y - 30, 8, 30);
        ctx.fillStyle = '#8f7aa5';
        ctx.fillRect(BAR_RIGHT + 8, y - 34, 20, 6);
    }
}

function drawCustomer(c) {
    const y = LANE_Y[c.lane];
    const bob = Math.sin(c.bob) * 2;
    const tint = CUSTOMER_TINTS[c.tint % CUSTOMER_TINTS.length];

    // Body.
    ctx.fillStyle = c.state === 'retreating' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.14)';
    ctx.fillRect(c.x - 11, y - 40 + bob, 22, 40);

    // Head.
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.arc(c.x, y - 48 + bob, 9, 0, Math.PI * 2);
    ctx.fill();

    // Arms down the sides of the body.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(c.x - 15, y - 34 + bob, 4, 18);
    ctx.fillRect(c.x + 11, y - 34 + bob, 4, 18);

    // Thirst pips over the head.
    ctx.fillStyle = '#ff5a8a';
    for (let i = 0; i < c.thirst; i++) {
        ctx.fillRect(c.x - 6 + i * 8, y - 64 + bob, 5, 5);
    }

    // A mug in hand once they are heading out.
    if (c.state === 'retreating') {
        ctx.fillStyle = '#d9e6f2';
        ctx.fillRect(c.x - 20, y - 26 + bob, 8, 10);
    }
}

function drawMug(m) {
    const y = LANE_Y[m.lane];
    const top = y - 20;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(m.x, y + 2, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = m.empty ? '#cfd8e3' : '#f3e7d2';
    ctx.fillRect(m.x - 7, top, 14, 20);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(m.x - 7, top, 14, 20);

    // Handle.
    ctx.beginPath();
    ctx.arc(m.x + 10, top + 10, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    if (!m.empty) {
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(m.x - 5, top + 4, 10, 14);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(m.x - 5, top + 2, 10, 3);
    }
}

function drawSplash(s) {
    const y = LANE_Y[s.lane];
    const t = Math.max(0, s.life / 0.5);
    ctx.save();
    ctx.globalAlpha = t;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const r = 6 + (1 - t) * 18;
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(a) * 4, y - 6 + Math.sin(a) * 4);
        ctx.lineTo(s.x + Math.cos(a) * r, y - 6 + Math.sin(a) * r);
        ctx.stroke();
    }
    ctx.restore();
}

function drawServer() {
    const y = LANE_Y[server.lane];
    ctx.fillStyle = '#4fd6c8';
    ctx.fillRect(SERVER_X - 12, y - 42, 24, 42);
    ctx.beginPath();
    ctx.arc(SERVER_X, y - 50, 10, 0, Math.PI * 2);
    ctx.fill();

    // Apron.
    ctx.fillStyle = '#fdf3e3';
    ctx.fillRect(SERVER_X - 10, y - 24, 20, 20);

    // Tray arm reaching over the counter.
    ctx.fillStyle = '#4fd6c8';
    ctx.fillRect(SERVER_X - 26, y - 30, 16, 6);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (k === ' ' || k === 'Spacebar' || e.code === 'Space') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'paused') togglePause();
        else serveSoda();
        return;
    }
    if (k === 'p') {
        togglePause();
        return;
    }
    if (state !== 'playing') return;
    if (k === 'ArrowUp' || k === 'w') {
        e.preventDefault();
        setLane(server.lane - 1);
    } else if (k === 'ArrowDown' || k === 's') {
        e.preventDefault();
        setLane(server.lane + 1);
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

try {
    best = parseInt(localStorage.getItem('sodarush-best') || '0', 10) || 0;
} catch (err) {
    best = 0;
}
goal = waveGoal(level);
state = 'idle';
updateHud();
showOverlay('SODA RUSH', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
