// ---------------------------------------------------------------------------
// Air Traffic Control — route inbound aircraft onto their landing sites by
// drawing flight paths across a radar scope, without ever letting two of them
// touch.
//
// Aircraft drift in from the edges and fly straight ahead until the controller
// drags a path out of one. A path is a list of waypoints; each frame the
// aircraft gets a travel budget of `speed * dt` pixels and walks as far along
// the path as that buys. Jets land on the runway, helicopters on the helipad.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Slime Volley,
// Kaboom and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so tests can simulate frames deterministically
// without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Scope geometry ---
const CANVAS_W = 720;
const CANVAS_H = 480;
const EDGE_MARGIN = 8;              // aircraft reflect off this inset boundary

// --- Aircraft ---
const JET_SPEED = 62;               // px/s
const HELI_SPEED = 40;              // px/s
const JET_SHARE = 0.6;              // fraction of arrivals that are jets

// --- Radii ---
const SEPARATION_RADIUS = 20;       // closer than this is a collision
const ALERT_RADIUS = 52;            // closer than this raises a warning
const LANDING_RADIUS = 16;          // close enough to the pad to land
const GRAB_RADIUS = 22;             // how near a press must be to route a craft
const PATH_POINT_SPACING = 6;       // minimum gap between drawn waypoints

// --- Arrivals ---
const MAX_TRAFFIC = 7;
const SPAWN_INTERVAL_START = 4.5;   // seconds between arrivals at score 0
const SPAWN_INTERVAL_MIN = 1.8;     // ...and the floor once it has ramped up
const SPAWN_RAMP = 0.12;            // seconds shaved off per landing
const SPAWN_INSET = 14;             // how far inside the edge arrivals appear

// --- The airfield ---
const DESTINATIONS = [
    { type: 'jet', x: 156, y: 396, angle: 0, label: 'RWY 09' },
    { type: 'heli', x: 592, y: 108, angle: 0, label: 'HELIPAD' },
];

const COLORS = {
    jet: '#4fd6ff',
    heli: '#ffb347',
    danger: '#ff5b6e',
};

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const trafficEl = document.getElementById('traffic');
const warningEl = document.getElementById('warning');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let state = 'idle';                 // idle | running | paused | over
let aircraft = [];
let score = 0;
let best = 0;
let spawnTimer = 0;
let nextId = 1;
let drawing = null;                 // { id, points } while a path is being drawn
let crashAt = null;                 // { x, y } marker for the last collision
let pulse = 0;                      // drives the alert-ring animation
let lastFrame = 0;

// ---------------------------------------------------------------------------
// Seeded randomness — a small LCG so a seeded run replays exactly
// ---------------------------------------------------------------------------

let seed = 123456789;

function setSeed(n) {
    seed = (n >>> 0) || 1;
}

function rand() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
}

function randRange(lo, hi) {
    return lo + rand() * (hi - lo);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function normalizeAngle(a) {
    return Math.atan2(Math.sin(a), Math.cos(a));
}

function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
}

function destinationFor(type) {
    return DESTINATIONS.find((d) => d.type === type) || null;
}

function spawnInterval() {
    return Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_START - score * SPAWN_RAMP);
}

// ---------------------------------------------------------------------------
// Aircraft
// ---------------------------------------------------------------------------

function speedFor(type) {
    return type === 'heli' ? HELI_SPEED : JET_SPEED;
}

/**
 * Add an aircraft. With no options a random arrival is generated just inside a
 * random edge, heading roughly for the middle of the scope; that placement is
 * retried a few times so arrivals do not appear on top of existing traffic, and
 * is skipped entirely when the scope is full or no clear slot is found.
 */
function spawnAircraft(opts) {
    const o = opts || {};
    const type = o.type || (rand() < JET_SHARE ? 'jet' : 'heli');
    let x = o.x;
    let y = o.y;
    let heading = o.heading;

    if (x === undefined || y === undefined) {
        if (aircraft.length >= MAX_TRAFFIC) return null;
        let placed = false;
        for (let attempt = 0; attempt < 8 && !placed; attempt++) {
            const side = Math.floor(rand() * 4);
            if (side === 0) { x = SPAWN_INSET; y = randRange(40, CANVAS_H - 40); }
            else if (side === 1) { x = CANVAS_W - SPAWN_INSET; y = randRange(40, CANVAS_H - 40); }
            else if (side === 2) { x = randRange(40, CANVAS_W - 40); y = SPAWN_INSET; }
            else { x = randRange(40, CANVAS_W - 40); y = CANVAS_H - SPAWN_INSET; }
            placed = aircraft.every((c) => dist(c.x, c.y, x, y) > ALERT_RADIUS * 1.5);
        }
        if (!placed) return null;
        const toCentre = Math.atan2(CANVAS_H / 2 - y, CANVAS_W / 2 - x);
        heading = normalizeAngle(toCentre + randRange(-0.5, 0.5));
    }

    const id = nextId++;
    const craft = {
        id,
        type,
        x,
        y,
        heading: heading === undefined ? 0 : normalizeAngle(heading),
        speed: o.speed === undefined ? speedFor(type) : o.speed,
        path: [],
        alert: false,
        callsign: (type === 'jet' ? 'JT' : 'HX') + String(100 + (id % 900)),
    };
    aircraft.push(craft);
    return craft;
}

