// ---------------------------------------------------------------------------
// The Narrow Path — a tilting-board marble game in the wooden-labyrinth genre,
// themed on the narrow way of Matthew 7:13-14.
//
// You tilt a pilgrim's board; a round stone rolls under gravity. Gather every
// waymark on a stage (Jeremiah 31:21) to open the narrow gate at the far end,
// and keep out of the ditches beside the road.
//
// Written as a single classic (non-module) script so every constant, piece of
// state and helper is reachable from the Playwright tests as a plain global,
// the same shape as the other arcade games in this repo. All motion is
// expressed per second and advanced only through `step(dt)`; the animation
// frame loop calls it only while `simulate` is true, so the tests can switch
// the loop off and drive the simulation one exact frame at a time.
// ---------------------------------------------------------------------------

// --- Board ---------------------------------------------------------------
const COLS = 16;
const ROWS = 12;
const CELL = 40;                 // COLS * CELL x ROWS * CELL == 640 x 480

// --- The stone -----------------------------------------------------------
const BALL_R = 9;
const ACCEL = 560;               // px/s^2 at full tilt
const FRICTION = 1.6;            // rolling resistance, per second
const MAX_SPEED = 300;           // px/s
const WALL_BOUNCE = 0.42;        // how much speed survives hitting a wall

// --- Tilt ----------------------------------------------------------------
const TILT_MAX = 1;
const TILT_RATE = 3.4;           // per second, toward what is being held
const TILT_RETURN = 4.6;         // per second, back to level when let go
const POINTER_RANGE = 150;       // px from the board's middle for a full tilt

// --- Furniture -----------------------------------------------------------
const PIT_R = 13;
const FALL_MARGIN = 4;           // grazing the lip is safe; the middle is not
const WAYMARK_R = 9;

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const DEATH_PAUSE = 1.0;         // seconds before the stone is set back
const CLEAR_PAUSE = 1.6;         // seconds between stages

// --- Scoring -------------------------------------------------------------
const WAYMARK_POINTS = 120;
const STAGE_POINTS = 400;
const TIME_BONUS = 5;            // per whole second of par left on the clock

const BEST_KEY = 'narrow-path-best';

