// Marble Chain - a spiral-track marble shooter.
// The chain of marbles crawls along the track towards the pit; fire matching
// marbles into it to clear runs of three or more before the pit swallows one.

const CANVAS_W = 720;
const CANVAS_H = 480;
const CX = CANVAS_W / 2;
const CY = CANVAS_H / 2;

const BALL_R = 12;
const SPACING = BALL_R * 2;
const SHOT_SPEED = 480;
const SHOOT_COOLDOWN = 0.14;
const CATCHUP = 3;              // how much faster a trailing marble closes a gap
const AIM_STEP = 0.08;
const SAMPLE_STEP = 2;          // track is sampled every 2px of arc length

const COLORS = ['#ff4d5a', '#ffd043', '#4dd2ff', '#7bdb5a', '#c77dff'];
const DARK = ['#8c1b26', '#8a6b09', '#1d6a8c', '#2f6b21', '#5f3785'];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// The track
// ---------------------------------------------------------------------------

// An inward spiral, resampled so that a scalar distance maps onto an evenly
// spaced list of points. Marbles only ever store that distance.
function buildTrack() {
    const raw = [];
    const turns = 2.25;
    const thetaMax = turns * Math.PI * 2;
    const rOut = 200;
    const rIn = 72;
    const STRETCH = 1.45;       // the canvas is wider than it is tall

    for (let i = 0; i <= 6000; i++) {
        const t = i / 6000;
        const theta = t * thetaMax;
        const r = rOut - (rOut - rIn) * t;
        raw.push({
            x: CX + Math.cos(theta) * r * STRETCH,
            y: CY + Math.sin(theta) * r,
        });
    }

    const points = [raw[0]];
    let carry = 0;
    for (let i = 1; i < raw.length; i++) {
        const a = raw[i - 1];
        const b = raw[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (seg === 0) continue;
        let travelled = carry;
        while (travelled + SAMPLE_STEP <= seg) {
            travelled += SAMPLE_STEP;
            const f = travelled / seg;
            points.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
        }
        carry = travelled - seg;
    }
    return points;
}

const PATH = buildTrack();
const PATH_LEN = (PATH.length - 1) * SAMPLE_STEP;

function pathPoint(dist) {
    if (dist <= 0) return { x: PATH[0].x, y: PATH[0].y };
    if (dist >= PATH_LEN) {
        const last = PATH[PATH.length - 1];
        return { x: last.x, y: last.y };
    }
    const idx = dist / SAMPLE_STEP;
    const i = Math.floor(idx);
    const f = idx - i;
    const a = PATH[i];
    const b = PATH[i + 1];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// Distance along the track of the sample nearest to an arbitrary point.
function nearestDist(x, y) {
    let bestIdx = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < PATH.length; i += 3) {
        const dx = PATH[i].x - x;
        const dy = PATH[i].y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
            bestD2 = d2;
            bestIdx = i;
        }
    }
    for (let i = Math.max(0, bestIdx - 3); i <= Math.min(PATH.length - 1, bestIdx + 3); i++) {
        const dx = PATH[i].x - x;
        const dy = PATH[i].y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
            bestD2 = d2;
            bestIdx = i;
        }
    }
    return bestIdx * SAMPLE_STEP;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

let state = 'idle';             // idle | running | paused | levelclear | gameover
let balls = [];                 // front (nearest the pit) first
let shots = [];
let score = 0;
let level = 1;
let lives = 3;
let best = loadBest();
let shootTimer = 0;
let pops = [];                  // short-lived pop effects, purely cosmetic

const launcher = {
    x: CX,
    y: CY,
    angle: -Math.PI / 2,
    color: 0,
    next: 1,
};

function launcherY() {
    return launcher.y;
}

function loadBest() {
    const raw = window.localStorage.getItem('marblechain-best');
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
}

function colorCount(lvl) {
    return Math.min(3 + lvl, COLORS.length);
}

function chainSpeedFor(lvl) {
    return 24 + (lvl - 1) * 6;
}

function chainLengthFor(lvl) {
    return Math.min(28 + (lvl - 1) * 4, 46);
}

function randomColor() {
    return Math.floor(Math.random() * colorCount(level));
}

// ---------------------------------------------------------------------------
// Chain setup
// ---------------------------------------------------------------------------

function setChain(colors, frontDist) {
    balls = colors.map((color, i) => ({ color, dist: frontDist - i * SPACING }));
    return balls;
}

function spawnLevelChain() {
    const n = chainLengthFor(level);
    const colors = [];
    for (let i = 0; i < n; i++) {
        let c = randomColor();
        // Avoid handing the player a run of three for free.
        let guard = 0;
        while (guard++ < 8 && i >= 2 && colors[i - 1] === c && colors[i - 2] === c) {
            c = randomColor();
        }
        colors.push(c);
    }
    // The head starts part way down the track so the chain reads as a chain
    // straight away; the tail streams in from the entrance behind it.
    setChain(colors, Math.min(PATH_LEN * 0.3, (n - 1) * SPACING * 0.85));
}

