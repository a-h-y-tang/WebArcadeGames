// ---------------------------------------------------------------------------
// Rally-X — a scrolling maze chase on an HTML5 canvas.
//
// You drive a rally car through a maze that is larger than the window,
// collecting ten checkpoint flags before the tank runs dry while red pursuit
// cars hunt you. Your only weapon is the smoke screen: a puff of exhaust that
// spins out any pursuer that drives into it.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing, and every random
// choice comes from a seeded generator rather than Math.random.
// ---------------------------------------------------------------------------

// --- World ---------------------------------------------------------------
const TILE = 32;
const COLS = 21;
const ROWS = 17;
const WORLD_W = COLS * TILE;   // 672
const WORLD_H = ROWS * TILE;   // 544
const CANVAS_W = 560;
const CANVAS_H = 460;
const RADAR_SCALE = 0.25;
const RADAR_W = Math.round(WORLD_W * RADAR_SCALE);  // 168
const RADAR_H = Math.round(WORLD_H * RADAR_SCALE);  // 136

// The maze is a lattice of pillars on even rows/columns, grown a tile at a
// time. Growth is confined to this box so the outer ring of corridors (row 1,
// row ROWS-2, column 1, column COLS-2) always stays open all the way round.
const GROW_MIN_R = 2, GROW_MAX_R = ROWS - 3;
const GROW_MIN_C = 2, GROW_MAX_C = COLS - 3;
const GROW_CHANCE = 0.62;

const START_R = 1, START_C = 1;

// --- Cars ----------------------------------------------------------------
const PLAYER_SPEED = 96;       // px/s — 3 tiles a second
const ENEMY_BASE = 74;
const ENEMY_STEP = 4;          // per level
const ENEMY_CAP = 90;          // always a shade slower than the player
const ENEMY_BASE_COUNT = 2;
const ENEMY_MAX_COUNT = 5;
const CRASH_DIST = 22;
const CAR_LEN = 22, CAR_WID = 15;

// --- Flags ---------------------------------------------------------------
const FLAGS_PER_LEVEL = 10;
const FLAG_POINTS = 100;
const FLAG_PICKUP = 18;
const FLAG_MIN_DIST = 5;       // tiles from the start tile
const ENEMY_MIN_DIST = 6.5;    // tiles from the start tile

// --- Smoke ---------------------------------------------------------------
const SMOKE_COST = 6;
const SMOKE_LIFE = 4;
const SMOKE_RADIUS = 34;
const SMOKE_MAX = 8;
const SPIN_TIME = 2.5;

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const FUEL_MAX = 100;
const FUEL_DRAIN = 2;          // units per second — a 50 second tank
const FUEL_BONUS = 5;          // points per unit left when a level is cleared
const DEATH_PAUSE = 1.2;
const CLEAR_PAUSE = 1.6;

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
const rctx = radar.getContext('2d');
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
let state, score, best, lives, level, fuel, flagMultiplier, timer, elapsed;
let grid, flags, enemies, smokes, enemyStarts;
let rng;
let chaseNoise = 0.2;   // fraction of pursuer turns that are random
let camera = { x: 0, y: 0 };

const player = makeCar(START_R, START_C, PLAYER_SPEED);

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffled(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// ---------------------------------------------------------------------------
// Maze
// ---------------------------------------------------------------------------

function isWall(r, c) {
    if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return true;
    return grid[r][c] === 1;
}

function openFrom(r, c, dir) {
    return !isWall(r + dir.y, c + dir.x);
}

function centerOf(r, c) {
    return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
}

// Flood fill over open tiles: the maze is only usable if every one of them can
// be reached from any other, so a wall that would seal off a pocket is undone.
function allOpenConnected(g) {
    let total = 0, start = null;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (g[r][c] === 0) {
                total++;
                if (!start) start = [r, c];
            }
        }
    }
    if (!start) return false;
    const seen = new Set([start.join(',')]);
    const queue = [start];
    while (queue.length) {
        const [r, c] = queue.shift();
        for (const d of DIRS) {
            const nr = r + d.y, nc = c + d.x;
            if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
            if (g[nr][nc] === 1) continue;
            const key = `${nr},${nc}`;
            if (seen.has(key)) continue;
            seen.add(key);
            queue.push([nr, nc]);
        }
    }
    return seen.size === total;
}

