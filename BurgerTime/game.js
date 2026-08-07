// ---------------------------------------------------------------------------
// BurgerTime — Chef Pepper stomps burger ingredients down a lattice of floors
// and ladders while three food enemies hunt him.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per second and
// advanced through `step(dt)`, so tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry --------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 480;

// Floor lines, top to bottom. The last one is the plate row.
const FLOOR_Y = [90, 155, 220, 285, 350, 415];
const PLATE_LEVEL = FLOOR_Y.length - 1;

// Ladders: `gap` g joins floor g (above) to floor g + 1 (below).
const LADDERS = [
    { x: 170, gap: 0 }, { x: 470, gap: 0 },
    { x: 30, gap: 1 }, { x: 320, gap: 1 }, { x: 610, gap: 1 },
    { x: 170, gap: 2 }, { x: 470, gap: 2 },
    { x: 30, gap: 3 }, { x: 320, gap: 3 }, { x: 610, gap: 3 },
    { x: 170, gap: 4 }, { x: 470, gap: 4 },
];
const LADDER_SNAP = 13;   // how close an actor must be to mount a ladder
const LADDER_W = 26;

// --- Burgers ---------------------------------------------------------------
const COLUMN_X = [95, 245, 395, 545];
const ING_W = 88;
const ING_H = 13;
const SEGMENTS = 4;
const FALL_SPEED = 260;
const PLATE_H = 7;

// Bottom to top of the finished burger; index 0 is the ingredient that starts
// highest, so a plated stack ends up in this order from the plate upward.
const ING_TYPES = [
    { name: 'bun-top', fill: '#e0a458', edge: '#b9803a' },
    { name: 'lettuce', fill: '#7cc36a', edge: '#4f9040' },
    { name: 'patty', fill: '#71401f', edge: '#452414' },
    { name: 'bun-bottom', fill: '#d09046', edge: '#a56c2f' },
];

// --- Actors ----------------------------------------------------------------
const MARGIN = 12;         // keeps actors inside the play field
const CHEF_W = 22;
const CHEF_H = 28;
const CHEF_SPEED = 118;
const CHEF_CLIMB = 95;
const ENEMY_W = 22;
const ENEMY_H = 26;
const TOUCH_X = 15;        // chef/enemy contact box
const TOUCH_Y = 22;

const ENEMY_TYPES = [
    { name: 'hotdog', fill: '#d9534f', edge: '#8f2f2c', mult: 1 },
    { name: 'egg', fill: '#f7e59b', edge: '#c9a94a', mult: 1.12 },
    { name: 'pickle', fill: '#6ab04c', edge: '#3f6f2c', mult: 0.9 },
];

// --- Pepper ----------------------------------------------------------------
const START_PEPPER = 5;
const PEPPER_RANGE = 62;
const PEPPER_LIFE = 0.4;
const STUN_TIME = 3.5;

// --- Difficulty (pure functions of `level`) --------------------------------
const SPAWN_FIRST = 2.6;
const START_LIVES = 3;

function enemySpeed(lvl) { return 58 + 9 * (lvl - 1); }
function enemyCap(lvl) { return Math.min(2 + lvl, 6); }
function spawnInterval(lvl) { return Math.max(2, 5.5 - 0.4 * lvl); }

// --- Scoring ---------------------------------------------------------------
const POINTS_DROP = 50;
const POINTS_SQUASH = 500;
const POINTS_BURGER = 500;
const LEVEL_BONUS = 1000;

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
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, level, lives, pepper;
let spawnTimer, spawnSide, bannerTimer, bannerText;
const chef = {
    x: CANVAS_W / 2, y: FLOOR_Y[PLATE_LEVEL], floor: PLATE_LEVEL, target: PLATE_LEVEL,
    climbing: false, inputX: 0, inputY: 0, face: 1, walkPhase: 0,
};
let ingredients = [];
const enemies = [];
const sprays = [];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Board setup
// ---------------------------------------------------------------------------

function makeIngredients() {
    const list = [];
    COLUMN_X.forEach((_, col) => {
        ING_TYPES.forEach((type, i) => {
            list.push({
                col,
                level: i,               // starts on floors 0..3
                type,
                plateIndex: -1,
                falling: false,
                fallTarget: i,
                y: restY(i, -1),
                segments: new Array(SEGMENTS).fill(false),
                riders: [],
                wobble: 0,
            });
        });
    });
    return list;
}

