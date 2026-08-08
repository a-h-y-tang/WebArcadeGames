// ---------------------------------------------------------------------------
// Curling — a turn-based sports game on an HTML5 canvas.
//
// The sheet runs bottom-to-top: the player delivers from the hack at the bottom
// and the house sits at the top. Each end both teams throw four stones; the team
// lying closest to the button scores one point per stone nearer than the
// opponent's best. Three ends decide the match.
//
// Written as a single classic (non-module) script so the state and rules are
// reachable from the Playwright tests as plain globals, mirroring Kaboom, Snake
// and Tetris in this repo. Every bit of motion is expressed per second and
// advanced through `step(dt)`, so the tests can drive the simulation
// deterministically without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Sheet geometry (pixels) ---
const CANVAS_W = 460;
const CANVAS_H = 700;
const SHEET_L = 24;            // left side line
const SHEET_R = 436;           // right side line
const CENTER_X = 230;
const TEE_Y = 150;             // centre of the house (the button)
const BACK_LINE_Y = 62;        // past this and the stone has run through
const HOG_LINE_Y = 430;        // a delivered stone must fully cross this
const RELEASE_X = 230;
const RELEASE_Y = 645;         // the hack
const STONE_R = 13;
const HOUSE_R = 78;            // 12-foot ring
const RING_8 = 52;
const RING_4 = 26;
const BUTTON_R = 9;

// --- Physics (pixels and seconds) ---
const FRICTION = 48;           // deceleration along the direction of travel
const CURL_ACCEL = 4;          // lateral acceleration from the handle
const STOP_SPEED = 5;          // below this a stone is at rest
const RESTITUTION = 0.97;
const V_MIN = 120;             // release speed at power 0
const V_MAX = 290;             // release speed at power 100
const MAX_AIM = 0.12;          // radians either side of the centre line

// --- Rules ---
const STONES_PER_END = 4;      // per team
const TOTAL_ENDS = 3;
const TEAM_YOU = 0;
const TEAM_CPU = 1;
const TEAM_NAMES = ['You', 'CPU'];
const CPU_DELAY = 0.7;         // seconds of "thinking" before the CPU delivers

// --- Opponent search grid ---
const CPU_AIMS = [-0.12, -0.08, -0.04, 0, 0.04, 0.08, 0.12];
const CPU_POWERS = [48, 53, 57, 61, 66, 82, 100];
const CPU_SPINS = [-1, 0, 1];
const CPU_AIM_ERROR = 0.022;   // radians
const CPU_POWER_ERROR = 5;

// --- Colours ---
const TEAM_COLORS = ['#dc2626', '#eab308'];
const TEAM_DARK = ['#7f1d1d', '#854d0e'];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreYouEl = document.getElementById('score-you');
const scoreCpuEl = document.getElementById('score-cpu');
const endEl = document.getElementById('end');
const stonesYouEl = document.getElementById('stones-you');
const stonesCpuEl = document.getElementById('stones-cpu');
const turnEl = document.getElementById('turn');
const powerFillEl = document.getElementById('power-fill');
const powerValueEl = document.getElementById('power-value');
const spinValueEl = document.getElementById('spin-value');
const aimValueEl = document.getElementById('aim-value');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMsg = document.getElementById('overlay-msg');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'aiming' | 'sliding' | 'cpu' | 'endover' | 'gameover'
let state = 'idle';
let stones = [];
let scores = [0, 0];
let stonesLeft = [STONES_PER_END, STONES_PER_END];
let endNumber = 1;
let shotIndex = 0;             // 0..7 within the current end
let leadTeam = TEAM_YOU;       // who throws first this end
let endLog = [];               // [you, cpu] points for each end played so far
let delivered = null;          // the stone currently in motion from a delivery
let cpuTimer = 0;
let cpuNoise = 1;              // scales the CPU's random error (tests set it to 0)
let aim = 0;
let power = 55;
let spin = 0;
let lastFrame = 0;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function buttonDistance(s) {
    return Math.hypot(s.x - CENTER_X, s.y - TEE_Y);
}

