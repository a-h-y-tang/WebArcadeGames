// ---------------------------------------------------------------------------
// Marble Chain — a Zuma-style path shooter on an HTML5 canvas.
//
// A chain of coloured marbles crawls along a spiral track toward a pit at the
// centre of the board. A turret parked in the middle of the spiral fires more
// marbles into the chain; three or more of a colour together detonate. Clear the
// chain before its head reaches the pit.
//
// Written as a single classic (non-module) script so every piece of state is a
// plain global the Playwright tests can read and poke, mirroring Kaboom, Snake
// and Tetris in this repo. All motion is per-second and advanced through
// `step(dt)`, so the tests simulate frames deterministically instead of waiting
// on requestAnimationFrame.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 720;
const CANVAS_H = 520;
const CENTER_X = CANVAS_W / 2;
const CENTER_Y = CANVAS_H / 2;

// --- The spiral track ---
const TURNS = 2.6;             // how many times the track wraps around
const R_OUTER = 330;           // radius at the tunnel mouth
const R_INNER = 110;           // radius at the pit
const Y_SQUASH = 0.66;         // squashes the circle into an ellipse
const PHASE = -Math.PI / 2;    // start the track at the top of the board
const PATH_SAMPLES = 2000;

// --- Marbles ---
const BALL_R = 11;
const BALL_SPACING = 22;
const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7'];
const COLOR_DARK = ['#7f1d1d', '#1e3a8a', '#14532d', '#713f12', '#4c1d95'];

// --- Turret ---
const TURRET_R = 20;
const PROJECTILE_SPEED = 540;
const AIM_STEP = 0.09;         // radians per key press
const AIM_SPEED = 2.6;         // radians per second while a key is held

// --- Difficulty scaling (all pure functions of `level`) ---
const SPEED_BASE = 26, SPEED_STEP = 6;      // px/s the chain crawls
const SPAWN_BASE = 34, SPAWN_STEP = 6;      // marbles released per level
const LEVEL_BONUS = 250;

// --- Scoring ---
const POINTS_PER_BALL = 10;

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
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, level, spawnsRemaining, banner;
const chain = { head: 0, balls: [] };
const shooter = { angle: -Math.PI / 2, current: 0, next: 0, recoil: 0, aimDir: 0 };
const projectiles = [];
const particles = [];

// ---------------------------------------------------------------------------
// Seeded RNG — keeps colour rolls reproducible for the tests.
// ---------------------------------------------------------------------------

let rngSeed = 123456789;

function setSeed(n) {
    rngSeed = (n >>> 0) || 1;
}

function rand() {
    // 32-bit LCG (Numerical Recipes constants)
    rngSeed = (Math.imul(1664525, rngSeed) + 1013904223) >>> 0;
    return rngSeed / 4294967296;
}

function randInt(n) {
    return Math.floor(rand() * n) % n;
}

// ---------------------------------------------------------------------------
// The path: sample the spiral once, then look points up by arc length.
// ---------------------------------------------------------------------------

const pathPoints = [];   // {x, y}
const pathDists = [];    // cumulative arc length at each sample

(function buildPath() {
    const tMax = TURNS * Math.PI * 2;
    let prev = null;
    let total = 0;
    for (let i = 0; i <= PATH_SAMPLES; i++) {
        const t = (i / PATH_SAMPLES) * tMax;
        const r = R_OUTER + (R_INNER - R_OUTER) * (t / tMax);
        const p = {
            x: CENTER_X + r * Math.cos(t + PHASE),
            y: CENTER_Y + r * Math.sin(t + PHASE) * Y_SQUASH,
        };
        if (prev) total += Math.hypot(p.x - prev.x, p.y - prev.y);
        pathPoints.push(p);
        pathDists.push(total);
        prev = p;
    }
})();

const PATH_LENGTH = pathDists[pathDists.length - 1];

