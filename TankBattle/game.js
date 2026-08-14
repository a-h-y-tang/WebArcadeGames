// ---------------------------------------------------------------------------
// Tank Battle — a top-down arena shooter on an HTML5 canvas.
//
// You drive a single tank around a walled arena built from brick, steel and
// water. Enemy tanks roll in from the top edge and hunt either you or the
// command base tucked into the bottom wall. Brick can be shot away to open new
// lines of fire, steel only yields to an upgraded shell, and water stops tanks
// but not shells. Clear every tank in a wave to advance; lose your last tank or
// your base and the run is over.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Arena ---------------------------------------------------------------
const TILE = 28;
const COLS = 20;
const ROWS = 18;
const CANVAS_W = COLS * TILE;   // 560
const CANVAS_H = ROWS * TILE;   // 504

// Tile legend: '.' open ground, '#' brick, '@' steel, '~' water, 'E' base.
const BRICK = '#', STEEL = '@', WATER = '~', BASE = 'E', OPEN = '.';

// Three hand-laid arenas. Every map keeps the three spawn tiles along the top
// edge and the player's tile at the bottom clear, and every open tile is
// reachable from every other one.
const MAPS = [
    [
        '....................',
        '....................',
        '......@@..##..@@....',
        '......@@..##..@@....',
        '....................',
        '..##..##..##..##..##',
        '..##..##..##..##..##',
        '....................',
        '..##..##..##..##..##',
        '..##..##..##..##..##',
        '....................',
        '..##..##......##..##',
        '..##..##......##..##',
        '...##....@@....##...',
        '...##....@@....##...',
        '........####........',
        '........#EE#........',
        '........#EE#........',
    ],
    [
        '....................',
        '....................',
        '..##..##......##..##',
        '..##..##......##..##',
        '....................',
        '..##......@@......##',
        '..##......@@......##',
        '....................',
        '......##~~~~..##....',
        '......##~~~~..##....',
        '....................',
        '..@@..##......##..@@',
        '..@@..##......##..@@',
        '......##.@@.##......',
        '......##.@@.##......',
        '........####........',
        '........#EE#........',
        '........#EE#........',
    ],
    [
        '....................',
        '....................',
        '..@@..##..##..##..@@',
        '..@@..##..##..##..@@',
        '.........#..........',
        '..##..~~..##..~~..##',
        '..##..~~..##..~~..##',
        '.........#..........',
        '..##..##..##..##..##',
        '..##..##..##..##..##',
        '....................',
        '..##..##..@@..##..##',
        '..##..##..@@..##..##',
        '.##......@@......##.',
        '.##......@@......##.',
        '........####........',
        '........#EE#........',
        '........#EE#........',
    ],
];

const BASE_COL = 9, BASE_ROW = 16;                 // top-left tile of the 2x2 base
const BASE_CENTER = { x: (BASE_COL + 1) * TILE, y: (BASE_ROW + 1) * TILE };
const PLAYER_SPAWN = { col: 6, row: 17 };
const SPAWN_POINTS = [{ col: 0, row: 0 }, { col: 9, row: 0 }, { col: 19, row: 0 }];

// --- Tanks ---------------------------------------------------------------
const TANK = 24;                  // tanks are square and a little inside a tile
const TANK_HALF = TANK / 2;
const PLAYER_SPEED = 96;          // px/s
const SPAWN_FLASH = 0.6;          // inert, untouchable materialising time
const RESPAWN_DELAY = 1.2;
const RESPAWN_SHIELD = 2.5;       // invulnerable seconds after coming back
const LEVEL_SHIELD = 2;

const ENEMY_STATS = {
    basic: { speed: 62, hp: 1, points: 100, body: '#8f9ba3', trim: '#5d6870' },
    fast: { speed: 108, hp: 1, points: 200, body: '#4fc4d8', trim: '#2b7c8c' },
    armor: { speed: 46, hp: 2, points: 300, body: '#c4694b', trim: '#7d3d2a' },
};
const ENEMY_SHOOT_INTERVAL = 0.85;
const ENEMY_SHOOT_CHANCE = 0.25;   // odds of a speculative shot when nothing is lined up
const BASE_HUNT_CHANCE = 0.35;     // odds of heading for the base rather than the player
const ENEMY_TURN_MIN = 0.5, ENEMY_TURN_SPREAD = 1.2;

