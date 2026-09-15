// ---------------------------------------------------------------------------
// Rampart — a siege game of walls, cannons and cannonballs on an HTML5 canvas.
//
// Each round runs through three phases. In PLACE you drop cannons inside the
// walls you hold. In BATTLE a fleet rolls in from the sea and shells your
// ramparts while you fire back. In REPAIR you are handed wall pieces and have
// to close every hole again — when the clock runs out, any castle the sea can
// still walk into is lost. Hold at least one castle and the siege rolls on.
//
// Written as a single classic (non-module) script so state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Grid ----------------------------------------------------------------
const COLS = 28;
const ROWS = 22;
const CELL = 20;
const CANVAS_W = COLS * CELL;  // 560
const CANVAS_H = ROWS * CELL;  // 440

// Terrain codes
const WATER = 0;
const LAND = 1;

// Structure codes
const EMPTY = 0;
const WALL = 1;
const CASTLE = 2;
const CANNON = 3;

// --- Map -----------------------------------------------------------------
// The coastline wanders between these two columns, so the sea is always a few
// cells wide and the land always starts left of the opening ring.
const SHORE_MIN = 7;
const SHORE_MAX = 9;
const DEFAULT_SEED = 20240914;

const CASTLE_SIZE = 3;
const CASTLE_SPOTS = [
    { col: 13, row: 1 },
    { col: 13, row: 9 },
    { col: 13, row: 17 },
];

// The wall you are given at the start of a run: a 9x9 ring around the middle
// castle, leaving a 7x7 courtyard with room for cannons.
const RING = { left: 10, right: 18, top: 6, bottom: 14 };

// --- Phases --------------------------------------------------------------
const PLACE_TIME = 10;
const BATTLE_TIME = 30;
const REPAIR_BASE = 25;
const REPAIR_STEP = 2;
const REPAIR_MIN = 15;

// --- Cannons -------------------------------------------------------------
const CANNON_SIZE = 2;         // cells on a side
const CANNON_RANGE = 320;      // px
const CANNON_COOL = 1.4;       // s between shots
const SHOT_SPEED = 300;        // px/s
const BLAST_R = 18;            // px — a blast clears its own cell and its neighbours

// --- Ships ---------------------------------------------------------------
const SHIP_CELLS = 3;
const SHIP_W = SHIP_CELLS * CELL; // 60
const SHIP_H = CELL;
const SHIP_SPEED = 22;            // px/s
const SHIP_STOP_GAP = 24;         // px of open water kept between hull and coast
const SHIP_FIRST_SPAWN = 1.5;     // s into the battle
const SHIP_MAX_ALIVE = 3;
const SHELL_SPEED = 220;          // px/s
const SHELL_SCATTER = 5;          // px of aiming slop, so craters do not stack

// --- Scoring -------------------------------------------------------------
const SHIP_POINTS = 200;
const CASTLE_BONUS = 150;

// --- Colours -------------------------------------------------------------
const C_SEA = '#12314c';
const C_SEA_DEEP = '#0d2436';
const C_FOAM = '#3f7ea6';
const C_LAND = '#3f5333';
const C_LAND_HI = '#455a37';
const C_WALL = '#9aa5ad';
const C_WALL_DARK = '#68737c';
const C_CASTLE = '#c9a227';
const C_CASTLE_DARK = '#8d6f16';
const C_CANNON = '#2b2f36';
const C_SHIP = '#5d4230';
const C_SHIP_DARK = '#3d2b1f';
const C_SAIL = '#e6dccb';

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const roundEl = document.getElementById('round');
const phaseEl = document.getElementById('phase');
const timerEl = document.getElementById('timer');
const cannonsEl = document.getElementById('cannons');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'over'
// phase: 'place' | 'battle' | 'repair'
let state = 'idle';
let phase = 'place';
let phaseTime = PLACE_TIME;
let round = 1;
let score = 0;
let best = 0;
let cannonsLeft = 0;
let shipsSunk = 0;
let shipTimer = 0;
let shipsSpawned = 0;
let currentPiece = null;
let nextPiece = null;

const terrain = [];      // [row][col] -> WATER | LAND
const structures = [];   // [row][col] -> EMPTY | WALL | CASTLE | CANNON
const rubble = [];       // [row][col] -> true where stonework was blown away
const outside = [];      // [row][col] -> true when the sea can walk in
const shore = [];        // [row] -> first land column
const decor = [];        // static scenery, seeded with the map
const castles = [];
const cannons = [];
const ships = [];
const shots = [];
const blasts = [];
const pieceBag = [];

const cursor = { col: 14, row: 11 };

