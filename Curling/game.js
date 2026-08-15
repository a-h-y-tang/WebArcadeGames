// ---------------------------------------------------------------------------
// Curling — a top-down sheet of ice on an HTML5 canvas.
//
// You and the computer alternate delivering stones from the hack at the bottom
// of the sheet towards the house at the top. A shot is three numbers: the aim
// (how far the line of delivery swings off centre), the weight (how hard the
// stone is thrown) and the handle (which way the stone rotates, which makes it
// curl left or right as it slows). Once the stone is on its way you can sweep
// it: sweeping polishes the ice, so the stone runs further and curls less.
//
// After all eight stones of an end have come to rest the team with the stone
// nearest the button scores one point for every one of its stones closer than
// the opponent's best. Three ends decide the match.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Slime Volley,
// Kaboom and Tetris in this repo. All motion is expressed per second and
// advanced through `step(dt)` in fixed sub-steps, so tests can simulate a whole
// shot deterministically without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Sheet geometry (all in canvas pixels) ---
const CANVAS_W = 520;
const CANVAS_H = 720;
const HOUSE_X = CANVAS_W / 2;       // centre line
const HOUSE_Y = 170;                // the button (tee line)
const HOUSE_R = 84;                 // outer edge of the twelve-foot ring
const RING_RADII = [84, 60, 36, 12];
const BACK_Y = 60;                  // past this and the stone is out the back
const HOG_Y = 560;                  // a stone must finish beyond the hog line
const HACK_Y = 690;                 // where a delivery starts
const STONE_R = 14;

// --- Physics ---
const FRICTION = 110;               // px/s² of drag on a running stone
const SWEEP_FRICTION_MULT = 0.8;    // sweeping polishes the ice...
const CURL_ACCEL = 14;              // px/s² of sideways pull from the handle
const SWEEP_CURL_MULT = 0.15;       // ...and straightens the curl
const SPEED_MIN = 140;              // weight 0% — never reaches the hog line
const SPEED_MAX = 480;              // weight 100% — straight through the back
const STOP_SPEED = 6;               // below this a stone is considered at rest
const RESTITUTION = 0.98;           // stones are hard; collisions barely damp
const SUB_STEP = 1 / 120;           // physics sub-step for stable collisions

// --- Match ---
const STONES_PER_TEAM = 4;
const ENDS = 3;
const AIM_MAX_DEG = 12;
const AIM_STEP = 0.5;
const POWER_STEP = 0.02;
const DEFAULT_POWER = 0.58;         // a dead-weight draw to the button
const AI_DELAY = 1.0;               // seconds the computer takes to line up
const AI_AIM_ERROR = 1.5;           // degrees of error on the rink's line

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreYouEl = document.getElementById('score-you');
const scoreAiEl = document.getElementById('score-ai');
const endNumEl = document.getElementById('end-num');
const endTotalEl = document.getElementById('end-total');
const stonesYouEl = document.getElementById('stones-you');
const stonesAiEl = document.getElementById('stones-ai');
const bestEl = document.getElementById('best');
const aimEl = document.getElementById('aim');
const powerEl = document.getElementById('power');
const spinEl = document.getElementById('spin');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'aiming' | 'sliding' | 'break' | 'over' | 'paused'
let state = 'idle';
let pausedFrom = 'aiming';
let stones = [];
let activeStone = null;
let aimDeg = 0;
let power = DEFAULT_POWER;
let spin = 0;                       // -1 out-turn (curls left), +1 in-turn (right)
let sweeping = false;
let currentTeam = 'you';
let firstThrower = 'you';           // the team without the hammer this end
let thrownCount = { you: 0, ai: 0 };
let endNumber = 1;
let scoreYou = 0;
let scoreAi = 0;
let bestScore = 0;
let lastEndResult = { team: null, points: 0 };
let aiTimer = 0;
const sparks = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const other = (team) => (team === 'you' ? 'ai' : 'you');

function distToButton(stone) {
    return Math.hypot(stone.x - HOUSE_X, stone.y - HOUSE_Y);
}

// A stone counts as being in the house when any part of it overlaps the rings.
function isInHouse(stone) {
    return distToButton(stone) < HOUSE_R + STONE_R;
}

