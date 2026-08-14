// ---------------------------------------------------------------------------
// Gold Runner — a ladder-and-rope vault raid on an HTML5 canvas.
//
// Collect every bar of gold, then climb the escape ladders that appear at the
// top of the vault. You cannot jump and you cannot fight: the only tool is a
// drill that bores a hole in the brick diagonally in front of you. Guards that
// walk into a hole are stuck, and are crushed if the brick knits back together
// while they are still inside.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
//
// Entities move cell-to-cell: they are either resting exactly on a grid cell or
// in transit along one axis to a neighbouring cell. Every rule — support,
// blocking, gold pickup, digging — is evaluated only on whole cells, which keeps
// the physics decidable.
// ---------------------------------------------------------------------------

// --- Grid ----------------------------------------------------------------
const TILE = 30;
const COLS = 24;
const ROWS = 14;
const CANVAS_W = COLS * TILE;   // 720
const CANVAS_H = ROWS * TILE;   // 420

// Tiles: '.' empty  '#' brick (diggable)  '@' stone (solid)  'H' ladder
//        '-' rope   'S' escape ladder     '$' gold
//        'P' player start  'G' guard start (both parsed out of the grid)
const LEVELS = [
    [
        '..S..................S..',
        '..S..................S..',
        '..S..................S..',
        '..S.$..H...P....H..$.S..',
        '#######H#####...H#######',
        '.......H.------.H.......',
        '.$.H...H....G...H...H.$.',
        '###H#######..#######H###',
        '...H....--------....H...',
        '...H..$..H....H..$..H...',
        '#########H####H#########',
        '.........H....H.........',
        '..$.G....H....H.....$.$.',
        '@@@@@@@@@@@@@@@@@@@@@@@@',
    ],
    [
        '...........S............',
        '...........S............',
        '...........S............',
        '..H.....$..S.P.$.....H..',
        '##H########..########H##',
        '..H.....--------.....H..',
        '.$H..G.H.....$..H....H$.',
        '#######H##..####H#######',
        '..-----H........H-----..',
        '...$.H.H......G.H.H.$...',
        '#####H######..####H#####',
        '.....H..--------..H.....',
        '.....H$....$.....$H.G...',
        '@@@@@@@@@@@@@@@@@@@@@@@@',
    ],
    [
        '............S...........',
        '............S...........',
        '............S...........',
        '..H.$......$S.P.....H.$.',
        '##H####..###########H###',
        '..H.....-------.....H...',
        '.$H..H..G$...$.....HH...',
        '#####H#########..##H####',
        '.....H..---------..H....',
        '.....H.$.H..G$...$.H.H..',
        '####..###H###########H##',
        '...------H....------.H..',
        '...$..G..H..$...G...$H..',
        '@@@@@@@@@@@@@@@@@@@@@@@@',
    ],
];

// --- Speeds (tiles per second) -------------------------------------------
const RUN_SPEED = 6.2;
const CLIMB_SPEED = 5.2;
const ROPE_SPEED = 5.6;
const FALL_SPEED = 9.5;
const GUARD_BASE = 3.6;
const GUARD_STEP = 0.18;
const GUARD_CAP = RUN_SPEED - 0.6;
const GUARD_CLIMB_OUT = 4.0;

// --- Digging -------------------------------------------------------------
const HOLE_TIME = 5.0;      // how long a hole stays open
const HOLE_WARN = 1.2;      // the tail of that time is drawn as "closing"
const DIG_COOLDOWN = 0.3;
const GUARD_TRAP_TIME = 3.2;
const GUARD_RESPAWN = 1.5;

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const GOLD_POINTS = 250;
const CRUSH_POINTS = 75;
const LEVEL_BONUS = 1500;
const DEATH_PAUSE = 1.2;
const CLEAR_PAUSE = 1.6;
const TOUCH_DIST = 0.55;
const EPS = 1e-6;

// --- DOM -----------------------------------------------------------------
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

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'dying' | 'levelclear' | 'over'
let state = 'idle';
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let goldLeft = 0;

let grid = [];
let holes = [];
let guards = [];
let player = null;
let playerStart = { c: 0, r: 0 };
let deathTimer = 0;
let clearTimer = 0;
let animTime = 0;

