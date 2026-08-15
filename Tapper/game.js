// ---------------------------------------------------------------------------
// Tapper — serve four bars at once, and never drop a mug.
//
// The whole game is a handful of module-level globals plus a pure-ish `step(dt)`
// that advances the simulation by a fixed amount of time. The animation loop is
// the only thing that calls `step` with real time; the Playwright specs call it
// directly with a fixed `dt`, which is what keeps them deterministic.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const W = canvas.width;
const H = canvas.height;

const LANES = 4;                  // number of bars
const LANE_TOP = 108;             // y of the first bar top
const LANE_H = 92;                // vertical distance between bars
const BAR_H = 16;                 // thickness of the counter itself
const BAR_LEFT = 60;              // far end of a bar (customers enter here)
const BAR_RIGHT = 590;            // tap end of a bar (the barkeep stands here)
const TAP_X = BAR_RIGHT;          // a customer reaching this grabs the barkeep
const CATCH_X = BAR_RIGHT - 46;   // empties are catchable from here rightwards

const CUSTOMER_W = 26;
const CUSTOMER_H = 34;
const MUG_W = 18;
const MUG_H = 16;

const MUG_SPEED = 300;            // full mug, sliding away from the tap
const EMPTY_SPEED = 220;          // empty mug, sliding back toward the tap
const POUR_COOLDOWN = 0.25;       // seconds between pours

const CUSTOMER_SPEED = 26;        // level 1 walking speed, px/s
const CUSTOMER_SPEED_STEP = 7;    // added per level
const CUSTOMER_SPEED_MAX = 78;

const DRINK_SPEEDUP = 1.16;       // each drink makes a customer thirstier (faster)
const SPEEDUP_MAX = 1.9;          // ...up to this multiple of their starting speed

const PUSH_SPEED = 260;           // how fast a served customer slides back
const PUSH_TIME = 0.5;            // how long the slide lasts
const DRINK_TIME = 1.1;           // pause before the empty comes back

const HIT_POINTS = 50;            // a mug caught by a customer
const SERVE_POINTS = 150;         // a customer pushed off the far end
const CATCH_POINTS = 100;         // an empty caught at the tap
const WAVE_BONUS = 300;           // per level, for clearing a wave

const WAVE_BASE = 4;              // customers per wave = WAVE_BASE + 2 * level
const FIRST_SPAWN = 1.0;          // delay before the first customer of a wave
const SPAWN_BASE = 2.6;           // gap between arrivals at level 1
const SPAWN_STEP = 0.15;          // gap reduction per level
const SPAWN_MIN = 0.9;

const WAVE_DELAY = 1.6;           // pause between waves
const RESPAWN_DELAY = 1.2;        // pause after losing a life
const START_LIVES = 3;

const LANE_COLORS = ['#f4b942', '#7fd1ae', '#e2725b', '#9db8f0'];

