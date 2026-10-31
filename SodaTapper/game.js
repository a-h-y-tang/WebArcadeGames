// Soda Tapper — four counters, one server, an endless thirst.
//
// The simulation runs on a fixed timestep through physicsStep(), and the state
// that matters (state, score, lives, customers, mugs, empties, server,
// spawnQueue) is kept at the top level on purpose: the Playwright suite drives
// the game through exactly these names. See DESIGN.md for the rules.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 640
const H = canvas.height;             // 480
const DT = 1 / 120;                  // fixed simulation timestep, seconds

const LANE_Y = [96, 192, 288, 384];  // counter surface, top to bottom
const LANE_LEFT = 70;                // far end: customers enter, stray mugs fall
const LANE_RIGHT = 556;              // near end: the taps
const SERVER_X = 594;                // where the server stands

const MUG_SPEED = 250;               // full mug, sliding away from the taps
const EMPTY_SPEED = 190;             // empty mug, coming back
const MUG_W = 16;
const CUSTOMER_W = 26;

const POUR_COOLDOWN = 0.28;          // seconds between mugs off one pair of hands
const DRINK_TIME = 0.9;              // seconds a customer stands still drinking
const PUSHBACK = 130;                // how far a caught mug shoves a customer
const PUSH_LIMIT = LANE_LEFT - 24;   // a shoved customer never slides off-screen

const BASE_SPEED = 20;               // customer walking speed on level 1, px/s
const SPEED_PER_LEVEL = 6;
const LIVES_START = 3;

const POINTS = { serve: 50, empty: 25, happy: 150, level: 300 };
const BEST_KEY = 'sodatapper-best';

const COLORS = {
    wood: '#6b4423',
    woodDark: '#4a2d16',
    woodLip: '#8a5a2e',
    soda: '#f0a04b',
    glass: '#dfe9f2',
    shirt: '#7dd3c0',
    customer: ['#c2603f', '#8e6bb5', '#4d8ac9', '#b5a04d', '#5aa364'],
};

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | levelclear | gameover
let score = 0;
let level = 1;
let lives = LIVES_START;
let served = 0;                      // customers who left happy this game
let best = loadBest();

let customers = [];                  // { lane, x, drinking, drinkTimer, tint }
let mugs = [];                       // full mugs: { lane, x }
let empties = [];                    // returning mugs: { lane, x }
let shards = [];                     // smash sparkles, cosmetic only
let spawnQueue = [];                 // { lane, t } sorted by t
let levelTime = 0;
let autoRun = true;                  // the animation loop only simulates while true

const server = { lane: 0, pourCooldown: 0, pourFlash: 0 };

const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');

// --- levels ----------------------------------------------------------------

// A tiny LCG so every level builds the same wave every time it is played.
function lcg(seed) {
    let s = (seed * 1664525 + 1013904223) >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function buildLevel(n) {
    const count = 6 + 2 * n;
    const gap = Math.max(1.4, 3.2 - n * 0.18);
    const rnd = lcg(n * 7919 + 13);
    const queue = [];
    let t = 1.2;
    for (let i = 0; i < count; i++) {
        queue.push({ lane: Math.floor(rnd() * LANE_Y.length), t: Math.round(t * 100) / 100 });
        t += gap * (0.7 + rnd() * 0.6);
    }
    return queue;
}

function customerSpeed() {
    return BASE_SPEED + (level - 1) * SPEED_PER_LEVEL;
}

// --- flow ------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = LIVES_START;
    level = 1;
    served = 0;
    beginLevel();
}

function nextLevel() {
    level += 1;
    beginLevel();
}

function beginLevel() {
    customers.length = 0;
    mugs.length = 0;
    empties.length = 0;
    shards.length = 0;
    spawnQueue = buildLevel(level);
    levelTime = 0;
    server.lane = 0;
    server.pourCooldown = 0;
    server.pourFlash = 0;
    state = 'running';
    hideOverlay();
    syncHud();
}

