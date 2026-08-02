// ---------------------------------------------------------------------------
// BurgerTime — a ladders-and-platforms arcade game on an HTML5 canvas.
//
// A chef runs along five floors joined by ladders. Walking the full width of a
// burger ingredient knocks its whole pile down one level; a pile that lands on
// another pile shoves that one down too, so a single well-timed run can cascade
// an entire burger toward the plate below. Meanwhile hot dogs, eggs and pickles
// hunt the chef, who can hold them off with a limited supply of pepper.
//
// Written as a single classic (non-module) script so that the game state and
// logic are reachable from the Playwright tests as plain globals, mirroring
// Kaboom, Snake and Tetris elsewhere in this repo. All motion is expressed
// per-second and advanced through `step(dt)`, so tests can simulate frames
// deterministically without depending on requestAnimationFrame wall-clock time.
// ---------------------------------------------------------------------------

// --- World geometry ---------------------------------------------------------
const CANVAS_W = 600;
const CANVAS_H = 600;

const FLOOR_X0 = 6;            // left edge of every floor
const FLOOR_X1 = 594;          // right edge of every floor

// Levels 0..4 are walkable floors; level 5 is the row of plates underneath.
const LEVEL_Y = [90, 190, 290, 390, 490, 552];
const FLOOR_COUNT = 5;
const PLATE_LEVEL = 5;

// Ladders live between the burger columns. `gaps` lists the floor gaps a ladder
// spans: gap `g` joins floor `g` (above) to floor `g + 1` (below). Leaving gaps
// out is what makes the level a maze rather than a grid.
const LADDER_SPECS = [
    { x: 20, gaps: [0, 1, 2, 3] },
    { x: 160, gaps: [0, 1, 3] },
    { x: 300, gaps: [1, 2, 3] },
    { x: 440, gaps: [0, 1, 3] },
    { x: 580, gaps: [0, 1, 2, 3] },
];
const LADDER_X = LADDER_SPECS.map((s) => s.x);
const LADDER_W = 26;
const LADDERS = LADDER_SPECS.flatMap((s) => s.gaps.map((g) => ({ x: s.x, top: g, bottom: g + 1 })));

const CHEF_SNAP = 14;          // how close the chef must be to mount a ladder
const ENEMY_SNAP = 6;

// --- Burgers ----------------------------------------------------------------
const COL_X = [90, 230, 370, 510];   // centre of each burger column
const ING_W = 112;
const SEG_COUNT = 4;
const SEG_W = ING_W / SEG_COUNT;
const ING_H = 14;

const KINDS = ['bun-top', 'lettuce', 'patty', 'bun-bottom'];
const START_LEVELS = [0, 1, 2, 3];   // where each kind begins, top-down

const ING_COLOR = {
    'bun-top': '#e0a961',
    'lettuce': '#6fbf4a',
    'patty': '#8a4b2a',
    'bun-bottom': '#c98c47',
};

// --- Chef -------------------------------------------------------------------
const CHEF_W = 20;
const CHEF_H = 26;
const CHEF_SPEED = 120;
const CHEF_START_X = 300;
const CHEF_START_FLOOR = 4;

// --- Falling ----------------------------------------------------------------
const FALL_SPEED = 260;

// --- Enemies ----------------------------------------------------------------
const ENEMY_KINDS = ['hotdog', 'egg', 'pickle'];
const ENEMY_COLOR = { hotdog: '#e05a4a', egg: '#f2e6c2', pickle: '#5ea63c' };
const ENEMY_BASE_SPEED = 52;
const ENEMY_SPEED_STEP = 9;
const ENEMY_MAX_SPEED = 110;
const ENEMY_W = 20;
const ENEMY_H = 24;
const SPAWN_INTERVAL = 3.5;
const FIRST_SPAWN = 2.5;
const ENEMY_BASE_CAP = 3;
const ENEMY_MAX_CAP = 5;

