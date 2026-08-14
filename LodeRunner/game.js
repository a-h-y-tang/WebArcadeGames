// ---------------------------------------------------------------------------
// Lode Runner — a grid platformer on an HTML5 canvas.
//
// The runner cannot jump or fight; it can only drill a single brick out of the
// floor to its left or right. Collect every gold chest on a level and the
// hidden escape ladders appear, letting the runner climb off the top of the
// screen. Guards chase relentlessly and can only be beaten by dropping them
// into a drilled hole — which seals itself a few seconds later, crushing
// whatever is still inside.
//
// Written as a single classic (non-module) script so all state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Snake, Tetris
// and BurgerTime in this repo. Actors move cell-to-cell and only take decisions
// when they are aligned on a cell, and `step(dt)` carries leftover time across
// cell boundaries, so a fixed number of steps always produces exactly the same
// world — no dependence on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Grid ----------------------------------------------------------------
const TILE = 24;
let COLS = 28;
let ROWS = 16;

const EMPTY = 'empty';
const BRICK = 'brick';
const SOLID = 'solid';
const LADDER = 'ladder';
const ROPE = 'rope';
const HOLE = 'hole';

// --- Tuning (cells per second, seconds) ----------------------------------
const RUN_SPEED = 6.0;
const CLIMB_SPEED = 5.0;
const FALL_SPEED = 10.0;
const GUARD_RUN = 4.2;
const GUARD_CLIMB = 3.6;
const GUARD_FALL = 9.0;

const HOLE_TIME = 5.0;    // how long a drilled brick stays open
const HOLE_WARN = 1.2;    // the brick visibly reforms over the last stretch
const TRAP_TIME = 2.6;    // how long a guard flounders before climbing out
const HIT_BOX = 0.65;     // collision half-extent, in cells

const GOLD_SCORE = 100;
const CRUSH_SCORE = 75;
const LEVEL_BONUS = 500;
const START_LIVES = 3;
const BEST_KEY = 'loderunner.best';

// --- Levels --------------------------------------------------------------
// '.' empty  '#' brick  '=' bedrock  'H' ladder  '-' rope
// '$' gold   '@' runner  'X' guard   'E' escape ladder (hidden until gold is gone)
const LEVELS = [
    [
        '.E........................E.',
        '.E........................E.',
        '.E........................E.',
        '.E...$.......H........$...E.',
        '.#######...##H###...#######.',
        '..........---H----..........',
        '......$......H....H.....$...',
        '..####..##########H##..###..',
        '..................H.........',
        '....$....H.....$..H.........',
        '.########H####..#####..####.',
        '.....----H---...............',
        '....H....H.....$....$..H....',
        '.###H######..##########H###.',
        '.@..H...$....X....$....H..X.',
        '============================',
    ],
    [
        '..E......................E..',
        '..E......................E..',
        '..E......................E..',
        '..E...$..........$.......E..',
        '..########H###..##########..',
        '..........H.................',
        '..........H----------.......',
        '....$.....H...$..H.....$....',
        '.######..########H####..###.',
        '.................H..........',
        '........---------H..........',
        '..$...H......$...H...H...$..',
        '.#####H######..######H#####.',
        '......H.............H.......',
        '.@....H..$..X....$...H..X...',
        '============================',
    ],
    [
        '.............E..............',
        '.............E..............',
        '.....$..H....E.....H.$......',
        '...#####H#..####..#H#####...',
        '........H..........H........',
        '..$H....H..$.......H....H.$.',
        '.##H#..###############..H##.',
        '...H....................H...',
        '...H...$.....H...$......H...',
        '..########..#H####..######..',
        '....---------H..............',
        '...$...H.....H......H...$...',
        '.######H#######..###H######.',
        '.......H............H.......',
        '.@..$..H..X.....X...H..$..X.',
        '============================',
    ],
];

