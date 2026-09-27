// ---------------------------------------------------------------------------
// Tank Battle — a top-down armoured skirmish on an HTML5 canvas.
//
// You command a single tank on a 15x15 tile battlefield. Enemy tanks roll in
// from the top edge and push toward the eagle base you are defending at the
// bottom. Brick walls crumble under fire, steel walls do not, and losing either
// your last life or the base ends the war.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run, Snake and Tetris in this repo. All motion is expressed per-second
// and advanced through `step(dt)`, which runs fixed sub-steps internally, so
// tests can simulate frames deterministically without depending on
// requestAnimationFrame wall-clock timing. Every random choice goes through a
// seeded PRNG, so a given level always builds the same battlefield.
// ---------------------------------------------------------------------------

// --- World geometry ---
const COLS = 15;
const ROWS = 15;
const CELL = 32;
const CANVAS_W = COLS * CELL;   // 480
const CANVAS_H = ROWS * CELL;   // 480

// --- Tiles ---
const T_EMPTY = 0;
const T_BRICK = 1;   // destructible
const T_STEEL = 2;   // indestructible

// --- Tanks ---
const TANK_HALF = 14;           // half-width of a tank (28px inside a 32px cell)
const PLAYER_SPEED = 105;       // px/s
const RESPAWN_DELAY = 1.0;      // s before a destroyed player rolls back out
const SPAWN_INVULN = 2.0;       // s of shield after respawning
const START_LIVES = 3;

// --- Shells ---
const BULLET_SPEED = 300;       // px/s, player
const ENEMY_BULLET_SPEED = 215; // px/s, enemy
const BULLET_R = 3;
const PLAYER_MAX_BULLETS = 1;   // one shell in flight at a time, as in the arcade original

// --- Enemy waves (all pure functions of `level`) ---
const ENEMY_BASE = 6, ENEMY_STEP = 2;          // enemies to destroy per level
const SPEED_BASE = 58, SPEED_STEP = 7;         // enemy tank speed
const FIRE_BASE = 1.7, FIRE_STEP = 0.12, FIRE_MIN = 0.55;
const POINTS_BASE = 100;                       // points per kill, times the level
const SPAWN_INTERVAL = 2.4;                    // s between reinforcements
const FIRST_SPAWN_DELAY = 1.0;

const SPAWN_POINTS = [[0, 0], [7, 0], [14, 0]];
const PLAYER_SPAWN = [4, 14];
const BASE_CELL = [7, 14];
const FORT = [[6, 13], [7, 13], [8, 13], [6, 14], [8, 14]];

const DIRS = ['up', 'down', 'left', 'right'];
const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEYDIR = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
};

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const enemiesEl = document.getElementById('enemies');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, level, lives;
let enemiesLeft, enemiesToSpawn, spawnTimer, spawnIndex;
let grid = [];
const player = {
    x: 0, y: 0, dir: 'up', dirWanted: null, alive: true,
    invuln: 0, respawn: 0, fireCooldown: 0,
};
const base = { cx: BASE_CELL[0], cy: BASE_CELL[1], alive: true };
const enemies = [];
const bullets = [];
const particles = [];
const heldKeys = new Set();

// ---------------------------------------------------------------------------
// Seeded RNG — keeps level layouts and AI reproducible for the tests
// ---------------------------------------------------------------------------

let rngState = 1;

function seedRng(n) {
    rngState = (n >>> 0) || 1;
}

function rand() {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
}

// ---------------------------------------------------------------------------
// Difficulty helpers (pure functions of `level`)
// ---------------------------------------------------------------------------

function enemiesForLevel() { return ENEMY_BASE + (level - 1) * ENEMY_STEP; }
function enemySpeed() { return SPEED_BASE + (level - 1) * SPEED_STEP; }
function enemyFireInterval() { return Math.max(FIRE_MIN, FIRE_BASE - (level - 1) * FIRE_STEP); }
function pointsPerKill() { return POINTS_BASE * level; }
function maxActive() { return Math.min(5, 3 + Math.floor((level - 1) / 2)); }

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function cellCenter(c) { return c * CELL + CELL / 2; }

function tileAt(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return T_STEEL; // walls behave like steel
    return grid[cy][cx];
}

function setTile(cx, cy, t) {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return;
    grid[cy][cx] = t;
}

