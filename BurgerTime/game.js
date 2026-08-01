/* Burger Time — walk the burgers down to their plates while the food fights back.
 *
 * Everything the game needs lives in this one classic (non-module) script so the
 * Playwright suite can reach the model directly: `tick(dt)` advances the whole
 * simulation, `draw()` only paints, and `setAutoLoop(false)` hands the clock to
 * a test.
 */

// ---------------------------------------------------------------------------
// Board geometry
// ---------------------------------------------------------------------------

var CANVAS_W = 600;
var CANVAS_H = 500;

var FLOOR_Y = [70, 135, 200, 265, 330, 395];
var FLOOR_COUNT = FLOOR_Y.length;
var LADDER_X = [40, 170, 300, 430, 560];
var COLUMN_X = [105, 235, 365, 495];

var PLATE_Y = 455;
var PLATE_FLOOR = FLOOR_COUNT; // 6 — the plates sit below the bottom floor

var SEG_W = 24;
var ING_W = SEG_W * 4;
var ING_H = 12;

var LADDER_W = 22;
var LADDER_SNAP = 8;
var LADDER_STEP_OFF = 14;
var FLOOR_H = 6;

var CHEF_HW = 9;
var CHEF_H = 26;
var ENEMY_HW = 9;
var ENEMY_H = 24;

var WALK_SPEED = 90;
var CLIMB_SPEED = 130;
var FALL_SPEED = 260;

var PEPPER_W = 34;
var PEPPER_H = 24;
var PEPPER_LIFE = 0.4;
var STUN_TIME = 4;
var RESPAWN_TIME = 5;
var DYING_TIME = 1.2;
var ENTRY_STAGGER = 1.8;
var JUNCTION_PAUSE = 0.3;
var RESPAWN_STAGGER = 1.2;
var CLEAR_TIME = 2;

var KINDS = ['bunTop', 'lettuce', 'patty', 'bunBottom'];
var ENEMY_KINDS = ['hotdog', 'egg', 'pickle'];
var ENEMY_SPAWNS = [
    { x: 40, floor: 0 },
    { x: 300, floor: 0 },
    { x: 560, floor: 0 },
    { x: 170, floor: 0 },
    { x: 430, floor: 0 },
];

var CHEF_SPAWN_X = 300;
var CHEF_SPAWN_FLOOR = 5;

var BEST_KEY = 'burgertime-best';

// ---------------------------------------------------------------------------
// Mutable state
// ---------------------------------------------------------------------------

var state = 'idle'; // idle | running | paused | dying | levelclear | gameover
var score = 0;
var lives = 3;
var level = 1;
var peppers = 5;
var best = 0;

var chef = null;
var enemies = [];
var ingredients = [];
var plateStacks = [[], [], [], []];
var pepper = { active: false, x: 0, y: 0, w: PEPPER_W, h: PEPPER_H, timer: 0 };

var input = { left: false, right: false, up: false, down: false };

var dyingTimer = 0;
var clearTimer = 0;
var animTime = 0;
var autoLoop = true;
var lastTs = 0;

var canvas = null;
var ctx = null;
var els = {};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function ingX(ing) {
    return COLUMN_X[ing.col] - ING_W / 2;
}

/** Top-left y of an ingredient resting on `floor`. */
function restY(floor) {
    if (floor >= PLATE_FLOOR) return plateRestY(0);
    return FLOOR_Y[floor] - ING_H;
}

/** Top-left y of the `index`-th ingredient on a plate, counting from the bottom. */
function plateRestY(index) {
    return PLATE_Y - ING_H * (index + 1);
}

/** Index of the ladder the given x is standing on, or -1. */
function ladderAt(x) {
    for (var i = 0; i < LADDER_X.length; i++) {
        if (Math.abs(x - LADDER_X[i]) <= LADDER_SNAP) return i;
    }
    return -1;
}

/** The floor whose surface is closest to the given y. */
function nearestFloor(y) {
    var best = 0;
    for (var f = 1; f < FLOOR_COUNT; f++) {
        if (Math.abs(y - FLOOR_Y[f]) < Math.abs(y - FLOOR_Y[best])) best = f;
    }
    return best;
}

