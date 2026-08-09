// ---------------------------------------------------------------------------
// Ski Slalom — a downhill gate-racing arcade game on an HTML5 canvas.
//
// The skier drops into an endless series of runs. Each run is a fixed-length
// course of slalom gates scattered with pine trees: carve through every gate,
// keep off the trees, and cross the finish line before par time. Clearing a run
// starts the next one, a little narrower and a little more crowded.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run and Snake in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing. Courses come
// from a seeded PRNG (the run number is the seed) so a given run is always the
// same hill.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 400;
const COURSE_W = 600;          // lateral width of the piste (== canvas width)
// The skier rides high on the canvas so most of the screen is hill *ahead* of
// them — obstacles rise into view from the bottom, as in the classic skiing
// games. At cruising speed that is a little over a second of reaction time.
const SKIER_SCREEN_Y = 120;
const SKIER_R = 9;

// --- Course layout ---
const GATES_PER_RUN = 12;
const GATE_SPACING = 260;      // world units between successive gates
const RUN_OUT = 220;           // distance from the last gate to the finish line
const GATE_BASE_HALF = 62;     // half-width of a run 1 gate opening
const GATE_HALF_STEP = 5;      // gates narrow by this much each run
const GATE_MIN_HALF = 34;
const GATE_EDGE_PAD = 22;      // keep the poles clear of the course edges

// --- Trees ---
const TREE_R = 12;
const TREE_HIT_R = 11;         // trunk collision radius (visually forgiving)
const TREES_BASE = 26;
const TREES_STEP = 9;          // extra trees per run
const TREE_CLEAR_Y = 44;       // vertical no-tree zone around a gate line
const TREE_MIN_GAP = 30;       // keep trees from stacking on top of each other
const TREE_START_CLEAR = 160;  // no trees in the first stretch of the course

// --- Skiing physics (all per second) ---
const BASE_MAX = 260;          // cruising top speed
const TUCK_MAX = 380;          // top speed while tucked
const ACCEL = 220;
const BRAKE = 420;
const STEER_SPEED = 230;       // lateral speed while carving
const STEER_DRAG = 70;         // top speed given up while carving

// --- Rules ---
const CRASH_TIME = 1.1;        // seconds face-down in the snow after a tree
const MISS_PENALTY = 2;        // seconds added to the clock for a missed gate
const START_LIVES = 3;
const MAX_LIVES = 5;
const GATE_POINTS = 100;
const GATE_RUN_BONUS = 25;     // extra points per gate on each later run
const FINISH_BONUS = 500;
const CLEAN_BONUS = 300;       // finishing a run without missing a gate
const TIME_BONUS_RATE = 25;    // points per second saved against par
const PAR_SLACK = 3;           // seconds of slack in par time

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const runEl = document.getElementById('run');
const timeEl = document.getElementById('time');
const gatesEl = document.getElementById('gates');
const livesEl = document.getElementById('lives');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, run, lives, gatesPassed, gatesMissed, elapsed;
let steerDir = 0;              // -1 | 0 | 1
let tucking = false;
let finishFlash = 0;           // seconds left on the "RUN CLEARED" banner
const skier = { x: COURSE_W / 2, y: 0, speed: 0, crashTimer: 0, lean: 0 };
const gates = [];
const trees = [];
const tracks = [];             // recent {x, y} of the skier, drawn as ski tracks
const particles = [];          // snow spray, purely decorative

// ---------------------------------------------------------------------------
// Course generation — seeded so a run always builds the same hill
// ---------------------------------------------------------------------------

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function gateHalf(runNo) {
    return Math.max(GATE_MIN_HALF, GATE_BASE_HALF - (runNo - 1) * GATE_HALF_STEP);
}

function treeCount(runNo) {
    return TREES_BASE + (runNo - 1) * TREES_STEP;
}

function courseLength() {
    return GATES_PER_RUN * GATE_SPACING + RUN_OUT;
}

function parTime() {
    return courseLength() / BASE_MAX + PAR_SLACK;
}

function timeBonus(seconds) {
    return Math.max(0, Math.round((parTime() - seconds) * TIME_BONUS_RATE));
}

function gatePoints() {
    return GATE_POINTS + (run - 1) * GATE_RUN_BONUS;
}

