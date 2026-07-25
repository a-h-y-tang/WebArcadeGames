// --- Board geometry ---
const CANVAS_W = 500;
const CANVAS_H = 500;
const CX = 250;                 // board centre x
const CY = 250;                 // board centre y
const R = 210;                  // outer radius of the double ring (normalized 1.0)

// Ring radii as fractions of R (from real board measurements, board R = 170mm)
const BULL_R = 6.35 / 170;      // 0.0374  -> 50
const OUTER_BULL_R = 15.9 / 170;// 0.0935  -> 25
const TRIPLE_IN = 99 / 170;     // 0.582
const TRIPLE_OUT = 107 / 170;   // 0.629
const DOUBLE_IN = 162 / 170;    // 0.953

// Sector numbers clockwise from the top
const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

const SWEEP_SPEED = 360;        // px/second for the aim sweep
const START_SCORE = 501;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const remainingEl = document.getElementById('remaining');
const dartsEl = document.getElementById('darts');
const bestEl = document.getElementById('best');
const turnDartsEl = document.getElementById('turn-darts');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State (script-level so Playwright can read/drive it) ---
let remaining = START_SCORE;
let turnStart = START_SCORE;
let dartsThisTurn = 0;
let totalDarts = 0;
let state = 'idle';             // idle | running | over
let phase = 'x';               // x (aim horizontal) | y (aim vertical)
let aimX = CX;
let aimY = CY;
let sweepDirX = 1;
let sweepDirY = 1;
let best = null;               // fewest darts to finish
let turnMarks = [];            // dart markers for the current turn { x, y, label }
let lastTime = null;
let animId = null;

// --- Pure scoring ---
function scoreDart(x, y) {
    const dx = x - CX;
    const dy = y - CY;
    const r = Math.hypot(dx, dy) / R;

    if (r > 1.0) return { value: 0, mult: 0, label: 'Miss' };
    if (r <= BULL_R) return { value: 50, mult: 1, label: 'Bull' };
    if (r <= OUTER_BULL_R) return { value: 25, mult: 1, label: '25' };

    // angle clockwise from straight up, in degrees 0..360
    let deg = Math.atan2(dx, -dy) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    const idx = Math.floor(((deg + 9) % 360) / 18);
    const num = ORDER[idx];

    if (r >= TRIPLE_IN && r <= TRIPLE_OUT) return { value: num * 3, mult: 3, label: 'T' + num };
    if (r >= DOUBLE_IN) return { value: num * 2, mult: 2, label: 'D' + num };
    return { value: num, mult: 1, label: '' + num };
}

// --- HUD ---
function updateHUD() {
    remainingEl.textContent = remaining;
    dartsEl.textContent = totalDarts;
    bestEl.textContent = best == null ? '—' : best;
    if (state === 'running') {
        turnDartsEl.textContent = turnMarks.length
            ? turnMarks.map(m => m.label).join('  ')
            : '—';
    }
}

// --- Throwing ---
function throwDart(x, y) {
    if (state !== 'running') return;

    const s = scoreDart(x, y);
    totalDarts += 1;
    dartsThisTurn += 1;
    turnMarks.push({ x, y, label: s.label });

    const after = remaining - s.value;
    const finishesOnDouble = s.mult === 2 || s.value === 50;

    if (after < 0 || after === 1 || (after === 0 && !finishesOnDouble)) {
        // Bust: void the whole turn
        remaining = turnStart;
        dartsThisTurn = 0;
        turnMarks = [];
        phase = 'x';
        aimY = CY;
        updateHUD();
        return;
    }

    remaining = after;

    if (remaining === 0) {
        updateHUD();
        winGame();
        return;
    }

    if (dartsThisTurn >= 3) {
        dartsThisTurn = 0;
        turnStart = remaining;
        turnMarks = [];
    }
    phase = 'x';
    aimY = CY;
    updateHUD();
}