/** Replace an aircraft's flight path, clamping every waypoint into the scope. */
function setPath(craft, points) {
    craft.path = points.map((p) => ({
        x: clamp(p.x, 0, CANVAS_W),
        y: clamp(p.y, 0, CANVAS_H),
    }));
}

/** Fly one aircraft for `dt` seconds: along its path, then straight ahead. */
function advance(craft, dt) {
    let budget = craft.speed * dt;

    while (budget > 0 && craft.path.length > 0) {
        const wp = craft.path[0];
        const dx = wp.x - craft.x;
        const dy = wp.y - craft.y;
        const d = Math.hypot(dx, dy);
        if (d > 0) craft.heading = Math.atan2(dy, dx);
        if (d <= budget) {
            craft.x = wp.x;
            craft.y = wp.y;
            budget -= d;
            craft.path.shift();
        } else {
            craft.x += (dx / d) * budget;
            craft.y += (dy / d) * budget;
            budget = 0;
        }
    }

    if (budget > 0) {
        craft.x += Math.cos(craft.heading) * budget;
        craft.y += Math.sin(craft.heading) * budget;
    }

    reflectIntoScope(craft);
}

/** Keep an aircraft inside the scope, bouncing its heading off the boundary. */
function reflectIntoScope(craft) {
    if (craft.x < EDGE_MARGIN) {
        craft.x = EDGE_MARGIN;
        craft.heading = normalizeAngle(Math.PI - craft.heading);
    } else if (craft.x > CANVAS_W - EDGE_MARGIN) {
        craft.x = CANVAS_W - EDGE_MARGIN;
        craft.heading = normalizeAngle(Math.PI - craft.heading);
    }
    if (craft.y < EDGE_MARGIN) {
        craft.y = EDGE_MARGIN;
        craft.heading = normalizeAngle(-craft.heading);
    } else if (craft.y > CANVAS_H - EDGE_MARGIN) {
        craft.y = CANVAS_H - EDGE_MARGIN;
        craft.heading = normalizeAngle(-craft.heading);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    pulse += dt;

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawnAircraft();
        spawnTimer = spawnInterval();
    }

    for (const craft of aircraft) advance(craft, dt);

    handleLandings();
    if (state === 'running') checkSeparation();
    updateHud();
}

function handleLandings() {
    for (let i = aircraft.length - 1; i >= 0; i--) {
        const craft = aircraft[i];
        const dest = destinationFor(craft.type);
        if (dest && dist(craft.x, craft.y, dest.x, dest.y) <= LANDING_RADIUS) {
            aircraft.splice(i, 1);
            if (drawing && drawing.id === craft.id) drawing = null;
            score++;
            recordBest();
        }
    }
}

function checkSeparation() {
    for (const craft of aircraft) craft.alert = false;

    for (let i = 0; i < aircraft.length; i++) {
        for (let j = i + 1; j < aircraft.length; j++) {
            const a = aircraft[i];
            const b = aircraft[j];
            const d = dist(a.x, a.y, b.x, b.y);
            if (d <= SEPARATION_RADIUS) {
                crash(a, b);
                return;
            }
            if (d <= ALERT_RADIUS) {
                a.alert = true;
                b.alert = true;
            }
        }
    }
}

function crash(a, b) {
    crashAt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    state = 'over';
    drawing = null;
    recordBest();
    updateHud();
    showOverlay(
        'MID-AIR COLLISION',
        `Aircraft landed: ${score}`,
        'Keep them apart. Press Space to take another shift.',
        'Start Shift',
    );
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    aircraft = [];
    drawing = null;
    crashAt = null;
    score = 0;
    pulse = 0;
    spawnTimer = spawnInterval();
    state = 'running';
    hideOverlay();
    spawnAircraft();
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        drawing = null;
        showOverlay('PAUSED', '', 'Press P to resume.', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function recordBest() {
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('air-traffic-control-best', String(best));
        } catch (err) {
            /* private mode — the run just will not be remembered */
        }
    }
}

// ---------------------------------------------------------------------------
// Path drawing — pointer-independent so tests can drive either level
// ---------------------------------------------------------------------------

function craftAt(x, y) {
    let closest = null;
    let closestD = GRAB_RADIUS;
    for (const craft of aircraft) {
        const d = dist(craft.x, craft.y, x, y);
        if (d <= closestD) {
            closest = craft;
            closestD = d;
        }
    }
    return closest;
}

function beginDraw(x, y) {
    if (state !== 'running') return null;
    const craft = craftAt(x, y);
    if (!craft) return null;
    drawing = { id: craft.id, points: [{ x, y }] };
    return craft;
}

