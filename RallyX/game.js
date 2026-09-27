'use strict';

// ---------------------------------------------------------------- Constants

const TILE = 40;                       // world tile size in px
const COLS = 21;                       // odd, so the DFS carver fits exactly
const ROWS = 21;
const WORLD_W = COLS * TILE;
const WORLD_H = ROWS * TILE;

const VIEW_W = 560;                    // visible slice of the world
const VIEW_H = 420;
const RADAR_W = 180;
const RADAR_H = 180;

const CAR_SPEED = 130;                 // px/s
const ENEMY_SPEED = 100;               // px/s at level 1
const ENEMY_SPEED_PER_LEVEL = 6;
const TURN_SNAP = 7;                   // px of slack allowed when turning

const FUEL_MAX = 100;
const FUEL_BURN = 2.2;                 // fuel per second
const LOW_FUEL = 25;
const SMOKE_COST = 6;
const SMOKE_LIFE = 3;                  // seconds a cloud lingers
const SMOKE_RADIUS = 18;
const STUN_TIME = 3;                   // seconds a chaser spins out

const FLAG_COUNT = 8;
const FLAG_POINTS = 100;
const FUEL_BONUS = 10;                 // points per unit of fuel left over
const FLAG_MIN_TILES = 4;              // keep flags away from the start tile
const PICKUP_DIST = 20;
const HIT_DIST = 20;

const START_LIVES = 3;
const MIN_ENEMIES = 2;
const MAX_ENEMIES = 5;

const BEST_KEY = 'rally-x-best';

const DIRS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
];

// ------------------------------------------------------------------- State

let state = 'idle';                    // idle | running | paused | over
let score = 0;
let best = 0;
let level = 1;
let lives = START_LIVES;
let fuel = FUEL_MAX;
let doubleFlags = false;               // set once the special flag is taken

let maze = [];                         // maze[y][x] — 1 wall, 0 open
let car = { x: 0, y: 0, dir: { x: 0, y: 0 }, nextDir: { x: 0, y: 0 } };
let enemies = [];
let flags = [];
let smokes = [];
let camera = { x: 0, y: 0 };

let carStart = { cx: 1, cy: 1 };
let enemyStarts = [];
let rng = mulberry32(1);

// ------------------------------------------------------------------- Setup

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const radar = document.getElementById('radar');
const rctx = radar.getContext('2d');

const el = {
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    flags: document.getElementById('flags'),
    fuelBar: document.getElementById('fuel-bar'),
    fuelPct: document.getElementById('fuel-pct'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayScore: document.getElementById('overlay-score'),
    overlaySub: document.getElementById('overlay-sub'),
    startBtn: document.getElementById('btn-start'),
};

// --------------------------------------------------------------- Utilities

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function isWall(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return true;
    return maze[cy][cx] === 1;
}

function tileCenter(cx, cy) {
    return { x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 };
}

function tileOf(actor) {
    return { cx: Math.floor(actor.x / TILE), cy: Math.floor(actor.y / TILE) };
}

// ------------------------------------------------------------ Maze carving

// Randomised depth-first search over the odd cells, then a pass that knocks
// out extra walls so the maze has loops instead of nothing but dead ends.
function generateMaze(seed) {
    rng = mulberry32(seed);

    maze = [];
    for (let y = 0; y < ROWS; y++) maze.push(new Array(COLS).fill(1));

    const stack = [[1, 1]];
    maze[1][1] = 0;
    while (stack.length) {
        const [cx, cy] = stack[stack.length - 1];
        const options = [];
        for (const d of DIRS) {
            const nx = cx + d.x * 2;
            const ny = cy + d.y * 2;
            if (nx > 0 && ny > 0 && nx < COLS - 1 && ny < ROWS - 1 && maze[ny][nx] === 1) {
                options.push([nx, ny, cx + d.x, cy + d.y]);
            }
        }
        if (!options.length) {
            stack.pop();
            continue;
        }
        const [nx, ny, wx, wy] = options[Math.floor(rng() * options.length)];
        maze[wy][wx] = 0;
        maze[ny][nx] = 0;
        stack.push([nx, ny]);
    }

    // Carve loops: any interior wall with open tiles on both sides may go.
    for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) {
            if (maze[y][x] === 0) continue;
            const horizontal = maze[y][x - 1] === 0 && maze[y][x + 1] === 0;
            const vertical = maze[y - 1][x] === 0 && maze[y + 1][x] === 0;
            if ((horizontal || vertical) && rng() < 0.18) maze[y][x] = 0;
        }
    }
}

