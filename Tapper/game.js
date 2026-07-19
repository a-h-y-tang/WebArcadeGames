// ---------------------------------------------------------------------------
// Tapper — the arcade bartender. Patrons stream in from the left of four bars
// and march toward the counter on the right. Slide a mug of root beer down your
// current lane to serve the nearest patron before they reach you. Miss one and
// you lose a life; clear a whole wave and the next crowd arrives faster.
//
// Motion is time-based (pixels per second) and integrated by `update(dt)`
// (seconds). The serve / miss / wave logic lives inside `update()` so tests can
// build an exact scenario (a patron and a mug at known x positions in a known
// lane) and assert the outcome. Only the *lane* a spawned patron appears in is
// random — the physics the tests check are fully deterministic.
// ---------------------------------------------------------------------------

const WIDTH = 480;
const HEIGHT = 640;
const LANES = 4;

// Geometry
const LANE_TOP = 110;            // y of the first lane's top
const LANE_H = 120;              // lane height
const LEFT_X = 40;               // x where patrons enter
const LEFT_WALL = 24;            // a mug past this (to the left) is wasted
const DANGER_X = WIDTH - 52;     // a patron reaching this loses a life
const MUG_START_X = WIDTH - 60;  // x where a poured mug begins
const CUST_HALF = 15;            // patron half-width (collision)
const MUG_HALF = 11;             // mug half-width (collision)
const HIT = CUST_HALF + MUG_HALF;
const MUG_SPEED = 320;           // mug slide speed (px / second)

// Wave tuning ---------------------------------------------------------------
function patronsForWave(w) { return 4 + w * 2; }            // wave 1 → 6 patrons
function patronSpeedFor(w) { return 34 + (w - 1) * 7; }     // px / second
function spawnIntervalFor(w) { return Math.max(0.55, 1.5 - (w - 1) * 0.12); }
function pointsFor(w) { return 10 * w; }

// DOM -----------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const waveEl = document.getElementById('wave');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// State ---------------------------------------------------------------------
// patrons: array of { lane, x, vx } — x is the patron's centre, vx > 0.
// mugs:    array of { lane, x, vx } — vx < 0, sliding left.
let bartenderLane, patrons, mugs;
let score, best, lives, wave;
let patronSpeed, spawnInterval, spawnTimer, patronsToSpawn;
let state, lastTime, animId;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function laneY(i) { return LANE_TOP + LANE_H * (i + 0.5); }

function updateScore() { scoreEl.textContent = score; }
function updateBest() { bestEl.textContent = best; }
function updateLives() { livesEl.textContent = Math.max(0, lives); }
function updateWave() { waveEl.textContent = wave; }

function randInt(n) { return Math.floor(Math.random() * n); }

// A new thirsty patron enters a (random) lane from the left.
function spawnPatron() {
    patrons.push({ lane: randInt(LANES), x: LEFT_X, vx: patronSpeed });
    patronsToSpawn--;
}

// Pour a mug down the bartender's current lane.
function pour() {
    mugs.push({ lane: bartenderLane, x: MUG_START_X, vx: -MUG_SPEED });
}

// ---------------------------------------------------------------------------
// Simulation step — deliberately not gated on `state` so tests can drive it.
// ---------------------------------------------------------------------------
function update(dt) {
    // 1. Move mugs (left) and patrons (right).
    for (const m of mugs) m.x += m.vx * dt;
    for (const p of patrons) p.x += p.vx * dt;

    // 2. Release new patrons on the wave timer.
    if (patronsToSpawn > 0) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            spawnPatron();
            spawnTimer += spawnInterval;
            if (spawnTimer < 0) spawnTimer = spawnInterval;
        }
    }

    // 3. Serve: each mug catches the most-advanced patron it has reached in its
    //    own lane.
    const servedPatrons = new Set();
    const usedMugs = new Set();
    for (let mi = 0; mi < mugs.length; mi++) {
        const m = mugs[mi];
        let pick = -1;
        let pickX = -Infinity;
        for (let pi = 0; pi < patrons.length; pi++) {
            if (servedPatrons.has(pi)) continue;
            const p = patrons[pi];
            if (p.lane !== m.lane) continue;
            if (m.x - p.x <= HIT) {              // mug has reached/passed the patron
                if (p.x > pickX) { pickX = p.x; pick = pi; }
            }
        }
        if (pick >= 0) {
            servedPatrons.add(pick);
            usedMugs.add(mi);
            score += pointsFor(wave);
            updateScore();
        }
    }
    if (usedMugs.size) mugs = mugs.filter((_, i) => !usedMugs.has(i));
    if (servedPatrons.size) patrons = patrons.filter((_, i) => !servedPatrons.has(i));

    // 4. Discard mugs that slid off the left wall without catching anyone.
    mugs = mugs.filter(m => m.x > LEFT_WALL);

    // 5. Any patron that reached the counter costs a life.
    const survivors = [];
    for (const p of patrons) {
        if (p.x >= DANGER_X) loseLife();
        else survivors.push(p);
    }
    patrons = survivors;

    // 6. Wave cleared? (only while a real game is running)
    if (state === 'running' && patronsToSpawn === 0 && patrons.length === 0) {
        nextWave();
    }
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------
function loseLife() {
    lives--;
    updateLives();
    if (lives <= 0) endGame();
}