// --- Shells --------------------------------------------------------------
const BULLET_SPEED = 320;
const POWER_BULLET_SPEED = 400;
const ENEMY_BULLET_SPEED = 220;
const BULLET_R = 3;
const RELOAD = 0.15;
const SHELL_CLASH = 10;           // how close opposing shells must be to cancel

// --- Waves ---------------------------------------------------------------
const FIRST_SPAWN = 0.8;
const LEVEL_BONUS = 500;
const LEVEL_CLEAR_PAUSE = 2;

// --- Power-ups -----------------------------------------------------------
const POWERUP_TYPES = ['shield', 'star', 'life'];
const POWERUP_EVERY = 4;          // one drop per this many tanks destroyed
const POWERUP_LIFE = 14;
const POWERUP_SIZE = 22;
const POWERUP_POINTS = 200;
const SHIELD_TIME = 8;

const BEST_KEY = 'tankbattle-best';

// --- Mutable state -------------------------------------------------------
let state = 'idle';               // idle | playing | paused | levelclear | gameover
let overReason = null;            // 'lives' | 'base'
let score = 0, level = 1, lives = 3, best = 0, kills = 0, dropIndex = 0;
let grid = [];
let base = { alive: true };
let enemies = [], bullets = [], powerups = [], explosions = [];
let enemiesToSpawn = 0, planQueue = [], planIndex = 0, spawnIndex = 0, spawnTimer = 0;
let spawnEnabled = true;
let clearTimer = 0;
let time = 0;
let nextTankId = 1;

const player = {
    id: 0,
    side: 'player',
    x: 0, y: 0,
    dir: { x: 0, y: 0 },
    facing: { x: 0, y: -1 },
    speed: PLAYER_SPEED,
    alive: true,
    invuln: 0,
    star: false,
    reload: 0,
    respawnTimer: 0,
    blocked: false,
    frozen: false,
};

// --- Seeded randomness ---------------------------------------------------
// A small deterministic generator so a spec can pin enemy behaviour with
// setSeed(); the live game seeds itself from the clock at load.
let rngState = 0;

function setSeed(seed) {
    rngState = (seed >>> 0) || 1;
}

function rng() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

setSeed(Date.now() & 0xffffffff);

// --- Grid helpers --------------------------------------------------------
const colOf = (x) => Math.floor(x / TILE);
const rowOf = (y) => Math.floor(y / TILE);
const centerOf = (col, row) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });
const inGrid = (col, row) => col >= 0 && col < COLS && row >= 0 && row < ROWS;
const tileAt = (col, row) => (inGrid(col, row) ? grid[row][col] : STEEL);

function setTile(col, row, ch) {
    if (inGrid(col, row)) grid[row][col] = ch;
}

const blocksTank = (ch) => ch !== OPEN;
const blocksShell = (ch) => ch === BRICK || ch === STEEL || ch === BASE;

// Lane centre for the axis a tank is not travelling along, so turning into a
// corridor lines the tank up with it.
const laneCentre = (v) => Math.round((v - TILE / 2) / TILE) * TILE + TILE / 2;

function approach(value, target, maxDelta) {
    const diff = target - value;
    if (Math.abs(diff) <= maxDelta) return target;
    return value + Math.sign(diff) * maxDelta;
}

function mapForLevel(lv) {
    return MAPS[(lv - 1) % MAPS.length];
}

function enemyPlanForLevel(lv) {
    const total = Math.min(8 + 2 * (lv - 1), 20);
    const plan = [];
    for (let i = 0; i < total; i++) {
        const slot = (i + lv) % 5;
        if (slot === 0 && lv >= 2) plan.push('armor');
        else if (slot === 1 || (slot === 3 && lv >= 3)) plan.push('fast');
        else plan.push('basic');
    }
    return plan;
}

const maxOnFieldForLevel = (lv) => Math.min(4 + Math.floor((lv - 1) / 2), 6);
const spawnIntervalForLevel = (lv) => Math.max(1.2, 3.2 - 0.25 * (lv - 1));

// --- Collision -----------------------------------------------------------
const liveTanks = () => (player.alive ? [player, ...enemies] : enemies.slice());

