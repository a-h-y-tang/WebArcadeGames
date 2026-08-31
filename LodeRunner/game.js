// ---------------------------------------------------------------------------
// Lode Runner — a dig-and-run maze platformer on an HTML5 canvas.
//
// The runner collects every piece of gold on a level while guards hunt it
// across the girders, ladders and ropes. The runner cannot jump or fight: its
// only weapon is a laser drill that melts a hole in the brick to its lower
// left or lower right. Guards tumble into the holes, the bricks grow back a
// few seconds later, and anything still standing in a hole is buried. Once the
// last coin is taken a hidden escape ladder appears; climb it to the top of
// the screen to finish the level.
//
// Written as a single classic (non-module) script so that state and helpers
// are reachable from the Playwright tests as plain globals, mirroring
// BurgerTime, Kaboom! and Snake in this repo.
//
// The world is a fixed grid. Actors always occupy a whole cell: a move commits
// the new cell immediately and `move` carries the interpolation used for
// drawing, so all game logic is exact integer cell arithmetic while the
// picture still slides smoothly. Every timer is expressed in seconds and
// advanced through `step(dt)`, so tests can simulate frames deterministically.
// Setting `autoStep = false` detaches the requestAnimationFrame loop from the
// simulation, which is what the specs do to stay free of wall-clock timing.
// ---------------------------------------------------------------------------

// --- Grid ------------------------------------------------------------------
const TILE = 24;
const COLS = 28;
const ROWS = 16;
const CANVAS_W = COLS * TILE;  // 672
const CANVAS_H = ROWS * TILE;  // 384

// Tile characters. '.' empty, '#' diggable brick, '=' solid stone,
// 'H' ladder, '-' rope, 'S' hidden escape ladder. In the level maps '$', 'R'
// and 'G' additionally mark gold, the runner's start and a guard's start;
// those cells become '.' once the level is parsed.
const EMPTY = '.';
const BRICK = '#';
const STONE = '=';
const LADDER = 'H';
const ROPE = '-';
const EXIT = 'S';

// --- Timing (seconds) ------------------------------------------------------
const RUN_DUR = 0.12;         // one cell of running or climbing
const FALL_DUR = 0.08;        // one cell of falling
const DIG_DUR = 0.4;          // drilling a brick
const DIG_BUFFER = 0.25;      // how long a dig pressed mid-stride is held
const HOLE_LIFE = 6;          // how long a hole stays open
const HOLE_WARN = 1.5;        // hole flashes for its last moments
const GUARD_DUR = 0.18;       // a guard is slower than the runner
const GUARD_FALL_DUR = 0.1;
const GUARD_TRAP = 2;         // how long a guard flounders in a hole
const CLIMB_OUT_DUR = 0.35;
const DYING_TIME = 1.2;
const CLEAR_TIME = 1.6;

// --- Scoring ---------------------------------------------------------------
const GOLD_SCORE = 100;
const TRAP_SCORE = 75;
const LEVEL_BONUS = 250;
const START_LIVES = 3;