// --- Lifecycle ---
function startGame() {
    remaining = START_SCORE;
    turnStart = START_SCORE;
    dartsThisTurn = 0;
    totalDarts = 0;
    turnMarks = [];
    state = 'running';
    phase = 'x';
    aimX = CX;
    aimY = CY;
    sweepDirX = 1;
    sweepDirY = 1;
    lastTime = null;

    updateHUD();
    overlay.classList.remove('visible');

    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function winGame() {
    state = 'over';
    if (best == null || totalDarts < best) {
        best = totalDarts;
        localStorage.setItem('darts-best', best);
    }
    overlayTitle.textContent = 'You won! 🎯';
    overlayScore.textContent = `Finished in ${totalDarts} darts`;
    overlaySub.textContent = 'Press Space to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    updateHUD();
}

// --- Aim sweep + render loop ---
function loop(ts) {
    if (state !== 'running') return;

    if (lastTime == null) lastTime = ts;
    let dt = ts - lastTime;
    lastTime = ts;
    if (dt > 50) dt = 50;
    const sec = dt / 1000;

    if (phase === 'x') {
        aimX += sweepDirX * SWEEP_SPEED * sec;
        if (aimX <= CX - R) { aimX = CX - R; sweepDirX = 1; }
        else if (aimX >= CX + R) { aimX = CX + R; sweepDirX = -1; }
    } else {
        aimY += sweepDirY * SWEEP_SPEED * sec;
        if (aimY <= CY - R) { aimY = CY - R; sweepDirY = 1; }
        else if (aimY >= CY + R) { aimY = CY + R; sweepDirY = -1; }
    }

    draw();

    if (state === 'running') animId = requestAnimationFrame(loop);
}

// --- Rendering ---
function draw() {
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawBoard();
    drawMarks();
    if (state === 'running') drawAim();
}

function drawBoard() {
    // Outer black rim
    ctx.fillStyle = '#161b22';
    ctx.beginPath();
    ctx.arc(CX, CY, R + 12, 0, Math.PI * 2);
    ctx.fill();

    const singleA = '#1c2530';
    const singleB = '#e8e2cf';
    const dbl = '#ef4444';
    const trp = '#22c55e';

    // 20 sectors, each 18° wide, centred so sector 0 (index) is centred at top.
    for (let i = 0; i < 20; i++) {
        const start = (-90 - 9 + i * 18) * Math.PI / 180;
        const end = start + 18 * Math.PI / 180;
        const base = (i % 2 === 0) ? singleB : singleA;
        const dblColor = (i % 2 === 0) ? dbl : trp;   // alternate accent per wedge for contrast
        const trpColor = (i % 2 === 0) ? trp : dbl;

        // single body
        wedge(start, end, DOUBLE_IN * R, base);
        wedge(start, end, TRIPLE_OUT * R, base);
        // triple ring
        ring(start, end, TRIPLE_IN * R, TRIPLE_OUT * R, trpColor);
        // outer single (between triple and double) already base via wedge; redraw base to be safe
        ringBase(start, end, TRIPLE_OUT * R, DOUBLE_IN * R, base);
        // double ring
        ring(start, end, DOUBLE_IN * R, R, dblColor);
    }

    // Bull
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(CX, CY, OUTER_BULL_R * R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(CX, CY, BULL_R * R, 0, Math.PI * 2);
    ctx.fill();

    // Numbers
    ctx.fillStyle = '#e6edf3';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 20; i++) {
        const ang = (-90 + i * 18) * Math.PI / 180;
        const nx = CX + Math.cos(ang) * (R + 2);
        const ny = CY + Math.sin(ang) * (R + 2);
        ctx.fillText(ORDER[i], nx, ny);
    }
}

function wedge(start, end, radius, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, radius, start, end);
    ctx.closePath();
    ctx.fill();
}

function ring(start, end, r0, r1, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(CX, CY, r1, start, end);
    ctx.arc(CX, CY, r0, end, start, true);
    ctx.closePath();
    ctx.fill();
}

function ringBase(start, end, r0, r1, color) {
    ring(start, end, r0, r1, color);
}

function drawMarks() {
    for (const m of turnMarks) {
        ctx.fillStyle = '#fde047';
        ctx.strokeStyle = '#0a0e14';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
}

function drawAim() {
    ctx.strokeStyle = '#4ade80cc';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    if (phase === 'x') {
        ctx.moveTo(aimX, CY - R);
        ctx.lineTo(aimX, CY + R);
    } else {
        // horizontal sweep line + locked vertical line
        ctx.moveTo(aimX, CY - R);
        ctx.lineTo(aimX, CY + R);
        ctx.moveTo(CX - R, aimY);
        ctx.lineTo(CX + R, aimY);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // crosshair dot at current aim (in phase y show the intersection)
    if (phase === 'y') {
        ctx.fillStyle = '#4ade80';
        ctx.beginPath();
        ctx.arc(aimX, aimY, 5, 0, Math.PI * 2);
        ctx.fill();
    }
}

// --- Input ---
function pressAction() {
    if (state !== 'running') {
        startGame();
        return;
    }
    if (phase === 'x') {
        phase = 'y';
        aimY = CY - R;
        sweepDirY = 1;
    } else {
        throwDart(aimX, aimY);
    }
}

document.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        pressAction();
    }
});

canvas.addEventListener('click', e => {
    if (state !== 'running') {
        startGame();
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const sx = CANVAS_W / rect.width;
    const sy = CANVAS_H / rect.height;
    const x = (e.clientX - rect.left) * sx;
    const y = (e.clientY - rect.top) * sy;
    throwDart(x, y);
});

btnStart.addEventListener('click', e => {
    e.stopPropagation();
    startGame();
});

// --- Init ---
const storedBest = localStorage.getItem('darts-best');
best = storedBest == null ? null : parseInt(storedBest, 10);
updateHUD();
draw();
