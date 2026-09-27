// ---------------------------------------------------------------------------
// 8-Ball Pool — a two-player hot-seat pool table on an HTML5 canvas.
//
// Players take turns striking the cue ball. The table is open until someone
// legally pots an object ball, which assigns solids to that player and stripes
// to the other; clear your group and pot the 8 ball to win.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate whole shots
// deterministically without depending on requestAnimationFrame wall-clock
// timing. Nothing in the game uses randomness — the same shot always produces
// the same table.
// ---------------------------------------------------------------------------

// --- Table geometry ---
const CANVAS_W = 800;
const CANVAS_H = 440;
// The cushion faces: balls live entirely inside this rectangle.
const PLAY = { x0: 40, y0: 40, x1: 760, y1: 400 };
const R = 10;                    // ball radius
const POCKET_R = 19;             // a ball whose centre gets this close drops in

// Head spot (cue ball) and rack apex, at the classic quarter/three-quarter
// points of the table's long axis.
const HEAD = { x: 220, y: 220 };
const APEX = { x: 560, y: 220 };

const pockets = [
    { x: PLAY.x0, y: PLAY.y0 }, { x: (PLAY.x0 + PLAY.x1) / 2, y: PLAY.y0 }, { x: PLAY.x1, y: PLAY.y0 },
    { x: PLAY.x0, y: PLAY.y1 }, { x: (PLAY.x0 + PLAY.x1) / 2, y: PLAY.y1 }, { x: PLAY.x1, y: PLAY.y1 },
];

// --- Physics ---
const FRICTION = 190;            // px/s^2 of cloth drag
const STOP_SPEED = 6;            // below this a ball is considered at rest
const CUSHION_REST = 0.86;       // energy kept in a cushion bounce
const BALL_REST = 0.985;         // energy kept in a ball-to-ball hit
const MAX_SPEED = 1150;          // cue ball speed at full power
const CHARGE_RATE = 1.1;         // power gained per second while charging
const AIM_STEP = 0.02;           // radians per arrow-key tap

// --- Rack layout: row 0 is the apex, the 8 ball sits mid-rack ---
const RACK_ROWS = [
    [1],
    [9, 2],
    [10, 8, 3],
    [11, 7, 14, 4],
    [5, 13, 15, 6, 12],
];

const BALL_COLORS = {
    1: '#f2c14e', 2: '#2563eb', 3: '#dc2626', 4: '#7c3aed',
    5: '#ea580c', 6: '#16a34a', 7: '#7f1d1d', 8: '#141414',
    9: '#f2c14e', 10: '#2563eb', 11: '#dc2626', 12: '#7c3aed',
    13: '#ea580c', 14: '#16a34a', 15: '#7f1d1d',
};

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const turnEl = document.getElementById('turn');
const messageEl = document.getElementById('message');
const powerFill = document.getElementById('power-fill');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const panels = [document.getElementById('p1'), document.getElementById('p2')];
const groupEls = [document.getElementById('p1-group'), document.getElementById('p2-group')];
const countEls = [document.getElementById('p1-count'), document.getElementById('p2-count')];

// --- State ---
// state: 'idle' | 'aiming' | 'rolling' | 'over'
let state = 'idle';
let balls = [];
let cue = null;
let players = [{ group: null }, { group: null }];
let currentPlayer = 0;
let winner = null;
let message = '';
let aimAngle = 0;
let power = 0;
let charging = false;

// Per-shot bookkeeping, reset by shoot() and read by resolveShot().
let pottedThisShot = [];
let firstContact = null;
let cueScratched = false;
let foul = false;
// Whether the shooter's group was already cleared when the shot was taken.
// Judged up front, because the shot itself may clear the group.
let shotOnTheEight = false;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function makeBall(id, x, y) {
    let type = 'solid';
    if (id === 0) type = 'cue';
    else if (id === 8) type = 'eight';
    else if (id > 8) type = 'stripe';
    return { id, type, x, y, vx: 0, vy: 0, potted: false, color: id === 0 ? '#f8fafc' : BALL_COLORS[id] };
}

