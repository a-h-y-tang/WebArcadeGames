// ---------------------------------------------------------------------------
// Tapper — slide mugs down four bars, keep the customers out of your face and
// catch every empty they send back.
//
// The whole simulation lives in step(dt) and is deterministic, so the tests
// drive the game by calling step(0.016) in a loop instead of waiting on real
// time. Everything here is a plain top-level binding on purpose: the page runs
// as a classic script so it opens straight from the filesystem, and Playwright
// can reach the state through page.evaluate.
// ---------------------------------------------------------------------------

const CANVAS_W = 640;
const CANVAS_H = 460;

const LANE_COUNT = 4;
const LANE_TOP = 60;
const LANE_H = 96;

const TAP_X = 60;                 // where the bartender stands
const BAR_LEFT = 90;              // left end of the counter
const BAR_RIGHT = 600;            // the swing door

const MUG_SPEED = 300;            // full mug, sliding away from the taps
const EMPTY_SPEED = 230;          // empty mug, rolling back
const CUSTOMER_SPEED = 34;        // level 1 walking speed
const PUSH_SPEED = 340;           // how fast a served customer is shoved back
const PUSH_BACK = 120;            // how far one mug shoves a customer
const DRINK_TIME = 0.7;

const CUST_W = 30;
const CUST_SPACING = 40;          // closest two customers stand while walking
const MUG_W = 18;

const LIVES_START = 3;
const SERVE_POINTS = 100;
const CATCH_POINTS = 50;
const POUR_COOLDOWN = 0.18;
const FIRST_SPAWN = 0.8;
const RESPAWN_DELAY = 1.2;

const HIGH_KEY = 'tapper-high';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const elScore = document.getElementById('score');
const elHigh = document.getElementById('high');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';               // idle | running | paused | over
let score = 0;
let highScore = 0;
let lives = LIVES_START;
let level = 1;
let served = 0;                   // customers served this shift
let spawned = 0;                  // customers sent in this shift
let quota = 0;                    // customers the shift asks for
let spawnTimer = 0;

let player = { lane: 0, cooldown: 0, pourAnim: 0 };
let customers = [];               // { lane, x, push, drink, tint }
let mugs = [];                    // full, travelling right: { lane, x }
let empties = [];                 // empty, travelling left: { lane, x }
let sparks = [];                  // purely cosmetic { x, y, vx, vy, life, color }

let elapsed = 0;                  // seconds of running time, for idle animation

// ---------------------------------------------------------------------------
// Geometry & difficulty helpers
// ---------------------------------------------------------------------------

function laneY(i) {
    return LANE_TOP + i * LANE_H + LANE_H / 2;
}

function quotaFor(lvl) {
    return 4 + 2 * lvl;
}

function spawnIntervalFor(lvl) {
    return Math.max(0.9, 2.6 - 0.25 * (lvl - 1));
}

function levelSpeed() {
    return CUSTOMER_SPEED * (1 + 0.18 * (level - 1));
}

// A tiny seeded generator so spawn patterns can be repeated in a test.
let rngState = 987654321;

function seedRng(n) {
    rngState = (n >>> 0) || 1;
}

function rand() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    seedRng(Date.now());
    state = 'running';
    score = 0;
    lives = LIVES_START;
    level = 1;
    served = 0;
    spawned = 0;
    quota = quotaFor(level);
    spawnTimer = FIRST_SPAWN;
    player = { lane: 0, cooldown: 0, pourAnim: 0 };
    customers = [];
    mugs = [];
    empties = [];
    sparks = [];
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    served = 0;
    spawned = 0;
    quota = quotaFor(level);
    spawnTimer = RESPAWN_DELAY;
    customers.length = 0;
    mugs.length = 0;
    empties.length = 0;
    player.cooldown = 0;
    updateHud();
}

function loseLife() {
    lives = Math.max(0, lives - 1);
    // Customers still on screen were counted as sent; put them back in the
    // queue so the shift stays completable.
    spawned = Math.max(0, spawned - customers.length);
    customers.length = 0;
    mugs.length = 0;
    empties.length = 0;
    player.cooldown = 0;
    spawnTimer = RESPAWN_DELAY;
    updateHud();
    if (lives <= 0) endGame();
}