// --- State ---------------------------------------------------------------
let grid = [];            // grid[r][c] — one of the tile constants
let escapeCells = [];     // cells that turn into ladders once the gold is gone
let gold = [];            // { c, r, taken }
let goldRemaining = 0;
let escapeRevealed = false;
let holes = [];           // { c, r, timer }
let player = makeActor(0, 0);
let guards = [];
let currentRows = LEVELS[0];
let state = 'idle';       // idle | playing | paused | gameover | won
let score = 0;
let lives = START_LIVES;
let level = 1;
let best = 0;
let autoStep = true;      // the tests turn this off and drive step() themselves
let flow = null;          // BFS distance-to-runner field used by the guards
let elapsed = 0;          // total simulated time, drives the animations
let banner = '';          // transient message drawn over the board
let bannerTimer = 0;

const input = { left: false, right: false, up: false, down: false };

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const startBtn = document.getElementById('btn-start');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const goldEl = document.getElementById('gold');
const bestEl = document.getElementById('best');

function makeActor(c, r) {
    return {
        c, r, tc: c, tr: r,
        p: 0,
        moving: false,
        speed: 0,
        falling: false,
        face: 1,          // last horizontal facing, for drawing
        climbing: false,
        anim: 0,
        trapped: false,
        trapTimer: 0,
        spawnC: c,
        spawnR: r,
    };
}

// --- Grid helpers --------------------------------------------------------
function tileAt(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return SOLID;
    return grid[r][c];
}

function canEnter(c, r) {
    const t = tileAt(c, r);
    return t !== BRICK && t !== SOLID;
}

// A cell is standable when something holds the actor up there: the tile itself
// (ladder or rope), whatever is directly below, a guard stuck in a hole below,
// or the bottom of the world.
function supported(c, r) {
    const here = tileAt(c, r);
    if (here === LADDER || here === ROPE) return true;
    if (r >= ROWS - 1) return true;
    const below = tileAt(c, r + 1);
    if (below === BRICK || below === SOLID || below === LADDER) return true;
    return guards.some((g) => g.trapped && g.c === c && g.r === r + 1);
}

function posX(a) { return a.c + (a.tc - a.c) * a.p; }
function posY(a) { return a.r + (a.tr - a.r) * a.p; }
function cellX(a) { return Math.round(posX(a)); }
function cellY(a) { return Math.round(posY(a)); }

// --- Level loading -------------------------------------------------------
function parseLevel(rows) {
    ROWS = rows.length;
    COLS = rows[0].length;
    grid = [];
    escapeCells = [];
    gold = [];
    guards = [];
    holes = [];
    goldRemaining = 0;
    escapeRevealed = false;
    flow = null;

    let spawn = { c: 1, r: ROWS - 2 };

    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
            const ch = rows[r][c];
            let tile = EMPTY;
            if (ch === '#') tile = BRICK;
            else if (ch === '=') tile = SOLID;
            else if (ch === 'H') tile = LADDER;
            else if (ch === '-') tile = ROPE;
            else if (ch === '$') gold.push({ c, r, taken: false });
            else if (ch === '@') spawn = { c, r };
            else if (ch === 'X') guards.push(makeActor(c, r));
            else if (ch === 'E') escapeCells.push({ c, r });
            row.push(tile);
        }
        grid.push(row);
    }

    goldRemaining = gold.length;
    player = makeActor(spawn.c, spawn.r);
    if (goldRemaining === 0) revealEscape();

    canvas.width = COLS * TILE;
    canvas.height = ROWS * TILE;
    resetInput();
}

function loadLevel(index) {
    level = index + 1;
    currentRows = LEVELS[index];
    parseLevel(currentRows);
    state = 'playing';
    hideOverlay();
}

function resetLevel() {
    parseLevel(currentRows);
}

// Test hook: build a level out of an array of equal-length map strings and put
// the game straight into manual-stepping mode.
function loadLevelFromStrings(rows) {
    currentRows = rows.slice();
    parseLevel(currentRows);
    autoStep = false;
    state = 'playing';
    hideOverlay();
}

