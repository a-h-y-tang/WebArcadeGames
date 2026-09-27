'use strict';

// ---------------------------------------------------------------------------
// Rally-X — a scrolling maze rally. Collect ten flags per circuit while red
// chasers hunt you; a smoke screen and a radar are all you get to work with.
//
// Everything below lives in the global scope on purpose: the Playwright suite
// drives the simulation through `step()` and inspects this state directly.
// ---------------------------------------------------------------------------

// --- Geometry --------------------------------------------------------------
var COLS = 24;
var ROWS = 24;
var TILE = 32;
var VIEW_W = 480;
var VIEW_H = 480;
var RADAR_SCALE = 6;

// --- Driving ---------------------------------------------------------------
var PLAYER_SPEED = 104;             // px/s
var ENEMY_SPEED_BASE = 82;          // px/s on level 1
var ENEMY_SPEED_PER_LEVEL = 5;      // px/s added each level
var ENEMY_SPEED_MAX = 100;          // never quite the player's pace
var ENEMY_RANDOM = 0.22;            // chance a chaser picks a random turn
var TURN_TOL = 3;                   // px from the lane centre a turn is allowed
var CAR_R = 9;                      // drawn car radius
var HIT_DIST = 11;                  // centre distance that wrecks the player

// --- Maze ------------------------------------------------------------------
var EXTEND_CHANCE = 0.55;           // chance a pillar grows a one-tile arm
var MIN_FLAG_DIST = 8;              // grid distance from the start tile
var MIN_ENEMY_DIST = 10;

// --- Economy ---------------------------------------------------------------
var FLAGS_PER_LEVEL = 10;
var FLAG_BASE = 100;
var FLAG_RADIUS = 14;
var FUEL_MAX = 100;
var FUEL_DRAIN = 1.5;               // per second of driving
var FUEL_BONUS = 10;                // points per litre left when a level ends
var SMOKE_COST = 5;
var SMOKE_LIFE = 3;                 // seconds
var SMOKE_RADIUS = 13;
var SPIN_TIME = 2.6;                // seconds a smoked chaser is out of action
var EMPTY_SPEED_FACTOR = 0.5;
var START_LIVES = 3;
var DYING_TIME = 1.4;
var LEVELCLEAR_TIME = 2;

var DIRS = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
];

// --- Mutable state ---------------------------------------------------------
var state = 'idle';     // idle | playing | dying | levelclear | paused | gameover
var score = 0;
var lives = START_LIVES;
var level = 1;
var fuel = FUEL_MAX;
var flagValue = FLAG_BASE;
var maze = [];
var flags = [];
var enemies = [];
var smokes = [];
var camera = { x: 0, y: 0 };
var player = newCar(0, 0);
var dyingTimer = 0;
var clearTimer = 0;
var smokePuff = 0;      // animation phase for the smoke clouds
var autoPlay = true;
var lastFrame = 0;

var canvas = document.getElementById('canvas');
var ctx = canvas.getContext('2d');
var radar = document.getElementById('radar');
var rctx = radar.getContext('2d');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function newCar(col, row) {
    return {
        x: col * TILE + TILE / 2,
        y: row * TILE + TILE / 2,
        dir: { dx: 0, dy: 0 },
        want: { dx: 0, dy: 0 },
        spin: 0,
        lastTile: null,
        spawn: { col: col, row: row },
    };
}

/** Deterministic PRNG so a level number always yields the same circuit. */
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

function shuffle(list, rng) {
    for (var i = list.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
    }
    return list;
}

function isWall(col, row) {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return true;
    return maze[row][col] === 1;
}

function tileOf(entity) {
    return {
        col: Math.floor(entity.x / TILE),
        row: Math.floor(entity.y / TILE),
    };
}

function centreOf(col, row) {
    return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
}

/** Drop an entity onto the centre of a tile, stationary. Also a test seam. */
function placeAt(entity, col, row) {
    entity.x = col * TILE + TILE / 2;
    entity.y = row * TILE + TILE / 2;
    entity.dir = { dx: 0, dy: 0 };
    entity.want = { dx: 0, dy: 0 };
    entity.spin = 0;
    entity.lastTile = null;
    return entity;
}

function enemyCountFor(lv) {
    return Math.min(3 + lv, 6);
}

