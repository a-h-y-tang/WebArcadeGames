// ---------------------------------------------------------------------------
// BurgerTime — a burger-building arcade platformer on an HTML5 canvas.
//
// Chef Pepper runs along six girder floors joined by ladders. Walking the full
// width of an ingredient drops it one floor; ingredients that reach the plates
// at the bottom finish the burger. Hot dogs, eggs and pickles hunt the chef,
// who can throw a limited supply of pepper to freeze them, or squash them under
// a falling ingredient.
//
// Written as a single classic (non-module) script so the state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom, Snake
// and Tetris in this repo. All motion is expressed per-second and advanced
// through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 560;

// y of the walking surface of each girder, top floor first. The last entry is
// the plate row: ingredients that land there are finished.
const FLOORS = [90, 170, 250, 330, 410, 490];
const PLATE_FLOOR = FLOORS.length - 1;

// Ladders are all full height in this layout — every ladder joins floor 0 to
// the plate row, which keeps the level readable and always solvable.
const LADDER_X = [22, 170, 330, 490, 618];
const LADDERS = LADDER_X.map((x, index) => ({ x, index, top: 0, bottom: PLATE_FLOOR }));

// --- Burgers ---
const COL_X = [90, 250, 410, 570];   // centre x of each burger column
const PIECE_W = 96;                  // full ingredient width
const SEGS = 4;                      // segments the chef must walk across
const SEG_W = PIECE_W / SEGS;
const PIECE_H = 12;                  // ingredient thickness
const KINDS = ['bun-top', 'lettuce', 'patty', 'bun-bottom'];
const FALL_SPEED = 240;              // px/s

// --- Chef ---
const CHEF_W = 22;
const CHEF_H = 30;
const CHEF_SPEED = 115;              // px/s, walking and climbing
const CHEF_START = { x: 320, floor: 4 };
// Grab range for a ladder. The rails are 20 px apart, so anything that visually
// overlaps the ladder counts — a tighter window makes climbing fiddly.
const CLIMB_SNAP = 20;
const INVULN = 1.5;                  // seconds of grace after losing a life

// --- Enemies ---
const ENEMY_W = 22;
const ENEMY_H = 26;
const ENEMY_BASE = 46;               // px/s on level 1
const ENEMY_STEP = 9;                // px/s added per level
const ENEMY_MAX_SPEED = 110;
const ENEMY_KINDS = ['hotdog', 'egg', 'pickle'];
const SPAWNS = [
    { x: LADDER_X[0], floor: PLATE_FLOOR },
    { x: LADDER_X[4], floor: PLATE_FLOOR },
    { x: LADDER_X[1], floor: PLATE_FLOOR },
    { x: LADDER_X[3], floor: PLATE_FLOOR },
];
const RESPAWN_DELAY = 3;             // seconds before a squashed enemy returns
const ENEMY_HOLD = 1.2;              // seconds an arriving enemy waits before hunting
const MAX_ENEMIES = 5;

// --- Pepper ---
const START_PEPPERS = 5;
const PEPPER_REACH = 60;             // how far ahead of the chef the cloud lands
const PEPPER_LIFE = 0.4;             // seconds the cloud lingers
const STUN_TIME = 4;                 // seconds an enemy stays frozen

// --- Scoring ---
const DROP_POINTS = 50;
const SQUASH_POINTS = 100;
const LEVEL_BONUS = 1000;
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
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, level, lives, peppers, banner, bannerTimer;
const chef = {
    x: CHEF_START.x,
    y: FLOORS[CHEF_START.floor],
    floor: CHEF_START.floor,
    dirX: 0,
    dirY: 0,
    facing: 1,
    climbing: false,
    fromFloor: CHEF_START.floor,
    targetFloor: CHEF_START.floor,
    invuln: 0,
    walkPhase: 0,
};
const pieces = [];
const enemies = [];
const clouds = [];
const respawns = [];
const plateCount = [0, 0, 0, 0];

// ---------------------------------------------------------------------------
// Difficulty helpers
// ---------------------------------------------------------------------------

function enemySpeed() {
    return Math.min(ENEMY_MAX_SPEED, ENEMY_BASE + (level - 1) * ENEMY_STEP);
}

