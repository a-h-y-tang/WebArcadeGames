// ---------------------------------------------------------------------------
// Untangle (Planarity) — drag the nodes until no edges cross.
//
// State and helpers are intentionally kept as top-level globals so the
// Playwright suite can drive the game deterministically (see tests/).
// Mutable state uses `var` so it is reachable both by bare name and as a
// property of `window` from page.evaluate.
// ---------------------------------------------------------------------------

const W = 500, H = 500;
const NODE_R = 11;          // drawn node radius
const HIT_R = 18;           // grab radius for hit-testing
const NODE_COUNTS = { easy: 6, medium: 9, hard: 12 };

// Colours
const BG = '#0d1117';
const EDGE_OK = '#3f6f8f';       // calm blue-grey for clear edges
const EDGE_CROSS = '#f87171';    // red for edges that still cross something
const NODE_FILL = '#e6edf3';
const NODE_RING = '#38bdf8';
const NODE_HOT = '#fbbf24';      // node under cursor / being dragged

// --- Exposed mutable state ---
var nodes = [];             // [{x, y}, ...] current positions
var edges = [];             // [[a, b], ...] index pairs
var state = 'idle';         // 'idle' | 'running' | 'won'
var moves = 0;
var difficulty = 'medium';
var nodeCount = NODE_COUNTS[difficulty];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const crossingsEl = document.getElementById('crossings');
const movesEl = document.getElementById('moves');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnNew = document.getElementById('btn-new');

// --- Seedable PRNG (mulberry32) for reproducible puzzles ---
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

// Signed area sign of triangle (a, b, c).
function orient(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// Do segments p1p2 and p3p4 PROPERLY cross? Proper means they intersect at a
// point interior to both segments. Segments that share an endpoint, or merely
// touch (an endpoint lying on the other segment), do NOT count.
function segmentsIntersect(p1, p2, p3, p4) {
    const d1 = orient(p3, p4, p1);
    const d2 = orient(p3, p4, p2);
    const d3 = orient(p1, p2, p3);
    const d4 = orient(p1, p2, p4);
    return (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
            ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)));
}

// Number of properly-crossing edge pairs at the current node positions. Edges
// that share a node are skipped (they can never properly cross).
function countCrossings() {
    let c = 0;
    for (let i = 0; i < edges.length; i++) {
        const [a, b] = edges[i];
        for (let j = i + 1; j < edges.length; j++) {
            const [d, e] = edges[j];
            if (a === d || a === e || b === d || b === e) continue;
            if (segmentsIntersect(nodes[a], nodes[b], nodes[d], nodes[e])) c++;
        }
    }
    return c;
}

function isSolved() {
    return countCrossings() === 0;
}

// Boolean flag per edge: is it involved in at least one crossing? (For colour.)
function crossingEdgeFlags() {
    const flag = new Array(edges.length).fill(false);
    for (let i = 0; i < edges.length; i++) {
        const [a, b] = edges[i];
        for (let j = i + 1; j < edges.length; j++) {
            const [d, e] = edges[j];
            if (a === d || a === e || b === d || b === e) continue;
            if (segmentsIntersect(nodes[a], nodes[b], nodes[d], nodes[e])) {
                flag[i] = true; flag[j] = true;
            }
        }
    }
    return flag;
}

// ---------------------------------------------------------------------------
// Puzzle generation
//
// Edges come from a triangulation of the node INDICES 0..n-1 treated as a
// convex polygon (cyclic order). Every such edge is a chord of a convex
// polygon, so laying the nodes out on a circle in index order is always a
// crossing-free solution — the puzzle is guaranteed solvable. Displayed node
// positions are then scattered randomly (the tangle).
// ---------------------------------------------------------------------------

