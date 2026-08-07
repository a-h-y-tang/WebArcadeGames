// ---------------------------------------------------------------------------
// Marble Chain — a marble-shooter on an HTML5 canvas.
//
// A chain of coloured marbles crawls along a winding track toward a pit. The
// player sits below the track with a cannon, firing marbles into the chain;
// three or more of a colour touching each other burst, and the gap they leave
// closes as the rear of the chain catches up. Clear every marble before the
// front one drops into the pit.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per second and
// advanced through `step(dt)`, so tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 400;

// --- Marbles ---
const BALL_R = 13;
const BALL_D = BALL_R * 2;     // spacing between packed marbles

// --- Track layout ---
const PATH_LEFT = 55;
const PATH_RIGHT = 545;
const PATH_TOP = 62;
const PATH_GAP = 76;           // vertical distance between lanes
const PIT_DROP = 60;           // final plunge into the pit

// --- Chain motion ---
const CHAIN_BASE = 42;         // px/s the front marble crawls at on level 1
const CHAIN_STEP = 6;          // extra px/s per level
const CATCHUP = 200;           // px/s the rear closes a gap at

// --- Shooter ---
const SHOOTER_X = 300;
const SHOOTER_Y = 350;
const SHOOTER_MUZZLE = 24;     // distance from the pivot a shot appears at
const SHOT_SPEED = 460;
const SHOT_COOLDOWN = 0.35;    // seconds between shots
const AIM_LIMIT = 0.12;        // radians of clearance kept from the horizon

// --- Levels ---
const LEVEL_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'cyan'];
const COLOR_HEX = {
    red: '#f0484f',
    blue: '#3f8cf5',
    green: '#3fce6d',
    yellow: '#f5c542',
    purple: '#b06bf0',
    cyan: '#3fd8d8',
};
const BASE_COLORS = 4;         // colours in play on level 1
const BALLS_BASE = 30;         // marbles fed onto the track on level 1
const BALLS_STEP = 4;
const BALLS_MAX = 58;
const START_GRACE = 0.8;       // quiet moment before the first marble appears
const LEVEL_GRACE = 1.2;       // ...and between levels
const MATCH_MIN = 3;           // marbles of a colour needed to burst
const POINTS_PER_BALL = 10;

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

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state = 'idle';
let score = 0;
let best = 0;
let level = 1;
let toSpawn = 0;               // marbles still queued to feed onto the track
let spawnDelay = 0;            // grace period before feeding resumes
let cooldown = 0;
let bestCombo = 0;
let currentColor = LEVEL_COLORS[0];
let nextColor = LEVEL_COLORS[1];

const balls = [];              // ordered front (nearest the pit) to back
const projectiles = [];
const particles = [];
const shooter = { x: SHOOTER_X, y: SHOOTER_Y, angle: -Math.PI / 2 };

let path = [];                 // waypoints of the track
let segCum = [];               // cumulative length at each waypoint

// ---------------------------------------------------------------------------
// The track
// ---------------------------------------------------------------------------

function lanesForLevel(lv) {
    return lv >= 5 ? 4 : 3;
}

// A serpentine track: straight lanes joined by half-circle turns, ending in a
// short plunge to the pit.
function buildPath(lanes) {
    const pts = [];
    for (let i = 0; i < lanes; i++) {
        const y = PATH_TOP + i * PATH_GAP;
        const leftToRight = i % 2 === 0;
        const from = leftToRight ? PATH_LEFT : PATH_RIGHT;
        const to = leftToRight ? PATH_RIGHT : PATH_LEFT;
        pts.push({ x: from, y });
        pts.push({ x: to, y });
        if (i < lanes - 1) {
            const cy = y + PATH_GAP / 2;
            const r = PATH_GAP / 2;
            const bulge = leftToRight ? 1 : -1;
            for (let s = 1; s < 8; s++) {
                const t = (s / 8) * Math.PI;
                pts.push({ x: to + bulge * r * Math.sin(t), y: cy - r * Math.cos(t) });
            }
        }
    }
    const last = pts[pts.length - 1];
    pts.push({ x: last.x, y: last.y + PIT_DROP });
    return pts;
}

function setPath(pts) {
    path = pts;
    segCum = [0];
    for (let i = 1; i < path.length; i++) {
        const dx = path[i].x - path[i - 1].x;
        const dy = path[i].y - path[i - 1].y;
        segCum.push(segCum[i - 1] + Math.hypot(dx, dy));
    }
}

function pathLength() {
    return segCum[segCum.length - 1];
}

