// ---------------------------------------------------------------------------
// Marble Serpent — a path marble shooter on an HTML5 canvas.
//
// A serpent of coloured marbles crawls along a fixed winding track toward a pit
// at its end. A cannon parked inside the coils fires marbles into the line;
// three or more of a colour pop, the tail sprints forward to close the gap, and
// colours that meet again pop for a multiplied combo.
//
// Written as a single classic (non-module) script so that game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per-second and advanced
// through `step(dt)`, so tests can simulate frames deterministically without
// depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 720;
const CANVAS_H = 520;

// --- Marbles ---
const MARBLE_R = 13;
const MARBLE_SPACING = 26;   // centre-to-centre distance of touching marbles
const EPS = 0.001;

// --- Motion ---
const CHAIN_BASE_SPEED = 26; // px/s the head crawls at on level 1
const CHAIN_LEVEL_SPEED = 5; // extra px/s per level
const CATCHUP_SPEED = 260;   // px/s a detached tail uses to rejoin
const SHOT_SPEED = 620;      // px/s of a fired marble
const AIM_SPEED = 2.2;       // rad/s of keyboard aiming

// --- Rules ---
const MIN_MATCH = 3;
const POINTS_PER_MARBLE = 10;
const LEVEL_BONUS = 200;
const START_LIVES = 3;
const BARREL_LEN = 30;

const COLORS = ['#ff4d5e', '#ffd24d', '#4dd2ff', '#7bff8a', '#c77bff', '#ff9c4d'];

// --- Track control points (smoothed into a polyline below) ---
const TRACK_POINTS = [
    [-60, 80], [150, 55], [380, 60], [570, 78], [682, 148], [600, 212],
    [400, 205], [215, 208], [110, 268], [195, 338], [400, 336], [582, 322],
    [676, 392],
];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state = 'idle';
let score = 0;
let best = 0;
let level = 1;
let lives = START_LIVES;
let comboLevel = 1;

const marbles = [];   // ordered front (nearest the pit) first, `d` descending
const shots = [];
const queue = [];     // colours still waiting to emerge from the mouth
const particles = [];
const popups = [];
const keys = Object.create(null);

const shooter = { x: 300, y: 462, angle: -Math.PI / 2, current: COLORS[0], next: COLORS[1] };

// ---------------------------------------------------------------------------
// The track
//
// The control points are smoothed with a Catmull-Rom spline, sampled into a
// dense polyline, and turned into a cumulative arc-length table so that any
// distance along the track maps to a point.
// ---------------------------------------------------------------------------

const trackPolyline = buildTrackPolyline();
const trackLengths = buildLengthTable(trackPolyline);

function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return [0, 1].map((axis) => 0.5 * (
        2 * p1[axis] +
        (-p0[axis] + p2[axis]) * t +
        (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2 +
        (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3
    ));
}

function buildTrackPolyline() {
    const pts = TRACK_POINTS;
    const out = [];
    const SAMPLES = 40;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        for (let s = 0; s < SAMPLES; s++) {
            const [x, y] = catmullRom(p0, p1, p2, p3, s / SAMPLES);
            out.push({ x, y });
        }
    }
    out.push({ x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] });
    return out;
}

function buildLengthTable(poly) {
    const lengths = [0];
    for (let i = 1; i < poly.length; i++) {
        lengths.push(lengths[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y));
    }
    return lengths;
}

function pathLength() {
    return trackLengths[trackLengths.length - 1];
}

function pathPoint(d) {
    const total = pathLength();
    if (d <= 0) return { x: trackPolyline[0].x, y: trackPolyline[0].y };
    if (d >= total) {
        const last = trackPolyline[trackPolyline.length - 1];
        return { x: last.x, y: last.y };
    }
    // binary search for the polyline segment containing `d`
    let lo = 0;
    let hi = trackLengths.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (trackLengths[mid] <= d) lo = mid; else hi = mid;
    }
    const segLen = trackLengths[hi] - trackLengths[lo] || 1;
    const t = (d - trackLengths[lo]) / segLen;
    const a = trackPolyline[lo];
    const b = trackPolyline[hi];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function pathAngle(d) {
    const a = pathPoint(Math.max(0, d - 2));
    const b = pathPoint(Math.min(pathLength(), d + 2));
    return Math.atan2(b.y - a.y, b.x - a.x);
}

// ---------------------------------------------------------------------------
// Difficulty (pure functions of `level`)
// ---------------------------------------------------------------------------

function chainSpeed() {
    return CHAIN_BASE_SPEED + (level - 1) * CHAIN_LEVEL_SPEED;
}

function colorsForLevel(l) {
    return Math.min(3 + Math.floor((l - 1) / 2), COLORS.length);
}

function queueSizeForLevel(l) {
    return 32 + 6 * (l - 1);
}

