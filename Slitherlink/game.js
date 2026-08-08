// Slitherlink — draw a single closed loop that satisfies every clue.
//
// The generator, the solver and the win check all share one idea: label each
// cell INSIDE or OUTSIDE the loop (everything beyond the grid is OUTSIDE) and an
// edge is a line exactly when the two cells it separates disagree. See DESIGN.md.

const EMPTY = 0;
const LINE = 1;
const CROSS = 2;

const OUT = 0;
const IN = 1;

const CANVAS_SIZE = 560;
const MARGIN = 48;

const DIFFICULTIES = {
    easy: { size: 5, budget: 400000, label: 'Easy' },
    medium: { size: 7, budget: 400000, label: 'Medium' },
    hard: { size: 9, budget: 300000, label: 'Hard' },
};

// ---------------------------------------------------------------------------
// Random numbers (seeded, so puzzles are reproducible)
// ---------------------------------------------------------------------------

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Region helpers (shared by generator, solver and win check)
// ---------------------------------------------------------------------------

// A labelling describes a single simple closed loop iff the INSIDE region is
// non-empty and connected, the OUTSIDE region (including the exterior) is
// connected, and no dot is a diagonal pinch.
function regionValid(label, rows, cols) {
    let count = 0;
    for (let i = 0; i < rows * cols; i++) if (label[i] === IN) count++;
    if (count === 0) return false;

    let start = -1;
    for (let i = 0; i < rows * cols; i++) if (label[i] === IN) { start = i; break; }
    const seen = new Uint8Array(rows * cols);
    let stack = [start], reached = 0;
    seen[start] = 1;
    while (stack.length) {
        const p = stack.pop();
        reached++;
        const r = (p / cols) | 0, c = p % cols;
        if (r > 0 && label[p - cols] === IN && !seen[p - cols]) { seen[p - cols] = 1; stack.push(p - cols); }
        if (r < rows - 1 && label[p + cols] === IN && !seen[p + cols]) { seen[p + cols] = 1; stack.push(p + cols); }
        if (c > 0 && label[p - 1] === IN && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
        if (c < cols - 1 && label[p + 1] === IN && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
    }
    if (reached !== count) return false;

    // Flood the outside from a one-cell ring of padding around the grid.
    const pr = rows + 2, pc = cols + 2;
    const isOut = (r, c) => {
        if (r === 0 || c === 0 || r === pr - 1 || c === pc - 1) return true;
        return label[(r - 1) * cols + (c - 1)] !== IN;
    };
    let outTotal = 0;
    for (let r = 0; r < pr; r++) for (let c = 0; c < pc; c++) if (isOut(r, c)) outTotal++;
    const pseen = new Uint8Array(pr * pc);
    stack = [0];
    pseen[0] = 1;
    let outReached = 0;
    while (stack.length) {
        const p = stack.pop();
        outReached++;
        const r = (p / pc) | 0, c = p % pc;
        const push = (nr, nc) => {
            if (nr < 0 || nc < 0 || nr >= pr || nc >= pc) return;
            const q = nr * pc + nc;
            if (!pseen[q] && isOut(nr, nc)) { pseen[q] = 1; stack.push(q); }
        };
        push(r - 1, c); push(r + 1, c); push(r, c - 1); push(r, c + 1);
    }
    if (outReached !== outTotal) return false;

    const at = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols) ? OUT : label[r * cols + c];
    for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
            const a = at(r - 1, c - 1), b = at(r - 1, c), d = at(r, c - 1), e = at(r, c);
            if (a === e && b === d && a !== b) return false;
        }
    }
    return true;
}

function cluesFromRegion(label, rows, cols) {
    const at = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols) ? OUT : label[r * cols + c];
    const out = new Int8Array(rows * cols);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const me = at(r, c);
            let n = 0;
            if (at(r - 1, c) !== me) n++;
            if (at(r + 1, c) !== me) n++;
            if (at(r, c - 1) !== me) n++;
            if (at(r, c + 1) !== me) n++;
            out[r * cols + c] = n;
        }
    }
    return out;
}

