// ---------------------------------------------------------------------------
// Billiards — a top-down pool table on an HTML5 canvas.
//
// The player breaks a rack of ten object balls, pots the nine colours and then
// the black 8 to clear the rack; clearing a rack racks up a fresh one, and
// potting the 8 while colours are still on the table ends the run. Written as a
// single classic (non-module) script so the state and the physics are reachable
// from the Playwright tests as plain globals, mirroring Kaboom, Snake and Tetris
// in this repo. All motion is expressed per second and advanced through
// `step(dt)`, which sub-steps internally, so the tests can simulate shots
// deterministically without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Table geometry ---
const CANVAS_W = 720;
const CANVAS_H = 400;
const RAIL = 30;                       // cushion thickness
const LEFT = RAIL;
const RIGHT = CANVAS_W - RAIL;
const TOP = RAIL;
const BOTTOM = CANVAS_H - RAIL;
const BALL_R = 9;
const POCKET_R = 17;

// --- Physics ---
const MAX_SPEED = 1150;                // px/s at full power
const DECEL = 240;                     // px/s^2 of rolling friction
const STOP_SPEED = 6;                  // below this a ball is parked
const CUSHION_LOSS = 0.86;             // speed kept after a cushion bounce
const BALL_RESTITUTION = 0.96;         // ball-on-ball bounciness
const SUBSTEP = 1 / 240;               // fixed physics tick

// --- Shot input ---
const CHARGE_RATE = 1.1;               // power gained per second while held
const AIM_STEP = 0.025;                // radians per arrow key press

// --- Scoring ---
const POT_POINTS = 100;
const FOUL_PENALTY = 50;
const RACK_BONUS = 300;
const BEST_KEY = 'billiards-best';

// --- The rack ---
const RACK_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 9, 10];
const BALL_COLOURS = {
    1: '#f5c518', 2: '#2a5fd4', 3: '#d63a2f', 4: '#7b3fb5', 5: '#ef7d1a',
    6: '#1f9d55', 7: '#8c3b2f', 8: '#15181c', 9: '#f5c518', 10: '#2a5fd4',
};

// --- Pockets ---
const pockets = [
    { x: LEFT, y: TOP }, { x: (LEFT + RIGHT) / 2, y: TOP }, { x: RIGHT, y: TOP },
    { x: LEFT, y: BOTTOM }, { x: (LEFT + RIGHT) / 2, y: BOTTOM }, { x: RIGHT, y: BOTTOM },
];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const rackEl = document.getElementById('rack');
const leftEl = document.getElementById('left');
const shotsEl = document.getElementById('shots');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'ready' | 'rolling' | 'over'
let state = 'idle';
let score = 0, best = 0, shots = 0, fouls = 0, racks = 1;
let aimAngle = 0, power = 0, charging = false, won = false;
let scratched = false, eightPotted = false;
const balls = [];
let cueBall = null;
let flash = null;                      // transient on-table message {text, colour, ttl}

function setFlash(text, colour) {
    flash = { text, colour, ttl: 1.4 };
}

// ---------------------------------------------------------------------------
// Rack setup
// ---------------------------------------------------------------------------

function makeBall(num, x, y, opts = {}) {
    return {
        num,
        x, y,
        vx: 0, vy: 0,
        pocketed: false,
        isCue: !!opts.isCue,
        isEight: num === 8,
        stripe: num > 8,
        colour: opts.isCue ? '#f6f3ea' : BALL_COLOURS[num],
    };
}

function headSpot() {
    return { x: LEFT + (RIGHT - LEFT) * 0.25, y: (TOP + BOTTOM) / 2 };
}

// Builds the standard triangle: rows of 1, 2, 3 and 4 balls with the 8 sitting
// in the middle of the third row, exactly as in a real 8-ball rack.
function newRack() {
    balls.length = 0;
    const spot = headSpot();
    cueBall = makeBall(0, spot.x, spot.y, { isCue: true });
    balls.push(cueBall);

    const spacing = 2 * BALL_R + 0.5;          // a hair of daylight between balls
    const dx = spacing * Math.cos(Math.PI / 6);
    const apexX = LEFT + (RIGHT - LEFT) * 0.72;
    const cy = (TOP + BOTTOM) / 2;
    const queue = RACK_NUMBERS.slice();

    for (let row = 0; row < 4; row++) {
        for (let j = 0; j <= row; j++) {
            const num = (row === 2 && j === 1) ? 8 : queue.shift();
            const x = apexX + row * dx;
            const y = cy + (j - row / 2) * spacing;
            balls.push(makeBall(num, x, y));
        }
    }
}

