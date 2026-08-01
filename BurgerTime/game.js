// ---------------------------------------------------------------------------
// BurgerTime — a platform/ladder arcade game on an HTML5 canvas.
//
// Chef Peter Pepper runs along girders and climbs ladders. Walking the whole
// length of a burger ingredient drops it one floor; the goal is to walk every
// ingredient down onto the plate at the bottom while dodging roaming food.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 480;

const FLOOR_YS = [80, 150, 220, 290, 360, 430]; // y of each walkable girder
const PLATE_FLOOR = FLOOR_YS.length - 1;        // bottom floor — plates live here

const LADDER_XS = [16, 160, 320, 480, 624];
const LADDERS = LADDER_XS.map((x) => ({ x, top: 0, bottom: PLATE_FLOOR }));

const PLAY_LEFT = 12;
const PLAY_RIGHT = 628;

const FLOOR_TOL = 4;    // how close to a girder still counts as standing on it
const LADDER_SNAP = 12; // how close to a ladder you can be and still grab it

// --- Burgers ---
const BURGER_XS = [32, 192, 352, 512]; // left edge of each burger column
const SEG_W = 24;
const SEGS = 4;
const INGREDIENT_W = SEG_W * SEGS;
const ING_H = 10;

const INGREDIENT_KINDS = [
    { name: 'top bun', color: '#e0a44c', edge: '#b17c2d' },
    { name: 'lettuce', color: '#63c26a', edge: '#3d8f45' },
    { name: 'patty', color: '#8d4f2e', edge: '#5f3319' },
    { name: 'bottom bun', color: '#cf9440', edge: '#a06d24' },
];

// --- Entities ---
const PLAYER_SPEED = 90;
const PLAYER_START_X = 320;
const ENEMY_BASE = 50;
const ENEMY_STEP = 4;
const ENEMY_CAP = PLAYER_SPEED * 0.9; // enemies must never outrun the chef
const CONTACT_X = 13;
const CONTACT_Y = 16;

const ENEMY_KINDS = [
    { name: 'hot dog', color: '#e05c4b', edge: '#8c2f24' },
    { name: 'egg', color: '#f0e3b0', edge: '#b9a45c' },
    { name: 'pickle', color: '#7fbf4d', edge: '#4c8028' },
];

// --- Falling food ---
const FALL_SPEED = 220;
const SQUASH_Y = 16;

// --- Pepper ---
const PEPPER_OFFSET = 20;
const PEPPER_RADIUS = 28;
const PEPPER_STUN = 3;
const PEPPER_LIFE = 0.4;

// --- Spawning ---
const SPAWN_FIRST = 3;

// --- Rules ---
const START_LIVES = 3;
const START_PEPPERS = 5;
const DROP_POINTS = 50;
const SQUASH_POINTS = 100;
const BURGER_POINTS = 500;
const LEVEL_POINTS = 1000;

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
let state, score, best, level, lives, peppers, spawnTimer, burgersCompleted, boardVersion;
const player = { x: PLAYER_START_X, y: FLOOR_YS[PLATE_FLOOR], floor: PLATE_FLOOR, ladder: null, dirX: 0, dirY: 0, facing: 1, walk: 0 };
const ingredients = [];
const enemies = [];
const sprays = [];
const crumbs = [];      // purely cosmetic squash confetti
const burgerDone = BURGER_XS.map(() => false);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Which girder is this y standing on, if any?
function floorAtY(y) {
    for (let i = 0; i < FLOOR_YS.length; i++) {
        if (Math.abs(y - FLOOR_YS[i]) <= FLOOR_TOL) return i;
    }
    return null;
}

function nearestFloor(y) {
    let best = 0;
    for (let i = 1; i < FLOOR_YS.length; i++) {
        if (Math.abs(y - FLOOR_YS[i]) < Math.abs(y - FLOOR_YS[best])) best = i;
    }
    return best;
}