// --- Stages --------------------------------------------------------------
// '#' wall, '.' floor, 'S' start, 'G' gate, '*' waymark, 'o' ditch.
const LEVELS = [
    {
        name: 'The Village Road',
        par: 45,
        rows: [
            '################',
            '#S.............#',
            '#...######.....#',
            '#........#.....#',
            '#..*.....#..o..#',
            '#.####...#.....#',
            '#....#...####..#',
            '#....#......*..#',
            '#..o.#....##...#',
            '#....#....##...#',
            '#...*.........G#',
            '################',
        ],
    },
    {
        name: 'The Winding Way',
        par: 60,
        rows: [
            '################',
            '#S....#......*.#',
            '#..............#',
            '#..o..#..####..#',
            '#.....#..#.....#',
            '#..####..#.....#',
            '#..#*....o.....#',
            '#..#....####...#',
            '#*.#..o......o.#',
            '#..#....#..*...#',
            '#..#....#.....G#',
            '################',
        ],
    },
    {
        name: 'The Steep Pass',
        par: 75,
        rows: [
            '################',
            '#S...o....#...*#',
            '#.........#....#',
            '#..####....#...#',
            '#..#..#.o..#...#',
            '#*.#..#....#.o.#',
            '#..#..####.....#',
            '#..#..#..*.....#',
            '#..o..#...####.#',
            '#.....#.o.#..*.#',
            '#..*..#...#...G#',
            '################',
        ],
    },
    {
        name: 'The Narrow Gate',
        par: 90,
        rows: [
            '################',
            '#S..#....o.#...#',
            '#...#......#.*.#',
            '#.o.#.####.#...#',
            '#...#*#..#.#.#.#',
            '#...#.#.o#.#.#*#',
            '#*..#.#..#.#.#.#',
            '#...#.##.#.#.#.#',
            '#........o.#.#.#',
            '#.o.#.##...#.#.#',
            '#...#.#*.#....G#',
            '################',
        ],
    },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let state = 'idle';              // idle | running | paused | dying | stageclear | won | over
let level = 0;
let lives = START_LIVES;
let score = 0;
let best = 0;
let elapsed = 0;
let waymarksLeft = 0;
let gateOpen = false;
let simulate = true;             // the tests switch this off and step by hand

let walls = [];                  // walls[row][col]
let pits = [];
let waymarks = [];
let startCell = { col: 1, row: 1 };
let gateCell = { col: 14, row: 10 };

const ball = { x: 0, y: 0, vx: 0, vy: 0 };
const tilt = { x: 0, y: 0 };

let deathTimer = 0;
let clearTimer = 0;
let fallTimer = 0;               // 0..1, how far down the ditch the stone is

const heldKeys = new Set();
const pointer = { active: false, x: 0, y: 0 };

// --- DOM -----------------------------------------------------------------
const el = (id) => document.getElementById(id);
const stageEl = el('stage');
const waymarksEl = el('waymarks');
const livesEl = el('lives');
const timeEl = el('time');
const scoreEl = el('score');
const bestEl = el('best');
const statusEl = el('status');
const overlayEl = el('overlay');
const overlayTitleEl = el('overlay-title');
const overlaySubEl = el('overlay-sub');
const overlayHintEl = el('overlay-hint');

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

function cellCentre(col, row) {
    return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

function isWall(col, row) {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return true;
    return walls[row][col];
}

// The cells an interval [lo, hi] covers, not counting a cell it merely touches:
// a stone settled flush against one wall must not read as overlapping it, or
// resolving the other axis would shove it along the wall and into a corner.
const EPS = 1e-6;

function cellRange(lo, hi) {
    return [Math.floor((lo + EPS) / CELL), Math.floor((hi - EPS) / CELL)];
}

// Does a stone of radius r at (x, y) overlap any wall cell? The stone is
// treated as a square of that half-width, which is close enough at this scale
// and keeps corners from letting it slip through.
function overlapsWall(x, y, r) {
    const [minC, maxC] = cellRange(x - r, x + r);
    const [minR, maxR] = cellRange(y - r, y + r);
    for (let row = minR; row <= maxR; row++)
        for (let col = minC; col <= maxC; col++)
            if (isWall(col, row)) return true;
    return false;
}

// Turn a layout into walls, ditches, waymarks, the start and the gate.
function buildLevel(index) {
    const rows = LEVELS[index].rows;
    walls = [];
    pits = [];
    waymarks = [];
    for (let row = 0; row < ROWS; row++) {
        walls.push([]);
        for (let col = 0; col < COLS; col++) {
            const ch = rows[row][col];
            walls[row].push(ch === '#');
            const { x, y } = cellCentre(col, row);
            if (ch === 'S') startCell = { col, row };
            if (ch === 'G') gateCell = { col, row };
            if (ch === 'o') pits.push({ col, row, x, y });
            if (ch === '*') waymarks.push({ col, row, x, y, taken: false });
        }
    }
    waymarksLeft = waymarks.length;
    gateOpen = false;
    return LEVELS[index];
}

// Every cell reachable from the start without rolling across a ditch, as a set
// of "col,row" keys. A stage is only fair if the gate and all its waymarks are
// in here, which the test suite checks for every stage.
function reachableCells(index) {
    const rows = LEVELS[index].rows;
    const blocked = (col, row) =>
        col < 0 || row < 0 || col >= COLS || row >= ROWS ||
        rows[row][col] === '#' || rows[row][col] === 'o';

    let from = null;
    for (let row = 0; row < ROWS; row++)
        for (let col = 0; col < COLS; col++)
            if (rows[row][col] === 'S') from = { col, row };

    const seen = new Set();
    if (!from) return seen;
    const queue = [from];
    seen.add(`${from.col},${from.row}`);
    while (queue.length) {
        const { col, row } = queue.pop();
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const c = col + dc, r = row + dr, key = `${c},${r}`;
            if (seen.has(key) || blocked(c, r)) continue;
            seen.add(key);
            queue.push({ col: c, row: r });
        }
    }
    return seen;
}

function stageBonus(index, seconds) {
    const left = Math.max(0, Math.round(LEVELS[index].par - seconds));
    return STAGE_POINTS + left * TIME_BONUS;
}

// ---------------------------------------------------------------------------
// Run and stage setup
// ---------------------------------------------------------------------------

function placeStoneAtStart() {
    const p = cellCentre(startCell.col, startCell.row);
    ball.x = p.x;
    ball.y = p.y;
    ball.vx = 0;
    ball.vy = 0;
    tilt.x = 0;
    tilt.y = 0;
    fallTimer = 0;
}

function startStage(index) {
    level = index;
    buildLevel(index);
    placeStoneAtStart();
    elapsed = 0;
    deathTimer = 0;
    clearTimer = 0;
    updateHud();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    startStage(0);
    state = 'running';
    hideOverlay();
    updateHud();
}

function gameOver() {
    state = 'over';
    saveBest();
    showOverlay('Run over', `Score ${score}`, 'Press Space to set out again');
    updateHud();
}

function finishPath() {
    state = 'won';
    saveBest();
    showOverlay('The path is finished!', `Score ${score}`, 'Press Space to walk it again');
    updateHud();
}

function saveBest() {
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (e) {
            /* private browsing — the run still plays, the best just isn't kept */
        }
    }
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P or Space to carry on');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function tiltTarget() {
    const held = (keys) => keys.some((k) => heldKeys.has(k));
    let x = (held(['ArrowRight', 'd', 'D']) ? 1 : 0) - (held(['ArrowLeft', 'a', 'A']) ? 1 : 0);
    let y = (held(['ArrowDown', 's', 'S']) ? 1 : 0) - (held(['ArrowUp', 'w', 'W']) ? 1 : 0);
    if (pointer.active) {
        const clamp = (v) => Math.max(-1, Math.min(1, v));
        x = clamp(x + clamp((pointer.x - (COLS * CELL) / 2) / POINTER_RANGE));
        y = clamp(y + clamp((pointer.y - (ROWS * CELL) / 2) / POINTER_RANGE));
    }
    return { x, y };
}

