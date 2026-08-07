// ---------------------------------------------------------------------------
// Burger Time — a platform arcade game on an HTML5 canvas.
//
// Chef Pepper runs along girders and ladders, walking over burger ingredients to
// knock them down the tower and onto the plates below. Three food enemies chase
// him; a shake of the pepper pot freezes them, and an ingredient dropped on one
// squashes it flat.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Grid geometry ---------------------------------------------------------
const TILE = 32;
const COLS = 20;
const ROWS = 16;
const CANVAS_W = COLS * TILE;   // 640
const CANVAS_H = ROWS * TILE;   // 512

// Walkable girders. The last one doubles as the plate shelf.
const FLOOR_ROWS = [2, 4, 6, 8, 10, 12, 14];
const PLATE_ROW = 14;
const FLOOR_MIN_COL = 1;
const FLOOR_MAX_COL = 18;

// Ladders always join two neighbouring girders. Columns are chosen so no ladder
// ever runs through a burger stack (a ladder there would be unreachable while an
// ingredient sat on it).
const LADDER_SEGMENTS = [
    { top: 2, bottom: 4, cols: [1, 7, 13] },
    { top: 4, bottom: 6, cols: [6, 12, 18] },
    { top: 6, bottom: 8, cols: [1, 7, 18] },
    { top: 8, bottom: 10, cols: [6, 13, 18] },
    { top: 10, bottom: 12, cols: [1, 7, 12] },
    { top: 12, bottom: 14, cols: [6, 13, 18] },
];

// --- Burgers ---------------------------------------------------------------
const STACK_COLS = [2, 8, 14];   // left column of each burger stack
const STACK_W = 4;               // an ingredient is four segments wide
const ING_KINDS = ['bunTop', 'lettuce', 'patty', 'bunBottom'];
const ING_H = 10;                // thickness of one ingredient / pile spacing

// Starting girder for each ingredient, top of the burger first. Gaps between
// ingredients are what make a full chain reaction something you have to set up.
const STACK_ROWS = [
    [2, 4, 8, 12],
    [2, 6, 10, 12],
    [4, 6, 8, 10],
];

// --- Speeds (px/s) ---------------------------------------------------------
const PLAYER_SPEED = 100;
const CLIMB_SPEED = 84;
const FALL_SPEED = 210;
const ENEMY_SPEED_BASE = 46;
const ENEMY_SPEED_STEP = 8;
const ENEMY_SPEED_MAX = 92;

// --- Rules -----------------------------------------------------------------
const START_LIVES = 3;
const START_PEPPER = 5;
const PLAYER_HALF = 11;          // half the chef's width, for floor-edge tests
const LADDER_SNAP = 14;          // how close to a ladder centre you must be
const HIT_DX = 16, HIT_DY = 24;  // chef/enemy overlap box
const INVULN_TIME = 1.5;
const STUN_TIME = 3.5;
const RESPAWN_TIME = 3.0;
const PEPPER_W = 44, PEPPER_H = 30, PEPPER_LIFE = 0.5;
const SQUASH_DY = 14;            // vertical reach of a falling ingredient

const ING_DROP_POINTS = 50;
const SQUASH_POINTS = 500;
const PEPPER_POINTS = 100;
const LEVEL_BONUS = 1000;

const ENEMY_KINDS = ['hotdog', 'pickle', 'egg'];
const ENEMY_SPAWNS = [
    { col: 1, row: 2 },
    { col: 18, row: 2 },
    { col: 1, row: 8 },
    { col: 18, row: 8 },
    { col: 9, row: 2 },
];
const PLAYER_SPAWN = { col: 9, row: 14 };

const BEST_KEY = 'burgertime-best';

// --- DOM -------------------------------------------------------------------
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

// --- State -----------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'levelclear' | 'over'
let state = 'idle';
let score = 0;
let best = 0;
let level = 1;
let lives = START_LIVES;
let pepper = START_PEPPER;

