// ---------------------------------------------------------------------------
// Marble Spiral — a marble-shooter on an HTML5 canvas.
//
// A chain of coloured marbles crawls along a spiral groove towards the pit at
// its centre. A turret in the middle of the spiral fires marbles into the
// chain; three or more of a colour touching each other pop. Clear every marble
// before the leader reaches the pit.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 480;

// --- The spiral path (marbles travel from the outer end to the inner pit) ---
const SPIRAL_CX = 320;
const SPIRAL_CY = 240;
const SPIRAL_R_OUT = 212;   // radius at the path start
const SPIRAL_R_IN = 96;     // radius at the pit
const SPIRAL_TURNS = 2.25;
const SPIRAL_A0 = -Math.PI / 2;
const PATH_SAMPLES = 2400;

// --- Marbles ---
const BALL_R = 12;
const BALL_SPACING = 24;    // centre-to-centre gap inside the chain
const MIN_MATCH = 3;        // marbles of a colour needed to pop

// --- Shooting ---
const SHOT_SPEED = 520;     // px/s
const SHOT_COOLDOWN = 0.18; // seconds between shots

// --- Scoring ---
const POP_POINTS = 10;      // per marble, multiplied by the combo step
const LEVEL_BONUS = 250;
const POP_PUSHBACK = 6;     // px the chain is shoved back per popped marble

// --- Difficulty scaling (all pure functions of `level`) ---
const COUNT_BASE = 34, COUNT_STEP = 6;
const SPEED_BASE = 26, SPEED_STEP = 5;

const COLORS = ['#ef4444', '#38bdf8', '#22c55e', '#f59e0b', '#a855f7', '#ec4899'];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const leftEl = document.getElementById('left');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, level, pending, chainFront, shotCooldown;
let currentColor, nextColor, lastCombo;
const chain = [];       // index 0 is the leader; positions derive from chainFront
const shots = [];       // marbles in flight
const particles = [];   // pop confetti (cosmetic only)
const shooter = { x: SPIRAL_CX, y: SPIRAL_CY, angle: -Math.PI / 2 };

// ---------------------------------------------------------------------------
// The spiral path
//
// The curve is sampled once into a polyline with a cumulative arc-length table,
// which turns it into an arc-length parameterised path: `pathPoint(d)` is the
// point exactly `d` pixels along the groove. Everything else in the game talks
// in those distances, so marble spacing is uniform no matter how the spiral
// curves.
// ---------------------------------------------------------------------------

