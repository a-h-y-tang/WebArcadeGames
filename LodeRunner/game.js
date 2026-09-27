// ---------------------------------------------------------------------------
// Lode Runner — a grid platformer about stealing gold and out-digging guards.
//
// The runner can walk, climb ladders, hang from bars and dig a hole in the
// brick either side of the square below. Guards chase; a guard that walks over
// a fresh hole drops in and is stuck until it climbs out — or until the brick
// grows back and buries it. Collect every bar of gold to reveal the hidden exit
// ladders, then climb to the top of the screen.
//
// Written as a single classic (non-module) script so the state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom, Dino
// Run and Tetris in this repo. Movement is cell-by-cell on a timer and the
// whole simulation is advanced through `step(dt)`, so tests can run frames
// deterministically instead of leaning on requestAnimationFrame wall clocks.
// ---------------------------------------------------------------------------

// --- Canvas geometry ---
const CANVAS_W = 600;
const CANVAS_H = 360;

// --- Tiles ---
const TILE = {
    EMPTY: 0,
    BRICK: 1,   // diggable
    SOLID: 2,   // undiggable stone
    LADDER: 3,
    BAR: 4,     // hand-over-hand rope
    GOLD: 5,
    EXIT: 6,    // hidden escape ladder: empty until every bar of gold is taken
};

const CHAR_TILES = {
    ' ': TILE.EMPTY,
    '.': TILE.EMPTY,
    '#': TILE.BRICK,
    '=': TILE.SOLID,
    'H': TILE.LADDER,
    '-': TILE.BAR,
    '$': TILE.GOLD,
    'S': TILE.EXIT,
    'P': TILE.EMPTY,   // runner spawn
    'G': TILE.EMPTY,   // guard spawn
};

// --- Timing (seconds per one-cell move) ---
const MOVE_INTERVAL = 0.10;
const CLIMB_INTERVAL = 0.12;
const FALL_INTERVAL = 0.07;
const GUARD_MOVE_INTERVAL = 0.19;
const GUARD_FALL_INTERVAL = 0.09;
const GUARD_TRAP_TIME = 3.0;   // how long a guard sits in a hole before climbing out
const HOLE_TIME = 5.0;         // how long a dug hole stays open

// --- Rules ---
const START_LIVES = 3;
const GOLD_POINTS = 100;
const TRAP_POINTS = 50;
const BURY_POINTS = 100;
const LEVEL_POINTS = 500;
const BEST_KEY = 'lode-runner-best';

// ---------------------------------------------------------------------------
// Levels
//
// ' ' empty   '#' brick (diggable)   '=' stone (solid)   'H' ladder
// '-' bar     '$' gold               'S' hidden exit ladder
// 'P' runner spawn                   'G' guard spawn
// ---------------------------------------------------------------------------

