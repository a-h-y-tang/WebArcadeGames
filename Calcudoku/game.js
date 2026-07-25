// Calcudoku (a KenKen-style puzzle). Fill an N×N grid so every row and column
// contains each digit 1..N exactly once, and every outlined "cage" combines its
// cells to the printed target using the printed operation (+, −, ×, ÷). A single
// bundled puzzle with a unique solution ships with the game.
//
// The model is plain data with pure logic (isSolved, conflictSet, isCageSolved)
// kept separate from rendering, so the Playwright suite drives and inspects it
// deterministically.

// ------------------------------------------------------------------ puzzle
// The solution + cages were generated offline: a valid Latin square was chosen,
// partitioned into cages, and each cage assigned an operator/target derived from
// the solution and checked to yield a UNIQUE solution (see DESIGN.md).
const SOLUTION = [
    [2, 4, 1, 3],
    [1, 3, 4, 2],
    [4, 2, 3, 1],
    [3, 1, 2, 4],
];

const CAGES = [
    { cells: [[0, 0], [1, 0]],          op: '/', target: 2 },
    { cells: [[0, 1], [0, 2]],          op: '/', target: 4 },
    { cells: [[0, 3], [1, 3]],          op: '-', target: 1 },
    { cells: [[1, 1], [1, 2]],          op: '-', target: 1 },
    { cells: [[2, 0], [3, 0]],          op: '-', target: 1 },
    { cells: [[2, 1], [2, 2], [3, 2]],  op: 'x', target: 12 },
    { cells: [[2, 3], [3, 3]],          op: '/', target: 4 },
    { cells: [[3, 1]],                  op: '=', target: 1 },
];

const N = SOLUTION.length;
const CELL = 84;
const W = N * CELL;
const H = N * CELL;

const OP_SYMBOL = { '+': '+', '-': '−', 'x': '×', '/': '÷', '=': '' };

// Which cage each cell belongs to, and the "anchor" (top-left) cell of each
// cage where its clue label is drawn.
const cageOfCell = {};
const anchorOf = [];
CAGES.forEach((cage, i) => {
    let anchor = cage.cells[0];
    for (const [r, c] of cage.cells) {
        cageOfCell[r + ',' + c] = i;
        if (r < anchor[0] || (r === anchor[0] && c < anchor[1])) anchor = [r, c];
    }
    anchorOf[i] = anchor;
});

// ------------------------------------------------------------------- state
let grid;                   // N×N current values (0 = empty)
let state;                  // 'idle' | 'playing' | 'won'
let selected;               // { r, c }

