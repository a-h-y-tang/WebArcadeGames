// Lode Runner — dig, collect, escape.
//
// Everything lives in the global scope on purpose: the Playwright suite drives
// the simulation directly through `step()`, `draw()` and the state below, the
// same way the other games in this repo are tested.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TILE = 20;
const COLS = 28;
const ROWS = 16;
const CANVAS_W = COLS * TILE;
const CANVAS_H = ROWS * TILE;

// Speeds are in tiles per second.
const RUN_SPEED = 6.5;
const CLIMB_SPEED = 5.5;
const FALL_SPEED = 11.5;
const GUARD_BASE = 4.2;
const GUARD_STEP = 0.22;

const HOLE_REFILL = 5;
const HOLE_WARN = 1.3;
const GUARD_TRAP = 2.2;
const GUARD_CLIMB = 0.35;
const GUARD_RESPAWN = 1.5;
const DEATH_PAUSE = 1.2;
const CLEAR_PAUSE = 1.8;

const GOLD_SCORE = 150;
const GUARD_SCORE = 250;
const LEVEL_SCORE = 1000;
const START_LIVES = 3;

const EPS = 1e-6;
const BEST_KEY = 'loderunner-best';

// ---------------------------------------------------------------------------
// Level data
//
//   #  stone (cannot be dug)      H  ladder        $  gold
//   B  brick (can be dug)         -  bar           &  guard
//   S  escape ladder (hidden)     @  runner        ' ' air
// ---------------------------------------------------------------------------
const LEVELS = [
    {
        name: 'Copper Mine',
        rows: [
            '                            ',
            '            S               ',
            '  $         S   $   &   $   ',
            '#BBBBHBBBBBBBBBBBBBBBBBBBBB#',
            '     H                      ',
            '     H  $   ------        $ ',
            '#BBBBBBBBBBB      BBBHBBBBB#',
            '                     H      ',
            '              $      H      ',
            '#BB    BBHBBBBBBBBBBBBBBBHB#',
            '         H               H  ',
            '   -$--  H     &         H  ',
            '#BBBBBBBBBBBBBBBBBHB     HB#',
            '                  H      H  ',
            ' @         $      H   $  H  ',
            '############################',
        ],
    },
    {
        name: 'Steel Vault',
        rows: [
            '                            ',
            '        S                   ',
            ' &    $ S --$-      $     $ ',
            '#BBHBBBBBB    BBBBBBBBBBHBB#',
            '   H                    H   ',
            ' $ H         $    ---&- H   ',
            '#########BBBBBBBHBBBBBBBBBB#',
            '                H           ',
            '       $      --H---      $ ',
            '#BBBBBBBBBBHBB      BBHBBBB#',
            '           H          H     ',
            '           H      $   H  &  ',
            '#BHBBB    BHBBBBBBB#########',
            '  H        H                ',
            '  H  $     H  @          $  ',
            '############################',
        ],
    },
    {
        name: 'Sky Refinery',
        rows: [
            '                            ',
            '            S               ',
            ' --$---    $S    $  $       ',
            '#      BHBBBBBBBBBBHB      #',
            '        H          H        ',
            '    &   H-$--      H $      ',
            '#BHBBBBBB    BHBBBBB    BBH#',
            '  H           H           H ',
            '  H$          H --$-    & H ',
            '#BBB    BHBBBBBB    BBHB####',
            '         H            H     ',
            '        &H--$--       H  $  ',
            '####BBHBBB     BBBBBBBHBBBB#',
            '      H               H     ',
            '  $   H         $     H   @ ',
            '############################',
        ],
    },
];

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elGold = document.getElementById('gold');
const elLives = document.getElementById('lives');
const elBest = document.getElementById('best');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let grid = [];
let gold = [];
let guards = [];
let holes = [];
let exitCells = [];
let exitOpen = false;
let spawn = { c: 1, r: 14 };
let runner = { x: 1, y: 14, facing: 1, falling: false, mode: 'run', anim: 0 };

let state = 'idle';
let score = 0;
let lives = START_LIVES;
let level = 1;
let best = loadBest();
let timer = 0;
let clock = 0;

