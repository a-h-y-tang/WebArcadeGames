// ---------------------------------------------------------------------------
// Curling — a four-end match on a single sheet of ice, played against the
// computer.
//
// You deliver four stones per end (alternating with the rival), aiming with a
// broom, choosing a handle that makes the stone curl, and sweeping to carry it
// further and straighter. Whoever finishes an end with the stones nearest the
// button scores.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Slime Volley,
// Kaboom and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)` in fixed sub-steps, so the tests can simulate a
// whole match deterministically without depending on requestAnimationFrame.
// ---------------------------------------------------------------------------

// --- Sheet geometry (px) ---
const CANVAS_W = 900;
const CANVAS_H = 360;
const SIDE_TOP = 12;                // the sheet's side lines
const SIDE_BOTTOM = 348;
const TEE_Y = CANVAS_H / 2;         // the centre line
const HACK_X = 60;                  // stones are delivered from here
const HOG_X = 210;                  // a delivered stone must reach this line
const TEE_X = 700;                  // the button
const BACK_X = 830;                 // past this and the stone is out of play

// --- The house ---
const HOUSE_R = 108;                // 12-foot
const RING_8 = 72;
const RING_4 = 38;
const BUTTON_R = 12;

// --- Stones ---
const STONE_R = 14;
const FRICTION = 62;                // px/s² of deceleration on plain ice
const STOP_SPEED = 4;               // below this a stone is put to rest
const RESTITUTION = 1;              // granite on granite: near enough elastic
const MIN_SPEED = 190;              // launch speed at power 0…
const MAX_SPEED = 420;              // …and at power 1

// --- Curl & sweeping ---
const CURL_ACCEL = 26;              // px/s² sideways at full bite
const CURL_REF = 320;               // a stone at this speed barely curls
const CURL_MIN_FACTOR = 0.05;
const CURL_COMP = 48;               // roughly how far a drawn stone curls
const SWEEP_FRICTION = 0.72;        // sweeping scales friction…
const SWEEP_CURL = 0.35;            // …and curl
const SWEEP_BUDGET = 3;             // seconds of sweeping per delivery

// --- Match ---
const ENDS = 4;
const STONES_PER_END = 4;
const METER_SPEED = 0.75;           // power meter sweeps per second
const RIVAL_DELAY = 0.8;            // seconds before the rival throws
const BANNER_TIME = 2.5;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreP1El = document.getElementById('score-p1');
const scoreP2El = document.getElementById('score-p2');
const endEl = document.getElementById('end');
const stonesP1El = document.getElementById('stones-p1');
const stonesP2El = document.getElementById('stones-p2');
const hammerEl = document.getElementById('hammer');
const linescoreEl = document.getElementById('linescore');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
// phase: 'aim' (your shot) | 'power' (meter swinging) | 'slide' (stones moving)
//        | 'rival' (the computer is about to throw)
let state = 'idle';
let phase = 'aim';
let endNumber = 1;
let turn = 'p1';
let hammer = 'p2';                  // the rival starts with last-stone advantage
let power = 0;
let meterDir = 1;
let sweeping = false;
let sweepLeft = 0;
let rivalTimer = 0;
let banner = '';
let bannerTimer = 0;
let deliveredStone = null;
let nextStoneId = 1;
let wins = 0;

const scoreboard = { p1: 0, p2: 0 };
const stonesLeft = { p1: STONES_PER_END, p2: STONES_PER_END };
const aim = { y: TEE_Y, spin: 0 };
const stones = [];
const endResults = [];
const chips = [];                   // ice spray, purely cosmetic

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A seeded RNG, so a match plays out identically for the same shots — handy
// for the tests and for reproducing a position.
let rngState = 0x9e3779b9;
function seedRng(seed) {
    rngState = seed >>> 0;
}
function rng() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const jitter = (m) => (rng() * 2 - 1) * m;

// ---------------------------------------------------------------------------
// Stones
// ---------------------------------------------------------------------------