const LOSS_TEXT = {
    grabbed: 'GRABBED!',
    spilled: 'MUG SPILLED!',
    smashed: 'MUG SMASHED!',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';   // idle | playing | wave | respawn | paused | gameover
let prevState = 'playing';

let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;

let player = { lane: 0 };
let customers = [];
let mugs = [];
let empties = [];

let waveTotal = 0;    // customers to serve this wave
let toSpawn = 0;      // still to walk in
let served = 0;       // already pushed off the far end

let spawnEnabled = true;
let spawnTimer = FIRST_SPAWN;
let pourTimer = 0;
let waveTimer = 0;
let respawnTimer = 0;
let flash = 0;        // brief red tint after losing a life
let lastLoss = '';    // why the last life went: grabbed | spilled | smashed

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function laneY(lane) {
    return LANE_TOP + lane * LANE_H;
}

function customerSpeed(lv) {
    return Math.min(CUSTOMER_SPEED_MAX, CUSTOMER_SPEED + (lv - 1) * CUSTOMER_SPEED_STEP);
}

function spawnInterval(lv) {
    return Math.max(SPAWN_MIN, SPAWN_BASE - (lv - 1) * SPAWN_STEP);
}

function maxOnScreen(lv) {
    return Math.min(6, 2 + lv);
}

// Both spawners are also the specs' way of seeding a scenario, so they take an
// explicit lane and x and return the object they created.
function spawnCustomer(lane, x) {
    const base = customerSpeed(level);
    const c = { lane, x, state: 'walking', timer: 0, speed: base, base, hits: 0 };
    customers.push(c);
    return c;
}

function spawnEmpty(lane, x) {
    const e = { lane, x };
    empties.push(e);
    return e;
}

function pourMug() {
    if (state !== 'playing' || pourTimer > 0) return null;
    pourTimer = POUR_COOLDOWN;
    const m = { lane: player.lane, x: BAR_RIGHT - MUG_W - 6 };
    mugs.push(m);
    return m;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function updateSpawns(dt) {
    if (!spawnEnabled || toSpawn <= 0) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval(level);
    if (customers.length >= maxOnScreen(level)) return;
    toSpawn--;
    spawnCustomer(Math.floor(Math.random() * LANES), BAR_LEFT - CUSTOMER_W);
}

function updateCustomers(dt) {
    for (const c of customers.slice()) {
        if (state !== 'playing') return;

        if (c.state === 'walking') {
            c.x += c.speed * dt;
            if (c.x + CUSTOMER_W >= TAP_X) {
                loseLife('grabbed');
                return;
            }
        } else if (c.state === 'sliding') {
            c.x -= PUSH_SPEED * dt;
            c.timer -= dt;
            if (c.x <= BAR_LEFT - CUSTOMER_W) {
                // Pushed clean off the far end: served, and gone for good.
                remove(customers, c);
                served++;
                score += SERVE_POINTS;
                updateHud();
                continue;
            }
            if (c.timer <= 0) {
                c.state = 'drinking';
                c.timer = DRINK_TIME;
            }
        } else if (c.state === 'drinking') {
            c.timer -= dt;
            if (c.timer <= 0) {
                c.state = 'walking';
                spawnEmpty(c.lane, c.x + CUSTOMER_W / 2);
            }
        }
    }
}

function updateMugs(dt) {
    for (const m of mugs.slice()) {
        if (state !== 'playing') return;
        m.x -= MUG_SPEED * dt;

        // The nearest customer on this bar takes the mug.
        let hit = null;
        for (const c of customers) {
            if (c.lane !== m.lane) continue;
            if (m.x < c.x + CUSTOMER_W && m.x + MUG_W > c.x) {
                if (!hit || c.x > hit.x) hit = c;
            }
        }

        if (hit) {
            remove(mugs, m);
            score += HIT_POINTS;
            hit.state = 'sliding';
            hit.timer = PUSH_TIME;
            // Every drink makes them thirstier: they come back faster, so the
            // same customer cannot be volleyed back and forth indefinitely.
            hit.hits++;
            hit.speed = Math.min(hit.base * SPEEDUP_MAX, hit.speed * DRINK_SPEEDUP);
            updateHud();
            continue;
        }

        if (m.x <= BAR_LEFT - MUG_W) {
            remove(mugs, m);
            loseLife('spilled');
            return;
        }
    }
}

function updateEmpties(dt) {
    for (const e of empties.slice()) {
        if (state !== 'playing') return;
        e.x += EMPTY_SPEED * dt;

        if (e.x >= CATCH_X && player.lane === e.lane) {
            remove(empties, e);
            score += CATCH_POINTS;
            updateHud();
            continue;
        }

        if (e.x >= BAR_RIGHT) {
            remove(empties, e);
            loseLife('smashed');
            return;
        }
    }
}

function checkWave() {
    if (state !== 'playing') return;
    if (served < waveTotal) return;
    if (customers.length || mugs.length || empties.length) return;
    score += WAVE_BONUS * level;
    state = 'wave';
    waveTimer = WAVE_DELAY;
    updateHud();
}

function step(dt) {
    // The damage flash fades through the respawn pause it triggers, not after it.
    if (flash > 0 && state !== 'paused' && state !== 'idle') {
        flash = Math.max(0, flash - dt);
    }

    if (state === 'wave') {
        waveTimer -= dt;
        if (waveTimer <= 0) startWave(level + 1);
        return;
    }
    if (state === 'respawn') {
        respawnTimer -= dt;
        if (respawnTimer <= 0) state = 'playing';
        return;
    }
    if (state !== 'playing') return;

    pourTimer = Math.max(0, pourTimer - dt);

    updateSpawns(dt);
    updateCustomers(dt);
    updateMugs(dt);
    updateEmpties(dt);
    checkWave();
}

function remove(list, item) {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
}

// ---------------------------------------------------------------------------
// Lives, waves, game flow
// ---------------------------------------------------------------------------

function loseLife(reason) {
    if (state === 'gameover') return;
    lastLoss = reason || 'grabbed';
    lives--;
    flash = 0.4;

    // Everyone still on a bar walks out and is queued to come back, so a wave
    // always needs `waveTotal` customers served no matter how it goes.
    toSpawn += customers.length;
    customers = [];
    mugs = [];
    empties = [];
    pourTimer = 0;
    spawnTimer = FIRST_SPAWN;
    updateHud();

    if (lives <= 0) {
        gameOver();
        return;
    }
    state = 'respawn';
    respawnTimer = RESPAWN_DELAY;
}

function startWave(n) {
    level = n;
    waveTotal = WAVE_BASE + n * 2;
    toSpawn = waveTotal;
    served = 0;
    customers = [];
    mugs = [];
    empties = [];
    spawnTimer = FIRST_SPAWN;
    pourTimer = 0;
    state = 'playing';
    updateHud();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    player.lane = 0;
    spawnEnabled = true;
    flash = 0;
    lastLoss = '';
    startWave(1);
    hideOverlay();
    updateHud();
}

function gameOver() {
    state = 'gameover';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('tapper-best', String(best));
        } catch (err) {
            /* storage unavailable — the score just isn't kept */
        }
    }
    updateHud();
    showOverlay('LAST ORDERS', `Game over — you scored ${score}`, 'Press Space to work another shift');
}

