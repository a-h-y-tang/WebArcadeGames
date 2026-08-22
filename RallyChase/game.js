/*
 * Rally Chase — drive a scrolling maze, collect every flag, shake the pursuit
 * cars with smoke. See DESIGN.md for the full design.
 *
 * Everything here is declared at the top level on purpose: the Playwright specs
 * drive the simulation through `step(dt)` and read the world state directly off
 * `window`, so there is no module wrapper and no build step.
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
var CELL = 40;
var COLS = 21;
var ROWS = 15;
var WORLD_W = COLS * CELL; // 840
var WORLD_H = ROWS * CELL; // 600
var VIEW_W = 560;
var VIEW_H = 480;
var RADAR_W = 160;
var CANVAS_W = VIEW_W + RADAR_W; // 720
var CANVAS_H = VIEW_H; // 480

var START = { col: 12, row: 6 };
var ENEMY_STARTS = [
    [3, 3],
    [18, 3],
    [3, 12],
    [18, 12],
    [9, 12],
    [15, 3],
];

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
var CAR_SPEED = 120; // px/s with fuel in the tank
var EMPTY_FACTOR = 0.55; // speed multiplier once the tank is dry
var ENEMY_BASE_SPEED = 84;
var ENEMY_LEVEL_SPEED = 6;
var ENEMY_SPEED_CAP = CAR_SPEED * 0.92;

var FUEL_MAX = 100;
var FUEL_DRAIN = 2.2; // units per second
var SMOKE_COST = 6;
var SMOKE_LIFE = 4; // seconds
var SMOKE_RADIUS = 24;
var SPIN_TIME = 3; // seconds a pursuer is spun out

var FLAG_COUNT = 10;
var FLAG_VALUE = 100;
var SPIN_VALUE = 200;
var FUEL_FLAG_REFILL = 40;
var FUEL_BONUS_PER_UNIT = 10;
var MAX_MULTIPLIER = 4;

var CRASH_RADIUS = 28;
var DEATH_TIME = 1.5; // seconds
var CLEAR_TIME = 2.0; // seconds
var START_LIVES = 3;

var BEST_KEY = 'rallychase-best';

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------
var canvas = document.getElementById('canvas');
var ctx = canvas.getContext('2d');

var maze = [];
var flags = [];
var enemies = [];
var smokes = [];
var car = null;
var camera = { x: 0, y: 0 };

var state = 'idle'; // idle | running | paused | dying | levelclear | over
var score = 0;
var lives = START_LIVES;
var level = 1;
var fuel = FUEL_MAX;
var flagMultiplier = 1;
var best = 0;
var deathTimer = 0;
var clearTimer = 0;
var elapsed = 0; // drives the cosmetic animation only

var el = {
    score: document.getElementById('score'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    flags: document.getElementById('flags'),
    fuel: document.getElementById('fuel'),
    best: document.getElementById('best'),
    overlay: document.getElementById('overlay'),
    title: document.getElementById('overlay-title'),
    overlayScore: document.getElementById('overlay-score'),
    sub: document.getElementById('overlay-sub'),
    start: document.getElementById('btn-start'),
};

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------
function cellCenterX(col) {
    return col * CELL + CELL / 2;
}

function cellCenterY(row) {
    return row * CELL + CELL / 2;
}

function isOpen(col, row) {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return false;
    return maze[row][col];
}

// Small deterministic PRNG so a level's circuit and flag layout are identical
// on every run — which is what makes the specs able to assert on them.
function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------
function buildMaze(rnd) {
    maze = [];
    for (var r = 0; r < ROWS; r++) {
        var line = [];
        for (var c = 0; c < COLS; c++) {
            var border = c === 0 || r === 0 || c === COLS - 1 || r === ROWS - 1;
            // Corridors run along every third column and every third row, which
            // leaves 2x2 blocks between them and keeps the whole grid connected.
            line.push(!border && (c % 3 === 0 || r % 3 === 0));
        }
        maze.push(line);
    }
    // Opening extra cells can never disconnect the grid, so the alcoves and
    // dead ends below are safe to carve at random.
    for (var r2 = 1; r2 < ROWS - 1; r2++) {
        for (var c2 = 1; c2 < COLS - 1; c2++) {
            if (!maze[r2][c2] && rnd() < 0.12) maze[r2][c2] = true;
        }
    }
}

function placeFlags(rnd) {
    var cells = [];
    for (var r = 1; r < ROWS - 1; r++) {
        for (var c = 1; c < COLS - 1; c++) {
            if (!maze[r][c]) continue;
            var nearStart = Math.abs(c - START.col) <= 2 && Math.abs(r - START.row) <= 2;
            if (nearStart) continue;
            cells.push({ col: c, row: r });
        }
    }
    // Fisher-Yates with the seeded generator.
    for (var i = cells.length - 1; i > 0; i--) {
        var j = Math.floor(rnd() * (i + 1));
        var tmp = cells[i];
        cells[i] = cells[j];
        cells[j] = tmp;
    }
    flags = cells.slice(0, FLAG_COUNT).map(function (cell, idx) {
        var kind = 'flag';
        if (idx === 2) kind = 'special';
        else if (idx === 5) kind = 'fuel';
        return { col: cell.col, row: cell.row, kind: kind, taken: false };
    });
}

function buildLevel(lvl) {
    level = lvl;
    var rnd = mulberry32(lvl * 7919 + 13);
    buildMaze(rnd);
    placeFlags(rnd);
    flagMultiplier = 1;
    smokes = [];
}

function flagsLeft() {
    return flags.filter(function (f) {
        return !f.taken;
    }).length;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
function makeEntity(col, row) {
    return {
        col: col,
        row: row,
        x: cellCenterX(col),
        y: cellCenterY(row),
        dir: { x: 0, y: 0 },
        want: { x: 0, y: 0 },
        target: null,
        moving: false,
        facing: 0,
    };
}

function placeCar(col, row) {
    car.col = col;
    car.row = row;
    car.x = cellCenterX(col);
    car.y = cellCenterY(row);
    car.dir = { x: 0, y: 0 };
    car.want = { x: 0, y: 0 };
    car.target = null;
    car.moving = false;
    return car;
}

function spawnEnemy(col, row) {
    var e = makeEntity(col, row);
    e.state = 'active';
    e.spin = 0;
    e.tint = enemies.length % 3;
    enemies.push(e);
    return e;
}

function spawnEnemies() {
    enemies = [];
    var n = enemyCount(level);
    for (var i = 0; i < n; i++) {
        var start = ENEMY_STARTS[i % ENEMY_STARTS.length];
        spawnEnemy(start[0], start[1]);
    }
}

function enemyCount(lvl) {
    var l = lvl === undefined ? level : lvl;
    return Math.min(6, l + 2);
}

function enemySpeed() {
    return Math.min(ENEMY_SPEED_CAP, ENEMY_BASE_SPEED + (level - 1) * ENEMY_LEVEL_SPEED);
}

function carSpeed() {
    return fuel > 0 ? CAR_SPEED : CAR_SPEED * EMPTY_FACTOR;
}

// ---------------------------------------------------------------------------
// Corridor movement
//
// Entities live on cell centres: they pick a neighbouring cell as a target and
// slide to it, and only at a centre can they change direction. Reversing is the
// one exception — it just swaps the target back to the cell behind them.
// ---------------------------------------------------------------------------
function applyWant(e) {
    var w = e.want;
    if ((w.x || w.y) && isOpen(e.col + w.x, e.row + w.y)) {
        e.dir = { x: w.x, y: w.y };
    }
}

function tryReverse(e) {
    if (!e.target) return;
    var w = e.want;
    if ((w.x || w.y) && w.x === -e.dir.x && w.y === -e.dir.y) {
        e.dir = { x: w.x, y: w.y };
        e.target = { c: e.col, r: e.row };
    }
}

function moveEntity(e, dist, choose) {
    tryReverse(e);
    var guard = 0;
    while (dist > 1e-9 && guard++ < 64) {
        if (!e.target) {
            if (choose) choose(e);
            applyWant(e);
            if ((e.dir.x || e.dir.y) && isOpen(e.col + e.dir.x, e.row + e.dir.y)) {
                e.target = { c: e.col + e.dir.x, r: e.row + e.dir.y };
            } else {
                e.moving = false;
                return;
            }
        }
        var tx = cellCenterX(e.target.c);
        var ty = cellCenterY(e.target.r);
        var d = Math.abs(tx - e.x) + Math.abs(ty - e.y);
        if (d <= dist) {
            e.x = tx;
            e.y = ty;
            e.col = e.target.c;
            e.row = e.target.r;
            e.target = null;
            dist -= d;
        } else {
            e.x += e.dir.x * dist;
            e.y += e.dir.y * dist;
            dist = 0;
        }
        e.moving = true;
        if (e.dir.x || e.dir.y) e.facing = Math.atan2(e.dir.y, e.dir.x);
    }
}

// Pursuit: of the open directions out of this cell (never a reverse unless the
// cell is a dead end) take the one that most reduces the distance to the car.
var DIR_ORDER = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
];

function chooseChaseDir(e) {
    var options = [];
    for (var i = 0; i < DIR_ORDER.length; i++) {
        var d = DIR_ORDER[i];
        if (!isOpen(e.col + d.x, e.row + d.y)) continue;
        var reverse = d.x === -e.dir.x && d.y === -e.dir.y && (e.dir.x || e.dir.y);
        options.push({ dir: d, reverse: reverse });
    }
    if (!options.length) return;
    var forward = options.filter(function (o) {
        return !o.reverse;
    });
    var pool = forward.length ? forward : options;
    var bestOption = null;
    var bestDist = Infinity;
    for (var j = 0; j < pool.length; j++) {
        var dir = pool[j].dir;
        var nx = cellCenterX(e.col + dir.x);
        var ny = cellCenterY(e.row + dir.y);
        var dist = Math.hypot(nx - car.x, ny - car.y);
        if (dist < bestDist - 1e-9) {
            bestDist = dist;
            bestOption = dir;
        }
    }
    if (bestOption) e.want = { x: bestOption.x, y: bestOption.y };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function updateCamera() {
    camera.x = Math.max(0, Math.min(WORLD_W - VIEW_W, car.x - VIEW_W / 2));
    camera.y = Math.max(0, Math.min(WORLD_H - VIEW_H, car.y - VIEW_H / 2));
}

function updateSmoke(dt) {
    for (var i = smokes.length - 1; i >= 0; i--) {
        smokes[i].life -= dt;
        if (smokes[i].life <= 0) smokes.splice(i, 1);
    }
}

function checkSmokeHits() {
    for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (e.state !== 'active') continue;
        for (var j = 0; j < smokes.length; j++) {
            var s = smokes[j];
            if (Math.hypot(e.x - s.x, e.y - s.y) <= SMOKE_RADIUS) {
                e.state = 'spun';
                e.spin = SPIN_TIME;
                e.target = null;
                score += SPIN_VALUE;
                break;
            }
        }
    }
}

function updateEnemies(dt) {
    var speed = enemySpeed();
    for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (e.state === 'spun') {
            e.spin -= dt;
            if (e.spin <= 0) {
                e.state = 'active';
                e.spin = 0;
            }
            continue;
        }
        moveEntity(e, speed * dt, chooseChaseDir);
    }
}

function checkFlags() {
    for (var i = 0; i < flags.length; i++) {
        var f = flags[i];
        if (f.taken) continue;
        if (Math.hypot(car.x - cellCenterX(f.col), car.y - cellCenterY(f.row)) > CELL * 0.6) {
            continue;
        }
        f.taken = true;
        score += FLAG_VALUE * flagMultiplier;
        if (f.kind === 'special') {
            flagMultiplier = Math.min(MAX_MULTIPLIER, flagMultiplier * 2);
        } else if (f.kind === 'fuel') {
            fuel = Math.min(FUEL_MAX, fuel + FUEL_FLAG_REFILL);
        }
    }
}

function checkCrash() {
    if (state !== 'running') return;
    for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (e.state !== 'active') continue;
        if (Math.hypot(e.x - car.x, e.y - car.y) <= CRASH_RADIUS) {
            crash();
            return;
        }
    }
}

function crash() {
    lives = Math.max(0, lives - 1);
    state = 'dying';
    deathTimer = DEATH_TIME;
    syncHud();
}

function resetPositions() {
    placeCar(START.col, START.row);
    spawnEnemies();
    smokes = [];
    fuel = FUEL_MAX;
    updateCamera();
}

function checkLevelClear() {
    if (state !== 'running') return;
    var done = flags.every(function (f) {
        return f.taken;
    });
    if (!done) return;
    score += Math.round(fuel) * FUEL_BONUS_PER_UNIT;
    state = 'levelclear';
    clearTimer = CLEAR_TIME;
    syncHud();
    showOverlay('LEVEL ' + level + ' CLEAR', 'Fuel bonus ' + Math.round(fuel) * FUEL_BONUS_PER_UNIT, 'Next circuit loading…', false);
}

function nextLevel() {
    buildLevel(level + 1);
    resetPositions();
    state = 'running';
    hideOverlay();
    syncHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage unavailable — keep the in-memory best */
        }
    }
    syncHud();
    showOverlay('GAME OVER', 'Score ' + score + ' · Best ' + best, 'Press Space or Enter to race again', true);
}

