// ---------------------------------------------------------------------------
// Futoshiki — the "not-equal" Latin-square logic puzzle. Fill the n×n grid so
// every row and column holds 1..n exactly once AND every printed < / > sign
// between adjacent cells holds. Some cells are given; you deduce the rest.
//
// All rule-checking is pure and synchronous — `cellConflict`, `isComplete` and
// `isSolved` read only the `grid`, so the game is fully deterministic and the
// render loop is not part of the logic. Tests arrange a grid, call these
// functions, and assert the result with no timing involved.
//
// The four puzzles below were generated offline and each verified to have a
// UNIQUE solution by a backtracking solver, so "complete + no conflicts" is
// equivalent to "correct". The stored `solution` is used only by Hint.
// ---------------------------------------------------------------------------

const PUZZLES = [
    { size: 5, givens: [[0,1,2],[0,4,5],[4,4,3],[1,3,1],[3,1,5],[1,0,5],[0,0,1]], h: [[0,2,"<"],[1,0,">"],[2,0,">"],[2,2,">"],[3,0,"<"],[3,1,">"],[4,0,"<"],[4,1,">"]], v: [[0,3,">"],[0,4,">"],[1,3,"<"],[1,4,"<"],[2,0,"<"],[3,2,">"],[3,4,"<"]], solution: [[1,2,3,4,5],[5,3,4,1,2],[3,1,5,2,4],[4,5,2,3,1],[2,4,1,5,3]] },
    { size: 5, givens: [[1,2,3],[0,2,2],[0,1,5]], h: [[0,2,"<"],[1,0,"<"],[1,2,"<"],[1,3,">"],[2,1,"<"],[2,2,">"],[2,3,"<"],[3,1,"<"],[4,2,"<"]], v: [[0,0,"<"],[0,2,"<"],[0,3,"<"],[0,4,">"],[2,0,">"],[2,1,">"],[3,1,"<"],[3,3,">"]], solution: [[1,5,2,3,4],[2,4,3,5,1],[5,2,4,1,3],[3,1,5,4,2],[4,3,1,2,5]] },
    { size: 5, givens: [[3,0,4],[4,4,3],[0,4,2]], h: [[0,2,"<"],[0,3,">"],[1,1,">"],[1,3,"<"],[2,0,">"],[2,2,">"],[2,3,"<"],[3,0,"<"],[3,1,">"],[3,2,"<"],[3,3,">"],[4,0,"<"],[4,2,">"]], v: [[0,0,">"],[0,3,">"],[0,4,"<"],[1,0,"<"],[1,2,"<"],[1,4,">"],[2,0,">"],[2,1,"<"],[2,3,"<"],[2,4,">"],[3,2,"<"],[3,3,">"]], solution: [[3,1,4,5,2],[2,3,1,4,5],[5,2,3,1,4],[4,5,2,3,1],[1,4,5,2,3]] },
    { size: 5, givens: [], h: [[0,0,"<"],[0,2,"<"],[0,3,"<"],[1,0,">"],[1,1,">"],[1,2,">"],[1,3,">"],[2,1,"<"],[2,2,">"],[3,0,"<"],[3,2,">"],[3,3,">"],[4,1,"<"]], v: [[0,1,">"],[0,2,"<"],[0,3,">"],[0,4,">"],[1,0,">"],[1,2,"<"],[1,3,">"],[1,4,"<"],[2,1,"<"],[2,2,"<"],[2,4,">"],[3,1,">"],[3,2,">"],[3,4,"<"]], solution: [[2,5,1,3,4],[5,4,3,2,1],[3,2,4,1,5],[1,3,5,4,2],[4,1,2,5,3]] },
];
const DIFFICULTY = ['Easy', 'Medium', 'Hard', 'Expert'];

// Exposed to tests (plain script, no module scope).
const puzzles = PUZZLES;
let SIZE, grid, fixed, puzzle, puzzleIndex, selected, state, hMap, vMap;

