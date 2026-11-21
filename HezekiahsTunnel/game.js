// ---------------------------------------------------------------------------
// Hezekiah's Tunnel — lay a channel of hewn rock from the Gihon spring to the
// Pool of Siloam before the water catches up with the digging.
//
// Plain global-scope JavaScript, like the rest of this repository, so the
// Playwright suite can read and drive the state directly. All motion runs
// through `step(dt)`; the animation frame loop calls the same function the
// tests do. See DESIGN.md for the rules and the test hooks.
// ---------------------------------------------------------------------------

// --- Board geometry --------------------------------------------------------
const COLS = 9;
const ROWS = 7;
const CELL = 56;
const CANVAS_W = 560;
const CANVAS_H = 420;
const ORIGIN_X = (CANVAS_W - COLS * CELL) / 2;
const ORIGIN_Y = (CANVAS_H - ROWS * CELL) / 2;

// --- Channel sections ------------------------------------------------------
const PIPE_TYPES = ['h', 'v', 'ne', 'nw', 'se', 'sw', 'cross'];
const OPEN = {
    h: ['W', 'E'],
    v: ['N', 'S'],
    ne: ['N', 'E'],
    nw: ['N', 'W'],
    se: ['S', 'E'],
    sw: ['S', 'W'],
    cross: ['N', 'E', 'S', 'W'],
};
// Straights and elbows are common; a cross is a rarer gift.
const BAG = ['h', 'h', 'h', 'v', 'v', 'v', 'ne', 'ne', 'nw', 'nw', 'se', 'se', 'sw', 'sw', 'cross'];
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
const DELTA = { N: { dr: -1, dc: 0 }, S: { dr: 1, dc: 0 }, E: { dr: 0, dc: 1 }, W: { dr: 0, dc: -1 } };

// --- Rules -----------------------------------------------------------------
const QUEUE_LEN = 5;
const MAX_DAYS = 3;
const SCORE_PER_CELL = 10;
const LEVEL_BONUS = 200;
const BEST_KEY = 'hezekiahs-tunnel-best';
const LEVELS = [
    { grace: 12, speed: 0.70, rocks: 3 },
    { grace: 11, speed: 0.85, rocks: 5 },
    { grace: 10, speed: 1.00, rocks: 7 },
    { grace: 9, speed: 1.20, rocks: 9 },
    { grace: 8, speed: 1.40, rocks: 11 },
];

// --- Colours ---------------------------------------------------------------
const C = {
    ground: '#2b2318',
    groundEdge: '#3a3021',
    rock: '#15110b',
    rockEdge: '#241d13',
    rockSpeck: '#3d3322',
    groove: '#0d1418',
    grooveWall: '#53452c',
    water: '#3aa6d8',
    waterLight: '#7fd6f0',
    spring: '#2b8fbf',
    pool: '#2f7fa8',
    cursor: '#e8c35a',
};

// --- State -----------------------------------------------------------------
let state = 'idle';      // idle | running | paused | leak | levelclear | won | gameover
let score = 0;
let best = 0;
let level = 1;
let days = MAX_DAYS;
let grace = LEVELS[0].grace;
let flooded = 0;
let grid = [];
let queue = [];
let cursor = { r: 0, c: 1 };
let flow = null;         // null | { r, c, dir }
let springRow = 3;
let poolRow = 3;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const queueCanvas = document.getElementById('queue-canvas');
const qctx = queueCanvas.getContext('2d');

const elScore = document.getElementById('score');
const elBest = document.getElementById('best');
const elLevel = document.getElementById('level');
const elDays = document.getElementById('days');
const elTimer = document.getElementById('timer');
const elFlooded = document.getElementById('flooded');
const elStatus = document.getElementById('status');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnAction = document.getElementById('btn-action');
const btnStart = document.getElementById('btn-start');
const btnNew = document.getElementById('btn-new');

// ---------------------------------------------------------------------------
// Section geometry
// ---------------------------------------------------------------------------

// The sides a section opens onto.
function openings(type) {
    return OPEN[type] || [];
}

// Where water travelling `dir` leaves a section of this type, or null when the
// section has no opening facing the water.
function exitDir(type, dir) {
    const sides = openings(type);
    const entry = OPPOSITE[dir];
    if (!sides.includes(entry)) return null;
    if (type === 'cross') return dir;          // always straight through
    return sides.find((s) => s !== entry);
}

// A cross carries two independent channels; everything else carries one.
function axisOf(cell, dir) {
    if (cell.type === 'cross') return dir === 'E' || dir === 'W' ? 'h' : 'v';
    return 'main';
}

