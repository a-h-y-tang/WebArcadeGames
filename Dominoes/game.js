'use strict';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
const W = 880;
const H = 330;
const PAD = 16;

const HALF = 26;              // one half of a bone on the table
const ROW_H = 66;             // height of a row of the train
const TRAIN_TOP = 42;
const TRAIN_ROWS = 3;
const TILE_GAP = 1;

const PAD_W = 24;             // the glowing "play here" pads
const PAD_H = 44;
const GUTTER = PAD + PAD_W + 8;
const ROW_START = GUTTER;
const ROW_END = W - GUTTER;

const HAND_HALF = 30;         // one half of a bone in your hand
const HAND_W = HAND_HALF * 2;
const HAND_TOP = 286;
const HAND_LIFT = 10;
const HAND_GAP = 6;

const CPU_Y = 12;
const CPU_W = 34;
const CPU_H = 18;
const CPU_GAP = 5;

const FACE = '#f6efe0';
const FACE_EDGE = '#bdb199';
const PIP = '#24201b';
const BACK = '#7d2f2b';
const BACK_EDGE = '#4d1b19';

// Pip positions on a 3x3 grid, as [column, row].
const PIP_MAP = {
    0: [],
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

const TARGET = 100;           // points needed to win the match
const HAND_SIZE = 7;

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

/** All 28 bones of a double-six set, each canonical with a <= b. */
function fullSet() {
    const set = [];
    for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) set.push([a, b]);
    return set;
}

function pips(tile) {
    return tile[0] + tile[1];
}

function isDouble(tile) {
    return tile[0] === tile[1];
}

function handPips(hand) {
    return hand.reduce((sum, t) => sum + pips(t), 0);
}

/** The two numbers at the ends of the train, or null when it is empty. */
function openEnds(train) {
    if (!train || train.length === 0) return null;
    return { left: train[0].a, right: train[train.length - 1].b };
}

/** Which ends of the train this bone may be laid on. */
function canPlayTile(tile, train) {
    const ends = openEnds(train);
    if (!ends) return { left: true, right: true };
    return {
        left: tile[0] === ends.left || tile[1] === ends.left,
        right: tile[0] === ends.right || tile[1] === ends.right,
    };
}

/** Indices of the bones in `hand` that can be played somewhere. */
function playableTiles(hand, train) {
    const out = [];
    hand.forEach((tile, i) => {
        const can = canPlayTile(tile, train);
        if (can.left || can.right) out.push(i);
    });
    return out;
}

/** Who leads the hand, and with which bone: highest double, else heaviest bone. */
function openingMove(allHands) {
    let best = null;
    const better = (tile, cand) => {
        if (!cand) return true;
        if (isDouble(tile) !== cand.double) return isDouble(tile);
        return pips(tile) > cand.pipCount;
    };
    allHands.forEach((hand, player) => {
        hand.forEach((tile, index) => {
            if (better(tile, best)) best = { player, index, double: isDouble(tile), pipCount: pips(tile) };
        });
    });
    return best ? { player: best.player, index: best.index } : null;
}

/**
 * The computer's choice: the heaviest playable bone, preferring doubles on a
 * tie, laid on the right end when both ends fit.
 */
function bestMove(hand, train) {
    let best = null;
    hand.forEach((tile, index) => {
        const can = canPlayTile(tile, train);
        if (!can.left && !can.right) return;
        const score = pips(tile);
        if (best === null || score > best.score ||
            (score === best.score && isDouble(tile) && !best.double)) {
            best = { index, end: can.right ? 'right' : 'left', score, double: isDouble(tile) };
        }
    });
    return best ? { index: best.index, end: best.end } : null;
}

/**
 * Canvas rectangles for the train, plus the two end pads. The train is laid
 * left to right and wraps when a bone would not fit; each row is centred
 * across the cloth, and the rows in use are centred top to bottom, so a short
 * train sits in the middle of the table instead of in one corner.
 */
