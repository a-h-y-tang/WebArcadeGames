// ---------------------------------------------------------------------------
// Rally-X — a scrolling maze rally about flags, fuel and a smoke screen.
//
// Drive a rally car around a course larger than the screen, collecting every
// flag before the tank runs dry. Red cars hunt you through the same maze; the
// only defence is a puff of smoke dropped behind you, which spins out any
// chaser that drives into it. A radar panel shows the whole course.
//
// Written as a single classic (non-module) script so every piece of state is
// reachable from the Playwright tests as a plain global, mirroring Lode
// Runner, Kaboom and Tetris in this repo. The whole simulation is advanced
// through `step(dt)`, so tests can run frames deterministically instead of
// leaning on requestAnimationFrame wall clocks.
// ---------------------------------------------------------------------------

// --- Canvas geometry ---
const CANVAS_W = 600;
const CANVAS_H = 360;
const VIEW_W = 440;          // scrolling maze viewport
const VIEW_H = 360;
const PANEL_X = VIEW_W;      // radar + fuel gauge live to the right of it
const PANEL_W = CANVAS_W - VIEW_W;
const TILE = 32;

// --- Driving ---
const PLAYER_SPEED = 4.0;        // cells per second
const ENEMY_SPEED_BASE = 2.8;
const ENEMY_SPEED_STEP = 0.2;    // per level
const ENEMY_SPEED_MAX = PLAYER_SPEED - 0.2;
const ENEMY_RANDOM_TURN = 0.2;   // chance a chaser takes a legal but unhelpful turn

// --- Rules ---
const START_LIVES = 3;
const FUEL_MAX = 100;
const FUEL_DRAIN = 1.8;          // per second
const FUEL_BONUS = 10;           // points per unit of fuel left when a round is cleared
const SMOKE_COST = 4;
const SMOKE_LIFE = 2.5;
const SMOKE_COOLDOWN = 0.2;
const SMOKE_RADIUS = 0.8;        // cells
const STUN_TIME = 3.0;
const CATCH_RADIUS = 0.6;        // cells
const FLAG_RADIUS = 0.55;        // cells
const FLAG_POINTS = 100;
const BEST_KEY = 'rally-x-best';

// ---------------------------------------------------------------------------
// Courses
//
// '#' wall   '.' road   'F' flag   'S' special flag
// 'P' player spawn      'E' chaser spawn
//
// Blocks are 2x2 and always separated by a road lane, so every road cell of
// every course is reachable — the test suite re-checks that with a flood fill.
// ---------------------------------------------------------------------------

const LEVELS = [
    // Course 1 — Open Field
    [
        '########################',
        '#E..F..............F..E#',
        '#.##....##....##....##.#',
        '#.##....##....##....##.#',
        '#F....................F#',
        '#....##..........##....#',
        '#....##..........##....#',
        '#............S.........#',
        '#.##.......##.......##.#',
        '#.##.......##.......##.#',
        '#......F........F......#',
        '#....##..........##....#',
        '#....##..........##....#',
        '#E....................E#',
        '#.##....##....##....##.#',
        '#.##....##....##....##.#',
        '#F........P...........F#',
        '########################',
    ],
    // Course 2 — Switchback
    [
        '########################',
        '#E........F...........E#',
        '#.##.##....##.##....##.#',
        '#.##.##....##.##....##.#',
        '#...F..............F...#',
        '#.##.......##.......##.#',
        '#.##.......##.......##.#',
        '#F...........E..S......#',
        '#....##.##....##.##....#',
        '#....##.##....##.##....#',
        '#.....................F#',
        '#.##.......##.......##.#',
        '#.##.......##.......##.#',
        '#...F..............F...#',
        '#.##....##.##....##.##.#',
        '#.##....##.##....##.##.#',
        '#P........F...........E#',
        '########################',
    ],
    // Course 3 — The Grid
    [
        '########################',
        '#E........F.....F.....E#',
        '#.##.##.##....##.##.##.#',
        '#.##.##.##....##.##.##.#',
        '#F....................F#',
        '#..........##..........#',
        '#..........##..........#',
        '#.........S............#',
        '#.##.##.##....##.##.##.#',
        '#.##.##.##....##.##.##.#',
        '#F....................F#',
        '#..........##..........#',
        '#..........##..........#',
        '#......F........F......#',
        '#.##.##.##....##.##.##.#',
        '#.##.##.##....##.##.##.#',
        '#E...........P........E#',
        '########################',
    ],
];