// Test seams: the specs turn ship spawning off so long simulations stay
// deterministic, and turn the requestAnimationFrame stepping off so the real
// clock never races a simulated one.
let shipSpawnEnabled = true;
let autoStep = true;

// ---------------------------------------------------------------------------
// Seeded RNG — the map and the fleet behave the same way on every run.
// ---------------------------------------------------------------------------

let seed = DEFAULT_SEED;
let rngState = DEFAULT_SEED;

function setSeed(n) {
    seed = n >>> 0;
    rngState = seed;
}

function rand() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randInt(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }

// ---------------------------------------------------------------------------
// Geometry helpers (pure)
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Centre of a cell along either axis — cells are square, so one helper does.
function cellCenter(index) { return index * CELL + CELL / 2; }

function inBounds(col, row) { return col >= 0 && row >= 0 && col < COLS && row < ROWS; }

function repairTime(r) {
    return Math.max(REPAIR_MIN, REPAIR_BASE - REPAIR_STEP * (r - 1));
}

function shipsForRound(r) { return Math.min(10, 2 + r); }

function shipSpawnInterval(r) { return Math.max(1.6, 4.2 - 0.3 * (r - 1)); }

// Ships reload slowly, so a gunner who sinks the fleet early keeps their walls.
function shipFireInterval(r) { return Math.max(2.8, 5.5 - 0.25 * (r - 1)); }

// ---------------------------------------------------------------------------
// Map generation
// ---------------------------------------------------------------------------

function buildTerrain() {
    shore.length = 0;
    // A long swell in the coastline plus a little noise: bays the fleet can
    // sail into, headlands it has to stand off from.
    const offset = rand() * Math.PI * 2;
    for (let r = 0; r < ROWS; r++) {
        const swell = Math.sin(r * 0.55 + offset) * 1.15;
        const noise = (rand() - 0.5) * 1.2;
        shore.push(clamp(Math.round(8 + swell + noise), SHORE_MIN, SHORE_MAX));
    }
    // Guarantee the coast is never a perfectly straight line.
    if (new Set(shore).size === 1) shore[0] = SHORE_MIN;

    terrain.length = 0;
    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) row.push(c < shore[r] ? WATER : LAND);
        terrain.push(row);
    }
}

function buildStructures() {
    structures.length = 0;
    rubble.length = 0;
    for (let r = 0; r < ROWS; r++) {
        structures.push(new Array(COLS).fill(EMPTY));
        rubble.push(new Array(COLS).fill(false));
    }

    castles.length = 0;
    for (const spot of CASTLE_SPOTS) {
        const castle = { col: spot.col, row: spot.row, size: CASTLE_SIZE };
        castles.push(castle);
        for (let dr = 0; dr < CASTLE_SIZE; dr++) {
            for (let dc = 0; dc < CASTLE_SIZE; dc++) {
                structures[castle.row + dr][castle.col + dc] = CASTLE;
            }
        }
    }

    // The opening ring around the middle castle.
    for (let c = RING.left; c <= RING.right; c++) {
        structures[RING.top][c] = WALL;
        structures[RING.bottom][c] = WALL;
    }
    for (let r = RING.top; r <= RING.bottom; r++) {
        structures[r][RING.left] = WALL;
        structures[r][RING.right] = WALL;
    }
}

function buildDecor() {
    decor.length = 0;
    for (let i = 0; i < 90; i++) {
        decor.push({
            x: rand() * CANVAS_W,
            y: rand() * CANVAS_H,
            r: 1 + rand() * 1.6,
            shade: rand(),
        });
    }
}

function resetBoard() {
    setSeed(DEFAULT_SEED);
    buildTerrain();
    buildStructures();
    buildDecor();
    cannons.length = 0;
    ships.length = 0;
    shots.length = 0;
    blasts.length = 0;
    pieceBag.length = 0;
    currentPiece = null;
    nextPiece = null;
    computeOutside();
}

// ---------------------------------------------------------------------------
// Enclosure — flood the board from its border; walls are the only barrier.
// Anything the flood cannot reach is yours.
// ---------------------------------------------------------------------------

function computeOutside() {
    outside.length = 0;
    for (let r = 0; r < ROWS; r++) outside.push(new Array(COLS).fill(false));

    const queue = [];
    const visit = (c, r) => {
        if (!inBounds(c, r) || outside[r][c] || structures[r][c] === WALL) return;
        outside[r][c] = true;
        queue.push(c, r);
    };

    for (let c = 0; c < COLS; c++) { visit(c, 0); visit(c, ROWS - 1); }
    for (let r = 0; r < ROWS; r++) { visit(0, r); visit(COLS - 1, r); }

    for (let i = 0; i < queue.length; i += 2) {
        const c = queue[i];
        const r = queue[i + 1];
        visit(c + 1, r);
        visit(c - 1, r);
        visit(c, r + 1);
        visit(c, r - 1);
    }
    return outside;
}

