// ---------------------------------------------------------------------------
// BurgerTime — a ladder-and-girder arcade game on an HTML5 canvas.
//
// The chef walks the full width of a burger ingredient to knock it loose; it
// falls to the floor below, knocking anything it lands on loose in turn, until
// the whole burger is assembled on the plate at the bottom. Food monsters hunt
// the chef across the girders; a shake of pepper stuns them and a falling
// ingredient squashes them flat.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Kaboom!,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Grid / layout -------------------------------------------------------
const TILE_W = 28;
const COLS = 20;
const CANVAS_W = COLS * TILE_W;   // 560
const CANVAS_H = 460;

const FLOOR_COUNT = 5;
const FLOOR_TOP = 56;
const FLOOR_SPACING = 80;
const FLOOR_Y = Array.from({ length: FLOOR_COUNT }, (_, f) => FLOOR_TOP + f * FLOOR_SPACING);
const PLATE_FLOOR = FLOOR_COUNT - 1;
const GIRDER_H = 6;

// Burger stacks occupy 4 columns each; the gaps between them carry the ladders.
const ING_TILES = 4;
const ING_W = ING_TILES * TILE_W; // 112
const ING_THICK = 10;
const STACK_COLS = [2, 8, 14];
const STACK_LEFT = STACK_COLS.map((c) => c * TILE_W); // 56, 224, 392
const STACK_COUNT = STACK_COLS.length;
const KINDS = ['buntop', 'lettuce', 'patty', 'bunbottom'];
const TOTAL_INGREDIENTS = STACK_COUNT * KINDS.length;

// Half-height, offset ladders force the player to walk along a floor between
// climbs — which is what makes the monsters dangerous.
const LADDERS = [
    { col: 0, from: 0, to: 4 },
    { col: 6, from: 0, to: 2 },
    { col: 7, from: 2, to: 4 },
    { col: 12, from: 0, to: 2 },
    { col: 13, from: 2, to: 4 },
    { col: 19, from: 0, to: 4 },
];

// --- Chef ----------------------------------------------------------------
const CHEF_SPEED = 120;   // px/s walking
const CLIMB_SPEED = 96;   // px/s climbing
const CHEF_HW = 11;       // half-width
const CHEF_H = 26;
const SNAP = 8;           // how close to a ladder you must be to grab it
const SNAP_EPS = 2.5;     // how close to a floor line counts as arriving

// --- Ingredients ---------------------------------------------------------
const FALL_SPEED = 170;
const DROP_POINTS = 50;
const SQUASH_POINTS = 500;

// --- Monsters ------------------------------------------------------------
const ENEMY_TYPES = ['hotdog', 'pickle', 'egg', 'sausage'];
const ENEMY_SPEED = 52;
const ENEMY_SPEED_STEP = 6;
const ENEMY_SPEED_CAP = CHEF_SPEED - 12;
const ENEMY_HW = 11;
const ENEMY_H = 22;
const SPAWN_BASE = 4.0, SPAWN_STEP = 0.35, SPAWN_MIN = 1.6;
const FIRST_SPAWN = 2.5;
const CRUSH_LINGER = 0.6;

// --- Pepper --------------------------------------------------------------
const PEPPER_START = 5;
const STUN_TIME = 4;
const CLOUD_LIFE = 0.35;
const CLOUD_OFFSET = 22;
const CLOUD_HW = 22;

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const DEATH_PAUSE = 1.4;
const CLEAR_PAUSE = 1.8;
const START_FLOOR = 2;
const START_COL = 6;

// --- Colours -------------------------------------------------------------
const KIND_COLOR = {
    buntop: '#d99b4a',
    lettuce: '#6fbf4a',
    patty: '#7b4a2a',
    bunbottom: '#c98a3f',
};

const ENEMY_COLOR = {
    hotdog: '#d9534f',
    pickle: '#6db33f',
    egg: '#f2e2bd',
    sausage: '#b5651d',
};

// --- DOM -----------------------------------------------------------------
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

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'dying' | 'levelclear' | 'over'
let state, score, best, lives, level, peppers;
let spawnTimer, spawnIndex, typeIndex, deathTimer, clearTimer;

