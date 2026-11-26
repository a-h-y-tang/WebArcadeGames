// Solomon's Quarry — a first-person raycast maze on a plain <canvas>.
// State lives in script-level bindings so the Playwright specs can read and
// drive the game with page.evaluate (the same approach as the other games here).

// --- Geometry and feel -----------------------------------------------------
const CANVAS_W = 760;
const CANVAS_H = 440;
const FOV = Math.PI / 3;                 // 60° field of view
const PROJ = (CANVAS_W / 2) / Math.tan(FOV / 2);
const MOVE_SPEED = 3.4;                  // cells per second
const TURN_SPEED = 3.2;                  // radians per second
const BODY = 0.24;                        // how close the player gets to rock
const PICKUP = 0.45;                      // cells
const GATE = { x: 1.5, y: 1.5 };          // centre of the quarry mouth cell
const STONE_SCORE = 100;
const LEVEL_BONUS = 250;
const BEST_KEY = 'solomons-quarry-best';

// An oil lamp burns at the rate it burns, so the drain is the same on every
// level; the quarry itself is what grows. Each level carries one flask per
// stone, which is what keeps the bigger mazes walkable.
const DRAIN = 1.0;                       // % of the lamp per second
const FLASK_REFILL = 25;                 // % of the lamp per flask

const LEVELS = [
    { cols: 11, rows: 11, stones: 3, flasks: 3, drain: DRAIN },
    { cols: 13, rows: 13, stones: 4, flasks: 4, drain: DRAIN },
    { cols: 15, rows: 15, stones: 5, flasks: 5, drain: DRAIN },
    { cols: 17, rows: 17, stones: 6, flasks: 6, drain: DRAIN },
    { cols: 19, rows: 19, stones: 7, flasks: 7, drain: DRAIN },
];

// --- DOM -------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const levelEl = document.getElementById('level');
const stonesEl = document.getElementById('stones');
const oilEl = document.getElementById('oil');
const oilBar = document.getElementById('oil-bar');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const statusEl = document.getElementById('status');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- Seeded randomness -----------------------------------------------------
const urlSeed = new URL(window.location.href).searchParams.get('seed');
const seed = urlSeed == null ? (Math.random() * 0xffffffff) >>> 0 : (parseInt(urlSeed, 10) >>> 0);

function mulberry32(a) {
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// One continuing stream: a given seed always produces the same first quarry,
// and every later level (or new run) gets a fresh one.
const rng = mulberry32(seed);

function shuffled(items) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// --- State -----------------------------------------------------------------
let state = 'idle';                       // idle | running | paused | over | won
let level = 1;
let score = 0;
let best = null;
let oil = 100;
let stonesHeld = 0;
let maze = { cols: 0, rows: 0, grid: new Uint8Array(0) };
let dist = new Int16Array(0);             // walking distance from the gate
let stones = [];
let flasks = [];
let explored = new Set();
const player = { x: GATE.x, y: GATE.y, angle: 0 };
const keys = new Set();
let lastTime = null;
let animId = null;
let flicker = 0;

// --- Maze ------------------------------------------------------------------
function isWall(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= maze.cols || cy >= maze.rows) return true;
    return maze.grid[cy * maze.cols + cx] === 1;
}

function generateMaze(cols, rows) {
    const grid = new Uint8Array(cols * rows).fill(1);
    const at = (x, y) => y * cols + x;
    grid[at(1, 1)] = 0;
    const stack = [[1, 1]];
    while (stack.length) {
        const [cx, cy] = stack[stack.length - 1];
        let carved = false;
        for (const [dx, dy] of shuffled([[2, 0], [-2, 0], [0, 2], [0, -2]])) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 1 || ny < 1 || nx > cols - 2 || ny > rows - 2) continue;
            if (grid[at(nx, ny)] === 0) continue;
            grid[at(cx + dx / 2, cy + dy / 2)] = 0;
            grid[at(nx, ny)] = 0;
            stack.push([nx, ny]);
            carved = true;
            break;
        }
        if (!carved) stack.pop();
    }
    return { cols, rows, grid };
}

// Breadth-first distance in tunnel steps from the quarry mouth.
function buildDistanceField() {
    const field = new Int16Array(maze.cols * maze.rows).fill(-1);
    const gx = Math.floor(GATE.x);
    const gy = Math.floor(GATE.y);
    field[gy * maze.cols + gx] = 0;
    const queue = [[gx, gy]];
    for (let head = 0; head < queue.length; head++) {
        const [x, y] = queue[head];
        const d = field[y * maze.cols + x];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (isWall(nx, ny)) continue;
            const i = ny * maze.cols + nx;
            if (field[i] !== -1) continue;
            field[i] = d + 1;
            queue.push([nx, ny]);
        }
    }
    return field;
}