function isEnclosed(castle) {
    for (let dr = 0; dr < castle.size; dr++) {
        for (let dc = 0; dc < castle.size; dc++) {
            if (outside[castle.row + dr][castle.col + dc]) return false;
        }
    }
    return true;
}

function heldCastles() { return castles.filter(isEnclosed).length; }

// Enclosed, empty land — the ground a cannon may stand on.
function countTerritory() {
    let n = 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (!outside[r][c] && terrain[r][c] === LAND && structures[r][c] === EMPTY) n++;
        }
    }
    return n;
}

// ---------------------------------------------------------------------------
// Cannons
// ---------------------------------------------------------------------------

function canPlaceCannon(col, row) {
    if (state !== 'running' || phase !== 'place' || cannonsLeft <= 0) return false;
    for (let dr = 0; dr < CANNON_SIZE; dr++) {
        for (let dc = 0; dc < CANNON_SIZE; dc++) {
            const c = col + dc;
            const r = row + dr;
            if (!inBounds(c, r)) return false;
            if (terrain[r][c] !== LAND) return false;
            if (structures[r][c] !== EMPTY) return false;
            if (outside[r][c]) return false;
        }
    }
    return true;
}

function placeCannon(col, row) {
    if (!canPlaceCannon(col, row)) return false;
    for (let dr = 0; dr < CANNON_SIZE; dr++) {
        for (let dc = 0; dc < CANNON_SIZE; dc++) {
            structures[row + dr][col + dc] = CANNON;
            rubble[row + dr][col + dc] = false;
        }
    }
    cannons.push({ col, row, cool: 0, angle: -Math.PI / 2, recoil: 0 });
    cannonsLeft--;
    return true;
}

function cannonCenter(cannon) {
    return {
        x: cannon.col * CELL + CELL,
        y: cannon.row * CELL + CELL,
    };
}

function destroyCannonAt(col, row) {
    const index = cannons.findIndex(
        (k) => col >= k.col && col < k.col + CANNON_SIZE && row >= k.row && row < k.row + CANNON_SIZE
    );
    if (index < 0) return;
    const cannon = cannons[index];
    for (let dr = 0; dr < CANNON_SIZE; dr++) {
        for (let dc = 0; dc < CANNON_SIZE; dc++) {
            structures[cannon.row + dr][cannon.col + dc] = EMPTY;
            rubble[cannon.row + dr][cannon.col + dc] = true;
        }
    }
    cannons.splice(index, 1);
}

// Every loaded cannon in range answers the call — a Rampart volley.
function fireAt(x, y) {
    if (state !== 'running' || phase !== 'battle') return 0;
    let fired = 0;
    for (const cannon of cannons) {
        if (cannon.cool > 0) continue;
        const from = cannonCenter(cannon);
        const dist = Math.hypot(x - from.x, y - from.y);
        if (dist > CANNON_RANGE) continue;
        launchShot(from.x, from.y, x, y, 'player', SHOT_SPEED);
        cannon.cool = CANNON_COOL;
        cannon.angle = Math.atan2(y - from.y, x - from.x);
        cannon.recoil = 1;
        fired++;
    }
    return fired;
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

function launchShot(x0, y0, tx, ty, side, speed) {
    const dist = Math.hypot(tx - x0, ty - y0);
    const shot = {
        x0, y0, tx, ty, side,
        t: 0,
        dur: Math.max(0.2, dist / speed),
        arc: Math.min(70, 18 + dist * 0.22),
        x: x0,
        y: y0,
    };
    shots.push(shot);
    return shot;
}

function launchShell(ship, col, row) {
    return launchShot(
        ship.x + SHIP_W / 2,
        cellCenter(ship.row),
        cellCenter(col) + (rand() - 0.5) * 2 * SHELL_SCATTER,
        cellCenter(row) + (rand() - 0.5) * 2 * SHELL_SCATTER,
        'ship',
        SHELL_SPEED
    );
}

function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
        const shot = shots[i];
        shot.t += dt;
        const k = Math.min(1, shot.t / shot.dur);
        shot.x = shot.x0 + (shot.tx - shot.x0) * k;
        shot.y = shot.y0 + (shot.ty - shot.y0) * k - Math.sin(Math.PI * k) * shot.arc;
        if (shot.t >= shot.dur) {
            shots.splice(i, 1);
            explode(shot.tx, shot.ty, shot.side);
        }
    }
}

