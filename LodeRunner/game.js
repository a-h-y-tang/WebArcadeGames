// ---------------------------------------------------------------------------
// Lode Runner — a dig-and-climb arcade platformer on an HTML5 canvas.
//
// The runner cannot jump and cannot fight. The only tool is a shovel that
// blasts a hole in the brick floor beside them: guards that stumble in are
// stuck until they climb out, and if the brick knits itself back together
// first, the guard is crushed. Collect every piece of gold and the hidden
// escape ladders light up to the top of the screen.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. Motion is grid-locked and expressed in tiles
// per second, advanced through `step(dt)`, so the tests can simulate frames
// deterministically without depending on requestAnimationFrame wall-clock
// timing.
// ---------------------------------------------------------------------------

// --- Grid ----------------------------------------------------------------
const TILE = 24;
const COLS = 28;
const ROWS = 16;
const CANVAS_W = COLS * TILE; // 672
const CANVAS_H = ROWS * TILE; // 384

const EMPTY = 0;
const BRICK = 1;
const SOLID = 2;
const LADDER = 3;
const ROPE = 4;
const HIDDEN = 5; // escape ladder: empty until the last gold is collected

const CHAR_TILE = {
    '.': EMPTY,
    '#': BRICK,
    '=': SOLID,
    H: LADDER,
    '-': ROPE,
    S: HIDDEN,
    $: EMPTY,
    P: EMPTY,
    G: EMPTY,
};

// --- Levels --------------------------------------------------------------
// `P` runner start, `G` guard start, `$` gold. Every level is COLS x ROWS.
const LEVELS = [
    [
        '............................',
        'S..........................S',
        'S.P.....$...........$......S',
        'S#####H##############H#####S',
        'S.....H..............H.....S',
        'S..$..H.G....------..H..$..S',
        'S##H#########......###H####S',
        'S..H..................H....S',
        'S..H......$........$..H..G.S',
        'S########H#####H###########S',
        'S........H.....H...........S',
        'S....$...H.....H..-------..S',
        'S#######H#######H#.......##S',
        'S.......H.......H..........S',
        'S.$.....H.......H....$.....S',
        '============================',
    ],
    [
        '............................',
        '.............S..............',
        '.P....$......S......$.......',
        '##########H##S##########H###',
        '..........H..S..........H...',
        '...G......H..S...$......H...',
        '#####H#######S#####H########',
        '.....H.......S.....H........',
        '.....H..$....S.----H..$.....',
        '##H##########S#....H########',
        '..H..........S.....H........',
        '..H...$......S.....H....G...',
        '#########H###S########H#####',
        '.........H...S........H.....',
        '...$.....H.G.S..$.....H...$.',
        '============================',
    ],
    [
        '............................',
        '......S..............S......',
        '..$...S......P.......S...$..',
        '#############H##############',
        '.............H..............',
        '....G........H.........G....',
        '###H#####...############H###',
        '...H....................H...',
        '...H.....#$#.....$......H...',
        '###############H############',
        '...............H............',
        '.....$.........H......$.....',
        '#######H############H#######',
        '.......H............H.......',
        '.$.....H.G...$......H.....$.',
        '============================',
    ],
];

// --- Motion --------------------------------------------------------------
const EPS = 1e-6;
const RUN_SPEED = 6.5;    // tiles/s
const CLIMB_SPEED = 5.2;
const FALL_SPEED = 9.5;

const GUARD_BASE = 4.0;
const GUARD_STEP = 0.25;  // per level
const GUARD_CAP = 5.8;

// --- Rules ---------------------------------------------------------------
const HOLE_TIME = 5;      // seconds a dug hole stays open
const TRAP_CLIMB = 3;     // seconds a guard needs to climb back out
const RESPAWN_DELAY = 1.5;
const DEATH_PAUSE = 1.5;
const CLEAR_PAUSE = 2;
const START_LIVES = 3;