function togglePause() {
    if (state === 'playing' || state === 'wave' || state === 'respawn') {
        prevState = state;
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to get back behind the bar');
    } else if (state === 'paused') {
        state = prevState;
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    bestEl.textContent = String(best);
}

function showOverlay(title, sub1, sub2) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub1;
    overlaySub.textContent = sub2;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function draw() {
    ctx.clearRect(0, 0, W, H);
    drawRoom();

    for (let lane = 0; lane < LANES; lane++) drawBar(lane);
    for (const c of customers) drawCustomer(c);
    for (const e of empties) drawMug(e.lane, e.x, true);
    for (const m of mugs) drawMug(m.lane, m.x, false);
    drawStation();
    drawBarkeep();

    if (flash > 0) {
        ctx.fillStyle = `rgba(226, 114, 91, ${0.35 * (flash / 0.4)})`;
        ctx.fillRect(0, 0, W, H);
    }

    if (state === 'wave') banner(`LEVEL ${level + 1}`);
    else if (state === 'respawn') banner(LOSS_TEXT[lastLoss] || 'READY');
}

function drawRoom() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#321d0f');
    g.addColorStop(0.55, '#20120a');
    g.addColorStop(1, '#130b06');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Panelled back wall.
    ctx.strokeStyle = 'rgba(255, 214, 150, 0.045)';
    ctx.lineWidth = 2;
    for (let x = 18; x < W; x += 36) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
    }

    // A pool of lamp light over each bar.
    for (let lane = 0; lane < LANES; lane++) {
        const y = laneY(lane);
        const lamp = ctx.createRadialGradient(W / 2, y - 30, 10, W / 2, y - 10, 300);
        lamp.addColorStop(0, 'rgba(255, 206, 120, 0.13)');
        lamp.addColorStop(1, 'rgba(255, 206, 120, 0)');
        ctx.fillStyle = lamp;
        ctx.fillRect(0, y - 90, W, 110);
    }

    // Sign above the bars.
    ctx.fillStyle = 'rgba(244, 185, 66, 0.8)';
    ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('THE THIRSTY CANVAS', W / 2, 42);
    ctx.textAlign = 'left';

    // Wave progress pips.
    const pips = Math.max(1, waveTotal);
    const pw = Math.min(16, 300 / pips);
    const totalW = pips * pw;
    for (let i = 0; i < pips; i++) {
        const x = W / 2 - totalW / 2 + i * pw;
        ctx.fillStyle = i < served ? '#f4b942' : 'rgba(169, 144, 111, 0.28)';
        ctx.fillRect(x + 1, 56, pw - 3, 5);
    }
}