function enemySpeed() {
    return Math.min(ENEMY_SPEED_BASE + (level - 1) * ENEMY_SPEED_PER_LEVEL, ENEMY_SPEED_MAX);
}

function playerSpeed() {
    return fuel > 0 ? PLAYER_SPEED : PLAYER_SPEED * EMPTY_SPEED_FACTOR;
}

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

/**
 * Walls at every odd/odd interior tile give an open lattice; extending some of
 * those pillars by one tile breaks it into a real circuit. Anything the flood
 * fill cannot reach afterwards is filled in, so every open tile is drivable.
 */
function generateMaze(rng) {
    var grid = [];
    for (var r = 0; r < ROWS; r++) {
        grid.push([]);
        for (var c = 0; c < COLS; c++) {
            var border = r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1;
            grid[r].push(border ? 1 : 0);
        }
    }

    for (var row = 1; row < ROWS - 1; row += 2) {
        for (var col = 1; col < COLS - 1; col += 2) {
            grid[row][col] = 1;
            if (rng() < EXTEND_CHANCE) {
                var d = DIRS[Math.floor(rng() * DIRS.length)];
                var nc = col + d.dx;
                var nr = row + d.dy;
                if (nc > 0 && nr > 0 && nc < COLS - 1 && nr < ROWS - 1) grid[nr][nc] = 1;
            }
        }
    }
    return grid;
}

/** The open tile closest to the middle of the world. */
function findStartTile(grid) {
    var mid = { col: Math.floor(COLS / 2), row: Math.floor(ROWS / 2) };
    var best = null;
    var bestD = Infinity;
    for (var r = 1; r < ROWS - 1; r++) {
        for (var c = 1; c < COLS - 1; c++) {
            if (grid[r][c] === 1) continue;
            var d = Math.abs(c - mid.col) + Math.abs(r - mid.row);
            if (d < bestD) {
                bestD = d;
                best = { col: c, row: r };
            }
        }
    }
    return best;
}

/** Fill in every open tile the start cannot reach, and return the rest. */
function keepConnected(grid, start) {
    var seen = {};
    var queue = [start];
    seen[start.col + ',' + start.row] = true;
    while (queue.length) {
        var t = queue.shift();
        for (var i = 0; i < DIRS.length; i++) {
            var nc = t.col + DIRS[i].dx;
            var nr = t.row + DIRS[i].dy;
            var key = nc + ',' + nr;
            if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
            if (grid[nr][nc] === 1 || seen[key]) continue;
            seen[key] = true;
            queue.push({ col: nc, row: nr });
        }
    }

    var reachable = [];
    for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) {
            if (grid[r][c] === 1) continue;
            if (seen[c + ',' + r]) reachable.push({ col: c, row: r });
            else grid[r][c] = 1;
        }
    }
    return reachable;
}

function buildLevel(lv) {
    var rng = mulberry32((0x5eed ^ Math.imul(lv, 2654435761)) >>> 0);

    maze = generateMaze(rng);
    var start = findStartTile(maze);
    var open = keepConnected(maze, start);

    var distFromStart = function (t) {
        return Math.abs(t.col - start.col) + Math.abs(t.row - start.row);
    };

    player = newCar(start.col, start.row);
    camera = { x: 0, y: 0 };

    // Flags first, then chasers from whatever is left, so the two never share
    // a tile and neither lands on the player's bumper.
    var flagPool = shuffle(open.filter(function (t) { return distFromStart(t) >= MIN_FLAG_DIST; }), rng);
    if (flagPool.length < FLAGS_PER_LEVEL) flagPool = shuffle(open.slice(), rng);

    flags = [];
    var taken = {};
    for (var i = 0; i < flagPool.length && flags.length < FLAGS_PER_LEVEL; i++) {
        var t = flagPool[i];
        var c = centreOf(t.col, t.row);
        taken[t.col + ',' + t.row] = true;
        flags.push({ col: t.col, row: t.row, x: c.x, y: c.y, lucky: false });
    }
    if (flags.length) flags[Math.floor(rng() * flags.length)].lucky = true;

    var enemyPool = shuffle(open.filter(function (t) {
        return distFromStart(t) >= MIN_ENEMY_DIST && !taken[t.col + ',' + t.row];
    }), rng);
    enemies = [];
    var wanted = enemyCountFor(lv);
    for (var k = 0; k < enemyPool.length && enemies.length < wanted; k++) {
        enemies.push(newCar(enemyPool[k].col, enemyPool[k].row));
    }

    smokes = [];
    fuel = FUEL_MAX;
    flagValue = FLAG_BASE;
    updateCamera();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function resetGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    buildLevel(level);
    state = 'idle';
    syncUi();
}

