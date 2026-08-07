// ---------------------------------------------------------------------------
// Burger Time — an arcade maze game on an HTML5 canvas.
//
// Chef Peter Pepper walks the segments of four giant hamburgers off a lattice of
// platforms and ladders and down onto the plates below, while three animated
// foods chase him through the same lattice.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per-second and advanced
// through `step(dt)`, so the tests can simulate frames deterministically without
// depending on requestAnimationFrame wall-clock timing. `step` contains no
// Math.random() and no clock reads: a given sequence of calls always produces
// the same board.
// ---------------------------------------------------------------------------

// --- World geometry ---
const TILE = 40;
const CANVAS_W = 600;
const CANVAS_H = 480;

const FLOOR_ROWS = [1, 3, 5, 7, 9];   // grid rows carrying a walkable platform
const LADDER_COLS = [3, 7, 11];       // grid columns carrying a ladder
const STACK_COLS = [0, 4, 8, 12];     // left column of each 3-wide burger shaft
const PLATE_ROW = 11;

const FLOORS = FLOOR_ROWS.length;
const PLATE_Y = PLATE_ROW * TILE;

// --- Ingredients ---
const INGREDIENT_TYPES = ['bunTop', 'lettuce', 'patty', 'bunBottom']; // floors 0..3
const INGREDIENTS_PER_STACK = INGREDIENT_TYPES.length;
const SEGMENTS = 3;
const ING_W = SEGMENTS * TILE;
const ING_H = 10;
const FALL_SPEED = 220;   // px/s
const STACK_OFFSET = 10;  // gap kept above an ingredient swept up by a fall
const PLATE_STEP = 10;    // vertical pitch of the finished burger on the plate

// --- Chef ---
const CHEF_SPEED = 110;   // px/s, walking and climbing
const CHEF_HALF = 12;
const CHEF_H = 26;
const LADDER_SNAP = 14;   // how close to a ladder centre counts as "on it"
const FLOOR_SNAP = 3;     // how close to a floor counts as "standing on it"
const INVULN_TIME = 1.5;
const SPAWN_X = 300;
const SPAWN_FLOOR = 4;

// --- Enemies ---
const ENEMY_HALF = 11;
const ENEMY_H = 22;
const ENEMY_BASE_SPEED = 46, ENEMY_SPEED_STEP = 8;
const ENEMY_KINDS = ['hotdog', 'egg', 'pickle'];
const ENEMY_SPAWNS = [
    { floor: 0, x: 60 },
    { floor: 0, x: 540 },
    { floor: 0, x: 380 },
    { floor: 0, x: 220 },
    { floor: 0, x: 460 },
];
const MAX_ENEMIES = ENEMY_SPAWNS.length;
const RESPAWN_DELAY = 4;
const HIT_DX = 18, HIT_DY = 22;

// --- Pepper ---
const START_PEPPERS = 5;
const MAX_PEPPERS = 9;
const CLOUD_GAP = 10;     // px in front of the chef where the cloud begins
const CLOUD_W = 40;
const CLOUD_LIFE = 0.35;
const CLOUD_REACH = CLOUD_W / 2 + 6;
const STUN_TIME = 3;

// --- Scoring / pacing ---
const DROP_POINTS = 50;
const SQUASH_POINTS = 100;
const LEVEL_BONUS = 1000;
const CLEAR_DELAY = 2.5;
const START_LIVES = 3;

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
let state, score, best, level, lives, peppers, clearTimer;
const chef = { x: SPAWN_X, y: 0, dir: 1, invuln: 0 };
const ingredients = [];
const enemies = [];
const clouds = [];
const plates = [[], [], [], []];
const input = { left: false, right: false, up: false, down: false };

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const ladderXs = LADDER_COLS.map((c) => (c + 0.5) * TILE);

function floorY(index) { return FLOOR_ROWS[index] * TILE; }
function stackLeftX(stack) { return STACK_COLS[stack] * TILE; }
function stackCentreX(stack) { return stackLeftX(stack) + ING_W / 2; }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Index of the floor an entity is standing on, or null when it is mid-ladder.
function floorIndexAtY(y) {
    for (let i = 0; i < FLOORS; i++) {
        if (Math.abs(y - floorY(i)) <= FLOOR_SNAP) return i;
    }
    return null;
}