function endGame() {
    state = 'over';
    if (score > highScore) {
        highScore = score;
        try {
            localStorage.setItem(HIGH_KEY, String(highScore));
        } catch (err) {
            /* storage blocked — the score just doesn't persist */
        }
    }
    updateHud();
    showOverlay("BAR'S CLOSED", `Score ${score} · Best ${highScore}`,
        'Press Space or click Play Again', 'Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score} · Shift ${level}`,
            'Press P to get back behind the bar', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function moveUp() {
    if (state !== 'running') return;
    player.lane = Math.max(0, player.lane - 1);
}

function moveDown() {
    if (state !== 'running') return;
    player.lane = Math.min(LANE_COUNT - 1, player.lane + 1);
}

function pour() {
    if (state !== 'running') return false;
    if (player.cooldown > 0) return false;
    mugs.push({ lane: player.lane, x: BAR_LEFT });
    player.cooldown = POUR_COOLDOWN;
    player.pourAnim = 0.18;
    return true;
}

function spawnCustomer(lane, x) {
    const c = {
        lane,
        x: x === undefined ? BAR_RIGHT : x,
        push: 0,
        drink: 0,
        tint: Math.floor(rand() * 4),
    };
    customers.push(c);
    spawned += 1;
    return c;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    elapsed += dt;
    if (player.cooldown > 0) player.cooldown = Math.max(0, player.cooldown - dt);
    if (player.pourAnim > 0) player.pourAnim = Math.max(0, player.pourAnim - dt);
    updateSparks(dt);

    // Each of these returns true when a life was lost — the screen has been
    // cleared, so the rest of the frame has nothing left to work on.
    if (updateMugs(dt)) return;
    if (updateEmpties(dt)) return;
    if (updateCustomers(dt)) return;

    updateSpawns(dt);
    checkShiftComplete();
}

function updateMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x += MUG_SPEED * dt;

        const target = customerHitBy(m);
        if (target) {
            mugs.splice(i, 1);
            target.push = PUSH_BACK;
            target.drink = DRINK_TIME;
            burst(m.x, laneY(m.lane) - 6, '#ffe9b8');
            continue;
        }

        if (m.x >= BAR_RIGHT) {
            mugs.splice(i, 1);
            burst(BAR_RIGHT, laneY(m.lane) + 4, '#f0a830');
            loseLife();
            return true;
        }
    }
    return false;
}

// The leftmost customer in the mug's lane that the mug has caught up with.
function customerHitBy(mug) {
    let best = null;
    for (const c of customers) {
        if (c.lane !== mug.lane) continue;
        if (c.x + CUST_W / 2 < mug.x - MUG_W / 2) continue;
        if (c.x - CUST_W / 2 > mug.x + MUG_W / 2) continue;
        if (!best || c.x < best.x) best = c;
    }
    return best;
}

function updateEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const e = empties[i];
        e.x -= EMPTY_SPEED * dt;
        if (e.x > BAR_LEFT) continue;

        empties.splice(i, 1);
        if (player.lane === e.lane) {
            score += CATCH_POINTS;
            burst(BAR_LEFT, laneY(e.lane) - 6, '#8fe3a0');
            updateHud();
        } else {
            burst(BAR_LEFT, laneY(e.lane) + 6, '#ff7b6b');
            loseLife();
            return true;
        }
    }
    return false;
}

function updateCustomers(dt) {
    const walk = levelSpeed();
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];

        if (c.push > 0) {
            const d = Math.min(c.push, PUSH_SPEED * dt);
            c.x += d;
            c.push -= d;
            if (c.x >= BAR_RIGHT) {
                customers.splice(i, 1);
                serveCustomer(c);
            }
            continue;
        }

        if (c.drink > 0) {
            c.drink -= dt;
            continue;
        }

        let nx = c.x - walk * dt;
        const ahead = customerAhead(c);
        if (ahead) {
            // Never walk into the back of the customer in front — and never
            // let the clamp shove anyone backwards.
            nx = Math.max(nx, Math.min(c.x, ahead.x + CUST_SPACING));
        }
        c.x = nx;

        if (c.x <= BAR_LEFT) {
            burst(BAR_LEFT + 10, laneY(c.lane), '#ff7b6b');
            loseLife();
            return true;
        }
    }
    return false;
}

