// ---------------------------------------------------------------------------
// Tapper — four bars, one barkeep, a lot of thirsty patrons.
//
// The whole game lives in the global script scope on purpose: the Playwright
// suite reaches in by name (state, customers, step, serve, ...) and drives the
// simulation itself. See DESIGN.md for the rules and the testing hooks.
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

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

const LANES = 4;
const BAR_LEFT = 40;
const BAR_RIGHT = 600;
const BAR_TOP = 90;
const LANE_GAP = 100;
const COUNTER_H = 16;

const CUSTOMER_W = 26;
const CUSTOMER_H = 44;
const MUG_W = 14;
const MUG_H = 16;

const MUG_SPEED = 300;        // full mug, sliding away from the barkeep
const EMPTY_MUG_SPEED = 170;  // empty mug, coming back
const LEAVE_SPEED = 90;       // a satisfied patron heading for the door

const PUSH_BACK = 70;
const DRINK_TIME = 2.4;
const SERVE_COOLDOWN = 0.22;
const DYING_TIME = 2.5;
const LEVELUP_TIME = 1.4;
const FIRST_SPAWN = 1.2;
const START_LIVES = 3;

const SCORE_SIP = 25;
const SCORE_SERVED = 100;
const SCORE_CATCH = 50;
const LEVEL_BONUS = 200;

const BEST_KEY = 'tapper-best';

const SHIRTS = ['#c9553f', '#4d84c4', '#5aa86b', '#a86bc4', '#c9a13f'];

const laneY = (lane) => BAR_TOP + lane * LANE_GAP;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';         // idle | running | paused | dying | levelup | over
let score = 0;
let lives = START_LIVES;
let level = 1;
let best = 0;

let bartender = { lane: 0, pour: 0 };
let customers = [];
let mugs = [];
let emptyMugs = [];
let flashes = [];

let serveCooldown = 0;
let spawnTimer = FIRST_SPAWN;
let spawnedThisLevel = 0;
let levelCustomers = 6;
let dyingTimer = 0;
let levelTimer = 0;
let shakeTimer = 0;

// Testing hooks — see DESIGN.md.
let autoStep = true;
let spawnEnabled = true;
let rngSeed = 0x9e3779b9;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// mulberry32 — small, seeded, reproducible.
function rng() {
    rngSeed = (rngSeed + 0x6d2b79f5) | 0;
    let t = rngSeed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const customersForLevel = (lvl) => 4 + lvl * 2;
const customerSpeed = () => 26 + (level - 1) * 6;
const customerNeed = () => Math.min(3, 1 + Math.floor((level - 1) / 2));
const spawnInterval = () => Math.max(0.9, 2.6 - level * 0.15) * (0.75 + rng() * 0.5);

function flash(text, x, y, color) {
    flashes.push({ text, x, y, color: color || '#ffc247', life: 0.9 });
}

function spawnCustomer(lane, need) {
    customers.push({
        lane,
        x: BAR_LEFT + 4,
        mugs: 0,
        need: need || customerNeed(),
        state: 'walking',
        drinkTimer: 0,
        shirt: SHIRTS[Math.floor(rng() * SHIRTS.length) % SHIRTS.length],
        bob: rng() * Math.PI * 2,
    });
    spawnedThisLevel++;
}

// Pick a lane whose entrance is clear, so patrons never spawn on top of each
// other. Returns -1 when every lane is busy and the spawn should wait.
function pickLane() {
    const order = [];
    for (let i = 0; i < LANES; i++) order.push(i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    for (const lane of order) {
        const busy = customers.some((c) => c.lane === lane && c.x < BAR_LEFT + 90);
        if (!busy) return lane;
    }
    return -1;
}

function serve() {
    if (state !== 'running' || serveCooldown > 0) return;
    mugs.push({ lane: bartender.lane, x: BAR_RIGHT - 34, spin: 0 });
    serveCooldown = SERVE_COOLDOWN;
    bartender.pour = 0.18;
}

function spawnEmptyMug(lane, x) {
    emptyMugs.push({ lane, x, spin: 0 });
}

function moveBartender(delta) {
    if (state !== 'running') return;
    bartender.lane = Math.max(0, Math.min(LANES - 1, bartender.lane + delta));
}

function loseLife(text, lane, x) {
    lives--;
    customers = [];
    mugs = [];
    emptyMugs = [];
    shakeTimer = 0.35;
    if (typeof lane === 'number') flash(text, x, laneY(lane) - 30, '#e2574c');
    updateHud();
    if (lives <= 0) {
        state = 'over';
        if (score > best) {
            best = score;
            try {
                localStorage.setItem(BEST_KEY, String(best));
            } catch (err) {
                /* storage unavailable — keep the score in memory only */
            }
            updateHud();
        }
        showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space to play again');
    } else {
        state = 'dying';
        dyingTimer = DYING_TIME;
    }
}

// A lost life restarts the current wave; the score already earned is kept.
function resetWave() {
    spawnedThisLevel = 0;
    spawnTimer = FIRST_SPAWN;
    serveCooldown = 0;
}

function nextLevel() {
    level++;
    levelCustomers = customersForLevel(level);
    resetWave();
    state = 'running';
    updateHud();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        dyingTimer -= dt;
        if (dyingTimer <= 0) {
            resetWave();
            state = 'running';
        }
        return;
    }
    if (state === 'levelup') {
        levelTimer -= dt;
        if (levelTimer <= 0) nextLevel();
        return;
    }
    if (state !== 'running') return;

    serveCooldown = Math.max(0, serveCooldown - dt);
    bartender.pour = Math.max(0, bartender.pour - dt);
    shakeTimer = Math.max(0, shakeTimer - dt);

    for (const f of flashes) f.life -= dt;
    flashes = flashes.filter((f) => f.life > 0);

    if (spawnEnabled && spawnedThisLevel < levelCustomers) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            const lane = pickLane();
            if (lane >= 0) spawnCustomer(lane);
            spawnTimer = lane >= 0 ? spawnInterval() : 0.4;
        }
    }

    stepMugs(dt);
    if (state !== 'running') return;

    stepCustomers(dt);
    if (state !== 'running') return;

    stepEmptyMugs(dt);
    if (state !== 'running') return;

    if (spawnedThisLevel >= levelCustomers && !customers.length && !mugs.length && !emptyMugs.length) {
        score += LEVEL_BONUS * level;
        state = 'levelup';
        levelTimer = LEVELUP_TIME;
        updateHud();
    }
}

