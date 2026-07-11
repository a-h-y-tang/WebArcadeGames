// --- Field dimensions ---
const WIDTH = 500;
const HEIGHT = 500;

// --- Formation ---
const INVADER_ROWS = 5;
const INVADER_COLS = 11;
const INVADER_W = 26;
const INVADER_H = 18;
const INVADER_TOTAL = INVADER_ROWS * INVADER_COLS;
// Points by row, top row first — higher rows are worth more (classic weighting).
const ROW_SCORES = [30, 20, 20, 10, 10];
const INVADER_SPEED = 0.03;  // base px per ms for a full formation
const INVADER_DROP = 16;     // px dropped when the swarm reverses

// --- Cannon ---
const PLAYER_W = 40;
const PLAYER_H = 16;
const PLAYER_SPEED = 0.35;   // px per ms

// --- Projectiles ---
const PLAYER_BULLET_SPEED = 0.7; // px per ms (travels up)
const BULLET_W = 3;
const BULLET_H = 12;
const MAX_PLAYER_BULLETS = 3;
const BOMB_SPEED = 0.2;      // px per ms (falls down)
const BOMB_W = 3;
const BOMB_H = 10;
const BOMB_COOLDOWN = 800;   // ms between alien bombs

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
let player, invaders, playerBullets, bombs, score, best, lives, level, state;
let invaderDir, bombTimer, bombColIndex, lastTime, animId;

// -----------------------------------------------------------------------
// Setup helpers
// -----------------------------------------------------------------------
function buildInvaders() {
    invaders = [];
    const marginTop = 60;
    const marginLeft = 45;
    const cellW = 34;
    const cellH = 30;
    for (let row = 0; row < INVADER_ROWS; row++) {
        for (let col = 0; col < INVADER_COLS; col++) {
            invaders.push({
                row,
                col,
                x: marginLeft + col * cellW,
                y: marginTop + row * cellH,
                w: INVADER_W,
                h: INVADER_H,
                alive: true,
            });
        }
    }
}

function resetPlayer() {
    player = {
        x: WIDTH / 2 - PLAYER_W / 2,
        y: HEIGHT - 40,
        w: PLAYER_W,
        h: PLAYER_H,
        dir: 0,
    };
}

function aliveInvaders() {
    return invaders.filter(i => i.alive);
}

function movePlayerTo(x) {
    player.x = Math.max(0, Math.min(WIDTH - player.w, x));
}

function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function currentInvaderSpeed() {
    const alive = aliveInvaders().length;
    const thinned = 1 + ((INVADER_TOTAL - alive) / INVADER_TOTAL) * 1.5;
    const harder = 1 + (level - 1) * 0.25;
    return INVADER_SPEED * thinned * harder;
}

// -----------------------------------------------------------------------
// Projectiles
// -----------------------------------------------------------------------
function firePlayerBullet() {
    if (state !== 'running') return;
    if (playerBullets.length >= MAX_PLAYER_BULLETS) return;
    playerBullets.push({
        x: player.x + player.w / 2 - BULLET_W / 2,
        y: player.y - BULLET_H,
        w: BULLET_W,
        h: BULLET_H,
        vy: -PLAYER_BULLET_SPEED,
    });
}

function dropBomb() {
    const alive = aliveInvaders();
    if (alive.length === 0) return;
    // Choose a firing column deterministically by rotating through the columns
    // that still have a living invader — no Math.random, so tests are stable.
    const cols = [...new Set(alive.map(i => i.col))].sort((a, b) => a - b);
    const col = cols[bombColIndex % cols.length];
    bombColIndex++;
    const inCol = alive.filter(i => i.col === col);
    let shooter = inCol[0];
    for (const i of inCol) if (i.y > shooter.y) shooter = i;
    bombs.push({
        x: shooter.x + shooter.w / 2 - BOMB_W / 2,
        y: shooter.y + shooter.h,
        w: BOMB_W,
        h: BOMB_H,
        vy: BOMB_SPEED,
    });
}

// -----------------------------------------------------------------------
// Game lifecycle
// -----------------------------------------------------------------------
function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    buildInvaders();
    invaderDir = 1;
    resetPlayer();
    playerBullets = [];
    bombs = [];
    bombTimer = BOMB_COOLDOWN;
    bombColIndex = 0;
    state = 'running';

    scoreEl.textContent = score;
    livesEl.textContent = lives;
    levelEl.textContent = level;
    overlay.classList.remove('visible');

    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function nextWave() {
    level++;
    levelEl.textContent = level;
    buildInvaders();
    invaderDir = 1;
    playerBullets = [];
    bombs = [];
    bombTimer = BOMB_COOLDOWN;
}