// Index of the closest floor — always defined, used by the enemy chase so it
// still has something to aim at while the chef is halfway up a ladder.
function nearestFloorIndex(y) {
    let closest = 0;
    for (let i = 1; i < FLOORS; i++) {
        if (Math.abs(y - floorY(i)) < Math.abs(y - floorY(closest))) closest = i;
    }
    return closest;
}

// Centre of the ladder an entity is close enough to use, or null.
function ladderXNear(x) {
    for (const lx of ladderXs) {
        if (Math.abs(x - lx) <= LADDER_SNAP) return lx;
    }
    return null;
}

// The ladder that minimises the total walk: to the ladder, then on to `toX`.
function bestLadderX(fromX, toX) {
    let pick = ladderXs[0];
    let bestCost = Infinity;
    for (const lx of ladderXs) {
        const cost = Math.abs(fromX - lx) + Math.abs(lx - toX);
        if (cost < bestCost) { bestCost = cost; pick = lx; }
    }
    return pick;
}

function enemySpeed() { return ENEMY_BASE_SPEED + (level - 1) * ENEMY_SPEED_STEP; }
function enemyCount() { return Math.min(1 + level, MAX_ENEMIES); }

// ---------------------------------------------------------------------------
// Board setup
// ---------------------------------------------------------------------------

function buildIngredients() {
    ingredients.length = 0;
    for (let stack = 0; stack < STACK_COLS.length; stack++) {
        for (let floor = 0; floor < INGREDIENTS_PER_STACK; floor++) {
            ingredients.push({
                stack,
                floor,
                type: INGREDIENT_TYPES[floor],
                x: stackLeftX(stack),
                y: floorY(floor),
                segments: new Array(SEGMENTS).fill(false),
                falling: false,
                onPlate: false,
            });
        }
    }
}

function ingredientAt(floor, stack) {
    return ingredients.find((i) => i.floor === floor && i.stack === stack);
}

function makeEnemy(index) {
    const spawn = ENEMY_SPAWNS[index];
    return {
        index,
        kind: ENEMY_KINDS[index % ENEMY_KINDS.length],
        x: spawn.x,
        y: floorY(spawn.floor),
        dir: 1,
        climbing: false,
        climbDir: 1,
        climbTargetY: 0,
        stunned: 0,
        squashed: false,
        respawn: 0,
    };
}

function spawnEnemies() {
    enemies.length = 0;
    for (let i = 0; i < enemyCount(); i++) enemies.push(makeEnemy(i));
}

function respawnEnemy(e) {
    const spawn = ENEMY_SPAWNS[e.index];
    e.x = spawn.x;
    e.y = floorY(spawn.floor);
    e.climbing = false;
    e.stunned = 0;
    e.squashed = false;
    e.respawn = 0;
}

function resetPositions() {
    chef.x = SPAWN_X;
    chef.y = floorY(SPAWN_FLOOR);
    chef.dir = 1;
    chef.invuln = INVULN_TIME;
    for (const key of Object.keys(input)) input[key] = false;
    for (const e of enemies) respawnEnemy(e);
    clouds.length = 0;
}

