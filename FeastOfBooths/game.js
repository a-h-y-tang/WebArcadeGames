// ---------------------------------------------------------------------------
// Feast of Booths — a logic puzzle about pitching shelters beside palm trees.
//
//   "You shall dwell in booths seven days ... that your generations may know
//    that I made the children of Israel to dwell in booths" — Leviticus 23:42-43
//
// A camp is a square grid with palm trees scattered through it. Pitch booths so
// that:
//   1. every palm has exactly one booth of its own, orthogonally beside it
//      (above, below, left or right — never diagonally), and every booth
//      belongs to exactly one palm;
//   2. no two booths touch, not even at a corner;
//   3. the numbers down the left edge and along the top edge give the number of
//      booths in that row or column.
//
// Click an open square to pitch a booth, click again to brush it to sand (a
// "no booth here" mark), click again to clear it. Right-click walks the same
// three states backwards.
//
// Written as a single classic (non-module) script so the pure rule functions,
// the puzzle generator and the board state are all reachable from the
// Playwright suite as plain globals, matching the other puzzle games in this
// repo (Hitori, Sudoku, Nonogram). Puzzles come from a seeded generator, so a
// given camp is reproducible from its level and seed alone, and the suite can
// check that every camp it produces has exactly one answer.
// ---------------------------------------------------------------------------

// Player mark states for a square.
const EMPTY = 0;   // untouched ground
const BOOTH = 1;   // a booth pitched here
const SAND = 2;    // swept sand: the player has ruled this square out

// Camp sizes. `booths` is both the number of palms and the number of booths.
const LEVELS = [
    { id: 'small', name: 'Small camp', size: 8, booths: 10 },
    { id: 'middle', name: 'Middle camp', size: 10, booths: 15 },
    { id: 'large', name: 'Large camp', size: 12, booths: 22 },
];

// Neighbour offsets: orthogonal (palm ↔ booth) and all eight (booth spacing).
const OFF4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const OFF8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const levelLabelEl = document.getElementById('level-label');
const boothsLeftEl = document.getElementById('booths-left');
const overlay = document.getElementById('overlay');
const overlaySub = document.getElementById('overlay-sub');
const btnReset = document.getElementById('btn-reset');
const btnNew = document.getElementById('btn-new');
const btnHint = document.getElementById('btn-hint');
const levelBtns = Array.from(document.querySelectorAll('.level-btn'));

// --- State (module scope, read by the tests) ---
let levelIndex;    // index into LEVELS
let seed;          // generator seed of the camp on screen
let puzzle;        // { size, trees, rowClue, colClue, solution }
let marks;         // size×size of EMPTY / BOOTH / SAND — the player's marks
let size;          // grid side length
let solved;        // whether the camp currently satisfies every rule

// --- Layout ---
const PAD = 10;            // outer padding inside the canvas
const CLUE = 36;           // width of the clue strip (left and top)
const ORIGIN = PAD + CLUE; // pixel offset of the grid's top-left corner
let cellSize;              // pixel size of one square (depends on `size`)

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------
function blankGrid(n, value) {
    return Array.from({ length: n }, () => new Array(n).fill(value));
}

function inBounds(r, c, n) {
    return r >= 0 && c >= 0 && r < n && c < n;
}

// The orthogonal neighbours of (r, c) inside an n×n grid.
function neighbours4(r, c, n) {
    return OFF4.map(([dr, dc]) => [r + dr, c + dc]).filter(([rr, cc]) => inBounds(rr, cc, n));
}

// All eight neighbours of (r, c) inside an n×n grid.
function neighbours8(r, c, n) {
    return OFF8.map(([dr, dc]) => [r + dr, c + dc]).filter(([rr, cc]) => inBounds(rr, cc, n));
}

// Every cell of `grid` holding BOOTH, as [r, c] pairs.
function cellsWith(grid, value) {
    const out = [];
    for (let r = 0; r < grid.length; r++)
        for (let c = 0; c < grid.length; c++) if (grid[r][c] === value) out.push([r, c]);
    return out;
}

// Every truthy cell of a boolean grid (used for the palms), as [r, c] pairs.
function truthyCells(grid) {
    const out = [];
    for (let r = 0; r < grid.length; r++)
        for (let c = 0; c < grid.length; c++) if (grid[r][c]) out.push([r, c]);
    return out;
}

// ---------------------------------------------------------------------------
// Pure rule functions
// ---------------------------------------------------------------------------