// ---------------------------------------------------------------------------
// Cannon
// ---------------------------------------------------------------------------

function pickPlayableColor() {
    const inPlay = new Set();
    for (const m of marbles) inPlay.add(m.color);
    for (const c of queue) inPlay.add(c);
    const pool = inPlay.size ? [...inPlay] : COLORS.slice(0, colorsForLevel(level));
    return pool[Math.floor(Math.random() * pool.length)];
}

function reloadCannon() {
    shooter.current = shooter.next;
    shooter.next = pickPlayableColor();
}

function swapMarble() {
    const held = shooter.current;
    shooter.current = shooter.next;
    shooter.next = held;
}

function aimAt(x, y) {
    shooter.angle = Math.atan2(y - shooter.y, x - shooter.x);
}

function shoot() {
    if (state !== 'running') return null;
    const cos = Math.cos(shooter.angle);
    const sin = Math.sin(shooter.angle);
    const shot = {
        x: shooter.x + cos * BARREL_LEN,
        y: shooter.y + sin * BARREL_LEN,
        vx: cos * SHOT_SPEED,
        vy: sin * SHOT_SPEED,
        color: shooter.current,
    };
    shots.push(shot);
    reloadCannon();
    return shot;
}

// ---------------------------------------------------------------------------
// The serpent
// ---------------------------------------------------------------------------

function touching(a, b) {
    return marbles[a].d - marbles[b].d <= MARBLE_SPACING + 0.5;
}

function findRun(index) {
    const color = marbles[index].color;
    let start = index;
    let end = index;
    while (start > 0 && marbles[start - 1].color === color && touching(start - 1, start)) start--;
    while (end < marbles.length - 1 && marbles[end + 1].color === color && touching(end, end + 1)) end++;
    return { start, length: end - start + 1 };
}

function resolveMatchAt(index, combo) {
    if (index < 0 || index >= marbles.length) return 0;
    const multiplier = combo === undefined ? comboLevel : combo;
    const run = findRun(index);
    if (run.length < MIN_MATCH) return 0;
    const removed = marbles.splice(run.start, run.length);
    // The marble now at the front of the severed tail is the one chasing the
    // gap; when it catches up, that junction is checked for a cascade.
    if (run.start > 0 && run.start < marbles.length) marbles[run.start].chasing = true;
    const gained = run.length * POINTS_PER_MARBLE * multiplier;
    score += gained;
    comboLevel = multiplier;
    for (const m of removed) burst(pathPoint(m.d), m.color);
    const mid = pathPoint(removed[Math.floor(removed.length / 2)].d);
    popups.push({
        x: mid.x,
        y: mid.y,
        life: 1,
        text: multiplier > 1 ? `x${multiplier}  +${gained}` : `+${gained}`,
        color: removed[0].color,
    });
    updateHud();
    return run.length;
}

// Splices a marble into the chain at array index `index`. Existing marbles are
// only ever pushed backwards; a shot never drives the serpent forward. The one
// exception is a marble landing ahead of the head, which has nowhere to go but
// the slot in front of it.
function insertMarble(color, index) {
    const k = Math.max(0, Math.min(index, marbles.length));
    let d;
    if (!marbles.length) d = 0;
    else if (k === 0) d = marbles[0].d + MARBLE_SPACING;
    else d = marbles[k - 1].d - MARBLE_SPACING;

    marbles.splice(k, 0, { d, color });
    for (let j = k + 1; j < marbles.length; j++) {
        marbles[j].d = Math.min(marbles[j].d, marbles[j - 1].d - MARBLE_SPACING);
    }
    comboLevel = 1;
    resolveMatchAt(k, 1);
    return k;
}

function updateChain(dt) {
    if (!marbles.length) return;
    marbles[0].d += chainSpeed() * dt;

    // Because the head crawls every frame, every marble behind it is fractionally
    // adrift on every frame. A junction therefore only counts when the marble was
    // explicitly marked as chasing a gap torn open by a pop — geometry alone
    // would fire a match check on every frame, and marbles trailing in from the
    // mouth would pop without the player ever touching them.
    const closed = [];
    for (let i = 1; i < marbles.length; i++) {
        const lead = marbles[i - 1].d - MARBLE_SPACING;
        const m = marbles[i];
        if (m.d < lead - EPS) {
            m.d = Math.min(lead, m.d + CATCHUP_SPEED * dt);
        } else {
            m.d = lead;
        }
        if (m.chasing && m.d >= lead - EPS) {
            m.chasing = false;
            closed.push(i);
        }
    }
    // Back to front, so that a removal never invalidates a pending index.
    for (let i = closed.length - 1; i >= 0; i--) {
        if (!resolveMatchAt(closed[i], comboLevel + 1)) comboLevel = 1;
    }
}

