// ---------------------------------------------------------------------------
// BurgerTime — walk the burger down, dodge the food.
//
// The chef roams a lattice of floors and ladders. Treading over every segment
// of an ingredient drops it a floor; drop each piece of a stack onto the plate
// at the bottom to build the burger. Hot dogs, pickles and eggs hunt the chef;
// a shake of pepper freezes them, a falling patty flattens them.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright specs as plain globals, matching Kaboom, Snake
// and Tetris in this repo. All motion is per-second and advanced through
// `step(dt)`, so the tests drive the simulation deterministically instead of
// waiting on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 560;
const FLOOR_Y = [80, 160, 240, 320, 400, 480];   // y of each walking surface
const BOTTOM_FLOOR = FLOOR_Y.length - 1;
const PLATE_FLOOR = FLOOR_Y.length;              // sentinel "below the last floor"
const COLUMN_X = [16, 176, 336, 496];            // left edge of each burger column
const SEG_W = 32;
const ING_W = SEG_W * 4;
const ING_H = 12;
const PLATE_Y = 534;

// Full-height ladders sit at the column centres; the ones in the gaps stop one
// floor short of the top, so the top floor is only reachable through a burger.
const LADDERS = [
    { x: 80, top: 0, bottom: 5 },
    { x: 160, top: 1, bottom: 5 },
    { x: 240, top: 0, bottom: 5 },
    { x: 320, top: 1, bottom: 5 },
    { x: 400, top: 0, bottom: 5 },
    { x: 480, top: 1, bottom: 5 },
    { x: 560, top: 0, bottom: 5 },
];
const LADDER_SNAP = 8;

// --- Chef ---
const CHEF_W = 18;
const CHEF_H = 26;
const CHEF_SPEED = 95;    // px/s walking
const CLIMB_SPEED = 70;   // px/s on a ladder
const CHEF_MIN_X = CHEF_W / 2 + 8;
const CHEF_MAX_X = CANVAS_W - CHEF_W / 2 - 8;
const START_LIVES = 3;

// --- Monsters ---
const MON_W = 20;
const MON_H = 22;
const MON_BASE = 42, MON_STEP = 6;               // px/s, scaled by level
const SPAWN_FIRST = 3;                           // seconds before the first one
const SPAWN_BASE = 6, SPAWN_STEP = 0.6, SPAWN_MIN = 2.5;
const MON_TYPES = ['hotdog', 'pickle', 'egg'];

// --- Pepper ---
const START_PEPPER = 5;
const PEPPER_REACH = 28;
const PEPPER_LIFE = 0.6;
const PEPPER_R = 22;
const STUN_TIME = 4;

// --- Ingredients ---
const FALL_SPEED = 190;
const ING_TYPES = ['topBun', 'lettuce', 'patty', 'bottomBun'];
// Starting floor of each type, per column. Lower pieces of a stack start lower
// down so a burger always assembles in the right visual order.
const START_FLOORS = [
    [0, 1, 2, 3],
    [0, 2, 3, 4],
    [1, 2, 3, 4],
    [0, 1, 2, 4],
];

// --- Scoring ---
const DROP_POINTS = 50;
const SQUASH_BASE = 500;
const SQUASH_MAX = 4000;
const LEVEL_BONUS = 1000;
const LEVEL_CLEAR_TIME = 2;

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
// state: 'idle' | 'running' | 'paused' | 'levelclear' | 'over'
let state, score, best, lives, level, pepper, spawnTimer, clearTimer, spawnSide;
const chef = { x: 0, y: 0, floor: BOTTOM_FLOOR, dir: 1, climbTarget: BOTTOM_FLOOR, riding: null };
const ingredients = [];
const monsters = [];
const peppers = [];
const input = { left: false, right: false, up: false, down: false };

// ---------------------------------------------------------------------------
// Difficulty (pure functions of `level`)
// ---------------------------------------------------------------------------

function monsterSpeed() { return MON_BASE + (level - 1) * MON_STEP; }
function spawnInterval() { return Math.max(SPAWN_MIN, SPAWN_BASE - (level - 1) * SPAWN_STEP); }
function maxMonsters() { return Math.min(4, 1 + level); }

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Rest y of an ingredient sitting `stack` pieces up from floor `f`. */
function restY(f, stack) { return FLOOR_Y[f] - ING_H * (stack + 1); }