// Test hooks: drop an actor onto a cell so a single rule can be exercised.
function setPlayerCell(c, r) { placeActor(player, c, r); }
function setGuardCell(i, c, r) { placeActor(guards[i], c, r); }

function placeActor(a, c, r) {
    a.c = c; a.r = r; a.tc = c; a.tr = r;
    a.p = 0; a.moving = false; a.falling = false; a.climbing = false;
    a.trapped = false; a.trapTimer = 0;
}

function revealEscape() {
    escapeRevealed = true;
    for (const cell of escapeCells) grid[cell.r][cell.c] = LADDER;
}

// --- Movement engine -----------------------------------------------------
// Actors only choose a direction when aligned on a cell. `decide` starts a move
// by filling in tc/tr/speed; leftover time rolls into the next cell so the
// result of N steps never depends on how the cells happen to line up.
function moveActor(a, dt, decide) {
    let remaining = dt;
    let hops = 0;
    while (remaining > 1e-9 && hops++ < 32) {
        if (!a.moving) {
            decide(a);
            if (!a.moving) return;
        }
        const need = (1 - a.p) / a.speed;
        if (need > remaining) {
            a.p += a.speed * remaining;
            return;
        }
        remaining -= need;
        a.c = a.tc;
        a.r = a.tr;
        a.p = 0;
        a.moving = false;
        if (a === player) onPlayerArrive();
    }
}

function startMove(a, c, r, speed) {
    a.tc = c;
    a.tr = r;
    a.p = 0;
    a.speed = speed;
    a.moving = true;
    if (c !== a.c) a.face = Math.sign(c - a.c);
}

// --- Runner --------------------------------------------------------------
function decidePlayer(a) {
    if (!supported(a.c, a.r) && canEnter(a.c, a.r + 1)) {
        a.falling = true;
        a.climbing = false;
        startMove(a, a.c, a.r + 1, FALL_SPEED);
        return;
    }
    a.falling = false;
    a.climbing = false;

    if (input.up && tileAt(a.c, a.r) === LADDER && canEnter(a.c, a.r - 1)) {
        a.climbing = true;
        startMove(a, a.c, a.r - 1, CLIMB_SPEED);
    } else if (input.down && canEnter(a.c, a.r + 1)) {
        a.climbing = tileAt(a.c, a.r + 1) === LADDER;
        startMove(a, a.c, a.r + 1, CLIMB_SPEED);
    } else if (input.left && canEnter(a.c - 1, a.r)) {
        startMove(a, a.c - 1, a.r, RUN_SPEED);
    } else if (input.right && canEnter(a.c + 1, a.r)) {
        startMove(a, a.c + 1, a.r, RUN_SPEED);
    }
}

function onPlayerArrive() {
    collectGold(player.c, player.r);
}

function collectGold(c, r) {
    for (const g of gold) {
        if (g.taken || g.c !== c || g.r !== r) continue;
        g.taken = true;
        goldRemaining--;
        addScore(GOLD_SCORE);
        if (goldRemaining === 0) {
            revealEscape();
            showBanner('ESCAPE LADDERS REVEALED');
        }
    }
}

// --- Drilling ------------------------------------------------------------
function dig(dir) {
    if (state !== 'playing') return false;
    const a = player;
    if (a.moving || a.p !== 0 || a.falling) return false;

    // Feet must be on real floor: not a ladder, not a rope, not thin air.
    const here = tileAt(a.c, a.r);
    if (here === LADDER || here === ROPE) return false;
    const below = tileAt(a.c, a.r + 1);
    if (below !== BRICK && below !== SOLID) return false;

    const tc = a.c + dir;
    const tr = a.r + 1;
    if (tileAt(tc, tr) !== BRICK) return false;      // only brick drills
    if (!canEnter(tc, tr - 1)) return false;         // need clearance to reach it
    if (holes.some((h) => h.c === tc && h.r === tr)) return false;
    if (actorsIn(tc, tr).length > 0) return false;

    grid[tr][tc] = HOLE;
    holes.push({ c: tc, r: tr, timer: 0 });
    return true;
}

