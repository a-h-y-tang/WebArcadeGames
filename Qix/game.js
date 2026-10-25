// Qix — claim the field by drawing boxes while the Qix, the Sparx and your own
// burning fuse try to stop you.
//
// Two coordinate systems do all the work: CELLS (60x60, 10px each, one byte of
// `claimed` apiece) and the LATTICE POINTS between them, which is where the
// marker, the Sparx and every stix vertex live. A lattice edge is flanked by
// exactly two cells and that pair decides what may happen on it — see
// DESIGN.md.
//
// The simulation runs on a fixed timestep through stepGame(), and the
// interesting state (state, player, stix, claimed, qix, sparx, fuse) is kept at
// the top level on purpose: the Playwright suite drives the game through
// exactly these names.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const CELL = 10;
const GRID_W = 60;
const GRID_H = 60;
const TOTAL_CELLS = GRID_W * GRID_H;
const W = canvas.width;              // 600
const H = canvas.height;             // 600
const DT = 1 / 120;                  // fixed simulation timestep, seconds

const TARGET_PERCENT = 75;           // claimed share that clears a level
const POINTS_PER_CELL = 10;
const LEVEL_BONUS = 1000;
const START_LIVES = 3;

const BOUNDARY_SPEED = 16;           // lattice cells per second
const DRAW_FAST = 16;                // drawing at x1 points
const DRAW_SLOW = 8;                 // drawing at x2 points

const FUSE_DELAY = 0.35;             // seconds of standing still before it lights
const FUSE_SPEED = 6;                // cells per second along the stix
const FUSE_BITE = 0.35;              // cells of reach when it catches up

const QIX_LEN = 56;                  // px, the longest the creature stretches
const QIX_MIN = QIX_LEN * 0.35;
const QIX_BASE_SPEED = 70;           // px/s at level 1
const QIX_LEVEL_SPEED = 8;           // px/s added per level
const QIX_TRAIL = 28;                // remembered segments, cosmetic only

const SPARX_BASE = 2;                // at level 1
const SPARX_MAX = 5;
const SPARX_SPEED = 11;              // cells per second
const SPARX_TOUCH = 0.7;             // cells of reach
const SPARX_STRAIGHT = 0.75;         // chance of ignoring the marker at a junction

const BEST_KEY = 'qix-best';

const COL = {
    claimed: '#16305c',
    claimedEdge: '#2a5fa8',
    frame: '#3b82f6',
    stix: '#22d3ee',
    marker: '#f8fafc',
    qix: '#f472b6',
    sparx: '#fbbf24',
    fuse: '#fb7185',
};

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | levelclear | gameover
let score = 0;
let level = 1;
let lives = START_LIVES;
let best = loadBest();
let claimed = new Uint8Array(TOTAL_CELLS);
let claimedCells = 0;
let stix = [];                       // lattice points of the line being drawn
let drawing = false;
let drawSlow = false;                // Shift held: half speed, double points
let drawMultiplier = 1;              // captured when a line starts
let autoRun = true;                  // the animation loop only simulates while true
let deathFlash = 0;                  // seconds of screen flash left, cosmetic
let claimFlash = [];                 // { cells, life } highlights, cosmetic

const player = { px: 0, py: 0, dirx: 0, diry: 0, t: 0, moving: false };
// A rigid segment: centre, heading, spin, breathing length, plus the two
// endpoints kept in sync for collision tests and drawing.
const qix = {
    x: 0, y: 0, vx: 0, vy: 0,
    angle: 0, spin: 0, len: QIX_LEN, phase: 0, breath: 0,
    p1: { x: 0, y: 0 },
    p2: { x: 0, y: 0 },
    trail: [],
};
const sparx = [];
const fuse = { active: false, idx: 0, t: 0, idle: 0 };

const keys = Object.create(null);
const dirStack = [];                 // direction key codes, most recent last

// A seeded generator so a level plays out the same way twice.
let rngState = 20251024;
function rand() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
}

// --- the grid --------------------------------------------------------------

function inGrid(cx, cy) {
    return cx >= 0 && cy >= 0 && cx < GRID_W && cy < GRID_H;
}

