// ---------------------------------------------------------------------------
// Marble Track — a marble-shooter on an HTML5 canvas.
//
// A chain of coloured marbles rolls along a spiral track toward the hole in the
// middle. The player sits at the centre of the spiral and fires marbles into the
// chain; three or more of a colour in a row pop, the chain closes the gap, and
// newly touching runs can pop in turn for a combo. Clear every marble before the
// head of the chain reaches the hole.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 480;
const CENTER = { x: CANVAS_W / 2, y: CANVAS_H / 2 };

// --- The spiral track ---
const R_OUTER = 205;   // radius where marbles enter
const R_INNER = 58;    // radius of the hole at the end
const TURNS = 2.5;     // how many times the track wraps around the centre

// --- Marbles ---
const MARBLE_R = 13;
const SPACING = MARBLE_R * 2;  // centre-to-centre gap of a packed chain
const MATCH_MIN = 3;           // marbles of a colour needed to pop
const SHOT_SPEED = 620;        // px/s of a fired marble

// --- Difficulty scaling (pure functions of `level`) ---
const SPEED_BASE = 26, SPEED_STEP = 5;      // px/s the chain rolls
const MARBLES_BASE = 34, MARBLES_STEP = 6;  // marbles queued per level
const PALETTE_BASE = 3;                     // colours in play on level 1
const RUN_BIAS = 0.42;                      // chance a queued marble repeats the one behind it
const LEVEL_BONUS = 100;                    // bonus per cleared level
const POINTS_PER_MARBLE = 10;

const COLORS = ['red', 'blue', 'green', 'yellow', 'purple'];
const COLOR_HEX = {
    red: '#ef4444',
    blue: '#38bdf8',
    green: '#22c55e',
    yellow: '#facc15',
    purple: '#c084fc',
};

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
// Track geometry
//
// The track is sampled densely once at load time and turned into a cumulative
// arc-length table, so `pointAt(t)` maps a distance travelled (in pixels) to a
// point on the spiral. Marble positions are stored purely as distances along the
// track, which keeps the simulation one-dimensional and easy to test.
// ---------------------------------------------------------------------------

const PATH_POINTS = buildSpiral();
const PATH_CUM = buildArcLengths(PATH_POINTS);
const PATH_LENGTH = PATH_CUM[PATH_CUM.length - 1];
const HOLE = PATH_POINTS[PATH_POINTS.length - 1];
const SHOOTER = { x: CENTER.x, y: CENTER.y };

function buildSpiral() {
    const pts = [];
    const samples = 2400;
    const sweep = TURNS * Math.PI * 2;
    for (let i = 0; i <= samples; i++) {
        const f = i / samples;
        const a = f * sweep;
        const r = R_OUTER - (R_OUTER - R_INNER) * f;
        pts.push({ x: CENTER.x + Math.cos(a) * r, y: CENTER.y + Math.sin(a) * r });
    }
    return pts;
}

function buildArcLengths(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        cum.push(cum[i - 1] + Math.hypot(dx, dy));
    }
    return cum;
}

/** Point on the track `t` pixels from the entrance (clamped to the track). */
function pointAt(t) {
    if (t <= 0) return { x: PATH_POINTS[0].x, y: PATH_POINTS[0].y };
    if (t >= PATH_LENGTH) return { x: HOLE.x, y: HOLE.y };

    let lo = 0, hi = PATH_CUM.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (PATH_CUM[mid] <= t) lo = mid; else hi = mid;
    }
    const span = PATH_CUM[hi] - PATH_CUM[lo];
    const f = span > 0 ? (t - PATH_CUM[lo]) / span : 0;
    return {
        x: PATH_POINTS[lo].x + (PATH_POINTS[hi].x - PATH_POINTS[lo].x) * f,
        y: PATH_POINTS[lo].y + (PATH_POINTS[hi].y - PATH_POINTS[lo].y) * f,
    };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// state: 'idle' | 'running' | 'paused' | 'over'
var state, score, best, level, pending, headT, lastCombo;
var chain = [];        // index 0 is the head — the marble nearest the hole
var shot = null;       // the marble in flight, or null
var shooterColor, nextColor;
var aimAngle = -Math.PI / 2;
var particles = [];
var popups = [];      // floating "+points" labels
var dangerPulse = 0;
var levelFlash = 0;   // seconds left on the "LEVEL n" banner

