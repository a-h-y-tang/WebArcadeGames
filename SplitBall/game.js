// ---------------------------------------------------------------------------
// Split Ball — grow walls across an arena to fence the bouncing balls into an
// ever smaller corner of it. See DESIGN.md for the rules and the reasoning.
// ---------------------------------------------------------------------------

const COLS = 30;
const ROWS = 20;
const TILE = 24;
const INTERIOR_CELLS = (COLS - 2) * (ROWS - 2);

const BALL_RADIUS = 7;
const BALL_SPEED = 170;          // px/s on level 1
const SPEED_PER_LEVEL = 12;      // added per level
const GROW_SPEED = 16;           // wall cells per second, per head
const FILL_TARGET = 75;          // percent of the interior needed to clear
const CAPTURE_POINTS = 5;        // per captured cell
const LEVEL_BONUS = 250;         // x level
const FLASH_TIME = 0.5;          // seconds a shattered wall glows red
const START_LIVES = 3;
const BEST_KEY = 'splitball-best';

// Cell values. `captured` runs alongside the grid and only drives the colour.
const OPEN = 0;
const SOLID = 1;
const PENDING = 2;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let grid = [];
let captured = [];
let balls = [];
let wall = null;
let effects = [];                // fading flashes left by shattered walls
let state = 'idle';              // idle | playing | paused | levelclear | over
let score = 0;
let level = 1;
let lives = START_LIVES;
let best = 0;
let orientation = 'v';           // orientation of the *next* wall
let cursor = { col: Math.floor(COLS / 2), row: Math.floor(ROWS / 2) };
let autoStep = true;             // the Playwright suite drives step() by hand

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elFilled = document.getElementById('filled');
const elLevel = document.getElementById('level');
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

const inBounds = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
const isSolid = (c, r) => !inBounds(c, r) || grid[r][c] === SOLID;
const isBorder = (c, r) => c === 0 || r === 0 || c === COLS - 1 || r === ROWS - 1;

function resetLevel() {
    grid = [];
    captured = [];
    for (let r = 0; r < ROWS; r++) {
        const row = [];
        const tint = [];
        for (let c = 0; c < COLS; c++) {
            row.push(isBorder(c, r) ? SOLID : OPEN);
            tint.push(false);
        }
        grid.push(row);
        captured.push(tint);
    }
    balls = [];
    wall = null;
    effects = [];
    cursor = { col: Math.floor(COLS / 2), row: Math.floor(ROWS / 2) };
    updateHud();
}

function percentFilled() {
    let filled = 0;
    for (let r = 1; r < ROWS - 1; r++) {
        for (let c = 1; c < COLS - 1; c++) if (grid[r][c] === SOLID) filled++;
    }
    return (filled / INTERIOR_CELLS) * 100;
}

// Every cell the ball's bounding box touches — at most four of them.
function cellsUnder(x, y) {
    const c0 = Math.floor((x - BALL_RADIUS) / TILE);
    const c1 = Math.floor((x + BALL_RADIUS) / TILE);
    const r0 = Math.floor((y - BALL_RADIUS) / TILE);
    const r1 = Math.floor((y + BALL_RADIUS) / TILE);
    const out = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push([c, r]);
    return out;
}

const overlapsSolid = (x, y) => cellsUnder(x, y).some(([c, r]) => isSolid(c, r));

// ---------------------------------------------------------------------------
// Balls
// ---------------------------------------------------------------------------

const speedForLevel = (n) => BALL_SPEED + (n - 1) * SPEED_PER_LEVEL;

function addBall(x, y, vx, vy) {
    const ball = { x, y, vx, vy };
    balls.push(ball);
    return ball;
}

function spawnBalls(count) {
    const speed = speedForLevel(level);
    const diagonal = speed / Math.SQRT2;
    for (let i = 0; i < count; i++) {
        const col = 3 + Math.floor(Math.random() * (COLS - 6));
        const row = 3 + Math.floor(Math.random() * (ROWS - 6));
        const sx = Math.random() < 0.5 ? -1 : 1;
        const sy = Math.random() < 0.5 ? -1 : 1;
        addBall((col + 0.5) * TILE, (row + 0.5) * TILE, sx * diagonal, sy * diagonal);
    }
}

