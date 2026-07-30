// ---------------------------------------------------------------------------
// BurgerTime — a ladders-and-girders arcade game on an HTML5 canvas.
//
// Chef Peter Pepper walks the length of giant burger ingredients to drop them
// floor by floor onto the plates below, while Mr. Hot Dog and friends chase him
// around the girders. Written as a single classic (non-module) script so the
// game state and logic are reachable from the Playwright tests as plain
// globals, mirroring Kaboom, Snake and Tetris in this repo. All motion is
// expressed per second and advanced through `step(dt)`, so tests can simulate
// frames deterministically without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 480;
const MARGIN = 16;                       // how close a mover may get to an edge

const FLOOR_COUNT = 5;                   // walkable girders
const PLATE_FLOOR = FLOOR_COUNT;         // pseudo-floor: the plates at the bottom
const FLOOR_Y = [90, 162, 234, 306, 378, 444]; // last entry is the plate row

const LADDER_XS = [180, 392, 604];
const LADDER_W = 28;
const LADDER_TOL = 8;                    // how close to a ladder you must be to climb
const FLOOR_SNAP = 8;                    // how close to a girder you may step off a ladder

// --- Ingredients ---
const SEG_COUNT = 4;                     // segments per ingredient
const SEG_W = 24;
const ING_W = SEG_COUNT * SEG_W;         // 96
const ING_H = 12;
const BURGER_X = [60, 272, 484];         // left edge of each burger column
const INGREDIENT_TYPES = ['bunTop', 'patty', 'bunBottom'];

// --- Speeds (px/s) ---
const CHEF_SPEED = 110;
const FALL_SPEED = 200;
const ENEMY_BASE = 62, ENEMY_STEP = 10;

// --- Enemies ---
const ENEMY_KINDS = ['hotdog', 'egg', 'pickle'];
const ENEMY_RESPAWN = 3;                 // seconds between reinforcements
const ENEMY_SPAWNS = [
    { x: 24, y: FLOOR_Y[FLOOR_COUNT - 1] },
    { x: CANVAS_W - 24, y: FLOOR_Y[FLOOR_COUNT - 1] },
    { x: 24, y: FLOOR_Y[0] },
    { x: CANVAS_W - 24, y: FLOOR_Y[0] },
];
const HIT_X = 14, HIT_Y = 18;            // chef/enemy contact box

// --- Pepper ---
const PEPPER_START = 5;
const PEPPER_MAX = 9;
const PEPPER_REFILL = 3;
const PEPPER_RANGE = 70;
const PEPPER_STUN = 2.5;                 // seconds an enemy stays dazed
const PEPPER_CLOUD_TIME = 0.45;

// --- Scoring ---
const DROP_POINTS = 50;                  // per ingredient, per floor landed on
const PLATE_POINTS = 100;                // per ingredient reaching a plate
const SQUASH_POINTS = 300;
const STUN_POINTS = 20;
const LEVEL_BONUS = 1000;

const START_LIVES = 3;
const CHEF_START_X = LADDER_XS[1];
const BEST_KEY = 'burgertime-best';

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const pepperEl = document.getElementById('pepper');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state = 'idle';
let score = 0;
let best = 0;
let level = 1;
let lives = START_LIVES;
let pepper = PEPPER_START;
let enemyTimer = ENEMY_RESPAWN;
let enemySpawnIndex = 0;
let pepperCloud = null;

const chef = { x: CHEF_START_X, y: FLOOR_Y[FLOOR_COUNT - 1], ix: 0, iy: 0, face: 1, stopAtFloor: null, anim: 0 };
const enemies = [];
const ingredients = [];
const fallingGroups = [];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function floorY(i) { return FLOOR_Y[i]; }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Index of the floor a y sits exactly on, or -1 when between floors.
function onFloorIndex(y) {
    for (let i = 0; i < FLOOR_COUNT; i++) {
        if (Math.abs(y - floorY(i)) < 0.001) return i;
    }
    return -1;
}

