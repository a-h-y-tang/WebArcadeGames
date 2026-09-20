// ---------------------------------------------------------------------------
// Alpine Ski — a downhill slalom run.
//
// The slope scrolls past a skier pinned at a fixed height on screen. Steering
// is a heading away from the fall line: the harder you carve across the hill
// the more speed the edges scrub, so every gate is a bargain between the line
// you need and the speed you want. Gates pay, misses cost seconds, pines cost
// everything, and the snow ramps let you fly over the lot.
//
// Written as a single classic (non-module) script so the whole simulation is
// reachable from the Playwright suite as plain globals, mirroring Lode Runner,
// Tetris and Dino Run in this repo. All physics runs through `step(dt)`, which
// the tests drive themselves after `setAutoStep(false)` — nothing in the suite
// depends on a wall clock.
// ---------------------------------------------------------------------------

// --- Canvas / slope geometry ---
const CANVAS_W = 600;
const CANVAS_H = 420;
const SKIER_SCREEN_Y = 150;   // the skier's fixed height on screen; the hill scrolls
const EDGE_MARGIN = 26;       // snow banks down either side
const SKIER_RADIUS = 9;
const START_X = 300;

// --- Physics ---
const BASE_SPEED = 175;       // px/s running straight
const TUCK_SPEED = 260;       // px/s tucked
const BRAKE_SPEED = 70;       // px/s in a snowplough
const EDGE_DRAG = 0.55;       // how much speed a full-angle carve scrubs
const ACCEL = 1.9;            // how fast speed chases its target
const STEER_RATE = 2.6;       // rad/s on the snow
const AIR_STEER_RATE = 0.9;   // rad/s in the air
const ANGLE_CENTER_RATE = 1.6;// how fast the skier straightens up with no input
const MAX_ANGLE = 1.1;        // rad away from the fall line

// --- Rules ---
const CRASH_TIME = 1.1;       // seconds face-down in the snow
const GATE_POINTS = 100;
const MAX_MULTIPLIER = 5;
const MISS_PENALTY = 3;       // seconds off the clock for a missed gate
const AIR_POINTS = 120;       // points per second of air, paid on landing
const AIR_BASE = 0.55;        // seconds of air off any ramp
const AIR_SPEED_DIV = 320;    // plus speed / this, in seconds
const FINISH_POINTS = 500;
const TIME_BONUS = 25;        // points per second left on the clock at the finish
const COURSE_COUNT = 3;
const BEST_KEY = 'alpine-ski-best';

// --- Course shape ---
const GATE_SPACING = 240;
const FIRST_GATE_Y = 320;
const GATE_CLEARANCE = 34;    // obstacles are kept this far clear of a gate's line
const FINISH_RUNOUT = 220;    // no gates in the last stretch before the line

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';           // idle | running | paused | finished | gameover
let won = false;
let level = 1;
let score = 0;
let best = 0;
let streak = 0;
let gatesCleared = 0;
let gatesMissed = 0;
let crashes = 0;
let timeLeft = 0;
let elapsed = 0;              // time spent on the current course
let course = null;
let autoStep = true;          // tests switch this off and drive step() themselves

const skier = {
    x: START_X,
    y: 0,
    angle: 0,
    speed: 0,
    crashTimer: 0,
    airTimer: 0,
    airDuration: 0,
};

const input = { left: false, right: false, tuck: false, brake: false };

const particles = [];
const floaters = [];          // little "+200" / "MISS" labels
let flash = 0;                // red screen tint after a miss or a crash

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elGates = document.getElementById('gates');
const elTime = document.getElementById('time');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

// Small deterministic PRNG so course N is always course N.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function rand() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Distance from point (px, py) to the segment (ax, ay)-(bx, by). Collisions use
// the swept segment rather than the end point so nothing is tunnelled through
// in a long frame.
function segmentPointDistance(ax, ay, bx, by, px, py) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    return Math.hypot(px - cx, py - cy);
}

function isCrashed() {
    return skier.crashTimer > 0;
}

function isAirborne() {
    return skier.airTimer > 0;
}

function setAutoStep(on) {
    autoStep = !!on;
}

