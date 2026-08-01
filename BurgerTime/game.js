// ---------------------------------------------------------------------------
// Burger Time — a platform-and-ladder arcade game on an HTML5 canvas.
//
// Chef Pepper runs five platforms joined by ladders. Walking the whole length of
// a burger ingredient knocks it down one level; knock every ingredient of a
// column onto the plate below and the burger is built. Food enemies hunt the
// chef along the same lattice; pepper stuns them and falling ingredients squash
// them.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom, Snake
// and Tetris in this repo. All motion is expressed per-second and advanced
// through `step(dt)` in fixed sub-steps, so tests can simulate frames
// deterministically without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Tile lattice ---
const TILE = 30;
const COLS = 21;
const ROWS = 16;
const CANVAS_W = COLS * TILE;   // 630
const CANVAS_H = ROWS * TILE;   // 480

const FLOOR_ROWS = [2, 5, 8, 11, 14];   // tile rows carrying a platform
const LADDER_COLS = [0, 5, 10, 15, 20]; // tile columns carrying a ladder
const PLATE_ROW = FLOOR_ROWS[FLOOR_ROWS.length - 1];
const TOP_ROW = FLOOR_ROWS[0];

// --- Burgers ---
const BURGER_COLS = [1, 6, 11, 16];     // left tile column of each burger
const INGREDIENT_TILES = 4;
const INGREDIENT_W = INGREDIENT_TILES * TILE;
const INGREDIENT_H = 10;
// Ingredient kinds, top of the screen downwards, so a finished stack reads
// bottom bun / patty / lettuce / top bun from the plate up.
const INGREDIENT_KINDS = [
    { row: 2, type: 'topbun', color: '#d9963f', edge: '#a76d24' },
    { row: 5, type: 'lettuce', color: '#63b34a', edge: '#3f7c2c' },
    { row: 8, type: 'patty', color: '#8a4a26', edge: '#5c2f16' },
    { row: 11, type: 'bottombun', color: '#c78538', edge: '#96601f' },
];

// --- Actors ---
const CHEF_SPEED = 110;   // px/s
const CHEF_W = 18;
const CHEF_H = 26;
const ENEMY_BASE = 62;    // px/s on level 1
const ENEMY_STEP = 8;     // px/s added per level
const ENEMY_W = 20;
const ENEMY_H = 24;
const HIT_X = 14;         // chef/enemy overlap box
const HIT_Y = 18;
const SNAP_TOL = TILE * 0.6;
const FALL_SPEED = 180;

// --- Rules ---
const START_LIVES = 3;
const START_PEPPERS = 5;
const STUN_TIME = 4;
const PEPPER_LIFE = 0.45;
const PEPPER_W = TILE * 1.6;
const RESPAWN_DELAY = 4;
const POINTS_LAND = 50;
const POINTS_SQUASH = 100;
const POINTS_BURGER = 500;
const POINTS_LEVEL = 1000;

const ENEMY_TYPES = [
    { type: 'hotdog', color: '#e2574c', edge: '#8f2f28' },
    { type: 'egg', color: '#f6f0e2', edge: '#d8c9a6' },
    { type: 'pickle', color: '#7fbf3f', edge: '#4d7c26' },
];

// Where enemies come from — lattice nodes far from the chef's starting corner.
const SPAWNS = [
    { col: 0, row: 2 },
    { col: 20, row: 2 },
    { col: 10, row: 2 },
    { col: 5, row: 5 },
    { col: 15, row: 5 },
];

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
// state: 'idle' | 'running' | 'paused' | 'levelclear' | 'over'
let state = 'idle';
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let peppers = START_PEPPERS;
// How often an enemy takes a non-optimal turn. Tests set this to 0 to make
// chasing deterministic.
let enemyRandomChance = 0.12;

const chef = { x: 0, y: 0, facing: 1, want: { dx: 0, dy: 0 }, walkPhase: 0 };
const ingredients = [];
const plates = [[], [], [], []];
const enemies = [];
const respawns = [];
const clouds = [];

// ---------------------------------------------------------------------------
// Lattice helpers
// ---------------------------------------------------------------------------

