// ---------------------------------------------------------------------------
// 8-Ball Pool — two-player hot-seat billiards on an HTML5 canvas.
//
// Written as a single classic (non-module) script so the table state and the
// rules engine are reachable from the Playwright tests as plain globals, the
// same way Kaboom, Dino Run and Tetris work in this repo. The world advances
// through `step(dt)` in fixed sub-steps, so a test can simulate a whole shot
// deterministically without depending on requestAnimationFrame timing — set
// `autoStep = false` and drive `step()` (or `settle()`) directly.
// ---------------------------------------------------------------------------

// --- Table geometry ---
const CANVAS_W = 800;
const CANVAS_H = 440;
const CUSHION = 26;              // rail thickness; the play area is inset by this
const BALL_R = 10;
const POCKET_R = 19;             // capture radius measured from the pocket centre

const LEFT = CUSHION, RIGHT = CANVAS_W - CUSHION;
const TOP = CUSHION, BOTTOM = CANVAS_H - CUSHION;

// --- Physics ---
const MAX_SPEED = 1500;          // px/s at full power
const FRICTION_DECAY = 0.45;     // velocity multiplier per second of rolling
const STOP_SPEED = 6;            // below this a ball is considered stopped
const CUSHION_RESTITUTION = 0.92;
const BALL_RESTITUTION = 0.96;
const MAX_SUB_DT = 1 / 240;      // sub-step cap: a ball never tunnels at this size

// --- Aiming ---
const AIM_STEP = 0.02;           // radians per arrow-key nudge
const POWER_STEP = 0.05;
const CHARGE_RATE = 1.0;         // power gained per second while charging

const COLORS = {
    1: '#f2c53d', 2: '#2a5fd9', 3: '#d8382f', 4: '#7b3fa0',
    5: '#e8802a', 6: '#1f9b52', 7: '#8a2f2f', 8: '#141414',
};

// Pocket order: top-left, top-middle, top-right, bottom-left, bottom-middle,
// bottom-right.
const pockets = [
    { x: LEFT, y: TOP }, { x: CANVAS_W / 2, y: TOP }, { x: RIGHT, y: TOP },
    { x: LEFT, y: BOTTOM }, { x: CANVAS_W / 2, y: BOTTOM }, { x: RIGHT, y: BOTTOM },
];

// A fixed rack (see DESIGN.md) so games are reproducible: the 8-ball sits in
// the middle of the third row and the rows alternate solids and stripes.
const RACK_ROWS = [
    [1],
    [2, 9],
    [10, 8, 3],
    [11, 4, 12, 5],
    [13, 6, 14, 7, 15],
];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const messageEl = document.getElementById('message');
const powerFill = document.getElementById('power-fill');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const playerEls = [document.getElementById('player1'), document.getElementById('player2')];
const groupEls = [document.getElementById('p1-group'), document.getElementById('p2-group')];
const countEls = [document.getElementById('p1-count'), document.getElementById('p2-count')];

// --- State ---
// state: 'idle' | 'aiming' | 'rolling' | 'over'
let state = 'idle';
let winner = null;
let turn = 0;
let ballInHand = false;
let autoStep = true;             // tests turn this off to step the world by hand
let charging = false;

const players = [{ group: null }, { group: null }];
const aim = { angle: 0, power: 0.5 };
const balls = [];
let shotInfo = newShotInfo();

// ---------------------------------------------------------------------------
// Balls
// ---------------------------------------------------------------------------

function groupOf(n) {
    if (n === 0) return 'cue';
    if (n === 8) return 'eight';
    return n < 8 ? 'solid' : 'stripe';
}

function getBall(n) {
    return balls.find((b) => b.n === n);
}

function makeBall(n) {
    return {
        n,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        potted: false,
        color: n === 0 ? '#f5f2e8' : COLORS[n > 8 ? n - 8 : n],
        striped: n > 8,
    };
}