// `spawnEnabled` is a test seam: the specs that measure movement or drops turn
// monster spawning off so long simulations stay deterministic.
let spawnEnabled = true;

const chef = {
    x: 0, y: 0, floor: START_FLOOR, mode: 'floor', facing: 1,
    dir: { x: 0, y: 0 }, ladder: null, ride: null,
};
const enemies = [];
const ingredients = [];
const clouds = [];
const plates = Array.from({ length: STACK_COUNT }, () => ({ count: 0 }));

// ---------------------------------------------------------------------------
// Layout helpers (pure)
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function ladderX(col) { return col * TILE_W + TILE_W / 2; }

// Does ladder `l` let you leave `floor` travelling in `dir` (-1 up, +1 down)?
function ladderSpans(l, floor, dir) {
    if (!l) return false;
    return dir < 0 ? floor > l.from && floor <= l.to : floor >= l.from && floor < l.to;
}

// The stack index whose ingredient columns contain `x`, or -1.
function stackOfX(x) {
    for (let s = 0; s < STACK_COUNT; s++) {
        if (x >= STACK_LEFT[s] && x < STACK_LEFT[s] + ING_W) return s;
    }
    return -1;
}

// Nearest usable ladder within grabbing range of `x`.
function findLadderNear(x, floor, dir) {
    let best = null, bestD = Infinity;
    for (const l of LADDERS) {
        if (!ladderSpans(l, floor, dir)) continue;
        const d = Math.abs(ladderX(l.col) - x);
        if (d <= SNAP && d < bestD) { best = l; bestD = d; }
    }
    return best;
}

// Nearest usable ladder anywhere on the floor (used by the monster AI).
function nearestLadder(x, floor, dir) {
    let best = null, bestD = Infinity;
    for (const l of LADDERS) {
        if (!ladderSpans(l, floor, dir)) continue;
        const d = Math.abs(ladderX(l.col) - x);
        if (d < bestD) { best = l; bestD = d; }
    }
    return best;
}

function nearestFloorIndex(y) {
    let best = 0;
    for (let f = 1; f < FLOOR_COUNT; f++) {
        if (Math.abs(FLOOR_Y[f] - y) < Math.abs(FLOOR_Y[best] - y)) best = f;
    }
    return best;
}

// First floor line strictly beyond `y` in direction `dir`.
function nextFloorIndex(y, dir) {
    let best = -1;
    for (let f = 0; f < FLOOR_COUNT; f++) {
        if (dir < 0 && FLOOR_Y[f] < y - 1e-6) { if (best === -1 || FLOOR_Y[f] > FLOOR_Y[best]) best = f; }
        if (dir > 0 && FLOOR_Y[f] > y + 1e-6) { if (best === -1 || FLOOR_Y[f] < FLOOR_Y[best]) best = f; }
    }
    return best;
}

function enemySpeed() {
    return Math.min(ENEMY_SPEED_CAP, ENEMY_SPEED + (level - 1) * ENEMY_SPEED_STEP);
}

function spawnInterval() {
    return Math.max(SPAWN_MIN, SPAWN_BASE - (level - 1) * SPAWN_STEP);
}

function maxEnemies() {
    return Math.min(6, 3 + Math.floor((level - 1) / 2));
}

function spawnPoints() {
    const pts = [
        { x: TILE_W / 2, floor: PLATE_FLOOR },
        { x: CANVAS_W - TILE_W / 2, floor: PLATE_FLOOR },
    ];
    if (level >= 3) {
        pts.push({ x: TILE_W / 2, floor: 0 }, { x: CANVAS_W - TILE_W / 2, floor: 0 });
    }
    return pts;
}

// ---------------------------------------------------------------------------
// Setup / reset
// ---------------------------------------------------------------------------

function ingredientRestY(floor, plateCount) {
    return floor === PLATE_FLOOR
        ? FLOOR_Y[PLATE_FLOOR] - ING_THICK / 2 - plateCount * ING_THICK
        : FLOOR_Y[floor] - ING_THICK / 2;
}

