// ---------------------------------------------------------------------------
// Marble Shooter — a Zuma-style marble popper on an HTML5 canvas.
//
// A chain of coloured marbles crawls along a fixed inward spiral toward a pit at
// its centre. The player sits on a rotating shooter in the middle and fires
// marbles into the chain; three or more of a colour touching each other pop, the
// gap closes, and chain reactions ripple outward. Clear the level before the
// leading marble drops into the pit.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom!, Dino
// Run and Tetris in this repo. All motion is per-second and advanced through
// `step(dt)`, so tests can simulate frames deterministically without depending
// on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 560;

// --- Marbles ---
const MARBLE_R = 14;             // drawn radius
const MARBLE_D = 28;             // spacing between chain marbles (one diameter)
const HIT_DIST = MARBLE_R * 1.5; // centre distance at which a shot joins the chain
const MIN_MATCH = 3;             // marbles of a colour needed to pop

const COLORS = ['#ff5470', '#ffc93d', '#3ddc84', '#4aa8ff', '#c07bff'];

// --- Track (an inward elliptical spiral centred on the canvas) ---
const TRACK_TURNS = 2.5;
const TRACK_START_ANGLE = -Math.PI / 2;
const TRACK_RX_OUTER = 285, TRACK_RY_OUTER = 240;
const TRACK_RX_INNER = 82, TRACK_RY_INNER = 72;
const TRACK_SAMPLES = 4000;

// --- Difficulty scaling (all pure functions of `level`) ---
const BASE_SPEED = 26, SPEED_STEP = 4;        // px/s the chain crawls
const MARBLES_BASE = 28, MARBLES_STEP = 6;    // marbles queued per level
const BASE_COLORS = 3;

// --- Shooting ---
const SHOT_SPEED = 620;          // px/s
const AIM_STEP = 0.09;           // radians per arrow-key nudge
const AIM_KEY_SPEED = 2.2;       // radians per second while an arrow is held
const POINTS_PER_MARBLE = 10;

const STORAGE_KEY = 'marbleshooter-best';

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
let state, score, best, level, remaining, combo;
let currentBall, nextBall, aimAngle;
const marbles = [];      // head first: marbles[0] is nearest the pit
const projectiles = [];
const sparks = [];
const shooter = { x: CANVAS_W / 2, y: CANVAS_H / 2, r: 20 };
const aimKeys = { left: false, right: false };

// ---------------------------------------------------------------------------
// Seeded RNG — keeps runs (and the Playwright suite) reproducible.
// ---------------------------------------------------------------------------

let rngState = 0x9e3779b9;

function setSeed(seed) {
    rngState = (seed >>> 0) || 1;
}

function rand() {
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// The track: sampled once into a polyline with an arc-length table, so a marble
// only ever needs to store a scalar distance along the track.
// ---------------------------------------------------------------------------

const trackPts = [];
const trackCum = [];

function buildTrack() {
    trackPts.length = 0;
    trackCum.length = 0;
    for (let i = 0; i <= TRACK_SAMPLES; i++) {
        const t = i / TRACK_SAMPLES;
        const a = TRACK_START_ANGLE + t * TRACK_TURNS * Math.PI * 2;
        const rx = TRACK_RX_OUTER + t * (TRACK_RX_INNER - TRACK_RX_OUTER);
        const ry = TRACK_RY_OUTER + t * (TRACK_RY_INNER - TRACK_RY_OUTER);
        trackPts.push({
            x: shooter.x + Math.cos(a) * rx,
            y: shooter.y + Math.sin(a) * ry,
        });
    }
    trackCum.push(0);
    for (let i = 1; i < trackPts.length; i++) {
        const dx = trackPts[i].x - trackPts[i - 1].x;
        const dy = trackPts[i].y - trackPts[i - 1].y;
        trackCum.push(trackCum[i - 1] + Math.hypot(dx, dy));
    }
}

buildTrack();

function pathLength() {
    return trackCum[trackCum.length - 1];
}

/** Map a distance along the track to a pose. Distances outside the track clamp. */
function pointAt(d) {
    const total = pathLength();
    const dist = Math.max(0, Math.min(total, d));
    // binary search for the last sample at or before `dist`
    let lo = 0, hi = trackCum.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (trackCum[mid] <= dist) lo = mid; else hi = mid - 1;
    }
    const i = Math.min(lo, trackPts.length - 2);
    const seg = trackCum[i + 1] - trackCum[i];
    const f = seg > 0 ? (dist - trackCum[i]) / seg : 0;
    const a = trackPts[i], b = trackPts[i + 1];
    return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
}