function gateDistance(cx, cy) {
    if (isWall(cx, cy)) return -1;
    return dist[cy * maze.cols + cx];
}

function openCells() {
    const cells = [];
    for (let y = 1; y < maze.rows - 1; y++) {
        for (let x = 1; x < maze.cols - 1; x++) if (!isWall(x, y)) cells.push([x, y]);
    }
    return cells;
}

function openNeighbours(x, y) {
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !isWall(x + dx, y + dy)).length;
}

// Stones go in dead ends, chosen from the far half of the quarry.
function placeStones(count) {
    const gx = Math.floor(GATE.x);
    const gy = Math.floor(GATE.y);
    const candidates = openCells().filter(
        ([x, y]) => !(x === gx && y === gy) && openNeighbours(x, y) === 1 && gateDistance(x, y) > 3
    );
    candidates.sort((a, b) => gateDistance(b[0], b[1]) - gateDistance(a[0], a[1]));
    let pool = candidates.slice(0, Math.max(count, Math.ceil(candidates.length / 2)));
    if (pool.length < count) {
        // Very open quarry: fall back to the cells furthest from the mouth.
        pool = openCells()
            .filter(([x, y]) => !(x === gx && y === gy) && gateDistance(x, y) > 3)
            .sort((a, b) => gateDistance(b[0], b[1]) - gateDistance(a[0], a[1]));
    }
    return shuffled(pool)
        .slice(0, count)
        .map(([x, y]) => ({ x: x + 0.5, y: y + 0.5, taken: false }));
}

function placeFlasks(count, used) {
    const gx = Math.floor(GATE.x);
    const gy = Math.floor(GATE.y);
    const pool = openCells().filter(
        ([x, y]) => !(x === gx && y === gy) && !used.has(`${x},${y}`) && gateDistance(x, y) > 1
    );
    return shuffled(pool)
        .slice(0, count)
        .map(([x, y]) => ({ x: x + 0.5, y: y + 0.5, taken: false }));
}

// --- Rays ------------------------------------------------------------------
// A DDA grid walk. `dist` is measured along the ray; `side` is the face hit.
function castRay(px, py, angle) {
    const rayX = Math.cos(angle);
    const rayY = Math.sin(angle);
    let mapX = Math.floor(px);
    let mapY = Math.floor(py);
    const deltaX = rayX === 0 ? Infinity : Math.abs(1 / rayX);
    const deltaY = rayY === 0 ? Infinity : Math.abs(1 / rayY);
    const stepX = rayX < 0 ? -1 : 1;
    const stepY = rayY < 0 ? -1 : 1;
    let sideX = (rayX < 0 ? px - mapX : mapX + 1 - px) * deltaX;
    let sideY = (rayY < 0 ? py - mapY : mapY + 1 - py) * deltaY;
    let side = 'x';

    for (let guard = 0; guard < 512; guard++) {
        if (sideX < sideY) {
            sideX += deltaX;
            mapX += stepX;
            side = 'x';
        } else {
            sideY += deltaY;
            mapY += stepY;
            side = 'y';
        }
        if (isWall(mapX, mapY)) break;
    }

    const travelled =
        side === 'x'
            ? (mapX - px + (1 - stepX) / 2) / (rayX || 1e-9)
            : (mapY - py + (1 - stepY) / 2) / (rayY || 1e-9);
    return { dist: Math.max(travelled, 1e-4), side, cellX: mapX, cellY: mapY };
}

// --- Lamp ------------------------------------------------------------------
function lightRadius() {
    return 2.5 + (oil / 100) * 4.5;
}

function config() {
    return LEVELS[Math.min(level, LEVELS.length) - 1];
}

function gateOpen() {
    return stonesHeld >= config().stones;
}

// --- Level lifecycle -------------------------------------------------------
// Look down a tunnel at the start of a level, never straight into the rock.
function facingFromGate() {
    const gx = Math.floor(GATE.x);
    const gy = Math.floor(GATE.y);
    const choices = [[1, 0, 0], [0, 1, Math.PI / 2], [0, -1, -Math.PI / 2], [-1, 0, Math.PI]];
    for (const [dx, dy, angle] of choices) {
        if (!isWall(gx + dx, gy + dy)) return angle;
    }
    return 0;
}

