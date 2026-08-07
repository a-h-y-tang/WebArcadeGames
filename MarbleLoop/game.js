// ---------------------------------------------------------------------------
// Marble Loop — a Zuma-style marble shooter on an HTML5 canvas.
//
// A chain of coloured marbles crawls along a spiral track towards the hole at
// its centre. The launcher sits in the middle of the spiral; the player aims it
// and fires marbles into the chain, clearing runs of three or more of a colour.
//
// Written as a single classic (non-module) script so the state and the logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom, Snake
// and Tetris in this repo. All motion is expressed per second and applied by
// `step(dt)`, so tests can advance the world deterministically instead of
// depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 480;
const CENTER = { x: CANVAS_W / 2, y: CANVAS_H / 2 };

// --- The spiral track ---
const SPIRAL_TURNS = 2.6;   // how many times the track wraps around the centre
const R_OUTER = 168;        // radius where marbles enter
const R_INNER = 58;         // radius of the hole at the end of the track
const X_SCALE = 1.32;       // widen the spiral to fill the landscape canvas
const TRACK_W = 30;         // painted width of the track

// --- Marbles ---
const MARBLE_R = 13;
const SPACING = MARBLE_R * 2;   // distance between neighbouring marbles
const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6'];

// --- Launcher ---
const SHOOTER_R = 22;
const SHOT_SPEED = 520;     // px/s
const MAX_BALLS = 3;        // marbles allowed in flight at once
const AIM_STEP = 0.12;      // radians per arrow-key press

// --- Difficulty scaling (all pure functions of `level`) ---
const SPEED_BASE = 22, SPEED_STEP = 4;        // chain speed, px/s
const MARBLES_BASE = 28, MARBLES_STEP = 6;    // marbles per level
// A level is a race over distance, not time: every marble has to be released
// before the head reaches the hole, so the count is capped well below
// pathLength / SPACING (~80) to keep every level winnable.
const MARBLES_MAX = 60;
const COLORS_BASE = 3, COLORS_PER_LEVELS = 2; // +1 colour every 2 levels
const LEVEL_BONUS = 500;
const DANGER_FRACTION = 0.82;                 // when the track starts flashing

const BEST_KEY = 'marble-loop-best';

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
// The path
//
// The spiral is sampled finely and then resampled at ~1px intervals, so
// "distance along the path" is just an index into PATH and pathPoint() is a
// clamped array lookup.
// ---------------------------------------------------------------------------

const PATH = buildPath();
const pathLength = PATH.length - 1;
const hole = PATH[pathLength];

function buildPath() {
    const raw = [];
    const samples = 8000;
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const a = t * SPIRAL_TURNS * Math.PI * 2;
        const r = R_OUTER + (R_INNER - R_OUTER) * t;
        raw.push({
            x: CENTER.x + r * X_SCALE * Math.cos(a),
            y: CENTER.y + r * Math.sin(a),
        });
    }

    // Resample at one pixel per step so arc length == array index.
    const out = [raw[0]];
    let carry = 0;
    for (let i = 1; i < raw.length; i++) {
        const a = raw[i - 1], b = raw[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (seg === 0) continue;
        let travelled = carry;
        while (travelled + 1 <= seg) {
            travelled += 1;
            const k = travelled / seg;
            out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
        }
        carry = travelled - seg;
    }
    return out;
}

function pathPoint(d) {
    const i = Math.round(d);
    if (i <= 0) return PATH[0];
    if (i >= pathLength) return PATH[pathLength];
    return PATH[i];
}

