// ---------------------------------------------------------------------------
// Tank Battle — a Battle City style base-defence game on an HTML5 canvas.
//
// You drive a single tank around a 13x13 tile battlefield while waves of enemy
// tanks roll in from the top edge. Every wave wants the same thing: the eagle
// sitting in the brick fortress at the bottom of the map. Shoot every tank in
// the wave to advance a level; lose all three tanks, or let a single shell
// reach the eagle, and the battle is over.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing; setting
// `loopEnabled = false` hands the clock over to the tests entirely.
// ---------------------------------------------------------------------------

// --- Battlefield ---------------------------------------------------------
const TILE = 32;
const COLS = 13;
const ROWS = 13;
const CANVAS_W = COLS * TILE;   // 416
const CANVAS_H = ROWS * TILE;   // 416

const EMPTY = 0;
const BRICK = 1;
const STEEL = 2;
const WATER = 3;
const TREES = 4;
const BASE = 5;

const BASE_COL = 6;
const BASE_ROW = 12;
const PLAYER_SPAWN = { col: 4, row: 12 };
const ENEMY_SPAWNS = [
    { col: 0, row: 0 },
    { col: 6, row: 0 },
    { col: 12, row: 0 },
];

// --- Tanks ---------------------------------------------------------------
const TANK_HALF = 13;           // tanks are 26px square inside a 32px lane
const PLAYER_SPEED = 96;        // px/s
const PLAYER_COOLDOWN = 0.18;   // s between shots
const RESPAWN_INVULN = 2.5;     // s of shield after a respawn
const START_LIVES = 3;
const MAX_ALIVE = 4;            // enemy tanks on the field at once
const SPAWN_INTERVAL = 2.4;     // s between enemy deployments
const FIRST_SPAWN = 0.8;

const ENEMY_TYPES = {
    basic: { speed: 52, armour: 1, score: 100, body: '#b7c2c6', trim: '#7d8a8f' },
    fast: { speed: 84, armour: 1, score: 200, body: '#8fd3e8', trim: '#4d93ad' },
    armor: { speed: 44, armour: 2, score: 300, body: '#cfa14e', trim: '#8a6524' },
};

// --- Shells --------------------------------------------------------------
const BULLET_HALF = 3;
const PLAYER_BULLET_SPEED = 300;
const ENEMY_BULLET_SPEED = 230;

const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
};
const DIR_NAMES = ['up', 'down', 'left', 'right'];
const isVertical = (dir) => dir === 'up' || dir === 'down';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let grid = [];
let state = 'idle';             // idle | playing | paused | levelclear | gameover
let score = 0;
let level = 1;
let lives = START_LIVES;
let best = 0;
let baseAlive = true;
let enemiesLeft = 0;            // still to be deployed this level
let enemies = [];
let bullets = [];
let effects = [];
let player = null;
let spawnTimer = FIRST_SPAWN;
let spawnIndex = 0;
let clearTimer = 0;
let clock = 0;                  // animation clock, seconds

// Test hooks: the specs switch the animation loop and the enemy deployment off
// so that every simulated frame is theirs.
let loopEnabled = true;
let spawnEnabled = true;

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32)
// ---------------------------------------------------------------------------

let rngState = 1;
let pendingSeed = null;

function setSeed(seed) {
    rngState = seed >>> 0;
    pendingSeed = rngState;
}

function rand() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const randRange = (lo, hi) => lo + rand() * (hi - lo);
const pick = (list) => list[Math.floor(rand() * list.length) % list.length];

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function tileAt(col, row) {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return STEEL;
    return grid[row][col];
}

function setTile(col, row, type) {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return;
    grid[row][col] = type;
}

// Water and the base stop tanks; trees are cover you can drive under.
const blocksTank = (type) => type === BRICK || type === STEEL || type === WATER || type === BASE;

// Lanes keep the map connected: every row and column listed here is left open
// (empty, or trees you can drive through), so every enemy spawn always has a
// route to the eagle without relying on a post-generation carving pass. The
// centre column is deliberately *not* a lane — an open run from the middle
// spawn straight down onto the eagle makes the first wave unsurvivable.
const LANE_ROWS = new Set([0, 6, 12]);
const LANE_COLS = new Set([0, 3, 9, 12]);

