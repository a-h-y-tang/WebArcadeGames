// ---------------------------------------------------------------------------
// Soda Tapper — a four-counter bar-service arcade game on an HTML5 canvas.
//
// Customers walk in from the left of each counter and march toward the tap
// station on the right. The player stands at the station, switches counters
// with up/down, and slides full mugs down a counter to push customers back.
// Every drink taken sends an empty mug sliding back, which has to be caught by
// standing in that lane.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom!,
// Dino Run and Snake in this repo. All motion is per-second and advanced
// through `step(dt)` in fixed sub-steps, so tests can simulate frames
// deterministically instead of depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 420;

const LANES = 4;
const LANE_Y = [72, 160, 248, 336]; // vertical centre of each counter
const BAR_LEFT = 48;                // far end of a counter (customers enter here)
const STATION_X = 592;              // the player's tap station
const GRAB_X = STATION_X - 26;      // a customer this far right has grabbed you
const MUG_START_X = STATION_X - 20; // where a poured mug appears
const CATCH_X = STATION_X - 20;     // where a returning empty must be caught

const CUSTOMER_W = 28;
const CUSTOMER_H = 34;
const MUG_W = 18;
const MUG_H = 22;
const HIT_DIST = (CUSTOMER_W + MUG_W) / 2; // mug/customer contact distance
const COUNTER_H = 46;

// --- Motion ---
const PUSH_BACK = 96;         // px a customer is knocked back per drink
const EMPTY_SPEED = 210;      // px/s of a returning empty mug
const SERVE_COOLDOWN = 0.22;  // s between pours
const SPAWN_GRACE = 1.2;      // s of calm after a life loss or a cleared wave
const BANNER_TIME = 1.4;      // s an on-canvas announcement stays up

// --- Difficulty scaling (all pure functions of `wave`) ---
const MUG_BASE = 280, MUG_STEP = 6;                        // full-mug speed
const CUST_BASE = 26, CUST_STEP = 7;                       // customer speed
const SPAWN_BASE = 2.6, SPAWN_STEP = 0.2, SPAWN_MIN = 0.9; // s between arrivals
const MAX_DRINKS = 3;                                      // drinks per customer cap
const WAVE_CUST_BASE = 4;                                  // customers = base + wave

// --- Lives & scoring ---
const START_LIVES = 3;
const MAX_LIVES = 5;
const SERVE_POINTS = 10;  // a customer takes a drink
const LEAVE_POINTS = 50;  // a customer leaves the bar
const EMPTY_POINTS = 5;   // an empty mug is caught
const WAVE_BONUS = 100;   // a wave is cleared

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const waveEl = document.getElementById('wave');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Seeded RNG — lane choice must be reproducible so tests can assert on a wave.
// ---------------------------------------------------------------------------

let rngState = 1;

function setSeed(seed) {
    rngState = seed >>> 0;
}

function rand() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, wave, lives, spawnedThisWave, spawnTimer, serveTimer;
let autoStep = true; // the rAF loop advances the sim (tests switch this off)
const player = { lane: 1 };
const customers = [];
const mugs = [];
const shards = [];                              // broken-glass particles
const banner = { text: '', life: 0 };           // transient on-canvas announcement

// ---------------------------------------------------------------------------
// Difficulty helpers
// ---------------------------------------------------------------------------

function mugSpeed() { return MUG_BASE + (wave - 1) * MUG_STEP; }
function customerSpeed() { return CUST_BASE + (wave - 1) * CUST_STEP; }
function spawnInterval() { return Math.max(SPAWN_MIN, SPAWN_BASE - (wave - 1) * SPAWN_STEP); }
function drinksPerCustomer() { return Math.min(MAX_DRINKS, 1 + Math.floor((wave - 1) / 2)); }
function customersInWave() { return WAVE_CUST_BASE + wave; }

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function setLane(lane) {
    player.lane = Math.max(0, Math.min(LANES - 1, lane));
}

function moveLane(delta) {
    setLane(player.lane + delta);
}