// A stone counts if it is touching the rings at all ("biting").
function inHouse(s) {
    return buttonDistance(s) <= HOUSE_R + STONE_R;
}

function speedOf(s) {
    return Math.hypot(s.vx, s.vy);
}

function powerToSpeed(p) {
    return V_MIN + (clamp(p, 0, 100) / 100) * (V_MAX - V_MIN);
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function makeStone(team, x, y, vx, vy, handle) {
    return { team, x, y, vx: vx || 0, vy: vy || 0, spin: handle || 0, angle: 0 };
}

// ---------------------------------------------------------------------------
// Physics
//
// `advanceStones` is shared by the live game and by the opponent's lookahead,
// so a simulated shot obeys exactly the rules a real one does.
// ---------------------------------------------------------------------------

function advanceStones(list, dt) {
    for (const s of list) {
        const speed = speedOf(s);
        if (speed === 0) continue;

        const ux = s.vx / speed;
        const uy = s.vy / speed;
        const next = Math.max(0, speed - FRICTION * dt);

        // The handle pushes the stone sideways for the whole of its run, so a
        // slower stone — which travels for longer — bends further.
        const px = -uy;
        const py = ux;
        s.vx = ux * next + s.spin * CURL_ACCEL * px * dt;
        s.vy = uy * next + s.spin * CURL_ACCEL * py * dt;

        if (speedOf(s) < STOP_SPEED) {
            s.vx = 0;
            s.vy = 0;
        } else {
            s.angle += s.spin * dt * 2;
        }

        s.x += s.vx * dt;
        s.y += s.vy * dt;
    }

    resolveCollisions(list);

    for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        const throughBack = s.y < BACK_LINE_Y;
        const outSide = s.x - STONE_R <= SHEET_L || s.x + STONE_R >= SHEET_R;
        if (throughBack || outSide) list.splice(i, 1);
    }
}

// Equal-mass circle collisions: exchange the velocity components along the line
// of centres, then push the pair apart by their overlap.
function resolveCollisions(list) {
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const a = list[i];
            const b = list[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let d = Math.hypot(dx, dy);
            if (d >= STONE_R * 2 || d === 0) continue;

            const nx = dx / d;
            const ny = dy / d;
            const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;

            if (approach > 0) {
                const jImp = ((1 + RESTITUTION) * approach) / 2;
                a.vx -= jImp * nx;
                a.vy -= jImp * ny;
                b.vx += jImp * nx;
                b.vy += jImp * ny;
                // Neither stone keeps its handle through a hit.
                a.spin = 0;
                b.spin = 0;
            }

            const overlap = STONE_R * 2 - d;
            a.x -= (nx * overlap) / 2;
            a.y -= (ny * overlap) / 2;
            b.x += (nx * overlap) / 2;
            b.y += (ny * overlap) / 2;
        }
    }
}

function allStopped(list) {
    return list.every((s) => s.vx === 0 && s.vy === 0);
}

// A delivered stone that fails to fully cross the far hog line is removed.
// Stones already resting on the ice are never hogged.
function isHogged(s) {
    return s.y + STONE_R >= HOG_LINE_Y;
}

// ---------------------------------------------------------------------------
// Delivery and turn flow
// ---------------------------------------------------------------------------

function currentTeam() {
    return (leadTeam + shotIndex) % 2;
}

function deliver(team, p, angle, handle) {
    const v = powerToSpeed(p);
    const stone = makeStone(
        team,
        RELEASE_X,
        RELEASE_Y,
        Math.sin(angle) * v,
        -Math.cos(angle) * v,
        handle
    );
    stones.push(stone);
    delivered = stone;
    stonesLeft[team] = Math.max(0, stonesLeft[team] - 1);
    state = 'sliding';
    updateHud();
    return stone;
}

