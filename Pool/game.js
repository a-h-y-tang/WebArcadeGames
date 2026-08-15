// ---------------------------------------------------------------------------
// 8-Ball Pool
//
// Everything lives in the top-level script scope so the Playwright suite can
// reach the simulation directly (`step`, `shoot`, `balls`, `state`, ...) — the
// same convention the other games in this repo use.
// ---------------------------------------------------------------------------

const CANVAS_W = 880;
const CANVAS_H = 480;
const RAIL = 40;

const PLAY_L = RAIL;
const PLAY_T = RAIL;
const PLAY_R = CANVAS_W - RAIL;
const PLAY_B = CANVAS_H - RAIL;

const BALL_R = 11;
const POCKET_R = 21;

const POCKETS = [
    { x: PLAY_L, y: PLAY_T },
    { x: (PLAY_L + PLAY_R) / 2, y: PLAY_T },
    { x: PLAY_R, y: PLAY_T },
    { x: PLAY_L, y: PLAY_B },
    { x: (PLAY_L + PLAY_R) / 2, y: PLAY_B },
    { x: PLAY_R, y: PLAY_B },
];

const HEAD_X = PLAY_L + (PLAY_R - PLAY_L) * 0.25;
const FOOT_X = PLAY_L + (PLAY_R - PLAY_L) * 0.75;
const MID_Y = (PLAY_T + PLAY_B) / 2;

const FRICTION = 150;          // px/s^2, constant rolling deceleration
const STOP_SPEED = 5;          // px/s below which a ball is parked
const CUSHION_RESTITUTION = 0.92;
const BALL_RESTITUTION = 0.99;
const SUB_DT = 1 / 240;
const MAX_STEP_DIST = 3;       // px a ball may travel in one substep

const MIN_SHOT_SPEED = 250;
const MAX_SHOT_SPEED = 1900;
const CHARGE_TIME = 0.9;       // seconds to fill the power meter
const AIM_STEP = 0.6 * Math.PI / 180;

const AI_PLAYER = 2;
const AI_THINK = 0.7;          // seconds the computer "thinks" before shooting
let AI_ERROR = 0.028;          // radians of aim error, scaled by shot difficulty

const BALL_COLORS = {
    1: '#f2c53d', 2: '#2f6fd0', 3: '#d8382f', 4: '#7b3fa0', 5: '#e2762c',
    6: '#1f9e5a', 7: '#8d3b2f', 8: '#151515',
    9: '#f2c53d', 10: '#2f6fd0', 11: '#d8382f', 12: '#7b3fa0', 13: '#e2762c',
    14: '#1f9e5a', 15: '#8d3b2f',
};