// Walls sit only on odd columns / even rows, which leaves every even column and
// every odd row as an open lane — the map is therefore always navigable.
function buildLevel(lv) {
    seedRng(lv * 7919 + 13);
    grid = [];
    for (let cy = 0; cy < ROWS; cy++) grid.push(new Array(COLS).fill(T_EMPTY));

    const steelChance = Math.min(0.24, 0.08 + (lv - 1) * 0.03);
    for (let cy = 2; cy <= ROWS - 3; cy += 2) {
        for (let cx = 1; cx <= COLS - 2; cx += 2) {
            const r = rand();
            if (r < 0.62) grid[cy][cx] = T_BRICK;
            else if (r < 0.62 + steelChance) grid[cy][cx] = T_STEEL;
        }
    }

    for (const [cx, cy] of FORT) grid[cy][cx] = T_BRICK;
    grid[base.cy][base.cx] = T_EMPTY;
}

// ---------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------

function allTanks() {
    return player.alive ? [player, ...enemies] : enemies;
}

// Can a tank centred on (x, y) sit here? `self` is excluded from the tank-vs-tank
// check; pass null to test a cell against every tank on the field.
function canOccupy(x, y, self) {
    const h = TANK_HALF;
    if (x - h < 0 || y - h < 0 || x + h > CANVAS_W || y + h > CANVAS_H) return false;

    const c0 = Math.floor((x - h) / CELL), c1 = Math.floor((x + h - 0.001) / CELL);
    const r0 = Math.floor((y - h) / CELL), r1 = Math.floor((y + h - 0.001) / CELL);
    for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
            if (tileAt(cx, cy) !== T_EMPTY) return false;
            if (base.alive && cx === base.cx && cy === base.cy) return false;
        }
    }

    for (const t of allTanks()) {
        if (t === self || !t.alive) continue;
        if (Math.abs(t.x - x) < 2 * h - 2 && Math.abs(t.y - y) < 2 * h - 2) return false;
    }
    return true;
}

// Move as far along (dx, dy) as the terrain allows; returns true if the whole
// move went through. A blocked move creeps up flush against the obstacle.
function slide(tank, dx, dy) {
    if (canOccupy(tank.x + dx, tank.y + dy, tank)) {
        tank.x += dx;
        tank.y += dy;
        return true;
    }
    let lo = 0, hi = 1;
    for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (canOccupy(tank.x + dx * mid, tank.y + dy * mid, tank)) lo = mid; else hi = mid;
    }
    tank.x += dx * lo;
    tank.y += dy * lo;
    return false;
}

// Point the tank in `dir` (snapping it onto the perpendicular lane, as in the
// arcade original) and drive `dist` pixels.
function tryMove(tank, dir, dist) {
    if (!DIRV[dir]) return false;
    if (tank.dir !== dir) {
        tank.dir = dir;
        if (dir === 'left' || dir === 'right') {
            const snapped = cellCenter(Math.round((tank.y - CELL / 2) / CELL));
            if (canOccupy(tank.x, snapped, tank)) tank.y = snapped;
        } else {
            const snapped = cellCenter(Math.round((tank.x - CELL / 2) / CELL));
            if (canOccupy(snapped, tank.y, tank)) tank.x = snapped;
        }
    }
    const [dx, dy] = DIRV[dir];
    return slide(tank, dx * dist, dy * dist);
}

// ---------------------------------------------------------------------------
// Shells
// ---------------------------------------------------------------------------

function spawnBullet(opts) {
    const b = {
        x: opts.x, y: opts.y, dir: opts.dir, owner: opts.owner,
        tank: opts.tank || null, alive: true,
    };
    bullets.push(b);
    return b;
}

function fire(tank) {
    if (state !== 'running' || !tank || !tank.alive) return null;
    const owner = tank === player ? 'player' : 'enemy';
    let inFlight = 0;
    for (const b of bullets) {
        if (owner === 'player' ? b.owner === 'player' : b.tank === tank) inFlight++;
    }
    if (inFlight >= (owner === 'player' ? PLAYER_MAX_BULLETS : 1)) return null;

    const [dx, dy] = DIRV[tank.dir];
    return spawnBullet({
        x: tank.x + dx * (TANK_HALF + 2),
        y: tank.y + dy * (TANK_HALF + 2),
        dir: tank.dir,
        owner,
        tank,
    });
}

