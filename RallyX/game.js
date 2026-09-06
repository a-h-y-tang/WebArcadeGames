// ---------------------------------------------------------------------------
// Rally-X — a top-down maze chase on an HTML5 canvas.
//
// You drive a rally car through a scrolling blocky maze collecting ten flags
// while red pursuit cars hunt you. There is no gun: dropping a smoke screen
// out of the exhaust spins out any chaser that drives into it, at the cost of
// fuel you also need to finish the level. A radar panel beside the playfield
// shows the whole maze, since the viewport only holds part of it.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Kaboom! and Snake in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Maze / layout -------------------------------------------------------
const TILE = 32;
const COLS = 24;
const ROWS = 24;
const WORLD_W = COLS * TILE;   // 768
const WORLD_H = ROWS * TILE;   // 768

const VIEW_W = 448;            // scrolling playfield
const VIEW_H = 448;
const RADAR_W = 160;
const CANVAS_W = VIEW_W + RADAR_W; // 608
const CANVAS_H = VIEW_H;           // 448

const RADAR_MAP = 144;                          // radar is a square map of the world
const RADAR_X = VIEW_W + (RADAR_W - RADAR_MAP) / 2;
const RADAR_Y = 92;
const RADAR_SCALE = RADAR_MAP / WORLD_W;

const WALL_EXTEND_CHANCE = 0.55;

// --- Car / chasers -------------------------------------------------------
const CAR_SPEED = 132;         // px/s
const CAR_R = 11;              // drawn/collision radius
const ENEMY_SPEED_BASE = 92;
const ENEMY_SPEED_STEP = 6;
const ENEMY_SPEED_CAP = 118;
const MAX_ENEMIES = 6;
const COLLIDE_DIST = 20;

// --- Flags ---------------------------------------------------------------
const FLAG_COUNT = 10;
const FLAG_POINTS = 100;
const FLAG_MIN_START_DIST = 6; // tiles, Manhattan
const FLAG_MIN_SPACING = 3;    // tiles, Manhattan

// --- Smoke ---------------------------------------------------------------
const SMOKE_COST = 6;          // fuel per cloud
const SMOKE_COOLDOWN = 0.4;    // seconds between clouds, so it cannot be spammed
const SMOKE_LIFE = 3.2;        // seconds
const SMOKE_R = 22;            // stun radius
const STUN_TIME = 3.5;
const SMOKE_POINTS = 200;

// --- Fuel ----------------------------------------------------------------
const FUEL_MAX = 100;
const FUEL_DRAIN = 1.9;        // per second — a full tank lasts about 52s
const FUEL_BONUS_PER_UNIT = 10;

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const DEATH_PAUSE = 1.4;
const CLEAR_PAUSE = 1.8;
const START_COL = 11;
const START_ROW = 11;
// Chaser spawn tiles: odd/odd coordinates are never walls, so these are always
// legal, and all of them sit far from the car's start in the middle.
const SPAWN_CELLS = [
    { col: 1, row: 1 },
    { col: COLS - 2, row: 1 },
    { col: 1, row: ROWS - 2 },
    { col: COLS - 2, row: ROWS - 2 },
    { col: 11, row: 1 },
    { col: 11, row: ROWS - 2 },
];

const ENEMY_COLORS = ['#ff5a53', '#ff8b3d', '#ff5ea8', '#ff3d3d', '#ff9f68', '#e8544f'];
// How many tiles ahead of the player each chaser aims. A pack that all drives
// at the same point just queues up behind you; leaders that cut you off make
// the maze feel like it is closing in.
const ENEMY_LEADS = [0, 4, 2, 6, 1, 3];

const DIRS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
];

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const flagsEl = document.getElementById('flags');
const bestEl = document.getElementById('best');
const fuelFillEl = document.getElementById('fuel-fill');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'dying' | 'levelclear' | 'over'
let state, score, best, lives, level, fuel;
let deathTimer, clearTimer, flagValue, seedBase, smokeTimer = 0;

// Test seams. `autoStep` lets the specs switch off the rAF pump so simulated
// time comes only from their own step() calls; `enemiesEnabled` freezes the
// chasers for specs about driving, flags or fuel.
let autoStep = true;
let enemiesEnabled = true;