const player = {
    x: 0, y: 0,
    mode: 'floor',        // 'floor' | 'ladder'
    dx: 0, dy: 0,
    face: 1,
    invuln: 0,
    walk: 0,              // animation phase
    climbTopY: 0,
    climbBotY: 0,
};

const enemies = [];
const ingredients = [];
const fallingGroups = [];
const peppers = [];
const sparks = [];

// A tiny deterministic PRNG so enemy wandering is reproducible frame for frame.
let rngSeed = 1;
function rand() {
    rngSeed = (rngSeed * 1664525 + 1013904223) >>> 0;
    return rngSeed / 4294967296;
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

// '.' empty · '-' girder · '|' ladder · '+' girder with a ladder passing through
function buildMap() {
    const grid = [];
    for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill('.'));
    for (const r of FLOOR_ROWS) {
        for (let c = FLOOR_MIN_COL; c <= FLOOR_MAX_COL; c++) grid[r][c] = '-';
    }
    for (const seg of LADDER_SEGMENTS) {
        for (const c of seg.cols) {
            for (let r = seg.top; r <= seg.bottom; r++) {
                grid[r][c] = FLOOR_ROWS.includes(r) ? '+' : '|';
            }
        }
    }
    return grid.map((row) => row.join(''));
}

const MAP = buildMap();

function cellAt(col, row) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return '.';
    return MAP[row][col];
}
function isFloor(col, row) {
    const c = cellAt(col, row);
    return c === '-' || c === '+';
}
function isLadder(col, row) {
    const c = cellAt(col, row);
    return c === '|' || c === '+';
}

function colOf(x) { return Math.floor(x / TILE); }
function rowOf(y) { return Math.floor(y / TILE); }
function colCenter(col) { return col * TILE + TILE / 2; }
function floorYOf(row) { return row * TILE; }
function nearestCol(x) { return Math.round((x - TILE / 2) / TILE); }

/** The ladder segment whose bottom rail rests on `row` at `col`, if any. */
function segmentAbove(col, row) {
    return LADDER_SEGMENTS.find((s) => s.bottom === row && s.cols.includes(col)) || null;
}
/** The ladder segment that drops away from `row` at `col`, if any. */
function segmentBelow(col, row) {
    return LADDER_SEGMENTS.find((s) => s.top === row && s.cols.includes(col)) || null;
}
/** The next girder underneath `row` (the plate row is the last one). */
function nextFloorBelow(row) {
    for (const r of FLOOR_ROWS) if (r > row) return r;
    return PLATE_ROW;
}
function stackX(stack) { return STACK_COLS[stack] * TILE; }

// ---------------------------------------------------------------------------
// Level setup
// ---------------------------------------------------------------------------

function makeIngredients() {
    ingredients.length = 0;
    STACK_COLS.forEach((_, s) => {
        ING_KINDS.forEach((kind, k) => {
            ingredients.push({
                stack: s,
                kind,
                row: STACK_ROWS[s][k],
                pileIndex: 0,
                segs: [false, false, false, false],
                state: 'rest',            // 'rest' | 'fall' | 'plated'
                y: floorYOf(STACK_ROWS[s][k]) - ING_H,
            });
        });
    });
}

function enemySpeedFor(lvl) {
    return Math.min(ENEMY_SPEED_MAX, ENEMY_SPEED_BASE + (lvl - 1) * ENEMY_SPEED_STEP);
}
function enemyCountFor(lvl) {
    return Math.min(ENEMY_SPAWNS.length, 3 + Math.floor((lvl - 1) / 2));
}

function makeEnemies() {
    enemies.length = 0;
    const n = enemyCountFor(level);
    for (let i = 0; i < n; i++) {
        const e = {
            kind: ENEMY_KINDS[i % ENEMY_KINDS.length],
            spawn: ENEMY_SPAWNS[i],
            speed: enemySpeedFor(level),
            x: 0, y: 0,
            mode: 'floor',
            target: null,
            prev: null,
            stun: 0,
            squashed: false,
            respawn: 0,
            wobble: 0,
        };
        enemies.push(e);
        respawnEnemy(e);
    }
}

