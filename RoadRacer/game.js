// ===========================================================================
// Road Racer — a top-down highway-dodging arcade game.
//
// The simulation is deterministic and time-decoupled: the render loop measures
// a frame delta and calls step(dt), but the Playwright suite drives step()
// directly with fixed deltas and pokes the exposed globals. Collisions are
// resolved on every step() call regardless of the delta size.
// ===========================================================================

// --- Geometry --------------------------------------------------------------
const WIDTH = 400;
const HEIGHT = 600;

const ROAD_MARGIN = 56;                       // grass shoulder width per side
const ROAD_LEFT = ROAD_MARGIN;                // 56
const ROAD_RIGHT = WIDTH - ROAD_MARGIN;       // 344
const ROAD_WIDTH = ROAD_RIGHT - ROAD_LEFT;    // 288

const LANE_COUNT = 3;
const LANE_WIDTH = ROAD_WIDTH / LANE_COUNT;   // 96

const CAR_W = 46;
const CAR_H = 76;

// Centre x of lane i (0-indexed, left to right).
function laneCenter(i) {
    return ROAD_LEFT + LANE_WIDTH * (i + 0.5);
}

// --- Tuning ----------------------------------------------------------------
const PLAYER_SPEED = 0.34;      // px per ms of horizontal steering
const BASE_SCROLL = 0.22;       // px per ms at score 0
const SCROLL_RAMP = 0.0006;     // extra px/ms per point of score
const MAX_SCROLL_ADD = 0.33;    // cap on the ramp
const MAX_SCROLL_SPEED = BASE_SCROLL + MAX_SCROLL_ADD;
const SCORE_UNIT = 12;          // distance (px) per point of score
const SPAWN_GAP_MIN = 140;      // distance (px) between spawns, min
const SPAWN_GAP_MAX = 230;      // distance (px) between spawns, max
const DASH_CYCLE = 60;          // lane-marker dash period (px)

// Player-car colours cycle through nothing — it's always the hot one.
const PLAYER_COLOR = '#f97316';
const ENEMY_COLORS = ['#3b82f6', '#22c55e', '#e11d48', '#a855f7', '#eab308', '#06b6d4'];

// --- Mutable state ---------------------------------------------------------
let state = 'idle';             // 'idle' | 'running' | 'paused' | 'over'
let score = 0;
let distance = 0;               // total px travelled this run
let passedCount = 0;            // cars overtaken (flavour stat)
let best = 0;

const player = {
    x: laneCenter(1) - CAR_W / 2,
    y: HEIGHT - CAR_H - 24,
    w: CAR_W,
    h: CAR_H,
};

let enemies = [];
const keys = { left: false, right: false };

let distanceSinceSpawn = 0;
let spawnGap = SPAWN_GAP_MIN;

// --- DOM -------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

const BEST_KEY = 'roadracer-best';

// --- Helpers ---------------------------------------------------------------
function currentScrollSpeed() {
    return BASE_SCROLL + Math.min(score * SCROLL_RAMP, MAX_SCROLL_ADD);
}

function overlap(a, b) {
    const m = 6; // fairness inset
    return (
        a.x + m < b.x + b.w - m &&
        a.x + a.w - m > b.x + m &&
        a.y + m < b.y + b.h - m &&
        a.y + a.h - m > b.y + m
    );
}

// Push a new enemy car onto `enemies`. `lane` is optional; a random lane is
// chosen when it is omitted. Cars spawn just above the top edge.
function spawnEnemy(lane) {
    if (lane === undefined) lane = Math.floor(Math.random() * LANE_COUNT);
    enemies.push({
        x: laneCenter(lane) - CAR_W / 2,
        y: -CAR_H - 20,
        w: CAR_W,
        h: CAR_H,
        lane,
        speedFactor: 0.45 + Math.random() * 0.35, // slower than the road → drift down
        color: ENEMY_COLORS[Math.floor(Math.random() * ENEMY_COLORS.length)],
        passed: false,
    });
}

function showOverlay(title, sub, scoreText, btnLabel) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlayScore.textContent = scoreText || '';
    if (btnLabel) {
        btnStart.textContent = btnLabel;
        btnStart.classList.remove('hidden');
    } else {
        btnStart.classList.add('hidden');
    }
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// --- Lifecycle -------------------------------------------------------------
function startGame() {
    state = 'running';
    score = 0;
    distance = 0;
    passedCount = 0;
    enemies = [];
    distanceSinceSpawn = 0;
    spawnGap = SPAWN_GAP_MIN;
    keys.left = false;
    keys.right = false;
    player.x = laneCenter(1) - CAR_W / 2;
    scoreEl.textContent = '0';
    hideOverlay();
}

function pauseGame() {
    if (state !== 'running') return;
    state = 'paused';
    showOverlay('Paused', 'Press P to resume', '', 'Resume');
}

function resumeGame() {
    if (state !== 'paused') return;
    state = 'running';
    hideOverlay();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
    }
    bestEl.textContent = String(best);
    showOverlay('Game Over', `Best: ${best}`, `${score} pts`, 'Play Again');
}