let maze = [];
const car = { x: 0, y: 0, dir: { x: 0, y: 0 }, want: { x: 0, y: 0 }, facing: { x: 1, y: 0 } };
const enemies = [];
const flags = [];
const smokes = [];
const camera = { x: 0, y: 0 };

// ---------------------------------------------------------------------------
// Seeded RNG — the maze must be reproducible so the specs can assert on it.
// ---------------------------------------------------------------------------

function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

let rng = mulberry32(1);

function setSeed(n) {
    seedBase = n | 0;
}

function levelSeed() {
    // A different maze each level, still fully determined by the base seed.
    return (seedBase + level * 7919) | 0;
}

function rngInt(n) {
    return Math.floor(rng() * n) % n;
}

function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = rngInt(i + 1);
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function tileCenter(index) { return index * TILE + TILE / 2; }

function colOf(x) { return clamp(Math.floor(x / TILE), 0, COLS - 1); }

function rowOf(y) { return clamp(Math.floor(y / TILE), 0, ROWS - 1); }

function isWall(col, row) {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return true;
    return maze[row][col] === 1;
}

function canEnter(col, row) { return !isWall(col, row); }

// Every open tile reachable from the car's start? Extensions that would break
// this are rolled back, so no flag can be walled off and no chaser stranded.
function fullyConnected() {
    let open = 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) if (maze[r][c] === 0) open++;
    }
    const seen = new Uint8Array(COLS * ROWS);
    const stack = [START_ROW * COLS + START_COL];
    seen[stack[0]] = 1;
    let count = 0;
    while (stack.length) {
        const idx = stack.pop();
        count++;
        const c = idx % COLS, r = (idx - c) / COLS;
        for (const d of DIRS) {
            const nc = c + d.x, nr = r + d.y;
            if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
            const ni = nr * COLS + nc;
            if (maze[nr][nc] === 1 || seen[ni]) continue;
            seen[ni] = 1;
            stack.push(ni);
        }
    }
    return count === open;
}

// ---------------------------------------------------------------------------
// Maze generation
// ---------------------------------------------------------------------------

function buildMaze(seed) {
    rng = mulberry32(seed);
    maze = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));

    for (let c = 0; c < COLS; c++) { maze[0][c] = 1; maze[ROWS - 1][c] = 1; }
    for (let r = 0; r < ROWS; r++) { maze[r][0] = 1; maze[r][COLS - 1] = 1; }

    // A pillar on every even/even interior tile: an open lattice full of loops,
    // which is what a chase needs — dead ends just get you cornered.
    const pillars = [];
    for (let r = 2; r <= ROWS - 4; r += 2) {
        for (let c = 2; c <= COLS - 4; c += 2) {
            maze[r][c] = 1;
            pillars.push({ c, r });
        }
    }

    // The car's start and the four tiles around it stay clear, so you always
    // have somewhere to go the moment a level begins.
    const reserved = new Set([`${START_COL},${START_ROW}`]);
    for (const d of DIRS) reserved.add(`${START_COL + d.x},${START_ROW + d.y}`);

    // Grow pillars into walls to carve corridors, chicanes and long straights,
    // rolling back any extension that would cut the maze in two.
    for (const p of shuffle(pillars.slice())) {
        if (rng() > WALL_EXTEND_CHANCE) continue;
        const d = DIRS[rngInt(DIRS.length)];
        const c = p.c + d.x, r = p.r + d.y;
        if (c <= 0 || r <= 0 || c >= COLS - 1 || r >= ROWS - 1) continue;
        if (maze[r][c] === 1 || reserved.has(`${c},${r}`)) continue;
        maze[r][c] = 1;
        if (!fullyConnected()) maze[r][c] = 0;
    }
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