// Booths per row and per column of a mark grid.
function boothCounts(grid) {
    const n = grid.length;
    const rows = new Array(n).fill(0);
    const cols = new Array(n).fill(0);
    for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++)
            if (grid[r][c] === BOOTH) { rows[r]++; cols[c]++; }
    return { rows, cols };
}

// Rule 2: booths may not touch. Returns the "r,c" keys of every booth that
// touches another (empty set ⇒ rule satisfied).
function touchingBooths(grid) {
    const n = grid.length;
    const bad = new Set();
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (grid[r][c] !== BOOTH) continue;
            for (const [rr, cc] of neighbours8(r, c, n)) {
                if (grid[rr][cc] === BOOTH) { bad.add(r + ',' + c); bad.add(rr + ',' + cc); }
            }
        }
    }
    return bad;
}

// Rule 1 as a bipartite matching: how many booths can be paired off with palms
// of their own, each booth orthogonally beside its palm. Kuhn's algorithm.
function maxMatching(trees, booths) {
    const treeAt = new Map();
    trees.forEach(([r, c], i) => treeAt.set(r + ',' + c, i));
    const options = booths.map(([r, c]) =>
        OFF4.map(([dr, dc]) => treeAt.get((r + dr) + ',' + (c + dc)))
            .filter((i) => i !== undefined));

    const takenBy = new Array(trees.length).fill(-1);
    const augment = (b, seen) => {
        for (const t of options[b]) {
            if (seen[t]) continue;
            seen[t] = true;
            if (takenBy[t] === -1 || augment(takenBy[t], seen)) { takenBy[t] = b; return true; }
        }
        return false;
    };

    let paired = 0;
    for (let b = 0; b < booths.length; b++)
        if (augment(b, new Array(trees.length).fill(false))) paired++;
    return paired;
}

// Rows and columns holding more booths than their clue allows.
function clueTrouble(p, grid) {
    const counts = boothCounts(grid);
    const rows = new Set();
    const cols = new Set();
    for (let i = 0; i < p.size; i++) {
        if (counts.rows[i] > p.rowClue[i]) rows.add(i);
        if (counts.cols[i] > p.colClue[i]) cols.add(i);
    }
    return { rows, cols };
}

// Booths that break a rule on their own account: sitting on a palm, standing
// nowhere near a palm, or touching another booth.
function violations(p, grid) {
    const bad = touchingBooths(grid);
    for (const [r, c] of cellsWith(grid, BOOTH)) {
        if (p.trees[r][c]) { bad.add(r + ',' + c); continue; }
        const besidePalm = neighbours4(r, c, p.size).some(([rr, cc]) => p.trees[rr][cc]);
        if (!besidePalm) bad.add(r + ',' + c);
    }
    return bad;
}

// The camp is complete when the clues are met exactly, no two booths touch and
// every palm can be given a booth of its own.
function isSolved(p, grid) {
    const booths = cellsWith(grid, BOOTH);
    const trees = truthyCells(p.trees);
    if (booths.length !== trees.length) return false;

    const counts = boothCounts(grid);
    for (let i = 0; i < p.size; i++) {
        if (counts.rows[i] !== p.rowClue[i]) return false;
        if (counts.cols[i] !== p.colClue[i]) return false;
    }
    if (touchingBooths(grid).size > 0) return false;
    return maxMatching(trees, booths) === trees.length;
}

// ---------------------------------------------------------------------------
// Deduction — works a camp the way a player would, so the generator can throw
// away any camp that cannot be reasoned out and would need a guess.
//
// Every rule below is sound: it only ever marks a square the answer agrees
// with. The rules are, in order of cost:
//   a. a square that is a palm, or is beside no palm, never holds a booth;
//   b. a row or column whose clue is already met has no more booths; one whose
//      remaining squares exactly fill its clue has nothing but booths;
//   c. nothing stands around a booth;
//   d. a palm with one square left must use it;
//   e. (only once the cheap rules are exhausted) if the palms can no longer all
//      be served without a square, that square must hold a booth; and if a
//      booth there would strand a palm, it cannot.
// ---------------------------------------------------------------------------
const UNSURE = 0;  // deduction has not settled this square
const MUST = 1;    // deduction says: a booth stands here
const NEVER = 2;   // deduction says: no booth can stand here

