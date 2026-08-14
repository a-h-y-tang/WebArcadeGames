// ---------------------------------------------------------------------------
// Ski Slalom — a timed downhill slalom run on an HTML5 canvas.
//
// The skier always heads down the hill; the only input is which way the skis
// are pointed. Pointing across the fall line slows the descent, so every turn
// is a trade between the line you need and the speed you want. Ski between the
// poles of all GATE_COUNT gates, dodge the trees and cross the finish line —
// the clock plus MISS_PENALTY seconds for every gate you skipped is your score.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, matching Slime Volley,
// Kaboom and Tetris in this repo. The world is advanced by `step(dt)` in fixed
// SUB_STEP sub-steps, and the course is built from a seeded PRNG, so a seed
// plus a sequence of inputs always produces exactly the same run.
// ---------------------------------------------------------------------------

// --- Slope geometry ---
const CANVAS_W = 480;
const CANVAS_H = 640;
const SKIER_SCREEN_Y = 200;         // the skier is pinned this far down the view
const EDGE_MARGIN = 18;             // deep snow starts here; you cannot pass it
const EDGE_SPEED = 130;             // ...and ploughing along it is slow

// --- Skiing ---
const MAX_SPEED = 430;              // px/s straight down the fall line
const MAX_ANGLE = 1.15;             // rad, ~66° — the sharpest carve possible
const TURN_RATE = 2.8;              // rad/s while a direction is held
const CENTER_RATE = 1.8;            // rad/s the skis drift back when released
const ACCEL = 320;                  // px/s² gained when pointed downhill
const DECEL = 620;                  // px/s² scrubbed off by turning
const SKIER_R = 7;

// --- Course ---
const GATE_COUNT = 16;
const GATE_SPACING = 300;           // vertical gap between gates
const GATE_HALF = 46;               // half the distance between the two poles
const FIRST_GATE_Y = 420;
const GATE_MIN_OFF = 50;            // gates sit this far off the centre line...
const GATE_MAX_OFF = 130;           // ...at most this far
const FINISH_Y = FIRST_GATE_Y + (GATE_COUNT - 1) * GATE_SPACING + 320;
const GATE_CLEAR_X = 60;            // trees keep this clear of a gate's corridor
const GATE_CLEAR_Y = 60;
const TREE_TRIES = 110;             // candidate trees per course, before rejection
const TREE_MARGIN = 46;             // trees never grow in the edge lanes
const TREE_R = 11;
const HIT_DIST = SKIER_R + TREE_R;

// --- Scoring ---
const MISS_PENALTY = 3;             // seconds added for each gate skipped
const CRASH_TIME = 1.2;             // seconds spent face down in the snow
const SUB_STEP = 1 / 240;           // fixed physics tick
const MAX_FRAME = 0.1;              // longest frame the loop will simulate
const BEST_KEY = 'ski-slalom-best';

// Cosmetic scale only: the HUD reads out in metres and km/h, the simulation
// works entirely in pixels and seconds.
const PX_PER_M = 14;
const SPEED_TO_KMH = 3.6 / PX_PER_M;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const timeEl = document.getElementById('time');
const gatesEl = document.getElementById('gates');
const penaltyEl = document.getElementById('penalty');
const crashesEl = document.getElementById('crashes');
const speedEl = document.getElementById('speed');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State (declared with `var` so the tests can reach them off `window`) ---
// state: 'idle' | 'running' | 'paused' | 'finished'
var state = 'idle';
var gates = [];
var trees = [];
var nextGate = 0;
var elapsed = 0;
var penalty = 0;
var passed = 0;
var missed = 0;
var crashes = 0;
var crashTimer = 0;
var bestTime = null;
var courseSeed = 0;
var accumulator = 0;

const skier = { x: CANVAS_W / 2, y: 0, speed: 0, heading: 0, turn: 0 };
const trail = [];                   // recent positions, cosmetic only

// ---------------------------------------------------------------------------
// Course generation
// ---------------------------------------------------------------------------

