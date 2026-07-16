// =======================================================================
// Nine Men's Morris
// =======================================================================
// The board is 24 points, indexed 0-23, forming three nested squares joined
// by four spokes. All game logic is expressed as small pure functions over a
// 24-cell `board` array (0 = empty, 1 = White/you, 2 = Black/AI), which keeps
// the rules deterministic and directly testable via page.evaluate().

const WIDTH = 500;
const HEIGHT = 500;
const PIECES_PER_PLAYER = 9;
const POINT_R = 22;   // click tolerance / point marker radius region
const PIECE_R = 16;   // rendered piece radius

// Pixel coordinates of each point (three rings of eight).
const POINTS = [
    { x: 50, y: 50 },  { x: 250, y: 50 },  { x: 450, y: 50 },   // 0 1 2
    { x: 125, y: 125 },{ x: 250, y: 125 }, { x: 375, y: 125 },  // 3 4 5
    { x: 200, y: 200 },{ x: 250, y: 200 }, { x: 300, y: 200 },  // 6 7 8
    { x: 50, y: 250 }, { x: 125, y: 250 }, { x: 200, y: 250 },  // 9 10 11
    { x: 300, y: 250 },{ x: 375, y: 250 }, { x: 450, y: 250 },  // 12 13 14
    { x: 200, y: 300 },{ x: 250, y: 300 }, { x: 300, y: 300 },  // 15 16 17
    { x: 125, y: 375 },{ x: 250, y: 375 }, { x: 375, y: 375 },  // 18 19 20
    { x: 50, y: 450 }, { x: 250, y: 450 }, { x: 450, y: 450 },  // 21 22 23
];

// Adjacency (which points a piece can slide between), each list ascending.
const ADJ = [
    [1, 9],          // 0
    [0, 2, 4],       // 1
    [1, 14],         // 2
    [4, 10],         // 3
    [1, 3, 5, 7],    // 4
    [4, 13],         // 5
    [7, 11],         // 6
    [4, 6, 8],       // 7
    [7, 12],         // 8
    [0, 10, 21],     // 9
    [3, 9, 11, 18],  // 10
    [6, 10, 15],     // 11
    [8, 13, 17],     // 12
    [5, 12, 14, 20], // 13
    [2, 13, 23],     // 14
    [11, 16],        // 15
    [15, 17, 19],    // 16
    [12, 16],        // 17
    [10, 19],        // 18
    [16, 18, 20, 22],// 19
    [13, 19],        // 20
    [9, 22],         // 21
    [19, 21, 23],    // 22
    [14, 22],        // 23
];

// The 16 mills: 8 horizontal + 8 vertical.
const MILLS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11],
    [12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23],
    [0, 9, 21], [3, 10, 18], [6, 11, 15], [1, 4, 7],
    [16, 19, 22], [8, 12, 17], [5, 13, 20], [2, 14, 23],
];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const whiteHandEl = document.getElementById('white-hand');
const blackHandEl = document.getElementById('black-hand');
const statusEl = document.getElementById('status');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let board, hand, turn, state, mustRemove, selected, winner;

function reset() {
    board = new Array(24).fill(0);
    hand = [0, PIECES_PER_PLAYER, PIECES_PER_PLAYER]; // index by player (1, 2)
    turn = 1;
    state = 'idle';
    mustRemove = false;
    selected = -1;
    winner = 0;
}

// -----------------------------------------------------------------------
// Pure rule helpers
// -----------------------------------------------------------------------
function other(p) { return p === 1 ? 2 : 1; }

function count(p) {
    let n = 0;
    for (const c of board) if (c === p) n++;
    return n;
}

function phaseOf(p) { return hand[p] > 0 ? 'placing' : 'moving'; }

function isFlying(p) { return hand[p] === 0 && count(p) === 3; }

