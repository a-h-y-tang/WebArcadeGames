// ---------------------------------------------------------------------------
// Tapper — a four-lane bar-serving arcade game on an HTML5 canvas.
//
// Thirsty customers shuffle up each of four bars toward the bartender. Slide a
// full mug down a bar and the customer at the front grabs it, staggers back
// while drinking, then shoves the empty back at you — catch it or it smashes.
// Let a customer reach your end, waste a mug on an empty lane or miss a
// returning empty and you lose a life.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. All motion is expressed per-second and applied
// through `step(dt)`, so the tests can simulate frames deterministically without
// depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Layout --------------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 440;

const LANE_COUNT = 4;
const LANE_TOP = 88;
const LANE_SPACING = 95;
const LANE_Y = Array.from({ length: LANE_COUNT }, (_, i) => LANE_TOP + i * LANE_SPACING);

const BAR_LEFT = 60;          // far end: customers enter, stray mugs smash
const BAR_RIGHT = 560;        // bartender end
const BAR_THICK = 12;
const BAR_FRONT = 16;         // depth of the counter's front face

// --- Bartender -----------------------------------------------------------
const BARTENDER_X = BAR_RIGHT + 40;
const LANE_EASE = 14;         // how quickly the drawn sprite catches its lane
const SERVE_COOLDOWN = 0.22;

// --- Mugs ----------------------------------------------------------------
const MUG_SPEED = 210;        // full mugs, travelling left
const EMPTY_SPEED = 190;      // empties, coming back right
const MUG_START_X = BAR_RIGHT - 10;
const CATCH_X = BAR_RIGHT - 28;
const MUG_W = 16;
const MUG_H = 20;
const HIT_DIST = 16;          // how close a mug must get to be grabbed

// --- Customers -----------------------------------------------------------
const CUSTOMER_SPEED = 28;
const CUSTOMER_SPEED_STEP = 4;
const CUSTOMER_SPEED_CAP = 120;
const CUSTOMER_GAP = 34;      // minimum spacing within a lane
const CUSTOMER_HW = 13;
const CUSTOMER_H = 34;
const DANGER_X = BAR_RIGHT - 30;
const DRINK_TIME = 0.8;
const PUSH_SPEED = 120;       // how fast a drinker slides back down the bar

// --- Waves ---------------------------------------------------------------
const WAVE_BASE = 5;
const WAVE_STEP = 2;
const SPAWN_BASE = 2.4, SPAWN_STEP = 0.15, SPAWN_MIN = 0.9;
const FIRST_SPAWN = 1.2;

// --- Scoring / run structure ---------------------------------------------
const SERVE_POINTS = 150;
const CATCH_POINTS = 50;
const CLEAR_BONUS = 300;
const START_LIVES = 3;
const DEATH_PAUSE = 1.6;
const CLEAR_PAUSE = 1.8;
const SPARK_LIFE = 0.5;

// --- Colours -------------------------------------------------------------
const SHIRT_COLORS = ['#c1502e', '#3f6fb5', '#7a4b9b', '#3f8f6d', '#b5883c'];
const SKIN_COLORS = ['#e8b088', '#c98b5e', '#8e5b36', '#f0c9a4'];

// --- DOM -----------------------------------------------------------------
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

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'dying' | 'levelclear' | 'over'
let state, score, best, lives, level;
let bartender, customers, mugs, empties, sparks;
let pendingCustomers, spawnTimer, spawnEnabled;
let serveTimer, deathTimer, clearTimer, elapsed;

// ---------------------------------------------------------------------------
// Difficulty curve
// ---------------------------------------------------------------------------

function waveSize(lvl = level) {
    return WAVE_BASE + WAVE_STEP * lvl;
}

function customerSpeed(lvl = level) {
    return Math.min(CUSTOMER_SPEED_CAP, CUSTOMER_SPEED + CUSTOMER_SPEED_STEP * (lvl - 1));
}

function spawnInterval(lvl = level) {
    return Math.max(SPAWN_MIN, SPAWN_BASE - SPAWN_STEP * (lvl - 1));
}

// ---------------------------------------------------------------------------
// Spawning helpers
// ---------------------------------------------------------------------------