function stepMugs(dt) {
    for (const mug of mugs) {
        mug.x -= MUG_SPEED * dt;
        mug.spin += dt * 8;

        // The right-most patron on this bar gets first refusal.
        let target = null;
        for (const c of customers) {
            if (c.lane !== mug.lane || c.state === 'leaving') continue;
            if (mug.x > c.x + CUSTOMER_W || mug.x + MUG_W < c.x) continue;
            if (!target || c.x > target.x) target = c;
        }

        if (target) {
            mug.done = true;
            target.mugs++;
            if (target.mugs >= target.need) {
                target.state = 'leaving';
                spawnEmptyMug(target.lane, target.x);
                score += SCORE_SERVED;
                flash(`+${SCORE_SERVED}`, target.x, laneY(target.lane) - 60);
            } else {
                target.state = 'drinking';
                target.drinkTimer = DRINK_TIME;
                target.x = Math.max(BAR_LEFT + 4, target.x - PUSH_BACK);
                score += SCORE_SIP;
                flash(`+${SCORE_SIP}`, target.x, laneY(target.lane) - 60);
            }
            updateHud();
        } else if (mug.x <= BAR_LEFT) {
            // loseLife clears every bar, this mug included.
            loseLife('SMASH!', mug.lane, BAR_LEFT + 40);
            return;
        }
    }
    mugs = mugs.filter((m) => !m.done);
}

function stepCustomers(dt) {
    const speed = customerSpeed();
    for (const c of customers) {
        c.bob += dt * 6;
        if (c.state === 'drinking') {
            c.drinkTimer -= dt;
            if (c.drinkTimer <= 0) c.state = 'walking';
            continue;
        }
        if (c.state === 'leaving') {
            c.x -= LEAVE_SPEED * dt;
            if (c.x + CUSTOMER_W < BAR_LEFT) c.done = true;
            continue;
        }
        c.x += speed * dt;
        if (c.x + CUSTOMER_W >= BAR_RIGHT) {
            loseLife('GRABBED!', c.lane, BAR_RIGHT - 90);
            return;
        }
    }
    customers = customers.filter((c) => !c.done);
}

function stepEmptyMugs(dt) {
    for (const mug of emptyMugs) {
        mug.x += EMPTY_MUG_SPEED * dt;
        mug.spin += dt * 6;
        if (mug.x < BAR_RIGHT) continue;

        if (bartender.lane === mug.lane) {
            mug.done = true;
            score += SCORE_CATCH;
            flash(`+${SCORE_CATCH}`, BAR_RIGHT - 70, laneY(mug.lane) - 60);
            updateHud();
        } else {
            loseLife('CRASH!', mug.lane, BAR_RIGHT - 90);
            return;
        }
    }
    emptyMugs = emptyMugs.filter((m) => !m.done);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    ctx.save();
    if (shakeTimer > 0) {
        // Math.random rather than rng(): the screen shake must not disturb the
        // seeded stream the waves are drawn from.
        const mag = shakeTimer * 10;
        ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
    }

    drawRoom();
    for (let lane = 0; lane < LANES; lane++) drawBar(lane);
    for (const c of customers) drawCustomer(c);
    for (const mug of mugs) drawMug(mug, true);
    for (const mug of emptyMugs) drawMug(mug, false);
    drawBartender();
    drawFlashes();
    drawBanner();

    ctx.restore();
}