function laneFromY(y) {
    let best = 0;
    for (let i = 1; i < LANES; i++) {
        if (Math.abs(y - LANE_Y[i]) < Math.abs(y - LANE_Y[best])) best = i;
    }
    return best;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function spawnCustomer(opts) {
    opts = opts || {};
    const c = {
        lane: opts.lane != null ? opts.lane : Math.floor(rand() * LANES),
        x: opts.x != null ? opts.x : BAR_LEFT,
        drinks: opts.drinks != null ? opts.drinks : drinksPerCustomer(),
        // Deterministic walk-cycle phase — no RNG, so seeded runs stay stable.
        bob: (customers.length * 0.9 + (opts.lane || 0) * 1.7) % (Math.PI * 2),
    };
    customers.push(c);
    return c;
}

function spawnMug(opts) {
    opts = opts || {};
    const m = {
        lane: opts.lane != null ? opts.lane : player.lane,
        x: opts.x != null ? opts.x : MUG_START_X,
        empty: !!opts.empty,
    };
    mugs.push(m);
    return m;
}

// Pour a mug into the player's lane. Returns false if the game isn't running or
// the tap is still on cooldown.
function serve() {
    if (state !== 'running' || serveTimer > 0) return false;
    spawnMug({ lane: player.lane, x: MUG_START_X, empty: false });
    serveTimer = SERVE_COOLDOWN;
    return true;
}

// A customer takes the drink: knocked back, mug consumed, empty sent back.
function drinkMug(customerIndex, mugIndex) {
    const c = customers[customerIndex];
    const contactX = c.x;
    mugs.splice(mugIndex, 1);
    c.drinks -= 1;
    c.x -= PUSH_BACK;
    score += SERVE_POINTS * wave;
    spawnMug({ lane: c.lane, x: contactX, empty: true });
    if (c.drinks <= 0 || c.x <= BAR_LEFT) {
        customers.splice(customerIndex, 1);
        score += LEAVE_POINTS * wave;
    }
}

// The right-most customer overlapping this mug in its lane, or -1.
function customerHitBy(mug) {
    let found = -1;
    for (let i = 0; i < customers.length; i++) {
        const c = customers[i];
        if (c.lane !== mug.lane) continue;
        if (Math.abs(c.x - mug.x) > HIT_DIST) continue;
        if (found === -1 || c.x > customers[found].x) found = i;
    }
    return found;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    if (serveTimer > 0) serveTimer -= h;

    // Arrivals.
    spawnTimer -= h;
    if (spawnTimer <= 0) {
        if (spawnedThisWave < customersInWave()) {
            spawnCustomer({});
            spawnedThisWave += 1;
        }
        spawnTimer += spawnInterval();
    }

    // Customers advance on the station. Reaching it costs a life, which wipes
    // the bar — so stop scanning immediately.
    const cv = customerSpeed();
    for (const c of customers) {
        c.x += cv * h;
        c.bob += h * 6;
        if (c.x >= GRAB_X) {
            loseLife();
            return;
        }
    }

    // Mugs. Full ones run left toward the customers, empties run back right.
    const mv = mugSpeed();
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        if (m.empty) {
            m.x += EMPTY_SPEED * h;
            if (m.x >= CATCH_X) {
                const caught = m.lane === player.lane;
                mugs.splice(i, 1);
                if (caught) {
                    score += EMPTY_POINTS * wave;
                } else {
                    spawnShards(CATCH_X, LANE_Y[m.lane]);
                    loseLife();
                    return;
                }
            }
        } else {
            m.x -= mv * h;
            const hit = customerHitBy(m);
            if (hit !== -1) {
                drinkMug(hit, i);
            } else if (m.x <= BAR_LEFT) {
                spawnShards(BAR_LEFT, LANE_Y[m.lane]);
                mugs.splice(i, 1);
                loseLife();
                return;
            }
        }
    }

    // Wave cleared once everybody scheduled has been served off the bar.
    if (spawnedThisWave >= customersInWave() && customers.length === 0) {
        completeWave();
    }
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so a fast mug
// can never tunnel through a customer and the result is frame-rate independent.
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
    updateHud();
}

function setAutoStep(on) {
    autoStep = !!on;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    wave = 1;
    lives = START_LIVES;
    spawnedThisWave = 0;
    spawnTimer = SPAWN_GRACE;
    serveTimer = 0;
    customers.length = 0;
    mugs.length = 0;
    shards.length = 0;
    banner.text = '';
    banner.life = 0;
    player.lane = 1;
    hideOverlay();
    updateHud();
}

