// ---------------------------------------------------------------------------
// Droid Arena — a single-screen twin-stick arena shooter on an HTML5 canvas.
//
// You are dropped into a sealed robot arena. Grunts walk you down, sentries
// snipe from a distance and indestructible hulks bulldoze anything in their
// path — civilians included. Move with WASD, shoot with the arrow keys; the two
// are independent, which is the whole game: retreat one way while firing the
// other. Clear every destructible droid to advance a wave, and grab civilians
// for an escalating rescue bonus while you do.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Slime Volley,
// Kaboom and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so tests can simulate frames deterministically
// without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Arena geometry ---
const CANVAS_W = 640;
const CANVAS_H = 480;
const WALL = 14;                    // thickness of the arena border

// --- Entity sizes ---
const PLAYER_R = 9;
const GRUNT_R = 9;
const HULK_R = 14;
const SENTRY_R = 10;
const HUMAN_R = 7;
const BULLET_R = 3;
const ENEMY_BULLET_R = 4;

// --- Player ---
const PLAYER_SPEED = 175;           // px/s, identical in all eight directions
const BULLET_SPEED = 520;
const FIRE_INTERVAL = 0.13;         // seconds between shots while aiming
const RESPAWN_INVULN = 1.8;         // seconds of grace after losing a life
const START_LIVES = 3;
const EXTRA_LIFE_EVERY = 25000;

// --- Droids ---
const GRUNT_BASE_SPEED = 54;        // wave 1 chase speed
const GRUNT_WAVE_SPEED = 6;         // added per wave...
const GRUNT_MAX_SPEED = 118;        // ...up to this cap
const GRUNT_WOBBLE = 0.3;           // sideways drift, as a fraction of speed
const HULK_SPEED = 38;
const HULK_TURN_MIN = 1.1;          // seconds between hulk direction changes
const HULK_TURN_MAX = 2.6;
const HULK_KNOCKBACK = 7;           // px a bullet shoves a hulk
const SENTRY_SPEED = 32;
const SENTRY_FIRE_INTERVAL = 1.9;
const ENEMY_BULLET_SPEED = 165;
const HUMAN_SPEED = 26;
const HUMAN_TURN_MIN = 0.8;
const HUMAN_TURN_MAX = 2.0;

// --- Scoring ---
const SCORE_GRUNT = 100;
const SCORE_SENTRY = 200;
const RESCUE_VALUES = [1000, 2000, 3000, 4000, 5000];
const POPUP_LIFE = 0.9;             // seconds a floating score stays up

// --- Waves ---
const MIN_SPAWN_DIST = 110;         // nothing spawns closer to the player
const WAVE_CLEAR_DELAY = 1.2;       // beat between clearing a wave and the next
const MAX_GRUNTS = 26;
const MAX_HULKS = 4;
const MAX_SENTRIES = 5;

const BEST_KEY = 'droid-arena-best';

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const waveEl = document.getElementById('wave');
const livesEl = document.getElementById('lives');
const rescueEl = document.getElementById('rescue');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, lives, wave, highScore, rescueIndex, nextExtraLife, waveTimer;
const player = { x: CANVAS_W / 2, y: CANVAS_H / 2, invuln: 0, aimX: 1, aimY: 0, cooldown: 0 };
const move = { x: 0, y: 0 };
const aim = { x: 0, y: 0 };
const bullets = [];
const enemyBullets = [];
const enemies = [];
const humans = [];
const particles = [];
const popups = [];      // floating "+points" text

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// Circle-vs-circle overlap — every collision in the game is one of these.
function hits(a, b, ra, rb) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const r = ra + rb;
    return dx * dx + dy * dy <= r * r;
}

function radiusOf(e) {
    if (e.type === 'hulk') return HULK_R;
    if (e.type === 'sentry') return SENTRY_R;
    return GRUNT_R;
}

// Keep an entity of radius `r` inside the arena walls.
function clampToArena(e, r) {
    e.x = clamp(e.x, WALL + r, CANVAS_W - WALL - r);
    e.y = clamp(e.y, WALL + r, CANVAS_H - WALL - r);
}

function outsideArena(p, r) {
    return p.x < WALL + r || p.x > CANVAS_W - WALL - r ||
        p.y < WALL + r || p.y > CANVAS_H - WALL - r;
}

