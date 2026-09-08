// ---------------------------------------------------------------------------
// Soda Tapper — a Tapper-style arcade game about keeping four counters clear.
//
// Customers walk in at the open end of a counter and march toward the taps.
// The soda jerk slides full mugs down the counter to shove them back; shove a
// customer off the end and they leave happy, tossing the empty mug back up the
// counter for the jerk to catch. Mugs that shatter at either end, and customers
// that reach the taps, cost a life.
//
// Written as a single classic (non-module) script so state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Lode Runner,
// Kaboom and Tetris in this repo. The whole simulation advances through
// `step(dt)`, so tests run frames deterministically instead of leaning on
// requestAnimationFrame wall clocks.
// ---------------------------------------------------------------------------

// --- Canvas geometry ---
const CANVAS_W = 720;
const CANVAS_H = 460;

// --- Counters ---
const LANES = 4;
const LANE_TOP = 96;        // y of the first counter
const LANE_H = 92;          // spacing between counters
const BAR_LEFT = 40;        // open end: customers enter, poured mugs shatter
const BAR_RIGHT = 640;      // tap end: mugs are poured, empties are caught

// --- Speeds (px/second) ---
const MUG_SPEED = 210;      // full mug sliding toward the open end
const EMPTY_SPEED = 165;    // returned empty mug sliding back to the taps
const PATRON_SPEED = 24;    // wave 1 walking speed
const PATRON_SPEED_STEP = 6;// added per wave

// --- Rules ---
const START_LIVES = 3;
const PUSH_DISTANCE = 150;  // how far one mug shoves a customer back
const DRINK_TIME = 1.0;     // pause after being served, in seconds
const POUR_COOLDOWN = 0.28;
const HIT_DIST = 24;        // mug/customer overlap radius
const PATRONS_BASE = 4;
const PATRONS_PER_LEVEL = 2;
const SPAWN_BASE = 2.6;
const SPAWN_STEP = 0.25;
const SPAWN_MIN = 0.9;
const MAX_ON_SCREEN = 6;

// --- Scoring ---
const SERVE_POINTS = 100;
const CATCH_POINTS = 50;
const LEVEL_BONUS = 250;
const BEST_KEY = 'soda-tapper-best';

// --- Drawing ---
const PATRON_COLORS = ['#e2664f', '#6fa8dc', '#8fbf6a', '#c98bd6', '#e0b04a'];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

let state = 'idle';         // idle | running | paused | gameover
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let lane = 0;               // counter the soda jerk is standing at
let patrons = [];
let mugs = [];
let particles = [];
let remaining = 0;          // customers of this wave still to walk in
let spawnTimer = 0;
let pourTimer = 0;
let jerkBob = 0;            // purely cosmetic
let autoStep = true;        // tests switch this off and drive step() themselves
let spawning = true;        // tests switch this off and place customers by hand

// Seeded RNG (mulberry32) so arrival lanes are reproducible in tests.
let rngState = 0x9e3779b9;

function setSeed(seed) {
    rngState = (seed >>> 0) || 1;
}

