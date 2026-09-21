// ---------------------------------------------------------------------------
// Rally-X — a top-down maze driving game on an HTML5 canvas.
//
// Collect all ten flags scattered around a scrolling maze before the red chase
// cars catch you. The tank drains the whole time, and the only defence is a
// smoke screen that spins out any chase car that drives through it.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Lode Runner and Snake in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// instead of leaning on requestAnimationFrame wall clocks.
// ---------------------------------------------------------------------------

// --- Maze ----------------------------------------------------------------
// Solid rectangular blocks that never touch each other or the outer wall, so
// every open cell is reachable and the maze has no dead ends.
const MAZE = [
    '###################',
    '#.................#',
    '#.##..###..##..##.#',
    '#.##..###..##..##.#',
    '#.................#',
    '#...##..#....###..#',
    '#.#.....#....####.#',
    '#.#.....#.......#.#',
    '#.................#',
    '#...##.#..####..#.#',
    '#...##..........#.#',
    '#.###........####.#',
    '#.###..###.....##.#',
    '#.................#',
    '###################',
];

const CELL = 32;
const ROWS = MAZE.length;          // 15
const COLS = MAZE[0].length;       // 19
const WORLD_W = COLS * CELL;       // 608
const WORLD_H = ROWS * CELL;       // 480
const VIEW_W = 480;
const VIEW_H = 384;

const START_CELL = { c: 9, r: 7 };
const ENEMY_CELLS = [
    { c: 1, r: 1 },
    { c: 17, r: 1 },
    { c: 1, r: 13 },
    { c: 17, r: 13 },
    { c: 9, r: 13 },
];
const ENEMY_BIAS = [
    { c: 0, r: 0 },
    { c: 3, r: 0 },
    { c: 0, r: 3 },
    { c: -3, r: 0 },
    { c: 0, r: -3 },
];

// Eighteen hand-picked spots, all at least four cells apart. Each round uses a
// window of ten of them, so the layout shifts as the rounds go by.
const FLAG_SPOTS = [
    { c: 4, r: 1 }, { c: 8, r: 1 }, { c: 12, r: 1 }, { c: 10, r: 3 },
    { c: 14, r: 3 }, { c: 5, r: 4 }, { c: 17, r: 4 }, { c: 12, r: 5 },
    { c: 3, r: 6 }, { c: 7, r: 6 }, { c: 14, r: 7 }, { c: 5, r: 8 },
    { c: 11, r: 8 }, { c: 3, r: 10 }, { c: 13, r: 10 }, { c: 6, r: 11 },
    { c: 4, r: 13 }, { c: 8, r: 13 },
];
const FLAGS_PER_ROUND = 10;
const LUCKY_INDEX = 4;

// --- Driving -------------------------------------------------------------
const CAR_SPEED = 104;           // px/s with fuel in the tank
const LOW_FUEL_FACTOR = 0.55;    // ...and on fumes
const ENEMY_SPEED_BASE = 72;
const ENEMY_SPEED_STEP = 4;
const ENEMY_SPEED_CAP = 92;      // always under CAR_SPEED
const CRASH_DIST = 17;
const PICKUP_DIST = 18;

// --- Fuel and smoke ------------------------------------------------------
const FUEL_MAX = 100;
const FUEL_DRAIN = 1.8;          // units per second
const FUEL_BONUS_PER_UNIT = 10;
const SMOKE_COST = 6;
const SMOKE_LIFE = 4;
const SMOKE_RADIUS = 16;
const STUN_TIME = 3;

// --- Round structure -----------------------------------------------------
const START_LIVES = 3;
const FLAG_POINTS = 100;
const DEATH_PAUSE = 1.4;
const CLEAR_PAUSE = 1.8;
const BEST_KEY = 'rallyx-best';

const DIRS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
];

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const radar = document.getElementById('radar');
const radarCtx = radar.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const flagsEl = document.getElementById('flags');
const fuelEl = document.getElementById('fuel');
const fuelBar = document.getElementById('fuel-bar');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'dying' | 'levelclear' | 'over'
let state = 'idle';
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let fuel = FUEL_MAX;
let multiplier = 1;
let deathTimer = 0;
let clearTimer = 0;
let flags = [];

const car = { x: 0, y: 0, dir: { x: 0, y: 0 }, want: { x: 0, y: 0 }, angle: -Math.PI / 2 };
const enemies = [];
const smokes = [];
const camera = { x: 0, y: 0 };