function gruntSpeed(w) {
    return Math.min(GRUNT_BASE_SPEED + (w - 1) * GRUNT_WAVE_SPEED, GRUNT_MAX_SPEED);
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

function spawnGrunt(x, y) {
    const e = { type: 'grunt', x, y, phase: rand(0, Math.PI * 2), wobble: rand(2.5, 4.5) };
    enemies.push(e);
    return e;
}

function spawnHulk(x, y) {
    const e = { type: 'hulk', x, y, vx: 0, vy: 0, turnTimer: 0 };
    pickHulkDirection(e);
    enemies.push(e);
    return e;
}

function spawnSentry(x, y) {
    const e = {
        type: 'sentry', x, y,
        anchorX: x, anchorY: y,
        anchorTimer: rand(1, 3),
        fireTimer: rand(SENTRY_FIRE_INTERVAL * 0.4, SENTRY_FIRE_INTERVAL),
    };
    enemies.push(e);
    return e;
}

function spawnHuman(x, y) {
    const h = { x, y, vx: 0, vy: 0, turnTimer: 0, bob: rand(0, Math.PI * 2) };
    pickHumanDirection(h);
    humans.push(h);
    return h;
}

// A random point inside the walls that is a safe distance from the player.
function safeSpawnPoint(r) {
    for (let attempt = 0; attempt < 200; attempt++) {
        const x = rand(WALL + r + 2, CANVAS_W - WALL - r - 2);
        const y = rand(WALL + r + 2, CANVAS_H - WALL - r - 2);
        if (Math.hypot(x - player.x, y - player.y) >= MIN_SPAWN_DIST) return { x, y };
    }
    // Fallback: push straight out from the player to a corner-ish spot.
    const a = rand(0, Math.PI * 2);
    return {
        x: clamp(player.x + Math.cos(a) * MIN_SPAWN_DIST, WALL + r + 2, CANVAS_W - WALL - r - 2),
        y: clamp(player.y + Math.sin(a) * MIN_SPAWN_DIST, WALL + r + 2, CANVAS_H - WALL - r - 2),
    };
}

function gruntCount(w) { return Math.min(6 + 2 * w, MAX_GRUNTS); }
function hulkCount(w) { return Math.min(Math.floor(w / 2), MAX_HULKS); }
function sentryCount(w) { return w < 2 ? 0 : Math.min(1 + Math.floor((w - 2) / 2), MAX_SENTRIES); }
function humanCount(w) { return Math.max(2, 5 - Math.floor((w - 1) / 3)); }

// Wipe the board. Exposed so tests can build an exact scenario.
function clearEntities() {
    enemies.length = 0;
    humans.length = 0;
    bullets.length = 0;
    enemyBullets.length = 0;
    particles.length = 0;
    popups.length = 0;
}

function spawnWave(w) {
    clearEntities();
    rescueIndex = 0;
    waveTimer = 0;
    for (let i = 0; i < gruntCount(w); i++) {
        const p = safeSpawnPoint(GRUNT_R);
        spawnGrunt(p.x, p.y);
    }
    for (let i = 0; i < hulkCount(w); i++) {
        const p = safeSpawnPoint(HULK_R);
        spawnHulk(p.x, p.y);
    }
    for (let i = 0; i < sentryCount(w); i++) {
        const p = safeSpawnPoint(SENTRY_R);
        spawnSentry(p.x, p.y);
    }
    for (let i = 0; i < humanCount(w); i++) {
        const p = safeSpawnPoint(HUMAN_R);
        spawnHuman(p.x, p.y);
    }
    updateHud();
}

// Hulks ignore this count, so a wave with hulks left standing can still end.
function killableCount() {
    return enemies.reduce((n, e) => n + (e.type === 'hulk' ? 0 : 1), 0);
}

function nextWave() {
    wave += 1;
    centrePlayer();
    spawnWave(wave);
}

// ---------------------------------------------------------------------------
// Movement AI
// ---------------------------------------------------------------------------

function pickHulkDirection(h) {
    // Hulks only ever travel along one axis at a time.
    if (Math.random() < 0.5) {
        h.vx = Math.random() < 0.5 ? -HULK_SPEED : HULK_SPEED;
        h.vy = 0;
    } else {
        h.vx = 0;
        h.vy = Math.random() < 0.5 ? -HULK_SPEED : HULK_SPEED;
    }
    h.turnTimer = rand(HULK_TURN_MIN, HULK_TURN_MAX);
}

function pickHumanDirection(h) {
    const a = rand(0, Math.PI * 2);
    h.vx = Math.cos(a) * HUMAN_SPEED;
    h.vy = Math.sin(a) * HUMAN_SPEED;
    h.turnTimer = rand(HUMAN_TURN_MIN, HUMAN_TURN_MAX);
}

function updateGrunt(e, dt) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const speed = gruntSpeed(wave);
    e.phase += dt * e.wobble;
    // Straight at the player, plus a perpendicular wobble so a pack of grunts
    // fans out instead of collapsing into a single dot.
    const sway = Math.sin(e.phase) * GRUNT_WOBBLE;
    e.x += ((dx / d) + (-dy / d) * sway) * speed * dt;
    e.y += ((dy / d) + (dx / d) * sway) * speed * dt;
    clampToArena(e, GRUNT_R);
}

