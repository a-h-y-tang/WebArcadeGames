// ---------------------------------------------------------------------------
// Marble Spiral — a path-based marble shooter.
//
// A train of coloured marbles crawls along a spiral track towards the pit in
// the middle. The shooter sits in the eye of the spiral and fires marbles into
// the train; three or more of a colour touching pops them. Clear the whole
// train before its leading marble drops into the pit.
//
// Everything lives in the global scope on purpose: the Playwright suite drives
// the simulation directly (startGame, step, spawnShot, setChain, ...).
// ---------------------------------------------------------------------------

const CANVAS_W = 600;
const CANVAS_H = 480;

const BALL_R = 13;              // marble radius
const SPACING = 26;             // gap between marble centres along the track
const SHOT_SPEED = 520;         // px/s for a fired marble
const CATCH_SPEED = 300;        // px/s a detached tail uses to close a gap
const SHOOTER_MUZZLE = 22;      // how far from the shooter a marble is born

const CENTER = { x: 300, y: 240 };
const R_OUT = 310;              // spiral radius at the track entrance
const R_IN = 95;                // spiral radius at the pit
const TURNS = 2.3;              // how many times the track winds around
const Y_SCALE = 0.72;           // squash the spiral into the 600x480 canvas

const COLORS = ['#ff4d5a', '#ffd23f', '#3ddc84', '#4aa3ff', '#c46bff', '#ff8f3f'];

const BEST_KEY = 'marble-spiral-best';

// ---------------------------------------------------------------------------
// The track
//
// The spiral is sampled densely and then re-sampled at one-pixel arc-length
// steps, so `pathPoint(d)` is a plain array lookup and every marble position is
// expressed as a single number: its distance travelled along the track.
// ---------------------------------------------------------------------------

const pathPts = [];

