// ---------------------------------------------------------------------------
// Curling — a top-down sheet of ice on an HTML5 canvas.
//
// Each end both teams deliver their stones from the hack on the right toward
// the house on the left. A stone is aimed, given weight (how hard it is thrown)
// and a handle (the rotation that makes it curl sideways as it slows), then
// swept to make it run farther and straighter. When both teams are out of
// stones the team lying closest to the button scores one point for every stone
// it has closer than the other team's best.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Sheet geometry ------------------------------------------------------
const CANVAS_W = 760;
const CANVAS_H = 380;

const SIDE_T = 30;                 // side lines: a stone touching one is out
const SIDE_B = 350;
const CENTER_Y = (SIDE_T + SIDE_B) / 2; // 190 — the centre line

const TEE_X = 160;                 // the button
const HOUSE_R = 90;                // the twelve foot ring
const RING_R = [90, 60, 30, 10];
// The back line runs across the back of the twelve foot ring; a stone whose
// centre passes it is out of play.
const BACK_LINE_X = 70;
const HOG_LINE_X = 320;            // a delivery must fully cross this line
const HACK_X = 730;                // where a delivery starts

const STONE_R = 14;

// --- Delivery physics ----------------------------------------------------
// Weight is expressed as the distance the stone would run on unswept ice, so
// the slider reads like a curler's "draw weight" rather than a raw speed.
const FRICTION = 26;               // px/s^2
const MIN_DIST = 400;              // weight 0 — stops short of the hog line
const MAX_DIST = 690;              // weight 100 — through the back line
const DEFAULT_WEIGHT = 59;         // ~ draw to the button
const STOP_SPEED = 4;

const CURL_ACCEL = 8.0;            // sideways pull once the stone is slowing
const CURL_REF_SPEED = 180;        // above this speed a stone barely curls
const SWEEP_FRICTION_MUL = 0.8;    // sweeping ~25% more run
const SWEEP_CURL_MUL = 0.45;       // ...and much less curl
const RESTITUTION = 0.98;

// --- Match ---------------------------------------------------------------
const STONES_PER_TEAM = 6;
const TOTAL_ENDS = 4;
const ENDOVER_TIME = 2.5;

// --- Controls ------------------------------------------------------------
const AIM_MAX = 8;                 // degrees either side of the centre line
const AIM_STEP = 0.4;
const WEIGHT_STEP = 1;

// --- Computer skip -------------------------------------------------------
const AI_THINK = 0.9;
const AI_TAKEOUT_WEIGHT = 96;
const AI_GUARD_WEIGHT = 32;
const AI_AIM_NOISE = 1.5;          // degrees
const AI_WEIGHT_NOISE = 7;

const TEAM_COLOR = { player: '#e0524a', cpu: '#f2c744' };
const TEAM_NAME = { player: 'You', cpu: 'CPU' };

// --- State ---------------------------------------------------------------
let state = 'idle';   // idle | aiming | sliding | endover | over | paused
let prevState = 'aiming';
let stones = [];
let delivered = null;
let end = 1;
let playerScore = 0;
let cpuScore = 0;
let best = 0;
let hammer = 'player';
let turn = 'cpu';
let stonesLeft = { player: STONES_PER_TEAM, cpu: STONES_PER_TEAM };
let lastResult = null;

let aim = 0;
let weight = DEFAULT_WEIGHT;
let handle = 1;       // +1 in-turn (curls down the sheet), -1 out-turn
let playerHandle = 1;
let sweeping = false;
let sweepHeld = false;

let autoAi = true;
let aiNoise = 1;
let aiTimer = AI_THINK;
let aiThrowCount = 0;
let endTimer = 0;
let sparkleT = 0;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const elEnd = document.getElementById('end');
const elYou = document.getElementById('score-you');
const elCpu = document.getElementById('score-cpu');
const elStones = document.getElementById('stones');
const elWeight = document.getElementById('weight');
const elHandle = document.getElementById('handle');
const elBest = document.getElementById('best');

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const other = (team) => (team === 'player' ? 'cpu' : 'player');

// ---------------------------------------------------------------------------
// Stones
// ---------------------------------------------------------------------------

function placeStone(team, x, y, h = 0) {
    const stone = { team, x, y, vx: 0, vy: 0, handle: h, moving: false, rot: 0 };
    stones.push(stone);
    return stone;
}

