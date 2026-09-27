// ---------------------------------------------------------------------------
// Marble Loop — a spiral marble-shooter on an HTML5 canvas.
//
// A chain of coloured marbles crawls along a spiral track toward the pit at its
// centre. The player sits in the middle behind a rotating launcher and fires
// marbles into the chain; three or more of a colour touching each other burst,
// the marbles behind rush in to close the hole, and matching ends that meet
// burst again for a combo.
//
// Written as a single classic (non-module) script so the state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom, Snake
// and Tetris in this repo. All motion is expressed per-second and advanced
// through `step(dt)`, so tests can simulate frames deterministically without
// depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 480;

// --- Spiral track ---
const SPIRAL_CX = 320, SPIRAL_CY = 240;
const SPIRAL_R_OUT = 210;     // radius (y) at the mouth
const SPIRAL_R_IN = 88;       // radius (y) at the pit
const SPIRAL_ASPECT = 1.35;   // x is stretched to fill the wider canvas
const SPIRAL_TURNS = 2.15;
const SPIRAL_START_ANGLE = -Math.PI * 0.85;
const SPIRAL_SAMPLES = 1200;

// --- Marbles ---
const MARBLE_R = 13;
const MARBLE_D = MARBLE_R * 2;
const TOUCH_GAP = MARBLE_D + 1;  // marbles this close count as touching
const COLORS = ['#ef4444', '#38bdf8', '#22c55e', '#facc15', '#a855f7', '#fb923c'];

// --- Launcher ---
const LAUNCH_X = SPIRAL_CX, LAUNCH_Y = SPIRAL_CY;
const LAUNCH_R = 22;
const PROJ_SPEED = 620;       // px/s
const FIRE_COOLDOWN = 0.25;   // s between shots
const AIM_SPEED = 2.6;        // rad/s while an arrow key is held

// --- Chain motion ---
const CATCH_UP = 220;         // px/s at which marbles close a gap
const FEED_SPEED = 90;        // px/s the chain scrolls while marbles are still entering
const MIN_RUN = 3;            // marbles of a colour needed to burst

// --- Scoring ---
const POINTS_PER_MARBLE = 10;
const COMBO_WINDOW = 1.4;     // s in which a further burst counts as a combo
const COMBO_MAX = 5;          // the multiplier stops climbing here
const LEVEL_BONUS = 100;

// --- Difficulty scaling (all pure functions of `level`) ---
const SPEED_BASE = 20, SPEED_STEP = 4;
const QUEUE_BASE = 34, QUEUE_STEP = 6;
const PALETTE_BASE = 3;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const remainingEl = document.getElementById('remaining');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over' | 'cleared'
let state, score, best, level, spawnQueue, comboMult, comboTimer, fireTimer, aimDir, shotsFired;
const chain = [];        // front (nearest the pit) -> back, each { color, dist }
const projectiles = [];  // in-flight marbles, each { x, y, vx, vy, color }
const particles = [];    // burst sparkles, purely decorative
const launcher = { angle: Math.PI / 2, current: 0, next: 0 };

// ---------------------------------------------------------------------------
// Deterministic randomness (seeded so the tests can pin a run)
// ---------------------------------------------------------------------------

let rngState = 0;

function setSeed(seed) {
    rngState = seed >>> 0;
}

function rand() {
    // mulberry32
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randInt(n) {
    return Math.floor(rand() * n) % n;
}

// ---------------------------------------------------------------------------
// The track: an inward spiral sampled into an arc-length parameterised polyline
// ---------------------------------------------------------------------------

const pathPoints = [];   // { x, y }
const pathDists = [];    // cumulative distance from the mouth to each point
let pathLength = 0;

function buildPath() {
    pathPoints.length = 0;
    pathDists.length = 0;
    for (let i = 0; i <= SPIRAL_SAMPLES; i++) {
        const t = i / SPIRAL_SAMPLES;
        const a = SPIRAL_START_ANGLE + t * SPIRAL_TURNS * Math.PI * 2;
        const r = SPIRAL_R_OUT + (SPIRAL_R_IN - SPIRAL_R_OUT) * t;
        pathPoints.push({ x: SPIRAL_CX + Math.cos(a) * r * SPIRAL_ASPECT, y: SPIRAL_CY + Math.sin(a) * r });
    }
    pathDists.push(0);
    for (let i = 1; i < pathPoints.length; i++) {
        const dx = pathPoints[i].x - pathPoints[i - 1].x;
        const dy = pathPoints[i].y - pathPoints[i - 1].y;
        pathDists.push(pathDists[i - 1] + Math.hypot(dx, dy));
    }
    pathLength = pathDists[pathDists.length - 1];
}

// Index of the last sample at or before `d` (binary search).
function sampleIndex(d) {
    let lo = 0, hi = pathDists.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (pathDists[mid] <= d) lo = mid; else hi = mid - 1;
    }
    return lo;
}