let input = { x: 0, y: 0 };
const held = { left: false, right: false, up: false, down: false };

// Test hook: when false the animation loop still draws but stops advancing the
// simulation, so specs can step time themselves.
let autoStep = true;

function loadBest() {
    try {
        return Number(window.localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
        return 0;
    }
}

function saveBest() {
    try {
        window.localStorage.setItem(BEST_KEY, String(best));
    } catch (err) {
        /* storage unavailable — the run just isn't remembered */
    }
}

// ---------------------------------------------------------------------------
// Terrain helpers
// ---------------------------------------------------------------------------
function tileAt(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return '#';
    return grid[r][c];
}

function blocking(c, r) {
    const t = tileAt(c, r);
    return t === '#' || t === 'B';
}

function isLadder(c, r) {
    const t = tileAt(c, r);
    return t === 'H' || (t === 'S' && exitOpen);
}

function isBar(c, r) {
    return tileAt(c, r) === '-';
}

function holeAt(c, r) {
    return holes.some((h) => h.c === c && h.r === r);
}

// A trapped guard fills its hole, so the runner can walk over its head.
function headAt(c, r) {
    return guards.some(
        (g) => g.state === 'trapped' && Math.round(g.x) === c && Math.round(g.y) === r
    );
}

// Can an entity hold this cell without falling?
function canStand(c, r) {
    return (
        isLadder(c, r) ||
        isBar(c, r) ||
        blocking(c, r + 1) ||
        isLadder(c, r + 1) ||
        headAt(c, r + 1)
    );
}

// Guards additionally rest inside a hole — that is what traps them.
function restsAt(c, r, guard) {
    if (guard && holeAt(c, r)) return true;
    return isLadder(c, r) || blocking(c, r + 1) || isLadder(c, r + 1) || headAt(c, r + 1);
}

function supported(e, guard) {
    const c = Math.round(e.x);
    const r = Math.round(e.y);
    if (Math.abs(e.y - r) > EPS) {
        // Part-way between two rows: a climb in progress is held by the ladder
        // it is on, anything else here is a fall.
        if (e.falling) return false;
        return isLadder(c, Math.floor(e.y)) || isLadder(c, Math.ceil(e.y));
    }
    if (guard && holeAt(c, r)) return true;
    return canStand(c, r);
}

// The row a fall from `y` in column `c` ends on. Bars are not nets.
function landingRow(c, y, guard) {
    let r = Math.ceil(y - EPS);
    while (r < ROWS - 1 && !restsAt(c, r, guard)) r++;
    return r;
}

// ---------------------------------------------------------------------------
// Level loading
// ---------------------------------------------------------------------------
function loadLevel(n) {
    const data = LEVELS[(n - 1) % LEVELS.length];
    grid = data.rows.map((row) => [...row]);
    gold = [];
    guards = [];
    holes = [];
    exitCells = [];
    exitOpen = false;

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const ch = grid[r][c];
            if (ch === '$') {
                gold.push({ c, r, taken: false });
                grid[r][c] = ' ';
            } else if (ch === '&') {
                guards.push(makeGuard(c, r));
                grid[r][c] = ' ';
            } else if (ch === '@') {
                spawn = { c, r };
                grid[r][c] = ' ';
            } else if (ch === 'S') {
                exitCells.push({ c, r });
            }
        }
    }

    runner = { x: spawn.c, y: spawn.r, facing: 1, falling: false, mode: 'run', anim: 0 };
    input = { x: 0, y: 0 };
    updateHud();
}

function makeGuard(c, r) {
    return {
        x: c,
        y: r,
        home: { c, r },
        facing: 1,
        falling: false,
        state: 'active',
        t: 0,
        step: null,
        target: null,
        from: { x: c, y: r },
        to: { x: c, y: r },
        anim: 0,
    };
}

function spawnGuard(c, r) {
    const g = makeGuard(c, r);
    guards.push(g);
    return g;
}

function placeRunner(c, r) {
    runner.x = c;
    runner.y = r;
    runner.falling = false;
}

function goldLeft() {
    return gold.filter((g) => !g.taken).length;
}

