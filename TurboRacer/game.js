// ---------------------------------------------------------------------------
// Turbo Racer — a top-down endless racing / dodging game.
//
// All motion is expressed in pixels-per-millisecond and integrated by a single
// step(dt) function, so the simulation is frame-rate independent and can be
// driven deterministically from the tests.
// ---------------------------------------------------------------------------

// --- Field geometry ---
const WIDTH = 400;
const HEIGHT = 600;

// The road sits in the centre with grass verges on either side.
const VERGE = 40;
const ROAD_LEFT = VERGE;                 // 40
const ROAD_RIGHT = WIDTH - VERGE;        // 360
const ROAD_W = ROAD_RIGHT - ROAD_LEFT;   // 320
const LANES = 4;
const LANE_W = ROAD_W / LANES;           // 80

// --- Car dimensions ---
const CAR_W = 48;
const CAR_H = 78;

// --- Speeds (px per ms) ---
const PLAYER_SPEED = 0.34;   // horizontal steering speed
const BASE_SCROLL = 0.22;    // starting road speed
const MAX_SCROLL = 0.62;     // speed cap
const SPEED_RAMP = 0.00005;  // scroll gained per pixel of distance travelled

// --- Scoring ---
const SCORE_UNIT = 50;       // pixels of road travelled per score point

// --- Traffic spawning (ms) ---
const SPAWN_FIRST = 800;     // grace period before the first car
const SPAWN_BASE = 900;      // spawn interval at base speed
const SPAWN_MIN = 380;       // shortest spawn interval at top speed
const ENEMY_EXTRA_SPEED = 0.09; // max per-car speed added on top of the scroll

// --- Lane markings ---
const DASH_LEN = 26;
const DASH_GAP = 24;
const DASH_PERIOD = DASH_LEN + DASH_GAP;

const BEST_KEY = 'turboRacerBest';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let player, enemies, score, best, state, distance, scroll, spawnTimer, dashOffset, lastTime;
const keys = {};

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) — keeps traffic reproducible when reseeded.
// ---------------------------------------------------------------------------
let rngState = 0x9e3779b9;
function seedRng(s) {
    rngState = s >>> 0;
}
function rand() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function laneX(lane) {
    // Left edge of a car centred in the given lane.
    const center = ROAD_LEFT + LANE_W * (lane + 0.5);
    return center - CAR_W / 2;
}

function spawnInterval() {
    // Faster road → cars appear more often. Scaled by the current speed and
    // jittered a little so the pattern doesn't feel mechanical.
    const scaled = SPAWN_BASE * (BASE_SCROLL / scroll);
    const base = Math.max(SPAWN_MIN, scaled);
    return base * (0.7 + rand() * 0.6);
}

function spawnEnemy() {
    const lane = Math.floor(rand() * LANES);
    enemies.push({
        x: laneX(lane),
        y: -CAR_H,
        w: CAR_W,
        h: CAR_H,
        speed: rand() * ENEMY_EXTRA_SPEED,
        lane,
    });
}

function overlaps(a, b) {
    return (
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y
    );
}