// Index of the segment containing `d`, clamped to the track.
function segmentAt(d) {
    let lo = 0;
    let hi = segCum.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (segCum[mid] <= d) lo = mid; else hi = mid;
    }
    return lo;
}

function pointAt(d) {
    if (d <= 0) return { x: path[0].x, y: path[0].y };
    const L = pathLength();
    if (d >= L) return { x: path[path.length - 1].x, y: path[path.length - 1].y };
    const i = segmentAt(d);
    const segLen = segCum[i + 1] - segCum[i];
    const t = segLen === 0 ? 0 : (d - segCum[i]) / segLen;
    return {
        x: path[i].x + (path[i + 1].x - path[i].x) * t,
        y: path[i].y + (path[i + 1].y - path[i].y) * t,
    };
}

// Unit vector pointing the way the chain travels at distance `d`.
function tangentAt(d) {
    const i = Math.min(Math.max(segmentAt(Math.max(0, Math.min(d, pathLength()))), 0), path.length - 2);
    const dx = path[i + 1].x - path[i].x;
    const dy = path[i + 1].y - path[i].y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
}

// ---------------------------------------------------------------------------
// Level tuning
// ---------------------------------------------------------------------------

function colorsForLevel(lv) {
    const n = Math.min(LEVEL_COLORS.length, BASE_COLORS + Math.floor((lv - 1) / 3));
    return LEVEL_COLORS.slice(0, n);
}

function ballsForLevel(lv) {
    return Math.min(BALLS_MAX, BALLS_BASE + (lv - 1) * BALLS_STEP);
}

function chainSpeed() {
    return CHAIN_BASE + (level - 1) * CHAIN_STEP;
}

// Colour for a marble joining the track: anything from the level's palette.
function randomColor() {
    const palette = colorsForLevel(level);
    return palette[Math.floor(Math.random() * palette.length)];
}

// Colour for the cannon: prefer colours still on the track so the player is
// never handed a marble that cannot match anything.
function pickColor() {
    const palette = colorsForLevel(level);
    const live = palette.filter((c) => balls.some((b) => b.color === c));
    const pool = live.length ? live : palette;
    return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

function spawnBall(color, dist) {
    const ball = { color, dist };
    balls.push(ball);
    return ball;
}

// Test/setup helper: lay out a chain packed one diameter apart, front first.
function setChain(colors, startDist) {
    balls.length = 0;
    colors.forEach((color, i) => spawnBall(color, startDist - i * BALL_D));
    return balls;
}

// Restore the "no overlap" invariant outward from index k: the front section is
// shoved toward the pit, the rear section is pushed back down the track.
function reflow(k) {
    for (let i = k - 1; i >= 0; i--) {
        balls[i].dist = Math.max(balls[i].dist, balls[i + 1].dist + BALL_D);
    }
    for (let i = k + 1; i < balls.length; i++) {
        balls[i].dist = Math.min(balls[i].dist, balls[i - 1].dist - BALL_D);
    }
}

function updateChain(dt) {
    if (!balls.length) return;
    balls[0].dist += chainSpeed() * dt;
    for (let i = 1; i < balls.length; i++) {
        const target = balls[i - 1].dist - BALL_D;
        if (balls[i].dist < target) {
            balls[i].dist = Math.min(target, balls[i].dist + CATCHUP * dt);
        } else {
            balls[i].dist = target;
        }
    }
}

function feedChain() {
    if (toSpawn <= 0 || spawnDelay > 0) return;
    const tail = balls[balls.length - 1];
    if (!tail || tail.dist >= BALL_D) {
        spawnBall(randomColor(), 0);
        toSpawn -= 1;
        updateHud();
    }
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------

function aimAt(x, y) {
    let angle = Math.atan2(y - shooter.y, x - shooter.x);
    // Keep the cannon pointing into the play field, never at its own base.
    if (angle >= 0) angle = Math.cos(angle) >= 0 ? -AIM_LIMIT : -Math.PI + AIM_LIMIT;
    shooter.angle = Math.min(-AIM_LIMIT, Math.max(-Math.PI + AIM_LIMIT, angle));
    return shooter.angle;
}

function spawnProjectile(opts) {
    const p = { x: opts.x, y: opts.y, vx: opts.vx, vy: opts.vy, color: opts.color };
    projectiles.push(p);
    return p;
}

function shoot(angle) {
    if (state !== 'running' || cooldown > 0) return null;
    const a = angle == null ? shooter.angle : angle;
    shooter.angle = a;
    cooldown = SHOT_COOLDOWN;
    const p = spawnProjectile({
        x: shooter.x + Math.cos(a) * SHOOTER_MUZZLE,
        y: shooter.y + Math.sin(a) * SHOOTER_MUZZLE,
        vx: Math.cos(a) * SHOT_SPEED,
        vy: Math.sin(a) * SHOT_SPEED,
        color: currentColor,
    });
    currentColor = nextColor;
    nextColor = pickColor();
    return p;
}

function swapColors() {
    const c = currentColor;
    currentColor = nextColor;
    nextColor = c;
}

function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        const hit = findHit(p);
        if (hit >= 0) {
            projectiles.splice(i, 1);
            joinChain(p, hit);
            continue;
        }
        if (p.x < -BALL_D || p.x > CANVAS_W + BALL_D || p.y < -BALL_D || p.y > CANVAS_H + BALL_D) {
            projectiles.splice(i, 1);
        }
    }
}