function reloadLauncher() {
    launcher.color = randomColor();
    launcher.next = randomColor();
}

// ---------------------------------------------------------------------------
// Flow control
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    level = 1;
    lives = 3;
    shots = [];
    pops = [];
    shootTimer = 0;
    spawnLevelChain();
    reloadLauncher();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    shots = [];
    pops = [];
    shootTimer = 0;
    spawnLevelChain();
    reloadLauncher();
    state = 'running';
    hideOverlay();
    updateHud();
}

function levelClear() {
    score += 100 * level;
    state = 'levelclear';
    shots = [];
    updateHud();
    showOverlay('LEVEL ' + level + ' CLEAR', 'Score ' + score, 'Press Space for the next level', 'Next Level');
}

function loseLife() {
    lives -= 1;
    shots = [];
    pops = [];
    updateHud();
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    spawnLevelChain();
    reloadLauncher();
    state = 'running';
}

function gameOver() {
    state = 'gameover';
    balls = [];
    shots = [];
    if (score > best) {
        best = score;
        window.localStorage.setItem('marblechain-best', String(best));
    }
    updateHud();
    showOverlay('GAME OVER', 'Score ' + score, 'Press Space to play again', 'Play Again');
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

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function shoot() {
    if (state !== 'running' || shootTimer > 0) return;
    shots.push({
        x: launcher.x,
        y: launcher.y,
        vx: Math.cos(launcher.angle) * SHOT_SPEED,
        vy: Math.sin(launcher.angle) * SHOT_SPEED,
        color: launcher.color,
    });
    launcher.color = launcher.next;
    launcher.next = randomColor();
    shootTimer = SHOOT_COOLDOWN;
}

function swapNext() {
    if (state !== 'running') return;
    const c = launcher.color;
    launcher.color = launcher.next;
    launcher.next = c;
}

function aimAt(x, y) {
    launcher.angle = Math.atan2(y - launcher.y, x - launcher.x);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function advanceChain(dt) {
    if (!balls.length) return;
    const speed = chainSpeedFor(level);
    balls[0].dist += speed * dt;
    for (let i = 1; i < balls.length; i++) {
        const limit = balls[i - 1].dist - SPACING;
        balls[i].dist = Math.min(limit, balls[i].dist + speed * CATCHUP * dt);
    }
}

function ballHitBy(x, y) {
    for (let i = 0; i < balls.length; i++) {
        const p = pathPoint(balls[i].dist);
        if (Math.hypot(p.x - x, p.y - y) < SPACING) return i;
    }
    return -1;
}

function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        // Move in small increments so a fast marble cannot tunnel through the chain.
        const distance = Math.hypot(s.vx, s.vy) * dt;
        const steps = Math.max(1, Math.ceil(distance / 6));
        let landed = false;
        for (let k = 0; k < steps && !landed; k++) {
            s.x += (s.vx * dt) / steps;
            s.y += (s.vy * dt) / steps;
            if (ballHitBy(s.x, s.y) !== -1) {
                landShot(nearestDist(s.x, s.y), s.color);
                landed = true;
            }
        }
        if (landed || s.x < -SPACING || s.x > CANVAS_W + SPACING || s.y < -SPACING || s.y > CANVAS_H + SPACING) {
            shots.splice(i, 1);
        }
    }
}

// Insert a marble into the chain at the given distance along the track and
// resolve any run it completes.
function landShot(dist, color) {
    let j = balls.findIndex((b) => b.dist < dist);
    if (j === -1) j = balls.length;
    balls.splice(j, 0, { dist, color });

    if (j > 0 && balls[j - 1].dist - balls[j].dist < SPACING) {
        balls[j].dist = balls[j - 1].dist - SPACING;
    }
    for (let k = j + 1; k < balls.length; k++) {
        balls[k].dist = Math.min(balls[k].dist, balls[k - 1].dist - SPACING);
    }

    const cleared = resolveMatches(j);
    updateHud();
    return cleared;
}

function resolveMatches(index) {
    let combo = 1;
    let cleared = 0;
    let idx = index;

    while (idx >= 0 && idx < balls.length) {
        const color = balls[idx].color;
        let s = idx;
        let e = idx;
        while (s > 0 && balls[s - 1].color === color) s--;
        while (e < balls.length - 1 && balls[e + 1].color === color) e++;
        const run = e - s + 1;
        if (run < 3) break;

        for (let i = s; i <= e; i++) {
            const p = pathPoint(balls[i].dist);
            pops.push({ x: p.x, y: p.y, color, life: 0.35 });
        }
        balls.splice(s, run);
        score += run * 10 * combo;
        cleared += run;
        combo += 1;

        // A collapse can bring two matching groups together - keep going.
        if (s > 0 && s < balls.length && balls[s - 1].color === balls[s].color) {
            idx = s;
            continue;
        }
        break;
    }
    return cleared;
}

function updatePops(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].life -= dt;
        if (pops[i].life <= 0) pops.splice(i, 1);
    }
}