// ---------------------------------------------------------------------------
// Simulation — advance the world by dt milliseconds.
// ---------------------------------------------------------------------------
function step(dt) {
    if (state !== 'running') return;

    // Difficulty scales with distance travelled, capped at MAX_SCROLL.
    scroll = Math.min(MAX_SCROLL, BASE_SCROLL + distance * SPEED_RAMP);

    // Steering.
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    player.x += dir * PLAYER_SPEED * dt;
    if (player.x < ROAD_LEFT) player.x = ROAD_LEFT;
    if (player.x + player.w > ROAD_RIGHT) player.x = ROAD_RIGHT - player.w;

    // Spawn traffic.
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawnEnemy();
        spawnTimer = spawnInterval();
    }

    // Move traffic downward and recycle anything off the bottom.
    for (const e of enemies) {
        e.y += (scroll + e.speed) * dt;
    }
    for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i].y > HEIGHT) enemies.splice(i, 1);
    }

    // Scroll the lane markings.
    dashOffset = (dashOffset + scroll * dt) % DASH_PERIOD;

    // Distance & score.
    distance += scroll * dt;
    const newScore = Math.floor(distance / SCORE_UNIT);
    if (newScore !== score) {
        score = newScore;
        scoreEl.textContent = String(score);
    }

    // Collisions end the run.
    for (const e of enemies) {
        if (overlaps(player, e)) {
            gameOver();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------
function resetWorld() {
    player = {
        x: WIDTH / 2 - CAR_W / 2,
        y: HEIGHT - CAR_H - 24,
        w: CAR_W,
        h: CAR_H,
    };
    enemies = [];
    score = 0;
    distance = 0;
    scroll = BASE_SCROLL;
    spawnTimer = SPAWN_FIRST;
    dashOffset = 0;
    keys.left = false;
    keys.right = false;
    scoreEl.textContent = '0';
}

function start() {
    seedRng((Date.now() >>> 0) || 1);
    resetWorld();
    state = 'running';
    hideOverlay();
    lastTime = performance.now();
}

function gameOver() {
    state = 'gameover';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (e) {
            /* ignore storage errors */
        }
    }
    bestEl.textContent = String(best);
    showOverlay('Game Over', `Score ${score}  ·  Best ${best}`, 'Press Space to race again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
        lastTime = performance.now();
    }
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------
function showOverlay(title, sub, hint) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub;
    overlaySub.textContent = hint;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawCar(x, y, w, h, body, roof) {
    // Body.
    ctx.fillStyle = body;
    roundRect(x, y, w, h, 8);
    ctx.fill();
    // Windows / roof.
    ctx.fillStyle = roof;
    roundRect(x + 7, y + 12, w - 14, 16, 4);
    ctx.fill();
    roundRect(x + 7, y + h - 28, w - 14, 16, 4);
    ctx.fill();
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
    // Grass verges.
    ctx.fillStyle = '#15803d';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Road.
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(ROAD_LEFT, 0, ROAD_W, HEIGHT);

    // Road edges.
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(ROAD_LEFT - 3, 0, 3, HEIGHT);
    ctx.fillRect(ROAD_RIGHT, 0, 3, HEIGHT);

    // Dashed lane markings.
    ctx.fillStyle = '#fcd34d';
    for (let l = 1; l < LANES; l++) {
        const x = ROAD_LEFT + LANE_W * l - 2;
        for (let y = -DASH_PERIOD + dashOffset; y < HEIGHT; y += DASH_PERIOD) {
            ctx.fillRect(x, y, 4, DASH_LEN);
        }
    }

    // Traffic.
    for (const e of enemies) {
        drawCar(e.x, e.y, e.w, e.h, '#ef4444', '#7f1d1d');
    }

    // Player.
    if (player) {
        drawCar(player.x, player.y, player.w, player.h, '#38bdf8', '#0c4a6e');
    }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function frame(now) {
    // Clamp to [0, 50]: cap long stalls, and guard against a frame timestamp
    // that predates the performance.now() captured when the game (re)started.
    const dt = Math.max(0, Math.min(50, now - lastTime));
    lastTime = now;
    step(dt);
    render();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const START_KEYS = new Set([
    ' ', 'Spacebar', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
    'a', 'A', 'd', 'D',
]);

window.addEventListener('keydown', (e) => {
    const k = e.key;

    if ((state === 'idle' || state === 'gameover') && START_KEYS.has(k)) {
        e.preventDefault();
        start();
        return;
    }

    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
        keys.left = true;
        e.preventDefault();
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
        keys.right = true;
        e.preventDefault();
    } else if (k === 'p' || k === 'P') {
        togglePause();
    }
});

window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
});

btnStart.addEventListener('click', () => {
    if (state !== 'running') start();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function init() {
    best = Number(localStorage.getItem(BEST_KEY)) || 0;
    bestEl.textContent = String(best);
    resetWorld();
    state = 'idle';
    showOverlay('Turbo Racer', '', 'Press Space or an arrow key to start');
    lastTime = performance.now();
    requestAnimationFrame(frame);
}

init();
