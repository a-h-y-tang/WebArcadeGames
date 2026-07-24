// ---------------------------------------------------------------------------
// Kaboom! — catch the Mad Bomber's falling bombs with a stack of buckets.
//
// Logic is written as top-level functions and mutable module-scope state so the
// Playwright suite can drive it deterministically (place bombs, move the paddle,
// call the steppers with a fixed dt) without depending on requestAnimationFrame
// or randomness.
// ---------------------------------------------------------------------------

const W = 480;
const H = 640;

// Layout ---------------------------------------------------------------------
const BOMBER_Y = 44;           // centre-line the bomber paces along
const BOMBER_R = 16;
const PADDLE_W = 96;           // horizontal span of the bucket stack
const PADDLE_H = 46;
const PADDLE_Y = H - 70;       // top of the bucket stack
const BUCKET_Y = PADDLE_Y;     // a bomb is caught when its bottom reaches here
const BOMB_R = 8;

// Rules ----------------------------------------------------------------------
const START_BUCKETS = 3;
const BOMBS_PER_WAVE = 10;
const DROP_INTERVAL = 0.9;     // seconds between the bomber's drops (wave 1)
const BASE_FALL = 150;         // px/sec fall speed at wave 1
const FALL_PER_WAVE = 40;      // extra px/sec per wave
const BASE_BOMBER = 90;        // px/sec bomber pace at wave 1
const BOMBER_PER_WAVE = 22;    // extra px/sec per wave
const PADDLE_STEP = 26;        // px per key press
const REVERSE_CHANCE = 0.012;  // per-step odds the bomber randomly reverses

// Colours --------------------------------------------------------------------
const CLR = {
    bomber: '#d8443a',
    bomberDark: '#7d1f19',
    bomb: '#2b2f3a',
    bombHi: '#565d70',
    fuse: '#ffb347',
    spark: '#fff2b0',
    bucket: '#3f8ecc',
    bucketHi: '#7cc0f5',
    bucketDark: '#245a86',
    ground: '#141a30',
};

// --- DOM --------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const scoreEl = document.getElementById('score');
const waveEl = document.getElementById('wave');
const bucketsEl = document.getElementById('buckets');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ------------------------------------------------------------------
let state;               // 'idle' | 'playing' | 'over'
let bombs;               // [{ x, y, r }]
let bomber;              // { x, dir }  dir in {-1, 1}
let paddleX;             // centre x of the bucket stack
let buckets;             // lives remaining
let score;
let best;
let wave;
let spawnedThisWave;     // bombs released so far this wave
let caughtThisWave;      // bombs caught so far this wave
let dropTimer;           // seconds until the next drop
const keys = {};

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------
function fallSpeed() {
    return BASE_FALL + (wave - 1) * FALL_PER_WAVE;
}

function bomberSpeed() {
    return BASE_BOMBER + (wave - 1) * BOMBER_PER_WAVE;
}

function paddleLeft() {
    return paddleX - PADDLE_W / 2;
}

function paddleRight() {
    return paddleX + PADDLE_W / 2;
}

function clampPaddle() {
    const half = PADDLE_W / 2;
    if (paddleX < half) paddleX = half;
    if (paddleX > W - half) paddleX = W - half;
}