// Project an arbitrary board position onto the track: a coarse sweep followed by
// a one-pixel sweep around the best coarse hit.
function nearestPathDistance(x, y) {
    const coarse = 8;
    let bestD = 0, bestDist = Infinity;
    for (let d = 0; d <= pathLength; d += coarse) {
        const p = PATH[d];
        const dist = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
        if (dist < bestDist) { bestDist = dist; bestD = d; }
    }
    const lo = Math.max(0, bestD - coarse), hi = Math.min(pathLength, bestD + coarse);
    for (let d = lo; d <= hi; d++) {
        const p = PATH[d];
        const dist = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
        if (dist < bestDist) { bestDist = dist; bestD = d; }
    }
    return bestD;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, level, best, combo;
let messageText, messageTimer, animTime, dangerPulse;

// The chain is contiguous: marble i sits at `chain.head - i * SPACING`.
const chain = { head: 0, colors: [] };
const queue = [];      // marbles still waiting to enter the board
const balls = [];      // marbles in flight
const pops = [];       // short-lived pop effects
const shooter = { x: CENTER.x, y: CENTER.y, angle: -Math.PI / 2, current: COLORS[0], next: COLORS[1] };

// ---------------------------------------------------------------------------
// Difficulty helpers
// ---------------------------------------------------------------------------

function chainSpeed() { return SPEED_BASE + (level - 1) * SPEED_STEP; }
function levelMarbles() {
    return Math.min(MARBLES_BASE + (level - 1) * MARBLES_STEP, MARBLES_MAX);
}
function levelColors() {
    const n = Math.min(COLORS_BASE + Math.floor((level - 1) / COLORS_PER_LEVELS), COLORS.length);
    return COLORS.slice(0, n);
}

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------

function marbleDistance(i) { return chain.head - i * SPACING; }
function marblePos(i) { return pathPoint(marbleDistance(i)); }

// Colours still in play, so the launcher never hands out a dead colour.
function coloursInPlay() {
    const live = new Set([...chain.colors, ...queue]);
    const palette = levelColors().filter((c) => live.has(c));
    return palette.length ? palette : levelColors();
}

function pickColor() {
    const palette = coloursInPlay();
    return palette[Math.floor(Math.random() * palette.length)];
}

function reloadShooter() {
    shooter.current = pickColor();
    shooter.next = pickColor();
}

// Feed queued marbles onto the track while there is room behind the chain.
function spawnMarbles() {
    while (queue.length && chain.head - chain.colors.length * SPACING >= 0) {
        chain.colors.push(queue.shift());
    }
}

function buildQueue() {
    queue.length = 0;
    const palette = levelColors();
    const total = levelMarbles();
    for (let i = 0; i < total; i++) {
        queue.push(palette[Math.floor(Math.random() * palette.length)]);
    }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

// Insert `color` at `index`, resolve any matches (including cascades) and return
// how many marbles were destroyed.
function insertMarble(index, color) {
    const at = Math.max(0, Math.min(chain.colors.length, index));
    chain.colors.splice(at, 0, color);
    combo = 0;
    const removed = resolveMatches(at);
    updateHud();
    return removed;
}

function resolveMatches(index) {
    let at = index;
    let removed = 0;
    let multiplier = 0;

    while (at >= 0 && at < chain.colors.length) {
        const color = chain.colors[at];
        let start = at, end = at;
        while (start > 0 && chain.colors[start - 1] === color) start--;
        while (end < chain.colors.length - 1 && chain.colors[end + 1] === color) end++;
        const run = end - start + 1;
        if (run < 3) break;

        multiplier++;
        combo = multiplier;
        removed += run;
        score += 10 * run * multiplier;
        popEffect(start, run, color, multiplier);
        chain.colors.splice(start, run);

        // Removing the run brings its neighbours together: re-check the junction.
        at = start;
        if (start === 0 || start >= chain.colors.length) break;
        if (chain.colors[start - 1] !== chain.colors[start]) break;
    }

    return removed;
}

function popEffect(start, run, color, multiplier) {
    for (let i = 0; i < run; i++) {
        const p = marblePos(start + i);
        pops.push({ x: p.x, y: p.y, color, life: 0.45 });
    }
    if (multiplier >= 2) {
        const p = marblePos(start + Math.floor(run / 2));
        pops.push({ x: p.x, y: p.y, color, life: 0.9, text: `COMBO x${multiplier}` });
    }
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------

function setAim(angle) { shooter.angle = angle; }
function aimAt(x, y) { shooter.angle = Math.atan2(y - shooter.y, x - shooter.x); }

function swapMarbles() {
    const tmp = shooter.current;
    shooter.current = shooter.next;
    shooter.next = tmp;
}

function shootMarble() {
    if (state !== 'running') return false;
    if (balls.length >= MAX_BALLS) return false;
    const cos = Math.cos(shooter.angle), sin = Math.sin(shooter.angle);
    balls.push({
        x: shooter.x + cos * (SHOOTER_R + 2),
        y: shooter.y + sin * (SHOOTER_R + 2),
        vx: cos * SHOT_SPEED,
        vy: sin * SHOT_SPEED,
        color: shooter.current,
    });
    shooter.current = shooter.next;
    shooter.next = pickColor();
    return true;
}

// Advance one ball; returns false when it should be taken out of flight.
function advanceBall(ball, dt) {
    // Sub-step so a fast marble cannot tunnel through the chain.
    const steps = Math.max(1, Math.ceil((SHOT_SPEED * dt) / MARBLE_R));
    const sub = dt / steps;
    for (let s = 0; s < steps; s++) {
        ball.x += ball.vx * sub;
        ball.y += ball.vy * sub;
        const hit = hitMarble(ball);
        if (hit >= 0) {
            const ballD = nearestPathDistance(ball.x, ball.y);
            const index = Math.max(0, Math.min(
                chain.colors.length,
                Math.ceil((chain.head - ballD) / SPACING),
            ));
            insertMarble(index, ball.color);
            return false;
        }
        const m = MARBLE_R * 2;
        if (ball.x < -m || ball.x > CANVAS_W + m || ball.y < -m || ball.y > CANVAS_H + m) {
            combo = 0;
            return false;
        }
    }
    return true;
}

function hitMarble(ball) {
    const reach = MARBLE_R * 2;
    for (let i = 0; i < chain.colors.length; i++) {
        const p = marblePos(i);
        const dx = p.x - ball.x, dy = p.y - ball.y;
        if (dx * dx + dy * dy <= reach * reach) return i;
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    combo = 0;
    messageText = '';
    messageTimer = 0;
    startLevel();
    hideOverlay();
    updateHud();
}

function startLevel() {
    chain.head = 0;
    chain.colors = [];
    balls.length = 0;
    pops.length = 0;
    buildQueue();
    spawnMarbles();
    reloadShooter();
    updateHud();
}

function nextLevel() {
    score += LEVEL_BONUS * level;
    level++;
    messageText = `LEVEL ${level}`;
    messageTimer = 1.8;
    startLevel();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try { window.localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} — Level ${level}`, 'Press Space or R to play again');
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
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    animTime += dt;
    for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].life -= dt;
        if (pops[i].life <= 0) pops.splice(i, 1);
    }
    if (state !== 'running') return;

    // Balls first, so a marble fired at the last moment still counts.
    for (let i = balls.length - 1; i >= 0; i--) {
        if (!advanceBall(balls[i], dt)) balls.splice(i, 1);
    }

    chain.head += chainSpeed() * dt;
    spawnMarbles();

    if (chain.colors.length > 0 && chain.head >= pathLength) {
        gameOver();
        return;
    }

    if (chain.colors.length === 0 && queue.length === 0) {
        nextLevel();
    }

    if (messageTimer > 0) messageTimer = Math.max(0, messageTimer - dt);
    dangerPulse = chain.head > pathLength * DANGER_FRACTION;
    updateHud();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    marblesEl.textContent = String(chain.colors.length + queue.length);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() { overlay.classList.remove('visible'); }

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    const bg = ctx.createRadialGradient(CENTER.x, CENTER.y, 40, CENTER.x, CENTER.y, 380);
    bg.addColorStop(0, '#16223d');
    bg.addColorStop(1, '#070b16');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawTrack();
    drawHole();
    drawMarbles();
    drawPops();
    drawBalls();
    drawShooter();
    drawMessage();
}

function tracePath(step) {
    ctx.beginPath();
    ctx.moveTo(PATH[0].x, PATH[0].y);
    for (let d = step; d <= pathLength; d += step) ctx.lineTo(PATH[d].x, PATH[d].y);
    ctx.lineTo(hole.x, hole.y);
}

function drawTrack() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    tracePath(6);
    ctx.lineWidth = TRACK_W;
    ctx.strokeStyle = '#111c31';
    ctx.stroke();

    tracePath(6);
    ctx.lineWidth = TRACK_W - 10;
    ctx.strokeStyle = '#1b2947';
    ctx.stroke();

    if (dangerPulse && state === 'running') {
        const pulse = 0.35 + 0.35 * Math.sin(animTime * 8);
        tracePath(6);
        ctx.lineWidth = TRACK_W;
        ctx.strokeStyle = `rgba(251, 113, 133, ${pulse.toFixed(3)})`;
        ctx.stroke();
    }
}

function drawHole() {
    ctx.save();
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, MARBLE_R + 7, 0, Math.PI * 2);
    ctx.fillStyle = '#05070f';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = dangerPulse ? '#fb7185' : '#33415c';
    ctx.stroke();
    ctx.restore();
}

function drawMarble(x, y, color, radius) {
    const g = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.1, x, y, radius);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.28, color);
    g.addColorStop(1, '#0b1220');
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(5, 8, 18, 0.7)';
    ctx.stroke();
}

function drawMarbles() {
    // Back to front so the leading marble sits on top near the hole.
    for (let i = chain.colors.length - 1; i >= 0; i--) {
        const p = marblePos(i);
        drawMarble(p.x, p.y, chain.colors[i], MARBLE_R);
    }
}

function drawBalls() {
    for (const ball of balls) drawMarble(ball.x, ball.y, ball.color, MARBLE_R);
}

function drawPops() {
    for (const pop of pops) {
        if (pop.text) {
            const k = Math.max(0, pop.life / 0.9);
            ctx.save();
            ctx.globalAlpha = k;
            ctx.fillStyle = '#f8fafc';
            ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(pop.text, pop.x, pop.y - (1 - k) * 26);
            ctx.restore();
            continue;
        }
        const k = Math.max(0, pop.life / 0.45);
        ctx.save();
        ctx.globalAlpha = k;
        ctx.beginPath();
        ctx.arc(pop.x, pop.y, MARBLE_R + (1 - k) * 14, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = pop.color;
        ctx.stroke();
        ctx.restore();
    }
}

function drawShooter() {
    const cos = Math.cos(shooter.angle), sin = Math.sin(shooter.angle);

    // Aim guide.
    ctx.save();
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(shooter.x + cos * (SHOOTER_R + 6), shooter.y + sin * (SHOOTER_R + 6));
    ctx.lineTo(shooter.x + cos * 240, shooter.y + sin * 240);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Barrel.
    ctx.save();
    ctx.translate(shooter.x, shooter.y);
    ctx.rotate(shooter.angle);
    ctx.fillStyle = '#243357';
    ctx.fillRect(0, -9, SHOOTER_R + 14, 18);
    ctx.restore();

    // Body.
    ctx.beginPath();
    ctx.arc(shooter.x, shooter.y, SHOOTER_R, 0, Math.PI * 2);
    ctx.fillStyle = '#1b2947';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();

    drawMarble(shooter.x, shooter.y, shooter.current, MARBLE_R - 1);
    drawMarble(shooter.x, shooter.y + SHOOTER_R + 16, shooter.next, MARBLE_R - 5);
}

function drawMessage() {
    if (messageTimer <= 0 || !messageText) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, messageTimer);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(messageText, CENTER.x, 60);
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * (CANVAS_W / rect.width),
        y: (event.clientY - rect.top) * (CANVAS_H / rect.height),
    };
}

canvas.addEventListener('mousemove', (event) => {
    const p = canvasPoint(event);
    aimAt(p.x, p.y);
});

canvas.addEventListener('click', (event) => {
    if (state === 'idle' || state === 'over') { startGame(); return; }
    const p = canvasPoint(event);
    aimAt(p.x, p.y);
    shootMarble();
});

document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();

    if (key === ' ' || event.code === 'Space') {
        event.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else shootMarble();
        return;
    }
    if (key === 'p') { togglePause(); return; }
    if (key === 'r') { startGame(); return; }
    if (key === 's') { swapMarbles(); return; }
    if (key === 'arrowleft') { event.preventDefault(); setAim(shooter.angle - AIM_STEP); return; }
    if (key === 'arrowright') { event.preventDefault(); setAim(shooter.angle + AIM_STEP); return; }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function loadBest() {
    let stored = 0;
    try { stored = Number(window.localStorage.getItem(BEST_KEY)) || 0; } catch (e) { stored = 0; }
    return stored;
}

function init() {
    state = 'idle';
    score = 0;
    level = 1;
    combo = 0;
    animTime = 0;
    dangerPulse = false;
    messageText = '';
    messageTimer = 0;
    best = loadBest();
    chain.head = 0;
    chain.colors = [];
    queue.length = 0;
    balls.length = 0;
    pops.length = 0;
    shooter.angle = -Math.PI / 2;
    shooter.current = COLORS[0];
    shooter.next = COLORS[1];
    updateHud();
    draw();
}

let lastTs = null;
function frame(ts) {
    const dt = lastTs === null ? 0 : Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

init();
requestAnimationFrame(frame);