function placeFlags() {
    flags.length = 0;
    flagValue = FLAG_POINTS;

    const candidates = [];
    for (let r = 1; r < ROWS - 1; r++) {
        for (let c = 1; c < COLS - 1; c++) {
            if (maze[r][c] === 1) continue;
            const d = Math.abs(c - START_COL) + Math.abs(r - START_ROW);
            if (d < FLAG_MIN_START_DIST) continue;
            candidates.push({ col: c, row: r, startDist: d });
        }
    }
    shuffle(candidates);

    // Spread the flags out; relax the spacing rule only if a cramped maze
    // leaves no other way to place all ten.
    for (let spacing = FLAG_MIN_SPACING; flags.length < FLAG_COUNT && spacing >= 0; spacing--) {
        for (const cand of candidates) {
            if (flags.length >= FLAG_COUNT) break;
            if (flags.some((f) => f.col === cand.col && f.row === cand.row)) continue;
            const gap = flags.every((f) =>
                Math.abs(f.col - cand.col) + Math.abs(f.row - cand.row) >= spacing);
            if (!gap) continue;
            flags.push({ col: cand.col, row: cand.row, special: false });
        }
    }

    // The special flag is the one furthest from the start: doubling the rest
    // only pays if you go and fetch it early, which is the interesting choice.
    let special = flags[0];
    for (const f of flags) {
        const d = Math.abs(f.col - START_COL) + Math.abs(f.row - START_ROW);
        const bestD = Math.abs(special.col - START_COL) + Math.abs(special.row - START_ROW);
        if (d > bestD) special = f;
    }
    if (special) special.special = true;
}

// ---------------------------------------------------------------------------
// Setup / reset
// ---------------------------------------------------------------------------

function resetCar() {
    car.x = tileCenter(START_COL);
    car.y = tileCenter(START_ROW);
    car.dir = { x: 0, y: 0 };
    car.want = { x: 0, y: 0 };
    car.facing = { x: 1, y: 0 };
    heldKeys.clear();
    updateCamera();
}

// Test seam: put the car on a tile without having to drive there.
function placeCar(col, row) {
    car.x = tileCenter(clamp(col, 0, COLS - 1));
    car.y = tileCenter(clamp(row, 0, ROWS - 1));
    car.dir = { x: 0, y: 0 };
    car.want = { x: 0, y: 0 };
    updateCamera();
}

function enemyCount() {
    return Math.min(MAX_ENEMIES, 2 + level);
}

function enemySpeed() {
    return Math.min(ENEMY_SPEED_CAP, ENEMY_SPEED_BASE + (level - 1) * ENEMY_SPEED_STEP);
}

function resetEnemies() {
    enemies.length = 0;
    for (let i = 0; i < enemyCount(); i++) {
        const cell = SPAWN_CELLS[i % SPAWN_CELLS.length];
        enemies.push({
            x: tileCenter(cell.col),
            y: tileCenter(cell.row),
            dir: { x: 0, y: 0 },
            want: { x: 0, y: 0 },
            stun: 0,
            lead: ENEMY_LEADS[i % ENEMY_LEADS.length],
            color: ENEMY_COLORS[i % ENEMY_COLORS.length],
        });
    }
}

// Test seam: put a chaser on a tile instead of waiting for it to drive there.
function placeEnemy(index, col, row) {
    const e = enemies[index];
    if (!e) return;
    e.x = tileCenter(clamp(col, 0, COLS - 1));
    e.y = tileCenter(clamp(row, 0, ROWS - 1));
    e.dir = { x: 0, y: 0 };
    e.want = { x: 0, y: 0 };
}

// Rebuild the current level: maze, flags, cars, smoke and tank.
function resetLevel() {
    buildMaze(levelSeed());
    placeFlags();
    resetCar();
    resetEnemies();
    smokes.length = 0;
    smokeTimer = 0;
    fuel = FUEL_MAX;
}

