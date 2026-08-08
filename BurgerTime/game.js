// ---------------------------------------------------------------------------
// Burger Time — a ladder-and-platform arcade game on an HTML5 canvas.
//
// A chef runs across four floors joined by ladders. Walking the full width of a
// burger layer flips it and makes it fall one floor; keep flipping until every
// layer lands on the plate at the bottom of its column. Food monsters chase the
// chef through the same floors; pepper stuns them and falling layers squash
// them.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Frostbite and Snake in this repo. All motion is expressed per second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing. Nothing in the
// simulation — monster AI included — uses randomness.
// ---------------------------------------------------------------------------

// --- Board geometry ---
const CANVAS_W = 640;
const CANVAS_H = 600;
const FLOOR_ROWS = 4;
const FLOOR_Y = [110, 230, 350, 470];   // y of each floor's walking surface
const FLOOR_H = 7;                      // drawn thickness of a floor
const PLATE_Y = 580;                    // surface the finished burgers rest on

// --- Burger layers ---
const ING_W = 96;
const ING_H = 16;
const ING_SEGS = 4;
const SEG_W = ING_W / ING_SEGS;
const BURGER_X = [32, 192, 352, 512];   // left edge of each burger column
const ING_TYPES = ['bunTop', 'lettuce', 'patty', 'bunBottom'];
const TOTAL_INGREDIENTS = BURGER_X.length * ING_TYPES.length;
const FALL_SPEED = 170;

// --- Ladders: each entry joins `row` to `row + 1` ---
const LADDERS = [
    { x: 160, row: 0 }, { x: 480, row: 0 },
    { x: 16, row: 1 }, { x: 320, row: 1 }, { x: 624, row: 1 },
    { x: 160, row: 2 }, { x: 480, row: 2 },
];
const LADDER_W = 26;
const LADDER_SNAP = 14;                 // how close the chef must be to climb

// --- Chef ---
const CHEF_W = 20;
const CHEF_H = 30;
const CHEF_SPEED = 115;
const CLIMB_SPEED = 95;
const CHEF_SPAWN = { x: 320, row: FLOOR_ROWS - 1 };

// --- Monsters ---
const ENEMY_W = 22;
const ENEMY_H = 26;
const ENEMY_BASE_SPEED = 62;
const ENEMY_SPEED_STEP = 8;
const ENEMY_MIN = 2;
const ENEMY_MAX = 5;
// Spawn points alternate between the top and the bottom floor, so a monster
// coming back from a squashing never all pile onto the floor the player is
// working on.
const ENEMY_SPAWNS = [
    { x: 16, row: 0 }, { x: 624, row: 0 },
    { x: 16, row: FLOOR_ROWS - 1 }, { x: 624, row: FLOOR_ROWS - 1 },
    { x: 320, row: 0 },
];
const RESPAWN_TIME = 3;
const STUN_TIME = 4;

// --- Pepper ---
const START_PEPPER = 5;
const PEPPER_TIME = 0.35;
const PEPPER_W = 44;
const PEPPER_H = 30;
const PEPPER_OFFSET = 26;

// --- Rules & scoring ---
const START_LIVES = 3;
const DROP_POINTS = 50;
const PLATE_POINTS = 150;
const PEPPER_POINTS = 100;
const SQUASH_POINTS = 500;
const LEVEL_BONUS = 1000;

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
let state, score, best, level, lives, pepper;
let pendingLevelClear = false;
let flashText = '';
let flashTime = 0;
let walkPhase = 0;

const chef = {
    x: CHEF_SPAWN.x,
    y: FLOOR_Y[CHEF_SPAWN.row],
    row: CHEF_SPAWN.row,
    mode: 'floor',                      // 'floor' | 'ladder'
    ladder: null,
    dirX: 0,
    dirY: 0,
    facing: 1,
};

