/* Slitherlink — draw a single closed loop that satisfies every numbered clue.
 *
 * Board model
 *   Dots sit on an (rows+1) x (cols+1) lattice. Every edge between two adjacent
 *   dots is one of three states: 0 = empty, 1 = line (part of the loop),
 *   2 = cross (the player's "definitely not part of the loop" mark).
 *
 *   Edge keys:  'H:r:c'  horizontal, dot(r, c) -> dot(r, c+1)   (top side of cell r,c)
 *               'V:r:c'  vertical,   dot(r, c) -> dot(r+1, c)   (left side of cell r,c)
 *
 * Globals are intentionally exposed for the Playwright test suite:
 *   State:   LEVELS, state, level, moves, edges, rows, cols, canvas
 *   Actions: startGame, resetBoard, setEdge, cycleEdge, render, updateHUD
 *   Queries: allEdgeKeys, edgeState, clueValue, linesAroundCell, clueStatus,
 *            dotDegree, isSingleLoop, isSolved, dotPoint, edgeMidpoint,
 *            pointerToEdge
 */

const EMPTY = 0;
const LINE = 1;
const CROSS = 2;

// ---------------------------------------------------------------------------
// Levels. Each clue grid is `rows` x `cols`; null means "no clue". `solution`
// lists the edge keys of the puzzle's (unique) loop and is used by the tests
// and by the built-in solution reveal.
// ---------------------------------------------------------------------------
const LEVELS = [
    {
        name: 'Warm-up',
        rows: 4,
        cols: 4,
        clues: [
            [1, 2, 1, 2],
            [1, 2, 0, 2],
            [0, null, null, 2],
            [null, null, 3, 1],
        ],
        solution: ['H:0:1', 'H:0:2', 'H:0:3', 'H:2:1', 'H:2:3', 'H:4:2', 'V:0:1', 'V:0:4', 'V:1:1', 'V:1:4', 'V:2:2', 'V:2:3', 'V:3:2', 'V:3:3'],
    },
    {
        name: 'Stroll',
        rows: 5,
        cols: 5,
        clues: [
            [0, 0, 0, null, 1],
            [0, 1, 2, 2, 2],
            [null, 3, 2, 0, 1],
            [0, 1, 2, 2, 1],
            [null, 0, 0, null, null],
        ],
        solution: ['H:1:3', 'H:1:4', 'H:2:1', 'H:2:2', 'H:3:1', 'H:3:2', 'H:4:3', 'H:5:4', 'V:1:3', 'V:1:5', 'V:2:1', 'V:2:5', 'V:3:3', 'V:3:5', 'V:4:4', 'V:4:5'],
    },
    {
        name: 'Ramble',
        rows: 6,
        cols: 6,
        clues: [
            [null, null, null, 1, null, 0],
            [2, 1, null, null, 1, null],
            [2, 0, 1, null, 3, null],
            [null, 1, null, null, null, null],
            [null, 3, 2, 1, 0, null],
            [null, null, null, null, null, 0],
        ],
        solution: ['H:0:1', 'H:0:2', 'H:1:0', 'H:1:2', 'H:2:2', 'H:2:3', 'H:2:4', 'H:3:0', 'H:3:4', 'H:4:2', 'H:4:3', 'H:5:1', 'V:0:1', 'V:0:3', 'V:1:0', 'V:1:2', 'V:2:0', 'V:2:5', 'V:3:1', 'V:3:4', 'V:4:1', 'V:4:2'],
    },
    {
        name: 'Winding',
        rows: 7,
        cols: 7,
        clues: [
            [2, null, 2, 2, null, 0, null],
            [2, null, null, null, null, null, null],
            [null, 0, 0, null, 2, 0, null],
            [null, null, null, null, null, null, null],
            [1, null, 2, null, 1, null, 0],
            [2, null, 2, null, null, 0, null],
            [1, null, null, null, null, 0, null],
        ],
        solution: ['H:0:1', 'H:0:2', 'H:1:0', 'H:1:3', 'H:3:4', 'H:4:3', 'H:4:4', 'H:5:2', 'H:6:0', 'H:6:1', 'V:0:1', 'V:0:3', 'V:1:0', 'V:1:4', 'V:2:0', 'V:2:4', 'V:3:0', 'V:3:5', 'V:4:0', 'V:4:3', 'V:5:0', 'V:5:2'],
    },
    {
        name: 'Labyrinth',
        rows: 8,
        cols: 8,
        clues: [
            [null, 1, null, 2, null, null, 2, 2],
            [null, null, null, null, null, 1, null, null],
            [null, null, 2, 0, 0, null, null, 1],
            [null, null, 1, null, null, null, null, null],
            [null, 1, 2, null, null, null, 2, 2],
            [null, null, 1, null, 2, 3, null, null],
            [null, 0, null, 0, null, 1, null, 0],
            [null, null, null, 0, 0, null, null, null],
        ],
        solution: ['H:0:2', 'H:0:3', 'H:0:6', 'H:0:7', 'H:1:2', 'H:1:4', 'H:1:5', 'H:2:2', 'H:4:7', 'H:5:2', 'H:5:3', 'H:5:4', 'H:5:6', 'H:6:5', 'V:0:2', 'V:0:4', 'V:0:6', 'V:0:8', 'V:1:3', 'V:1:8', 'V:2:2', 'V:2:8', 'V:3:2', 'V:3:8', 'V:4:2', 'V:4:7', 'V:5:5', 'V:5:6'],
    },
];

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
let canvas = null;
let ctx = null;
let state = 'ready';       // 'ready' | 'playing' | 'won'
let level = 0;
let moves = 0;
let rows = 0;
let cols = 0;
let clues = [];
let edges = {};            // edge key -> EMPTY | LINE | CROSS
let hoverKey = null;

