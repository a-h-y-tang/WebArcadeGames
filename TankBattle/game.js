// Tank Battle — a destructible-maze tank shooter.
//
// The whole simulation lives in step(dt) and never reads the wall clock, so a
// test can advance the world an exact number of frames. draw() is separate and
// purely cosmetic.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TILE = 28;
const COLS = 20;
const ROWS = 20;
const W = COLS * TILE;
const H = ROWS * TILE;

const T_EMPTY = 0;
const T_BRICK = 1;
const T_STEEL = 2;
const T_WATER = 3;
const T_FOREST = 4;
const T_BASE = 5;

const BASE_COL = 9;
const BASE_ROW = 19;
// The base's own row is walled with steel, so it can only ever be reached from
// above — one approach to defend instead of three, and no more losing a run to
// a stray shot of your own down the bottom lane. The brick above it is two
// layers deep: three hits down column 9 to reach the base, which is enough time
// to notice and intercept.
const FORTRESS = [[8, 17], [9, 17], [10, 17], [8, 18], [9, 18], [10, 18]];
const FORTRESS_FLANK = [[8, 19], [10, 19]];
const PLAYER_SPAWN = { col: 6, row: 19 };
const ENEMY_SPAWNS = [{ col: 0, row: 0 }, { col: 9, row: 0 }, { col: 19, row: 0 }];

const START_LIVES = 3;
const MAX_ALIVE = 4;
const FIRST_SPAWN = 2;
const SPAWN_INTERVAL = 3;
const SPAWN_RETRY = 0.5;
const RESPAWN_DELAY = 1.2;
const RESPAWN_SHIELD = 3;
const SHIELD_TIME = 10;
const SHOVEL_TIME = 15;
const POWERUP_LIFE = 15;
const POWERUP_SCORE = 500;
const LEVEL_BONUS = 200;
const LEVEL_CLEAR_TIME = 2.5;

const PLAYER_SPEED = 105;
const BULLET = 6;
const PLAYER_BULLET_SPEED = 260;
const PLAYER_BULLET_SPEED_UP = 340;

const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
};

const ENEMY_TYPES = {
    basic: { speed: 70, hp: 1, points: 100, bulletSpeed: 210, color: '#9fb4c7' },
    fast: { speed: 128, hp: 1, points: 200, bulletSpeed: 210, color: '#7fe3c0' },
    power: { speed: 78, hp: 1, points: 300, bulletSpeed: 330, color: '#f2c14e' },
    armor: { speed: 68, hp: 4, points: 400, bulletSpeed: 230, color: '#e0736b' },
};

const POWERUP_TYPES = ['star', 'shield', 'bomb', 'life', 'shovel'];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';           // idle | playing | paused | levelclear | gameover
let grid = [];
let player = null;
let enemies = [];
let bullets = [];
let powerups = [];
let explosions = [];

let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let baseAlive = true;

let roster = [];
let toSpawn = 0;
let spawnIndex = 0;
let spawnTimer = FIRST_SPAWN;
let respawnTimer = 0;
let shovelTimer = 0;
let clearTimer = 0;
let animTime = 0;
let nextId = 1;

// Test hooks — see DESIGN.md.
let autoLoop = true;          // let requestAnimationFrame drive step()
let spawnEnabled = true;      // let the wave spawner run

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) — a fixed seed reproduces a whole run
// ---------------------------------------------------------------------------

let rngState = 1;

function setSeed(n) {
    rngState = (n >>> 0) || 1;
}

function rnd() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const rndInt = (n) => Math.floor(rnd() * n);
const pick = (arr) => arr[rndInt(arr.length)];

// ---------------------------------------------------------------------------
// The tile map
// ---------------------------------------------------------------------------

// Lanes are forced empty, which is what guarantees every level is connected:
// open avenues every four tiles plus the far row and column.
function isLane(col, row) {
    return col % 4 === 0 || row % 4 === 0 || col === COLS - 1 || row === ROWS - 1;
}

function tileAt(col, row) {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return T_STEEL;
    return grid[row][col];
}

