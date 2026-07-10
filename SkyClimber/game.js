// ---------------------------------------------------------------------------
// Sky Climber — an endless vertical platform-jumper (Doodle-Jump style).
// The hopper bounces automatically off platforms; you only steer left / right.
// All motion is time-based (pixels per second) and integrated with a delta
// time `dt` (seconds). `update(dt)` is a pure physics step with no `state`
// check, so tests can drive the simulation deterministically.
// ---------------------------------------------------------------------------

const WIDTH = 480;
const HEIGHT = 640;

// Tunables
const HOPPER_W = 44;
const HOPPER_H = 44;
const GRAVITY = 1500;            // px / second²
const JUMP_SPEED = 760;          // upward launch velocity on a bounce, px / second
const MOVE_SPEED = 340;          // horizontal steer speed, px / second
const CAMERA_LINE = 260;         // the hopper never climbs visually above this y

const PLATFORM_W = 68;
const PLATFORM_H = 16;
const MIN_GAP = 70;              // vertical gap between platforms, px
const MAX_GAP = 150;             // clamped below MAX_JUMP_HEIGHT so every gap is jumpable
const PLATFORM_MOVE_SPEED = 90;  // moving platforms, px / second
const MOVING_CHANCE = 0.22;      // fraction of spawned platforms that move

// The apex a single bounce can reach: v² / 2g. Kept above MAX_GAP so the tower
// is always climbable.
const MAX_JUMP_HEIGHT = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let hopper, platforms, score, bestScore, scroll, state, keys, lastTime, animId;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function randRange(lo, hi) {
    return lo + Math.random() * (hi - lo);
}

function makePlatform(y, allowMoving) {
    const x = randRange(PLATFORM_W / 2, WIDTH - PLATFORM_W / 2);
    const moving = allowMoving && Math.random() < MOVING_CHANCE;
    return {
        x,
        y,
        w: PLATFORM_W,
        h: PLATFORM_H,
        type: moving ? 'moving' : 'static',
        vx: moving ? (Math.random() < 0.5 ? -1 : 1) * PLATFORM_MOVE_SPEED : 0,
    };
}