// Fixed rack: apex ball first, the 8 in the middle of the third row, a solid
// and a stripe in the two back corners. No shuffling, so every game is
// reproducible.
const RACK_ROWS = [
    [1],
    [9, 2],
    [10, 8, 3],
    [11, 12, 4, 14],
    [15, 6, 13, 7, 5],
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let balls = [];
let state = 'idle';            // idle | aiming | rolling | ballinhand | paused | gameover
let stateBeforePause = 'aiming';
let currentPlayer = 1;
let groups = { 1: null, 2: null };
let winner = null;
let shotInfo = newShotInfo();
let lastShot = newShotInfo();
let message = '';

let aimAngle = 0;
let power = 0;
let charging = false;
let pointer = { x: FOOT_X, y: MID_Y };

let aiEnabled = true;
let aiTimer = AI_THINK;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnMode = document.getElementById('btn-mode');
const powerFill = document.getElementById('power-fill');
const elTurn = document.getElementById('turn');
const elP1Group = document.getElementById('p1-group');
const elP2Group = document.getElementById('p2-group');
const elP1Left = document.getElementById('p1-left');
const elP2Left = document.getElementById('p2-left');
const elMessage = document.getElementById('message');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newShotInfo() {
    return { firstContact: null, potted: [], cuePotted: false, foul: false, clearedAtStart: false };
}

function ballType(n) {
    if (n === 0) return 'cue';
    if (n === 8) return 'eight';
    return n < 8 ? 'solid' : 'stripe';
}

function ballByNumber(n) {
    return balls.find((b) => b.n === n);
}

function other(player) {
    return player === 1 ? 2 : 1;
}

function playerName(player) {
    return player === AI_PLAYER && aiEnabled ? 'Computer' : 'Player ' + player;
}

function groupRemaining(group) {
    if (!group) return null;
    return balls.filter((b) => b.type === group && !b.potted).length;
}

function groupLabel(group) {
    if (group === 'solid') return 'Solids';
    if (group === 'stripe') return 'Stripes';
    return '—';
}

function ballsMoving() {
    return balls.some((b) => !b.potted && (b.vx !== 0 || b.vy !== 0));
}

function isAiTurn() {
    return aiEnabled && currentPlayer === AI_PLAYER;
}

/** Distance from point (px, py) to the segment (x1,y1)-(x2,y2). */
function pointSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

// ---------------------------------------------------------------------------
// Table setup
// ---------------------------------------------------------------------------

function rackBalls() {
    balls = [{ n: 0, x: HEAD_X, y: MID_Y, vx: 0, vy: 0, potted: false, type: 'cue', color: '#f6f3ea' }];

    // A real rack is never perfectly symmetric, and a perfectly symmetric one
    // barely scatters on a centre-ball break. Nudge each ball by a fixed
    // fraction of a pixel — deterministic, so every game still racks the same.
    const gap = BALL_R * 2 + 1.4;
    const rowDx = 19.6;
    RACK_ROWS.forEach((row, i) => {
        row.forEach((n, j) => {
            balls.push({
                n,
                x: FOOT_X + i * rowDx,
                y: MID_Y + (j - i / 2) * gap + (((n * 37) % 7) - 3) / 10,
                vx: 0,
                vy: 0,
                potted: false,
                type: ballType(n),
                color: BALL_COLORS[n],
            });
        });
    });
}

function startGame() {
    rackBalls();
    state = 'aiming';
    currentPlayer = 1;
    groups = { 1: null, 2: null };
    winner = null;
    shotInfo = newShotInfo();
    lastShot = newShotInfo();
    power = 0;
    charging = false;
    aimAngle = 0;
    aiTimer = AI_THINK;
    message = 'Break to begin — the table is open.';
    overlay.classList.remove('visible');
    updateHud();
    return true;
}

function endGame(w) {
    winner = w;
    state = 'gameover';
    charging = false;
    power = 0;
    message = playerName(w) + ' wins!';
    overlayTitle.textContent = playerName(w).toUpperCase() + ' WINS';
    overlayScore.textContent = w === 1 ? 'The 8-ball is down.' : 'Better luck on the next rack.';
    overlaySub.textContent = 'Press Space or click Start for a new game';
    overlay.classList.add('visible');
    updateHud();
}

function togglePause() {
    if (state === 'rolling' || state === 'aiming' || state === 'ballinhand') {
        stateBeforePause = state;
        state = 'paused';
    } else if (state === 'paused') {
        state = stateBeforePause;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

function pot(ball) {
    ball.potted = true;
    ball.vx = 0;
    ball.vy = 0;
    if (ball.n === 0) shotInfo.cuePotted = true;
    else shotInfo.potted.push(ball.n);
}

function substep(h) {
    for (const b of balls) {
        if (b.potted) continue;
        b.x += b.vx * h;
        b.y += b.vy * h;

        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 0) {
            const dec = FRICTION * h;
            if (sp <= dec || sp < STOP_SPEED) {
                b.vx = 0;
                b.vy = 0;
            } else {
                const k = (sp - dec) / sp;
                b.vx *= k;
                b.vy *= k;
            }
        }
    }

    // Pockets first: the pocket mouths sit on the cushion line.
    for (const b of balls) {
        if (b.potted) continue;
        for (const p of POCKETS) {
            if (Math.hypot(b.x - p.x, b.y - p.y) < POCKET_R) {
                pot(b);
                break;
            }
        }
    }

    // Cushions.
    for (const b of balls) {
        if (b.potted) continue;
        if (b.x < PLAY_L + BALL_R) {
            b.x = PLAY_L + BALL_R;
            if (b.vx < 0) b.vx = -b.vx * CUSHION_RESTITUTION;
        } else if (b.x > PLAY_R - BALL_R) {
            b.x = PLAY_R - BALL_R;
            if (b.vx > 0) b.vx = -b.vx * CUSHION_RESTITUTION;
        }
        if (b.y < PLAY_T + BALL_R) {
            b.y = PLAY_T + BALL_R;
            if (b.vy < 0) b.vy = -b.vy * CUSHION_RESTITUTION;
        } else if (b.y > PLAY_B - BALL_R) {
            b.y = PLAY_B - BALL_R;
            if (b.vy > 0) b.vy = -b.vy * CUSHION_RESTITUTION;
        }
    }

    // Ball to ball.
    const d = BALL_R * 2;
    for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.potted) continue;
        for (let j = i + 1; j < balls.length; j++) {
            const b = balls[j];
            if (b.potted) continue;

            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let dist = Math.hypot(dx, dy);
            if (dist >= d || dist === 0) continue;

            const nx = dx / dist;
            const ny = dy / dist;

            // Separate the overlap evenly.
            const overlap = (d - dist) / 2;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;

            const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rel >= 0) continue;   // already separating

            if (a.n === 0 || b.n === 0) {
                const objBall = a.n === 0 ? b : a;
                if (shotInfo.firstContact === null) shotInfo.firstContact = objBall.n;
            }

            // Equal masses: swap the normal components (scaled by restitution),
            // keep the tangential ones.
            const an = a.vx * nx + a.vy * ny;
            const bn = b.vx * nx + b.vy * ny;
            const e = BALL_RESTITUTION;
            const anNew = ((1 - e) / 2) * an + ((1 + e) / 2) * bn;
            const bnNew = ((1 + e) / 2) * an + ((1 - e) / 2) * bn;

            a.vx += (anNew - an) * nx;
            a.vy += (anNew - an) * ny;
            b.vx += (bnNew - bn) * nx;
            b.vy += (bnNew - bn) * ny;
        }
    }
}