function buildBattlefield() {
    const steelChance = Math.min(0.14, 0.06 + level * 0.008);
    grid = [];
    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
            if (LANE_ROWS.has(r) || LANE_COLS.has(c)) {
                row.push(rand() < 0.16 ? TREES : EMPTY);
                continue;
            }
            const roll = rand();
            if (roll < 0.34) row.push(BRICK);
            else if (roll < 0.34 + steelChance) row.push(STEEL);
            else if (roll < 0.48 + steelChance) row.push(WATER);
            else if (roll < 0.60 + steelChance) row.push(TREES);
            else row.push(EMPTY);
        }
        grid.push(row);
    }

    // Nobody deploys into a wall.
    for (const spawn of [PLAYER_SPAWN, ...ENEMY_SPAWNS]) {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) setTile(spawn.col + dc, spawn.row + dr, EMPTY);
        }
    }

    // The eagle and the brick fortress around it, placed last so the spawn
    // clearing above can never punch a hole in the wall. The wall is two tiles
    // deep at the front so a single lucky shell cannot end the game.
    setTile(BASE_COL, BASE_ROW, BASE);
    setTile(BASE_COL - 1, BASE_ROW, BRICK);
    setTile(BASE_COL + 1, BASE_ROW, BRICK);
    for (let dc = -1; dc <= 1; dc++) {
        setTile(BASE_COL + dc, BASE_ROW - 1, BRICK);
        setTile(BASE_COL + dc, BASE_ROW - 2, BRICK);
    }
}

// ---------------------------------------------------------------------------
// Tanks
// ---------------------------------------------------------------------------

const laneCentre = (index) => index * TILE + TILE / 2;
const snapValue = (v) => Math.round((v - TILE / 2) / TILE) * TILE + TILE / 2;

function makeTank(col, row, kind, type) {
    const spec = kind === 'player' ? { speed: PLAYER_SPEED, armour: 1, score: 0 } : ENEMY_TYPES[type];
    return {
        kind,
        type: kind === 'player' ? 'player' : type,
        x: laneCentre(col),
        y: laneCentre(row),
        dir: kind === 'player' ? 'up' : 'down',
        moving: kind !== 'player',
        speed: spec.speed,
        armour: spec.armour,
        alive: true,
        cooldown: 0,
        invuln: 0,
        spawnFlash: kind === 'player' ? 0 : 1,
        think: 0,
        fireTimer: kind === 'player' ? 0 : randRange(1, 2.2),
        frozen: false,
    };
}

function tankBoxOverlap(ax, ay, bx, by) {
    return Math.abs(ax - bx) < TANK_HALF * 2 && Math.abs(ay - by) < TANK_HALF * 2;
}

function collides(tank, x, y) {
    if (x - TANK_HALF < 0 || y - TANK_HALF < 0 || x + TANK_HALF > CANVAS_W || y + TANK_HALF > CANVAS_H) {
        return true;
    }
    const c0 = Math.floor((x - TANK_HALF) / TILE);
    const c1 = Math.floor((x + TANK_HALF - 0.001) / TILE);
    const r0 = Math.floor((y - TANK_HALF) / TILE);
    const r1 = Math.floor((y + TANK_HALF - 0.001) / TILE);
    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
            if (blocksTank(tileAt(c, r))) return true;
        }
    }
    for (const other of enemies) {
        if (other !== tank && tankBoxOverlap(x, y, other.x, other.y)) return true;
    }
    if (player && player.alive && player !== tank && tankBoxOverlap(x, y, player.x, player.y)) return true;
    return false;
}

// Slide as far along (dx, dy) as the terrain allows, ending flush against
// whatever stopped the tank. Returns the distance actually travelled.
function tryMove(tank, dx, dy) {
    if (!collides(tank, tank.x + dx, tank.y + dy)) {
        tank.x += dx;
        tank.y += dy;
        return Math.hypot(dx, dy);
    }
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (collides(tank, tank.x + dx * mid, tank.y + dy * mid)) hi = mid;
        else lo = mid;
    }
    tank.x += dx * lo;
    tank.y += dy * lo;
    return Math.hypot(dx * lo, dy * lo);
}