function clearStones() {
    stones = [];
    delivered = null;
}

function anyMoving() {
    return stones.some((s) => s.moving);
}

function distToButton(stone) {
    return Math.hypot(stone.x - TEE_X, stone.y - CENTER_Y);
}

function inHouse(stone) {
    return distToButton(stone) <= HOUSE_R + STONE_R;
}

// The distance a stone thrown at this weight runs on unswept ice.
function distForWeight(w) {
    return MIN_DIST + (MAX_DIST - MIN_DIST) * (clamp(w, 0, 100) / 100);
}

function speedForWeight(w) {
    return Math.sqrt(2 * FRICTION * distForWeight(w));
}

// Rough sideways drift after running `dist`, used by the computer skip to
// aim off the curl. The sideways pull ramps up as the stone slows, so the
// displacement grows with the cube of elapsed time.
function curlDrift(w, dist) {
    const v = speedForWeight(w);
    const total = v / FRICTION;
    const disc = Math.max(0, v * v - 2 * FRICTION * dist);
    const t = Math.min(total, (v - Math.sqrt(disc)) / FRICTION);
    return (CURL_ACCEL * t * t * t) / (6 * total);
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

function throwStone() {
    if (state !== 'aiming') return null;
    const team = turn;
    if (stonesLeft[team] <= 0) return null;

    const speed = speedForWeight(weight);
    const rad = (aim * Math.PI) / 180;
    const stone = {
        team,
        x: HACK_X,
        y: CENTER_Y,
        vx: -speed * Math.cos(rad),
        vy: speed * Math.sin(rad),
        handle,
        moving: true,
        rot: 0,
    };
    stones.push(stone);
    delivered = stone;
    stonesLeft[team]--;
    state = 'sliding';
    sweeping = false;
    updateHud();
    return stone;
}

function outOfPlay(stone) {
    return (
        stone.x < BACK_LINE_X ||
        stone.y - STONE_R < SIDE_T ||
        stone.y + STONE_R > SIDE_B
    );
}

function removeStone(stone) {
    const i = stones.indexOf(stone);
    if (i >= 0) stones.splice(i, 1);
}

function moveStones(dt) {
    for (const s of stones) {
        if (!s.moving) continue;
        const speed = Math.hypot(s.vx, s.vy);
        if (speed <= STOP_SPEED) {
            s.vx = 0;
            s.vy = 0;
            s.moving = false;
            continue;
        }

        const swept = sweeping && s === delivered;
        const fric = FRICTION * (swept ? SWEEP_FRICTION_MUL : 1);
        const slow = clamp(1 - speed / CURL_REF_SPEED, 0, 1);
        const curl = CURL_ACCEL * s.handle * slow * (swept ? SWEEP_CURL_MUL : 1);

        const ux = s.vx / speed;
        const uy = s.vy / speed;
        // Perpendicular to travel: a positive handle pulls the stone toward +y.
        s.vx += (-fric * ux + curl * uy) * dt;
        s.vy += (-fric * uy - curl * ux) * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.rot += s.handle * speed * 0.004 * dt * 60;
    }
}

function collideStones() {
    for (let i = 0; i < stones.length; i++) {
        for (let j = i + 1; j < stones.length; j++) {
            const a = stones[i];
            const b = stones[j];
            if (!a.moving && !b.moving) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist === 0 || dist >= STONE_R * 2) continue;

            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = STONE_R * 2 - dist;
            a.x -= nx * overlap * 0.5;
            a.y -= ny * overlap * 0.5;
            b.x += nx * overlap * 0.5;
            b.y += ny * overlap * 0.5;

            const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rel >= 0) continue;
            // Equal masses, so the impulse swaps the velocity along the normal.
            const imp = -(1 + RESTITUTION) * rel * 0.5;
            a.vx -= imp * nx;
            a.vy -= imp * ny;
            b.vx += imp * nx;
            b.vy += imp * ny;
            // A struck stone is sliding rather than rotating, so it no longer
            // curls; only the delivery keeps its handle.
            for (const s of [a, b]) {
                if (Math.hypot(s.vx, s.vy) > STOP_SPEED) s.moving = true;
                if (s !== delivered) s.handle = 0;
            }
        }
    }
}

function sweepOut() {
    for (const s of stones.slice()) {
        if (outOfPlay(s)) removeStone(s);
    }
}

