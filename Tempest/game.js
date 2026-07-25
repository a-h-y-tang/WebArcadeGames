// --- Field & well geometry ---
const WIDTH = 600;
const HEIGHT = 600;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const LANES = 16;               // radial lanes around the closed well
const R_OUT = 250;              // outer rim radius (depth 1, where the Blaster sits)
const R_IN = 45;                // inner ring radius (depth 0, deep in the tube)
const ANGLE_OFFSET = -Math.PI / 2; // lane 0 points straight up

// --- Motion & rules ---
const ENEMY_STEP = 0.05;        // depth gained per enemy tick while climbing
const BULLET_STEP = 0.09;       // depth lost per bullet tick while travelling inward
const BULLET_START_DEPTH = 1;   // bullets are born at the rim
const MAX_BULLETS = 6;          // simultaneous shots in flight
const POINTS_PER_ENEMY = 150;
const LEVEL_BONUS = 1000;
const START_LIVES = 3;
const INVULN_MS = 900;

// --- Colours ---
const COLOR_WELL = '#1d4ed8';
const COLOR_WELL_FAR = '#0b1e46';
const COLOR_RIM = '#22d3ee';
const COLOR_BLASTER = '#facc15';
const COLOR_ENEMY = '#e11d8f';
const COLOR_BULLET = '#7dd3fc';

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
let state;                      // 'idle' | 'running' | 'paused' | 'over'
let player;                    // { lane }
let enemies;                   // [{ lane, depth, atRim }]
let bullets;                   // [{ lane, depth }]
let score, best, lives, level;
let spawnRemaining;            // enemies still to spawn this level
let superReady;                // superzapper charge
let lastTime, animId;
let spawnTimer, enemyTimer, bulletTimer, invulnTimer;

// -----------------------------------------------------------------------
// Seeded RNG (mulberry32) — deterministic spawn lanes.
// -----------------------------------------------------------------------
let rngState = 0x9e3779b9;
function seedRng(s) { rngState = s >>> 0; }
function rand() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// -----------------------------------------------------------------------
// Geometry helpers
// -----------------------------------------------------------------------
function normalizeLane(l) {
    return ((l % LANES) + LANES) % LANES;
}

function laneAngle(lane) {
    return ANGLE_OFFSET + (lane / LANES) * Math.PI * 2;
}

function lanePoint(lane, depth) {
    const a = laneAngle(lane);
    const r = R_IN + (R_OUT - R_IN) * depth;
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}

// Step one lane index from `from` toward `to` by the shortest way around the
// closed ring.
function stepToward(from, to) {
    from = normalizeLane(from);
    to = normalizeLane(to);
    if (from === to) return from;
    const cw = (to - from + LANES) % LANES; // clockwise distance
    return cw <= LANES / 2 ? normalizeLane(from + 1) : normalizeLane(from - 1);
}

// -----------------------------------------------------------------------
// Difficulty curve
// -----------------------------------------------------------------------
function enemiesForLevel(lvl) { return 4 + lvl * 2; }
function spawnInterval() { return Math.max(450, 1500 - level * 110); }
function enemyInterval() { return Math.max(150, 430 - level * 28); }

// -----------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------
function resetLevel() {
    enemies = [];
    bullets = [];
    player = { lane: 0 };
    spawnRemaining = enemiesForLevel(level);
    superReady = true;
    spawnTimer = spawnInterval();
    enemyTimer = enemyInterval();
    bulletTimer = 55;
    invulnTimer = 0;
}