// ---------------------------------------------------------------------------
// Difficulty helpers
// ---------------------------------------------------------------------------

function levelSpeed(l) { return BASE_SPEED + (l - 1) * SPEED_STEP; }
function marblesForLevel(l) { return MARBLES_BASE + (l - 1) * MARBLES_STEP; }
function colorsForLevel(l) {
    return Math.min(COLORS.length, BASE_COLORS + Math.floor((l - 1) / 2));
}

// ---------------------------------------------------------------------------
// The chain
//
// The chain is rigid: marble k always sits at marbles[0].d - k * MARBLE_D.
// restack() re-derives every marble from the head and is called after any
// structural change, which keeps spacing exact without any per-marble physics.
// ---------------------------------------------------------------------------

function restack() {
    for (let i = 1; i < marbles.length; i++) {
        marbles[i].d = marbles[0].d - i * MARBLE_D;
    }
}

function setMarbles(colors, headDist) {
    marbles.length = 0;
    colors.forEach((color, i) => marbles.push({ color, d: headDist - i * MARBLE_D }));
    if (marbles.length) restack();
}

function chainColors() {
    const seen = [];
    for (const m of marbles) if (!seen.includes(m.color)) seen.push(m.color);
    return seen;
}

function randomChainColor() {
    return COLORS[Math.floor(rand() * colorsForLevel(level))];
}

/** Marbles handed to the shooter favour colours still on the track. */
function randomBallColor() {
    const live = chainColors();
    if (!live.length) return randomChainColor();
    return live[Math.floor(rand() * live.length)];
}

function spawnFromQueue() {
    if (remaining <= 0) return;
    const tail = marbles[marbles.length - 1];
    if (tail && tail.d < MARBLE_D) return;
    remaining--;
    if (!marbles.length) marbles.push({ color: randomChainColor(), d: 0 });
    else marbles.push({ color: randomChainColor(), d: tail.d - MARBLE_D });
}

function advanceChain(dt) {
    if (!marbles.length) return;
    marbles[0].d += levelSpeed(level) * dt;
    restack();
}

// ---------------------------------------------------------------------------
// Insertion & matching
// ---------------------------------------------------------------------------

/** Splice a marble into the chain, shoving the section ahead of it pit-ward. */
function insertMarble(index, color) {
    const oldHead = marbles.length ? marbles[0].d : 0;
    marbles.splice(index, 0, { color, d: 0 });
    marbles[0].d = oldHead + MARBLE_D;
    restack();
}

/**
 * Pop the run of like colours containing `index`, then keep popping across the
 * gap it leaves for as long as the newly adjacent marbles match.
 */
function resolveMatches(index) {
    let multiplier = 1;
    let at = index;
    let popped = 0;

    while (at >= 0 && at < marbles.length) {
        const color = marbles[at].color;
        let start = at, end = at;
        while (start - 1 >= 0 && marbles[start - 1].color === color) start--;
        while (end + 1 < marbles.length && marbles[end + 1].color === color) end++;
        const run = end - start + 1;
        if (run < MIN_MATCH) break;

        for (let i = start; i <= end; i++) burst(marbles[i]);
        marbles.splice(start, run);
        if (marbles.length) restack();

        score += run * POINTS_PER_MARBLE * level * multiplier;
        popped += run;
        combo = Math.max(combo, multiplier);
        multiplier++;

        // chain reaction: the two marbles now touching across the gap
        if (start - 1 >= 0 && start < marbles.length &&
            marbles[start - 1].color === marbles[start].color) {
            at = start;
            continue;
        }
        break;
    }

    if (popped) updateHud();
    return popped;
}

