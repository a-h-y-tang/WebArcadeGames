// ---------------------------------------------------------------------------
// Frostbite — hop the drifting ice floes, harvest blocks, build the igloo.
// Motion is in pixels-per-millisecond so the pure stepper update(dt) is
// frame-rate independent and can be driven directly from tests. Whether a
// point sits on a floe is the pure function floeUnder(lane, x).
// ---------------------------------------------------------------------------

const WIDTH = 500;
const HEIGHT = 500;

const FLOE_W = 88;
const FLOE_GAP = 46;
const PERIOD = FLOE_W + FLOE_GAP;   // 134
const LANE_H = 44;

const BLOCKS_PER_IGLOO = 15;
const TEMP_MAX = 45;
const PLAYER_HALF = 13;
const PLAYER_SPEED = 0.26;          // px/ms (held keys)

// Row centres, top (0) to bottom (5). Rows 0 and 5 are shore; 1–4 are lanes.
const ROW_Y = [58, 165, 245, 325, 405, 468];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const blocksEl = document.getElementById('blocks');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let state, score, best, lives, level, blocks, temperature;
let player, lanes;
let lastTime, animId;
const keys = { left: false, right: false };

// --- Difficulty ---
function laneSpeed(lvl) { return Math.min(0.20, 0.05 + (lvl - 1) * 0.02); }  // px/ms
function tempRate(lvl)  { return 0.0010 + (lvl - 1) * 0.0004; }              // units/ms

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// The core collision rule: is x over ice (true) or a gap (false) in this lane?
function floeUnder(lane, x) {
    const local = (((x - lane.offset) % PERIOD) + PERIOD) % PERIOD;
    return local < FLOE_W;
}

function rowY(r) { return ROW_Y[r]; }
function isLane(r) { return r >= 1 && r <= 4; }

function resetLanes() {
    // Offsets chosen so the centre column is on a floe in every lane at the
    // start of a level, making the first hop up from the shore always fair.
    lanes = [
        { dir:  1, offset: 40,  color: 'white' },
        { dir: -1, offset: 70,  color: 'white' },
        { dir:  1, offset: 100, color: 'white' },
        { dir: -1, offset: 55,  color: 'white' },
    ];
}

// --- HUD ---
function updateHud() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    blocksEl.textContent = blocks;
    livesEl.textContent = Math.max(0, lives);
}

// --- Lifecycle ---
function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    blocks = 0;
    temperature = TEMP_MAX;
    resetLanes();
    player = { row: 5, x: WIDTH / 2 };
    keys.left = keys.right = false;
    state = 'running';
    lastTime = null;

    updateHud();
    if (best > 0) bestEl.textContent = best;
    overlay.classList.remove('visible');

    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function resumeGame() {
    state = 'running';
    lastTime = null;
    overlay.classList.remove('visible');
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('frostbite-best', best);
    }
    showOverlay('Game Over', `${score} pts`, 'Press Space to play again', 'Play Again');
}

function nextLevel() {
    level++;
    score += Math.floor(temperature) * 2;   // bank the remaining warmth
    blocks = 0;
    temperature = TEMP_MAX;
    resetLanes();
    player.row = 5;
    player.x = WIDTH / 2;
    updateHud();
}

function loseLife() {
    lives--;
    livesEl.textContent = Math.max(0, lives);
    if (lives <= 0) {
        endGame();
        return;
    }
    player.row = 5;
    player.x = WIDTH / 2;
    temperature = TEMP_MAX;
    updateHud();
}

// --- Vertical hops (discrete) ---
function hopVertical(d) {
    const target = player.row + d;
    if (target < 0 || target > 5) return;   // can't leave the board
    player.row = target;
    resolveLanding();
}

function resolveLanding() {
    const r = player.row;

    if (r === 0) {                           // top shore
        if (blocks >= BLOCKS_PER_IGLOO) nextLevel();
        return;
    }
    if (r === 5) return;                      // bottom shore is always safe

    const lane = lanes[r - 1];
    if (!floeUnder(lane, player.x)) {         // hopped onto open water
        loseLife();
        return;
    }
    if (lane.color === 'white') {             // harvest a fresh block
        lane.color = 'blue';
        blocks++;
        score += 10;
        updateHud();
        if (lanes.every(l => l.color === 'blue')) {
            lanes.forEach(l => (l.color = 'white'));   // all mined → refresh
        }
    }
}

// --- Physics stepper (pure; the loop calls it only while running) ---
function update(dt) {
    const speed = laneSpeed(level);

    // Drift the lanes, keeping offsets bounded to one period.
    for (const lane of lanes) {
        lane.offset = (((lane.offset + lane.dir * speed * dt) % PERIOD) + PERIOD) % PERIOD;
    }

    // Held-key horizontal movement.
    if (keys.left)  player.x -= PLAYER_SPEED * dt;
    if (keys.right) player.x += PLAYER_SPEED * dt;

    // Ride the floe you're standing on.
    if (isLane(player.row)) {
        player.x += lanes[player.row - 1].dir * speed * dt;
    }
    player.x = clamp(player.x, PLAYER_HALF, WIDTH - PLAYER_HALF);

    // The cold creeps in.
    temperature -= tempRate(level) * dt;
    if (temperature <= 0) {
        temperature = 0;
        loseLife();          // frozen
    }
}

