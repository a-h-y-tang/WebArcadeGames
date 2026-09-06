// ---------------------------------------------------------------------------
// Defender — a side-scrolling rescue shooter on an HTML5 canvas.
//
// You patrol a wrap-around planet while alien landers abduct the humanoids on
// the surface. Shoot the landers, catch the humanoids they drop and fly them
// back to the ground. A lander that carries a humanoid to the top of the sky
// mutates; lose every humanoid and the planet itself dies.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom!,
// Snake and Tetris in this repo. All motion is expressed per second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const WORLD_W = 3200;          // the planet wraps around at this width
const VIEW_W = 800;            // main view (the part of the world you can see)
const VIEW_H = 400;
const SCANNER_H = 60;          // squashed map of the whole world, drawn on top
const GROUND_Y = 360;          // surface line, in view coordinates
const SKY_Y = 20;              // the ship cannot climb past this
const MUTATE_Y = 12;           // a lander lifting a humanoid past this mutates

// --- Player ---
const ACCEL = 700;             // px/s^2 of horizontal thrust
const MAX_SPEED = 420;         // px/s horizontal cap
const DRAG = 1.6;              // per-second exponential decay when coasting
const VERT_SPEED = 260;        // px/s of climb / dive
const FIRE_COOLDOWN = 0.14;    // seconds between shots
const RESPAWN_INVULN = 2;      // seconds of invulnerability after a hit
const PLAYER_R = 12;
const CAMERA_LEAD = 160;       // how far the camera looks ahead of the ship
const CAMERA_LERP = 3;

// --- Bullets ---
const PLAYER_BULLET_SPEED = 900;
const PLAYER_BULLET_LIFE = 0.65;
const ENEMY_BULLET_SPEED = 260;
const ENEMY_BULLET_LIFE = 2.5;

// --- Enemies ---
const LANDER_R = 14;
const LANDER_SPEED = 60;       // horizontal homing speed
const LANDER_DESCENT = 70;     // px/s while diving for a humanoid
const LANDER_LIFT = 60;        // px/s while carrying one skywards
const LANDER_GRAB_DY = 26;     // vertical offset at which a lander can grab
const LANDER_GRAB_DX = 16;
const MUTANT_ACCEL = 340;
const MUTANT_MAX = 230;
const ENEMY_SCORE = 150;

// --- Humanoids ---
const HUMANOID_COUNT = 10;
const HUMANOID_WALK = 12;      // px/s of aimless wandering
const FALL_SPEED = 120;
const SAFE_FALL = 120;         // a longer drop than this is fatal
const CATCH_R = 22;
const RESCUE_SCORE = 500;

// --- Game rules ---
const START_LIVES = 3;
const START_SMART_BOMBS = 3;
const MAX_SMART_BOMBS = 6;
const WAVE_DELAY = 2;          // pause between clearing a wave and the next
const WAVE_BONUS = 100;        // × wave × surviving humanoids

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const waveEl = document.getElementById('wave');
const livesEl = document.getElementById('lives');
const bombsEl = document.getElementById('bombs');
const humansEl = document.getElementById('humans');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, wave, lives, smartBombs, planetDead, waveClearTimer;
const player = {
    x: WORLD_W / 2, y: 180, vx: 0, vy: 0,
    dir: 1, thrust: 0, vdir: 0, cooldown: 0, invuln: 0,
};
const camera = { x: 0 };
const enemies = [];
const humanoids = [];
const bullets = [];
const particles = [];

// ---------------------------------------------------------------------------
// Wrap-around world helpers
// ---------------------------------------------------------------------------

function wrapX(x) {
    const m = x % WORLD_W;
    return m < 0 ? m + WORLD_W : m;
}

// Shortest signed distance from `a` to `b` across the seam.
function worldDx(a, b) {
    let d = wrapX(b) - wrapX(a);
    if (d > WORLD_W / 2) d -= WORLD_W;
    if (d < -WORLD_W / 2) d += WORLD_W;
    return d;
}

function isOnScreen(x) {
    const dx = worldDx(camera.x, x);
    return dx >= -40 && dx <= VIEW_W + 40;
}

