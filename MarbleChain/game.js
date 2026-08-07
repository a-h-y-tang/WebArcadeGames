// ---------------------------------------------------------------------------
// Marble Chain — a spiral marble shooter on an HTML5 canvas.
//
// A chain of coloured marbles crawls along a spiral track towards the hole in
// the middle. The player sits at the centre of the spiral and shoots marbles
// into the chain; three or more of a colour in a row pop. Clear every marble in
// the level's supply before the head of the chain reaches the hole.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
//
// The chain is modelled as a single rigid train: `chain` holds the marble
// colours from head (index 0, nearest the hole) to tail, and `headDist` is how
// far the head has travelled along the path. Marble i therefore always sits at
// `headDist - i * SPACING`. Popping a run closes the gap instantly, which is
// what makes combos possible.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 720;
const CANVAS_H = 520;
const CENTER = { x: 360, y: 258 };

// --- Spiral track ---
const TURNS = 3.8;          // how many times the track wraps around the centre
const R_START = 330;        // radius where marbles enter
const R_END = 92;           // radius of the hole
const Y_SQUASH = 0.74;      // flattens the spiral into the landscape canvas
const PATH_SAMPLES = 1400;

// --- Marbles ---
const MARBLE_R = 13;
const SPACING = MARBLE_R * 2;
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
const SWATCH = {
    red: '#ef4b5c',
    blue: '#4a8ff0',
    green: '#3fc06a',
    yellow: '#f2c33d',
    purple: '#a76bf0',
    orange: '#f2853d',
};

// --- Chain difficulty (pure functions of `level`) ---
const CHAIN_BASE = 30, CHAIN_STEP = 6;   // px/s the chain crawls
const LEVEL_SUPPLY = 52;                 // marbles fed onto the track per level
const POINTS_PER_MARBLE = 10;

// --- Shooter ---
const SHOOTER_R = 20;
const SHOT_SPEED = 560;
const MAX_SHOTS = 3;
const AIM_SPEED = 2.6;                   // rad/s while an arrow key is held

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
// state: 'idle' | 'running' | 'paused' | 'cleared' | 'over'
let state, score, best, level, remaining, headDist, lastCombo;
const chain = [];       // [{ color }] head first
const shots = [];       // [{ x, y, vx, vy, color }]
const particles = [];
const shooter = { x: CENTER.x, y: CENTER.y, angle: -Math.PI / 2, current: 'red', next: 'blue' };
const heldKeys = new Set();

// ---------------------------------------------------------------------------
// The spiral path
// ---------------------------------------------------------------------------

// Sampled points plus the cumulative arc length at each one, so a distance
// along the track can be turned into an (x, y) with a lookup and a lerp.
const pathPts = [];
const pathCum = [];

