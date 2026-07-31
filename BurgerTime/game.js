// ---------------------------------------------------------------------------
// Burger Time — a platform-and-ladder arcade game on an HTML5 canvas.
//
// The chef walks across burger ingredients to stamp them down a floor at a time
// until every layer lands on the plates at the bottom, dodging (or peppering)
// the food enemies that hunt him through the maze.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run and Snake in this repo. All motion is expressed per second and
// advanced through `step(dt)`; the real-time loop only calls `step()` when
// `autoLoop` is true, so tests can switch it off and drive the simulation by
// hand with exact timing.
// ---------------------------------------------------------------------------

// --- World geometry (20 x 16 tiles of 32px) ---
const CANVAS_W = 640;
const CANVAS_H = 512;
const TILE = 32;

const FLOOR_Y = [64, 160, 256, 352, 448];   // walkable platform heights
const LADDER_X = [48, 240, 432, 624];       // ladder centres, full height
const STACK_X = [64, 256, 448];             // left edge of each burger stack
const SEGMENTS = 4;                         // segments per ingredient
const SEG_W = TILE;
const STACK_W = SEGMENTS * SEG_W;           // 128
const PLATE_FLOOR = FLOOR_Y.length - 1;     // ingredients pile up here

// --- Ingredients, bottom of the burger first on the lowest floor ---
const KINDS = ['topbun', 'lettuce', 'patty', 'bottombun'];
const INGREDIENT_H = 11;

// --- Chef ---
const CHEF_START = { x: LADDER_X[1], y: FLOOR_Y[PLATE_FLOOR] };
const CHEF_HALF_W = 12;
const CHEF_H = 30;
const WALK_SPEED = 100;      // px/s
const CLIMB_SPEED = 85;      // px/s
const LADDER_SNAP = 10;      // how close to a ladder you must be to climb
const FLOOR_SNAP = 6;        // how close to a floor before you settle on it

// --- Ingredients in flight ---
const FALL_SPEED = 200;      // px/s

// --- Enemies ---
const ENEMY_TYPES = ['hotdog', 'pickle', 'egg'];
const ENEMY_BASE = 52;       // px/s on level 1
const ENEMY_STEP = 9;        // extra px/s per level
const ENEMY_HALF_W = 11;
const ENEMY_H = 26;
const SPAWN_FIRST = 3;       // seconds before the first enemy of a life
const SPAWN_INTERVAL = 6;    // seconds between enemies
const SPAWN_POINTS = [
    { x: LADDER_X[0], y: FLOOR_Y[0] },
    { x: LADDER_X[3], y: FLOOR_Y[0] },
    { x: LADDER_X[1], y: FLOOR_Y[0] },
    { x: LADDER_X[2], y: FLOOR_Y[0] },
];

// --- Pepper ---
const PEPPER_START = 5;
const PEPPER_W = 40;
const PEPPER_H = 34;
const PEPPER_LIFE = 0.4;     // seconds the cloud lingers
const PEPPER_REACH = 26;     // how far in front of the chef the cloud sits
const STUN_TIME = 3.5;       // seconds an enemy stays frozen

// --- Scoring ---
const DROP_POINTS = 50;
const PLATE_POINTS = 100;
const SQUASH_POINTS = 500;
const LEVEL_BONUS = 1000;
const START_LIVES = 3;

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
let state, score, best, level, lives, pepper, spawnTimer, spawnCount;
let autoLoop = true;         // tests switch this off to step by hand
const chef = { x: CHEF_START.x, y: CHEF_START.y, facing: 1 };
const input = { left: false, right: false, up: false, down: false };
const ingredients = [];
const enemies = [];
const peppers = [];
const sparks = [];           // purely decorative squash confetti

// ---------------------------------------------------------------------------
// Geometry helpers (pure)
// ---------------------------------------------------------------------------

// Index of the floor an entity is exactly standing on, or -1 between floors.
function floorIndexAt(y) {
    for (let i = 0; i < FLOOR_Y.length; i++) {
        if (Math.abs(y - FLOOR_Y[i]) < 0.5) return i;
    }
    return -1;
}