function step(dt) {
    if (state === 'running') {
        elapsed += dt;
        moveEntity(car, carSpeed() * dt, null);
        updateSmoke(dt);
        checkSmokeHits();
        updateEnemies(dt);
        checkFlags();
        checkCrash();
        fuel = Math.max(0, fuel - FUEL_DRAIN * dt);
        updateCamera();
        checkLevelClear();
        syncHud();
    } else if (state === 'dying') {
        elapsed += dt;
        deathTimer -= dt;
        if (deathTimer <= 0) {
            if (lives <= 0) {
                gameOver();
            } else {
                resetPositions();
                state = 'running';
                syncHud();
            }
        }
    } else if (state === 'levelclear') {
        elapsed += dt;
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
    }
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------
function dropSmoke() {
    if (state !== 'running') return;
    if (fuel < SMOKE_COST) return;
    fuel -= SMOKE_COST;
    smokes.push({ x: car.x, y: car.y, life: SMOKE_LIFE, seed: smokes.length });
    syncHud();
}

function steerCar(dx, dy) {
    car.want = { x: dx, y: dy };
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    buildLevel(1);
    resetPositions();
    state = 'running';
    hideOverlay();
    syncHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume', false);
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------
function syncHud() {
    el.score.textContent = String(score);
    el.level.textContent = String(level);
    el.lives.textContent = String(lives);
    el.flags.textContent = String(flagsLeft());
    el.fuel.textContent = String(Math.ceil(fuel));
    el.best.textContent = String(best);
}

function showOverlay(title, scoreLine, sub, showButton) {
    el.title.textContent = title;
    el.overlayScore.textContent = scoreLine;
    el.sub.textContent = sub;
    el.start.style.display = showButton ? '' : 'none';
    el.overlay.classList.add('visible');
}

function hideOverlay() {
    el.overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawMaze() {
    var c0 = Math.max(0, Math.floor(camera.x / CELL));
    var c1 = Math.min(COLS - 1, Math.ceil((camera.x + VIEW_W) / CELL));
    var r0 = Math.max(0, Math.floor(camera.y / CELL));
    var r1 = Math.min(ROWS - 1, Math.ceil((camera.y + VIEW_H) / CELL));
    for (var r = r0; r <= r1; r++) {
        for (var c = c0; c <= c1; c++) {
            var x = c * CELL - camera.x;
            var y = r * CELL - camera.y;
            if (maze[r][c]) {
                // Road: light enough to read as drivable, with a faint seam
                // between slabs so the scrolling is easy to follow.
                ctx.fillStyle = '#463f63';
                ctx.fillRect(x, y, CELL, CELL);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
            } else {
                // Block: darker than the road, with a lit top edge.
                ctx.fillStyle = '#1a1631';
                ctx.fillRect(x, y, CELL, CELL);
                ctx.fillStyle = '#2b2450';
                ctx.fillRect(x, y, CELL, 3);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
                ctx.fillRect(x, y + CELL - 3, CELL, 3);
            }
        }
    }
}

function drawFlag(f) {
    var x = cellCenterX(f.col) - camera.x;
    var y = cellCenterY(f.row) - camera.y;
    if (x < -CELL || x > VIEW_W + CELL || y < -CELL || y > VIEW_H + CELL) return;
    var bob = Math.sin(elapsed * 3 + f.col + f.row) * 2;
    ctx.strokeStyle = '#e8e6ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 10 + bob);
    ctx.lineTo(x - 6, y - 10 + bob);
    ctx.stroke();
    ctx.fillStyle = flagColor(f.kind);
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 10 + bob);
    ctx.lineTo(x + 10, y - 5 + bob);
    ctx.lineTo(x - 6, y + bob);
    ctx.closePath();
    ctx.fill();
}

function flagColor(kind) {
    if (kind === 'special') return '#ffd447';
    if (kind === 'fuel') return '#5ce1a6';
    return '#ff5d6c';
}

function drawCarShape(x, y, facing, body, roof) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(facing);
    ctx.fillStyle = body;
    ctx.fillRect(-13, -9, 26, 18);
    ctx.fillStyle = roof;
    ctx.fillRect(-4, -7, 10, 14);
    ctx.fillStyle = '#141225';
    ctx.fillRect(-11, -11, 7, 4);
    ctx.fillRect(-11, 7, 7, 4);
    ctx.fillRect(5, -11, 7, 4);
    ctx.fillRect(5, 7, 7, 4);
    ctx.fillStyle = '#fff3c4';
    ctx.fillRect(12, -6, 3, 4);
    ctx.fillRect(12, 2, 3, 4);
    ctx.restore();
}

function drawSmoke() {
    for (var i = 0; i < smokes.length; i++) {
        var s = smokes[i];
        var x = s.x - camera.x;
        var y = s.y - camera.y;
        var t = s.life / SMOKE_LIFE;
        var radius = SMOKE_RADIUS * (1.25 - 0.35 * t);
        ctx.fillStyle = 'rgba(210, 205, 235, ' + (0.12 + 0.4 * t).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.08 + 0.22 * t).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(x - radius * 0.3, y - radius * 0.25, radius * 0.45, 0, Math.PI * 2);
        ctx.fill();
    }
}

