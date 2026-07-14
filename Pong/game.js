// ---------------------------------------------------------------------------
// Pong — the classic two-paddle rally game, you (left) vs. an AI (right).
// All motion is time-based (pixels per second) and integrated with a delta
// time `dt` (seconds). `update(dt)` is a pure physics step with no `state`
// check, so tests can drive the simulation deterministically.
// ---------------------------------------------------------------------------

const WIDTH = 700;
const HEIGHT = 500;

// Tunables
const PADDLE_W = 12;
const PADDLE_H = 80;
const PADDLE_MARGIN = 24;        // gap between paddle and side wall
const PADDLE_SPEED = 460;        // player paddle, px / second
const AI_SPEED = 300;            // CPU paddle, px / second (below the ball → beatable)
const BALL_R = 7;
const BALL_START_SPEED = 340;    // px / second
const SPEEDUP = 1.06;            // ball speed-up per paddle hit
const MAX_SPEED = 680;           // px / second
const MAX_BOUNCE_ANGLE = 0.72;   // radians (~41°) of deflection at a paddle edge
const SERVE_ANGLE = 0.35;        // radians of vertical angle on a serve
const WIN_SCORE = 7;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scorePlayerEl = document.getElementById('score-player');
const scoreCpuEl = document.getElementById('score-cpu');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let player, cpu, ball, playerScore, cpuScore, rally, bestRally, state, keys, lastTime, animId;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function clampPaddle(p) {
    p.y = clamp(p.y, p.h / 2, HEIGHT - p.h / 2);
}