function simulate(dt) {
    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-9 && guard++ < 200) {
        let vmax = 0;
        for (const b of balls) {
            if (b.potted) continue;
            vmax = Math.max(vmax, Math.hypot(b.vx, b.vy));
        }
        let h = Math.min(SUB_DT, remaining);
        if (vmax > 0) h = Math.min(h, MAX_STEP_DIST / vmax);
        if (h <= 0) break;
        substep(h);
        remaining -= h;
    }
}

function step(dt) {
    if (state === 'idle' || state === 'paused' || state === 'gameover') return;

    if (state === 'aiming' || state === 'ballinhand') {
        aiTick(dt);
        return;
    }

    simulate(dt);
    if (!ballsMoving()) resolveShot();
}

// ---------------------------------------------------------------------------
// Shooting & rules
// ---------------------------------------------------------------------------

function shoot(angle, pow) {
    if (state !== 'aiming') return false;

    const p = Math.max(0, Math.min(1, pow));
    const speed = MIN_SHOT_SPEED + p * (MAX_SHOT_SPEED - MIN_SHOT_SPEED);
    const cue = balls[0];

    shotInfo = newShotInfo();
    shotInfo.clearedAtStart = groups[currentPlayer] !== null && groupRemaining(groups[currentPlayer]) === 0;

    cue.vx = Math.cos(angle) * speed;
    cue.vy = Math.sin(angle) * speed;
    aimAngle = angle;
    charging = false;
    power = 0;
    state = 'rolling';
    message = playerName(currentPlayer) + ' shoots…';
    updateHud();
    return true;
}

/** Balls this player is allowed to hit first. */
function legalTargets(player) {
    const group = groups[player];
    if (group === null) {
        return balls.filter((b) => !b.potted && b.n !== 0 && b.n !== 8);
    }
    const own = balls.filter((b) => !b.potted && b.type === group);
    if (own.length) return own;
    const eight = ballByNumber(8);
    return eight && !eight.potted ? [eight] : [];
}