const WALL = '#';
const ROAD = '.';
const DIRS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let grid = [];
let COLS = 0;
let ROWS = 0;

let state = 'idle';          // idle | running | paused | gameover
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let fuel = FUEL_MAX;
let flagValue = FLAG_POINTS;

let player = { x: 1, y: 1, dir: { x: 0, y: 0 }, face: { x: 1, y: 0 }, spawn: { x: 1, y: 1 } };
let enemies = [];
let flags = [];
let smokes = [];
let camera = { x: 0, y: 0 };

let wantDir = { x: 0, y: 0 };
let smokeCooldown = 0;
let autoStep = true;
let spinTime = 0;            // drives the spinning animation of stunned chasers
let banner = null;           // { text, time } — a purely cosmetic flash, timed off the animation frame

// A seeded generator keeps chaser decisions — and therefore the tests —
// reproducible from one run to the next.
let rngState = 1;

function setSeed(n) {
    rngState = (n >>> 0) || 1;
}

function rand() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elFlags = document.getElementById('flags');
const elFuel = document.getElementById('fuel');
const elLives = document.getElementById('lives');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Course loading
// ---------------------------------------------------------------------------

function isOpen(cx, cy) {
    if (cy < 0 || cy >= ROWS || cx < 0 || cx >= COLS) return false;
    return grid[cy][cx] !== WALL;
}

/** Off-grid counts as wall, so a block at the border keeps its outer edge. */
function isWall(cx, cy) {
    if (cy < 0 || cy >= ROWS || cx < 0 || cx >= COLS) return true;
    return grid[cy][cx] === WALL;
}

function enemySpeed() {
    return Math.min(ENEMY_SPEED_BASE + ENEMY_SPEED_STEP * (level - 1), ENEMY_SPEED_MAX);
}

/** Load any rectangular course given as an array of strings. */
function loadLevelLines(lines) {
    ROWS = lines.length;
    COLS = lines[0].length;
    grid = [];
    flags = [];
    smokes = [];
    const spawns = [];
    let playerSpawn = { x: 1, y: 1 };

    for (let y = 0; y < ROWS; y++) {
        const row = [];
        for (let x = 0; x < COLS; x++) {
            const ch = lines[y][x];
            row.push(ch === WALL ? WALL : ROAD);
            if (ch === 'F') flags.push({ x, y, special: false });
            else if (ch === 'S') flags.push({ x, y, special: true });
            else if (ch === 'P') playerSpawn = { x, y };
            else if (ch === 'E') spawns.push({ x, y });
        }
        grid.push(row);
    }

    player = {
        x: playerSpawn.x,
        y: playerSpawn.y,
        dir: { x: 0, y: 0 },
        face: { x: 1, y: 0 },
        spawn: playerSpawn,
    };

    const count = Math.min(spawns.length, 1 + level);
    enemies = spawns.slice(0, count).map((s) => ({
        x: s.x,
        y: s.y,
        dir: { x: 0, y: 0 },
        face: { x: -1, y: 0 },
        spawn: s,
        stun: 0,
    }));

    flagValue = FLAG_POINTS;
    wantDir = { x: 0, y: 0 };
    smokeCooldown = 0;
    updateCamera();
}

function loadLevel(n) {
    level = n;
    loadLevelLines(LEVELS[(n - 1) % LEVELS.length]);
}