(function buildPath() {
    const raw = [];
    const N = 6000;
    for (let i = 0; i <= N; i++) {
        const t = i / N;
        const ang = t * TURNS * Math.PI * 2;
        const r = R_OUT + (R_IN - R_OUT) * t;
        raw.push({
            x: CENTER.x + Math.cos(ang) * r,
            y: CENTER.y + Math.sin(ang) * r * Y_SCALE,
        });
    }

    pathPts.push(raw[0]);
    let acc = 0;
    let target = 1;
    for (let i = 1; i < raw.length; i++) {
        const a = raw[i - 1];
        const b = raw[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        while (seg > 0 && acc + seg >= target) {
            const f = (target - acc) / seg;
            pathPts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
            target += 1;
        }
        acc += seg;
    }
})();

const PATH_LEN = pathPts.length - 1;

function pathPoint(d) {
    const i = Math.max(0, Math.min(PATH_LEN, Math.round(d)));
    return pathPts[i];
}

/** Unit vector pointing "forwards" (towards the pit) at track distance `d`. */
function pathDir(d) {
    const a = pathPoint(Math.max(0, d - 4));
    const b = pathPoint(Math.min(PATH_LEN, d + 4));
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

let state = 'idle';             // idle | running | paused | levelup | over
let score = 0;
let best = 0;
let level = 1;
let combo = 1;

const balls = [];               // on the track, index 0 is the leading marble
const queue = [];               // colours still waiting to enter the track
const shots = [];               // marbles in flight
const particles = [];           // pop effects

const shooter = { x: CENTER.x, y: CENTER.y, angle: -Math.PI / 2, color: null, next: null };

// ---------------------------------------------------------------------------
// Level shape
// ---------------------------------------------------------------------------

function levelColors(l) {
    return COLORS.slice(0, Math.min(COLORS.length, 3 + Math.floor((l - 1) / 2)));
}

function levelBallCount(l) {
    return 30 + (l - 1) * 6;
}

function levelSpeed(l) {
    return 24 + (l - 1) * 5;
}

function colorsInPlay() {
    const set = new Set();
    for (const b of balls) set.add(b.color);
    for (const c of queue) set.add(c);
    return [...set];
}

/** Pick a colour for the shooter — only colours the player can still use. */
function pickColor() {
    const pool = colorsInPlay();
    const src = pool.length ? pool : levelColors(level);
    return src[Math.floor(Math.random() * src.length)];
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    startLevel(1);
}

function startLevel(l) {
    level = l;
    balls.length = 0;
    queue.length = 0;
    shots.length = 0;
    particles.length = 0;
    combo = 1;

    const palette = levelColors(l);
    const count = levelBallCount(l);
    for (let i = 0; i < count; i++) {
        queue.push(palette[Math.floor(Math.random() * palette.length)]);
    }

    shooter.color = pickColor();
    shooter.next = pickColor();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    startLevel(level + 1);
}

function completeLevel() {
    score += 100 * level;
    state = 'levelup';
    updateHud();
    showOverlay(`Level ${level} Cleared!`, `Score ${score}`, 'Next Level',
        'Press Space for the next level');
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (err) { /* ignore */ }
    }
    updateHud();
    showOverlay('Game Over', `Score ${score} · Level ${level}`, 'Play Again',
        'Press Space to try again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Resume', 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    advanceTrain(dt);
    feedFromQueue();
    updateShots(dt);
    updateParticles(dt);

    if (balls.length && balls[0].dist >= PATH_LEN) {
        endGame();
        return;
    }
    // The level is only over once the track is empty and nothing is still in
    // flight — a marble already fired deserves the chance to land.
    if (!balls.length && !queue.length && !shots.length) completeLevel();
}

/**
 * Move the train. The leading marble crawls forwards; everything behind it is
 * either held at exactly SPACING behind the marble ahead, or — when a cleared
 * run has left a gap — catches up at CATCH_SPEED. A gap that closes on two
 * matching colours pops as a combo.
 */
function advanceTrain(dt) {
    if (!balls.length) return;
    balls[0].dist += levelSpeed(level) * dt;

    for (let i = 1; i < balls.length; i++) {
        const target = balls[i - 1].dist - SPACING;
        if (balls[i].dist >= target) {
            balls[i].dist = target;
            continue;
        }
        const closed = balls[i].dist + CATCH_SPEED * dt >= target;
        balls[i].dist = Math.min(target, balls[i].dist + CATCH_SPEED * dt);
        if (!closed) continue;

        // Only a marble that a clear tore off the train can pop on contact —
        // otherwise the runs the level starts with would burst on their own.
        const detached = balls[i].detached;
        balls[i].detached = false;
        if (detached && balls[i].color === balls[i - 1].color) {
            if (clearRunAt(i, combo + 1)) {
                combo++;
                break;      // the array shifted; the rest resolves next frame
            }
        }
    }
}

function feedFromQueue() {
    while (queue.length && (!balls.length || balls[balls.length - 1].dist >= SPACING)) {
        balls.push({ color: queue.shift(), dist: 0 });
    }
}

function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        // Sub-step so a fast marble cannot tunnel through the train.
        const sub = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy) * dt) / BALL_R));
        let hit = false;
        for (let k = 0; k < sub && !hit; k++) {
            s.x += (s.vx * dt) / sub;
            s.y += (s.vy * dt) / sub;
            hit = tryJoinTrain(s);
        }
        if (hit || s.x < -40 || s.x > CANVAS_W + 40 || s.y < -40 || s.y > CANVAS_H + 40) {
            shots.splice(i, 1);
        }
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 220 * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

/** Returns true when the flying marble `s` touched the train and joined it. */
function tryJoinTrain(s) {
    let hit = -1;
    let bestDist = Infinity;
    for (let i = 0; i < balls.length; i++) {
        if (balls[i].dist < 0) continue;
        const p = pathPoint(balls[i].dist);
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        if (d < bestDist) { bestDist = d; hit = i; }
    }
    if (hit < 0 || bestDist > BALL_R * 2) return false;
    joinTrain(hit, s);
    return true;
}