function nextWave() {
    wave++;
    updateWave();
    patronsToSpawn = patronsForWave(wave);
    patronSpeed = patronSpeedFor(wave);
    spawnInterval = spawnIntervalFor(wave);
    spawnTimer = spawnInterval;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function startGame() {
    score = 0;
    lives = 3;
    wave = 1;
    patrons = [];
    mugs = [];
    bartenderLane = 0;

    patronSpeed = patronSpeedFor(1);
    spawnInterval = spawnIntervalFor(1);
    spawnTimer = 0.8;                // small delay before the first patron
    patronsToSpawn = patronsForWave(1);

    updateScore();
    updateLives();
    updateWave();

    overlay.classList.remove('visible');
    state = 'running';
    lastTime = null;
    btnStart.blur();
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('tapper-best', String(best)); } catch (e) { /* ignore */ }
        updateBest();
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = 'Score: ' + score + '  ·  Wave ' + wave;
    overlaySub.textContent = 'Last call! Press Space to serve again.';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function pauseGame() {
    state = 'paused';
    overlayTitle.textContent = 'Paused';
    overlayScore.textContent = '';
    overlaySub.textContent = 'Press P to resume';
    btnStart.textContent = 'Resume';
    overlay.classList.add('visible');
}

function resumeGame() {
    state = 'running';
    lastTime = null;
    overlay.classList.remove('visible');
    btnStart.blur();
    animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
function loop(timestamp) {
    if (state !== 'running') return;
    if (lastTime == null) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.05) dt = 0.05;       // clamp big gaps (tab switches)

    update(dt);
    draw();
    if (state === 'running') animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function draw() {
    ctx.fillStyle = '#1c130a';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    for (let i = 0; i < LANES; i++) drawBar(i);

    if (state !== 'idle') {
        for (const p of patrons) drawPatron(p);
        for (const m of mugs) drawMug(m);
        drawBartender();
    }
}

function drawBar(i) {
    const y = laneY(i);
    // Bar counter plank
    ctx.fillStyle = '#5a3d1e';
    ctx.fillRect(0, y + 24, WIDTH, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, y + 24, WIDTH, 4);
    // Counter end (danger zone) on the right
    ctx.fillStyle = 'rgba(200, 70, 40, 0.18)';
    ctx.fillRect(DANGER_X, y - 30, WIDTH - DANGER_X, 70);
}

function drawBartender() {
    const y = laneY(bartenderLane);
    const x = WIDTH - 30;
    // Apron/body
    ctx.fillStyle = '#e8e0d0';
    ctx.fillRect(x - 12, y - 18, 24, 34);
    // Head
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(x, y - 26, 9, 0, Math.PI * 2);
    ctx.fill();
    // Tap handle
    ctx.fillStyle = '#ffcf70';
    ctx.fillRect(x - 20, y - 4, 8, 12);
}

function drawPatron(p) {
    const y = laneY(p.lane);
    // Body
    ctx.fillStyle = '#c25b4a';
    ctx.fillRect(p.x - CUST_HALF + 2, y - 16, (CUST_HALF - 2) * 2, 30);
    // Head
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(p.x, y - 24, 8, 0, Math.PI * 2);
    ctx.fill();
    // Empty hand / anticipation
    ctx.fillStyle = '#7a3226';
    ctx.fillRect(p.x + CUST_HALF - 4, y - 4, 6, 8);
}

function drawMug(m) {
    const y = laneY(m.lane) + 4;
    // Mug body
    ctx.fillStyle = '#e8a33d';
    ctx.fillRect(m.x - MUG_HALF, y - 8, MUG_HALF * 2, 16);
    // Foam
    ctx.fillStyle = '#fff4dc';
    ctx.fillRect(m.x - MUG_HALF, y - 12, MUG_HALF * 2, 5);
    // Handle
    ctx.strokeStyle = '#e8a33d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(m.x + MUG_HALF, y, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function moveLane(delta) {
    bartenderLane = clamp(bartenderLane + delta, 0, LANES - 1);
}

function isPourKey(k) {
    return k === ' ' || k === 'Spacebar' || k === 'Enter';
}

document.addEventListener('keydown', e => {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    if (k === 'ArrowUp' || k === 'w' || k === 'W') {
        if (state === 'running') moveLane(-1);
        e.preventDefault();
        return;
    }
    if (k === 'ArrowDown' || k === 's' || k === 'S') {
        if (state === 'running') moveLane(1);
        e.preventDefault();
        return;
    }

    if (isPourKey(k)) {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') pour();
    }
});

canvas.addEventListener('pointerdown', () => {
    if (state === 'running') pour();
    else if (state === 'idle' || state === 'over') startGame();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init — a still title frame behind the start overlay.
// ---------------------------------------------------------------------------
best = parseInt(localStorage.getItem('tapper-best') || '0', 10);
if (!Number.isFinite(best)) best = 0;
score = 0;
lives = 3;
wave = 1;
updateBest();
updateScore();
updateLives();
updateWave();

bartenderLane = 0;
patrons = [];
mugs = [];
patronSpeed = patronSpeedFor(1);
spawnInterval = spawnIntervalFor(1);
spawnTimer = 0.8;
patronsToSpawn = patronsForWave(1);
state = 'idle';
draw();