function openTiles() {
    const list = [];
    for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) {
            if (maze[y][x] === 0) list.push({ cx: x, cy: y });
        }
    }
    return list;
}

// ------------------------------------------------------- Level composition

function buildLevel() {
    generateMaze(level * 7919 + 13);

    const open = openTiles();

    // Start the player as near the middle of the world as the maze allows.
    const mid = (COLS - 1) / 2;
    carStart = open.reduce((bestTile, t) => {
        const d = Math.hypot(t.cx - mid, t.cy - mid);
        const bd = Math.hypot(bestTile.cx - mid, bestTile.cy - mid);
        return d < bd ? t : bestTile;
    }, open[0]);

    // Chase cars wait in the far corners of the maze.
    const byDistance = open
        .map((t) => ({ ...t, d: Math.hypot(t.cx - carStart.cx, t.cy - carStart.cy) }))
        .sort((a, b) => b.d - a.d);
    const count = Math.min(MAX_ENEMIES, MIN_ENEMIES + level - 1);
    enemyStarts = byDistance.slice(0, count).map((t) => ({ cx: t.cx, cy: t.cy }));

    // Flags go anywhere that is not right on top of the player.
    const taken = new Set(enemyStarts.map((t) => t.cx + ',' + t.cy));
    const candidates = open.filter((t) => {
        if (taken.has(t.cx + ',' + t.cy)) return false;
        return Math.hypot(t.cx - carStart.cx, t.cy - carStart.cy) >= FLAG_MIN_TILES;
    });
    flags = [];
    const pool = candidates.slice();
    for (let i = 0; i < FLAG_COUNT && pool.length; i++) {
        const pick = pool.splice(Math.floor(rng() * pool.length), 1)[0];
        const c = tileCenter(pick.cx, pick.cy);
        flags.push({ x: c.x, y: c.y, special: false });
    }
    if (flags.length) flags[Math.floor(rng() * flags.length)].special = true;

    doubleFlags = false;
    fuel = FUEL_MAX;
    smokes = [];
    resetPositions();
}

function resetPositions() {
    placeCarAt(carStart.cx, carStart.cy);
    car.dir = { x: 0, y: 0 };
    car.nextDir = { x: 0, y: 0 };

    enemies = enemyStarts.map((t) => {
        const c = tileCenter(t.cx, t.cy);
        return { x: c.x, y: c.y, tx: c.x, ty: c.y, dir: { x: 0, y: 0 }, stun: 0 };
    });

    updateCamera();
}

function placeCarAt(cx, cy) {
    const c = tileCenter(cx, cy);
    car.x = c.x;
    car.y = c.y;
}

function updateCamera() {
    camera.x = clamp(car.x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
    camera.y = clamp(car.y - VIEW_H / 2, 0, WORLD_H - VIEW_H);
}

// --------------------------------------------------------- Game life cycle

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    buildLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    score += Math.round(fuel) * FUEL_BONUS;
    level++;
    buildLevel();
    updateHud();
}

function wreck() {
    lives--;
    if (lives <= 0) {
        lives = 0;
        endGame();
        return;
    }
    fuel = FUEL_MAX;
    smokes = [];
    resetPositions();
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (e) {
            /* storage unavailable — the score simply is not kept */
        }
    }
    showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space to race again', 'Play Again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume', 'Restart');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ------------------------------------------------------------------- Input

function setDirection(dx, dy) {
    car.nextDir = { x: dx, y: dy };
}

function dropSmoke() {
    if (state !== 'running') return;
    if (fuel < SMOKE_COST) return;
    fuel -= SMOKE_COST;
    smokes.push({
        x: car.x - car.dir.x * (TILE / 3),
        y: car.y - car.dir.y * (TILE / 3),
        life: SMOKE_LIFE,
    });
    updateHud();
}

// ------------------------------------------------------------- Simulation

