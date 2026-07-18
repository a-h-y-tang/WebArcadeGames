// =====================================================================
// Xonix — a territory-capture arcade game.
//
// The world is a 2-D `grid` of cell states (SEA / LAND / TRAIL). The
// player draws a trail across the sea; sealing it back to land runs a
// flood fill that claims the enemy-free pocket. Player moves and enemy
// motion are deterministic functions of explicit state, so the whole
// simulation is unit-testable — see tests/xonix.spec.js.
// =====================================================================

const TILE = { SEA: 0, LAND: 1, TRAIL: 2 };

const CHAR_TO_TILE = { '.': TILE.SEA, '#': TILE.LAND, 'T': TILE.TRAIL, 'P': TILE.LAND, 'e': TILE.SEA };

// Live-level dimensions.
const COLS = 40;
const ROWS = 30;
const DEFAULT_TARGET = 75;

// --- Game state (exposed as globals for tests) -----------------------
let grid;              // grid[y][x] -> TILE.*
let player;            // { x, y }
let startPos;          // where the player respawns after a death
let enemies;           // [{ x, y, dx, dy }]
let drawing;           // currently carving a trail?
let state;             // 'ready' | 'running' | 'won' | 'lost' | 'paused'
let lives;
let score;
let best;
let percent;           // % of the sea claimed
let targetPercent;
let initialSea;        // count of SEA cells at level start (the capturable area)
let dir;               // current movement direction { x, y } or null
let CELL;

// --- Rendering handles -----------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const percentEl = document.getElementById('percent');
const targetEl = document.getElementById('target');
const livesEl = document.getElementById('lives');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

let tickTimer = null;
let animId = null;
const BEST_KEY = 'xonix-best';
const TICK_MS = 85;

// =====================================================================
// Level setup
// =====================================================================

function countSea() {
    let n = 0;
    for (const row of grid) for (const c of row) if (c === TILE.SEA) n++;
    return n;
}

function resetLevelMeta(opts) {
    lives = opts.lives !== undefined ? opts.lives : 3;
    targetPercent = opts.target !== undefined ? opts.target : DEFAULT_TARGET;
    score = 0;
    drawing = false;
    dir = null;
    initialSea = countSea();
    state = 'ready';
    computePercent();
    sizeCells();
    updateHud();
}

function sizeCells() {
    if (canvas) CELL = Math.floor(Math.min(canvas.width / grid[0].length, canvas.height / grid.length));
}

// Build a scenario from an ASCII map (used by tests).
function loadMap(mapString, opts = {}) {
    const rows = mapString.split('\n');
    const R = rows.length;
    const C = Math.max(...rows.map(r => r.length));
    grid = [];
    enemies = [];
    player = { x: 0, y: 0 };
    const vel = opts.enemyVel || [1, 1];

    for (let y = 0; y < R; y++) {
        const row = [];
        for (let x = 0; x < C; x++) {
            const ch = rows[y][x] !== undefined ? rows[y][x] : '.';
            let tile = CHAR_TO_TILE[ch];
            if (tile === undefined) tile = TILE.SEA;
            if (ch === 'P') player = { x, y };
            if (ch === 'e') enemies.push({ x, y, dx: vel[0], dy: vel[1] });
            row.push(tile);
        }
        grid.push(row);
    }
    startPos = { x: player.x, y: player.y };
    resetLevelMeta(opts);
}

// Build the standard playable level.
function newGame() {
    grid = [];
    for (let y = 0; y < ROWS; y++) {
        const row = [];
        for (let x = 0; x < COLS; x++) {
            const border = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
            row.push(border ? TILE.LAND : TILE.SEA);
        }
        grid.push(row);
    }
    player = { x: Math.floor(COLS / 2), y: 0 };
    startPos = { x: player.x, y: player.y };
    enemies = [
        { x: 10, y: 10, dx: 1, dy: 1 },
        { x: 24, y: 8, dx: -1, dy: 1 },
        { x: 30, y: 20, dx: 1, dy: -1 },
    ];
    resetLevelMeta({});
}

