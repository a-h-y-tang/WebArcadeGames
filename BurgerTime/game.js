// ---------------------------------------------------------------------------
// Burger Time — build burgers by walking the ingredients down to the plates
// while dodging the food that wants you dead.
// ---------------------------------------------------------------------------

// --- board geometry --------------------------------------------------------
const TILE = 40;
const COLS = 16;
const ROWS = 13;
const CANVAS_W = COLS * TILE;   // 640
const CANVAS_H = ROWS * TILE;   // 520

// Rows carrying a walkable floor line, top to bottom.
const FLOOR_ROWS = [1, 4, 7, 10];
// Columns carrying a ladder. Every ladder connects every pair of neighbouring
// floors, which keeps the whole board reachable from anywhere.
const LADDER_COLS = [0, 5, 10, 15];
// Left-hand column of each four-tile-wide burger lane.
const LANE_COLS = [1, 6, 11];
const LANE_W = 4;                       // tiles
const PLATE_ROW = 12;                   // pseudo-floor the finished burger sits on

const TOP_FLOOR_Y = FLOOR_ROWS[0] * TILE;                        // 40
const BOTTOM_FLOOR_Y = FLOOR_ROWS[FLOOR_ROWS.length - 1] * TILE; // 400
const MIN_X = LADDER_COLS[0] * TILE + TILE / 2;                  // 20
const MAX_X = LADDER_COLS[LADDER_COLS.length - 1] * TILE + TILE / 2; // 620

// --- tuning ----------------------------------------------------------------
const LAYER_H = 10;
const CHEF_W = 22;
const CHEF_H = 30;
const CHEF_SPEED = 2;
const ENEMY_W = 24;
const ENEMY_H = 26;
const FALL_SPEED = 4;
const SPRAY_W = 46;
const SPRAY_H = 30;
const SPRAY_TICKS = 24;
const STUN_TICKS = 200;
const RESPAWN_TICKS = 300;
const INVULN_TICKS = 60;
const START_LIVES = 3;
const START_PEPPER = 5;
const SCORE_FLOOR = 50;
const SCORE_PLATE = 100;
const SCORE_SQUASH = 200;
const SCORE_LEVEL = 1000;
const STEP_MS = 1000 / 60;
const BEST_KEY = 'burgertime-best';

// Burger layers, bottom of the stack first.
const LAYERS = [
    { type: 'bunBottom', body: '#d2913f', shade: '#a96d27', trim: '#f0b96b' },
    { type: 'patty', body: '#7b4a2d', shade: '#59331d', trim: '#96603c' },
    { type: 'lettuce', body: '#5fae4a', shade: '#3f8130', trim: '#8ada6a' },
    { type: 'bunTop', body: '#e5ab5d', shade: '#bd8236', trim: '#ffd08f' },
];

// Which floor each layer starts on, per lane. Level 1 fills every floor so a
// single well-timed drop cascades the whole burger; later levels leave gaps.
const LEVEL_LAYOUTS = [
    [[10, 7, 4, 1], [10, 7, 4, 1], [10, 7, 4, 1]],
    [[10, 7, 7, 1], [10, 10, 4, 1], [10, 7, 4, 4]],
    [[10, 10, 7, 1], [10, 7, 7, 4], [10, 10, 4, 1]],
];

const ENEMY_KINDS = [
    { kind: 'hotdog', body: '#e8623c', shade: '#a83d20' },
    { kind: 'egg', body: '#f4f0e2', shade: '#c9c0a4' },
    { kind: 'pickle', body: '#7fbe4f', shade: '#4f8c2c' },
];

const SPAWNS = [
    { x: 20, y: 40 },
    { x: 620, y: 40 },
    { x: 220, y: 40 },
    { x: 420, y: 160 },
    { x: 20, y: 160 },
];

