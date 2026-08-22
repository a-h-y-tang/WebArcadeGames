// ---------------------------------------------------------------------------
// Flag Rally — a scrolling maze rally game on an HTML5 canvas.
//
// Drive a rally car through a pillar maze that is bigger than the window,
// collecting ten checkpoint flags while four rival cars hunt you down. Drop a
// smoke screen to spin the rivals out, watch the fuel, and don't kiss a
// boulder.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Kaboom!, Snake and Tetris in this repo. All motion is expressed per-second
// and advanced through `step(dt)`, so the tests can simulate frames
// deterministically without depending on requestAnimationFrame wall-clock
// timing.
// ---------------------------------------------------------------------------

// --- Course geometry -----------------------------------------------------
const TILE = 32;
const COLS = 27;
const ROWS = 21;
const WORLD_W = COLS * TILE;   // 864
const WORLD_H = ROWS * TILE;   // 672

const VIEW_W = 480;            // the scrolling window onto the course
const VIEW_H = 480;
const PANEL_W = 180;           // radar / gauges, fixed to the right of it
const CANVAS_W = VIEW_W + PANEL_W; // 660
const CANVAS_H = 480;

// Walls may only stand on odd/odd interior cells, so every cell with an even
// row or column stays open — which keeps the course connected by construction.
const WALL_CHANCE = 0.66;

const SPAWN = { c: 2, r: 2 };
const ENEMY_SPAWNS = [
    { c: 24, r: 2 },
    { c: 2, r: 18 },
    { c: 24, r: 18 },
    { c: 13, r: 10 },
    { c: 2, r: 10 },
    { c: 24, r: 10 },
];

// --- Player --------------------------------------------------------------
const CAR_SPEED = 128;         // px/s
const TURN_SNAP = 7;           // how close to a lane centre a turn is allowed
const CAR_LEN = 26;
const CAR_WID = 16;

// --- Rivals --------------------------------------------------------------
const ENEMY_BASE_SPEED = 92;
const ENEMY_SPEED_STEP = 6;
const ENEMY_SPEED_CAP = CAR_SPEED - 14;
const ENEMY_BASE_COUNT = 3;
const ENEMY_MAX_COUNT = 6;
const CRASH_R = 20;

// --- Flags / boulders ----------------------------------------------------
const FLAG_COUNT = 10;
const FLAG_POINTS = 100;
const FLAG_MIN_DIST = 6;       // cells (Manhattan) from the start
const PICKUP_R = 18;
const ROCK_BASE_COUNT = 4;
const ROCK_PER_LEVEL = 2;
const ROCK_MAX_COUNT = 14;
const ROCK_R = 12;

// --- Smoke ---------------------------------------------------------------
const SMOKE_COST = 6;
const SMOKE_LIFE = 1.6;
const SMOKE_R = 22;
const SMOKE_OFFSET = 20;
const SMOKE_COOLDOWN = 0.25;
const SPIN_TIME = 3;
const SPIN_POINTS = 200;

// --- Fuel ----------------------------------------------------------------
const FUEL_MAX = 100;
const FUEL_DRAIN = 2;          // per second
const EMPTY_SPEED_FACTOR = 0.55;

// --- Rules ---------------------------------------------------------------
const START_LIVES = 3;
const RESPAWN_TIME = 1.2;
const LEVEL_BONUS = 200;
const FUEL_BONUS = 5;
const BEST_KEY = 'flagrally-best';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';            // idle | running | paused | crashed | over
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let fuel = FUEL_MAX;
let doubled = false;           // the special flag has been collected
let respawn = 0;
let smokeCd = 0;
let animTime = 0;

let maze = new Uint8Array(COLS * ROWS);
let flags = [];
let rocks = [];
let enemies = [];
let smokes = [];
let car = { x: 0, y: 0, dir: { x: 0, y: 0 }, want: { x: 0, y: 0 }, face: { x: 1, y: 0 } };
let camera = { x: 0, y: 0 };

let seed = 1337;
let rng = mulberry32(seed);