// --- Rendering ---
function draw() {
    // Water.
    ctx.fillStyle = '#0b2740';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Shore bands (top with igloo, bottom start).
    ctx.fillStyle = '#cfe8ff';
    ctx.fillRect(0, 0, WIDTH, 92);
    ctx.fillRect(0, HEIGHT - 46, WIDTH, 46);

    drawIgloo();
    drawLanes();
    drawTempBar();
    drawPlayer();
}

function drawLanes() {
    for (let i = 0; i < lanes.length; i++) {
        const lane = lanes[i];
        const y = ROW_Y[i + 1] - LANE_H / 2;
        ctx.fillStyle = lane.color === 'white' ? '#eaf4ff' : '#3aa0e0';
        // Draw floes across the width, starting one period to the left.
        for (let x = lane.offset - PERIOD; x < WIDTH; x += PERIOD) {
            ctx.beginPath();
            ctx.roundRect(x, y, FLOE_W, LANE_H, 8);
            ctx.fill();
        }
    }
}

function drawIgloo() {
    const cx = WIDTH - 60, cy = 78, R = 40;
    // Outline dome.
    ctx.strokeStyle = '#7fb0d6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, 0);
    ctx.stroke();
    // Fill proportional to blocks built.
    const frac = Math.min(1, blocks / BLOCKS_PER_IGLOO);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - R, cy - R * frac, R * 2, R * frac);
    ctx.clip();
    ctx.fillStyle = frac >= 1 ? '#8ee0ff' : '#bcd8ef';
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, 0);
    ctx.fill();
    ctx.restore();
    // Door when complete.
    if (frac >= 1) {
        ctx.fillStyle = '#06283b';
        ctx.beginPath();
        ctx.arc(cx, cy, 11, Math.PI, 0);
        ctx.fill();
    }
}

function drawTempBar() {
    const w = 160, h = 8, x = 12, y = 12;
    const frac = clamp(temperature / TEMP_MAX, 0, 1);
    ctx.fillStyle = '#123a56';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill();
    // Warm (blue-green) when high, red when dangerously low.
    ctx.fillStyle = frac > 0.3 ? '#38bdf8' : '#ef4444';
    ctx.beginPath();
    ctx.roundRect(x, y, w * frac, h, 4);
    ctx.fill();
}

function drawPlayer() {
    const x = player.x, y = ROW_Y[player.row];
    // Parka body.
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.roundRect(x - 10, y - 8, 20, 22, 5);
    ctx.fill();
    // Head / hood.
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(x, y - 12, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d1117';
    ctx.beginPath();
    ctx.arc(x - 2.5, y - 12, 1.4, 0, Math.PI * 2);
    ctx.arc(x + 2.5, y - 12, 1.4, 0, Math.PI * 2);
    ctx.fill();
}

// --- Loop ---
function loop(ts) {
    if (state !== 'running') return;
    if (lastTime == null) lastTime = ts;
    let dt = ts - lastTime;
    lastTime = ts;
    if (dt > 50) dt = 50;   // clamp after a backgrounded tab
    update(dt);
    draw();
    animId = requestAnimationFrame(loop);
}

// --- Overlay helpers ---
function showOverlay(title, sc, sub, btn) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sc;
    overlaySub.textContent = sub;
    btnStart.textContent = btn;
    overlay.classList.add('visible');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        resumeGame();
    }
}

// --- Input ---
document.addEventListener('keydown', e => {
    const k = e.key;

    if (k === 'p' || k === 'P') { togglePause(); return; }

    const up    = k === 'ArrowUp'    || k === 'w' || k === 'W';
    const down  = k === 'ArrowDown'  || k === 's' || k === 'S';
    const left  = k === 'ArrowLeft'  || k === 'a' || k === 'A';
    const right = k === 'ArrowRight' || k === 'd' || k === 'D';
    const space = k === ' ' || k === 'Spacebar';

    // First press from an overlay just starts the game.
    if (state !== 'running' && state !== 'paused' && (up || down || left || right || space)) {
        startGame();
        e.preventDefault();
        return;
    }
    if (state !== 'running') return;

    if (up)    { hopVertical(-1); e.preventDefault(); }
    if (down)  { hopVertical(1);  e.preventDefault(); }
    if (left)  { keys.left = true;  e.preventDefault(); }
    if (right) { keys.right = true; e.preventDefault(); }
    if (space) e.preventDefault();
});

document.addEventListener('keyup', e => {
    const k = e.key;
    if (k === 'ArrowLeft'  || k === 'a' || k === 'A') keys.left = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// --- Init ---
best = parseInt(localStorage.getItem('frostbite-best') || '0', 10);
bestEl.textContent = best;
state = 'idle';
score = 0;
lives = 3;
level = 1;
blocks = 0;
temperature = TEMP_MAX;
resetLanes();
player = { row: 5, x: WIDTH / 2 };
updateHud();
draw();
