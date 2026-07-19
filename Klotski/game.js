// ---------------------------------------------------------------------------
// Klotski — the classic Huarong Pass ("Across the Board") sliding-block puzzle
// ---------------------------------------------------------------------------

const GRID_W = 4;                // columns
const GRID_H = 5;                // rows
const CELL = 100;                // pixels per cell (4*100=400, 5*100=500)

// The exit gap: the big 2×2 block is solved once its top-left reaches here.
const GOAL_R = 3, GOAL_C = 1;

// The canonical "Across the Board" starting layout. Each piece:
//   { id, r, c, w, h }  — top-left cell and size in cells.
const INITIAL_LAYOUT = [
    { id: 'cao',  r: 0, c: 1, w: 2, h: 2 },   // the big 2×2 block (the goal)
    { id: 'g1',   r: 0, c: 0, w: 1, h: 2 },   // vertical generals
    { id: 'g2',   r: 0, c: 3, w: 1, h: 2 },
    { id: 'g3',   r: 2, c: 0, w: 1, h: 2 },
    { id: 'g4',   r: 2, c: 3, w: 1, h: 2 },
    { id: 'guan', r: 2, c: 1, w: 2, h: 1 },   // horizontal block
    { id: 's1',   r: 3, c: 1, w: 1, h: 1 },   // single soldiers
    { id: 's2',   r: 3, c: 2, w: 1, h: 1 },
    { id: 's3',   r: 4, c: 0, w: 1, h: 1 },
    { id: 's4',   r: 4, c: 3, w: 1, h: 1 },
];

// The four orthogonal single-cell slide directions [dr, dc].
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const movesEl = document.getElementById('moves');
const bestEl = document.getElementById('best');
const statusEl = document.getElementById('status');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- Colours: one family per shape ---
const CLR = {
    tray: '#2a1d12',
    grid: 'rgba(255, 240, 210, 0.05)',
    exit: 'rgba(240, 194, 123, 0.16)',
    exitEdge: 'rgba(240, 194, 123, 0.55)',
    select: '#fff2cf',
    text: '#20140a',
};

// Fill / edge colours keyed by piece id (grouped by shape).
function pieceColors(p) {
    if (p.id === 'cao') return { top: '#e8654e', bot: '#b83a2c', edge: '#7d2418' };
    if (p.w === 2 && p.h === 1) return { top: '#e8b94e', bot: '#c8922a', edge: '#8a611a' }; // horizontal
    if (p.h === 2) return { top: '#5aa9d6', bot: '#3577a8', edge: '#204d70' };               // vertical
    return { top: '#7fc88a', bot: '#4e9a5f', edge: '#2f6b3d' };                              // single
}

// --- State ---
let pieces;                 // array of live piece objects
let state;                  // 'idle' | 'playing' | 'won'
let moveCount;              // slides made this attempt
let best;                   // fewest moves ever (0 = no record)
let selected;              // id of the selected piece, or null

// ---------------------------------------------------------------------------
// Piece / board helpers
// ---------------------------------------------------------------------------
function pieceById(id) {
    return pieces.find(p => p.id === id) || null;
}

// All cells covered by a piece.
function cellsOf(p) {
    const out = [];
    for (let dr = 0; dr < p.h; dr++)
        for (let dc = 0; dc < p.w; dc++)
            out.push({ r: p.r + dr, c: p.c + dc });
    return out;
}

function inBounds(r, c) {
    return r >= 0 && r < GRID_H && c >= 0 && c < GRID_W;
}

// The piece occupying (r,c), or null if empty / out of bounds.
function pieceAt(r, c) {
    if (!inBounds(r, c)) return null;
    for (const p of pieces)
        if (r >= p.r && r < p.r + p.h && c >= p.c && c < p.c + p.w) return p;
    return null;
}

function isEmpty(r, c) {
    return inBounds(r, c) && pieceAt(r, c) === null;
}

// Can piece `id` slide one cell by (dr, dc)? (dr,dc must be a unit direction.)
function canMove(id, dr, dc) {
    const p = pieceById(id);
    if (!p) return false;
    if (Math.abs(dr) + Math.abs(dc) !== 1) return false;
    for (const cell of cellsOf(p)) {
        const nr = cell.r + dr, nc = cell.c + dc;
        if (!inBounds(nr, nc)) return false;
        const occ = pieceAt(nr, nc);
        if (occ && occ.id !== id) return false; // blocked by a different piece
    }
    return true;
}

// Apply a single-cell slide. Returns true if it happened.
function movePiece(id, dr, dc) {
    if (!canMove(id, dr, dc)) return false;
    const p = pieceById(id);
    p.r += dr;
    p.c += dc;
    moveCount++;
    updateHud();
    draw();
    checkWin();
    return true;
}