// mulberry32 — a tiny, fast, well-distributed seeded PRNG. Only ever used at
// course build time, so the simulation itself stays free of randomness.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Gates alternate sides of the centre line, the way a real slalom does, so the
// racer is always crossing the fall line rather than running straight.
function buildGates(rnd) {
    const out = [];
    for (let i = 0; i < GATE_COUNT; i++) {
        const offset = GATE_MIN_OFF + rnd() * (GATE_MAX_OFF - GATE_MIN_OFF);
        const dir = i % 2 === 0 ? -1 : 1;
        out.push({
            x: CANVAS_W / 2 + dir * offset,
            y: FIRST_GATE_Y + i * GATE_SPACING,
            side: i % 2 === 0 ? 'blue' : 'red',
        });
    }
    return out;
}

function blocksGate(x, y, gateList) {
    return gateList.some((gate) =>
        Math.abs(y - gate.y) < GATE_CLEAR_Y &&
        Math.abs(x - gate.x) < GATE_HALF + GATE_CLEAR_X);
}

// Trees are scattered anywhere on the slope except in front of a gate, so the
// racing line is always skiable and the hazards live in the space between.
function buildTrees(rnd, gateList) {
    const out = [];
    const top = 220;
    const span = FINISH_Y - 120 - top;
    for (let i = 0; i < TREE_TRIES; i++) {
        const x = TREE_MARGIN + rnd() * (CANVAS_W - 2 * TREE_MARGIN);
        const y = top + rnd() * span;
        const size = 14 + rnd() * 8;
        if (blocksGate(x, y, gateList)) continue;
        out.push({ x, y, size, hit: false });
    }
    out.sort((a, b) => a.y - b.y);
    return out;
}

function buildCourse(seed) {
    const rnd = mulberry32(seed);
    gates = buildGates(rnd);
    trees = buildTrees(rnd, gates);
}

// ---------------------------------------------------------------------------
// Run flow
// ---------------------------------------------------------------------------
function startGame(seed) {
    courseSeed = seed === undefined ? Math.floor(Math.random() * 1e9) : seed;
    buildCourse(courseSeed);

    skier.x = CANVAS_W / 2;
    skier.y = 0;
    skier.speed = 0;
    skier.heading = 0;
    skier.turn = 0;

    nextGate = 0;
    elapsed = 0;
    penalty = 0;
    passed = 0;
    missed = 0;
    crashes = 0;
    crashTimer = 0;
    accumulator = 0;
    trail.length = 0;

    state = 'running';
    hideOverlay();
    updateHud();
}

function finalTime() {
    return elapsed + penalty;
}