// --- Layout ---
const CANVAS = 480;
const CELL = 66;
const GAP = 22;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const diffLabel = document.getElementById('difficulty-label');

function boardOrigin() {
    const boardW = SIZE * CELL + (SIZE - 1) * GAP;
    return (CANVAS - boardW) / 2;
}
function cellX(c) { return boardOrigin() + c * (CELL + GAP); }
function cellY(r) { return boardOrigin() + r * (CELL + GAP); }

// ---------------------------------------------------------------------------
// Inequality lookups. hMap key "r,c" is the sign between (r,c) and (r,c+1);
// vMap key "r,c" is the sign between (r,c) and (r+1,c).
// ---------------------------------------------------------------------------
function hIneq(r, c) { const s = hMap.get(r + ',' + c); return s === undefined ? null : s; }
function vIneq(r, c) { const s = vMap.get(r + ',' + c); return s === undefined ? null : s; }

function relOk(sign, a, b) { return sign === '<' ? a < b : a > b; }

// ---------------------------------------------------------------------------
// Rules — all pure, reading only `grid`.
// ---------------------------------------------------------------------------
function cellConflict(r, c) {
    const val = grid[r][c];
    if (!val) return false;

    for (let i = 0; i < SIZE; i++) {
        if (i !== c && grid[r][i] === val) return true; // row duplicate
        if (i !== r && grid[i][c] === val) return true; // column duplicate
    }

    // Inequalities against filled neighbours only.
    if (c > 0 && grid[r][c - 1]) { const s = hIneq(r, c - 1); if (s && !relOk(s, grid[r][c - 1], val)) return true; }
    if (c < SIZE - 1 && grid[r][c + 1]) { const s = hIneq(r, c); if (s && !relOk(s, val, grid[r][c + 1])) return true; }
    if (r > 0 && grid[r - 1][c]) { const s = vIneq(r - 1, c); if (s && !relOk(s, grid[r - 1][c], val)) return true; }
    if (r < SIZE - 1 && grid[r + 1][c]) { const s = vIneq(r, c); if (s && !relOk(s, val, grid[r + 1][c])) return true; }

    return false;
}

function isComplete() {
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (!grid[r][c]) return false;
    return true;
}