function startGame() {
    seedRng((0x9e3779b9 ^ (performance.now() * 1000)) >>> 0);
    score = 0;
    lives = START_LIVES;
    level = 1;
    resetLevel();
    state = 'running';
    updateHud();
    hideOverlay();
    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function nextLevel() {
    score += LEVEL_BONUS * level;
    level += 1;
    resetLevel();
    updateHud();
}

// Advance to the next level once the spawn quota is spent and the well is clear.
function maybeAdvanceLevel() {
    if (spawnRemaining <= 0 && enemies.length === 0) {
        nextLevel();
        return true;
    }
    return false;
}

function loseLife() {
    lives -= 1;
    enemies = [];
    bullets = [];
    if (lives <= 0) {
        endGame();
    } else {
        player = { lane: player ? player.lane : 0 };
        invulnTimer = INVULN_MS;
    }
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('tempest-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('Game Over', `${score} pts`, 'Press Space to play again', 'Play Again');
}

function pauseGame() {
    if (state !== 'running') return;
    state = 'paused';
    showOverlay('Paused', '', 'Press P to resume', 'Resume');
}

function resumeGame() {
    if (state !== 'paused') return;
    state = 'running';
    hideOverlay();
    lastTime = null;
    animId = requestAnimationFrame(loop);
}

// -----------------------------------------------------------------------
// Blaster & bullets
// -----------------------------------------------------------------------
function movePlayer(dir) {
    if (state !== 'running') return;
    player.lane = normalizeLane(player.lane + Math.sign(dir));
}

function fire() {
    if (state !== 'running') return;
    if (bullets.length >= MAX_BULLETS) return;
    bullets.push({ lane: player.lane, depth: BULLET_START_DEPTH });
}

function moveBullets() {
    for (const b of bullets) b.depth -= BULLET_STEP;
    bullets = bullets.filter(b => b.depth > 0);
    checkBulletHits();
}

// -----------------------------------------------------------------------
// Enemies
// -----------------------------------------------------------------------
function spawnEnemy(lane = 0, depth = 0) {
    enemies.push({ lane: normalizeLane(lane), depth, atRim: false });
}

function moveEnemies() {
    for (const e of enemies) {
        if (e.atRim) {
            e.lane = stepToward(e.lane, player.lane);
        } else {
            e.depth += ENEMY_STEP;
            if (e.depth >= 1) {
                e.depth = 1;
                e.atRim = true;
            }
        }
    }
    checkBulletHits();
    checkPlayerHit();
}

// A bullet destroys the first flipper it has reached on its lane (a bullet
// travels inward from the rim, so it "reaches" a flipper once its depth has
// descended to or below the flipper's depth).
function checkBulletHits() {
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
        const b = bullets[bi];
        for (let ei = enemies.length - 1; ei >= 0; ei--) {
            const e = enemies[ei];
            if (e.lane === b.lane && b.depth <= e.depth) {
                enemies.splice(ei, 1);
                bullets.splice(bi, 1);
                score += POINTS_PER_ENEMY;
                updateHud();
                break;
            }
        }
    }
}

function checkPlayerHit() {
    if (invulnTimer > 0) return false;
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (e.atRim && e.lane === player.lane) {
            enemies.splice(i, 1);
            loseLife();
            return true;
        }
    }
    return false;
}

function superzap() {
    if (state !== 'running' || !superReady) return false;
    superReady = false;
    enemies = [];
    return true;
}

// -----------------------------------------------------------------------
// Real-time loop
// -----------------------------------------------------------------------
function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = Math.min(100, timestamp - lastTime);
    lastTime = timestamp;

    if (state === 'running') {
        if (invulnTimer > 0) invulnTimer = Math.max(0, invulnTimer - dt);

        bulletTimer -= dt;
        if (bulletTimer <= 0) {
            bulletTimer = 55;
            moveBullets();
        }

        enemyTimer -= dt;
        if (enemyTimer <= 0) {
            enemyTimer = enemyInterval();
            moveEnemies();
        }

        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            spawnTimer = spawnInterval();
            if (spawnRemaining > 0) {
                spawnEnemy(Math.floor(rand() * LANES), 0);
                spawnRemaining -= 1;
            }
        }

        maybeAdvanceLevel();
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
    const g = ctx.createRadialGradient(CX, CY, R_IN, CX, CY, R_OUT);
    g.addColorStop(0, '#03040a');
    g.addColorStop(1, '#080b18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    if (!player) return;

    drawWell();
    for (const b of bullets) drawBullet(b);
    for (const e of enemies) drawEnemy(e);
    drawBlaster();
}

