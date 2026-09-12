// ---------------------------------------------------------------------------
// Ski Slalom — an endless downhill run on an HTML5 canvas.
//
// The camera looks straight down the fall line: the skier holds a fixed height
// on screen and the mountain scrolls up past them. Steering is the whole game —
// the carve angle controls both how fast you cross the piste and how much speed
// you keep, so every slalom gate is a trade between position and pace. Trees and
// rocks end runs, ramps and jumps buy air-time points, and three crashes finish
// you.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Kaboom! and Snake in this repo. All motion is expressed per second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World ---------------------------------------------------------------
const CANVAS_W = 560;
const CANVAS_H = 620;
const SKIER_SCREEN_Y = 190;   // the skier's fixed height on screen
const PX_PER_METER = 12;      // world pixels per displayed metre
const EDGE_MARGIN = 18;       // how close to the netting the skier may get

// --- Skier ---------------------------------------------------------------
const MAX_ANGLE = 1.15;       // radians away from the fall line (~66 degrees)
const TURN_RATE = 3.0;        // rad/s on the ground
const TURN_RATE_AIR = 1.1;    // rad/s in the air
const SPEED_MIN = 90;         // px/s when fully carved across the hill
const SPEED_BASE = 210;       // px/s cap at the top of the run
const SPEED_CAP_MAX = 420;    // px/s cap however far you get
const SPEED_GROWTH = 0.06;    // px/s added to the cap per metre descended
const BRAKE_FACTOR = 0.45;    // snowplough multiplier on the target speed
const ACCEL = 220;            // px/s^2 toward a higher target
const DECEL = 400;            // px/s^2 toward a lower target
const SKIER_HW = 9;
const SKIER_HH = 12;

// --- Air -----------------------------------------------------------------
const JUMP_AIR = 0.6;         // seconds of flight from a standing jump
const RAMP_AIR = 1.15;        // seconds of flight off a ramp
const AIR_POINTS_PER_SEC = 120;

// --- Gates ---------------------------------------------------------------
const GATE_HALF = 46;         // half the gap between a pair of flags
const GATE_POINTS = 100;
const COMBO_MAX = 8;

// --- Obstacles -----------------------------------------------------------
// A tree is tall enough to catch you in the air; a rock is not.
const OBSTACLE = {
    tree: { hw: 12, hh: 14, airSafe: false },
    rock: { hw: 11, hh: 8, airSafe: true },
    ramp: { hw: 22, hh: 9, airSafe: true },
};

// --- Course generation ---------------------------------------------------
// Rows are spaced in *time*, not pixels: the gap is how far the skier travels
// in `rowTime` seconds at the current speed cap. That keeps a 420 px/s run from
// meeting three times as many obstacles a second as a 210 px/s one, while
// `rowTime` still tightens with distance so the course does get harder.
const SPAWN_START = 400;      // the first stretch of the run is always clear
const SPAWN_AHEAD = 820;      // how far below the skier the course is built
const ROW_TIME_BASE = 0.62;   // seconds between rows at the top of the mountain
const ROW_TIME_MIN = 0.34;    // seconds between rows once it is fully wound up
const ROW_TIME_SHRINK = 0.00008; // seconds lost per metre descended
const GATE_CHANCE = 0.34;
const CULL_BEHIND = 260;      // px uphill of the skier before objects are dropped

// Every row keeps one corridor clear, and the corridor only ever steps sideways
// by a carve's worth, so there is always a line down the mountain to find.
const CLEAR_HALF = 58;        // half-width of the clear corridor
const CORRIDOR_SHIFT = 130;   // how far the corridor may move between rows
const CORRIDOR_EDGE = 40;     // keep the corridor off the netting

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const CRASH_TIME = 1.3;       // seconds face-down in the snow
const INVULN_TIME = 1.2;      // seconds of grace after getting back up
const DIST_POINTS = 1;        // score per metre descended