// --- Levels ----------------------------------------------------------------
// Floors sit four rows apart so every walking surface has head room. Ladders
// end on the surface they serve, which is what makes "you cannot climb past
// the top of a ladder" a natural rule rather than a special case.
const LEVELS = [
    [
        '..........................S.',
        '..........................S.',
        '..........H.$.............S.',
        '........##H#################',
        '..........H.................',
        '..........H-----$----.......',
        '....$.H...H.........$.......',
        '..####H###################..',
        '......H.....................',
        '......H.....................',
        '....H.H...............H..$..',
        '####H###########..####H#####',
        '....H.................H.####',
        '....H.................H.....',
        '.R.$H...............G.H.....',
        '============================',
    ],
    [
        '........S...................',
        '........S...................',
        '........S.$.....H.....$..H..',
        '......##########H########H##',
        '................H........H..',
        '........----$---H--......H..',
        '..........G.....HH......$H..',
        '#################H##..######',
        '.................H..........',
        '.................H..........',
        '......$..H.......H..$...H...',
        '####..###H##..##########H###',
        '.........H..............H...',
        '.........H..............H...',
        '.R$......H........G.....H.$.',
        '============================',
    ],
    [
        '........................S...',
        '........................S...',
        '........................S...',
        '.........$........H.....S.$.',
        '......######==####H#########',
        '..................H.........',
        '..................H.........',
        '....$...H...$.....HG........',
        '..######H#############......',
        '........H...................',
        '........H-----$--------.....',
        '..$...G.H...........H.$.....',
        '###.######========##H###.###',
        '....................H.......',
        '.R...$..............H...G.$.',
        '============================',
    ],
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let grid = [];              // grid[row][col] — the mutable tile map
let gold = [];              // [{ col, row }] still to be collected
let holes = [];             // [{ col, row, timer }] currently open
let guards = [];
let runner = null;
let runnerSpawn = { col: 0, row: 0 };

let state = 'idle';         // idle | running | dying | levelclear | paused | over
let level = 1;
let cycle = 0;              // how many times the level set has been completed
let score = 0;
let lives = START_LIVES;
let best = 0;
let exitRevealed = false;
let deathTimer = 0;
let clearTimer = 0;
let flashTimer = 0;         // drives the hole / exit ladder flashing
let pausedFrom = 'running';

// Test hooks — the specs freeze the guards or the animation loop so that a
// simulation is driven purely by explicit step() calls.
let autoStep = true;
let guardsEnabled = true;
let guardsCanEscape = true;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const goldEl = document.getElementById('gold');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Tile helpers
// ---------------------------------------------------------------------------

// Outside the map: the sides and the floor are solid, the sky is open air.
function tileAt(col, row) {
    if (col < 0 || col >= COLS) return STONE;
    if (row >= ROWS) return STONE;
    if (row < 0) return EMPTY;
    return grid[row][col];
}

function isBlocking(t) {
    return t === BRICK || t === STONE;
}

function isClimbable(t) {
    return t === LADDER || (t === EXIT && exitRevealed);
}

function isRope(t) {
    return t === ROPE;
}

// An actor holds its position when it stands on something solid, on a ladder
// or hanging from a rope; otherwise gravity takes over. A ladder *below* is
// not support: you land on the ladder itself rather than hovering over it.
//
// An open hole is a scoop out of the brick rather than a shaft, so a guard
// that drops in lands in it — that is the trap the whole game turns on. The
// runner is nimbler and slips straight through, which is how a dug hole
// doubles as a way down to the floor below.
function canStandAt(col, row, forGuard) {
    if (forGuard && holeAt(col, row)) return true;
    const here = tileAt(col, row);
    if (isClimbable(here) || isRope(here)) return true;
    return isBlocking(tileAt(col, row + 1));
}

function holeAt(col, row) {
    return holes.find((h) => h.col === col && h.row === row) || null;
}

function guardAt(col, row, except) {
    return guards.find((g) => g !== except && g.col === col && g.row === row) || null;
}

// ---------------------------------------------------------------------------
// Level loading
// ---------------------------------------------------------------------------

function loadLevel(n) {
    const map = LEVELS[(n - 1) % LEVELS.length];
    grid = map.map((row) => row.split(''));
    gold = [];
    holes = [];
    guards = [];
    exitRevealed = false;

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const ch = grid[r][c];
            if (ch === '$') {
                gold.push({ col: c, row: r });
                grid[r][c] = EMPTY;
            } else if (ch === 'R') {
                runnerSpawn = { col: c, row: r };
                grid[r][c] = EMPTY;
            } else if (ch === 'G') {
                guards.push(makeGuard(c, r));
                grid[r][c] = EMPTY;
            }
        }
    }

    runner = {
        col: runnerSpawn.col,
        row: runnerSpawn.row,
        dir: { x: 0, y: 0 },
        facing: 1,
        move: null,
        digging: null,
        pendingDig: null,
    };
    updateHud();
}

function makeGuard(col, row) {
    return {
        col,
        row,
        spawn: { col, row },
        facing: 1,
        move: null,
        trapped: false,
        trapTimer: 0,
    };
}