function drawRoom() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2c1c11');
    sky.addColorStop(1, '#120b07');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Panelled back wall.
    ctx.strokeStyle = 'rgba(255, 200, 130, 0.05)';
    ctx.lineWidth = 2;
    for (let x = 0; x < W; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
    }

    // Keg wall behind the barkeep.
    ctx.fillStyle = '#241710';
    ctx.fillRect(BAR_RIGHT + 4, 0, W - BAR_RIGHT - 4, H);
    ctx.fillStyle = 'rgba(255, 194, 71, 0.12)';
    ctx.fillRect(BAR_RIGHT + 4, 0, 2, H);

    // Swing doors on the left, where the patrons come in.
    ctx.fillStyle = '#1a1009';
    ctx.fillRect(0, 0, BAR_LEFT - 4, H);
    ctx.fillStyle = 'rgba(255, 194, 71, 0.1)';
    ctx.fillRect(BAR_LEFT - 6, 0, 2, H);
}

function drawBar(lane) {
    const y = laneY(lane);

    // Counter top with a wooden gradient and a bright lip.
    const wood = ctx.createLinearGradient(0, y, 0, y + COUNTER_H);
    wood.addColorStop(0, '#a9713c');
    wood.addColorStop(0.35, '#7d4f28');
    wood.addColorStop(1, '#4a2c15');
    ctx.fillStyle = wood;
    ctx.fillRect(BAR_LEFT - 10, y, BAR_RIGHT - BAR_LEFT + 24, COUNTER_H);

    ctx.fillStyle = 'rgba(255, 224, 170, 0.35)';
    ctx.fillRect(BAR_LEFT - 10, y, BAR_RIGHT - BAR_LEFT + 24, 2);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(BAR_LEFT - 10, y + COUNTER_H, BAR_RIGHT - BAR_LEFT + 24, 4);

    // Tap tower at the barkeep's end.
    ctx.fillStyle = '#c9c2b4';
    ctx.fillRect(BAR_RIGHT - 12, y - 26, 6, 26);
    ctx.fillStyle = '#ffc247';
    ctx.fillRect(BAR_RIGHT - 16, y - 30, 14, 6);
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const bob = c.state === 'walking' ? Math.sin(c.bob) * 1.5 : 0;
    const top = y - CUSTOMER_H + bob;
    const facing = c.state === 'leaving' ? -1 : 1;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(c.x - 2, y - 3, CUSTOMER_W + 4, 3);

    // Body.
    ctx.fillStyle = c.shirt;
    ctx.fillRect(c.x, top + 14, CUSTOMER_W, CUSTOMER_H - 22);

    // Head.
    ctx.fillStyle = '#e8c39a';
    ctx.fillRect(c.x + 5, top + 2, CUSTOMER_W - 10, 14);

    // Hat.
    ctx.fillStyle = '#2f2218';
    ctx.fillRect(c.x + 1, top, CUSTOMER_W - 2, 4);
    ctx.fillRect(c.x + 6, top - 5, CUSTOMER_W - 12, 5);

    // Eye, looking the way it walks.
    ctx.fillStyle = '#241a12';
    ctx.fillRect(c.x + (facing > 0 ? CUSTOMER_W - 10 : 7), top + 7, 3, 3);

    // Legs.
    ctx.fillStyle = '#3b2a1c';
    const stride = c.state === 'walking' ? Math.sin(c.bob) * 3 : 0;
    ctx.fillRect(c.x + 4 + stride, y - 8, 6, 8);
    ctx.fillRect(c.x + CUSTOMER_W - 10 - stride, y - 8, 6, 8);

    // A patron mid-drink holds the mug up.
    if (c.state === 'drinking') {
        ctx.fillStyle = '#ffb62e';
        ctx.fillRect(c.x + CUSTOMER_W - 4, top + 4, 8, 10);
        ctx.fillStyle = '#fff4dd';
        ctx.fillRect(c.x + CUSTOMER_W - 4, top + 2, 8, 3);
    }

    // Thirst pips: how many more mugs this patron wants.
    const wanted = c.need - c.mugs;
    if (c.state !== 'leaving' && wanted > 1) {
        ctx.fillStyle = '#ffc247';
        for (let i = 0; i < wanted; i++) {
            ctx.fillRect(c.x + 2 + i * 7, top - 12, 5, 5);
        }
    }
}

