// ---------------------------------------------------------------------------
// Marble Popper — a Zuma-style path-chain marble shooter on an HTML5 canvas.
//
// A chain of coloured marbles crawls along a fixed inward spiral toward a pit at
// its centre. The player sits in the middle, aims a launcher and fires marbles
// into the chain; three or more touching marbles of one colour pop. Clear the
// whole chain before its head falls into the pit.
//
// Written as a single classic (non-module) script so the state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom, Snake
// and Tetris in this repo. Motion is expressed per-second and advanced through
// `step(dt)` in fixed sub-steps, so tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 720;
const CANVAS_H = 520;

// --- Spiral track ---
const SPIRAL_CX = 360;         // centre of the spiral (and of the launcher)
const SPIRAL_CY = 250;
const SPIRAL_R0 = 235;         // radius where the chain enters
const SPIRAL_R1 = 70;          // radius at the pit
const SPIRAL_TURNS = 2.25;
const PATH_SAMPLES = 4000;

// --- Marbles ---
const BALL_R = 14;
const BALL_D = 28;             // spacing between marbles along the track
const TOUCH_SLACK = 0.5;       // tolerance when deciding "these two touch"
const CATCH_SPEED = 260;       // px/s a detached tail uses to close a gap

// --- Launcher ---
const LAUNCHER = { x: SPIRAL_CX, y: SPIRAL_CY };
const LAUNCHER_R = 18;
const SHOT_SPEED = 700;        // px/s
const AIM_SPEED = 2.6;         // rad/s when rotating with the arrow keys
const FIRE_COOLDOWN = 0.16;    // seconds between player-driven shots

// --- Scoring ---
const POINTS_PER_BALL = 10;
const LEVEL_BONUS = 100;

// --- Presentation ---
const DANGER_LEN = 160;         // track length before the pit shown as danger

// --- Palette (colour index -> fill / highlight) ---
const PALETTE = [
    { fill: '#ef4444', lit: '#fca5a5' },
    { fill: '#3b82f6', lit: '#93c5fd' },
    { fill: '#22c55e', lit: '#86efac' },
    { fill: '#eab308', lit: '#fde047' },
    { fill: '#a855f7', lit: '#d8b4fe' },
    { fill: '#06b6d4', lit: '#67e8f9' },
];

// --- Difficulty scaling (all pure functions of `level`) ---
function colorCount(lvl) { return Math.min(3 + Math.floor((lvl - 1) / 2), PALETTE.length); }
function chainLength(lvl) { return 24 + 6 * (lvl - 1); }
function chainSpeed(lvl) { return 26 + 4 * (lvl - 1); }

// ---------------------------------------------------------------------------
// The track
//
// The spiral is sampled into a polyline with cumulative arc lengths, so a
// position on the track is a single scalar `d` (pixels travelled from the
// entrance) and `pathPos(d)` maps it back to canvas coordinates.
// ---------------------------------------------------------------------------

const PATH = buildPath();
const PATH_LEN = PATH[PATH.length - 1].d;
const PIT = { x: PATH[PATH.length - 1].x, y: PATH[PATH.length - 1].y };

function buildPath() {
    const pts = [];
    const maxAngle = SPIRAL_TURNS * Math.PI * 2;
    for (let i = 0; i <= PATH_SAMPLES; i++) {
        const t = i / PATH_SAMPLES;
        const a = t * maxAngle;
        const r = SPIRAL_R0 - t * (SPIRAL_R0 - SPIRAL_R1);
        const x = SPIRAL_CX + Math.cos(a) * r;
        const y = SPIRAL_CY + Math.sin(a) * r;
        const d = i === 0 ? 0 : pts[i - 1].d + Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y);
        pts.push({ x, y, d });
    }
    return pts;
}

// Binary search the sampled polyline, then interpolate within the segment.
function pathPos(d) {
    if (d <= 0) return { x: PATH[0].x, y: PATH[0].y };
    if (d >= PATH_LEN) return { x: PIT.x, y: PIT.y };
    let lo = 0, hi = PATH.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (PATH[mid].d <= d) lo = mid; else hi = mid;
    }
    const a = PATH[lo], b = PATH[hi];
    const span = b.d - a.d;
    const t = span > 0 ? (d - a.d) / span : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Heading of the track at `d`, used to orient the marble highlights.
function pathAngle(d) {
    const a = pathPos(Math.max(0, d - 2));
    const b = pathPos(Math.min(PATH_LEN, d + 2));
    return Math.atan2(b.y - a.y, b.x - a.x);
}

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
let state = 'idle';
let score = 0;
let best = 0;
let level = 1;
let fireTimer = 0;