/**
 * The floor crossed while moving vertically from `prev` to `next`, or -1.
 * `dir` is -1 for up, 1 for down.
 */
function crossedFloor(prev, next, dir) {
    for (var f = 0; f < FLOOR_COUNT; f++) {
        var y = FLOOR_Y[f];
        if (dir < 0 && prev > y && next <= y) return f;
        if (dir > 0 && prev < y && next >= y) return f;
    }
    return -1;
}

function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function chefRect() {
    return { x: chef.x - CHEF_HW, y: chef.y - CHEF_H, w: CHEF_HW * 2, h: CHEF_H };
}

function enemyRect(e) {
    return { x: e.x - ENEMY_HW, y: e.y - ENEMY_H, w: ENEMY_HW * 2, h: ENEMY_H };
}

function ingRect(ing) {
    return { x: ingX(ing), y: ing.y, w: ING_W, h: ING_H };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function buildIngredients() {
    ingredients = [];
    plateStacks = [[], [], [], []];
    for (var col = 0; col < COLUMN_X.length; col++) {
        for (var k = 0; k < KINDS.length; k++) {
            ingredients.push({
                col: col,
                kind: KINDS[k],
                floor: k, // top bun on floor 0 down to bottom bun on floor 3
                y: restY(k),
                steps: [false, false, false, false],
                falling: false,
                landFloor: -1,
                squashed: 0,
            });
        }
    }
}

function enemyCountFor(lvl) {
    return Math.min(3 + Math.floor((lvl - 1) / 2), ENEMY_SPAWNS.length);
}

function enemySpeedFor(lvl) {
    return 50 + (lvl - 1) * 8;
}

function buildEnemies() {
    enemies = [];
    var count = enemyCountFor(level);
    for (var i = 0; i < count; i++) {
        enemies.push({
            kind: ENEMY_KINDS[i % ENEMY_KINDS.length],
            spawn: i,
            x: 0,
            y: 0,
            floor: 0,
            dir: 1,
            climbing: false,
            climbDir: 0,
            dead: false,
            respawnTimer: 0,
            stunTimer: 0,
            waitTimer: 0,
            ladderBias: (i % LADDER_X.length) * 22,
            speed: enemySpeedFor(level),
        });
        placeAtSpawn(enemies[i]);
    }
    staggerEnemies(ENTRY_STAGGER);
}

/** Hold the enemies back briefly so they trickle in instead of swarming. */
function staggerEnemies(gap) {
    for (var i = 0; i < enemies.length; i++) enemies[i].waitTimer = i * gap;
}

function placeAtSpawn(e) {
    var spawn = ENEMY_SPAWNS[e.spawn % ENEMY_SPAWNS.length];
    e.x = spawn.x;
    e.floor = spawn.floor;
    e.y = FLOOR_Y[spawn.floor];
    e.climbing = false;
    e.climbDir = 0;
    e.dead = false;
    e.respawnTimer = 0;
    e.stunTimer = 0;
    e.waitTimer = 0;
    e.dir = spawn.x < CANVAS_W / 2 ? 1 : -1;
}

function respawnEnemy(e) {
    placeAtSpawn(e);
    e.speed = enemySpeedFor(level);
}

function resetChef() {
    chef = {
        x: CHEF_SPAWN_X,
        y: FLOOR_Y[CHEF_SPAWN_FLOOR],
        floor: CHEF_SPAWN_FLOOR,
        dir: 1,
        climbing: false,
    };
}

function clearInput() {
    input.left = input.right = input.up = input.down = false;
}

function resetLevel() {
    buildIngredients();
    resetChef();
    buildEnemies();
    pepper.active = false;
    pepper.timer = 0;
    clearInput();
}

function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    peppers = 5;
    resetLevel();
    state = 'running';
    dyingTimer = 0;
    clearTimer = 0;
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    peppers = 5;
    resetLevel();
    state = 'running';
}

