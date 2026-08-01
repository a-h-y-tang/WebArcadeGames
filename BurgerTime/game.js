// ---------------------------------------------------------------------------
// Burger Time — a platform-and-ladder arcade game on an HTML5 canvas.
//
// The chef walks girders and climbs ladders, treading burger ingredients until
// they fall onto the plates below, while food enemies hunt them across the maze.
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per-second and advanced
// through `step(dt)`, so the tests can simulate frames deterministically without
// depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const TILE = 32;
const COLS = 21;
const ROWS = 15;
const CANVAS_W = COLS * TILE;   // 672
const CANVAS_H = ROWS * TILE;   // 480

// The level map. '-' girder (walk on the cell's top edge), '|' ladder,
// '+' a ladder passing down through a girder, '.' empty air.
const LEVEL = [
    '.....................',  //  0
    '.....................',  //  1
    '+----+---------+----+',  //  2  girder
    '|....|.........|....|',  //  3
    '|....|.........|....|',  //  4
    '+---------+---------+',  //  5  girder
    '|.........|.........|',  //  6
    '|.........|.........|',  //  7
    '-----+----+----+-----',  //  8  girder
    '.....|....|....|.....',  //  9
    '.....|....|....|.....',  // 10
    '+---------+---------+',  // 11  girder
    '|.........|.........|',  // 12
    '|.........|.........|',  // 13
    '---------------------',  // 14  plate row
];

const PLATFORM_ROWS = [2, 5, 8, 11, 14];
const PLATE_LEVEL = PLATFORM_ROWS.length - 1;

const MIN_X = TILE / 2;
const MAX_X = CANVAS_W - TILE / 2;

// --- Burgers ---
const BURGER_COLS = 4;
const SEGMENTS = 4;
const ING_W = SEGMENTS * TILE;           // 128
const ING_SEG_W = ING_W / SEGMENTS;
const ING_H = 9;                         // drawn thickness
const ING_STACK = 10;                    // vertical pitch of a finished stack
const BURGER_X = [1, 6, 11, 16].map((c) => c * TILE);
const ING_TYPES = ['bunTop', 'lettuce', 'patty', 'bunBottom'];
const ING_COLORS = {
    bunTop: '#d99b46',
    lettuce: '#7bc043',
    patty: '#8b4a2b',
    bunBottom: '#c98b3c',
};

// --- Speeds (px/s) ---
const PLAYER_SPEED = 92;
const ENEMY_BASE = 52, ENEMY_STEP = 8;
const FALL_SPEED = 400;
const CLIMB_SNAP = 12;

// --- Rules ---
const START_LIVES = 3;
const PEPPER_START = 5;
const STUN_TIME = 4;
const RESPAWN_TIME = 3;
const GRACE_TIME = 1.5;
const AI_INTERVAL = 0.25;
const PEPPER_LIFE = 0.35;
const PEPPER_REACH = 40;

// --- Scoring ---
const DROP_POINTS = 50;
const SQUASH_POINTS = 100;
const BURGER_BONUS = 500;
const LEVEL_BONUS = 1000;

// --- Collision half-extents between the chef and an enemy ---
const HIT_X = 18;
const HIT_Y = 22;

const ENEMY_TYPES = ['hotdog', 'egg', 'pickle'];
const ENEMY_COLORS = { hotdog: '#e05252', egg: '#f2e8c9', pickle: '#5fae4a' };

const START_X = 336;

// Fixed enemy spawn points, all standing on girders.
const SPAWN_POINTS = [
    { x: 16, y: 2 * TILE },
    { x: 656, y: 2 * TILE },
    { x: 16, y: 14 * TILE },
    { x: 656, y: 14 * TILE },
    { x: 336, y: 8 * TILE },
    { x: 176, y: 11 * TILE },
];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const peppersEl = document.getElementById('peppers');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, lives, level, peppers, grace;
const player = { x: START_X, y: 2 * TILE, dx: 0, dy: 0, facing: 1, walk: 0 };
const enemies = [];
const ingredients = [];
const pepperClouds = [];

// ---------------------------------------------------------------------------
// Map helpers
// ---------------------------------------------------------------------------

function platformY(index) {
    return PLATFORM_ROWS[index] * TILE;
}

// Index into PLATFORM_ROWS for a y that sits exactly on a girder, else null.
function platformIndexAtY(y) {
    for (let i = 0; i < PLATFORM_ROWS.length; i++) {
        if (Math.abs(y - platformY(i)) < 0.001) return i;
    }
    return null;
}

function cellAt(row, col) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return '.';
    return LEVEL[row][col];
}

