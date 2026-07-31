// ---------------------------------------------------------------------------
// Burger Time — a single-screen platform/ladder arcade game on an HTML5 canvas.
//
// A chef runs along girders and climbs ladders, stamping burger ingredients
// down the board and into the plates below while food enemies hunt him. Written
// as a single classic (non-module) script so the game state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom, Dino
// Run, Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Board geometry ---
const CANVAS_W = 640;
const CANVAS_H = 600;

const FLOOR_YS = [80, 176, 272, 368, 464]; // walking surface of each girder
const FLOOR_COUNT = FLOOR_YS.length;
const TRAY_Y = 552;                         // plate line, below the last girder

const COLUMN_X = [48, 192, 336, 480];       // left edge of each burger column
const COLUMN_COUNT = COLUMN_X.length;

const SEG_W = 28;                           // one stampable segment
const SEGS = 4;                             // segments per ingredient
const ING_W = SEG_W * SEGS;
const ING_H = 12;

const LADDER_XS = [24, 176, 320, 464, 616]; // ladder lane centres
// LADDER_LANES[g] = lanes joining floor g to floor g+1. Alternating sets force
// the chef to zig-zag instead of climbing one lane all the way up.
const LADDER_LANES = [[0, 2, 4], [1, 3], [0, 2, 4], [1, 3]];
const LADDER_SNAP = 14;                     // how close to a lane counts as "on it"
const LADDER_W = 26;

const INGREDIENT_KINDS = ['bunTop', 'lettuce', 'patty', 'bunBottom'];
const INGREDIENTS_PER_BURGER = INGREDIENT_KINDS.length;

// --- Actors ---
const CHEF_SPEED = 110;   // px/s walking
const CLIMB_SPEED = 90;   // px/s on a ladder
const CHEF_HALF = 7;
const CHEF_H = 26;
const FOOT_HALF = 6;      // half-width of the footprint that stamps a segment

const ENEMY_HALF = 11;
const ENEMY_H = 24;
const ENEMY_KINDS = ['hotdog', 'egg', 'pickle'];

const FALL_SPEED = 180;   // px/s of a dropping ingredient

// --- Rules ---
const START_LIVES = 3;
const START_PEPPERS = 5;
const STUN_TIME = 4;          // seconds an enemy stays peppered
const PEPPER_REACH = 26;      // how far ahead of the chef the cloud appears
const PEPPER_LIFE = 0.35;     // seconds the cloud lingers
const PEPPER_R = 22;          // cloud radius

const DROP_SCORE = 50;
const BURGER_SCORE = 500;
const LEVEL_SCORE = 1000;
const SQUASH_BASE = 100;
const SQUASH_MAX = 800;

const SPAWN_BASE = 2.5;
const SPAWN_MIN = 1.2;
const FIRST_SPAWN = 2.0;

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
let state, score, best, level, lives, pepperCount;
let autoSpawn = true;
let enemySpawnTimer = FIRST_SPAWN;
let flash = 0;              // cosmetic banner timer for "LEVEL CLEAR"
let flashText = '';

const chef = { x: CANVAS_W / 2, y: FLOOR_YS[FLOOR_COUNT - 1], floor: FLOOR_COUNT - 1, mode: 'walk', lane: null, gap: null, dirX: 0, dirY: 0, facing: 1, stride: 0 };
const ingredients = [];
const enemies = [];
const puffs = [];
const particles = [];
const tray = [];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function enemySpeed() { return Math.min(112, 52 + level * 6); }
function maxEnemies() { return Math.min(5, 2 + level); }
function spawnInterval() { return Math.max(SPAWN_MIN, SPAWN_BASE - (level - 1) * 0.2); }

// Resting y for a floor index; `FLOOR_COUNT` (one past the last girder) is the plate.
function targetY(floor) { return floor < FLOOR_COUNT ? FLOOR_YS[floor] : TRAY_Y; }

function trayY(index) { return TRAY_Y - index * (ING_H - 2); }

function ingredientAt(col, floor) {
    return ingredients.find((i) => i.col === col && i.floor === floor && !i.inTray) || null;
}