const keys = { left: false, right: false, up: false, down: false };

// Set to false by the specs so that step() is driven entirely by the test.
let autoStep = true;

// Lets reachableCells() ask "what would be reachable if the escape ladders
// were armed?" without having to empty the level of gold first.
let escapeOverride = null;

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

const inBounds = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

function tileAt(c, r) {
    return inBounds(c, r) ? grid[r][c] : '@';
}

function isBlocking(c, r) {
    const t = tileAt(c, r);
    return t === '#' || t === '@';
}

function escapeActive() {
    return goldLeft === 0;
}

function isLadder(c, r) {
    const t = tileAt(c, r);
    if (t === 'H') return true;
    if (t !== 'S') return false;
    return escapeOverride === null ? escapeActive() : escapeOverride;
}

function isRope(c, r) {
    return tileAt(c, r) === '-';
}

// An entity resting on (c, r) keeps its footing when it is on a ladder or a
// rope, when the tile below is solid, when it is standing on the top of a
// ladder, or when it is on the bottom row.
function isSupported(c, r) {
    if (isLadder(c, r) || isRope(c, r)) return true;
    if (r + 1 >= ROWS) return true;
    return isBlocking(c, r + 1) || isLadder(c, r + 1);
}

function holeAt(c, r) {
    return holes.find((h) => h.c === c && h.r === r) || null;
}

// ---------------------------------------------------------------------------
// Level loading
// ---------------------------------------------------------------------------

function loadLevel(n) {
    const layout = LEVELS[(n - 1) % LEVELS.length];
    grid = layout.map((row) => [...row]);
    guards = [];
    holes = [];
    goldLeft = 0;

    const spawns = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const ch = grid[r][c];
            if (ch === 'P') {
                playerStart = { c, r };
                grid[r][c] = '.';
            } else if (ch === 'G') {
                spawns.push({ c, r });
                grid[r][c] = '.';
            } else if (ch === '$') {
                goldLeft++;
            }
        }
    }

    player = makeEntity(playerStart.c, playerStart.r, false);
    for (const s of spawns) spawnGuard(s.c, s.r);
    resetKeys();
    updateHud();
}

function makeEntity(c, r, isGuard) {
    return {
        x: c,
        y: r,
        facing: 1,
        move: null,
        falling: false,
        digCooldown: 0,
        isGuard: !!isGuard,
    };
}

function spawnGuard(c, r) {
    const g = makeEntity(c, r, true);
    g.spawn = { c, r };
    g.state = 'active';
    g.timer = 0;
    guards.push(g);
    return g;
}

function placePlayer(c, r) {
    player.x = c;
    player.y = r;
    player.move = null;
    player.falling = false;
}

