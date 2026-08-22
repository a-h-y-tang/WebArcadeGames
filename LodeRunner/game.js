// ---------------------------------------------------------------------------
// Lode Runner — a dig-and-collect platformer on an HTML5 canvas.
//
// The runner gathers every piece of gold on a level while guards hunt them
// across girders, ladders and ropes. The runner cannot jump and cannot fight:
// the only weapon is a shovel that melts a hole in the brick floor beside them.
// Guards fall in, the runner walks over their heads, and the brick grows back
// a few seconds later, burying anything still inside. Clear the gold and the
// level's hidden exit ladder appears; climb it to the top row to advance.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Snake,
// BurgerTime and Kaboom! in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Grid ----------------------------------------------------------------
const TILE = 28;
const COLS = 24;
const ROWS = 16;
const CANVAS_W = COLS * TILE;   // 672
const CANVAS_H = ROWS * TILE;   // 448

// Tile codes, as authored in the level strings below.
const EMPTY = ' ';
const BRICK = '#';   // diggable
const STONE = '@';   // solid forever
const LADDER = 'H';
const ROPE = '-';
const GOLD = '$';
const EXIT = 'E';    // empty until every piece of gold is collected

// --- Speeds (px/s) and timings (s) ---------------------------------------
const RUN_SPEED = 108;
const CLIMB_SPEED = 92;
const ROPE_SPEED = 96;
const FALL_SPEED = 190;

const GUARD_BASE_SPEED = 74;
const GUARD_SPEED_STEP = 7;
const GUARD_SPEED_CAP = 98;
const PLAN_INTERVAL = 0.18;

const DIG_TIME = 0.3;
const HOLE_REFILL = 5;
const HOLE_WARN = 1.2;
const TRAP_ESCAPE = 2.2;
const RESPAWN_TIME = 1.5;
const GUARD_DROP_TIME = 5;

// How close to a lane centre counts as "in" that lane.
const ALIGN = 1.5;

// --- Scoring -------------------------------------------------------------
const GOLD_POINTS = 250;
const TRAP_POINTS = 75;
const BURY_POINTS = 150;
const LEVEL_POINTS = 1500;
const START_LIVES = 3;

// --- Levels --------------------------------------------------------------
// 16 rows of 24 characters. 'P' is the runner spawn, 'G' a guard spawn; both
// are stripped to empty space when the level loads.
const LEVELS = [
    [
        '                       E',
        '   $       $   $       E',
        '##########H#########   E',
        '          H            E',
        '    $     H   ----     E',
        '######H#########  H####E',
        '      H        #  H    E',
        '  $   H     $  #  H  $ E',
        '#############H##  #####E',
        '             H         E',
        '   H----     H         E',
        '   H    $    H      $  E',
        '###H###################E',
        '   H                   E',
        ' P H  $  G       G  $  E',
        '@@@@@@@@@@@@@@@@@@@@@@@@',
    ],
    [
        'E                       ',
        'E   $       $      $    ',
        'E#######H##########H####',
        'E       H          H    ',
        'E  $    H  -----   H  $ ',
        'E#H######### ###H#######',
        'E H             H       ',
        'E H   $     $   H    $  ',
        'E#########H###  ########',
        'E         H             ',
        'E         H             ',
        'E   $     H         $   ',
        'E######H######  #####H##',
        'E      H             H  ',
        'E P    H  G  $   G $ H  ',
        '@@@@@@@@@@@@@@@@@@@@@@@@',
    ],
    [
        '           E            ',
        '           E            ',
        '    $      E      $     ',
        '#######H#######H########',
        '       H       H        ',
        '  $    H    $  H     $  ',
        '####H#########@@@@@H####',
        '    H   -----      H    ',
        '    H $   $     $  H    ',
        '#########H####H######  #',
        '         H    H         ',
        '   $     H    H     $   ',
        '######H##########H######',
        '      H          H      ',
        ' P  G H   $  $   H  G   ',
        '@@@@@@@@@@@@@@@@@@@@@@@@',
    ],
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';        // idle | running | paused | over | won
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;

let grid = [];             // grid[row][col], mutable copy of the level
let holes = [];            // { c, r, t } — dug bricks waiting to grow back
let exitRevealed = false;
let runnerSpawn = { c: 1, r: 1 };
let guardSpawns = [];
let guards = [];
let guardSpeed = GUARD_BASE_SPEED;
let guardsEnabled = true;  // tests freeze the guards to keep runs deterministic

let runner = makeActor(0, 0, 'runner');

const input = { x: 0, y: 0 };

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

function tileAt(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return STONE;
    return grid[r][c];
}

function isBlocking(c, r) {
    const t = tileAt(c, r);
    return t === BRICK || t === STONE;
}

function isLadderAt(c, r) {
    const t = tileAt(c, r);
    return t === LADDER || (t === EXIT && exitRevealed);
}

function isRopeAt(c, r) {
    return tileAt(c, r) === ROPE;
}

function colOf(x) {
    return Math.max(0, Math.min(COLS - 1, Math.floor(x / TILE)));
}

function rowOf(y) {
    return Math.max(0, Math.min(ROWS - 1, Math.floor(y / TILE)));
}

function cx(c) {
    return c * TILE + TILE / 2;
}

function cy(r) {
    return r * TILE + TILE / 2;
}

function holeAt(c, r) {
    return holes.find((h) => h.c === c && h.r === r) || null;
}

function trappedGuardAt(c, r, except) {
    return (
        guards.find(
            (g) =>
                g !== except &&
                g.trapped &&
                !g.dead &&
                colOf(g.x) === c &&
                rowOf(g.y) === r
        ) || null
    );
}

function goldRemaining() {
    let n = 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) if (grid[r][c] === GOLD) n++;
    }
    for (const g of guards) n += g.gold;
    return n;
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