function isGirderCell(row, col) {
    const c = cellAt(row, col);
    return c === '-' || c === '+';
}

function isLadderCell(row, col) {
    const c = cellAt(row, col);
    return c === '|' || c === '+';
}

// Contiguous runs of ladder cells, collapsed into climbable y spans. A run may
// pass through girders, which is what lets the middle ladder go from row 5 all
// the way down to the plates.
const LADDER_SEGMENTS = (() => {
    const segs = [];
    for (let col = 0; col < COLS; col++) {
        let start = null;
        for (let row = 0; row <= ROWS; row++) {
            const ladder = row < ROWS && isLadderCell(row, col);
            if (ladder && start === null) start = row;
            if (!ladder && start !== null) {
                segs.push({ col, cx: col * TILE + TILE / 2, topY: start * TILE, bottomY: row * TILE });
                start = null;
            }
        }
    }
    return segs;
})();

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

// The ladder segment usable from (x, y) when heading in direction dy, or null.
function ladderSegmentAt(x, y, dy) {
    for (const seg of LADDER_SEGMENTS) {
        if (Math.abs(x - seg.cx) > CLIMB_SNAP) continue;
        if (y < seg.topY - 0.001 || y > seg.bottomY + 0.001) continue;
        if (dy > 0 && y >= seg.bottomY - 0.001) continue;
        if (dy < 0 && y <= seg.topY + 0.001) continue;
        return seg;
    }
    return null;
}

// The single movement primitive, shared by the chef and the enemies. Returns the
// new position, or null when the move is illegal — which doubles as the legality
// probe the enemy AI uses.
function attemptMove(x, y, dx, dy, dist) {
    if (dy !== 0) {
        const seg = ladderSegmentAt(x, y, dy);
        if (!seg) return null;
        const ny = clamp(y + dy * dist, seg.topY, seg.bottomY);
        if (ny === y && seg.cx === x) return null;
        return { x: seg.cx, y: ny };
    }
    if (dx !== 0) {
        const index = platformIndexAtY(y);
        if (index === null) return null;
        const nx = clamp(x + dx * dist, MIN_X, MAX_X);
        if (nx === x) return null;
        if (!isGirderCell(PLATFORM_ROWS[index], Math.floor(nx / TILE))) return null;
        return { x: nx, y };
    }
    return null;
}

