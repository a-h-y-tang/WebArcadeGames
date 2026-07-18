// --- Field & object dimensions ---
const WIDTH = 400;
const HEIGHT = 600;
const PLAYER_W = 34;
const PLAYER_H = 34;
const PLATFORM_W = 68;
const PLATFORM_H = 14;

// Motion is expressed in pixels-per-millisecond (and gravity per ms²) so the
// simulation is frame-rate independent, matching the other games in this repo.
const GRAVITY = 0.0018;        // downward acceleration
const JUMP_VELOCITY = 0.62;    // fixed upward speed of every bounce
const MOVE_SPEED = 0.32;       // horizontal steering speed
const MOVING_SPEED = 0.12;     // drift speed of moving platforms

// The world only scrolls once the player climbs above this line (40% down).
const CAMERA_LINE = HEIGHT * 0.4;

// Vertical spacing between generated platforms. The single-jump apex is
// JUMP_VELOCITY² / (2·GRAVITY) ≈ 107 px, so MAX_GAP stays comfortably below it
// and every generated layout is reachable.
const MIN_GAP = 55;
const MAX_GAP = 95;

// How far a falling player's feet may overshoot a platform top and still land.
const LANDING_TOL = 12;

// Platform colours by type.
const PLATFORM_COLORS = {
    normal: '#22c55e',
    moving: '#38bdf8',
    breakable: '#b45309',
};

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
let player, platforms, score, best, height, state, lastTime, animId, facing;
const keys = {};

// -----------------------------------------------------------------------
// Seeded RNG (mulberry32) — keeps generation self-contained and reseedable.
// -----------------------------------------------------------------------
let rngState = 0x9e3779b9;
function seedRng(s) {
    rngState = s >>> 0;
}
function rand() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// -----------------------------------------------------------------------
// Platform generation
// -----------------------------------------------------------------------
function makePlatform(y) {
    const x = rand() * (WIDTH - PLATFORM_W);
    const r = rand();
    let type = 'normal';
    let vx = 0;
    if (r < 0.14) {
        type = 'breakable';
    } else if (r < 0.34) {
        type = 'moving';
        vx = (rand() < 0.5 ? -1 : 1) * MOVING_SPEED;
    }
    return { x, y, w: PLATFORM_W, h: PLATFORM_H, type, alive: true, vx };
}

// A breakable platform gives no bounce, so if it were the only platform in its
// band the run would dead-end. Guarantee a safe normal platform alongside it,
// on the opposite half of the screen.
function makeNormalBeside(p) {
    let x;
    if (p.x < WIDTH / 2) {
        x = WIDTH / 2 + rand() * (WIDTH / 2 - PLATFORM_W);
    } else {
        x = rand() * (WIDTH / 2 - PLATFORM_W);
    }
    x = Math.max(0, Math.min(WIDTH - PLATFORM_W, x));
    return { x, y: p.y, w: PLATFORM_W, h: PLATFORM_H, type: 'normal', alive: true, vx: 0 };
}

// Ensure platforms exist upward until the topmost one is above `topLimit`.
function fillPlatformsUpTo(topLimit) {
    let minY = platforms.length ? Math.min(...platforms.map(p => p.y)) : HEIGHT;
    while (minY > topLimit) {
        const gap = MIN_GAP + rand() * (MAX_GAP - MIN_GAP);
        minY -= gap;
        const p = makePlatform(minY);
        platforms.push(p);
        if (p.type === 'breakable') {
            platforms.push(makeNormalBeside(p));
        }
    }
}

// Drop platforms that have scrolled off the bottom, then top up the column.
function recyclePlatforms() {
    platforms = platforms.filter(p => p.y <= HEIGHT + 40);
    fillPlatformsUpTo(-PLATFORM_H);
}

function resetWorld() {
    platforms = [];
    const startY = HEIGHT - 80;
    platforms.push({
        x: WIDTH / 2 - PLATFORM_W / 2,
        y: startY,
        w: PLATFORM_W,
        h: PLATFORM_H,
        type: 'normal',
        alive: true,
        vx: 0,
    });
    fillPlatformsUpTo(-PLATFORM_H);

    player = {
        x: WIDTH / 2 - PLAYER_W / 2,
        y: startY - PLAYER_H,
        vx: 0,
        vy: 0,
        w: PLAYER_W,
        h: PLAYER_H,
    };
    facing = 1;
    height = 0;
    score = 0;
}