function tankBlocked(x, y, self) {
    if (x - TANK_HALF < 0 || y - TANK_HALF < 0 || x + TANK_HALF > CANVAS_W || y + TANK_HALF > CANVAS_H) {
        return true;
    }
    const c0 = colOf(x - TANK_HALF + 0.01), c1 = colOf(x + TANK_HALF - 0.01);
    const r0 = rowOf(y - TANK_HALF + 0.01), r1 = rowOf(y + TANK_HALF - 0.01);
    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
            if (blocksTank(tileAt(c, r))) return true;
        }
    }
    for (const other of liveTanks()) {
        if (other === self || other.spawning > 0) continue;
        if (Math.abs(other.x - x) < TANK - 0.5 && Math.abs(other.y - y) < TANK - 0.5) return true;
    }
    return false;
}

// Tanks move in 1px slices so they stop flush against whatever is in the way.
function advanceTank(t, dt) {
    const dir = t.dir;
    if (!dir.x && !dir.y) return;
    const dist = t.speed * dt;
    if (dir.x) t.y = approach(t.y, laneCentre(t.y), dist);
    else t.x = approach(t.x, laneCentre(t.x), dist);

    let moved = 0;
    while (moved < dist - 1e-6) {
        const slice = Math.min(1, dist - moved);
        if (tankBlocked(t.x + dir.x * slice, t.y + dir.y * slice, t)) {
            t.blocked = true;
            return;
        }
        t.x += dir.x * slice;
        t.y += dir.y * slice;
        moved += slice;
    }
}

// --- Tanks ---------------------------------------------------------------
function placePlayer(col, row) {
    const c = centerOf(col === undefined ? PLAYER_SPAWN.col : col, row === undefined ? PLAYER_SPAWN.row : row);
    player.x = c.x;
    player.y = c.y;
    player.dir = { x: 0, y: 0 };
    player.facing = { x: 0, y: -1 };
    player.alive = true;
    player.respawnTimer = 0;
    player.reload = 0;
    player.blocked = false;
}

function spawnEnemy(type, col, row) {
    const stats = ENEMY_STATS[type] || ENEMY_STATS.basic;
    const c = centerOf(col, row);
    const tank = {
        id: nextTankId++,
        side: 'enemy',
        type,
        x: c.x, y: c.y,
        dir: { x: 0, y: 1 },
        facing: { x: 0, y: 1 },
        speed: stats.speed,
        hp: stats.hp,
        maxHp: stats.hp,
        points: stats.points,
        alive: true,
        spawning: SPAWN_FLASH,
        shootTimer: ENEMY_SHOOT_INTERVAL,
        thinkTimer: 0,
        blocked: false,
        frozen: false,
        hitFlash: 0,
    };
    enemies.push(tank);
    return tank;
}

function fireTank(t) {
    if (state !== 'playing') return null;
    if (t.side === 'player' && (!player.alive || player.reload > 0)) return null;
    if (t.side === 'enemy' && t.spawning > 0) return null;
    if (bullets.some((b) => b.ownerId === t.id)) return null;

    const f = t.facing;
    const power = t.side === 'player' && player.star;
    const shell = {
        x: t.x + f.x * (TANK_HALF + 3),
        y: t.y + f.y * (TANK_HALF + 3),
        dx: f.x,
        dy: f.y,
        speed: t.side === 'player' ? (power ? POWER_BULLET_SPEED : BULLET_SPEED) : ENEMY_BULLET_SPEED,
        side: t.side,
        ownerId: t.id,
        power,
        dead: false,
    };
    bullets.push(shell);
    if (t.side === 'player') player.reload = RELOAD;
    return shell;
}

const fire = () => fireTank(player);

function destroyEnemy(enemy) {
    const at = enemies.indexOf(enemy);
    if (at === -1) return;
    enemies.splice(at, 1);
    enemy.alive = false;
    explode(enemy.x, enemy.y, 26);
    score += enemy.points;
    kills += 1;
    maybeDropPowerup();
    updateHud();
}