function loseLife() {
    lives--;
    livesEl.textContent = Math.max(0, lives);
    if (lives <= 0) {
        endGame();
        return;
    }
    bombs = []; // clear the volley so the player gets a breather
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('space-invaders-best', best);
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
function marchInvaders(dt) {
    const alive = aliveInvaders();
    if (alive.length === 0) return;

    const move = invaderDir * currentInvaderSpeed() * dt;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const i of alive) {
        if (i.x < minX) minX = i.x;
        if (i.x + i.w > maxX) maxX = i.x + i.w;
    }

    if (maxX + move > WIDTH || minX + move < 0) {
        invaderDir *= -1;
        for (const i of alive) i.y += INVADER_DROP;
    } else {
        for (const i of alive) i.x += move;
    }
}

function step(dt) {
    if (state !== 'running') return;

    // Cannon.
    movePlayerTo(player.x + player.dir * PLAYER_SPEED * dt);

    // Player bullets travel up; drop those that leave the top.
    for (const b of playerBullets) b.y += b.vy * dt;
    playerBullets = playerBullets.filter(b => b.y + b.h > 0);

    // Bombs fall; drop those that leave the bottom.
    for (const b of bombs) b.y += b.vy * dt;
    bombs = bombs.filter(b => b.y < HEIGHT);

    // The swarm.
    marchInvaders(dt);

    // Alien fire on a fixed cooldown.
    bombTimer -= dt;
    if (bombTimer <= 0) {
        if (aliveInvaders().length > 0) dropBomb();
        bombTimer = BOMB_COOLDOWN;
    }

    // Player bullet ⇄ invader collisions.
    for (let bi = playerBullets.length - 1; bi >= 0; bi--) {
        const b = playerBullets[bi];
        for (const inv of invaders) {
            if (inv.alive && overlap(b, inv)) {
                inv.alive = false;
                score += ROW_SCORES[inv.row];
                scoreEl.textContent = score;
                playerBullets.splice(bi, 1);
                break;
            }
        }
    }

    // Bomb ⇄ cannon collisions.
    for (let bi = bombs.length - 1; bi >= 0; bi--) {
        if (overlap(bombs[bi], player)) {
            bombs.splice(bi, 1);
            loseLife();
            break;
        }
    }
    if (state !== 'running') return;

    // Swarm has landed → immediate loss.
    for (const inv of invaders) {
        if (inv.alive && inv.y + inv.h >= player.y) {
            endGame();
            return;
        }
    }

    // Formation cleared → next wave.
    if (aliveInvaders().length === 0) nextWave();
}

// -----------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------
function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = Math.min(50, timestamp - lastTime); // clamp big frame gaps
    lastTime = timestamp;

    if (state === 'running') step(elapsed);
    draw();

    if (state === 'running') {
        animId = requestAnimationFrame(loop);
    }
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function draw() {
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Invaders — simple blocky aliens, brighter higher up.
    for (const inv of invaders) {
        if (!inv.alive) continue;
        ctx.fillStyle = inv.row === 0 ? '#4ade80' : inv.row < 3 ? '#38bdf8' : '#a78bfa';
        drawInvader(inv);
    }

    // Player bullets.
    ctx.fillStyle = '#e6edf3';
    for (const b of playerBullets) ctx.fillRect(b.x, b.y, b.w, b.h);

    // Bombs.
    ctx.fillStyle = '#f97316';
    for (const b of bombs) ctx.fillRect(b.x, b.y, b.w, b.h);

    // Cannon.
    if (player) {
        ctx.fillStyle = '#4ade80';
        ctx.shadowColor = '#4ade8088';
        ctx.shadowBlur = 8;
        const { x, y, w, h } = player;
        ctx.fillRect(x, y + h * 0.4, w, h * 0.6);          // base
        ctx.fillRect(x + w / 2 - 3, y, 6, h * 0.5);        // barrel
        ctx.shadowBlur = 0;
    }
}

function drawInvader(inv) {
    const { x, y, w, h } = inv;
    ctx.fillRect(x + w * 0.15, y, w * 0.7, h * 0.55);      // body
    ctx.fillRect(x, y + h * 0.35, w, h * 0.3);             // arms
    ctx.fillRect(x + w * 0.1, y + h * 0.7, w * 0.2, h * 0.3);  // left leg
    ctx.fillRect(x + w * 0.7, y + h * 0.7, w * 0.2, h * 0.3);  // right leg
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
const START_KEYS = [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'w', 'W', 'a', 'A', 's', 'S', 'd', 'D'];

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

    if (state !== 'running') return;

    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
        player.dir = -1;
        e.preventDefault();
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
        player.dir = 1;
        e.preventDefault();
    } else if (k === ' ') {
        firePlayerBullet();
        e.preventDefault();
    }
});

document.addEventListener('keyup', e => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
        if (player.dir < 0) player.dir = 0;
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
        if (player.dir > 0) player.dir = 0;
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
best = parseInt(localStorage.getItem('space-invaders-best') || '0', 10);
bestEl.textContent = best;
score = 0;
lives = 3;
level = 1;
state = 'idle';
invaderDir = 1;
bombTimer = BOMB_COOLDOWN;
bombColIndex = 0;
buildInvaders();
resetPlayer();
playerBullets = [];
bombs = [];
draw();
