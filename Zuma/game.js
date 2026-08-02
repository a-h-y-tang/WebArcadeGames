/* Zuma — shoot marbles into the crawling chain and pop runs of three or more.
   Everything lives on the global scope on purpose: the Playwright suite drives
   the game through these names (see DESIGN.md). */

const CANVAS_W = 640;
const CANVAS_H = 480;

const MARBLE_R = 11;
const MARBLE_SPACING = 21;
const COLLAPSE_SPEED = 260;      // px/s that a gap closes at
const PROJECTILE_SPEED = 540;    // px/s
const LAUNCH_OFFSET = 20;        // px from the launcher centre a shot starts at
const MIN_RUN = 3;
const MATCH_POINTS = 10;
const LEVEL_BONUS = 100;
const DANGER_ZONE = 160;         // px from the hole where the warning kicks in
const AIM_STEP = 0.06;
const AIM_MIN = -Math.PI + 0.25;
const AIM_MAX = -0.25;
const BEST_KEY = 'zuma-best';

const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'cyan'];
const COLOR_HEX = {
    red: '#ef4444',
    blue: '#3b82f6',
    green: '#22c55e',
    yellow: '#facc15',
    purple: '#a855f7',
    cyan: '#22d3ee',
};

// ---------------------------------------------------------------------------
// Seeded RNG — tests pin a seed so a level replays identically.
// ---------------------------------------------------------------------------

let rngState = 123456789;

function setSeed(seed) {
    rngState = (seed >>> 0) || 1;
}

function rnd() {
    // 32-bit xorshift, scaled to [0, 1)
    rngState ^= rngState << 13; rngState >>>= 0;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5; rngState >>>= 0;
    return rngState / 4294967296;
}

function pick(list) {
    return list[Math.floor(rnd() * list.length) % list.length];
}

// ---------------------------------------------------------------------------
// The track
// ---------------------------------------------------------------------------

// Hand-authored control points: in off-screen left, three sweeps across the
// field, then down into the skull hole at the bottom right.
const PATH_POINTS = [
    [-70, 70], [80, 68], [240, 66], [400, 68], [520, 80],
    [566, 128], [540, 176], [430, 196], [280, 200], [140, 202],
    [64, 226], [58, 274], [128, 300], [270, 312], [410, 314],
    [520, 330], [560, 372], [548, 420],
];

const path = [];   // dense polyline {x, y}
const cum = [];    // cumulative arc length, cum[i] is the length up to path[i]

function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    const axis = (a, b, c, d) =>
        0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return { x: axis(p0[0], p1[0], p2[0], p3[0]), y: axis(p0[1], p1[1], p2[1], p3[1]) };
}

function buildPath() {
    const pts = PATH_POINTS;
    const at = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
    const STEPS = 24;
    for (let i = 0; i < pts.length - 1; i++) {
        for (let s = 0; s < STEPS; s++) {
            path.push(catmullRom(at(i - 1), at(i), at(i + 1), at(i + 2), s / STEPS));
        }
    }
    path.push({ x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] });

    cum.push(0);
    for (let i = 1; i < path.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    }
}

buildPath();

const PATH_LENGTH = cum[cum.length - 1];

/** Index of the polyline segment containing arc length `d`. */
function segmentAt(d) {
    if (d <= 0) return 0;
    if (d >= PATH_LENGTH) return path.length - 2;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= d) lo = mid; else hi = mid;
    }
    return lo;
}

/** Point at arc length `d`. Negative values run off the start of the track. */
function pathPoint(d) {
    if (d <= 0) {
        const a = pathAngle(0);
        return { x: path[0].x + Math.cos(a) * d, y: path[0].y + Math.sin(a) * d };
    }
    if (d >= PATH_LENGTH) return { x: path[path.length - 1].x, y: path[path.length - 1].y };
    const i = segmentAt(d);
    const span = cum[i + 1] - cum[i] || 1;
    const t = (d - cum[i]) / span;
    return {
        x: path[i].x + (path[i + 1].x - path[i].x) * t,
        y: path[i].y + (path[i + 1].y - path[i].y) * t,
    };
}