function isSolved() {
    if (!isComplete()) return false;
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (cellConflict(r, c)) return false;
    return true;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function setCell(r, c, v) {
    if (state !== 'playing') return;
    if (fixed[r][c]) return;
    if (!Number.isInteger(v) || v < 0 || v > SIZE) return;
    grid[r][c] = v;
    draw();
    checkWin();
}

function selectCell(r, c) {
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return;
    selected = { r, c };
    draw();
}

function moveSelection(dr, dc) {
    if (!selected) { selectCell(0, 0); return; }
    const r = Math.max(0, Math.min(SIZE - 1, selected.r + dr));
    const c = Math.max(0, Math.min(SIZE - 1, selected.c + dc));
    selectCell(r, c);
}

function useHint() {
    if (state !== 'playing') return;
    const empties = [];
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (!grid[r][c]) empties.push([r, c]);
    if (!empties.length) return;
    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    grid[r][c] = puzzle.solution[r][c];
    selected = { r, c };
    draw();
    checkWin();
}

function checkWin() {
    if (state === 'playing' && isSolved()) {
        state = 'won';
        overlayTitle.textContent = 'Solved!';
        overlaySub.textContent = 'Nicely deduced. Pick another puzzle to keep going.';
        overlay.classList.add('visible');
        draw();
    }
}

function loadPuzzle(i) {
    puzzleIndex = i;
    puzzle = puzzles[i];
    SIZE = puzzle.size;
    grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    fixed = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
    for (const [r, c, v] of puzzle.givens) { grid[r][c] = v; fixed[r][c] = true; }
    hMap = new Map(puzzle.h.map(([r, c, s]) => [r + ',' + c, s]));
    vMap = new Map(puzzle.v.map(([r, c, s]) => [r + ',' + c, s]));
    selected = null;
    state = 'playing';
    diffLabel.textContent = DIFFICULTY[i] || ('#' + (i + 1));
    document.querySelectorAll('.diff-btn').forEach(b =>
        b.classList.toggle('active', Number(b.dataset.index) === i));
    overlay.classList.remove('visible');
    draw();
}

function restart() { loadPuzzle(puzzleIndex); }
function nextPuzzle() { loadPuzzle((puzzleIndex + 1) % puzzles.length); }

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

function draw() {
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, CANVAS, CANVAS);

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const x = cellX(c), y = cellY(r);
            const conflict = cellConflict(r, c);
            const isSel = selected && selected.r === r && selected.c === c;

            ctx.fillStyle = fixed[r][c] ? '#1b2233' : (grid[r][c] ? '#131c30' : '#0e1626');
            roundRect(x, y, CELL, CELL, 8);
            ctx.fill();

            ctx.lineWidth = isSel ? 3 : 1.5;
            ctx.strokeStyle = conflict ? '#f85149' : (isSel ? '#1f6feb' : '#26304a');
            roundRect(x, y, CELL, CELL, 8);
            ctx.stroke();

            if (grid[r][c]) {
                ctx.fillStyle = conflict ? '#ff7b72' : (fixed[r][c] ? '#93b4dc' : '#e6edf3');
                ctx.font = '700 32px "Segoe UI", system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(grid[r][c]), x + CELL / 2, y + CELL / 2 + 1);
            }
        }
    }

    // Inequality signs in the gaps.
    ctx.fillStyle = '#f0a35e';
    ctx.font = '700 24px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [r, c, s] of puzzle.h) {
        const x = cellX(c) + CELL + GAP / 2;
        const y = cellY(r) + CELL / 2;
        ctx.fillText(s, x, y + 1);
    }
    for (const [r, c, s] of puzzle.v) {
        const x = cellX(c) + CELL / 2;
        const y = cellY(r) + CELL + GAP / 2;
        // '<' means top < bottom (point up = ∧); '>' means top > bottom (∨).
        ctx.fillText(s === '<' ? '∧' : '∨', x, y + 1);
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function cellFromPoint(px, py) {
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const x = cellX(c), y = cellY(r);
            if (px >= x && px <= x + CELL && py >= y && py <= y + CELL) return { r, c };
        }
    }
    return null;
}

canvas.addEventListener('pointerdown', e => {
    const rect = canvas.getBoundingClientRect();
    const scale = CANVAS / rect.width;
    const px = (e.clientX - rect.left) * scale;
    const py = (e.clientY - rect.top) * scale;
    const cell = cellFromPoint(px, py);
    if (cell) selectCell(cell.r, cell.c);
});

document.addEventListener('keydown', e => {
    const k = e.key;
    if (k === 'ArrowLeft') { moveSelection(0, -1); e.preventDefault(); return; }
    if (k === 'ArrowRight') { moveSelection(0, 1); e.preventDefault(); return; }
    if (k === 'ArrowUp') { moveSelection(-1, 0); e.preventDefault(); return; }
    if (k === 'ArrowDown') { moveSelection(1, 0); e.preventDefault(); return; }

    if (!selected) return;
    if (k >= '1' && k <= String(SIZE)) { setCell(selected.r, selected.c, Number(k)); return; }
    if (k === '0' || k === 'Backspace' || k === 'Delete') { setCell(selected.r, selected.c, 0); e.preventDefault(); }
});

document.querySelectorAll('.num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (selected) setCell(selected.r, selected.c, Number(btn.dataset.num));
    });
});
document.getElementById('btn-clear').addEventListener('click', () => {
    if (selected) setCell(selected.r, selected.c, 0);
});
document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => loadPuzzle(Number(btn.dataset.index)));
});
document.getElementById('btn-hint').addEventListener('click', useHint);
document.getElementById('btn-restart').addEventListener('click', restart);
document.getElementById('btn-continue').addEventListener('click', nextPuzzle);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadPuzzle(0);