function makeActor(c, r, kind) {
    return {
        kind,
        x: cx(c),
        y: cy(r),
        dir: { x: 0, y: 0 },
        facing: 1,
        falling: false,
        digTimer: 0,
        // guard-only fields, harmless on the runner
        trapped: false,
        trapTimer: 0,
        dead: false,
        respawn: 0,
        gold: 0,
        dropTimer: 0,
        planTimer: 0,
        next: null,
        lastHole: null,
        spawn: { c, r },
    };
}

function placeRunner(c, r) {
    runner.x = cx(c);
    runner.y = cy(r);
    runner.falling = false;
    runner.digTimer = 0;
}

function placeGuard(g, c, r) {
    g.x = cx(c);
    g.y = cy(r);
    g.falling = false;
    g.trapped = false;
    g.trapTimer = 0;
    g.dead = false;
    g.respawn = 0;
    g.next = null;
    g.planTimer = 0;
    g.lastHole = null;
}

function alignedX(a) {
    return Math.abs(a.x - cx(colOf(a.x))) <= ALIGN;
}

function alignedY(a) {
    return Math.abs(a.y - cy(rowOf(a.y))) <= ALIGN;
}

// Can an actor resting at this cell hold its ground?
function landingAt(a, c, r) {
    if (isLadderAt(c, r)) return true;
    if (a.kind === 'guard' && holeAt(c, r)) return true;
    if (isBlocking(c, r + 1)) return true;
    if (isLadderAt(c, r + 1)) return true;
    if (trappedGuardAt(c, r + 1, a)) return true;
    return false;
}

// Only ever consulted for an actor that is not already falling, so an actor
// part-way between rows here is mid-climb and the ladder below still holds it.
function isSupported(a) {
    const c = colOf(a.x);
    const r = rowOf(a.y);
    if (isLadderAt(c, r)) return true;
    if (isLadderAt(c, r + 1)) return true;
    if (a.kind === 'guard' && holeAt(c, r)) return true;
    if (isRopeAt(c, r) && alignedY(a) && a.dir.y <= 0) return true;
    if (!alignedY(a)) return false;
    if (isBlocking(c, r + 1)) return true;
    if (trappedGuardAt(c, r + 1, a)) return true;
    return false;
}

