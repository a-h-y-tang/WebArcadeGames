// ---------------------------------------------------------------------------
// Robot Arena — a twin-stick arena shooter on an HTML5 canvas.
//
// You are the last technician in a sealed robot testing arena. Waves of
// machines close in from every side: grunts that walk straight at you, fast
// hunters that lead their charge, armoured sentries that shoot back, and
// drifters that ricochet off the walls. You walk with WASD and fire with the
// arrow keys, so moving and shooting are independent — the classic twin-stick
// arrangement. Scientists wander the floor; touching one rescues them for a
// bonus that grows with every rescue in the same wave.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Slime
// Volley, Kaboom and Tetris in this repo. All motion is expressed per second
// and advanced through `step(dt)`, so the tests can simulate frames
// deterministically without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Arena ---
const CANVAS_W = 640;
const CANVAS_H = 480;
const WALL = 16;                    // thickness of the arena border
const CENTER_X = CANVAS_W / 2;
const CENTER_Y = CANVAS_H / 2;

// --- Player ---
const PLAYER_R = 10;
const PLAYER_SPEED = 190;           // px/s
const START_LIVES = 3;
const INVULN_TIME = 2;              // seconds of grace after losing a life
const WAVE_INVULN = 1.5;            // ...and at the start of every wave

// --- Shooting ---
const BULLET_R = 3;
const BULLET_SPEED = 430;
const FIRE_COOLDOWN = 0.14;         // seconds between shots

// --- Enemy fire ---
const ENEMY_BULLET_R = 4;
const ENEMY_BULLET_SPEED = 210;
const SENTRY_FIRE_INTERVAL = 2.2;

// --- Enemies ---
// speed ramps by `ramp` px/s for each wave beyond the first.
const ENEMY_TYPES = {
    grunt: { speed: 62, ramp: 5, r: 11, hp: 1, points: 100, color: '#ff8a5c' },
    hunter: { speed: 128, ramp: 6, r: 10, hp: 1, points: 200, color: '#ff4d6d' },
    sentry: { speed: 38, ramp: 2, r: 13, hp: 2, points: 150, color: '#c08bff' },
    drifter: { speed: 168, ramp: 7, r: 12, hp: 1, points: 125, color: '#5cc9ff' },
};

// --- Humans ---
const HUMAN_R = 8;
const HUMAN_SPEED = 34;
const RESCUE_STEP = 100;            // first rescue of a wave, then 200, 300...
const RESCUE_MAX_CHAIN = 10;

// --- Waves ---
const WAVE_DELAY = 1.5;             // pause between a cleared wave and the next
const SPAWN_CLEARANCE = 110;        // nothing spawns this close to the player

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const waveEl = document.getElementById('wave');
const livesEl = document.getElementById('lives');
const highEl = document.getElementById('high');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, wave, lives, highScore, rescueChain, rescued, shotsFired;
let waveTimer, fireTimer, waveBanner;
const player = { x: CENTER_X, y: CENTER_Y, vx: 0, vy: 0, aimX: 0, aimY: -1, invuln: 0 };
const input = { moveX: 0, moveY: 0, fireX: 0, fireY: 0 };
const enemies = [];
const bullets = [];
const enemyBullets = [];
const humans = [];
const particles = [];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// Everything alive is kept inside the arena walls by its own radius.
function clampToArena(o, r) {
    o.x = clamp(o.x, WALL + r, CANVAS_W - WALL - r);
    o.y = clamp(o.y, WALL + r, CANVAS_H - WALL - r);
}

// ---------------------------------------------------------------------------
// Input plumbing (also the seam the tests drive the player through)
// ---------------------------------------------------------------------------

function moveDir(dx, dy) {
    input.moveX = dx;
    input.moveY = dy;
}

function fireDir(dx, dy) {
    input.fireX = dx;
    input.fireY = dy;
}