// =====================================================================
// Player movement / drawing
// =====================================================================

function inBounds(x, y) {
    return x >= 0 && x < grid[0].length && y >= 0 && y < grid.length;
}

// Move the player one cell by (dx, dy). Returns true if a step was taken.
function movePlayer(dx, dy) {
    if (state === 'won' || state === 'lost' || state === 'paused') return false;
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (!inBounds(nx, ny)) return false;

    const cur = grid[ny][nx];

    if (cur === TILE.TRAIL) {
        die();
        return true;
    }

    if (cur === TILE.SEA) {
        grid[ny][nx] = TILE.TRAIL;
        drawing = true;
        player = { x: nx, y: ny };
        updateHud();
        return true;
    }

    // LAND
    player = { x: nx, y: ny };
    if (drawing) {
        drawing = false;
        sealTrail();
    }
    updateHud();
    return true;
}

// =====================================================================
// Capture
// =====================================================================

function sealTrail() {
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[0].length; x++) {
            if (grid[y][x] === TILE.TRAIL) grid[y][x] = TILE.LAND;
        }
    }
    floodCapture();
}

// Flood the sea from every enemy; any sea an enemy can't reach is enclosed
// and becomes land.
function floodCapture() {
    const R = grid.length, C = grid[0].length;
    const reach = Array.from({ length: R }, () => new Array(C).fill(false));
    const stack = [];
    for (const e of enemies) {
        if (inBounds(e.x, e.y) && grid[e.y][e.x] === TILE.SEA && !reach[e.y][e.x]) {
            reach[e.y][e.x] = true;
            stack.push([e.x, e.y]);
        }
    }
    while (stack.length) {
        const [x, y] = stack.pop();
        const nbrs = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        for (const [nx, ny] of nbrs) {
            if (inBounds(nx, ny) && !reach[ny][nx] && grid[ny][nx] === TILE.SEA) {
                reach[ny][nx] = true;
                stack.push([nx, ny]);
            }
        }
    }

    let captured = 0;
    for (let y = 0; y < R; y++) {
        for (let x = 0; x < C; x++) {
            if (grid[y][x] === TILE.SEA && !reach[y][x]) {
                grid[y][x] = TILE.LAND;
                captured++;
            }
        }
    }
    score += captured;
    computePercent();
    updateHud();
    if (state === 'running' && percent >= targetPercent) win();
}

function computePercent() {
    if (!initialSea) { percent = 0; return; }
    const captured = initialSea - countSea();
    percent = Math.round((captured / initialSea) * 100);
}

// =====================================================================
// Enemies
// =====================================================================

function enemyStep() {
    for (const e of enemies) {
        // Touching the live trail is fatal.
        const tx = e.x + e.dx;
        const ty = e.y + e.dy;
        if (inBounds(tx, ty) && grid[ty][tx] === TILE.TRAIL) {
            die();
            return;
        }
        // Reflect off land / borders, component-wise.
        if (!inBounds(e.x + e.dx, e.y) || grid[e.y][e.x + e.dx] !== TILE.SEA) e.dx = -e.dx;
        if (!inBounds(e.x, e.y + e.dy) || grid[e.y + e.dy][e.x] !== TILE.SEA) e.dy = -e.dy;
        const nx = e.x + e.dx;
        const ny = e.y + e.dy;
        if (inBounds(nx, ny) && grid[ny][nx] === TILE.SEA) {
            e.x = nx;
            e.y = ny;
        }
        // Caught in a corner -> stays put this tick.
    }
}

// =====================================================================
// Death / win
// =====================================================================

function die() {
    lives--;
    // The unfinished trail is lost back to the sea.
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[0].length; x++) {
            if (grid[y][x] === TILE.TRAIL) grid[y][x] = TILE.SEA;
        }
    }
    drawing = false;
    if (lives <= 0) {
        state = 'lost';
        saveBest();
        stopLoops();
        showOverlay('Game Over', `Score: ${score}`, 'Press R to try again');
    } else {
        player = { x: startPos.x, y: startPos.y };
        dir = null;
    }
    updateHud();
}