// Distance from a point to an axis-aligned rectangle.
function pointRectDist(px, py, x, y, w, h) {
    const dx = Math.max(x - px, 0, px - (x + w));
    const dy = Math.max(y - py, 0, py - (y + h));
    return Math.hypot(dx, dy);
}

function explode(x, y, side) {
    blasts.push({ x, y, t: 0, life: 0.35, side });

    if (side === 'player') {
        for (let i = ships.length - 1; i >= 0; i--) {
            const ship = ships[i];
            if (pointRectDist(x, y, ship.x, ship.row * CELL, SHIP_W, SHIP_H) <= BLAST_R) {
                ships.splice(i, 1);
                shipsSunk++;
                score += SHIP_POINTS;
            }
        }
    }

    // Both sides knock stonework down: your own misses cost you wall too.
    const c0 = clamp(Math.floor((x - BLAST_R) / CELL), 0, COLS - 1);
    const c1 = clamp(Math.floor((x + BLAST_R) / CELL), 0, COLS - 1);
    const r0 = clamp(Math.floor((y - BLAST_R) / CELL), 0, ROWS - 1);
    const r1 = clamp(Math.floor((y + BLAST_R) / CELL), 0, ROWS - 1);
    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
            if (Math.hypot(cellCenter(c) - x, cellCenter(r) - y) > BLAST_R + 2) continue;
            if (structures[r][c] === WALL) {
                structures[r][c] = EMPTY;
                rubble[r][c] = true;
            } else if (side === 'ship' && structures[r][c] === CANNON) {
                // Only enemy fire is heavy enough to knock out a gun emplacement.
                destroyCannonAt(c, r);
            }
        }
    }
}

function updateBlasts(dt) {
    for (let i = blasts.length - 1; i >= 0; i--) {
        blasts[i].t += dt;
        if (blasts[i].t >= blasts[i].life) blasts.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Ships
// ---------------------------------------------------------------------------

function spawnShip(row) {
    const ship = {
        row,
        x: -SHIP_W,
        fire: shipFireInterval(round) * (0.6 + rand() * 0.6),
        hp: 1,
        bob: rand() * Math.PI * 2,
    };
    ships.push(ship);
    return ship;
}

function shipAnchorX(row) {
    return shore[row] * CELL - SHIP_STOP_GAP - SHIP_W;
}

// Ships shell the nearest stonework they can see, favouring their own latitude.
function pickShellTarget(ship) {
    const walls = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (structures[r][c] === WALL || structures[r][c] === CANNON) walls.push({ c, r });
        }
    }
    if (!walls.length) return null;
    walls.sort((a, b) => Math.abs(a.r - ship.row) - Math.abs(b.r - ship.row));
    const pool = walls.slice(0, Math.min(20, walls.length));
    return pool[randInt(0, pool.length - 1)];
}

function updateShips(dt) {
    for (const ship of ships) {
        ship.bob += dt * 2.2;
        const anchor = shipAnchorX(ship.row);
        if (ship.x < anchor) {
            ship.x = Math.min(anchor, ship.x + SHIP_SPEED * dt);
            continue; // guns stay quiet until the ship is on station
        }

        ship.fire -= dt;
        if (ship.fire <= 0) {
            ship.fire = shipFireInterval(round);
            const target = pickShellTarget(ship);
            if (target) launchShell(ship, target.c, target.r);
        }
    }
}

function updateFleet(dt) {
    if (shipSpawnEnabled && shipsSpawned < shipsForRound(round) && ships.length < SHIP_MAX_ALIVE) {
        shipTimer -= dt;
        if (shipTimer <= 0) {
            shipTimer = shipSpawnInterval(round);
            spawnShip(randInt(1, ROWS - 2));
            shipsSpawned++;
        }
    }
    updateShips(dt);
}

// ---------------------------------------------------------------------------
// Repair pieces
// ---------------------------------------------------------------------------

const PIECE_SHAPES = {
    dot: [[0, 0]],
    I: [[0, 0], [1, 0], [2, 0], [3, 0]],
    O: [[0, 0], [1, 0], [0, 1], [1, 1]],
    T: [[0, 0], [1, 0], [2, 0], [1, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]],
    Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
    L: [[0, 0], [0, 1], [1, 1], [2, 1]],
    J: [[2, 0], [0, 1], [1, 1], [2, 1]],
};
const PIECE_NAMES = Object.keys(PIECE_SHAPES);

function normalize(cells) {
    const minC = Math.min(...cells.map((c) => c[0]));
    const minR = Math.min(...cells.map((c) => c[1]));
    return cells.map(([c, r]) => [c - minC, r - minR]);
}

function makePiece(name) {
    return { name, cells: normalize(PIECE_SHAPES[name].map((c) => [c[0], c[1]])) };
}