function stonesLeft(team) {
    return STONES_PER_TEAM - thrownCount[team];
}

function allStopped() {
    return stones.every((s) => s.vx === 0 && s.vy === 0);
}

// A small seeded RNG for the computer's shot error. Each match reseeds it (so
// no two matches play out identically) but the seed is a plain global, so a
// test can pin it and replay an end exactly.
let rngState = 0x9e3779b9;

function rng() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const jitter = (amount) => (rng() * 2 - 1) * amount;

// ---------------------------------------------------------------------------
// Shot setup
// ---------------------------------------------------------------------------

function setAim(deg) {
    aimDeg = clamp(deg, -AIM_MAX_DEG, AIM_MAX_DEG);
    updateHud();
}

function setPower(p) {
    power = clamp(p, 0, 1);
    updateHud();
}

function setSpin(s) {
    spin = s < 0 ? -1 : s > 0 ? 1 : 0;
    updateHud();
}

function setSweeping(on) {
    sweeping = state === 'sliding' ? !!on : false;
}

// Deliver the stone for whichever team is up. Ignored unless a delivery is
// actually due, so a stray Space during a slide can't stack two stones.
function throwStone() {
    if (state !== 'aiming') return null;
    if (stonesLeft(currentTeam) <= 0) return null;

    const rad = (aimDeg * Math.PI) / 180;
    const speed = SPEED_MIN + power * (SPEED_MAX - SPEED_MIN);
    const stone = {
        x: HOUSE_X,
        y: HACK_Y,
        vx: Math.sin(rad) * speed,
        vy: -Math.cos(rad) * speed,
        spin,
        team: currentTeam,
    };
    stones.push(stone);
    activeStone = stone;
    thrownCount[currentTeam]++;
    sweeping = false;
    state = 'sliding';
    updateHud();
    return stone;
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

function advanceStones(dt) {
    for (const s of stones) {
        const speed = Math.hypot(s.vx, s.vy);
        if (speed === 0) continue;

        const swept = sweeping && s === activeStone;
        const drag = FRICTION * (swept ? SWEEP_FRICTION_MULT : 1) * dt;
        if (drag >= speed) {
            s.vx = 0;
            s.vy = 0;
            continue;
        }

        // Friction always opposes the direction of travel.
        s.vx -= (s.vx / speed) * drag;
        s.vy -= (s.vy / speed) * drag;

        // The handle pulls the stone sideways: left of the direction of travel
        // for an out-turn, right for an in-turn.
        if (s.spin !== 0) {
            const curl = CURL_ACCEL * (swept ? SWEEP_CURL_MULT : 1) * dt * s.spin;
            const dirX = s.vx / speed;
            const dirY = s.vy / speed;
            s.vx += -dirY * curl;
            s.vy += dirX * curl;
        }

        s.x += s.vx * dt;
        s.y += s.vy * dt;

        if (Math.hypot(s.vx, s.vy) < STOP_SPEED) {
            s.vx = 0;
            s.vy = 0;
        }
    }
}

// Equal-mass collision: swap the velocity components along the line of centres
// and leave the tangential components alone. A struck stone loses its handle.
function resolveCollisions() {
    for (let i = 0; i < stones.length; i++) {
        for (let j = i + 1; j < stones.length; j++) {
            const a = stones[i];
            const b = stones[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist === 0 || dist >= STONE_R * 2) continue;

            const nx = dx / dist;
            const ny = dy / dist;

            // Push the pair apart so they never end up overlapping.
            const overlap = STONE_R * 2 - dist + 0.01;
            a.x -= nx * overlap / 2;
            a.y -= ny * overlap / 2;
            b.x += nx * overlap / 2;
            b.y += ny * overlap / 2;

            const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rel > 0) continue;      // already separating

            const impulse = -rel * RESTITUTION;
            a.vx -= impulse * nx;
            a.vy -= impulse * ny;
            b.vx += impulse * nx;
            b.vy += impulse * ny;
            a.spin = 0;
            b.spin = 0;
            addSparks((a.x + b.x) / 2, (a.y + b.y) / 2);
        }
    }
}

