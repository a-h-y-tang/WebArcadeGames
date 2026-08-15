// ---------------------------------------------------------------------------
// Lode Runner — a tile-based dig-and-collect platform puzzler on an HTML5
// canvas.
//
// The runner sprints along girders, climbs ladders, hand-over-hands across
// ropes and drills holes in the brickwork to trap the guards chasing them.
// Collect every gold bar on a level and the escape ladder appears; climb it to
// the top row to move on.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Slime
// Volley, Kaboom and Tetris in this repo.
//
// Motion is *tile locked*: an entity always sits on a tile or is travelling
// between two adjacent tiles. Every move is decided when the entity is exactly
// on a tile, which keeps the simulation deterministic and makes `step(dt)`
// exact for any dt — the tests can therefore simulate frames without
// depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Grid geometry ---
const TILE = 24;
const COLS = 28;
const ROWS = 18;

// --- Tile characters ---
const EMPTY = '.';
const BRICK = '#';          // diggable
const STONE = '@';          // undiggable
const LADDER = 'H';
const ROPE = '-';
const GOLD = '$';
const EXIT = 'E';           // escape ladder: inert until the gold is gone

// --- Speeds, in tiles per second ---
const RUN_SPEED = 6.5;
const CLIMB_SPEED = 5.5;
const FALL_SPEED = 11;
const GUARD_RUN = 4.4;
const GUARD_CLIMB = 3.8;
const GUARD_FALL = 11;

// --- Rules ---
const START_LIVES = 3;
const GOLD_SCORE = 100;
const LEVEL_BONUS = 500;
const HOLE_TIME = 5;        // seconds before a dug hole heals over
const TRAP_TIME = 2.5;      // seconds a guard flounders in a hole
const SUB_STEP = 1 / 60;    // simulation slice
const TOUCH_RANGE = 0.55;   // tiles: how close a guard has to be to catch you

// ---------------------------------------------------------------------------
// Levels
//
// '.' air   '#' brick (diggable)   '@' stone (solid)   'H' ladder
// '-' rope  '$' gold               'E' escape ladder   'P' runner  'G' guard
// ---------------------------------------------------------------------------
const LEVELS = [
    [
        '.............E..............',
        '.............E..............',
        '.............E..............',
        '...$.....H...E......$.......',
        '..#######H#######@########..',
        '.........H..................',
        '.........H------$----.......',
        '..$......H.H............$...',
        '#####@#####H..###########...',
        '...........H$...............',
        '..---H-----H................',
        '.....H.....H..G..$..........',
        '...##H#####H#######..####@##',
        '.....H..$..........$........',
        '.....H------------..........',
        '.....H......................',
        '.P...H....$........$.....G..',
        '@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
    ],
    [
        '......E.....................',
        '......E.....................',
        '......E.....................',
        '......E.....................',
        '.......$.........H.......$..',
        '....#############H#@########',
        '......----$------H..........',
        '........$H..$....H..H.......',
        '#####..##H##########H#......',
        '.........H----$----.H.......',
        '...$.H...H.G$......HH...$...',
        '..###H########..###H##@###..',
        '..$..H---$---......H........',
        '...H.H.$....$..G...H...$.H..',
        '###H####..##@#######..###H##',
        '...H.....................H..',
        '.$.H....G.....$..........HP$',
        '@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
    ],
    [
        '.............E..............',
        '.............E..............',
        '.........H..$.....$H........',
        '......###H#####@###H##......',
        '.........H---------H........',
        '...$....HH......$..H..H..$..',
        '.#######H##...########H####.',
        '........H---$----.....H.....',
        '....H.$.H.$......H..$GH.....',
        '...#H######@#..##H#######...',
        '....H--$-----....H..........',
        '..$.HHG....$.....H......H.$.',
        '#####H#..##########..###H###',
        '.....H--$---.....----$--H...',
        '..H..H$...........$.H...H$..',
        '.#H####@##...#######H######.',
        '$PH........$.G..$...H....G.$',
        '@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
    ],
];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const goldEl = document.getElementById('gold');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let state = 'idle';         // idle | running | paused | over | won
let grid = [];              // ROWS x COLS of tile characters
let levelRows = [];         // the raw rows the current level was built from
let levelIndex = 0;
let player = makeEntity(0, 0);
let guards = [];
let holes = [];             // { c, r, t } — t counts up to HOLE_TIME
let score = 0;
let lives = START_LIVES;
let goldTotal = 0;
let goldLeft = 0;
let exitRevealed = false;
let best = 0;
let frameCount = 0;
let lastTime = 0;
const heldKeys = new Set(); // 'left' | 'right' | 'up' | 'down'

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function tile(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return STONE;
    return grid[r][c];
}