function isSolved() {
    const b = pieceById('cao');
    return !!b && b.r === GOAL_R && b.c === GOAL_C;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------
function selectPiece(id) {
    selected = id;
    draw();
}

// Slide the currently selected piece by a unit direction (arrow keys).
function moveDir(dr, dc) {
    if (state !== 'playing' || !selected) return false;
    return movePiece(selected, dr, dc);
}

function handleClick(r, c) {
    if (state !== 'playing' || !inBounds(r, c)) return;

    const p = pieceAt(r, c);
    if (p) {                       // clicked a block -> select it
        selectPiece(p.id);
        updateHud();
        return;
    }

    // Clicked an empty cell: slide the selected piece here if it is one
    // orthogonal step away.
    if (selected) {
        for (const [dr, dc] of DIRS) {
            if (!canMove(selected, dr, dc)) continue;
            const sel = pieceById(selected);
            const lands = cellsOf(sel).some(
                cell => cell.r + dr === r && cell.c + dc === c
            );
            if (lands) { movePiece(selected, dr, dc); return; }
        }
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function resetBoard() {
    pieces = INITIAL_LAYOUT.map(p => ({ ...p }));
    selected = null;
    moveCount = 0;
}

function startGame() {
    resetBoard();
    state = 'playing';
    overlay.classList.remove('visible');
    updateHud();
    draw();
}

function checkWin() {
    if (state === 'playing' && isSolved()) winGame();
    else if (isSolved()) { state = 'won'; showWin(); } // allow direct calls in any state
}

function winGame() {
    state = 'won';
    if (best === 0 || moveCount < best) {
        best = moveCount;
        localStorage.setItem('klotski-best', String(best));
    }
    showWin();
}

function showWin() {
    overlayTitle.textContent = 'Solved!';
    overlayScore.textContent = `Freed the block in ${moveCount} move${moveCount === 1 ? '' : 's'}`;
    overlaySub.textContent = 'Nicely done. Play again to beat your best.';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    updateHud();
    draw();
}

function updateHud() {
    movesEl.textContent = moveCount;
    bestEl.textContent = best > 0 ? String(best) : '–';
    if (state === 'playing') {
        statusEl.textContent = selected
            ? 'Slide it with the arrow keys (or click an empty cell)'
            : 'Click a block to pick it up';
    } else if (state === 'won') {
        statusEl.textContent = 'Solved! 🎉';
    } else {
        statusEl.textContent = 'Slide the 2×2 block to the exit gap at the bottom';
    }
}

// ---------------------------------------------------------------------------
// Rendering
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

function drawPiece(p) {
    const pad = 6;
    const x = p.c * CELL + pad;
    const y = p.r * CELL + pad;
    const w = p.w * CELL - pad * 2;
    const h = p.h * CELL - pad * 2;
    const col = pieceColors(p);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(x + 3, y + 4, w, h, 12);
    ctx.fill();

    // body
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, col.top);
    grad.addColorStop(1, col.bot);
    ctx.fillStyle = grad;
    roundRect(x, y, w, h, 12);
    ctx.fill();

    // edge
    ctx.lineWidth = 2;
    ctx.strokeStyle = col.edge;
    roundRect(x, y, w, h, 12);
    ctx.stroke();

    // selection ring
    if (p.id === selected) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = CLR.select;
        roundRect(x - 1, y - 1, w + 2, h + 2, 13);
        ctx.stroke();
    }

    // label the goal block so its purpose is clear
    if (p.id === 'cao') {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 34px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', x + w / 2, y + h / 2);
    }
}

function draw() {
    ctx.fillStyle = CLR.tray;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // grid lines
    ctx.strokeStyle = CLR.grid;
    ctx.lineWidth = 1;
    for (let c = 1; c < GRID_W; c++) {
        ctx.beginPath();
        ctx.moveTo(c * CELL, 0);
        ctx.lineTo(c * CELL, canvas.height);
        ctx.stroke();
    }
    for (let r = 1; r < GRID_H; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * CELL);
        ctx.lineTo(canvas.width, r * CELL);
        ctx.stroke();
    }

    // exit gap marker at the bottom-centre (2 cells wide)
    ctx.fillStyle = CLR.exit;
    ctx.fillRect(GOAL_C * CELL, canvas.height - 8, 2 * CELL, 8);
    ctx.fillStyle = CLR.exitEdge;
    ctx.fillRect(GOAL_C * CELL, canvas.height - 4, 2 * CELL, 4);

    if (!pieces) return;
    for (const p of pieces) drawPiece(p);
}

// ---------------------------------------------------------------------------
// Input wiring
// ---------------------------------------------------------------------------
canvas.addEventListener('click', e => {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    handleClick(r, c);
});

const ARROWS = {
    ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
};

document.addEventListener('keydown', e => {
    if (state === 'idle' || state === 'won') {
        startGame();
        e.preventDefault();
        return;
    }
    if (ARROWS[e.key]) {
        moveDir(ARROWS[e.key][0], ARROWS[e.key][1]);
        e.preventDefault();
    }
});

btnStart.addEventListener('click', startGame);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
best = parseInt(localStorage.getItem('klotski-best') || '0', 10);
if (!Number.isFinite(best) || best < 0) best = 0;
state = 'idle';
resetBoard();
updateHud();
draw();