// Turning onto the other axis pulls the tank into the middle of its lane, the
// way the arcade original does — without it you could never line a shot up.
function setDirection(tank, dir) {
    const turning = isVertical(dir) !== isVertical(tank.dir);
    tank.dir = dir;
    if (!turning) return;
    const x = isVertical(dir) ? snapValue(tank.x) : tank.x;
    const y = isVertical(dir) ? tank.y : snapValue(tank.y);
    if (!collides(tank, x, y)) {
        tank.x = x;
        tank.y = y;
    }
}

function driveTank(tank, dt) {
    const dir = DIRS[tank.dir];
    return tryMove(tank, dir.x * tank.speed * dt, dir.y * tank.speed * dt);
}

// ---------------------------------------------------------------------------
// Shells
// ---------------------------------------------------------------------------

function spawnBullet(x, y, dir, owner, source) {
    const bullet = {
        x,
        y,
        dir,
        owner,
        source: source || null,
        speed: owner === 'player' ? PLAYER_BULLET_SPEED : ENEMY_BULLET_SPEED,
        dead: false,
    };
    bullets.push(bullet);
    return bullet;
}

function tankFire(tank) {
    if (tank.cooldown > 0) return null;
    const alreadyFlying = bullets.some((b) => (tank.kind === 'player' ? b.owner === 'player' : b.source === tank));
    if (alreadyFlying) return null;
    tank.cooldown = tank.kind === 'player' ? PLAYER_COOLDOWN : 0.1;
    const dir = DIRS[tank.dir];
    return spawnBullet(
        tank.x + dir.x * (TANK_HALF + BULLET_HALF),
        tank.y + dir.y * (TANK_HALF + BULLET_HALF),
        tank.dir,
        tank.kind === 'player' ? 'player' : 'enemy',
        tank
    );
}

function hitTank(target, bullet) {
    if (target.invuln > 0) return;
    target.armour -= 1;
    if (target.armour > 0) {
        addEffect(target.x, target.y, 'spark');
        return;
    }
    if (target.kind === 'player') {
        killPlayer();
        return;
    }
    const spec = ENEMY_TYPES[target.type];
    score += spec.score;
    addEffect(target.x, target.y, 'boom');
    enemies = enemies.filter((e) => e !== target);
    void bullet;
}

function bulletStep(bullet, dist) {
    const dir = DIRS[bullet.dir];
    bullet.x += dir.x * dist;
    bullet.y += dir.y * dist;

    if (bullet.x < 0 || bullet.y < 0 || bullet.x > CANVAS_W || bullet.y > CANVAS_H) {
        bullet.dead = true;
        addEffect(
            Math.min(CANVAS_W - 2, Math.max(2, bullet.x)),
            Math.min(CANVAS_H - 2, Math.max(2, bullet.y)),
            'spark'
        );
        return;
    }

    const col = Math.floor(bullet.x / TILE);
    const row = Math.floor(bullet.y / TILE);
    const tile = tileAt(col, row);
    if (tile === BRICK) {
        setTile(col, row, EMPTY);
        addEffect(bullet.x, bullet.y, 'spark');
        bullet.dead = true;
        return;
    }
    if (tile === STEEL) {
        addEffect(bullet.x, bullet.y, 'spark');
        bullet.dead = true;
        return;
    }
    if (tile === BASE) {
        bullet.dead = true;
        destroyBase();
        return;
    }

    const targets = bullet.owner === 'player' ? enemies.slice() : player && player.alive ? [player] : [];
    for (const target of targets) {
        if (Math.abs(bullet.x - target.x) < TANK_HALF && Math.abs(bullet.y - target.y) < TANK_HALF) {
            bullet.dead = true;
            hitTank(target, bullet);
            return;
        }
    }
}

function updateBullets(dt) {
    for (const bullet of bullets) {
        // Shells are advanced in short hops so they can never tunnel through a
        // one-tile wall or past an oncoming shell in a single frame.
        let remaining = bullet.speed * dt;
        while (remaining > 0 && !bullet.dead && state === 'playing') {
            const hop = Math.min(3, remaining);
            remaining -= hop;
            bulletStep(bullet, hop);
        }
    }

    // Shells fired from opposite sides knock each other out of the air.
    for (let i = 0; i < bullets.length; i++) {
        for (let j = i + 1; j < bullets.length; j++) {
            const a = bullets[i];
            const b = bullets[j];
            if (a.dead || b.dead || a.owner === b.owner) continue;
            if (Math.abs(a.x - b.x) < BULLET_HALF * 2 && Math.abs(a.y - b.y) < BULLET_HALF * 2) {
                a.dead = true;
                b.dead = true;
                addEffect((a.x + b.x) / 2, (a.y + b.y) / 2, 'spark');
            }
        }
    }

    bullets = bullets.filter((b) => !b.dead);
}