function drawPieceFromBag() {
    if (!pieceBag.length) {
        const bag = PIECE_NAMES.slice();
        for (let i = bag.length - 1; i > 0; i--) {
            const j = randInt(0, i);
            [bag[i], bag[j]] = [bag[j], bag[i]];
        }
        pieceBag.push(...bag);
    }
    return makePiece(pieceBag.shift());
}

function dealPieces() {
    currentPiece = drawPieceFromBag();
    nextPiece = drawPieceFromBag();
}

function rotatePiece() {
    if (!currentPiece) return;
    currentPiece.cells = normalize(currentPiece.cells.map(([c, r]) => [-r, c]));
}

function canPlacePiece(col, row) {
    if (state !== 'running' || phase !== 'repair' || !currentPiece) return false;
    return currentPiece.cells.every(([dc, dr]) => {
        const c = col + dc;
        const r = row + dr;
        return inBounds(c, r) && terrain[r][c] === LAND && structures[r][c] === EMPTY;
    });
}

function placePiece(col, row) {
    if (!canPlacePiece(col, row)) return false;
    for (const [dc, dr] of currentPiece.cells) {
        structures[row + dr][col + dc] = WALL;
        rubble[row + dr][col + dc] = false;
    }
    currentPiece = nextPiece;
    nextPiece = drawPieceFromBag();
    return true;
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

function beginPlace() {
    phase = 'place';
    phaseTime = PLACE_TIME;
    computeOutside();
    cannonsLeft = 2 + heldCastles();
    currentPiece = null;
    nextPiece = null;
    showBanner(`ROUND ${round} — PLACE CANNONS`);
    updateHud();
}

function beginBattle() {
    phase = 'battle';
    phaseTime = BATTLE_TIME;
    cannonsLeft = 0;
    ships.length = 0;
    shots.length = 0;
    shipTimer = SHIP_FIRST_SPAWN;
    shipsSpawned = 0;
    for (const cannon of cannons) cannon.cool = 0;
    showBanner('BATTLE STATIONS');
    updateHud();
}

function beginRepair() {
    phase = 'repair';
    phaseTime = repairTime(round);
    ships.length = 0;
    shots.length = 0;
    dealPieces();
    showBanner('REPAIR THE WALLS');
    updateHud();
}

// The moment of truth at the end of a repair phase.
function checkpoint() {
    computeOutside();
    const held = heldCastles();
    if (held === 0) {
        gameOver();
        return;
    }
    score += CASTLE_BONUS * held;
    round++;
    beginPlace();
}

function endPhase() {
    if (state !== 'running') return;
    if (phase === 'place') beginBattle();
    else if (phase === 'battle') beginRepair();
    else checkpoint();
}

function gameOver() {
    state = 'over';
    ships.length = 0;
    shots.length = 0;
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('rampart-best', String(best));
        } catch (err) {
            /* private mode — the run just isn't recorded */
        }
    }
    updateHud();
    showOverlay('CASTLE FALLEN', `Score ${score} · Round ${round}`, 'Press Space to besiege again');
}

function startGame() {
    resetBoard();
    state = 'running';
    round = 1;
    score = 0;
    shipsSunk = 0;
    cursor.col = RING.left + 1;
    cursor.row = RING.top + 1;
    beginPlace();
    hideOverlay();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    phaseTime -= dt;

    for (const cannon of cannons) {
        if (cannon.cool > 0) cannon.cool = Math.max(0, cannon.cool - dt);
        if (cannon.recoil > 0) cannon.recoil = Math.max(0, cannon.recoil - dt * 4);
    }

    if (banner.t > 0) banner.t -= dt;
    updateShots(dt);
    updateBlasts(dt);
    if (phase === 'battle') updateFleet(dt);

    if (phaseTime <= 0) endPhase();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawSea(now) {
    ctx.fillStyle = C_SEA;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Deeper water further out, plus slow rolling swell lines.
    const grad = ctx.createLinearGradient(0, 0, SHORE_MAX * CELL, 0);
    grad.addColorStop(0, C_SEA_DEEP);
    grad.addColorStop(1, C_SEA);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SHORE_MAX * CELL, CANVAS_H);

    ctx.strokeStyle = 'rgba(120, 190, 225, 0.16)';
    ctx.lineWidth = 1;
    for (let y = 6; y < CANVAS_H; y += 13) {
        const wobble = Math.sin((y + now * 40) / 26) * 4;
        ctx.beginPath();
        ctx.moveTo(2, y + wobble);
        ctx.lineTo(shore[clamp(Math.floor(y / CELL), 0, ROWS - 1)] * CELL - 4, y + wobble);
        ctx.stroke();
    }
}