function setPlayerPos(x, y) {
    player.x = x;
    player.y = y;
    clampToArena(player, PLAYER_R);
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

function spawnEnemy(type, x, y) {
    const spec = ENEMY_TYPES[type];
    const speed = spec.speed + (wave - 1) * spec.ramp;
    const angle = rand(0, Math.PI * 2);
    const enemy = {
        type,
        x,
        y,
        r: spec.r,
        hp: spec.hp,
        speed,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        fireTimer: rand(0.4, SENTRY_FIRE_INTERVAL),
        anchorX: x,
        anchorY: y,
        anchorTimer: rand(1, 3),
        phase: rand(0, Math.PI * 2),
    };
    enemies.push(enemy);
    return enemy;
}

function spawnHuman(x, y) {
    const angle = rand(0, Math.PI * 2);
    const human = {
        x,
        y,
        r: HUMAN_R,
        vx: Math.cos(angle) * HUMAN_SPEED,
        vy: Math.sin(angle) * HUMAN_SPEED,
        turnTimer: rand(0.8, 2.2),
        step: rand(0, Math.PI * 2),
    };
    humans.push(human);
    return human;
}

function spawnEnemyBullet(x, y, vx, vy) {
    const bullet = { x, y, vx, vy, r: ENEMY_BULLET_R };
    enemyBullets.push(bullet);
    return bullet;
}

function spawnBullet(x, y, vx, vy) {
    const bullet = { x, y, vx, vy, r: BULLET_R };
    bullets.push(bullet);
    return bullet;
}

function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = rand(40, 190);
        particles.push({
            x, y, color,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: rand(0.25, 0.6),
            max: 0.6,
        });
    }
}

