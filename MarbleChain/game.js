// ---------------------------------------------------------------------------
// Marble Chain — a path-shooter match-3 arcade game on an HTML5 canvas.
//
// A train of coloured marbles crawls along a winding track toward the hole at
// the end. A turret in the middle of the field launches marbles into the train;
// three or more of a colour in a row burst, the gap closes, and a closing gap
// that lines up another run pays a combo multiplier.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 480;

// --- Marbles ---
const BALL_R = 13;
const SPACING = BALL_R * 2;    // arc length between packed marble centres
const MIN_MATCH = 3;

// --- Chain motion ---
const CHAIN_BASE = 40;         // px/s at level 1
const CHAIN_STEP = 6;          // extra px/s per level
const CATCH_UP = 200;          // px/s of extra speed while closing a gap

// --- Turret ---
const SHOOTER_X = CANVAS_W / 2;
const SHOOTER_Y = 400;
const SHOT_SPEED = 520;        // px/s
const AIM_SPEED = 2.2;         // rad/s on the arrow keys
const AIM_MIN = -Math.PI + 0.14;
const AIM_MAX = -0.14;
const RELOAD = 0.22;           // seconds between shots

// --- Scoring / progression ---
const POINTS_PER_BALL = 10;
const LEVEL_BONUS = 100;
const BALLS_BASE = 34, BALLS_STEP = 6;
const COLORS_BASE = 4;

const COLORS = ['#ef4b5c', '#3fa9f5', '#5ad469', '#f2c14e', '#a06cf0', '#f77f2c'];
const COLOR_DARK = ['#8d1b28', '#14568f', '#227a34', '#8f6b12', '#54308c', '#8c4308'];

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
let state, score, best, level, combo, spawnRemaining, reloadTimer, aimDir, flash;
let banner = '', bannerTime = 0;
const balls = [];              // front (largest dist) first
const projectiles = [];
const particles = [];
const shooter = { x: SHOOTER_X, y: SHOOTER_Y, angle: -Math.PI / 2, color: 0, next: 1 };

// ---------------------------------------------------------------------------
// The track
//
// Built from line and arc primitives, then resampled to exactly 1px spacing so
// a marble's position is a plain array lookup and every distance calculation
// works in the same units.
// ---------------------------------------------------------------------------

function buildRawPath() {
    const pts = [];
    const push = (x, y) => {
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(x - last.x, y - last.y) > 0.01) pts.push({ x, y });
    };
    const line = (x0, y0, x1, y1, n) => {
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        }
    };
    const arc = (cx, cy, r, a0, a1, n) => {
        for (let i = 0; i <= n; i++) {
            const a = a0 + (a1 - a0) * (i / n);
            push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
    };

    line(50, 70, 560, 70, 120);                                  // lane A, left to right
    arc(560, 120, 50, -Math.PI / 2, Math.PI / 2, 60);            // turn down the right side
    line(560, 170, 90, 170, 120);                                // lane B, right to left
    arc(90, 220, 50, -Math.PI / 2, -3 * Math.PI / 2, 60);        // turn down the left side
    line(90, 270, 540, 270, 120);                                // lane C, left to right
    arc(540, 320, 50, -Math.PI / 2, 0, 40);                      // curl into the hole
    return pts;
}