function setTile(col, row, value) {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return;
    grid[row][col] = value;
}

const blocksTank = (t) => t === T_BRICK || t === T_STEEL || t === T_WATER || t === T_BASE;
const blocksBullet = (t) => t === T_BRICK || t === T_STEEL || t === T_BASE;

function randomTile() {
    const steel = 0.07 + Math.min(0.08, (level - 1) * 0.01);
    const x = rnd();
    if (x < 0.42) return T_EMPTY;
    if (x < 0.80) return T_BRICK;
    if (x < 0.80 + steel) return T_STEEL;
    if (x < 0.87 + steel) return T_WATER;
    return T_FOREST;
}

function buildLevel() {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) row.push(isLane(c, r) ? T_EMPTY : randomTile());
        grid.push(row);
    }

    // Keep the spawn points and the ground in front of them clear.
    for (const s of ENEMY_SPAWNS) {
        setTile(s.col, s.row, T_EMPTY);
        setTile(s.col, s.row + 1, T_EMPTY);
    }
    setTile(PLAYER_SPAWN.col, PLAYER_SPAWN.row, T_EMPTY);
    setTile(PLAYER_SPAWN.col, PLAYER_SPAWN.row - 1, T_EMPTY);

    // The fortress: a clear pocket, a ring of brick, the base in the middle.
    for (let r = 17; r <= 19; r++) {
        for (let c = 8; c <= 10; c++) setTile(c, r, T_EMPTY);
    }
    for (const [c, r] of FORTRESS) setTile(c, r, T_BRICK);
    for (const [c, r] of FORTRESS_FLANK) setTile(c, r, T_STEEL);
    setTile(BASE_COL, BASE_ROW, T_BASE);
}

function setFortress(tile) {
    for (const [c, r] of FORTRESS) {
        const cur = tileAt(c, r);
        if (cur === T_BRICK || cur === T_STEEL || cur === T_EMPTY) setTile(c, r, tile);
    }
}

// ---------------------------------------------------------------------------
// Tanks
// ---------------------------------------------------------------------------

function makeTank(side, type, col, row) {
    const def = side === 'player'
        ? { speed: PLAYER_SPEED, hp: 1, bulletSpeed: PLAYER_BULLET_SPEED }
        : ENEMY_TYPES[type];
    return {
        id: nextId++,
        side,
        type,
        x: col * TILE,
        y: row * TILE,
        dir: side === 'player' ? 'up' : 'down',
        speed: def.speed,
        hp: def.hp,
        maxHp: def.hp,
        bulletSpeed: def.bulletSpeed,
        alive: true,
        moving: false,
        shield: 0,
        power: 1,
        bonus: false,
        thinkTimer: 0,
        fireTimer: 0,
        hitFlash: 0,
    };
}

function placeTank(tank, col, row) {
    tank.x = col * TILE;
    tank.y = row * TILE;
}

function liveTanks() {
    return player && player.alive ? [player, ...enemies] : enemies;
}

function overlaps(ax, ay, bx, by) {
    const e = 0.01;
    return ax + TILE - e > bx && ax + e < bx + TILE && ay + TILE - e > by && ay + e < by + TILE;
}

// Would a TILE-sized box at (x, y) be legal, ignoring one tank?
function rectFree(x, y, ignore) {
    if (x < -0.01 || y < -0.01 || x + TILE > W + 0.01 || y + TILE > H + 0.01) return false;
    const c0 = Math.floor((x + 0.01) / TILE);
    const c1 = Math.floor((x + TILE - 0.01) / TILE);
    const r0 = Math.floor((y + 0.01) / TILE);
    const r1 = Math.floor((y + TILE - 0.01) / TILE);
    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) if (blocksTank(tileAt(c, r))) return false;
    }
    for (const t of liveTanks()) {
        if (t === ignore) continue;
        if (overlaps(x, y, t.x, t.y)) return false;
    }
    return true;
}

