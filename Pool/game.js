// ---------------------------------------------------------------------------
// Pool — a solo nine-ball rack on an HTML5 canvas.
//
// Nine numbered balls are racked in a diamond; the player strokes the cue ball
// until the table is clear. Every stroke counts, a scratch costs an extra one,
// and the fewest-shots run is remembered in localStorage.
//
// Written as a single classic (non-module) script so state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Slime Volley,
// Kaboom and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)` in fixed sub-steps, so tests can simulate the
// table deterministically without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Table geometry ---
const CANVAS_W = 720;
const CANVAS_H = 400;
const RAIL = 26;                    // cushion thickness drawn around the felt
const PLAY_L = RAIL;
const PLAY_R = CANVAS_W - RAIL;
const PLAY_T = RAIL;
const PLAY_B = CANVAS_H - RAIL;
const PLAY_W = PLAY_R - PLAY_L;
const PLAY_H = PLAY_B - PLAY_T;
const MID_Y = (PLAY_T + PLAY_B) / 2;
const HEAD_X = PLAY_L + PLAY_W * 0.25;   // where the cue ball is spotted

// --- Balls ---
const BALL_R = 10;
const SPACING = BALL_R * 2 + 0.4;   // rack gap: touching, plus a hair of slack
const OBJECT_BALL_COUNT = 9;

// --- Pockets ---
const POCKET_R = 17;                // capture radius, measured from the centre
const pockets = [
    { x: PLAY_L, y: PLAY_T },
    { x: CANVAS_W / 2, y: PLAY_T },
    { x: PLAY_R, y: PLAY_T },
    { x: PLAY_L, y: PLAY_B },
    { x: CANVAS_W / 2, y: PLAY_B },
    { x: PLAY_R, y: PLAY_B },
];

// --- Physics ---
const SUB_DT = 1 / 240;             // fixed sub-step: <5px of travel at top speed
const MAX_DT = 0.1;                 // never simulate more than this in one call
const FRICTION_PER_SEC = 0.32;      // fraction of speed surviving one second
const STOP_SPEED = 6;               // below this a ball is simply parked
const RAIL_E = 0.92;                // cushions give a little back
const BALL_E = 0.95;                // ball-on-ball is nearly elastic

// --- Shooting ---
const MIN_SHOT_SPEED = 220;
const MAX_SHOT_SPEED = 1150;
const CHARGE_RATE = 1.6;            // power per second while the button is held
const AIM_STEP = (2 * Math.PI) / 180;
const AIM_STEP_FINE = (0.4 * Math.PI) / 180;
const BEST_KEY = 'pool-best-shots';

// The rack: [ball number, column, half-spacings off the centre line].
const RACK_LAYOUT = [
    [1, 0, 0],
    [2, 1, -1], [3, 1, 1],
    [4, 2, -2], [9, 2, 0], [5, 2, 2],
    [6, 3, -1], [7, 3, 1],
    [8, 4, 0],
];
const RACK_APEX_X = PLAY_L + PLAY_W * 0.68;
const RACK_DX = SPACING * Math.cos(Math.PI / 6);

const BALL_COLOURS = {
    0: '#f3f1e7',
    1: '#f2c14e',
    2: '#3d6fd4',
    3: '#d94141',
    4: '#8b5cc7',
    5: '#e08b3c',
    6: '#2f9e5f',
    7: '#8e3b2f',
    8: '#1d1d1d',
    9: '#f2c14e',
};

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const shotsEl = document.getElementById('shots');
const remainingEl = document.getElementById('remaining');
const bestEl = document.getElementById('best');
const powerFill = document.getElementById('power-fill');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'aiming' | 'rolling' | 'won'
let state, shots, bestShots, aimAngle, power, charging;
const balls = [];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function rackBalls() {
    balls.length = 0;
    balls.push({ n: 0, x: HEAD_X, y: MID_Y, vx: 0, vy: 0, sunk: false });
    const placed = new Map();
    for (const [n, col, off] of RACK_LAYOUT) {
        placed.set(n, {
            x: RACK_APEX_X + col * RACK_DX,
            y: MID_Y + (off * SPACING) / 2,
        });
    }
    for (let n = 1; n <= OBJECT_BALL_COUNT; n++) {
        const spot = placed.get(n);
        balls.push({ n, x: spot.x, y: spot.y, vx: 0, vy: 0, sunk: false });
    }
}

// The cue ball is the zero ball and always lives at the head of the array.
// Exposed as a live alias so it survives a re-rack (which rebuilds `balls`).
Object.defineProperty(window, 'cueBall', { get: () => balls[0] });