// Each axis is tried on its own: a rejected move flips that axis and leaves the
// ball where it was, so it can never come to rest inside a solid cell.
function moveBall(b, dt) {
    const nx = b.x + b.vx * dt;
    if (overlapsSolid(nx, b.y)) b.vx = -b.vx;
    else b.x = nx;

    const ny = b.y + b.vy * dt;
    if (overlapsSolid(b.x, ny)) b.vy = -b.vy;
    else b.y = ny;
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

function buildWall(col, row) {
    if (state !== 'playing' || wall) return false;
    if (!inBounds(col, row) || grid[row][col] !== OPEN) return false;

    const axis = orientation;
    const steps = axis === 'v' ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
    grid[row][col] = PENDING;
    wall = {
        axis,
        col,
        row,
        acc: 0,
        cells: [[col, row]],
        heads: steps.map(([dc, dr]) => ({ c: col, r: row, dc, dr, blocked: false })),
    };
    return true;
}

function growWall(dt) {
    const interval = 1 / GROW_SPEED;
    wall.acc += dt;
    while (wall.acc >= interval) {
        wall.acc -= interval;
        for (const head of wall.heads) {
            if (head.blocked) continue;
            const nc = head.c + head.dc;
            const nr = head.r + head.dr;
            if (!inBounds(nc, nr) || grid[nr][nc] !== OPEN) {
                head.blocked = true;
                continue;
            }
            head.c = nc;
            head.r = nr;
            grid[nr][nc] = PENDING;
            wall.cells.push([nc, nr]);
        }
        if (wall.heads.every((h) => h.blocked)) break;
    }
}

const wallHitByBall = () =>
    balls.some((b) =>
        cellsUnder(b.x, b.y).some(([c, r]) => inBounds(c, r) && grid[r][c] === PENDING)
    );

function destroyWall() {
    for (const [c, r] of wall.cells) grid[r][c] = OPEN;
    effects.push({ cells: wall.cells, life: FLASH_TIME });
    wall = null;
}

function commitWall() {
    for (const [c, r] of wall.cells) grid[r][c] = SOLID;
    wall = null;
    captureRegions();
    updateHud();
    if (percentFilled() >= FILL_TARGET) levelCleared();
}

// Flood-fill the remaining open space; anything no ball can reach is ours.
function captureRegions() {
    const occupied = new Set();
    for (const b of balls) {
        for (const [c, r] of cellsUnder(b.x, b.y)) {
            if (inBounds(c, r)) occupied.add(r * COLS + c);
        }
    }

    const seen = new Uint8Array(COLS * ROWS);
    let gained = 0;

    for (let r0 = 1; r0 < ROWS - 1; r0++) {
        for (let c0 = 1; c0 < COLS - 1; c0++) {
            const start = r0 * COLS + c0;
            if (seen[start] || grid[r0][c0] !== OPEN) continue;

            const region = [];
            const queue = [[c0, r0]];
            seen[start] = 1;
            let hasBall = false;

            while (queue.length) {
                const [c, r] = queue.pop();
                region.push([c, r]);
                if (occupied.has(r * COLS + c)) hasBall = true;
                const neighbours = [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]];
                for (const [nc, nr] of neighbours) {
                    if (!inBounds(nc, nr) || grid[nr][nc] !== OPEN) continue;
                    const idx = nr * COLS + nc;
                    if (seen[idx]) continue;
                    seen[idx] = 1;
                    queue.push([nc, nr]);
                }
            }

            if (hasBall) continue;
            for (const [c, r] of region) {
                grid[r][c] = SOLID;
                captured[r][c] = true;
            }
            gained += region.length;
        }
    }

    if (gained) score += gained * CAPTURE_POINTS;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    orientation = 'v';
    resetLevel();
    spawnBalls(level + 1);
    state = 'playing';
    autoStep = true;
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    resetLevel();
    spawnBalls(level + 1);
    state = 'playing';
    hideOverlay();
    updateHud();
}

function levelCleared() {
    score += LEVEL_BONUS * level;
    state = 'levelclear';
    updateHud();
    showOverlay(
        `LEVEL ${level} CLEAR`,
        `Score ${score}`,
        'Press Space or click Continue for the next level'
    );
    btnStart.textContent = 'Continue';
}

function loseLife() {
    lives -= 1;
    updateHud();
    if (lives <= 0) {
        lives = 0;
        state = 'over';
        updateHud();
        showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space to play again');
        btnStart.textContent = 'Play Again';
    }
}

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
        btnStart.textContent = 'Resume';
    } else if (state === 'paused') {
        state = 'playing';
        hideOverlay();
        btnStart.textContent = 'Start Game';
    }
}

function toggleOrientation() {
    orientation = orientation === 'v' ? 'h' : 'v';
}

function placeWall() {
    return buildWall(cursor.col, cursor.row);
}

function moveCursor(dc, dr) {
    cursor.col = Math.min(COLS - 2, Math.max(1, cursor.col + dc));
    cursor.row = Math.min(ROWS - 2, Math.max(1, cursor.row + dr));
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'playing') return;

    for (const fx of effects) fx.life -= dt;
    if (effects.some((fx) => fx.life <= 0)) effects = effects.filter((fx) => fx.life > 0);

    for (const b of balls) moveBall(b, dt);

    if (!wall) return;
    growWall(dt);
    if (wallHitByBall()) {
        destroyWall();
        loseLife();
    } else if (wall.heads.every((h) => h.blocked)) {
        commitWall();
    }
}

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------