function startLevel() {
    const cfg = config();
    maze = generateMaze(cfg.cols, cfg.rows);
    dist = buildDistanceField();
    stones = placeStones(cfg.stones);
    const used = new Set(stones.map((s) => `${Math.floor(s.x)},${Math.floor(s.y)}`));
    flasks = placeFlasks(cfg.flasks, used);
    stonesHeld = 0;
    oil = 100;
    player.x = GATE.x;
    player.y = GATE.y;
    player.angle = facingFromGate();
    explored = new Set();
    markExplored();
    updateHUD();
}

function startRun() {
    // The quarry shown behind the title screen is the one you walk into; only
    // a later run (after a win or a dead lamp) carves a new one.
    const carveNew = state !== 'idle';
    level = 1;
    score = 0;
    if (carveNew) startLevel();
    else updateHUD();
    state = 'running';
    overlay.classList.remove('visible');
    overlayScore.textContent = '';
    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function completeLevel() {
    score += LEVEL_BONUS + Math.round(oil);
    if (level >= LEVELS.length) {
        winRun();
        return;
    }
    level += 1;
    startLevel();
}

function saveBest() {
    if (best == null || score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage can be blocked; the run still stands */
        }
    }
}

function winRun() {
    state = 'won';
    saveBest();
    overlayTitle.textContent = 'The stones are up at the temple!';
    overlayScore.textContent = `Final score ${score}`;
    overlaySub.textContent = 'Press Space to go down again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    statusEl.textContent = 'Every dressed stone carried out of the quarry.';
    updateHUD();
}

function loseRun() {
    state = 'over';
    oil = 0;
    saveBest();
    overlayTitle.textContent = 'Your lamp has gone out';
    overlayScore.textContent = `Score ${score} · reached level ${level}`;
    overlaySub.textContent = 'Press Space to try again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    statusEl.textContent = 'The quarry is dark. Press Space to start again.';
    updateHUD();
    drawDarkness();
}

// --- HUD -------------------------------------------------------------------
function updateHUD() {
    levelEl.textContent = String(level);
    stonesEl.textContent = `${stonesHeld} / ${config().stones}`;
    oilEl.textContent = `${Math.max(0, Math.ceil(oil))}%`;
    oilBar.style.width = `${Math.max(0, Math.min(100, oil))}%`;
    scoreEl.textContent = String(score);
    bestEl.textContent = best == null ? '—' : String(best);

    if (state === 'paused') {
        statusEl.textContent = 'Paused — press P to resume';
    } else if (state === 'running') {
        const left = config().stones - stonesHeld;
        statusEl.textContent = gateOpen()
            ? 'The gate is open — carry the stones back to the quarry mouth.'
            : `Gather ${left} more dressed ${left === 1 ? 'stone' : 'stones'}.`;
    }
}

// --- Movement and pickups --------------------------------------------------
function blocked(x, y) {
    // Treat the player as a small circle so corners cannot be cut.
    for (const [dx, dy] of [[BODY, BODY], [-BODY, BODY], [BODY, -BODY], [-BODY, -BODY]]) {
        if (isWall(Math.floor(x + dx), Math.floor(y + dy))) return true;
    }
    return false;
}

function tryMove(nx, ny) {
    if (!blocked(nx, player.y)) player.x = nx;
    if (!blocked(player.x, ny)) player.y = ny;
}

function markExplored() {
    const cx = Math.floor(player.x);
    const cy = Math.floor(player.y);
    explored.add(`${cx},${cy}`);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!isWall(cx + dx, cy + dy)) explored.add(`${cx + dx},${cy + dy}`);
    }
}

function collect() {
    for (const stone of stones) {
        if (stone.taken) continue;
        if (Math.hypot(stone.x - player.x, stone.y - player.y) < PICKUP) {
            stone.taken = true;
            stonesHeld += 1;
            score += STONE_SCORE;
        }
    }
    for (const flask of flasks) {
        if (flask.taken) continue;
        if (Math.hypot(flask.x - player.x, flask.y - player.y) < PICKUP) {
            flask.taken = true;
            oil = Math.min(100, oil + FLASK_REFILL);
        }
    }
}