function pointAt(d) {
    if (d <= 0) return { x: pathPoints[0].x, y: pathPoints[0].y };
    if (d >= pathLength) {
        const last = pathPoints[pathPoints.length - 1];
        return { x: last.x, y: last.y };
    }
    const i = sampleIndex(d);
    const a = pathPoints[i], b = pathPoints[i + 1];
    const span = pathDists[i + 1] - pathDists[i];
    const t = span > 0 ? (d - pathDists[i]) / span : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Unit vector pointing the way the marbles travel (toward the pit).
function tangentAt(d) {
    const clamped = Math.max(0, Math.min(pathLength, d));
    const i = Math.min(sampleIndex(clamped), pathPoints.length - 2);
    const a = pathPoints[i], b = pathPoints[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

// ---------------------------------------------------------------------------
// Difficulty helpers
// ---------------------------------------------------------------------------

function chainSpeed(lvl = level) { return SPEED_BASE + (lvl - 1) * SPEED_STEP; }
function levelMarbles(lvl = level) { return QUEUE_BASE + (lvl - 1) * QUEUE_STEP; }
function paletteSize(lvl = level) {
    return Math.min(COLORS.length, PALETTE_BASE + Math.floor((lvl + 1) / 2));
}

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------

// A feed colour that cannot make three in a row on its own.
function nextFeedColor() {
    const n = paletteSize();
    const a = chain.length >= 1 ? chain[chain.length - 1].color : -1;
    const b = chain.length >= 2 ? chain[chain.length - 2].color : -2;
    for (let attempt = 0; attempt < 12; attempt++) {
        const c = randInt(n);
        if (!(c === a && c === b)) return c;
    }
    return (a + 1) % n;
}

function feedChain() {
    while (spawnQueue > 0) {
        const tail = chain[chain.length - 1];
        if (tail && tail.dist < MARBLE_D) break;
        chain.push({ color: nextFeedColor(), dist: 0 });
        spawnQueue--;
    }
}

function advanceChain(dt) {
    if (chain.length === 0) return;
    // While marbles are still entering the mouth they push the whole chain along
    // at the faster feed rate; once the queue is empty it settles to the level's
    // own crawl.
    const lead = spawnQueue > 0 ? Math.max(FEED_SPEED, chainSpeed()) : chainSpeed();
    chain[0].dist += lead * dt;
    for (let i = 1; i < chain.length; i++) {
        const limit = chain[i - 1].dist - MARBLE_D;
        chain[i].dist = Math.min(chain[i].dist + CATCH_UP * dt, limit);
    }
}

// Restore the "no overlap" invariant around a freshly inserted marble by
// pushing the marbles behind it back (and, only for a marble placed ahead of
// the leader, the marbles in front of it forward).
function relax(index) {
    for (let i = index + 1; i < chain.length; i++) {
        chain[i].dist = Math.min(chain[i].dist, chain[i - 1].dist - MARBLE_D);
    }
    for (let i = index - 1; i >= 0; i--) {
        chain[i].dist = Math.max(chain[i].dist, chain[i + 1].dist + MARBLE_D);
    }
}

function insertMarble(index, color, dist) {
    chain.splice(index, 0, { color, dist });
    relax(index);
}

// Burst `count` marbles starting at `index` and award them.
function burst(index, count) {
    const removed = chain.splice(index, count);
    if (comboTimer <= 0) comboMult = 1;
    score += POINTS_PER_MARBLE * count * comboMult;
    comboMult = Math.min(comboMult + 1, COMBO_MAX);
    comboTimer = COMBO_WINDOW;
    for (const m of removed) spawnParticles(pointAt(m.dist), m.color);
    if (score > best) {
        best = score;
        localStorage.setItem('marbleloop-best', String(best));
    }
}

// Burst every run of MIN_RUN+ touching marbles of one colour, repeatedly, so a
// burst that brings two matching ends together cascades.
function resolveMatches() {
    let bursts = 0;
    for (let guard = 0; guard < 64; guard++) {
        let found = -1, runLen = 0;
        let i = 0;
        while (i < chain.length) {
            let j = i + 1;
            while (j < chain.length &&
                   chain[j].color === chain[i].color &&
                   chain[j - 1].dist - chain[j].dist <= TOUCH_GAP) j++;
            if (j - i >= MIN_RUN) { found = i; runLen = j - i; break; }
            i = j;
        }
        if (found < 0) break;
        burst(found, runLen);
        bursts++;
    }
    return bursts;
}

// ---------------------------------------------------------------------------
// Launcher and projectiles
// ---------------------------------------------------------------------------

// Prefer colours that are still on the track so a shot is never dead weight.
function randomShotColor() {
    const present = [...new Set(chain.map((m) => m.color))];
    if (present.length > 0) return present[randInt(present.length)];
    return randInt(paletteSize());
}

function reloadLauncher() {
    launcher.current = launcher.next;
    launcher.next = randomShotColor();
}

function aimAt(x, y) {
    launcher.angle = Math.atan2(y - LAUNCH_Y, x - LAUNCH_X);
}

function swapMarble() {
    const t = launcher.current;
    launcher.current = launcher.next;
    launcher.next = t;
}

function shoot() {
    if (state !== 'running' || fireTimer > 0) return;
    projectiles.push({
        x: LAUNCH_X + Math.cos(launcher.angle) * LAUNCH_R,
        y: LAUNCH_Y + Math.sin(launcher.angle) * LAUNCH_R,
        vx: Math.cos(launcher.angle) * PROJ_SPEED,
        vy: Math.sin(launcher.angle) * PROJ_SPEED,
        color: launcher.current,
    });
    fireTimer = FIRE_COOLDOWN;
    shotsFired++;
    reloadLauncher();
}

// Test seam: aim at a point, load a colour and fire immediately.
function shootAt(x, y, color) {
    aimAt(x, y);
    if (color !== undefined) launcher.current = color;
    fireTimer = 0;
    shoot();
}

// Slot a projectile into the chain next to the marble it struck.
function attach(p, hit) {
    const pos = pointAt(chain[hit].dist);
    const tan = tangentAt(chain[hit].dist);
    const ahead = (p.x - pos.x) * tan.x + (p.y - pos.y) * tan.y > 0;
    let index, dist;
    if (ahead) {
        index = hit;
        dist = index === 0
            ? chain[0].dist + MARBLE_D
            : Math.min(chain[index - 1].dist - MARBLE_D, chain[hit].dist + MARBLE_D);
    } else {
        index = hit + 1;
        dist = chain[hit].dist - MARBLE_D;
    }
    insertMarble(index, p.color, dist);
}

function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        // Sub-step so a fast shot cannot tunnel through a thin chain.
        const steps = Math.max(1, Math.ceil((PROJ_SPEED * dt) / MARBLE_R));
        const h = dt / steps;
        let consumed = false;
        for (let s = 0; s < steps && !consumed; s++) {
            p.x += p.vx * h;
            p.y += p.vy * h;
            for (let j = 0; j < chain.length; j++) {
                const c = pointAt(chain[j].dist);
                if (Math.hypot(p.x - c.x, p.y - c.y) <= MARBLE_D) {
                    attach(p, j);
                    consumed = true;
                    break;
                }
            }
        }
        const off = p.x < -MARBLE_D || p.x > CANVAS_W + MARBLE_D ||
                    p.y < -MARBLE_D || p.y > CANVAS_H + MARBLE_D;
        if (consumed || off) projectiles.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Particles (decoration only — they keep running while paused/over)
// ---------------------------------------------------------------------------

function spawnParticles(pos, color) {
    for (let i = 0; i < 8; i++) {
        const a = rand() * Math.PI * 2;
        const sp = 40 + rand() * 130;
        particles.push({
            x: pos.x, y: pos.y,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 0.5 + rand() * 0.3, age: 0, color,
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
        p.vy += 220 * dt;
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(dt) {
    if (fireTimer > 0) fireTimer = Math.max(0, fireTimer - dt);
    if (comboTimer > 0) {
        comboTimer = Math.max(0, comboTimer - dt);
        if (comboTimer === 0) comboMult = 1;
    }
    if (aimDir !== 0) launcher.angle += aimDir * AIM_SPEED * dt;

    feedChain();
    advanceChain(dt);
    updateProjectiles(dt);
    resolveMatches();

    if (chain.length > 0 && chain[0].dist >= pathLength) {
        endGame();
    } else if (chain.length === 0 && spawnQueue === 0) {
        clearLevel();
    }
}

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

function resetLevel() {
    chain.length = 0;
    projectiles.length = 0;
    spawnQueue = levelMarbles();
    comboMult = 1;
    comboTimer = 0;
    fireTimer = 0;
    shotsFired = 0;
    launcher.next = randInt(paletteSize());
    reloadLauncher();
    state = 'running';
    hideOverlay();
    updateHud();
}

function startGame() {
    score = 0;
    level = 1;
    resetLevel();
}

function nextLevel() {
    level++;
    resetLevel();
}

function clearLevel() {
    score += LEVEL_BONUS * level;
    if (score > best) {
        best = score;
        localStorage.setItem('marbleloop-best', String(best));
    }
    state = 'cleared';
    showOverlay(`LEVEL ${level} CLEARED`, `Score ${score} — bonus ${LEVEL_BONUS * level}`,
        'Press Space for the next level');
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        localStorage.setItem('marbleloop-best', String(best));
    }
    showOverlay('GAME OVER', `Score ${score} — best ${best}`, 'Press Space to play again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

// Replace the chain with `colors`, packed back from `frontDist`.
function setChain(colors, frontDist) {
    chain.length = 0;
    for (let i = 0; i < colors.length; i++) {
        chain.push({ color: colors[i], dist: frontDist - i * MARBLE_D });
    }
    updateHud();
}

function setSpawnQueue(n) {
    spawnQueue = n;
    updateHud();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    remainingEl.textContent = String(spawnQueue + chain.length);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
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
    ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
    for (let i = 1; i < pathPoints.length; i += 4) ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
    const last = pathPoints[pathPoints.length - 1];
    ctx.lineTo(last.x, last.y);

    ctx.strokeStyle = '#111b30';
    ctx.lineWidth = MARBLE_D + 10;
    ctx.stroke();
    ctx.strokeStyle = '#1b2740';
    ctx.lineWidth = MARBLE_D + 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,160,220,0.10)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawMouth() {
    const p = pathPoints[0];
    ctx.fillStyle = '#0b1322';
    ctx.beginPath();
    ctx.arc(p.x, p.y, MARBLE_R + 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2b3d63';
    ctx.lineWidth = 3;
    ctx.stroke();
}

function drawPit() {
    const p = pointAt(pathLength);
    const danger = chain.length > 0 ? chain[0].dist / pathLength : 0;
    const glow = Math.max(0, (danger - 0.8) / 0.2);
    ctx.beginPath();
    ctx.arc(p.x, p.y, MARBLE_R + 12, 0, Math.PI * 2);
    ctx.fillStyle = '#05080f';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = glow > 0 ? `rgba(248,113,113,${0.4 + glow * 0.6})` : '#33415c';
    ctx.stroke();
    ctx.fillStyle = glow > 0 ? `rgba(248,113,113,${0.25 + glow * 0.5})` : 'rgba(120,160,220,0.18)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, MARBLE_R + 3, 0, Math.PI * 2);
    ctx.fill();
}

function drawMarble(x, y, colorIndex, radius = MARBLE_R) {
    const base = COLORS[colorIndex % COLORS.length];
    const g = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.15, x, y, radius);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, base);
    g.addColorStop(1, '#0a0f1c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

function drawChain() {
    for (let i = chain.length - 1; i >= 0; i--) {
        const p = pointAt(chain[i].dist);
        drawMarble(p.x, p.y, chain[i].color);
    }
}

function drawLauncher() {
    // aim guide
    ctx.save();
    ctx.setLineDash([6, 10]);
    ctx.strokeStyle = 'rgba(226,232,240,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(LAUNCH_X + Math.cos(launcher.angle) * (LAUNCH_R + 4),
               LAUNCH_Y + Math.sin(launcher.angle) * (LAUNCH_R + 4));
    ctx.lineTo(LAUNCH_X + Math.cos(launcher.angle) * 150,
               LAUNCH_Y + Math.sin(launcher.angle) * 150);
    ctx.stroke();
    ctx.restore();

    // barrel
    ctx.save();
    ctx.translate(LAUNCH_X, LAUNCH_Y);
    ctx.rotate(launcher.angle);
    ctx.fillStyle = '#33415c';
    ctx.fillRect(0, -9, LAUNCH_R + 12, 18);
    ctx.fillStyle = '#4a5b7d';
    ctx.fillRect(LAUNCH_R + 2, -9, 10, 18);
    ctx.restore();

    // base
    const g = ctx.createRadialGradient(LAUNCH_X - 6, LAUNCH_Y - 8, 4, LAUNCH_X, LAUNCH_Y, LAUNCH_R);
    g.addColorStop(0, '#5a6d94');
    g.addColorStop(1, '#1c2740');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(LAUNCH_X, LAUNCH_Y, LAUNCH_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0b1322';
    ctx.lineWidth = 3;
    ctx.stroke();

    if (state !== 'idle') {
        drawMarble(LAUNCH_X, LAUNCH_Y, launcher.current, MARBLE_R - 1);
        drawMarble(LAUNCH_X, LAUNCH_Y + LAUNCH_R + 18, launcher.next, MARBLE_R - 4);
    }
}

function drawProjectiles() {
    for (const p of projectiles) drawMarble(p.x, p.y, p.color);
}

function drawParticles() {
    for (const p of particles) {
        const a = 1 - p.age / p.life;
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = COLORS[p.color % COLORS.length];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 * a + 1, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawCombo() {
    if (comboMult > 2 && comboTimer > 0) {
        ctx.fillStyle = `rgba(250,204,21,${Math.min(1, comboTimer / COMBO_WINDOW)})`;
        ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`COMBO ×${comboMult - 1}`, CANVAS_W / 2, 44);
        ctx.textAlign = 'left';
    }
}

function draw() {
    const bg = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, 40, CANVAS_W / 2, CANVAS_H / 2, 380);
    bg.addColorStop(0, '#16213a');
    bg.addColorStop(1, '#070b14');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawTrack();
    drawMouth();
    drawPit();
    drawChain();
    drawProjectiles();
    drawLauncher();
    drawParticles();
    drawCombo();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = null;

function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    if (state === 'running') step(dt);
    updateParticles(dt);
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

function primaryAction() {
    if (state === 'running') shoot();
    else if (state === 'cleared') nextLevel();
    else if (state === 'idle' || state === 'over') startGame();
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        primaryAction();
        e.preventDefault();
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if (e.key === 's' || e.key === 'S') {
        if (state === 'running') swapMarble();
        return;
    }
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
    aimAt(p.x, p.y);
});

canvas.addEventListener('click', (e) => {
    const p = canvasPoint(e);
    aimAt(p.x, p.y);
    primaryAction();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else if (state === 'cleared') nextLevel();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

setSeed((Date.now() ^ 0x9e3779b9) >>> 0);
buildPath();
best = parseInt(localStorage.getItem('marbleloop-best') || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
spawnQueue = 0;
comboMult = 1;
comboTimer = 0;
fireTimer = 0;
aimDir = 0;
launcher.current = 0;
launcher.next = 1;
updateHud();
requestAnimationFrame(frame);
