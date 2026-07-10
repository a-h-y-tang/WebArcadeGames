// ===========================================================================
// Sky Hopper — an endless vertical bouncing platformer.
//
// Following the convention used by the other games in this repo (Snake,
// Asteroids, Breakout), all mutable state and the deterministic physics entry
// point `step(dtMs)` live at module top level so they are reachable from
// Playwright's page.evaluate(). `step(dt)` advances all physics by an explicit
// number of milliseconds, so behaviour never depends on requestAnimationFrame
// timing. Platform layout comes from a seedable PRNG so tests are reproducible.
// ===========================================================================

// --- Field constants --------------------------------------------------------
const WIDTH = 400;
const HEIGHT = 600;

const PLAYER_W = 28;
const PLAYER_H = 28;

const GRAVITY = 0.0011;        // downward acceleration (px / ms^2)
const JUMP_V = 0.62;           // upward launch speed on a bounce (px / ms)
const MOVE_SPEED = 0.32;       // horizontal steering speed (px / ms)

const PLAT_W = 68;
const PLAT_H = 14;
const MIN_GAP = 55;            // min vertical spacing between platforms (px)
const MAX_GAP = 95;            // max vertical spacing — kept below max bounce
const MOVE_PLAT_SPEED = 0.08;  // horizontal drift of moving platforms (px / ms)
const MOVE_THRESHOLD = 25;     // score at which moving platforms start to appear

const SCORE_SCALE = 8;         // px climbed per point of score
const START_Y = 0;             // hopper's starting world-y
const START_CAM = START_Y - HEIGHT * 0.7; // camera so hopper sits 70% down
const FOLLOW_LINE = HEIGHT * 0.4;         // camera pulls up above this screen line

// --- Mutable state ----------------------------------------------------------
let state = 'idle';            // 'idle' | 'running' | 'paused' | 'over'
let score = 0;
let best = parseInt(localStorage.getItem('skyhopper-best')) || 0;
let cameraY = START_CAM;

const player = { x: WIDTH / 2, y: START_Y, vx: 0, vy: 0 };
const platforms = [];
const keys = { left: false, right: false };

// --- Seedable PRNG (mulberry32) --------------------------------------------
let rngState = 1;
function srand(seed) { rngState = seed >>> 0; }
function rand() {
    rngState = (rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// --- DOM handles ------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');

// ===========================================================================
// HUD / overlay
// ===========================================================================
function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
}

function showOverlay(title, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = score > 0 || state === 'over' ? 'Score: ' + score : '';
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ===========================================================================
// Platform generation
// ===========================================================================
function addPlatform(y) {
    const x = rand() * (WIDTH - PLAT_W);
    const moving = score > MOVE_THRESHOLD && rand() < 0.28;
    platforms.push({
        x,
        y,
        w: PLAT_W,
        type: moving ? 'moving' : 'normal',
        vx: moving ? (rand() < 0.5 ? -MOVE_PLAT_SPEED : MOVE_PLAT_SPEED) : 0,
    });
}

// Build the starting field: one platform directly under the hopper, then fill
// upward past the top of the screen and downward to the bottom of the screen.
function generateInitial() {
    platforms.length = 0;
    platforms.push({ x: player.x - PLAT_W / 2, y: START_Y + 70, w: PLAT_W, type: 'normal', vx: 0 });

    let up = START_Y + 70;
    while (up > cameraY - HEIGHT) {
        up -= MIN_GAP + rand() * (MAX_GAP - MIN_GAP);
        addPlatform(up);
    }
    let down = START_Y + 70;
    while (down < cameraY + HEIGHT) {
        down += MIN_GAP + rand() * (MAX_GAP - MIN_GAP);
        addPlatform(down);
    }
}

// Keep at least a screen of platforms above the camera and drop any that have
// scrolled well below the bottom of the view.
function ensurePlatforms() {
    let top = Infinity;
    for (const p of platforms) if (p.y < top) top = p.y;
    while (top > cameraY - HEIGHT) {
        top -= MIN_GAP + rand() * (MAX_GAP - MIN_GAP);
        addPlatform(top);
    }
    for (let i = platforms.length - 1; i >= 0; i--) {
        if (platforms[i].y - cameraY > HEIGHT + PLAT_H * 4) platforms.splice(i, 1);
    }
}

// ===========================================================================
// Physics — advance everything by dt milliseconds.
// ===========================================================================
function step(dt) {
    if (state !== 'running') return;

    // Horizontal steering with wrap-around.
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    player.x += dir * MOVE_SPEED * dt;
    if (player.x < 0) player.x += WIDTH;
    else if (player.x > WIDTH) player.x -= WIDTH;

    // Gravity + vertical integration.
    player.vy += GRAVITY * dt;
    const prevFeet = player.y + PLAYER_H / 2;
    player.y += player.vy * dt;
    const feet = player.y + PLAYER_H / 2;

    // Landing: only when falling and only when the feet cross a platform top.
    if (player.vy > 0) {
        for (const p of platforms) {
            const overlapX = player.x + PLAYER_W / 2 > p.x && player.x - PLAYER_W / 2 < p.x + p.w;
            if (overlapX && prevFeet <= p.y && feet >= p.y) {
                player.vy = -JUMP_V;
                player.y = p.y - PLAYER_H / 2;
                break;
            }
        }
    }

    // Drift moving platforms, reversing at the screen edges.
    for (const p of platforms) {
        if (p.type === 'moving') {
            p.x += p.vx * dt;
            if (p.x < 0) { p.x = 0; p.vx = -p.vx; }
            else if (p.x + p.w > WIDTH) { p.x = WIDTH - p.w; p.vx = -p.vx; }
        }
    }

    // Camera follows the hopper upward only.
    if (player.y < cameraY + FOLLOW_LINE) {
        cameraY = player.y - FOLLOW_LINE;
    }

    // Score = distance the camera has climbed (monotonic).
    const climbed = Math.floor((START_CAM - cameraY) / SCORE_SCALE);
    if (climbed > score) score = climbed;
    updateHud();

    ensurePlatforms();

    // Death: the hopper has dropped below the bottom of the view.
    if (player.y - cameraY > HEIGHT + PLAYER_H) {
        gameOver();
    }
}

// ===========================================================================
// Game lifecycle
// ===========================================================================
function startGame(seed) {
    srand(seed === undefined ? (Date.now() >>> 0) : (seed >>> 0));
    score = 0;
    player.x = WIDTH / 2;
    player.y = START_Y;
    player.vx = 0;
    player.vy = 0;
    keys.left = false;
    keys.right = false;
    cameraY = START_CAM;
    generateInitial();
    state = 'running';
    hideOverlay();
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        localStorage.setItem('skyhopper-best', best);
    }
    updateHud();
    showOverlay('Game Over', 'Press Space or Click to Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', 'Press P to Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ===========================================================================
// Input
// ===========================================================================
window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keys.left = true; e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { keys.right = true; e.preventDefault(); }
    else if (k === 'p' || k === 'P') { togglePause(); }
    else if (k === ' ' || k === 'Enter' || k === 'Spacebar') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
    }
});