function rng() {
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function laneY(index) {
    return LANE_TOP + index * LANE_H;
}

function patronsForLevel(n) {
    return PATRONS_BASE + n * PATRONS_PER_LEVEL;
}

function spawnIntervalForLevel(n) {
    return Math.max(SPAWN_MIN, SPAWN_BASE - (n - 1) * SPAWN_STEP);
}

function patronSpeed() {
    return PATRON_SPEED + (level - 1) * PATRON_SPEED_STEP;
}

// ---------------------------------------------------------------------------
// Test / control hooks
// ---------------------------------------------------------------------------

function setAutoStep(on) {
    autoStep = !!on;
}

function setSpawning(on) {
    spawning = !!on;
}

function setRemaining(n) {
    remaining = Math.max(0, Math.floor(n));
}

function clearBoard() {
    patrons = [];
    mugs = [];
}

function getConfig() {
    return {
        CANVAS_W, CANVAS_H, LANES, LANE_TOP, LANE_H, BAR_LEFT, BAR_RIGHT,
        MUG_SPEED, EMPTY_SPEED, PATRON_SPEED, PUSH_DISTANCE, DRINK_TIME,
        POUR_COOLDOWN, HIT_DIST, START_LIVES, SERVE_POINTS, CATCH_POINTS,
        LEVEL_BONUS,
    };
}

function getState() {
    return {
        state,
        score,
        best,
        lives,
        level,
        lane,
        remaining,
        patrons: patrons.map((p) => ({
            lane: p.lane,
            x: p.x,
            drinking: p.drink > 0,
            served: p.served,
        })),
        mugs: mugs.map((m) => ({ lane: m.lane, x: m.x, empty: m.empty })),
    };
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

function spawnPatron(laneIndex, x) {
    const p = {
        lane: Math.max(0, Math.min(LANES - 1, laneIndex | 0)),
        x: typeof x === 'number' ? x : BAR_LEFT + 6,
        drink: 0,
        served: false,
        color: PATRON_COLORS[Math.floor(rng() * PATRON_COLORS.length)],
        bob: rng() * Math.PI * 2,
    };
    patrons.push(p);
    return p;
}

function spawnMug(laneIndex, x) {
    const m = {
        lane: laneIndex,
        x: typeof x === 'number' ? x : BAR_RIGHT - 12,
        empty: false,
    };
    mugs.push(m);
    return m;
}

function spawnEmptyMug(laneIndex, x) {
    const m = {
        lane: laneIndex,
        x: typeof x === 'number' ? x : BAR_LEFT + 10,
        empty: true,
    };
    mugs.push(m);
    return m;
}

function pour() {
    if (state !== 'running') return null;
    if (pourTimer > 0) return null;
    pourTimer = POUR_COOLDOWN;
    return spawnMug(lane);
}

function moveLane(delta) {
    if (state !== 'running') return;
    lane = Math.max(0, Math.min(LANES - 1, lane + delta));
}

// ---------------------------------------------------------------------------
// Life loss / game over
// ---------------------------------------------------------------------------

function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x,
            y,
            vx: (Math.random() - 0.5) * 200,
            vy: -Math.random() * 160 - 20,
            life: 0.5 + Math.random() * 0.4,
            color,
        });
    }
}

function loseLife(x, y) {
    burst(x, y, '#ffd9a0', 14);
    lives -= 1;
    clearBoard();
    pourTimer = 0;
    spawnTimer = 0.8;
    if (lives <= 0) {
        lives = 0;
        gameOver();
    }
}

function saveBest() {
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage unavailable — the run still counts, it just is not kept */
        }
    }
}

function gameOver() {
    state = 'gameover';
    saveBest();
    showOverlay('GAME OVER', `Score ${score} — Wave ${level}`, 'Press Space to serve again');
    updateHud();
}

function startLevel(n) {
    level = n;
    remaining = patronsForLevel(n);
    spawnTimer = 0.6;
    pourTimer = 0;
    clearBoard();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    lane = 0;
    particles = [];
    state = 'running';
    startLevel(1);
    hideOverlay();
    updateHud();
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
// Simulation — every rule of the game lives here so tests can drive it.
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    if (pourTimer > 0) pourTimer = Math.max(0, pourTimer - dt);
    jerkBob += dt;

    stepSpawns(dt);
    stepPatrons(dt);
    if (state !== 'running') return;   // a customer reached the taps
    stepMugs(dt);
    if (state !== 'running') return;   // a mug shattered
    checkWaveComplete();
}

function stepSpawns(dt) {
    if (!spawning || remaining <= 0) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnIntervalForLevel(level);
    if (patrons.length >= MAX_ON_SCREEN) return;
    spawnPatron(Math.floor(rng() * LANES));
    remaining -= 1;
}

function stepPatrons(dt) {
    const speed = patronSpeed();
    for (const p of patrons) {
        if (p.drink > 0) {
            p.drink = Math.max(0, p.drink - dt);
            continue;
        }
        p.x += speed * dt;
        if (p.x >= BAR_RIGHT) {
            // Reached the taps and grabbed the soda jerk.
            loseLife(BAR_RIGHT - 10, laneY(p.lane));
            return;
        }
    }
}

function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        if (m.empty) {
            m.x += EMPTY_SPEED * dt;
            if (m.x >= BAR_RIGHT) {
                mugs.splice(i, 1);
                if (m.lane === lane) {
                    score += CATCH_POINTS;
                    burst(BAR_RIGHT, laneY(m.lane), '#cfd6e2', 6);
                } else {
                    loseLife(BAR_RIGHT, laneY(m.lane));
                    return;
                }
            }
            continue;
        }

        m.x -= MUG_SPEED * dt;

        const hit = findPatron(m);
        if (hit) {
            mugs.splice(i, 1);
            servePatron(hit);
            continue;
        }

        if (m.x <= BAR_LEFT) {
            // Nobody there to catch it — the mug smashes on the floor.
            mugs.splice(i, 1);
            loseLife(BAR_LEFT, laneY(m.lane));
            return;
        }
    }
}

