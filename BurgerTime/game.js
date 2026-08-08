// ---------------------------------------------------------------------------
// BurgerTime — a platform-and-ladder arcade game on an HTML5 canvas.
//
// Chef Pepper runs across a scaffold of floors and ladders draped with the parts
// of four giant hamburgers. Walking the full length of an ingredient knocks it
// down a floor; land every piece on the plates at the bottom to clear the level.
// Walking food chases the chef, and a finite supply of pepper freezes it.
//
// Written as a single classic (non-module) script so the state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom, Snake
// and Tetris in this repo. All motion is per-second and advanced through
// `step(dt)`, so tests can simulate frames deterministically without depending
// on requestAnimationFrame wall-clock timing. Nothing here uses randomness.
// ---------------------------------------------------------------------------

// --- Grid ---
const TILE = 36;
const COLS = 16;
const ROWS = 14;
const CANVAS_W = COLS * TILE;   // 576
const CANVAS_H = ROWS * TILE;   // 504

const FLOOR_ROWS = [1, 4, 7, 10, 13];
const PLATE_ROW = 13;

// --- Burger lanes (left column of each) ---
const LANES = [1, 5, 9, 13];
const LANE_TILES = 3;
const SEGMENTS_PER_ING = LANE_TILES;
const ING_KINDS = ['bun-top', 'lettuce', 'patty', 'bun-bottom'];
const ING_ROWS = [1, 4, 7, 10];   // starting floor of each kind, top to bottom

// --- Ladders: { col, top, bottom } spanning those floor rows inclusive ---
const LADDERS = [
    { col: 0, top: 1, bottom: 13 },
    { col: 4, top: 1, bottom: 13 },
    { col: 8, top: 1, bottom: 13 },
    { col: 12, top: 1, bottom: 13 },
    { col: 2, top: 4, bottom: 7 },
    { col: 6, top: 7, bottom: 10 },
    { col: 10, top: 1, bottom: 4 },
    { col: 14, top: 10, bottom: 13 },
];

// --- Actors ---
const CHEF_SPEED = 112;         // px/s, constant across levels
const ENEMY_BASE = 58;          // px/s on level 1
const ENEMY_STEP = 7;           // px/s added per level
const ENEMY_MAX_SPEED = 104;
const FLOOR_SNAP = 6;           // px of slack for stepping off a ladder
const ACTOR_W = 22;
const ACTOR_H = 30;

// --- Ingredients ---
const FALL_SPEED = 190;         // px/s
const ING_H = 11;
const PLATE_STACK = 8;          // px each plated piece adds to the stack

// --- Pepper ---
const START_PEPPER = 5;
const PEPPER_RADIUS = 40;
const PEPPER_STUN = 3;
const CLOUD_LIFE = 0.45;

// --- Spawning ---
const SPAWN_POINTS = [
    { col: 0, row: 1 },
    { col: 15, row: 1 },
    { col: 15, row: 7 },
    { col: 0, row: 7 },
];
const ENEMY_KINDS = ['dog', 'egg', 'pickle'];
const FIRST_SPAWN_DELAY = 3;
const SPAWN_INTERVAL = 6;