function updateHulk(e, dt) {
    e.turnTimer -= dt;
    if (e.turnTimer <= 0) pickHulkDirection(e);
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    // Bounce off the walls, then commit to the new heading for a while.
    if (e.x <= WALL + HULK_R || e.x >= CANVAS_W - WALL - HULK_R) {
        e.vx = -e.vx;
        e.turnTimer = rand(HULK_TURN_MIN, HULK_TURN_MAX);
    }
    if (e.y <= WALL + HULK_R || e.y >= CANVAS_H - WALL - HULK_R) {
        e.vy = -e.vy;
        e.turnTimer = rand(HULK_TURN_MIN, HULK_TURN_MAX);
    }
    clampToArena(e, HULK_R);
}

function updateSentry(e, dt) {
    e.anchorTimer -= dt;
    const dx = e.anchorX - e.x;
    const dy = e.anchorY - e.y;
    const d = Math.hypot(dx, dy);
    if (e.anchorTimer <= 0 || d < 6) {
        const p = safeSpawnPoint(SENTRY_R);
        e.anchorX = p.x;
        e.anchorY = p.y;
        e.anchorTimer = rand(1.5, 3.5);
    } else {
        e.x += (dx / d) * SENTRY_SPEED * dt;
        e.y += (dy / d) * SENTRY_SPEED * dt;
    }
    clampToArena(e, SENTRY_R);

    e.fireTimer -= dt;
    if (e.fireTimer <= 0) {
        e.fireTimer = SENTRY_FIRE_INTERVAL;
        const ax = player.x - e.x;
        const ay = player.y - e.y;
        const ad = Math.hypot(ax, ay) || 1;
        enemyBullets.push({
            x: e.x, y: e.y,
            vx: (ax / ad) * ENEMY_BULLET_SPEED,
            vy: (ay / ad) * ENEMY_BULLET_SPEED,
        });
    }
}

function updateHuman(h, dt) {
    h.turnTimer -= dt;
    h.bob += dt * 8;
    if (h.turnTimer <= 0) pickHumanDirection(h);
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    if (h.x <= WALL + HUMAN_R || h.x >= CANVAS_W - WALL - HUMAN_R) h.vx = -h.vx;
    if (h.y <= WALL + HUMAN_R || h.y >= CANVAS_H - WALL - HUMAN_R) h.vy = -h.vy;
    clampToArena(h, HUMAN_R);
}

// ---------------------------------------------------------------------------
// Player input hooks (also used directly by the tests)
// ---------------------------------------------------------------------------

function setMove(x, y) {
    move.x = x;
    move.y = y;
}

function setAim(x, y) {
    aim.x = x;
    aim.y = y;
}