/** Rest y of the `slot`-th piece on a plate (slot 0 touches the plate). */
function plateY(slot) { return PLATE_Y - ING_H * (slot + 1); }

/** The ladder usable from `floor` heading `dirY` (-1 up, +1 down), or null. */
function ladderFor(x, floor, dirY) {
    let bestLadder = null, bestDist = Infinity;
    for (const l of LADDERS) {
        const spans = dirY < 0
            ? l.top <= floor - 1 && l.bottom >= floor
            : l.top <= floor && l.bottom >= floor + 1;
        if (!spans) continue;
        const d = Math.abs(x - l.x);
        if (d <= LADDER_SNAP && d < bestDist) { bestLadder = l; bestDist = d; }
    }
    return bestLadder;
}

/** Nearest ladder x reachable from `floor` in direction `dirY`, ignoring snap. */
function nearestLadderX(x, floor, dirY) {
    let bestX = null, bestDist = Infinity;
    for (const l of LADDERS) {
        const spans = dirY < 0
            ? l.top <= floor - 1 && l.bottom >= floor
            : l.top <= floor && l.bottom >= floor + 1;
        if (!spans) continue;
        const d = Math.abs(x - l.x);
        if (d < bestDist) { bestX = l.x; bestDist = d; }
    }
    return bestX;
}

/** The two floors a mid-ladder y sits between. */
function bracketFloors(y) {
    let below = BOTTOM_FLOOR;
    for (let i = 0; i < FLOOR_Y.length; i++) {
        if (FLOOR_Y[i] > y) { below = i; break; }
    }
    return { above: below - 1, below };
}

function plateCount(col) {
    return ingredients.filter((i) => i.col === col && i.onPlate).length;
}

// ---------------------------------------------------------------------------
// Board setup
// ---------------------------------------------------------------------------

function buildIngredients() {
    ingredients.length = 0;
    for (let col = 0; col < COLUMN_X.length; col++) {
        ING_TYPES.forEach((type, k) => {
            const floor = START_FLOORS[col][k];
            ingredients.push({
                col,
                type,
                floor,
                stack: 0,
                x: COLUMN_X[col],
                y: restY(floor, 0),
                stepped: [false, false, false, false],
                falling: false,
                onPlate: false,
                target: floor,
                chain: 0,
            });
        });
    }
}

function resetChef() {
    chef.x = CANVAS_W / 2;
    chef.y = FLOOR_Y[BOTTOM_FLOOR];
    chef.floor = BOTTOM_FLOOR;
    chef.climbTarget = BOTTOM_FLOOR;
    chef.dir = 1;
    chef.riding = null;
}

/** Rebuild the board for a fresh level (or a fresh idle screen). */
function resetLevel() {
    buildIngredients();
    monsters.length = 0;
    peppers.length = 0;
    pepper = START_PEPPER;
    spawnTimer = SPAWN_FIRST;
    spawnSide = 0;
    resetChef();
    updateHud();
}

/** Softer reset after losing a chef: the burger keeps whatever it has plated. */
function resetAfterDeath() {
    monsters.length = 0;
    peppers.length = 0;
    pepper = START_PEPPER;
    spawnTimer = SPAWN_FIRST;
    for (const ing of ingredients) ing.stepped = [false, false, false, false];
    resetChef();
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    resetLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level++;
    resetLevel();
    state = 'running';
    updateHud();
}

function checkLevelClear() {
    if (!ingredients.every((i) => i.onPlate)) return;
    score += LEVEL_BONUS * level;
    state = 'levelclear';
    clearTimer = LEVEL_CLEAR_TIME;
    updateHud();
}

function loseLife() {
    lives--;
    updateHud();
    if (lives <= 0) { gameOver(); return; }
    resetAfterDeath();
}

function gameOver() {
    lives = 0;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Enter to cook again');
}

