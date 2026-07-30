// ---------------------------------------------------------------------------
// Burger Time — a platform-and-ladder arcade game on an HTML5 canvas.
//
// The chef walks the girders of a diner kitchen. Walking the full width of a
// burger ingredient makes it drop one floor; drop every ingredient onto the
// plate at the bottom to build all four burgers and clear the level. Three
// walking snacks chase the chef around the lattice — a squirt of pepper freezes
// them, and an ingredient falling on one squashes it flat.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per-second and driven
// through `step(dt)`, so the tests can advance the simulation deterministically
// without depending on requestAnimationFrame wall-clock timing (see
// `setAutoRun`, which detaches the rAF driver, and `setSeed`, which pins the
// enemy AI's random tie-breaks).
// ---------------------------------------------------------------------------

// --- World geometry ---------------------------------------------------------
const TILE = 28;
const GRID_COLS = 17;
const GRID_ROWS = 15;
const CANVAS_W = TILE * GRID_COLS;   // 476
const CANVAS_H = TILE * GRID_ROWS;   // 420

// Walkable girders. FLOOR_Y[i] is the line the chef's feet sit on.
const FLOOR_ROWS = [1, 4, 7, 10, 13];
const FLOOR_Y = FLOOR_ROWS.map((r) => r * TILE);
const PLATE_FLOOR = FLOOR_Y.length - 1;   // the bottom girder holds the plates

// Ladder columns, evenly spaced across the kitchen.
const LADDER_COLS = [0, 4, 8, 12, 16];
const LADDER_X = LADDER_COLS.map((c) => c * TILE + TILE / 2);

// LADDER_SEGS[s] lists the ladder indices that connect floor s (above) to
// floor s+1 (below). Staggering them is what makes routing interesting.
const LADDER_SEGS = [
    [0, 2, 4],
    [1, 3, 4],
    [0, 2, 4],
    [1, 2, 3],
];

// --- Burgers ----------------------------------------------------------------
const STACK_COLS = [1, 5, 9, 13];
const STACK_X = STACK_COLS.map((c) => c * TILE);
const ITEM_TILES = 4;
const ITEM_W = ITEM_TILES * TILE;    // 112
const ITEM_H = 10;
const INGREDIENTS_PER_BURGER = 4;
const ITEM_KINDS = ['bunTop', 'lettuce', 'patty', 'bunBottom'];
const FALL_SPEED = 300;

// --- Chef -------------------------------------------------------------------
const CHEF_W = 14;
const CHEF_H = 22;
const CHEF_SPEED = 82;
const CLIMB_SPEED = 70;
const START_LADDER = 2;
const START_FLOOR = 4;
const MIN_X = CHEF_W / 2;
const MAX_X = CANVAS_W - CHEF_W / 2;

// --- Enemies ----------------------------------------------------------------
const ENEMY_W = 16;
const ENEMY_H = 20;
const ENEMY_BASE_SPEED = 42;
const ENEMY_LEVEL_SPEED = 5;
const ENEMY_TURN_CHANCE = 0.15;      // odds of ignoring the greedy chase
const RESPAWN_TIME = 4;
const ENEMY_KINDS = ['hotdog', 'egg', 'pickle'];
// Spawn nodes as [ladderIndex, floorIndex], well away from the chef's corner.
const SPAWN_NODES = [[0, 4], [4, 4], [4, 0], [0, 0], [2, 0]];

// --- Pepper -----------------------------------------------------------------
const PEPPER_START = 5;
const PEPPER_W = TILE * 1.5;
const PEPPER_LIFE = 0.35;
const STUN_TIME = 4;

// --- Scoring ----------------------------------------------------------------
const DROP_SCORE = 50;
const SQUASH_SCORE = 100;
const BURGER_BONUS = 250;
const LEVEL_BONUS = 1000;
const START_LIVES = 3;
const BEST_KEY = 'burgertime-best';

// --- DOM --------------------------------------------------------------------
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

// --- State ------------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, level, lives, pepper, burgersDone, levelCleared;
let autoRun = true;
const chef = { x: 0, y: 0, dx: 0, dy: 0, face: 1, walk: 0 };
const ingredients = [];
const plateCount = [0, 0, 0, 0];
const enemies = [];
const peppers = [];
const sparks = [];

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) — tests pin it with setSeed().
// ---------------------------------------------------------------------------
let rngState = 0x9e3779b9;