function objectBalls() {
    return balls.filter((b) => !b.isCue);
}

function ballsLeft() {
    return objectBalls().filter((b) => !b.pocketed).length;
}

function coloursLeft() {
    return objectBalls().filter((b) => !b.isEight && !b.pocketed).length;
}

function activeBalls() {
    return balls.filter((b) => !b.pocketed);
}

// ---------------------------------------------------------------------------
// Shot input
// ---------------------------------------------------------------------------

function setAim(angle) {
    aimAngle = angle;
}

function aimAt(x, y) {
    if (!cueBall) return;
    setAim(Math.atan2(y - cueBall.y, x - cueBall.x));
}

function setPower(p) {
    power = Math.max(0, Math.min(1, p));
}

function beginCharge() {
    if (state !== 'ready') return;
    charging = true;
    power = 0;
}

function releaseCharge() {
    if (!charging) return;
    charging = false;
    const p = power;
    power = 0;
    shoot(aimAngle, p);
}

function shoot(angle, pwr) {
    if (state !== 'ready' || !cueBall || cueBall.pocketed) return false;
    if (!(pwr > 0)) return false;
    const speed = MAX_SPEED * Math.min(1, pwr);
    cueBall.vx = Math.cos(angle) * speed;
    cueBall.vy = Math.sin(angle) * speed;
    shots++;
    scratched = false;
    eightPotted = false;
    charging = false;
    power = 0;
    state = 'rolling';
    updateHud();
    return true;
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

function applyFriction(b, h) {
    const speed = Math.hypot(b.vx, b.vy);
    if (speed === 0) return;
    if (speed <= STOP_SPEED) { b.vx = 0; b.vy = 0; return; }
    const next = Math.max(0, speed - DECEL * h);
    b.vx = (b.vx / speed) * next;
    b.vy = (b.vy / speed) * next;
}

function checkPockets() {
    for (const b of balls) {
        if (b.pocketed) continue;
        for (const p of pockets) {
            if (Math.hypot(b.x - p.x, b.y - p.y) <= POCKET_R) {
                pocketBall(b);
                break;
            }
        }
    }
}

function bounceCushions(b) {
    if (b.x < LEFT + BALL_R) { b.x = LEFT + BALL_R; b.vx = -b.vx * CUSHION_LOSS; }
    if (b.x > RIGHT - BALL_R) { b.x = RIGHT - BALL_R; b.vx = -b.vx * CUSHION_LOSS; }
    if (b.y < TOP + BALL_R) { b.y = TOP + BALL_R; b.vy = -b.vy * CUSHION_LOSS; }
    if (b.y > BOTTOM - BALL_R) { b.y = BOTTOM - BALL_R; b.vy = -b.vy * CUSHION_LOSS; }
}

// Equal-mass collision: only the component along the line of centres is
// exchanged, which is what makes cut shots behave like real pool.
function collide(a, b) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dist = Math.hypot(dx, dy);
    if (dist === 0) { dx = 1; dy = 0; dist = 1; }         // perfectly stacked
    if (dist >= 2 * BALL_R) return;

    const nx = dx / dist;
    const ny = dy / dist;

    // Push the pair apart so they never end a tick overlapping.
    const overlap = (2 * BALL_R - dist) / 2 + 0.001;
    a.x -= nx * overlap; a.y -= ny * overlap;
    b.x += nx * overlap; b.y += ny * overlap;

    const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (approach <= 0) return;                            // already separating
    const impulse = approach * (1 + BALL_RESTITUTION) / 2;
    a.vx -= impulse * nx; a.vy -= impulse * ny;
    b.vx += impulse * nx; b.vy += impulse * ny;
}

function integrate(h) {
    const live = activeBalls();
    for (const b of live) {
        applyFriction(b, h);
        b.x += b.vx * h;
        b.y += b.vy * h;
    }
    checkPockets();
    for (const b of activeBalls()) bounceCushions(b);
    const rest = activeBalls();
    for (let i = 0; i < rest.length; i++) {
        for (let j = i + 1; j < rest.length; j++) collide(rest[i], rest[j]);
    }
}

