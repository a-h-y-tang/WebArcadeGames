// Peg Pop — aim a ball into a field of pegs and clear every orange one.
//
// The whole simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, pegs, ball, launcher, bucket) is kept at the
// top level on purpose: the Playwright suite drives the game through exactly
// these names. See DESIGN.md for the rules and the constants behind them.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 480
const H = canvas.height;             // 640
const DT = 1 / 120;                  // fixed simulation timestep, seconds

const BALL_R = 6;
const PEG_R = 9;
const LAUNCH_SPEED = 230;            // px/s out of the muzzle
const MUZZLE = 22;                   // distance from launcher pivot to muzzle
const GRAVITY = 520;                 // px/s^2
const PEG_BOUNCE = 0.72;
const WALL_BOUNCE = 0.85;

const AIM_LIMIT = 1.2;               // radians either side of straight down
const AIM_STEP = 0.05;               // nudge applied on a key press
const AIM_SPEED = 1.5;               // radians/second while a key is held

const BALLS_PER_LEVEL = 10;
const LEVEL_COUNT = 5;
const CLEAR_BONUS = 250;             // per ball still in hand when a level ends
const SHOT_TIME_LIMIT = 20;          // seconds of flight before a shot is cut off

const POINTS = { blue: 10, green: 50, orange: 100 };
const COLORS = {
    blue: '#60a5fa',
    orange: '#f59e0b',
    green: '#34d399',
};

const BEST_KEY = 'pegpop-best';

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | levelclear | gameover | won
let score = 0;
let level = 1;
let ballsLeft = BALLS_PER_LEVEL;
let best = loadBest();
let pegs = [];
let ball = null;                     // { x, y, vx, vy, age } while a shot is live
let pops = [];                       // short-lived hit sparkles, cosmetic only
let autoRun = true;                  // the animation loop only simulates while true
const keys = Object.create(null);

const launcher = { x: W / 2, y: 40, angle: 0 };
const bucket = { x: W / 2 - 35, y: H - 24, w: 70, h: 18, dir: 1, speed: 110, catches: 0 };

// --- boards ----------------------------------------------------------------

// Assign peg types by a fixed rule so a level is always the same board: every
// `stride`-th peg is an orange target and the middle peg is the green one.
function assignTypes(points, stride) {
    const green = Math.floor(points.length / 2);
    return points.map((p, i) => ({
        x: p.x,
        y: p.y,
        type: i === green ? 'green' : i % stride === 1 ? 'orange' : 'blue',
    }));
}

function buildLevel(n) {
    const pts = [];
    switch (((n - 1) % LEVEL_COUNT) + 1) {
        case 1: // even grid
            for (let row = 0; row < 5; row++) {
                for (let col = 0; col < 9; col++) pts.push({ x: 60 + col * 45, y: 190 + row * 52 });
            }
            return assignTypes(pts, 7);

        case 2: // arch narrowing toward the bottom
            [9, 7, 5, 3].forEach((count, row) => {
                const y = 200 + row * 62;
                const span = (count - 1) * 46;
                for (let i = 0; i < count; i++) pts.push({ x: W / 2 - span / 2 + i * 46, y });
            });
            return assignTypes(pts, 6);

        case 3: // diamond
            [1, 3, 5, 7, 5, 3, 1].forEach((count, row) => {
                const y = 180 + row * 48;
                const span = (count - 1) * 44;
                for (let i = 0; i < count; i++) pts.push({ x: W / 2 - span / 2 + i * 44, y });
            });
            return assignTypes(pts, 5);

        case 4: // staggered zigzag rows
            for (let row = 0; row < 6; row++) {
                const offset = row % 2 ? 27 : 0;
                for (let col = 0; col < 8; col++) pts.push({ x: 50 + col * 54 + offset, y: 190 + row * 52 });
            }
            return assignTypes(pts, 4);

        default: // two rings over a floor row
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * Math.PI * 2;
                pts.push({ x: W / 2 + Math.cos(a) * 60, y: 300 + Math.sin(a) * 60 });
            }
            for (let i = 0; i < 16; i++) {
                const a = (i / 16) * Math.PI * 2;
                pts.push({ x: W / 2 + Math.cos(a) * 110, y: 300 + Math.sin(a) * 110 });
            }
            for (let i = 0; i < 7; i++) pts.push({ x: 90 + i * 50, y: 490 });
            return assignTypes(pts, 4);
    }
}

function orangesLeft() {
    return pegs.filter((p) => p.type === 'orange').length;
}

// --- game flow -------------------------------------------------------------

function loadLevel(n) {
    level = n;
    pegs = buildLevel(n);
    ball = null;
    pops = [];
    ballsLeft = BALLS_PER_LEVEL;
    launcher.angle = 0;
    bucket.x = W / 2 - bucket.w / 2;
    bucket.dir = 1;
    bucket.speed = 110 + (n - 1) * 12;
    bucket.catches = 0;
}