// Builds the opening rack: cue ball on the head spot, 15 object balls in a
// triangle whose apex points back down the table.
function rack() {
    balls = [makeBall(0, HEAD.x, HEAD.y)];
    // A hair of daylight between racked balls, so the break's impulse travels
    // through the stack as real collisions instead of overlap corrections.
    const gap = 0.4;
    const rowGap = (2 * R + gap) * Math.cos(Math.PI / 6);
    RACK_ROWS.forEach((row, r) => {
        row.forEach((id, i) => {
            const x = APEX.x + r * rowGap;
            const y = APEX.y + (i - (row.length - 1) / 2) * (2 * R + gap);
            balls.push(makeBall(id, x, y));
        });
    });
    cue = balls[0];
}

function startGame() {
    rack();
    players = [{ group: null }, { group: null }];
    currentPlayer = 0;
    winner = null;
    state = 'aiming';
    aimAngle = 0;
    power = 0;
    charging = false;
    pottedThisShot = [];
    firstContact = null;
    cueScratched = false;
    foul = false;
    overlay.classList.remove('visible');
    setMessage('Break to open the table');
    updateHud();
}

function endGame(w) {
    winner = w;
    state = 'over';
    charging = false;
    power = 0;
    setMessage(`Player ${w + 1} wins the game`);
    overlayTitle.textContent = `Player ${w + 1} wins!`;
    overlaySub.textContent = 'Press Space or R for a rematch';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    updateHud();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function ballById(id) {
    return balls.find((b) => b.id === id);
}

function groupBalls(group) {
    return balls.filter((b) => b.type === group);
}

function remaining(p) {
    const group = players[p].group;
    if (!group) return 7;
    return groupBalls(group).filter((b) => !b.potted).length;
}

function groupCleared(p) {
    const group = players[p].group;
    return group !== null && groupBalls(group).every((b) => b.potted);
}

function allStopped() {
    return balls.every((b) => b.potted || (b.vx === 0 && b.vy === 0));
}

function groupLabel(group) {
    if (group === 'solid') return 'Solids';
    if (group === 'stripe') return 'Stripes';
    return '—';
}

// ---------------------------------------------------------------------------
// Aiming & shooting
// ---------------------------------------------------------------------------

function setAim(angle) {
    aimAngle = angle;
}

function setPower(p) {
    power = Math.max(0, Math.min(1, p));
    powerFill.style.width = `${power * 100}%`;
}

function setMessage(text) {
    message = text;
    messageEl.textContent = text;
}

function beginCharge() {
    if (state !== 'aiming' || charging || !allStopped()) return;
    charging = true;
    setPower(0);
}

function releaseCharge() {
    if (!charging) return;
    charging = false;
    shoot();
}

function shoot() {
    if (state !== 'aiming' || power <= 0 || !allStopped()) return false;
    cue.vx = Math.cos(aimAngle) * MAX_SPEED * power;
    cue.vy = Math.sin(aimAngle) * MAX_SPEED * power;
    state = 'rolling';
    charging = false;
    pottedThisShot = [];
    firstContact = null;
    cueScratched = false;
    foul = false;
    shotOnTheEight = groupCleared(currentPlayer);
    return true;
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

function checkPockets() {
    for (const b of balls) {
        if (b.potted) continue;
        for (const p of pockets) {
            if (Math.hypot(b.x - p.x, b.y - p.y) < POCKET_R) {
                b.potted = true;
                b.vx = 0;
                b.vy = 0;
                if (b.id === 0) cueScratched = true;
                if (state === 'rolling') pottedThisShot.push(b.id);
                break;
            }
        }
    }
}

function cushions() {
    for (const b of balls) {
        if (b.potted) continue;
        if (b.x < PLAY.x0 + R) { b.x = PLAY.x0 + R; b.vx = Math.abs(b.vx) * CUSHION_REST; }
        if (b.x > PLAY.x1 - R) { b.x = PLAY.x1 - R; b.vx = -Math.abs(b.vx) * CUSHION_REST; }
        if (b.y < PLAY.y0 + R) { b.y = PLAY.y0 + R; b.vy = Math.abs(b.vy) * CUSHION_REST; }
        if (b.y > PLAY.y1 - R) { b.y = PLAY.y1 - R; b.vy = -Math.abs(b.vy) * CUSHION_REST; }
    }
}

// Equal-mass collision resolved along the contact normal, with a small amount
// of energy lost. The first object ball the cue ball touches during a shot is
// recorded so the rules can judge the hit.
function collisions() {
    const live = balls.filter((b) => !b.potted);
    for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
            const a = live[i];
            const b = live[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy);
            if (d === 0 || d >= 2 * R) continue;

            const nx = dx / d;
            const ny = dy / d;
            const overlap = (2 * R - d) / 2;
            a.x -= nx * overlap; a.y -= ny * overlap;
            b.x += nx * overlap; b.y += ny * overlap;

            const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (vn < 0) {
                const impulse = (-(1 + BALL_REST) * vn) / 2;
                a.vx -= impulse * nx; a.vy -= impulse * ny;
                b.vx += impulse * nx; b.vy += impulse * ny;
            }
            if (state === 'rolling' && firstContact === null) {
                if (a.id === 0) firstContact = b.id;
                else if (b.id === 0) firstContact = a.id;
            }
        }
    }
}