// Geometry, recomputed per level in layout().
let cell = 60;
let originX = 0;
let originY = 0;

const MAX_CELL = 108;
const MARGIN = 44;

// How long the finished loop stays on screen before the win panel covers it.
const WIN_OVERLAY_DELAY = 700;

// ---------------------------------------------------------------------------
// Board setup
// ---------------------------------------------------------------------------
function allEdgeKeys() {
    const keys = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) keys.push(`H:${r}:${c}`);
    for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) keys.push(`V:${r}:${c}`);
    return keys;
}

function layout() {
    const span = Math.max(rows, cols);
    const size = canvas ? canvas.width : 560;
    cell = Math.min(MAX_CELL, Math.floor((size - 2 * MARGIN) / span));
    originX = Math.round((size - cell * cols) / 2);
    originY = Math.round((size - cell * rows) / 2);
}

function loadLevel(index) {
    level = ((index % LEVELS.length) + LEVELS.length) % LEVELS.length;
    const L = LEVELS[level];
    rows = L.rows;
    cols = L.cols;
    clues = L.clues;
    layout();
    resetBoard();
}

function resetBoard() {
    edges = {};
    for (const key of allEdgeKeys()) edges[key] = EMPTY;
    moves = 0;
    hoverKey = null;
    updateHUD();
    render();
}

function startGame(index) {
    loadLevel(index === undefined ? level : index);
    state = 'playing';
    hideOverlay();
    markActiveLevelButton();
    updateHUD();
    render();
}

// ---------------------------------------------------------------------------
// Edge access
// ---------------------------------------------------------------------------
function edgeState(key) {
    return Object.prototype.hasOwnProperty.call(edges, key) ? edges[key] : EMPTY;
}

/** Low-level setter used by the reveal and the tests; does not count a move. */
function setEdge(key, value) {
    if (!Object.prototype.hasOwnProperty.call(edges, key)) return false;
    edges[key] = value;
    render();
    return true;
}