function killPlayer() {
    if (!player.alive || player.invuln > 0 || state !== 'playing') return;
    player.alive = false;
    player.star = false;
    player.dir = { x: 0, y: 0 };
    explode(player.x, player.y, 30);
    lives -= 1;
    updateHud();
    if (lives <= 0) endGame('lives');
    else player.respawnTimer = RESPAWN_DELAY;
}

function destroyBase() {
    if (!base.alive) return;
    base.alive = false;
    explode(BASE_CENTER.x, BASE_CENTER.y, 44);
    endGame('base');
}

function damageTank(t, power) {
    if (t.side === 'player') {
        killPlayer();
        return;
    }
    if (t.spawning > 0) return;
    t.hp -= power ? 2 : 1;
    t.hitFlash = 0.15;
    if (t.hp <= 0) destroyEnemy(t);
}

// --- Enemy AI ------------------------------------------------------------
const DIRS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

// Probe from the lane centre of the perpendicular axis: a tank that is a pixel
// or two off centre would otherwise think a clear corridor was walled off.
function dirIsOpen(t, d) {
    const x = d.y ? laneCentre(t.x) : t.x;
    const y = d.x ? laneCentre(t.y) : t.y;
    return !tankBlocked(x + d.x * 4, y + d.y * 4, t);
}

function enemyTarget() {
    if (base.alive && (rng() < BASE_HUNT_CHANCE || !player.alive)) return BASE_CENTER;
    if (player.alive) return { x: player.x, y: player.y };
    return BASE_CENTER;
}

function chooseEnemyDir(t) {
    const open = DIRS.filter((d) => dirIsOpen(t, d));
    const pool = open.length ? open : DIRS;
    const target = enemyTarget();
    let choice;
    if (rng() < 0.6) {
        const cost = (d) => Math.hypot(t.x + d.x * TILE - target.x, t.y + d.y * TILE - target.y);
        choice = pool.reduce((bestDir, d) => (cost(d) < cost(bestDir) ? d : bestDir));
    } else {
        choice = pool[Math.floor(rng() * pool.length)];
    }
    t.dir = { x: choice.x, y: choice.y };
    t.facing = { x: choice.x, y: choice.y };
    t.thinkTimer = ENEMY_TURN_MIN + rng() * ENEMY_TURN_SPREAD;
}

function aimedAt(t, tx, ty) {
    if (t.facing.x) {
        return Math.abs(ty - t.y) < TILE * 0.7
            && Math.sign(tx - t.x) === t.facing.x
            && Math.abs(tx - t.x) > 1;
    }
    return Math.abs(tx - t.x) < TILE * 0.7
        && Math.sign(ty - t.y) === t.facing.y
        && Math.abs(ty - t.y) > 1;
}

// Walk tile by tile along the barrel: an aimed shot needs a clear lane. Without
// this a tank sitting on the top edge would shell the base through four rows of
// brick, and no player could ever get there in time.
function clearShot(t, tx, ty, baseTarget) {
    let c = colOf(t.x), r = rowOf(t.y);
    const tc = colOf(tx), tr = rowOf(ty);
    for (let i = 0; i < COLS + ROWS; i++) {
        c += t.facing.x;
        r += t.facing.y;
        if (!inGrid(c, r)) return false;
        if (t.facing.x ? c === tc : r === tr) return true;
        if (baseTarget && tileAt(c, r) === BASE) return true;
        if (blocksShell(tileAt(c, r))) return false;
    }
    return false;
}

function enemyAimed(t) {
    if (base.alive
        && aimedAt(t, BASE_CENTER.x, BASE_CENTER.y)
        && clearShot(t, BASE_CENTER.x, BASE_CENTER.y, true)) {
        return true;
    }
    return player.alive
        && player.invuln <= 0
        && aimedAt(t, player.x, player.y)
        && clearShot(t, player.x, player.y, false);
}

function updateEnemies(dt) {
    for (const t of enemies.slice()) {
        if (t.hitFlash > 0) t.hitFlash -= dt;
        if (t.spawning > 0) {
            t.spawning -= dt;
            continue;
        }
        if (!t.frozen) {
            t.thinkTimer -= dt;
            if (t.blocked || t.thinkTimer <= 0) chooseEnemyDir(t);
            t.blocked = false;
            advanceTank(t, dt);
        }
        t.shootTimer -= dt;
        if (t.shootTimer <= 0) {
            if (enemyAimed(t) || rng() < ENEMY_SHOOT_CHANCE) fireTank(t);
            t.shootTimer = ENEMY_SHOOT_INTERVAL;
        }
    }
}