// Drop until the first cell whose landing test passes; ladders catch a fall,
// ropes do not, and a hole catches guards but lets the runner drop through.
function fall(a, dt) {
    const c = colOf(a.x);
    a.x = cx(c);
    const startRow = rowOf(a.y);
    let ny = a.y + FALL_SPEED * dt;
    const endRow = rowOf(ny);
    for (let r = startRow; r <= endRow; r++) {
        const centre = cy(r);
        if (centre + 0.001 < a.y || centre > ny) continue;
        if (landingAt(a, c, r)) {
            a.y = centre;
            a.falling = false;
            return;
        }
    }
    a.y = Math.min(ny, cy(ROWS - 1));
    if (a.y >= cy(ROWS - 1)) a.falling = false;
}

function moveTowards(value, target, maxStep) {
    if (Math.abs(target - value) <= maxStep) return target;
    return value + Math.sign(target - value) * maxStep;
}

// Shared axis-locked mover: horizontal motion happens in a row lane, vertical
// motion in a column lane, and an actor slides into the lane it is entering.
function moveActor(a, dt, runSpeed, climbSpeed) {
    if (a.falling) {
        fall(a, dt);
        return;
    }
    if (!isSupported(a)) {
        a.falling = true;
        fall(a, dt);
        return;
    }

    const c = colOf(a.x);
    const r = rowOf(a.y);

    if (a.dir.y < 0) {
        const canClimb = isLadderAt(c, r) && !isBlocking(c, r - 1) && r > 0;
        if (canClimb) {
            if (!alignedX(a)) {
                a.x = moveTowards(a.x, cx(c), runSpeed * dt);
                return;
            }
            a.x = cx(c);
            let ny = a.y - climbSpeed * dt;
            if (!isLadderAt(c, r - 1)) ny = Math.max(ny, cy(r - 1));
            a.y = ny;
            return;
        }
    } else if (a.dir.y > 0) {
        const canDescend = !isBlocking(c, r + 1) && r < ROWS - 1;
        if (canDescend) {
            if (!alignedX(a)) {
                a.x = moveTowards(a.x, cx(c), runSpeed * dt);
                return;
            }
            a.x = cx(c);
            a.y += climbSpeed * dt;
            return;
        }
    }

    if (a.dir.x !== 0) {
        if (!alignedY(a)) {
            a.y = moveTowards(a.y, cy(r), climbSpeed * dt);
            return;
        }
        a.y = cy(r);
        a.facing = a.dir.x;
        const speed = isRopeAt(c, r) ? Math.min(runSpeed, ROPE_SPEED) : runSpeed;
        let nx = a.x + a.dir.x * speed * dt;
        if (isBlocking(c + a.dir.x, r)) {
            nx = a.dir.x > 0 ? Math.min(nx, cx(c)) : Math.max(nx, cx(c));
        }
        a.x = Math.max(TILE / 2, Math.min(CANVAS_W - TILE / 2, nx));
    }
}

// ---------------------------------------------------------------------------
// Digging
// ---------------------------------------------------------------------------

function dig(side) {
    if (state !== 'running') return false;
    if (runner.digTimer > 0 || runner.falling) return false;
    const c = colOf(runner.x);
    const r = rowOf(runner.y);
    if (!alignedY(runner)) return false;
    if (isLadderAt(c, r) || isRopeAt(c, r)) return false;
    if (!isBlocking(c, r + 1)) return false;      // must stand on solid ground
    const tc = c + side;
    if (tc < 0 || tc >= COLS) return false;
    if (tileAt(tc, r + 1) !== BRICK) return false; // only brick can be dug
    if (isBlocking(tc, r) || tileAt(tc, r) === GOLD) return false;
    runner.x = cx(c);
    runner.facing = side;
    runner.digTimer = DIG_TIME;
    grid[r + 1][tc] = EMPTY;
    holes.push({ c: tc, r: r + 1, t: HOLE_REFILL });
    return true;
}

function digLeft() {
    return dig(-1);
}

function digRight() {
    return dig(1);
}

function updateHoles(dt) {
    for (let i = holes.length - 1; i >= 0; i--) {
        const h = holes[i];
        h.t -= dt;
        if (h.t > 0) continue;
        holes.splice(i, 1);
        grid[h.r][h.c] = BRICK;
        for (const g of guards) {
            if (!g.dead && colOf(g.x) === h.c && rowOf(g.y) === h.r) buryGuard(g);
        }
        if (colOf(runner.x) === h.c && rowOf(runner.y) === h.r) {
            killRunner();
            return;
        }
    }
}