function trainGeometry(train) {
    const span = ROW_END - ROW_START;
    const rows = [[]];
    let used = 0;
    for (const entry of train) {
        const wide = !entry.double;
        const w = wide ? HALF * 2 : HALF;
        const h = wide ? HALF : HALF * 2;
        if (used > 0 && used + TILE_GAP + w > span) {
            rows.push([]);
            used = 0;
        }
        rows[rows.length - 1].push({ entry, w, h });
        used += (used > 0 ? TILE_GAP : 0) + w;
    }

    const rowCount = Math.min(rows.length, TRAIN_ROWS);
    const yShift = ((TRAIN_ROWS - rowCount) * ROW_H) / 2;
    const tiles = [];
    rows.forEach((row, r) => {
        const total = row.reduce((sum, t, i) => sum + t.w + (i ? TILE_GAP : 0), 0);
        let x = ROW_START + (span - total) / 2;
        const index = Math.min(r, TRAIN_ROWS - 1);
        const centre = TRAIN_TOP + yShift + index * ROW_H + ROW_H / 2;
        row.forEach((t) => {
            tiles.push({
                x, y: centre - t.h / 2, w: t.w, h: t.h, row: index,
                a: t.entry.a, b: t.entry.b, double: t.entry.double,
            });
            x += t.w + TILE_GAP;
        });
    });

    const padFor = (tile, side) => {
        const centre = tile ? tile.y + tile.h / 2 : TRAIN_TOP + (TRAIN_ROWS * ROW_H) / 2;
        const px = tile
            ? (side === 'left' ? tile.x - PAD_W - 6 : tile.x + tile.w + 6)
            : W / 2 + (side === 'left' ? -PAD_W - 6 : 6);
        return {
            x: Math.max(PAD, Math.min(px, W - PAD - PAD_W)),
            y: centre - PAD_H / 2,
            w: PAD_W,
            h: PAD_H,
        };
    };
    return {
        tiles,
        leftPad: padFor(tiles[0], 'left'),
        rightPad: padFor(tiles[tiles.length - 1], 'right'),
    };
}