// --- Shells --------------------------------------------------------------
function resolveShell(b) {
    if (b.x < 0 || b.y < 0 || b.x > CANVAS_W || b.y > CANVAS_H) {
        b.dead = true;
        spark(b.x, b.y);
        return;
    }
    const col = colOf(b.x), row = rowOf(b.y);
    const tile = tileAt(col, row);
    if (blocksShell(tile)) {
        if (tile === BASE) {
            b.dead = true;
            destroyBase();
            return;
        }
        if (tile === BRICK || b.power) setTile(col, row, OPEN);
        b.dead = true;
        spark(b.x, b.y);
        return;
    }
    for (const t of liveTanks()) {
        if (t.id === b.ownerId) continue;
        if (b.side === 'enemy' && t.side === 'enemy') continue;   // no friendly fire
        if (t.spawning > 0) continue;
        if (Math.abs(t.x - b.x) < TANK_HALF + BULLET_R && Math.abs(t.y - b.y) < TANK_HALF + BULLET_R) {
            b.dead = true;
            if (t.side === 'player' && player.invuln > 0) spark(b.x, b.y);
            else damageTank(t, b.power);
            return;
        }
    }
}

function updateShells(dt) {
    for (const b of bullets) {
        const dist = b.speed * dt;
        let moved = 0;
        while (moved < dist - 1e-6 && !b.dead) {
            const slice = Math.min(2, dist - moved);
            b.x += b.dx * slice;
            b.y += b.dy * slice;
            moved += slice;
            resolveShell(b);
        }
    }
    for (let i = 0; i < bullets.length; i++) {
        for (let j = i + 1; j < bullets.length; j++) {
            const a = bullets[i], c = bullets[j];
            if (a.dead || c.dead || a.side === c.side) continue;
            if (Math.abs(a.x - c.x) < SHELL_CLASH && Math.abs(a.y - c.y) < SHELL_CLASH) {
                a.dead = true;
                c.dead = true;
                spark((a.x + c.x) / 2, (a.y + c.y) / 2);
            }
        }
    }
    bullets = bullets.filter((b) => !b.dead);
}

// --- Power-ups -----------------------------------------------------------
function randomFreeTile() {
    const spots = [];
    for (let r = 1; r < ROWS - 3; r++) {
        for (let c = 0; c < COLS; c++) {
            if (tileAt(c, r) === OPEN) spots.push({ col: c, row: r });
        }
    }
    if (!spots.length) return null;
    return spots[Math.floor(rng() * spots.length)];
}

function spawnPowerup(type, col, row) {
    const c = centerOf(col, row);
    const p = { type, x: c.x, y: c.y, life: POWERUP_LIFE };
    powerups.push(p);
    return p;
}

function maybeDropPowerup() {
    if (kills % POWERUP_EVERY !== 0) return;
    const type = POWERUP_TYPES[dropIndex % POWERUP_TYPES.length];
    dropIndex += 1;
    const spot = randomFreeTile();
    if (spot) spawnPowerup(type, spot.col, spot.row);
}

function collectPowerup(p) {
    score += POWERUP_POINTS;
    if (p.type === 'shield') player.invuln = Math.max(player.invuln, SHIELD_TIME);
    else if (p.type === 'star') player.star = true;
    else if (p.type === 'life') lives += 1;
    explode(p.x, p.y, 18);
    updateHud();
}

function updatePowerups(dt) {
    for (const p of powerups) {
        p.life -= dt;
        if (p.life <= 0) {
            p.gone = true;
            continue;
        }
        if (player.alive
            && Math.abs(player.x - p.x) < TANK_HALF + POWERUP_SIZE / 2
            && Math.abs(player.y - p.y) < TANK_HALF + POWERUP_SIZE / 2) {
            p.gone = true;
            collectPowerup(p);
        }
    }
    powerups = powerups.filter((p) => !p.gone);
}

// --- Bangs and sparks ----------------------------------------------------
function explode(x, y, size) {
    explosions.push({ x, y, size, t: 0, life: 0.45 });
}