function fillAllHoles() {
    for (const h of holes) grid[h.r][h.c] = BRICK;
    holes = [];
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

// Legal one-cell moves for a guard standing at (c, r) — the graph the chase
// planner searches.
function guardMoves(c, r) {
    const out = [];
    const standable =
        isBlocking(c, r + 1) ||
        isLadderAt(c, r + 1) ||
        isLadderAt(c, r) ||
        isRopeAt(c, r) ||
        holeAt(c, r) !== null;
    if (standable) {
        for (const d of [-1, 1]) {
            const nc = c + d;
            if (nc >= 0 && nc < COLS && !isBlocking(nc, r)) out.push({ c: nc, r });
        }
    }
    if (isLadderAt(c, r) && r > 0 && !isBlocking(c, r - 1)) out.push({ c, r: r - 1 });
    if (r < ROWS - 1 && !isBlocking(c, r + 1)) out.push({ c, r: r + 1 });
    return out;
}

// Breadth-first search from the guard to the runner; returns the next cell to
// step into, or null when there is no route.
function planStep(g) {
    const start = { c: colOf(g.x), r: rowOf(g.y) };
    const goal = { c: colOf(runner.x), r: rowOf(runner.y) };
    if (start.c === goal.c && start.r === goal.r) return null;
    const key = (c, r) => r * COLS + c;
    const prev = new Map([[key(start.c, start.r), null]]);
    const queue = [start];
    let head = 0;
    let found = false;
    while (head < queue.length) {
        const cur = queue[head++];
        if (cur.c === goal.c && cur.r === goal.r) {
            found = true;
            break;
        }
        for (const nb of guardMoves(cur.c, cur.r)) {
            const k = key(nb.c, nb.r);
            if (prev.has(k)) continue;
            prev.set(k, cur);
            queue.push(nb);
        }
    }
    if (!found) return null;
    let cur = goal;
    let back = prev.get(key(cur.c, cur.r));
    while (back && !(back.c === start.c && back.r === start.r)) {
        cur = back;
        back = prev.get(key(back.c, back.r));
    }
    return back ? cur : null;
}

function guardDirection(g, dt) {
    const c = colOf(g.x);
    const r = rowOf(g.y);
    g.planTimer -= dt;
    if (!g.next || g.planTimer <= 0) {
        g.next = planStep(g);
        g.planTimer = PLAN_INTERVAL;
    }
    const next = g.next;
    if (!next) {
        // No route: shuffle toward the runner along this floor.
        const dx = Math.sign(runner.x - g.x);
        g.dir.x = isBlocking(c + dx, r) ? 0 : dx;
        g.dir.y = 0;
        return;
    }
    if (next.r !== r) {
        g.dir.x = 0;
        g.dir.y = Math.sign(next.r - r);
    } else if (next.c !== c) {
        g.dir.x = Math.sign(next.c - c);
        g.dir.y = 0;
    } else {
        g.next = null;
        g.dir.x = 0;
        g.dir.y = 0;
    }
}

// Put a nugget back on the board so a level can never become unwinnable.
function returnGold(c, r) {
    const free = (cc, rr) =>
        tileAt(cc, rr) === EMPTY &&
        !holeAt(cc, rr) &&
        (isBlocking(cc, rr + 1) || isLadderAt(cc, rr) || isLadderAt(cc, rr + 1));
    if (free(c, r)) {
        grid[r][c] = GOLD;
        return;
    }
    for (let rr = ROWS - 1; rr >= 0; rr--) {
        for (let cc = 0; cc < COLS; cc++) {
            if (free(cc, rr)) {
                grid[rr][cc] = GOLD;
                return;
            }
        }
    }
}

function dropGuardGold(g, c, r) {
    if (!g.gold) return;
    g.gold = 0;
    returnGold(c, r);
}

function trapGuardIn(g, hole) {
    g.trapped = true;
    g.trapTimer = TRAP_ESCAPE;
    g.dir.x = 0;
    g.dir.y = 0;
    g.next = null;
    // Sliding back into the hole it just climbed out of is not worth points.
    if (g.lastHole !== hole) {
        score += TRAP_POINTS;
        g.lastHole = hole;
    }
    dropGuardGold(g, hole.c, hole.r - 1);
}

function buryGuard(g) {
    score += BURY_POINTS;
    if (g.gold) {
        g.gold = 0;
        returnGold(g.spawn.c, g.spawn.r);
    }
    g.dead = true;
    g.trapped = false;
    g.trapTimer = 0;
    g.respawn = RESPAWN_TIME;
}

function escapeHole(g) {
    const c = colOf(g.x);
    const r = rowOf(g.y);
    const toward = Math.sign(runner.x - g.x) || g.facing || 1;
    for (const d of [toward, -toward]) {
        if (isBlocking(c + d, r - 1) || c + d < 0 || c + d >= COLS) continue;
        g.trapped = false;
        g.trapTimer = 0;
        g.x = cx(c + d);
        g.y = cy(r - 1);
        g.falling = false;
        g.next = null;
        return;
    }
    g.trapTimer = 0.4; // boxed in; try again shortly
}

function updateGuard(g, dt) {
    if (g.dead) {
        g.respawn -= dt;
        if (g.respawn <= 0) placeGuard(g, g.spawn.c, g.spawn.r);
        return;
    }

    if (g.trapped) {
        g.dir.x = 0;
        g.dir.y = 0;
        g.trapTimer -= dt;
        if (g.gold) dropGuardGold(g, colOf(g.x), rowOf(g.y) - 1);
        if (g.trapTimer <= 0) escapeHole(g);
        return;
    }

    guardDirection(g, dt);
    moveActor(g, dt, guardSpeed, guardSpeed);

    const c = colOf(g.x);
    const r = rowOf(g.y);
    const hole = holeAt(c, r);
    if (hole && !g.falling && alignedY(g)) {
        trapGuardIn(g, hole);
        return;
    }

    if (!g.gold && grid[r][c] === GOLD) {
        grid[r][c] = EMPTY;
        g.gold = 1;
        g.dropTimer = GUARD_DROP_TIME;
    } else if (g.gold) {
        g.dropTimer -= dt;
        if (g.dropTimer <= 0 && grid[r][c] === EMPTY && !g.falling && !holeAt(c, r)) {
            dropGuardGold(g, c, r);
        }
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function loadLevel(index) {
    const src = LEVELS[index];
    grid = src.map((row) => row.split(''));
    guardSpawns = [];
    holes = [];
    exitRevealed = false;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (grid[r][c] === 'P') {
                runnerSpawn = { c, r };
                grid[r][c] = EMPTY;
            } else if (grid[r][c] === 'G') {
                guardSpawns.push({ c, r });
                grid[r][c] = EMPTY;
            }
        }
    }
    runner = makeActor(runnerSpawn.c, runnerSpawn.r, 'runner');
    guards = guardSpawns.map((s) => makeActor(s.c, s.r, 'guard'));
    guardSpeed = Math.min(GUARD_SPEED_CAP, GUARD_BASE_SPEED + (level - 1) * GUARD_SPEED_STEP);
}

function resetActors() {
    fillAllHoles();
    placeRunner(runnerSpawn.c, runnerSpawn.r);
    runner.dir.x = 0;
    runner.dir.y = 0;
    for (const g of guards) {
        if (g.gold) {
            g.gold = 0;
            returnGold(g.spawn.c, g.spawn.r);
        }
        placeGuard(g, g.spawn.c, g.spawn.r);
    }
}

function killRunner() {
    if (state !== 'running') return;
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    resetActors();
    updateHud();
}

function gameOver() {
    state = 'over';
    saveBest();
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to play again');
}

function winGame() {
    state = 'won';
    saveBest();
    updateHud();
    showOverlay('ALL CLEAR', `Score ${score}`, 'Press Space to play again');
}

function completeLevel() {
    score += LEVEL_POINTS;
    if (level >= LEVELS.length) {
        winGame();
        return;
    }
    level += 1;
    loadLevel(level - 1);
    updateHud();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    guardsEnabled = true;
    state = 'running';
    input.x = 0;
    input.y = 0;
    loadLevel(0);
    updateHud();
    hideOverlay();
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
            localStorage.setItem('loderunner-best', String(best));
        } catch (err) {
            /* storage unavailable — best simply is not persisted */
        }
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running' || dt <= 0) return;

    const before = lives;
    updateHoles(dt);
    if (lives !== before || state !== 'running') return;

    if (runner.digTimer > 0) {
        // Locked mid-swing: the shovel takes a moment and the runner is rooted.
        runner.digTimer -= dt;
        runner.dir.x = 0;
        runner.dir.y = 0;
    } else {
        runner.dir.x = input.x;
        runner.dir.y = input.y;
        moveActor(runner, dt, RUN_SPEED, CLIMB_SPEED);
    }

    const rc = colOf(runner.x);
    const rr = rowOf(runner.y);
    if (grid[rr][rc] === GOLD) {
        grid[rr][rc] = EMPTY;
        score += GOLD_POINTS;
    }

    exitRevealed = goldRemaining() === 0;

    if (guardsEnabled) {
        for (const g of guards) updateGuard(g, dt);
        for (const g of guards) {
            if (g.dead || g.trapped) continue;
            if (
                Math.abs(g.x - runner.x) < TILE * 0.6 &&
                Math.abs(g.y - runner.y) < TILE * 0.7
            ) {
                killRunner();
                updateHud();
                return;
            }
        }
    }

    if (exitRevealed && rowOf(runner.y) === 0) {
        completeLevel();
        return;
    }

    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elGold = document.getElementById('gold');
const elLives = document.getElementById('lives');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

let animTime = 0;

function drawBrick(x, y) {
    ctx.fillStyle = '#8d3b2a';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#a8503a';
    ctx.fillRect(x + 1, y + 1, TILE - 2, TILE / 2 - 2);
    ctx.fillRect(x + 1, y + TILE / 2 + 1, TILE - 2, TILE / 2 - 2);
    ctx.fillStyle = '#5f2418';
    ctx.fillRect(x + TILE / 2 - 1, y, 2, TILE / 2);
    ctx.fillRect(x, y + TILE / 2 - 1, TILE, 2);
    ctx.fillRect(x + TILE / 4 - 1, y + TILE / 2, 2, TILE / 2);
    ctx.fillRect(x + (3 * TILE) / 4 - 1, y + TILE / 2, 2, TILE / 2);
}

function drawStone(x, y) {
    ctx.fillStyle = '#48536b';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#5b6884';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#39435a';
    ctx.fillRect(x + 5, y + 6, TILE - 12, 3);
    ctx.fillRect(x + 8, y + TILE - 10, TILE - 14, 3);
}

function drawLadder(x, y) {
    ctx.fillStyle = '#e2b155';
    ctx.fillRect(x + 3, y, 4, TILE);
    ctx.fillRect(x + TILE - 7, y, 4, TILE);
    ctx.fillStyle = '#f6d489';
    for (let i = 0; i < 3; i++) ctx.fillRect(x + 3, y + 3 + i * 9, TILE - 6, 3);
}

function drawRope(x, y) {
    ctx.strokeStyle = '#d9c9a3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x + TILE, y + 6);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(217, 201, 163, 0.5)';
    ctx.lineWidth = 1;
    for (let i = 4; i < TILE; i += 7) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + 6);
        ctx.lineTo(x + i, y + 10);
        ctx.stroke();
    }
}