function enemyCount() {
    return Math.min(MAX_ENEMIES, 2 + Math.floor(level / 2));
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

function buildBoard() {
    pieces.length = 0;
    for (let i = 0; i < plateCount.length; i++) plateCount[i] = 0;
    for (let col = 0; col < COL_X.length; col++) {
        KINDS.forEach((kind, i) => {
            pieces.push({
                col,
                kind,
                x: COL_X[col],
                floor: i,
                y: FLOORS[i],
                segs: [false, false, false, false],
                falling: false,
                onPlate: false,
            });
        });
    }
}

// The highest ingredient still in play in a column (lowest floor index).
function topFloorOf(col) {
    const live = pieces.filter((p) => p.col === col && !p.onPlate);
    if (!live.length) return -1;
    return Math.min(...live.map((p) => p.floor));
}

// The ingredient resting on `floor` of a column, if any. Ingredients already in
// flight don't block anything — they are on their way out of that slot.
function pieceAt(col, floor) {
    return pieces.find((p) => p.col === col && p.floor === floor && !p.onPlate && !p.falling) || null;
}

function plateY(col) {
    return FLOORS[PLATE_FLOOR] - plateCount[col] * PIECE_H;
}

// ---------------------------------------------------------------------------
// Ladders
// ---------------------------------------------------------------------------

function ladderAt(x, floor, dir) {
    const target = floor + dir;
    return LADDERS.find((l) => (
        Math.abs(l.x - x) <= CLIMB_SNAP &&
        floor >= l.top && floor <= l.bottom &&
        target >= l.top && target <= l.bottom
    )) || null;
}

// Nearest ladder from `x` that can carry a walker on `floor` in `dir`.
function nearestLadder(x, floor, dir) {
    let best = null;
    for (const l of LADDERS) {
        const target = floor + dir;
        if (floor < l.top || floor > l.bottom) continue;
        if (target < l.top || target > l.bottom) continue;
        if (!best || Math.abs(l.x - x) < Math.abs(best.x - x)) best = l;
    }
    return best;
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function clampX(x) {
    return Math.max(CHEF_W / 2, Math.min(CANVAS_W - CHEF_W / 2, x));
}

function setChef(x, floor) {
    chef.x = clampX(x);
    chef.floor = floor;
    chef.y = FLOORS[floor];
    chef.climbing = false;
    chef.fromFloor = floor;
    chef.targetFloor = floor;
    chef.dirX = 0;
    chef.dirY = 0;
}

function moveChef(dx, dy) {
    chef.dirX = dx;
    chef.dirY = dy;
    if (dx !== 0) chef.facing = dx;
}

function chefStep(dt) {
    const dist = CHEF_SPEED * dt;

    if (chef.climbing) {
        if (chef.dirY !== 0) {
            const toward = Math.sign(FLOORS[chef.targetFloor] - chef.y);
            // Reversing direction mid-ladder sends the chef back where it came from.
            if (toward !== 0 && chef.dirY !== toward) {
                const swap = chef.targetFloor;
                chef.targetFloor = chef.fromFloor;
                chef.fromFloor = swap;
            }
            const dir = Math.sign(FLOORS[chef.targetFloor] - chef.y);
            chef.y += dir * dist;
            chef.walkPhase += dist;
            const arrived = dir < 0 ? chef.y <= FLOORS[chef.targetFloor] : chef.y >= FLOORS[chef.targetFloor];
            if (arrived) {
                chef.y = FLOORS[chef.targetFloor];
                chef.floor = chef.targetFloor;
                chef.fromFloor = chef.targetFloor;
                chef.climbing = false;
            }
        }
        return;
    }

    if (chef.dirY !== 0) {
        const lad = ladderAt(chef.x, chef.floor, chef.dirY);
        if (lad) {
            chef.x = lad.x;
            chef.climbing = true;
            chef.fromFloor = chef.floor;
            chef.targetFloor = chef.floor + chef.dirY;
            chef.floor = -1;
            return;
        }
    }

    if (chef.dirX !== 0) {
        chef.x = clampX(chef.x + chef.dirX * dist);
        chef.walkPhase += dist;
    }
}

// ---------------------------------------------------------------------------
// Stepping on ingredients
// ---------------------------------------------------------------------------

function trampleUnderfoot() {
    if (chef.climbing || chef.floor < 0) return;
    for (const p of pieces) {
        if (p.onPlate || p.falling || p.floor !== chef.floor) continue;
        const left = p.x - PIECE_W / 2;
        if (chef.x < left || chef.x > left + PIECE_W) continue;
        const idx = Math.min(SEGS - 1, Math.max(0, Math.floor((chef.x - left) / SEG_W)));
        if (!p.segs[idx]) {
            p.segs[idx] = true;
            if (p.segs.every(Boolean)) dropPiece(p);
        }
    }
}

function dropPiece(p) {
    if (p.onPlate || p.falling) return false;
    p.segs = [true, true, true, true];
    p.falling = true;
    p.targetFloor = Math.min(PLATE_FLOOR, p.floor + 1);
    score += DROP_POINTS;
    updateHud();
    return true;
}

function landPiece(p, floor) {
    p.falling = false;
    p.segs = [false, false, false, false];
    if (floor >= PLATE_FLOOR) {
        p.onPlate = true;
        p.floor = PLATE_FLOOR;
        p.y = plateY(p.col);
        plateCount[p.col] += 1;
    } else {
        p.floor = floor;
        p.y = FLOORS[floor];
    }
}

function fallStep(p, dt) {
    p.y += FALL_SPEED * dt;
    squashEnemiesUnder(p);

    const targetY = p.targetFloor >= PLATE_FLOOR ? plateY(p.col) : FLOORS[p.targetFloor];
    if (p.y < targetY) return;

    if (p.targetFloor >= PLATE_FLOOR) {
        landPiece(p, PLATE_FLOOR);
        return;
    }

    // Anything resting on the destination floor is shoved down one floor of its
    // own — a chain that ripples through the column, every ingredient moving
    // exactly one floor per drop.
    const blocker = pieceAt(p.col, p.targetFloor);
    if (blocker && blocker !== p) {
        blocker.falling = true;
        blocker.segs = [false, false, false, false];
        blocker.targetFloor = Math.min(PLATE_FLOOR, blocker.floor + 1);
    }

    p.y = targetY;
    landPiece(p, p.targetFloor);
}

function squashEnemiesUnder(p) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (Math.abs(e.x - p.x) > PIECE_W / 2) continue;
        if (Math.abs(e.y - p.y) > 18) continue;
        enemies.splice(i, 1);
        respawns.push(RESPAWN_DELAY);
        score += SQUASH_POINTS;
        updateHud();
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemy(x, floor, kind, hold) {
    const e = {
        x,
        y: FLOORS[floor],
        floor,
        kind: kind || ENEMY_KINDS[enemies.length % ENEMY_KINDS.length],
        stun: 0,
        hold: hold || 0,
        climbing: false,
        fromFloor: floor,
        targetFloor: floor,
        walkPhase: 0,
    };
    enemies.push(e);
    return e;
}

function spawnWave() {
    enemies.length = 0;
    respawns.length = 0;
    for (let i = 0; i < enemyCount(); i++) {
        const spot = SPAWNS[i % SPAWNS.length];
        spawnEnemy(spot.x, spot.floor, ENEMY_KINDS[i % ENEMY_KINDS.length], ENEMY_HOLD);
    }
}

function chefFloorForChase() {
    if (!chef.climbing && chef.floor >= 0) return chef.floor;
    // Mid-ladder: aim for whichever floor the chef is closest to.
    let bestIdx = 0;
    for (let i = 1; i < FLOORS.length; i++) {
        if (Math.abs(FLOORS[i] - chef.y) < Math.abs(FLOORS[bestIdx] - chef.y)) bestIdx = i;
    }
    return bestIdx;
}

function enemyStep(e, dt) {
    if (e.stun > 0) {
        e.stun = Math.max(0, e.stun - dt);
        return;
    }
    // Freshly placed enemies pause a moment so the chef always gets a breath
    // after a spawn, a squash or losing a life.
    if (e.hold > 0) {
        e.hold = Math.max(0, e.hold - dt);
        return;
    }
    const dist = enemySpeed() * dt;

    if (e.climbing) {
        const dir = Math.sign(FLOORS[e.targetFloor] - e.y);
        e.y += dir * dist;
        e.walkPhase += dist;
        const arrived = dir < 0 ? e.y <= FLOORS[e.targetFloor] : e.y >= FLOORS[e.targetFloor];
        if (arrived) {
            e.y = FLOORS[e.targetFloor];
            e.floor = e.targetFloor;
            e.fromFloor = e.targetFloor;
            e.climbing = false;
        }
        return;
    }

    const goal = chefFloorForChase();
    if (goal !== e.floor) {
        const dir = goal > e.floor ? 1 : -1;
        const lad = nearestLadder(e.x, e.floor, dir);
        if (lad) {
            if (Math.abs(lad.x - e.x) <= dist + 0.5) {
                e.x = lad.x;
                e.climbing = true;
                e.fromFloor = e.floor;
                e.targetFloor = e.floor + dir;
                return;
            }
            e.x += Math.sign(lad.x - e.x) * dist;
            e.walkPhase += dist;
            return;
        }
    }
    if (Math.abs(chef.x - e.x) > 1) {
        e.x += Math.sign(chef.x - e.x) * dist;
        e.walkPhase += dist;
    }
}

function checkEnemyCollisions() {
    if (chef.invuln > 0) return;
    for (const e of enemies) {
        if (e.stun > 0) continue;
        if (Math.abs(e.x - chef.x) < (CHEF_W + ENEMY_W) / 2 - 6 && Math.abs(e.y - chef.y) < 22) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function firePepper() {
    if (state !== 'running') return false;
    if (peppers <= 0) return false;
    peppers -= 1;
    clouds.push({
        x: chef.x + chef.facing * (PEPPER_REACH / 2 + 8),
        y: chef.y,
        w: PEPPER_REACH,
        h: 34,
        t: PEPPER_LIFE,
    });
    updateHud();
    return true;
}

function cloudStep(dt) {
    for (let i = clouds.length - 1; i >= 0; i--) {
        const c = clouds[i];
        for (const e of enemies) {
            if (Math.abs(e.x - c.x) > c.w / 2 + ENEMY_W / 2) continue;
            if (Math.abs(e.y - c.y) > c.h / 2) continue;
            e.stun = STUN_TIME;
        }
        c.t -= dt;
        if (c.t <= 0) clouds.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Lives / levels
// ---------------------------------------------------------------------------

function resetPositions() {
    setChef(CHEF_START.x, CHEF_START.floor);
    chef.facing = 1;
    clouds.length = 0;
    enemies.forEach((e, i) => {
        const spot = SPAWNS[i % SPAWNS.length];
        e.x = spot.x;
        e.y = FLOORS[spot.floor];
        e.floor = spot.floor;
        e.climbing = false;
        e.fromFloor = spot.floor;
        e.targetFloor = spot.floor;
        e.stun = 0;
        e.hold = ENEMY_HOLD;
    });
}

function loseLife() {
    lives -= 1;
    updateHud();
    if (lives <= 0) {
        lives = 0;
        updateHud();
        endGame();
        return;
    }
    resetPositions();
    chef.invuln = INVULN;
    showBanner('OUCH!');
}

function nextLevel() {
    level += 1;
    peppers = START_PEPPERS;
    score += LEVEL_BONUS;
    buildBoard();
    spawnWave();
    resetPositions();
    chef.invuln = INVULN;
    showBanner('LEVEL ' + level);
    updateHud();
}

function showBanner(text) {
    banner = text;
    bannerTimer = 1.4;
}

// ---------------------------------------------------------------------------
// Main step
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    if (chef.invuln > 0) chef.invuln = Math.max(0, chef.invuln - dt);
    if (bannerTimer > 0) {
        bannerTimer = Math.max(0, bannerTimer - dt);
        if (bannerTimer === 0) banner = '';
    }

    chefStep(dt);
    trampleUnderfoot();

    for (const p of pieces) {
        if (p.falling) fallStep(p, dt);
    }

    for (const e of enemies) enemyStep(e, dt);
    cloudStep(dt);
    checkEnemyCollisions();

    for (let i = respawns.length - 1; i >= 0; i--) {
        respawns[i] -= dt;
        if (respawns[i] <= 0) {
            respawns.splice(i, 1);
            if (enemies.length < MAX_ENEMIES) {
                const spot = SPAWNS[enemies.length % SPAWNS.length];
                spawnEnemy(spot.x, spot.floor, null, ENEMY_HOLD);
            }
        }
    }

    if (state === 'running' && pieces.length && pieces.every((p) => p.onPlate)) nextLevel();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    peppers = START_PEPPERS;
    banner = '';
    bannerTimer = 0;
    buildBoard();
    spawnWave();
    resetPositions();
    chef.invuln = 0;
    respawns.length = 0;
    state = 'running';
    overlay.classList.remove('visible');
    showBanner('LEVEL 1');
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (err) { /* ignore */ }
    }
    updateHud();
    overlayTitle.textContent = 'GAME OVER';
    overlayScore.textContent = 'Score ' + score + ' — Level ' + level;
    overlaySub.textContent = 'Press Space or click Play Again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        overlayTitle.textContent = 'PAUSED';
        overlayScore.textContent = 'Score ' + score;
        overlaySub.textContent = 'Press P to resume';
        btnStart.textContent = 'Resume';
        overlay.classList.add('visible');
    } else if (state === 'paused') {
        state = 'running';
        overlay.classList.remove('visible');
    }
}

function updateHud() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    livesEl.textContent = lives;
    peppersEl.textContent = peppers;
    bestEl.textContent = best;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const PIECE_COLORS = {
    'bun-top': ['#e8a33d', '#c67f28'],
    lettuce: ['#57c14b', '#3d9134'],
    patty: ['#8d5524', '#6b3f19'],
    'bun-bottom': ['#dd9433', '#b56f22'],
};

function drawFloors() {
    for (const y of FLOORS) {
        ctx.fillStyle = '#4b3a63';
        ctx.fillRect(0, y, CANVAS_W, 6);
        ctx.fillStyle = '#6d5590';
        for (let x = 4; x < CANVAS_W; x += 16) ctx.fillRect(x, y + 1, 8, 2);
    }
}

function drawLadders() {
    for (const l of LADDERS) {
        const top = FLOORS[l.top];
        const bottom = FLOORS[l.bottom];
        ctx.fillStyle = '#3f6fa8';
        ctx.fillRect(l.x - 10, top, 3, bottom - top);
        ctx.fillRect(l.x + 7, top, 3, bottom - top);
        ctx.fillStyle = '#5b93d6';
        for (let y = top + 8; y < bottom; y += 14) ctx.fillRect(l.x - 10, y, 20, 3);
    }
}

function drawPlates() {
    for (let col = 0; col < COL_X.length; col++) {
        const x = COL_X[col];
        const y = FLOORS[PLATE_FLOOR] + 8;
        ctx.fillStyle = '#d7d2e4';
        ctx.beginPath();
        ctx.ellipse(x, y, PIECE_W / 2 + 8, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a79fbb';
        ctx.fillRect(x - PIECE_W / 2 - 8, y - 2, PIECE_W + 16, 3);
    }
}

function drawPiece(p) {
    const [light, dark] = PIECE_COLORS[p.kind];
    const left = p.x - PIECE_W / 2;
    for (let i = 0; i < SEGS; i++) {
        const dip = p.segs[i] && !p.onPlate ? 5 : 0;
        const x = left + i * SEG_W;
        const y = p.y - PIECE_H + dip;
        ctx.fillStyle = dark;
        ctx.fillRect(x, y + PIECE_H - 4, SEG_W, 4);
        ctx.fillStyle = light;
        ctx.fillRect(x, y, SEG_W, PIECE_H - 4);
        if (p.kind === 'bun-top') {
            ctx.fillStyle = '#fff3d0';
            ctx.fillRect(x + 5, y + 2, 3, 2);
            ctx.fillRect(x + 14, y + 5, 3, 2);
        } else if (p.kind === 'lettuce') {
            ctx.fillStyle = '#8ce07f';
            ctx.fillRect(x + 2, y + 1, SEG_W - 4, 3);
        }
    }
}

// How high above the girder something standing at (x, floor) is drawn — anyone
// on a resting ingredient or a plated stack stands on top of it.
function standOffset(x, floor) {
    if (floor < 0) return 0;
    let lift = 0;
    for (const p of pieces) {
        if (p.falling || p.floor !== floor) continue;
        if (Math.abs(x - p.x) > PIECE_W / 2) continue;
        lift = Math.max(lift, p.onPlate ? FLOORS[PLATE_FLOOR] - p.y + PIECE_H : PIECE_H - 2);
    }
    return lift;
}

function drawChef() {
    if (chef.invuln > 0 && Math.floor(chef.invuln * 12) % 2 === 0) return;
    const x = chef.x;
    const y = chef.y - (chef.climbing ? 0 : standOffset(chef.x, chef.floor));
    const bob = Math.floor(chef.walkPhase / 9) % 2 === 0 ? 0 : 1;

    ctx.fillStyle = '#2f3d68';           // legs
    ctx.fillRect(x - 8, y - 10, 6, 10 - bob);
    ctx.fillRect(x + 2, y - 10, 6, 10 - (1 - bob));
    ctx.fillStyle = '#f2f2f7';           // apron / body
    ctx.fillRect(x - CHEF_W / 2, y - 22, CHEF_W, 13);
    ctx.fillStyle = '#e8b48b';           // face
    ctx.fillRect(x - 7, y - 29, 14, 8);
    ctx.fillStyle = '#1c1424';           // eyes
    ctx.fillRect(x + chef.facing * 2 - 1, y - 27, 2, 2);
    ctx.fillStyle = '#ffffff';           // hat
    ctx.fillRect(x - 9, y - CHEF_H - 2, 18, 6);
    ctx.fillRect(x - 7, y - CHEF_H + 4, 14, 3);
}

const ENEMY_COLORS = {
    hotdog: ['#e2574c', '#f5c26b'],
    egg: ['#f4f1e6', '#ffcf5c'],
    pickle: ['#4fa04a', '#8cd07e'],
};

function drawEnemy(e) {
    const [body, trim] = ENEMY_COLORS[e.kind] || ENEMY_COLORS.hotdog;
    ctx.save();
    if (e.hold > 0) ctx.globalAlpha = 0.45 + 0.25 * Math.sin(e.hold * 12);
    const x = e.x;
    const y = e.y - (e.climbing ? 0 : standOffset(e.x, e.floor));
    const bob = Math.floor(e.walkPhase / 9) % 2 === 0 ? 0 : 1;

    ctx.fillStyle = e.stun > 0 ? '#7fb0d8' : body;
    ctx.fillRect(x - ENEMY_W / 2, y - ENEMY_H, ENEMY_W, ENEMY_H - 6);
    ctx.fillStyle = e.stun > 0 ? '#a9d0ec' : trim;
    ctx.fillRect(x - ENEMY_W / 2 + 3, y - ENEMY_H + 5, ENEMY_W - 6, 6);
    ctx.fillStyle = '#221a2c';           // eyes
    ctx.fillRect(x - 6, y - ENEMY_H + 3, 3, 3);
    ctx.fillRect(x + 3, y - ENEMY_H + 3, 3, 3);
    ctx.fillStyle = '#2f2740';           // feet
    ctx.fillRect(x - 8, y - 6 - bob, 6, 6);
    ctx.fillRect(x + 2, y - 6 - (1 - bob), 6, 6);
    if (e.stun > 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillRect(x - 2, y - ENEMY_H - 8, 4, 4);
    }
    ctx.restore();
}

function drawClouds() {
    for (const c of clouds) {
        const alpha = Math.max(0, c.t / PEPPER_LIFE);
        ctx.fillStyle = 'rgba(240, 230, 255, ' + (0.15 + 0.45 * alpha) + ')';
        for (let i = 0; i < 7; i++) {
            const px = c.x - c.w / 2 + (i * c.w) / 6;
            const py = c.y - 10 - ((i % 3) - 1) * 8;
            ctx.beginPath();
            ctx.arc(px, py, 6 + (i % 2) * 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawBanner() {
    if (!banner || bannerTimer <= 0) return;
    ctx.fillStyle = '#ffb703';
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(banner, CANVAS_W / 2, CANVAS_H / 2);
    ctx.textAlign = 'left';
}

function draw() {
    ctx.fillStyle = '#12091a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawLadders();
    drawFloors();
    drawPlates();
    for (const p of pieces) drawPiece(p);
    for (const e of enemies) drawEnemy(e);
    drawClouds();
    drawChef();
    drawBanner();
}

// ---------------------------------------------------------------------------
// Loop
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

const heldKeys = new Set();
const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];
const MOVE_KEYS = [...LEFT_KEYS, ...RIGHT_KEYS, ...UP_KEYS, ...DOWN_KEYS];

function refreshKeyDir() {
    const has = (keys) => keys.some((k) => heldKeys.has(k));
    const dx = (has(RIGHT_KEYS) ? 1 : 0) - (has(LEFT_KEYS) ? 1 : 0);
    const dy = (has(DOWN_KEYS) ? 1 : 0) - (has(UP_KEYS) ? 1 : 0);
    // Vertical input wins so a diagonal press still grabs the ladder.
    moveChef(dy !== 0 ? 0 : dx, dy);
    if (dx !== 0) chef.facing = dx;
}

window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (state === 'running') firePepper();
        else if (state === 'paused') togglePause();
        else startGame();
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
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
banner = '';
bannerTimer = 0;
buildBoard();
updateHud();
requestAnimationFrame(frame);
