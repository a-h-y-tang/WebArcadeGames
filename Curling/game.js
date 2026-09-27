// ---------------------------------------------------------------------------
// Curling — a turn-based ice sport on an HTML5 canvas.
//
// You and the computer alternate sliding stones up a sheet of ice toward the
// house (the target rings). Stones decelerate under friction, curl sideways
// depending on the handle put on them, and bounce off each other. When all
// eight stones of an end have been thrown, the team with the stone nearest the
// button scores.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Snake and Tetris in this repo. All motion is expressed per-second and driven
// through `step(dt)` / `advance(list, h)`, so tests can simulate deliveries
// deterministically without depending on requestAnimationFrame wall-clock
// timing. `setAutoPlay(false)` detaches the animation loop entirely.
// ---------------------------------------------------------------------------

// --- Sheet geometry (a tall, narrow sheet: the house is at the top) ---
const CANVAS_W = 400;
const CANVAS_H = 700;
const HOUSE_X = 200;          // centre line
const HOUSE_Y = 160;          // the button (tee)
const RING_12 = 72;           // twelve-foot (outer) ring
const RING_8 = 48;
const RING_4 = 24;
const BUTTON_R = 10;
const HOG_Y = 380;            // stones must finish beyond (above) this line
const BACK_Y = HOUSE_Y - RING_12;  // stones past this line are out of play
const RELEASE_Y = 640;        // where a delivered stone leaves the hack

// --- Stones ---
const STONE_R = 12;
const FRICTION = 60;          // px/s^2 of deceleration along the direction of travel
const CURL_ACCEL = 6;         // px/s^2 sideways, sign set by the handle
const STOP_SPEED = 2;         // below this a stone is considered at rest
const MIN_SPEED = 140;        // release speed at 0% weight
const MAX_SPEED = 280;        // release speed at 100% weight

// --- Match ---
const STONES_PER_TEAM = 4;
const ENDS = 4;
const MAX_AIM = 0.22;         // radians either side of the centre line
const AIM_STEP = 0.01;
const POWER_STEP = 0.02;
const CPU_DELAY = 0.9;        // seconds the computer "thinks" before throwing

// --- Computer opponent ---
const CPU_POWERS = [0.50, 0.56, 0.62, 0.68, 0.74, 0.80, 0.86];
const CPU_AIMS = [-0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15];
const CPU_POWER_ERROR = 0.035;   // execution error, +/- this much weight
const CPU_AIM_ERROR = 0.018;     // ... and this much aim

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const endEl = document.getElementById('end');
const endsTotalEl = document.getElementById('ends-total');
const scoreYouEl = document.getElementById('score-you');
const scoreCpuEl = document.getElementById('score-cpu');
const stonesLeftEl = document.getElementById('stones-left');
const turnEl = document.getElementById('turn');
const powerValueEl = document.getElementById('power-value');
const handleValueEl = document.getElementById('handle-value');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'aiming' | 'sliding' | 'end-over' | 'over'
let state = 'idle';
let end = 1;
let stonesThrown = 0;
let firstTeam = 'you';        // team that throws first this end (i.e. without hammer)
let aim = 0;
let power = 0.6;
let handle = 1;               // +1 in-turn (curls right), -1 out-turn (curls left)
let lastResult = { team: null, points: 0 };
let autoPlay = true;
let cpuTimer = CPU_DELAY;
const scores = { you: 0, cpu: 0 };
const stones = [];

// ---------------------------------------------------------------------------
// Deterministic RNG — the computer's execution error is seedable so the tests
// (and any replay) can reproduce a delivery exactly.
// ---------------------------------------------------------------------------

let rngState = 123456789;

function setSeed(n) {
    rngState = (n >>> 0) || 1;
}

function rand() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
}

// ---------------------------------------------------------------------------
// Aim / weight / handle
// ---------------------------------------------------------------------------

function setAim(a) {
    aim = Math.max(-MAX_AIM, Math.min(MAX_AIM, a));
    updateHud();
    return aim;
}

function setPower(p) {
    power = Math.max(0, Math.min(1, p));
    updateHud();
    return power;
}

function setHandle(h) {
    handle = h < 0 ? -1 : 1;
    updateHud();
    return handle;
}

function toggleHandle() {
    return setHandle(-handle);
}