function nearestFloorIndex(y) {
    let best = 0;
    for (let i = 1; i < FLOOR_Y.length; i++) {
        if (Math.abs(y - FLOOR_Y[i]) < Math.abs(y - FLOOR_Y[best])) best = i;
    }
    return best;
}

function nearestLadderX(x) {
    let best = LADDER_X[0];
    for (const lx of LADDER_X) {
        if (Math.abs(x - lx) < Math.abs(x - best)) best = lx;
    }
    return best;
}

// Index of the burger stack whose column contains x, or -1.
function stackIndexAt(x) {
    for (let i = 0; i < STACK_X.length; i++) {
        if (x >= STACK_X[i] && x < STACK_X[i] + STACK_W) return i;
    }
    return -1;
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function enemySpeed() {
    return ENEMY_BASE + (level - 1) * ENEMY_STEP;
}

function maxEnemies() {
    return Math.min(5, 2 + level);
}

// ---------------------------------------------------------------------------
// Level building
// ---------------------------------------------------------------------------

function buildIngredients() {
    ingredients.length = 0;
    for (let s = 0; s < STACK_X.length; s++) {
        for (let k = 0; k < KINDS.length; k++) {
            ingredients.push({
                stack: s,
                kind: KINDS[k],
                floor: k,                 // top bun highest, bottom bun lowest
                y: FLOOR_Y[k],
                state: 'rest',            // 'rest' | 'falling' | 'plated'
                pressed: new Array(SEGMENTS).fill(false),
                hasPushed: false,         // already knocked a pile loose this fall
                plateIndex: -1,
            });
        }
    }
}

function ingredientLeft(ing) {
    return STACK_X[ing.stack];
}

function resetChef() {
    chef.x = CHEF_START.x;
    chef.y = CHEF_START.y;
    chef.facing = 1;
    clearInput();
}

function resetLevel() {
    buildIngredients();
    enemies.length = 0;
    peppers.length = 0;
    sparks.length = 0;
    pepper = PEPPER_START;
    spawnTimer = SPAWN_FIRST;
    spawnCount = 0;
    resetChef();
}

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    resetLevel();
    state = 'running';
    updateHud();
    showOverlay(false);
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay(true, 'PAUSED', '', 'Press P or click Resume to carry on');
    } else if (state === 'paused') {
        state = 'running';
        showOverlay(false);
    }
}

function endGame() {
    state = 'over';
    clearInput();
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay(true, 'GAME OVER', `Score ${score} — Level ${level}`,
        'Press Space or click Start to play again');
}

// ---------------------------------------------------------------------------
// Scoring / HUD
// ---------------------------------------------------------------------------

function addScore(points) {
    score += points;
    updateHud();
}

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    pepperEl.textContent = String(pepper);
    bestEl.textContent = String(best);
}

function showOverlay(visible, title, scoreLine, sub) {
    overlay.classList.toggle('visible', !!visible);
    if (!visible) return;
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function setChefAt(x, y) {
    chef.x = clamp(x, CHEF_HALF_W, CANVAS_W - CHEF_HALF_W);
    chef.y = y;
}

function clearInput() {
    input.left = input.right = input.up = input.down = false;
}

function updateChef(dt) {
    // Climbing takes priority: it is only possible on (or very near) a ladder.
    if (input.up || input.down) {
        const lx = nearestLadderX(chef.x);
        const climbing = floorIndexAt(chef.y) < 0;
        if (climbing || Math.abs(chef.x - lx) <= LADDER_SNAP) {
            const dir = input.up ? -1 : 1;
            const next = clamp(chef.y + dir * CLIMB_SPEED * dt,
                FLOOR_Y[0], FLOOR_Y[FLOOR_Y.length - 1]);
            if (next !== chef.y) {
                chef.x = lx;
                chef.y = next;
                return;                     // no walking while on the ladder
            }
        }
    }

    // Settle onto a floor when close enough, so a released ladder lines up.
    if (floorIndexAt(chef.y) < 0) {
        const fy = FLOOR_Y[nearestFloorIndex(chef.y)];
        if (Math.abs(chef.y - fy) <= FLOOR_SNAP) chef.y = fy;
    }

    if (floorIndexAt(chef.y) < 0) return;   // between floors: cannot walk

    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
        chef.facing = dir;
        chef.x = clamp(chef.x + dir * WALK_SPEED * dt, CHEF_HALF_W, CANVAS_W - CHEF_HALF_W);
    }
}