function isSolid(c, r) {
    const t = tile(c, r);
    return t === BRICK || t === STONE;
}

function isLadder(c, r) {
    const t = tile(c, r);
    return t === LADDER || (t === EXIT && exitRevealed);
}

function isRope(c, r) {
    return tile(c, r) === ROPE;
}

function holeAt(c, r) {
    return holes.find((h) => h.c === c && h.r === r) || null;
}

function trappedGuardAt(c, r) {
    return guards.some((g) => g.trapped > 0 && Math.round(g.c) === c && Math.round(g.r) === r);
}

/** Can an entity standing on (c, r) stay put, or does gravity take over? */
function isSupported(c, r) {
    if (isLadder(c, r) || isRope(c, r)) return true;
    if (r + 1 >= ROWS) return true;
    if (isSolid(c, r + 1) || isLadder(c, r + 1)) return true;
    return trappedGuardAt(c, r + 1);
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function makeEntity(c, r) {
    return {
        c, r,                   // current position, in tiles (fractional while moving)
        tc: c, tr: r,           // the tile being moved into
        moving: false,
        speed: 0,
        falling: false,
        face: 1,                // -1 left, 1 right — drawing only
        trapped: 0,             // guards only: seconds left in a hole
        rest: 0,                // guards only: pause before thinking again
        escapeQueue: [],        // guards only: scripted moves out of a hole
        spawnC: c, spawnR: r,
    };
}

function placeAt(e, c, r) {
    e.c = c; e.r = r;
    e.tc = c; e.tr = r;
    e.moving = false;
    e.falling = false;
    return e;
}

function spawnGuard(c, r) {
    const g = makeEntity(c, r);
    g.spawnC = c;
    g.spawnR = r;
    guards.push(g);
    return g;
}

function startMove(e, tc, tr, speed, falling) {
    e.tc = tc;
    e.tr = tr;
    e.speed = speed;
    e.falling = !!falling;
    e.moving = true;
    if (tc !== e.c) e.face = tc > e.c ? 1 : -1;
}

/**
 * Slide an entity toward its target tile, re-deciding whenever it lands
 * exactly on one. Any leftover time in the slice is carried into the next
 * move so the motion is smooth for any dt.
 */
function advance(e, dt, decide, onArrive) {
    let budget = dt;
    let guardRail = 0;
    while (budget > 1e-9 && guardRail++ < 200) {
        if (!e.moving) {
            decide(e);
            if (!e.moving) break;
        }
        const dc = e.tc - e.c;
        const dr = e.tr - e.r;
        const distance = Math.abs(dc) + Math.abs(dr);
        if (distance < 1e-9) {
            // Float drift left us a hair short of the target: land exactly on
            // it. Tile coordinates must stay whole numbers between moves,
            // otherwise every grid lookup after this point reads out of bounds.
            e.c = e.tc;
            e.r = e.tr;
            e.moving = false;
            onArrive(e);
            if (state !== 'running') return;
            continue;
        }
        const travel = e.speed * budget;
        if (travel < distance) {
            const f = travel / distance;
            e.c += dc * f;
            e.r += dr * f;
            budget = 0;
        } else {
            e.c = e.tc;
            e.r = e.tr;
            e.moving = false;
            budget -= distance / e.speed;
            onArrive(e);
            if (state !== 'running') return;
        }
    }
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

function decidePlayer(p) {
    const c = p.c;
    const r = p.r;
    if (!isSupported(c, r)) {
        if (!isSolid(c, r + 1)) startMove(p, c, r + 1, FALL_SPEED, true);
        return;
    }
    for (const dir of ['up', 'down', 'left', 'right']) {
        if (!heldKeys.has(dir)) continue;
        if (dir === 'up' && isLadder(c, r - 1)) {
            startMove(p, c, r - 1, CLIMB_SPEED, false);
            return;
        }
        if (dir === 'down' && !isSolid(c, r + 1) && r + 1 < ROWS) {
            const climbing = isLadder(c, r + 1);
            startMove(p, c, r + 1, climbing ? CLIMB_SPEED : FALL_SPEED, !climbing);
            return;
        }
        if (dir === 'left' && !isSolid(c - 1, r)) {
            startMove(p, c - 1, r, RUN_SPEED, false);
            return;
        }
        if (dir === 'right' && !isSolid(c + 1, r)) {
            startMove(p, c + 1, r, RUN_SPEED, false);
            return;
        }
    }
}

function onPlayerArrive(p) {
    if (tile(p.c, p.r) === GOLD) {
        grid[p.r][p.c] = EMPTY;
        goldLeft = Math.max(0, goldLeft - 1);
        score += GOLD_SCORE;
        if (goldLeft === 0) exitRevealed = true;
        updateHud();
    }
}

/**
 * Drill the brick diagonally below the runner. Returns true when a hole was
 * actually opened up.
 */
function dig(dir) {
    if (state !== 'running' || player.moving) return false;
    const c = player.c;
    const r = player.r;
    if (isLadder(c, r) || isRope(c, r)) return false;   // no leverage
    if (!isSolid(c, r + 1)) return false;               // must stand on firm ground
    const tc = c + dir;
    const tr = r + 1;
    if (tc < 0 || tc >= COLS || tr >= ROWS) return false;
    if (tile(tc, tr) !== BRICK) return false;           // stone and air cannot be dug
    if (tile(tc, r) !== EMPTY) return false;            // no room to swing
    grid[tr][tc] = EMPTY;
    holes.push({ c: tc, r: tr, t: 0 });
    player.face = dir;
    player.digFlash = 0.2;
    return true;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Moves available from a tile, shared by the guard AI. */
function movesFrom(c, r) {
    const out = [];
    if (!isSupported(c, r)) {
        if (!isSolid(c, r + 1)) out.push([0, 1]);
        return out;
    }
    if (isLadder(c, r - 1)) out.push([0, -1]);
    if (r + 1 < ROWS && !isSolid(c, r + 1)) out.push([0, 1]);
    if (!isSolid(c - 1, r)) out.push([-1, 0]);
    if (!isSolid(c + 1, r)) out.push([1, 0]);
    return out;
}

/** Breadth-first search for the first step of a route to the runner. */
function chaseStep(sc, sr) {
    const goalC = Math.round(player.c);
    const goalR = Math.round(player.r);
    if (sc === goalC && sr === goalR) return null;
    const seen = new Uint8Array(COLS * ROWS);
    const first = new Array(COLS * ROWS).fill(null);
    const queue = [[sc, sr]];
    seen[sr * COLS + sc] = 1;
    for (let qi = 0; qi < queue.length; qi++) {
        const [c, r] = queue[qi];
        const from = first[r * COLS + c];
        for (const move of movesFrom(c, r)) {
            const nc = c + move[0];
            const nr = r + move[1];
            if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
            const key = nr * COLS + nc;
            if (seen[key]) continue;
            seen[key] = 1;
            first[key] = from || move;
            if (nc === goalC && nr === goalR) return first[key];
            queue.push([nc, nr]);
        }
    }
    return null;
}

function guardOccupies(c, r, self) {
    return guards.some((g) => {
        if (g === self) return false;
        if (Math.round(g.c) === c && Math.round(g.r) === r) return true;
        return g.moving && g.tc === c && g.tr === r;
    });
}

function decideGuard(g) {
    if (g.escapeQueue.length) {
        const [dc, dr] = g.escapeQueue.shift();
        startMove(g, g.c + dc, g.r + dr, GUARD_CLIMB, false);
        return;
    }
    if (g.trapped > 0 || g.rest > 0) return;
    if (!isSupported(g.c, g.r)) {
        if (!isSolid(g.c, g.r + 1)) startMove(g, g.c, g.r + 1, GUARD_FALL, true);
        return;
    }
    let move = chaseStep(g.c, g.r);
    if (!move) {
        const toward = Math.sign(Math.round(player.c) - g.c);
        move = toward && !isSolid(g.c + toward, g.r) ? [toward, 0] : null;
    }
    if (!move) { g.rest = 0.12; return; }
    const tc = g.c + move[0];
    const tr = g.r + move[1];
    if (guardOccupies(tc, tr, g)) { g.rest = 0.12; return; }
    if (move[1] !== 0) {
        const climbing = isLadder(tc, tr) || isLadder(g.c, g.r);
        startMove(g, tc, tr, climbing ? GUARD_CLIMB : GUARD_FALL, !climbing && move[1] > 0);
    } else {
        startMove(g, tc, tr, GUARD_RUN, false);
    }
}

function onGuardArrive(g) {
    // A pit's walls are too smooth to simply walk out of.
    if (g.escapeQueue.length === 0 && holeAt(g.c, g.r)) g.trapped = TRAP_TIME;
}

function freeGuard(g) {
    const above = g.r - 1;
    if (isSolid(g.c, above) || above < 0) {
        g.trapped = 0.5;            // capped in: keep struggling
        return;
    }
    let side = Math.sign(Math.round(player.c) - g.c) || 1;
    if (isSolid(g.c + side, above)) side = -side;
    g.escapeQueue = [[0, -1]];
    if (!isSolid(g.c + side, above)) g.escapeQueue.push([side, 0]);
}

function killGuard(g) {
    placeAt(g, g.spawnC, g.spawnR);
    g.trapped = 0;
    g.rest = 0;
    g.escapeQueue = [];
}

function updateGuards(dt) {
    for (const g of guards) {
        if (g.rest > 0) g.rest = Math.max(0, g.rest - dt);
        if (g.trapped > 0 && !g.moving && g.escapeQueue.length === 0) {
            g.trapped -= dt;
            if (g.trapped <= 0) {
                g.trapped = 0;
                freeGuard(g);
            }
            continue;
        }
        advance(g, dt, decideGuard, onGuardArrive);
        if (state !== 'running') return;
    }
}

// ---------------------------------------------------------------------------
// Holes
// ---------------------------------------------------------------------------

function updateHoles(dt) {
    for (let i = holes.length - 1; i >= 0; i--) {
        const h = holes[i];
        h.t += dt;
        if (h.t < HOLE_TIME) continue;
        grid[h.r][h.c] = BRICK;
        holes.splice(i, 1);
        for (const g of guards) {
            if (Math.round(g.c) === h.c && Math.round(g.r) === h.r) killGuard(g);
        }
        if (Math.round(player.c) === h.c && Math.round(player.r) === h.r) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Level lifecycle
// ---------------------------------------------------------------------------

function loadLevelData(rows) {
    levelRows = rows.slice();
    grid = rows.map((row) => row.split(''));
    guards = [];
    holes = [];
    exitRevealed = false;
    goldTotal = 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const ch = grid[r][c];
            if (ch === 'P') {
                grid[r][c] = EMPTY;
                placeAt(player, c, r);
                player.spawnC = c;
                player.spawnR = r;
            } else if (ch === 'G') {
                grid[r][c] = EMPTY;
                spawnGuard(c, r);
            } else if (ch === GOLD) {
                goldTotal++;
            }
        }
    }
    goldLeft = goldTotal;
    player.digFlash = 0;
    updateHud();
}

function loadLevel(i) {
    loadLevelData(LEVELS[i]);
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    levelIndex = 0;
    heldKeys.clear();
    loadLevel(0);
    state = 'running';
    hideOverlay();
    updateHud();
}

function completeLevel() {
    score += LEVEL_BONUS;
    levelIndex++;
    if (levelIndex >= LEVELS.length) {
        state = 'won';
        saveBest();
        showOverlay('YOU ESCAPED', `Final score ${score}`, 'Press Space to run it again');
    } else {
        loadLevel(levelIndex);
    }
    updateHud();
}

function loseLife() {
    lives--;
    if (lives <= 0) {
        lives = 0;
        state = 'over';
        saveBest();
        showOverlay('GAME OVER', `Score ${score}`, 'Press Space to try again');
    } else {
        loadLevelData(levelRows);
    }
    updateHud();
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

function saveBest() {
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('lode-runner-best', String(best));
        } catch (err) {
            /* storage disabled — the session score still shows in the HUD */
        }
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function subStep(dt) {
    updateHoles(dt);
    if (state !== 'running') return;

    if (player.digFlash > 0) player.digFlash = Math.max(0, player.digFlash - dt);

    advance(player, dt, decidePlayer, onPlayerArrive);
    if (state !== 'running') return;

    updateGuards(dt);
    if (state !== 'running') return;

    for (const g of guards) {
        if (Math.abs(g.c - player.c) < TOUCH_RANGE && Math.abs(g.r - player.r) < TOUCH_RANGE) {
            loseLife();
            return;
        }
    }

    if (exitRevealed && Math.round(player.r) === 0) completeLevel();
}

function step(dt) {
    if (state !== 'running') return;
    let budget = Math.min(dt, 0.5);
    while (budget > 1e-9) {
        const slice = Math.min(budget, SUB_STEP);
        subStep(slice);
        if (state !== 'running') return;
        budget -= slice;
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawBrick(x, y) {
    ctx.fillStyle = '#6d3a20';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#a75f39';
    ctx.fillRect(x + 1, y + 1, TILE - 2, TILE / 2 - 2);
    ctx.fillRect(x + 1, y + TILE / 2 + 1, TILE / 2 - 2, TILE / 2 - 2);
    ctx.fillRect(x + TILE / 2 + 1, y + TILE / 2 + 1, TILE / 2 - 2, TILE / 2 - 2);
    ctx.fillStyle = 'rgba(255, 200, 150, 0.18)';
    ctx.fillRect(x + 1, y + 1, TILE - 2, 1);
}

function drawStone(x, y) {
    ctx.fillStyle = '#4b4a63';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#5f5e7c';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#3a3950';
    ctx.fillRect(x + 5, y + 6, TILE - 12, 3);
}

function drawLadder(x, y, colour) {
    ctx.fillStyle = colour;
    ctx.fillRect(x + 3, y, 3, TILE);
    ctx.fillRect(x + TILE - 6, y, 3, TILE);
    ctx.fillRect(x + 3, y + 4, TILE - 6, 3);
    ctx.fillRect(x + 3, y + 14, TILE - 6, 3);
}

function drawRope(x, y) {
    ctx.strokeStyle = '#c8a06a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x + TILE, y + 4);
    ctx.stroke();
}

function drawGold(x, y) {
    const g = ctx.createLinearGradient(x, y, x + TILE, y + TILE);
    g.addColorStop(0, '#ffe89a');
    g.addColorStop(1, '#e0a107');
    ctx.fillStyle = g;
    ctx.fillRect(x + 4, y + 8, TILE - 8, TILE - 15);
    ctx.fillStyle = '#fff6d0';
    ctx.fillRect(x + 5, y + 9, TILE - 10, 2);
}

function drawHoleProgress(h) {
    const x = h.c * TILE;
    const y = h.r * TILE;
    const grow = Math.max(0, (h.t - HOLE_TIME * 0.7) / (HOLE_TIME * 0.3));
    if (grow <= 0) return;
    ctx.fillStyle = 'rgba(167, 95, 57, 0.75)';
    ctx.fillRect(x, y + TILE * (1 - grow), TILE, TILE * grow);
}

function drawRunner(e, body, trim) {
    const x = e.c * TILE;
    const y = e.r * TILE;
    ctx.fillStyle = body;
    ctx.fillRect(x + 7, y + 8, TILE - 14, TILE - 11);          // torso
    ctx.beginPath();
    ctx.arc(x + TILE / 2, y + 6, 4.5, 0, Math.PI * 2);          // head
    ctx.fill();
    ctx.fillStyle = trim;
    ctx.fillRect(x + 6, y + TILE - 4, 5, 3);                    // feet
    ctx.fillRect(x + TILE - 11, y + TILE - 4, 5, 3);
    const reach = e.face > 0 ? x + TILE - 8 : x + 3;
    ctx.fillRect(reach, y + 10, 5, 3);                          // leading arm
}

function draw() {
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#151129');
    sky.addColorStop(1, '#07060f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // faint mine-shaft grid, just enough to judge distances by
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) ctx.fillRect(c * TILE, r * TILE, 1, 1);
    }

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = c * TILE;
            const y = r * TILE;
            switch (grid[r] ? grid[r][c] : EMPTY) {
                case BRICK: drawBrick(x, y); break;
                case STONE: drawStone(x, y); break;
                case LADDER: drawLadder(x, y, '#c9a227'); break;
                case EXIT: if (exitRevealed) drawLadder(x, y, '#7dffb0'); break;
                case ROPE: drawRope(x, y); break;
                case GOLD: drawGold(x, y); break;
                default: break;
            }
        }
    }

    for (const h of holes) drawHoleProgress(h);

    for (const g of guards) drawRunner(g, g.trapped > 0 ? '#a03648' : '#ff5c72', '#2b0d13');
    drawRunner(player, '#4ad6ff', '#04283a');

    if (player.digFlash > 0) {
        const x = (player.c + player.face) * TILE;
        const y = (player.r + 1) * TILE;
        ctx.fillStyle = 'rgba(255, 231, 150, 0.45)';
        ctx.fillRect(x, y, TILE, TILE);
    }
}

function frame(now) {
    const seconds = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0;
    lastTime = now;
    frameCount++;
    step(seconds);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    goldEl.textContent = String(goldLeft);
    levelEl.textContent = String(levelIndex + 1);
    livesEl.textContent = String(lives);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    overlaySub.textContent = sub || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const DIRECTION_KEYS = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
};

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over' || state === 'won') startGame();
        e.preventDefault();
        return;
    }
    if (e.key === 'z' || e.key === 'Z' || e.key === ',') { dig(-1); e.preventDefault(); return; }
    if (e.key === 'x' || e.key === 'X' || e.key === '.') { dig(1); e.preventDefault(); return; }
    const dir = DIRECTION_KEYS[e.key];
    if (dir) {
        heldKeys.add(dir);
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const dir = DIRECTION_KEYS[e.key];
    if (dir) heldKeys.delete(dir);
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('lode-runner-best') || '0', 10) || 0;
loadLevel(0);
state = 'idle';
updateHud();
showOverlay('LODE RUNNER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
