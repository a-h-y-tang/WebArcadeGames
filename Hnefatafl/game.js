// Hnefatafl (Brandub, 7×7) — a Norse tafl game.
//
// The rule engine is a pure, deterministic core operating on module-scope
// globals so Playwright tests can drive it frame-independently. The human
// plays the Defenders (King side); a deterministic AI plays the Attackers,
// which move first (traditional tafl order).

// --- Constants --------------------------------------------------------------
const SIZE = 7;
const EMPTY = 0;
const ATTACKER = 1;
const DEFENDER = 2;
const KING = 3;

const THRONE = { c: 3, r: 3 };
const CORNERS = [
    { c: 0, r: 0 }, { c: SIZE - 1, r: 0 },
    { c: 0, r: SIZE - 1 }, { c: SIZE - 1, r: SIZE - 1 },
];
const DIRS = [
    { dc: 1, dr: 0 }, { dc: -1, dr: 0 },
    { dc: 0, dr: 1 }, { dc: 0, dr: -1 },
];

// --- DOM --------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

const CELL = canvas.width / SIZE; // 80px

// --- Colours ----------------------------------------------------------------
const CLR = {
    light: '#2a1f12',
    dark: '#241a0f',
    throne: '#4a3a22',
    corner: '#3f2f1c',
    cornerMark: '#d4a24e',
    grid: '#3a2c1a',
    attacker: '#b33a3a',
    attackerEdge: '#7a2222',
    defender: '#e8e0d0',
    defenderEdge: '#b7ad98',
    king: '#d4a24e',
    kingEdge: '#8a6a2c',
    select: '#f2c46b',
    moveDot: '#f2c46b99',
};

// --- State ------------------------------------------------------------------
let board;               // board[row][col]
let turn;                // 'attackers' | 'defenders'
let state;               // 'playing' | 'attackers-win' | 'defenders-win'
let selected = null;     // { c, r } currently selected friendly piece
let highlight = [];      // legal destinations for the selection
let aiPending = false;   // guards against overlapping AI turns

// --- Small helpers ----------------------------------------------------------
function inBounds(c, r) {
    return c >= 0 && c < SIZE && r >= 0 && r < SIZE;
}
function isThrone(c, r) {
    return c === THRONE.c && r === THRONE.r;
}
function isCorner(c, r) {
    return CORNERS.some(k => k.c === c && k.r === r);
}
function isRestricted(c, r) {
    return isThrone(c, r) || isCorner(c, r);
}
function sideOf(piece) {
    if (piece === ATTACKER) return 'attackers';
    if (piece === DEFENDER || piece === KING) return 'defenders';
    return null;
}
function pieceAt(c, r) {
    return board[r][c];
}
function kingPosBd(bd) {
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (bd[r][c] === KING) return { c, r };
    return null;
}
function kingPos() {
    return kingPosBd(board);
}

// --- Board construction -----------------------------------------------------
function emptyBoard() {
    const bd = [];
    for (let r = 0; r < SIZE; r++) bd.push(new Array(SIZE).fill(EMPTY));
    return bd;
}
function cloneBoard(bd) {
    return bd.map(row => row.slice());
}

function newGame() {
    board = emptyBoard();
    // King on the throne.
    board[3][3] = KING;
    // Defenders orthogonally adjacent to the King.
    for (const { c, r } of [{ c: 3, r: 2 }, { c: 3, r: 4 }, { c: 2, r: 3 }, { c: 4, r: 3 }]) {
        board[r][c] = DEFENDER;
    }
    // Attackers: two extending inward from each edge midpoint.
    const atk = [
        [3, 0], [3, 1], [3, 6], [3, 5],
        [0, 3], [1, 3], [6, 3], [5, 3],
    ];
    for (const [c, r] of atk) board[r][c] = ATTACKER;

    turn = 'attackers';
    state = 'playing';
    selected = null;
    highlight = [];
}

// --- Test helpers (also handy for setup) ------------------------------------
function clearBoard() {
    board = emptyBoard();
    selected = null;
    highlight = [];
}
function place(c, r, piece) {
    board[r][c] = piece;
}

// --- Movement geometry ------------------------------------------------------
function pathClear(bd, fc, fr, tc, tr) {
    if (fc === tc && fr === tr) return false;
    if (fc !== tc && fr !== tr) return false;      // must be a straight line
    if (bd[tr][tc] !== EMPTY) return false;         // destination occupied
    const piece = bd[fr][fc];
    if (piece !== KING && isRestricted(tc, tr)) return false; // only King stops here

    const dc = Math.sign(tc - fc);
    const dr = Math.sign(tr - fr);
    let c = fc + dc, r = fr + dr;
    while (c !== tc || r !== tr) {
        if (bd[r][c] !== EMPTY) return false;       // cannot jump
        c += dc; r += dr;
    }
    return true;
}