const GOLD_POINTS = 250;
const TRAP_POINTS = 75;
const CRUSH_POINTS = 150;
const LEVEL_POINTS = 1500;

// --- Colours -------------------------------------------------------------
const COLOR_BRICK = '#8c4a2f';
const COLOR_BRICK_TOP = '#b3623d';
const COLOR_MORTAR = '#2a1710';
const COLOR_SOLID = '#4a5468';
const COLOR_LADDER = '#c9a227';
const COLOR_ROPE = '#9a7b4f';
const COLOR_GOLD = '#f5d033';
const COLOR_RUNNER = '#5ad1f5';
const COLOR_GUARD = '#e2574c';

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const goldEl = document.getElementById('gold');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'dying' | 'levelclear' | 'over'
let state = 'idle';
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let timer = 0;
let grid = [];
let golds = [];
let holes = [];
let guards = [];
let goldRemaining = 0;
let revealed = false;
let startCell = { c: 0, r: 0 };
let guardsEnabled = true; // test hook: switch guard behaviour off

const player = { x: 0, y: 0, vx: 0, vy: 0, facing: 1, falling: false, dir: { x: 0, y: 0 } };

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

function inBounds(c, r) {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS;
}

// The tile as the game sees it: hidden ladders read as empty until revealed.
function tileAt(c, r) {
    if (!inBounds(c, r)) return SOLID;
    const t = grid[r][c];
    if (t === HIDDEN) return revealed ? LADDER : EMPTY;
    return t;
}

function passable(c, r) {
    const t = tileAt(c, r);
    return t !== BRICK && t !== SOLID;
}

function firmBelow(c, r) {
    const t = tileAt(c, r + 1);
    return t === BRICK || t === SOLID || t === LADDER;
}

function holeAt(c, r) {
    return holes.some((h) => h.c === c && h.r === r);
}

function goldIndexAt(c, r) {
    return golds.findIndex((g) => g.c === c && g.r === r);
}

// ---------------------------------------------------------------------------
// Level loading
// ---------------------------------------------------------------------------

function loadLevel(index) {
    const rows = LEVELS[index % LEVELS.length];
    grid = rows.map((row) => row.split('').map((ch) => CHAR_TILE[ch]));
    golds = [];
    holes = [];
    guards = [];
    revealed = false;

    rows.forEach((row, r) => {
        row.split('').forEach((ch, c) => {
            if (ch === '$') golds.push({ c, r });
            if (ch === 'P') startCell = { c, r };
            if (ch === 'G') guards.push(makeGuard(c, r));
        });
    });

    resetPlayer();
    syncGold();
    updateHud();
}

function makeGuard(c, r) {
    return {
        x: c,
        y: r,
        vx: 0,
        vy: 0,
        facing: 1,
        falling: false,
        gold: false,
        trapped: 0,
        dead: 0,
        spawn: { c, r },
    };
}

function resetPlayer() {
    player.x = startCell.c;
    player.y = startCell.r;
    player.vx = 0;
    player.vy = 0;
    player.facing = 1;
    player.falling = false;
}

