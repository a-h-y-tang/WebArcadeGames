// ---------------------------------------------------------------------------
// Snakes and Ladders — race the computer to square 100
// ---------------------------------------------------------------------------
// Squares 1..100 on a 10x10 boustrophedon board; square 0 is the off-board
// start. Player 0 = You (blue), player 1 = Computer (red).
//
// Written as a single classic (non-module) script so state and logic are
// reachable as plain globals from the Playwright tests, matching the repo's
// other games. The move logic is pure and deterministic; `forcedRolls` lets
// tests script exact games with no randomness.
// ---------------------------------------------------------------------------

const BOARD = 10;             // 10x10
const CELL = 50;              // px per square (10 * 50 = 500)
const GOAL = 100;

// Standard Milton-Bradley layout.
const LADDERS = {
    1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100,
};
const SNAKES = {
    16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78,
};
const JUMPS = Object.assign({}, LADDERS, SNAKES);

const COLORS = {
    you: '#3d8bff',
    cpu: '#ff5a5a',
    ladder: '#3fb06a',
    snake: '#c65cff',
    cellA: '#1b2138',
    cellB: '#232c49',
    text: '#8f9dc4',
};

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const turnEl = document.getElementById('turn');
const lastRollEl = document.getElementById('lastroll');
const posYouEl = document.getElementById('pos-you');
const posCpuEl = document.getElementById('pos-cpu');
const bestEl = document.getElementById('best');
const statusEl = document.getElementById('status');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnRoll = document.getElementById('btn-roll');

const CPU_DELAY = 700;        // ms before the computer takes its turn

// --- State ---
let positions;                // [youSquare, cpuSquare]
let currentPlayer;            // 0 = you, 1 = cpu
let phase;                    // 'idle' | 'playing' | 'over'
let winner;                   // null | 0 | 1
let lastRoll;                 // last die value shown
let wins;                     // total games won by the human (persisted)

// Test/determinism seam: when non-empty, rollDie() shifts from this queue.
let forcedRolls = [];

// ---------------------------------------------------------------------------
// Pure game logic
// ---------------------------------------------------------------------------
function applyJump(pos) {
    return JUMPS[pos] !== undefined ? JUMPS[pos] : pos;
}

// Final square after moving `roll` from `pos`. You must land exactly on 100;
// overshooting forfeits the move. A ladder/snake on the landing square is
// then applied once.
function computeMove(pos, roll) {
    const raw = pos + roll;
    if (raw > GOAL) return pos;      // overshoot — stay put
    if (raw === GOAL) return GOAL;   // exact win (no jump on 100)
    return applyJump(raw);
}

function rollDie() {
    if (forcedRolls.length) return forcedRolls.shift();
    return 1 + Math.floor(Math.random() * 6);
}