// Index of a ladder reachable from `x` on `floor` that continues in direction
// `dy` (-1 up, +1 down), or null when there is nothing to grab.
function ladderFrom(x, floor, dy) {
    if (floor === null || dy === 0) return null;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < LADDERS.length; i++) {
        const lad = LADDERS[i];
        const d = Math.abs(lad.x - x);
        if (d > LADDER_SNAP) continue;
        if (dy < 0 ? lad.top >= floor : lad.bottom <= floor) continue;
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

// x of the closest ladder that continues in direction `dy` from `floor`.
function nearestLadderX(x, floor, dy) {
    let best = null;
    let bestD = Infinity;
    for (const lad of LADDERS) {
        if (dy < 0 ? lad.top >= floor : lad.bottom <= floor) continue;
        const d = Math.abs(lad.x - x);
        if (d < bestD) { bestD = d; best = lad.x; }
    }
    return best;
}

// ---------------------------------------------------------------------------
// Shared movement — the chef and the enemies obey exactly the same rules.
// ---------------------------------------------------------------------------

function placeEntityOnFloor(e, floor, x) {
    e.floor = floor;
    e.y = FLOOR_YS[floor];
    e.x = clamp(x, PLAY_LEFT, PLAY_RIGHT);
    e.ladder = null;
    e.dirX = 0;
    e.dirY = 0;
    return e;
}

function moveEntity(e, speed, h) {
    // Vertical intent wins whenever a ladder is available.
    if (e.dirY !== 0) {
        if (e.ladder === null && e.floor !== null) {
            const li = ladderFrom(e.x, e.floor, e.dirY);
            if (li !== null) { e.x = LADDERS[li].x; e.ladder = li; }
        }
        if (e.ladder !== null) {
            const lad = LADDERS[e.ladder];
            const topY = FLOOR_YS[lad.top];
            const botY = FLOOR_YS[lad.bottom];
            e.y = clamp(e.y + e.dirY * speed * h, topY, botY);
            e.floor = floorAtY(e.y);
            // Riding off either end of the ladder puts us back on a girder.
            if (e.floor !== null && (e.y <= topY || e.y >= botY)) {
                e.ladder = null;
                e.y = FLOOR_YS[e.floor];
            }
            return;
        }
    }

    // Horizontal movement only happens while standing on a girder.
    if (e.dirX !== 0 && e.floor !== null) {
        e.ladder = null;
        e.y = FLOOR_YS[e.floor];
        e.x = clamp(e.x + e.dirX * speed * h, PLAY_LEFT, PLAY_RIGHT);
    }
}

function setDir(dx, dy) {
    player.dirX = dx;
    player.dirY = dy;
    if (dx !== 0) player.facing = dx;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

function buildBoard() {
    ingredients.length = 0;
    for (let b = 0; b < BURGER_XS.length; b++) {
        for (let k = 0; k < INGREDIENT_KINDS.length; k++) {
            ingredients.push({
                burger: b,
                kind: k,
                x: BURGER_XS[b],
                floor: k + 1,
                y: FLOOR_YS[k + 1],
                segs: [false, false, false, false],
                falling: false,
                landed: false,
                stack: 0,
                targetFloor: k + 1,
            });
        }
    }
}

function ingredientAt(burger, floor) {
    for (const ing of ingredients) {
        if (ing.burger === burger && ing.floor === floor && !ing.landed) return ing;
    }
    return null;
}

function platedCount(burger) {
    let n = 0;
    for (const ing of ingredients) if (ing.burger === burger && ing.landed) n++;
    return n;
}

// Where the ingredient currently in flight is heading.
function ingTargetY(ing) {
    if (ing.targetFloor >= PLATE_FLOOR) {
        return FLOOR_YS[PLATE_FLOOR] - platedCount(ing.burger) * ING_H;
    }
    return FLOOR_YS[ing.targetFloor];
}

function startFall(ing) {
    ing.falling = true;
    ing.targetFloor = Math.min(PLATE_FLOOR, ing.floor + 1);
    score += DROP_POINTS;
}

// Force an ingredient loose — the same thing walking every slice does.
function dropIngredient(ing) {
    if (!ing || ing.falling || ing.landed) return false;
    ing.segs.fill(true);
    startFall(ing);
    return true;
}

function arriveIngredient(ing) {
    ing.floor = ing.targetFloor;

    if (ing.floor >= PLATE_FLOOR) {
        ing.stack = platedCount(ing.burger);
        ing.y = FLOOR_YS[PLATE_FLOOR] - ing.stack * ING_H;
        ing.falling = false;
        ing.landed = true;
        ing.segs.fill(true);
        checkBurger(ing.burger);
        checkLevel();
        return;
    }

    // Landing on a resting ingredient cascades: both continue one floor down.
    let other = null;
    for (const o of ingredients) {
        if (o !== ing && o.burger === ing.burger && o.floor === ing.floor && !o.falling && !o.landed) {
            other = o;
            break;
        }
    }
    if (other) {
        other.segs.fill(true);
        startFall(other);
        startFall(ing);
        return;
    }

    ing.falling = false;
    ing.y = FLOOR_YS[ing.floor];
    ing.segs.fill(false);
}

function checkBurger(burger) {
    if (burgerDone[burger]) return;
    for (const ing of ingredients) {
        if (ing.burger === burger && !ing.landed) return;
    }
    burgerDone[burger] = true;
    burgersCompleted += 1;
    score += BURGER_POINTS;
}

function checkLevel() {
    for (const ing of ingredients) if (!ing.landed) return;
    completeLevel();
}

function completeLevel() {
    score += LEVEL_POINTS;
    level += 1;
    startLevel();
}

// ---------------------------------------------------------------------------
// Ingredients in flight
// ---------------------------------------------------------------------------

function squashCheck(ing) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (e.x < ing.x - 4 || e.x > ing.x + INGREDIENT_W + 4) continue;
        if (Math.abs(e.y - ing.y) > SQUASH_Y) continue;
        enemies.splice(i, 1);
        score += SQUASH_POINTS * level;
        spawnCrumbs(e.x, e.y, ENEMY_KINDS[e.kind].color);
    }
}