function startGame() {
    resetGame();
    state = 'playing';
    syncUi();
}

function togglePause() {
    if (state === 'playing') state = 'paused';
    else if (state === 'paused') state = 'playing';
    else return;
    syncUi();
}

function wreck() {
    lives -= 1;
    smokes = [];
    if (lives <= 0) {
        lives = 0;
        state = 'gameover';
    } else {
        state = 'dying';
        dyingTimer = DYING_TIME;
    }
    syncUi();
}

function respawn() {
    placeAt(player, player.spawn.col, player.spawn.row);
    for (var i = 0; i < enemies.length; i++) {
        placeAt(enemies[i], enemies[i].spawn.col, enemies[i].spawn.row);
    }
    smokes = [];
    state = 'playing';
    syncUi();
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Advance along the current heading, stopping dead at a wall. */
function moveEntity(e, dist) {
    var d = e.dir;
    if (!d.dx && !d.dy) return;

    var t = tileOf(e);
    var c = centreOf(t.col, t.row);
    var nx = e.x + d.dx * dist;
    var ny = e.y + d.dy * dist;

    if (isWall(t.col + d.dx, t.row + d.dy)) {
        if (d.dx > 0) nx = Math.min(nx, c.x);
        else if (d.dx < 0) nx = Math.max(nx, c.x);
        if (d.dy > 0) ny = Math.min(ny, c.y);
        else if (d.dy < 0) ny = Math.max(ny, c.y);
    }

    e.x = nx;
    e.y = ny;
}

/** Take up `want` if the tile that way is open and we are on the lane centre. */
function tryTurn(e, want) {
    if (!want.dx && !want.dy) return false;

    var t = tileOf(e);
    var c = centreOf(t.col, t.row);
    if (isWall(t.col + want.dx, t.row + want.dy)) return false;

    if (want.dx !== 0) {
        if (Math.abs(e.y - c.y) > TURN_TOL) return false;
        e.y = c.y;
    } else {
        if (Math.abs(e.x - c.x) > TURN_TOL) return false;
        e.x = c.x;
    }

    e.dir = { dx: want.dx, dy: want.dy };
    return true;
}

function updatePlayer(dt) {
    var want = player.want;
    if ((want.dx || want.dy) && (want.dx !== player.dir.dx || want.dy !== player.dir.dy)) {
        tryTurn(player, want);
    }
    moveEntity(player, playerSpeed() * dt);
}

function decideEnemy(e, t) {
    var options = DIRS.filter(function (d) { return !isWall(t.col + d.dx, t.row + d.dy); });
    if (!options.length) {
        e.dir = { dx: 0, dy: 0 };
        return;
    }

    // Prefer not to double back — unless this is a dead end and there is no choice.
    var forward = options.filter(function (d) {
        return !(d.dx === -e.dir.dx && d.dy === -e.dir.dy);
    });
    var choices = forward.length ? forward : options;

    var pick;
    if (Math.random() < ENEMY_RANDOM) {
        pick = choices[Math.floor(Math.random() * choices.length)];
    } else {
        pick = choices[0];
        var bestD = Infinity;
        for (var i = 0; i < choices.length; i++) {
            var n = centreOf(t.col + choices[i].dx, t.row + choices[i].dy);
            var d = Math.hypot(n.x - player.x, n.y - player.y);
            if (d < bestD) {
                bestD = d;
                pick = choices[i];
            }
        }
    }
    e.dir = { dx: pick.dx, dy: pick.dy };
}

function updateEnemies(dt) {
    var speed = enemySpeed() * dt;
    for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];

        if (e.spin > 0) {
            e.spin = Math.max(0, e.spin - dt);
            continue;
        }

        var t = tileOf(e);
        var c = centreOf(t.col, t.row);
        var key = t.col + ',' + t.row;
        if (key !== e.lastTile && Math.abs(e.x - c.x) <= TURN_TOL && Math.abs(e.y - c.y) <= TURN_TOL) {
            e.lastTile = key;
            e.x = c.x;
            e.y = c.y;
            decideEnemy(e, t);
        }

        moveEntity(e, speed);
    }
}