function togglePause() {
    if (state === 'running') { state = 'paused'; showOverlay('PAUSED', '', 'Press P to resume'); }
    else if (state === 'paused') { state = 'running'; hideOverlay(); }
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function climbMove(dt) {
    const target = clamp(chef.climbTarget, 0, BOTTOM_FLOOR);
    chef.climbTarget = target;
    const ty = FLOOR_Y[target];
    const v = Math.sign(ty - chef.y);
    if (v === 0) { chef.y = ty; chef.floor = target; return; }
    chef.y += v * CLIMB_SPEED * dt;
    if ((v < 0 && chef.y <= ty) || (v > 0 && chef.y >= ty)) {
        chef.y = ty;
        chef.floor = target;
    }
}

function updateChef(dt) {
    if (chef.riding) return;                 // riding an ingredient down
    const dirY = input.up ? -1 : (input.down ? 1 : 0);

    if (chef.floor !== -1) {
        if (dirY !== 0) {
            const ladder = ladderFor(chef.x, chef.floor, dirY);
            if (ladder) {
                chef.x = ladder.x;
                chef.climbTarget = chef.floor + dirY;
                chef.floor = -1;
                climbMove(dt);
                return;
            }
        }
        const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        if (dx !== 0) {
            chef.dir = dx;
            chef.x = clamp(chef.x + dx * CHEF_SPEED * dt, CHEF_MIN_X, CHEF_MAX_X);
        }
        treadIngredients();
        return;
    }

    // Mid-ladder: only vertical input moves the chef, and it can be reversed.
    if (dirY !== 0) {
        const b = bracketFloors(chef.y);
        chef.climbTarget = dirY < 0 ? b.above : b.below;
        climbMove(dt);
    }
}

/** Mark the ingredient segments under the chef, dropping fully-trodden pieces. */
function treadIngredients() {
    for (const ing of ingredients) {
        if (ing.falling || ing.onPlate || ing.floor !== chef.floor) continue;
        const seg = Math.floor((chef.x - ing.x) / SEG_W);
        if (seg < 0 || seg > 3) continue;
        ing.stepped[seg] = true;
        if (ing.stepped.every(Boolean)) dropIngredient(ing);
    }
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

/** Start an ingredient falling toward the floor below it (or the plate). */
function dropIngredient(ing) {
    if (ing.falling || ing.onPlate) return;
    ing.falling = true;
    ing.chain = 0;
    ing.stepped = [false, false, false, false];
    ing.target = ing.floor + 1 <= BOTTOM_FLOOR ? ing.floor + 1 : PLATE_FLOOR;
    score += DROP_POINTS;
    if (!chef.riding && chef.floor === ing.floor &&
        chef.x >= ing.x && chef.x <= ing.x + ING_W) {
        chef.riding = ing;
    }
    updateHud();
}

function squash(ing) {
    for (let i = monsters.length - 1; i >= 0; i--) {
        const m = monsters[i];
        const overlapX = m.x + MON_W / 2 > ing.x && m.x - MON_W / 2 < ing.x + ING_W;
        const overlapY = ing.y + ING_H > m.y - MON_H && ing.y < m.y;
        if (!overlapX || !overlapY) continue;
        monsters.splice(i, 1);
        ing.chain++;
        score += Math.min(SQUASH_MAX, SQUASH_BASE * Math.pow(2, ing.chain - 1));
    }
}

function landOnFloor(ing, floor, stack) {
    ing.falling = false;
    ing.floor = floor;
    ing.stack = stack;
    ing.y = restY(floor, stack);
    ing.stepped = [false, false, false, false];
    if (chef.riding === ing) {
        chef.riding = null;
        chef.floor = floor;
        chef.climbTarget = floor;
        chef.y = FLOOR_Y[floor];
    }
}

function landOnPlate(ing) {
    const slot = plateCount(ing.col);
    ing.falling = false;
    ing.onPlate = true;
    ing.floor = BOTTOM_FLOOR;
    ing.stack = slot;
    ing.y = plateY(slot);
    ing.stepped = [false, false, false, false];
    if (chef.riding === ing) {
        chef.riding = null;
        chef.floor = BOTTOM_FLOOR;
        chef.climbTarget = BOTTOM_FLOOR;
        chef.y = FLOOR_Y[BOTTOM_FLOOR];
    }
}

function updateIngredients(dt) {
    // Lowest first, so a group landing together fills the plate bottom-up.
    const falling = ingredients.filter((i) => i.falling).sort((a, b) => b.y - a.y);
    for (const ing of falling) {
        if (!ing.falling) continue;             // knocked into another group mid-loop
        ing.y += FALL_SPEED * dt;
        squash(ing);
        if (chef.riding === ing) chef.y = ing.y + ING_H;

        if (ing.target >= PLATE_FLOOR) {
            if (ing.y >= plateY(plateCount(ing.col))) landOnPlate(ing);
            continue;
        }

        const floor = ing.target;
        if (ing.y < restY(floor, ing.stack)) continue;

        const resting = ingredients.filter(
            (o) => o !== ing && !o.falling && !o.onPlate && o.col === ing.col && o.floor === floor
        );
        if (resting.length === 0) { landOnFloor(ing, floor, ing.stack); continue; }

        // Chain drop: everything resting here is knocked loose and the arriving
        // group rides one layer higher on top of it.
        const group = ingredients.filter((o) => o.falling && o.col === ing.col && o.target === floor);
        for (const g of group) {
            g.floor = floor;
            g.stack += resting.length;
            g.target = floor + 1 <= BOTTOM_FLOOR ? floor + 1 : PLATE_FLOOR;
        }
        for (const r of resting) dropIngredient(r);
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function firePepper() {
    if (state !== 'running' || pepper <= 0) return;
    pepper--;
    peppers.push({ x: chef.x + chef.dir * PEPPER_REACH, y: chef.y, life: PEPPER_LIFE });
    updateHud();
}

function updatePeppers(dt) {
    for (let i = peppers.length - 1; i >= 0; i--) {
        const p = peppers[i];
        p.life -= dt;
        for (const m of monsters) {
            if (Math.abs(m.x - p.x) < PEPPER_R && Math.abs(m.y - p.y) < 20) m.stun = STUN_TIME;
        }
        if (p.life <= 0) peppers.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

function spawnMonster() {
    const fromLeft = spawnSide++ % 2 === 0;
    const m = {
        type: MON_TYPES[monsters.length % MON_TYPES.length],
        x: fromLeft ? 24 : CANVAS_W - 24,
        y: FLOOR_Y[BOTTOM_FLOOR],
        floor: BOTTOM_FLOOR,
        climbTarget: BOTTOM_FLOOR,
        dir: fromLeft ? 1 : -1,
        stun: 0,
    };
    monsters.push(m);
    return m;
}

function moveMonster(m, dt) {
    const speed = monsterSpeed();

    if (m.floor === -1) {                       // mid-ladder: keep climbing
        const ty = FLOOR_Y[m.climbTarget];
        const v = Math.sign(ty - m.y);
        m.y += v * speed * dt;
        if ((v < 0 && m.y <= ty) || (v > 0 && m.y >= ty)) { m.y = ty; m.floor = m.climbTarget; }
        return;
    }

    const chefFloor = chef.floor === -1 ? bracketFloors(chef.y).below : chef.floor;
    if (chefFloor !== m.floor) {
        const dirY = chefFloor > m.floor ? 1 : -1;
        const lx = nearestLadderX(m.x, m.floor, dirY);
        if (lx !== null) {
            if (Math.abs(m.x - lx) <= 2) {
                m.x = lx;
                m.climbTarget = m.floor + dirY;
                m.floor = -1;
                return;
            }
            const dx = Math.sign(lx - m.x);
            m.dir = dx;
            m.x += dx * speed * dt;
            if ((dx > 0 && m.x > lx) || (dx < 0 && m.x < lx)) m.x = lx;
            return;
        }
    }

    const dx = Math.sign(chef.x - m.x);
    if (dx !== 0) { m.dir = dx; m.x += dx * speed * dt; }
}

function updateMonsters(dt) {
    spawnTimer -= dt;
    if (spawnTimer <= 0 && monsters.length < maxMonsters()) {
        spawnMonster();
        spawnTimer = spawnInterval();
    }
    for (const m of monsters) {
        if (m.stun > 0) { m.stun = Math.max(0, m.stun - dt); continue; }
        moveMonster(m, dt);
    }
}

function checkChefHit() {
    for (const m of monsters) {
        if (m.stun > 0) continue;
        if (Math.abs(m.x - chef.x) < (MON_W + CHEF_W) / 2 - 5 && Math.abs(m.y - chef.y) < 18) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Simulation step
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        return;
    }
    if (state !== 'running') return;
    updateChef(dt);
    updateIngredients(dt);
    updatePeppers(dt);
    updateMonsters(dt);
    checkChefHit();
    if (state === 'running') checkLevelClear();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    livesEl.textContent = lives;
    pepperEl.textContent = pepper;
    bestEl.textContent = best;
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() { overlay.classList.remove('visible'); }

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ING_COLORS = {
    topBun: ['#f3bd70', '#c98a3f'],
    lettuce: ['#7ed24f', '#4e9c2c'],
    patty: ['#9a5f30', '#6a3d1b'],
    bottomBun: ['#e5a55a', '#c98a3f'],
};

function drawFloors() {
    for (const y of FLOOR_Y) {
        ctx.fillStyle = '#8a5b30';
        ctx.fillRect(8, y, CANVAS_W - 16, 5);
        ctx.fillStyle = '#d59a56';                               // lit top edge
        ctx.fillRect(8, y, CANVAS_W - 16, 2);
        ctx.fillStyle = '#5c3a1d';                               // girder hatching
        for (let x = 12; x < CANVAS_W - 16; x += 16) ctx.fillRect(x, y + 3, 8, 2);
    }
}

function drawLadders() {
    for (const l of LADDERS) {
        const top = FLOOR_Y[l.top];
        const bottom = FLOOR_Y[l.bottom];
        ctx.strokeStyle = '#7d9ec2';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(l.x - 9, top); ctx.lineTo(l.x - 9, bottom);
        ctx.moveTo(l.x + 9, top); ctx.lineTo(l.x + 9, bottom);
        ctx.stroke();
        ctx.strokeStyle = '#54748f';
        ctx.beginPath();
        for (let y = top + 10; y < bottom; y += 12) {
            ctx.moveTo(l.x - 9, y); ctx.lineTo(l.x + 9, y);
        }
        ctx.stroke();
    }
}

function drawPlates() {
    for (const x of COLUMN_X) {
        const cx = x + ING_W / 2;
        ctx.fillStyle = '#e6ecf7';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 5, ING_W / 2, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#aab6cd';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 8, ING_W / 2 - 4, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f4f7ff';
        ctx.fillRect(x + 8, PLATE_Y, ING_W - 16, 4);
    }
}

function drawIngredient(ing) {
    const colors = ING_COLORS[ing.type] || ['#e5a55a', '#c98a3f'];
    for (let s = 0; s < 4; s++) {
        const sink = !ing.falling && !ing.onPlate && ing.stepped[s] ? 4 : 0;
        const x = ing.x + s * SEG_W;
        const y = ing.y + sink;
        ctx.fillStyle = colors[0];
        ctx.fillRect(x, y, SEG_W, ING_H - 3);
        ctx.fillStyle = colors[1];
        ctx.fillRect(x, y + ING_H - 4, SEG_W, 4);
        if (ing.type === 'topBun') {
            ctx.fillStyle = '#fbeed0';                            // sesame seeds
            ctx.fillRect(x + 7, y + 2, 4, 2);
            ctx.fillRect(x + 20, y + 4, 4, 2);
        } else if (ing.type === 'lettuce') {
            ctx.fillStyle = '#a7e878';                            // frilly edge
            for (let k = 0; k < 4; k++) ctx.fillRect(x + k * 8, y, 5, 3);
        } else if (ing.type === 'patty') {
            ctx.fillStyle = '#b5794a';
            ctx.fillRect(x + 5, y + 2, 6, 3);
            ctx.fillRect(x + 19, y + 4, 6, 3);
        }
    }
}

function drawChef() {
    const x = Math.round(chef.x), y = Math.round(chef.y);
    ctx.fillStyle = '#ffffff';                                   // toque
    ctx.fillRect(x - 9, y - CHEF_H - 2, 18, 7);
    ctx.fillRect(x - 7, y - CHEF_H + 4, 14, 2);
    ctx.fillStyle = '#f6cda3';                                   // face
    ctx.fillRect(x - 6, y - CHEF_H + 6, 12, 7);
    ctx.fillStyle = '#2a2233';                                   // eye, facing forward
    ctx.fillRect(x + chef.dir * 3 - 1, y - CHEF_H + 8, 2, 3);
    ctx.fillStyle = '#f0f4ff';                                   // whites
    ctx.fillRect(x - 9, y - CHEF_H + 13, 18, 9);
    ctx.fillStyle = '#e04b4b';                                   // neckerchief
    ctx.fillRect(x - 5, y - CHEF_H + 13, 10, 3);
    ctx.fillStyle = '#3f5f9e';                                   // legs
    ctx.fillRect(x - 7, y - 5, 5, 5);
    ctx.fillRect(x + 2, y - 5, 5, 5);
}

const MON_COLORS = {
    hotdog: ['#e8763c', '#b74f22'],
    pickle: ['#6bb544', '#437a29'],
    egg: ['#f4f1e4', '#cfc7ad'],
};

function drawMonster(m) {
    const frozen = m.stun > 0;
    const [body, shade] = frozen ? ['#8fb6e0', '#5f83ad'] : (MON_COLORS[m.type] || MON_COLORS.hotdog);
    const x = Math.round(m.x), y = Math.round(m.y);
    ctx.fillStyle = body;
    ctx.fillRect(x - MON_W / 2, y - MON_H, MON_W, MON_H - 5);
    ctx.fillStyle = shade;
    ctx.fillRect(x - MON_W / 2, y - 9, MON_W, 4);
    ctx.fillStyle = '#fdfdff';                                   // eyes
    ctx.fillRect(x - 6, y - MON_H + 5, 5, 5);
    ctx.fillRect(x + 1, y - MON_H + 5, 5, 5);
    ctx.fillStyle = '#1d1526';
    ctx.fillRect(x - 5 + (m.dir > 0 ? 2 : 0), y - MON_H + 6, 2, 3);
    ctx.fillRect(x + 2 + (m.dir > 0 ? 2 : 0), y - MON_H + 6, 2, 3);
    ctx.fillStyle = shade;                                       // feet
    ctx.fillRect(x - 8, y - 5, 6, 5);
    ctx.fillRect(x + 2, y - 5, 6, 5);
    if (frozen) {                                                // pepper sparkle
        ctx.fillStyle = '#e8f2ff';
        ctx.fillRect(x - 1, y - MON_H - 6, 2, 4);
        ctx.fillRect(x - 4, y - MON_H - 4, 8, 2);
    }
}

function drawPepperClouds() {
    for (const p of peppers) {
        ctx.globalAlpha = clamp(p.life / PEPPER_LIFE, 0, 1);
        ctx.fillStyle = '#fff8e8';
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(p.x + Math.cos(a) * 11, p.y - 13 + Math.sin(a) * 9, 6, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = '#3a2b16';                               // specks of pepper
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + 0.4;
            ctx.fillRect(p.x + Math.cos(a) * 8 - 1, p.y - 13 + Math.sin(a) * 6 - 1, 2, 2);
        }
        ctx.globalAlpha = 1;
    }
}

function draw() {
    ctx.fillStyle = '#1a1322';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#221830';                                   // tiled kitchen wall
    for (let y = 0; y < CANVAS_H; y += 40) {
        for (let x = ((y / 40) % 2) * 20; x < CANVAS_W; x += 40) ctx.fillRect(x, y, 19, 19);
    }

    drawLadders();
    drawFloors();
    drawPlates();
    for (const ing of ingredients) drawIngredient(ing);
    for (const m of monsters) drawMonster(m);
    drawPepperClouds();
    drawChef();

    if (state === 'levelclear') {
        ctx.fillStyle = 'rgba(18, 12, 22, 0.7)';
        ctx.fillRect(0, CANVAS_H / 2 - 30, CANVAS_W, 60);
        ctx.fillStyle = '#f2a33c';
        ctx.font = 'bold 26px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`BURGER ${level} SERVED!`, CANVAS_W / 2, CANVAS_H / 2 + 9);
        ctx.textAlign = 'left';
    }
}

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;                   // clamp after tab switches
    if (state === 'running' || state === 'levelclear') step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const KEY_MAP = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
};

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else firePepper();
        e.preventDefault();
        return;
    }
    const action = KEY_MAP[e.key];
    if (action) { input[action] = true; e.preventDefault(); }
});

window.addEventListener('keyup', (e) => {
    const action = KEY_MAP[e.key];
    if (action) input[action] = false;
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0;
score = 0;
lives = START_LIVES;
level = 1;
clearTimer = 0;
resetLevel();
state = 'idle';
updateHud();
requestAnimationFrame(frame);