function updateHud() {
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* private mode — the score just will not persist */
        }
    }
    elScore.textContent = String(score);
    elFilled.textContent = `${Math.round(percentFilled())}%`;
    elLevel.textContent = String(level);
    elLives.textContent = String(lives);
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
    btnStart.textContent = 'Start Game';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawCell(c, r, top, bottom, edge) {
    const x = c * TILE;
    const y = r * TILE;
    const gradient = ctx.createLinearGradient(x, y, x, y + TILE);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
}

function drawPreview() {
    if (state !== 'playing' || wall) return;
    const { col, row } = cursor;
    if (grid[row][col] !== OPEN) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(69, 224, 200, 0.45)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (orientation === 'v') {
        const x = (col + 0.5) * TILE;
        let top = row;
        let bottom = row;
        while (grid[top - 1][col] === OPEN) top--;
        while (grid[bottom + 1][col] === OPEN) bottom++;
        ctx.moveTo(x, top * TILE);
        ctx.lineTo(x, (bottom + 1) * TILE);
    } else {
        const y = (row + 0.5) * TILE;
        let left = col;
        let right = col;
        while (grid[row][left - 1] === OPEN) left--;
        while (grid[row][right + 1] === OPEN) right++;
        ctx.moveTo(left * TILE, y);
        ctx.lineTo((right + 1) * TILE, y);
    }
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(69, 224, 200, 0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(col * TILE + 1, row * TILE + 1, TILE - 2, TILE - 2);
}

function draw() {
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Open space: a faint lattice so the arena reads as a playfield.
    ctx.strokeStyle = 'rgba(120, 150, 190, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < COLS; c++) {
        ctx.moveTo(c * TILE + 0.5, 0);
        ctx.lineTo(c * TILE + 0.5, canvas.height);
    }
    for (let r = 1; r < ROWS; r++) {
        ctx.moveTo(0, r * TILE + 0.5);
        ctx.lineTo(canvas.width, r * TILE + 0.5);
    }
    ctx.stroke();

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const v = grid[r][c];
            if (v === OPEN) continue;
            if (v === PENDING) {
                drawCell(c, r, '#ffe9a8', '#f3b73f', 'rgba(255, 255, 255, 0.5)');
            } else if (captured[r][c]) {
                drawCell(c, r, '#123b45', '#0c2730', 'rgba(69, 224, 200, 0.18)');
            } else if (isBorder(c, r)) {
                drawCell(c, r, '#27314a', '#1a2234', 'rgba(140, 170, 210, 0.12)');
            } else {
                drawCell(c, r, '#3f7fa8', '#28526d', 'rgba(170, 220, 255, 0.3)');
            }
        }
    }

    for (const fx of effects) {
        const alpha = Math.max(0, fx.life / FLASH_TIME);
        ctx.fillStyle = `rgba(255, 92, 92, ${0.55 * alpha})`;
        for (const [c, r] of fx.cells) {
            const pad = (1 - alpha) * 6;
            ctx.fillRect(c * TILE + pad, r * TILE + pad, TILE - pad * 2, TILE - pad * 2);
        }
    }

    drawPreview();

    for (const b of balls) {
        const glow = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, BALL_RADIUS * 2.6);
        glow.addColorStop(0, 'rgba(255, 128, 160, 0.55)');
        glow.addColorStop(1, 'rgba(255, 128, 160, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(b.x, b.y, BALL_RADIUS * 2.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ff7aa2';
        ctx.beginPath();
        ctx.arc(b.x, b.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(b.x - 2, b.y - 2.5, BALL_RADIUS * 0.34, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const ARROWS = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    a: [-1, 0],
    d: [1, 0],
    w: [0, -1],
    s: [0, 1],
};

window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'levelclear') nextLevel();
        else if (state === 'paused') togglePause();
        else placeWall();
        return;
    }
    if (k === 'p') {
        togglePause();
        return;
    }
    if (k === 'x') {
        toggleOrientation();
        return;
    }
    const move = ARROWS[k] || ARROWS[e.key];
    if (move) {
        e.preventDefault();
        moveCursor(move[0], move[1]);
    }
});

function cursorFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const col = Math.floor(((e.clientX - rect.left) * scaleX) / TILE);
    const row = Math.floor(((e.clientY - rect.top) * scaleY) / TILE);
    cursor.col = Math.min(COLS - 2, Math.max(1, col));
    cursor.row = Math.min(ROWS - 2, Math.max(1, row));
}

canvas.addEventListener('mousemove', cursorFromEvent);

canvas.addEventListener('click', (e) => {
    cursorFromEvent(e);
    placeWall();
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    toggleOrientation();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else if (state === 'levelclear') nextLevel();
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

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
resetLevel();
state = 'idle';
updateHud();
showOverlay(
    'SPLIT BALL',
    `Wall off ${FILL_TARGET}% of the arena to clear a level`,
    'Press Space or click Start to play'
);
requestAnimationFrame(frame);
