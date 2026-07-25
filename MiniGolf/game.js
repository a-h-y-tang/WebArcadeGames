// =========================================================================
// Mini Golf — a top-down putting game on an HTML5 canvas.
//
// You aim and set power, then putt the ball across a walled green toward the
// cup. The ball rolls under friction, bounces off the boundary and off
// rectangular obstacles, and drops into the cup when it arrives slowly
// enough. Sink every hole in as few strokes as possible; a lower total is a
// better best score.
//
// All physics advances through an explicit step(dtMs) and the courses are
// fixed (no randomness), so the whole game is deterministic and easy to
// drive from tests. A number of variables and functions are intentionally
// left as globals to mirror the testable-surface convention of the other
// games here.
// =========================================================================

// ----- Dimensions & tuning constants -------------------------------------
const WIDTH = 500;
const HEIGHT = 500;

const BALL_R = 6;
const HOLE_R = 11;

const FRICTION = 0.0008;        // px / ms^2 (rolling deceleration)
const STOP_SPEED = 0.02;        // px / ms  (below this the ball halts)
const CAPTURE_SPEED = 0.28;     // px / ms  (max speed to drop into the cup)
const WALL_RESTITUTION = 0.7;   // energy kept on a bounce

const MIN_POWER = 0.12;         // px / ms
const MAX_POWER = 0.80;         // px / ms
const ANGLE_STEP = 0.06;        // rad per key press
const POWER_STEP = 0.04;        // px / ms per key press

const DEFAULT_ANGLE = -Math.PI / 2; // straight up
const DEFAULT_POWER = 0.45;

// ----- Course definition (fixed layouts) ---------------------------------
// Each hole: a tee (ball start), a cup (target), a par and a list of
// rectangular wall obstacles {x, y, w, h}.
const COURSE = [
    {
        tee: { x: 250, y: 430 },
        cup: { x: 250, y: 80 },
        par: 2,
        walls: [],
    },
    {
        tee: { x: 90, y: 430 },
        cup: { x: 410, y: 90 },
        par: 3,
        walls: [{ x: 150, y: 210, w: 200, h: 24 }],
    },
    {
        tee: { x: 80, y: 440 },
        cup: { x: 420, y: 70 },
        par: 4,
        walls: [
            { x: 120, y: 320, w: 190, h: 22 },
            { x: 200, y: 160, w: 190, h: 22 },
        ],
    },
];

// ----- Mutable game state (globals on purpose, for tests) ----------------
let state = 'idle';             // idle | running | paused | won
let holeIndex = 0;
let strokes = 0;                // strokes on the current hole
let totalStrokes = 0;           // strokes across the whole course
let par = COURSE[0].par;
let totalPar = COURSE.reduce((s, h) => s + h.par, 0);
let best = null;                // lowest total ever (from localStorage)

let ball = { x: COURSE[0].tee.x, y: COURSE[0].tee.y, vx: 0, vy: 0, moving: false };
let target = { x: COURSE[0].cup.x, y: COURSE[0].cup.y, r: HOLE_R };
let walls = COURSE[0].walls.map(w => ({ ...w }));
let aim = { angle: DEFAULT_ANGLE, power: DEFAULT_POWER };

// ----- DOM handles -------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const holeEl = document.getElementById('hole');
const strokesEl = document.getElementById('strokes');
const totalEl = document.getElementById('total');
const parEl = document.getElementById('par');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ----- Helpers -----------------------------------------------------------
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function loadBest() {
    const raw = localStorage.getItem('minigolf-best');
    const n = raw === null ? NaN : Number(raw);
    best = Number.isFinite(n) ? n : null;
}

// ----- Hole / lifecycle --------------------------------------------------
function loadHole(i) {
    holeIndex = i;
    const h = COURSE[i];
    ball = { x: h.tee.x, y: h.tee.y, vx: 0, vy: 0, moving: false };
    target = { x: h.cup.x, y: h.cup.y, r: HOLE_R };
    walls = h.walls.map(w => ({ ...w }));
    par = h.par;
    strokes = 0;
    aim = { angle: DEFAULT_ANGLE, power: DEFAULT_POWER };
    updateHud();
}

function init() {
    loadBest();
    totalStrokes = 0;
    loadHole(0);
    state = 'idle';
    updateHud();
    showOverlay('Mini Golf', '',
        'Press Space or click Start to tee off\n' + totalPar + '-par course, ' + COURSE.length + ' holes');
}

function startGame() {
    totalStrokes = 0;
    loadHole(0);
    state = 'running';
    updateHud();
    hideOverlay();
    canvas.focus();
}