function spawnCustomer(lane, x = BAR_LEFT) {
    const c = {
        lane,
        x,
        state: 'advancing',   // 'advancing' | 'drinking'
        drinkTimer: 0,
        bob: Math.random() * Math.PI * 2,
        shirt: SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)],
        skin: SKIN_COLORS[Math.floor(Math.random() * SKIN_COLORS.length)],
    };
    customers.push(c);
    return c;
}

function spawnMug(lane, x = MUG_START_X) {
    const m = { lane, x, foam: Math.random() * 3 };
    mugs.push(m);
    return m;
}

function spawnEmpty(lane, x) {
    const e = { lane, x, spin: 0 };
    empties.push(e);
    return e;
}

function spawnSparks(lane, x) {
    sparks.push({ lane, x, life: SPARK_LIFE });
}

// A mug is only poured when the bar is open and the tap has recharged.
function serve() {
    if (state !== 'running' || serveTimer > 0) return null;
    serveTimer = SERVE_COOLDOWN;
    return spawnMug(bartender.lane);
}

function moveLane(delta) {
    if (state !== 'running') return;
    bartender.lane = Math.max(0, Math.min(LANE_COUNT - 1, bartender.lane + delta));
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) {
            if (lives <= 0) gameOver();
            else state = 'running';
        }
        return;
    }
    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        return;
    }
    if (state !== 'running') return;

    elapsed += dt;
    if (serveTimer > 0) serveTimer -= dt;

    // The sprite eases toward its lane; the logical lane is always discrete.
    const targetY = LANE_Y[bartender.lane];
    bartender.y += (targetY - bartender.y) * Math.min(1, dt * LANE_EASE);

    updateSpawning(dt);
    updateCustomers(dt);
    if (state !== 'running') return;
    updateMugs(dt);
    if (state !== 'running') return;
    updateEmpties(dt);
    if (state !== 'running') return;
    updateSparks(dt);

    if (waveFinished()) clearLevel();
}

function updateSpawning(dt) {
    if (!spawnEnabled || pendingCustomers <= 0) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval();
    pendingCustomers--;
    spawnCustomer(Math.floor(Math.random() * LANE_COUNT));
}

function updateCustomers(dt) {
    const speed = customerSpeed();

    for (const c of customers) {
        if (c.state === 'drinking') {
            c.drinkTimer -= dt;
            c.x -= PUSH_SPEED * dt;
            if (c.x <= BAR_LEFT) {
                c.done = 'served';
            } else if (c.drinkTimer <= 0) {
                c.state = 'advancing';
                spawnEmpty(c.lane, c.x);
            }
        } else {
            c.x += speed * dt;
            c.bob += dt * 7;
        }
    }

    // Nobody walks through the person in front of them: within a lane, each
    // customer is held at least CUSTOMER_GAP behind the one ahead. Because a
    // drinker slides backwards, this also shunts the queue back down the bar.
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const inLane = customers
            .filter((c) => c.lane === lane && !c.done)
            .sort((a, b) => b.x - a.x);
        for (let i = 1; i < inLane.length; i++) {
            inLane[i].x = Math.min(inLane[i].x, inLane[i - 1].x - CUSTOMER_GAP);
            if (inLane[i].x < BAR_LEFT) inLane[i].x = BAR_LEFT;
        }
    }

    const servedCount = customers.filter((c) => c.done === 'served').length;
    if (servedCount) {
        customers = customers.filter((c) => c.done !== 'served');
        addScore(SERVE_POINTS * servedCount);
    }

    const reached = customers.find((c) => c.x >= DANGER_X);
    if (reached) loseLife();
}

function updateMugs(dt) {
    const survivors = [];
    for (const m of mugs) {
        const oldX = m.x;
        m.x -= MUG_SPEED * dt;

        // Swept collision: the mug is caught on the frame it crosses a
        // customer's grab line, so a fast mug can never tunnel past someone.
        // A customer who is already drinking lets the mug slide by.
        let taker = null;
        for (const c of customers) {
            if (c.lane !== m.lane || c.state !== 'advancing') continue;
            const line = c.x + HIT_DIST;
            if (m.x <= line && oldX > line && (!taker || c.x > taker.x)) taker = c;
        }
        if (taker) {
            taker.state = 'drinking';
            taker.drinkTimer = DRINK_TIME;
            continue;
        }

        if (m.x <= BAR_LEFT) {
            spawnSparks(m.lane, BAR_LEFT);
            mugs = survivors;
            loseLife();
            return;
        }
        survivors.push(m);
    }
    mugs = survivors;
}