function gameOver() {
    state = 'gameover';
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage unavailable — the score simply is not persisted */
        }
    }
    showOverlay('GAME OVER', 'Score ' + score + ' · Best ' + best, 'Press Space to play again');
    updateHud();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function tick(dt) {
    animTime += dt;

    if (state === 'dying') {
        dyingTimer -= dt;
        if (dyingTimer <= 0) {
            if (lives <= 0) gameOver();
            else {
                resetChef();
                for (var i = 0; i < enemies.length; i++) placeAtSpawn(enemies[i]);
                staggerEnemies(RESPAWN_STAGGER);
                pepper.active = false;
                clearInput();
                state = 'running';
            }
        }
        return;
    }

    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        return;
    }

    if (state !== 'running') return;

    updateChef(dt);
    updateStepping();
    updateIngredients(dt);
    updatePepper(dt);
    updateEnemies(dt);
    checkCollisions();

    if (isLevelComplete()) {
        score += 1000 * level;
        state = 'levelclear';
        clearTimer = CLEAR_TIME;
    }
}

function updateChef(dt) {
    var step = WALK_SPEED * dt;

    if (input.up || input.down) {
        var dir = input.up ? -1 : 1;
        var lad = ladderAt(chef.x);
        var canGo = chef.climbing || (dir < 0 ? chef.floor > 0 : chef.floor < FLOOR_COUNT - 1);
        if (lad >= 0 && canGo) {
            chef.x = LADDER_X[lad];
            chef.climbing = true;
            var prev = chef.y;
            var next = clamp(chef.y + dir * CLIMB_SPEED * dt, FLOOR_Y[0], FLOOR_Y[FLOOR_COUNT - 1]);
            var f = crossedFloor(prev, next, dir);
            if (f >= 0) {
                chef.y = FLOOR_Y[f];
                chef.floor = f;
                chef.climbing = false;
            } else {
                chef.y = next;
            }
            return;
        }
    }

    // Stepping off a ladder: if the player stopped climbing within a whisker of
    // a floor, let a sideways press pull him on to it rather than stranding him.
    if (chef.climbing) {
        if (!input.left && !input.right) return;
        var near = nearestFloor(chef.y);
        if (Math.abs(chef.y - FLOOR_Y[near]) > LADDER_STEP_OFF) return;
        chef.y = FLOOR_Y[near];
        chef.floor = near;
        chef.climbing = false;
    }

    if (input.left) {
        chef.x = clamp(chef.x - step, CHEF_HW, CANVAS_W - CHEF_HW);
        chef.dir = -1;
    } else if (input.right) {
        chef.x = clamp(chef.x + step, CHEF_HW, CANVAS_W - CHEF_HW);
        chef.dir = 1;
    }
}

function updateStepping() {
    if (chef.climbing) return;
    for (var i = 0; i < ingredients.length; i++) {
        var ing = ingredients[i];
        if (ing.falling || ing.floor !== chef.floor) continue;
        var rel = chef.x - ingX(ing);
        if (rel < 0 || rel >= ING_W) continue;
        ing.steps[Math.floor(rel / SEG_W)] = true;
    }
    for (var j = 0; j < ingredients.length; j++) {
        var candidate = ingredients[j];
        if (!candidate.falling && allStepped(candidate)) dropIngredient(candidate);
    }
}

function allStepped(ing) {
    return ing.steps[0] && ing.steps[1] && ing.steps[2] && ing.steps[3];
}

function dropIngredient(ing) {
    if (ing.falling || ing.floor >= PLATE_FLOOR) return;
    ing.falling = true;
    ing.steps = [false, false, false, false];
    ing.landFloor = ing.floor + 1;
    ing.squashed = 0;
    score += 50;
}

function residentAt(col, floor, exclude) {
    for (var i = 0; i < ingredients.length; i++) {
        var ing = ingredients[i];
        if (ing !== exclude && ing.col === col && ing.floor === floor && !ing.falling) return ing;
    }
    return null;
}

