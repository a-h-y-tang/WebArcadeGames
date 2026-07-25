// ---------------------------------------------------------------------------
// Hex — the classic connection game (Piet Hein 1942 / John Nash 1948) on an
// 11×11 rhombus of hexagons, drawn with the HTML5 Canvas 2D API.
//
// Red owns the top & bottom edges and wins by linking them; Blue owns the left
// & right edges. Players alternate; the game resolves the instant one side
// completes a chain. The rules are small pure functions (neighbors / place /
// connects / checkWin) over a global integer board, kept separate from
// rendering, so the Playwright suite can build an exact position and assert the
// outcome with zero timing dependence — Hex has no animation-driven logic.
// ---------------------------------------------------------------------------

const N = 11;                 // board is N×N
const HEX = 24;               // hexagon circumradius (centre → corner), pixels
const SQ3 = Math.sqrt(3);

// Axial → pixel layout for pointy-top hexes:
//   x = size·√3·(c + r/2),  y = size·1.5·r
const STEP_X = HEX * SQ3;                       // horizontal step per column
const STEP_Y = HEX * 1.5;                       // vertical step per row
const PAD_X  = STEP_X * 0.5 + 26;               // outer margin (room for edges)
const PAD_Y  = HEX + 26;
const W = Math.round(STEP_X * ((N - 1) + (N - 1) / 2) + PAD_X * 2);
const H = Math.round(STEP_Y * (N - 1) + PAD_Y * 2);

const CLR = {
    bg:       '#060912',
    cellFill: '#111a2e',
    cellEdge: '#1f2c48',
    red:      '#ff5470',
    redEdge:  '#ff9db0',
    blue:     '#38bdf8',
    blueEdge: '#a5e4ff',
    hover:    'rgba(192,132,252,0.25)',
};

// --- DOM -------------------------------------------------------------------
const canvas       = document.getElementById('canvas');
const ctx          = canvas.getContext('2d');
const turnEl        = document.getElementById('turn');
const movesEl       = document.getElementById('moves');
const overlay       = document.getElementById('overlay');
const overlayTitle  = document.getElementById('overlay-title');
const overlayScore  = document.getElementById('overlay-score');
const overlaySub    = document.getElementById('overlay-sub');
const btnStart      = document.getElementById('btn-start');
const btnSwap       = document.getElementById('btn-swap');

canvas.width = W;
canvas.height = H;

// --- State (var so tests can reach it as window.*) -------------------------
var board;                 // N×N of 0 empty / 1 red / 2 blue
var current;               // 1 (red) or 2 (blue) to move
var state;                 // 'idle' | 'playing' | 'won'
var winner;                // 0 unresolved, else 1 or 2
var moveCount;             // stones placed
var swapAvailable;         // pie rule: blue may swap red's opening stone
var hover = null;          // {r,c} under the cursor, for highlight only

// --- Board helpers ---------------------------------------------------------
function emptyBoard() {
    return Array.from({ length: N }, () => Array(N).fill(0));
}

function inBounds(r, c) {
    return r >= 0 && r < N && c >= 0 && c < N;
}

// The six hex neighbours of (r, c), clipped to the board. The two "extra"
// diagonals — up-right (r-1,c+1) and down-left (r+1,c-1) — are what make this a
// hexagonal lattice rather than a square grid.
function neighbors(r, c) {
    const deltas = [
        [0, -1], [0, 1],
        [-1, 0], [1, 0],
        [-1, 1], [1, -1],
    ];
    const out = [];
    for (const [dr, dc] of deltas) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc)) out.push([nr, nc]);
    }
    return out;
}

// --- Connection detection --------------------------------------------------
// Flood fill from a player's starting edge; true when it reaches the far edge.
//   Red  (1): top row  → bottom row
//   Blue (2): left col → right col
function connects(player) {
    const seen = Array.from({ length: N }, () => Array(N).fill(false));
    const stack = [];

    if (player === 1) {
        for (let c = 0; c < N; c++)
            if (board[0][c] === 1) { stack.push([0, c]); seen[0][c] = true; }
    } else {
        for (let r = 0; r < N; r++)
            if (board[r][0] === 2) { stack.push([r, 0]); seen[r][0] = true; }
    }

    while (stack.length) {
        const [r, c] = stack.pop();
        if (player === 1 && r === N - 1) return true;
        if (player === 2 && c === N - 1) return true;
        for (const [nr, nc] of neighbors(r, c)) {
            if (!seen[nr][nc] && board[nr][nc] === player) {
                seen[nr][nc] = true;
                stack.push([nr, nc]);
            }
        }
    }
    return false;
}

// Resolve state/winner from the board (used by the player action and by tests).
function checkWin() {
    if (connects(1)) { winner = 1; state = 'won'; }
    else if (connects(2)) { winner = 2; state = 'won'; }
    if (state === 'won') finishGame();
    return winner;
}

// --- Player actions --------------------------------------------------------
function place(r, c) {
    if (state !== 'playing') return;
    if (!inBounds(r, c)) return;
    if (board[r][c] !== 0) return;

    board[r][c] = current;
    moveCount++;

    if (connects(current)) {
        winner = current;
        state = 'won';
        swapAvailable = false;
        finishGame();
        return;
    }

    current = 3 - current;
    swapAvailable = (moveCount === 1); // blue may now swap red's opener
    updateHud();
    draw();
}