// --- Colours -------------------------------------------------------------
const GATE_COLOR = { pending: '#2f6fd0', passed: '#2ea44f', missed: '#d94a3d' };

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const distanceEl = document.getElementById('distance');
const comboEl = document.getElementById('combo');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'crashing' | 'over'
let state, score, best, lives, combo, distance, lastAirBonus;
let crashTimer, crashSpin;
let spawnEnabled, spawnY, rngSeed;
let airPopup = null;

const skier = { x: CANVAS_W / 2, y: 0, angle: 0, speed: 0, air: 0, airTime: 0, invuln: 0 };

// Mutated in place, never reassigned, so the tests can hold on to them.
const obstacles = [];
const gates = [];
// One entry per generated row: the clear line through it.
const corridors = [];

// Carved tracks left behind in the snow: sampled world points, purely cosmetic.
const trail = [];
const TRAIL_SAMPLE = 0.03;   // seconds between samples
const TRAIL_MAX = 260;       // samples kept
const TRAIL_BREAK = 40;      // px between samples that counts as a jump
let trailTimer = 0;

const keys = { left: false, right: false, brake: false };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// A seeded LCG, so a course can be reproduced exactly by pinning `rngSeed`.
function rand() {
    rngSeed = (Math.imul(rngSeed, 1664525) + 1013904223) >>> 0;
    return rngSeed / 4294967296;
}

// The camera is derived, never stored: world y minus this is screen y.
function cameraY() {
    return skier.y - SKIER_SCREEN_Y;
}

function addObstacle(type, x, y) {
    const o = { type, x, y, hit: false };
    obstacles.push(o);
    return o;
}

function addGate(x, y) {
    const g = { x, y, state: 'pending' };
    gates.push(g);
    return g;
}

// ---------------------------------------------------------------------------
// Course generation
// ---------------------------------------------------------------------------

// The speed the hill allows at the current distance, and the row spacing that
// falls out of it. Both are read by the tests as the difficulty curve.
function speedCap() {
    return Math.min(SPEED_CAP_MAX, SPEED_BASE + distance * SPEED_GROWTH);
}

function rowGap() {
    const rowTime = Math.max(ROW_TIME_MIN, ROW_TIME_BASE - distance * ROW_TIME_SHRINK);
    return speedCap() * rowTime;
}

function nextCorridor(y) {
    const lo = CORRIDOR_EDGE + CLEAR_HALF;
    const hi = CANVAS_W - CORRIDOR_EDGE - CLEAR_HALF;
    const from = corridors.length ? corridors[corridors.length - 1].x : CANVAS_W / 2;
    const x = clamp(from + (rand() * 2 - 1) * CORRIDOR_SHIFT, lo, hi);
    const corridor = { x, y };
    corridors.push(corridor);
    return corridor;
}

function spawnRow(y) {
    const corridor = nextCorridor(y);

    if (rand() < GATE_CHANCE) {
        // A gate is the corridor, so the scoring line is always skiable.
        addGate(corridor.x, y);
        return;
    }

    const count = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
        const roll = rand();
        const type = roll < 0.55 ? 'tree' : roll < 0.85 ? 'rock' : 'ramp';
        // Roll positions until one falls outside the corridor; the piste is far
        // wider than the corridor, so this lands quickly.
        let x = null;
        for (let tries = 0; tries < 8 && x === null; tries++) {
            const candidate = 26 + rand() * (CANVAS_W - 52);
            if (Math.abs(candidate - corridor.x) >= CLEAR_HALF) x = candidate;
        }
        if (x !== null) addObstacle(type, x, y + rand() * 26);
    }
}

function spawnAhead() {
    if (!spawnEnabled) return;
    const gap = rowGap();
    while (spawnY < skier.y + SPAWN_AHEAD) {
        spawnRow(spawnY);
        spawnY += gap;
    }
}

function recordTrail(dt) {
    if (skier.air > 0) return;
    trailTimer += dt;
    if (trailTimer < TRAIL_SAMPLE) return;
    trailTimer = 0;
    trail.push({ x: skier.x, y: skier.y, angle: skier.angle });
    if (trail.length > TRAIL_MAX) trail.shift();
}

