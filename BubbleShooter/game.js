// ---------------------------------------------------------------------------
// Bubble Shooter
// A honeycomb of coloured bubbles hangs from the ceiling. Aim the launcher,
// fire matching colours, pop groups of 3+, and drop whatever is left dangling.
// Core state and logic are exposed as top-level globals so the Playwright suite
// can drive the game deterministically (see DESIGN.md → Testability).
// ---------------------------------------------------------------------------

// --- Geometry / configuration ---
const R = 20;                       // bubble radius
const D = 2 * R;                    // bubble diameter
const COLS = 10;                    // bubbles per even row
const ROW_H = R * Math.sqrt(3);     // vertical spacing for tight hex packing
const ROWS = 14;                    // total logical rows
const INITIAL_ROWS = 5;             // rows pre-filled at the start
const MARGIN_TOP = R;               // y of the first row's centres

const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7'];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;             // 400 = COLS * D
const H = canvas.height;            // 520

const SHOOTER_X = W / 2;
const SHOOTER_Y = H - 40;
const DEATH_Y = SHOOTER_Y - 60;     // a bubble whose centre is below this loses

// Aim limits (radians). Up is -PI/2; clamped so shots never point downward.
const AIM_STEP = 0.08;
const MIN_ANGLE = -Math.PI + 0.22;  // near-horizontal left
const MAX_ANGLE = -0.22;            // near-horizontal right

const SPEED = 8;                    // pixels per physics step
const SUBSTEPS = 2;                 // physics steps per animation frame

// --- DOM ---
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let grid;                // grid[r][c] = colour string | null
let shooter;            // { x, y, angle, color, nextColor }
let movingBubble;       // { x, y, vx, vy, color } | null
let score;
let best;
let state;              // 'idle' | 'ready' | 'firing' | 'won' | 'lost'
let shotsFired;
let animId;

// ---------------------------------------------------------------------------
// Grid geometry helpers
// ---------------------------------------------------------------------------
function colsInRow(r) {
    return r % 2 === 0 ? COLS : COLS - 1;
}

function gridToPixel(r, c) {
    const even = r % 2 === 0;
    const x = even ? c * D + R : c * D + R + R; // odd rows shifted right by R
    const y = MARGIN_TOP + r * ROW_H;
    return { x, y };
}

function pixelToGrid(x, y) {
    let r = Math.round((y - MARGIN_TOP) / ROW_H);
    if (r < 0) r = 0;
    if (r > ROWS - 1) r = ROWS - 1;
    const even = r % 2 === 0;
    const offset = even ? R : 2 * R;
    let c = Math.round((x - offset) / D);
    const maxC = colsInRow(r) - 1;
    if (c < 0) c = 0;
    if (c > maxC) c = maxC;
    return { r, c };
}

function neighbors(r, c) {
    const even = r % 2 === 0;
    const deltas = even
        ? [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]]
        : [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]];
    const out = [];
    for (const [dr, dc] of deltas) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < colsInRow(nr)) out.push([nr, nc]);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Board queries
// ---------------------------------------------------------------------------
// Flood-fill the connected same-colour group containing (r, c). Assumes
// grid[r][c] already holds `color`.
function getCluster(r, c, color) {
    const key = (a, b) => a + ',' + b;
    const seen = new Set([key(r, c)]);
    const out = [[r, c]];
    const stack = [[r, c]];
    while (stack.length) {
        const [cr, cc] = stack.pop();
        for (const [nr, nc] of neighbors(cr, cc)) {
            if (seen.has(key(nr, nc))) continue;
            if (grid[nr][nc] === color) {
                seen.add(key(nr, nc));
                out.push([nr, nc]);
                stack.push([nr, nc]);
            }
        }
    }
    return out;
}