function setSeed(seed) {
    rngState = seed >>> 0;
}

function rnd() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Lattice helpers
//
// The kitchen is a small graph: a node sits at every ladder/girder crossing.
// Enemies walk node to node; the chef moves freely along the same lines.
// ---------------------------------------------------------------------------
const NODE_COLS = LADDER_X.length;
const NODE_COUNT = NODE_COLS * FLOOR_Y.length;

const nodeIndex = (li, fi) => fi * NODE_COLS + li;
const nodeLadder = (n) => n % NODE_COLS;
const nodeFloor = (n) => Math.floor(n / NODE_COLS);
const nodeX = (n) => LADDER_X[nodeLadder(n)];
const nodeY = (n) => FLOOR_Y[nodeFloor(n)];

function neighbors(n) {
    const li = nodeLadder(n);
    const fi = nodeFloor(n);
    const out = [];
    if (li > 0) out.push(n - 1);
    if (li < NODE_COLS - 1) out.push(n + 1);
    if (fi > 0 && LADDER_SEGS[fi - 1].includes(li)) out.push(n - NODE_COLS);
    if (fi < FLOOR_Y.length - 1 && LADDER_SEGS[fi].includes(li)) out.push(n + NODE_COLS);
    return out;
}

function floorIndexAt(y) {
    for (let i = 0; i < FLOOR_Y.length; i++) {
        if (Math.abs(y - FLOOR_Y[i]) < 1e-6) return i;
    }
    return -1;
}

function segmentAt(y) {
    for (let s = 0; s < FLOOR_Y.length - 1; s++) {
        if (y > FLOOR_Y[s] && y < FLOOR_Y[s + 1]) return s;
    }
    return -1;
}

function ladderIndexNear(x) {
    for (let i = 0; i < LADDER_X.length; i++) {
        if (Math.abs(x - LADDER_X[i]) <= TILE / 2) return i;
    }
    return -1;
}

function nearestNode(x, y) {
    let bestNode = 0;
    let bestDist = Infinity;
    for (let n = 0; n < NODE_COUNT; n++) {
        const d = Math.abs(x - nodeX(n)) + Math.abs(y - nodeY(n));
        if (d < bestDist) {
            bestDist = d;
            bestNode = n;
        }
    }
    return bestNode;
}