// ---------------------------------------------------------------------------
// Enemy AI
// ---------------------------------------------------------------------------

function chooseEnemyDirection(enemy) {
    // Roughly a third of the time an enemy pushes towards the eagle, a fifth of
    // the time it hunts the player, and otherwise it wanders. Any more homing
    // than that and the first wave simply walks onto the base.
    const roll = rand();
    let target = null;
    if (roll < 0.3) target = { x: laneCentre(BASE_COL), y: laneCentre(BASE_ROW) };
    else if (roll < 0.5 && player && player.alive) target = { x: player.x, y: player.y };

    let options = DIR_NAMES;
    if (target) {
        options = [];
        if (target.x - enemy.x > 6) options.push('right');
        if (enemy.x - target.x > 6) options.push('left');
        if (target.y - enemy.y > 6) options.push('down');
        if (enemy.y - target.y > 6) options.push('up');
        if (!options.length) options = DIR_NAMES;
    }
    setDirection(enemy, pick(options));
}

function updateEnemy(enemy, dt) {
    if (enemy.spawnFlash > 0) {
        enemy.spawnFlash -= dt;
        return;
    }
    if (enemy.cooldown > 0) enemy.cooldown -= dt;
    if (enemy.frozen) return;

    enemy.think -= dt;
    if (enemy.think <= 0) {
        chooseEnemyDirection(enemy);
        enemy.think = randRange(0.5, 1.8);
    }

    const moved = driveTank(enemy, dt);
    if (moved < enemy.speed * dt * 0.5) {
        chooseEnemyDirection(enemy);
        enemy.think = randRange(0.3, 0.9);
    }

    enemy.fireTimer -= dt;
    if (enemy.fireTimer <= 0) {
        tankFire(enemy);
        enemy.fireTimer = randRange(0.9, 2.2);
    }
}

function spawnEnemyAt(col, row, type) {
    const enemy = makeTank(col, row, 'enemy', type || 'basic');
    enemies.push(enemy);
    addEffect(enemy.x, enemy.y, 'spawn');
    return enemy;
}

function enemyTypeForLevel() {
    const roll = rand();
    if (level >= 3 && roll < 0.2) return 'armor';
    if (level >= 2 && roll < 0.45) return 'fast';
    if (roll < 0.22) return 'fast';
    return 'basic';
}

function updateSpawner(dt) {
    if (enemiesLeft <= 0) return;
    spawnTimer -= dt;
    if (spawnTimer > 0 || enemies.length >= MAX_ALIVE) return;

    for (let attempt = 0; attempt < ENEMY_SPAWNS.length; attempt++) {
        const spawn = ENEMY_SPAWNS[(spawnIndex + attempt) % ENEMY_SPAWNS.length];
        const x = laneCentre(spawn.col);
        const y = laneCentre(spawn.row);
        const occupied =
            enemies.some((e) => tankBoxOverlap(x, y, e.x, e.y)) ||
            (player && player.alive && tankBoxOverlap(x, y, player.x, player.y));
        if (occupied) continue;
        spawnIndex = (spawnIndex + attempt + 1) % ENEMY_SPAWNS.length;
        spawnEnemyAt(spawn.col, spawn.row, enemyTypeForLevel());
        enemiesLeft -= 1;
        spawnTimer = SPAWN_INTERVAL;
        return;
    }
    spawnTimer = 0.4;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function addEffect(x, y, kind) {
    const life = kind === 'boom' ? 0.45 : kind === 'spawn' ? 0.5 : 0.18;
    effects.push({ x, y, kind, t: 0, life });
}

function updateEffects(dt) {
    for (const fx of effects) fx.t += dt;
    effects = effects.filter((fx) => fx.t < fx.life);
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

const heldDirs = [];

function resetPlayer(invuln) {
    player = makeTank(PLAYER_SPAWN.col, PLAYER_SPAWN.row, 'player');
    player.invuln = invuln;
    applyInput();
}

function updatePlayer(dt) {
    if (!player.alive) return;
    if (player.cooldown > 0) player.cooldown -= dt;
    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);
    if (player.moving) driveTank(player, dt);
}

function killPlayer() {
    addEffect(player.x, player.y, 'boom');
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        player.alive = false;
        gameOver('GAME OVER');
        return;
    }
    resetPlayer(RESPAWN_INVULN);
}

