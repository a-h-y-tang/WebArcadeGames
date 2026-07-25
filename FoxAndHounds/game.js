// ---------------------------------------------------------------------------
// Fox and Hounds — the classic asymmetric blocking game on the dark squares of
// an 8×8 checkerboard, drawn with the HTML5 Canvas 2D API.
//
// One player is the lone Fox; the other commands four Hounds. Hounds move one
// step diagonally FORWARD only (down the board) and try to trap the fox; the fox
// moves one step in ANY diagonal direction and tries to reach the top row. There
// are no captures — the whole game is blocking.
//
// The rules are small pure functions (isDark / legalMovesFrom / hasMoves /
// tryMove / resolveTurn) over global state, kept separate from rendering and free
// of animation timing, so the Playwright suite can build an exact position and
// assert the outcome with zero timing dependence.
// ---------------------------------------------------------------------------

const N = 8;                   // board is N×N
const CELL = 60;               // square size (px)
const PAD = 20;                // board margin (px)
const BOARD = N * CELL;
const SIZE = BOARD + PAD * 2;  // canvas edge

const FOX_START = { r: 7, c: 4 };
const HOUND_STARTS = [{ r: 0, c: 1 }, { r: 0, c: 3 }, { r: 0, c: 5 }, { r: 0, c: 7 }];

const CLR = {
    light:    '#e8d5b0',
    dark:     '#9a6b43',
    darkAlt:  '#8a5f3b',
    fox:      '#ff7a2f',
    foxEdge:  '#ffd0a8',
    hound:    '#e9f1fb',
    houndEdge:'#7fb0e0',
    sel:      '#ffe066',
    move:     'rgba(120, 220, 140, 0.9)',
};

// --- DOM -------------------------------------------------------------------
const canvas       = document.getElementById('canvas');
const ctx          = canvas.getContext('2d');
const turnEl        = document.getElementById('turn');
const overlay       = document.getElementById('overlay');
const overlayTitle  = document.getElementById('overlay-title');
const overlayScore  = document.getElementById('overlay-score');
const btnStart      = document.getElementById('btn-start');

canvas.width = SIZE;
canvas.height = SIZE;

// --- State (var so tests can reach it as window.*) -------------------------
var fox = { r: FOX_START.r, c: FOX_START.c };
var hounds = HOUND_STARTS.map(h => ({ r: h.r, c: h.c }));
var turn = 'fox';          // 'fox' | 'hounds'
var state = 'idle';        // 'idle' | 'playing' | 'fox' | 'hounds'  (last two = winner)
var selected = null;       // {r, c} of the picked-up piece, or null

// ===========================================================================
// Board queries — pure
// ===========================================================================

function inBounds(r, c) {
    return r >= 0 && r < N && c >= 0 && c < N;
}

// Only dark squares — (r + c) odd — are playable.
function isDark(r, c) {
    return (r + c) % 2 === 1;
}

function pieceAt(r, c) {
    if (fox.r === r && fox.c === c) return 'fox';
    for (const h of hounds) if (h.r === r && h.c === c) return 'hound';
    return null;
}

// Diagonal destinations for the piece on (r, c): empty dark squares one step
// away. Hounds may only step forward (down the board); the fox any direction.
function legalMovesFrom(r, c) {
    const who = pieceAt(r, c);
    if (!who) return [];
    const dirs = who === 'fox'
        ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
        : [[1, -1], [1, 1]];               // hounds advance downward only
    const out = [];
    for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc) && isDark(nr, nc) && pieceAt(nr, nc) === null) {
            out.push({ r: nr, c: nc });
        }
    }
    return out;
}

function piecesOf(side) {
    return side === 'fox' ? [fox] : hounds;
}

function hasMoves(side) {
    return piecesOf(side).some(p => legalMovesFrom(p.r, p.c).length > 0);
}

// ===========================================================================
// Turn resolution & moves
// ===========================================================================

// Run at the start of the side-to-move's turn: hounds with no move pass; a fox
// with no move is trapped and the hounds win.
function resolveTurn() {
    if (state !== 'playing') return;
    if (turn === 'hounds' && !hasMoves('hounds')) {
        turn = 'fox';                       // disciplined hounds over-committed — pass
    }
    if (turn === 'fox' && !hasMoves('fox')) {
        state = 'hounds';                   // fox trapped
    }
}