// ---------------------------------------------------------------------------
// Shared movement
// ---------------------------------------------------------------------------

// Walk horizontally, re-checking the terrain at every column boundary.
function walk(e, dirX, speed, dt) {
    const r = Math.round(e.y);
    e.y = r;
    let x = e.x;
    let remaining = speed * dt;
    while (remaining > EPS) {
        const from = dirX > 0 ? Math.floor(x + EPS) : Math.ceil(x - EPS);
        const to = from + dirX;
        if (Math.abs(x - from) < EPS && blocking(to, r)) break;
        const next = dirX > 0 ? Math.min(x + remaining, to) : Math.max(x - remaining, to);
        remaining -= Math.abs(next - x);
        x = next;
    }
    const moved = Math.abs(x - e.x) > EPS;
    e.x = x;
    return moved;
}

// Climb a ladder, re-checking at every row boundary. Returns whether it moved,
// so the caller can fall back to walking when the climb is impossible.
function climb(e, dirY, speed, dt) {
    const c = Math.round(e.x);
    const r = Math.round(e.y);
    if (Math.abs(e.y - r) < EPS) {
        if (dirY < 0 && (!isLadder(c, r) || blocking(c, r - 1))) return false;
        if (dirY > 0 && !isLadder(c, r + 1)) return false;
    }
    e.x = c;
    let y = e.y;
    let remaining = speed * dt;
    while (remaining > EPS) {
        const from = dirY < 0 ? Math.ceil(y - EPS) : Math.floor(y + EPS);
        const to = from + dirY;
        if (Math.abs(y - from) < EPS) {
            const ok = dirY < 0 ? isLadder(c, from) && !blocking(c, to) : isLadder(c, to);
            if (!ok) break;
        }
        const next = dirY < 0 ? Math.max(y - remaining, to) : Math.min(y + remaining, to);
        remaining -= Math.abs(next - y);
        y = next;
    }
    const moved = Math.abs(y - e.y) > EPS;
    e.y = y;
    return moved;
}

// Pressing down while hanging lets go of the bar.
function releasingBar(e, dirY) {
    const c = Math.round(e.x);
    const r = Math.round(e.y);
    return (
        dirY > 0 &&
        Math.abs(e.y - r) < EPS &&
        isBar(c, r) &&
        !isLadder(c, r) &&
        !isLadder(c, r + 1) &&
        !blocking(c, r + 1) &&
        !headAt(c, r + 1)
    );
}