// Fill the tower from the starting platform up past the top of the screen.
function generatePlatforms() {
    platforms = [];
    // A guaranteed static platform directly under the hopper's start position.
    const startY = HEIGHT - 60;
    platforms.push({ x: WIDTH / 2, y: startY, w: PLATFORM_W, h: PLATFORM_H, type: 'static', vx: 0 });

    let y = startY;
    while (y > -PLATFORM_H) {
        y -= randRange(MIN_GAP, MAX_GAP);
        platforms.push(makePlatform(y, true));
    }
    return startY;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function startGame() {
    score = 0;
    scroll = 0;
    keys = { left: false, right: false };

    const startY = generatePlatforms();
    // Rest the hopper's feet on the starting platform.
    hopper = {
        x: WIDTH / 2,
        y: (startY - PLATFORM_H / 2) - HOPPER_H / 2,
        vx: 0,
        vy: 0,
        w: HOPPER_W,
        h: HOPPER_H,
    };

    scoreEl.textContent = score;
    overlay.classList.remove('visible');
    state = 'running';
    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} m`;
    overlaySub.textContent = score >= bestScore && score > 0
        ? 'A new personal best — press ← or → to climb again'
        : 'You fell — press ← or → to climb again';
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

function registerHeight() {
    if (score > bestScore) {
        bestScore = score;
        bestEl.textContent = bestScore;
        localStorage.setItem('sky-climber-best', bestScore);
    }
}

// Any platform that has scrolled below the board is re-spawned above the
// current highest platform, a reachable gap up.
function recyclePlatforms() {
    for (const p of platforms) {
        if (p.y - p.h / 2 > HEIGHT) {
            let minY = Infinity;
            for (const q of platforms) if (q !== p) minY = Math.min(minY, q.y);
            if (!isFinite(minY)) minY = 0;
            const np = makePlatform(minY - randRange(MIN_GAP, MAX_GAP), true);
            p.x = np.x;
            p.y = np.y;
            p.type = np.type;
            p.vx = np.vx;
        }
    }
}

// ---------------------------------------------------------------------------
// Physics — one deterministic step. No `state` gating on purpose.
// ---------------------------------------------------------------------------
function update(dt) {
    // Horizontal steering (no inertia — release to stop).
    hopper.vx = (keys.right ? MOVE_SPEED : 0) - (keys.left ? MOVE_SPEED : 0);
    hopper.x += hopper.vx * dt;
    // Wrap around the side walls.
    hopper.x = ((hopper.x % WIDTH) + WIDTH) % WIDTH;

    // Moving platforms slide and bounce off the walls.
    for (const p of platforms) {
        if (p.type !== 'moving') continue;
        p.x += p.vx * dt;
        if (p.x < p.w / 2) {
            p.x = p.w / 2;
            p.vx = Math.abs(p.vx);
        } else if (p.x > WIDTH - p.w / 2) {
            p.x = WIDTH - p.w / 2;
            p.vx = -Math.abs(p.vx);
        }
    }

    // Vertical integration.
    const prevFeet = hopper.y + hopper.h / 2;
    hopper.vy += GRAVITY * dt;
    hopper.y += hopper.vy * dt;
    const feet = hopper.y + hopper.h / 2;

    // Bounce: only while falling, and only when the feet cross a platform top.
    if (hopper.vy > 0) {
        for (const p of platforms) {
            const top = p.y - p.h / 2;
            const overX = hopper.x + hopper.w / 2 > p.x - p.w / 2
                       && hopper.x - hopper.w / 2 < p.x + p.w / 2;
            if (overX && prevFeet <= top && feet >= top) {
                hopper.y = top - hopper.h / 2;
                hopper.vy = -JUMP_SPEED;
                break;
            }
        }
    }

    // Camera: scroll the world down when the hopper rises past the camera line.
    if (hopper.y < CAMERA_LINE) {
        const dy = CAMERA_LINE - hopper.y;
        hopper.y = CAMERA_LINE;
        for (const p of platforms) p.y += dy;
        scroll += dy;
        score = Math.floor(scroll / 10);
        scoreEl.textContent = score;
        registerHeight();
    }

    // Recycle platforms that fell below the board.
    recyclePlatforms();

    // Game over: the hopper has dropped below the bottom edge.
    if (hopper.y - hopper.h / 2 > HEIGHT) {
        endGame();
    }
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
function loop(timestamp) {
    if (state !== 'running') return;
    if (lastTime == null) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.05) dt = 0.05; // clamp big gaps (tab switches) so we can't tunnel

    update(dt);
    draw();
    if (state === 'running') animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function draw() {
    // Sky gradient.
    const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    grad.addColorStop(0, '#0a1a2f');
    grad.addColorStop(1, '#071019');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Platforms.
    for (const p of platforms) {
        ctx.fillStyle = p.type === 'moving' ? '#7dd3fc' : '#3fb950';
        roundRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, 6);
        ctx.fill();
    }

    // Hopper.
    ctx.fillStyle = '#f0c674';
    ctx.strokeStyle = '#5a4620';
    ctx.lineWidth = 2;
    roundRect(hopper.x - hopper.w / 2, hopper.y - hopper.h / 2, hopper.w, hopper.h, 10);
    ctx.fill();
    ctx.stroke();
    // Eyes, facing the steer direction.
    const look = hopper.vx > 0 ? 6 : hopper.vx < 0 ? -6 : 0;
    ctx.fillStyle = '#2b2b2b';
    ctx.beginPath();
    ctx.arc(hopper.x - 8 + look, hopper.y - 6, 4, 0, Math.PI * 2);
    ctx.arc(hopper.x + 8 + look, hopper.y - 6, 4, 0, Math.PI * 2);
    ctx.fill();
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const HELD = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
};

function isStartKey(k) {
    return k in HELD || k === ' ' || k === 'Spacebar' || k === 'Enter';
}

document.addEventListener('keydown', e => {
    const k = e.key;

    // Pause toggle.
    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    // Start / restart from an overlay.
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

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init — a still, centred board behind the start overlay.
// ---------------------------------------------------------------------------
bestScore = parseInt(localStorage.getItem('sky-climber-best') || '0', 10);
bestEl.textContent = bestScore;
score = 0;
scroll = 0;
keys = { left: false, right: false };
const initStartY = generatePlatforms();
hopper = {
    x: WIDTH / 2,
    y: (initStartY - PLATFORM_H / 2) - HOPPER_H / 2,
    vx: 0,
    vy: 0,
    w: HOPPER_W,
    h: HOPPER_H,
};
state = 'idle';
draw();
