// ---------------------------------------------------------------------------
// Burger Time — a single-screen arcade platformer on an HTML5 canvas.
//
// The chef runs along five girders joined by three ladders. Walking the full
// width of a burger ingredient knocks it down one floor; knock every ingredient
// onto the plates at the bottom to clear the level, while dodging (or peppering,
// or flattening) the food that hunts you.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per-second and advanced
// through `step(dt)`, and nothing in the model reads the wall clock or
// Math.random(), so the tests can simulate exact frames deterministically.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 480;
const TILE_W = 40;
const COLS = CANVAS_W / TILE_W;            // 15

// Girder surface y for each level, top (0) to bottom (4).
const LEVEL_Y = [60, 140, 220, 300, 380];
const PLATE_LEVEL = LEVEL_Y.length - 1;    // 4 — ingredients that land here are served
// The plates sit on a shelf below the bottom girder, so the chef can still walk
// that girder while finished burgers pile up underneath him.
const PLATE_Y = 460;

// Four burger stacks, three tiles wide, with a ladder in each gap.
const STACK_COUNT = 4;
const STACK_TILES = 3;
const LADDER_COLS = [3, 7, 11];
const LADDER_W = 26;

// --- Ingredients ---
const ING_H = 14;
const ING_W = STACK_TILES * TILE_W;        // 120
const INGREDIENT_KINDS = ['bunTop', 'lettuce', 'patty', 'bunHeel'];
const INGREDIENTS_PER_STACK = INGREDIENT_KINDS.length;
const FALL_SPEED = 220;
const DROP_POINTS = 50;
const LEVEL_BONUS = 1000;
const SQUASH_POINTS = 100;

// --- Chef ---
const CHEF_W = 22;
const CHEF_H = 30;
const WALK_SPEED = 110;
const CLIMB_SPEED = 90;
const LADDER_SNAP = 9;                     // how close to a ladder you must be to climb
const FLOOR_SNAP = 4;                      // how close to a girder you must be to walk
const START_LIVES = 3;
const START_PEPPERS = 5;

// --- Enemies ---
const ENEMY_W = 22;
const ENEMY_H = 28;
const ENEMY_BASE = 55;
const ENEMY_STEP = 12;                     // extra px/s per level
const RESPAWN_TIME = 3;
const ENEMY_KINDS = ['hotdog', 'egg', 'pickle', 'hotdog'];
const SPAWNS = [
    { level: 0, x: 20 },
    { level: 0, x: 580 },
    { level: 1, x: 20 },
    { level: 1, x: 580 },
];

// --- Pepper ---
const PEPPER_REACH = 40;
const STUN_TIME = 4;
const CLOUD_TIME = 0.4;

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
let state, score, best, level, lives, peppers;
const chef = { x: CANVAS_W / 2, y: LEVEL_Y[PLATE_LEVEL], dirX: 0, dirY: 0, facing: 1, walk: 0 };
const ingredients = [];
const enemies = [];
const clouds = [];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** First column of stack `s` (stacks are separated by one ladder column). */
function stackStartCol(s) { return s * (STACK_TILES + 1); }

/** Left edge in pixels of stack `s`. */
function stackX(s) { return stackStartCol(s) * TILE_W; }

/** Centre x of ladder `i`. */
function ladderX(i) { return LADDER_COLS[i] * TILE_W + TILE_W / 2; }

/** Centre x of whichever ladder is closest to `x`. */
function nearestLadderX(x) {
    let bestX = ladderX(0);
    for (let i = 1; i < LADDER_COLS.length; i++) {
        if (Math.abs(ladderX(i) - x) < Math.abs(bestX - x)) bestX = ladderX(i);
    }
    return bestX;
}

/** Index of the level whose girder is nearest to `y`. */
function nearestFloorLevel(y) {
    let bestI = 0;
    for (let i = 1; i < LEVEL_Y.length; i++) {
        if (Math.abs(LEVEL_Y[i] - y) < Math.abs(LEVEL_Y[bestI] - y)) bestI = i;
    }
    return bestI;
}