// Resting y of an ingredient at `level` (plate stack position for plated ones).
function restY(lvl, plateIndex) {
    if (lvl < PLATE_LEVEL) return FLOOR_Y[lvl] - ING_H / 2;
    return FLOOR_Y[PLATE_LEVEL] - PLATE_H - ING_H / 2 - Math.max(0, plateIndex) * ING_H;
}

function ingredientAt(col, lvl) {
    return ingredients.find((i) => i.col === col && i.level === lvl && !i.falling);
}

function platedCount(col) {
    return ingredients.filter((i) => i.col === col && i.level === PLATE_LEVEL && !i.falling).length;
}

function columnComplete(col) {
    return platedCount(col) === ING_TYPES.length;
}

// Drop an ingredient straight onto its plate (used by the level-clear check and
// by the tests to set up board states without playing them out).
function plateIngredient(ing) {
    ing.falling = false;
    ing.level = PLATE_LEVEL;
    ing.fallTarget = PLATE_LEVEL;
    ing.plateIndex = platedCount(ing.col) - 1;
    ing.y = restY(PLATE_LEVEL, ing.plateIndex);
    ing.segments.fill(false);
    return ing;
}

function placeChef(x, floor) {
    chef.x = clamp(x, MARGIN, CANVAS_W - MARGIN);
    chef.floor = floor;
    chef.target = floor;
    chef.climbing = false;
    chef.y = FLOOR_Y[floor];
    return chef;
}

function resetActors() {
    placeChef(CANVAS_W / 2, PLATE_LEVEL);
    chef.inputX = 0;
    chef.inputY = 0;
    chef.face = 1;
    enemies.length = 0;
    sprays.length = 0;
    spawnTimer = SPAWN_FIRST;
    spawnSide = 0;
}

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    lives = START_LIVES;
    pepper = START_PEPPER;
    ingredients = makeIngredients();
    bannerTimer = 0;
    bannerText = '';
    resetActors();
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    score += LEVEL_BONUS * (level - 1);
    pepper = START_PEPPER;
    ingredients = makeIngredients();
    resetActors();
    bannerText = 'LEVEL ' + level;
    bannerTimer = 1.8;
    updateHud();
}

// ---------------------------------------------------------------------------
// Movement — shared by the chef and the enemies
// ---------------------------------------------------------------------------

function ladderFor(gap, x) {
    if (gap < 0 || gap >= FLOOR_Y.length - 1) return null;
    let best = null;
    for (const l of LADDERS) {
        if (l.gap !== gap) continue;
        if (Math.abs(l.x - x) > LADDER_SNAP) continue;
        if (!best || Math.abs(l.x - x) < Math.abs(best.x - x)) best = l;
    }
    return best;
}

function nearestLadder(gap, x) {
    let best = null;
    for (const l of LADDERS) {
        if (l.gap !== gap) continue;
        if (!best || Math.abs(l.x - x) < Math.abs(best.x - x)) best = l;
    }
    return best;
}

function advanceActor(a, dt, speed) {
    if (a.climbing) {
        // Reverse mid-ladder if the vertical input flipped.
        if (a.inputY !== 0) {
            const goingDown = FLOOR_Y[a.target] > FLOOR_Y[a.floor];
            if ((a.inputY > 0) !== goingDown) {
                const from = a.floor;
                a.floor = a.target;
                a.target = from;
            }
        }
        const goalY = FLOOR_Y[a.target];
        const move = speed * dt;
        if (Math.abs(goalY - a.y) <= move) {
            a.y = goalY;
            a.floor = a.target;
            a.climbing = false;
        } else {
            a.y += Math.sign(goalY - a.y) * move;
        }
        return;
    }

    a.y = FLOOR_Y[a.floor];

    if (a.inputY !== 0) {
        const gap = a.inputY > 0 ? a.floor : a.floor - 1;
        const ladder = ladderFor(gap, a.x);
        if (ladder) {
            a.x = ladder.x;
            a.climbing = true;
            a.target = a.floor + a.inputY;
            return;
        }
    }

    if (a.inputX !== 0) {
        a.x = clamp(a.x + a.inputX * speed * dt, MARGIN, CANVAS_W - MARGIN);
        a.face = a.inputX;
        a.walkPhase = (a.walkPhase || 0) + speed * dt;
    }
}