// The requestAnimationFrame driver only steps the simulation while this is on.
// The Playwright suite switches it off and pumps step(dt) itself.
let autoStep = true;

function setAutoStep(on) {
    autoStep = !!on;
}

// ---------------------------------------------------------------------------
// Grid helpers (pure)
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function isWall(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
    return MAZE[r][c] === '#';
}

function cellOf(x, y) {
    return { c: Math.floor(x / CELL), r: Math.floor(y / CELL) };
}

function centerOf(c, r) {
    return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
}

function enemyCount(lvl) {
    return Math.min(2 + lvl, ENEMY_CELLS.length);
}

function enemySpeed(lvl) {
    return Math.min(ENEMY_SPEED_BASE + (lvl - 1) * ENEMY_SPEED_STEP, ENEMY_SPEED_CAP);
}

function flagsForRound(lvl) {
    const offset = ((lvl - 1) * 5) % FLAG_SPOTS.length;
    return Array.from({ length: FLAGS_PER_ROUND }, (_, i) => {
        const spot = FLAG_SPOTS[(offset + i) % FLAG_SPOTS.length];
        return { c: spot.c, r: spot.r, lucky: i === LUCKY_INDEX, taken: false };
    });
}

function flagsLeft() {
    return flags.filter((f) => !f.taken).length;
}

// ---------------------------------------------------------------------------
// Movement shared by the player and the chase cars
// ---------------------------------------------------------------------------

// Take the wanted direction: a reversal right away, any other turn at the next
// cell centre and only when the cell that way is open.
function steerEntity(e, speed, dt) {
    const w = e.want;
    if (!w.x && !w.y) return;
    if (w.x === e.dir.x && w.y === e.dir.y) return;
    if ((e.dir.x || e.dir.y) && w.x === -e.dir.x && w.y === -e.dir.y) {
        e.dir.x = w.x;
        e.dir.y = w.y;
        return;
    }
    const cell = cellOf(e.x, e.y);
    const cen = centerOf(cell.c, cell.r);
    const snap = Math.max(2, speed * dt);
    if (Math.abs(e.x - cen.x) > snap || Math.abs(e.y - cen.y) > snap) return;
    if (isWall(cell.c + w.x, cell.r + w.y)) return;
    e.x = cen.x;
    e.y = cen.y;
    e.dir.x = w.x;
    e.dir.y = w.y;
}