function updateIngredients(dt) {
    for (var i = 0; i < ingredients.length; i++) {
        var ing = ingredients[i];
        if (!ing.falling) continue;

        ing.y += FALL_SPEED * dt;

        var box = ingRect(ing);
        for (var j = 0; j < enemies.length; j++) {
            var e = enemies[j];
            if (!e.dead && overlaps(box, enemyRect(e))) squashEnemy(e, ing);
        }

        if (ing.landFloor >= PLATE_FLOOR) {
            var stack = plateStacks[ing.col];
            var target = plateRestY(stack.length);
            if (ing.y >= target) {
                ing.y = target;
                ing.floor = PLATE_FLOOR;
                ing.falling = false;
                stack.push(ing);
                if (stack.length === KINDS.length) score += 1000;
            }
            continue;
        }

        var floorTarget = restY(ing.landFloor);
        if (ing.y >= floorTarget) {
            var resident = residentAt(ing.col, ing.landFloor, ing);
            if (resident) {
                resident.falling = true;
                resident.steps = [false, false, false, false];
                resident.landFloor = resident.floor + 1;
                resident.squashed = 0;
                score += 50;
            }
            ing.y = floorTarget;
            ing.floor = ing.landFloor;
            ing.falling = false;
        }
    }
}

function squashEnemy(e, ing) {
    if (e.dead) return;
    e.dead = true;
    e.stunTimer = 0;
    e.climbing = false;
    e.respawnTimer = RESPAWN_TIME;
    if (ing) {
        ing.squashed += 1;
        score += 500 * Math.pow(2, ing.squashed - 1);
    }
}

function firePepper() {
    if (state !== 'running' || peppers <= 0) return false;
    peppers -= 1;
    pepper.active = true;
    pepper.timer = PEPPER_LIFE;
    pepper.w = PEPPER_W;
    pepper.h = PEPPER_H;
    pepper.x = chef.dir > 0 ? chef.x + 6 : chef.x - 6 - PEPPER_W;
    pepper.y = chef.y - CHEF_H;
    updateHud();
    return true;
}

function updatePepper(dt) {
    if (!pepper.active) return;
    pepper.timer -= dt;
    if (pepper.timer <= 0) {
        pepper.active = false;
        return;
    }
    var box = { x: pepper.x, y: pepper.y, w: pepper.w, h: pepper.h };
    for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (!e.dead && overlaps(box, enemyRect(e))) e.stunTimer = STUN_TIME;
    }
}

function updateEnemies(dt) {
    for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (e.dead) {
            e.respawnTimer -= dt;
            if (e.respawnTimer <= 0) respawnEnemy(e);
            continue;
        }
        if (e.waitTimer > 0) {
            e.waitTimer = Math.max(0, e.waitTimer - dt);
            continue;
        }
        if (e.stunTimer > 0) {
            e.stunTimer = Math.max(0, e.stunTimer - dt);
            continue;
        }
        moveEnemy(e, dt);
    }
}

function moveEnemy(e, dt) {
    var step = e.speed * dt;

    if (e.climbing) {
        var prev = e.y;
        var next = clamp(e.y + e.climbDir * step, FLOOR_Y[0], FLOOR_Y[FLOOR_COUNT - 1]);
        var crossed = crossedFloor(prev, next, e.climbDir);
        if (crossed >= 0) {
            e.y = FLOOR_Y[crossed];
            e.floor = crossed;
            e.climbing = false;
            e.waitTimer = JUNCTION_PAUSE; // a beat at the junction, as in the arcade
        } else {
            e.y = next;
        }
        return;
    }

    var floorDelta = chef.floor - e.floor;
    if (floorDelta !== 0) {
        var lad = ladderAt(e.x);
        var vdir = floorDelta > 0 ? 1 : -1;
        var canGo = vdir < 0 ? e.floor > 0 : e.floor < FLOOR_COUNT - 1;
        if (lad >= 0 && canGo) {
            e.x = LADDER_X[lad];
            e.climbing = true;
            e.climbDir = vdir;
            return;
        }
        var goal = bestLadderX(e);
        e.dir = goal > e.x ? 1 : -1;
        e.x = clamp(e.x + e.dir * step, ENEMY_HW, CANVAS_W - ENEMY_HW);
        return;
    }

    var dx = chef.x - e.x;
    if (Math.abs(dx) > 1) e.dir = dx > 0 ? 1 : -1;
    e.x = clamp(e.x + e.dir * step, ENEMY_HW, CANVAS_W - ENEMY_HW);
}