// New marbles always emerge from the mouth at the start of the track, and only
// once the previous one has cleared it. If the tail has already crawled ahead,
// the newcomer sprints after it under the catch-up rule in `updateChain`.
function spawnFromQueue() {
    if (!queue.length) return;
    const tail = marbles[marbles.length - 1];
    if (!tail || tail.d >= MARBLE_SPACING) {
        marbles.push({ d: 0, color: queue.shift(), chasing: false });
    }
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

function tryHit(shot) {
    let best_ = -1;
    let bestDist = Infinity;
    for (let i = 0; i < marbles.length; i++) {
        const p = pathPoint(marbles[i].d);
        const dist = Math.hypot(p.x - shot.x, p.y - shot.y);
        if (dist < MARBLE_R * 2 && dist < bestDist) {
            bestDist = dist;
            best_ = i;
        }
    }
    if (best_ < 0) return false;

    const m = marbles[best_];
    const ahead = pathPoint(m.d + MARBLE_SPACING);
    const behind = pathPoint(m.d - MARBLE_SPACING);
    const dAhead = Math.hypot(ahead.x - shot.x, ahead.y - shot.y);
    const dBehind = Math.hypot(behind.x - shot.x, behind.y - shot.y);
    insertMarble(shot.color, dAhead < dBehind ? best_ : best_ + 1);
    return true;
}

function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        // sub-step so a fast marble cannot tunnel through the chain
        const sub = Math.max(1, Math.ceil((SHOT_SPEED * dt) / MARBLE_R));
        let hit = false;
        for (let k = 0; k < sub && !hit; k++) {
            s.x += (s.vx * dt) / sub;
            s.y += (s.vy * dt) / sub;
            hit = tryHit(s);
        }
        if (hit || s.x < -40 || s.x > CANVAS_W + 40 || s.y < -40 || s.y > CANVAS_H + 40) {
            shots.splice(i, 1);
        }
    }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function burst(p, color) {
    for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 120;
        particles.push({
            x: p.x, y: p.y,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 0.4 + Math.random() * 0.3,
            color,
        });
    }
}

function updateEffects(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 220 * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i--) {
        popups[i].y -= 26 * dt;
        popups[i].life -= dt;
        if (popups[i].life <= 0) popups.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Level flow
// ---------------------------------------------------------------------------

function resetLevel() {
    marbles.length = 0;
    shots.length = 0;
    queue.length = 0;
    comboLevel = 1;
    const palette = colorsForLevel(level);
    for (let i = 0; i < queueSizeForLevel(level); i++) {
        queue.push(COLORS[Math.floor(Math.random() * palette)]);
    }
    shooter.current = pickPlayableColor();
    shooter.next = pickPlayableColor();
    shooter.angle = -Math.PI / 2;
}

function nextLevel() {
    level++;
    score += LEVEL_BONUS;
    resetLevel();
    popups.push({ x: CANVAS_W / 2, y: 250, life: 2, text: `LEVEL ${level}  +${LEVEL_BONUS}`, color: '#4dd2ff' });
    updateHud();
}

function loseLife() {
    lives--;
    const pit = pathPoint(pathLength());
    burst(pit, '#ffffff');
    popups.push({ x: pit.x, y: pit.y - 34, life: 2, text: 'LIFE LOST', color: '#f87171' });
    updateHud();
    if (lives <= 0) {
        endGame();
        return;
    }
    resetLevel();
}

function checkPit() {
    if (marbles.length && marbles[0].d >= pathLength()) loseLife();
}

function checkLevelClear() {
    if (!marbles.length && !queue.length) nextLevel();
}

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    lives = START_LIVES;
    particles.length = 0;
    popups.length = 0;
    resetLevel();
    hideOverlay();
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem('marble-serpent-best', String(best));
        } catch (e) { /* storage unavailable — keep the in-memory best */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} — Level ${level}`, 'Press Space or click to try again', 'Play Again');
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
// Frame
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    if (keys.ArrowLeft) shooter.angle -= AIM_SPEED * dt;
    if (keys.ArrowRight) shooter.angle += AIM_SPEED * dt;
    updateChain(dt);
    spawnFromQueue();
    updateShots(dt);
    updateEffects(dt);
    checkPit();
    if (state !== 'running') return;
    checkLevelClear();
    updateHud();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
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

function drawTrack() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(trackPolyline[0].x, trackPolyline[0].y);
    for (let i = 1; i < trackPolyline.length; i++) ctx.lineTo(trackPolyline[i].x, trackPolyline[i].y);
    ctx.strokeStyle = '#101a30';
    ctx.lineWidth = 36;
    ctx.stroke();
    ctx.strokeStyle = '#18243f';
    ctx.lineWidth = 28;
    ctx.stroke();
    ctx.setLineDash([2, 16]);
    ctx.strokeStyle = 'rgba(126, 155, 214, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawPit() {
    const p = pathPoint(pathLength());
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 26);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.7, '#160a1c');
    g.addColorStop(1, '#3b1b46');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 3;
    ctx.stroke();

    const mouth = pathPoint(0);
    ctx.fillStyle = '#0a1020';
    ctx.beginPath();
    ctx.arc(mouth.x, mouth.y, 22, 0, Math.PI * 2);
    ctx.fill();
}

function drawMarble(x, y, color, r) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, color);
    g.addColorStop(1, shade(color, -0.45));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const r = clamp(((n >> 16) & 255) * (1 + amount));
    const g = clamp(((n >> 8) & 255) * (1 + amount));
    const b = clamp((n & 255) * (1 + amount));
    return `rgb(${r}, ${g}, ${b})`;
}

function drawSerpent() {
    for (let i = marbles.length - 1; i >= 0; i--) {
        const m = marbles[i];
        if (m.d < -MARBLE_R) continue;
        const p = pathPoint(m.d);
        drawMarble(p.x, p.y, m.color, MARBLE_R);
    }
    // a warning glow when the head is closing on the pit
    if (marbles.length) {
        const remaining = pathLength() - marbles[0].d;
        if (remaining < 160) {
            const p = pathPoint(marbles[0].d);
            ctx.strokeStyle = `rgba(248, 113, 113, ${0.7 * (1 - remaining / 160)})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, MARBLE_R + 5, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