const balls = [];          // front-first: balls[0] is nearest the pit
const shots = [];          // marbles in flight
const spawnQueue = [];     // colours still waiting to enter the track
const pops = [];           // cosmetic pop flashes
const launcher = { angle: -Math.PI / 2, spin: 0, current: 0, next: 0 };

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

function randomColor() {
    return Math.floor(Math.random() * colorCount(level));
}

// Prefer a colour that is still somewhere in play so the launcher never hands
// the player a marble that can no longer match anything.
function pickLoadColor() {
    const live = new Set();
    for (const b of balls) live.add(b.color);
    for (const c of spawnQueue) live.add(c);
    if (live.size === 0) return randomColor();
    const arr = Array.from(live);
    return arr[Math.floor(Math.random() * arr.length)];
}

function reloadLauncher() {
    launcher.current = pickLoadColor();
    launcher.next = pickLoadColor();
}

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------

// Test/debug hook: lay a chain of colours on the track with `startD` as the
// front marble, and clear the spawn queue so the board is fully determined.
function setChain(colors, startD) {
    balls.length = 0;
    for (let i = 0; i < colors.length; i++) {
        balls.push({ color: colors[i], d: startD - i * BALL_D });
    }
    spawnQueue.length = 0;
    return balls;
}

function touching(a, b) {
    return Math.abs(a.d - b.d) <= BALL_D + TOUCH_SLACK;
}

// The run of same-coloured, touching marbles containing `index`.
function matchRun(index) {
    const color = balls[index].color;
    let start = index, end = index;
    while (start > 0 && balls[start - 1].color === color && touching(balls[start - 1], balls[start])) start--;
    while (end < balls.length - 1 && balls[end + 1].color === color && touching(balls[end], balls[end + 1])) end++;
    return { start, end, len: end - start + 1 };
}

// Insert `color` next to `index`. `side` is 'front' (toward the pit) or 'back'.
// Marbles behind the insertion point are pushed back by one diameter, so a shot
// never shoves the chain's head closer to the pit. Returns marbles popped.
function insertBall(index, color, side) {
    const at = side === 'front' ? index : index + 1;
    const d = side === 'front' ? balls[index].d : balls[index].d - BALL_D;
    for (let i = at; i < balls.length; i++) balls[i].d -= BALL_D;
    balls.splice(at, 0, { color, d });
    return resolveMatches(at);
}

// Pop the run around `index`, then keep resolving combos: if the marbles either
// side of the fresh gap share a colour and would make a run once the gap closes,
// snap the tail forward and pop again with a higher multiplier.
function resolveMatches(index) {
    let run = matchRun(index);
    if (run.len < 3) return 0;

    let combo = 1;
    let total = 0;
    let at = run.start;

    while (true) {
        addPops(run.start, run.end);
        balls.splice(run.start, run.end - run.start + 1);
        score += run.len * POINTS_PER_BALL * combo;
        total += run.len;

        const front = at - 1, back = at;   // marbles now facing each other
        if (front < 0 || back >= balls.length) break;
        if (balls[front].color !== balls[back].color) break;

        // Would the two sections make a run of three once the gap closes?
        const a = matchRun(front), b = matchRun(back);
        if (a.len + b.len < 3) break;

        // Snap the tail forward onto the marbles ahead of it.
        const shift = balls[front].d - BALL_D - balls[back].d;
        for (let i = back; i < balls.length; i++) balls[i].d += shift;

        combo++;
        run = matchRun(front);
        at = run.start;
    }

    updateHud();
    return total;
}

function addPops(start, end) {
    for (let i = start; i <= end; i++) {
        const p = pathPos(balls[i].d);
        pops.push({ x: p.x, y: p.y, color: balls[i].color, life: 0.3 });
    }
}

// ---------------------------------------------------------------------------
// Aiming and firing
// ---------------------------------------------------------------------------

function aimAt(x, y) {
    launcher.angle = Math.atan2(y - LAUNCHER.y, x - LAUNCHER.x);
}

function swapBall() {
    const t = launcher.current;
    launcher.current = launcher.next;
    launcher.next = t;
}

function shoot() {
    if (state !== 'running') return null;
    const shot = {
        x: LAUNCHER.x + Math.cos(launcher.angle) * LAUNCHER_R,
        y: LAUNCHER.y + Math.sin(launcher.angle) * LAUNCHER_R,
        vx: Math.cos(launcher.angle) * SHOT_SPEED,
        vy: Math.sin(launcher.angle) * SHOT_SPEED,
        color: launcher.current,
    };
    shots.push(shot);
    launcher.current = launcher.next;
    launcher.next = pickLoadColor();
    fireTimer = FIRE_COOLDOWN;
    return shot;
}