// Binary search for the sample at (or just before) `d`, then interpolate.
function pathPointAt(d) {
    if (d <= 0) return { x: pathPoints[0].x, y: pathPoints[0].y };
    if (d >= PATH_LENGTH) {
        const last = pathPoints[pathPoints.length - 1];
        return { x: last.x, y: last.y };
    }
    let lo = 0, hi = pathDists.length - 1;
    while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (pathDists[mid] <= d) lo = mid; else hi = mid;
    }
    const span = pathDists[hi] - pathDists[lo];
    const f = span > 0 ? (d - pathDists[lo]) / span : 0;
    const a = pathPoints[lo], b = pathPoints[hi];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// Heading of the track at `d`, used to orient the pit and the tunnel mouth.
function pathAngleAt(d) {
    const a = pathPointAt(Math.max(0, d - 2));
    const b = pathPointAt(Math.min(PATH_LENGTH, d + 2));
    return Math.atan2(b.y - a.y, b.x - a.x);
}

// ---------------------------------------------------------------------------
// Difficulty helpers
// ---------------------------------------------------------------------------

function chainSpeed() { return SPEED_BASE + (level - 1) * SPEED_STEP; }
function spawnsForLevel(n) { return SPAWN_BASE + n * SPAWN_STEP; }
function paletteSize() { return level <= 2 ? 4 : COLORS.length; }

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------

function ballDist(i) { return chain.head - i * BALL_SPACING; }
function ballPos(i) { return pathPointAt(ballDist(i)); }

// Install an exact chain — used by the tests and by level setup.
function setChain(colors, head) {
    chain.balls.length = 0;
    for (const c of colors) chain.balls.push({ color: c });
    chain.head = head || 0;
}

function insertBall(index, color) {
    const i = Math.max(0, Math.min(chain.balls.length, index));
    chain.balls.splice(i, 0, { color });
    return i;
}

// Colours still on the track — the turret only ever hands out one of these, so
// the player can never be given a marble with nothing to match.
function colorsInPlay() {
    const seen = [];
    for (const b of chain.balls) if (!seen.includes(b.color)) seen.push(b.color);
    return seen;
}

function rollColor() {
    const live = colorsInPlay();
    if (live.length > 0) return live[randInt(live.length)];
    return randInt(paletteSize());
}