// Drive along the current direction, staying on the centre line of the
// corridor. Running into a wall parks the car at the last open cell centre.
function moveEntity(e, speed, dt) {
    if (!e.dir.x && !e.dir.y) return;
    const cell = cellOf(e.x, e.y);
    const cen = centerOf(cell.c, cell.r);
    let nx = e.x + e.dir.x * speed * dt;
    let ny = e.y + e.dir.y * speed * dt;
    if (e.dir.x) ny = cen.y;
    if (e.dir.y) nx = cen.x;
    if (isWall(cell.c + e.dir.x, cell.r + e.dir.y)) {
        if (e.dir.x > 0) nx = Math.min(nx, cen.x);
        else if (e.dir.x < 0) nx = Math.max(nx, cen.x);
        if (e.dir.y > 0) ny = Math.min(ny, cen.y);
        else if (e.dir.y < 0) ny = Math.max(ny, cen.y);
        if (nx === cen.x && ny === cen.y) {
            e.dir.x = 0;
            e.dir.y = 0;
        }
    }
    e.x = nx;
    e.y = ny;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function carSpeed() {
    return CAR_SPEED * (fuel > 0 ? 1 : LOW_FUEL_FACTOR);
}

function updateCar(dt) {
    const speed = carSpeed();
    steerEntity(car, speed, dt);
    moveEntity(car, speed, dt);
    if (car.dir.x || car.dir.y) car.angle = Math.atan2(car.dir.y, car.dir.x);
}

function setWant(x, y) {
    car.want.x = x;
    car.want.y = y;
}

function collectFlags() {
    for (const f of flags) {
        if (f.taken) continue;
        const p = centerOf(f.c, f.r);
        if (Math.hypot(car.x - p.x, car.y - p.y) >= PICKUP_DIST) continue;
        f.taken = true;
        score += FLAG_POINTS * multiplier;
        if (f.lucky) multiplier *= 2;
    }
    if (flags.every((f) => f.taken)) roundClear();
}

// ---------------------------------------------------------------------------
// Fuel and smoke
// ---------------------------------------------------------------------------

function burnFuel(dt) {
    fuel = Math.max(0, fuel - FUEL_DRAIN * dt);
}

function dropSmoke() {
    if (state !== 'running') return;
    if (fuel < SMOKE_COST) return;
    fuel -= SMOKE_COST;
    smokes.push({ x: car.x, y: car.y, life: SMOKE_LIFE });
}

function updateSmokes(dt) {
    for (let i = smokes.length - 1; i >= 0; i--) {
        const s = smokes[i];
        s.life -= dt;
        if (s.life <= 0) {
            smokes.splice(i, 1);
            continue;
        }
        for (const e of enemies) {
            if (Math.hypot(e.x - s.x, e.y - s.y) <= SMOKE_RADIUS) e.stun = STUN_TIME;
        }
    }
}

// ---------------------------------------------------------------------------
// Chase cars
// ---------------------------------------------------------------------------

function spawnEnemies() {
    enemies.length = 0;
    for (let i = 0; i < enemyCount(level); i++) {
        const cell = ENEMY_CELLS[i % ENEMY_CELLS.length];
        const p = centerOf(cell.c, cell.r);
        enemies.push({
            x: p.x,
            y: p.y,
            dir: { x: 0, y: 0 },
            bias: { ...ENEMY_BIAS[i % ENEMY_BIAS.length] },
            stun: 0,
            angle: 0,
            spin: 0,
        });
    }
}

// Greedy pursuit: at every cell centre take the open direction whose next cell
// is closest to the (biased) player cell, never reversing unless forced to.
function chooseEnemyDir(e, speed, dt) {
    const cell = cellOf(e.x, e.y);
    const cen = centerOf(cell.c, cell.r);
    const snap = Math.max(2, speed * dt);
    const atCentre = Math.abs(e.x - cen.x) <= snap && Math.abs(e.y - cen.y) <= snap;
    if (!atCentre && (e.dir.x || e.dir.y)) return;
    e.x = cen.x;
    e.y = cen.y;

    const target = cellOf(car.x, car.y);
    const tc = clamp(target.c + e.bias.c, 0, COLS - 1);
    const tr = clamp(target.r + e.bias.r, 0, ROWS - 1);

    const open = DIRS.filter((d) => !isWall(cell.c + d.x, cell.r + d.y));
    const forward = open.filter((d) => !(d.x === -e.dir.x && d.y === -e.dir.y));
    const pool = forward.length ? forward : open;

    let best = null;
    let bestScore = Infinity;
    for (const d of pool) {
        const s = Math.abs(cell.c + d.x - tc) + Math.abs(cell.r + d.y - tr);
        if (s < bestScore) {
            bestScore = s;
            best = d;
        }
    }
    if (best) {
        e.dir.x = best.x;
        e.dir.y = best.y;
    }
}

function updateEnemies(dt) {
    const speed = enemySpeed(level);
    for (const e of enemies) {
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - dt);
            e.spin += dt * 12;
            continue;
        }
        chooseEnemyDir(e, speed, dt);
        moveEntity(e, speed, dt);
        if (e.dir.x || e.dir.y) e.angle = Math.atan2(e.dir.y, e.dir.x);
    }
}

function detectCrash() {
    for (const e of enemies) {
        if (e.stun > 0) continue;
        if (Math.hypot(e.x - car.x, e.y - car.y) < CRASH_DIST) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Round flow
// ---------------------------------------------------------------------------

function resetPositions() {
    const p = centerOf(START_CELL.c, START_CELL.r);
    car.x = p.x;
    car.y = p.y;
    car.dir.x = 0;
    car.dir.y = 0;
    car.want.x = 0;
    car.want.y = 0;
    car.angle = -Math.PI / 2;
    smokes.length = 0;
    enemies.forEach((e, i) => {
        const cell = ENEMY_CELLS[i % ENEMY_CELLS.length];
        const q = centerOf(cell.c, cell.r);
        e.x = q.x;
        e.y = q.y;
        e.dir.x = 0;
        e.dir.y = 0;
        e.stun = 0;
    });
    updateCamera();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    multiplier = 1;
    fuel = FUEL_MAX;
    flags = flagsForRound(level);
    spawnEnemies();
    resetPositions();
    state = 'running';
    hideOverlay();
    updateHud();
}

function roundClear() {
    score += Math.floor(fuel) * FUEL_BONUS_PER_UNIT;
    state = 'levelclear';
    clearTimer = CLEAR_PAUSE;
}

function nextRound() {
    level += 1;
    multiplier = 1;
    fuel = FUEL_MAX;
    flags = flagsForRound(level);
    spawnEnemies();
    resetPositions();
    state = 'running';
}

function loseLife() {
    lives -= 1;
    state = 'dying';
    deathTimer = DEATH_PAUSE;
    smokes.length = 0;
}

function afterDeath() {
    if (lives <= 0) {
        gameOver();
        return;
    }
    resetPositions();
    state = 'running';
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage disabled — the run just isn't recorded */
        }
    }
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to play again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P or Enter to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function updateCamera() {
    camera.x = clamp(car.x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
    camera.y = clamp(car.y - VIEW_H / 2, 0, WORLD_H - VIEW_H);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) afterDeath();
        updateHud();
        return;
    }
    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) nextRound();
        updateHud();
        return;
    }
    if (state !== 'running') return;

    burnFuel(dt);
    updateCar(dt);
    collectFlags();
    if (state !== 'running') {
        updateHud();
        return;
    }
    updateSmokes(dt);
    updateEnemies(dt);
    detectCrash();
    updateCamera();
    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering — world