function startGame() {
    score = 0;
    autoRun = true;
    loadLevel(1);
    state = 'running';
    hideOverlay();
    updateHud();
}

function fireBall() {
    if (state !== 'running' || ball || ballsLeft <= 0) return;
    const dx = Math.sin(launcher.angle);
    const dy = Math.cos(launcher.angle);
    ball = {
        x: launcher.x + dx * MUZZLE,
        y: launcher.y + dy * MUZZLE,
        vx: dx * LAUNCH_SPEED,
        vy: dy * LAUNCH_SPEED,
        age: 0,
    };
    ballsLeft--;
    updateHud();
}

// Wrap up the current shot, then decide whether the level, the run, or neither
// has come to an end.
function endShot(caught) {
    ball = null;
    if (caught) {
        ballsLeft++;
        bucket.catches++;
    }
    if (orangesLeft() === 0) {
        score += CLEAR_BONUS * ballsLeft;
        if (level >= LEVEL_COUNT) {
            state = 'won';
            saveBest();
            showOverlay('YOU WIN!', `Final score ${score}`, 'Press Space to play again');
        } else {
            state = 'levelclear';
            showOverlay('LEVEL CLEAR', `Score ${score}`, `Press Space for level ${level + 1}`);
        }
    } else if (ballsLeft <= 0) {
        state = 'gameover';
        saveBest();
        showOverlay('GAME OVER', `Final score ${score}`, 'Press Space to try again');
    }
    updateHud();
}

// Space, a click and the Start button all mean "do the obvious thing here".
function advance() {
    switch (state) {
        case 'idle':
        case 'gameover':
        case 'won':
            startGame();
            break;
        case 'levelclear':
            loadLevel(level + 1);
            state = 'running';
            hideOverlay();
            updateHud();
            break;
        case 'paused':
            togglePause();
            break;
        case 'running':
            fireBall();
            break;
    }
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// --- aiming ----------------------------------------------------------------

function setAim(angle) {
    launcher.angle = Math.max(-AIM_LIMIT, Math.min(AIM_LIMIT, angle));
}

function aimBy(delta) {
    setAim(launcher.angle + delta);
}

function aimAt(px, py) {
    setAim(Math.atan2(px - launcher.x, Math.max(1, py - launcher.y)));
}

// --- simulation ------------------------------------------------------------

function hitPeg(peg) {
    score += POINTS[peg.type] || 0;
    if (peg.type === 'green') ballsLeft++;
    pops.push({ x: peg.x, y: peg.y, t: 0, color: COLORS[peg.type] });
}

function collidePegs() {
    const reach = BALL_R + PEG_R;
    for (let i = pegs.length - 1; i >= 0; i--) {
        const peg = pegs[i];
        const dx = ball.x - peg.x;
        const dy = ball.y - peg.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= reach) continue;

        const nx = dist > 0 ? dx / dist : 0;
        const ny = dist > 0 ? dy / dist : -1;
        ball.x = peg.x + nx * reach;
        ball.y = peg.y + ny * reach;

        const along = ball.vx * nx + ball.vy * ny;
        if (along < 0) {
            ball.vx = (ball.vx - 2 * along * nx) * PEG_BOUNCE;
            ball.vy = (ball.vy - 2 * along * ny) * PEG_BOUNCE;
        }
        pegs.splice(i, 1);
        hitPeg(peg);
    }
}

function moveBucket(dt) {
    if (!bucket.speed) return;
    bucket.x += bucket.dir * bucket.speed * dt;
    if (bucket.x <= 0) {
        bucket.x = 0;
        bucket.dir = 1;
    } else if (bucket.x + bucket.w >= W) {
        bucket.x = W - bucket.w;
        bucket.dir = -1;
    }
}

function physicsStep(dt) {
    // aim sweeps while a direction key is held
    const aimHeld = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    if (aimHeld) aimBy(aimHeld * AIM_SPEED * dt);

    moveBucket(dt);

    for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].t += dt;
        if (pops[i].t > 0.35) pops.splice(i, 1);
    }

    if (ball) {
        ball.age += dt;
        ball.vy += GRAVITY * dt;
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        if (ball.x < BALL_R) {
            ball.x = BALL_R;
            ball.vx = Math.abs(ball.vx) * WALL_BOUNCE;
        } else if (ball.x > W - BALL_R) {
            ball.x = W - BALL_R;
            ball.vx = -Math.abs(ball.vx) * WALL_BOUNCE;
        }
        if (ball.y < BALL_R) {
            ball.y = BALL_R;
            ball.vy = Math.abs(ball.vy) * WALL_BOUNCE;
        }

        collidePegs();

        const caught =
            ball.y + BALL_R >= bucket.y && ball.x > bucket.x && ball.x < bucket.x + bucket.w;
        if (caught) {
            endShot(true);
        } else if (ball.y - BALL_R > H || ball.age >= SHOT_TIME_LIMIT) {
            endShot(false);
        }
    }

    updateHud();
}

