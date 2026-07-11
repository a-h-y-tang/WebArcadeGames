// --- Dimensions & tuning constants ---
const WIDTH = 400;
const HEIGHT = 600;
const GROUND_H = 60;          // height of the ground strip at the bottom
const FLOOR_Y = HEIGHT - GROUND_H;

const BIRD_X = 90;            // bird's fixed horizontal position
const BIRD_R = 14;            // bird radius (bounding box half-size)

const GRAVITY = 0.45;         // downward acceleration per physics tick
const FLAP = -8;             // upward velocity applied on a flap
const MAX_FALL = 12;          // terminal downward velocity

const PIPE_W = 62;            // pipe width
const GAP = 165;             // vertical gap the bird flies through
const PIPE_SPEED = 2.4;       // horizontal scroll speed per tick
const PIPE_SPACING = 220;     // horizontal distance between successive pipes
const GAP_MARGIN = 60;        // min distance from top/floor to the gap

const TICK_MS = 22;           // fixed physics timestep
const MAX_STEPS = 5;          // cap on physics steps per frame (anti spiral-of-death)

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

const CLR = {
    skyTop:   '#0d1117',
    skyBot:   '#161b22',
    ground:   '#3f2d1b',
    groundTop:'#5a4127',
    pipe:     '#22c55e',
    pipeDark: '#16a34a',
    pipeLip:  '#4ade80',
    bird:     '#fbbf24',
    birdWing: '#f59e0b',
    birdEye:  '#0d1117',
    beak:     '#f97316',
};

// --- State ---
let bird, pipes, score, best, state, lastTime, animId;