function respawnEnemy(e) {
    placeEnemy(e, e.spawn.col, e.spawn.row);
    e.squashed = false;
    e.respawn = 0;
    e.stun = 0;
}

/** Park an enemy exactly on a grid node (also used by the tests). */
function placeEnemy(e, col, row) {
    e.x = colCenter(col);
    e.y = floorYOf(row);
    e.mode = 'floor';
    e.target = null;
    e.prev = null;
    e.stun = 0;
    return e;
}

/** Park the chef exactly on a grid node (also used by the tests). */
function placePlayer(col, row) {
    player.x = colCenter(col);
    player.y = floorYOf(row);
    player.mode = 'floor';
    player.dx = 0;
    player.dy = 0;
    return player;
}

function resetPositions() {
    placePlayer(PLAYER_SPAWN.col, PLAYER_SPAWN.row);
    player.face = 1;
    player.invuln = INVULN_TIME;
    enemies.forEach(respawnEnemy);
    peppers.length = 0;
}

function resetLevel() {
    rngSeed = 2024 + level * 7919;
    makeIngredients();
    fallingGroups.length = 0;
    peppers.length = 0;
    sparks.length = 0;
    makeEnemies();
    placePlayer(PLAYER_SPAWN.col, PLAYER_SPAWN.row);
    player.face = 1;
    player.invuln = 0;
    player.walk = 0;
}

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    pepper = START_PEPPER;
    resetLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    pepper = START_PEPPER;
    resetLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

// ---------------------------------------------------------------------------
// Ingredient piles
// ---------------------------------------------------------------------------

/** Ingredients resting on `row` of `stack`, bottom of the pile first. */
function pileAt(stack, row) {
    return ingredients
        .filter((i) => i.stack === stack && i.row === row && i.state === 'rest')
        .sort((a, b) => a.pileIndex - b.pileIndex);
}

function topOfPile(stack, row) {
    const pile = pileAt(stack, row);
    return pile.length ? pile[pile.length - 1] : null;
}

function plateCount(stack) {
    return ingredients.filter((i) => i.stack === stack && i.state === 'plated').length;
}

function burgerComplete(stack) {
    return plateCount(stack) === ING_KINDS.length;
}

function levelComplete() {
    return ingredients.every((i) => i.state === 'plated');
}

function syncGroup(g) {
    g.members.forEach((m, i) => { m.y = g.y - i * ING_H; });
}

/**
 * Send the whole pile sitting on (stack, row) down one girder. Anything it lands
 * on is knocked loose as well and the growing stack keeps going — the chain
 * reaction that makes a good Burger Time run.
 */
function dropPile(stack, row) {
    const pile = pileAt(stack, row);
    if (!pile.length) return null;
    const g = {
        stack,
        members: pile,
        targetRow: nextFloorBelow(row),
        y: pile[0].y,
        chain: pile.length,
    };
    pile.forEach((m) => { m.state = 'fall'; });
    fallingGroups.push(g);
    syncGroup(g);
    return g;
}

function updateFalling(dt) {
    for (let i = fallingGroups.length - 1; i >= 0; i--) {
        const g = fallingGroups[i];
        const landY = floorYOf(g.targetRow) - ING_H;
        g.y = Math.min(landY, g.y + FALL_SPEED * dt);
        syncGroup(g);
        squashEnemiesUnder(g);
        if (g.y >= landY) {
            const done = landGroup(g);
            if (done) fallingGroups.splice(i, 1);
        }
    }
}

