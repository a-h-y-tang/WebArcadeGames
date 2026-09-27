// ---------------------------------------------------------------------------
// Sky Climber — a two-handed skyscraper climb on an HTML5 canvas.
//
// The building face is a grid of windows. The climber's left and right hands
// are controlled independently (WASD and the arrow keys) and each hand moves
// one window per key press. The hands may never be more than one row apart, so
// the only way up is to alternate them. Shutters slam closed under your grip
// and flower pots drop from the roof; either one knocks you down the wall.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Snake, Tetris
// and BurgerTime in this repo. All motion is expressed per-second and advanced
// through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Wall geometry -------------------------------------------------------
const COLS = 7;
const CELL_W = 80;
const CELL_H = 60;
const CANVAS_W = COLS * CELL_W;   // 560
const CANVAS_H = 480;
const GROUND_H = 40;              // street strip along the bottom
const CAM_LAG = 2;                // rows kept below the climber
const CAM_SPEED = 6;              // how fast the camera catches up

// Row 0 is street level and rows count upward; `roofRow` is the roof ledge.
const ROOF_BASE = 20;
const ROOF_STEP = 5;

// --- Shutters ------------------------------------------------------------
const SHUTTER_TELEGRAPH = 0.7;    // seconds of warning before a window shuts
const SHUTTER_CLOSED = 3.0;       // seconds a shut window stays shut
const SHUTTER_INTERVAL = 1.6;     // seconds between shutter events on level 1
const SHUTTER_INTERVAL_MIN = 0.7;
const SHUTTER_INTERVAL_STEP = 0.1;
const VISIBLE_ROWS = 8;           // band the shutter scheduler picks from

// --- Flower pots ---------------------------------------------------------
const POT_INTERVAL = 2.2;         // seconds between pots on level 1
const POT_INTERVAL_MIN = 0.9;
const POT_INTERVAL_STEP = 0.15;
const FIRST_POT = 2.5;
const POT_SPEED = 4;              // rows per second on level 1
const POT_SPEED_STEP = 0.3;
const POT_SPAWN_ABOVE = 2;        // rows above the roof a pot appears
const POT_HIT_RANGE = 0.7;        // rows

// --- Climber -------------------------------------------------------------
const START_LIVES = 3;
const FALL_ROWS = 3;              // how far a knock drops you
const INVULN = 1.5;               // seconds of grace after a knock

// --- Scoring -------------------------------------------------------------
const ROW_POINTS = 10;
const ROOF_BONUS = 500;
const BEST_KEY = 'skyclimber-best';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';               // idle | running | paused | over
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let roofRow = ROOF_BASE;
let maxHeight = 0;

let wall = [];                    // wall[row][col] = { state, timer }
let pots = [];
let leftHand = { col: 3, row: 0 };
let rightHand = { col: 4, row: 0 };

let camRow = 0;
let invuln = 0;
let shutterTimer = SHUTTER_INTERVAL;
let potTimer = FIRST_POT;
let banner = '';
let bannerTimer = 0;
let inputCount = 0;               // bumped by every keydown, for the tests

// Hazard sources the specs switch off to keep long simulations deterministic.
let potSpawnEnabled = true;
let shutterEnabled = true;

// --- Seeded RNG ----------------------------------------------------------
let seed = 20240816;

function setSeed(n) {
    seed = n >>> 0;
}

function rng() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
}

function randInt(n) {
    return Math.floor(rng() * n);
}

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
const elLives = document.getElementById('lives');
const elHeight = document.getElementById('height');
const elBest = document.getElementById('best');

// ---------------------------------------------------------------------------
// Wall helpers
// ---------------------------------------------------------------------------

function buildWall() {
    wall = [];
    for (let row = 0; row <= roofRow; row++) {
        const cells = [];
        for (let col = 0; col < COLS; col++) cells.push({ state: 'open', timer: 0 });
        wall.push(cells);
    }
}

function inBounds(row, col) {
    return row >= 0 && row <= roofRow && col >= 0 && col < COLS;
}