/** Put every car back on its spawn and refill the tank; flags are kept. */
function resetCars() {
    player.x = player.spawn.x;
    player.y = player.spawn.y;
    player.dir = { x: 0, y: 0 };
    player.face = { x: 1, y: 0 };
    for (const e of enemies) {
        e.x = e.spawn.x;
        e.y = e.spawn.y;
        e.dir = { x: 0, y: 0 };
        e.stun = 0;
    }
    smokes = [];
    wantDir = { x: 0, y: 0 };
    smokeCooldown = 0;
    fuel = FUEL_MAX;
    updateCamera();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    banner = null;
    setSeed(20250918);
    loadLevel(1);
    fuel = FUEL_MAX;
    state = 'running';
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function loseLife() {
    const dry = fuel <= 0;   // resetCars() refills the tank, so read the reason first
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        gameOver();
    } else {
        resetCars();
        showBanner(dry ? 'OUT OF FUEL' : 'CAR LOST');
    }
    updateHud();
}

function showBanner(text) {
    banner = { text, time: 1.6 };
}

function gameOver() {
    state = 'gameover';
    saveBest();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to race again');
}

function clearRound() {
    const bonus = Math.round(fuel) * FUEL_BONUS;
    score += bonus;
    loadLevel(level + 1);
    resetCars();
    showBanner(`COURSE CLEAR  +${bonus}`);
    updateHud();
}

function saveBest() {
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage unavailable — the score just does not persist */
        }
    }
}

// ---------------------------------------------------------------------------
// Movement
//
// Cars sit on floating-point cell coordinates and may only turn onto a
// perpendicular road at an exact cell centre. Travel is resolved centre by
// centre, so no time step — however large — can tunnel a car through a wall.
// ---------------------------------------------------------------------------

function moveEntity(e, distance, pickDir) {
    let remaining = distance;
    let guard = 0;
    while (remaining > 1e-9 && guard++ < 4096) {
        const cx = Math.round(e.x);
        const cy = Math.round(e.y);
        const atCenter = Math.abs(e.x - cx) < 1e-9 && Math.abs(e.y - cy) < 1e-9;

        if (atCenter) {
            e.dir = pickDir(e, cx, cy);
            if (!isOpen(cx + e.dir.x, cy + e.dir.y)) e.dir = { x: 0, y: 0 };
        }
        if (!e.dir.x && !e.dir.y) return;

        e.face = e.dir;
        const along = e.dir.x !== 0 ? e.x : e.y;
        const forward = e.dir.x + e.dir.y > 0;
        const target = forward ? Math.floor(along + 1e-9) + 1 : Math.ceil(along - 1e-9) - 1;
        const span = Math.abs(target - along);
        const move = Math.min(remaining, span);

        e.x += e.dir.x * move;
        e.y += e.dir.y * move;
        remaining -= move;

        if (move >= span - 1e-12) {
            // Snap exactly onto the centre just reached, so alignment checks stay crisp.
            if (e.dir.x !== 0) e.x = target;
            else e.y = target;
        }
    }
}

function playerDir(e, cx, cy) {
    if ((wantDir.x || wantDir.y) && isOpen(cx + wantDir.x, cy + wantDir.y)) {
        return { x: wantDir.x, y: wantDir.y };
    }
    return e.dir;
}

function isReverse(a, b) {
    return (a.x || a.y) && a.x === -b.x && a.y === -b.y;
}

function chaserDir(e, cx, cy) {
    const options = DIRS.filter((d) => isOpen(cx + d.x, cy + d.y));
    if (!options.length) return { x: 0, y: 0 };

    const ahead = options.filter((d) => !isReverse(d, e.dir));
    const pool = ahead.length ? ahead : options;

    if (rand() < ENEMY_RANDOM_TURN) {
        return pool[Math.floor(rand() * pool.length)];
    }
    let best = pool[0];
    let bestDist = Infinity;
    for (const d of pool) {
        const dist = Math.hypot(cx + d.x - player.x, cy + d.y - player.y);
        if (dist < bestDist) {
            bestDist = dist;
            best = d;
        }
    }
    return best;
}

function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------------------------------------------------------------------
// Smoke screen
// ---------------------------------------------------------------------------