// Player-driven fire, rate limited so a held key/mouse doesn't spray.
function tryShoot() {
    if (fireTimer > 0) return null;
    return shoot();
}

// Decide which side of `index` an impact at (x, y) belongs on.
function insertSide(index, x, y) {
    const ahead = pathPos(balls[index].d + BALL_D);
    const behind = pathPos(balls[index].d - BALL_D);
    const dAhead = Math.hypot(x - ahead.x, y - ahead.y);
    const dBehind = Math.hypot(x - behind.x, y - behind.y);
    return dAhead <= dBehind ? 'front' : 'back';
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function releaseFromQueue() {
    if (spawnQueue.length === 0) return;
    const rear = balls[balls.length - 1];
    if (balls.length === 0 || rear.d >= BALL_D) {
        balls.push({ color: spawnQueue.shift(), d: 0 });
    }
}

function advanceChain(h) {
    if (balls.length === 0) return;
    balls[0].d += chainSpeed(level) * h;
    for (let i = 1; i < balls.length; i++) {
        const target = balls[i - 1].d - BALL_D;
        balls[i].d = Math.min(target, balls[i].d + CATCH_SPEED * h);
    }
}

function advanceShots(h) {
    for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.x += s.vx * h;
        s.y += s.vy * h;

        let hit = -1;
        for (let j = 0; j < balls.length; j++) {
            if (balls[j].d < 0) continue;
            const p = pathPos(balls[j].d);
            if (Math.hypot(s.x - p.x, s.y - p.y) <= BALL_R * 2) { hit = j; break; }
        }

        if (hit >= 0) {
            shots.splice(i, 1);
            insertBall(hit, s.color, insertSide(hit, s.x, s.y));
            continue;
        }

        const m = BALL_R;
        if (s.x < -m || s.x > CANVAS_W + m || s.y < -m || s.y > CANVAS_H + m) shots.splice(i, 1);
    }
}

function substep(h) {
    if (launcher.spin !== 0) launcher.angle += launcher.spin * AIM_SPEED * h;
    if (fireTimer > 0) fireTimer = Math.max(0, fireTimer - h);

    releaseFromQueue();
    advanceChain(h);
    advanceShots(h);

    if (balls.length > 0 && balls[0].d >= PATH_LEN) { endGame(); return; }
    if (balls.length === 0 && spawnQueue.length === 0 && shots.length === 0) nextLevel();
}

// Advance the simulation in small fixed sub-steps so fast shots can never
// tunnel through the chain and the integration is frame-rate independent.
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
    updatePops(dt);
    updateHud();
}

function updatePops(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].life -= dt;
        if (pops[i].life <= 0) pops.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function fillQueue() {
    spawnQueue.length = 0;
    const colors = colorCount(level);
    for (let i = 0; i < chainLength(level); i++) {
        spawnQueue.push(Math.floor(Math.random() * colors));
    }
}

function startLevel() {
    balls.length = 0;
    shots.length = 0;
    fillQueue();
    reloadLauncher();
    fireTimer = 0;
}

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    pops.length = 0;
    launcher.angle = -Math.PI / 2;
    launcher.spin = 0;
    startLevel();
    hideOverlay();
    updateHud();
}