function deduceCamp(p) {
    const n = p.size;
    const trees = truthyCells(p.trees);
    const state = blankGrid(n, UNSURE);
    const key = (r, c) => r + ',' + c;

    // Rule (a).
    for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++)
            if (p.trees[r][c] || !neighbours4(r, c, n).some(([rr, cc]) => p.trees[rr][cc]))
                state[r][c] = NEVER;

    let moved = true;
    const mark = (r, c, v) => {
        if (state[r][c] === v) return;
        state[r][c] = v;
        moved = true;
    };

    while (moved) {
        moved = false;

        // Rule (b): row and column counting, both ways round.
        for (let i = 0; i < n; i++) {
            for (const alongRow of [true, false]) {
                const line = [];
                for (let j = 0; j < n; j++) line.push(alongRow ? [i, j] : [j, i]);
                const clue = alongRow ? p.rowClue[i] : p.colClue[i];
                const placed = line.filter(([r, c]) => state[r][c] === MUST).length;
                const open = line.filter(([r, c]) => state[r][c] === UNSURE);
                if (placed === clue) open.forEach(([r, c]) => mark(r, c, NEVER));
                else if (placed + open.length === clue) open.forEach(([r, c]) => mark(r, c, MUST));
            }
        }

        // Rule (c): booths need room.
        for (let r = 0; r < n; r++)
            for (let c = 0; c < n; c++)
                if (state[r][c] === MUST)
                    for (const [rr, cc] of neighbours8(r, c, n))
                        if (state[rr][cc] === UNSURE) mark(rr, cc, NEVER);

        // Rule (d): a palm down to one square.
        for (const [r, c] of trees) {
            const spots = neighbours4(r, c, n).filter(([rr, cc]) => state[rr][cc] !== NEVER);
            if (spots.length === 1) mark(spots[0][0], spots[0][1], MUST);
        }

        if (moved) continue;

        // Rule (e): which squares the palms cannot do without. Stops at the
        // first square it settles so the cheap rules get another turn.
        const allowed = [];
        for (let r = 0; r < n; r++)
            for (let c = 0; c < n; c++) if (state[r][c] !== NEVER) allowed.push([r, c]);

        for (const [r, c] of allowed) {
            if (state[r][c] !== UNSURE) continue;

            const without = allowed.filter(([rr, cc]) => rr !== r || cc !== c);
            if (maxMatching(trees, without) < trees.length) { mark(r, c, MUST); break; }

            const ring = new Set(neighbours8(r, c, n).map(([rr, cc]) => key(rr, cc)));
            const withBooth = allowed.filter(([rr, cc]) =>
                (rr === r && cc === c) || !ring.has(key(rr, cc)));
            if (maxMatching(trees, withBooth) < trees.length) { mark(r, c, NEVER); break; }
        }
    }

    const marks = state.map((row) => row.map((v) => (v === MUST ? BOOTH : EMPTY)));
    return { state, marks, solved: isSolved(p, marks) };
}

// ---------------------------------------------------------------------------
// Solver — counts answers, stopping at `limit`, so the generator can insist on
// camps with exactly one. Walks the grid a row at a time: for each row it picks
// every allowed set of booth squares of the size the row clue asks for, then
// checks the palms can be paired off once the last row is placed.
// ---------------------------------------------------------------------------
function countSolutions(trees, rowClue, colClue, limit) {
    const n = trees.length;
    const treeList = truthyCells(trees);

    // Only squares beside a palm can ever hold a booth.
    const candidates = [];
    for (let r = 0; r < n; r++) {
        const row = [];
        for (let c = 0; c < n; c++) {
            if (trees[r][c]) continue;
            if (neighbours4(r, c, n).some(([rr, cc]) => trees[rr][cc])) row.push(c);
        }
        candidates.push(row);
    }

    // capacity[r][c] = how many booths column c could still take in rows r..n-1.
    const capacity = Array.from({ length: n + 1 }, () => new Array(n).fill(0));
    for (let r = n - 1; r >= 0; r--)
        for (let c = 0; c < n; c++)
            capacity[r][c] = capacity[r + 1][c] + (candidates[r].indexOf(c) >= 0 ? 1 : 0);

    const colLeft = colClue.slice();
    const placed = [];
    let found = 0;

    const walkRows = (r, prevRow) => {
        if (found >= limit) return;
        if (r === n) {
            for (let c = 0; c < n; c++) if (colLeft[c] !== 0) return;
            if (placed.length !== treeList.length) return;
            if (maxMatching(treeList, placed.slice()) === treeList.length) found++;
            return;
        }
        const row = candidates[r];
        const need = rowClue[r];
        const pick = [];
        const choose = (i) => {
            if (found >= limit) return;
            if (pick.length === need) {
                // Give up early if some column can no longer reach its clue.
                for (let c = 0; c < n; c++) if (colLeft[c] > capacity[r + 1][c]) return;
                const taken = pick.slice();
                for (const c of taken) placed.push([r, c]);
                walkRows(r + 1, taken);
                placed.length -= taken.length;
                return;
            }
            if (i >= row.length) return;
            if (need - pick.length > row.length - i) return;   // not enough squares left
            const c = row[i];
            const touchesPick = pick.length > 0 && pick[pick.length - 1] === c - 1;
            const touchesAbove = prevRow.some((pc) => Math.abs(pc - c) <= 1);
            if (colLeft[c] > 0 && !touchesPick && !touchesAbove) {
                colLeft[c]--;
                pick.push(c);
                choose(i + 1);
                pick.pop();
                colLeft[c]++;
            }
            choose(i + 1);
        };
        choose(0);
    };

    walkRows(0, []);
    return found;
}