function spark(x, y) {
    explosions.push({ x, y, size: 10, t: 0, life: 0.18 });
}

function updateExplosions(dt) {
    for (const e of explosions) e.t += dt;
    explosions = explosions.filter((e) => e.t < e.life);
}

// --- Waves and levels ----------------------------------------------------
function updateSpawner(dt) {
    if (!spawnEnabled || enemiesToSpawn <= 0) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    if (enemies.length >= maxOnFieldForLevel(level)) {
        spawnTimer = 0.25;
        return;
    }
    const point = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
    spawnIndex += 1;
    spawnEnemy(planQueue[planIndex++] || 'basic', point.col, point.row);
    enemiesToSpawn -= 1;
    spawnTimer = spawnIntervalForLevel(level);
}

function loadLevel(lv) {
    grid = mapForLevel(lv).map((row) => row.split(''));
    base.alive = true;
    enemies = [];
    bullets = [];
    powerups = [];
    explosions = [];
    planQueue = enemyPlanForLevel(lv);
    planIndex = 0;
    spawnIndex = 0;
    enemiesToSpawn = planQueue.length;
    spawnTimer = FIRST_SPAWN;
    placePlayer(PLAYER_SPAWN.col, PLAYER_SPAWN.row);
    player.star = false;
    player.invuln = LEVEL_SHIELD;
}

function checkLevelClear() {
    if (state !== 'playing') return;
    if (enemiesToSpawn > 0 || enemies.length > 0) return;
    state = 'levelclear';
    clearTimer = LEVEL_CLEAR_PAUSE;
    score += LEVEL_BONUS;
    updateHud();
}

function nextLevel() {
    level += 1;
    loadLevel(level);
    state = 'playing';
    updateHud();
}

// --- Game flow -----------------------------------------------------------
function startGame() {
    score = 0;
    level = 1;
    lives = 3;
    kills = 0;
    dropIndex = 0;
    overReason = null;
    spawnEnabled = true;
    time = 0;
    loadLevel(1);
    state = 'playing';
    hideOverlay();
    updateHud();
}

function endGame(reason) {
    state = 'gameover';
    overReason = reason;
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage may be unavailable — the run still ends cleanly */
        }
    }
    updateHud();
    showOverlay(
        reason === 'base' ? 'BASE DESTROYED' : 'GAME OVER',
        `Score ${score} · Level ${level}`,
        'Press Space or click Start to play again'
    );
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

function step(dt) {
    if (state === 'levelclear') {
        time += dt;
        updateExplosions(dt);
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        return;
    }
    if (state !== 'playing') return;

    time += dt;
    if (player.invuln > 0) player.invuln -= dt;
    if (player.reload > 0) player.reload -= dt;

    if (player.alive) {
        player.blocked = false;
        advanceTank(player, dt);
    } else {
        player.respawnTimer -= dt;
        if (player.respawnTimer <= 0) {
            placePlayer(PLAYER_SPAWN.col, PLAYER_SPAWN.row);
            player.invuln = RESPAWN_SHIELD;
        }
    }

    updateEnemies(dt);
    updateShells(dt);
    updatePowerups(dt);
    updateExplosions(dt);
    updateSpawner(dt);
    checkLevelClear();
    updateHud();
}

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlayEl = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    overlaySub.textContent = sub || '';
    overlayEl.classList.add('visible');
}

function hideOverlay() {
    overlayEl.classList.remove('visible');
}

function updateHud() {
    document.getElementById('score').textContent = String(score);
    document.getElementById('level').textContent = String(level);
    document.getElementById('lives').textContent = String(Math.max(0, lives));
    document.getElementById('enemies').textContent = String(enemiesToSpawn + enemies.length);
    document.getElementById('best').textContent = String(best);
}

// --- Input ---------------------------------------------------------------
const DIR_KEYS = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    a: { x: -1, y: 0 },
    d: { x: 1, y: 0 },
    w: { x: 0, y: -1 },
    s: { x: 0, y: 1 },
};
const held = [];

function syncPlayerDir() {
    const key = held[held.length - 1];
    const d = key ? DIR_KEYS[key] : null;
    player.dir = d ? { x: d.x, y: d.y } : { x: 0, y: 0 };
    if (d) player.facing = { x: d.x, y: d.y };
}