// Stamp the top ingredient of whichever pile the chef is standing on.
function stampUnderChef() {
    const floor = floorIndexAt(chef.y);
    if (floor < 0) return;
    const stack = stackIndexAt(chef.x);
    if (stack < 0) return;
    const pile = pileAt(stack, floor);
    if (!pile.length) return;
    const top = pile[pile.length - 1];
    const seg = clamp(Math.floor((chef.x - ingredientLeft(top)) / SEG_W), 0, SEGMENTS - 1);
    if (top.pressed[seg]) return;
    top.pressed[seg] = true;
    if (top.pressed.every(Boolean)) dropPile(stack, floor);
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

// Layer order within a burger: 0 is the top bun, 3 the bottom bun. Ingredients
// can never overtake each other, so this doubles as the stacking order of any
// pile — the highest rank sits on the bottom.
function layerRank(ing) {
    return KINDS.indexOf(ing.kind);
}

// The ingredients resting on one floor of one stack, bottom layer first.
function pileAt(stack, floor) {
    return ingredients
        .filter((i) => i.state === 'rest' && i.stack === stack && i.floor === floor)
        .sort((a, b) => layerRank(b) - layerRank(a));
}

// How many resting ingredients this one is sitting on (0 = on the floor).
function pileHeightOf(ing) {
    return Math.max(0, pileAt(ing.stack, ing.floor).indexOf(ing));
}

// Send a whole pile down one floor. `hasPushed` is what stops the chain: an
// ingredient may knock the pile below it loose once, and after that it just
// comes to rest on top of whatever it finds.
function dropPile(stack, floor) {
    const pile = pileAt(stack, floor);
    for (const ing of pile) {
        ing.state = 'falling';
        ing.hasPushed = false;
        ing.targetFloor = Math.min(floor + 1, PLATE_FLOOR);
        ing.pressed.fill(false);
        addScore(DROP_POINTS);
    }
    return pile;
}

// Drop the pile the given ingredient belongs to (the tests' entry point).
function dropIngredient(ing) {
    if (ing.state !== 'rest') return;
    dropPile(ing.stack, ing.floor);
}

// An ingredient of the same stack already on its way down past this floor: the
// arriving one rides along instead of stopping in mid-air.
function ridingIngredientAt(stack, floor, except) {
    return ingredients.find((i) => i !== except && i.stack === stack
        && i.state === 'falling' && i.targetFloor > floor && i.y >= FLOOR_Y[floor] - 1);
}

function plateIngredient(ing) {
    ing.state = 'plated';
    ing.floor = PLATE_FLOOR;
    ing.plateIndex = ingredients.filter(
        (i) => i !== ing && i.stack === ing.stack && i.state === 'plated').length;
    ing.y = FLOOR_Y[PLATE_FLOOR] - ing.plateIndex * (INGREDIENT_H - 1);
    ing.pressed.fill(false);
    addScore(PLATE_POINTS);
}

function landIngredient(ing) {
    const floor = ing.targetFloor;
    ing.floor = floor;
    ing.y = FLOOR_Y[floor];
    if (floor >= PLATE_FLOOR) {
        plateIngredient(ing);
        return;
    }
    const pile = pileAt(ing.stack, floor);
    if (pile.length && !ing.hasPushed) {
        // Knock the pile below loose; everything drops one more floor together.
        for (const below of pile) {
            below.state = 'falling';
            below.hasPushed = true;
            below.pressed.fill(false);
            below.targetFloor = Math.min(floor + 1, PLATE_FLOOR);
        }
        ing.hasPushed = true;
        ing.targetFloor = Math.min(floor + 1, PLATE_FLOOR);
        return;
    }
    if (!pile.length && ridingIngredientAt(ing.stack, floor, ing)) {
        // The rest of this pile is still going down; ride along with it.
        ing.hasPushed = true;
        ing.targetFloor = Math.min(floor + 1, PLATE_FLOOR);
        return;
    }
    ing.state = 'rest';
    ing.hasPushed = false;
    ing.pressed.fill(false);
}

function squashEnemiesUnder(ing) {
    const left = ingredientLeft(ing);
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (e.x < left || e.x > left + STACK_W) continue;
        if (Math.abs(e.y - ing.y) > 16) continue;
        enemies.splice(i, 1);
        addScore(SQUASH_POINTS);
        spawnSparks(e.x, e.y);
    }
}