// Turning onto the perpendicular axis rounds the off-axis coordinate onto the
// grid, so one-tile corridors don't demand pixel-perfect driving. A tank
// mid-move legally occupies both cells it straddles, so the snap is safe.
function setDir(tank, dir) {
    if (tank.dir === dir) return;
    const from = DIRS[tank.dir];
    const to = DIRS[dir];
    if (from.x !== 0 && to.y !== 0) {
        const nx = Math.round(tank.x / TILE) * TILE;
        if (rectFree(nx, tank.y, tank)) tank.x = nx;
    } else if (from.y !== 0 && to.x !== 0) {
        const ny = Math.round(tank.y / TILE) * TILE;
        if (rectFree(tank.x, ny, tank)) tank.y = ny;
    }
    tank.dir = dir;
}

// Returns true if the tank actually advanced. On a collision it is pushed flush
// against the obstacle rather than left a fraction of a pixel short.
function moveTank(tank, dt) {
    const d = DIRS[tank.dir];
    const dist = tank.speed * dt;
    const nx = tank.x + d.x * dist;
    const ny = tank.y + d.y * dist;
    if (rectFree(nx, ny, tank)) {
        tank.x = nx;
        tank.y = ny;
        return dist > 0;
    }
    if (d.x > 0) {
        const sx = Math.ceil(tank.x / TILE) * TILE;
        if (sx !== tank.x && rectFree(sx, tank.y, tank)) tank.x = sx;
    } else if (d.x < 0) {
        const sx = Math.floor(tank.x / TILE) * TILE;
        if (sx !== tank.x && rectFree(sx, tank.y, tank)) tank.x = sx;
    } else if (d.y > 0) {
        const sy = Math.ceil(tank.y / TILE) * TILE;
        if (sy !== tank.y && rectFree(tank.x, sy, tank)) tank.y = sy;
    } else if (d.y < 0) {
        const sy = Math.floor(tank.y / TILE) * TILE;
        if (sy !== tank.y && rectFree(tank.x, sy, tank)) tank.y = sy;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Bullets
// ---------------------------------------------------------------------------

function bulletsOf(tank) {
    let n = 0;
    for (const b of bullets) if (b.ownerId === tank.id) n++;
    return n;
}

function fireBullet(tank) {
    if (!tank.alive) return null;
    const max = tank.side === 'player' && tank.power >= 2 ? 2 : 1;
    if (bulletsOf(tank) >= max) return null;

    const d = DIRS[tank.dir];
    const cx = tank.x + TILE / 2 + d.x * (TILE / 2);
    const cy = tank.y + TILE / 2 + d.y * (TILE / 2);
    const speed = tank.side === 'player'
        ? (tank.power >= 2 ? PLAYER_BULLET_SPEED_UP : PLAYER_BULLET_SPEED)
        : tank.bulletSpeed;
    const bullet = {
        x: cx - BULLET / 2,
        y: cy - BULLET / 2,
        dir: tank.dir,
        speed,
        side: tank.side,
        ownerId: tank.id,
        power: tank.side === 'player' ? tank.power : 1,
        dead: false,
    };
    bullets.push(bullet);
    return bullet;
}

const bulletCx = (b) => b.x + BULLET / 2;
const bulletCy = (b) => b.y + BULLET / 2;

// One sub-step of travel; returns true when the bullet is spent.
function resolveBullet(b) {
    const cx = bulletCx(b);
    const cy = bulletCy(b);
    if (cx < 0 || cy < 0 || cx > W || cy > H) {
        spark(cx, cy);
        return true;
    }

    const col = Math.floor(cx / TILE);
    const row = Math.floor(cy / TILE);
    const tile = tileAt(col, row);
    if (tile === T_BASE) {
        destroyBase();
        return true;
    }
    if (tile === T_BRICK) {
        setTile(col, row, T_EMPTY);
        spark(cx, cy);
        return true;
    }
    if (tile === T_STEEL) {
        if (b.power >= 3) setTile(col, row, T_EMPTY);
        spark(cx, cy);
        return true;
    }

    for (const t of liveTanks()) {
        if (t.id === b.ownerId) continue;
        if (b.side === 'enemy' && t.side === 'enemy') continue;  // friendly fire is off
        if (cx < t.x || cx > t.x + TILE || cy < t.y || cy > t.y + TILE) continue;
        if (t.side === 'enemy') hitEnemy(t);
        else hitPlayer();
        return true;
    }
    return false;
}

function updateBullets(dt) {
    for (const b of bullets) {
        let remaining = b.speed * dt;
        const d = DIRS[b.dir];
        while (remaining > 0 && !b.dead) {
            // Never travel more than half a tile between checks, so a bullet
            // cannot skip over a wall however large dt or the speed is.
            const hop = Math.min(remaining, TILE / 2);
            remaining -= hop;
            b.x += d.x * hop;
            b.y += d.y * hop;
            if (resolveBullet(b)) b.dead = true;
        }
    }

    // Opposing shots cancel. The window is half a tile because two bullets
    // closing at ~8 px a frame can otherwise slip past each other.
    for (let i = 0; i < bullets.length; i++) {
        for (let j = i + 1; j < bullets.length; j++) {
            const a = bullets[i];
            const b = bullets[j];
            if (a.dead || b.dead || a.side === b.side) continue;
            if (Math.abs(bulletCx(a) - bulletCx(b)) < TILE / 2 &&
                Math.abs(bulletCy(a) - bulletCy(b)) < TILE / 2) {
                a.dead = true;
                b.dead = true;
                spark(bulletCx(a), bulletCy(a));
            }
        }
    }

    bullets = bullets.filter((b) => !b.dead);
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

function hitEnemy(enemy) {
    enemy.hp--;
    enemy.hitFlash = 0.15;
    if (enemy.hp > 0) {
        spark(enemy.x + TILE / 2, enemy.y + TILE / 2);
        return;
    }
    killEnemy(enemy, true);
}

function killEnemy(enemy, drop) {
    const idx = enemies.indexOf(enemy);
    if (idx >= 0) enemies.splice(idx, 1);
    score += ENEMY_TYPES[enemy.type].points;
    boom(enemy.x + TILE / 2, enemy.y + TILE / 2);
    if (drop && enemy.bonus) dropPowerup();
}

function hitPlayer() {
    if (!player.alive) return;
    if (player.shield > 0) {
        spark(player.x + TILE / 2, player.y + TILE / 2);
        return;
    }
    player.alive = false;
    player.moving = false;
    boom(player.x + TILE / 2, player.y + TILE / 2);
    lives--;
    if (lives <= 0) {
        lives = 0;
        gameOver('GAME OVER');
    } else {
        respawnTimer = RESPAWN_DELAY;
    }
}

function destroyBase() {
    if (!baseAlive) return;
    baseAlive = false;
    setTile(BASE_COL, BASE_ROW, T_EMPTY);
    boom(BASE_COL * TILE + TILE / 2, BASE_ROW * TILE + TILE / 2);
    gameOver('BASE DESTROYED');
}

function respawnPlayer(full) {
    placeTank(player, PLAYER_SPAWN.col, PLAYER_SPAWN.row);
    player.dir = 'up';
    player.alive = true;
    player.moving = false;
    player.power = 1;
    player.shield = RESPAWN_SHIELD;
    if (full) player.hp = 1;
    respawnTimer = 0;
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemy(type, col, row) {
    const enemy = makeTank('enemy', type, col, row);
    enemy.bonus = spawnIndex % 4 === 3;
    // Tanks don't fire the instant they materialise.
    enemy.fireTimer = 0.9 + rnd() * 1.2;
    enemy.thinkTimer = 0.3 + rnd() * 0.8;
    enemies.push(enemy);
    if (toSpawn > 0) toSpawn--;
    return enemy;
}

function canStep(tank, dir) {
    const d = DIRS[dir];
    return rectFree(tank.x + d.x * 2, tank.y + d.y * 2, tank);
}

function chooseDirection(enemy) {
    const options = Object.keys(DIRS).filter((d) => canStep(enemy, d));
    if (!options.length) return;

    // Mostly hunt the player; a minority of decisions push for the base. Any
    // more than this and a wave swarms the fortress before it can be cleared.
    if (rnd() < 0.55) {
        const target = rnd() < 0.3
            ? { x: BASE_COL * TILE, y: BASE_ROW * TILE }
            : { x: player.x, y: player.y };
        const want = [];
        if (target.y < enemy.y - 2) want.push('up');
        else if (target.y > enemy.y + 2) want.push('down');
        if (target.x < enemy.x - 2) want.push('left');
        else if (target.x > enemy.x + 2) want.push('right');
        const good = want.filter((d) => options.includes(d));
        if (good.length) {
            setDir(enemy, pick(good));
            return;
        }
    }
    setDir(enemy, pick(options));
}

function updateEnemy(enemy, dt) {
    enemy.thinkTimer -= dt;
    enemy.fireTimer -= dt;
    if (enemy.hitFlash > 0) enemy.hitFlash -= dt;

    const moved = moveTank(enemy, dt);
    if (!moved || enemy.thinkTimer <= 0) {
        chooseDirection(enemy);
        enemy.thinkTimer = 0.5 + rnd() * 1.2;
    }
    if (enemy.fireTimer <= 0) {
        fireBullet(enemy);
        enemy.fireTimer = 1 + rnd() * 1.6;
    }
}

function buildRoster(lvl) {
    const total = 10 + (lvl - 1) * 2;
    const out = [];
    for (let i = 0; i < total; i++) {
        const x = rnd() + Math.min(0.35, (lvl - 1) * 0.05);
        if (x < 0.45) out.push('basic');
        else if (x < 0.68) out.push('fast');
        else if (x < 0.86) out.push('power');
        else out.push('armor');
    }
    return out;
}

function updateSpawns(dt) {
    if (!spawnEnabled || toSpawn <= 0) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    if (enemies.length >= MAX_ALIVE) {
        spawnTimer = SPAWN_RETRY;
        return;
    }
    const spot = ENEMY_SPAWNS[spawnIndex % ENEMY_SPAWNS.length];
    if (!rectFree(spot.col * TILE, spot.row * TILE, null)) {
        spawnTimer = SPAWN_RETRY;
        return;
    }
    spawnEnemy(roster[spawnIndex % roster.length] || 'basic', spot.col, spot.row);
    spawnIndex++;
    spawnTimer = SPAWN_INTERVAL;
}

const enemiesRemaining = () => toSpawn + enemies.length;

// ---------------------------------------------------------------------------
// Power-ups
// ---------------------------------------------------------------------------

function spawnPowerup(type, col, row) {
    const p = { type, col, row, x: col * TILE, y: row * TILE, life: POWERUP_LIFE };
    powerups.push(p);
    return p;
}

function dropPowerup() {
    for (let tries = 0; tries < 60; tries++) {
        const col = rndInt(COLS);
        const row = rndInt(ROWS);
        if (tileAt(col, row) !== T_EMPTY) continue;
        if (col >= 8 && col <= 10 && row >= 17) continue;  // not inside the fortress
        return spawnPowerup(pick(POWERUP_TYPES), col, row);
    }
    return spawnPowerup(pick(POWERUP_TYPES), PLAYER_SPAWN.col, 0);
}

function collectPowerup(p) {
    score += POWERUP_SCORE;
    switch (p.type) {
        case 'star':
            player.power = Math.min(3, player.power + 1);
            break;
        case 'shield':
            player.shield = SHIELD_TIME;
            break;
        case 'life':
            lives++;
            break;
        case 'bomb':
            for (const enemy of [...enemies]) killEnemy(enemy, false);
            break;
        case 'shovel':
            shovelTimer = SHOVEL_TIME;
            setFortress(T_STEEL);
            break;
    }
}

function updatePowerups(dt) {
    for (let i = powerups.length - 1; i >= 0; i--) {
        const p = powerups[i];
        p.life -= dt;
        if (p.life <= 0) {
            powerups.splice(i, 1);
            continue;
        }
        if (player.alive && overlaps(player.x, player.y, p.x, p.y)) {
            powerups.splice(i, 1);
            collectPowerup(p);
        }
    }

    if (shovelTimer > 0) {
        shovelTimer -= dt;
        if (shovelTimer <= 0) {
            shovelTimer = 0;
            setFortress(T_BRICK);
        }
    }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function boom(x, y) {
    explosions.push({ x, y, t: 0, dur: 0.45, size: TILE });
}

function spark(x, y) {
    explosions.push({ x, y, t: 0, dur: 0.18, size: TILE * 0.5 });
}

function updateExplosions(dt) {
    for (let i = explosions.length - 1; i >= 0; i--) {
        explosions[i].t += dt;
        if (explosions[i].t >= explosions[i].dur) explosions.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const KEY_DIRS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
};

let held = [];

// The most recently pressed direction wins, so rolling from one key to the next
// turns cleanly without a dead frame.
function heldDir() {
    return held.length ? held[held.length - 1] : null;
}

function updatePlayer(dt) {
    if (!player.alive) {
        if (respawnTimer > 0) {
            respawnTimer -= dt;
            if (respawnTimer <= 0) respawnPlayer(true);
        }
        return;
    }
    if (player.shield > 0) player.shield = Math.max(0, player.shield - dt);

    const dir = heldDir();
    if (dir) {
        setDir(player, dir);
        player.moving = true;
        moveTank(player, dt);
    } else {
        player.moving = false;
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function newLevel() {
    buildLevel();
    enemies = [];
    bullets = [];
    powerups = [];
    explosions = [];
    roster = buildRoster(level);
    toSpawn = roster.length;
    spawnIndex = 0;
    spawnTimer = FIRST_SPAWN;
    shovelTimer = 0;
    clearTimer = 0;
    baseAlive = true;
    player = makeTank('player', 'player', PLAYER_SPAWN.col, PLAYER_SPAWN.row);
    respawnPlayer(true);
    updateHud();
}

function startGame(seed) {
    setSeed(seed === undefined ? Math.floor(Math.random() * 1e9) + 1 : seed);
    score = 0;
    lives = START_LIVES;
    level = 1;
    spawnEnabled = true;
    held = [];
    newLevel();
    state = 'playing';
    hideOverlay();
    updateHud();
}

function levelClear() {
    score += LEVEL_BONUS * level;
    state = 'levelclear';
    clearTimer = LEVEL_CLEAR_TIME;
    showOverlay(`LEVEL ${level} CLEAR`, `Score ${score}`, 'Next level starting…');
    updateHud();
}

function nextLevel() {
    level++;
    newLevel();
    state = 'playing';
    hideOverlay();
    updateHud();
}

function gameOver(title) {
    state = 'gameover';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('tankbattle-best', String(best));
        } catch (err) {
            /* storage unavailable — keep the in-memory best */
        }
    }
    showOverlay(title, `Score ${score} · Best ${best}`, 'Press Space to play again');
    updateHud();
}

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'playing';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'levelclear') {
        clearTimer -= dt;
        animTime += dt;
        if (clearTimer <= 0) nextLevel();
        updateHud();
        return;
    }
    if (state !== 'playing') {
        updateHud();
        return;
    }

    animTime += dt;
    updatePlayer(dt);
    for (const enemy of [...enemies]) updateEnemy(enemy, dt);
    updateBullets(dt);
    updatePowerups(dt);
    updateExplosions(dt);
    updateSpawns(dt);

    if (state === 'playing' && toSpawn === 0 && enemies.length === 0) levelClear();
    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function drawBrick(x, y) {
    ctx.fillStyle = '#8c4a30';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#a85c3c';
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 2; col++) {
            const offset = row % 2 === 0 ? 0 : TILE / 4;
            ctx.fillRect(x + offset + col * (TILE / 2) + 1, y + row * (TILE / 4) + 1, TILE / 2 - 2, TILE / 4 - 2);
        }
    }
}

function drawSteel(x, y) {
    ctx.fillStyle = '#6d7c86';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#95a6b1';
    ctx.fillRect(x + 2, y + 2, TILE / 2 - 3, TILE / 2 - 3);
    ctx.fillRect(x + TILE / 2 + 1, y + TILE / 2 + 1, TILE / 2 - 3, TILE / 2 - 3);
    ctx.fillStyle = '#4d5a63';
    ctx.fillRect(x + TILE / 2 + 1, y + 2, TILE / 2 - 3, TILE / 2 - 3);
    ctx.fillRect(x + 2, y + TILE / 2 + 1, TILE / 2 - 3, TILE / 2 - 3);
}

function drawWater(x, y) {
    ctx.fillStyle = '#1b4c78';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = '#3d84c0';
    ctx.lineWidth = 2;
    const phase = Math.sin(animTime * 2.4 + (x + y) * 0.05) * 3;
    for (let i = 1; i <= 2; i++) {
        const wy = y + i * (TILE / 3);
        ctx.beginPath();
        ctx.moveTo(x + 3, wy);
        ctx.quadraticCurveTo(x + TILE / 2, wy + phase, x + TILE - 3, wy);
        ctx.stroke();
    }
}

function drawForest(x, y) {
    ctx.fillStyle = '#1f5c2b';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#2c7d3a';
    for (const [dx, dy] of [[7, 7], [20, 9], [12, 19], [22, 21]]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 6, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBase(x, y) {
    if (!baseAlive) {
        ctx.fillStyle = '#3a2c22';
        ctx.fillRect(x + 4, y + 10, TILE - 8, TILE - 14);
        ctx.strokeStyle = '#6b3a2c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 6, y + 8);
        ctx.lineTo(x + TILE - 6, y + TILE - 6);
        ctx.moveTo(x + TILE - 6, y + 8);
        ctx.lineTo(x + 6, y + TILE - 6);
        ctx.stroke();
        return;
    }
    ctx.fillStyle = '#d9c05a';
    ctx.beginPath();
    ctx.moveTo(x + TILE / 2, y + 4);
    ctx.lineTo(x + TILE - 4, y + TILE / 2);
    ctx.lineTo(x + TILE / 2, y + TILE - 4);
    ctx.lineTo(x + 4, y + TILE / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8b7420';
    ctx.fillRect(x + TILE / 2 - 2, y + 9, 4, TILE - 18);
}

function drawTank(t) {
    const cx = t.x + TILE / 2;
    const cy = t.y + TILE / 2;
    const body = t.side === 'player'
        ? (t.power >= 3 ? '#e9e26a' : t.power >= 2 ? '#cfe07a' : '#b9d94a')
        : ENEMY_TYPES[t.type].color;

    ctx.save();
    ctx.translate(cx, cy);
    const angle = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[t.dir];
    ctx.rotate(angle);

    // tracks
    ctx.fillStyle = '#2b332c';
    ctx.fillRect(-12, -12, 5, 24);
    ctx.fillRect(7, -12, 5, 24);
    ctx.fillStyle = '#454f45';
    for (let i = -10; i < 12; i += 5) {
        ctx.fillRect(-12, i, 5, 2);
        ctx.fillRect(7, i, 5, 2);
    }

    // hull + turret
    ctx.fillStyle = t.hitFlash > 0 ? '#ffffff' : body;
    ctx.fillRect(-7, -10, 14, 20);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(-7, 2, 14, 8);
    ctx.fillStyle = t.hitFlash > 0 ? '#ffffff' : body;
    ctx.beginPath();
    ctx.arc(0, 1, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#20261f';
    ctx.fillRect(-2, -14, 4, 13);

    if (t.side === 'enemy' && t.maxHp > 1) {
        ctx.fillStyle = '#12100f';
        ctx.fillRect(-7, -12, 14, 3);
        ctx.fillStyle = '#f5e663';
        ctx.fillRect(-7, -12, (14 * t.hp) / t.maxHp, 3);
    }
    ctx.restore();

    if (t.bonus && Math.floor(animTime * 6) % 2 === 0) {
        ctx.strokeStyle = '#ff5f5f';
        ctx.lineWidth = 2;
        ctx.strokeRect(t.x + 1, t.y + 1, TILE - 2, TILE - 2);
    }
    if (t.shield > 0) {
        ctx.strokeStyle = Math.floor(animTime * 12) % 2 === 0 ? '#8fe9ff' : '#d6f7ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, TILE / 2 - 1, 0, Math.PI * 2);
        ctx.stroke();
    }
}

const POWERUP_GLYPH = { star: '★', shield: '⛨', bomb: '✸', life: '♥', shovel: '⛏' };

function drawPowerup(p) {
    if (p.life < 4 && Math.floor(animTime * 8) % 2 === 0) return;
    ctx.fillStyle = '#f2f0e4';
    ctx.fillRect(p.x + 2, p.y + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#c23b3b';
    ctx.fillRect(p.x + 4, p.y + 4, TILE - 8, TILE - 8);
    ctx.fillStyle = '#fff9d8';
    ctx.font = '15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(POWERUP_GLYPH[p.type] || '?', p.x + TILE / 2, p.y + TILE / 2 + 1);
}

function drawExplosion(e) {
    const k = e.t / e.dur;
    const r = e.size * (0.3 + k * 0.7);
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = k < 0.5 ? '#ffd85e' : '#e2673a';
    ctx.beginPath();
    ctx.arc(e.x, e.y, r / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
}

function draw() {
    ctx.fillStyle = '#0a0f0b';
    ctx.fillRect(0, 0, W, H);

    // ground grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
        ctx.beginPath();
        ctx.moveTo(i * TILE + 0.5, 0);
        ctx.lineTo(i * TILE + 0.5, H);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * TILE + 0.5);
        ctx.lineTo(W, i * TILE + 0.5);
        ctx.stroke();
    }

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const tile = grid[r] ? grid[r][c] : T_EMPTY;
            const x = c * TILE;
            const y = r * TILE;
            if (tile === T_BRICK) drawBrick(x, y);
            else if (tile === T_STEEL) drawSteel(x, y);
            else if (tile === T_WATER) drawWater(x, y);
        }
    }

    if (grid.length) drawBase(BASE_COL * TILE, BASE_ROW * TILE);
    for (const p of powerups) drawPowerup(p);
    for (const e of enemies) drawTank(e);
    if (player && player.alive) drawTank(player);

    ctx.fillStyle = '#f6f2c8';
    for (const b of bullets) ctx.fillRect(b.x, b.y, BULLET, BULLET);

    // forest is drawn last so tanks hide underneath it
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if ((grid[r] ? grid[r][c] : T_EMPTY) === T_FOREST) drawForest(c * TILE, r * TILE);
        }
    }

    for (const e of explosions) drawExplosion(e);
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elEnemies = document.getElementById('enemies');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elLives.textContent = String(lives);
    elEnemies.textContent = String(enemiesRemaining());
    elBest.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    overlaySub.textContent = sub || '';
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Game';
    btnStart.style.display = state === 'levelclear' ? 'none' : '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (event) => {
    const key = event.key;

    if (key === 'p' || key === 'P') {
        togglePause();
        event.preventDefault();
        return;
    }

    if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
        event.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else if (state === 'levelclear') nextLevel();
        else if (state === 'playing' && key !== 'Enter') fireBullet(player);
        return;
    }

    const dir = KEY_DIRS[key];
    if (dir) {
        event.preventDefault();
        held = held.filter((d) => d !== dir);
        held.push(dir);
    }
});

window.addEventListener('keyup', (event) => {
    const dir = KEY_DIRS[event.key];
    if (dir) held = held.filter((d) => d !== dir);
});

window.addEventListener('blur', () => { held = []; });

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    if (autoLoop) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

try {
    best = parseInt(localStorage.getItem('tankbattle-best') || '0', 10) || 0;
} catch (err) {
    best = 0;
}

setSeed(Math.floor(Math.random() * 1e9) + 1);
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
buildLevel();
player = makeTank('player', 'player', PLAYER_SPAWN.col, PLAYER_SPAWN.row);
roster = buildRoster(1);
toSpawn = 0;
updateHud();
showOverlay('TANK BATTLE', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