// ---------------------------------------------------------------------------
// Seeded RNG — the same seed always builds the same course, which is what lets
// the tests assert on layout.
// ---------------------------------------------------------------------------

function mulberry32(a) {
    let t = a >>> 0;
    return function () {
        t = (t + 0x6d2b79f5) >>> 0;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

function setSeed(n) {
    seed = n >>> 0;
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

const colOf = (x) => Math.floor(x / TILE);
const rowOf = (y) => Math.floor(y / TILE);
const centerX = (c) => c * TILE + TILE / 2;
const centerY = (r) => r * TILE + TILE / 2;

function isOpen(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
    return maze[r * COLS + c] === 0;
}

// Nearest open cell to (c, r), searched in rings. Used so a hand-written spawn
// cell can never land inside a pillar.
function nearestOpen(c, r) {
    if (isOpen(c, r)) return { c, r };
    for (let d = 1; d < Math.max(COLS, ROWS); d++) {
        for (let dr = -d; dr <= d; dr++) {
            for (let dc = -d; dc <= d; dc++) {
                if (Math.abs(dr) !== d && Math.abs(dc) !== d) continue;
                if (isOpen(c + dc, r + dr)) return { c: c + dc, r: r + dr };
            }
        }
    }
    return { c: SPAWN.c, r: SPAWN.r };
}

const cellKey = (c, r) => c + ',' + r;
const manhattan = (a, b) => Math.abs(a.c - b.c) + Math.abs(a.r - b.r);

// ---------------------------------------------------------------------------
// Level generation
// ---------------------------------------------------------------------------

function buildMaze() {
    maze = new Uint8Array(COLS * ROWS);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const border = r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1;
            const pillar = r % 2 === 1 && c % 2 === 1 && rng() < WALL_CHANCE;
            maze[r * COLS + c] = border || pillar ? 1 : 0;
        }
    }
}

function openCells() {
    const cells = [];
    for (let r = 1; r < ROWS - 1; r++) {
        for (let c = 1; c < COLS - 1; c++) if (isOpen(c, r)) cells.push({ c, r });
    }
    return cells;
}

// Fisher-Yates on the seeded RNG, so picks are reproducible.
function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

function placeFlags() {
    const pool = shuffle(openCells().filter((cell) => manhattan(cell, SPAWN) >= FLAG_MIN_DIST));
    flags = pool.slice(0, FLAG_COUNT).map((cell) => ({
        c: cell.c,
        r: cell.r,
        x: centerX(cell.c),
        y: centerY(cell.r),
        taken: false,
        special: false,
    }));
    if (flags.length) flags[Math.floor(rng() * flags.length)].special = true;
}

// Can every flag still be driven to from the start without crossing one of
// `blocked` (the boulder cells)? A boulder wrecks the car, so a flag ringed by
// boulders would be an uncollectable flag — and an unwinnable level.
function flagsReachable(blocked) {
    const seen = new Set([cellKey(SPAWN.c, SPAWN.r)]);
    const queue = [[SPAWN.c, SPAWN.r]];
    while (queue.length) {
        const [c, r] = queue.shift();
        for (const d of DIRS) {
            const nc = c + d.x;
            const nr = r + d.y;
            const key = cellKey(nc, nr);
            if (!isOpen(nc, nr) || seen.has(key) || blocked.has(key)) continue;
            seen.add(key);
            queue.push([nc, nr]);
        }
    }
    return flags.every((f) => seen.has(cellKey(f.c, f.r)));
}

function placeRocks() {
    const taken = new Set(flags.map((f) => cellKey(f.c, f.r)));
    taken.add(cellKey(SPAWN.c, SPAWN.r));
    for (const spot of ENEMY_SPAWNS) {
        const cell = nearestOpen(spot.c, spot.r);
        taken.add(cellKey(cell.c, cell.r));
    }
    const count = Math.min(ROCK_MAX_COUNT, ROCK_BASE_COUNT + ROCK_PER_LEVEL * level);
    const pool = shuffle(
        openCells().filter(
            (cell) => !taken.has(cellKey(cell.c, cell.r)) && manhattan(cell, SPAWN) >= 3
        )
    );

    // Lay boulders one at a time, skipping any that would seal a flag off.
    rocks = [];
    const blocked = new Set();
    for (const cell of pool) {
        if (rocks.length >= count) break;
        const key = cellKey(cell.c, cell.r);
        blocked.add(key);
        if (flagsReachable(blocked)) {
            rocks.push({ c: cell.c, r: cell.r, x: centerX(cell.c), y: centerY(cell.r) });
        } else {
            blocked.delete(key);
        }
    }
}

function enemySpeed() {
    return Math.min(ENEMY_SPEED_CAP, ENEMY_BASE_SPEED + (level - 1) * ENEMY_SPEED_STEP);
}

function spawnEnemyAt(c, r) {
    const cell = nearestOpen(c, r);
    const enemy = {
        c: cell.c,
        r: cell.r,
        x: centerX(cell.c),
        y: centerY(cell.r),
        tc: cell.c,
        tr: cell.r,
        dir: { x: 0, y: 0 },
        spin: 0,
        speed: enemySpeed(),
        pref: enemies.length % 4,
    };
    enemies.push(enemy);
    return enemy;
}

function resetCars() {
    car = {
        x: centerX(SPAWN.c),
        y: centerY(SPAWN.r),
        dir: { x: 0, y: 0 },
        want: { x: 0, y: 0 },
        face: { x: 1, y: 0 },
    };
    enemies = [];
    const count = Math.min(ENEMY_MAX_COUNT, ENEMY_BASE_COUNT + level);
    for (let i = 0; i < count; i++) {
        const spot = ENEMY_SPAWNS[i % ENEMY_SPAWNS.length];
        spawnEnemyAt(spot.c, spot.r);
    }
    smokes = [];
    smokeCd = 0;
    updateCamera();
}

function buildLevel() {
    rng = mulberry32((seed + level * 7919) >>> 0);
    buildMaze();
    placeFlags();
    placeRocks();
    doubled = false;
    resetCars();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    fuel = FUEL_MAX;
    respawn = 0;
    buildLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    score += level * LEVEL_BONUS + Math.floor(fuel) * FUEL_BONUS;
    level += 1;
    fuel = FUEL_MAX;
    buildLevel();
    updateHud();
}

function loseLife() {
    lives -= 1;
    smokes = [];
    updateHud();
    if (lives <= 0) {
        endGame();
        return;
    }
    state = 'crashed';
    respawn = RESPAWN_TIME;
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage unavailable (private mode / file://) — score just isn't kept */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Best ${best}`, 'Press Space to race again');
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
// Simulation
// ---------------------------------------------------------------------------

function playerSpeed() {
    return CAR_SPEED * (fuel > 0 ? 1 : EMPTY_SPEED_FACTOR);
}

function movePlayer(dt) {
    const want = car.want;
    const dir = car.dir;
    const moving = dir.x !== 0 || dir.y !== 0;

    if ((want.x !== 0 || want.y !== 0) && (want.x !== dir.x || want.y !== dir.y)) {
        if (moving && want.x === -dir.x && want.y === -dir.y) {
            car.dir = { x: want.x, y: want.y };   // a reversal is always legal
        } else {
            const c = colOf(car.x);
            const r = rowOf(car.y);
            const cx = centerX(c);
            const cy = centerY(r);
            const aligned = want.x !== 0 ? Math.abs(car.y - cy) <= TURN_SNAP
                : Math.abs(car.x - cx) <= TURN_SNAP;
            if (aligned && isOpen(c + want.x, r + want.y)) {
                car.dir = { x: want.x, y: want.y };
                if (want.x !== 0) car.y = cy;
                else car.x = cx;
            }
        }
    }

    if (car.dir.x === 0 && car.dir.y === 0) return;
    car.face = { x: car.dir.x, y: car.dir.y };

    const dist = playerSpeed() * dt;
    if (car.dir.x !== 0) {
        const r = rowOf(car.y);
        car.y = centerY(r);
        const c = colOf(car.x);
        let nx = car.x + car.dir.x * dist;
        if (!isOpen(c + car.dir.x, r)) {
            const limit = centerX(c);
            nx = car.dir.x > 0 ? Math.min(nx, limit) : Math.max(nx, limit);
        }
        car.x = nx;
    } else {
        const c = colOf(car.x);
        car.x = centerX(c);
        const r = rowOf(car.y);
        let ny = car.y + car.dir.y * dist;
        if (!isOpen(c, r + car.dir.y)) {
            const limit = centerY(r);
            ny = car.dir.y > 0 ? Math.min(ny, limit) : Math.max(ny, limit);
        }
        car.y = ny;
    }
}

// The four grid neighbours. Rivals scan them starting at their own `pref`
// offset, so several chasers arriving at one junction fan out instead of
// stacking into a convoy.
const DIRS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
];

function pickEnemyTarget(enemy) {
    const options = DIRS.filter((d) => isOpen(enemy.tc + d.x, enemy.tr + d.y));
    if (!options.length) {
        enemy.dir = { x: 0, y: 0 };
        return;
    }
    const forward = options.filter(
        (d) => !(d.x === -enemy.dir.x && d.y === -enemy.dir.y) || (enemy.dir.x === 0 && enemy.dir.y === 0)
    );
    const usable = forward.length ? forward : options;

    let bestDir = usable[0];
    let bestCost = Infinity;
    for (let i = 0; i < usable.length; i++) {
        const d = usable[(i + enemy.pref) % usable.length];
        const tx = centerX(enemy.tc + d.x);
        const ty = centerY(enemy.tr + d.y);
        const cost = Math.abs(tx - car.x) + Math.abs(ty - car.y);
        if (cost < bestCost) {
            bestCost = cost;
            bestDir = d;
        }
    }
    enemy.dir = { x: bestDir.x, y: bestDir.y };
    enemy.tc += bestDir.x;
    enemy.tr += bestDir.y;
}

function moveEnemy(enemy, dt) {
    if (enemy.spin > 0) {
        enemy.spin = Math.max(0, enemy.spin - dt);
        return;
    }
    let budget = enemy.speed * dt;
    let guard = 0;
    while (budget > 0 && guard++ < 8) {
        const tx = centerX(enemy.tc);
        const ty = centerY(enemy.tr);
        const d = Math.hypot(tx - enemy.x, ty - enemy.y);
        if (d <= budget) {
            enemy.x = tx;
            enemy.y = ty;
            enemy.c = enemy.tc;
            enemy.r = enemy.tr;
            budget -= d;
            pickEnemyTarget(enemy);
            if (enemy.dir.x === 0 && enemy.dir.y === 0) return;
        } else {
            enemy.x += ((tx - enemy.x) / d) * budget;
            enemy.y += ((ty - enemy.y) / d) * budget;
            enemy.c = colOf(enemy.x);
            enemy.r = rowOf(enemy.y);
            budget = 0;
        }
    }
}

function dropSmoke() {
    if (state !== 'running') return false;
    if (fuel < SMOKE_COST || smokeCd > 0) return false;
    const back = car.face;
    smokes.push({
        x: car.x - back.x * SMOKE_OFFSET,
        y: car.y - back.y * SMOKE_OFFSET,
        life: SMOKE_LIFE,
    });
    fuel = Math.max(0, fuel - SMOKE_COST);
    smokeCd = SMOKE_COOLDOWN;
    return true;
}

function updateSmoke(dt) {
    for (let i = smokes.length - 1; i >= 0; i--) {
        const puff = smokes[i];
        puff.life -= dt;
        if (puff.life <= 0) {
            smokes.splice(i, 1);
            continue;
        }
        // A puff spins one rival, then is used up.
        for (const enemy of enemies) {
            if (enemy.spin > 0) continue;
            if (Math.hypot(enemy.x - puff.x, enemy.y - puff.y) <= SMOKE_R) {
                enemy.spin = SPIN_TIME;
                enemy.dir = { x: 0, y: 0 };
                enemy.tc = colOf(enemy.x);
                enemy.tr = rowOf(enemy.y);
                score += SPIN_POINTS;
                smokes.splice(i, 1);
                break;
            }
        }
    }
}

function collectFlags() {
    for (const flag of flags) {
        if (flag.taken) continue;
        if (Math.hypot(car.x - flag.x, car.y - flag.y) > PICKUP_R) continue;
        flag.taken = true;
        score += doubled ? FLAG_POINTS * 2 : FLAG_POINTS;
        if (flag.special) doubled = true;
    }
    if (flags.every((f) => f.taken)) nextLevel();
}

function checkCrashes() {
    for (const rock of rocks) {
        if (Math.hypot(car.x - rock.x, car.y - rock.y) <= ROCK_R + CRASH_R * 0.5) {
            loseLife();
            return;
        }
    }
    for (const enemy of enemies) {
        if (enemy.spin > 0) continue;   // a spun-out rival is inert
        if (Math.hypot(car.x - enemy.x, car.y - enemy.y) <= CRASH_R) {
            loseLife();
            return;
        }
    }
}

function updateCamera() {
    const cx = Math.max(0, Math.min(WORLD_W - VIEW_W, car.x - VIEW_W / 2));
    const cy = Math.max(0, Math.min(WORLD_H - VIEW_H, car.y - VIEW_H / 2));
    camera = { x: cx, y: cy };
}

function step(dt) {
    if (state === 'crashed') {
        respawn -= dt;
        if (respawn <= 0) {
            resetCars();
            state = 'running';
        }
        return;
    }
    if (state !== 'running') return;

    animTime += dt;
    fuel = Math.max(0, fuel - FUEL_DRAIN * dt);
    smokeCd = Math.max(0, smokeCd - dt);

    movePlayer(dt);
    for (const enemy of enemies) moveEnemy(enemy, dt);
    updateSmoke(dt);
    collectFlags();
    if (state === 'running') checkCrashes();
    updateCamera();
    updateHud();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elFlags = document.getElementById('flags');
const elFuel = document.getElementById('fuel');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

const flagsLeft = () => flags.filter((f) => !f.taken).length;

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elLives.textContent = String(Math.max(0, lives));
    elFlags.textContent = String(flagsLeft());
    elFuel.textContent = String(Math.round(fuel));
    elBest.textContent = String(best);
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function drawCourse() {
    const c0 = Math.max(0, colOf(camera.x) - 1);
    const c1 = Math.min(COLS - 1, colOf(camera.x + VIEW_W) + 1);
    const r0 = Math.max(0, rowOf(camera.y) - 1);
    const r1 = Math.min(ROWS - 1, rowOf(camera.y + VIEW_H) + 1);

    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
            const x = c * TILE;
            const y = r * TILE;
            if (isOpen(c, r)) {
                ctx.fillStyle = (c + r) % 2 === 0 ? '#132330' : '#10202c';
                ctx.fillRect(x, y, TILE, TILE);
            } else {
                ctx.fillStyle = '#24455c';
                ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
                ctx.fillStyle = '#325f7d';
                ctx.fillRect(x + 1, y + 1, TILE - 2, 5);
                ctx.fillStyle = '#0d1a24';
                ctx.fillRect(x + 1, y + TILE - 6, TILE - 2, 5);
            }
        }
    }
}

function drawRocks() {
    for (const rock of rocks) {
        ctx.fillStyle = '#5a6470';
        ctx.beginPath();
        ctx.arc(rock.x, rock.y, ROCK_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#79838f';
        ctx.beginPath();
        ctx.arc(rock.x - 3, rock.y - 4, ROCK_R * 0.45, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawFlags() {
    const bob = Math.sin(animTime * 4) * 2;
    for (const flag of flags) {
        if (flag.taken) continue;
        const h = flag.special ? 20 : 16;
        const w = flag.special ? 14 : 11;
        ctx.strokeStyle = '#dce6ee';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(flag.x - 5, flag.y + 9);
        ctx.lineTo(flag.x - 5, flag.y - h + 9);
        ctx.stroke();

        ctx.fillStyle = flag.special ? '#ffd166' : '#4fd1c5';
        ctx.beginPath();
        ctx.moveTo(flag.x - 4, flag.y - h + 9);
        ctx.lineTo(flag.x - 4 + w, flag.y - h + 13 + bob * 0.3);
        ctx.lineTo(flag.x - 4, flag.y - h + 17);
        ctx.closePath();
        ctx.fill();

        if (flag.special) {
            ctx.fillStyle = '#6b4c00';
            ctx.font = 'bold 9px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('S', flag.x + 1, flag.y - h + 13);
        }
    }
}

function drawSmoke() {
    for (const puff of smokes) {
        const t = puff.life / SMOKE_LIFE;
        ctx.fillStyle = `rgba(200, 214, 224, ${0.45 * t})`;
        ctx.beginPath();
        ctx.arc(puff.x, puff.y, SMOKE_R * (1.15 - 0.3 * t), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(240, 248, 255, ${0.25 * t})`;
        ctx.beginPath();
        ctx.arc(puff.x - 4, puff.y - 3, SMOKE_R * 0.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Rounded rectangle centred on the current transform origin.
function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawCarShape(x, y, angle, body, cabin) {
    const hl = CAR_LEN / 2;
    const hw = CAR_WID / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    roundRect(-hl + 1, -hw + 3, CAR_LEN, CAR_WID, 4);
    ctx.fill();

    ctx.fillStyle = '#0b1219';               // tyres
    ctx.fillRect(-hl + 3, -hw - 3, 7, 3);
    ctx.fillRect(-hl + 3, hw, 7, 3);
    ctx.fillRect(hl - 10, -hw - 3, 7, 3);
    ctx.fillRect(hl - 10, hw, 7, 3);

    ctx.fillStyle = body;
    roundRect(-hl, -hw, CAR_LEN, CAR_WID, 4);
    ctx.fill();

    ctx.fillStyle = cabin;                   // cabin
    roundRect(-4, -hw + 3, 9, CAR_WID - 6, 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(-hl + 2, -hw + 2, CAR_LEN - 4, 2);

    ctx.fillStyle = '#fff6cf';               // headlights point the way
    ctx.fillRect(hl - 3, -hw + 2, 2, 3);
    ctx.fillRect(hl - 3, hw - 5, 2, 3);

    ctx.restore();
}

function angleOf(dir, fallback) {
    if (dir.x === 0 && dir.y === 0) return fallback;
    return Math.atan2(dir.y, dir.x);
}

function drawCars() {
    for (const enemy of enemies) {
        if (enemy.spin > 0) {
            drawCarShape(enemy.x, enemy.y, enemy.spin * 9, '#8b939c', '#39424c');
            ctx.strokeStyle = 'rgba(220, 230, 240, 0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, 17, enemy.spin * 6, enemy.spin * 6 + 4);
            ctx.stroke();
        } else {
            drawCarShape(enemy.x, enemy.y, angleOf(enemy.dir, 0), '#ef4b5b', '#6d121c');
        }
    }
    drawCarShape(car.x, car.y, angleOf(car.dir, angleOf(car.face, 0)), '#f2f6f9', '#17394a');
}

function drawPanel() {
    ctx.fillStyle = '#0b1520';
    ctx.fillRect(VIEW_W, 0, PANEL_W, CANVAS_H);
    ctx.strokeStyle = '#1d2c39';
    ctx.beginPath();
    ctx.moveTo(VIEW_W + 0.5, 0);
    ctx.lineTo(VIEW_W + 0.5, CANVAS_H);
    ctx.stroke();

    const pad = 14;
    const mapW = PANEL_W - pad * 2;
    const scale = mapW / WORLD_W;
    const mapH = WORLD_H * scale;
    const mx = VIEW_W + pad;
    const my = 44;

    ctx.fillStyle = '#8ba7bd';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('RADAR', mx, my - 10);

    ctx.fillStyle = '#0a121a';
    ctx.fillRect(mx, my, mapW, mapH);
    ctx.strokeStyle = '#22384a';
    ctx.strokeRect(mx + 0.5, my + 0.5, mapW - 1, mapH - 1);

    // Pillars, dimmed, so the radar reads as a map rather than a dot field.
    ctx.fillStyle = '#17303f';
    for (let r = 1; r < ROWS - 1; r++) {
        for (let c = 1; c < COLS - 1; c++) {
            if (isOpen(c, r)) continue;
            ctx.fillRect(mx + c * TILE * scale, my + r * TILE * scale, TILE * scale, TILE * scale);
        }
    }

    // What the window is currently showing.
    ctx.strokeStyle = 'rgba(120, 180, 210, 0.55)';
    ctx.strokeRect(mx + camera.x * scale, my + camera.y * scale, VIEW_W * scale, VIEW_H * scale);

    for (const flag of flags) {
        if (flag.taken) continue;
        ctx.fillStyle = flag.special ? '#ffd166' : '#4fd1c5';
        ctx.fillRect(mx + flag.x * scale - 1.5, my + flag.y * scale - 1.5, 3, 3);
    }
    for (const enemy of enemies) {
        ctx.fillStyle = enemy.spin > 0 ? '#8b939c' : '#ef4b5b';
        ctx.fillRect(mx + enemy.x * scale - 2, my + enemy.y * scale - 2, 4, 4);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(mx + car.x * scale - 2, my + car.y * scale - 2, 4, 4);

    // Fuel gauge.
    const gy = my + mapH + 34;
    ctx.fillStyle = '#8ba7bd';
    ctx.fillText('FUEL', mx, gy - 8);
    ctx.fillStyle = '#0a121a';
    ctx.fillRect(mx, gy, mapW, 14);
    const pct = Math.max(0, fuel) / FUEL_MAX;
    ctx.fillStyle = fuel <= 0 ? '#ef4b5b' : pct < 0.25 ? '#f5a623' : '#4fd1c5';
    ctx.fillRect(mx, gy, mapW * pct, 14);
    ctx.strokeStyle = '#22384a';
    ctx.strokeRect(mx + 0.5, gy + 0.5, mapW - 1, 13);

    // Flags left.
    ctx.fillStyle = '#8ba7bd';
    ctx.fillText('FLAGS LEFT', mx, gy + 44);
    ctx.fillStyle = '#e6f0f7';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText(String(flagsLeft()), mx, gy + 74);

    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = '#5f7488';
    ctx.fillText(doubled ? 'SPECIAL: FLAGS x2' : 'FIND THE GOLD FLAG', mx, gy + 96);
    if (fuel <= 0) {
        ctx.fillStyle = '#ef4b5b';
        ctx.fillText('OUT OF FUEL', mx, gy + 112);
    }
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();
    ctx.translate(-camera.x, -camera.y);

    drawCourse();
    drawRocks();
    drawFlags();
    drawSmoke();
    drawCars();

    ctx.restore();

    if (state === 'crashed') {
        ctx.fillStyle = 'rgba(239, 75, 91, 0.16)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    drawPanel();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const KEY_DIRS = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    a: { x: -1, y: 0 },
    A: { x: -1, y: 0 },
    d: { x: 1, y: 0 },
    D: { x: 1, y: 0 },
    w: { x: 0, y: -1 },
    W: { x: 0, y: -1 },
    s: { x: 0, y: 1 },
    S: { x: 0, y: 1 },
};

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.code === 'Space') {
        if (state === 'running') dropSmoke();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    const dir = KEY_DIRS[e.key];
    if (dir) {
        car.want = { x: dir.x, y: dir.y };
        e.preventDefault();
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
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

try {
    best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
} catch (err) {
    best = 0;
}

setSeed((Math.random() * 0xffffffff) >>> 0);
buildLevel();
state = 'idle';
updateHud();
showOverlay('FLAG RALLY', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
