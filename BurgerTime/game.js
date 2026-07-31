// ---------------------------------------------------------------------------
// BurgerTime — a burger-building platform arcade game on an HTML5 canvas.
//
// A chef runs along girders and ladders inside a giant kitchen. Walking the
// full width of a burger ingredient tips it off its girder; the ingredient
// falls onto the girder below, pushing anything already resting there further
// down, until every layer has landed on the plate at the bottom. Hot dogs,
// fried eggs and pickles chase the chef, who can slow them down with a limited
// supply of pepper — or flatten them with a falling ingredient.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per-second and driven
// through `step(dt)` so tests can simulate frames deterministically without
// depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 480;
const TILE = 20;

// Walkable girders, top to bottom. The bottom girder also carries the plates.
const FLOOR_YS = [60, 150, 240, 330, 420];
const PLATE_Y = FLOOR_YS[FLOOR_YS.length - 1];

// Ladders span every girder, so any ladder reaches any floor.
const LADDER_XS = [30, 170, 310, 450, 580];
const LADDER_W = 22;

// Burger stacks. Ingredients rest on floors 0..LAYERS-1; the girder below the
// lowest ingredient floor is the plate.
const STACK_XS = [60, 200, 340, 480];
const LAYERS = 4;
const SEG_W = TILE;
const ING_W = SEG_W * 4;
const ING_H = 8;
const INGREDIENT_TYPES = ['bun-top', 'lettuce', 'patty', 'bun-bottom'];

// --- Chef ---
const PLAYER_W = 18;
const PLAYER_H = 26;
const PLAYER_SPEED = 95;   // px/s walking
const CLIMB_SPEED = 80;    // px/s on a ladder
const LADDER_SNAP = 12;    // how close to a ladder the chef may grab it

// --- Ingredients ---
const FALL_SPEED = 300;

// --- Enemies ---
const ENEMY_BASE_SPEED = 46;
const ENEMY_SPEED_STEP = 7;
const ENEMY_KINDS = ['hotdog', 'egg', 'pickle'];
const SPAWN_POINTS = [
    { x: 30, y: FLOOR_YS[4] },
    { x: 570, y: FLOOR_YS[4] },
    { x: 30, y: FLOOR_YS[3] },
    { x: 570, y: FLOOR_YS[3] },
];
const RESPAWN_TIME = 3;

// --- Pepper ---
const START_PEPPER = 5;
const MAX_PEPPER = 9;
const PEPPER_W = 40;
const PEPPER_H = 26;
const PEPPER_LIFE = 0.45;
const STUN_TIME = 4;

// --- Rules & scoring ---
const START_LIVES = 3;
const DROP_POINTS = 50;
const PLATE_POINTS = 100;
const SQUASH_BASE = 100;
const LEVEL_BONUS = 500;
const DEATH_GRACE = 1;
const LEVEL_CLEAR_TIME = 2.5;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const pepperEl = document.getElementById('pepper');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'levelclear' | 'over'
let state, score, best, lives, level, grace, levelClearTimer;
const player = { x: CANVAS_W / 2, y: FLOOR_YS[4], dx: 0, dy: 0, facing: 1, onLadder: false, pepper: START_PEPPER };
const ingredients = [];
const enemies = [];
const peppers = [];
const respawnTimers = [];
let spawnCursor = 0;
let tick = 0;                       // simulation tick, used to group clumped falls
const pushTicks = new Map();        // stack -> "floor:tick" of the last knock-loose

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Index of the girder exactly under `y`, or -1 when between girders.
function floorIndexAt(y) {
    for (let i = 0; i < FLOOR_YS.length; i++) {
        if (Math.abs(FLOOR_YS[i] - y) < 0.75) return i;
    }
    return -1;
}

function nearestFloorIndex(y) {
    let best = 0;
    for (let i = 1; i < FLOOR_YS.length; i++) {
        if (Math.abs(FLOOR_YS[i] - y) < Math.abs(FLOOR_YS[best] - y)) best = i;
    }
    return best;
}

function nearestLadderX(x) {
    let bestX = LADDER_XS[0];
    for (const lx of LADDER_XS) {
        if (Math.abs(lx - x) < Math.abs(bestX - x)) bestX = lx;
    }
    return bestX;
}

function enemySpeed() { return ENEMY_BASE_SPEED + (level - 1) * ENEMY_SPEED_STEP; }