function drawBar(lane) {
    const y = laneY(lane);
    const left = BAR_LEFT - 30;
    const right = BAR_RIGHT + 12;
    const tint = LANE_COLORS[lane % LANE_COLORS.length];

    // Front face of the counter, with panelling.
    ctx.fillStyle = '#3a2313';
    ctx.fillRect(left, y + BAR_H, right - left, 22);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    for (let x = left + 14; x < right; x += 28) {
        ctx.beginPath();
        ctx.moveTo(x, y + BAR_H + 3);
        ctx.lineTo(x, y + BAR_H + 19);
        ctx.stroke();
    }

    // Counter top.
    const g = ctx.createLinearGradient(0, y, 0, y + BAR_H);
    g.addColorStop(0, '#a56b39');
    g.addColorStop(0.5, '#7a4c26');
    g.addColorStop(1, '#4a2f18');
    ctx.fillStyle = g;
    ctx.fillRect(left, y, right - left, BAR_H);

    // Polished edge in the lane's colour, brightest under the lamp.
    ctx.fillStyle = tint;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(left, y, right - left, 3);
    ctx.globalAlpha = 1;

    // Brass foot rail below the counter.
    ctx.strokeStyle = 'rgba(201, 162, 39, 0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(left + 6, y + BAR_H + 26);
    ctx.lineTo(right - 6, y + BAR_H + 26);
    ctx.stroke();

    // The doorway customers walk in from.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, y - CUSTOMER_H - 14, left, CUSTOMER_H + 14 + BAR_H);
    ctx.fillStyle = 'rgba(244, 185, 66, 0.10)';
    ctx.fillRect(left - 3, y - CUSTOMER_H - 14, 3, CUSTOMER_H + 14);

    // Catch zone hint.
    ctx.strokeStyle = 'rgba(244, 185, 66, 0.16)';
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CATCH_X, y - 34);
    ctx.lineTo(CATCH_X, y + BAR_H);
    ctx.stroke();
    ctx.setLineDash([]);
}

// The brass tap station the barkeep works behind, drawn over the bars.
function drawStation() {
    const x = BAR_RIGHT + 12;

    ctx.fillStyle = 'rgba(30, 17, 9, 0.92)';
    ctx.fillRect(x, 70, W - x, H - 70);
    ctx.fillStyle = 'rgba(201, 162, 39, 0.25)';
    ctx.fillRect(x, 70, 2, H - 70);

    for (let lane = 0; lane < LANES; lane++) {
        const y = laneY(lane);

        // Tap body and spout.
        ctx.fillStyle = '#c9a227';
        ctx.fillRect(BAR_RIGHT - 2, y - 40, 9, 30);
        ctx.fillRect(BAR_RIGHT - 8, y - 16, 15, 6);
        // Handle.
        ctx.fillStyle = '#e2725b';
        ctx.fillRect(BAR_RIGHT + 1, y - 50, 3, 12);
        ctx.beginPath();
        ctx.arc(BAR_RIGHT + 2.5, y - 52, 4, 0, Math.PI * 2);
        ctx.fill();

        // A spurt of beer just after pouring on this bar.
        if (lane === player.lane && pourTimer > POUR_COOLDOWN * 0.55) {
            ctx.fillStyle = 'rgba(244, 185, 66, 0.85)';
            ctx.fillRect(BAR_RIGHT - 2, y - 12, 4, 12);
        }
    }
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const top = y - CUSTOMER_H;
    const drinking = c.state === 'drinking';
    const sliding = c.state === 'sliding';
    // Deterministic walk bob: driven by position, never by wall-clock time.
    const bob = drinking || sliding ? 0 : Math.abs(Math.sin(c.x / 9)) * 2;
    const ty = top + bob;

    // Shadow on the counter.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(c.x + CUSTOMER_W / 2, y + 3, CUSTOMER_W / 2, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs.
    ctx.fillStyle = '#3d2a4a';
    ctx.fillRect(c.x + 5, ty + CUSTOMER_H - 9, 6, 9);
    ctx.fillRect(c.x + CUSTOMER_W - 11, ty + CUSTOMER_H - 9, 6, 9);

    // Coat. Thirstier customers (more drinks) wear a hotter colour.
    const heat = Math.min(1, c.hits / 4);
    const coat = sliding
        ? '#c76b4a'
        : drinking
            ? '#d8a24a'
            : `rgb(${Math.round(150 + 70 * heat)}, ${Math.round(86 - 26 * heat)}, ${Math.round(58 - 10 * heat)})`;
    ctx.fillStyle = coat;
    roundRect(c.x, ty + 11, CUSTOMER_W, CUSTOMER_H - 20, 5);
    ctx.fill();

    // Head and flat cap.
    ctx.fillStyle = '#f0cfa8';
    ctx.beginPath();
    ctx.arc(c.x + CUSTOMER_W / 2, ty + 6, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f2438';
    roundRect(c.x + 3, ty - 2, CUSTOMER_W - 6, 5, 2);
    ctx.fill();

    // Arm — holding a mug while drinking, reaching out otherwise.
    ctx.strokeStyle = coat;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c.x + CUSTOMER_W - 3, ty + 15);
    ctx.lineTo(c.x + CUSTOMER_W + (drinking ? 2 : 7), ty + (drinking ? 10 : 18));
    ctx.stroke();

    if (drinking) {
        ctx.fillStyle = '#e8b849';
        roundRect(c.x + CUSTOMER_W - 1, ty + 5, 8, 9, 2);
        ctx.fill();
        ctx.fillStyle = '#fff6e2';
        ctx.fillRect(c.x + CUSTOMER_W - 1, ty + 3, 8, 2);
    }

    if (sliding) {
        ctx.strokeStyle = 'rgba(244, 185, 66, 0.5)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
            const sy = ty + 14 + i * 6;
            ctx.beginPath();
            ctx.moveTo(c.x + CUSTOMER_W + 4 + i * 3, sy);
            ctx.lineTo(c.x + CUSTOMER_W + 14 + i * 3, sy);
            ctx.stroke();
        }
    }

    // Impatience bar: how far along the counter they have got.
    const t = Math.max(0, Math.min(1, (c.x - BAR_LEFT) / (TAP_X - BAR_LEFT)));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(c.x, ty - 10, CUSTOMER_W, 3);
    ctx.fillStyle = `rgb(${Math.round(120 + 135 * t)}, ${Math.round(200 - 140 * t)}, 90)`;
    ctx.fillRect(c.x, ty - 10, CUSTOMER_W * t, 3);
}

