// --- Field & object dimensions ---
const WIDTH = 500;
const HEIGHT = 500;
const PADDLE_W = 90;
const PADDLE_H = 14;
const BALL_R = 7;
const BRICK_ROWS = 5;
const BRICK_COLS = 9;

// Motion is expressed in pixels-per-millisecond so it is frame-rate independent.
const BASE_SPEED = 0.28;   // ball speed at level 1
const PADDLE_SPEED = 0.6;  // paddle speed under keyboard control
const PADDLE_Y = HEIGHT - 40;

// Row colours (top row first) and the horizontal steer factor of the paddle.
const ROW_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#38bdf8'];
const MAX_STEER = 0.75; // fraction of speed that can go sideways off the paddle

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let paddle, ball, bricks, score, best, lives, level, state, lastTime, animId;
const keys = {};

// -----------------------------------------------------------------------
// Setup helpers
// -----------------------------------------------------------------------
function speedForLevel(lvl) {
    return BASE_SPEED * (1 + (lvl - 1) * 0.15);
}

function buildBricks() {
    bricks = [];
    const top = 50;
    const padX = 24;
    const gap = 4;
    const bh = 20;
    const totalW = WIDTH - padX * 2;
    const bw = (totalW - gap * (BRICK_COLS - 1)) / BRICK_COLS;
    for (let row = 0; row < BRICK_ROWS; row++) {
        for (let col = 0; col < BRICK_COLS; col++) {
            bricks.push({
                x: padX + col * (bw + gap),
                y: top + row * (bh + gap),
                w: bw,
                h: bh,
                alive: true,
                points: (BRICK_ROWS - row) * 10, // top rows worth more
                color: ROW_COLORS[row % ROW_COLORS.length],
            });
        }
    }
}

function resetPaddle() {
    paddle = { x: WIDTH / 2 - PADDLE_W / 2, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H };
}

function restBallOnPaddle() {
    ball = {
        x: paddle.x + paddle.w / 2,
        y: paddle.y - BALL_R - 1,
        vx: 0,
        vy: 0,
        r: BALL_R,
    };
}

function launchBall() {
    // Deterministic serve: up and slightly to the right.
    const speed = speedForLevel(level);
    ball.vx = speed * 0.35;
    ball.vy = -Math.sqrt(speed * speed - ball.vx * ball.vx);
}

function movePaddleTo(x) {
    paddle.x = Math.max(0, Math.min(WIDTH - paddle.w, x));
}

// -----------------------------------------------------------------------
// Game lifecycle
// -----------------------------------------------------------------------
function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    buildBricks();
    resetPaddle();
    restBallOnPaddle();
    launchBall();
    state = 'running';

    scoreEl.textContent = score;
    livesEl.textContent = lives;
    levelEl.textContent = level;
    overlay.classList.remove('visible');

    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function nextLevel() {
    level++;
    levelEl.textContent = level;
    buildBricks();
    resetPaddle();
    restBallOnPaddle();
    launchBall();
}