function resolveShot() {
    const me = currentPlayer;
    const opp = other(me);
    const first = shotInfo.firstContact === null ? null : ballByNumber(shotInfo.firstContact);
    const group = groups[me];

    let foul = false;
    if (shotInfo.cuePotted) foul = true;
    if (!first) {
        foul = true;
    } else if (group === null) {
        if (first.type === 'eight') foul = true;
    } else if (shotInfo.clearedAtStart) {
        if (first.type !== 'eight') foul = true;
    } else if (first.type !== group) {
        foul = true;
    }
    shotInfo.foul = foul;
    lastShot = shotInfo;

    if (shotInfo.potted.includes(8)) {
        const legal = !foul && group !== null && shotInfo.clearedAtStart;
        endGame(legal ? me : opp);
        return;
    }

    let assigned = false;
    if (!foul && group === null && shotInfo.potted.length) {
        const firstPot = ballByNumber(shotInfo.potted[0]);
        groups[me] = firstPot.type;
        groups[opp] = firstPot.type === 'solid' ? 'stripe' : 'solid';
        assigned = true;
    }

    let keepShooting = false;
    if (!foul) {
        if (assigned) keepShooting = true;
        else if (groups[me] && shotInfo.potted.some((n) => ballByNumber(n).type === groups[me])) {
            keepShooting = true;
        }
    }

    if (foul) {
        currentPlayer = opp;
        state = 'ballinhand';
        const reason = shotInfo.cuePotted
            ? 'scratch'
            : !first
                ? 'no ball hit'
                : 'wrong ball hit first';
        message = 'Foul (' + reason + ') — ball in hand for ' + playerName(opp) + '.';
    } else if (keepShooting) {
        state = 'aiming';
        const potted = shotInfo.potted.join(', ');
        message = playerName(me) + ' pots ' + potted + ' and shoots again.';
    } else {
        currentPlayer = opp;
        state = 'aiming';
        message = playerName(opp) + ' to shoot.';
    }

    beginTurn();
}

function beginTurn() {
    aiTimer = AI_THINK;
    power = 0;
    charging = false;
    updateHud();
}

/** Place the cue ball during ball-in-hand. Returns whether the spot was legal. */
function placeCue(x, y) {
    if (state !== 'ballinhand') return false;
    if (x < PLAY_L + BALL_R || x > PLAY_R - BALL_R) return false;
    if (y < PLAY_T + BALL_R || y > PLAY_B - BALL_R) return false;
    for (const p of POCKETS) {
        if (Math.hypot(x - p.x, y - p.y) < POCKET_R + BALL_R) return false;
    }
    for (const b of balls) {
        if (b.n === 0 || b.potted) continue;
        if (Math.hypot(x - b.x, y - b.y) < BALL_R * 2) return false;
    }

    const cue = balls[0];
    cue.x = x;
    cue.y = y;
    cue.vx = 0;
    cue.vy = 0;
    cue.potted = false;
    state = 'aiming';
    message = playerName(currentPlayer) + ' to shoot.';
    aiTimer = AI_THINK;
    updateHud();
    return true;
}

// ---------------------------------------------------------------------------
// Computer opponent
// ---------------------------------------------------------------------------

function pathClear(x1, y1, x2, y2, ignore) {
    for (const b of balls) {
        if (b.potted || ignore.includes(b.n)) continue;
        if (pointSegmentDistance(b.x, b.y, x1, y1, x2, y2) < BALL_R * 2 - 1) return false;
    }
    return true;
}

/**
 * Search every (own ball x pocket) pair for the best ghost-ball shot.
 * Returns { angle, power, target, score } or null when nothing is on.
 */