// --- HUD and overlay -------------------------------------------------------

function loadBest() {
    try {
        return Number(window.localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
        return 0;
    }
}

function saveBest() {
    if (score <= best) return;
    best = score;
    try {
        window.localStorage.setItem(BEST_KEY, String(best));
    } catch (err) {
        /* storage unavailable (private mode, file restrictions) — keep playing */
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el && el.textContent !== String(value)) el.textContent = String(value);
}

function updateHud() {
    setText('score', score);
    setText('level', level);
    setText('balls', ballsLeft);
    setText('pegs', orangesLeft());
    setText('best', best);
}

function showOverlay(title, scoreLine, sub) {
    setText('overlay-title', title);
    setText('overlay-score', scoreLine || '');
    setText('overlay-sub', sub || '');
    document.getElementById('overlay').classList.add('visible');
}

function hideOverlay() {
    document.getElementById('overlay').classList.remove('visible');
}

// --- drawing ---------------------------------------------------------------

function drawBackground() {
    ctx.fillStyle = '#070b16';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let x = 40; x < W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, H);
        ctx.stroke();
    }
    for (let y = 40; y < H; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(W, y + 0.5);
        ctx.stroke();
    }
}

function drawPegs() {
    pegs.forEach((peg) => {
        const color = COLORS[peg.type];
        ctx.beginPath();
        ctx.arc(peg.x, peg.y, PEG_R, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(peg.x - PEG_R * 0.3, peg.y - PEG_R * 0.35, PEG_R * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.fill();
        if (peg.type !== 'blue') {
            ctx.beginPath();
            ctx.arc(peg.x, peg.y, PEG_R + 3.5, 0, Math.PI * 2);
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.35;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    });
}

function drawPops() {
    pops.forEach((pop) => {
        const k = pop.t / 0.35;
        ctx.beginPath();
        ctx.arc(pop.x, pop.y, PEG_R + k * 16, 0, Math.PI * 2);
        ctx.strokeStyle = pop.color;
        ctx.globalAlpha = Math.max(0, 1 - k);
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = 1;
    });
}

function drawLauncher() {
    const dx = Math.sin(launcher.angle);
    const dy = Math.cos(launcher.angle);

    // aim guide, only while the player is lining up a shot
    if (!ball && (state === 'running' || state === 'idle')) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
        for (let i = 1; i <= 7; i++) {
            const d = MUZZLE + i * 22;
            ctx.beginPath();
            ctx.arc(launcher.x + dx * d, launcher.y + dy * d, 2.2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(launcher.x, launcher.y);
    ctx.lineTo(launcher.x + dx * MUZZLE, launcher.y + dy * MUZZLE);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(launcher.x, launcher.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#cbd5f5';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(launcher.x, launcher.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#1f2937';
    ctx.fill();
}

function drawBucket() {
    const { x, y, w, h } = bucket;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#34d399';
    ctx.fillRect(x, y, w, 5);
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.fillRect(0, H - 4, W, 4);
}

function drawBall() {
    if (!ball) return;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ball.x - 2, ball.y - 2, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fill();
}

function drawBallsLeft() {
    for (let i = 0; i < Math.min(ballsLeft, 12); i++) {
        ctx.beginPath();
        ctx.arc(14 + i * 15, H - 46, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(248, 250, 252, 0.75)';
        ctx.fill();
    }
}

function draw() {
    drawBackground();
    drawPegs();
    drawPops();
    drawBucket();
    drawBallsLeft();
    drawLauncher();
    drawBall();
}

// --- input -----------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            advance();
            break;
        case 'ArrowLeft':
        case 'KeyA':
            e.preventDefault();
            aimBy(-AIM_STEP);
            break;
        case 'ArrowRight':
        case 'KeyD':
            e.preventDefault();
            aimBy(AIM_STEP);
            break;
        case 'KeyP':
            togglePause();
            break;
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

canvas.addEventListener('mousemove', (e) => {
    if (state !== 'running' && state !== 'idle') return;
    const rect = canvas.getBoundingClientRect();
    aimAt(e.clientX - rect.left, e.clientY - rect.top);
});

canvas.addEventListener('click', () => advance());
document.getElementById('btn-start').addEventListener('click', () => advance());

// --- main loop -------------------------------------------------------------

let lastFrame = 0;
let carry = 0;

function frame(ts) {
    const dt = lastFrame ? Math.min(0.05, (ts - lastFrame) / 1000) : 0;
    lastFrame = ts;

    if (autoRun && state === 'running') {
        carry += dt;
        while (carry >= DT) {
            physicsStep(DT);
            carry -= DT;
        }
    } else {
        carry = 0;
    }

    draw();
    requestAnimationFrame(frame);
}

updateHud();
draw();
requestAnimationFrame(frame);