const ingredients = [];
const enemies = [];
const clouds = [];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function floorY(row) { return FLOOR_Y[clamp(row, 0, FLOOR_ROWS - 1)]; }

function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function chefRect() {
    return { x: chef.x - CHEF_W / 2, y: chef.y - CHEF_H, w: CHEF_W, h: CHEF_H };
}

function enemyRect(e) {
    return { x: e.x - ENEMY_W / 2, y: e.y - ENEMY_H, w: ENEMY_W, h: ENEMY_H };
}

function ingredientRect(ing) {
    return { x: BURGER_X[ing.col], y: ing.y, w: ING_W, h: ING_H };
}

// A ladder leading out of `row`: dir -1 climbs up (it joins row-1 to row),
// dir +1 climbs down (it joins row to row+1).
function ladderAt(x, row, dir) {
    const wanted = dir < 0 ? row - 1 : row;
    return LADDERS.find((l) => l.row === wanted && Math.abs(l.x - x) <= LADDER_SNAP) || null;
}

// The ladder out of `row` in direction `dir` that is closest to `x`.
function nearestLadder(x, row, dir) {
    const wanted = dir < 0 ? row - 1 : row;
    let best = null;
    for (const l of LADDERS) {
        if (l.row !== wanted) continue;
        if (!best || Math.abs(l.x - x) < Math.abs(best.x - x)) best = l;
    }
    return best;
}

// Monsters alternate between two routing habits so a pack does not collapse
// onto a single ladder: even-indexed monsters take the ladder nearest to
// themselves (the impatient ones), odd-indexed monsters take the ladder nearest
// to the chef (the ones that try to cut him off). Both are deterministic.
function chooseLadder(e, dir) {
    const anchor = e.spawnIndex % 2 === 0 ? e.x : chef.x;
    return nearestLadder(anchor, e.row, dir);
}

// ---------------------------------------------------------------------------
// Difficulty (pure functions of `level`)
// ---------------------------------------------------------------------------

function enemySpeed() { return ENEMY_BASE_SPEED + (level - 1) * ENEMY_SPEED_STEP; }
function enemyCount() { return Math.min(ENEMY_MAX, ENEMY_MIN + level - 1); }

// ---------------------------------------------------------------------------
// Level building
// ---------------------------------------------------------------------------

function buildIngredients() {
    ingredients.length = 0;
    for (let col = 0; col < BURGER_X.length; col++) {
        for (let row = 0; row < ING_TYPES.length; row++) {
            ingredients.push({
                col,
                row,
                type: ING_TYPES[row],
                segs: [false, false, false, false],
                y: floorY(row) - ING_H,
                falling: false,
                plated: false,
                toPlate: false,
                targetRow: null,
                squashed: 0,
            });
        }
    }
}

function spawnEnemy(opts) {
    opts = opts || {};
    const row = opts.row != null ? opts.row : 0;
    const index = opts.spawnIndex != null ? opts.spawnIndex : enemies.length;
    const enemy = {
        x: opts.x != null ? opts.x : ENEMY_SPAWNS[index % ENEMY_SPAWNS.length].x,
        y: floorY(row),
        row,
        mode: 'floor',
        ladder: null,
        climbDir: 0,
        kind: opts.kind != null ? opts.kind : index % 3,
        spawnIndex: index,
        facing: 1,
        stun: 0,
        dead: false,
        respawn: 0,
    };
    enemies.push(enemy);
    return enemy;
}

function buildEnemies() {
    enemies.length = 0;
    const n = enemyCount();
    for (let i = 0; i < n; i++) {
        const spot = ENEMY_SPAWNS[i % ENEMY_SPAWNS.length];
        spawnEnemy({ x: spot.x, row: spot.row, spawnIndex: i, kind: i % 3 });
    }
}

