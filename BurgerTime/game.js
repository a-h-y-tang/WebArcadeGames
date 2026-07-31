// ---------------------------------------------------------------------------
// Burger Time — a ladders-and-platforms arcade game on an HTML5 canvas.
//
// The chef runs along five girders connected by ladders. Walking the full width
// of a burger ingredient knocks it down one level; keep knocking every piece
// down until all three burgers are assembled on the plates at the bottom, while
// dodging the food enemies that chase you around the board. A shake of pepper
// freezes anything in front of you for a moment.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const TILE = 26;
const COLS = 20;
const ROWS = 21;
const CANVAS_W = COLS * TILE;   // 520
const CANVAS_H = ROWS * TILE;   // 546

// Rows (in tiles) of the walkable girders, top to bottom.
const FLOOR_ROWS = [2, 6, 10, 14, 18];
const LAST_FLOOR = FLOOR_ROWS.length - 1;

// Tile columns holding a ladder. Every ladder spans the whole tower.
const LADDER_COLS = [1, 6, 12, 18];

// Left tile column of each burger stack; every ingredient is 4 tiles wide.
const BURGER_COLS = [2, 8, 14];
const SEGMENTS = 4;
const ING_W = SEGMENTS * TILE;
const ING_H = 9;

const PLATE_ROW = 20;
const PLATE_Y = PLATE_ROW * TILE;   // top of the plates
const PLATE_W = ING_W + 12;

const INGREDIENT_TYPES = ['bun-top', 'lettuce', 'patty', 'bun-bottom'];
const ENEMY_TYPES = ['dog', 'egg', 'pickle'];

// --- Movement / tuning ---
const CHEF_SPEED = 112;        // px/s, walking and climbing
const CHEF_HALF = 9;           // half the chef's width, used for wall clamping
const FALL_SPEED = 210;        // px/s for a knocked-down ingredient
const FLOOR_SNAP = 3;          // how close to a girder counts as standing on it
const LADDER_SNAP = TILE / 2;  // how close to a ladder centre lets you climb

const ENEMY_BASE_SPEED = 58;
const ENEMY_LEVEL_SPEED = 7;
const ENEMY_MAX = 5;
const SPAWN_BASE = 5.0;
const SPAWN_MIN = 1.8;
const SPAWN_STEP = 0.45;
const RESPAWN_GRACE = 2.5;     // quiet seconds after losing a chef

const PEPPER_RANGE = 44;       // how far in front of the chef the cloud reaches
const PEPPER_HEIGHT = 20;
const STUN_TIME = 2.5;
const START_PEPPER = 5;
const START_LIVES = 3;