// Would `player` occupying `idx` complete a mill on the current board?
function wouldFormMill(idx, player) {
    for (const m of MILLS) {
        if (!m.includes(idx)) continue;
        if (m.every(c => (c === idx ? player : board[c]) === player)) return true;
    }
    return false;
}

// Is the piece at `idx` currently part of a completed mill?
function inMill(idx) {
    const p = board[idx];
    return p !== 0 && wouldFormMill(idx, p);
}

function allInMills(player) {
    for (let i = 0; i < 24; i++) if (board[i] === player && !inMill(i)) return false;
    return true;
}

// A piece is removable if it isn't in a mill, or if every opposing piece is.
function canRemove(idx) {
    const opp = other(turn);
    if (board[idx] !== opp) return false;
    if (!inMill(idx)) return true;
    return allInMills(opp);
}

// Legal sliding moves for `player` in the moving/flying phase.
function moveTargets(p) {
    if (hand[p] > 0) return [];
    const flying = isFlying(p);
    const res = [];
    for (let f = 0; f < 24; f++) {
        if (board[f] !== p) continue;
        if (flying) {
            for (let t = 0; t < 24; t++) if (board[t] === 0) res.push([f, t]);
        } else {
            for (const t of ADJ[f]) if (board[t] === 0) res.push([f, t]);
        }
    }
    return res;
}

// Count of "two of mine + one empty" mill lines — a threat heuristic.
function twoCount(p) {
    let n = 0;
    for (const m of MILLS) {
        let mine = 0, empty = 0;
        for (const c of m) {
            if (board[c] === p) mine++;
            else if (board[c] === 0) empty++;
        }
        if (mine === 2 && empty === 1) n++;
    }
    return n;
}

// -----------------------------------------------------------------------
// Turn resolution
// -----------------------------------------------------------------------
function checkWin() {
    for (const p of [1, 2]) {
        if (hand[p] === 0 && count(p) < 3) {
            winner = other(p);
            state = 'over';
            return true;
        }
    }
    return false;
}

function checkStalemate() {
    if (state !== 'playing') return;
    const p = turn;
    if (hand[p] === 0 && count(p) >= 3 && moveTargets(p).length === 0) {
        winner = other(p);
        state = 'over';
        showResult();
    }
}

function endTurn() {
    turn = other(turn);
    selected = -1;
    checkStalemate();
    updateStatus();
}

// -----------------------------------------------------------------------
// The three player actions
// -----------------------------------------------------------------------
function place(idx) {
    if (state !== 'playing' || mustRemove) return false;
    if (hand[turn] <= 0) return false;
    if (idx < 0 || idx >= 24 || board[idx] !== 0) return false;

    board[idx] = turn;
    hand[turn]--;
    if (wouldFormMill(idx, turn)) {
        mustRemove = true;
        updateStatus();
    } else {
        endTurn();
    }
    return true;
}

function move(from, to) {
    if (state !== 'playing' || mustRemove) return false;
    if (hand[turn] > 0) return false; // still placing
    if (board[from] !== turn || board[to] !== 0) return false;
    if (!isFlying(turn) && !ADJ[from].includes(to)) return false;

    board[to] = turn;
    board[from] = 0;
    if (wouldFormMill(to, turn)) {
        mustRemove = true;
        updateStatus();
    } else {
        endTurn();
    }
    return true;
}

function remove(idx) {
    if (state !== 'playing' || !mustRemove) return false;
    if (!canRemove(idx)) return false;

    board[idx] = 0;
    mustRemove = false;
    if (checkWin()) {
        showResult();
        return true;
    }
    endTurn();
    return true;
}

// -----------------------------------------------------------------------
// Computer opponent (Black) — deterministic greedy heuristic
// -----------------------------------------------------------------------
function firstEmptyWhere(pred) {
    for (let i = 0; i < 24; i++) if (board[i] === 0 && pred(i)) return i;
    return -1;
}