function buildEdges(rng, n) {
    const set = new Set();
    const add = (a, b) => set.add(a < b ? a + '-' + b : b + '-' + a);

    for (let i = 0; i < n; i++) add(i, (i + 1) % n);   // convex boundary

    (function triangulate(lo, hi) {
        if (hi - lo < 2) return;
        const k = lo + 1 + Math.floor(rng() * (hi - lo - 1));   // apex in (lo, hi)
        add(lo, k);
        add(k, hi);
        triangulate(lo, k);
        triangulate(k, hi);
    })(0, n - 1);

    return [...set].map(s => s.split('-').map(Number));
}

function scatter(rng, n) {
    const MARGIN = 46;
    const lo = MARGIN, hi = W - MARGIN;
    const minD = n <= 6 ? 92 : n <= 9 ? 72 : 56;
    const pts = [];
    for (let i = 0; i < n; i++) {
        let x, y, ok = false, att = 0;
        do {
            x = lo + rng() * (hi - lo);
            y = lo + rng() * (hi - lo);
            ok = pts.every(p => {
                const dx = p.x - x, dy = p.y - y;
                return dx * dx + dy * dy >= minD * minD;
            });
            att++;
        } while (!ok && att < 250);
        pts.push({ x, y });
    }
    return pts;
}

function generate(seed) {
    const rng = mulberry32(seed);
    nodeCount = NODE_COUNTS[difficulty];
    const n = nodeCount;
    edges = buildEdges(rng, n);

    // Scatter until the start is actually tangled (essentially always the
    // first try for a triangulation, but never present an already-solved board).
    let tries = 0;
    do {
        nodes = scatter(rng, n);
        tries++;
    } while (countCrossings() === 0 && tries < 40);
}

// ---------------------------------------------------------------------------
// Hit testing & moving
// ---------------------------------------------------------------------------

// Index of the node nearest to (x, y) within HIT_R, else -1.
function nodeAt(x, y) {
    let best = -1, bd = Infinity;
    const r2 = HIT_R * HIT_R;
    for (let i = 0; i < nodes.length; i++) {
        const dx = nodes[i].x - x, dy = nodes[i].y - y;
        const d = dx * dx + dy * dy;
        if (d <= r2 && d < bd) { bd = d; best = i; }
    }
    return best;
}

// Reposition a node (clamped to the canvas). Updates the display and, if this
// makes the board crossing-free during play, triggers a win.
function moveNode(i, x, y) {
    if (i < 0 || i >= nodes.length) return;
    nodes[i].x = clamp(x, NODE_R, W - NODE_R);
    nodes[i].y = clamp(y, NODE_R, H - NODE_R);
    updateCrossingsHud();
    draw();
    if (state === 'running' && isSolved()) win();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function startGame(seed) {
    const s = (seed === undefined || seed === null) ? (Date.now() >>> 0) : (seed >>> 0);
    generate(s);
    moves = 0;
    state = 'running';
    updateMovesHud();
    updateCrossingsHud();
    updateBestHud();
    hideOverlay();
    draw();
}

function setDifficulty(name) {
    if (!(name in NODE_COUNTS)) return;
    difficulty = name;
    nodeCount = NODE_COUNTS[name];
    highlightDifficulty();
    startGame();
}

function win() {
    if (state === 'won') return;
    state = 'won';
    commitBest();
    overlayTitle.textContent = 'Untangled! 🎉';
    overlayScore.textContent = `${moves} move${moves === 1 ? '' : 's'}`;
    overlaySub.textContent = 'Every edge is clear. Try a harder tangle?';
    btnStart.textContent = 'New Puzzle';
    showOverlay();
    draw();
}

// ---------------------------------------------------------------------------
// Best score (per difficulty / node count)
// ---------------------------------------------------------------------------

function bestKey() { return 'untangle-best-' + nodeCount; }

function readBest() {
    try {
        const v = parseInt(localStorage.getItem(bestKey()), 10);
        return Number.isNaN(v) ? null : v;
    } catch (e) { return null; }
}

function commitBest() {
    const prev = readBest();
    if (prev === null || moves < prev) {
        try { localStorage.setItem(bestKey(), String(moves)); } catch (e) {}
    }
    updateBestHud();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateCrossingsHud() { crossingsEl.textContent = countCrossings(); }
function updateMovesHud() { movesEl.textContent = moves; }
function updateBestHud() {
    const b = readBest();
    bestEl.textContent = b === null ? '—' : b;
}
function showOverlay() { overlay.classList.add('visible'); }
function hideOverlay() { overlay.classList.remove('visible'); }

function highlightDifficulty() {
    document.querySelectorAll('.diff').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.diff === difficulty);
    });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