// --- Pepper -----------------------------------------------------------------
const START_PEPPERS = 5;
const PEPPER_RANGE = 46;
const PEPPER_TIME = 0.35;
const STUN_TIME = 5;

// --- Scoring ----------------------------------------------------------------
const POINTS_PER_INGREDIENT = 50;
const POINTS_PER_SQUASH = 500;
const LEVEL_BONUS = 1000;
const START_LIVES = 3;
const BEST_KEY = 'burgertime-best';

// --- DOM --------------------------------------------------------------------
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

// --- State ------------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, lives, level, peppers, spawnTimer;

const chef = { x: CHEF_START_X, y: LEVEL_Y[CHEF_START_FLOOR], floor: CHEF_START_FLOOR, onLadder: false, ladder: null, facing: 1 };
const chefInput = { x: 0, y: 0 };

const ingredients = [];      // every ingredient on the board, in creation order
const fallingGroups = [];    // piles currently in mid-air
const enemies = [];
const sprays = [];
let piles = [];              // piles[col][level] = ingredients, bottom-to-top

// Small deterministic PRNG so enemy spawns can be reproduced in tests.
let rngState = 20250802;
function setSeed(s) { rngState = s >>> 0; }
function rnd() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
}

// ---------------------------------------------------------------------------
// Board setup
// ---------------------------------------------------------------------------

function buildBoard() {
    ingredients.length = 0;
    fallingGroups.length = 0;
    piles = COL_X.map(() => LEVEL_Y.map(() => []));
    for (let c = 0; c < COL_X.length; c++) {
        for (let k = 0; k < KINDS.length; k++) {
            const ing = {
                col: c,
                kind: KINDS[k],
                level: START_LEVELS[k],
                stack: 0,
                y: LEVEL_Y[START_LEVELS[k]],
                segments: [false, false, false, false],
                falling: false,
            };
            ingredients.push(ing);
            piles[c][START_LEVELS[k]].push(ing);
        }
    }
    restack();
}

// Recompute every resting ingredient's level, stack index and draw height from
// the pile arrays. Called after anything lands.
function restack() {
    for (let c = 0; c < piles.length; c++) {
        for (let l = 0; l < piles[c].length; l++) {
            piles[c][l].forEach((ing, i) => {
                ing.level = l;
                ing.stack = i;
                ing.falling = false;
                ing.y = LEVEL_Y[l] - i * ING_H;
            });
        }
    }
}

function columnComplete(col) {
    return piles[col][PLATE_LEVEL].length === KINDS.length;
}

function ingredientLeft(col) { return COL_X[col] - ING_W / 2; }

// ---------------------------------------------------------------------------
// Ladders
// ---------------------------------------------------------------------------

// The ladder reachable from `floor` heading `dir` (-1 up, +1 down) at x, or null.
function ladderAt(x, floor, dir, snap) {
    const reach = snap === undefined ? CHEF_SNAP : snap;
    for (const lad of LADDERS) {
        if (Math.abs(lad.x - x) > reach) continue;
        if (dir < 0 && lad.bottom === floor) return lad;
        if (dir > 0 && lad.top === floor) return lad;
    }
    return null;
}