// Resample the raw polyline to one point per pixel of arc length.
function resample(raw) {
    const out = [{ x: raw[0].x, y: raw[0].y }];
    let carry = 0;
    for (let i = 1; i < raw.length; i++) {
        const a = raw[i - 1], b = raw[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (seg === 0) continue;
        let travelled = carry;
        while (travelled + 1 <= seg) {
            travelled += 1;
            const t = travelled / seg;
            out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
        carry = travelled - seg;
    }
    return out;
}

const PATH = resample(buildRawPath());
const PATH_LENGTH = PATH.length - 1;
const HOLE = PATH[PATH_LENGTH];

// Position at arc length `d`. Outside the track the first/last direction is
// extrapolated, so marbles shoved back past the spawner still have a sane
// position instead of piling up on a single pixel.
function pathPoint(d) {
    if (d < 0) {
        const a = PATH[0], b = PATH[1];
        return { x: a.x + (a.x - b.x) * -d, y: a.y + (a.y - b.y) * -d };
    }
    if (d >= PATH_LENGTH) {
        const a = PATH[PATH_LENGTH], b = PATH[PATH_LENGTH - 1];
        const over = d - PATH_LENGTH;
        return { x: a.x + (a.x - b.x) * over, y: a.y + (a.y - b.y) * over };
    }
    const i = Math.floor(d);
    const t = d - i;
    const a = PATH[i], b = PATH[i + 1];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Unit vector pointing along increasing distance.
function pathTangent(d) {
    const a = pathPoint(Math.max(0, Math.min(PATH_LENGTH - 1, d)));
    const b = pathPoint(Math.max(1, Math.min(PATH_LENGTH, d + 1)));
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

function chainSpeed() { return CHAIN_BASE + (level - 1) * CHAIN_STEP; }
function colorCount() { return Math.min(COLORS.length, COLORS_BASE + Math.floor((level - 1) / 3)); }
function levelBalls() { return BALLS_BASE + (level - 1) * BALLS_STEP; }

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------

// Test/dev seam: lay out a packed chain of the given colours with the leading
// marble at `frontDist`.
function setChain(colors, frontDist) {
    balls.length = 0;
    colors.forEach((color, i) => balls.push({ color, dist: frontDist - i * SPACING }));
    return balls;
}

function colorsOnTrack() {
    const seen = [];
    for (const b of balls) if (!seen.includes(b.color)) seen.push(b.color);
    return seen;
}

// Prefer colours that are still on the track so the player is never handed a
// marble that cannot possibly match.
function pickColor() {
    const live = colorsOnTrack();
    const pool = live.length ? live : Array.from({ length: colorCount() }, (_, i) => i);
    return pool[Math.floor(Math.random() * pool.length)];
}

function reloadTurret() {
    shooter.color = pickColor();
    shooter.next = pickColor();
}

function swapNext() {
    const t = shooter.color;
    shooter.color = shooter.next;
    shooter.next = t;
}

// Insert a marble so that it ends up at array index `index`, shoving everything
// behind it one spacing further from the hole. Returns the index used.
function insertBall(index, color) {
    const i = Math.max(0, Math.min(balls.length, index));
    let dist;
    if (!balls.length) dist = 0;
    else if (i >= balls.length) dist = balls[balls.length - 1].dist - SPACING;
    else dist = balls[i].dist;

    for (let j = i; j < balls.length; j++) balls[j].dist -= SPACING;
    balls.splice(i, 0, { color, dist });
    resolveMatches(i);
    return i;
}

// Burst the run of identical colours containing `index`, if it is long enough.
// Returns the number of marbles removed.
function resolveMatches(index) {
    if (index < 0 || index >= balls.length) return 0;
    const color = balls[index].color;
    let s = index, e = index;
    while (s - 1 >= 0 && balls[s - 1].color === color) s--;
    while (e + 1 < balls.length && balls[e + 1].color === color) e++;
    const n = e - s + 1;
    if (n < MIN_MATCH) return 0;

    combo++;
    score += n * POINTS_PER_BALL * combo;
    for (let i = s; i <= e; i++) burstParticles(balls[i]);
    flash = combo > 1 ? 0.7 : 0.35;
    balls.splice(s, n);
    refreshDeadColors();
    updateHud();
    return n;
}

// A burst can wipe the last marble of a colour off the track, leaving the
// turret holding something unplayable. Re-roll anything that just died.
function refreshDeadColors() {
    if (!balls.length) return;
    const live = colorsOnTrack();
    if (!live.includes(shooter.color)) shooter.color = pickColor();
    if (!live.includes(shooter.next)) shooter.next = pickColor();
}

function advanceChain(dt) {
    const speed = chainSpeed() * dt;
    for (const b of balls) b.dist += speed;

    // Re-pack front to back: snap overlaps apart, roll gaps closed.
    let junction = -1;
    for (let i = 1; i < balls.length; i++) {
        const gap = balls[i - 1].dist - balls[i].dist;
        if (gap < SPACING) {
            balls[i].dist = balls[i - 1].dist - SPACING;
        } else if (gap > SPACING) {
            balls[i].dist = Math.min(balls[i - 1].dist - SPACING, balls[i].dist + CATCH_UP * dt);
            if (junction < 0 && balls[i - 1].dist - balls[i].dist <= SPACING + 1e-6) junction = i;
        }
    }
    // Only the first closed junction is resolved this frame — bursting mutates
    // the array, which invalidates the indices found after it.
    if (junction >= 0) resolveMatches(junction);
}

function spawnIfNeeded() {
    if (spawnRemaining <= 0) return;
    const tail = balls[balls.length - 1];
    if (tail && tail.dist < SPACING) return;
    balls.push({ color: randomLevelColor(), dist: 0 });
    spawnRemaining--;
    updateHud();
}

function randomLevelColor() {
    return Math.floor(Math.random() * colorCount());
}

// ---------------------------------------------------------------------------
// Turret & projectiles
// ---------------------------------------------------------------------------

function clampAim(a) {
    // Normalise to (-pi, pi]: negative points up the screen, positive down.
    const angle = Math.atan2(Math.sin(a), Math.cos(a));
    // Below the horizon, fall out to whichever side of it is nearer.
    if (angle >= 0) return angle < Math.PI / 2 ? AIM_MAX : AIM_MIN;
    return Math.min(AIM_MAX, Math.max(AIM_MIN, angle));
}

function aimAt(x, y) {
    shooter.angle = clampAim(Math.atan2(y - shooter.y, x - shooter.x));
}

function setAimDir(d) { aimDir = d; }

function spawnProjectile(p) {
    projectiles.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, color: p.color });
    return projectiles[projectiles.length - 1];
}

function fire() {
    if (state !== 'running' || reloadTimer > 0) return false;
    reloadTimer = RELOAD;
    combo = 0;
    spawnProjectile({
        x: shooter.x + Math.cos(shooter.angle) * 24,
        y: shooter.y + Math.sin(shooter.angle) * 24,
        vx: Math.cos(shooter.angle) * SHOT_SPEED,
        vy: Math.sin(shooter.angle) * SHOT_SPEED,
        color: shooter.color,
    });
    shooter.color = shooter.next;
    shooter.next = pickColor();
    return true;
}

// Find the chain marble a projectile is touching, or -1.
function hitBall(p) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < balls.length; i++) {
        const c = pathPoint(balls[i].dist);
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d <= SPACING && d < bestD) { bestD = d; best = i; }
    }
    return best;
}