function inBounds(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
function valueAt(r, c) { return inBounds(r, c) ? grid[r][c] : 0; }
function solutionAt(r, c) { return inBounds(r, c) ? SOLUTION[r][c] : 0; }

function emptyGrid() { return Array.from({ length: N }, () => Array(N).fill(0)); }

function startGame() {
    grid = emptyGrid();
    state = 'playing';
    selected = { r: 0, c: 0 };
    hideOverlay();
    updateHud();
    draw();
}

const restart = startGame;

// -------------------------------------------------------------- interactions
function setValue(r, c, val) {
    if (state !== 'playing') return;
    if (!inBounds(r, c)) return;
    if (val === 0) grid[r][c] = 0;
    else if (val >= 1 && val <= N) grid[r][c] = val;
    // values outside 1..N are ignored
    checkWin();
    updateHud();
    draw();
}

function selectCell(r, c) {
    if (inBounds(r, c)) { selected = { r, c }; draw(); }
}

function moveSelection(dr, dc) {
    const r = Math.max(0, Math.min(N - 1, selected.r + dr));
    const c = Math.max(0, Math.min(N - 1, selected.c + dc));
    selected = { r, c };
    draw();
}

// ------------------------------------------------------------------- rules
// Does a cage's currently entered values satisfy its target? (false if any of
// its cells is still empty.)
function cageValues(cage) { return cage.cells.map(([r, c]) => grid[r][c]); }

function cageSatisfied(cage, vals) {
    if (vals.some(v => v === 0)) return false;
    switch (cage.op) {
        case '=': return vals.length === 1 && vals[0] === cage.target;
        case '+': return vals.reduce((a, b) => a + b, 0) === cage.target;
        case 'x': return vals.reduce((a, b) => a * b, 1) === cage.target;
        case '-': { if (vals.length !== 2) return false; return Math.abs(vals[0] - vals[1]) === cage.target; }
        case '/': {
            if (vals.length !== 2) return false;
            const hi = Math.max(vals[0], vals[1]), lo = Math.min(vals[0], vals[1]);
            return lo !== 0 && hi % lo === 0 && hi / lo === cage.target;
        }
    }
    return false;
}

function isCageSolved(i) { return cageSatisfied(CAGES[i], cageValues(CAGES[i])); }

function rowsColsComplete() {
    for (let i = 0; i < N; i++) {
        const row = new Set(), col = new Set();
        for (let j = 0; j < N; j++) {
            if (grid[i][j] === 0 || grid[j][i] === 0) return false;
            row.add(grid[i][j]); col.add(grid[j][i]);
        }
        if (row.size !== N || col.size !== N) return false;
    }
    return true;
}

function isSolved() {
    if (!grid) return false;
    if (!rowsColsComplete()) return false;
    return CAGES.every((c) => cageSatisfied(c, cageValues(c)));
}

// Cells currently breaking a rule: a digit repeated in its row or column, or a
// fully filled cage that misses its target. Returned as a Set of "r,c" keys.
function conflictSet() {
    const bad = new Set();
    if (!grid) return bad;
    // row / column duplicates
    for (let i = 0; i < N; i++) {
        const rowSeen = new Map(), colSeen = new Map();
        for (let j = 0; j < N; j++) {
            const rv = grid[i][j];
            if (rv !== 0) { if (!rowSeen.has(rv)) rowSeen.set(rv, []); rowSeen.get(rv).push([i, j]); }
            const cv = grid[j][i];
            if (cv !== 0) { if (!colSeen.has(cv)) colSeen.set(cv, []); colSeen.get(cv).push([j, i]); }
        }
        for (const cells of rowSeen.values()) if (cells.length > 1) cells.forEach(([r, c]) => bad.add(r + ',' + c));
        for (const cells of colSeen.values()) if (cells.length > 1) cells.forEach(([r, c]) => bad.add(r + ',' + c));
    }
    // completed cage with the wrong result
    for (const cage of CAGES) {
        const vals = cageValues(cage);
        if (!vals.some(v => v === 0) && !cageSatisfied(cage, vals))
            cage.cells.forEach(([r, c]) => bad.add(r + ',' + c));
    }
    return bad;
}

function checkWin() {
    if (state === 'playing' && isSolved()) {
        state = 'won';
        showOverlay('SOLVED!', 'Every row, column, and cage checks out.', 'Press R or Start to play again.');
    }
}

// ------------------------------------------------------------------- render
const canvas = typeof document !== 'undefined' ? document.getElementById('canvas') : null;
const ctx = canvas ? canvas.getContext('2d') : null;
if (canvas) { canvas.width = W; canvas.height = H; }

const filledEl = typeof document !== 'undefined' ? document.getElementById('filled') : null;
const statusEl = typeof document !== 'undefined' ? document.getElementById('status') : null;
const overlay = typeof document !== 'undefined' ? document.getElementById('overlay') : null;
const overlayTitle = typeof document !== 'undefined' ? document.getElementById('overlay-title') : null;
const overlayScore = typeof document !== 'undefined' ? document.getElementById('overlay-score') : null;
const overlaySub = typeof document !== 'undefined' ? document.getElementById('overlay-sub') : null;

function updateHud() {
    if (!grid) return;
    let filled = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] !== 0) filled++;
    if (filledEl) filledEl.textContent = `${filled} / ${N * N}`;
    if (statusEl) {
        if (state === 'won') { statusEl.textContent = 'Solved'; statusEl.classList.add('solved'); }
        else { statusEl.textContent = state === 'playing' ? 'Playing' : 'Ready'; statusEl.classList.remove('solved'); }
    }
}