function buildBoard() {
    buildIngredients();
    for (const plate of plates) plate.length = 0;
    spawnEnemies();
    resetPositions();
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function setInput(name, down) {
    if (name in input) input[name] = !!down;
}

function moveChef(dt) {
    const speed = CHEF_SPEED * dt;

    // Climbing wins over walking, but only on a ladder.
    if (input.up !== input.down) {
        const lx = ladderXNear(chef.x);
        if (lx !== null) {
            const dirY = input.up ? -1 : 1;
            const ny = clamp(chef.y + dirY * speed, floorY(0), floorY(FLOORS - 1));
            if (ny !== chef.y) {
                chef.x = lx;
                chef.y = ny;
                return;
            }
        }
    }

    // Walking only happens with both feet on a platform.
    const f = floorIndexAtY(chef.y);
    if (f === null) return;
    chef.y = floorY(f);
    if (input.left && !input.right) {
        chef.dir = -1;
        chef.x = Math.max(CHEF_HALF, chef.x - speed);
    } else if (input.right && !input.left) {
        chef.dir = 1;
        chef.x = Math.min(CANVAS_W - CHEF_HALF, chef.x + speed);
    }
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

function dropIngredient(ing) {
    if (!ing || ing.falling || ing.onPlate) return;
    ing.falling = true;
    score += DROP_POINTS;
    updateHud();
}

// While the chef stands on an ingredient's floor his centre presses whichever
// segment he is over. All three pressed knocks the ingredient loose.
function pressSegments() {
    const f = floorIndexAtY(chef.y);
    if (f === null) return;
    for (const ing of ingredients) {
        if (ing.falling || ing.onPlate || ing.floor !== f) continue;
        const left = stackLeftX(ing.stack);
        if (chef.x < left || chef.x > left + ING_W) continue;
        const seg = clamp(Math.floor((chef.x - left) / TILE), 0, SEGMENTS - 1);
        if (ing.segments[seg]) continue;
        ing.segments[seg] = true;
        if (ing.segments.every(Boolean)) dropIngredient(ing);
    }
}

function squashEnemy(e) {
    e.squashed = true;
    e.stunned = 0;
    e.climbing = false;
    e.respawn = RESPAWN_DELAY;
    score += SQUASH_POINTS;
    updateHud();
}

function updateIngredients(dt) {
    for (const ing of ingredients) {
        if (!ing.falling) continue;
        ing.y += FALL_SPEED * dt;

        // Cascade: sweep up any resting piece in the same shaft and ride on it.
        for (const other of ingredients) {
            if (other === ing || other.stack !== ing.stack) continue;
            if (other.falling || other.onPlate) continue;
            if (other.y <= ing.y) continue;                 // only sweep up pieces below
            if (ing.y < other.y - STACK_OFFSET) continue;   // not caught up with it yet
            dropIngredient(other);
            ing.y = other.y - STACK_OFFSET;
        }

        // Anything caught underneath is squashed.
        for (const e of enemies) {
            if (e.squashed) continue;
            if (Math.abs(e.x - stackCentreX(ing.stack)) > ING_W / 2 + ENEMY_HALF) continue;
            if (ing.y >= e.y - ENEMY_H && ing.y - ING_H <= e.y) squashEnemy(e);
        }

        // Landing: the n-th arrival in a shaft rests n steps above the plate.
        const target = PLATE_Y - plates[ing.stack].length * PLATE_STEP;
        if (ing.y >= target) {
            ing.y = target;
            ing.falling = false;
            ing.onPlate = true;
            plates[ing.stack].push(ing);
        }
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function updateEnemies(dt) {
    const targetFloor = nearestFloorIndex(chef.y);

    for (const e of enemies) {
        if (e.squashed) {
            e.respawn -= dt;
            if (e.respawn <= 0) respawnEnemy(e);
            continue;
        }
        if (e.stunned > 0) {
            e.stunned = Math.max(0, e.stunned - dt);
            continue;
        }

        const speed = enemySpeed() * dt;

        if (e.climbing) {
            e.y += e.climbDir * speed;
            const done = e.climbDir > 0 ? e.y >= e.climbTargetY : e.y <= e.climbTargetY;
            if (done) {
                e.y = e.climbTargetY;
                e.climbing = false;
            }
            continue;
        }

        const f = floorIndexAtY(e.y);
        const floor = f === null ? nearestFloorIndex(e.y) : f;
        e.y = floorY(floor);

        if (floor === targetFloor) {
            e.dir = chef.x > e.x ? 1 : -1;
            e.x = clamp(e.x + e.dir * speed, ENEMY_HALF, CANVAS_W - ENEMY_HALF);
            continue;
        }

        // Different floor: walk to the handiest ladder, then climb one floor.
        const lx = bestLadderX(e.x, chef.x);
        if (Math.abs(e.x - lx) <= Math.max(speed, 1)) {
            e.x = lx;
            e.climbDir = targetFloor > floor ? 1 : -1;
            e.climbTargetY = floorY(floor + e.climbDir);
            e.climbing = true;
        } else {
            e.dir = lx > e.x ? 1 : -1;
            e.x += e.dir * speed;
        }
    }
}

function checkChefHit() {
    if (chef.invuln > 0) return;
    for (const e of enemies) {
        if (e.squashed || e.stunned > 0) continue;
        if (Math.abs(e.x - chef.x) < HIT_DX && Math.abs(e.y - chef.y) < HIT_DY) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function spray() {
    if (state !== 'running' || peppers <= 0) return;
    peppers -= 1;
    clouds.push({
        x: chef.x + chef.dir * (CLOUD_GAP + CLOUD_W / 2),
        y: chef.y,
        life: CLOUD_LIFE,
    });
    updateHud();
}

function updateClouds(dt) {
    for (let i = clouds.length - 1; i >= 0; i--) {
        const c = clouds[i];
        c.life -= dt;
        for (const e of enemies) {
            if (e.squashed) continue;
            if (Math.abs(e.x - c.x) > CLOUD_REACH) continue;
            if (Math.abs(e.y - c.y) >= HIT_DY) continue;
            e.stunned = STUN_TIME;
            e.climbing = false;
        }
        if (c.life <= 0) clouds.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function loseLife() {
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        updateHud();
        endGame();
        return;
    }
    resetPositions();
    updateHud();
}

function checkLevelComplete() {
    if (!plates.every((p) => p.length === INGREDIENTS_PER_STACK)) return;
    score += LEVEL_BONUS;
    state = 'levelclear';
    clearTimer = CLEAR_DELAY;
    updateHud();
    showOverlay(`LEVEL ${level} CLEARED`, `Score ${score}`, 'Get ready…');
}

function nextLevel() {
    level += 1;
    peppers = Math.min(peppers + 1, MAX_PEPPERS);
    buildBoard();
    state = 'running';
    updateHud();
    hideOverlay();
}

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    peppers = START_PEPPERS;
    clearTimer = 0;
    buildBoard();
    state = 'running';
    updateHud();
    hideOverlay();
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

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (err) { /* private mode */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to play again');
}

// ---------------------------------------------------------------------------
// Simulation — the single entry point the tests drive
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        return;
    }
    if (state !== 'running') return;

    if (chef.invuln > 0) chef.invuln = Math.max(0, chef.invuln - dt);

    moveChef(dt);
    pressSegments();
    updateIngredients(dt);
    updateEnemies(dt);
    updateClouds(dt);
    checkChefHit();
    checkLevelComplete();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    livesEl.textContent = lives;
    peppersEl.textContent = peppers;
    bestEl.textContent = best;
}

function showOverlay(title, sub, hint) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub;
    overlaySub.textContent = hint;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const INGREDIENT_COLORS = {
    bunTop: { body: '#d99244', edge: '#b06f2c' },
    lettuce: { body: '#5db855', edge: '#3f8c39' },
    patty: { body: '#7a4a2b', edge: '#57331d' },
    bunBottom: { body: '#d99244', edge: '#b06f2c' },
};

const ENEMY_COLORS = {
    hotdog: { body: '#d4553c', trim: '#f0c070' },
    egg: { body: '#f4ead2', trim: '#f2c14e' },
    pickle: { body: '#7fae3f', trim: '#527a25' },
};

function drawBoard() {
    ctx.fillStyle = '#120c19';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Plates.
    for (let s = 0; s < STACK_COLS.length; s++) {
        const cx = stackCentreX(s);
        ctx.fillStyle = '#cfd6e4';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 16, ING_W / 2 + 6, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9aa4b8';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 19, ING_W / 2 + 6, 6, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Ladders, drawn behind the platforms.
    for (const lx of ladderXs) {
        ctx.strokeStyle = '#5f7bb0';
        ctx.lineWidth = 3;
        for (const dx of [-9, 9]) {
            ctx.beginPath();
            ctx.moveTo(lx + dx, floorY(0));
            ctx.lineTo(lx + dx, floorY(FLOORS - 1));
            ctx.stroke();
        }
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#43598a';
        for (let y = floorY(0) + 10; y < floorY(FLOORS - 1); y += 12) {
            ctx.beginPath();
            ctx.moveTo(lx - 9, y);
            ctx.lineTo(lx + 9, y);
            ctx.stroke();
        }
    }

    // Platforms.
    for (let f = 0; f < FLOORS; f++) {
        const y = floorY(f);
        ctx.fillStyle = '#3d4d73';
        ctx.fillRect(0, y + 2, CANVAS_W, 6);
        ctx.fillStyle = '#8ea4d2';
        ctx.fillRect(0, y, CANVAS_W, 2);
    }
}

function drawIngredient(ing) {
    const colors = INGREDIENT_COLORS[ing.type];
    for (let seg = 0; seg < SEGMENTS; seg++) {
        const x = ing.x + seg * TILE;
        const sunk = !ing.falling && !ing.onPlate && ing.segments[seg] ? 4 : 0;
        const top = ing.y - 4 + sunk;

        if (ing.type === 'bunTop') {
            ctx.fillStyle = colors.body;
            ctx.beginPath();
            ctx.moveTo(x, top + ING_H);
            ctx.lineTo(x, top + 5);
            ctx.quadraticCurveTo(x + TILE / 2, top - 5, x + TILE, top + 5);
            ctx.lineTo(x + TILE, top + ING_H);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#fff3d6';
            ctx.fillRect(x + 8, top + 1, 3, 2);
            ctx.fillRect(x + 24, top + 3, 3, 2);
        } else if (ing.type === 'lettuce') {
            ctx.fillStyle = colors.body;
            ctx.beginPath();
            ctx.moveTo(x, top + ING_H);
            for (let i = 0; i <= 4; i++) {
                ctx.lineTo(x + (i * TILE) / 4, top + (i % 2 === 0 ? 2 : -2));
            }
            ctx.lineTo(x + TILE, top + ING_H);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillStyle = colors.body;
            ctx.fillRect(x, top, TILE, ING_H);
        }

        ctx.strokeStyle = colors.edge;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, top + 0.5, TILE - 1, ING_H - 1);
    }
}

function drawEnemy(e) {
    const colors = ENEMY_COLORS[e.kind];
    const h = e.squashed ? 7 : ENEMY_H;
    const w = e.squashed ? ENEMY_HALF * 2 + 8 : ENEMY_HALF * 2;
    const top = e.y - h;

    ctx.globalAlpha = e.stunned > 0 ? 0.55 : 1;
    ctx.fillStyle = colors.body;
    ctx.fillRect(e.x - w / 2, top, w, h);
    ctx.fillStyle = colors.trim;
    ctx.fillRect(e.x - w / 2, top + h - 3, w, 3);

    if (!e.squashed) {
        ctx.fillStyle = '#1a1020';
        ctx.fillRect(e.x - 6, top + 6, 4, 4);
        ctx.fillRect(e.x + 2, top + 6, 4, 4);
        if (e.stunned > 0) {
            ctx.fillStyle = '#f6a623';
            ctx.fillRect(e.x - 5, top - 5, 10, 3);
        }
    }
    ctx.globalAlpha = 1;
}

function drawChef() {
    // Blink while invulnerable so the respawn is readable.
    if (chef.invuln > 0 && Math.floor(chef.invuln * 12) % 2 === 0) return;

    const top = chef.y - CHEF_H;
    ctx.fillStyle = '#f3ece2';           // hat
    ctx.fillRect(chef.x - 8, top, 16, 6);
    ctx.fillStyle = '#f0c9a0';           // face
    ctx.fillRect(chef.x - 6, top + 6, 12, 6);
    ctx.fillStyle = '#f3ece2';           // apron
    ctx.fillRect(chef.x - 9, top + 12, 18, 9);
    ctx.fillStyle = '#3a6ea5';           // legs
    ctx.fillRect(chef.x - 8, top + 21, 6, 5);
    ctx.fillRect(chef.x + 2, top + 21, 6, 5);
    ctx.fillStyle = '#1a1020';           // eye, facing the way he walks
    ctx.fillRect(chef.x + (chef.dir > 0 ? 1 : -4), top + 8, 3, 3);
}

function drawClouds() {
    for (const c of clouds) {
        ctx.globalAlpha = Math.max(0, Math.min(1, c.life / CLOUD_LIFE)) * 0.85;
        ctx.fillStyle = '#e8e2f0';
        for (let i = 0; i < 4; i++) {
            const px = c.x - CLOUD_W / 2 + (i * CLOUD_W) / 3;
            ctx.beginPath();
            ctx.arc(px, c.y - 12 + (i % 2 === 0 ? -3 : 3), 7, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

function draw() {
    drawBoard();
    for (const ing of ingredients) drawIngredient(ing);
    drawClouds();
    for (const e of enemies) drawEnemy(e);
    if (state !== 'idle') drawChef();
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
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const KEY_INPUTS = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
};

window.addEventListener('keydown', (e) => {
    if (e.repeat && !(e.code in KEY_INPUTS)) return;

    if (e.code in KEY_INPUTS) {
        setInput(KEY_INPUTS[e.code], true);
        e.preventDefault();
        return;
    }
    if (e.code === 'Space') {
        e.preventDefault();
        if (state === 'running') spray();
        else if (state === 'idle' || state === 'over') startGame();
        return;
    }
    if (e.code === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        return;
    }
    if (e.code === 'KeyP') {
        togglePause();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code in KEY_INPUTS) setInput(KEY_INPUTS[e.code], false);
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else if (state !== 'running') startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
peppers = START_PEPPERS;
clearTimer = 0;
buildIngredients();
chef.y = floorY(SPAWN_FLOOR);
updateHud();
requestAnimationFrame(frame);
