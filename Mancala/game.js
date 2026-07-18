// =======================================================================
// Mancala (Kalah rules) — you (player 1, bottom row) vs. a simple CPU.
//
// Plain (non-module) script so its top-level bindings are reachable from
// the Playwright suite via page.evaluate. All game rules are pure and
// deterministic: applySow() sows stones into a given board array, and
// sow() wraps it with turn-passing and end-of-game handling. Tests set the
// `board` array and `currentPlayer` directly, call sow()/aiMove(), and
// assert — no timers, no randomness.
//
// Board indices (counter-clockwise loop):
//     12 11 10  9  8  7        <- CPU pits (player 2)
//  13                    6     <- stores: 13 = CPU, 6 = you
//      0  1  2  3  4  5        <- your pits (player 1)
// =======================================================================

const P1_STORE = 6;
const P2_STORE = 13;
const START_STONES = 4;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const p1StoreEl = document.getElementById('p1-store');
const p2StoreEl = document.getElementById('p2-store');
const turnEl = document.getElementById('turn');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnPlay = document.getElementById('btn-play');
const btnRestart = document.getElementById('btn-restart');

// --- State ---
let board = [];
let currentPlayer = 1; // 1 = you, 2 = CPU
let state = 'playing'; // 'playing' | 'over'
let aiTimer = null;

// -----------------------------------------------------------------------
// Board helpers.
// -----------------------------------------------------------------------
function ownStore(player) {
    return player === 1 ? P1_STORE : P2_STORE;
}
function opponentStore(player) {
    return player === 1 ? P2_STORE : P1_STORE;
}
function isOwnPit(player, i) {
    return player === 1 ? (i >= 0 && i <= 5) : (i >= 7 && i <= 12);
}
function oppositePit(i) {
    return 12 - i;
}
function isSideEmpty(player) {
    const pits = player === 1 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12];
    return pits.every((i) => board[i] === 0);
}
function legalMove(pit) {
    return state === 'playing' && isOwnPit(currentPlayer, pit) && board[pit] > 0;
}

// -----------------------------------------------------------------------
// Core sowing — mutates the supplied board array, returns whether the last
// stone earned an extra turn. Handles skipping the opponent's store and
// same-side captures.
// -----------------------------------------------------------------------
function applySow(bd, pit, player) {
    let stones = bd[pit];
    bd[pit] = 0;
    let idx = pit;
    const skip = opponentStore(player);
    while (stones > 0) {
        idx = (idx + 1) % 14;
        if (idx === skip) continue;
        bd[idx] += 1;
        stones -= 1;
    }

    // Capture: last stone drops into a previously-empty pit on your own side.
    if (isOwnPit(player, idx) && bd[idx] === 1) {
        const opp = oppositePit(idx);
        if (bd[opp] > 0) {
            bd[ownStore(player)] += bd[opp] + 1;
            bd[opp] = 0;
            bd[idx] = 0;
        }
    }

    return { last: idx, extraTurn: idx === ownStore(player) };
}

// -----------------------------------------------------------------------
// Sweep every remaining pit stone into its owner's store (end of game).
// -----------------------------------------------------------------------
function collectRemaining() {
    for (let i = 0; i <= 5; i++) { board[P1_STORE] += board[i]; board[i] = 0; }
    for (let i = 7; i <= 12; i++) { board[P2_STORE] += board[i]; board[i] = 0; }
}

function winner() {
    if (board[P1_STORE] > board[P2_STORE]) return 1;
    if (board[P2_STORE] > board[P1_STORE]) return 2;
    return 0;
}

// -----------------------------------------------------------------------
// A full move: validate, sow, resolve end-of-game, pass the turn.
// Returns true if the move was legal and played.
// -----------------------------------------------------------------------
function sow(pit) {
    if (!legalMove(pit)) return false;
    const player = currentPlayer;
    const { extraTurn } = applySow(board, pit, player);

    if (isSideEmpty(1) || isSideEmpty(2)) {
        collectRemaining();
        state = 'over';
    } else if (!extraTurn) {
        currentPlayer = player === 1 ? 2 : 1;
    }

    updateUI();
    return true;
}

// -----------------------------------------------------------------------
// CPU opponent (player 2). Greedy one-ply look-ahead: maximise the store
// gain, favour moves that grant another turn, break ties toward the pit
// nearest the store. Plays the chosen pit and returns its index.
// -----------------------------------------------------------------------
function aiMove() {
    let bestPit = -1;
    let bestScore = -Infinity;
    for (let pit = 12; pit >= 7; pit--) {
        if (board[pit] === 0) continue;
        const copy = board.slice();
        const before = copy[P2_STORE];
        const { extraTurn } = applySow(copy, pit, 2);
        let score = (copy[P2_STORE] - before) + (extraTurn ? 2 : 0);
        if (score > bestScore) {
            bestScore = score;
            bestPit = pit;
        }
    }
    if (bestPit === -1) return -1;
    // Force the move regardless of whose turn the caller thinks it is.
    currentPlayer = 2;
    sow(bestPit);
    return bestPit;
}

// -----------------------------------------------------------------------
// Game lifecycle & the CPU turn loop (driven by timers for UX only).
// -----------------------------------------------------------------------
function newGame() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    board = [
        START_STONES, START_STONES, START_STONES, START_STONES, START_STONES, START_STONES, 0,
        START_STONES, START_STONES, START_STONES, START_STONES, START_STONES, START_STONES, 0,
    ];
    currentPlayer = 1;
    state = 'playing';
    overlay.classList.remove('visible');
    updateUI();
}