function bestPlacement(me) {
    let best = -1, bestScore = -1;
    for (let i = 0; i < 24; i++) {
        if (board[i] !== 0) continue;
        board[i] = me;
        const s = twoCount(me);
        board[i] = 0;
        if (s > bestScore) { bestScore = s; best = i; }
    }
    return best;
}

function chooseMove(me, opp) {
    const moves = moveTargets(me);
    if (moves.length === 0) return null;

    // 1. Complete a mill.
    for (const [f, t] of moves) {
        board[t] = me; board[f] = 0;
        const mill = wouldFormMill(t, me);
        board[f] = me; board[t] = 0;
        if (mill) return [f, t];
    }
    // 2. Block an opponent's completing point.
    const block = firstEmptyWhere(i => wouldFormMill(i, opp));
    if (block >= 0) {
        for (const [f, t] of moves) if (t === block) return [f, t];
    }
    // 3. Maximise our own threats.
    let best = null, bestScore = -1;
    for (const [f, t] of moves) {
        board[t] = me; board[f] = 0;
        const s = twoCount(me);
        board[f] = me; board[t] = 0;
        if (s > bestScore) { bestScore = s; best = [f, t]; }
    }
    return best;
}

function chooseRemoval(me) {
    const opp = other(me);
    const cands = [];
    for (let i = 0; i < 24; i++) if (board[i] === opp && canRemove(i)) cands.push(i);
    if (cands.length === 0) return -1;
    // Prefer a piece that is part of an opponent two-in-a-line threat.
    for (const i of cands) {
        for (const m of MILLS) {
            if (!m.includes(i)) continue;
            let mine = 0, empty = 0;
            for (const c of m) {
                if (board[c] === opp) mine++;
                else if (board[c] === 0) empty++;
            }
            if (mine === 2 && empty === 1) return i;
        }
    }
    return cands[0];
}

function aiTakeTurn() {
    if (state !== 'playing' || turn !== 2) return;
    const me = 2, opp = 1;

    if (phaseOf(me) === 'placing') {
        let target = firstEmptyWhere(i => wouldFormMill(i, me)); // complete own mill
        if (target < 0) target = firstEmptyWhere(i => wouldFormMill(i, opp)); // block
        if (target < 0) target = bestPlacement(me);
        if (target < 0) return;
        place(target);
    } else {
        const mv = chooseMove(me, opp);
        if (!mv) return;
        move(mv[0], mv[1]);
    }

    if (mustRemove) {
        const victim = chooseRemoval(me);
        if (victim >= 0) remove(victim);
        else { mustRemove = false; endTurn(); }
    }
}

// -----------------------------------------------------------------------
// Human input routing
// -----------------------------------------------------------------------
function handlePoint(idx) {
    if (state !== 'playing' || turn !== 1) return;

    if (mustRemove) {
        if (remove(idx)) { draw(); maybeAI(); }
        return;
    }

    if (phaseOf(1) === 'placing') {
        if (place(idx)) { draw(); maybeAI(); }
        return;
    }

    // Moving phase: select a piece, then a destination.
    if (selected === -1) {
        if (board[idx] === 1) selected = idx;
    } else if (idx === selected) {
        selected = -1;
    } else if (board[idx] === 1) {
        selected = idx;
    } else if (board[idx] === 0 && (isFlying(1) || ADJ[selected].includes(idx))) {
        if (move(selected, idx)) { selected = -1; draw(); maybeAI(); return; }
    }
    draw();
}

function maybeAI() {
    if (state === 'playing' && turn === 2 && !mustRemove) {
        setTimeout(() => {
            aiTakeTurn();
            updateStatus();
            draw();
        }, 450);
    }
}

// -----------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------
function startGame() {
    reset();
    state = 'playing';
    overlay.classList.remove('visible');
    updateStatus();
    draw();
}

function showResult() {
    overlayTitle.textContent = winner === 1 ? 'You Win!' : 'Black Wins';
    overlaySub.textContent = winner === 1
        ? 'You ground Black down to two pieces. Well played!'
        : 'Black got the better of you this time.';
    overlayScore.textContent = '';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    updateStatus();
}

