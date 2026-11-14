// ---------------------------------------------------------------------------
// Backgammon
// ---------------------------------------------------------------------------
// pos.pts[i] holds the checkers standing on point i + 1. Positive is white
// (the player), negative is dark (the computer); the magnitude is the count.
// White runs 24 -> 1 and bears off past point 1; dark runs 1 -> 24 and bears
// off past point 24. White's home board is points 1-6, dark's is 19-24.
// ---------------------------------------------------------------------------

const POINTS = 24;
const CHECKERS = 15;

const WHITE = 'white';
const BLACK = 'black';

// --- Geometry ---
const W = 900;
const H = 560;
const MARGIN = 16;
const COL_W = 64;
const BAR_W = 36;
const TRAY_W = 64;
const BAR_X = MARGIN + 6 * COL_W;          // 400
const RIGHT_X = BAR_X + BAR_W;             // 436
const TRAY_X = RIGHT_X + 6 * COL_W;        // 820
const CHECKER_R = 24;
const MAX_STACK = 5;

// --- Pacing ---
const AI_ROLL_DELAY = 520;
const AI_MOVE_DELAY = 380;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnRoll = document.getElementById('btn-roll');
const turnEl = document.getElementById('turn-indicator');
const messageEl = document.getElementById('message');
const hudEl = {
    whitePips: document.getElementById('white-pips'),
    blackPips: document.getElementById('black-pips'),
    whiteOff: document.getElementById('white-off'),
    blackOff: document.getElementById('black-off'),
    whiteBar: document.getElementById('white-bar'),
    blackBar: document.getElementById('black-bar'),
};

// --- Colours ---
const CLR = {
    frame: '#2a1a0e',
    felt: '#1d4e3f',
    feltEdge: '#143a2e',
    pointLight: '#e3cfa6',
    pointDark: '#a8572f',
    bar: '#3a2514',
    tray: '#241708',
    white: '#f4ead5',
    whiteEdge: '#b9a884',
    black: '#272f3b',
    blackEdge: '#121720',
    select: 'rgba(233, 196, 106, 0.85)',
    target: 'rgba(120, 230, 170, 0.95)',
    targetFill: 'rgba(120, 230, 170, 0.26)',
    offWhite: '#f4ead5',
    offBlack: '#5a657c',
    label: '#8aa39a',
    die: '#f8fafc',
    diePip: '#1f2937',
    dieSpent: '#7a8794',
};

// --- State ---
let pos;
let currentPlayer = WHITE;
let state = 'ready';            // ready | rolling | moving | over
let winner = null;
let dice = [];                  // the two values last rolled
let moves = [];                 // pips still in hand
let spent = [];                 // pips already played this turn (for the dice art)
let selected = null;            // point index | 'bar' | null
let message = '';
let aiEnabled = true;
let diceQueue = [];             // forced die values, drained first (tests)
let timers = [];
let gameId = 0;

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

function initialPosition() {
    const pts = new Array(POINTS).fill(0);
    pts[23] = 2;   // white on the 24-point
    pts[12] = 5;   // white on the 13-point
    pts[7] = 3;    // white on the 8-point
    pts[5] = 5;    // white on the 6-point
    pts[0] = -2;   // dark mirrored
    pts[11] = -5;
    pts[16] = -3;
    pts[18] = -5;
    return { pts, barW: 0, barB: 0, offW: 0, offB: 0 };
}

const clonePos = (p) => ({
    pts: p.pts.slice(),
    barW: p.barW,
    barB: p.barB,
    offW: p.offW,
    offB: p.offB,
});

const isWhite = (player) => player === WHITE;
const signOf = (player) => (isWhite(player) ? 1 : -1);
const other = (player) => (isWhite(player) ? BLACK : WHITE);
const barOf = (p, player) => (isWhite(player) ? p.barW : p.barB);
const offOf = (p, player) => (isWhite(player) ? p.offW : p.offB);

// Pips still to travel: a white checker on point n is n pips from home, a dark
// one is 25 - n. Checkers on the bar count a full 25.
function pipCountPos(p, player) {
    let total = 25 * barOf(p, player);
    for (let i = 0; i < POINTS; i++) {
        const v = p.pts[i];
        if (isWhite(player) ? v > 0 : v < 0) {
            total += Math.abs(v) * (isWhite(player) ? i + 1 : POINTS - i);
        }
    }
    return total;
}