function allStopped() {
    return activeBalls().every((b) => b.vx === 0 && b.vy === 0);
}

function step(dt) {
    if (charging && state === 'ready') setPower(power + CHARGE_RATE * dt);
    if (state !== 'rolling') return;
    let remaining = Math.min(dt, 0.1);
    while (remaining > 0) {
        const h = Math.min(SUBSTEP, remaining);
        integrate(h);
        remaining -= h;
    }
    if (allStopped()) resolveShot();
}

// ---------------------------------------------------------------------------
// Potting and shot resolution
// ---------------------------------------------------------------------------

function pocketBall(b) {
    if (b.pocketed) return;
    b.pocketed = true;
    b.vx = 0;
    b.vy = 0;
    if (b.isCue) {
        scratched = true;
        setFlash('SCRATCH', '#f87171');
    } else if (b.isEight) {
        eightPotted = true;
    } else {
        score += POT_POINTS;
        setFlash(`+${POT_POINTS}`, '#7ddc8a');
    }
    updateHud();
}

// Drops the cue ball back on the head spot, sliding it left along the baulk
// line if something is already parked there.
function respotCue() {
    const spot = headSpot();
    let x = spot.x;
    const y = spot.y;
    for (let tries = 0; tries < 40; tries++) {
        const clash = objectBalls().some((b) =>
            !b.pocketed && Math.hypot(b.x - x, b.y - y) < 2 * BALL_R + 1);
        if (!clash) break;
        x -= BALL_R;
        if (x < LEFT + BALL_R) x = LEFT + BALL_R;
    }
    cueBall.x = Math.max(LEFT + BALL_R, Math.min(RIGHT - BALL_R, x));
    cueBall.y = y;
    cueBall.vx = 0;
    cueBall.vy = 0;
    cueBall.pocketed = false;
}

function resolveShot() {
    charging = false;
    power = 0;

    if (scratched) {
        fouls++;
        score = Math.max(0, score - FOUL_PENALTY);
    }

    if (eightPotted) {
        if (coloursLeft() > 0) {
            eightPotted = false;
            scratched = false;
            updateHud();
            endGame(false);
            return;
        }
        score += RACK_BONUS;
        racks++;
        setFlash(`RACK CLEARED +${RACK_BONUS}`, '#f0c46a');
        newRack();
    } else if (scratched) {
        respotCue();
    }

    scratched = false;
    eightPotted = false;
    state = 'ready';
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    shots = 0;
    fouls = 0;
    racks = 1;
    power = 0;
    charging = false;
    won = false;
    scratched = false;
    eightPotted = false;
    aimAngle = 0;
    flash = null;
    newRack();
    state = 'ready';
    hideOverlay();
    updateHud();
}