function destroyBase() {
    if (!baseAlive) return;
    baseAlive = false;
    addEffect(laneCentre(BASE_COL), laneCentre(BASE_ROW), 'boom');
    gameOver('EAGLE DOWN');
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function enemyQuotaForLevel() {
    return Math.min(20, 8 + (level - 1) * 2);
}

function startLevel() {
    if (pendingSeed !== null) {
        rngState = pendingSeed;
        pendingSeed = null;
    } else {
        // A level always looks the same, which keeps the specs — and repeat
        // attempts at a level — predictable.
        rngState = (0x1f2e3d + level * 7919) >>> 0;
    }
    buildBattlefield();
    baseAlive = true;
    enemies = [];
    bullets = [];
    effects = [];
    enemiesLeft = enemyQuotaForLevel();
    spawnTimer = FIRST_SPAWN;
    spawnIndex = 0;
    clearTimer = 0;
    resetPlayer(RESPAWN_INVULN);
    updateHud();
}

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    spawnEnabled = true;
    startLevel();
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
            void err;
        }
    }
    updateHud();
    showOverlay(title, `Score ${score} · Level ${level}`, 'Press Space or click Start to fight again');
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
    const clamped = Math.min(0.05, Math.max(0, dt));
    clock += clamped;

    if (state === 'playing') {
        updatePlayer(clamped);
        for (const enemy of enemies.slice()) updateEnemy(enemy, clamped);
        updateBullets(clamped);
        if (spawnEnabled) updateSpawner(clamped);
        updateEffects(clamped);
        if (state === 'playing' && enemiesLeft <= 0 && enemies.length === 0) {
            state = 'levelclear';
            clearTimer = 2;
            showOverlay(`LEVEL ${level} CLEAR`, `Score ${score}`, 'Next wave incoming…');
        }
    } else if (state === 'levelclear') {
        updateEffects(clamped);
        clearTimer -= clamped;
        if (clearTimer <= 0) {
            level += 1;
            startLevel();
            state = 'playing';
            hideOverlay();
        }
    }

    updateHud();
}

// ---------------------------------------------------------------------------
// DOM plumbing
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const enemiesEl = document.getElementById('enemies');
const bestEl = document.getElementById('best');

const hudCache = { score: null, level: null, lives: null, enemies: null, best: null };

function updateHud() {
    const remaining = enemiesLeft + enemies.length;
    if (hudCache.score !== score) scoreEl.textContent = String((hudCache.score = score));
    if (hudCache.level !== level) levelEl.textContent = String((hudCache.level = level));
    if (hudCache.lives !== lives) livesEl.textContent = String((hudCache.lives = lives));
    if (hudCache.enemies !== remaining) enemiesEl.textContent = String((hudCache.enemies = remaining));
    if (hudCache.best !== best) bestEl.textContent = String((hudCache.best = best));
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    overlaySub.textContent = sub || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function applyInput() {
    if (!player) return;
    if (state !== 'playing' || !player.alive) {
        player.moving = false;
        return;
    }
    const dir = heldDirs[heldDirs.length - 1];
    if (!dir) {
        player.moving = false;
        return;
    }
    setDirection(player, dir);
    player.moving = true;
}

const KEY_DIRS = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    w: 'up',
    s: 'down',
    a: 'left',
    d: 'right',
    W: 'up',
    S: 'down',
    A: 'left',
    D: 'right',
};

document.addEventListener('keydown', (event) => {
    const dir = KEY_DIRS[event.key];
    if (dir) {
        event.preventDefault();
        if (!heldDirs.includes(dir)) heldDirs.push(dir);
        applyInput();
        return;
    }
    if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        if (state === 'playing') {
            if (player && player.alive) tankFire(player);
        } else if (state === 'idle' || state === 'gameover') {
            startGame();
        }
        return;
    }
    if (event.key === 'p' || event.key === 'P') {
        event.preventDefault();
        togglePause();
    }
});

