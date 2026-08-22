// ---------------------------------------------------------------------------
// Lode Runner — a grid platformer about gold, ladders and a digging laser.
//
// The runner collects every piece of gold on a level while five kinds of
// terrain decide where they may go: solid stone, diggable brick, ladders,
// hand-over-hand ropes and empty air. The runner cannot jump or fight; the only
// offensive move is burning a hole in the brick beside their feet, which drops
// pursuing guards into a pit that fills itself back in a few seconds later.
// Once the last coin is taken, a hidden escape ladder appears and the runner
// climbs off the top of the screen.
//
// Written as a single classic (non-module) script so state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. Actors step from cell to cell along a fixed
// grid: a move stores its start cell, target cell and a 0..1 progress value
// that advances at a cells-per-second speed, so `step(dt)` is fully
// deterministic and never depends on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Grid ----------------------------------------------------------------
const TILE = 24;
const COLS = 28;
const ROWS = 16;
const CANVAS_W = COLS * TILE;   // 672
const CANVAS_H = ROWS * TILE;   // 384

const EMPTY = 0;
const BRICK = 1;
const SOLID = 2;
const LADDER = 3;
const ROPE = 4;
const ESCAPE = 5;   // hidden ladder — empty air until the last coin is taken
const HOLE = 6;     // a burnt-out brick, passable until it fills back in

const CHAR_TILE = {
    '.': EMPTY,
    '#': BRICK,
    '@': SOLID,
    H: LADDER,
    '-': ROPE,
    S: ESCAPE,
    $: EMPTY,
    P: EMPTY,
    E: EMPTY,
};

// --- Speeds, in cells per second -----------------------------------------
// Chosen so that a move takes a whole number of 1/60s frames, which keeps the
// specs exact: walking 10 frames, climbing 12, falling 6, guards 15.
const PLAYER_SPEED = 6;
const CLIMB_SPEED = 5;
const FALL_SPEED = 10;
const ENEMY_SPEED = 4;
const ENEMY_CLIMB_SPEED = 3;
const ENEMY_ESCAPE_SPEED = 2.5;   // climbing out of a pit

// --- Rules ---------------------------------------------------------------
const HOLE_FILL_SECONDS = 5;
const HOLE_WARN_SECONDS = 1.5;
const TRAP_SECONDS = 2.5;
const DIG_COOLDOWN = 0.2;
const AI_PERIOD = 0.2;
const START_LIVES = 3;

const GOLD_POINTS = 150;
const ENEMY_POINTS = 75;
const LEVEL_BONUS = 500;

