// ---------------------------------------------------------------------------
// Hitori — a Japanese logic puzzle of shading cells.
//
// You are given a square grid of numbers. Shade (black out) cells so that:
//   1. no number appears more than once in any row or column among the
//      remaining un-shaded (white) cells;
//   2. no two shaded cells are orthogonally adjacent;
//   3. all the white cells form a single orthogonally-connected region.
//
// Click a cell to toggle it black; click again to clear it back to white.
//
// Written as a single classic (non-module) script so the pure rule functions
// and the board state are reachable from the Playwright suite as plain globals,
// mirroring the other puzzle games in this repo (Sudoku, Nonogram). There is no
// RNG or animation in the game logic, so the whole thing is deterministic and
// unit-testable.
// ---------------------------------------------------------------------------

// Cell shade states.
const WHITE = 0;   // un-shaded (a normal cell)
const BLACK = 1;   // shaded / blacked out

// ---------------------------------------------------------------------------
// Puzzles. Each puzzle is a square grid of numbers plus its solution shading
// (1 = must be black). The solutions are verified by the test suite against the
// pure rule functions below, so they are guaranteed to satisfy every rule.
// ---------------------------------------------------------------------------
const PUZZLES = [
    {
        id: 'A',
        grid: [
            [1, 2, 1, 4, 5],
            [2, 3, 4, 5, 2],
            [4, 4, 5, 1, 2],
            [4, 5, 1, 5, 3],
            [5, 3, 2, 3, 4],
        ],
        solution: [
            [0, 0, 1, 0, 0],
            [0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0],
            [0, 0, 0, 1, 0],
            [0, 1, 0, 0, 0],
        ],
    },
    {
        id: 'B',
        // Transpose of puzzle A — the transpose of a valid Hitori board is
        // itself valid, giving a fresh-looking puzzle for free.
        grid: [
            [1, 2, 4, 4, 5],
            [2, 3, 4, 5, 3],
            [1, 4, 5, 1, 2],
            [4, 5, 1, 5, 3],
            [5, 2, 2, 3, 4],
        ],
        solution: [
            [0, 0, 1, 0, 0],
            [0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0],
            [0, 0, 0, 1, 0],
            [0, 1, 0, 0, 0],
        ],
    },
    {
        id: 'C',
        // Puzzle A with the symbols relabelled 1→3,2→4,3→5,4→1,5→2 (a bijection,
        // which preserves every Hitori rule) so the same solution applies.
        grid: [
            [3, 4, 3, 1, 2],
            [4, 5, 1, 2, 4],
            [1, 1, 2, 3, 4],
            [1, 2, 3, 2, 5],
            [2, 5, 4, 5, 1],
        ],
        solution: [
            [0, 0, 1, 0, 0],
            [0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0],
            [0, 0, 0, 1, 0],
            [0, 1, 0, 0, 0],
        ],
    },
];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const puzzleLabelEl = document.getElementById('puzzle-label');
const btnNew = document.getElementById('btn-new');
const btnReset = document.getElementById('btn-reset');
const overlay = document.getElementById('overlay');
const overlaySub = document.getElementById('overlay-sub');

// --- State (module scope, poked by tests) ---
let puzzleIndex;   // index into PUZZLES
let grid;          // number grid (reference to the current puzzle's grid)
let N;             // grid size
let shade;         // N×N of WHITE / BLACK — the player's marks
let solved;        // whether the board currently satisfies every rule

// --- Layout ---
const MARGIN = 20;
let cell;          // pixel size of one cell (computed from canvas + N)

// ---------------------------------------------------------------------------
// Pure rule checks. Each takes the number grid and a shade grid.
// ---------------------------------------------------------------------------

// Rule 1: among white cells, no value repeats in any row or column.
// Returns the set of offending "r,c" keys (empty ⇒ rule satisfied).
function duplicateWhites(grid, shade) {
    const n = grid.length;
    const bad = new Set();
    // Rows.
    for (let r = 0; r < n; r++) {
        const seen = {};
        for (let c = 0; c < n; c++) {
            if (shade[r][c] === BLACK) continue;
            const v = grid[r][c];
            if (seen[v] === undefined) seen[v] = [c];
            else seen[v].push(c);
        }
        for (const v in seen) {
            if (seen[v].length > 1) for (const c of seen[v]) bad.add(r + ',' + c);
        }
    }
    // Columns.
    for (let c = 0; c < n; c++) {
        const seen = {};
        for (let r = 0; r < n; r++) {
            if (shade[r][c] === BLACK) continue;
            const v = grid[r][c];
            if (seen[v] === undefined) seen[v] = [r];
            else seen[v].push(r);
        }
        for (const v in seen) {
            if (seen[v].length > 1) for (const r of seen[v]) bad.add(r + ',' + c);
        }
    }
    return bad;
}