function endDelivery() {
    sweeping = false;
    // A delivery that fails to cross the far hog line is taken off the sheet.
    if (delivered && stones.includes(delivered) && delivered.x > HOG_LINE_X) {
        removeStone(delivered);
    }
    delivered = null;

    if (stonesLeft.player <= 0 && stonesLeft.cpu <= 0) {
        finishEnd();
        return;
    }
    // Teams alternate, but a team with no stones left is skipped rather than
    // handed a turn it cannot take.
    turn = stonesLeft[other(turn)] > 0 ? other(turn) : turn;
    state = 'aiming';
    aiTimer = AI_THINK;
    if (turn === 'player') resetPlayerAim();
    updateHud();
}

function resetPlayerAim() {
    aim = 0;
    weight = DEFAULT_WEIGHT;
    handle = playerHandle;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function endResult() {
    const counting = stones
        .filter(inHouse)
        .sort((a, b) => distToButton(a) - distToButton(b));
    if (!counting.length) return { team: null, points: 0 };
    const team = counting[0].team;
    let points = 0;
    for (const s of counting) {
        if (s.team !== team) break;
        points++;
    }
    return { team, points };
}

function finishEnd() {
    const result = endResult();
    lastResult = result;
    if (result.team === 'player') {
        playerScore += result.points;
        hammer = 'cpu';
    } else if (result.team === 'cpu') {
        cpuScore += result.points;
        hammer = 'player';
    }
    state = 'endover';
    endTimer = ENDOVER_TIME;
    updateHud();

    const line =
        result.team === null
            ? 'Blank end — no stones in the house'
            : `${TEAM_NAME[result.team]} score ${result.points}`;
    showOverlay(`END ${end}`, `${playerScore} — ${cpuScore}`, line);
}

function nextEnd() {
    if (end >= TOTAL_ENDS) {
        gameOver();
        return;
    }
    end++;
    clearStones();
    stonesLeft = { player: STONES_PER_TEAM, cpu: STONES_PER_TEAM };
    turn = other(hammer);
    aiTimer = AI_THINK;
    resetPlayerAim();
    state = 'aiming';
    hideOverlay();
    updateHud();
}

function gameOver() {
    state = 'over';
    clearStones();
    if (playerScore > best) {
        best = playerScore;
        try {
            localStorage.setItem('curling-best', String(best));
        } catch (e) {
            /* storage may be unavailable */
        }
    }
    updateHud();
    const title =
        playerScore > cpuScore ? 'YOU WIN' : playerScore < cpuScore ? 'CPU WINS' : 'TIED GAME';
    showOverlay(title, `${playerScore} — ${cpuScore}`, 'Press Space or Enter to play again');
}

// ---------------------------------------------------------------------------
// Computer skip
// ---------------------------------------------------------------------------

function aiThrow() {
    const mine = stones.filter((s) => s.team === 'cpu' && inHouse(s));
    const theirs = stones.filter((s) => s.team === 'player' && inHouse(s));
    const best_ = (list) =>
        list.reduce((a, b) => (a === null || distToButton(b) < distToButton(a) ? b : a), null);
    const bestMine = best_(mine);
    const bestTheirs = best_(theirs);

    let targetX = TEE_X;
    let targetY = CENTER_Y;
    let w = DEFAULT_WEIGHT;

    if (bestTheirs && (!bestMine || distToButton(bestTheirs) < distToButton(bestMine))) {
        // They are lying shot: hit it out.
        targetX = bestTheirs.x;
        targetY = bestTheirs.y;
        w = AI_TAKEOUT_WEIGHT;
    } else if (bestMine && distToButton(bestMine) < HOUSE_R * 0.45) {
        // Already sitting pretty — put up a guard in front of the house.
        targetX = TEE_X + HOUSE_R + 45;
        targetY = CENTER_Y;
        w = AI_GUARD_WEIGHT;
    }

    const h = aiThrowCount % 2 === 0 ? 1 : -1;
    aiThrowCount++;
    w = clamp(w + (Math.random() - 0.5) * AI_WEIGHT_NOISE * aiNoise, 0, 100);

    const run = Math.max(1, HACK_X - targetX);
    const drift = curlDrift(w, run) * h;
    const wanted = targetY - drift - CENTER_Y;
    let a = (Math.atan2(wanted, run) * 180) / Math.PI;
    a += (Math.random() - 0.5) * AI_AIM_NOISE * aiNoise;

    aim = clamp(a, -AIM_MAX, AIM_MAX);
    weight = w;
    handle = h;
    throwStone();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'idle' || state === 'paused' || state === 'over') return;
    sparkleT += dt;

    if (state === 'endover') {
        endTimer -= dt;
        if (endTimer <= 0) nextEnd();
        return;
    }

    if (state === 'aiming') {
        if (autoAi && turn === 'cpu') {
            aiTimer -= dt;
            if (aiTimer <= 0) aiThrow();
        }
        return;
    }

    // state === 'sliding'
    if (sweepHeld) sweeping = true;
    moveStones(dt);
    collideStones();
    sweepOut();
    if (!anyMoving()) endDelivery();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawSheet() {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#dceaf4');
    grad.addColorStop(0.5, '#f2f9fd');
    grad.addColorStop(1, '#dceaf4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Side boards.
    ctx.fillStyle = '#14344a';
    ctx.fillRect(0, 0, CANVAS_W, SIDE_T);
    ctx.fillRect(0, SIDE_B, CANVAS_W, CANVAS_H - SIDE_B);

    // House rings.
    const colors = ['#4a86c8', '#f7fbfe', '#cf4a41', '#f7fbfe'];
    for (let i = 0; i < RING_R.length; i++) {
        ctx.beginPath();
        ctx.arc(TEE_X, CENTER_Y, RING_R[i], 0, Math.PI * 2);
        ctx.fillStyle = colors[i];
        ctx.fill();
    }

    ctx.strokeStyle = '#8aa8bd';
    ctx.lineWidth = 1.5;
    // Centre line.
    ctx.beginPath();
    ctx.moveTo(BACK_LINE_X - 20, CENTER_Y);
    ctx.lineTo(CANVAS_W, CENTER_Y);
    ctx.stroke();
    // Tee line.
    ctx.beginPath();
    ctx.moveTo(TEE_X, SIDE_T);
    ctx.lineTo(TEE_X, SIDE_B);
    ctx.stroke();
    // Back line.
    ctx.beginPath();
    ctx.moveTo(BACK_LINE_X, SIDE_T);
    ctx.lineTo(BACK_LINE_X, SIDE_B);
    ctx.stroke();
    // Hog line — heavier, it is the one that takes stones off.
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(HOG_LINE_X, SIDE_T);
    ctx.lineTo(HOG_LINE_X, SIDE_B);
    ctx.stroke();

    // The hack.
    ctx.fillStyle = '#14344a';
    ctx.fillRect(HACK_X + 8, CENTER_Y - 14, 12, 28);

    ctx.fillStyle = '#8aa8bd';
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HOG LINE', HOG_LINE_X, SIDE_T + 16);
    ctx.fillText('BACK LINE', BACK_LINE_X + 2, SIDE_B - 8);
}

function drawStone(s, dim) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.globalAlpha = dim ? 0.45 : 1;

    ctx.beginPath();
    ctx.arc(2, 3, STONE_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 30, 45, 0.25)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, STONE_R, 0, Math.PI * 2);
    ctx.fillStyle = '#6d7c88';
    ctx.fill();
    ctx.strokeStyle = '#3f4b55';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, STONE_R - 4, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLOR[s.team];
    ctx.fill();

    // The handle on top, which turns with the stone's rotation.
    ctx.rotate(s.rot);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-STONE_R + 5, 0);
    ctx.lineTo(STONE_R - 5, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = '#f7fbfe';
    ctx.fill();
    ctx.restore();
}

