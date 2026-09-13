// ---------------------------------------------------------------------------
// Soda Tapper — four bars, one server, and a crowd that will not wait.
//
// Patrons walk in from the far (left) end of each bar and head for the taps.
// Sliding a full mug down a bar knocks the nearest one back while they drink;
// push them off the far end and they leave, sending their empty mug sliding
// back toward the taps for you to catch. A missed mug, an uncaught empty or a
// patron who reaches the taps costs a life.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Lode Runner,
// Kaboom and Tetris in this repo. The whole simulation is advanced through
// `step(dt)`, so the tests can run frames deterministically instead of leaning
// on requestAnimationFrame wall clocks.
// ---------------------------------------------------------------------------

// --- Canvas geometry ---
const CANVAS_W = 640;
const CANVAS_H = 420;

const LANE_COUNT = 4;
const LANE_TOP = 58;
const LANE_H = 88;

const BAR_LEFT = 70;          // far end: where patrons arrive and mugs smash
const BAR_RIGHT = 580;        // tap end: where the server stands
const MUG_START_X = BAR_RIGHT - 8;
const GRAB_X = BAR_RIGHT - 30; // a patron this far along has you by the apron
const CATCH_X = BAR_RIGHT - 6; // an empty reaching here is caught or smashed
const HIT_DIST = 22;

// --- Speeds (px per second) ---
const MUG_SPEED = 300;
const EMPTY_SPEED = 170;
const RETREAT_SPEED = 170;
const PATRON_SPEED_BASE = 22;
const PATRON_SPEED_STEP = 6;
const PATRON_SPEED_MAX = 84;
const DRINK_SPEEDUP = 1.12;   // each mug drunk makes that patron keener

// --- Timing (seconds) ---
const DRINK_TIME = 0.45;
const POUR_COOLDOWN = 0.22;
const BANNER_TIME = 1.8;
const FIRST_SPAWN_DELAY = 0.8;

// --- Rules ---
const PUSH_DIST = 150;
const START_LIVES = 3;
const SERVE_POINTS = 10;   // a push is progress, not the pay-off
const EXIT_POINTS = 150;   // the sale is what actually pays
const CATCH_POINTS = 25;
const LEVEL_POINTS = 300;
const BEST_KEY = 'soda-tapper-best';

const PATRON_COLORS = ['#e06c5a', '#5aa7e0', '#8fbf62', '#c78ae0', '#e0b45a'];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';           // idle | running | paused | gameover
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let served = 0;               // customers served this game
let servedThisLevel = 0;
let spawnedThisLevel = 0;

let patrons = [];
let mugs = [];
let empties = [];
let particles = [];

const server = { lane: 0, drawY: 0 };

let pourTimer = 0;
let spawnTimer = FIRST_SPAWN_DELAY;
let bannerTimer = 0;
let bannerText = '';
let spawnEnabled = true;
let autoStep = true;
let rngState = 20260912;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elServed = document.getElementById('served');
const elLives = document.getElementById('lives');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rng() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
}

function laneY(lane) {
    return LANE_TOP + lane * LANE_H + LANE_H / 2;
}

function patronsForLevel(n) {
    return 4 + n;
}

function patronSpeed(n) {
    return Math.min(PATRON_SPEED_MAX, PATRON_SPEED_BASE + (n - 1) * PATRON_SPEED_STEP);
}