function startGame() {
    bird = { x: BIRD_X, y: HEIGHT * 0.42, vy: 0 };
    pipes = [];
    score = 0;
    state = 'running';
    lastTime = null;

    scoreEl.textContent = score;
    overlay.classList.remove('visible');

    spawnPipe();
    flap(); // give the bird an immediate hop on start

    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('flappy-best', best);
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score}`;
    overlaySub.textContent = 'Press Space to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function flap() {
    if (state === 'running') {
        bird.vy = FLAP;
    }
}

function spawnPipe() {
    const x = pipes.length ? pipes[pipes.length - 1].x + PIPE_SPACING : WIDTH + 40;
    const minGap = GAP_MARGIN;
    const maxGap = FLOOR_Y - GAP - GAP_MARGIN;
    const gapY = minGap + Math.random() * Math.max(0, maxGap - minGap);
    pipes.push({ x, gapY, passed: false });
}

// --- Game loop (fixed-timestep accumulator) ---
function loop(timestamp) {
    if (state !== 'running') return;

    if (lastTime == null) lastTime = timestamp;
    let acc = timestamp - lastTime;

    let steps = 0;
    while (acc >= TICK_MS && steps < MAX_STEPS) {
        tick();
        acc -= TICK_MS;
        steps++;
        if (state !== 'running') break; // a tick may have ended the game
    }
    lastTime = timestamp - acc;

    draw();
    if (state === 'running') {
        animId = requestAnimationFrame(loop);
    }
}

function tick() {
    // Bird physics
    bird.vy = Math.min(bird.vy + GRAVITY, MAX_FALL);
    bird.y += bird.vy;

    // Ceiling clamp (soft — no death at the top)
    if (bird.y < BIRD_R) {
        bird.y = BIRD_R;
        bird.vy = 0;
    }

    // Scroll pipes and prune those fully off the left edge
    for (const p of pipes) p.x -= PIPE_SPEED;
    pipes = pipes.filter(p => p.x + PIPE_W > 0);

    // Spawn a new pipe once the last one has scrolled in far enough
    if (pipes.length === 0 || pipes[pipes.length - 1].x < WIDTH - PIPE_SPACING) {
        spawnPipe();
    }

    // Scoring: a pipe scores the moment its right edge clears the bird
    for (const p of pipes) {
        if (!p.passed && p.x + PIPE_W < BIRD_X) {
            p.passed = true;
            score++;
            scoreEl.textContent = score;
        }
    }

    // Ground collision
    if (bird.y + BIRD_R >= FLOOR_Y) {
        bird.y = FLOOR_Y - BIRD_R;
        endGame();
        return;
    }

    // Pipe collision (bird bounding box vs. the two pipe rects)
    for (const p of pipes) {
        const overlapsX = BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_W;
        if (!overlapsX) continue;
        const aboveGap = bird.y - BIRD_R < p.gapY;
        const belowGap = bird.y + BIRD_R > p.gapY + GAP;
        if (aboveGap || belowGap) {
            endGame();
            return;
        }
    }
}

// --- Rendering ---
function draw() {
    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, CLR.skyTop);
    sky.addColorStop(1, CLR.skyBot);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Pipes
    for (const p of pipes) drawPipe(p);

    // Ground
    ctx.fillStyle = CLR.ground;
    ctx.fillRect(0, FLOOR_Y, WIDTH, GROUND_H);
    ctx.fillStyle = CLR.groundTop;
    ctx.fillRect(0, FLOOR_Y, WIDTH, 5);

    // Bird
    drawBird();
}

function drawPipe(p) {
    const topH = p.gapY;
    const botY = p.gapY + GAP;
    // Top pipe
    ctx.fillStyle = CLR.pipe;
    ctx.fillRect(p.x, 0, PIPE_W, topH);
    ctx.fillStyle = CLR.pipeDark;
    ctx.fillRect(p.x + PIPE_W - 8, 0, 8, topH);
    ctx.fillStyle = CLR.pipeLip;
    ctx.fillRect(p.x - 3, topH - 16, PIPE_W + 6, 16);
    // Bottom pipe
    ctx.fillStyle = CLR.pipe;
    ctx.fillRect(p.x, botY, PIPE_W, FLOOR_Y - botY);
    ctx.fillStyle = CLR.pipeDark;
    ctx.fillRect(p.x + PIPE_W - 8, botY, 8, FLOOR_Y - botY);
    ctx.fillStyle = CLR.pipeLip;
    ctx.fillRect(p.x - 3, botY, PIPE_W + 6, 16);
}

function drawBird() {
    const tilt = Math.max(-0.5, Math.min(1.1, bird.vy / 12));
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(tilt);

    // Body
    ctx.fillStyle = CLR.bird;
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
    ctx.fill();

    // Wing
    ctx.fillStyle = CLR.birdWing;
    ctx.beginPath();
    ctx.ellipse(-3, 3, 8, 5, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Beak
    ctx.fillStyle = CLR.beak;
    ctx.beginPath();
    ctx.moveTo(BIRD_R - 2, -2);
    ctx.lineTo(BIRD_R + 8, 1);
    ctx.lineTo(BIRD_R - 2, 4);
    ctx.closePath();
    ctx.fill();

    // Eye
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(6, -5, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CLR.birdEye;
    ctx.beginPath();
    ctx.arc(7, -5, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

// --- Pause / resume ---
function pauseGame() {
    if (state !== 'running') return;
    state = 'paused';
    overlayTitle.textContent = 'Paused';
    overlayScore.textContent = '';
    overlaySub.textContent = 'Press P to resume';
    btnStart.textContent = 'Resume';
    overlay.classList.add('visible');
}

function resumeGame() {
    if (state !== 'paused') return;
    state = 'running';
    lastTime = null;
    overlay.classList.remove('visible');
    animId = requestAnimationFrame(loop);
}

// --- Input ---
const FLAP_KEYS = new Set([' ', 'Spacebar', 'ArrowUp', 'w', 'W']);

function handleFlapInput() {
    if (state === 'running') {
        flap();
    } else if (state === 'idle' || state === 'over') {
        startGame();
    }
    // 'paused' ignores flap input; use P or the Resume button
}

document.addEventListener('keydown', e => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }
    if (FLAP_KEYS.has(e.key)) {
        e.preventDefault();
        handleFlapInput();
    }
});

canvas.addEventListener('mousedown', () => handleFlapInput());

// Clicking the start / game-over screen (but not the button, which handles
// itself) begins a new run. The overlay is hidden while running, so this never
// interferes with in-game canvas flaps.
overlay.addEventListener('mousedown', e => {
    if (e.target === btnStart) return;
    if (state === 'idle' || state === 'over') startGame();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// --- Init ---
best = parseInt(localStorage.getItem('flappy-best') || '0', 10);
bestEl.textContent = best;
state = 'idle';

// Seed state so the first draw has a valid bird and pipes.
bird = { x: BIRD_X, y: HEIGHT * 0.42, vy: 0 };
pipes = [{ x: WIDTH + 40, gapY: HEIGHT * 0.4, passed: false }];
draw();