// Everything outside the grid counts as claimed, which removes the bounds
// checks from movement, flood filling and the Qix's bounces.
function isClaimed(cx, cy) {
    return !inGrid(cx, cy) || claimed[cy * GRID_W + cx] === 1;
}

function setClaimed(cx, cy, value) {
    if (inGrid(cx, cy)) claimed[cy * GRID_W + cx] = value ? 1 : 0;
}

function recountClaimed() {
    let n = 0;
    for (let i = 0; i < TOTAL_CELLS; i++) if (claimed[i] === 1) n++;
    claimedCells = n;
    return n;
}

function claimedPercent() {
    return (claimedCells / TOTAL_CELLS) * 100;
}

function cellOf(point) {
    return { cx: Math.floor(point.x / CELL), cy: Math.floor(point.y / CELL) };
}

function cellOpenAt(x, y) {
    return !isClaimed(Math.floor(x / CELL), Math.floor(y / CELL));
}

// The two cells either side of the lattice edge leaving (px, py) in (dx, dy).
function flankCells(px, py, dx, dy) {
    if (dx !== 0) {
        const x = Math.min(px, px + dx);
        return [[x, py - 1], [x, py]];
    }
    const y = Math.min(py, py + dy);
    return [[px - 1, y], [px, y]];
}

function flankClaimed(px, py, dx, dy) {
    const [a, b] = flankCells(px, py, dx, dy);
    return [isClaimed(a[0], a[1]), isClaimed(b[0], b[1])];
}

// A lattice point sits on the edge of our territory when any cell around it is
// claimed. Arriving at one while drawing closes the loop.
function isBoundaryPoint(px, py) {
    return (
        isClaimed(px - 1, py - 1) ||
        isClaimed(px, py - 1) ||
        isClaimed(px - 1, py) ||
        isClaimed(px, py)
    );
}

// An edge with claimed ground on exactly one side: walkable, and the only kind
// of edge a Sparx ever travels.
function isBorderEdge(px, py, dx, dy) {
    const nx = px + dx;
    const ny = py + dy;
    if (nx < 0 || ny < 0 || nx > GRID_W || ny > GRID_H) return false;
    const [a, b] = flankClaimed(px, py, dx, dy);
    return a !== b;
}