function resetKeys() {
    keys.left = keys.right = keys.up = keys.down = false;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function guardSpeed() {
    return Math.min(GUARD_CAP, GUARD_BASE + (level - 1) * GUARD_STEP);
}

function moveSpeed(e, kind) {
    if (kind === 'fall') return FALL_SPEED;
    if (e.isGuard) {
        const s = guardSpeed();
        return kind === 'climb' ? s * 0.9 : s;
    }
    if (kind === 'climb') return CLIMB_SPEED;
    if (kind === 'rope') return ROPE_SPEED;
    return RUN_SPEED;
}

// Queues a one-cell move if the rules allow it. Horizontal moves need footing,
// upward moves need a ladder to climb into, downward moves just need somewhere
// to go.
function startMove(e, dx, dy) {
    const c = Math.round(e.x);
    const r = Math.round(e.y);
    const tc = c + dx;
    const tr = r + dy;
    if (!inBounds(tc, tr) || isBlocking(tc, tr)) return false;

    if (dx !== 0) {
        if (!isSupported(c, r)) return false;
        e.move = { dx, dy: 0, tx: tc, ty: r, speed: moveSpeed(e, isRope(c, r) ? 'rope' : 'run') };
        return true;
    }
    if (dy < 0) {
        if (!isLadder(tc, tr)) return false;
        e.move = { dx: 0, dy: -1, tx: c, ty: tr, speed: moveSpeed(e, 'climb') };
        return true;
    }
    e.move = {
        dx: 0,
        dy: 1,
        tx: c,
        ty: tr,
        speed: moveSpeed(e, isLadder(tc, tr) ? 'climb' : 'fall'),
    };
    return true;
}

// Reversing mid-stride keeps the controls from feeling sticky: the target
// simply becomes the cell the entity just left.
function maybeReverse(e, dx) {
    const m = e.move;
    if (!m || m.dy !== 0 || m.dx === dx || e.falling) return;
    m.tx -= m.dx;
    m.dx = -m.dx;
}

function advanceEntity(e, dt, decide) {
    let budget = dt;
    let spins = 0;
    while (budget > EPS && spins++ < 32) {
        if (!e.move) {
            const c = Math.round(e.x);
            const r = Math.round(e.y);
            if (!isSupported(c, r)) {
                e.falling = true;
                if (!startMove(e, 0, 1)) {
                    e.falling = false;
                    break;
                }
                e.move.speed = FALL_SPEED;
            } else {
                e.falling = false;
                if (!decide(e)) break;
            }
        }
        const m = e.move;
        const left = m.dx !== 0 ? Math.abs(m.tx - e.x) : Math.abs(m.ty - e.y);
        const dist = m.speed * budget;
        if (dist < left - EPS) {
            e.x += m.dx * dist;
            e.y += m.dy * dist;
            budget = 0;
        } else {
            e.x = m.tx;
            e.y = m.ty;
            e.move = null;
            budget -= left / m.speed;
            onArrive(e);
            // Arriving can take an entity out of play (a guard dropping into a
            // hole), and it must not keep sliding on the rest of the frame.
            if (e.isGuard && e.state !== 'active') break;
        }
    }
}

function onArrive(e) {
    const c = Math.round(e.x);
    const r = Math.round(e.y);
    if (e.isGuard) {
        // A hole is a trap for guards only; the player drops straight through.
        if (e.state === 'active' && holeAt(c, r)) trapGuard(e);
        return;
    }
    if (grid[r][c] === '$') {
        grid[r][c] = '.';
        goldLeft--;
        score += GOLD_POINTS;
        updateHud();
    }
}

function playerDecide(e) {
    if (keys.up && startMove(e, 0, -1)) return true;
    if (keys.down && startMove(e, 0, 1)) return true;
    if (keys.left) {
        e.facing = -1;
        if (startMove(e, -1, 0)) return true;
    }
    if (keys.right) {
        e.facing = 1;
        if (startMove(e, 1, 0)) return true;
    }
    return false;
}

function updatePlayer(dt) {
    if (keys.left) maybeReverse(player, -1);
    else if (keys.right) maybeReverse(player, 1);
    advanceEntity(player, dt, playerDecide);
    if (player.digCooldown > 0) player.digCooldown -= dt;
}

// ---------------------------------------------------------------------------
// Digging
// ---------------------------------------------------------------------------

// Digging works off the cell the player is nearest to rather than requiring a
// dead stop: moves chain while a direction key is held, so a rest-only rule
// would mean letting go of the controls before every dig.
function dig(dir) {
    if (state !== 'running') return false;
    if (player.falling) return false;
    if (player.digCooldown > 0) return false;

    const c = Math.round(player.x);
    const r = Math.round(player.y);
    if (isLadder(c, r) || isRope(c, r)) return false;
    if (!isSupported(c, r)) return false;

    const tc = c + dir;
    const tr = r + 1;
    if (!inBounds(tc, tr)) return false;
    if (grid[tr][tc] !== '#') return false;
    if (isBlocking(tc, r)) return false;

    grid[tr][tc] = '.';
    holes.push({ c: tc, r: tr, t: HOLE_TIME });
    player.facing = dir;
    player.digCooldown = DIG_COOLDOWN;
    return true;
}

function updateHoles(dt) {
    for (let i = holes.length - 1; i >= 0; i--) {
        const h = holes[i];
        h.t -= dt;
        if (h.t > 0) continue;
        grid[h.r][h.c] = '#';
        holes.splice(i, 1);
        for (const g of guards) {
            if (g.state === 'dead') continue;
            if (Math.round(g.x) === h.c && Math.round(g.y) === h.r) crushGuard(g);
        }
        if (state === 'running' && Math.round(player.x) === h.c && Math.round(player.y) === h.r) {
            killPlayer();
        }
    }
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function trapGuard(g) {
    g.state = 'trapped';
    g.timer = GUARD_TRAP_TIME;
    g.move = null;
    g.x = Math.round(g.x);
    g.y = Math.round(g.y);
    g.falling = false;
}

function crushGuard(g) {
    g.state = 'dead';
    g.timer = GUARD_RESPAWN;
    g.move = null;
    score += CRUSH_POINTS;
    updateHud();
}

// The cells an entity can step to from (c, r), using the same rules as
// startMove(). Unsupported cells only ever lead downwards.
function neighbors(c, r) {
    const out = [];
    if (!isSupported(c, r)) {
        if (r + 1 < ROWS && !isBlocking(c, r + 1)) out.push([c, r + 1]);
        return out;
    }
    if (c > 0 && !isBlocking(c - 1, r)) out.push([c - 1, r]);
    if (c < COLS - 1 && !isBlocking(c + 1, r)) out.push([c + 1, r]);
    if (r > 0 && isLadder(c, r - 1)) out.push([c, r - 1]);
    if (r + 1 < ROWS && !isBlocking(c, r + 1)) out.push([c, r + 1]);
    return out;
}

// Breadth-first search over the movement graph; returns the first cell to walk
// to, or null when the player cannot be reached at all.
function bfsStep(sc, sr, tc, tr) {
    if (sc === tc && sr === tr) return null;
    const from = new Map();
    const key = (c, r) => c + ',' + r;
    const queue = [[sc, sr]];
    from.set(key(sc, sr), null);
    let found = false;
    while (queue.length && !found) {
        const [c, r] = queue.shift();
        for (const [nc, nr] of neighbors(c, r)) {
            const k = key(nc, nr);
            if (from.has(k)) continue;
            from.set(k, [c, r]);
            if (nc === tc && nr === tr) {
                found = true;
                break;
            }
            queue.push([nc, nr]);
        }
    }
    if (!found) return null;
    let cur = [tc, tr];
    while (true) {
        const prev = from.get(key(cur[0], cur[1]));
        if (!prev) return null;
        if (prev[0] === sc && prev[1] === sr) return cur;
        cur = prev;
    }
}

function guardDecide(g) {
    const c = Math.round(g.x);
    const r = Math.round(g.y);
    const pc = Math.round(player.x);
    const pr = Math.round(player.y);

    const next = bfsStep(c, r, pc, pr);
    if (next) {
        g.facing = Math.sign(next[0] - c) || g.facing;
        if (startMove(g, next[0] - c, next[1] - r)) return true;
    }

    // No route: shuffle towards the player anyway, which is what walks guards
    // into freshly dug holes.
    if (pr < r && startMove(g, 0, -1)) return true;
    const dx = Math.sign(pc - c);
    if (dx) {
        g.facing = dx;
        if (startMove(g, dx, 0)) return true;
    }
    if (pr > r && startMove(g, 0, 1)) return true;
    return false;
}

function updateGuards(dt) {
    for (const g of guards) {
        if (g.state === 'dead') {
            g.timer -= dt;
            if (g.timer <= 0) {
                g.x = g.spawn.c;
                g.y = g.spawn.r;
                g.move = null;
                g.falling = false;
                g.state = 'active';
            }
            continue;
        }
        if (g.state === 'trapped') {
            g.timer -= dt;
            if (g.timer <= 0) {
                g.state = 'climbing';
                g.climbTo = Math.round(g.y) - 1;
            }
            continue;
        }
        if (g.state === 'climbing') {
            g.y -= GUARD_CLIMB_OUT * dt;
            if (g.y <= g.climbTo) {
                g.y = Math.max(0, g.climbTo);
                g.state = 'active';
                g.move = null;
                g.falling = false;
            }
            continue;
        }
        advanceEntity(g, dt, guardDecide);
    }
}

function guardTouchingPlayer() {
    return guards.some(
        (g) =>
            g.state === 'active' &&
            Math.abs(g.x - player.x) < TOUCH_DIST &&
            Math.abs(g.y - player.y) < TOUCH_DIST
    );
}

// ---------------------------------------------------------------------------
// Reachability — used by the specs to prove every level stays winnable
// ---------------------------------------------------------------------------

function reachableCells(escapeOn) {
    const prev = escapeOverride;
    escapeOverride = escapeOn === undefined ? null : !!escapeOn;
    const seen = new Set([`${playerStart.c},${playerStart.r}`]);
    const queue = [[playerStart.c, playerStart.r]];
    while (queue.length) {
        const [c, r] = queue.shift();
        for (const [nc, nr] of neighbors(c, r)) {
            const k = `${nc},${nr}`;
            if (seen.has(k)) continue;
            seen.add(k);
            queue.push([nc, nr]);
        }
    }
    escapeOverride = prev;
    return seen;
}

// ---------------------------------------------------------------------------
// Run flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    loadLevel(level);
    deathTimer = 0;
    clearTimer = 0;
    state = 'running';
    hideOverlay();
    updateHud();
}

function killPlayer() {
    if (state !== 'running') return;
    lives--;
    state = 'dying';
    deathTimer = DEATH_PAUSE;
    updateHud();
}

function clearLevel() {
    state = 'levelclear';
    clearTimer = CLEAR_PAUSE;
    score += LEVEL_BONUS;
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('goldrunner-best', String(best));
        } catch (err) {
            /* private mode — the run just is not remembered */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space or Enter to play again');
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
    animTime += dt;

    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) {
            if (lives <= 0) gameOver();
            else {
                loadLevel(level);
                state = 'running';
            }
        }
        return;
    }

    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) {
            level++;
            loadLevel(level);
            state = 'running';
        }
        return;
    }

    if (state !== 'running') return;

    updatePlayer(dt);
    updateGuards(dt);
    updateHoles(dt);

    if (state !== 'running') return;
    if (guardTouchingPlayer()) {
        killPlayer();
        return;
    }
    if (goldLeft === 0 && Math.round(player.y) === 0) clearLevel();
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