function enemyCountForLevel() { return Math.min(SPAWN_POINTS.length, 1 + level); }

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

function buildLevel() {
    ingredients.length = 0;
    for (let s = 0; s < STACK_XS.length; s++) {
        for (let tier = 0; tier < LAYERS; tier++) {
            ingredients.push({
                stack: s,
                tier,                       // 0 = top bun … LAYERS-1 = bottom bun
                type: INGREDIENT_TYPES[tier],
                x: STACK_XS[s],
                floor: tier,                // starting girder == tier
                y: FLOOR_YS[tier],
                stepped: [false, false, false, false],
                falling: false,
                onPlate: false,
                chain: 0,
                restTick: -1,
            });
        }
    }
}

function plateCount(stack) {
    return ingredients.filter((i) => i.stack === stack && i.onPlate).length;
}

function plateTargetY(stack) {
    return PLATE_Y - plateCount(stack) * ING_H;
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function setPlayerPos(x, y) {
    player.x = x;
    player.y = y;
    player.onLadder = floorIndexAt(y) < 0;
}

function movePlayer(dx, dy) {
    player.dx = Math.sign(dx || 0);
    player.dy = Math.sign(dy || 0);
    if (player.dx !== 0) player.facing = player.dx;
}

function canClimb(y, dir) {
    const fi = floorIndexAt(y);
    if (fi < 0) return true;                    // already between girders
    return dir < 0 ? fi > 0 : fi < FLOOR_YS.length - 1;
}

function updatePlayer(dt) {
    // Climbing wins over walking, but only where there is a ladder to grab.
    if (player.dy !== 0) {
        if (!player.onLadder) {
            const lx = nearestLadderX(player.x);
            if (Math.abs(player.x - lx) <= LADDER_SNAP && canClimb(player.y, player.dy)) {
                player.x = lx;
                player.onLadder = true;
            }
        }
        if (player.onLadder) {
            player.y += player.dy * CLIMB_SPEED * dt;
            const top = FLOOR_YS[0];
            const bottom = FLOOR_YS[FLOOR_YS.length - 1];
            if (player.y <= top) { player.y = top; player.onLadder = false; }
            if (player.y >= bottom) { player.y = bottom; player.onLadder = false; }
            return;
        }
    }

    if (player.dx !== 0) {
        if (player.onLadder) {
            // Stepping off a ladder is only possible level with a girder.
            const fi = floorIndexAt(player.y);
            if (fi < 0) return;
            player.y = FLOOR_YS[fi];
            player.onLadder = false;
        }
        player.x = clamp(player.x + player.dx * PLAYER_SPEED * dt, PLAYER_W / 2, CANVAS_W - PLAYER_W / 2);
        return;
    }

    // Standing still next to a girder snaps the chef onto it.
    if (player.onLadder) {
        const fi = nearestFloorIndex(player.y);
        if (Math.abs(FLOOR_YS[fi] - player.y) <= 3) {
            player.y = FLOOR_YS[fi];
            player.onLadder = false;
        }
    }
}

// Mark the ingredient segments the chef is standing on; a fully trodden
// ingredient tips over the edge of its girder.
function checkStepping() {
    if (player.onLadder) return;
    const fi = floorIndexAt(player.y);
    if (fi < 0) return;
    for (const ing of ingredients) {
        if (ing.falling || ing.onPlate || ing.floor !== fi) continue;
        let changed = false;
        for (let s = 0; s < 4; s++) {
            const cx = ing.x + s * SEG_W + SEG_W / 2;
            if (!ing.stepped[s] && Math.abs(player.x - cx) < SEG_W / 2) {
                ing.stepped[s] = true;
                changed = true;
            }
        }
        if (changed && ing.stepped.every(Boolean)) dropIngredient(ing);
    }
}

// True when the chef is standing on top of an ingredient (used for drawing).
function standingOnIngredient() {
    const fi = floorIndexAt(player.y);
    if (fi < 0 || player.onLadder) return null;
    return ingredients.find((i) => !i.falling && !i.onPlate && i.floor === fi
        && player.x > i.x && player.x < i.x + ING_W) || null;
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

function dropIngredient(ing) {
    if (!ing || ing.falling || ing.onPlate) return false;
    ing.falling = true;
    ing.chain = 0;
    ing.stepped = [false, false, false, false];
    score += DROP_POINTS;
    return true;
}

// An ingredient landed on by another one is knocked loose and keeps the
// squash chain going.
function pushIngredient(ing, chain) {
    if (!ing || ing.falling || ing.onPlate) return;
    ing.falling = true;
    ing.chain = chain;
    ing.stepped = [false, false, false, false];
    score += DROP_POINTS;
}

function squashEnemies(ing) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (e.x < ing.x - 8 || e.x > ing.x + ING_W + 8) continue;
        if (Math.abs(e.y - ing.y) > 14) continue;
        ing.chain += 1;
        score += SQUASH_BASE * Math.pow(2, ing.chain - 1);
        e.squashed = true;
        enemies.splice(i, 1);
        respawnTimers.push(RESPAWN_TIME);
    }
}