function update(sec) {
    const turn = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) -
        (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
    player.angle += turn * TURN_SPEED * sec;

    const fwd = (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0) -
        (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0);
    const side = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);

    if (fwd !== 0) {
        const step = fwd * MOVE_SPEED * sec;
        tryMove(player.x + Math.cos(player.angle) * step, player.y + Math.sin(player.angle) * step);
    }
    if (side !== 0) {
        const step = side * MOVE_SPEED * sec;
        const a = player.angle + Math.PI / 2;
        tryMove(player.x + Math.cos(a) * step, player.y + Math.sin(a) * step);
    }

    markExplored();
    collect();

    oil -= config().drain * sec;
    if (oil <= 0) {
        loseRun();
        return;
    }

    if (gateOpen() && Math.hypot(GATE.x - player.x, GATE.y - player.y) < 0.5) {
        completeLevel();
    }
}

// --- Rendering -------------------------------------------------------------
const WALL_SCALE = 0.78;                 // how tall a tunnel is on screen
const HORIZON = CANVAS_H / 2;

// How brightly the lamp reaches a point `d` cells away.
function falloff(d) {
    const r = lightRadius();
    return Math.max(0.05, 1 / (1 + 2.4 * (d / r) * (d / r)));
}

function wallHeight(d) {
    return (PROJ * WALL_SCALE) / d;
}

// A stable per-block tint so the dressed stone is not one flat colour.
function cellTint(cx, cy) {
    const n = Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453;
    return 0.9 + (n - Math.floor(n)) * 0.2;
}

function drawFloorAndCeiling(lamp) {
    const half = (PROJ * WALL_SCALE) / 2;
    for (let y = Math.ceil(HORIZON) + 1; y < CANVAS_H; y++) {
        const d = half / (y - HORIZON);
        const k = falloff(d / lamp);
        const f = Math.round(96 * k) + 6;
        ctx.fillStyle = `rgb(${f},${Math.round(f * 0.82)},${Math.round(f * 0.58)})`;
        ctx.fillRect(0, y, CANVAS_W, 1);

        const cy = CANVAS_H - y;
        const ck = k * 0.72;
        const c = Math.round(78 * ck) + 5;
        ctx.fillStyle = `rgb(${c},${Math.round(c * 0.9)},${Math.round(c * 0.78)})`;
        ctx.fillRect(0, cy, CANVAS_W, 1);
    }
}

function drawTunnel() {
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const lamp = 0.94 + Math.sin(flicker * 6.5) * 0.06;
    drawFloorAndCeiling(lamp);

    const depth = new Float64Array(CANVAS_W);

    for (let col = 0; col < CANVAS_W; col++) {
        const angle = player.angle - FOV / 2 + (col / CANVAS_W) * FOV;
        const hit = castRay(player.x, player.y, angle);
        const corrected = Math.max(0.05, hit.dist * Math.cos(angle - player.angle));
        depth[col] = corrected;

        const height = Math.min(CANVAS_H * 6, wallHeight(corrected));
        const top = HORIZON - height / 2;

        const hx = player.x + Math.cos(angle) * hit.dist;
        const hy = player.y + Math.sin(angle) * hit.dist;
        const along = hit.side === 'x' ? hy - Math.floor(hy) : hx - Math.floor(hx);

        const k = falloff(corrected / lamp) * cellTint(hit.cellX, hit.cellY);
        const face = hit.side === 'x' ? 1 : 0.68;      // corners read through contrast
        const r = Math.round(196 * k * face);
        const g = Math.round(168 * k * face);
        const b = Math.round(122 * k * face);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(col, top, 1, height);

        // Mortar: the seam between blocks, and the courses up the wall.
        if (along < 0.035 || along > 0.965) {
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            ctx.fillRect(col, top, 1, height);
        }
        if (height > 30) {
            const thick = Math.max(1, Math.round(height * 0.012));
            ctx.fillStyle = 'rgba(0,0,0,0.26)';
            for (let course = 1; course < 4; course++) {
                ctx.fillRect(col, top + (height * course) / 4, 1, thick);
            }
        }
    }

    for (const sprite of spriteList()) drawSprite(sprite, depth);
    drawLampGlow();
    drawMinimap();
    if (state === 'paused') drawPausedVeil();
}

function spriteList() {
    const list = [];
    for (const s of stones) if (!s.taken) list.push({ x: s.x, y: s.y, kind: 'stone' });
    for (const f of flasks) if (!f.taken) list.push({ x: f.x, y: f.y, kind: 'flask' });
    list.push({ x: GATE.x, y: GATE.y, kind: 'gate' });
    return list.sort(
        (a, b) =>
            Math.hypot(b.x - player.x, b.y - player.y) - Math.hypot(a.x - player.x, a.y - player.y)
    );
}