function cameraCenter() {
    return wrapX(camera.x + VIEW_W / 2);
}

// World coordinate → x position inside the scanner strip.
function scannerX(x) {
    return VIEW_W / 2 + worldDx(cameraCenter(), x) * (VIEW_W / WORLD_W);
}

function scannerY(y) {
    return 6 + (Math.max(0, Math.min(VIEW_H, y)) / VIEW_H) * (SCANNER_H - 12);
}

function rand(min, max) { return min + Math.random() * (max - min); }

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

function landersForWave(w) {
    return Math.min(5 + 2 * (w - 1), 15);
}

function landerFireDelay() { return rand(1.8, 3.6); }
function mutantFireDelay() { return rand(1.1, 2.2); }

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

function spawnHumanoid(opts) {
    opts = opts || {};
    const h = {
        x: wrapX(opts.x != null ? opts.x : rand(0, WORLD_W)),
        y: opts.y != null ? opts.y : GROUND_Y,
        vx: Math.random() < 0.5 ? -HUMANOID_WALK : HUMANOID_WALK,
        state: opts.state || 'ground',
        fallFrom: GROUND_Y,
        turnTimer: rand(1, 4),
    };
    humanoids.push(h);
    return h;
}

function spawnLander(opts) {
    opts = opts || {};
    const e = {
        type: 'lander',
        x: wrapX(opts.x != null ? opts.x : rand(0, WORLD_W)),
        y: opts.y != null ? opts.y : rand(30, 140),
        vx: 0,
        vy: 0,
        carrying: opts.carrying || null,
        fireTimer: landerFireDelay(),
        wobble: rand(0, Math.PI * 2),
    };
    if (e.carrying) e.carrying.state = 'carried';
    enemies.push(e);
    return e;
}

function spawnMutant(opts) {
    opts = opts || {};
    const e = {
        type: 'mutant',
        x: wrapX(opts.x != null ? opts.x : rand(0, WORLD_W)),
        y: opts.y != null ? opts.y : rand(40, 200),
        vx: 0,
        vy: 0,
        carrying: null,
        fireTimer: mutantFireDelay(),
        wobble: rand(0, Math.PI * 2),
    };
    enemies.push(e);
    return e;
}

function spawnBullet(opts) {
    const b = {
        x: wrapX(opts.x),
        y: opts.y,
        vx: opts.vx,
        vy: opts.vy || 0,
        from: opts.from || 'player',
        life: opts.life != null
            ? opts.life
            : (opts.from === 'enemy' ? ENEMY_BULLET_LIFE : PLAYER_BULLET_LIFE),
    };
    bullets.push(b);
    return b;
}

function spawnParticles(x, y, colour, count) {
    for (let i = 0; i < count; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(40, 260);
        particles.push({
            x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            life: rand(0.25, 0.7), colour,
        });
    }
}

function resetHumanoids() {
    humanoids.length = 0;
    const gap = WORLD_W / HUMANOID_COUNT;
    for (let i = 0; i < HUMANOID_COUNT; i++) {
        spawnHumanoid({ x: i * gap + rand(20, gap - 20) });
    }
}

function spawnWave() {
    const count = landersForWave(wave);
    for (let i = 0; i < count; i++) {
        // Keep new landers away from the ship so a wave never opens with an
        // unavoidable collision.
        let x = rand(0, WORLD_W);
        if (Math.abs(worldDx(player.x, x)) < 240) x = wrapX(x + WORLD_W / 2);
        spawnLander({ x, y: rand(30, 140) });
    }
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function setThrust(dir) {
    player.thrust = dir;
    if (dir !== 0) player.dir = dir < 0 ? -1 : 1;
}

function setVertical(dir) {
    player.vdir = dir;
}

function fire() {
    if (state !== 'running' || player.cooldown > 0) return null;
    player.cooldown = FIRE_COOLDOWN;
    return spawnBullet({
        x: player.x + player.dir * 18,
        y: player.y,
        vx: player.dir * PLAYER_BULLET_SPEED,
        vy: 0,
        from: 'player',
    });
}

function smartBomb() {
    if (state !== 'running' || smartBombs <= 0) return 0;
    smartBombs -= 1;
    let hit = 0;
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (!isOnScreen(e.x)) continue;
        destroyEnemy(i, false);
        hit += 1;
    }
    updateHud();
    return hit;
}