// The customer standing closest to the taps ahead of this one, same lane.
function customerAhead(c) {
    let best = null;
    for (const o of customers) {
        if (o === c || o.lane !== c.lane) continue;
        if (o.x >= c.x) continue;
        if (!best || o.x > best.x) best = o;
    }
    return best;
}

function serveCustomer(c) {
    score += SERVE_POINTS;
    served += 1;
    empties.push({ lane: c.lane, x: BAR_RIGHT });
    burst(BAR_RIGHT - 10, laneY(c.lane) - 10, '#f0a830');
    updateHud();
}

function updateSpawns(dt) {
    if (spawned >= quota) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;

    const lane = pickSpawnLane();
    if (lane < 0) {
        spawnTimer = 0.3;                       // every door is blocked, wait
        return;
    }
    spawnCustomer(lane);
    spawnTimer = spawnIntervalFor(level);
}

function pickSpawnLane() {
    const open = [];
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const inLane = customers.filter((c) => c.lane === lane);
        if (inLane.length >= 3) continue;
        if (inLane.some((c) => c.x > BAR_RIGHT - 70)) continue;
        open.push(lane);
    }
    if (!open.length) return -1;
    return open[Math.floor(rand() * open.length) % open.length];
}

function checkShiftComplete() {
    if (served < quota) return;
    if (customers.length || mugs.length || empties.length) return;
    nextLevel();
}

// ---------------------------------------------------------------------------
// Cosmetic sparks
// ---------------------------------------------------------------------------

function burst(x, y, color) {
    for (let i = 0; i < 8; i++) {
        const a = rand() * Math.PI * 2;
        const s = 40 + rand() * 90;
        sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.4, color });
    }
    if (sparks.length > 160) sparks.splice(0, sparks.length - 160);
}

function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 420 * dt;
        s.life -= dt;
        if (s.life <= 0) sparks.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elHigh.textContent = String(highScore);
    elLevel.textContent = String(level);
    elLives.textContent = String(lives);
}

function showOverlay(title, scoreLine, sub, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const CUST_COLORS = ['#7fb4ff', '#c88cf0', '#7de0c0', '#ffa4a4'];
const COUNTER_TOP = 16;           // counter surface sits this far below lane centre

function draw() {
    drawRoom();
    for (let lane = 0; lane < LANE_COUNT; lane++) drawCounter(lane);
    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m.x, laneY(m.lane), false);
    for (const e of empties) drawMug(e.x, laneY(e.lane), true);
    drawTaps();
    drawBartender();
    drawSparks();
}

function drawRoom() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#2a1a10');
    g.addColorStop(1, '#120b07');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Back wall panelling.
    ctx.strokeStyle = 'rgba(255, 214, 160, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 20; x < CANVAS_W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_H);
        ctx.stroke();
    }

    // A lamp hanging over the middle of every bar.
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const y = laneY(lane) + COUNTER_TOP;
        const lampX = (BAR_LEFT + BAR_RIGHT) / 2;
        // Sits in the gap above this bar, clear of the one above it.
        const lampY = y - 52;
        ctx.strokeStyle = 'rgba(255, 214, 160, 0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lampX, lampY - 10);
        ctx.lineTo(lampX, lampY);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 198, 110, 0.55)';
        ctx.beginPath();
        ctx.moveTo(lampX - 12, lampY + 8);
        ctx.lineTo(lampX + 12, lampY + 8);
        ctx.lineTo(lampX + 6, lampY);
        ctx.lineTo(lampX - 6, lampY);
        ctx.closePath();
        ctx.fill();

        const glow = ctx.createRadialGradient(lampX, lampY + 10, 4, lampX, lampY + 10, 96);
        glow.addColorStop(0, 'rgba(255, 196, 104, 0.22)');
        glow.addColorStop(1, 'rgba(255, 196, 104, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(lampX - 96, lampY, 192, 110);
    }

    // Hanging sign over the taps.
    ctx.fillStyle = 'rgba(240, 168, 48, 0.14)';
    ctx.fillRect(0, 0, CANVAS_W, LANE_TOP - 14);
    ctx.fillStyle = '#f0a830';
    ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('ROOT BEER ON TAP', 16, (LANE_TOP - 14) / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#a98a68';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`SHIFT ${level} · ${Math.min(served, quota)}/${quota} SERVED`,
        CANVAS_W - 16, (LANE_TOP - 14) / 2);
}