function floorY(row) { return row * TILE; }
function ladderX(col) { return col * TILE + TILE / 2; }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

const MIN_X = ladderX(LADDER_COLS[0]);
const MAX_X = ladderX(LADDER_COLS[LADDER_COLS.length - 1]);
const MIN_Y = floorY(TOP_ROW);
const MAX_Y = floorY(PLATE_ROW);

// Row whose walk line is within snapping distance of `y` (null when between).
function alignedFloorRow(y, tol) {
    const t = tol == null ? SNAP_TOL : tol;
    for (const r of FLOOR_ROWS) if (Math.abs(y - floorY(r)) <= t) return r;
    return null;
}

// Ladder column whose centre line is within snapping distance of `x`.
function alignedLadderCol(x, tol) {
    const t = tol == null ? SNAP_TOL : tol;
    for (const c of LADDER_COLS) if (Math.abs(x - ladderX(c)) <= t) return c;
    return null;
}

function nextFloorRowBelow(row) {
    for (const r of FLOOR_ROWS) if (r > row) return r;
    return null;
}

function enemySpeed() { return ENEMY_BASE + (level - 1) * ENEMY_STEP; }
function enemyCount() { return Math.min(5, 2 + level); }

// ---------------------------------------------------------------------------
// Board setup
// ---------------------------------------------------------------------------

function buildBoard() {
    ingredients.length = 0;
    for (let b = 0; b < BURGER_COLS.length; b++) {
        plates[b] = [];
        for (const kind of INGREDIENT_KINDS) {
            ingredients.push({
                burger: b,
                col: BURGER_COLS[b],
                row: kind.row,
                y: floorY(kind.row),
                type: kind.type,
                color: kind.color,
                edge: kind.edge,
                segs: new Array(INGREDIENT_TILES).fill(false),
                state: 'rest',
                onPlate: false,
                destRow: null,
            });
        }
    }
}

function makeEnemy(index) {
    const spawn = SPAWNS[index % SPAWNS.length];
    const kind = ENEMY_TYPES[index % ENEMY_TYPES.length];
    return {
        x: ladderX(spawn.col),
        y: floorY(spawn.row),
        dx: 0,
        dy: 0,
        stun: 0,
        type: kind.type,
        color: kind.color,
        edge: kind.edge,
        spawn: index,
    };
}

function spawnEnemies() {
    enemies.length = 0;
    respawns.length = 0;
    for (let i = 0; i < enemyCount(); i++) enemies.push(makeEnemy(i));
}

function placeChef() {
    chef.x = ladderX(10);
    chef.y = floorY(PLATE_ROW);
    chef.facing = 1;
    chef.want = { dx: 0, dy: 0 };
    chef.walkPhase = 0;
}

// Put the actors back at their starting posts without touching the burgers.
function resetActors() {
    placeChef();
    for (let i = 0; i < enemies.length; i++) {
        const spawn = SPAWNS[enemies[i].spawn % SPAWNS.length];
        enemies[i].x = ladderX(spawn.col);
        enemies[i].y = floorY(spawn.row);
        enemies[i].dx = 0;
        enemies[i].dy = 0;
        enemies[i].stun = 0;
    }
    clouds.length = 0;
}

// ---------------------------------------------------------------------------
// Movement — shared by the chef and the enemies
// ---------------------------------------------------------------------------

// Walk horizontally when on a walk line, or climb when on a ladder; either way
// the entity is snapped onto the lattice first. Returns true when it moved.
function moveEntity(e, dx, dy, speed, h) {
    if (dx !== 0) {
        const row = alignedFloorRow(e.y);
        if (row === null) return false;
        e.y = floorY(row);
        e.x = clamp(e.x + dx * speed * h, MIN_X, MAX_X);
        return true;
    }
    if (dy !== 0) {
        const col = alignedLadderCol(e.x);
        if (col === null) return false;
        e.x = ladderX(col);
        e.y = clamp(e.y + dy * speed * h, MIN_Y, MAX_Y);
        return true;
    }
    return false;
}