function hasBorderEdge(px, py) {
    return DIRS.some(([dx, dy]) => isBorderEdge(px, py, dx, dy));
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// --- the marker ------------------------------------------------------------

function stixHas(x, y) {
    return stix.some((p) => p.x === x && p.y === y);
}

// Would leaving in this direction put the marker into open space, i.e. begin a
// line? False on a boundary walk, which is why a frame corner cannot be used to
// start one.
function startsLine(dx, dy) {
    const [a, b] = flankClaimed(player.px, player.py, dx, dy);
    return !a && !b;
}

function canMove(dx, dy) {
    const nx = player.px + dx;
    const ny = player.py + dy;
    if (nx < 0 || ny < 0 || nx > GRID_W || ny > GRID_H) return false;
    const [a, b] = flankClaimed(player.px, player.py, dx, dy);
    if (a && b) return false;                   // solid ground, never passable
    if (drawing) {
        if (stixHas(nx, ny)) return false;      // no crossing or doubling back
        return !a && !b;                        // a line only runs through open space
    }
    return true;                                // boundary walk, or a new line
}

function beginMove(dx, dy) {
    if (!canMove(dx, dy)) return false;
    if (!drawing && startsLine(dx, dy)) {
        drawing = true;
        stix = [{ x: player.px, y: player.py }];
        drawMultiplier = drawSlow ? 2 : 1;
        resetFuse();
    }
    player.dirx = dx;
    player.diry = dy;
    player.t = 0;
    player.moving = true;
    return true;
}

// Land on the lattice point the marker was heading for.
function arrive() {
    player.px += player.dirx;
    player.py += player.diry;
    player.t = 0;
    player.moving = false;
    if (drawing) {
        stix.push({ x: player.px, y: player.py });
        if (isBoundaryPoint(player.px, player.py)) closeLoop();
    }
}

// One instantaneous lattice step. The tests drive the marker with this.
function tryStep(dx, dy) {
    if (!beginMove(dx, dy)) return false;
    arrive();
    return true;
}

function setPlayerAt(px, py) {
    player.px = px;
    player.py = py;
    player.dirx = 0;
    player.diry = 0;
    player.t = 0;
    player.moving = false;
    drawing = false;
    stix = [];
    resetFuse();
}

function playerLattice() {
    return { x: player.px + player.dirx * player.t, y: player.py + player.diry * player.t };
}

function playerPos() {
    const l = playerLattice();
    return { x: l.x * CELL, y: l.y * CELL };
}

// The boundary point furthest from every Sparx, used on respawn and whenever a
// claim fills in the ground the marker was standing on.
function findSafePoint() {
    let bestPoint = { px: 1, py: 1 };
    let bestScore = -1;
    for (let py = 0; py <= GRID_H; py++) {
        for (let px = 0; px <= GRID_W; px++) {
            if (!hasBorderEdge(px, py)) continue;
            let near = Infinity;
            for (const s of sparx) near = Math.min(near, Math.hypot(s.px - px, s.py - py));
            if (near === Infinity) near = GRID_W + GRID_H;
            if (near > bestScore) {
                bestScore = near;
                bestPoint = { px, py };
            }
        }
    }
    return bestPoint;
}

function ensurePlayerFree() {
    if (hasBorderEdge(player.px, player.py)) return;
    const p = findSafePoint();
    setPlayerAt(p.px, p.py);
}

// --- claiming --------------------------------------------------------------

// Key for the lattice edge between two neighbouring cells, used to make the
// stix a wall that the flood fill cannot step through.
function edgeKeyBetween(cx, cy, nx, ny) {
    if (cy === ny) return 'v:' + Math.max(cx, nx) + ',' + cy;
    return 'h:' + cx + ',' + Math.max(cy, ny);
}

function stixEdgeKeys() {
    const keysOut = new Set();
    for (let i = 0; i < stix.length - 1; i++) {
        const a = stix[i];
        const b = stix[i + 1];
        if (a.y === b.y) keysOut.add('h:' + Math.min(a.x, b.x) + ',' + a.y);
        else keysOut.add('v:' + a.x + ',' + Math.min(a.y, b.y));
    }
    return keysOut;
}

// Flood fill the open cells with the stix acting as a wall, then claim every
// region that does not hold the Qix.
function closeLoop() {
    const walls = stixEdgeKeys();
    const seen = new Int8Array(TOTAL_CELLS);
    const spared = new Set();
    for (const p of [qix.p1, qix.p2, { x: (qix.p1.x + qix.p2.x) / 2, y: (qix.p1.y + qix.p2.y) / 2 }]) {
        const c = cellOf(p);
        if (inGrid(c.cx, c.cy)) spared.add(c.cy * GRID_W + c.cx);
    }

    let gained = 0;
    const gainedCells = [];
    for (let start = 0; start < TOTAL_CELLS; start++) {
        if (seen[start] || claimed[start] === 1) continue;
        const region = [];
        const queue = [start];
        seen[start] = 1;
        let holdsQix = false;
        while (queue.length) {
            const at = queue.pop();
            region.push(at);
            if (spared.has(at)) holdsQix = true;
            const cx = at % GRID_W;
            const cy = (at - cx) / GRID_W;
            for (const [dx, dy] of DIRS) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (!inGrid(nx, ny)) continue;
                const ni = ny * GRID_W + nx;
                if (seen[ni] || claimed[ni] === 1) continue;
                if (walls.has(edgeKeyBetween(cx, cy, nx, ny))) continue;
                seen[ni] = 1;
                queue.push(ni);
            }
        }
        if (!holdsQix) {
            for (const i of region) claimed[i] = 1;
            gained += region.length;
            gainedCells.push(...region);
        }
    }

    stix = [];
    drawing = false;
    resetFuse();

    if (gained > 0) {
        claimedCells += gained;
        score += gained * POINTS_PER_CELL * drawMultiplier;
        claimFlash.push({ cells: gainedCells, life: 0.45 });
    }
    ensurePlayerFree();

    if (claimedPercent() >= TARGET_PERCENT) {
        score += LEVEL_BONUS;
        state = 'levelclear';
        showOverlay('LEVEL ' + level + ' CLEAR', 'Score ' + score, 'Press Space for level ' + (level + 1));
    }
    updateHud();
}