(function buildPath() {
    for (let i = 0; i <= PATH_SAMPLES; i++) {
        const t = i / PATH_SAMPLES;
        const theta = Math.PI + t * TURNS * Math.PI * 2;
        const r = R_START + (R_END - R_START) * t;
        pathPts.push({
            x: CENTER.x + Math.cos(theta) * r,
            y: CENTER.y + Math.sin(theta) * r * Y_SQUASH,
        });
    }
    pathCum.push(0);
    for (let i = 1; i < pathPts.length; i++) {
        const a = pathPts[i - 1], b = pathPts[i];
        pathCum.push(pathCum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
})();

const pathLength = pathCum[pathCum.length - 1];
const hole = pathPts[pathPts.length - 1];

/** Point at distance `d` along the track (clamped to the ends). */
function pathPoint(d) {
    if (d <= 0) return { x: pathPts[0].x, y: pathPts[0].y };
    if (d >= pathLength) return { x: hole.x, y: hole.y };
    let lo = 0, hi = pathCum.length - 1;
    while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (pathCum[mid] <= d) lo = mid; else hi = mid;
    }
    const seg = pathCum[hi] - pathCum[lo];
    const t = seg > 0 ? (d - pathCum[lo]) / seg : 0;
    return {
        x: pathPts[lo].x + (pathPts[hi].x - pathPts[lo].x) * t,
        y: pathPts[lo].y + (pathPts[hi].y - pathPts[lo].y) * t,
    };
}

/** Distance along the track that comes closest to (x, y), searched near `around`. */
function nearestPathDist(x, y, around, window = SPACING) {
    let bestD = around, bestGap = Infinity;
    const from = Math.max(0, around - window), to = Math.min(pathLength, around + window);
    for (let d = from; d <= to; d += 2) {
        const p = pathPoint(d);
        const gap = Math.hypot(p.x - x, p.y - y);
        if (gap < bestGap) { bestGap = gap; bestD = d; }
    }
    return bestD;
}

// ---------------------------------------------------------------------------
// Difficulty helpers
// ---------------------------------------------------------------------------

function chainSpeed(lv = level) { return CHAIN_BASE + (lv - 1) * CHAIN_STEP; }
function levelColors(lv = level) {
    return COLORS.slice(0, Math.min(COLORS.length, 3 + Math.floor((lv - 1) / 2)));
}

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------

function marbleDist(i) { return headDist - i * SPACING; }
function marblePos(i) { return pathPoint(marbleDist(i)); }
function tailDist() { return marbleDist(chain.length - 1); }

/**
 * Replace the chain outright and set how many marbles are still queued to feed
 * in behind it. Used when starting a level, and by the tests to build an exact
 * board; the supply defaults to none so a hand-built chain stays as given.
 */
function setChain(colors, head, supply = 0) {
    chain.length = 0;
    for (const color of colors) chain.push({ color });
    headDist = head;
    remaining = supply;
}

function randomOf(list) { return list[Math.floor(Math.random() * list.length)]; }

/** Colour for a marble joining the tail of the chain. */
function pickChainColor() { return randomOf(levelColors()); }

/**
 * Colour to load into the shooter. Prefers colours still on the track so the
 * player is never handed a useless marble.
 */
function pickShooterColor() {
    const live = [...new Set(chain.map((m) => m.color))];
    return live.length ? randomOf(live) : randomOf(levelColors());
}

/** Feed marbles from the level's supply onto the back of the chain. */
function feedChain() {
    if (remaining <= 0) return;
    if (chain.length === 0) {
        // A fully cleared chain with supply left restarts from the track entrance.
        headDist = 0;
        chain.push({ color: pickChainColor() });
        remaining--;
    }
    while (remaining > 0 && tailDist() >= SPACING) {
        chain.push({ color: pickChainColor() });
        remaining--;
    }
}

// ---------------------------------------------------------------------------
// Inserting and popping
// ---------------------------------------------------------------------------

/** Splice a marble into the chain at `index`; everything behind shifts back. */
function insertAt(index, color) {
    chain.splice(index, 0, { color });
    return index;
}

/**
 * Pop the run of matching colours around `index`, then keep popping while the
 * closing gap creates another match. Returns how many marbles were removed and
 * records the combo length in `lastCombo`.
 */
function resolveMatches(index) {
    let combo = 0, total = 0, idx = index;
    while (idx >= 0 && idx < chain.length) {
        const color = chain[idx].color;
        let s = idx, e = idx;
        while (s > 0 && chain[s - 1].color === color) s--;
        while (e < chain.length - 1 && chain[e + 1].color === color) e++;
        const run = e - s + 1;
        if (run < 3) break;

        combo++;
        total += run;
        score += POINTS_PER_MARBLE * run * level * combo;
        for (let i = s; i <= e; i++) spawnPop(marblePos(i), color);
        chain.splice(s, run);

        // The marbles behind snap forward — check the new junction for a combo.
        if (s > 0 && s < chain.length && chain[s - 1].color === chain[s].color) idx = s;
        else break;
    }
    lastCombo = combo;
    if (total > 0) updateHud();
    return total;
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------

function setAim(angle) { shooter.angle = angle; }

function aimAt(x, y) { shooter.angle = Math.atan2(y - shooter.y, x - shooter.x); }

function fire() {
    if (state !== 'running' || shots.length >= MAX_SHOTS) return;
    shots.push({
        x: shooter.x + Math.cos(shooter.angle) * SHOOTER_R,
        y: shooter.y + Math.sin(shooter.angle) * SHOOTER_R,
        vx: Math.cos(shooter.angle) * SHOT_SPEED,
        vy: Math.sin(shooter.angle) * SHOT_SPEED,
        color: shooter.current,
    });
    shooter.current = shooter.next;
    shooter.next = pickShooterColor();
}

function swapMarbles() {
    const tmp = shooter.current;
    shooter.current = shooter.next;
    shooter.next = tmp;
}

/** Index of the chain marble a shot is touching, or -1. */
function hitIndex(shot) {
    let bestI = -1, bestGap = MARBLE_R * 2;
    for (let i = 0; i < chain.length; i++) {
        const d = marbleDist(i);
        if (d < 0) continue;                 // not on the track yet
        const p = pathPoint(d);
        const gap = Math.hypot(p.x - shot.x, p.y - shot.y);
        if (gap <= bestGap) { bestGap = gap; bestI = i; }
    }
    return bestI;
}

/** Land a shot against chain marble `j`, ahead of it or behind it. */
function landShot(shot, j) {
    const dj = marbleDist(j);
    const d = nearestPathDist(shot.x, shot.y, dj);
    const index = d > dj ? j : j + 1;
    insertAt(index, shot.color);
    resolveMatches(index);
}

function updateShots(dt) {
    // Sub-step so a fast shot cannot tunnel through the chain.
    const steps = Math.max(1, Math.ceil((SHOT_SPEED * dt) / (MARBLE_R * 0.5)));
    const sub = dt / steps;
    for (let i = shots.length - 1; i >= 0; i--) {
        const shot = shots[i];
        let done = false;
        for (let s = 0; s < steps && !done; s++) {
            shot.x += shot.vx * sub;
            shot.y += shot.vy * sub;
            const j = hitIndex(shot);
            if (j >= 0) {
                landShot(shot, j);
                done = true;
            } else if (shot.x < -MARBLE_R || shot.x > CANVAS_W + MARBLE_R ||
                       shot.y < -MARBLE_R || shot.y > CANVAS_H + MARBLE_R) {
                done = true;
            }
        }
        if (done) shots.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Particles (pop effect)
// ---------------------------------------------------------------------------

function spawnPop(pos, color) {
    for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 110;
        particles.push({
            x: pos.x, y: pos.y,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 0.45, age: 0, color,
        });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.age >= p.life) particles.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function updateAim(dt) {
    let dir = 0;
    if (heldKeys.has('ArrowLeft')) dir -= 1;
    if (heldKeys.has('ArrowRight')) dir += 1;
    if (dir) shooter.angle += dir * AIM_SPEED * dt;
}

function advanceChain(dt) {
    headDist += chainSpeed() * dt;
    if (chain.length && headDist >= pathLength) {
        gameOver();
        return;
    }
    feedChain();
}

function checkLevelClear() {
    if (state === 'running' && remaining <= 0 && chain.length === 0) levelCleared();
}

function step(dt) {
    if (state !== 'running') return;
    updateAim(dt);
    advanceChain(dt);
    if (state !== 'running') return;
    updateShots(dt);
    updateParticles(dt);
    updateHud();
    checkLevelClear();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startLevel() {
    setChain([], 0, LEVEL_SUPPLY);
    shots.length = 0;
    particles.length = 0;
    lastCombo = 0;
    state = 'running';
    feedChain();
    shooter.angle = -Math.PI / 2;
    shooter.current = pickShooterColor();
    shooter.next = pickShooterColor();
    hideOverlay();
    updateHud();
}

function startGame() {
    if (state === 'cleared') {
        level++;                 // score carries over between levels
    } else {
        level = 1;
        score = 0;
    }
    startLevel();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function levelCleared() {
    state = 'cleared';
    showOverlay('LEVEL CLEARED', `Score ${score}`, `Press Space for level ${level + 1}`);
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        localStorage.setItem('marble-chain-best', String(best));
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to play again');
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    leftEl.textContent = String(remaining);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
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
    ctx.beginPath();
    ctx.moveTo(pathPts[0].x, pathPts[0].y);
    for (let i = 1; i < pathPts.length; i += 4) ctx.lineTo(pathPts[i].x, pathPts[i].y);
    ctx.lineTo(hole.x, hole.y);
    ctx.strokeStyle = '#111f2e';
    ctx.lineWidth = SPACING + 8;
    ctx.stroke();
    ctx.strokeStyle = '#16283a';
    ctx.lineWidth = SPACING;
    ctx.stroke();
    ctx.setLineDash([4, 14]);
    ctx.strokeStyle = 'rgba(120, 170, 210, 0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

function drawHole() {
    const pulse = chain.length ? Math.min(1, marbleDist(0) / pathLength) : 0;
    ctx.save();
    const g = ctx.createRadialGradient(hole.x, hole.y, 2, hole.x, hole.y, 26);
    g.addColorStop(0, '#000');
    g.addColorStop(1, `rgba(${Math.round(60 + 160 * pulse)}, 30, 40, 0.15)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pulse > 0.85 ? '#f87171' : '#2b4055';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
}

function drawMarble(x, y, color, radius = MARBLE_R) {
    const fill = SWATCH[color] || '#8aa0b5';
    const g = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.15, x, y, radius);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.28, fill);
    g.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawChain() {
    for (let i = chain.length - 1; i >= 0; i--) {
        const d = marbleDist(i);
        if (d < 0) continue;
        const p = pathPoint(d);
        drawMarble(p.x, p.y, chain[i].color);
    }
}

function drawShooter() {
    const { x, y, angle } = shooter;

    // Aim guide
    ctx.save();
    ctx.setLineDash([3, 9]);
    ctx.strokeStyle = 'rgba(52, 211, 180, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * (SHOOTER_R + 4), y + Math.sin(angle) * (SHOOTER_R + 4));
    ctx.lineTo(x + Math.cos(angle) * 150, y + Math.sin(angle) * 150);
    ctx.stroke();
    ctx.restore();

    // Barrel
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#1d3a4d';
    ctx.strokeStyle = '#34d3b4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(4, -9, 26, 18, 6) : ctx.rect(4, -9, 26, 18);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Body + loaded marble
    ctx.fillStyle = '#0f2333';
    ctx.strokeStyle = '#34d3b4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, SHOOTER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawMarble(x, y, shooter.current, MARBLE_R - 1);

    // On-deck marble, parked in the empty bottom-left corner so it never sits
    // under the chain or the hole.
    drawMarble(38, CANVAS_H - 34, shooter.next, 11);
    ctx.fillStyle = 'rgba(150, 175, 200, 0.8)';
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NEXT', 38, CANVAS_H - 12);
}

function drawShots() {
    for (const s of shots) drawMarble(s.x, s.y, s.color);
}

function drawParticles() {
    for (const p of particles) {
        const alpha = 1 - p.age / p.life;
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = SWATCH[p.color] || '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5 * alpha + 1, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function draw() {
    ctx.fillStyle = '#071018';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawTrack();
    drawHole();
    drawChain();
    drawShots();
    drawParticles();
    drawShooter();

    if (lastCombo > 1 && particles.length) {
        ctx.fillStyle = '#34d3b4';
        ctx.font = 'bold 20px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`COMBO x${lastCombo}`, CANVAS_W / 2, 34);
    }
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

document.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();

    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        heldKeys.add(e.code);
        return;
    }
    if (e.code === 'Space') {
        if (state === 'running') fire();
        else if (state !== 'paused') startGame();
        return;
    }
    if (e.code === 'KeyS') swapMarbles();
    if (e.code === 'KeyP') togglePause();
});

document.addEventListener('keyup', (e) => heldKeys.delete(e.code));

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
remaining = 0;
headDist = 0;
lastCombo = 0;
updateHud();
requestAnimationFrame(frame);