function landOnPlate(ing) {
    ing.y = plateTargetY(ing.stack);   // stacks on top of what is already served
    ing.falling = false;
    ing.onPlate = true;
    ing.floor = FLOOR_YS.length - 1;
    score += PLATE_POINTS;
    checkLevelComplete();
}

// Ingredients that come to rest on the same girder pile up on each other.
function restIngredient(ing, floor) {
    const piled = ingredients.filter((o) => o !== ing && o.stack === ing.stack
        && o.floor === floor && !o.falling && !o.onPlate).length;
    ing.floor = floor;
    ing.y = FLOOR_YS[floor] - piled * ING_H;
    ing.falling = false;
    ing.restTick = tick;
}

function updateIngredient(ing, dt) {
    if (!ing.falling) return;
    ing.y += FALL_SPEED * dt;
    squashEnemies(ing);

    const nextFloor = ing.floor + 1;
    if (nextFloor >= LAYERS) {
        if (ing.y >= plateTargetY(ing.stack)) landOnPlate(ing);
        return;
    }

    const target = FLOOR_YS[nextFloor];
    if (ing.y < target) return;
    ing.y = target;
    ing.floor = nextFloor;

    // Anything already sitting on this girder is knocked loose (ingredients
    // that only settled during this very tick are part of our own clump).
    const resting = ingredients.filter((o) => o !== ing && o.stack === ing.stack
        && o.floor === nextFloor && !o.falling && !o.onPlate && o.restTick !== tick);
    if (resting.length) {
        for (const r of resting) pushIngredient(r, ing.chain);
        pushTicks.set(ing.stack, nextFloor + ':' + tick);
        return;                                   // the clump keeps falling
    }

    // Follow the rest of the clump: another ingredient of this stack either
    // knocked something loose on this girder this tick, or is still falling
    // below us. Either way this one has nothing to land on yet.
    if (pushTicks.get(ing.stack) === nextFloor + ':' + tick) return;
    if (ingredients.some((o) => o !== ing && o.falling && o.stack === ing.stack && o.y > ing.y + 0.5)) return;

    restIngredient(ing, nextFloor);
}