function nextLevel() {
    score += LEVEL_BONUS * level;
    level += 1;
    startLevel();
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    saveBest();
    showOverlay('Game Over', 'Score ' + score + ' · Level ' + level,
        'Press Space to play again', 'Play Again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', 'Score ' + score, 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function loadBest() {
    try {
        best = Number(localStorage.getItem('marble-popper-best')) || 0;
    } catch (e) {
        best = 0;
    }
    updateHud();
}

function saveBest() {
    if (score <= best) return;
    best = score;
    try { localStorage.setItem('marble-popper-best', String(best)); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    remainingEl.textContent = String(balls.length + spawnQueue.length);
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
// Rendering
// ---------------------------------------------------------------------------

function drawTrack() {
    ctx.strokeStyle = '#132433';
    ctx.lineWidth = BALL_D + 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < PATH.length; i += 8) {
        const p = PATH[i];
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(PIT.x, PIT.y);
    ctx.stroke();

    ctx.strokeStyle = '#0d1b27';
    ctx.lineWidth = 2;
    ctx.stroke();

    // The last stretch before the pit is tinted as a warning.
    ctx.strokeStyle = 'rgba(127, 29, 29, 0.55)';
    ctx.lineWidth = BALL_D + 6;
    ctx.beginPath();
    for (let d = Math.max(0, PATH_LEN - DANGER_LEN); d <= PATH_LEN; d += 6) {
        const p = pathPos(d);
        if (d === Math.max(0, PATH_LEN - DANGER_LEN)) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
}

function drawPit() {
    const g = ctx.createRadialGradient(PIT.x, PIT.y, 2, PIT.x, PIT.y, 22);
    g.addColorStop(0, '#000');
    g.addColorStop(1, '#241019');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(PIT.x, PIT.y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7f1d1d';
    ctx.lineWidth = 3;
    ctx.stroke();
}

function drawMarble(x, y, color, angle) {
    const c = PALETTE[color % PALETTE.length];
    ctx.fillStyle = c.fill;
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = c.lit;
    ctx.beginPath();
    ctx.arc(x - Math.cos(angle || 0) * 4 - 3, y - Math.sin(angle || 0) * 4 - 3, BALL_R * 0.38, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.stroke();
}

function drawLauncher() {
    const tipX = LAUNCHER.x + Math.cos(launcher.angle) * (LAUNCHER_R + 14);
    const tipY = LAUNCHER.y + Math.sin(launcher.angle) * (LAUNCHER_R + 14);

    // Aim guide.
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.35)';
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(LAUNCHER.x, LAUNCHER.y);
    ctx.lineTo(LAUNCHER.x + Math.cos(launcher.angle) * 300, LAUNCHER.y + Math.sin(launcher.angle) * 300);
    ctx.stroke();
    ctx.setLineDash([]);

    // Barrel.
    ctx.strokeStyle = '#4b6b80';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(LAUNCHER.x, LAUNCHER.y);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Body plus the loaded marble.
    ctx.fillStyle = '#1b3346';
    ctx.beginPath();
    ctx.arc(LAUNCHER.x, LAUNCHER.y, LAUNCHER_R + 6, 0, Math.PI * 2);
    ctx.fill();
    if (state !== 'idle') drawMarble(LAUNCHER.x, LAUNCHER.y, launcher.current, launcher.angle);
}

// The on-deck marble sits in its own corner slot, clear of the track and pit.
function drawOnDeck() {
    if (state === 'idle') return;
    const x = 44, y = CANVAS_H - 44;
    ctx.fillStyle = '#0f1d29';
    ctx.beginPath();
    ctx.arc(x, y, BALL_R + 8, 0, Math.PI * 2);
    ctx.fill();
    drawMarble(x, y, launcher.next, 0);
    ctx.fillStyle = '#7a91a3';
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NEXT', x, y + BALL_R + 20);
    ctx.textAlign = 'left';
}

function draw() {
    ctx.fillStyle = '#071019';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawTrack();
    drawPit();

    for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (b.d < 0) continue;
        const p = pathPos(b.d);
        drawMarble(p.x, p.y, b.color, pathAngle(b.d));
    }

    for (const s of shots) drawMarble(s.x, s.y, s.color, 0);

    for (const p of pops) {
        const t = Math.max(0, p.life / 0.3);
        ctx.globalAlpha = t;
        ctx.strokeStyle = PALETTE[p.color % PALETTE.length].lit;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, BALL_R + (1 - t) * 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    drawLauncher();
    drawOnDeck();

    // Danger flash when the head of the chain is close to the pit.
    if (state === 'running' && balls.length > 0 && balls[0].d > PATH_LEN - DANGER_LEN) {
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, CANVAS_W - 6, CANVAS_H - 6);
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function canvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (evt.clientX - rect.left) * (CANVAS_W / rect.width),
        y: (evt.clientY - rect.top) * (CANVAS_H / rect.height),
    };
}

canvas.addEventListener('mousemove', (e) => {
    const p = canvasPoint(e);
    aimAt(p.x, p.y);
});

canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) { swapBall(); return; }
    if (state === 'idle' || state === 'over') { startGame(); return; }
    const p = canvasPoint(e);
    aimAt(p.x, p.y);
    tryShoot();
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause(); else startGame();
});

window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft') { launcher.spin = -1; e.preventDefault(); return; }
    if (k === 'ArrowRight') { launcher.spin = 1; e.preventDefault(); return; }
    if (k === 'p' || k === 'P') { togglePause(); return; }
    if (k === 's' || k === 'S') { if (state === 'running') swapBall(); return; }
    if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        if (state === 'running') tryShoot();
        else if (state === 'paused') togglePause();
        else startGame();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' && launcher.spin === -1) launcher.spin = 0;
    if (e.key === 'ArrowRight' && launcher.spin === 1) launcher.spin = 0;
});

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

loadBest();
updateHud();
draw();
requestAnimationFrame(frame);