function cellState(row, col) {
    return inBounds(row, col) ? wall[row][col].state : 'closed';
}

function openCell(row, col) {
    if (!inBounds(row, col)) return;
    wall[row][col].state = 'open';
    wall[row][col].timer = 0;
}

// Start a window closing. The roof ledge is always safe, so the last grab of a
// building can never be stolen.
function triggerShutter(row, col) {
    if (!inBounds(row, col) || row === roofRow) return false;
    const cell = wall[row][col];
    if (cell.state !== 'open') return false;
    cell.state = 'closing';
    cell.timer = SHUTTER_TELEGRAPH;
    return true;
}

// ---------------------------------------------------------------------------
// Climber
// ---------------------------------------------------------------------------

function resetClimber() {
    leftHand = { col: 3, row: 0 };
    rightHand = { col: 4, row: 0 };
    openCell(0, leftHand.col);
    openCell(0, rightHand.col);
    maxHeight = 0;
    invuln = 0;
    camRow = 0;
}

function handRow() {
    return Math.min(leftHand.row, rightHand.row);
}

function bodyRow() {
    return (leftHand.row + rightHand.row) / 2;
}

// The single gate for all movement. A move is legal when the target window is
// on the wall and open, the hands do not share a cell, the left hand stays left
// of (or level with) the right hand within one column, and the hands stay
// within one row of each other.
function moveHand(which, dx, dy) {
    if (state !== 'running') return false;
    const hand = which === 'left' ? leftHand : rightHand;
    const other = which === 'left' ? rightHand : leftHand;
    const col = hand.col + dx;
    const row = hand.row + dy;

    if (!inBounds(row, col)) return false;
    if (col === other.col && row === other.row) return false;
    if (Math.abs(row - other.row) > 1) return false;

    const spread = which === 'left' ? other.col - col : col - other.col;
    if (spread < 0 || spread > 1) return false;
    if (cellState(row, col) !== 'open') return false;

    hand.col = col;
    hand.row = row;
    return true;
}

// A shutter under a hand or a pot to the head: lose a life and slide down the
// wall. Both landing windows are forced open so there is always something to
// grab, and a moment of grace prevents an instant second hit.
function knock() {
    if (state !== 'running' || invuln > 0) return;

    lives--;
    const row = Math.max(0, handRow() - FALL_ROWS);
    leftHand.row = row;
    rightHand.row = row;
    if (leftHand.col === rightHand.col) {
        if (leftHand.col > 0) leftHand.col--;
        else rightHand.col++;
    }
    openCell(row, leftHand.col);
    openCell(row, rightHand.col);
    invuln = INVULN;
    updateHud();

    if (lives <= 0) gameOver();
}

// ---------------------------------------------------------------------------
// Difficulty curve
// ---------------------------------------------------------------------------

function shutterInterval() {
    return Math.max(SHUTTER_INTERVAL_MIN, SHUTTER_INTERVAL - (level - 1) * SHUTTER_INTERVAL_STEP);
}

function potInterval() {
    return Math.max(POT_INTERVAL_MIN, POT_INTERVAL - (level - 1) * POT_INTERVAL_STEP);
}

function potSpeed() {
    return POT_SPEED + (level - 1) * POT_SPEED_STEP;
}

// ---------------------------------------------------------------------------
// Pots
// ---------------------------------------------------------------------------

function spawnPot(col) {
    pots.push({ col, row: roofRow + POT_SPAWN_ABOVE, spin: rng() * Math.PI });
    return pots[pots.length - 1];
}

function potHitsClimber(pot) {
    if (pot.col === leftHand.col && Math.abs(pot.row - leftHand.row) < POT_HIT_RANGE) return true;
    if (pot.col === rightHand.col && Math.abs(pot.row - rightHand.row) < POT_HIT_RANGE) return true;
    return false;
}