function updateIngredients(dt) {
    // Lower layers are resolved first so that a pile lands (and plates) in the
    // right order when several ingredients arrive on the same frame.
    const falling = ingredients.filter((i) => i.state === 'falling')
        .sort((a, b) => layerRank(b) - layerRank(a));
    for (const ing of falling) {
        if (ing.state !== 'falling') continue;
        ing.y += FALL_SPEED * dt;
        squashEnemiesUnder(ing);
        const targetY = FLOOR_Y[ing.targetFloor];
        if (ing.y >= targetY) landIngredient(ing);
    }
}

// Test / debug helper: put every ingredient straight onto its plate.
function plateAll() {
    for (const ing of ingredients) {
        ing.state = 'plated';
        ing.floor = PLATE_FLOOR;
        ing.pressed.fill(false);
        ing.plateIndex = ingredients.filter(
            (i) => i !== ing && i.stack === ing.stack && i.state === 'plated').length;
        ing.y = FLOOR_Y[PLATE_FLOOR] - ing.plateIndex * (INGREDIENT_H - 1);
    }
}

function checkLevelComplete() {
    if (!ingredients.every((i) => i.state === 'plated')) return;
    addScore(LEVEL_BONUS * level);
    level += 1;
    resetLevel();
    updateHud();
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemy(opts) {
    opts = opts || {};
    const point = SPAWN_POINTS[spawnCount % SPAWN_POINTS.length];
    const e = {
        x: opts.x != null ? opts.x : point.x,
        y: opts.y != null ? opts.y : point.y,
        type: opts.type || ENEMY_TYPES[spawnCount % ENEMY_TYPES.length],
        facing: 1,
        stun: 0,
        climbDir: 1,
        climbTargetY: FLOOR_Y[0],
    };
    spawnCount += 1;
    enemies.push(e);
    return e;
}

function moveToward(e, targetX, dist) {
    const d = targetX - e.x;
    if (Math.abs(d) <= dist) { e.x = targetX; return; }
    const dir = d > 0 ? 1 : -1;
    e.facing = dir;
    e.x += dir * dist;
}

function updateEnemy(e, dt) {
    if (e.stun > 0) {
        e.stun = Math.max(0, e.stun - dt);
        return;
    }
    const speed = enemySpeed();
    const myFloor = floorIndexAt(e.y);

    if (myFloor < 0) {                       // mid-ladder: finish the climb
        e.y += e.climbDir * speed * dt;
        if ((e.climbDir > 0 && e.y >= e.climbTargetY)
            || (e.climbDir < 0 && e.y <= e.climbTargetY)) {
            e.y = e.climbTargetY;
        }
        return;
    }

    const targetFloor = nearestFloorIndex(chef.y);
    if (targetFloor === myFloor) {
        moveToward(e, chef.x, speed * dt);
        return;
    }

    const lx = nearestLadderX(e.x);
    if (Math.abs(e.x - lx) <= 1.5) {
        e.x = lx;
        e.climbDir = targetFloor > myFloor ? 1 : -1;
        e.climbTargetY = FLOOR_Y[myFloor + e.climbDir];
        e.y += e.climbDir * speed * dt;
    } else {
        moveToward(e, lx, speed * dt);
    }
}

function updateEnemies(dt) {
    for (const e of enemies) updateEnemy(e, dt);
}

function updateSpawner(dt) {
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = SPAWN_INTERVAL;
    if (enemies.length < maxEnemies()) spawnEnemy();
}

function checkChefHit() {
    for (const e of enemies) {
        if (e.stun > 0) continue;
        if (Math.abs(e.x - chef.x) < CHEF_HALF_W + ENEMY_HALF_W - 5
            && Math.abs(e.y - chef.y) < 20) {
            loseLife();
            return;
        }
    }
}

function loseLife() {
    lives -= 1;
    enemies.length = 0;
    peppers.length = 0;
    pepper = PEPPER_START;
    spawnTimer = SPAWN_FIRST;
    resetChef();
    if (lives <= 0) {
        lives = 0;
        endGame();
        return;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function sprayPepper() {
    if (state !== 'running' || pepper <= 0) return false;
    pepper -= 1;
    peppers.push({
        x: chef.x + chef.facing * PEPPER_REACH,
        y: chef.y - PEPPER_H / 2,
        life: PEPPER_LIFE,
    });
    updateHud();
    return true;
}

function updatePeppers(dt) {
    for (let i = peppers.length - 1; i >= 0; i--) {
        const p = peppers[i];
        p.life -= dt;
        for (const e of enemies) {
            const ey = e.y - ENEMY_H / 2;
            if (Math.abs(e.x - p.x) < (PEPPER_W + ENEMY_HALF_W * 2) / 2
                && Math.abs(ey - p.y) < (PEPPER_H + ENEMY_H) / 2) {
                e.stun = STUN_TIME;
            }
        }
        if (p.life <= 0) peppers.splice(i, 1);
    }
}

function spawnSparks(x, y) {
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        sparks.push({ x, y: y - 12, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, life: 0.5 });
    }
}

function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 220 * dt;
        s.life -= dt;
        if (s.life <= 0) sparks.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation step — the single entry point the tests drive
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    updateChef(dt);
    stampUnderChef();
    updateIngredients(dt);
    updatePeppers(dt);
    updateEnemies(dt);
    checkChefHit();
    if (state !== 'running') return;         // a life was lost this frame
    updateSpawner(dt);
    checkLevelComplete();
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const INGREDIENT_STYLE = {
    topbun: { fill: '#e0a04a', edge: '#b87a2c' },
    lettuce: { fill: '#7ac74f', edge: '#4f9631' },
    patty: { fill: '#8b5a2b', edge: '#5e3a17' },
    bottombun: { fill: '#cf8f3f', edge: '#a06726' },
};

const ENEMY_STYLE = {
    hotdog: { body: '#e2603c', trim: '#f4b26a' },
    pickle: { body: '#5fa832', trim: '#8fd45e' },
    egg: { body: '#f2f0e4', trim: '#ffcf4a' },
};

function drawMaze() {
    // Ladders behind the floors.
    for (const lx of LADDER_X) {
        ctx.strokeStyle = '#4c5a86';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lx - 11, FLOOR_Y[0]);
        ctx.lineTo(lx - 11, FLOOR_Y[PLATE_FLOOR]);
        ctx.moveTo(lx + 11, FLOOR_Y[0]);
        ctx.lineTo(lx + 11, FLOOR_Y[PLATE_FLOOR]);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#7182b8';
        for (let y = FLOOR_Y[0] + 8; y < FLOOR_Y[PLATE_FLOOR]; y += 12) {
            ctx.beginPath();
            ctx.moveTo(lx - 11, y);
            ctx.lineTo(lx + 11, y);
            ctx.stroke();
        }
    }

    // Floors.
    for (const fy of FLOOR_Y) {
        ctx.fillStyle = '#3d4a70';
        ctx.fillRect(0, fy, CANVAS_W, 5);
        ctx.fillStyle = '#26304d';
        for (let x = 4; x < CANVAS_W; x += 16) ctx.fillRect(x, fy + 1, 6, 3);
    }

    // Plates.
    for (const sx of STACK_X) {
        ctx.fillStyle = '#cfd6e6';
        ctx.beginPath();
        ctx.ellipse(sx + STACK_W / 2, FLOOR_Y[PLATE_FLOOR] + 6, STACK_W / 2 + 6, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9aa5bd';
        ctx.fillRect(sx - 4, FLOOR_Y[PLATE_FLOOR] + 2, STACK_W + 8, 4);
    }
}

// Height of the pile an entity standing at (stack, floor) is walking on.
function pileLift(stack, floor) {
    return pileAt(stack, floor).length * (INGREDIENT_H - 3);
}

function drawIngredient(ing) {
    const style = INGREDIENT_STYLE[ing.kind];
    const left = ingredientLeft(ing);
    const stacked = ing.state === 'rest' ? pileHeightOf(ing) * (INGREDIENT_H - 3) : 0;
    for (let s = 0; s < SEGMENTS; s++) {
        const sunk = ing.state === 'rest' && ing.pressed[s] ? 4 : 0;
        const x = left + s * SEG_W;
        const y = ing.y - INGREDIENT_H + sunk - stacked;
        ctx.fillStyle = style.fill;
        if (ing.kind === 'topbun') {
            ctx.beginPath();
            ctx.moveTo(x, y + INGREDIENT_H);
            ctx.lineTo(x, y + 5);
            ctx.quadraticCurveTo(x + SEG_W / 2, y - 4, x + SEG_W, y + 5);
            ctx.lineTo(x + SEG_W, y + INGREDIENT_H);
            ctx.closePath();
            ctx.fill();
        } else if (ing.kind === 'lettuce') {
            ctx.beginPath();
            ctx.moveTo(x, y + 1);
            for (let i = 0; i <= 4; i++) {
                ctx.lineTo(x + (i * SEG_W) / 4, y + (i % 2 ? INGREDIENT_H : INGREDIENT_H - 5));
            }
            ctx.lineTo(x + SEG_W, y + 1);
            ctx.closePath();
            ctx.fill();
        } else if (ing.kind === 'bottombun') {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + SEG_W, y);
            ctx.lineTo(x + SEG_W, y + INGREDIENT_H - 3);
            ctx.quadraticCurveTo(x + SEG_W / 2, y + INGREDIENT_H + 3, x, y + INGREDIENT_H - 3);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillRect(x, y, SEG_W, INGREDIENT_H);
            ctx.fillStyle = style.edge;
            for (let i = 0; i < 3; i++) ctx.fillRect(x + 5 + i * 9, y + 3 + (i % 2) * 4, 4, 2);
        }
        ctx.strokeStyle = style.edge;
        ctx.lineWidth = 1;
        if (ing.kind === 'patty' || ing.kind === 'topbun') {
            ctx.strokeRect(x + 0.5, y + 0.5, SEG_W - 1, INGREDIENT_H - 1);
        }
        if (ing.kind === 'topbun') {
            ctx.fillStyle = '#fff3d6';
            ctx.fillRect(x + 8, y + 3, 3, 2);
            ctx.fillRect(x + 20, y + 5, 3, 2);
        }
    }
}

function drawChef() {
    const x = chef.x;
    // Purely cosmetic: stand the chef on top of the pile he is walking over.
    const floor = floorIndexAt(chef.y);
    const stack = stackIndexAt(chef.x);
    const y = chef.y - (floor >= 0 && stack >= 0 ? pileLift(stack, floor) : 0);
    // legs
    ctx.fillStyle = '#2f3a5c';
    ctx.fillRect(x - 8, y - 10, 6, 10);
    ctx.fillRect(x + 2, y - 10, 6, 10);
    // body
    ctx.fillStyle = '#f6f2e8';
    ctx.fillRect(x - CHEF_HALF_W, y - CHEF_H + 6, CHEF_HALF_W * 2, CHEF_H - 16);
    // apron shadow
    ctx.fillStyle = '#dcd5c6';
    ctx.fillRect(x - CHEF_HALF_W + 3, y - 16, CHEF_HALF_W * 2 - 6, 6);
    // head
    ctx.fillStyle = '#f0c08a';
    ctx.fillRect(x - 7, y - CHEF_H + 1, 14, 8);
    // hat
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 9, y - CHEF_H - 6, 18, 7);
    // eye, facing aware
    ctx.fillStyle = '#221a12';
    ctx.fillRect(x + (chef.facing > 0 ? 2 : -4), y - CHEF_H + 3, 2, 3);
}