// A free spot for a spawn: anywhere inside the walls, but not on the player.
function freeSpot(r) {
    for (let i = 0; i < 200; i++) {
        const x = rand(WALL + r, CANVAS_W - WALL - r);
        const y = rand(WALL + r, CANVAS_H - WALL - r);
        if (Math.hypot(x - player.x, y - player.y) >= SPAWN_CLEARANCE) return { x, y };
    }
    return { x: WALL + r, y: WALL + r };
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

function enemyCountForWave(w) {
    return Math.min(5 + w * 2, 26);
}

function humanCountForWave(w) {
    return Math.max(2, 5 - Math.floor((w - 1) / 2));
}

// Which machines the factory floor sends out on wave `w`. Grunts from the
// start; sentries and drifters join on wave 2, hunters on wave 3, and the
// proportion of the nastier ones grows with the wave number.
function rosterForWave(w) {
    const roster = [];
    const total = enemyCountForWave(w);
    for (let i = 0; i < total; i++) {
        const roll = Math.random();
        if (w >= 3 && roll < Math.min(0.1 + w * 0.02, 0.26)) roster.push('hunter');
        else if (w >= 2 && roll < Math.min(0.2 + w * 0.03, 0.45)) roster.push('drifter');
        else if (w >= 2 && roll < Math.min(0.3 + w * 0.03, 0.58)) roster.push('sentry');
        else roster.push('grunt');
    }
    return roster;
}

function spawnWave(w) {
    wave = w;
    enemies.length = 0;
    humans.length = 0;
    enemyBullets.length = 0;
    rescueChain = 0;
    waveTimer = 0;
    waveBanner = 1.4;
    player.invuln = Math.max(player.invuln, WAVE_INVULN);

    for (const type of rosterForWave(w)) {
        const spot = freeSpot(ENEMY_TYPES[type].r);
        spawnEnemy(type, spot.x, spot.y);
    }
    for (let i = 0; i < humanCountForWave(w); i++) {
        const spot = freeSpot(HUMAN_R);
        spawnHuman(spot.x, spot.y);
    }
    updateHud();
}

function nextWave() {
    spawnWave(wave + 1);
}

// ---------------------------------------------------------------------------
// Scoring, damage and game flow
// ---------------------------------------------------------------------------

function addScore(points) {
    score += points;
    updateHud();
}

// One bullet's worth of damage. Returns true when the enemy was destroyed.
function hitEnemy(enemy) {
    enemy.hp -= 1;
    if (enemy.hp > 0) {
        burst(enemy.x, enemy.y, ENEMY_TYPES[enemy.type].color, 4);
        return false;
    }
    const i = enemies.indexOf(enemy);
    if (i !== -1) enemies.splice(i, 1);
    burst(enemy.x, enemy.y, ENEMY_TYPES[enemy.type].color, 14);
    addScore(ENEMY_TYPES[enemy.type].points);
    return true;
}

function rescueHuman(human) {
    const i = humans.indexOf(human);
    if (i !== -1) humans.splice(i, 1);
    rescueChain = Math.min(rescueChain + 1, RESCUE_MAX_CHAIN);
    rescued += 1;
    burst(human.x, human.y, '#ffe66d', 12);
    addScore(RESCUE_STEP * rescueChain);
}

function loseLife() {
    lives -= 1;
    burst(player.x, player.y, '#35f0d0', 26);
    enemyBullets.length = 0;
    player.x = CENTER_X;
    player.y = CENTER_Y;
    player.vx = 0;
    player.vy = 0;
    player.invuln = INVULN_TIME;
    updateHud();
    if (lives <= 0) gameOver();
}

function gameOver() {
    state = 'over';
    lives = Math.max(lives, 0);
    if (score > highScore) {
        highScore = score;
        try {
            localStorage.setItem('robot-arena-high', String(highScore));
        } catch (err) {
            /* private browsing — the run just isn't remembered */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} — reached wave ${wave}`, 'Press Space to play again');
}

function startGame() {
    state = 'running';
    score = 0;
    lives = START_LIVES;
    rescued = 0;
    shotsFired = 0;
    fireTimer = 0;
    waveTimer = 0;
    bullets.length = 0;
    particles.length = 0;
    player.x = CENTER_X;
    player.y = CENTER_Y;
    player.vx = 0;
    player.vy = 0;
    player.invuln = 0;
    player.aimX = 0;
    player.aimY = -1;
    moveDir(0, 0);
    fireDir(0, 0);
    spawnWave(1);
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score} — wave ${wave}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function updatePlayer(dt) {
    let { moveX, moveY } = input;
    const len = Math.hypot(moveX, moveY);
    if (len > 0) {
        moveX /= len;
        moveY /= len;
    }
    player.vx = moveX * PLAYER_SPEED;
    player.vy = moveY * PLAYER_SPEED;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    clampToArena(player, PLAYER_R);
    player.invuln = Math.max(0, player.invuln - dt);
}

function updateFiring(dt) {
    fireTimer = Math.max(0, fireTimer - dt);
    const len = Math.hypot(input.fireX, input.fireY);
    if (len === 0) return;
    const dx = input.fireX / len;
    const dy = input.fireY / len;
    player.aimX = dx;
    player.aimY = dy;
    if (fireTimer > 0) return;
    spawnBullet(
        player.x + dx * (PLAYER_R + 4),
        player.y + dy * (PLAYER_R + 4),
        dx * BULLET_SPEED,
        dy * BULLET_SPEED,
    );
    shotsFired += 1;
    fireTimer = FIRE_COOLDOWN;
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x <= WALL || b.x >= CANVAS_W - WALL || b.y <= WALL || b.y >= CANVAS_H - WALL) {
            burst(b.x, b.y, '#9ff5ff', 3);
            bullets.splice(i, 1);
            continue;
        }
        for (const enemy of enemies) {
            if (Math.hypot(b.x - enemy.x, b.y - enemy.y) <= enemy.r + b.r) {
                bullets.splice(i, 1);
                hitEnemy(enemy);
                break;
            }
        }
    }
}

// Nudge crowding robots apart so a wave doesn't collapse into one blob.
function separate(enemy, dt) {
    for (const other of enemies) {
        if (other === enemy) continue;
        const dx = enemy.x - other.x;
        const dy = enemy.y - other.y;
        const d = Math.hypot(dx, dy);
        const min = enemy.r + other.r;
        if (d > 0 && d < min) {
            const push = ((min - d) / min) * 60 * dt;
            enemy.x += (dx / d) * push;
            enemy.y += (dy / d) * push;
        }
    }
}

function updateEnemies(dt) {
    for (const e of enemies) {
        const dx = player.x - e.x;
        const dy = player.y - e.y;
        const dist = Math.hypot(dx, dy) || 1;

        if (e.type === 'grunt') {
            // A steady march, with a slight sway so the pack doesn't line up.
            e.phase += dt * 3;
            const swayX = -dy / dist;
            const swayY = dx / dist;
            e.x += (dx / dist + swayX * 0.25 * Math.sin(e.phase)) * e.speed * dt;
            e.y += (dy / dist + swayY * 0.25 * Math.sin(e.phase)) * e.speed * dt;
        } else if (e.type === 'hunter') {
            // Aims a quarter-second ahead of where the player is walking.
            const tx = player.x + player.vx * 0.25 - e.x;
            const ty = player.y + player.vy * 0.25 - e.y;
            const td = Math.hypot(tx, ty) || 1;
            e.x += (tx / td) * e.speed * dt;
            e.y += (ty / td) * e.speed * dt;
        } else if (e.type === 'sentry') {
            // Repositions slowly between anchor points and shoots on a timer.
            e.anchorTimer -= dt;
            if (e.anchorTimer <= 0) {
                e.anchorTimer = rand(1.5, 3.5);
                e.anchorX = rand(WALL + e.r, CANVAS_W - WALL - e.r);
                e.anchorY = rand(WALL + e.r, CANVAS_H - WALL - e.r);
            }
            const ax = e.anchorX - e.x;
            const ay = e.anchorY - e.y;
            const ad = Math.hypot(ax, ay);
            if (ad > 2) {
                e.x += (ax / ad) * e.speed * dt;
                e.y += (ay / ad) * e.speed * dt;
            }
            e.fireTimer -= dt;
            if (e.fireTimer <= 0) {
                e.fireTimer = SENTRY_FIRE_INTERVAL;
                spawnEnemyBullet(e.x, e.y, (dx / dist) * ENEMY_BULLET_SPEED, (dy / dist) * ENEMY_BULLET_SPEED);
            }
        } else if (e.type === 'drifter') {
            // Straight lines and hard ricochets off the arena walls.
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            if (e.x <= WALL + e.r && e.vx < 0) e.vx = -e.vx;
            if (e.x >= CANVAS_W - WALL - e.r && e.vx > 0) e.vx = -e.vx;
            if (e.y <= WALL + e.r && e.vy < 0) e.vy = -e.vy;
            if (e.y >= CANVAS_H - WALL - e.r && e.vy > 0) e.vy = -e.vy;
        }

        separate(e, dt);
        clampToArena(e, e.r);
    }

    if (player.invuln > 0) return;
    for (const e of enemies) {
        if (Math.hypot(player.x - e.x, player.y - e.y) <= e.r + PLAYER_R) {
            loseLife();
            return;
        }
    }
}

function updateEnemyBullets(dt) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x <= WALL || b.x >= CANVAS_W - WALL || b.y <= WALL || b.y >= CANVAS_H - WALL) {
            enemyBullets.splice(i, 1);
            continue;
        }
        if (player.invuln <= 0 && Math.hypot(b.x - player.x, b.y - player.y) <= b.r + PLAYER_R) {
            loseLife();     // also clears every enemy bullet on the floor
            return;
        }
    }
}

function updateHumans(dt) {
    for (let i = humans.length - 1; i >= 0; i--) {
        const h = humans[i];
        h.turnTimer -= dt;
        if (h.turnTimer <= 0) {
            h.turnTimer = rand(0.8, 2.2);
            const a = rand(0, Math.PI * 2);
            h.vx = Math.cos(a) * HUMAN_SPEED;
            h.vy = Math.sin(a) * HUMAN_SPEED;
        }
        h.step += dt * 8;
        h.x += h.vx * dt;
        h.y += h.vy * dt;
        if (h.x <= WALL + h.r || h.x >= CANVAS_W - WALL - h.r) h.vx = -h.vx;
        if (h.y <= WALL + h.r || h.y >= CANVAS_H - WALL - h.r) h.vy = -h.vy;
        clampToArena(h, h.r);

        if (Math.hypot(h.x - player.x, h.y - player.y) <= h.r + PLAYER_R) rescueHuman(h);
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.94;
        p.vy *= 0.94;
    }
}

// One tick of the world. Everything the game does happens in here, so tests
// can advance time exactly.
function step(dt) {
    if (state !== 'running') return;
    updatePlayer(dt);
    updateFiring(dt);
    updateBullets(dt);
    updateEnemies(dt);
    if (state !== 'running') return;   // the last hit may have ended the game
    updateEnemyBullets(dt);
    if (state !== 'running') return;
    updateHumans(dt);
    updateParticles(dt);
    if (waveBanner > 0) waveBanner = Math.max(0, waveBanner - dt);

    if (enemies.length === 0) {
        waveTimer += dt;
        if (waveTimer >= WAVE_DELAY) nextWave();
    } else {
        waveTimer = 0;
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    waveEl.textContent = String(wave);
    livesEl.textContent = String(Math.max(lives, 0));
    highEl.textContent = String(highScore);
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawArena() {
    ctx.fillStyle = '#070b18';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.strokeStyle = 'rgba(53, 240, 208, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = WALL; x <= CANVAS_W - WALL; x += 32) {
        ctx.moveTo(x, WALL);
        ctx.lineTo(x, CANVAS_H - WALL);
    }
    for (let y = WALL; y <= CANVAS_H - WALL; y += 32) {
        ctx.moveTo(WALL, y);
        ctx.lineTo(CANVAS_W - WALL, y);
    }
    ctx.stroke();

    ctx.strokeStyle = '#2b3d6b';
    ctx.lineWidth = 3;
    ctx.strokeRect(WALL, WALL, CANVAS_W - WALL * 2, CANVAS_H - WALL * 2);
    ctx.strokeStyle = 'rgba(53, 240, 208, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(WALL + 4, WALL + 4, CANVAS_W - WALL * 2 - 8, CANVAS_H - WALL * 2 - 8);
}

function drawPlayer() {
    // Blink while the shield is up, but never disappear completely.
    const blink = player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.45 : 1;

    ctx.fillStyle = '#35f0d0';
    ctx.strokeStyle = '#0b3b36';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, PLAYER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Gun barrel pointing where the arrow keys aim.
    ctx.strokeStyle = '#d8fff6';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(player.x + player.aimX * (PLAYER_R + 7), player.y + player.aimY * (PLAYER_R + 7));
    ctx.stroke();

    if (player.invuln > 0) {
        ctx.strokeStyle = 'rgba(53, 240, 208, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(player.x, player.y, PLAYER_R + 6, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();
}

function drawEnemy(e) {
    const color = ENEMY_TYPES[e.type].color;
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 2;

    if (e.type === 'grunt') {
        ctx.fillRect(e.x - e.r, e.y - e.r, e.r * 2, e.r * 2);
        ctx.strokeRect(e.x - e.r, e.y - e.r, e.r * 2, e.r * 2);
        ctx.fillStyle = '#1a0d08';
        ctx.fillRect(e.x - e.r * 0.5, e.y - e.r * 0.3, e.r, e.r * 0.35);
    } else if (e.type === 'hunter') {
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - e.r);
        ctx.lineTo(e.x + e.r, e.y + e.r);
        ctx.lineTo(e.x - e.r, e.y + e.r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    } else if (e.type === 'sentry') {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = e.hp > 1 ? '#f4e9ff' : '#5c2f8f';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(Math.atan2(e.vy, e.vx));
        ctx.beginPath();
        ctx.moveTo(e.r, 0);
        ctx.lineTo(0, e.r);
        ctx.lineTo(-e.r, 0);
        ctx.lineTo(0, -e.r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
}

function drawHuman(h) {
    const bob = Math.sin(h.step) * 1.5;
    ctx.fillStyle = '#ffe66d';
    ctx.beginPath();
    ctx.arc(h.x, h.y - h.r * 0.5 + bob, h.r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(h.x - h.r * 0.35, h.y - h.r * 0.1 + bob, h.r * 0.7, h.r * 0.9);
    ctx.strokeStyle = '#ffe66d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(h.x - h.r * 0.35, h.y + h.r * 0.8 + bob);
    ctx.lineTo(h.x, h.y + h.r * 0.3 + bob);
    ctx.lineTo(h.x + h.r * 0.35, h.y + h.r * 0.8 + bob);
    ctx.stroke();
}

function drawBanner() {
    if (waveBanner <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, waveBanner / 0.6);
    ctx.fillStyle = '#35f0d0';
    ctx.font = 'bold 30px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`WAVE ${wave}`, CENTER_X, CENTER_Y - 60);
    ctx.restore();
    ctx.textAlign = 'left';
}

function draw() {
    drawArena();

    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    for (const h of humans) drawHuman(h);
    for (const e of enemies) drawEnemy(e);

    ctx.fillStyle = '#ff9db1';
    for (const b of enemyBullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = '#9ff5ff';
    for (const b of bullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
    }

    if (state !== 'idle') drawPlayer();
    drawBanner();

    if (state === 'running' && rescueChain > 0) {
        ctx.fillStyle = 'rgba(255, 230, 109, 0.85)';
        ctx.font = '13px Segoe UI, sans-serif';
        ctx.fillText(`Rescue bonus x${rescueChain}`, WALL + 10, CANVAS_H - WALL - 10);
    }
}

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;       // clamp after tab switches / long frames
    step(dt);
    if (state !== 'running') updateParticles(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Keyboard: WASD walks, the arrow keys shoot.
// ---------------------------------------------------------------------------

const MOVE_KEYS = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] };
const FIRE_KEYS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};
const held = new Set();

function refreshInput() {
    let mx = 0;
    let my = 0;
    for (const [key, [dx, dy]] of Object.entries(MOVE_KEYS)) {
        if (held.has(key)) {
            mx += dx;
            my += dy;
        }
    }
    let fx = 0;
    let fy = 0;
    for (const [key, [dx, dy]] of Object.entries(FIRE_KEYS)) {
        if (held.has(key)) {
            fx += dx;
            fy += dy;
        }
    }
    moveDir(mx, my);
    fireDir(fx, fy);
}

window.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (key === 'p') {
        if (state === 'running' || state === 'paused') {
            togglePause();
            e.preventDefault();
        }
        return;
    }
    if (key === ' ' || key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (key in MOVE_KEYS || key in FIRE_KEYS) {
        held.add(key);
        refreshInput();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (held.delete(key)) refreshInput();
});

window.addEventListener('blur', () => {
    held.clear();
    refreshInput();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

highScore = parseInt(localStorage.getItem('robot-arena-high') || '0', 10) || 0;
state = 'idle';
score = 0;
wave = 1;
lives = START_LIVES;
rescueChain = 0;
rescued = 0;
shotsFired = 0;
fireTimer = 0;
waveTimer = 0;
waveBanner = 0;
updateHud();
requestAnimationFrame(frame);