// Release queued marbles at the tail whenever the track has room for them.
function releaseMarbles() {
    while (spawnsRemaining > 0 && ballDist(chain.balls.length) >= 0) {
        chain.balls.push({ color: randInt(paletteSize()) });
        spawnsRemaining -= 1;
    }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

// Clear the run of same-coloured marbles around `index`, then keep clearing the
// seam it leaves behind — each extra blast scores at a higher combo multiplier.
function resolveMatches(index) {
    let combo = 0;
    let gained = 0;
    let idx = index;

    while (idx >= 0 && idx < chain.balls.length) {
        const color = chain.balls[idx].color;
        let start = idx, end = idx;
        while (start - 1 >= 0 && chain.balls[start - 1].color === color) start -= 1;
        while (end + 1 < chain.balls.length && chain.balls[end + 1].color === color) end += 1;
        const run = end - start + 1;
        if (run < 3) break;

        for (let i = start; i <= end; i++) spawnPop(ballPos(i), color);
        chain.balls.splice(start, run);
        combo += 1;
        const points = POINTS_PER_BALL * run * combo;
        score += points;
        gained += points;
        if (combo > 1) {
            const at = pathPointAt(chain.head - start * BALL_SPACING);
            showBanner(`COMBO x${combo}  +${points}`, 1.1, at);
        }

        // The marbles that flanked the run are now neighbours — re-check the seam.
        if (start - 1 >= 0 && start < chain.balls.length
            && chain.balls[start - 1].color === chain.balls[start].color) {
            idx = start;
            continue;
        }
        break;
    }

    if (gained > 0) updateHud();
    return gained;
}

// ---------------------------------------------------------------------------
// Turret & projectiles
// ---------------------------------------------------------------------------

function setAim(angle) {
    shooter.angle = angle;
}

function aimAt(x, y) {
    setAim(Math.atan2(y - CENTER_Y, x - CENTER_X));
}

function swapShooter() {
    const t = shooter.current;
    shooter.current = shooter.next;
    shooter.next = t;
}

function spawnProjectile(opts) {
    opts = opts || {};
    const angle = opts.angle != null ? opts.angle : shooter.angle;
    const speed = opts.speed != null ? opts.speed : PROJECTILE_SPEED;
    const p = {
        x: opts.x != null ? opts.x : CENTER_X,
        y: opts.y != null ? opts.y : CENTER_Y,
        vx: opts.vx != null ? opts.vx : Math.cos(angle) * speed,
        vy: opts.vy != null ? opts.vy : Math.sin(angle) * speed,
        color: opts.color != null ? opts.color : shooter.current,
    };
    projectiles.push(p);
    return p;
}

function shoot() {
    if (state !== 'running') return null;
    const p = spawnProjectile({ angle: shooter.angle, color: shooter.current });
    shooter.current = shooter.next;
    shooter.next = rollColor();
    shooter.recoil = 1;
    return p;
}

// Which side of chain marble `i` the impact landed on: in front of it (return i)
// or behind it (return i + 1).
function insertionIndexFor(p, i) {
    const ahead = i > 0 ? ballPos(i - 1) : null;
    const behind = i < chain.balls.length - 1 ? ballPos(i + 1) : null;
    const dAhead = ahead ? Math.hypot(p.x - ahead.x, p.y - ahead.y) : Infinity;
    const dBehind = behind ? Math.hypot(p.x - behind.x, p.y - behind.y) : Infinity;
    return dAhead <= dBehind ? i : i + 1;
}

function updateProjectiles(dt) {
    for (let n = projectiles.length - 1; n >= 0; n--) {
        const p = projectiles[n];
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // Find the closest marble that has actually left the tunnel.
        let hit = -1;
        let bestD = Infinity;
        for (let i = 0; i < chain.balls.length; i++) {
            if (ballDist(i) < 0) continue;
            const b = ballPos(i);
            const d = Math.hypot(p.x - b.x, p.y - b.y);
            if (d < bestD) { bestD = d; hit = i; }
        }

        if (hit >= 0 && bestD < BALL_R * 2) {
            const at = insertionIndexFor(p, hit);
            projectiles.splice(n, 1);
            const placed = insertBall(at, p.color);
            resolveMatches(placed);
            updateHud();
            continue;
        }

        const m = BALL_R * 2;
        if (p.x < -m || p.x > CANVAS_W + m || p.y < -m || p.y > CANVAS_H + m) {
            projectiles.splice(n, 1);
        }
    }
}

// ---------------------------------------------------------------------------
// Particles & banners (cosmetic only)
// ---------------------------------------------------------------------------

function spawnPop(at, color) {
    for (let i = 0; i < 7; i++) {
        const a = rand() * Math.PI * 2;
        const s = 40 + rand() * 90;
        particles.push({
            x: at.x, y: at.y,
            vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            life: 0.45 + rand() * 0.25, age: 0, color,
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
        p.vx *= 0.94;
        p.vy *= 0.94;
    }
}

function showBanner(text, seconds, at) {
    banner = { text, t: seconds, x: at ? at.x : CENTER_X, y: at ? at.y : CENTER_Y - 90 };
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startLevel(n) {
    level = n;
    spawnsRemaining = spawnsForLevel(n);
    chain.balls.length = 0;
    chain.head = 0;
    projectiles.length = 0;
    shooter.current = randInt(paletteSize());
    shooter.next = randInt(paletteSize());
    updateHud();
}

function startGame() {
    score = 0;
    particles.length = 0;
    banner = null;
    startLevel(1);
    state = 'running';
    hideOverlay();
    showBanner('LEVEL 1', 1.6, { x: CENTER_X, y: CENTER_Y - 100 });
    updateHud();
}

function nextLevel() {
    score += LEVEL_BONUS * level;
    startLevel(level + 1);
    showBanner(`LEVEL ${level}`, 1.6, { x: CENTER_X, y: CENTER_Y - 90 });
    updateHud();
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

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    chain.head += chainSpeed() * dt;
    releaseMarbles();

    if (chain.head >= PATH_LENGTH && chain.balls.length > 0) {
        chain.head = PATH_LENGTH;
        endGame();
        return;
    }

    updateProjectiles(dt);
    updateParticles(dt);

    if (shooter.recoil > 0) shooter.recoil = Math.max(0, shooter.recoil - dt * 5);
    if (shooter.aimDir !== 0) setAim(shooter.angle + shooter.aimDir * AIM_SPEED * dt);
    if (banner) {
        banner.t -= dt;
        if (banner.t <= 0) banner = null;
    }

    if (chain.balls.length === 0 && spawnsRemaining === 0) nextLevel();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    remainingEl.textContent = String(spawnsRemaining + chain.balls.length);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreText, sub, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
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
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
    for (let i = 1; i < pathPoints.length; i += 4) ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
    const last = pathPoints[pathPoints.length - 1];
    ctx.lineTo(last.x, last.y);

    ctx.strokeStyle = '#16223a';
    ctx.lineWidth = BALL_R * 2 + 8;
    ctx.stroke();

    ctx.strokeStyle = '#0b1120';
    ctx.lineWidth = BALL_R * 2 + 1;
    ctx.stroke();

    ctx.setLineDash([3, 13]);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
}

function drawPit() {
    const p = pathPointAt(PATH_LENGTH);
    ctx.save();
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 22);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.65, '#1b0b16');
    g.addColorStop(1, 'rgba(120, 20, 60, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(251, 113, 133, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(251, 113, 133, 0.55)';
    ctx.beginPath();
    ctx.arc(p.x - 4, p.y - 2, 2.6, 0, Math.PI * 2);
    ctx.arc(p.x + 4, p.y - 2, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawMouth() {
    const p = pathPointAt(0);
    const a = pathAngleAt(0);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(a);
    ctx.fillStyle = '#0b1120';
    ctx.strokeStyle = '#1d2b47';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, BALL_R + 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function drawMarble(x, y, color, radius) {
    const r = radius || BALL_R;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, COLORS[color] || '#94a3b8');
    g.addColorStop(1, COLOR_DARK[color] || '#334155');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y - r * 0.38, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
}

function drawChain() {
    // Back to front so the leading marble sits on top.
    for (let i = chain.balls.length - 1; i >= 0; i--) {
        const d = ballDist(i);
        if (d < 0) continue;
        const p = pathPointAt(d);
        drawMarble(p.x, p.y, chain.balls[i].color);
    }

    // The leading marble wears a halo that reddens as it nears the pit.
    if (chain.balls.length > 0 && chain.head >= 0) {
        const p = pathPointAt(chain.head);
        const t = dangerLevel();
        ctx.save();
        ctx.strokeStyle = `rgba(${Math.round(148 + t * 91)}, ${Math.round(163 - t * 95)}, ${Math.round(184 - t * 116)}, ${0.35 + t * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, BALL_R + 3.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

function drawAimGuide() {
    if (state !== 'running') return;
    ctx.save();
    ctx.fillStyle = 'rgba(226, 232, 240, 0.28)';
    for (let i = 1; i <= 7; i++) {
        const d = TURRET_R + 14 + i * 20;
        ctx.beginPath();
        ctx.arc(CENTER_X + Math.cos(shooter.angle) * d, CENTER_Y + Math.sin(shooter.angle) * d, 2, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawTurret() {
    const back = shooter.recoil * 5;
    ctx.save();
    ctx.translate(CENTER_X, CENTER_Y);
    ctx.rotate(shooter.angle);

    // barrel
    ctx.fillStyle = '#20314f';
    ctx.strokeStyle = '#4b6ea8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-6 - back, -10, TURRET_R + 26, 20, 7);
    ctx.fill();
    ctx.stroke();

    // muzzle
    ctx.fillStyle = '#0d1626';
    ctx.beginPath();
    ctx.roundRect(TURRET_R + 14 - back, -7, 5, 14, 2);
    ctx.fill();
    ctx.restore();

    // body
    ctx.save();
    const g = ctx.createRadialGradient(CENTER_X - 7, CENTER_Y - 9, 3, CENTER_X, CENTER_Y, TURRET_R + 4);
    g.addColorStop(0, '#33507f');
    g.addColorStop(1, '#101b2e');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(CENTER_X, CENTER_Y, TURRET_R + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4b6ea8';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // loaded marble, and the next one tucked behind
    if (state === 'running' || state === 'paused') {
        const bx = CENTER_X - Math.cos(shooter.angle) * 22;
        const by = CENTER_Y - Math.sin(shooter.angle) * 22;
        drawMarble(bx, by, shooter.next, BALL_R * 0.72);
        drawMarble(CENTER_X, CENTER_Y, shooter.current, BALL_R);
    }
}

function drawProjectiles() {
    for (const p of projectiles) drawMarble(p.x, p.y, p.color);
}

function drawParticles() {
    ctx.save();
    for (const p of particles) {
        const a = 1 - p.age / p.life;
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = COLORS[p.color] || '#94a3b8';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 * a + 1, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawBanner() {
    if (!banner) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, banner.t * 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 22px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 8;
    ctx.fillText(banner.text, banner.x, banner.y);
    ctx.restore();
}

// How close the chain's head is to the pit, as a 0..1 danger reading.
function dangerLevel() {
    return Math.max(0, Math.min(1, chain.head / PATH_LENGTH));
}

function drawDangerGlow() {
    const d = dangerLevel();
    if (d < 0.6) return;
    const t = (d - 0.6) / 0.4;
    ctx.save();
    const g = ctx.createRadialGradient(CENTER_X, CENTER_Y, 60, CENTER_X, CENTER_Y, 380);
    g.addColorStop(0, `rgba(239, 68, 68, ${0.02 + t * 0.06})`);
    g.addColorStop(1, 'rgba(239, 68, 68, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();
}

function draw() {
    ctx.fillStyle = '#070c17';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawTrack();
    drawPit();
    drawMouth();
    drawDangerGlow();
    drawChain();
    drawAimGuide();
    drawTurret();
    drawProjectiles();
    drawParticles();
    drawBanner();
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

function canvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (CANVAS_W / rect.width),
        y: (e.clientY - rect.top) * (CANVAS_H / rect.height),
    };
}

window.addEventListener('keydown', (e) => {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (k === ' ' || k === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') shoot();
        e.preventDefault();
        return;
    }
    if (k === 's' || k === 'S') {
        if (state === 'running') { swapShooter(); e.preventDefault(); }
        return;
    }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const dir = k === 'ArrowLeft' ? -1 : 1;
        shooter.aimDir = dir;
        setAim(shooter.angle + dir * AIM_STEP);
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' && shooter.aimDir === -1) shooter.aimDir = 0;
    if (e.key === 'ArrowRight' && shooter.aimDir === 1) shooter.aimDir = 0;
});

canvas.addEventListener('mousemove', (e) => {
    const p = canvasCoords(e);
    shooter.aimDir = 0;
    aimAt(p.x, p.y);
});

canvas.addEventListener('click', (e) => {
    if (state === 'idle' || state === 'over') { startGame(); return; }
    const p = canvasCoords(e);
    aimAt(p.x, p.y);
    shoot();
});

canvas.addEventListener('contextmenu', (e) => {
    if (state === 'running') { swapShooter(); e.preventDefault(); }
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
spawnsRemaining = 0;
banner = null;
chain.head = 0;
updateHud();
requestAnimationFrame(frame);