function moveTilt(dt, target) {
    for (const axis of ['x', 'y']) {
        const want = Math.max(-TILT_MAX, Math.min(TILT_MAX, target[axis]));
        const rate = want === 0 ? TILT_RETURN : TILT_RATE;
        const diff = want - tilt[axis];
        const move = rate * dt;
        tilt[axis] = Math.abs(diff) <= move ? want : tilt[axis] + Math.sign(diff) * move;
    }
}

// Move one axis and settle the stone against the first wall ahead of it on
// that axis. Resolving the axes one at a time is what stops a stone travelling
// diagonally into a corner from tunnelling through it; only walls genuinely in
// front of the stone count, so a wall it is already sliding along is ignored.
function moveAxis(axis, d) {
    if (d === 0) return;
    const prev = axis === 'x' ? ball.x : ball.y;
    if (axis === 'x') ball.x += d; else ball.y += d;
    if (!overlapsWall(ball.x, ball.y, BALL_R)) return;

    const [minC, maxC] = cellRange(ball.x - BALL_R, ball.x + BALL_R);
    const [minR, maxR] = cellRange(ball.y - BALL_R, ball.y + BALL_R);

    let edge = null;
    for (let row = minR; row <= maxR; row++) {
        for (let col = minC; col <= maxC; col++) {
            if (!isWall(col, row)) continue;
            const i = axis === 'x' ? col : row;
            if (d > 0) {
                const e = i * CELL - BALL_R;
                if (e < prev - EPS) continue;
                if (edge === null || e < edge) edge = e;
            } else {
                const e = (i + 1) * CELL + BALL_R;
                if (e > prev + EPS) continue;
                if (edge === null || e > edge) edge = e;
            }
        }
    }

    if (edge === null) {
        // Nothing ahead to settle against, so the move itself was impossible.
        if (axis === 'x') ball.x = prev; else ball.y = prev;
        return;
    }
    if (axis === 'x') {
        ball.x = edge;
        ball.vx = -ball.vx * WALL_BOUNCE;
    } else {
        ball.y = edge;
        ball.vy = -ball.vy * WALL_BOUNCE;
    }
}