function updateEmpties(dt) {
    const survivors = [];
    let caught = 0;
    for (const e of empties) {
        e.x += EMPTY_SPEED * dt;
        e.spin += dt * 6;
        if (e.x >= CATCH_X && bartender.lane === e.lane) {
            caught++;
            continue;
        }
        if (e.x >= BAR_RIGHT) {
            spawnSparks(e.lane, BAR_RIGHT);
            empties = survivors;
            if (caught) addScore(CATCH_POINTS * caught);
            loseLife();
            return;
        }
        survivors.push(e);
    }
    empties = survivors;
    if (caught) addScore(CATCH_POINTS * caught);
}

function updateSparks(dt) {
    for (const s of sparks) s.life -= dt;
    sparks = sparks.filter((s) => s.life > 0);
}

function waveFinished() {
    return (
        pendingCustomers <= 0 &&
        customers.length === 0 &&
        mugs.length === 0 &&
        empties.length === 0
    );
}

// ---------------------------------------------------------------------------
// Run flow
// ---------------------------------------------------------------------------

function addScore(points) {
    score += points;
    updateHud();
}

function loseLife() {
    if (state !== 'running') return;
    lives = Math.max(0, lives - 1);
    // Everyone still on a bar goes back into the queue, so a death costs time
    // but never wave progress.
    pendingCustomers += customers.length;
    customers = [];
    mugs = [];
    empties = [];
    state = 'dying';
    deathTimer = DEATH_PAUSE;
    updateHud();
    showOverlayForState();
}

function clearLevel() {
    state = 'levelclear';
    clearTimer = CLEAR_PAUSE;
    addScore(CLEAR_BONUS * level);
    showOverlay('BAR CLEAR!', `Level ${level} — score ${score}`, 'Next round coming up');
}

function nextLevel() {
    level++;
    startWave();
    state = 'running';
    updateHud();
    hideOverlay();
}

function startWave() {
    customers = [];
    mugs = [];
    empties = [];
    sparks = [];
    pendingCustomers = waveSize(level);
    spawnTimer = FIRST_SPAWN;
    serveTimer = 0;
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    elapsed = 0;
    spawnEnabled = true;
    bartender = { lane: 0, y: LANE_Y[0] };
    startWave();
    state = 'running';
    updateHud();
    hideOverlay();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        localStorage.setItem('tapper-best', String(best));
    }
    updateHud();
    showOverlay('LAST CALL', `Score ${score}`, 'Press Space or Enter to play again');
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

// Empty the wave so a spec can drive the level-clear path directly.
function clearWaveForTest() {
    pendingCustomers = 0;
    customers = [];
    mugs = [];
    empties = [];
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    bestEl.textContent = String(best);
}

function showOverlay(title, sub, hint) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub;
    overlaySub.textContent = hint;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function showOverlayForState() {
    if (state === 'dying') {
        const left = lives > 0 ? `${lives} ${lives === 1 ? 'life' : 'lives'} left` : 'No lives left';
        showOverlay('SMASH!', `Score ${score}`, left);
    }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function draw() {
    drawRoom();
    for (let lane = 0; lane < LANE_COUNT; lane++) drawBar(lane);
    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m.lane, m.x, false, m.foam);
    for (const e of empties) drawMug(e.lane, e.x, true, 0);
    for (const s of sparks) drawSparks(s);
    if (state !== 'idle' && state !== 'over') drawBartender();
}