function setChefInput(dx, dy) {
    chef.inputX = Math.sign(dx) || 0;
    chef.inputY = Math.sign(dy) || 0;
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

// The chef presses the segments of any ingredient resting on his floor.
function pressSegments() {
    if (chef.climbing) return;
    for (const ing of ingredients) {
        if (ing.falling || ing.level === PLATE_LEVEL || ing.level !== chef.floor) continue;
        const left = COLUMN_X[ing.col] - ING_W / 2;
        const segW = ING_W / SEGMENTS;
        const idx = Math.floor((chef.x - left) / segW);
        if (idx < 0 || idx >= SEGMENTS) continue;
        ing.segments[idx] = true;
        if (ing.segments.every(Boolean)) dropIngredient(ing);
    }
}

function dropIngredient(ing) {
    if (ing.falling || ing.level === PLATE_LEVEL) return;
    ing.falling = true;
    ing.fallTarget = ing.level + 1;
    ing.riders = [];
    ing.wobble = 1;
}

function updateIngredients(dt) {
    for (const ing of ingredients) {
        if (!ing.falling) {
            if (ing.wobble > 0) ing.wobble = Math.max(0, ing.wobble - dt * 3);
            continue;
        }

        ing.y += FALL_SPEED * dt;
        catchRiders(ing);
        for (const rider of ing.riders) rider.y = ing.y + ING_H / 2 + ENEMY_H / 2 - 4;

        const goal = restY(ing.fallTarget, platedCount(ing.col));
        if (ing.y < goal) continue;

        // Landing. Above the plate row, an ingredient already resting here is
        // knocked loose and this one takes its place.
        const occupant = ing.fallTarget < PLATE_LEVEL ? ingredientAt(ing.col, ing.fallTarget) : null;
        if (occupant) dropIngredient(occupant);

        ing.level = ing.fallTarget;
        ing.falling = false;
        ing.segments.fill(false);
        ing.wobble = 1;
        if (ing.level === PLATE_LEVEL) {
            ing.plateIndex = platedCount(ing.col) - 1;
            ing.y = restY(PLATE_LEVEL, ing.plateIndex);
        } else {
            ing.y = restY(ing.level, -1);
        }

        score += POINTS_DROP;
        squashRiders(ing);
        if (ing.level === PLATE_LEVEL && columnComplete(ing.col)) score += POINTS_BURGER;
        updateHud();
    }
}

function catchRiders(ing) {
    const x = COLUMN_X[ing.col];
    for (const e of enemies) {
        if (e.rideBy) continue;
        if (Math.abs(e.x - x) > ING_W / 2 + ENEMY_W / 2 - 6) continue;
        if (e.climbing) continue;
        if (ing.y < e.y - ENEMY_H / 2 - 8 || ing.y > e.y + ENEMY_H / 2) continue;
        e.rideBy = ing;
        e.inputX = 0;
        e.inputY = 0;
        ing.riders.push(e);
    }
}

function squashRiders(ing) {
    let bonus = POINTS_SQUASH;
    for (const rider of ing.riders) {
        score += bonus;
        bonus *= 2;
        const idx = enemies.indexOf(rider);
        if (idx >= 0) enemies.splice(idx, 1);
    }
    ing.riders = [];
}

function levelCleared() {
    return ingredients.length > 0 &&
        ingredients.every((i) => !i.falling && i.level === PLATE_LEVEL);
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemy(opts = {}) {
    const type = opts.type || ENEMY_TYPES[Math.floor(Math.random() * ENEMY_TYPES.length)];
    const floor = opts.floor === undefined ? PLATE_LEVEL : opts.floor;
    const e = {
        x: clamp(opts.x === undefined ? MARGIN : opts.x, MARGIN, CANVAS_W - MARGIN),
        y: FLOOR_Y[floor],
        floor,
        target: floor,
        climbing: false,
        inputX: 0,
        inputY: 0,
        face: 1,
        walkPhase: 0,
        stun: 0,
        rideBy: null,
        type,
    };
    enemies.push(e);
    return e;
}

const SPAWN_POINTS = [
    { x: MARGIN, floor: PLATE_LEVEL },
    { x: CANVAS_W - MARGIN, floor: PLATE_LEVEL },
    { x: MARGIN, floor: 0 },
    { x: CANVAS_W - MARGIN, floor: 0 },
];

function updateSpawns(dt) {
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval(level);
    if (enemies.length >= enemyCap(level)) return;
    const point = SPAWN_POINTS[spawnSide % SPAWN_POINTS.length];
    spawnSide += 1;
    spawnEnemy({ x: point.x, floor: point.floor });
}

function enemyThink(e) {
    if (e.climbing) {
        e.inputX = 0;
        e.inputY = e.target > e.floor ? 1 : -1;
        return;
    }
    const want = Math.sign(chef.floor - e.floor);
    if (want !== 0) {
        const gap = want > 0 ? e.floor : e.floor - 1;
        const ladder = nearestLadder(gap, e.x);
        if (ladder) {
            if (Math.abs(ladder.x - e.x) <= LADDER_SNAP) {
                e.inputX = 0;
                e.inputY = want;
                return;
            }
            e.inputX = Math.sign(ladder.x - e.x);
            e.inputY = 0;
            return;
        }
    }
    e.inputY = 0;
    e.inputX = Math.sign(chef.x - e.x) || e.face;
}

function updateEnemies(dt) {
    for (const e of enemies) {
        if (e.rideBy) continue;
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - dt);
            continue;
        }
        enemyThink(e);
        advanceActor(e, dt, enemySpeed(level) * e.type.mult);
    }
}