// --- Simulation ------------------------------------------------------------
function step(dt) {
    if (state !== 'running') return;

    // Steering.
    let vx = 0;
    if (keys.left) vx -= PLAYER_SPEED;
    if (keys.right) vx += PLAYER_SPEED;
    player.x += vx * dt;
    if (player.x < ROAD_LEFT) player.x = ROAD_LEFT;
    if (player.x + player.w > ROAD_RIGHT) player.x = ROAD_RIGHT - player.w;

    // Advance the world.
    const spd = currentScrollSpeed();
    distance += spd * dt;
    score = Math.floor(distance / SCORE_UNIT);
    scoreEl.textContent = String(score);

    // Move traffic downward (slower than the road, so we overtake it).
    for (const e of enemies) {
        e.y += spd * e.speedFactor * dt;
    }

    // Spawn new traffic on a distance cadence — one car per event, so at least
    // two lanes are always open.
    distanceSinceSpawn += spd * dt;
    if (distanceSinceSpawn >= spawnGap) {
        distanceSinceSpawn = 0;
        spawnGap = SPAWN_GAP_MIN + Math.random() * (SPAWN_GAP_MAX - SPAWN_GAP_MIN);
        spawnEnemy();
    }

    // Retire cars that slid off the bottom.
    for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i].y > HEIGHT) {
            enemies.splice(i, 1);
            passedCount++;
        }
    }

    // Collision ends the run.
    for (const e of enemies) {
        if (overlap(player, e)) {
            endGame();
            break;
        }
    }
}

// --- Rendering -------------------------------------------------------------
function drawCar(car, color) {
    const { x, y, w, h } = car;
    // Body.
    ctx.fillStyle = color;
    roundRect(x, y, w, h, 8);
    ctx.fill();
    // Cabin / windshield.
    ctx.fillStyle = 'rgba(13,17,23,0.65)';
    roundRect(x + w * 0.16, y + h * 0.18, w * 0.68, h * 0.26, 4);
    ctx.fill();
    roundRect(x + w * 0.16, y + h * 0.56, w * 0.68, h * 0.24, 4);
    ctx.fill();
    // Wheels.
    ctx.fillStyle = '#0b0e13';
    ctx.fillRect(x - 3, y + h * 0.16, 4, h * 0.2);
    ctx.fillRect(x + w - 1, y + h * 0.16, 4, h * 0.2);
    ctx.fillRect(x - 3, y + h * 0.64, 4, h * 0.2);
    ctx.fillRect(x + w - 1, y + h * 0.64, 4, h * 0.2);
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

function render() {
    // Grass shoulders.
    ctx.fillStyle = '#14532d';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Road surface.
    ctx.fillStyle = '#2b3138';
    ctx.fillRect(ROAD_LEFT, 0, ROAD_WIDTH, HEIGHT);

    // Solid road edges.
    ctx.fillStyle = '#e6edf3';
    ctx.fillRect(ROAD_LEFT - 3, 0, 3, HEIGHT);
    ctx.fillRect(ROAD_RIGHT, 0, 3, HEIGHT);

    // Scrolling dashed lane markers.
    const offset = distance % DASH_CYCLE;
    ctx.fillStyle = '#f8d548';
    for (let lane = 1; lane < LANE_COUNT; lane++) {
        const lx = ROAD_LEFT + LANE_WIDTH * lane - 2;
        for (let y = -DASH_CYCLE + offset; y < HEIGHT; y += DASH_CYCLE) {
            ctx.fillRect(lx, y, 4, DASH_CYCLE * 0.5);
        }
    }

    // Traffic.
    for (const e of enemies) {
        drawCar(e, e.color || ENEMY_COLORS[0]);
    }

    // Player.
    drawCar(player, PLAYER_COLOR);
}

// --- Main loop -------------------------------------------------------------
let lastTs = null;
function frame(ts) {
    if (lastTs === null) lastTs = ts;
    let dt = ts - lastTs;
    lastTs = ts;
    if (dt > 40) dt = 40; // clamp to avoid tunnelling after a stall
    if (state === 'running') step(dt);
    render();
    requestAnimationFrame(frame);
}

// --- Input -----------------------------------------------------------------
const STEER_LEFT = new Set(['ArrowLeft', 'a', 'A']);
const STEER_RIGHT = new Set(['ArrowRight', 'd', 'D']);
const START_KEYS = new Set([' ', 'Spacebar', 'ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D', 'ArrowUp', 'w', 'W']);

window.addEventListener('keydown', (e) => {
    const k = e.key;

    if (k === ' ' || k === 'Spacebar' || k === 'ArrowLeft' || k === 'ArrowRight' ||
        k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
    }

    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    if (state === 'idle' || state === 'over') {
        if (START_KEYS.has(k)) startGame();
    }

    if (state === 'paused') return;

    if (STEER_LEFT.has(k)) keys.left = true;
    if (STEER_RIGHT.has(k)) keys.right = true;
});

window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (STEER_LEFT.has(k)) keys.left = false;
    if (STEER_RIGHT.has(k)) keys.right = false;
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// --- Boot ------------------------------------------------------------------
function init() {
    try {
        const stored = parseInt(localStorage.getItem(BEST_KEY), 10);
        if (!Number.isNaN(stored)) best = stored;
    } catch (e) { /* ignore */ }
    bestEl.textContent = String(best);
    scoreEl.textContent = '0';
    showOverlay('Road Racer', 'Press Space or a steering key to start', '', 'Start Game');
    requestAnimationFrame(frame);
}

init();