var ENEMY_BODIES = ['#ff5d6c', '#ff9a3c', '#c86bff'];

function drawEnemies() {
    for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        var x = e.x - camera.x;
        var y = e.y - camera.y;
        if (x < -CELL || x > VIEW_W + CELL || y < -CELL || y > VIEW_H + CELL) continue;
        if (e.state === 'spun') {
            drawCarShape(x, y, elapsed * 9, '#7a6f9c', '#4a4270');
            ctx.strokeStyle = 'rgba(232, 230, 255, 0.6)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 17, elapsed * 9, elapsed * 9 + Math.PI * 1.2);
            ctx.stroke();
        } else {
            drawCarShape(x, y, e.facing, ENEMY_BODIES[e.tint % ENEMY_BODIES.length], '#3a1730');
        }
    }
}

function drawPlayer() {
    var x = car.x - camera.x;
    var y = car.y - camera.y;
    if (state === 'dying') {
        var t = 1 - deathTimer / DEATH_TIME;
        ctx.strokeStyle = 'rgba(255, 212, 71, ' + (1 - t).toFixed(3) + ')';
        ctx.lineWidth = 3;
        for (var i = 0; i < 8; i++) {
            var a = (i / 8) * Math.PI * 2;
            var r0 = 8 + t * 22;
            var r1 = 16 + t * 34;
            ctx.beginPath();
            ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
            ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
            ctx.stroke();
        }
        return;
    }
    drawCarShape(x, y, car.facing, fuel > 0 ? '#5ce1a6' : '#9aa0b5', '#123a2c');
}

