// ---------------------------------------------------------------------------
// Marble Shooter — a Zuma-style path shooter on an HTML5 canvas.
//
// A train of coloured marbles crawls along a spiral track toward the hole at
// its centre. A cannon in the middle of the spiral fires marbles into the
// train; three or more of a colour in a row pop, and the rear of the train
// closes the gap — which can pop the seam as well, for a combo.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames
// deterministically without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 400;
const CX = CANVAS_W / 2;
const CY = CANVAS_H / 2;

// --- Spiral track (elliptical, radii shrinking from outer to inner) ---
const TURNS = 2.5;
const R_OUT_X = 282, R_OUT_Y = 182;
const R_IN_X = 58, R_IN_Y = 48;
const PATH_SAMPLES = 3200;

// --- Marbles ---
const MARBLE_R = 10;
const SPACING = MARBLE_R * 2;      // gap between consecutive marbles, in track px
const MIN_MATCH = 3;
const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#06b6d4'];

// --- Difficulty (all pure functions of `level`) ---
const CHAIN_BASE = 45, CHAIN_STEP = 8;      // px/s the train crawls
const MARBLES_BASE = 28, MARBLES_STEP = 4, MARBLES_MAX = 48;
const COLORS_BASE = 3;                      // colours = COLORS_BASE + level, capped

// --- Cannon ---
const MUZZLE = 22;                 // distance from the cannon centre to the muzzle
const SHOT_SPEED = 460;            // px/s
const FIRE_COOLDOWN = 0.15;        // s between shots
const AIM_SPEED = 3.0;             // rad/s for keyboard rotation
const MAX_SHOTS = 4;

// --- Scoring ---
const POINTS_PER_MARBLE = 10;
const LEVEL_BONUS = 250;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const marblesEl = document.getElementById('marbles');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Track: sample the spiral into a polyline with cumulative arc lengths so any
// distance along the track maps to a point (and back again).
// ---------------------------------------------------------------------------

const PATH = [];
const CUM = [];

(function buildPath() {
    const tMax = TURNS * Math.PI * 2;
    for (let i = 0; i <= PATH_SAMPLES; i++) {
        const u = i / PATH_SAMPLES;
        const t = u * tMax;
        const rx = R_OUT_X + (R_IN_X - R_OUT_X) * u;
        const ry = R_OUT_Y + (R_IN_Y - R_OUT_Y) * u;
        PATH.push({ x: CX + rx * Math.cos(t), y: CY + ry * Math.sin(t) });
    }
    CUM.push(0);
    for (let i = 1; i < PATH.length; i++) {
        CUM.push(CUM[i - 1] + Math.hypot(PATH[i].x - PATH[i - 1].x, PATH[i].y - PATH[i - 1].y));
    }
})();

const pathLength = CUM[CUM.length - 1];
const hole = { x: PATH[PATH.length - 1].x, y: PATH[PATH.length - 1].y };

function indexAtDist(d) {
    if (d <= 0) return 0;
    if (d >= pathLength) return PATH.length - 1;
    let lo = 0, hi = CUM.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (CUM[mid] <= d) lo = mid; else hi = mid;
    }
    return lo;
}

function pathPointAt(d) {
    if (d <= 0) return { x: PATH[0].x, y: PATH[0].y };
    const last = PATH.length - 1;
    if (d >= pathLength) return { x: PATH[last].x, y: PATH[last].y };
    const i = indexAtDist(d);
    const span = CUM[i + 1] - CUM[i];
    const t = span > 0 ? (d - CUM[i]) / span : 0;
    return {
        x: PATH[i].x + (PATH[i + 1].x - PATH[i].x) * t,
        y: PATH[i].y + (PATH[i + 1].y - PATH[i].y) * t,
    };
}