const LEVELS = [
    // Level 1 — Warm-up
    [
        ' S                          S ',
        ' S                          S ',
        ' S                          S ',
        ' S                          S ',
        ' S      H   $        H      S ',
        ' S######H#####  #####H######S ',
        ' S      H            H      S ',
        ' S      H            H      S ',
        ' S      H$ H ---- H  H      S ',
        ' S#########H##  ##H#########S ',
        ' S         H      H         S ',
        ' S         H      H         S ',
        ' S  $ H    H ---- H    H $  S ',
        ' S####H#######  #######H####S ',
        ' S    H                H    S ',
        ' S    H                H    S ',
        ' S P  H        $       HG   S ',
        '==============================',
    ],
    // Level 2 — Crossings
    [
        ' S                          S ',
        ' S                          S ',
        ' S                          S ',
        ' S    H       ----  $       S ',
        ' S####H########  ###########S ',
        ' S    H                     S ',
        ' S  H H     -------   $ H   S ',
        ' S##H###  ##===#########H###S ',
        ' S  H                   H   S ',
        ' S  H$            $ --- H   S ',
        ' S##H###############  ######S ',
        ' S  H                       S ',
        ' S  H     ------ $       GH S ',
        ' S########  #####===######H#S ',
        ' S                        H S ',
        ' S                        H S ',
        ' SP       $          G    H S ',
        '==============================',
    ],
    // Level 3 — The Vault
    [
        ' S                          S ',
        ' S                          S ',
        ' S                          S ',
        ' S                          S ',
        ' S       $         ---- H$  S ',
        ' S######====########  ##H###S ',
        ' S                      H   S ',
        ' S   H     ----     $   H   S ',
        ' S###H######  ##====########S ',
        ' S   H                      S ',
        ' S   H  $   G   ----      H S ',
        ' S####====#######  #######H#S ',
        ' S                        H S ',
        ' S H   $ ----    G    $   H S ',
        ' S#H######  ########====####S ',
        ' S H                        S ',
        ' SPH          $     G       S ',
        '==============================',
    ],
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let COLS = 30;
let ROWS = 18;
let grid = [];                 // grid[row][col] -> TILE.*
let holes = [];                // { c, r, timer }
let guards = [];
let player = { c: 0, r: 0, timer: 0, falling: false, face: 1, frame: 0 };
let playerSpawn = { c: 0, r: 0 };
let particles = [];

let state = 'idle';            // idle | running | paused | gameover | won
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let goldRemaining = 0;
let exitOpen = false;
let autoStep = true;           // tests switch this off and drive step() themselves

const input = { dx: 0, dy: 0 };

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

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

function inBounds(c, r) {
    return c >= 0 && r >= 0 && c < COLS && r < ROWS;
}

// Raw map contents, hidden exit ladders included.
function rawTileAt(c, r) {
    return inBounds(c, r) ? grid[r][c] : TILE.SOLID;
}

// What the world behaves like right now: a hidden exit ladder is nothing at all
// until the last bar of gold is picked up.
function tileAt(c, r) {
    const t = rawTileAt(c, r);
    if (t === TILE.EXIT) return exitOpen ? TILE.LADDER : TILE.EMPTY;
    return t;
}

function isBlocking(t) {
    return t === TILE.BRICK || t === TILE.SOLID;
}

function isPassable(c, r) {
    return inBounds(c, r) && !isBlocking(tileAt(c, r));
}

function holeAt(c, r) {
    return holes.find((h) => h.c === c && h.r === r) || null;
}

function guardAt(c, r, except) {
    return guards.find((g) => g !== except && g.c === c && g.r === r) || null;
}

// Can an actor at this cell stand still, or does gravity take over?
function isSupported(c, r) {
    const here = tileAt(c, r);
    if (here === TILE.LADDER || here === TILE.BAR) return true;
    if (holeAt(c, r)) return true;            // sitting in a dug pit
    if (r + 1 >= ROWS) return true;           // the bottom of the world
    const below = tileAt(c, r + 1);
    if (below === TILE.BRICK || below === TILE.SOLID || below === TILE.LADDER) return true;
    const trapped = guardAt(c, r + 1);
    if (trapped && trapped.trapped) return true;  // run across a trapped guard's head
    return false;
}

// ---------------------------------------------------------------------------
// Level loading
// ---------------------------------------------------------------------------

function loadLevelLines(lines) {
    ROWS = lines.length;
    COLS = Math.max(...lines.map((l) => l.length));
    grid = [];
    guards = [];
    holes = [];
    particles = [];
    exitOpen = false;
    goldRemaining = 0;
    playerSpawn = { c: 0, r: 0 };

    for (let r = 0; r < ROWS; r++) {
        const row = new Array(COLS).fill(TILE.EMPTY);
        for (let c = 0; c < COLS; c++) {
            const ch = lines[r][c] === undefined ? ' ' : lines[r][c];
            const t = CHAR_TILES[ch];
            row[c] = t === undefined ? TILE.EMPTY : t;
            if (t === TILE.GOLD) goldRemaining++;
            if (ch === 'P') playerSpawn = { c, r };
            if (ch === 'G') guards.push(makeGuard(c, r));
        }
        grid.push(row);
    }

    player = { c: playerSpawn.c, r: playerSpawn.r, timer: 0, falling: false, face: 1, frame: 0 };
    setInput(0, 0);
    updateHud();
}

function loadLevel(n) {
    loadLevelLines(LEVELS[(n - 1) % LEVELS.length]);
}

function makeGuard(c, r) {
    return {
        c, r,
        spawn: { c, r },
        timer: 0,
        falling: false,
        trapped: false,
        trapTimer: 0,
        face: -1,
    };
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function setInput(dx, dy) {
    input.dx = dx;
    input.dy = dy;
}

function setPlayerCell(c, r) {
    player.c = c;
    player.r = r;
    player.timer = 0;
    player.falling = false;
}

function setAutoStep(on) {
    autoStep = !!on;
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

function movePlayerTo(c, r) {
    player.c = c;
    player.r = r;
    if (rawTileAt(c, r) === TILE.GOLD) collectGold(c, r);
}

function collectGold(c, r) {
    grid[r][c] = TILE.EMPTY;
    goldRemaining--;
    score += GOLD_POINTS;
    spawnSparkle(c, r, '#ffd970');
    if (goldRemaining <= 0) {
        goldRemaining = 0;
        exitOpen = true;
        for (let rr = 0; rr < ROWS; rr++) {
            for (let cc = 0; cc < COLS; cc++) {
                if (grid[rr][cc] === TILE.EXIT) spawnSparkle(cc, rr, '#8ce0ff');
            }
        }
    }
    updateHud();
}

function applyPlayerInput() {
    const here = tileAt(player.c, player.r);

    // Vertical first: ladders and drops beat a simultaneous sideways press.
    if (input.dy < 0 && here === TILE.LADDER && isPassable(player.c, player.r - 1)) {
        movePlayerTo(player.c, player.r - 1);
        return true;
    }
    if (input.dy > 0 && isPassable(player.c, player.r + 1)) {
        movePlayerTo(player.c, player.r + 1);
        return true;
    }
    if (input.dx !== 0) {
        const nc = player.c + input.dx;
        player.face = input.dx;
        if (isPassable(nc, player.r)) {
            movePlayerTo(nc, player.r);
            return true;
        }
    }
    return false;
}

function updatePlayer(dt) {
    player.timer += dt;
    for (let i = 0; i < 64; i++) {
        const falling = !isSupported(player.c, player.r);
        player.falling = falling;
        const onLadder = tileAt(player.c, player.r) === TILE.LADDER;
        const interval = falling ? FALL_INTERVAL : (onLadder ? CLIMB_INTERVAL : MOVE_INTERVAL);
        if (player.timer < interval) break;

        if (!falling && input.dx === 0 && input.dy === 0) {
            player.timer = interval;   // stay primed so the next press acts at once
            break;
        }

        player.timer -= interval;
        if (falling) {
            movePlayerTo(player.c, player.r + 1);
            player.frame++;
        } else if (applyPlayerInput()) {
            player.frame++;
        } else {
            player.timer = Math.min(player.timer, interval);
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Digging
// ---------------------------------------------------------------------------

function dig(dir) {
    if (state !== 'running') return false;
    const c = player.c + dir;
    const r = player.r + 1;
    if (!inBounds(c, r)) return false;
    if (player.falling || !isSupported(player.c, player.r)) return false;

    const here = tileAt(player.c, player.r);
    if (here === TILE.LADDER || here === TILE.BAR) return false;   // no leverage
    if (rawTileAt(c, r) !== TILE.BRICK) return false;              // only plain brick
    if (isBlocking(tileAt(c, player.r))) return false;             // arm is walled in
    if (guardAt(c, r)) return false;

    grid[r][c] = TILE.EMPTY;
    holes.push({ c, r, timer: 0 });
    player.face = dir;
    for (let i = 0; i < 6; i++) spawnSparkle(c, r, '#b3773f');
    return true;
}

function updateHoles(dt) {
    for (let i = holes.length - 1; i >= 0; i--) {
        const hole = holes[i];
        hole.timer += dt;
        if (hole.timer < HOLE_TIME) continue;

        grid[hole.r][hole.c] = TILE.BRICK;
        holes.splice(i, 1);
        for (let n = 0; n < 6; n++) spawnSparkle(hole.c, hole.r, '#8a5a2b');

        const guard = guardAt(hole.c, hole.r);
        if (guard) buryGuard(guard);
        if (player.c === hole.c && player.r === hole.r) killPlayer();
    }
}

function fillAllHoles() {
    for (const hole of holes) grid[hole.r][hole.c] = TILE.BRICK;
    holes = [];
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function canGuardGo(g, c, r) {
    return isPassable(c, r) && !guardAt(c, r, g);
}

function chooseGuardMove(g) {
    const here = tileAt(g.c, g.r);
    if (player.r < g.r && here === TILE.LADDER && canGuardGo(g, g.c, g.r - 1)) return [0, -1];
    if (player.r > g.r) {
        const below = tileAt(g.c, g.r + 1);
        const canDrop = here === TILE.LADDER || here === TILE.BAR || below === TILE.LADDER;
        if (canDrop && canGuardGo(g, g.c, g.r + 1)) return [0, 1];
    }
    const dc = Math.sign(player.c - g.c);
    if (dc !== 0 && canGuardGo(g, g.c + dc, g.r)) return [dc, 0];
    if (dc !== 0 && canGuardGo(g, g.c - dc, g.r)) return [-dc, 0];
    if (canGuardGo(g, g.c, g.r + 1)) return [0, 1];
    if (here === TILE.LADDER && canGuardGo(g, g.c, g.r - 1)) return [0, -1];
    return [0, 0];
}

function trapGuard(g) {
    g.trapped = true;
    g.trapTimer = 0;
    score += TRAP_POINTS;
    updateHud();
}

function buryGuard(g) {
    g.trapped = false;
    g.trapTimer = 0;
    g.timer = 0;
    g.c = g.spawn.c;
    g.r = g.spawn.r;
    score += BURY_POINTS;
    updateHud();
}

function updateGuard(g, dt) {
    if (g.trapped) {
        g.trapTimer += dt;
        if (g.trapTimer < GUARD_TRAP_TIME) return;
        // Scramble out sideways — preferring the side the runner is on.
        const pref = Math.sign(player.c - g.c) || 1;
        for (const dir of [pref, -pref]) {
            const nc = g.c + dir;
            const nr = g.r - 1;
            if (canGuardGo(g, nc, nr) && isSupported(nc, nr)) {
                g.c = nc;
                g.r = nr;
                g.face = dir;
                g.trapped = false;
                g.trapTimer = 0;
                break;
            }
        }
        return;
    }

    g.timer += dt;
    for (let i = 0; i < 64; i++) {
        const falling = !isSupported(g.c, g.r);
        g.falling = falling;
        const interval = falling ? GUARD_FALL_INTERVAL : GUARD_MOVE_INTERVAL;
        if (g.timer < interval) break;
        g.timer -= interval;

        if (falling) {
            g.r += 1;
        } else {
            const [dc, dr] = chooseGuardMove(g);
            if (dc === 0 && dr === 0) {
                g.timer = Math.min(g.timer, interval);
                break;
            }
            g.c += dc;
            g.r += dr;
            if (dc !== 0) g.face = dc;
        }

        if (holeAt(g.c, g.r)) {
            trapGuard(g);
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Deaths, levels, game over
// ---------------------------------------------------------------------------

function killPlayer() {
    lives--;
    for (let i = 0; i < 14; i++) spawnSparkle(player.c, player.r, '#ef5d5d');
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    resetActors();
    updateHud();
}

function resetActors() {
    fillAllHoles();
    player.c = playerSpawn.c;
    player.r = playerSpawn.r;
    player.timer = 0;
    player.falling = false;
    for (const g of guards) {
        g.c = g.spawn.c;
        g.r = g.spawn.r;
        g.timer = 0;
        g.falling = false;
        g.trapped = false;
        g.trapTimer = 0;
    }
    setInput(0, 0);
}

function checkCaught() {
    for (const g of guards) {
        if (!g.trapped && g.c === player.c && g.r === player.r) {
            killPlayer();
            return true;
        }
    }
    return false;
}

function completeLevel() {
    score += LEVEL_POINTS + lives * 100;
    level++;
    if (level > LEVELS.length) {
        state = 'won';
        saveBest();
        showOverlay('YOU ESCAPED!', `Final score ${score}`, 'Press Space to play again');
        updateHud();
        return;
    }
    loadLevel(level);
    updateHud();
}

function gameOver() {
    state = 'gameover';
    saveBest();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to try again');
    updateHud();
}

function saveBest() {
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage blocked — best is still tracked for this session */
        }
    }
}

// ---------------------------------------------------------------------------
// Simulation step — the tests drive this directly
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    updateHoles(dt);
    if (state !== 'running') return;   // a refilling hole may have ended the run
    updatePlayer(dt);
    if (checkCaught() || state !== 'running') return;
    for (const g of guards) {
        updateGuard(g, dt);
        if (checkCaught() || state !== 'running') return;
    }
    if (exitOpen && player.r === 0) completeLevel();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    loadLevel(1);
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

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    overlaySub.textContent = sub;
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Play Again';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elGold.textContent = String(goldRemaining);
    elLives.textContent = String(lives);
    elBest.textContent = String(best);
}

function spawnSparkle(c, r, color) {
    particles.push({
        x: c + 0.2 + Math.random() * 0.6,
        y: r + 0.2 + Math.random() * 0.6,
        vx: (Math.random() - 0.5) * 2.2,
        vy: -Math.random() * 2.2,
        life: 0.5 + Math.random() * 0.3,
        age: 0,
        color,
    });
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) {
            particles.splice(i, 1);
            continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 9 * dt;
    }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function cellSize() {
    return Math.floor(Math.min(CANVAS_W / COLS, CANVAS_H / ROWS));
}

function originX(size) {
    return Math.floor((CANVAS_W - size * COLS) / 2);
}

function originY(size) {
    return Math.floor((CANVAS_H - size * ROWS) / 2);
}

function drawBrick(x, y, s) {
    ctx.fillStyle = '#7a3f22';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#a1552d';
    ctx.fillRect(x + 1, y + 1, s - 2, s / 2 - 2);
    ctx.fillRect(x + 1, y + s / 2 + 1, s / 2 - 2, s / 2 - 2);
    ctx.fillRect(x + s / 2 + 1, y + s / 2 + 1, s / 2 - 2, s / 2 - 2);
    ctx.fillStyle = 'rgba(255, 220, 180, 0.10)';
    ctx.fillRect(x + 1, y + 1, s - 2, 1);
}

function drawStone(x, y, s) {
    ctx.fillStyle = '#3b4a63';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#4d5f7d';
    ctx.fillRect(x + 1, y + 1, s - 2, s - 3);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + 2, y + 2, s - 4, 2);
}

function drawLadder(x, y, s, glow) {
    ctx.strokeStyle = glow ? '#8ce0ff' : '#c8b06a';
    ctx.lineWidth = Math.max(2, s * 0.12);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.24, y);
    ctx.lineTo(x + s * 0.24, y + s);
    ctx.moveTo(x + s * 0.76, y);
    ctx.lineTo(x + s * 0.76, y + s);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.5, s * 0.09);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.2, y + s * 0.3);
    ctx.lineTo(x + s * 0.8, y + s * 0.3);
    ctx.moveTo(x + s * 0.2, y + s * 0.75);
    ctx.lineTo(x + s * 0.8, y + s * 0.75);
    ctx.stroke();
}

function drawBar(x, y, s) {
    ctx.strokeStyle = '#9fb3d1';
    ctx.lineWidth = Math.max(2, s * 0.12);
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.22);
    ctx.lineTo(x + s, y + s * 0.22);
    ctx.stroke();
    ctx.fillStyle = 'rgba(159, 179, 209, 0.35)';
    ctx.fillRect(x + s * 0.45, y + s * 0.22, s * 0.1, s * 0.16);
}

function drawGold(x, y, s) {
    const cx = x + s / 2;
    const cy = y + s * 0.58;
    const rad = s * 0.3;
    const grad = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.4, rad * 0.1, cx, cy, rad);
    grad.addColorStop(0, '#fff2b0');
    grad.addColorStop(0.6, '#f2c14e');
    grad.addColorStop(1, '#b8811d');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(cx - rad * 0.3, cy - rad * 0.35, rad * 0.22, 0, Math.PI * 2);
    ctx.fill();
}

function drawHole(hole, x, y, s) {
    const left = HOLE_TIME - hole.timer;
    ctx.fillStyle = '#05070f';
    ctx.fillRect(x, y, s, s);
    // ragged brick edges either side
    ctx.fillStyle = left < 1.2 && Math.floor(hole.timer * 10) % 2 === 0 ? '#c9743a' : '#7a3f22';
    ctx.fillRect(x, y, s * 0.16, s * 0.55);
    ctx.fillRect(x + s * 0.84, y, s * 0.16, s * 0.4);
    ctx.fillRect(x, y + s * 0.85, s, s * 0.15);
}

function drawFigure(x, y, s, body, trim, frame, face, pose) {
    const cx = x + s / 2;
    ctx.fillStyle = body;
    if (pose === 'trapped') {
        ctx.fillRect(cx - s * 0.22, y + s * 0.5, s * 0.44, s * 0.4);
        ctx.beginPath();
        ctx.arc(cx, y + s * 0.42, s * 0.17, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    // head
    ctx.beginPath();
    ctx.arc(cx, y + s * 0.24, s * 0.17, 0, Math.PI * 2);
    ctx.fill();
    // torso
    ctx.fillRect(cx - s * 0.14, y + s * 0.38, s * 0.28, s * 0.3);
    // legs
    const swing = pose === 'climb' ? 0 : (frame % 2 === 0 ? 1 : -1) * s * 0.12;
    ctx.fillRect(cx - s * 0.14 - swing, y + s * 0.68, s * 0.12, s * 0.3);
    ctx.fillRect(cx + s * 0.02 + swing, y + s * 0.68, s * 0.12, s * 0.3);
    // arms
    ctx.fillStyle = trim;
    if (pose === 'hang') {
        ctx.fillRect(cx - s * 0.3, y + s * 0.3, s * 0.6, s * 0.09);
    } else if (pose === 'climb') {
        ctx.fillRect(cx - s * 0.26, y + s * 0.34, s * 0.52, s * 0.09);
    } else {
        ctx.fillRect(cx + (face > 0 ? s * 0.1 : -s * 0.34), y + s * 0.42, s * 0.24, s * 0.09);
    }
}

function playerPose() {
    const here = tileAt(player.c, player.r);
    if (here === TILE.BAR) return 'hang';
    if (here === TILE.LADDER) return 'climb';
    return 'run';
}

function draw() {
    const s = cellSize();
    const ox = originX(s);
    const oy = originY(s);

    ctx.fillStyle = '#070b16';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // faint cell grid so the world reads as a lattice
    ctx.strokeStyle = 'rgba(120, 150, 200, 0.05)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(ox + c * s + 0.5, oy);
        ctx.lineTo(ox + c * s + 0.5, oy + ROWS * s);
        ctx.stroke();
    }

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = ox + c * s;
            const y = oy + r * s;
            const raw = grid[r][c];
            if (raw === TILE.BRICK) drawBrick(x, y, s);
            else if (raw === TILE.SOLID) drawStone(x, y, s);
            else if (raw === TILE.LADDER) drawLadder(x, y, s, false);
            else if (raw === TILE.BAR) drawBar(x, y, s);
            else if (raw === TILE.GOLD) drawGold(x, y, s);
            else if (raw === TILE.EXIT && exitOpen) drawLadder(x, y, s, true);
        }
    }

    for (const hole of holes) drawHole(hole, ox + hole.c * s, oy + hole.r * s, s);

    for (const p of particles) {
        const fade = 1 - p.age / p.life;
        ctx.globalAlpha = Math.max(0, fade);
        ctx.fillStyle = p.color;
        ctx.fillRect(ox + p.x * s - 1, oy + p.y * s - 1, Math.max(2, s * 0.12), Math.max(2, s * 0.12));
    }
    ctx.globalAlpha = 1;

    for (const g of guards) {
        drawFigure(ox + g.c * s, oy + g.r * s, s, '#ef5d5d', '#ffd0d0', 0, g.face,
            g.trapped ? 'trapped' : 'run');
    }

    drawFigure(ox + player.c * s, oy + player.r * s, s, '#7ee0c0', '#e9fff8',
        player.frame, player.face, playerPose());

    if (exitOpen) {
        ctx.fillStyle = 'rgba(140, 224, 255, 0.85)';
        ctx.font = `bold ${Math.max(10, s * 0.55)}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('ESCAPE', CANVAS_W / 2, oy + s * 0.8);
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const MOVE_KEYS = new Set([
    'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's',
]);
const heldKeys = new Set();

function refreshHeldInput() {
    const left = heldKeys.has('arrowleft') || heldKeys.has('a');
    const right = heldKeys.has('arrowright') || heldKeys.has('d');
    const up = heldKeys.has('arrowup') || heldKeys.has('w');
    const down = heldKeys.has('arrowdown') || heldKeys.has('s');
    setInput((right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));
}

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();

    if (key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (state === 'idle' || state === 'gameover' || state === 'won') startGame();
        return;
    }
    if (key === 'p' || key === 'escape') {
        e.preventDefault();
        togglePause();
        return;
    }
    if (key === 'z' || key === ',') {
        e.preventDefault();
        dig(-1);
        return;
    }
    if (key === 'x' || key === '.') {
        e.preventDefault();
        dig(1);
        return;
    }
    if (MOVE_KEYS.has(key)) {
        e.preventDefault();
        heldKeys.add(key);
        refreshHeldInput();
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (heldKeys.delete(key)) refreshHeldInput();
});

window.addEventListener('blur', () => {
    heldKeys.clear();
    refreshHeldInput();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same step() the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;

function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;   // clamp after tab switches / long frames
    if (autoStep && state === 'running') step(dt);
    updateParticles(dt);
    draw();
    updateHud();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function loadBest() {
    try {
        const stored = Number(window.localStorage.getItem(BEST_KEY));
        return Number.isFinite(stored) && stored > 0 ? stored : 0;
    } catch (err) {
        return 0;
    }
}

best = loadBest();
loadLevel(1);
updateHud();
requestAnimationFrame(frame);