// Clear the bar, reset this wave's arrivals and hand back a moment of calm.
function loseLife() {
    lives -= 1;
    customers.length = 0;
    mugs.length = 0;
    spawnedThisWave = 0;
    spawnTimer = SPAWN_GRACE;
    serveTimer = 0;
    if (lives <= 0) {
        lives = 0;
        endGame();
    } else {
        announce(lives === 1 ? 'Last life!' : lives + ' lives left');
    }
    updateHud();
}

function completeWave() {
    score += WAVE_BONUS * wave;
    wave += 1;
    lives = Math.min(MAX_LIVES, lives + 1);
    spawnedThisWave = 0;
    spawnTimer = SPAWN_GRACE;
    mugs.length = 0;
    announce('Wave ' + wave);
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('soda-tapper-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Score ' + score + ' · Wave ' + wave, 'Press Space to play again', 'Play Again');
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
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    waveEl.textContent = String(wave);
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
// Broken-glass particles (cosmetic only — never touches game state)
// ---------------------------------------------------------------------------

function announce(text) {
    banner.text = text;
    banner.life = BANNER_TIME;
}

function spawnShards(x, y) {
    for (let i = 0; i < 10; i++) {
        shards.push({
            x, y,
            vx: (Math.random() - 0.5) * 240,
            vy: (Math.random() - 0.5) * 200 - 40,
            life: 0.6,
        });
    }
}

// Cosmetic timers, advanced by the render loop rather than the simulation so
// they keep running (and fading) while the world itself is paused.
function updateShards(dt) {
    if (banner.life > 0) banner.life -= dt;
    for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 700 * dt;
        s.life -= dt;
        if (s.life <= 0) shards.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// The y a mug or a pair of feet rests at: the surface of the counter.
function counterTop(lane) { return LANE_Y[lane] + COUNTER_H / 2 - 6; }

function drawCounters() {
    for (let i = 0; i < LANES; i++) {
        const y = LANE_Y[i];
        const top = y - COUNTER_H / 2;
        const active = i === player.lane;
        const left = BAR_LEFT - 24;
        const width = STATION_X - left + 16;

        // Drain at the far end — where wasted mugs drop off the bar.
        ctx.fillStyle = '#08110e';
        ctx.fillRect(0, top, left, COUNTER_H);
        ctx.fillStyle = '#132420';
        ctx.fillRect(left - 6, top, 6, COUNTER_H);

        // The counter itself: a lit plank with an edge and a shadow beneath.
        const grad = ctx.createLinearGradient(0, top, 0, top + COUNTER_H);
        grad.addColorStop(0, active ? '#8a6531' : '#6a4d26');
        grad.addColorStop(0.72, active ? '#6d4f26' : '#523b1d');
        grad.addColorStop(1, '#2c2114');
        ctx.fillStyle = grad;
        ctx.fillRect(left, top, width, COUNTER_H);
        ctx.fillStyle = active ? '#c79a52' : '#8a6b39';
        ctx.fillRect(left, top, width, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(left, top + COUNTER_H - 4, width, 4);

        // Tap head above the station end of this counter.
        ctx.fillStyle = '#9fb3a8';
        ctx.fillRect(STATION_X - 6, top - 12, 12, 16);
        ctx.fillStyle = active ? '#f4a734' : '#4d6157';
        ctx.fillRect(STATION_X - 4, top - 2, 8, 8);
    }
}

function drawCustomer(c) {
    const base = counterTop(c.lane);
    const sway = Math.sin(c.bob) * 1.5;
    const top = base - CUSTOMER_H;
    const x = c.x + sway;

    ctx.fillStyle = 'rgba(0,0,0,0.3)'; // shadow on the counter
    ctx.fillRect(c.x - CUSTOMER_W / 2, base, CUSTOMER_W, 3);

    ctx.fillStyle = c.drinks > 1 ? '#e5544f' : '#e0913a';
    ctx.fillRect(x - CUSTOMER_W / 2, top, CUSTOMER_W, CUSTOMER_H);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x - CUSTOMER_W / 2, top, CUSTOMER_W, 4);

    ctx.fillStyle = '#f0d9b5'; // head
    ctx.beginPath();
    ctx.arc(x, top - 8, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a1512'; // eyes, facing the taps
    ctx.fillRect(x + 1, top - 10, 3, 3);
    ctx.fillRect(x + 6, top - 10, 3, 3);

    // Thirst pips — one per drink still wanted.
    ctx.fillStyle = '#0a1512';
    const pipW = 5, gap = 3;
    const pipsW = c.drinks * pipW + (c.drinks - 1) * gap;
    for (let i = 0; i < c.drinks; i++) {
        ctx.fillRect(x - pipsW / 2 + i * (pipW + gap), top + 9, pipW, 5);
    }
}

function drawMug(m) {
    const base = counterTop(m.lane);
    const top = base - MUG_H;
    const x = m.x;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x - MUG_W / 2, base, MUG_W, 3);

    ctx.fillStyle = m.empty ? '#3d554d' : '#d8952c';
    ctx.fillRect(x - MUG_W / 2, top, MUG_W, MUG_H);
    if (!m.empty) {
        ctx.fillStyle = '#fdf3d7'; // foam head
        ctx.fillRect(x - MUG_W / 2, top, MUG_W, 6);
    }
    ctx.strokeStyle = m.empty ? '#9fb3a8' : '#f6e2b3';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - MUG_W / 2, top, MUG_W, MUG_H);
    ctx.beginPath(); // handle, trailing the direction of travel
    const hx = m.empty ? x - MUG_W / 2 - 1 : x + MUG_W / 2 + 1;
    ctx.arc(hx, top + MUG_H / 2, 5, m.empty ? Math.PI / 2 : -Math.PI / 2, m.empty ? -Math.PI / 2 : Math.PI / 2);
    ctx.stroke();
    ctx.lineWidth = 1;
}

function drawPlayer() {
    const base = counterTop(player.lane);
    const top = base - 40;
    const x = STATION_X + 20;

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x - 14, base, 28, 3);

    ctx.fillStyle = '#3fbf6d'; // body
    ctx.fillRect(x - 13, top, 26, 40);
    ctx.fillStyle = '#e6f2ec'; // apron
    ctx.fillRect(x - 9, top + 18, 18, 18);
    ctx.fillStyle = '#f0d9b5'; // head
    ctx.beginPath();
    ctx.arc(x, top - 9, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e6f2ec'; // cap
    ctx.fillRect(x - 10, top - 19, 20, 6);
    ctx.fillStyle = '#3fbf6d'; // arm reaching for the tap
    ctx.fillRect(x - 22, top + 6, 10, 6);

    // Tap cooldown readout under the station.
    if (serveTimer > 0) {
        ctx.fillStyle = '#f4a734';
        ctx.fillRect(x - 13, base + 6, 26 * (serveTimer / SERVE_COOLDOWN), 3);
    }
}

function draw() {
    ctx.fillStyle = '#0a1512';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawCounters();
    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m);
    drawPlayer();

    for (const s of shards) {
        ctx.globalAlpha = Math.max(0, s.life / 0.6);
        ctx.fillStyle = '#cfe6dc';
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // Transient announcement (wave cleared / life lost).
    if (banner.life > 0) {
        ctx.globalAlpha = Math.min(1, banner.life / 0.4);
        ctx.fillStyle = '#f4a734';
        ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(banner.text.toUpperCase(), CANVAS_W / 2, CANVAS_H / 2 + 10);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
    }

    // Wave progress strip along the bottom.
    if (state !== 'idle') {
        const total = customersInWave();
        const done = Math.min(total, spawnedThisWave);
        ctx.fillStyle = '#16241e';
        ctx.fillRect(0, CANVAS_H - 8, CANVAS_W, 8);
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(0, CANVAS_H - 8, CANVAS_W * (done / total), 8);
    }
}

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    if (autoStep && state === 'running') step(dt);
    updateShards(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') serve();
        e.preventDefault();
        return;
    }
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        moveLane(-1);
        e.preventDefault();
    } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        moveLane(1);
        e.preventDefault();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    setLane(laneFromY(y));
});

canvas.addEventListener('click', () => {
    if (state === 'idle' || state === 'over') startGame();
    else serve();
});

btnStart.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('soda-tapper-best') || '0', 10) || 0;
state = 'idle';
score = 0;
wave = 1;
lives = START_LIVES;
spawnedThisWave = 0;
spawnTimer = SPAWN_GRACE;
serveTimer = 0;
updateHud();
requestAnimationFrame(frame);