function updateIngredients(h) {
    const version = boardVersion;
    const list = ingredients.slice();
    for (const ing of list) {
        if (!ing.falling) continue;
        ing.y += FALL_SPEED * h;
        squashCheck(ing);
        const ty = ingTargetY(ing);
        if (ing.y >= ty) {
            ing.y = ty;
            arriveIngredient(ing);
        }
        if (boardVersion !== version) return; // level rebuilt underneath us
    }
}

// The chef presses down whichever slice is underfoot.
function pressUnderfoot() {
    if (player.floor === null) return;
    for (const ing of ingredients) {
        if (ing.falling || ing.landed) continue;
        if (ing.floor !== player.floor) continue;
        if (player.x < ing.x || player.x > ing.x + INGREDIENT_W) continue;
        const s = clamp(Math.floor((player.x - ing.x) / SEG_W), 0, SEGS - 1);
        if (ing.segs[s]) continue;
        ing.segs[s] = true;
        if (ing.segs.every(Boolean)) startFall(ing);
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function enemySpeed() {
    return Math.min(ENEMY_CAP, ENEMY_BASE + (level - 1) * ENEMY_STEP);
}

function spawnInterval() {
    return Math.max(2.2, 5 - (level - 1) * 0.35);
}

function maxEnemies() {
    return Math.min(5, 2 + Math.floor(level / 2));
}

function spawnEnemy(opts) {
    opts = opts || {};
    const floor = opts.floor != null ? opts.floor : 0;
    const e = {
        x: clamp(opts.x != null ? opts.x : LADDER_XS[0], PLAY_LEFT, PLAY_RIGHT),
        y: FLOOR_YS[floor],
        floor,
        ladder: null,
        dirX: 0,
        dirY: 0,
        facing: 1,
        stun: 0,
        walk: 0,
        kind: opts.kind != null ? opts.kind : enemies.length % ENEMY_KINDS.length,
    };
    enemies.push(e);
    return e;
}

// Enemies re-decide whenever they are standing on a girder; mid-climb they
// commit to the ladder they are on instead of jittering.
function enemyThink(e) {
    if (e.floor === null) return;

    const target = nearestFloor(player.y);
    if (target === e.floor) {
        e.dirY = 0;
        e.dirX = player.x > e.x ? 1 : (player.x < e.x ? -1 : 0);
        return;
    }

    const dy = target > e.floor ? 1 : -1;
    if (ladderFrom(e.x, e.floor, dy) !== null) {
        e.dirY = dy;
        e.dirX = 0;
        return;
    }

    const lx = nearestLadderX(e.x, e.floor, dy);
    e.dirY = 0;
    e.dirX = lx === null ? (player.x > e.x ? 1 : -1) : (lx > e.x ? 1 : -1);
}

function updateEnemies(h) {
    const speed = enemySpeed();
    for (const e of enemies) {
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - h);
            continue;
        }
        enemyThink(e);
        if (e.dirX !== 0) e.facing = e.dirX;
        moveEntity(e, speed, h);
        e.walk += speed * h;
    }
}

function updateSpawns(h) {
    spawnTimer -= h;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval();
    if (enemies.length >= maxEnemies()) return;
    const lx = LADDER_XS[Math.floor(Math.random() * LADDER_XS.length)];
    spawnEnemy({ floor: 0, x: lx, kind: Math.floor(Math.random() * ENEMY_KINDS.length) });
}