function resetActors() {
    runner.col = runnerSpawn.col;
    runner.row = runnerSpawn.row;
    runner.move = null;
    runner.digging = null;
    runner.pendingDig = null;
    runner.dir.x = 0;
    runner.dir.y = 0;
    for (const g of guards) {
        g.col = g.spawn.col;
        g.row = g.spawn.row;
        g.move = null;
        g.trapped = false;
        g.trapTimer = 0;
    }
    // Any hole dug before the death is filled back in, so a fresh attempt
    // always starts from the level as it was designed.
    for (const h of holes) grid[h.row][h.col] = BRICK;
    holes = [];
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

// A move commits the destination cell straight away; `move` only carries the
// visual interpolation, so every rule below is exact integer arithmetic.
function beginMove(actor, dx, dy, dur) {
    actor.col += dx;
    actor.row += dy;
    if (dx !== 0) actor.facing = dx;
    actor.move = { dx, dy, t: 0, dur };
    return true;
}

function updateActor(actor, dt, decide) {
    let remaining = dt;
    for (let i = 0; i < 8 && remaining > 0; i++) {
        if (actor.move) {
            actor.move.t += remaining;
            if (actor.move.t < actor.move.dur) return;
            remaining = actor.move.t - actor.move.dur;
            actor.move = null;
        } else if (!decide(actor)) {
            return;
        }
    }
}

function decideRunner(a) {
    if (a.digging) return false;

    if (!canStandAt(a.col, a.row)) {
        if (!isBlocking(tileAt(a.col, a.row + 1))) return beginMove(a, 0, 1, FALL_DUR);
        return false;
    }

    const { x: dx, y: dy } = a.dir;

    if (dy === -1 && isClimbable(tileAt(a.col, a.row)) && isClimbable(tileAt(a.col, a.row - 1))) {
        return beginMove(a, 0, -1, RUN_DUR);
    }
    if (dy === 1 && !isBlocking(tileAt(a.col, a.row + 1)) && a.row + 1 < ROWS) {
        return beginMove(a, 0, 1, RUN_DUR);
    }
    if (dx !== 0 && !isBlocking(tileAt(a.col + dx, a.row))) {
        return beginMove(a, dx, 0, RUN_DUR);
    }
    if (dx !== 0) a.facing = dx;
    return false;
}

// The legal single-cell moves out of a cell, shared by the guards' pathfinder
// and their stepping so the two never disagree.
function movesFrom(col, row, forGuard) {
    // A hole is a dead end for the search: whoever drops in is stuck there
    // until the trap timer lets them scramble out, which routes never rely on.
    if (forGuard && holeAt(col, row)) return [];
    if (!canStandAt(col, row, forGuard)) {
        return isBlocking(tileAt(col, row + 1)) ? [] : [[0, 1]];
    }
    const out = [];
    if (!isBlocking(tileAt(col - 1, row))) out.push([-1, 0]);
    if (!isBlocking(tileAt(col + 1, row))) out.push([1, 0]);
    if (isClimbable(tileAt(col, row)) && isClimbable(tileAt(col, row - 1))) out.push([0, -1]);
    if (row + 1 < ROWS && !isBlocking(tileAt(col, row + 1))) out.push([0, 1]);
    return out;
}

// Breadth-first search across those moves, returning the first step of a
// shortest route from one cell to another. A guard sitting in a hole is a dead
// end for the search (it has no legal moves out), so routes never lead through
// traps. `forGuard` picks whose movement rules the route is planned with.
function chaseStep(from, to, forGuard) {
    const seen = new Uint8Array(COLS * ROWS);
    const queue = [{ col: from.col, row: from.row, first: null }];
    seen[from.row * COLS + from.col] = 1;

    for (let head = 0; head < queue.length; head++) {
        const node = queue[head];
        if (node.col === to.col && node.row === to.row) return node.first;
        for (const [dx, dy] of movesFrom(node.col, node.row, forGuard)) {
            const nc = node.col + dx;
            const nr = node.row + dy;
            if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
            const idx = nr * COLS + nc;
            if (seen[idx]) continue;
            seen[idx] = 1;
            queue.push({ col: nc, row: nr, first: node.first || [dx, dy] });
        }
    }
    return null;
}

function decideGuard(g) {
    if (g.trapped) return false;

    if (!canStandAt(g.col, g.row, true)) {
        if (!isBlocking(tileAt(g.col, g.row + 1))) return beginMove(g, 0, 1, GUARD_FALL_DUR);
        return false;
    }

    // Dropped into an open hole: flounder there until the trap timer runs out.
    if (holeAt(g.col, g.row)) {
        g.trapped = true;
        g.trapTimer = GUARD_TRAP;
        return false;
    }

    let stepDir = chaseStep(g, runner, true);
    if (!stepDir) {
        // No route (the runner is unreachable for now): shuffle towards it.
        const dx = Math.sign(runner.col - g.col);
        if (dx !== 0 && !isBlocking(tileAt(g.col + dx, g.row))) stepDir = [dx, 0];
    }
    if (!stepDir) return false;

    const [dx, dy] = stepDir;
    if (guardAt(g.col + dx, g.row + dy, g)) return false;
    return beginMove(g, dx, dy, guardMoveDur());
}

function guardMoveDur() {
    // Each completed pass through the level set makes the guards quicker.
    return Math.max(0.09, GUARD_DUR * Math.pow(0.88, cycle));
}

// A trapped guard scrambles out diagonally, preferring the side the runner is
// on, and is buried if the brick grows back first.
function updateTrappedGuard(g, dt) {
    if (!guardsCanEscape) return;
    g.trapTimer -= dt;
    if (g.trapTimer > 0) return;

    const towards = Math.sign(runner.col - g.col) || g.facing || 1;
    for (const dx of [towards, -towards]) {
        const dest = tileAt(g.col + dx, g.row - 1);
        if (!isBlocking(dest) && !guardAt(g.col + dx, g.row - 1, g)) {
            g.trapped = false;
            g.trapTimer = 0;
            beginMove(g, dx, -1, CLIMB_OUT_DUR);
            return;
        }
    }
    g.trapTimer = 0.25;  // both sides blocked — try again shortly
}

// ---------------------------------------------------------------------------
// Digging
// ---------------------------------------------------------------------------

function dig(dir) {
    if (state !== 'running') return false;
    if (runner.digging) return false;
    // A dig asked for mid-stride is remembered rather than dropped: the drill
    // fires the moment the runner settles, which is how it feels to play.
    if (runner.move) {
        runner.pendingDig = { dir, t: DIG_BUFFER };
        return false;
    }

    const col = runner.col;
    const row = runner.row;
    // You need firm ground under your boots: no digging while falling, on a
    // ladder or swinging from a rope.
    if (!isBlocking(tileAt(col, row + 1))) return false;
    if (isRope(tileAt(col, row)) || isClimbable(tileAt(col, row))) return false;

    const tc = col + dir;
    const tr = row + 1;
    if (tc < 0 || tc >= COLS) return false;
    if (tileAt(tc, tr) !== BRICK) return false;          // only brick melts
    if (isBlocking(tileAt(tc, row))) return false;       // the hole must be reachable
    if (guardAt(tc, tr) || guardAt(tc, row)) return false;

    runner.facing = dir;
    runner.digging = { col: tc, row: tr, dir, t: 0, dur: DIG_DUR };
    return true;
}

function updateDigging(dt) {
    const pending = runner.pendingDig;
    if (pending) {
        pending.t -= dt;
        if (pending.t <= 0) runner.pendingDig = null;
        else if (!runner.move && !runner.digging) {
            runner.pendingDig = null;
            dig(pending.dir);
        }
    }

    const d = runner.digging;
    if (!d) return;
    d.t += dt;
    if (d.t < d.dur) return;
    runner.digging = null;
    if (grid[d.row][d.col] !== BRICK) return;
    grid[d.row][d.col] = EMPTY;
    holes.push({ col: d.col, row: d.row, timer: HOLE_LIFE });
}

function updateHoles(dt) {
    for (let i = holes.length - 1; i >= 0; i--) {
        const h = holes[i];
        h.timer -= dt;
        if (h.timer > 0) continue;
        holes.splice(i, 1);
        grid[h.row][h.col] = BRICK;

        for (const g of guards) {
            if (g.col === h.col && g.row === h.row) buryGuard(g);
        }
        if (runner.col === h.col && runner.row === h.row) killRunner();
    }
}

function buryGuard(g) {
    score += TRAP_SCORE;
    g.col = g.spawn.col;
    g.row = g.spawn.row;
    g.move = null;
    g.trapped = false;
    g.trapTimer = 0;
}

// ---------------------------------------------------------------------------
// Gold, escape, death
// ---------------------------------------------------------------------------

function collectGold() {
    for (let i = gold.length - 1; i >= 0; i--) {
        if (gold[i].col === runner.col && gold[i].row === runner.row) {
            gold.splice(i, 1);
            score += GOLD_SCORE;
        }
    }
    if (gold.length === 0) exitRevealed = true;
}

function killRunner() {
    if (state !== 'running') return;
    lives -= 1;
    state = 'dying';
    deathTimer = DYING_TIME;
    runner.move = null;
    runner.digging = null;
    runner.pendingDig = null;
}

function clearLevel() {
    score += LEVEL_BONUS;
    state = 'levelclear';
    clearTimer = CLEAR_TIME;
}

function nextLevel() {
    if (level % LEVELS.length === 0) cycle += 1;
    level += 1;
    loadLevel(level);
    state = 'running';
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('loderunner-best', String(best));
        } catch (err) {
            /* private browsing — the best score simply is not persisted */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to play again');
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    cycle = 0;
    guardsEnabled = true;
    guardsCanEscape = true;
    loadLevel(level);
    state = 'running';
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        pausedFrom = state;
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = pausedFrom;
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    flashTimer += dt;

    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) {
            if (lives <= 0) gameOver();
            else {
                resetActors();
                state = 'running';
            }
        }
        updateHud();
        return;
    }

    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        updateHud();
        return;
    }

    if (state !== 'running') return;

    updateDigging(dt);
    updateActor(runner, dt, decideRunner);
    collectGold();

    if (guardsEnabled) {
        for (const g of guards) {
            if (g.trapped && !g.move) updateTrappedGuard(g, dt);
            updateActor(g, dt, decideGuard);
        }
    }

    updateHoles(dt);

    for (const g of guards) {
        if (g.col === runner.col && g.row === runner.row) {
            killRunner();
            break;
        }
    }

    if (state === 'running' && exitRevealed && runner.row === 0 && !runner.move) clearLevel();

    updateHud();
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