/** Tangent direction (radians) at arc length `d`. */
function pathAngle(d) {
    const i = segmentAt(d);
    return Math.atan2(path[i + 1].y - path[i].y, path[i + 1].x - path[i].x);
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

let state = 'idle';          // idle | running | paused | gameover
let score = 0;
let level = 1;
let best = 0;
let lastCombo = 0;
let time = 0;

let marbles = [];            // front-first: marbles[0] is nearest the hole
let spawnQueue = [];
let projectiles = [];
let particles = [];
let comboFlash = null;

const launcher = {
    x: CANVAS_W / 2,
    y: 445,
    angle: -Math.PI / 2,
    current: 'red',
    next: 'blue',
    recoil: 0,
};

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const remainingEl = document.getElementById('remaining');
const bestEl = document.getElementById('best');

// ---------------------------------------------------------------------------
// Level configuration
// ---------------------------------------------------------------------------

function levelColors() {
    return COLORS.slice(0, Math.min(3 + level, COLORS.length));
}

function chainSpeed() {
    return 20 + 4 * level;
}

function levelSize() {
    return 28 + 6 * level;
}

function buildQueue() {
    const colors = levelColors();
    const queue = [];
    const size = levelSize();
    while (queue.length < size) {
        const color = pick(colors);
        const run = 1 + Math.floor(rnd() * 2);
        for (let i = 0; i < run && queue.length < size; i++) queue.push(color);
    }
    return queue;
}

/** Colours the player could still usefully be handed. */
function availableColors() {
    const seen = new Set();
    for (const m of marbles) seen.add(m.color);
    for (const c of spawnQueue) seen.add(c);
    const list = [...seen];
    return list.length ? list : levelColors();
}

function reload() {
    const available = availableColors();
    launcher.current = pick(available);
    launcher.next = pick(available);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function startLevel() {
    marbles = [];
    projectiles = [];
    spawnQueue = buildQueue();
    reload();
    updateHud();
}

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    lastCombo = 0;
    particles = [];
    comboFlash = null;
    launcher.angle = -Math.PI / 2;
    startLevel();
    hideOverlay();
}

function nextLevel() {
    addScore(LEVEL_BONUS * level);
    level += 1;
    comboFlash = { text: `LEVEL ${level}`, life: 1.6 };
    startLevel();
}

function endGame() {
    state = 'gameover';
    saveBest();
    updateHud();
    showOverlay('GAME OVER', `Score ${score} — reached level ${level}`, 'Press Space to play again', 'Play Again');
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

function saveBest() {
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* private mode — best score just isn't persisted */
        }
    }
}

function addScore(points) {
    score += points;
    saveBest();
    updateHud();
}

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

function advanceChain(dt) {
    const speed = chainSpeed();
    for (const m of marbles) m.dist += speed * dt;

    // Close any gaps left behind by pops, front to back.
    for (let i = 1; i < marbles.length; i++) {
        const gap = marbles[i - 1].dist - marbles[i].dist;
        if (gap > MARBLE_SPACING) {
            marbles[i].dist += Math.min(COLLAPSE_SPEED * dt, gap - MARBLE_SPACING);
        }
    }

    // Feed the queue onto the back of the track.
    while (spawnQueue.length) {
        if (!marbles.length) {
            marbles.push({ dist: -MARBLE_SPACING, color: spawnQueue.shift() });
            continue;
        }
        const tail = marbles[marbles.length - 1];
        if (tail.dist < 0) break;
        marbles.push({ dist: tail.dist - MARBLE_SPACING, color: spawnQueue.shift() });
    }
}

/**
 * Wedge a marble into the chain at `index`, pushing everything behind it back
 * to make room, then resolve any run it completed.
 */