function edgesFromRegion(label, rows, cols) {
    const at = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols) ? OUT : label[r * cols + c];
    const h = [], v = [];
    for (let r = 0; r <= rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) row.push(at(r - 1, c) !== at(r, c) ? LINE : EMPTY);
        h.push(row);
    }
    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c <= cols; c++) row.push(at(r, c - 1) !== at(r, c) ? LINE : EMPTY);
        v.push(row);
    }
    return { H: h, V: v };
}

function growRegion(rows, cols, rand) {
    const label = new Int8Array(rows * cols);
    label[(rows >> 1) * cols + (cols >> 1)] = IN;
    const target = Math.round(rows * cols * (0.35 + rand() * 0.2));
    let size = 1;
    const attempts = rows * cols * 60;
    for (let i = 0; i < attempts; i++) {
        const p = (rand() * rows * cols) | 0;
        const grow = size < target;
        if ((label[p] === IN) === grow) continue;
        label[p] = label[p] === IN ? OUT : IN;
        if (regionValid(label, rows, cols)) size += label[p] === IN ? 1 : -1;
        else label[p] = label[p] === IN ? OUT : IN;
    }
    return label;
}

// ---------------------------------------------------------------------------
// Solver — counts solutions (up to a cap) with a node budget
// ---------------------------------------------------------------------------

function countSolutions(clueList, rows, cols, maxSolutions, budgetNodes) {
    const n = rows * cols;
    const label = new Int8Array(n).fill(-1);
    let solutions = 0;
    let nodes = 0;
    let exhausted = false;

    const at = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols) ? OUT : label[r * cols + c];

    function boundsOk(r, c) {
        if (r < 0 || c < 0 || r >= rows || c >= cols) return true;
        const clue = clueList[r * cols + c];
        if (clue < 0) return true;
        const me = label[r * cols + c];
        if (me < 0) return true;
        let known = 0, unknown = 0;
        const neighbours = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
        for (let i = 0; i < 4; i++) {
            const v = at(neighbours[i][0], neighbours[i][1]);
            if (v < 0) unknown++;
            else if (v !== me) known++;
        }
        return clue >= known && clue <= known + unknown;
    }

    // The dot at (r,c) is the top-left corner of cell (r,c); it is fully
    // determined as soon as that cell is assigned.
    function dotOk(r, c) {
        const a = at(r - 1, c - 1), b = at(r - 1, c), d = at(r, c - 1), e = at(r, c);
        if (a < 0 || b < 0 || d < 0 || e < 0) return true;
        return !(a === e && b === d && a !== b);
    }

    function place(i) {
        if (i === n) {
            if (regionValid(label, rows, cols)) solutions++;
            return;
        }
        const r = (i / cols) | 0, c = i % cols;
        for (let v = 0; v <= 1; v++) {
            if (++nodes > budgetNodes) { exhausted = true; return; }
            label[i] = v;
            if (boundsOk(r, c) && boundsOk(r, c - 1) && boundsOk(r - 1, c) &&
                dotOk(r, c) && (c === cols - 1 ? dotOk(r, c + 1) : true)) {
                place(i + 1);
            }
            label[i] = -1;
            if (exhausted || solutions >= maxSolutions) return;
        }
    }

    place(0);
    return { solutions, exhausted, nodes };
}

// ---------------------------------------------------------------------------
// Puzzle generation
// ---------------------------------------------------------------------------