// The player's delivery, using the current aim / weight / handle.
function throwStone() {
    if (state !== 'aiming') return null;
    return deliver(currentTeam(), power, aim, spin);
}

function finishShot() {
    if (delivered) {
        const at = stones.indexOf(delivered);
        if (at >= 0 && isHogged(delivered)) stones.splice(at, 1);
        delivered = null;
    }

    shotIndex++;
    if (shotIndex >= STONES_PER_END * 2) {
        scoreEnd();
        return;
    }
    beginTurn();
}

function beginTurn() {
    if (currentTeam() === TEAM_CPU) {
        state = 'cpu';
        cpuTimer = CPU_DELAY;
    } else {
        state = 'aiming';
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function endResult() {
    const counting = stones
        .filter(inHouse)
        .sort((a, b) => buttonDistance(a) - buttonDistance(b));

    if (!counting.length) return { team: -1, points: 0 };

    const team = counting[0].team;
    let points = 0;
    for (const s of counting) {
        if (s.team !== team) break;
        points++;
    }
    return { team, points };
}

function scoreEnd() {
    const result = endResult();
    if (result.team >= 0) scores[result.team] += result.points;

    const row = [0, 0];
    if (result.team >= 0) row[result.team] = result.points;
    endLog[endNumber - 1] = row;
    updateLinescore();

    if (endNumber >= TOTAL_ENDS) {
        state = 'gameover';
        showGameOver();
    } else {
        state = 'endover';
        showEndResult(result);
    }
    updateHud();
}

function nextEnd() {
    if (endNumber >= TOTAL_ENDS) {
        startGame();
        return;
    }
    endNumber++;
    leadTeam = 1 - leadTeam;
    stones = [];
    stonesLeft = [STONES_PER_END, STONES_PER_END];
    shotIndex = 0;
    delivered = null;
    hideOverlay();
    beginTurn();
}

// ---------------------------------------------------------------------------
// Opponent
//
// The CPU brute-forces the same physics the player is subject to: it simulates
// every candidate shot on a copy of the sheet and keeps the one that leaves the
// best position, then misses it slightly on purpose.
// ---------------------------------------------------------------------------

// Runs a shot on a deep copy of the stones and returns the resting position of
// everything left on the sheet. The live game is never touched.
function simulateThrow(p, angle, handle, team) {
    const copy = stones.map((s) => makeStone(s.team, s.x, s.y, s.vx, s.vy, s.spin));
    const v = powerToSpeed(p);
    const shot = makeStone(
        team,
        RELEASE_X,
        RELEASE_Y,
        Math.sin(angle) * v,
        -Math.cos(angle) * v,
        handle
    );
    copy.push(shot);

    const dt = 1 / 60;
    for (let i = 0; i < 1800 && !allStopped(copy); i++) advanceStones(copy, dt);

    const at = copy.indexOf(shot);
    if (at >= 0 && isHogged(shot)) copy.splice(at, 1);

    return copy.map((s) => ({ team: s.team, x: s.x, y: s.y }));
}

// How good a resting position is for `team`: worth 10 a point, plus a small
// bonus for every stone lying near the button. Draws, guards and takeouts all
// fall out of this without being special-cased.
function evaluatePosition(list, team) {
    const counting = list
        .filter(inHouse)
        .sort((a, b) => buttonDistance(a) - buttonDistance(b));

    let points = 0;
    if (counting.length) {
        const lying = counting[0].team;
        for (const s of counting) {
            if (s.team !== lying) break;
            points++;
        }
        if (lying !== team) points = -points;
    }

    let proximity = 0;
    for (const s of list) {
        const near = Math.max(0, 220 - buttonDistance(s)) / 220;
        proximity += (s.team === team ? 1 : -1) * near;
    }

    return points * 10 + proximity;
}

function planCpuShot() {
    let best = null;
    for (const angle of CPU_AIMS) {
        for (const p of CPU_POWERS) {
            for (const handle of CPU_SPINS) {
                const outcome = simulateThrow(p, angle, handle, TEAM_CPU);
                const value = evaluatePosition(outcome, TEAM_CPU);
                if (!best || value > best.value) best = { angle, power: p, spin: handle, value };
            }
        }
    }
    return best;
}

function cpuThrow() {
    const plan = planCpuShot();
    const angle = clamp(
        plan.angle + (Math.random() - 0.5) * 2 * CPU_AIM_ERROR * cpuNoise,
        -MAX_AIM,
        MAX_AIM
    );
    const p = clamp(
        plan.power + (Math.random() - 0.5) * 2 * CPU_POWER_ERROR * cpuNoise,
        0,
        100
    );
    deliver(TEAM_CPU, p, angle, plan.spin);
}

// ---------------------------------------------------------------------------
// Simulation loop
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'sliding') {
        advanceStones(stones, dt);
        if (allStopped(stones)) finishShot();
    } else if (state === 'cpu') {
        cpuTimer -= dt;
        if (cpuTimer <= 0) cpuThrow();
    }
}