function loseLife() {
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        state = 'gameover';
        saveBest();
        showOverlay('SHIFT OVER', `Score ${score} · ${served} served`, 'Press Space to clock back on');
    }
    syncHud();
}

function clearLevel() {
    state = 'levelclear';
    score += POINTS.level;
    saveBest();
    showOverlay(`LEVEL ${level} CLEAR`, `Score ${score}`, 'Press Space for the next crowd');
    syncHud();
}

// --- input -----------------------------------------------------------------

function moveServer(delta) {
    server.lane = Math.max(0, Math.min(LANE_Y.length - 1, server.lane + delta));
}

function pour() {
    if (state !== 'running' || server.pourCooldown > 0) return;
    mugs.push({ lane: server.lane, x: LANE_RIGHT });
    server.pourCooldown = POUR_COOLDOWN;
    server.pourFlash = 0.12;
}

function laneAt(y) {
    let nearest = 0;
    for (let i = 1; i < LANE_Y.length; i++) {
        if (Math.abs(LANE_Y[i] - y) < Math.abs(LANE_Y[nearest] - y)) nearest = i;
    }
    return nearest;
}

function confirmKey() {
    if (state === 'idle' || state === 'gameover') startGame();
    else if (state === 'levelclear') nextLevel();
    else if (state === 'paused') resume();
    else if (state === 'running') pour();
}

function resume() {
    state = 'running';
    hideOverlay();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P or Space to carry on');
    } else if (state === 'paused') {
        resume();
    }
}

document.addEventListener('keydown', (e) => {
    const code = e.code;
    if (code === 'Space' || code === 'Enter') {
        e.preventDefault();
        confirmKey();
        return;
    }
    if (code === 'KeyP') {
        e.preventDefault();
        togglePause();
        return;
    }
    if (state !== 'running') return;
    if (code === 'ArrowUp' || code === 'KeyW') {
        e.preventDefault();
        moveServer(-1);
    } else if (code === 'ArrowDown' || code === 'KeyS') {
        e.preventDefault();
        moveServer(1);
    }
});

canvas.addEventListener('click', (e) => {
    if (state === 'idle' || state === 'gameover') {
        startGame();
        return;
    }
    if (state === 'levelclear') {
        nextLevel();
        return;
    }
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (H / (rect.height || H));
    server.lane = laneAt(y);
    pour();
});

document.getElementById('btn-start').addEventListener('click', () => {
    if (state === 'levelclear') nextLevel();
    else if (state === 'paused') resume();
    else startGame();
});

// --- simulation ------------------------------------------------------------

// The rightmost customer on this mug's counter who can still take it, if any.
function catcherFor(mug) {
    let found = null;
    for (const c of customers) {
        if (c.lane !== mug.lane || c.drinking) continue;
        if (mug.x < c.x) continue;
        if (mug.x - MUG_W / 2 > c.x + CUSTOMER_W / 2) continue;
        if (!found || c.x > found.x) found = c;
    }
    return found;
}

function serve(c) {
    c.drinking = true;
    c.drinkTimer = DRINK_TIME;
    c.x = Math.max(PUSH_LIMIT, c.x - PUSHBACK);
    score += POINTS.serve;
}

function smash(lane, x) {
    for (let i = 0; i < 10; i++) {
        shards.push({
            x,
            y: LANE_Y[lane] - 6,
            vx: (Math.random() - 0.5) * 160,
            vy: -Math.random() * 120,
            life: 0.5,
        });
    }
}

function updateMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x -= MUG_SPEED * dt;
        const target = catcherFor(m);
        if (target) {
            mugs.splice(i, 1);
            serve(target);
            continue;
        }
        if (m.x <= LANE_LEFT) {
            mugs.splice(i, 1);
            smash(m.lane, LANE_LEFT);
            loseLife();
        }
    }
}