function endGame(didWin) {
    state = 'over';
    won = !!didWin;
    charging = false;
    power = 0;
    if (score > best) {
        best = score;
        try { window.localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
    }
    updateHud();
    showOverlay(
        didWin ? 'TABLE CLEARED' : '8 BALL POTTED EARLY',
        `Score ${score} · rack ${racks} · ${shots} shot${shots === 1 ? '' : 's'}`,
        didWin ? 'Nicely done' : 'Clear the colours before the 8',
        'Play Again');
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

function updateHud() {
    scoreEl.textContent = score;
    rackEl.textContent = racks;
    leftEl.textContent = ballsLeft();
    shotsEl.textContent = shots;
    bestEl.textContent = best;
}

function loadBest() {
    let stored = null;
    try { stored = window.localStorage.getItem(BEST_KEY); } catch (e) { /* ignore */ }
    const value = parseInt(stored, 10);
    best = Number.isFinite(value) ? value : 0;
}

// ---------------------------------------------------------------------------
// Aiming helpers (used by the guide line)
// ---------------------------------------------------------------------------

// How far the cue ball can travel along the aim line before it touches
// something, plus the ball it would touch (null for a cushion).
function aimContact() {
    if (!cueBall) return null;
    const ox = Math.cos(aimAngle);
    const oy = Math.sin(aimAngle);
    let bestDist = Infinity;
    let hit = null;

    for (const b of activeBalls()) {
        if (b === cueBall) continue;
        const rx = b.x - cueBall.x;
        const ry = b.y - cueBall.y;
        const along = rx * ox + ry * oy;
        if (along <= 0) continue;
        const perp2 = rx * rx + ry * ry - along * along;
        const r = 2 * BALL_R;
        if (perp2 > r * r) continue;
        const d = along - Math.sqrt(r * r - perp2);
        if (d >= 0 && d < bestDist) { bestDist = d; hit = b; }
    }

    // Cushion fallback so the guide always terminates somewhere sensible.
    const limits = [];
    if (ox > 0) limits.push((RIGHT - BALL_R - cueBall.x) / ox);
    if (ox < 0) limits.push((LEFT + BALL_R - cueBall.x) / ox);
    if (oy > 0) limits.push((BOTTOM - BALL_R - cueBall.y) / oy);
    if (oy < 0) limits.push((TOP + BALL_R - cueBall.y) / oy);
    const cushion = limits.length ? Math.max(0, Math.min(...limits)) : 0;
    if (cushion < bestDist) { bestDist = cushion; hit = null; }

    return {
        dist: bestDist,
        x: cueBall.x + ox * bestDist,
        y: cueBall.y + oy * bestDist,
        ball: hit,
    };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawTable() {
    ctx.fillStyle = '#4a2c17';
    roundRect(0, 0, CANVAS_W, CANVAS_H, 12);
    ctx.fill();

    ctx.fillStyle = '#5d3a1e';
    roundRect(6, 6, CANVAS_W - 12, CANVAS_H - 12, 9);
    ctx.fill();

    ctx.fillStyle = '#146b3f';
    ctx.fillRect(LEFT, TOP, RIGHT - LEFT, BOTTOM - TOP);

    const cloth = ctx.createRadialGradient(
        CANVAS_W / 2, CANVAS_H / 2, 40, CANVAS_W / 2, CANVAS_H / 2, 420);
    cloth.addColorStop(0, 'rgba(255,255,255,0.10)');
    cloth.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = cloth;
    ctx.fillRect(LEFT, TOP, RIGHT - LEFT, BOTTOM - TOP);

    // baulk line and spots
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    const spot = headSpot();
    ctx.beginPath();
    ctx.moveTo(spot.x, TOP);
    ctx.lineTo(spot.x, BOTTOM);
    ctx.stroke();

    drawSights();

    for (const p of pockets) {
        ctx.fillStyle = '#0a0f0c';
        ctx.beginPath();
        ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
}

// The little diamonds inlaid in the rails, at quarter-table intervals.
function drawSights() {
    ctx.save();
    ctx.fillStyle = 'rgba(245, 236, 214, 0.75)';
    const diamond = (x, y) => {
        ctx.beginPath();
        ctx.moveTo(x, y - 3);
        ctx.lineTo(x + 3, y);
        ctx.lineTo(x, y + 3);
        ctx.lineTo(x - 3, y);
        ctx.closePath();
        ctx.fill();
    };
    const halfW = (RIGHT - LEFT) / 2;
    for (let i = 1; i <= 3; i++) {
        if (i === 2) continue;                       // the side pockets sit here
        const x = LEFT + (halfW / 2) * i;
        diamond(x, TOP - RAIL / 2);
        diamond(x + halfW, TOP - RAIL / 2);
        diamond(x, BOTTOM + RAIL / 2);
        diamond(x + halfW, BOTTOM + RAIL / 2);
    }
    for (let i = 1; i <= 3; i++) {
        const y = TOP + ((BOTTOM - TOP) / 4) * i;
        diamond(LEFT - RAIL / 2, y);
        diamond(RIGHT + RAIL / 2, y);
    }
    ctx.restore();
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawBall(b) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y + 2, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = b.colour;
    ctx.fill();

    if (b.stripe) {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = '#f6f3ea';
        ctx.fillRect(b.x - BALL_R, b.y - BALL_R, BALL_R * 2, BALL_R * 0.55);
        ctx.fillRect(b.x - BALL_R, b.y + BALL_R * 0.45, BALL_R * 2, BALL_R * 0.55);
        ctx.restore();
    }

    if (!b.isCue) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, BALL_R * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = '#f6f3ea';
        ctx.fill();
        ctx.fillStyle = '#20242a';
        ctx.font = 'bold 8px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.num), b.x, b.y + 0.5);
    }

    ctx.beginPath();
    ctx.arc(b.x - BALL_R * 0.32, b.y - BALL_R * 0.36, BALL_R * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.restore();
}

function drawAim() {
    if (state !== 'ready' || !cueBall || cueBall.pocketed) return;
    const contact = aimContact();
    if (!contact) return;

    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cueBall.x, cueBall.y);
    ctx.lineTo(contact.x, contact.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // ghost ball at the point of contact
    ctx.beginPath();
    ctx.arc(contact.x, contact.y, BALL_R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();

    // where the object ball will set off: along the line of centres
    if (contact.ball) {
        const dx = contact.ball.x - contact.x;
        const dy = contact.ball.y - contact.y;
        const len = Math.hypot(dx, dy) || 1;
        ctx.strokeStyle = 'rgba(240, 196, 106, 0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(contact.ball.x, contact.ball.y);
        ctx.lineTo(contact.ball.x + (dx / len) * 46, contact.ball.y + (dy / len) * 46);
        ctx.stroke();
    }

    // cue stick, pulled back by the charge
    const back = 16 + power * 48;
    const ox = Math.cos(aimAngle);
    const oy = Math.sin(aimAngle);
    const grd = ctx.createLinearGradient(
        cueBall.x - ox * back, cueBall.y - oy * back,
        cueBall.x - ox * (back + 190), cueBall.y - oy * (back + 190));
    grd.addColorStop(0, '#f2e2c0');
    grd.addColorStop(1, '#8a5a2b');
    ctx.strokeStyle = grd;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cueBall.x - ox * back, cueBall.y - oy * back);
    ctx.lineTo(cueBall.x - ox * (back + 190), cueBall.y - oy * (back + 190));
    ctx.stroke();
    ctx.restore();
}

function drawPowerMeter() {
    if (state === 'idle') return;
    const w = 150, h = 9, x = 14, y = CANVAS_H - 20;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(x - 2, y - 2, w + 4, h + 4, 6);
    ctx.fill();
    const grd = ctx.createLinearGradient(x, 0, x + w, 0);
    grd.addColorStop(0, '#7ddc8a');
    grd.addColorStop(0.6, '#f0c46a');
    grd.addColorStop(1, '#ef5a4d');
    ctx.fillStyle = grd;
    ctx.fillRect(x, y, w * power, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
}

function drawFlash() {
    if (!flash || flash.ttl <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, flash.ttl / 0.6);
    ctx.fillStyle = flash.colour;
    ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(flash.text, CANVAS_W / 2, TOP + 26);
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawTable();
    drawAim();
    for (const b of activeBalls()) {
        if (b !== cueBall) drawBall(b);
    }
    if (cueBall && !cueBall.pocketed) drawBall(cueBall);
    drawFlash();
    drawPowerMeter();
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

canvas.addEventListener('mousemove', (evt) => {
    if (state !== 'ready') return;
    const p = canvasPoint(evt);
    aimAt(p.x, p.y);
});

canvas.addEventListener('mousedown', (evt) => {
    evt.preventDefault();
    if (state !== 'ready') return;
    const p = canvasPoint(evt);
    aimAt(p.x, p.y);
    beginCharge();
});

window.addEventListener('mouseup', () => {
    if (charging) releaseCharge();
});

window.addEventListener('keydown', (evt) => {
    if (evt.code === 'Space') {
        evt.preventDefault();
        if (evt.repeat) return;
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'ready') beginCharge();
        return;
    }
    if (evt.code === 'KeyR') {
        startGame();
        return;
    }
    if (state !== 'ready') return;
    if (evt.code === 'ArrowLeft') { evt.preventDefault(); setAim(aimAngle - AIM_STEP); }
    if (evt.code === 'ArrowRight') { evt.preventDefault(); setAim(aimAngle + AIM_STEP); }
    if (evt.code === 'ArrowUp') { evt.preventDefault(); setPower(power + 0.05); }
    if (evt.code === 'ArrowDown') { evt.preventDefault(); setPower(power - 0.05); }
});

window.addEventListener('keyup', (evt) => {
    if (evt.code === 'Space' && charging) {
        evt.preventDefault();
        releaseCharge();
    }
});

btnStart.addEventListener('click', () => startGame());

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

let lastFrame = 0;

function frame(now) {
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (flash) flash.ttl -= dt;
    step(dt);
    draw();
    window.requestAnimationFrame(frame);
}

loadBest();
newRack();
updateHud();
showOverlay('BILLIARDS', '', 'Press Space or click Start to play', 'Start Game');
window.requestAnimationFrame(frame);