function rackBalls() {
    balls.length = 0;
    balls.push(makeBall(0));
    for (let n = 1; n <= 15; n++) balls.push(makeBall(n));

    const cy = CANVAS_H / 2;
    const footX = LEFT + (RIGHT - LEFT) * 0.72;
    const headX = LEFT + (RIGHT - LEFT) * 0.25;
    // Touching balls sit exactly 2R apart, which the collision test (`< 2R`)
    // would not separate; a small extra gap keeps the rack stable at rest.
    const dx = BALL_R * Math.sqrt(3) + 0.5;
    const dy = 2 * BALL_R + 0.5;

    RACK_ROWS.forEach((row, i) => {
        row.forEach((n, j) => {
            const b = getBall(n);
            b.x = footX + i * dx;
            b.y = cy + (j - (row.length - 1) / 2) * dy;
        });
    });

    const cue = getBall(0);
    cue.x = headX;
    cue.y = cy;
}

function remaining(group) {
    return balls.filter((b) => !b.potted && groupOf(b.n) === group).length;
}

function allStopped() {
    return balls.every((b) => b.potted || (b.vx === 0 && b.vy === 0));
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

function step(dt) {
    let left = Math.min(dt, 0.1);
    while (left > 0) {
        const sub = Math.min(left, MAX_SUB_DT);
        subStep(sub);
        left -= sub;
    }
    if (state === 'rolling' && allStopped()) resolveShot();
}

function subStep(dt) {
    const live = balls.filter((b) => !b.potted);

    for (const b of live) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
    }

    for (const b of live) bounceCushions(b);

    for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) collide(live[i], live[j]);
    }

    // A collision can nudge a ball into a rail, so the cushions get a second
    // look before anything is checked against the pockets.
    for (const b of live) {
        bounceCushions(b);
        checkPockets(b);
    }

    const decay = Math.pow(FRICTION_DECAY, dt);
    for (const b of live) {
        b.vx *= decay;
        b.vy *= decay;
        if (Math.hypot(b.vx, b.vy) < STOP_SPEED) {
            b.vx = 0;
            b.vy = 0;
        }
    }
}

function bounceCushions(b) {
    if (b.x < LEFT + BALL_R) {
        b.x = LEFT + BALL_R;
        if (b.vx < 0) b.vx = -b.vx * CUSHION_RESTITUTION;
    } else if (b.x > RIGHT - BALL_R) {
        b.x = RIGHT - BALL_R;
        if (b.vx > 0) b.vx = -b.vx * CUSHION_RESTITUTION;
    }
    if (b.y < TOP + BALL_R) {
        b.y = TOP + BALL_R;
        if (b.vy < 0) b.vy = -b.vy * CUSHION_RESTITUTION;
    } else if (b.y > BOTTOM - BALL_R) {
        b.y = BOTTOM - BALL_R;
        if (b.vy > 0) b.vy = -b.vy * CUSHION_RESTITUTION;
    }
}

// Equal-mass elastic response along the contact normal. Tangential velocity is
// untouched — no spin is modelled.
function collide(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist >= BALL_R * 2) return;

    const nx = dx / dist;
    const ny = dy / dist;

    // Push the pair apart so they never stick together.
    const overlap = BALL_R * 2 - dist;
    a.x -= (nx * overlap) / 2;
    a.y -= (ny * overlap) / 2;
    b.x += (nx * overlap) / 2;
    b.y += (ny * overlap) / 2;

    const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel > 0) return; // already separating

    const impulse = -(1 + BALL_RESTITUTION) * rel / 2;
    a.vx -= impulse * nx;
    a.vy -= impulse * ny;
    b.vx += impulse * nx;
    b.vy += impulse * ny;

    if (state === 'rolling' && shotInfo.firstHit === null) {
        if (a.n === 0) shotInfo.firstHit = b.n;
        else if (b.n === 0) shotInfo.firstHit = a.n;
    }
}

function checkPockets(b) {
    for (const p of pockets) {
        if (Math.hypot(b.x - p.x, b.y - p.y) <= POCKET_R) {
            b.potted = true;
            b.vx = 0;
            b.vy = 0;
            if (state === 'rolling') shotInfo.potted.push(b.n);
            return;
        }
    }
}

