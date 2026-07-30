// ---------------------------------------------------------------------------
// Burger Time — a single-screen platform arcade game on an HTML5 canvas.
//
// A chef walks a maze of girders and ladders above four plates. Walking the full
// width of a burger ingredient makes it fall one floor; keep walking each one
// down until it lands on its plate. Food enemies chase along the same girders —
// a falling ingredient squashes them, a shake of pepper stuns them.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per second and advanced
// through `step(dt)`, so the tests can simulate frames deterministically without
// depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 560;

const FLOOR_Y = [70, 150, 230, 310, 390, 470]; // walkable girder lines, top down
const PLATE_Y = 530;                           // top of the plates
const COLS_X = [100, 240, 380, 520];           // burger column centres
const WALL_PAD = 20;                           // play area inset from the edges

// Ladders: `top`/`bottom` are floor indices. The two outer ladders span every
// floor, so any floor is always reachable from any other.
const LADDERS = [
    { x: 40, top: 0, bottom: 5 },
    { x: 170, top: 0, bottom: 3 },
    { x: 310, top: 1, bottom: 5 },
    { x: 450, top: 0, bottom: 4 },
    { x: 600, top: 0, bottom: 5 },
];

// --- Ingredients ---
const SEG_W = 24;              // one of the four stompable segments
const ING_W = SEG_W * 4;
const ING_H = 12;
const SEG_DIP = 4;             // how far a pressed segment sinks
const FALL_SPEED = 300;        // px/s
const ING_TYPES = ['bunTop', 'lettuce', 'patty', 'bunBottom'];

// --- Chef ---
const PLAYER_W = 20;
const PLAYER_H = 30;
const WALK_SPEED = 115;        // px/s
const CLIMB_SPEED = 95;        // px/s
const SNAP = 3;                // px tolerance for "standing on a floor line"

// --- Enemies ---
const ENEMY_W = 22;
const ENEMY_H = 26;
const ENEMY_BASE = 52, ENEMY_STEP = 6;   // px/s, per level
const ENEMY_TYPES = [
    { name: 'hotdog', color: '#d9563f', speed: 1.0 },
    { name: 'egg', color: '#f2e6c9', speed: 0.9 },
    { name: 'pickle', color: '#7db357', speed: 1.1 },
];
const SPAWN_POINTS = [
    { x: 40, floor: 5 },
    { x: 600, floor: 5 },
    { x: 40, floor: 0 },
    { x: 600, floor: 0 },
];
const FIRST_SPAWN = 2.5;       // seconds before the first enemy appears
const SPAWN_INTERVAL = 6;
const RESPAWN_DELAY = 3.5;

// --- Pepper ---
const PEPPER_START = 5;
const PEPPER_TIME = 0.35;      // how long a cloud lingers
const PEPPER_STUN = 4;         // seconds an enemy stays stunned
const PEPPER_W = 48;
const PEPPER_H = 26;

// --- Scoring ---
const DROP_POINTS = 50;
const PLATE_POINTS = 100;
const SQUASH_POINTS = 100;
const PEPPER_POINTS = 50;
const LEVEL_BONUS = 1000;

const START_LIVES = 3;
const LEVEL_CLEAR_TIME = 2;    // seconds of celebration between levels

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
let state, score, best, level, lives, peppers, clearTimer, spawnTimer, spawnIndex;
const player = { x: CANVAS_W / 2, y: FLOOR_Y[FLOOR_Y.length - 1], floor: FLOOR_Y.length - 1, dx: 0, dy: 0, facing: 1, climbing: false, walkPhase: 0 };
const ingredients = [];
const enemies = [];
const clouds = [];
const plates = [[], [], [], []];

// ---------------------------------------------------------------------------
// Difficulty helpers (pure functions of `level`)
// ---------------------------------------------------------------------------

function enemySpeed() { return ENEMY_BASE + (level - 1) * ENEMY_STEP; }
function maxEnemies() { return Math.min(2 + level, 5); }

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

function ingredientX(col) { return COLS_X[col] - ING_W / 2; }

function buildLevel() {
    ingredients.length = 0;
    for (let col = 0; col < COLS_X.length; col++) {
        plates[col] = [];
        // Top bun highest, bottom bun lowest, so the stack arrives on the plate
        // in the right order.
        ING_TYPES.forEach((type, i) => {
            ingredients.push({
                col,
                type,
                floor: i,
                x: ingredientX(col),
                y: FLOOR_Y[i],
                segs: [false, false, false, false],
                falling: false,
                plated: false,
                targetFloor: null,
            });
        });
    }
}