// Every bubble no longer reachable from the ceiling (row 0).
function getFloating() {
    const key = (a, b) => a + ',' + b;
    const seen = new Set();
    const stack = [];
    for (let c = 0; c < colsInRow(0); c++) {
        if (grid[0][c] !== null) {
            seen.add(key(0, c));
            stack.push([0, c]);
        }
    }
    while (stack.length) {
        const [cr, cc] = stack.pop();
        for (const [nr, nc] of neighbors(cr, cc)) {
            if (grid[nr][nc] !== null && !seen.has(key(nr, nc))) {
                seen.add(key(nr, nc));
                stack.push([nr, nc]);
            }
        }
    }
    const floating = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < colsInRow(r); c++) {
            if (grid[r][c] !== null && !seen.has(key(r, c))) floating.push([r, c]);
        }
    }
    return floating;
}

function isBoardEmpty() {
    return grid.every(row => row.every(cell => cell === null));
}

function bubbleBelowDeathLine() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < colsInRow(r); c++) {
            if (grid[r][c] !== null && gridToPixel(r, c).y > DEATH_Y) return true;
        }
    }
    return false;
}

// Nearest empty grid cell to a pixel position (the base cell or one of its
// hex neighbours) — where a shot snaps when it lands.
function nearestEmptyCell(x, y) {
    const base = pixelToGrid(x, y);
    const candidates = [[base.r, base.c], ...neighbors(base.r, base.c)];
    let best = null;
    let bestD = Infinity;
    for (const [r, c] of candidates) {
        if (grid[r][c] !== null) continue;
        const p = gridToPixel(r, c);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = [r, c];
        }
    }
    if (!best) best = [base.r, base.c];
    return { r: best[0], c: best[1] };
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------
function coloursOnBoard() {
    const set = new Set();
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < colsInRow(r); c++) {
            if (grid[r][c] !== null) set.add(grid[r][c]);
        }
    }
    return [...set];
}

function randomColour() {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
}

// Prefer colours still present so the board stays solvable.
function randomPlayableColour() {
    const present = coloursOnBoard();
    if (present.length === 0) return randomColour();
    return present[Math.floor(Math.random() * present.length)];
}

// ---------------------------------------------------------------------------
// Core action: land a bubble at a cell and resolve pops + gravity
// ---------------------------------------------------------------------------
function landBubble(r, c, color) {
    grid[r][c] = color;
    let popped = 0;
    let dropped = 0;

    const cluster = getCluster(r, c, color);
    if (cluster.length >= 3) {
        for (const [cr, cc] of cluster) grid[cr][cc] = null;
        popped = cluster.length;

        const floating = getFloating();
        for (const [fr, fc] of floating) grid[fr][fc] = null;
        dropped = floating.length;
    }

    score += popped * 10 + dropped * 20;
    updateScore();

    if (isBoardEmpty()) {
        win();
    } else if (bubbleBelowDeathLine()) {
        lose();
    }

    return { popped, dropped };
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------
function fire() {
    if (state !== 'ready') return;
    movingBubble = {
        x: shooter.x,
        y: shooter.y,
        vx: Math.cos(shooter.angle) * SPEED,
        vy: Math.sin(shooter.angle) * SPEED,
        color: shooter.color,
    };
    state = 'firing';
}

function stepMovingBubble() {
    const b = movingBubble;
    if (!b) return;

    b.x += b.vx;
    b.y += b.vy;

    // Bounce off the side walls.
    if (b.x < R) { b.x = R; b.vx = -b.vx; }
    if (b.x > W - R) { b.x = W - R; b.vx = -b.vx; }

    // Land on the ceiling.
    if (b.y <= R) {
        landMoving();
        return;
    }

    // Land on contact with an existing bubble.
    const hitR2 = (D * 0.9) ** 2;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < colsInRow(r); c++) {
            if (grid[r][c] === null) continue;
            const p = gridToPixel(r, c);
            const d2 = (p.x - b.x) ** 2 + (p.y - b.y) ** 2;
            if (d2 < hitR2) {
                landMoving();
                return;
            }
        }
    }
}