// --- Scoring ---
const DROP_POINTS = 50;
const PLATE_POINTS = 100;
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
let state, score, best, level, lives, pepper, enemySpawnTimer;
const chef = { x: CANVAS_W / 2, y: 0, dx: 0, dy: 0, facing: 1, climbing: false, walk: 0 };
const ingredients = [];
const plates = [];
const enemies = [];
const clouds = [];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function floorY(index) { return FLOOR_ROWS[index] * TILE; }
function ladderX(col) { return (col + 0.5) * TILE; }
function restY(floorIndex) { return floorY(floorIndex) - ING_H; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Index of the girder the given y is standing on, or -1 when between floors.
function nearFloor(y) {
    for (let i = 0; i < FLOOR_ROWS.length; i++) {
        if (Math.abs(y - floorY(i)) <= FLOOR_SNAP) return i;
    }
    return -1;
}

// Nearest girder regardless of distance — used by the enemy AI for targeting.
function closestFloor(y) {
    let best = 0;
    for (let i = 1; i < FLOOR_ROWS.length; i++) {
        if (Math.abs(y - floorY(i)) < Math.abs(y - floorY(best))) best = i;
    }
    return best;
}

function nearestLadderX(x) {
    let bestX = ladderX(LADDER_COLS[0]);
    for (const col of LADDER_COLS) {
        if (Math.abs(x - ladderX(col)) < Math.abs(x - bestX)) bestX = ladderX(col);
    }
    return bestX;
}

function onLadder(x) { return Math.abs(x - nearestLadderX(x)) <= LADDER_SNAP; }

// The ladder that gets an enemy from `fromX` toward `toX` with the least walking.
function bestLadderX(fromX, toX) {
    let bestX = ladderX(LADDER_COLS[0]);
    let bestCost = Infinity;
    for (const col of LADDER_COLS) {
        const lx = ladderX(col);
        const cost = Math.abs(fromX - lx) + Math.abs(lx - toX);
        if (cost < bestCost) { bestCost = cost; bestX = lx; }
    }
    return bestX;
}

function enemySpeed() { return ENEMY_BASE_SPEED + (level - 1) * ENEMY_LEVEL_SPEED; }
function spawnInterval() { return Math.max(SPAWN_MIN, SPAWN_BASE - (level - 1) * SPAWN_STEP); }

// ---------------------------------------------------------------------------
// Board setup
// ---------------------------------------------------------------------------

function buildLevel() {
    ingredients.length = 0;
    plates.length = 0;
    clouds.length = 0;
    for (const col of BURGER_COLS) {
        plates.push({ col, count: 0, items: [] });
        INGREDIENT_TYPES.forEach((type, floor) => {
            ingredients.push({
                type,
                col,
                x: col * TILE,
                floor,
                y: restY(floor),
                segs: new Array(SEGMENTS).fill(false),
                falling: false,
                plated: false,
                targetFloor: floor,
            });
        });
    }
}

function resetChef() {
    chef.x = CANVAS_W / 2;
    chef.y = floorY(LAST_FLOOR);
    chef.dx = 0;
    chef.dy = 0;
    chef.facing = 1;
    chef.climbing = false;
    chef.walk = 0;
}

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    pepper = START_PEPPER;
    enemies.length = 0;
    enemySpawnTimer = RESPAWN_GRACE;
    buildLevel();
    resetChef();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    score += LEVEL_BONUS;
    pepper = Math.min(START_PEPPER, pepper + 1);
    enemies.length = 0;
    enemySpawnTimer = RESPAWN_GRACE;
    buildLevel();
    resetChef();
    updateHud();
}

// ---------------------------------------------------------------------------
// Player input hooks (also used directly by the tests)
// ---------------------------------------------------------------------------

function setChefDir(dx, dy) {
    chef.dx = Math.sign(dx);
    chef.dy = Math.sign(dy);
    if (chef.dx !== 0) chef.facing = chef.dx;
}

function placeChef(x, y) {
    chef.x = x;
    chef.y = y;
}

function firePepper() {
    if (state !== 'running' || pepper <= 0) return false;
    pepper -= 1;
    const x0 = chef.facing > 0 ? chef.x : chef.x - PEPPER_RANGE;
    const x1 = x0 + PEPPER_RANGE;
    clouds.push({ x0, x1, y: chef.y, life: 0.5 });
    for (const enemy of enemies) {
        if (enemy.x >= x0 && enemy.x <= x1 && Math.abs(enemy.y - chef.y) <= PEPPER_HEIGHT) {
            enemy.stun = STUN_TIME;
        }
    }
    updateHud();
    return true;
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
// Chef movement
// ---------------------------------------------------------------------------

function moveChef(dt) {
    const canClimbUp = chef.dy < 0 && chef.y > floorY(0);
    const canClimbDown = chef.dy > 0 && chef.y < floorY(LAST_FLOOR);
    if (chef.dy !== 0 && onLadder(chef.x) && (canClimbUp || canClimbDown)) {
        chef.x = nearestLadderX(chef.x);
        chef.y = clamp(chef.y + chef.dy * CHEF_SPEED * dt, floorY(0), floorY(LAST_FLOOR));
        chef.climbing = nearFloor(chef.y) < 0;
        chef.walk += CHEF_SPEED * dt;
        return;
    }

    const floor = nearFloor(chef.y);
    if (chef.dx !== 0 && floor >= 0) {
        chef.y = floorY(floor);
        chef.climbing = false;
        chef.x = clamp(chef.x + chef.dx * CHEF_SPEED * dt, CHEF_HALF, CANVAS_W - CHEF_HALF);
        chef.walk += CHEF_SPEED * dt;
    }
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

// Standing on a segment presses it down; once all four are pressed the whole
// ingredient drops one level.
function stepIngredients() {
    const floor = nearFloor(chef.y);
    if (floor < 0) return;
    for (const ing of ingredients) {
        if (ing.falling || ing.plated || ing.floor !== floor) continue;
        const seg = Math.floor((chef.x - ing.x) / TILE);
        if (seg >= 0 && seg < SEGMENTS && !ing.segs[seg]) {
            ing.segs[seg] = true;
        }
    }
}

function startFall(ing) {
    if (ing.falling || ing.plated) return;
    ing.falling = true;
    ing.targetFloor = ing.floor + 1;
    ing.segs.fill(false);
    score += DROP_POINTS;
}

function plateIngredient(ing) {
    const plate = plates[BURGER_COLS.indexOf(ing.col)];
    ing.y = PLATE_Y - ING_H * (plate.count + 1);
    ing.falling = false;
    ing.plated = true;
    ing.floor = null;
    ing.segs.fill(false);
    plate.count += 1;
    plate.items.push(ing);
    score += PLATE_POINTS;
}

function squashEnemiesUnder(ing) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        const underneath = Math.abs(enemy.y - (ing.y + ING_H)) < 16;
        if (underneath && enemy.x >= ing.x && enemy.x <= ing.x + ING_W) {
            enemies.splice(i, 1);
            score += SQUASH_POINTS;
        }
    }
}

