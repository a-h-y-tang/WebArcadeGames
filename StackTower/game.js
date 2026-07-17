// ---------------------------------------------------------------------------
// Stack Tower — a one-button block-stacking arcade game on an HTML5 canvas.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring the
// Dino Run, Tetris and Snake games in this repo. All motion is expressed
// per-second and advanced through `step(dt)`, so the tests can simulate frames
// deterministically without depending on requestAnimationFrame wall-clock
// timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 400;
const CANVAS_H = 600;
const BLOCK_H = 34;            // height of every block
const BASE_W = 180;            // width of the starting (base) block
const BASE_Y = CANVAS_H - 140; // world-y of the top edge of the base block

// --- Motion (units per second) ---
const BASE_SPEED = 130;        // horizontal speed of the first moving block
const SPEED_INC = 8;           // extra speed gained per placed block
const MAX_SPEED = 320;         // speed cap so it stays (barely) playable

// --- Feel ---
const PERFECT_EPS = 5;         // px of left-edge slack that still counts perfect
const ANCHOR = 150;            // screen-y the active block scrolls to once high
const CAMERA_LERP = 6;         // camera easing rate (per second)

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

const DROP_KEYS = new Set([' ', 'Spacebar', 'ArrowUp', 'w', 'W']);

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state;
let score;
let best;
let combo;            // consecutive perfect drops
let cameraY;          // world-y subtracted from every draw (scrolls the view up)
const blocks = [];    // the tower, bottom (base) first
const debris = [];    // cosmetic falling slivers from sliced overhang
let moving = null;    // the block currently sliding at the top; null while idle

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function speedForScore(s) {
    return Math.min(MAX_SPEED, BASE_SPEED + s * SPEED_INC);
}

function blockColor(index) {
    const hue = (200 + index * 18) % 360;
    return `hsl(${hue}, 65%, 58%)`;
}

// Spawn a fresh moving block of width `w` one block-height above the current
// top of the tower, entering from alternating sides for variety.
function spawnMovingBlock(w) {
    const topY = blocks[blocks.length - 1].y;
    const fromLeft = blocks.length % 2 === 0;
    const speed = speedForScore(score);
    moving = {
        x: fromLeft ? 0 : CANVAS_W - w,
        y: topY - BLOCK_H,
        w: w,
        vx: fromLeft ? speed : -speed,
        color: blockColor(blocks.length),
    };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function moveBlock(dt) {
    if (!moving) return;
    const minX = 0;
    const maxX = CANVAS_W - moving.w;
    moving.x += moving.vx * dt;
    // Reflect off the walls; the loop copes with the (unlikely) double bounce.
    let guard = 0;
    while ((moving.x < minX || moving.x > maxX) && guard++ < 8) {
        if (moving.x < minX) {
            moving.x = minX + (minX - moving.x);
            moving.vx = Math.abs(moving.vx);
        } else {
            moving.x = maxX - (moving.x - maxX);
            moving.vx = -Math.abs(moving.vx);
        }
    }
}

function updateDebris(dt) {
    for (const d of debris) {
        d.vy += 900 * dt;      // gravity
        d.y += d.vy * dt;
        d.rot += d.vr * dt;
    }
    for (let i = debris.length - 1; i >= 0; i--) {
        if (debris[i].y - cameraY > CANVAS_H + 80) debris.splice(i, 1);
    }
}

function updateCamera(dt) {
    if (!moving) return;
    const target = Math.min(0, moving.y - ANCHOR);
    const k = Math.min(1, dt * CAMERA_LERP);
    cameraY += (target - cameraY) * k;
}

// Advance the simulation by `dt` seconds.
function step(dt) {
    if (state !== 'running') return;
    moveBlock(dt);
    updateDebris(dt);
    updateCamera(dt);
    updateHud();
}

// ---------------------------------------------------------------------------
// Player action — drop the moving block
// ---------------------------------------------------------------------------

function spawnDebris(x, w, y) {
    if (w <= 0) return;
    debris.push({ x, y, w, h: BLOCK_H, vy: -40, vr: (x < CANVAS_W / 2 ? -3 : 3), rot: 0 });
}

function dropBlock() {
    if (state !== 'running') return;

    const top = blocks[blocks.length - 1];
    const overlapLeft = Math.max(moving.x, top.x);
    const overlapRight = Math.min(moving.x + moving.w, top.x + top.w);
    const overlap = overlapRight - overlapLeft;

    if (overlap <= 0) {
        // Complete miss — the block topples off and the run ends.
        endGame();
        return;
    }

    let newX;
    let newW;
    if (Math.abs(moving.x - top.x) <= PERFECT_EPS) {
        // Perfect drop: snap onto the top, keep the full width, extend the combo.
        newX = top.x;
        newW = top.w;
        combo += 1;
    } else {
        // Imperfect: slice off the overhang, the tower narrows, combo breaks.
        newX = overlapLeft;
        newW = overlap;
        combo = 0;
        // Cosmetic sliver(s) for the sliced-off part(s).
        if (moving.x < top.x) spawnDebris(moving.x, top.x - moving.x, moving.y);
        const rightOver = (moving.x + moving.w) - (top.x + top.w);
        if (rightOver > 0) spawnDebris(top.x + top.w, rightOver, moving.y);
    }

    blocks.push({ x: newX, y: top.y - BLOCK_H, w: newW, color: moving.color });
    score += 1;
    spawnMovingBlock(newW);
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    combo = 0;
    cameraY = 0;
    blocks.length = 0;
    debris.length = 0;
    blocks.push({
        x: (CANVAS_W - BASE_W) / 2,
        y: BASE_Y,
        w: BASE_W,
        color: blockColor(0),
    });
    spawnMovingBlock(BASE_W);
    hideOverlay();
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('stack-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Height ' + score, 'Press Space to stack again', 'Play Again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreText, sub, buttonText) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = buttonText;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawBlock(b) {
    const sy = b.y - cameraY;
    const grad = ctx.createLinearGradient(0, sy, 0, sy + BLOCK_H);
    grad.addColorStop(0, b.color);
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(b.x, sy, b.w, BLOCK_H);
    // top highlight
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(b.x, sy, b.w, 4);
}

function draw() {
    // Sky.
    const bg = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    bg.addColorStop(0, '#0b1020');
    bg.addColorStop(1, '#131c30');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Tower.
    for (const b of blocks) drawBlock(b);

    // Falling debris.
    for (const d of debris) {
        ctx.save();
        const cx = d.x + d.w / 2;
        const cy = d.y - cameraY + d.h / 2;
        ctx.translate(cx, cy);
        ctx.rotate(d.rot);
        ctx.fillStyle = 'rgba(148,163,184,0.7)';
        ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
        ctx.restore();
    }

    // Moving block.
    if (moving && (state === 'running' || state === 'paused')) {
        drawBlock(moving);
    }

    // Combo flourish.
    if (state === 'running' && combo > 1) {
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PERFECT ×' + combo, CANVAS_W / 2, 40);
        ctx.textAlign = 'start';
    }
}

// ---------------------------------------------------------------------------
// Main loop (real-time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    if (state === 'running') step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function primaryAction() {
    if (state === 'running') dropBlock();
    else if (state === 'idle' || state === 'over') startGame();
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (DROP_KEYS.has(e.key)) {
        primaryAction();
        e.preventDefault();
    }
});

canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    primaryAction();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('stack-best') || '0', 10) || 0;
state = 'idle';
score = 0;
combo = 0;
cameraY = 0;
moving = null;
updateHud();
requestAnimationFrame(frame);