// Drop every held control. Used on blur, and by the tests to start from a
// known-quiet keyboard.
function resetInput() {
    input.left = false;
    input.right = false;
    input.tuck = false;
    input.brake = false;
    heldKeys.clear();
}

// ---------------------------------------------------------------------------
// Course generation
// ---------------------------------------------------------------------------

function courseSpec(level) {
    const n = Math.max(0, level - 1);
    return {
        length: 3600 + n * 800,
        gateWidth: 116 - n * 12,
        density: 0.6 + n * 0.3,
        timeLimit: 50 + n * 7,
    };
}

// True when (x, y) sits in the corridor a skier must fly through to make a gate.
function blocksGate(gates, x, y, pad) {
    for (const g of gates) {
        if (Math.abs(y - g.y) > GATE_CLEARANCE + pad) continue;
        if (Math.abs(x - g.x) < g.width / 2 + GATE_CLEARANCE + pad) return true;
    }
    return false;
}

function generateCourse(level) {
    const spec = courseSpec(level);
    const rand = mulberry32(0x5eed + level * 7919);
    const halfGate = spec.gateWidth / 2;

    // --- Gates: a zig-zag, alternating sides of the fall line ---
    const gates = [];
    let side = rand() < 0.5 ? -1 : 1;
    for (let y = FIRST_GATE_Y; y < spec.length - FINISH_RUNOUT; y += GATE_SPACING) {
        const offset = 46 + rand() * 96;
        const x = clamp(
            CANVAS_W / 2 + side * offset,
            EDGE_MARGIN + halfGate,
            CANVAS_W - EDGE_MARGIN - halfGate,
        );
        gates.push({ y, x, width: spec.gateWidth, side, passed: false, missed: false });
        side = -side;
    }

    // --- Ramps: sparse, and never in front of a gate ---
    const ramps = [];
    for (let y = 760; y < spec.length - 420; y += 620) {
        for (let tries = 0; tries < 12; tries++) {
            const w = 66 + rand() * 26;
            const x = EDGE_MARGIN + 50 + rand() * (CANVAS_W - 2 * EDGE_MARGIN - 100);
            if (blocksGate(gates, x, y, w / 2)) continue;
            ramps.push({ y, x, w });
            break;
        }
    }

    // --- Pines and rocks between the gates ---
    const obstacles = [];
    for (let y = 200; y < spec.length - 140; y += 52) {
        const wanted = Math.min(0.62, spec.density * 0.5);
        if (rand() > wanted) continue;
        const type = rand() < 0.68 ? 'tree' : 'rock';
        const r = type === 'tree' ? 11 : 9;
        const x = EDGE_MARGIN + r + rand() * (CANVAS_W - 2 * (EDGE_MARGIN + r));
        const oy = y + rand() * 30;
        if (blocksGate(gates, x, oy, r)) continue;
        if (ramps.some((ramp) => Math.abs(ramp.y - oy) < 70 && Math.abs(ramp.x - x) < ramp.w / 2 + 40)) continue;
        obstacles.push({ x, y: oy, r, type, hit: false, seed: rand() });
    }

    return {
        level,
        length: spec.length,
        timeLimit: spec.timeLimit,
        gateWidth: spec.gateWidth,
        gates,
        obstacles,
        ramps,
        // Decorative pines packed along the piste edges.
        edgeTrees: buildEdgeTrees(rand, spec.length),
    };
}

