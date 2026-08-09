// ---------------------------------------------------------------------------
// Curling — a turn-based ice sport on an HTML5 canvas.
//
// The player (red) and the CPU (yellow) alternate sliding stones up a sheet of
// ice towards the house. Stones lose speed to friction, bend sideways according
// to the handle ("curl") they were thrown with, and knock each other around on
// contact. When both teams have thrown all their stones the end is scored: the
// team holding the stone nearest the button scores one point for every stone it
// has closer than the opponent's best.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Sheet geometry ---
const CANVAS_W = 420;
const CANVAS_H = 720;
const SIDE_LEFT = 20;          // left side line; a stone touching it is out
const SIDE_RIGHT = 400;        // right side line
const BUTTON_X = 210;          // centre of the house
const BUTTON_Y = 170;
const RING_RADII = [78, 52, 26, 13];  // 12ft, 8ft, 4ft, button
const HOUSE_R = RING_RADII[0];
const BACK_LINE = 80;          // stones past this are out of play
const TEE_LINE = BUTTON_Y;
const HOG_LINE = 560;          // a thrown stone must finish past this line
const RELEASE_X = 210;
const RELEASE_Y = 672;

// --- Stones & physics ---
const STONE_R = 13;
const FRICTION = 60;           // px/s² of deceleration from the ice
const STOP_SPEED = 3;          // px/s below which a stone is considered stopped
const RESTITUTION = 0.96;      // stone-on-stone bounciness
const CURL_K = 20;             // strength of the sideways curl acceleration
const CURL_REF = 50;           // curl grows as speed drops towards this value

// --- Delivery ---
const MIN_SPEED = 100;         // release speed at power 0 (short of the hog line)
const POWER_RANGE = 260;       // extra release speed at power 1
const MAX_AIM = 0.22;          // radians either side of straight
const AIM_STEP = 0.012;        // radians per arrow-key press
const CHARGE_PERIOD = 1.6;     // seconds for a full up-and-down power sweep

// --- Match format ---
const TOTAL_ENDS = 4;
const STONES_PER_TEAM = 4;

// --- CPU ---
const CPU_DELAY = 0.5;         // seconds of "thinking" before the CPU throws
const CPU_ANGLE_NOISE = 0.020;
const CPU_POWER_NOISE = 0.055;
const TAKEOUT_EXTRA = 260;     // extra sliding distance aimed through a takeout

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const endEl = document.getElementById('end');
const scorePlayerEl = document.getElementById('score-player');
const scoreCpuEl = document.getElementById('score-cpu');
const stonesLeftEl = document.getElementById('stones-left');
const recordEl = document.getElementById('record');
const turnEl = document.getElementById('turn');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'aiming' | 'sliding' | 'endbreak' | 'over'
let state, end, hammer, currentTeam, lastThrown, charging, chargeT, cpuTimer;
let autoCpu = true;            // tests switch this off to drive the CPU by hand
const scores = [0, 0];         // [player, cpu]
const thrown = [0, 0];         // stones delivered this end
const stones = [];
const aim = { angle: 0, power: 0, curl: 0 };
let record = { w: 0, l: 0 };

// ---------------------------------------------------------------------------
// Aim controls
// ---------------------------------------------------------------------------

function setAim(angle) {
    aim.angle = Math.max(-MAX_AIM, Math.min(MAX_AIM, angle));
}

function setPower(power) {
    aim.power = Math.max(0, Math.min(1, power));
}

function setCurl(curl) {
    aim.curl = curl > 0 ? 1 : curl < 0 ? -1 : 0;
}

function resetAim() {
    aim.angle = 0;
    aim.power = 0;
    charging = false;
    chargeT = 0;
}