// Vertical intent wins, so holding a direction into a ladder always climbs.
function moveActor(actor, speed, h) {
    let move = null;
    if (actor.dy !== 0) move = attemptMove(actor.x, actor.y, 0, actor.dy, speed * h);
    if (!move && actor.dx !== 0) move = attemptMove(actor.x, actor.y, actor.dx, 0, speed * h);
    if (!move) return false;
    actor.x = move.x;
    actor.y = move.y;
    return true;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function setPlayerPos(x, y) {
    player.x = x;
    player.y = y;
}

function setDirection(dx, dy) {
    player.dx = dx;
    player.dy = dy;
    if (dx !== 0) player.facing = dx;
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

function buildIngredients() {
    ingredients.length = 0;
    for (let col = 0; col < BURGER_COLS; col++) {
        for (let lvl = 0; lvl < ING_TYPES.length; lvl++) {
            ingredients.push({
                col,
                level: lvl,
                type: ING_TYPES[lvl],
                x: BURGER_X[col],
                y: platformY(lvl),
                segments: new Array(SEGMENTS).fill(false),
                falling: false,
                onPlate: false,
            });
        }
    }
}

// Where an ingredient comes to rest: its girder, or the top of the plate stack.
function restY(ing) {
    if (ing.level < PLATE_LEVEL) return platformY(ing.level);
    const stacked = ingredients.filter((i) => i.col === ing.col && i.onPlate).length;
    return platformY(PLATE_LEVEL) - stacked * ING_STACK;
}

function dropIngredient(ing) {
    if (!ing || ing.falling || ing.onPlate || ing.level >= PLATE_LEVEL) return;
    ing.level += 1;
    ing.segments.fill(false);
    ing.falling = true;
    score += DROP_POINTS;
    // Anything resting on the level we just claimed is shoved down too. The
    // recursion walks a contiguous run of occupied levels, so the whole run
    // shifts down exactly one floor.
    if (ing.level < PLATE_LEVEL) {
        for (const other of ingredients) {
            if (other === ing || other.col !== ing.col) continue;
            if (other.level === ing.level && !other.falling && !other.onPlate) dropIngredient(other);
        }
    }
}

function ingredientsOnPlate(col) {
    return ingredients.filter((i) => i.col === col && i.onPlate).length;
}

function burgerComplete(col) {
    return ingredientsOnPlate(col) >= ING_TYPES.length;
}

function landOnPlate(ing) {
    ing.onPlate = true;
    if (burgerComplete(ing.col)) {
        score += BURGER_BONUS;
        let all = true;
        for (let c = 0; c < BURGER_COLS; c++) if (!burgerComplete(c)) all = false;
        if (all) {
            score += LEVEL_BONUS;
            nextLevel();
        }
    }
}

// The chef marks the slice of ingredient under their feet; a full set drops it.
function treadIngredients() {
    const index = platformIndexAtY(player.y);
    if (index === null) return;
    for (const ing of ingredients) {
        if (ing.falling || ing.onPlate || ing.level !== index) continue;
        if (player.x < ing.x || player.x > ing.x + ING_W) continue;
        const seg = clamp(Math.floor((player.x - ing.x) / ING_SEG_W), 0, SEGMENTS - 1);
        if (ing.segments[seg]) continue;
        ing.segments[seg] = true;
        if (ing.segments.every(Boolean)) dropIngredient(ing);
    }
}

function updateIngredients(h) {
    for (const ing of ingredients) {
        if (!ing.falling) continue;
        const target = restY(ing);
        ing.y = Math.min(target, ing.y + FALL_SPEED * h);
        for (const e of enemies) {
            if (e.squashed) continue;
            if (e.x < ing.x - 6 || e.x > ing.x + ING_W + 6) continue;
            if (e.y < ing.y - 16 || e.y > ing.y + 6) continue;
            squashEnemy(e);
        }
        if (ing.y >= target - 1e-6) {
            ing.y = target;
            ing.falling = false;
            if (ing.level >= PLATE_LEVEL) landOnPlate(ing);
        }
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function enemySpeed() {
    return ENEMY_BASE + (level - 1) * ENEMY_STEP;
}

function enemyCount() {
    return Math.min(5, 1 + level);
}

function spawnEnemy(x, y, type) {
    const enemy = {
        x, y,
        dx: 0, dy: 0,
        type: type || ENEMY_TYPES[enemies.length % ENEMY_TYPES.length],
        stun: 0,
        squashed: false,
        respawn: 0,
        aiTimer: 0,
    };
    enemies.push(enemy);
    return enemy;
}

function spawnEnemies() {
    enemies.length = 0;
    const n = enemyCount();
    for (let i = 0; i < n; i++) {
        const p = SPAWN_POINTS[i % SPAWN_POINTS.length];
        spawnEnemy(p.x, p.y, ENEMY_TYPES[i % ENEMY_TYPES.length]);
    }
}

function squashEnemy(e) {
    e.squashed = true;
    e.stun = 0;
    e.respawn = RESPAWN_TIME;
    e.dx = 0;
    e.dy = 0;
    score += SQUASH_POINTS;
}

// Greedy chase: probe all four directions, keep the legal ones, take whichever
// closes the most ground, and avoid doubling back unless there is no choice.
function chooseEnemyDir(e) {
    const options = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const legal = [];
    for (const [dx, dy] of options) {
        const move = attemptMove(e.x, e.y, dx, dy, 6);
        if (!move) continue;
        legal.push({ dx, dy, d: Math.abs(move.x - player.x) + Math.abs(move.y - player.y) });
    }
    if (!legal.length) {
        e.dx = 0;
        e.dy = 0;
        return;
    }
    const forward = legal.filter((o) => !(o.dx === -e.dx && o.dy === -e.dy));
    const pool = forward.length ? forward : legal;
    pool.sort((a, b) => a.d - b.d);
    e.dx = pool[0].dx;
    e.dy = pool[0].dy;
}

function updateEnemies(h) {
    const speed = enemySpeed();
    for (const e of enemies) {
        if (e.squashed) {
            e.respawn -= h;
            if (e.respawn <= 0) {
                const p = SPAWN_POINTS[enemies.indexOf(e) % SPAWN_POINTS.length];
                e.x = p.x;
                e.y = p.y;
                e.squashed = false;
                e.dx = 0;
                e.dy = 0;
                e.aiTimer = 0;
            }
            continue;
        }
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - h);
            continue;
        }
        e.aiTimer -= h;
        if (e.aiTimer <= 0) {
            chooseEnemyDir(e);
            e.aiTimer = AI_INTERVAL;
        }
        if (!moveActor(e, speed, h)) {
            chooseEnemyDir(e);
            e.aiTimer = AI_INTERVAL;
        }
    }
}

function checkCollisions() {
    if (grace > 0) return;
    for (const e of enemies) {
        if (e.squashed || e.stun > 0) continue;
        if (Math.abs(e.x - player.x) < HIT_X && Math.abs(e.y - player.y) < HIT_Y) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function sprayPepper() {
    if (state !== 'running' || peppers <= 0) return null;
    peppers -= 1;
    const w = PEPPER_REACH;
    const cloud = {
        x: player.facing > 0 ? player.x + 6 : player.x - 6 - w,
        y: player.y - 26,
        w,
        h: 26,
        life: PEPPER_LIFE,
    };
    pepperClouds.push(cloud);
    return cloud;
}

function updatePepper(h) {
    for (let i = pepperClouds.length - 1; i >= 0; i--) {
        const c = pepperClouds[i];
        for (const e of enemies) {
            if (e.squashed) continue;
            if (e.x < c.x - 8 || e.x > c.x + c.w + 8) continue;
            if (e.y < c.y - 8 || e.y > c.y + c.h + 12) continue;
            e.stun = STUN_TIME;
            e.dx = 0;
            e.dy = 0;
        }
        c.life -= h;
        if (c.life <= 0) pepperClouds.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    if (grace > 0) grace = Math.max(0, grace - h);

    if (moveActor(player, PLAYER_SPEED, h)) player.walk += PLAYER_SPEED * h;
    treadIngredients();

    updatePepper(h);
    updateEnemies(h);
    updateIngredients(h);
    checkCollisions();
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so ladder
// junctions and falling ingredients are never skipped and the integration is
// resolution-independent.
function step(dt) {
    if (state !== 'running') return;
    const SUB = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-6) {
        const h = Math.min(SUB, remaining);
        substep(h);
        remaining -= h;
        if (state !== 'running') break;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function resetPositions() {
    player.x = START_X;
    player.y = platformY(0);
    player.dx = 0;
    player.dy = 0;
    player.facing = 1;
    pepperClouds.length = 0;
    spawnEnemies();
    grace = GRACE_TIME;
}

function startGame() {
    state = 'running';
    score = 0;
    lives = START_LIVES;
    level = 1;
    peppers = PEPPER_START;
    buildIngredients();
    resetPositions();
    grace = 0;
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    peppers = PEPPER_START;
    buildIngredients();
    resetPositions();
    updateHud();
}

function loseLife() {
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        endGame();
        return;
    }
    resetPositions();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Score ' + score + ' · Level ' + level, 'Press Space to play again', 'Play Again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    peppersEl.textContent = String(peppers);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreText, sub, buttonText) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = buttonText;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawLadders() {
    ctx.strokeStyle = '#5b6b86';
    ctx.lineWidth = 2;
    for (const seg of LADDER_SEGMENTS) {
        const left = seg.cx - 9;
        const right = seg.cx + 9;
        ctx.beginPath();
        ctx.moveTo(left, seg.topY);
        ctx.lineTo(left, seg.bottomY);
        ctx.moveTo(right, seg.topY);
        ctx.lineTo(right, seg.bottomY);
        ctx.stroke();
        ctx.beginPath();
        for (let y = seg.topY + 8; y < seg.bottomY; y += 10) {
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
        }
        ctx.stroke();
    }
}

function drawGirders() {
    for (let i = 0; i < PLATFORM_ROWS.length; i++) {
        const row = PLATFORM_ROWS[i];
        const y = row * TILE;
        for (let col = 0; col < COLS; col++) {
            if (!isGirderCell(row, col)) continue;
            const x = col * TILE;
            ctx.fillStyle = i === PLATE_LEVEL ? '#8ea3c4' : '#7b8fb0';
            ctx.fillRect(x, y, TILE, 3);
            ctx.fillStyle = '#4a5a78';
            ctx.fillRect(x, y + 3, TILE, 3);
            ctx.fillStyle = '#2b3549';
            for (let k = 3; k < TILE; k += 8) ctx.fillRect(x + k, y + 6, 3, 3);
        }
    }
}

function drawPlates() {
    const y = platformY(PLATE_LEVEL);
    for (let col = 0; col < BURGER_COLS; col++) {
        ctx.fillStyle = '#cfd8e8';
        ctx.beginPath();
        ctx.ellipse(BURGER_X[col] + ING_W / 2, y + 6, ING_W / 2 + 6, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9aa8bf';
        ctx.fillRect(BURGER_X[col] - 4, y + 5, ING_W + 8, 3);
    }
}

function drawIngredient(ing) {
    const color = ING_COLORS[ing.type];
    for (let s = 0; s < SEGMENTS; s++) {
        const x = ing.x + s * ING_SEG_W;
        const dip = ing.segments[s] ? 3 : 0;
        ctx.fillStyle = color;
        ctx.fillRect(x, ing.y - ING_H + dip, ING_SEG_W - 1, ING_H);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.fillRect(x, ing.y - ING_H + dip, ING_SEG_W - 1, 2);
        if (ing.type === 'lettuce') {
            ctx.fillStyle = '#96d95e';
            for (let k = 2; k < ING_SEG_W - 4; k += 7) {
                ctx.fillRect(x + k, ing.y - ING_H + dip + 3, 4, 4);
            }
        }
        if (ing.type === 'patty') {
            ctx.fillStyle = '#6f3a20';
            ctx.fillRect(x + 3, ing.y - ING_H + dip + 4, ING_SEG_W - 8, 2);
        }
    }
}

function drawChef() {
    const x = player.x;
    const y = player.y;
    const bob = Math.sin(player.walk / 9) * 1.5;
    // legs
    ctx.fillStyle = '#2f3d5c';
    ctx.fillRect(x - 7, y - 10, 5, 10);
    ctx.fillRect(x + 2, y - 10 + bob, 5, 10);
    // body
    ctx.fillStyle = '#f4ece0';
    ctx.fillRect(x - 9, y - 24, 18, 15);
    ctx.fillStyle = '#e05252';
    ctx.fillRect(x - 9, y - 18, 18, 3);
    // head
    ctx.fillStyle = '#f0c9a0';
    ctx.fillRect(x - 6, y - 32, 12, 9);
    // hat
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 8, y - 40, 16, 8);
    ctx.fillRect(x - 6, y - 34, 12, 3);
    // eye, facing aware
    ctx.fillStyle = '#2b2118';
    ctx.fillRect(x + (player.facing > 0 ? 1 : -4), y - 29, 3, 3);
}

function drawEnemy(e) {
    if (e.squashed) return;
    const flash = e.stun > 0 && Math.floor(e.stun * 8) % 2 === 0;
    ctx.fillStyle = flash ? '#ffffff' : ENEMY_COLORS[e.type];
    ctx.fillRect(e.x - 9, e.y - 22, 18, 22);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(e.x - 9, e.y - 6, 18, 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(e.x - 6, e.y - 17, 5, 5);
    ctx.fillRect(e.x + 1, e.y - 17, 5, 5);
    ctx.fillStyle = '#1a1410';
    if (e.stun > 0) {
        ctx.fillRect(e.x - 5, e.y - 15, 3, 1);
        ctx.fillRect(e.x + 2, e.y - 15, 3, 1);
    } else {
        ctx.fillRect(e.x - 5, e.y - 16, 3, 3);
        ctx.fillRect(e.x + 2, e.y - 16, 3, 3);
    }
}

function drawPepper() {
    for (const c of pepperClouds) {
        const t = Math.max(0, Math.min(1, c.life / PEPPER_LIFE));
        ctx.globalAlpha = t;
        // A fixed lattice of grains, jittered by index so the puff looks loose
        // without needing a random seed the tests would have to tolerate.
        for (let i = 0; i < 18; i++) {
            const gx = (i % 6) / 5;
            const gy = Math.floor(i / 6) / 2;
            const jitter = ((i * 7) % 5) - 2;
            ctx.fillStyle = i % 3 === 0 ? '#ffffff' : '#cdc3ac';
            ctx.fillRect(c.x + gx * (c.w - 4) + jitter, c.y + gy * (c.h - 4) + jitter, 3, 3);
        }
        ctx.globalAlpha = 1;
    }
}

function draw() {
    ctx.fillStyle = '#120c08';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawLadders();
    drawGirders();
    drawPlates();

    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    drawPepper();

    if (state !== 'idle') {
        // Blink the chef during the post-death grace period.
        if (grace <= 0 || Math.floor(grace * 10) % 2 === 0) drawChef();
    }
}

// ---------------------------------------------------------------------------
// Main loop (real-time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const KEY_DIRS = {
    ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
    ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
    ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
    ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
};

const heldKeys = [];

function refreshDirection() {
    for (let i = heldKeys.length - 1; i >= 0; i--) {
        const dir = KEY_DIRS[heldKeys[i]];
        if (dir) {
            setDirection(dir[0], dir[1]);
            return;
        }
    }
    setDirection(0, 0);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') sprayPepper();
        e.preventDefault();
        return;
    }
    if (KEY_DIRS[e.key]) {
        if (!heldKeys.includes(e.key)) heldKeys.push(e.key);
        refreshDirection();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const i = heldKeys.indexOf(e.key);
    if (i >= 0) {
        heldKeys.splice(i, 1);
        refreshDirection();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
peppers = PEPPER_START;
grace = 0;
buildIngredients();
updateHud();
requestAnimationFrame(frame);