// Advance the game until the shot in progress has resolved. From 'sliding' this
// stops as soon as the stones rest; from 'cpu' it runs the pause, the delivery
// and the slide that follows. Used by the animation loop's fast-forward and by
// the tests.
function settle(maxSeconds = 30) {
    const dt = 1 / 60;
    let t = 0;
    while (state === 'cpu' && t < maxSeconds) {
        step(dt);
        t += dt;
    }
    while (state === 'sliding' && t < maxSeconds) {
        step(dt);
        t += dt;
    }
    return t;
}

function frame(now) {
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

function setAim(a) {
    aim = clamp(a, -MAX_AIM, MAX_AIM);
    updateHud();
}

function setPower(p) {
    power = clamp(Math.round(p), 0, 100);
    updateHud();
}

function setSpin(s) {
    spin = clamp(Math.round(s), -1, 1);
    updateHud();
}

// A stone placed straight onto the ice at rest. Used to set up positions.
function placeStone(team, x, y) {
    const s = makeStone(team, x, y);
    stones.push(s);
    return s;
}

function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * (CANVAS_W / rect.width),
        y: (event.clientY - rect.top) * (CANVAS_H / rect.height),
    };
}

document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();

    if (key === 'r') {
        startGame();
        return;
    }

    if (key === 'enter' || key === ' ') {
        event.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else if (state === 'endover') nextEnd();
        else if (state === 'aiming') throwStone();
        return;
    }

    if (state !== 'aiming') return;

    switch (key) {
        case 'arrowleft': event.preventDefault(); setAim(aim - 0.008); break;
        case 'arrowright': event.preventDefault(); setAim(aim + 0.008); break;
        case 'arrowup': event.preventDefault(); setPower(power + 2); break;
        case 'arrowdown': event.preventDefault(); setPower(power - 2); break;
        case 'q': setSpin(-1); break;
        case 'w': setSpin(0); break;
        case 'e': setSpin(1); break;
        default: break;
    }
});

canvas.addEventListener('mousemove', (event) => {
    if (state !== 'aiming') return;
    const p = canvasPoint(event);
    setAim(Math.atan2(p.x - RELEASE_X, RELEASE_Y - p.y));
});

canvas.addEventListener('wheel', (event) => {
    if (state !== 'aiming') return;
    event.preventDefault();
    setPower(power - Math.sign(event.deltaY) * 2);
}, { passive: false });

canvas.addEventListener('click', () => {
    if (state === 'aiming') throwStone();
    else if (state === 'endover') nextEnd();
});

btnStart.addEventListener('click', () => {
    if (state === 'endover') nextEnd();
    else startGame();
});

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------