function drawRoom() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#2a1809');
    g.addColorStop(1, '#120a05');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Panelled back wall.
    ctx.strokeStyle = 'rgba(255, 210, 150, 0.05)';
    ctx.lineWidth = 2;
    for (let x = 20; x < CANVAS_W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_H);
        ctx.stroke();
    }

    // Bartender's walkway down the right-hand side.
    ctx.fillStyle = 'rgba(20, 10, 4, 0.55)';
    ctx.fillRect(BAR_RIGHT + 18, 0, CANVAS_W - BAR_RIGHT - 18, CANVAS_H);
    ctx.fillStyle = 'rgba(255, 210, 150, 0.06)';
    ctx.fillRect(BAR_RIGHT + 18, 0, 3, CANVAS_H);

    // Back-bar shelf of bottles along the far side.
    ctx.fillStyle = '#3b2412';
    ctx.fillRect(0, 0, BAR_LEFT - 22, CANVAS_H);
    for (let y = 26; y < CANVAS_H; y += 34) {
        ctx.fillStyle = 'rgba(255, 220, 160, 0.16)';
        ctx.fillRect(6, y, 26, 3);
        ctx.fillStyle = ['#7ec8a9', '#c9863f', '#a5566b'][(y / 34 | 0) % 3];
        ctx.fillRect(10, y - 14, 6, 14);
        ctx.fillRect(22, y - 10, 6, 10);
    }
}

function drawBar(lane) {
    const y = LANE_Y[lane];
    const left = BAR_LEFT - 12;
    const width = BAR_RIGHT - left + 20;

    // Shadow under the counter, so the bars read as furniture in a room.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(left, y + BAR_THICK + BAR_FRONT, width, 8);

    // Counter top.
    const g = ctx.createLinearGradient(0, y, 0, y + BAR_THICK);
    g.addColorStop(0, '#b8783a');
    g.addColorStop(1, '#7d4a1e');
    ctx.fillStyle = g;
    ctx.fillRect(left, y, width, BAR_THICK);

    // Polished highlight along the serving edge.
    ctx.fillStyle = 'rgba(255, 232, 192, 0.35)';
    ctx.fillRect(left, y, width, 3);

    // Front face.
    const f = ctx.createLinearGradient(0, y + BAR_THICK, 0, y + BAR_THICK + BAR_FRONT);
    f.addColorStop(0, '#5c3414');
    f.addColorStop(1, '#3a2009');
    ctx.fillStyle = f;
    ctx.fillRect(left, y + BAR_THICK, width, BAR_FRONT);

    // Panel grooves on the front face.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    for (let x = left + 24; x < left + width; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, y + BAR_THICK + 4);
        ctx.lineTo(x, y + BAR_THICK + BAR_FRONT - 4);
        ctx.stroke();
    }

    // Beer tap standing over the bartender's end of this bar.
    ctx.fillStyle = '#6b4a22';
    ctx.fillRect(BAR_RIGHT + 2, y - 6, 14, 6);
    ctx.fillStyle = '#e3c163';
    ctx.fillRect(BAR_RIGHT + 6, y - 30, 6, 24);
    ctx.beginPath();
    ctx.arc(BAR_RIGHT + 9, y - 32, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#f3b23f';
    ctx.fill();

    // Drain at the far end, where a stray mug goes over the edge.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(left, y, 8, BAR_THICK);
    ctx.strokeStyle = 'rgba(255, 210, 150, 0.25)';
    ctx.strokeRect(left + 0.5, y + 0.5, 8, BAR_THICK - 1);
}

