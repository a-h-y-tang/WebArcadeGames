// ---------------------------------------------------------------------------
// Burger Time — a girder-maze arcade game on an HTML5 canvas.
//
// The chef walks a lattice of girders and ladders. Walking the full width of a
// burger layer knocks it down one girder; march every layer down onto the plates
// at the bottom to build all four burgers and clear the level. Hot dogs, eggs
// and pickles hunt the chef; a shake of pepper freezes them for a few seconds,
// and a falling layer squashes anything standing under it.
//
// Written as a single classic (non-module) script so the state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom!, Dino
// Run and Tetris in this repo. All motion is expressed per-second and advanced
// through `step(dt)`, so the tests can simulate frames deterministically without
// depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 480;

const FLOOR_COUNT = 5;          // girders, top (0) to bottom (FLOOR_COUNT - 1)
const FLOOR_TOP = 72;           // y of the top girder
const FLOOR_GAP = 92;           // vertical distance between girders
const PLATE_FLOOR = FLOOR_COUNT - 1; // the bottom girder holds the plates

// Ladder columns. Every gap between neighbouring girders carries the same set of
// ladders — a uniform lattice, which keeps every layer reachable without needing
// a hand-authored level map.
const LADDER_XS = [26, 151, 301, 451, 614];
const LADDER_SNAP = 10;         // how close to a ladder you must be to grab it

// --- Burgers ---
const NUM_BURGERS = 4;
const LAYERS = ['bunTop', 'patty', 'bunBottom'];
const LAYER_FLOORS = [1, 2, 3]; // starting girder of each layer, top-down
const SEG_COUNT = 4;            // segments the chef must tread on to drop a layer
const SEG_W = 18;
const ING_W = SEG_COUNT * SEG_W;
const LAYER_H = 12;             // stacked height of one plated layer
const COL_X0 = 40;              // x of the left edge of the first burger column
const COL_GAP = 150;

// --- Actors ---
const ACTOR_HALF = 11;
const CHEF_SPEED = 105;         // px/s walking
const CHEF_CLIMB = 78;          // px/s on a ladder
const ENEMY_BASE = 52;
const ENEMY_STEP = 8;           // extra px/s per level
const ENEMY_CLIMB_RATIO = 0.8;
const TOUCH_DIST = 14;          // chef/enemy contact radius
const RESPAWN_TIME = 4;         // seconds a squashed enemy stays off the board

// --- Pepper ---
const START_PEPPER = 5;
const PEPPER_W = 40;
const PEPPER_H = 26;
const PEPPER_LIFE = 0.5;
const STUN_TIME = 4;

// --- Falling layers ---
const FALL_SPEED = 220;
const SQUASH_REACH = 14;        // vertical reach of a falling layer

// --- Lives & scoring ---
const START_LIVES = 3;
const DROP_POINTS = 50;
const PLATE_POINTS = 100;
const BURGER_POINTS = 500;
const LEVEL_POINTS = 1000;
const SQUASH_POINTS = 500;

// Where enemies (re)appear. Deliberately far from the chef's plate-floor start.
const SPAWNS = [
    { x: LADDER_XS[0], floor: 0 },
    { x: LADDER_XS[4], floor: 0 },
    { x: LADDER_XS[1], floor: 1 },
    { x: LADDER_XS[3], floor: 1 },
    { x: LADDER_XS[2], floor: 0 },
];
const ENEMY_KINDS = ['dog', 'egg', 'pickle'];

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
const chef = { x: CANVAS_W / 2, y: 0, floor: PLATE_FLOOR, dirX: 0, dirY: 0, facing: 1, climbing: false, climbFrom: 0, climbTo: 0 };
const ingredients = [];
const enemies = [];
const peppers = [];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function floorY(index) {
    return FLOOR_TOP + index * FLOOR_GAP;
}

function colLeft(col) {
    return COL_X0 + col * COL_GAP;
}

function colCenter(col) {
    return colLeft(col) + ING_W / 2;
}

function clampX(x) {
    return Math.max(ACTOR_HALF, Math.min(CANVAS_W - ACTOR_HALF, x));
}

// Ladders connect neighbouring girders only, and sit at the same columns on
// every level of the lattice.
function hasLadder(x, from, to) {
    if (Math.abs(to - from) !== 1) return false;
    if (Math.min(from, to) < 0 || Math.max(from, to) > PLATE_FLOOR) return false;
    return LADDER_XS.includes(x);
}

