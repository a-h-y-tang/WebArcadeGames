// -------------------------------------------------------------------------
// Fruit Slice — a fruit-slicing reflex arcade game on an HTML5 canvas.
//
// Fruit and bombs are launched up from the bottom in parabolic arcs; the
// player drags the pointer to slice them. The simulation state and the two
// pure functions that drive it — step(dt) and slice(x1,y1,x2,y2) — are kept
// as script-scope globals so the Playwright suite can drive the game
// deterministically with no build step.
// -------------------------------------------------------------------------

const WIDTH = 600;
const HEIGHT = 600;

const GRAVITY = 900;           // px / s²  (downward is positive)
const START_LIVES = 3;
const SPAWN_INTERVAL = 1.15;   // seconds between waves
const FRUIT_R = 28;
const BOMB_R = 26;

// Palette of fruit colours (base, highlight) picked at random per fruit.
const FRUITS = [
    { base: '#ef4444', hi: '#fca5a5' }, // apple / cherry red
    { base: '#f59e0b', hi: '#fcd34d' }, // orange
    { base: '#22c55e', hi: '#86efac' }, // lime
    { base: '#a855f7', hi: '#d8b4fe' }, // grape
    { base: '#eab308', hi: '#fde68a' }, // lemon
];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let objects, particles, score, lives, best, state, spawnTimer, lastTime;
let trail;   // recent pointer points for drawing the blade streak

objects = [];
particles = [];
trail = [];
best = parseInt(localStorage.getItem('fruitslice-best') || '0', 10) || 0;

// -------------------------------------------------------------------------
// Spawning
// -------------------------------------------------------------------------
function randRange(min, max) {
    return min + Math.random() * (max - min);
}

// Chance the next object is a bomb, rising slowly with score.
function bombChance() {
    return Math.min(0.25, 0.06 + score / 4000);
}

function spawnObject(type, x) {
    const isBomb = type === 'bomb';
    const startX = x !== undefined ? x : randRange(WIDTH * 0.15, WIDTH * 0.85);
    // Aim the launch back toward the centre so arcs stay on-screen.
    const dir = startX < WIDTH / 2 ? 1 : -1;
    const o = {
        x: startX,
        y: HEIGHT + (isBomb ? BOMB_R : FRUIT_R),
        vx: dir * randRange(20, 120),
        vy: -randRange(620, 780),
        r: isBomb ? BOMB_R : FRUIT_R,
        type: isBomb ? 'bomb' : 'fruit',
        sliced: false,
        spin: randRange(-3, 3),
        angle: 0,
        color: isBomb ? null : FRUITS[Math.floor(Math.random() * FRUITS.length)],
    };
    objects.push(o);
    return o;
}

function spawnWave() {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
        const type = Math.random() < bombChance() ? 'bomb' : 'fruit';
        spawnObject(type);
    }
}

function addSplash(o) {
    const color = o.color ? o.color.base : '#f87171';
    for (let i = 0; i < 12; i++) {
        const a = randRange(0, Math.PI * 2);
        const spd = randRange(60, 260);
        particles.push({
            x: o.x, y: o.y,
            vx: Math.cos(a) * spd,
            vy: Math.sin(a) * spd,
            life: 1, color,
        });
    }
}

// -------------------------------------------------------------------------
// Geometry: distance from a line segment to a circle centre
// -------------------------------------------------------------------------
function segmentHitsCircle(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((cx - x1) * dx + (cy - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const ddx = cx - px;
    const ddy = cy - py;
    return ddx * ddx + ddy * ddy <= r * r;
}

// -------------------------------------------------------------------------
// Slicing — one call represents a single pointer movement segment.
// Returns the number of fruit sliced.
// -------------------------------------------------------------------------
function slice(x1, y1, x2, y2) {
    if (state !== 'running') return 0;
    let count = 0;
    let hitBomb = false;
    for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        if (o.sliced) continue;
        if (!segmentHitsCircle(x1, y1, x2, y2, o.x, o.y, o.r)) continue;
        if (o.type === 'bomb') {
            hitBomb = true;
        } else {
            count++;
            addSplash(o);
            objects.splice(i, 1);
        }
    }
    if (count > 0) {
        // Base point each, plus a combo bonus for multiple in one stroke.
        score += count + (count > 1 ? (count - 1) * 2 : 0);
        updateHud();
    }
    if (hitBomb) endGame();
    return count;
}

// -------------------------------------------------------------------------
// Simulation
// -------------------------------------------------------------------------
function step(dt) {
    if (state !== 'running') return;

    for (const o of objects) {
        o.vy += GRAVITY * dt;
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        o.angle += o.spin * dt;
    }

    // Cull objects that have fallen back below the bottom edge.
    for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        if (o.vy > 0 && o.y - o.r > HEIGHT) {
            if (o.type === 'fruit' && !o.sliced) {
                lives--;
                updateHud();
                objects.splice(i, 1);
                if (lives <= 0) { endGame(); return; }
            } else {
                objects.splice(i, 1);
            }
        }
    }

    // Particles.
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt * 1.6;
        if (p.life <= 0) particles.splice(i, 1);
    }

    // Spawn waves on a timer.
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawnWave();
        spawnTimer = SPAWN_INTERVAL;
    }
}