function checkChefHit() {
    for (const e of enemies) {
        if (e.stun > 0 || e.rideBy) continue;
        if (Math.abs(e.x - chef.x) < TOUCH_X && Math.abs(e.y - chef.y) < TOUCH_Y) {
            loseLife();
            return;
        }
    }
}

function loseLife() {
    lives -= 1;
    // Ingredients keep falling, but nothing is riding them any more.
    for (const ing of ingredients) ing.riders = [];
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    resetActors();
    bannerText = 'OUCH!';
    bannerTimer = 1.2;
    updateHud();
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function sprayPepper() {
    if (state !== 'running' || pepper <= 0) return false;
    pepper -= 1;
    const dir = chef.face || 1;
    sprays.push({ x: chef.x + dir * (PEPPER_RANGE / 2 + 8), y: chef.y - CHEF_H / 2, life: PEPPER_LIFE });
    for (const e of enemies) {
        if (e.rideBy) continue;
        if (Math.abs(e.y - chef.y) > 26) continue;
        const ahead = (e.x - chef.x) * dir;
        if (ahead > -4 && ahead < PEPPER_RANGE) e.stun = STUN_TIME;
    }
    updateHud();
    return true;
}

function updateSprays(dt) {
    for (let i = sprays.length - 1; i >= 0; i--) {
        sprays[i].life -= dt;
        if (sprays[i].life <= 0) sprays.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    if (bannerTimer > 0) bannerTimer = Math.max(0, bannerTimer - dt);

    advanceActor(chef, dt, chef.climbing ? CHEF_CLIMB : CHEF_SPEED);
    pressSegments();
    updateIngredients(dt);
    updateSpawns(dt);
    updateEnemies(dt);
    updateSprays(dt);
    checkChefHit();

    if (levelCleared()) nextLevel();
}

function gameOver() {
    state = 'over';
    enemies.length = 0;
    sprays.length = 0;
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (err) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', 'Score ' + score + ' · Best ' + best, 'Press Space to play again');
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
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    livesEl.textContent = lives;
    pepperEl.textContent = pepper;
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

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const bg = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    bg.addColorStop(0, '#1a1220');
    bg.addColorStop(1, '#0d0910');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawCounter();
    drawLadders();
    drawFloors();
    drawPlates();
    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    drawChef();
    drawSprays();
    drawBanner();
}

// The diner counter below the plate row, so the bottom of the screen reads as
// part of the kitchen rather than empty space.
function drawCounter() {
    const top = FLOOR_Y[PLATE_LEVEL] + 7;
    const grad = ctx.createLinearGradient(0, top, 0, CANVAS_H);
    grad.addColorStop(0, '#2b1d2b');
    grad.addColorStop(1, '#181119');
    ctx.fillStyle = grad;
    ctx.fillRect(0, top, CANVAS_W, CANVAS_H - top);
    ctx.fillStyle = 'rgba(255, 214, 160, 0.12)';
    ctx.fillRect(0, top, CANVAS_W, 2);

    // Tiled backsplash squares for a little depth.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    for (let x = 6; x < CANVAS_W; x += 34) {
        for (let y = top + 12; y < CANVAS_H - 8; y += 22) ctx.fillRect(x, y, 26, 15);
    }
}

function drawFloors() {
    FLOOR_Y.forEach((y) => {
        ctx.fillStyle = '#5c4a63';
        ctx.fillRect(0, y, CANVAS_W, 5);
        ctx.fillStyle = 'rgba(255, 214, 160, 0.35)';
        ctx.fillRect(0, y, CANVAS_W, 1);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, y + 5, CANVAS_W, 2);
    });
}