function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        const hit = hitBall(p);
        if (hit >= 0) {
            const c = pathPoint(balls[hit].dist);
            const tan = pathTangent(balls[hit].dist);
            const ahead = (p.x - c.x) * tan.x + (p.y - c.y) * tan.y > 0;
            projectiles.splice(i, 1);
            insertBall(ahead ? hit : hit + 1, p.color);
            continue;
        }

        if (p.x < -BALL_R || p.x > CANVAS_W + BALL_R || p.y < -BALL_R || p.y > CANVAS_H + BALL_R) {
            projectiles.splice(i, 1);
        }
    }
}

// ---------------------------------------------------------------------------
// Particles (pure decoration)
// ---------------------------------------------------------------------------

function burstParticles(ball) {
    const c = pathPoint(ball.dist);
    for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 40 + Math.random() * 110;
        particles.push({
            x: c.x, y: c.y,
            vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            life: 0.45 + Math.random() * 0.25, age: 0, color: ball.color,
        });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) { particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 240 * dt;
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function setupLevel() {
    balls.length = 0;
    projectiles.length = 0;
    spawnRemaining = levelBalls();
    reloadTimer = 0;
    reloadTurret();
    updateHud();
}

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    combo = 0;
    aimDir = 0;
    flash = 0;
    bannerTime = 0;
    particles.length = 0;
    setupLevel();
    hideOverlay();
}