function drawMug(mug, full) {
    const y = laneY(mug.lane) - MUG_H + 2;
    const wobble = Math.sin(mug.spin) * 1.2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(mug.x - 1, y + MUG_H - 2, MUG_W + 4, 3);

    // Sud trail, streaming out behind whichever way the mug is travelling.
    ctx.fillStyle = full ? 'rgba(255, 246, 226, 0.22)' : 'rgba(190, 170, 140, 0.16)';
    for (let i = 1; i <= 3; i++) {
        const tx = full ? mug.x + MUG_W + i * 7 : mug.x - i * 7;
        ctx.fillRect(tx, y + 4 + Math.sin(mug.spin + i) * 2, 4, 3);
    }

    ctx.fillStyle = full ? '#e59a1f' : '#6f5a3f';
    ctx.fillRect(mug.x, y + wobble, MUG_W, MUG_H - 2);

    ctx.fillStyle = full ? '#ffd36b' : '#8a7255';
    ctx.fillRect(mug.x + 1, y + 1 + wobble, 3, MUG_H - 5);

    // Handle.
    ctx.strokeStyle = full ? '#c07d16' : '#5a4830';
    ctx.lineWidth = 2;
    ctx.strokeRect(mug.x + MUG_W, y + 4 + wobble, 4, 6);

    if (full) {
        ctx.fillStyle = '#fff6e2';
        ctx.fillRect(mug.x - 1, y - 3 + wobble, MUG_W + 2, 5);
    }
}

function drawBartender() {
    const y = laneY(bartender.lane);
    const x = BAR_RIGHT + 8;
    const top = y - CUSTOMER_H - 4;

    // Apron and body.
    ctx.fillStyle = '#f0f0e6';
    ctx.fillRect(x, top + 16, 24, 30);
    ctx.fillStyle = '#3f6ea8';
    ctx.fillRect(x, top + 16, 24, 8);

    // Head and hair.
    ctx.fillStyle = '#e8c39a';
    ctx.fillRect(x + 4, top + 2, 16, 15);
    ctx.fillStyle = '#4a3222';
    ctx.fillRect(x + 3, top, 18, 5);

    // Moustache, because of course.
    ctx.fillStyle = '#4a3222';
    ctx.fillRect(x + 5, top + 11, 14, 3);

    // Pouring arm reaches for the tap when a mug has just gone out.
    ctx.fillStyle = '#e8c39a';
    const armY = bartender.pour > 0 ? top + 20 : top + 26;
    ctx.fillRect(x - 10, armY, 12, 5);

    if (bartender.pour > 0) {
        ctx.fillStyle = '#ffd36b';
        ctx.fillRect(BAR_RIGHT - 14, y - 24, 3, 20);
    }
}

function drawFlashes() {
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
    for (const f of flashes) {
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.6));
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y - (0.9 - f.life) * 18);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
}

function drawBanner() {
    if (state !== 'levelup' && state !== 'dying') return;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(10, 7, 5, 0.55)';
    ctx.fillRect(0, H / 2 - 40, W, 80);
    ctx.fillStyle = state === 'levelup' ? '#ffc247' : '#e2574c';
    ctx.font = 'bold 28px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(
        state === 'levelup' ? `LEVEL ${level} CLEARED` : `${lives} ${lives === 1 ? 'LIFE' : 'LIVES'} LEFT`,
        W / 2,
        H / 2 + 10
    );
    ctx.textAlign = 'left';
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

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    levelCustomers = customersForLevel(level);
    customers = [];
    mugs = [];
    emptyMugs = [];
    flashes = [];
    bartender = { lane: 0, pour: 0 };
    shakeTimer = 0;
    resetWave();
    state = 'running';
    updateHud();
    hideOverlay();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to keep pouring');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    const key = e.key;

    if (key === 'p' || key === 'P') {
        togglePause();
        e.preventDefault();
        return;
    }

    if (key === ' ' || e.code === 'Space') {
        if (state === 'running') serve();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }

    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        moveBartender(-1);
        e.preventDefault();
        return;
    }

    if (key === 'ArrowDown' || key === 's' || key === 'S') {
        moveBartender(1);
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (H / rect.height);
    const lane = Math.max(0, Math.min(LANES - 1, Math.round((y - BAR_TOP) / LANE_GAP)));
    if (lane !== bartender.lane) bartender.lane = lane;
    else serve();
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

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
levelCustomers = customersForLevel(level);
updateHud();
showOverlay('TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