/** Canvas rectangles for the bones in your hand, left to right. */
function handGeometry(hand, selectedIndex) {
    const n = hand.length;
    if (n === 0) return [];
    const avail = W - PAD * 2;
    const step = n > 1
        ? Math.min(HAND_W + HAND_GAP, (avail - HAND_W) / (n - 1))
        : 0;
    const total = HAND_W + step * (n - 1);
    const x0 = (W - total) / 2;
    const rects = [];
    for (let i = 0; i < n; i++) {
        const x = x0 + i * step;
        const y = HAND_TOP - (i === selectedIndex ? HAND_LIFT : 0);
        const visible = i < n - 1 ? Math.min(step, HAND_W) : HAND_W;
        rects.push({
            x, y, w: HAND_W, h: HAND_HALF,
            clickX: x + Math.max(visible, 8) / 2,
            clickY: y + HAND_HALF / 2,
            tile: hand[i],
        });
    }
    return rects;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let hands = [[], []];         // [you, computer]
let boneyard = [];
let layout = [];              // [{ tile, a, b, double }] joined left to right
let turn = 0;                 // 0 = you, 1 = computer
let scores = [0, 0];
let passes = 0;
let phase = 'playing';        // playing | hand-over | game-over
let selected = 0;
let message = '';
let aiDelay = 420;            // ms before the computer moves
let aiEnabled = true;         // test hook: false stops the computer moving
let aiTimer = null;
let rngState = 1;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function mulberry32() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffled(items) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(mulberry32() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function laid(tile, leftFace) {
    const other = tile[0] === leftFace ? tile[1] : tile[0];
    return { tile, a: leftFace, b: other, double: isDouble(tile) };
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function newGame(seed) {
    rngState = seed === undefined ? Math.floor(Math.random() * 1e9) : seed;
    scores = [0, 0];
    startHand();
}

function startHand() {
    clearTimeout(aiTimer);
    const deck = shuffled(fullSet());
    hands = [deck.slice(0, HAND_SIZE), deck.slice(HAND_SIZE, HAND_SIZE * 2)];
    boneyard = deck.slice(HAND_SIZE * 2);
    layout = [];
    passes = 0;
    selected = 0;
    phase = 'playing';
    const opening = openingMove(hands);
    const tile = hands[opening.player].splice(opening.index, 1)[0];
    layout.push(laid(tile, tile[0]));
    turn = 1 - opening.player;
    message = opening.player === 0
        ? `You hold the opening bone (${tile[0]}-${tile[1]}) and lead with it.`
        : `The computer leads with ${tile[0]}-${tile[1]}.`;
    render();
    if (turn === 1) scheduleComputer();
}

/** Test and debugging hook: drop the game into an exact position. */
function setupHand(position) {
    clearTimeout(aiTimer);
    hands = [
        (position.you || []).map((t) => t.slice()),
        (position.computer || []).map((t) => t.slice()),
    ];
    boneyard = (position.boneyard || []).map((t) => t.slice());
    layout = (position.layout || []).map(([a, b]) => ({
        tile: a <= b ? [a, b] : [b, a], a, b, double: a === b,
    }));
    turn = position.turn === undefined ? 0 : position.turn;
    scores = position.scores ? position.scores.slice() : [0, 0];
    passes = position.passes || 0;
    phase = 'playing';
    selected = hands[0].length ? 0 : -1;
    message = '';
    hideOverlay();
    render();
}

function placeBone(player, index, end) {
    const tile = hands[player][index];
    const ends = openEnds(layout);
    if (!ends) {
        layout.push(laid(tile, tile[0]));
    } else if (end === 'left') {
        const face = tile[0] === ends.left ? tile[1] : tile[0];
        layout.unshift({ tile, a: face, b: ends.left, double: isDouble(tile) });
    } else {
        layout.push(laid(tile, ends.right));
    }
    hands[player].splice(index, 1);
    passes = 0;
}

function humanPlay(index, end) {
    if (phase !== 'playing' || turn !== 0) {
        message = phase === 'playing' ? 'Wait — the computer is thinking.' : 'The hand is over.';
        render();
        return false;
    }
    const tile = hands[0][index];
    if (!tile) return false;
    const can = canPlayTile(tile, layout);
    let where = end;
    if (!where) where = can.right ? 'right' : (can.left ? 'left' : null);
    if (!where || !can[where]) {
        const ends = openEnds(layout);
        message = ends
            ? `${tile[0]}-${tile[1]} does not fit there — the open ends are ${ends.left} and ${ends.right}.`
            : 'Nothing to match yet.';
        render();
        return false;
    }
    placeBone(0, index, where);
    selected = hands[0].length ? Math.min(selected, hands[0].length - 1) : -1;
    message = `You play ${tile[0]}-${tile[1]} on the ${where}.`;
    if (hands[0].length === 0) {
        endHand(0, false);
        return true;
    }
    turn = 1;
    render();
    scheduleComputer();
    return true;
}

function humanDraw() {
    if (phase !== 'playing' || turn !== 0) return false;
    if (playableTiles(hands[0], layout).length) {
        message = 'You have a bone you can play — no need to draw.';
        render();
        return false;
    }
    if (boneyard.length === 0) {
        message = 'The boneyard is empty — you must pass.';
        render();
        return false;
    }
    const tile = boneyard.pop();
    hands[0].push(tile);
    if (selected < 0) selected = 0;
    message = `You draw ${tile[0]}-${tile[1]} from the boneyard.`;
    render();
    return true;
}

function humanPass() {
    if (phase !== 'playing' || turn !== 0) return false;
    if (playableTiles(hands[0], layout).length) {
        message = 'You can still play — passing is not allowed.';
        render();
        return false;
    }
    if (boneyard.length > 0) {
        message = 'Draw from the boneyard before passing.';
        render();
        return false;
    }
    passes++;
    message = 'You pass.';
    if (passes >= 2) {
        endBlocked();
        return true;
    }
    turn = 1;
    render();
    scheduleComputer();
    return true;
}

function scheduleComputer() {
    if (!aiEnabled) return;
    clearTimeout(aiTimer);
    aiTimer = setTimeout(computerTurn, aiDelay);
}

function computerTurn() {
    if (phase !== 'playing' || turn !== 1) return;
    const move = bestMove(hands[1], layout);
    if (move) {
        const tile = hands[1][move.index];
        placeBone(1, move.index, move.end);
        message = `The computer plays ${tile[0]}-${tile[1]} on the ${move.end}.`;
        if (hands[1].length === 0) {
            endHand(1, false);
            return;
        }
        turn = 0;
        render();
        return;
    }
    if (boneyard.length > 0) {
        const tile = boneyard.pop();
        hands[1].push(tile);
        message = 'The computer draws from the boneyard.';
        render();
        scheduleComputer();
        return;
    }
    passes++;
    message = 'The computer passes.';
    if (passes >= 2) {
        endBlocked();
        return;
    }
    turn = 0;
    render();
}

function endBlocked() {
    const mine = handPips(hands[0]);
    const theirs = handPips(hands[1]);
    if (mine === theirs) {
        endHand(null, true);
    } else {
        endHand(mine < theirs ? 0 : 1, true);
    }
}

function endHand(winner, blocked) {
    clearTimeout(aiTimer);
    let gained = 0;
    if (winner !== null) {
        gained = handPips(hands[1 - winner]);
        scores[winner] += gained;
    }
    const matchOver = winner !== null && scores[winner] >= TARGET;
    phase = matchOver ? 'game-over' : 'hand-over';

    let title;
    let sub;
    if (winner === null) {
        title = 'Nobody out';
        sub = 'The train is blocked and the hands are level, so nobody scores.';
    } else if (winner === 0) {
        title = matchOver ? 'You win the match!' : (blocked ? 'You win the hand' : 'Domino! You win the hand');
        sub = blocked
            ? `The train is blocked. Your hand was the lighter one, so you score ${gained}.`
            : `You played your last bone and score the ${gained} pips left in the computer's hand.`;
    } else {
        title = matchOver ? 'The computer wins the match' : 'The computer wins the hand';
        sub = blocked
            ? `The train is blocked. The computer's hand was lighter, so it scores ${gained}.`
            : `The computer played its last bone and scores the ${gained} pips left in your hand.`;
    }
    if (matchOver) sub += ` Final score ${scores[0]}–${scores[1]}.`;
    message = title;
    showOverlay(title, sub, matchOver ? 'New game' : 'Next hand');
    render();
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const overlay = el('overlay');

function showOverlay(title, sub, button) {
    el('overlay-title').textContent = title;
    el('overlay-sub').textContent = sub;
    el('btn-continue').textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function updateHud() {
    el('score-you').textContent = String(scores[0]);
    el('score-cpu').textContent = String(scores[1]);
    el('boneyard-count').textContent = String(boneyard.length);
    el('turn-label').textContent = phase !== 'playing'
        ? 'Hand over'
        : (turn === 0 ? 'Your turn' : "Computer's turn");
    el('message').textContent = message;

    const stuck = phase === 'playing' && turn === 0 && playableTiles(hands[0], layout).length === 0;
    el('btn-draw').disabled = !(stuck && boneyard.length > 0);
    el('btn-pass').disabled = !(stuck && boneyard.length === 0);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawPips(value, x, y, size) {
    const margin = size * 0.2;
    const inner = size - margin * 2;
    const radius = Math.max(1.8, size * 0.1);
    ctx.fillStyle = PIP;
    for (const [col, row] of PIP_MAP[value]) {
        ctx.beginPath();
        ctx.arc(x + margin + (inner * col) / 2, y + margin + (inner * row) / 2, radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBone(x, y, w, h, a, b, highlight) {
    ctx.save();
    ctx.shadowColor = '#00000055';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = FACE;
    roundRect(x, y, w, h, 4);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = highlight ? '#ffd98a' : FACE_EDGE;
    ctx.lineWidth = highlight ? 2.5 : 1;
    roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 4);
    ctx.stroke();

    const horizontal = w > h;
    const size = horizontal ? w / 2 : h / 2;
    ctx.strokeStyle = '#b6a98e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (horizontal) {
        ctx.moveTo(x + w / 2, y + 4);
        ctx.lineTo(x + w / 2, y + h - 4);
    } else {
        ctx.moveTo(x + 4, y + h / 2);
        ctx.lineTo(x + w - 4, y + h / 2);
    }
    ctx.stroke();

    if (horizontal) {
        drawPips(a, x, y, size);
        drawPips(b, x + size, y, size);
    } else {
        drawPips(a, x, y, size);
        drawPips(b, x, y + size, size);
    }
}

function drawBack(x, y, w, h) {
    ctx.fillStyle = BACK;
    roundRect(x, y, w, h, 3);
    ctx.fill();
    ctx.strokeStyle = BACK_EDGE;
    ctx.lineWidth = 1;
    roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 3);
    ctx.stroke();
    ctx.strokeStyle = '#d8a9a0aa';
    roundRect(x + 3.5, y + 3.5, w - 7, h - 7, 2);
    ctx.stroke();
}

function drawPadMarker(rect, live, value) {
    ctx.save();
    ctx.globalAlpha = live ? 1 : 0.28;
    ctx.fillStyle = live ? '#ffd98a33' : '#ffffff14';
    roundRect(rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = live ? 2 : 1;
    ctx.strokeStyle = live ? '#ffd98a' : '#ffffff55';
    roundRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, 6);
    ctx.stroke();
    if (value !== null && value !== undefined) {
        ctx.setLineDash([]);
        ctx.fillStyle = live ? '#ffe9b8' : '#ffffff88';
        ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(value), rect.x + rect.w / 2, rect.y + rect.h / 2);
        ctx.textAlign = 'left';
    }
    ctx.restore();
}

function drawLabel(text, x, y, align) {
    ctx.fillStyle = '#ffffff7a';
    ctx.font = '600 11px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
}

function render() {
    // Cloth
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#176234');
    grad.addColorStop(1, '#0e4425');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, TRAIN_TOP + 70, 40, W / 2, TRAIN_TOP + 70, W * 0.62);
    glow.addColorStop(0, '#ffffff10');
    glow.addColorStop(1, '#00000000');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // The computer's bones, face down
    const n = hands[1].length;
    const totalCpu = n * CPU_W + Math.max(0, n - 1) * CPU_GAP;
    let cx = (W - totalCpu) / 2;
    for (let i = 0; i < n; i++) {
        drawBack(cx, CPU_Y, CPU_W, CPU_H);
        cx += CPU_W + CPU_GAP;
    }
    drawLabel(`COMPUTER — ${n} bone${n === 1 ? '' : 's'}`, PAD, CPU_Y + CPU_H / 2);
    drawLabel(`BONEYARD — ${boneyard.length}`, W - PAD, CPU_Y + CPU_H / 2, 'right');

    // The train
    const geo = trainGeometry(layout);
    geo.tiles.forEach((t) => drawBone(t.x, t.y, t.w, t.h, t.a, t.b, false));

    const sel = selected >= 0 ? hands[0][selected] : null;
    const can = sel ? canPlayTile(sel, layout) : { left: false, right: false };
    const myTurn = phase === 'playing' && turn === 0;
    const ends = openEnds(layout);
    if (ends) {
        drawPadMarker(geo.leftPad, myTurn && can.left, ends.left);
        drawPadMarker(geo.rightPad, myTurn && can.right, ends.right);
    }

    // Your hand
    ctx.strokeStyle = '#ffffff22';
    ctx.beginPath();
    ctx.moveTo(PAD, HAND_TOP - HAND_LIFT - 10);
    ctx.lineTo(W - PAD, HAND_TOP - HAND_LIFT - 10);
    ctx.stroke();
    drawLabel('YOUR HAND', PAD, HAND_TOP - HAND_LIFT - 22);

    const rects = handGeometry(hands[0], selected);
    rects.forEach((r, i) => {
        const playable = playableTiles(hands[0], layout).includes(i);
        drawBone(r.x, r.y, r.w, r.h, r.tile[0], r.tile[1], i === selected && playable);
        if (myTurn && !playable) {
            ctx.fillStyle = '#0d3b2133';
            roundRect(r.x, r.y, r.w, r.h, 4);
            ctx.fill();
        }
    });

    updateHud();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((event.clientX - rect.left) / rect.width) * W,
        y: ((event.clientY - rect.top) / rect.height) * H,
    };
}

const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

function onCanvasClick(event) {
    if (phase !== 'playing') return;
    const p = canvasPoint(event);

    const rects = handGeometry(hands[0], selected);
    for (let i = rects.length - 1; i >= 0; i--) {
        const r = rects[i];
        const slice = i < rects.length - 1
            ? { x: r.x, y: r.y, w: Math.max(rects[i + 1].x - r.x, 8), h: r.h }
            : r;
        if (inside(p, slice) || (i === rects.length - 1 && inside(p, r))) {
            chooseTile(i);
            return;
        }
    }

    if (layout.length && selected >= 0) {
        const geo = trainGeometry(layout);
        if (inside(p, geo.leftPad)) { humanPlay(selected, 'left'); return; }
        if (inside(p, geo.rightPad)) { humanPlay(selected, 'right'); return; }
    }
}

function chooseTile(i) {
    selected = i;
    const tile = hands[0][i];
    if (turn !== 0) {
        message = 'Wait — the computer is thinking.';
        render();
        return;
    }
    const can = canPlayTile(tile, layout);
    if (can.left && can.right) {
        message = `${tile[0]}-${tile[1]} fits both ends — pick a pad beside the train.`;
        render();
        return;
    }
    if (can.left || can.right) {
        humanPlay(i, can.left ? 'left' : 'right');
        return;
    }
    const ends = openEnds(layout);
    message = `${tile[0]}-${tile[1]} matches neither end (${ends.left} and ${ends.right}).`;
    render();
}

function onKeyDown(event) {
    if (phase !== 'playing') return;
    const key = event.key;
    const n = hands[0].length;
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
        event.preventDefault();
        if (!n) return;
        const step = key === 'ArrowRight' ? 1 : -1;
        selected = ((selected < 0 ? 0 : selected) + step + n) % n;
        render();
        return;
    }
    if (selected < 0 && n) selected = 0;
    if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        if (selected >= 0) chooseTile(selected);
    } else if (key === 'l' || key === 'L') {
        if (selected >= 0) humanPlay(selected, 'left');
    } else if (key === 'r' || key === 'R') {
        if (selected >= 0) humanPlay(selected, 'right');
    } else if (key === 'd' || key === 'D') {
        humanDraw();
    } else if (key === 'p' || key === 'P') {
        humanPass();
    }
}

canvas.addEventListener('click', onCanvasClick);
window.addEventListener('keydown', onKeyDown);
el('btn-draw').addEventListener('click', humanDraw);
el('btn-pass').addEventListener('click', humanPass);
el('btn-new').addEventListener('click', () => { hideOverlay(); newGame(); });
el('btn-continue').addEventListener('click', () => {
    hideOverlay();
    if (phase === 'game-over') newGame();
    else startHand();
});

newGame();