function dropSmoke() {
    if (state !== 'running') return false;
    if (smokeCooldown > 0) return false;
    if (fuel < SMOKE_COST) return false;
    fuel -= SMOKE_COST;
    smokeCooldown = SMOKE_COOLDOWN;
    smokes.push({ x: player.x, y: player.y, life: SMOKE_LIFE });
    return true;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    spinTime += dt;
    smokeCooldown = Math.max(0, smokeCooldown - dt);

    // Fuel first: running dry is as fatal as being caught.
    fuel -= FUEL_DRAIN * dt;
    if (fuel <= 0) {
        fuel = 0;
        loseLife();
        return;
    }

    // Reversing is allowed mid-cell — that is what makes a corridor escapable.
    if (isReverse(wantDir, player.dir)) player.dir = { x: wantDir.x, y: wantDir.y };
    moveEntity(player, PLAYER_SPEED * dt, playerDir);

    const speed = enemySpeed();
    for (const e of enemies) {
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - dt);
            continue;
        }
        moveEntity(e, speed * dt, chaserDir);
    }

    // Smoke ages, then spins out anything sitting in it. Checked before
    // collisions so a chaser driving into a fresh puff spins out rather than
    // catching the player in the same frame.
    for (const s of smokes) s.life -= dt;
    smokes = smokes.filter((s) => s.life > 0);
    for (const s of smokes) {
        for (const e of enemies) {
            if (dist(e, s) < SMOKE_RADIUS) e.stun = STUN_TIME;
        }
    }

    // Flags
    let collected = 0;
    for (let i = flags.length - 1; i >= 0; i--) {
        if (dist(player, flags[i]) < FLAG_RADIUS) {
            const flag = flags.splice(i, 1)[0];
            score += flagValue;
            if (flag.special) flagValue *= 2;
            collected += 1;
        }
    }

    // Chasers
    for (const e of enemies) {
        if (e.stun <= 0 && dist(player, e) < CATCH_RADIUS) {
            loseLife();
            return;
        }
    }

    // Only a flag picked up this frame can clear a round, so a course that
    // never had any flags on it simply keeps running.
    if (collected && !flags.length) {
        clearRound();
        return;
    }

    updateCamera();
}

function setInput(dx, dy) {
    wantDir = { x: Math.sign(dx), y: Math.sign(dy) };
}

function setAutoStep(on) {
    autoStep = on;
}

// Test/debug hooks for reaching low-fuel and last-life situations directly.
function setFuel(v) {
    fuel = Math.max(0, Math.min(FUEL_MAX, v));
}

function setLives(n) {
    lives = n;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function updateCamera() {
    const worldW = COLS * TILE;
    const worldH = ROWS * TILE;
    camera.x = worldW <= VIEW_W
        ? (worldW - VIEW_W) / 2
        : clamp(player.x * TILE + TILE / 2 - VIEW_W / 2, 0, worldW - VIEW_W);
    camera.y = worldH <= VIEW_H
        ? (worldH - VIEW_H) / 2
        : clamp(player.y * TILE + TILE / 2 - VIEW_H / 2, 0, worldH - VIEW_H);
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawMaze();
    drawPanel();
}

function drawMaze() {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();

    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.translate(-Math.round(camera.x), -Math.round(camera.y));

    const x0 = Math.max(0, Math.floor(camera.x / TILE) - 1);
    const y0 = Math.max(0, Math.floor(camera.y / TILE) - 1);
    const x1 = Math.min(COLS - 1, Math.ceil((camera.x + VIEW_W) / TILE));
    const y1 = Math.min(ROWS - 1, Math.ceil((camera.y + VIEW_H) / TILE));

    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            const px = x * TILE;
            const py = y * TILE;
            if (grid[y][x] === WALL) {
                ctx.fillStyle = '#2a3a5e';
                ctx.fillRect(px, py, TILE, TILE);
                // Shade only the outside edges of a block, so neighbouring wall
                // cells read as one solid slab instead of a stack of stripes.
                if (!isWall(x, y - 1)) {
                    ctx.fillStyle = '#3d5490';
                    ctx.fillRect(px, py, TILE, 4);
                }
                if (!isWall(x, y + 1)) {
                    ctx.fillStyle = '#1b2848';
                    ctx.fillRect(px, py + TILE - 4, TILE, 4);
                }
                if (!isWall(x - 1, y)) {
                    ctx.fillStyle = '#32446f';
                    ctx.fillRect(px, py, 3, TILE);
                }
                if (!isWall(x + 1, y)) {
                    ctx.fillStyle = '#20304f';
                    ctx.fillRect(px + TILE - 3, py, 3, TILE);
                }
            } else {
                ctx.fillStyle = (x + y) % 2 === 0 ? '#121a2e' : '#0f1728';
                ctx.fillRect(px, py, TILE, TILE);
            }
        }
    }

    for (const flag of flags) drawFlag(flag);
    for (const s of smokes) drawSmoke(s);
    for (const e of enemies) drawCar(e, e.stun > 0 ? '#8d6bb5' : '#e0453f', e.stun > 0);
    drawCar(player, '#4fc3f7', false);

    ctx.restore();

    if (banner) drawBanner();
    if (state === 'running' && fuel > 0 && fuel < FUEL_MAX * 0.2) drawFuelWarning();
}