function generateMaze() {
    const g = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    for (let c = 0; c < COLS; c++) { g[0][c] = 1; g[ROWS - 1][c] = 1; }
    for (let r = 0; r < ROWS; r++) { g[r][0] = 1; g[r][COLS - 1] = 1; }

    const pillars = [];
    for (let r = GROW_MIN_R; r <= GROW_MAX_R; r += 2) {
        for (let c = GROW_MIN_C; c <= GROW_MAX_C; c += 2) {
            g[r][c] = 1;
            pillars.push([r, c]);
        }
    }

    // Grow each pillar by one tile where that still leaves the maze connected.
    // Growth only ever targets an even/odd tile, so every odd/odd tile — the
    // start tile among them — is guaranteed to stay open.
    for (const [r, c] of pillars) {
        if (rng() > GROW_CHANCE) continue;
        for (const d of shuffled(DIRS)) {
            const tr = r + d.y, tc = c + d.x;
            if (tr < GROW_MIN_R || tr > GROW_MAX_R) continue;
            if (tc < GROW_MIN_C || tc > GROW_MAX_C) continue;
            if (g[tr][tc] === 1) continue;
            g[tr][tc] = 1;
            if (allOpenConnected(g)) break;
            g[tr][tc] = 0;
        }
    }
    return g;
}

function openTiles() {
    const out = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) if (grid[r][c] === 0) out.push({ r, c });
    }
    return out;
}

function tileDist(a, b) {
    return Math.hypot(a.r - b.r, a.c - b.c);
}

// ---------------------------------------------------------------------------
// Cars
// ---------------------------------------------------------------------------

function makeCar(r, c, speed) {
    const p = centerOf(r, c);
    return {
        r, c, nr: r, nc: c, t: 0,
        dir: { x: 0, y: 0 },
        want: { x: 0, y: 0 },
        x: p.x, y: p.y,
        moving: false,
        spin: 0,
        speed,
    };
}

function placeAt(car, r, c) {
    car.r = car.nr = r;
    car.c = car.nc = c;
    car.t = 0;
    car.moving = false;
    car.dir = { x: 0, y: 0 };
    syncPos(car);
    return car;
}

function syncPos(car) {
    const a = centerOf(car.r, car.c);
    const b = centerOf(car.nr, car.nc);
    car.x = a.x + (b.x - a.x) * car.t;
    car.y = a.y + (b.y - a.y) * car.t;
}

function startMove(car, dir) {
    car.dir = { x: dir.x, y: dir.y };
    car.nr = car.r + dir.y;
    car.nc = car.c + dir.x;
    car.t = 0;
    car.moving = true;
}

// Drive `car` for dt seconds. `chooser` is asked for a direction whenever the
// car reaches a tile centre (and while it is standing still), and may return
// null to leave it parked.
function driveCar(car, dt, chooser) {
    if (!car.moving) {
        const d = chooser(car);
        if (!d || !openFrom(car.r, car.c, d)) {
            car.dir = { x: 0, y: 0 };
            syncPos(car);
            return;
        }
        startMove(car, d);
    }

    let dist = car.speed * dt;
    while (dist > 0 && car.moving) {
        const remain = (1 - car.t) * TILE;
        if (dist < remain) {
            car.t += dist / TILE;
            dist = 0;
        } else {
            dist -= remain;
            car.r = car.nr;
            car.c = car.nc;
            car.t = 0;
            car.moving = false;
            const d = chooser(car);
            if (d && openFrom(car.r, car.c, d)) startMove(car, d);
            else car.dir = { x: 0, y: 0 };
        }
    }
    syncPos(car);
}

function isDir(a, b) {
    return a.x === b.x && a.y === b.y;
}

function playerChoice(car) {
    if ((car.want.x || car.want.y) && openFrom(car.r, car.c, car.want)) return car.want;
    if ((car.dir.x || car.dir.y) && openFrom(car.r, car.c, car.dir)) return car.dir;
    return null;
}

// A pursuer takes the turn that closes the gap, avoiding a reverse unless the
// corridor is a dead end — with a dash of noise so four cars do not all follow
// the same line.
function enemyChoice(car) {
    const opts = DIRS.filter((d) => openFrom(car.r, car.c, d));
    if (!opts.length) return null;
    const back = { x: -car.dir.x, y: -car.dir.y };
    let cand = opts.filter((d) => !isDir(d, back));
    if (!cand.length) cand = opts;
    if (rng() < chaseNoise) return cand[Math.floor(rng() * cand.length)];

    let bestDir = cand[0], bestD = Infinity;
    for (const d of cand) {
        const p = centerOf(car.r + d.y, car.c + d.x);
        const dist = Math.hypot(p.x - player.x, p.y - player.y);
        if (dist < bestD) { bestD = dist; bestDir = d; }
    }
    return bestDir;
}