// -----------------------------------------------------------------------
// Game lifecycle
// -----------------------------------------------------------------------
function startGame() {
    seedRng((0x9e3779b9 ^ performance.now() * 1000) >>> 0);
    resetWorld();
    state = 'running';

    scoreEl.textContent = score;
    overlay.classList.remove('visible');

    player.vy = -JUMP_VELOCITY; // launch off the starting platform

    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('doodlejump-best', best);
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
// Physics — advance the world by dt milliseconds
// -----------------------------------------------------------------------
function step(dt) {
    if (state !== 'running') return;

    // Moving platforms drift and reverse at the walls.
    for (const p of platforms) {
        if (p.type === 'moving' && p.alive) {
            p.x += p.vx * dt;
            if (p.x <= 0) {
                p.x = 0;
                p.vx = Math.abs(p.vx);
            } else if (p.x + p.w >= WIDTH) {
                p.x = WIDTH - p.w;
                p.vx = -Math.abs(p.vx);
            }
        }
    }

    // Gravity and vertical motion.
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;

    // Horizontal wrap-around.
    if (player.x > WIDTH) {
        player.x -= WIDTH;
    } else if (player.x + player.w < 0) {
        player.x += WIDTH;
    }

    // Landing: only while falling, against the first overlapping live platform.
    if (player.vy > 0) {
        const feet = player.y + player.h;
        for (const p of platforms) {
            if (!p.alive) continue;
            const overlapX = player.x + player.w > p.x && player.x < p.x + p.w;
            const overlapY = feet >= p.y && feet <= p.y + p.h + LANDING_TOL;
            if (overlapX && overlapY) {
                if (p.type === 'breakable') {
                    p.alive = false; // breaks, no bounce — fall through
                } else {
                    player.y = p.y - player.h;
                    player.vy = -JUMP_VELOCITY;
                }
                break;
            }
        }
    }

    // Camera: climbing above the line scrolls the world down and scores height.
    if (player.y < CAMERA_LINE) {
        const delta = CAMERA_LINE - player.y;
        player.y = CAMERA_LINE;
        for (const p of platforms) p.y += delta;
        height += delta;
        score = Math.floor(height);
        scoreEl.textContent = score;
        recyclePlatforms();
    }

    // Falling below the bottom ends the run.
    if (player.y > HEIGHT) {
        endGame();
    }
}

// -----------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------
function updatePlayerFromKeys(dt) {
    let dx = 0;
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) dx -= 1;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) dx += 1;
    if (dx !== 0) {
        facing = dx;
        player.x += dx * MOVE_SPEED * dt;
        if (player.x > WIDTH) player.x -= WIDTH;
        else if (player.x + player.w < 0) player.x += WIDTH;
    }
}

function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = Math.min(50, timestamp - lastTime); // clamp big frame gaps
    lastTime = timestamp;

    if (state === 'running') {
        updatePlayerFromKeys(elapsed);
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
    // Background gradient.
    const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    g.addColorStop(0, '#0d1117');
    g.addColorStop(1, '#111a2b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Platforms.
    for (const p of platforms) {
        if (!p.alive) continue;
        ctx.fillStyle = PLATFORM_COLORS[p.type] || PLATFORM_COLORS.normal;
        roundRect(ctx, p.x, p.y, p.w, p.h, 5);
        if (p.type === 'breakable') {
            // A crack down the middle.
            ctx.strokeStyle = '#0d1117';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(p.x + p.w / 2, p.y + 2);
            ctx.lineTo(p.x + p.w / 2 - 4, p.y + p.h - 2);
            ctx.stroke();
        }
    }

    drawPlayer();
}

function drawPlayer() {
    const x = player.x;
    const y = player.y;
    const w = player.w;
    const h = player.h;

    // Body.
    ctx.fillStyle = '#eab308';
    ctx.shadowColor = '#eab30888';
    ctx.shadowBlur = 12;
    roundRect(ctx, x, y, w, h, 9);
    ctx.shadowBlur = 0;

    // Eyes (looking in the direction of travel).
    const eyeY = y + h * 0.38;
    const eyeDX = facing >= 0 ? w * 0.62 : w * 0.38;
    ctx.fillStyle = '#0d1117';
    ctx.beginPath();
    ctx.arc(x + w * 0.38, eyeY, 3, 0, Math.PI * 2);
    ctx.arc(x + eyeDX, eyeY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Little smile.
    ctx.strokeStyle = '#0d1117';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h * 0.58, w * 0.22, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
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

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
best = parseInt(localStorage.getItem('doodlejump-best') || '0', 10);
bestEl.textContent = best;
state = 'idle';
resetWorld();
scoreEl.textContent = score;
draw();