/** Resolve a group arriving at its target girder. Returns true when it settles. */
function landGroup(g) {
    score += ING_DROP_POINTS * g.members.length;

    if (g.targetRow === PLATE_ROW) {
        const base = plateCount(g.stack);
        g.members.forEach((m, i) => {
            m.state = 'plated';
            m.row = PLATE_ROW;
            m.pileIndex = base + i;
            m.segs = [false, false, false, false];
            m.y = floorYOf(PLATE_ROW) - (base + i + 1) * ING_H;
        });
        burstAt(stackX(g.stack) + STACK_W * TILE / 2, floorYOf(PLATE_ROW) - 8, '#ffd479');
        return true;
    }

    const resting = pileAt(g.stack, g.targetRow);
    if (resting.length) {
        // Knocked loose: the pile below joins underneath and the whole column
        // carries on to the next girder.
        resting.forEach((m) => {
            m.state = 'fall';
            m.segs = [false, false, false, false];
        });
        g.members = resting.concat(g.members);
        g.targetRow = nextFloorBelow(g.targetRow);
        g.chain += resting.length;
        syncGroup(g);
        return false;
    }

    g.members.forEach((m, i) => {
        m.state = 'rest';
        m.row = g.targetRow;
        m.pileIndex = i;
        m.segs = [false, false, false, false];
        m.y = floorYOf(g.targetRow) - (i + 1) * ING_H;
    });
    return true;
}

function squashEnemiesUnder(g) {
    const x0 = stackX(g.stack);
    const x1 = x0 + STACK_W * TILE;
    const edge = g.y + ING_H;
    for (const e of enemies) {
        if (e.squashed) continue;
        if (e.x < x0 || e.x > x1) continue;
        if (Math.abs(e.y - edge) > SQUASH_DY) continue;
        squashEnemy(e);
    }
}