// Stones that run off the side of the sheet or through the back line are out
// of play the moment they get there.
function removeOffSheet() {
    for (let i = stones.length - 1; i >= 0; i--) {
        const s = stones[i];
        if (s.x < STONE_R || s.x > CANVAS_W - STONE_R || s.y < BACK_Y || s.y > CANVAS_H) {
            if (s === activeStone) activeStone = null;
            stones.splice(i, 1);
        }
    }
}

// Once everything is at rest, apply the hog line rule to the delivered stone
// and make sure nothing is left overlapping.
function settleStones() {
    if (activeStone && activeStone.y > HOG_Y) {
        const i = stones.indexOf(activeStone);
        if (i >= 0) stones.splice(i, 1);
    }
    for (let pass = 0; pass < 4; pass++) resolveCollisions();
    for (const s of stones) {
        s.vx = 0;
        s.vy = 0;
    }
    removeOffSheet();
    activeStone = null;
    sweeping = false;
}

// ---------------------------------------------------------------------------
// Turn and end flow
// ---------------------------------------------------------------------------

function onStonesStopped() {
    settleStones();
    if (stonesLeft('you') === 0 && stonesLeft('ai') === 0) {
        closeEnd();
        return;
    }
    currentTeam = stonesLeft(other(currentTeam)) > 0 ? other(currentTeam) : currentTeam;
    beginThrow();
}

function beginThrow() {
    state = 'aiming';
    aimDeg = 0;
    power = DEFAULT_POWER;
    spin = 0;
    sweeping = false;
    aiTimer = AI_DELAY;
    updateHud();
}

// Work out the end without touching the scoreboard: the team lying closest to
// the button scores one for every stone of theirs ahead of the opponent's best.
function scoreEnd() {
    const counters = stones.filter(isInHouse).sort((a, b) => distToButton(a) - distToButton(b));
    if (counters.length === 0) return { team: null, points: 0 };

    const team = counters[0].team;
    let points = 0;
    for (const s of counters) {
        if (s.team !== team) break;
        points++;
    }
    return { team, points };
}

function closeEnd() {
    lastEndResult = scoreEnd();
    if (lastEndResult.team === 'you') scoreYou += lastEndResult.points;
    if (lastEndResult.team === 'ai') scoreAi += lastEndResult.points;

    // The team that scored throws first — and so gives up the hammer — next end.
    if (lastEndResult.team) firstThrower = lastEndResult.team;

    state = 'break';
    updateHud();

    const verdict =
        lastEndResult.team === 'you'
            ? `You score ${lastEndResult.points}`
            : lastEndResult.team === 'ai'
              ? `Rink scores ${lastEndResult.points}`
              : 'Blank end';
    const last = endNumber >= ENDS;
    showOverlay(
        `End ${endNumber} — ${verdict}`,
        `You ${scoreYou} — ${scoreAi} Rink`,
        last ? 'Press Space for the final result' : 'Press Space for the next end',
        last ? 'Final Result' : 'Next End',
    );
}

function nextEnd() {
    if (state !== 'break') return;
    if (endNumber >= ENDS) {
        finishMatch();
        return;
    }
    endNumber++;
    stones = [];
    activeStone = null;
    thrownCount = { you: 0, ai: 0 };
    currentTeam = firstThrower;
    hideOverlay();
    beginThrow();
}

function finishMatch() {
    state = 'over';
    if (scoreYou > bestScore) {
        bestScore = scoreYou;
        try {
            localStorage.setItem('curling-best', String(bestScore));
        } catch (e) {
            /* storage may be unavailable — the match still ends normally */
        }
    }
    updateHud();
    const title = scoreYou > scoreAi ? 'You win!' : scoreYou < scoreAi ? 'You lose' : 'Tied match';
    showOverlay(title, `You ${scoreYou} — ${scoreAi} Rink`, 'Press Space to play again', 'Play Again');
}

function startGame() {
    stones = [];
    activeStone = null;
    thrownCount = { you: 0, ai: 0 };
    endNumber = 1;
    scoreYou = 0;
    scoreAi = 0;
    lastEndResult = { team: null, points: 0 };
    firstThrower = 'you';
    currentTeam = 'you';
    rngState = (Math.random() * 0xffffffff) >>> 0;   // a fresh rink every match
    sparks.length = 0;
    hideOverlay();
    beginThrow();
}