function centrePlayer() {
    player.x = CANVAS_W / 2;
    player.y = CANVAS_H / 2;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function addScore(points) {
    score += points;
    while (score >= nextExtraLife) {
        lives += 1;
        nextExtraLife += EXTRA_LIFE_EVERY;
    }
}

function rescueValue() {
    return RESCUE_VALUES[Math.min(rescueIndex, RESCUE_VALUES.length - 1)];
}

function saveBest() {
    if (score <= highScore) return;
    highScore = score;
    try { localStorage.setItem(BEST_KEY, String(highScore)); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function burst(x, y, colour, count, speed) {
    for (let i = 0; i < count; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(speed * 0.3, speed);
        particles.push({
            x, y,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s,
            life: rand(0.25, 0.6),
            colour,
        });
    }
}

// A score that drifts up from where it was earned and fades out.
function popup(x, y, text, colour) {
    popups.push({ x, y, text, colour, life: POPUP_LIFE });
}

function updatePopups(dt) {
    for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        p.life -= dt;
        if (p.life <= 0) { popups.splice(i, 1); continue; }
        p.y -= 26 * dt;
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.94;
        p.vy *= 0.94;
    }
}

// ---------------------------------------------------------------------------
// Life cycle
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    lives = START_LIVES;
    wave = 1;
    rescueIndex = 0;
    nextExtraLife = EXTRA_LIFE_EVERY;
    waveTimer = 0;
    player.invuln = 0;
    player.cooldown = 0;
    player.aimX = 1;
    player.aimY = 0;
    centrePlayer();
    spawnWave(1);
    hideOverlay();
    updateHud();
}

function respawn() {
    centrePlayer();
    player.invuln = RESPAWN_INVULN;
    player.cooldown = 0;
    spawnWave(wave);      // rebuild the wave rather than leave a lost cause
}

function killPlayer() {
    burst(player.x, player.y, '#3fe0c8', 26, 220);
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        gameOver();
    } else {
        respawn();
    }
    updateHud();
}

function gameOver() {
    state = 'over';
    saveBest();
    showOverlay('GAME OVER', 'Score ' + score + ' · Wave ' + wave, 'Press Space to play again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', 'Score ' + score + ' · Wave ' + wave, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation — one slice of time. The frame loop and the tests share this.
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    player.invuln = Math.max(0, player.invuln - dt);

    // --- Player movement (diagonals normalised so they are no faster) ---
    const md = Math.hypot(move.x, move.y);
    if (md > 0) {
        player.x += (move.x / md) * PLAYER_SPEED * dt;
        player.y += (move.y / md) * PLAYER_SPEED * dt;
        clampToArena(player, PLAYER_R);
    }

    // --- Firing: holding an aim key *is* the trigger ---
    if (player.cooldown > 0) player.cooldown -= dt;
    const ad = Math.hypot(aim.x, aim.y);
    if (ad > 0) {
        player.aimX = aim.x / ad;
        player.aimY = aim.y / ad;
        if (player.cooldown <= 0) {
            bullets.push({
                x: player.x + player.aimX * (PLAYER_R + 2),
                y: player.y + player.aimY * (PLAYER_R + 2),
                vx: player.aimX * BULLET_SPEED,
                vy: player.aimY * BULLET_SPEED,
            });
            player.cooldown = FIRE_INTERVAL;
        }
    }

    // --- Droids ---
    for (const e of enemies) {
        if (e.type === 'grunt') updateGrunt(e, dt);
        else if (e.type === 'hulk') updateHulk(e, dt);
        else updateSentry(e, dt);
    }

    // --- Civilians ---
    for (const h of humans) updateHuman(h, dt);

    // --- Player bullets ---
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (outsideArena(b, BULLET_R)) {
            burst(b.x, b.y, '#9fe8ff', 3, 90);
            bullets.splice(i, 1);
            continue;
        }
        for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if (!hits(b, e, BULLET_R, radiusOf(e))) continue;
            if (e.type === 'hulk') {
                // Armour plating: the shot only shoves the hulk along.
                const d = Math.hypot(b.vx, b.vy) || 1;
                e.x += (b.vx / d) * HULK_KNOCKBACK;
                e.y += (b.vy / d) * HULK_KNOCKBACK;
                clampToArena(e, HULK_R);
                burst(b.x, b.y, '#c6d0e4', 5, 120);
            } else {
                addScore(e.type === 'sentry' ? SCORE_SENTRY : SCORE_GRUNT);
                burst(e.x, e.y, e.type === 'sentry' ? '#b98cff' : '#ff5470', 12, 180);
                enemies.splice(j, 1);
            }
            bullets.splice(i, 1);
            break;
        }
    }

    // --- Sentry fire ---
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (outsideArena(b, ENEMY_BULLET_R)) enemyBullets.splice(i, 1);
    }

    updateParticles(dt);
    updatePopups(dt);

    // --- Hulks trample civilians ---
    for (let i = humans.length - 1; i >= 0; i--) {
        for (const e of enemies) {
            if (e.type !== 'hulk') continue;
            if (!hits(humans[i], e, HUMAN_R, HULK_R)) continue;
            burst(humans[i].x, humans[i].y, '#ffd166', 8, 140);
            humans.splice(i, 1);
            break;
        }
    }

    // --- Rescues ---
    for (let i = humans.length - 1; i >= 0; i--) {
        if (!hits(player, humans[i], PLAYER_R, HUMAN_R)) continue;
        popup(humans[i].x, humans[i].y - 12, String(rescueValue()), '#ffd166');
        addScore(rescueValue());
        if (rescueIndex < RESCUE_VALUES.length - 1) rescueIndex += 1;
        burst(humans[i].x, humans[i].y, '#ffd166', 14, 160);
        humans.splice(i, 1);
    }

    // --- Player death ---
    if (player.invuln <= 0) {
        const touched = enemies.some((e) => hits(player, e, PLAYER_R, radiusOf(e)));
        let shot = -1;
        for (let i = 0; i < enemyBullets.length; i++) {
            if (hits(player, enemyBullets[i], PLAYER_R, ENEMY_BULLET_R)) { shot = i; break; }
        }
        if (touched || shot >= 0) {
            if (shot >= 0) enemyBullets.splice(shot, 1);
            killPlayer();
            return;
        }
    }

    // --- Wave bookkeeping ---
    if (waveTimer > 0) {
        waveTimer -= dt;
        if (waveTimer <= 0) nextWave();
    } else if (killableCount() === 0) {
        waveTimer = WAVE_CLEAR_DELAY;
    }

    updateHud();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(Math.max(highScore, score));
    waveEl.textContent = String(wave);
    livesEl.textContent = String(lives);
    rescueEl.textContent = String(rescueValue());
}