// ---------------------------------------------------------------------------
// Level setup
// ---------------------------------------------------------------------------

function enemyCountFor(n) {
    return Math.min(ENEMY_BASE_COUNT + n, ENEMY_MAX_COUNT);
}

function enemySpeedFor(n) {
    return Math.min(ENEMY_BASE + (n - 1) * ENEMY_STEP, ENEMY_CAP);
}

function buildLevel(n) {
    level = n;
    rng = mulberry32(n * 7919 + 13);
    grid = generateMaze();

    const start = { r: START_R, c: START_C };
    const tiles = openTiles();

    const flagSpots = shuffled(tiles.filter((t) => tileDist(t, start) >= FLAG_MIN_DIST));
    flags = flagSpots.slice(0, FLAGS_PER_LEVEL).map((t) => ({ r: t.r, c: t.c, special: false }));
    if (flags.length) flags[Math.floor(rng() * flags.length)].special = true;

    const spawnSpots = shuffled(tiles.filter((t) => tileDist(t, start) >= ENEMY_MIN_DIST));
    enemyStarts = spawnSpots.slice(0, enemyCountFor(n));

    resetCars();
    flagMultiplier = 1;
    fuel = FUEL_MAX;
    smokes = [];
    updateCamera();
    updateHud();
}

function resetCars() {
    placeAt(player, START_R, START_C);
    player.want = { x: 0, y: 0 };
    const speed = enemySpeedFor(level);
    enemies = enemyStarts.map((t) => makeCar(t.r, t.c, speed));
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    elapsed = 0;
    buildLevel(1);
    state = 'running';
    hideOverlay();
    updateHud();
}

function respawn() {
    resetCars();
    fuel = FUEL_MAX;
    smokes = [];
    state = 'running';
    updateCamera();
    updateHud();
}

function nextLevel() {
    buildLevel(level + 1);
    state = 'running';
}

function loseLife() {
    lives--;
    smokes = [];
    if (lives <= 0) {
        lives = 0;
        state = 'over';
        if (score > best) {
            best = score;
            try { localStorage.setItem('rallyx-best', String(best)); } catch (e) { /* ignore */ }
        }
        showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space to race again');
    } else {
        state = 'dying';
        timer = DEATH_PAUSE;
    }
    updateHud();
}

function clearLevel() {
    score += Math.round(fuel) * FUEL_BONUS;
    state = 'levelclear';
    timer = CLEAR_PAUSE;
    updateHud();
}

// ---------------------------------------------------------------------------
// Smoke
// ---------------------------------------------------------------------------

function dropSmoke() {
    if (state !== 'running') return false;
    if (fuel < SMOKE_COST) return false;
    if (smokes.length >= SMOKE_MAX) return false;
    fuel -= SMOKE_COST;
    smokes.push({ x: player.x, y: player.y, life: SMOKE_LIFE });
    updateHud();
    return true;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    elapsed += dt;

    if (state === 'dying' || state === 'levelclear') {
        timer -= dt;
        if (timer <= 0) {
            if (state === 'dying') respawn();
            else nextLevel();
        }
        return;
    }
    if (state !== 'running') return;

    // A reversal is applied immediately rather than at the next tile centre.
    if (player.moving && isDir(player.want, { x: -player.dir.x, y: -player.dir.y })) {
        const r = player.r, c = player.c;
        player.r = player.nr; player.c = player.nc;
        player.nr = r; player.nc = c;
        player.t = 1 - player.t;
        player.dir = { x: player.want.x, y: player.want.y };
    }

    driveCar(player, dt, playerChoice);
    collectFlags();
    if (state !== 'running') return;   // the last flag cleared the level

    for (let i = smokes.length - 1; i >= 0; i--) {
        smokes[i].life -= dt;
        if (smokes[i].life <= 0) smokes.splice(i, 1);
    }

    for (const e of enemies) {
        if (e.spin > 0) {
            e.spin = Math.max(0, e.spin - dt);
            syncPos(e);
        } else {
            driveCar(e, dt, enemyChoice);
            for (const s of smokes) {
                if (Math.hypot(e.x - s.x, e.y - s.y) < SMOKE_RADIUS) {
                    e.spin = SPIN_TIME;
                    break;
                }
            }
        }
    }

    fuel -= FUEL_DRAIN * dt;
    if (fuel <= 0) {
        fuel = 0;
        updateCamera();
        loseLife();
        return;
    }

    for (const e of enemies) {
        if (e.spin > 0) continue;
        if (Math.hypot(e.x - player.x, e.y - player.y) < CRASH_DIST) {
            updateCamera();
            loseLife();
            return;
        }
    }

    updateCamera();
    updateHud();
}

