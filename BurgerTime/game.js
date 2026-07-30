// ---------------------------------------------------------------------------
// BurgerTime — a platform-and-ladder arcade game on an HTML5 canvas.
//
// A chef walks a lattice of girders and ladders. Walking the full length of a
// burger ingredient drops it to the girder below; drop every ingredient onto
// the plates at the bottom of the screen to build the burgers and clear the
// level. Food enemies chase the chef, and a limited supply of pepper freezes
// them.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom, Snake
// and Tetris in this repo. Everything moves in units per second and is advanced
// through `step(dt)`, so tests can simulate frames deterministically without
// depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---------------------------------------------------------
const TILE = 32;
const COLS = 16;
const ROWS = 16;
const CANVAS_W = COLS * TILE;   // 512
const CANVAS_H = ROWS * TILE;   // 512

const FLOOR_ROWS = [2, 5, 8, 11, 14];   // girder rows, top to bottom
const PLATE_ROW = 14;                   // the bottom girder holds the plates
const GIRDER_H = 6;

const LANES = [1, 6, 11];               // left column of each burger lane
const INGREDIENT_COLS = 4;              // lane width, in tiles
const INGREDIENT_W = INGREDIENT_COLS * TILE;
const SECTION_W = TILE;
const LAYER_H = 9;                      // drawn thickness of one ingredient

// Ladders live in the gaps between lanes so none is hidden by an ingredient.
// Two of them are partial, which forces a little routing.
const LADDERS = [
    { col: 0, top: 2, bottom: 14 },
    { col: 5, top: 2, bottom: 11 },
    { col: 10, top: 5, bottom: 14 },
    { col: 15, top: 2, bottom: 14 },
];

const INGREDIENT_TYPES = ['bun-top', 'lettuce', 'patty', 'bun-bottom'];
const INGREDIENT_ROWS = [2, 5, 8, 11];  // where each type starts, top to bottom

// --- Actors -----------------------------------------------------------------
const PLAYER_W = 18;
const PLAYER_H = 26;
const ENEMY_W = 20;
const ENEMY_H = 24;
const PLAYER_SPEED = 120;               // px/s
const SNAP = 10;                        // px of tolerance for girders / ladders
const MARGIN = 10;                      // keeps actors inside the canvas

const ENEMY_BASE = 62, ENEMY_STEP = 9, ENEMY_MAX = 120;
const DECIDE_INTERVAL = 0.12;           // seconds between enemy direction picks
const TURN_NOISE = 0.12;                // chance an enemy picks a random legal move
const PROBE_DIST = 12;                  // px an enemy looks ahead when choosing
const STICKY_BONUS = 8;                 // px bias toward carrying straight on
const REVERSE_PENALTY = 14;             // px bias against turning back on itself
const RESPAWN_TIME = 3;                 // seconds before a squashed enemy returns
const START_ENEMIES = 2, MAX_ENEMIES = 5;

const SPAWN_POINTS = [
    { col: 0, row: 14 },
    { col: 15, row: 14 },
    { col: 10, row: 14 },
    { col: 5, row: 11 },
    { col: 0, row: 11 },
];

const START_COL = 5;                    // chef starts on the top girder,
const START_ROW = 2;                    // in the gap between lanes

// --- Ingredients ------------------------------------------------------------
const FALL_SPEED = 260;                 // px/s

// --- Pepper -----------------------------------------------------------------
const START_PEPPERS = 5;
const CLOUD_W = 40;
const CLOUD_TIME = 0.5;                 // seconds a pepper cloud lingers
const STUN_TIME = 4;                    // seconds an enemy stays frozen

// --- Pacing / scoring -------------------------------------------------------
const START_LIVES = 3;
const DYING_TIME = 1.2;
const LEVEL_CLEAR_TIME = 2;
const DROP_POINTS = 50;
const SQUASH_POINTS = 500;
const LEVEL_BONUS = 1000;
const BEST_KEY = 'burgertime-best';

// --- DOM --------------------------------------------------------------------
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

// --- State ------------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'dying' | 'levelclear' | 'over'
let state = 'idle';
let score = 0, best = 0, level = 1, lives = START_LIVES, peppers = START_PEPPERS;
let dyingTimer = 0, levelClearTimer = 0;