function drawEnemy(e) {
    const style = ENEMY_STYLE[e.type] || ENEMY_STYLE.hotdog;
    const x = e.x;
    const y = e.y;
    ctx.fillStyle = e.stun > 0 ? '#7f8cb5' : style.body;
    ctx.beginPath();
    ctx.roundRect
        ? ctx.roundRect(x - ENEMY_HALF_W, y - ENEMY_H, ENEMY_HALF_W * 2, ENEMY_H, 8)
        : ctx.rect(x - ENEMY_HALF_W, y - ENEMY_H, ENEMY_HALF_W * 2, ENEMY_H);
    ctx.fill();
    ctx.fillStyle = e.stun > 0 ? '#aab5d6' : style.trim;
    ctx.fillRect(x - ENEMY_HALF_W + 3, y - ENEMY_H + 8, ENEMY_HALF_W * 2 - 6, 5);
    // eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 7, y - ENEMY_H + 3, 5, 5);
    ctx.fillRect(x + 2, y - ENEMY_H + 3, 5, 5);
    ctx.fillStyle = '#1a1524';
    ctx.fillRect(x - 6 + (e.facing > 0 ? 2 : 0), y - ENEMY_H + 4, 2, 3);
    ctx.fillRect(x + 3 + (e.facing > 0 ? 2 : 0), y - ENEMY_H + 4, 2, 3);
    // little feet
    ctx.fillStyle = '#241d33';
    ctx.fillRect(x - 9, y - 3, 7, 3);
    ctx.fillRect(x + 2, y - 3, 7, 3);
    if (e.stun > 0) {
        ctx.fillStyle = '#ffe066';
        ctx.fillRect(x - 2, y - ENEMY_H - 8, 4, 4);
        ctx.fillRect(x - 8, y - ENEMY_H - 5, 3, 3);
        ctx.fillRect(x + 6, y - ENEMY_H - 5, 3, 3);
    }
}