// One full turn for the current player.
function takeTurn() {
    if (phase !== 'playing') return;

    const roll = rollDie();
    lastRoll = roll;
    const p = currentPlayer;
    positions[p] = computeMove(positions[p], roll);

    if (positions[p] === GOAL) {
        winner = p;
        phase = 'over';
        if (p === 0) {
            wins++;
            localStorage.setItem('snakes-and-ladders-wins', wins);
        }
        updateHud();
        showResult();
        draw();
        return;
    }

    currentPlayer = 1 - currentPlayer;
    updateHud();
    draw();
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------
function startGame() {
    positions = [0, 0];
    currentPlayer = 0;
    phase = 'playing';
    winner = null;
    lastRoll = 0;
    overlay.classList.remove('visible');
    updateHud();
    draw();
}

function humanRoll() {
    if (phase !== 'playing' || currentPlayer !== 0) return;
    takeTurn();
    scheduleCpu();
}

function scheduleCpu() {
    if (phase === 'playing' && currentPlayer === 1) {
        setTimeout(() => {
            if (phase === 'playing' && currentPlayer === 1) {
                takeTurn();
                scheduleCpu();
            }
        }, CPU_DELAY);
    }
}

function showResult() {
    overlayTitle.textContent = winner === 0 ? 'You win! 🎉' : 'Computer wins';
    overlayScore.textContent = winner === 0
        ? 'You reached square 100 first.'
        : 'The computer reached square 100 first.';
    overlaySub.textContent = 'Click Play Again for a rematch.';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function updateHud() {
    turnEl.textContent = phase === 'over'
        ? '—'
        : (currentPlayer === 0 ? 'You' : 'Computer');
    lastRollEl.textContent = lastRoll ? String(lastRoll) : '–';
    posYouEl.textContent = positions[0];
    posCpuEl.textContent = positions[1];
    bestEl.textContent = wins;

    if (phase === 'playing') {
        statusEl.textContent = currentPlayer === 0
            ? 'Your turn — press Roll (or Space).'
            : 'Computer is rolling…';
    } else if (phase === 'over') {
        statusEl.textContent = winner === 0 ? 'You won!' : 'Computer won.';
    } else {
        statusEl.textContent = 'Press Roll (or Space) on your turn.';
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
// Boustrophedon: square 1 bottom-left, first row left→right, next right→left.
function cellCenter(n) {
    if (n <= 0) return { x: 14, y: 500 - 14 };  // off-board start pad
    const idx = n - 1;
    const row = Math.floor(idx / BOARD);          // 0 at bottom
    let col = idx % BOARD;
    if (row % 2 === 1) col = BOARD - 1 - col;      // reverse odd rows
    const x = col * CELL + CELL / 2;
    const y = (BOARD - 1 - row) * CELL + CELL / 2;
    return { x, y };
}

function drawBoard() {
    for (let n = 1; n <= GOAL; n++) {
        const idx = n - 1;
        const row = Math.floor(idx / BOARD);
        let col = idx % BOARD;
        if (row % 2 === 1) col = BOARD - 1 - col;
        const x = col * CELL;
        const y = (BOARD - 1 - row) * CELL;
        ctx.fillStyle = (row + col) % 2 === 0 ? COLORS.cellA : COLORS.cellB;
        ctx.fillRect(x, y, CELL, CELL);
        if (n === GOAL) {
            ctx.fillStyle = 'rgba(255, 215, 106, 0.22)';
            ctx.fillRect(x, y, CELL, CELL);
        }
        ctx.fillStyle = COLORS.text;
        ctx.font = '11px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(String(n), x + 4, y + 4);
    }
}

function drawLadder(from, to) {
    const a = cellCenter(from), b = cellCenter(to);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;   // unit normal
    const w = 7;                            // half rail spacing
    ctx.strokeStyle = COLORS.ladder;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(a.x + nx * w * s, a.y + ny * w * s);
        ctx.lineTo(b.x + nx * w * s, b.y + ny * w * s);
        ctx.stroke();
    }
    const rungs = Math.max(2, Math.round(len / 26));
    ctx.lineWidth = 2;
    for (let i = 1; i < rungs; i++) {
        const t = i / rungs;
        const cx = a.x + dx * t, cy = a.y + dy * t;
        ctx.beginPath();
        ctx.moveTo(cx + nx * w, cy + ny * w);
        ctx.lineTo(cx - nx * w, cy - ny * w);
        ctx.stroke();
    }
}

function drawSnake(from, to) {
    const a = cellCenter(from), b = cellCenter(to);
    ctx.strokeStyle = COLORS.snake;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const segs = 24;
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const wobble = Math.sin(t * Math.PI * 3) * 9;
        const x = a.x + dx * t + nx * wobble;
        const y = a.y + dy * t + ny * wobble;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Head at the snake mouth (the high square `from`).
    ctx.fillStyle = COLORS.snake;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#12172a';
    ctx.beginPath();
    ctx.arc(a.x - 3, a.y - 2, 1.6, 0, Math.PI * 2);
    ctx.arc(a.x + 3, a.y - 2, 1.6, 0, Math.PI * 2);
    ctx.fill();
}

function drawToken(player) {
    const { x, y } = cellCenter(positions[player]);
    const off = player === 0 ? -9 : 9;
    ctx.fillStyle = player === 0 ? COLORS.you : COLORS.cpu;
    ctx.strokeStyle = '#0b0e18';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + off, y + 8, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBoard();

    for (const [from, to] of Object.entries(LADDERS)) drawLadder(+from, to);
    for (const [from, to] of Object.entries(SNAKES)) drawSnake(+from, to);

    if (positions) {
        // Draw the trailing player first so the leader sits on top.
        const order = positions[0] <= positions[1] ? [0, 1] : [1, 0];
        for (const p of order) drawToken(p);
    }
}

// ---------------------------------------------------------------------------
// Input wiring
// ---------------------------------------------------------------------------
btnRoll.addEventListener('click', () => {
    if (phase === 'idle' || phase === 'over') startGame();
    else humanRoll();
});

btnStart.addEventListener('click', startGame);

document.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') {
        if (phase === 'idle' || phase === 'over') startGame();
        else humanRoll();
        e.preventDefault();
    }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
wins = parseInt(localStorage.getItem('snakes-and-ladders-wins') || '0', 10);
positions = [0, 0];
currentPlayer = 0;
phase = 'idle';
winner = null;
lastRoll = 0;
updateHud();
draw();