// Index of a floor within `tol` pixels of y, or -1.
function nearFloorIndex(y, tol) {
    for (let i = 0; i < FLOOR_COUNT; i++) {
        if (Math.abs(y - floorY(i)) <= tol) return i;
    }
    return -1;
}

// Index of the nearest floor, used for "which floor is that mover heading for".
function moverFloor(m) {
    let bestIdx = 0;
    for (let i = 1; i < FLOOR_COUNT; i++) {
        if (Math.abs(m.y - floorY(i)) < Math.abs(m.y - floorY(bestIdx))) bestIdx = i;
    }
    return bestIdx;
}

function ladderNear(x) {
    for (const lx of LADDER_XS) {
        if (Math.abs(x - lx) <= LADDER_TOL) return lx;
    }
    return null;
}

function nearestLadderX(x) {
    return LADDER_XS.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
}

// Floor line passed while moving from y0 to y1, or -1.
function crossedFloor(y0, y1) {
    for (let i = 0; i < FLOOR_COUNT; i++) {
        const fy = floorY(i);
        if ((y0 < fy && y1 >= fy) || (y0 > fy && y1 <= fy)) return i;
    }
    return -1;
}

// Shared movement for the chef and the enemies: climb when lined up with a
// ladder, otherwise walk along the girder you are standing on.
function moveMover(m, dt, speed) {
    if (m.iy !== 0) {
        const lx = ladderNear(m.x);
        if (lx !== null) {
            const top = floorY(0);
            const bottom = floorY(FLOOR_COUNT - 1);
            let ny = clamp(m.y + m.iy * speed * dt, top, bottom);
            const crossed = crossedFloor(m.y, ny);
            // Step off the ladder when you meant to walk, or when an enemy has
            // reached the floor it was aiming for.
            if (crossed !== -1 && (m.ix !== 0 || m.stopAtFloor === crossed)) {
                ny = floorY(crossed);
                m.iy = 0;
                m.stopAtFloor = null;
            }
            if (ny !== m.y) {
                m.x = lx;
                m.y = ny;
                m.anim += speed * dt;
                return;
            }
        }
    }
    if (m.ix !== 0) {
        // Stepping off a ladder is forgiving: walking while within a few pixels
        // of a girder snaps you onto it, so leaving a ladder never needs
        // frame-perfect timing.
        const near = nearFloorIndex(m.y, FLOOR_SNAP);
        if (near === -1) return;
        m.y = floorY(near);
        m.iy = 0;
        m.stopAtFloor = null;
        m.x = clamp(m.x + m.ix * speed * dt, MARGIN, CANVAS_W - MARGIN);
        m.face = m.ix;
        m.anim += speed * dt;
    }
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

function enemySpeed(lvl) { return ENEMY_BASE + (lvl - 1) * ENEMY_STEP; }
function maxEnemies(lvl) { return Math.min(5, 2 + Math.floor((lvl - 1) / 2)); }

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

function restY(floor, stack) {
    return floorY(floor) - ING_H * (1 + stack);
}

function buildLevel() {
    ingredients.length = 0;
    fallingGroups.length = 0;
    BURGER_X.forEach((x0, col) => {
        INGREDIENT_TYPES.forEach((type, i) => {
            ingredients.push({
                col,
                x: x0,
                type,
                floor: i,
                stack: 0,
                segs: new Array(SEG_COUNT).fill(false),
                falling: false,
                y: restY(i, 0),
            });
        });
    });
}

function restingAt(col, floor) {
    return ingredients
        .filter((i) => i.col === col && i.floor === floor && !i.falling)
        .sort((a, b) => a.stack - b.stack);
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function setChefPos(x, y) {
    chef.x = clamp(x, MARGIN, CANVAS_W - MARGIN);
    chef.y = clamp(y, floorY(0), floorY(FLOOR_COUNT - 1));
}

function moveChef(dx, dy) {
    chef.ix = dx;
    chef.iy = dy;
    if (dx !== 0) chef.face = dx;
}

// Press whichever ingredient segment the chef is standing on. Only the top
// ingredient of a stack can be walked, and dropping it drops the whole stack.
function pressIngredients() {
    const f = onFloorIndex(chef.y);
    if (f === -1) return;
    let top = null;
    for (const ing of ingredients) {
        if (ing.falling || ing.floor !== f) continue;
        if (chef.x < ing.x || chef.x > ing.x + ING_W) continue;
        if (!top || ing.stack > top.stack) top = ing;
    }
    if (!top) return;
    const idx = clamp(Math.floor((chef.x - top.x) / SEG_W), 0, SEG_COUNT - 1);
    top.segs[idx] = true;
    if (top.segs.every(Boolean)) dropCell(top.col, top.floor);
}

// ---------------------------------------------------------------------------
// Falling ingredients
// ---------------------------------------------------------------------------

// Drop everything resting at (col, floor) one floor down.
function dropCell(col, floor) {
    if (floor >= PLATE_FLOOR) return null;
    const items = restingAt(col, floor);
    if (!items.length) return null;
    items.forEach((it) => { it.falling = true; });
    const group = { col, targetFloor: floor + 1, items };
    fallingGroups.push(group);
    return group;
}

// Test/debug helper: drop the stack an ingredient belongs to.
function forceDrop(ing) {
    if (!ing || ing.falling) return null;
    return dropCell(ing.col, ing.floor);
}

function settleGroup(group) {
    const floor = group.targetFloor;
    let stack = restingAt(group.col, floor).length;
    const points = floor >= PLATE_FLOOR ? PLATE_POINTS : DROP_POINTS;
    group.items.forEach((it) => {
        it.floor = floor;
        it.stack = stack++;
        it.falling = false;
        it.segs.fill(false);
        it.y = restY(floor, it.stack);
    });
    score += points * group.items.length;
}

function squashCheck(group) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        const hit = group.items.some(
            (it) =>
                e.x > it.x - 6 &&
                e.x < it.x + ING_W + 6 &&
                e.y > it.y &&
                e.y - HIT_Y < it.y + ING_H
        );
        if (hit) {
            enemies.splice(i, 1);
            score += SQUASH_POINTS;
        }
    }
}