function cull() {
    const limit = skier.y - CULL_BEHIND;
    while (trail.length && trail[0].y < limit) trail.shift();
    while (corridors.length > 1 && corridors[0].y < limit) corridors.shift();
    for (let i = obstacles.length - 1; i >= 0; i--) {
        if (obstacles[i].y < limit) obstacles.splice(i, 1);
    }
    for (let i = gates.length - 1; i >= 0; i--) {
        if (gates[i].y < limit) gates.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function judgeGates() {
    for (const gate of gates) {
        if (gate.state !== 'pending' || skier.y <= gate.y) continue;
        if (Math.abs(skier.x - gate.x) <= GATE_HALF) {
            gate.state = 'passed';
            score += GATE_POINTS * combo;
            popup(`GATE +${GATE_POINTS * combo}`, '#2ea44f');
            combo = Math.min(COMBO_MAX, combo + 1);
        } else {
            gate.state = 'missed';
            combo = 1;
        }
    }
}

function collide() {
    for (const o of obstacles) {
        if (o.hit) continue;
        const box = OBSTACLE[o.type];
        if (Math.abs(skier.x - o.x) > SKIER_HW + box.hw) continue;
        if (Math.abs(skier.y - o.y) > SKIER_HH + box.hh) continue;

        if (o.type === 'ramp') {
            // Ramps only bite on the ground — you fly straight over one.
            if (skier.air <= 0) {
                o.hit = true;
                skier.air = RAMP_AIR;
                skier.airTime = 0;
            }
            continue;
        }
        if (box.airSafe && skier.air > 0) continue;
        if (skier.invuln > 0) continue;

        o.hit = true;
        crash();
        return;
    }
}

function land() {
    lastAirBonus = Math.round(skier.airTime * AIR_POINTS_PER_SEC);
    score += lastAirBonus;
    if (lastAirBonus > 0) popup(`AIR +${lastAirBonus}`, '#f0b429');
    skier.airTime = 0;
}

function crash() {
    lives--;
    combo = 1;
    skier.speed = 0;
    skier.angle = 0;
    skier.air = 0;
    skier.airTime = 0;
    state = 'crashing';
    crashTimer = CRASH_TIME;
    crashSpin = 0;
    popup('WIPEOUT', '#ef5b4c');
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('skislalom-best', String(best));
        } catch (err) {
            /* storage unavailable — the best score simply will not persist */
        }
    }
    updateHud();
    showOverlay('WIPEOUT', `Score ${score} · ${distance} m`, 'Press Space to run again');
}