/**
 * Slot a marble into the train next to `hitIndex`. Insertion never pushes the
 * head forwards — the tail is what gets shoved backwards.
 */
function joinTrain(hitIndex, s) {
    const hd = balls[hitIndex].dist;
    const p = pathPoint(hd);
    const dir = pathDir(hd);
    const ahead = (s.x - p.x) * dir.x + (s.y - p.y) * dir.y > 0;

    const index = ahead ? hitIndex : hitIndex + 1;
    const dist = ahead ? hd : hd - SPACING;
    balls.splice(index, 0, { color: s.color, dist });
    resolveSpacing();

    combo = 1;
    clearRunAt(index, 1);
    updateHud();
}

/** Push every marble back so nothing overlaps the marble ahead of it. */
function resolveSpacing() {
    for (let i = 1; i < balls.length; i++) {
        const target = balls[i - 1].dist - SPACING;
        if (balls[i].dist > target) balls[i].dist = target;
    }
}

/**
 * Pop the run of same-coloured marbles containing `index`, if it is long
 * enough. Returns the number of marbles cleared (0 when nothing popped).
 */
function clearRunAt(index, multiplier) {
    if (index < 0 || index >= balls.length) return 0;
    const color = balls[index].color;
    let a = index;
    let b = index;
    while (a > 0 && balls[a - 1].color === color) a--;
    while (b < balls.length - 1 && balls[b + 1].color === color) b++;

    const n = b - a + 1;
    if (n < 3) return 0;

    for (let i = a; i <= b; i++) burst(balls[i]);
    balls.splice(a, n);
    // Whatever now trails the hole is loose: if it catches up on a matching
    // colour it pops again as a combo.
    if (a > 0 && a < balls.length) balls[a].detached = true;
    score += n * 10 * multiplier;
    updateHud();
    return n;
}

function burst(ball) {
    const p = pathPoint(ball.dist);
    for (let i = 0; i < 8; i++) {
        const ang = (Math.PI * 2 * i) / 8 + Math.random();
        const sp = 60 + Math.random() * 110;
        particles.push({
            x: p.x, y: p.y,
            vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
            life: 0.45 + Math.random() * 0.25,
            color: ball.color,
        });
    }
}

// ---------------------------------------------------------------------------
// The shooter
// ---------------------------------------------------------------------------

function aimAt(x, y) {
    shooter.angle = Math.atan2(y - shooter.y, x - shooter.x);
}

function spawnShot(x, y, color, vx, vy) {
    const s = { x, y, color, vx, vy };
    shots.push(s);
    return s;
}

function shoot() {
    if (state !== 'running' || !shooter.color) return null;
    const s = spawnShot(
        shooter.x + Math.cos(shooter.angle) * SHOOTER_MUZZLE,
        shooter.y + Math.sin(shooter.angle) * SHOOTER_MUZZLE,
        shooter.color,
        Math.cos(shooter.angle) * SHOT_SPEED,
        Math.sin(shooter.angle) * SHOT_SPEED,
    );
    shooter.color = shooter.next;
    shooter.next = pickColor();
    return s;
}

function swapBall() {
    if (state !== 'running') return;
    const c = shooter.color;
    shooter.color = shooter.next;
    shooter.next = c;
}

/** Test seam: lay out a known train, packed head-first from `headDist`. */
function setChain(colors, headDist) {
    balls.length = 0;
    colors.forEach((color, i) => balls.push({ color, dist: headDist - i * SPACING }));
    updateHud();
    return balls;
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    document.getElementById('score').textContent = String(score);
    document.getElementById('level').textContent = String(level);
    document.getElementById('left').textContent = String(balls.length + queue.length);
    document.getElementById('best').textContent = String(best);
}