function drawPepper(p) {
    const alpha = clamp(p.life / PEPPER_LIFE, 0, 1);
    ctx.globalAlpha = 0.35 + alpha * 0.5;
    ctx.fillStyle = '#e8e2d0';
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const r = 6 + (i % 4) * 4;
        ctx.fillRect(p.x + Math.cos(a) * r - 2, p.y + Math.sin(a) * r - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#120b18';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawMaze();
    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    for (const p of peppers) drawPepper(p);

    ctx.fillStyle = '#ffd66b';
    for (const s of sparks) {
        ctx.globalAlpha = clamp(s.life * 2, 0, 1);
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    if (state !== 'idle') drawChef();
}

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;                // clamp after tab switches
    if (autoLoop && state === 'running') step(dt);
    updateSparks(dt);
    draw();
    requestAnimationFrame(frame);
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
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') sprayPepper();
        e.preventDefault();
        return;
    }
    const action = KEY_MAP[e.key];
    if (action) {
        input[action] = true;
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const action = KEY_MAP[e.key];
    if (action) input[action] = false;
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = 0;
try { best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0; } catch (e) { /* ignore */ }
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
pepper = PEPPER_START;
spawnTimer = SPAWN_FIRST;
spawnCount = 0;
buildIngredients();
updateHud();
requestAnimationFrame(frame);