const SPIN_NAMES = { '-1': 'Counter-clockwise', 0: 'Straight', 1: 'Clockwise' };

function updateHud() {
    scoreYouEl.textContent = String(scores[TEAM_YOU]);
    scoreCpuEl.textContent = String(scores[TEAM_CPU]);
    endEl.textContent = String(endNumber);
    stonesYouEl.textContent = String(stonesLeft[TEAM_YOU]);
    stonesCpuEl.textContent = String(stonesLeft[TEAM_CPU]);
    powerValueEl.textContent = String(power);
    powerFillEl.style.width = power + '%';
    spinValueEl.textContent = SPIN_NAMES[String(spin)];
    aimValueEl.textContent = ((aim * 180) / Math.PI).toFixed(1) + '°';

    if (state === 'aiming') turnEl.textContent = 'Your stone';
    else if (state === 'cpu') turnEl.textContent = 'CPU is thinking…';
    else if (state === 'sliding') turnEl.textContent = 'Stone in motion';
    else turnEl.textContent = 'End ' + endNumber + ' of ' + TOTAL_ENDS;
}

function updateLinescore() {
    for (let i = 0; i < TOTAL_ENDS; i++) {
        const row = document.querySelector('#linescore .end-' + (i + 1));
        if (!row) continue;
        const played = endLog[i];
        const cells = row.querySelectorAll('td');
        cells[1].textContent = played ? String(played[TEAM_YOU]) : '–';
        cells[2].textContent = played ? String(played[TEAM_CPU]) : '–';
        row.classList.toggle('current', !played && i === endNumber - 1);
    }
}