window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
});

function startFromUi() {
    if (state === 'idle' || state === 'over') startGame();
}
btnStart.addEventListener('click', (e) => { e.stopPropagation(); startFromUi(); });
canvas.addEventListener('click', startFromUi);

// ===========================================================================
// Rendering
// ===========================================================================
function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    g.addColorStop(0, '#0b1e3f');
    g.addColorStop(1, '#123a6b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawPlatform(p) {
    const sy = p.y - cameraY;
    ctx.fillStyle = p.type === 'moving' ? '#4bb3ff' : '#5fd97a';
    ctx.fillRect(p.x, sy, p.w, PLAT_H);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(p.x, sy, p.w, 3);
}

function drawPlayer() {
    const sx = player.x - PLAYER_W / 2;
    const sy = player.y - cameraY - PLAYER_H / 2;
    ctx.fillStyle = '#ffd447';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(sx, sy, PLAYER_W, PLAYER_H, 7) : ctx.rect(sx, sy, PLAYER_W, PLAYER_H);
    ctx.fill();
    // eyes
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(sx + 7, sy + 9, 4, 5);
    ctx.fillRect(sx + PLAYER_W - 11, sy + 9, 4, 5);
}

function draw() {
    drawBackground();
    for (const p of platforms) drawPlatform(p);
    drawPlayer();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 20px Arial';
    ctx.fillText(String(score), 12, 28);
}

// ===========================================================================
// Main loop — deterministic step() driven by wall-clock dt.
// ===========================================================================
let lastTime = null;
function loop(now) {
    if (lastTime === null) lastTime = now;
    let dt = now - lastTime;
    lastTime = now;
    if (dt > 50) dt = 50; // clamp big gaps (tab switch) for stability
    if (state === 'running') step(dt);
    draw();
    requestAnimationFrame(loop);
}

// ===========================================================================
// Boot — idle screen with a static field behind the start overlay.
// ===========================================================================
function boot() {
    state = 'idle';
    player.x = WIDTH / 2;
    player.y = START_Y;
    player.vx = 0;
    player.vy = 0;
    cameraY = START_CAM;
    srand(1);
    generateInitial();
    updateHud();
    showOverlay('Sky Hopper', 'Press Space or Click to Start');
    requestAnimationFrame(loop);
}

boot();