function fall(e, dt, guard) {
    const c = Math.round(e.x);
    e.x = c;
    const land = landingRow(c, e.y, guard);
    e.y = Math.min(e.y + FALL_SPEED * dt, land);
    if (e.y >= land - EPS) {
        e.y = land;
        return true; // landed
    }
    return false;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
function updateRunner(dt) {
    if (releasingBar(runner, input.y) || !supported(runner, false)) {
        runner.falling = !fall(runner, dt, false);
        setRunnerMode();
        return;
    }

    runner.falling = false;
    let moved = false;
    if (input.y !== 0) moved = climb(runner, input.y < 0 ? -1 : 1, CLIMB_SPEED, dt);
    if (!moved && input.x !== 0) {
        runner.facing = input.x;
        moved = walk(runner, input.x, RUN_SPEED, dt);
    }
    if (moved) runner.anim += dt * 12;
    setRunnerMode();
}

function setRunnerMode() {
    const c = Math.round(runner.x);
    const r = Math.round(runner.y);
    if (runner.falling) runner.mode = 'fall';
    else if (isLadder(c, r)) runner.mode = 'climb';
    else if (isBar(c, r) && !blocking(c, r + 1)) runner.mode = 'hang';
    else runner.mode = 'run';
}

// ---------------------------------------------------------------------------
// Digging
// ---------------------------------------------------------------------------
function dig(dirX) {
    if (state !== 'running') return false;
    const c = Math.round(runner.x);
    const r = Math.round(runner.y);
    if (runner.falling) return false;
    if (Math.abs(runner.y - r) > EPS) return false;
    if (isLadder(c, r) || isBar(c, r)) return false;
    if (!blocking(c, r + 1)) return false;

    const tc = c + dirX;
    const tr = r + 1;
    if (tileAt(tc, tr) !== 'B') return false;
    if (blocking(tc, r)) return false;

    grid[tr][tc] = ' ';
    holes.push({ c: tc, r: tr, t: 0 });
    runner.facing = dirX;
    return true;
}

function updateHoles(dt) {
    for (let i = holes.length - 1; i >= 0; i--) {
        const h = holes[i];
        h.t += dt;
        if (h.t < HOLE_REFILL) continue;
        grid[h.r][h.c] = 'B';
        holes.splice(i, 1);
        for (const g of guards) {
            if (g.state === 'dead') continue;
            if (Math.round(g.x) === h.c && Math.round(g.y) === h.r) buryGuard(g);
        }
        if (Math.round(runner.x) === h.c && Math.round(runner.y) === h.r) killRunner();
    }
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------
function guardSpeed() {
    return Math.min(GUARD_BASE + (level - 1) * GUARD_STEP, RUN_SPEED - 0.7);
}

function trapGuard(g) {
    g.state = 'trapped';
    g.t = GUARD_TRAP;
    g.step = null;
    g.target = null;
    g.falling = false;
    g.x = Math.round(g.x);
    g.y = Math.round(g.y);
}

function buryGuard(g) {
    g.state = 'dead';
    g.t = GUARD_RESPAWN;
    score += GUARD_SCORE;
    updateHud();
}

function climbOut(g) {
    const c = Math.round(g.x);
    const r = Math.round(g.y);
    const toward = runner.x < g.x ? -1 : 1;
    for (const side of [toward, -toward]) {
        const nc = c + side;
        const nr = r - 1;
        if (nc < 0 || nc >= COLS) continue;
        if (blocking(nc, nr) || !canStand(nc, nr)) continue;
        g.state = 'climbing';
        g.step = null;
        g.target = null;
        g.from = { x: g.x, y: g.y };
        g.to = { x: nc, y: nr };
        g.t = GUARD_CLIMB;
        g.facing = side;
        return;
    }
    g.t = 0.4; // walled in for now — try again shortly
}

function respawnGuard(g) {
    const spots = [];
    for (let r = 1; r < 8; r++) {
        for (let c = 1; c < COLS - 1; c++) {
            if (!blocking(c, r) && !holeAt(c, r) && canStand(c, r)) spots.push({ c, r });
        }
    }
    const spot = spots.length ? spots[Math.floor(Math.random() * spots.length)] : g.home;
    g.x = spot.c;
    g.y = spot.r;
    g.state = 'active';
    g.step = null;
    g.target = null;
    g.falling = false;
    g.t = 0;
}

// Breadth-first search over exactly the moves an entity is allowed to make.
function neighbours(c, r) {
    const out = [];
    const add = (nc, nr) => {
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) return;
        if (blocking(nc, nr)) return;
        out.push({ c: nc, r: nr });
    };
    if (canStand(c, r) || holeAt(c, r)) {
        add(c - 1, r);
        add(c + 1, r);
    }
    if (isLadder(c, r)) add(c, r - 1);
    add(c, r + 1);
    return out;
}

function nextStep(g) {
    const start = { c: Math.round(g.x), r: Math.round(g.y) };
    const goal = { c: Math.round(runner.x), r: Math.round(runner.y) };
    if (start.c === goal.c && start.r === goal.r) return null;

    const key = (c, r) => r * COLS + c;
    const prev = new Map();
    const seen = new Set([key(start.c, start.r)]);
    const queue = [start];
    let found = false;
    while (queue.length) {
        const cur = queue.shift();
        if (cur.c === goal.c && cur.r === goal.r) {
            found = true;
            break;
        }
        for (const n of neighbours(cur.c, cur.r)) {
            const k = key(n.c, n.r);
            if (seen.has(k)) continue;
            seen.add(k);
            prev.set(k, cur);
            queue.push(n);
        }
    }

    if (found) {
        let node = goal;
        for (let guardStop = 0; guardStop < COLS * ROWS; guardStop++) {
            const p = prev.get(key(node.c, node.r));
            if (!p) break;
            if (p.c === start.c && p.r === start.r)
                return { dx: node.c - start.c, dy: node.r - start.r };
            node = p;
        }
    }

    // No route: shuffle toward the runner if the way is open.
    const dx = Math.sign(goal.c - start.c);
    if (dx && !blocking(start.c + dx, start.r)) return { dx, dy: 0 };
    return null;
}

function updateGuard(g, dt) {
    if (g.state === 'dead') {
        g.t -= dt;
        if (g.t <= 0) respawnGuard(g);
        return;
    }

    if (g.state === 'trapped') {
        g.t -= dt;
        if (g.t <= 0) climbOut(g);
        return;
    }

    if (g.state === 'climbing') {
        g.t -= dt;
        const k = Math.max(0, Math.min(1, 1 - g.t / GUARD_CLIMB));
        g.x = g.from.x + (g.to.x - g.from.x) * k;
        g.y = g.from.y + (g.to.y - g.from.y) * k;
        if (g.t <= 0) {
            g.x = g.to.x;
            g.y = g.to.y;
            g.state = 'active';
            g.step = null;
            g.target = null;
        }
        return;
    }

    const c = Math.round(g.x);
    const r = Math.round(g.y);
    const atCell = Math.abs(g.x - c) < EPS && Math.abs(g.y - r) < EPS;

    if (atCell && holeAt(c, r)) {
        trapGuard(g);
        return;
    }

    if (atCell && !g.target) g.step = nextStep(g);
    // Heading down into something that is not a ladder means letting go.
    const dropping =
        atCell &&
        !g.target &&
        g.step &&
        g.step.dy > 0 &&
        !isLadder(c, r + 1) &&
        !blocking(c, r + 1);

    if (dropping || !supported(g, true)) {
        g.target = null;
        const landed = fall(g, dt, true);
        g.falling = !landed;
        if (landed && holeAt(Math.round(g.x), Math.round(g.y))) trapGuard(g);
        return;
    }
    g.falling = false;

    moveGuard(g, dt);
}

// Guards move from cell centre to cell centre, re-planning at each arrival.
// Anything looser and a guard can sail past the junction it meant to turn at.
function moveGuard(g, dt) {
    let remaining = guardSpeed() * dt;
    while (remaining > EPS) {
        if (!g.target) {
            const c = Math.round(g.x);
            const r = Math.round(g.y);
            if (!g.step) g.step = nextStep(g);
            const move = g.step;
            g.step = null;
            if (!move || !legalGuardMove(g, c, r, move)) return;
            if (move.dx) g.facing = move.dx;
            g.target = { x: c + move.dx, y: r + move.dy };
        }
        const dx = g.target.x - g.x;
        const dy = g.target.y - g.y;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist <= remaining + EPS) {
            g.x = g.target.x;
            g.y = g.target.y;
            g.target = null;
            remaining -= dist;
            g.anim += 0.6;
            const c = Math.round(g.x);
            const r = Math.round(g.y);
            if (holeAt(c, r)) {
                trapGuard(g);
                return;
            }
            if (!supported(g, true)) return; // walked off an edge — fall next tick
        } else {
            const k = remaining / dist;
            g.x += dx * k;
            g.y += dy * k;
            g.anim += remaining * 10;
            remaining = 0;
        }
    }
}

