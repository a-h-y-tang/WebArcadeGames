// --- Dimensions ---
const W = 400;          // canvas width
const H = 600;          // canvas height
const PLAYER_W = 34;
const PLAYER_H = 34;
const PLAT_W = 68;
const PLAT_H = 14;

// --- Physics constants (per fixed timestep) ---
const STEP_MS = 16;             // fixed physics timestep
const GRAVITY = 0.35;           // downward acceleration
const JUMP_V = -11.5;           // upward velocity applied on a bounce
const MOVE_SPEED = 4.5;         // horizontal speed while a steer key is held
const SCROLL_THRESHOLD = 250;   // when the player rises above this, the world scrolls
const PLAT_GAP = 78;            // vertical spacing between generated platforms
const PX_PER_POINT = 10;        // pixels climbed per score point

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

// --- Colors ---
const CLR = {
    sky1:   '#0b1220',
    sky2:   '#111c33',
    plat:   '#38bdf8',
    platEdge: '#7dd3fc',
    body:   '#fbbf24',
    bodyEdge: '#f59e0b',
    eye:    '#1f2937',
    cloud:  'rgba(148, 197, 255, 0.10)',
};

// --- State ---
let player, platforms, score, best, scrollTotal, state;
let lastTime, acc, animId;
const keys = { left: false, right: false };

function randX() {
    return Math.random() * (W - PLAT_W);
}

// Build the initial ladder of platforms, bottom-up, with one squarely
// under the player so the game opens with a clean bounce.
function seedPlatforms() {
    platforms = [];
    const startX = (W - PLAT_W) / 2;
    platforms.push({ x: startX, y: H - 60 });
    for (let y = H - 60 - PLAT_GAP; y > -PLAT_GAP; y -= PLAT_GAP) {
        platforms.push({ x: randX(), y });
    }
    return startX;
}

function resetWorld() {
    const startX = seedPlatforms();
    player = {
        x: startX + (PLAT_W - PLAYER_W) / 2,
        y: H - 60 - PLAYER_H,
        vx: 0,
        vy: JUMP_V,   // start already springing upward
    };
    score = 0;
    scrollTotal = 0;
    keys.left = false;
    keys.right = false;
    scoreEl.textContent = '0';
}

function startGame() {
    resetWorld();
    state = 'running';
    overlay.classList.remove('visible');
    lastTime = null;
    acc = 0;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('cloud-jumper-best', best);
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} pts`;
    overlaySub.textContent = 'Press Space or ← → to play again';
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
    acc = 0;
    animId = requestAnimationFrame(loop);
}

// Move a platform that has scrolled off the bottom back up above the
// current highest platform, so the ladder never runs out.
function recyclePlatforms() {
    for (const p of platforms) {
        if (p.y > H) {
            let minY = Infinity;
            for (const q of platforms) if (q.y < minY) minY = q.y;
            p.y = minY - PLAT_GAP;
            p.x = randX();
        }
    }
}

// Advance the simulation by exactly one fixed timestep. Kept free of any
// state guard so tests can drive physics deterministically.
function step() {
    // Horizontal steering + wrap-around
    player.vx = keys.left ? -MOVE_SPEED : keys.right ? MOVE_SPEED : 0;
    player.x += player.vx;
    if (player.x + PLAYER_W < 0) player.x = W;
    else if (player.x > W) player.x = -PLAYER_W;

    // Gravity
    player.vy += GRAVITY;
    player.y += player.vy;

    // Bounce off a platform only while falling and only when the feet cross
    // the platform's top surface during this step.
    if (player.vy > 0) {
        const footY = player.y + PLAYER_H;
        const prevFoot = footY - player.vy;
        for (const p of platforms) {
            if (prevFoot <= p.y && footY >= p.y &&
                player.x + PLAYER_W > p.x && player.x < p.x + PLAT_W) {
                player.y = p.y - PLAYER_H;
                player.vy = JUMP_V;
                break;
            }
        }
    }

    // Scroll the world down when the player climbs past the threshold, and
    // convert climbed pixels into score.
    if (player.y < SCROLL_THRESHOLD) {
        const delta = SCROLL_THRESHOLD - player.y;
        player.y = SCROLL_THRESHOLD;
        for (const p of platforms) p.y += delta;
        scrollTotal += delta;
        const newScore = Math.floor(scrollTotal / PX_PER_POINT);
        if (newScore !== score) {
            score = newScore;
            scoreEl.textContent = score;
        }
        recyclePlatforms();
    }

    // Fell off the bottom of the screen — game over.
    if (player.y > H) {
        endGame();
    }
}

// --- Game loop: fixed-timestep accumulator driven by requestAnimationFrame ---
function loop(timestamp) {
    if (state !== 'running') return;
    if (lastTime == null) lastTime = timestamp;
    acc += timestamp - lastTime;
    lastTime = timestamp;

    let iterations = 0;
    while (acc >= STEP_MS && iterations < 5) {
        step();
        acc -= STEP_MS;
        iterations++;
        if (state !== 'running') break;
    }

    draw();
    if (state === 'running') {
        animId = requestAnimationFrame(loop);
    }
}

// --- Rendering ---
function draw() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, CLR.sky2);
    g.addColorStop(1, CLR.sky1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Soft parallax clouds tied to how far we've climbed
    ctx.fillStyle = CLR.cloud;
    for (let i = 0; i < 5; i++) {
        const cx = (i * 97 + 40) % W;
        const cy = (i * 130 + (scrollTotal * 0.3) % H) % H;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 46, 20, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Platforms
    for (const p of platforms) {
        ctx.fillStyle = CLR.plat;
        roundRect(p.x, p.y, PLAT_W, PLAT_H, 6);
        ctx.fillStyle = CLR.platEdge;
        roundRect(p.x, p.y, PLAT_W, 4, 3);
    }

    // Player
    ctx.fillStyle = CLR.bodyEdge;
    roundRect(player.x - 1, player.y - 1, PLAYER_W + 2, PLAYER_H + 2, 9);
    ctx.fillStyle = CLR.body;
    roundRect(player.x, player.y, PLAYER_W, PLAYER_H, 8);

    // Eyes — look in the direction of travel
    const lookX = player.vx < 0 ? -3 : player.vx > 0 ? 3 : 0;
    ctx.fillStyle = CLR.eye;
    const eyeY = player.y + PLAYER_H * 0.38;
    dot(player.x + PLAYER_W * 0.33 + lookX, eyeY, 3);
    dot(player.x + PLAYER_W * 0.67 + lookX, eyeY, 3);
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
}

function dot(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

// --- Input ---
const MOVE_KEYS = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
};
const START_KEYS = new Set([' ', 'Spacebar', 'ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D']);

document.addEventListener('keydown', e => {
    // Pause / resume
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    // Start / restart from the overlay (but not while merely paused)
    if ((state === 'idle' || state === 'over') && START_KEYS.has(e.key)) {
        startGame();
        if (MOVE_KEYS[e.key]) keys[MOVE_KEYS[e.key]] = true;
        e.preventDefault();
        return;
    }

    if (state === 'running' && MOVE_KEYS[e.key]) {
        keys[MOVE_KEYS[e.key]] = true;
        e.preventDefault();
    }
});

document.addEventListener('keyup', e => {
    if (MOVE_KEYS[e.key]) keys[MOVE_KEYS[e.key]] = false;
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// --- Init ---
best = parseInt(localStorage.getItem('cloud-jumper-best') || '0', 10);
bestEl.textContent = best;
state = 'idle';

// Seed a world so draw() and tests have valid state before the first start.
resetWorld();
draw();
