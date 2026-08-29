// ---------------------------------------------------------------------------
// Sky Climber — a vertical climbing arcade game on an HTML5 canvas.
//
// The climber straddles two adjacent columns of windows, one hand on each, and
// hauls themself up the face of a skyscraper. A hand may only grab an open
// window and may never be more than one row above or below its partner, so you
// rise by alternating hands. Windows slam shut on your fingers and flower pots
// fall from the roof.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Snake, Tetris
// and BurgerTime in this repo. All motion is expressed per-second and advanced
// through `step(dt)`, so the tests can simulate frames deterministically without
// depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Layout --------------------------------------------------------------
const CANVAS_W = 520;
const CANVAS_H = 640;
const COLS = 5;
const COL_W = 96;
const ROW_H = 56;
const GRID_X = (CANVAS_W - COLS * COL_W) / 2; // 20
const GROUND_H = 60;
const WIN_W = 66;
const WIN_H = 42;
const WIN_INSET_X = (COL_W - WIN_W) / 2;      // 15
const WIN_INSET_Y = 7;

// --- Building ------------------------------------------------------------
const ROWS_BASE = 16;   // rows in the level 1 building (row 0 is the street)
const ROWS_STEP = 3;    // extra rows per level
const START_COL = 1;    // left hand's column at the start of a building

// --- Windows -------------------------------------------------------------
const WARN_TIME = 0.8;  // how long a window flashes before it shuts
const OPEN_MIN = 4.0, OPEN_MAX = 9.0;
const SHUT_MIN = 1.5, SHUT_MAX = 3.5;
const CYCLE_SPEEDUP = 0.88; // window timings shorten by this factor per level

// --- Climber -------------------------------------------------------------
const MOVE_REPEAT = 0.15; // seconds between repeats while a hand key is held
const SLIP_FLASH = 0.35;

// --- Flower pots ---------------------------------------------------------
const POT_SPEED = 180, POT_SPEED_STEP = 24;
const POT_GAP = 3.0, POT_GAP_STEP = 0.2, POT_GAP_MIN = 1.0;
const POT_MAX = 3;        // pots in flight at once, so lanes never all fill up
const POT_R = 13;
const POT_HIT_Y = 26;     // vertical reach of a pot around the climber's body
const GRACE_TIME = 1.5;   // no pot can touch you just after (re)starting a climb

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const ROW_POINTS = 10;
const ROOF_BONUS = 500;
const FALL_PAUSE = 1.5;
const CLEAR_PAUSE = 2.0;
const BEST_KEY = 'skyclimber.best';

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const heightEl = document.getElementById('height');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'falling' | 'levelclear' | 'over'
let state = 'idle';
let score = 0, best = 0, lives = START_LIVES, level = 1;
let rows = ROWS_BASE, roofRow = rows - 1, maxRow = 0;
let windows = [];
let pots = [], potsSpawned = 0, potTimer = 0;
let climber = null;
let camY = 0;
let fallTimer = 0, fallOffset = 0, clearTimer = 0, slipFlash = 0, clock = 0;
let graceTimer = 0;   // brief safety after (re)starting a climb

// Test switches: the specs park the animation loop and the random systems so
// they only ever see the mechanic under test.
let autoStep = true;
let potsEnabled = true;
let windowCycling = true;

// --- Seeded RNG ----------------------------------------------------------
// A linear congruential generator, so a run can be replayed from a seed.
let rngState = 1;
function srand(seed) { rngState = (seed >>> 0) || 1; }
function rand() {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
}
function randRange(a, b) { return a + rand() * (b - a); }
function randInt(n) { return Math.floor(rand() * n) % n; }