function insertMarble(index, color) {
    lastCombo = 0;
    if (!marbles.length) {
        marbles.push({ dist: 0, color });
        return;
    }
    const k = Math.max(0, Math.min(index, marbles.length));
    const dist = k === 0 ? marbles[0].dist : marbles[k - 1].dist - MARBLE_SPACING;
    for (let j = k; j < marbles.length; j++) marbles[j].dist -= MARBLE_SPACING;
    marbles.splice(k, 0, { dist, color });
    resolveMatches(k);
}

/**
 * Pop the run containing `index` if it is long enough, then keep popping while
 * the marbles left facing each other across the gap form another run.
 */
function resolveMatches(index) {
    let at = index;
    let combo = 0;

    while (at >= 0 && at < marbles.length) {
        const color = marbles[at].color;
        let start = at;
        let end = at;
        while (start - 1 >= 0 && marbles[start - 1].color === color) start--;
        while (end + 1 < marbles.length && marbles[end + 1].color === color) end++;

        const run = end - start + 1;
        if (run < MIN_RUN) break;

        combo += 1;
        const removed = marbles.splice(start, run);
        addScore(MATCH_POINTS * run * combo);
        popParticles(removed);

        // Chain reaction: the two marbles now touching across the gap.
        if (start - 1 >= 0 && start < marbles.length && marbles[start - 1].color === marbles[start].color) {
            at = start;
        } else {
            break;
        }
    }

    lastCombo = combo;
    if (combo > 1) comboFlash = { text: `COMBO x${combo}`, life: 1.1 };
}

function inDanger() {
    return marbles.length > 0 && marbles[0].dist > PATH_LENGTH - DANGER_ZONE;
}

// ---------------------------------------------------------------------------
// Launcher
// ---------------------------------------------------------------------------

function clampAim(angle) {
    return Math.max(AIM_MIN, Math.min(AIM_MAX, angle));
}

function rotateAim(dir) {
    launcher.angle = clampAim(launcher.angle + dir * AIM_STEP);
}

function aimAt(x, y) {
    launcher.angle = clampAim(Math.atan2(y - launcher.y, x - launcher.x));
}

function swap() {
    if (state !== 'running') return;
    const held = launcher.current;
    launcher.current = launcher.next;
    launcher.next = held;
}

function shoot() {
    if (state !== 'running' || projectiles.length) return;
    const a = launcher.angle;
    projectiles.push({
        x: launcher.x + Math.cos(a) * LAUNCH_OFFSET,
        y: launcher.y + Math.sin(a) * LAUNCH_OFFSET,
        vx: Math.cos(a) * PROJECTILE_SPEED,
        vy: Math.sin(a) * PROJECTILE_SPEED,
        color: launcher.current,
    });
    launcher.current = launcher.next;
    launcher.next = pick(availableColors());
    launcher.recoil = 1;
}

/** Index the projectile should occupy given the chain marble it touched. */
function insertionIndex(p, hit) {
    const marble = marbles[hit];
    const at = pathPoint(marble.dist);
    const a = pathAngle(marble.dist);
    const ahead = (p.x - at.x) * Math.cos(a) + (p.y - at.y) * Math.sin(a);
    return ahead > 0 ? hit : hit + 1;
}