// ---------------------------------------------------------------------------

function drawMaze() {
    const c0 = Math.max(0, Math.floor(camera.x / CELL));
    const c1 = Math.min(COLS - 1, Math.ceil((camera.x + VIEW_W) / CELL));
    const r0 = Math.max(0, Math.floor(camera.y / CELL));
    const r1 = Math.min(ROWS - 1, Math.ceil((camera.y + VIEW_H) / CELL));

    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
            const x = c * CELL;
            const y = r * CELL;
            if (isWall(c, r)) {
                ctx.fillStyle = '#1b3a52';
                ctx.fillRect(x, y, CELL, CELL);
                ctx.fillStyle = '#26516f';
                ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
                ctx.fillStyle = 'rgba(255,255,255,0.07)';
                ctx.fillRect(x + 2, y + 2, CELL - 4, 4);
            } else {
                ctx.fillStyle = '#0a141d';
                ctx.fillRect(x, y, CELL, CELL);
                ctx.fillStyle = 'rgba(255,255,255,0.045)';
                ctx.fillRect(x + CELL / 2 - 1, y + CELL / 2 - 1, 2, 2);
            }
        }
    }
}

function drawFlag(f) {
    if (f.taken) return;
    const p = centerOf(f.c, f.r);
    const wave = Math.sin(p.x + p.y + performance.now() / 260) * 1.5;
    ctx.strokeStyle = '#cfd8dc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 6, p.y + 9);
    ctx.lineTo(p.x - 6, p.y - 10);
    ctx.stroke();
    ctx.fillStyle = f.lucky ? '#66bb6a' : '#ffcf3f';
    ctx.beginPath();
    ctx.moveTo(p.x - 6, p.y - 10);
    ctx.lineTo(p.x + 9 + wave, p.y - 5);
    ctx.lineTo(p.x - 6, p.y);
    ctx.closePath();
    ctx.fill();
    if (f.lucky) {
        ctx.fillStyle = '#06340f';
        ctx.font = 'bold 8px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('S', p.x - 1, p.y - 2);
        ctx.textAlign = 'start';
    }
}