// Nearest ladder on `floor` that heads in `dir`, used by the enemy AI to decide
// which way to walk when the chef is on another floor.
function nearestLadder(x, floor, dir) {
    let best = null;
    for (const lad of LADDERS) {
        if (dir < 0 && lad.bottom !== floor) continue;
        if (dir > 0 && lad.top !== floor) continue;
        if (!best || Math.abs(lad.x - x) < Math.abs(best.x - x)) best = lad;
    }
    return best;
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function placeChef(x, floor) {
    chef.x = x;
    chef.y = LEVEL_Y[floor];
    chef.floor = floor;
    chef.onLadder = false;
    chef.ladder = null;
}

function updateChef(dt) {
    if (chefInput.y !== 0) {
        if (!chef.onLadder) {
            const lad = ladderAt(chef.x, chef.floor, chefInput.y);
            if (lad) {
                chef.x = lad.x;
                chef.onLadder = true;
                chef.ladder = lad;
            }
        }
        if (chef.onLadder) {
            const lad = chef.ladder;
            chef.y += chefInput.y * CHEF_SPEED * dt;
            if (chef.y <= LEVEL_Y[lad.top]) {
                chef.y = LEVEL_Y[lad.top];
                chef.floor = lad.top;
                chef.onLadder = false;
                chef.ladder = null;
            } else if (chef.y >= LEVEL_Y[lad.bottom]) {
                chef.y = LEVEL_Y[lad.bottom];
                chef.floor = lad.bottom;
                chef.onLadder = false;
                chef.ladder = null;
            }
            return;
        }
    }

    if (chefInput.x !== 0) {
        // Stepping off a ladder is only possible level with a floor, which is
        // always true here because the chef leaves the ladder on arrival.
        if (chef.onLadder) return;
        chef.facing = chefInput.x;
        chef.x = Math.max(FLOOR_X0 + CHEF_W / 2,
            Math.min(FLOOR_X1 - CHEF_W / 2, chef.x + chefInput.x * CHEF_SPEED * dt));
    }
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

// Standing on an ingredient presses the segment under the chef's feet. Once all
// four segments of the topmost ingredient are pressed, the whole pile drops.
function updatePress() {
    if (chef.onLadder) return;
    const f = chef.floor;
    if (f < 0 || f >= FLOOR_COUNT) return;
    if (Math.abs(chef.y - LEVEL_Y[f]) > 0.5) return;

    for (let c = 0; c < COL_X.length; c++) {
        const left = ingredientLeft(c);
        if (chef.x < left || chef.x > left + ING_W) continue;
        const pile = piles[c][f];
        if (!pile.length) continue;
        const top = pile[pile.length - 1];
        const seg = Math.max(0, Math.min(SEG_COUNT - 1, Math.floor((chef.x - left) / SEG_W)));
        top.segments[seg] = true;
        if (top.segments.every(Boolean)) dropPile(c, f);
    }
}

function dropPile(col, lvl) {
    const items = piles[col][lvl];
    if (!items.length || lvl >= PLATE_LEVEL) return false;
    piles[col][lvl] = [];

    // Anything standing on this stretch of floor rides the pile down.
    const riders = enemies.filter((e) => e.alive && !e.onLadder && e.floor === lvl
        && Math.abs(e.x - COL_X[col]) <= ING_W / 2);
    riders.forEach((e) => { e.riding = true; });

    items.forEach((it) => {
        it.falling = true;
        it.segments = [false, false, false, false];
    });
    fallingGroups.push({ col, items, y: LEVEL_Y[lvl], target: lvl + 1, riders });
    return true;
}

function updateFalling(dt) {
    for (let i = fallingGroups.length - 1; i >= 0; i--) {
        const g = fallingGroups[i];
        g.y += FALL_SPEED * dt;

        // Absorb any pile we land on and keep going: the shoved pile ends up
        // underneath ours, one level further down.
        let resting = false;
        while (g.y >= LEVEL_Y[g.target]) {
            if (g.target < PLATE_LEVEL && piles[g.col][g.target].length) {
                g.items = piles[g.col][g.target].concat(g.items);
                piles[g.col][g.target] = [];
                g.target++;
            } else {
                resting = true;
                break;
            }
        }

        if (resting) {
            piles[g.col][g.target] = piles[g.col][g.target].concat(g.items);
            score += POINTS_PER_INGREDIENT * g.items.length;
            for (const e of g.riders) {
                if (e.alive) {
                    e.alive = false;
                    score += POINTS_PER_SQUASH;
                }
            }
            restack();
            fallingGroups.splice(i, 1);
        } else {
            g.items.forEach((it, k) => { it.y = g.y - k * ING_H; });
        }
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function enemySpeed() {
    return Math.min(ENEMY_MAX_SPEED, ENEMY_BASE_SPEED + (level - 1) * ENEMY_SPEED_STEP);
}

function enemyCap() {
    return Math.min(ENEMY_MAX_CAP, ENEMY_BASE_CAP + Math.floor((level - 1) / 2));
}

function spawnEnemy(x, floor, kind) {
    const e = {
        x,
        y: LEVEL_Y[floor],
        floor,
        kind: kind || ENEMY_KINDS[Math.floor(rnd() * ENEMY_KINDS.length)],
        dirX: x < CANVAS_W / 2 ? 1 : -1,
        dirY: 0,
        onLadder: false,
        ladder: null,
        stun: 0,
        riding: false,
        alive: true,
    };
    enemies.push(e);
    return e;
}

function updateSpawn(dt) {
    spawnTimer -= dt;
    const live = enemies.filter((e) => e.alive).length;
    if (spawnTimer <= 0 && live < enemyCap()) {
        spawnTimer = SPAWN_INTERVAL;
        spawnEnemy(rnd() < 0.5 ? LADDER_X[0] : LADDER_X[LADDER_X.length - 1], 0);
    }
    for (let i = enemies.length - 1; i >= 0; i--) {
        if (!enemies[i].alive) enemies.splice(i, 1);
    }
}

function enemyStep(e, dt) {
    if (e.stun > 0) {
        e.stun -= dt;
        return;
    }
    const spd = enemySpeed();

    if (e.onLadder) {
        e.y += e.dirY * spd * dt;
        const lad = e.ladder;
        if (e.y <= LEVEL_Y[lad.top]) {
            e.y = LEVEL_Y[lad.top];
            e.floor = lad.top;
            e.onLadder = false;
            e.ladder = null;
        } else if (e.y >= LEVEL_Y[lad.bottom]) {
            e.y = LEVEL_Y[lad.bottom];
            e.floor = lad.bottom;
            e.onLadder = false;
            e.ladder = null;
        }
        return;
    }

    if (chef.floor !== e.floor) {
        const dir = chef.floor > e.floor ? 1 : -1;
        const here = ladderAt(e.x, e.floor, dir, ENEMY_SNAP);
        if (here) {
            e.x = here.x;
            e.onLadder = true;
            e.ladder = here;
            e.dirY = dir;
            return;
        }
        const target = nearestLadder(e.x, e.floor, dir);
        if (target) e.dirX = target.x > e.x ? 1 : -1;
    } else {
        e.dirX = chef.x > e.x ? 1 : -1;
    }

    e.x += e.dirX * spd * dt;
    if (e.x <= FLOOR_X0 + ENEMY_W / 2) { e.x = FLOOR_X0 + ENEMY_W / 2; e.dirX = 1; }
    if (e.x >= FLOOR_X1 - ENEMY_W / 2) { e.x = FLOOR_X1 - ENEMY_W / 2; e.dirX = -1; }
}

function checkCollisions() {
    for (const e of enemies) {
        if (!e.alive || e.stun > 0) continue;
        if (Math.abs(e.x - chef.x) < (CHEF_W + ENEMY_W) / 2 - 4
            && Math.abs(e.y - chef.y) < (CHEF_H + ENEMY_H) / 2 - 5) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function firePepper() {
    if (state !== 'running' || peppers <= 0) return false;
    peppers--;
    const x0 = chef.facing > 0 ? chef.x + 6 : chef.x - 6 - PEPPER_RANGE;
    const spray = { x: x0, y: chef.y - CHEF_H, w: PEPPER_RANGE, h: CHEF_H, t: PEPPER_TIME };
    sprays.push(spray);
    for (const e of enemies) {
        if (!e.alive) continue;
        const hitX = e.x + ENEMY_W / 2 > spray.x && e.x - ENEMY_W / 2 < spray.x + spray.w;
        const hitY = Math.abs(e.y - chef.y) < 26;
        if (hitX && hitY) e.stun = STUN_TIME;
    }
    updateHud();
    return true;
}

// ---------------------------------------------------------------------------
// Lives / levels
// ---------------------------------------------------------------------------

function resetPositions() {
    enemies.length = 0;
    sprays.length = 0;
    chefInput.x = 0;
    chefInput.y = 0;
    placeChef(CHEF_START_X, CHEF_START_FLOOR);
    chef.facing = 1;
    spawnTimer = FIRST_SPAWN;
}

function loseLife() {
    lives--;
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    resetPositions();
    updateHud();
}

function checkLevelClear() {
    if (fallingGroups.length) return;
    for (let c = 0; c < COL_X.length; c++) {
        if (!columnComplete(c)) return;
    }
    score += LEVEL_BONUS;
    level++;
    peppers = START_PEPPERS;
    buildBoard();
    resetPositions();
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (err) { /* ignore */ }
    }
    overlayTitle.textContent = 'GAME OVER';
    overlayScore.textContent = `Score ${score} · Level ${level}`;
    overlaySub.textContent = 'Press Space or click Start to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
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
    resetPositions();
    overlay.classList.remove('visible');
    btnStart.textContent = 'Start Game';
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        overlayTitle.textContent = 'PAUSED';
        overlayScore.textContent = `Score ${score}`;
        overlaySub.textContent = 'Press P to resume';
        overlay.classList.add('visible');
    } else if (state === 'paused') {
        state = 'running';
        overlay.classList.remove('visible');
    }
}

function step(dt) {
    if (state !== 'running') return;
    updateChef(dt);
    updatePress();
    updateFalling(dt);
    updateSpawn(dt);
    for (const e of enemies) {
        if (e.alive) enemyStep(e, dt);
    }
    for (let i = sprays.length - 1; i >= 0; i--) {
        sprays[i].t -= dt;
        if (sprays[i].t <= 0) sprays.splice(i, 1);
    }
    checkCollisions();
    if (state === 'running') checkLevelClear();
    updateHud();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

const hudCache = {};
function setText(el, key, value) {
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    el.textContent = value;
}

function updateHud() {
    setText(scoreEl, 'score', String(score));
    setText(levelEl, 'level', String(level));
    setText(livesEl, 'lives', String(lives));
    setText(peppersEl, 'peppers', String(peppers));
    setText(bestEl, 'best', String(best));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawFloors() {
    ctx.fillStyle = '#3c4c6d';
    for (let i = 0; i < FLOOR_COUNT; i++) {
        ctx.fillRect(FLOOR_X0, LEVEL_Y[i], FLOOR_X1 - FLOOR_X0, 5);
    }
}

function drawLadders() {
    ctx.strokeStyle = '#8ea3c9';
    ctx.lineWidth = 2;
    for (const lad of LADDERS) {
        const top = LEVEL_Y[lad.top];
        const bot = LEVEL_Y[lad.bottom];
        ctx.beginPath();
        ctx.moveTo(lad.x - LADDER_W / 2, top);
        ctx.lineTo(lad.x - LADDER_W / 2, bot);
        ctx.moveTo(lad.x + LADDER_W / 2, top);
        ctx.lineTo(lad.x + LADDER_W / 2, bot);
        for (let y = top + 10; y < bot; y += 14) {
            ctx.moveTo(lad.x - LADDER_W / 2, y);
            ctx.lineTo(lad.x + LADDER_W / 2, y);
        }
        ctx.stroke();
    }
}

function drawPlates() {
    ctx.fillStyle = '#cbd5e1';
    for (const cx of COL_X) {
        ctx.beginPath();
        ctx.ellipse(cx, LEVEL_Y[PLATE_LEVEL] + 6, ING_W / 2 + 8, 9, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawIngredient(ing) {
    const left = ingredientLeft(ing.col);
    const base = ING_COLOR[ing.kind];
    for (let s = 0; s < SEG_COUNT; s++) {
        const dip = ing.segments[s] ? 4 : 0;
        const x = left + s * SEG_W;
        const y = ing.y - ING_H + dip;
        ctx.fillStyle = base;
        ctx.fillRect(x + 1, y, SEG_W - 2, ING_H - 3);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        ctx.fillRect(x + 1, y + ING_H - 5, SEG_W - 2, 2);
    }
    if (ing.kind === 'bun-top') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        for (let i = 0; i < 5; i++) {
            ctx.fillRect(left + 12 + i * 20, ing.y - ING_H + 3, 4, 2);
        }
    }
}

function drawChef() {
    const x = chef.x;
    const y = chef.y;
    ctx.fillStyle = '#f8fafc';                     // apron / body
    ctx.fillRect(x - CHEF_W / 2, y - CHEF_H + 8, CHEF_W, CHEF_H - 8);
    ctx.fillStyle = '#1e293b';                     // legs
    ctx.fillRect(x - CHEF_W / 2 + 2, y - 5, 5, 5);
    ctx.fillRect(x + CHEF_W / 2 - 7, y - 5, 5, 5);
    ctx.fillStyle = '#fcd9a8';                     // face
    ctx.fillRect(x - 6, y - CHEF_H + 8, 12, 7);
    ctx.fillStyle = '#ffffff';                     // hat
    ctx.fillRect(x - 9, y - CHEF_H - 2, 18, 10);
    ctx.fillStyle = '#0ea5e9';                     // scarf, hints at facing
    ctx.fillRect(x - 6 + chef.facing * 3, y - CHEF_H + 15, 12, 3);
}

function drawEnemy(e) {
    const x = e.x;
    const y = e.y;
    ctx.fillStyle = ENEMY_COLOR[e.kind] || '#e05a4a';
    ctx.fillRect(x - ENEMY_W / 2, y - ENEMY_H, ENEMY_W, ENEMY_H);
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(x - 6, y - ENEMY_H + 6, 4, 4);
    ctx.fillRect(x + 2, y - ENEMY_H + 6, 4, 4);
    if (e.stun > 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(x - ENEMY_W / 2, y - ENEMY_H - 6, ENEMY_W, 4);
    }
}

function drawSprays() {
    for (const s of sprays) {
        ctx.fillStyle = `rgba(226, 232, 240, ${0.25 + 0.5 * (s.t / PEPPER_TIME)})`;
        for (let i = 0; i < 14; i++) {
            const px = s.x + ((i * 37) % s.w);
            const py = s.y + ((i * 53) % s.h);
            ctx.fillRect(px, py, 3, 3);
        }
    }
}

function draw() {
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawPlates();
    drawLadders();
    drawFloors();
    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    drawSprays();
    if (state !== 'idle') drawChef();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTs = 0;
function frame(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const held = new Set();
const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];

function refreshInput() {
    const l = LEFT_KEYS.some((k) => held.has(k));
    const r = RIGHT_KEYS.some((k) => held.has(k));
    const u = UP_KEYS.some((k) => held.has(k));
    const d = DOWN_KEYS.some((k) => held.has(k));
    chefInput.x = (r ? 1 : 0) - (l ? 1 : 0);
    chefInput.y = (d ? 1 : 0) - (u ? 1 : 0);
}

window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (state === 'running') firePepper();
        else if (state !== 'paused') startGame();
        return;
    }
    if (e.key === 'Enter' && state !== 'running') {
        startGame();
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if ([...LEFT_KEYS, ...RIGHT_KEYS, ...UP_KEYS, ...DOWN_KEYS].includes(e.key)) {
        held.add(e.key);
        refreshInput();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (held.delete(e.key)) refreshInput();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
peppers = START_PEPPERS;
spawnTimer = FIRST_SPAWN;
buildBoard();
updateHud();
requestAnimationFrame(frame);