function updateIngredients(dt) {
    for (const ing of ingredients) {
        if (!ing.falling) {
            if (!ing.plated && ing.segs.every(Boolean)) startFall(ing);
            continue;
        }

        ing.y += FALL_SPEED * dt;
        squashEnemiesUnder(ing);

        if (ing.targetFloor > LAST_FLOOR) {
            const plate = plates[BURGER_COLS.indexOf(ing.col)];
            const target = PLATE_Y - ING_H * (plate.count + 1);
            if (ing.y >= target) plateIngredient(ing);
            continue;
        }

        const target = restY(ing.targetFloor);
        if (ing.y >= target) {
            // Anything already resting where we land gets knocked down as well.
            const below = ingredients.find(
                (o) => o !== ing && o.col === ing.col && o.floor === ing.targetFloor && !o.plated && !o.falling
            );
            if (below) startFall(below);
            ing.y = target;
            ing.floor = ing.targetFloor;
            ing.falling = false;
            ing.segs.fill(false);
        }
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemy(x, y, type) {
    const enemy = {
        x,
        y,
        type: type || ENEMY_TYPES[Math.floor(Math.random() * ENEMY_TYPES.length)],
        stun: 0,
        facing: -1,
        wobble: 0,
    };
    enemies.push(enemy);
    return enemy;
}

function spawnWave(dt) {
    enemySpawnTimer -= dt;
    if (enemySpawnTimer > 0) return;
    enemySpawnTimer = spawnInterval();
    if (enemies.length >= Math.min(ENEMY_MAX, 2 + level)) return;
    const col = LADDER_COLS[Math.floor(Math.random() * LADDER_COLS.length)];
    spawnEnemy(ladderX(col), floorY(0));
}

function moveEnemy(enemy, dt) {
    if (enemy.stun > 0) {
        enemy.stun -= dt;
        return;
    }
    const speed = enemySpeed();
    enemy.wobble += speed * dt;
    const floor = nearFloor(enemy.y);
    const chefFloor = closestFloor(chef.y);

    if (floor < 0) {
        // Mid-ladder: keep going toward the chef's level.
        const dir = chef.y > enemy.y ? 1 : -1;
        enemy.y = clamp(enemy.y + dir * speed * dt, floorY(0), floorY(LAST_FLOOR));
        return;
    }

    enemy.y = floorY(floor);
    if (floor === chefFloor) {
        const dir = Math.sign(chef.x - enemy.x);
        if (dir !== 0) {
            enemy.x = clamp(enemy.x + dir * speed * dt, CHEF_HALF, CANVAS_W - CHEF_HALF);
            enemy.facing = dir;
        }
        return;
    }

    const target = bestLadderX(enemy.x, chef.x);
    if (Math.abs(enemy.x - target) > 1.5) {
        const dir = Math.sign(target - enemy.x);
        enemy.x += dir * speed * dt;
        enemy.facing = dir;
        return;
    }
    enemy.x = target;
    const dir = chefFloor > floor ? 1 : -1;
    enemy.y = clamp(enemy.y + dir * speed * dt, floorY(0), floorY(LAST_FLOOR));
}

function checkEnemyCollisions() {
    for (const enemy of enemies) {
        if (enemy.stun > 0) continue;
        if (Math.abs(enemy.x - chef.x) < 13 && Math.abs(enemy.y - chef.y) < 15) {
            loseLife();
            return;
        }
    }
}

function loseLife() {
    lives -= 1;
    enemies.length = 0;
    clouds.length = 0;
    if (lives <= 0) {
        lives = 0;
        gameOver();
    } else {
        resetChef();
        enemySpawnTimer = RESPAWN_GRACE;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space to play again');
    updateHud();
}

function step(dt) {
    if (state !== 'running') return;

    moveChef(dt);
    stepIngredients();
    updateIngredients(dt);

    for (const enemy of enemies) moveEnemy(enemy, dt);
    checkEnemyCollisions();
    if (state !== 'running') { updateHud(); return; }

    spawnWave(dt);

    for (let i = clouds.length - 1; i >= 0; i--) {
        clouds[i].life -= dt;
        if (clouds[i].life <= 0) clouds.splice(i, 1);
    }

    if (ingredients.length > 0 && ingredients.every((i) => i.plated)) nextLevel();

    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ING_COLORS = {
    'bun-top': ['#d8933f', '#b7742c'],
    'lettuce': ['#63c05a', '#3f8f3c'],
    'patty': ['#8a5227', '#63381a'],
    'bun-bottom': ['#c9852f', '#a56425'],
};

const ENEMY_COLORS = {
    dog: ['#e06a4c', '#a63f2c'],
    egg: ['#f2e6c2', '#c9b077'],
    pickle: ['#7fbf4f', '#4e8232'],
};

function drawGirders() {
    for (let i = 0; i < FLOOR_ROWS.length; i++) {
        const y = floorY(i);
        ctx.fillStyle = '#3d5480';
        ctx.fillRect(0, y, CANVAS_W, 4);
        ctx.fillStyle = '#26385c';
        ctx.fillRect(0, y + 4, CANVAS_W, 3);
        ctx.fillStyle = '#1b2a48';
        for (let x = 0; x < CANVAS_W; x += TILE) ctx.fillRect(x + TILE / 2 - 1, y + 4, 2, 3);
    }
}

function drawLadders() {
    for (const col of LADDER_COLS) {
        const cx = ladderX(col);
        const top = floorY(0);
        const bottom = floorY(LAST_FLOOR);
        ctx.fillStyle = '#4a6ba8';
        ctx.fillRect(cx - 9, top, 3, bottom - top);
        ctx.fillRect(cx + 6, top, 3, bottom - top);
        ctx.fillStyle = '#33507f';
        for (let y = top + 6; y < bottom; y += 10) ctx.fillRect(cx - 9, y, 18, 2);
    }
}

function drawPlates() {
    for (const plate of plates) {
        const x = plate.col * TILE + (ING_W - PLATE_W) / 2;
        ctx.fillStyle = '#c9d4e8';
        ctx.fillRect(x, PLATE_Y, PLATE_W, 6);
        ctx.fillStyle = '#8e9bb5';
        ctx.fillRect(x + 6, PLATE_Y + 6, PLATE_W - 12, 4);
    }
}

function drawIngredient(ing) {
    const [light, dark] = ING_COLORS[ing.type];
    for (let s = 0; s < SEGMENTS; s++) {
        const x = ing.x + s * TILE;
        const y = ing.y + (ing.segs[s] ? 4 : 0);
        ctx.fillStyle = light;
        ctx.fillRect(x, y, TILE, ING_H - 3);
        ctx.fillStyle = dark;
        ctx.fillRect(x, y + ING_H - 3, TILE, 3);
        if (ing.type === 'bun-top') {
            ctx.fillStyle = '#f4e3c1';
            ctx.fillRect(x + 6, y + 1, 3, 2);
            ctx.fillRect(x + 16, y + 3, 3, 2);
        }
    }
}

function drawChef() {
    const x = chef.x;
    const y = chef.y;
    const stride = Math.sin(chef.walk / 6) * 2;
    // legs
    ctx.fillStyle = '#2f3d5c';
    ctx.fillRect(x - 6, y - 8 - Math.max(0, stride), 4, 8 + Math.max(0, stride));
    ctx.fillRect(x + 2, y - 8 - Math.max(0, -stride), 4, 8 + Math.max(0, -stride));
    // apron over a white jacket
    ctx.fillStyle = '#f2f5fb';
    ctx.fillRect(x - 8, y - 22, 16, 14);
    ctx.fillStyle = '#4d79c7';
    ctx.fillRect(x - 6, y - 15, 12, 7);
    // arms
    ctx.fillStyle = '#e6ebf5';
    ctx.fillRect(x + (chef.facing > 0 ? 8 : -11), y - 21, 3, 9);
    // head
    ctx.fillStyle = '#f0c39a';
    ctx.fillRect(x - 6, y - 30, 12, 8);
    // hat with a band so it reads against the jacket
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 8, y - 37, 16, 7);
    ctx.fillStyle = '#c9d4e8';
    ctx.fillRect(x - 8, y - 31, 16, 2);
    // eye
    ctx.fillStyle = '#20283c';
    ctx.fillRect(x + (chef.facing > 0 ? 1 : -4), y - 28, 3, 3);
}

function drawEnemy(enemy) {
    const [light, dark] = ENEMY_COLORS[enemy.type] || ENEMY_COLORS.dog;
    const x = enemy.x;
    const y = enemy.y;
    const stunned = enemy.stun > 0;
    const body = stunned ? '#8fa3c6' : light;
    const shade = stunned ? '#5d6f92' : dark;
    const step = Math.sin(enemy.wobble / 6) * 2;

    // feet
    ctx.fillStyle = shade;
    ctx.fillRect(x - 7, y - 4 - Math.max(0, step), 5, 4 + Math.max(0, step));
    ctx.fillRect(x + 2, y - 4 - Math.max(0, -step), 5, 4 + Math.max(0, -step));

    ctx.fillStyle = body;
    if (enemy.type === 'egg') {
        ctx.beginPath();
        ctx.ellipse(x, y - 12, 9, 10, 0, 0, Math.PI * 2);
        ctx.fill();
    } else if (enemy.type === 'pickle') {
        ctx.fillRect(x - 7, y - 22, 14, 18);
        ctx.fillStyle = shade;
        for (let i = 0; i < 3; i++) ctx.fillRect(x - 5 + i * 5, y - 19 + (i % 2) * 6, 3, 3);
    } else {
        // hot dog: sausage in a bun
        ctx.fillRect(x - 9, y - 20, 18, 14);
        ctx.fillStyle = shade;
        ctx.fillRect(x - 9, y - 13, 18, 4);
    }

    // eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 6, y - 18, 4, 4);
    ctx.fillRect(x + 2, y - 18, 4, 4);
    ctx.fillStyle = '#1a2033';
    const pupil = stunned ? 0 : (enemy.facing > 0 ? 1 : -1);
    ctx.fillRect(x - 5 + pupil, y - 17, 2, 2);
    ctx.fillRect(x + 3 + pupil, y - 17, 2, 2);
    if (stunned) {
        ctx.fillStyle = '#f5b642';
        ctx.fillRect(x - 3, y - 28, 2, 5);
        ctx.fillRect(x + 1, y - 28, 2, 5);
    }
}

function drawClouds() {
    for (const cloud of clouds) {
        ctx.fillStyle = `rgba(245, 182, 66, ${Math.max(0, cloud.life)})`;
        for (let i = 0; i < 6; i++) {
            const px = cloud.x0 + ((i * 7 + Math.floor(cloud.life * 40)) % (cloud.x1 - cloud.x0));
            const py = cloud.y - 8 - ((i * 5) % 14);
            ctx.fillRect(px, py, 3, 3);
        }
    }
}

function draw() {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawLadders();
    drawGirders();
    drawPlates();
    for (const ing of ingredients) drawIngredient(ing);
    for (const enemy of enemies) drawEnemy(enemy);
    drawClouds();
    drawChef();
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

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() { overlay.classList.remove('visible'); }

function loadBest() {
    best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0;
    return best;
}

// ---------------------------------------------------------------------------
// Frame loop
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
// Input
// ---------------------------------------------------------------------------

const heldKeys = new Set();
const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];
const MOVE_KEYS = [...LEFT_KEYS, ...RIGHT_KEYS, ...UP_KEYS, ...DOWN_KEYS];

function held(keys) { return keys.some((k) => heldKeys.has(k)); }

function refreshKeyDir() {
    const dx = (held(RIGHT_KEYS) ? 1 : 0) - (held(LEFT_KEYS) ? 1 : 0);
    const dy = (held(DOWN_KEYS) ? 1 : 0) - (held(UP_KEYS) ? 1 : 0);
    setChefDir(dx, dy);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
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

loadBest();
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
pepper = START_PEPPER;
enemySpawnTimer = RESPAWN_GRACE;
buildLevel();
resetChef();
updateHud();
requestAnimationFrame(frame);