document.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (DIR_KEYS[key]) {
        e.preventDefault();
        if (!held.includes(key)) held.push(key);
        syncPlayerDir();
        return;
    }
    if (key === ' ' || e.code === 'Space' || key === 'Enter') {
        e.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else if (state === 'playing' && !e.repeat) fire();
        return;
    }
    if (key === 'p') togglePause();
});

document.addEventListener('keyup', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const at = held.indexOf(key);
    if (at !== -1) held.splice(at, 1);
    if (DIR_KEYS[key]) syncPlayerDir();
});

document.getElementById('btn-start').addEventListener('click', () => {
    if (state === 'idle' || state === 'gameover') startGame();
});

// --- Rendering -----------------------------------------------------------
function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawGround() {
    ctx.fillStyle = '#0b1016';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(c * TILE + 0.5, 0);
        ctx.lineTo(c * TILE + 0.5, CANVAS_H);
        ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * TILE + 0.5);
        ctx.lineTo(CANVAS_W, r * TILE + 0.5);
        ctx.stroke();
    }
}

function drawBrick(x, y) {
    ctx.fillStyle = '#8c4632';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    for (let i = 0; i < 4; i++) {
        ctx.fillRect(x, y + i * 7 + 6, TILE, 1);
    }
    for (let i = 0; i < 4; i++) {
        const offset = i % 2 ? 7 : 21;
        ctx.fillRect(x + offset, y + i * 7, 1, 7);
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x, y, TILE, 2);
}

function drawSteel(x, y) {
    ctx.fillStyle = '#8e9aa5';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#b9c4cd';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#6d7883';
    ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
    ctx.fillStyle = '#dfe7ec';
    for (const [dx, dy] of [[4, 4], [TILE - 6, 4], [4, TILE - 6], [TILE - 6, TILE - 6]]) {
        ctx.fillRect(x + dx, y + dy, 2, 2);
    }
}

function drawWater(x, y) {
    ctx.fillStyle = '#14456b';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = 'rgba(146, 214, 255, 0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
        const wy = y + 8 + i * 11;
        ctx.beginPath();
        for (let px = 0; px <= TILE; px += 4) {
            const wobble = Math.sin((px + x) * 0.25 + time * 3 + i) * 1.8;
            if (px === 0) ctx.moveTo(x + px, wy + wobble);
            else ctx.lineTo(x + px, wy + wobble);
        }
        ctx.stroke();
    }
}

function drawBase() {
    const x = BASE_COL * TILE, y = BASE_ROW * TILE, size = TILE * 2;
    if (base.alive) {
        ctx.fillStyle = '#1d2b38';
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.moveTo(x + size / 2, y + 6);
        ctx.lineTo(x + size - 8, y + size / 2);
        ctx.lineTo(x + size / 2, y + size - 6);
        ctx.lineTo(x + 8, y + size / 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#1d2b38';
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(x + size / 2 - 2, y + size / 2 - 4, 4, 12);
    } else {
        ctx.fillStyle = '#241a16';
        ctx.fillRect(x, y, size, size);
        ctx.strokeStyle = '#5b4038';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + 8, y + size - 8);
        ctx.lineTo(x + size / 2, y + 12);
        ctx.lineTo(x + size - 8, y + size - 8);
        ctx.stroke();
        ctx.fillStyle = '#ef5b4c';
        ctx.fillRect(x + size / 2 - 1, y + 10, 3, size - 18);
    }
}

function drawTiles() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const ch = grid[r][c];
            const x = c * TILE, y = r * TILE;
            if (ch === BRICK) drawBrick(x, y);
            else if (ch === STEEL) drawSteel(x, y);
            else if (ch === WATER) drawWater(x, y);
        }
    }
    drawBase();
}