// Runs fixed sub-steps until the table settles and the shot has been resolved.
// The render loop drives normal play; this exists so tests can fast-forward a
// whole shot deterministically.
function settle(maxSeconds = 30) {
    let t = 0;
    while (t < maxSeconds && (!allStopped() || state === 'rolling')) {
        step(MAX_SUB_DT);
        t += MAX_SUB_DT;
    }
    return t;
}

// ---------------------------------------------------------------------------
// Aiming and shooting
// ---------------------------------------------------------------------------

function setAim(angle) {
    aim.angle = angle;
}

function setPower(p) {
    aim.power = Math.max(0, Math.min(1, p));
    if (powerFill) powerFill.style.width = `${Math.round(aim.power * 100)}%`;
}

function currentTargetGroup() {
    const group = players[turn].group;
    if (!group) return 'open';
    return remaining(group) === 0 ? 'eight' : group;
}

function newShotInfo() {
    return { firstHit: null, potted: [], targetGroup: 'open', foul: false };
}

function shoot() {
    if (state !== 'aiming' || aim.power <= 0 || ballInHand) return false;
    shotInfo = newShotInfo();
    shotInfo.targetGroup = currentTargetGroup();
    const cue = getBall(0);
    const speed = aim.power * MAX_SPEED;
    cue.vx = Math.cos(aim.angle) * speed;
    cue.vy = Math.sin(aim.angle) * speed;
    state = 'rolling';
    setMessage('');
    return true;
}

function isFreeSpot(x, y) {
    if (x < LEFT + BALL_R || x > RIGHT - BALL_R) return false;
    if (y < TOP + BALL_R || y > BOTTOM - BALL_R) return false;
    if (balls.some((b) => !b.potted && b.n !== 0 && Math.hypot(b.x - x, b.y - y) < BALL_R * 2)) {
        return false;
    }
    return !pockets.some((p) => Math.hypot(p.x - x, p.y - y) <= POCKET_R);
}

// Nearest clear spot to (x, y), searched in widening rings. Used to re-spot the
// cue ball after a scratch so it never lands inside a resting ball.
function findFreeSpot(x, y) {
    if (isFreeSpot(x, y)) return { x, y };
    for (let r = BALL_R; r <= Math.max(CANVAS_W, CANVAS_H); r += BALL_R) {
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r;
            if (isFreeSpot(px, py)) return { x: px, y: py };
        }
    }
    return { x, y };
}