// Dotted preview of where the current aim, weight and handle would put the
// stone — the equivalent of the skip's broom on the ice.
function drawAimGuide() {
    const speed = speedForWeight(weight);
    const rad = (aim * Math.PI) / 180;
    const ghost = {
        x: HACK_X,
        y: CENTER_Y,
        vx: -speed * Math.cos(rad),
        vy: speed * Math.sin(rad),
        handle,
    };
    ctx.fillStyle = 'rgba(20, 52, 74, 0.35)';
    for (let i = 0; i < 900; i++) {
        const v = Math.hypot(ghost.vx, ghost.vy);
        if (v <= STOP_SPEED) break;
        const slow = clamp(1 - v / CURL_REF_SPEED, 0, 1);
        const curl = CURL_ACCEL * ghost.handle * slow;
        const ux = ghost.vx / v;
        const uy = ghost.vy / v;
        ghost.vx += (-FRICTION * ux + curl * uy) / 60;
        ghost.vy += (-FRICTION * uy - curl * ux) / 60;
        ghost.x += ghost.vx / 60;
        ghost.y += ghost.vy / 60;
        if (ghost.x < BACK_LINE_X || ghost.y < SIDE_T || ghost.y > SIDE_B) break;
        if (i % 10 === 0) {
            ctx.beginPath();
            ctx.arc(ghost.x, ghost.y, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    // Broom head at the resting point.
    ctx.strokeStyle = 'rgba(20, 52, 74, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ghost.x, ghost.y, STONE_R, 0, Math.PI * 2);
    ctx.stroke();
}

function drawSweepMarks() {
    if (!delivered || !sweeping) return;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
        const off = Math.sin(sparkleT * 26 + i * 2) * 9;
        ctx.beginPath();
        ctx.moveTo(delivered.x - 26 - i * 5, delivered.y - 12 + off);
        ctx.lineTo(delivered.x - 26 - i * 5, delivered.y + 12 + off);
        ctx.stroke();
    }
}

function drawScoreboard() {
    ctx.font = 'bold 13px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#dceaf4';
    ctx.fillText(`END ${end} / ${TOTAL_ENDS}`, 12, 20);

    ctx.textAlign = 'right';
    const label = state === 'sliding' ? TEAM_NAME[delivered ? delivered.team : turn] : TEAM_NAME[turn];
    ctx.fillStyle = TEAM_COLOR[state === 'sliding' && delivered ? delivered.team : turn];
    ctx.fillText(`${label} to throw`, CANVAS_W - 12, 20);

    // Remaining stones for each team, drawn as small counters.
    const row = CANVAS_H - 15;
    for (const team of ['player', 'cpu']) {
        const baseX = team === 'player' ? 12 : CANVAS_W / 2 - 90;
        ctx.fillStyle = TEAM_COLOR[team];
        for (let i = 0; i < stonesLeft[team]; i++) {
            ctx.beginPath();
            ctx.arc(baseX + i * 16, row, 6, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    if (state === 'aiming' && turn === 'player') drawWeightGauge(row);
}

// A gauge under the hack, with a tick at the weight that draws to the button
// and shading over the range that runs out the back of the house.
function drawWeightGauge(row) {
    const x0 = CANVAS_W - 200;
    const w = 180;
    ctx.fillStyle = 'rgba(140, 170, 190, 0.35)';
    ctx.fillRect(x0, row - 5, w, 10);

    const backWeight =
        ((HACK_X - BACK_LINE_X - MIN_DIST) / (MAX_DIST - MIN_DIST)) * 100;
    ctx.fillStyle = 'rgba(224, 82, 74, 0.35)';
    ctx.fillRect(x0 + (backWeight / 100) * w, row - 5, w * (1 - backWeight / 100), 10);

    const drawWeight = ((HACK_X - TEE_X - MIN_DIST) / (MAX_DIST - MIN_DIST)) * 100;
    ctx.fillStyle = '#dceaf4';
    ctx.fillRect(x0 + (drawWeight / 100) * w - 1, row - 9, 2, 18);

    ctx.fillStyle = TEAM_COLOR.player;
    ctx.fillRect(x0, row - 5, (clamp(weight, 0, 100) / 100) * w, 10);

    ctx.fillStyle = '#dceaf4';
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('WEIGHT', x0 - 8, row + 4);
}

function draw() {
    drawSheet();

    if (state === 'aiming' && turn === 'player') drawAimGuide();

    for (const s of stones) drawStone(s, false);
    drawSweepMarks();

    if (state === 'endover' && lastResult && lastResult.team) {
        // Ring the counting stones so the score is easy to read.
        const shot = stones
            .filter(inHouse)
            .sort((a, b) => distToButton(a) - distToButton(b))
            .slice(0, lastResult.points);
        ctx.strokeStyle = '#12384f';
        ctx.lineWidth = 3;
        for (const s of shot) {
            ctx.beginPath();
            ctx.arc(s.x, s.y, STONE_R + 5, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    drawScoreboard();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elEnd.textContent = String(end);
    elYou.textContent = String(playerScore);
    elCpu.textContent = String(cpuScore);
    elStones.textContent = String(stonesLeft.player);
    elWeight.textContent = String(Math.round(weight));
    elHandle.textContent = handle > 0 ? 'In-turn' : handle < 0 ? 'Out-turn' : 'Straight';
    elBest.textContent = String(best);
}

function showOverlay(title, score, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = score;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
    // Between ends the result is a strip across the top, so the counting stones
    // stay in view instead of being hidden behind a full-sheet overlay.
    overlay.classList.toggle('banner', state === 'endover');
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Game';
    btnStart.style.display = state === 'endover' ? 'none' : '';
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function adjustAim(dir) {
    aim = clamp(aim + dir * AIM_STEP, -AIM_MAX, AIM_MAX);
    updateHud();
}

function adjustWeight(dir) {
    weight = clamp(weight + dir * WEIGHT_STEP, 0, 100);
    updateHud();
}

function toggleHandle() {
    handle = handle > 0 ? -1 : 1;
    playerHandle = handle;
    updateHud();
}

function togglePause() {
    if (state === 'paused') {
        state = prevState;
        hideOverlay();
    } else if (state === 'aiming' || state === 'sliding') {
        prevState = state;
        state = 'paused';
        showOverlay('PAUSED', `${playerScore} — ${cpuScore}`, 'Press P to resume');
    }
}

function startGame() {
    clearStones();
    end = 1;
    playerScore = 0;
    cpuScore = 0;
    hammer = 'player';
    turn = other(hammer);
    stonesLeft = { player: STONES_PER_TEAM, cpu: STONES_PER_TEAM };
    lastResult = null;
    aiThrowCount = 0;
    aiTimer = AI_THINK;
    playerHandle = 1;
    resetPlayerAim();
    sweeping = false;
    sweepHeld = false;
    state = 'aiming';
    hideOverlay();
    updateHud();
}

const AIM_KEYS = { ArrowUp: -1, ArrowDown: 1, w: -1, s: 1, W: -1, S: 1 };
const WEIGHT_KEYS = { ArrowLeft: -1, ArrowRight: 1, a: -1, d: 1, A: -1, D: 1 };

document.addEventListener('keydown', (e) => {
    const key = e.key;
    if (
        key === ' ' ||
        key === 'ArrowUp' ||
        key === 'ArrowDown' ||
        key === 'ArrowLeft' ||
        key === 'ArrowRight'
    ) {
        e.preventDefault();
    }

    if (key === 'p' || key === 'P') {
        togglePause();
        return;
    }

    if (state === 'idle' || state === 'over') {
        if (key === ' ' || key === 'Enter') startGame();
        return;
    }
    if (state === 'paused' || state === 'endover') return;

    if (key === ' ') {
        sweepHeld = true;
        if (state === 'aiming' && turn === 'player') throwStone();
        return;
    }

    if (state !== 'aiming' || turn !== 'player') return;

    if (key in AIM_KEYS) adjustAim(AIM_KEYS[key]);
    else if (key in WEIGHT_KEYS) adjustWeight(WEIGHT_KEYS[key]);
    else if (key === 'h' || key === 'H') toggleHandle();
});

document.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
        sweepHeld = false;
        sweeping = false;
    }
});

// Mouse: point where you want the stone to finish, click to deliver.
canvas.addEventListener('mousemove', (e) => {
    if (state !== 'aiming' || turn !== 'player') return;
    const rect = canvas.getBoundingClientRect();
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const run = Math.max(1, HACK_X - x);
    const drift = curlDrift(weight, run) * handle;
    aim = clamp((Math.atan2(y - drift - CENTER_Y, run) * 180) / Math.PI, -AIM_MAX, AIM_MAX);
    updateHud();
});

canvas.addEventListener('mousedown', () => {
    if (state === 'aiming' && turn === 'player') throwStone();
    sweepHeld = true;
});

document.addEventListener('mouseup', () => {
    sweepHeld = false;
    sweeping = false;
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

best = parseInt(localStorage.getItem('curling-best') || '0', 10) || 0;
state = 'idle';
stonesLeft = { player: STONES_PER_TEAM, cpu: STONES_PER_TEAM };
updateHud();
showOverlay('CURLING', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