function collectAllGoldForTest() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) if (grid[r][c] === '$') grid[r][c] = '.';
    }
    goldLeft = 0;
    updateHud();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = score;
    goldEl.textContent = goldLeft;
    levelEl.textContent = level;
    livesEl.textContent = Math.max(0, lives);
    bestEl.textContent = best;
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawBrick(x, y, closing) {
    ctx.fillStyle = closing ? '#a4643a' : '#7a4327';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x, y + TILE / 2 - 1, TILE, 2);
    ctx.fillRect(x, y + TILE - 2, TILE, 2);
    ctx.fillRect(x + TILE / 2 - 1, y, 2, TILE / 2);
    ctx.fillRect(x + TILE / 4 - 1, y + TILE / 2, 2, TILE / 2);
    ctx.fillRect(x + (3 * TILE) / 4 - 1, y + TILE / 2, 2, TILE / 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fillRect(x, y, TILE, 2);
}

function drawStone(x, y) {
    ctx.fillStyle = '#39404e';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(x, y, TILE, 3);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(x + 6, y + 10, 6, 4);
    ctx.fillRect(x + 18, y + 20, 7, 4);
}

function drawLadder(x, y, colour) {
    ctx.fillStyle = colour;
    ctx.fillRect(x + 4, y, 4, TILE);
    ctx.fillRect(x + TILE - 8, y, 4, TILE);
    ctx.fillRect(x + 4, y + 6, TILE - 8, 3);
    ctx.fillRect(x + 4, y + 19, TILE - 8, 3);
}