function showOverlay(title, message) {
    overlayTitle.textContent = title;
    overlayMsg.textContent = message;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function showEndResult(result) {
    const line =
        result.team < 0
            ? 'Blank end — nobody scored.'
            : TEAM_NAMES[result.team] +
              ' scored ' + result.points +
              (result.points === 1 ? ' point.' : ' points.');
    btnStart.textContent = 'Next End';
    showOverlay(
        'End ' + endNumber + ' complete',
        line + '  Match: you ' + scores[TEAM_YOU] + ', cpu ' + scores[TEAM_CPU] +
            '. Press Enter for the next end.'
    );
}

function showGameOver() {
    const you = scores[TEAM_YOU];
    const cpu = scores[TEAM_CPU];
    const title = you > cpu ? 'You win!' : you < cpu ? 'You lose' : 'Tied match';
    btnStart.textContent = 'New Match';
    showOverlay(title, 'Final score: you ' + you + ', cpu ' + cpu + '. Press Enter or R to play again.');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawSheet() {
    const ice = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    ice.addColorStop(0, '#f2f7fc');
    ice.addColorStop(1, '#cfdded');
    ctx.fillStyle = ice;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Out-of-play margins outside the side lines.
    ctx.fillStyle = '#b9cadb';
    ctx.fillRect(0, 0, SHEET_L, CANVAS_H);
    ctx.fillRect(SHEET_R, 0, CANVAS_W - SHEET_R, CANVAS_H);

    // House rings.
    const rings = [
        [HOUSE_R, '#2563eb'],
        [RING_8, '#f8fbff'],
        [RING_4, '#dc2626'],
        [BUTTON_R, '#f8fbff'],
    ];
    for (const [r, color] of rings) {
        ctx.beginPath();
        ctx.arc(CENTER_X, TEE_Y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
    }

    ctx.strokeStyle = '#94a9c0';
    ctx.lineWidth = 1;

    // Centre line.
    ctx.beginPath();
    ctx.moveTo(CENTER_X, BACK_LINE_Y);
    ctx.lineTo(CENTER_X, CANVAS_H);
    ctx.stroke();

    // Tee line, back line, hog line.
    for (const [y, width] of [[TEE_Y, 1], [BACK_LINE_Y, 1], [HOG_LINE_Y, 4]]) {
        ctx.lineWidth = width;
        ctx.strokeStyle = width > 1 ? '#e2484d' : '#94a9c0';
        ctx.beginPath();
        ctx.moveTo(SHEET_L, y);
        ctx.lineTo(SHEET_R, y);
        ctx.stroke();
    }
    ctx.lineWidth = 1;

    // The hack.
    ctx.fillStyle = '#9fb3c8';
    ctx.fillRect(RELEASE_X - 16, RELEASE_Y + 18, 32, 8);
}

function drawStone(s) {
    ctx.save();
    ctx.translate(s.x, s.y);

    ctx.beginPath();
    ctx.arc(1.5, 3, STONE_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20, 35, 55, 0.28)';
    ctx.fill();

    const granite = ctx.createRadialGradient(-4, -5, 2, 0, 0, STONE_R);
    granite.addColorStop(0, '#9aa3ad');
    granite.addColorStop(1, '#4b5563');
    ctx.beginPath();
    ctx.arc(0, 0, STONE_R, 0, Math.PI * 2);
    ctx.fillStyle = granite;
    ctx.fill();
    ctx.strokeStyle = '#33404f';
    ctx.stroke();

    ctx.rotate(s.angle);
    ctx.beginPath();
    ctx.arc(0, 0, STONE_R * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLORS[s.team];
    ctx.fill();
    ctx.fillStyle = TEAM_DARK[s.team];
    ctx.fillRect(-STONE_R * 0.5, -1.5, STONE_R, 3);

    ctx.restore();
}

// The aim guide: where this shot would go with nothing in the way.
function drawGuide() {
    const v = powerToSpeed(power);
    const ghost = makeStone(TEAM_YOU, RELEASE_X, RELEASE_Y, Math.sin(aim) * v, -Math.cos(aim) * v, spin);
    const path = [{ x: ghost.x, y: ghost.y }];
    const dt = 1 / 60;
    const solo = [ghost];

    for (let i = 0; i < 1800 && !allStopped(solo); i++) {
        advanceStones(solo, dt);
        if (!solo.length) break;
        if (i % 5 === 0) path.push({ x: ghost.x, y: ghost.y });
    }
    path.push({ x: ghost.x, y: ghost.y });

    ctx.save();
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(30, 64, 120, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (const p of path) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Where it would come to rest.
    ctx.beginPath();
    ctx.arc(ghost.x, ghost.y, STONE_R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.65)';
    ctx.stroke();
    ctx.restore();
}

function draw() {
    drawSheet();
    if (state === 'aiming') drawGuide();

    // The next stone waits in the hack so you can see whose turn it is.
    if ((state === 'aiming' || state === 'cpu') && stonesLeft[currentTeam()] > 0) {
        drawStone(makeStone(currentTeam(), RELEASE_X, RELEASE_Y));
    }

    for (const s of stones) drawStone(s);

    if (state !== 'idle') {
        ctx.fillStyle = 'rgba(15, 32, 55, 0.72)';
        ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Shot ' + Math.min(shotIndex + 1, STONES_PER_END * 2) + ' of ' + STONES_PER_END * 2, SHEET_L + 10, CANVAS_H - 16);
    }
}

// ---------------------------------------------------------------------------
// Set-up
// ---------------------------------------------------------------------------

function startGame() {
    stones = [];
    scores = [0, 0];
    stonesLeft = [STONES_PER_END, STONES_PER_END];
    endNumber = 1;
    shotIndex = 0;
    leadTeam = TEAM_YOU;
    delivered = null;
    endLog = [];
    aim = 0;
    power = 55;
    spin = 0;
    btnStart.textContent = 'Start Match';
    updateLinescore();
    hideOverlay();
    beginTurn();
}

showOverlay('CURLING', 'Press Enter or click Start to play');
updateLinescore();
updateHud();
draw();
requestAnimationFrame(frame);