function drawGold(x, y) {
    const bob = Math.sin(animTime * 3 + x * 0.2) * 1.2;
    ctx.fillStyle = '#f2c14e';
    ctx.beginPath();
    ctx.ellipse(x + TILE / 2, y + TILE / 2 + bob, 8, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c79426';
    ctx.beginPath();
    ctx.ellipse(x + TILE / 2, y + TILE / 2 + 3 + bob, 8, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff3cd';
    ctx.beginPath();
    ctx.ellipse(x + TILE / 2 - 2.5, y + TILE / 2 - 2 + bob, 2.5, 1.6, -0.4, 0, Math.PI * 2);
    ctx.fill();
}

function drawExit(x, y) {
    ctx.strokeStyle = 'rgba(242, 193, 78, 0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(x + 5, y);
    ctx.lineTo(x + 5, y + TILE);
    ctx.moveTo(x + TILE - 5, y);
    ctx.lineTo(x + TILE - 5, y + TILE);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawFigure(a, body, trim) {
    const x = a.x;
    const y = a.y;
    const swing = a.falling ? 1 : Math.sin(animTime * 12 + a.x * 0.3);
    const lean = a.trapped ? 3 : 0;

    ctx.fillStyle = body;
    // torso
    ctx.fillRect(x - 5, y - 6 + lean, 10, 12);
    // head
    ctx.beginPath();
    ctx.arc(x, y - 10 + lean, 4.5, 0, Math.PI * 2);
    ctx.fill();
    // arms
    ctx.fillStyle = trim;
    ctx.fillRect(x - 8, y - 5 + lean, 3, 8 + swing * 2);
    ctx.fillRect(x + 5, y - 5 + lean, 3, 8 - swing * 2);
    // legs
    ctx.fillStyle = body;
    ctx.fillRect(x - 4, y + 6 + lean, 3, 7 + swing * 2);
    ctx.fillRect(x + 1, y + 6 + lean, 3, 7 - swing * 2);
    // eye, so the figure reads as facing somewhere
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(x + (a.facing >= 0 ? 1 : -3), y - 11 + lean, 2, 2);
}

function draw() {
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // subtle vault grid
    ctx.strokeStyle = 'rgba(80, 110, 170, 0.09)';
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(c * TILE + 0.5, 0);
        ctx.lineTo(c * TILE + 0.5, CANVAS_H);
        ctx.stroke();
    }

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = c * TILE;
            const y = r * TILE;
            const t = grid[r][c];
            if (t === BRICK) drawBrick(x, y);
            else if (t === STONE) drawStone(x, y);
            else if (t === LADDER) drawLadder(x, y);
            else if (t === ROPE) drawRope(x, y);
            else if (t === GOLD) drawGold(x, y);
            else if (t === EXIT) {
                if (exitRevealed) drawLadder(x, y);
                else drawExit(x, y);
            }
        }
    }

    // holes about to close flicker so the player can get clear
    for (const h of holes) {
        if (h.t > HOLE_WARN) continue;
        const pulse = 0.25 + 0.35 * Math.abs(Math.sin(h.t * 14));
        ctx.fillStyle = `rgba(168, 80, 58, ${pulse})`;
        ctx.fillRect(h.c * TILE, h.r * TILE, TILE, TILE);
    }

    for (const g of guards) {
        if (g.dead) continue;
        drawFigure(g, g.trapped ? '#a03a4a' : '#e05263', '#ffb3bc');
        if (g.gold) {
            ctx.fillStyle = '#f2c14e';
            ctx.beginPath();
            ctx.arc(g.x, g.y - 16, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawFigure(runner, '#7fd4ff', '#d7f2ff');

    if (runner.digTimer > 0) {
        const dx = runner.x + runner.facing * 14;
        ctx.strokeStyle = '#d7f2ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(runner.x + runner.facing * 6, runner.y);
        ctx.lineTo(dx, runner.y + 10);
        ctx.stroke();
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elGold.textContent = String(goldRemaining());
    elLives.textContent = String(lives);
    elBest.textContent = String(best);
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

const heldKeys = new Set();
const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];
const MOVE_KEYS = [...LEFT_KEYS, ...RIGHT_KEYS, ...UP_KEYS, ...DOWN_KEYS];
const DIG_LEFT_KEYS = ['z', 'Z', ','];
const DIG_RIGHT_KEYS = ['x', 'X', '.'];

function refreshInput() {
    const held = (keys) => keys.some((k) => heldKeys.has(k));
    input.x = (held(RIGHT_KEYS) ? 1 : 0) - (held(LEFT_KEYS) ? 1 : 0);
    input.y = (held(DOWN_KEYS) ? 1 : 0) - (held(UP_KEYS) ? 1 : 0);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if (e.key === 'r' || e.key === 'R') {
        if (state === 'running') killRunner();
        return;
    }
    if (DIG_LEFT_KEYS.includes(e.key)) {
        digLeft();
        e.preventDefault();
        return;
    }
    if (DIG_RIGHT_KEYS.includes(e.key)) {
        digRight();
        e.preventDefault();
        return;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        if (state === 'paused') togglePause();
        else if (state !== 'running') startGame();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshInput();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshInput();
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
    animTime += dt;
    step(dt);
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
level = 1;
loadLevel(0);
updateHud();
showOverlay('LODE RUNNER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