function resetPositions() {
    player.x = CANVAS_W / 2;
    player.floor = FLOOR_Y.length - 1;
    player.y = FLOOR_Y[player.floor];
    player.dx = 0;
    player.dy = 0;
    player.facing = 1;
    player.climbing = false;
    enemies.length = 0;
    clouds.length = 0;
    spawnTimer = FIRST_SPAWN;
    spawnIndex = 0;
}

// ---------------------------------------------------------------------------
// Ladders and floors
// ---------------------------------------------------------------------------

// A ladder usable from `floor` heading `dir` (-1 up, +1 down) near x.
function ladderAt(x, floor, dir) {
    return LADDERS.find((l) => {
        if (Math.abs(l.x - x) > SNAP + 1) return false;
        return dir < 0 ? floor > l.top && floor <= l.bottom
            : floor >= l.top && floor < l.bottom;
    }) || null;
}

// The ladder closest to `x` that leads off `floor` in direction `dir`.
function nearestLadder(x, floor, dir) {
    let best = null, bestD = Infinity;
    for (const l of LADDERS) {
        const usable = dir < 0 ? floor > l.top && floor <= l.bottom
            : floor >= l.top && floor < l.bottom;
        if (!usable) continue;
        const d = Math.abs(l.x - x);
        if (d < bestD) { bestD = d; best = l; }
    }
    return best;
}

function floorIndexNear(y) {
    for (let i = 0; i < FLOOR_Y.length; i++) {
        if (Math.abs(FLOOR_Y[i] - y) <= SNAP) return i;
    }
    return -1;
}

