// ---------------------------------------------------------------------------
// BurgerTime — a single-screen arcade platform game on an HTML5 canvas.
//
// The chef runs along a lattice of floors and ladders, walking over burger
// ingredients to knock them down onto the plates at the bottom of the screen
// while hot dogs, eggs and pickles give chase. Written as a single classic
// (non-module) script so the state and helpers are reachable from the Playwright
// tests as plain globals, mirroring Snake, Kaboom and Tetris in this repo.
//
// All motion is expressed per-second and advanced through `step(dt)`, so tests
// can simulate frames deterministically without depending on requestAnimationFrame
// wall-clock timing. See DESIGN.md for the full model.
// ---------------------------------------------------------------------------

// --- World geometry ---
const TILE = 30;                            // grid unit: one ingredient segment
const CANVAS_W = 600;
const CANVAS_H = 480;

const FLOOR_Y = [30, 120, 210, 300, 390];   // walkable floor lines (feet height)
const PLATE_Y = 450;                        // top of the plates
const PLATE_LEVEL = FLOOR_Y.length;         // "level 5" — the plate
const LADDER_X = [15, 165, 315, 465];       // ladder centre columns
const LADDER_SNAP = 15;                     // how close you must be to grab one

// --- Burgers ---
const BURGER_X = [30, 180, 330, 480];       // left edge of each burger column
const BURGER_W = 120;
const SEGMENTS = BURGER_W / TILE;           // one segment per grid tile
const SEG_W = TILE;
const ING_H = 10;                           // drawn thickness of an ingredient
const PLATE_STEP = 9;                       // vertical pitch of a plated stack
const KINDS = ['bunTop', 'lettuce', 'patty', 'bunBase'];

// --- Actors ---
const CHEF_W = 20, CHEF_H = 26, CHEF_SPEED = 96;
const ENEMY_W = 22, ENEMY_H = 26;
const ENEMY_TYPES = {
    hotdog: { speed: 46 },
    egg: { speed: 42 },
    pickle: { speed: 38 },
};
const ENEMY_ORDER = ['hotdog', 'egg', 'pickle'];
const ENEMY_WANDER = 0.02;                  // chance/frame of a random turn off-floor
const FALL_SPEED = 220;

// --- Rules ---
const START_LIVES = 3;
const START_PEPPER = 5;
const SCORE_DROP = 50;
const SCORE_PLATE = 100;
const SCORE_SQUASH = 500;
const SCORE_LEVEL = 1000;
const STUN_TIME = 5;
const PEPPER_LIFE = 0.35, PEPPER_W = 30, PEPPER_H = 26, PEPPER_OFFSET = 8;
const SPAWN_FIRST = 2;                      // seconds before the first enemy
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
// state: 'idle' | 'running' | 'paused' | 'clear' | 'over'
let state = 'idle';
let score = 0, best = 0, level = 1, lives = START_LIVES, pepper = START_PEPPER;
let spawnTimer = SPAWN_FIRST, clearTimer = 0, animTime = 0;
let wishDx = 0, wishDy = 0;
let autoStep = true;        // test hook: false lets a test drive step(dt) itself
let spawnEnabled = true;    // test hook: false suppresses timed enemy spawns

const chef = { x: LADDER_X[2], y: FLOOR_Y[FLOOR_Y.length - 1], dx: 0, dy: 0, facing: 1, hw: CHEF_W / 2 };
const ingredients = [];
const enemies = [];
const peppers = [];
const plateCount = [0, 0, 0, 0];

// ---------------------------------------------------------------------------
// Seeded RNG — keeps enemy behaviour reproducible for the tests.
// ---------------------------------------------------------------------------

let rngState = 0x9e3779b9;

function seedRng(seed) {
    rngState = (seed >>> 0) || 1;
}

