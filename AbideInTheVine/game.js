// ---------------------------------------------------------------------------
// Abide in the Vine — a grid-based growing-trail game (John 15:5)
//
// Steer the growing tip of a vine around a walled garden, gathering grape
// clusters. Every cluster adds length; the run ends when the tip grows into the
// wall, a trellis stone, or the vine's own stem.
//
// The model is kept in plain globals so the Playwright suite can drive it
// directly, mirroring the other games in this repository. All motion happens in
// whole grid cells inside `advance()`; `step(dt)` only decides when a tick is
// due, so the simulation never depends on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Board geometry ---
const CELL = 20;
const COLS = 30;
const ROWS = 20;
const CANVAS_W = COLS * CELL;   // 600
const CANVAS_H = ROWS * CELL;   // 400

// --- Rules ---
const START_LENGTH = 4;
const START_X = 8;
const START_Y = 10;
const GROW_PER_FRUIT = 3;
const GRAPE_POINTS = 10;
const FIG_POINTS = 50;
const FRUIT_PER_LEVEL = 5;
const FIG_EVERY = 4;            // a fig appears on every 4th grape
const FIG_TICKS = 40;           // how long a fig stays on the board
const FIG_BLINK_TICKS = 10;     // it blinks over its final ticks
const STONES_PER_LEVEL = 2;
const MAX_STONES = 16;
const SAFE_CELLS_AHEAD = 3;     // no new stone may land this close in front

// --- Speed (pure functions of `fruit`) ---
const TICK_BASE = 140;          // ms per cell at the start of a run
const TICK_STEP = 5;            // ms shaved off per grape gathered
const TICK_MIN = 70;            // fastest the vine ever moves

const BEST_KEY = 'abide-in-the-vine-best';

// --- Model -----------------------------------------------------------------
let state = 'idle';             // idle | running | paused | over | won
let vine = [];                  // vine[0] is the growing tip
let dir = { x: 1, y: 0 };
let pendingDirs = [];           // queued turns (at most 2)
let grape = null;
let fig = null;                 // { x, y, ticks }
let stones = [];
let score = 0;
let best = 0;
let fruit = 0;
let level = 1;
let growth = 0;                 // cells still to be added
let tickMs = TICK_BASE;
let tickTimer = 0;
let ticks = 0;                  // ticks since the run began (for animation)

// --- DOM -------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elFruit = document.getElementById('fruit');
const elLevel = document.getElementById('level');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sameCell(a, b) {
    return !!a && !!b && a.x === b.x && a.y === b.y;
}

function onVine(x, y) {
    return vine.some((c) => c.x === x && c.y === y);
}

function onStone(x, y) {
    return stones.some((s) => s.x === x && s.y === y);
}

function inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

// A cell is free when nothing of substance occupies it.
function cellFree(x, y) {
    if (!inBounds(x, y)) return false;
    if (onVine(x, y) || onStone(x, y)) return false;
    if (sameCell(grape, { x, y })) return false;
    if (sameCell(fig, { x, y })) return false;
    return true;
}

function freeCells(extraBlocked) {
    const out = [];
    for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < ROWS; y++) {
            if (!cellFree(x, y)) continue;
            if (extraBlocked && extraBlocked.some((c) => c.x === x && c.y === y)) continue;
            out.push({ x, y });
        }
    }
    return out;
}

function pick(cells) {
    return cells.length ? cells[Math.floor(Math.random() * cells.length)] : null;
}

function refreshSpeed() {
    tickMs = Math.max(TICK_MIN, TICK_BASE - fruit * TICK_STEP);
}