// Restart the level after a crash, keeping the flags already collected.
function respawn() {
    resetCar();
    resetEnemies();
    smokes.length = 0;
    smokeTimer = 0;
    fuel = FUEL_MAX;
    state = 'running';
    hideOverlay();
    updateHud();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    resetLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    score += Math.round(fuel) * FUEL_BONUS_PER_UNIT;
    level++;
    resetLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

function loseLife() {
    lives = Math.max(0, lives - 1);
    state = 'dying';
    deathTimer = DEATH_PAUSE;
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('rallyx-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space or Enter to play again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Motion
//
// Grid-aligned driving in the Pac-Man tradition: entities travel along corridor
// centre lines and only turn at tile centres. Movement is resolved centre by
// centre rather than in one jump, so no amount of speed can tunnel through a
// wall, and a wanted turn is never missed because a frame stepped over it.
// ---------------------------------------------------------------------------

function advanceEntity(e, dist, onCenter) {
    let guard = 0;
    while (dist > 1e-9 && guard++ < 64) {
        const c = colOf(e.x), r = rowOf(e.y);
        const cx = tileCenter(c), cy = tileCenter(r);
        const atCenter = Math.abs(e.x - cx) < 1e-6 && Math.abs(e.y - cy) < 1e-6;

        if (atCenter) {
            e.x = cx;
            e.y = cy;
            if (onCenter) onCenter(e, c, r);
            if ((e.want.x || e.want.y) && canEnter(c + e.want.x, r + e.want.y)) {
                e.dir = { x: e.want.x, y: e.want.y };
            }
            if (!e.dir.x && !e.dir.y) return;
            if (!canEnter(c + e.dir.x, r + e.dir.y)) return; // nose against a wall
        }

        // The next tile centre strictly ahead of us along the current axis.
        const along = e.dir.x !== 0;
        const cur = along ? e.x : e.y;
        const centre = along ? cx : cy;
        const sign = along ? e.dir.x : e.dir.y;
        let target;
        if (sign > 0) target = cur < centre - 1e-9 ? centre : centre + TILE;
        else target = cur > centre + 1e-9 ? centre : centre - TILE;

        const gap = Math.abs(target - cur);
        if (dist < gap) {
            if (along) e.x += sign * dist; else e.y += sign * dist;
            return;
        }
        if (along) e.x = target; else e.y = target;
        dist -= gap;
    }
}

function updateCar(dt) {
    advanceEntity(car, CAR_SPEED * dt);
    if (car.dir.x || car.dir.y) car.facing = { x: car.dir.x, y: car.dir.y };
}

// Where a chaser is aiming: the player, or a point `lead` tiles ahead of them,
// which is what makes the pack fan out and cut corners instead of trailing in
// single file.
function enemyTarget(e) {
    const lead = e.lead || 0;
    if (!lead) return { x: car.x, y: car.y };
    return {
        x: clamp(car.x + car.facing.x * lead * TILE, TILE, WORLD_W - TILE),
        y: clamp(car.y + car.facing.y * lead * TILE, TILE, WORLD_H - TILE),
    };
}

// A chaser re-decides at every tile centre: of the legal exits, take the one
// that most reduces the straight-line distance to its target. Reversing is
// only allowed out of a dead end, which keeps the pursuit readable.
function chooseEnemyDir(e, c, r) {
    const options = DIRS.filter((d) => canEnter(c + d.x, r + d.y));
    if (!options.length) { e.want = { x: 0, y: 0 }; return; }
    const forward = options.filter((d) => !(d.x === -e.dir.x && d.y === -e.dir.y));
    const pool = forward.length ? forward : options;
    const target = enemyTarget(e);

    let best = pool[0], bestD = Infinity;
    for (const d of pool) {
        const dx = tileCenter(c + d.x) - target.x;
        const dy = tileCenter(r + d.y) - target.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestD) { bestD = dist; best = d; }
    }
    e.want = { x: best.x, y: best.y };
}

function updateEnemies(dt) {
    const speed = enemySpeed();
    for (const e of enemies) {
        if (e.stun > 0) {
            e.stun -= dt;
            continue;
        }
        advanceEntity(e, speed * dt, chooseEnemyDir);
    }
}

// ---------------------------------------------------------------------------
// Flags / smoke / fuel
// ---------------------------------------------------------------------------

function collectFlags() {
    const c = colOf(car.x), r = rowOf(car.y);
    for (let i = flags.length - 1; i >= 0; i--) {
        if (flags[i].col !== c || flags[i].row !== r) continue;
        const wasSpecial = flags[i].special;
        flags.splice(i, 1);
        score += flagValue;
        if (wasSpecial) flagValue *= 2;
    }
}

function dropSmoke() {
    if (state !== 'running' || fuel < SMOKE_COST || smokeTimer > 0) return;
    fuel -= SMOKE_COST;
    smokeTimer = SMOKE_COOLDOWN;
    // The cloud is laid down behind the car, so it screens whoever is chasing.
    const back = car.dir.x || car.dir.y ? car.dir : car.facing;
    smokes.push({
        x: clamp(car.x - back.x * 10, 0, WORLD_W),
        y: clamp(car.y - back.y * 10, 0, WORLD_H),
        life: SMOKE_LIFE,
    });
    updateHud();
}

function updateSmoke(dt) {
    if (smokeTimer > 0) smokeTimer -= dt;
    for (let i = smokes.length - 1; i >= 0; i--) {
        const s = smokes[i];
        s.life -= dt;
        if (s.life <= 0) { smokes.splice(i, 1); continue; }
        for (const e of enemies) {
            if (e.stun > 0) continue;
            if (Math.hypot(e.x - s.x, e.y - s.y) <= SMOKE_R) {
                e.stun = STUN_TIME;
                e.dir = { x: 0, y: 0 };
                e.want = { x: 0, y: 0 };
                score += SMOKE_POINTS;
            }
        }
    }
}

function checkCaught() {
    for (const e of enemies) {
        if (e.stun > 0) continue;
        if (Math.hypot(e.x - car.x, e.y - car.y) < COLLIDE_DIST) return true;
    }
    return false;
}

function updateCamera() {
    camera.x = clamp(car.x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
    camera.y = clamp(car.y - VIEW_H / 2, 0, WORLD_H - VIEW_H);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (dt <= 0) return;

    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) {
            if (lives <= 0) gameOver();
            else respawn();
        }
        return;
    }

    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        return;
    }

    if (state !== 'running') return;

    updateCar(dt);
    collectFlags();
    updateSmoke(dt);
    if (enemiesEnabled) updateEnemies(dt);
    updateCamera();

    if (!flags.length) {
        // No overlay here: the in-canvas banner keeps the radar and the maze
        // visible while the fuel bonus is being celebrated.
        state = 'levelclear';
        clearTimer = CLEAR_PAUSE;
        updateHud();
        return;
    }

    if (enemiesEnabled && checkCaught()) {
        loseLife();
        return;
    }

    fuel -= FUEL_DRAIN * dt;
    if (fuel <= 0) {
        fuel = 0;
        loseLife();
        return;
    }

    updateHud();
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawMaze() {
    const c0 = colOf(camera.x), c1 = colOf(camera.x + VIEW_W - 1);
    const r0 = rowOf(camera.y), r1 = rowOf(camera.y + VIEW_H - 1);
    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
            if (maze[r][c] !== 1) continue;
            const x = c * TILE - camera.x;
            const y = r * TILE - camera.y;
            ctx.fillStyle = '#25335e';
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = '#31427a';
            ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 6);
            ctx.fillStyle = '#1b2547';
            ctx.fillRect(x + 2, y + TILE - 6, TILE - 4, 4);
        }
    }
}