function drawCustomer(c) {
    const y = LANE_Y[c.lane];
    const drinking = c.state === 'drinking';
    const lean = drinking ? -3 : Math.sin(c.bob) * 1.5;
    const feet = y + 1;                       // standing at the counter edge
    const x = c.x + lean;
    const bodyTop = feet - CUSTOMER_H;

    // Legs.
    ctx.fillStyle = '#2f2a3a';
    ctx.fillRect(x - 8, feet - 10, 6, 10);
    ctx.fillRect(x + 2, feet - 10, 6, 10);

    // Body.
    ctx.fillStyle = c.shirt;
    ctx.fillRect(x - CUSTOMER_HW, bodyTop + 8, CUSTOMER_HW * 2, CUSTOMER_H - 18);

    // Head and hat.
    ctx.fillStyle = c.skin;
    ctx.beginPath();
    ctx.arc(x, bodyTop, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2c1a0d';
    ctx.fillRect(x - 11, bodyTop - 8, 22, 4);
    ctx.fillRect(x - 7, bodyTop - 14, 14, 6);

    // Eyes, always fixed hungrily on the bartender.
    ctx.fillStyle = '#20140a';
    ctx.fillRect(x + 2, bodyTop - 2, 2, 3);
    ctx.fillRect(x + 6, bodyTop - 2, 2, 3);

    // Arm on the bar, or a mug tipped back while drinking.
    ctx.fillStyle = c.skin;
    if (drinking) {
        ctx.fillRect(x + 5, bodyTop + 6, 12, 5);
        drawMugShape(x + 18, bodyTop + 14, false, 0);
    } else {
        ctx.fillRect(x + CUSTOMER_HW - 2, bodyTop + 16, 12, 5);
    }
}

function drawBartender() {
    const y = bartender.y;
    const feet = y + 1;

    // Legs behind the bar.
    ctx.fillStyle = '#3a2b1a';
    ctx.fillRect(BARTENDER_X - 9, feet - 12, 7, 12);
    ctx.fillRect(BARTENDER_X + 2, feet - 12, 7, 12);

    // Apron over a white shirt.
    ctx.fillStyle = '#f6e9d8';
    ctx.fillRect(BARTENDER_X - 13, feet - 36, 26, 26);
    ctx.fillStyle = '#c8b191';
    ctx.fillRect(BARTENDER_X - 10, feet - 22, 20, 12);

    // Head, hair and moustache.
    ctx.fillStyle = '#e8b088';
    ctx.beginPath();
    ctx.arc(BARTENDER_X, feet - 45, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a3018';
    ctx.fillRect(BARTENDER_X - 10, feet - 54, 20, 6);
    ctx.fillRect(BARTENDER_X - 8, feet - 42, 16, 3);
    ctx.fillStyle = '#20140a';
    ctx.fillRect(BARTENDER_X - 6, feet - 48, 2, 3);
    ctx.fillRect(BARTENDER_X + 3, feet - 48, 2, 3);

    // Pouring arm reaching for the tap, plus the mug in hand once the tap has
    // recharged — the player's cue that another pour is ready.
    ctx.fillStyle = '#e8b088';
    ctx.fillRect(BARTENDER_X - 26, feet - 32, 14, 5);
    if (state === 'running' && serveTimer <= 0) {
        drawMugShape(BARTENDER_X - 30, feet - 24, false, 0);
    }
}

function drawMug(lane, x, empty, foam) {
    drawMugShape(x, LANE_Y[lane] + 1, empty, foam);
}

function drawMugShape(x, baseY, empty, foam) {
    const top = baseY - MUG_H;

    ctx.fillStyle = empty ? 'rgba(214, 226, 235, 0.55)' : '#e6a52a';
    ctx.fillRect(x - MUG_W / 2, top, MUG_W, MUG_H);

    if (!empty) {
        ctx.fillStyle = '#fff4d8';
        ctx.fillRect(x - MUG_W / 2, top - 4 - (foam || 0) * 0.3, MUG_W, 6);
    }

    // Handle.
    ctx.strokeStyle = empty ? 'rgba(214, 226, 235, 0.8)' : '#c9861a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + MUG_W / 2 + 1, top + MUG_H / 2, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    // Glass outline.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - MUG_W / 2 + 0.5, top + 0.5, MUG_W - 1, MUG_H - 1);
}

function drawSparks(s) {
    const y = LANE_Y[s.lane];
    const t = 1 - s.life / SPARK_LIFE;
    ctx.strokeStyle = `rgba(255, 236, 190, ${Math.max(0, 1 - t)})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const r = 6 + t * 18;
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(a) * 4, y + Math.sin(a) * 4);
        ctx.lineTo(s.x + Math.cos(a) * r, y + Math.sin(a) * r);
        ctx.stroke();
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
    if (key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
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
        moveLane(-1);
        e.preventDefault();
        return;
    }
    if (key === 'ArrowDown' || key === 's' || key === 'S') {
        moveLane(1);
        e.preventDefault();
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

// The animation loop only advances the simulation while `autoRun` is set. The
// Playwright specs switch it off so that step() is driven purely by the test,
// which keeps long simulations exact instead of racing the browser's clock.
let autoRun = true;

function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    if (autoRun) step(dt);
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
elapsed = 0;
spawnEnabled = true;
serveTimer = 0;
deathTimer = 0;
clearTimer = 0;
sparks = [];
bartender = { lane: 0, y: LANE_Y[0] };
startWave();
updateHud();
showOverlay('TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