function dragDraw(x, y) {
    if (!drawing) return;
    const last = drawing.points[drawing.points.length - 1];
    if (dist(last.x, last.y, x, y) < PATH_POINT_SPACING) return;
    drawing.points.push({ x: clamp(x, 0, CANVAS_W), y: clamp(y, 0, CANVAS_H) });
}

function endDraw() {
    if (!drawing) return;
    const craft = aircraft.find((c) => c.id === drawing.id);
    if (craft) {
        // A press with no drag is a request to cancel the current routing.
        setPath(craft, drawing.points.length > 1 ? drawing.points : []);
    }
    drawing = null;
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    trafficEl.textContent = String(aircraft.length);
    const alerting = state === 'running' && aircraft.some((c) => c.alert);
    warningEl.classList.toggle('visible', alerting);
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
    drawScope();
    for (const dest of DESTINATIONS) drawDestination(dest);
    for (const craft of aircraft) drawPath(craft);
    if (drawing) drawPendingPath();
    for (const craft of aircraft) drawAircraft(craft);
    if (crashAt) drawCrash();
}

function drawScope() {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#071726');
    sky.addColorStop(1, '#040d16');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.strokeStyle = 'rgba(79, 214, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 40; x < CANVAS_W; x += 40) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CANVAS_H);
    }
    for (let y = 40; y < CANVAS_H; y += 40) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(CANVAS_W, y + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(79, 214, 255, 0.09)';
    for (let r = 80; r <= 320; r += 80) {
        ctx.beginPath();
        ctx.arc(CANVAS_W / 2, CANVAS_H / 2, r, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(79, 214, 255, 0.16)';
    ctx.strokeRect(EDGE_MARGIN + 0.5, EDGE_MARGIN + 0.5,
        CANVAS_W - EDGE_MARGIN * 2 - 1, CANVAS_H - EDGE_MARGIN * 2 - 1);
}

function drawDestination(dest) {
    ctx.save();
    ctx.translate(dest.x, dest.y);
    const color = COLORS[dest.type];

    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, LANDING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (dest.type === 'jet') {
        ctx.rotate(dest.angle);
        ctx.fillStyle = 'rgba(79, 214, 255, 0.16)';
        ctx.fillRect(-18, -11, 128, 22);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-18, -11, 128, 22);
        ctx.setLineDash([9, 9]);
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(104, 0);
        ctx.stroke();
        ctx.setLineDash([]);
    } else {
        ctx.fillStyle = 'rgba(255, 179, 71, 0.16)';
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = 'bold 16px "Segoe UI", sans-serif';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('H', 0, 1);
    }

    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(dest.label, -18, -18);
    ctx.restore();
}

function drawPolyline(fromX, fromY, points, color, alpha) {
    if (points.length === 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    for (const p of points) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const end = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(end.x, end.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}

function drawPath(craft) {
    drawPolyline(craft.x, craft.y, craft.path, COLORS[craft.type], 0.5);
}

function drawPendingPath() {
    const craft = aircraft.find((c) => c.id === drawing.id);
    if (!craft) return;
    drawPolyline(craft.x, craft.y, drawing.points, '#ffffff', 0.75);
}

function drawAircraft(craft) {
    const color = craft.alert ? COLORS.danger : COLORS[craft.type];

    if (craft.alert) {
        const r = SEPARATION_RADIUS + 6 + Math.sin(pulse * 8) * 3;
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = COLORS.danger;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(craft.x, craft.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    ctx.save();
    ctx.translate(craft.x, craft.y);
    ctx.rotate(craft.heading);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    if (craft.type === 'jet') {
        ctx.beginPath();
        ctx.moveTo(11, 0);
        ctx.lineTo(-7, 7);
        ctx.lineTo(-3, 0);
        ctx.lineTo(-7, -7);
        ctx.closePath();
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-7, 0);
        ctx.lineTo(-12, 0);
        ctx.stroke();
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = color;
    ctx.font = '9px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(craft.callsign, craft.x, craft.y - 14);
    ctx.restore();
}

function drawCrash() {
    ctx.save();
    ctx.translate(crashAt.x, crashAt.y);
    ctx.strokeStyle = COLORS.danger;
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
        ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.danger;
    ctx.fill();
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

function frame(now) {
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
    lastFrame = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (CANVAS_W / rect.width),
        y: (e.clientY - rect.top) * (CANVAS_H / rect.height),
    };
}

canvas.addEventListener('pointerdown', (e) => {
    const p = pointerPos(e);
    if (beginDraw(p.x, p.y)) {
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
    }
});

canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pointerPos(e);
    dragDraw(p.x, p.y);
    e.preventDefault();
});

canvas.addEventListener('pointerup', () => endDraw());
canvas.addEventListener('pointercancel', () => endDraw());
canvas.addEventListener('pointerleave', () => endDraw());

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') {
            togglePause();
            e.preventDefault();
        }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'paused') togglePause();
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('air-traffic-control-best') || '0', 10) || 0;
setSeed((Date.now() ^ 0x9e3779b9) >>> 0);
state = 'idle';
updateHud();
draw();
requestAnimationFrame(frame);