/** Level index when `y` is exactly on a girder, otherwise -1. */
function floorLevelAt(y) {
    const i = nearestFloorLevel(y);
    return Math.abs(LEVEL_Y[i] - y) < 0.001 ? i : -1;
}

function rectsOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function chefRect() {
    return { x: chef.x - CHEF_W / 2, y: chef.y - CHEF_H, w: CHEF_W, h: CHEF_H };
}

function enemyRect(e) {
    return { x: e.x - ENEMY_W / 2, y: e.y - ENEMY_H, w: ENEMY_W, h: ENEMY_H };
}

function ingRect(ing) {
    return { x: stackX(ing.stack), y: ing.y, w: ING_W, h: ING_H };
}

// ---------------------------------------------------------------------------
// Difficulty (a pure function of `level`)
// ---------------------------------------------------------------------------

function enemySpeed() { return ENEMY_BASE + (level - 1) * ENEMY_STEP; }
function enemyCount() { return Math.min(SPAWNS.length, 1 + level); }

// ---------------------------------------------------------------------------
// Board setup
// ---------------------------------------------------------------------------

function restY(levelIndex) {
    if (levelIndex >= PLATE_LEVEL) return PLATE_Y - ING_H;
    return LEVEL_Y[levelIndex] - ING_H;
}

function buildBoard() {
    ingredients.length = 0;
    for (let s = 0; s < STACK_COUNT; s++) {
        for (let i = 0; i < INGREDIENTS_PER_STACK; i++) {
            ingredients.push({
                stack: s,
                kind: INGREDIENT_KINDS[i],
                level: i,
                y: restY(i),
                state: 'rest',                 // 'rest' | 'falling' | 'plated'
                stepped: [false, false, false],
                targetLevel: i,
                squashes: 0,
            });
        }
    }
}

function spawnEnemy(levelIndex, x) {
    const e = {
        kind: ENEMY_KINDS[enemies.length % ENEMY_KINDS.length],
        x,
        y: LEVEL_Y[levelIndex],
        homeX: x,
        homeY: LEVEL_Y[levelIndex],
        dirX: 0,
        dirY: 0,
        stun: 0,
        alive: true,
        respawn: 0,
        wobble: 0,
    };
    enemies.push(e);
    return e;
}

function populateEnemies() {
    enemies.length = 0;
    const n = enemyCount();
    for (let i = 0; i < n; i++) spawnEnemy(SPAWNS[i].level, SPAWNS[i].x);
}