function drawCounter(lane) {
    const y = laneY(lane) + COUNTER_TOP;
    const x0 = BAR_LEFT - 24;
    const w = BAR_RIGHT + 26 - x0;

    // The bar top.
    const g = ctx.createLinearGradient(0, y - 8, 0, y + 12);
    g.addColorStop(0, '#8a5a30');
    g.addColorStop(0.5, '#5f3a1d');
    g.addColorStop(1, '#3a2412');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y - 8, w, 20);

    ctx.fillStyle = 'rgba(255, 226, 180, 0.25)';
    ctx.fillRect(x0, y - 8, w, 2);

    // Panelled front and a brass footrail, so the bar reads as furniture
    // rather than a floating plank.
    ctx.fillStyle = '#2a1a10';
    ctx.fillRect(x0, y + 12, w, 22);
    ctx.strokeStyle = 'rgba(255, 214, 160, 0.07)';
    ctx.lineWidth = 1;
    for (let x = x0 + 16; x < x0 + w; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, y + 14);
        ctx.lineTo(x, y + 32);
        ctx.stroke();
    }
    ctx.fillStyle = 'rgba(214, 164, 74, 0.55)';
    ctx.fillRect(x0, y + 30, w, 3);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x0, y + 34, w, 6);

    // Swing door at the far end.
    ctx.fillStyle = '#2b1a10';
    ctx.fillRect(BAR_RIGHT + 12, y - 66, 22, 74);
    ctx.strokeStyle = '#6b452a';
    ctx.lineWidth = 2;
    ctx.strokeRect(BAR_RIGHT + 12, y - 66, 22, 74);
    ctx.beginPath();
    ctx.moveTo(BAR_RIGHT + 12, y - 40);
    ctx.lineTo(BAR_RIGHT + 34, y - 40);
    ctx.stroke();
}