function drawLand() {
    for (let r = 0; r < ROWS; r++) {
        const x = shore[r] * CELL;
        ctx.fillStyle = C_LAND;
        ctx.fillRect(x, r * CELL, CANVAS_W - x, CELL);
        // A faint checker keeps the grid readable without banding the field.
        ctx.fillStyle = C_LAND_HI;
        for (let c = shore[r]; c < COLS; c++) {
            if ((c + r) % 2) ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
        }
        // Wet sand at the water's edge.
        ctx.fillStyle = 'rgba(214, 196, 142, 0.5)';
        ctx.fillRect(x, r * CELL, 4, CELL);
        ctx.fillStyle = C_FOAM;
        ctx.fillRect(x - 3, r * CELL + 2, 3, CELL - 4);
    }

    ctx.save();
    for (const d of decor) {
        const col = clamp(Math.floor(d.x / CELL), 0, COLS - 1);
        const row = clamp(Math.floor(d.y / CELL), 0, ROWS - 1);
        if (terrain[row][col] !== LAND) continue;
        ctx.fillStyle = d.shade > 0.5 ? 'rgba(150, 178, 120, 0.35)' : 'rgba(40, 56, 32, 0.45)';
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawWallCell(c, r) {
    const x = c * CELL;
    const y = r * CELL;
    ctx.fillStyle = C_WALL_DARK;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.fillStyle = C_WALL;
    ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 3);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(x + 1, y + CELL / 2 - 1, CELL - 2, 1.5);
    ctx.fillRect(x + CELL / 2 - 1, y + 1, 1.5, CELL / 2 - 2);
    ctx.fillRect(x + CELL / 4, y + CELL / 2, 1.5, CELL / 2 - 2);
}

function drawCastles() {
    for (const castle of castles) {
        const x = castle.col * CELL;
        const y = castle.row * CELL;
        const size = castle.size * CELL;
        const held = isEnclosed(castle);

        ctx.fillStyle = held ? C_CASTLE_DARK : '#6b5a48';
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = held ? C_CASTLE : '#8b7a66';
        ctx.fillRect(x + 3, y + 3, size - 6, size - 6);

        // Battlements along the top.
        ctx.fillStyle = held ? C_CASTLE_DARK : '#6b5a48';
        for (let i = 0; i < castle.size * 2; i++) {
            if (i % 2) continue;
            ctx.fillRect(x + i * (CELL / 2), y, CELL / 2, 6);
        }

        // Keep + banner.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(x + size / 2 - 6, y + size / 2 - 6, 12, 14);
        ctx.fillStyle = held ? '#f2e3a8' : '#5c5147';
        ctx.fillRect(x + size / 2 - 1, y + 8, 2, size / 2 - 8);
        ctx.fillStyle = held ? '#e2584a' : '#6e5b52';
        ctx.beginPath();
        ctx.moveTo(x + size / 2 + 1, y + 9);
        ctx.lineTo(x + size / 2 + 11, y + 13);
        ctx.lineTo(x + size / 2 + 1, y + 17);
        ctx.closePath();
        ctx.fill();
    }
}

// Debris marks every hole the fleet has punched, so the repair phase reads at
// a glance: patch the grey scars and the ring closes again.
function drawRubble() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (!rubble[r][c] || structures[r][c] !== EMPTY) continue;
            const x = c * CELL;
            const y = r * CELL;
            ctx.fillStyle = 'rgba(38, 32, 26, 0.45)';
            ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
            ctx.fillStyle = 'rgba(150, 156, 160, 0.75)';
            ctx.fillRect(x + 4, y + 5, 4, 3);
            ctx.fillRect(x + 11, y + 4, 3, 3);
            ctx.fillRect(x + 6, y + 12, 3, 3);
            ctx.fillRect(x + 12, y + 11, 5, 4);
        }
    }
}

function drawStructures() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (structures[r][c] === WALL) drawWallCell(c, r);
        }
    }
    drawCastles();
    for (const cannon of cannons) drawCannon(cannon);
}

function drawCannon(cannon) {
    const { x, y } = cannonCenter(cannon);
    const kick = cannon.recoil * 3;
    const x0 = cannon.col * CELL;
    const y0 = cannon.row * CELL;

    // Stone emplacement
    ctx.fillStyle = '#6d7680';
    ctx.fillRect(x0 + 1, y0 + 1, CELL * 2 - 2, CELL * 2 - 2);
    ctx.fillStyle = '#878f98';
    ctx.fillRect(x0 + 3, y0 + 3, CELL * 2 - 6, CELL * 2 - 6);
    ctx.fillStyle = 'rgba(40, 46, 52, 0.55)';
    ctx.fillRect(x0 + 3, y0 + CELL - 1, CELL * 2 - 6, 2);
    ctx.fillRect(x0 + CELL - 1, y0 + 3, 2, CELL * 2 - 6);

    // Carriage and barrel, swinging to wherever the gunner last aimed
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(cannon.angle);
    ctx.fillStyle = '#3a2a1e';
    ctx.fillRect(-9 - kick, -4, 12, 8);
    ctx.fillStyle = C_CANNON;
    ctx.fillRect(-4 - kick, -3, 18, 6);
    ctx.fillStyle = '#585f69';
    ctx.fillRect(11 - kick, -3.5, 4, 7);
    ctx.restore();

    ctx.fillStyle = '#20242a';
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7d868f';
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
}