// One simulation tick. Kept independent of the animation loop so it can be
// driven directly (tests, and the paused state).
function step(dt) {
    if (state === 'gameover' || state === 'levelclear') return;

    shootTimer = Math.max(0, shootTimer - dt);
    advanceChain(dt);
    updateShots(dt);
    updatePops(dt);

    if (balls.length && balls[0].dist >= PATH_LEN) {
        loseLife();
        return;
    }
    if (!balls.length && !shots.length) {
        levelClear();
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elLives.textContent = String(lives);
    elBest.textContent = String(best);
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

    ctx.strokeStyle = 'rgba(120, 150, 210, 0.14)';
    ctx.lineWidth = SPACING + 8;
    ctx.beginPath();
    ctx.moveTo(PATH[0].x, PATH[0].y);
    for (let i = 1; i < PATH.length; i += 4) ctx.lineTo(PATH[i].x, PATH[i].y);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(10, 16, 30, 0.85)';
    ctx.lineWidth = SPACING;
    ctx.stroke();

    // Entrance and pit.
    const start = PATH[0];
    const pit = PATH[PATH.length - 1];
    ctx.fillStyle = 'rgba(120, 150, 210, 0.25)';
    ctx.beginPath();
    ctx.arc(start.x, start.y, BALL_R + 3, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createRadialGradient(pit.x, pit.y, 2, pit.x, pit.y, BALL_R + 10);
    grad.addColorStop(0, '#000');
    grad.addColorStop(1, 'rgba(255, 90, 90, 0.35)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pit.x, pit.y, BALL_R + 10, 0, Math.PI * 2);
    ctx.fill();
}

function drawMarble(x, y, color, radius) {
    const r = radius || BALL_R;
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, COLORS[color]);
    grad.addColorStop(1, DARK[color]);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawLauncher() {
    const len = 30;
    const tipX = launcher.x + Math.cos(launcher.angle) * len;
    const tipY = launcher.y + Math.sin(launcher.angle) * len;

    ctx.strokeStyle = '#5c7bb5';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(launcher.x, launcher.y);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Aim guide.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(launcher.x + Math.cos(launcher.angle) * 900, launcher.y + Math.sin(launcher.angle) * 900);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#22304e';
    ctx.beginPath();
    ctx.arc(launcher.x, launcher.y, BALL_R + 9, 0, Math.PI * 2);
    ctx.fill();

    drawMarble(launcher.x, launcher.y, launcher.color, BALL_R);

    // Next marble, tucked behind the launcher.
    const nx = launcher.x - Math.cos(launcher.angle) * 26;
    const ny = launcher.y - Math.sin(launcher.angle) * 26;
    drawMarble(nx, ny, launcher.next, BALL_R * 0.62);
}

function drawDanger() {
    if (!balls.length) return;
    const ratio = balls[0].dist / PATH_LEN;
    if (ratio < 0.75) return;
    const alpha = (ratio - 0.75) / 0.25;
    ctx.strokeStyle = 'rgba(255, 80, 90, ' + (0.25 + alpha * 0.5).toFixed(3) + ')';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, CANVAS_W - 6, CANVAS_H - 6);
}

function render() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    const bg = ctx.createRadialGradient(CX, CY, 30, CX, CY, 460);
    bg.addColorStop(0, '#16223c');
    bg.addColorStop(1, '#080d18');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawTrack();

    for (let i = balls.length - 1; i >= 0; i--) {
        const p = pathPoint(balls[i].dist);
        drawMarble(p.x, p.y, balls[i].color);
    }

    for (const p of pops) {
        const t = Math.max(0, p.life / 0.35);
        ctx.globalAlpha = t;
        ctx.strokeStyle = COLORS[p.color];
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, BALL_R + (1 - t) * 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    for (const s of shots) drawMarble(s.x, s.y, s.color);

    drawLauncher();
    drawDanger();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((e.clientX - rect.left) * CANVAS_W) / rect.width,
        y: ((e.clientY - rect.top) * CANVAS_H) / rect.height,
    };
}

canvas.addEventListener('mousemove', (e) => {
    const p = canvasPoint(e);
    aimAt(p.x, p.y);
});

canvas.addEventListener('mousedown', (e) => {
    const p = canvasPoint(e);
    aimAt(p.x, p.y);
    shoot();
});

window.addEventListener('keydown', (e) => {
    const key = e.key;
    if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else if (state === 'levelclear') nextLevel();
        else shoot();
        return;
    }
    if (key === 'ArrowLeft') {
        e.preventDefault();
        launcher.angle -= AIM_STEP;
        return;
    }
    if (key === 'ArrowRight') {
        e.preventDefault();
        launcher.angle += AIM_STEP;
        return;
    }
    if (key === 'p' || key === 'P') {
        togglePause();
        return;
    }
    if (key === 'x' || key === 'X') {
        swapNext();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'levelclear') nextLevel();
    else if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTs = null;
function frame(ts) {
    const dt = lastTs === null ? 0 : Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (state === 'running') step(dt);
    render();
    requestAnimationFrame(frame);
}

updateHud();
requestAnimationFrame(frame);