function step(dt) {
    if (airPopup) {
        airPopup.life -= dt;
        if (airPopup.life <= 0) airPopup = null;
    }

    if (state === 'crashing') {
        crashTimer -= dt;
        crashSpin += dt * 6;
        if (crashTimer <= 0) {
            if (lives <= 0) gameOver();
            else {
                state = 'running';
                skier.invuln = INVULN_TIME;
            }
        }
        updateHud();
        return;
    }

    if (state !== 'running') return;

    // --- Steering --------------------------------------------------------
    const turn = skier.air > 0 ? TURN_RATE_AIR : TURN_RATE;
    if (keys.left) skier.angle -= turn * dt;
    if (keys.right) skier.angle += turn * dt;
    skier.angle = clamp(skier.angle, -MAX_ANGLE, MAX_ANGLE);

    // --- Speed -----------------------------------------------------------
    // The target already scales with cos(angle), and the descent is that speed
    // projected onto the fall line, so a hard carve costs downhill pace twice.
    const cap = speedCap();
    let target = SPEED_MIN + (cap - SPEED_MIN) * Math.cos(skier.angle);
    if (keys.brake && skier.air <= 0) target *= BRAKE_FACTOR;
    const rate = target > skier.speed ? ACCEL : DECEL;
    skier.speed += clamp(target - skier.speed, -rate * dt, rate * dt);

    // --- Motion ----------------------------------------------------------
    skier.x = clamp(
        skier.x + Math.sin(skier.angle) * skier.speed * dt,
        EDGE_MARGIN,
        CANVAS_W - EDGE_MARGIN
    );
    skier.y += Math.cos(skier.angle) * skier.speed * dt;

    if (skier.air > 0) {
        skier.air = Math.max(0, skier.air - dt);
        skier.airTime += dt;
        if (skier.air === 0) land();
    }
    if (skier.invuln > 0) skier.invuln = Math.max(0, skier.invuln - dt);

    // --- Distance --------------------------------------------------------
    const metres = Math.floor(skier.y / PX_PER_METER);
    if (metres > distance) {
        score += (metres - distance) * DIST_POINTS;
        distance = metres;
    }

    recordTrail(dt);
    spawnAhead();
    judgeGates();
    collide();
    cull();
    updateHud();
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    lives = START_LIVES;
    combo = 1;
    distance = 0;
    lastAirBonus = 0;
    crashTimer = 0;
    crashSpin = 0;
    airPopup = null;

    skier.x = CANVAS_W / 2;
    skier.y = 0;
    skier.angle = 0;
    skier.speed = 0;
    skier.air = 0;
    skier.airTime = 0;
    skier.invuln = 0;

    obstacles.length = 0;
    gates.length = 0;
    corridors.length = 0;
    trail.length = 0;
    trailTimer = 0;

    rngSeed = (Date.now() >>> 0) || 1;
    spawnEnabled = true;
    spawnY = SPAWN_START;
    spawnAhead();

    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score} · ${distance} m`, 'Press P to carry on');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function popup(text, color) {
    airPopup = { text, color, life: 1.1 };
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    distanceEl.textContent = String(distance);
    comboEl.textContent = `x${combo}`;
    livesEl.textContent = String(lives);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Run';
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// A fixed speckle band, scrolled and tiled, gives the snow a sense of motion
// without allocating anything per frame.
const SNOW_BAND = CANVAS_H;
const SNOW_SPECKLE = (() => {
    let seed = 20260911;
    const next = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    return Array.from({ length: 140 }, () => ({
        x: next() * CANVAS_W,
        y: next() * SNOW_BAND,
        r: 0.8 + next() * 1.6,
    }));
})();

function drawSnow(cam) {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#ffffff');
    sky.addColorStop(0.45, '#eaf4fb');
    sky.addColorStop(1, '#cfe2ef');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = 'rgba(120, 160, 190, 0.35)';
    const offset = ((-cam % SNOW_BAND) + SNOW_BAND) % SNOW_BAND;
    for (const s of SNOW_SPECKLE) {
        for (const band of [offset - SNOW_BAND, offset]) {
            const y = s.y + band;
            if (y < -4 || y > CANVAS_H + 4) continue;
            ctx.beginPath();
            ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawMarkers(cam) {
    // A faint line and a label every 100 metres, so progress is legible.
    const spacing = 100 * PX_PER_METER;
    const first = Math.floor(cam / spacing) * spacing;
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    for (let y = first; y < cam + CANVAS_H + spacing; y += spacing) {
        const sy = y - cam;
        if (sy < -20 || sy > CANVAS_H + 20) continue;
        ctx.strokeStyle = 'rgba(120, 160, 190, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 10]);
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(CANVAS_W, sy);
        ctx.stroke();
        ctx.setLineDash([]);
        if (y > 0) {
            ctx.fillStyle = 'rgba(70, 110, 140, 0.75)';
            ctx.fillText(`${Math.round(y / PX_PER_METER)} m`, 8, sy - 5);
        }
    }
}

function drawNetting(cam) {
    const spacing = 70;
    const first = Math.floor(cam / spacing) * spacing;
    for (let y = first; y < cam + CANVAS_H + spacing; y += spacing) {
        const sy = y - cam;
        for (const x of [7, CANVAS_W - 7]) {
            ctx.strokeStyle = '#e0703a';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x, sy);
            ctx.lineTo(x, sy + spacing);
            ctx.stroke();
            ctx.fillStyle = '#8a5a3b';
            ctx.fillRect(x - 2, sy - 2, 4, 12);
        }
    }
}

function drawTree(x, y) {
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(x - 2.5, y + 4, 5, 12);
    ctx.fillStyle = '#1f6b3a';
    for (let i = 0; i < 3; i++) {
        const w = 15 - i * 3;
        const top = y - 16 + i * 8;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x + w, top + 12);
        ctx.lineTo(x - w, top + 12);
        ctx.closePath();
        ctx.fill();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x + 5, y - 8);
    ctx.lineTo(x - 5, y - 8);
    ctx.closePath();
    ctx.fill();
}

function drawRock(x, y) {
    ctx.fillStyle = '#77818a';
    ctx.beginPath();
    ctx.moveTo(x - 11, y + 7);
    ctx.lineTo(x - 7, y - 6);
    ctx.lineTo(x + 2, y - 8);
    ctx.lineTo(x + 11, y + 2);
    ctx.lineTo(x + 6, y + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#9aa5ad';
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 6);
    ctx.lineTo(x + 2, y - 8);
    ctx.lineTo(x - 1, y + 1);
    ctx.closePath();
    ctx.fill();
}

function drawRamp(x, y) {
    ctx.fillStyle = '#b9d6e8';
    ctx.beginPath();
    ctx.moveTo(x - 22, y + 9);
    ctx.lineTo(x + 22, y + 9);
    ctx.lineTo(x + 22, y - 9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#7ba7c4';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(x + 12, y - 9, 10, 4);
}

function drawTracks(cam) {
    // Two grooves following the sampled path, broken wherever the skier flew.
    ctx.strokeStyle = 'rgba(146, 178, 200, 0.65)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i < trail.length; i++) {
            const p = trail[i];
            const prev = trail[i - 1];
            const x = p.x + side * 5 * Math.cos(p.angle);
            const y = p.y - cam - side * 5 * Math.sin(p.angle);
            if (!prev || Math.abs(p.y - prev.y) > TRAIL_BREAK) {
                ctx.moveTo(x, y);
                pen = true;
            } else if (pen) {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    }
}

function drawGate(gate, cam) {
    const sy = gate.y - cam;
    const color = GATE_COLOR[gate.state];
    for (const side of [-1, 1]) {
        const x = gate.x + side * GATE_HALF;
        ctx.strokeStyle = '#5a6a76';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x, sy + 6);
        ctx.lineTo(x, sy - 26);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, sy - 26);
        ctx.lineTo(x + side * 18, sy - 19);
        ctx.lineTo(x, sy - 12);
        ctx.closePath();
        ctx.fill();
    }
    ctx.strokeStyle = gate.state === 'pending' ? 'rgba(47, 111, 208, 0.25)' : 'rgba(0,0,0,0)';
    ctx.setLineDash([5, 7]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(gate.x - GATE_HALF, sy);
    ctx.lineTo(gate.x + GATE_HALF, sy);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawSkier() {
    const x = skier.x;
    const y = SKIER_SCREEN_Y;
    const flying = skier.air > 0;
    // The hop lifts the sprite off its shadow across the flight.
    const total = skier.air + skier.airTime;
    const hop = flying && total > 0 ? Math.sin((skier.airTime / total) * Math.PI) * 20 : 0;

    ctx.save();
    ctx.fillStyle = 'rgba(60, 90, 110, 0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 11, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Flash through the grace period after getting back up.
    if (skier.invuln > 0 && Math.floor(skier.invuln * 12) % 2 === 0) return;

    ctx.save();
    ctx.translate(x, y - hop);

    if (state === 'crashing' || state === 'over') {
        // Stay face-down in the snow once the run has ended, too.
        ctx.rotate(crashSpin);
        ctx.strokeStyle = '#d94a3d';
        ctx.lineWidth = 3;
        for (const a of [-0.7, 0.4]) {
            ctx.save();
            ctx.rotate(a);
            ctx.beginPath();
            ctx.moveTo(-16, 6);
            ctx.lineTo(16, 6);
            ctx.stroke();
            ctx.restore();
        }
        ctx.fillStyle = '#1d4159';
        ctx.beginPath();
        ctx.arc(0, -2, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }

    ctx.rotate(skier.angle);

    // Skis
    ctx.strokeStyle = '#1d2b36';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const dx of [-5, 5]) {
        ctx.beginPath();
        ctx.moveTo(dx, -10);
        ctx.lineTo(dx, 14);
        ctx.stroke();
    }

    // Poles
    ctx.strokeStyle = '#41586a';
    ctx.lineWidth = 1.5;
    for (const dx of [-10, 10]) {
        ctx.beginPath();
        ctx.moveTo(dx, -4);
        ctx.lineTo(dx * 1.3, 10);
        ctx.stroke();
    }

    // Body and head
    ctx.fillStyle = '#e8503f';
    ctx.beginPath();
    ctx.roundRect(-6, -10, 12, 15, 4);
    ctx.fill();
    ctx.fillStyle = '#f5d6a8';
    ctx.beginPath();
    ctx.arc(0, -13, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f6fd0';
    ctx.beginPath();
    ctx.arc(0, -14.5, 5, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // A spray of snow behind a hard carve.
    if (!flying && state === 'running' && Math.abs(skier.angle) > 0.5 && skier.speed > 60) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        for (let i = 1; i <= 3; i++) {
            ctx.beginPath();
            ctx.arc(x - Math.sin(skier.angle) * i * 9, y - i * 5, 4 - i * 0.7, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawSpeedGauge() {
    const w = 110;
    const h = 7;
    const x = 12;
    const y = CANVAS_H - 22;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = 'rgba(120, 160, 190, 0.4)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#2f6fd0';
    ctx.fillRect(x, y, w * clamp(skier.speed / SPEED_CAP_MAX, 0, 1), h);
    ctx.fillStyle = 'rgba(40, 80, 110, 0.85)';
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`${Math.round(skier.speed / 3)} km/h`, x, y - 6);
}

function drawPopup() {
    if (!airPopup) return;
    ctx.save();
    ctx.globalAlpha = clamp(airPopup.life, 0, 1);
    ctx.fillStyle = airPopup.color;
    ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(airPopup.text, CANVAS_W / 2, 80 - (1.1 - airPopup.life) * 22);
    ctx.restore();
    ctx.textAlign = 'left';
}

function draw() {
    const cam = cameraY();
    drawSnow(cam);
    drawMarkers(cam);
    drawTracks(cam);
    drawNetting(cam);

    for (const gate of gates) {
        const sy = gate.y - cam;
        if (sy < -60 || sy > CANVAS_H + 60) continue;
        drawGate(gate, cam);
    }

    for (const o of obstacles) {
        const sy = o.y - cam;
        if (sy < -40 || sy > CANVAS_H + 40) continue;
        if (o.type === 'tree') drawTree(o.x, sy);
        else if (o.type === 'rock') drawRock(o.x, sy);
        else drawRamp(o.x, sy);
    }

    drawSkier();
    drawSpeedGauge();
    drawPopup();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const HELD = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowDown: 'brake',
    a: 'left',
    A: 'left',
    d: 'right',
    D: 'right',
    s: 'brake',
    S: 'brake',
};

document.addEventListener('keydown', (e) => {
    const held = HELD[e.key];
    if (held) {
        keys[held] = true;
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running' && skier.air <= 0) {
            skier.air = JUMP_AIR;
            skier.airTime = 0;
        }
        return;
    }
    if (e.key === 'Enter') {
        if (state !== 'running') startGame();
        return;
    }
    if (e.key === 'p' || e.key === 'P') togglePause();
});

document.addEventListener('keyup', (e) => {
    const held = HELD[e.key];
    if (held) keys[held] = false;
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
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

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = (() => {
    try {
        return parseInt(localStorage.getItem('skislalom-best') || '0', 10) || 0;
    } catch (err) {
        return 0;
    }
})();
state = 'idle';
score = 0;
lives = START_LIVES;
combo = 1;
distance = 0;
lastAirBonus = 0;
crashTimer = 0;
crashSpin = 0;
spawnEnabled = false;
spawnY = SPAWN_START;
rngSeed = 1;
updateHud();
showOverlay('SKI SLALOM', '', 'Press Space or click Start to drop in');
requestAnimationFrame(frame);