function killPlayer() {
    if (state !== 'running') return;
    spawnParticles(player.x, player.y, '#67e8f9', 26);
    lives -= 1;
    bullets.length = 0;
    player.vx = 0;
    player.vy = 0;
    player.thrust = 0;
    player.vdir = 0;
    player.y = VIEW_H / 2;
    player.invuln = RESPAWN_INVULN;
    // Anything the ship was carrying tumbles free.
    humanoids.forEach((h) => {
        if (h.state === 'held') { h.state = 'falling'; h.fallFrom = h.y; }
    });
    if (lives <= 0) {
        lives = 0;
        endGame();
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Humanoids
// ---------------------------------------------------------------------------

function humanoidsAlive() {
    return humanoids.filter((h) => h.state !== 'dead').length;
}

function killHumanoid(h) {
    if (h.state === 'dead') return;
    h.state = 'dead';
    spawnParticles(h.x, h.y, '#f472b6', 12);
    if (!planetDead && humanoidsAlive() === 0) planetDeath();
}

// Every humanoid gone: the surface is razed and every lander mutates at once.
function planetDeath() {
    planetDead = true;
    for (const e of enemies) {
        if (e.type === 'lander') mutate(e);
    }
}

function mutate(e) {
    e.type = 'mutant';
    e.fireTimer = mutantFireDelay();
    if (e.carrying) {
        const h = e.carrying;
        e.carrying = null;
        killHumanoid(h);
    }
}

function nearestGroundHumanoid(x) {
    let best = null;
    let bestD = Infinity;
    for (const h of humanoids) {
        if (h.state !== 'ground') continue;
        const d = Math.abs(worldDx(x, h.x));
        if (d < bestD) { bestD = d; best = h; }
    }
    return best;
}

function updateHumanoids(dt) {
    for (const h of humanoids) {
        if (h.state === 'ground') {
            h.turnTimer -= dt;
            if (h.turnTimer <= 0) { h.vx = -h.vx; h.turnTimer = rand(1.5, 5); }
            h.x = wrapX(h.x + h.vx * dt);
            h.y = GROUND_Y;
        } else if (h.state === 'falling') {
            h.y += FALL_SPEED * dt;
            if (Math.abs(worldDx(player.x, h.x)) < CATCH_R
                && Math.abs(player.y - h.y) < CATCH_R) {
                h.state = 'held';
            } else if (h.y >= GROUND_Y) {
                if (GROUND_Y - h.fallFrom > SAFE_FALL) {
                    killHumanoid(h);
                } else {
                    h.state = 'ground';
                    h.y = GROUND_Y;
                }
            }
        } else if (h.state === 'held') {
            h.x = player.x;
            h.y = player.y + 14;
            if (player.y >= GROUND_Y - 6) {
                h.state = 'ground';
                h.y = GROUND_Y;
                score += RESCUE_SCORE;
                spawnParticles(h.x, GROUND_Y - 10, '#facc15', 14);
            }
        }
        // 'carried' humanoids are moved by their lander; 'dead' ones do nothing.
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function destroyEnemy(index, dropHumanoid) {
    const e = enemies[index];
    if (!e) return;
    enemies.splice(index, 1);
    score += ENEMY_SCORE;
    spawnParticles(e.x, e.y, e.type === 'mutant' ? '#f87171' : '#a78bfa', 18);
    if (e.carrying) {
        const h = e.carrying;
        e.carrying = null;
        if (dropHumanoid === false) {
            // Smart-bombed: the humanoid is vaporised along with its captor.
            killHumanoid(h);
        } else {
            h.state = 'falling';
            h.fallFrom = h.y;
        }
    }
}

function enemyFire(e) {
    const dx = worldDx(e.x, player.x);
    const dy = player.y - e.y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = e.type === 'mutant' ? ENEMY_BULLET_SPEED * 1.2 : ENEMY_BULLET_SPEED;
    spawnBullet({
        x: e.x,
        y: e.y,
        vx: (dx / len) * speed,
        vy: (dy / len) * speed,
        from: 'enemy',
    });
}

function stepLander(e, dt) {
    if (e.carrying) {
        e.y -= LANDER_LIFT * dt;
        e.carrying.x = e.x;
        e.carrying.y = e.y + 16;
        if (e.y <= MUTATE_Y) {
            e.y = MUTATE_Y;
            mutate(e);
        }
        return;
    }
    const target = nearestGroundHumanoid(e.x);
    if (!target) {
        // Nothing left to abduct: patrol and hunt the ship instead.
        e.wobble += dt;
        e.x = wrapX(e.x + Math.cos(e.wobble) * LANDER_SPEED * dt);
        const drift = Math.sign(140 - e.y);
        e.y += drift * LANDER_DESCENT * 0.4 * dt;
        return;
    }
    const dx = worldDx(e.x, target.x);
    e.x = wrapX(e.x + Math.sign(dx) * Math.min(Math.abs(dx), LANDER_SPEED * dt));
    const grabY = target.y - LANDER_GRAB_DY;
    if (e.y < grabY) {
        e.y = Math.min(grabY, e.y + LANDER_DESCENT * dt);
    } else if (Math.abs(dx) < LANDER_GRAB_DX) {
        e.carrying = target;
        target.state = 'carried';
    }
}

function stepMutant(e, dt) {
    const dx = worldDx(e.x, player.x);
    const dy = player.y - e.y;
    e.wobble += dt * 6;
    const jitter = Math.sin(e.wobble) * 90;
    e.vx += (Math.sign(dx) * MUTANT_ACCEL + jitter) * dt;
    e.vy += (Math.sign(dy) * MUTANT_ACCEL * 0.7 + Math.cos(e.wobble) * 60) * dt;
    e.vx = Math.max(-MUTANT_MAX, Math.min(MUTANT_MAX, e.vx));
    e.vy = Math.max(-MUTANT_MAX, Math.min(MUTANT_MAX, e.vy));
    e.x = wrapX(e.x + e.vx * dt);
    e.y = Math.max(SKY_Y - 10, Math.min(GROUND_Y - 6, e.y + e.vy * dt));
}

function updateEnemies(dt) {
    for (const e of enemies) {
        if (e.type === 'lander') stepLander(e, dt);
        else stepMutant(e, dt);
        e.y = Math.max(0, Math.min(GROUND_Y, e.y));

        e.fireTimer -= dt;
        if (e.fireTimer <= 0) {
            e.fireTimer = e.type === 'mutant' ? mutantFireDelay() : landerFireDelay();
            if (isOnScreen(e.x) && player.invuln <= 0) enemyFire(e);
        }
    }
}

// ---------------------------------------------------------------------------
// Bullets, collisions, particles
// ---------------------------------------------------------------------------

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x = wrapX(b.x + b.vx * dt);
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0 || b.y < 0 || b.y > VIEW_H) bullets.splice(i, 1);
    }
}

function collide(dt) {
    // Player bullets vs enemies.
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        if (b.from !== 'player') continue;
        for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if (Math.abs(worldDx(b.x, e.x)) < LANDER_R && Math.abs(b.y - e.y) < LANDER_R) {
                destroyEnemy(j, true);
                bullets.splice(i, 1);
                break;
            }
        }
    }
    if (player.invuln > 0) return;
    // Enemy bullets vs the ship.
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        if (b.from !== 'enemy') continue;
        if (Math.abs(worldDx(b.x, player.x)) < PLAYER_R && Math.abs(b.y - player.y) < PLAYER_R) {
            killPlayer();
            return;
        }
    }
    // Ramming an enemy.
    for (const e of enemies) {
        if (Math.abs(worldDx(e.x, player.x)) < PLAYER_R + LANDER_R * 0.6
            && Math.abs(e.y - player.y) < PLAYER_R + LANDER_R * 0.6) {
            killPlayer();
            return;
        }
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x = wrapX(p.x + p.vx * dt);
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Player & camera
// ---------------------------------------------------------------------------

function updatePlayer(dt) {
    if (player.thrust !== 0) {
        player.vx += player.thrust * ACCEL * dt;
    } else {
        player.vx *= Math.exp(-DRAG * dt);
        if (Math.abs(player.vx) < 0.5) player.vx = 0;
    }
    player.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, player.vx));
    player.x = wrapX(player.x + player.vx * dt);
    player.y += player.vdir * VERT_SPEED * dt;
    player.y = Math.max(SKY_Y, Math.min(GROUND_Y, player.y));
    if (player.cooldown > 0) player.cooldown -= dt;
    if (player.invuln > 0) player.invuln -= dt;
}