function digLeft() { return dig(-1); }
function digRight() { return dig(1); }

function actorsIn(c, r) {
    return [player, ...guards].filter((a) => cellX(a) === c && cellY(a) === r);
}

function updateHoles(dt) {
    for (let i = holes.length - 1; i >= 0; i--) {
        const h = holes[i];
        h.timer += dt;
        if (h.timer < HOLE_TIME) continue;
        grid[h.r][h.c] = BRICK;
        holes.splice(i, 1);
        crushIn(h.c, h.r);
    }
}

function crushIn(c, r) {
    for (const g of guards) {
        if (cellX(g) === c && cellY(g) === r) {
            addScore(CRUSH_SCORE);
            respawnGuard(g);
        }
    }
    if (cellX(player) === c && cellY(player) === r) killPlayer();
}

function respawnGuard(g) {
    placeActor(g, g.spawnC, g.spawnR);
}

// --- Guards --------------------------------------------------------------
// Breadth-first flood from the runner over the reverse movement graph: flow[i]
// is how many moves a guard standing on cell i needs to reach the runner.
function computeFlow() {
    const dist = new Int32Array(COLS * ROWS).fill(-1);
    const start = cellY(player) * COLS + cellX(player);
    if (!canEnter(cellX(player), cellY(player))) {
        flow = dist;
        return;
    }
    dist[start] = 0;
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        const c = idx % COLS;
        const r = (idx - c) / COLS;
        const d = dist[idx];
        // Predecessors: cells an actor could have moved *from* to reach (c, r).
        const from = [
            { c: c - 1, r, ok: true },
            { c: c + 1, r, ok: true },
            { c, r: r - 1, ok: true },                             // fell/climbed down
            { c, r: r + 1, ok: tileAt(c, r + 1) === LADDER },      // climbed up
        ];
        for (const f of from) {
            if (!f.ok || !canEnter(f.c, f.r)) continue;
            const fi = f.r * COLS + f.c;
            if (dist[fi] !== -1) continue;
            dist[fi] = d + 1;
            queue.push(fi);
        }
    }
    flow = dist;
}

function flowAt(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1;
    return flow[r * COLS + c];
}

function decideGuard(a) {
    if (a.trapped) return;

    if (!supported(a.c, a.r) && canEnter(a.c, a.r + 1)) {
        a.falling = true;
        startMove(a, a.c, a.r + 1, GUARD_FALL);
        return;
    }
    a.falling = false;

    // A guard that came to rest inside an open hole is stuck there.
    if (tileAt(a.c, a.r) === HOLE) {
        a.trapped = true;
        a.trapTimer = 0;
        return;
    }

    const toward = Math.sign(cellX(player) - a.c) || a.face || 1;
    const options = [];
    if (canEnter(a.c - 1, a.r)) options.push({ c: a.c - 1, r: a.r, speed: GUARD_RUN, bias: toward < 0 ? 0 : 1 });
    if (canEnter(a.c + 1, a.r)) options.push({ c: a.c + 1, r: a.r, speed: GUARD_RUN, bias: toward > 0 ? 0 : 1 });
    if (tileAt(a.c, a.r) === LADDER && canEnter(a.c, a.r - 1)) {
        options.push({ c: a.c, r: a.r - 1, speed: GUARD_CLIMB, bias: 2 });
    }
    if (canEnter(a.c, a.r + 1)) options.push({ c: a.c, r: a.r + 1, speed: GUARD_CLIMB, bias: 2 });

    let pick = null;
    for (const o of options) {
        const d = flowAt(o.c, o.r);
        if (d < 0) continue;
        if (!pick || d < pick.d || (d === pick.d && o.bias < pick.bias)) {
            pick = { ...o, d };
        }
    }

    // No route (the runner is unreachable right now): shuffle toward them anyway,
    // which is how guards blunder into freshly drilled holes.
    if (!pick && canEnter(a.c + toward, a.r)) {
        pick = { c: a.c + toward, r: a.r, speed: GUARD_RUN };
    }
    if (pick) startMove(a, pick.c, pick.r, pick.speed);
}