// ---------------------------------------------------------------------------
// Smoke, flags, collisions
// ---------------------------------------------------------------------------

function dropSmoke() {
    if (state !== 'playing') return false;
    if (fuel < SMOKE_COST) return false;

    // Behind the car, or under it if it has not started rolling yet.
    var back = player.dir.dx || player.dir.dy ? player.dir : { dx: 0, dy: 0 };
    fuel = Math.max(0, fuel - SMOKE_COST);
    smokes.push({
        x: player.x - back.dx * TILE * 0.6,
        y: player.y - back.dy * TILE * 0.6,
        life: SMOKE_LIFE,
    });
    return true;
}

function updateSmokes(dt) {
    smokePuff += dt;
    for (var i = smokes.length - 1; i >= 0; i--) {
        smokes[i].life -= dt;
        if (smokes[i].life <= 0) smokes.splice(i, 1);
    }

    for (var e = 0; e < enemies.length; e++) {
        var car = enemies[e];
        for (var s = 0; s < smokes.length; s++) {
            if (Math.hypot(car.x - smokes[s].x, car.y - smokes[s].y) < SMOKE_RADIUS + CAR_R * 0.5) {
                car.spin = SPIN_TIME;
                break;
            }
        }
    }
}

function collectFlags() {
    for (var i = flags.length - 1; i >= 0; i--) {
        var f = flags[i];
        if (Math.hypot(player.x - f.x, player.y - f.y) > FLAG_RADIUS) continue;
        flags.splice(i, 1);
        score += flagValue;
        if (f.lucky) flagValue *= 2;
    }
}

function checkCollisions() {
    for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (e.spin > 0) continue;
        if (Math.hypot(e.x - player.x, e.y - player.y) < HIT_DIST) {
            wreck();
            return;
        }
    }
}

function checkLevelClear() {
    if (flags.length) return;
    score += Math.round(fuel) * FUEL_BONUS;
    state = 'levelclear';
    clearTimer = LEVELCLEAR_TIME;
    syncUi();
}

function updateCamera() {
    camera.x = clamp(player.x - VIEW_W / 2, 0, COLS * TILE - VIEW_W);
    camera.y = clamp(player.y - VIEW_H / 2, 0, ROWS * TILE - VIEW_H);
}

// ---------------------------------------------------------------------------
// The simulation step
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        dyingTimer -= dt;
        smokePuff += dt;
        if (dyingTimer <= 0) respawn();
        return;
    }

    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) {
            level += 1;
            buildLevel(level);
            state = 'playing';
            syncUi();
        }
        return;
    }

    if (state !== 'playing') return;

    fuel = Math.max(0, fuel - FUEL_DRAIN * dt);
    updatePlayer(dt);
    updateEnemies(dt);
    updateSmokes(dt);
    collectFlags();
    checkCollisions();
    if (state === 'playing') checkLevelClear();
    updateCamera();
    syncUi();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawMaze() {
    var c0 = Math.max(0, Math.floor(camera.x / TILE));
    var r0 = Math.max(0, Math.floor(camera.y / TILE));
    var c1 = Math.min(COLS - 1, Math.ceil((camera.x + VIEW_W) / TILE));
    var r1 = Math.min(ROWS - 1, Math.ceil((camera.y + VIEW_H) / TILE));

    // One sheet of asphalt under everything, then the blocks on top of it.
    ctx.fillStyle = '#0c1017';
    ctx.fillRect(c0 * TILE, r0 * TILE, (c1 - c0 + 1) * TILE, (r1 - r0 + 1) * TILE);

    for (var r = r0; r <= r1; r++) {
        for (var c = c0; c <= c1; c++) {
            var x = c * TILE;
            var y = r * TILE;

            if (maze[r][c] !== 1) {
                // A faint stud at each junction, so speed is readable.
                ctx.fillStyle = 'rgba(148, 163, 184, 0.09)';
                ctx.fillRect(x + TILE / 2 - 1, y + TILE / 2 - 1, 2, 2);
                continue;
            }

            ctx.fillStyle = '#1b2438';
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = '#39496b';
            ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 3);
            ctx.fillStyle = '#556a99';
            ctx.fillRect(x + 1, y + 1, TILE - 2, 3);
            ctx.fillStyle = 'rgba(11, 16, 32, 0.45)';
            ctx.fillRect(x + 1, y + TILE - 4, TILE - 2, 2);
        }
    }
}