function levelConfig(lvl) {
    return LEVELS[Math.min(Math.max(lvl, 1), LEVELS.length) - 1];
}

function cellCentre(r, c) {
    return { x: ORIGIN_X + c * CELL + CELL / 2, y: ORIGIN_Y + r * CELL + CELL / 2 };
}

function inPlayable(r, c) {
    return r >= 0 && r < ROWS && c >= 1 && c <= COLS - 2;
}

// ---------------------------------------------------------------------------
// Level generation
// ---------------------------------------------------------------------------

function randInt(n) {
    return Math.floor(Math.random() * n);
}

function randomPiece() {
    return BAG[randInt(BAG.length)];
}

function fillQueue() {
    queue = [];
    for (let i = 0; i < QUEUE_LEN; i++) queue.push(randomPiece());
}

function emptyGrid() {
    const g = [];
    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
            if (c === 0) row.push(r === springRow ? { kind: 'spring' } : { kind: 'rock' });
            else if (c === COLS - 1) row.push(r === poolRow ? { kind: 'pool' } : { kind: 'rock' });
            else row.push(null);
        }
        g.push(row);
    }
    return g;
}

function scatterRocks(count) {
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < 500) {
        const r = randInt(ROWS);
        const c = 1 + randInt(COLS - 2);
        if (grid[r][c] !== null) continue;
        if (r === springRow && c === 1) continue;            // room to start
        if (r === poolRow && c === COLS - 2) continue;        // room to finish
        grid[r][c] = { kind: 'rock' };
        placed++;
    }
}

// Is there still a rock-free way from the spring side to the pool side?
function routeExists() {
    const seen = new Set([`${springRow},1`]);
    const q = [[springRow, 1]];
    while (q.length) {
        const [r, c] = q.shift();
        if (r === poolRow && c === COLS - 2) return true;
        for (const d of Object.values(DELTA)) {
            const nr = r + d.dr;
            const nc = c + d.dc;
            if (!inPlayable(nr, nc) || grid[nr][nc] !== null) continue;
            const key = `${nr},${nc}`;
            if (seen.has(key)) continue;
            seen.add(key);
            q.push([nr, nc]);
        }
    }
    return false;
}

// Lay out a stretch of bedrock. Options are for the tests: `level`,
// `springRow`, `poolRow` and `rocks` all default to the live game's values.
function buildLevel(opts) {
    opts = opts || {};
    const lvl = opts.level === undefined ? level : opts.level;
    const cfg = levelConfig(lvl);
    const rocks = opts.rocks === undefined ? cfg.rocks : opts.rocks;
    springRow = opts.springRow === undefined ? randInt(ROWS) : opts.springRow;
    poolRow = opts.poolRow === undefined ? randInt(ROWS) : opts.poolRow;

    for (let attempt = 0; ; attempt++) {
        grid = emptyGrid();
        scatterRocks(rocks);
        if (routeExists()) break;
        if (attempt >= 60) { grid = emptyGrid(); break; }   // open ground rather than a dead end
    }

    grace = cfg.grace;
    flow = null;
    flooded = 0;
    cursor = { r: springRow, c: 1 };
    fillQueue();
    updateHud();
    draw();
    drawQueue();
}

function newLevel() {
    buildLevel({});
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    days = MAX_DAYS;
    level = 1;
    state = 'running';
    buildLevel({});
    hideOverlay();
    setStatus('Lay channel from the spring to the pool before the water starts.');
    updateHud();
}

function nextLevel() {
    level = Math.min(level + 1, LEVELS.length);
    state = 'running';
    buildLevel({});
    hideOverlay();
    setStatus('A new stretch of bedrock. Keep the water moving east.');
    updateHud();
}

function retryLevel() {
    state = 'running';
    buildLevel({});
    hideOverlay();
    setStatus('The crews start again on this stretch.');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', 'Press P to pick the tools up again.');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
    updateHud();
}

// Lay the head of the queue on a cell. Returns whether it went down.
function placePiece(r, c) {
    if (state !== 'running') return false;
    if (!inPlayable(r, c)) return false;
    if (grid[r][c] !== null) return false;
    const type = queue.shift();
    queue.push(randomPiece());
    grid[r][c] = { kind: 'channel', type, fill: {}, dirs: {} };
    cursor = { r, c };
    updateHud();
    draw();
    drawQueue();
    return true;
}

// ---------------------------------------------------------------------------
// The water
// ---------------------------------------------------------------------------

function beginFlow() {
    setStatus('The spring is running — the water is on its way!');
    enterCell(springRow, 1, 'E');
}