// The nearest grabbable ladder column linking `from` to `to`, or null.
function ladderNear(x, from, to) {
    let best = null;
    for (const lx of LADDER_XS) {
        if (!hasLadder(lx, from, to)) continue;
        if (Math.abs(lx - x) > LADDER_SNAP) continue;
        if (best === null || Math.abs(lx - x) < Math.abs(best - x)) best = lx;
    }
    return best;
}

function nearestLadderX(x, from, to) {
    let best = null;
    for (const lx of LADDER_XS) {
        if (!hasLadder(lx, from, to)) continue;
        if (best === null || Math.abs(lx - x) < Math.abs(best - x)) best = lx;
    }
    return best;
}

// ---------------------------------------------------------------------------
// Burger piles
//
// Layers only ever occupy one of NUM_BURGERS columns, so a "pile" is simply the
// set of resting layers sharing a column and a girder, ordered bottom-up.
// ---------------------------------------------------------------------------

function pileAt(col, floor) {
    return ingredients
        .filter((i) => i.col === col && i.floor === floor && !i.falling)
        .sort((a, b) => a.pileIndex - b.pileIndex);
}

function topOfPile(col, floor) {
    const pile = pileAt(col, floor);
    return pile.length ? pile[pile.length - 1] : null;
}

function isTopOfPile(ing) {
    return !ing.falling && topOfPile(ing.col, ing.floor) === ing;
}

function restingY(floor, pileIndex) {
    return floorY(floor) - pileIndex * LAYER_H;
}

function servedCount() {
    let n = 0;
    for (let col = 0; col < NUM_BURGERS; col++) {
        if (pileAt(col, PLATE_FLOOR).length >= LAYERS.length) n += 1;
    }
    return n;
}

// ---------------------------------------------------------------------------
// Level building
// ---------------------------------------------------------------------------

function buildLevel() {
    ingredients.length = 0;
    for (let col = 0; col < NUM_BURGERS; col++) {
        LAYERS.forEach((type, i) => {
            const floor = LAYER_FLOORS[i];
            ingredients.push({
                type,
                col,
                floor,
                pileIndex: 0,
                x: colLeft(col),
                y: restingY(floor, 0),
                segs: new Array(SEG_COUNT).fill(false),
                falling: false,
            });
        });
    }

    enemies.length = 0;
    const count = Math.min(SPAWNS.length, 2 + level);
    for (let i = 0; i < count; i++) {
        spawnEnemy({ x: SPAWNS[i].x, floor: SPAWNS[i].floor, kind: ENEMY_KINDS[i % ENEMY_KINDS.length] });
    }

    peppers.length = 0;
}

function enemySpeed() {
    return ENEMY_BASE + (level - 1) * ENEMY_STEP;
}

function spawnEnemy(opts) {
    opts = opts || {};
    const floor = opts.floor != null ? opts.floor : 0;
    const e = {
        kind: opts.kind || ENEMY_KINDS[enemies.length % ENEMY_KINDS.length],
        x: opts.x != null ? opts.x : LADDER_XS[0],
        y: floorY(floor),
        floor,
        dirX: 0,
        dirY: 0,
        facing: 1,
        climbing: false,
        climbFrom: floor,
        climbTo: floor,
        stun: 0,
        dead: false,
        respawn: 0,
        spawn: { x: opts.x != null ? opts.x : LADDER_XS[0], floor },
    };
    enemies.push(e);
    return e;
}

function resetPositions() {
    chef.x = CANVAS_W / 2;
    chef.floor = PLATE_FLOOR;
    chef.y = floorY(PLATE_FLOOR);
    chef.dirX = 0;
    chef.dirY = 0;
    chef.facing = 1;
    chef.climbing = false;
    for (const e of enemies) placeAtSpawn(e);
    peppers.length = 0;
}

function placeAtSpawn(e) {
    e.x = e.spawn.x;
    e.floor = e.spawn.floor;
    e.y = floorY(e.spawn.floor);
    e.climbing = false;
    e.dirX = 0;
    e.dirY = 0;
    e.stun = 0;
    e.dead = false;
    e.respawn = 0;
}

// ---------------------------------------------------------------------------
// Chef controls
// ---------------------------------------------------------------------------

function moveChef(dx, dy) {
    chef.dirX = dx;
    chef.dirY = dy;
}

function setChefTo(x, floor) {
    chef.x = clampX(x);
    chef.floor = floor;
    chef.y = floorY(floor);
    chef.climbing = false;
}