function drawFlag(f) {
    var pole = f.lucky ? '#ffd166' : '#a7f3d0';
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(f.x - 5, f.y + 9);
    ctx.lineTo(f.x - 5, f.y - 9);
    ctx.stroke();

    ctx.fillStyle = pole;
    ctx.beginPath();
    ctx.moveTo(f.x - 4, f.y - 9);
    ctx.lineTo(f.x + 9, f.y - 4.5);
    ctx.lineTo(f.x - 4, f.y);
    ctx.closePath();
    ctx.fill();
}

function drawCar(car, body, roof, spinning) {
    ctx.save();
    ctx.translate(car.x, car.y);

    var angle = 0;
    if (spinning) angle = smokePuff * 12;
    else if (car.dir.dx > 0) angle = 0;
    else if (car.dir.dx < 0) angle = Math.PI;
    else if (car.dir.dy > 0) angle = Math.PI / 2;
    else if (car.dir.dy < 0) angle = -Math.PI / 2;
    ctx.rotate(angle);

    // Tyres first, so the body sits over them. +x is the way the car faces.
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(-CAR_R + 1, -CAR_R, 5, 3);
    ctx.fillRect(-CAR_R + 1, CAR_R - 3, 5, 3);
    ctx.fillRect(CAR_R - 6, -CAR_R, 5, 3);
    ctx.fillRect(CAR_R - 6, CAR_R - 3, 5, 3);

    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(-CAR_R, -CAR_R + 2, CAR_R * 2, CAR_R * 2 - 4, 3);
    ctx.fill();

    // Windscreen and cabin.
    ctx.fillStyle = roof;
    ctx.fillRect(-CAR_R + 4, -CAR_R + 4, 5, CAR_R * 2 - 8);
    ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
    ctx.fillRect(CAR_R - 7, -CAR_R + 4, 2, CAR_R * 2 - 8);

    // Headlights on the nose.
    ctx.fillStyle = '#fff7d6';
    ctx.fillRect(CAR_R - 2, -CAR_R + 3, 2, 3);
    ctx.fillRect(CAR_R - 2, CAR_R - 6, 2, 3);

    ctx.restore();
}

function drawSmoke(s) {
    var t = s.life / SMOKE_LIFE;
    var radius = SMOKE_RADIUS * (1.25 - 0.35 * t);
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.5 * t;
    for (var i = 0; i < 3; i++) {
        var a = smokePuff * 2 + (i * Math.PI * 2) / 3;
        ctx.fillStyle = i === 0 ? '#cbd5e1' : '#94a3b8';
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(a) * 3, s.y + Math.sin(a) * 3, radius * 0.7, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawRadar() {
    rctx.fillStyle = '#0b0f17';
    rctx.fillRect(0, 0, radar.width, radar.height);

    rctx.fillStyle = '#1e293b';
    for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) {
            if (maze[r][c] === 1) rctx.fillRect(c * RADAR_SCALE, r * RADAR_SCALE, RADAR_SCALE, RADAR_SCALE);
        }
    }

    // The slice of the world currently on screen.
    rctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
    rctx.lineWidth = 1;
    rctx.strokeRect(
        (camera.x / TILE) * RADAR_SCALE + 0.5,
        (camera.y / TILE) * RADAR_SCALE + 0.5,
        (VIEW_W / TILE) * RADAR_SCALE - 1,
        (VIEW_H / TILE) * RADAR_SCALE - 1
    );

    for (var i = 0; i < flags.length; i++) {
        rctx.fillStyle = flags[i].lucky ? '#ffd166' : '#a7f3d0';
        rctx.fillRect(flags[i].col * RADAR_SCALE + 1, flags[i].row * RADAR_SCALE + 1, RADAR_SCALE - 2, RADAR_SCALE - 2);
    }

    for (var e = 0; e < enemies.length; e++) {
        rctx.fillStyle = enemies[e].spin > 0 ? '#fb7185' : '#ef476f';
        rctx.beginPath();
        rctx.arc((enemies[e].x / TILE) * RADAR_SCALE, (enemies[e].y / TILE) * RADAR_SCALE, 2.5, 0, Math.PI * 2);
        rctx.fill();
    }

    rctx.fillStyle = '#4cc9f0';
    rctx.beginPath();
    rctx.arc((player.x / TILE) * RADAR_SCALE, (player.y / TILE) * RADAR_SCALE, 3, 0, Math.PI * 2);
    rctx.fill();
}

