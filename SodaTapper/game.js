// ---------------------------------------------------------------------------
// Soda Tapper — a four-lane bar-service arcade game on an HTML5 canvas.
//
// The player is a soda jerk working four bars at once. Thirsty customers walk in
// from the door end of each bar and advance toward the tap; the player slides
// full mugs down a bar to push them back, then catches the empties they send
// sailing back. Written as a single classic (non-module) script so the game
// state and logic are reachable from the Playwright tests as plain globals,
// mirroring Kaboom, Dino Run and Tetris in this repo. All motion is expressed
// per-second and advanced through `step(dt)`, so the tests can simulate frames
// deterministically without depending on requestAnimationFrame wall-clock
// timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 400;

const LANE_COUNT = 4;
const LANE_TOP = 48;           // y of the first bar
const LANE_H = 84;             // vertical spacing between bars
const LANE_LEFT = 40;          // x of the door end of every bar
const BAR_X = 540;             // x of the tap end of every bar

// --- Customers ---
const CUST_W = 26;
const CUST_H = 44;
const PUSH_BACK = 190;         // how far one mug shoves a customer back
const DRINK_TIME = 0.35;       // seconds a customer stands still after drinking

// --- Mugs ---
const MUG_R = 8;
const MUG_SPEED = 360;         // full mugs sliding away from the tap (px/s)
const EMPTY_SPEED = 170;       // empties sliding back toward the tap (px/s)
const POUR_COOLDOWN = 0.25;    // seconds between pours

// --- Difficulty scaling (all pure functions of `wave`) ---
// Walk speed ramps but is capped: a customer who outruns the mug economy makes
// the bar unwinnable rather than hard, so late waves press with volume instead.
const CUST_BASE = 30, CUST_STEP = 9, CUST_MAX = 140;
const SPAWN_BASE = 3.0, SPAWN_STEP = 0.3, SPAWN_MIN = 0.8;  // seconds between arrivals

// Impatience. A wave normally runs 10–25 s. A good enough player can otherwise
// juggle four customers just short of the tap indefinitely — every mug pushes
// somebody back, nobody is ever served, and the wave never ends. After the grace
// period the remaining crowd gets restless and speeds up without limit, so a
// wave always resolves one way or the other.
const IMPATIENCE_GRACE = 22;   // seconds of a wave before the crowd gets restless
const IMPATIENCE_RATE = 8;     // extra px/s of walk speed per second after that

const CUSTOMERS_PER_WAVE = 6;  // serve this many to clear a wave
const START_LIVES = 3;
const MAX_LIVES = 5;

const SERVE_POINTS = 10;       // per wave, for pushing a customer out of the door
const CATCH_POINTS = 5;        // per wave, for catching an empty at the tap

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

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, wave, lives;
// `servedThisWave` counts happy customers (it drives the score); `resolvedThisWave`
// counts every customer the wave is finished with — served *or* walked through to
// the tap — so a wave can never stall on a customer who slipped past.
let servedThisWave, resolvedThisWave, spawnedThisWave, spawnTimer, pourTimer, waveElapsed;
const player = { lane: 0 };
const customers = [];   // { lane, x, drink }  — walking right, toward the tap
const mugs = [];        // { lane, x }         — full, sliding left
const empties = [];     // { lane, x }         — empty, sliding right
const splashes = [];    // cosmetic only

// ---------------------------------------------------------------------------
// Geometry & difficulty helpers
// ---------------------------------------------------------------------------

function laneY(i) { return LANE_TOP + i * LANE_H + LANE_H / 2; }

function impatience() { return Math.max(0, waveElapsed - IMPATIENCE_GRACE) * IMPATIENCE_RATE; }

function customerSpeed() {
    return Math.min(CUST_MAX, CUST_BASE + (wave - 1) * CUST_STEP) + impatience();
}
function spawnInterval() { return Math.max(SPAWN_MIN, SPAWN_BASE - (wave - 1) * SPAWN_STEP); }
function pointsPerServe() { return SERVE_POINTS * wave; }
function pointsPerCatch() { return CATCH_POINTS * wave; }

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function setPlayerLane(lane) {
    player.lane = Math.max(0, Math.min(LANE_COUNT - 1, Math.round(lane)));
}

function movePlayer(dir) {
    setPlayerLane(player.lane + dir);
}

// The player-facing pour: respects the tap cooldown and uses the current lane.
function pourMug() {
    if (state !== 'running') return null;
    if (pourTimer > 0) return null;
    pourTimer = POUR_COOLDOWN;
    return spawnMug({ lane: player.lane, x: BAR_X });
}