function drawLadders() {
    for (const l of LADDERS) {
        const top = FLOOR_Y[l.gap];
        const bottom = FLOOR_Y[l.gap + 1];
        ctx.strokeStyle = '#7b6a86';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(l.x - LADDER_W / 2, top);
        ctx.lineTo(l.x - LADDER_W / 2, bottom);
        ctx.moveTo(l.x + LADDER_W / 2, top);
        ctx.lineTo(l.x + LADDER_W / 2, bottom);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(190, 175, 205, 0.75)';
        for (let y = top + 10; y < bottom; y += 14) {
            ctx.beginPath();
            ctx.moveTo(l.x - LADDER_W / 2, y);
            ctx.lineTo(l.x + LADDER_W / 2, y);
            ctx.stroke();
        }
    }
}

function drawPlates() {
    const y = FLOOR_Y[PLATE_LEVEL];
    for (const x of COLUMN_X) {
        ctx.fillStyle = '#d6d9e0';
        ctx.beginPath();
        ctx.ellipse(x, y - PLATE_H / 2, ING_W / 2 + 6, PLATE_H, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(120, 126, 140, 0.6)';
        ctx.fillRect(x - ING_W / 2 - 6, y - PLATE_H / 2, ING_W + 12, PLATE_H / 2);
    }
}

function drawIngredient(ing) {
    const x = COLUMN_X[ing.col];
    const y = ing.y;
    const squash = ing.wobble > 0 ? 1 + ing.wobble * 0.25 : 1;
    const w = ING_W * (ing.falling ? 0.96 : 1);
    const h = ING_H / squash;

    ctx.save();
    ctx.translate(x, y);
    if (ing.falling) ctx.rotate(Math.sin(ing.y / 26) * 0.12);   // tumble while it drops
    ctx.fillStyle = ing.type.edge;
    roundRect(-w / 2, -h / 2, w, h, 5);
    ctx.fill();
    ctx.fillStyle = ing.type.fill;
    roundRect(-w / 2 + 2, -h / 2 + 1.5, w - 4, h - 4, 4);
    ctx.fill();

    if (ing.type.name === 'bun-top') {
        ctx.fillStyle = 'rgba(255, 245, 220, 0.85)';
        for (let i = -2; i <= 2; i++) ctx.fillRect(i * 14 - 2, -h / 2 - 1, 4, 2);
    }
    if (ing.type.name === 'lettuce') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        for (let i = -3; i <= 3; i++) ctx.fillRect(i * 11, -h / 2 + 2, 5, h - 5);
    }
    if (ing.type.name === 'patty') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        for (let i = -1; i <= 1; i++) ctx.fillRect(i * 22 - 6, -h / 2 + 3.5, 12, 2);
    }
    if (ing.type.name === 'bun-bottom') {
        ctx.fillStyle = 'rgba(255, 235, 200, 0.22)';
        ctx.fillRect(-w / 2 + 4, -h / 2 + 2, w - 8, 2);
    }

    // Pressed segments show as dents so the player can see progress.
    if (!ing.falling) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ing.segments.forEach((pressed, i) => {
            if (!pressed) return;
            const segW = ING_W / SEGMENTS;
            ctx.fillRect(-ING_W / 2 + i * segW + 2, h / 2 - 3, segW - 4, 3);
        });
    }
    ctx.restore();
}