function generatePuzzle(rows, cols, seed, budgetNodes) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const rand = mulberry32(seed + attempt * 7919);
        const label = growRegion(rows, cols, rand);
        const full = cluesFromRegion(label, rows, cols);
        // A clue of 4 means a one-cell loop; regenerate rather than show it.
        let ok = true;
        for (let i = 0; i < rows * cols; i++) if (full[i] > 3) { ok = false; break; }
        if (!ok) continue;

        const carved = Int8Array.from(full);
        const order = [];
        for (let i = 0; i < rows * cols; i++) order.push(i);
        for (let i = order.length - 1; i > 0; i--) {
            const j = (rand() * (i + 1)) | 0;
            const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
        }
        for (const i of order) {
            const kept = carved[i];
            carved[i] = -1;
            const res = countSolutions(carved, rows, cols, 2, budgetNodes);
            if (res.exhausted || res.solutions !== 1) carved[i] = kept;
        }

        const grid = [];
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < cols; c++) row.push(carved[r * cols + c]);
            grid.push(row);
        }
        return { clues: grid, solution: edgesFromRegion(label, rows, cols) };
    }
    // Should not happen, but never leave the caller without a puzzle.
    const rand = mulberry32(seed);
    const label = growRegion(rows, cols, rand);
    const full = cluesFromRegion(label, rows, cols);
    const grid = [];
    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) row.push(Math.min(3, full[r * cols + c]));
        grid.push(row);
    }
    return { clues: grid, solution: edgesFromRegion(label, rows, cols) };
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

let R = DIFFICULTIES.easy.size;
let C = DIFFICULTIES.easy.size;
let clues = [];
let H = [];
let V = [];
let solution = { H: [], V: [] };

let difficulty = 'easy';
let state = 'playing';
let moves = 0;
let hintsUsed = 0;
let undoStack = [];
let timerStart = 0;
let solvedElapsed = 0;
let spacing = (CANVAS_SIZE - 2 * MARGIN) / C;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elDifficulty = document.getElementById('difficulty');
const elTimer = document.getElementById('timer');
const elMoves = document.getElementById('moves');
const elHints = document.getElementById('hints');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');

function blankEdges() {
    H = [];
    V = [];
    for (let r = 0; r <= R; r++) {
        const row = [];
        for (let c = 0; c < C; c++) row.push(EMPTY);
        H.push(row);
    }
    for (let r = 0; r < R; r++) {
        const row = [];
        for (let c = 0; c <= C; c++) row.push(EMPTY);
        V.push(row);
    }
}

function newGame(diff, seed) {
    if (diff && DIFFICULTIES[diff]) difficulty = diff;
    const conf = DIFFICULTIES[difficulty];
    R = conf.size;
    C = conf.size;
    spacing = (CANVAS_SIZE - 2 * MARGIN) / C;
    const useSeed = (seed === undefined || seed === null)
        ? (Math.random() * 0x7fffffff) | 0
        : (seed | 0);

    const puzzle = generatePuzzle(R, C, useSeed, conf.budget);
    clues = puzzle.clues;
    solution = puzzle.solution;

    blankEdges();
    moves = 0;
    hintsUsed = 0;
    undoStack = [];
    state = 'playing';
    solvedElapsed = 0;
    timerStart = performance.now();
    hideOverlay();
    updateHud();
    return true;
}