function spawnGap(n) {
    return Math.max(2.6, 3.6 - (n - 1) * 0.12);
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function spawnPatron(lane, x) {
    const patron = {
        lane,
        x: x === undefined ? BAR_LEFT : x,
        spawnX: x === undefined ? BAR_LEFT : x,
        speed: patronSpeed(level),
        state: 'advancing',
        drinkTimer: 0,
        retreatTarget: 0,
        color: PATRON_COLORS[Math.floor(rng() * PATRON_COLORS.length)],
        bob: rng() * Math.PI * 2,
        mugs: 0,
    };
    patrons.push(patron);
    return patron;
}

function spawnEmpty(lane) {
    const empty = { lane, x: BAR_LEFT, spin: 0 };
    empties.push(empty);
    return empty;
}

function clearEntities() {
    patrons = [];
    mugs = [];
    empties = [];
    particles = [];
}

function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x,
            y,
            vx: (rng() - 0.5) * 180,
            vy: -rng() * 150,
            life: 0.4 + rng() * 0.35,
            color,
        });
    }
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function moveLane(dir) {
    if (state !== 'running') return false;
    const next = clamp(server.lane + dir, 0, LANE_COUNT - 1);
    if (next === server.lane) return false;
    server.lane = next;
    return true;
}

function pour() {
    if (state !== 'running') return false;
    if (pourTimer > 0) return false;
    mugs.push({ lane: server.lane, x: MUG_START_X, wobble: 0 });
    pourTimer = POUR_COOLDOWN;
    burst(MUG_START_X, laneY(server.lane) + 6, '#ffd27a', 4);
    return true;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function loseLife(x, y) {
    burst(x, y, '#ef5d5d', 14);
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        endGame();
    }
}

function servePatron(patron) {
    patron.state = 'drinking';
    patron.drinkTimer = DRINK_TIME;
    patron.retreatTarget = patron.x - PUSH_DIST;
    patron.mugs += 1;
    // Every mug makes them rowdier: a patron you keep knocking back walks in
    // faster each time, so holding the line is a losing plan — the only way
    // out of a crowd is to actually push people off the end of the bar.
    patron.speed = Math.min(PATRON_SPEED_MAX * 2, patron.speed * DRINK_SPEEDUP);
    score += SERVE_POINTS;
    burst(patron.x, laneY(patron.lane), '#ffd27a', 6);
}

function patronLeaves(patron, index) {
    patrons.splice(index, 1);
    served += 1;
    servedThisLevel += 1;
    score += EXIT_POINTS;
    spawnEmpty(patron.lane);
    burst(BAR_LEFT, laneY(patron.lane), patron.color, 8);
}

function updatePatrons(dt) {
    for (let i = patrons.length - 1; i >= 0; i--) {
        const p = patrons[i];
        p.bob += dt * 6;

        if (p.state === 'drinking') {
            p.drinkTimer -= dt;
            if (p.drinkTimer <= 0) p.state = 'retreating';
            continue;
        }

        if (p.state === 'retreating') {
            p.x -= RETREAT_SPEED * dt;
            if (p.x <= BAR_LEFT) {
                patronLeaves(p, i);
                continue;
            }
            if (p.x <= p.retreatTarget) {
                p.x = p.retreatTarget;
                p.state = 'advancing';
            }
            continue;
        }

        p.x += p.speed * dt;
        if (p.x >= GRAB_X) {
            patrons.splice(i, 1);
            loseLife(GRAB_X, laneY(p.lane));
            if (state !== 'running') return;
        }
    }
}

// The mug hits the patron closest to the taps that it has caught up with.
// Only a patron walking the bar can take it: one who is already drinking or
// sliding back has their hands full, so the mug slides straight past them —
// which is what stops a held key from farming points off a single customer.
function mugTarget(mug) {
    let target = null;
    for (const p of patrons) {
        if (p.lane !== mug.lane) continue;
        if (p.state !== 'advancing') continue;
        if (Math.abs(mug.x - p.x) > HIT_DIST) continue;
        if (target === null || p.x > target.x) target = p;
    }
    return target;
}

function updateMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x -= MUG_SPEED * dt;
        m.wobble += dt * 18;

        const hit = mugTarget(m);
        if (hit) {
            mugs.splice(i, 1);
            servePatron(hit);
            continue;
        }

        if (m.x <= BAR_LEFT) {
            mugs.splice(i, 1);
            loseLife(BAR_LEFT, laneY(m.lane));
            if (state !== 'running') return;
        }
    }
}

function updateEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const e = empties[i];
        e.x += EMPTY_SPEED * dt;
        e.spin += dt * 9;
        if (e.x < CATCH_X) continue;

        empties.splice(i, 1);
        if (server.lane === e.lane) {
            score += CATCH_POINTS;
            burst(CATCH_X, laneY(e.lane), '#8fe0c0', 6);
        } else {
            loseLife(CATCH_X, laneY(e.lane));
            if (state !== 'running') return;
        }
    }
}

function pickLane() {
    // Prefer a bar whose far end is clear so arrivals do not stack up.
    for (let attempt = 0; attempt < 8; attempt++) {
        const lane = Math.floor(rng() * LANE_COUNT);
        const crowded = patrons.some((p) => p.lane === lane && p.x < BAR_LEFT + 48);
        if (!crowded) return lane;
    }
    return Math.floor(rng() * LANE_COUNT);
}

function updateSpawning(dt) {
    if (!spawnEnabled) return;
    if (spawnedThisLevel >= patronsForLevel(level)) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnPatron(pickLane(), BAR_LEFT);
    spawnedThisLevel += 1;
    spawnTimer = spawnGap(level) * (0.8 + rng() * 0.4);
}

function checkRoundComplete() {
    if (servedThisLevel < patronsForLevel(level)) return;
    if (patrons.length > 0) return;

    level += 1;
    score += LEVEL_POINTS;
    servedThisLevel = 0;
    spawnedThisLevel = 0;
    spawnTimer = FIRST_SPAWN_DELAY;
    bannerText = `ROUND ${level}`;
    bannerTimer = BANNER_TIME;
}

function step(dt) {
    if (state !== 'running') return;

    pourTimer = Math.max(0, pourTimer - dt);
    bannerTimer = Math.max(0, bannerTimer - dt);

    updateSpawning(dt);
    updatePatrons(dt);
    if (state !== 'running') return;
    updateMugs(dt);
    if (state !== 'running') return;
    updateEmpties(dt);
    if (state !== 'running') return;
    checkRoundComplete();
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 420 * dt;
    }

    const targetY = laneY(server.lane);
    server.drawY += (targetY - server.drawY) * Math.min(1, dt * 16);
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function showOverlay(title, sub, scoreText) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlayScore.textContent = scoreText || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function startGame() {
    state = 'running';
    score = 0;
    lives = START_LIVES;
    level = 1;
    served = 0;
    servedThisLevel = 0;
    spawnedThisLevel = 0;
    pourTimer = 0;
    spawnTimer = FIRST_SPAWN_DELAY;
    bannerText = 'ROUND 1';
    bannerTimer = BANNER_TIME;
    rngState = 20260912;
    clearEntities();
    server.lane = 0;
    server.drawY = laneY(0);
    hideOverlay();
    updateHud();
}

function endGame() {
    state = 'gameover';
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage unavailable — keep the score in memory only */
        }
    }
    showOverlay(
        'SHIFT OVER',
        'Press Space or click Start to play again',
        `Score ${score} · Round ${level} · Served ${served}`
    );
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', 'Press P to get back to work', `Score ${score}`);
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function setAutoStep(value) {
    autoStep = !!value;
}

function setSpawnEnabled(value) {
    spawnEnabled = !!value;
}

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elServed.textContent = String(served);
    elLives.textContent = String(lives);
    elBest.textContent = String(best);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

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
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#1b1712');
    sky.addColorStop(1, '#0b0d14');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Tap wall on the right.
    ctx.fillStyle = '#221d16';
    ctx.fillRect(BAR_RIGHT + 6, 0, CANVAS_W - BAR_RIGHT - 6, CANVAS_H);
    ctx.fillStyle = '#2d261c';
    ctx.fillRect(0, 0, BAR_LEFT - 18, CANVAS_H);
}