// --- the Qix ---------------------------------------------------------------

// The creature is a rigid segment: a drifting centre, a spin and a breathing
// length. Keeping it rigid means a single test — are both ends on open ground? —
// decides whether a frame is allowed, so it can never end up inside claimed
// territory and can never stretch past QIX_LEN.

function qixSpeed() {
    return QIX_BASE_SPEED + (level - 1) * QIX_LEVEL_SPEED;
}

function qixEnd(cx, cy, angle, len, side) {
    return { x: cx + Math.cos(angle) * len * 0.5 * side, y: cy + Math.sin(angle) * len * 0.5 * side };
}

function syncQixEnds() {
    const a = qixEnd(qix.x, qix.y, qix.angle, qix.len, -1);
    const b = qixEnd(qix.x, qix.y, qix.angle, qix.len, 1);
    qix.p1.x = a.x;
    qix.p1.y = a.y;
    qix.p2.x = b.x;
    qix.p2.y = b.y;
}

function endsOpen(cx, cy, angle, len) {
    const a = qixEnd(cx, cy, angle, len, -1);
    const b = qixEnd(cx, cy, angle, len, 1);
    return cellOpenAt(a.x, a.y) && cellOpenAt(b.x, b.y);
}

// Place the creature across two points and leave it completely still, which is
// what the tests use to put it somewhere known.
function setQix(x1, y1, x2, y2) {
    qix.x = (x1 + x2) / 2;
    qix.y = (y1 + y2) / 2;
    qix.len = Math.hypot(x2 - x1, y2 - y1);
    qix.angle = Math.atan2(y2 - y1, x2 - x1);
    qix.vx = 0;
    qix.vy = 0;
    qix.spin = 0;
    qix.breath = 0;
    qix.phase = 0;
    qix.trail.length = 0;
    syncQixEnds();
}

function stepQix(dt) {
    let len = qix.len;
    if (qix.breath !== 0) {
        qix.phase += qix.breath * dt;
        len = QIX_MIN + (QIX_LEN - QIX_MIN) * (0.5 + 0.5 * Math.sin(qix.phase));
    }
    const nx = qix.x + qix.vx * dt;
    const ny = qix.y + qix.vy * dt;
    const na = qix.angle + qix.spin * dt;

    if (endsOpen(nx, ny, na, len)) {
        qix.x = nx;
        qix.y = ny;
        qix.angle = na;
        qix.len = len;
    } else if (endsOpen(nx, ny, qix.angle, qix.len)) {
        qix.x = nx;                     // the drift is fine, the turn was not
        qix.y = ny;
    } else {
        // Turn back the way it came with a small random kick, so it never
        // settles into an orbit and never grinds against a wall.
        const speed = Math.hypot(qix.vx, qix.vy) || qixSpeed();
        const away = Math.atan2(qix.y - ny, qix.x - nx) + (rand() - 0.5) * 1.2;
        qix.vx = Math.cos(away) * speed;
        qix.vy = Math.sin(away) * speed;
        qix.spin = -qix.spin;
    }

    syncQixEnds();
    qix.trail.push({ x1: qix.p1.x, y1: qix.p1.y, x2: qix.p2.x, y2: qix.p2.y });
    if (qix.trail.length > QIX_TRAIL) qix.trail.shift();
}

