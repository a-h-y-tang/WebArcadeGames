// ---------------------------------------------------------------------------
// Pinball — a canvas arcade table with a plunger, bumpers and two flippers.
// Core state and logic are top-level globals so the Playwright suite can drive
// them directly. See design.md for the full write-up.
// ---------------------------------------------------------------------------

// --- Table geometry --------------------------------------------------------
const W = 400, H = 620;
const LEFT = 14, RIGHT = 386, TOP = 14;   // straight outer walls (clamped)
const WALL_REST = 0.6;                     // restitution of the outer walls
const GRAVITY = 900;                       // px / s^2
const MAX_SPEED = 1400;                    // px / s (anti-tunnelling cap)
const LAUNCH_SPEED = 1000;                 // plunger launch speed (upward)
const BUMPER_KICK = 220;                   // extra pop off a bumper
const DRAIN_LINE = 600;                    // ball past this y is drained

const LANE_X = 365;                        // plunger-lane centre
const LANE_Y = 580;                        // rest position in the lane

function rad(deg) { return (deg * Math.PI) / 180; }

// --- Entities --------------------------------------------------------------
const ball = { x: LANE_X, y: LANE_Y, vx: 0, vy: 0, r: 9, held: true };

const bumpers = [
    { x: 110, y: 150, r: 26, value: 100 },
    { x: 250, y: 150, r: 26, value: 100 },
    { x: 180, y: 270, r: 22, value: 50 },
];

// Flippers are line segments pivoting near the bottom. A left flipper raised
// lifts its tip (angle decreases); the right one is mirrored (angle increases).
const leftFlipper = {
    x: 90, y: 542, len: 68,
    rest: rad(25), raised: rad(-22), angle: rad(25),
    pressed: false, restitution: 0.55, kick: 520, side: 'left',
};
const rightFlipper = {
    x: 254, y: 542, len: 68,
    rest: rad(155), raised: rad(202), angle: rad(155),
    pressed: false, restitution: 0.55, kick: 520, side: 'right',
};

// Internal static walls (the straight outer three are handled by clamping).
const walls = [
    { x1: 344, y1: 140, x2: 344, y2: 470, restitution: 0.5 }, // lane divider
    { x1: 14, y1: 470, x2: 90, y2: 542, restitution: 0.5 },   // left lower guide
    { x1: 344, y1: 470, x2: 254, y2: 542, restitution: 0.5 }, // right lower guide
];

// --- Game state ------------------------------------------------------------
let state = 'ready';        // 'ready' | 'playing' | 'over'
let score = 0;
let ballsLeft = 3;
let best = 0;

// --- DOM -------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elBalls = document.getElementById('balls');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const statusEl = document.getElementById('status');

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function closestPointOnSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return { x: x1 + t * dx, y: y1 + t * dy };
}

function flipperSegment(f) {
    return {
        x1: f.x, y1: f.y,
        x2: f.x + f.len * Math.cos(f.angle),
        y2: f.y + f.len * Math.sin(f.angle),
    };
}

// ---------------------------------------------------------------------------
// Collision resolution
// ---------------------------------------------------------------------------
// Reflect the ball off a line segment. Returns true on contact.
function collideSegment(seg, restitution, kick) {
    const c = closestPointOnSegment(ball.x, ball.y, seg.x1, seg.y1, seg.x2, seg.y2);
    let dx = ball.x - c.x, dy = ball.y - c.y;
    let dist = Math.hypot(dx, dy);
    if (dist > ball.r) return false;

    let nx, ny;
    if (dist > 1e-6) {
        nx = dx / dist; ny = dy / dist;
    } else {
        // Ball centre exactly on the line: use the segment's perpendicular.
        const sx = seg.x2 - seg.x1, sy = seg.y2 - seg.y1;
        const sl = Math.hypot(sx, sy) || 1;
        nx = -sy / sl; ny = sx / sl;
    }

    // Push the ball out of the overlap.
    const overlap = ball.r - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;

    // Reflect only when moving into the surface.
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
        ball.vx -= (1 + restitution) * vn * nx;
        ball.vy -= (1 + restitution) * vn * ny;
    }
    if (kick) {
        ball.vx += nx * kick;
        ball.vy += ny * kick;
    }
    return true;
}