function drawRadar() {
    var pad = 12;
    var x0 = VIEW_W + pad;
    var scale = (RADAR_W - pad * 2) / WORLD_W;
    var h = WORLD_H * scale;
    var y0 = (CANVAS_H - h) / 2;

    ctx.fillStyle = '#241a3a';
    ctx.fillRect(VIEW_W, 0, RADAR_W, CANVAS_H);
    ctx.fillStyle = '#8b86b8';
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RADAR', VIEW_W + RADAR_W / 2, y0 - 14);

    ctx.fillStyle = '#12102a';
    ctx.fillRect(x0, y0, WORLD_W * scale, h);

    // The road network, drawn as a coarse block map over the dark base.
    ctx.fillStyle = '#463f63';
    for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) {
            if (!maze[r][c]) continue;
            ctx.fillRect(x0 + c * CELL * scale, y0 + r * CELL * scale, CELL * scale, CELL * scale);
        }
    }

    // The part of the circuit currently on screen.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
        x0 + camera.x * scale + 0.5,
        y0 + camera.y * scale + 0.5,
        VIEW_W * scale,
        VIEW_H * scale
    );

    for (var i = 0; i < flags.length; i++) {
        var f = flags[i];
        if (f.taken) continue;
        ctx.fillStyle = flagColor(f.kind);
        ctx.fillRect(x0 + cellCenterX(f.col) * scale - 2, y0 + cellCenterY(f.row) * scale - 2, 4, 4);
    }

    for (var j = 0; j < enemies.length; j++) {
        var e = enemies[j];
        ctx.fillStyle = e.state === 'spun' ? '#7a6f9c' : '#ff5d6c';
        ctx.beginPath();
        ctx.arc(x0 + e.x * scale, y0 + e.y * scale, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = '#5ce1a6';
    ctx.beginPath();
    ctx.arc(x0 + car.x * scale, y0 + car.y * scale, 3, 0, Math.PI * 2);
    ctx.fill();

    // Fuel gauge under the radar.
    var gaugeY = y0 + h + 18;
    ctx.fillStyle = '#12102a';
    ctx.fillRect(x0, gaugeY, RADAR_W - pad * 2, 10);
    var ratio = Math.max(0, fuel / FUEL_MAX);
    ctx.fillStyle = ratio > 0.25 ? '#5ce1a6' : '#ff5d6c';
    ctx.fillRect(x0, gaugeY, (RADAR_W - pad * 2) * ratio, 10);
    ctx.fillStyle = '#8b86b8';
    ctx.fillText('FUEL', VIEW_W + RADAR_W / 2, gaugeY + 24);

    drawLegend(x0, gaugeY + 48);
    ctx.textAlign = 'left';
}

var LEGEND = [
    ['#5ce1a6', 'you'],
    ['#ff5d6c', 'pursuer'],
    ['#ffd447', 'gold flag ×2'],
];

function drawLegend(x0, y0) {
    ctx.textAlign = 'left';
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    for (var i = 0; i < LEGEND.length; i++) {
        var y = y0 + i * 16;
        ctx.fillStyle = LEGEND[i][0];
        ctx.beginPath();
        ctx.arc(x0 + 4, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8b86b8';
        ctx.fillText(LEGEND[i][1], x0 + 14, y + 3.5);
    }
    ctx.textAlign = 'center';
}

function draw() {
    ctx.fillStyle = '#07060f';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();
    drawMaze();
    for (var i = 0; i < flags.length; i++) {
        if (!flags[i].taken) drawFlag(flags[i]);
    }
    drawSmoke();
    drawEnemies();
    drawPlayer();
    ctx.restore();

    drawRadar();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
var KEY_DIRS = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    a: [-1, 0],
    A: [-1, 0],
    d: [1, 0],
    D: [1, 0],
    w: [0, -1],
    W: [0, -1],
    s: [0, 1],
    S: [0, 1],
};

document.addEventListener('keydown', function (ev) {
    var dir = KEY_DIRS[ev.key];
    if (dir) {
        ev.preventDefault();
        steerCar(dir[0], dir[1]);
        return;
    }
    if (ev.code === 'Space') {
        ev.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else dropSmoke();
        return;
    }
    if (ev.key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        return;
    }
    if (ev.key === 'p' || ev.key === 'P') togglePause();
});

el.start.addEventListener('click', function () {
    startGame();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function loadBest() {
    try {
        best = Number(window.localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
        best = 0;
    }
}

function collectAllFlagsForTest() {
    for (var i = 0; i < flags.length; i++) flags[i].taken = true;
}

loadBest();
buildLevel(1);
car = makeEntity(START.col, START.row);
updateCamera();
syncHud();
draw();

var lastFrame = null;
function frame(now) {
    if (lastFrame === null) lastFrame = now;
    var dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    step(dt);
    draw();
    window.requestAnimationFrame(frame);
}
window.requestAnimationFrame(frame);
