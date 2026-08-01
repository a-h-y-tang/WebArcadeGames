// ---------------------------------------------------------------------------
// Burger Chef — a BurgerTime-style platform arcade game on an HTML5 canvas.
//
// The chef runs along five floors joined by ladders. Walking the full width of
// an ingredient flips it down one floor; an ingredient that lands on another
// knocks that one down too, so a well-timed drop from the top can cascade a
// whole burger onto the plate. Hot dogs, eggs and pickles chase the chef, who
// can freeze them with a limited supply of pepper.
//
// Written as a single classic (non-module) script so the state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom, Dino
// Run and Tetris in this repo. All motion is expressed per-second and advanced
// through `step(dt)`, so tests can simulate frames deterministically without
// depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 500;

// Floor lines, top to bottom. The lowest one carries the plates.
const FLOOR_Y = [90, 175, 260, 345, 430];
const PLATE_FLOOR = FLOOR_Y.length - 1;

// Ladder centre lines. Every ladder spans the full height of the board.
const LADDER_X = [16, 208, 400, 592];
const LADDER_SNAP = 12;   // how close the chef must be to grab a ladder
const FLOOR_SNAP = 4;     // how close to a floor line counts as standing on it

// Burger columns. Each ingredient is SEGS segments of SEG_W pixels.
const STACK_X = [32, 224, 416];
const SEG_W = 32;
const SEGS = 4;
const ING_W = SEG_W * SEGS;
const ING_H = 10;

// Ingredient kinds, top of the burger first. A kind's index is also the floor
// it starts on, which is what makes the opening board a neat diagonal.
const INGREDIENT_TYPES = ['bunTop', 'lettuce', 'patty', 'bunBottom'];
const INGREDIENT_COLORS = ['#d9a05b', '#5fbf5f', '#8b4a2f', '#c98b45'];

// --- Chef ---
const CHEF_W = 20;
const CHEF_H = 26;
const CHEF_START_X = 320;
const WALK_SPEED = 112;   // px/s
const CLIMB_SPEED = 92;   // px/s

// --- Ingredients ---
const FALL_SPEED = 240;   // px/s

// --- Enemies ---
const ENEMY_TYPES = ['hotdog', 'egg', 'pickle'];
const ENEMY_COLORS = { hotdog: '#e8663c', egg: '#f0e6c8', pickle: '#6fbf3a' };
const ENEMY_BASE_SPEED = 48;
const ENEMY_SPEED_STEP = 7;
const ENEMY_MAX = 5;
const RESPAWN_DELAY = 3;
const SPAWNS = [
    { x: 24, floor: PLATE_FLOOR },
    { x: 616, floor: PLATE_FLOOR },
    { x: 24, floor: 0 },
    { x: 616, floor: 0 },
    { x: 208, floor: 0 },
];

// --- Pepper ---
const PEPPER_START = 5;
const PEPPER_MAX = 9;
const PEPPER_RANGE = 46;
const PEPPER_STUN = 3;
const CLOUD_LIFE = 0.35;