function loseLife() {
    lives--;
    livesEl.textContent = Math.max(0, lives);
    if (lives <= 0) {
        endGame();
        return;
    }
    resetPaddle();
    restBallOnPaddle();
    launchBall();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('breakout-best', best);
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} pts`;
    overlaySub.textContent = 'Press Space to play again';
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
    overlay.classList.remove('visible');
    lastTime = null;
    animId = requestAnimationFrame(loop);
}

// -----------------------------------------------------------------------
// Physics — advance the ball by dt milliseconds
// -----------------------------------------------------------------------
function step(dt) {
    if (state !== 'running') return;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Side walls
    if (ball.x - ball.r < 0) {
        ball.x = ball.r;
        ball.vx = Math.abs(ball.vx);
    } else if (ball.x + ball.r > WIDTH) {
        ball.x = WIDTH - ball.r;
        ball.vx = -Math.abs(ball.vx);
    }

    // Top wall
    if (ball.y - ball.r < 0) {
        ball.y = ball.r;
        ball.vy = Math.abs(ball.vy);
    }

    // Paddle
    if (
        ball.vy > 0 &&
        ball.y + ball.r >= paddle.y &&
        ball.y - ball.r <= paddle.y + paddle.h &&
        ball.x >= paddle.x &&
        ball.x <= paddle.x + paddle.w
    ) {
        ball.y = paddle.y - ball.r;
        const speed = Math.hypot(ball.vx, ball.vy);
        let hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2); // -1..1
        hit = Math.max(-1, Math.min(1, hit));
        ball.vx = speed * hit * MAX_STEER;
        ball.vy = -Math.sqrt(Math.max(0.0001, speed * speed - ball.vx * ball.vx));
    }

    // Bricks — reflect off the first live brick the ball overlaps.
    for (const b of bricks) {
        if (!b.alive) continue;
        if (
            ball.x + ball.r > b.x &&
            ball.x - ball.r < b.x + b.w &&
            ball.y + ball.r > b.y &&
            ball.y - ball.r < b.y + b.h
        ) {
            b.alive = false;
            score += b.points;
            scoreEl.textContent = score;

            // Reflect on the axis of shallowest penetration.
            const overlapLeft = ball.x + ball.r - b.x;
            const overlapRight = b.x + b.w - (ball.x - ball.r);
            const overlapTop = ball.y + ball.r - b.y;
            const overlapBottom = b.y + b.h - (ball.y - ball.r);
            const minX = Math.min(overlapLeft, overlapRight);
            const minY = Math.min(overlapTop, overlapBottom);
            if (minX < minY) {
                ball.vx = -ball.vx;
            } else {
                ball.vy = -ball.vy;
            }

            if (bricks.every(br => !br.alive)) {
                nextLevel();
            }
            break;
        }
    }

    // Bottom — the ball is lost.
    if (ball.y - ball.r > HEIGHT) {
        loseLife();
    }
}

// -----------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------
function updatePaddleFromKeys(dt) {
    let dx = 0;
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) dx -= 1;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) dx += 1;
    if (dx !== 0) movePaddleTo(paddle.x + dx * PADDLE_SPEED * dt);
}

function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = Math.min(50, timestamp - lastTime); // clamp big frame gaps
    lastTime = timestamp;

    if (state === 'running') {
        updatePaddleFromKeys(elapsed);
        step(elapsed);
    }

    draw();

    if (state === 'running') {
        animId = requestAnimationFrame(loop);
    }
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function draw() {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Bricks
    for (const b of bricks) {
        if (!b.alive) continue;
        ctx.fillStyle = b.color;
        roundRect(ctx, b.x, b.y, b.w, b.h, 3);
    }

    // Paddle
    ctx.fillStyle = '#e6edf3';
    ctx.shadowColor = '#38bdf888';
    ctx.shadowBlur = 10;
    roundRect(ctx, paddle.x, paddle.y, paddle.w, paddle.h, 7);
    ctx.shadowBlur = 0;

    // Ball
    ctx.fillStyle = '#38bdf8';
    ctx.shadowColor = '#38bdf8aa';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
}

function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fill();
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
const START_KEYS = [' ', 'ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D'];
const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D'];

document.addEventListener('keydown', e => {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    if (state !== 'running' && state !== 'paused' && START_KEYS.includes(k)) {
        startGame();
        e.preventDefault();
        return;
    }

    if (state === 'running' && MOVE_KEYS.includes(k)) {
        keys[k] = true;
        e.preventDefault();
    }
});

document.addEventListener('keyup', e => {
    keys[e.key] = false;
});

canvas.addEventListener('mousemove', e => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (WIDTH / rect.width);
    movePaddleTo(mx - paddle.w / 2);
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
best = parseInt(localStorage.getItem('breakout-best') || '0', 10);
bestEl.textContent = best;
score = 0;
lives = 3;
level = 1;
state = 'idle';
buildBricks();
resetPaddle();
restBallOnPaddle();
draw();