// Validate and apply a move by the side to move. Returns true if it happened.
function tryMove(from, to) {
    if (state !== 'playing') return false;
    const who = pieceAt(from.r, from.c);
    if (who === null) return false;
    if (turn === 'fox' && who !== 'fox') return false;
    if (turn === 'hounds' && who !== 'hound') return false;
    if (!legalMovesFrom(from.r, from.c).some(m => m.r === to.r && m.c === to.c)) {
        return false;
    }

    if (who === 'fox') {
        fox = { r: to.r, c: to.c };
    } else {
        const h = hounds.find(h => h.r === from.r && h.c === from.c);
        h.r = to.r; h.c = to.c;
    }
    selected = null;

    // Fox reaching the top row breaks through and wins immediately.
    if (who === 'fox' && fox.r === 0) {
        state = 'fox';
        render();
        return true;
    }

    turn = (turn === 'fox') ? 'hounds' : 'fox';
    resolveTurn();
    render();
    return true;
}

// ===========================================================================
// Game flow
// ===========================================================================

function startGame() {
    fox = { r: FOX_START.r, c: FOX_START.c };
    hounds = HOUND_STARTS.map(h => ({ r: h.r, c: h.c }));
    turn = 'fox';
    state = 'playing';
    selected = null;
    render();
}

function restart() {
    startGame();
}

// ===========================================================================
// Geometry
// ===========================================================================

function cellCenter(r, c) {
    return { x: PAD + (c + 0.5) * CELL, y: PAD + (r + 0.5) * CELL };
}

function pixelToCell(x, y) {
    const c = Math.floor((x - PAD) / CELL);
    const r = Math.floor((y - PAD) / CELL);
    if (!inBounds(r, c)) return null;
    return { r, c };
}

// ===========================================================================
// Rendering
// ===========================================================================

function drawDisc(r, c, fill, edge, radius) {
    const { x, y } = cellCenter(r, c);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.shadowColor = fill;
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = edge;
    ctx.stroke();
}

function draw() {
    // Board.
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            const { x, y } = { x: PAD + c * CELL, y: PAD + r * CELL };
            ctx.fillStyle = isDark(r, c) ? CLR.dark : CLR.light;
            ctx.fillRect(x, y, CELL, CELL);
        }
    }

    // Selection ring + legal-move dots.
    if (selected) {
        const s = cellCenter(selected.r, selected.c);
        ctx.strokeStyle = CLR.sel;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(s.x, s.y, CELL * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        for (const m of legalMovesFrom(selected.r, selected.c)) {
            const p = cellCenter(m.r, m.c);
            ctx.fillStyle = CLR.move;
            ctx.beginPath();
            ctx.arc(p.x, p.y, CELL * 0.16, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Pieces.
    for (const h of hounds) drawDisc(h.r, h.c, CLR.hound, CLR.houndEdge, CELL * 0.34);
    drawDisc(fox.r, fox.c, CLR.fox, CLR.foxEdge, CELL * 0.36);
}

function render() {
    // Turn indicator.
    turnEl.textContent = turn === 'fox' ? 'Fox' : 'Hounds';
    turnEl.className = turn === 'fox' ? 'turn-fox' : 'turn-hounds';

    const finished = state === 'fox' || state === 'hounds';
    overlay.classList.toggle('visible', state === 'idle' || finished);
    if (finished) {
        overlayTitle.textContent = state === 'fox' ? 'FOX ESCAPES!' : 'HOUNDS WIN!';
        overlayScore.textContent = state === 'fox'
            ? 'The fox broke through to the top row.'
            : 'The fox is trapped with nowhere to run.';
        btnStart.textContent = 'Play again';
    } else if (state === 'idle') {
        overlayTitle.textContent = 'FOX & HOUNDS';
        overlayScore.textContent = '';
    }

    draw();
}

// ===========================================================================
// Input
// ===========================================================================

canvas.addEventListener('click', (e) => {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const cell = pixelToCell(x, y);
    if (!cell) return;

    const who = pieceAt(cell.r, cell.c);
    const mine = (turn === 'fox' && who === 'fox') || (turn === 'hounds' && who === 'hound');

    if (mine) {
        selected = { r: cell.r, c: cell.c };   // pick up (or switch) a piece
        render();
    } else if (selected) {
        if (!tryMove(selected, cell)) {         // try to move there
            selected = null;                    // illegal target → deselect
            render();
        }
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r') restart();
});

btnStart.addEventListener('click', startGame);

// Initial paint (idle overlay showing).
render();