function orient(a, b, c) {
    return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function onSegment(a, b, c) {
    return (
        Math.min(a.x, b.x) - 0.0001 <= c.x && c.x <= Math.max(a.x, b.x) + 0.0001 &&
        Math.min(a.y, b.y) - 0.0001 <= c.y && c.y <= Math.max(a.y, b.y) + 0.0001
    );
}

function segIntersect(a, b, c, d) {
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    if (o1 !== o2 && o3 !== o4) return true;
    return (
        (o1 === 0 && onSegment(a, b, c)) ||
        (o2 === 0 && onSegment(a, b, d)) ||
        (o3 === 0 && onSegment(c, d, a)) ||
        (o4 === 0 && onSegment(c, d, b))
    );
}

// Pixel-space points of the line being drawn, including the part under the
// marker as it moves.
function stixPixels() {
    const pts = stix.map((p) => ({ x: p.x * CELL, y: p.y * CELL }));
    if (player.moving) pts.push(playerPos());
    return pts;
}

function qixHitsStix() {
    if (!drawing || stix.length === 0) return false;
    const pts = stixPixels();
    for (let i = 0; i < pts.length - 1; i++) {
        if (segIntersect(qix.p1, qix.p2, pts[i], pts[i + 1])) return true;
    }
    // A stationary marker is a zero-length segment, so check the point itself.
    return pointNearSegment(playerPos(), qix.p1, qix.p2) < CELL * 0.5;
}

function pointNearSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

// --- Sparx -----------------------------------------------------------------

function makeSparx(px, py, dirx, diry) {
    return { px, py, dirx, diry, t: 0, speed: SPARX_SPEED };
}

function sparxLattice(s) {
    return { x: s.px + s.dirx * s.t, y: s.py + s.diry * s.t };
}

function sparxPos(s) {
    const l = sparxLattice(s);
    return { x: l.x * CELL, y: l.y * CELL };
}

// Pick the next edge at a lattice point: keep going straight most of the time,
// otherwise close on the marker. Claiming land rewrites the boundary under a
// Sparx's feet, so a stranded one is moved somewhere legal.
function steerSparx(s) {
    const open = DIRS.filter(([dx, dy]) => isBorderEdge(s.px, s.py, dx, dy));
    let choices = open.filter(([dx, dy]) => !(dx === -s.dirx && dy === -s.diry));
    if (!choices.length) choices = open;
    if (!choices.length) {
        const p = findSafePoint();
        s.px = p.px;
        s.py = p.py;
        s.t = 0;
        const first = DIRS.find(([dx, dy]) => isBorderEdge(s.px, s.py, dx, dy)) || [0, 0];
        s.dirx = first[0];
        s.diry = first[1];
        return;
    }
    const straight = choices.find(([dx, dy]) => dx === s.dirx && dy === s.diry);
    let pick;
    if (straight && rand() < SPARX_STRAIGHT) {
        pick = straight;
    } else {
        const goal = playerLattice();
        pick = choices[0];
        let bestDist = Infinity;
        for (const [dx, dy] of choices) {
            const d = Math.hypot(s.px + dx - goal.x, s.py + dy - goal.y);
            if (d < bestDist) {
                bestDist = d;
                pick = [dx, dy];
            }
        }
    }
    s.dirx = pick[0];
    s.diry = pick[1];
}

function stepSparx(s, dt) {
    if (!isBorderEdge(s.px, s.py, s.dirx, s.diry)) {
        s.t = 0;
        steerSparx(s);
        if (!isBorderEdge(s.px, s.py, s.dirx, s.diry)) return;
    }
    s.t += s.speed * dt;
    while (s.t >= 1) {
        s.t -= 1;
        s.px += s.dirx;
        s.py += s.diry;
        steerSparx(s);
        if (!isBorderEdge(s.px, s.py, s.dirx, s.diry)) {
            s.t = 0;
            break;
        }
    }
}

function sparxTouchesPlayer() {
    const p = playerLattice();
    return sparx.some((s) => {
        const l = sparxLattice(s);
        return Math.hypot(l.x - p.x, l.y - p.y) <= SPARX_TOUCH;
    });
}

// --- the fuse --------------------------------------------------------------

function resetFuse() {
    fuse.active = false;
    fuse.idx = 0;
    fuse.t = 0;
    fuse.idle = 0;
}

function fuseLattice() {
    if (!stix.length) return playerLattice();
    if (fuse.idx >= stix.length - 1) {
        const a = stix[stix.length - 1];
        const b = playerLattice();
        const k = Math.min(1, fuse.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    const a = stix[fuse.idx];
    const b = stix[fuse.idx + 1];
    return { x: a.x + (b.x - a.x) * fuse.t, y: a.y + (b.y - a.y) * fuse.t };
}

function stepFuse(dt) {
    if (!drawing) {
        resetFuse();
        return false;
    }
    if (player.moving) {
        fuse.idle = 0;
        return false;
    }
    fuse.idle += dt;
    if (!fuse.active) {
        if (fuse.idle < FUSE_DELAY) return false;
        fuse.active = true;
    }
    fuse.t += FUSE_SPEED * dt;
    while (fuse.t >= 1 && fuse.idx < stix.length - 1) {
        fuse.t -= 1;
        fuse.idx++;
    }
    if (fuse.idx >= stix.length - 1 && fuse.t >= 1) return true;
    const f = fuseLattice();
    const p = playerLattice();
    return Math.hypot(f.x - p.x, f.y - p.y) <= FUSE_BITE;
}

// --- level life cycle ------------------------------------------------------

const SPARX_SPAWNS = [
    [1, 1, 1, 0],
    [GRID_W - 1, GRID_H - 1, -1, 0],
    [GRID_W - 1, 1, 0, 1],
    [1, GRID_H - 1, 0, -1],
    [1, Math.floor(GRID_H / 2), 0, 1],
];

function resetLevel() {
    claimed = new Uint8Array(TOTAL_CELLS);
    for (let x = 0; x < GRID_W; x++) {
        for (let y = 0; y < GRID_H; y++) {
            if (x === 0 || y === 0 || x === GRID_W - 1 || y === GRID_H - 1) setClaimed(x, y, true);
        }
    }
    recountClaimed();

    setPlayerAt(Math.floor(GRID_W / 2), 1);
    drawSlow = false;
    drawMultiplier = 1;
    claimFlash = [];
    deathFlash = 0;

    const cx = (GRID_W / 2) * CELL;
    const cy = (GRID_H / 2) * CELL;
    setQix(cx - QIX_LEN / 2, cy, cx + QIX_LEN / 2, cy);
    const heading = rand() * Math.PI * 2;
    qix.vx = Math.cos(heading) * qixSpeed();
    qix.vy = Math.sin(heading) * qixSpeed();
    qix.spin = (rand() < 0.5 ? -1 : 1) * 1.4;
    qix.breath = 0.9;
    qix.phase = rand() * Math.PI * 2;

    sparx.length = 0;
    const count = Math.min(SPARX_BASE + level - 1, SPARX_MAX);
    for (let i = 0; i < count; i++) {
        const [px, py, dx, dy] = SPARX_SPAWNS[i % SPARX_SPAWNS.length];
        sparx.push(makeSparx(px, py, dx, dy));
    }
    updateHud();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    resetLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level++;
    resetLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

function killPlayer() {
    lives--;
    drawing = false;
    stix = [];
    resetFuse();
    deathFlash = 0.5;
    if (lives <= 0) {
        lives = 0;
        state = 'gameover';
        saveBest();
        showOverlay('GAME OVER', 'Score ' + score + '  ·  Best ' + best, 'Press Space to play again');
    } else {
        const p = findSafePoint();
        setPlayerAt(p.px, p.py);
    }
    updateHud();
}

function advance() {
    if (state === 'idle' || state === 'gameover') startGame();
    else if (state === 'levelclear') nextLevel();
    else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to carry on');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// --- the simulation --------------------------------------------------------

function inputDir() {
    for (let i = dirStack.length - 1; i >= 0; i--) {
        const dir = DIR_KEYS[dirStack[i]];
        if (dir) return dir;
    }
    return null;
}

function stepPlayer(dt) {
    drawSlow = !!(keys.ShiftLeft || keys.ShiftRight || keys.KeyZ);
    const held = inputDir();
    if (!player.moving && held) beginMove(held[0], held[1]);
    if (!player.moving) return;

    const speed = drawing ? (drawSlow ? DRAW_SLOW : DRAW_FAST) : BOUNDARY_SPEED;
    player.t += speed * dt;
    while (player.moving && player.t >= 1) {
        const carry = player.t - 1;
        arrive();
        const next = inputDir();
        if (state !== 'running' || !next || !beginMove(next[0], next[1])) break;
        player.t = carry;
    }
}

function stepGame(dt) {
    if (state !== 'running') return;

    stepPlayer(dt);
    if (state !== 'running') return;

    if (stepFuse(dt)) {
        killPlayer();
        return;
    }

    stepQix(dt);
    if (qixHitsStix()) {
        killPlayer();
        return;
    }

    for (const s of sparx) stepSparx(s, dt);
    if (sparxTouchesPlayer()) {
        killPlayer();
        return;
    }

    for (const f of claimFlash) f.life -= dt;
    claimFlash = claimFlash.filter((f) => f.life > 0);
    if (deathFlash > 0) deathFlash = Math.max(0, deathFlash - dt);
    updateHud();
}

// --- HUD and overlay -------------------------------------------------------

const el = {
    score: document.getElementById('score'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    claimed: document.getElementById('claimed'),
    best: document.getElementById('best'),
    overlay: document.getElementById('overlay'),
    title: document.getElementById('overlay-title'),
    sub: document.getElementById('overlay-sub'),
    final: document.getElementById('overlay-score'),
};

function loadBest() {
    try {
        return parseInt(window.localStorage.getItem(BEST_KEY), 10) || 0;
    } catch (err) {
        return 0;
    }
}

function saveBest() {
    if (score <= best) return;
    best = score;
    try {
        window.localStorage.setItem(BEST_KEY, String(best));
    } catch (err) {
        /* storage is unavailable; the run just will not be remembered */
    }
}

function updateHud() {
    el.score.textContent = String(score);
    el.level.textContent = String(level);
    el.lives.textContent = String(lives);
    el.claimed.textContent = Math.floor(claimedPercent()) + '%';
    el.best.textContent = String(best);
}

function showOverlay(title, finalLine, sub) {
    el.title.textContent = title;
    el.final.textContent = finalLine;
    el.sub.textContent = sub;
    el.overlay.classList.add('visible');
}

function hideOverlay() {
    el.overlay.classList.remove('visible');
}

// --- input -----------------------------------------------------------------

const DIR_KEYS = {
    ArrowLeft: [-1, 0],
    KeyA: [-1, 0],
    ArrowRight: [1, 0],
    KeyD: [1, 0],
    ArrowUp: [0, -1],
    KeyW: [0, -1],
    ArrowDown: [0, 1],
    KeyS: [0, 1],
};

window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (DIR_KEYS[e.code]) {
        if (!dirStack.includes(e.code)) dirStack.push(e.code);
        e.preventDefault();
    }
    if (e.code === 'Space' || e.code === 'Enter') {
        advance();
        e.preventDefault();
    }
    if (e.code === 'KeyP') togglePause();
});

window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    const at = dirStack.indexOf(e.code);
    if (at >= 0) dirStack.splice(at, 1);
});

canvas.addEventListener('click', () => advance());
el.overlay.addEventListener('click', () => advance());
document.getElementById('btn-start').addEventListener('click', () => advance());

// --- drawing ---------------------------------------------------------------

function drawClaimed() {
    ctx.fillStyle = COL.claimed;
    ctx.beginPath();
    for (let cy = 0; cy < GRID_H; cy++) {
        for (let cx = 0; cx < GRID_W; cx++) {
            if (claimed[cy * GRID_W + cx] === 1) ctx.rect(cx * CELL, cy * CELL, CELL, CELL);
        }
    }
    ctx.fill();

    // Outline the claimed region by stroking only the edges that face open
    // ground, which reads as the taut boundary the marker walks.
    ctx.strokeStyle = COL.claimedEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let cy = 0; cy < GRID_H; cy++) {
        for (let cx = 0; cx < GRID_W; cx++) {
            if (claimed[cy * GRID_W + cx] !== 1) continue;
            if (!isClaimed(cx, cy - 1)) {
                ctx.moveTo(cx * CELL, cy * CELL);
                ctx.lineTo((cx + 1) * CELL, cy * CELL);
            }
            if (!isClaimed(cx, cy + 1)) {
                ctx.moveTo(cx * CELL, (cy + 1) * CELL);
                ctx.lineTo((cx + 1) * CELL, (cy + 1) * CELL);
            }
            if (!isClaimed(cx - 1, cy)) {
                ctx.moveTo(cx * CELL, cy * CELL);
                ctx.lineTo(cx * CELL, (cy + 1) * CELL);
            }
            if (!isClaimed(cx + 1, cy)) {
                ctx.moveTo((cx + 1) * CELL, cy * CELL);
                ctx.lineTo((cx + 1) * CELL, (cy + 1) * CELL);
            }
        }
    }
    ctx.stroke();
}

function drawFlashes() {
    for (const f of claimFlash) {
        ctx.fillStyle = 'rgba(34, 211, 238, ' + (f.life / 0.45) * 0.35 + ')';
        ctx.beginPath();
        for (const i of f.cells) {
            const cx = i % GRID_W;
            const cy = (i - cx) / GRID_W;
            ctx.rect(cx * CELL, cy * CELL, CELL, CELL);
        }
        ctx.fill();
    }
}

function drawStix() {
    if (!stix.length) return;
    const pts = stix.map((p) => ({ x: p.x * CELL, y: p.y * CELL }));
    pts.push(playerPos());
    ctx.strokeStyle = COL.stix;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.shadowColor = COL.stix;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.shadowBlur = 0;
}

function drawQix() {
    for (let i = 0; i < qix.trail.length; i++) {
        const seg = qix.trail[i];
        const k = (i + 1) / qix.trail.length;
        ctx.strokeStyle = 'rgba(244, 114, 182, ' + (0.08 + k * 0.5) + ')';
        ctx.lineWidth = 1 + k * 2;
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();
    }
    ctx.strokeStyle = COL.qix;
    ctx.lineWidth = 3;
    ctx.shadowColor = COL.qix;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(qix.p1.x, qix.p1.y);
    ctx.lineTo(qix.p2.x, qix.p2.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
}

function drawSparx() {
    for (const s of sparx) {
        const p = sparxPos(s);
        ctx.fillStyle = COL.sparx;
        ctx.shadowColor = COL.sparx;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = COL.sparx;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            const a = (Math.PI / 2) * i + 0.4;
            ctx.moveTo(p.x + Math.cos(a) * 4, p.y + Math.sin(a) * 4);
            ctx.lineTo(p.x + Math.cos(a) * 7, p.y + Math.sin(a) * 7);
        }
        ctx.stroke();
    }
}

function drawFuse() {
    if (!fuse.active || !drawing) return;
    const l = fuseLattice();
    const x = l.x * CELL;
    const y = l.y * CELL;
    ctx.fillStyle = COL.fuse;
    ctx.shadowColor = COL.fuse;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
}

function drawMarker() {
    const p = playerPos();
    ctx.fillStyle = drawing ? COL.stix : COL.marker;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 5);
    ctx.lineTo(p.x + 5, p.y);
    ctx.lineTo(p.x, p.y + 5);
    ctx.lineTo(p.x - 5, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
}

// A slim gauge set into the top wall: how much of the field is yours, with a
// tick at the share that clears the level.
function drawProgress() {
    const x0 = CELL;
    const span = W - CELL * 2;
    const pct = Math.min(100, claimedPercent());
    ctx.fillStyle = 'rgba(8, 12, 22, 0.85)';
    ctx.fillRect(x0, 3, span, 4);
    ctx.fillStyle = COL.stix;
    ctx.fillRect(x0, 3, (span * pct) / 100, 4);
    ctx.fillStyle = pct >= TARGET_PERCENT ? COL.stix : COL.marker;
    ctx.fillRect(x0 + (span * TARGET_PERCENT) / 100 - 1, 1, 2, 8);
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, W, H);

    drawClaimed();
    drawFlashes();
    drawProgress();

    if (state !== 'idle') {
        drawQix();
        drawStix();
        drawFuse();
        drawSparx();
        drawMarker();
    }

    if (deathFlash > 0) {
        ctx.fillStyle = 'rgba(248, 113, 113, ' + deathFlash * 0.5 + ')';
        ctx.fillRect(0, 0, W, H);
    }
}

// --- main loop -------------------------------------------------------------

let lastFrame = 0;
let carry = 0;

function frame(ts) {
    const dt = lastFrame ? Math.min(0.05, (ts - lastFrame) / 1000) : 0;
    lastFrame = ts;

    if (autoRun && state === 'running') {
        carry += dt;
        while (carry >= DT) {
            stepGame(DT);
            carry -= DT;
        }
    } else {
        carry = 0;
    }

    draw();
    requestAnimationFrame(frame);
}

resetLevel();
state = 'idle';
score = 0;
updateHud();
draw();
requestAnimationFrame(frame);