function resetIngredients() {
    ingredients.length = 0;
    for (let s = 0; s < STACK_COUNT; s++) {
        plates[s].count = 0;
        KINDS.forEach((kind, f) => {
            ingredients.push({
                stack: s,
                kind,
                floor: f,
                left: STACK_LEFT[s],
                right: STACK_LEFT[s] + ING_W,
                y: ingredientRestY(f, 0),
                steps: [false, false, false, false],
                falling: false,
                onPlate: false,
                chain: 1,
                targetFloor: f,
            });
        });
    }
}

function resetChef() {
    chef.x = ladderX(START_COL);
    chef.floor = START_FLOOR;
    chef.y = FLOOR_Y[START_FLOOR];
    chef.mode = 'floor';
    chef.facing = 1;
    chef.ladder = null;
    chef.ride = null;
    refreshDir();
}

// Test seam: put the chef somewhere specific without having to walk there.
function placeChef(x, floor) {
    chef.x = clamp(x, CHEF_HW, CANVAS_W - CHEF_HW);
    chef.floor = floor;
    chef.y = FLOOR_Y[floor];
    chef.mode = 'floor';
    chef.ladder = null;
    chef.ride = null;
    chef.dir.x = 0;
    chef.dir.y = 0;
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    peppers = PEPPER_START;
    enemies.length = 0;
    clouds.length = 0;
    resetIngredients();
    resetChef();
    spawnTimer = FIRST_SPAWN;
    spawnIndex = 0;
    typeIndex = 0;
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level++;
    peppers = PEPPER_START;
    enemies.length = 0;
    clouds.length = 0;
    resetIngredients();
    resetChef();
    spawnTimer = FIRST_SPAWN;
    state = 'running';
    updateHud();
}