function legalGuardMove(g, c, r, move) {
    if (move.dy < 0) return isLadder(c, r) && !blocking(c, r - 1);
    if (move.dy > 0) return isLadder(c, r + 1);
    if (move.dx) return !blocking(c + move.dx, r);
    return false;
}

function caught() {
    return guards.some(
        (g) =>
            g.state === 'active' &&
            Math.abs(g.x - runner.x) < 0.6 &&
            Math.abs(g.y - runner.y) < 0.6
    );
}

// ---------------------------------------------------------------------------
// Gold, escape, life cycle
// ---------------------------------------------------------------------------
function collectGold() {
    const c = Math.round(runner.x);
    const r = Math.round(runner.y);
    let took = false;
    for (const g of gold) {
        if (g.taken || g.c !== c || g.r !== r) continue;
        g.taken = true;
        score += GOLD_SCORE;
        took = true;
    }
    if (!took) return;
    if (goldLeft() === 0) exitOpen = true;
    updateHud();
}

function collectAllGoldForTest() {
    for (const g of gold) {
        if (g.taken) continue;
        g.taken = true;
        score += GOLD_SCORE;
    }
    exitOpen = true;
    updateHud();
}

function checkEscape() {
    if (!exitOpen || Math.round(runner.y) !== 0) return false;
    score += LEVEL_SCORE;
    state = 'levelclear';
    timer = CLEAR_PAUSE;
    updateHud();
    showOverlay('LEVEL CLEAR', `Score ${score}`, 'Next vault loading…');
    return true;
}