function drawShips() {
    for (const ship of ships) {
        const y = ship.row * CELL + Math.sin(ship.bob) * 1.5;
        const x = ship.x;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.beginPath();
        ctx.ellipse(x + SHIP_W / 2, y + SHIP_H - 1, SHIP_W / 2, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // Hull
        ctx.fillStyle = C_SHIP;
        ctx.beginPath();
        ctx.moveTo(x, y + 5);
        ctx.lineTo(x + SHIP_W, y + 5);
        ctx.lineTo(x + SHIP_W - 6, y + SHIP_H - 2);
        ctx.lineTo(x + 5, y + SHIP_H - 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = C_SHIP_DARK;
        ctx.fillRect(x + 4, y + 8, SHIP_W - 10, 2);

        // Mast + sail, leaning toward the shore.
        ctx.fillStyle = '#2f2118';
        ctx.fillRect(x + SHIP_W / 2 - 1, y - 9, 2, 15);
        ctx.fillStyle = C_SAIL;
        ctx.beginPath();
        ctx.moveTo(x + SHIP_W / 2 + 1, y - 9);
        ctx.lineTo(x + SHIP_W / 2 + 13, y - 1);
        ctx.lineTo(x + SHIP_W / 2 + 1, y + 4);
        ctx.closePath();
        ctx.fill();
    }
}

function drawShots() {
    for (const shot of shots) {
        const k = Math.min(1, shot.t / shot.dur);
        const groundY = shot.y0 + (shot.ty - shot.y0) * k;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.ellipse(shot.x, groundY, 4, 2, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = shot.side === 'player' ? '#f4f0e6' : '#2a2320';
        ctx.beginPath();
        ctx.arc(shot.x, shot.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBlasts() {
    for (const blast of blasts) {
        const k = blast.t / blast.life;
        const radius = BLAST_R * (0.4 + k);
        ctx.strokeStyle = `rgba(255, ${blast.side === 'player' ? 210 : 150}, 90, ${1 - k})`;
        ctx.lineWidth = 3 * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(blast.x, blast.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(255, 236, 190, ${0.5 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(blast.x, blast.y, radius * 0.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawTerritoryTint() {
    ctx.fillStyle = 'rgba(120, 220, 160, 0.10)';
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (!outside[r][c] && terrain[r][c] === LAND && structures[r][c] === EMPTY) {
                ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
            }
        }
    }
}

function drawCursor() {
    if (state !== 'running') return;

    if (phase === 'place') {
        const ok = canPlaceCannon(cursor.col, cursor.row);
        ctx.fillStyle = ok ? 'rgba(120, 230, 150, 0.35)' : 'rgba(230, 100, 90, 0.3)';
        ctx.fillRect(cursor.col * CELL, cursor.row * CELL, CELL * 2, CELL * 2);
        ctx.strokeStyle = ok ? '#7ce696' : '#e2584a';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cursor.col * CELL + 0.5, cursor.row * CELL + 0.5, CELL * 2 - 1, CELL * 2 - 1);
        return;
    }

    if (phase === 'repair' && currentPiece) {
        const ok = canPlacePiece(cursor.col, cursor.row);
        ctx.fillStyle = ok ? 'rgba(200, 220, 235, 0.55)' : 'rgba(230, 100, 90, 0.35)';
        for (const [dc, dr] of currentPiece.cells) {
            ctx.fillRect((cursor.col + dc) * CELL + 1, (cursor.row + dr) * CELL + 1, CELL - 2, CELL - 2);
        }
        return;
    }

    // Battle: a gunner's crosshair.
    const x = cellCenter(cursor.col);
    const y = cellCenter(cursor.row);
    ctx.strokeStyle = 'rgba(255, 220, 140, 0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.moveTo(x - 13, y);
    ctx.lineTo(x + 13, y);
    ctx.moveTo(x, y - 13);
    ctx.lineTo(x, y + 13);
    ctx.stroke();
}

function drawNextPiece() {
    if (phase !== 'repair' || !nextPiece) return;
    const boxW = 76;
    const boxH = 54;
    const x = CANVAS_W - boxW - 8;
    const y = 8;
    ctx.fillStyle = 'rgba(8, 18, 28, 0.78)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = 'rgba(160, 190, 215, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);
    ctx.fillStyle = '#9db6c9';
    ctx.font = '9px "Segoe UI", sans-serif';
    ctx.fillText('NEXT', x + 6, y + 12);

    const w = Math.max(...nextPiece.cells.map((c) => c[0])) + 1;
    const h = Math.max(...nextPiece.cells.map((c) => c[1])) + 1;
    const size = 9;
    const ox = x + boxW / 2 - (w * size) / 2;
    const oy = y + 18 + (30 - h * size) / 2;
    ctx.fillStyle = C_WALL;
    for (const [dc, dr] of nextPiece.cells) {
        ctx.fillRect(ox + dc * size, oy + dr * size, size - 1, size - 1);
    }
}

// A short banner announces each phase, so the switch is never a surprise.
let banner = { text: '', t: 0 };

function showBanner(text) {
    banner = { text, t: 1.4 };
}

function drawBanner() {
    if (banner.t <= 0) return;
    const fade = Math.min(1, banner.t / 0.6);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(6, 14, 22, 0.72)';
    ctx.fillRect(0, CANVAS_H / 2 - 26, CANVAS_W, 52);
    ctx.fillStyle = '#f0c04a';
    ctx.font = 'bold 26px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, CANVAS_W / 2, CANVAS_H / 2);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

let drawClock = 0;

function draw() {
    drawClock += 1 / 60;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawSea(drawClock);
    drawLand();
    if (state === 'running' && phase === 'place') drawTerritoryTint();
    drawRubble();
    drawStructures();
    drawShips();
    drawShots();
    drawBlasts();
    drawCursor();
    drawNextPiece();
    drawBanner();
    updateHud();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

const PHASE_LABEL = {
    place: 'Place Cannons',
    battle: 'Battle!',
    repair: 'Repair Walls',
};

function updateHud() {
    scoreEl.textContent = String(score);
    roundEl.textContent = String(round);
    phaseEl.textContent = PHASE_LABEL[phase];
    timerEl.textContent = String(Math.max(0, Math.round(phaseTime)));
    cannonsEl.textContent = String(cannonsLeft);
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

function act(px, py) {
    if (state !== 'running') return;
    if (phase === 'place') placeCannon(cursor.col, cursor.row);
    else if (phase === 'battle') fireAt(px, py);
    else placePiece(cursor.col, cursor.row);
}

function moveCursor(dc, dr) {
    cursor.col = clamp(cursor.col + dc, 0, COLS - 1);
    cursor.row = clamp(cursor.row + dr, 0, ROWS - 1);
}

window.addEventListener('keydown', (e) => {
    const key = e.key;

    if (key === 'p' || key === 'P') {
        togglePause();
        return;
    }
    if (key === 'r' || key === 'R') {
        rotatePiece();
        return;
    }
    if (key === ' ' || e.code === 'Space' || key === 'Enter') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'paused') togglePause();
        else act(cellCenter(cursor.col), cellCenter(cursor.row));
        return;
    }
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') { moveCursor(-1, 0); e.preventDefault(); }
    else if (key === 'ArrowRight' || key === 'd' || key === 'D') { moveCursor(1, 0); e.preventDefault(); }
    else if (key === 'ArrowUp' || key === 'w' || key === 'W') { moveCursor(0, -1); e.preventDefault(); }
    else if (key === 'ArrowDown' || key === 's' || key === 'S') { moveCursor(0, 1); e.preventDefault(); }
});

// The canvas can be scaled down by CSS on small screens, so map through the
// element's rendered size rather than assuming one pixel per pixel.
function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
        y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    };
}

canvas.addEventListener('mousemove', (e) => {
    const { x, y } = canvasPoint(e);
    cursor.col = clamp(Math.floor(x / CELL), 0, COLS - 1);
    cursor.row = clamp(Math.floor(y / CELL), 0, ROWS - 1);
});

canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const { x, y } = canvasPoint(e);
    cursor.col = clamp(Math.floor(x / CELL), 0, COLS - 1);
    cursor.row = clamp(Math.floor(y / CELL), 0, ROWS - 1);
    if (state === 'idle' || state === 'over') return;
    act(x, y);
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    rotatePiece();
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

best = parseInt(localStorage.getItem('rampart-best') || '0', 10) || 0;
resetBoard();
state = 'idle';
phase = 'place';
phaseTime = PLACE_TIME;
round = 1;
score = 0;
cannonsLeft = 0;
updateHud();
showOverlay('RAMPART', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