function addStone(team, x, y, spin) {
    const stone = { id: nextStoneId++, team, x, y, vx: 0, vy: 0, spin: spin || 0 };
    stones.push(stone);
    return stone;
}

function clearStones() {
    stones.length = 0;
    deliveredStone = null;
}

function distanceToButton(stone) {
    return Math.hypot(stone.x - TEE_X, stone.y - TEE_Y);
}

// A stone counts if any part of it touches the outer ring.
function inHouse(stone) {
    return distanceToButton(stone) <= HOUSE_R + STONE_R;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

function aimBy(dy) {
    aim.y = clamp(aim.y + dy, SIDE_TOP, SIDE_BOTTOM);
}

function setHandle(spin) {
    aim.spin = spin;
}

function armPower() {
    if (phase !== 'aim') return;
    phase = 'power';
    power = 0;
    meterDir = 1;
}

// The line the broom sits on at the tee line if the stone is to run over
// (x, y) on a straight path from the hack.
function aimAt(x, y) {
    const run = x - HACK_X;
    if (Math.abs(run) < 1) return y;
    return TEE_Y + (y - TEE_Y) * ((TEE_X - HACK_X) / run);
}

// `power` is 0…1, `aimY` is where the broom sits on the tee line and `spin` is
// the handle (-1, 0 or +1). Returns the delivered stone.
function throwStone(p, aimY, spin) {
    const pw = clamp(p, 0, 1);
    const speed = MIN_SPEED + pw * (MAX_SPEED - MIN_SPEED);
    const targetY = clamp(aimY === undefined ? aim.y : aimY, SIDE_TOP, SIDE_BOTTOM);
    const dx = TEE_X - HACK_X;
    const dy = targetY - TEE_Y;
    const len = Math.hypot(dx, dy);

    const stone = addStone(turn, HACK_X, TEE_Y, spin === undefined ? aim.spin : spin);
    stone.vx = (dx / len) * speed;
    stone.vy = (dy / len) * speed;

    deliveredStone = stone;
    sweepLeft = SWEEP_BUDGET;
    sweeping = false;
    phase = 'slide';
    return stone;
}

function setSweeping(on) {
    sweeping = !!on && phase === 'slide' && sweepLeft > 0;
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

// Friction against the direction of travel, plus a sideways curl acceleration
// that bites harder the slower the stone runs — which is what makes a real
// stone bend late in its journey.
function moveStones(h) {
    const fr = FRICTION * (sweeping ? SWEEP_FRICTION : 1);
    for (const s of stones) {
        const speed = Math.hypot(s.vx, s.vy);
        if (speed === 0) continue;
        if (speed < STOP_SPEED) {
            s.vx = 0;
            s.vy = 0;
            continue;
        }
        const ux = s.vx / speed;
        const uy = s.vy / speed;
        const slowed = Math.max(0, speed - fr * h);

        const bite = clamp(1 - speed / CURL_REF, CURL_MIN_FACTOR, 1);
        const side = s.spin * CURL_ACCEL * bite * (sweeping ? SWEEP_CURL : 1) * h;

        s.vx = ux * slowed - uy * side;
        s.vy = uy * slowed + ux * side;
        s.x += s.vx * h;
        s.y += s.vy * h;
    }
}

// Equal-mass, near-elastic circle collisions: separate the overlap along the
// contact normal, then swap the normal components of the two velocities and
// leave the tangential ones alone.
function resolveCollisions() {
    const min = STONE_R * 2;
    for (let i = 0; i < stones.length; i++) {
        for (let j = i + 1; j < stones.length; j++) {
            const a = stones[i];
            const b = stones[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let dist = Math.hypot(dx, dy);
            if (dist >= min) continue;
            if (dist < 1e-6) { dx = 1; dy = 0; dist = 1e-6; }

            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = (min - dist) / 2;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;

            const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
            if (approach <= 0) continue;
            const imp = approach * RESTITUTION;
            a.vx -= imp * nx;
            a.vy -= imp * ny;
            b.vx += imp * nx;
            b.vy += imp * ny;
            if (approach > 40) spawnChips((a.x + b.x) / 2, (a.y + b.y) / 2);
        }
    }
}

// Past the back line or touching a side line and the stone leaves the game.
// The hog-line rule is handled once the shot comes to rest, in `finishShot`,
// because a stone knocked back over the hog line stays in play.
function removeOutOfPlay() {
    for (let i = stones.length - 1; i >= 0; i--) {
        const s = stones[i];
        const out = s.x > BACK_X
            || s.x < -STONE_R
            || s.y - STONE_R <= SIDE_TOP
            || s.y + STONE_R >= SIDE_BOTTOM;
        if (!out) continue;
        spawnChips(s.x, s.y);
        s.vx = 0;
        s.vy = 0;
        stones.splice(i, 1);
        if (s === deliveredStone) deliveredStone = null;
    }
}

const atRest = () => stones.every((s) => s.vx === 0 && s.vy === 0);

function substep(h) {
    if (bannerTimer > 0) bannerTimer = Math.max(0, bannerTimer - h);

    if (phase === 'power') {
        power += meterDir * METER_SPEED * h;
        if (power >= 1) { power = 1; meterDir = -1; }
        if (power <= 0) { power = 0; meterDir = 1; }
        return;
    }

    if (phase === 'rival') {
        rivalTimer -= h;
        if (rivalTimer <= 0) rivalShot();
        return;
    }

    if (phase !== 'slide') return;

    if (sweeping) {
        sweepLeft = Math.max(0, sweepLeft - h);
        if (sweepLeft === 0) sweeping = false;
    }

    moveStones(h);
    resolveCollisions();
    removeOutOfPlay();
    if (atRest()) finishShot();
}

// Advance the simulation by `dt` seconds in small fixed sub-steps, so a fast
// stone can never tunnel through another one and the result does not depend on
// the frame rate.
function step(dt) {
    if (state !== 'running') return;
    const SUB = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-6) {
        const h = Math.min(SUB, remaining);
        substep(h);
        remaining -= h;
        if (state !== 'running') break;
    }
    updateHud();
}

// Run the simulation on until the stones stop. Used by the tests, and by
// nothing in the game itself.
function settle(maxSeconds) {
    const limit = maxSeconds || 40;
    let t = 0;
    while (t < limit && phase === 'slide') {
        step(1 / 120);
        t += 1 / 120;
    }
}

// ---------------------------------------------------------------------------
// Shot, end and match flow
// ---------------------------------------------------------------------------

function finishShot() {
    sweeping = false;
    sweepLeft = 0;

    const thrower = deliveredStone ? deliveredStone.team : turn;
    if (deliveredStone) {
        // A delivered stone that never reached the hog line is taken off.
        const idx = stones.indexOf(deliveredStone);
        if (idx >= 0 && deliveredStone.x < HOG_X) stones.splice(idx, 1);
    }
    deliveredStone = null;
    if (stonesLeft[thrower] > 0) stonesLeft[thrower] -= 1;

    if (stonesLeft.p1 === 0 && stonesLeft.p2 === 0) {
        finishEnd();
        return;
    }
    turn = thrower === 'p1' ? 'p2' : 'p1';
    beginShot();
}

function beginShot() {
    if (turn === 'p2') {
        phase = 'rival';
        rivalTimer = RIVAL_DELAY;
    } else {
        phase = 'aim';
        aim.y = TEE_Y;
        aim.spin = 0;
    }
    updateHud();
}

// Who scores, and how many: the side owning the stone closest to the button
// takes a point for every stone of theirs that is closer than the opponent's
// best. An empty house is a blank end.
function computeEndScore() {
    const counting = stones.filter(inHouse).sort((a, b) => distanceToButton(a) - distanceToButton(b));
    if (!counting.length) return { team: null, points: 0 };

    const team = counting[0].team;
    const rivalBest = counting.find((s) => s.team !== team);
    const limit = rivalBest ? distanceToButton(rivalBest) : Infinity;
    const points = counting.filter((s) => s.team === team && distanceToButton(s) < limit).length;
    return { team, points };
}

function finishEnd() {
    const result = computeEndScore();
    if (result.team) {
        scoreboard[result.team] += result.points;
        // Scoring costs you the hammer; a blank end leaves it where it was.
        hammer = result.team === 'p1' ? 'p2' : 'p1';
    }
    endResults.push({ end: endNumber, team: result.team, points: result.points });
    banner = result.team
        ? (result.team === 'p1' ? 'You score ' : 'Rival scores ') + result.points
        : 'Blank end';
    bannerTimer = BANNER_TIME;
    renderLinescore();

    if (endNumber >= ENDS) {
        endGame();
        return;
    }
    endNumber += 1;
    startEnd();
}

// The side without the hammer opens the end.
function startEnd() {
    clearStones();
    stonesLeft.p1 = STONES_PER_END;
    stonesLeft.p2 = STONES_PER_END;
    sweeping = false;
    sweepLeft = 0;
    power = 0;
    turn = hammer === 'p1' ? 'p2' : 'p1';
    beginShot();
}

function startGame() {
    state = 'running';
    scoreboard.p1 = 0;
    scoreboard.p2 = 0;
    endNumber = 1;
    hammer = 'p2';
    endResults.length = 0;
    chips.length = 0;
    banner = '';
    bannerTimer = 0;
    aim.y = TEE_Y;
    aim.spin = 0;
    seedRng(0x51ce1ce5);
    renderLinescore();
    startEnd();
    hideOverlay();
    updateHud();
}

function endGame() {
    state = 'over';
    let title;
    if (scoreboard.p1 > scoreboard.p2) {
        title = 'You Win!';
        saveWins(wins + 1);
    } else if (scoreboard.p2 > scoreboard.p1) {
        title = 'Rival Wins';
    } else {
        title = 'Tied Match';
    }
    showOverlay(title, scoreboard.p1 + ' – ' + scoreboard.p2, 'Press Space to play again', 'Play Again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        sweeping = false;
        showOverlay('Paused', scoreboard.p1 + ' – ' + scoreboard.p2, 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function saveWins(value) {
    wins = value;
    try { localStorage.setItem('curling-wins', String(wins)); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// The rival
// ---------------------------------------------------------------------------

// The launch speed that would bring a stone to rest at `x`, as a 0…1 power.
function powerFor(x) {
    const speed = Math.sqrt(Math.max(0, 2 * FRICTION * (x - HACK_X)));
    return clamp((speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0, 1);
}

// Take out the player's shot stone when there is one to hit, otherwise draw to
// the button — or, early in an end with a clean house, put up a guard.
function planRivalShot() {
    const counting = stones.filter(inHouse).sort((a, b) => distanceToButton(a) - distanceToButton(b));
    const shot = counting[0];
    const spin = rng() < 0.5 ? -1 : 1;

    if (shot && shot.team === 'p1' && rng() < 0.8) {
        return {
            power: clamp(powerFor(shot.x + 190) + jitter(0.04), 0, 1),
            aimY: aimAt(shot.x, shot.y + jitter(7)),
            spin: 0,
        };
    }

    if (!counting.length && stonesLeft.p2 > 2 && rng() < 0.35) {
        // A guard short of the house, on or near the centre line.
        return {
            power: clamp(powerFor(HOG_X + 240) + jitter(0.03), 0, 1),
            aimY: clamp(TEE_Y - spin * CURL_COMP * 0.6 + jitter(14), SIDE_TOP + 30, SIDE_BOTTOM - 30),
            spin,
        };
    }

    return {
        power: clamp(powerFor(TEE_X + jitter(14)) + jitter(0.022), 0, 1),
        aimY: clamp(TEE_Y - spin * CURL_COMP + jitter(12), SIDE_TOP + 30, SIDE_BOTTOM - 30),
        spin,
    };
}

function rivalShot() {
    if (state !== 'running') return;
    const shot = planRivalShot();
    aim.y = shot.aimY;
    aim.spin = shot.spin;
    throwStone(shot.power, shot.aimY, shot.spin);
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreP1El.textContent = String(scoreboard.p1);
    scoreP2El.textContent = String(scoreboard.p2);
    endEl.textContent = String(endNumber);
    stonesP1El.textContent = String(stonesLeft.p1);
    stonesP2El.textContent = String(stonesLeft.p2);
    hammerEl.textContent = hammer === 'p1' ? 'You' : 'Rival';
}

function renderLinescore() {
    if (!endResults.length) {
        linescoreEl.textContent = '—';
        return;
    }
    linescoreEl.textContent = endResults
        .map((r) => 'E' + r.end + ' ' + (r.team ? (r.team === 'p1' ? 'You ' : 'Rival ') + r.points : 'Blank'))
        .join('  ·  ');
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
// Ice spray (purely cosmetic)
// ---------------------------------------------------------------------------

function spawnChips(x, y) {
    for (let i = 0; i < 6; i++) {
        chips.push({
            x, y,
            vx: (rng() - 0.5) * 150,
            vy: (rng() - 0.5) * 150,
            life: 0.4,
        });
    }
}

function updateChips(dt) {
    for (let i = chips.length - 1; i >= 0; i--) {
        const c = chips[i];
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.life -= dt;
        if (c.life <= 0) chips.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Fixed pebble marks, so the ice texture never flickers between frames.
const PEBBLES = (() => {
    const saved = rngState;
    seedRng(0xbeef);
    const dots = [];
    for (let i = 0; i < 220; i++) {
        dots.push([rng() * CANVAS_W, SIDE_TOP + rng() * (SIDE_BOTTOM - SIDE_TOP), 0.6 + rng() * 1.1]);
    }
    rngState = saved;
    return dots;
})();

function drawSheet() {
    ctx.fillStyle = '#0a1526';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const ice = ctx.createLinearGradient(0, SIDE_TOP, 0, SIDE_BOTTOM);
    ice.addColorStop(0, '#dbe9f6');
    ice.addColorStop(0.5, '#f2f8ff');
    ice.addColorStop(1, '#d3e3f3');
    ctx.fillStyle = ice;
    ctx.fillRect(0, SIDE_TOP, CANVAS_W, SIDE_BOTTOM - SIDE_TOP);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    for (const [px, py, pr] of PEBBLES) {
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
    }

    // House rings.
    const rings = [[HOUSE_R, '#4b8fd8'], [RING_8, '#f4f9ff'], [RING_4, '#d94b4b'], [BUTTON_R, '#f4f9ff']];
    for (const [r, colour] of rings) {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(TEE_X, TEE_Y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Centre line, tee line, hog line, back line.
    ctx.strokeStyle = 'rgba(30, 60, 95, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, TEE_Y);
    ctx.lineTo(BACK_X, TEE_Y);
    ctx.moveTo(TEE_X, TEE_Y - HOUSE_R);
    ctx.lineTo(TEE_X, TEE_Y + HOUSE_R);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(190, 40, 40, 0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(HOG_X, SIDE_TOP);
    ctx.lineTo(HOG_X, SIDE_BOTTOM);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(30, 60, 95, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(BACK_X, SIDE_TOP);
    ctx.lineTo(BACK_X, SIDE_BOTTOM);
    ctx.stroke();

    // Side lines.
    ctx.strokeStyle = 'rgba(30, 60, 95, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, SIDE_TOP);
    ctx.lineTo(CANVAS_W, SIDE_TOP);
    ctx.moveTo(0, SIDE_BOTTOM);
    ctx.lineTo(CANVAS_W, SIDE_BOTTOM);
    ctx.stroke();

    // The hack.
    ctx.fillStyle = 'rgba(40, 70, 110, 0.5)';
    ctx.fillRect(HACK_X - 16, TEE_Y - 9, 12, 18);

    ctx.fillStyle = 'rgba(30, 60, 95, 0.55)';
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HOG LINE', HOG_X, SIDE_TOP + 16);
    ctx.fillText('BACK', BACK_X, SIDE_TOP + 16);
    ctx.textAlign = 'left';
}

function drawStone(s) {
    // Shadow.
    ctx.fillStyle = 'rgba(20, 45, 80, 0.18)';
    ctx.beginPath();
    ctx.ellipse(s.x + 2, s.y + 4, STONE_R, STONE_R * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Granite.
    const granite = ctx.createRadialGradient(s.x - 5, s.y - 6, 2, s.x, s.y, STONE_R);
    granite.addColorStop(0, '#7b8798');
    granite.addColorStop(1, '#39414f');
    ctx.fillStyle = granite;
    ctx.beginPath();
    ctx.arc(s.x, s.y, STONE_R, 0, Math.PI * 2);
    ctx.fill();

    // Handle, in the team colour.
    ctx.fillStyle = s.team === 'p1' ? '#58c4ff' : '#ff6b6b';
    ctx.beginPath();
    ctx.arc(s.x, s.y, STONE_R * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(s.x - 2, s.y - 3, STONE_R * 0.2, 0, Math.PI * 2);
    ctx.fill();
}

function drawAimLine() {
    ctx.save();
    ctx.setLineDash([7, 7]);
    ctx.strokeStyle = 'rgba(30, 90, 150, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(HACK_X, TEE_Y);
    ctx.lineTo(BACK_X, TEE_Y + (aim.y - TEE_Y) * ((BACK_X - HACK_X) / (TEE_X - HACK_X)));
    ctx.stroke();
    ctx.restore();

    // The broom, standing where the shot is called.
    ctx.strokeStyle = '#1f6feb';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(TEE_X, aim.y - 14);
    ctx.lineTo(TEE_X, aim.y + 14);
    ctx.stroke();
    ctx.fillStyle = '#facc15';
    ctx.fillRect(TEE_X - 5, aim.y - 18, 10, 6);

    // Which way the handle will take the stone.
    if (aim.spin !== 0) {
        const y = aim.y + aim.spin * 30;
        ctx.strokeStyle = 'rgba(31, 111, 235, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(TEE_X - 26, aim.y);
        ctx.quadraticCurveTo(TEE_X - 8, y, TEE_X + 14, y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(31, 111, 235, 0.85)';
        ctx.beginPath();
        ctx.moveTo(TEE_X + 20, y);
        ctx.lineTo(TEE_X + 10, y - 5);
        ctx.lineTo(TEE_X + 10, y + 5);
        ctx.closePath();
        ctx.fill();
    }
}

// A labelled meter on a dark panel, so it stays readable over the white ice.
function drawBar(x, y, w, h, value, colour, label) {
    ctx.fillStyle = 'rgba(8, 18, 34, 0.88)';
    ctx.fillRect(x - 10, y - 26, w + 20, h + 36);
    ctx.fillStyle = '#cfdcec';
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y - 12);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, w * clamp(value, 0, 1), h);
}

// The little rack of stones each side has left to throw.
function drawStoneRack() {
    const rows = [['p2', SIDE_TOP + 18, '#ff6b6b'], ['p1', SIDE_BOTTOM - 18, '#58c4ff']];
    for (const [team, y, colour] of rows) {
        for (let i = 0; i < STONES_PER_END; i++) {
            const x = 24 + i * 22;
            const used = i >= stonesLeft[team];
            ctx.fillStyle = used ? 'rgba(120, 140, 165, 0.28)' : 'rgba(57, 65, 79, 0.85)';
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.fill();
            if (used) continue;
            ctx.fillStyle = colour;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// How many stones the leading side is currently sitting — the "you lie 2" a
// commentator would call.
function lieText() {
    const result = computeEndScore();
    if (!result.team) return 'no stones counting';
    return (result.team === 'p1' ? 'you lie ' : 'rival lies ') + result.points;
}

// Two brooms scrubbing just ahead of the running stone.
function drawSweepers(s) {
    if (Math.hypot(s.vx, s.vy) === 0) return;
    const scrub = Math.sin(animTime * 22) * 3;
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
    ctx.lineWidth = 3;
    for (const side of [-1, 1]) {
        const y = s.y + side * (STONE_R + 8) + scrub * side;
        ctx.beginPath();
        ctx.moveTo(s.x + 8, y);
        ctx.lineTo(s.x + 26, y);
        ctx.stroke();
    }
}

function draw() {
    drawSheet();

    if (state === 'running' && (phase === 'aim' || phase === 'power')) drawAimLine();
    if (state === 'running') drawStoneRack();

    for (const s of stones) drawStone(s);

    for (const c of chips) {
        ctx.globalAlpha = Math.max(0, c.life * 2.4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(c.x - 2, c.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    if (state === 'running' && phase === 'slide' && sweeping && deliveredStone) drawSweepers(deliveredStone);

    // Meters.
    if (state === 'running' && phase === 'power') {
        drawBar(150, SIDE_BOTTOM - 34, 250, 12, power, '#facc15', 'POWER — press Space to throw');
    }
    if (state === 'running' && phase === 'slide') {
        drawBar(150, SIDE_BOTTOM - 34, 200, 10, sweepLeft / SWEEP_BUDGET, '#58c4ff', 'SWEEP — hold Space');
    }

    // Whose shot it is, and who is lying what.
    if (state === 'running') {
        const who = phase === 'rival' ? 'Rival is throwing…'
            : phase === 'slide' ? 'Stone in play'
                : 'Your shot';
        const line = 'End ' + endNumber + ' of ' + ENDS + ' — ' + who + ' — ' + lieText();
        ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'right';
        const w = ctx.measureText(line).width;
        ctx.fillStyle = 'rgba(8, 18, 34, 0.88)';
        ctx.fillRect(CANVAS_W - 22 - w, SIDE_BOTTOM - 30, w + 16, 22);
        ctx.fillStyle = '#e8eff9';
        ctx.fillText(line, CANVAS_W - 14, SIDE_BOTTOM - 14);
        ctx.textAlign = 'left';
    }

    // End result banner.
    if (bannerTimer > 0 && banner) {
        ctx.globalAlpha = Math.min(1, bannerTimer);
        ctx.fillStyle = 'rgba(10, 21, 38, 0.85)';
        ctx.fillRect(CANVAS_W / 2 - 120, TEE_Y - 26, 240, 46);
        ctx.fillStyle = '#f4f9ff';
        ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(banner, CANVAS_W / 2, TEE_Y + 5);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
    }
}

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
let animTime = 0;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    animTime += dt;
    if (state === 'running') step(dt);
    updateChips(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

// Space is the whole delivery: arm the meter, throw, then sweep.
function primaryPress() {
    if (state === 'idle' || state === 'over') { startGame(); return; }
    if (state === 'paused') { togglePause(); return; }
    if (phase === 'aim') armPower();
    else if (phase === 'power') throwStone(power, aim.y, aim.spin);
    else if (phase === 'slide') setSweeping(true);
}

window.addEventListener('keydown', (e) => {
    if (e.repeat && e.key !== ' ') return;
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (!e.repeat) primaryPress();
        else if (state === 'running' && phase === 'slide') setSweeping(true);
        e.preventDefault();
        return;
    }
    if (state !== 'running' || phase !== 'aim') return;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { aimBy(-8); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { aimBy(8); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { setHandle(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { setHandle(1); e.preventDefault(); }
});

window.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Spacebar') setSweeping(false);
});

canvas.addEventListener('mousemove', (e) => {
    if (state !== 'running' || phase !== 'aim') return;
    const rect = canvas.getBoundingClientRect();
    aim.y = clamp((e.clientY - rect.top) * (CANVAS_H / rect.height), SIDE_TOP, SIDE_BOTTOM);
});

canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    primaryPress();
});

window.addEventListener('mouseup', () => setSweeping(false));

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

wins = parseInt(localStorage.getItem('curling-wins') || '0', 10) || 0;
updateHud();
renderLinescore();
requestAnimationFrame(frame);