function checkLevelComplete() {
    if (state !== 'running') return;
    if (ingredients.some((i) => !i.onPlate)) return;
    score += LEVEL_BONUS;
    player.pepper = Math.min(MAX_PEPPER, player.pepper + 1);
    state = 'levelclear';
    levelClearTimer = LEVEL_CLEAR_TIME;
    showOverlay('Burger Served!', 'Score ' + score, 'Next level starting…', 'Continue');
    updateHud();
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemy(opts) {
    opts = opts || {};
    const e = {
        x: opts.x != null ? opts.x : SPAWN_POINTS[0].x,
        y: opts.y != null ? opts.y : SPAWN_POINTS[0].y,
        kind: opts.kind || ENEMY_KINDS[enemies.length % ENEMY_KINDS.length],
        onLadder: false,
        targetFloor: 0,
        stun: 0,
        squashed: false,
        wobble: 0,
    };
    enemies.push(e);
    return e;
}

function updateEnemy(e, dt) {
    e.wobble += dt;
    if (e.stun > 0) {
        e.stun = Math.max(0, e.stun - dt);
        return;
    }

    const speed = enemySpeed();
    if (e.onLadder) {
        const goal = FLOOR_YS[e.targetFloor];
        const dir = Math.sign(goal - e.y);
        e.y += dir * speed * dt;
        if (dir === 0 || (dir > 0 && e.y >= goal) || (dir < 0 && e.y <= goal)) {
            e.y = goal;
            e.onLadder = false;
        }
        return;
    }

    const myFloor = nearestFloorIndex(e.y);
    const chefFloor = nearestFloorIndex(player.y);
    e.y = FLOOR_YS[myFloor];

    if (myFloor !== chefFloor) {
        const lx = nearestLadderX(e.x);
        const stride = speed * dt;
        if (Math.abs(e.x - lx) <= stride + 0.5) {
            e.x = lx;
            e.onLadder = true;
            e.targetFloor = myFloor + Math.sign(chefFloor - myFloor);
        } else {
            e.x += Math.sign(lx - e.x) * stride;
        }
        return;
    }

    const d = player.x - e.x;
    if (Math.abs(d) > 0.5) e.x = clamp(e.x + Math.sign(d) * speed * dt, 8, CANVAS_W - 8);
}

function checkEnemyCollisions() {
    if (grace > 0) return;
    for (const e of enemies) {
        if (e.stun > 0) continue;
        if (Math.abs(e.x - player.x) < 14 && Math.abs(e.y - player.y) < 18) {
            loseLife();
            return;
        }
    }
}

function updateRespawns(dt) {
    for (let i = respawnTimers.length - 1; i >= 0; i--) {
        respawnTimers[i] -= dt;
        if (respawnTimers[i] > 0) continue;
        respawnTimers.splice(i, 1);
        const p = SPAWN_POINTS[spawnCursor % SPAWN_POINTS.length];
        spawnCursor += 1;
        spawnEnemy({ x: p.x, y: p.y });
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function throwPepper() {
    if (state !== 'running' || player.pepper <= 0) return false;
    player.pepper -= 1;
    const x = player.facing > 0 ? player.x + 4 : player.x - 4 - PEPPER_W;
    peppers.push({ x, y: player.y - PEPPER_H, w: PEPPER_W, h: PEPPER_H, life: PEPPER_LIFE });
    updateHud();
    return true;
}

function updatePeppers(dt) {
    for (let i = peppers.length - 1; i >= 0; i--) {
        const p = peppers[i];
        p.life -= dt;
        for (const e of enemies) {
            if (e.x >= p.x && e.x <= p.x + p.w && Math.abs(e.y - (p.y + p.h)) < 20) {
                e.stun = STUN_TIME;
            }
        }
        if (p.life <= 0) peppers.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'levelclear') {
        levelClearTimer -= dt;
        if (levelClearTimer <= 0) startLevel(level + 1);
        return;
    }
    if (state !== 'running') return;

    tick += 1;
    if (grace > 0) grace = Math.max(0, grace - dt);
    updatePlayer(dt);
    checkStepping();
    // Lowest layers first, so a falling clump lands on the plate in the order
    // it hung in the air.
    const fallOrder = ingredients.slice().sort((a, b) => b.tier - a.tier);
    for (const ing of fallOrder) updateIngredient(ing, dt);
    if (state !== 'running') { updateHud(); return; }  // level cleared mid-step
    for (const e of enemies) updateEnemy(e, dt);
    updatePeppers(dt);
    updateRespawns(dt);
    checkEnemyCollisions();
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function resetPositions() {
    player.x = CANVAS_W / 2;
    player.y = FLOOR_YS[FLOOR_YS.length - 1];
    player.dx = 0;
    player.dy = 0;
    player.facing = 1;
    player.onLadder = false;
    peppers.length = 0;
    for (let i = 0; i < enemies.length; i++) {
        const p = SPAWN_POINTS[i % SPAWN_POINTS.length];
        enemies[i].x = p.x;
        enemies[i].y = p.y;
        enemies[i].onLadder = false;
        enemies[i].stun = 0;
    }
}

function startLevel(n) {
    level = n;
    buildLevel();
    enemies.length = 0;
    respawnTimers.length = 0;
    peppers.length = 0;
    spawnCursor = 0;
    for (let i = 0; i < enemyCountForLevel(); i++) {
        const p = SPAWN_POINTS[i % SPAWN_POINTS.length];
        spawnEnemy({ x: p.x, y: p.y, kind: ENEMY_KINDS[i % ENEMY_KINDS.length] });
    }
    resetPositions();
    grace = 0;
    state = 'running';
    hideOverlay();
    updateHud();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    player.pepper = START_PEPPER;
    startLevel(1);
}

function loseLife() {
    if (state !== 'running') return;
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        updateHud();
        endGame();
        return;
    }
    resetPositions();
    grace = DEATH_GRACE;
    updateHud();
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
    livesEl.textContent = String(lives);
    levelEl.textContent = String(level);
    pepperEl.textContent = String(player.pepper);
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

const ING_COLORS = {
    'bun-top': ['#d9a05b', '#b97e3c'],
    'lettuce': ['#68c46a', '#3f9a45'],
    'patty': ['#8b5a2b', '#65401d'],
    'bun-bottom': ['#c98f4b', '#a86f31'],
};

function drawKitchen() {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Faint tiled wall.
    ctx.strokeStyle = '#141c33';
    ctx.lineWidth = 1;
    for (let x = 0; x <= CANVAS_W; x += TILE * 2) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CANVAS_H);
        ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += TILE * 2) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(CANVAS_W, y + 0.5);
        ctx.stroke();
    }

    // Ladders behind the girders.
    for (const lx of LADDER_XS) {
        const top = FLOOR_YS[0];
        const bottom = FLOOR_YS[FLOOR_YS.length - 1];
        ctx.strokeStyle = '#4d6bb5';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lx - LADDER_W / 2, top);
        ctx.lineTo(lx - LADDER_W / 2, bottom);
        ctx.moveTo(lx + LADDER_W / 2, top);
        ctx.lineTo(lx + LADDER_W / 2, bottom);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#3c5694';
        for (let y = top + 10; y < bottom; y += 12) {
            ctx.beginPath();
            ctx.moveTo(lx - LADDER_W / 2, y);
            ctx.lineTo(lx + LADDER_W / 2, y);
            ctx.stroke();
        }
    }

    // Girders.
    for (const y of FLOOR_YS) {
        ctx.fillStyle = '#7f8cc4';
        ctx.fillRect(0, y, CANVAS_W, 4);
        ctx.fillStyle = '#48548c';
        ctx.fillRect(0, y + 4, CANVAS_W, 3);
        ctx.fillStyle = '#9aa6d8';
        for (let x = 6; x < CANVAS_W; x += 20) ctx.fillRect(x, y + 1, 3, 2);
    }

    // Counter below the bottom girder, where the plates sit.
    ctx.fillStyle = '#161f3a';
    ctx.fillRect(0, PLATE_Y + 14, CANVAS_W, CANVAS_H - PLATE_Y - 14);
    ctx.fillStyle = '#1d2848';
    ctx.fillRect(0, PLATE_Y + 14, CANVAS_W, 4);

    // Plates under each burger stack.
    for (const sx of STACK_XS) {
        const cx = sx + ING_W / 2;
        ctx.fillStyle = '#e8edf7';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 6, ING_W / 2 + 8, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#c2cbe0';
        ctx.fillRect(sx - 6, PLATE_Y + 2, ING_W + 12, 4);
        ctx.fillStyle = '#aab4cc';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 11, ING_W / 2 - 4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawIngredient(ing) {
    const [light, dark] = ING_COLORS[ing.type];
    for (let s = 0; s < 4; s++) {
        const x = ing.x + s * SEG_W;
        const dip = !ing.falling && !ing.onPlate && ing.stepped[s] ? 3 : 0;
        const y = ing.y - ING_H + dip;
        ctx.fillStyle = light;
        ctx.fillRect(x, y, SEG_W, ING_H - 2);
        ctx.fillStyle = dark;
        ctx.fillRect(x, y + ING_H - 3, SEG_W, 3);
        if (ing.type === 'bun-top') {
            ctx.fillStyle = '#f0d9a8';
            ctx.fillRect(x + 4, y - 3, SEG_W - 8, 4);
            ctx.fillStyle = '#fff6e0';
            ctx.fillRect(x + 6, y - 2, 2, 2);
        }
        if (ing.type === 'lettuce') {
            ctx.fillStyle = '#8fdd8f';
            ctx.fillRect(x + 2, y - 2, SEG_W - 6, 3);
        }
    }
}

function drawChef() {
    const onIng = standingOnIngredient();
    const feet = player.y - (onIng ? ING_H : 0);
    const x = player.x;
    const top = feet - PLAYER_H;

    // Legs (they scissor while the chef is on the move).
    const stride = player.dx !== 0 || player.dy !== 0 ? Math.sin(performance.now() / 70) * 2 : 0;
    ctx.fillStyle = '#2b3765';
    ctx.fillRect(x - 6 - stride, feet - 9, 5, 9);
    ctx.fillRect(x + 1 + stride, feet - 9, 5, 9);
    // Body.
    ctx.fillStyle = '#f4f7ff';
    ctx.fillRect(x - PLAYER_W / 2, top + 8, PLAYER_W, 13);
    // Arm and pepper shaker.
    const armX = x + (player.facing > 0 ? PLAYER_W / 2 - 3 : -PLAYER_W / 2 - 3);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(armX, top + 11, 6, 4);
    ctx.fillStyle = '#c0562f';
    ctx.fillRect(armX + (player.facing > 0 ? 5 : -3), top + 9, 4, 7);
    // Head.
    ctx.fillStyle = '#f6c89a';
    ctx.fillRect(x - 5, top + 1, 10, 8);
    // Chef hat.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 7, top - 5, 14, 6);
    ctx.fillRect(x - 5, top - 8, 10, 4);
    // Eye.
    ctx.fillStyle = '#1b2440';
    ctx.fillRect(x + (player.facing > 0 ? 1 : -3), top + 3, 2, 2);
}

const ENEMY_COLORS = {
    hotdog: ['#e2603c', '#b6421f'],
    egg: ['#f7f3e2', '#f2c14e'],
    pickle: ['#79b451', '#4f8232'],
};

function drawEnemy(e) {
    const [light, dark] = ENEMY_COLORS[e.kind] || ENEMY_COLORS.hotdog;
    const w = 20;
    const h = 22;
    const x = e.x - w / 2;
    const y = e.y - h;
    if (e.stun > 0) {
        ctx.globalAlpha = 0.55 + 0.25 * Math.sin(e.wobble * 18);
    }
    ctx.fillStyle = light;
    ctx.fillRect(x, y, w, h - 4);
    ctx.fillStyle = dark;
    ctx.fillRect(x, y + h - 8, w, 4);
    // Feet.
    ctx.fillStyle = '#1b2440';
    ctx.fillRect(x + 2, e.y - 4, 6, 4);
    ctx.fillRect(x + w - 8, e.y - 4, 6, 4);
    // Eyes.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 4, y + 5, 4, 4);
    ctx.fillRect(x + w - 8, y + 5, 4, 4);
    ctx.fillStyle = '#1b2440';
    ctx.fillRect(x + 5, y + 6, 2, 2);
    ctx.fillRect(x + w - 7, y + 6, 2, 2);
    if (e.stun > 0) {
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(x + 2, y - 6, 3, 3);
        ctx.fillRect(x + w - 6, y - 8, 3, 3);
    }
    ctx.globalAlpha = 1;
}

// A fixed scatter so the cloud looks sprinkled instead of striped, and stays
// identical between frames.
const PEPPER_SPECKS = [
    [0.08, 0.22], [0.21, 0.62], [0.30, 0.10], [0.34, 0.85], [0.45, 0.40],
    [0.52, 0.72], [0.58, 0.16], [0.66, 0.55], [0.73, 0.90], [0.79, 0.30],
    [0.88, 0.66], [0.94, 0.12], [0.15, 0.45], [0.40, 0.62], [0.62, 0.36],
];

function drawPeppers() {
    for (const p of peppers) {
        ctx.globalAlpha = clamp(p.life / PEPPER_LIFE, 0, 1);
        for (let i = 0; i < PEPPER_SPECKS.length; i++) {
            const [fx, fy] = PEPPER_SPECKS[i];
            ctx.fillStyle = i % 3 === 0 ? '#8b8378' : '#d6d3d1';
            ctx.fillRect(p.x + fx * p.w, p.y + fy * p.h, 3, 3);
        }
        ctx.globalAlpha = 1;
    }
}

function draw() {
    drawKitchen();
    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    drawPeppers();
    drawChef();
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

const heldKeys = new Set();
const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];
const MOVE_KEYS = [...LEFT_KEYS, ...RIGHT_KEYS, ...UP_KEYS, ...DOWN_KEYS];

function refreshKeyDir() {
    const left = LEFT_KEYS.some((k) => heldKeys.has(k));
    const right = RIGHT_KEYS.some((k) => heldKeys.has(k));
    const up = UP_KEYS.some((k) => heldKeys.has(k));
    const down = DOWN_KEYS.some((k) => heldKeys.has(k));
    movePlayer((right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') throwPepper();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshKeyDir();
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
    else if (state === 'levelclear') startLevel(level + 1);
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
grace = 0;
levelClearTimer = 0;
player.pepper = START_PEPPER;
buildLevel();
updateHud();
requestAnimationFrame(frame);