function placeCue(x, y) {
    if (!ballInHand || state === 'rolling' || state === 'over') return false;
    if (!isFreeSpot(x, y)) return false;

    const cue = getBall(0);
    cue.x = x;
    cue.y = y;
    cue.vx = 0;
    cue.vy = 0;
    cue.potted = false;
    ballInHand = false;
    setMessage(`Player ${turn + 1} to shoot`);
    return true;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function resolveShot() {
    const potted = shotInfo.potted;
    const target = shotInfo.targetGroup;
    const scratched = potted.includes(0);
    const eightPotted = potted.includes(8);
    const objectPotted = potted.filter((n) => n !== 0 && n !== 8);

    let foul = false;
    let why = '';
    if (shotInfo.firstHit === null) {
        foul = true;
        why = 'no ball hit';
    } else if (target === 'open') {
        if (shotInfo.firstHit === 8) {
            foul = true;
            why = 'hit the 8-ball first';
        }
    } else if (target === 'eight') {
        if (shotInfo.firstHit !== 8) {
            foul = true;
            why = 'you are on the 8-ball';
        }
    } else if (groupOf(shotInfo.firstHit) !== target) {
        foul = true;
        why = 'wrong ball first';
    }
    if (scratched) {
        foul = true;
        why = 'scratch';
    }
    shotInfo.foul = foul;

    state = 'aiming';

    if (eightPotted) {
        endGame(target === 'eight' && !foul ? turn : 1 - turn);
        return;
    }

    // Open table: the first ball potted decides who owns which group.
    if (target === 'open' && objectPotted.length && !foul) {
        const group = groupOf(objectPotted[0]);
        players[turn].group = group;
        players[1 - turn].group = group === 'solid' ? 'stripe' : 'solid';
    }

    if (scratched) {
        const cue = getBall(0);
        cue.potted = false;
        cue.vx = 0;
        cue.vy = 0;
        const spot = findFreeSpot(LEFT + (RIGHT - LEFT) * 0.25, CANVAS_H / 2);
        cue.x = spot.x;
        cue.y = spot.y;
    }

    let keepsTable = false;
    if (!foul) {
        if (target === 'open') keepsTable = objectPotted.length > 0;
        else keepsTable = objectPotted.some((n) => groupOf(n) === players[turn].group);
    }

    if (foul) {
        turn = 1 - turn;
        ballInHand = true;
        setMessage(`Foul — ${why}. Player ${turn + 1} has ball in hand`);
    } else if (keepsTable) {
        setMessage(`Potted! Player ${turn + 1} shoots again`);
    } else {
        turn = 1 - turn;
        setMessage(`Player ${turn + 1} to shoot`);
    }

    setPower(Math.min(aim.power, 1));
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    rackBalls();
    players[0].group = null;
    players[1].group = null;
    turn = 0;
    winner = null;
    ballInHand = false;
    charging = false;
    shotInfo = newShotInfo();
    aim.angle = 0;
    setPower(0.5);
    state = 'aiming';
    overlay.classList.remove('visible');
    setMessage('Break to open the table');
    updateHud();
}

function endGame(w) {
    winner = w;
    state = 'over';
    charging = false;
    overlayTitle.textContent = `Player ${w + 1} wins!`;
    overlaySub.textContent = 'Press Space or R for a new rack';
    overlay.classList.add('visible');
    setMessage(`Player ${w + 1} wins the rack`);
    updateHud();
}

function setMessage(text) {
    messageEl.textContent = text;
}

function updateHud() {
    for (let i = 0; i < 2; i++) {
        const group = players[i].group;
        groupEls[i].textContent = group === null ? 'Open' : group === 'solid' ? 'Solids' : 'Stripes';
        countEls[i].textContent = String(group === null ? 7 : remaining(group));
        playerEls[i].classList.toggle('active', i === turn && state !== 'over');
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    ctx.fillStyle = '#5a3a1c';
    roundRect(0, 0, CANVAS_W, CANVAS_H, 14);
    ctx.fill();
    ctx.strokeStyle = '#7a5228';
    ctx.lineWidth = 2;
    ctx.stroke();

    const felt = ctx.createLinearGradient(0, TOP, 0, BOTTOM);
    felt.addColorStop(0, '#1c7a4a');
    felt.addColorStop(1, '#12603a');
    ctx.fillStyle = felt;
    ctx.fillRect(LEFT, TOP, RIGHT - LEFT, BOTTOM - TOP);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(LEFT, TOP, RIGHT - LEFT, BOTTOM - TOP);

    for (const p of pockets) {
        ctx.fillStyle = '#0a0d0b';
        ctx.beginPath();
        ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
        ctx.fill();
    }

    // Head string, a nod to the real table markings.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LEFT + (RIGHT - LEFT) * 0.25, TOP);
    ctx.lineTo(LEFT + (RIGHT - LEFT) * 0.25, BOTTOM);
    ctx.stroke();

    if (state === 'aiming' && !ballInHand) drawGuide();

    for (const b of balls) if (!b.potted) drawBall(b);

    if (ballInHand && state === 'aiming') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.font = '14px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Ball in hand — click to place the cue ball', CANVAS_W / 2, BOTTOM - 16);
        ctx.textAlign = 'start';
    }
}

function drawGuide() {
    const cue = getBall(0);
    if (cue.potted) return;
    const dist = guideLength(cue);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cue.x, cue.y);
    ctx.lineTo(cue.x + Math.cos(aim.angle) * dist, cue.y + Math.sin(aim.angle) * dist);
    ctx.stroke();
    ctx.restore();

    // The cue stick, drawn behind the ball and pulled back with the power.
    const back = 24 + aim.power * 40;
    const bx = cue.x - Math.cos(aim.angle) * back;
    const by = cue.y - Math.sin(aim.angle) * back;
    ctx.strokeStyle = '#c89b52';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - Math.cos(aim.angle) * 220, by - Math.sin(aim.angle) * 220);
    ctx.stroke();
}

