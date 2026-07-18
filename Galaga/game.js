// --- Field & object dimensions ---
const WIDTH = 500;
const HEIGHT = 500;

const PLAYER_W = 36;
const PLAYER_H = 20;
const PLAYER_Y = HEIGHT - 36;
const PLAYER_SPEED = 0.4; // px per ms under keyboard control

const BULLET_W = 4;
const BULLET_H = 12;
const BULLET_SPEED = 0.7;         // fighter shot, travels up
const ENEMY_BULLET_SPEED = 0.3;   // enemy bomb, travels down
const MAX_PLAYER_BULLETS = 2;     // Galaga allows two shots on screen

const ENEMY_ROWS = 4;
const ENEMY_COLS = 8;
const ENEMY_W = 28;
const ENEMY_H = 22;
const ENEMY_GAP_X = 12;
const ENEMY_GAP_Y = 12;
const ENEMY_TOP = 60;

const SWAY_RANGE = 18;    // px the formation drifts either side of centre
const SWAY_SPEED = 0.02;  // px per ms

const DIVE_VY = 0.28;     // downward speed of a diving alien (px/ms)
const DIVE_HVX = 0.14;    // horizontal drift speed while diving (px/ms)
const DIVE_AMP = 70;      // how far a dive wobbles from where it began (px)

const ROW_COLORS = ['#f472b6', '#c084fc', '#60a5fa', '#38bdf8'];
const ENEMY_FIRE_INTERVAL = 850;  // ms between enemy bombs (loop-driven only)
const DIVE_INTERVAL = 1400;       // ms between auto-launched dives (loop-driven)

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
let player, playerBullets, enemyBullets, enemies;
let formationX, swayDir;
let score, best, lives, level, state, lastTime, animId, enemyFireTimer, diveTimer;
const keys = {};

// -----------------------------------------------------------------------
// Setup helpers
// -----------------------------------------------------------------------
function formationWidth() {
    return ENEMY_COLS * ENEMY_W + (ENEMY_COLS - 1) * ENEMY_GAP_X;
}

function buildEnemies() {
    enemies = [];
    formationX = 0;
    swayDir = 1;
    const startX = (WIDTH - formationWidth()) / 2;
    for (let row = 0; row < ENEMY_ROWS; row++) {
        for (let col = 0; col < ENEMY_COLS; col++) {
            const homeX = startX + col * (ENEMY_W + ENEMY_GAP_X);
            const homeY = ENEMY_TOP + row * (ENEMY_H + ENEMY_GAP_Y);
            enemies.push({
                homeX,
                homeY,
                x: homeX,
                y: homeY,
                w: ENEMY_W,
                h: ENEMY_H,
                row,
                col,
                alive: true,
                diving: false,
                dive: null,
                points: (ENEMY_ROWS - row) * 10, // top rows worth more
                color: ROW_COLORS[row % ROW_COLORS.length],
            });
        }
    }
}

function resetPlayer() {
    player = { x: WIDTH / 2 - PLAYER_W / 2, y: PLAYER_Y, w: PLAYER_W, h: PLAYER_H };
}

function movePlayerTo(x) {
    player.x = Math.max(0, Math.min(WIDTH - PLAYER_W, x));
}

function firePlayerBullet() {
    if (state !== 'running') return;
    if (playerBullets.length >= MAX_PLAYER_BULLETS) return;
    playerBullets.push({
        x: player.x + PLAYER_W / 2 - BULLET_W / 2,
        y: player.y - BULLET_H,
        w: BULLET_W,
        h: BULLET_H,
    });
}

function startDive(enemy) {
    if (!enemy || !enemy.alive || enemy.diving) return;
    enemy.diving = true;
    enemy.dive = {
        x0: enemy.x,
        vx: DIVE_HVX * (player.x + PLAYER_W / 2 < enemy.x ? -1 : 1),
        vy: DIVE_VY,
    };
}