function rollStone(dt) {
    ball.vx += ACCEL * tilt.x * dt;
    ball.vy += ACCEL * tilt.y * dt;

    const decay = Math.max(0, 1 - FRICTION * dt);
    ball.vx *= decay;
    ball.vy *= decay;

    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > MAX_SPEED) {
        ball.vx = (ball.vx / speed) * MAX_SPEED;
        ball.vy = (ball.vy / speed) * MAX_SPEED;
    }

    moveAxis('x', ball.vx * dt);
    moveAxis('y', ball.vy * dt);
}

function fallIntoDitch() {
    lives -= 1;
    ball.vx = 0;
    ball.vy = 0;
    tilt.x = 0;
    tilt.y = 0;
    updateHud();
    if (lives <= 0) {
        gameOver();
        return;
    }
    state = 'dying';
    deathTimer = DEATH_PAUSE;
    showOverlay('Into the ditch!', `${lives} journey${lives === 1 ? '' : 's'} left`,
        'Steady the board…');
}

function gatherWaymark(w) {
    w.taken = true;
    waymarksLeft -= 1;
    score += WAYMARK_POINTS;
    if (waymarksLeft === 0) gateOpen = true;
    updateHud();
}

function clearStage() {
    score += stageBonus(level, elapsed);
    state = 'stageclear';
    clearTimer = CLEAR_PAUSE;
    ball.vx = 0;
    ball.vy = 0;
    const last = level === LEVELS.length - 1;
    showOverlay('Stage complete!', `${LEVELS[level].name} — score ${score}`,
        last ? 'One gate left behind…' : 'On to the next stage…');
    updateHud();
}

function checkFurniture() {
    for (const p of pits) {
        if (Math.hypot(ball.x - p.x, ball.y - p.y) < PIT_R - FALL_MARGIN) {
            fallIntoDitch();
            return;
        }
    }
    for (const w of waymarks) {
        if (w.taken) continue;
        if (Math.hypot(ball.x - w.x, ball.y - w.y) < WAYMARK_R + BALL_R) gatherWaymark(w);
    }
    if (gateOpen) {
        const left = gateCell.col * CELL, top = gateCell.row * CELL;
        if (ball.x >= left && ball.x <= left + CELL && ball.y >= top && ball.y <= top + CELL)
            clearStage();
    }
}

function step(dt) {
    if (dt <= 0) return;

    if (state === 'dying') {
        moveTilt(dt, { x: 0, y: 0 });
        fallTimer = Math.min(1, fallTimer + dt / DEATH_PAUSE);
        deathTimer -= dt;
        if (deathTimer <= 0) {
            placeStoneAtStart();
            state = 'running';
            hideOverlay();
            updateHud();
        }
        return;
    }

    if (state === 'stageclear') {
        moveTilt(dt, { x: 0, y: 0 });
        clearTimer -= dt;
        if (clearTimer <= 0) {
            if (level === LEVELS.length - 1) {
                finishPath();
            } else {
                startStage(level + 1);
                state = 'running';
                hideOverlay();
                updateHud();
            }
        }
        return;
    }

    if (state !== 'running') return;

    moveTilt(dt, tiltTarget());
    rollStone(dt);
    checkFurniture();

    if (state === 'running') {
        elapsed += dt;
        updateHud();
    }
}

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------

function statusText() {
    if (state === 'idle') return 'Tilt the board and gather every waymark.';
    if (state === 'over') return 'Every journey spent. Press Space to set out again.';
    if (state === 'won') return 'Every gate behind you. Press Space to walk the path again.';
    if (waymarksLeft > 0) {
        return `The gate is shut — ${waymarksLeft} waymark${waymarksLeft === 1 ? '' : 's'} still to gather.`;
    }
    return 'The narrow gate is open — roll for the gate!';
}

