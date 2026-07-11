// ---------------------------------------------------------------------------
// Sokoban — push every crate onto a goal square. Pure, deterministic grid
// logic: `move`, `undo`, `reset`, `loadLevel` and `isSolved` are all exposed
// on `window` so the Playwright suite can drive the game without pixels.
//
// Cell symbols in a level's ASCII rows:
//   #  wall      (space) floor      .  goal
//   $  crate     *  crate-on-goal   @  player     +  player-on-goal
// ---------------------------------------------------------------------------

// Levels are authored as arrays of equal-width ASCII rows. Every one has
// exactly one player and an equal, non-zero number of crates and goals. All
// are verified solvable.
const LEVELS = [
    // 1 — one crate, straight push (teaches the basic move)
    [
        '#######',
        '#     #',
        '#@ $ .#',
        '#     #',
        '#######',
    ],
    // 2 — push a crate around a corner
    [
        '#######',
        '#@    #',
        '# $   #',
        '#   . #',
        '#     #',
        '#######',
    ],
    // 3 — two crates, two goals
    [
        '#######',
        '#  .  #',
        '#  $  #',
        '#.$@  #',
        '#     #',
        '#######',
    ],
    // 4 — a small room with a detour
    [
        '#######',
        '#  .  #',
        '# #$# #',
        '# $@. #',
        '# ### #',
        '#     #',
        '#######',
    ],
    // 5 — three crates
    [
        '########',
        '#      #',
        '# .$.$ #',
        '#  @   #',
        '# $ .  #',
        '#      #',
        '########',
    ],
    // 6 — classic tight squeeze
    [
        '########',
        '#. #   #',
        '#  $ . #',
        '# $#$  #',
        '#  . @ #',
        '#      #',
        '########',
    ],
];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const levelEl = document.getElementById('level');
const movesEl = document.getElementById('moves');
const pushesEl = document.getElementById('pushes');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnUndo = document.getElementById('btn-undo');
const btnReset = document.getElementById('btn-reset');
const btnNext = document.getElementById('btn-next');

// --- Canonical mutable state (kept on window so refs stay stable for tests) ---
window.player = { x: 0, y: 0 };
window.crates = [];              // array of { x, y }
window.state = 'start';          // 'start' | 'running' | 'solved' | 'won'
window.LEVELS = LEVELS;

const player = window.player;
const crates = window.crates;

let staticGrid = [];             // 2D array: 'wall' | 'floor' | 'goal'
let gridW = 0, gridH = 0;
let levelIndex = 0;              // index into LEVELS
let levelKey = '0';              // localStorage key suffix for "best"
let currentRows = null;          // the source rows of the loaded level
let moves = 0, pushes = 0;
let history = [];

function setState(v) {
    window.state = v;
}

// ---------------------------------------------------------------------------
// Level loading
// ---------------------------------------------------------------------------
function applyRows(rows) {
    currentRows = rows.slice();
    gridH = rows.length;
    gridW = Math.max(...rows.map((r) => r.length));
    staticGrid = [];
    crates.length = 0;
    for (let y = 0; y < gridH; y++) {
        const line = rows[y];
        const gridRow = [];
        for (let x = 0; x < gridW; x++) {
            const ch = line[x] || ' ';
            switch (ch) {
                case '#':
                    gridRow.push('wall');
                    break;
                case '.':
                    gridRow.push('goal');
                    break;
                case '$':
                    gridRow.push('floor');
                    crates.push({ x, y });
                    break;
                case '*':
                    gridRow.push('goal');
                    crates.push({ x, y });
                    break;
                case '@':
                    gridRow.push('floor');
                    player.x = x;
                    player.y = y;
                    break;
                case '+':
                    gridRow.push('goal');
                    player.x = x;
                    player.y = y;
                    break;
                default:
                    gridRow.push('floor');
            }
        }
        staticGrid.push(gridRow);
    }
    moves = 0;
    pushes = 0;
    history = [];
}

// Load a built-in level by index; resets counters and shows level N+1.
function loadLevel(n) {
    levelIndex = ((n % LEVELS.length) + LEVELS.length) % LEVELS.length;
    levelKey = String(levelIndex);
    applyRows(LEVELS[levelIndex]);
    setState('running');
    hideOverlay();
    updateHud();
    draw();
    return true;
}