function returnToFormation(enemy) {
    enemy.diving = false;
    enemy.dive = null;
    enemy.x = enemy.homeX + formationX;
    enemy.y = enemy.homeY;
}

function fireEnemyBullet() {
    const shooters = enemies.filter(e => e.alive);
    if (shooters.length === 0) return;
    // Prefer a diving alien; otherwise a front-line one.
    const diving = shooters.filter(e => e.diving);
    const pool = diving.length ? diving : shooters;
    const e = pool[Math.floor(Math.random() * pool.length)];
    enemyBullets.push({
        x: e.x + ENEMY_W / 2 - BULLET_W / 2,
        y: e.y + ENEMY_H,
        w: BULLET_W,
        h: BULLET_H,
    });
}

function launchRandomDive() {
    const grounded = enemies.filter(e => e.alive && !e.diving);
    if (grounded.length === 0) return;
    startDive(grounded[Math.floor(Math.random() * grounded.length)]);
}

// -----------------------------------------------------------------------
// Game lifecycle
// -----------------------------------------------------------------------
function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    playerBullets = [];
    enemyBullets = [];
    buildEnemies();
    resetPlayer();
    state = 'running';
    enemyFireTimer = 0;
    diveTimer = 0;

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
    playerBullets = [];
    enemyBullets = [];
    buildEnemies();
    resetPlayer();
    enemyFireTimer = 0;
    diveTimer = 0;
}

function loseLife() {
    lives--;
    livesEl.textContent = Math.max(0, lives);
    enemyBullets = [];
    // send any attackers home so the player isn't hit again instantly
    enemies.forEach(e => { if (e.diving) returnToFormation(e); });
    if (lives <= 0) {
        endGame();
        return;
    }
    resetPlayer();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('galaga-best', best);
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
function rectsOverlap(a, b) {
    return (
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y
    );
}

function step(dt) {
    if (state !== 'running') return;

    // --- Fighter shots travel up ---
    for (const b of playerBullets) b.y -= BULLET_SPEED * dt;

    // Shot / alien collisions (formation or diving)
    for (const b of playerBullets) {
        for (const e of enemies) {
            if (!e.alive) continue;
            if (rectsOverlap(b, e)) {
                e.alive = false;
                b.dead = true;
                score += e.diving ? e.points * 2 : e.points;
                scoreEl.textContent = score;
                break;
            }
        }
    }
    playerBullets = playerBullets.filter(b => !b.dead && b.y + b.h > 0);

    if (enemies.length && enemies.every(e => !e.alive)) {
        nextLevel();
        return;
    }

    // --- Formation sway (never descends) ---
    formationX += swayDir * SWAY_SPEED * dt;
    if (formationX > SWAY_RANGE) {
        formationX = SWAY_RANGE;
        swayDir = -1;
    } else if (formationX < -SWAY_RANGE) {
        formationX = -SWAY_RANGE;
        swayDir = 1;
    }

    // --- Move aliens ---
    for (const e of enemies) {
        if (!e.alive) continue;
        if (e.diving) {
            e.y += e.dive.vy * dt;
            e.x += e.dive.vx * dt;
            // wobble: reverse horizontal drift at the edges of the swoop
            if (e.x > e.dive.x0 + DIVE_AMP) e.dive.vx = -Math.abs(e.dive.vx);
            else if (e.x < e.dive.x0 - DIVE_AMP) e.dive.vx = Math.abs(e.dive.vx);
            // fell past the bottom → loop back into formation
            if (e.y > HEIGHT) {
                returnToFormation(e);
                continue;
            }
            // rammed the fighter → costs a life
            if (rectsOverlap(e, player)) {
                loseLife();
                return;
            }
        } else {
            e.x = e.homeX + formationX;
            e.y = e.homeY;
        }
    }

    // --- Enemy bombs travel down ---
    for (const b of enemyBullets) b.y += ENEMY_BULLET_SPEED * dt;
    enemyBullets = enemyBullets.filter(b => b.y <= HEIGHT);

    for (const b of enemyBullets) {
        if (rectsOverlap(b, player)) {
            loseLife();
            return;
        }
    }
}

// -----------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------
function updatePlayerFromKeys(dt) {
    let dx = 0;
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) dx -= 1;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) dx += 1;
    if (dx !== 0) movePlayerTo(player.x + dx * PLAYER_SPEED * dt);
}