function showOverlay(title, scoreLine, button, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    overlaySub.textContent = sub || '';
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
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const trace = (width, style) => {
        ctx.beginPath();
        ctx.moveTo(pathPts[0].x, pathPts[0].y);
        for (let d = 8; d <= PATH_LEN; d += 8) {
            const p = pathPts[d];
            ctx.lineTo(p.x, p.y);
        }
        ctx.lineWidth = width;
        ctx.strokeStyle = style;
        ctx.stroke();
    };

    trace(SPACING + 10, 'rgba(8, 12, 28, 0.85)');
    trace(SPACING + 2, 'rgba(30, 40, 74, 0.9)');

    // dashed centre line
    ctx.setLineDash([6, 12]);
    trace(2, 'rgba(140, 165, 220, 0.25)');
    ctx.setLineDash([]);
    ctx.restore();
}

function drawPit() {
    const p = pathPoint(PATH_LEN);
    const danger = balls.length ? Math.max(0, 1 - (PATH_LEN - balls[0].dist) / 260) : 0;
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 26);
    g.addColorStop(0, '#000');
    g.addColorStop(0.6, danger > 0 ? `rgba(${120 + danger * 135}, 30, 40, 0.9)` : 'rgba(20, 10, 30, 0.9)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = danger > 0 ? `rgba(255, 90, 90, ${0.4 + danger * 0.6})` : 'rgba(150, 160, 200, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
    ctx.stroke();
}

function drawMarble(x, y, color, r) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, color);
    g.addColorStop(1, shade(color, -0.45));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.32, y - r * 0.38, r * 0.26, r * 0.18, -0.6, 0, Math.PI * 2);
    ctx.fill();
}

function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const r = clamp(((n >> 16) & 255) * (1 + amount));
    const g = clamp(((n >> 8) & 255) * (1 + amount));
    const b = clamp((n & 255) * (1 + amount));
    return `rgb(${r}, ${g}, ${b})`;
}

function drawShooter() {
    const { x, y, angle } = shooter;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#2b3557';
    ctx.strokeStyle = '#8fa4d8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(4, -11);
    ctx.lineTo(30, -7);
    ctx.lineTo(30, 7);
    ctx.lineTo(4, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#1b2340';
    ctx.strokeStyle = '#8fa4d8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (shooter.color) drawMarble(x, y, shooter.color, BALL_R);
    if (shooter.next) {
        drawMarble(x + 30, y + 30, shooter.next, BALL_R * 0.62);
        ctx.fillStyle = 'rgba(180, 195, 235, 0.7)';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('NEXT', x + 30, y + 48);
    }

    // aim guide
    ctx.save();
    ctx.setLineDash([4, 8]);
    ctx.strokeStyle = 'rgba(160, 190, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(shooter.angle) * 34, y + Math.sin(shooter.angle) * 34);
    ctx.lineTo(x + Math.cos(shooter.angle) * 340, y + Math.sin(shooter.angle) * 340);
    ctx.stroke();
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const bg = ctx.createRadialGradient(CENTER.x, CENTER.y, 40, CENTER.x, CENTER.y, 420);
    bg.addColorStop(0, '#151d38');
    bg.addColorStop(1, '#070a18');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawTrack();
    drawPit();

    for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (b.dist < 0) continue;
        const p = pathPoint(b.dist);
        drawMarble(p.x, p.y, b.color, BALL_R);
    }

    for (const s of shots) drawMarble(s.x, s.y, s.color, BALL_R);

    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life * 1.6);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (state !== 'idle') drawShooter();
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

function primaryAction() {
    if (state === 'idle' || state === 'over') startGame();
    else if (state === 'levelup') nextLevel();
    else if (state === 'paused') togglePause();
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'running') shoot();
        else primaryAction();
        e.preventDefault();
        return;
    }
    if (e.key === 's' || e.key === 'S') {
        swapBall();
        e.preventDefault();
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
    aimAt(p.x, p.y);
});

canvas.addEventListener('click', (e) => {
    const p = canvasPoint(e);
    aimAt(p.x, p.y);
    if (state === 'running') shoot();
    else primaryAction();
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    swapBall();
});

btnStart.addEventListener('click', primaryAction);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
updateHud();
requestAnimationFrame(frame);