function drawCannon() {
    ctx.save();
    ctx.translate(shooter.x, shooter.y);
    ctx.rotate(shooter.angle);
    ctx.fillStyle = '#2b3a5f';
    ctx.strokeStyle = '#4a6096';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(0, -9, BARREL_LEN + 14, 18, 6);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#1b2742';
    ctx.strokeStyle = '#4a6096';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(shooter.x, shooter.y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawMarble(shooter.x, shooter.y, shooter.current, MARBLE_R);

    // the marble waiting behind the loaded one
    ctx.globalAlpha = 0.8;
    drawMarble(shooter.x - 34, shooter.y + 16, shooter.next, MARBLE_R - 3);
    ctx.globalAlpha = 1;
}

function drawAimGuide() {
    ctx.fillStyle = 'rgba(226, 232, 240, 0.35)';
    for (let i = 1; i <= 7; i++) {
        const t = BARREL_LEN + i * 26;
        ctx.beginPath();
        ctx.arc(shooter.x + Math.cos(shooter.angle) * t, shooter.y + Math.sin(shooter.angle) * t, 2.5 - i * 0.2, 0, Math.PI * 2);
        ctx.fill();
    }
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    const bg = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    bg.addColorStop(0, '#0b1020');
    bg.addColorStop(1, '#080d18');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawTrack();
    drawPit();
    drawSerpent();

    for (const s of shots) drawMarble(s.x, s.y, s.color, MARBLE_R);

    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life * 2);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const t of popups) {
        ctx.globalAlpha = Math.max(0, Math.min(1, t.life));
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';

    if (state === 'running' || state === 'paused') drawAimGuide();
    drawCannon();

    // remaining marbles for the level
    ctx.fillStyle = '#7b89a8';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`Left ${queue.length + marbles.length}`, 12, CANVAS_H - 12);
}

let lastTime = 0;
function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000 || 0);
    lastTime = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function canvasPos(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((evt.clientX - rect.left) / rect.width) * CANVAS_W,
        y: ((evt.clientY - rect.top) / rect.height) * CANVAS_H,
    };
}

canvas.addEventListener('mousemove', (evt) => {
    const p = canvasPos(evt);
    aimAt(p.x, p.y);
});

canvas.addEventListener('click', (evt) => {
    if (state === 'idle' || state === 'over') {
        startGame();
        return;
    }
    const p = canvasPos(evt);
    aimAt(p.x, p.y);
    shoot();
});

window.addEventListener('keydown', (evt) => {
    if (['ArrowLeft', 'ArrowRight', 'Space'].includes(evt.code)) evt.preventDefault();
    keys[evt.code] = true;
    if (evt.code === 'Space') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') shoot();
    } else if (evt.code === 'KeyP') {
        togglePause();
    } else if (evt.code === 'KeyS') {
        if (state === 'running') swapMarble();
    }
});

window.addEventListener('keyup', (evt) => {
    keys[evt.code] = false;
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(function boot() {
    let stored = null;
    try {
        stored = window.localStorage.getItem('marble-serpent-best');
    } catch (e) { /* storage unavailable */ }
    best = stored ? parseInt(stored, 10) || 0 : 0;
    updateHud();
    requestAnimationFrame(frame);
})();