function checkerCountPos(p, player) {
    let n = barOf(p, player) + offOf(p, player);
    for (let i = 0; i < POINTS; i++) {
        const v = p.pts[i];
        if (isWhite(player) ? v > 0 : v < 0) n += Math.abs(v);
    }
    return n;
}

const pipCount = (player) => pipCountPos(pos, player);
const checkerCount = (player) => checkerCountPos(pos, player);

// ---------------------------------------------------------------------------
// Move generation — the single source of truth for legality
// ---------------------------------------------------------------------------

// Where a checker coming off the bar lands for this die.
const entryTarget = (player, die) => (isWhite(player) ? POINTS - die : die - 1);

// May `player` put a checker on point index t?
function canLand(p, player, t) {
    const v = p.pts[t];
    return isWhite(player) ? v >= -1 : v <= 1;
}

// Bearing off needs every checker home and none on the bar.
function canBearOffPos(p, player) {
    if (barOf(p, player) > 0) return false;
    if (isWhite(player)) {
        for (let i = 6; i < POINTS; i++) if (p.pts[i] > 0) return false;
    } else {
        for (let i = 0; i < 18; i++) if (p.pts[i] < 0) return false;
    }
    return true;
}

// Is any of the player's checkers further from home than point index i?
function hasCheckerBehind(p, player, i) {
    if (isWhite(player)) {
        for (let k = i + 1; k < POINTS; k++) if (p.pts[k] > 0) return true;
    } else {
        for (let k = 0; k < i; k++) if (p.pts[k] < 0) return true;
    }
    return false;
}

// Every { from, to, die } the position allows, where `from` is a point index or
// 'bar' and `to` is a point index or 'off'.
function movesForPos(p, player, pips) {
    const out = [];
    const values = [...new Set(pips)];
    const onBar = barOf(p, player) > 0;
    const bearing = !onBar && canBearOffPos(p, player);

    for (const die of values) {
        if (onBar) {
            const t = entryTarget(player, die);
            if (canLand(p, player, t)) out.push({ from: 'bar', to: t, die });
            continue;
        }
        for (let i = 0; i < POINTS; i++) {
            const v = p.pts[i];
            if (isWhite(player) ? v <= 0 : v >= 0) continue;
            const t = isWhite(player) ? i - die : i + die;
            if (t >= 0 && t < POINTS) {
                if (canLand(p, player, t)) out.push({ from: i, to: t, die });
            } else if (bearing) {
                const exact = isWhite(player) ? t === -1 : t === POINTS;
                if (exact || !hasCheckerBehind(p, player, i)) {
                    out.push({ from: i, to: 'off', die });
                }
            }
        }
    }
    return out;
}

function applyMoveTo(p, player, mv) {
    const sign = signOf(player);
    if (mv.from === 'bar') {
        if (isWhite(player)) p.barW--;
        else p.barB--;
    } else {
        p.pts[mv.from] -= sign;
    }
    if (mv.to === 'off') {
        if (isWhite(player)) p.offW++;
        else p.offB++;
        return;
    }
    if (p.pts[mv.to] === -sign) {       // a lone enemy checker: hit it
        p.pts[mv.to] = 0;
        if (isWhite(player)) p.barB++;
        else p.barW++;
    }
    p.pts[mv.to] += sign;
}

const legalMoves = () => movesForPos(pos, currentPlayer, moves);
const canBearOff = (player) => canBearOffPos(pos, player);
const targetsFor = (from) => legalMoves().filter((m) => m.from === from);

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

function rollDie() {
    if (diceQueue.length) return diceQueue.shift();
    return 1 + Math.floor(Math.random() * 6);
}

function rollDice() {
    if (state !== 'rolling') return false;
    const a = rollDie();
    const b = rollDie();
    dice = [a, b];
    moves = a === b ? [a, a, a, a] : [a, b];
    spent = [];
    selected = null;
    message = '';
    state = 'moving';
    sync();
    if (!legalMoves().length) {
        message = currentPlayer === WHITE
            ? `No legal move with ${a} and ${b} — your turn passes`
            : `The computer has no legal move with ${a} and ${b}`;
        moves = [];
        sync();
        endTurn();
        return true;
    }
    if (currentPlayer === BLACK && aiEnabled) scheduleAiMoves();
    return true;
}