function updateHud() {
    stageEl.textContent = LEVELS[level].name;
    waymarksEl.textContent = String(waymarksLeft);
    livesEl.textContent = String(Math.max(0, lives));
    timeEl.textContent = String(Math.floor(elapsed + 1e-6));
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    statusEl.textContent = statusText();
}

function showOverlay(title, sub, hint) {
    overlayTitleEl.textContent = title;
    overlaySubEl.textContent = sub || '';
    overlayHintEl.textContent = hint || '';
    overlayEl.classList.add('visible');
}

function hideOverlay() {
    overlayEl.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawFloor() {
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            if (walls[row][col]) continue;
            ctx.fillStyle = (col + row) % 2 ? '#d9b985' : '#d2b079';
            ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
        }
    }
    // A faint grain along the board.
    ctx.strokeStyle = 'rgba(120, 82, 40, 0.10)';
    ctx.lineWidth = 1;
    for (let y = 6; y < ROWS * CELL; y += 13) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(COLS * CELL, y);
        ctx.stroke();
    }
}

function drawWalls() {
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            if (!walls[row][col]) continue;
            const x = col * CELL, y = row * CELL;
            ctx.fillStyle = '#7b4f26';
            ctx.fillRect(x, y, CELL, CELL);
            ctx.fillStyle = 'rgba(255, 226, 170, 0.22)';
            ctx.fillRect(x, y, CELL, 5);
            ctx.fillStyle = 'rgba(40, 22, 6, 0.30)';
            ctx.fillRect(x, y + CELL - 6, CELL, 6);
            ctx.strokeStyle = 'rgba(40, 22, 6, 0.35)';
            ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        }
    }
}