function aiChooseShot() {
    const cue = balls[0];
    const targets = legalTargets(currentPlayer);
    if (!targets.length) return null;

    let best = null;
    for (const b of targets) {
        for (const p of POCKETS) {
            const toPocket = Math.atan2(p.y - b.y, p.x - b.x);
            const ghostX = b.x - Math.cos(toPocket) * BALL_R * 2;
            const ghostY = b.y - Math.sin(toPocket) * BALL_R * 2;
            const aim = Math.atan2(ghostY - cue.y, ghostX - cue.x);
            const cut = Math.abs(normalizeAngle(toPocket - aim));
            if (cut > 1.25) continue;
            if (!pathClear(cue.x, cue.y, ghostX, ghostY, [0, b.n])) continue;
            if (!pathClear(b.x, b.y, p.x, p.y, [0, b.n])) continue;

            const dCue = Math.hypot(ghostX - cue.x, ghostY - cue.y);
            const dPocket = Math.hypot(p.x - b.x, p.y - b.y);
            const score = Math.cos(cut) * 900 - dCue * 0.35 - dPocket * 0.7;
            if (!best || score > best.score) {
                best = { angle: aim, target: b.n, score, cut, dCue, dPocket };
            }
        }
    }

    if (!best) {
        // Nothing makeable: roll up to the nearest legal ball instead.
        let nearest = targets[0];
        let bestD = Infinity;
        for (const b of targets) {
            const d = Math.hypot(b.x - cue.x, b.y - cue.y);
            if (d < bestD) {
                bestD = d;
                nearest = b;
            }
        }
        return {
            angle: Math.atan2(nearest.y - cue.y, nearest.x - cue.x),
            power: 0.45,
            target: nearest.n,
            score: -Infinity,
        };
    }

    const reach = (best.dCue + best.dPocket * 1.6) / 900;
    const pow = Math.max(0.35, Math.min(0.95, 0.34 + reach + best.cut * 0.18));
    const err = (Math.random() * 2 - 1) * AI_ERROR * (1 + best.cut);
    return { angle: best.angle + err, power: pow, target: best.target, score: best.score };
}

/** Pick a legal spot for the cue ball while the computer has ball in hand. */
function aiPlaceCue() {
    const candidates = [];
    const targets = legalTargets(currentPlayer);
    for (const b of targets) {
        for (const p of POCKETS) {
            const ang = Math.atan2(p.y - b.y, p.x - b.x);
            for (const back of [120, 200, 80]) {
                candidates.push({
                    x: b.x - Math.cos(ang) * back,
                    y: b.y - Math.sin(ang) * back,
                });
            }
        }
    }
    candidates.push({ x: HEAD_X, y: MID_Y });
    for (let x = PLAY_L + 60; x < PLAY_R - 40; x += 40) {
        for (let y = PLAY_T + 60; y < PLAY_B - 40; y += 40) {
            candidates.push({ x, y });
        }
    }
    for (const c of candidates) {
        if (placeCue(c.x, c.y)) return true;
    }
    return false;
}