function releaseSpeed(p) {
    return MIN_SPEED + p * (MAX_SPEED - MIN_SPEED);
}

// ---------------------------------------------------------------------------
// Stones
// ---------------------------------------------------------------------------

function makeStone(team, x, y, vx, vy, h) {
    return { team, x, y, vx: vx || 0, vy: vy || 0, handle: h === undefined ? 1 : h };
}

// Drop a motionless stone onto the sheet. Used by the tests to build up a
// position, and never by normal play.
function placeStone(team, x, y) {
    const s = makeStone(team, x, y, 0, 0, 1);
    stones.push(s);
    return s;
}

// Put a stone in motion with an explicit velocity and start the slide.
function launchStone(team, x, y, vx, vy, h) {
    const s = makeStone(team, x, y, vx, vy, h);
    stones.push(s);
    state = 'sliding';
    return s;
}

// Deliver the next stone using the current aim / weight / handle.
function throwStone() {
    if (state !== 'aiming') return null;
    const v = releaseSpeed(power);
    return launchStone(currentTeam(), CANVAS_W / 2, RELEASE_Y,
        Math.sin(aim) * v, -Math.cos(aim) * v, handle);
}

function currentTeam() {
    const other = firstTeam === 'you' ? 'cpu' : 'you';
    return stonesThrown % 2 === 0 ? firstTeam : other;
}

function stonesRemaining() {
    return Math.max(0, STONES_PER_TEAM * 2 - stonesThrown);
}

function distanceToButton(s) {
    return Math.hypot(s.x - HOUSE_X, s.y - HOUSE_Y);
}

// A stone counts if any part of it overlaps the twelve-foot ring.
function isInHouse(s) {
    return distanceToButton(s) - STONE_R < RING_12;
}

// ---------------------------------------------------------------------------
// Physics — pure over a list of stones so the computer can simulate candidate
// deliveries on a throwaway copy of the sheet.
// ---------------------------------------------------------------------------

function integrate(list, h) {
    for (const s of list) {
        const sp = Math.hypot(s.vx, s.vy);
        if (sp === 0) continue;
        const ux = s.vx / sp, uy = s.vy / sp;
        const ns = sp - FRICTION * h;
        if (ns <= STOP_SPEED) {
            s.vx = 0;
            s.vy = 0;
            continue;
        }
        // Curl: a sideways acceleration perpendicular to the direction of
        // travel. +1 (in-turn) pushes the stone to the right of its path.
        s.vx = ux * ns + (-uy) * CURL_ACCEL * s.handle * h;
        s.vy = uy * ns + ux * CURL_ACCEL * s.handle * h;
        s.x += s.vx * h;
        s.y += s.vy * h;
    }
}

// Equal-mass elastic collisions: the stones swap the components of their
// velocity along the line of centres, which is what granite on ice does closely
// enough to feel right.
function resolveCollisions(list) {
    const minDist = STONE_R * 2;
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            let dx = b.x - a.x, dy = b.y - a.y;
            let d = Math.hypot(dx, dy);
            if (d >= minDist) continue;
            if (d === 0) { dx = 0; dy = minDist; d = minDist; }
            const nx = dx / d, ny = dy / d;
            const overlap = (minDist - d) / 2;
            a.x -= nx * overlap; a.y -= ny * overlap;
            b.x += nx * overlap; b.y += ny * overlap;
            const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (vn >= 0) continue;   // already separating
            a.vx += vn * nx; a.vy += vn * ny;
            b.vx -= vn * nx; b.vy -= vn * ny;
        }
    }
}

// Side lines and the back line take stones out of play the instant they cross.
function removeOutOfBounds(list) {
    for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        if (s.x - STONE_R <= 0 || s.x + STONE_R >= CANVAS_W || s.y < BACK_Y) {
            list.splice(i, 1);
        }
    }
}

// Anything that has not crossed the far hog line once the sheet is still is
// swept off. (Simplification: real curling applies this only to the delivered
// stone — see DESIGN.md.)
function sweepHogged(list) {
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].y > HOG_Y) list.splice(i, 1);
    }
}

function allStopped(list) {
    return list.every((s) => s.vx === 0 && s.vy === 0);
}

function advance(list, h) {
    integrate(list, h);
    resolveCollisions(list);
    removeOutOfBounds(list);
}