function placeEnemy(e) {
    const spot = ENEMY_SPAWNS[e.spawnIndex % ENEMY_SPAWNS.length];
    e.x = spot.x;
    e.row = spot.row;
    e.y = floorY(spot.row);
    e.mode = 'floor';
    e.ladder = null;
    e.climbDir = 0;
    e.dead = false;
    e.respawn = 0;
    e.stun = 0;
}

// Send the chef and every monster back to their starting spots. Layer progress
// is deliberately kept: losing a life costs time, not work.
function resetPositions() {
    chef.x = CHEF_SPAWN.x;
    chef.row = CHEF_SPAWN.row;
    chef.y = floorY(CHEF_SPAWN.row);
    chef.mode = 'floor';
    chef.ladder = null;
    chef.dirX = 0;
    chef.dirY = 0;
    chef.facing = 1;
    enemies.forEach(placeEnemy);
    clouds.length = 0;
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function setChefDir(dx, dy) {
    chef.dirX = dx;
    chef.dirY = dy;
    if (dx !== 0) chef.facing = dx < 0 ? -1 : 1;
}

function setChefPos(x, row) {
    chef.x = clamp(x, CHEF_W / 2, CANVAS_W - CHEF_W / 2);
    chef.row = clamp(row, 0, FLOOR_ROWS - 1);
    chef.y = floorY(chef.row);
    chef.mode = 'floor';
    chef.ladder = null;
    chef.dirX = 0;
    chef.dirY = 0;
}

function updateChef(dt) {
    if (chef.mode === 'ladder') {
        if (chef.dirY !== 0) {
            chef.y += chef.dirY * CLIMB_SPEED * dt;
            walkPhase += CLIMB_SPEED * dt;
            const topY = floorY(chef.ladder.row);
            const botY = floorY(chef.ladder.row + 1);
            if (chef.y <= topY) {
                chef.y = topY;
                chef.row = chef.ladder.row;
                chef.mode = 'floor';
                chef.ladder = null;
            } else if (chef.y >= botY) {
                chef.y = botY;
                chef.row = chef.ladder.row + 1;
                chef.mode = 'floor';
                chef.ladder = null;
            }
        }
    } else {
        if (chef.dirY !== 0) {
            const l = ladderAt(chef.x, chef.row, chef.dirY);
            if (l) {
                chef.mode = 'ladder';
                chef.ladder = l;
                chef.x = l.x;
            }
        }
        if (chef.mode === 'floor' && chef.dirX !== 0) {
            chef.x = clamp(chef.x + chef.dirX * CHEF_SPEED * dt, CHEF_W / 2, CANVAS_W - CHEF_W / 2);
            walkPhase += CHEF_SPEED * dt;
        }
    }

    if (chef.mode === 'floor') flipUnderChef();
}

// ---------------------------------------------------------------------------
// Burger layers
// ---------------------------------------------------------------------------

function ingredientAt(col, row) {
    return ingredients.find(
        (i) => i.col === col && i.row === row && !i.plated && !i.falling,
    ) || null;
}

function platedCount(col) {
    return ingredients.filter((i) => i.plated && (col == null || i.col === col)).length;
}

function allPlated() {
    return ingredients.length > 0 && ingredients.every((i) => i.plated);
}

function plateRestY(col) {
    return PLATE_Y - ING_H * (platedCount(col) + 1);
}

// Flip whichever segment the chef is standing on; a fully flipped layer drops.
function flipUnderChef() {
    const ing = ingredients.find((i) => {
        if (i.row !== chef.row || i.falling || i.plated) return false;
        const x0 = BURGER_X[i.col];
        return chef.x >= x0 && chef.x <= x0 + ING_W;
    });
    if (!ing) return;
    const seg = clamp(Math.floor((chef.x - BURGER_X[ing.col]) / SEG_W), 0, ING_SEGS - 1);
    if (ing.segs[seg]) return;
    ing.segs[seg] = true;
    if (ing.segs.every(Boolean)) dropIngredient(ing);
}

function dropIngredient(ing) {
    if (!ing || ing.falling || ing.plated) return false;
    ing.falling = true;
    ing.squashed = 0;
    ing.toPlate = ing.row >= FLOOR_ROWS - 1;
    ing.targetRow = ing.toPlate ? null : ing.row + 1;
    return true;
}

function fallTargetY(ing) {
    return ing.toPlate ? plateRestY(ing.col) : floorY(ing.targetRow) - ING_H;
}

function landIngredient(ing) {
    if (ing.toPlate) {
        ing.falling = false;
        ing.plated = true;
        score += PLATE_POINTS;
    } else {
        // Anything already resting on the target cell is bumped onward.
        const occupant = ingredientAt(ing.col, ing.targetRow);
        ing.falling = false;
        ing.row = ing.targetRow;
        ing.segs = [false, false, false, false];
        score += DROP_POINTS;
        if (occupant && occupant !== ing) dropIngredient(occupant);
    }
    ing.targetRow = null;
    if (allPlated()) pendingLevelClear = true;
}

function squashEnemies(ing) {
    const box = ingredientRect(ing);
    for (const e of enemies) {
        if (e.dead) continue;
        if (!overlaps(box, enemyRect(e))) continue;
        ing.squashed += 1;
        score += SQUASH_POINTS * ing.squashed;
        killEnemy(e);
    }
}

function updateIngredients(dt) {
    for (const ing of ingredients) {
        if (!ing.falling) continue;
        ing.y += FALL_SPEED * dt;
        squashEnemies(ing);
        const target = fallTargetY(ing);
        if (ing.y >= target) {
            ing.y = target;
            landIngredient(ing);
        }
    }
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

function killEnemy(e) {
    e.dead = true;
    e.respawn = RESPAWN_TIME;
    e.stun = 0;
    e.mode = 'floor';
    e.ladder = null;
}

function walkEnemyToward(e, targetX, speed, dt) {
    const dist = targetX - e.x;
    if (Math.abs(dist) <= speed * dt) {
        e.x = targetX;
        return true;
    }
    const dir = dist < 0 ? -1 : 1;
    e.x = clamp(e.x + dir * speed * dt, ENEMY_W / 2, CANVAS_W - ENEMY_W / 2);
    e.facing = dir;
    return false;
}

function moveEnemy(e, dt) {
    const speed = enemySpeed();

    if (e.mode === 'ladder') {
        e.y += e.climbDir * speed * dt;
        const topY = floorY(e.ladder.row);
        const botY = floorY(e.ladder.row + 1);
        if (e.climbDir < 0 && e.y <= topY) {
            e.y = topY;
            e.row = e.ladder.row;
            e.mode = 'floor';
            e.ladder = null;
        } else if (e.climbDir > 0 && e.y >= botY) {
            e.y = botY;
            e.row = e.ladder.row + 1;
            e.mode = 'floor';
            e.ladder = null;
        }
        return;
    }

    // Same floor as the chef? Walk straight at him. Otherwise head for the
    // nearest ladder that leads toward his floor and climb it.
    const wantDir = chef.row === e.row ? 0 : (chef.row < e.row ? -1 : 1);
    if (wantDir === 0) {
        walkEnemyToward(e, chef.x, speed, dt);
        return;
    }

    const l = chooseLadder(e, wantDir);
    if (!l) {
        walkEnemyToward(e, chef.x, speed, dt);
        return;
    }
    if (walkEnemyToward(e, l.x, speed, dt)) {
        e.mode = 'ladder';
        e.ladder = l;
        e.climbDir = wantDir;
    }
}

function updateEnemies(dt) {
    for (const e of enemies) {
        if (e.dead) {
            e.respawn -= dt;
            if (e.respawn <= 0) placeEnemy(e);
            continue;
        }
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - dt);
            continue;
        }
        moveEnemy(e, dt);
    }
}