// Where an actor should be painted: its committed cell, pulled back towards
// the cell it is coming from by whatever is left of the current move.
function actorPos(a) {
    let x = a.col * TILE;
    let y = a.row * TILE;
    if (a.move) {
        const left = 1 - a.move.t / a.move.dur;
        x -= a.move.dx * TILE * left;
        y -= a.move.dy * TILE * left;
    }
    return { x, y };
}

function drawBrick(x, y) {
    ctx.fillStyle = '#8a4526';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#a5573180';
    ctx.fillRect(x + 1, y + 1, TILE - 2, TILE / 2 - 2);
    ctx.fillRect(x + 1, y + TILE / 2 + 1, TILE - 2, TILE / 2 - 2);
    ctx.strokeStyle = '#40200f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + TILE / 2 + 0.5);
    ctx.lineTo(x + TILE, y + TILE / 2 + 0.5);
    ctx.moveTo(x + TILE / 2 + 0.5, y);
    ctx.lineTo(x + TILE / 2 + 0.5, y + TILE / 2);
    ctx.stroke();
}

function drawStone(x, y) {
    ctx.fillStyle = '#3d4d63';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#4d6079';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 8);
    ctx.strokeStyle = '#26313f';
    ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
}

function drawLadder(x, y, colour) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 5, y);
    ctx.lineTo(x + 5, y + TILE);
    ctx.moveTo(x + TILE - 5, y);
    ctx.lineTo(x + TILE - 5, y + TILE);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const ry of [y + 6, y + 16]) {
        ctx.moveTo(x + 5, ry);
        ctx.lineTo(x + TILE - 5, ry);
    }
    ctx.stroke();
}