function drawSmoke(s) {
    const t = clamp(1 - s.life / SMOKE_LIFE, 0, 1);
    const radius = SMOKE_RADIUS * (0.9 + t * 0.6);
    const alpha = 0.7 * (1 - t * 0.6);
    ctx.fillStyle = `rgba(226, 238, 248, ${alpha * 0.5})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, radius * 0.9, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + t * 2;
        ctx.fillStyle = `rgba(240, 248, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(a) * radius * 0.55, s.y + Math.sin(a) * radius * 0.55, radius * 0.45, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawCarShape(x, y, angle, body, roof) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-10, -7, 21, 15);
    ctx.fillStyle = body;
    ctx.fillRect(-11, -8, 22, 16);
    ctx.fillStyle = roof;
    ctx.fillRect(-4, -6, 9, 12);
    ctx.fillStyle = '#0a141d';
    ctx.fillRect(-9, -9, 5, 3);
    ctx.fillRect(-9, 6, 5, 3);
    ctx.fillRect(5, -9, 5, 3);
    ctx.fillRect(5, 6, 5, 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(8, -5, 3, 3);
    ctx.fillRect(8, 2, 3, 3);
    ctx.restore();
}

function drawEnemyCar(e) {
    const angle = e.stun > 0 ? e.spin : e.angle;
    drawCarShape(e.x, e.y, angle, '#ef5350', '#7f1d1d');
    if (e.stun > 0) {
        ctx.strokeStyle = 'rgba(255, 207, 63, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 14, e.spin, e.spin + Math.PI * 1.2);
        ctx.stroke();
    }
}

function drawBanner(text, sub) {
    ctx.fillStyle = 'rgba(5, 9, 15, 0.72)';
    ctx.fillRect(0, VIEW_H / 2 - 46, VIEW_W, 92);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffcf3f';
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(text, VIEW_W / 2, VIEW_H / 2 + 2);
    if (sub) {
        ctx.fillStyle = '#e6f0fa';
        ctx.font = '15px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(sub, VIEW_W / 2, VIEW_H / 2 + 28);
    }
    ctx.textAlign = 'start';
}

function drawRadar() {
    const scale = 8;
    radarCtx.fillStyle = '#071019';
    radarCtx.fillRect(0, 0, radar.width, radar.height);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (!isWall(c, r)) continue;
            radarCtx.fillStyle = '#24455e';
            radarCtx.fillRect(c * scale, r * scale, scale, scale);
        }
    }
    radarCtx.strokeStyle = 'rgba(230, 240, 250, 0.35)';
    radarCtx.lineWidth = 1;
    radarCtx.strokeRect(
        camera.x / CELL * scale + 0.5,
        camera.y / CELL * scale + 0.5,
        (VIEW_W / CELL) * scale - 1,
        (VIEW_H / CELL) * scale - 1
    );
    for (const f of flags) {
        if (f.taken) continue;
        radarCtx.fillStyle = f.lucky ? '#66bb6a' : '#ffcf3f';
        radarCtx.fillRect(f.c * scale + 2, f.r * scale + 2, scale - 4, scale - 4);
    }
    for (const e of enemies) {
        radarCtx.fillStyle = e.stun > 0 ? '#b0bec5' : '#ef5350';
        radarCtx.fillRect((e.x / CELL) * scale - 2, (e.y / CELL) * scale - 2, 5, 5);
    }
    radarCtx.fillStyle = '#4fc3f7';
    radarCtx.fillRect((car.x / CELL) * scale - 2, (car.y / CELL) * scale - 2, 5, 5);
}

function draw() {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = '#071019';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    drawMaze();
    for (const f of flags) drawFlag(f);
    for (const e of enemies) drawEnemyCar(e);
    if (state !== 'dying' || Math.floor(deathTimer * 8) % 2 === 0) {
        drawCarShape(car.x, car.y, car.angle, '#4fc3f7', '#0d3c55');
    }
    // the screen hangs over the cars driving through it
    for (const s of smokes) drawSmoke(s);
    ctx.restore();

    if (state === 'dying') drawBanner('CRASH!', `${lives} ${lives === 1 ? 'car' : 'cars'} left`);
    if (state === 'levelclear') drawBanner('ROUND CLEAR', `Fuel bonus ${Math.floor(fuel) * FUEL_BONUS_PER_UNIT}`);

    drawRadar();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    flagsEl.textContent = String(flagsLeft());
    fuelEl.textContent = String(Math.floor(fuel));
    bestEl.textContent = String(best);
    const pct = clamp((fuel / FUEL_MAX) * 100, 0, 100);
    fuelBar.style.width = `${pct}%`;
    fuelBar.classList.toggle('low', fuel <= FUEL_MAX * 0.25);
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

const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];

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
    if (LEFT_KEYS.includes(e.key)) setWant(-1, 0);
    else if (RIGHT_KEYS.includes(e.key)) setWant(1, 0);
    else if (UP_KEYS.includes(e.key)) setWant(0, -1);
    else if (DOWN_KEYS.includes(e.key)) setWant(0, 1);
    else return;
    e.preventDefault();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = null;

function frame(now) {
    if (lastTime === null) lastTime = now;
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    if (autoStep) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function loadBest() {
    try {
        const stored = Number(window.localStorage.getItem(BEST_KEY));
        return Number.isFinite(stored) && stored > 0 ? stored : 0;
    } catch (err) {
        return 0;
    }
}

best = loadBest();
flags = flagsForRound(level);
resetPositions();
updateHud();
showOverlay('RALLY-X', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