// Send the water into one cell, travelling `dir`. Sets `flow`, clears the
// level, or springs a leak.
function enterCell(r, c, dir) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return leak();
    const cell = grid[r][c];
    if (!cell) return leak();
    if (cell.kind === 'pool') {
        if (r === poolRow && dir === 'E') return clearLevel();
        return leak();
    }
    if (cell.kind !== 'channel') return leak();
    if (exitDir(cell.type, dir) === null) return leak();
    const axis = axisOf(cell, dir);
    if ((cell.fill[axis] || 0) > 0) return leak();     // that channel already ran
    cell.fill[axis] = 0;
    cell.dirs[axis] = dir;
    flow = { r, c, dir };
}

function leak() {
    flow = null;
    days--;
    if (days <= 0) {
        days = 0;
        state = 'gameover';
        saveBest();
        showOverlay('The dig is over', `The water broke out into the rock. Final score ${score}.`, 'bad');
        setStatus('The water broke out into the rock — the dig is over.', 'bad');
    } else {
        state = 'leak';
        showOverlay('The water broke through!', 'A day of digging lost. Press Space to work this stretch again.', 'bad');
        setStatus('The water broke out into the rock — a day of digging lost.', 'bad');
    }
    updateHud();
    draw();
}

function clearLevel() {
    flow = null;
    score += LEVEL_BONUS;
    saveBest();
    if (level >= LEVELS.length) {
        state = 'won';
        showOverlay('The tunnel is finished!', `The water runs into Siloam and the city will drink. Final score ${score}.`, 'good');
        setStatus('The tunnel is finished — the water runs into the Pool of Siloam!', 'good');
    } else {
        state = 'levelclear';
        showOverlay('The water reaches Siloam!', 'Stretch complete, 200 bonus. Press Space for the next stretch.', 'good');
        setStatus('The water reaches the Pool of Siloam!', 'good');
    }
    updateHud();
    draw();
}

// Advance the dig by `dt` seconds. The animation frame loop and the tests both
// come through here.
function step(dt) {
    if (state !== 'running') return;

    if (grace > 0) {
        grace = Math.max(0, grace - dt);
        updateHud();
        if (grace > 0) return;
    }

    if (!flow) {
        beginFlow();
        if (state !== 'running' || !flow) return;
    }

    let remaining = dt * levelConfig(level).speed;
    let guard = 0;
    while (remaining > 1e-9 && flow && state === 'running' && guard++ < 500) {
        const cell = grid[flow.r][flow.c];
        const axis = axisOf(cell, flow.dir);
        const have = cell.fill[axis] || 0;
        const use = Math.min(1 - have, remaining);
        cell.fill[axis] = have + use;
        remaining -= use;
        if (cell.fill[axis] >= 1 - 1e-9) {
            cell.fill[axis] = 1;
            flooded++;
            score += SCORE_PER_CELL;
            const out = exitDir(cell.type, flow.dir);
            const d = DELTA[out];
            const from = flow;
            flow = null;
            enterCell(from.r + d.dr, from.c + d.dc, out);
        }
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Score keeping
// ---------------------------------------------------------------------------

function saveBest() {
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (e) {
            /* private browsing — the run just isn't recorded */
        }
    }
    updateHud();
}

function loadBest() {
    let stored = null;
    try {
        stored = window.localStorage.getItem(BEST_KEY);
    } catch (e) {
        stored = null;
    }
    best = parseInt(stored || '0', 10) || 0;
}

// ---------------------------------------------------------------------------
// HUD, status and overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elBest.textContent = String(best);
    elLevel.textContent = String(level);
    elDays.textContent = String(days);
    elFlooded.textContent = String(flooded);
    elTimer.textContent = state === 'levelclear' || state === 'won' ? 'Arrived'
        : state === 'gameover' ? 'Lost'
            : grace > 0 ? `${Math.ceil(grace)}s` : 'Flowing';
    btnStart.textContent = state === 'idle' ? 'Start'
        : state === 'paused' ? 'Resume'
            : state === 'running' ? 'Pause'
                : state === 'levelclear' ? 'Next stretch'
                    : state === 'leak' ? 'Try again' : 'Play again';
}

function setStatus(text, kind) {
    elStatus.textContent = text;
    elStatus.className = kind || '';
}

function showOverlay(title, sub, kind) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlay.className = 'visible' + (kind ? ' ' + kind : '');
    btnAction.textContent = state === 'paused' ? 'Resume'
        : state === 'leak' ? 'Try this stretch again'
            : state === 'levelclear' ? 'Next stretch'
                : state === 'idle' ? 'Start the dig' : 'Dig again';
}