function respawn() {
    enemies.length = 0;
    clouds.length = 0;
    for (const ing of ingredients) {
        if (!ing.onPlate && !ing.falling) ing.steps = [false, false, false, false];
    }
    resetChef();
    spawnTimer = spawnInterval();
    state = 'running';
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space or Enter to play again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function updateChef(dt) {
    if (chef.mode === 'riding') return; // carried by an ingredient

    if (chef.mode === 'floor') {
        if (chef.dir.y !== 0) {
            const l = findLadderNear(chef.x, chef.floor, chef.dir.y);
            if (l) {
                chef.mode = 'ladder';
                chef.ladder = l;
                chef.x = ladderX(l.col);
            }
        }
        if (chef.mode === 'floor') {
            if (chef.dir.x !== 0) {
                chef.x = clamp(chef.x + chef.dir.x * CHEF_SPEED * dt, CHEF_HW, CANVAS_W - CHEF_HW);
            }
            chef.y = FLOOR_Y[chef.floor];
            return;
        }
    }

    // Climbing. Movement is continuous: the chef rides the ladder through
    // intermediate floors and only stops at the end of the ladder's span, or
    // when the player lets go next to a floor line.
    const dy = chef.dir.y;
    if (dy === 0) {
        const f = nearestFloorIndex(chef.y);
        if (Math.abs(chef.y - FLOOR_Y[f]) <= SNAP_EPS) {
            chef.y = FLOOR_Y[f];
            chef.floor = f;
            chef.mode = 'floor';
        }
        return;
    }

    let remaining = CLIMB_SPEED * dt;
    while (remaining > 0) {
        const f = nextFloorIndex(chef.y, dy);
        if (f === -1) {
            // No floor line left in this direction: we are at the end of the
            // shaft, so settle onto the floor we are standing at.
            const n = nearestFloorIndex(chef.y);
            chef.y = FLOOR_Y[n];
            chef.floor = n;
            chef.mode = 'floor';
            return;
        }
        const dist = Math.abs(FLOOR_Y[f] - chef.y);
        // The 1e-9 slack keeps a sub-nanometre residual from wedging the chef
        // just short of a floor line, where the next iteration would find no
        // floor ahead of it.
        if (remaining < dist - 1e-9) {
            chef.y += dy * remaining;
            remaining = 0;
        } else {
            chef.y = FLOOR_Y[f];
            chef.floor = f;
            remaining -= dist;
            if (!ladderSpans(chef.ladder, f, dy)) {
                chef.mode = 'floor';
                return;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

function startFall(ing, chain, allowRide) {
    ing.falling = true;
    ing.chain = chain;
    ing.steps = [false, false, false, false];
    ing.targetFloor = ing.floor + 1;
    if (allowRide && chef.mode === 'floor' && chef.floor === ing.floor &&
        chef.x >= ing.left - CHEF_HW && chef.x <= ing.right + CHEF_HW) {
        chef.mode = 'riding';
        chef.ride = ing;
        chef.dir.x = 0;
        chef.dir.y = 0;
    }
}

function releaseRider(ing) {
    if (chef.ride !== ing) return;
    chef.ride = null;
    chef.mode = 'floor';
    chef.floor = ing.floor;
    chef.y = FLOOR_Y[ing.floor];
    chef.ladder = null;
    refreshDir();
}

function crushEnemiesUnder(ing) {
    for (const e of enemies) {
        if (e.state === 'crushed') continue;
        if (e.x < ing.left - ENEMY_HW || e.x > ing.right + ENEMY_HW) continue;
        if (Math.abs(e.y - ing.y) > 20) continue;
        e.state = 'crushed';
        e.crushTimer = CRUSH_LINGER;
        score += SQUASH_POINTS * ing.chain;
    }
}

function tripIngredients() {
    if (chef.mode !== 'floor') return;
    for (const ing of ingredients) {
        if (ing.onPlate || ing.falling || ing.floor !== chef.floor) continue;
        const idx = Math.floor((chef.x - ing.left) / TILE_W);
        if (idx < 0 || idx >= ING_TILES) continue;
        if (ing.steps[idx]) continue;
        ing.steps[idx] = true;
        if (ing.steps.every(Boolean)) startFall(ing, 1, true);
    }
}

function advanceFall(ing, dt) {
    ing.y += FALL_SPEED * dt;
    crushEnemiesUnder(ing);

    let guard = 0;
    while (ing.falling && guard++ < FLOOR_COUNT) {
        const target = ingredientRestY(ing.targetFloor, plates[ing.stack].count);
        if (ing.y < target) break;
        ing.y = target;
        ing.floor = ing.targetFloor;

        if (ing.floor === PLATE_FLOOR) {
            ing.falling = false;
            ing.onPlate = true;
            plates[ing.stack].count++;
            score += DROP_POINTS * ing.chain;
            crushEnemiesUnder(ing);
            releaseRider(ing);
            break;
        }

        const below = ingredients.find((o) =>
            o !== ing && o.stack === ing.stack && !o.onPlate && !o.falling && o.floor === ing.floor);
        if (below) {
            ing.chain++;
            startFall(below, ing.chain, false);
            ing.targetFloor = ing.floor + 1;
        } else {
            ing.falling = false;
            score += DROP_POINTS * ing.chain;
            crushEnemiesUnder(ing);
            releaseRider(ing);
            break;
        }
    }

    if (chef.ride === ing) chef.y = ing.y - ING_THICK / 2;
}

function updateIngredients(dt) {
    tripIngredients();
    for (const ing of ingredients) {
        if (ing.falling) advanceFall(ing, dt);
    }
}

function ingredientsOnPlates() {
    return ingredients.filter((i) => i.onPlate).length;
}

// Test seam: drop every ingredient straight onto its plate without scoring, so
// the level-flow specs do not have to play a whole level.
function plateEverythingForTest() {
    for (let s = 0; s < STACK_COUNT; s++) {
        plates[s].count = 0;
        for (const ing of ingredients.filter((i) => i.stack === s)) {
            ing.falling = false;
            ing.onPlate = true;
            ing.floor = PLATE_FLOOR;
            ing.steps = [false, false, false, false];
            ing.y = ingredientRestY(PLATE_FLOOR, plates[s].count);
            plates[s].count++;
        }
    }
    if (chef.mode === 'riding') {
        chef.ride = null;
        chef.mode = 'floor';
        chef.y = FLOOR_Y[chef.floor];
    }
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

function spawnEnemy(type, x, floor) {
    const e = {
        type,
        x,
        y: FLOOR_Y[floor],
        floor,
        mode: 'floor',
        dir: { x: 0, y: 0 },
        state: 'active',
        stunTimer: 0,
        crushTimer: 0,
        targetFloor: floor,
        bias: enemies.length % 2 === 0 ? 1 : -1,
        wobble: enemies.length * 0.7,
        frozen: false, // test seam: hold a monster still
    };
    enemies.push(e);
    return e;
}

function updateSpawning(dt) {
    if (!spawnEnabled) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval();
    if (enemies.filter((e) => e.state !== 'crushed').length >= maxEnemies()) return;
    const pts = spawnPoints();
    const p = pts[spawnIndex % pts.length];
    spawnIndex++;
    spawnEnemy(ENEMY_TYPES[typeIndex++ % ENEMY_TYPES.length], p.x, p.floor);
}

function updateEnemy(e, dt) {
    if (e.state === 'crushed') { e.crushTimer -= dt; return; }
    if (e.state === 'stunned') {
        e.stunTimer -= dt;
        if (e.stunTimer <= 0) e.state = 'active';
        return;
    }
    if (e.frozen) return;

    const sp = enemySpeed();
    e.wobble += dt * 6;

    if (e.mode === 'ladder') {
        e.y += e.dir.y * sp * dt;
        const tf = e.targetFloor;
        if ((e.dir.y < 0 && e.y <= FLOOR_Y[tf]) || (e.dir.y > 0 && e.y >= FLOOR_Y[tf])) {
            e.y = FLOOR_Y[tf];
            e.floor = tf;
            e.mode = 'floor';
            e.dir.y = 0;
        }
        return;
    }

    // On a floor: head for the chef if we share a floor, otherwise head for the
    // nearest ladder that leads toward the chef's floor.
    if (e.floor === chef.floor) {
        e.dir.x = Math.sign(chef.x - e.x) || e.bias;
    } else {
        const need = chef.floor > e.floor ? 1 : -1;
        const l = nearestLadder(e.x, e.floor, need);
        if (l) {
            const lx = ladderX(l.col);
            if (Math.abs(lx - e.x) <= SNAP) {
                e.x = lx;
                e.mode = 'ladder';
                e.dir.x = 0;
                e.dir.y = need;
                e.targetFloor = e.floor + need;
                return;
            }
            e.dir.x = Math.sign(lx - e.x);
        } else {
            e.dir.x = Math.sign(chef.x - e.x) || e.bias;
        }
    }
    e.x = clamp(e.x + e.dir.x * sp * dt, ENEMY_HW, CANVAS_W - ENEMY_HW);
    e.y = FLOOR_Y[e.floor];
}

function updateEnemies(dt) {
    for (const e of enemies) updateEnemy(e, dt);
    for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i].state === 'crushed' && enemies[i].crushTimer <= 0) enemies.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function spray() {
    if (state !== 'running' || chef.mode === 'riding' || peppers <= 0) return;
    peppers--;
    const cx = chef.x + chef.facing * CLOUD_OFFSET;
    clouds.push({ x: cx, y: chef.y - CHEF_H / 2, life: CLOUD_LIFE });
    for (const e of enemies) {
        if (e.state !== 'active') continue;
        if (Math.abs(e.x - cx) > CLOUD_HW + ENEMY_HW) continue;
        if (Math.abs(e.y - chef.y) > 24) continue;
        e.state = 'stunned';
        e.stunTimer = STUN_TIME;
        e.dir.x = 0;
        e.dir.y = 0;
    }
    updateHud();
}

function updateClouds(dt) {
    for (let i = clouds.length - 1; i >= 0; i--) {
        clouds[i].life -= dt;
        if (clouds[i].life <= 0) clouds.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Collisions / flow
// ---------------------------------------------------------------------------

function loseLife() {
    lives--;
    state = 'dying';
    deathTimer = DEATH_PAUSE;
    chef.dir.x = 0;
    chef.dir.y = 0;
    updateHud();
}

function detectHit() {
    if (chef.mode === 'riding') return;
    for (const e of enemies) {
        if (e.state !== 'active') continue;
        if (Math.abs(e.x - chef.x) < 15 && Math.abs(e.y - chef.y) < 18) {
            loseLife();
            return;
        }
    }
}

function checkLevelClear() {
    if (ingredientsOnPlates() < TOTAL_INGREDIENTS) return;
    state = 'levelclear';
    clearTimer = CLEAR_PAUSE;
    chef.dir.x = 0;
    chef.dir.y = 0;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) {
            if (lives <= 0) gameOver();
            else respawn();
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
    updateIngredients(dt);
    updateEnemies(dt);
    updateClouds(dt);
    updateSpawning(dt);
    detectHit();
    if (state === 'running') checkLevelClear();
    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawGirders() {
    for (let f = 0; f < FLOOR_COUNT; f++) {
        const y = FLOOR_Y[f];
        ctx.fillStyle = '#4b7ea8';
        ctx.fillRect(0, y, CANVAS_W, GIRDER_H);
        ctx.fillStyle = '#2f5878';
        for (let x = 0; x < CANVAS_W; x += 8) ctx.fillRect(x, y + GIRDER_H - 2, 4, 2);
    }
}

function drawLadders() {
    for (const l of LADDERS) {
        const cx = ladderX(l.col);
        const top = FLOOR_Y[l.from];
        const bottom = FLOOR_Y[l.to];
        ctx.strokeStyle = '#8fb6d1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 8, top);
        ctx.lineTo(cx - 8, bottom);
        ctx.moveTo(cx + 8, top);
        ctx.lineTo(cx + 8, bottom);
        ctx.stroke();
        ctx.strokeStyle = '#5d8aab';
        ctx.beginPath();
        for (let y = top + 8; y < bottom; y += 12) {
            ctx.moveTo(cx - 8, y);
            ctx.lineTo(cx + 8, y);
        }
        ctx.stroke();
    }
}

function drawPlates() {
    for (let s = 0; s < STACK_COUNT; s++) {
        const cx = STACK_LEFT[s] + ING_W / 2;
        const y = FLOOR_Y[PLATE_FLOOR] + GIRDER_H + 1;
        ctx.fillStyle = '#e7e2d6';
        ctx.beginPath();
        ctx.ellipse(cx, y, ING_W / 2 + 6, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b9b3a4';
        ctx.beginPath();
        ctx.ellipse(cx, y + 3, ING_W / 2 + 6, 5, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawIngredient(ing) {
    const color = KIND_COLOR[ing.kind];
    for (let i = 0; i < ING_TILES; i++) {
        const x = ing.left + i * TILE_W;
        const pressed = !ing.falling && !ing.onPlate && ing.steps[i];
        const y = ing.y - ING_THICK / 2 + (pressed ? 4 : 0);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, TILE_W, ING_THICK);
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(x, y, TILE_W, 3);
        if (ing.kind === 'lettuce') {
            ctx.fillStyle = '#8fd96a';
            for (let k = 0; k < 3; k++) ctx.fillRect(x + 3 + k * 8, y - 2, 6, 3);
        }
        if (ing.kind === 'buntop') {
            ctx.fillStyle = '#fff3d0';
            for (let k = 0; k < 3; k++) ctx.fillRect(x + 5 + k * 8, y + 2, 2, 2);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, TILE_W - 1, ING_THICK - 1);
    }
}

function drawChef() {
    const x = chef.x, y = chef.y;
    const bob = chef.mode === 'ladder' ? Math.sin(y / 6) * 1.5 : 0;
    // legs
    ctx.fillStyle = '#2c3550';
    ctx.fillRect(x - 7, y - 9, 5, 9);
    ctx.fillRect(x + 2, y - 9, 5, 9);
    // apron / body
    ctx.fillStyle = '#f4f1e8';
    ctx.fillRect(x - CHEF_HW, y - 21 + bob, CHEF_HW * 2, 13);
    ctx.fillStyle = '#e04a3c';
    ctx.fillRect(x - CHEF_HW, y - 21 + bob, CHEF_HW * 2, 3);
    // head
    ctx.fillStyle = '#f0c9a0';
    ctx.fillRect(x - 6, y - 27 + bob, 12, 7);
    // hat
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 8, y - 32 + bob, 16, 5);
    // eye
    ctx.fillStyle = '#22201c';
    ctx.fillRect(x + (chef.facing > 0 ? 2 : -4), y - 25 + bob, 2, 2);
}

function drawEnemy(e) {
    const color = ENEMY_COLOR[e.type];
    if (e.state === 'crushed') {
        ctx.fillStyle = color;
        ctx.fillRect(e.x - ENEMY_HW - 3, e.y - 5, (ENEMY_HW + 3) * 2, 5);
        return;
    }
    const bob = e.state === 'stunned' ? 0 : Math.sin(e.wobble) * 1.5;
    ctx.fillStyle = color;
    ctx.fillRect(e.x - ENEMY_HW, e.y - ENEMY_H + bob, ENEMY_HW * 2, ENEMY_H);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(e.x - ENEMY_HW, e.y - 5 + bob, ENEMY_HW * 2, 5);
    // eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(e.x - 7, e.y - ENEMY_H + 5 + bob, 5, 5);
    ctx.fillRect(e.x + 2, e.y - ENEMY_H + 5 + bob, 5, 5);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(e.x - 6, e.y - ENEMY_H + 7 + bob, 2, 2);
    ctx.fillRect(e.x + 3, e.y - ENEMY_H + 7 + bob, 2, 2);
    if (e.state === 'stunned') {
        ctx.fillStyle = '#f5b942';
        for (let i = 0; i < 4; i++) {
            const a = e.wobble + (i * Math.PI) / 2;
            ctx.fillRect(e.x + Math.cos(a) * 15 - 1, e.y - ENEMY_H - 6 + Math.sin(a) * 5, 3, 3);
        }
    }
}

function drawClouds() {
    for (const c of clouds) {
        const a = Math.max(0, c.life / CLOUD_LIFE);
        ctx.fillStyle = `rgba(240, 230, 210, ${0.75 * a})`;
        for (let i = 0; i < 10; i++) {
            const ang = (i / 10) * Math.PI * 2 + c.life * 8;
            const r = 6 + (i % 3) * 6;
            ctx.fillRect(c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r * 0.7, 3, 3);
        }
    }
}

function drawBanner(text, sub) {
    ctx.fillStyle = 'rgba(11, 7, 5, 0.6)';
    ctx.fillRect(0, CANVAS_H / 2 - 46, CANVAS_W, 92);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f5b942';
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2 + 2);
    if (sub) {
        ctx.fillStyle = '#f3e7d8';
        ctx.font = '15px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(sub, CANVAS_W / 2, CANVAS_H / 2 + 28);
    }
    ctx.textAlign = 'start';
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#0b0705';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawGirders();
    drawLadders();
    drawPlates();
    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    drawClouds();
    drawChef();

    if (state === 'dying') drawBanner('OUCH!', `${lives} ${lives === 1 ? 'life' : 'lives'} left`);
    if (state === 'levelclear') drawBanner('BURGER UP!', `Level ${level} complete`);
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    pepperEl.textContent = String(peppers);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Game';
}

function hideOverlay() {
    overlay.classList.remove('visible');
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

function refreshDir() {
    const held = (keys) => keys.some((k) => heldKeys.has(k));
    const dx = (held(RIGHT_KEYS) ? 1 : 0) - (held(LEFT_KEYS) ? 1 : 0);
    const dy = (held(DOWN_KEYS) ? 1 : 0) - (held(UP_KEYS) ? 1 : 0);
    chef.dir.x = dx;
    chef.dir.y = dy;
    if (dx !== 0) chef.facing = dx;
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if (e.key === 'Enter') {
        if (state === 'paused') togglePause();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.code === 'Space') {
        if (state === 'running') spray();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshDir();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshDir();
    }
});

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
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
peppers = PEPPER_START;
spawnTimer = FIRST_SPAWN;
spawnIndex = 0;
typeIndex = 0;
resetIngredients();
resetChef();
updateHud();
showOverlay('BURGERTIME', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