function drawRoads() {
    // Faint centre-line dashes down every corridor, so the maze reads as roads.
    ctx.strokeStyle = 'rgba(120, 140, 200, 0.16)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 10]);
    const c0 = colOf(camera.x), c1 = colOf(camera.x + VIEW_W - 1);
    const r0 = rowOf(camera.y), r1 = rowOf(camera.y + VIEW_H - 1);
    ctx.beginPath();
    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
            if (maze[r][c] === 1) continue;
            const x = tileCenter(c) - camera.x;
            const y = tileCenter(r) - camera.y;
            if (!isWall(c + 1, r)) { ctx.moveTo(x, y); ctx.lineTo(x + TILE, y); }
            if (!isWall(c, r + 1)) { ctx.moveTo(x, y); ctx.lineTo(x, y + TILE); }
        }
    }
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawFlags() {
    for (const f of flags) {
        const x = tileCenter(f.col) - camera.x;
        const y = tileCenter(f.row) - camera.y;
        if (x < -TILE || y < -TILE || x > VIEW_W + TILE || y > VIEW_H + TILE) continue;
        const tint = f.special ? '#ffd24a' : '#6fe08a';

        // A soft glow on the tarmac makes a flag catch the eye down a corridor.
        ctx.fillStyle = f.special ? 'rgba(255, 210, 74, 0.16)' : 'rgba(111, 224, 138, 0.13)';
        ctx.beginPath();
        ctx.arc(x, y + 2, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#e8edff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 5, y + 10);
        ctx.lineTo(x - 5, y - 10);
        ctx.stroke();
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.moveTo(x - 5, y - 10);
        ctx.lineTo(x + 10, y - 5);
        ctx.lineTo(x - 5, y);
        ctx.closePath();
        ctx.fill();
        if (f.special) {
            ctx.fillStyle = '#14192c';
            ctx.font = 'bold 8px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('S', x - 0.5, y - 5.5);
        }
    }
}

function drawSmoke() {
    // Three offset puffs per cloud, swelling and thinning as they age, so the
    // screen reads as smoke rather than a grey disc.
    const PUFFS = [
        { dx: 0, dy: 0, r: 0.78 },
        { dx: -0.34, dy: -0.26, r: 0.55 },
        { dx: 0.32, dy: 0.28, r: 0.5 },
    ];
    for (const s of smokes) {
        const x = s.x - camera.x;
        const y = s.y - camera.y;
        const fade = clamp(s.life / SMOKE_LIFE, 0, 1);
        const grow = 1 + (1 - fade) * 0.4;
        for (const p of PUFFS) {
            ctx.fillStyle = `rgba(206, 216, 244, ${(0.1 + fade * 0.28) * (0.6 + p.r)})`;
            ctx.beginPath();
            ctx.arc(
                x + p.dx * SMOKE_R * grow,
                y + p.dy * SMOKE_R * grow,
                SMOKE_R * p.r * grow * 1.35,
                0, Math.PI * 2
            );
            ctx.fill();
        }
    }
}

function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// A little top-down rally car pointing along `dir`: a long coloured shell with
// tyres poking out at the corners, a dark windscreen near the nose, a racing
// stripe down the middle and two headlights — so which way a car is travelling
// reads at a glance even at 26 px long.
const CAR_L = 13; // half-length, nose to tail
const CAR_W = 8;  // half-width

function drawCarShape(x, y, dir, body, roof) {
    const angle = Math.atan2(dir.y, dir.x);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    roundedRect(-CAR_L + 1, -CAR_W + 2, CAR_L * 2 - 2, CAR_W * 2, 4);
    ctx.fill();

    ctx.fillStyle = '#080b16';
    for (const sx of [-CAR_L + 2, CAR_L - 7]) {
        ctx.fillRect(sx, -CAR_W - 2, 5, 4);
        ctx.fillRect(sx, CAR_W - 2, 5, 4);
    }

    ctx.fillStyle = body;
    roundedRect(-CAR_L, -CAR_W, CAR_L * 2, CAR_W * 2, 4);
    ctx.fill();

    // Racing stripe from tail to windscreen.
    ctx.fillStyle = roof;
    ctx.fillRect(-CAR_L + 3, -2, CAR_L + 1, 4);

    // Windscreen and rear window.
    ctx.fillStyle = 'rgba(10, 16, 34, 0.85)';
    roundedRect(CAR_L - 8, -CAR_W + 2, 5, CAR_W * 2 - 4, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(10, 16, 34, 0.55)';
    roundedRect(-CAR_L + 3, -CAR_W + 3, 3, CAR_W * 2 - 6, 1.5);
    ctx.fill();

    ctx.fillStyle = '#fff6cf';
    ctx.fillRect(CAR_L - 2.5, -CAR_W + 2, 2.5, 3);
    ctx.fillRect(CAR_L - 2.5, CAR_W - 5, 2.5, 3);

    ctx.restore();
}

function drawCars() {
    for (const e of enemies) {
        const x = e.x - camera.x, y = e.y - camera.y;
        if (x < -TILE || y < -TILE || x > VIEW_W + TILE || y > VIEW_H + TILE) continue;
        const dir = (e.dir.x || e.dir.y) ? e.dir : { x: 1, y: 0 };
        drawCarShape(x, y, dir, e.color, '#ffd8d2');
        if (e.stun > 0) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, CAR_L + 3, e.stun * 9, e.stun * 9 + Math.PI * 1.2);
            ctx.stroke();
        }
    }

    if (state !== 'dying' || Math.ceil(deathTimer * 8) % 2 === 0) {
        drawCarShape(car.x - camera.x, car.y - camera.y, car.facing, '#4fa8ff', '#d7ecff');
    }
}