function aiTick(dt) {
    if (!isAiTurn()) return;
    aiTimer -= dt;
    if (aiTimer > 0) return;

    if (state === 'ballinhand') {
        aiPlaceCue();
        aiTimer = AI_THINK;
        return;
    }
    const shot = aiChooseShot();
    if (shot) shoot(shot.angle, shot.power);
    else shoot(aimAngle, 0.4);
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function updateHud() {
    elTurn.textContent = state === 'gameover' && winner
        ? playerName(winner) + ' wins'
        : playerName(currentPlayer);
    elP1Group.textContent = groupLabel(groups[1]);
    elP2Group.textContent = groupLabel(groups[2]);
    const left1 = groupRemaining(groups[1]);
    const left2 = groupRemaining(groups[2]);
    elP1Left.textContent = left1 === null ? '—' : String(left1);
    elP2Left.textContent = left2 === null ? '—' : String(left2);
    elMessage.textContent = message;
    btnMode.textContent = aiEnabled ? 'Opponent: Computer' : 'Opponent: Player 2';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function firstHitAlongAim(x, y, angle) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const r2 = (BALL_R * 2) * (BALL_R * 2);
    let best = null;

    for (const b of balls) {
        if (b.potted || b.n === 0) continue;
        const ex = b.x - x;
        const ey = b.y - y;
        const proj = ex * dx + ey * dy;
        if (proj <= 0) continue;
        const perp2 = ex * ex + ey * ey - proj * proj;
        if (perp2 > r2) continue;
        const t = proj - Math.sqrt(r2 - perp2);
        if (t < 0) continue;
        if (!best || t < best.t) best = { t, ball: b };
    }

    // Clip to the cushions if nothing is in the way.
    let tWall = Infinity;
    if (dx > 0) tWall = Math.min(tWall, (PLAY_R - BALL_R - x) / dx);
    if (dx < 0) tWall = Math.min(tWall, (PLAY_L + BALL_R - x) / dx);
    if (dy > 0) tWall = Math.min(tWall, (PLAY_B - BALL_R - y) / dy);
    if (dy < 0) tWall = Math.min(tWall, (PLAY_T + BALL_R - y) / dy);
    if (!best || tWall < best.t) return { t: Math.max(0, tWall), ball: null };
    return best;
}

function drawBall(b, x, y, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = b.n === 0 ? '#f6f3ea' : b.color;
    ctx.fill();

    if (b.type === 'stripe') {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = '#f6f3ea';
        ctx.fillRect(x - r, y - r, r * 2, r * 0.42);
        ctx.fillRect(x - r, y + r * 0.58, r * 2, r * 0.42);
        ctx.restore();
    }

    // Highlight.
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.45)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    if (b.n !== 0) {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.48, 0, Math.PI * 2);
        ctx.fillStyle = '#f6f3ea';
        ctx.fill();
        ctx.fillStyle = '#1a1a1a';
        ctx.font = 'bold ' + Math.round(r * 0.72) + 'px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.n), x, y + 0.5);
    }

    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function render() {
    // Rails.
    ctx.fillStyle = '#5c3216';
    roundRect(0, 0, CANVAS_W, CANVAS_H, 18);
    ctx.fill();
    ctx.fillStyle = '#7a4520';
    roundRect(6, 6, CANVAS_W - 12, CANVAS_H - 12, 14);
    ctx.fill();

    // Felt.
    const felt = ctx.createLinearGradient(0, PLAY_T, 0, PLAY_B);
    felt.addColorStop(0, '#15764a');
    felt.addColorStop(1, '#0f5836');
    ctx.fillStyle = felt;
    ctx.fillRect(PLAY_L, PLAY_T, PLAY_R - PLAY_L, PLAY_B - PLAY_T);

    // Spots.
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    [HEAD_X, FOOT_X].forEach((x) => {
        ctx.beginPath();
        ctx.arc(x, MID_Y, 2.5, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(HEAD_X, PLAY_T);
    ctx.lineTo(HEAD_X, PLAY_B);
    ctx.stroke();

    // Sight diamonds on the rails.
    ctx.fillStyle = 'rgba(240,232,210,0.55)';
    for (let i = 1; i <= 7; i++) {
        if (i === 4) continue;                       // the side pockets sit here
        const x = PLAY_L + ((PLAY_R - PLAY_L) / 8) * i;
        diamond(x, PLAY_T / 2);
        diamond(x, CANVAS_H - PLAY_T / 2);
    }
    for (let i = 1; i <= 3; i++) {
        const y = PLAY_T + ((PLAY_B - PLAY_T) / 4) * i;
        diamond(PLAY_L / 2, y);
        diamond(CANVAS_W - PLAY_L / 2, y);
    }

    // Pockets.
    for (const p of POCKETS) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
        ctx.fillStyle = '#0a0a0a';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Aim guide.
    const cue = balls[0];
    if ((state === 'aiming' || state === 'paused') && cue && !cue.potted) {
        const hit = firstHitAlongAim(cue.x, cue.y, aimAngle);
        const hx = cue.x + Math.cos(aimAngle) * hit.t;
        const hy = cue.y + Math.sin(aimAngle) * hit.t;

        ctx.save();
        ctx.setLineDash([7, 7]);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cue.x, cue.y);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.arc(hx, hy, BALL_R, 0, Math.PI * 2);
        ctx.stroke();

        if (hit.ball) {
            const ang = Math.atan2(hit.ball.y - hy, hit.ball.x - hx);
            ctx.strokeStyle = 'rgba(245,197,66,0.8)';
            ctx.beginPath();
            ctx.moveTo(hit.ball.x, hit.ball.y);
            ctx.lineTo(hit.ball.x + Math.cos(ang) * 55, hit.ball.y + Math.sin(ang) * 55);
            ctx.stroke();
        }
        ctx.restore();

        // Cue stick, pulled back with the charge. Clipped to the felt so it
        // never spills over the rails.
        const back = 26 + power * 60;
        ctx.save();
        ctx.beginPath();
        ctx.rect(PLAY_L, PLAY_T, PLAY_R - PLAY_L, PLAY_B - PLAY_T);
        ctx.clip();
        ctx.translate(cue.x, cue.y);
        ctx.rotate(aimAngle);
        ctx.fillStyle = '#c9a15c';
        ctx.fillRect(-back - 210, -2.5, 210, 5);
        ctx.fillStyle = '#2b2118';
        ctx.fillRect(-back - 210, -2.5, 70, 5);   // grip, at the far end
        ctx.fillStyle = '#e8e2d4';
        ctx.fillRect(-back - 6, -2.5, 6, 5);      // ferrule at the tip
        ctx.restore();
    }

    // Ball-in-hand ghost.
    if (state === 'ballinhand' && !isAiTurn()) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, BALL_R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // Balls on the table.
    for (const b of balls) {
        if (b.potted) continue;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(b.x + 2, b.y + 3, BALL_R, BALL_R * 0.9, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fill();
        ctx.restore();
        drawBall(b, b.x, b.y, BALL_R);
    }

    // Pocketed tray along the bottom rail.
    const potted = balls.filter((b) => b.potted && b.n !== 0);
    potted.forEach((b, i) => {
        drawBall(b, PLAY_L + 16 + i * 20, CANVAS_H - RAIL / 2, 7.5);
    });

    if (powerFill) powerFill.style.width = (power * 100).toFixed(1) + '%';
}

function diamond(x, y) {
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x + 3, y);
    ctx.lineTo(x, y + 4);
    ctx.lineTo(x - 3, y);
    ctx.closePath();
    ctx.fill();
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
// Loop
// ---------------------------------------------------------------------------

let lastTs = 0;

function frame(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;

    if (charging && state === 'aiming') {
        power = Math.min(1, power + dt / CHARGE_TIME);
    }
    step(dt);
    render();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
}

canvas.addEventListener('mousemove', (e) => {
    const p = canvasPoint(e);
    pointer = p;
    if (state === 'aiming' && !isAiTurn()) {
        const cue = balls[0];
        if (cue && !cue.potted) aimAngle = Math.atan2(p.y - cue.y, p.x - cue.x);
    }
});

canvas.addEventListener('mousedown', (e) => {
    const p = canvasPoint(e);
    pointer = p;
    if (state === 'ballinhand' && !isAiTurn()) {
        placeCue(p.x, p.y);
        return;
    }
    if (state === 'aiming' && !isAiTurn()) {
        charging = true;
        power = 0;
    }
});

window.addEventListener('mouseup', () => {
    if (!charging) return;
    charging = false;
    if (state === 'aiming') shoot(aimAngle, power);
    power = 0;
});

window.addEventListener('keydown', (e) => {
    const key = e.key;
    if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else if (state === 'aiming' && !charging && !isAiTurn()) {
            charging = true;
            power = 0;
        }
        return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
        e.preventDefault();
        if (state === 'aiming' && !isAiTurn()) {
            const stepSize = AIM_STEP * (e.shiftKey ? 5 : 1);
            aimAngle += key === 'ArrowRight' ? stepSize : -stepSize;
        }
        return;
    }
    if (key === 'p' || key === 'P') {
        togglePause();
        return;
    }
    if (key === 'r' || key === 'R') {
        startGame();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key !== ' ' && e.key !== 'Spacebar') return;
    if (!charging) return;
    charging = false;
    if (state === 'aiming') shoot(aimAngle, power);
    power = 0;
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

btnMode.addEventListener('click', () => {
    aiEnabled = !aiEnabled;
    aiTimer = AI_THINK;
    updateHud();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

rackBalls();
state = 'idle';
message = 'Break to begin — the table is open.';
updateHud();
render();
requestAnimationFrame(frame);