const player = { x: 0, y: 0, facing: 1, climbing: false };
const enemies = [];
const ingredients = [];
const clouds = [];
const pops = [];                        // floating score numbers, purely cosmetic
const plateStack = [0, 0, 0];

const keys = { left: false, right: false, up: false, down: false };

// ---------------------------------------------------------------------------
// Deterministic RNG (xorshift32) — a fixed seed makes enemy behaviour
// reproducible for the tests.
// ---------------------------------------------------------------------------
let rngState = 2463534242;

function seedRng(seed) {
    rngState = (seed >>> 0) || 1;
}

function rng() {
    let x = rngState;
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    rngState = x >>> 0;
    return rngState / 4294967296;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function rowY(row) { return row * TILE; }
function laneX(lane) { return LANES[lane] * TILE; }
function ladderX(ladder) { return ladder.col * TILE + TILE / 2; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// The girder an actor is standing on (or close enough to step onto).
function floorRowNear(y) {
    let best = null, bestD = SNAP;
    for (const r of FLOOR_ROWS) {
        const d = Math.abs(y - rowY(r));
        if (d <= bestD) { bestD = d; best = r; }
    }
    return best;
}

function floorRowExact(y) {
    for (const r of FLOOR_ROWS) if (Math.abs(y - rowY(r)) < 0.001) return r;
    return null;
}

function ladderNear(x) {
    for (const l of LADDERS) if (Math.abs(x - ladderX(l)) <= SNAP) return l;
    return null;
}

function nextFloorRowBelow(row) {
    for (const r of FLOOR_ROWS) if (r > row) return r;
    return PLATE_ROW;
}

function enemySpeed(lv) {
    return Math.min(ENEMY_BASE + (lv - 1) * ENEMY_STEP, ENEMY_MAX);
}

function enemyCount(lv) {
    return Math.min(START_ENEMIES + (lv - 1), MAX_ENEMIES);
}

// ---------------------------------------------------------------------------
// Movement — shared by the chef and the enemies.
//
// Vertical input wins when a ladder is in reach, which makes ladders easy to
// grab at intersections. Returns true when the actor actually moved.
// ---------------------------------------------------------------------------

function moveActor(a, dx, dy, speed, dt) {
    if (dy !== 0) {
        const ladder = ladderNear(a.x);
        if (ladder) {
            const top = rowY(ladder.top), bottom = rowY(ladder.bottom);
            if ((dy < 0 && a.y > top) || (dy > 0 && a.y < bottom)) {
                a.x = ladderX(ladder);
                a.y = clamp(a.y + dy * speed * dt, top, bottom);
                a.climbing = true;
                return true;
            }
        }
    }
    if (dx !== 0) {
        const row = floorRowNear(a.y);
        if (row !== null) {
            a.y = rowY(row);
            const before = a.x;
            a.x = clamp(a.x + dx * speed * dt, MARGIN, CANVAS_W - MARGIN);
            a.facing = dx;
            a.climbing = false;
            return a.x !== before;
        }
    }
    return false;
}

// Would this direction produce movement from where the actor stands?
function canMove(a, dx, dy) {
    const probe = { x: a.x, y: a.y, facing: a.facing, climbing: a.climbing };
    moveActor(probe, dx, dy, 1, 4);
    return Math.abs(probe.x - a.x) > 0.001 || Math.abs(probe.y - a.y) > 0.001;
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

function restY(row) { return rowY(row) - LAYER_H; }
function plateRestY(lane) { return rowY(PLATE_ROW) - LAYER_H * (plateStack[lane] + 1); }

function buildIngredients() {
    ingredients.length = 0;
    for (let lane = 0; lane < LANES.length; lane++) {
        plateStack[lane] = 0;
        INGREDIENT_TYPES.forEach((type, i) => {
            const row = INGREDIENT_ROWS[i];
            ingredients.push({
                lane, type, row,
                x: laneX(lane),
                y: restY(row),
                w: INGREDIENT_W,
                sections: [false, false, false, false],
                falling: false,
                onPlate: false,
                targetRow: row,
                stackIndex: -1,
            });
        });
    }
}

function ingredientAt(lane, row) {
    return ingredients.find((i) => i.lane === lane && i.row === row && !i.onPlate) || null;
}

function restingIngredientAt(lane, row, except) {
    return ingredients.find((i) => i !== except && i.lane === lane && i.row === row
        && !i.falling && !i.onPlate) || null;
}

function startFall(ing) {
    if (!ing || ing.falling || ing.onPlate) return;
    ing.falling = true;
    ing.sections = [false, false, false, false];
    ing.targetRow = nextFloorRowBelow(ing.row);
}

// Mark the section under the chef's feet; a fully pressed ingredient drops.
function stepSections() {
    if (player.climbing) return;
    const row = floorRowExact(player.y);
    if (row === null) return;
    for (const ing of ingredients) {
        if (ing.falling || ing.onPlate || ing.row !== row) continue;
        const idx = Math.floor((player.x - ing.x) / SECTION_W);
        if (idx < 0 || idx >= INGREDIENT_COLS || ing.sections[idx]) continue;
        ing.sections[idx] = true;
        if (ing.sections.every(Boolean)) startFall(ing);
    }
}

function squashEnemiesUnder(ing) {
    for (const e of enemies) {
        if (e.squashed) continue;
        const ex = e.x - ENEMY_W / 2, ey = e.y - ENEMY_H;
        if (ing.x < ex + ENEMY_W && ing.x + ing.w > ex
            && ing.y < ey + ENEMY_H && ing.y + LAYER_H > ey) {
            e.squashed = true;
            e.respawn = RESPAWN_TIME;
            e.dx = 0; e.dy = 0;
            spawnPop(e.x, e.y - ENEMY_H, String(SQUASH_POINTS));
            addScore(SQUASH_POINTS);
        }
    }
}

function landOnPlate(ing) {
    ing.stackIndex = plateStack[ing.lane];
    plateStack[ing.lane] += 1;
    ing.y = rowY(PLATE_ROW) - LAYER_H * (ing.stackIndex + 1);
    ing.row = PLATE_ROW;
    ing.falling = false;
    ing.onPlate = true;
    spawnPop(ing.x + ing.w / 2, ing.y, String(DROP_POINTS));
    addScore(DROP_POINTS);
    if (ingredients.every((i) => i.onPlate)) clearLevel();
}

function updateIngredients(dt) {
    for (const ing of ingredients) {
        if (!ing.falling) continue;
        ing.y += FALL_SPEED * dt;
        squashEnemiesUnder(ing);

        const targetY = ing.targetRow === PLATE_ROW ? plateRestY(ing.lane) : restY(ing.targetRow);
        if (ing.y < targetY) continue;

        if (ing.targetRow === PLATE_ROW) {
            landOnPlate(ing);
            continue;
        }
        // Landing on another ingredient knocks it loose and carries this one on
        // down to the girder below it.
        const other = restingIngredientAt(ing.lane, ing.targetRow, ing);
        ing.y = targetY;
        ing.row = ing.targetRow;
        if (other) {
            startFall(other);
            ing.targetRow = nextFloorRowBelow(ing.row);
        } else {
            ing.falling = false;
            addScore(DROP_POINTS);
        }
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

const DIRS = [
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
];

function spawnEnemy(x, y) {
    const e = {
        x, y, dx: 0, dy: 0, facing: 1, climbing: false,
        stun: 0, squashed: false, respawn: 0, decide: 0,
        kind: enemies.length % 3,
        home: enemies.length,
    };
    enemies.push(e);
    return e;
}

function spawnPointFor(index) {
    const p = SPAWN_POINTS[index % SPAWN_POINTS.length];
    return { x: p.col * TILE + TILE / 2, y: rowY(p.row) };
}

function placeEnemy(e, index) {
    const p = spawnPointFor(index);
    e.x = p.x; e.y = p.y;
    e.dx = 0; e.dy = 0;
    e.stun = 0; e.squashed = false; e.respawn = 0; e.decide = 0;
    e.climbing = false;
}

function spawnEnemies(count) {
    enemies.length = 0;
    for (let i = 0; i < count; i++) {
        const p = spawnPointFor(i);
        spawnEnemy(p.x, p.y);
    }
}

// Greedy chase: score every legal move by the distance to the chef after a
// probe step, keep going straight when it is no worse, and avoid reversing.
function decideEnemy(e) {
    const options = DIRS.filter((d) => canMove(e, d.dx, d.dy));
    if (!options.length) { e.dx = 0; e.dy = 0; return; }

    if (rng() < TURN_NOISE) {
        const pick = options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
        e.dx = pick.dx; e.dy = pick.dy;
        return;
    }

    const moving = e.dx !== 0 || e.dy !== 0;
    let best = options[0], bestScore = Infinity;
    for (const d of options) {
        const probe = { x: e.x, y: e.y, facing: e.facing, climbing: e.climbing };
        moveActor(probe, d.dx, d.dy, 1, PROBE_DIST);
        let s = Math.hypot(probe.x - player.x, probe.y - player.y);
        if (d.dx === e.dx && d.dy === e.dy) s -= STICKY_BONUS;
        if (moving && d.dx === -e.dx && d.dy === -e.dy) s += REVERSE_PENALTY;
        if (s < bestScore) { bestScore = s; best = d; }
    }
    e.dx = best.dx; e.dy = best.dy;
}

function updateEnemies(dt) {
    const speed = enemySpeed(level);
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.squashed) {
            e.respawn -= dt;
            if (e.respawn <= 0) placeEnemy(e, i);
            continue;
        }
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - dt);
            continue;
        }
        e.decide -= dt;
        if (e.decide <= 0) {
            decideEnemy(e);
            e.decide = DECIDE_INTERVAL;
        }
        if (!moveActor(e, e.dx, e.dy, speed, dt)) {
            decideEnemy(e);
            e.decide = DECIDE_INTERVAL;
            moveActor(e, e.dx, e.dy, speed, dt);
        }
    }
}

function checkPlayerCollisions() {
    for (const e of enemies) {
        if (e.squashed || e.stun > 0) continue;
        if (Math.abs(e.x - player.x) < (PLAYER_W + ENEMY_W) / 2 - 1
            && Math.abs(e.y - player.y) < (PLAYER_H + ENEMY_H) / 2 - 5) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function cloudRect() {
    const dir = player.facing >= 0 ? 1 : -1;
    const x = dir > 0 ? player.x + 8 : player.x - 8 - CLOUD_W;
    return { x, y: player.y - PLAYER_H, w: CLOUD_W, h: PLAYER_H };
}

function stunInCloud(cloud) {
    for (const e of enemies) {
        if (e.squashed) continue;
        const ex = e.x - ENEMY_W / 2, ey = e.y - ENEMY_H;
        if (cloud.x < ex + ENEMY_W && cloud.x + cloud.w > ex
            && cloud.y < ey + ENEMY_H && cloud.y + cloud.h > ey) {
            e.stun = STUN_TIME;
            e.dx = 0; e.dy = 0;
        }
    }
}

function firePepper() {
    if (state !== 'running' || peppers <= 0) return;
    peppers -= 1;
    const cloud = cloudRect();
    cloud.t = CLOUD_TIME;
    clouds.push(cloud);
    stunInCloud(cloud);
    updateHud();
}

function updateClouds(dt) {
    for (let i = clouds.length - 1; i >= 0; i--) {
        const c = clouds[i];
        c.t -= dt;
        stunInCloud(c);
        if (c.t <= 0) clouds.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Floating score numbers
// ---------------------------------------------------------------------------

const POP_TIME = 0.9;

function spawnPop(x, y, text) {
    pops.push({ x, y, text, t: POP_TIME });
}

function updatePops(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].t -= dt;
        pops[i].y -= 24 * dt;
        if (pops[i].t <= 0) pops.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function addScore(points) {
    score += points;
    updateHud();
}

function resetActors() {
    player.x = START_COL * TILE + TILE / 2;
    player.y = rowY(START_ROW);
    player.facing = 1;
    player.climbing = false;
    clouds.length = 0;
    pops.length = 0;
    for (let i = 0; i < enemies.length; i++) placeEnemy(enemies[i], i);
}

function setupLevel(lv) {
    level = lv;
    buildIngredients();
    spawnEnemies(enemyCount(lv));
    resetActors();
    updateHud();
}

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    peppers = START_PEPPERS;
    dyingTimer = 0;
    levelClearTimer = 0;
    seedRng(2463534242);
    keys.left = keys.right = keys.up = keys.down = false;
    setupLevel(1);
    state = 'running';
    hideOverlay();
    updateHud();
}

function loseLife() {
    lives -= 1;
    state = 'dying';
    dyingTimer = DYING_TIME;
    clouds.length = 0;
    updateHud();
}

function afterDeath() {
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    resetActors();
    state = 'running';
    hideOverlay();
}

function clearLevel() {
    score += LEVEL_BONUS * level;
    state = 'levelclear';
    levelClearTimer = LEVEL_CLEAR_TIME;
    showOverlay('LEVEL ' + level + ' SERVED', 'Score ' + score, 'Next order coming up…');
    updateHud();
}

function nextLevel() {
    peppers += 1;
    setupLevel(level + 1);
    state = 'running';
    hideOverlay();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try { window.localStorage.setItem(BEST_KEY, String(best)); } catch (err) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', 'Score ' + score + ' · Best ' + best, 'Press Space to cook again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function updatePlayer(dt) {
    const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (dx === 0 && dy === 0) return;
    moveActor(player, dx, dy, PLAYER_SPEED, dt);
}

function step(dt) {
    if (state === 'levelclear') {
        updatePops(dt);
        levelClearTimer -= dt;
        if (levelClearTimer <= 0) nextLevel();
        return;
    }
    if (state === 'dying') {
        updatePops(dt);
        dyingTimer -= dt;
        if (dyingTimer <= 0) afterDeath();
        return;
    }
    if (state !== 'running') return;

    updatePlayer(dt);
    stepSections();
    updateIngredients(dt);
    updateEnemies(dt);
    updateClouds(dt);
    updatePops(dt);
    if (state === 'running') checkPlayerCollisions();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    peppersEl.textContent = String(peppers);
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

const INGREDIENT_COLORS = {
    'bun-top': '#e2a355',
    'lettuce': '#6cc551',
    'patty': '#8a4b2a',
    'bun-bottom': '#d1934a',
};

const ENEMY_COLORS = ['#e2574c', '#f2e7c8', '#7fb648'];

function drawBackground() {
    ctx.fillStyle = '#120c1a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = 'rgba(246, 168, 33, 0.05)';
    for (let x = 0; x < CANVAS_W; x += TILE * 2) ctx.fillRect(x, 0, TILE, CANVAS_H);

    // Neon diner sign in the empty band above the top girder.
    const cx = CANVAS_W / 2, y = rowY(1) - 6;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(246, 168, 33, 0.16)';
    ctx.fillText('◆  D I N E R  ◆', cx, y + 2);
    ctx.fillStyle = 'rgba(246, 168, 33, 0.7)';
    ctx.fillText('◆  D I N E R  ◆', cx, y);
    ctx.restore();
}

function drawGirders() {
    for (const row of FLOOR_ROWS) {
        const y = rowY(row);
        ctx.fillStyle = '#4a6ea8';
        ctx.fillRect(0, y, CANVAS_W, GIRDER_H);
        ctx.fillStyle = '#7fa5dd';
        ctx.fillRect(0, y, CANVAS_W, 2);
        ctx.fillStyle = '#2e4874';
        for (let x = 6; x < CANVAS_W; x += 16) ctx.fillRect(x, y + 3, 4, 2);
    }
}

function drawLadders() {
    for (const l of LADDERS) {
        const cx = ladderX(l);
        const top = rowY(l.top), bottom = rowY(l.bottom);
        ctx.fillStyle = '#c8b48a';
        ctx.fillRect(cx - 10, top, 3, bottom - top);
        ctx.fillRect(cx + 7, top, 3, bottom - top);
        ctx.fillStyle = '#9d8a62';
        for (let y = top + 6; y < bottom; y += 10) ctx.fillRect(cx - 10, y, 20, 2);
    }
}

function drawPlates() {
    for (let lane = 0; lane < LANES.length; lane++) {
        const cx = laneX(lane) + INGREDIENT_W / 2;
        const y = rowY(PLATE_ROW);
        ctx.fillStyle = '#d9d9e3';
        ctx.beginPath();
        ctx.ellipse(cx, y + 2, INGREDIENT_W / 2 - 4, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a8a8b8';
        ctx.beginPath();
        ctx.ellipse(cx, y + 5, INGREDIENT_W / 2 - 10, 4, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawIngredient(ing) {
    const base = INGREDIENT_COLORS[ing.type];
    for (let s = 0; s < INGREDIENT_COLS; s++) {
        const x = ing.x + s * SECTION_W;
        const y = ing.y + (ing.sections[s] ? 3 : 0);
        ctx.fillStyle = base;
        ctx.fillRect(x, y, SECTION_W, LAYER_H);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.fillRect(x, y, SECTION_W, 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(x + SECTION_W - 1, y, 1, LAYER_H);

        if (ing.type === 'bun-top') {
            ctx.fillStyle = '#f3cf9a';
            ctx.beginPath();
            ctx.ellipse(x + SECTION_W / 2, y + 1, SECTION_W / 2, 4, 0, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = '#fff6df';
            ctx.fillRect(x + 8, y - 2, 3, 2);
            ctx.fillRect(x + 20, y - 1, 3, 2);
        } else if (ing.type === 'lettuce') {
            ctx.fillStyle = '#8ee36b';
            for (let i = 0; i < 4; i++) {
                ctx.beginPath();
                ctx.arc(x + 4 + i * 8, y + 2, 4, Math.PI, 0);
                ctx.fill();
            }
        } else if (ing.type === 'patty') {
            ctx.fillStyle = '#6b3620';
            ctx.fillRect(x + 4, y + 4, 5, 2);
            ctx.fillRect(x + 18, y + 5, 6, 2);
        }
    }
}

function drawChef() {
    const x = player.x, y = player.y;
    if (state === 'dying') {
        // Blink while the chef picks himself up.
        if (Math.floor(dyingTimer * 10) % 2 === 0) return;
        ctx.globalAlpha = 0.85;
    }
    ctx.fillStyle = '#3f6ad8';                                  // trousers
    ctx.fillRect(x - 7, y - 10, 14, 10);
    ctx.fillStyle = '#f7f3ea';                                  // whites
    ctx.fillRect(x - 8, y - 20, 16, 11);
    ctx.fillStyle = '#f0c39a';                                  // face
    ctx.fillRect(x - 5, y - 25, 10, 6);
    ctx.fillStyle = '#ffffff';                                  // hat
    ctx.fillRect(x - 7, y - 31, 14, 6);
    ctx.fillStyle = '#1b1220';                                  // eye
    ctx.fillRect(x + (player.facing >= 0 ? 1 : -3), y - 23, 2, 2);
    ctx.fillStyle = '#e2574c';                                  // scarf
    ctx.fillRect(x - 8, y - 19, 16, 2);
    ctx.globalAlpha = 1;
}

// kind 0 = hot dog, 1 = fried egg, 2 = pickle
function drawEnemy(e) {
    if (e.squashed) return;
    const x = e.x, y = e.y;
    const top = y - ENEMY_H;

    ctx.fillStyle = ENEMY_COLORS[e.kind];
    ctx.beginPath();
    ctx.roundRect(x - ENEMY_W / 2, top, ENEMY_W, ENEMY_H, e.kind === 1 ? 10 : 7);
    ctx.fill();

    if (e.kind === 0) {                                         // hot dog bun lines
        ctx.fillStyle = '#f0b078';
        ctx.fillRect(x - ENEMY_W / 2, top + 6, ENEMY_W, 3);
        ctx.fillRect(x - ENEMY_W / 2, top + ENEMY_H - 8, ENEMY_W, 3);
        ctx.fillStyle = '#f5d13c';                               // mustard squiggle
        for (let i = 0; i < 3; i++) ctx.fillRect(x - 6 + i * 5, top + 11 + (i % 2) * 2, 4, 2);
    } else if (e.kind === 1) {                                   // fried egg yolk
        ctx.fillStyle = '#f6b93b';
        ctx.beginPath();
        ctx.arc(x, top + 15, 5, 0, Math.PI * 2);
        ctx.fill();
    } else {                                                     // pickle bumps
        ctx.fillStyle = '#5f9b38';
        for (let i = 0; i < 4; i++) ctx.fillRect(x - 7 + (i % 2) * 9, top + 6 + i * 4, 4, 3);
    }

    ctx.fillStyle = '#ffffff';                                   // eyes
    ctx.fillRect(x - 6, top + 4, 5, 5);
    ctx.fillRect(x + 1, top + 4, 5, 5);
    ctx.fillStyle = '#1b1220';
    const look = e.dx >= 0 ? 2 : 0;
    ctx.fillRect(x - 5 + look, top + 5, 2, 3);
    ctx.fillRect(x + 2 + look, top + 5, 2, 3);

    if (e.stun > 0) {                                            // peppered: frozen sneeze
        ctx.strokeStyle = 'rgba(246, 168, 33, 0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x - ENEMY_W / 2, top, ENEMY_W, ENEMY_H, 7);
        ctx.stroke();
        ctx.fillStyle = 'rgba(246, 168, 33, 0.85)';
        ctx.font = 'bold 10px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', x, top - 3);
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';                       // feet shadow
    ctx.fillRect(x - 5, y - 2, 10, 2);
}

// A puff of pepper: a few soft blobs plus dark specks, fading as it expires.
const PUFFS = [
    { x: 0.22, y: 0.30, r: 0.30 }, { x: 0.52, y: 0.20, r: 0.26 },
    { x: 0.78, y: 0.38, r: 0.28 }, { x: 0.40, y: 0.62, r: 0.30 },
    { x: 0.68, y: 0.72, r: 0.24 },
];
const SPECKS = [
    { x: 0.18, y: 0.55 }, { x: 0.36, y: 0.28 }, { x: 0.50, y: 0.70 },
    { x: 0.62, y: 0.34 }, { x: 0.80, y: 0.58 }, { x: 0.30, y: 0.80 },
];

function drawClouds() {
    for (const c of clouds) {
        const life = Math.max(0, c.t / CLOUD_TIME);
        const grow = 1 + (1 - life) * 0.5;
        ctx.fillStyle = `rgba(244, 238, 226, ${0.4 + life * 0.5})`;
        for (const p of PUFFS) {
            ctx.beginPath();
            ctx.arc(c.x + p.x * c.w, c.y + p.y * c.h, p.r * c.w * 0.5 * grow, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = `rgba(52, 38, 32, ${0.55 * life})`;
        for (const s of SPECKS) {
            ctx.fillRect(c.x + s.x * c.w, c.y + s.y * c.h, 2, 2);
        }
    }
}

function drawPops() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
    for (const p of pops) {
        ctx.fillStyle = `rgba(246, 168, 33, ${Math.max(0, p.t / POP_TIME)})`;
        ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
}

function draw() {
    drawBackground();
    drawGirders();
    drawLadders();
    drawPlates();
    for (const ing of ingredients) drawIngredient(ing);
    drawClouds();
    for (const e of enemies) drawEnemy(e);
    if (state !== 'idle' && state !== 'over') drawChef();
    drawPops();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const KEY_MAP = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
};

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') firePepper();
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    const dir = KEY_MAP[e.key];
    if (dir) {
        e.preventDefault();
        keys[dir] = true;
    }
});

window.addEventListener('keyup', (e) => {
    const dir = KEY_MAP[e.key];
    if (dir) keys[dir] = false;
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function loadBest() {
    try {
        const stored = Number(window.localStorage.getItem(BEST_KEY));
        best = Number.isFinite(stored) && stored > 0 ? stored : 0;
    } catch (err) {
        best = 0;
    }
}

let lastFrame = 0;

function frame(now) {
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    step(dt);
    draw();
    window.requestAnimationFrame(frame);
}

loadBest();
buildIngredients();
resetActors();
updateHud();
showOverlay('BURGERTIME', '', 'Press Space or click Start to cook');
draw();
window.requestAnimationFrame(frame);