function render() {
    ctx.fillStyle = '#11161f';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    drawMaze();
    for (var i = 0; i < flags.length; i++) drawFlag(flags[i]);
    for (var s = 0; s < smokes.length; s++) drawSmoke(smokes[s]);
    for (var e = 0; e < enemies.length; e++) {
        drawCar(enemies[e], enemies[e].spin > 0 ? '#fb7185' : '#ef476f', '#7f1d3a', enemies[e].spin > 0);
    }
    if (state !== 'dying' || Math.floor(dyingTimer * 8) % 2 === 0) {
        drawCar(player, '#4cc9f0', '#0e7490', state === 'dying');
    }

    ctx.restore();
    drawRadar();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

var ui = {
    score: document.getElementById('score'),
    lives: document.getElementById('lives'),
    level: document.getElementById('level'),
    flags: document.getElementById('flags'),
    fuelBar: document.getElementById('fuel-bar'),
    overlay: document.getElementById('overlay'),
    title: document.getElementById('overlay-title'),
    overlayScore: document.getElementById('overlay-score'),
    sub: document.getElementById('overlay-sub'),
    start: document.getElementById('btn-start'),
};

function syncUi() {
    ui.score.textContent = String(score);
    ui.lives.textContent = String(lives);
    ui.level.textContent = String(level);
    ui.flags.textContent = String(flags.length);

    var pct = (fuel / FUEL_MAX) * 100;
    ui.fuelBar.style.width = pct.toFixed(1) + '%';
    ui.fuelBar.classList.toggle('low', pct < 25);

    var overlayOn = true;
    if (state === 'idle') {
        ui.title.textContent = 'RALLY-X';
        ui.overlayScore.textContent = '';
        ui.sub.textContent = 'Press Space or click Start to play';
        ui.start.textContent = 'Start Game';
    } else if (state === 'paused') {
        ui.title.textContent = 'PAUSED';
        ui.overlayScore.textContent = 'Score ' + score;
        ui.sub.textContent = 'Press P to get going again';
        ui.start.textContent = 'Resume';
    } else if (state === 'levelclear') {
        ui.title.textContent = 'LEVEL ' + level + ' CLEAR';
        ui.overlayScore.textContent = 'Score ' + score;
        ui.sub.textContent = 'Fuel bonus banked — next circuit coming up';
        ui.start.textContent = 'Start Game';
    } else if (state === 'gameover') {
        ui.title.textContent = 'GAME OVER';
        ui.overlayScore.textContent = 'Score ' + score;
        ui.sub.textContent = 'Press Space to race again';
        ui.start.textContent = 'Play Again';
    } else {
        overlayOn = false;
    }
    ui.overlay.classList.toggle('visible', overlayOn);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

var KEY_DIRS = {
    ArrowLeft: { dx: -1, dy: 0 },
    ArrowRight: { dx: 1, dy: 0 },
    ArrowUp: { dx: 0, dy: -1 },
    ArrowDown: { dx: 0, dy: 1 },
    a: { dx: -1, dy: 0 },
    d: { dx: 1, dy: 0 },
    w: { dx: 0, dy: -1 },
    s: { dx: 0, dy: 1 },
};

window.addEventListener('keydown', function (ev) {
    var key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    var dir = KEY_DIRS[key];

    if (dir) {
        ev.preventDefault();
        player.want = { dx: dir.dx, dy: dir.dy };
        return;
    }

    if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
        ev.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else if (state === 'playing' && key !== 'Enter') dropSmoke();
        return;
    }

    if (key === 'p') {
        ev.preventDefault();
        togglePause();
    }
});

ui.start.addEventListener('click', function () {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

function setAutoPlay(on) {
    autoPlay = !!on;
    if (autoPlay) {
        lastFrame = 0;
        requestAnimationFrame(frame);
    }
}

function frame(now) {
    if (!autoPlay) return;
    if (!lastFrame) lastFrame = now;
    var dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    step(dt);
    render();
    requestAnimationFrame(frame);
}

resetGame();
render();
requestAnimationFrame(frame);