function updateStatus() {
    if (whiteHandEl) whiteHandEl.textContent = hand[1];
    if (blackHandEl) blackHandEl.textContent = hand[2];
    if (!statusEl) return;
    if (state === 'idle') {
        statusEl.textContent = 'Press Space to start';
    } else if (state === 'over') {
        statusEl.textContent = winner === 1 ? 'You win!' : 'Black wins.';
    } else if (mustRemove) {
        statusEl.textContent = turn === 1 ? 'Mill! Remove a black piece' : 'Black formed a mill…';
    } else if (turn === 1) {
        statusEl.textContent = phaseOf(1) === 'placing' ? 'Your turn — place a piece' : 'Your turn — move a piece';
    } else {
        statusEl.textContent = 'Black is thinking…';
    }
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function line(a, b) {
    ctx.beginPath();
    ctx.moveTo(POINTS[a].x, POINTS[a].y);
    ctx.lineTo(POINTS[b].x, POINTS[b].y);
    ctx.stroke();
}

function squareThrough(tl, tr, br, bl) {
    ctx.beginPath();
    ctx.moveTo(POINTS[tl].x, POINTS[tl].y);
    ctx.lineTo(POINTS[tr].x, POINTS[tr].y);
    ctx.lineTo(POINTS[br].x, POINTS[br].y);
    ctx.lineTo(POINTS[bl].x, POINTS[bl].y);
    ctx.closePath();
    ctx.stroke();
}

function draw() {
    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Board lines.
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 3;
    squareThrough(0, 2, 23, 21);   // outer
    squareThrough(3, 5, 20, 18);   // middle
    squareThrough(6, 8, 17, 15);   // inner
    line(1, 7);   // top spoke
    line(22, 16); // bottom spoke
    line(9, 11);  // left spoke
    line(14, 12); // right spoke

    // Legal destinations for the currently selected piece.
    const targets = new Set();
    if (state === 'playing' && turn === 1 && selected !== -1 && !mustRemove) {
        for (const [f, t] of moveTargets(1)) if (f === selected) targets.add(t);
    }

    // Points and pieces.
    for (let i = 0; i < 24; i++) {
        const { x, y } = POINTS[i];

        // Point marker.
        ctx.fillStyle = '#3b4252';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();

        if (targets.has(i)) {
            ctx.fillStyle = 'rgba(212, 160, 23, 0.35)';
            ctx.beginPath();
            ctx.arc(x, y, PIECE_R * 0.7, 0, Math.PI * 2);
            ctx.fill();
        }

        if (board[i] !== 0) {
            drawPiece(x, y, board[i], i);
        }
    }

    updateStatus();
}

function drawPiece(x, y, player, idx) {
    const isWhite = player === 1;

    // Highlight removable black pieces while the human must remove.
    if (mustRemove && turn === 1 && player === 2 && canRemove(idx)) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, PIECE_R + 4, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.fillStyle = isWhite ? '#e6edf3' : '#0b0e14';
    ctx.strokeStyle = isWhite ? '#9aa4b2' : '#4b5563';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, PIECE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Selection ring.
    if (idx === selected) {
        ctx.strokeStyle = '#d4a017';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, PIECE_R + 4, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function nearestPoint(x, y) {
    let best = -1, bestD = POINT_R;
    for (let i = 0; i < 24; i++) {
        const dx = x - POINTS[i].x;
        const dy = y - POINTS[i].y;
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
canvas.addEventListener('click', e => {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const idx = nearestPoint(x, y);
    if (idx >= 0) handlePoint(idx);
});

document.addEventListener('keydown', e => {
    if ((e.key === ' ' || e.key === 'Enter') && (state === 'idle' || state === 'over')) {
        startGame();
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state !== 'playing') startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
reset();
updateStatus();
draw();