// Distance along the track of the sample nearest (x, y). `near` restricts the
// search to a window around a known distance, which is what disambiguates the
// coils of the spiral when a shot lands between two marbles.
function nearestPathDist(x, y, near) {
    let lo = 0, hi = PATH.length - 1;
    if (typeof near === 'number') {
        lo = indexAtDist(near - 80);
        hi = indexAtDist(near + 80);
    }
    let best = lo, bestD2 = Infinity;
    for (let i = lo; i <= hi; i++) {
        const dx = PATH[i].x - x, dy = PATH[i].y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
    return CUM[best];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, level, headDist, fireTimer, aimDir, flash;
const marbles = [];                // index 0 is the front (nearest the hole)
const shots = [];
const particles = [];
const shooter = { x: CX, y: CY, angle: -Math.PI / 2, current: 0, next: 1 };

// ---------------------------------------------------------------------------
// Difficulty helpers
// ---------------------------------------------------------------------------

function chainSpeed() { return CHAIN_BASE + (level - 1) * CHAIN_STEP; }
function colorCount() { return Math.min(COLORS.length, COLORS_BASE + level); }
function levelMarbleCount(n) { return Math.min(MARBLES_MAX, MARBLES_BASE + (n - 1) * MARBLES_STEP); }

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

function marbleDist(i) { return headDist - i * SPACING; }
function marblePos(i) { return pathPointAt(marbleDist(i)); }

function setChain(colors, head) {
    marbles.length = 0;
    for (const c of colors) marbles.push({ color: c });
    headDist = head || 0;
    updateHud();
}

function spawnChain() {
    const n = levelMarbleCount(level);
    const colors = [];
    for (let i = 0; i < n; i++) {
        let c;
        do {
            c = Math.floor(Math.random() * colorCount());
        } while (i >= 2 && c === colors[i - 1] && c === colors[i - 2]);
        colors.push(c);
    }
    setChain(colors, 0);
}

// A colour still present in the chain, so the cannon never hands out a marble
// that cannot possibly match.
function pickQueueColor() {
    const present = [...new Set(marbles.map((m) => m.color))];
    if (present.length === 0) return Math.floor(Math.random() * colorCount());
    return present[Math.floor(Math.random() * present.length)];
}

// Splice a marble in at `index`. Everything from `index` back is pushed one
// slot away from the hole; inserting at the very front instead advances the
// head so the existing marbles stay exactly where they are.
function insertMarble(index, color) {
    marbles.splice(index, 0, { color });
    if (index === 0) headDist += SPACING;
    updateHud();
    return index;
}

// Pop the run around `index`, then keep checking the seam the pop created.
// Returns the total number of marbles removed.
function resolveMatches(index) {
    let total = 0;
    let combo = 1;
    let i = index;

    while (i >= 0 && i < marbles.length) {
        const color = marbles[i].color;
        let s = i, e = i;
        while (s > 0 && marbles[s - 1].color === color) s--;
        while (e < marbles.length - 1 && marbles[e + 1].color === color) e++;
        const n = e - s + 1;
        if (n < MIN_MATCH) break;

        for (let k = s; k <= e; k++) burst(marblePos(k), COLORS[marbles[k].color % COLORS.length]);
        marbles.splice(s, n);
        if (s === 0) headDist -= n * SPACING;   // nothing in front to close up to

        score += n * POINTS_PER_MARBLE * combo;
        total += n;
        combo++;
        flash = Math.min(1, flash + 0.4);

        if (s > 0 && s < marbles.length && marbles[s - 1].color === marbles[s].color) i = s;
        else break;
    }

    if (total > 0) updateHud();
    return total;
}

// ---------------------------------------------------------------------------
// Cannon
// ---------------------------------------------------------------------------

function setAim(angle) { shooter.angle = angle; }

function aimAt(x, y) { shooter.angle = Math.atan2(y - shooter.y, x - shooter.x); }

function swapColors() {
    const c = shooter.current;
    shooter.current = shooter.next;
    shooter.next = c;
}

function fire() {
    if (state !== 'running' || fireTimer > 0 || shots.length >= MAX_SHOTS) return false;
    const cos = Math.cos(shooter.angle), sin = Math.sin(shooter.angle);
    shots.push({
        x: shooter.x + cos * MUZZLE,
        y: shooter.y + sin * MUZZLE,
        vx: cos * SHOT_SPEED,
        vy: sin * SHOT_SPEED,
        color: shooter.current,
    });
    shooter.current = shooter.next;
    shooter.next = pickQueueColor();
    fireTimer = FIRE_COOLDOWN;
    return true;
}

// The marble a shot has run into, or -1. Marbles that have not emerged from the
// mouth of the track yet cannot be hit.
function hitMarble(shot) {
    let best = -1, bestD2 = (MARBLE_R * 2) * (MARBLE_R * 2);
    for (let i = 0; i < marbles.length; i++) {
        const d = marbleDist(i);
        if (d < 0 || d > pathLength) continue;
        const p = pathPointAt(d);
        const dx = p.x - shot.x, dy = p.y - shot.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
    return best;
}

// Insert in front of the marble that was hit when the shot landed further along
// the track than that marble, otherwise behind it.
function insertIndexFor(shot, j) {
    const d = nearestPathDist(shot.x, shot.y, marbleDist(j));
    return d > marbleDist(j) ? j : j + 1;
}

function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;

        const j = hitMarble(s);
        if (j >= 0) {
            shots.splice(i, 1);
            const at = insertIndexFor(s, j);
            insertMarble(at, s.color);
            resolveMatches(at);
            continue;
        }

        const m = MARBLE_R * 2;
        if (s.x < -m || s.x > CANVAS_W + m || s.y < -m || s.y > CANVAS_H + m) shots.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Particles (pop effect)
// ---------------------------------------------------------------------------

function burst(p, color) {
    for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 90;
        particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.45, color });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function nextLevel() {
    score += LEVEL_BONUS * level;
    level++;
    spawnChain();
    shots.length = 0;
    shooter.current = pickQueueColor();
    shooter.next = pickQueueColor();
    flash = 1;
    updateHud();
}

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    fireTimer = 0;
    aimDir = 0;
    flash = 0;
    shots.length = 0;
    particles.length = 0;
    spawnChain();
    shooter.angle = -Math.PI / 2;
    shooter.current = pickQueueColor();
    shooter.next = pickQueueColor();
    hideOverlay();
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('marble-shooter-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space to try again', 'Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function step(dt) {
    if (state !== 'running') return;

    if (aimDir !== 0) shooter.angle += aimDir * AIM_SPEED * dt;
    if (fireTimer > 0) fireTimer = Math.max(0, fireTimer - dt);
    if (flash > 0) flash = Math.max(0, flash - dt * 2);

    headDist += chainSpeed() * dt;
    updateShots(dt);
    updateParticles(dt);

    if (marbles.length === 0) { nextLevel(); return; }
    if (headDist >= pathLength) endGame();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    marblesEl.textContent = String(marbles.length);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreLine, sub, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawTrack() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(PATH[0].x, PATH[0].y);
    for (let i = 1; i < PATH.length; i += 4) ctx.lineTo(PATH[i].x, PATH[i].y);
    ctx.lineTo(hole.x, hole.y);
    ctx.strokeStyle = '#132039';
    ctx.lineWidth = SPACING + 8;
    ctx.stroke();
    ctx.strokeStyle = '#0a1120';
    ctx.lineWidth = SPACING + 1;
    ctx.stroke();

    // the hole the chain is falling into
    const danger = marbles.length > 0
        ? Math.max(0, Math.min(1, (headDist - (pathLength - 220)) / 220))
        : 0;
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, MARBLE_R + 6, 0, Math.PI * 2);
    ctx.fillStyle = '#04070f';
    ctx.fill();
    ctx.strokeStyle = danger > 0 ? `rgba(248, 113, 113, ${0.35 + danger * 0.65})` : '#24344f';
    ctx.lineWidth = 3;
    ctx.stroke();
}

function drawMarble(x, y, colorIndex, radius) {
    const color = COLORS[colorIndex % COLORS.length];
    const g = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.15, x, y, radius);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.28, color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawChain() {
    for (let i = marbles.length - 1; i >= 0; i--) {
        const d = marbleDist(i);
        if (d < 0 || d > pathLength) continue;
        const p = pathPointAt(d);
        drawMarble(p.x, p.y, marbles[i].color, MARBLE_R);
    }
}

function drawShooter() {
    const { x, y, angle } = shooter;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#25334d';
    ctx.strokeStyle = '#3d5273';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-4, -8, MUZZLE + 6, 16, 5);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#1b2740';
    ctx.fill();
    ctx.strokeStyle = '#3d5273';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (state === 'running' || state === 'paused') {
        drawMarble(x, y, shooter.current, MARBLE_R);
        drawMarble(x + 2, y + 26, shooter.next, MARBLE_R * 0.62);
    }

    // aim guide
    if (state === 'running') {
        ctx.save();
        ctx.setLineDash([4, 8]);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(shooter.angle) * (MUZZLE + 4), y + Math.sin(shooter.angle) * (MUZZLE + 4));
        ctx.lineTo(x + Math.cos(shooter.angle) * 340, y + Math.sin(shooter.angle) * 340);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const bg = ctx.createRadialGradient(CX, CY, 20, CX, CY, 330);
    bg.addColorStop(0, '#0d182c');
    bg.addColorStop(1, '#060b16');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawTrack();
    drawChain();

    for (const s of shots) drawMarble(s.x, s.y, s.color, MARBLE_R);

    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / 0.45);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawShooter();

    if (flash > 0) {
        ctx.fillStyle = `rgba(56, 189, 248, ${flash * 0.12})`;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
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

const heldKeys = new Set();

function refreshAimDir() {
    const left = heldKeys.has('ArrowLeft') || heldKeys.has('a') || heldKeys.has('A');
    const right = heldKeys.has('ArrowRight') || heldKeys.has('d') || heldKeys.has('D');
    aimDir = (right ? 1 : 0) - (left ? 1 : 0);
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        if (state === 'running') fire();
        else if (state !== 'paused') startGame();
        return;
    }
    if (e.key === 'p' || e.key === 'P') { togglePause(); return; }
    if (e.key === 's' || e.key === 'S') { swapColors(); return; }
    if (['ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D'].includes(e.key)) {
        heldKeys.add(e.key);
        refreshAimDir();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshAimDir();
    }
});

function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (CANVAS_W / rect.width),
        y: (e.clientY - rect.top) * (CANVAS_H / rect.height),
    };
}

canvas.addEventListener('mousemove', (e) => {
    const p = canvasPoint(e);
    heldKeys.clear();
    aimDir = 0;
    aimAt(p.x, p.y);
});

canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (state === 'running') {
        const p = canvasPoint(e);
        aimAt(p.x, p.y);
        fire();
    } else if (state !== 'paused') {
        startGame();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('marble-shooter-best') || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
headDist = 0;
fireTimer = 0;
aimDir = 0;
flash = 0;
updateHud();
requestAnimationFrame(frame);