function drawRope(x, y) {
    ctx.strokeStyle = '#b08a4a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x + TILE, y + 6);
    ctx.stroke();
    ctx.fillStyle = 'rgba(176, 138, 74, 0.6)';
    ctx.fillRect(x + TILE / 2 - 1, y + 6, 2, 5);
}

function drawGold(x, y) {
    const bob = Math.sin(animTime * 3 + x) * 1.5;
    ctx.fillStyle = '#ffd447';
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 20 + bob);
    ctx.lineTo(x + TILE - 6, y + 20 + bob);
    ctx.lineTo(x + TILE - 9, y + 11 + bob);
    ctx.lineTo(x + 9, y + 11 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(x + 10, y + 12 + bob, TILE - 20, 2);
}

function drawHole(x, y, h) {
    // The pit itself, with the broken brick still clinging to both sides so a
    // dug tile reads as damage rather than as plain empty space.
    ctx.fillStyle = '#120a06';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#4a2716';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 7, y);
    ctx.lineTo(x + 4, y + 9);
    ctx.lineTo(x + 6, y + TILE);
    ctx.lineTo(x, y + TILE);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + TILE, y);
    ctx.lineTo(x + TILE - 7, y);
    ctx.lineTo(x + TILE - 4, y + 9);
    ctx.lineTo(x + TILE - 6, y + TILE);
    ctx.lineTo(x + TILE, y + TILE);
    ctx.closePath();
    ctx.fill();
    if (h.t <= HOLE_WARN) {
        // The brick is about to knit back: flash it so anything standing in the
        // pit has a warning.
        const pulse = 0.25 + 0.35 * Math.sin(animTime * 18);
        ctx.fillStyle = `rgba(214, 128, 70, ${pulse.toFixed(3)})`;
        ctx.fillRect(x, y, TILE, TILE);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x + 6, y + TILE - 5, TILE - 12, 5);
}