// Advance the live sheet by `dt` seconds in small fixed sub-steps so fast
// stones can never tunnel through a stationary one.
function step(dt) {
    if (state !== 'sliding') return;
    const SUB = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-6) {
        const h = Math.min(SUB, remaining);
        advance(stones, h);
        remaining -= h;
    }
    if (allStopped(stones)) endDelivery();
    updateHud();
}

// Run the current delivery out to rest. Used by the tests, and by nothing in
// normal play (where the animation loop does the stepping).
function settle() {
    let guard = 0;
    while (state === 'sliding' && guard++ < 8000) step(1 / 120);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

// Score a list of stones: the team holding the stone nearest the button counts
// one point for every stone it has closer than the opponent's best.
function scoreList(list) {
    const inHouse = list.filter(isInHouse)
        .slice()
        .sort((a, b) => distanceToButton(a) - distanceToButton(b));
    if (inHouse.length === 0) return { team: null, points: 0 };
    const team = inHouse[0].team;
    const rival = inHouse.find((s) => s.team !== team);
    const limit = rival ? distanceToButton(rival) : Infinity;
    const points = inHouse.filter((s) => s.team === team && distanceToButton(s) < limit).length;
    return { team, points };
}

function scoreEnd() {
    return scoreList(stones);
}

// The stone currently lying closest to the button — "shot rock" — or null when
// nothing is in the house.
function shotStone() {
    let best = null;
    let bestDist = Infinity;
    for (const s of stones) {
        if (!isInHouse(s)) continue;
        const d = distanceToButton(s);
        if (d < bestDist) { bestDist = d; best = s; }
    }
    return best;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'aiming';
    end = 1;
    stonesThrown = 0;
    scores.you = 0;
    scores.cpu = 0;
    firstTeam = 'you';           // the computer holds the hammer in end 1
    stones.length = 0;
    lastResult = { team: null, points: 0 };
    aim = 0;
    power = 0.6;
    handle = 1;
    cpuTimer = CPU_DELAY;
    hideOverlay();
    updateHud();
}

// Called once every stone on the sheet has come to rest.
function endDelivery() {
    sweepHogged(stones);
    state = 'aiming';
    stonesThrown += 1;
    aim = 0;
    cpuTimer = CPU_DELAY;
    if (stonesThrown >= STONES_PER_TEAM * 2) finishEnd();
    updateHud();
}

function finishEnd() {
    lastResult = scoreEnd();
    if (lastResult.team) {
        scores[lastResult.team] += lastResult.points;
        // The team that scores throws first (and so loses the hammer) next end.
        firstTeam = lastResult.team;
    }
    state = 'end-over';
    const label = lastResult.team === 'you' ? 'You score ' + lastResult.points
        : lastResult.team === 'cpu' ? 'CPU scores ' + lastResult.points
            : 'Blank end';
    const last = end >= ENDS;
    showOverlay(
        'End ' + end + ' — ' + label,
        'You ' + scores.you + ' · CPU ' + scores.cpu,
        last ? 'Press Space for the final score' : 'Press Space for the next end',
        last ? 'Final Score' : 'Next End');
    updateHud();
}

function nextEnd() {
    if (state !== 'end-over') return;
    if (end >= ENDS) {
        gameOver();
        return;
    }
    end += 1;
    stonesThrown = 0;
    stones.length = 0;
    aim = 0;
    cpuTimer = CPU_DELAY;
    state = 'aiming';
    hideOverlay();
    updateHud();
}

function gameOver() {
    state = 'over';
    const title = scores.you > scores.cpu ? 'You Win!'
        : scores.cpu > scores.you ? 'CPU Wins'
            : 'Tied Game';
    showOverlay(title, 'You ' + scores.you + ' · CPU ' + scores.cpu,
        'Press Space to play again', 'Play Again');
    updateHud();
}

// ---------------------------------------------------------------------------
// Computer opponent
//
// The physics are pure, so the computer can just try a grid of deliveries on a
// copy of the sheet and keep the one with the best outcome — then throw it with
// a little execution error so it is beatable.
// ---------------------------------------------------------------------------

function simulateThrow(p, a, h) {
    const sim = stones.map((s) => ({ team: s.team, x: s.x, y: s.y, vx: s.vx, vy: s.vy, handle: s.handle }));
    const v = releaseSpeed(p);
    sim.push(makeStone('cpu', CANVAS_W / 2, RELEASE_Y, Math.sin(a) * v, -Math.cos(a) * v, h));
    let guard = 0;
    while (!allStopped(sim) && guard++ < 4000) advance(sim, 1 / 120);
    sweepHogged(sim);
    return sim;
}

function evaluatePosition(list) {
    const r = scoreList(list);
    let value = r.team === 'cpu' ? r.points * 10 : r.team === 'you' ? -r.points * 10 : 0;
    // Prefer being close to the button, and prefer keeping stones in play.
    let best = Infinity;
    let own = 0;
    for (const s of list) {
        if (s.team !== 'cpu') continue;
        own += 1;
        best = Math.min(best, distanceToButton(s));
    }
    value -= Math.min(best, 400) / 100;
    value += own * 0.4;
    return value;
}

function planCpuThrow() {
    let bestPlan = { power: 0.62, aim: -0.07, handle: 1 };
    let bestValue = -Infinity;
    for (const h of [1, -1]) {
        for (const p of CPU_POWERS) {
            for (const a of CPU_AIMS) {
                const value = evaluatePosition(simulateThrow(p, a, h));
                if (value > bestValue) {
                    bestValue = value;
                    bestPlan = { power: p, aim: a, handle: h };
                }
            }
        }
    }
    return {
        power: Math.max(0, Math.min(1, bestPlan.power + (rand() - 0.5) * 2 * CPU_POWER_ERROR)),
        aim: Math.max(-MAX_AIM, Math.min(MAX_AIM, bestPlan.aim + (rand() - 0.5) * 2 * CPU_AIM_ERROR)),
        handle: bestPlan.handle,
    };
}

function cpuThrow() {
    if (state !== 'aiming') return null;
    const plan = planCpuThrow();
    const v = releaseSpeed(plan.power);
    return launchStone('cpu', CANVAS_W / 2, RELEASE_Y,
        Math.sin(plan.aim) * v, -Math.cos(plan.aim) * v, plan.handle);
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    endEl.textContent = String(end);
    endsTotalEl.textContent = String(ENDS);
    scoreYouEl.textContent = String(scores.you);
    scoreCpuEl.textContent = String(scores.cpu);
    stonesLeftEl.textContent = String(stonesRemaining());
    turnEl.textContent = state === 'over' ? '—' : currentTeam() === 'you' ? 'You' : 'CPU';
    powerValueEl.textContent = Math.round(power * 100) + '%';
    handleValueEl.textContent = handle === 1 ? 'In-turn' : 'Out-turn';
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

// The dashed guide the player aims with: a lone stone integrated forward with
// no other stones on the sheet, so it shows the curl but not the carnage.
function predictPath(p, a, h) {
    const v = releaseSpeed(p);
    const ghost = [makeStone('you', CANVAS_W / 2, RELEASE_Y, Math.sin(a) * v, -Math.cos(a) * v, h)];
    const pts = [{ x: ghost[0].x, y: ghost[0].y }];
    let guard = 0;
    while (ghost.length && !allStopped(ghost) && guard++ < 4000) {
        advance(ghost, 1 / 120);
        if (ghost.length && guard % 12 === 0) pts.push({ x: ghost[0].x, y: ghost[0].y });
    }
    if (ghost.length) pts.push({ x: ghost[0].x, y: ghost[0].y });
    return pts;
}

function drawSheet() {
    ctx.fillStyle = '#eaf2fb';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // The delivery lane below the hog line, shaded a shade darker.
    ctx.fillStyle = '#e0eaf6';
    ctx.fillRect(0, HOG_Y, CANVAS_W, CANVAS_H - HOG_Y);

    // House rings.
    const rings = [[RING_12, '#3b82f6'], [RING_8, '#f8fbff'], [RING_4, '#dc2626'], [BUTTON_R, '#f8fbff']];
    for (const [r, colour] of rings) {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(HOUSE_X, HOUSE_Y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Centre line and tee line.
    ctx.strokeStyle = '#9db4cd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(HOUSE_X, 0); ctx.lineTo(HOUSE_X, CANVAS_H);
    ctx.moveTo(HOUSE_X - RING_12 - 20, HOUSE_Y); ctx.lineTo(HOUSE_X + RING_12 + 20, HOUSE_Y);
    ctx.stroke();

    // Back line and hog line.
    ctx.strokeStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(0, BACK_Y); ctx.lineTo(CANVAS_W, BACK_Y);
    ctx.stroke();

    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, HOG_Y); ctx.lineTo(CANVAS_W, HOG_Y);
    ctx.stroke();
    ctx.lineWidth = 1;

    // The hack the player throws from.
    ctx.fillStyle = '#c2d3e6';
    ctx.fillRect(HOUSE_X - 16, RELEASE_Y + 22, 32, 10);
}

function drawStone(s) {
    ctx.fillStyle = '#9aa5b1';
    ctx.beginPath();
    ctx.arc(s.x, s.y, STONE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5b6673';
    ctx.stroke();
    ctx.fillStyle = s.team === 'you' ? '#c0392b' : '#e0a021';
    ctx.beginPath();
    ctx.arc(s.x, s.y, STONE_R - 5, 0, Math.PI * 2);
    ctx.fill();
}

function drawAimGuide() {
    if (state !== 'aiming' || currentTeam() !== 'you') return;
    const pts = predictPath(power, aim, handle);
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    ctx.restore();

    // Where that weight would leave the stone.
    const last = pts[pts.length - 1];
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.75)';
    ctx.beginPath();
    ctx.arc(last.x, last.y, STONE_R, 0, Math.PI * 2);
    ctx.stroke();
}

function drawPowerMeter() {
    const x = 14, y = CANVAS_H - 150, w = 12, h = 130;
    ctx.fillStyle = '#c7d6e6';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(x, y + h * (1 - power), w, h * power);
    ctx.strokeStyle = '#64748b';
    ctx.strokeRect(x, y, w, h);
}

function draw() {
    drawSheet();
    drawAimGuide();
    for (const s of stones) drawStone(s);

    // Mark the stone currently counting as shot rock.
    const shot = shotStone();
    if (shot && state !== 'sliding') {
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(shot.x, shot.y, STONE_R + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
    }

    if (state !== 'idle' && state !== 'over') drawPowerMeter();

    // Which stones are still to come.
    for (let i = 0; i < stonesRemaining(); i++) {
        const team = (stonesThrown + i) % 2 === 0 ? firstTeam : (firstTeam === 'you' ? 'cpu' : 'you');
        ctx.fillStyle = team === 'you' ? '#c0392b' : '#e0a021';
        ctx.beginPath();
        ctx.arc(CANVAS_W - 22, CANVAS_H - 24 - i * 22, 8, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ---------------------------------------------------------------------------
// Main loop. Physics runs through the same `step()` the tests use; setting
// `setAutoPlay(false)` detaches it so tests can drive the clock themselves.
// ---------------------------------------------------------------------------

function setAutoPlay(v) {
    autoPlay = !!v;
}

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;   // clamp after tab switches / long frames

    if (autoPlay) {
        if (state === 'sliding') {
            step(dt);
        } else if (state === 'aiming' && currentTeam() === 'cpu') {
            cpuTimer -= dt;
            if (cpuTimer <= 0) cpuThrow();
        }
    }
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function playerReady() {
    return state === 'aiming' && currentTeam() === 'you';
}

window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'end-over') nextEnd();
        else if (playerReady()) throwStone();
        e.preventDefault();
        return;
    }
    if (e.key === 'h' || e.key === 'H') {
        if (playerReady()) toggleHandle();
        e.preventDefault();
        return;
    }
    if (!playerReady()) return;
    switch (e.key) {
        case 'ArrowLeft': setAim(aim - AIM_STEP); e.preventDefault(); break;
        case 'ArrowRight': setAim(aim + AIM_STEP); e.preventDefault(); break;
        case 'ArrowUp': setPower(power + POWER_STEP); e.preventDefault(); break;
        case 'ArrowDown': setPower(power - POWER_STEP); e.preventDefault(); break;
        default: break;
    }
});

function pointerAim(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    const dy = Math.max(40, RELEASE_Y - y);
    setAim(Math.atan2(x - CANVAS_W / 2, dy));
}

canvas.addEventListener('mousemove', (e) => {
    if (playerReady()) pointerAim(e);
});

canvas.addEventListener('click', (e) => {
    if (!playerReady()) return;
    pointerAim(e);
    throwStone();
});

btnStart.addEventListener('click', () => {
    if (state === 'end-over') nextEnd();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

updateHud();
requestAnimationFrame(frame);