document.addEventListener('keyup', (event) => {
    const dir = KEY_DIRS[event.key];
    if (!dir) return;
    const at = heldDirs.indexOf(dir);
    if (at >= 0) heldDirs.splice(at, 1);
    applyInput();
});

document.getElementById('btn-start').addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
    canvas.focus();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawBrick(x, y) {
    ctx.fillStyle = '#8a4a32';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#b8664a';
    for (let ry = 0; ry < 2; ry++) {
        for (let rx = 0; rx < 2; rx++) {
            ctx.fillRect(x + rx * 16 + 1, y + ry * 16 + 1, 14, 14);
        }
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    for (let ry = 0; ry < 4; ry++) ctx.fillRect(x, y + ry * 8 + 7, TILE, 1);
}

function drawSteel(x, y) {
    ctx.fillStyle = '#6f7d85';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#98a7af';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#55636b';
    ctx.fillRect(x + 15, y + 2, 2, TILE - 4);
    ctx.fillRect(x + 2, y + 15, TILE - 4, 2);
    ctx.fillStyle = '#c8d4da';
    for (const [dx, dy] of [[6, 6], [24, 6], [6, 24], [24, 24]]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 1.6, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawWater(x, y) {
    ctx.fillStyle = '#173f6b';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = 'rgba(140, 200, 255, 0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
        const wy = y + 7 + i * 9;
        const shift = Math.sin(clock * 2.4 + i * 1.3 + x * 0.05 + y * 0.03) * 4;
        ctx.beginPath();
        ctx.moveTo(x + 3 + shift, wy);
        ctx.lineTo(x + 13 + shift, wy);
        ctx.moveTo(x + 18 + shift, wy);
        ctx.lineTo(x + 28 + shift, wy);
        ctx.stroke();
    }
}

function drawTrees(x, y) {
    ctx.fillStyle = '#1d5c2c';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#2f8a41';
    for (const [dx, dy, r] of [[9, 10, 7], [22, 9, 6], [15, 22, 8], [26, 23, 5]]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBase(x, y) {
    if (!baseAlive) {
        ctx.fillStyle = '#3a3f42';
        ctx.fillRect(x + 4, y + 16, TILE - 8, TILE - 18);
        ctx.strokeStyle = '#5c6469';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 8, y + 26);
        ctx.lineTo(x + 24, y + 10);
        ctx.moveTo(x + 24, y + 26);
        ctx.lineTo(x + 8, y + 12);
        ctx.stroke();
        return;
    }
    ctx.fillStyle = '#f0e2b0';
    ctx.beginPath();
    ctx.moveTo(x + 16, y + 4);
    ctx.lineTo(x + 20, y + 10);
    ctx.lineTo(x + 28, y + 15);
    ctx.lineTo(x + 21, y + 16);
    ctx.lineTo(x + 24, y + 28);
    ctx.lineTo(x + 16, y + 23);
    ctx.lineTo(x + 8, y + 28);
    ctx.lineTo(x + 11, y + 16);
    ctx.lineTo(x + 4, y + 15);
    ctx.lineTo(x + 12, y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#8a6a24';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#8a6a24';
    ctx.fillRect(x + 14, y + 12, 4, 8);
}

function drawTerrain(layer) {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const tile = grid[r][c];
            const x = c * TILE;
            const y = r * TILE;
            if (layer === 'canopy') {
                if (tile === TREES) drawTrees(x, y);
                continue;
            }
            if (tile === BRICK) drawBrick(x, y);
            else if (tile === STEEL) drawSteel(x, y);
            else if (tile === WATER) drawWater(x, y);
            else if (tile === BASE) drawBase(x, y);
        }
    }
}

function drawTank(tank) {
    const body = tank.kind === 'player' ? '#c8b45a' : ENEMY_TYPES[tank.type].body;
    const trim = tank.kind === 'player' ? '#8d7c2f' : ENEMY_TYPES[tank.type].trim;
    const angle = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[tank.dir];

    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(angle);

    ctx.fillStyle = trim;
    ctx.fillRect(-13, -12, 5, 24);
    ctx.fillRect(8, -12, 5, 24);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    for (let i = -10; i < 12; i += 5) {
        ctx.fillRect(-13, i, 5, 2);
        ctx.fillRect(8, i, 5, 2);
    }

    ctx.fillStyle = body;
    ctx.fillRect(-8, -11, 16, 22);
    ctx.fillStyle = trim;
    ctx.fillRect(-2, -18, 4, 12);
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = trim;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (tank.armour > 1) {
        ctx.strokeStyle = '#fff2c0';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-8, -11, 16, 22);
    }
    ctx.restore();

    if (tank.invuln > 0) {
        const pulse = 0.55 + 0.45 * Math.sin(clock * 26);
        ctx.strokeStyle = `rgba(120, 220, 255, ${pulse.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tank.x, tank.y, TANK_HALF + 3, 0, Math.PI * 2);
        ctx.stroke();
    }
    if (tank.spawnFlash > 0) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        const spin = clock * 9;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            const a = spin + (i * Math.PI) / 2;
            ctx.moveTo(tank.x + Math.cos(a) * 4, tank.y + Math.sin(a) * 4);
            ctx.lineTo(tank.x + Math.cos(a) * 15, tank.y + Math.sin(a) * 15);
        }
        ctx.stroke();
    }
}

function drawBullets() {
    for (const bullet of bullets) {
        const dir = DIRS[bullet.dir];
        ctx.strokeStyle = 'rgba(255, 220, 150, 0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(bullet.x - dir.x * 8, bullet.y - dir.y * 8);
        ctx.lineTo(bullet.x, bullet.y);
        ctx.stroke();
        ctx.fillStyle = bullet.owner === 'player' ? '#fff6d8' : '#ffb8a0';
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, BULLET_HALF, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawEffects() {
    for (const fx of effects) {
        const t = fx.t / fx.life;
        if (fx.kind === 'boom') {
            // A bright core inside an expanding shock ring reads far better
            // than one fading disc, which just leaves a muddy blob behind.
            const radius = 6 + t * 20;
            ctx.strokeStyle = `rgba(255, 190, 90, ${(1 - t).toFixed(3)})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = `rgba(255, ${Math.round(230 - t * 120)}, 140, ${(1 - t * t).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, Math.max(0, 11 - t * 11), 0, Math.PI * 2);
            ctx.fill();
        } else if (fx.kind === 'spark') {
            ctx.fillStyle = `rgba(255, 240, 200, ${(1 - t).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, 3 + t * 5, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.strokeStyle = `rgba(180, 240, 255, ${(1 - t).toFixed(3)})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, 4 + t * 18, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

// Telegraph the next deployment so a tank never simply materialises on top of
// the player.
function drawSpawnWarnings() {
    if (state !== 'playing' || enemiesLeft <= 0 || spawnTimer > 0.9) return;
    const pulse = 0.35 + 0.35 * Math.sin(clock * 12);
    ctx.strokeStyle = `rgba(255, 120, 90, ${pulse.toFixed(3)})`;
    ctx.lineWidth = 2;
    for (const spawn of ENEMY_SPAWNS) {
        const x = laneCentre(spawn.col);
        const y = laneCentre(spawn.row);
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.moveTo(x - 6, y);
        ctx.lineTo(x + 6, y);
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x, y + 6);
        ctx.stroke();
    }
}

function draw() {
    ctx.fillStyle = '#0a0f11';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
        ctx.beginPath();
        ctx.moveTo(i * TILE + 0.5, 0);
        ctx.lineTo(i * TILE + 0.5, CANVAS_H);
        ctx.moveTo(0, i * TILE + 0.5);
        ctx.lineTo(CANVAS_W, i * TILE + 0.5);
        ctx.stroke();
    }

    drawTerrain('ground');
    drawSpawnWarnings();
    for (const enemy of enemies) drawTank(enemy);
    if (player && player.alive) drawTank(player);
    drawBullets();
    drawTerrain('canopy');
    drawEffects();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? (now - lastTime) / 1000 : 0;
    lastTime = now;
    if (loopEnabled) step(dt);
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

state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
enemiesLeft = 0;
rngState = 0x1f2e3d + 7919;
buildBattlefield();
player = makeTank(PLAYER_SPAWN.col, PLAYER_SPAWN.row, 'player');
updateHud();
showOverlay('TANK BATTLE', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