// The ladder lane within reach of `x` that bridges floors `gap` and `gap + 1`.
function ladderLaneAt(x, gap) {
    const lanes = LADDER_LANES[gap];
    if (!lanes) return null;
    let best = null;
    let bestD = LADDER_SNAP;
    for (const lane of lanes) {
        const d = Math.abs(LADDER_XS[lane] - x);
        if (d <= bestD) { bestD = d; best = lane; }
    }
    return best;
}

// Move an actor from walking onto a ladder going up (-1) or down (+1).
function startClimb(actor, dir) {
    const gap = dir < 0 ? actor.floor - 1 : actor.floor;
    if (gap < 0 || gap >= LADDER_LANES.length) return false;
    const lane = ladderLaneAt(actor.x, gap);
    if (lane === null) return false;
    actor.mode = 'climb';
    actor.lane = lane;
    actor.gap = gap;
    actor.x = LADDER_XS[lane];
    return true;
}

function burst(x, y, color, n) {
    for (let i = 0; i < (n || 10); i++) {
        const a = (Math.PI * 2 * i) / (n || 10) + Math.random() * 0.5;
        particles.push({ x, y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 40, life: 0.5, color });
    }
}

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

function buildLevel() {
    ingredients.length = 0;
    for (let col = 0; col < COLUMN_COUNT; col++) {
        for (let k = 0; k < INGREDIENTS_PER_BURGER; k++) {
            ingredients.push({
                col,
                kind: INGREDIENT_KINDS[k],
                floor: k,
                y: FLOOR_YS[k],
                segs: [false, false, false, false],
                falling: false,
                inTray: false,
                chain: 0,
                squashed: 0,
            });
        }
    }
    tray.length = 0;
    for (let col = 0; col < COLUMN_COUNT; col++) tray.push([]);
    enemies.length = 0;
    puffs.length = 0;
    enemySpawnTimer = FIRST_SPAWN;
    resetChef();
}

function resetChef() {
    chef.x = CANVAS_W / 2;
    chef.floor = FLOOR_COUNT - 1;
    chef.y = FLOOR_YS[chef.floor];
    chef.mode = 'walk';
    chef.lane = null;
    chef.gap = null;
    chef.dirX = 0;
    chef.dirY = 0;
    chef.facing = 1;
    chef.stride = 0;
}

// Test seam: drop the chef straight onto a girder.
function setChef(x, floor) {
    chef.floor = clamp(floor, 0, FLOOR_COUNT - 1);
    chef.x = x;
    chef.y = FLOOR_YS[chef.floor];
    chef.mode = 'walk';
    chef.lane = null;
    chef.gap = null;
    chef.dirX = 0;
    chef.dirY = 0;
}