function updateCamera(dt) {
    const offset = VIEW_W / 2 - player.dir * CAMERA_LEAD;
    const target = wrapX(player.x - offset);
    camera.x = wrapX(camera.x + worldDx(camera.x, target) * Math.min(1, dt * CAMERA_LERP));
}

function snapCamera() {
    camera.x = wrapX(player.x - (VIEW_W / 2 - player.dir * CAMERA_LEAD));
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

function nextWave() {
    wave += 1;
    const survivors = humanoidsAlive();
    score += WAVE_BONUS * wave * survivors;
    if (planetDead || survivors === 0) {
        planetDead = false;
        resetHumanoids();
    }
    smartBombs = Math.min(MAX_SMART_BOMBS, smartBombs + 1);
    waveClearTimer = WAVE_DELAY;
    spawnWave();
    updateHud();
}

function checkWave(dt) {
    if (enemies.length > 0) {
        waveClearTimer = WAVE_DELAY;
        return;
    }
    waveClearTimer -= dt;
    if (waveClearTimer <= 0) nextWave();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    wave = 1;
    lives = START_LIVES;
    smartBombs = START_SMART_BOMBS;
    planetDead = false;
    waveClearTimer = WAVE_DELAY;
    enemies.length = 0;
    bullets.length = 0;
    particles.length = 0;
    player.x = WORLD_W / 2;
    player.y = 180;
    player.vx = 0;
    player.vy = 0;
    player.dir = 1;
    player.thrust = 0;
    player.vdir = 0;
    player.cooldown = 0;
    player.invuln = RESPAWN_INVULN;
    heldKeys.clear();
    resetHumanoids();
    snapCamera();
    spawnWave();
    hideOverlay();
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('defender-best', String(best)); } catch (e) { /* ignore */ }
    }
    overlayTitle.textContent = 'GAME OVER';
    overlayScore.textContent = `Score ${score} · Wave ${wave}`;
    overlaySub.textContent = 'Press Enter to defend again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        overlayTitle.textContent = 'PAUSED';
        overlayScore.textContent = `Score ${score} · Wave ${wave}`;
        overlaySub.textContent = 'Press P to resume';
        btnStart.textContent = 'Resume';
        overlay.classList.add('visible');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