function drawBanner() {
    const fade = Math.min(1, banner.time / 0.4);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(5, 9, 20, 0.78)';
    ctx.fillRect(0, VIEW_H / 2 - 26, VIEW_W, 52);
    ctx.fillStyle = '#4fc3f7';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, VIEW_W / 2, VIEW_H / 2);
    ctx.restore();
}

function drawFuelWarning() {
    const pulse = 0.35 + 0.3 * Math.sin(spinTime * 8);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#ef5d5d';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, VIEW_W - 6, VIEW_H - 6);
    ctx.restore();
}

function drawFlag(flag) {
    const px = flag.x * TILE + TILE / 2;
    const py = flag.y * TILE + TILE / 2;
    ctx.strokeStyle = '#d8e2f5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px - 5, py - 9);
    ctx.lineTo(px - 5, py + 9);
    ctx.stroke();
    ctx.fillStyle = flag.special ? '#f2c14e' : '#6fe08a';
    ctx.beginPath();
    ctx.moveTo(px - 5, py - 9);
    ctx.lineTo(px + 9, py - 4);
    ctx.lineTo(px - 5, py + 1);
    ctx.closePath();
    ctx.fill();
    if (flag.special) {
        ctx.fillStyle = '#7a5a10';
        ctx.font = 'bold 8px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('x2', px + 0.5, py - 3.5);
    }
}

function drawSmoke(s) {
    const px = s.x * TILE + TILE / 2;
    const py = s.y * TILE + TILE / 2;
    const age = 1 - s.life / SMOKE_LIFE;
    const radius = TILE * (0.35 + 0.35 * age);
    ctx.globalAlpha = Math.max(0, 0.55 * (1 - age));
    ctx.fillStyle = '#c9d4e6';
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
}