function updateGuard(g, dt) {
    if (g.trapped) {
        if (!g.moving) {
            g.trapTimer += dt;
            if (g.trapTimer >= TRAP_TIME) climbOut(g);
            return;
        }
        moveActor(g, dt, () => { });
        if (!g.moving) g.trapped = false;
        return;
    }
    moveActor(g, dt, decideGuard);
}

// Hop out of the hole onto the lip beside it, preferring the runner's side.
function climbOut(g) {
    const toward = Math.sign(cellX(player) - g.c) || 1;
    const sides = [toward, -toward];
    for (const s of sides) {
        if (canEnter(g.c + s, g.r - 1) && supported(g.c + s, g.r - 1)) {
            startMove(g, g.c + s, g.r - 1, GUARD_CLIMB);
            return;
        }
    }
    if (canEnter(g.c, g.r - 1)) {
        startMove(g, g.c, g.r - 1, GUARD_CLIMB);
        return;
    }
    g.trapTimer = 0;
}

// --- Collisions and life cycle -------------------------------------------
function checkCaught() {
    const px = posX(player);
    const py = posY(player);
    for (const g of guards) {
        if (g.trapped) continue;
        if (Math.abs(posX(g) - px) < HIT_BOX && Math.abs(posY(g) - py) < HIT_BOX) {
            killPlayer();
            return;
        }
    }
}

function killPlayer() {
    lives--;
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    showBanner('CAUGHT!');
    resetLevel();
}

function completeLevel() {
    addScore(LEVEL_BONUS);
    if (level >= LEVELS.length) {
        state = 'won';
        saveBest();
        showOverlay('YOU ESCAPED', `Final score ${score}`, 'Press Space to play again');
        return;
    }
    showBanner('LEVEL CLEAR');
    loadLevel(level);
}

function gameOver() {
    state = 'gameover';
    saveBest();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to try again');
}

function addScore(points) {
    score += points;
    if (score > best) best = score;
}

function saveBest() {
    try {
        localStorage.setItem(BEST_KEY, String(Math.max(best, score)));
    } catch (err) {
        /* storage unavailable — the run just isn't remembered */
    }
}

function loadBest() {
    try {
        best = Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
        best = 0;
    }
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    autoStep = true;
    banner = '';
    bannerTimer = 0;
    loadLevel(0);
}

// --- Simulation ----------------------------------------------------------
function step(dt) {
    if (state !== 'playing') return;
    elapsed += dt;
    if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0) banner = '';
    }

    updateHoles(dt);
    if (state !== 'playing') return;   // a refilling brick may have crushed us

    computeFlow();
    moveActor(player, dt, decidePlayer);
    collectGold(cellX(player), cellY(player));
    player.anim += dt;

    for (const g of guards) {
        updateGuard(g, dt);
        g.anim += dt;
    }

    checkCaught();
    if (state !== 'playing') return;

    // The top of the screen is only an exit once the escape ladders are up, so a
    // level without any (a bare test fixture, say) can never be climbed out of.
    if (escapeRevealed && escapeCells.length > 0 && cellY(player) === 0 && !player.moving) {
        completeLevel();
    }
}

// --- Input ---------------------------------------------------------------
function resetInput() {
    input.left = false;
    input.right = false;
    input.up = false;
    input.down = false;
}

const KEY_MAP = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
};