// --- Grid helpers --------------------------------------------------------
function colX(c) { return GRID_X + c * COL_W; }
function colCenterX(c) { return GRID_X + (c + 0.5) * COL_W; }
function worldToScreenY(wy) { return (CANVAS_H - GROUND_H) - (wy - camY); }
function rowTopY(r) { return worldToScreenY((r + 1) * ROW_H); }
function rowHandY(r) { return rowTopY(r) + WIN_INSET_Y + WIN_H - 3; }  // the sill you hang from
function windowAt(col, row) { return windows[col][row]; }
function bodyRow() { return Math.min(climber.leftRow, climber.rightRow); }
function bodyWorldY() { return bodyRow() * ROW_H + ROW_H * 0.5; }
function cycleScale() { return Math.pow(CYCLE_SPEEDUP, level - 1); }
function potSpeed() { return POT_SPEED + POT_SPEED_STEP * (level - 1); }
function potGap() {
    return Math.max(POT_GAP_MIN, POT_GAP - POT_GAP_STEP * (level - 1)) * randRange(0.7, 1.3);
}

// --- Windows -------------------------------------------------------------
function buildWindows() {
    windows = [];
    for (let c = 0; c < COLS; c++) {
        const col = [];
        for (let r = 0; r < rows; r++) {
            if (r === 0) {
                // The street ledge is always available, so a slip is never fatal.
                col.push({ state: 'open', timer: Infinity });
            } else if (rand() < 0.85) {
                col.push({ state: 'open', timer: randRange(OPEN_MIN, OPEN_MAX) * cycleScale() });
            } else {
                col.push({ state: 'closed', timer: randRange(SHUT_MIN, SHUT_MAX) * cycleScale() });
            }
        }
        windows.push(col);
    }
}

function openAllWindows() {
    for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < rows; r++) {
            windows[c][r].state = 'open';
            windows[c][r].timer = r === 0 ? Infinity : randRange(OPEN_MIN, OPEN_MAX);
        }
    }
}

function setWindow(col, row, st) {
    const w = windows[col][row];
    w.state = st;
    w.timer = st === 'closing' ? WARN_TIME
        : st === 'closed' ? randRange(SHUT_MIN, SHUT_MAX)
            : randRange(OPEN_MIN, OPEN_MAX);
    return w;
}

function cycleWindows(dt) {
    for (let c = 0; c < COLS; c++) {
        for (let r = 1; r < rows; r++) {
            const w = windows[c][r];
            w.timer -= dt;
            if (w.timer > 0) continue;
            if (w.state === 'open') {
                w.state = 'closing';
                w.timer = WARN_TIME;
            } else if (w.state === 'closing') {
                w.state = 'closed';
                w.timer = randRange(SHUT_MIN, SHUT_MAX) * cycleScale();
            } else {
                w.state = 'open';
                w.timer = randRange(OPEN_MIN, OPEN_MAX) * cycleScale();
            }
        }
    }
}

// --- Climber -------------------------------------------------------------
function placeClimber(col, row) {
    const left = Math.max(0, Math.min(COLS - 2, col));
    const r = Math.max(0, Math.min(roofRow, row));
    climber = {
        leftCol: left, rightCol: left + 1,
        leftRow: r, rightRow: r,
        dispLeftCol: left, dispRightCol: left + 1,
        dispLeftRow: r, dispRightRow: r,
    };
}

function canGrip(col, row) {
    if (col < 0 || col >= COLS || row < 0 || row >= rows) return false;
    return windows[col][row].state === 'open';
}

function tryRaise(side) {
    if (state !== 'running') return false;
    const isLeft = side === 'left';
    const row = isLeft ? climber.leftRow : climber.rightRow;
    const other = isLeft ? climber.rightRow : climber.leftRow;
    const col = isLeft ? climber.leftCol : climber.rightCol;
    const target = row + 1;
    if (target > roofRow) return false;
    if (target - other > 1) return false;      // hands stay within one row
    if (!canGrip(col, target)) return false;
    if (isLeft) climber.leftRow = target; else climber.rightRow = target;
    return true;
}

function tryLower(side) {
    if (state !== 'running') return false;
    const isLeft = side === 'left';
    const row = isLeft ? climber.leftRow : climber.rightRow;
    const other = isLeft ? climber.rightRow : climber.leftRow;
    const col = isLeft ? climber.leftCol : climber.rightCol;
    const target = row - 1;
    if (target < 0) return false;
    if (other - target > 1) return false;
    if (!canGrip(col, target)) return false;
    if (isLeft) climber.leftRow = target; else climber.rightRow = target;
    return true;
}