function hideOverlay() {
    overlay.className = '';
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

// A rectangle along one side of a cell, from `d0` to `d1` measured outward
// from the centre (0) to the edge (CELL / 2).
function sideRect(c2d, cx, cy, side, d0, d1, width) {
    const w = width;
    if (side === 'N') c2d.fillRect(cx - w / 2, cy - d1, w, d1 - d0);
    else if (side === 'S') c2d.fillRect(cx - w / 2, cy + d0, w, d1 - d0);
    else if (side === 'W') c2d.fillRect(cx - d1, cy - w / 2, d1 - d0, w);
    else c2d.fillRect(cx + d0, cy - w / 2, d1 - d0, w);
}

// The hewn groove of a section (no water), drawn at an arbitrary size so the
// queue strip can reuse it. Each arm runs from its edge right through the
// centre, so an elbow turns a clean square corner.
function drawSection(c2d, cx, cy, size, type) {
    const half = size / 2;
    const w = size * 0.42;
    const sides = openings(type);

    const arms = (width) => {
        const h = width / 2;
        for (const side of sides) {
            if (side === 'N') c2d.fillRect(cx - h, cy - half, width, half + h);
            else if (side === 'S') c2d.fillRect(cx - h, cy - h, width, half + h);
            else if (side === 'W') c2d.fillRect(cx - half, cy - h, half + h, width);
            else c2d.fillRect(cx - h, cy - h, half + h, width);
        }
        c2d.fillRect(cx - h, cy - h, width, width);
    };

    c2d.fillStyle = C.grooveWall;
    arms(w + 6);
    c2d.fillStyle = C.groove;
    arms(w);
}

// The water inside a section: for each axis that has run, fill from the side
// the water came in by, towards the centre, and on out of the exit.
function drawWater(c2d, cx, cy, cell) {
    const w = CELL * 0.30;
    const half = CELL / 2;
    for (const axis of Object.keys(cell.fill)) {
        const p = cell.fill[axis];
        if (!p) continue;
        const dir = cell.dirs[axis];
        if (!dir) continue;
        const entry = OPPOSITE[dir];
        const exit = exitDir(cell.type, dir);
        const inFrac = Math.min(1, p / 0.5);
        const outFrac = Math.max(0, (p - 0.5) / 0.5);
        c2d.fillStyle = C.water;
        sideRect(c2d, cx, cy, entry, half * (1 - inFrac), half, w);
        if (outFrac > 0) sideRect(c2d, cx, cy, exit, 0, half * outFrac, w);
        if (inFrac >= 1) {
            c2d.beginPath();
            c2d.arc(cx, cy, w / 2, 0, Math.PI * 2);
            c2d.fill();
        }
        c2d.fillStyle = C.waterLight;
        sideRect(c2d, cx, cy, entry, half * (1 - inFrac), half, w * 0.3);
        if (outFrac > 0) sideRect(c2d, cx, cy, exit, 0, half * outFrac, w * 0.3);
    }
}

function drawRock(x, y) {
    ctx.fillStyle = C.rock;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.strokeStyle = C.rockEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
    ctx.fillStyle = C.rockSpeck;
    // A fixed speckle pattern, so the rock does not shimmer between frames.
    const specks = [[12, 16], [34, 10], [22, 38], [44, 30], [16, 46], [40, 48]];
    for (const [dx, dy] of specks) ctx.fillRect(x + dx, y + dy, 3, 3);
}

function drawGround(x, y) {
    ctx.fillStyle = C.ground;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.strokeStyle = C.groundEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
}

function drawSpring(x, y) {
    drawRock(x, y);
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    ctx.fillStyle = C.spring;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.waterLight;
    ctx.beginPath();
    ctx.arc(cx - 3, cy - 4, CELL * 0.10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.water;
    ctx.fillRect(cx, cy - CELL * 0.14, CELL / 2, CELL * 0.28);
}

function drawPool(x, y) {
    drawRock(x, y);
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    ctx.fillStyle = C.pool;
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy, CELL * 0.34, CELL * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.waterLight;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.ellipse(cx + 2, cy, CELL * (0.14 + i * 0.09), CELL * (0.10 + i * 0.07), 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.fillStyle = C.water;
    ctx.fillRect(x, cy - CELL * 0.14, CELL / 2, CELL * 0.28);
}

function draw() {
    ctx.fillStyle = '#121a20';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = ORIGIN_X + c * CELL;
            const y = ORIGIN_Y + r * CELL;
            const cell = grid[r] && grid[r][c];
            if (!cell) {
                drawGround(x, y);
            } else if (cell.kind === 'rock') {
                drawRock(x, y);
            } else if (cell.kind === 'spring') {
                drawSpring(x, y);
            } else if (cell.kind === 'pool') {
                drawPool(x, y);
            } else {
                drawGround(x, y);
                const p = cellCentre(r, c);
                drawSection(ctx, p.x, p.y, CELL, cell.type);
                drawWater(ctx, p.x, p.y, cell);
            }
        }
    }

    // The head of the water, so the player can see where it is going.
    if (flow) {
        const p = cellCentre(flow.r, flow.c);
        ctx.strokeStyle = C.waterLight;
        ctx.lineWidth = 2;
        ctx.strokeRect(ORIGIN_X + flow.c * CELL + 1, ORIGIN_Y + flow.r * CELL + 1, CELL - 2, CELL - 2);
        ctx.fillStyle = C.waterLight;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    // The digging cursor.
    if (state === 'running' || state === 'paused' || state === 'idle') {
        ctx.strokeStyle = C.cursor;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(ORIGIN_X + cursor.c * CELL + 2, ORIGIN_Y + cursor.r * CELL + 2, CELL - 4, CELL - 4);
        ctx.setLineDash([]);
    }
}

function drawQueue() {
    qctx.fillStyle = '#121a20';
    qctx.fillRect(0, 0, queueCanvas.width, queueCanvas.height);
    for (let i = 0; i < queue.length; i++) {
        const y = i * CELL;
        qctx.fillStyle = i === 0 ? C.groundEdge : C.ground;
        qctx.fillRect(2, y + 2, CELL - 4, CELL - 4);
        drawSection(qctx, CELL / 2, y + CELL / 2, CELL - 10, queue[i]);
        qctx.strokeStyle = i === 0 ? C.cursor : '#2d4450';
        qctx.lineWidth = i === 0 ? 2 : 1;
        qctx.strokeRect(2, y + 2, CELL - 4, CELL - 4);
    }
}

// ---------------------------------------------------------------------------
// The animation frame loop. `stopLoop` / `startLoop` let a test own the clock.
// ---------------------------------------------------------------------------

let rafId = null;
let lastTime = null;

function frame(t) {
    rafId = window.requestAnimationFrame(frame);
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.1) dt = 0.1;          // after a tab switch, don't teleport the water
    if (state === 'running') {
        step(dt);
        draw();
    }
}

function startLoop() {
    if (rafId === null) {
        lastTime = null;
        rafId = window.requestAnimationFrame(frame);
    }
}

function stopLoop() {
    if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function confirmAction() {
    if (state === 'idle' || state === 'gameover' || state === 'won') startGame();
    else if (state === 'running') placePiece(cursor.r, cursor.c);
    else if (state === 'paused') togglePause();
    else if (state === 'leak') retryLevel();
    else if (state === 'levelclear') nextLevel();
}

function moveCursor(dr, dc) {
    const r = Math.min(ROWS - 1, Math.max(0, cursor.r + dr));
    const c = Math.min(COLS - 2, Math.max(1, cursor.c + dc));
    cursor = { r, c };
    draw();
}

window.addEventListener('keydown', (e) => {
    switch (e.key) {
        case 'ArrowUp': moveCursor(-1, 0); e.preventDefault(); break;
        case 'ArrowDown': moveCursor(1, 0); e.preventDefault(); break;
        case 'ArrowLeft': moveCursor(0, -1); e.preventDefault(); break;
        case 'ArrowRight': moveCursor(0, 1); e.preventDefault(); break;
        case ' ':
        case 'Spacebar':
        case 'Enter': confirmAction(); e.preventDefault(); break;
        case 'p':
        case 'P': togglePause(); break;
        case 'n':
        case 'N': startGame(); break;
        default: break;
    }
});

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    const c = Math.floor((x - ORIGIN_X) / CELL);
    const r = Math.floor((y - ORIGIN_Y) / CELL);
    if (!inPlayable(r, c)) return;
    cursor = { r, c };
    placePiece(r, c);
    draw();
});

btnAction.addEventListener('click', confirmAction);
btnNew.addEventListener('click', startGame);
btnStart.addEventListener('click', () => {
    if (state === 'running' || state === 'paused') togglePause();
    else confirmAction();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

loadBest();
state = 'idle';
score = 0;
days = MAX_DAYS;
level = 1;
flooded = 0;
buildLevel({});
showOverlay("Hezekiah's Tunnel", 'Press Space to start the dig.');
updateHud();
draw();
drawQueue();
startLoop();