// The closest marble the shot is currently overlapping, or -1.
function findHit(p) {
    let hit = -1;
    let bestDist = BALL_D;
    for (let i = 0; i < balls.length; i++) {
        const b = pointAt(balls[i].dist);
        const d = Math.hypot(p.x - b.x, p.y - b.y);
        if (d < bestDist) {
            bestDist = d;
            hit = i;
        }
    }
    return hit;
}

// ---------------------------------------------------------------------------
// Insertion & matching
// ---------------------------------------------------------------------------

function joinChain(p, j) {
    const anchor = pointAt(balls[j].dist);
    const t = tangentAt(balls[j].dist);
    const ahead = (p.x - anchor.x) * t.x + (p.y - anchor.y) * t.y > 0;
    const k = ahead ? j : j + 1;
    const dist = k < balls.length
        ? balls[k].dist + BALL_D
        : balls[balls.length - 1].dist - BALL_D;
    balls.splice(k, 0, { color: p.color, dist });
    reflow(k);
    resolveMatches(k);
}

// Inclusive bounds of the run of same-coloured marbles containing index i.
function runBounds(i) {
    const color = balls[i].color;
    let s = i;
    let e = i;
    while (s > 0 && balls[s - 1].color === color) s--;
    while (e < balls.length - 1 && balls[e + 1].color === color) e++;
    return [s, e];
}

// Burst the run around index k, then keep bursting while the marbles left
// touching across the gap form another run (a combo).
function resolveMatches(k) {
    let combo = 0;
    let idx = k;
    while (idx >= 0 && idx < balls.length) {
        const [s, e] = runBounds(idx);
        const n = e - s + 1;
        if (n < MATCH_MIN) break;

        combo += 1;
        bestCombo = Math.max(bestCombo, combo);
        const burst = balls.splice(s, n);
        score += POINTS_PER_BALL * n * combo;
        burst.forEach((b) => spawnBurst(b));

        if (s > 0 && s < balls.length && balls[s - 1].color === balls[s].color) {
            idx = s;
        } else {
            break;
        }
    }
    if (combo > 0) updateHud();
}

// ---------------------------------------------------------------------------
// Particles (pure decoration)
// ---------------------------------------------------------------------------