function refreshLevel() {
    level = 1 + Math.floor(fruit / FRUIT_PER_LEVEL);
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

function spawnGrape() {
    const old = grape;
    grape = null;
    const cell = pick(freeCells(old ? [old] : null)) || pick(freeCells());
    if (!cell) {
        grape = old;
        gardenFull();
        return false;
    }
    grape = cell;
    return true;
}

function spawnFig() {
    const cell = pick(freeCells());
    if (!cell) return false;
    fig = { x: cell.x, y: cell.y, ticks: FIG_TICKS };
    return true;
}

// Trellis stones appear at a level-up. They never land on the vine, on fruit,
// or in the cells the player is about to drive through.
function addStones(count) {
    const wanted = count === undefined ? STONES_PER_LEVEL : count;
    const ahead = [];
    if (vine.length) {
        for (let i = 1; i <= SAFE_CELLS_AHEAD; i++) {
            ahead.push({ x: vine[0].x + dir.x * i, y: vine[0].y + dir.y * i });
        }
    }
    for (let i = 0; i < wanted && stones.length < MAX_STONES; i++) {
        const cell = pick(freeCells(ahead));
        if (!cell) return;
        stones.push(cell);
    }
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function startGame() {
    vine = [];
    for (let i = 0; i < START_LENGTH; i++) vine.push({ x: START_X - i, y: START_Y });
    dir = { x: 1, y: 0 };
    pendingDirs = [];
    stones = [];
    fig = null;
    grape = null;
    score = 0;
    fruit = 0;
    level = 1;
    growth = 0;
    ticks = 0;
    tickTimer = 0;
    refreshSpeed();
    spawnGrape();
    state = 'running';
    hideOverlay();
    updateHud();
    draw();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to carry on');
    } else if (state === 'paused') {
        state = 'running';
        tickTimer = 0;
        hideOverlay();
    }
}

function recordBest() {
    if (score > best) {
        best = score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* private mode */ }
    }
    updateHud();
}

function gameOver() {
    state = 'over';
    recordBest();
    showOverlay(
        'THE VINE IS TANGLED',
        `Score ${score} — ${fruit} ${fruit === 1 ? 'cluster' : 'clusters'} gathered`,
        'Press Space to grow again'
    );
    draw();
}

// The vine has filled the garden: there is nowhere left to put fruit.
function gardenFull() {
    state = 'won';
    recordBest();
    showOverlay(
        'MUCH FRUIT!',
        `Score ${score} — the garden is full`,
        'Press Space to plant again'
    );
    draw();
}

// ---------------------------------------------------------------------------
// Input model
// ---------------------------------------------------------------------------

// Queue a turn. Reversals (and repeats) of the direction the tip is about to
// travel are ignored, so the vine can never double back into its own stem.
function setDirection(dx, dy) {
    if (state !== 'running') return false;
    if ((dx === 0) === (dy === 0)) return false;        // must be one axis only
    const last = pendingDirs.length ? pendingDirs[pendingDirs.length - 1] : dir;
    if (dx === last.x && dy === last.y) return false;
    if (dx === -last.x && dy === -last.y) return false;
    if (pendingDirs.length >= 2) return false;
    pendingDirs.push({ x: dx, y: dy });
    return true;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

// One grid tick: the tip moves exactly one cell.
function advance() {
    if (state !== 'running') return;
    ticks++;

    if (pendingDirs.length) dir = pendingDirs.shift();

    const next = { x: vine[0].x + dir.x, y: vine[0].y + dir.y };
    const tail = vine[vine.length - 1];
    const tailVacates = growth === 0 && sameCell(tail, next) && !sameCell(next, grape);

    if (!inBounds(next.x, next.y) || onStone(next.x, next.y) ||
        (onVine(next.x, next.y) && !tailVacates)) {
        gameOver();
        return;
    }

    const ateGrape = sameCell(grape, next);
    const ateFig = sameCell(fig, next);

    vine.unshift(next);

    if (ateGrape) {
        fruit++;
        score += GRAPE_POINTS;
        growth += GROW_PER_FRUIT;
        const before = level;
        refreshLevel();
        refreshSpeed();
        if (level > before) addStones();
        if (fruit % FIG_EVERY === 0 && !fig) spawnFig();
        spawnGrape();
    }

    if (ateFig) {
        score += FIG_POINTS;
        fig = null;
    }

    if (growth > 0) growth--;
    else vine.pop();

    if (fig) {
        fig.ticks--;
        if (fig.ticks <= 0) fig = null;
    }

    updateHud();
}

// Advance the clock; `advance()` runs once per `tickMs`.
function step(dt) {
    if (state !== 'running') return;
    tickTimer += dt * 1000;
    let guard = 0;
    while (tickTimer >= tickMs && state === 'running' && guard++ < 10) {
        tickTimer -= tickMs;
        advance();
    }
    if (state !== 'running') tickTimer = 0;
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elFruit.textContent = String(fruit);
    elLevel.textContent = String(level);
    elBest.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function cx(x) { return x * CELL + CELL / 2; }
function cy(y) { return y * CELL + CELL / 2; }

function drawGarden() {
    const soil = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    soil.addColorStop(0, '#13291a');
    soil.addColorStop(1, '#0a1a0e');
    ctx.fillStyle = soil;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // faint furrows for the garden rows
    ctx.strokeStyle = 'rgba(163, 217, 119, 0.05)';
    ctx.lineWidth = 1;
    for (let y = 1; y < ROWS; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CELL + 0.5);
        ctx.lineTo(CANVAS_W, y * CELL + 0.5);
        ctx.stroke();
    }
    for (let x = 1; x < COLS; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CELL + 0.5, 0);
        ctx.lineTo(x * CELL + 0.5, CANVAS_H);
        ctx.stroke();
    }

    // the garden wall
    ctx.strokeStyle = 'rgba(163, 217, 119, 0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, CANVAS_W - 3, CANVAS_H - 3);
}