function drawSprite(sprite, depth) {
    const dx = sprite.x - player.x;
    const dy = sprite.y - player.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.35 || d > 16) return;

    let rel = Math.atan2(dy, dx) - player.angle;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    if (Math.abs(rel) > FOV / 2 + 0.3) return;

    const screenX = CANVAS_W / 2 + Math.tan(rel) * PROJ;
    const col = Math.max(0, Math.min(CANVAS_W - 1, Math.round(screenX)));
    if (depth[col] < d * Math.cos(rel) - 0.05) return;     // hidden behind rock

    const height = wallHeight(d);
    const floorY = HORIZON + height / 2;
    const k = falloff(d);

    if (sprite.kind === 'gate') {
        const w = height * 0.74;
        const h = height * 0.9;
        const open = gateOpen();
        ctx.strokeStyle = open
            ? `rgba(251,191,36,${0.5 + 0.5 * k})`
            : `rgba(146,138,120,${0.35 + 0.5 * k})`;
        ctx.lineWidth = Math.max(2, height * 0.05);
        ctx.beginPath();
        ctx.moveTo(screenX - w / 2, floorY);
        ctx.lineTo(screenX - w / 2, floorY - h * 0.55);
        ctx.quadraticCurveTo(screenX, floorY - h * 1.15, screenX + w / 2, floorY - h * 0.55);
        ctx.lineTo(screenX + w / 2, floorY);
        ctx.stroke();
        if (open) {
            ctx.fillStyle = `rgba(251,191,36,${0.12 + 0.12 * k})`;
            ctx.fill();
        }
        return;
    }

    if (sprite.kind === 'stone') {
        // A dressed block: a lit top, a front face, and one side face in
        // shadow on whichever side the player is standing.
        const size = height * 0.36;
        const depthFace = size * 0.26;
        const x = screenX - size / 2;
        const y = floorY - size;
        const lean = screenX < CANVAS_W / 2 ? 1 : -1;                 // side we can see

        ctx.fillStyle = `rgb(${Math.round(150 * k) + 8},${Math.round(130 * k) + 7},${Math.round(96 * k) + 5})`;
        ctx.beginPath();                                              // side face
        ctx.moveTo(x + (lean > 0 ? size : 0), y);
        ctx.lineTo(x + (lean > 0 ? size : 0) + depthFace * lean, y - depthFace * 0.5);
        ctx.lineTo(x + (lean > 0 ? size : 0) + depthFace * lean, y - depthFace * 0.5 + size);
        ctx.lineTo(x + (lean > 0 ? size : 0), y + size);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = `rgba(255,244,216,${0.3 + 0.45 * k})`;        // top face
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + size, y);
        ctx.lineTo(x + size + depthFace * lean, y - depthFace * 0.5);
        ctx.lineTo(x + depthFace * lean, y - depthFace * 0.5);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = `rgb(${Math.round(222 * k) + 12},${Math.round(198 * k) + 10},${Math.round(150 * k) + 8})`;
        ctx.fillRect(x, y, size, size);                               // front face
        ctx.strokeStyle = 'rgba(30,22,10,0.5)';
        ctx.lineWidth = Math.max(1, size * 0.035);
        ctx.strokeRect(x, y, size, size);
        ctx.beginPath();                                              // chisel line
        ctx.moveTo(x + size * 0.14, y + size * 0.62);
        ctx.lineTo(x + size * 0.86, y + size * 0.62);
        ctx.stroke();
        return;
    }

    // Oil flask: a round clay jar with a lit wick.
    const size = height * 0.22;
    const cx = screenX;
    const cy = floorY - size * 0.9;
    ctx.fillStyle = `rgb(${Math.round(188 * k) + 14},${Math.round(116 * k) + 10},${Math.round(62 * k) + 6})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * 0.85, size * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgb(${Math.round(150 * k) + 10},${Math.round(90 * k) + 8},${Math.round(48 * k) + 5})`;
    ctx.fillRect(cx - size * 0.22, cy - size * 1.5, size * 0.44, size * 0.7);
    ctx.fillStyle = `rgba(253,224,71,${0.5 + 0.5 * k})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy - size * 1.65, size * 0.22, size * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawLampGlow() {
    const glow = ctx.createRadialGradient(
        CANVAS_W / 2,
        CANVAS_H * 0.58,
        CANVAS_W * 0.05,
        CANVAS_W / 2,
        CANVAS_H * 0.58,
        CANVAS_W * 0.75
    );
    glow.addColorStop(0, `rgba(255, 198, 104, ${0.04 + (oil / 100) * 0.07})`);
    glow.addColorStop(0.55, 'rgba(0,0,0,0)');
    glow.addColorStop(1, `rgba(0,0,0,${0.55 - (oil / 100) * 0.1})`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawMinimap() {
    const span = Math.max(maze.cols, maze.rows);
    const cell = Math.max(4, Math.floor(118 / span));
    const w = maze.cols * cell;
    const h = maze.rows * cell;
    const ox = 12;
    const oy = 12;

    ctx.fillStyle = 'rgba(5, 8, 14, 0.72)';
    ctx.fillRect(ox - 4, oy - 4, w + 8, h + 8);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 4, oy - 4, w + 8, h + 8);

    for (const key of explored) {
        const [x, y] = key.split(',').map(Number);
        ctx.fillStyle = 'rgba(203, 180, 132, 0.75)';
        ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    }

    for (const s of stones) {
        if (s.taken) continue;
        if (!explored.has(`${Math.floor(s.x)},${Math.floor(s.y)}`)) continue;
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(
            ox + Math.floor(s.x) * cell + cell * 0.25,
            oy + Math.floor(s.y) * cell + cell * 0.25,
            cell * 0.5,
            cell * 0.5
        );
    }

    ctx.fillStyle = gateOpen() ? '#fbbf24' : '#78716c';
    ctx.fillRect(ox + Math.floor(GATE.x) * cell, oy + Math.floor(GATE.y) * cell, cell, cell);

    const px = ox + player.x * cell;
    const py = oy + player.y * cell;
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(player.angle) * cell * 0.7, py + Math.sin(player.angle) * cell * 0.7);
    ctx.lineTo(px + Math.cos(player.angle + 2.4) * cell * 0.5, py + Math.sin(player.angle + 2.4) * cell * 0.5);
    ctx.lineTo(px + Math.cos(player.angle - 2.4) * cell * 0.5, py + Math.sin(player.angle - 2.4) * cell * 0.5);
    ctx.closePath();
    ctx.fill();
}

function drawPausedVeil() {
    ctx.fillStyle = 'rgba(5, 8, 14, 0.6)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Paused', CANVAS_W / 2, CANVAS_H / 2);
}

// The title screen looks down the first tunnel of the quarry, behind the
// overlay, instead of showing a blank rectangle.
// When the lamp dies the tunnel goes with it.
function drawDarkness() {
    ctx.fillStyle = '#04050a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const ember = ctx.createRadialGradient(
        CANVAS_W / 2, CANVAS_H * 0.6, 2, CANVAS_W / 2, CANVAS_H * 0.6, CANVAS_W * 0.3
    );
    ember.addColorStop(0, 'rgba(120, 60, 16, 0.5)');
    ember.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ember;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawTitleView() {
    drawTunnel();
    ctx.fillStyle = 'rgba(5, 8, 14, 0.12)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

// --- Loop ------------------------------------------------------------------
function loop(ts) {
    if (state !== 'running' && state !== 'paused') return;

    if (lastTime == null) lastTime = ts;
    let dt = ts - lastTime;
    lastTime = ts;
    if (dt > 50) dt = 50;
    const sec = dt / 1000;

    if (state === 'running') {
        flicker += sec;
        update(sec);
    }

    if (state === 'running' || state === 'paused') {
        drawTunnel();
        updateHUD();
        animId = requestAnimationFrame(loop);
    }
}

// --- Input -----------------------------------------------------------------
const MOVE_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
]);

document.addEventListener('keydown', (e) => {
    if (MOVE_KEYS.has(e.code)) {
        e.preventDefault();
        keys.add(e.code);
        return;
    }
    if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (state !== 'running' && state !== 'paused') startRun();
        return;
    }
    if (e.code === 'KeyP') {
        e.preventDefault();
        if (state === 'running') {
            state = 'paused';
            updateHUD();
        } else if (state === 'paused') {
            state = 'running';
            lastTime = null;
            updateHUD();
        }
    }
});

document.addEventListener('keyup', (e) => {
    keys.delete(e.code);
});

window.addEventListener('blur', () => keys.clear());

btnStart.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state !== 'running' && state !== 'paused') startRun();
});

// --- Init ------------------------------------------------------------------
try {
    const stored = localStorage.getItem(BEST_KEY);
    best = stored == null ? null : parseInt(stored, 10);
} catch (err) {
    best = null;
}

startLevel();
drawTitleView();
updateHUD();