function resolveBullet(b) {
    if (b.x < 0 || b.y < 0 || b.x > CANVAS_W || b.y > CANVAS_H) {
        b.alive = false;
        sparks(b.x, b.y, '#cfd8c3', 4);
        return;
    }

    const cx = Math.floor(b.x / CELL), cy = Math.floor(b.y / CELL);

    if (base.alive && cx === base.cx && cy === base.cy) {
        b.alive = false;
        destroyBase();
        return;
    }

    const tile = tileAt(cx, cy);
    if (tile === T_BRICK) {
        setTile(cx, cy, T_EMPTY);
        b.alive = false;
        sparks(b.x, b.y, '#d98352', 8);
        return;
    }
    if (tile === T_STEEL) {
        b.alive = false;
        sparks(b.x, b.y, '#e8f0ff', 6);
        return;
    }

    if (b.owner === 'player') {
        for (const e of enemies) {
            if (!e.alive) continue;
            if (Math.abs(b.x - e.x) <= TANK_HALF && Math.abs(b.y - e.y) <= TANK_HALF) {
                b.alive = false;
                killEnemy(e);
                return;
            }
        }
    } else if (player.alive && player.invuln <= 0) {
        if (Math.abs(b.x - player.x) <= TANK_HALF && Math.abs(b.y - player.y) <= TANK_HALF) {
            b.alive = false;
            killPlayer();
        }
    }
}

function updateBullets(d) {
    for (const b of bullets) {
        if (!b.alive) continue;
        const speed = b.owner === 'player' ? BULLET_SPEED : ENEMY_BULLET_SPEED;
        const [dx, dy] = DIRV[b.dir];
        let remaining = speed * d;
        while (remaining > 0 && b.alive) {
            const move = Math.min(remaining, 4);
            b.x += dx * move;
            b.y += dy * move;
            remaining -= move;
            resolveBullet(b);
        }
    }
    for (let i = bullets.length - 1; i >= 0; i--) {
        if (!bullets[i].alive) bullets.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Destruction
// ---------------------------------------------------------------------------

function killEnemy(e) {
    e.alive = false;
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    boom(e.x, e.y, '#8fd3ff');
    score += pointsPerKill();
    enemiesLeft = Math.max(0, enemiesLeft - 1);
    updateHud();
    if (enemiesLeft === 0) nextLevel();
}

function killPlayer() {
    player.alive = false;
    player.respawn = RESPAWN_DELAY;
    player.dirWanted = null;
    boom(player.x, player.y, '#f6c453');
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        updateHud();
        endGame('GAME OVER');
        return;
    }
    updateHud();
}

function destroyBase() {
    base.alive = false;
    boom(cellCenter(base.cx), cellCenter(base.cy), '#f87171');
    endGame('BASE DESTROYED');
}

function respawnPlayer() {
    player.x = cellCenter(PLAYER_SPAWN[0]);
    player.y = cellCenter(PLAYER_SPAWN[1]);
    player.dir = 'up';
    player.dirWanted = null;
    player.alive = true;
    player.respawn = 0;
    player.invuln = SPAWN_INVULN;
    refreshDir();
}

// ---------------------------------------------------------------------------
// Enemy AI
// ---------------------------------------------------------------------------

function chooseDir(e) {
    if (rand() < 0.45) {
        const target = (player.alive && rand() < 0.4)
            ? player
            : { x: cellCenter(base.cx), y: cellCenter(base.cy) };
        const dx = target.x - e.x, dy = target.y - e.y;
        if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
        return dy > 0 ? 'down' : 'up';
    }
    return DIRS[Math.floor(rand() * 4) % 4];
}

function updateEnemy(e, d) {
    e.think -= d;
    if (e.think <= 0) {
        e.dirWanted = chooseDir(e);
        e.think = 0.5 + rand() * 0.9;
    }
    const moved = tryMove(e, e.dirWanted, enemySpeed() * d);
    if (moved) {
        e.stuck = 0;
    } else {
        e.stuck += d;
        if (e.stuck > 0.18) {
            e.dirWanted = chooseDir(e);
            e.stuck = 0;
        }
    }

    e.fireTimer -= d;
    if (e.fireTimer <= 0) {
        e.fireTimer = fire(e)
            ? enemyFireInterval() * (0.6 + rand() * 0.8)
            : 0.1;
    }
}

function spawnEnemy(opts) {
    opts = opts || {};
    const point = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
    const cx = opts.cx != null ? opts.cx : point[0];
    const cy = opts.cy != null ? opts.cy : point[1];
    const e = {
        x: cellCenter(cx), y: cellCenter(cy),
        dir: 'down', dirWanted: 'down', alive: true,
        think: 0.2 + rand() * 0.5,
        fireTimer: 0.5 + rand() * enemyFireInterval(),
        stuck: 0,
        flash: 0.6,
    };
    enemies.push(e);
    enemiesToSpawn = Math.max(0, enemiesToSpawn - 1);
    updateHud();
    return e;
}

function updateSpawns(d) {
    if (enemiesToSpawn <= 0) return;
    spawnTimer -= d;
    if (spawnTimer > 0) return;
    if (enemies.length >= maxActive()) {
        spawnTimer = 0.3;
        return;
    }
    const point = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
    spawnIndex++;
    if (!canOccupy(cellCenter(point[0]), cellCenter(point[1]), null)) {
        spawnTimer = 0.3;
        return;
    }
    spawnEnemy({ cx: point[0], cy: point[1] });
    spawnTimer = SPAWN_INTERVAL;
}

// ---------------------------------------------------------------------------
// Particles (purely cosmetic)
// ---------------------------------------------------------------------------

function pushParticle(x, y, speed, color, life) {
    const a = rand() * Math.PI * 2;
    const s = speed * (0.4 + rand() * 0.8);
    particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life, max: life, color,
    });
}