// The power meter sweeps 0 → 1 → 0 while the throw button is held, so the
// player has to release it at the right moment.
function chargePower(t) {
    const phase = (t % CHARGE_PERIOD) / CHARGE_PERIOD;
    return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

function startCharge() {
    if (state !== 'aiming' || charging) return;
    charging = true;
    chargeT = 0;
    setPower(0);
}

function releaseCharge() {
    if (!charging) return;
    charging = false;
    throwStone();
}

// ---------------------------------------------------------------------------
// Stones
// ---------------------------------------------------------------------------

function addStone(opts) {
    const stone = {
        x: opts.x,
        y: opts.y,
        vx: opts.vx || 0,
        vy: opts.vy || 0,
        team: opts.team || 0,
        curl: opts.curl || 0,
    };
    stones.push(stone);
    return stone;
}

function throwStone() {
    if (state !== 'aiming') return null;
    const speed = MIN_SPEED + aim.power * POWER_RANGE;
    lastThrown = addStone({
        x: RELEASE_X,
        y: RELEASE_Y,
        vx: Math.sin(aim.angle) * speed,
        vy: -Math.cos(aim.angle) * speed,
        team: currentTeam,
        curl: aim.curl,
    });
    thrown[currentTeam] += 1;
    charging = false;
    state = 'sliding';
    updateHud();
    return lastThrown;
}

function anyStoneMoving() {
    return stones.some((s) => s.vx !== 0 || s.vy !== 0);
}

function distanceToButton(stone) {
    return Math.hypot(stone.x - BUTTON_X, stone.y - BUTTON_Y);
}

function inHouse(stone) {
    return distanceToButton(stone) <= HOUSE_R + STONE_R;
}

function stonesInHouse() {
    return stones
        .filter(inHouse)
        .sort((a, b) => distanceToButton(a) - distanceToButton(b));
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

function resolveCollisions() {
    for (let i = 0; i < stones.length; i++) {
        for (let j = i + 1; j < stones.length; j++) {
            const a = stones[i];
            const b = stones[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let d = Math.hypot(dx, dy);
            if (d >= STONE_R * 2) continue;
            if (d < 1e-6) { dx = 0; dy = 1; d = 1e-6; }  // perfectly stacked
            const nx = dx / d;
            const ny = dy / d;

            // Push the pair apart so resting stones never overlap.
            const overlap = (STONE_R * 2 - d) / 2;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;

            // Equal-mass impulse along the contact normal.
            const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rvn >= 0) continue;
            const impulse = (-(1 + RESTITUTION) * rvn) / 2;
            a.vx -= impulse * nx;
            a.vy -= impulse * ny;
            b.vx += impulse * nx;
            b.vy += impulse * ny;
        }
    }
}

function substep(h) {
    for (const s of stones) {
        let speed = Math.hypot(s.vx, s.vy);
        if (speed <= 0) continue;

        // Curl: an acceleration perpendicular to travel that bites harder as
        // the stone slows down, which is what makes a curling stone bend late.
        if (s.curl) {
            const px = -s.vy / speed;
            const py = s.vx / speed;
            const a = (CURL_K * s.curl) / (1 + speed / CURL_REF);
            s.vx += px * a * h;
            s.vy += py * a * h;
            speed = Math.hypot(s.vx, s.vy);
        }

        // Friction acts against the direction of travel.
        const next = speed - FRICTION * h;
        if (next <= STOP_SPEED) {
            s.vx = 0;
            s.vy = 0;
            continue;
        }
        const scale = next / speed;
        s.vx *= scale;
        s.vy *= scale;
        s.x += s.vx * h;
        s.y += s.vy * h;
    }
    resolveCollisions();
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so fast
// stones never tunnel through each other and the result is frame-rate
// independent. While the player is charging a throw the same call advances the
// power meter instead.
function step(dt) {
    if (state === 'aiming') {
        if (charging) {
            chargeT += dt;
            setPower(chargePower(chargeT));
        }
        return;
    }
    if (state !== 'sliding') return;

    const SUB = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-6) {
        const h = Math.min(SUB, remaining);
        substep(h);
        remaining -= h;
    }
    if (!anyStoneMoving()) resolveShot();
    updateHud();
}

// ---------------------------------------------------------------------------
// Shot resolution & turn order
// ---------------------------------------------------------------------------

function resolveShot() {
    for (let i = stones.length - 1; i >= 0; i--) {
        const s = stones[i];
        s.vx = 0;
        s.vy = 0;
        const offSide = s.x - STONE_R < SIDE_LEFT || s.x + STONE_R > SIDE_RIGHT;
        const throughBack = s.y < BACK_LINE;
        const shortOfHog = s === lastThrown && s.y > HOG_LINE;
        if (offSide || throughBack || shortOfHog) stones.splice(i, 1);
    }
    lastThrown = null;
    nextTurn();
}

function nextTurn() {
    if (thrown[0] + thrown[1] >= STONES_PER_TEAM * 2) {
        finishEnd();
        return;
    }
    currentTeam = 1 - currentTeam;
    state = 'aiming';
    resetAim();
    cpuTimer = CPU_DELAY;
    updateHud();
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

// Only the team lying closest to the button scores, and it scores one point for
// each of its stones nearer than the opponent's best stone.
function scoreEnd() {
    const house = stonesInHouse();
    if (house.length === 0) return { team: -1, points: 0 };
    const team = house[0].team;
    let points = 0;
    for (const s of house) {
        if (s.team !== team) break;
        points += 1;
    }
    return { team, points };
}

function finishEnd() {
    const result = scoreEnd();
    if (result.points > 0) {
        scores[result.team] += result.points;
        hammer = 1 - result.team;   // the team that conceded throws last next end
    }
    end += 1;
    updateHud();

    // A tied match after the scheduled ends goes to extra ends.
    if (end > TOTAL_ENDS && scores[0] !== scores[1]) {
        endGame();
        return;
    }

    state = 'endbreak';
    const summary = result.points > 0
        ? (result.team === 0 ? 'You score ' : 'CPU scores ') + result.points
        : 'Blank end — no points';
    const label = end > TOTAL_ENDS ? 'Extra End' : 'End ' + end + ' of ' + TOTAL_ENDS;
    showOverlay(
        summary,
        'You ' + scores[0] + ' — ' + scores[1] + ' CPU',
        label + ' · ' + (hammer === 0 ? 'you hold' : 'the CPU holds') + ' the hammer',
        'Next End',
    );
}

function endGame() {
    state = 'over';
    let title = 'Draw';
    if (scores[0] > scores[1]) {
        title = 'You Win!';
        record.w += 1;
        saveRecord();
    } else if (scores[1] > scores[0]) {
        title = 'CPU Wins';
        record.l += 1;
        saveRecord();
    }
    showOverlay(
        title,
        'You ' + scores[0] + ' — ' + scores[1] + ' CPU',
        'Press Space to play again',
        'Play Again',
    );
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startEnd() {
    stones.length = 0;
    thrown[0] = 0;
    thrown[1] = 0;
    lastThrown = null;
    currentTeam = 1 - hammer;   // the team without the hammer leads off
    state = 'aiming';
    resetAim();
    setCurl(0);
    cpuTimer = CPU_DELAY;
    hideOverlay();
    updateHud();
}

function startGame() {
    scores[0] = 0;
    scores[1] = 0;
    end = 1;
    hammer = 1;                 // the CPU holds the hammer in the first end
    startEnd();
}

// ---------------------------------------------------------------------------
// CPU opponent
// ---------------------------------------------------------------------------

// Pick a shot: clear the opponent out when they are lying closer to the button,
// otherwise draw to the button.
function cpuPlan() {
    const shooter = currentTeam;
    const opponent = 1 - shooter;
    const house = stonesInHouse();
    const bestOpponent = house.find((s) => s.team === opponent);
    const bestOwn = house.find((s) => s.team === shooter);
    const opponentD = bestOpponent ? distanceToButton(bestOpponent) : Infinity;
    const ownD = bestOwn ? distanceToButton(bestOwn) : Infinity;

    if (bestOpponent && opponentD < ownD) {
        return Object.assign(
            { kind: 'takeout' },
            deliveryFor(bestOpponent.x, bestOpponent.y, TAKEOUT_EXTRA),
        );
    }
    return Object.assign({ kind: 'draw' }, deliveryFor(BUTTON_X, BUTTON_Y, 0));
}

// Solve for the aim angle and power that stop a stone at (tx, ty), optionally
// carrying `extra` px of momentum through the target for a takeout.
function deliveryFor(tx, ty, extra) {
    const dx = tx - RELEASE_X;
    const dy = RELEASE_Y - ty;
    const distance = Math.max(1, Math.hypot(dx, dy)) + extra;
    const speed = Math.sqrt(2 * FRICTION * distance + STOP_SPEED * STOP_SPEED);
    return {
        angle: Math.max(-MAX_AIM, Math.min(MAX_AIM, Math.atan2(dx, dy))),
        power: Math.max(0, Math.min(1, (speed - MIN_SPEED) / POWER_RANGE)),
        targetX: tx,
        targetY: ty,
    };
}

function cpuTakeShot() {
    if (state !== 'aiming') return;
    const plan = cpuPlan();
    setAim(plan.angle + (Math.random() - 0.5) * CPU_ANGLE_NOISE);
    setPower(plan.power + (Math.random() - 0.5) * CPU_POWER_NOISE);
    setCurl(0);                 // the CPU always throws a straight handle
    throwStone();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    endEl.textContent = String(end);
    scorePlayerEl.textContent = String(scores[0]);
    scoreCpuEl.textContent = String(scores[1]);
    stonesLeftEl.textContent = String(Math.max(0, STONES_PER_TEAM - thrown[0]));
    recordEl.textContent = record.w + '-' + record.l;
    turnEl.textContent = turnMessage();
}

function turnMessage() {
    if (state === 'idle') return 'Press Space to throw the first stone';
    if (state === 'over') return 'Match over';
    if (state === 'endbreak') return 'End complete';
    if (state === 'sliding') return 'Stone in motion…';
    return currentTeam === 0
        ? 'Your turn — aim, then hold to set the weight'
        : 'CPU is lining up its shot…';
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

function saveRecord() {
    try {
        localStorage.setItem('curling-record', JSON.stringify(record));
    } catch (e) { /* storage unavailable — the record just won't persist */ }
}

function loadRecord() {
    try {
        const raw = JSON.parse(localStorage.getItem('curling-record'));
        if (raw && typeof raw.w === 'number' && typeof raw.l === 'number') record = raw;
    } catch (e) { /* ignore malformed or unavailable storage */ }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const TEAM_COLORS = ['#dc2626', '#eab308'];
const TEAM_HIGHLIGHT = ['#f87171', '#fde047'];

function drawSheet() {
    ctx.fillStyle = '#e8f1f8';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Out-of-play gutters either side of the sheet.
    ctx.fillStyle = '#c3d4e2';
    ctx.fillRect(0, 0, SIDE_LEFT, CANVAS_H);
    ctx.fillRect(SIDE_RIGHT, 0, CANVAS_W - SIDE_RIGHT, CANVAS_H);

    // House.
    const colors = ['#3b82f6', '#f8fafc', '#ef4444', '#f8fafc'];
    for (let i = 0; i < RING_RADII.length; i++) {
        ctx.fillStyle = colors[i];
        ctx.beginPath();
        ctx.arc(BUTTON_X, BUTTON_Y, RING_RADII[i], 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.strokeStyle = '#8fa6bb';
    ctx.lineWidth = 1;

    // Centre line.
    ctx.beginPath();
    ctx.moveTo(BUTTON_X, BACK_LINE);
    ctx.lineTo(BUTTON_X, CANVAS_H);
    ctx.stroke();

    // The hack the delivery is pushed out of.
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(BUTTON_X - 26, RELEASE_Y + 24, 18, 12);
    ctx.fillRect(BUTTON_X + 8, RELEASE_Y + 24, 18, 12);

    // Back line, tee line and hog line.
    for (const [y, w] of [[BACK_LINE, 1], [TEE_LINE, 1], [HOG_LINE, 4]]) {
        ctx.lineWidth = w;
        ctx.strokeStyle = w > 1 ? '#dc2626' : '#8fa6bb';
        ctx.beginPath();
        ctx.moveTo(SIDE_LEFT, y);
        ctx.lineTo(SIDE_RIGHT, y);
        ctx.stroke();
    }
    ctx.lineWidth = 1;
}

function drawStone(s) {
    ctx.fillStyle = '#4b5563';
    ctx.beginPath();
    ctx.arc(s.x, s.y, STONE_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#6b7280';
    ctx.beginPath();
    ctx.arc(s.x, s.y, STONE_R - 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = TEAM_COLORS[s.team];
    ctx.beginPath();
    ctx.arc(s.x, s.y, STONE_R - 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = TEAM_HIGHLIGHT[s.team];
    ctx.beginPath();
    ctx.arc(s.x - 2, s.y - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
}

function drawAimGuide() {
    if (state !== 'aiming' || currentTeam !== 0) return;
    const length = 150;
    const dx = Math.sin(aim.angle) * length;
    const dy = -Math.cos(aim.angle) * length;

    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(RELEASE_X, RELEASE_Y);
    ctx.lineTo(RELEASE_X + dx, RELEASE_Y + dy);
    ctx.stroke();
    ctx.restore();

    // Curl indicator: a short hook off the end of the aim line.
    if (aim.curl) {
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(RELEASE_X + dx, RELEASE_Y + dy);
        ctx.lineTo(RELEASE_X + dx + aim.curl * 26, RELEASE_Y + dy - 8);
        ctx.stroke();
        ctx.lineWidth = 1;
    }

    // The stone waiting in the hack.
    drawStone({ x: RELEASE_X, y: RELEASE_Y, team: 0 });
}

function drawPowerMeter() {
    if (state !== 'aiming' || currentTeam !== 0) return;
    const x = SIDE_RIGHT + 4;
    const y = 420;
    const w = 12;
    const h = 220;

    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(x, y + h * (1 - aim.power), w, h * aim.power);

    // Marker for the weight that draws to the button.
    const drawPower = (Math.sqrt(2 * FRICTION * (RELEASE_Y - BUTTON_Y)) - MIN_SPEED) / POWER_RANGE;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x - 2, y + h * (1 - drawPower) - 1, w + 4, 2);
}

// Ring the stone that is currently counting, so the player can read the end at
// a glance the way a curler reads the shot rock.
function drawShotRock() {
    const house = stonesInHouse();
    if (house.length === 0) return;
    const s = house[0];
    ctx.strokeStyle = TEAM_HIGHLIGHT[s.team];
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, STONE_R + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
}

function draw() {
    drawSheet();
    for (const s of stones) drawStone(s);
    drawShotRock();
    drawAimGuide();
    drawPowerMeter();
}

// ---------------------------------------------------------------------------
// Main loop (real-time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;   // clamp after tab switches / long frames

    step(dt);
    if (autoCpu && state === 'aiming' && currentTeam === 1) {
        cpuTimer -= dt;
        if (cpuTimer <= 0) cpuTakeShot();
    }
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function playerCanAct() {
    return state === 'aiming' && currentTeam === 0;
}

window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'endbreak') startEnd();
        else if (playerCanAct()) startCharge();
        return;
    }
    if (!playerCanAct()) return;

    if (e.key === 'ArrowLeft') { setAim(aim.angle - AIM_STEP); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { setAim(aim.angle + AIM_STEP); e.preventDefault(); }
    else if (e.key === 'a' || e.key === 'A') { setCurl(-1); e.preventDefault(); }
    else if (e.key === 'd' || e.key === 'D') { setCurl(1); e.preventDefault(); }
    else if (e.key === 's' || e.key === 'S') { setCurl(0); e.preventDefault(); }
});

window.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Spacebar') releaseCharge();
});

function pointerAngle(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    return Math.atan2(x - RELEASE_X, Math.max(1, RELEASE_Y - y));
}

canvas.addEventListener('mousemove', (e) => {
    if (!playerCanAct() || charging) return;
    setAim(pointerAngle(e));
});

canvas.addEventListener('mousedown', (e) => {
    if (!playerCanAct()) return;
    setAim(pointerAngle(e));
    startCharge();
});

window.addEventListener('mouseup', () => releaseCharge());

btnStart.addEventListener('click', () => {
    if (state === 'endbreak') startEnd();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

loadRecord();
state = 'idle';
end = 1;
hammer = 1;
currentTeam = 0;
cpuTimer = CPU_DELAY;
resetAim();
updateHud();
requestAnimationFrame(frame);