function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = Math.min(50, timestamp - lastTime); // clamp big frame gaps
    lastTime = timestamp;

    if (state === 'running') {
        updatePlayerFromKeys(elapsed);
        step(elapsed);

        // Enemy fire and dive launches are loop-driven (never inside step) so
        // the simulation that tests exercise stays deterministic.
        if (state === 'running') {
            enemyFireTimer += elapsed;
            if (enemyFireTimer >= ENEMY_FIRE_INTERVAL) {
                enemyFireTimer -= ENEMY_FIRE_INTERVAL;
                fireEnemyBullet();
            }
            diveTimer += elapsed;
            const diveGap = Math.max(500, DIVE_INTERVAL - (level - 1) * 150);
            if (diveTimer >= diveGap) {
                diveTimer -= diveGap;
                launchRandomDive();
            }
        }
    }

    draw();

    if (state === 'running') {
        animId = requestAnimationFrame(loop);
    }
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fill();
}

function drawAlien(e) {
    ctx.fillStyle = e.color;
    ctx.shadowColor = e.color + 'aa';
    ctx.shadowBlur = 8;
    // body
    roundRect(ctx, e.x + 4, e.y + 4, e.w - 8, e.h - 8, 4);
    // wings
    ctx.fillRect(e.x, e.y + e.h / 2 - 2, 5, 8);
    ctx.fillRect(e.x + e.w - 5, e.y + e.h / 2 - 2, 5, 8);
    ctx.shadowBlur = 0;
    // eyes
    ctx.fillStyle = '#05060f';
    ctx.fillRect(e.x + e.w / 2 - 6, e.y + 8, 3, 4);
    ctx.fillRect(e.x + e.w / 2 + 3, e.y + 8, 3, 4);
}

function draw() {
    ctx.fillStyle = '#05060f';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // starfield accent
    ctx.fillStyle = '#1b2233';
    for (let i = 0; i < 40; i++) {
        const sx = (i * 97) % WIDTH;
        const sy = (i * 53) % HEIGHT;
        ctx.fillRect(sx, sy, 2, 2);
    }

    for (const e of enemies) {
        if (e.alive) drawAlien(e);
    }

    // Fighter
    ctx.fillStyle = '#e6edf3';
    ctx.shadowColor = '#f472b6aa';
    ctx.shadowBlur = 10;
    roundRect(ctx, player.x, player.y + 4, player.w, player.h - 4, 4);
    // nose
    ctx.fillRect(player.x + player.w / 2 - 3, player.y - 4, 6, 10);
    ctx.shadowBlur = 0;

    // Fighter shots
    ctx.fillStyle = '#fde047';
    for (const b of playerBullets) ctx.fillRect(b.x, b.y, b.w, b.h);

    // Enemy bombs
    ctx.fillStyle = '#f87171';
    for (const b of enemyBullets) ctx.fillRect(b.x, b.y, b.w, b.h);
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

    if (state === 'running') {
        if (k === ' ') {
            firePlayerBullet();
            e.preventDefault();
            return;
        }
        if (MOVE_KEYS.includes(k)) {
            keys[k] = true;
            e.preventDefault();
        }
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
best = parseInt(localStorage.getItem('galaga-best') || '0', 10);
bestEl.textContent = best;
score = 0;
lives = 3;
level = 1;
state = 'idle';
playerBullets = [];
enemyBullets = [];
buildEnemies();
resetPlayer();
draw();