function checkChefCollisions() {
    const box = chefRect();
    for (const e of enemies) {
        if (e.dead || e.stun > 0) continue;
        if (overlaps(box, enemyRect(e))) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function firePepper() {
    if (state !== 'running' || pepper <= 0) return false;
    pepper -= 1;
    clouds.push({
        x: chef.x + chef.facing * PEPPER_OFFSET,
        y: chef.y - CHEF_H / 2,
        row: chef.row,
        t: PEPPER_TIME,
    });
    updateHud();
    return true;
}

function updateClouds(dt) {
    for (let i = clouds.length - 1; i >= 0; i--) {
        const c = clouds[i];
        c.t -= dt;
        const box = { x: c.x - PEPPER_W / 2, y: c.y - PEPPER_H / 2, w: PEPPER_W, h: PEPPER_H };
        for (const e of enemies) {
            if (e.dead || e.stun > 0 || e.row !== c.row) continue;
            if (!overlaps(box, enemyRect(e))) continue;
            e.stun = STUN_TIME;
            e.mode = 'floor';
            e.ladder = null;
            score += PEPPER_POINTS;
        }
        if (c.t <= 0) clouds.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    lives = START_LIVES;
    pepper = START_PEPPER;
    pendingLevelClear = false;
    flashText = '';
    flashTime = 0;
    buildIngredients();
    buildEnemies();
    resetPositions();
    hideOverlay();
    updateHud();
}

function nextLevel() {
    score += LEVEL_BONUS * level;
    level += 1;
    pepper = START_PEPPER;
    pendingLevelClear = false;
    buildIngredients();
    buildEnemies();
    resetPositions();
    flash('LEVEL ' + level);
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
    flash('OUCH!');
    resetPositions();
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (err) { /* private mode */ }
    }
    updateHud();
    showOverlay('GAME OVER', 'Score ' + score + ' — Level ' + level, 'Press Space to cook again', 'Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', 'Score ' + score, 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function flash(text) {
    flashText = text;
    flashTime = 1.2;
}

// ---------------------------------------------------------------------------
// Simulation — the single deterministic entry point
// ---------------------------------------------------------------------------

function step(dt) {
    if (flashTime > 0) flashTime = Math.max(0, flashTime - dt);
    if (state !== 'running') return;
    updateChef(dt);
    updateIngredients(dt);
    updateClouds(dt);
    updateEnemies(dt);
    checkChefCollisions();
    if (pendingLevelClear) nextLevel();
    updateHud();
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

function showOverlay(title, sub2, sub, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub2 || '';
    overlaySub.textContent = sub;
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ING_COLORS = {
    bunTop: { face: '#e2a765', edge: '#b97c3c', dark: '#9c6530' },
    lettuce: { face: '#7bc76a', edge: '#4f9f4a', dark: '#3a7a37' },
    patty: { face: '#8a5433', edge: '#6b3f24', dark: '#4d2c17' },
    bunBottom: { face: '#d3954f', edge: '#a86c2f', dark: '#8a5726' },
};

function drawBackground() {
    ctx.fillStyle = '#120c18';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // faint kitchen tiling
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= CANVAS_W; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CANVAS_H);
        ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(CANVAS_W, y + 0.5);
        ctx.stroke();
    }

    // ceiling lamps over each burger column
    for (let col = 0; col < BURGER_X.length; col++) {
        const cx = BURGER_X[col] + ING_W / 2;
        ctx.strokeStyle = '#38304a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, 30);
        ctx.stroke();

        ctx.fillStyle = '#4a3f5e';
        ctx.beginPath();
        ctx.moveTo(cx - 16, 44);
        ctx.lineTo(cx + 16, 44);
        ctx.lineTo(cx + 7, 30);
        ctx.lineTo(cx - 7, 30);
        ctx.closePath();
        ctx.fill();

        const glow = ctx.createRadialGradient(cx, 46, 2, cx, 46, 60);
        glow.addColorStop(0, 'rgba(255, 214, 140, 0.30)');
        glow.addColorStop(1, 'rgba(255, 214, 140, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, 46, 60, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffe0a3';
        ctx.beginPath();
        ctx.arc(cx, 46, 4, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawLadders() {
    for (const l of LADDERS) {
        const top = floorY(l.row);
        const bottom = floorY(l.row + 1);
        const x0 = l.x - LADDER_W / 2;
        ctx.strokeStyle = '#6d7f9c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x0, top);
        ctx.lineTo(x0, bottom);
        ctx.moveTo(x0 + LADDER_W, top);
        ctx.lineTo(x0 + LADDER_W, bottom);
        ctx.stroke();

        ctx.strokeStyle = '#4e5d75';
        ctx.lineWidth = 2;
        for (let y = top + 10; y < bottom; y += 14) {
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x0 + LADDER_W, y);
            ctx.stroke();
        }
    }
}

function drawFloors() {
    for (let row = 0; row < FLOOR_ROWS; row++) {
        const y = FLOOR_Y[row];
        ctx.fillStyle = '#2f3d55';
        ctx.fillRect(0, y, CANVAS_W, FLOOR_H);
        ctx.fillStyle = '#93a6c4';
        ctx.fillRect(0, y, CANVAS_W, 2);
    }
}

function drawPlates() {
    for (let col = 0; col < BURGER_X.length; col++) {
        const cx = BURGER_X[col] + ING_W / 2;
        ctx.fillStyle = '#cfd6e4';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 6, ING_W / 2 + 8, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8b93a6';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 9, ING_W / 2 + 8, 6, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

// One 24 px slice of a layer. A flipped slice is drawn upside-down (its
// highlight moves to the bottom and it sits a pixel lower) so the player can
// read a layer's progress at a glance.
function drawSegment(ing, s) {
    const colors = ING_COLORS[ing.type] || ING_COLORS.patty;
    const flipped = ing.segs[s];
    const x = BURGER_X[ing.col] + s * SEG_W;
    const y = ing.y + (flipped ? 1 : 0);
    const w = SEG_W;
    const h = ING_H - 1;
    const first = s === 0;
    const last = s === ING_SEGS - 1;

    // Buns get a rounded crust on their outer ends — as a clipped path, so the
    // corners stay transparent whatever the slice happens to be drawn over.
    const radii = [0, 0, 0, 0];             // top-left, top-right, bottom-right, bottom-left
    if (ing.type === 'bunTop' || ing.type === 'bunBottom') {
        const domeUp = (ing.type === 'bunTop') !== flipped;
        if (first) radii[domeUp ? 0 : 3] = 7;
        if (last) radii[domeUp ? 1 : 2] = 7;
    }

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radii);
    ctx.clip();

    ctx.fillStyle = flipped ? colors.edge : colors.face;
    ctx.fillRect(x, y, w, h);

    if (ing.type === 'lettuce') {
        // scalloped leaf edge on the exposed side
        ctx.fillStyle = colors.edge;
        const edgeY = flipped ? y + 3 : y + h - 3;
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(x + 4 + i * 8, edgeY, 5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.fillRect(x, flipped ? y + h - 3 : y, w, 3);
    } else if (ing.type === 'patty') {
        ctx.fillStyle = colors.dark;
        for (let i = 0; i < 2; i++) {
            ctx.fillRect(x + 3 + i * 11, y + 5, 7, 3);
        }
        ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.fillRect(x, flipped ? y + h - 3 : y, w, 3);
    } else {
        // sesame seeds on the top bun, a plain glaze on the bottom one
        ctx.fillStyle = 'rgba(255, 255, 255, 0.20)';
        ctx.fillRect(x, flipped ? y + h - 4 : y, w, 4);
        if (ing.type === 'bunTop') {
            ctx.fillStyle = 'rgba(255, 246, 214, 0.9)';
            ctx.fillRect(x + 5, flipped ? y + h - 7 : y + 5, 4, 2);
            ctx.fillRect(x + 14, flipped ? y + h - 10 : y + 8, 4, 2);
        }
    }

    // slice separator + outline
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y);
    ctx.lineTo(x + 0.5, y + h);
    ctx.stroke();
    ctx.restore();
}

function drawIngredient(ing) {
    // drop shadow while airborne, so a falling layer reads as falling
    if (ing.falling) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(BURGER_X[ing.col] + 6, ing.y + ING_H + 2, ING_W - 12, 3);
    }
    for (let s = 0; s < ING_SEGS; s++) drawSegment(ing, s);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(BURGER_X[ing.col] + 0.5, ing.y + 0.5, ING_W - 1, ING_H - 1);
}

function drawChef() {
    const x = chef.x;
    const y = chef.y;
    const swing = Math.sin(walkPhase / 9) * 4;

    // legs
    ctx.strokeStyle = '#3c4a86';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 10);
    ctx.lineTo(x - 3 - swing, y);
    ctx.moveTo(x + 3, y - 10);
    ctx.lineTo(x + 3 + swing, y);
    ctx.stroke();

    // apron / body
    ctx.fillStyle = '#f6f1e6';
    ctx.fillRect(x - CHEF_W / 2, y - CHEF_H + 8, CHEF_W, CHEF_H - 18);

    // arms
    ctx.strokeStyle = '#f6f1e6';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - CHEF_W / 2, y - CHEF_H + 12);
    ctx.lineTo(x - CHEF_W / 2 - 4 + swing, y - CHEF_H + 20);
    ctx.moveTo(x + CHEF_W / 2, y - CHEF_H + 12);
    ctx.lineTo(x + CHEF_W / 2 + 4 - swing, y - CHEF_H + 20);
    ctx.stroke();

    // head + hat
    ctx.fillStyle = '#f2c69b';
    ctx.beginPath();
    ctx.arc(x, y - CHEF_H + 4, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 8, y - CHEF_H - 6, 16, 7);
    ctx.beginPath();
    ctx.ellipse(x, y - CHEF_H - 7, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // eyes, facing the direction of travel
    ctx.fillStyle = '#221a12';
    ctx.fillRect(x + (chef.facing > 0 ? 1 : -3), y - CHEF_H + 2, 2, 2);
}

const ENEMY_SKINS = [
    { body: '#c8492f', trim: '#e8b273', limb: '#8f3722' },   // hot dog
    { body: '#f6f2e2', trim: '#ffc93c', limb: '#d8cfae' },   // fried egg
    { body: '#5aa04a', trim: '#8fd47a', limb: '#3d7534' },   // pickle
];

function drawEnemyFace(e, cx, cy) {
    if (e.stun > 0) {
        ctx.strokeStyle = '#22131a';
        ctx.lineWidth = 1.6;
        for (const ex of [cx - 4, cx + 4]) {
            ctx.beginPath();
            ctx.arc(ex, cy, 3, 0, Math.PI * 1.7);
            ctx.stroke();
        }
        return;
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx - 4, cy, 3.2, 0, Math.PI * 2);
    ctx.arc(cx + 4, cy, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#221a12';
    const look = e.facing > 0 ? 1 : -1;
    ctx.beginPath();
    ctx.arc(cx - 4 + look, cy, 1.5, 0, Math.PI * 2);
    ctx.arc(cx + 4 + look, cy, 1.5, 0, Math.PI * 2);
    ctx.fill();
}

function drawEnemyLegs(e, skin) {
    const swing = Math.sin((e.x + e.y) / 7) * 3;
    ctx.strokeStyle = skin.limb;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(e.x - 4, e.y - 5);
    ctx.lineTo(e.x - 5 - swing, e.y);
    ctx.moveTo(e.x + 4, e.y - 5);
    ctx.lineTo(e.x + 5 + swing, e.y);
    ctx.stroke();
}

function drawEnemy(e) {
    if (e.dead) return;
    const kind = e.kind % ENEMY_SKINS.length;
    const skin = ENEMY_SKINS[kind];
    const x = e.x;
    const y = e.y;
    const top = y - ENEMY_H;

    ctx.save();
    if (e.stun > 0) ctx.globalAlpha = 0.7;
    drawEnemyLegs(e, skin);

    if (kind === 0) {
        // hot dog: a sausage sitting in a split bun
        ctx.fillStyle = skin.trim;
        ctx.beginPath();
        ctx.roundRect(x - ENEMY_W / 2, top + 4, ENEMY_W, ENEMY_H - 9, 7);
        ctx.fill();
        ctx.fillStyle = skin.body;
        ctx.beginPath();
        ctx.roundRect(x - ENEMY_W / 2 + 2, top + 1, ENEMY_W - 4, ENEMY_H - 12, 6);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 240, 190, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 7, top + 10);
        ctx.lineTo(x + 7, top + 6);
        ctx.stroke();
        drawEnemyFace(e, x, top + 5);
    } else if (kind === 1) {
        // fried egg: a wobbly white with a yolk
        ctx.fillStyle = skin.body;
        ctx.beginPath();
        ctx.ellipse(x, top + 12, ENEMY_W / 2 + 2, ENEMY_H / 2 - 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x - 8, top + 16, 5, 4, 0, 0, Math.PI * 2);
        ctx.ellipse(x + 8, top + 8, 5, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = skin.trim;
        ctx.beginPath();
        ctx.arc(x, top + 13, 5.5, 0, Math.PI * 2);
        ctx.fill();
        drawEnemyFace(e, x, top + 6);
    } else {
        // pickle: a bumpy green gherkin
        ctx.fillStyle = skin.body;
        ctx.beginPath();
        ctx.ellipse(x, top + 12, ENEMY_W / 2 - 1, ENEMY_H / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = skin.trim;
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.arc(x - 5 + (i % 2) * 10, top + 8 + i * 4, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        drawEnemyFace(e, x, top + 6);
    }

    ctx.restore();
}

function drawClouds() {
    for (const c of clouds) {
        const alpha = clamp(c.t / PEPPER_TIME, 0, 1);
        ctx.fillStyle = 'rgba(240, 228, 200, ' + (0.35 + 0.5 * alpha) + ')';
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const r = 6 + (i % 4) * 4;
            ctx.beginPath();
            ctx.arc(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * 0.7, 2.2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawFlash() {
    if (flashTime <= 0 || !flashText) return;
    ctx.save();
    ctx.globalAlpha = clamp(flashTime / 1.2, 0, 1);
    ctx.fillStyle = '#ffb347';
    ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(flashText, CANVAS_W / 2, CANVAS_H / 2);
    ctx.restore();
}

function draw() {
    drawBackground();
    drawLadders();
    drawFloors();
    drawPlates();
    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    drawClouds();
    drawChef();
    drawFlash();
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

function hasAny(keys) { return keys.some((k) => heldKeys.has(k)); }

function refreshKeyDir() {
    const dx = (hasAny(RIGHT_KEYS) ? 1 : 0) - (hasAny(LEFT_KEYS) ? 1 : 0);
    const dy = (hasAny(DOWN_KEYS) ? 1 : 0) - (hasAny(UP_KEYS) ? 1 : 0);
    setChefDir(dx, dy);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') {
            togglePause();
            e.preventDefault();
        }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') firePepper();
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
// Init
// ---------------------------------------------------------------------------

let lastT = 0;

function frame(t) {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
    lastT = t;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
pepper = START_PEPPER;
buildIngredients();
buildEnemies();
resetPositions();
updateHud();
requestAnimationFrame(frame);