function winGame() {
    state = 'won';
    if (best === null || totalStrokes < best) {
        best = totalStrokes;
        localStorage.setItem('minigolf-best', String(best));
    }
    updateHud();
    const rel = totalStrokes - totalPar;
    const relText = rel === 0 ? 'level par' : rel > 0 ? ('+' + rel + ' over par') : (rel + ' under par');
    showOverlay('Course Complete',
        totalStrokes + ' strokes (' + relText + ')',
        'Press Space or click Start to play again');
}

// ----- Sinking -----------------------------------------------------------
function sink() {
    if (holeIndex >= COURSE.length - 1) {
        ball.moving = false;
        ball.vx = ball.vy = 0;
        winGame();
    } else {
        loadHole(holeIndex + 1);
    }
}

// ----- Shooting ----------------------------------------------------------
function setAim(a) { aim.angle = a; }
function setPower(p) { aim.power = clamp(p, MIN_POWER, MAX_POWER); }
function aimLeft() { aim.angle -= ANGLE_STEP; }
function aimRight() { aim.angle += ANGLE_STEP; }
function powerUp() { setPower(aim.power + POWER_STEP); }
function powerDown() { setPower(aim.power - POWER_STEP); }

function shoot() {
    if (state !== 'running' || ball.moving) return;
    ball.vx = Math.cos(aim.angle) * aim.power;
    ball.vy = Math.sin(aim.angle) * aim.power;
    ball.moving = true;
    strokes += 1;
    totalStrokes += 1;
    updateHud();
}

// ----- Collision helpers -------------------------------------------------
function bounceWalls() {
    if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = -ball.vx * WALL_RESTITUTION; }
    if (ball.x > WIDTH - BALL_R) { ball.x = WIDTH - BALL_R; ball.vx = -ball.vx * WALL_RESTITUTION; }
    if (ball.y < BALL_R) { ball.y = BALL_R; ball.vy = -ball.vy * WALL_RESTITUTION; }
    if (ball.y > HEIGHT - BALL_R) { ball.y = HEIGHT - BALL_R; ball.vy = -ball.vy * WALL_RESTITUTION; }
}

function bounceRect(r) {
    // Closest point on the rectangle to the ball centre.
    const cx = clamp(ball.x, r.x, r.x + r.w);
    const cy = clamp(ball.y, r.y, r.y + r.h);
    let dx = ball.x - cx;
    let dy = ball.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= BALL_R * BALL_R) return;

    if (d2 > 1e-9) {
        // Ball centre is outside the rectangle: reflect along the contact normal.
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        ball.x = cx + nx * BALL_R;
        ball.y = cy + ny * BALL_R;
        const vn = ball.vx * nx + ball.vy * ny;
        if (vn < 0) {
            ball.vx -= (1 + WALL_RESTITUTION) * vn * nx;
            ball.vy -= (1 + WALL_RESTITUTION) * vn * ny;
        }
    } else {
        // Ball centre is inside the rectangle: push out along the nearest edge.
        const left = ball.x - r.x;
        const right = r.x + r.w - ball.x;
        const top = ball.y - r.y;
        const bottom = r.y + r.h - ball.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) { ball.x = r.x - BALL_R; ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION - 0.001; }
        else if (m === right) { ball.x = r.x + r.w + BALL_R; ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION + 0.001; }
        else if (m === top) { ball.y = r.y - BALL_R; ball.vy = -Math.abs(ball.vy) * WALL_RESTITUTION - 0.001; }
        else { ball.y = r.y + r.h + BALL_R; ball.vy = Math.abs(ball.vy) * WALL_RESTITUTION + 0.001; }
    }
}

// ----- Core physics step -------------------------------------------------
function step(dt) {
    if (state !== 'running' || !ball.moving) return;

    // Friction: bleed off speed along the current direction.
    let speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 0) {
        const ns = Math.max(0, speed - FRICTION * dt);
        const scale = ns / speed;
        ball.vx *= scale;
        ball.vy *= scale;
        speed = ns;
    }

    // Integrate position.
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Collisions.
    bounceWalls();
    for (const w of walls) bounceRect(w);

    // Cup capture — over the hole and slow enough to drop in.
    const dh = Math.hypot(ball.x - target.x, ball.y - target.y);
    if (dh < target.r && speed < CAPTURE_SPEED) {
        sink();
        return;
    }

    // Come to rest.
    if (speed < STOP_SPEED) {
        ball.vx = ball.vy = 0;
        ball.moving = false;
    }
}