function burst(marble) {
    const p = pointAt(marble.d);
    for (let i = 0; i < 6; i++) {
        const a = rand() * Math.PI * 2;
        const sp = 40 + rand() * 90;
        sparks.push({
            x: p.x, y: p.y,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 0.45, color: marble.color,
        });
    }
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------

function setAim(x, y) {
    aimAngle = Math.atan2(y - shooter.y, x - shooter.x);
}

function shoot() {
    if (state !== 'running') return false;
    projectiles.push({
        x: shooter.x + Math.cos(aimAngle) * shooter.r,
        y: shooter.y + Math.sin(aimAngle) * shooter.r,
        vx: Math.cos(aimAngle) * SHOT_SPEED,
        vy: Math.sin(aimAngle) * SHOT_SPEED,
        color: currentBall,
    });
    currentBall = nextBall;
    nextBall = randomBallColor();
    return true;
}

function shootAt(x, y) {
    if (state !== 'running') return false;
    setAim(x, y);
    return shoot();
}

function swapBalls() {
    const tmp = currentBall;
    currentBall = nextBall;
    nextBall = tmp;
}

/** Nearest chain marble within striking distance of a point, or -1. */
function hitIndex(x, y) {
    let best = -1, bestDist = HIT_DIST;
    for (let i = 0; i < marbles.length; i++) {
        const p = pointAt(marbles[i].d);
        const dist = Math.hypot(p.x - x, p.y - y);
        if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
}

function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        // Sub-step so a fast shot cannot tunnel through the chain.
        const travel = Math.hypot(p.vx, p.vy) * dt;
        const steps = Math.max(1, Math.ceil(travel / (MARBLE_R / 2)));
        let landed = false;
        for (let s = 0; s < steps && !landed; s++) {
            p.x += (p.vx * dt) / steps;
            p.y += (p.vy * dt) / steps;
            const hit = hitIndex(p.x, p.y);
            if (hit >= 0) {
                landed = true;
                const m = pointAt(marbles[hit].d);
                // Which side of the marble did the shot arrive on? Compare the
                // offset with the track tangent (pointing pit-ward).
                const dot = (p.x - m.x) * Math.cos(m.angle) + (p.y - m.y) * Math.sin(m.angle);
                const at = dot > 0 ? hit : hit + 1;
                insertMarble(at, p.color);
                projectiles.splice(i, 1);
                resolveMatches(at);
            }
        }
        if (landed) continue;
        if (p.x < -MARBLE_R || p.x > CANVAS_W + MARBLE_R ||
            p.y < -MARBLE_R || p.y > CANVAS_H + MARBLE_R) {
            projectiles.splice(i, 1);
        }
    }
}

function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0) sparks.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startLevel(l) {
    level = l;
    remaining = marblesForLevel(l);
    combo = 0;
    marbles.length = 0;
    projectiles.length = 0;
    sparks.length = 0;
    currentBall = randomChainColor();
    nextBall = randomChainColor();
    aimAngle = -Math.PI / 2;
    updateHud();
}

function nextLevel() {
    startLevel(level + 1);
}

function startGame() {
    score = 0;
    startLevel(1);
    state = 'running';
    overlay.classList.remove('visible');
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { window.localStorage.setItem(STORAGE_KEY, String(best)); } catch (e) { /* ignore */ }
    }
    overlayTitle.textContent = 'GAME OVER';
    overlayScore.textContent = `Score ${score} — Level ${level}`;
    overlaySub.textContent = 'Press Space or click to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        overlayTitle.textContent = 'PAUSED';
        overlayScore.textContent = `Score ${score} — Level ${level}`;
        overlaySub.textContent = 'Press P to resume';
        btnStart.textContent = 'Resume';
        overlay.classList.add('visible');
    } else if (state === 'paused') {
        state = 'running';
        overlay.classList.remove('visible');
    }
}

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    marblesEl.textContent = String(remaining + marbles.length);
    bestEl.textContent = String(best);
}

function step(dt) {
    if (state !== 'running') return;
    advanceChain(dt);
    spawnFromQueue();
    updateProjectiles(dt);
    updateSparks(dt);

    if (marbles.length && marbles[0].d >= pathLength()) {
        endGame();
        return;
    }
    if (!remaining && !marbles.length && !projectiles.length) {
        nextLevel();
        return;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawTrack() {
    const danger = marbles.length ? marbles[0].d / pathLength() : 0;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(trackPts[0].x, trackPts[0].y);
    for (let i = 1; i < trackPts.length; i += 8) ctx.lineTo(trackPts[i].x, trackPts[i].y);
    ctx.lineTo(trackPts[trackPts.length - 1].x, trackPts[trackPts.length - 1].y);

    ctx.strokeStyle = '#141d2e';
    ctx.lineWidth = MARBLE_D + 6;
    ctx.stroke();
    ctx.strokeStyle = danger > 0.85 ? 'rgba(248,113,113,0.5)' : '#1b273c';
    ctx.lineWidth = MARBLE_D;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawPit() {
    const p = pointAt(pathLength());
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 26);
    g.addColorStop(0, '#000');
    g.addColorStop(0.7, '#0a0f1a');
    g.addColorStop(1, 'rgba(10,15,26,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2b3c58';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 19, 0, Math.PI * 2);
    ctx.stroke();
}

function drawMarble(x, y, color, r) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, color);
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.32, y - r * 0.38, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2);
    ctx.fill();
}