// Gates zig-zag from side to side, which is what makes a slalom a slalom.
function buildCourse(seed) {
    const rand = mulberry32(Math.imul(seed || 1, 0x9e3779b1) ^ 0x5f356495);
    const half = gateHalf(seed);
    const pad = half + GATE_EDGE_PAD;
    const mid = COURSE_W / 2;

    gates.length = 0;
    for (let i = 0; i < GATES_PER_RUN; i++) {
        const left = i % 2 === 0;
        const lo = left ? pad : mid + 10;
        const hi = left ? mid - 10 : COURSE_W - pad;
        gates.push({
            x: Math.round(lo + rand() * Math.max(0, hi - lo)),
            y: GATE_SPACING * (i + 1),
            half,
            color: i % 2 === 0 ? 'red' : 'blue',
            state: 'ahead',
        });
    }

    trees.length = 0;
    const wanted = treeCount(seed);
    const maxY = courseLength() - 70;
    for (let n = 0; n < wanted; n++) {
        for (let attempt = 0; attempt < 40; attempt++) {
            const t = {
                x: Math.round(TREE_R + rand() * (COURSE_W - 2 * TREE_R)),
                y: Math.round(TREE_START_CLEAR + rand() * (maxY - TREE_START_CLEAR)),
                size: 0.8 + rand() * 0.5,
                hit: false,
            };
            if (treeFits(t)) { trees.push(t); break; }
        }
    }
}

// A tree may never stand in a gate opening — every course has to be skiable.
function treeFits(t) {
    for (const g of gates) {
        if (Math.abs(t.y - g.y) < TREE_CLEAR_Y && Math.abs(t.x - g.x) < g.half + 12) return false;
    }
    for (const other of trees) {
        if (Math.abs(t.x - other.x) < TREE_MIN_GAP && Math.abs(t.y - other.y) < TREE_MIN_GAP) return false;
    }
    return true;
}

function nextGate() {
    for (const g of gates) {
        if (g.y > skier.y) return g;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Skier controls
// ---------------------------------------------------------------------------

function clampX(x) {
    return Math.max(0, Math.min(COURSE_W, x));
}

function setSkierX(x) {
    skier.x = clampX(x);
}

function steer(dir) {
    steerDir = Math.sign(dir) | 0;
    pointerActive = false;
}

function setTuck(on) {
    tucking = !!on;
}

function maxSpeed() {
    return tucking ? TUCK_MAX : BASE_MAX;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    elapsed += dt;
    if (finishFlash > 0) finishFlash = Math.max(0, finishFlash - dt);
    updateParticles(dt);

    if (skier.crashTimer > 0) {
        skier.crashTimer = Math.max(0, skier.crashTimer - dt);
        skier.speed = 0;
        updateHud();
        return;
    }

    // Accelerate toward the top speed, which carving eats into.
    const target = maxSpeed() - (steerDir !== 0 ? STEER_DRAG : 0);
    if (skier.speed < target) skier.speed = Math.min(target, skier.speed + ACCEL * dt);
    else skier.speed = Math.max(target, skier.speed - BRAKE * dt);

    skier.lean += (steerDir - skier.lean) * Math.min(1, dt * 10);
    skier.x = clampX(skier.x + steerDir * STEER_SPEED * dt);

    const prevY = skier.y;
    skier.y += skier.speed * dt;

    recordTrack();
    checkGates(prevY, skier.y);
    checkTrees();

    if (state === 'running' && skier.y >= courseLength()) finishRun();

    updateHud();
}

function checkGates(prevY, y) {
    for (const g of gates) {
        if (g.state !== 'ahead') continue;
        if (prevY < g.y && y >= g.y) {
            if (Math.abs(skier.x - g.x) <= g.half) {
                g.state = 'passed';
                gatesPassed++;
                score += gatePoints();
                spray(skier.x, 14, '#bfe3ff');
            } else {
                g.state = 'missed';
                gatesMissed++;
                elapsed += MISS_PENALTY;
            }
        }
    }
}

function checkTrees() {
    for (const t of trees) {
        if (t.hit) continue;
        const reach = SKIER_R + TREE_HIT_R;
        if (Math.abs(skier.x - t.x) < reach && Math.abs(skier.y - t.y) < reach) {
            t.hit = true;
            crash();
            return;
        }
    }
}

function crash() {
    skier.crashTimer = CRASH_TIME;
    skier.speed = 0;
    // steerDir and tucking are left alone: they mirror the keys being held, and
    // zeroing them here would ignore that input until the player let go and
    // pressed again. Nothing moves while crashTimer is running anyway.
    lives = Math.max(0, lives - 1);
    spray(skier.x, 26, '#ffffff');
    if (lives <= 0) endGame();
}

function finishRun() {
    score += FINISH_BONUS + timeBonus(elapsed);
    if (gatesMissed === 0) score += CLEAN_BONUS;
    run++;
    lives = Math.min(MAX_LIVES, lives + 1);
    gatesPassed = 0;
    gatesMissed = 0;
    elapsed = 0;
    finishFlash = 1.6;
    buildCourse(run);
    skier.y = 0;
    skier.x = COURSE_W / 2;
    skier.crashTimer = 0;
    tracks.length = 0;
}

// ---------------------------------------------------------------------------
// Decorative bits: ski tracks and snow spray
// ---------------------------------------------------------------------------

function recordTrack() {
    const last = tracks[tracks.length - 1];
    if (!last || skier.y - last.y > 8) tracks.push({ x: skier.x, y: skier.y, lean: skier.lean });
    while (tracks.length && skier.y - tracks[0].y > SKIER_SCREEN_Y) tracks.shift();
}

function spray(x, count, color) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x,
            y: skier.y,
            vx: (Math.random() - 0.5) * 220,
            vy: (Math.random() - 0.5) * 160 - 40,
            life: 0.4 + Math.random() * 0.5,
            color,
        });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 120 * dt;
    }
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    run = 1;
    lives = START_LIVES;
    gatesPassed = 0;
    gatesMissed = 0;
    elapsed = 0;
    finishFlash = 0;
    steerDir = 0;
    tucking = false;
    heldKeys.clear();
    pointerActive = false;
    skier.x = COURSE_W / 2;
    skier.y = 0;
    skier.speed = 0;
    skier.crashTimer = 0;
    skier.lean = 0;
    tracks.length = 0;
    particles.length = 0;
    buildCourse(run);
    hideOverlay();
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('ski-slalom-best', String(best)); } catch (e) { /* private mode */ }
    }
    updateHud();
    showOverlay('WIPE OUT', `Score ${score} — reached run ${run}`, 'Press Space to ski again', 'Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    runEl.textContent = String(run);
    timeEl.textContent = elapsed.toFixed(1);
    gatesEl.textContent = `${gatesPassed}/${GATES_PER_RUN}`;
    livesEl.textContent = String(lives);
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
}