function drawPits() {
    for (const p of pits) {
        const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, PIT_R);
        g.addColorStop(0, '#120b04');
        g.addColorStop(0.75, '#1d1208');
        g.addColorStop(1, '#4a2f14');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, PIT_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(90, 58, 24, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, PIT_R, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawWaymarks() {
    for (const w of waymarks) {
        if (w.taken) continue;
        // A warm halo so a waymark reads at a glance against the sand.
        const halo = ctx.createRadialGradient(w.x, w.y, 2, w.x, w.y, WAYMARK_R * 2);
        halo.addColorStop(0, 'rgba(255, 221, 140, 0.55)');
        halo.addColorStop(1, 'rgba(255, 205, 100, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(w.x, w.y, WAYMARK_R * 2, 0, Math.PI * 2);
        ctx.fill();

        // A little cairn of stacked stones.
        ctx.strokeStyle = 'rgba(48, 32, 14, 0.75)';
        ctx.lineWidth = 1.2;
        const stone = (dy, rx, ry, fill) => {
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.ellipse(w.x, w.y + dy, rx, ry, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        };
        stone(6, WAYMARK_R, WAYMARK_R * 0.5, '#6f6657');
        stone(1, WAYMARK_R * 0.8, WAYMARK_R * 0.45, '#9b9183');
        stone(-4, WAYMARK_R * 0.55, WAYMARK_R * 0.4, '#f4e8ca');
    }
}

function drawGate() {
    const x = gateCell.col * CELL, y = gateCell.row * CELL;
    const cx = x + CELL / 2;
    ctx.save();

    if (gateOpen) {
        const glow = ctx.createRadialGradient(cx, y + CELL / 2, 2, cx, y + CELL / 2, CELL * 1.1);
        glow.addColorStop(0, 'rgba(255, 240, 185, 0.95)');
        glow.addColorStop(0.55, 'rgba(255, 214, 120, 0.45)');
        glow.addColorStop(1, 'rgba(255, 200, 90, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - CELL, y - CELL, CELL * 3, CELL * 3);
    }

    // The doorway itself: two posts under a round arch.
    ctx.beginPath();
    ctx.moveTo(x + 8, y + CELL - 3);
    ctx.lineTo(x + 8, y + 16);
    ctx.arc(cx, y + 16, CELL / 2 - 8, Math.PI, 0);
    ctx.lineTo(x + CELL - 8, y + CELL - 3);
    ctx.closePath();
    ctx.fillStyle = gateOpen ? 'rgba(255, 247, 214, 0.92)' : 'rgba(42, 27, 11, 0.85)';
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.strokeStyle = gateOpen ? '#e2b452' : '#6b4722';
    ctx.stroke();

    if (!gateOpen) {
        // Barred shut until every waymark is gathered.
        ctx.strokeStyle = '#8a6130';
        ctx.lineWidth = 2.5;
        for (let i = 1; i <= 3; i++) {
            ctx.beginPath();
            ctx.moveTo(x + 9, y + 8 + i * 8);
            ctx.lineTo(x + CELL - 9, y + 8 + i * 8);
            ctx.stroke();
        }
    }
    ctx.restore();
}

function drawStone() {
    const shrink = state === 'dying' ? 1 - fallTimer * 0.75 : 1;
    const r = BALL_R * shrink;
    // Shadow, thrown the way the board leans.
    ctx.fillStyle = 'rgba(40, 24, 8, 0.32)';
    ctx.beginPath();
    ctx.ellipse(ball.x + tilt.x * 3 + 1.5, ball.y + tilt.y * 3 + 2.5, r, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();

    const g = ctx.createRadialGradient(
        ball.x - tilt.x * 3 - 2.5, ball.y - tilt.y * 3 - 2.5, r * 0.2,
        ball.x, ball.y, r);
    g.addColorStop(0, '#fbf6ea');
    g.addColorStop(0.45, '#c9c0ae');
    g.addColorStop(1, '#7d7465');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(50, 38, 20, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

// A small gauge in the corner showing which way the board leans.
function drawTiltGauge() {
    const cx = COLS * CELL - 30, cy = 30, rad = 15;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(30, 18, 6, 0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(243, 228, 198, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#f0d79a';
    ctx.beginPath();
    ctx.arc(cx + tilt.x * (rad - 4), cy + tilt.y * (rad - 4), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFloor();
    drawPits();
    drawGate();
    drawWaymarks();
    drawWalls();
    drawStone();
    drawTiltGauge();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const TILT_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'a', 'A', 'd', 'D', 'w', 'W', 's', 'S'];

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if (e.key === 'r' || e.key === 'R') {
        startGame();
        return;
    }
    if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
        if (state === 'paused') togglePause();
        else if (state === 'idle' || state === 'over' || state === 'won') startGame();
        e.preventDefault();
        return;
    }
    if (TILT_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    heldKeys.delete(e.key);
});

window.addEventListener('blur', () => {
    heldKeys.clear();
    pointer.active = false;
});

function pointerPosition(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((e.clientX - rect.left) / rect.width) * COLS * CELL,
        y: ((e.clientY - rect.top) / rect.height) * ROWS * CELL,
    };
}

canvas.addEventListener('pointerdown', (e) => {
    if (state === 'idle' || state === 'over' || state === 'won') {
        startGame();
        return;
    }
    const p = pointerPosition(e);
    pointer.active = true;
    pointer.x = p.x;
    pointer.y = p.y;
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
});

canvas.addEventListener('pointermove', (e) => {
    if (!pointer.active) return;
    const p = pointerPosition(e);
    pointer.x = p.x;
    pointer.y = p.y;
});

for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    canvas.addEventListener(type, () => { pointer.active = false; });
}

el('btn-start').addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else if (state === 'running') return;
    else startGame();
});

el('btn-pause').addEventListener('click', () => togglePause());
el('btn-restart').addEventListener('click', () => startGame());

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    if (simulate) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

try {
    best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
} catch (e) {
    best = 0;
}

startStage(0);
state = 'idle';
updateHud();
showOverlay('The Narrow Path',
    'Tilt the board, gather the waymarks, find the narrow gate.',
    'Press Space or click Start');
requestAnimationFrame(frame);