/** Put the chef and every enemy back on their starting marks. */
function resetPositions() {
    chef.x = CANVAS_W / 2;
    chef.y = LEVEL_Y[PLATE_LEVEL];
    chef.dirX = 0;
    chef.dirY = 0;
    chef.facing = 1;
    for (const e of enemies) {
        e.x = e.homeX;
        e.y = e.homeY;
        e.dirX = 0;
        e.dirY = 0;
        e.stun = 0;
        e.alive = true;
        e.respawn = 0;
    }
    clouds.length = 0;
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

/** The ingredient resting on the girder at (stack, level), if any. */
function ingredientAt(stack, levelIndex) {
    return ingredients.find(
        (i) => i.stack === stack && i.level === levelIndex && i.state === 'rest'
    ) || null;
}

/** The resting ingredient under grid column `col` on `levelIndex`, if any. */
function ingredientAtCol(col, levelIndex) {
    for (const ing of ingredients) {
        if (ing.state !== 'rest' || ing.level !== levelIndex) continue;
        const start = stackStartCol(ing.stack);
        if (col >= start && col < start + STACK_TILES) return ing;
    }
    return null;
}

function platedCount(stack) {
    return ingredients.filter((i) => i.stack === stack && i.state === 'plated').length;
}

/** Knock a resting ingredient loose so it falls one level. */
function dropIngredient(ing) {
    if (!ing || ing.state !== 'rest') return;
    ing.state = 'falling';
    ing.targetLevel = ing.level + 1;
    ing.stepped = [false, false, false];
    ing.squashes = 0;
    score += DROP_POINTS;
    updateHud();
}

function updateIngredients(dt) {
    // Resolve the lowest faller first so that ingredients arriving at a plate in
    // the same frame stack in the right order.
    const falling = ingredients.filter((i) => i.state === 'falling').sort((a, b) => b.y - a.y);

    for (const ing of falling) {
        ing.y += FALL_SPEED * dt;

        // Anything caught under a falling ingredient is flattened, and each
        // extra enemy in the same drop is worth double the last.
        for (const e of enemies) {
            if (!e.alive) continue;
            if (rectsOverlap(ingRect(ing), enemyRect(e))) {
                e.alive = false;
                e.respawn = RESPAWN_TIME;
                score += SQUASH_POINTS * Math.pow(2, ing.squashes);
                ing.squashes++;
            }
        }

        const toPlate = ing.targetLevel >= PLATE_LEVEL;
        const targetY = toPlate
            ? restY(PLATE_LEVEL) - platedCount(ing.stack) * ING_H
            : restY(ing.targetLevel);
        if (ing.y < targetY) continue;

        ing.y = targetY;
        ing.stepped = [false, false, false];
        if (toPlate) {
            ing.state = 'plated';
            ing.level = PLATE_LEVEL;
        } else {
            // Landing on another ingredient knocks that one down a level too.
            dropIngredient(ingredientAt(ing.stack, ing.targetLevel));
            ing.state = 'rest';
            ing.level = ing.targetLevel;
        }
    }
}

/** Mark the tile under the chef and drop the ingredient once all three are pressed. */
function treadIngredients() {
    const lvl = floorLevelAt(chef.y);
    if (lvl < 0) return;
    const col = clamp(Math.floor(chef.x / TILE_W), 0, COLS - 1);
    const ing = ingredientAtCol(col, lvl);
    if (!ing) return;
    const idx = col - stackStartCol(ing.stack);
    if (ing.stepped[idx]) return;
    ing.stepped[idx] = true;
    if (ing.stepped.every(Boolean)) dropIngredient(ing);
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function placeChef(levelIndex, x) {
    chef.x = clamp(x, CHEF_W / 2, CANVAS_W - CHEF_W / 2);
    chef.y = LEVEL_Y[levelIndex];
    chef.dirX = 0;
    chef.dirY = 0;
}

function moveChef(dx, dy) {
    chef.dirX = Math.sign(dx);
    chef.dirY = Math.sign(dy);
    if (chef.dirX !== 0) chef.facing = chef.dirX;
}

function updateChef(dt) {
    const lx = nearestLadderX(chef.x);
    if (chef.dirY !== 0 && Math.abs(chef.x - lx) <= LADDER_SNAP) {
        chef.x = lx;
        chef.y = clamp(chef.y + chef.dirY * CLIMB_SPEED * dt, LEVEL_Y[0], LEVEL_Y[PLATE_LEVEL]);
        chef.walk += CLIMB_SPEED * dt;
        return;
    }
    if (chef.dirX === 0) return;
    const lvl = nearestFloorLevel(chef.y);
    if (Math.abs(chef.y - LEVEL_Y[lvl]) > FLOOR_SNAP) return;
    chef.y = LEVEL_Y[lvl];
    chef.x = clamp(chef.x + chef.dirX * WALK_SPEED * dt, CHEF_W / 2, CANVAS_W - CHEF_W / 2);
    chef.walk += WALK_SPEED * dt;
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function pepperRect() {
    const x = chef.facing > 0 ? chef.x + CHEF_W / 2 : chef.x - CHEF_W / 2 - PEPPER_REACH;
    return { x, y: chef.y - CHEF_H, w: PEPPER_REACH, h: CHEF_H };
}

function sprayPepper() {
    if (state !== 'running' || peppers <= 0) return;
    peppers--;
    const cloud = pepperRect();
    clouds.push({ ...cloud, t: CLOUD_TIME });
    for (const e of enemies) {
        if (e.alive && rectsOverlap(cloud, enemyRect(e))) e.stun = STUN_TIME;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function enemyThink(e) {
    const lvl = floorLevelAt(e.y);
    if (lvl < 0) return;                       // mid-ladder: keep going
    const target = nearestFloorLevel(chef.y);
    if (target === lvl) {
        e.dirX = Math.sign(chef.x - e.x) || 1;
        e.dirY = 0;
        return;
    }
    const lx = nearestLadderX(e.x);
    if (Math.abs(e.x - lx) <= LADDER_SNAP) {
        e.x = lx;
        e.dirY = target > lvl ? 1 : -1;
        e.dirX = 0;
    } else {
        e.dirX = Math.sign(lx - e.x);
        e.dirY = 0;
    }
}

function updateEnemy(e, dt) {
    if (!e.alive) {
        e.respawn -= dt;
        if (e.respawn <= 0) {
            e.alive = true;
            e.x = e.homeX;
            e.y = e.homeY;
            e.dirX = 0;
            e.dirY = 0;
        }
        return;
    }
    if (e.stun > 0) {
        e.stun = Math.max(0, e.stun - dt);
        return;
    }

    enemyThink(e);
    const speed = enemySpeed();
    if (e.dirY !== 0) {
        const prev = e.y;
        e.y = clamp(e.y + e.dirY * speed * dt, LEVEL_Y[0], LEVEL_Y[PLATE_LEVEL]);
        for (const ly of LEVEL_Y) {          // stop on the next girder reached
            if ((prev < ly && e.y >= ly) || (prev > ly && e.y <= ly)) {
                e.y = ly;
                e.dirY = 0;
                break;
            }
        }
    } else if (e.dirX !== 0) {
        e.x = clamp(e.x + e.dirX * speed * dt, ENEMY_W / 2, CANVAS_W - ENEMY_W / 2);
    }
    e.wobble += speed * dt;
}

function checkChefCaught() {
    for (const e of enemies) {
        if (!e.alive || e.stun > 0) continue;
        if (rectsOverlap(chefRect(), enemyRect(e))) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function loseLife() {
    lives--;
    updateHud();
    if (lives <= 0) {
        endGame();
        return;
    }
    resetPositions();
}

function checkLevelComplete() {
    if (!ingredients.every((i) => i.state === 'plated')) return;
    level++;
    score += LEVEL_BONUS;
    buildBoard();
    populateEnemies();
    resetPositions();
    updateHud();
}

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    peppers = START_PEPPERS;
    buildBoard();
    populateEnemies();
    resetPositions();
    state = 'running';
    overlay.classList.remove('visible');
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (_) { /* private mode */ }
    }
    overlayTitle.textContent = 'GAME OVER';
    overlayScore.textContent = `Score ${score} · Level ${level}`;
    overlaySub.textContent = 'Press Enter to cook again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        overlayTitle.textContent = 'PAUSED';
        overlayScore.textContent = `Score ${score}`;
        overlaySub.textContent = 'Press P to resume';
        btnStart.textContent = 'Resume';
        overlay.classList.add('visible');
    } else if (state === 'paused') {
        state = 'running';
        overlay.classList.remove('visible');
    }
}

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    peppersEl.textContent = String(peppers);
    bestEl.textContent = String(best);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    updateChef(dt);
    treadIngredients();
    updateIngredients(dt);
    for (const e of enemies) updateEnemy(e, dt);
    for (let i = clouds.length - 1; i >= 0; i--) {
        clouds[i].t -= dt;
        if (clouds[i].t <= 0) clouds.splice(i, 1);
    }
    checkChefCaught();
    if (state === 'running') checkLevelComplete();
    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ING_COLORS = {
    bunTop: ['#f0b463', '#cf9040'],
    lettuce: ['#8ed94f', '#5fa62c'],
    patty: ['#b3603a', '#7d3d21'],
    bunHeel: ['#e0a355', '#b8813a'],
};

function drawGirders() {
    for (const y of LEVEL_Y) {
        ctx.fillStyle = '#46587a';
        ctx.fillRect(0, y, CANVAS_W, 6);
        ctx.fillStyle = '#6d83ad';
        for (let x = 2; x < CANVAS_W; x += 10) ctx.fillRect(x, y, 5, 2);
        ctx.fillStyle = '#2b374f';
        ctx.fillRect(0, y + 6, CANVAS_W, 2);
    }
}

function drawLadders() {
    ctx.strokeStyle = '#8f9bb3';
    ctx.lineWidth = 3;
    for (let i = 0; i < LADDER_COLS.length; i++) {
        const cx = ladderX(i);
        const top = LEVEL_Y[0];
        const bottom = LEVEL_Y[PLATE_LEVEL];
        ctx.beginPath();
        ctx.moveTo(cx - LADDER_W / 2, top);
        ctx.lineTo(cx - LADDER_W / 2, bottom);
        ctx.moveTo(cx + LADDER_W / 2, top);
        ctx.lineTo(cx + LADDER_W / 2, bottom);
        ctx.stroke();
        ctx.lineWidth = 2;
        for (let y = top + 10; y < bottom; y += 12) {
            ctx.beginPath();
            ctx.moveTo(cx - LADDER_W / 2, y);
            ctx.lineTo(cx + LADDER_W / 2, y);
            ctx.stroke();
        }
        ctx.lineWidth = 3;
    }
}

function drawPlates() {
    // The counter the plates stand on.
    ctx.fillStyle = '#241812';
    ctx.fillRect(0, PLATE_Y + 6, CANVAS_W, CANVAS_H - PLATE_Y - 6);
    ctx.fillStyle = '#3a2619';
    ctx.fillRect(0, PLATE_Y + 6, CANVAS_W, 3);

    for (let s = 0; s < STACK_COUNT; s++) {
        const cx = stackX(s) + ING_W / 2;
        ctx.fillStyle = '#d7dee8';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 2, ING_W / 2 - 6, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#98a5b8';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 5, ING_W / 2 - 6, 6, 0, 0, Math.PI);
        ctx.fill();
    }
}

function drawIngredient(ing) {
    const x = stackX(ing.stack);
    const colors = ING_COLORS[ing.kind] || ['#d89a4e', '#b87e39'];
    for (let t = 0; t < STACK_TILES; t++) {
        const sunk = ing.state === 'rest' && ing.stepped[t] ? 4 : 0;
        const tx = x + t * TILE_W;
        ctx.fillStyle = colors[0];
        ctx.fillRect(tx, ing.y + sunk, TILE_W, ING_H);
        ctx.fillStyle = colors[1];
        ctx.fillRect(tx, ing.y + sunk + ING_H - 4, TILE_W, 4);
        if (ing.kind === 'bunTop') {
            ctx.fillStyle = '#f3d9a6';
            ctx.fillRect(tx + 8, ing.y + sunk + 3, 4, 3);
            ctx.fillRect(tx + 24, ing.y + sunk + 6, 4, 3);
        }
        if (ing.kind === 'lettuce') {
            ctx.fillStyle = '#9ade5f';
            ctx.fillRect(tx + 4, ing.y + sunk + 2, 12, 4);
            ctx.fillRect(tx + 22, ing.y + sunk + 4, 12, 4);
        }
    }
}

function drawChef() {
    const x = chef.x;
    const y = chef.y;
    const stride = Math.sin(chef.walk / 9) * 4;
    ctx.fillStyle = '#f5ecdf';                                   // toque
    ctx.fillRect(x - 9, y - CHEF_H, 18, 7);
    ctx.fillStyle = '#e2d9c6';
    ctx.fillRect(x - 9, y - CHEF_H + 6, 18, 2);
    ctx.fillStyle = '#f0c9a0';                                   // face
    ctx.fillRect(x - 7, y - CHEF_H + 8, 14, 7);
    ctx.fillStyle = '#1b1b1b';                                   // eye
    ctx.fillRect(x + (chef.facing > 0 ? 2 : -5), y - CHEF_H + 10, 3, 3);
    ctx.fillStyle = '#e8e2d4';                                   // whites
    ctx.fillRect(x - 8, y - CHEF_H + 15, 16, 9);
    ctx.fillStyle = '#f0c9a0';                                   // arms
    ctx.fillRect(x - 11, y - CHEF_H + 16 - stride / 2, 3, 6);
    ctx.fillRect(x + 8, y - CHEF_H + 16 + stride / 2, 3, 6);
    ctx.fillStyle = '#3b6ea5';                                   // legs
    ctx.fillRect(x - 7 + stride, y - 6, 6, 6);
    ctx.fillRect(x + 1 - stride, y - 6, 6, 6);
}

function drawEnemy(e) {
    if (!e.alive) return;
    const x = e.x;
    const y = e.y;
    const bob = Math.sin(e.wobble / 10) * 2;
    const body = e.kind === 'hotdog' ? '#c8622f' : e.kind === 'egg' ? '#f3f0e2' : '#6aa84f';
    ctx.fillStyle = e.stun > 0 ? '#7c8aa5' : body;
    ctx.fillRect(x - ENEMY_W / 2, y - ENEMY_H + bob, ENEMY_W, ENEMY_H - 6);
    ctx.fillStyle = '#101010';
    ctx.fillRect(x - 6, y - ENEMY_H + 8 + bob, 4, 4);
    ctx.fillRect(x + 2, y - ENEMY_H + 8 + bob, 4, 4);
    ctx.fillStyle = e.stun > 0 ? '#55607a' : '#2b2b2b';
    ctx.fillRect(x - 8, y - 6, 6, 6);
    ctx.fillRect(x + 2, y - 6, 6, 6);
}

function drawClouds() {
    for (const c of clouds) {
        ctx.fillStyle = `rgba(226, 214, 190, ${clamp(c.t / CLOUD_TIME, 0, 1) * 0.75})`;
        for (let i = 0; i < 5; i++) {
            const px = c.x + (i * 9) % c.w;
            const py = c.y + ((i * 13) % c.h);
            ctx.beginPath();
            ctx.arc(px, py, 7, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#0b0704';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawPlates();
    drawLadders();
    drawGirders();
    for (const ing of ingredients) drawIngredient(ing);
    drawClouds();
    for (const e of enemies) drawEnemy(e);
    drawChef();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
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

function heldAny(keys) { return keys.some((k) => heldKeys.has(k)); }

function refreshKeyDir() {
    const dx = (heldAny(RIGHT_KEYS) ? 1 : 0) - (heldAny(LEFT_KEYS) ? 1 : 0);
    const dy = (heldAny(DOWN_KEYS) ? 1 : 0) - (heldAny(UP_KEYS) ? 1 : 0);
    moveChef(dx, dy);
}

window.addEventListener('keydown', (e) => {
    if (MOVE_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshKeyDir();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.code === 'Space') {
        sprayPepper();
        e.preventDefault();
        return;
    }
    if (e.key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshKeyDir();
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
level = 1;
lives = START_LIVES;
peppers = START_PEPPERS;
buildBoard();
populateEnemies();
resetPositions();
updateHud();
requestAnimationFrame(frame);