function step(dt) {
    if (state !== 'running') return;
    dt = Math.min(dt, 0.05);

    moveCar(dt);
    updateSmokes(dt);
    moveEnemies(dt);
    collectFlags();

    fuel = Math.max(0, fuel - FUEL_BURN * dt);
    if (fuel <= 0) {
        wreck();
        updateHud();
        return;
    }

    if (checkCrash()) {
        wreck();
        updateHud();
        return;
    }

    if (!flags.length) nextLevel();

    updateCamera();
    updateHud();
}

function moveCar(dt) {
    const { cx, cy } = tileOf(car);
    const c = tileCenter(cx, cy);
    const next = car.nextDir;

    if ((next.x || next.y) && (next.x !== car.dir.x || next.y !== car.dir.y)) {
        const aligned = next.x !== 0
            ? Math.abs(car.y - c.y) <= TURN_SNAP
            : Math.abs(car.x - c.x) <= TURN_SNAP;
        if (aligned && !isWall(cx + next.x, cy + next.y)) {
            car.dir = { x: next.x, y: next.y };
            if (car.dir.x !== 0) car.y = c.y; else car.x = c.x;
        }
    }

    if (!car.dir.x && !car.dir.y) return;

    let nx = car.x + car.dir.x * CAR_SPEED * dt;
    let ny = car.y + car.dir.y * CAR_SPEED * dt;

    // The corridor ahead is blocked: coast up to the middle of this tile.
    if (isWall(cx + car.dir.x, cy + car.dir.y)) {
        if (car.dir.x > 0) nx = Math.min(nx, c.x);
        if (car.dir.x < 0) nx = Math.max(nx, c.x);
        if (car.dir.y > 0) ny = Math.min(ny, c.y);
        if (car.dir.y < 0) ny = Math.max(ny, c.y);
    }

    car.x = clamp(nx, TILE / 2, WORLD_W - TILE / 2);
    car.y = clamp(ny, TILE / 2, WORLD_H - TILE / 2);
}

function updateSmokes(dt) {
    for (const s of smokes) s.life -= dt;
    smokes = smokes.filter((s) => s.life > 0);
}

// Breadth-first distances from the player's tile, so the chase cars actually
// find their way around the maze instead of pressing themselves into walls.
function distanceField(fromCx, fromCy) {
    const dist = [];
    for (let y = 0; y < ROWS; y++) dist.push(new Array(COLS).fill(Infinity));
    if (isWall(fromCx, fromCy)) return dist;

    dist[fromCy][fromCx] = 0;
    const queue = [[fromCx, fromCy]];
    for (let head = 0; head < queue.length; head++) {
        const [cx, cy] = queue[head];
        for (const d of DIRS) {
            const nx = cx + d.x;
            const ny = cy + d.y;
            if (isWall(nx, ny) || dist[ny][nx] !== Infinity) continue;
            dist[ny][nx] = dist[cy][cx] + 1;
            queue.push([nx, ny]);
        }
    }
    return dist;
}

function moveEnemies(dt) {
    const speed = ENEMY_SPEED + (level - 1) * ENEMY_SPEED_PER_LEVEL;
    const target = tileOf(car);
    const field = distanceField(target.cx, target.cy);

    for (const e of enemies) {
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - dt);
            continue;
        }
        if (smokeHits(e)) {
            e.stun = STUN_TIME;
            continue;
        }

        let budget = speed * dt;
        let guard = 0;
        while (budget > 0 && guard++ < 8) {
            const dx = e.tx - e.x;
            const dy = e.ty - e.y;
            const remaining = Math.abs(dx) + Math.abs(dy);
            if (remaining > budget) {
                e.x += Math.sign(dx) * Math.min(budget, Math.abs(dx));
                e.y += Math.sign(dy) * Math.min(budget, Math.abs(dy));
                budget = 0;
            } else {
                e.x = e.tx;
                e.y = e.ty;
                budget -= remaining;
                if (!pickEnemyTarget(e, field)) break;
            }
        }
    }
}

function pickEnemyTarget(e, field) {
    const { cx, cy } = tileOf(e);
    const open = DIRS.filter((d) => !isWall(cx + d.x, cy + d.y));
    if (!open.length) return false;

    const forward = open.filter((d) => !(d.x === -e.dir.x && d.y === -e.dir.y));
    const pool = forward.length ? forward : open;

    let choice = pool[0];
    let bestScore = Infinity;
    for (const d of pool) {
        const value = field[cy + d.y][cx + d.x];
        if (value < bestScore) {
            bestScore = value;
            choice = d;
        }
    }

    e.dir = { x: choice.x, y: choice.y };
    const c = tileCenter(cx + choice.x, cy + choice.y);
    e.tx = c.x;
    e.ty = c.y;
    return true;
}