const PATH = (() => {
    const pts = [];
    for (let i = 0; i <= PATH_SAMPLES; i++) {
        const t = i / PATH_SAMPLES;
        const r = SPIRAL_R_OUT + (SPIRAL_R_IN - SPIRAL_R_OUT) * t;
        const a = SPIRAL_A0 + t * SPIRAL_TURNS * Math.PI * 2;
        pts.push({ x: SPIRAL_CX + Math.cos(a) * r, y: SPIRAL_CY + Math.sin(a) * r, d: 0 });
    }
    for (let i = 1; i < pts.length; i++) {
        pts[i].d = pts[i - 1].d + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return pts;
})();

const PATH_LENGTH = PATH[PATH.length - 1].d;
const PIT = { x: PATH[PATH.length - 1].x, y: PATH[PATH.length - 1].y };

function pathLength() { return PATH_LENGTH; }

// The point `d` pixels along the groove, clamped to the two ends.
function pathPoint(d) {
    if (d <= 0) return { x: PATH[0].x, y: PATH[0].y };
    if (d >= PATH_LENGTH) return { x: PIT.x, y: PIT.y };
    let lo = 0, hi = PATH.length - 1;
    while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (PATH[mid].d <= d) lo = mid; else hi = mid;
    }
    const a = PATH[lo], b = PATH[hi];
    const span = b.d - a.d;
    const t = span > 0 ? (d - a.d) / span : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Distance along the groove of the sample nearest to (x, y) — used to work out
// where an incoming shot belongs in the chain.
function nearestPathDist(x, y) {
    let bestD = 0, bestSq = Infinity;
    for (let i = 0; i < PATH.length; i++) {
        const p = PATH[i];
        const sq = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
        if (sq < bestSq) { bestSq = sq; bestD = p.d; }
    }
    return bestD;
}

// The tangent direction of the groove at distance `d` (for drawing).
function pathAngle(d) {
    const a = pathPoint(Math.max(0, d - 2));
    const b = pathPoint(Math.min(PATH_LENGTH, d + 2));
    return Math.atan2(b.y - a.y, b.x - a.x);
}

// ---------------------------------------------------------------------------
// Chain geometry
//
// The chain is rigid: marble `i` always sits exactly `i * BALL_SPACING` behind
// the leader, so inserting or popping marbles re-packs the whole chain for
// free.
// ---------------------------------------------------------------------------

function ballDist(i) { return chainFront - i * BALL_SPACING; }
function ballPos(i) { return pathPoint(ballDist(i)); }

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

function levelBallCount(l) { return COUNT_BASE + (l - 1) * COUNT_STEP; }
function chainSpeed(l) { return SPEED_BASE + (l - 1) * SPEED_STEP; }
function colorsForLevel(l) { return Math.min(COLORS.length, 3 + Math.floor((l - 1) / 2)); }

function randomColor() {
    const palette = COLORS.slice(0, colorsForLevel(level));
    return palette[Math.floor(Math.random() * palette.length)];
}

// Prefer a colour that is actually still on the board, so the turret never
// hands the player a marble that cannot possibly match.
function reloadColor() {
    const live = [];
    for (const b of chain) if (!live.includes(b.color)) live.push(b.color);
    if (live.length > 0 && Math.random() < 0.85) {
        return live[Math.floor(Math.random() * live.length)];
    }
    return randomColor();
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------

function aimAt(x, y) {
    shooter.angle = Math.atan2(y - shooter.y, x - shooter.x);
}

function launch(color, x, y, angle) {
    shots.push({
        x, y, color,
        vx: Math.cos(angle) * SHOT_SPEED,
        vy: Math.sin(angle) * SHOT_SPEED,
    });
    return shots[shots.length - 1];
}

function shoot() {
    if (state !== 'running' || shotCooldown > 0) return null;
    shotCooldown = SHOT_COOLDOWN;
    const shot = launch(
        currentColor,
        shooter.x + Math.cos(shooter.angle) * (BALL_R + 10),
        shooter.y + Math.sin(shooter.angle) * (BALL_R + 10),
        shooter.angle,
    );
    currentColor = nextColor;
    nextColor = reloadColor();
    return shot;
}

function swapColors() {
    const tmp = currentColor;
    currentColor = nextColor;
    nextColor = tmp;
}

// Test hook: drop a shot of a known colour at a known spot, ignoring cooldown,
// so specs can aim precisely without simulating the flight.
function fireTestShot(color, x, y) {
    return launch(color, x, y, Math.atan2(y - shooter.y, x - shooter.x));
}

// ---------------------------------------------------------------------------
// Insertion & matching
// ---------------------------------------------------------------------------

// Where in the chain a marble sitting at (x, y) belongs: marbles are ordered by
// decreasing distance, so the new marble goes before the first one that is
// further from the pit than it is.
function insertIndexFor(x, y) {
    const d = nearestPathDist(x, y);
    const i = Math.floor((chainFront - d) / BALL_SPACING) + 1;
    return Math.max(0, Math.min(chain.length, i));
}

// The run of same-coloured marbles containing `i`.
function runAt(i) {
    const color = chain[i].color;
    let start = i, end = i;
    while (start > 0 && chain[start - 1].color === color) start--;
    while (end < chain.length - 1 && chain[end + 1].color === color) end++;
    return { start, len: end - start + 1 };
}

// Pop the run containing `index`, then keep popping while the join created by
// the last pop is itself a match (a chain reaction). Each successive pop is
// worth more.
function resolveMatches(index) {
    let combo = 0;
    let i = index;
    while (i >= 0 && i < chain.length) {
        const run = runAt(i);
        if (run.len < MIN_MATCH) break;
        combo += 1;
        for (let k = 0; k < run.len; k++) spawnPopBurst(run.start + k, chain[run.start + k].color);
        chain.splice(run.start, run.len);
        score += run.len * POP_POINTS * combo;
        chainFront = Math.max(0, chainFront - POP_PUSHBACK * run.len);
        if (run.start === 0 || run.start >= chain.length) break;
        if (chain[run.start - 1].color !== chain[run.start].color) break;
        i = run.start;
    }
    lastCombo = combo;
    if (combo > 0 && chain.length === 0 && pending === 0) completeLevel();
    return combo;
}

function insertShot(shot) {
    const index = insertIndexFor(shot.x, shot.y);
    chain.splice(index, 0, { color: shot.color });
    resolveMatches(index);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    if (shotCooldown > 0) shotCooldown = Math.max(0, shotCooldown - h);

    // The chain crawls towards the pit.
    if (chain.length > 0) {
        chainFront += chainSpeed(level) * h;
        if (chainFront >= PATH_LENGTH) {
            chainFront = PATH_LENGTH;
            endGame();
            return;
        }
    }

    // Feed queued marbles onto the back of the chain.
    if (pending > 0) {
        if (chain.length === 0) chainFront = 0;
        while (pending > 0 && chainFront - chain.length * BALL_SPACING >= 0) {
            chain.push({ color: randomColor() });
            pending -= 1;
        }
    }

    // Shots fly, and join the chain when they touch it.
    for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.x += s.vx * h;
        s.y += s.vy * h;

        let hit = false;
        for (let j = 0; j < chain.length; j++) {
            const d = ballDist(j);
            if (d < 0) continue;
            const p = pathPoint(d);
            if (Math.hypot(p.x - s.x, p.y - s.y) <= BALL_R * 2) { hit = true; break; }
        }
        if (hit) {
            shots.splice(i, 1);
            insertShot(s);
            continue;
        }
        if (s.x < -BALL_R || s.x > CANVAS_W + BALL_R || s.y < -BALL_R || s.y > CANVAS_H + BALL_R) {
            shots.splice(i, 1);
        }
    }

    // Cosmetic pop confetti.
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * h;
        p.y += p.vy * h;
        p.vy += 320 * h;
        p.life -= h;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so fast shots
// can never tunnel through the chain and the integration is
// resolution-independent.
function step(dt) {
    if (state !== 'running') return;
    const SUB = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-6) {
        const h = Math.min(SUB, remaining);
        substep(h);
        remaining -= h;
        if (state !== 'running') break;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startLevel(l) {
    level = l;
    chain.length = 0;
    shots.length = 0;
    chainFront = 0;
    pending = levelBallCount(l);
    shotCooldown = 0;
    currentColor = randomColor();
    nextColor = randomColor();
    lastCombo = 0;
}

function completeLevel() {
    score += LEVEL_BONUS;
    startLevel(level + 1);
}

function startGame() {
    state = 'running';
    score = 0;
    particles.length = 0;
    startLevel(1);
    hideOverlay();
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('marble-spiral-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Score ' + score + ' · Level ' + level, 'Press Space to play again', 'Play Again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    leftEl.textContent = String(pending + chain.length);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreText, sub, buttonText) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = buttonText;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function spawnPopBurst(index, color) {
    const p = pathPoint(ballDist(index));
    for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 120;
        particles.push({
            x: p.x, y: p.y, color,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 0.35 + Math.random() * 0.3,
        });
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawMarble(x, y, color, radius) {
    const r = radius || BALL_R;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.28, color);
    g.addColorStop(1, '#0b1020');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawGroove() {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = BALL_R * 2 + 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < PATH.length; i += 8) {
        const p = PATH[i];
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(PIT.x, PIT.y);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 10]);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawPit() {
    const g = ctx.createRadialGradient(PIT.x, PIT.y, 2, PIT.x, PIT.y, 22);
    g.addColorStop(0, '#000000');
    g.addColorStop(1, 'rgba(2, 6, 23, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(PIT.x, PIT.y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(PIT.x, PIT.y, 15, 0, Math.PI * 2);
    ctx.stroke();
}

function drawShooter() {
    const { x, y, angle } = shooter;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, -7, 34, 14);
    ctx.fillStyle = '#475569';
    ctx.fillRect(26, -9, 8, 18);
    ctx.restore();

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (state === 'running' || state === 'paused') {
        drawMarble(x, y, currentColor, 13);
        // Next marble sits in the hopper behind the turret.
        ctx.globalAlpha = 0.75;
        drawMarble(x - Math.cos(angle) * 30, y - Math.sin(angle) * 30, nextColor, 8);
        ctx.globalAlpha = 1;
    }
}

function drawAimLine() {
    if (state !== 'running') return;
    ctx.save();
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(shooter.x + Math.cos(shooter.angle) * 26, shooter.y + Math.sin(shooter.angle) * 26);
    ctx.lineTo(shooter.x + Math.cos(shooter.angle) * 420, shooter.y + Math.sin(shooter.angle) * 420);
    ctx.stroke();
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    drawGroove();
    drawPit();
    drawAimLine();

    // Chain, tail first so the leader draws on top.
    for (let i = chain.length - 1; i >= 0; i--) {
        const d = ballDist(i);
        if (d < 0) continue;
        const p = pathPoint(d);
        drawMarble(p.x, p.y, chain[i].color);
    }

    // Danger flash when the leader gets close to the pit.
    if (chain.length > 0 && chainFront > PATH_LENGTH - 160) {
        const t = (chainFront - (PATH_LENGTH - 160)) / 160;
        ctx.fillStyle = 'rgba(248, 113, 113, ' + (0.05 + 0.15 * t) + ')';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    for (const s of shots) drawMarble(s.x, s.y, s.color);

    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.5));
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    drawShooter();

    // Leading marble's heading marker, so the player can read the direction.
    if (chain.length > 0 && ballDist(0) >= 0) {
        const p = ballPos(0);
        const a = pathAngle(ballDist(0));
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * (BALL_R + 3), p.y + Math.sin(a) * (BALL_R + 3));
        ctx.lineTo(p.x + Math.cos(a) * (BALL_R + 10), p.y + Math.sin(a) * (BALL_R + 10));
        ctx.stroke();
    }
}

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
// Input
// ---------------------------------------------------------------------------

function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (CANVAS_W / rect.width),
        y: (e.clientY - rect.top) * (CANVAS_H / rect.height),
    };
}

window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
        if (state === 'running') swapColors();
        else if (state === 'paused') togglePause();
        else startGame();
        e.preventDefault();
    } else if (e.key === 'p' || e.key === 'P') {
        togglePause();
        e.preventDefault();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const p = canvasPoint(e);
    aimAt(p.x, p.y);
});

canvas.addEventListener('click', (e) => {
    const p = canvasPoint(e);
    aimAt(p.x, p.y);
    shoot();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('marble-spiral-best') || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
pending = 0;
chainFront = 0;
shotCooldown = 0;
lastCombo = 0;
currentColor = COLORS[0];
nextColor = COLORS[1];
updateHud();
requestAnimationFrame(frame);