// --- Rules ---
const START_LIVES = 3;
const DROP_POINTS = 50;
const SQUASH_POINTS = 100;
const LEVEL_BONUS = 1000;
const CHEF_START = { col: 8, row: 13 };
const BANNER_TIME = 1.6;

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
let state, score, best, lives, level, pepper, spawnTimer, spawnIndex;
const chef = { x: 0, y: 0, ix: 0, iy: 0, dir: 1, onLadder: false, anim: 0 };
const enemies = [];
const ingredients = [];
const clouds = [];
const banner = { text: '', timer: 0 };

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function floorY(row) { return row * TILE; }
function colCenter(col) { return col * TILE + TILE / 2; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** The floor row an actor at `y` is standing on, or null if it is between floors. */
function floorRowAt(y) {
    for (const row of FLOOR_ROWS) {
        if (Math.abs(y - floorY(row)) <= FLOOR_SNAP) return row;
    }
    return null;
}

/** The floor row nearest `y`, used when the chef is mid-ladder. */
function nearestFloorRow(y) {
    let best = FLOOR_ROWS[0];
    for (const row of FLOOR_ROWS) {
        if (Math.abs(y - floorY(row)) < Math.abs(y - floorY(best))) best = row;
    }
    return best;
}

function nextFloorRowBelow(row) {
    for (const r of FLOOR_ROWS) if (r > row) return r;
    return PLATE_ROW;
}

function isLadder(col, row) {
    return LADDERS.some((l) => l.col === col && row >= l.top && row <= l.bottom);
}

function ladderCols() {
    return [...new Set(LADDERS.map((l) => l.col))];
}

/** The ladder column an actor at `x` can reach, or null. */
function nearestLadderCol(x) {
    for (const col of ladderCols()) {
        if (Math.abs(colCenter(col) - x) <= TILE / 2) return col;
    }
    return null;
}

/**
 * The ladder span at `col` that contains `y` and still has room in direction
 * `dy` (-1 up, +1 down), or null when the climb is impossible.
 */
function ladderSpanFor(col, y, dy) {
    for (const l of LADDERS) {
        if (l.col !== col) continue;
        const top = floorY(l.top);
        const bottom = floorY(l.bottom);
        if (y < top - 0.01 || y > bottom + 0.01) continue;
        if (dy < 0 && y <= top + 0.01) continue;
        if (dy > 0 && y >= bottom - 0.01) continue;
        return l;
    }
    return null;
}

function enemySpeed() {
    return Math.min(ENEMY_MAX_SPEED, ENEMY_BASE + (level - 1) * ENEMY_STEP);
}

function maxEnemies() { return Math.min(5, 2 + level); }

// ---------------------------------------------------------------------------
// Board setup
// ---------------------------------------------------------------------------

function buildIngredients() {
    ingredients.length = 0;
    for (let lane = 0; lane < LANES.length; lane++) {
        for (let k = 0; k < ING_KINDS.length; k++) {
            ingredients.push({
                lane,
                kind: ING_KINDS[k],
                row: ING_ROWS[k],
                y: floorY(ING_ROWS[k]),
                segments: new Array(SEGMENTS_PER_ING).fill(false),
                falling: false,
                onPlate: false,
                extraFalls: 0,
                squashed: 0,
            });
        }
    }
}

function ingredientLeft(ing) { return LANES[ing.lane] * TILE; }
function ingredientWidth() { return LANE_TILES * TILE; }
function platedCount(lane) {
    return ingredients.filter((i) => i.lane === lane && i.onPlate).length;
}

function resetActors() {
    chef.x = colCenter(CHEF_START.col);
    chef.y = floorY(CHEF_START.row);
    chef.ix = 0;
    chef.iy = 0;
    chef.dir = 1;
    chef.onLadder = false;
    enemies.length = 0;
    clouds.length = 0;
    heldKeys.clear();
    spawnTimer = FIRST_SPAWN_DELAY;
    spawnIndex = 0;
}

function resetLevel() {
    buildIngredients();
    resetActors();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    pepper = START_PEPPER;
    banner.text = '';
    banner.timer = 0;
    resetLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space to play again', 'Play Again');
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

function loseLife() {
    lives--;
    if (lives <= 0) {
        lives = 0;
        updateHud();
        endGame();
        return;
    }
    setBanner('OUCH!');
    resetActors();
    updateHud();
}

function completeLevel() {
    score += LEVEL_BONUS;
    level++;
    pepper++;
    setBanner('BURGER TIME!');
    resetLevel();
    updateHud();
}

function setBanner(text) {
    banner.text = text;
    banner.timer = BANNER_TIME;
}

// ---------------------------------------------------------------------------
// Movement — one routine for the chef and every enemy
// ---------------------------------------------------------------------------

function stepActor(a, dt, speed) {
    if (a.iy !== 0) {
        const col = nearestLadderCol(a.x);
        if (col !== null) {
            const span = ladderSpanFor(col, a.y, a.iy);
            if (span) {
                a.x = colCenter(col);
                a.y = clamp(a.y + a.iy * speed * dt, floorY(span.top), floorY(span.bottom));
                a.onLadder = floorRowAt(a.y) === null;
                a.anim += speed * dt;
                return;
            }
        }
    }
    if (a.ix !== 0) {
        const row = floorRowAt(a.y);
        if (row !== null) {
            a.y = floorY(row);
            a.x = clamp(a.x + a.ix * speed * dt, TILE / 2, CANVAS_W - TILE / 2);
            a.dir = a.ix;
            a.onLadder = false;
            a.anim += speed * dt;
        }
    }
}

function moveChef(dx, dy) {
    chef.ix = dx;
    chef.iy = dy;
}

function setChefTile(col, row) {
    chef.x = colCenter(col);
    chef.y = floorY(row);
    chef.ix = 0;
    chef.iy = 0;
    chef.onLadder = false;
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

function dropIngredient(ing) {
    if (ing.falling || ing.onPlate) return;
    ing.falling = true;
    ing.squashed = 0;
}

/** Mark the segment the chef is standing on, and drop the piece once all are in. */
function pressSegments() {
    const row = floorRowAt(chef.y);
    if (row === null) return;
    for (const ing of ingredients) {
        if (ing.falling || ing.onPlate || ing.row !== row) continue;
        if (Math.abs(chef.y - floorY(row)) > 0.01) continue;
        const left = ingredientLeft(ing);
        const idx = Math.floor((chef.x - left) / TILE);
        if (idx < 0 || idx >= SEGMENTS_PER_ING) continue;
        ing.segments[idx] = true;
    }
}

function squashEnemies(ing) {
    const left = ingredientLeft(ing);
    const right = left + ingredientWidth();
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (e.x < left || e.x > right) continue;
        if (Math.abs(e.y - ing.y) > TILE * 0.6) continue;
        enemies.splice(i, 1);
        ing.squashed++;
        ing.extraFalls++;
        score += SQUASH_POINTS * ing.squashed;
    }
}

function landOnPlate(ing) {
    ing.row = PLATE_ROW;
    ing.y = floorY(PLATE_ROW) - platedCount(ing.lane) * PLATE_STACK;
    ing.onPlate = true;
    ing.falling = false;
    ing.extraFalls = 0;
    ing.segments.fill(false);
    score += DROP_POINTS;
}

function stepIngredient(ing, dt) {
    if (!ing.falling) {
        // Every segment trodden on — down it goes.
        if (!ing.onPlate && ing.segments.every(Boolean)) dropIngredient(ing);
        if (!ing.falling) return;
    }
    ing.y += FALL_SPEED * dt;
    squashEnemies(ing);

    // Resolve as many floor lines as this frame's motion crossed.
    for (;;) {
        const nextRow = nextFloorRowBelow(ing.row);
        const toPlate = nextRow === PLATE_ROW;
        const targetY = toPlate
            ? floorY(PLATE_ROW) - platedCount(ing.lane) * PLATE_STACK
            : floorY(nextRow);
        if (ing.y < targetY) return;

        ing.y = targetY;
        ing.row = nextRow;

        if (toPlate) {
            landOnPlate(ing);
            if (ingredients.every((i) => i.onPlate)) completeLevel();
            return;
        }

        score += DROP_POINTS;

        if (ing.extraFalls > 0) {
            ing.extraFalls--;
            continue;                       // a squash bought another floor
        }

        const below = ingredients.find(
            (o) => o !== ing && !o.falling && !o.onPlate && o.lane === ing.lane && o.row === nextRow,
        );
        if (below) {
            dropIngredient(below);          // cascade: it takes this one along
            continue;
        }

        ing.falling = false;
        ing.segments.fill(false);
        return;
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemy(kind, col, row) {
    const e = {
        kind,
        x: colCenter(col),
        y: floorY(row),
        ix: 0,
        iy: 0,
        dir: 1,
        stun: 0,
        onLadder: false,
        anim: 0,
    };
    enemies.push(e);
    return e;
}

function enemyDecide(e) {
    const row = floorRowAt(e.y);
    if (row === null) return { dx: 0, dy: e.iy || 1 };   // mid-ladder: keep going

    const chefRow = floorRowAt(chef.y) ?? nearestFloorRow(chef.y);
    if (chefRow !== row) {
        const want = chefRow > row ? 1 : -1;
        const here = nearestLadderCol(e.x);
        if (here !== null && ladderSpanFor(here, floorY(row), want)) {
            return { dx: 0, dy: want };
        }
        let target = null;
        let bestDist = Infinity;
        for (const col of ladderCols()) {
            if (!ladderSpanFor(col, floorY(row), want)) continue;
            const d = Math.abs(colCenter(col) - e.x);
            if (d < bestDist) { bestDist = d; target = col; }
        }
        if (target !== null) {
            return { dx: Math.sign(colCenter(target) - e.x) || e.dir, dy: 0 };
        }
    }
    return { dx: Math.sign(chef.x - e.x) || e.dir, dy: 0 };
}

function stepEnemies(dt) {
    const speed = enemySpeed();
    for (const e of enemies) {
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - dt);
            continue;
        }
        const { dx, dy } = enemyDecide(e);
        e.ix = dx;
        e.iy = dy;
        stepActor(e, dt, speed);
    }
}

function spawnTick(dt) {
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = SPAWN_INTERVAL;
    if (enemies.length >= maxEnemies()) return;
    const point = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
    const kind = ENEMY_KINDS[spawnIndex % ENEMY_KINDS.length];
    spawnIndex++;
    spawnEnemy(kind, point.col, point.row);
}

function checkChefHit() {
    for (const e of enemies) {
        if (e.stun > 0) continue;
        if (Math.abs(e.x - chef.x) < ACTOR_W * 0.8 && Math.abs(e.y - chef.y) < ACTOR_H * 0.7) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function throwPepper() {
    if (state !== 'running' || pepper <= 0) return;
    pepper--;
    const cloud = {
        x: clamp(chef.x + chef.dir * TILE, TILE / 2, CANVAS_W - TILE / 2),
        y: chef.y - ACTOR_H / 2,
        life: CLOUD_LIFE,
    };
    clouds.push(cloud);
    for (const e of enemies) {
        if (Math.hypot(e.x - cloud.x, e.y - ACTOR_H / 2 - cloud.y) <= PEPPER_RADIUS) {
            e.stun = PEPPER_STUN;
        }
    }
    updateHud();
}

function stepClouds(dt) {
    for (let i = clouds.length - 1; i >= 0; i--) {
        clouds[i].life -= dt;
        if (clouds[i].life <= 0) clouds.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    if (banner.timer > 0) banner.timer = Math.max(0, banner.timer - dt);

    stepActor(chef, dt, CHEF_SPEED);
    pressSegments();

    // Snapshot: completing a level rebuilds `ingredients` mid-iteration.
    for (const ing of ingredients.slice()) stepIngredient(ing, dt);

    stepEnemies(dt);
    stepClouds(dt);
    spawnTick(dt);
    checkChefHit();
    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ING_COLORS = {
    'bun-top': ['#d99a4e', '#b87833'],
    lettuce: ['#6bbf59', '#4e9440'],
    patty: ['#7a4a2b', '#5c351d'],
    'bun-bottom': ['#cf8f47', '#a86c2c'],
};

const ENEMY_COLORS = {
    dog: ['#e35d3f', '#b8422a'],
    egg: ['#f4f1e6', '#f2c14e'],
    pickle: ['#79b34a', '#4f7c30'],
};

function drawLaneBands() {
    for (const left of LANES) {
        const grad = ctx.createLinearGradient(0, floorY(FLOOR_ROWS[0]), 0, floorY(PLATE_ROW));
        grad.addColorStop(0, 'rgba(255, 183, 3, 0.07)');
        grad.addColorStop(1, 'rgba(255, 183, 3, 0.02)');
        ctx.fillStyle = grad;
        ctx.fillRect(left * TILE, floorY(FLOOR_ROWS[0]), LANE_TILES * TILE, floorY(PLATE_ROW) - floorY(FLOOR_ROWS[0]));
    }
}

function drawLadders() {
    ctx.strokeStyle = '#5b6b8c';
    ctx.lineWidth = 2;
    for (const l of LADDERS) {
        const x = colCenter(l.col);
        const top = floorY(l.top);
        const bottom = floorY(l.bottom);
        ctx.beginPath();
        ctx.moveTo(x - 9, top);
        ctx.lineTo(x - 9, bottom);
        ctx.moveTo(x + 9, top);
        ctx.lineTo(x + 9, bottom);
        ctx.stroke();
        ctx.beginPath();
        for (let y = top + 8; y < bottom; y += 10) {
            ctx.moveTo(x - 9, y);
            ctx.lineTo(x + 9, y);
        }
        ctx.stroke();
    }
}

function drawFloors() {
    for (const row of FLOOR_ROWS) {
        const y = floorY(row);
        ctx.fillStyle = row === PLATE_ROW ? '#8a93ad' : '#7b86a3';
        ctx.fillRect(0, y, CANVAS_W, 4);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, y + 4, CANVAS_W, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        for (let x = TILE / 2; x < CANVAS_W; x += TILE) ctx.fillRect(x - 1, y + 1, 2, 2);
    }
}

function drawPlates() {
    const y = floorY(PLATE_ROW) + 6;
    for (const left of LANES) {
        const x = left * TILE;
        const w = LANE_TILES * TILE;
        ctx.fillStyle = '#cfd6e4';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y, w / 2 - 2, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9aa4b8';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y - 2, w / 2 - 10, 4, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawIngredient(ing) {
    const left = ingredientLeft(ing);
    const w = ingredientWidth();
    const [light, dark] = ING_COLORS[ing.kind];
    const segW = w / SEGMENTS_PER_ING;

    for (let s = 0; s < SEGMENTS_PER_ING; s++) {
        const sx = left + s * segW;
        const dip = ing.segments[s] ? 4 : 0;
        const top = ing.y - ING_H + dip;

        ctx.fillStyle = dark;
        ctx.fillRect(sx, top + ING_H - 4, segW, 4);
        ctx.fillStyle = light;
        if (ing.kind === 'bun-top') {
            ctx.beginPath();
            ctx.moveTo(sx, top + ING_H - 3);
            ctx.quadraticCurveTo(sx + segW / 2, top - 5, sx + segW, top + ING_H - 3);
            ctx.fill();
        } else {
            ctx.fillRect(sx, top, segW, ING_H - 3);
        }
        if (ing.kind === 'lettuce') {
            ctx.fillStyle = '#8ed67b';
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.arc(sx + segW * (i + 0.5) / 3, top + 2, 4, Math.PI, 0);
                ctx.fill();
            }
        }
        if (ing.kind === 'bun-top') {
            ctx.fillStyle = '#f6e2b8';
            for (let i = 0; i < 3; i++) {
                ctx.fillRect(sx + segW * (i + 0.5) / 3 - 1, top + 1, 2, 2);
            }
        }
    }
}

function drawChef() {
    const x = chef.x;
    const y = chef.y;
    const stride = Math.sin(chef.anim / 9) * 4;

    // legs
    ctx.strokeStyle = '#2f3d63';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x - 4 + stride, y);
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x + 4 - stride, y);
    ctx.stroke();

    // body
    ctx.fillStyle = '#f4f1e6';
    ctx.fillRect(x - 8, y - 22, 16, 13);
    // arms
    ctx.strokeStyle = '#f4f1e6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 19);
    ctx.lineTo(x - 12, y - 12 - stride);
    ctx.moveTo(x + 8, y - 19);
    ctx.lineTo(x + 12, y - 12 + stride);
    ctx.stroke();
    // head
    ctx.fillStyle = '#ecc39a';
    ctx.beginPath();
    ctx.arc(x, y - 26, 5, 0, Math.PI * 2);
    ctx.fill();
    // hat
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 6, y - 33, 12, 4);
    ctx.beginPath();
    ctx.ellipse(x, y - 34, 6, 4, 0, Math.PI, 0);
    ctx.fill();
    // eye, facing
    ctx.fillStyle = '#22202a';
    ctx.fillRect(x + (chef.dir > 0 ? 1 : -3), y - 28, 2, 2);
}

function drawEnemy(e) {
    const [light, dark] = ENEMY_COLORS[e.kind];
    const x = e.x;
    const y = e.y;
    const wobble = e.stun > 0 ? 0 : Math.sin(e.anim / 8) * 2;

    ctx.fillStyle = e.stun > 0 ? '#8d8fa8' : light;
    if (e.kind === 'egg') {
        ctx.beginPath();
        ctx.ellipse(x, y - 10, 11, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = e.stun > 0 ? '#b8b6c6' : dark;
        ctx.beginPath();
        ctx.arc(x, y - 11, 4, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.roundRect(x - 10, y - 20, 20, 20, e.kind === 'dog' ? 8 : 5);
        ctx.fill();
        ctx.fillStyle = e.stun > 0 ? '#b8b6c6' : dark;
        ctx.fillRect(x - 10, y - 8, 20, 3);
    }

    // legs
    ctx.strokeStyle = '#2b2233';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 3);
    ctx.lineTo(x - 5 + wobble, y);
    ctx.moveTo(x + 4, y - 3);
    ctx.lineTo(x + 5 - wobble, y);
    ctx.stroke();

    // eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 5, y - 16, 4, 4);
    ctx.fillRect(x + 1, y - 16, 4, 4);
    ctx.fillStyle = '#1c1622';
    const look = e.stun > 0 ? 0 : (e.dir > 0 ? 2 : 0);
    ctx.fillRect(x - 5 + look, y - 15, 2, 2);
    ctx.fillRect(x + 1 + look, y - 15, 2, 2);

    if (e.stun > 0) {
        ctx.fillStyle = '#ffe08a';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', x, y - 24);
    }
}

function drawClouds() {
    for (const c of clouds) {
        const a = Math.max(0, c.life / CLOUD_LIFE);
        const spread = 1.6 - a * 0.6;
        ctx.fillStyle = `rgba(255, 244, 214, ${0.85 * a})`;
        for (let i = 0; i < 7; i++) {
            const ang = (i / 7) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(c.x + Math.cos(ang) * 11 * spread, c.y + Math.sin(ang) * 9 * spread, 9, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = `rgba(90, 60, 40, ${0.7 * a})`;
        for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI * 2 + 0.4;
            ctx.fillRect(c.x + Math.cos(ang) * 13 * spread - 1, c.y + Math.sin(ang) * 10 * spread - 1, 2, 2);
        }
    }
}

function drawBanner() {
    if (banner.timer <= 0 || !banner.text) return;
    ctx.fillStyle = '#ffb703';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(banner.text, CANVAS_W / 2, CANVAS_H / 2);
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawLaneBands();
    drawLadders();
    drawFloors();
    drawPlates();
    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    drawChef();
    drawClouds();
    drawBanner();
}

// ---------------------------------------------------------------------------
// HUD / overlay
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
    const held = (keys) => keys.some((k) => heldKeys.has(k));
    const dx = (held(RIGHT_KEYS) ? 1 : 0) - (held(LEFT_KEYS) ? 1 : 0);
    const dy = (held(DOWN_KEYS) ? 1 : 0) - (held(UP_KEYS) ? 1 : 0);
    moveChef(dx, dy);
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
score = 0;
lives = START_LIVES;
level = 1;
pepper = START_PEPPER;
state = 'idle';
resetLevel();
updateHud();
requestAnimationFrame(frame);