function updatePots(dt) {
    const speed = potSpeed();
    for (let i = pots.length - 1; i >= 0; i--) {
        const pot = pots[i];
        pot.row -= speed * dt;
        if (pot.row < -POT_SPAWN_ABOVE) {
            pots.splice(i, 1);
            continue;
        }
        if (invuln <= 0 && potHitsClimber(pot)) {
            pots.splice(i, 1);
            knock();
        }
    }

    if (!potSpawnEnabled) return;
    potTimer -= dt;
    if (potTimer <= 0) {
        potTimer = potInterval();
        spawnPot(randInt(COLS));
    }
}

// ---------------------------------------------------------------------------
// Shutters
// ---------------------------------------------------------------------------

function updateShutters(dt) {
    for (let row = 0; row < wall.length; row++) {
        const cells = wall[row];
        for (let col = 0; col < COLS; col++) {
            const cell = cells[col];
            if (cell.state === 'open') continue;
            cell.timer -= dt;
            if (cell.timer > 0) continue;

            if (cell.state === 'closing') {
                cell.state = 'closed';
                cell.timer = SHUTTER_CLOSED;
                const caught =
                    (leftHand.row === row && leftHand.col === col) ||
                    (rightHand.row === row && rightHand.col === col);
                if (caught) knock();
            } else {
                cell.state = 'open';
                cell.timer = 0;
            }
        }
    }

    if (!shutterEnabled) return;
    shutterTimer -= dt;
    if (shutterTimer <= 0) {
        shutterTimer = shutterInterval();
        const bottom = Math.max(0, Math.floor(camRow));
        const top = Math.min(roofRow - 1, bottom + VISIBLE_ROWS);
        if (top >= bottom) {
            triggerShutter(bottom + randInt(top - bottom + 1), randInt(COLS));
        }
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running' || dt <= 0) return;

    if (invuln > 0) invuln = Math.max(0, invuln - dt);
    if (bannerTimer > 0) {
        bannerTimer = Math.max(0, bannerTimer - dt);
        if (bannerTimer === 0) banner = '';
    }

    updateShutters(dt);
    if (state !== 'running') return;
    updatePots(dt);
    if (state !== 'running') return;

    const height = handRow();
    if (height > maxHeight) {
        score += (height - maxHeight) * ROW_POINTS;
        maxHeight = height;
        updateHud();
    }

    const target = Math.max(0, Math.min(bodyRow() - CAM_LAG, roofRow - VISIBLE_ROWS + 2));
    camRow += (target - camRow) * Math.min(1, dt * CAM_SPEED);

    if (height >= roofRow) completeLevel();
}

function completeLevel() {
    score += ROOF_BONUS * level;
    level++;
    roofRow = ROOF_BASE + (level - 1) * ROOF_STEP;
    buildWall();
    resetClimber();
    pots = [];
    shutterTimer = shutterInterval();
    potTimer = FIRST_POT;
    banner = 'BUILDING ' + level;
    bannerTimer = 2;
    updateHud();
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    lives = START_LIVES;
    level = 1;
    roofRow = ROOF_BASE;
    pots = [];
    potSpawnEnabled = true;
    shutterEnabled = true;
    shutterTimer = SHUTTER_INTERVAL;
    potTimer = FIRST_POT;
    banner = '';
    bannerTimer = 0;
    buildWall();
    resetClimber();
    updateHud();
    hideOverlay();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage unavailable — the in-memory best still works */
        }
    }
    updateHud();
    showOverlay('GAME OVER', 'Score ' + score + ' · Building ' + level, 'Press Space to climb again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', 'Score ' + score, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elLives.textContent = String(Math.max(0, lives));
    elHeight.textContent = String(maxHeight);
    elBest.textContent = String(best);
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
// Rendering
// ---------------------------------------------------------------------------

// Screen position of a window cell's top-left corner.
function cellX(col) {
    return col * CELL_W;
}

function cellY(row) {
    return CANVAS_H - GROUND_H - (row - camRow + 1) * CELL_H;
}

function drawSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#050912');
    sky.addColorStop(1, '#16243d');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Parallax stars, stable per position so they do not shimmer.
    ctx.fillStyle = 'rgba(200, 220, 255, 0.55)';
    for (let i = 0; i < 60; i++) {
        const x = (i * 97) % CANVAS_W;
        const y = (i * 53 + camRow * 6) % CANVAS_H;
        const size = i % 7 === 0 ? 2 : 1;
        ctx.fillRect(x, CANVAS_H - y, size, size);
    }
}