function resetBoard() {
    blankEdges();
    moves = 0;
    hintsUsed = 0;
    undoStack = [];
    state = 'playing';
    solvedElapsed = 0;
    timerStart = performance.now();
    hideOverlay();
    updateHud();
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

function inRange(kind, r, c) {
    if (kind === 'h') return r >= 0 && r <= R && c >= 0 && c < C;
    if (kind === 'v') return r >= 0 && r < R && c >= 0 && c <= C;
    return false;
}

function getEdge(kind, r, c) {
    if (!inRange(kind, r, c)) return null;
    return kind === 'h' ? H[r][c] : V[r][c];
}

function writeEdge(kind, r, c, value) {
    if (kind === 'h') H[r][c] = value;
    else V[r][c] = value;
}

function setEdge(kind, r, c, value) {
    if (state !== 'playing') return false;
    if (!inRange(kind, r, c)) return false;
    const previous = getEdge(kind, r, c);
    if (previous === value) return false;
    undoStack.push({ kind, r, c, previous });
    writeEdge(kind, r, c, value);
    moves++;
    updateHud();
    checkSolved();
    return true;
}

function cycleEdge(kind, r, c, backwards) {
    if (!inRange(kind, r, c)) return false;
    const current = getEdge(kind, r, c);
    const forward = [LINE, CROSS, EMPTY];
    const reverse = [CROSS, LINE, EMPTY];
    const order = backwards ? reverse : forward;
    // EMPTY -> order[0], order[0] -> order[1], order[1] -> EMPTY
    let next;
    if (current === EMPTY) next = order[0];
    else if (current === order[0]) next = order[1];
    else next = EMPTY;
    return setEdge(kind, r, c, next);
}

function undo() {
    if (state !== 'playing') return false;
    const last = undoStack.pop();
    if (!last) return false;
    writeEdge(last.kind, last.r, last.c, last.previous);
    moves = Math.max(0, moves - 1);
    updateHud();
    return true;
}

// ---------------------------------------------------------------------------
// Clue bookkeeping
// ---------------------------------------------------------------------------

function clueLineCount(r, c) {
    let n = 0;
    if (H[r][c] === LINE) n++;
    if (H[r + 1][c] === LINE) n++;
    if (V[r][c] === LINE) n++;
    if (V[r][c + 1] === LINE) n++;
    return n;
}

function clueStatus(r, c) {
    if (r < 0 || c < 0 || r >= R || c >= C) return 'none';
    const clue = clues[r][c];
    if (clue < 0) return 'none';
    const n = clueLineCount(r, c);
    if (n > clue) return 'over';
    if (n === clue) return 'ok';
    return 'under';
}

// ---------------------------------------------------------------------------
// Win detection — validated on the edges the player actually drew
// ---------------------------------------------------------------------------

function isSolved() {
    const lines = [];
    for (let r = 0; r <= R; r++) {
        for (let c = 0; c < C; c++) if (H[r][c] === LINE) lines.push(['h', r, c]);
    }
    for (let r = 0; r < R; r++) {
        for (let c = 0; c <= C; c++) if (V[r][c] === LINE) lines.push(['v', r, c]);
    }
    if (lines.length === 0) return false;

    const degree = new Map();
    const adjacency = new Map();
    const key = (r, c) => r * (C + 1) + c;
    const connect = (a, b) => {
        degree.set(a, (degree.get(a) || 0) + 1);
        degree.set(b, (degree.get(b) || 0) + 1);
        if (!adjacency.has(a)) adjacency.set(a, []);
        if (!adjacency.has(b)) adjacency.set(b, []);
        adjacency.get(a).push(b);
        adjacency.get(b).push(a);
    };
    for (const [kind, r, c] of lines) {
        if (kind === 'h') connect(key(r, c), key(r, c + 1));
        else connect(key(r, c), key(r + 1, c));
    }
    for (const [, d] of degree) if (d !== 2) return false;

    const start = degree.keys().next().value;
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
        const dot = stack.pop();
        for (const nb of adjacency.get(dot)) {
            if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
        }
    }
    if (seen.size !== degree.size) return false;

    for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
            if (clues[r][c] < 0) continue;
            if (clueLineCount(r, c) !== clues[r][c]) return false;
        }
    }
    return true;
}

function checkSolved() {
    if (state !== 'playing' || !isSolved()) return false;
    state = 'solved';
    solvedElapsed = Math.floor((performance.now() - timerStart) / 1000);
    const record = saveBest(solvedElapsed);
    overlayTitle.textContent = 'Solved!';
    overlaySub.textContent = `${DIFFICULTIES[difficulty].label} · ${formatTime(solvedElapsed)}`
        + ` · ${moves} move${moves === 1 ? '' : 's'}`
        + (hintsUsed ? ` · ${hintsUsed} hint${hintsUsed === 1 ? '' : 's'}` : '')
        + (record ? ' · new best!' : '');
    overlay.classList.add('visible');
    updateHud();
    return true;
}

// Fills the whole board with the stored solution. Used by the hint chain and by
// the test suite; it writes directly so it does not flood the undo stack.
function applySolution() {
    for (let r = 0; r <= R; r++) {
        for (let c = 0; c < C; c++) H[r][c] = solution.H[r][c];
    }
    for (let r = 0; r < R; r++) {
        for (let c = 0; c <= C; c++) V[r][c] = solution.V[r][c];
    }
    checkSolved();
    updateHud();
    return true;
}