// ---------------------------------------------------------------------------
// Puzzle generation
//
// mulberry32 keeps the camps reproducible: the same level and seed always build
// the same camp, which is what lets the test suite assert on them.
// ---------------------------------------------------------------------------
function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffled(list, rng) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// Scatter `target` booth-and-palm pairs over an n×n grid: pick a square for the
// booth that touches no other booth, then plant its palm on a free square
// beside it. Returns null if the scatter ran out of room.
function scatterPairs(n, target, rng) {
    const trees = blankGrid(n, false);
    const booths = blankGrid(n, 0);
    const all = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) all.push([r, c]);

    let pitched = 0;
    for (const [r, c] of shuffled(all, rng)) {
        if (pitched >= target) break;
        if (trees[r][c] || booths[r][c]) continue;
        if (neighbours8(r, c, n).some(([rr, cc]) => booths[rr][cc])) continue;
        const spots = neighbours4(r, c, n).filter(([rr, cc]) => !trees[rr][cc] && !booths[rr][cc]);
        if (spots.length === 0) continue;
        const [tr, tc] = spots[Math.floor(rng() * spots.length)];
        booths[r][c] = BOOTH;
        trees[tr][tc] = true;
        pitched++;
    }
    return pitched === target ? { trees, booths } : null;
}

// Build a camp for a level that has exactly one answer.
function generatePuzzle(level, seedValue) {
    const spec = LEVELS[((level % LEVELS.length) + LEVELS.length) % LEVELS.length];
    const n = spec.size;
    const rng = mulberry32(seedValue * 2654435761 + spec.size);
    let fallback = null;

    for (let attempt = 0; attempt < 500; attempt++) {
        const scatter = scatterPairs(n, spec.booths, rng);
        if (!scatter) continue;
        const counts = boothCounts(scatter.booths);
        const camp = {
            size: n,
            trees: scatter.trees,
            rowClue: counts.rows,
            colClue: counts.cols,
            solution: scatter.booths,
        };
        if (!fallback) fallback = camp;
        // One answer, and one a player can actually reason their way to.
        if (countSolutions(camp.trees, camp.rowClue, camp.colClue, 2) !== 1) continue;
        if (deduceCamp(camp).solved) return camp;
    }
    // No scatter in 500 tries was both unique and deducible (vanishingly rare):
    // play the first one rather than leave the player with no camp at all.
    return fallback;
}

// ---------------------------------------------------------------------------
// Board actions
// ---------------------------------------------------------------------------
function loadPuzzle(level, seedValue) {
    levelIndex = ((level % LEVELS.length) + LEVELS.length) % LEVELS.length;
    seed = seedValue;
    puzzle = generatePuzzle(levelIndex, seed);
    size = puzzle.size;
    marks = blankGrid(size, EMPTY);
    cellSize = (canvas.width - ORIGIN - PAD) / size;
    solved = false;
    levelBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.level) === levelIndex));
    render();
}

function resetPuzzle() {
    marks = blankGrid(size, EMPTY);
    solved = false;
    render();
}

function newPuzzle() {
    loadPuzzle(levelIndex, seed + 1);
}

function setLevel(level) {
    if (level === levelIndex) { resetPuzzle(); return; }
    loadPuzzle(level, seed);
}