// --- Levels --------------------------------------------------------------
// '.' air   '#' brick   '@' stone   'H' ladder   '-' rope
// '$' gold  'S' hidden escape ladder   'P' runner spawn   'E' guard spawn
const LEVELS = [
    [
        '...........................S',
        '...........................S',
        '......$...........$....H...S',
        '...####################H###S',
        '.......................H...S',
        '........H...$..........H...S',
        '.#######H################..S',
        '........H-----------.......S',
        '...$....H...........H....$.S',
        '..##################H#####.S',
        '....................H......S',
        '.....H....$....$....H......S',
        '#####H####################.S',
        '.....H.....................S',
        '.P...H...$....E..$....E....S',
        '@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
    ],
    [
        'S...........................',
        'S...........................',
        'S...H....$.......$..........',
        'S###H#######################',
        'S...H...---------...........',
        'S...H.....$........H....$...',
        'S##################H######..',
        'S..................H........',
        'S...$.......H......H..$.....',
        'S###########H##############.',
        'S..-------..H...............',
        'S.....$.....H.......$...H...',
        'S#######################H###',
        'S.......................H...',
        'S....E..$......$...E....H.P.',
        '@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
    ],
    [
        'S...........................',
        'S...........................',
        'S...........................',
        'S...$..H...$........$.......',
        'S.#####H##################..',
        'S......H....................',
        'S......H-------------.......',
        'S...$..H..........$..H...$..',
        'S####################H#####.',
        'S....................H......',
        'S....................H......',
        'S..H..$..........$...H..$...',
        'S##H########################',
        'S..H....$...................',
        'SP.H..$..E.$......E..$...E..',
        '@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
    ],
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let grid = [];
let goldCells = [];
let holes = [];
let enemies = [];
let player = null;

let state = 'idle';       // idle | playing | paused | levelclear | won | gameover
let score = 0;
let best = 0;
let lives = START_LIVES;
let levelIndex = 0;
let goldRemaining = 0;
let escapeRevealed = false;
let digCooldown = 0;

const heldKeys = new Set();

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elGold = document.getElementById('gold');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

const cellX = (col) => col * TILE + TILE / 2;
const cellY = (row) => row * TILE + TILE / 2;

const inBounds = (col, row) => col >= 0 && col < COLS && row >= 0 && row < ROWS;

function tileAt(col, row) {
    if (!inBounds(col, row)) return SOLID;
    return grid[row][col];
}

function setTile(col, row, tile) {
    if (inBounds(col, row)) grid[row][col] = tile;
}

// Brick and stone stop everything; a burnt-out hole does not.
const isBlocking = (tile) => tile === BRICK || tile === SOLID;

function passable(col, row) {
    if (!inBounds(col, row)) return false;
    return !isBlocking(grid[row][col]);
}

// A hidden escape ladder is just air until the last coin has been taken.
function climbable(col, row) {
    if (!inBounds(col, row)) return false;
    const tile = grid[row][col];
    return tile === LADDER || (tile === ESCAPE && escapeRevealed);
}

const onRope = (col, row) => tileAt(col, row) === ROPE;

// A trapped guard's shoulders are a floor — the runner can sprint across them.
function trappedEnemyAt(col, row) {
    return enemies.some((e) => e.trapped && e.col === col && e.row === row);
}

function isSupported(col, row) {
    if (climbable(col, row) || onRope(col, row)) return true;
    if (row + 1 >= ROWS) return true;
    const below = tileAt(col, row + 1);
    if (isBlocking(below)) return true;
    if (below === LADDER || (below === ESCAPE && escapeRevealed)) return true;
    return trappedEnemyAt(col, row + 1);
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

function makeActor(col, row, kind) {
    return {
        kind,
        col,
        row,
        spawnCol: col,
        spawnRow: row,
        x: cellX(col),
        y: cellY(row),
        fromCol: col,
        fromRow: row,
        toCol: col,
        toRow: row,
        progress: 0,
        speed: 0,
        moving: false,
        mode: 'idle',   // idle | walk | climb | fall | climbout
        face: 1,
        anim: 0,
        trapped: false,
        trapTimer: 0,
        aiTimer: 0,
        path: null,
    };
}

function placeActor(actor, col, row) {
    actor.col = col;
    actor.row = row;
    actor.fromCol = col;
    actor.fromRow = row;
    actor.toCol = col;
    actor.toRow = row;
    actor.x = cellX(col);
    actor.y = cellY(row);
    actor.progress = 0;
    actor.moving = false;
    actor.mode = 'idle';
    actor.path = null;
}

function startMove(actor, dcol, drow, speed, mode) {
    actor.fromCol = actor.col;
    actor.fromRow = actor.row;
    actor.toCol = actor.col + dcol;
    actor.toRow = actor.row + drow;
    actor.progress = 0;
    actor.speed = speed;
    actor.mode = mode;
    actor.moving = true;
    if (dcol !== 0) actor.face = dcol;
}

// Returns true on the frame the actor lands on its target cell.
function advanceActor(actor, dt) {
    if (!actor.moving) return false;
    actor.progress += actor.speed * dt;
    actor.anim += dt;
    // Ten frames of 6/60 sum to 0.9999999999999999, so arrival needs a nudge of
    // tolerance — without it every move silently costs an extra frame.
    if (actor.progress >= 1 - 1e-9) {
        actor.col = actor.toCol;
        actor.row = actor.toRow;
        actor.x = cellX(actor.col);
        actor.y = cellY(actor.row);
        actor.progress = 0;
        actor.moving = false;
        actor.mode = 'idle';
        return true;
    }
    const t = actor.progress;
    actor.x = cellX(actor.fromCol) + (cellX(actor.toCol) - cellX(actor.fromCol)) * t;
    actor.y = cellY(actor.fromRow) + (cellY(actor.toRow) - cellY(actor.fromRow)) * t;
    return false;
}

// ---------------------------------------------------------------------------
// Level loading
// ---------------------------------------------------------------------------

function loadLevel(index) {
    const rows = LEVELS[index];
    grid = rows.map((row) => [...row].map((ch) => CHAR_TILE[ch] ?? EMPTY));
    goldCells = [];
    enemies = [];
    holes = [];
    escapeRevealed = false;
    digCooldown = 0;

    rows.forEach((row, r) => {
        [...row].forEach((ch, c) => {
            if (ch === '$') goldCells.push({ col: c, row: r });
            if (ch === 'P') player = makeActor(c, r, 'player');
            if (ch === 'E') enemies.push(makeActor(c, r, 'enemy'));
        });
    });

    goldRemaining = goldCells.length;
    updateHud();
}

// Put every actor back on its spawn and seal any open pits — used after a
// death, which costs a life but never the gold already banked.
function resetActors() {
    holes.forEach((hole) => setTile(hole.col, hole.row, BRICK));
    holes = [];
    digCooldown = 0;
    placeActor(player, player.spawnCol, player.spawnRow);
    enemies.forEach((enemy) => {
        placeActor(enemy, enemy.spawnCol, enemy.spawnRow);
        enemy.trapped = false;
        enemy.trapTimer = 0;
        enemy.path = null;
    });
}

// ---------------------------------------------------------------------------
// Gold and escape
// ---------------------------------------------------------------------------

function takeGold(cellRef) {
    const index = goldCells.indexOf(cellRef);
    if (index === -1) return false;
    goldCells.splice(index, 1);
    goldRemaining = goldCells.length;
    score += GOLD_POINTS;
    if (goldRemaining === 0) escapeRevealed = true;
    updateHud();
    return true;
}

function goldAt(col, row) {
    return goldCells.find((g) => g.col === col && g.row === row) || null;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

const KEY_ALIASES = {
    left: ['ArrowLeft', 'a', 'A'],
    right: ['ArrowRight', 'd', 'D'],
    up: ['ArrowUp', 'w', 'W'],
    down: ['ArrowDown', 's', 'S'],
};

const held = (name) => KEY_ALIASES[name].some((key) => heldKeys.has(key));

function updatePlayer(dt) {
    if (digCooldown > 0) digCooldown = Math.max(0, digCooldown - dt);

    // Let the runner change their mind mid-stride, but never mid-fall.
    if (player.moving && player.mode === 'walk') {
        const back = player.fromCol - player.toCol;
        if ((back < 0 && held('left')) || (back > 0 && held('right'))) {
            const from = player.fromCol;
            player.fromCol = player.toCol;
            player.toCol = from;
            player.progress = 1 - player.progress;
            player.face = -player.face;
        }
    }

    if (!player.moving) choosePlayerMove();
    if (advanceActor(player, dt)) onPlayerArrive();
}

function choosePlayerMove() {
    if (digCooldown > 0) return;
    const { col, row } = player;

    if (!isSupported(col, row)) {
        startMove(player, 0, 1, FALL_SPEED, 'fall');
        return;
    }
    if (held('up') && climbable(col, row) && climbable(col, row - 1)) {
        startMove(player, 0, -1, CLIMB_SPEED, 'climb');
        return;
    }
    if (held('down') && passable(col, row + 1)) {
        const ladder = climbable(col, row + 1);
        startMove(player, 0, 1, ladder ? CLIMB_SPEED : FALL_SPEED, ladder ? 'climb' : 'fall');
        return;
    }
    if (held('left') && passable(col - 1, row)) {
        startMove(player, -1, 0, PLAYER_SPEED, 'walk');
        return;
    }
    if (held('right') && passable(col + 1, row)) {
        startMove(player, 1, 0, PLAYER_SPEED, 'walk');
    }
}

function onPlayerArrive() {
    const coin = goldAt(player.col, player.row);
    if (coin) takeGold(coin);
    if (escapeRevealed && player.row === 0) completeLevel();
}

function dig(dirX) {
    if (state !== 'playing') return false;
    if (player.moving || digCooldown > 0) return false;
    const { col, row } = player;
    if (!isSupported(col, row)) return false;
    if (climbable(col, row) || onRope(col, row)) return false;

    const targetCol = col + dirX;
    const targetRow = row + 1;
    if (tileAt(targetCol, targetRow) !== BRICK) return false;
    if (!passable(targetCol, row)) return false;   // no room to aim the laser

    setTile(targetCol, targetRow, HOLE);
    holes.push({ col: targetCol, row: targetRow, timer: HOLE_FILL_SECONDS });
    digCooldown = DIG_COOLDOWN;
    player.face = dirX;
    return true;
}

// ---------------------------------------------------------------------------
// Holes
// ---------------------------------------------------------------------------

function updateHoles(dt) {
    for (let i = holes.length - 1; i >= 0; i--) {
        const hole = holes[i];
        hole.timer -= dt;
        if (hole.timer > 0) continue;

        setTile(hole.col, hole.row, BRICK);
        holes.splice(i, 1);

        for (const enemy of enemies) {
            if (enemy.col === hole.col && enemy.row === hole.row) killEnemy(enemy);
        }
        if (player.col === hole.col && player.row === hole.row) {
            playerDies();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function enemyAt(col, row, ignore) {
    return enemies.some((e) => e !== ignore && !e.trapped && e.col === col && e.row === row);
}

function killEnemy(enemy) {
    score += ENEMY_POINTS;
    enemy.trapped = false;
    enemy.trapTimer = 0;
    enemy.path = null;
    placeActor(enemy, enemy.spawnCol, enemy.spawnRow);
    updateHud();
}

function updateEnemies(dt) {
    for (const enemy of enemies) {
        if (enemy.trapped) {
            enemy.trapTimer -= dt;
            enemy.anim += dt;
            if (enemy.trapTimer <= 0) climbOut(enemy);
            continue;
        }
        if (enemy.aiTimer > 0) enemy.aiTimer -= dt;
        if (!enemy.moving) chooseEnemyMove(enemy);
        advanceActor(enemy, dt);
    }
}

function climbOut(enemy) {
    const toward = player.col < enemy.col ? -1 : 1;
    for (const dir of [toward, -toward]) {
        const col = enemy.col + dir;
        const row = enemy.row - 1;
        if (passable(col, row) && !enemyAt(col, row, enemy)) {
            enemy.trapped = false;
            startMove(enemy, dir, -1, ENEMY_ESCAPE_SPEED, 'climbout');
            return;
        }
    }
    enemy.trapTimer = 0.3;   // boxed in; try again shortly
}

function chooseEnemyMove(enemy) {
    const { col, row } = enemy;

    // Standing at rest in a burnt-out brick means the guard is in the pit.
    if (tileAt(col, row) === HOLE) {
        enemy.trapped = true;
        enemy.trapTimer = TRAP_SECONDS;
        enemy.path = null;
        return;
    }
    if (!isSupported(col, row)) {
        startMove(enemy, 0, 1, FALL_SPEED, 'fall');
        return;
    }
    if (enemy.aiTimer <= 0 || !enemy.path || !enemy.path.length) {
        enemy.path = findPath(enemy);
        enemy.aiTimer = AI_PERIOD;
    }

    let stepTo = enemy.path && enemy.path.length ? enemy.path.shift() : null;
    if (stepTo && (!passable(stepTo.col, stepTo.row) || enemyAt(stepTo.col, stepTo.row, enemy))) {
        stepTo = null;
        enemy.path = null;
    }
    if (!stepTo) stepTo = greedyStep(enemy);
    if (!stepTo) return;

    const dcol = stepTo.col - col;
    const drow = stepTo.row - row;
    if (drow < 0) {
        startMove(enemy, 0, -1, ENEMY_CLIMB_SPEED, 'climb');
    } else if (drow > 0) {
        const ladder = climbable(col, row + 1);
        startMove(enemy, 0, 1, ladder ? ENEMY_CLIMB_SPEED : FALL_SPEED, ladder ? 'climb' : 'fall');
    } else {
        startMove(enemy, dcol, 0, ENEMY_SPEED, 'walk');
    }
}

// Guards avoid stepping into an open pit on purpose; they only fall in when the
// floor is burnt out from under them.
function enemyCanEnter(col, row, enemy) {
    if (!passable(col, row)) return false;
    if (tileAt(col, row) === HOLE) return false;
    return !enemyAt(col, row, enemy);
}

function neighbours(col, row, enemy) {
    const out = [];
    if (!isSupported(col, row)) {
        if (enemyCanEnter(col, row + 1, enemy)) out.push({ col, row: row + 1 });
        return out;
    }
    if (climbable(col, row) && climbable(col, row - 1) && enemyCanEnter(col, row - 1, enemy)) {
        out.push({ col, row: row - 1 });
    }
    if (enemyCanEnter(col, row + 1, enemy)) out.push({ col, row: row + 1 });
    if (enemyCanEnter(col - 1, row, enemy)) out.push({ col: col - 1, row });
    if (enemyCanEnter(col + 1, row, enemy)) out.push({ col: col + 1, row });
    return out;
}

// Breadth-first search across the reachable cells; the guards are relentless
// but not clairvoyant — the path is recomputed only a few times a second.
function findPath(enemy) {
    const start = enemy.row * COLS + enemy.col;
    const goal = player.row * COLS + player.col;
    if (start === goal) return null;

    const prev = new Int32Array(COLS * ROWS).fill(-1);
    const seen = new Uint8Array(COLS * ROWS);
    let queue = [start];
    seen[start] = 1;

    while (queue.length) {
        const next = [];
        for (const id of queue) {
            const col = id % COLS;
            const row = (id - col) / COLS;
            for (const n of neighbours(col, row, enemy)) {
                const nid = n.row * COLS + n.col;
                if (seen[nid]) continue;
                seen[nid] = 1;
                prev[nid] = id;
                if (nid === goal) {
                    const path = [];
                    let cur = nid;
                    while (cur !== start) {
                        path.push({ col: cur % COLS, row: (cur - (cur % COLS)) / COLS });
                        cur = prev[cur];
                    }
                    return path.reverse();
                }
                next.push(nid);
            }
        }
        queue = next;
    }
    return null;
}

// No route to the runner: shuffle sideways in their direction so guards keep
// pressing rather than standing still.
function greedyStep(enemy) {
    const dir = player.col === enemy.col ? 0 : player.col < enemy.col ? -1 : 1;
    if (dir !== 0 && enemyCanEnter(enemy.col + dir, enemy.row, enemy)) {
        return { col: enemy.col + dir, row: enemy.row };
    }
    if (player.row > enemy.row && climbable(enemy.col, enemy.row + 1)) {
        return { col: enemy.col, row: enemy.row + 1 };
    }
    if (player.row < enemy.row && climbable(enemy.col, enemy.row) && climbable(enemy.col, enemy.row - 1)) {
        return { col: enemy.col, row: enemy.row - 1 };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Collisions, deaths and level flow
// ---------------------------------------------------------------------------

function checkCollisions() {
    const reach = TILE * 0.6;
    for (const enemy of enemies) {
        if (enemy.trapped) continue;
        if (Math.abs(enemy.x - player.x) < reach && Math.abs(enemy.y - player.y) < reach) {
            playerDies();
            return;
        }
    }
}

function playerDies() {
    lives -= 1;
    updateHud();
    if (lives <= 0) {
        gameOver();
        return;
    }
    resetActors();
}

function gameOver() {
    lives = 0;
    state = 'gameover';
    saveBest();
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space or click Start to play again');
}

function completeLevel() {
    score += LEVEL_BONUS;
    saveBest();
    updateHud();
    if (levelIndex >= LEVELS.length - 1) {
        state = 'won';
        showOverlay('YOU ESCAPED', `Score ${score}`, 'Press Space or click Start to run it again');
        return;
    }
    state = 'levelclear';
    showOverlay(`LEVEL ${levelIndex + 1} CLEAR`, `Score ${score}`, 'Press Space for the next level');
}

function startNextLevel() {
    levelIndex += 1;
    loadLevel(levelIndex);
    state = 'playing';
    hideOverlay();
    updateHud();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    levelIndex = 0;
    loadLevel(0);
    state = 'playing';
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'playing';
        hideOverlay();
    }
}

function saveBest() {
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('loderunner-best', String(best));
        } catch (err) {
            /* storage unavailable — the run still counts, it just isn't saved */
        }
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'playing') return;
    updateHoles(dt);
    if (state !== 'playing') return;   // a closing hole may have ended the run
    updatePlayer(dt);
    if (state !== 'playing') return;
    updateEnemies(dt);
    checkCollisions();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(levelIndex + 1);
    elLives.textContent = String(Math.max(0, lives));
    elGold.textContent = String(goldRemaining);
    elBest.textContent = String(best);
}

function showOverlay(title, sub, hint) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub;
    overlaySub.textContent = hint;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const COLOR_BG = '#05070f';
const COLOR_BRICK = '#b4573a';
const COLOR_BRICK_DARK = '#7d3624';
const COLOR_STONE = '#4b5570';
const COLOR_LADDER = '#e0c060';
const COLOR_ROPE = '#c8a256';
const COLOR_GOLD = '#ffd34d';
const COLOR_PLAYER = '#4fd6ff';
const COLOR_ENEMY = '#ff5b5b';

function drawBrick(x, y, warn) {
    ctx.fillStyle = warn ? '#e0a06a' : COLOR_BRICK;
    ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = COLOR_BRICK_DARK;
    ctx.fillRect(x + 1, y + TILE / 2 - 1, TILE - 2, 2);
    ctx.fillRect(x + TILE / 2 - 1, y + 1, 2, TILE / 2 - 2);
    ctx.fillRect(x + 1, y + TILE / 2 + 1, 2, TILE / 2 - 2);
    ctx.fillRect(x + TILE - 3, y + TILE / 2 + 1, 2, TILE / 2 - 2);
}

function drawStone(x, y) {
    ctx.fillStyle = COLOR_STONE;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + 2, y + 2, TILE - 4, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + 2, y + TILE - 5, TILE - 4, 3);
}

function drawLadder(x, y) {
    ctx.fillStyle = COLOR_LADDER;
    ctx.fillRect(x + 3, y, 3, TILE);
    ctx.fillRect(x + TILE - 6, y, 3, TILE);
    ctx.fillRect(x + 3, y + 4, TILE - 6, 3);
    ctx.fillRect(x + 3, y + TILE - 8, TILE - 6, 3);
}

function drawRope(x, y) {
    ctx.strokeStyle = COLOR_ROPE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 5);
    ctx.lineTo(x + TILE, y + 5);
    ctx.stroke();
}

// A burnt-out brick: scorched stubs either side of the gap, and a flashing rim
// once the brick is about to grow back.
function drawHole(x, y, closing, now) {
    ctx.fillStyle = '#2a1109';
    ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = COLOR_BRICK_DARK;
    ctx.fillRect(x + 1, y + 1, 3, TILE - 2);
    ctx.fillRect(x + TILE - 4, y + 1, 3, TILE - 2);
    if (!closing) return;
    ctx.strokeStyle = Math.floor(now * 3) % 2 ? '#ffb27a' : '#7d3624';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
}

function drawGold(x, y, phase) {
    const bob = Math.sin(phase) * 1.2;
    ctx.fillStyle = COLOR_GOLD;
    ctx.beginPath();
    ctx.ellipse(x + TILE / 2, y + TILE / 2 + bob, TILE * 0.28, TILE * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(x + TILE / 2 - 4, y + TILE / 2 - 4 + bob, 3, 5);
}

function drawRunner(actor, color) {
    const x = actor.x;
    const y = actor.y;
    const stride = actor.moving ? Math.sin(actor.anim * 18) : 0;
    ctx.fillStyle = color;
    // head
    ctx.beginPath();
    ctx.arc(x, y - 7, 3.6, 0, Math.PI * 2);
    ctx.fill();
    // body
    ctx.fillRect(x - 3, y - 4, 6, 8);
    // arms
    ctx.fillRect(x - 7, y - 3 + stride * 2, 4, 2);
    ctx.fillRect(x + 3, y - 3 - stride * 2, 4, 2);
    // legs
    ctx.fillRect(x - 3 + stride * 2, y + 4, 2.5, 6);
    ctx.fillRect(x + 1 - stride * 2, y + 4, 2.5, 6);
    // a glint in the direction of travel
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(x + (actor.face > 0 ? 1 : -2.5), y - 8.5, 1.5, 1.5);
}

function draw() {
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    if (!grid.length) return;

    const now = performance.now() / 300;
    const warning = new Set(
        holes.filter((h) => h.timer <= HOLE_WARN_SECONDS).map((h) => `${h.col},${h.row}`)
    );

    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const x = col * TILE;
            const y = row * TILE;
            const tile = grid[row][col];
            if (tile === BRICK) drawBrick(x, y, false);
            else if (tile === SOLID) drawStone(x, y);
            else if (tile === LADDER) drawLadder(x, y);
            else if (tile === ROPE) drawRope(x, y);
            else if (tile === ESCAPE && escapeRevealed) drawLadder(x, y);
            else if (tile === HOLE) drawHole(x, y, warning.has(`${col},${row}`), now);
        }
    }

    goldCells.forEach((coin, i) => drawGold(coin.col * TILE, coin.row * TILE, now + i));

    enemies.forEach((enemy) => drawRunner(enemy, enemy.trapped ? '#a83a3a' : COLOR_ENEMY));
    if (player) drawRunner(player, COLOR_PLAYER);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const MOVEMENT_KEYS = new Set([
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'a', 'A', 'd', 'D', 'w', 'W', 's', 'S',
]);

window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (state === 'levelclear') startNextLevel();
        else if (state !== 'playing' && state !== 'paused') startGame();
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        togglePause();
        return;
    }
    if (e.key === 'z' || e.key === 'Z' || e.key === ',') {
        e.preventDefault();
        dig(-1);
        return;
    }
    if (e.key === 'x' || e.key === 'X' || e.key === '.') {
        e.preventDefault();
        dig(1);
        return;
    }
    if (MOVEMENT_KEYS.has(e.key)) {
        heldKeys.add(e.key);
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    heldKeys.delete(e.key);
});

window.addEventListener('blur', () => heldKeys.clear());

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else if (state === 'levelclear') startNextLevel();
    else startGame();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

// The animation loop advances the simulation on its own; the Playwright specs
// switch this off so they can drive `step(dt)` frame by frame instead.
let autoStep = true;

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

best = parseInt(localStorage.getItem('loderunner-best') || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
levelIndex = 0;
loadLevel(0);
updateHud();
showOverlay('LODE RUNNER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