function drawBar(lane) {
    const y = laneY(lane);
    const top = y + 16;

    // Back wall panel behind this bar, so the four bars read as separate rooms.
    ctx.fillStyle = lane % 2 ? 'rgba(255, 226, 180, 0.035)' : 'rgba(255, 226, 180, 0.06)';
    ctx.fillRect(BAR_LEFT - 18, y - 48, BAR_RIGHT - BAR_LEFT + 40, 64);

    // Counter top.
    const wood = ctx.createLinearGradient(0, top, 0, top + 16);
    wood.addColorStop(0, '#8a5a30');
    wood.addColorStop(1, '#4e3119');
    ctx.fillStyle = wood;
    ctx.fillRect(BAR_LEFT - 18, top, BAR_RIGHT - BAR_LEFT + 40, 16);

    ctx.fillStyle = 'rgba(255, 214, 150, 0.18)';
    ctx.fillRect(BAR_LEFT - 18, top, BAR_RIGHT - BAR_LEFT + 40, 3);

    // Shadow under the counter.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(BAR_LEFT - 18, top + 16, BAR_RIGHT - BAR_LEFT + 40, 8);

    // Tap tower at the serving end.
    ctx.fillStyle = '#9aa3b2';
    ctx.fillRect(BAR_RIGHT + 2, y - 22, 10, 38);
    ctx.fillStyle = '#c9d2e0';
    ctx.fillRect(BAR_RIGHT - 4, y - 4, 10, 6);

    // Doorway the patrons come through.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(BAR_LEFT - 34, y - 30, 16, 46);
}

function drawPatron(p) {
    const y = laneY(p.lane);
    const walking = p.state === 'advancing';
    const swing = walking ? Math.sin(p.bob) : 0;
    const base = y + 16 + (walking ? Math.abs(swing) * 1.4 : 0);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.beginPath();
    ctx.ellipse(p.x, base + 1, 12, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs — they stride while walking and plant while drinking.
    ctx.strokeStyle = '#2f2a24';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x - 2, base - 11);
    ctx.lineTo(p.x - 2 + swing * 5, base - 1);
    ctx.moveTo(p.x + 2, base - 11);
    ctx.lineTo(p.x + 2 - swing * 5, base - 1);
    ctx.stroke();

    // Torso: shoulders wider than the waist so it reads as a person.
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(p.x - 10, base - 24);
    ctx.lineTo(p.x + 10, base - 24);
    ctx.lineTo(p.x + 7, base - 9);
    ctx.lineTo(p.x - 7, base - 9);
    ctx.closePath();
    ctx.fill();

    // Arms.
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(p.x - 9, base - 22);
    ctx.lineTo(p.x - 12, base - 13 + swing * 2);
    ctx.moveTo(p.x + 9, base - 22);
    if (p.state === 'drinking') ctx.lineTo(p.x + 9, base - 27);
    else ctx.lineTo(p.x + 12, base - 13 - swing * 2);
    ctx.stroke();

    // Head and hat.
    ctx.fillStyle = '#f0d3b0';
    ctx.beginPath();
    ctx.arc(p.x, base - 31, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#3a2d1f';
    ctx.fillRect(p.x - 10, base - 37, 20, 3);
    ctx.fillRect(p.x - 6, base - 43, 12, 6);

    if (p.state === 'drinking') {
        drawMug(p.x + 13, base - 42, true, 0);
        // Bubbles over a happy customer.
        ctx.fillStyle = 'rgba(255, 235, 190, 0.75)';
        ctx.beginPath();
        ctx.arc(p.x + 16, base - 50, 2.2, 0, Math.PI * 2);
        ctx.arc(p.x + 21, base - 57, 1.6, 0, Math.PI * 2);
        ctx.fill();
    }

    if (p.state === 'retreating') {
        // Speed lines trailing the customer as they slide back down the bar.
        ctx.strokeStyle = 'rgba(255, 230, 180, 0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x + 14, base - 20);
        ctx.lineTo(p.x + 26, base - 20);
        ctx.moveTo(p.x + 14, base - 13);
        ctx.lineTo(p.x + 22, base - 13);
        ctx.stroke();
    }
}

function drawMug(x, y, full, tilt) {
    ctx.save();
    ctx.translate(x, y + 6);
    ctx.rotate(Math.sin(tilt) * 0.07);

    ctx.fillStyle = full ? '#d8a44e' : '#5d6470';
    roundRect(-7, -16, 14, 16, 3);
    ctx.fill();

    ctx.strokeStyle = full ? '#f0c470' : '#79818f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(8, -9, 4, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    if (full) {
        ctx.fillStyle = '#fff4dc';
        roundRect(-7, -20, 14, 6, 3);
        ctx.fill();
    }
    ctx.restore();
}