// Reflect the ball off a circular bumper and award points. Returns true on hit.
function collideBumper(b) {
    let dx = ball.x - b.x, dy = ball.y - b.y;
    let dist = Math.hypot(dx, dy);
    const min = ball.r + b.r;
    if (dist > min) return false;

    let nx, ny;
    if (dist > 1e-6) { nx = dx / dist; ny = dy / dist; }
    else { nx = 0; ny = -1; }

    const overlap = min - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;

    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
        const rest = 1.0;
        ball.vx -= (1 + rest) * vn * nx;
        ball.vy -= (1 + rest) * vn * ny;
    }
    ball.vx += nx * BUMPER_KICK;
    ball.vy += ny * BUMPER_KICK;

    b.flash = 1;
    score += b.value;
    updateHud();
    return true;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function step(dt) {
    if (state !== 'playing') return;
    if (ball.held) return;

    ball.vy += GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Straight outer walls via clamping (robust against overshoot).
    if (ball.y - ball.r < TOP) {
        ball.y = TOP + ball.r;
        if (ball.vy < 0) ball.vy = -ball.vy * WALL_REST;
    }
    if (ball.x - ball.r < LEFT) {
        ball.x = LEFT + ball.r;
        if (ball.vx < 0) ball.vx = -ball.vx * WALL_REST;
    }
    if (ball.x + ball.r > RIGHT) {
        ball.x = RIGHT - ball.r;
        if (ball.vx > 0) ball.vx = -ball.vx * WALL_REST;
    }

    // Internal walls, bumpers, flippers.
    for (const w of walls) collideSegment(w, w.restitution, 0);
    for (const b of bumpers) collideBumper(b);
    collideSegment(flipperSegment(leftFlipper), leftFlipper.restitution,
        leftFlipper.pressed ? leftFlipper.kick : 0);
    collideSegment(flipperSegment(rightFlipper), rightFlipper.restitution,
        rightFlipper.pressed ? rightFlipper.kick : 0);

    // Cap speed.
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > MAX_SPEED) {
        ball.vx = (ball.vx / sp) * MAX_SPEED;
        ball.vy = (ball.vy / sp) * MAX_SPEED;
    }

    // Drain.
    if (ball.y - ball.r > DRAIN_LINE) drainBall();
}

// ---------------------------------------------------------------------------
// Ball / life management
// ---------------------------------------------------------------------------
function resetBall() {
    ball.x = LANE_X;
    ball.y = LANE_Y;
    ball.vx = 0;
    ball.vy = 0;
    ball.held = true;
}

function launchBall() {
    if (state === 'playing' && ball.held) {
        ball.held = false;
        ball.vx = 0;
        ball.vy = -LAUNCH_SPEED;
    }
}

function drainBall() {
    ballsLeft--;
    updateHud();
    if (ballsLeft <= 0) {
        ballsLeft = 0;
        endGame();
    } else {
        resetBall();
        setStatus('Ball drained — press Space to launch the next');
    }
}

function checkGameEnd() {
    if (ballsLeft <= 0) endGame();
}

