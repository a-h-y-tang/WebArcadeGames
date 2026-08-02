// ---------------------------------------------------------------------------
// Marble Loop — a path-based marble shooter (Puzz Loop / Zuma lineage).
//
// A chain of coloured marbles crawls along a winding track toward a pit at the
// end. A turret in the middle of the track lobs marbles into the chain; three
// or more of a colour in a row pop, the marbles behind roll forward to close
// the gap, and a closing gap can pop again for a combo.
//
// Written as a single classic (non-module) script so the state and the pure
// helpers are reachable from Playwright as plain globals — the same convention
// Kaboom, Snake and Tetris use in this repo. All motion is per second and runs
// through `step(dt)`, so tests advance the simulation deterministically instead
// of racing requestAnimationFrame.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 480;

// --- Marbles ---
const MARBLE_R = 13;
const SPACING = MARBLE_R * 2;   // centre-to-centre distance of touching marbles
const MIN_MATCH = 3;
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

const MARBLE_SKIN = {
    red: ['#ff8a8a', '#e23a3a', '#7f1414'],
    blue: ['#8ec5ff', '#2f7ce0', '#123a75'],
    green: ['#93eab0', '#2eb463', '#0f5330'],
    yellow: ['#ffe89a', '#f2c02e', '#7d5c05'],
    purple: ['#d7aaff', '#9146d8', '#40166f'],
    orange: ['#ffc292', '#f08023', '#7a3a04'],
};

// --- Motion ---
const CATCHUP_BONUS = 150;      // px/s the rear segment gains while closing a gap
const GAP_EPS = 1;              // px below which a trailing marble counts as flush
const SHOT_SPEED = 520;         // px/s of a fired marble
const PATH_STEP = 2;            // resampling resolution of the track polyline

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
let state, score, best, level, pending, comboStep, palette, path, bannerTimer;
const chain = [];               // front first: chain[0] is nearest the pit
const projectiles = [];
const particles = [];
const shooter = { x: CANVAS_W / 2, y: CANVAS_H / 2, angle: -Math.PI / 2, current: 'red', next: 'blue' };

// ---------------------------------------------------------------------------
// Track construction
//
// A generator hands back coarse control points plus the turret position; the
// polyline is then resampled at uniform PATH_STEP intervals so that a distance
// along the track maps to an index by plain division.
// ---------------------------------------------------------------------------

function lineSegment(pts, x0, y0, x1, y1, n) {
    for (let i = 1; i <= n; i++) {
        const u = i / n;
        pts.push({ x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u });
    }
}

function arcSegment(pts, cx, cy, r, a0, a1, n) {
    for (let i = 1; i <= n; i++) {
        const a = a0 + (a1 - a0) * (i / n);
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
}

// Level 1, 4, 7 … — an inward spiral with the turret at its eye.
function spiralTrack() {
    const pts = [];
    const turns = 4.6 * Math.PI;
    const cx = CANVAS_W / 2, cy = CANVAS_H / 2;
    const r0 = 215, r1 = 95, squash = 0.85;
    const n = 720;
    for (let i = 0; i <= n; i++) {
        const a = (i / n) * turns;
        const r = r0 + (r1 - r0) * (a / turns);
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) * squash });
    }
    return { points: pts, shooter: { x: cx, y: cy } };
}

// Level 2, 5, 8 … — a serpentine with the turret below the bottom row.
function serpentineTrack() {
    const pts = [{ x: 60, y: 90 }];
    lineSegment(pts, 60, 90, 560, 90, 120);
    arcSegment(pts, 560, 155, 65, -Math.PI / 2, Math.PI / 2, 60);
    lineSegment(pts, 560, 220, 80, 220, 120);
    arcSegment(pts, 80, 285, 65, -Math.PI / 2, -3 * Math.PI / 2, 60);
    lineSegment(pts, 80, 350, 600, 350, 130);
    return { points: pts, shooter: { x: 320, y: 435 } };
}