let hoverIndex = -1;

function draw() {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    const cross = crossingEdgeFlags();

    // Clear (non-crossing) edges first, crossing edges on top so they read.
    ctx.lineWidth = 2;
    for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < edges.length; i++) {
            if ((pass === 0) === cross[i]) continue;
            const [a, b] = edges[i];
            ctx.strokeStyle = cross[i] ? EDGE_CROSS : EDGE_OK;
            ctx.beginPath();
            ctx.moveTo(nodes[a].x, nodes[a].y);
            ctx.lineTo(nodes[b].x, nodes[b].y);
            ctx.stroke();
        }
    }

    // Nodes.
    for (let i = 0; i < nodes.length; i++) {
        const p = nodes[i];
        const hot = i === dragIndex || i === hoverIndex;
        ctx.beginPath();
        ctx.arc(p.x, p.y, NODE_R, 0, Math.PI * 2);
        ctx.fillStyle = NODE_FILL;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = hot ? NODE_HOT : NODE_RING;
        ctx.stroke();
    }
}

// ---------------------------------------------------------------------------
// Input — pointer (mouse + touch) dragging
// ---------------------------------------------------------------------------

let dragIndex = -1;
let dragStart = null;
let dragCounted = false;

function toCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
}

canvas.addEventListener('pointerdown', e => {
    if (state !== 'running') return;
    const { x, y } = toCanvas(e);
    const i = nodeAt(x, y);
    if (i === -1) return;
    dragIndex = i;
    dragStart = { x: nodes[i].x, y: nodes[i].y };
    dragCounted = false;
    hoverIndex = i;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    draw();
    e.preventDefault();
});

canvas.addEventListener('pointermove', e => {
    const { x, y } = toCanvas(e);
    if (dragIndex === -1) {
        // Hover highlight only.
        const h = state === 'running' ? nodeAt(x, y) : -1;
        if (h !== hoverIndex) { hoverIndex = h; draw(); }
        return;
    }
    if (!dragCounted) {           // first real movement of this drag = one move
        moves++;
        updateMovesHud();
        dragCounted = true;
    }
    moveNode(dragIndex, x, y);    // may trigger win, with this move already counted
    e.preventDefault();
});

function endDrag(e) {
    if (dragIndex === -1) return;
    const i = dragIndex;
    // If the node never actually moved from where it was grabbed, it was a
    // click, not a move — roll the optimistic count back.
    if (dragCounted && nodes[i].x === dragStart.x && nodes[i].y === dragStart.y) {
        moves--;
        updateMovesHud();
    }
    dragIndex = -1;
    dragStart = null;
    dragCounted = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    draw();
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------------------
// Input — keyboard & buttons
// ---------------------------------------------------------------------------

document.addEventListener('keydown', e => {
    if (e.key === '1') { setDifficulty('easy'); e.preventDefault(); return; }
    if (e.key === '2') { setDifficulty('medium'); e.preventDefault(); return; }
    if (e.key === '3') { setDifficulty('hard'); e.preventDefault(); return; }
    if (e.key === 'n' || e.key === 'N' || e.key === 'r' || e.key === 'R') {
        startGame();
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => startGame());
btnNew.addEventListener('click', () => startGame());
document.querySelectorAll('.diff').forEach(btn => {
    btn.addEventListener('click', () => setDifficulty(btn.dataset.diff));
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
    highlightDifficulty();
    generate(Date.now() >>> 0);
    state = 'idle';
    moves = 0;
    updateMovesHud();
    updateCrossingsHud();
    updateBestHud();
    draw();
}

init();