function togglePause() {
    if (state === 'paused') {
        state = pausedFrom;
        hideOverlay();
    } else if (state === 'aiming' || state === 'sliding') {
        pausedFrom = state;
        state = 'paused';
        showOverlay('Paused', `You ${scoreYou} — ${scoreAi} Rink`, 'Press P to resume', 'Resume');
    }
}

// ---------------------------------------------------------------------------
// Computer opponent
// ---------------------------------------------------------------------------

// Two shots make a serviceable rink: knock out the opponent's shot stone when
// they are lying in the house, otherwise draw to the button.
function planAiShot() {
    const counters = stones.filter(isInHouse).sort((a, b) => distToButton(a) - distToButton(b));
    const shot = counters[0];

    // The rink is good but not perfect: every shot carries a little error, so a
    // takeout can catch a guard or slide past, exactly as it would on real ice.
    if (shot && shot.team === 'you') {
        const aim = (Math.atan2(shot.x - HOUSE_X, HACK_Y - shot.y) * 180) / Math.PI;
        return {
            aim: clamp(aim + jitter(AI_AIM_ERROR), -AIM_MAX_DEG, AIM_MAX_DEG),
            power: clamp(0.82 + jitter(0.05), 0, 1),
            spin: 0,
        };
    }

    return {
        aim: clamp(jitter(AI_AIM_ERROR), -AIM_MAX_DEG, AIM_MAX_DEG),
        power: clamp(DEFAULT_POWER + jitter(0.035), 0, 1),
        spin: 0,
    };
}

function aiThrow() {
    const plan = planAiShot();
    setAim(plan.aim);
    setPower(plan.power);
    setSpin(plan.spin);
    return throwStone();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'aiming' && currentTeam === 'ai') {
        aiTimer -= dt;
        if (aiTimer <= 0) aiThrow();
        return;
    }
    if (state !== 'sliding') return;

    let remaining = dt;
    while (remaining > 0) {
        const h = Math.min(SUB_STEP, remaining);
        advanceStones(h);
        resolveCollisions();
        removeOffSheet();
        remaining -= h;
        if (allStopped()) break;
    }
    updateSparks(dt);

    if (allStopped()) onStonesStopped();
}

// Play out whatever is left of the current end. Used by the tests, and by
// nothing in the game itself.
function playEnd() {
    let guard = 0;
    while (state !== 'break' && state !== 'over' && guard < 40) {
        guard++;
        if (state === 'aiming' && currentTeam === 'you') {
            setAim(0);
            setPower(0.5 + (guard % 3) * 0.03);
            throwStone();
        }
        for (let f = 0; f < 3000; f++) {
            if (state !== 'sliding' && !(state === 'aiming' && currentTeam === 'ai')) break;
            step(1 / 60);
        }
    }
    return lastEndResult;
}

// ---------------------------------------------------------------------------
// Sparks (a little ice spray when stones knock together)
// ---------------------------------------------------------------------------

function addSparks(x, y) {
    for (let i = 0; i < 8; i++) {
        const a = rng() * Math.PI * 2;
        const sp = 40 + rng() * 90;
        sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.45 });
    }
}

function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) sparks.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function spinLabel() {
    if (spin > 0) return 'In-turn (right)';
    if (spin < 0) return 'Out-turn (left)';
    return 'Straight';
}

function updateHud() {
    scoreYouEl.textContent = String(scoreYou);
    scoreAiEl.textContent = String(scoreAi);
    endNumEl.textContent = String(endNumber);
    endTotalEl.textContent = String(ENDS);
    stonesYouEl.textContent = String(stonesLeft('you'));
    stonesAiEl.textContent = String(stonesLeft('ai'));
    bestEl.textContent = String(bestScore);
    aimEl.textContent = `${aimDeg.toFixed(1)}°`;
    powerEl.textContent = `${Math.round(power * 100)}%`;
    spinEl.textContent = spinLabel();
}