function hitIndex(p) {
    let best = -1;
    let bestDist = MARBLE_R * 2;
    for (let i = 0; i < marbles.length; i++) {
        const at = pathPoint(marbles[i].dist);
        const d = Math.hypot(p.x - at.x, p.y - at.y);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}

function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        // Sub-step so a fast shot can never tunnel through the chain.
        const travel = Math.hypot(p.vx, p.vy) * dt;
        const steps = Math.max(1, Math.ceil(travel / (MARBLE_R * 0.7)));
        let landed = false;

        for (let s = 0; s < steps && !landed; s++) {
            p.x += (p.vx * dt) / steps;
            p.y += (p.vy * dt) / steps;
            const hit = hitIndex(p);
            if (hit >= 0) {
                insertMarble(insertionIndex(p, hit), p.color);
                landed = true;
            }
        }

        const gone = p.x < -MARBLE_R || p.x > CANVAS_W + MARBLE_R || p.y < -MARBLE_R || p.y > CANVAS_H + MARBLE_R;
        if (landed || gone) projectiles.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

function popParticles(removed) {
    for (const m of removed) {
        const at = pathPoint(m.dist);
        for (let i = 0; i < 6; i++) {
            const a = rnd() * Math.PI * 2;
            const speed = 40 + rnd() * 110;
            particles.push({
                x: at.x,
                y: at.y,
                vx: Math.cos(a) * speed,
                vy: Math.sin(a) * speed,
                life: 0.45 + rnd() * 0.3,
                max: 0.75,
                color: COLOR_HEX[m.color] || '#fff',
            });
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
    if (comboFlash) {
        comboFlash.life -= dt;
        if (comboFlash.life <= 0) comboFlash = null;
    }
}

// ---------------------------------------------------------------------------
// Main update
// ---------------------------------------------------------------------------

function update(dt) {
    if (state !== 'running') return;
    const step = Math.min(dt, 0.05);
    time += step;
    launcher.recoil = Math.max(0, launcher.recoil - step * 6);

    advanceChain(step);
    updateProjectiles(step);
    updateParticles(step);

    if (marbles.length && marbles[0].dist >= PATH_LENGTH) {
        endGame();
        return;
    }
    // Don't call the level while a shot is still in the air.
    if (!spawnQueue.length && !marbles.length && !projectiles.length) nextLevel();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function strokePath(width, color, dash) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    ctx.restore();
}

function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#16240f');
    g.addColorStop(1, '#070d06');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Faint carved stonework behind the track.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= CANVAS_W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_H);
        ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_W, y);
        ctx.stroke();
    }
}

function drawTrack() {
    strokePath(30, '#0b1a0c');
    strokePath(24, '#182b17');
    strokePath(2, 'rgba(180, 220, 160, 0.16)', [6, 12]);

    if (inDanger()) {
        const pulse = 0.35 + 0.35 * Math.sin(time * 9);
        ctx.save();
        ctx.globalAlpha = pulse;
        strokePath(26, '#7f1d1d');
        ctx.restore();
    }
}

function drawHole() {
    const at = pathPoint(PATH_LENGTH);
    ctx.save();
    ctx.translate(at.x, at.y);

    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
    glow.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#d6d3c4';
    ctx.beginPath();
    ctx.arc(0, -2, 15, Math.PI, 0);
    ctx.rect(-15, -2, 30, 13);
    ctx.fill();

    ctx.fillStyle = '#0b0e08';
    ctx.beginPath();
    ctx.arc(-6, -3, 4.4, 0, Math.PI * 2);
    ctx.arc(6, -3, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-2, 3, 4, 5);

    ctx.fillStyle = '#d6d3c4';
    ctx.fillRect(-11, 12, 22, 7);
    ctx.fillStyle = '#0b0e08';
    for (let i = -8; i <= 8; i += 5.5) ctx.fillRect(i, 12, 1.4, 7);
    ctx.restore();
}

function drawMarble(x, y, color, radius) {
    const hex = COLOR_HEX[color] || '#94a3b8';
    const g = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.15, x, y, radius);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.28, hex);
    g.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.33, y - radius * 0.42, radius * 0.26, radius * 0.17, -0.6, 0, Math.PI * 2);
    ctx.fill();
}

function drawChain() {
    // Back to front so the leading marble sits on top.
    for (let i = marbles.length - 1; i >= 0; i--) {
        const m = marbles[i];
        if (m.dist < -MARBLE_SPACING * 2) continue;
        const at = pathPoint(m.dist);
        drawMarble(at.x, at.y, m.color, MARBLE_R);
    }
}