function nextLevel() {
    level++;
    score += LEVEL_BONUS * (level - 1);
    banner = `LEVEL ${level}`;
    bannerTime = 1.8;
    setupLevel();
}

function checkLevelComplete() {
    if (spawnRemaining <= 0 && balls.length === 0 && projectiles.length === 0) nextLevel();
}

function checkLose() {
    if (balls.length && balls[0].dist >= PATH_LENGTH) endGame();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('marble-chain-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} — level ${level}`, 'Press Space to try again', 'Play Again');
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
    reloadTimer = Math.max(0, reloadTimer - dt);
    if (aimDir) shooter.angle = clampAim(shooter.angle + aimDir * AIM_SPEED * dt);
    if (flash > 0) flash = Math.max(0, flash - dt);
    if (bannerTime > 0) bannerTime = Math.max(0, bannerTime - dt);

    updateProjectiles(dt);
    advanceChain(dt);
    spawnIfNeeded();
    updateParticles(dt);
    checkLevelComplete();
    checkLose();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    leftEl.textContent = String(Math.max(0, spawnRemaining) + balls.length);
    bestEl.textContent = String(best);
}

function showOverlay(title, sub1, sub2, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub1;
    overlaySub.textContent = sub2;
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() { overlay.classList.remove('visible'); }

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawTrack() {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const trace = () => {
        ctx.beginPath();
        ctx.moveTo(PATH[0].x, PATH[0].y);
        for (let i = 8; i < PATH.length; i += 8) ctx.lineTo(PATH[i].x, PATH[i].y);
        ctx.lineTo(HOLE.x, HOLE.y);
    };

    trace();
    ctx.strokeStyle = '#111e33';
    ctx.lineWidth = SPACING + 12;
    ctx.stroke();

    trace();
    ctx.strokeStyle = '#16243c';
    ctx.lineWidth = SPACING + 4;
    ctx.stroke();

    trace();
    ctx.strokeStyle = 'rgba(120, 160, 220, 0.18)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 12]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Spawner mouth
    const start = PATH[0];
    ctx.fillStyle = '#0c172a';
    ctx.beginPath();
    ctx.arc(start.x, start.y, BALL_R + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2b3d5e';
    ctx.lineWidth = 3;
    ctx.stroke();

    // The hole
    const grad = ctx.createRadialGradient(HOLE.x, HOLE.y, 2, HOLE.x, HOLE.y, BALL_R + 12);
    grad.addColorStop(0, '#000');
    grad.addColorStop(1, '#2a1633');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(HOLE.x, HOLE.y, BALL_R + 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6c3f8a';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
}

function drawMarble(x, y, color, r) {
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.28, COLORS[color]);
    grad.addColorStop(1, COLOR_DARK[color]);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawChain() {
    // Back to front so the leading marble overlaps its follower.
    for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (b.dist < -SPACING * 2) continue;
        const p = pathPoint(b.dist);
        drawMarble(p.x, p.y, b.color, BALL_R);
    }
}

function drawShooter() {
    const { x, y, angle } = shooter;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#2b3d5e';
    ctx.fillRect(0, -7, 30, 14);
    ctx.fillStyle = '#3d5580';
    ctx.fillRect(22, -9, 8, 18);
    ctx.restore();

    ctx.fillStyle = '#1b2a44';
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3d5580';
    ctx.lineWidth = 3;
    ctx.stroke();

    if (state === 'running' || state === 'paused') {
        drawMarble(x, y, shooter.color, BALL_R);
        // Preview marble tucked behind the turret
        ctx.globalAlpha = 0.85;
        drawMarble(x, y + 40, shooter.next, BALL_R - 3);
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(160, 185, 220, 0.55)';
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('NEXT', x, y + 66);
        ctx.textAlign = 'left';
    }
}

function drawAimGuide() {
    if (state !== 'running') return;
    const { x, y, angle } = shooter;
    ctx.save();
    ctx.strokeStyle = 'rgba(77, 214, 193, 0.30)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 10]);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * 30, y + Math.sin(angle) * 30);
    ctx.lineTo(x + Math.cos(angle) * 260, y + Math.sin(angle) * 260);
    ctx.stroke();
    ctx.restore();
}

function drawProjectiles() {
    for (const p of projectiles) drawMarble(p.x, p.y, p.color, BALL_R);
}

function drawParticles() {
    for (const p of particles) {
        const t = 1 - p.age / p.life;
        ctx.globalAlpha = Math.max(0, t);
        ctx.fillStyle = COLORS[p.color];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 * t + 1, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawDanger() {
    // The closer the leading marble is to the hole, the hotter the vignette.
    if (!balls.length) return;
    const t = Math.max(0, (balls[0].dist - (PATH_LENGTH - 260)) / 260);
    if (t <= 0) return;
    const grad = ctx.createRadialGradient(
        HOLE.x, HOLE.y, 20, HOLE.x, HOLE.y, 420);
    grad.addColorStop(0, `rgba(220, 40, 60, ${0.30 * t})`);
    grad.addColorStop(1, 'rgba(220, 40, 60, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const bg = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    bg.addColorStop(0, '#0b1830');
    bg.addColorStop(1, '#060d1c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    if (flash > 0) {
        ctx.fillStyle = `rgba(77, 214, 193, ${0.10 * flash})`;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    drawTrack();
    drawDanger();
    drawChain();
    drawProjectiles();
    drawAimGuide();
    drawShooter();
    drawParticles();

    // Tied to the burst flash so it fades out instead of lingering until the
    // next shot resets the counter.
    if (combo > 1 && flash > 0 && state === 'running') {
        ctx.fillStyle = '#4dd6c1';
        ctx.font = 'bold 20px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`COMBO ×${combo}`, CANVAS_W / 2, 40);
        ctx.textAlign = 'left';
    }

    if (bannerTime > 0 && state === 'running') {
        ctx.save();
        ctx.globalAlpha = Math.min(1, bannerTime / 0.6);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#4dd6c1';
        ctx.font = 'bold 34px "Segoe UI", sans-serif';
        ctx.fillText(banner, CANVAS_W / 2, CANVAS_H / 2 - 40);
        ctx.fillStyle = 'rgba(200, 220, 240, 0.75)';
        ctx.font = '14px "Segoe UI", sans-serif';
        ctx.fillText(`${spawnRemaining} marbles incoming`, CANVAS_W / 2, CANVAS_H / 2 - 14);
        ctx.restore();
    }
}

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

function refreshAimKeys() {
    const left = heldKeys.has('ArrowLeft') || heldKeys.has('a') || heldKeys.has('A');
    const right = heldKeys.has('ArrowRight') || heldKeys.has('d') || heldKeys.has('D');
    setAimDir((right ? 1 : 0) - (left ? 1 : 0));
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === 's' || e.key === 'S') {
        if (state === 'running') { swapNext(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') fire();
        e.preventDefault();
        return;
    }
    if (['ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D'].includes(e.key)) {
        heldKeys.add(e.key);
        refreshAimKeys();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshAimKeys();
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
    if (state !== 'running') return;
    heldKeys.clear();
    setAimDir(0);
    const p = canvasPoint(e);
    aimAt(p.x, p.y);
});

canvas.addEventListener('mousedown', (e) => {
    if (state === 'idle' || state === 'over') { startGame(); return; }
    const p = canvasPoint(e);
    aimAt(p.x, p.y);
    fire();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('marble-chain-best') || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
combo = 0;
aimDir = 0;
flash = 0;
spawnRemaining = 0;
reloadTimer = 0;
updateHud();
requestAnimationFrame(frame);