document.addEventListener('keydown', (e) => {
    const dir = KEY_MAP[e.key];
    if (dir) {
        input[dir] = true;
        e.preventDefault();
        return;
    }
    if (e.key === 'z' || e.key === 'Z' || e.key === ',') {
        digLeft();
        e.preventDefault();
    } else if (e.key === 'x' || e.key === 'X' || e.key === '.') {
        digRight();
        e.preventDefault();
    } else if (e.key === 'p' || e.key === 'P') {
        togglePause();
    } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (state === 'idle' || state === 'gameover' || state === 'won') startGame();
    }
});

document.addEventListener('keyup', (e) => {
    const dir = KEY_MAP[e.key];
    if (dir) input[dir] = false;
});

startBtn.addEventListener('click', () => {
    if (state !== 'playing') startGame();
});

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'playing';
        hideOverlay();
    }
}

// --- Overlay / HUD -------------------------------------------------------
function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    overlaySub.textContent = sub || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function showBanner(text) {
    banner = text;
    bannerTimer = 1.4;
}

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    goldEl.textContent = String(goldRemaining);
    bestEl.textContent = String(Math.max(best, score));
}

// --- Rendering -----------------------------------------------------------
function render() {
    updateHud();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    drawGrid();
    drawGold();
    for (const g of guards) drawActor(g, true);
    drawActor(player, false);
    drawBanner();
}

function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#0d1524');
    g.addColorStop(1, '#060a12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(80, 120, 190, 0.06)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(c * TILE + 0.5, 0);
        ctx.lineTo(c * TILE + 0.5, canvas.height);
        ctx.stroke();
    }
}

function drawGrid() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = c * TILE;
            const y = r * TILE;
            const t = grid[r][c];
            if (t === BRICK) drawBrick(x, y, 1);
            else if (t === SOLID) drawBedrock(x, y);
            else if (t === LADDER) drawLadder(x, y, escapeCells.some((e) => e.c === c && e.r === r));
            else if (t === ROPE) drawRope(x, y);
            else if (t === HOLE) drawHole(x, y, c, r);
        }
    }
}

function drawBrick(x, y, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#8a4b2a';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#a55c34';
    ctx.fillRect(x + 1, y + 1, TILE - 2, TILE / 2 - 2);
    ctx.fillStyle = '#93502d';
    ctx.fillRect(x + 1, y + TILE / 2 + 1, TILE - 2, TILE / 2 - 2);
    ctx.strokeStyle = 'rgba(30, 14, 6, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + TILE / 2 + 0.5);
    ctx.lineTo(x + TILE, y + TILE / 2 + 0.5);
    ctx.moveTo(x + TILE / 2 + 0.5, y);
    ctx.lineTo(x + TILE / 2 + 0.5, y + TILE / 2);
    ctx.moveTo(x + 0.5, y + TILE / 2);
    ctx.lineTo(x + 0.5, y + TILE);
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function drawBedrock(x, y) {
    ctx.fillStyle = '#33415c';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#3d4d6c';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = 'rgba(12, 18, 30, 0.55)';
    ctx.fillRect(x + 4, y + TILE - 8, TILE - 8, 3);
}

function drawLadder(x, y, isEscape) {
    ctx.strokeStyle = isEscape ? '#7dff9f' : '#d8b46a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 5, y);
    ctx.lineTo(x + 5, y + TILE);
    ctx.moveTo(x + TILE - 5, y);
    ctx.lineTo(x + TILE - 5, y + TILE);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
        const ry = y + 4 + i * 8;
        ctx.moveTo(x + 5, ry);
        ctx.lineTo(x + TILE - 5, ry);
    }
    ctx.stroke();
}

