// ===========================================================================
// Asteroids — a wrap-around vector shooter.
//
// All mutable game state and the physics entry point `step(dtMs)` are declared
// at top level so they are reachable from Playwright's page.evaluate(), exactly
// as the Snake and Breakout games do. `step(dtMs)` advances every bit of
// physics by an explicit number of milliseconds, so behaviour is deterministic
// and does not depend on requestAnimationFrame timing.
// ===========================================================================

// --- Field / entity constants ---------------------------------------------
const WIDTH = 500;
const HEIGHT = 500;

const SHIP_R = 12;            // ship collision radius (px)
const SHIP_THRUST = 0.0005;   // acceleration while thrusting (px / ms^2)
const SHIP_ROT = 0.005;       // rotation speed (radians / ms)
const DRAG = 0.0006;          // velocity damping per ms
const MAX_SPEED = 0.35;       // ship speed cap (px / ms)

const BULLET_SPEED = 0.45;    // px / ms
const BULLET_LIFE = 900;      // ms before a bullet expires
const BULLET_R = 2.5;
const MAX_BULLETS = 5;        // max bullets alive at once
const FIRE_COOLDOWN = 180;    // ms between shots

// Asteroid radius and score by size (3 = large, 2 = medium, 1 = small).
const ASTEROID_R = { 1: 14, 2: 26, 3: 46 };
const ASTEROID_SCORE = { 1: 100, 2: 50, 3: 20 };
const ASTEROID_SPEED = 0.045; // base drift speed (px / ms)
const START_ASTEROIDS = 4;    // large asteroids in wave 1
const MIN_SPAWN_DIST = 120;   // keep fresh rocks clear of the ship

const LIVES_START = 3;
const RESPAWN_INVULN = 2000;  // ms of invulnerability after (re)spawning

// --- Mutable state ----------------------------------------------------------
let state = 'idle';           // 'idle' | 'running' | 'paused' | 'over'
let score = 0;
let best = parseInt(localStorage.getItem('asteroids-best')) || 0;
let lives = LIVES_START;
let level = 1;
let fireCooldown = 0;

const ship = { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0, angle: 0, invuln: 0 };
const bullets = [];
const asteroids = [];
const keys = { left: false, right: false, thrust: false };

// --- DOM handles ------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');

// ===========================================================================
// Helpers
// ===========================================================================
function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
    livesEl.textContent = Math.max(0, lives);
    levelEl.textContent = level;
}

function showOverlay(title, scoreText, subText, btnText) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText || '';
    overlaySub.textContent = subText;
    btnStart.textContent = btnText;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// Wrap any entity with {x, y} around the four edges of the field.
function wrap(e) {
    if (e.x < 0) e.x += WIDTH;
    else if (e.x >= WIDTH) e.x -= WIDTH;
    if (e.y < 0) e.y += HEIGHT;
    else if (e.y >= HEIGHT) e.y -= HEIGHT;
}

// ===========================================================================
// Spawning
// ===========================================================================
function spawnAsteroid(x, y, size, vx, vy) {
    const a = {
        x, y, size, vx, vy,
        r: ASTEROID_R[size],
        spin: 0,
        // A fixed jaggedness offset per vertex so each rock looks like a rock.
        shape: Array.from({ length: 10 }, () => 0.75 + Math.random() * 0.5),
    };
    asteroids.push(a);
    return a;
}

function spawnAsteroidAwayFromCenter(size) {
    let x, y;
    do {
        x = Math.random() * WIDTH;
        y = Math.random() * HEIGHT;
    } while (Math.hypot(x - WIDTH / 2, y - HEIGHT / 2) < MIN_SPAWN_DIST);
    const ang = Math.random() * Math.PI * 2;
    const speed = ASTEROID_SPEED * (1 + 0.12 * (level - 1));
    return spawnAsteroid(x, y, size, Math.cos(ang) * speed, Math.sin(ang) * speed);
}

// A hit rock breaks into two smaller ones flying apart.
function splitAsteroid(a) {
    const base = Math.random() * Math.PI * 2;
    const speed = ASTEROID_SPEED * (1 + 0.12 * (level - 1)) * 1.4;
    for (const off of [-0.6, 0.6]) {
        const ang = base + off;
        spawnAsteroid(a.x, a.y, a.size - 1, Math.cos(ang) * speed, Math.sin(ang) * speed);
    }
}