// Record the direction the player wants; it is applied when it becomes legal.
function moveChef(dx, dy) {
    chef.want = { dx: dx || 0, dy: dy || 0 };
}

function updateChef(h) {
    let moved = false;
    if (chef.want.dx !== 0 && moveEntity(chef, chef.want.dx, 0, CHEF_SPEED, h)) {
        chef.facing = chef.want.dx;
        moved = true;
    } else if (chef.want.dy !== 0 && moveEntity(chef, 0, chef.want.dy, CHEF_SPEED, h)) {
        moved = true;
    }
    if (moved) chef.walkPhase += h * 8;
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

// Every ingredient tile the chef is standing on gets trodden; four treads and
// the ingredient drops.
function treadIngredients() {
    for (const g of ingredients) {
        if (g.state !== 'rest' || g.onPlate) continue;
        if (Math.abs(chef.y - floorY(g.row)) > 0.5) continue;
        const rel = chef.x - g.col * TILE;
        if (rel < 0 || rel >= INGREDIENT_W) continue;
        const s = Math.floor(rel / TILE);
        if (g.segs[s]) continue;
        g.segs[s] = true;
        if (g.segs.every(Boolean)) startFall(g);
    }
}

function startFall(g) {
    if (!g || g.state !== 'rest' || g.onPlate) return false;
    const dest = nextFloorRowBelow(g.row);
    if (dest === null) return false;
    g.state = 'falling';
    g.destRow = dest;
    g.segs.fill(true);
    return true;
}

function plateLandingY(burger) {
    return floorY(PLATE_ROW) - plates[burger].length * INGREDIENT_H;
}

function squashEnemies(g) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        const left = g.col * TILE - 4;
        const right = left + INGREDIENT_W + 8;
        if (e.x >= left && e.x <= right && Math.abs(e.y - g.y) <= TILE * 0.7) {
            enemies.splice(i, 1);
            respawns.push({ spawn: e.spawn, t: RESPAWN_DELAY });
            score += POINTS_SQUASH;
        }
    }
}

function land(g, destY) {
    g.y = destY;
    g.row = g.destRow;
    g.state = 'rest';
    g.destRow = null;
    score += POINTS_LAND;

    if (g.row === PLATE_ROW) {
        g.onPlate = true;
        g.segs.fill(true);
        plates[g.burger].push(g);
        if (plates[g.burger].length === INGREDIENT_KINDS.length) score += POINTS_BURGER;
        if (allBurgersComplete()) completeLevel();
        return;
    }

    // An ingredient already resting here is knocked down one more level.
    const occupant = ingredients.find((o) => o !== g && o.burger === g.burger
        && o.state === 'rest' && !o.onPlate && o.row === g.row);
    if (occupant) startFall(occupant);
    g.segs.fill(false);
}

function updateIngredients(h) {
    // Lowest first, so a piece arriving on a plate always stacks below the one
    // chasing it down.
    const falling = ingredients.filter((g) => g.state === 'falling').sort((a, b) => b.y - a.y);
    for (const g of falling) {
        g.y += FALL_SPEED * h;
        squashEnemies(g);
        const destY = g.destRow === PLATE_ROW ? plateLandingY(g.burger) : floorY(g.destRow);
        if (g.y >= destY) land(g, destY);
    }
}

function burgerComplete(index) {
    return plates[index].length === INGREDIENT_KINDS.length;
}