function landMoving() {
    const b = movingBubble;
    const { r, c } = nearestEmptyCell(b.x, b.y);
    movingBubble = null;
    shotsFired++;

    landBubble(r, c, b.color);

    // Only return to aiming if the game hasn't ended.
    if (state === 'firing') state = 'ready';

    // Advance the launcher's colour queue.
    shooter.color = shooter.nextColor;
    shooter.nextColor = randomPlayableColour();
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------
function setupBoard() {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < colsInRow(r); c++) {
            row.push(r < INITIAL_ROWS ? randomColour() : null);
        }
        grid.push(row);
    }
    shooter = {
        x: SHOOTER_X,
        y: SHOOTER_Y,
        angle: -Math.PI / 2,
        color: randomPlayableColour(),
        nextColor: randomPlayableColour(),
    };
    movingBubble = null;
}

function newGame() {
    setupBoard();
    score = 0;
    shotsFired = 0;
    updateScore();
}

function beginPlay() {
    if (state === 'won' || state === 'lost') newGame();
    state = 'ready';
    hideOverlay();
}

function win() {
    state = 'won';
    saveBest();
    showOverlay('You Win!', `${score} pts`, 'Press Space or click to play again', 'Play Again');
}

function lose() {
    state = 'lost';
    saveBest();
    showOverlay('Game Over', `${score} pts`, 'Press Space or click to play again', 'Play Again');
}

function saveBest() {
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('bubble-shooter-best', best);
    }
}

function updateScore() {
    scoreEl.textContent = score;
}

function showOverlay(title, scoreText, sub, btn) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = btn;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawBubble(x, y, color, radius = R - 1) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    // Glossy highlight.
    ctx.beginPath();
    ctx.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.fill();
}

function draw() {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    // Death line.
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(0, DEATH_Y);
    ctx.lineTo(W, DEATH_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Settled bubbles.
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < colsInRow(r); c++) {
            if (grid[r][c] === null) continue;
            const p = gridToPixel(r, c);
            drawBubble(p.x, p.y, grid[r][c]);
        }
    }

    // Aim guide (while aiming).
    if (state === 'ready') {
        const len = 90;
        ctx.strokeStyle = 'rgba(230, 237, 243, 0.35)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(shooter.x, shooter.y);
        ctx.lineTo(
            shooter.x + Math.cos(shooter.angle) * len,
            shooter.y + Math.sin(shooter.angle) * len
        );
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Launcher: current bubble + next preview.
    if (shooter) {
        drawBubble(shooter.x, shooter.y, shooter.color);
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#6e7681';
        ctx.textAlign = 'left';
        ctx.fillText('NEXT', shooter.x + 34, shooter.y - 6);
        drawBubble(shooter.x + 54, shooter.y + 4, shooter.nextColor, R * 0.6);
    }

    // Bubble in flight.
    if (movingBubble) {
        drawBubble(movingBubble.x, movingBubble.y, movingBubble.color);
    }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function loop() {
    if (state === 'firing') {
        for (let i = 0; i < SUBSTEPS && state === 'firing'; i++) stepMovingBubble();
    }
    draw();
    animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function aimAt(px, py) {
    if (state !== 'ready') return;
    let a = Math.atan2(py - shooter.y, px - shooter.x);
    if (a > 0) a = px < shooter.x ? MIN_ANGLE : MAX_ANGLE; // ignore downward
    a = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, a));
    shooter.angle = a;
}

canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    aimAt(e.clientX - rect.left, e.clientY - rect.top);
});

canvas.addEventListener('click', () => {
    if (state === 'ready') fire();
    else if (state === 'idle' || state === 'won' || state === 'lost') beginPlay();
});

btnStart.addEventListener('click', beginPlay);

document.addEventListener('keydown', e => {
    if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        if (state === 'ready') fire();
        else beginPlay();
        return;
    }
    if (state === 'ready') {
        if (e.key === 'ArrowLeft') {
            shooter.angle = Math.max(MIN_ANGLE, shooter.angle - AIM_STEP);
            e.preventDefault();
        } else if (e.key === 'ArrowRight') {
            shooter.angle = Math.min(MAX_ANGLE, shooter.angle + AIM_STEP);
            e.preventDefault();
        }
    }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
best = parseInt(localStorage.getItem('bubble-shooter-best') || '0', 10);
bestEl.textContent = best;
newGame();
state = 'idle';
showOverlay('Bubble Shooter', '', 'Match 3+ colours to pop them. Clear the board to win!', 'Start Game');
loop();