function collectFlags() {
    for (let i = flags.length - 1; i >= 0; i--) {
        const f = flags[i];
        const p = centerOf(f.r, f.c);
        if (Math.hypot(player.x - p.x, player.y - p.y) > FLAG_PICKUP) continue;
        flags.splice(i, 1);
        score += FLAG_POINTS * flagMultiplier;
        if (f.special) flagMultiplier = 2;
    }
    if (!flags.length && state === 'running') clearLevel();
}

function updateCamera() {
    camera.x = Math.max(0, Math.min(WORLD_W - CANVAS_W, player.x - CANVAS_W / 2));
    camera.y = Math.max(0, Math.min(WORLD_H - CANVAS_H, player.y - CANVAS_H / 2));
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
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    flagsEl.textContent = String(flags.length);
    fuelEl.textContent = String(Math.max(0, Math.round(fuel)));
    fuelEl.classList.toggle('low', fuel < 20);
    fuelBar.style.width = `${Math.max(0, Math.min(100, (fuel / FUEL_MAX) * 100))}%`;
    bestEl.textContent = String(best);
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
// Drawing
// ---------------------------------------------------------------------------

function draw() {
    ctx.fillStyle = '#0a0f18';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.save();
    ctx.translate(-Math.round(camera.x), -Math.round(camera.y));

    drawMaze();
    for (const f of flags) drawFlag(f);
    for (const s of smokes) drawSmoke(s);
    for (const e of enemies) drawCar(e, '#ef5350', '#ffcdd2');
    if (state !== 'dying' || Math.floor(elapsed * 10) % 2 === 0) {
        drawCar(player, '#4fc3f7', '#e1f5fe');
    }

    ctx.restore();
    drawBanner();
    drawRadar();
}

// The text shown across the play field between lives and between levels. It is
// derived from the state rather than stored, so drawing stays a pure function
// of the simulation.
function bannerText() {
    if (state === 'dying') return lives > 0 ? 'CRASH!' : '';
    if (state === 'levelclear') return `LEVEL ${level} CLEAR`;
    return '';
}

function drawBanner() {
    const text = bannerText();
    if (!text) return;
    const sub = state === 'levelclear' ? `Fuel bonus ${Math.round(fuel) * FUEL_BONUS}` : `${lives} car${lives === 1 ? '' : 's'} left`;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(6, 9, 15, 0.72)';
    ctx.fillRect(0, CANVAS_H / 2 - 44, CANVAS_W, 88);
    ctx.fillStyle = state === 'levelclear' ? '#ffd54f' : '#ef5350';
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2 - 2);
    ctx.fillStyle = '#7d90a8';
    ctx.font = '14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(sub, CANVAS_W / 2, CANVAS_H / 2 + 24);
    ctx.restore();
}

function drawMaze() {
    const x0 = Math.max(0, Math.floor(camera.x / TILE) - 1);
    const x1 = Math.min(COLS - 1, Math.ceil((camera.x + CANVAS_W) / TILE));
    const y0 = Math.max(0, Math.floor(camera.y / TILE) - 1);
    const y1 = Math.min(ROWS - 1, Math.ceil((camera.y + CANVAS_H) / TILE));

    for (let r = y0; r <= y1; r++) {
        for (let c = x0; c <= x1; c++) {
            const x = c * TILE, y = r * TILE;
            if (grid[r][c] === 1) {
                ctx.fillStyle = '#243b57';
                ctx.fillRect(x, y, TILE, TILE);
                ctx.fillStyle = '#2f4c6e';
                ctx.fillRect(x, y, TILE, 4);
                ctx.fillStyle = '#16273a';
                ctx.fillRect(x, y + TILE - 3, TILE, 3);
            } else {
                ctx.fillStyle = (r + c) % 2 === 0 ? '#101823' : '#0d141d';
                ctx.fillRect(x, y, TILE, TILE);
            }
        }
    }
}