function ladderLimits(l) {
    return { minY: FLOOR_Y[l.top], maxY: FLOOR_Y[l.bottom] };
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function setMove(dx, dy) {
    player.dx = dx;
    player.dy = dy;
    if (dx !== 0) player.facing = dx > 0 ? 1 : -1;
}

function updatePlayer(dt) {
    const aligned = Math.abs(player.y - FLOOR_Y[player.floor]) <= SNAP;

    // Vertical movement wins while a ladder is in play — this is what locks the
    // chef's x to the ladder mid-climb.
    if (player.dy !== 0) {
        const ladder = player.climbing
            ? LADDERS.find((l) => Math.abs(l.x - player.x) <= SNAP + 1
                && player.y >= FLOOR_Y[l.top] - SNAP && player.y <= FLOOR_Y[l.bottom] + SNAP)
            : ladderAt(player.x, player.floor, player.dy);
        if (ladder) {
            const { minY, maxY } = ladderLimits(ladder);
            player.x = ladder.x;
            player.y = Math.max(minY, Math.min(maxY, player.y + player.dy * CLIMB_SPEED * dt));
            const f = floorIndexNear(player.y);
            if (f >= 0) player.floor = f;
            player.climbing = Math.abs(player.y - FLOOR_Y[player.floor]) > 0.5;
            if (!player.climbing) player.y = FLOOR_Y[player.floor];
            return;
        }
    }

    // Walking. Only possible when close enough to a girder to stand on it, which
    // also snaps the chef cleanly onto the line.
    if (player.dx !== 0 && aligned) {
        player.y = FLOOR_Y[player.floor];
        player.climbing = false;
        player.x += player.dx * WALK_SPEED * dt;
        player.x = Math.max(WALL_PAD, Math.min(CANVAS_W - WALL_PAD, player.x));
        player.walkPhase += Math.abs(player.dx) * dt * 9;
    }

    player.climbing = Math.abs(player.y - FLOOR_Y[player.floor]) > 0.5;
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

function ingredientAt(col, floor) {
    return ingredients.find((i) => i.col === col && i.floor === floor && !i.plated && !i.falling) || null;
}

function segmentIndex(ing, x) {
    return Math.max(0, Math.min(3, Math.floor((x - ing.x) / SEG_W)));
}

// Press whichever segment the chef is standing on.
function pressSegments() {
    if (player.climbing) return;
    for (const ing of ingredients) {
        if (ing.plated || ing.falling || ing.floor !== player.floor) continue;
        if (player.x < ing.x || player.x > ing.x + ING_W) continue;
        const idx = segmentIndex(ing, player.x);
        if (ing.segs[idx]) continue;
        ing.segs[idx] = true;
        if (ing.segs.every(Boolean)) dropIngredient(ing);
    }
}

function dropIngredient(ing) {
    if (ing.plated || ing.falling) return;
    ing.falling = true;
    ing.targetFloor = ing.floor + 1; // may be past the last floor => the plate
    for (const e of enemies) {
        if (!e.alive || e.riding) continue;
        if (e.x > ing.x - 4 && e.x < ing.x + ING_W + 4 && Math.abs(e.y - ing.y) <= ENEMY_H) {
            e.riding = ing;
        }
    }
}

function updateIngredients(dt) {
    for (const ing of ingredients) {
        if (!ing.falling) continue;
        const landingY = ing.targetFloor >= FLOOR_Y.length ? plateRestY(ing.col) : FLOOR_Y[ing.targetFloor];
        ing.y += FALL_SPEED * dt;
        // Sweep up any enemy the ingredient passes through on the way down.
        for (const e of enemies) {
            if (!e.alive || e.riding) continue;
            if (e.x > ing.x - 4 && e.x < ing.x + ING_W + 4 && Math.abs(e.y - ing.y) <= ENEMY_H) {
                e.riding = ing;
            }
        }
        if (ing.y >= landingY) {
            ing.y = landingY;
            landIngredient(ing);
        }
    }
}

function plateRestY(col) {
    return PLATE_Y - plates[col].length * ING_H;
}

function landIngredient(ing) {
    ing.falling = false;
    ing.segs = [false, false, false, false];

    if (ing.targetFloor >= FLOOR_Y.length) {
        plateIngredient(ing);
    } else {
        // Anything already resting here is knocked loose and carries on down.
        const occupant = ingredientAt(ing.col, ing.targetFloor);
        ing.floor = ing.targetFloor;
        ing.targetFloor = null;
        score += DROP_POINTS;
        if (occupant && occupant !== ing) dropIngredient(occupant);
    }

    squashRiders(ing);
    updateHud();
    checkLevelComplete();
}

function squashRiders(ing) {
    let chain = 0;
    for (const e of enemies) {
        if (e.riding !== ing) continue;
        e.riding = null;
        if (!e.alive) continue;
        e.alive = false;
        e.respawn = RESPAWN_DELAY;
        chain += 1;
        score += SQUASH_POINTS * chain;
    }
}

function plateIngredient(ing) {
    if (ing.plated) return;
    ing.plated = true;
    ing.falling = false;
    ing.targetFloor = null;
    ing.floor = FLOOR_Y.length;
    ing.y = plateRestY(ing.col);
    plates[ing.col].push(ing);
    score += PLATE_POINTS;
}

function checkLevelComplete() {
    if (state !== 'running') return;
    if (!ingredients.every((i) => i.plated)) return;
    levelComplete();
}

function levelComplete() {
    state = 'levelclear';
    clearTimer = LEVEL_CLEAR_TIME;
    score += LEVEL_BONUS;
    if (score > best) saveBest();
    updateHud();
    showOverlay('LEVEL ' + level + ' SERVED!', 'Score ' + score, 'Next level coming up…', false);
}

function nextLevel() {
    level += 1;
    peppers = PEPPER_START;
    buildLevel();
    resetPositions();
    state = 'running';
    hideOverlay();
    updateHud();
}

// Test/debug helpers — plate everything, or walk a whole ingredient in one go.
function walkOver(ing) {
    for (let i = 0; i < ing.segs.length; i++) ing.segs[i] = true;
    dropIngredient(ing);
    return ing;
}

function standOnSegment(ing, index) {
    player.floor = ing.floor;
    player.y = FLOOR_Y[ing.floor];
    player.climbing = false;
    player.x = ing.x + index * SEG_W + SEG_W / 2;
    return player;
}

function plateAll() {
    for (const ing of ingredients) plateIngredient(ing);
    updateHud();
    checkLevelComplete();
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemy(opts) {
    opts = opts || {};
    const point = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
    spawnIndex += 1;
    const floor = opts.floor != null ? opts.floor : point.floor;
    const type = ENEMY_TYPES[opts.type != null ? opts.type : (enemies.length + spawnIndex) % ENEMY_TYPES.length];
    const e = {
        x: opts.x != null ? opts.x : point.x,
        y: FLOOR_Y[floor],
        floor,
        type,
        alive: true,
        stun: 0,
        riding: null,
        respawn: 0,
        climbDir: 0,
        walkPhase: 0,
    };
    enemies.push(e);
    return e;
}

function respawnEnemy(e) {
    const point = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
    spawnIndex += 1;
    e.x = point.x;
    e.floor = point.floor;
    e.y = FLOOR_Y[e.floor];
    e.alive = true;
    e.stun = 0;
    e.riding = null;
    e.climbDir = 0;
}

function updateEnemies(dt) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        if (enemies.filter((e) => e.alive).length < maxEnemies()) spawnEnemy({});
        spawnTimer = SPAWN_INTERVAL;
    }

    for (const e of enemies) {
        if (e.riding) {
            e.y = e.riding.y - ENEMY_H / 2;
            continue;
        }
        if (!e.alive) {
            e.respawn -= dt;
            if (e.respawn <= 0) respawnEnemy(e);
            continue;
        }
        if (e.stun > 0) {
            e.stun -= dt;
            continue;
        }
        moveEnemy(e, dt);
    }
}

function moveEnemy(e, dt) {
    const speed = enemySpeed() * e.type.speed;
    const aligned = Math.abs(e.y - FLOOR_Y[e.floor]) <= SNAP;

    // Mid-ladder: keep climbing until the next girder.
    if (!aligned || e.climbDir !== 0) {
        const ladder = LADDERS.find((l) => Math.abs(l.x - e.x) <= SNAP + 1
            && e.y >= FLOOR_Y[l.top] - SNAP && e.y <= FLOOR_Y[l.bottom] + SNAP);
        if (ladder && e.climbDir !== 0) {
            const { minY, maxY } = ladderLimits(ladder);
            e.x = ladder.x;
            e.y = Math.max(minY, Math.min(maxY, e.y + e.climbDir * speed * dt));
            const f = floorIndexNear(e.y);
            if (f >= 0 && f !== e.floor) {
                e.floor = f;
                e.y = FLOOR_Y[f];
                e.climbDir = 0; // decide again on the new girder
            } else if (e.y === minY || e.y === maxY) {
                e.floor = floorIndexNear(e.y) >= 0 ? floorIndexNear(e.y) : e.floor;
                e.climbDir = 0;
            }
            return;
        }
        e.climbDir = 0;
    }

    e.y = FLOOR_Y[e.floor];

    // Chase: climb toward the chef's floor when a ladder is at hand, else walk
    // toward the ladder (or toward the chef when already on the same floor).
    if (player.floor !== e.floor) {
        const dir = player.floor < e.floor ? -1 : 1;
        if (ladderAt(e.x, e.floor, dir)) {
            e.climbDir = dir;
            return;
        }
        const ladder = nearestLadder(e.x, e.floor, dir);
        if (ladder) {
            const dx = Math.sign(ladder.x - e.x) || 1;
            e.x += dx * speed * dt;
            if (Math.abs(ladder.x - e.x) <= speed * dt) e.x = ladder.x;
            e.walkPhase += dt * 8;
            return;
        }
    }

    const dx = Math.sign(player.x - e.x);
    e.x += dx * speed * dt;
    e.x = Math.max(WALL_PAD, Math.min(CANVAS_W - WALL_PAD, e.x));
    e.walkPhase += dt * 8;
}

function checkEnemyCollisions() {
    for (const e of enemies) {
        if (!e.alive || e.riding || e.stun > 0) continue;
        if (Math.abs(e.x - player.x) < (ENEMY_W + PLAYER_W) / 2 - 4
            && Math.abs(e.y - player.y) < 20) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function sprayPepper() {
    if (state !== 'running' || peppers <= 0) return null;
    peppers -= 1;
    const dir = player.facing;
    const cloud = {
        x: dir > 0 ? player.x + 12 : player.x - 12 - PEPPER_W,
        y: player.y - PEPPER_H,
        w: PEPPER_W,
        h: PEPPER_H,
        t: PEPPER_TIME,
        hit: [],
    };
    clouds.push(cloud);
    updateHud();
    return cloud;
}

function updateClouds(dt) {
    for (let i = clouds.length - 1; i >= 0; i--) {
        const c = clouds[i];
        c.t -= dt;
        for (const e of enemies) {
            if (!e.alive || e.riding || c.hit.includes(e)) continue;
            if (e.x + ENEMY_W / 2 < c.x || e.x - ENEMY_W / 2 > c.x + c.w) continue;
            if (Math.abs(e.y - (c.y + c.h)) > ENEMY_H) continue;
            e.stun = PEPPER_STUN;
            c.hit.push(e);
            score += PEPPER_POINTS;
            updateHud();
        }
        if (c.t <= 0) clouds.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    peppers = PEPPER_START;
    clearTimer = 0;
    spawnIndex = 0;
    buildLevel();
    resetPositions();
    state = 'running';
    hideOverlay();
    updateHud();
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

function endGame() {
    state = 'over';
    saveBest();
    updateHud();
    showOverlay('GAME OVER', 'Score ' + score + '  •  Best ' + best,
        'Press Space or Enter to cook again', true);
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', 'Score ' + score, 'Press P to resume', true);
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function saveBest() {
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (e) { /* ignore */ }
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'levelclear') {
        clearTimer -= dt;
        updateIngredients(dt);
        if (clearTimer <= 0) nextLevel();
        return;
    }
    if (state !== 'running') return;

    updatePlayer(dt);
    pressSegments();
    updateIngredients(dt);
    updateEnemies(dt);
    updateClouds(dt);
    checkEnemyCollisions();
    updateHud();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    peppersEl.textContent = String(peppers);
    bestEl.textContent = String(best);
}

function showOverlay(title, sub1, sub2, showButton) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub1 || '';
    overlaySub.textContent = sub2 || '';
    btnStart.style.display = showButton ? '' : 'none';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ING_COLORS = {
    bunTop: ['#e0a34f', '#c4863a'],
    lettuce: ['#7dbd4c', '#5d9636'],
    patty: ['#8a5030', '#6b3b22'],
    bunBottom: ['#d7963f', '#b87a2f'],
};

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Night-kitchen backdrop.
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#101c30');
    sky.addColorStop(1, '#060b16');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawLadders();
    drawFloors();
    drawPlates();
    drawIngredients();
    drawClouds();
    drawEnemies();
    drawPlayer();
}

function drawFloors() {
    for (const y of FLOOR_Y) {
        ctx.fillStyle = '#3f5f8f';
        ctx.fillRect(WALL_PAD - 12, y, CANVAS_W - 2 * (WALL_PAD - 12), 5);
        ctx.fillStyle = '#22375a';
        ctx.fillRect(WALL_PAD - 12, y + 5, CANVAS_W - 2 * (WALL_PAD - 12), 3);
    }
}

function drawLadders() {
    for (const l of LADDERS) {
        const top = FLOOR_Y[l.top];
        const bottom = FLOOR_Y[l.bottom];
        ctx.strokeStyle = '#5d7ba8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(l.x - 10, top);
        ctx.lineTo(l.x - 10, bottom);
        ctx.moveTo(l.x + 10, top);
        ctx.lineTo(l.x + 10, bottom);
        ctx.stroke();
        ctx.lineWidth = 2;
        for (let y = top + 10; y < bottom; y += 14) {
            ctx.beginPath();
            ctx.moveTo(l.x - 10, y);
            ctx.lineTo(l.x + 10, y);
            ctx.stroke();
        }
    }
}

function drawPlates() {
    for (const cx of COLS_X) {
        ctx.fillStyle = '#cfd8e6';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 14, ING_W / 2 + 10, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9fadc2';
        ctx.fillRect(cx - ING_W / 2 - 6, PLATE_Y + 12, ING_W + 12, 4);
    }
}

function drawIngredients() {
    for (const ing of ingredients) drawIngredient(ing);
}

function drawIngredient(ing) {
    const [light, dark] = ING_COLORS[ing.type] || ING_COLORS.patty;
    for (let s = 0; s < 4; s++) {
        const x = ing.x + s * SEG_W;
        const dip = !ing.falling && !ing.plated && ing.segs[s] ? SEG_DIP : 0;
        const y = ing.y - ING_H + dip;

        ctx.fillStyle = light;
        if (ing.type === 'bunTop') {
            // Domed crown, drawn per segment so the four pieces still read as one bun.
            ctx.beginPath();
            ctx.moveTo(x, y + ING_H);
            ctx.lineTo(x, y + 5);
            ctx.quadraticCurveTo(x + SEG_W / 2, y - 4, x + SEG_W, y + 5);
            ctx.lineTo(x + SEG_W, y + ING_H);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillRect(x, y, SEG_W, ING_H);
        }

        ctx.fillStyle = dark;
        ctx.fillRect(x, y + ING_H - 3, SEG_W, 3);

        if (ing.type === 'lettuce') {
            ctx.fillStyle = '#a5da74';
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.arc(x + 5 + i * 7, y + 3, 4, Math.PI, 0);
                ctx.fill();
            }
        }
        if (ing.type === 'patty') {
            ctx.fillStyle = '#a3653e';
            ctx.fillRect(x + 3, y + 3, 5, 2);
            ctx.fillRect(x + 13, y + 6, 6, 2);
        }
        if (ing.type === 'bunTop') {
            ctx.fillStyle = '#f7dda6';
            ctx.fillRect(x + 5, y + 3, 3, 2);
            ctx.fillRect(x + 14, y + 5, 3, 2);
        }
    }
}

function drawClouds() {
    for (const c of clouds) {
        const alpha = Math.max(0, Math.min(1, c.t / PEPPER_TIME));
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.5 * alpha;
        ctx.fillStyle = '#e8e2d4';
        // Fixed puff pattern — deterministic so frames never flicker.
        const puffs = [[0.12, 0.7, 6], [0.3, 0.35, 7], [0.45, 0.75, 5],
            [0.6, 0.3, 6], [0.75, 0.62, 7], [0.9, 0.4, 5]];
        for (const [fx, fy, r] of puffs) {
            ctx.beginPath();
            ctx.arc(c.x + fx * c.w, c.y + fy * c.h, r * (0.6 + 0.4 * alpha), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

function drawPlayer() {
    const x = player.x;
    const y = player.y;
    const bob = player.climbing ? 0 : Math.sin(player.walkPhase) * 1.5;

    // Legs
    ctx.fillStyle = '#2f3d5c';
    ctx.fillRect(x - 7, y - 10, 5, 10);
    ctx.fillRect(x + 2, y - 10, 5, 10);
    // Apron / body
    ctx.fillStyle = '#f4f1e8';
    ctx.fillRect(x - PLAYER_W / 2, y - 24 + bob, PLAYER_W, 15);
    ctx.fillStyle = '#d94f3d';
    ctx.fillRect(x - PLAYER_W / 2, y - 24 + bob, PLAYER_W, 4);
    // Head + chef hat
    ctx.fillStyle = '#f0c39a';
    ctx.fillRect(x - 7, y - 33 + bob, 14, 10);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 9, y - 41 + bob, 18, 8);
    // Eye, facing aware
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(x + (player.facing > 0 ? 2 : -5), y - 30 + bob, 3, 3);
}

function drawEnemies() {
    for (const e of enemies) {
        if (!e.alive && !e.riding) continue;
        const squashed = !e.alive;
        const h = squashed ? ENEMY_H / 3 : ENEMY_H;
        const y = e.y - h;
        ctx.fillStyle = e.stun > 0 ? '#8ea9d6' : e.type.color;
        ctx.fillRect(e.x - ENEMY_W / 2, y, ENEMY_W, h);
        ctx.fillStyle = '#22201d';
        if (!squashed) {
            ctx.fillRect(e.x - 6, y + 6, 3, 3);
            ctx.fillRect(e.x + 3, y + 6, 3, 3);
            ctx.fillStyle = '#2f3d5c';
            ctx.fillRect(e.x - 8, e.y - 5, 4, 5);
            ctx.fillRect(e.x + 4, e.y - 5, 4, 5);
        }
        if (e.stun > 0 && !squashed) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(e.x - 2, y - 8, 4, 4);
        }
    }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
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

function refreshKeyDir() {
    const has = (keys) => keys.some((k) => heldKeys.has(k));
    setMove((has(RIGHT_KEYS) ? 1 : 0) - (has(LEFT_KEYS) ? 1 : 0),
        (has(DOWN_KEYS) ? 1 : 0) - (has(UP_KEYS) ? 1 : 0));
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running' && e.key !== 'Enter') sprayPepper();
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
peppers = PEPPER_START;
clearTimer = 0;
spawnTimer = FIRST_SPAWN;
spawnIndex = 0;
buildLevel();
updateHud();
requestAnimationFrame(frame);