function drawRope(x, y) {
    ctx.strokeStyle = '#c69a58';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + 5.5);
    ctx.lineTo(x + TILE, y + 5.5);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 3; i < TILE; i += 6) {
        ctx.moveTo(x + i, y + 3);
        ctx.lineTo(x + i, y + 8);
    }
    ctx.stroke();
}

function drawTiles() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = c * TILE;
            const y = r * TILE;
            const t = grid[r][c];
            if (t === BRICK) drawBrick(x, y);
            else if (t === STONE) drawStone(x, y);
            else if (t === LADDER) drawLadder(x, y, '#d9b45c');
            else if (t === ROPE) drawRope(x, y);
            else if (t === EXIT && exitRevealed) {
                const pulse = 0.65 + 0.35 * Math.sin(flashTimer * 6);
                ctx.globalAlpha = pulse;
                drawLadder(x, y, '#7ef7c4');
                ctx.globalAlpha = 1;
            }
        }
    }
}

function drawHoles() {
    for (const h of holes) {
        if (h.timer > HOLE_WARN) continue;
        // A hole about to close flickers with the brick that is growing back.
        const pulse = 0.5 + 0.5 * Math.sin(flashTimer * 22);
        ctx.globalAlpha = pulse * 0.7;
        drawBrick(h.col * TILE, h.row * TILE);
        ctx.globalAlpha = 1;
    }
}