function drawMug(lane, x, isEmpty) {
    const bodyW = MUG_W - 4;
    const y = laneY(lane) - MUG_H;

    // Shadow.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x + bodyW / 2, laneY(lane) + 2, bodyW / 2, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const g = ctx.createLinearGradient(x, y, x + bodyW, y);
    if (isEmpty) {
        g.addColorStop(0, '#9c8a6d');
        g.addColorStop(1, '#6e5c45');
    } else {
        g.addColorStop(0, '#f6cf6a');
        g.addColorStop(1, '#d99a24');
    }
    ctx.fillStyle = g;
    roundRect(x, y, bodyW, MUG_H, 3);
    ctx.fill();

    // Handle.
    ctx.strokeStyle = isEmpty ? '#8e7a5e' : '#d99a24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + bodyW, y + MUG_H / 2, 4, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    if (!isEmpty) {
        ctx.fillStyle = '#fff6e2';
        roundRect(x - 1, y - 4, bodyW + 2, 5, 2);
        ctx.fill();
    } else {
        // A dribble left in the bottom of the empty.
        ctx.fillStyle = 'rgba(244, 185, 66, 0.35)';
        ctx.fillRect(x + 2, y + MUG_H - 4, bodyW - 4, 3);
    }
}

function drawBarkeep() {
    const y = laneY(player.lane);
    const x = BAR_RIGHT + 20;
    const pouring = pourTimer > POUR_COOLDOWN * 0.4;

    // Shadow.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x + 11, y + 4, 15, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shirt and apron.
    ctx.fillStyle = '#f6e7cf';
    roundRect(x, y - 36, 23, 30, 5);
    ctx.fill();
    ctx.fillStyle = '#f4b942';
    roundRect(x, y - 20, 23, 16, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(x, y - 20, 23, 2);

    // Head, moustache and cap.
    ctx.fillStyle = '#e8c9a0';
    ctx.beginPath();
    ctx.arc(x + 11, y - 44, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a3524';
    ctx.fillRect(x + 6, y - 42, 10, 2);
    roundRect(x + 2, y - 52, 18, 5, 2);
    ctx.fill();

    // Arm working the tap.
    ctx.strokeStyle = '#f6e7cf';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 3, y - 30);
    ctx.lineTo(x - 12, pouring ? y - 44 : y - 24);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Which bar you are on, marked on the station.
    ctx.fillStyle = LANE_COLORS[player.lane % LANE_COLORS.length];
    ctx.fillRect(W - 6, y - 46, 4, 46);
}

function banner(text) {
    ctx.fillStyle = 'rgba(20, 10, 5, 0.72)';
    ctx.fillRect(0, H / 2 - 34, W, 68);
    ctx.fillStyle = '#f4b942';
    ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, H / 2 + 12);
    ctx.textAlign = 'left';
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    const key = e.key;

    if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else if (state === 'playing') pourMug();
        return;
    }

    if (key === 'p' || key === 'P') {
        togglePause();
        return;
    }

    if (state !== 'playing') return;

    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        e.preventDefault();
        player.lane = Math.max(0, player.lane - 1);
    } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
        e.preventDefault();
        player.lane = Math.min(LANES - 1, player.lane + 1);
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
    best = parseInt(localStorage.getItem('tapper-best') || '0', 10) || 0;
} catch (err) {
    best = 0;
}

state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
waveTotal = WAVE_BASE + 2;
toSpawn = 0;
served = 0;
updateHud();
showOverlay('TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