function boom(x, y, color) {
    for (let i = 0; i < 18; i++) pushParticle(x, y, 130, color, 0.35 + rand() * 0.3);
}

function sparks(x, y, color, n) {
    for (let i = 0; i < n; i++) pushParticle(x, y, 90, color, 0.15 + rand() * 0.15);
}

function updateParticles(d) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * d;
        p.y += p.vy * d;
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.life -= d;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function updatePlayer(d) {
    if (!player.alive) {
        if (lives > 0) {
            player.respawn -= d;
            if (player.respawn <= 0) respawnPlayer();
        }
        return;
    }
    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - d);
    if (player.fireCooldown > 0) player.fireCooldown = Math.max(0, player.fireCooldown - d);
    if (player.dirWanted) tryMove(player, player.dirWanted, PLAYER_SPEED * d);
}

function substep(d) {
    updatePlayer(d);
    for (const e of enemies.slice()) {
        if (e.alive) {
            if (e.flash > 0) e.flash = Math.max(0, e.flash - d);
            updateEnemy(e, d);
        }
    }
    updateBullets(d);
    updateSpawns(d);
    updateParticles(d);
}

function step(dt) {
    if (state !== 'running') return;
    let remaining = dt;
    while (remaining > 1e-9 && state === 'running') {
        const d = Math.min(remaining, 1 / 120);
        substep(d);
        remaining -= d;
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function resetLevel() {
    buildLevel(level);
    enemies.length = 0;
    bullets.length = 0;
    particles.length = 0;
    base.alive = true;
    enemiesLeft = enemiesForLevel();
    enemiesToSpawn = enemiesForLevel();
    spawnTimer = FIRST_SPAWN_DELAY;
    spawnIndex = 0;
    respawnPlayer();
    updateHud();
}

function nextLevel() {
    level += 1;
    resetLevel();
}

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    state = 'running';
    heldKeys.clear();
    resetLevel();
    hideOverlay();
    updateHud();
}

function endGame(title) {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('tankbattle-best', String(best)); } catch (err) { /* ignore */ }
    }
    updateHud();
    showOverlay(title || 'GAME OVER', `Score ${score} — Level ${level}`, 'Press Space to fight again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    enemiesEl.textContent = String(enemiesLeft);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText || '';
    overlaySub.textContent = sub || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawBrick(px, py) {
    ctx.fillStyle = '#7a3f28';                       // mortar
    ctx.fillRect(px, py, CELL, CELL);
    ctx.fillStyle = '#a85c3a';                       // brick faces
    for (let r = 0; r < 4; r++) {
        // every other course is offset by half a brick; the courses that run off
        // the edge are clipped back to the cell so tiles stay square
        const ox = (r % 2 === 0) ? 0 : -CELL / 4;
        for (let c = -1; c < 3; c++) {
            const bx = px + ox + c * (CELL / 2) + 1;
            const left = Math.max(bx, px + 1);
            const right = Math.min(bx + CELL / 2 - 2, px + CELL - 1);
            if (right > left) ctx.fillRect(left, py + r * 8 + 1, right - left, 6);
        }
    }
}

function drawSteel(px, py) {
    ctx.fillStyle = '#9aa7b4';
    ctx.fillRect(px, py, CELL, CELL);
    ctx.fillStyle = '#c6d2de';
    ctx.fillRect(px + 2, py + 2, CELL / 2 - 3, CELL / 2 - 3);
    ctx.fillRect(px + CELL / 2 + 1, py + CELL / 2 + 1, CELL / 2 - 3, CELL / 2 - 3);
    ctx.fillStyle = '#6f7d8b';
    ctx.fillRect(px + CELL / 2 + 1, py + 2, CELL / 2 - 3, CELL / 2 - 3);
    ctx.fillRect(px + 2, py + CELL / 2 + 1, CELL / 2 - 3, CELL / 2 - 3);
}

function drawBase() {
    const px = base.cx * CELL, py = base.cy * CELL;
    if (base.alive) {
        ctx.fillStyle = '#1d2b21';
        ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
        ctx.fillStyle = '#e8d36a';
        // stylised eagle: body, spread wings, tail
        ctx.beginPath();
        ctx.moveTo(px + 16, py + 5);
        ctx.lineTo(px + 24, py + 13);
        ctx.lineTo(px + 21, py + 13);
        ctx.lineTo(px + 26, py + 24);
        ctx.lineTo(px + 16, py + 20);
        ctx.lineTo(px + 6, py + 24);
        ctx.lineTo(px + 11, py + 13);
        ctx.lineTo(px + 8, py + 13);
        ctx.closePath();
        ctx.fill();
    } else {
        ctx.fillStyle = '#3a2a1e';
        ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
        ctx.fillStyle = '#77644f';
        ctx.fillRect(px + 5, py + 18, 9, 8);
        ctx.fillRect(px + 17, py + 14, 10, 12);
        ctx.fillRect(px + 10, py + 8, 7, 6);
    }
}

function drawTank(t, body, tread, barrel) {
    const x = t.x, y = t.y, h = TANK_HALF;

    ctx.save();
    ctx.translate(x, y);
    const angle = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[t.dir] || 0;
    ctx.rotate(angle);

    // treads
    ctx.fillStyle = tread;
    ctx.fillRect(-h, -h, 7, 2 * h);
    ctx.fillRect(h - 7, -h, 7, 2 * h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = -h + 2; i < h - 2; i += 5) {
        ctx.fillRect(-h, i, 7, 2);
        ctx.fillRect(h - 7, i, 7, 2);
    }

    // hull + turret
    ctx.fillStyle = body;
    ctx.fillRect(-h + 6, -h + 3, 2 * h - 12, 2 * h - 6);
    ctx.fillStyle = barrel;
    ctx.fillRect(-3, -h - 2, 6, 12);
    ctx.beginPath();
    ctx.arc(0, 2, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function draw() {
    // ground
    ctx.fillStyle = '#0a0f0c';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.strokeStyle = 'rgba(120, 160, 130, 0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
        ctx.beginPath();
        ctx.moveTo(i * CELL + 0.5, 0);
        ctx.lineTo(i * CELL + 0.5, CANVAS_H);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * CELL + 0.5);
        ctx.lineTo(CANVAS_W, i * CELL + 0.5);
        ctx.stroke();
    }

    // terrain
    for (let cy = 0; cy < ROWS; cy++) {
        for (let cx = 0; cx < COLS; cx++) {
            const t = grid[cy][cx];
            if (t === T_BRICK) drawBrick(cx * CELL, cy * CELL);
            else if (t === T_STEEL) drawSteel(cx * CELL, cy * CELL);
        }
    }

    drawBase();

    // tanks
    for (const e of enemies) {
        drawTank(e, e.flash > 0 && Math.floor(e.flash * 12) % 2 === 0 ? '#f4f8ff' : '#7f8fa6', '#4a5566', '#c7d3e4');
    }
    if (player.alive) {
        const shielded = player.invuln > 0 && Math.floor(player.invuln * 10) % 2 === 0;
        drawTank(player, shielded ? '#f7f3c0' : '#c8d63f', '#5a6b22', '#eef3b0');
        if (player.invuln > 0) {
            ctx.strokeStyle = 'rgba(200, 214, 63, 0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(player.x, player.y, TANK_HALF + 4, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // shells
    for (const b of bullets) {
        ctx.fillStyle = b.owner === 'player' ? '#fdfbdc' : '#ffb4a2';
        ctx.fillRect(b.x - BULLET_R, b.y - BULLET_R, BULLET_R * 2, BULLET_R * 2);
    }

    // particles
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function refreshDir() {
    const held = [...heldKeys];
    player.dirWanted = held.length ? held[held.length - 1] : null;
}

window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') fire(player);
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        togglePause();
        return;
    }
    const dir = KEYDIR[e.key];
    if (dir) {
        e.preventDefault();
        heldKeys.delete(dir);
        heldKeys.add(dir);
        refreshDir();
    }
});

window.addEventListener('keyup', (e) => {
    const dir = KEYDIR[e.key];
    if (dir) {
        heldKeys.delete(dir);
        refreshDir();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastT = 0;

function frame(t) {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
    lastT = t;
    if (state === 'running') step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('tankbattle-best') || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
enemiesLeft = 0;
enemiesToSpawn = 0;
spawnTimer = FIRST_SPAWN_DELAY;
spawnIndex = 0;
buildLevel(1);
player.x = cellCenter(PLAYER_SPAWN[0]);
player.y = cellCenter(PLAYER_SPAWN[1]);
updateHud();
requestAnimationFrame(frame);