function syncGold() {
    goldRemaining = golds.length + guards.filter((g) => g.gold).length;
    if (goldRemaining === 0) revealed = true;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

// Advance one axis, stopping exactly on the next cell boundary so that every
// support / blocking decision is taken on the grid.
function moveAxis(a, axis, dir, dist) {
    const from = a[axis];
    const limit = dir > 0 ? Math.floor(from + 1e-9) + 1 : Math.ceil(from - 1e-9) - 1;
    let to = from + dir * dist;
    if (dir > 0 ? to > limit : to < limit) to = limit;
    a[axis] = to;
}

function supported(a) {
    const c = Math.round(a.x);
    const r = Math.round(a.y);
    if (Math.abs(a.y - r) > EPS) return false;
    if (tileAt(c, r) === LADDER) return true;
    if (tileAt(c, r) === ROPE && !a.falling) return true;
    return firmBelow(c, r);
}

function canClimbUp(c, r) {
    return tileAt(c, r) === LADDER && passable(c, r - 1);
}

function canGoDown(c, r) {
    return passable(c, r + 1);
}

function updateActor(a, want, dt, sp) {
    const c = Math.round(a.x);
    const r = Math.round(a.y);
    const alignedX = Math.abs(a.x - c) < EPS;
    const alignedY = Math.abs(a.y - r) < EPS;

    if (!alignedY) {
        moveAxis(a, 'y', a.vy || 1, (a.falling ? sp.fall : sp.climb) * dt);
        return;
    }
    if (!alignedX) {
        if (want.x !== 0 && want.x !== a.vx) a.vx = want.x;
        moveAxis(a, 'x', a.vx || 1, sp.run * dt);
        return;
    }

    a.x = c;
    a.y = r;

    if (!supported(a)) {
        a.falling = true;
        a.vy = 1;
        a.vx = 0;
        moveAxis(a, 'y', 1, sp.fall * dt);
        return;
    }
    a.falling = false;

    if (want.y < 0 && canClimbUp(c, r)) {
        a.vy = -1;
        moveAxis(a, 'y', -1, sp.climb * dt);
        return;
    }
    if (want.y > 0 && canGoDown(c, r)) {
        a.vy = 1;
        moveAxis(a, 'y', 1, sp.climb * dt);
        return;
    }
    if (want.x !== 0 && passable(c + want.x, r)) {
        a.vx = want.x;
        a.facing = want.x;
        moveAxis(a, 'x', want.x, sp.run * dt);
    }
}

const PLAYER_SPEEDS = { run: RUN_SPEED, climb: CLIMB_SPEED, fall: FALL_SPEED };

function guardSpeeds() {
    const run = Math.min(GUARD_BASE + (level - 1) * GUARD_STEP, GUARD_CAP);
    return { run, climb: run * 0.85, fall: FALL_SPEED };
}

// ---------------------------------------------------------------------------
// Movement graph — shared by the guards' pathfinding and the level checks
// ---------------------------------------------------------------------------

function neighbors(c, r) {
    const out = [];
    const standing = tileAt(c, r) === LADDER || tileAt(c, r) === ROPE || firmBelow(c, r);
    if (standing) {
        if (passable(c - 1, r)) out.push({ c: c - 1, r });
        if (passable(c + 1, r)) out.push({ c: c + 1, r });
        if (canClimbUp(c, r)) out.push({ c, r: r - 1 });
        if (canGoDown(c, r)) out.push({ c, r: r + 1 });
    } else if (canGoDown(c, r)) {
        out.push({ c, r: r + 1 });
    }
    return out;
}

// Every cell an actor can get to from (c, r) without digging.
function reachableFrom(c, r) {
    const seen = new Set([`${c},${r}`]);
    const queue = [{ c, r }];
    while (queue.length) {
        const cur = queue.shift();
        for (const n of neighbors(cur.c, cur.r)) {
            const key = `${n.c},${n.r}`;
            if (seen.has(key)) continue;
            seen.add(key);
            queue.push(n);
        }
    }
    return seen;
}

// First step of a shortest path from (c, r) to (tc, tr), or null.
function firstStepTowards(c, r, tc, tr) {
    if (c === tc && r === tr) return null;
    const parents = new Map([[`${c},${r}`, null]]);
    const queue = [{ c, r }];
    while (queue.length) {
        const cur = queue.shift();
        for (const n of neighbors(cur.c, cur.r)) {
            const key = `${n.c},${n.r}`;
            if (parents.has(key)) continue;
            parents.set(key, cur);
            if (n.c === tc && n.r === tr) {
                let node = n;
                let parent = parents.get(`${node.c},${node.r}`);
                while (parent && !(parent.c === c && parent.r === r)) {
                    node = parent;
                    parent = parents.get(`${node.c},${node.r}`);
                }
                return node;
            }
            queue.push(n);
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Digging
// ---------------------------------------------------------------------------

function dig(dir) {
    if (state !== 'running') return false;
    const c = Math.round(player.x);
    const r = Math.round(player.y);
    if (Math.abs(player.x - c) > EPS || Math.abs(player.y - r) > EPS) return false;
    if (player.falling) return false;
    if (tileAt(c, r) === LADDER || tileAt(c, r) === ROPE) return false;
    if (!firmBelow(c, r)) return false;

    const tc = c + dir;
    const tr = r + 1;
    if (tileAt(tc, tr) !== BRICK) return false;
    if (tileAt(tc, r) !== EMPTY) return false;
    if (goldIndexAt(tc, tr) >= 0) return false;

    grid[tr][tc] = EMPTY;
    holes.push({ c: tc, r: tr, timer: HOLE_TIME });
    player.facing = dir;
    return true;
}

function updateHoles(dt) {
    for (let i = holes.length - 1; i >= 0; i--) {
        const hole = holes[i];
        hole.timer -= dt;
        if (hole.timer > 0) continue;

        grid[hole.r][hole.c] = BRICK;
        holes.splice(i, 1);

        for (const g of guards) {
            if (g.dead > 0) continue;
            if (Math.round(g.x) === hole.c && Math.round(g.y) === hole.r) crushGuard(g);
        }
        if (Math.round(player.x) === hole.c && Math.round(player.y) === hole.r) killPlayer();
    }
}

// ---------------------------------------------------------------------------
// Gold
// ---------------------------------------------------------------------------

function collect(a, isPlayer) {
    const index = goldIndexAt(Math.round(a.x), Math.round(a.y));
    if (index < 0) return;
    if (isPlayer) {
        golds.splice(index, 1);
        score += GOLD_POINTS;
    } else if (!a.gold) {
        golds.splice(index, 1);
        a.gold = true;
    }
}

// Put a piece of gold back on the board, as close to (c, r) as possible.
function dropGold(c, r) {
    const spots = [{ c, r }, { c, r: r + 1 }, { c: c - 1, r }, { c: c + 1, r }];
    for (const spot of spots) {
        if (!inBounds(spot.c, spot.r)) continue;
        if (tileAt(spot.c, spot.r) !== EMPTY) continue;
        if (goldIndexAt(spot.c, spot.r) >= 0) continue;
        golds.push(spot);
        return;
    }
    golds.push({ c, r });
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function trapGuard(g, c, r) {
    g.trapped = TRAP_CLIMB;
    g.falling = false;
    g.vx = 0;
    g.vy = 0;
    g.x = c;
    g.y = r;
    score += TRAP_POINTS;
    if (g.gold) {
        g.gold = false;
        dropGold(c, r - 1);
    }
}

// A guard hauls itself out over the lip of the hole, onto whichever side has
// firm ground — climbing straight up would only drop it back in.
function climbOut(g) {
    const c = Math.round(g.x);
    const r = Math.round(g.y);
    if (!passable(c, r - 1)) {
        g.trapped = 0.5; // lip blocked — try again shortly
        return;
    }
    const toward = player.x >= g.x ? 1 : -1;
    for (const dir of [toward, -toward]) {
        const nc = c + dir;
        const nr = r - 1;
        if (!passable(nc, nr)) continue;
        const solidGround = tileAt(nc, nr) === LADDER || tileAt(nc, nr) === ROPE || firmBelow(nc, nr);
        if (!solidGround) continue;
        g.trapped = 0;
        g.x = nc;
        g.y = nr;
        g.vx = 0;
        g.vy = 0;
        g.falling = false;
        return;
    }
    g.trapped = 0;
    g.y = r - 1;
    g.falling = false;
}

function crushGuard(g) {
    if (g.gold) {
        g.gold = false;
        dropGold(Math.round(g.x), Math.round(g.y) - 1);
    }
    g.trapped = 0;
    g.dead = RESPAWN_DELAY;
    score += CRUSH_POINTS;
}

function respawnGuard(g) {
    g.dead = 0;
    g.x = g.spawn.c;
    g.y = g.spawn.r;
    g.vx = 0;
    g.vy = 0;
    g.falling = false;
}

function guardWant(g, c, r) {
    const target = firstStepTowards(c, r, Math.round(player.x), Math.round(player.y));
    if (target) return { x: Math.sign(target.c - c), y: Math.sign(target.r - r) };
    return { x: Math.sign(player.x - g.x), y: 0 };
}

function updateGuard(g, dt, sp) {
    if (g.dead > 0) {
        g.dead -= dt;
        if (g.dead <= 0) respawnGuard(g);
        return;
    }
    if (g.trapped > 0) {
        g.trapped -= dt;
        if (g.trapped <= 0) climbOut(g);
        return;
    }

    const c = Math.round(g.x);
    const r = Math.round(g.y);
    const aligned = Math.abs(g.x - c) < EPS && Math.abs(g.y - r) < EPS;
    if (aligned && holeAt(c, r)) {
        trapGuard(g, c, r);
        return;
    }

    updateActor(g, aligned ? guardWant(g, c, r) : { x: 0, y: 0 }, dt, sp);
    collect(g, false);
}

function guardHitsPlayer() {
    for (const g of guards) {
        if (g.dead > 0 || g.trapped > 0) continue;
        if (Math.abs(g.x - player.x) < 0.7 && Math.abs(g.y - player.y) < 0.7) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Run structure
// ---------------------------------------------------------------------------

function killPlayer() {
    if (state !== 'running') return;
    lives -= 1;
    state = 'dying';
    timer = DEATH_PAUSE;
    updateHud();
}

function clearLevel() {
    score += LEVEL_POINTS;
    state = 'levelclear';
    timer = CLEAR_PAUSE;
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('loderunner-best', String(best));
        } catch (err) {
            /* private mode — keep the score in memory only */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to play again');
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    timer = 0;
    loadLevel(0);
    state = 'running';
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
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    syncGold();

    if (state === 'running') {
        updateHoles(dt);
        updateActor(player, player.dir, dt, PLAYER_SPEEDS);
        collect(player, true);
        if (guardsEnabled) {
            const sp = guardSpeeds();
            for (const g of guards) updateGuard(g, dt, sp);
        }
        syncGold();
        if (state === 'running' && guardsEnabled && guardHitsPlayer()) killPlayer();
        if (state === 'running' && revealed && Math.round(player.y) === 0) clearLevel();
    } else if (state === 'dying') {
        timer -= dt;
        if (timer <= 0) {
            if (lives <= 0) gameOver();
            else {
                loadLevel((level - 1) % LEVELS.length);
                state = 'running';
            }
        }
    } else if (state === 'levelclear') {
        timer -= dt;
        if (timer <= 0) {
            level += 1;
            loadLevel((level - 1) % LEVELS.length);
            state = 'running';
        }
    }

    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawBrick(x, y) {
    ctx.fillStyle = COLOR_BRICK;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = COLOR_BRICK_TOP;
    ctx.fillRect(x, y, TILE, 3);
    ctx.strokeStyle = COLOR_MORTAR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + TILE / 2);
    ctx.lineTo(x + TILE, y + TILE / 2);
    ctx.moveTo(x + TILE / 2, y);
    ctx.lineTo(x + TILE / 2, y + TILE / 2);
    ctx.moveTo(x, y + TILE / 2);
    ctx.lineTo(x, y + TILE);
    ctx.stroke();
}

function drawSolid(x, y) {
    ctx.fillStyle = COLOR_SOLID;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x, y, TILE, 4);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
}

function drawLadder(x, y, faint) {
    ctx.strokeStyle = faint ? 'rgba(201, 162, 39, 0.35)' : COLOR_LADDER;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 5, y);
    ctx.lineTo(x + 5, y + TILE);
    ctx.moveTo(x + TILE - 5, y);
    ctx.lineTo(x + TILE - 5, y + TILE);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 1; i <= 2; i++) {
        const ry = y + (TILE / 3) * i;
        ctx.moveTo(x + 5, ry);
        ctx.lineTo(x + TILE - 5, ry);
    }
    ctx.stroke();
}

function drawRope(x, y) {
    ctx.strokeStyle = COLOR_ROPE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + 5);
    ctx.lineTo(x + TILE, y + 5);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
        const rx = x + 4 + i * 8;
        ctx.moveTo(rx, y + 5);
        ctx.lineTo(rx, y + 10);
    }
    ctx.stroke();
}

function drawGold(x, y) {
    const cx = x + TILE / 2;
    const cy = y + TILE / 2 + 2;
    ctx.fillStyle = COLOR_GOLD;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.ellipse(cx - 2, cy - 2, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawFigure(a, color) {
    const x = a.x * TILE;
    const y = a.y * TILE;
    const cx = x + TILE / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, y + 7, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 4, y + 11, 8, 8);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (a.falling) {
        ctx.moveTo(cx - 7, y + 10);
        ctx.lineTo(cx, y + 13);
        ctx.lineTo(cx + 7, y + 10);
        ctx.moveTo(cx - 4, y + 24);
        ctx.lineTo(cx, y + 19);
        ctx.lineTo(cx + 4, y + 24);
    } else {
        ctx.moveTo(cx - 6, y + 16);
        ctx.lineTo(cx + 6, y + 16);
        ctx.moveTo(cx - 5, y + 24);
        ctx.lineTo(cx, y + 19);
        ctx.lineTo(cx + 5, y + 24);
    }
    ctx.stroke();
    if (a.gold) {
        ctx.fillStyle = COLOR_GOLD;
        ctx.beginPath();
        ctx.arc(cx + (a.facing >= 0 ? 8 : -8), y + 15, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBanner(text, sub) {
    ctx.fillStyle = 'rgba(5, 7, 13, 0.7)';
    ctx.fillRect(0, CANVAS_H / 2 - 46, CANVAS_W, 92);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR_GOLD;
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2 + 2);
    if (sub) {
        ctx.fillStyle = '#dfe8f7';
        ctx.font = '15px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(sub, CANVAS_W / 2, CANVAS_H / 2 + 28);
    }
    ctx.textAlign = 'start';
}

function draw() {
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = c * TILE;
            const y = r * TILE;
            const raw = grid[r][c];
            if (raw === BRICK) drawBrick(x, y);
            else if (raw === SOLID) drawSolid(x, y);
            else if (raw === LADDER) drawLadder(x, y, false);
            else if (raw === ROPE) drawRope(x, y);
            else if (raw === HIDDEN && revealed) drawLadder(x, y, false);
        }
    }

    for (const g of golds) drawGold(g.c * TILE, g.r * TILE);
    for (const g of guards) {
        if (g.dead > 0) continue;
        drawFigure(g, COLOR_GUARD);
    }
    drawFigure(player, COLOR_RUNNER);

    if (state === 'dying') drawBanner('CAUGHT!', `${lives} ${lives === 1 ? 'life' : 'lives'} left`);
    if (state === 'levelclear') drawBanner('ESCAPED!', `Level ${level} cleared`);
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    goldEl.textContent = String(goldRemaining);
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
    player.dir.x = (held(RIGHT_KEYS) ? 1 : 0) - (held(LEFT_KEYS) ? 1 : 0);
    player.dir.y = (held(DOWN_KEYS) ? 1 : 0) - (held(UP_KEYS) ? 1 : 0);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
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
    if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        if (state === 'paused') togglePause();
        else if (state === 'idle' || state === 'over') startGame();
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
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('loderunner-best') || '0', 10) || 0;
loadLevel(0);
state = 'idle';
updateHud();
showOverlay('LODE RUNNER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