function drawAimGuide() {
    if (state !== 'running') return;
    const a = launcher.angle;
    ctx.save();
    ctx.fillStyle = 'rgba(245, 185, 66, 0.35)';
    for (let d = 40; d < 190; d += 18) {
        const x = launcher.x + Math.cos(a) * d;
        const y = launcher.y + Math.sin(a) * d;
        ctx.beginPath();
        ctx.arc(x, y, 2.2 - d / 220, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawLauncher() {
    const a = launcher.angle;
    const kick = launcher.recoil * 5;
    ctx.save();
    ctx.translate(launcher.x - Math.cos(a) * kick, launcher.y - Math.sin(a) * kick);

    // Barrel
    ctx.save();
    ctx.rotate(a);
    ctx.fillStyle = '#3f5c33';
    ctx.beginPath();
    ctx.roundRect(0, -9, 30, 18, 6);
    ctx.fill();
    ctx.strokeStyle = '#89b46f';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Body
    const g = ctx.createRadialGradient(-6, -8, 4, 0, 0, 24);
    g.addColorStop(0, '#7fbf5f');
    g.addColorStop(1, '#264d1c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0e1a0a';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawMarble(0, 0, launcher.current, 11);

    // Queued marble tucked behind the launcher.
    ctx.globalAlpha = 0.9;
    drawMarble(-30, 12, launcher.next, 8);
    ctx.globalAlpha = 1;
    ctx.restore();
}

function drawProjectiles() {
    for (const p of projectiles) drawMarble(p.x, p.y, p.color, MARBLE_R);
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawComboFlash() {
    if (!comboFlash) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, comboFlash.life * 1.6);
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f5b942';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 4;
    ctx.strokeText(comboFlash.text, CANVAS_W / 2, 250);
    ctx.fillText(comboFlash.text, CANVAS_W / 2, 250);
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawBackground();
    drawTrack();
    drawHole();
    drawChain();
    drawAimGuide();
    drawProjectiles();
    drawLauncher();
    drawParticles();
    drawComboFlash();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    remainingEl.textContent = String(spawnQueue.length + marbles.length);
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
// Input
// ---------------------------------------------------------------------------

function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * (CANVAS_W / rect.width),
        y: (event.clientY - rect.top) * (CANVAS_H / rect.height),
    };
}

document.addEventListener('keydown', (event) => {
    const key = event.key;
    if (key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else if (state === 'paused') togglePause();
        else shoot();
        return;
    }
    if (key === 'ArrowLeft') { event.preventDefault(); rotateAim(-1); return; }
    if (key === 'ArrowRight') { event.preventDefault(); rotateAim(1); return; }
    if (key === 's' || key === 'S') { swap(); return; }
    if (key === 'p' || key === 'P') { togglePause(); return; }
    if (key === 'r' || key === 'R') { startGame(); }
});

canvas.addEventListener('mousemove', (event) => {
    if (state !== 'running') return;
    const p = canvasPoint(event);
    aimAt(p.x, p.y);
});

canvas.addEventListener('mousedown', (event) => {
    if (event.button === 2) {
        event.preventDefault();
        swap();
        return;
    }
    if (state === 'idle' || state === 'gameover') {
        startGame();
        return;
    }
    if (state !== 'running') return;
    const p = canvasPoint(event);
    aimAt(p.x, p.y);
    shoot();
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

btnStart.addEventListener('click', (event) => {
    event.stopPropagation();
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function loadBest() {
    try {
        const stored = parseInt(window.localStorage.getItem(BEST_KEY), 10);
        if (Number.isFinite(stored)) best = stored;
    } catch (err) {
        /* storage unavailable */
    }
}

let lastTs = 0;

function frame(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    update(dt);
    draw();
    requestAnimationFrame(frame);
}

loadBest();
setSeed(Math.floor(Math.random() * 0xffffffff) || 1);
updateHud();
draw();
requestAnimationFrame(frame);