function showOverlay(title, score, sub, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = score || '';
    overlaySub.textContent = sub || '';
    btnStart.textContent = button || 'Start Match';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const RING_COLORS = ['#2c6fbb', '#f7f9fb', '#c9302c', '#f7f9fb'];
const TEAM_COLORS = { you: '#e03a3a', ai: '#f2b705' };

function drawSheet() {
    ctx.fillStyle = '#eaf6ff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Faint ice grain.
    ctx.strokeStyle = 'rgba(150, 190, 220, 0.18)';
    ctx.lineWidth = 1;
    for (let y = 0; y < CANVAS_H; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(CANVAS_W, y + 0.5);
        ctx.stroke();
    }

    // House rings.
    for (let i = 0; i < RING_RADII.length; i++) {
        ctx.beginPath();
        ctx.arc(HOUSE_X, HOUSE_Y, RING_RADII[i], 0, Math.PI * 2);
        ctx.fillStyle = RING_COLORS[i];
        ctx.fill();
    }

    // Centre line, tee line, back line, hog line.
    ctx.strokeStyle = 'rgba(60, 100, 130, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(HOUSE_X, BACK_Y);
    ctx.lineTo(HOUSE_X, HACK_Y);
    ctx.moveTo(HOUSE_X - HOUSE_R - 20, HOUSE_Y);
    ctx.lineTo(HOUSE_X + HOUSE_R + 20, HOUSE_Y);
    ctx.moveTo(0, BACK_Y);
    ctx.lineTo(CANVAS_W, BACK_Y);
    ctx.stroke();

    ctx.strokeStyle = '#c9302c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, HOG_Y);
    ctx.lineTo(CANVAS_W, HOG_Y);
    ctx.stroke();

    // Labels sit on the right so they stay clear of the weight meter.
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(150, 60, 60, 0.75)';
    ctx.fillText('HOG LINE', CANVAS_W - 10, HOG_Y - 8);
    ctx.fillStyle = 'rgba(60, 100, 130, 0.6)';
    ctx.fillText('BACK LINE', CANVAS_W - 10, BACK_Y - 8);
    ctx.textAlign = 'left';

    // The hack.
    ctx.fillStyle = 'rgba(60, 100, 130, 0.4)';
    ctx.fillRect(HOUSE_X - 16, HACK_Y + 12, 32, 12);
}

// Stones still to come, stacked in the bottom corners.
function drawStoneRacks() {
    for (const team of ['you', 'ai']) {
        const left = team === 'you';
        for (let i = 0; i < stonesLeft(team); i++) {
            const x = left ? 46 : CANVAS_W - 46;
            const y = CANVAS_H - 26 - i * 26;
            ctx.beginPath();
            ctx.arc(x, y, 9, 0, Math.PI * 2);
            ctx.fillStyle = '#b9bec6';
            ctx.fill();
            ctx.strokeStyle = '#5d636c';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = TEAM_COLORS[team];
            ctx.fill();
        }
    }
}

function drawStone(s) {
    ctx.beginPath();
    ctx.arc(s.x, s.y + 3, STONE_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20, 40, 60, 0.22)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(s.x, s.y, STONE_R, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(s.x - 5, s.y - 6, 2, s.x, s.y, STONE_R);
    g.addColorStop(0, '#c6cad2');
    g.addColorStop(1, '#8c8f96');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#4a4f58';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // The handle on top carries the team colour.
    ctx.beginPath();
    ctx.arc(s.x, s.y, STONE_R * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLORS[s.team];
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 30, 30, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

// The guide shows the shot you have dialled in — the line you are throwing on,
// how far the weight carries and which way the handle will pull. It stops short
// of predicting where the stone comes to rest: that is the shot itself.
function drawAimGuide() {
    if (state !== 'aiming' || currentTeam !== 'you') return;
    const rad = (aimDeg * Math.PI) / 180;
    const len = 130 + power * 250;

    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = 'rgba(224, 58, 58, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(HOUSE_X, HACK_Y);
    for (let t = 0; t <= 1.001; t += 0.05) {
        const d = len * t;
        // The handle bends the line late, the way curl builds as a stone slows.
        const bend = spin * 26 * t * t;
        ctx.lineTo(
            HOUSE_X + Math.sin(rad) * d + Math.cos(rad) * bend,
            HACK_Y - Math.cos(rad) * d + Math.sin(rad) * bend,
        );
    }
    ctx.stroke();
    ctx.restore();

    // Weight meter down the left edge, ticked at a dead-weight draw.
    const barX = 16;
    const barY = HACK_Y - 220;
    const barH = 220;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillRect(barX, barY, 14, barH);
    ctx.fillStyle = '#e03a3a';
    ctx.fillRect(barX, HACK_Y - power * barH, 14, power * barH);
    ctx.strokeStyle = 'rgba(60, 100, 130, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(barX, barY, 14, barH);
    ctx.beginPath();
    ctx.moveTo(barX - 5, HACK_Y - DEFAULT_POWER * barH);
    ctx.lineTo(barX + 19, HACK_Y - DEFAULT_POWER * barH);
    ctx.strokeStyle = 'rgba(20, 60, 90, 0.9)';
    ctx.stroke();

    // Ghost stone waiting in the hack.
    drawStone({ x: HOUSE_X, y: HACK_Y, team: 'you' });
}

function drawSweepers() {
    if (!sweeping || !activeStone) return;
    const t = Date.now() / 60;
    for (const side of [-1, 1]) {
        const x = activeStone.x + side * (STONE_R + 12) + Math.sin(t + side) * 4;
        ctx.strokeStyle = 'rgba(20, 60, 90, 0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, activeStone.y - 16);
        ctx.lineTo(x, activeStone.y + 16);
        ctx.stroke();
    }
}

function drawSparks() {
    for (const p of sparks) {
        ctx.globalAlpha = Math.max(0, p.life / 0.45);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
}

function drawShotCallout() {
    const counters = stones.filter(isInHouse).sort((a, b) => distToButton(a) - distToButton(b));
    if (!counters.length) return;
    const s = counters[0];
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, STONE_R + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
}

function draw() {
    drawSheet();
    drawStoneRacks();
    drawAimGuide();
    for (const s of stones) drawStone(s);
    if (state !== 'idle') drawShotCallout();
    drawSweepers();
    drawSparks();
}

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 1 / 30) : 0;
    lastTime = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const aimingForPlayer = () => state === 'aiming' && currentTeam === 'you';

function primaryAction() {
    if (state === 'idle' || state === 'over') startGame();
    else if (state === 'break') nextEnd();
    else if (aimingForPlayer()) throwStone();
    else if (state === 'sliding') setSweeping(true);
}

window.addEventListener('keydown', (e) => {
    switch (e.key) {
        case ' ':
        case 'Spacebar':
            primaryAction();
            e.preventDefault();
            break;
        case 'ArrowLeft':
            if (aimingForPlayer()) setAim(aimDeg - AIM_STEP);
            e.preventDefault();
            break;
        case 'ArrowRight':
            if (aimingForPlayer()) setAim(aimDeg + AIM_STEP);
            e.preventDefault();
            break;
        case 'ArrowUp':
            if (aimingForPlayer()) setPower(power + POWER_STEP);
            e.preventDefault();
            break;
        case 'ArrowDown':
            if (aimingForPlayer()) setPower(power - POWER_STEP);
            e.preventDefault();
            break;
        case 'q':
        case 'Q':
            if (aimingForPlayer()) setSpin(spin === -1 ? 0 : -1);
            break;
        case 'e':
        case 'E':
            if (aimingForPlayer()) setSpin(spin === 1 ? 0 : 1);
            break;
        case 'p':
        case 'P':
            togglePause();
            break;
        case 'r':
        case 'R':
            if (state !== 'idle') startGame();
            break;
        default:
            break;
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Spacebar') setSweeping(false);
});

function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((e.clientX - rect.left) * canvas.width) / rect.width,
        y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
}

canvas.addEventListener('mousemove', (e) => {
    if (!aimingForPlayer()) return;
    const p = canvasPoint(e);
    setAim(((p.x - HOUSE_X) / (CANVAS_W / 2)) * AIM_MAX_DEG);
});

canvas.addEventListener('mousedown', (e) => {
    primaryAction();
    e.preventDefault();
});

window.addEventListener('mouseup', () => setSweeping(false));

btnStart.addEventListener('click', primaryAction);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

bestScore = parseInt(localStorage.getItem('curling-best') || '0', 10) || 0;
updateHud();
showOverlay('CURLING', '', 'Press Space or click Start to play', 'Start Match');
draw();                              // paint the sheet immediately, before the first frame
requestAnimationFrame(frame);