function updateFalling(dt) {
    for (let g = fallingGroups.length - 1; g >= 0; g--) {
        const group = fallingGroups[g];
        group.items.forEach((it) => { it.y += FALL_SPEED * dt; });
        squashCheck(group);

        const lead = group.items[0]; // bottom-most ingredient of the stack
        const landing = restY(group.targetFloor, restingAt(group.col, group.targetFloor).length);
        if (lead.y < landing) continue;

        const resting = restingAt(group.col, group.targetFloor);
        if (group.targetFloor < PLATE_FLOOR && resting.length) {
            // Land on top of the resting stack and carry it one floor further.
            resting.forEach((it) => { it.falling = true; });
            group.items = resting.concat(group.items);
            group.targetFloor += 1;
            const base = group.items[0].y;
            group.items.forEach((it, i) => { it.y = base - i * ING_H; });
            continue;
        }

        settleGroup(group);
        fallingGroups.splice(g, 1);
        if (ingredients.every((i) => i.floor === PLATE_FLOOR)) nextLevel();
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemy(opts) {
    opts = opts || {};
    const spawn = ENEMY_SPAWNS[enemySpawnIndex % ENEMY_SPAWNS.length];
    const e = {
        x: opts.x != null ? opts.x : spawn.x,
        y: opts.y != null ? opts.y : spawn.y,
        kind: opts.kind || ENEMY_KINDS[enemySpawnIndex % ENEMY_KINDS.length],
        stunned: opts.stunned != null ? opts.stunned : 0,
        ix: 0,
        iy: 0,
        face: -1,
        stopAtFloor: null,
        anim: 0,
    };
    enemySpawnIndex += 1;
    enemies.push(e);
    return e;
}

// Greedy chase: same floor -> walk at the chef; otherwise take the nearest
// ladder toward the chef's floor.
function aimEnemy(e) {
    const here = onFloorIndex(e.y);
    const target = moverFloor(chef);
    if (here === -1) {
        e.ix = 0;
        e.iy = e.stopAtFloor != null ? Math.sign(floorY(e.stopAtFloor) - e.y) || -1 : -1;
        return;
    }
    if (here === target) {
        e.iy = 0;
        e.stopAtFloor = null;
        e.ix = Math.sign(chef.x - e.x) || 1;
        return;
    }
    const lx = nearestLadderX(e.x);
    if (Math.abs(e.x - lx) <= LADDER_TOL) {
        e.x = lx;
        e.ix = 0;
        e.iy = Math.sign(target - here);
        e.stopAtFloor = target;
    } else {
        e.iy = 0;
        e.ix = Math.sign(lx - e.x);
    }
}

function updateEnemies(dt) {
    enemyTimer -= dt;
    if (enemyTimer <= 0) {
        if (enemies.length < maxEnemies(level)) spawnEnemy();
        enemyTimer = ENEMY_RESPAWN;
    }
    for (const e of enemies) {
        if (e.stunned > 0) {
            e.stunned = Math.max(0, e.stunned - dt);
            continue;
        }
        aimEnemy(e);
        moveMover(e, dt, enemySpeed(level));
    }
}

function checkChefHit() {
    for (const e of enemies) {
        if (e.stunned > 0) continue;
        if (Math.abs(e.x - chef.x) < HIT_X && Math.abs(e.y - chef.y) < HIT_Y) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function applyPepper() {
    if (!pepperCloud) return;
    for (const e of enemies) {
        if (e.x < pepperCloud.x0 || e.x > pepperCloud.x1) continue;
        if (Math.abs(e.y - pepperCloud.y) > 24) continue;
        if (e.stunned <= 0) score += STUN_POINTS;
        e.stunned = PEPPER_STUN;
        e.ix = 0;
        e.iy = 0;
    }
}

function sprayPepper() {
    if (state !== 'running' || pepper <= 0) return false;
    pepper -= 1;
    const dir = chef.face >= 0 ? 1 : -1;
    const x0 = dir > 0 ? chef.x : chef.x - PEPPER_RANGE;
    pepperCloud = { x0, x1: x0 + PEPPER_RANGE, y: chef.y, t: PEPPER_CLOUD_TIME };
    applyPepper();
    updateHud();
    return true;
}

function updateEffects(dt) {
    if (!pepperCloud) return;
    pepperCloud.t -= dt;
    applyPepper();
    if (pepperCloud.t <= 0) pepperCloud = null;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function resetPositions() {
    chef.x = CHEF_START_X;
    chef.y = floorY(FLOOR_COUNT - 1);
    chef.ix = 0;
    chef.iy = 0;
    chef.face = 1;
    chef.stopAtFloor = null;
    enemies.length = 0;
    enemySpawnIndex = 0;
    for (let i = 0; i < maxEnemies(level); i++) spawnEnemy();
    enemyTimer = ENEMY_RESPAWN;
    pepperCloud = null;
}

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    pepper = PEPPER_START;
    buildLevel();
    resetPositions();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    score += LEVEL_BONUS;
    pepper = Math.min(PEPPER_MAX, pepper + PEPPER_REFILL);
    buildLevel();
    resetPositions();
    updateHud();
}

function loseLife() {
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        updateHud();
        endGame();
        return;
    }
    resetPositions();
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { window.localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} — Level ${level}`, 'Press Space to play again', 'Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function step(dt) {
    if (state !== 'running') return;
    moveMover(chef, dt, CHEF_SPEED);
    pressIngredients();
    updateFalling(dt);
    updateEnemies(dt);
    updateEffects(dt);
    checkChefHit();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    pepperEl.textContent = String(pepper);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreLine, sub, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function loadBest() {
    try {
        best = parseInt(window.localStorage.getItem(BEST_KEY), 10) || 0;
    } catch (e) {
        best = 0;
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawGirders() {
    for (let i = 0; i < FLOOR_COUNT; i++) {
        const y = floorY(i);
        ctx.fillStyle = '#3d5aa8';
        ctx.fillRect(0, y, CANVAS_W, 4);
        ctx.fillStyle = '#26386b';
        for (let x = 4; x < CANVAS_W; x += 16) ctx.fillRect(x, y + 4, 8, 3);
    }
}

function drawLadders() {
    const top = floorY(0);
    const bottom = floorY(FLOOR_COUNT - 1);
    ctx.strokeStyle = '#7f8ba8';
    ctx.lineWidth = 3;
    for (const lx of LADDER_XS) {
        ctx.beginPath();
        ctx.moveTo(lx - LADDER_W / 2, top);
        ctx.lineTo(lx - LADDER_W / 2, bottom);
        ctx.moveTo(lx + LADDER_W / 2, top);
        ctx.lineTo(lx + LADDER_W / 2, bottom);
        ctx.stroke();
        ctx.beginPath();
        for (let y = top + 8; y < bottom; y += 12) {
            ctx.moveTo(lx - LADDER_W / 2, y);
            ctx.lineTo(lx + LADDER_W / 2, y);
        }
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#5d6880';
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#7f8ba8';
    }
}

function drawPlates() {
    const y = floorY(PLATE_FLOOR);
    for (const x0 of BURGER_X) {
        ctx.fillStyle = '#cfd7e6';
        ctx.beginPath();
        ctx.ellipse(x0 + ING_W / 2, y + 4, ING_W / 2 + 10, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9aa5bb';
        ctx.fillRect(x0 - 4, y, ING_W + 8, 3);
    }
}

function drawIngredient(ing) {
    for (let s = 0; s < SEG_COUNT; s++) {
        const x = ing.x + s * SEG_W;
        const y = ing.y + (ing.segs[s] ? 4 : 0);
        if (ing.type === 'patty') {
            ctx.fillStyle = '#8a4b2a';
            ctx.fillRect(x, y, SEG_W, ING_H);
            ctx.fillStyle = '#6d3820';
            ctx.fillRect(x, y + ING_H - 3, SEG_W, 3);
            ctx.fillStyle = '#57c04a';
            ctx.fillRect(x, y - 3, SEG_W, 3);
        } else if (ing.type === 'bunTop') {
            ctx.fillStyle = '#e3a95a';
            ctx.fillRect(x, y + 4, SEG_W, ING_H - 4);
            ctx.beginPath();
            ctx.moveTo(x, y + 6);
            ctx.quadraticCurveTo(x + SEG_W / 2, y - 4, x + SEG_W, y + 6);
            ctx.fill();
            ctx.fillStyle = '#c98b3f';
            ctx.fillRect(x, y + ING_H - 2, SEG_W, 2);
            ctx.fillStyle = '#fbe8c8';                 // sesame seeds
            ctx.fillRect(x + 6, y + 3, 3, 2);
            ctx.fillRect(x + 15, y + 6, 3, 2);
            continue;
        } else {
            ctx.fillStyle = '#c9843c';
            ctx.fillRect(x, y, SEG_W, ING_H);
            ctx.fillStyle = '#a86a2c';
            ctx.fillRect(x, y + ING_H - 3, SEG_W, 3);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, SEG_W - 1, ING_H - 1);
    }
}

// Movers stand on top of whatever ingredient stack is under their feet, so the
// chef visibly walks the burger rather than through it.
function standingY(m) {
    const f = onFloorIndex(m.y);
    if (f === -1) return m.y;
    let top = null;
    for (const ing of ingredients) {
        if (ing.falling || ing.floor !== f) continue;
        if (m.x < ing.x || m.x > ing.x + ING_W) continue;
        if (!top || ing.stack > top.stack) top = ing;
    }
    if (!top) return m.y;
    const seg = clamp(Math.floor((m.x - top.x) / SEG_W), 0, SEG_COUNT - 1);
    return top.y + (top.segs[seg] ? 4 : 0);
}

function drawChef() {
    const x = chef.x;
    const y = standingY(chef);
    const swing = Math.sin(chef.anim / 9) * 3;
    ctx.fillStyle = '#f4ece0';                        // hat
    ctx.fillRect(x - 7, y - 26, 14, 6);
    ctx.fillStyle = '#f0c9a0';                        // face
    ctx.fillRect(x - 6, y - 20, 12, 7);
    ctx.fillStyle = '#1c1c28';
    ctx.fillRect(x + (chef.face > 0 ? 1 : -4), y - 18, 3, 2);
    ctx.fillStyle = '#e8eef7';                        // body
    ctx.fillRect(x - 8, y - 13, 16, 9);
    ctx.fillStyle = '#3a6fd8';                        // legs
    ctx.fillRect(x - 6, y - 4, 4, 4 + swing * 0);
    ctx.fillRect(x + 2, y - 4, 4, 4);
    ctx.fillStyle = '#243b6b';
    ctx.fillRect(x - 7 + swing, y - 1, 5, 2);
    ctx.fillRect(x + 2 - swing, y - 1, 5, 2);
}

function drawEnemy(enemy) {
    const e = { x: enemy.x, y: standingY(enemy), kind: enemy.kind, stunned: enemy.stunned, anim: enemy.anim };
    const body = { hotdog: '#d1603d', egg: '#f4efd8', pickle: '#5aa02c' }[e.kind] || '#d1603d';
    const dark = { hotdog: '#a3452a', egg: '#d9cfa8', pickle: '#3f7620' }[e.kind] || '#a3452a';
    const wobble = e.stunned > 0 ? 0 : Math.sin(e.anim / 8) * 2;
    ctx.fillStyle = body;
    ctx.fillRect(e.x - 9, e.y - 18, 18, 14);
    ctx.fillStyle = dark;
    ctx.fillRect(e.x - 9, e.y - 6, 18, 3);
    ctx.fillRect(e.x - 7 + wobble, e.y - 3, 5, 3);
    ctx.fillRect(e.x + 2 - wobble, e.y - 3, 5, 3);
    ctx.fillStyle = '#ffffff';                        // eyes
    ctx.fillRect(e.x - 6, e.y - 15, 4, 4);
    ctx.fillRect(e.x + 2, e.y - 15, 4, 4);
    ctx.fillStyle = '#1c1c28';
    ctx.fillRect(e.x - 5, e.y - 14, 2, 2);
    ctx.fillRect(e.x + 3, e.y - 14, 2, 2);
    if (e.stunned > 0) {
        ctx.fillStyle = '#f6b93b';
        for (let i = 0; i < 3; i++) {
            ctx.fillRect(e.x - 6 + i * 6, e.y - 26 + (i % 2) * 3, 3, 3);
        }
    }
}

function drawPepperCloud() {
    if (!pepperCloud) return;
    const a = Math.max(0, pepperCloud.t / PEPPER_CLOUD_TIME);
    ctx.fillStyle = `rgba(240, 226, 190, ${0.6 * a})`;
    for (let i = 0; i < 14; i++) {
        const t = i / 13;
        const x = pepperCloud.x0 + t * (pepperCloud.x1 - pepperCloud.x0);
        const y = pepperCloud.y - 10 - Math.sin(t * Math.PI) * 10;
        ctx.fillRect(x, y, 3, 3);
    }
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#100a18';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawGirders();
    drawLadders();
    drawPlates();
    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    if (state !== 'idle') drawChef();
    drawPepperCloud();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const keys = new Set();

function applyKeys() {
    let dx = 0;
    let dy = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) dx -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) dx += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) dy -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) dy += 1;
    moveChef(dx, dy);
}

document.addEventListener('keydown', (ev) => {
    if (ev.code === 'Space') {
        ev.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') sprayPepper();
        return;
    }
    if (ev.code === 'KeyP') {
        togglePause();
        return;
    }
    if (ev.code.startsWith('Arrow')) ev.preventDefault();
    keys.add(ev.code);
    applyKeys();
});

document.addEventListener('keyup', (ev) => {
    keys.delete(ev.code);
    applyKeys();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTs = 0;

function frame(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

loadBest();
updateHud();
draw();
requestAnimationFrame(frame);