// Drop pips that cannot be played, and close the turn when nothing is left.
function pruneDice() {
    const lost = [];
    while (moves.length && !movesForPos(pos, currentPlayer, moves).length) {
        const value = moves.shift();
        spent.push({ value, dead: true });
        lost.push(value);
    }
    if (lost.length) {
        const who = currentPlayer === WHITE ? 'You have' : 'The computer has';
        message = `${who} no move for the ${lost.join(' or the ')} — ${
            lost.length > 1 ? 'those dice are' : 'that die is'} lost`;
    }
    if (!moves.length && state === 'moving') endTurn();
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------

function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers = [];
}

function later(fn, ms) {
    const id = gameId;
    const t = setTimeout(() => {
        if (id === gameId) fn();
    }, ms);
    timers.push(t);
    return t;
}

function applyMove(mv) {
    if (state !== 'moving') return false;
    const legal = legalMoves().some(
        (m) => m.from === mv.from && m.to === mv.to && m.die === mv.die
    );
    if (!legal) return false;

    applyMoveTo(pos, currentPlayer, mv);
    const at = moves.indexOf(mv.die);
    if (at >= 0) moves.splice(at, 1);
    spent.push({ value: mv.die, dead: false });
    selected = null;

    if (checkWin()) return true;
    pruneDice();
    sync();
    return true;
}

function checkWin() {
    if (pos.offW < CHECKERS && pos.offB < CHECKERS) return false;
    winner = pos.offW >= CHECKERS ? WHITE : BLACK;
    state = 'over';
    moves = [];
    selected = null;
    clearTimers();
    overlayTitle.textContent = winner === WHITE ? 'You win!' : 'The computer wins';
    overlaySub.textContent = winMargin();
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    sync();
    return true;
}

// Flavour text for the win screen: a plain game, a gammon (the loser bore off
// nothing) or a backgammon (and still had a checker on the bar or in the
// winner's home board).
function winMargin() {
    const loser = other(winner);
    const bornOff = offOf(pos, loser);
    if (bornOff > 0) {
        return `All fifteen checkers home — ${bornOff} borne off on the other side.`;
    }
    let stranded = barOf(pos, loser) > 0;
    if (!stranded) {
        const range = winner === WHITE ? [0, 6] : [18, POINTS];
        for (let i = range[0]; i < range[1]; i++) {
            if (winner === WHITE ? pos.pts[i] < 0 : pos.pts[i] > 0) stranded = true;
        }
    }
    return stranded
        ? 'A backgammon — the loser was still stuck in the home board, and bore off nothing.'
        : 'A gammon — the loser bore off nothing at all.';
}

function endTurn() {
    if (state === 'over') return;
    currentPlayer = other(currentPlayer);
    moves = [];
    selected = null;
    state = 'rolling';
    sync();
    if (currentPlayer === BLACK && aiEnabled) later(() => rollDice(), AI_ROLL_DELAY);
}

// ---------------------------------------------------------------------------
// The computer opponent
// ---------------------------------------------------------------------------

function evaluate(p, player) {
    const opp = other(player);
    let score = pipCountPos(p, opp) - pipCountPos(p, player);
    score += 14 * offOf(p, player);
    score += 12 * barOf(p, opp);
    score -= 24 * barOf(p, player);

    for (let i = 0; i < POINTS; i++) {
        const v = p.pts[i];
        const mine = player === WHITE ? v : -v;
        if (mine === 1) {
            // A blot deep in the enemy home board is the easiest to pick off.
            const deep = player === WHITE ? i >= 18 : i <= 5;
            score -= deep ? 9 : 4;
        } else if (mine >= 2) {
            const useful = player === WHITE ? i <= 11 : i >= 12;
            score += useful ? 4 : 2;
        }
    }
    return score;
}

// The best order in which to play the dice in hand, searched exhaustively with
// memoisation on (position + pips still in hand).
function bestSequence(p, player, pips) {
    let best = null;
    const seen = new Set();

    const walk = (cur, remaining, seq) => {
        const key = `${cur.pts.join(',')}|${cur.barW},${cur.barB},${cur.offW},${cur.offB}|${[...remaining].sort().join('')}`;
        if (seen.has(key)) return;
        seen.add(key);

        const options = movesForPos(cur, player, remaining);
        if (!options.length || !remaining.length) {
            const score = evaluate(cur, player) + seq.length * 0.5;
            if (!best || score > best.score) best = { score, seq: seq.slice() };
            return;
        }
        for (const mv of options) {
            const next = clonePos(cur);
            applyMoveTo(next, player, mv);
            const rest = remaining.slice();
            rest.splice(rest.indexOf(mv.die), 1);
            seq.push(mv);
            walk(next, rest, seq);
            seq.pop();
        }
    };

    walk(clonePos(p), pips.slice(), []);
    return best ? best.seq : [];
}