function setChefDir(dx, dy) {
    chef.dirX = dx;
    chef.dirY = dy;
    if (dx) chef.facing = dx;
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function stepChef(dt) {
    if (chef.mode === 'walk') {
        if (chef.dirY < 0) startClimb(chef, -1);
        else if (chef.dirY > 0) startClimb(chef, 1);

        if (chef.mode === 'walk') {
            if (chef.dirX) {
                chef.facing = chef.dirX;
                chef.x = clamp(chef.x + chef.dirX * CHEF_SPEED * dt, CHEF_HALF + 4, CANVAS_W - CHEF_HALF - 4);
                chef.stride += dt * 10;
            }
            chef.y = FLOOR_YS[chef.floor];
        }
    }

    if (chef.mode === 'climb') {
        chef.x = LADDER_XS[chef.lane];
        if (chef.dirY) {
            chef.y += chef.dirY * CLIMB_SPEED * dt;
            chef.stride += dt * 8;
            const topY = FLOOR_YS[chef.gap];
            const botY = FLOOR_YS[chef.gap + 1];
            if (chef.y <= topY) { chef.y = topY; chef.floor = chef.gap; chef.mode = 'walk'; }
            else if (chef.y >= botY) { chef.y = botY; chef.floor = chef.gap + 1; chef.mode = 'walk'; }
        }
    }
}

// Any segment the chef's feet are over is stamped down.
function stampUnderChef() {
    if (chef.mode !== 'walk') return;
    const l = chef.x - FOOT_HALF;
    const r = chef.x + FOOT_HALF;
    for (const ing of ingredients) {
        if (ing.inTray || ing.falling || ing.floor !== chef.floor) continue;
        const base = COLUMN_X[ing.col];
        if (base === undefined) continue;
        if (r <= base || l >= base + ING_W) continue;
        for (let s = 0; s < SEGS; s++) {
            const sx = base + s * SEG_W;
            if (r > sx && l < sx + SEG_W) ing.segs[s] = true;
        }
        if (ing.segs.every(Boolean)) dropIngredient(ing, 0);
    }
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

// Start an ingredient falling exactly one floor. Anything resting on the floor
// it is heading for is knocked into a drop of its own first, so the arriving
// ingredient settles into the slot that was just vacated.
function dropIngredient(ing, chain) {
    if (!ing || ing.falling || ing.inTray) return false;
    const target = ing.floor + 1;
    const below = ingredientAt(ing.col, target);
    if (below && below !== ing) dropIngredient(below, (chain || 0) + 1);
    ing.falling = true;
    ing.chain = chain || 0;
    ing.squashed = 0;
    ing.floor = target;
    for (let s = 0; s < SEGS; s++) ing.segs[s] = true;
    return true;
}

function squashCheck(ing) {
    const left = COLUMN_X[ing.col];
    if (left === undefined) return;
    const right = left + ING_W;
    const top = ing.y - ING_H;
    const bot = ing.y;
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (e.x + ENEMY_HALF < left || e.x - ENEMY_HALF > right) continue;
        if (e.y < top || e.y - ENEMY_H > bot) continue;
        enemies.splice(i, 1);
        ing.squashed++;
        score += Math.min(SQUASH_MAX, SQUASH_BASE * Math.pow(2, ing.squashed - 1));
        burst(e.x, e.y - ENEMY_H / 2, '#f87171', 12);
    }
}

function landIngredient(ing) {
    ing.falling = false;
    for (let s = 0; s < SEGS; s++) ing.segs[s] = false;
    score += DROP_SCORE;

    if (ing.floor >= FLOOR_COUNT) {
        const plate = tray[ing.col];
        ing.inTray = true;
        if (plate) {
            plate.push(ing.kind);
            ing.y = trayY(plate.length - 1);
            if (plate.length === INGREDIENTS_PER_BURGER) {
                score += BURGER_SCORE;
                burst(COLUMN_X[ing.col] + ING_W / 2, TRAY_Y - 20, '#f6a623', 16);
            }
        }
    } else {
        ing.y = targetY(ing.floor);
    }
    updateHud();
}

function stepIngredients(dt) {
    for (const ing of ingredients) {
        if (!ing.falling) continue;
        ing.y += FALL_SPEED * dt;
        squashCheck(ing);
        if (ing.y >= targetY(ing.floor)) {
            ing.y = targetY(ing.floor);
            landIngredient(ing);
        }
    }
    if (ingredients.length && ingredients.every((i) => i.inTray)) levelComplete();
}

function levelComplete() {
    score += LEVEL_SCORE;
    level++;
    pepperCount = START_PEPPERS;
    flash = 1.6;
    flashText = 'LEVEL ' + level;
    buildLevel();
    updateHud();
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemy(opts) {
    const o = opts || {};
    const e = {
        x: o.x !== undefined ? o.x : LADDER_XS[0],
        floor: o.floor !== undefined ? o.floor : FLOOR_COUNT - 1,
        y: 0,
        mode: 'walk',
        lane: null,
        gap: null,
        climbDir: 1,
        stun: 0,
        facing: 1,
        stride: Math.random() * 4,
        kind: o.kind || ENEMY_KINDS[Math.floor(Math.random() * ENEMY_KINDS.length)],
    };
    e.y = FLOOR_YS[e.floor];
    enemies.push(e);
    return e;
}

function stepEnemies(dt) {
    const sp = enemySpeed();
    for (const e of enemies) {
        if (e.stun > 0) { e.stun = Math.max(0, e.stun - dt); continue; }
        e.stride += dt * 8;

        if (e.mode === 'walk') {
            if (e.floor === chef.floor) {
                const dx = chef.x - e.x;
                if (Math.abs(dx) > 1) {
                    e.facing = Math.sign(dx);
                    e.x += e.facing * sp * dt;
                }
            } else {
                const dir = chef.floor > e.floor ? 1 : -1;
                const gap = dir < 0 ? e.floor - 1 : e.floor;
                const lanes = LADDER_LANES[gap] || [];
                let bestX = null;
                let bestD = Infinity;
                for (const lane of lanes) {
                    const d = Math.abs(LADDER_XS[lane] - e.x);
                    if (d < bestD) { bestD = d; bestX = LADDER_XS[lane]; }
                }
                if (bestX === null) {
                    const dx = chef.x - e.x;
                    if (Math.abs(dx) > 1) { e.facing = Math.sign(dx); e.x += e.facing * sp * dt; }
                } else if (bestD <= LADDER_SNAP) {
                    e.climbDir = dir;
                    startClimb(e, dir);
                } else {
                    e.facing = Math.sign(bestX - e.x);
                    e.x += e.facing * sp * dt;
                }
            }
            if (e.mode === 'walk') {
                e.y = FLOOR_YS[e.floor];
                e.x = clamp(e.x, ENEMY_HALF, CANVAS_W - ENEMY_HALF);
            }
        } else {
            e.x = LADDER_XS[e.lane];
            e.y += e.climbDir * sp * dt;
            const topY = FLOOR_YS[e.gap];
            const botY = FLOOR_YS[e.gap + 1];
            if (e.y <= topY) { e.y = topY; e.floor = e.gap; e.mode = 'walk'; }
            else if (e.y >= botY) { e.y = botY; e.floor = e.gap + 1; e.mode = 'walk'; }
        }
    }
}

function stepSpawner(dt) {
    if (!autoSpawn) return;
    enemySpawnTimer -= dt;
    if (enemySpawnTimer > 0) return;
    enemySpawnTimer = spawnInterval();
    if (enemies.length >= maxEnemies()) return;
    const lane = Math.random() < 0.5 ? 0 : LADDER_XS.length - 1;
    spawnEnemy({ x: LADDER_XS[lane], floor: FLOOR_COUNT - 1 });
}

function checkChefHit() {
    for (const e of enemies) {
        if (e.stun > 0) continue;
        if (Math.abs(e.x - chef.x) < ENEMY_HALF + CHEF_HALF && Math.abs(e.y - chef.y) < 18) {
            loseLife();
            return;
        }
    }
}

function loseLife() {
    lives--;
    burst(chef.x, chef.y - CHEF_H / 2, '#f6a623', 14);
    enemies.length = 0;
    puffs.length = 0;
    if (lives <= 0) {
        lives = 0;
        updateHud();
        endGame();
        return;
    }
    resetChef();
    enemySpawnTimer = FIRST_SPAWN;
    updateHud();
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function applyPepper(px, py) {
    for (const e of enemies) {
        const dx = e.x - px;
        const dy = (e.y - ENEMY_H / 2) - py;
        if (Math.sqrt(dx * dx + dy * dy) <= PEPPER_R + ENEMY_HALF) e.stun = STUN_TIME;
    }
}

function throwPepper() {
    if (state !== 'running' || pepperCount <= 0) return false;
    pepperCount--;
    const px = clamp(chef.x + chef.facing * PEPPER_REACH, 12, CANVAS_W - 12);
    const py = chef.y - CHEF_H / 2;
    puffs.push({ x: px, y: py, life: PEPPER_LIFE });
    applyPepper(px, py);
    updateHud();
    return true;
}

function stepPuffs(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.life -= dt;
        applyPepper(p.x, p.y);
        if (p.life <= 0) puffs.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    if (flash > 0) flash = Math.max(0, flash - dt);
    stepChef(dt);
    stampUnderChef();
    stepIngredients(dt);
    stepPuffs(dt);
    stepEnemies(dt);
    checkChefHit();
    stepSpawner(dt);
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 320 * dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    peppersEl.textContent = String(pepperCount);
    bestEl.textContent = String(best);
}

function showOverlay(title, sub, button, sc) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlayScore.textContent = sc || '';
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    pepperCount = START_PEPPERS;
    autoSpawn = true;
    flash = 0;
    particles.length = 0;
    buildLevel();
    state = 'running';
    overlay.classList.remove('visible');
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', 'Press Space or click to play again', 'Play Again', 'Score ' + score);
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', 'Press P to resume', 'Resume', 'Score ' + score);
    } else if (state === 'paused') {
        state = 'running';
        overlay.classList.remove('visible');
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const INGREDIENT_STYLE = {
    bunTop: { fill: '#e2a45c', edge: '#b97f39', h: 13 },
    lettuce: { fill: '#7bc043', edge: '#5a9430', h: 10 },
    patty: { fill: '#8a5230', edge: '#5f3620', h: 12 },
    bunBottom: { fill: '#d9954c', edge: '#a86f31', h: 11 },
};

const ENEMY_STYLE = {
    hotdog: '#e05a4a',
    egg: '#f4e3b2',
    pickle: '#68a63c',
};

function drawGirders() {
    for (let f = 0; f < FLOOR_COUNT; f++) {
        const y = FLOOR_YS[f];
        ctx.fillStyle = '#3d5c8c';
        ctx.fillRect(0, y, CANVAS_W, 6);
        ctx.fillStyle = '#5f83bb';
        ctx.fillRect(0, y, CANVAS_W, 2);
        ctx.fillStyle = '#2b4266';
        for (let x = 6; x < CANVAS_W; x += 20) ctx.fillRect(x, y + 6, 10, 2);
    }
}

function drawLadders() {
    for (let g = 0; g < LADDER_LANES.length; g++) {
        const top = FLOOR_YS[g];
        const bot = FLOOR_YS[g + 1];
        for (const lane of LADDER_LANES[g]) {
            const x = LADDER_XS[lane];
            ctx.fillStyle = '#8d6a3f';
            ctx.fillRect(x - LADDER_W / 2, top, 3, bot - top + 6);
            ctx.fillRect(x + LADDER_W / 2 - 3, top, 3, bot - top + 6);
            ctx.fillStyle = '#b58a52';
            for (let y = top + 8; y < bot + 4; y += 12) {
                ctx.fillRect(x - LADDER_W / 2, y, LADDER_W, 2);
            }
        }
    }
}

function drawPlates() {
    for (let col = 0; col < COLUMN_COUNT; col++) {
        const cx = COLUMN_X[col] + ING_W / 2;
        ctx.fillStyle = '#cdd6e6';
        ctx.beginPath();
        ctx.ellipse(cx, TRAY_Y + 12, ING_W / 2 + 8, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9fb0c9';
        ctx.beginPath();
        ctx.ellipse(cx, TRAY_Y + 9, ING_W / 2 + 2, 6, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawIngredient(ing) {
    const style = INGREDIENT_STYLE[ing.kind];
    const base = COLUMN_X[ing.col];
    if (base === undefined) return;
    for (let s = 0; s < SEGS; s++) {
        const sx = base + s * SEG_W;
        const dip = !ing.falling && !ing.inTray && ing.segs[s] ? 4 : 0;
        const h = style.h;
        const y = ing.y - h + dip;
        ctx.fillStyle = style.edge;
        ctx.fillRect(sx, y, SEG_W, h);
        ctx.fillStyle = style.fill;
        ctx.fillRect(sx, y, SEG_W, h - 3);
        if (ing.kind === 'bunTop') {
            ctx.fillStyle = '#fff3dd';
            ctx.fillRect(sx + 7, y + 3, 3, 2);
            ctx.fillRect(sx + 17, y + 6, 3, 2);
        } else if (ing.kind === 'lettuce') {
            ctx.fillStyle = '#9ede63';
            ctx.fillRect(sx + 2, y + 2, SEG_W - 4, 3);
        } else if (ing.kind === 'patty') {
            ctx.fillStyle = '#6b3f26';
            ctx.fillRect(sx + 4, y + 4, SEG_W - 8, 3);
        }
    }
}

function drawChef() {
    const x = chef.x;
    const y = chef.y;
    const swing = Math.sin(chef.stride) * 4;
    // legs
    ctx.fillStyle = '#2f3a52';
    ctx.fillRect(x - 6, y - 8, 4, 8 + Math.max(0, swing));
    ctx.fillRect(x + 2, y - 8, 4, 8 + Math.max(0, -swing));
    // body / apron
    ctx.fillStyle = '#f3f0ea';
    ctx.fillRect(x - CHEF_HALF, y - 20, CHEF_HALF * 2, 13);
    ctx.fillStyle = '#e05a4a';
    ctx.fillRect(x - CHEF_HALF, y - 20, CHEF_HALF * 2, 3);
    // head
    ctx.fillStyle = '#f0c090';
    ctx.fillRect(x - 5, y - 27, 10, 8);
    // hat
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 7, y - 33, 14, 6);
    ctx.fillRect(x - 5, y - 36, 10, 4);
    // eye
    ctx.fillStyle = '#22283a';
    ctx.fillRect(x + (chef.facing > 0 ? 1 : -3), y - 25, 2, 2);
}

function drawEnemy(e) {
    const color = ENEMY_STYLE[e.kind] || '#e05a4a';
    const bob = e.stun > 0 ? 0 : Math.sin(e.stride) * 2;
    const y = e.y - ENEMY_H + bob;
    ctx.fillStyle = e.stun > 0 ? '#b9c4d6' : color;
    ctx.beginPath();
    ctx.roundRect
        ? ctx.roundRect(e.x - ENEMY_HALF, y, ENEMY_HALF * 2, ENEMY_H, 7)
        : ctx.rect(e.x - ENEMY_HALF, y, ENEMY_HALF * 2, ENEMY_H);
    ctx.fill();

    if (e.kind === 'hotdog') {
        ctx.fillStyle = '#f6c26b';
        ctx.fillRect(e.x - ENEMY_HALF, y + ENEMY_H - 7, ENEMY_HALF * 2, 4);
    } else if (e.kind === 'egg') {
        ctx.fillStyle = '#f6a623';
        ctx.beginPath();
        ctx.arc(e.x, y + ENEMY_H / 2, 4, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.fillStyle = '#4f8029';
        ctx.fillRect(e.x - 5, y + 5, 3, 3);
        ctx.fillRect(e.x + 2, y + 12, 3, 3);
    }

    // eyes
    ctx.fillStyle = '#1b2130';
    if (e.stun > 0) {
        ctx.fillRect(e.x - 6, y + 5, 4, 2);
        ctx.fillRect(e.x + 2, y + 5, 4, 2);
    } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(e.x - 6, y + 4, 4, 4);
        ctx.fillRect(e.x + 2, y + 4, 4, 4);
        ctx.fillStyle = '#1b2130';
        ctx.fillRect(e.x - 5 + (e.facing > 0 ? 1 : 0), y + 5, 2, 2);
        ctx.fillRect(e.x + 3 + (e.facing > 0 ? 1 : 0), y + 5, 2, 2);
    }
}

function drawPuffs() {
    for (const p of puffs) {
        const a = clamp(p.life / PEPPER_LIFE, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#e8e2d5';
        for (let i = 0; i < 9; i++) {
            const ang = (Math.PI * 2 * i) / 9;
            ctx.beginPath();
            ctx.arc(p.x + Math.cos(ang) * PEPPER_R * 0.6, p.y + Math.sin(ang) * PEPPER_R * 0.6, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const bg = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    bg.addColorStop(0, '#181026');
    bg.addColorStop(1, '#0d0a14');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawLadders();
    drawGirders();
    drawPlates();

    for (const ing of ingredients) drawIngredient(ing);
    drawPuffs();
    for (const e of enemies) drawEnemy(e);
    if (state !== 'over') drawChef();

    for (const p of particles) {
        ctx.globalAlpha = clamp(p.life * 2, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    if (flash > 0) {
        ctx.globalAlpha = clamp(flash, 0, 1);
        ctx.fillStyle = '#f6a623';
        ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(flashText, CANVAS_W / 2, 70);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
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
    updateParticles(dt);
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
    const left = LEFT_KEYS.some((k) => heldKeys.has(k));
    const right = RIGHT_KEYS.some((k) => heldKeys.has(k));
    const up = UP_KEYS.some((k) => heldKeys.has(k));
    const down = DOWN_KEYS.some((k) => heldKeys.has(k));
    setChefDir((right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') throwPepper();
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

window.addEventListener('blur', () => {
    heldKeys.clear();
    refreshKeyDir();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = 0;
try { best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0; } catch (e) { /* ignore */ }
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
pepperCount = START_PEPPERS;
buildLevel();
updateHud();
requestAnimationFrame(frame);