// ----- Rendering ---------------------------------------------------------
function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // Green with a subtle stripe pattern.
    ctx.fillStyle = '#0f2e1c';
    for (let y = 0; y < HEIGHT; y += 40) {
        ctx.fillStyle = (Math.floor(y / 40) % 2 === 0) ? '#0c2717' : '#0e2c1b';
        ctx.fillRect(0, y, WIDTH, 40);
    }

    // Obstacles.
    for (const w of walls) {
        ctx.fillStyle = '#3d2b18';
        ctx.strokeStyle = '#5a4327';
        ctx.lineWidth = 2;
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeRect(w.x, w.y, w.w, w.h);
    }

    // Cup + flag.
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.r, 0, Math.PI * 2);
    ctx.fillStyle = '#02160c';
    ctx.fill();
    ctx.strokeStyle = '#0a3a20';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(target.x, target.y);
    ctx.lineTo(target.x, target.y - 34);
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(target.x, target.y - 34);
    ctx.lineTo(target.x + 20, target.y - 28);
    ctx.lineTo(target.x, target.y - 22);
    ctx.closePath();
    ctx.fill();

    // Aim guide when the ball is at rest and in play.
    if (state === 'running' && !ball.moving) {
        const len = 20 + (aim.power / MAX_POWER) * 70;
        const ex = ball.x + Math.cos(aim.angle) * len;
        const ey = ball.y + Math.sin(aim.angle) * len;
        ctx.strokeStyle = '#fde68a';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(ball.x, ball.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
        // Arrowhead.
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.arc(ex, ey, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    // Ball.
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    ctx.stroke();
}

// ----- HUD & overlay -----------------------------------------------------
function updateHud() {
    holeEl.textContent = (holeIndex + 1) + ' / ' + COURSE.length;
    strokesEl.textContent = String(strokes);
    totalEl.textContent = String(totalStrokes);
    parEl.textContent = String(totalPar);
    bestEl.textContent = best === null ? '–' : String(best);
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ----- Input: keyboard ---------------------------------------------------
document.addEventListener('keydown', (e) => {
    switch (e.key) {
        case 'ArrowLeft': case 'a': case 'A':
            if (state === 'running' && !ball.moving) aimLeft();
            e.preventDefault();
            break;
        case 'ArrowRight': case 'd': case 'D':
            if (state === 'running' && !ball.moving) aimRight();
            e.preventDefault();
            break;
        case 'ArrowUp': case 'w': case 'W':
            if (state === 'running' && !ball.moving) powerUp();
            e.preventDefault();
            break;
        case 'ArrowDown': case 's': case 'S':
            if (state === 'running' && !ball.moving) powerDown();
            e.preventDefault();
            break;
        case ' ': case 'Spacebar':
            if (state === 'idle' || state === 'won') startGame();
            else if (state === 'paused') { state = 'running'; hideOverlay(); }
            else if (state === 'running' && !ball.moving) shoot();
            e.preventDefault();
            break;
        case 'p': case 'P':
            if (state === 'running') { state = 'paused'; showOverlay('Paused', '', 'Press P or Space to resume'); }
            else if (state === 'paused') { state = 'running'; hideOverlay(); }
            e.preventDefault();
            break;
    }
});

// ----- Input: mouse (drag to aim, slingshot) -----------------------------
let dragging = false;
const MAX_DRAG = 120;

function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('mousedown', (e) => {
    if (state !== 'running' || ball.moving) return;
    dragging = true;
    updateDragAim(e);
});

canvas.addEventListener('mousemove', (e) => {
    if (dragging) updateDragAim(e);
});

window.addEventListener('mouseup', () => {
    if (dragging) {
        dragging = false;
        if (aim.power >= MIN_POWER) shoot();
    }
});

function updateDragAim(e) {
    const p = canvasPoint(e);
    // Slingshot: pull back from the ball; the shot fires the opposite way.
    const dx = ball.x - p.x;
    const dy = ball.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.01) aim.angle = Math.atan2(dy, dx);
    const frac = clamp(dist / MAX_DRAG, 0, 1);
    aim.power = MIN_POWER + frac * (MAX_POWER - MIN_POWER);
}

btnStart.addEventListener('click', () => startGame());

// ----- Animation loop ----------------------------------------------------
let lastT = null;
function frame(t) {
    if (lastT === null) lastT = t;
    let dt = t - lastT;
    lastT = t;
    if (dt > 50) dt = 50; // clamp big gaps (e.g. tab switch)
    if (state === 'running' && ball.moving) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ----- Boot --------------------------------------------------------------
init();
requestAnimationFrame(frame);