function legalMovesFrom(c, r) {
    const piece = board[r][c];
    if (piece === EMPTY) return [];
    const moves = [];
    for (const { dc, dr } of DIRS) {
        let c2 = c + dc, r2 = r + dr;
        while (inBounds(c2, r2) && board[r2][c2] === EMPTY) {
            if (piece === KING || !isRestricted(c2, r2)) {
                moves.push({ c: c2, r: r2 });
            }
            // A non-King may pass through the empty throne but not stop there,
            // so keep scanning either way.
            c2 += dc; r2 += dr;
        }
    }
    return moves;
}

// --- Applying a move + captures (pure over a given board) -------------------
// Returns { captured: [...], side }.
function applyMove(bd, fc, fr, tc, tr) {
    const piece = bd[fr][fc];
    const side = sideOf(piece);
    bd[fr][fc] = EMPTY;
    bd[tr][tc] = piece;

    const captured = [];
    for (const { dc, dr } of DIRS) {
        const n1c = tc + dc, n1r = tr + dr;
        if (!inBounds(n1c, n1r)) continue;
        const mid = bd[n1r][n1c];
        // Only enemy *soldiers* are captured custodially; the King is immune.
        if (mid === EMPTY || sideOf(mid) === side || mid === KING) continue;

        const n2c = n1c + dc, n2r = n1r + dr;
        let anchored = false;
        if (inBounds(n2c, n2r)) {
            const far = bd[n2r][n2c];
            if ((far !== EMPTY && sideOf(far) === side) || isCorner(n2c, n2r) || isThrone(n2c, n2r)) {
                anchored = true;
            }
        }
        if (anchored) {
            bd[n1r][n1c] = EMPTY;
            captured.push({ c: n1c, r: n1r });
        }
    }
    return { captured, side };
}

// The King is captured when every on-board orthogonal neighbour is an attacker
// or the throne square. (The board edge does not need to be filled.)
function kingSurrounded(bd) {
    const kp = kingPosBd(bd);
    if (!kp) return false;
    let blockers = 0;
    for (const { dc, dr } of DIRS) {
        const c = kp.c + dc, r = kp.r + dr;
        if (!inBounds(c, r)) continue;              // edge — ignored
        if (bd[r][c] === ATTACKER || isThrone(c, r)) { blockers++; continue; }
        return false;                               // an open / friendly side
    }
    return blockers > 0;
}

// --- Public move ------------------------------------------------------------
function move(fc, fr, tc, tr) {
    if (state !== 'playing') return false;
    if (!inBounds(fc, fr) || !inBounds(tc, tr)) return false;
    const piece = board[fr][fc];
    if (piece === EMPTY || sideOf(piece) !== turn) return false;
    if (!pathClear(board, fc, fr, tc, tr)) return false;

    const movedSide = turn;
    applyMove(board, fc, fr, tc, tr);

    // Victory checks.
    if (piece === KING && isCorner(tc, tr)) {
        state = 'defenders-win';
    } else if (movedSide === 'attackers' && kingSurrounded(board)) {
        state = 'attackers-win';
    }

    if (state === 'playing') {
        turn = movedSide === 'attackers' ? 'defenders' : 'attackers';
    }
    return true;
}

// --- Attacker AI (deterministic) -------------------------------------------
function allMovesForSide(bd, side) {
    const list = [];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (sideOf(bd[r][c]) !== side) continue;
            for (const { dc, dr } of DIRS) {
                let c2 = c + dc, r2 = r + dr;
                while (inBounds(c2, r2) && bd[r2][c2] === EMPTY) {
                    const p = bd[r][c];
                    if (p === KING || !isRestricted(c2, r2)) {
                        list.push({ fc: c, fr: r, tc: c2, tr: r2 });
                    }
                    c2 += dc; r2 += dr;
                }
            }
        }
    }
    return list;
}

function scoreAttackerMove(m) {
    const bd = cloneBoard(board);
    const { captured } = applyMove(bd, m.fc, m.fr, m.tc, m.tr);
    let s = 0;
    if (kingSurrounded(bd)) s += 100000;            // immediate win
    s += captured.length * 1000;                    // material

    const kp = kingPosBd(bd);
    if (kp) {
        // Reward crowding the King and pinning it against the throne.
        for (const { dc, dr } of DIRS) {
            const c = kp.c + dc, r = kp.r + dr;
            if (!inBounds(c, r)) continue;
            if (bd[r][c] === ATTACKER) s += 50;
            else if (isThrone(c, r)) s += 25;
        }
        // Encourage closing the distance to the King.
        s -= Math.abs(m.tc - kp.c) + Math.abs(m.tr - kp.r);
    }
    return s;
}

function aiMove() {
    if (state !== 'playing' || turn !== 'attackers') return null;
    const moves = allMovesForSide(board, 'attackers');
    if (moves.length === 0) return null;

    let best = null, bestScore = -Infinity;
    for (const m of moves) {                        // stable scan → deterministic
        const s = scoreAttackerMove(m);
        if (s > bestScore) { bestScore = s; best = m; }
    }
    move(best.fc, best.fr, best.tc, best.tr);
    return best;
}

// --- Rendering --------------------------------------------------------------
function cellRect(c, r) {
    return { x: c * CELL, y: r * CELL };
}