function finishRun() {
    state = 'finished';
    const total = finalTime();
    if (bestTime === null || total < bestTime) {
        bestTime = total;
        try { localStorage.setItem(BEST_KEY, String(total)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay(
        'FINISH!',
        `${elapsed.toFixed(2)}s + ${penalty.toFixed(1)}s penalty = ${total.toFixed(2)}s`,
        `${passed}/${GATE_COUNT} gates · ${crashes} fall${crashes === 1 ? '' : 's'} · Space to run again`);
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `${elapsed.toFixed(2)}s · ${passed}/${GATE_COUNT} gates`, 'Press P to carry on');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function steer(dir) {
    skier.turn = Math.sign(dir);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

// A gate is scored the moment the skier's line crosses its pole line: inside
// the corridor it counts, outside it costs MISS_PENALTY. Gates are resolved in
// order, so one can never be scored twice or skipped silently.
function resolveGates() {
    while (nextGate < gates.length && skier.y >= gates[nextGate].y) {
        const gate = gates[nextGate];
        if (Math.abs(skier.x - gate.x) <= GATE_HALF) {
            passed++;
            gate.cleared = true;
        } else {
            missed++;
            penalty += MISS_PENALTY;
            gate.cleared = false;
        }
        nextGate++;
    }
}

function hitTree() {
    for (const tree of trees) {
        if (tree.hit) continue;
        if (tree.y < skier.y - 40) continue;
        if (tree.y > skier.y + 40) break;          // trees are sorted by y
        const dx = tree.x - skier.x;
        const dy = tree.y - skier.y;
        if (dx * dx + dy * dy <= HIT_DIST * HIT_DIST) return tree;
    }
    return null;
}

function substep(h) {
    elapsed += h;

    if (crashTimer > 0) {
        crashTimer = Math.max(0, crashTimer - h);
        return;
    }

    // Steering: held input swings the skis, releasing lets them drift back to
    // the fall line so the skier does not have to counter-steer every turn.
    if (skier.turn !== 0) {
        skier.heading += skier.turn * TURN_RATE * h;
        skier.heading = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, skier.heading));
    } else if (skier.heading !== 0) {
        const drift = CENTER_RATE * h;
        skier.heading = Math.abs(skier.heading) <= drift
            ? 0
            : skier.heading - Math.sign(skier.heading) * drift;
    }

    // Gravity down the fall line: the more the skis point across it, the less
    // of the hill is pulling you along, so a hard carve is a brake.
    const target = MAX_SPEED * Math.cos(skier.heading);
    skier.speed = skier.speed < target
        ? Math.min(target, skier.speed + ACCEL * h)
        : Math.max(target, skier.speed - DECEL * h);

    skier.x += Math.sin(skier.heading) * skier.speed * h;
    skier.y += Math.cos(skier.heading) * skier.speed * h;

    // Deep snow at the slope edges: you are stopped from leaving and slowed.
    if (skier.x < EDGE_MARGIN) {
        skier.x = EDGE_MARGIN;
        skier.speed = Math.min(skier.speed, EDGE_SPEED);
    } else if (skier.x > CANVAS_W - EDGE_MARGIN) {
        skier.x = CANVAS_W - EDGE_MARGIN;
        skier.speed = Math.min(skier.speed, EDGE_SPEED);
    }

    resolveGates();

    const tree = hitTree();
    if (tree) {
        tree.hit = true;                // knocked flat; it cannot catch you twice
        crashes++;
        crashTimer = CRASH_TIME;
        skier.speed = 0;
        skier.heading = 0;
        skier.turn = 0;
    }

    if (skier.y >= FINISH_Y) {
        skier.y = FINISH_Y;
        finishRun();
    }
}

// Advance the world by `dt` seconds in fixed sub-steps. Splitting the frame
// this way keeps the result identical at any frame rate and stops a fast skier
// from tunnelling past a pole line or through a tree between frames.
function step(dt) {
    if (state !== 'running') return;
    accumulator += Math.min(dt, MAX_FRAME);
    while (accumulator >= SUB_STEP && state === 'running') {
        substep(SUB_STEP);
        accumulator -= SUB_STEP;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Test hook — place the skier anywhere on the hill, back on their feet.
// ---------------------------------------------------------------------------
function setSkier(x, y) {
    skier.x = x;
    skier.y = y;
    crashTimer = 0;
    trail.length = 0;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------
function cameraY() {
    return skier.y - SKIER_SCREEN_Y;
}

function formatBest() {
    return bestTime === null ? '--' : bestTime.toFixed(2);
}

function updateHud() {
    timeEl.textContent = elapsed.toFixed(2);
    gatesEl.textContent = `${passed}/${GATE_COUNT}`;
    penaltyEl.textContent = penalty.toFixed(1);
    crashesEl.textContent = String(crashes);
    speedEl.textContent = String(Math.round(skier.speed * SPEED_TO_KMH));
    bestEl.textContent = formatBest();
}

function showOverlay(title, score, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = score;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
    btnStart.textContent = state === 'idle' ? 'Start Run' : 'Run Again';
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// A cheap deterministic hash, used to sprinkle fixed snow speckles across the
// hill without storing them or touching the simulation's randomness.
function hash(n) {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
}

function drawSnow(camera) {
    ctx.fillStyle = '#c9dced';
    const band = Math.floor(camera / 80) - 1;
    for (let b = band; b < band + 11; b++) {
        for (let i = 0; i < 7; i++) {
            const n = b * 13 + i;
            const x = hash(n) * CANVAS_W;
            const y = b * 80 + hash(n + 0.5) * 80 - camera;
            ctx.fillRect(x, y, 2, 2);
        }
    }
}

// Two parallel grooves in the snow, offset either side of the line the skier
// took, so the carve that was skied is readable at a glance.
function drawTrail(camera) {
    if (trail.length < 2) return;
    ctx.strokeStyle = 'rgba(150, 178, 202, 0.6)';
    ctx.lineWidth = 2;
    for (const side of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i < trail.length; i++) {
            const p = trail[i];
            const ox = side * 5 * Math.cos(p.heading);
            const oy = -side * 5 * Math.sin(p.heading);
            if (i === 0) ctx.moveTo(p.x + ox, p.y + oy - camera);
            else ctx.lineTo(p.x + ox, p.y + oy - camera);
        }
        ctx.stroke();
    }
}

function drawGate(gate, camera) {
    const y = gate.y - camera;
    if (y < -40 || y > CANVAS_H + 40) return;
    const colour = gate.side === 'blue' ? '#2f6fe0' : '#e03b3b';
    const dim = gate.cleared === false;

    ctx.globalAlpha = dim ? 0.35 : 1;
    for (const dir of [-1, 1]) {
        const x = gate.x + dir * GATE_HALF;
        ctx.strokeStyle = colour;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - 34);
        ctx.stroke();

        ctx.fillStyle = colour;
        ctx.beginPath();                     // pennant, pointing into the gate
        ctx.moveTo(x, y - 34);
        ctx.lineTo(x - dir * 14, y - 28);
        ctx.lineTo(x, y - 22);
        ctx.closePath();
        ctx.fill();
    }

    if (gate.cleared) {                       // a faint line where you went through
        ctx.strokeStyle = 'rgba(46, 160, 96, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(gate.x - GATE_HALF, y);
        ctx.lineTo(gate.x + GATE_HALF, y);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

function drawTree(tree, camera) {
    const y = tree.y - camera;
    if (y < -40 || y > CANVAS_H + 40) return;
    const s = tree.size;

    if (tree.hit) {                           // knocked flat, harmless now
        ctx.fillStyle = '#7d8f7a';
        ctx.beginPath();
        ctx.ellipse(tree.x, y, s * 0.9, s * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        return;
    }

    ctx.fillStyle = 'rgba(80, 100, 120, 0.25)';
    ctx.beginPath();
    ctx.ellipse(tree.x + 4, y + 3, s * 0.6, s * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#6b4b32';
    ctx.fillRect(tree.x - 2, y - 4, 4, 8);
    ctx.fillStyle = '#1f7a4d';
    ctx.beginPath();
    ctx.moveTo(tree.x, y - s * 1.7);
    ctx.lineTo(tree.x + s * 0.62, y - 2);
    ctx.lineTo(tree.x - s * 0.62, y - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2f9d68';
    ctx.beginPath();
    ctx.moveTo(tree.x, y - s * 1.7);
    ctx.lineTo(tree.x + s * 0.4, y - s * 0.7);
    ctx.lineTo(tree.x - s * 0.4, y - s * 0.7);
    ctx.closePath();
    ctx.fill();
}

function drawSkier(camera) {
    const y = skier.y - camera;

    if (crashTimer > 0) {                     // a puff of snow and a pair of skis
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(skier.x, y, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1d2f43';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(skier.x - 10, y - 8);
        ctx.lineTo(skier.x + 10, y + 6);
        ctx.moveTo(skier.x + 10, y - 8);
        ctx.lineTo(skier.x - 10, y + 6);
        ctx.stroke();
        return;
    }

    ctx.save();
    ctx.translate(skier.x, y);
    ctx.rotate(skier.heading);

    ctx.strokeStyle = '#12324a';               // skis
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const dx of [-5, 5]) {
        ctx.beginPath();
        ctx.moveTo(dx, -12);
        ctx.lineTo(dx, 12);
        ctx.stroke();
    }

    ctx.fillStyle = '#ff6b35';                 // jacket
    ctx.beginPath();
    ctx.ellipse(0, -1, 7, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#12324a';                 // helmet
    ctx.beginPath();
    ctx.arc(0, 5, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawBanner(y, camera, text, colour) {
    const sy = y - camera;
    if (sy < -30 || sy > CANVAS_H + 30) return;
    ctx.fillStyle = colour;
    ctx.fillRect(0, sy - 12, CANVAS_W, 6);
    ctx.fillStyle = '#0f1b27';
    ctx.font = 'bold 14px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, CANVAS_W / 2, sy + 14);
    ctx.textAlign = 'left';
}

function drawFinish(camera) {
    const y = FINISH_Y - camera;
    if (y < -40 || y > CANVAS_H + 40) return;
    const sq = 16;
    for (let i = 0; i * sq < CANVAS_W; i++) {
        for (let r = 0; r < 2; r++) {
            ctx.fillStyle = (i + r) % 2 === 0 ? '#12324a' : '#ffffff';
            ctx.fillRect(i * sq, y - sq + r * sq, sq, sq);
        }
    }
}

function draw() {
    const camera = cameraY();

    ctx.fillStyle = '#eaf4fd';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawSnow(camera);

    ctx.fillStyle = '#c2d7e8';                 // deep snow at the slope edges
    ctx.fillRect(0, 0, EDGE_MARGIN, CANVAS_H);
    ctx.fillRect(CANVAS_W - EDGE_MARGIN, 0, EDGE_MARGIN, CANVAS_H);

    drawBanner(0, camera, 'START', '#57c7ff');
    drawFinish(camera);
    drawTrail(camera);
    for (const gate of gates) drawGate(gate, camera);
    for (const tree of trees) drawTree(tree, camera);
    drawSkier(camera);

    if (state === 'running' || state === 'paused') {
        const left = Math.max(0, FINISH_Y - skier.y);
        ctx.fillStyle = 'rgba(15, 27, 39, 0.75)';
        ctx.fillRect(CANVAS_W - 104, 10, 94, 22);
        ctx.fillStyle = '#eaf3fb';
        ctx.font = '12px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(left / PX_PER_M)} m to go`, CANVAS_W - 16, 25);
        ctx.textAlign = 'left';
    }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastTs = 0;

function frame(ts) {
    const dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    if (state === 'running') {
        step(dt);
        const last = trail[trail.length - 1];
        if (!last || Math.abs(last.y - skier.y) > 6) {
            trail.push({ x: skier.x, y: skier.y, heading: skier.heading });
            if (trail.length > 90) trail.shift();
        }
    }
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
const held = { left: false, right: false };

function applyHeld() {
    steer((held.right ? 1 : 0) - (held.left ? 1 : 0));
}

document.addEventListener('keydown', (e) => {
    switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
            held.left = true;
            applyHeld();
            e.preventDefault();
            break;
        case 'ArrowRight':
        case 'KeyD':
            held.right = true;
            applyHeld();
            e.preventDefault();
            break;
        case 'Space':
            if (state === 'idle' || state === 'finished') startGame();
            e.preventDefault();
            break;
        case 'KeyP':
            togglePause();
            e.preventDefault();
            break;
        case 'KeyR':
            startGame();
            e.preventDefault();
            break;
        default:
            break;
    }
});

document.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { held.left = false; applyHeld(); }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { held.right = false; applyHeld(); }
});

btnStart.addEventListener('click', () => startGame());

const storedBest = parseFloat(localStorage.getItem(BEST_KEY));
bestTime = Number.isFinite(storedBest) ? storedBest : null;

buildCourse(Math.floor(Math.random() * 1e9));
updateHud();
requestAnimationFrame(frame);