// Left click: ground → booth → sand → ground. Right click walks it backwards.
function cycleCell(r, c, backwards) {
    if (solved) return;
    if (!inBounds(r, c, size)) return;
    if (puzzle.trees[r][c]) return;         // a palm's square is never marked
    const order = [EMPTY, BOOTH, SAND];
    const at = order.indexOf(marks[r][c]);
    const step = backwards ? order.length - 1 : 1;
    marks[r][c] = order[(at + step) % order.length];
    solved = isSolved(puzzle, marks);
    render();
}

// Pitch one booth the player has not found yet, taken from the answer.
function giveHint() {
    if (solved) return;
    const missing = [];
    for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++)
            if (puzzle.solution[r][c] === BOOTH && marks[r][c] !== BOOTH) missing.push([r, c]);
    if (missing.length === 0) return;
    const [r, c] = missing[0];
    marks[r][c] = BOOTH;
    // Sweep the squares around it to sand — no booth can ever stand there.
    for (const [rr, cc] of neighbours8(r, c, size))
        if (!puzzle.trees[rr][cc] && marks[rr][cc] === EMPTY) marks[rr][cc] = SAND;
    solved = isSolved(puzzle, marks);
    render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const COLOURS = {
    ground: '#efe0c0',
    groundAlt: '#e7d5b0',
    sand: '#bda173',
    line: '#c0a978',
    frame: '#8a6f33',
    clue: '#e4d8bd',
    clueDone: '#86c06c',
    clueBad: '#e5705b',
    trunk: '#7a5230',
    frond: '#3f8f4a',
    frondDark: '#2f6e39',
    boothPost: '#7a4f24',
    boothRoof: '#cfa24c',
    boothThatch: '#9b7733',
    bad: '#e5705b',
};

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bad = violations(puzzle, marks);
    const trouble = clueTrouble(puzzle, marks);
    const counts = boothCounts(marks);

    // Squares.
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const x = ORIGIN + c * cellSize;
            const y = ORIGIN + r * cellSize;
            ctx.fillStyle = (r + c) % 2 === 0 ? COLOURS.ground : COLOURS.groundAlt;
            ctx.fillRect(x, y, cellSize, cellSize);

            if (marks[r][c] === SAND) drawSand(x, y);
            if (puzzle.trees[r][c]) drawPalm(x, y);
            if (marks[r][c] === BOOTH) drawBooth(x, y);

            if (bad.has(r + ',' + c)) {
                ctx.strokeStyle = COLOURS.bad;
                ctx.lineWidth = 3;
                ctx.strokeRect(x + 2.5, y + 2.5, cellSize - 5, cellSize - 5);
            }

            ctx.strokeStyle = COLOURS.line;
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, cellSize, cellSize);
        }
    }

    // Frame.
    ctx.strokeStyle = solved ? '#e8b74a' : COLOURS.frame;
    ctx.lineWidth = solved ? 3 : 2;
    ctx.strokeRect(ORIGIN - 1, ORIGIN - 1, cellSize * size + 2, cellSize * size + 2);

    // Clues.
    ctx.font = `600 ${Math.floor(Math.min(cellSize * 0.46, 22))}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < size; i++) {
        const mid = ORIGIN + i * cellSize + cellSize / 2;

        ctx.fillStyle = trouble.rows.has(i) ? COLOURS.clueBad
            : counts.rows[i] === puzzle.rowClue[i] ? COLOURS.clueDone : COLOURS.clue;
        ctx.fillText(String(puzzle.rowClue[i]), PAD + CLUE / 2, mid);

        ctx.fillStyle = trouble.cols.has(i) ? COLOURS.clueBad
            : counts.cols[i] === puzzle.colClue[i] ? COLOURS.clueDone : COLOURS.clue;
        ctx.fillText(String(puzzle.colClue[i]), mid, PAD + CLUE / 2);
    }

    renderStatus(bad, trouble);
}

// A palm tree: a leaning trunk under a spray of fronds.
function drawPalm(x, y) {
    const s = cellSize;
    ctx.save();
    ctx.translate(x + s / 2, y + s * 0.78);

    ctx.strokeStyle = COLOURS.trunk;
    ctx.lineWidth = Math.max(2, s * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(s * 0.04, -s * 0.2, -s * 0.03, -s * 0.36);
    ctx.stroke();

    const top = { x: -s * 0.03, y: -s * 0.36 };
    const fronds = [[-1, -0.1], [-0.8, -0.5], [0, -0.62], [0.8, -0.5], [1, -0.1]];
    ctx.lineWidth = Math.max(2, s * 0.07);
    for (let i = 0; i < fronds.length; i++) {
        const [dx, dy] = fronds[i];
        ctx.strokeStyle = i % 2 === 0 ? COLOURS.frond : COLOURS.frondDark;
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.quadraticCurveTo(top.x + dx * s * 0.18, top.y + dy * s * 0.2,
                             top.x + dx * s * 0.3, top.y + dy * s * 0.12 + s * 0.04);
        ctx.stroke();
    }
    ctx.restore();
}

// A booth: two posts under a palm-leaf roof.
function drawBooth(x, y) {
    const s = cellSize;
    ctx.save();
    ctx.translate(x + s / 2, y + s / 2);

    // Roof.
    ctx.fillStyle = COLOURS.boothRoof;
    ctx.beginPath();
    ctx.moveTo(-s * 0.36, -s * 0.06);
    ctx.lineTo(0, -s * 0.34);
    ctx.lineTo(s * 0.36, -s * 0.06);
    ctx.closePath();
    ctx.fill();

    // Thatch lines on the roof.
    ctx.strokeStyle = COLOURS.boothThatch;
    ctx.lineWidth = Math.max(1, s * 0.03);
    for (const t of [-0.2, 0, 0.2]) {
        ctx.beginPath();
        ctx.moveTo(t * s, -s * 0.08);
        ctx.lineTo(t * s * 0.4, -s * 0.3);
        ctx.stroke();
    }

    // Posts.
    ctx.strokeStyle = COLOURS.boothPost;
    ctx.lineWidth = Math.max(2, s * 0.08);
    ctx.lineCap = 'round';
    for (const t of [-0.26, 0.26]) {
        ctx.beginPath();
        ctx.moveTo(t * s, -s * 0.05);
        ctx.lineTo(t * s, s * 0.3);
        ctx.stroke();
    }
    ctx.restore();
}

// Swept sand: a small ruled-out dot.
function drawSand(x, y) {
    const s = cellSize;
    ctx.fillStyle = '#bda173';
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, Math.max(2, s * 0.08), 0, Math.PI * 2);
    ctx.fill();
}

function renderStatus(bad, trouble) {
    const target = LEVELS[levelIndex].booths;
    const pitched = cellsWith(marks, BOOTH).length;
    if (levelLabelEl) levelLabelEl.textContent = LEVELS[levelIndex].name;
    if (boothsLeftEl) boothsLeftEl.textContent = String(Math.max(0, target - pitched));

    if (solved) {
        statusEl.textContent = 'Camp complete — every palm has its booth!';
        statusEl.className = 'good';
        overlay.classList.add('visible');
        overlaySub.textContent =
            `${LEVELS[levelIndex].name} kept in full — ${target} booths beside ${target} palms. ` +
            'Press New Camp for another.';
        return;
    }

    overlay.classList.remove('visible');
    const touching = touchingBooths(marks).size;
    if (touching > 0) {
        statusEl.textContent = `${touching} booths touch — give each one room.`;
        statusEl.className = 'bad';
    } else if (bad.size > 0) {
        statusEl.textContent = 'A booth must stand beside a palm.';
        statusEl.className = 'bad';
    } else if (trouble.rows.size + trouble.cols.size > 0) {
        statusEl.textContent = 'Too many booths for a row or column count.';
        statusEl.className = 'bad';
    } else if (pitched === 0) {
        statusEl.textContent = 'Pitch a booth beside every palm.';
        statusEl.className = '';
    } else {
        statusEl.textContent = `${pitched} of ${target} booths pitched.`;
        statusEl.className = '';
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function cellAt(px, py) {
    const c = Math.floor((px - ORIGIN) / cellSize);
    const r = Math.floor((py - ORIGIN) / cellSize);
    if (!inBounds(r, c, size)) return null;
    return [r, c];
}

function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return [
        (e.clientX - rect.left) * (canvas.width / rect.width),
        (e.clientY - rect.top) * (canvas.height / rect.height),
    ];
}

canvas.addEventListener('click', (e) => {
    const at = cellAt(...canvasPoint(e));
    if (at) cycleCell(at[0], at[1], false);
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const at = cellAt(...canvasPoint(e));
    if (at) cycleCell(at[0], at[1], true);
});

if (btnReset) btnReset.addEventListener('click', resetPuzzle);
if (btnNew) btnNew.addEventListener('click', newPuzzle);
if (btnHint) btnHint.addEventListener('click', giveHint);
levelBtns.forEach((b) => b.addEventListener('click', () => setLevel(Number(b.dataset.level))));

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadPuzzle(0, 1);