function contactCheck() {
    for (const e of enemies) {
        if (Math.abs(e.x - player.x) > CONTACT_X) continue;
        if (Math.abs(e.y - player.y) > CONTACT_Y) continue;
        loseLife();
        return;
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function usePepper() {
    if (state !== 'running' || peppers <= 0) return false;
    peppers -= 1;
    sprays.push({
        x: clamp(player.x + player.facing * PEPPER_OFFSET, 0, CANVAS_W),
        y: player.y - 10,
        life: PEPPER_LIFE,
    });
    updateHud();
    return true;
}

function updateSprays(h) {
    for (let i = sprays.length - 1; i >= 0; i--) {
        const s = sprays[i];
        s.life -= h;
        for (const e of enemies) {
            if (Math.hypot(e.x - s.x, e.y - s.y) <= PEPPER_RADIUS) e.stun = PEPPER_STUN;
        }
        if (s.life <= 0) sprays.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    moveEntity(player, PLAYER_SPEED, h);
    if (player.dirX !== 0 || player.dirY !== 0) player.walk += PLAYER_SPEED * h;
    pressUnderfoot();
    updateIngredients(h);
    if (state !== 'running') return;
    updateEnemies(h);
    updateSprays(h);
    updateSpawns(h);
    contactCheck();
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so a fast
// ingredient can never tunnel past an enemy or a girder.
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

function resetPlayer() {
    placeEntityOnFloor(player, PLATE_FLOOR, PLAYER_START_X);
    player.facing = 1;
    player.walk = 0;
}

function startLevel() {
    buildBoard();
    burgerDone.fill(false);
    burgersCompleted = 0;
    enemies.length = 0;
    sprays.length = 0;
    crumbs.length = 0;
    peppers = START_PEPPERS;
    spawnTimer = SPAWN_FIRST;
    boardVersion = (boardVersion || 0) + 1;
    resetPlayer();
}

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    lives = START_LIVES;
    startLevel();
    hideOverlay();
    updateHud();
}

function loseLife() {
    lives -= 1;
    enemies.length = 0;
    sprays.length = 0;
    spawnTimer = SPAWN_FIRST;
    resetPlayer();
    if (lives <= 0) {
        lives = 0;
        endGame();
    }
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (e) { /* ignore */ }
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
// Cosmetic crumbs
// ---------------------------------------------------------------------------

function spawnCrumbs(x, y, color) {
    for (let i = 0; i < 10; i++) {
        crumbs.push({
            x, y,
            vx: (Math.random() - 0.5) * 200,
            vy: -Math.random() * 160,
            life: 0.6,
            color,
        });
    }
}

function updateCrumbs(dt) {
    for (let i = crumbs.length - 1; i >= 0; i--) {
        const c = crumbs[i];
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.vy += 480 * dt;
        c.life -= dt;
        if (c.life <= 0) crumbs.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawGirders() {
    for (let i = 0; i < FLOOR_YS.length; i++) {
        const y = FLOOR_YS[i];
        ctx.fillStyle = '#3d4a68';
        ctx.fillRect(0, y + 1, CANVAS_W, 4);
        ctx.fillStyle = '#26314a';
        for (let x = 0; x < CANVAS_W; x += 16) ctx.fillRect(x, y + 5, 8, 2);
    }
}

function drawLadders() {
    for (const lad of LADDERS) {
        const top = FLOOR_YS[lad.top];
        const bot = FLOOR_YS[lad.bottom];
        ctx.strokeStyle = '#54658c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(lad.x - 8, top);
        ctx.lineTo(lad.x - 8, bot);
        ctx.moveTo(lad.x + 8, top);
        ctx.lineTo(lad.x + 8, bot);
        ctx.stroke();
        ctx.strokeStyle = '#41507140';
        ctx.beginPath();
        for (let y = top + 8; y < bot; y += 12) {
            ctx.moveTo(lad.x - 8, y);
            ctx.lineTo(lad.x + 8, y);
        }
        ctx.stroke();
    }
}

function drawPlates() {
    const y = FLOOR_YS[PLATE_FLOOR] + 5;
    for (const bx of BURGER_XS) {
        ctx.fillStyle = '#cfd8ea';
        ctx.beginPath();
        ctx.ellipse(bx + INGREDIENT_W / 2, y + 4, INGREDIENT_W / 2 + 6, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9aa7c2';
        ctx.fillRect(bx - 4, y + 4, INGREDIENT_W + 8, 3);
    }
}

function drawIngredient(ing) {
    const kind = INGREDIENT_KINDS[ing.kind];
    for (let s = 0; s < SEGS; s++) {
        const x = ing.x + s * SEG_W;
        const dip = !ing.falling && !ing.landed && ing.segs[s] ? 4 : 0;
        const y = ing.y - ING_H + dip;
        ctx.fillStyle = kind.color;
        ctx.fillRect(x, y, SEG_W - 1, ING_H);
        ctx.fillStyle = kind.edge;
        ctx.fillRect(x, y + ING_H - 3, SEG_W - 1, 3);
        if (ing.kind === 0) { // top bun gets a domed, seeded crown
            ctx.fillStyle = kind.color;
            ctx.beginPath();
            ctx.ellipse(x + SEG_W / 2 - 0.5, y, SEG_W / 2 - 1, 5, 0, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = '#fdf4dc';
            ctx.fillRect(x + 7, y - 3, 3, 2);
        }
        if (ing.kind === 1) { // ruffled lettuce
            ctx.fillStyle = '#8ada8f';
            ctx.beginPath();
            ctx.ellipse(x + SEG_W / 2 - 0.5, y + 1, SEG_W / 2 - 2, 3, 0, Math.PI, 0);
            ctx.fill();
        }
    }
}

function drawChef() {
    const x = player.x;
    const y = player.y;
    const bob = (player.dirX !== 0 || player.dirY !== 0) && Math.floor(player.walk / 10) % 2 === 0 ? 1 : 0;

    ctx.fillStyle = '#f5f7fb';                       // hat
    ctx.fillRect(x - 8, y - 30, 16, 6);
    ctx.beginPath();
    ctx.arc(x - 4, y - 31, 4, 0, Math.PI * 2);
    ctx.arc(x + 4, y - 31, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f3c9a0';                       // face
    ctx.fillRect(x - 6, y - 24, 12, 7);
    ctx.fillStyle = '#1a2438';
    ctx.fillRect(x + (player.facing > 0 ? 1 : -4), y - 22, 3, 2);

    ctx.fillStyle = '#e8ecf6';                       // apron
    ctx.fillRect(x - 7, y - 17, 14, 11);
    ctx.fillStyle = '#3f6fd8';
    ctx.fillRect(x - 7, y - 17, 14, 3);

    ctx.fillStyle = '#2b3a5e';                       // legs
    ctx.fillRect(x - 6, y - 6 + bob, 4, 6);
    ctx.fillRect(x + 2, y - 6 - bob, 4, 6);
}

function drawEnemy(e) {
    const kind = ENEMY_KINDS[e.kind];
    const bob = Math.floor(e.walk / 10) % 2 === 0 ? 1 : 0;
    ctx.fillStyle = e.stun > 0 ? '#8fa2c4' : kind.color;
    ctx.beginPath();
    ctx.roundRect(e.x - 9, e.y - 18, 18, 18, 6);
    ctx.fill();
    ctx.fillStyle = e.stun > 0 ? '#6a7ea3' : kind.edge;
    ctx.fillRect(e.x - 9, e.y - 4 + bob, 6, 4);
    ctx.fillRect(e.x + 3, e.y - 4 - bob, 6, 4);

    ctx.fillStyle = '#fff';
    ctx.fillRect(e.x - 6, e.y - 14, 5, 5);
    ctx.fillRect(e.x + 1, e.y - 14, 5, 5);
    ctx.fillStyle = '#111';
    const look = e.facing > 0 ? 2 : 0;
    ctx.fillRect(e.x - 6 + look, e.y - 13, 2, 3);
    ctx.fillRect(e.x + 1 + look, e.y - 13, 2, 3);

    if (e.stun > 0) {
        ctx.fillStyle = '#f5b942';
        for (let i = 0; i < 3; i++) {
            ctx.fillRect(e.x - 8 + i * 7, e.y - 26 - (i % 2) * 3, 3, 3);
        }
    }
}

function drawSprays() {
    for (const s of sprays) {
        const a = clamp(s.life / PEPPER_LIFE, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#d9d2c2';
        for (let i = 0; i < 12; i++) {
            const ang = (i / 12) * Math.PI * 2;
            const r = PEPPER_RADIUS * (0.4 + 0.6 * (1 - a));
            ctx.fillRect(s.x + Math.cos(ang) * r - 1.5, s.y + Math.sin(ang) * r - 1.5, 3, 3);
        }
        ctx.globalAlpha = 1;
    }
}

function draw() {
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawGirders();
    drawLadders();
    drawPlates();

    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    drawSprays();

    for (const c of crumbs) {
        ctx.globalAlpha = clamp(c.life / 0.6, 0, 1);
        ctx.fillStyle = c.color;
        ctx.fillRect(c.x - 2, c.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

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
    if (state === 'running') step(dt);
    updateCrumbs(dt);
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
    setDir(dx, dy);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') usePepper();
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
peppers = START_PEPPERS;
burgersCompleted = 0;
spawnTimer = SPAWN_FIRST;
boardVersion = 0;
buildBoard();
updateHud();
requestAnimationFrame(frame);