function showOverlay(title, scoreLine, sub) {
    if (!overlay) return;
    if (overlayTitle) overlayTitle.textContent = title;
    if (overlayScore) overlayScore.textContent = scoreLine || '';
    if (sub && overlaySub) overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() { if (overlay) overlay.classList.remove('visible'); }

function sameCage(r1, c1, r2, c2) {
    if (!inBounds(r2, c2)) return false;
    return cageOfCell[r1 + ',' + c1] === cageOfCell[r2 + ',' + c2];
}

function draw() {
    if (!ctx || !grid) return;
    ctx.clearRect(0, 0, W, H);
    const conflicts = state === 'playing' ? conflictSet() : new Set();

    // cell backgrounds + selection
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            const x = c * CELL, y = r * CELL;
            const isSel = selected && selected.r === r && selected.c === c;
            const isBad = conflicts.has(r + ',' + c);
            ctx.fillStyle = isBad ? '#3a1720' : (isSel ? '#123240' : '#0e1622');
            ctx.fillRect(x, y, CELL, CELL);
        }
    }

    // thin interior grid lines
    ctx.strokeStyle = '#243244';
    ctx.lineWidth = 1;
    for (let i = 1; i < N; i++) {
        ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke();
    }

    // thick cage borders: draw on any edge between two different cages (or the grid edge)
    ctx.strokeStyle = '#5eead4';
    ctx.lineWidth = 3;
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            const x = c * CELL, y = r * CELL;
            if (!sameCage(r, c, r - 1, c)) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + CELL, y); ctx.stroke(); }
            if (!sameCage(r, c, r + 1, c)) { ctx.beginPath(); ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y + CELL); ctx.stroke(); }
            if (!sameCage(r, c, r, c - 1)) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + CELL); ctx.stroke(); }
            if (!sameCage(r, c, r, c + 1)) { ctx.beginPath(); ctx.moveTo(x + CELL, y); ctx.lineTo(x + CELL, y + CELL); ctx.stroke(); }
        }
    }

    // cage clue labels (target + operator) in each cage's anchor cell
    ctx.fillStyle = '#9fe9dd';
    ctx.font = '600 15px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    CAGES.forEach((cage, i) => {
        const [ar, ac] = anchorOf[i];
        const label = cage.op === '=' ? String(cage.target) : `${cage.target}${OP_SYMBOL[cage.op]}`;
        ctx.fillText(label, ac * CELL + 6, ar * CELL + 5);
    });

    // digits
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            const v = grid[r][c];
            if (v === 0) continue;
            const isBad = conflicts.has(r + ',' + c);
            ctx.font = '600 34px "Segoe UI", sans-serif';
            ctx.fillStyle = isBad ? '#ff6b81' : (state === 'won' ? '#34d399' : '#eaf1ff');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(v), c * CELL + CELL / 2, r * CELL + CELL / 2 + 4);
        }
    }
}

// -------------------------------------------------------------------- input
if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'r' || e.key === 'R') { startGame(); return; }
        if ((e.key === ' ' || e.key === 'Enter') && state !== 'playing') { e.preventDefault(); startGame(); return; }
        if (state !== 'playing') return;
        if (e.key >= '1' && e.key <= '9') { setValue(selected.r, selected.c, Number(e.key)); }
        else if (e.key === '0' || e.key === 'Backspace' || e.key === 'Delete') { setValue(selected.r, selected.c, 0); }
        else if (e.key === 'ArrowLeft') { moveSelection(0, -1); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { moveSelection(0, 1); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { moveSelection(-1, 0); e.preventDefault(); }
        else if (e.key === 'ArrowDown') { moveSelection(1, 0); e.preventDefault(); }
    });

    const startBtn = document.getElementById('btn-start');
    if (startBtn) startBtn.addEventListener('click', () => startGame());

    if (canvas) {
        canvas.addEventListener('click', (e) => {
            if (state !== 'playing') { startGame(); return; }
            const rect = canvas.getBoundingClientRect();
            const scale = W / rect.width;
            const cx = (e.clientX - rect.left) * scale;
            const cy = (e.clientY - rect.top) * scale;
            selectCell(Math.floor(cy / CELL), Math.floor(cx / CELL));
        });
    }
}

// -------------------------------------------------------------------- boot
grid = emptyGrid();
state = 'idle';
selected = { r: 0, c: 0 };
updateHud();
draw();