function tryShift(dir) {
    if (state !== 'running') return false;
    if (climber.leftRow !== climber.rightRow) return false; // both hands must be level
    const nl = climber.leftCol + dir;
    const nr = climber.rightCol + dir;
    if (nl < 0 || nr > COLS - 1) return false;
    const r = climber.leftRow;
    if (!canGrip(nl, r) || !canGrip(nr, r)) return false;
    climber.leftCol = nl;
    climber.rightCol = nr;
    return true;
}

// A window shutting on a hand breaks the grip: the climber slides down to the
// nearest row where both of their columns are open. Row 0 always is.
function checkGrip() {
    const lShut = windowAt(climber.leftCol, climber.leftRow).state === 'closed';
    const rShut = windowAt(climber.rightCol, climber.rightRow).state === 'closed';
    if (!lShut && !rShut) return;
    let target = 0;
    for (let r = bodyRow() - 1; r >= 1; r--) {
        if (canGrip(climber.leftCol, r) && canGrip(climber.rightCol, r)) { target = r; break; }
    }
    if (target === bodyRow()) return;
    climber.leftRow = target;
    climber.rightRow = target;
    slipFlash = SLIP_FLASH;
}

// --- Flower pots ---------------------------------------------------------
function spawnPot(col) {
    const pot = { col, y: camY + CANVAS_H + 30, spin: rand() * Math.PI * 2 };
    pots.push(pot);
    potsSpawned++;
    return pot;
}

function updatePots(dt) {
    if (potsEnabled) {
        potTimer -= dt;
        if (potTimer <= 0) {
            if (pots.length < POT_MAX) spawnPot(randInt(COLS));
            potTimer = potGap();
        }
    }
    const speed = potSpeed();
    const body = bodyWorldY();
    for (let i = pots.length - 1; i >= 0; i--) {
        const p = pots[i];
        p.y -= speed * dt;
        p.spin += dt * 5;
        const inLane = p.col === climber.leftCol || p.col === climber.rightCol;
        if (graceTimer <= 0 && inLane && Math.abs(p.y - body) < POT_HIT_Y) { knockOff(); return; }
        if (p.y < camY - 2 * ROW_H) pots.splice(i, 1);
    }
}

// --- Run flow ------------------------------------------------------------
function knockOff() {
    lives -= 1;
    pots.length = 0;
    fallTimer = FALL_PAUSE;
    fallOffset = 0;
    state = 'falling';
    updateHud();
}

function respawn() {
    placeClimber(START_COL, 0);
    camY = 0;
    fallOffset = 0;
    graceTimer = GRACE_TIME;
    potTimer = potGap();
    state = 'running';
    updateHud();
}