// A bomb is caught when its bottom edge has reached the bucket line and its
// centre lies within the horizontal span of the stack.
function bombCaught(bomb) {
    if (bomb.y + bomb.r < BUCKET_Y) return false;
    return bomb.x >= paddleLeft() && bomb.x <= paddleRight();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function loadBest() {
    let stored = 0;
    try { stored = parseInt(localStorage.getItem('kaboom.best') || '0', 10); }
    catch (e) { stored = 0; }
    best = Number.isFinite(stored) ? stored : 0;
}

function saveBest() {
    if (score > best) {
        best = score;
        try { localStorage.setItem('kaboom.best', String(best)); } catch (e) { /* ignore */ }
    }
}

function resetGame() {
    state = 'idle';
    bombs = [];
    bomber = { x: W / 2, dir: 1 };
    paddleX = W / 2;
    buckets = START_BUCKETS;
    score = 0;
    wave = 1;
    spawnedThisWave = 0;
    caughtThisWave = 0;
    dropTimer = DROP_INTERVAL;
    updateHud();
}

function startGame() {
    resetGame();
    state = 'playing';
    hideOverlay();
    updateHud();
}

function gameOver() {
    state = 'over';
    saveBest();
    showOverlay('Game Over', 'Slide the buckets to catch every falling bomb',
        'Play Again', `You scored ${score} — reached wave ${wave}`);
    updateHud();
}

function nextWave() {
    wave += 1;
    spawnedThisWave = 0;
    caughtThisWave = 0;
    bombs = [];
    dropTimer = DROP_INTERVAL;
}

// ---------------------------------------------------------------------------
// Steppers (deterministic given their inputs)
// ---------------------------------------------------------------------------
function movePaddle(dx) {
    paddleX += dx;
    clampPaddle();
}

function dropBomb() {
    bombs.push({ x: bomber.x, y: BOMBER_Y + BOMBER_R, r: BOMB_R });
    spawnedThisWave += 1;
}

function stepBomber(dt) {
    bomber.x += bomber.dir * bomberSpeed() * dt;
    if (bomber.x < BOMBER_R) { bomber.x = BOMBER_R; bomber.dir = 1; }
    if (bomber.x > W - BOMBER_R) { bomber.x = W - BOMBER_R; bomber.dir = -1; }
    if (Math.random() < REVERSE_CHANCE) bomber.dir *= -1;
}

// Advance every bomb; resolve catches and misses. A miss costs a bucket and
// clears the screen. Returns nothing — mutates state.
function stepBombs(dt) {
    const speed = fallSpeed();
    let missed = false;

    for (let i = bombs.length - 1; i >= 0; i--) {
        const bomb = bombs[i];
        bomb.y += speed * dt;

        if (bombCaught(bomb)) {
            bombs.splice(i, 1);
            score += wave;
            caughtThisWave += 1;
            if (caughtThisWave >= BOMBS_PER_WAVE) {
                nextWave();
                updateHud();
                return;
            }
            continue;
        }

        if (bomb.y - bomb.r > H) {
            missed = true;
            break;
        }
    }

    if (missed) {
        buckets -= 1;
        bombs = [];
        if (buckets <= 0) {
            gameOver();
            return;
        }
        // resume the same wave: forget the un-caught bombs from the count
        spawnedThisWave = caughtThisWave;
        dropTimer = DROP_INTERVAL;
    }

    updateHud();
}

// Full per-frame update used by the animation loop.
function update(dt) {
    if (state !== 'playing') return;

    const paddleVel = 320; // px/sec while a key is held
    if (keys.left) movePaddle(-paddleVel * dt);
    if (keys.right) movePaddle(paddleVel * dt);

    stepBomber(dt);

    if (spawnedThisWave < BOMBS_PER_WAVE) {
        dropTimer -= dt;
        if (dropTimer <= 0) {
            dropBomb();
            dropTimer += DROP_INTERVAL * Math.max(0.45, 1 - (wave - 1) * 0.06);
        }
    }

    stepBombs(dt);
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------
function updateHud() {
    if (scoreEl) scoreEl.textContent = String(score);
    if (waveEl) waveEl.textContent = String(wave);
    if (bucketsEl) bucketsEl.textContent = String(Math.max(0, buckets));
    if (bestEl) bestEl.textContent = String(best);
}

function showOverlay(title, sub, btn, headline) {
    if (!overlay) return;
    if (overlayTitle) overlayTitle.textContent = title;
    if (overlayScore) overlayScore.textContent = headline || '';
    if (overlaySub) overlaySub.textContent = sub;
    if (btnStart) btnStart.textContent = btn || 'Start Game';
    overlay.classList.add('visible');
}

function hideOverlay() {
    if (overlay) overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // ground band
    ctx.fillStyle = CLR.ground;
    ctx.fillRect(0, PADDLE_Y + PADDLE_H + 8, W, H);

    drawBomber();
    for (const b of bombs) drawBomb(b);
    drawBuckets();
}

function drawBomber() {
    const x = bomber ? bomber.x : W / 2;
    ctx.save();
    ctx.translate(x, BOMBER_Y);
    ctx.fillStyle = CLR.bomberDark;
    ctx.fillRect(-BOMBER_R - 3, -BOMBER_R + 6, (BOMBER_R + 3) * 2, BOMBER_R + 4);
    ctx.fillStyle = CLR.bomber;
    ctx.beginPath();
    ctx.arc(0, 0, BOMBER_R, 0, Math.PI * 2);
    ctx.fill();
    // eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-5, -2, 3, 0, Math.PI * 2);
    ctx.arc(5, -2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(-5 + bomber.dir, -2, 1.4, 0, Math.PI * 2);
    ctx.arc(5 + bomber.dir, -2, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawBomb(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = CLR.bomb;
    ctx.beginPath();
    ctx.arc(0, 0, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CLR.bombHi;
    ctx.beginPath();
    ctx.arc(-b.r * 0.35, -b.r * 0.35, b.r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    // fuse + spark
    ctx.strokeStyle = CLR.fuse;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -b.r);
    ctx.quadraticCurveTo(b.r * 0.7, -b.r * 1.6, b.r * 0.2, -b.r * 2.1);
    ctx.stroke();
    ctx.fillStyle = CLR.spark;
    ctx.beginPath();
    ctx.arc(b.r * 0.2, -b.r * 2.1, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawBuckets() {
    const x = paddleX;
    const left = x - PADDLE_W / 2;
    const rows = Math.max(1, buckets);
    const rowH = PADDLE_H / 3;
    for (let i = 0; i < rows; i++) {
        const top = PADDLE_Y + (PADDLE_H - rowH) - i * (rowH + 2);
        const inset = i * 6;
        ctx.fillStyle = CLR.bucketDark;
        ctx.fillRect(left + inset, top, PADDLE_W - inset * 2, rowH);
        ctx.fillStyle = CLR.bucket;
        ctx.fillRect(left + inset + 2, top, PADDLE_W - inset * 2 - 4, rowH - 3);
        ctx.fillStyle = CLR.bucketHi;
        ctx.fillRect(left + inset + 4, top + 2, PADDLE_W - inset * 2 - 8, 3);
    }
}

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
let lastTime = null;
function frame(now) {
    if (lastTime === null) lastTime = now;
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.05) dt = 0.05;    // clamp long frames (tab switches)
    update(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function onKeyDown(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        if (state !== 'playing') startGame();
        return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        keys.left = true;
        if (state === 'playing') movePaddle(-PADDLE_STEP);
    }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        keys.right = true;
        if (state === 'playing') movePaddle(PADDLE_STEP);
    }
}

function onKeyUp(e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
}

function onMouseMove(e) {
    if (state !== 'playing' || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    paddleX = (e.clientX - rect.left) * (W / rect.width);
    clampPaddle();
}

// ---------------------------------------------------------------------------
// Wire-up
// ---------------------------------------------------------------------------
if (typeof document !== 'undefined') {
    loadBest();
    resetGame();

    if (btnStart) btnStart.addEventListener('click', startGame);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    if (canvas) canvas.addEventListener('mousemove', onMouseMove);

    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(frame);
}