function drawBoard() {
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const { x, y } = cellRect(c, r);
            let fill = (c + r) % 2 === 0 ? CLR.light : CLR.dark;
            if (isThrone(c, r)) fill = CLR.throne;
            else if (isCorner(c, r)) fill = CLR.corner;
            ctx.fillStyle = fill;
            ctx.fillRect(x, y, CELL, CELL);
            ctx.strokeStyle = CLR.grid;
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        }
    }
    // Corner refuge diamonds.
    for (const { c, r } of CORNERS) {
        const { x, y } = cellRect(c, r);
        ctx.strokeStyle = CLR.cornerMark;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + CELL / 2, y + 14);
        ctx.lineTo(x + CELL - 14, y + CELL / 2);
        ctx.lineTo(x + CELL / 2, y + CELL - 14);
        ctx.lineTo(x + 14, y + CELL / 2);
        ctx.closePath();
        ctx.stroke();
    }
    // Throne marker.
    const th = cellRect(THRONE.c, THRONE.r);
    ctx.strokeStyle = CLR.cornerMark;
    ctx.lineWidth = 2;
    ctx.strokeRect(th.x + 16, th.y + 16, CELL - 32, CELL - 32);
}

function drawHighlights() {
    if (selected) {
        const { x, y } = cellRect(selected.c, selected.r);
        ctx.strokeStyle = CLR.select;
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
    }
    for (const m of highlight) {
        const { x, y } = cellRect(m.c, m.r);
        ctx.fillStyle = CLR.moveDot;
        ctx.beginPath();
        ctx.arc(x + CELL / 2, y + CELL / 2, 10, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawPiece(c, r, piece) {
    const { x, y } = cellRect(c, r);
    const cx = x + CELL / 2, cy = y + CELL / 2, rad = CELL * 0.32;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    if (piece === ATTACKER) {
        ctx.fillStyle = CLR.attacker;
        ctx.strokeStyle = CLR.attackerEdge;
    } else if (piece === DEFENDER) {
        ctx.fillStyle = CLR.defender;
        ctx.strokeStyle = CLR.defenderEdge;
    } else {
        ctx.fillStyle = CLR.king;
        ctx.strokeStyle = CLR.kingEdge;
    }
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.stroke();
    if (piece === KING) {
        // A small crown ring so the King reads at a glance.
        ctx.strokeStyle = CLR.kingEdge;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, rad * 0.5, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBoard();
    drawHighlights();
    if (board) {
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++)
                if (board[r][c] !== EMPTY) drawPiece(c, r, board[r][c]);
    }
}

// --- Status / overlay -------------------------------------------------------
function syncStatus() {
    if (state === 'defenders-win') {
        statusEl.innerHTML = '<strong>The King escapes — Defenders win!</strong>';
    } else if (state === 'attackers-win') {
        statusEl.innerHTML = '<strong>The King is captured — Attackers win!</strong>';
    } else if (turn === 'attackers') {
        statusEl.textContent = 'Attackers (AI) are thinking…';
    } else {
        statusEl.textContent = 'Your move — Defenders';
    }
}

function showOverlay(title, sub) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}
function hideOverlay() {
    overlay.classList.remove('visible');
}

// --- Turn orchestration (UI) ------------------------------------------------
function refresh() {
    render();
    syncStatus();
    if (state === 'defenders-win') {
        showOverlay('Victory!', 'Your King reached a corner refuge. Play again?');
    } else if (state === 'attackers-win') {
        showOverlay('Defeat', 'The Attackers surrounded your King. Try again?');
    }
}

function runAiTurn() {
    if (state !== 'playing' || turn !== 'attackers' || aiPending) return;
    aiPending = true;
    syncStatus();
    setTimeout(() => {
        aiMove();
        aiPending = false;
        refresh();
    }, 350);
}

function startGame() {
    newGame();
    hideOverlay();
    refresh();
    runAiTurn(); // attackers move first
}

// --- Input ------------------------------------------------------------------
function onCanvasClick(e) {
    if (state !== 'playing' || turn !== 'defenders' || aiPending) return;
    const rect = canvas.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left) / (rect.width / SIZE));
    const r = Math.floor((e.clientY - rect.top) / (rect.height / SIZE));
    if (!inBounds(c, r)) return;

    // Clicking a highlighted destination moves the selected piece.
    if (selected && highlight.some(m => m.c === c && m.r === r)) {
        move(selected.c, selected.r, c, r);
        selected = null;
        highlight = [];
        refresh();
        runAiTurn();
        return;
    }

    // Otherwise (re)select one of our own pieces.
    if (sideOf(board[r][c]) === 'defenders') {
        selected = { c, r };
        highlight = legalMovesFrom(c, r);
    } else {
        selected = null;
        highlight = [];
    }
    render();
}

canvas.addEventListener('click', onCanvasClick);
btnStart.addEventListener('click', startGame);

// --- Boot -------------------------------------------------------------------
newGame();
render();
syncStatus();