function hint() {
    if (state !== 'playing') return false;
    const contradictions = [];
    const missingLines = [];
    const missingCrosses = [];
    const consider = (kind, r, c, current, want) => {
        if (want === LINE) {
            if (current === CROSS) contradictions.push([kind, r, c, LINE]);
            else if (current === EMPTY) missingLines.push([kind, r, c, LINE]);
        } else if (current === LINE) {
            contradictions.push([kind, r, c, CROSS]);
        } else if (current === EMPTY) {
            missingCrosses.push([kind, r, c, CROSS]);
        }
    };
    for (let r = 0; r <= R; r++) {
        for (let c = 0; c < C; c++) consider('h', r, c, H[r][c], solution.H[r][c]);
    }
    for (let r = 0; r < R; r++) {
        for (let c = 0; c <= C; c++) consider('v', r, c, V[r][c], solution.V[r][c]);
    }
    const pool = contradictions.length ? contradictions
        : missingLines.length ? missingLines
            : missingCrosses;
    if (!pool.length) return false;
    const [kind, r, c, value] = pool[0];
    undoStack.push({ kind, r, c, previous: getEdge(kind, r, c) });
    writeEdge(kind, r, c, value);
    hintsUsed++;
    updateHud();
    checkSolved();
    return true;
}

// ---------------------------------------------------------------------------
// Timing and persistence
// ---------------------------------------------------------------------------

function elapsedSeconds() {
    if (state === 'solved') return solvedElapsed;
    return Math.floor((performance.now() - timerStart) / 1000);
}

function formatTime(seconds) {
    const s = Math.max(0, Math.min(99 * 60 + 59, Math.floor(seconds)));
    return String((s / 60) | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function bestKey() {
    return `slitherlink-best-${difficulty}`;
}

function loadBest() {
    const raw = localStorage.getItem(bestKey());
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
}

function saveBest(seconds) {
    const current = loadBest();
    if (current !== null && current <= seconds) return false;
    localStorage.setItem(bestKey(), String(seconds));
    return true;
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function updateHud() {
    elDifficulty.textContent = DIFFICULTIES[difficulty].label;
    elTimer.textContent = formatTime(elapsedSeconds());
    elMoves.textContent = String(moves);
    elHints.textContent = String(hintsUsed);
    const best = loadBest();
    elBest.textContent = best === null ? '--:--' : formatTime(best);
    for (const name of Object.keys(DIFFICULTIES)) {
        document.getElementById(`btn-${name}`).classList.toggle('active', name === difficulty);
    }
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Geometry and input
// ---------------------------------------------------------------------------

function dotPos(r, c) {
    return { x: MARGIN + c * spacing, y: MARGIN + r * spacing };
}

function edgeAtPoint(x, y) {
    const u = (x - MARGIN) / spacing;
    const v = (y - MARGIN) / spacing;

    let best = null;
    let bestDist = 0.4;

    const hr = Math.round(v);
    const hc = Math.floor(u);
    if (hr >= 0 && hr <= R && hc >= 0 && hc < C) {
        const d = Math.abs(v - hr);
        if (d < bestDist) { best = { kind: 'h', r: hr, c: hc }; bestDist = d; }
    }

    const vc = Math.round(u);
    const vr = Math.floor(v);
    if (vr >= 0 && vr < R && vc >= 0 && vc <= C) {
        const d = Math.abs(u - vc);
        if (d < bestDist) { best = { kind: 'v', r: vr, c: vc }; bestDist = d; }
    }

    return best;
}

function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * (CANVAS_SIZE / rect.width),
        y: (event.clientY - rect.top) * (CANVAS_SIZE / rect.height),
    };
}

canvas.addEventListener('click', (event) => {
    const p = canvasPoint(event);
    const hit = edgeAtPoint(p.x, p.y);
    if (hit) cycleEdge(hit.kind, hit.r, hit.c, false);
});

canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const p = canvasPoint(event);
    const hit = edgeAtPoint(p.x, p.y);
    if (hit) cycleEdge(hit.kind, hit.r, hit.c, true);
});