function updateCustomers(dt) {
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        if (c.drinking) {
            c.drinkTimer -= dt;
            if (c.drinkTimer > 0) continue;
            c.drinking = false;
            c.drinkTimer = 0;
            empties.push({ lane: c.lane, x: c.x + CUSTOMER_W / 2 + MUG_W / 2 });
            if (c.x <= LANE_LEFT) {
                customers.splice(i, 1);
                served += 1;
                score += POINTS.happy;
            }
            continue;
        }
        c.x += customerSpeed() * dt;
        if (c.x >= LANE_RIGHT) {
            customers.splice(i, 1);
            loseLife();
        }
    }
}

function updateEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const m = empties[i];
        m.x += EMPTY_SPEED * dt;
        if (m.x < LANE_RIGHT) continue;
        empties.splice(i, 1);
        if (server.lane === m.lane) {
            score += POINTS.empty;
        } else {
            smash(m.lane, LANE_RIGHT);
            loseLife();
        }
    }
}

function updateShards(dt) {
    for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        s.life -= dt;
        if (s.life <= 0) {
            shards.splice(i, 1);
            continue;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 420 * dt;
    }
}

function physicsStep(dt) {
    if (state !== 'running') return;

    levelTime += dt;
    while (spawnQueue.length && spawnQueue[0].t <= levelTime) {
        const q = spawnQueue.shift();
        customers.push({
            lane: q.lane,
            x: LANE_LEFT,
            drinking: false,
            drinkTimer: 0,
            tint: COLORS.customer[(customers.length + q.lane) % COLORS.customer.length],
        });
    }

    server.pourCooldown = Math.max(0, server.pourCooldown - dt);
    server.pourFlash = Math.max(0, server.pourFlash - dt);

    updateMugs(dt);
    updateCustomers(dt);
    updateEmpties(dt);
    updateShards(dt);

    if (
        state === 'running' &&
        spawnQueue.length === 0 &&
        customers.length === 0 &&
        mugs.length === 0 &&
        empties.length === 0
    ) {
        clearLevel();
    }

    syncHud();
}

// --- HUD / overlay ---------------------------------------------------------

function loadBest() {
    try {
        return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
        return 0;
    }
}

function saveBest() {
    if (score <= best) return;
    best = score;
    try {
        localStorage.setItem(BEST_KEY, String(best));
    } catch (err) {
        /* storage unavailable (private mode / file://) — keep it in memory */
    }
}

function syncHud() {
    document.getElementById('score').textContent = String(score);
    document.getElementById('level').textContent = String(level);
    document.getElementById('lives').textContent = String(lives);
    document.getElementById('served').textContent = String(served);
    document.getElementById('best').textContent = String(best);
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

// --- rendering -------------------------------------------------------------

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawBackground() {
    const wall = ctx.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, '#2e1c0e');
    wall.addColorStop(0.6, '#1d1208');
    wall.addColorStop(1, '#120b05');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);

    // Panelled back wall.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 1;
    for (let x = 28; x < W; x += 56) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
    }

    // The tap wall the server works behind.
    ctx.fillStyle = '#201206';
    ctx.fillRect(LANE_RIGHT + 18, 0, W - LANE_RIGHT - 18, H);
    ctx.fillStyle = '#3f2a14';
    ctx.fillRect(LANE_RIGHT + 18, 0, 3, H);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, LANE_LEFT - 26, H);
    ctx.fillStyle = '#3f2a14';
    ctx.fillRect(LANE_LEFT - 26, 0, 3, H);
}