// Shared movement for the chef and the enemies: walk along a girder, or grab a
// ladder when there is vertical intent and a ladder within reach.
function moveActor(a, dt, speed, climbSpeed) {
    if (a.climbing) {
        // Reversing direction mid-climb swaps the destination girder.
        if (a.dirY !== 0) {
            const want = a.dirY > 0 ? Math.max(a.climbFrom, a.climbTo) : Math.min(a.climbFrom, a.climbTo);
            if (a.climbTo !== want) {
                const from = a.climbTo;
                a.climbTo = a.climbFrom;
                a.climbFrom = from;
            }
        }
        const targetY = floorY(a.climbTo);
        const dir = targetY > a.y ? 1 : -1;
        a.y += dir * climbSpeed * dt;
        if ((targetY - a.y) * dir <= 0) {
            a.y = targetY;
            a.floor = a.climbTo;
            a.climbing = false;
        }
        return;
    }

    if (a.dirY !== 0) {
        const to = a.floor + a.dirY;
        if (to >= 0 && to <= PLATE_FLOOR) {
            const lx = ladderNear(a.x, a.floor, to);
            if (lx !== null) {
                a.x = lx;
                a.climbing = true;
                a.climbFrom = a.floor;
                a.climbTo = to;
                return;
            }
        }
    }

    if (a.dirX !== 0) {
        a.facing = a.dirX;
        a.x = clampX(a.x + a.dirX * speed * dt);
    }
}

// ---------------------------------------------------------------------------
// Treading on layers
// ---------------------------------------------------------------------------

// The chef only ever treads on the top layer of a pile, and never on layers
// already resting on a plate.
function treadOnLayers() {
    if (chef.climbing) return;
    for (let col = 0; col < NUM_BURGERS; col++) {
        if (chef.x < colLeft(col) || chef.x >= colLeft(col) + ING_W) continue;
        const ing = topOfPile(col, chef.floor);
        if (!ing || ing.floor >= PLATE_FLOOR) continue;
        const seg = Math.floor((chef.x - colLeft(col)) / SEG_W);
        if (seg < 0 || seg >= SEG_COUNT) continue;
        ing.segs[seg] = true;
        if (ing.segs.every(Boolean)) dropIngredient(ing);
    }
}

function dropIngredient(ing) {
    if (!ing || ing.falling || ing.floor >= PLATE_FLOOR) return false;
    ing.falling = true;
    ing.segs.fill(false);
    score += DROP_POINTS;
    return true;
}

// A falling layer lands on top of whatever is waiting on the next girder down:
// bare steel, another pile, or a plate.
function updateFalling(dt) {
    for (const ing of ingredients) {
        if (!ing.falling) continue;
        const to = ing.floor + 1;
        const targetY = restingY(to, pileAt(ing.col, to).length);
        ing.y += FALL_SPEED * dt;
        squashUnder(ing);
        if (ing.y >= targetY) {
            ing.y = targetY;
            ing.floor = to;
            ing.pileIndex = pileAt(ing.col, to).length;
            ing.falling = false;
            if (to === PLATE_FLOOR) {
                score += PLATE_POINTS;
                checkBurger(ing.col);
            }
        }
    }
}

function squashUnder(ing) {
    for (const e of enemies) {
        if (e.dead) continue;
        if (Math.abs(e.y - ing.y) > SQUASH_REACH) continue;
        if (e.x < ing.x - ACTOR_HALF || e.x > ing.x + ING_W + ACTOR_HALF) continue;
        squashEnemy(e);
    }
}

function squashEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    e.stun = 0;
    e.climbing = false;
    e.respawn = RESPAWN_TIME;
    score += SQUASH_POINTS;
}

// Test seam / shortcut: plate every layer still above the plates in one column,
// bottom layer first.
function serveColumn(col) {
    const remaining = ingredients
        .filter((i) => i.col === col && i.floor < PLATE_FLOOR)
        .sort((a, b) => b.floor - a.floor);
    for (const ing of remaining) plateIngredient(ing);
}

function plateIngredient(ing) {
    ing.falling = false;
    ing.segs.fill(false);
    ing.floor = PLATE_FLOOR;
    ing.pileIndex = pileAt(ing.col, PLATE_FLOOR).length;
    ing.y = restingY(PLATE_FLOOR, ing.pileIndex);
    score += PLATE_POINTS;
    checkBurger(ing.col);
}

function checkBurger(col) {
    if (pileAt(col, PLATE_FLOOR).length !== LAYERS.length) return;
    score += BURGER_POINTS;
    if (servedCount() >= NUM_BURGERS) completeLevel();
}

function completeLevel() {
    score += LEVEL_POINTS;
    nextLevel();
}