function drawWell() {
    // Radial spokes.
    ctx.lineWidth = 2;
    for (let i = 0; i < LANES; i++) {
        const inner = lanePoint(i, 0);
        const outer = lanePoint(i, 1);
        const grad = ctx.createLinearGradient(inner.x, inner.y, outer.x, outer.y);
        grad.addColorStop(0, COLOR_WELL_FAR);
        grad.addColorStop(1, COLOR_WELL);
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(inner.x, inner.y);
        ctx.lineTo(outer.x, outer.y);
        ctx.stroke();
    }

    // Inner ring (far).
    ringPath(0);
    ctx.strokeStyle = COLOR_WELL_FAR;
    ctx.lineWidth = 2;
    ctx.stroke();

    // A couple of depth rings for perspective.
    for (const d of [0.4, 0.7]) {
        ringPath(d);
        ctx.strokeStyle = 'rgba(29,78,216,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Outer rim (near) — bright.
    ringPath(1);
    ctx.strokeStyle = COLOR_RIM;
    ctx.lineWidth = 3;
    ctx.shadowColor = COLOR_RIM;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
}

function ringPath(depth) {
    ctx.beginPath();
    for (let i = 0; i <= LANES; i++) {
        const p = lanePoint(i % LANES, depth);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
}

function drawBlaster() {
    // Flicker while invulnerable.
    if (invulnTimer > 0 && Math.floor(invulnTimer / 120) % 2 === 0) ctx.globalAlpha = 0.4;

    const tip = lanePoint(player.lane, 1);
    const left = lanePoint(normalizeLane(player.lane - 0.5), 0.86);
    const right = lanePoint(normalizeLane(player.lane + 0.5), 0.86);

    ctx.fillStyle = COLOR_BLASTER;
    ctx.strokeStyle = '#fff7cc';
    ctx.lineWidth = 2;
    ctx.shadowColor = COLOR_BLASTER;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Little claw prongs.
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
}

function drawEnemy(e) {
    const p = lanePoint(e.lane, e.depth);
    const size = 5 + e.depth * 12; // grows as it nears the rim (perspective)
    const a = laneAngle(e.lane);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(a + (e.depth * Math.PI * 3)); // spin as it climbs
    ctx.fillStyle = COLOR_ENEMY;
    ctx.shadowColor = COLOR_ENEMY;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    // A four-armed pinwheel (flipper).
    for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2;
        ctx.lineTo(Math.cos(ang) * size, Math.sin(ang) * size);
        ctx.lineTo(Math.cos(ang + 0.5) * size * 0.4, Math.sin(ang + 0.5) * size * 0.4);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;
}

function drawBullet(b) {
    const p = lanePoint(b.lane, b.depth);
    ctx.fillStyle = COLOR_BULLET;
    ctx.shadowColor = COLOR_BULLET;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
}

// -----------------------------------------------------------------------
// HUD / overlay
// -----------------------------------------------------------------------
function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
    livesEl.textContent = lives;
    levelEl.textContent = level;
}

function showOverlay(title, scoreText, sub, btn) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = btn;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
const START_KEYS = [' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

document.addEventListener('keydown', e => {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        e.preventDefault();
        return;
    }

    if ((state === 'idle' || state === 'over') && START_KEYS.includes(k)) {
        startGame();
        e.preventDefault();
        return;
    }

    if (state === 'running') {
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') { movePlayer(-1); e.preventDefault(); }
        else if (k === 'ArrowRight' || k === 'd' || k === 'D') { movePlayer(1); e.preventDefault(); }
        else if (k === ' ') { fire(); e.preventDefault(); }
        else if (k === 'z' || k === 'Z' || k === 'Shift') { superzap(); e.preventDefault(); }
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
best = parseInt(localStorage.getItem('tempest-best') || '0', 10);
score = 0;
lives = START_LIVES;
level = 1;
resetLevel();
state = 'idle';
updateHud();
draw();