function rng() {
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Lattice helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

/** Index of the floor an actor is standing exactly on, or -1 mid-ladder. */
function floorIndexAt(y) {
    for (let i = 0; i < FLOOR_Y.length; i++) {
        if (Math.abs(y - FLOOR_Y[i]) < 0.6) return i;
    }
    return -1;
}

/** Index of the closest floor, whether or not the actor is standing on it. */
function nearestFloorIndex(y) {
    let bestIdx = 0;
    for (let i = 1; i < FLOOR_Y.length; i++) {
        if (Math.abs(y - FLOOR_Y[i]) < Math.abs(y - FLOOR_Y[bestIdx])) bestIdx = i;
    }
    return bestIdx;
}

/** The centre of the ladder within reach of x, or null. */
function ladderXNear(x) {
    for (const lx of LADDER_X) {
        if (Math.abs(x - lx) <= LADDER_SNAP) return lx;
    }
    return null;
}

/** Resting y (bottom edge) of an ingredient at a given level. */
function restY(lvl, plateIndex) {
    if (lvl < PLATE_LEVEL) return FLOOR_Y[lvl];
    return PLATE_Y - (plateIndex || 0) * PLATE_STEP;
}

/** The ingredient resting at (burger, level), ignoring `except`. */
function occupantAt(burger, lvl, except) {
    return ingredients.find((i) =>
        i !== except && i.burger === burger && i.level === lvl && !i.falling && lvl < PLATE_LEVEL) || null;
}

function rectsOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function actorRect(a, w, h) {
    return { x: a.x - w / 2, y: a.y - h, w, h };
}

function ingredientRect(ing) {
    return { x: ing.x, y: ing.y - ING_H, w: BURGER_W, h: ING_H };
}

// ---------------------------------------------------------------------------
// Difficulty (pure functions of `level`)
// ---------------------------------------------------------------------------

function maxEnemies() {
    return Math.min(5, 2 + Math.floor((level - 1) / 2));
}

function spawnInterval() {
    return Math.max(2.5, 6 - (level - 1) * 0.4);
}

function enemySpeed(type) {
    return ENEMY_TYPES[type].speed + (level - 1) * 3;
}

// ---------------------------------------------------------------------------
// Building the stage
// ---------------------------------------------------------------------------

function buildIngredients() {
    ingredients.length = 0;
    for (let b = 0; b < BURGER_X.length; b++) {
        plateCount[b] = 0;
        for (let k = 0; k < KINDS.length; k++) {
            ingredients.push({
                burger: b,
                kind: KINDS[k],
                level: k,             // top bun on floor 0, base bun on floor 3
                targetLevel: k,
                x: BURGER_X[b],
                y: FLOOR_Y[k],
                segs: [false, false, false, false],
                falling: false,
                plateIndex: -1,
            });
        }
    }
}

function resetChef() {
    chef.x = LADDER_X[2];
    chef.y = FLOOR_Y[FLOOR_Y.length - 1];
    chef.dx = 0;
    chef.dy = 0;
    chef.facing = 1;
    wishDx = 0;
    wishDy = 0;
}

function resetLevel() {
    buildIngredients();
    enemies.length = 0;
    peppers.length = 0;
    spawnTimer = SPAWN_FIRST;
    resetChef();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    pepper = START_PEPPER;
    level = 1;
    clearTimer = 0;
    resetLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    pepper += 1;
    clearTimer = 0;
    resetLevel();
    state = 'running';
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('burgertime-best', String(best));
        } catch (err) {
            /* private mode — the score just isn't persisted */
        }
    }
    showOverlay('GAME OVER', `Score ${score} — Stage ${level}`, 'Press Space to play again');
    updateHud();
}

function isLevelComplete() {
    return ingredients.every((i) => i.level === PLATE_LEVEL);
}

// ---------------------------------------------------------------------------
// Movement — shared by the chef and the enemies
// ---------------------------------------------------------------------------

/**
 * Advance one actor by `dist` pixels along the lattice, honouring a wish
 * direction. Horizontal movement needs a floor; vertical movement needs a
 * ladder. Holding a horizontal wish while climbing turns the actor off the
 * ladder at the next floor line it crosses.
 */