// -------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------
function drawObject(o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);
    if (o.type === 'bomb') {
        ctx.fillStyle = '#1f2937';
        ctx.beginPath();
        ctx.arc(0, 0, o.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#4b5563';
        ctx.lineWidth = 3;
        ctx.stroke();
        // fuse
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, -o.r);
        ctx.lineTo(o.r * 0.4, -o.r * 1.4);
        ctx.stroke();
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(o.r * 0.4, -o.r * 1.4, 4, 0, Math.PI * 2);
        ctx.fill();
    } else {
        const grd = ctx.createRadialGradient(-o.r * 0.3, -o.r * 0.3, o.r * 0.2, 0, 0, o.r);
        grd.addColorStop(0, o.color.hi);
        grd.addColorStop(1, o.color.base);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(0, 0, o.r, 0, Math.PI * 2);
        ctx.fill();
        // leafy stalk
        ctx.fillStyle = '#166534';
        ctx.fillRect(-2, -o.r - 5, 4, 7);
    }
    ctx.restore();
}

function drawTrail() {
    if (trail.length < 2) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(trail[0].x, trail[0].y);
    for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
    ctx.stroke();
}

function draw() {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    }
    ctx.globalAlpha = 1;

    for (const o of objects) drawObject(o);
    drawTrail();
}

// -------------------------------------------------------------------------
// HUD / overlay
// -------------------------------------------------------------------------
function updateHud() {
    scoreEl.textContent = String(Math.floor(score));
    bestEl.textContent = String(Math.floor(best));
    livesEl.textContent = String(Math.max(0, lives));
}

function showOverlay(title, sub, btn, withScore) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    btnStart.textContent = btn;
    overlayScore.textContent = withScore ? `${Math.floor(score)}` : '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// -------------------------------------------------------------------------
// Game flow
// -------------------------------------------------------------------------
function startGame() {
    objects = [];
    particles = [];
    trail = [];
    score = 0;
    lives = START_LIVES;
    spawnTimer = 0.4;
    state = 'running';
    updateHud();
    hideOverlay();
}

function endGame() {
    state = 'over';
    if (Math.floor(score) > Math.floor(best)) {
        best = Math.floor(score);
        localStorage.setItem('fruitslice-best', String(best));
    }
    updateHud();
    showOverlay('Game Over', 'Press Space to play again', 'Play Again', true);
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', 'Press P to resume', 'Resume', false);
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// -------------------------------------------------------------------------
// Input
// -------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        togglePause();
        return;
    }
    if (e.key === ' ' || e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        if (state === 'ready' || state === 'over') startGame();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// Pointer slicing.
let pointerDown = false;
let lastPoint = null;

function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (WIDTH / rect.width),
        y: (e.clientY - rect.top) * (HEIGHT / rect.height),
    };
}

canvas.addEventListener('pointerdown', (e) => {
    pointerDown = true;
    lastPoint = pointerPos(e);
    trail = [lastPoint];
});

canvas.addEventListener('pointermove', (e) => {
    if (!pointerDown) return;
    const p = pointerPos(e);
    if (lastPoint) slice(lastPoint.x, lastPoint.y, p.x, p.y);
    lastPoint = p;
    trail.push(p);
    if (trail.length > 12) trail.shift();
});

window.addEventListener('pointerup', () => {
    pointerDown = false;
    lastPoint = null;
});

// -------------------------------------------------------------------------
// Main loop
// -------------------------------------------------------------------------
function frame(now) {
    if (lastTime === undefined) lastTime = now;
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    step(dt);
    // Fade the blade streak when the pointer is idle.
    if (!pointerDown && trail.length) trail.shift();
    draw();
    requestAnimationFrame(frame);
}

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------
function init() {
    objects = [];
    particles = [];
    trail = [];
    score = 0;
    lives = START_LIVES;
    state = 'ready';
    updateHud();
    showOverlay('Fruit Slice', 'Drag to slice the fruit — avoid the bombs!', 'Start Game', false);
    requestAnimationFrame(frame);
}

init();