function drawFlag(f) {
    const p = centerOf(f.r, f.c);
    const flash = f.special && Math.floor(elapsed * 6) % 2 === 0;
    ctx.strokeStyle = '#cfd8dc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 5, p.y + 9);
    ctx.lineTo(p.x - 5, p.y - 9);
    ctx.stroke();
    ctx.fillStyle = f.special ? (flash ? '#ff80ab' : '#f06292') : '#ffd54f';
    ctx.beginPath();
    ctx.moveTo(p.x - 4, p.y - 9);
    ctx.lineTo(p.x + 9, p.y - 4.5);
    ctx.lineTo(p.x - 4, p.y);
    ctx.closePath();
    ctx.fill();
}

// A puff is three overlapping blobs that bloom and thin out with age, so smoke
// reads as smoke rather than as a grey ball.
const PUFF_OFFSETS = [
    { x: 0, y: 0, r: 1 },
    { x: -0.5, y: -0.35, r: 0.7 },
    { x: 0.45, y: 0.3, r: 0.6 },
];

function drawSmoke(s) {
    const age = 1 - s.life / SMOKE_LIFE;
    const radius = 9 + age * 13;
    const alpha = 0.4 * Math.min(1, s.life / 1.2);
    for (const p of PUFF_OFFSETS) {
        ctx.fillStyle = `rgba(206, 224, 240, ${alpha * p.r})`;
        ctx.beginPath();
        ctx.arc(s.x + p.x * radius, s.y + p.y * radius, radius * p.r, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawCar(car, body, glass) {
    let angle = 0;
    if (car.dir.x || car.dir.y) angle = Math.atan2(car.dir.y, car.dir.x);
    if (car.spin > 0) angle = elapsed * 12;

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(angle);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    roundRect(-CAR_LEN / 2 + 1, -CAR_WID / 2 + 2, CAR_LEN, CAR_WID, 4);
    ctx.fill();

    ctx.fillStyle = body;
    roundRect(-CAR_LEN / 2, -CAR_WID / 2, CAR_LEN, CAR_WID, 4);
    ctx.fill();

    ctx.fillStyle = glass;
    roundRect(-1, -CAR_WID / 2 + 3, 7, CAR_WID - 6, 2);
    ctx.fill();

    ctx.fillStyle = '#0b1119';
    ctx.fillRect(-CAR_LEN / 2 + 3, -CAR_WID / 2 - 1.5, 5, 3);
    ctx.fillRect(-CAR_LEN / 2 + 3, CAR_WID / 2 - 1.5, 5, 3);
    ctx.fillRect(CAR_LEN / 2 - 8, -CAR_WID / 2 - 1.5, 5, 3);
    ctx.fillRect(CAR_LEN / 2 - 8, CAR_WID / 2 - 1.5, 5, 3);

    ctx.restore();
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawRadar() {
    rctx.fillStyle = '#0a0f18';
    rctx.fillRect(0, 0, RADAR_W, RADAR_H);

    const s = RADAR_SCALE;
    rctx.fillStyle = '#22344a';
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (grid[r][c] === 1) rctx.fillRect(c * TILE * s, r * TILE * s, TILE * s, TILE * s);
        }
    }

    for (const f of flags) {
        const p = centerOf(f.r, f.c);
        rctx.fillStyle = f.special ? '#f06292' : '#ffd54f';
        rctx.fillRect(p.x * s - 2, p.y * s - 2, 4, 4);
    }

    for (const e of enemies) {
        rctx.fillStyle = e.spin > 0 ? '#ffab91' : '#ef5350';
        rctx.beginPath();
        rctx.arc(e.x * s, e.y * s, 2.5, 0, Math.PI * 2);
        rctx.fill();
    }

    rctx.fillStyle = '#4fc3f7';
    rctx.beginPath();
    rctx.arc(player.x * s, player.y * s, 3, 0, Math.PI * 2);
    rctx.fill();

    rctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    rctx.lineWidth = 1;
    rctx.strokeRect(camera.x * s + 0.5, camera.y * s + 0.5, CANVAS_W * s, CANVAS_H * s);
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
    const dir = KEY_DIRS[e.key];
    if (dir) {
        player.want = { x: dir.x, y: dir.y };
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
    best = parseInt(localStorage.getItem('rallyx-best') || '0', 10) || 0;
} catch (e) {
    best = 0;
}
score = 0;
lives = START_LIVES;
elapsed = 0;
buildLevel(1);
state = 'idle';
updateHud();
showOverlay('RALLY-X', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