/** A player move: empty -> line -> cross -> empty (reversed when `backwards`). */
function cycleEdge(key, backwards) {
    if (state !== 'playing') return false;
    if (!Object.prototype.hasOwnProperty.call(edges, key)) return false;
    const forward = { [EMPTY]: LINE, [LINE]: CROSS, [CROSS]: EMPTY };
    const reverse = { [EMPTY]: CROSS, [CROSS]: LINE, [LINE]: EMPTY };
    edges[key] = (backwards ? reverse : forward)[edges[key]];
    moves++;
    if (isSolved()) win();
    updateHUD();
    render();
    return true;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
function clueValue(r, c) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
    const v = clues[r][c];
    return v === undefined ? null : v;
}

function cellEdgeKeys(r, c) {
    return [`H:${r}:${c}`, `H:${r + 1}:${c}`, `V:${r}:${c}`, `V:${r}:${c + 1}`];
}

function linesAroundCell(r, c) {
    return cellEdgeKeys(r, c).filter((k) => edgeState(k) === LINE).length;
}

/** 'blank' (no clue), 'under', 'ok' or 'over'. */
function clueStatus(r, c) {
    const v = clueValue(r, c);
    if (v === null) return 'blank';
    const n = linesAroundCell(r, c);
    if (n === v) return 'ok';
    return n < v ? 'under' : 'over';
}

function unsatisfiedClueCount() {
    let n = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) if (clueStatus(r, c) === 'under' || clueStatus(r, c) === 'over') n++;
    }
    return n;
}

function dotEdgeKeys(r, c) {
    return [
        `H:${r}:${c}`,      // right
        `H:${r}:${c - 1}`,  // left
        `V:${r}:${c}`,      // down
        `V:${r - 1}:${c}`,  // up
    ].filter((k) => Object.prototype.hasOwnProperty.call(edges, k));
}

function dotDegree(r, c) {
    return dotEdgeKeys(r, c).filter((k) => edgeState(k) === LINE).length;
}

/** Every drawn line forms one closed loop: all dots have degree 0 or 2, at
 *  least one line exists, and the lines are all connected to each other. */
function isSingleLoop() {
    const drawn = allEdgeKeys().filter((k) => edgeState(k) === LINE);
    if (drawn.length === 0) return false;

    const adjacency = new Map();   // 'r,c' -> array of neighbouring dot ids
    const link = (a, b) => {
        if (!adjacency.has(a)) adjacency.set(a, []);
        adjacency.get(a).push(b);
    };
    for (const key of drawn) {
        const [type, r, c] = key.split(':');
        const rr = Number(r);
        const cc = Number(c);
        const [a, b] = type === 'H'
            ? [`${rr},${cc}`, `${rr},${cc + 1}`]
            : [`${rr},${cc}`, `${rr + 1},${cc}`];
        link(a, b);
        link(b, a);
    }
    for (const neighbours of adjacency.values()) if (neighbours.length !== 2) return false;

    const start = adjacency.keys().next().value;
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
        for (const n of adjacency.get(stack.pop())) {
            if (!seen.has(n)) { seen.add(n); stack.push(n); }
        }
    }
    return seen.size === adjacency.size;
}

function allCluesSatisfied() {
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const s = clueStatus(r, c);
            if (s === 'under' || s === 'over') return false;
        }
    }
    return true;
}

function isSolved() {
    return allCluesSatisfied() && isSingleLoop();
}