function nextLevel() {
    level += 1;
    rows = ROWS_BASE + ROWS_STEP * (level - 1);
    roofRow = rows - 1;
    buildWindows();
    maxRow = 0;
    pots.length = 0;
    respawn();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* private mode */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Best ${best}`, 'Press Space or Enter to climb again');
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    rows = ROWS_BASE;
    roofRow = rows - 1;
    maxRow = 0;
    pots = [];
    potsSpawned = 0;
    slipFlash = 0;
    autoStep = true;
    potsEnabled = true;
    windowCycling = true;
    srand(Date.now() % 2147483647);
    buildWindows();
    placeClimber(START_COL, 0);
    camY = 0;
    graceTimer = GRACE_TIME;
    potTimer = potGap() + 1.5; // a moment of grace before the first pot
    state = 'running';
    hideOverlay();
    updateHud();
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

// --- Simulation ----------------------------------------------------------
function step(dt) {
    clock += dt;
    if (slipFlash > 0) slipFlash = Math.max(0, slipFlash - dt);

    if (state === 'falling') {
        fallTimer -= dt;
        fallOffset += 620 * dt;
        camY += (0 - camY) * Math.min(1, dt * 4);
        if (fallTimer <= 0) {
            if (lives <= 0) gameOver(); else respawn();
        }
        return;
    }

    if (state === 'levelclear') {
        clearTimer -= dt;
        updateCamera(dt);
        if (clearTimer <= 0) nextLevel();
        return;
    }

    if (state !== 'running') return;

    if (graceTimer > 0) graceTimer = Math.max(0, graceTimer - dt);
    repeatHeldKeys(dt);
    if (windowCycling) cycleWindows(dt);

    if (bodyRow() >= roofRow) {
        score += ROOF_BONUS * level;
        maxRow = Math.max(maxRow, bodyRow());
        pots.length = 0;
        clearTimer = CLEAR_PAUSE;
        state = 'levelclear';
        updateHud();
        return;
    }

    checkGrip();
    updatePots(dt);
    if (state !== 'running') return;   // a pot may have knocked the climber off

    const b = bodyRow();
    if (b > maxRow) {
        score += (b - maxRow) * ROW_POINTS;
        maxRow = b;
    }

    updateCamera(dt);
    updateHud();
}

function updateCamera(dt) {
    const target = Math.max(0, bodyWorldY() - 183);
    camY += (target - camY) * Math.min(1, dt * 5);
    const c = climber;
    const k = Math.min(1, dt * 16);
    c.dispLeftRow += (c.leftRow - c.dispLeftRow) * k;
    c.dispRightRow += (c.rightRow - c.dispRightRow) * k;
    c.dispLeftCol += (c.leftCol - c.dispLeftCol) * k;
    c.dispRightCol += (c.rightCol - c.dispRightCol) * k;
}

// --- HUD / overlay -------------------------------------------------------
function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    heightEl.textContent = String(climber ? bodyRow() : 0);
    livesEl.textContent = String(Math.max(0, lives));
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() { overlay.classList.remove('visible'); }

// --- Input ---------------------------------------------------------------
const ACTIONS = {
    w: 'raiseLeft', W: 'raiseLeft',
    s: 'lowerLeft', S: 'lowerLeft',
    ArrowUp: 'raiseRight',
    ArrowDown: 'lowerRight',
    a: 'shiftLeft', A: 'shiftLeft', ArrowLeft: 'shiftLeft',
    d: 'shiftRight', D: 'shiftRight', ArrowRight: 'shiftRight',
};

const held = new Set();
const repeatIn = {};

function doAction(action) {
    switch (action) {
        case 'raiseLeft': return tryRaise('left');
        case 'lowerLeft': return tryLower('left');
        case 'raiseRight': return tryRaise('right');
        case 'lowerRight': return tryLower('right');
        case 'shiftLeft': return tryShift(-1);
        case 'shiftRight': return tryShift(1);
        default: return false;
    }
}

function repeatHeldKeys(dt) {
    held.forEach((action) => {
        repeatIn[action] -= dt;
        if (repeatIn[action] <= 0) {
            repeatIn[action] = MOVE_REPEAT;
            doAction(action);
        }
    });
}

window.addEventListener('keydown', (e) => {
    const key = e.key;
    if (key === ' ' || key === 'Spacebar' || key === 'ArrowUp' || key === 'ArrowDown'
        || key === 'ArrowLeft' || key === 'ArrowRight') {
        e.preventDefault();
    }
    if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        return;
    }
    if (key === 'p' || key === 'P') { togglePause(); return; }

    const action = ACTIONS[key];
    if (!action || state !== 'running') return;
    if (held.has(action)) return;   // ignore the OS key-repeat; step() paces it
    held.add(action);
    repeatIn[action] = MOVE_REPEAT;
    doAction(action);
});

window.addEventListener('keyup', (e) => {
    const action = ACTIONS[e.key];
    if (action) held.delete(action);
});

window.addEventListener('blur', () => held.clear());

btnStart.addEventListener('click', () => {
    if (state === 'idle' || state === 'over') startGame();
});

// --- Rendering -----------------------------------------------------------
const STARS = Array.from({ length: 90 }, (_, i) => ({
    x: ((i * 137.5) % CANVAS_W),
    y: ((i * 79.3) % 2400),
    r: 0.6 + ((i * 17) % 10) / 9,
}));

function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#040814');
    g.addColorStop(0.55, '#0d1b33');
    g.addColorStop(1, '#22314d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = '#f5f7ff';
    for (const s of STARS) {
        const y = ((s.y + camY * 0.22) % 2400) - 400;
        if (y < -10 || y > CANVAS_H) continue;
        ctx.globalAlpha = 0.35 + 0.45 * (s.r / 1.6);
        ctx.beginPath();
        ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Moon, drifting slowly with the camera.
    const moonY = 70 + camY * 0.05;
    if (moonY < CANVAS_H + 60) {
        ctx.fillStyle = '#f3e9c8';
        ctx.beginPath();
        ctx.arc(78, moonY % (CANVAS_H + 400), 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(13,27,51,0.55)';
        ctx.beginPath();
        ctx.arc(66, (moonY % (CANVAS_H + 400)) - 8, 22, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawSkyline() {
    // A parallax city behind the building, anchored to the street.
    const base = worldToScreenY(0) + 10 - camY * 0.12;
    if (base < -80) return;
    ctx.fillStyle = '#0a1526';
    let x = -20;
    let i = 0;
    while (x < CANVAS_W + 40) {
        const w = 34 + ((i * 53) % 40);
        const h = 60 + ((i * 97) % 150);
        ctx.fillRect(x, base - h, w, h + 200);
        ctx.fillStyle = 'rgba(255, 214, 130, 0.16)';
        for (let ly = base - h + 10; ly < base - 8; ly += 16) {
            for (let lx = x + 6; lx < x + w - 8; lx += 14) {
                if (((lx + ly + i) % 3) === 0) ctx.fillRect(lx, ly, 6, 8);
            }
        }
        ctx.fillStyle = '#0a1526';
        x += w + 10;
        i++;
    }
}

function drawBuilding() {
    const left = GRID_X - 14;
    const right = GRID_X + COLS * COL_W + 14;
    const topScreen = rowTopY(roofRow) - 26;
    const bottom = worldToScreenY(0);

    // Facade slab.
    const g = ctx.createLinearGradient(left, 0, right, 0);
    g.addColorStop(0, '#2a3450');
    g.addColorStop(0.5, '#354162');
    g.addColorStop(1, '#232c45');
    ctx.fillStyle = g;
    ctx.fillRect(left, Math.max(topScreen, -50), right - left, Math.min(bottom, CANVAS_H) - Math.max(topScreen, -50));

    // Concrete banding between rows.
    ctx.fillStyle = 'rgba(10, 16, 30, 0.45)';
    const firstRow = Math.max(0, Math.floor(camY / ROW_H) - 1);
    const lastRow = Math.min(roofRow, firstRow + Math.ceil(CANVAS_H / ROW_H) + 2);
    for (let r = firstRow; r <= lastRow; r++) {
        ctx.fillRect(left, rowTopY(r) - 4, right - left, 5);
    }

    for (let r = firstRow; r <= lastRow; r++) {
        for (let c = 0; c < COLS; c++) drawWindow(c, r);
    }

    drawRoof(topScreen, left, right);
}

function drawWindow(c, r) {
    const w = windows[c][r];
    const x = colX(c) + WIN_INSET_X;
    const y = rowTopY(r) + WIN_INSET_Y;

    if (r === 0) {
        // Street level: an open colonnade rather than a window.
        ctx.fillStyle = '#131b2e';
        ctx.fillRect(x - 4, y, WIN_W + 8, WIN_H + 6);
        ctx.fillStyle = '#e8b04b';
        ctx.fillRect(x - 4, y + WIN_H + 2, WIN_W + 8, 4);
        return;
    }

    const lit = ((c * 7 + r * 13) % 3) === 0;   // which rooms have a light on

    if (w.state === 'open') {
        ctx.fillStyle = '#080d18';
        ctx.fillRect(x, y, WIN_W, WIN_H);
        if (lit) {
            ctx.fillStyle = 'rgba(255, 209, 102, 0.18)';
            ctx.fillRect(x + 6, y + 6, WIN_W - 12, WIN_H - 12);
        }
        // The raised sash sits above the opening you can reach into.
        ctx.fillStyle = '#93a8cd';
        ctx.fillRect(x, y - 4, WIN_W, 7);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(x, y, WIN_W, 6);
    } else if (w.state === 'closing') {
        const pulse = 0.45 + 0.55 * Math.abs(Math.sin(clock * 12));
        ctx.fillStyle = '#0b1120';
        ctx.fillRect(x, y, WIN_W, WIN_H);
        ctx.fillStyle = `rgba(255, 138, 76, ${pulse})`;
        ctx.fillRect(x, y, WIN_W, WIN_H * 0.42);
        ctx.strokeStyle = `rgba(255, 209, 102, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, WIN_W - 2, WIN_H - 2);
    } else {
        const glass = ctx.createLinearGradient(x, y, x + WIN_W, y + WIN_H);
        glass.addColorStop(0, lit ? '#8a7f63' : '#5f7098');
        glass.addColorStop(1, lit ? '#4d4433' : '#3b4a6d');
        ctx.fillStyle = glass;
        ctx.fillRect(x, y, WIN_W, WIN_H);
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath();
        ctx.moveTo(x, y + WIN_H);
        ctx.lineTo(x + WIN_W, y);
        ctx.lineTo(x + WIN_W, y + 12);
        ctx.lineTo(x + 14, y + WIN_H);
        ctx.closePath();
        ctx.fill();
    }

    ctx.strokeStyle = 'rgba(8, 12, 24, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, WIN_W, WIN_H);
    ctx.fillStyle = '#9fb0d2';
    ctx.fillRect(x - 5, y + WIN_H, WIN_W + 10, 5);  // the sill you hang from
}