function drawServer() {
    const y = server.drawY;
    const x = BAR_RIGHT + 34;
    const base = y + 16;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, base + 1, 13, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e8eef8';
    roundRect(x - 10, base - 28, 20, 28, 5);
    ctx.fill();

    ctx.fillStyle = '#ffb347';
    roundRect(x - 8, base - 14, 16, 14, 3);
    ctx.fill();

    ctx.fillStyle = '#f0d3b0';
    ctx.beginPath();
    ctx.arc(x, base - 35, 7.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2b3242';
    ctx.fillRect(x - 8, base - 43, 16, 5);

    // Arm reaching over the counter toward the tap.
    ctx.strokeStyle = '#f0d3b0';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 8, base - 22);
    ctx.lineTo(x - 22, base - 14);
    ctx.stroke();
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

function drawBanner() {
    if (bannerTimer <= 0 || !bannerText) return;
    ctx.globalAlpha = Math.min(1, bannerTimer / 0.5);
    ctx.fillStyle = 'rgba(6, 8, 14, 0.65)';
    ctx.fillRect(0, CANVAS_H / 2 - 28, CANVAS_W, 56);
    ctx.fillStyle = '#ffb347';
    ctx.font = 'bold 30px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(bannerText, CANVAS_W / 2, CANVAS_H / 2);
    ctx.globalAlpha = 1;
}

function drawLives() {
    for (let i = 0; i < lives; i++) {
        ctx.fillStyle = '#ffd27a';
        roundRect(12 + i * 14, 14, 9, 12, 2);
        ctx.fill();
    }
}

function draw() {
    drawBackground();
    for (let lane = 0; lane < LANE_COUNT; lane++) drawBar(lane);

    // Highlight the bar the server is working.
    ctx.fillStyle = 'rgba(255, 179, 71, 0.07)';
    ctx.fillRect(BAR_LEFT - 18, laneY(server.lane) - 44, BAR_RIGHT - BAR_LEFT + 40, 66);

    for (const p of patrons) drawPatron(p);
    for (const m of mugs) drawMug(m.x, laneY(m.lane), true, m.wobble);
    for (const e of empties) drawMug(e.x, laneY(e.lane), false, e.spin);

    drawServer();
    drawParticles();
    drawLives();
    drawBanner();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();

    if (key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else if (state === 'running') pour();
        return;
    }

    if (key === 'p' || key === 'escape') {
        e.preventDefault();
        togglePause();
        return;
    }

    if (key === 'arrowup' || key === 'w') {
        e.preventDefault();
        moveLane(-1);
        return;
    }

    if (key === 'arrowdown' || key === 's') {
        e.preventDefault();
        moveLane(1);
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

canvas.addEventListener('click', () => {
    if (state === 'running') pour();
});

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same step() the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;

function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;   // clamp after tab switches / long frames
    if (autoStep && state === 'running') step(dt);
    updateParticles(dt);
    draw();
    updateHud();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function loadBest() {
    try {
        const stored = Number(window.localStorage.getItem(BEST_KEY));
        return Number.isFinite(stored) && stored > 0 ? stored : 0;
    } catch (err) {
        return 0;
    }
}

best = loadBest();
server.drawY = laneY(0);
showOverlay('SODA TAPPER', 'Press Space or click Start to play', '');
updateHud();
requestAnimationFrame(frame);