function spawnBurst(ball) {
    const p = pointAt(ball.dist);
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        particles.push({
            x: p.x, y: p.y,
            vx: Math.cos(a) * 90, vy: Math.sin(a) * 90,
            life: 0.45, color: ball.color,
        });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startLevel(lv) {
    level = lv;
    setPath(buildPath(lanesForLevel(level)));
    balls.length = 0;
    projectiles.length = 0;
    toSpawn = ballsForLevel(level);
    spawnDelay = lv === 1 ? START_GRACE : LEVEL_GRACE;
    cooldown = 0;
    currentColor = pickColor();
    nextColor = pickColor();
    updateHud();
}

function nextLevel() {
    startLevel(level + 1);
}

function startGame() {
    score = 0;
    bestCombo = 0;
    particles.length = 0;
    state = 'running';
    startLevel(1);
    hideOverlay();
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { window.localStorage.setItem('marblechain-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} — level ${level}`, 'Press Space or click to play again', 'Play Again');
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
    cooldown = Math.max(0, cooldown - dt);
    spawnDelay = Math.max(0, spawnDelay - dt);

    updateChain(dt);
    feedChain();
    updateProjectiles(dt);
    updateParticles(dt);

    if (balls.length && balls[0].dist >= pathLength()) {
        endGame();
        return;
    }
    if (toSpawn === 0 && balls.length === 0) nextLevel();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    marblesEl.textContent = String(toSpawn + balls.length);
    bestEl.textContent = String(best);
}

function showOverlay(title, sub2, sub, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub2;
    overlaySub.textContent = sub;
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function loadBest() {
    let stored = null;
    try { stored = window.localStorage.getItem('marblechain-best'); } catch (e) { /* ignore */ }
    best = stored ? parseInt(stored, 10) || 0 : 0;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawTrack() {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#16263f';
    ctx.lineWidth = BALL_D + 8;
    strokePath();
    ctx.strokeStyle = '#0d1a2d';
    ctx.lineWidth = BALL_D + 2;
    strokePath();
    ctx.restore();

    // The pit at the end of the track.
    const end = path[path.length - 1];
    const g = ctx.createRadialGradient(end.x, end.y, 2, end.x, end.y, 22);
    g.addColorStop(0, '#000');
    g.addColorStop(0.7, '#12203a');
    g.addColorStop(1, 'rgba(18,32,58,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(end.x, end.y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f0484f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(end.x, end.y, 15, 0, Math.PI * 2);
    ctx.stroke();
}

function strokePath() {
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
}

function drawMarble(x, y, color) {
    const hex = COLOR_HEX[color] || '#cbd5e1';
    const g = ctx.createRadialGradient(x - 4, y - 5, 1, x, y, BALL_R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, hex);
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawChain() {
    for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (b.dist < -BALL_R) continue;
        const p = pointAt(b.dist);
        drawMarble(p.x, p.y, b.color);
    }
}

function drawShooter() {
    const a = shooter.angle;

    // Aim guide.
    ctx.save();
    ctx.setLineDash([4, 8]);
    ctx.strokeStyle = 'rgba(56,189,248,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(shooter.x + Math.cos(a) * 26, shooter.y + Math.sin(a) * 26);
    ctx.lineTo(shooter.x + Math.cos(a) * 150, shooter.y + Math.sin(a) * 150);
    ctx.stroke();
    ctx.restore();

    // Barrel.
    ctx.save();
    ctx.translate(shooter.x, shooter.y);
    ctx.rotate(a);
    ctx.fillStyle = '#24415f';
    ctx.fillRect(0, -9, 30, 18);
    ctx.restore();

    // Base with the loaded marble, and the next one waiting beside it.
    ctx.fillStyle = '#1b2c46';
    ctx.beginPath();
    ctx.arc(shooter.x, shooter.y, 22, 0, Math.PI * 2);
    ctx.fill();
    drawMarble(shooter.x, shooter.y, currentColor);

    ctx.globalAlpha = 0.75;
    drawMarble(shooter.x + 40, shooter.y + 12, nextColor);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#7c8bab';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NEXT', shooter.x + 40, shooter.y + 34);
    ctx.textAlign = 'start';
}

function drawParticles() {
    particles.forEach((p) => {
        ctx.globalAlpha = Math.max(0, p.life / 0.45);
        ctx.fillStyle = COLOR_HEX[p.color] || '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawTrack();
    drawChain();
    projectiles.forEach((p) => drawMarble(p.x, p.y, p.color));
    drawParticles();
    if (state !== 'idle') drawShooter();
}

// ---------------------------------------------------------------------------
// Main loop & input
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    step(dt);
    draw();
    window.requestAnimationFrame(frame);
}

function canvasPoint(evt) {
    const r = canvas.getBoundingClientRect();
    return {
        x: (evt.clientX - r.left) * (CANVAS_W / r.width),
        y: (evt.clientY - r.top) * (CANVAS_H / r.height),
    };
}

canvas.addEventListener('mousemove', (evt) => {
    const p = canvasPoint(evt);
    aimAt(p.x, p.y);
});

canvas.addEventListener('mousedown', (evt) => {
    if (evt.button === 2) {
        swapColors();
        return;
    }
    if (state === 'idle' || state === 'over') {
        startGame();
        return;
    }
    const p = canvasPoint(evt);
    aimAt(p.x, p.y);
    shoot();
});

canvas.addEventListener('contextmenu', (evt) => evt.preventDefault());

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

window.addEventListener('keydown', (evt) => {
    if (evt.code === 'Space') {
        evt.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') swapColors();
        return;
    }
    if (evt.code === 'KeyP') {
        evt.preventDefault();
        togglePause();
    }
});

loadBest();
setPath(buildPath(lanesForLevel(1)));
updateHud();
draw();
window.requestAnimationFrame(frame);