function nextLevel() {
    level += 1;
    loadLevel(level);
    state = 'running';
    hideOverlay();
}

function killRunner() {
    if (state !== 'running') return;
    lives -= 1;
    state = 'dying';
    timer = DEATH_PAUSE;
    updateHud();
}

function afterDeath() {
    if (lives <= 0) {
        gameOver();
        return;
    }
    loadLevel(level);
    state = 'running';
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        saveBest();
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to play again');
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    loadLevel(1);
    state = 'running';
    clock = 0;
    hideOverlay();
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

// ---------------------------------------------------------------------------
// Simulation tick
// ---------------------------------------------------------------------------
function step(dt) {
    if (state === 'dying') {
        timer -= dt;
        if (timer <= 0) afterDeath();
        return;
    }
    if (state === 'levelclear') {
        timer -= dt;
        if (timer <= 0) nextLevel();
        return;
    }
    if (state !== 'running') return;

    clock += dt;
    updateHoles(dt);
    if (state !== 'running') return;

    updateRunner(dt);
    collectGold();
    if (checkEscape()) return;

    for (const g of guards) updateGuard(g, dt);
    if (caught()) killRunner();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------
function setText(el, value) {
    const text = String(value);
    if (el.textContent !== text) el.textContent = text;
}

function updateHud() {
    setText(elScore, score);
    setText(elLevel, level);
    setText(elGold, goldLeft());
    setText(elLives, Math.max(0, lives));
    setText(elBest, Math.max(best, score));
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
function draw() {
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawTerrain();
    drawHoles();
    drawGold();
    for (const g of guards) drawGuard(g);
    drawRunner();
}

function drawTerrain() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = c * TILE;
            const y = r * TILE;
            const t = grid[r][c];
            if (t === '#') drawStone(x, y);
            else if (t === 'B') drawBrick(x, y);
            else if (t === 'H') drawLadder(x, y, '#8ea6c8');
            else if (t === 'S' && exitOpen) drawLadder(x, y, '#ffcc3d');
            else if (t === '-') drawBar(x, y);
        }
    }
}

function drawStone(x, y) {
    ctx.fillStyle = '#2a3550';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#354268';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#1d2740';
    ctx.fillRect(x, y, TILE, 2);
}

function drawBrick(x, y) {
    ctx.fillStyle = '#7a3f2a';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#945033';
    ctx.fillRect(x + 1, y + 1, TILE - 2, TILE / 2 - 2);
    ctx.fillRect(x + 1, y + TILE / 2 + 1, TILE / 2 - 2, TILE / 2 - 2);
    ctx.fillRect(x + TILE / 2 + 1, y + TILE / 2 + 1, TILE / 2 - 2, TILE / 2 - 2);
}

function drawLadder(x, y, colour) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 4, y);
    ctx.lineTo(x + 4, y + TILE);
    ctx.moveTo(x + TILE - 4, y);
    ctx.lineTo(x + TILE - 4, y + TILE);
    for (let i = 0; i < 2; i++) {
        const ry = y + 5 + i * 9;
        ctx.moveTo(x + 4, ry);
        ctx.lineTo(x + TILE - 4, ry);
    }
    ctx.stroke();
}

function drawBar(x, y) {
    ctx.strokeStyle = '#c8b17a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + 3);
    ctx.lineTo(x + TILE, y + 3);
    ctx.stroke();
}