function nextLevel() {
    level += 1;
    pepper = START_PEPPER;
    buildLevel();
    resetPositions();
    updateHud();
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function firePepper() {
    if (state !== 'running' || pepper <= 0) return false;
    pepper -= 1;
    peppers.push({
        x: chef.x + chef.facing * (ACTOR_HALF + PEPPER_W / 2),
        y: chef.y,
        w: PEPPER_W,
        h: PEPPER_H,
        life: PEPPER_LIFE,
    });
    updateHud();
    return true;
}

function updatePeppers(dt) {
    for (let i = peppers.length - 1; i >= 0; i--) {
        const cloud = peppers[i];
        cloud.life -= dt;
        for (const e of enemies) {
            if (e.dead) continue;
            if (Math.abs(e.y - cloud.y) > PEPPER_H / 2 + 3) continue;
            if (Math.abs(e.x - cloud.x) > cloud.w / 2 + ACTOR_HALF) continue;
            e.stun = STUN_TIME;
            e.climbing = false;
        }
        if (cloud.life <= 0) peppers.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

// Greedy chase: close the vertical gap by way of the nearest useful ladder,
// otherwise walk straight at the chef.
function enemyThink(e) {
    const chefFloor = chef.climbing ? chef.climbTo : chef.floor;
    if (e.floor !== chefFloor) {
        const dir = chefFloor > e.floor ? 1 : -1;
        const lx = nearestLadderX(e.x, e.floor, e.floor + dir);
        if (lx !== null) {
            if (Math.abs(e.x - lx) <= LADDER_SNAP) {
                e.dirX = 0;
                e.dirY = dir;
                return;
            }
            e.dirX = lx > e.x ? 1 : -1;
            e.dirY = 0;
            return;
        }
    }
    e.dirY = 0;
    e.dirX = chef.x === e.x ? e.facing : (chef.x > e.x ? 1 : -1);
}

function updateEnemies(dt) {
    const speed = enemySpeed();
    for (const e of enemies) {
        if (e.dead) {
            e.respawn -= dt;
            if (e.respawn <= 0) placeAtSpawn(e);
            continue;
        }
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - dt);
            continue;
        }
        if (!e.climbing) enemyThink(e);
        moveActor(e, dt, speed, speed * ENEMY_CLIMB_RATIO);
    }
}

function checkChefCaught() {
    for (const e of enemies) {
        if (e.dead || e.stun > 0) continue;
        if (Math.abs(e.x - chef.x) > TOUCH_DIST) continue;
        if (Math.abs(e.y - chef.y) > TOUCH_DIST) continue;
        loseLife();
        return;
    }
}

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

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    moveActor(chef, h, CHEF_SPEED, CHEF_CLIMB);
    treadOnLayers();
    updateFalling(h);
    updatePeppers(h);
    updateEnemies(h);
    checkChefCaught();
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so that fast
// crossings (a chef stepping over a segment, a layer passing an enemy) are never
// skipped and the integration is frame-rate independent.
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
    level = 1;
    lives = START_LIVES;
    pepper = START_PEPPER;
    buildLevel();
    resetPositions();
    hideOverlay();
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Score ' + score + ' · Level ' + level, 'Press Space to cook again', 'Play Again');
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
    pepperEl.textContent = String(pepper);
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

const LAYER_STYLE = {
    bunTop: { fill: '#d8973c', h: 12 },
    patty: { fill: '#6b4226', h: 10 },
    bunBottom: { fill: '#c9822f', h: 10 },
};

const ENEMY_STYLE = {
    dog: '#e0674a',
    egg: '#f2e8c9',
    pickle: '#6aa84f',
};

function draw() {
    // Background.
    ctx.fillStyle = '#10131f';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Ladders behind the girders.
    for (let f = 0; f < PLATE_FLOOR; f++) {
        for (const lx of LADDER_XS) {
            if (!hasLadder(lx, f, f + 1)) continue;
            drawLadder(lx, floorY(f), floorY(f + 1));
        }
    }

    // Girders.
    ctx.fillStyle = '#3f4a6b';
    for (let f = 0; f < FLOOR_COUNT; f++) {
        ctx.fillRect(0, floorY(f), CANVAS_W, 5);
        ctx.fillStyle = '#55628c';
        ctx.fillRect(0, floorY(f), CANVAS_W, 2);
        ctx.fillStyle = '#3f4a6b';
    }

    // Plates.
    for (let col = 0; col < NUM_BURGERS; col++) {
        ctx.fillStyle = '#d9dde8';
        ctx.fillRect(colLeft(col) - 8, floorY(PLATE_FLOOR) + 6, ING_W + 16, 6);
        ctx.fillStyle = '#a7adbf';
        ctx.fillRect(colLeft(col) - 8, floorY(PLATE_FLOOR) + 12, ING_W + 16, 3);
    }

    // Burger layers.
    for (const ing of ingredients) drawLayer(ing);

    // Pepper clouds.
    for (const cloud of peppers) {
        ctx.globalAlpha = Math.max(0.15, cloud.life / PEPPER_LIFE);
        ctx.fillStyle = '#f6f2d0';
        for (let i = 0; i < 8; i++) {
            const px = cloud.x - cloud.w / 2 + ((i * 7 + 3) % cloud.w);
            const py = cloud.y - cloud.h / 2 + ((i * 11 + 5) % cloud.h);
            ctx.fillRect(px, py, 3, 3);
        }
        ctx.globalAlpha = 1;
    }

    // Enemies.
    for (const e of enemies) {
        if (e.dead) continue;
        drawEnemy(e);
    }

    // Chef.
    drawChef();
}

function drawLadder(x, yTop, yBottom) {
    ctx.strokeStyle = '#4b5578';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 9, yTop);
    ctx.lineTo(x - 9, yBottom);
    ctx.moveTo(x + 9, yTop);
    ctx.lineTo(x + 9, yBottom);
    ctx.stroke();
    for (let y = yTop + 8; y < yBottom; y += 12) {
        ctx.beginPath();
        ctx.moveTo(x - 9, y);
        ctx.lineTo(x + 9, y);
        ctx.stroke();
    }
}