// Load an arbitrary level (used by the test suite). Best is stored under
// the 'custom' key so it never collides with the built-in levels.
function loadCustomLevel(rows) {
    levelKey = 'custom';
    applyRows(rows);
    setState('running');
    hideOverlay();
    updateHud();
    draw();
    return true;
}

// Set up a level for display without starting play (used at page load).
function initLevel(n) {
    levelIndex = n;
    levelKey = String(n);
    applyRows(LEVELS[n]);
    updateHud();
    draw();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
function isWall(x, y) {
    if (y < 0 || y >= gridH || x < 0 || x >= gridW) return true;
    return staticGrid[y][x] === 'wall';
}

function crateAt(x, y) {
    for (let i = 0; i < crates.length; i++) {
        if (crates[i].x === x && crates[i].y === y) return i;
    }
    return -1;
}

function isSolved() {
    for (const c of crates) {
        if (staticGrid[c.y][c.x] !== 'goal') return false;
    }
    return crates.length > 0;
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------
function snapshot() {
    return {
        px: player.x,
        py: player.y,
        crates: crates.map((c) => ({ x: c.x, y: c.y })),
        moves,
        pushes,
    };
}

// Attempt to step (dx, dy). Returns true if the move was accepted.
function move(dx, dy) {
    if (window.state !== 'running') return false;

    const nx = player.x + dx;
    const ny = player.y + dy;
    if (isWall(nx, ny)) return false;

    const ci = crateAt(nx, ny);
    let pushed = false;
    let bx, by;
    if (ci >= 0) {
        bx = nx + dx;
        by = ny + dy;
        // Can't push into a wall or into another crate.
        if (isWall(bx, by) || crateAt(bx, by) >= 0) return false;
        pushed = true;
    }

    history.push(snapshot());
    if (pushed) {
        crates[ci].x = bx;
        crates[ci].y = by;
    }
    player.x = nx;
    player.y = ny;
    moves += 1;
    if (pushed) pushes += 1;

    updateHud();
    draw();

    if (isSolved()) handleWin();
    return true;
}

function undo() {
    if (history.length === 0) return false;
    const s = history.pop();
    player.x = s.px;
    player.y = s.py;
    crates.length = 0;
    s.crates.forEach((c) => crates.push({ x: c.x, y: c.y }));
    moves = s.moves;
    pushes = s.pushes;
    if (window.state !== 'running') {
        setState('running');
        hideOverlay();
    }
    updateHud();
    draw();
    return true;
}

function reset() {
    if (!currentRows) return false;
    applyRows(currentRows);
    setState('running');
    hideOverlay();
    updateHud();
    draw();
    return true;
}

function nextLevel() {
    if (levelKey === 'custom') {
        loadLevel(0);
    } else {
        loadLevel(levelIndex + 1);
    }
}

// ---------------------------------------------------------------------------
// Win handling & persistence
// ---------------------------------------------------------------------------
function bestKey() {
    return 'sokoban.best.' + levelKey;
}

function recordBest() {
    try {
        const prev = parseInt(localStorage.getItem(bestKey()), 10);
        if (isNaN(prev) || moves < prev) {
            localStorage.setItem(bestKey(), String(moves));
        }
    } catch (e) {
        /* localStorage unavailable — ignore */
    }
}

function handleWin() {
    recordBest();
    updateHud();
    const isFinal = levelKey !== 'custom' && levelIndex === LEVELS.length - 1;
    setState(isFinal ? 'won' : 'solved');
    if (isFinal) {
        showOverlay('You win! 🎉', `All levels solved. Final level in ${moves} moves.`, 'Play again');
    } else {
        showOverlay('Level solved!', `Cleared in ${moves} moves (${pushes} pushes).`, 'Next level');
    }
}

// ---------------------------------------------------------------------------
// Overlay & HUD
// ---------------------------------------------------------------------------
function showOverlay(title, sub, buttonLabel) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    if (buttonLabel) btnStart.textContent = buttonLabel;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function updateHud() {
    levelEl.textContent = levelKey === 'custom' ? '–' : String(levelIndex + 1);
    movesEl.textContent = String(moves);
    pushesEl.textContent = String(pushes);
    let best = null;
    try {
        best = localStorage.getItem(bestKey());
    } catch (e) {
        best = null;
    }
    bestEl.textContent = best === null ? '–' : best;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const tile = Math.floor(Math.min(canvas.width / gridW, canvas.height / gridH));
    const offX = Math.floor((canvas.width - tile * gridW) / 2);
    const offY = Math.floor((canvas.height - tile * gridH) / 2);

    for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
            const px = offX + x * tile;
            const py = offY + y * tile;
            const cell = staticGrid[y][x];
            if (cell === 'wall') {
                ctx.fillStyle = '#3a4152';
                ctx.fillRect(px, py, tile, tile);
                ctx.fillStyle = '#2c313f';
                ctx.fillRect(px + 2, py + 2, tile - 4, tile - 4);
            } else {
                ctx.fillStyle = '#1d2029';
                ctx.fillRect(px, py, tile, tile);
                if (cell === 'goal') {
                    ctx.fillStyle = '#ffcf6b';
                    ctx.beginPath();
                    ctx.arc(px + tile / 2, py + tile / 2, Math.max(3, tile * 0.13), 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }

    // Crates
    for (const c of crates) {
        const px = offX + c.x * tile;
        const py = offY + c.y * tile;
        const onGoal = staticGrid[c.y][c.x] === 'goal';
        ctx.fillStyle = onGoal ? '#7bd88f' : '#c98b52';
        ctx.fillRect(px + tile * 0.14, py + tile * 0.14, tile * 0.72, tile * 0.72);
        ctx.strokeStyle = onGoal ? '#3f8f52' : '#8a5a2b';
        ctx.lineWidth = Math.max(1, tile * 0.05);
        ctx.strokeRect(px + tile * 0.14, py + tile * 0.14, tile * 0.72, tile * 0.72);
        // diagonal cross detail
        ctx.beginPath();
        ctx.moveTo(px + tile * 0.14, py + tile * 0.14);
        ctx.lineTo(px + tile * 0.86, py + tile * 0.86);
        ctx.moveTo(px + tile * 0.86, py + tile * 0.14);
        ctx.lineTo(px + tile * 0.14, py + tile * 0.86);
        ctx.stroke();
    }

    // Player
    const ppx = offX + player.x * tile + tile / 2;
    const ppy = offY + player.y * tile + tile / 2;
    ctx.fillStyle = '#6bb6ff';
    ctx.beginPath();
    ctx.arc(ppx, ppy, tile * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14161c';
    ctx.beginPath();
    ctx.arc(ppx, ppy, tile * 0.13, 0, Math.PI * 2);
    ctx.fill();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const DIRS = {
    arrowup: [0, -1], w: [0, -1],
    arrowdown: [0, 1], s: [0, 1],
    arrowleft: [-1, 0], a: [-1, 0],
    arrowright: [1, 0], d: [1, 0],
};

function startGame() {
    // Fresh play always begins at level 1.
    loadLevel(0);
}

document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in DIRS || k === ' ') e.preventDefault();

    if (window.state === 'start') {
        if (k in DIRS || k === 'enter' || k === ' ') {
            startGame();
            if (k in DIRS) {
                const [dx, dy] = DIRS[k];
                move(dx, dy);
            }
        }
        return;
    }

    if (window.state === 'solved' || window.state === 'won') {
        if (k === 'n' || k === 'enter' || k === ' ') nextLevel();
        else if (k === 'u' || k === 'z') undo();
        else if (k === 'r') reset();
        return;
    }

    // running
    if (k in DIRS) {
        const [dx, dy] = DIRS[k];
        move(dx, dy);
    } else if (k === 'u' || k === 'z') {
        undo();
    } else if (k === 'r') {
        reset();
    } else if (k === 'n') {
        nextLevel();
    }
});

btnStart.addEventListener('click', () => {
    if (window.state === 'start') startGame();
    else nextLevel();
});
btnUndo.addEventListener('click', undo);
btnReset.addEventListener('click', reset);
btnNext.addEventListener('click', nextLevel);

// ---------------------------------------------------------------------------
// Expose API for tests
// ---------------------------------------------------------------------------
window.move = move;
window.undo = undo;
window.reset = reset;
window.loadLevel = loadLevel;
window.loadCustomLevel = loadCustomLevel;
window.isSolved = isSolved;
window.nextLevel = nextLevel;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
initLevel(0);
setState('start');