function drawChef() {
    if (state === 'idle') return;
    const x = chef.x;
    const y = chef.y;
    const bob = chef.climbing ? 0 : Math.sin(chef.walkPhase / 9) * 1.5;

    ctx.save();
    ctx.translate(x, y - CHEF_H / 2 + bob);
    // legs
    ctx.fillStyle = '#3a4a86';
    const stride = chef.climbing ? 3 : Math.sin(chef.walkPhase / 9) * 4;
    ctx.fillRect(-7, CHEF_H / 2 - 8, 5, 8 + stride * 0.2);
    ctx.fillRect(2, CHEF_H / 2 - 8, 5, 8 - stride * 0.2);
    // body
    ctx.fillStyle = '#f4f1ea';
    roundRect(-8, -2, 16, CHEF_H / 2 - 5, 3);
    ctx.fill();
    ctx.fillStyle = '#e05a4a';
    ctx.fillRect(-2, -2, 4, 7);
    // head
    ctx.fillStyle = '#f0c091';
    ctx.beginPath();
    ctx.arc(0, -8, 6.5, 0, Math.PI * 2);
    ctx.fill();
    // hat
    ctx.fillStyle = '#ffffff';
    roundRect(-8, -20, 16, 8, 4);
    ctx.fill();
    ctx.fillRect(-8, -13, 16, 3);
    // eyes
    ctx.fillStyle = '#2a1a24';
    ctx.fillRect(chef.face >= 0 ? 1 : -4, -10, 2, 2);
    ctx.restore();
}

function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y - ENEMY_H / 2);
    if (e.stun > 0) ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(e.stun * 8));

    ctx.fillStyle = e.type.edge;
    roundRect(-ENEMY_W / 2, -ENEMY_H / 2, ENEMY_W, ENEMY_H, 8);
    ctx.fill();
    ctx.fillStyle = e.type.fill;
    roundRect(-ENEMY_W / 2 + 2, -ENEMY_H / 2 + 2, ENEMY_W - 4, ENEMY_H - 4, 7);
    ctx.fill();

    // feet
    ctx.fillStyle = '#f4f1ea';
    const stride = e.climbing || e.stun > 0 ? 0 : Math.sin(e.walkPhase / 8) * 3;
    ctx.fillRect(-7 + stride * 0.3, ENEMY_H / 2 - 5, 5, 5);
    ctx.fillRect(2 - stride * 0.3, ENEMY_H / 2 - 5, 5, 5);

    // eyes
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-3.5, -4, 3, 0, Math.PI * 2);
    ctx.arc(3.5, -4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#20141c';
    const look = e.stun > 0 ? 0 : Math.sign(e.face || 1) * 1.2;
    ctx.beginPath();
    ctx.arc(-3.5 + look, -4, 1.4, 0, Math.PI * 2);
    ctx.arc(3.5 + look, -4, 1.4, 0, Math.PI * 2);
    ctx.fill();

    if (e.stun > 0) {
        ctx.fillStyle = '#ffe08a';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', 0, -ENEMY_H / 2 - 3);
    }
    ctx.restore();
}

function drawSprays() {
    for (const s of sprays) {
        const t = s.life / PEPPER_LIFE;
        ctx.save();
        ctx.globalAlpha = Math.max(0, t);
        ctx.fillStyle = '#f3e6c8';
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const r = (1.2 - t) * 22 + 6;
            ctx.beginPath();
            ctx.arc(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r * 0.6, 2.2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

function drawBanner() {
    if (bannerTimer <= 0 || !bannerText) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, bannerTimer);
    ctx.fillStyle = '#ff9f43';
    ctx.font = 'bold 28px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(bannerText, CANVAS_W / 2, 48);
    ctx.restore();
}

function roundRect(x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

let lastTime = null;

function frame(now) {
    if (lastTime === null) lastTime = now;
    const dt = Math.min(0.05, (now - lastTime) / 1000);
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

const anyHeld = (keys) => keys.some((k) => heldKeys.has(k));

function refreshInput() {
    setChefInput(
        (anyHeld(RIGHT_KEYS) ? 1 : 0) - (anyHeld(LEFT_KEYS) ? 1 : 0),
        (anyHeld(DOWN_KEYS) ? 1 : 0) - (anyHeld(UP_KEYS) ? 1 : 0),
    );
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
        else if (state === 'running') sprayPepper();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshInput();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.delete(e.key)) refreshInput();
});

window.addEventListener('blur', () => {
    heldKeys.clear();
    refreshInput();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
pepper = START_PEPPER;
ingredients = makeIngredients();
spawnTimer = SPAWN_FIRST;
spawnSide = 0;
bannerTimer = 0;
bannerText = '';
updateHud();
requestAnimationFrame(frame);