function drawLayer(ing) {
    const style = LAYER_STYLE[ing.type] || LAYER_STYLE.patty;
    const top = ing.y - style.h;
    ctx.fillStyle = style.fill;
    ctx.fillRect(ing.x, top, ING_W, style.h);

    if (ing.type === 'bunTop') {
        ctx.fillStyle = '#efc078';
        ctx.fillRect(ing.x + 4, top - 3, ING_W - 8, 4);
        ctx.fillStyle = '#fff4d6';
        for (let i = 0; i < 5; i++) ctx.fillRect(ing.x + 10 + i * 13, top + 2, 3, 2);
    } else if (ing.type === 'patty') {
        ctx.fillStyle = '#8a5a33';
        ctx.fillRect(ing.x, top + 2, ING_W, 2);
    } else {
        ctx.fillStyle = '#7ac06a';
        ctx.fillRect(ing.x - 3, ing.y - 3, ING_W + 6, 3);
    }

    // Trodden segments show as a dimple in the layer.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ing.segs.forEach((trod, i) => {
        if (trod) ctx.fillRect(ing.x + i * SEG_W + 2, top + style.h - 3, SEG_W - 4, 3);
    });
}

function drawChef() {
    const x = chef.x;
    const y = chef.y;
    ctx.fillStyle = '#f4f7ff';               // hat
    ctx.fillRect(x - 8, y - 26, 16, 6);
    ctx.fillStyle = '#f0c49b';               // face
    ctx.fillRect(x - 6, y - 20, 12, 7);
    ctx.fillStyle = '#4f8fef';               // apron
    ctx.fillRect(x - 8, y - 13, 16, 10);
    ctx.fillStyle = '#22304f';               // legs
    ctx.fillRect(x - 7, y - 3, 5, 3);
    ctx.fillRect(x + 2, y - 3, 5, 3);
    ctx.fillStyle = '#22304f';               // facing eye
    ctx.fillRect(x + (chef.facing >= 0 ? 1 : -4), y - 18, 3, 3);
}

function drawEnemy(e) {
    const x = e.x;
    const y = e.y;
    ctx.fillStyle = e.stun > 0 ? '#9aa4bd' : (ENEMY_STYLE[e.kind] || '#e0674a');
    ctx.fillRect(x - 9, y - 18, 18, 15);
    ctx.fillStyle = '#1b2135';
    ctx.fillRect(x - 5, y - 14, 3, 3);
    ctx.fillRect(x + 2, y - 14, 3, 3);
    ctx.fillStyle = e.stun > 0 ? '#dbe2f2' : '#1b2135';
    ctx.fillRect(x - 7, y - 3, 5, 3);
    ctx.fillRect(x + 2, y - 3, 5, 3);
    if (e.stun > 0) {
        ctx.fillStyle = '#f6f2d0';
        ctx.fillRect(x - 2, y - 24, 4, 4);
    }
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
    moveChef(
        (held(RIGHT_KEYS) ? 1 : 0) - (held(LEFT_KEYS) ? 1 : 0),
        (held(DOWN_KEYS) ? 1 : 0) - (held(UP_KEYS) ? 1 : 0),
    );
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else firePepper();
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

best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
pepper = START_PEPPER;
buildLevel();
enemies.length = 0;      // the girders stay quiet until the first game starts
chef.y = floorY(PLATE_FLOOR);
updateHud();
requestAnimationFrame(frame);