window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'n') { newGame(); event.preventDefault(); }
    else if (key === 'u') { undo(); event.preventDefault(); }
    else if (key === 'r') { resetBoard(); event.preventDefault(); }
    else if (key === 'h') { hint(); event.preventDefault(); }
    else if (key === '1') { newGame('easy'); event.preventDefault(); }
    else if (key === '2') { newGame('medium'); event.preventDefault(); }
    else if (key === '3') { newGame('hard'); event.preventDefault(); }
});

document.getElementById('btn-new').addEventListener('click', () => newGame());
document.getElementById('btn-again').addEventListener('click', () => newGame());
document.getElementById('btn-undo').addEventListener('click', () => undo());
document.getElementById('btn-reset').addEventListener('click', () => resetBoard());
document.getElementById('btn-hint').addEventListener('click', () => hint());
document.getElementById('btn-easy').addEventListener('click', () => newGame('easy'));
document.getElementById('btn-medium').addEventListener('click', () => newGame('medium'));
document.getElementById('btn-hard').addEventListener('click', () => newGame('hard'));

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // crosses
    ctx.strokeStyle = '#3d4b6d';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const crossArm = Math.min(6, spacing * 0.12);
    const drawCross = (x, y) => {
        ctx.beginPath();
        ctx.moveTo(x - crossArm, y - crossArm);
        ctx.lineTo(x + crossArm, y + crossArm);
        ctx.moveTo(x + crossArm, y - crossArm);
        ctx.lineTo(x - crossArm, y + crossArm);
        ctx.stroke();
    };
    for (let r = 0; r <= R; r++) {
        for (let c = 0; c < C; c++) {
            if (H[r][c] !== CROSS) continue;
            const a = dotPos(r, c);
            drawCross(a.x + spacing / 2, a.y);
        }
    }
    for (let r = 0; r < R; r++) {
        for (let c = 0; c <= C; c++) {
            if (V[r][c] !== CROSS) continue;
            const a = dotPos(r, c);
            drawCross(a.x, a.y + spacing / 2);
        }
    }

    // clue digits
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(spacing * 0.42)}px "Segoe UI", system-ui, sans-serif`;
    for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
            const clue = clues[r][c];
            if (clue < 0) continue;
            const status = clueStatus(r, c);
            ctx.fillStyle = status === 'over' ? '#f87171'
                : status === 'ok' ? '#59688a'
                    : '#e2e8f0';
            const a = dotPos(r, c);
            ctx.fillText(String(clue), a.x + spacing / 2, a.y + spacing / 2 + 1);
        }
    }

    // loop
    const solved = state === 'solved';
    ctx.strokeStyle = solved ? '#4ade80' : '#fbbf24';
    ctx.lineWidth = Math.max(3, spacing * 0.09);
    ctx.lineCap = 'round';
    ctx.shadowColor = solved ? 'rgba(74, 222, 128, 0.55)' : 'rgba(251, 191, 36, 0.35)';
    ctx.shadowBlur = solved ? 14 : 6;
    ctx.beginPath();
    for (let r = 0; r <= R; r++) {
        for (let c = 0; c < C; c++) {
            if (H[r][c] !== LINE) continue;
            const a = dotPos(r, c), b = dotPos(r, c + 1);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
        }
    }
    for (let r = 0; r < R; r++) {
        for (let c = 0; c <= C; c++) {
            if (V[r][c] !== LINE) continue;
            const a = dotPos(r, c), b = dotPos(r + 1, c);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
        }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // dots on top
    ctx.fillStyle = '#5b6c93';
    const dotR = Math.max(2, spacing * 0.045);
    for (let r = 0; r <= R; r++) {
        for (let c = 0; c <= C; c++) {
            const a = dotPos(r, c);
            ctx.beginPath();
            ctx.arc(a.x, a.y, dotR, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function frame() {
    if (state === 'playing') elTimer.textContent = formatTime(elapsedSeconds());
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

newGame('easy');
requestAnimationFrame(frame);