function startGame() {
    rackBalls();
    state = 'aiming';
    shots = 0;
    aimAngle = 0;
    power = 0;
    charging = false;
    powerFill.style.width = '0%';
    hideOverlay();
    updateHud();
}

/** Put the cue ball back on the head spot, nudged clear of anything in the way. */
function respotCue() {
    const cue = balls[0];
    cue.sunk = false;
    cue.vx = 0;
    cue.vy = 0;
    cue.y = MID_Y;
    for (let x = HEAD_X; x >= PLAY_L + BALL_R; x -= 4) {
        cue.x = x;
        const clash = balls.some(
            (b) => b !== cue && !b.sunk && Math.hypot(b.x - cue.x, b.y - cue.y) < 2 * BALL_R + 1
        );
        if (!clash) return;
    }
    cue.x = PLAY_L + BALL_R;
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

function liveBalls() {
    return balls.filter((b) => !b.sunk);
}

function ballsRemaining() {
    return balls.filter((b) => b.n !== 0 && !b.sunk).length;
}

function allStopped() {
    return liveBalls().every((b) => b.vx === 0 && b.vy === 0);
}

/** Elastic-ish impulse between two equal-mass balls, plus overlap separation. */
function collidePair(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist >= 2 * BALL_R) return;

    const nx = dx / dist;
    const ny = dy / dist;

    // Push them apart symmetrically so they stop overlapping.
    const overlap = (2 * BALL_R - dist) / 2;
    a.x -= nx * overlap;
    a.y -= ny * overlap;
    b.x += nx * overlap;
    b.y += ny * overlap;

    // Only exchange momentum if they are actually closing on each other.
    const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel >= 0) return;
    const j = (-(1 + BALL_E) * rel) / 2;
    a.vx -= j * nx;
    a.vy -= j * ny;
    b.vx += j * nx;
    b.vy += j * ny;
}

function bounceOffRails(b) {
    if (b.x < PLAY_L + BALL_R) {
        b.x = PLAY_L + BALL_R;
        if (b.vx < 0) b.vx = -b.vx * RAIL_E;
    } else if (b.x > PLAY_R - BALL_R) {
        b.x = PLAY_R - BALL_R;
        if (b.vx > 0) b.vx = -b.vx * RAIL_E;
    }
    if (b.y < PLAY_T + BALL_R) {
        b.y = PLAY_T + BALL_R;
        if (b.vy < 0) b.vy = -b.vy * RAIL_E;
    } else if (b.y > PLAY_B - BALL_R) {
        b.y = PLAY_B - BALL_R;
        if (b.vy > 0) b.vy = -b.vy * RAIL_E;
    }
}

function pocketFor(b) {
    return pockets.find((p) => Math.hypot(b.x - p.x, b.y - p.y) < POCKET_R);
}

function sink(b) {
    b.sunk = true;
    b.vx = 0;
    b.vy = 0;
    if (b.n === 0) shots += 1;      // scratch: a one-shot penalty
    updateHud();
}

function subStep(h) {
    const decay = Math.pow(FRICTION_PER_SEC, h);
    const live = liveBalls();

    for (const b of live) {
        b.x += b.vx * h;
        b.y += b.vy * h;
        b.vx *= decay;
        b.vy *= decay;
        if (Math.hypot(b.vx, b.vy) < STOP_SPEED) {
            b.vx = 0;
            b.vy = 0;
        }
    }

    for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) collidePair(live[i], live[j]);
    }

    for (const b of live) {
        bounceOffRails(b);
        if (pocketFor(b)) sink(b);
    }
}

function step(dt) {
    if (state !== 'rolling') return;
    let left = Math.min(dt, MAX_DT);
    while (left > 1e-9) {
        const h = Math.min(SUB_DT, left);
        subStep(h);
        left -= h;
    }
    if (allStopped()) settleTable();
}

function settleTable() {
    if (balls[0].sunk) respotCue();
    power = 0;
    charging = false;
    powerFill.style.width = '0%';
    if (ballsRemaining() === 0) winRack();
    else state = 'aiming';
    updateHud();
}