function scheduleAiMoves() {
    const plan = bestSequence(pos, BLACK, moves);
    plan.forEach((mv, i) => {
        later(() => {
            if (currentPlayer !== BLACK || state !== 'moving') return;
            applyMove(mv);
            if (i === plan.length - 1 && state === 'moving') pruneDice();
        }, AI_MOVE_DELAY * (i + 1));
    });
    if (!plan.length) later(() => pruneDice(), AI_MOVE_DELAY);
}

// ---------------------------------------------------------------------------
// Clicks
// ---------------------------------------------------------------------------

// Point index, 'bar', 'off' or null for a canvas coordinate.
function pointAt(x, y) {
    if (y < MARGIN || y > H - MARGIN || x < MARGIN) return null;
    if (x >= TRAY_X) return x <= TRAY_X + TRAY_W ? 'off' : null;
    if (x >= BAR_X && x < RIGHT_X) return 'bar';
    let col;
    if (x < BAR_X) col = Math.floor((x - MARGIN) / COL_W);
    else col = 6 + Math.floor((x - RIGHT_X) / COL_W);
    if (col < 0 || col > 11) return null;
    const pointNumber = y < H / 2 ? col + 13 : 12 - col;
    return pointNumber - 1;
}

function clickPoint(where) {
    if (state !== 'moving' || !moves.length) return;
    if (currentPlayer === BLACK && aiEnabled) return;
    if (where === null) return;

    // Picking a checker up.
    const mine = (i) =>
        i !== 'bar' && i !== 'off' && (currentPlayer === WHITE ? pos.pts[i] > 0 : pos.pts[i] < 0);

    if (selected === null) {
        if (barOf(pos, currentPlayer) > 0) {
            // Nothing else may move, so clicking an entry point is enough.
            const entry = targetsFor('bar').filter((m) => m.to === where);
            if (entry.length) {
                entry.sort((a, b) => a.die - b.die);
                applyMove(entry[0]);
            } else if (where === 'bar') {
                selected = 'bar';
            }
            return;
        }
        if (where === 'bar' || where === 'off') return;
        if (mine(where) && targetsFor(where).length) selected = where;
        return;
    }

    if (where === selected) {            // click again to cancel
        selected = null;
        return;
    }

    const options = targetsFor(selected);
    const target = where === 'off' ? 'off' : where;
    const match = options.filter((m) => m.to === target);
    if (match.length) {
        // Prefer the smallest die that reaches the point, so the bigger one
        // stays available for a longer move.
        match.sort((a, b) => a.die - b.die);
        applyMove(match[0]);
        return;
    }
    // Not a destination — treat it as picking up a different checker instead.
    if (mine(where) && targetsFor(where).length) selected = where;
    else selected = null;
}

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    clickPoint(pointAt(x, y));
    sync();
});

btnRoll.addEventListener('click', () => {
    if (state === 'rolling' && currentPlayer === WHITE) rollDice();
});