function drawWindow(row, col) {
    const x = cellX(col);
    const y = cellY(row);
    if (y > CANVAS_H || y + CELL_H < 0) return;

    const pad = 9;
    const w = CELL_W - pad * 2;
    const h = CELL_H - pad * 2;
    const cell = wall[row][col];

    // Frame
    ctx.fillStyle = '#2a3448';
    ctx.fillRect(x + pad - 3, y + pad - 3, w + 6, h + 6);

    if (cell.state === 'open') {
        const lit = (row * 7 + col * 3) % 5 === 0;
        ctx.fillStyle = lit ? '#5d5535' : '#0e1a2c';
        ctx.fillRect(x + pad, y + pad, w, h);
        if (lit) {
            const glow = ctx.createLinearGradient(0, y + pad, 0, y + pad + h);
            glow.addColorStop(0, 'rgba(246, 217, 138, 0.85)');
            glow.addColorStop(1, 'rgba(246, 217, 138, 0.25)');
            ctx.fillStyle = glow;
            ctx.fillRect(x + pad, y + pad, w, h);
        }
        ctx.strokeStyle = lit ? 'rgba(90, 70, 30, 0.6)' : 'rgba(120, 160, 210, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + pad + w / 2, y + pad);
        ctx.lineTo(x + pad + w / 2, y + pad + h);
        ctx.stroke();
        // Sill: the grip the climber hangs from, so open windows read as holds.
        ctx.fillStyle = '#9fb3d4';
        ctx.fillRect(x + pad - 5, y + pad + h - 2, w + 10, 5);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(x + pad - 5, y + pad + h + 3, w + 10, 2);
        return;
    }

    // Shutter: fully down when closed, part-way and amber while closing.
    const closing = cell.state === 'closing';
    const drop = closing ? 1 - cell.timer / SHUTTER_TELEGRAPH : 1;
    ctx.fillStyle = '#0e1a2c';
    ctx.fillRect(x + pad, y + pad, w, h);
    ctx.fillStyle = closing ? '#c9821f' : '#5c6577';
    ctx.fillRect(x + pad, y + pad, w, Math.max(2, h * Math.min(1, drop)));
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
        const ly = y + pad + (h * Math.min(1, drop) * i) / 5;
        ctx.beginPath();
        ctx.moveTo(x + pad, ly);
        ctx.lineTo(x + pad + w, ly);
        ctx.stroke();
    }
}

function drawWall() {
    const bottom = Math.max(0, Math.floor(camRow) - 1);
    const top = Math.min(roofRow, Math.ceil(camRow) + VISIBLE_ROWS + 1);

    // Concrete face behind the windows.
    const faceTop = cellY(top);
    const faceBottom = cellY(bottom) + CELL_H;
    ctx.fillStyle = '#1a2436';
    ctx.fillRect(0, faceTop, CANVAS_W, faceBottom - faceTop);

    for (let row = bottom; row <= top; row++) {
        for (let col = 0; col < COLS; col++) drawWindow(row, col);
    }

    // Roof parapet.
    const roofY = cellY(roofRow);
    if (roofY < CANVAS_H && roofY > -CELL_H) {
        ctx.fillStyle = '#33425c';
        ctx.fillRect(0, roofY - 14, CANVAS_W, 14);
        ctx.fillStyle = '#56d1ff';
        ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('ROOF', CANVAS_W / 2, roofY - 3);
        ctx.textAlign = 'left';
    }

    // Street.
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, CANVAS_H - GROUND_H, CANVAS_W, GROUND_H);
    ctx.fillStyle = '#243146';
    ctx.fillRect(0, CANVAS_H - GROUND_H, CANVAS_W, 3);
}

function handPoint(hand) {
    return {
        x: cellX(hand.col) + CELL_W / 2,
        y: cellY(hand.row) + CELL_H - 10,
    };
}