function findPatron(mug) {
    let closest = null;
    for (const p of patrons) {
        if (p.lane !== mug.lane) continue;
        if (Math.abs(p.x - mug.x) > HIT_DIST) continue;
        if (!closest || p.x > closest.x) closest = p;
    }
    return closest;
}

function servePatron(p) {
    p.x -= PUSH_DISTANCE;
    p.drink = DRINK_TIME;
    if (p.x <= BAR_LEFT) {
        // Shoved right out of the door — happy customer, empty mug back.
        const index = patrons.indexOf(p);
        if (index >= 0) patrons.splice(index, 1);
        score += SERVE_POINTS;
        spawnEmptyMug(p.lane, BAR_LEFT + 10);
        burst(BAR_LEFT + 16, laneY(p.lane), '#ffe6a8', 8);
    }
    updateHud();
}

function checkWaveComplete() {
    if (remaining > 0 || patrons.length > 0 || mugs.length > 0) return;
    score += LEVEL_BONUS;
    startLevel(level + 1);
    updateHud();
}

// ---------------------------------------------------------------------------
// Cosmetic particles — driven by the frame loop, never by step().
// ---------------------------------------------------------------------------

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const q = particles[i];
        q.life -= dt;
        if (q.life <= 0) {
            particles.splice(i, 1);
            continue;
        }
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vy += 620 * dt;
    }
}

// ---------------------------------------------------------------------------
// Drawing — a pure function of the state above.
// ---------------------------------------------------------------------------

function draw() {
    drawRoom();
    for (let i = 0; i < LANES; i++) drawCounter(i);
    for (const p of patrons) drawPatron(p);
    for (const m of mugs) drawMug(m);
    drawJerk();
    drawParticles();
}