function drawRope(x, y) {
    ctx.strokeStyle = '#c9a86a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 5.5);
    ctx.lineTo(x + TILE, y + 5.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(201, 168, 106, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 4; i < TILE; i += 6) {
        ctx.moveTo(x + i, y + 5);
        ctx.lineTo(x + i, y + 9);
    }
    ctx.stroke();
}

function drawHole(x, y, c, r) {
    const h = holes.find((o) => o.c === c && o.r === r);
    ctx.fillStyle = '#05080f';
    ctx.fillRect(x, y, TILE, TILE);
    if (!h) return;
    const left = HOLE_TIME - h.timer;
    if (left < HOLE_WARN) {
        // The brick knits itself back together from the outside in.
        const grow = 1 - left / HOLE_WARN;
        const inset = (TILE / 2) * (1 - grow);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, TILE, TILE);
        ctx.clip();
        drawBrick(x, y, 0.35 + 0.65 * grow);
        ctx.restore();
        ctx.fillStyle = '#05080f';
        ctx.fillRect(x + inset, y + inset, TILE - inset * 2, TILE - inset * 2);
    }
}

function drawGold() {
    for (const g of gold) {
        if (g.taken) continue;
        const x = g.c * TILE + TILE / 2;
        const y = g.r * TILE + TILE / 2 + Math.sin(elapsed * 3 + g.c) * 1.2;
        ctx.fillStyle = '#ffd34d';
        ctx.beginPath();
        ctx.ellipse(x, y, TILE * 0.3, TILE * 0.24, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b98a12';
        ctx.beginPath();
        ctx.ellipse(x, y + 2, TILE * 0.3, TILE * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.beginPath();
        ctx.ellipse(x - 2, y - 2, 2.2, 1.4, -0.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawActor(a, isGuard) {
    const x = posX(a) * TILE;
    const y = posY(a) * TILE;
    const cx = x + TILE / 2;
    const body = isGuard ? '#ff5a4d' : '#4ec3ff';
    const trim = isGuard ? '#7d1b18' : '#12496b';

    const stride = a.moving && !a.falling ? Math.sin(a.anim * 18) : 0;
    const hang = tileAt(cellX(a), cellY(a)) === ROPE && !a.falling;

    ctx.fillStyle = trim;
    ctx.fillRect(cx - 6, y + 16, 5, 7 + stride * 2);
    ctx.fillRect(cx + 1, y + 16, 5, 7 - stride * 2);

    ctx.fillStyle = body;
    ctx.fillRect(cx - 6, y + 7, 12, 10);

    ctx.fillStyle = isGuard ? '#ffd0c8' : '#ffe6c4';
    ctx.beginPath();
    ctx.arc(cx, y + 5, 4.2, 0, Math.PI * 2);
    ctx.fill();

    // Arms: out to the sides when hanging, swinging otherwise.
    ctx.strokeStyle = body;
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (hang) {
        ctx.moveTo(cx - 7, y + 6);
        ctx.lineTo(cx - 2, y + 9);
        ctx.moveTo(cx + 7, y + 6);
        ctx.lineTo(cx + 2, y + 9);
    } else {
        ctx.moveTo(cx - 5, y + 9);
        ctx.lineTo(cx - 8, y + 13 + stride * 2);
        ctx.moveTo(cx + 5, y + 9);
        ctx.lineTo(cx + 8, y + 13 - stride * 2);
    }
    ctx.stroke();

    if (isGuard && a.trapped) {
        ctx.strokeStyle = 'rgba(255, 90, 77, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, y + 12, 10 + Math.sin(a.anim * 12) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawBanner() {
    if (!banner || bannerTimer <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, bannerTimer / 0.4);
    ctx.fillStyle = 'rgba(6, 10, 18, 0.75)';
    ctx.fillRect(0, canvas.height / 2 - 22, canvas.width, 44);
    ctx.fillStyle = '#ffd34d';
    ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner, canvas.width / 2, canvas.height / 2);
    ctx.restore();
}

// --- Main loop -----------------------------------------------------------
let lastTs = null;
function frame(ts) {
    const dt = lastTs === null ? 0 : Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (autoStep) step(dt);
    render();
    requestAnimationFrame(frame);
}

loadBest();
parseLevel(LEVELS[0]);
state = 'idle';
showOverlay('LODE RUNNER', '', 'Press Space or click Start to play');
updateHud();
requestAnimationFrame(frame);