// Ring the two windows the climber is holding, so the grips are obvious at a
// glance even when the wall is busy. The colours match the two control groups
// listed under the canvas: cyan is the WASD hand, amber is the arrow-key hand.
const LEFT_TINT = '#56d1ff';
const RIGHT_TINT = '#ffc14d';

function drawGrips() {
    ctx.lineWidth = 2;
    [[leftHand, LEFT_TINT], [rightHand, RIGHT_TINT]].forEach(([hand, tint]) => {
        ctx.strokeStyle = tint;
        ctx.strokeRect(cellX(hand.col) + 6, cellY(hand.row) + 6, CELL_W - 12, CELL_H - 12);
    });
}

function drawClimber() {
    const l = handPoint(leftHand);
    const r = handPoint(rightHand);
    const cx = (l.x + r.x) / 2;
    const cy = (l.y + r.y) / 2 + 26;

    const flashing = invuln > 0 && Math.floor(invuln * 12) % 2 === 0;
    const skin = flashing ? '#ffd7cf' : '#ffb59a';
    const suit = flashing ? '#ff9d8f' : '#e8524a';

    ctx.strokeStyle = suit;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';

    // Arms
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(l.x, l.y);
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(r.x, r.y);
    ctx.stroke();

    // Legs
    ctx.beginPath();
    ctx.moveTo(cx, cy + 12);
    ctx.lineTo(cx - 12, cy + 30);
    ctx.moveTo(cx, cy + 12);
    ctx.lineTo(cx + 12, cy + 30);
    ctx.stroke();

    // Body
    ctx.fillStyle = suit;
    ctx.fillRect(cx - 8, cy - 10, 16, 24);

    // Head
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(cx, cy - 18, 8, 0, Math.PI * 2);
    ctx.fill();

    // Hands, tinted to match their control group.
    [[l, LEFT_TINT], [r, RIGHT_TINT]].forEach(([p, tint]) => {
        ctx.fillStyle = skin;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = tint;
        ctx.lineWidth = 2;
        ctx.stroke();
    });
}

function drawPots() {
    pots.forEach((pot) => {
        const x = cellX(pot.col) + CELL_W / 2;
        const y = cellY(pot.row) + CELL_H / 2;
        if (y < -30 || y > CANVAS_H + 30) return;

        ctx.fillStyle = '#3f8f4a';
        ctx.beginPath();
        ctx.arc(x, y - 9, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#b4552f';
        ctx.beginPath();
        ctx.moveTo(x - 9, y - 4);
        ctx.lineTo(x + 9, y - 4);
        ctx.lineTo(x + 6, y + 10);
        ctx.lineTo(x - 6, y + 10);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#8e3f22';
        ctx.fillRect(x - 10, y - 6, 20, 4);
    });
}

function drawBanner() {
    if (!banner) return;
    ctx.fillStyle = 'rgba(86, 209, 255, ' + Math.min(1, bannerTimer) + ')';
    ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(banner, CANVAS_W / 2, 60);
    ctx.textAlign = 'left';
}

function draw() {
    drawSky();
    drawWall();
    drawGrips();
    drawPots();
    drawClimber();
    drawBanner();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const HAND_KEYS = {
    w: ['left', 0, 1],
    a: ['left', -1, 0],
    s: ['left', 0, -1],
    d: ['left', 1, 0],
    ArrowUp: ['right', 0, 1],
    ArrowLeft: ['right', -1, 0],
    ArrowDown: ['right', 0, -1],
    ArrowRight: ['right', 1, 0],
};

window.addEventListener('keydown', (e) => {
    inputCount++;

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (key === 'p') {
        togglePause();
        e.preventDefault();
        return;
    }

    if (key === ' ' || e.code === 'Space' || key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'paused') togglePause();
        e.preventDefault();
        return;
    }

    const move = HAND_KEYS[key];
    if (move) {
        moveHand(move[0], move[1], move[2]);
        e.preventDefault();
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

try {
    best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
} catch (err) {
    best = 0;
}

buildWall();
resetClimber();
updateHud();
showOverlay('SKY CLIMBER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