// --- mutable game state ----------------------------------------------------
let state = 'idle';     // idle | running | paused | levelclear | gameover
let score = 0;
let best = 0;
let level = 1;
let lives = START_LIVES;
let pepper = START_PEPPER;
let ingredients = [];
let enemies = [];
let sprays = [];
let chef = newChef();
let autoTick = true;    // tests switch this off to drive tick() by hand
let rngSeed = 1;
let frameCount = 0;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const els = {
    score: document.getElementById('score'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    pepper: document.getElementById('pepper'),
    best: document.getElementById('best'),
    overlay: document.getElementById('overlay'),
    title: document.getElementById('overlay-title'),
    sub: document.getElementById('overlay-sub'),
    overScore: document.getElementById('overlay-score'),
    start: document.getElementById('btn-start'),
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function rand() {
    // Deterministic LCG so enemy jitter is reproducible in tests.
    rngSeed = (rngSeed * 1103515245 + 12345) & 0x7fffffff;
    return rngSeed / 0x7fffffff;
}

function floorY(row) { return row * TILE; }
function ladderX(col) { return col * TILE + TILE / 2; }
function laneX(lane) { return LANE_COLS[lane] * TILE; }
function laneW() { return LANE_W * TILE; }

function onFloorY(y) { return FLOOR_ROWS.some((r) => r * TILE === y); }
function onLadderX(x) { return LADDER_COLS.some((c) => ladderX(c) === x); }

function nextFloorBelow(row) {
    for (const r of FLOOR_ROWS) if (r > row) return r;
    return PLATE_ROW;
}

function newChef() {
    return { x: 320, y: BOTTOM_FLOOR_Y, dir: null, want: null, facing: 1, invuln: 0, walk: 0 };
}

function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function chefBox() {
    return { x: chef.x - CHEF_W / 2, y: chef.y - CHEF_H, w: CHEF_W, h: CHEF_H };
}

function enemyBox(e) {
    return { x: e.x - ENEMY_W / 2, y: e.y - ENEMY_H, w: ENEMY_W, h: ENEMY_H };
}

function ingredientBox(i) {
    return { x: i.x, y: i.y, w: laneW(), h: LAYER_H };
}

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------
function buildLevel() {
    ingredients = [];
    const layout = LEVEL_LAYOUTS[(level - 1) % LEVEL_LAYOUTS.length];
    for (let lane = 0; lane < LANE_COLS.length; lane++) {
        const perFloor = {};
        for (let li = 0; li < LAYERS.length; li++) {
            const row = layout[lane][li];
            const k = perFloor[row] || 0;
            perFloor[row] = k + 1;
            ingredients.push({
                lane,
                layer: li,
                type: LAYERS[li].type,
                floor: row,
                target: row,
                x: laneX(lane),
                y: floorY(row) - LAYER_H * (k + 1),
                state: 'rest',
                segments: [false, false, false, false],
                kills: 0,
            });
        }
    }
}

function enemyCount() { return Math.min(2 + level, SPAWNS.length); }

function spawnEnemies() {
    enemies = [];
    for (let i = 0; i < enemyCount(); i++) {
        const spot = SPAWNS[i];
        const kind = ENEMY_KINDS[i % ENEMY_KINDS.length];
        enemies.push({
            x: spot.x,
            y: spot.y,
            home: spot,
            kind: kind.kind,
            body: kind.body,
            shade: kind.shade,
            dir: 'down',
            speed: level >= 3 ? 2 : 1,
            stun: 0,
            dead: false,
            respawn: 0,
        });
    }
}

function resetPositions() {
    chef = newChef();
    chef.invuln = INVULN_TICKS;
    for (const e of enemies) {
        e.x = e.home.x;
        e.y = e.home.y;
        e.dir = 'down';
        e.stun = 0;
    }
    sprays = [];
}

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    pepper = START_PEPPER;
    rngSeed = 1;
    beginLevel();
}

function nextLevel() {
    level += 1;
    pepper = START_PEPPER;
    beginLevel();
}

function beginLevel() {
    buildLevel();
    spawnEnemies();
    chef = newChef();
    sprays = [];
    state = 'running';
    hideOverlay();
    syncHud();
}

// ---------------------------------------------------------------------------
// Movement shared by the chef and the enemies
// ---------------------------------------------------------------------------
function canGo(ent, dir, speed) {
    const s = speed === undefined ? ent.speed || CHEF_SPEED : speed;
    if (dir === 'left') return onFloorY(ent.y) && ent.x - s >= MIN_X;
    if (dir === 'right') return onFloorY(ent.y) && ent.x + s <= MAX_X;
    if (dir === 'up') return onLadderX(ent.x) && ent.y - s >= TOP_FLOOR_Y;
    if (dir === 'down') return onLadderX(ent.x) && ent.y + s <= BOTTOM_FLOOR_Y;
    return false;
}

function advance(ent, dir, speed) {
    if (dir === 'left') ent.x -= speed;
    else if (dir === 'right') ent.x += speed;
    else if (dir === 'up') ent.y -= speed;
    else if (dir === 'down') ent.y += speed;
}

function updateChef() {
    if (chef.invuln > 0) chef.invuln--;
    if (chef.want && canGo(chef, chef.want, CHEF_SPEED)) chef.dir = chef.want;
    if (!chef.dir) return;
    if (!canGo(chef, chef.dir, CHEF_SPEED)) return;
    advance(chef, chef.dir, CHEF_SPEED);
    chef.walk += 1;
    if (chef.dir === 'left') chef.facing = -1;
    if (chef.dir === 'right') chef.facing = 1;
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------
function restingAt(lane, row) {
    return ingredients.filter(
        (i) => i.lane === lane && i.floor === row && (i.state === 'rest' || i.state === 'plate'),
    );
}

function topRestingAt(lane, row) {
    const stack = restingAt(lane, row).filter((i) => i.state === 'rest');
    if (!stack.length) return null;
    return stack.reduce((a, b) => (b.y < a.y ? b : a));
}

function startFall(ing) {
    ing.state = 'fall';
    ing.target = nextFloorBelow(ing.floor);
    ing.kills = 0;
    ing.segments = [false, false, false, false];
}

function dropStack(lane, row) {
    const stack = restingAt(lane, row).filter((i) => i.state === 'rest');
    if (!stack.length) return false;
    for (const ing of stack) startFall(ing);
    return true;
}

/** Mark the ingredient segment the chef is standing on; drop it when complete. */
function stepIngredients() {
    if (!onFloorY(chef.y)) return;
    const row = chef.y / TILE;
    for (let lane = 0; lane < LANE_COLS.length; lane++) {
        const top = topRestingAt(lane, row);
        if (!top) continue;
        const lx = laneX(lane);
        if (chef.x < lx || chef.x >= lx + laneW()) continue;
        const seg = Math.floor((chef.x - lx) / TILE);
        if (top.segments[seg]) continue;
        top.segments[seg] = true;
        if (top.segments.every(Boolean)) dropStack(lane, row);
    }
}

function updateIngredients() {
    let falling = ingredients.filter((i) => i.state === 'fall');
    if (!falling.length) return;

    for (const ing of falling) ing.y += FALL_SPEED;

    // A falling ingredient knocks any resting ingredient it lands on further
    // down, and rides along on top of it.
    for (const ing of falling.slice().sort((a, b) => b.y - a.y)) {
        const hit = ingredients.find(
            (o) => o.state === 'rest' && o.lane === ing.lane && o.y > ing.y && ing.y + LAYER_H >= o.y,
        );
        if (!hit) continue;
        ing.y = hit.y - LAYER_H;
        startFall(hit);
        for (const o of ingredients) {
            if (o.state === 'fall' && o.lane === ing.lane && o.y < hit.y) o.target = hit.target;
        }
    }

    squashEnemies();

    // Land, lowest first, so a cascading stack keeps its order.
    falling = ingredients.filter((i) => i.state === 'fall').sort((a, b) => b.y - a.y);
    for (const ing of falling) {
        const landY = floorY(ing.target) - LAYER_H * (restingAt(ing.lane, ing.target).length + 1);
        if (ing.y < landY) continue;
        ing.y = landY;
        ing.floor = ing.target;
        ing.state = ing.target === PLATE_ROW ? 'plate' : 'rest';
        score += ing.state === 'plate' ? SCORE_PLATE : SCORE_FLOOR;
    }
    syncHud();

    if (ingredients.length && ingredients.every((i) => i.state === 'plate')) clearLevel();
}

function squashEnemies() {
    for (const ing of ingredients) {
        if (ing.state !== 'fall') continue;
        const box = ingredientBox(ing);
        for (const e of enemies) {
            if (e.dead || !overlap(box, enemyBox(e))) continue;
            e.dead = true;
            e.respawn = RESPAWN_TICKS;
            e.stun = 0;
            ing.kills += 1;
            score += SCORE_SQUASH * ing.kills;
        }
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------
const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' };

function dirCost(e, dir) {
    let dx = e.x;
    let dy = e.y;
    if (dir === 'left') dx -= TILE;
    else if (dir === 'right') dx += TILE;
    else if (dir === 'up') dy -= TILE;
    else dy += TILE;
    return Math.abs(dx - chef.x) + Math.abs(dy - chef.y) * 1.4 + rand() * 12;
}

function chooseDir(e) {
    const opts = ['left', 'right', 'up', 'down'].filter((d) => canGo(e, d, e.speed));
    if (!opts.length) return null;
    const forward = opts.filter((d) => d !== OPPOSITE[e.dir]);
    const pool = forward.length ? forward : opts;
    return pool.reduce((a, b) => (dirCost(e, b) < dirCost(e, a) ? b : a));
}

function updateEnemies() {
    for (const e of enemies) {
        if (e.dead) {
            e.respawn -= 1;
            if (e.respawn <= 0) {
                e.dead = false;
                e.x = e.home.x;
                e.y = e.home.y;
                e.dir = 'down';
                e.stun = 0;
            }
            continue;
        }
        if (e.stun > 0) { e.stun -= 1; continue; }
        const junction = onFloorY(e.y) && onLadderX(e.x);
        if (junction || !canGo(e, e.dir, e.speed)) {
            const next = chooseDir(e);
            if (next) e.dir = next;
        }
        if (canGo(e, e.dir, e.speed)) advance(e, e.dir, e.speed);
    }
}

function checkChefHit() {
    if (chef.invuln > 0) return;
    const box = chefBox();
    for (const e of enemies) {
        if (e.dead || e.stun > 0) continue;
        if (overlap(box, enemyBox(e))) { loseLife(); return; }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------
function sprayPepper() {
    if (state !== 'running' || pepper <= 0) return false;
    pepper -= 1;
    const x = chef.facing > 0 ? chef.x + CHEF_W / 2 : chef.x - CHEF_W / 2 - SPRAY_W;
    sprays.push({ x, y: chef.y - SPRAY_H, w: SPRAY_W, h: SPRAY_H, life: SPRAY_TICKS });
    syncHud();
    return true;
}

function updateSprays() {
    for (const s of sprays) {
        s.life -= 1;
        for (const e of enemies) {
            if (e.dead) continue;
            if (overlap(s, enemyBox(e))) e.stun = STUN_TICKS;
        }
    }
    sprays = sprays.filter((s) => s.life > 0);
}

// ---------------------------------------------------------------------------
// Win / lose
// ---------------------------------------------------------------------------
function loseLife() {
    lives -= 1;
    syncHud();
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    resetPositions();
}

function clearLevel() {
    score += SCORE_LEVEL;
    state = 'levelclear';
    saveBest();
    syncHud();
    showOverlay('LEVEL ' + level + ' CLEAR', 'Score ' + score, 'Nice cooking — on to the next kitchen.', 'Next Level');
}

function gameOver() {
    state = 'gameover';
    saveBest();
    syncHud();
    showOverlay('GAME OVER', 'Score ' + score, 'The chef is off the menu. Press Enter to try again.', 'Play Again');
}

function saveBest() {
    if (score <= best) return;
    best = score;
    try { window.localStorage.setItem(BEST_KEY, String(best)); } catch (err) { /* ignore */ }
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to get back to the grill.', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------
function syncHud() {
    els.score.textContent = String(score);
    els.level.textContent = String(level);
    els.lives.textContent = String(lives);
    els.pepper.textContent = String(pepper);
    els.best.textContent = String(best);
}

function showOverlay(title, sub, msg, button) {
    els.title.textContent = title;
    els.overScore.textContent = sub;
    els.sub.textContent = msg;
    els.start.textContent = button;
    els.overlay.classList.add('visible');
}

function hideOverlay() { els.overlay.classList.remove('visible'); }

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------
function tick() {
    if (state !== 'running') return;
    frameCount += 1;
    updateChef();
    stepIngredients();
    updateIngredients();
    if (state !== 'running') return;
    updateEnemies();
    updateSprays();
    checkChefHit();
}

function tickN(n) { for (let i = 0; i < n; i++) tick(); }

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawBackground();
    drawLadders();
    drawFloors();
    drawPlates();
    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    drawSprays();
    drawChef();
}

function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#160f21');
    g.addColorStop(1, '#0a0710');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(c * TILE + 0.5, 0);
        ctx.lineTo(c * TILE + 0.5, CANVAS_H);
        ctx.stroke();
    }

    // The counter the plates stand on.
    const counterY = floorY(PLATE_ROW) + 6;
    ctx.fillStyle = '#241a2f';
    ctx.fillRect(0, counterY, CANVAS_W, CANVAS_H - counterY);
    ctx.fillStyle = '#3b2b4d';
    ctx.fillRect(0, counterY, CANVAS_W, 3);
}

function drawFloors() {
    for (const row of FLOOR_ROWS) {
        const y = floorY(row);
        ctx.fillStyle = '#4c3b63';
        ctx.fillRect(0, y, CANVAS_W, 5);
        ctx.fillStyle = '#8c72b5';
        ctx.fillRect(0, y, CANVAS_W, 2);
        // dashed tread marks
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let x = 0; x < CANVAS_W; x += 10) ctx.fillRect(x, y + 3, 5, 2);
    }
}

function drawLadders() {
    ctx.lineWidth = 3;
    for (const col of LADDER_COLS) {
        const cx = ladderX(col);
        for (let i = 0; i < FLOOR_ROWS.length - 1; i++) {
            const top = floorY(FLOOR_ROWS[i]);
            const bottom = floorY(FLOOR_ROWS[i + 1]);
            ctx.strokeStyle = '#6f5a8f';
            ctx.beginPath();
            ctx.moveTo(cx - 11, top - 4);
            ctx.lineTo(cx - 11, bottom + 5);
            ctx.moveTo(cx + 11, top - 4);
            ctx.lineTo(cx + 11, bottom + 5);
            ctx.stroke();
            ctx.strokeStyle = '#54426e';
            ctx.lineWidth = 2;
            for (let y = top + 10; y < bottom; y += 12) {
                ctx.beginPath();
                ctx.moveTo(cx - 11, y);
                ctx.lineTo(cx + 11, y);
                ctx.stroke();
            }
            ctx.lineWidth = 3;
        }
    }
}

function drawPlates() {
    const y = floorY(PLATE_ROW) + 4;
    for (let lane = 0; lane < LANE_COLS.length; lane++) {
        const cx = laneX(lane) + laneW() / 2;
        ctx.fillStyle = '#cfc8dc';
        ctx.beginPath();
        ctx.ellipse(cx, y, laneW() / 2 + 6, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9c93b0';
        ctx.beginPath();
        ctx.ellipse(cx, y + 3, laneW() / 2 + 2, 6, 0, 0, Math.PI * 2);
        ctx.fill();
    }
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

function drawIngredient(ing) {
    const skin = LAYERS[ing.layer];
    const segW = TILE;
    for (let s = 0; s < LANE_W; s++) {
        const dip = ing.state === 'rest' && ing.segments[s] ? 4 : 0;
        const x = ing.x + s * segW;
        const y = ing.y + dip;
        ctx.fillStyle = skin.shade;
        roundRect(x + 1, y + 2, segW - 2, LAYER_H, 3);
        ctx.fill();
        ctx.fillStyle = skin.body;
        roundRect(x + 1, y, segW - 2, LAYER_H, 3);
        ctx.fill();
        ctx.fillStyle = skin.trim;
        ctx.fillRect(x + 4, y + 2, segW - 8, 2);
        if (ing.type === 'lettuce') {
            ctx.fillStyle = skin.shade;
            for (let k = 0; k < 3; k++) ctx.fillRect(x + 6 + k * 10, y + 5, 5, 3);
        }
        if (ing.type === 'bunTop') {
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            for (let k = 0; k < 3; k++) ctx.fillRect(x + 8 + k * 9, y + 3, 3, 2);
        }
    }
}

function drawChef() {
    if (state === 'idle') return;
    if (chef.invuln > 0 && Math.floor(frameCount / 5) % 2 === 0) return;
    const x = chef.x;
    const y = chef.y;
    const bob = onFloorY(y) && chef.dir && Math.floor(chef.walk / 8) % 2 === 0 ? 1 : 0;

    // legs
    ctx.fillStyle = '#2f3a5c';
    ctx.fillRect(x - 7, y - 9, 5, 9 - bob);
    ctx.fillRect(x + 2, y - 9, 5, 9 - (1 - bob));
    // body
    ctx.fillStyle = '#f6f2ea';
    roundRect(x - 9, y - 22, 18, 14, 4);
    ctx.fill();
    // apron trim
    ctx.fillStyle = '#e05a4a';
    ctx.fillRect(x - 9, y - 13, 18, 3);
    // head
    ctx.fillStyle = '#f2c79a';
    roundRect(x - 6, y - 29, 12, 9, 3);
    ctx.fill();
    // hat
    ctx.fillStyle = '#ffffff';
    roundRect(x - 8, y - 36, 16, 8, 4);
    ctx.fill();
    ctx.fillRect(x - 8, y - 30, 16, 3);
    // eye
    ctx.fillStyle = '#2a1d16';
    ctx.fillRect(x + (chef.facing > 0 ? 1 : -3), y - 26, 2, 2);
}

function drawEnemy(e) {
    if (e.dead) return;
    const x = e.x;
    const y = e.y;
    ctx.fillStyle = e.shade;
    roundRect(x - 12, y - 24, 24, 24, 7);
    ctx.fill();
    ctx.fillStyle = e.stun > 0 ? '#7fa9ff' : e.body;
    roundRect(x - 12, y - 26, 24, 24, 7);
    ctx.fill();

    // feet
    ctx.fillStyle = '#2a1d16';
    ctx.fillRect(x - 9, y - 3, 6, 3);
    ctx.fillRect(x + 3, y - 3, 6, 3);

    // eyes
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - 5, y - 17, 4, 0, Math.PI * 2);
    ctx.arc(x + 5, y - 17, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#20161f';
    const look = e.stun > 0 ? 0 : (e.dir === 'left' ? -1.5 : e.dir === 'right' ? 1.5 : 0);
    ctx.beginPath();
    ctx.arc(x - 5 + look, y - 17, 2, 0, Math.PI * 2);
    ctx.arc(x + 5 + look, y - 17, 2, 0, Math.PI * 2);
    ctx.fill();

    if (e.stun > 0) {
        ctx.fillStyle = '#ffe27a';
        for (let k = 0; k < 3; k++) {
            const a = (frameCount / 8) + (k * Math.PI * 2) / 3;
            ctx.fillRect(x + Math.cos(a) * 13 - 1.5, y - 30 + Math.sin(a) * 4, 3, 3);
        }
    }
}

function drawSprays() {
    for (const s of sprays) {
        const alpha = Math.min(1, s.life / SPRAY_TICKS + 0.2);
        ctx.fillStyle = 'rgba(240, 232, 210, ' + alpha * 0.85 + ')';
        for (let k = 0; k < 14; k++) {
            const px = s.x + ((k * 37) % s.w);
            const py = s.y + ((k * 53) % s.h);
            ctx.fillRect(px, py, 3, 3);
        }
        ctx.fillStyle = 'rgba(60, 40, 30, ' + alpha * 0.6 + ')';
        for (let k = 0; k < 8; k++) {
            const px = s.x + ((k * 19 + 7) % s.w);
            const py = s.y + ((k * 29 + 5) % s.h);
            ctx.fillRect(px, py, 2, 2);
        }
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const DIR_KEYS = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
};

function primaryAction() {
    if (state === 'levelclear') nextLevel();
    else if (state === 'paused') togglePause();
    else if (state !== 'running') startGame();
}

window.addEventListener('keydown', (ev) => {
    if (DIR_KEYS[ev.code]) {
        ev.preventDefault();
        chef.want = DIR_KEYS[ev.code];
        return;
    }
    if (ev.code === 'Space') {
        ev.preventDefault();
        if (state === 'running') sprayPepper();
        else primaryAction();
        return;
    }
    if (ev.code === 'Enter') {
        ev.preventDefault();
        primaryAction();
        return;
    }
    if (ev.code === 'KeyP') {
        ev.preventDefault();
        togglePause();
    }
});

els.start.addEventListener('click', primaryAction);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function loadBest() {
    try {
        const raw = window.localStorage.getItem(BEST_KEY);
        best = raw ? parseInt(raw, 10) || 0 : 0;
    } catch (err) {
        best = 0;
    }
}

let acc = 0;
let lastTs = 0;

function frame(ts) {
    if (!lastTs) lastTs = ts;
    acc += Math.min(100, ts - lastTs);
    lastTs = ts;
    if (autoTick) {
        while (acc >= STEP_MS) {
            tick();
            acc -= STEP_MS;
        }
    } else {
        acc = 0;
    }
    draw();
    window.requestAnimationFrame(frame);
}

loadBest();
buildLevel();
syncHud();
window.requestAnimationFrame(frame);