// A hanging lamp and its cone of light over one counter.
function drawLamp(lane) {
    const y = LANE_Y[lane];
    const top = y - 88;
    const cx = (LANE_LEFT + LANE_RIGHT) / 2;

    const cone = ctx.createLinearGradient(0, top, 0, y + 6);
    cone.addColorStop(0, 'rgba(255, 206, 140, 0.10)');
    cone.addColorStop(1, 'rgba(255, 206, 140, 0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(cx - 40, top + 8);
    ctx.lineTo(cx + 40, top + 8);
    ctx.lineTo(cx + 210, y + 6);
    ctx.lineTo(cx - 210, y + 6);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#3f2a14';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, top - 10);
    ctx.lineTo(cx, top - 2);
    ctx.stroke();

    ctx.fillStyle = '#5b3a1b';
    ctx.beginPath();
    ctx.moveTo(cx - 20, top + 8);
    ctx.lineTo(cx + 20, top + 8);
    ctx.lineTo(cx + 10, top - 2);
    ctx.lineTo(cx - 10, top - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd9a0';
    ctx.fillRect(cx - 7, top + 6, 14, 3);
}

function drawCounter(lane) {
    const y = LANE_Y[lane];
    const left = LANE_LEFT - 26;
    const width = LANE_RIGHT - left + 40;

    if (lane === server.lane && state !== 'idle') {
        ctx.fillStyle = 'rgba(240, 160, 75, 0.1)';
        ctx.fillRect(left, y - 70, width, 70);
        ctx.fillStyle = 'rgba(240, 160, 75, 0.55)';
        ctx.fillRect(left, y - 2, width, 2);
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(left, y + 14, width, 10);

    ctx.fillStyle = COLORS.wood;
    ctx.fillRect(left, y, width, 14);
    ctx.fillStyle = COLORS.woodLip;
    ctx.fillRect(left, y, width, 4);
    ctx.fillStyle = COLORS.woodDark;
    ctx.fillRect(left, y + 14, width, 6);

    // Plank seams, so a sliding mug reads as moving.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.lineWidth = 1;
    for (let x = left + 18; x < LANE_RIGHT + 20; x += 54) {
        ctx.beginPath();
        ctx.moveTo(x, y + 2);
        ctx.lineTo(x, y + 14);
        ctx.stroke();
    }

    // Swing door the customers come through.
    ctx.fillStyle = '#4a2d16';
    ctx.fillRect(left - 14, y - 46, 12, 46);
    ctx.fillStyle = '#2a1a0c';
    ctx.fillRect(left - 12, y - 42, 8, 18);

    drawTap(lane);
}

function drawTap(lane) {
    const y = LANE_Y[lane];
    const x = LANE_RIGHT + 12;
    ctx.fillStyle = '#7d8a96';
    ctx.fillRect(x, y - 44, 8, 30);
    ctx.fillStyle = '#9aa7b4';
    ctx.fillRect(x - 10, y - 20, 20, 6);
    ctx.fillStyle = '#c0cbd6';
    ctx.fillRect(x - 2, y - 50, 12, 6);
    ctx.fillStyle = COLORS.soda;
    ctx.fillRect(x - 6, y - 14, 3, 4);
}

function drawMug(x, y, full) {
    const w = MUG_W;
    const h = 18;
    const top = y - h;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + 1, w * 0.7, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#9fb0bf';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x + w / 2 + 3, top + h / 2 + 1, 4.5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    ctx.fillStyle = full ? COLORS.soda : 'rgba(223, 233, 242, 0.45)';
    roundRect(x - w / 2, top, w, h, 3);
    ctx.fill();

    if (full) {
        ctx.fillStyle = '#fff6e6';
        roundRect(x - w / 2, top, w, 6, 3);
        ctx.fill();
    }

    ctx.strokeStyle = 'rgba(223, 233, 242, 0.85)';
    ctx.lineWidth = 1.5;
    roundRect(x - w / 2, top, w, h, 3);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(x - w / 2 + 2.5, top + 3, 2, h - 6);
}

function drawCustomer(c) {
    const y = LANE_Y[c.lane];
    const x = c.x;
    const skin = '#f0c9a0';

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 15, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2b1b0e';                                  // legs
    ctx.fillRect(x - 9, y - 11, 7, 11);
    ctx.fillRect(x + 2, y - 11, 7, 11);

    ctx.fillStyle = c.tint || COLORS.customer[0];               // torso
    roundRect(x - CUSTOMER_W / 2, y - 34, CUSTOMER_W, 25, 5);
    ctx.fill();

    ctx.fillStyle = skin;                                       // head
    ctx.beginPath();
    ctx.arc(x, y - 43, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2b1b0e';                                  // hat
    roundRect(x - 13, y - 52, 26, 5, 2);
    ctx.fill();
    roundRect(x - 8, y - 60, 16, 9, 3);
    ctx.fill();

    ctx.strokeStyle = skin;                                     // arm
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 10, y - 28);
    if (c.drinking) {
        ctx.lineTo(x + 15, y - 40);
    } else {
        ctx.lineTo(x + 15, y - 22);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';

    if (c.drinking) {
        drawMug(x + 20, y - 34, true);
        const t = Math.max(0, Math.min(1, c.drinkTimer / DRINK_TIME));
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(x - 14, y - 68, 28, 4);
        ctx.fillStyle = COLORS.soda;
        ctx.fillRect(x - 14, y - 68, 28 * (1 - t), 4);
    }
}

function drawServer() {
    const y = LANE_Y[server.lane];
    const x = SERVER_X;
    const skin = '#f0c9a0';
    const pouring = server.pourFlash > 0;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 15, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#23303a';                                  // legs
    ctx.fillRect(x - 9, y - 11, 7, 11);
    ctx.fillRect(x + 2, y - 11, 7, 11);

    ctx.fillStyle = COLORS.shirt;                               // apron and shirt
    roundRect(x - 13, y - 36, 26, 26, 5);
    ctx.fill();
    ctx.fillStyle = '#f6ecdd';
    ctx.fillRect(x - 8, y - 24, 16, 14);

    ctx.fillStyle = skin;                                       // head
    ctx.beginPath();
    ctx.arc(x, y - 45, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6ecdd';                                  // cap
    roundRect(x - 11, y - 54, 22, 6, 2);
    ctx.fill();
    roundRect(x - 7, y - 59, 14, 6, 2);
    ctx.fill();

    ctx.strokeStyle = skin;                                     // arm toward the tap
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 11, y - 30);
    ctx.lineTo(x - 26, pouring ? y - 34 : y - 22);
    ctx.stroke();
    ctx.lineCap = 'butt';

    if (pouring) {
        ctx.fillStyle = COLORS.soda;
        ctx.fillRect(LANE_RIGHT + 4, y - 14, 3, 10);
    }
}

function drawShards() {
    for (const s of shards) {
        ctx.globalAlpha = Math.max(0, s.life / 0.5);
        ctx.fillStyle = COLORS.glass;
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

function drawLives() {
    ctx.fillStyle = 'rgba(246, 236, 221, 0.45)';
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('LIVES', 14, 20);
    for (let i = 0; i < lives; i++) {
        drawMug(22 + i * 22, 44, true);
    }
}

function drawWave() {
    if (state === 'idle') return;
    const left = spawnQueue.length + customers.length;
    ctx.fillStyle = 'rgba(246, 236, 221, 0.5)';
    ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`WAVE ${level}  -  ${left} LEFT`, LANE_RIGHT + 4, 20);
    ctx.textAlign = 'left';
}

function drawIdleHint() {
    ctx.fillStyle = 'rgba(246, 236, 221, 0.4)';
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Slide mugs left, catch the empties coming back', W / 2, H - 16);
    ctx.textAlign = 'left';
}

function render() {
    drawBackground();
    for (let lane = 0; lane < LANE_Y.length; lane++) {
        drawLamp(lane);
        drawCounter(lane);
    }
    for (const m of empties) drawMug(m.x, LANE_Y[m.lane], false);
    for (const m of mugs) drawMug(m.x, LANE_Y[m.lane], true);
    for (const c of customers) drawCustomer(c);
    drawServer();
    drawShards();
    drawLives();
    drawWave();
    if (state === 'idle') drawIdleHint();
}

// --- loop ------------------------------------------------------------------

let lastFrame = 0;
let accumulator = 0;

function frame(ts) {
    requestAnimationFrame(frame);
    const dt = lastFrame ? Math.min(0.1, (ts - lastFrame) / 1000) : 0;
    lastFrame = ts;
    if (autoRun) {
        accumulator += dt;
        while (accumulator >= DT) {
            physicsStep(DT);
            accumulator -= DT;
        }
    }
    render();
}

syncHud();
requestAnimationFrame(frame);