// ---------------------------------------------------------------------------
// Spawners (raw — no cooldown, no state check, so tests can set up a board)
// ---------------------------------------------------------------------------

function spawnCustomer(opts) {
    opts = opts || {};
    const lane = opts.lane != null ? opts.lane : Math.floor(Math.random() * LANE_COUNT);
    const x = opts.x != null ? opts.x : LANE_LEFT;
    customers.push({ lane, x, drink: 0 });
    return customers[customers.length - 1];
}

function spawnMug(opts) {
    opts = opts || {};
    const lane = opts.lane != null ? opts.lane : player.lane;
    const x = opts.x != null ? opts.x : BAR_X;
    mugs.push({ lane, x });
    return mugs[mugs.length - 1];
}

function spawnEmpty(opts) {
    opts = opts || {};
    const lane = opts.lane != null ? opts.lane : player.lane;
    const x = opts.x != null ? opts.x : LANE_LEFT;
    empties.push({ lane, x });
    return empties[empties.length - 1];
}

// Test/setup helper: stop the wave from sending any more customers in.
function stopSpawning() {
    spawnedThisWave = CUSTOMERS_PER_WAVE;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

function serveCustomer(index) {
    customers.splice(index, 1);
    score += pointsPerServe();
    servedThisWave += 1;
    resolvedThisWave += 1;
    if (resolvedThisWave >= CUSTOMERS_PER_WAVE) completeWave();
}

// A mug catching up with a customer: they drink it, get shoved back toward the
// door, and send the empty sliding back up the bar.
function hitCustomer(index) {
    const c = customers[index];
    c.x -= PUSH_BACK;
    c.drink = DRINK_TIME;
    spawnEmpty({ lane: c.lane, x: Math.max(LANE_LEFT, c.x) });
    splash(Math.max(LANE_LEFT, c.x), laneY(c.lane));
    if (c.x <= LANE_LEFT) serveCustomer(index);
}

// Any mishap costs a life and sweeps the bars clear of loose glassware.
function loseLife() {
    lives -= 1;
    mugs.length = 0;
    empties.length = 0;
    if (lives <= 0) {
        lives = 0;
        endGame();
    }
    updateHud();
}

function completeWave() {
    wave += 1;
    servedThisWave = 0;
    resolvedThisWave = 0;
    spawnedThisWave = 0;
    customers.length = 0;
    mugs.length = 0;
    empties.length = 0;
    spawnTimer = spawnInterval();
    waveElapsed = 0;
    lives = Math.min(MAX_LIVES, lives + 1);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

// Picks an empty lane for the next arrival — one customer per bar at a time.
//
// This is deliberate, not just tidiness. Two customers sharing a bar livelock:
// a mug is spent on whichever is nearest the tap, so each customer only gets
// every other mug while both walk forward the whole time. Past a certain walk
// speed the pair settles into an orbit that is never served and never reaches
// the tap, and the wave can never end. One per bar makes every mug count, so a
// bar the player is actively working always converges.
function pickSpawnLane() {
    const free = [];
    for (let i = 0; i < LANE_COUNT; i++) {
        if (!customers.some((c) => c.lane === i)) free.push(i);
    }
    if (free.length === 0) return -1;
    return free[Math.floor(Math.random() * free.length)];
}

function substep(h) {
    waveElapsed += h;
    if (pourTimer > 0) pourTimer = Math.max(0, pourTimer - h);

    // New arrivals.
    if (spawnedThisWave < CUSTOMERS_PER_WAVE) {
        spawnTimer -= h;
        if (spawnTimer <= 0) {
            const lane = pickSpawnLane();
            if (lane >= 0) {
                spawnCustomer({ lane, x: LANE_LEFT });
                spawnedThisWave += 1;
                spawnTimer += spawnInterval();
            } else {
                spawnTimer = 0.25; // all doorways busy — try again shortly
            }
        }
    }

    // Customers walk toward the tap.
    const cv = customerSpeed();
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        if (c.drink > 0) {
            c.drink -= h;
            continue;
        }
        c.x += cv * h;
        if (c.x >= BAR_X) {
            customers.splice(i, 1);
            resolvedThisWave += 1;
            loseLife();   // clears the bars, so stop scanning this sub-step
            if (state === 'running' && resolvedThisWave >= CUSTOMERS_PER_WAVE) completeWave();
            return;
        }
    }

    // Full mugs slide down the bar.
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x -= MUG_SPEED * h;

        // The mug meets the customer nearest the tap in its lane.
        let target = -1;
        for (let j = 0; j < customers.length; j++) {
            const c = customers[j];
            if (c.lane !== m.lane) continue;
            if (m.x - MUG_R > c.x + CUST_W / 2) continue;
            if (target === -1 || c.x > customers[target].x) target = j;
        }
        if (target !== -1) {
            mugs.splice(i, 1);
            hitCustomer(target);
            // Serving can complete the wave, which sweeps every array clear —
            // including the list we are half-way through scanning. The next
            // index this loop reads is i-1, so it is only safe to carry on
            // while that index still exists.
            if (state !== 'running' || i > mugs.length) return;
            continue;
        }

        if (m.x < LANE_LEFT - MUG_R) {
            loseLife();   // smashed on the floor by the door
            return;
        }
    }

    // Empties sail back toward the tap.
    for (let i = empties.length - 1; i >= 0; i--) {
        const e = empties[i];
        e.x += EMPTY_SPEED * h;
        if (e.x >= BAR_X) {
            if (e.lane === player.lane) {
                empties.splice(i, 1);
                score += pointsPerCatch();
            } else {
                splash(BAR_X, laneY(e.lane));
                loseLife();   // nobody there to catch it
                return;
            }
        }
    }
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so mug/customer
// crossings are never skipped and the integration is resolution-independent.
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

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    wave = 1;
    lives = START_LIVES;
    servedThisWave = 0;
    resolvedThisWave = 0;
    spawnedThisWave = 0;
    customers.length = 0;
    mugs.length = 0;
    empties.length = 0;
    splashes.length = 0;
    player.lane = 0;
    spawnTimer = 1.0;
    pourTimer = 0;
    waveElapsed = 0;
    hideOverlay();
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('soda-tapper-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Last Call', 'Score ' + score + ' · Wave ' + wave, 'Press Space to play again', 'Play Again');
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
// Splashes (purely cosmetic)
// ---------------------------------------------------------------------------

function splash(x, y) {
    for (let i = 0; i < 8; i++) {
        splashes.push({
            x, y,
            vx: (Math.random() - 0.5) * 160,
            vy: (Math.random() - 0.5) * 160 - 40,
            life: 0.45,
        });
    }
}

function updateSplashes(dt) {
    for (let i = splashes.length - 1; i >= 0; i--) {
        const p = splashes[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 380 * dt;
        p.life -= dt;
        if (p.life <= 0) splashes.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawBar(lane) {
    const y = laneY(lane);
    const x0 = LANE_LEFT - 30;
    const w = BAR_X - LANE_LEFT + 60;

    // Wall behind the bar, brighter on the lane the player is standing at.
    ctx.fillStyle = lane === player.lane ? '#241813' : '#1b120e';
    ctx.fillRect(0, y - LANE_H / 2 + 4, CANVAS_W, LANE_H - 8);

    // Doorway the customers walk in through.
    ctx.fillStyle = '#0a0605';
    ctx.fillRect(0, y - 30, x0, 46);
    ctx.strokeStyle = '#3d2a1d';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, y - 30, x0, 46);
    ctx.lineWidth = 1;

    // Counter top with a darker front edge.
    ctx.fillStyle = '#8a5730';
    ctx.fillRect(x0, y + 15, w, 11);
    ctx.fillStyle = '#c98b4b';
    ctx.fillRect(x0, y + 15, w, 3);
    ctx.fillStyle = '#4c2d17';
    ctx.fillRect(x0, y + 26, w, 6);
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const body = c.drink > 0 ? '#8fd6a0' : '#e2574c';
    // Legs.
    ctx.fillStyle = '#2b1d14';
    ctx.fillRect(c.x - 8, y + 2, 5, 12);
    ctx.fillRect(c.x + 3, y + 2, 5, 12);
    // Torso.
    ctx.fillStyle = body;
    ctx.fillRect(c.x - CUST_W / 2, y - CUST_H / 2 + 12, CUST_W, CUST_H / 2 + 2);
    // Head.
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(c.x, y - CUST_H / 2 + 6, 8, 0, Math.PI * 2);
    ctx.fill();
    // Eyes, facing the tap.
    ctx.fillStyle = '#2b1d14';
    ctx.fillRect(c.x + 1, y - CUST_H / 2 + 3, 2, 3);
    ctx.fillRect(c.x + 5, y - CUST_H / 2 + 3, 2, 3);

    // Once the crowd turns restless, mark it so the speed-up isn't a mystery.
    if (impatience() > 0) {
        ctx.fillStyle = '#ffcf5c';
        ctx.fillRect(c.x - 1, y - CUST_H / 2 - 16, 3, 8);
        ctx.fillRect(c.x - 1, y - CUST_H / 2 - 6, 3, 3);
    }
}

function drawMug(x, y, full) {
    const w = MUG_R * 2;
    const h = MUG_R * 2 + 4;
    const top = y + 15 - h;   // mugs sit on the counter top

    ctx.lineWidth = 2;

    // Handle.
    ctx.strokeStyle = full ? '#e6b877' : '#8f9a92';
    ctx.strokeRect(x + w / 2, top + 5, 5, 8);

    // Glass — a full mug is amber with a foam head, an empty one is clear.
    ctx.fillStyle = full ? '#e08c1e' : 'rgba(206, 222, 214, 0.30)';
    ctx.fillRect(x - w / 2, top, w, h);
    if (full) {
        ctx.fillStyle = '#fff6e2';
        ctx.fillRect(x - w / 2, top, w, 5);
    }
    ctx.strokeStyle = full ? '#ffd9a0' : '#98a89f';
    ctx.strokeRect(x - w / 2, top, w, h);

    ctx.lineWidth = 1;
}

function drawPlayer() {
    const y = laneY(player.lane);
    // Apron / body behind the tap.
    ctx.fillStyle = '#f2a541';
    ctx.fillRect(BAR_X + 14, y - 16, 22, 32);
    ctx.fillStyle = '#fff6e2';
    ctx.fillRect(BAR_X + 14, y - 4, 22, 20);   // apron
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(BAR_X + 25, y - 25, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b1d14';                 // eyes, watching the bar
    ctx.fillRect(BAR_X + 17, y - 28, 2, 3);
    ctx.fillRect(BAR_X + 22, y - 28, 2, 3);
    // Arm reaching for the tap.
    ctx.fillStyle = '#f0c9a0';
    ctx.fillRect(BAR_X - 2, y - 8, 18, 6);
}

// The back shelf above the top bar and the floor strip below the bottom one —
// pure scenery, so the play area fills the canvas.
function drawBackdrop() {
    ctx.fillStyle = '#1b120e';
    ctx.fillRect(0, 0, CANVAS_W, LANE_TOP + 4);

    const bottles = ['#e08c1e', '#8fd6a0', '#e2574c', '#f2a541', '#c98b4b'];
    for (let i = 0; i < 14; i++) {
        const x = 22 + i * 41;
        ctx.fillStyle = bottles[i % bottles.length];
        ctx.fillRect(x, LANE_TOP - 26, 9, 20);
        ctx.fillRect(x + 3, LANE_TOP - 32, 3, 6);
    }

    ctx.fillStyle = '#4c2d17';
    ctx.fillRect(0, LANE_TOP - 6, CANVAS_W, 6);

    const floorY = laneY(LANE_COUNT - 1) + LANE_H / 2 - 4;
    ctx.fillStyle = '#1b120e';
    ctx.fillRect(0, floorY, CANVAS_W, CANVAS_H - floorY);
}

function draw() {
    ctx.fillStyle = '#120c08';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawBackdrop();
    for (let i = 0; i < LANE_COUNT; i++) drawBar(i);

    // Tap heads — the one the player is standing at is lit.
    for (let i = 0; i < LANE_COUNT; i++) {
        const y = laneY(i);
        ctx.fillStyle = i === player.lane ? '#f2a541' : '#6b5540';
        ctx.fillRect(BAR_X + 2, y - 24, 7, 26);
        ctx.fillRect(BAR_X - 2, y - 24, 14, 5);
    }

    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m.x, laneY(m.lane), true);
    for (const e of empties) drawMug(e.x, laneY(e.lane), false);

    for (const p of splashes) {
        ctx.globalAlpha = Math.max(0, p.life * 2);
        ctx.fillStyle = '#f2a541';
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    drawPlayer();
}

// ---------------------------------------------------------------------------
// Main loop (real-time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    if (state === 'running') step(dt);
    updateSplashes(dt);
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
        else if (state === 'running') pourMug();
        e.preventDefault();
        return;
    }
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        movePlayer(-1);
        e.preventDefault();
    } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        movePlayer(1);
        e.preventDefault();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    setPlayerLane(Math.floor((y - LANE_TOP) / LANE_H));
});

canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (state === 'idle' || state === 'over') startGame();
    else pourMug();
});

btnStart.addEventListener('click', () => {
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
servedThisWave = 0;
resolvedThisWave = 0;
spawnedThisWave = 0;
spawnTimer = SPAWN_BASE;
pourTimer = 0;
waveElapsed = 0;
updateHud();
requestAnimationFrame(frame);