function drawRoof(topScreen, left, right) {
    if (topScreen > CANVAS_H) return;
    ctx.fillStyle = '#46557d';
    ctx.fillRect(left - 8, topScreen, right - left + 16, 26);
    ctx.fillStyle = '#1a2338';
    ctx.fillRect(left - 8, topScreen, right - left + 16, 6);

    // A flag to aim for.
    const fx = right - 40;
    ctx.fillStyle = '#c9d4ea';
    ctx.fillRect(fx, topScreen - 46, 3, 46);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(fx + 3, topScreen - 46);
    ctx.lineTo(fx + 33, topScreen - 38);
    ctx.lineTo(fx + 3, topScreen - 30);
    ctx.closePath();
    ctx.fill();
}

function drawGround() {
    const y = worldToScreenY(0);
    if (y > CANVAS_H) return;
    ctx.fillStyle = '#141c2e';
    ctx.fillRect(0, y, CANVAS_W, CANVAS_H - y);
    ctx.fillStyle = '#2a3550';
    ctx.fillRect(0, y, CANVAS_W, 5);
    ctx.fillStyle = 'rgba(255, 209, 102, 0.35)';
    for (let x = 12; x < CANVAS_W; x += 46) ctx.fillRect(x, y + 22, 24, 3);
}

function drawPots() {
    for (const p of pots) {
        const x = colCenterX(p.col);
        const y = worldToScreenY(p.y);
        if (y < -40 || y > CANVAS_H + 40) continue;

        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#8c6239';
        ctx.beginPath();
        ctx.ellipse(x, y - 18, POT_R * 0.6, POT_R * 1.1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(p.spin) * 0.35);
        ctx.fillStyle = '#b4573a';
        ctx.beginPath();
        ctx.moveTo(-POT_R, -POT_R * 0.7);
        ctx.lineTo(POT_R, -POT_R * 0.7);
        ctx.lineTo(POT_R * 0.62, POT_R);
        ctx.lineTo(-POT_R * 0.62, POT_R);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#d16f4c';
        ctx.fillRect(-POT_R - 2, -POT_R, (POT_R + 2) * 2, 7);
        ctx.fillStyle = '#5fae57';
        ctx.beginPath();
        ctx.arc(-4, -POT_R - 5, 6, 0, Math.PI * 2);
        ctx.arc(6, -POT_R - 7, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Warning chevrons for pots still above the view.
    for (const p of pots) {
        if (worldToScreenY(p.y) >= -10) continue;
        const x = colCenterX(p.col);
        ctx.fillStyle = `rgba(239, 91, 76, ${0.5 + 0.5 * Math.abs(Math.sin(clock * 8))})`;
        ctx.beginPath();
        ctx.moveTo(x - 10, 8);
        ctx.lineTo(x + 10, 8);
        ctx.lineTo(x, 22);
        ctx.closePath();
        ctx.fill();
    }
}

function drawClimber() {
    if (!climber) return;
    const drop = state === 'falling' ? fallOffset : 0;
    const lx = colCenterX(climber.dispLeftCol);
    const rx = colCenterX(climber.dispRightCol);
    const ly = rowHandY(climber.dispLeftRow) + drop;
    const ry = rowHandY(climber.dispRightRow) + drop;
    const cx = (lx + rx) / 2;
    const cy = Math.max(ly, ry) + 36;
    const sway = Math.sin(clock * 3) * 2;
    const flash = slipFlash > 0 && Math.floor(slipFlash * 20) % 2 === 0;

    // A soft shadow on the wall lifts the climber off the facade.
    ctx.fillStyle = 'rgba(4, 8, 18, 0.18)';
    ctx.beginPath();
    ctx.ellipse(cx + 9, cy + 4, 20, 30, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = flash ? '#ffd166' : '#f0f4ff';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';

    // Arms.
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 16);
    ctx.lineTo(lx, ly);
    ctx.moveTo(cx + 8, cy - 16);
    ctx.lineTo(rx, ry);
    ctx.stroke();

    // Legs.
    ctx.strokeStyle = '#2f6fd0';
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + 12);
    ctx.lineTo(cx - 14 + sway, cy + 34);
    ctx.moveTo(cx + 6, cy + 12);
    ctx.lineTo(cx + 14 + sway, cy + 34);
    ctx.stroke();

    // Torso.
    ctx.fillStyle = flash ? '#ffd166' : '#ef5b4c';
    ctx.beginPath();
    ctx.roundRect(cx - 12, cy - 20, 24, 34, 8);
    ctx.fill();

    // Head.
    ctx.fillStyle = '#f6d7b0';
    ctx.beginPath();
    ctx.arc(cx, cy - 30, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b2540';
    ctx.fillRect(cx - 10, cy - 38, 20, 6);

    // Hands.
    ctx.fillStyle = '#f6d7b0';
    for (const [hx, hy] of [[lx, ly], [rx, ry]]) {
        ctx.beginPath();
        ctx.arc(hx, hy, 5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBanner(text, sub) {
    ctx.fillStyle = 'rgba(5, 8, 18, 0.72)';
    ctx.fillRect(0, CANVAS_H / 2 - 60, CANVAS_W, 120);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2 - 6);
    if (sub) {
        ctx.fillStyle = '#c9d4ea';
        ctx.font = '16px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(sub, CANVAS_W / 2, CANVAS_H / 2 + 28);
    }
    ctx.textAlign = 'left';
}

function drawHeightRibbon() {
    if (!climber) return;
    const pct = Math.min(1, bodyRow() / Math.max(1, roofRow));
    const x = CANVAS_W - 14;
    const top = 24, bottom = CANVAS_H - 24;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x - 3, top, 6, bottom - top);
    ctx.fillStyle = '#ffd166';
    const y = bottom - (bottom - top) * pct;
    ctx.fillRect(x - 5, y - 3, 10, 6);
}

function draw() {
    drawSky();
    drawSkyline();
    if (windows.length) {
        drawBuilding();
        drawGround();
        drawPots();
        drawClimber();
        drawHeightRibbon();
    } else {
        drawGround();
    }

    if (state === 'levelclear') drawBanner(`LEVEL ${level} CLEARED`, `+${ROOF_BONUS * level} points`);
    if (state === 'falling') drawBanner('WHOA!', lives > 0 ? `${lives} climber${lives === 1 ? '' : 's'} left` : 'Last one');
}

// --- Boot ----------------------------------------------------------------
try {
    best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
} catch (e) {
    best = 0;
}

rows = ROWS_BASE;
roofRow = rows - 1;
srand(20260828);
buildWindows();
placeClimber(START_COL, 0);
updateHud();

let lastTs = 0;
function loop(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    if (autoStep) step(dt);
    draw();
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