/**
 * The ladder that is close by and roughly on the way to the chef. Each enemy
 * carries its own bias so the pack spreads across different ladders instead of
 * queueing up on one.
 */
function bestLadderX(e) {
    var bestX = LADDER_X[0];
    var bestCost = Infinity;
    for (var i = 0; i < LADDER_X.length; i++) {
        var lx = LADDER_X[i];
        var cost = Math.abs(e.x - lx) + 0.35 * Math.abs(chef.x - lx);
        if (i === e.spawn % LADDER_X.length) cost -= e.ladderBias;
        if (cost < bestCost) {
            bestCost = cost;
            bestX = lx;
        }
    }
    return bestX;
}

function checkCollisions() {
    var box = chefRect();
    for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (e.dead) continue;
        if (overlaps(box, enemyRect(e))) {
            loseLife();
            return;
        }
    }
}

function loseLife() {
    lives -= 1;
    state = 'dying';
    dyingTimer = DYING_TIME;
    pepper.active = false;
    clearInput();
    updateHud();
}

function isLevelComplete() {
    for (var i = 0; i < ingredients.length; i++) {
        if (ingredients[i].floor !== PLATE_FLOOR) return false;
    }
    return true;
}

/** Testing helper: put every ingredient straight on to its plate. */
function plateAllForTest() {
    plateStacks = [[], [], [], []];
    for (var col = 0; col < COLUMN_X.length; col++) {
        var stack = plateStacks[col];
        for (var i = 0; i < ingredients.length; i++) {
            var ing = ingredients[i];
            if (ing.col !== col) continue;
            ing.falling = false;
            ing.steps = [false, false, false, false];
            ing.floor = PLATE_FLOOR;
            ing.y = plateRestY(stack.length);
            stack.push(ing);
        }
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

var ING_COLORS = {
    bunTop: ['#e6a44f', '#b9762c'],
    lettuce: ['#69c256', '#3f8b34'],
    patty: ['#8a5230', '#5d3218'],
    bunBottom: ['#d9924a', '#a86a26'],
};

var ENEMY_COLORS = {
    hotdog: ['#d8603c', '#f0b26b'],
    egg: ['#f2efe4', '#f5c542'],
    pickle: ['#6fae4b', '#3f7a2c'],
};

function draw() {
    if (!ctx) return;

    ctx.fillStyle = '#0d0805';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawLadders();
    drawFloors();
    drawPlates();

    for (var i = 0; i < ingredients.length; i++) drawIngredient(ingredients[i]);
    for (var j = 0; j < enemies.length; j++) drawEnemy(enemies[j]);

    if (pepper.active) drawPepper();
    if (state !== 'dying' || Math.floor(animTime * 12) % 2 === 0) drawChef();

    if (state === 'levelclear') {
        ctx.fillStyle = 'rgba(13, 8, 5, 0.6)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#f7b733';
        ctx.font = 'bold 34px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('BURGERS UP!', CANVAS_W / 2, CANVAS_H / 2);
        ctx.font = '16px "Segoe UI", sans-serif';
        ctx.fillStyle = '#f6ece0';
        ctx.fillText('Level ' + (level + 1) + ' coming right up', CANVAS_W / 2, CANVAS_H / 2 + 28);
        ctx.textAlign = 'left';
    }
}

function drawFloors() {
    for (var f = 0; f < FLOOR_COUNT; f++) {
        var y = FLOOR_Y[f];
        ctx.fillStyle = '#3f6ea8';
        ctx.fillRect(0, y, CANVAS_W, FLOOR_H);
        ctx.fillStyle = '#7fb2e8';
        ctx.fillRect(0, y, CANVAS_W, 2);
        ctx.fillStyle = 'rgba(13, 8, 5, 0.35)';
        for (var x = 0; x < CANVAS_W; x += 16) ctx.fillRect(x + 7, y + 2, 2, FLOOR_H - 2);
    }
}

function drawLadders() {
    var top = FLOOR_Y[0];
    var bottom = FLOOR_Y[FLOOR_COUNT - 1];
    for (var i = 0; i < LADDER_X.length; i++) {
        var x = LADDER_X[i] - LADDER_W / 2;
        ctx.fillStyle = '#c9d6e6';
        ctx.fillRect(x, top, 3, bottom - top + FLOOR_H);
        ctx.fillRect(x + LADDER_W - 3, top, 3, bottom - top + FLOOR_H);
        ctx.fillStyle = '#8fa3bd';
        for (var y = top + 8; y < bottom + FLOOR_H; y += 12) ctx.fillRect(x, y, LADDER_W, 3);
    }
}

function drawPlates() {
    for (var i = 0; i < COLUMN_X.length; i++) {
        var cx = COLUMN_X[i];
        ctx.fillStyle = '#d7dde6';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 8, ING_W / 2 + 12, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#aeb7c4';
        ctx.fillRect(cx - ING_W / 2 - 12, PLATE_Y + 2, ING_W + 24, 6);
    }
}

function drawIngredient(ing) {
    var x = ingX(ing);
    var colors = ING_COLORS[ing.kind];
    for (var i = 0; i < 4; i++) {
        var sx = x + i * SEG_W;
        var sy = ing.y + (ing.steps[i] ? 5 : 0);
        ctx.fillStyle = colors[0];
        if (ing.kind === 'bunTop') {
            ctx.beginPath();
            ctx.moveTo(sx, sy + ING_H);
            ctx.lineTo(sx, sy + 5);
            ctx.quadraticCurveTo(sx + SEG_W / 2, sy - 3, sx + SEG_W, sy + 5);
            ctx.lineTo(sx + SEG_W, sy + ING_H);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 245, 214, 0.85)';
            ctx.fillRect(sx + 5, sy + 3, 3, 2);
            ctx.fillRect(sx + 14, sy + 6, 3, 2);
        } else if (ing.kind === 'lettuce') {
            ctx.fillRect(sx, sy + 2, SEG_W, ING_H - 4);
            ctx.beginPath();
            for (var w = 0; w < 3; w++) {
                ctx.arc(sx + 4 + w * 8, sy + 3, 4.5, Math.PI, 0);
            }
            ctx.fill();
            ctx.beginPath();
            for (var w2 = 0; w2 < 3; w2++) {
                ctx.arc(sx + 4 + w2 * 8, sy + ING_H - 3, 4.5, 0, Math.PI);
            }
            ctx.fill();
        } else {
            ctx.fillRect(sx, sy + 1, SEG_W, ING_H - 2);
        }
        ctx.fillStyle = colors[1];
        ctx.fillRect(sx, sy + ING_H - 3, SEG_W, 2);
        ctx.strokeStyle = 'rgba(13, 8, 5, 0.25)';
        ctx.strokeRect(sx + 0.5, sy + 0.5, SEG_W - 1, ING_H - 1);
    }
}

function drawChef() {
    var x = chef.x;
    var y = chef.y;
    var bob = chef.climbing ? Math.floor(animTime * 8) % 2 : 0;

    ctx.fillStyle = '#2f6fd0'; // legs
    ctx.fillRect(x - 7, y - 9, 5, 9 - bob);
    ctx.fillRect(x + 2, y - 9, 5, 9 - (1 - bob));

    ctx.fillStyle = '#f2f4f8'; // apron / body
    ctx.fillRect(x - 8, y - 20, 16, 12);
    ctx.fillStyle = '#d9dee8';
    ctx.fillRect(x - 8, y - 12, 16, 2);

    ctx.fillStyle = '#f0c9a0'; // face
    ctx.fillRect(x - 6, y - 26, 12, 7);
    ctx.fillStyle = '#22160e';
    ctx.fillRect(x + (chef.dir > 0 ? 1 : -4), y - 24, 3, 2);

    ctx.fillStyle = '#ffffff'; // hat
    ctx.fillRect(x - 7, y - 31, 14, 5);
    ctx.beginPath();
    ctx.ellipse(x, y - 32, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawEnemy(e) {
    if (e.dead) return;
    var colors = ENEMY_COLORS[e.kind];
    var shake = e.stunTimer > 0 ? (Math.floor(animTime * 20) % 2 ? 1 : -1) : 0;
    var x = e.x + shake;
    var y = e.y;

    ctx.fillStyle = e.stunTimer > 0 ? '#5b8bd0' : colors[0];
    ctx.fillRect(x - 9, y - 20, 18, 20);
    ctx.fillStyle = e.stunTimer > 0 ? '#87b0e8' : colors[1];
    ctx.fillRect(x - 9, y - 24, 18, 6);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 6, y - 17, 5, 5);
    ctx.fillRect(x + 1, y - 17, 5, 5);
    ctx.fillStyle = '#1a1008';
    var look = e.dir > 0 ? 2 : 0;
    ctx.fillRect(x - 5 + look, y - 16, 2, 3);
    ctx.fillRect(x + 2 + look, y - 16, 2, 3);

    ctx.fillStyle = '#1a1008'; // feet
    ctx.fillRect(x - 8, y - 3, 6, 3);
    ctx.fillRect(x + 2, y - 3, 6, 3);
}

function drawPepper() {
    var alpha = clamp(pepper.timer / PEPPER_LIFE, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.5 * alpha;
    ctx.fillStyle = '#f0e6d2';
    for (var i = 0; i < 9; i++) {
        var px = pepper.x + ((i * 13) % pepper.w);
        var py = pepper.y + ((i * 7) % pepper.h);
        ctx.beginPath();
        ctx.arc(px, py, 3 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    if (!els.score) return;
    els.score.textContent = String(score);
    els.lives.textContent = String(Math.max(0, lives));
    els.level.textContent = String(level);
    els.peppers.textContent = String(peppers);
    els.best.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    if (!els.overlay) return;
    els.overlayTitle.textContent = title;
    els.overlayScore.textContent = scoreLine || '';
    els.overlaySub.textContent = sub || '';
    els.overlay.classList.add('visible');
}

function hideOverlay() {
    if (els.overlay) els.overlay.classList.remove('visible');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        clearInput();
        showOverlay('PAUSED', 'Score ' + score, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

var MOVE_KEYS = {
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
    ArrowUp: 'up',
    KeyW: 'up',
    ArrowDown: 'down',
    KeyS: 'down',
};

function onKeyDown(ev) {
    var move = MOVE_KEYS[ev.code];
    if (move) {
        input[move] = true;
        ev.preventDefault();
        return;
    }
    if (ev.code === 'Space' || ev.code === 'Enter') {
        ev.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else if (ev.code === 'Space' && state === 'running') firePepper();
        return;
    }
    if (ev.code === 'KeyP') {
        ev.preventDefault();
        togglePause();
    }
}

function onKeyUp(ev) {
    var move = MOVE_KEYS[ev.code];
    if (move) {
        input[move] = false;
        ev.preventDefault();
    }
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

function setAutoLoop(on) {
    autoLoop = !!on;
    lastTs = 0;
}

function frame(ts) {
    if (!lastTs) lastTs = ts;
    var dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    if (autoLoop && dt > 0) tick(dt);
    draw();
    updateHud();
    window.requestAnimationFrame(frame);
}

function init() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    els = {
        score: document.getElementById('score'),
        lives: document.getElementById('lives'),
        level: document.getElementById('level'),
        peppers: document.getElementById('peppers'),
        best: document.getElementById('best'),
        overlay: document.getElementById('overlay'),
        overlayTitle: document.getElementById('overlay-title'),
        overlayScore: document.getElementById('overlay-score'),
        overlaySub: document.getElementById('overlay-sub'),
    };

    try {
        best = parseInt(window.localStorage.getItem(BEST_KEY), 10) || 0;
    } catch (err) {
        best = 0;
    }

    resetLevel();
    updateHud();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearInput);
    document.getElementById('btn-start').addEventListener('click', function () {
        startGame();
        canvas.focus();
    });

    window.requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