function drawCar(car, colour, spinning) {
    const px = car.x * TILE + TILE / 2;
    const py = car.y * TILE + TILE / 2;
    const face = car.face && (car.face.x || car.face.y) ? car.face : { x: 1, y: 0 };
    const angle = spinning ? spinTime * 8 : Math.atan2(face.y, face.x);

    ctx.save();
    ctx.translate(px, py);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';     // ground shadow
    ctx.beginPath();
    ctx.ellipse(1, 2, 12, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(angle);

    ctx.fillStyle = '#0a0f1c';                 // wheels, drawn under the body
    ctx.fillRect(-9, -10, 7, 4);
    ctx.fillRect(-9, 6, 7, 4);
    ctx.fillRect(3, -10, 7, 4);
    ctx.fillRect(3, 6, 7, 4);

    ctx.fillStyle = colour;
    roundRect(-12, -8, 24, 16, 5);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';   // highlight along the roof
    roundRect(-9, -6, 18, 4, 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(8, 14, 26, 0.7)';        // windscreen
    roundRect(1, -6, 7, 12, 2);
    ctx.fill();

    ctx.fillStyle = '#ffe9a8';                     // headlights
    ctx.fillRect(10, -6, 3, 3);
    ctx.fillRect(10, 3, 3, 3);

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

function drawPanel() {
    ctx.fillStyle = '#0c1424';
    ctx.fillRect(PANEL_X, 0, PANEL_W, CANVAS_H);
    ctx.fillStyle = '#1d2a47';
    ctx.fillRect(PANEL_X, 0, 2, CANVAS_H);

    ctx.fillStyle = '#7f8ca8';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('RADAR', PANEL_X + 14, 26);

    // Radar: the whole course, scaled to fit the panel.
    const pad = 14;
    const radarW = PANEL_W - pad * 2;
    const scale = radarW / (COLS * TILE);
    const radarH = ROWS * TILE * scale;
    const rx = PANEL_X + pad;
    const ry = 34;

    ctx.fillStyle = '#060b16';
    ctx.fillRect(rx, ry, radarW, radarH);

    ctx.fillStyle = '#1c2b4a';
    const cell = TILE * scale;
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (grid[y][x] === WALL) ctx.fillRect(rx + x * cell, ry + y * cell, cell, cell);
        }
    }

    for (const flag of flags) {
        ctx.fillStyle = flag.special ? '#f2c14e' : '#6fe08a';
        ctx.fillRect(rx + flag.x * cell - 1, ry + flag.y * cell - 1, 3, 3);
    }
    for (const e of enemies) {
        ctx.fillStyle = e.stun > 0 ? '#8d6bb5' : '#e0453f';
        ctx.fillRect(rx + e.x * cell - 1.5, ry + e.y * cell - 1.5, 4, 4);
    }
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(rx + player.x * cell - 2, ry + player.y * cell - 2, 5, 5);

    // Viewport outline on the radar
    ctx.strokeStyle = 'rgba(210, 226, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
        rx + Math.max(0, camera.x) * scale,
        ry + Math.max(0, camera.y) * scale,
        Math.min(VIEW_W, COLS * TILE) * scale,
        Math.min(VIEW_H, ROWS * TILE) * scale,
    );

    // Fuel gauge
    const gy = ry + radarH + 28;
    ctx.fillStyle = '#7f8ca8';
    ctx.fillText('FUEL', rx, gy - 8);
    ctx.fillStyle = '#060b16';
    ctx.fillRect(rx, gy, radarW, 14);
    const ratio = fuel / FUEL_MAX;
    ctx.fillStyle = ratio > 0.5 ? '#6fe08a' : ratio > 0.2 ? '#f2c14e' : '#ef5d5d';
    ctx.fillRect(rx + 1, gy + 1, Math.max(0, (radarW - 2) * ratio), 12);

    // Remaining cars
    ctx.fillStyle = '#7f8ca8';
    ctx.fillText('CARS', rx, gy + 40);
    for (let i = 0; i < lives; i++) {
        ctx.fillStyle = '#4fc3f7';
        roundRect(rx + i * 16, gy + 48, 12, 8, 2);
        ctx.fill();
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elFlags.textContent = String(flags.length);
    elFuel.textContent = String(Math.round(fuel));
    elLives.textContent = String(lives);
    elBest.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const MOVE_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's']);
const heldKeys = new Set();

function refreshHeldInput() {
    const left = heldKeys.has('arrowleft') || heldKeys.has('a');
    const right = heldKeys.has('arrowright') || heldKeys.has('d');
    const up = heldKeys.has('arrowup') || heldKeys.has('w');
    const down = heldKeys.has('arrowdown') || heldKeys.has('s');
    // Horizontal wins when both axes are held, so diagonal input never stalls the car.
    if (left || right) setInput((right ? 1 : 0) - (left ? 1 : 0), 0);
    else setInput(0, (down ? 1 : 0) - (up ? 1 : 0));
}

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();

    if (key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else if (state === 'running') dropSmoke();
        return;
    }
    if (key === 'p' || key === 'escape') {
        e.preventDefault();
        togglePause();
        return;
    }
    if (MOVE_KEYS.has(key)) {
        e.preventDefault();
        heldKeys.add(key);
        refreshHeldInput();
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (heldKeys.delete(key)) refreshHeldInput();
});

window.addEventListener('blur', () => {
    heldKeys.clear();
    refreshHeldInput();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same step() the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;

function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;   // clamp after tab switches / long frames
    if (autoStep && state === 'running') step(dt);
    else spinTime += dt;
    if (banner) {
        banner.time -= dt;
        if (banner.time <= 0) banner = null;
    }
    draw();
    updateHud();
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
loadLevel(1);
updateHud();
requestAnimationFrame(frame);