// A second positional pass so balls settling in a cluster never come to rest
// inside one another.
function separate() {
    const live = balls.filter((b) => !b.potted);
    for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < live.length; i++) {
            for (let j = i + 1; j < live.length; j++) {
                const a = live[i];
                const b = live[j];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const d = Math.hypot(dx, dy);
                if (d === 0 || d >= 2 * R) continue;
                const push = (2 * R - d) / 2;
                a.x -= (dx / d) * push; a.y -= (dy / d) * push;
                b.x += (dx / d) * push; b.y += (dy / d) * push;
            }
        }
    }
}

function substep(h) {
    for (const b of balls) {
        if (b.potted) continue;
        b.x += b.vx * h;
        b.y += b.vy * h;
        const s = Math.hypot(b.vx, b.vy);
        if (s > 0) {
            const next = s - FRICTION * h;
            if (next <= STOP_SPEED) { b.vx = 0; b.vy = 0; } else { b.vx = (b.vx / s) * next; b.vy = (b.vy / s) * next; }
        }
    }
    checkPockets();
    cushions();
    collisions();
    separate();
}

// Advances the table by dt, splitting it into sub-steps small enough that no
// ball can tunnel through a cushion or past another ball.
function advance(dt) {
    let maxV = 0;
    for (const b of balls) {
        if (!b.potted) maxV = Math.max(maxV, Math.hypot(b.vx, b.vy));
    }
    if (maxV === 0) {
        checkPockets();
        return;
    }
    const n = Math.max(1, Math.min(48, Math.ceil((maxV * dt) / (R * 0.4))));
    const h = dt / n;
    for (let i = 0; i < n; i++) substep(h);
}

function step(dt) {
    if (state === 'aiming' && charging) setPower(power + CHARGE_RATE * dt);
    advance(dt);
    if (state === 'rolling' && allStopped()) resolveShot();
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// Places the cue ball back on the table after a scratch: the head spot when it
// is free, otherwise the nearest clear position to it.
function respotCue() {
    cue.potted = false;
    cue.vx = 0;
    cue.vy = 0;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const free = (x, y) => balls.every((b) => b === cue || b.potted
        || Math.hypot(b.x - x, b.y - y) >= 2 * R + 1)
        && pockets.every((p) => Math.hypot(p.x - x, p.y - y) > POCKET_R + R);

    if (free(HEAD.x, HEAD.y)) {
        cue.x = HEAD.x;
        cue.y = HEAD.y;
        return;
    }
    for (let radius = 6; radius <= 400; radius += 6) {
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            const x = clamp(HEAD.x + Math.cos(a) * radius, PLAY.x0 + R, PLAY.x1 - R);
            const y = clamp(HEAD.y + Math.sin(a) * radius, PLAY.y0 + R, PLAY.y1 - R);
            if (free(x, y)) {
                cue.x = x;
                cue.y = y;
                return;
            }
        }
    }
    cue.x = HEAD.x;
    cue.y = HEAD.y;
}