function drawRunner(e, body, trim) {
    const x = e.x * TILE;
    const y = e.y * TILE;
    ctx.fillStyle = body;
    ctx.fillRect(x + 10, y + 11, 10, 12);
    ctx.beginPath();
    ctx.arc(x + 15, y + 8, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = trim;
    const swing = Math.sin(animTime * 14) * 3;
    ctx.fillRect(x + 9, y + 23, 5, 6 + swing);
    ctx.fillRect(x + 16, y + 23, 5, 6 - swing);
    ctx.fillRect(x + 15 + e.facing * 5, y + 13, 5, 4);
    ctx.fillStyle = '#05070b';
    ctx.fillRect(x + 13 + e.facing * 2, y + 6, 3, 3);
}

function draw() {
    // Daylight at the top of the shaft, fading into the vault below.
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#131c2f');
    sky.addColorStop(0.28, '#080c14');
    sky.addColorStop(1, '#05070b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = 'rgba(120, 160, 220, 0.10)';
    ctx.fillRect(0, 0, CANVAS_W, 2);

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = c * TILE;
            const y = r * TILE;
            const t = grid[r][c];
            if (t === '#') drawBrick(x, y, false);
            else if (t === '@') drawStone(x, y);
            else if (t === 'H') drawLadder(x, y, '#d8b34a');
            else if (t === 'S' && escapeActive()) drawLadder(x, y, '#63e6be');
            else if (t === '-') drawRope(x, y);
            else if (t === '$') drawGold(x, y);
        }
    }

    for (const h of holes) drawHole(h.c * TILE, h.r * TILE, h);

    for (const g of guards) {
        if (g.state === 'dead') continue;
        drawRunner(g, g.state === 'active' ? '#ef5350' : '#a83a38', '#ffb4b2');
    }

    if (state !== 'dying') drawRunner(player, '#4fc3f7', '#dff4ff');

    if (goldLeft === 0 && state === 'running') {
        ctx.fillStyle = 'rgba(99, 230, 190, 0.9)';
        ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('ESCAPE LADDERS OPEN — CLIMB OUT', CANVAS_W / 2, 22);
        ctx.textAlign = 'left';
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

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
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (k === ' ' || k === 'Enter') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'paused') togglePause();
        return;
    }
    if (k === 'p') {
        togglePause();
        return;
    }
    if (k === 'z' || k === ',') {
        dig(-1);
        return;
    }
    if (k === 'x' || k === '.') {
        dig(1);
        return;
    }
    const dir = MOVE_KEYS[k] || MOVE_KEYS[e.key];
    if (dir) {
        e.preventDefault();
        keys[dir] = true;
    }
});

window.addEventListener('keyup', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const dir = MOVE_KEYS[k] || MOVE_KEYS[e.key];
    if (dir) keys[dir] = false;
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

best = parseInt(localStorage.getItem('goldrunner-best') || '0', 10) || 0;
loadLevel(1);
guards = [];
state = 'idle';
updateHud();
showOverlay('GOLD RUNNER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