function drawCustomer(c) {
    const baseY = laneY(c.lane) + COUNTER_TOP - 8;
    const x = c.x;
    const color = CUST_COLORS[c.tint % CUST_COLORS.length];
    const drinking = c.drink > 0;
    const lean = drinking ? 3 : 0;

    // Legs behind the bar are hidden; draw from the chest up.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 13, baseY);
    ctx.lineTo(x - 10, baseY - 26);
    ctx.lineTo(x + 10, baseY - 26);
    ctx.lineTo(x + 13, baseY);
    ctx.closePath();
    ctx.fill();

    // Arms reaching for the bar.
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - 9, baseY - 20);
    ctx.lineTo(x - 16 - lean, baseY - 6);
    ctx.moveTo(x + 9, baseY - 20);
    ctx.lineTo(x + 16, baseY - 6);
    ctx.stroke();

    // Head.
    ctx.fillStyle = '#f2d0a8';
    ctx.beginPath();
    ctx.arc(x - lean, baseY - 34, 9, 0, Math.PI * 2);
    ctx.fill();

    // Hat.
    ctx.fillStyle = '#3d2716';
    ctx.fillRect(x - lean - 12, baseY - 42, 24, 4);
    ctx.fillRect(x - lean - 7, baseY - 51, 14, 10);

    if (drinking) {
        drawMug(x - lean + 12, laneY(c.lane) - 6, false, 0.8);
        ctx.fillStyle = 'rgba(255, 244, 221, 0.8)';
        for (let i = 0; i < 3; i++) {
            const t = (elapsed * 2 + i * 0.4) % 1;
            ctx.beginPath();
            ctx.arc(x + 20 + i * 4, baseY - 52 - t * 14, 2.2 - t, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawMug(x, y, empty, scale) {
    const s = scale || 1;
    const w = 16 * s;
    const h = 20 * s;
    const top = y - h / 2;

    ctx.save();
    ctx.globalAlpha = empty ? 0.85 : 1;

    // Handle.
    ctx.strokeStyle = empty ? '#8ea9c8' : '#d9b071';
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.arc(x + w / 2 + 2 * s, y, 5 * s, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    // Glass.
    ctx.fillStyle = empty ? 'rgba(190, 214, 240, 0.35)' : '#c9822c';
    ctx.fillRect(x - w / 2, top, w, h);

    if (!empty) {
        // A highlight band across the glass so a full mug reads at a glance.
        ctx.fillStyle = 'rgba(255, 220, 150, 0.45)';
        ctx.fillRect(x - w / 2, top + h * 0.35, w, h * 0.2);
    }

    // Foam / rim.
    ctx.fillStyle = empty ? 'rgba(220, 236, 255, 0.6)' : '#fff4dd';
    ctx.fillRect(x - w / 2 - 1 * s, top - 4 * s, w + 2 * s, empty ? 3 * s : 6 * s);

    ctx.strokeStyle = empty ? 'rgba(190, 214, 240, 0.8)' : '#7a4a18';
    ctx.lineWidth = 1.5 * s;
    ctx.strokeRect(x - w / 2, top, w, h);
    ctx.restore();
}

function drawTaps() {
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const y = laneY(lane) + COUNTER_TOP;
        ctx.fillStyle = '#c8ced8';
        ctx.fillRect(BAR_LEFT - 14, y - 34, 6, 26);
        ctx.fillRect(BAR_LEFT - 18, y - 38, 14, 6);
        ctx.fillStyle = '#f0a830';
        ctx.beginPath();
        ctx.arc(BAR_LEFT - 11, y - 42, 5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBartender() {
    const y = laneY(player.lane) + COUNTER_TOP - 8;
    const pouring = player.pourAnim > 0;
    const x = TAP_X;

    // Body / apron.
    ctx.fillStyle = '#e8e2d6';
    ctx.beginPath();
    ctx.moveTo(x - 14, y + 4);
    ctx.lineTo(x - 10, y - 28);
    ctx.lineTo(x + 10, y - 28);
    ctx.lineTo(x + 14, y + 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#c0392b';
    ctx.fillRect(x - 11, y - 14, 22, 6);

    // Pouring arm swings toward the taps.
    ctx.strokeStyle = '#e8e2d6';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x + 8, y - 22);
    ctx.lineTo(x + (pouring ? 26 : 20), y - (pouring ? 4 : 12));
    ctx.stroke();

    // Head + moustache.
    ctx.fillStyle = '#f2d0a8';
    ctx.beginPath();
    ctx.arc(x, y - 38, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(x - 7, y - 36, 14, 3);
    ctx.fillRect(x - 11, y - 48, 22, 5);

    if (pouring) {
        ctx.fillStyle = 'rgba(240, 168, 48, 0.85)';
        ctx.fillRect(BAR_LEFT - 12, y - 26, 3, 20);
    }
}

function drawSparks() {
    for (const s of sparks) {
        ctx.globalAlpha = Math.max(0, Math.min(1, s.life / 0.4));
        ctx.fillStyle = s.color;
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

let lastTs = 0;

function frame(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running' || state === 'paused') {
            togglePause();
            e.preventDefault();
        }
        return;
    }

    if (k === ' ' || k === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') pour();
        e.preventDefault();
        return;
    }

    if (k === 'ArrowUp' || k === 'w' || k === 'W') {
        moveUp();
        e.preventDefault();
        return;
    }

    if (k === 'ArrowDown' || k === 's' || k === 'S') {
        moveDown();
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

canvas.addEventListener('click', (e) => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    const lane = Math.max(0, Math.min(LANE_COUNT - 1, Math.floor((y - LANE_TOP) / LANE_H)));
    player.lane = lane;
    pour();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

highScore = parseInt(localStorage.getItem(HIGH_KEY) || '0', 10) || 0;
quota = quotaFor(level);
updateHud();
requestAnimationFrame(frame);