let hudCache = '';

function updateHud() {
    const humans = humanoidsAlive();
    const key = [score, wave, lives, smartBombs, humans, best].join('|');
    if (key === hudCache) return;
    hudCache = key;
    scoreEl.textContent = String(score);
    waveEl.textContent = String(wave);
    livesEl.textContent = String(lives);
    bombsEl.textContent = String(smartBombs);
    humansEl.textContent = String(humans);
    bestEl.textContent = String(best);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    updatePlayer(dt);
    updateBullets(dt);
    updateEnemies(dt);
    updateHumanoids(dt);
    collide(dt);
    updateParticles(dt);
    updateCamera(dt);
    checkWave(dt);
    updateHud();
}

// ---------------------------------------------------------------------------
// Terrain & stars (generated once from a fixed seed so the planet is stable)
// ---------------------------------------------------------------------------

function makeRng(seed) {
    let s = seed >>> 0;
    return function next() {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

const TERRAIN_STEP = 40;
const terrain = [];
const stars = [];

(function buildWorld() {
    const rng = makeRng(20250731);
    const points = WORLD_W / TERRAIN_STEP;
    let h = 26;
    for (let i = 0; i < points; i++) {
        h += (rng() - 0.5) * 34;
        h = Math.max(6, Math.min(58, h));
        terrain.push(h);
    }
    // Smooth the seam so the wrap is invisible.
    terrain[points - 1] = (terrain[points - 2] + terrain[0]) / 2;
    for (let i = 0; i < 220; i++) {
        stars.push({ x: rng() * WORLD_W, y: rng() * (GROUND_Y - 40), r: rng() < 0.85 ? 1 : 1.8 });
    }
})();

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawScanner() {
    ctx.save();
    ctx.fillStyle = '#070c18';
    ctx.fillRect(0, 0, VIEW_W, SCANNER_H);
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, VIEW_W - 1, SCANNER_H - 1);

    // Bracket showing the slice of the world currently on screen.
    const left = scannerX(camera.x);
    const w = VIEW_W * (VIEW_W / WORLD_W);
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.75)';
    ctx.strokeRect(left, 3, w, SCANNER_H - 6);

    ctx.fillStyle = planetDead ? '#7f1d1d' : '#1e3a5f';
    ctx.fillRect(0, SCANNER_H - 6, VIEW_W, 3);

    for (const h of humanoids) {
        if (h.state === 'dead') continue;
        ctx.fillStyle = '#facc15';
        ctx.fillRect(scannerX(h.x) - 1, scannerY(h.y) - 2, 2, 4);
    }
    for (const e of enemies) {
        ctx.fillStyle = e.type === 'mutant' ? '#f87171' : '#a78bfa';
        ctx.fillRect(scannerX(e.x) - 2, scannerY(e.y) - 2, 4, 4);
    }
    ctx.fillStyle = '#34d399';
    const px = scannerX(player.x);
    const py = scannerY(player.y);
    ctx.beginPath();
    ctx.moveTo(px + player.dir * 5, py);
    ctx.lineTo(px - player.dir * 4, py - 3);
    ctx.lineTo(px - player.dir * 4, py + 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawStars() {
    for (const s of stars) {
        const sx = wrapX(s.x - camera.x * 0.5);
        if (sx > VIEW_W) continue;
        ctx.fillStyle = s.r > 1 ? '#94a3b8' : '#3b4a66';
        ctx.fillRect(sx, s.y, s.r, s.r);
    }
}

function drawTerrain() {
    const first = Math.floor(camera.x / TERRAIN_STEP) - 1;
    ctx.beginPath();
    ctx.moveTo(-TERRAIN_STEP * 2, VIEW_H);
    for (let i = 0; i <= VIEW_W / TERRAIN_STEP + 3; i++) {
        const idx = ((first + i) % terrain.length + terrain.length) % terrain.length;
        const wx = (first + i) * TERRAIN_STEP;
        const sx = worldDx(camera.x, wx);
        ctx.lineTo(sx, GROUND_Y - terrain[idx]);
    }
    ctx.lineTo(VIEW_W + TERRAIN_STEP * 2, VIEW_H);
    ctx.closePath();
    ctx.fillStyle = planetDead ? '#2a0f14' : '#152238';
    ctx.fill();
    ctx.strokeStyle = planetDead ? '#dc2626' : '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = planetDead ? 'rgba(220,38,38,0.35)' : 'rgba(56,189,248,0.25)';
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(VIEW_W, GROUND_Y);
    ctx.stroke();
}

function drawShip(sx, sy, dir) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(dir, 1);
    ctx.fillStyle = '#34d399';
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-6, -7);
    ctx.lineTo(-14, -7);
    ctx.lineTo(-14, 7);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(-14, -3, 8, 6);
    if (player.thrust !== 0) {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(-14, -4);
        ctx.lineTo(-14 - (10 + Math.random() * 10), 0);
        ctx.lineTo(-14, 4);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

function drawLander(sx, sy) {
    ctx.fillStyle = '#a78bfa';
    ctx.beginPath();
    ctx.moveTo(sx, sy - 10);
    ctx.lineTo(sx + 11, sy + 2);
    ctx.lineTo(sx - 11, sy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c4b5fd';
    ctx.fillRect(sx - 4, sy + 2, 8, 4);
    ctx.fillStyle = '#f0abfc';
    ctx.fillRect(sx - 9, sy + 6, 3, 5);
    ctx.fillRect(sx + 6, sy + 6, 3, 5);
}

function drawMutant(sx, sy) {
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.arc(sx, sy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fecaca';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - 12, sy - 6);
    ctx.lineTo(sx + 12, sy + 6);
    ctx.moveTo(sx + 12, sy - 6);
    ctx.lineTo(sx - 12, sy + 6);
    ctx.stroke();
}

function drawHumanoid(sx, sy) {
    ctx.fillStyle = '#facc15';
    ctx.fillRect(sx - 2, sy - 10, 4, 6);
    ctx.fillRect(sx - 3, sy - 4, 6, 5);
    ctx.fillRect(sx - 3, sy + 1, 2, 4);
    ctx.fillRect(sx + 1, sy + 1, 2, 4);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawScanner();

    ctx.save();
    ctx.translate(0, SCANNER_H);
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();

    drawStars();
    drawTerrain();

    for (const h of humanoids) {
        if (h.state === 'dead' || h.state === 'held') continue;
        const sx = worldDx(camera.x, h.x);
        if (sx < -20 || sx > VIEW_W + 20) continue;
        drawHumanoid(sx, h.y);
    }

    for (const e of enemies) {
        const sx = worldDx(camera.x, e.x);
        if (sx < -30 || sx > VIEW_W + 30) continue;
        if (e.type === 'lander') drawLander(sx, e.y);
        else drawMutant(sx, e.y);
        if (e.carrying) {
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.6)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sx, e.y + 6);
            ctx.lineTo(sx, e.y + 14);
            ctx.stroke();
        }
    }

    for (const b of bullets) {
        const sx = worldDx(camera.x, b.x);
        if (sx < -20 || sx > VIEW_W + 20) continue;
        if (b.from === 'player') {
            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(sx - 10 * Math.sign(b.vx), b.y - 1.5, 20, 3);
        } else {
            ctx.fillStyle = '#fb7185';
            ctx.fillRect(sx - 2, b.y - 2, 4, 4);
        }
    }

    for (const p of particles) {
        const sx = worldDx(camera.x, p.x);
        if (sx < -20 || sx > VIEW_W + 20) continue;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
        ctx.fillStyle = p.colour;
        ctx.fillRect(sx - 1.5, p.y - 1.5, 3, 3);
        ctx.globalAlpha = 1;
    }

    if (state !== 'idle') {
        const blink = player.invuln > 0 && Math.floor(player.invuln * 10) % 2 === 0;
        if (!blink) drawShip(worldDx(camera.x, player.x), player.y, player.dir);
        const held = humanoids.find((h) => h.state === 'held');
        if (held) drawHumanoid(worldDx(camera.x, player.x), player.y + 18);
    }

    if (planetDead) {
        ctx.fillStyle = 'rgba(220, 38, 38, 0.65)';
        ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PLANET LOST — MUTANTS INBOUND', VIEW_W / 2, 40);
        ctx.textAlign = 'left';
    }

    ctx.restore();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const heldKeys = new Set();

const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];
const MOVE_KEYS = [...LEFT_KEYS, ...RIGHT_KEYS, ...UP_KEYS, ...DOWN_KEYS];

function anyHeld(keys) { return keys.some((k) => heldKeys.has(k)); }

function refreshKeys() {
    setThrust((anyHeld(RIGHT_KEYS) ? 1 : 0) - (anyHeld(LEFT_KEYS) ? 1 : 0));
    setVertical((anyHeld(DOWN_KEYS) ? 1 : 0) - (anyHeld(UP_KEYS) ? 1 : 0));
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else fire();
        e.preventDefault();
        return;
    }
    if (e.key === 'b' || e.key === 'B') {
        smartBomb();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshKeys();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshKeys();
    }
});

window.addEventListener('blur', () => {
    heldKeys.clear();
    refreshKeys();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('defender-best') || '0', 10) || 0;
state = 'idle';
score = 0;
wave = 1;
lives = START_LIVES;
smartBombs = START_SMART_BOMBS;
planetDead = false;
waveClearTimer = WAVE_DELAY;
resetHumanoids();   // idle backdrop: the planet is already populated
snapCamera();
updateHud();
requestAnimationFrame(frame);