// Breadth-first hop counts from `from` to every node — the enemies' chase map.
function distancesFrom(from) {
    const dist = new Array(NODE_COUNT).fill(Infinity);
    dist[from] = 0;
    const queue = [from];
    for (let head = 0; head < queue.length; head++) {
        const n = queue[head];
        for (const m of neighbors(n)) {
            if (dist[m] === Infinity) {
                dist[m] = dist[n] + 1;
                queue.push(m);
            }
        }
    }
    return dist;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

const chefRect = () => ({ x: chef.x - CHEF_W / 2, y: chef.y - CHEF_H, w: CHEF_W, h: CHEF_H });
const enemyRect = (e) => ({ x: e.x - ENEMY_W / 2, y: e.y - ENEMY_H, w: ENEMY_W, h: ENEMY_H });
const ingredientRect = (i) => ({ x: i.x, y: i.y, w: ITEM_W, h: ITEM_H });

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------
function restY(stack, floor) {
    if (floor === PLATE_FLOOR) {
        return FLOOR_Y[PLATE_FLOOR] - ITEM_H - plateCount[stack] * ITEM_H;
    }
    return FLOOR_Y[floor] - ITEM_H;
}

function buildLevel() {
    ingredients.length = 0;
    for (let stack = 0; stack < STACK_X.length; stack++) {
        plateCount[stack] = 0;
        for (let k = 0; k < INGREDIENTS_PER_BURGER; k++) {
            ingredients.push({
                stack,
                kind: ITEM_KINDS[k],
                floor: k,                       // top bun highest, bottom bun lowest
                x: STACK_X[stack],
                y: FLOOR_Y[k] - ITEM_H,
                tiles: [false, false, false, false],
                falling: false,
            });
        }
    }
    burgersDone = 0;
    levelCleared = false;
}

function enemyCount() {
    return Math.min(2 + (level - 1), 5);
}

function enemySpeed() {
    return ENEMY_BASE_SPEED + (level - 1) * ENEMY_LEVEL_SPEED;
}

function sitEnemyAt(e, node) {
    e.from = node;
    e.prev = node;
    e.t = 0;
    e.x = nodeX(node);
    e.y = nodeY(node);
    e.to = chooseNext(e);
}

function spawnEnemies() {
    enemies.length = 0;
    for (let i = 0; i < enemyCount(); i++) {
        const [li, fi] = SPAWN_NODES[i % SPAWN_NODES.length];
        const e = {
            kind: ENEMY_KINDS[i % ENEMY_KINDS.length],
            spawn: nodeIndex(li, fi),
            stun: 0,
            squashed: false,
            respawn: 0,
            wobble: i * 0.7,
        };
        sitEnemyAt(e, e.spawn);
        enemies.push(e);
    }
}

function resetChef() {
    chef.x = LADDER_X[START_LADDER];
    chef.y = FLOOR_Y[START_FLOOR];
    chef.dx = 0;
    chef.dy = 0;
    chef.face = 1;
    chef.walk = 0;
}

function resetActors() {
    resetChef();
    for (const e of enemies) {
        e.squashed = false;
        e.stun = 0;
        e.respawn = 0;
        sitEnemyAt(e, e.spawn);
    }
    peppers.length = 0;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    pepper = PEPPER_START;
    buildLevel();
    spawnEnemies();
    resetChef();
    peppers.length = 0;
    sparks.length = 0;
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    score += LEVEL_BONUS;
    pepper = Math.min(pepper + 1, 9);
    buildLevel();
    spawnEnemies();
    resetChef();
    peppers.length = 0;
    updateHud();
}

function loseLife() {
    lives -= 1;
    burst(chef.x, chef.y - CHEF_H / 2, '#ff6b4a', 16);
    if (lives <= 0) {
        gameOver();
    } else {
        resetActors();
    }
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* private browsing — best score just won't persist */
        }
    }
    showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space to play again');
    updateHud();
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

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------
function setChefDir(dx, dy) {
    chef.dx = Math.sign(dx);
    chef.dy = Math.sign(dy);
    if (chef.dx !== 0) chef.face = chef.dx;
}

function setChefPos(x, y) {
    chef.x = x;
    chef.y = y;
}

function setChefFace(face) {
    chef.face = face < 0 ? -1 : 1;
}

function moveChef(dt) {
    const onFloor = floorIndexAt(chef.y);

    if (chef.dy !== 0) {
        // Which ladder segment would this move use? Up from floor f is the
        // segment above it (f - 1); down from floor f is the segment below (f).
        let seg = -1;
        let li = -1;
        if (onFloor >= 0) {
            li = ladderIndexNear(chef.x);
            const candidate = chef.dy < 0 ? onFloor - 1 : onFloor;
            if (li >= 0 && candidate >= 0 && candidate < LADDER_SEGS.length &&
                LADDER_SEGS[candidate].includes(li)) {
                seg = candidate;
            }
        } else {
            seg = segmentAt(chef.y);
            li = ladderIndexNear(chef.x);
        }
        if (seg >= 0) {
            if (li >= 0) chef.x = LADDER_X[li];
            chef.y = clamp(chef.y + chef.dy * CLIMB_SPEED * dt, FLOOR_Y[seg], FLOOR_Y[seg + 1]);
            chef.walk += CLIMB_SPEED * dt;
            return;
        }
    }

    // Mid-ladder with no vertical input: the chef hangs on, no side-stepping.
    if (onFloor < 0) return;

    if (chef.dx !== 0) {
        chef.x = clamp(chef.x + chef.dx * CHEF_SPEED * dt, MIN_X, MAX_X);
        chef.walk += CHEF_SPEED * dt;
    }
}