function smokeHits(e) {
    return smokes.some((s) => Math.hypot(s.x - e.x, s.y - e.y) <= SMOKE_RADIUS);
}

function collectFlags() {
    for (let i = flags.length - 1; i >= 0; i--) {
        const f = flags[i];
        if (Math.hypot(f.x - car.x, f.y - car.y) > PICKUP_DIST) continue;
        flags.splice(i, 1);
        score += doubleFlags ? FLAG_POINTS * 2 : FLAG_POINTS;
        if (f.special) doubleFlags = true;
    }
}

function checkCrash() {
    return enemies.some((e) => e.stun <= 0 && Math.hypot(e.x - car.x, e.y - car.y) < HIT_DIST);
}

// --------------------------------------------------------------------- HUD

function updateHud() {
    el.score.textContent = String(score);
    el.best.textContent = String(best);
    el.level.textContent = String(level);
    el.lives.textContent = String(lives);
    el.flags.textContent = String(flags.length);

    const pct = clamp((fuel / FUEL_MAX) * 100, 0, 100);
    el.fuelBar.style.width = pct.toFixed(1) + '%';
    el.fuelBar.classList.toggle('low', fuel < LOW_FUEL);
    el.fuelPct.textContent = Math.round(pct) + '%';
}

function showOverlay(title, scoreLine, sub, button) {
    el.overlayTitle.textContent = title;
    el.overlayScore.textContent = scoreLine;
    el.overlaySub.textContent = sub;
    el.startBtn.textContent = button;
    el.overlay.classList.add('visible');
}

function hideOverlay() {
    el.overlay.classList.remove('visible');
}

// --------------------------------------------------------------- Rendering

function draw() {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const firstCol = Math.max(0, Math.floor(camera.x / TILE));
    const lastCol = Math.min(COLS - 1, Math.ceil((camera.x + VIEW_W) / TILE));
    const firstRow = Math.max(0, Math.floor(camera.y / TILE));
    const lastRow = Math.min(ROWS - 1, Math.ceil((camera.y + VIEW_H) / TILE));

    for (let y = firstRow; y <= lastRow; y++) {
        for (let x = firstCol; x <= lastCol; x++) {
            const sx = x * TILE - camera.x;
            const sy = y * TILE - camera.y;
            if (maze[y][x] === 1) {
                ctx.fillStyle = '#1c2748';
                ctx.fillRect(sx, sy, TILE, TILE);
                ctx.fillStyle = '#25335c';
                ctx.fillRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
            } else {
                ctx.fillStyle = '#0e1526';
                ctx.fillRect(sx, sy, TILE, TILE);
                ctx.fillStyle = 'rgba(78, 161, 255, 0.07)';
                ctx.fillRect(sx + TILE / 2 - 1, sy + TILE / 2 - 1, 2, 2);
            }
        }
    }

    for (const f of flags) drawFlag(f);
    for (const s of smokes) drawSmoke(s);
    for (const e of enemies) drawEnemy(e);
    drawCar();

    drawRadar();
}

function drawFlag(f) {
    const x = f.x - camera.x;
    const y = f.y - camera.y;
    if (x < -TILE || y < -TILE || x > VIEW_W + TILE || y > VIEW_H + TILE) return;

    ctx.strokeStyle = '#d8def0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 10);
    ctx.lineTo(x - 6, y - 10);
    ctx.stroke();

    ctx.fillStyle = f.special ? '#b46bff' : '#ffd83d';
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 10);
    ctx.lineTo(x + 10, y - 5);
    ctx.lineTo(x - 6, y);
    ctx.closePath();
    ctx.fill();

    if (f.special) {
        ctx.fillStyle = '#1a1030';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('S', x + 0.5, y - 5);
    }
}

// Three overlapping puffs that swell and thin out as the cloud ages.
const PUFFS = [
    { dx: -0.45, dy: -0.3, r: 0.62 },
    { dx: 0.5, dy: -0.15, r: 0.55 },
    { dx: 0.05, dy: 0.4, r: 0.6 },
];