// Distance from the cue ball to the first thing the aim line meets, so the
// guide stops at a ball or a cushion instead of running through them.
function guideLength(cue) {
    const dx = Math.cos(aim.angle);
    const dy = Math.sin(aim.angle);
    let best = 1200;
    if (dx > 0) best = Math.min(best, (RIGHT - BALL_R - cue.x) / dx);
    if (dx < 0) best = Math.min(best, (LEFT + BALL_R - cue.x) / dx);
    if (dy > 0) best = Math.min(best, (BOTTOM - BALL_R - cue.y) / dy);
    if (dy < 0) best = Math.min(best, (TOP + BALL_R - cue.y) / dy);

    for (const b of balls) {
        if (b.potted || b.n === 0) continue;
        const ox = b.x - cue.x;
        const oy = b.y - cue.y;
        const along = ox * dx + oy * dy;
        if (along <= 0) continue;
        const perp = Math.abs(ox * dy - oy * dx);
        if (perp > BALL_R * 2) continue;
        const hit = along - Math.sqrt(Math.max(0, (BALL_R * 2) ** 2 - perp * perp));
        best = Math.min(best, hit);
    }
    return Math.max(0, best);
}

function drawBall(b) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = b.striped ? '#f5f2e8' : b.color;
    ctx.fill();

    if (b.striped) {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x - BALL_R, b.y - BALL_R * 0.55, BALL_R * 2, BALL_R * 1.1);
        ctx.restore();
    }

    const shine = ctx.createRadialGradient(
        b.x - BALL_R * 0.35, b.y - BALL_R * 0.4, 1,
        b.x, b.y, BALL_R
    );
    shine.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
    shine.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
    shine.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();

    if (b.n !== 0) {
        ctx.fillStyle = '#f8f6ef';
        ctx.beginPath();
        ctx.arc(b.x, b.y, BALL_R * 0.46, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1b1b1b';
        ctx.font = 'bold 9px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.n), b.x, b.y + 0.5);
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

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
    lastTime = now;

    if (autoStep) {
        if (charging && state === 'aiming') setPower(aim.power + CHARGE_RATE * dt);
        if (dt > 0) step(dt);
    }

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

canvas.addEventListener('mousemove', (e) => {
    if (state !== 'aiming' || ballInHand) return;
    const p = pointerPos(e);
    const cue = getBall(0);
    setAim(Math.atan2(p.y - cue.y, p.x - cue.x));
});

canvas.addEventListener('mousedown', (e) => {
    if (state !== 'aiming') return;
    if (ballInHand) {
        const p = pointerPos(e);
        placeCue(p.x, p.y);
        return;
    }
    charging = true;
    setPower(0);
});

window.addEventListener('mouseup', () => {
    if (!charging) return;
    charging = false;
    shoot();
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
        startGame();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') {
            startGame();
        } else if (state === 'aiming' && !ballInHand && !charging) {
            charging = true;
            setPower(0);
        }
        return;
    }
    if (state !== 'aiming') return;
    if (e.key === 'ArrowLeft') {
        setAim(aim.angle - AIM_STEP);
        e.preventDefault();
    } else if (e.key === 'ArrowRight') {
        setAim(aim.angle + AIM_STEP);
        e.preventDefault();
    } else if (e.key === 'ArrowUp') {
        setPower(aim.power + POWER_STEP);
        e.preventDefault();
    } else if (e.key === 'ArrowDown') {
        setPower(aim.power - POWER_STEP);
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.code === 'Space') {
        if (!charging) return;
        charging = false;
        shoot();
    }
});

btnStart.addEventListener('click', () => startGame());

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

rackBalls();
state = 'idle';
setPower(0.5);
updateHud();
requestAnimationFrame(frame);