function serveBall(scorer) {
    // Re-centre and launch. Direction goes toward the side that conceded; the
    // vertical angle flips with the running score. Fully deterministic.
    ball.x = WIDTH / 2;
    ball.y = HEIGHT / 2;
    const dirX = scorer === 'cpu' ? -1 : 1; // default (start) serves toward the CPU
    const vSign = (playerScore + cpuScore) % 2 === 0 ? 1 : -1;
    ball.vx = dirX * Math.cos(SERVE_ANGLE) * BALL_START_SPEED;
    ball.vy = vSign * Math.sin(SERVE_ANGLE) * BALL_START_SPEED;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function startGame() {
    playerScore = 0;
    cpuScore = 0;
    rally = 0;
    player.y = HEIGHT / 2;
    cpu.y = HEIGHT / 2;
    keys = { up: false, down: false };

    scorePlayerEl.textContent = playerScore;
    scoreCpuEl.textContent = cpuScore;
    serveBall(null);

    overlay.classList.remove('visible');
    state = 'running';
    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame(winner) {
    state = 'over';
    overlayTitle.textContent = winner === 'player' ? 'You Win!' : 'Game Over';
    overlayScore.textContent = `${playerScore} – ${cpuScore}`;
    overlaySub.textContent = winner === 'player'
        ? 'You beat the CPU — press ↑ to play again'
        : 'The CPU won — press ↑ to try again';
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
    animId = requestAnimationFrame(loop);
}

function handleScore(scorer) {
    if (scorer === 'player') playerScore++;
    else cpuScore++;
    scorePlayerEl.textContent = playerScore;
    scoreCpuEl.textContent = cpuScore;
    rally = 0;

    if (playerScore >= WIN_SCORE) return endGame('player');
    if (cpuScore >= WIN_SCORE) return endGame('cpu');
    serveBall(scorer);
}

function registerRally() {
    rally++;
    if (rally > bestRally) {
        bestRally = rally;
        bestEl.textContent = bestRally;
        localStorage.setItem('pong-best', bestRally);
    }
}

// ---------------------------------------------------------------------------
// Physics — one deterministic step. No `state` gating on purpose.
// ---------------------------------------------------------------------------
function collidePaddle(p, dirX) {
    // Only reflect when the ball is heading toward this paddle.
    if (Math.sign(ball.vx) !== -dirX) return false;

    const x1 = p.x - p.w / 2, x2 = p.x + p.w / 2;
    const y1 = p.y - p.h / 2, y2 = p.y + p.h / 2;
    const cx = clamp(ball.x, x1, x2);
    const cy = clamp(ball.y, y1, y2);
    if (Math.hypot(ball.x - cx, ball.y - cy) > ball.r) return false;

    // Deflection angle from where the ball struck the paddle face.
    const offset = clamp((ball.y - p.y) / (p.h / 2), -1, 1);
    const angle = offset * MAX_BOUNCE_ANGLE;
    const speed = Math.min(Math.hypot(ball.vx, ball.vy) * SPEEDUP, MAX_SPEED);

    ball.vx = dirX * Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
    ball.x = dirX > 0 ? x2 + ball.r : x1 - ball.r; // push clear of the paddle

    registerRally();
    return true;
}

function update(dt) {
    // Player paddle (held keys)
    if (keys.up) player.y -= PADDLE_SPEED * dt;
    if (keys.down) player.y += PADDLE_SPEED * dt;
    clampPaddle(player);

    // CPU paddle: chase the ball while it approaches, else drift to centre.
    const target = ball.vx > 0 ? ball.y : HEIGHT / 2;
    const diff = target - cpu.y;
    const step = AI_SPEED * dt;
    cpu.y += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    clampPaddle(cpu);

    // Ball
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Top / bottom walls
    if (ball.y - ball.r < 0) {
        ball.y = ball.r;
        ball.vy = Math.abs(ball.vy);
    } else if (ball.y + ball.r > HEIGHT) {
        ball.y = HEIGHT - ball.r;
        ball.vy = -Math.abs(ball.vy);
    }

    // Paddles
    collidePaddle(player, +1);
    collidePaddle(cpu, -1);

    // Scoring
    if (ball.x - ball.r > WIDTH) handleScore('player');
    else if (ball.x + ball.r < 0) handleScore('cpu');
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
function loop(timestamp) {
    if (state !== 'running') return;
    if (lastTime == null) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.05) dt = 0.05; // clamp big gaps (tab switches)

    update(dt);
    draw();
    animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function draw() {
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Centre net
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2, 0);
    ctx.lineTo(WIDTH / 2, HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);

    // Large scores either side of the net
    ctx.fillStyle = '#1f2937';
    ctx.font = '700 76px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    ctx.fillText(String(playerScore), WIDTH / 2 - 40, 24);
    ctx.textAlign = 'left';
    ctx.fillText(String(cpuScore), WIDTH / 2 + 40, 24);

    // Paddles
    ctx.fillStyle = '#e6edf3';
    drawPaddle(player);
    ctx.fillStyle = '#7dd3fc';
    drawPaddle(cpu);

    // Ball
    ctx.fillStyle = '#e6edf3';
    ctx.shadowColor = '#e6edf3';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
}

function drawPaddle(p) {
    ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const HELD = {
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
};

function isStartKey(k) {
    return k in HELD || k === ' ' || k === 'Spacebar' || k === 'Enter';
}

document.addEventListener('keydown', e => {
    const k = e.key;

    // Pause toggle
    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    // Start / restart from an overlay
    if (state !== 'running') {
        if (isStartKey(k)) {
            startGame();
            // fall through so the same key also registers as held
        } else {
            return;
        }
    }

    if (k in HELD) {
        keys[HELD[k]] = true;
        e.preventDefault();
    }
});

document.addEventListener('keyup', e => {
    const k = e.key;
    if (k in HELD) keys[HELD[k]] = false;
});

canvas.addEventListener('mousemove', e => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    // Scale in case the canvas is displayed at a different CSS size.
    const scaleY = canvas.height / rect.height;
    player.y = clamp((e.clientY - rect.top) * scaleY, player.h / 2, HEIGHT - player.h / 2);
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init — a still, centred board behind the start overlay.
// ---------------------------------------------------------------------------
bestRally = parseInt(localStorage.getItem('pong-best') || '0', 10);
bestEl.textContent = bestRally;
playerScore = 0;
cpuScore = 0;
rally = 0;
keys = { up: false, down: false };
player = { x: PADDLE_MARGIN + PADDLE_W / 2, y: HEIGHT / 2, w: PADDLE_W, h: PADDLE_H };
cpu = { x: WIDTH - PADDLE_MARGIN - PADDLE_W / 2, y: HEIGHT / 2, w: PADDLE_W, h: PADDLE_H };
ball = { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0, r: BALL_R };
state = 'idle';
draw();