function drawSmoke(s) {
    const x = s.x - camera.x;
    const y = s.y - camera.y;
    const fade = clamp(s.life / SMOKE_LIFE, 0, 1);
    const spread = SMOKE_RADIUS * (1.3 - fade * 0.3);
    const alpha = 0.1 + fade * 0.22;

    ctx.fillStyle = `rgba(206, 214, 234, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, spread, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(226, 232, 246, ${alpha * 0.9})`;
    for (const p of PUFFS) {
        ctx.beginPath();
        ctx.arc(x + p.dx * spread, y + p.dy * spread, p.r * spread, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawEnemy(e) {
    const x = e.x - camera.x;
    const y = e.y - camera.y;
    if (x < -TILE || y < -TILE || x > VIEW_W + TILE || y > VIEW_H + TILE) return;
    drawVehicle(x, y, e.dir, e.stun > 0 ? '#8b3b46' : '#ff4d5e', '#ffb3bb');
    if (e.stun > 0) {
        ctx.strokeStyle = 'rgba(255, 216, 61, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 1.4);
        ctx.stroke();
    }
}

function drawCar() {
    drawVehicle(car.x - camera.x, car.y - camera.y, car.dir, '#4ea1ff', '#cfe6ff');
}

function drawVehicle(x, y, dir, body, trim) {
    const angle = dir.x || dir.y ? Math.atan2(dir.y, dir.x) : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = body;
    ctx.fillRect(-11, -8, 22, 16);
    ctx.fillStyle = trim;
    ctx.fillRect(1, -6, 7, 12);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(-9, -10, 6, 3);
    ctx.fillRect(-9, 7, 6, 3);
    ctx.fillRect(4, -10, 6, 3);
    ctx.fillRect(4, 7, 6, 3);
    ctx.restore();
}

function drawRadar() {
    const scale = Math.min(RADAR_W / WORLD_W, RADAR_H / WORLD_H);
    const offX = (RADAR_W - WORLD_W * scale) / 2;
    const offY = (RADAR_H - WORLD_H * scale) / 2;
    const px = (wx) => offX + wx * scale;
    const py = (wy) => offY + wy * scale;

    rctx.fillStyle = '#070b16';
    rctx.fillRect(0, 0, RADAR_W, RADAR_H);

    rctx.fillStyle = '#1a2440';
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (maze[y][x] !== 1) continue;
            rctx.fillRect(px(x * TILE), py(y * TILE), TILE * scale + 0.5, TILE * scale + 0.5);
        }
    }

    rctx.strokeStyle = 'rgba(232, 236, 248, 0.35)';
    rctx.lineWidth = 1;
    rctx.strokeRect(px(camera.x), py(camera.y), VIEW_W * scale, VIEW_H * scale);

    for (const f of flags) {
        rctx.fillStyle = f.special ? '#b46bff' : '#ffd83d';
        rctx.fillRect(px(f.x) - 2, py(f.y) - 2, 4, 4);
    }

    for (const e of enemies) {
        rctx.fillStyle = e.stun > 0 ? '#8b3b46' : '#ff4d5e';
        rctx.fillRect(px(e.x) - 2, py(e.y) - 2, 4, 4);
    }

    rctx.fillStyle = '#4ea1ff';
    rctx.fillRect(px(car.x) - 3, py(car.y) - 3, 6, 6);
}

// ---------------------------------------------------------------- The loop

let lastFrame = 0;

function frame(now) {
    const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
    lastFrame = now;
    step(dt);
    draw();
    window.requestAnimationFrame(frame);
}

// -------------------------------------------------------------- Event wiring

const KEY_DIRS = {
    ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
    ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
    ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
    ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
};

window.addEventListener('keydown', (event) => {
    const dir = KEY_DIRS[event.key];
    if (dir) {
        event.preventDefault();
        if (state === 'running') setDirection(dir[0], dir[1]);
        return;
    }

    if (event.code === 'Space') {
        event.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else dropSmoke();
        return;
    }

    if (event.key === 'p' || event.key === 'P') {
        event.preventDefault();
        togglePause();
    }
});

el.startBtn.addEventListener('click', () => {
    startGame();
});

// --------------------------------------------------------------- Bootstrap

try {
    best = parseInt(window.localStorage.getItem(BEST_KEY), 10) || 0;
} catch (e) {
    best = 0;
}

buildLevel();
updateHud();
window.requestAnimationFrame(frame);