function showOverlay(title, sub1, sub2) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub1;
    overlaySub.textContent = sub2;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawArena() {
    ctx.fillStyle = '#070b16';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Floor grid.
    ctx.strokeStyle = 'rgba(63, 224, 200, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = WALL; x <= CANVAS_W - WALL; x += 32) {
        ctx.moveTo(x + 0.5, WALL);
        ctx.lineTo(x + 0.5, CANVAS_H - WALL);
    }
    for (let y = WALL; y <= CANVAS_H - WALL; y += 32) {
        ctx.moveTo(WALL, y + 0.5);
        ctx.lineTo(CANVAS_W - WALL, y + 0.5);
    }
    ctx.stroke();

    // Electrified border.
    ctx.strokeStyle = 'rgba(63, 224, 200, 0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(WALL / 2 + 1, WALL / 2 + 1, CANVAS_W - WALL - 2, CANVAS_H - WALL - 2);
    ctx.strokeStyle = 'rgba(63, 224, 200, 0.15)';
    ctx.lineWidth = 9;
    ctx.strokeRect(WALL / 2 + 1, WALL / 2 + 1, CANVAS_W - WALL - 2, CANVAS_H - WALL - 2);
}

// Everything in the arena is lit from within, so most sprites are drawn once
// with a coloured glow behind them. Callers must reset the shadow afterwards.
function glow(colour, blur) {
    ctx.shadowColor = colour;
    ctx.shadowBlur = blur;
}

function noGlow() {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
}

// A soft pool of light under an entity, so sprites sit on the floor instead of
// floating over the grid.
function drawGlowPool(x, y, r, colour) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, colour);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