function drawStones() {
    for (const s of stones) {
        const px = cx(s.x);
        const py = cy(s.y);
        // a stable per-stone wobble so each stone keeps its own shape
        const seed = ((s.x * 73856093) ^ (s.y * 19349663)) >>> 0;
        const r = CELL * 0.42;
        ctx.save();
        ctx.translate(px, py);
        ctx.beginPath();
        for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2;
            const rr = r * (0.82 + (((seed >> (i * 3)) & 7) / 7) * 0.3);
            const vx = Math.cos(a) * rr;
            const vy = Math.sin(a) * rr * 0.9;
            if (i === 0) ctx.moveTo(vx, vy);
            else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        const g = ctx.createLinearGradient(0, -r, 0, r);
        g.addColorStop(0, '#93a197');
        g.addColorStop(1, '#46534a');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.beginPath();
        ctx.ellipse(-r * 0.25, -r * 0.35, r * 0.34, r * 0.18, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function drawGrapes(cell, scale) {
    const px = cx(cell.x);
    const py = cy(cell.y);
    const r = 3.3 * scale;
    const berries = [[0, -4], [-4, -1], [4, -1], [-2, 3], [2, 3], [0, 7]];

    ctx.strokeStyle = '#7a9a57';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(px, py - 6 * scale);
    ctx.lineTo(px + 1, py - 10 * scale);
    ctx.stroke();
    drawLeaf(px + 1, py - 10 * scale, -0.6, 7 * scale);

    for (const [bx, by] of berries) {
        const gx = px + bx * scale;
        const gy = py + by * scale;
        const g = ctx.createRadialGradient(gx - 1.2, gy - 1.2, 0.4, gx, gy, r);
        g.addColorStop(0, '#cda9f2');
        g.addColorStop(1, '#5e2f94');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(gx, gy, r, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawFig() {
    if (!fig) return;
    if (fig.ticks <= FIG_BLINK_TICKS && fig.ticks % 2 === 0) return;  // blink out
    const px = cx(fig.x);
    const py = cy(fig.y);
    // a soft halo so the bonus fruit stands out from the grapes
    const halo = ctx.createRadialGradient(px, py, 2, px, py, 14);
    halo.addColorStop(0, 'rgba(214, 160, 245, 0.35)');
    halo.addColorStop(1, 'rgba(214, 160, 245, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(px, py, 14, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(px - 2, py - 2, 1, px, py, 11);
    g.addColorStop(0, '#a35fbd');
    g.addColorStop(1, '#4d2360');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(px, py - 8);
    ctx.bezierCurveTo(px + 9, py - 3, px + 8, py + 9, px, py + 9);
    ctx.bezierCurveTo(px - 8, py + 9, px - 9, py - 3, px, py - 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.beginPath();
    ctx.ellipse(px - 2.6, py, 2.2, 3.6, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8fb867';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py - 7);
    ctx.lineTo(px + 2, py - 11);
    ctx.stroke();
    drawLeaf(px + 2, py - 11, -0.5, 7);
}

// A single leaf growing out from (px, py) along `angle`.
function drawLeaf(px, py, angle, size) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(0, 0, size, 0);
    g.addColorStop(0, '#54913a');
    g.addColorStop(1, '#95d861');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(size * 0.55, -size * 0.52, size, 0);
    ctx.quadraticCurveTo(size * 0.55, size * 0.52, 0, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(22, 56, 18, 0.5)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(size * 0.08, 0);
    ctx.lineTo(size * 0.9, 0);
    ctx.stroke();
    ctx.restore();
}

function drawVine() {
    if (!vine.length) return;

    // the stem: one rounded stroke running from the tail up to the tip
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const tip = vine[0];
    const tail = vine[vine.length - 1];
    const stem = ctx.createLinearGradient(cx(tail.x), cy(tail.y), cx(tip.x), cy(tip.y));
    stem.addColorStop(0, '#2f6227');
    stem.addColorStop(1, '#8ccc5b');

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = CELL * 0.7;
    strokeVinePath();
    ctx.strokeStyle = stem;
    ctx.lineWidth = CELL * 0.56;
    strokeVinePath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = CELL * 0.18;
    strokeVinePath();

    // leaves every third segment, alternating sides
    for (let i = 2; i < vine.length - 1; i += 3) {
        const c = vine[i];
        const towardTip = { x: vine[i - 1].x - c.x, y: vine[i - 1].y - c.y };
        const side = (i % 6 === 2) ? 1 : -1;
        const along = Math.atan2(towardTip.y, towardTip.x);
        drawLeaf(cx(c.x), cy(c.y), along + side * 1.9, 11);
    }

    drawTip();
}

function strokeVinePath() {
    ctx.beginPath();
    ctx.moveTo(cx(vine[vine.length - 1].x), cy(vine[vine.length - 1].y));
    for (let i = vine.length - 2; i >= 0; i--) ctx.lineTo(cx(vine[i].x), cy(vine[i].y));
    if (vine.length === 1) ctx.lineTo(cx(vine[0].x) + 0.01, cy(vine[0].y));
    ctx.stroke();
}

function drawTip() {
    const tip = vine[0];
    const px = cx(tip.x);
    const py = cy(tip.y);
    const angle = Math.atan2(dir.y, dir.x);

    // a curling tendril reaching out ahead of the growing tip
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.strokeStyle = '#c3ef96';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(4, 0);
    for (let t = 0; t <= 1.001; t += 0.08) {
        const a = t * Math.PI * 2.4;
        const rad = 1.2 + t * 4.4;
        ctx.lineTo(9 + Math.cos(a) * rad * 0.7, Math.sin(a) * rad * 0.7);
    }
    ctx.stroke();
    ctx.restore();

    const g = ctx.createRadialGradient(px - 2, py - 2, 1, px, py, CELL * 0.5);
    g.addColorStop(0, '#e6ffc6');
    g.addColorStop(1, '#7cc24c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, CELL * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // two young leaves unfurling at the tip
    drawLeaf(px, py, angle - 2.2, 9);
    drawLeaf(px, py, angle + 2.2, 9);
}

function draw() {
    drawGarden();
    drawStones();
    if (grape) drawGrapes(grape, 1.1);
    drawFig();
    drawVine();
}

// ---------------------------------------------------------------------------
// Real-time loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0;
    lastTime = now;
    if (state === 'running') step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

const DIRS = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1],
};

function startOrRestart() {
    if (state === 'paused') togglePause();
    else if (state !== 'running') startGame();
}

window.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (key === 'p') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }

    if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
        startOrRestart();
        e.preventDefault();
        return;
    }

    const d = DIRS[key];
    if (d) {
        if (state === 'running') setDirection(d[0], d[1]);
        else startOrRestart();
        e.preventDefault();
    }
});

// ---------------------------------------------------------------------------
// Touch: swipe to steer
// ---------------------------------------------------------------------------

const SWIPE_MIN = 20;
let touchStart = null;

function touchPoint(e) {
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    return t ? { x: t.clientX, y: t.clientY } : null;
}

canvas.addEventListener('touchstart', (e) => {
    touchStart = touchPoint(e);
    if (state !== 'running' && state !== 'paused') { startOrRestart(); }
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    const p = touchPoint(e);
    if (!p || !touchStart) return;
    const dx = p.x - touchStart.x;
    const dy = p.y - touchStart.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
    if (Math.abs(dx) > Math.abs(dy)) setDirection(Math.sign(dx), 0);
    else setDirection(0, Math.sign(dy));
    touchStart = p;
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', () => { touchStart = null; });

btnStart.addEventListener('click', () => startOrRestart());

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
state = 'idle';
vine = [];
for (let i = 0; i < START_LENGTH; i++) vine.push({ x: START_X - i, y: START_Y });
grape = { x: 20, y: 10 };
updateHud();
draw();
requestAnimationFrame(frame);