// Pie (swap) rule: instead of replying to red's first stone, blue takes it over
// — the stone becomes blue and the turn passes back to red.
function swap() {
    if (state !== 'playing' || !swapAvailable) return;
    for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++)
            if (board[r][c] === 1) board[r][c] = 2;
    current = 1;
    swapAvailable = false;
    updateHud();
    draw();
}

// --- Lifecycle -------------------------------------------------------------
function reset() {
    board = emptyBoard();
    current = 1;
    moveCount = 0;
    winner = 0;
    swapAvailable = false;
    state = 'playing';
}

function beginGame() {
    reset();
    overlay.classList.remove('visible');
    btnStart.blur();
    updateHud();
    draw();
}

function finishGame() {
    updateHud();
    draw();
    const name = winner === 1 ? 'Red' : 'Blue';
    overlayTitle.textContent = `${name} wins!`;
    overlayScore.textContent = `${moveCount} stone${moveCount === 1 ? '' : 's'} played`;
    overlaySub.textContent = `${name} linked their two sides. Press R or the button to play again.`;
    btnStart.textContent = 'New Game';
    overlay.classList.add('visible');
}

function updateHud() {
    const name = current === 1 ? 'Red' : 'Blue';
    turnEl.textContent = name;
    turnEl.className = current === 1 ? 'turn-red' : 'turn-blue';
    movesEl.textContent = moveCount;
    btnSwap.classList.toggle('hidden', !swapAvailable);
}

// --- Geometry --------------------------------------------------------------
function cellCenter(r, c) {
    return {
        x: PAD_X + STEP_X * (c + r / 2),
        y: PAD_Y + STEP_Y * r,
    };
}

// Nearest hex centre to a pixel (Voronoi of a perfect hex grid = the hexes
// themselves), rejecting clicks that miss every cell.
function cellFromPoint(px, py) {
    let best = null, bestD = Infinity;
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            const { x, y } = cellCenter(r, c);
            const d = (x - px) * (x - px) + (y - py) * (y - py);
            if (d < bestD) { bestD = d; best = { r, c }; }
        }
    }
    return bestD <= (HEX + 1) * (HEX + 1) ? best : null;
}

// --- Rendering -------------------------------------------------------------
function hexPath(cx, cy, radius) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = Math.PI / 180 * (60 * i - 90); // pointy top
        const x = cx + radius * Math.cos(a);
        const y = cy + radius * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
}

function drawStone(cx, cy, player) {
    const base = player === 1 ? CLR.red : CLR.blue;
    const edge = player === 1 ? CLR.redEdge : CLR.blueEdge;
    const rad = HEX * 0.62;
    const grad = ctx.createRadialGradient(
        cx - rad * 0.3, cy - rad * 0.4, rad * 0.15,
        cx, cy, rad);
    grad.addColorStop(0, edge);
    grad.addColorStop(1, base);
    ctx.shadowColor = base;
    ctx.shadowBlur = 14;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
}

// The four coloured board edges: red top/bottom, blue left/right.
function drawEdges() {
    const tl = cellCenter(0, 0);
    const tr = cellCenter(0, N - 1);
    const br = cellCenter(N - 1, N - 1);
    const bl = cellCenter(N - 1, 0);
    const off = HEX * 0.95;

    ctx.lineWidth = 7;
    ctx.lineCap = 'round';

    // top (red)
    ctx.strokeStyle = CLR.red;
    line(tl.x - off, tl.y - off, tr.x + off, tr.y - off);
    // bottom (red)
    line(bl.x - off, bl.y + off, br.x + off, br.y + off);
    // left (blue)
    ctx.strokeStyle = CLR.blue;
    line(tl.x - off, tl.y - off, bl.x - off, bl.y + off);
    // right (blue)
    line(tr.x + off, tr.y - off, br.x + off, br.y + off);
}

function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, W, H);

    if (board) drawEdges();

    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            const { x, y } = cellCenter(r, c);
            hexPath(x, y, HEX - 1.5);
            ctx.fillStyle = CLR.cellFill;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = CLR.cellEdge;
            ctx.stroke();

            if (hover && hover.r === r && hover.c === c &&
                board && board[r][c] === 0 && state === 'playing') {
                ctx.fillStyle = CLR.hover;
                ctx.fill();
            }

            if (board && board[r][c] !== 0) drawStone(x, y, board[r][c]);
        }
    }
}

// --- Input -----------------------------------------------------------------
canvas.addEventListener('click', e => {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const cell = cellFromPoint(x, y);
    if (cell) place(cell.r, cell.c);
});

canvas.addEventListener('mousemove', e => {
    if (state !== 'playing') { if (hover) { hover = null; draw(); } return; }
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const cell = cellFromPoint(x, y);
    const changed = (cell ? cell.r + ',' + cell.c : '') !==
                    (hover ? hover.r + ',' + hover.c : '');
    if (changed) { hover = cell; draw(); }
});

canvas.addEventListener('mouseleave', () => {
    if (hover) { hover = null; draw(); }
});

document.addEventListener('keydown', e => {
    if (state === 'idle') { beginGame(); return; }
    if (state === 'won')  { beginGame(); return; }
    if (e.key === 'r' || e.key === 'R') beginGame();
});

btnStart.addEventListener('click', () => { beginGame(); });
btnSwap.addEventListener('click', () => { swap(); });

// --- Init ------------------------------------------------------------------
board = emptyBoard();
current = 1;
moveCount = 0;
winner = 0;
swapAvailable = false;
state = 'idle';
updateHud();
draw();