function drawTank(t, bodyColor, trimColor) {
    const angle = Math.atan2(t.facing.y, t.facing.x) + Math.PI / 2;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(angle);

    ctx.fillStyle = trimColor;
    ctx.fillRect(-TANK_HALF, -TANK_HALF, 6, TANK);
    ctx.fillRect(TANK_HALF - 6, -TANK_HALF, 6, TANK);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    for (let i = 0; i < 4; i++) {
        ctx.fillRect(-TANK_HALF, -TANK_HALF + 3 + i * 6, 6, 2);
        ctx.fillRect(TANK_HALF - 6, -TANK_HALF + 3 + i * 6, 6, 2);
    }

    ctx.fillStyle = bodyColor;
    roundedRect(-TANK_HALF + 5, -TANK_HALF + 2, TANK - 10, TANK - 4, 3);
    ctx.fill();

    ctx.fillStyle = trimColor;
    ctx.fillRect(-2.5, -TANK_HALF - 6, 5, 15);
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(0, 1, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.beginPath();
    ctx.arc(-2, -1, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawSpawnFlash(t) {
    const phase = (SPAWN_FLASH - t.spawning) * 14;
    const r = 6 + Math.abs(Math.sin(phase)) * 8;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(phase * 0.3);
    ctx.fillStyle = phase % 2 < 1 ? '#eaf6ff' : '#69d4ef';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
        const rad = i % 2 ? r * 0.4 : r;
        const a = (i / 8) * Math.PI * 2;
        const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawShield(t) {
    const r = TANK_HALF + 3 + Math.sin(time * 12) * 1.5;
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(t.x, t.y, r + 3, 0, Math.PI * 2);
    ctx.stroke();
}

function drawTanks() {
    for (const t of enemies) {
        if (t.spawning > 0) {
            drawSpawnFlash(t);
            continue;
        }
        const stats = ENEMY_STATS[t.type] || ENEMY_STATS.basic;
        const hurt = t.maxHp > 1 && t.hp < t.maxHp;
        drawTank(t, t.hitFlash > 0 ? '#ffffff' : (hurt ? '#e0a184' : stats.body), stats.trim);
    }
    if (player.alive) {
        drawTank(player, player.star ? '#ffe08a' : '#f0c05a', '#7a5a22');
        if (player.invuln > 0) drawShield(player);
    }
}

function drawShells() {
    for (const b of bullets) {
        ctx.fillStyle = b.power ? '#ffd166' : '#f4f9ff';
        ctx.beginPath();
        ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.beginPath();
        ctx.arc(b.x - b.dx * 4, b.y - b.dy * 4, BULLET_R - 1, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawPowerups() {
    for (const p of powerups) {
        if (p.life < 3 && Math.floor(p.life * 8) % 2 === 0) continue;
        const s = POWERUP_SIZE;
        ctx.fillStyle = '#101820';
        roundedRect(p.x - s / 2, p.y - s / 2, s, s, 5);
        ctx.fill();
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const glyph = p.type === 'shield' ? 'S' : p.type === 'star' ? '★' : '♥';
        ctx.fillText(glyph, p.x, p.y + 1);
    }
}

function drawExplosions() {
    for (const e of explosions) {
        const k = Math.min(1, e.t / e.life);
        const r = e.size * (0.35 + k * 0.75);
        // Three shells of flame: a dark rim, an orange body and a hot core that
        // burns out first.
        ctx.globalAlpha = Math.max(0, 1 - k * k);
        ctx.fillStyle = '#d1491a';
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff9d3c';
        ctx.beginPath();
        ctx.arc(e.x, e.y, r * 0.66, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = Math.max(0, 1 - k * 1.6);
        ctx.fillStyle = '#fff3c4';
        ctx.beginPath();
        ctx.arc(e.x, e.y, r * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function drawBanner(text) {
    ctx.fillStyle = 'rgba(5, 8, 12, 0.7)';
    ctx.fillRect(0, CANVAS_H / 2 - 30, CANVAS_W, 60);
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2);
}

function draw() {
    drawGround();
    drawTiles();
    drawPowerups();
    drawTanks();
    drawShells();
    drawExplosions();
    if (state === 'levelclear') drawBanner(`LEVEL ${level} CLEARED`);
}

// --- Boot ----------------------------------------------------------------
function loadBest() {
    try {
        best = Number(window.localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
        best = 0;
    }
}

loadBest();
loadLevel(1);
player.invuln = 0;
state = 'idle';
updateHud();

let lastFrame = null;

function frame(now) {
    if (lastFrame === null) lastFrame = now;
    const dt = Math.min((now - lastFrame) / 1000, 1 / 30);
    lastFrame = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