function drawRadar() {
    ctx.fillStyle = '#0a0e1c';
    ctx.fillRect(VIEW_W, 0, RADAR_W, CANVAS_H);
    ctx.strokeStyle = '#232c4d';
    ctx.beginPath();
    ctx.moveTo(VIEW_W + 0.5, 0);
    ctx.lineTo(VIEW_W + 0.5, CANVAS_H);
    ctx.stroke();

    ctx.fillStyle = '#8590b5';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('RADAR', VIEW_W + RADAR_W / 2, 40);

    ctx.fillStyle = '#0d1226';
    ctx.fillRect(RADAR_X, RADAR_Y, RADAR_MAP, RADAR_MAP);

    ctx.fillStyle = '#1e2851';
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (maze[r][c] !== 1) continue;
            ctx.fillRect(
                RADAR_X + c * TILE * RADAR_SCALE,
                RADAR_Y + r * TILE * RADAR_SCALE,
                TILE * RADAR_SCALE, TILE * RADAR_SCALE
            );
        }
    }

    for (const f of flags) {
        ctx.fillStyle = f.special ? '#ffd24a' : '#6fe08a';
        ctx.fillRect(
            RADAR_X + tileCenter(f.col) * RADAR_SCALE - 1.5,
            RADAR_Y + tileCenter(f.row) * RADAR_SCALE - 1.5,
            3, 3
        );
    }

    for (const e of enemies) {
        ctx.fillStyle = e.stun > 0 ? '#7f8ab0' : '#ff5a53';
        ctx.beginPath();
        ctx.arc(RADAR_X + e.x * RADAR_SCALE, RADAR_Y + e.y * RADAR_SCALE, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = '#4fa8ff';
    ctx.beginPath();
    ctx.arc(RADAR_X + car.x * RADAR_SCALE, RADAR_Y + car.y * RADAR_SCALE, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // The slice of the world currently on screen.
    ctx.strokeStyle = 'rgba(232, 237, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
        RADAR_X + camera.x * RADAR_SCALE,
        RADAR_Y + camera.y * RADAR_SCALE,
        VIEW_W * RADAR_SCALE, VIEW_H * RADAR_SCALE
    );

    // Flags left, as a column of pips under the map.
    ctx.fillStyle = '#8590b5';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText(`FLAGS LEFT ${flags.length}`, VIEW_W + RADAR_W / 2, RADAR_Y + RADAR_MAP + 24);
    ctx.fillText(`LIVES ${Math.max(0, lives)}`, VIEW_W + RADAR_W / 2, RADAR_Y + RADAR_MAP + 42);
}

function drawBanner(title, sub) {
    ctx.fillStyle = 'rgba(7, 10, 21, 0.72)';
    ctx.fillRect(0, VIEW_H / 2 - 46, VIEW_W, 92);
    ctx.fillStyle = '#ffd24a';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, VIEW_W / 2, VIEW_H / 2 - 10);
    ctx.fillStyle = '#e8edff';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(sub, VIEW_W / 2, VIEW_H / 2 + 18);
}