// Level 3, 6, 9 … — a near-closed oval with the turret in the middle.
function ovalTrack() {
    const pts = [];
    const cx = CANVAS_W / 2, cy = CANVAS_H / 2;
    const rx = 250, ry = 195;
    const a0 = -Math.PI / 2, sweep = 2 * Math.PI * 0.94;
    const n = 480;
    for (let i = 0; i <= n; i++) {
        const a = a0 + sweep * (i / n);
        pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return { points: pts, shooter: { x: cx, y: cy } };
}

const TRACKS = [spiralTrack, serpentineTrack, ovalTrack];

// Resample a raw polyline at uniform PATH_STEP spacing.
function buildPath(track) {
    const raw = track.points;
    const points = [{ x: raw[0].x, y: raw[0].y }];
    let carry = 0;
    for (let i = 1; i < raw.length; i++) {
        const a = raw[i - 1], b = raw[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (seg <= 1e-9) continue;
        let d = PATH_STEP - carry;
        while (d <= seg) {
            const u = d / seg;
            points.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
            d += PATH_STEP;
        }
        carry = seg - (d - PATH_STEP);
    }
    return { points, length: (points.length - 1) * PATH_STEP, shooter: track.shooter };
}

function pathLength() {
    return path.length;
}

function pointAt(t) {
    const pts = path.points;
    if (!(t > 0)) return { x: pts[0].x, y: pts[0].y };
    if (t >= path.length) {
        const last = pts[pts.length - 1];
        return { x: last.x, y: last.y };
    }
    const f = t / PATH_STEP;
    const i = Math.floor(f);
    const u = f - i;
    const a = pts[i], b = pts[i + 1];
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

function tangentAt(t) {
    const pts = path.points;
    let i = Math.floor(t / PATH_STEP);
    if (!(i >= 0)) i = 0;
    if (i > pts.length - 2) i = pts.length - 2;
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

function levelConfig(n) {
    return {
        colorCount: Math.min(COLORS.length, 3 + Math.floor((n - 1) / 2)),
        marbles: 34 + 6 * (n - 1),
        speed: 26 + 4 * (n - 1),
    };
}

function chainSpeed() {
    return levelConfig(level).speed;
}

function catchupSpeed() {
    return chainSpeed() + CATCHUP_BONUS;
}

// Upcoming colours are drawn from what is still on the track, so a level can
// never become unwinnable by handing out a colour that has already been cleared.
function pickColor() {
    const live = [];
    for (const m of chain) if (!live.includes(m.color)) live.push(m.color);
    const from = live.length ? live : palette;
    return from[Math.floor(Math.random() * from.length)];
}

// ---------------------------------------------------------------------------
// Chain operations
// ---------------------------------------------------------------------------

// Insert a marble at `index`, pushing everything behind it back by SPACING.
function insertAt(index, color) {
    const i = Math.max(0, Math.min(chain.length, index));
    let t;
    if (chain.length === 0) t = 0;
    else if (i === 0) t = chain[0].t;
    else t = chain[i - 1].t - SPACING;

    chain.splice(i, 0, { t, color });
    for (let j = i + 1; j < chain.length; j++) {
        chain[j].t = Math.min(chain[j].t, chain[j - 1].t - SPACING);
    }
    return i;
}

// Pop the run of equal colours containing `index`, if it is long enough.
function resolveMatches(index) {
    if (index < 0 || index >= chain.length) return 0;
    const color = chain[index].color;
    let lo = index, hi = index;
    while (lo > 0 && chain[lo - 1].color === color) lo--;
    while (hi < chain.length - 1 && chain[hi + 1].color === color) hi++;
    const count = hi - lo + 1;
    if (count < MIN_MATCH) return 0;

    for (let i = lo; i <= hi; i++) burst(pointAt(chain[i].t), color);
    chain.splice(lo, count);
    score += count * 10 * comboStep;
    comboStep += 1;
    return count;
}

function hitTest(x, y) {
    let best = -1;
    let bestD = MARBLE_R * 2;
    for (let i = 0; i < chain.length; i++) {
        const p = pointAt(chain[i].t);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

// Which side of marble `k` a projectile at (x, y) arrived on: ahead of it in
// the direction of travel means it belongs in front of `k`.
function insertIndexFor(k, x, y) {
    const p = pointAt(chain[k].t);
    const d = tangentAt(chain[k].t);
    return (x - p.x) * d.x + (y - p.y) * d.y > 0 ? k : k + 1;
}

// New marbles enter at t = 0 whenever the tail has rolled far enough forward.
function spawnFromQueue() {
    while (pending > 0 && (chain.length === 0 || chain[chain.length - 1].t >= SPACING)) {
        chain.push({ t: 0, color: palette[Math.floor(Math.random() * palette.length)] });
        pending -= 1;
    }
}

// The head always advances; everything behind either sits flush against the
// marble in front or rolls forward to close a gap.
//
// A marble only counts as detached once it trails by more than GAP_EPS — the
// head's own advance opens a sub-pixel gap behind every marble on every frame,
// and treating those as real gaps would re-test the whole chain for matches
// continuously. Only a genuine gap (left by a pop, or by a marble entering at
// the tail) arms the junction, and the frame it closes is the frame its match
// is tested.
function marchChain(dt) {
    if (chain.length === 0) return;
    chain[0].t += chainSpeed() * dt;

    const catchup = catchupSpeed() * dt;
    let closed = -1;
    for (let i = 1; i < chain.length; i++) {
        const target = chain[i - 1].t - SPACING;
        const m = chain[i];
        if (target - m.t > GAP_EPS) {
            m.detached = true;
            m.t = Math.min(target, m.t + catchup);
            if (target - m.t <= GAP_EPS) {
                m.t = target;
                m.detached = false;
                if (closed === -1) closed = i;
            }
        } else {
            m.t = target;
            if (m.detached) {
                m.detached = false;
                if (closed === -1) closed = i;
            }
        }
    }
    if (closed !== -1) resolveMatches(closed);
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------

function aimAt(x, y) {
    shooter.angle = Math.atan2(y - shooter.y, x - shooter.x);
}

function shoot() {
    if (state !== 'running') return null;
    if (projectiles.length > 0) return null;
    comboStep = 1;
    const shot = {
        x: shooter.x,
        y: shooter.y,
        vx: Math.cos(shooter.angle) * SHOT_SPEED,
        vy: Math.sin(shooter.angle) * SHOT_SPEED,
        color: shooter.current,
    };
    projectiles.push(shot);
    shooter.current = shooter.next;
    shooter.next = pickColor();
    return shot;
}

function swapMarble() {
    if (state !== 'running') return;
    const held = shooter.current;
    shooter.current = shooter.next;
    shooter.next = held;
}

// Move shots in sub-steps no larger than a marble radius so a fast shot can
// never tunnel through the chain.
function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const s = projectiles[i];
        const dist = Math.hypot(s.vx, s.vy) * dt;
        const steps = Math.max(1, Math.ceil(dist / MARBLE_R));
        let landed = false;
        for (let n = 0; n < steps; n++) {
            s.x += (s.vx * dt) / steps;
            s.y += (s.vy * dt) / steps;
            const k = hitTest(s.x, s.y);
            if (k !== -1) {
                const at = insertIndexFor(k, s.x, s.y);
                const inserted = insertAt(at, s.color);
                resolveMatches(inserted);
                landed = true;
                break;
            }
        }
        const out = s.x < -MARBLE_R * 2 || s.x > CANVAS_W + MARBLE_R * 2 ||
            s.y < -MARBLE_R * 2 || s.y > CANVAS_H + MARBLE_R * 2;
        if (landed || out) projectiles.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    spawnFromQueue();
    marchChain(h);
    updateProjectiles(h);

    if (chain.length && chain[0].t >= pathLength()) {
        endGame();
        return;
    }
    if (pending === 0 && chain.length === 0 && projectiles.length === 0) {
        startLevel(level + 1);
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

function startLevel(n) {
    level = n;
    const cfg = levelConfig(n);
    palette = COLORS.slice(0, cfg.colorCount);
    path = buildPath(TRACKS[(n - 1) % TRACKS.length]());
    chain.length = 0;
    projectiles.length = 0;
    particles.length = 0;
    pending = cfg.marbles;
    comboStep = 1;
    shooter.x = path.shooter.x;
    shooter.y = path.shooter.y;
    shooter.current = pickColor();
    shooter.next = pickColor();
    bannerTimer = 1.6;
    updateHud();
}

function startGame() {
    score = 0;
    state = 'running';
    startLevel(1);
    hideOverlay();
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('marble-loop-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Score ' + score + ' · Level ' + level, 'Press Space to play again', 'Play Again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    marblesEl.textContent = String(pending + chain.length);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreText, sub, buttonText) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = buttonText;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Particles (purely cosmetic)
// ---------------------------------------------------------------------------

function burst(p, color) {
    for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 140;
        particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.45, color });
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
// Rendering
// ---------------------------------------------------------------------------

function drawMarble(x, y, color, r) {
    const skin = MARBLE_SKIN[color] || MARBLE_SKIN.blue;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
    g.addColorStop(0, skin[0]);
    g.addColorStop(0.55, skin[1]);
    g.addColorStop(1, skin[2]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y - r * 0.36, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
}

function drawTrack() {
    const pts = path.points;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 4) ctx.lineTo(pts[i].x, pts[i].y);
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);

    ctx.strokeStyle = 'rgba(103,232,249,0.16)';
    ctx.lineWidth = SPACING + 8;
    ctx.stroke();
    ctx.strokeStyle = '#141f36';
    ctx.lineWidth = SPACING + 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(103,232,249,0.07)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // The pit at the end of the line — it glows redder as the head closes in.
    const end = pointAt(path.length);
    const danger = chain.length ? Math.max(0, Math.min(1, chain[0].t / path.length)) : 0;
    const g = ctx.createRadialGradient(end.x, end.y, 2, end.x, end.y, MARBLE_R * 2.1);
    g.addColorStop(0, '#000000');
    g.addColorStop(1, 'rgba(251,113,133,' + (0.25 + 0.55 * danger).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(end.x, end.y, MARBLE_R * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fb7185';
    ctx.globalAlpha = 0.5 + 0.5 * danger;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(end.x, end.y, MARBLE_R * 1.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function drawShooter() {
    const { x, y, angle } = shooter;

    // Aim guide.
    if (state === 'running') {
        ctx.save();
        ctx.setLineDash([4, 9]);
        ctx.strokeStyle = 'rgba(103,232,249,0.32)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * 30, y + Math.sin(angle) * 30);
        ctx.lineTo(x + Math.cos(angle) * 135, y + Math.sin(angle) * 135);
        ctx.stroke();
        ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#2b3d63';
    ctx.fillRect(0, -7, 30, 14);
    ctx.fillStyle = '#67e8f9';
    ctx.fillRect(24, -7, 6, 14);
    ctx.restore();

    ctx.fillStyle = '#16233c';
    ctx.beginPath();
    ctx.arc(x, y, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2e4571';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawMarble(x, y, shooter.current, MARBLE_R);
    // The queued marble waits behind the barrel.
    drawMarble(x - Math.cos(angle) * 30, y - Math.sin(angle) * 30, shooter.next, MARBLE_R * 0.62);
}

function draw() {
    ctx.fillStyle = '#070c18';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawTrack();

    for (const m of chain) {
        const p = pointAt(m.t);
        drawMarble(p.x, p.y, m.color, MARBLE_R);
    }

    for (const s of projectiles) drawMarble(s.x, s.y, s.color, MARBLE_R);

    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / 0.45);
        ctx.fillStyle = (MARBLE_SKIN[p.color] || MARBLE_SKIN.blue)[0];
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    drawShooter();

    if (bannerTimer > 0 && state === 'running') {
        ctx.globalAlpha = Math.min(1, bannerTimer);
        ctx.fillStyle = '#67e8f9';
        ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('LEVEL ' + level, CANVAS_W / 2, 46);
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
    }
}

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    if (state === 'running') {
        step(dt);
        if (bannerTimer > 0) bannerTimer -= dt;
    }
    updateParticles(dt);
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
    if (k === 'r' || k === 'R') {
        startGame();
        e.preventDefault();
        return;
    }
    if (k === 's' || k === 'S') {
        swapMarble();
        e.preventDefault();
        return;
    }
    if (k === ' ' || k === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') shoot();
        e.preventDefault();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const p = canvasCoords(e);
    aimAt(p.x, p.y);
});

canvas.addEventListener('mousedown', (e) => {
    if (state === 'idle' || state === 'over') { startGame(); return; }
    const p = canvasCoords(e);
    aimAt(p.x, p.y);
    shoot();
});

canvas.addEventListener('touchmove', (e) => {
    if (!e.touches.length) return;
    const p = canvasCoords(e.touches[0]);
    aimAt(p.x, p.y);
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchstart', (e) => {
    if (!e.touches.length) return;
    if (state === 'idle' || state === 'over') { startGame(); return; }
    const p = canvasCoords(e.touches[0]);
    aimAt(p.x, p.y);
    shoot();
    e.preventDefault();
}, { passive: false });

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('marble-loop-best') || '0', 10) || 0;
score = 0;
startLevel(1);
state = 'idle';
bannerTimer = 0;
updateHud();
requestAnimationFrame(frame);