// Walking the length of an ingredient stamps each of its four tiles; once all
// four are stamped it drops.
function treadIngredients() {
    const f = floorIndexAt(chef.y);
    if (f < 0) return;
    for (const ing of ingredients) {
        if (ing.falling || ing.floor !== f) continue;
        if (chef.x < ing.x || chef.x > ing.x + ITEM_W) continue;
        const j = clamp(Math.floor((chef.x - ing.x) / TILE), 0, ITEM_TILES - 1);
        ing.tiles[j] = true;
        if (ing.tiles.every(Boolean)) dropIngredient(ing);
    }
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------
function dropIngredient(ing) {
    if (!ing || ing.falling) return false;
    if (!ingredients.includes(ing)) return false;      // stale reference
    if (ing.floor >= PLATE_FLOOR) return false;
    ing.falling = true;
    score += DROP_SCORE;
    updateHud();
    return true;
}

function landIngredient(ing, floor) {
    ing.y = restY(ing.stack, floor);
    ing.floor = floor;
    ing.falling = false;
    ing.tiles = [false, false, false, false];

    if (floor === PLATE_FLOOR) {
        plateCount[ing.stack] += 1;
        burst(ing.x + ITEM_W / 2, ing.y, '#ffd07a', 8);
        if (plateCount[ing.stack] === INGREDIENTS_PER_BURGER) {
            burgersDone += 1;
            score += BURGER_BONUS;
            if (burgersDone === STACK_X.length) levelCleared = true;
        }
        return;
    }

    // Anything already resting here gets knocked down a floor as well.
    const resting = ingredients.find(
        (o) => o !== ing && o.stack === ing.stack && o.floor === floor && !o.falling);
    if (resting) dropIngredient(resting);
}

function updateIngredients(dt) {
    for (const ing of ingredients.slice()) {
        if (!ing.falling) continue;
        ing.y += FALL_SPEED * dt;

        const rect = ingredientRect(ing);
        for (const e of enemies) {
            if (!e.squashed && rectsOverlap(rect, enemyRect(e))) squashEnemy(e);
        }

        const target = ing.floor + 1;
        if (target > PLATE_FLOOR) {
            ing.falling = false;
            continue;
        }
        if (ing.y >= restY(ing.stack, target)) landIngredient(ing, target);
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------
function chooseNext(e) {
    const options = neighbors(e.from);
    if (options.length === 0) return e.from;
    const forward = options.filter((n) => n !== e.prev);
    const pool = forward.length > 0 ? forward : options;

    if (rnd() < ENEMY_TURN_CHANCE) return pool[Math.floor(rnd() * pool.length)];

    const dist = distancesFrom(nearestNode(chef.x, chef.y));
    let bestNode = pool[0];
    let bestDist = Infinity;
    for (const n of pool) {
        const d = dist[n];
        if (d < bestDist) {
            bestDist = d;
            bestNode = n;
        }
    }
    return bestNode;
}

function placeEnemy(e, x, y) {
    e.x = x;
    e.y = y;
    const n = nearestNode(x, y);
    e.from = n;
    e.to = n;
    e.prev = n;
    e.t = 0;
}

function squashEnemy(e) {
    if (e.squashed) return;
    e.squashed = true;
    e.stun = 0;
    e.respawn = RESPAWN_TIME;
    score += SQUASH_SCORE;
    burst(e.x, e.y - ENEMY_H / 2, '#8ce99a', 12);
    updateHud();
}

function advanceEnemy(e, dt) {
    const ax = nodeX(e.from);
    const ay = nodeY(e.from);
    const bx = nodeX(e.to);
    const by = nodeY(e.to);
    const len = Math.hypot(bx - ax, by - ay);

    if (len < 1e-6) {
        e.prev = e.from;
        e.to = chooseNext(e);
        e.t = 0;
        return;
    }

    e.t += (enemySpeed() * dt) / len;
    if (e.t >= 1) {
        e.prev = e.from;
        e.from = e.to;
        e.to = chooseNext(e);
        e.t = 0;
        e.x = nodeX(e.from);
        e.y = nodeY(e.from);
        return;
    }
    e.x = ax + (bx - ax) * e.t;
    e.y = ay + (by - ay) * e.t;
}

function updateEnemies(dt) {
    for (const e of enemies) {
        e.wobble += dt;
        if (e.squashed) {
            e.respawn -= dt;
            if (e.respawn <= 0) {
                e.squashed = false;
                sitEnemyAt(e, e.spawn);
            }
            continue;
        }
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - dt);
            continue;
        }
        advanceEnemy(e, dt);
    }
}

function checkChefCaught() {
    const cr = chefRect();
    for (const e of enemies) {
        if (e.squashed || e.stun > 0) continue;
        if (rectsOverlap(cr, enemyRect(e))) {
            loseLife();
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------
function firePepper() {
    if (state !== 'running' || pepper <= 0) return false;
    pepper -= 1;
    const x = chef.face > 0 ? chef.x + CHEF_W / 2 - 1 : chef.x - CHEF_W / 2 + 1 - PEPPER_W;
    peppers.push({ x, y: chef.y - CHEF_H, w: PEPPER_W, h: CHEF_H, life: PEPPER_LIFE });
    updateHud();
    return true;
}

function updatePeppers(dt) {
    for (let i = peppers.length - 1; i >= 0; i--) {
        const p = peppers[i];
        p.life -= dt;
        for (const e of enemies) {
            if (!e.squashed && rectsOverlap(p, enemyRect(e))) e.stun = STUN_TIME;
        }
        if (p.life <= 0) peppers.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Cosmetic sparks
// ---------------------------------------------------------------------------
function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        sparks.push({
            x, y, color,
            vx: Math.cos(a) * (40 + rnd() * 60),
            vy: Math.sin(a) * (40 + rnd() * 60) - 40,
            life: 0.5,
        });
    }
}

function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 320 * dt;
        s.life -= dt;
        if (s.life <= 0) sparks.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function step(dt) {
    if (state !== 'running') return;
    moveChef(dt);
    treadIngredients();
    updateIngredients(dt);
    updateEnemies(dt);
    updatePeppers(dt);
    if (state === 'running') checkChefCaught();
    if (levelCleared && state === 'running') {
        levelCleared = false;
        nextLevel();
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const ITEM_COLORS = {
    bunTop: ['#f3b263', '#c9812f', '#ffd9a0'],
    lettuce: ['#84cc4a', '#4c8527', '#b6e77c'],
    patty: ['#96562f', '#5f331a', '#b8734a'],
    bunBottom: ['#e79f4d', '#b06c26', '#ffcd92'],
};

function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#1d1524');
    g.addColorStop(1, '#0b090c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Faint kitchen tiling behind the girders.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 1;
    for (let x = TILE; x < CANVAS_W; x += TILE * 2) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CANVAS_H);
        ctx.stroke();
    }
    for (let y = TILE; y < CANVAS_H; y += TILE * 2) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(CANVAS_W, y + 0.5);
        ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
    for (let y = 0; y < CANVAS_H; y += 4) ctx.fillRect(0, y, CANVAS_W, 1);
}

// One slice of an ingredient. Outer slices get a rounded end so a full
// ingredient reads as a single lozenge even though each quarter can sag
// independently once the chef has trodden on it.
function tilePath(x, y, w, h, roundLeft, roundRight) {
    const r = Math.min(5, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + (roundLeft ? r : 0), y);
    ctx.lineTo(x + w - (roundRight ? r : 0), y);
    if (roundRight) ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    else ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - (roundRight ? r : 0));
    if (roundRight) ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    else ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + (roundLeft ? r : 0), y + h);
    if (roundLeft) ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    else ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + (roundLeft ? r : 0));
    if (roundLeft) ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawLadders() {
    for (let s = 0; s < LADDER_SEGS.length; s++) {
        const top = FLOOR_Y[s];
        const bottom = FLOOR_Y[s + 1];
        for (const li of LADDER_SEGS[s]) {
            const x = LADDER_X[li];
            ctx.strokeStyle = '#5c6b8a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 8, top);
            ctx.lineTo(x - 8, bottom);
            ctx.moveTo(x + 8, top);
            ctx.lineTo(x + 8, bottom);
            ctx.stroke();
            ctx.strokeStyle = '#8898b8';
            ctx.lineWidth = 2;
            for (let y = top + 7; y < bottom; y += 9) {
                ctx.beginPath();
                ctx.moveTo(x - 8, y);
                ctx.lineTo(x + 8, y);
                ctx.stroke();
            }
        }
    }
}

function drawFloors() {
    for (const y of FLOOR_Y) {
        ctx.fillStyle = '#3f4d63';
        ctx.fillRect(0, y, CANVAS_W, 4);
        ctx.fillStyle = '#6f82a3';
        ctx.fillRect(0, y, CANVAS_W, 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        for (let x = 0; x < CANVAS_W; x += TILE) ctx.fillRect(x, y, 1, 4);
    }
}

function drawPlates() {
    for (let k = 0; k < STACK_X.length; k++) {
        const cx = STACK_X[k] + ITEM_W / 2;
        const cy = FLOOR_Y[PLATE_FLOOR] + 5;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 4, ITEM_W / 2 - 2, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e2e2ee';
        ctx.beginPath();
        ctx.ellipse(cx, cy, ITEM_W / 2 - 2, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b4b4c8';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 1, ITEM_W / 2 - 12, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        // A tick per plated layer so progress is readable at a glance.
        ctx.fillStyle = plateCount[k] === INGREDIENTS_PER_BURGER ? '#ffd07a' : '#6f7390';
        for (let i = 0; i < INGREDIENTS_PER_BURGER; i++) {
            ctx.globalAlpha = i < plateCount[k] ? 1 : 0.35;
            ctx.fillRect(cx - 15 + i * 8, cy + 8, 5, 2);
        }
        ctx.globalAlpha = 1;
    }
}

function drawIngredient(ing) {
    const [light, dark, highlight] = ITEM_COLORS[ing.kind];

    if (ing.falling) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(ing.x + 4, ing.y + ITEM_H + 2, ITEM_W - 8, 2);
    }

    for (let j = 0; j < ITEM_TILES; j++) {
        const x = ing.x + j * TILE;
        const y = ing.y + (ing.tiles[j] && !ing.falling ? 4 : 0);

        tilePath(x, y, TILE, ITEM_H, j === 0, j === ITEM_TILES - 1);
        ctx.fillStyle = dark;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Lit upper face.
        ctx.save();
        ctx.clip();
        ctx.fillStyle = light;
        ctx.fillRect(x, y, TILE, ITEM_H - 3);

        if (ing.kind === 'bunTop') {
            ctx.fillStyle = highlight;
            ctx.fillRect(x, y, TILE, 3);
            ctx.fillStyle = 'rgba(255, 248, 225, 0.95)';
            ctx.fillRect(x + 6, y + 3, 4, 2);
            ctx.fillRect(x + 17, y + 5, 4, 2);
        } else if (ing.kind === 'bunBottom') {
            ctx.fillStyle = highlight;
            ctx.fillRect(x, y, TILE, 2);
        } else if (ing.kind === 'lettuce') {
            ctx.fillStyle = highlight;
            for (let w = -2; w < TILE + 4; w += 8) {
                ctx.beginPath();
                ctx.arc(x + w, y + 2, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (ing.kind === 'patty') {
            ctx.fillStyle = highlight;
            ctx.fillRect(x + 4, y + 2, 7, 2);
            ctx.fillRect(x + 16, y + 5, 6, 2);
        }
        ctx.restore();
    }
}

function drawChef() {
    const x = chef.x;
    const y = chef.y;
    const bob = Math.sin(chef.walk / 7) * 1.5;
    const legSwing = Math.sin(chef.walk / 5) * 3;

    // legs
    ctx.strokeStyle = '#2c3e63';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 2, y - 7);
    ctx.lineTo(x - 2 - legSwing, y);
    ctx.moveTo(x + 2, y - 7);
    ctx.lineTo(x + 2 + legSwing, y);
    ctx.stroke();

    // body
    ctx.fillStyle = '#f4f4ef';
    ctx.fillRect(x - 6, y - 16 + bob, 12, 10);
    ctx.fillStyle = '#e8543f';
    ctx.fillRect(x - 6, y - 9 + bob, 12, 2);

    // head + hat
    ctx.fillStyle = '#f2c39a';
    ctx.fillRect(x - 5, y - 22 + bob, 10, 7);
    ctx.fillStyle = '#0f0d0e';
    ctx.fillRect(x + (chef.face > 0 ? 1 : -3), y - 20 + bob, 2, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 6, y - 26 + bob, 12, 4);
    ctx.beginPath();
    ctx.ellipse(x, y - 27 + bob, 6, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawEnemy(e) {
    const x = e.x;
    const y = e.y;

    if (e.squashed) {
        ctx.fillStyle = '#6b7280';
        ctx.fillRect(x - ENEMY_W / 2 - 2, y - 4, ENEMY_W + 4, 4);
        return;
    }

    const bob = Math.sin(e.wobble * 6) * 1.5;
    const top = y - ENEMY_H + bob;

    if (e.stun > 0) {
        ctx.fillStyle = 'rgba(180, 220, 255, 0.35)';
        ctx.fillRect(x - ENEMY_W / 2 - 3, top - 3, ENEMY_W + 6, ENEMY_H + 6);
    }

    const skins = {
        hotdog: ['#e8613c', '#f2a65a'],
        egg: ['#f7f3e8', '#ffd34d'],
        pickle: ['#79b64a', '#4d7c2f'],
    };
    const [main, accent] = skins[e.kind];

    ctx.fillStyle = main;
    ctx.beginPath();
    ctx.roundRect(x - ENEMY_W / 2, top, ENEMY_W, ENEMY_H - 4, 6);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(x - ENEMY_W / 2 + 2, top + 5, ENEMY_W - 4, 3);

    // eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 5, top + 4, 4, 4);
    ctx.fillRect(x + 1, top + 4, 4, 4);
    ctx.fillStyle = '#0f0d0e';
    ctx.fillRect(x - 4, top + 5, 2, 2);
    ctx.fillRect(x + 2, top + 5, 2, 2);

    // feet
    ctx.fillStyle = '#2c3e63';
    const swing = Math.sin(e.wobble * 8) * 2;
    ctx.fillRect(x - 6 + swing, y - 4, 5, 4);
    ctx.fillRect(x + 1 - swing, y - 4, 5, 4);
}

function drawPeppers() {
    for (const p of peppers) {
        const alpha = clamp(p.life / PEPPER_LIFE, 0, 1);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.5 * alpha})`;
        for (let i = 0; i < 14; i++) {
            const px = p.x + ((i * 37) % p.w);
            const py = p.y + ((i * 53) % p.h);
            ctx.fillRect(px, py, 2, 2);
        }
        ctx.fillStyle = `rgba(60, 40, 30, ${0.6 * alpha})`;
        for (let i = 0; i < 8; i++) {
            const px = p.x + ((i * 23) % p.w);
            const py = p.y + ((i * 41) % p.h);
            ctx.fillRect(px, py, 2, 2);
        }
    }
}

function drawSparks() {
    for (const s of sparks) {
        ctx.globalAlpha = clamp(s.life * 2, 0, 1);
        ctx.fillStyle = s.color;
        ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
}

function draw() {
    drawBackground();
    drawLadders();
    drawFloors();
    drawPlates();
    for (const ing of ingredients) drawIngredient(ing);
    drawPeppers();
    for (const e of enemies) drawEnemy(e);
    if (state !== 'idle') drawChef();
    drawSparks();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------
function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    pepperEl.textContent = String(pepper);
    bestEl.textContent = String(Math.max(best, score));
}

function showOverlay(title, sub2, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub2;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastTime = null;

function setAutoRun(on) {
    autoRun = !!on;
    lastTime = null;
}

function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;          // clamp after tab switches / long frames
    if (autoRun) step(dt);
    updateSparks(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const HELD = new Set();
const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];
const MOVE_KEYS = [...LEFT_KEYS, ...RIGHT_KEYS, ...UP_KEYS, ...DOWN_KEYS];

function refreshDir() {
    const left = LEFT_KEYS.some((k) => HELD.has(k));
    const right = RIGHT_KEYS.some((k) => HELD.has(k));
    const up = UP_KEYS.some((k) => HELD.has(k));
    const down = DOWN_KEYS.some((k) => HELD.has(k));
    setChefDir((right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        if (state === 'running') firePepper();
        else if (state === 'idle' || state === 'over') startGame();
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if ((e.key === 'r' || e.key === 'R') && state !== 'idle') {
        startGame();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
        HELD.add(e.key);
        refreshDir();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (HELD.has(e.key)) {
        HELD.delete(e.key);
        refreshDir();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
pepper = PEPPER_START;
buildLevel();
resetChef();
updateHud();
requestAnimationFrame(frame);