function winRack() {
    state = 'won';
    if (bestShots === null || shots < bestShots) {
        bestShots = shots;
        try {
            localStorage.setItem(BEST_KEY, String(bestShots));
        } catch (err) {
            /* private browsing — the best score simply will not persist */
        }
    }
    showOverlay('RACK CLEARED', `Cleared in ${shots} shots`, 'Press Space to rack again');
    btnStart.textContent = 'Rack Again';
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------

function setAim(angle) {
    aimAngle = angle;
}

function aimAt(x, y) {
    setAim(Math.atan2(y - balls[0].y, x - balls[0].x));
}

function beginCharge() {
    if (state !== 'aiming') return;
    charging = true;
    power = 0;
    powerFill.style.width = '0%';
}

function updateCharge(dt) {
    if (!charging) return;
    power = Math.min(1, power + CHARGE_RATE * dt);
    powerFill.style.width = `${(power * 100).toFixed(1)}%`;
}

function releaseCharge() {
    if (!charging) return;
    charging = false;
    const p = power;
    power = 0;
    powerFill.style.width = '0%';
    shoot(p);
}

function shoot(p) {
    if (state !== 'aiming') return;
    const clamped = Math.max(0, Math.min(1, p));
    const speed = MIN_SHOT_SPEED + clamped * (MAX_SHOT_SPEED - MIN_SHOT_SPEED);
    const cue = balls[0];
    cue.vx = Math.cos(aimAngle) * speed;
    cue.vy = Math.sin(aimAngle) * speed;
    shots += 1;
    state = 'rolling';
    updateHud();
}

// ---------------------------------------------------------------------------
// Aim preview
// ---------------------------------------------------------------------------

function showsAimGuide() {
    return state === 'aiming' && !balls[0].sunk;
}

/**
 * Cast the aim ray from the cue ball: how far it travels before touching
 * another ball or a cushion, and where the object ball would be sent.
 */
function aimPreview() {
    const cue = balls[0];
    const dx = Math.cos(aimAngle);
    const dy = Math.sin(aimAngle);

    // Distance to the cushions along the ray.
    let best = Infinity;
    if (dx > 1e-6) best = Math.min(best, (PLAY_R - BALL_R - cue.x) / dx);
    if (dx < -1e-6) best = Math.min(best, (PLAY_L + BALL_R - cue.x) / dx);
    if (dy > 1e-6) best = Math.min(best, (PLAY_B - BALL_R - cue.y) / dy);
    if (dy < -1e-6) best = Math.min(best, (PLAY_T + BALL_R - cue.y) / dy);
    if (!isFinite(best)) best = 0;

    // Distance to the first object ball: solve |P + t*d - C| = 2R.
    let hit = null;
    for (const b of balls) {
        if (b.n === 0 || b.sunk) continue;
        const ex = b.x - cue.x;
        const ey = b.y - cue.y;
        const proj = ex * dx + ey * dy;
        if (proj <= 0) continue;
        const perp2 = ex * ex + ey * ey - proj * proj;
        const r2 = (2 * BALL_R) ** 2;
        if (perp2 > r2) continue;
        const t = proj - Math.sqrt(r2 - perp2);
        if (t >= 0 && t < best) {
            best = t;
            hit = b;
        }
    }

    const gx = cue.x + dx * best;
    const gy = cue.y + dy * best;
    return { x: gx, y: gy, dist: best, hit };
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    shotsEl.textContent = String(shots);
    remainingEl.textContent = String(ballsRemaining());
    bestEl.textContent = bestShots === null ? '—' : String(bestShots);
}

function showOverlay(title, score, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = score;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawTable() {
    // Rails.
    const rail = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    rail.addColorStop(0, '#5a3a22');
    rail.addColorStop(0.5, '#43291a');
    rail.addColorStop(1, '#2d1a10');
    ctx.fillStyle = rail;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Felt.
    const felt = ctx.createRadialGradient(
        CANVAS_W / 2, CANVAS_H / 2, 40,
        CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.6
    );
    felt.addColorStop(0, '#2a8558');
    felt.addColorStop(1, '#155a3b');
    ctx.fillStyle = felt;
    ctx.fillRect(PLAY_L, PLAY_T, PLAY_W, PLAY_H);

    // Head string and the foot spot, as on a real cloth.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(HEAD_X, PLAY_T);
    ctx.lineTo(HEAD_X, PLAY_B);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.arc(RACK_APEX_X, MID_Y, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Diamond sights along the rails, as on a real table.
    ctx.fillStyle = 'rgba(240, 228, 200, 0.55)';
    for (let i = 1; i <= 7; i++) {
        if (i === 4) continue;                 // the side pockets sit here
        const x = PLAY_L + (PLAY_W * i) / 8;
        for (const y of [RAIL / 2, CANVAS_H - RAIL / 2]) {
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    for (let i = 1; i <= 3; i++) {
        const y = PLAY_T + (PLAY_H * i) / 4;
        for (const x of [RAIL / 2, CANVAS_W - RAIL / 2]) {
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Pockets, with a brass throat.
    for (const p of pockets) {
        ctx.fillStyle = '#c39a4a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, POCKET_R + 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#07100b';
        ctx.beginPath();
        ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBall(b) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(b.x + 2.5, b.y + 3, BALL_R * 0.95, BALL_R * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createRadialGradient(
        b.x - BALL_R * 0.35, b.y - BALL_R * 0.4, BALL_R * 0.15,
        b.x, b.y, BALL_R
    );
    const base = BALL_COLOURS[b.n];
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.28, base);
    grad.addColorStop(1, '#00000055');

    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = base;
    ctx.fillRect(b.x - BALL_R, b.y - BALL_R, BALL_R * 2, BALL_R * 2);
    if (b.n === 9) {
        // The nine is a stripe: white above and below the band.
        ctx.fillStyle = '#f3f1e7';
        ctx.fillRect(b.x - BALL_R, b.y - BALL_R, BALL_R * 2, BALL_R * 0.55);
        ctx.fillRect(b.x - BALL_R, b.y + BALL_R * 0.45, BALL_R * 2, BALL_R * 0.55);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(b.x - BALL_R, b.y - BALL_R, BALL_R * 2, BALL_R * 2);
    ctx.restore();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.stroke();

    if (b.n !== 0) {
        ctx.fillStyle = '#f7f5ee';
        ctx.beginPath();
        ctx.arc(b.x, b.y, BALL_R * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#15201a';
        ctx.font = 'bold 9px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.n), b.x, b.y + 0.5);
    }
}

function drawAim() {
    const cue = balls[0];
    const preview = aimPreview();
    const dx = Math.cos(aimAngle);
    const dy = Math.sin(aimAngle);

    // Guide line out to the first obstruction.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(cue.x + dx * BALL_R, cue.y + dy * BALL_R);
    ctx.lineTo(preview.x, preview.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Ghost ball and the line the object ball would take.
    if (preview.hit) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.arc(preview.x, preview.y, BALL_R, 0, Math.PI * 2);
        ctx.stroke();

        const ox = preview.hit.x - preview.x;
        const oy = preview.hit.y - preview.y;
        const len = Math.hypot(ox, oy) || 1;
        ctx.strokeStyle = 'rgba(232, 193, 92, 0.75)';
        ctx.beginPath();
        ctx.moveTo(preview.hit.x, preview.hit.y);
        ctx.lineTo(preview.hit.x + (ox / len) * 46, preview.hit.y + (oy / len) * 46);
        ctx.stroke();
    }

    // The cue stick, drawn behind the ball and pulled back with the power.
    const back = BALL_R + 6 + power * 46;
    const tipX = cue.x - dx * back;
    const tipY = cue.y - dy * back;
    const buttX = cue.x - dx * (back + 165);
    const buttY = cue.y - dy * (back + 165);
    const stick = ctx.createLinearGradient(tipX, tipY, buttX, buttY);
    stick.addColorStop(0, '#f0e4c8');
    stick.addColorStop(0.12, '#c9a063');
    stick.addColorStop(1, '#6b4425');
    ctx.strokeStyle = stick;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(buttX, buttY);
    ctx.stroke();
    ctx.lineCap = 'butt';
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawTable();
    for (const b of balls) {
        if (!b.sunk) drawBall(b);
    }
    if (showsAimGuide()) drawAim();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min((now - lastTime) / 1000, MAX_DT) : 0;
    lastTime = now;
    if (state === 'rolling') step(dt);
    if (charging) updateCharge(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
        y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    };
}

canvas.addEventListener('mousemove', (e) => {
    if (state !== 'aiming' || charging) return;
    const p = pointerPos(e);
    aimAt(p.x, p.y);
});

canvas.addEventListener('mousedown', (e) => {
    if (state === 'idle' || state === 'won') {
        startGame();
        return;
    }
    if (state !== 'aiming') return;
    const p = pointerPos(e);
    aimAt(p.x, p.y);
    beginCharge();
    e.preventDefault();
});

window.addEventListener('mouseup', () => {
    if (charging) releaseCharge();
});

window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (state === 'idle' || state === 'won') startGame();
        else if (state === 'aiming' && !charging) beginCharge();
        return;
    }
    if (e.key === 'r' || e.key === 'R') {
        startGame();
        return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (state !== 'aiming') return;
        const stepSize = e.shiftKey ? AIM_STEP_FINE : AIM_STEP;
        setAim(aimAngle + (e.key === 'ArrowLeft' ? -stepSize : stepSize));
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if ((e.key === ' ' || e.code === 'Space') && charging) releaseCharge();
});

btnStart.addEventListener('click', () => startGame());

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

let storedBest = null;
try {
    storedBest = parseInt(localStorage.getItem(BEST_KEY) || '', 10);
} catch (err) {
    storedBest = null;
}
bestShots = Number.isFinite(storedBest) && storedBest > 0 ? storedBest : null;

state = 'idle';
shots = 0;
aimAngle = 0;
power = 0;
charging = false;
rackBalls();
updateHud();
requestAnimationFrame(frame);