function playHuman(pit) {
    if (state !== 'playing' || currentPlayer !== 1) return;
    if (!sow(pit)) return;
    if (state === 'playing' && currentPlayer === 2) scheduleAi();
}

function scheduleAi() {
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = setTimeout(runAiTurn, 650);
}

function runAiTurn() {
    aiTimer = null;
    if (state !== 'playing' || currentPlayer !== 2) return;
    aiMove();
    if (state === 'playing' && currentPlayer === 2) {
        // Extra turn — keep going after a short beat.
        scheduleAi();
    }
}

// -----------------------------------------------------------------------
// Rendering & geometry.
// -----------------------------------------------------------------------
const PIT_R = 34;
const STORE_W = 88;
const TOP_Y = 96;
const BOT_Y = HEIGHT - 96;
const COL_X = []; // x centres of the six middle columns
(function computeColumns() {
    const left = 20 + STORE_W + 30;
    const right = WIDTH - 20 - STORE_W - 30;
    const span = right - left;
    for (let c = 0; c < 6; c++) COL_X.push(left + (span * (c + 0.5)) / 6);
})();

// Screen centre for each board index (stores included).
function pitCenter(i) {
    if (i === P1_STORE) return { x: WIDTH - 20 - STORE_W / 2, y: HEIGHT / 2 };
    if (i === P2_STORE) return { x: 20 + STORE_W / 2, y: HEIGHT / 2 };
    if (i >= 0 && i <= 5) return { x: COL_X[i], y: BOT_Y };
    return { x: COL_X[12 - i], y: TOP_Y }; // top pits 12..7 map to columns 0..5
}

function drawStones(cx, cy, count, r) {
    ctx.fillStyle = '#f5e9d6';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(count), cx, cy);
    // a scatter of pebble dots around the number
    const dots = Math.min(count, 8);
    for (let k = 0; k < dots; k++) {
        const a = (k / dots) * Math.PI * 2;
        ctx.fillStyle = ['#c86b3c', '#5a8f6a', '#c9a24a', '#7a6bbf'][k % 4];
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * (r - 9), cy + Math.sin(a) * (r - 9), 4.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawPit(i) {
    const { x, y } = pitCenter(i);
    ctx.fillStyle = '#2c2013';
    ctx.beginPath();
    ctx.arc(x, y, PIT_R, 0, Math.PI * 2);
    ctx.fill();
    if (state === 'playing' && legalMove(i)) {
        ctx.strokeStyle = '#9fd7a0';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    drawStones(x, y, board[i], PIT_R);
}

function drawStore(i, label) {
    const { x, y } = pitCenter(i);
    ctx.fillStyle = '#2c2013';
    roundRect(x - STORE_W / 2, 24, STORE_W, HEIGHT - 48, 40);
    ctx.fill();
    ctx.fillStyle = '#f5e9d6';
    ctx.font = 'bold 34px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(board[i]), x, y);
    ctx.font = '13px "Segoe UI", sans-serif';
    ctx.fillStyle = '#a08a6c';
    ctx.fillText(label, x, i === P2_STORE ? 44 : HEIGHT - 44);
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

function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawStore(P2_STORE, 'CPU');
    drawStore(P1_STORE, 'YOU');
    for (let i = 0; i <= 5; i++) drawPit(i);
    for (let i = 7; i <= 12; i++) drawPit(i);
}

// -----------------------------------------------------------------------
// UI sync.
// -----------------------------------------------------------------------
function updateUI() {
    p1StoreEl.textContent = String(board[P1_STORE]);
    p2StoreEl.textContent = String(board[P2_STORE]);
    if (state === 'over') {
        const w = winner();
        turnEl.textContent = 'Game over';
        overlayTitle.textContent = w === 1 ? 'You win!' : w === 2 ? 'CPU wins' : "It's a tie";
        overlaySub.textContent = `You ${board[P1_STORE]}  ·  CPU ${board[P2_STORE]}`;
        overlay.classList.add('visible');
    } else {
        turnEl.textContent = currentPlayer === 1 ? 'Your move' : 'CPU thinking…';
    }
    render();
}

// -----------------------------------------------------------------------
// Input.
// -----------------------------------------------------------------------
function canvasHit(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (WIDTH / rect.width);
    const y = (clientY - rect.top) * (HEIGHT / rect.height);
    for (let i = 0; i <= 5; i++) {
        const c = pitCenter(i);
        if ((x - c.x) ** 2 + (y - c.y) ** 2 <= PIT_R ** 2) return i;
    }
    return -1;
}

canvas.addEventListener('click', (e) => {
    const pit = canvasHit(e.clientX, e.clientY);
    if (pit >= 0) playHuman(pit);
});

window.addEventListener('keydown', (e) => {
    const m = /^Digit([1-6])$/.exec(e.code);
    if (m) {
        playHuman(Number(m[1]) - 1);
        e.preventDefault();
    }
});

btnRestart.addEventListener('click', newGame);
btnPlay.addEventListener('click', newGame);

// -----------------------------------------------------------------------
// Boot.
// -----------------------------------------------------------------------
newGame();