function drawChain() {
    for (let i = marbles.length - 1; i >= 0; i--) {
        const p = pointAt(marbles[i].d);
        drawMarble(p.x, p.y, marbles[i].color, MARBLE_R);
    }
}

function drawAimGuide() {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#8fb4d8';
    for (let i = 1; i <= 10; i++) {
        const d = shooter.r + i * 22;
        ctx.beginPath();
        ctx.arc(shooter.x + Math.cos(aimAngle) * d, shooter.y + Math.sin(aimAngle) * d, 2.2, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawShooter() {
    ctx.save();
    ctx.translate(shooter.x, shooter.y);
    ctx.rotate(aimAngle);
    ctx.fillStyle = '#25344d';
    ctx.strokeStyle = '#3c5271';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4, -12);
    ctx.lineTo(shooter.r + 12, -8);
    ctx.lineTo(shooter.r + 12, 8);
    ctx.lineTo(-4, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#1a2740';
    ctx.strokeStyle = '#3c5271';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(shooter.x, shooter.y, shooter.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (currentBall) drawMarble(shooter.x, shooter.y, currentBall, MARBLE_R - 1);
}

function drawNextPanel() {
    if (!nextBall) return;
    const x = 16, y = CANVAS_H - 54, w = 96, h = 38;
    ctx.fillStyle = 'rgba(14,21,34,0.85)';
    ctx.strokeStyle = '#243349';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#7688a6';
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('NEXT', x + 12, y + h / 2);
    drawMarble(x + w - 24, y + h / 2, nextBall, 12);
}

function drawProjectiles() {
    for (const p of projectiles) drawMarble(p.x, p.y, p.color, MARBLE_R);
}

function drawSparks() {
    for (const s of sparks) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, s.life / 0.45);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawTrack();
    drawPit();
    drawChain();
    drawProjectiles();
    drawSparks();
    if (state === 'running') drawAimGuide();
    drawShooter();
    drawNextPanel();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function canvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((evt.clientX - rect.left) / rect.width) * CANVAS_W,
        y: ((evt.clientY - rect.top) / rect.height) * CANVAS_H,
    };
}

canvas.addEventListener('mousemove', (evt) => {
    if (state !== 'running') return;
    const p = canvasPoint(evt);
    setAim(p.x, p.y);
});

canvas.addEventListener('click', (evt) => {
    if (state !== 'running') return;
    const p = canvasPoint(evt);
    shootAt(p.x, p.y);
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

window.addEventListener('keydown', (evt) => {
    switch (evt.code) {
        case 'Space':
            evt.preventDefault();
            if (state === 'running') shoot();
            else if (state !== 'paused') startGame();
            break;
        case 'KeyP':
            togglePause();
            break;
        case 'KeyS':
            if (state === 'running') swapBalls();
            break;
        case 'ArrowLeft':
            evt.preventDefault();
            aimKeys.left = true;
            if (state === 'running') aimAngle -= AIM_STEP;
            break;
        case 'ArrowRight':
            evt.preventDefault();
            aimKeys.right = true;
            if (state === 'running') aimAngle += AIM_STEP;
            break;
        default:
            break;
    }
});

window.addEventListener('keyup', (evt) => {
    if (evt.code === 'ArrowLeft') aimKeys.left = false;
    if (evt.code === 'ArrowRight') aimKeys.right = false;
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function loadBest() {
    let stored = 0;
    try { stored = parseInt(window.localStorage.getItem(STORAGE_KEY), 10); } catch (e) { stored = 0; }
    return Number.isFinite(stored) ? stored : 0;
}

let lastFrame = 0;

function frame(now) {
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (state === 'running') {
        if (aimKeys.left) aimAngle -= AIM_KEY_SPEED * dt;
        if (aimKeys.right) aimAngle += AIM_KEY_SPEED * dt;
        step(dt);
    }
    draw();
    window.requestAnimationFrame(frame);
}

state = 'idle';
score = 0;
level = 1;
remaining = 0;
combo = 0;
best = loadBest();
currentBall = null;
nextBall = null;
aimAngle = -Math.PI / 2;
updateHud();
window.requestAnimationFrame(frame);