function squashEnemy(e) {
    if (e.squashed) return;
    e.squashed = true;
    e.respawn = RESPAWN_TIME;
    e.stun = 0;
    e.target = null;
    score += SQUASH_POINTS;
    burstAt(e.x, e.y - 10, '#9ff2a0');
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function setPlayerDir(dx, dy) {
    player.dx = Math.sign(dx || 0);
    player.dy = Math.sign(dy || 0);
    if (player.dx !== 0) player.face = player.dx;
}

function updatePlayer(dt) {
    if (player.invuln > 0) player.invuln -= dt;
    const { dx, dy } = player;

    if (player.mode === 'floor' && dy !== 0) tryMountLadder(dy);

    if (player.mode === 'ladder') {
        if (dy !== 0) climb(dy, dt);
        else if (dx !== 0 && onFloorLine(player.y) && isFloor(colOf(player.x), rowOf(player.y))) {
            player.mode = 'floor';
        }
    }

    if (player.mode === 'floor' && dx !== 0) {
        const row = rowOf(player.y);
        const nx = player.x + dx * PLAYER_SPEED * dt;
        const probe = colOf(nx + dx * PLAYER_HALF);
        if (isFloor(probe, row)) {
            player.x = nx;
            player.walk += PLAYER_SPEED * dt;
        }
    }

    if (player.mode === 'ladder' && dy !== 0) player.walk += CLIMB_SPEED * dt;
    if (player.mode === 'floor') stepOnIngredients();
}

function onFloorLine(y) {
    return FLOOR_ROWS.includes(Math.round(y / TILE)) && Math.abs(y - Math.round(y / TILE) * TILE) < 0.5;
}

function tryMountLadder(dy) {
    const c = nearestCol(player.x);
    if (Math.abs(player.x - colCenter(c)) > LADDER_SNAP) return;
    const row = rowOf(player.y);
    const seg = dy < 0 ? segmentAbove(c, row) : segmentBelow(c, row);
    if (!seg) return;
    player.x = colCenter(c);
    player.mode = 'ladder';
    player.climbTopY = floorYOf(dy < 0 ? seg.top : row);
    player.climbBotY = floorYOf(dy < 0 ? row : seg.bottom);
}

function climb(dy, dt) {
    const c = colOf(player.x);
    const ny = player.y + dy * CLIMB_SPEED * dt;
    if (ny <= player.climbTopY) {
        const seg = segmentAbove(c, rowOf(player.climbTopY));
        if (seg) { player.climbTopY = floorYOf(seg.top); player.y = ny; }
        else { player.y = player.climbTopY; player.mode = 'floor'; }
    } else if (ny >= player.climbBotY) {
        const seg = segmentBelow(c, rowOf(player.climbBotY));
        if (seg) { player.climbBotY = floorYOf(seg.bottom); player.y = ny; }
        else { player.y = player.climbBotY; player.mode = 'floor'; }
    } else {
        player.y = ny;
    }
}

/** Press down whichever ingredient segment the chef is standing on. */
function stepOnIngredients() {
    const row = rowOf(player.y);
    if (!FLOOR_ROWS.includes(row)) return;
    for (let s = 0; s < STACK_COLS.length; s++) {
        const x0 = stackX(s);
        if (player.x < x0 || player.x >= x0 + STACK_W * TILE) continue;
        const top = topOfPile(s, row);
        if (!top) continue;
        const seg = Math.min(STACK_W - 1, Math.max(0, Math.floor((player.x - x0) / TILE)));
        if (!top.segs[seg]) {
            top.segs[seg] = true;
            if (top.segs.every(Boolean)) dropPile(s, row);
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function sprayPepper() {
    if (pepper <= 0) return null;
    pepper -= 1;
    const cloud = {
        x: player.face > 0 ? player.x + 8 : player.x - 8 - PEPPER_W,
        y: player.y - 26,
        w: PEPPER_W,
        h: PEPPER_H,
        life: PEPPER_LIFE,
    };
    peppers.push(cloud);
    updateHud();
    return cloud;
}

function updatePeppers(dt) {
    for (let i = peppers.length - 1; i >= 0; i--) {
        const p = peppers[i];
        p.life -= dt;
        for (const e of enemies) {
            if (e.squashed || e.stun > 0) continue;
            const ey = e.y - 12;
            if (e.x < p.x || e.x > p.x + p.w) continue;
            if (ey < p.y - 8 || ey > p.y + p.h + 8) continue;
            e.stun = STUN_TIME;
            e.target = null;
            score += PEPPER_POINTS;
        }
        if (p.life <= 0) peppers.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function chooseEnemyTarget(e) {
    const col = nearestCol(e.x);
    const row = rowOf(e.y);
    const opts = [];
    if (isFloor(col - 1, row)) opts.push({ col: col - 1, row });
    if (isFloor(col + 1, row)) opts.push({ col: col + 1, row });
    const up = segmentAbove(col, row);
    if (up) opts.push({ col, row: up.top });
    const down = segmentBelow(col, row);
    if (down) opts.push({ col, row: down.bottom });
    if (!opts.length) { e.target = null; return; }

    let cands = opts;
    if (e.prev) {
        const forward = opts.filter((o) => !(o.col === e.prev.col && o.row === e.prev.row));
        if (forward.length) cands = forward;
    }

    let pick;
    if (rand() < 0.25) {
        pick = cands[Math.floor(rand() * cands.length)];
    } else {
        const pc = (player.x - TILE / 2) / TILE;
        const pr = player.y / TILE;
        const cost = (o) => Math.abs(o.col - pc) + Math.abs(o.row - pr) * 1.5;
        pick = cands.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    }
    e.prev = { col, row };
    e.target = pick;
}

function updateEnemy(e, dt) {
    if (e.squashed) {
        e.respawn -= dt;
        if (e.respawn <= 0) respawnEnemy(e);
        return;
    }
    if (e.stun > 0) {
        e.stun -= dt;
        return;
    }
    if (!e.target) chooseEnemyTarget(e);
    if (!e.target) return;

    const tx = colCenter(e.target.col);
    const ty = floorYOf(e.target.row);
    const dx = tx - e.x;
    const dy = ty - e.y;
    const dist = Math.hypot(dx, dy);
    e.mode = Math.abs(dy) > Math.abs(dx) ? 'ladder' : 'floor';
    const move = e.speed * dt;
    if (dist <= move || dist === 0) {
        e.x = tx;
        e.y = ty;
        e.target = null;
    } else {
        e.x += (dx / dist) * move;
        e.y += (dy / dist) * move;
    }
    e.wobble += move;
}

function checkEnemyHits() {
    if (player.invuln > 0) return;
    for (const e of enemies) {
        if (e.squashed || e.stun > 0) continue;
        if (Math.abs(e.x - player.x) < HIT_DX && Math.abs(e.y - player.y) < HIT_DY) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Life cycle
// ---------------------------------------------------------------------------

function loseLife() {
    lives -= 1;
    burstAt(player.x, player.y - 14, '#ff8a5c');
    if (lives <= 0) {
        lives = 0;
        gameOver();
    } else {
        resetPositions();
        updateHud();
    }
}

function gameOver() {
    state = 'over';
    saveBest();
    updateHud();
    showOverlay('GAME OVER', `Score ${score}` + (score >= best ? ' — new best!' : ''),
        'Press Space or click Start to play again');
}

function levelClear() {
    score += LEVEL_BONUS * level;
    state = 'levelclear';
    saveBest();
    updateHud();
    showOverlay('BURGERS SERVED!', `Level ${level} cleared — score ${score}`,
        'Press Space to cook the next order');
}

function saveBest() {
    if (score > best) best = score;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (err) { /* private mode */ }
}

/** Debug/test hook: serve every burger at once. */
function plateEverything() {
    fallingGroups.length = 0;
    STACK_COLS.forEach((_, s) => {
        ingredients
            .filter((i) => i.stack === s)
            .forEach((ing, idx) => {
                ing.state = 'plated';
                ing.row = PLATE_ROW;
                ing.pileIndex = idx;
                ing.segs = [false, false, false, false];
                ing.y = floorYOf(PLATE_ROW) - (idx + 1) * ING_H;
            });
    });
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    updatePlayer(dt);
    updateFalling(dt);
    updatePeppers(dt);
    for (const e of enemies) updateEnemy(e, dt);
    checkEnemyHits();
    if (state === 'running' && levelComplete()) levelClear();
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
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    if (score > best) best = score;
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    pepperEl.textContent = String(pepper);
    bestEl.textContent = String(best);
}

function showOverlay(title, sub, hint) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub;
    overlaySub.textContent = hint;
    overlay.classList.add('visible');
    btnStart.textContent = state === 'levelclear' ? 'Next Level' : 'Start Game';
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Sparks (pure decoration — never touched by the tests)
// ---------------------------------------------------------------------------

function burstAt(x, y, color) {
    for (let i = 0; i < 10; i++) {
        const a = (Math.PI * 2 * i) / 10;
        sparks.push({
            x, y, color,
            vx: Math.cos(a) * (40 + (i % 3) * 20),
            vy: Math.sin(a) * (40 + (i % 3) * 20) - 30,
            life: 0.5,
        });
    }
}

function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 260 * dt;
        s.life -= dt;
        if (s.life <= 0) sparks.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ING_STYLE = {
    bunTop: { fill: '#e8a552', edge: '#b9752c' },
    lettuce: { fill: '#63b45a', edge: '#3d7a37' },
    patty: { fill: '#8b5a3c', edge: '#5c3823' },
    bunBottom: { fill: '#d8954a', edge: '#a86526' },
};

const ENEMY_STYLE = {
    hotdog: { body: '#e05a3a', trim: '#f6c26b' },
    pickle: { body: '#5fae4e', trim: '#cfe6a5' },
    egg: { body: '#f4ecd8', trim: '#f0c33c' },
};

function draw() {
    ctx.fillStyle = '#0d0b09';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawBackdrop();
    drawLadders();
    drawFloors();
    drawPlates();
    ingredients.forEach(drawIngredient);
    enemies.forEach(drawEnemy);
    peppers.forEach(drawPepper);
    drawPlayer();
    drawSparks();
}

function drawBackdrop() {
    ctx.strokeStyle = 'rgba(255, 214, 150, 0.05)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(c * TILE + 0.5, 0);
        ctx.lineTo(c * TILE + 0.5, CANVAS_H);
        ctx.stroke();
    }
}

function drawFloors() {
    for (const r of FLOOR_ROWS) {
        const y = floorYOf(r);
        const x0 = FLOOR_MIN_COL * TILE;
        const w = (FLOOR_MAX_COL - FLOOR_MIN_COL + 1) * TILE;
        ctx.fillStyle = '#4a3a28';
        ctx.fillRect(x0, y, w, 6);
        ctx.fillStyle = '#8d7247';
        ctx.fillRect(x0, y, w, 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        for (let x = x0; x < x0 + w; x += 8) ctx.fillRect(x + 3, y + 3, 2, 3);
    }
}

function drawLadders() {
    for (const seg of LADDER_SEGMENTS) {
        for (const c of seg.cols) {
            const x = c * TILE;
            const yTop = floorYOf(seg.top);
            const yBot = floorYOf(seg.bottom);
            ctx.fillStyle = '#6f5a3c';
            ctx.fillRect(x + 6, yTop, 3, yBot - yTop + 6);
            ctx.fillRect(x + TILE - 9, yTop, 3, yBot - yTop + 6);
            ctx.fillStyle = '#8d7247';
            for (let y = yTop + 8; y < yBot; y += 10) ctx.fillRect(x + 6, y, TILE - 12, 2);
        }
    }
}

function drawPlates() {
    const y = floorYOf(PLATE_ROW) + 3;
    for (let s = 0; s < STACK_COLS.length; s++) {
        const cx = stackX(s) + (STACK_W * TILE) / 2;
        ctx.fillStyle = '#cfd6dd';
        ctx.beginPath();
        ctx.ellipse(cx, y, STACK_W * TILE * 0.46, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9fa9b3';
        ctx.beginPath();
        ctx.ellipse(cx, y + 3, STACK_W * TILE * 0.46, 6, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawIngredient(ing) {
    const style = ING_STYLE[ing.kind];
    const x0 = stackX(ing.stack);
    const segW = TILE;
    for (let s = 0; s < STACK_W; s++) {
        const pressed = ing.state === 'rest' && ing.segs[s];
        const x = x0 + s * segW;
        const y = ing.y + (pressed ? 4 : 0);
        ctx.fillStyle = style.edge;
        ctx.fillRect(x, y, segW, ING_H);
        ctx.fillStyle = style.fill;
        ctx.fillRect(x, y, segW, ING_H - 3);

        if (ing.kind === 'bunTop') {
            ctx.fillStyle = '#f3c37e';
            ctx.beginPath();
            ctx.ellipse(x + segW / 2, y + 2, segW / 2, 5, 0, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = '#fff3d6';
            ctx.fillRect(x + 8, y - 1, 3, 2);
            ctx.fillRect(x + 20, y + 1, 3, 2);
        } else if (ing.kind === 'lettuce') {
            ctx.fillStyle = '#8ed47f';
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.arc(x + 6 + i * 10, y + 2, 4, Math.PI, 0);
                ctx.fill();
            }
        } else if (ing.kind === 'patty') {
            ctx.fillStyle = '#6d4229';
            for (let i = 0; i < 3; i++) ctx.fillRect(x + 5 + i * 9, y + 3, 4, 2);
        }
    }
}

function drawPlayer() {
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) return;
    const x = player.x;
    const y = player.y;
    const bob = player.mode === 'ladder' ? 0 : Math.sin(player.walk / 9) * 1.5;

    // legs — the feet sit exactly on the girder line, never through it
    const swing = Math.sin(player.walk / 7) * 4;
    const lift = Math.max(0, swing);
    ctx.fillStyle = '#3d5a8a';
    ctx.fillRect(x - 7, y - 10, 5, 10 - lift);
    ctx.fillRect(x + 2, y - 10, 5, 10 - Math.max(0, -swing));
    // apron / body
    ctx.fillStyle = '#f4f0e6';
    ctx.fillRect(x - 9, y - 24 + bob, 18, 15);
    ctx.fillStyle = '#e0553d';
    ctx.fillRect(x - 9, y - 16 + bob, 18, 3);
    // head
    ctx.fillStyle = '#f0c9a0';
    ctx.fillRect(x - 6, y - 32 + bob, 12, 9);
    // hat
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 8, y - 38 + bob, 16, 6);
    ctx.beginPath();
    ctx.arc(x - 4, y - 38 + bob, 4, 0, Math.PI * 2);
    ctx.arc(x + 4, y - 38 + bob, 4, 0, Math.PI * 2);
    ctx.fill();
    // eyes
    ctx.fillStyle = '#2b1d12';
    ctx.fillRect(x + (player.face > 0 ? 1 : -4), y - 29 + bob, 2, 3);
    ctx.fillRect(x + (player.face > 0 ? -3 : 2), y - 29 + bob, 2, 3);
}

function drawEnemy(e) {
    const style = ENEMY_STYLE[e.kind];
    const x = e.x;
    const y = e.y;

    if (e.squashed) {
        ctx.fillStyle = style.body;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x - 12, y - 5, 24, 5);
        ctx.globalAlpha = 1;
        return;
    }

    const bob = Math.sin(e.wobble / 8) * 1.5;
    ctx.fillStyle = style.body;
    if (e.kind === 'egg') {
        ctx.beginPath();
        ctx.ellipse(x, y - 11 + bob, 10, 12, 0, 0, Math.PI * 2);
        ctx.fill();
    } else {
        roundRect(x - 11, y - 22 + bob, 22, 22, 8);
        ctx.fill();
    }
    ctx.fillStyle = style.trim;
    if (e.kind === 'hotdog') {
        ctx.fillRect(x - 11, y - 16 + bob, 22, 4);
    } else if (e.kind === 'pickle') {
        for (let i = 0; i < 3; i++) ctx.fillRect(x - 7 + i * 6, y - 18 + bob, 3, 3);
    } else {
        ctx.beginPath();
        ctx.arc(x, y - 11 + bob, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    // eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 7, y - 18 + bob, 5, 5);
    ctx.fillRect(x + 2, y - 18 + bob, 5, 5);
    ctx.fillStyle = '#20140c';
    ctx.fillRect(x - 6, y - 17 + bob, 2, 3);
    ctx.fillRect(x + 3, y - 17 + bob, 2, 3);

    if (e.stun > 0) {
        ctx.fillStyle = '#ffe066';
        for (let i = 0; i < 3; i++) {
            const a = e.stun * 5 + (i * Math.PI * 2) / 3;
            ctx.fillRect(x + Math.cos(a) * 11 - 1, y - 28 + Math.sin(a) * 4, 3, 3);
        }
    }
}

function drawPepper(p) {
    const alpha = Math.max(0, p.life / PEPPER_LIFE);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#e8e2d2';
    for (let i = 0; i < 22; i++) {
        const px = p.x + ((i * 37) % p.w);
        const py = p.y + ((i * 53) % p.h);
        ctx.fillRect(px, py, 2, 2);
    }
    ctx.globalAlpha = 1;
}

function drawSparks() {
    for (const s of sparks) {
        ctx.globalAlpha = Math.max(0, s.life * 2);
        ctx.fillStyle = s.color;
        ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
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
    updateSparks(dt);
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
    const held = (keys) => keys.some((k) => heldKeys.has(k));
    setPlayerDir(
        (held(RIGHT_KEYS) ? 1 : 0) - (held(LEFT_KEYS) ? 1 : 0),
        (held(DOWN_KEYS) ? 1 : 0) - (held(UP_KEYS) ? 1 : 0)
    );
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'levelclear') nextLevel();
        else if (state === 'running') sprayPepper();
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
    else if (state === 'levelclear') nextLevel();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
state = 'idle';
resetLevel();
updateHud();
requestAnimationFrame(frame);