// --- Scoring ---
const DROP_POINTS = 50;
const SQUASH_POINTS = 100;
const BURGER_BONUS = 500;
const LEVEL_BONUS = 1000;

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
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, level, lives, peppers;
const chef = { x: CHEF_START_X, y: FLOOR_Y[PLATE_FLOOR], floor: PLATE_FLOOR, climbing: false, dx: 0, dy: 0, facing: 1 };
const ingredients = [];
const enemies = [];
const plates = [];
const clouds = [];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clampNum(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// Index of the floor the given y is standing on, or -1 when between floors.
function alignedFloor(y) {
    for (let i = 0; i < FLOOR_Y.length; i++) {
        if (Math.abs(FLOOR_Y[i] - y) <= FLOOR_SNAP) return i;
    }
    return -1;
}

// Index of the closest floor, used for "which storey am I roughly on".
function nearestFloor(y) {
    let best = 0;
    for (let i = 1; i < FLOOR_Y.length; i++) {
        if (Math.abs(FLOOR_Y[i] - y) < Math.abs(FLOOR_Y[best] - y)) best = i;
    }
    return best;
}

function ladderNear(x) {
    for (let i = 0; i < LADDER_X.length; i++) {
        if (Math.abs(LADDER_X[i] - x) <= LADDER_SNAP) return i;
    }
    return -1;
}

function enemySpeed() {
    return ENEMY_BASE_SPEED + (level - 1) * ENEMY_SPEED_STEP;
}

function enemyCount() {
    return Math.min(ENEMY_MAX, 1 + level);
}

function getIngredient(stack, type) {
    return ingredients.find((ing) => ing.stack === stack && ing.type === type);
}

function burgerComplete(stack) {
    return plates[stack].length === INGREDIENT_TYPES.length;
}

// ---------------------------------------------------------------------------
// Board / actor setup
// ---------------------------------------------------------------------------

function resetBoard() {
    ingredients.length = 0;
    plates.length = 0;
    for (let s = 0; s < STACK_X.length; s++) {
        plates.push([]);
        for (let t = 0; t < INGREDIENT_TYPES.length; t++) {
            ingredients.push({
                stack: s,
                type: t,
                floor: t,
                y: FLOOR_Y[t],
                flipped: [false, false, false, false],
                falling: false,
                targetFloor: null,
                served: false,
            });
        }
    }
}

function resetActors() {
    chef.x = CHEF_START_X;
    chef.y = FLOOR_Y[PLATE_FLOOR];
    chef.floor = PLATE_FLOOR;
    chef.climbing = false;
    chef.dx = 0;
    chef.dy = 0;
    chef.facing = 1;

    clouds.length = 0;
    enemies.length = 0;
    for (let i = 0; i < enemyCount(); i++) {
        const spawn = SPAWNS[i % SPAWNS.length];
        const e = spawnEnemy(spawn.x, spawn.floor, ENEMY_TYPES[i % ENEMY_TYPES.length]);
        e.spawnIdx = i % SPAWNS.length;
    }
}

function spawnEnemy(x, floor, type) {
    const e = {
        x,
        y: FLOOR_Y[floor],
        floor,
        climbing: false,
        targetFloor: null,
        type: type || ENEMY_TYPES[enemies.length % ENEMY_TYPES.length],
        alive: true,
        stun: 0,
        respawn: 0,
        spawnIdx: enemies.length % SPAWNS.length,
    };
    enemies.push(e);
    return e;
}

function reviveEnemy(e) {
    const spawn = SPAWNS[e.spawnIdx % SPAWNS.length];
    e.x = spawn.x;
    e.floor = spawn.floor;
    e.y = FLOOR_Y[spawn.floor];
    e.climbing = false;
    e.targetFloor = null;
    e.alive = true;
    e.stun = 0;
    e.respawn = 0;
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function setChef(x, floor) {
    chef.x = x;
    chef.y = FLOOR_Y[floor];
    chef.floor = floor;
    chef.climbing = false;
    chef.dx = 0;
    chef.dy = 0;
    chef.facing = 1;
}

function moveChef(dx, dy) {
    chef.dx = dx;
    chef.dy = dy;
    if (dx !== 0) chef.facing = dx;
}

function stepChef(h) {
    const dx = chef.dx;
    const dy = chef.dy;

    if (dy !== 0) {
        // Climbing takes priority: grab the ladder if one is within reach.
        const li = ladderNear(chef.x);
        if (li >= 0) {
            const ny = clampNum(chef.y + dy * CLIMB_SPEED * h, FLOOR_Y[0], FLOOR_Y[PLATE_FLOOR]);
            if (ny !== chef.y) {
                chef.x = LADDER_X[li];
                chef.y = ny;
                chef.climbing = true;
            }
        }
    } else if (dx !== 0) {
        // Walking is only possible with both feet on a floor line.
        const fi = alignedFloor(chef.y);
        if (fi >= 0) {
            chef.y = FLOOR_Y[fi];
            chef.climbing = false;
            chef.x = clampNum(chef.x + dx * WALK_SPEED * h, CHEF_W / 2, CANVAS_W - CHEF_W / 2);
        }
    }

    // Settle onto a floor when we have come to rest next to one.
    if (dy === 0) {
        const fi = alignedFloor(chef.y);
        if (fi >= 0) {
            chef.y = FLOOR_Y[fi];
            chef.climbing = false;
        }
    }
    chef.floor = nearestFloor(chef.y);
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

// Standing on a segment of a resting ingredient flips that segment down.
function flipSegments() {
    if (chef.climbing) return;
    for (const ing of ingredients) {
        if (ing.served || ing.falling || ing.floor !== chef.floor) continue;
        const rel = chef.x - STACK_X[ing.stack];
        if (rel < 0 || rel >= ING_W) continue;
        const i = Math.floor(rel / SEG_W);
        if (ing.flipped[i]) continue;
        ing.flipped[i] = true;
        if (ing.flipped.every(Boolean)) startFall(ing);
    }
}

function startFall(ing) {
    if (ing.falling || ing.served || ing.floor >= PLATE_FLOOR) return;
    ing.falling = true;
    ing.targetFloor = ing.floor + 1;
    ing.flipped = [false, false, false, false];
    score += DROP_POINTS;
}

function serve(ing) {
    ing.served = true;
    plates[ing.stack].push(ing);
    if (burgerComplete(ing.stack)) score += BURGER_BONUS;
}

// A falling ingredient flattens any enemy it passes through, and the extra
// weight carries it one floor further down.
function squashCheck(ing) {
    const x0 = STACK_X[ing.stack];
    const x1 = x0 + ING_W;
    for (const e of enemies) {
        if (!e.alive) continue;
        if (e.x < x0 || e.x > x1) continue;
        if (Math.abs(e.y - ing.y) > 14) continue;
        e.alive = false;
        e.stun = 0;
        e.climbing = false;
        e.respawn = RESPAWN_DELAY;
        score += SQUASH_POINTS;
        if (ing.targetFloor < PLATE_FLOOR) ing.targetFloor += 1;
    }
}

function stepIngredients(h) {
    const arrived = [];
    for (const ing of ingredients) {
        if (!ing.falling) continue;
        ing.y += FALL_SPEED * h;
        squashCheck(ing);
        const ty = FLOOR_Y[ing.targetFloor];
        if (ing.y >= ty) {
            ing.y = ty;
            ing.floor = ing.targetFloor;
            ing.falling = false;
            ing.targetFloor = null;
            ing.flipped = [false, false, false, false];
            arrived.push(ing);
        }
    }
    if (arrived.length) resolveLandings(arrived);
}

// Ingredients that come down together form a pile and stay put. Landing on a
// pile that was *already* resting there knocks the whole lot down one more
// floor, which is what produces the classic cascade all the way to the plate.
function resolveLandings(arrived) {
    const cells = new Set();
    for (const ing of arrived) {
        if (ing.floor < PLATE_FLOOR) cells.add(ing.stack + ':' + ing.floor);
    }
    for (const key of cells) {
        const [s, f] = key.split(':').map(Number);
        const resting = ingredients.filter(
            (ing) => ing.stack === s && ing.floor === f && !ing.falling && !ing.served,
        );
        const newcomers = resting.filter((ing) => arrived.includes(ing));
        if (resting.length > newcomers.length) {
            for (const ing of resting) startFall(ing);
        }
    }
    for (const ing of arrived) {
        if (ing.floor === PLATE_FLOOR && !ing.served) serve(ing);
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function stepEnemies(h) {
    const sp = enemySpeed();
    for (const e of enemies) {
        if (!e.alive) {
            e.respawn -= h;
            if (e.respawn <= 0) reviveEnemy(e);
            continue;
        }
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - h);
            continue;
        }

        if (e.climbing) {
            const ty = FLOOR_Y[e.targetFloor];
            const d = ty - e.y;
            const mv = Math.sign(d) * sp * h;
            if (Math.abs(mv) >= Math.abs(d)) {
                e.y = ty;
                e.floor = e.targetFloor;
                e.climbing = false;
                e.targetFloor = null;
            } else {
                e.y += mv;
            }
            continue;
        }

        e.y = FLOOR_Y[e.floor];
        if (chef.floor === e.floor) {
            // Same storey: run straight at the chef.
            const d = chef.x - e.x;
            const mv = Math.sign(d) * sp * h;
            e.x = Math.abs(mv) >= Math.abs(d) ? chef.x : e.x + mv;
        } else {
            // Otherwise head for the nearest ladder and change floors.
            let lx = LADDER_X[0];
            for (const cand of LADDER_X) {
                if (Math.abs(cand - e.x) < Math.abs(lx - e.x)) lx = cand;
            }
            const d = lx - e.x;
            if (Math.abs(d) < 1) {
                e.x = lx;
                e.climbing = true;
                e.targetFloor = clampNum(e.floor + (chef.floor > e.floor ? 1 : -1), 0, PLATE_FLOOR);
            } else {
                const mv = Math.sign(d) * sp * h;
                e.x = Math.abs(mv) >= Math.abs(d) ? lx : e.x + mv;
            }
        }
    }
}

function checkChefHit() {
    for (const e of enemies) {
        if (!e.alive || e.stun > 0) continue;
        if (Math.abs(e.x - chef.x) < 14 && Math.abs(e.y - chef.y) < 22) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function sprayPepper() {
    if (state !== 'running' || peppers <= 0) return false;
    peppers -= 1;
    const x0 = chef.facing >= 0 ? chef.x : chef.x - PEPPER_RANGE;
    const x1 = x0 + PEPPER_RANGE;
    clouds.push({ x0, x1, y: chef.y, life: CLOUD_LIFE });
    for (const e of enemies) {
        if (!e.alive || e.climbing) continue;
        if (e.floor !== chef.floor) continue;
        if (e.x >= x0 && e.x <= x1) e.stun = PEPPER_STUN;
    }
    updateHud();
    return true;
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

function substep(h) {
    stepChef(h);
    flipSegments();
    stepIngredients(h);
    stepEnemies(h);
    checkChefHit();
    if (state !== 'running') return;
    if (plates.every((p) => p.length === INGREDIENT_TYPES.length)) nextLevel();
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so fast
// movers never tunnel through floors, ingredients or each other.
function step(dt) {
    if (state !== 'running') return;
    const SUB = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-9) {
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
    level = 1;
    lives = 3;
    peppers = PEPPER_START;
    resetBoard();
    resetActors();
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    score += LEVEL_BONUS;
    peppers = Math.min(PEPPER_MAX, peppers + 1);
    resetBoard();
    resetActors();
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
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgerchef-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Score ' + score + ' · Level ' + level, 'Press Space to play again', 'Play Again');
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

function drawLadders() {
    const top = FLOOR_Y[0];
    const bottom = FLOOR_Y[PLATE_FLOOR];
    ctx.strokeStyle = '#4a5b7d';
    ctx.lineWidth = 2;
    for (const lx of LADDER_X) {
        ctx.beginPath();
        ctx.moveTo(lx - 9, top);
        ctx.lineTo(lx - 9, bottom);
        ctx.moveTo(lx + 9, top);
        ctx.lineTo(lx + 9, bottom);
        ctx.stroke();
        ctx.beginPath();
        for (let y = top + 10; y < bottom; y += 14) {
            ctx.moveTo(lx - 9, y);
            ctx.lineTo(lx + 9, y);
        }
        ctx.stroke();
    }
}

// Tiled kitchen wall behind everything, plus the counter the plates sit on.
function drawBackdrop() {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.strokeStyle = 'rgba(120, 145, 190, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= CANVAS_W; x += 40) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CANVAS_H);
    }
    for (let y = 0; y <= CANVAS_H; y += 40) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(CANVAS_W, y + 0.5);
    }
    ctx.stroke();

    const counterY = FLOOR_Y[PLATE_FLOOR] + 7;
    ctx.fillStyle = '#141d33';
    ctx.fillRect(0, counterY, CANVAS_W, CANVAS_H - counterY);
    ctx.fillStyle = '#1d2947';
    ctx.fillRect(0, counterY, CANVAS_W, 3);
}

function drawFloors() {
    for (let i = 0; i < FLOOR_Y.length; i++) {
        const y = FLOOR_Y[i];
        ctx.fillStyle = i === PLATE_FLOOR ? '#3d4c6b' : '#2c3a55';
        ctx.fillRect(0, y, CANVAS_W, 5);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(0, y, CANVAS_W, 1);
        ctx.fillStyle = '#1a2540';
        ctx.fillRect(0, y + 5, CANVAS_W, 2);
    }
}

function drawPlates() {
    const y = FLOOR_Y[PLATE_FLOOR];
    for (const sx of STACK_X) {
        ctx.fillStyle = '#94a3b8';
        ctx.beginPath();
        ctx.ellipse(sx + ING_W / 2, y + 2, ING_W / 2 + 6, 7, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawIngredientAt(ing, x, y, squashed) {
    const color = INGREDIENT_COLORS[ing.type];
    for (let i = 0; i < SEGS; i++) {
        const sx = x + i * SEG_W;
        const flipped = !squashed && ing.flipped[i];
        const h = flipped ? ING_H - 4 : ING_H;
        const sy = y - h;
        ctx.fillStyle = flipped ? '#f8fafc' : color;
        ctx.fillRect(sx + 1, sy, SEG_W - 2, h);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.fillRect(sx + 1, y - 3, SEG_W - 2, 3);
        if (ing.type === 0) {
            // sesame seeds on the top bun
            ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
            ctx.fillRect(sx + 9, sy + 2, 3, 2);
            ctx.fillRect(sx + 19, sy + 4, 3, 2);
        }
    }
}

function drawIngredients() {
    for (const ing of ingredients) {
        if (ing.served) continue;
        drawIngredientAt(ing, STACK_X[ing.stack], ing.y, false);
    }
    // Served ingredients stack up on the plate, bottom bun lowest.
    for (let s = 0; s < plates.length; s++) {
        const stacked = plates[s].slice().sort((a, b) => b.type - a.type);
        for (let i = 0; i < stacked.length; i++) {
            drawIngredientAt(stacked[i], STACK_X[s], FLOOR_Y[PLATE_FLOOR] - 4 - i * (ING_H - 1), true);
        }
    }
}

function drawChef() {
    const x = chef.x;
    const y = chef.y;
    // drop shadow so the chef reads against the ingredients
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x - CHEF_W / 2 - 1, y - CHEF_H - 8, CHEF_W + 2, CHEF_H + 8);
    // body
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(x - CHEF_W / 2, y - CHEF_H, CHEF_W, CHEF_H - 6);
    // legs
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(x - 8, y - 6, 6, 6);
    ctx.fillRect(x + 2, y - 6, 6, 6);
    // hat
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 9, y - CHEF_H - 7, 18, 7);
    // face
    ctx.fillStyle = '#0b1020';
    const eye = chef.facing >= 0 ? 2 : -6;
    ctx.fillRect(x + eye, y - CHEF_H + 4, 3, 3);
    // apron
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(x - 6, y - 14, 12, 8);
}

function drawEnemies() {
    for (const e of enemies) {
        if (!e.alive) continue;
        const x = e.x;
        const y = e.y;
        ctx.fillStyle = ENEMY_COLORS[e.type] || '#e8663c';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - 11, y - 22, 22, 22, 7);
        else ctx.rect(x - 11, y - 22, 22, 22);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 7, y - 16, 5, 5);
        ctx.fillRect(x + 2, y - 16, 5, 5);
        ctx.fillStyle = '#0b1020';
        ctx.fillRect(x - 6, y - 15, 3, 3);
        ctx.fillRect(x + 3, y - 15, 3, 3);
        if (e.stun > 0) {
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2;
            ctx.strokeRect(x - 12, y - 23, 24, 24);
        }
    }
}

function drawClouds() {
    for (const c of clouds) {
        ctx.globalAlpha = Math.max(0, c.life / CLOUD_LIFE) * 0.8;
        ctx.fillStyle = '#fde68a';
        for (let i = 0; i < 10; i++) {
            const t = i / 9;
            const px = c.x0 + (c.x1 - c.x0) * t;
            const py = c.y - 8 - ((i * 7) % 14);
            ctx.fillRect(px, py, 3, 3);
        }
        ctx.globalAlpha = 1;
    }
}

function draw() {
    drawBackdrop();
    drawLadders();
    drawFloors();
    drawPlates();
    drawIngredients();
    drawClouds();
    drawEnemies();
    drawChef();
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
    if (state === 'running') step(dt);
    stepClouds(dt);
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

function held(keys) {
    return keys.some((k) => heldKeys.has(k));
}

function refreshKeyDir() {
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
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('burgerchef-best') || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
lives = 3;
peppers = PEPPER_START;
resetBoard();
updateHud();
requestAnimationFrame(frame);