function win() {
    if (state === 'won') return;
    state = 'won';
    saveBest();
    stopLoops();
    showOverlay('You Win!', `Score: ${score}`, 'Press R to play again');
    updateHud();
}

// =====================================================================
// Rendering
// =====================================================================

function render() {
    if (!ctx) return;
    const R = grid.length, C = grid[0].length;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < R; y++) {
        for (let x = 0; x < C; x++) {
            const t = grid[y][x];
            if (t === TILE.LAND) ctx.fillStyle = '#2f7d6b';
            else if (t === TILE.TRAIL) ctx.fillStyle = '#f5d24a';
            else ctx.fillStyle = '#0a2233';
            ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
            if (t === TILE.LAND) {
                ctx.fillStyle = 'rgba(255,255,255,0.06)';
                ctx.fillRect(x * CELL, y * CELL, CELL, 2);
            }
        }
    }
    // Enemies.
    for (const e of enemies) {
        ctx.fillStyle = '#ff5d6c';
        ctx.beginPath();
        ctx.arc(e.x * CELL + CELL / 2, e.y * CELL + CELL / 2, CELL * 0.42, 0, Math.PI * 2);
        ctx.fill();
    }
    // Player.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(player.x * CELL + 1, player.y * CELL + 1, CELL - 2, CELL - 2);
    ctx.fillStyle = '#35d0ba';
    ctx.fillRect(player.x * CELL + 3, player.y * CELL + 3, CELL - 6, CELL - 6);

    animId = requestAnimationFrame(render);
}

// =====================================================================
// HUD & overlay
// =====================================================================

function updateHud() {
    if (percentEl) percentEl.textContent = percent;
    if (targetEl) targetEl.textContent = targetPercent;
    if (livesEl) livesEl.textContent = Math.max(0, lives);
    if (scoreEl) scoreEl.textContent = score;
    if (bestEl) bestEl.textContent = best;
}

function showOverlay(title, scoreText, sub) {
    if (!overlay) return;
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    if (overlay) overlay.classList.remove('visible');
}

function saveBest() {
    if (score > best) {
        best = score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
    }
}

// =====================================================================
// Loop control
// =====================================================================

function startLoops() {
    stopLoops();
    tickTimer = setInterval(() => {
        if (state !== 'running') return;
        if (dir) movePlayer(dir.x, dir.y);
        if (state === 'running') enemyStep();
    }, TICK_MS);
    if (ctx && animId === null) render();
}

function stopLoops() {
    if (tickTimer !== null) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
}

function startGame() {
    if (state === 'running') return;
    if (state === 'won' || state === 'lost') newGame();
    state = 'running';
    hideOverlay();
    startLoops();
}

function restartGame() {
    newGame();
    state = 'running';
    hideOverlay();
    startLoops();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// =====================================================================
// Input
// =====================================================================

const MOVE_KEYS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
};

function handleKey(e) {
    const key = e.key;
    if (key === 'p' || key === 'P') { togglePause(); e.preventDefault(); return; }
    if (key === 'r' || key === 'R') { restartGame(); e.preventDefault(); return; }

    const d = MOVE_KEYS[key];
    if (!d) return;
    e.preventDefault();
    if (state === 'ready') startGame();
    if (state === 'running') dir = { x: d[0], y: d[1] };
}

// =====================================================================
// Bootstrap
// =====================================================================

function init() {
    try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { best = 0; }
    newGame();
    state = 'ready';
    updateHud();
    if (ctx) render();
    showOverlay('Xonix', '', "Carve out the sea into land — don't let the drones touch your trail!");
}

if (typeof document !== 'undefined') {
    document.addEventListener('keydown', handleKey);
    if (btnStart) btnStart.addEventListener('click', startGame);
    init();
}