function allBurgersComplete() {
    return plates.every((p) => p.length === INGREDIENT_KINDS.length);
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

// Called at lattice intersections: score every legal exit by how close it gets
// to the chef and take the best, with an occasional deliberate mistake.
function decideEnemy(e) {
    const onFloor = alignedFloorRow(e.y, 0.001) !== null;
    const onLadder = alignedLadderCol(e.x, 0.001) !== null;
    const options = [];
    if (onFloor) {
        if (e.x > MIN_X + 1e-9) options.push({ dx: -1, dy: 0 });
        if (e.x < MAX_X - 1e-9) options.push({ dx: 1, dy: 0 });
    }
    if (onLadder) {
        if (e.y > MIN_Y + 1e-9) options.push({ dx: 0, dy: -1 });
        if (e.y < MAX_Y - 1e-9) options.push({ dx: 0, dy: 1 });
    }
    if (!options.length) { e.dx = 0; e.dy = 0; return; }

    const forward = options.filter((o) => !(o.dx === -e.dx && o.dy === -e.dy));
    const pool = forward.length ? forward : options;

    let pick = pool[0];
    if (Math.random() < enemyRandomChance) {
        pick = pool[Math.floor(Math.random() * pool.length)];
    } else {
        let bestDist = Infinity;
        for (const o of pool) {
            const d = Math.hypot(e.x + o.dx * TILE - chef.x, e.y + o.dy * TILE - chef.y);
            if (d < bestDist) { bestDist = d; pick = o; }
        }
    }
    e.dx = pick.dx;
    e.dy = pick.dy;
}

// Enemies travel between lattice nodes and re-decide on arrival, so they always
// land exactly on the lattice however large the time slice is.
function updateEnemy(e, h) {
    if (e.stun > 0) { e.stun = Math.max(0, e.stun - h); return; }
    if (e.dx === 0 && e.dy === 0) decideEnemy(e);

    let remaining = enemySpeed() * h;
    let guard = 0;
    while (remaining > 1e-9 && guard++ < 8) {
        if (e.dx !== 0) {
            const lanes = LADDER_COLS.map(ladderX)
                .filter((lx) => (e.dx > 0 ? lx > e.x + 1e-9 : lx < e.x - 1e-9));
            if (!lanes.length) { decideEnemy(e); if (e.dx === 0 && e.dy === 0) break; continue; }
            const next = e.dx > 0 ? Math.min.apply(null, lanes) : Math.max.apply(null, lanes);
            const d = Math.abs(next - e.x);
            if (d <= remaining) { e.x = next; remaining -= d; decideEnemy(e); }
            else { e.x += e.dx * remaining; remaining = 0; }
        } else if (e.dy !== 0) {
            const lines = FLOOR_ROWS.map(floorY)
                .filter((fy) => (e.dy > 0 ? fy > e.y + 1e-9 : fy < e.y - 1e-9));
            if (!lines.length) { decideEnemy(e); if (e.dx === 0 && e.dy === 0) break; continue; }
            const next = e.dy > 0 ? Math.min.apply(null, lines) : Math.max.apply(null, lines);
            const d = Math.abs(next - e.y);
            if (d <= remaining) { e.y = next; remaining -= d; decideEnemy(e); }
            else { e.y += e.dy * remaining; remaining = 0; }
        } else {
            break;
        }
    }
}

function updateRespawns(h) {
    for (let i = respawns.length - 1; i >= 0; i--) {
        respawns[i].t -= h;
        if (respawns[i].t <= 0) {
            enemies.push(makeEnemy(respawns[i].spawn));
            respawns.splice(i, 1);
        }
    }
}

// A stunned enemy is harmless — the chef can walk straight past it.
function checkEnemyCollisions() {
    for (const e of enemies) {
        if (e.stun > 0) continue;
        if (Math.abs(e.x - chef.x) < HIT_X && Math.abs(e.y - chef.y) < HIT_Y) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function applyPepper(cloud) {
    for (const e of enemies) {
        if (e.x >= cloud.x && e.x <= cloud.x + cloud.w
            && e.y >= cloud.y && e.y <= cloud.y + cloud.h) {
            e.stun = STUN_TIME;
            e.dx = 0;
            e.dy = 0;
        }
    }
}

function usePepper() {
    if (state !== 'running' || peppers <= 0) return false;
    peppers -= 1;
    const cloud = {
        x: chef.facing > 0 ? chef.x + 4 : chef.x - 4 - PEPPER_W,
        y: chef.y - TILE,
        w: PEPPER_W,
        h: TILE,
        life: PEPPER_LIFE,
    };
    clouds.push(cloud);
    applyPepper(cloud);
    updateHud();
    return true;
}

function updateClouds(h) {
    for (let i = clouds.length - 1; i >= 0; i--) {
        applyPepper(clouds[i]);
        clouds[i].life -= h;
        if (clouds[i].life <= 0) clouds.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    updateChef(h);
    treadIngredients();
    updateIngredients(h);
    if (state !== 'running') return;
    for (const e of enemies) updateEnemy(e, h);
    updateClouds(h);
    updateRespawns(h);
    checkEnemyCollisions();
}

// Advance the world by `dt` seconds in fixed sub-steps, so nothing is skipped
// over and the result does not depend on the frame rate.
function step(dt) {
    if (state !== 'running') return;
    const SUB = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-6) {
        const h = Math.min(SUB, remaining);
        substep(h);
        remaining -= h;
        if (state !== 'running') break;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    lives = START_LIVES;
    level = 1;
    peppers = START_PEPPERS;
    buildBoard();
    spawnEnemies();
    resetActors();
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    peppers = START_PEPPERS;
    buildBoard();
    spawnEnemies();
    resetActors();
    state = 'running';
    hideOverlay();
    updateHud();
}

function completeLevel() {
    if (state !== 'running') return;
    state = 'levelclear';
    score += POINTS_LEVEL * level;
    saveBest();
    showOverlay('Level ' + level + ' Cleared', 'Score ' + score,
        'Press Space for level ' + (level + 1), 'Next Level');
    updateHud();
}

function loseLife() {
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        endGame();
        return;
    }
    resetActors();
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    saveBest();
    showOverlay('Game Over', 'Score ' + score + ' · Level ' + level,
        'Press Enter to cook again', 'Play Again');
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

function saveBest() {
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (e) { /* ignore */ }
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    peppersEl.textContent = String(peppers);
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

function drawBoard() {
    ctx.fillStyle = '#0b0705';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Ladders behind the platforms.
    for (const c of LADDER_COLS) {
        const x = ladderX(c);
        ctx.strokeStyle = '#5c6b7a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 9, MIN_Y);
        ctx.lineTo(x - 9, MAX_Y);
        ctx.moveTo(x + 9, MIN_Y);
        ctx.lineTo(x + 9, MAX_Y);
        ctx.stroke();
        for (let y = MIN_Y + 8; y < MAX_Y; y += 12) {
            ctx.beginPath();
            ctx.moveTo(x - 9, y);
            ctx.lineTo(x + 9, y);
            ctx.stroke();
        }
    }

    // Platforms.
    for (const r of FLOOR_ROWS) {
        const y = floorY(r);
        ctx.fillStyle = '#8fa3b8';
        ctx.fillRect(0, y, CANVAS_W, 4);
        ctx.fillStyle = '#4c5c6e';
        ctx.fillRect(0, y + 4, CANVAS_W, 3);
    }

    // Plates.
    for (let b = 0; b < BURGER_COLS.length; b++) {
        const x = BURGER_COLS[b] * TILE;
        const y = floorY(PLATE_ROW) + 14;
        ctx.fillStyle = '#e9e2d4';
        ctx.beginPath();
        ctx.ellipse(x + INGREDIENT_W / 2, y, INGREDIENT_W / 2 + 6, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#c3b9a5';
        ctx.fillRect(x - 4, y, INGREDIENT_W + 8, 4);
    }
}

function drawIngredient(g) {
    const x = g.col * TILE;
    for (let s = 0; s < INGREDIENT_TILES; s++) {
        // A trodden segment sags a little, the way the arcade sprite does.
        const sag = g.state === 'rest' && !g.onPlate && g.segs[s] ? 4 : 0;
        const top = g.y - INGREDIENT_H + sag;
        ctx.fillStyle = g.color;
        ctx.fillRect(x + s * TILE, top, TILE, INGREDIENT_H);
        ctx.fillStyle = g.edge;
        ctx.fillRect(x + s * TILE, top + INGREDIENT_H - 3, TILE, 3);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + s * TILE + 0.5, top + 0.5, TILE - 1, INGREDIENT_H - 1);
    }
}

function drawChef() {
    const x = chef.x, y = chef.y;
    const bob = Math.sin(chef.walkPhase) * 1.5;
    // Legs.
    ctx.fillStyle = '#2f3b52';
    ctx.fillRect(x - 7, y - 8, 5, 8);
    ctx.fillRect(x + 2, y - 8, 5, 8);
    // Body.
    ctx.fillStyle = '#f3e7d8';
    ctx.fillRect(x - CHEF_W / 2, y - CHEF_H + bob, CHEF_W, CHEF_H - 8);
    ctx.fillStyle = '#e2574c';
    ctx.fillRect(x - CHEF_W / 2, y - CHEF_H + 10 + bob, CHEF_W, 3);
    // Head and hat.
    ctx.fillStyle = '#f0c9a0';
    ctx.fillRect(x - 6, y - CHEF_H - 7 + bob, 12, 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 8, y - CHEF_H - 15 + bob, 16, 8);
    // Nose points where the chef faces.
    ctx.fillStyle = '#c98f63';
    ctx.fillRect(x + (chef.facing > 0 ? 5 : -8), y - CHEF_H - 4 + bob, 3, 3);
}

function drawEnemy(e) {
    const x = e.x, y = e.y;
    ctx.fillStyle = e.stun > 0 ? '#7c8794' : e.color;
    ctx.fillRect(x - ENEMY_W / 2, y - ENEMY_H, ENEMY_W, ENEMY_H);
    ctx.fillStyle = e.edge;
    ctx.fillRect(x - ENEMY_W / 2, y - 4, ENEMY_W, 4);
    ctx.fillStyle = '#101010';
    ctx.fillRect(x - 6, y - ENEMY_H + 5, 4, 4);
    ctx.fillRect(x + 2, y - ENEMY_H + 5, 4, 4);
    if (e.stun > 0) {
        ctx.strokeStyle = '#f2b134';
        ctx.beginPath();
        ctx.arc(x, y - ENEMY_H - 6, 5, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawClouds() {
    for (const c of clouds) {
        ctx.globalAlpha = Math.max(0, Math.min(1, c.life / PEPPER_LIFE));
        ctx.fillStyle = '#d9d2c4';
        for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            ctx.arc(c.x + (i + 0.5) * (c.w / 5), c.y + c.h / 2 + (i % 2 ? -4 : 4), 7, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

function draw() {
    drawBoard();
    for (const g of ingredients) drawIngredient(g);
    for (const e of enemies) drawEnemy(e);
    drawChef();
    drawClouds();

    // Remaining lives as little chef hats in the corner.
    for (let i = 0; i < lives; i++) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(8 + i * 16, 8, 12, 8);
    }
}

// ---------------------------------------------------------------------------
// Main loop — physics runs through the same `step()` the tests use.
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

const DIRS = {
    ArrowLeft: { dx: -1, dy: 0 }, a: { dx: -1, dy: 0 }, A: { dx: -1, dy: 0 },
    ArrowRight: { dx: 1, dy: 0 }, d: { dx: 1, dy: 0 }, D: { dx: 1, dy: 0 },
    ArrowUp: { dx: 0, dy: -1 }, w: { dx: 0, dy: -1 }, W: { dx: 0, dy: -1 },
    ArrowDown: { dx: 0, dy: 1 }, s: { dx: 0, dy: 1 }, S: { dx: 0, dy: 1 },
};

const heldKeys = [];

// The most recently pressed direction wins, so a key held down from before does
// not fight the new one.
function refreshDirection() {
    for (let i = heldKeys.length - 1; i >= 0; i--) {
        const dir = DIRS[heldKeys[i]];
        if (dir) { moveChef(dir.dx, dir.dy); return; }
    }
    moveChef(0, 0);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'levelclear') nextLevel();
        else if (state === 'running') usePepper();
        return;
    }
    if (DIRS[e.key]) {
        if (heldKeys.indexOf(e.key) === -1) heldKeys.push(e.key);
        refreshDirection();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const i = heldKeys.indexOf(e.key);
    if (i !== -1) {
        heldKeys.splice(i, 1);
        refreshDirection();
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

best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0;
buildBoard();
placeChef();
updateHud();
requestAnimationFrame(frame);