function advance(a, wdx, wdy, dist) {
    const fi = floorIndexAt(a.y);

    if (fi >= 0) {
        a.y = FLOOR_Y[fi];
        const lx = ladderXNear(a.x);
        if (wdy < 0 && fi > 0 && lx !== null) {
            a.x = lx; a.dx = 0; a.dy = -1;
        } else if (wdy > 0 && fi < FLOOR_Y.length - 1 && lx !== null) {
            a.x = lx; a.dx = 0; a.dy = 1;
        } else if (wdx !== 0) {
            a.dx = wdx; a.dy = 0;
        } else {
            a.dx = 0; a.dy = 0;
        }
    } else {
        // Mid-ladder: no horizontal travel, but a horizontal wish means
        // "get me to the nearest floor and turn".
        a.dx = 0;
        if (wdy !== 0) a.dy = wdy;
        else if (wdx !== 0) {
            if (a.dy === 0) a.dy = FLOOR_Y[nearestFloorIndex(a.y)] < a.y ? -1 : 1;
        } else {
            a.dy = 0;
        }
    }

    if (a.dy !== 0) {
        const ny = a.y + a.dy * dist;
        if (wdx !== 0) {
            for (const fy of FLOOR_Y) {
                if ((a.y - fy) * (ny - fy) < 0) {   // strictly crossed this floor
                    a.y = fy;
                    a.dy = 0;
                    a.dx = wdx;
                    a.facing = wdx;
                    return;
                }
            }
        }
        a.y = clamp(ny, FLOOR_Y[0], FLOOR_Y[FLOOR_Y.length - 1]);
        return;
    }

    if (a.dx !== 0) {
        a.x = clamp(a.x + a.dx * dist, a.hw, CANVAS_W - a.hw);
        a.facing = a.dx;
    }
}

function setWish(dx, dy) {
    wishDx = dx;
    wishDy = dy;
}