// Judges the shot that has just finished: fouls, group assignment, the 8 ball
// and whether the shooter keeps the table.
function resolveShot() {
    state = 'aiming';
    const p = currentPlayer;
    const potted = pottedThisShot.filter((id) => id !== 0).map(ballById);
    let reason = '';
    foul = false;

    if (cueScratched) {
        foul = true;
        reason = 'Scratch! Cue ball respotted';
    } else if (firstContact === null) {
        foul = true;
        reason = 'No ball hit — foul';
    } else {
        const hit = ballById(firstContact).type;
        const group = players[p].group;
        const legalFirst = group === null
            ? hit !== 'eight'
            : (shotOnTheEight ? hit === 'eight' : hit === group);
        if (!legalFirst) {
            foul = true;
            reason = 'Wrong ball first — foul';
        }
    }

    if (pottedThisShot.includes(8)) {
        const won = !foul && players[p].group !== null && groupCleared(p);
        endGame(won ? p : 1 - p);
        return;
    }

    if (players[p].group === null && !foul && potted.length) {
        const first = potted.find((b) => b.type !== 'eight');
        if (first) {
            players[p].group = first.type;
            players[1 - p].group = first.type === 'solid' ? 'stripe' : 'solid';
            reason = `Player ${p + 1} takes ${groupLabel(first.type)}`;
        }
    }

    const pottedOwn = potted.some((b) => b.type === players[p].group);
    if (foul) {
        if (cueScratched) respotCue();
        currentPlayer = 1 - p;
        setMessage(reason);
    } else if (pottedOwn) {
        setMessage(reason || 'Potted — shoot again');
    } else {
        currentPlayer = 1 - p;
        setMessage(potted.length ? 'Nothing on — turn passes' : 'Missed — turn passes');
    }

    setPower(0);
    charging = false;
    updateHud();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function updateHud() {
    turnEl.textContent = state === 'over' && winner !== null
        ? `Player ${winner + 1} wins`
        : `Player ${currentPlayer + 1}'s turn`;
    for (let p = 0; p < 2; p++) {
        groupEls[p].textContent = groupLabel(players[p].group);
        countEls[p].textContent = String(remaining(p));
        panels[p].classList.toggle('active', state !== 'over' && currentPlayer === p);
    }
    powerFill.style.width = `${power * 100}%`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawTable() {
    ctx.fillStyle = '#3a2417';
    roundRect(0, 0, CANVAS_W, CANVAS_H, 14);
    ctx.fill();

    ctx.fillStyle = '#1d1109';
    roundRect(PLAY.x0 - 14, PLAY.y0 - 14, (PLAY.x1 - PLAY.x0) + 28, (PLAY.y1 - PLAY.y0) + 28, 10);
    ctx.fill();

    const felt = ctx.createLinearGradient(0, PLAY.y0, 0, PLAY.y1);
    felt.addColorStop(0, '#176045');
    felt.addColorStop(1, '#0f4632');
    ctx.fillStyle = felt;
    ctx.fillRect(PLAY.x0, PLAY.y0, PLAY.x1 - PLAY.x0, PLAY.y1 - PLAY.y0);

    // Head string and foot spot, the usual table markings.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(HEAD.x, PLAY.y0);
    ctx.lineTo(HEAD.x, PLAY.y1);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.arc(APEX.x, APEX.y, 3, 0, Math.PI * 2);
    ctx.fill();

    for (const p of pockets) {
        ctx.fillStyle = '#07100b';
        ctx.beginPath();
        ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBall(b) {
    ctx.save();
    ctx.translate(b.x, b.y);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.arc(1.5, 2.5, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = b.type === 'stripe' ? '#f8fafc' : b.color;
    ctx.fill();

    if (b.type === 'stripe') {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = b.color;
        ctx.fillRect(-R, -R * 0.55, R * 2, R * 1.1);
        ctx.restore();
    }

    if (b.id !== 0) {
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111827';
        ctx.font = 'bold 8px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.id), 0, 0.5);
    }

    const shine = ctx.createRadialGradient(-R * 0.35, -R * 0.4, 1, 0, 0, R);
    shine.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// Traces the cue ball's path until it meets a ball or a cushion, so the player
// can see where the shot is going.
function aimTarget() {
    const dx = Math.cos(aimAngle);
    const dy = Math.sin(aimAngle);
    let t = 0;
    while (t < 1200) {
        t += 4;
        const x = cue.x + dx * t;
        const y = cue.y + dy * t;
        if (x < PLAY.x0 + R || x > PLAY.x1 - R || y < PLAY.y0 + R || y > PLAY.y1 - R) break;
        const hit = balls.some((b) => !b.potted && b !== cue && Math.hypot(b.x - x, b.y - y) < 2 * R);
        if (hit) break;
    }
    return { x: cue.x + dx * t, y: cue.y + dy * t };
}

function drawAim() {
    if (state !== 'aiming' || cue.potted || !allStopped()) return;
    const target = aimTarget();

    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cue.x, cue.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(target.x, target.y, R, 0, Math.PI * 2);
    ctx.stroke();

    // The cue stick pulls back as power is charged.
    const back = 20 + power * 55;
    const dx = Math.cos(aimAngle);
    const dy = Math.sin(aimAngle);
    const grad = ctx.createLinearGradient(
        cue.x - dx * back, cue.y - dy * back,
        cue.x - dx * (back + 170), cue.y - dy * (back + 170),
    );
    grad.addColorStop(0, '#f5deb3');
    grad.addColorStop(1, '#6b4423');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cue.x - dx * back, cue.y - dy * back);
    ctx.lineTo(cue.x - dx * (back + 170), cue.y - dy * (back + 170));
    ctx.stroke();
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

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawTable();
    for (const b of balls) {
        if (!b.potted) drawBall(b);
    }
    if (cue && !cue.potted) drawAim();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
        startGame();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (e.repeat) return;
        if (state === 'idle' || state === 'over') startGame();
        else beginCharge();
        return;
    }
    if (state !== 'aiming') return;
    if (e.key === 'ArrowLeft') { setAim(aimAngle - AIM_STEP); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setAim(aimAngle + AIM_STEP); e.preventDefault(); }
    if (e.key === 'ArrowUp') { setPower(power + 0.05); e.preventDefault(); }
    if (e.key === 'ArrowDown') { setPower(power - 0.05); e.preventDefault(); }
});

window.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Spacebar') releaseCharge();
});

function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (CANVAS_W / rect.width),
        y: (e.clientY - rect.top) * (CANVAS_H / rect.height),
    };
}

canvas.addEventListener('mousemove', (e) => {
    if (state !== 'aiming' || cue.potted) return;
    const p = canvasPoint(e);
    if (Math.hypot(p.x - cue.x, p.y - cue.y) < 1) return;
    setAim(Math.atan2(p.y - cue.y, p.x - cue.x));
});

canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    beginCharge();
});

window.addEventListener('mouseup', () => releaseCharge());

btnStart.addEventListener('click', () => startGame());

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastFrame = 0;

function frame(now) {
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (state !== 'idle') step(dt);
    draw();
    requestAnimationFrame(frame);
}

rack();
setMessage('Break to open the table');
updateHud();
requestAnimationFrame(frame);