function showOverlay(title, sub1, sub2, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub1;
    overlaySub.textContent = sub2;
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function worldTop() {
    return skier.y - SKIER_SCREEN_Y;
}

// Cheap deterministic hash so the snow texture stays put as the world scrolls.
function hash2(i, j) {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263);
    h = (h ^ (h >>> 13)) >>> 0;
    return (Math.imul(h, 1274126177) >>> 0) / 4294967296;
}

function draw() {
    const top = worldTop();

    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#eaf4ff');
    sky.addColorStop(1, '#cfe4f7');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawSnowTexture(top);
    drawEdges(top);
    drawTracks(top);
    drawFinish(top);
    drawGates(top);
    drawTrees(top);
    drawParticles(top);
    drawSkier();
    drawProgress();

    if (state === 'running' && finishFlash > 0) {
        ctx.globalAlpha = Math.min(1, finishFlash);
        ctx.fillStyle = '#0d3c61';
        ctx.font = 'bold 30px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`RUN ${run - 1} CLEARED`, CANVAS_W / 2, 240);
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
    }
}

function drawSnowTexture(top) {
    const cell = 46;
    const j0 = Math.floor(top / cell) - 1;
    for (let j = j0; j < j0 + CANVAS_H / cell + 3; j++) {
        for (let i = 0; i < COURSE_W / cell + 1; i++) {
            const r = hash2(i, j);
            const x = i * cell + r * cell;
            const y = j * cell + hash2(j, i) * cell - top;
            if (y < -20 || y > CANVAS_H + 20) continue;
            ctx.fillStyle = r > 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(160,195,225,0.35)';
            ctx.beginPath();
            ctx.ellipse(x, y, 9 + r * 8, 3 + r * 2, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawEdges(top) {
    const seg = 30;
    const start = Math.floor(top / seg) * seg;
    for (let y = start; y < top + CANVAS_H + seg; y += seg) {
        const sy = y - top;
        const on = Math.floor(y / seg) % 2 === 0;
        ctx.fillStyle = on ? '#ff8a3d' : '#ffd7bb';
        ctx.fillRect(0, sy, 6, seg - 4);
        ctx.fillRect(COURSE_W - 6, sy, 6, seg - 4);
    }
}

function drawTracks(top) {
    ctx.strokeStyle = 'rgba(150,185,215,0.35)';
    ctx.lineWidth = 2;
    for (const side of [-4, 4]) {
        ctx.beginPath();
        let started = false;
        for (const p of tracks) {
            const sy = p.y - top;
            if (sy < -10 || sy > CANVAS_H + 10) { started = false; continue; }
            const x = p.x + side;
            if (!started) { ctx.moveTo(x, sy); started = true; } else ctx.lineTo(x, sy);
        }
        ctx.stroke();
    }
}

function drawFinish(top) {
    const y = courseLength() - top;
    if (y < -30 || y > CANVAS_H + 30) return;
    const sq = 15;
    for (let i = 0; i < COURSE_W / sq; i++) {
        for (let r = 0; r < 2; r++) {
            ctx.fillStyle = (i + r) % 2 === 0 ? '#1b2a3a' : '#ffffff';
            ctx.fillRect(i * sq, y - sq + r * sq, sq, sq);
        }
    }
    ctx.fillStyle = '#1b2a3a';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FINISH', CANVAS_W / 2, y - 26);
    ctx.textAlign = 'left';
}

function drawGates(top) {
    for (const g of gates) {
        const y = g.y - top;
        if (y < -60 || y > CANVAS_H + 60) continue;
        const passed = g.state === 'passed';
        const missed = g.state === 'missed';
        const base = g.color === 'red' ? '#e23b3b' : '#2f6fe0';
        const color = passed ? '#37a85a' : missed ? '#8a8f96' : base;

        if (g.state === 'ahead') {
            // shade the opening so the line to aim for reads at a glance
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.fillRect(g.x - g.half, y - 5, g.half * 2, 10);
            ctx.strokeStyle = 'rgba(90,140,190,0.55)';
            ctx.lineWidth = 2;
            ctx.setLineDash([7, 7]);
            ctx.beginPath();
            ctx.moveTo(g.x - g.half, y);
            ctx.lineTo(g.x + g.half, y);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        for (const side of [-1, 1]) {
            const px = g.x + side * g.half;
            ctx.fillStyle = 'rgba(30,60,90,0.18)';
            ctx.fillRect(px - 2, y - 2, 8, 6);
            ctx.fillStyle = color;
            ctx.fillRect(px - 2, y - 34, 4, 36);
            // flag panel, hung on the inside of the pole
            ctx.beginPath();
            ctx.moveTo(px, y - 34);
            ctx.lineTo(px - side * 20, y - 28);
            ctx.lineTo(px, y - 16);
            ctx.closePath();
            ctx.fill();
        }

        if (missed) {
            ctx.strokeStyle = '#c0392b';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(g.x - 9, y - 26);
            ctx.lineTo(g.x + 9, y - 8);
            ctx.moveTo(g.x + 9, y - 26);
            ctx.lineTo(g.x - 9, y - 8);
            ctx.stroke();
            ctx.lineWidth = 2;
        }
    }
}

function drawTrees(top) {
    for (const t of trees) {
        const y = t.y - top;
        if (y < -50 || y > CANVAS_H + 50) continue;
        const s = t.size || 1;
        ctx.save();
        ctx.translate(t.x, y);
        if (t.hit) ctx.rotate(0.5);

        ctx.fillStyle = 'rgba(40,70,100,0.15)';
        ctx.beginPath();
        ctx.ellipse(3, 6 * s, 14 * s, 5 * s, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#6b4a2f';
        ctx.fillRect(-2.5 * s, 0, 5 * s, 9 * s);

        for (let layer = 0; layer < 3; layer++) {
            const w = (16 - layer * 3.5) * s;
            const yy = (2 - layer * 11) * s;
            ctx.fillStyle = layer === 2 ? '#1f6b45' : '#22794f';
            ctx.beginPath();
            ctx.moveTo(0, yy - 16 * s);
            ctx.lineTo(-w, yy);
            ctx.lineTo(w, yy);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.beginPath();
            ctx.moveTo(0, yy - 16 * s);
            ctx.lineTo(-w * 0.5, yy - 7 * s);
            ctx.lineTo(w * 0.5, yy - 7 * s);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }
}

function drawParticles(top) {
    for (const p of particles) {
        const y = p.y - top;
        if (y < -10 || y > CANVAS_H + 10) continue;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawSkier() {
    const x = skier.x;
    const y = SKIER_SCREEN_Y;
    const crashed = skier.crashTimer > 0;

    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = 'rgba(40,70,100,0.18)';
    ctx.beginPath();
    ctx.ellipse(2, 12, 13, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    if (crashed) {
        ctx.fillStyle = '#f4f7fb';
        ctx.beginPath();
        ctx.arc(0, 0, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#e23b3b';
        ctx.lineWidth = 3;
        for (const a of [0.6, 2.1]) {
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * -14, Math.sin(a) * -14);
            ctx.lineTo(Math.cos(a) * 14, Math.sin(a) * 14);
            ctx.stroke();
        }
        ctx.fillStyle = '#0d3c61';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('OOF!', 0, -22);
        ctx.textAlign = 'left';
        ctx.restore();
        return;
    }

    ctx.rotate(skier.lean * 0.4);
    const crouch = tucking ? 3 : 0;

    // skis
    ctx.fillStyle = '#1b2a3a';
    ctx.fillRect(-9, 8 - crouch, 5, 20);
    ctx.fillRect(4, 8 - crouch, 5, 20);
    // body
    ctx.fillStyle = '#e23b3b';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-8, -8 + crouch, 16, 18 - crouch, 5);
    else ctx.rect(-8, -8 + crouch, 16, 18 - crouch);
    ctx.fill();
    // arms holding poles
    ctx.strokeStyle = '#1b2a3a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, -2 + crouch);
    ctx.lineTo(-15, 10 + crouch);
    ctx.moveTo(8, -2 + crouch);
    ctx.lineTo(15, 10 + crouch);
    ctx.stroke();
    // head
    ctx.fillStyle = '#ffd9a8';
    ctx.beginPath();
    ctx.arc(0, -13 + crouch, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f6fe0';
    ctx.beginPath();
    ctx.arc(0, -15 + crouch, 6, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (skier.speed > BASE_MAX * 0.98) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
            const lx = x - 30 + i * 20;
            ctx.beginPath();
            ctx.moveTo(lx, y - 60 - i * 14);
            ctx.lineTo(lx, y - 40 - i * 14);
            ctx.stroke();
        }
    }
}

function drawProgress() {
    if (state === 'idle') return;
    const h = CANVAS_H - 60;
    const x = CANVAS_W - 16;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(x, 30, 7, h);
    const p = Math.max(0, Math.min(1, skier.y / courseLength()));
    ctx.fillStyle = '#2f6fe0';
    ctx.fillRect(x, 30, 7, h * p);
    ctx.fillStyle = '#1b2a3a';
    ctx.fillRect(x - 3, 30 + h * p - 1, 13, 3);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    applyPointerSteering();
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const heldKeys = new Set();
let pointerActive = false;
let pointerX = COURSE_W / 2;

const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const TUCK_KEYS = ['ArrowDown', 's', 'S'];

function refreshKeys() {
    const left = LEFT_KEYS.some((k) => heldKeys.has(k));
    const right = RIGHT_KEYS.some((k) => heldKeys.has(k));
    const tuck = TUCK_KEYS.some((k) => heldKeys.has(k));
    if (left || right) pointerActive = false;
    steerDir = (right ? 1 : 0) - (left ? 1 : 0);
    tucking = tuck;
}

// The mouse steers by chasing the pointer; the keyboard always wins.
function applyPointerSteering() {
    if (!pointerActive || state !== 'running') return;
    const dx = pointerX - skier.x;
    steerDir = Math.abs(dx) < 6 ? 0 : Math.sign(dx);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if ([...LEFT_KEYS, ...RIGHT_KEYS, ...TUCK_KEYS].includes(e.key)) {
        heldKeys.add(e.key);
        refreshKeys();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshKeys();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    pointerX = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    pointerActive = true;
    heldKeys.clear();
});

canvas.addEventListener('mouseleave', () => { pointerActive = false; });

canvas.addEventListener('mousedown', (e) => { setTuck(true); e.preventDefault(); });
window.addEventListener('mouseup', () => { if (pointerActive) setTuck(false); });

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('ski-slalom-best') || '0', 10) || 0;
state = 'idle';
score = 0;
run = 1;
lives = START_LIVES;
gatesPassed = 0;
gatesMissed = 0;
elapsed = 0;
updateHud();
requestAnimationFrame(frame);