// --- Difficulty helpers ---
function speedForLevel(l) { return SPEED_BASE + (l - 1) * SPEED_STEP; }
function marblesForLevel(l) { return MARBLES_BASE + (l - 1) * MARBLES_STEP; }
function paletteForLevel(l) {
    const n = Math.min(PALETTE_BASE + Math.floor((l - 1) / 2), COLORS.length);
    return COLORS.slice(0, n);
}
function chainSpeed() { return speedForLevel(level); }

/** Distance along the track of the marble at `index`. */
function marbleT(index) { return headT - index * SPACING; }

/** Canvas position of the marble at `index`. */
function marblePos(index) { return pointAt(marbleT(index)); }

/**
 * Colour for the next marble to load. While marbles remain on the track only
 * colours that are still in play are offered, so the player is never handed a
 * marble that cannot possibly match.
 */
function rollColor() {
    const pool = chain.length ? [...new Set(chain.map((m) => m.color))] : paletteForLevel(level);
    return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Colour for a marble rolling onto the track. Drawn from the level palette, but
 * biased toward repeating the marble behind it so the chain arrives in short
 * runs of a colour rather than as unclearable confetti.
 */
function queueColor() {
    const palette = paletteForLevel(level);
    const n = chain.length;
    const tail = n ? chain[n - 1].color : null;
    const pairAtTail = n >= 2 && chain[n - 1].color === chain[n - 2].color;

    // never let the queue deliver a ready-made run of three — the third marble
    // of any run is the player's to shoot
    if (pairAtTail) {
        const others = palette.filter((c) => c !== tail);
        if (others.length) return others[Math.floor(Math.random() * others.length)];
    } else if (tail && palette.includes(tail) && Math.random() < RUN_BIAS) {
        return tail;
    }
    return palette[Math.floor(Math.random() * palette.length)];
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    level = 1;
    lastCombo = 0;
    startLevel(1);
    state = 'running';
    particles = [];
    popups = [];
    levelFlash = 0;
    hideOverlay();
    updateHud();
}

function startLevel(l) {
    level = l;
    chain.length = 0;
    headT = 0;
    pending = marblesForLevel(l);
    shot = null;
    shooterColor = rollColor();
    nextColor = rollColor();
    updateHud();
}

function nextLevel() {
    score += LEVEL_BONUS * level;
    startLevel(level + 1);
    levelFlash = 1.8;
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { window.localStorage.setItem('marble-track-best', String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} — Level ${level}`, 'Press Space to play again', 'Play Again');
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

/** Test helper: put exactly these colours on the track and empty the queue. */
function setChain(colors, t) {
    chain.length = 0;
    for (const color of colors) chain.push({ color });
    headT = t;
    pending = 0;
    updateHud();
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------

function aimAt(x, y) {
    aimAngle = Math.atan2(y - SHOOTER.y, x - SHOOTER.x);
}

/** Fire the loaded marble toward (x, y). Returns whether a shot was launched. */
function shootAt(x, y) {
    if (state !== 'running' || shot) return false;
    aimAt(x, y);
    shot = {
        x: SHOOTER.x,
        y: SHOOTER.y,
        vx: Math.cos(aimAngle) * SHOT_SPEED,
        vy: Math.sin(aimAngle) * SHOT_SPEED,
        color: shooterColor,
    };
    shooterColor = nextColor;
    nextColor = rollColor();
    updateHud();
    return true;
}

function swapShooter() {
    const held = shooterColor;
    shooterColor = nextColor;
    nextColor = held;
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

/**
 * Insert `color` at `index` and resolve any matches it creates.
 *
 * Inserting wedges the chain apart: everything ahead of the new marble is shoved
 * one diameter closer to the hole (`headT += SPACING`) while the marbles behind
 * it stay put. Returns the number of marbles cleared.
 */
function insertMarble(index, color) {
    chain.splice(index, 0, { color });
    headT += SPACING;
    return resolveMatches(index);
}

/**
 * Pop the run containing `index`, then keep popping while the marbles that come
 * together across the new gap form another run — that cascade is the combo.
 */
function resolveMatches(index) {
    let combo = 0;
    let cleared = 0;
    let at = index;

    while (at >= 0 && at < chain.length) {
        const color = chain[at].color;
        let start = at;
        let end = at;
        while (start > 0 && chain[start - 1].color === color) start--;
        while (end < chain.length - 1 && chain[end + 1].color === color) end++;
        const run = end - start + 1;
        if (run < MATCH_MIN) break;

        const at0 = pointAt(marbleT(start));
        popRun(start, run);
        combo++;
        cleared += run;
        const points = run * POINTS_PER_MARBLE * combo;
        score += points;
        popups.push({
            x: at0.x,
            y: at0.y,
            text: combo > 1 ? `+${points} x${combo}` : `+${points}`,
            life: 0.9,
        });

        // The marbles either side of the gap are now neighbours: if they share a
        // colour the cascade continues from there.
        if (start > 0 && start < chain.length && chain[start - 1].color === chain[start].color) {
            at = start;
        } else {
            break;
        }
    }

    lastCombo = combo;
    if (cleared) updateHud();
    return cleared;
}

/**
 * Remove `count` marbles starting at `start`. Marbles behind the gap roll
 * forward to close it; if the head itself was popped there is nothing ahead to
 * roll into, so the whole chain is pulled back from the hole instead.
 */
function popRun(start, count) {
    for (let i = start; i < start + count; i++) {
        const p = pointAt(marbleT(i));
        spawnBurst(p.x, p.y, chain[i].color);
    }
    chain.splice(start, count);
    if (start === 0) headT -= count * SPACING;
}

/** Roll queued marbles onto the track behind the chain. */
function spawnQueued() {
    if (!pending) return;
    if (!chain.length) {
        chain.push({ color: queueColor() });
        headT = 0;
        pending--;
    }
    while (pending > 0 && headT - (chain.length - 1) * SPACING >= SPACING) {
        chain.push({ color: queueColor() });
        pending--;
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    if (chain.length) headT += chainSpeed() * dt;
    spawnQueued();

    if (chain.length && marbleT(0) >= PATH_LENGTH) {
        endGame();
        return;
    }

    stepShot(dt);
    stepParticles(dt);
    if (levelFlash > 0) levelFlash = Math.max(0, levelFlash - dt);

    dangerPulse = chain.length ? Math.max(0, (marbleT(0) / PATH_LENGTH - 0.8) / 0.2) : 0;

    if (!chain.length && !pending) nextLevel();
    updateHud();
}

/**
 * Move the shot in sub-steps no longer than a marble radius, so a slow frame
 * cannot let it tunnel straight through the chain.
 */
function stepShot(dt) {
    if (!shot) return;
    const travel = Math.hypot(shot.vx, shot.vy) * dt;
    const parts = Math.max(1, Math.ceil(travel / MARBLE_R));
    for (let i = 0; i < parts && shot; i++) advanceShot(dt / parts);
}

function advanceShot(dt) {
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;

    // stick to the *nearest* marble in reach, not merely the first one found —
    // the spiral often puts two turns of the chain within range of a shot
    let hit = -1;
    let hitDist = MARBLE_R * 2;
    for (let i = 0; i < chain.length; i++) {
        const p = marblePos(i);
        const d = Math.hypot(shot.x - p.x, shot.y - p.y);
        if (d <= hitDist) { hit = i; hitDist = d; }
    }
    if (hit >= 0) {
        const t = marbleT(hit);
        const front = pointAt(t + SPACING / 2);
        const back = pointAt(t - SPACING / 2);
        const dFront = Math.hypot(shot.x - front.x, shot.y - front.y);
        const dBack = Math.hypot(shot.x - back.x, shot.y - back.y);
        const color = shot.color;
        shot = null;
        insertMarble(dFront <= dBack ? hit : hit + 1, color);
        return;
    }

    const m = MARBLE_R * 2;
    if (shot.x < -m || shot.x > CANVAS_W + m || shot.y < -m || shot.y > CANVAS_H + m) {
        shot = null;
    }
}

function spawnBurst(x, y, color) {
    for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8 + Math.random();
        const speed = 60 + Math.random() * 90;
        particles.push({
            x, y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            life: 0.45,
            color,
        });
    }
}

function stepParticles(dt) {
    for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 140 * dt;
        p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const p of popups) {
        p.y -= 26 * dt;
        p.life -= dt;
    }
    popups = popups.filter((p) => p.life > 0);
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    marblesEl.textContent = String(chain.length + pending);
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

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawTrack();
    drawHole();
    drawMarbles();
    drawParticles();
    if (shot) drawMarble(shot.x, shot.y, shot.color, MARBLE_R);
    drawShooter();
    drawPopups();
    if (dangerPulse > 0) drawDanger();
    if (levelFlash > 0) drawLevelFlash();
}

function drawPopups() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
    for (const p of popups) {
        ctx.globalAlpha = Math.min(1, p.life / 0.4);
        ctx.fillStyle = '#e6f2f0';
        ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
}

function drawLevelFlash() {
    ctx.save();
    ctx.globalAlpha = Math.min(1, levelFlash / 0.6);
    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`LEVEL ${level}`, CENTER.x, 62);
    ctx.restore();
}

function drawTrack() {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(PATH_POINTS[0].x, PATH_POINTS[0].y);
    for (let i = 1; i < PATH_POINTS.length; i += 8) ctx.lineTo(PATH_POINTS[i].x, PATH_POINTS[i].y);
    ctx.lineTo(HOLE.x, HOLE.y);

    ctx.strokeStyle = '#10222b';
    ctx.lineWidth = SPACING + 10;
    ctx.stroke();
    ctx.strokeStyle = '#0a1820';
    ctx.lineWidth = SPACING + 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.12)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 10]);
    ctx.stroke();
    ctx.setLineDash([]);

    // the last stretch before the hole, tinted as a warning
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < PATH_POINTS.length; i++) {
        if (PATH_CUM[i] < PATH_LENGTH * 0.85) continue;
        if (!started) { ctx.moveTo(PATH_POINTS[i].x, PATH_POINTS[i].y); started = true; }
        else if (i % 8 === 0 || i === PATH_POINTS.length - 1) ctx.lineTo(PATH_POINTS[i].x, PATH_POINTS[i].y);
    }
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.22)';
    ctx.lineWidth = SPACING + 2;
    ctx.stroke();

    // entrance
    const entry = PATH_POINTS[0];
    ctx.fillStyle = '#1c4b45';
    ctx.beginPath();
    ctx.arc(entry.x, entry.y, MARBLE_R + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

function drawHole() {
    ctx.save();
    const g = ctx.createRadialGradient(HOLE.x, HOLE.y, 2, HOLE.x, HOLE.y, 20);
    g.addColorStop(0, '#000');
    g.addColorStop(1, '#123');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(HOLE.x, HOLE.y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

function drawMarbles() {
    for (let i = chain.length - 1; i >= 0; i--) {
        const p = marblePos(i);
        drawMarble(p.x, p.y, chain[i].color, MARBLE_R);
    }
}

function drawMarble(x, y, color, r) {
    const hex = COLOR_HEX[color] || '#ffffff';
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, hex);
    g.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawShooter() {
    ctx.save();
    ctx.translate(SHOOTER.x, SHOOTER.y);

    // aiming guide
    ctx.rotate(aimAngle);
    ctx.strokeStyle = 'rgba(230, 242, 240, 0.18)';
    ctx.setLineDash([4, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(24, 0);
    ctx.lineTo(120, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    // barrel
    ctx.fillStyle = '#1f4750';
    ctx.fillRect(8, -8, 26, 16);
    ctx.strokeStyle = '#2f6b78';
    ctx.strokeRect(8, -8, 26, 16);
    ctx.rotate(-aimAngle);

    // body
    ctx.fillStyle = '#173840';
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    if (state === 'running' || state === 'paused') {
        drawMarble(SHOOTER.x, SHOOTER.y, shooterColor, MARBLE_R);
        drawMarble(SHOOTER.x, SHOOTER.y + 34, nextColor, MARBLE_R * 0.6);
    }
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / 0.45);
        ctx.fillStyle = COLOR_HEX[p.color] || '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawDanger() {
    ctx.save();
    ctx.strokeStyle = `rgba(248, 113, 113, ${0.15 + dangerPulse * 0.5})`;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, CANVAS_W - 6, CANVAS_H - 6);
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastFrame = 0;

function frame(now) {
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') swapShooter();
    } else if (e.code === 'KeyP') {
        togglePause();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    aimAt(e.clientX - rect.left, e.clientY - rect.top);
});

canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    shootAt(e.clientX - rect.left, e.clientY - rect.top);
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (state === 'running') swapShooter();
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
    try { stored = parseInt(window.localStorage.getItem('marble-track-best'), 10); } catch (e) { stored = 0; }
    return Number.isFinite(stored) ? stored : 0;
}

state = 'idle';
score = 0;
level = 1;
pending = 0;
headT = 0;
lastCombo = 0;
best = loadBest();
shooterColor = COLORS[0];
nextColor = COLORS[1];
updateHud();
draw();
requestAnimationFrame(frame);