// ---------------------------------------------------------------------------
// Flippers input
// ---------------------------------------------------------------------------
function pressLeft() { leftFlipper.pressed = true; leftFlipper.angle = leftFlipper.raised; }
function releaseLeft() { leftFlipper.pressed = false; leftFlipper.angle = leftFlipper.rest; }
function pressRight() { rightFlipper.pressed = true; rightFlipper.angle = rightFlipper.raised; }
function releaseRight() { rightFlipper.pressed = false; rightFlipper.angle = rightFlipper.rest; }

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function startGame() {
    score = 0;
    ballsLeft = 3;
    state = 'playing';
    resetBall();
    releaseLeft();
    releaseRight();
    hideOverlay();
    setStatus('Press Space to launch the ball');
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('pinball-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('Game Over', 'Score: ' + score, 'Press any key to play again');
    btnStart.textContent = 'Play Again';
    setStatus('Game over');
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------
function updateHud() {
    elScore.textContent = String(score);
    elBalls.textContent = String(Math.max(0, ballsLeft));
    elBest.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    if (sub) overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawSegment(seg, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(seg.x1, seg.y1);
    ctx.lineTo(seg.x2, seg.y2);
    ctx.stroke();
}

function drawFlipper(f) {
    const seg = flipperSegment(f);
    ctx.save();
    ctx.strokeStyle = f.pressed ? '#7fe3ff' : '#4aa3d8';
    ctx.lineWidth = 15;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(90, 180, 255, 0.7)';
    ctx.shadowBlur = f.pressed ? 16 : 6;
    ctx.beginPath();
    ctx.moveTo(seg.x1, seg.y1);
    ctx.lineTo(seg.x2, seg.y2);
    ctx.stroke();
    ctx.restore();
    // pivot cap
    ctx.fillStyle = '#2c3a66';
    ctx.beginPath();
    ctx.arc(f.x, f.y, 6, 0, Math.PI * 2);
    ctx.fill();
}

function render() {
    ctx.clearRect(0, 0, W, H);

    // Outer walls.
    ctx.strokeStyle = '#38508f';
    ctx.lineWidth = 4;
    ctx.strokeRect(TOP - 2, TOP - 2, RIGHT - LEFT + 4, H - TOP);

    // Plunger lane divider + internal guides.
    for (const w of walls) drawSegment(w, '#3a5178', 6);

    // Plunger lane hint.
    ctx.fillStyle = 'rgba(120, 160, 255, 0.08)';
    ctx.fillRect(344, 140, RIGHT - 344, H - 140);

    // Bumpers.
    for (const b of bumpers) {
        const glow = b.flash ? 1 : 0.5;
        ctx.save();
        ctx.shadowColor = 'rgba(255, 120, 200, ' + (0.4 + glow * 0.5) + ')';
        ctx.shadowBlur = b.flash ? 26 : 14;
        const g = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 2, b.x, b.y, b.r);
        g.addColorStop(0, b.flash ? '#fff' : '#ff9ad2');
        g.addColorStop(1, '#c33f8f');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.value), b.x, b.y);
        if (b.flash) b.flash = Math.max(0, b.flash - 0.08);
    }

    // Flippers.
    drawFlipper(leftFlipper);
    drawFlipper(rightFlipper);

    // Ball.
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.5)';
    ctx.shadowBlur = 8;
    const bg = ctx.createRadialGradient(
        ball.x - ball.r * 0.35, ball.y - ball.r * 0.35, 1, ball.x, ball.y, ball.r);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.5, '#cfd8ef');
    bg.addColorStop(1, '#7c88a6');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastTs = 0;
function loop(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;            // clamp big gaps (tab switches)
    // Sub-step for stability.
    const steps = 4;
    for (let i = 0; i < steps; i++) step(dt / steps);
    updateHud();
    render();
    requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function onCanvasClick() {
    if (state !== 'playing') startGame();
}

btnStart.addEventListener('click', () => {
    if (state !== 'playing') startGame();
});

window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (state !== 'playing') {
        // Any key launches from the overlay.
        startGame();
        e.preventDefault();
        return;
    }
    if (k === ' ' || k === 'ArrowUp' || k === 'Spacebar') {
        launchBall();
        e.preventDefault();
    } else if (k === 'ArrowLeft' || k === 'z' || k === 'Z' || k === 'a' || k === 'A') {
        pressLeft();
        e.preventDefault();
    } else if (k === 'ArrowRight' || k === '/' || k === 'l' || k === 'L') {
        pressRight();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'z' || k === 'Z' || k === 'a' || k === 'A') releaseLeft();
    else if (k === 'ArrowRight' || k === '/' || k === 'l' || k === 'L') releaseRight();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(function init() {
    try {
        const stored = localStorage.getItem('pinball-best');
        if (stored !== null) best = parseInt(stored, 10) || 0;
    } catch (e) { /* ignore */ }
    updateHud();
    showOverlay('Pinball', '', 'Press Space to launch, arrow keys to flip');
    requestAnimationFrame(loop);
})();