function drawHoles() {
    for (const h of holes) {
        const left = HOLE_REFILL - h.t;
        if (left > HOLE_WARN) continue;
        // Flash the outline of a hole that is about to heal over.
        const on = Math.floor(left * 8) % 2 === 0;
        ctx.strokeStyle = on ? '#ff6b5a' : '#7a3f2a';
        ctx.lineWidth = 2;
        ctx.strokeRect(h.c * TILE + 1, h.r * TILE + 1, TILE - 2, TILE - 2);
    }
}

function drawGold() {
    for (const g of gold) {
        if (g.taken) continue;
        const x = g.c * TILE;
        const y = g.r * TILE;
        const bob = Math.sin(clock * 3 + g.c) * 1.2;
        ctx.fillStyle = '#ffcc3d';
        ctx.fillRect(x + 4, y + 9 + bob, TILE - 8, 6);
        ctx.fillStyle = '#fff0b0';
        ctx.fillRect(x + 5, y + 10 + bob, TILE - 10, 2);
        ctx.fillStyle = '#c8901f';
        ctx.fillRect(x + 4, y + 14 + bob, TILE - 8, 1);
    }
}

function drawFigure(x, y, body, trim, facing, stride) {
    const cx = x + TILE / 2;
    // legs
    ctx.strokeStyle = body;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, y + 12);
    ctx.lineTo(cx - 3 - stride, y + TILE - 1);
    ctx.moveTo(cx, y + 12);
    ctx.lineTo(cx + 3 + stride, y + TILE - 1);
    ctx.stroke();
    // arms
    ctx.beginPath();
    ctx.moveTo(cx - 5, y + 9 - stride);
    ctx.lineTo(cx + 5, y + 9 + stride);
    ctx.stroke();
    // torso
    ctx.fillStyle = body;
    ctx.fillRect(cx - 3, y + 5, 6, 8);
    // head
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.arc(cx + facing * 0.5, y + 4, 3.2, 0, Math.PI * 2);
    ctx.fill();
}

function drawRunner() {
    const x = runner.x * TILE;
    const y = runner.y * TILE;
    const stride = runner.mode === 'run' ? Math.round(Math.sin(runner.anim) * 2) : 1;
    drawFigure(x, y, '#e6edf7', '#ffcc3d', runner.facing, stride);
}

function drawGuard(g) {
    if (g.state === 'dead') return;
    const x = g.x * TILE;
    let y = g.y * TILE;
    const stride = Math.round(Math.sin(g.anim) * 2);
    ctx.save();
    if (g.state === 'trapped') {
        // Sunk into the hole: only the part inside the pit shows.
        y += 5;
        ctx.beginPath();
        ctx.rect(x - 4, Math.round(g.y) * TILE, TILE + 8, TILE);
        ctx.clip();
    }
    drawFigure(x, y, g.state === 'trapped' ? '#a24a3f' : '#ff6b5a', '#ffd7cf', g.facing, stride);
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function refreshInput() {
    input.x = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    input.y = (held.down ? 1 : 0) - (held.up ? 1 : 0);
}

const MOVE_KEYS = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    a: 'left',
    d: 'right',
    w: 'up',
    s: 'down',
};

window.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const move = MOVE_KEYS[key];
    if (move) {
        held[move] = true;
        refreshInput();
        e.preventDefault();
        return;
    }
    if (key === ' ' || e.code === 'Space' || key === 'Enter') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        return;
    }
    if (key === 'p') {
        togglePause();
        return;
    }
    if (key === 'z' || key === ',') dig(-1);
    else if (key === 'x' || key === '.') dig(1);
});

window.addEventListener('keyup', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const move = MOVE_KEYS[key];
    if (move) {
        held[move] = false;
        refreshInput();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'idle' || state === 'over') startGame();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
let lastFrame = 0;

function frame(ts) {
    const dt = lastFrame ? Math.min((ts - lastFrame) / 1000, 1 / 30) : 0;
    lastFrame = ts;
    if (autoStep && dt > 0) step(dt);
    draw();
    requestAnimationFrame(frame);
}

loadLevel(1);
updateHud();
requestAnimationFrame(frame);