btnStart.addEventListener('click', () => startGame());

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'r') {
        startGame();
        return;
    }
    if (k === ' ' || k === 'enter') {
        e.preventDefault();
        if (state === 'ready' || state === 'over') startGame();
        else if (state === 'rolling' && currentPlayer === WHITE) rollDice();
    }
});

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function sync() {
    hudEl.whitePips.textContent = String(pipCount(WHITE));
    hudEl.blackPips.textContent = String(pipCount(BLACK));
    hudEl.whiteOff.textContent = String(pos.offW);
    hudEl.blackOff.textContent = String(pos.offB);
    hudEl.whiteBar.textContent = String(pos.barW);
    hudEl.blackBar.textContent = String(pos.barB);
    messageEl.textContent = message;

    if (state === 'over') {
        turnEl.textContent = winner === WHITE ? 'You won' : 'Computer won';
    } else if (state === 'ready') {
        turnEl.textContent = 'Your roll';
    } else if (currentPlayer === WHITE) {
        turnEl.textContent = state === 'rolling' ? 'Your roll' : 'Your move';
    } else {
        turnEl.textContent = state === 'rolling' ? "Computer's roll" : "Computer's move";
    }
    turnEl.classList.toggle('ai', currentPlayer === BLACK && state !== 'over');
    btnRoll.disabled = !(state === 'rolling' && currentPlayer === WHITE);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Column, row and the x of a point's centre.
function pointGeom(i) {
    const pointNumber = i + 1;
    const top = pointNumber >= 13;
    const col = top ? pointNumber - 13 : 12 - pointNumber;
    const x = (col < 6 ? MARGIN + col * COL_W : RIGHT_X + (col - 6) * COL_W) + COL_W / 2;
    return { col, top, x };
}

// Centre of the nth checker (0 = outermost) stacked on a point.
function stackPos(i, n) {
    const { top, x } = pointGeom(i);
    const slot = Math.min(n, MAX_STACK - 1);
    const y = top
        ? MARGIN + CHECKER_R + slot * CHECKER_R * 2
        : H - MARGIN - CHECKER_R - slot * CHECKER_R * 2;
    return { x, y };
}

function drawChecker(x, y, player, label) {
    const [main, edge] = player === WHITE
        ? [CLR.white, CLR.whiteEdge]
        : [CLR.black, CLR.blackEdge];
    const grad = ctx.createRadialGradient(x - 7, y - 8, 3, x, y, CHECKER_R);
    grad.addColorStop(0, main);
    grad.addColorStop(1, edge);
    ctx.beginPath();
    ctx.arc(x, y, CHECKER_R - 2, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, (CHECKER_R - 2) * 0.6, 0, Math.PI * 2);
    ctx.strokeStyle = player === WHITE ? 'rgba(120,100,60,0.3)' : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (label) {
        ctx.fillStyle = player === WHITE ? '#3b2f17' : '#e6edf3';
        ctx.font = 'bold 17px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y + 1);
    }
}

function trianglePath(i) {
    const { top, x } = pointGeom(i);
    const half = COL_W / 2 - 3;
    const tipY = top ? H / 2 - 26 : H / 2 + 26;
    const baseY = top ? MARGIN : H - MARGIN;
    ctx.beginPath();
    ctx.moveTo(x - half, baseY);
    ctx.lineTo(x + half, baseY);
    ctx.lineTo(x, tipY);
    ctx.closePath();
}

function drawTriangle(i) {
    const { col, top } = pointGeom(i);
    trianglePath(i);
    ctx.fillStyle = (col + (top ? 0 : 1)) % 2 === 0 ? CLR.pointDark : CLR.pointLight;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawDie(x, y, value, dead) {
    const s = 38;
    ctx.beginPath();
    ctx.roundRect(x - s / 2, y - s / 2, s, s, 7);
    ctx.fillStyle = dead ? CLR.dieSpent : CLR.die;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const o = s * 0.24;
    const spots = {
        1: [[0, 0]],
        2: [[-o, -o], [o, o]],
        3: [[-o, -o], [0, 0], [o, o]],
        4: [[-o, -o], [o, -o], [-o, o], [o, o]],
        5: [[-o, -o], [o, -o], [0, 0], [-o, o], [o, o]],
        6: [[-o, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [o, o]],
    }[value] || [];
    ctx.fillStyle = CLR.diePip;
    for (const [dx, dy] of spots) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 3.4, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawDiceTray() {
    if (!dice.length) return;
    const shown = [
        ...moves.map((v) => ({ value: v, dead: false })),
        ...spent.map((s) => ({ value: s.value, dead: true })),
    ].slice(0, 4);
    if (!shown.length) return;
    const side = currentPlayer === WHITE ? RIGHT_X + 3 * COL_W : MARGIN + 3 * COL_W;
    const startX = side - ((shown.length - 1) * 46) / 2;
    const plateW = shown.length * 46 + 10;
    ctx.beginPath();
    ctx.roundRect(side - plateW / 2, H / 2 - 28, plateW, 56, 10);
    ctx.fillStyle = 'rgba(10, 26, 21, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    for (let i = 0; i < shown.length; i++) {
        drawDie(startX + i * 46, H / 2, shown[i].value, shown[i].dead);
    }
}

function drawHalo(x, y, colour) {
    ctx.beginPath();
    ctx.arc(x, y, CHECKER_R + 3, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 4;
    ctx.stroke();
}

function render() {
    // Frame and felt.
    ctx.fillStyle = CLR.frame;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = CLR.felt;
    ctx.fillRect(MARGIN, MARGIN, TRAY_X - MARGIN, H - 2 * MARGIN);
    ctx.fillStyle = CLR.bar;
    ctx.fillRect(BAR_X, MARGIN, BAR_W, H - 2 * MARGIN);
    ctx.fillStyle = CLR.tray;
    ctx.fillRect(TRAY_X, MARGIN, TRAY_W, H - 2 * MARGIN);
    ctx.strokeStyle = CLR.feltEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(MARGIN, MARGIN, TRAY_X - MARGIN, H - 2 * MARGIN);
    ctx.strokeRect(TRAY_X, MARGIN, TRAY_W, H - 2 * MARGIN);

    for (let i = 0; i < POINTS; i++) drawTriangle(i);

    // Point numbers along the middle.
    ctx.fillStyle = CLR.label;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < POINTS; i++) {
        const { top, x } = pointGeom(i);
        ctx.fillText(String(i + 1), x, top ? H / 2 - 14 : H / 2 + 14);
    }

    // Tray labels.
    ctx.fillStyle = CLR.label;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('OFF', TRAY_X + TRAY_W / 2, H / 2);

    if (!pos) return requestAnimationFrame(render);

    const targets = selected === null ? [] : targetsFor(selected);
    const targetPoints = new Set(targets.map((m) => m.to));

    // Legal destinations.
    for (const t of targetPoints) {
        if (t === 'off') continue;
        trianglePath(t);
        ctx.fillStyle = CLR.targetFill;
        ctx.fill();
        ctx.strokeStyle = CLR.target;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        const { top, x } = pointGeom(t);
        const y = top ? H / 2 - 40 : H / 2 + 40;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = CLR.target;
        ctx.fill();
    }

    // Checkers on the points.
    for (let i = 0; i < POINTS; i++) {
        const v = pos.pts[i];
        if (!v) continue;
        const player = v > 0 ? WHITE : BLACK;
        const count = Math.abs(v);
        const shown = Math.min(count, MAX_STACK);
        for (let n = 0; n < shown; n++) {
            const { x, y } = stackPos(i, n);
            const label = n === shown - 1 && count > MAX_STACK ? String(count) : '';
            drawChecker(x, y, player, label);
        }
        if (selected === i) {
            const { x, y } = stackPos(i, shown - 1);
            drawHalo(x, y, CLR.select);
        }
    }

    if (targetPoints.has('off')) {
        ctx.beginPath();
        ctx.roundRect(TRAY_X + 6, MARGIN + 6, TRAY_W - 12, H - 2 * MARGIN - 12, 8);
        ctx.strokeStyle = CLR.target;
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    // The bar.
    for (let n = 0; n < pos.barW; n++) {
        drawChecker(BAR_X + BAR_W / 2, H / 2 + 60 + n * 22, WHITE, '');
    }
    for (let n = 0; n < pos.barB; n++) {
        drawChecker(BAR_X + BAR_W / 2, H / 2 - 60 - n * 22, BLACK, '');
    }
    if (selected === 'bar') {
        drawHalo(BAR_X + BAR_W / 2, currentPlayer === WHITE ? H / 2 + 60 : H / 2 - 60, CLR.select);
    }

    // Borne-off checkers stack in the tray: white from the bottom, dark from
    // the top.
    for (let n = 0; n < pos.offW; n++) {
        ctx.fillStyle = CLR.offWhite;
        ctx.fillRect(TRAY_X + 10, H - MARGIN - 14 - n * 13, TRAY_W - 20, 10);
        ctx.strokeStyle = CLR.whiteEdge;
        ctx.lineWidth = 1;
        ctx.strokeRect(TRAY_X + 10, H - MARGIN - 14 - n * 13, TRAY_W - 20, 10);
    }
    for (let n = 0; n < pos.offB; n++) {
        ctx.fillStyle = CLR.offBlack;
        ctx.fillRect(TRAY_X + 10, MARGIN + 4 + n * 13, TRAY_W - 20, 10);
        ctx.strokeStyle = '#8b95a8';
        ctx.lineWidth = 1;
        ctx.strokeRect(TRAY_X + 10, MARGIN + 4 + n * 13, TRAY_W - 20, 10);
    }

    drawDiceTray();
    requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function startGame() {
    gameId++;
    clearTimers();
    pos = initialPosition();
    currentPlayer = WHITE;
    state = 'rolling';
    winner = null;
    dice = [];
    moves = [];
    spent = [];
    selected = null;
    message = 'Roll to begin.';
    diceQueue = [];
    overlay.classList.remove('visible');
    sync();
}

function init() {
    pos = initialPosition();
    currentPlayer = WHITE;
    state = 'ready';
    winner = null;
    dice = [];
    moves = [];
    spent = [];
    selected = null;
    message = '';
    sync();
    requestAnimationFrame(render);
}

init();