function draw() {
    ctx.fillStyle = '#070a15';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();
    drawRoads();
    drawMaze();
    drawSmoke();
    drawFlags();
    drawCars();
    if (state === 'dying') drawBanner('CRASHED', `${Math.max(0, lives)} cars left`);
    if (state === 'levelclear') drawBanner('LEVEL CLEAR', `Fuel bonus ${Math.round(fuel) * FUEL_BONUS_PER_UNIT}`);
    ctx.restore();

    drawRadar();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    flagsEl.textContent = String(flags.length);
    bestEl.textContent = String(best);
    fuelFillEl.style.width = `${clamp((fuel / FUEL_MAX) * 100, 0, 100)}%`;
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Game';
}

function hideOverlay() {
    overlay.classList.remove('visible');
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

// The most recent direction key wins, so a diagonal press does not cancel out.
const pressOrder = [];

function refreshWant() {
    for (let i = pressOrder.length - 1; i >= 0; i--) {
        const key = pressOrder[i];
        if (!heldKeys.has(key)) continue;
        if (LEFT_KEYS.includes(key)) { car.want = { x: -1, y: 0 }; return; }
        if (RIGHT_KEYS.includes(key)) { car.want = { x: 1, y: 0 }; return; }
        if (UP_KEYS.includes(key)) { car.want = { x: 0, y: -1 }; return; }
        if (DOWN_KEYS.includes(key)) { car.want = { x: 0, y: 1 }; return; }
    }
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if (e.key === 'Enter') {
        if (state === 'paused') togglePause();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.code === 'Space') {
        if (state === 'running') dropSmoke();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        pressOrder.push(e.key);
        if (pressOrder.length > 8) pressOrder.shift();
        refreshWant();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshWant();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    if (autoStep) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('rallyx-best') || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
setSeed((Math.random() * 1e9) | 0);
resetLevel();
updateHud();
showOverlay('RALLY-X', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