// Rule 2: no two shaded cells are orthogonally adjacent.
// Returns the set of offending "r,c" keys.
function adjacentBlacks(shade) {
    const n = shade.length;
    const bad = new Set();
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (shade[r][c] !== BLACK) continue;
            if (c + 1 < n && shade[r][c + 1] === BLACK) { bad.add(r + ',' + c); bad.add(r + ',' + (c + 1)); }
            if (r + 1 < n && shade[r + 1][c] === BLACK) { bad.add(r + ',' + c); bad.add((r + 1) + ',' + c); }
        }
    }
    return bad;
}

// Rule 3: all white cells are connected into a single region.
function whitesConnected(shade) {
    const n = shade.length;
    let start = null, whiteCount = 0;
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (shade[r][c] === WHITE) {
                whiteCount++;
                if (start === null) start = [r, c];
            }
        }
    }
    if (start === null) return false; // an all-black board is not a solution
    const seen = Array.from({ length: n }, () => new Array(n).fill(false));
    const stack = [start];
    seen[start[0]][start[1]] = true;
    let reached = 0;
    while (stack.length) {
        const [r, c] = stack.pop();
        reached++;
        const nbrs = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
        for (const [nr, nc] of nbrs) {
            if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
            if (seen[nr][nc] || shade[nr][nc] !== WHITE) continue;
            seen[nr][nc] = true;
            stack.push([nr, nc]);
        }
    }
    return reached === whiteCount;
}

// The board is solved when all three rules hold.
function isSolved(grid, shade) {
    return duplicateWhites(grid, shade).size === 0 &&
           adjacentBlacks(shade).size === 0 &&
           whitesConnected(shade);
}

// Every cell currently breaking rule 1 or rule 2 (for red highlighting).
function violations(grid, shade) {
    const bad = duplicateWhites(grid, shade);
    for (const k of adjacentBlacks(shade)) bad.add(k);
    return bad;
}

// ---------------------------------------------------------------------------
// Board actions
// ---------------------------------------------------------------------------
function blankShade(n) {
    return Array.from({ length: n }, () => new Array(n).fill(WHITE));
}

function loadPuzzle(index) {
    puzzleIndex = ((index % PUZZLES.length) + PUZZLES.length) % PUZZLES.length;
    grid = PUZZLES[puzzleIndex].grid;
    N = grid.length;
    shade = blankShade(N);
    cell = (canvas.width - 2 * MARGIN) / N;
    solved = false;
    render();
}

function resetPuzzle() {
    shade = blankShade(N);
    solved = false;
    render();
}

function nextPuzzle() {
    loadPuzzle(puzzleIndex + 1);
}

function toggleCell(r, c) {
    if (solved) return;
    if (r < 0 || c < 0 || r >= N || c >= N) return;
    shade[r][c] = shade[r][c] === BLACK ? WHITE : BLACK;
    solved = isSolved(grid, shade);
    render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bad = violations(grid, shade);

    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            const x = MARGIN + c * cell;
            const y = MARGIN + r * cell;
            const isBlack = shade[r][c] === BLACK;

            // Cell fill.
            ctx.fillStyle = isBlack ? '#0a0d12' : '#f3ede0';
            ctx.fillRect(x, y, cell, cell);

            // Violation ring.
            if (bad.has(r + ',' + c)) {
                ctx.strokeStyle = '#e5534b';
                ctx.lineWidth = 4;
                ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6);
            }

            // Grid border.
            ctx.strokeStyle = '#8a8577';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, cell, cell);

            // Number (dimmed when shaded).
            ctx.fillStyle = isBlack ? '#3a4048' : '#1a1a1a';
            ctx.font = `600 ${Math.floor(cell * 0.42)}px "Segoe UI", system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(grid[r][c]), x + cell / 2, y + cell / 2 + 1);
        }
    }

    // Outer frame.
    ctx.strokeStyle = '#c9c3b3';
    ctx.lineWidth = 2;
    ctx.strokeRect(MARGIN, MARGIN, cell * N, cell * N);

    renderStatus();
}

function renderStatus() {
    if (puzzleLabelEl) puzzleLabelEl.textContent = PUZZLES[puzzleIndex].id;
    if (solved) {
        statusEl.textContent = 'Solved!';
        statusEl.className = 'solved';
        overlay.classList.add('visible');
        overlaySub.textContent = `Puzzle ${PUZZLES[puzzleIndex].id} solved — try the next one!`;
    } else {
        const remaining = violations(grid, shade).size;
        statusEl.textContent = remaining === 0
            ? 'No conflicts — keep going.'
            : `${remaining} cell${remaining === 1 ? '' : 's'} in conflict.`;
        statusEl.className = '';
        overlay.classList.remove('visible');
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function cellAt(px, py) {
    const c = Math.floor((px - MARGIN) / cell);
    const r = Math.floor((py - MARGIN) / cell);
    if (r < 0 || c < 0 || r >= N || c >= N) return null;
    return [r, c];
}

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    const at = cellAt(px, py);
    if (at) toggleCell(at[0], at[1]);
});

if (btnNew) btnNew.addEventListener('click', nextPuzzle);
if (btnReset) btnReset.addEventListener('click', resetPuzzle);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadPuzzle(0);