function drawRoom() {
    const wall = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    wall.addColorStop(0, '#2a1a12');
    wall.addColorStop(1, '#150d09');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Warm light over the counter the soda jerk is working.
    const y = laneY(lane);
    const glow = ctx.createLinearGradient(0, y - 60, 0, y + 34);
    glow.addColorStop(0, 'rgba(255, 179, 71, 0)');
    glow.addColorStop(1, 'rgba(255, 179, 71, 0.16)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, y - 60, CANVAS_W, 94);

    // Doorway at the open end where the crowd arrives.
    ctx.fillStyle = '#0d0806';
    ctx.fillRect(0, 0, BAR_LEFT - 12, CANVAS_H);
    for (let i = 0; i < LANES; i++) {
        const ly = laneY(i);
        ctx.fillStyle = '#1d120c';
        ctx.beginPath();
        ctx.roundRect(2, ly - 48, BAR_LEFT - 16, 62, [12, 12, 0, 0]);
        ctx.fill();
    }
    ctx.fillStyle = '#3b2618';
    ctx.fillRect(BAR_LEFT - 14, 0, 4, CANVAS_H);

    // Tap wall behind the soda jerk.
    ctx.fillStyle = '#241610';
    ctx.fillRect(BAR_RIGHT + 12, 0, CANVAS_W - BAR_RIGHT - 12, CANVAS_H);
    ctx.fillStyle = '#2f1e15';
    for (let x = BAR_RIGHT + 20; x < CANVAS_W; x += 26) {
        ctx.fillRect(x, 0, 2, CANVAS_H);
    }
    ctx.fillStyle = '#3b2618';
    ctx.fillRect(BAR_RIGHT + 10, 0, 4, CANVAS_H);
}

function drawCounter(index) {
    const y = laneY(index);

    if (index === lane) {
        ctx.fillStyle = 'rgba(255, 205, 130, 0.10)';
        ctx.fillRect(BAR_LEFT - 10, y - 44, BAR_RIGHT - BAR_LEFT + 30, 58);
    }

    // Counter top
    ctx.fillStyle = '#7a4c28';
    ctx.fillRect(BAR_LEFT - 10, y + 12, BAR_RIGHT - BAR_LEFT + 30, 16);
    ctx.fillStyle = '#9a6234';
    ctx.fillRect(BAR_LEFT - 10, y + 12, BAR_RIGHT - BAR_LEFT + 30, 5);
    ctx.fillStyle = '#4b2c16';
    ctx.fillRect(BAR_LEFT - 10, y + 26, BAR_RIGHT - BAR_LEFT + 30, 4);

    // Tap head at the right end of this counter.
    ctx.fillStyle = '#c9c3b6';
    ctx.fillRect(BAR_RIGHT + 2, y - 16, 8, 28);
    ctx.fillStyle = '#8d8578';
    ctx.fillRect(BAR_RIGHT - 4, y - 4, 10, 6);
}

function drawPatron(p) {
    const y = laneY(p.lane);
    const bob = Math.sin(jerkBob * 6 + p.bob) * (p.drink > 0 ? 0 : 1.5);
    const baseY = y + 12 + bob;

    // Body
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.roundRect(p.x - 11, baseY - 30, 22, 30, 5);
    ctx.fill();

    // Head
    ctx.fillStyle = '#f2c99a';
    ctx.beginPath();
    ctx.arc(p.x, baseY - 38, 8, 0, Math.PI * 2);
    ctx.fill();

    // Hat brim so the crowd reads as a crowd, not as dots.
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(p.x - 10, baseY - 45, 20, 3);

    if (p.drink > 0) {
        // Raised mug while drinking.
        ctx.fillStyle = '#ffcf6b';
        ctx.fillRect(p.x + 8, baseY - 40, 9, 11);
        ctx.fillStyle = '#fff6e0';
        ctx.fillRect(p.x + 8, baseY - 42, 9, 3);
    }
}

function drawMug(m) {
    const y = laneY(m.lane) + 12;
    const body = m.empty ? '#b9c1cc' : '#ffb02e';
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(m.x - 8, y - 20, 16, 20, 3);
    ctx.fill();
    ctx.strokeStyle = m.empty ? '#8e97a3' : '#c47d10';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(m.x + 11, y - 11, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    if (!m.empty) {
        ctx.fillStyle = '#fff4dc';
        ctx.beginPath();
        ctx.roundRect(m.x - 8, y - 24, 16, 6, 3);
        ctx.fill();
    }
}

function drawJerk() {
    const y = laneY(lane) + 12;
    const x = BAR_RIGHT + 42;
    const bob = state === 'running' ? Math.sin(jerkBob * 5) * 1.5 : 0;

    // Apron / body
    ctx.fillStyle = '#f0f2f5';
    ctx.beginPath();
    ctx.roundRect(x - 14, y - 34 + bob, 28, 34, 6);
    ctx.fill();
    ctx.fillStyle = '#c8442f';
    ctx.fillRect(x - 14, y - 14 + bob, 28, 6);

    // Head + cap
    ctx.fillStyle = '#f2c99a';
    ctx.beginPath();
    ctx.arc(x, y - 44 + bob, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0f2f5';
    ctx.fillRect(x - 10, y - 54 + bob, 20, 5);

    // Arm reaching for the tap of the current counter
    ctx.strokeStyle = '#f2c99a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - 12, y - 26 + bob);
    ctx.lineTo(BAR_RIGHT + 6, y - 18);
    ctx.stroke();
}

function drawParticles() {
    for (const q of particles) {
        ctx.globalAlpha = Math.max(0, Math.min(1, q.life * 2));
        ctx.fillStyle = q.color;
        ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elLives.textContent = String(lives);
    elBest.textContent = String(Math.max(best, score));
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    overlaySub.textContent = sub || '';
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Game';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const HANDLED_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
    'KeyW', 'KeyS', 'KeyP', 'Enter',
]);

window.addEventListener('keydown', (e) => {
    if (HANDLED_KEYS.has(e.code)) e.preventDefault();

    if (e.code === 'KeyP') {
        togglePause();
        return;
    }

    if (state === 'idle' || state === 'gameover') {
        if (e.code === 'Space' || e.code === 'Enter') startGame();
        return;
    }

    if (state !== 'running') return;

    switch (e.code) {
        case 'ArrowUp':
        case 'KeyW':
            moveLane(-1);
            break;
        case 'ArrowDown':
        case 'KeyS':
            moveLane(1);
            break;
        case 'Space':
            pour();
            break;
        default:
            break;
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
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
setSeed(Date.now() & 0xffff);
remaining = patronsForLevel(1);
showOverlay('SODA TAPPER', '', 'Press Space or click Start to play');
updateHud();
draw();
requestAnimationFrame(frame);