function drawDigging() {
    const d = runner.digging;
    if (!d) return;
    const x = d.col * TILE;
    const y = d.row * TILE;
    const progress = d.t / d.dur;
    ctx.fillStyle = '#050912';
    ctx.fillRect(x + 2, y + 2, TILE - 4, (TILE - 4) * progress);
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(runner.col * TILE + TILE / 2, runner.row * TILE + TILE - 6);
    ctx.lineTo(x + TILE / 2, y + 6);
    ctx.stroke();
}

function drawCoin(x, y) {
    const cx = x + TILE / 2;
    const cy = y + TILE / 2 + 2;
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 7, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b8860b';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 4, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff3c4';
    ctx.fillRect(cx - 5, cy - 6, 2, 4);
}

function drawFigure(x, y, body, head, actor) {
    const cx = x + TILE / 2;
    const climbing = actor.move && actor.move.dy !== 0;
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(cx, y + 7, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = body;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, y + 11);
    ctx.lineTo(cx, y + 17);
    ctx.stroke();

    // Arms and legs swing with the stride so running reads at a glance.
    const swing = Math.sin(flashTimer * 16) * (actor.move ? 3.5 : 0);
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (climbing) {
        ctx.moveTo(cx - 5, y + 11 - swing);
        ctx.lineTo(cx + 5, y + 11 + swing);
    } else {
        ctx.moveTo(cx - 5, y + 13 + swing);
        ctx.lineTo(cx + 5, y + 13 - swing);
    }
    ctx.moveTo(cx, y + 17);
    ctx.lineTo(cx - 4, y + 22 - swing);
    ctx.moveTo(cx, y + 17);
    ctx.lineTo(cx + 4, y + 22 + swing);
    ctx.stroke();
}

function drawActors() {
    for (const g of guards) {
        const p = actorPos(g);
        drawFigure(p.x, p.y, '#ff6b6b', '#ff9a9a', g);
    }
    const p = actorPos(runner);
    if (state !== 'dying' || Math.floor(flashTimer * 12) % 2 === 0) {
        drawFigure(p.x, p.y, '#57d7ff', '#bdf0ff', runner);
    }
}

function drawBanner(text, sub) {
    ctx.fillStyle = 'rgba(5, 9, 18, 0.72)';
    ctx.fillRect(0, CANVAS_H / 2 - 46, CANVAS_W, 92);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd34d';
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2 + 2);
    if (sub) {
        ctx.fillStyle = '#e6f0ff';
        ctx.font = '15px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(sub, CANVAS_W / 2, CANVAS_H / 2 + 28);
    }
    ctx.textAlign = 'start';
}

function draw() {
    ctx.fillStyle = '#050912';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    if (!runner) return;

    drawTiles();
    drawHoles();
    for (const c of gold) drawCoin(c.col * TILE, c.row * TILE);
    drawDigging();
    drawActors();

    if (state === 'dying') drawBanner('CAUGHT!', `${lives} ${lives === 1 ? 'life' : 'lives'} left`);
    if (state === 'levelclear') drawBanner('ESCAPED!', `Level ${level} cleared`);
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    goldEl.textContent = String(gold.length);
    livesEl.textContent = String(Math.max(0, lives));
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

function refreshDir() {
    const held = (keys) => keys.some((k) => heldKeys.has(k));
    runner.dir.x = (held(RIGHT_KEYS) ? 1 : 0) - (held(LEFT_KEYS) ? 1 : 0);
    runner.dir.y = (held(DOWN_KEYS) ? 1 : 0) - (held(UP_KEYS) ? 1 : 0);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'paused') togglePause();
        e.preventDefault();
        return;
    }
    if (DIG_LEFT_KEYS.includes(e.key)) {
        dig(-1);
        e.preventDefault();
        return;
    }
    if (DIG_RIGHT_KEYS.includes(e.key)) {
        dig(1);
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshDir();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshDir();
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
    if (autoStep) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('loderunner-best') || '0', 10) || 0;
loadLevel(1);
state = 'idle';
score = 0;
lives = START_LIVES;
updateHud();
showOverlay('LODE RUNNER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