function drawPlayer(now) {
    // Blink while invulnerable, but never vanish entirely.
    const blink = player.invuln > 0 && Math.floor(now / 90) % 2 === 0;
    ctx.globalAlpha = blink ? 0.45 : 1;

    drawGlowPool(player.x, player.y, PLAYER_R * 3.2, 'rgba(63, 224, 200, 0.18)');
    glow('#3fe0c8', 14);
    ctx.fillStyle = '#3fe0c8';
    ctx.beginPath();
    ctx.arc(player.x, player.y, PLAYER_R, 0, Math.PI * 2);
    ctx.fill();

    noGlow();

    // Torso plate and a muzzle stub pointing where the shots go.
    ctx.fillStyle = '#0b3b39';
    ctx.fillRect(player.x - 3, player.y - 3, 6, 6);
    ctx.strokeStyle = '#eafff9';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(player.x + player.aimX * 4, player.y + player.aimY * 4);
    ctx.lineTo(player.x + player.aimX * (PLAYER_R + 6), player.y + player.aimY * (PLAYER_R + 6));
    ctx.stroke();

    if (player.invuln > 0) {
        ctx.strokeStyle = 'rgba(63, 224, 200, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(player.x, player.y, PLAYER_R + 6, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

function drawGrunt(e) {
    // Stubby legs that shuffle with the wobble phase.
    const kick = Math.sin(e.phase * 2) * 2;
    glow('#ff5470', 10);
    ctx.fillStyle = '#ff5470';
    ctx.fillRect(e.x - GRUNT_R, e.y - GRUNT_R, GRUNT_R * 2, GRUNT_R * 2);
    ctx.fillRect(e.x - 6, e.y + GRUNT_R, 3, 3 + kick);
    ctx.fillRect(e.x + 3, e.y + GRUNT_R, 3, 3 - kick);
    noGlow();

    ctx.fillStyle = '#3a0716';
    ctx.fillRect(e.x - 6, e.y - 4, 12, 4);
    ctx.fillStyle = '#ffd7de';                       // eye slit
    ctx.fillRect(e.x - 4, e.y - 3, 3, 2);
    ctx.fillRect(e.x + 1, e.y - 3, 3, 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(e.x - GRUNT_R, e.y - GRUNT_R, GRUNT_R * 2, 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(e.x - GRUNT_R, e.y + GRUNT_R - 3, GRUNT_R * 2, 3);
}

function drawHulk(e) {
    drawGlowPool(e.x, e.y, HULK_R * 2.2, 'rgba(141, 153, 181, 0.14)');
    ctx.fillStyle = '#8d99b5';
    ctx.fillRect(e.x - HULK_R, e.y - HULK_R, HULK_R * 2, HULK_R * 2);
    ctx.fillStyle = '#5d6884';
    ctx.fillRect(e.x - HULK_R + 3, e.y - HULK_R + 3, HULK_R * 2 - 6, HULK_R * 2 - 6);
    // Riveted shoulder plates, then a pair of hard little eyes.
    ctx.fillStyle = '#aab5cd';
    ctx.fillRect(e.x - HULK_R, e.y - HULK_R, HULK_R * 2, 3);
    ctx.fillRect(e.x - HULK_R, e.y - HULK_R, 3, HULK_R * 2);
    ctx.fillRect(e.x + HULK_R - 3, e.y - HULK_R, 3, HULK_R * 2);
    glow('#ff5470', 8);
    ctx.fillStyle = '#ff8fa3';
    ctx.fillRect(e.x - 7, e.y - 5, 5, 4);
    ctx.fillRect(e.x + 2, e.y - 5, 5, 4);
    noGlow();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(e.x - HULK_R + 3, e.y + 4, HULK_R * 2 - 6, 3);
}

function drawSentry(e) {
    glow('#b98cff', 12);
    ctx.fillStyle = '#b98cff';
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - SENTRY_R);
    ctx.lineTo(e.x + SENTRY_R, e.y);
    ctx.lineTo(e.x, e.y + SENTRY_R);
    ctx.lineTo(e.x - SENTRY_R, e.y);
    ctx.closePath();
    ctx.fill();
    noGlow();
    ctx.fillStyle = '#1d0f38';
    ctx.beginPath();
    ctx.arc(e.x, e.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd7fb';                       // targeting eye
    ctx.beginPath();
    ctx.arc(e.x, e.y, 2, 0, Math.PI * 2);
    ctx.fill();
    // Charge ring that fills as the next shot comes due.
    const charge = 1 - clamp(e.fireTimer / SENTRY_FIRE_INTERVAL, 0, 1);
    ctx.strokeStyle = 'rgba(185, 140, 255, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, SENTRY_R + 3, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
    ctx.stroke();
}

function drawHuman(h) {
    const gait = Math.sin(h.bob) * 2;
    drawGlowPool(h.x, h.y, 20, 'rgba(255, 209, 102, 0.16)');
    glow('#ffd166', 8);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(h.x, h.y - 5, 3.2, 0, Math.PI * 2);   // head
    ctx.fill();
    ctx.fillRect(h.x - 2.5, h.y - 2, 5, 6);        // body
    ctx.fillRect(h.x - 4, h.y + 4, 2.5, 3 + gait); // legs
    ctx.fillRect(h.x + 1.5, h.y + 4, 2.5, 3 - gait);
    noGlow();
}

function drawBanner(text, sub) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(63, 224, 200, 0.9)';
    ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2 - 8);
    if (sub) {
        ctx.fillStyle = 'rgba(233, 237, 248, 0.7)';
        ctx.font = '14px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(sub, CANVAS_W / 2, CANVAS_H / 2 + 18);
    }
    ctx.textAlign = 'left';
}

function draw() {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    drawArena();

    for (const h of humans) drawHuman(h);

    for (const e of enemies) {
        if (e.type === 'grunt') drawGrunt(e);
        else if (e.type === 'hulk') drawHulk(e);
        else drawSentry(e);
    }

    // Bullets, each with a short motion streak behind it.
    glow('#eafff9', 10);
    ctx.strokeStyle = 'rgba(234, 255, 249, 0.5)';
    ctx.lineWidth = 2;
    ctx.fillStyle = '#eafff9';
    for (const b of bullets) {
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018);
        ctx.stroke();
        ctx.fillRect(b.x - BULLET_R, b.y - BULLET_R, BULLET_R * 2, BULLET_R * 2);
    }
    glow('#ff9ec4', 10);
    ctx.fillStyle = '#ff9ec4';
    for (const b of enemyBullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, ENEMY_BULLET_R, 0, Math.PI * 2);
        ctx.fill();
    }
    noGlow();

    if (state !== 'idle') drawPlayer(now);

    // Particles.
    for (const p of particles) {
        ctx.globalAlpha = clamp(p.life * 2.4, 0, 1);
        ctx.fillStyle = p.colour;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // Floating scores.
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
    for (const p of popups) {
        ctx.globalAlpha = clamp(p.life / POPUP_LIFE, 0, 1);
        ctx.fillStyle = p.colour;
        ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';

    if (state === 'running' && waveTimer > 0) {
        drawBanner('WAVE ' + wave + ' CLEAR', 'Next wave incoming');
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
    if (dt > 0.05) dt = 0.05;   // clamp after tab switches / long frames
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const MOVE_KEYS = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] };
const AIM_KEYS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};

const heldMove = new Set();
const heldAim = new Set();

function refreshMove() {
    let x = 0, y = 0;
    for (const key of heldMove) {
        x += MOVE_KEYS[key][0];
        y += MOVE_KEYS[key][1];
    }
    setMove(x, y);
}

function refreshAim() {
    let x = 0, y = 0;
    for (const key of heldAim) {
        x += AIM_KEYS[key][0];
        y += AIM_KEYS[key][1];
    }
    setAim(x, y);
}

window.addEventListener('keydown', (e) => {
    const lower = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (lower === 'p') {
        if (state === 'running' || state === 'paused') togglePause();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS[lower]) {
        heldMove.add(lower);
        refreshMove();
        e.preventDefault();
        return;
    }
    if (AIM_KEYS[e.key]) {
        heldAim.add(e.key);
        refreshAim();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const lower = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (heldMove.delete(lower)) refreshMove();
    if (heldAim.delete(e.key)) refreshAim();
});

// Dropping focus should not leave a key stuck down.
window.addEventListener('blur', () => {
    heldMove.clear();
    heldAim.clear();
    setMove(0, 0);
    setAim(0, 0);
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

highScore = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
wave = 1;
rescueIndex = 0;
nextExtraLife = EXTRA_LIFE_EVERY;
waveTimer = 0;
updateHud();
requestAnimationFrame(frame);