/** Cells enclosed by the loop, by ray casting across vertical lines. */
function interiorCells() {
    const inside = [];
    for (let r = 0; r < rows; r++) {
        let crossings = 0;
        for (let c = 0; c < cols; c++) {
            if (edgeState(`V:${r}:${c}`) === LINE) crossings++;
            if (crossings % 2 === 1) inside.push([r, c]);
        }
    }
    return inside;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
function dotPoint(r, c) {
    return { x: originX + c * cell, y: originY + r * cell };
}

function edgeEndpoints(key) {
    const [type, r, c] = key.split(':');
    const rr = Number(r);
    const cc = Number(c);
    return type === 'H'
        ? [dotPoint(rr, cc), dotPoint(rr, cc + 1)]
        : [dotPoint(rr, cc), dotPoint(rr + 1, cc)];
}

function edgeMidpoint(key) {
    const [a, b] = edgeEndpoints(key);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distanceToSegment(x, y, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((x - a.x) * dx + (y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    return Math.hypot(x - px, y - py);
}

/** Nearest edge to a canvas-space point, or null if nothing is close enough. */
function pointerToEdge(x, y) {
    let best = null;
    let bestDist = cell * 0.42;
    for (const key of allEdgeKeys()) {
        const [a, b] = edgeEndpoints(key);
        const d = distanceToSegment(x, y, a, b);
        if (d < bestDist) { bestDist = d; best = key; }
    }
    return best;
}

function pointerFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
}

// ---------------------------------------------------------------------------
// Winning
// ---------------------------------------------------------------------------
function bestKey(index) {
    return `slitherlink-best-${index}`;
}

function readBest(index) {
    try {
        const raw = localStorage.getItem(bestKey(index));
        return raw === null ? null : Number(raw);
    } catch (e) {
        return null;
    }
}

function writeBest(index, value) {
    try {
        localStorage.setItem(bestKey(index), String(value));
    } catch (e) { /* storage unavailable — best is simply not persisted */ }
}

function win() {
    state = 'won';
    const previous = readBest(level);
    const record = previous === null || moves < previous;
    if (record) writeBest(level, moves);
    updateHUD();
    render();

    // Let the completed loop show for a beat before the panel covers the board.
    const solvedLevel = level;
    setTimeout(() => {
        if (state !== 'won' || level !== solvedLevel) return;
        showOverlay(
            'Solved!',
            `${moves} moves${record ? ' — new best!' : ''}`,
            solvedLevel < LEVELS.length - 1
                ? `Next up: ${LEVELS[solvedLevel + 1].name}`
                : 'That was the last puzzle — press Start to go around again.',
            solvedLevel < LEVELS.length - 1 ? 'Next level' : 'Play again',
        );
    }, WIN_OVERLAY_DELAY);
}

// ---------------------------------------------------------------------------
// DOM chrome
// ---------------------------------------------------------------------------
function showOverlay(title, score, sub, button) {
    document.getElementById('overlay-title').textContent = title;
    document.getElementById('overlay-score').textContent = score;
    document.getElementById('overlay-sub').textContent = sub;
    document.getElementById('btn-start').textContent = button;
    document.getElementById('overlay').classList.add('visible');
}

function hideOverlay() {
    document.getElementById('overlay').classList.remove('visible');
}

function updateHUD() {
    document.getElementById('level').textContent = LEVELS[level].name;
    document.getElementById('moves').textContent = String(moves);
    document.getElementById('remaining').textContent = String(unsatisfiedClueCount());
    const best = readBest(level);
    document.getElementById('best').textContent = best === null ? '—' : String(best);
}

function buildLevelButtons() {
    const host = document.getElementById('levels');
    host.innerHTML = '';
    LEVELS.forEach((L, i) => {
        const btn = document.createElement('button');
        btn.className = 'level-btn';
        btn.textContent = L.name;
        btn.addEventListener('click', () => startGame(i));
        host.appendChild(btn);
    });
    markActiveLevelButton();
}

function markActiveLevelButton() {
    document.querySelectorAll('.level-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === level);
    });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const COLORS = {
    dot: '#54688a',
    line: '#ffd166',
    solvedLine: '#7ef2a5',
    fill: 'rgba(126, 242, 165, 0.10)',
    cross: '#5b4a5f',
    hover: 'rgba(255, 209, 102, 0.35)',
    clueUnder: '#e9f1ff',
    clueOk: '#7ef2a5',
    clueOver: '#ff7b7b',
    clueBlank: '#3d4c66',
};

function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state === 'won') {
        ctx.fillStyle = COLORS.fill;
        for (const [r, c] of interiorCells()) {
            const p = dotPoint(r, c);
            ctx.fillRect(p.x, p.y, cell, cell);
        }
    }

    drawClues();
    drawHover();
    drawCrosses();
    drawLines();
    drawDots();
}

function drawClues() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(cell * 0.42)}px "Segoe UI", system-ui, sans-serif`;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const v = clueValue(r, c);
            if (v === null) continue;
            const status = clueStatus(r, c);
            ctx.fillStyle = status === 'ok' ? COLORS.clueOk
                : status === 'over' ? COLORS.clueOver
                    : COLORS.clueUnder;
            const p = dotPoint(r, c);
            ctx.fillText(String(v), p.x + cell / 2, p.y + cell / 2 + 1);
        }
    }
}

function drawHover() {
    if (!hoverKey || state !== 'playing') return;
    const [a, b] = edgeEndpoints(hoverKey);
    ctx.strokeStyle = COLORS.hover;
    ctx.lineWidth = Math.max(4, cell * 0.11);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
}

function drawLines() {
    ctx.strokeStyle = state === 'won' ? COLORS.solvedLine : COLORS.line;
    ctx.lineWidth = Math.max(4, cell * 0.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const key of allEdgeKeys()) {
        if (edgeState(key) !== LINE) continue;
        const [a, b] = edgeEndpoints(key);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
}

function drawCrosses() {
    ctx.strokeStyle = COLORS.cross;
    ctx.lineWidth = Math.max(2, cell * 0.045);
    ctx.lineCap = 'round';
    const arm = Math.max(3, cell * 0.11);
    ctx.beginPath();
    for (const key of allEdgeKeys()) {
        if (edgeState(key) !== CROSS) continue;
        const m = edgeMidpoint(key);
        ctx.moveTo(m.x - arm, m.y - arm);
        ctx.lineTo(m.x + arm, m.y + arm);
        ctx.moveTo(m.x + arm, m.y - arm);
        ctx.lineTo(m.x - arm, m.y + arm);
    }
    ctx.stroke();
}

function drawDots() {
    const radius = Math.max(2, cell * 0.05);
    ctx.fillStyle = COLORS.dot;
    for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
            const p = dotPoint(r, c);
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function initInput() {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
        if (state !== 'playing') return;
        const p = pointerFromEvent(e);
        const key = pointerToEdge(p.x, p.y);
        if (key) {
            e.preventDefault();
            cycleEdge(key, e.button === 2);
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const p = pointerFromEvent(e);
        const key = pointerToEdge(p.x, p.y);
        if (key !== hoverKey) { hoverKey = key; render(); }
    });

    canvas.addEventListener('mouseleave', () => {
        if (hoverKey !== null) { hoverKey = null; render(); }
    });

    // Touch: a tap toggles the nearest edge forwards.
    canvas.addEventListener('touchstart', (e) => {
        if (state !== 'playing' || !e.touches.length) return;
        const p = pointerFromEvent(e.touches[0]);
        const key = pointerToEdge(p.x, p.y);
        if (key) { e.preventDefault(); cycleEdge(key); }
    }, { passive: false });

    document.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === ' ' || e.code === 'Space') {
            e.preventDefault();
            if (state !== 'playing') startGame(state === 'won' ? nextLevelIndex() : level);
        } else if (k === 'r') {
            startGame(level);
        } else if (k === 'n') {
            startGame(nextLevelIndex());
        }
    });

    document.getElementById('btn-start').addEventListener('click', () => {
        startGame(state === 'won' ? nextLevelIndex() : level);
    });
}

function nextLevelIndex() {
    return (level + 1) % LEVELS.length;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function init() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    buildLevelButtons();
    initInput();
    loadLevel(0);           // draw the first board behind the start overlay
    updateHUD();
    render();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