function buildEdgeTrees(rand, length) {
    const trees = [];
    for (let y = -200; y < length + 400; y += 46) {
        trees.push({ x: rand() * (EDGE_MARGIN - 4), y, s: 0.7 + rand() * 0.6 });
        trees.push({ x: CANVAS_W - rand() * (EDGE_MARGIN - 4), y: y + 23, s: 0.7 + rand() * 0.6 });
    }
    return trees;
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function loadCourse(n) {
    course = generateCourse(n);
    timeLeft = course.timeLimit;
    elapsed = 0;
    skier.x = START_X;
    skier.y = 0;
    skier.angle = 0;
    skier.speed = 0;
    skier.crashTimer = 0;
    skier.airTimer = 0;
    skier.airDuration = 0;
    streak = 0;
    particles.length = 0;
    floaters.length = 0;
    flash = 0;
}

function startGame() {
    level = 1;
    score = 0;
    won = false;
    gatesCleared = 0;
    gatesMissed = 0;
    crashes = 0;
    loadCourse(1);
    refreshHeldInput();   // keys the player is already holding stay held
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextCourse() {
    if (state !== 'finished') return;
    level += 1;
    loadCourse(level);
    refreshHeldInput();
    state = 'running';
    hideOverlay();
    updateHud();
}

function finishCourse() {
    const bonus = FINISH_POINTS + Math.round(timeLeft * TIME_BONUS);
    score += bonus;
    addFloater(`FINISH +${bonus}`, '#1b8f4a');
    syncBest();

    if (level >= COURSE_COUNT) {
        endRun(true);
        return;
    }
    state = 'finished';
    updateHud();
    showOverlay(
        'COURSE CLEAR',
        `Course ${level} in ${elapsed.toFixed(1)}s · Score ${score}`,
        'Press Space for the next course',
    );
}

function endRun(didWin) {
    won = didWin;
    state = 'gameover';
    syncBest();
    updateHud();
    if (didWin) {
        showOverlay(
            'MOUNTAIN WON',
            `Final score ${score} · ${gatesCleared} gates cleared`,
            'Press Space to ski it again',
        );
    } else {
        showOverlay(
            'OUT OF TIME',
            `Score ${score} · Course ${level} · ${gatesCleared} gates cleared`,
            'Press Space to start a new run',
        );
    }
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score} · ${timeLeft.toFixed(1)}s left`, 'Press P to drop back in');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function syncBest() {
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage unavailable (private mode / file://) — the run still counts */
        }
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function applyPenalty(seconds) {
    timeLeft -= seconds;
    if (timeLeft <= 0) {
        timeLeft = 0;
        endRun(false);
    }
}

function clearGate(gate) {
    streak += 1;
    gatesCleared += 1;
    const points = GATE_POINTS * Math.min(streak, MAX_MULTIPLIER);
    score += points;
    addFloater(`+${points}`, '#1361a8');
    spray(10);
}

function missGate() {
    streak = 0;
    gatesMissed += 1;
    flash = 0.4;
    addFloater(`MISS −${MISS_PENALTY}s`, '#c0392b');
    applyPenalty(MISS_PENALTY);
}

function crash() {
    crashes += 1;
    streak = 0;
    skier.speed = 0;
    skier.angle = 0;
    skier.crashTimer = CRASH_TIME;
    skier.airTimer = 0;
    skier.airDuration = 0;
    flash = 0.55;
    spray(22);
}

function launch() {
    skier.airDuration = AIR_BASE + skier.speed / AIR_SPEED_DIV;
    skier.airTimer = skier.airDuration;
    spray(8);
}

function land() {
    const points = Math.round(skier.airDuration * AIR_POINTS);
    if (points > 0) {
        score += points;
        addFloater(`AIR +${points}`, '#7a4bbf');
    }
    skier.airDuration = 0;
    spray(12);
}

function crossRamps(prevX, prevY, x, y) {
    if (skier.airTimer > 0 || y <= prevY) return;
    for (const ramp of course.ramps) {
        if (!(prevY < ramp.y && ramp.y <= y)) continue;
        const t = (ramp.y - prevY) / (y - prevY);
        const cx = prevX + (x - prevX) * t;
        if (Math.abs(cx - ramp.x) <= ramp.w / 2 + SKIER_RADIUS) {
            launch();
            return;
        }
    }
}

function crossGates(prevX, prevY, x, y) {
    if (y <= prevY) return;
    for (const gate of course.gates) {
        if (gate.passed || gate.missed) continue;
        if (!(prevY < gate.y && gate.y <= y)) continue;
        const t = (gate.y - prevY) / (y - prevY);
        const cx = prevX + (x - prevX) * t;
        if (Math.abs(cx - gate.x) <= gate.width / 2) {
            gate.passed = true;
            clearGate(gate);
        } else {
            gate.missed = true;
            missGate();
        }
    }
}

function hitObstacles(prevX, prevY, x, y) {
    const lo = Math.min(prevY, y) - 40;
    const hi = Math.max(prevY, y) + 40;
    for (const o of course.obstacles) {
        if (o.hit || o.y < lo || o.y > hi) continue;
        if (segmentPointDistance(prevX, prevY, x, y, o.x, o.y) <= o.r + SKIER_RADIUS) {
            o.hit = true;
            crash();
            return;
        }
    }
}

function step(dt) {
    if (state !== 'running' || !(dt > 0)) return;

    // Face down in the snow: the clock still runs, nothing else does.
    if (skier.crashTimer > 0) {
        skier.crashTimer = Math.max(0, skier.crashTimer - dt);
        tickClock(dt);
        return;
    }

    const airborneThisFrame = skier.airTimer > 0;

    // --- Steering ---
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const steerRate = airborneThisFrame ? AIR_STEER_RATE : STEER_RATE;
    if (steer !== 0) {
        skier.angle = clamp(skier.angle + steer * steerRate * dt, -MAX_ANGLE, MAX_ANGLE);
    } else {
        skier.angle -= skier.angle * Math.min(1, ANGLE_CENTER_RATE * dt);
        if (Math.abs(skier.angle) < 1e-4) skier.angle = 0;
    }

    // --- Speed: carving across the hill scrubs it, tucking buys it ---
    const modeSpeed = input.brake ? BRAKE_SPEED : (input.tuck ? TUCK_SPEED : BASE_SPEED);
    const target = Math.max(0, modeSpeed * (1 - EDGE_DRAG * Math.abs(Math.sin(skier.angle))));
    skier.speed += (target - skier.speed) * Math.min(1, ACCEL * dt);

    // --- Integrate ---
    const prevX = skier.x;
    const prevY = skier.y;
    skier.x = clamp(skier.x + Math.sin(skier.angle) * skier.speed * dt, EDGE_MARGIN, CANVAS_W - EDGE_MARGIN);
    skier.y += Math.cos(skier.angle) * skier.speed * dt;

    // --- Air ---
    if (skier.airTimer > 0) {
        skier.airTimer = Math.max(0, skier.airTimer - dt);
        if (skier.airTimer === 0) land();
    }

    // --- Everything the swept segment ran into ---
    crossRamps(prevX, prevY, skier.x, skier.y);
    crossGates(prevX, prevY, skier.x, skier.y);
    if (!airborneThisFrame) hitObstacles(prevX, prevY, skier.x, skier.y);
    if (state !== 'running') return;   // a gate penalty can end the run

    // --- The line, then the clock ---
    if (skier.y >= course.length) {
        finishCourse();
        return;
    }
    tickClock(dt);
}

function tickClock(dt) {
    elapsed += dt;
    timeLeft -= dt;
    if (timeLeft <= 0) {
        timeLeft = 0;
        endRun(false);
    }
}

// ---------------------------------------------------------------------------
// Decoration: snow spray and floating score labels. Neither touches the
// simulation, and both are ticked from the render loop, not from step().
// ---------------------------------------------------------------------------

function spray(count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x: skier.x,
            y: skier.y,
            vx: (Math.random() - 0.5) * 120,
            vy: -30 - Math.random() * 90,
            life: 0.4 + Math.random() * 0.4,
            age: 0,
            r: 1 + Math.random() * 2.4,
        });
    }
    while (particles.length > 260) particles.shift();
}

function addFloater(text, color) {
    floaters.push({ text, color, x: skier.x, y: skier.y, age: 0, life: 1.1 });
    while (floaters.length > 40) floaters.shift();
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) { particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 40 * dt;
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.age += dt;
        if (f.age >= f.life) floaters.splice(i, 1);
    }
    if (flash > 0) flash = Math.max(0, flash - dt * 1.4);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function cameraY() {
    return skier.y - SKIER_SCREEN_Y;
}

function drawSnow(camY) {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#eef6ff');
    g.addColorStop(1, '#cfe1f2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Drifting contour lines give the scroll something to read against.
    ctx.strokeStyle = 'rgba(163, 192, 219, 0.45)';
    ctx.lineWidth = 2;
    const spacing = 70;
    const first = Math.floor(camY / spacing) * spacing;
    for (let y = first; y < camY + CANVAS_H + spacing; y += spacing) {
        const sy = y - camY;
        ctx.beginPath();
        for (let x = 0; x <= CANVAS_W; x += 30) {
            const wobble = Math.sin((x + y) * 0.013) * 5;
            if (x === 0) ctx.moveTo(x, sy + wobble);
            else ctx.lineTo(x, sy + wobble);
        }
        ctx.stroke();
    }

    // Moguls: a shaded lip below each bump so they read as snow, not cloud.
    const mSpacing = 52;
    const mFirst = Math.floor(camY / mSpacing) * mSpacing;
    for (let y = mFirst; y < camY + CANVAS_H + mSpacing; y += mSpacing) {
        for (let i = 0; i < 4; i++) {
            const mx = ((Math.sin(y * 0.07 + i * 2.3) + 1) / 2) * (CANVAS_W - 120) + 60;
            const my = y - camY;
            ctx.fillStyle = 'rgba(158, 186, 214, 0.35)';
            ctx.beginPath();
            ctx.ellipse(mx, my + 3, 19, 6, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.beginPath();
            ctx.ellipse(mx, my, 18, 6, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawPine(x, y, scale, dark) {
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(x - 2 * scale, y - 2 * scale, 4 * scale, 9 * scale);
    const greens = dark ? ['#134a2b', '#1a6238'] : ['#1a6238', '#248c4c'];
    for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i % 2 ? greens[0] : greens[1];
        const top = y - (26 - i * 7) * scale;
        const halfW = (13 - i * 3) * scale;
        const base = y - (8 - i * 6) * scale;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x - halfW, base);
        ctx.lineTo(x + halfW, base);
        ctx.closePath();
        ctx.fill();
    }
}

function drawRock(x, y, r) {
    ctx.fillStyle = '#7b8898';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.25, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9dabbb';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y - r * 0.35, r * 0.55, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawGate(gate, camY) {
    const sy = gate.y - camY;
    const half = gate.width / 2;
    const colour = gate.passed ? '#2f9e5e' : (gate.missed ? '#8a94a3' : (gate.side < 0 ? '#e0453d' : '#2f6fd0'));

    for (const dir of [-1, 1]) {
        const px = gate.x + dir * half;
        ctx.strokeStyle = '#2b3a4d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px, sy);
        ctx.lineTo(px, sy - 34);
        ctx.stroke();

        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.moveTo(px, sy - 34);
        ctx.lineTo(px + dir * 20, sy - 27);
        ctx.lineTo(px, sy - 20);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(43, 58, 77, 0.35)';
        ctx.beginPath();
        ctx.ellipse(px, sy + 2, 5, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // The line you have to cross.
    ctx.strokeStyle = gate.passed ? 'rgba(47, 158, 94, 0.5)' : 'rgba(80, 100, 130, 0.30)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(gate.x - half, sy);
    ctx.lineTo(gate.x + half, sy);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawRamp(ramp, camY) {
    const sy = ramp.y - camY;
    const half = ramp.w / 2;
    ctx.fillStyle = '#b9cfe4';
    ctx.beginPath();
    ctx.moveTo(ramp.x - half, sy + 14);
    ctx.lineTo(ramp.x + half, sy + 14);
    ctx.lineTo(ramp.x + half * 0.6, sy - 14);
    ctx.lineTo(ramp.x - half * 0.6, sy - 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(ramp.x - half * 0.6, sy - 14);
    ctx.lineTo(ramp.x + half * 0.6, sy - 14);
    ctx.lineTo(ramp.x + half * 0.45, sy - 20);
    ctx.lineTo(ramp.x - half * 0.45, sy - 20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(60, 90, 120, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

function drawFinish(camY) {
    const sy = course.length - camY;
    if (sy < -40 || sy > CANVAS_H + 60) return;
    const squares = 20;
    const w = CANVAS_W / squares;
    for (let row = 0; row < 2; row++) {
        for (let i = 0; i < squares; i++) {
            ctx.fillStyle = (i + row) % 2 ? '#1d2a3a' : '#f4f8fc';
            ctx.fillRect(i * w, sy + row * 12 - 12, w, 12);
        }
    }
    ctx.fillStyle = '#1d2a3a';
    ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FINISH', CANVAS_W / 2, sy + 34);
    ctx.textAlign = 'left';
}

function drawSkier(camY) {
    const sy = skier.y - camY;
    const air = isAirborne();
    const lift = air ? 10 + Math.sin((1 - skier.airTimer / Math.max(skier.airDuration, 0.001)) * Math.PI) * 10 : 0;

    // Shadow — it stays on the snow while the skier is in the air.
    ctx.fillStyle = 'rgba(40, 70, 100, 0.25)';
    ctx.beginPath();
    ctx.ellipse(skier.x, sy + 6, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(skier.x, sy - lift);
    ctx.rotate(skier.angle);

    if (isCrashed()) {
        // A heap in the snow with skis every which way.
        ctx.strokeStyle = '#1d2a3a';
        ctx.lineWidth = 3;
        for (const a of [-0.9, 0.7]) {
            ctx.save();
            ctx.rotate(a);
            ctx.beginPath();
            ctx.moveTo(-10, 0);
            ctx.lineTo(10, 0);
            ctx.stroke();
            ctx.restore();
        }
        ctx.fillStyle = '#e8593b';
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }

    // Skis.
    ctx.strokeStyle = '#1d2a3a';
    ctx.lineWidth = 2.5;
    for (const dx of [-4, 4]) {
        ctx.beginPath();
        ctx.moveTo(dx, -11);
        ctx.lineTo(dx, 11);
        ctx.stroke();
    }

    // Poles.
    ctx.strokeStyle = '#4b5d73';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-7, -2);
    ctx.lineTo(-11, 9);
    ctx.moveTo(7, -2);
    ctx.lineTo(11, 9);
    ctx.stroke();

    // Body, tucked down when tucking.
    const tucked = input.tuck && !air;
    ctx.fillStyle = '#e8593b';
    ctx.beginPath();
    ctx.ellipse(0, tucked ? 1 : -1, 6, tucked ? 7 : 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head.
    ctx.fillStyle = '#f6d7b0';
    ctx.beginPath();
    ctx.arc(0, tucked ? -6 : -10, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f6fd0';
    ctx.beginPath();
    ctx.arc(0, tucked ? -7 : -11, 4.4, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawHudOverlays(camY) {
    // Course progress: a strip across the top, clear of the tree line.
    ctx.fillStyle = 'rgba(29, 42, 58, 0.14)';
    ctx.fillRect(0, 0, CANVAS_W, 5);
    const p = course ? clamp(skier.y / course.length, 0, 1) : 0;
    ctx.fillStyle = '#2f6fd0';
    ctx.fillRect(0, 0, CANVAS_W * p, 5);

    // Speed bar, bottom left.
    const sw = 120;
    ctx.fillStyle = 'rgba(29, 42, 58, 0.15)';
    ctx.fillRect(12, CANVAS_H - 26, sw, 8);
    const sp = clamp(skier.speed / TUCK_SPEED, 0, 1);
    ctx.fillStyle = sp > 0.8 ? '#e8593b' : '#2f9e5e';
    ctx.fillRect(12, CANVAS_H - 26, sw * sp, 8);
    ctx.fillStyle = '#41556e';
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`${Math.round(skier.speed)} km/h`, 12, CANVAS_H - 30);

    // Streak, on a pill so it stays readable over the tree line.
    if (streak > 1) {
        const label = `×${Math.min(streak, MAX_MULTIPLIER)}`;
        ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
        const w = ctx.measureText(label).width + 16;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        // roundRect is recent enough that a square pill is worth keeping as a fallback.
        if (ctx.roundRect) ctx.roundRect(EDGE_MARGIN + 4, 16, w, 22, 11);
        else ctx.rect(EDGE_MARGIN + 4, 16, w, 22);
        ctx.fill();
        ctx.fillStyle = '#1361a8';
        ctx.fillText(label, EDGE_MARGIN + 12, 32);
    }

    // Floating labels.
    ctx.textAlign = 'center';
    for (const f of floaters) {
        const t = f.age / f.life;
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = f.color;
        ctx.font = 'bold 14px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(f.text, f.x, f.y - camY - 24 - t * 22);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
}

function draw() {
    const camY = cameraY();
    drawSnow(camY);

    if (course) {
        // Piste edges.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.fillRect(0, 0, EDGE_MARGIN - 6, CANVAS_H);
        ctx.fillRect(CANVAS_W - EDGE_MARGIN + 6, 0, EDGE_MARGIN, CANVAS_H);
        for (const t of course.edgeTrees) {
            const sy = t.y - camY;
            if (sy < -40 || sy > CANVAS_H + 40) continue;
            drawPine(t.x, sy, t.s * 0.8, true);
        }

        for (const ramp of course.ramps) {
            const sy = ramp.y - camY;
            if (sy < -40 || sy > CANVAS_H + 40) continue;
            drawRamp(ramp, camY);
        }

        for (const o of course.obstacles) {
            const sy = o.y - camY;
            if (sy < -50 || sy > CANVAS_H + 50) continue;
            if (o.type === 'tree') drawPine(o.x, sy, 1, false);
            else drawRock(o.x, sy, o.r);
        }

        for (const gate of course.gates) {
            const sy = gate.y - camY;
            if (sy < -60 || sy > CANVAS_H + 60) continue;
            drawGate(gate, camY);
        }

        drawFinish(camY);
    }

    // Snow spray.
    ctx.fillStyle = '#ffffff';
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
        ctx.beginPath();
        ctx.arc(p.x, p.y - camY, p.r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawSkier(camY);
    drawHudOverlays(camY);

    if (flash > 0) {
        ctx.fillStyle = `rgba(200, 60, 45, ${Math.min(0.35, flash * 0.5)})`;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elGates.textContent = String(gatesCleared);
    elTime.textContent = timeLeft.toFixed(1);
    elBest.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    overlaySub.textContent = sub || '';
    overlay.classList.add('visible');
    btnStart.textContent = title === 'COURSE CLEAR' ? 'Next Course' : (title === 'PAUSED' ? 'Resume' : 'Start Run');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const heldKeys = new Set();

const KEY_ACTIONS = {
    arrowleft: 'left',
    a: 'left',
    arrowright: 'right',
    d: 'right',
    arrowdown: 'tuck',
    s: 'tuck',
    arrowup: 'brake',
    w: 'brake',
};

function refreshHeldInput() {
    input.left = false;
    input.right = false;
    input.tuck = false;
    input.brake = false;
    for (const key of heldKeys) {
        const action = KEY_ACTIONS[key];
        if (action) input[action] = true;
    }
}

function primaryAction() {
    if (state === 'finished') nextCourse();
    else if (state === 'idle' || state === 'gameover') startGame();
    else if (state === 'paused') togglePause();
}

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();

    if (key === ' ' || key === 'spacebar' || e.code === 'Space') {
        e.preventDefault();
        primaryAction();
        return;
    }
    if (key === 'p' || key === 'escape') {
        e.preventDefault();
        togglePause();
        return;
    }
    if (KEY_ACTIONS[key]) {
        e.preventDefault();
        heldKeys.add(key);
        refreshHeldInput();
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (heldKeys.delete(key)) refreshHeldInput();
});

window.addEventListener('blur', () => {
    heldKeys.clear();
    refreshHeldInput();
});

btnStart.addEventListener('click', () => {
    primaryAction();
});

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same step() the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;

function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;   // clamp after tab switches / long frames
    if (autoStep && state === 'running') step(dt);
    updateParticles(dt);
    draw();
    updateHud();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function loadBest() {
    try {
        const stored = Number(window.localStorage.getItem(BEST_KEY));
        return Number.isFinite(stored) && stored > 0 ? stored : 0;
    } catch (err) {
        return 0;
    }
}

best = loadBest();
loadCourse(1);
timeLeft = course.timeLimit;
updateHud();
requestAnimationFrame(frame);