function spawnWave() {
    asteroids.length = 0;
    const count = START_ASTEROIDS + (level - 1);
    for (let i = 0; i < count; i++) spawnAsteroidAwayFromCenter(3);
}

function nextWave() {
    level++;
    spawnWave();
    updateHud();
}

// ===========================================================================
// Ship actions
// ===========================================================================
function fireBullet() {
    if (bullets.length >= MAX_BULLETS || fireCooldown > 0) return;
    const dx = Math.sin(ship.angle);
    const dy = -Math.cos(ship.angle);
    bullets.push({
        x: ship.x + dx * SHIP_R,
        y: ship.y + dy * SHIP_R,
        vx: dx * BULLET_SPEED + ship.vx,
        vy: dy * BULLET_SPEED + ship.vy,
        life: BULLET_LIFE,
    });
    fireCooldown = FIRE_COOLDOWN;
}

function respawnShip() {
    ship.x = WIDTH / 2;
    ship.y = HEIGHT / 2;
    ship.vx = 0;
    ship.vy = 0;
    ship.angle = 0;
    ship.invuln = RESPAWN_INVULN;
}

function loseLife() {
    lives--;
    updateHud();
    if (lives <= 0) {
        endGame();
        return;
    }
    respawnShip();
}

// ===========================================================================
// Physics — advance everything by dt milliseconds.
// ===========================================================================
function step(dt) {
    if (state !== 'running') return;

    fireCooldown = Math.max(0, fireCooldown - dt);

    // Rotation from held keys.
    if (keys.left) ship.angle -= SHIP_ROT * dt;
    if (keys.right) ship.angle += SHIP_ROT * dt;

    // Thrust along the heading (angle 0 points up = -y).
    if (keys.thrust) {
        ship.vx += SHIP_THRUST * Math.sin(ship.angle) * dt;
        ship.vy += SHIP_THRUST * -Math.cos(ship.angle) * dt;
    }

    // Drag, then clamp to the speed cap.
    const damp = Math.max(0, 1 - DRAG * dt);
    ship.vx *= damp;
    ship.vy *= damp;
    const sp = Math.hypot(ship.vx, ship.vy);
    if (sp > MAX_SPEED) {
        ship.vx = (ship.vx / sp) * MAX_SPEED;
        ship.vy = (ship.vy / sp) * MAX_SPEED;
    }

    // Move the ship and count down its invulnerability.
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    wrap(ship);
    if (ship.invuln > 0) ship.invuln = Math.max(0, ship.invuln - dt);

    // Move bullets, ageing them out.
    for (const b of bullets) {
        b.life -= dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        wrap(b);
    }

    // Move asteroids.
    for (const a of asteroids) {
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        a.spin += 0.001 * dt;
        wrap(a);
    }

    // Bullet vs asteroid.
    handleBulletHits();

    // Remove expired bullets.
    for (let i = bullets.length - 1; i >= 0; i--) {
        if (bullets[i].life <= 0) bullets.splice(i, 1);
    }

    // Ship vs asteroid (unless invulnerable).
    if (ship.invuln <= 0) {
        for (const a of asteroids) {
            if (Math.hypot(ship.x - a.x, ship.y - a.y) < SHIP_R + a.r) {
                loseLife();
                break;
            }
        }
    }

    // Wave cleared? Bring in the next (harder) wave.
    if (state === 'running' && asteroids.length === 0) nextWave();
}

function handleBulletHits() {
    for (let i = asteroids.length - 1; i >= 0; i--) {
        const a = asteroids[i];
        for (let j = bullets.length - 1; j >= 0; j--) {
            const b = bullets[j];
            if (Math.hypot(a.x - b.x, a.y - b.y) < a.r) {
                bullets.splice(j, 1);
                asteroids.splice(i, 1);
                score += ASTEROID_SCORE[a.size];
                if (a.size > 1) splitAsteroid(a);
                updateHud();
                break; // this asteroid is gone; move to the next one
            }
        }
    }
}