function updateChef(dt) {
    advance(chef, wishDx, wishDy, CHEF_SPEED * dt);
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

/** Mark the segment under the chef's feet as trodden. */
function pressSegments() {
    const fi = floorIndexAt(chef.y);
    if (fi < 0) return;
    for (const ing of ingredients) {
        if (ing.falling || ing.level !== fi) continue;
        const rel = chef.x - ing.x;
        if (rel < 0 || rel >= BURGER_W) continue;
        ing.segs[Math.floor(rel / SEG_W)] = true;
    }
}

function dropIngredient(ing) {
    if (ing.falling || ing.level >= PLATE_LEVEL) return;
    ing.falling = true;
    ing.targetLevel = ing.level + 1;
}

function squashEnemies(ing) {
    const box = ingredientRect(ing);
    for (let i = enemies.length - 1; i >= 0; i--) {
        if (rectsOverlap(box, actorRect(enemies[i], ENEMY_W, ENEMY_H))) {
            enemies.splice(i, 1);
            score += SCORE_SQUASH;
        }
    }
}

function updateIngredients(dt) {
    for (const ing of ingredients) {
        if (!ing.falling) {
            if (ing.level < PLATE_LEVEL && ing.segs.every(Boolean)) dropIngredient(ing);
            continue;
        }

        const target = ing.targetLevel < PLATE_LEVEL
            ? FLOOR_Y[ing.targetLevel]
            : PLATE_Y - plateCount[ing.burger] * PLATE_STEP;

        ing.y = Math.min(ing.y + FALL_SPEED * dt, target);
        squashEnemies(ing);
        if (ing.y < target) continue;

        ing.level = ing.targetLevel;
        score += SCORE_DROP;

        if (ing.level >= PLATE_LEVEL) {
            ing.plateIndex = plateCount[ing.burger]++;
            ing.y = restY(PLATE_LEVEL, ing.plateIndex);
            ing.falling = false;
            ing.segs = [false, false, false, false];
            score += SCORE_PLATE;
            continue;
        }

        const below = occupantAt(ing.burger, ing.level, ing);
        if (below) {
            // Landing on a resting ingredient knocks it loose and the whole
            // stack keeps going down together.
            dropIngredient(below);
            ing.targetLevel = ing.level + 1;
        } else {
            ing.falling = false;
            ing.segs = [false, false, false, false];
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function spray() {
    if (state !== 'running' || pepper <= 0) return;
    pepper -= 1;
    peppers.push({
        x: chef.facing > 0 ? chef.x + PEPPER_OFFSET : chef.x - PEPPER_OFFSET - PEPPER_W,
        y: chef.y - CHEF_H,
        w: PEPPER_W,
        h: PEPPER_H,
        t: PEPPER_LIFE,
    });
    updateHud();
}

function updatePeppers(dt) {
    for (let i = peppers.length - 1; i >= 0; i--) {
        const cloud = peppers[i];
        cloud.t -= dt;
        for (const e of enemies) {
            if (rectsOverlap(cloud, actorRect(e, ENEMY_W, ENEMY_H))) e.stun = STUN_TIME;
        }
        if (cloud.t <= 0) peppers.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemy(type, x, y) {
    enemies.push({
        type,
        x,
        y,
        dx: 0,
        dy: 0,
        facing: 1,
        stun: 0,
        hw: ENEMY_W / 2,
    });
    return enemies[enemies.length - 1];
}

function spawnWave(dt) {
    if (!spawnEnabled) return;
    spawnTimer -= dt;
    if (spawnTimer > 0 || enemies.length >= maxEnemies()) return;
    const type = ENEMY_ORDER[Math.floor(rng() * ENEMY_ORDER.length) % ENEMY_ORDER.length];
    const lane = Math.floor(rng() * LADDER_X.length) % LADDER_X.length;
    spawnEnemy(type, LADDER_X[lane], FLOOR_Y[0]);
    spawnTimer = spawnInterval();
}

/** Greedy chase: climb toward the chef's floor, then walk straight at them. */
function enemyWish(e) {
    const fi = floorIndexAt(e.y);
    const chefFloor = nearestFloorIndex(chef.y);

    if (fi < 0) {
        const targetY = FLOOR_Y[chefFloor];
        if (Math.abs(targetY - e.y) < 1) return [0, 0];
        return [0, targetY > e.y ? 1 : -1];
    }

    if (fi === chefFloor) return [chef.x >= e.x ? 1 : -1, 0];

    const lx = ladderXNear(e.x);
    const want = chefFloor > fi ? 1 : -1;

    if (rng() < ENEMY_WANDER) return [rng() < 0.5 ? -1 : 1, 0];

    if (lx !== null && ((want < 0 && fi > 0) || (want > 0 && fi < FLOOR_Y.length - 1))) {
        return [0, want];
    }

    let nearest = LADDER_X[0];
    for (const x of LADDER_X) {
        if (Math.abs(x - e.x) < Math.abs(nearest - e.x)) nearest = x;
    }
    return [nearest >= e.x ? 1 : -1, 0];
}

function updateEnemies(dt) {
    spawnWave(dt);

    const chefBox = actorRect(chef, CHEF_W, CHEF_H);
    for (const e of enemies) {
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - dt);
            continue;
        }
        const [wdx, wdy] = enemyWish(e);
        advance(e, wdx, wdy, enemySpeed(e.type) * dt);
        if (rectsOverlap(chefBox, actorRect(e, ENEMY_W, ENEMY_H))) {
            loseLife();
            return;
        }
    }
}

function loseLife() {
    lives -= 1;
    enemies.length = 0;
    peppers.length = 0;
    spawnTimer = SPAWN_FIRST;
    resetChef();
    updateHud();
    if (lives <= 0) gameOver();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'clear') {
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        return;
    }
    if (state !== 'running') return;

    animTime += dt;
    updateChef(dt);
    pressSegments();
    updateIngredients(dt);
    updatePeppers(dt);
    updateEnemies(dt);
    if (state !== 'running') return;   // the chef just died

    if (isLevelComplete()) {
        score += SCORE_LEVEL;
        state = 'clear';
        clearTimer = LEVEL_CLEAR_TIME;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ING_STYLE = {
    bunTop: { fill: '#e0a44f', edge: '#a9702c', seeds: true },
    lettuce: { fill: '#6fc23c', edge: '#3f8420' },
    patty: { fill: '#8a5230', edge: '#5b3218' },
    bunBase: { fill: '#cf9142', edge: '#95611f' },
};

function drawLattice() {
    // ladders behind the floors
    const top = FLOOR_Y[0], bottom = FLOOR_Y[FLOOR_Y.length - 1];
    for (const lx of LADDER_X) {
        ctx.strokeStyle = '#2d5687';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lx - 9, top); ctx.lineTo(lx - 9, bottom);
        ctx.moveTo(lx + 9, top); ctx.lineTo(lx + 9, bottom);
        ctx.stroke();
        ctx.strokeStyle = '#4a86c8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let y = top; y <= bottom; y += 10) {
            ctx.moveTo(lx - 9, y);
            ctx.lineTo(lx + 9, y);
        }
        ctx.stroke();
    }

    // floors: a bright walkway with a shaded underside and rivets
    for (const fy of FLOOR_Y) {
        ctx.fillStyle = '#5ea0e0';
        ctx.fillRect(0, fy + 1, CANVAS_W, 4);
        ctx.fillStyle = '#274a72';
        ctx.fillRect(0, fy + 5, CANVAS_W, 2);
        ctx.fillStyle = '#9dcaf5';
        for (let x = 6; x < CANVAS_W; x += 20) ctx.fillRect(x, fy + 2, 6, 1);
    }

    // plates
    for (const bx of BURGER_X) {
        const cx = bx + BURGER_W / 2;
        ctx.fillStyle = '#767d90';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 12, BURGER_W / 2 + 6, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#cdd3e2';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 8, BURGER_W / 2 + 6, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#eef1f8';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 6, BURGER_W / 2 - 4, 5, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawIngredient(ing) {
    const style = ING_STYLE[ing.kind];
    for (let s = 0; s < SEGMENTS; s++) {
        const x = ing.x + s * SEG_W;
        const dip = !ing.falling && ing.segs[s] ? 4 : 0;
        const y = ing.y - ING_H + dip;

        ctx.fillStyle = style.edge;
        ctx.fillRect(x, y + 3, SEG_W, ING_H - 3);
        ctx.fillStyle = style.fill;
        ctx.fillRect(x, y + (ing.kind === 'bunTop' ? 2 : 1), SEG_W, ING_H - 4);

        if (ing.kind === 'bunTop') {
            // domed crown with sesame seeds
            ctx.fillStyle = style.fill;
            ctx.beginPath();
            ctx.ellipse(x + SEG_W / 2, y + 4, SEG_W / 2, 4, 0, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = '#fff3d6';
            ctx.fillRect(x + 7, y + 1, 3, 2);
            ctx.fillRect(x + 18, y + 3, 3, 2);
        } else if (ing.kind === 'lettuce') {
            // ruffled leaf edge
            ctx.fillStyle = '#93e05c';
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.arc(x + 6 + i * 9, y + 2, 4, Math.PI, 0);
                ctx.fill();
            }
        } else if (ing.kind === 'patty') {
            ctx.fillStyle = '#5b3218';
            ctx.fillRect(x + 5, y + 3, 4, 2);
            ctx.fillRect(x + 17, y + 5, 5, 2);
        } else {
            ctx.fillStyle = '#e9b872';
            ctx.fillRect(x, y + 1, SEG_W, 2);
        }

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.30)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y + 1);
        ctx.lineTo(x + 0.5, y + ING_H);
        ctx.stroke();
    }
}

function drawChef() {
    const walking = chef.dx !== 0 || chef.dy !== 0;
    const stride = walking && Math.floor(animTime * 8) % 2 === 0 ? 3 : -3;
    const x = chef.x, y = chef.y;

    ctx.fillStyle = '#2b3550';                       // trousers
    ctx.fillRect(x - 8, y - 12, 6, 12 + Math.min(0, stride));
    ctx.fillRect(x + 2, y - 12, 6, 12 - Math.max(0, stride));
    ctx.fillStyle = '#f4f1e6';                       // apron / body
    ctx.fillRect(x - 9, y - 22, 18, 11);
    ctx.fillStyle = '#e05a3c';                       // neckerchief
    ctx.fillRect(x - 6, y - 23, 12, 3);
    ctx.fillStyle = '#f6d3a8';                       // face
    ctx.fillRect(x - 6, y - 28, 12, 6);
    ctx.fillStyle = '#1a1c26';                       // eye
    ctx.fillRect(x + (chef.facing > 0 ? 1 : -3), y - 26, 2, 2);
    ctx.fillStyle = '#ffffff';                       // hat
    ctx.fillRect(x - 8, y - 34, 16, 6);
    ctx.fillRect(x - 6, y - 37, 12, 4);
}

const ENEMY_LOOK = {
    hotdog: { body: '#d1503c', rx: 11, ry: 8 },
    egg: { body: '#f5efdc', rx: 9, ry: 10 },
    pickle: { body: '#5fa63c', rx: 10, ry: 9 },
};

function drawEnemy(e) {
    const x = e.x, y = e.y;
    const stunned = e.stun > 0;
    const look = ENEMY_LOOK[e.type];
    const cy = y - 5 - look.ry;
    const stride = !stunned && Math.floor(animTime * 9) % 2 === 0 ? 1 : -1;

    ctx.fillStyle = stunned ? '#4b6fa8' : '#2a2f45';        // feet
    ctx.fillRect(x - 8, y - 5 + Math.min(0, stride), 5, 5);
    ctx.fillRect(x + 3, y - 5 - Math.max(0, stride), 5, 5);

    ctx.fillStyle = stunned ? '#7fb2ff' : look.body;        // body
    ctx.beginPath();
    ctx.ellipse(x, cy, look.rx, look.ry, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!stunned) {
        if (e.type === 'hotdog') {
            ctx.fillStyle = '#e8c26b';                       // bun
            ctx.fillRect(x - look.rx, cy - 2, look.rx * 2, 3);
            ctx.fillStyle = '#f2d97a';                       // mustard
            for (let i = -8; i <= 6; i += 5) ctx.fillRect(x + i, cy - 5, 3, 2);
        } else if (e.type === 'egg') {
            ctx.fillStyle = '#f2c03a';                       // yolk
            ctx.beginPath();
            ctx.arc(x, cy + 1, 4, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = '#3f7d26';                       // pickle bumps
            for (let i = -6; i <= 4; i += 5) ctx.fillRect(x + i, cy - 1, 2, 2);
        }
    }

    ctx.fillStyle = '#12131a';                               // eyes
    ctx.fillRect(x - 5, cy - look.ry + 2, 3, 3);
    ctx.fillRect(x + 2, cy - look.ry + 2, 3, 3);

    if (stunned) {                                           // "seeing stars"
        ctx.fillStyle = '#ffe9a8';
        for (let i = 0; i < 3; i++) {
            ctx.fillRect(x - 8 + i * 7, cy - look.ry - 8 - (i % 2) * 3, 3, 3);
        }
    }
}

function drawPeppers() {
    for (const cloud of peppers) {
        const fade = cloud.t / PEPPER_LIFE;
        ctx.fillStyle = `rgba(255, 250, 235, ${0.10 + 0.22 * fade})`;
        for (let i = 0; i < 4; i++) {   // a soft puff rather than a grey box
            ctx.beginPath();
            ctx.arc(cloud.x + 6 + (i % 2) * 16, cloud.y + 7 + Math.floor(i / 2) * 12, 10, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = `rgba(60, 45, 40, ${0.55 + 0.45 * fade})`;
        for (let i = 0; i < 14; i++) {
            const px = cloud.x + ((i * 37) % cloud.w);
            const py = cloud.y + ((i * 53) % cloud.h);
            ctx.fillRect(px, py, 3, 3);
        }
    }
}

function drawBanner(text) {
    ctx.fillStyle = 'rgba(10, 11, 18, 0.55)';
    ctx.fillRect(0, CANVAS_H / 2 - 30, CANVAS_W, 60);
    ctx.fillStyle = '#ffcc33';
    ctx.font = 'bold 30px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2);
    ctx.textAlign = 'left';
}

function draw() {
    ctx.fillStyle = '#0a0b12';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawLattice();
    for (const ing of ingredients) drawIngredient(ing);
    drawPeppers();
    for (const e of enemies) drawEnemy(e);
    drawChef();
    if (state === 'clear') drawBanner(`STAGE ${level} CLEAR!`);
    if (state === 'paused') drawBanner('PAUSED');
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    pepperEl.textContent = String(pepper);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    overlaySub.textContent = sub || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
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

function loadBest() {
    let stored = 0;
    try {
        stored = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0;
    } catch (err) {
        stored = 0;
    }
    best = stored;
    updateHud();
    return best;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];
const held = new Set();

function refreshWish() {
    const left = LEFT_KEYS.some((k) => held.has(k));
    const right = RIGHT_KEYS.some((k) => held.has(k));
    const up = UP_KEYS.some((k) => held.has(k));
    const down = DOWN_KEYS.some((k) => held.has(k));
    // Vertical wins when both axes are held, so a ladder is never missed.
    if (up || down) setWish(0, up && !down ? -1 : down && !up ? 1 : 0);
    else setWish(right && !left ? 1 : left && !right ? -1 : 0, 0);
}

window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (state === 'running') spray();
        else if (state === 'paused') togglePause();      // never restart a paused game
        else if (state !== 'clear') startGame();
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if ([...LEFT_KEYS, ...RIGHT_KEYS, ...UP_KEYS, ...DOWN_KEYS].includes(e.key)) {
        held.add(e.key);
        refreshWish();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (held.delete(e.key)) refreshWish();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else if (state !== 'running') startGame();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTs = 0;

function frame(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    if (autoStep) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

seedRng(20250731);
buildIngredients();
loadBest();
showOverlay('BURGERTIME', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