// ===========================================================================
// Game flow
// ===========================================================================
function startGame() {
    state = 'running';
    score = 0;
    lives = LIVES_START;
    level = 1;
    fireCooldown = 0;
    bullets.length = 0;
    keys.left = keys.right = keys.thrust = false;
    respawnShip();
    spawnWave();
    hideOverlay();
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        localStorage.setItem('asteroids-best', String(best));
    }
    updateHud();
    showOverlay('Game Over', `${score} pts`, 'Press Space to play again', 'Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ===========================================================================
// Rendering
// ===========================================================================
function drawShip() {
    if (ship.invuln > 0 && Math.floor(ship.invuln / 120) % 2 === 0) return; // blink
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -SHIP_R);          // nose
    ctx.lineTo(SHIP_R * 0.7, SHIP_R); // right tail
    ctx.lineTo(0, SHIP_R * 0.5);      // notch
    ctx.lineTo(-SHIP_R * 0.7, SHIP_R); // left tail
    ctx.closePath();
    ctx.stroke();
    // Thrust flame.
    if (keys.thrust) {
        ctx.strokeStyle = '#fb923c';
        ctx.beginPath();
        ctx.moveTo(SHIP_R * 0.35, SHIP_R * 0.7);
        ctx.lineTo(0, SHIP_R * 1.6);
        ctx.lineTo(-SHIP_R * 0.35, SHIP_R * 0.7);
        ctx.stroke();
    }
    ctx.restore();
}

function drawAsteroid(a) {
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.spin);
    ctx.strokeStyle = '#c9d1d9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const n = a.shape.length;
    for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const rr = a.r * a.shape[i];
        const px = Math.cos(ang) * rr;
        const py = Math.sin(ang) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
}

function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#fde68a';
    for (const b of bullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2);
        ctx.fill();
    }
    for (const a of asteroids) drawAsteroid(a);
    if (state === 'running' || state === 'paused') drawShip();
}

// ===========================================================================
// Input
// ===========================================================================
const START_KEYS = new Set([
    ' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'w', 'a', 's', 'd', 'W', 'A', 'S', 'D',
]);

function isThrustKey(k) { return k === 'ArrowUp' || k === 'w' || k === 'W'; }
function isLeftKey(k) { return k === 'ArrowLeft' || k === 'a' || k === 'A'; }
function isRightKey(k) { return k === 'ArrowRight' || k === 'd' || k === 'D'; }

window.addEventListener('keydown', (e) => {
    const k = e.key;

    // Movement flags are tracked whatever the state, so a key that also starts
    // the game primes the ship immediately.
    if (isLeftKey(k)) keys.left = true;
    if (isRightKey(k)) keys.right = true;
    if (isThrustKey(k)) keys.thrust = true;

    if (state === 'idle' || state === 'over') {
        if (START_KEYS.has(k)) {
            e.preventDefault();
            startGame();
        }
        return;
    }

    if (k === 'p' || k === 'P') {
        e.preventDefault();
        togglePause();
        return;
    }

    if (state === 'running' && k === ' ') {
        e.preventDefault();
        fireBullet();
    }

    if (k === ' ' || k.startsWith('Arrow')) e.preventDefault();
});

window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (isLeftKey(k)) keys.left = false;
    if (isRightKey(k)) keys.right = false;
    if (isThrustKey(k)) keys.thrust = false;
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// Cosmetic drift for the title screen: nudge the rocks so the idle wave behind
// the overlay is alive, without running ship physics, firing or collisions.
function driftAsteroids(dt) {
    for (const a of asteroids) {
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        a.spin += 0.001 * dt;
        wrap(a);
    }
}

// ===========================================================================
// Main loop
// ===========================================================================
let lastTime = null;
function loop(now) {
    if (lastTime === null) lastTime = now;
    let dt = now - lastTime;
    lastTime = now;
    if (dt > 50) dt = 50; // clamp big gaps (e.g. tab switch) for stability
    if (state === 'running') step(dt);
    else if (state === 'idle' || state === 'over') driftAsteroids(dt);
    render();
    requestAnimationFrame(loop);
}

// ===========================================================================
// Boot — show a drifting wave behind the title screen.
// ===========================================================================
updateHud();
spawnWave();
render();
requestAnimationFrame(loop);
