/* Hashi (Hashiwokakero / Bridges) — connect numbered islands with bridges.
 *
 * Globals are intentionally exposed for the Playwright test suite:
 *   State:   GRID, state, level, islands, bridges, moves, LEVELS
 *   Actions: startGame, toggleBridge
 *   Queries: neighborsOf, bridgeCount, islandDegree, isSatisfied,
 *            satisfiedCount, allConnected, isSolved, islandIndexAt, pointerToCell
 */

// ---------------------------------------------------------------------------
// Level definitions. Each level lists its islands ({r, c, req}) and a known
// `solution` (array of [i, j, count]) used to guarantee solvability. Island
// indices are the position within the `islands` array.
// ---------------------------------------------------------------------------
const LEVELS = [
    // Level 1 — 5x5 corner loop (gentle intro).
    {
        grid: 5,
        islands: [
            { r: 0, c: 0, req: 2 }, // 0
            { r: 0, c: 4, req: 2 }, // 1
            { r: 4, c: 4, req: 2 }, // 2
            { r: 4, c: 0, req: 2 }, // 3
        ],
        solution: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 0, 1]],
    },
    // Level 2 — 7x7 3x3 lattice with double bridges.
    {
        grid: 7,
        islands: [
            { r: 0, c: 0, req: 3 }, // 0
            { r: 0, c: 3, req: 3 }, // 1
            { r: 0, c: 6, req: 3 }, // 2
            { r: 3, c: 0, req: 3 }, // 3
            { r: 3, c: 3, req: 3 }, // 4
            { r: 3, c: 6, req: 4 }, // 5
            { r: 6, c: 0, req: 3 }, // 6
            { r: 6, c: 3, req: 4 }, // 7
            { r: 6, c: 6, req: 2 }, // 8
        ],
        solution: [
            [0, 1, 2], [1, 2, 1], [0, 3, 1], [2, 5, 2],
            [3, 4, 1], [4, 5, 1], [3, 6, 1], [5, 8, 1],
            [6, 7, 2], [7, 8, 1], [4, 7, 1],
        ],
    },
    // Level 3 — 5x5 octagon; interior islands create crossing choices.
    {
        grid: 5,
        islands: [
            { r: 0, c: 0, req: 2 }, // 0  E
            { r: 0, c: 2, req: 2 }, // 1  C
            { r: 0, c: 4, req: 2 }, // 2  F
            { r: 2, c: 0, req: 2 }, // 3  A
            { r: 2, c: 4, req: 2 }, // 4  B
            { r: 4, c: 0, req: 2 }, // 5  G
            { r: 4, c: 2, req: 2 }, // 6  D
            { r: 4, c: 4, req: 2 }, // 7  I
        ],
        solution: [
            [0, 1, 1], [1, 2, 1], [2, 4, 1], [4, 7, 1],
            [7, 6, 1], [6, 5, 1], [5, 3, 1], [3, 0, 1],
        ],
    },
];

const CANVAS_PX = 560;

// ---------------------------------------------------------------------------
// Mutable game state
// ---------------------------------------------------------------------------
let GRID = LEVELS[0].grid;
let level = 0;
let state = 'ready'; // 'ready' | 'running' | 'won'
let islands = [];    // [{r, c, req}, ...]
let bridges = {};    // "i-j" (sorted) -> count (1 or 2); absent means 0
let neighbors = [];  // index -> [neighbour indices]
let coordIndex = {}; // "r,c" -> island index
let moves = 0;
let selected = null; // currently selected island index (for click-click)
let pressIdx = null; // island pressed on pointerdown

let canvas, ctx;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function key(i, j) {
    return i < j ? i + '-' + j : j + '-' + i;
}

function islandIndexAt(r, c) {
    const k = r + ',' + c;
    return k in coordIndex ? coordIndex[k] : -1;
}

// Straight-line neighbour in a direction (dr, dc); returns index or -1.
function scanNeighbour(i, dr, dc) {
    let r = islands[i].r + dr;
    let c = islands[i].c + dc;
    while (r >= 0 && c >= 0 && r < GRID && c < GRID) {
        const idx = islandIndexAt(r, c);
        if (idx >= 0) return idx;
        r += dr;
        c += dc;
    }
    return -1;
}

function computeNeighbours() {
    neighbors = islands.map((_, i) => {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const out = [];
        for (const [dr, dc] of dirs) {
            const n = scanNeighbour(i, dr, dc);
            if (n >= 0) out.push(n);
        }
        return out;
    });
}

function neighborsOf(i) {
    return neighbors[i] ? neighbors[i].slice() : [];
}

// Grid cells strictly between two aligned islands.
function segmentCells(i, j) {
    const a = islands[i];
    const b = islands[j];
    const cells = [];
    if (a.r === b.r) {
        const lo = Math.min(a.c, b.c);
        const hi = Math.max(a.c, b.c);
        for (let c = lo + 1; c < hi; c++) cells.push(a.r + ',' + c);
    } else if (a.c === b.c) {
        const lo = Math.min(a.r, b.r);
        const hi = Math.max(a.r, b.r);
        for (let r = lo + 1; r < hi; r++) cells.push(r + ',' + a.c);
    }
    return cells;
}

function orientation(i, j) {
    return islands[i].r === islands[j].r ? 'h' : 'v';
}

// Would a new bridge (i, j) cross an existing perpendicular bridge?
function wouldCross(i, j) {
    const seg = new Set(segmentCells(i, j));
    const ori = orientation(i, j);
    for (const k in bridges) {
        if (bridges[k] <= 0) continue;
        const [p, q] = k.split('-').map(Number);
        if (orientation(p, q) === ori) continue; // parallel bridges cannot cross
        for (const cell of segmentCells(p, q)) {
            if (seg.has(cell)) return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
function bridgeCount(i, j) {
    return bridges[key(i, j)] || 0;
}

function islandDegree(i) {
    let d = 0;
    for (const j of neighbors[i]) d += bridgeCount(i, j);
    return d;
}

function isSatisfied(i) {
    return islandDegree(i) === islands[i].req;
}

function satisfiedCount() {
    let n = 0;
    for (let i = 0; i < islands.length; i++) if (isSatisfied(i)) n++;
    return n;
}

function allConnected() {
    if (islands.length === 0) return false;
    const seen = new Array(islands.length).fill(false);
    const stack = [0];
    seen[0] = true;
    let count = 1;
    while (stack.length) {
        const i = stack.pop();
        for (const j of neighbors[i]) {
            if (!seen[j] && bridgeCount(i, j) > 0) {
                seen[j] = true;
                count++;
                stack.push(j);
            }
        }
    }
    return count === islands.length;
}

function isSolved() {
    if (islands.length === 0) return false;
    for (let i = 0; i < islands.length; i++) {
        if (!isSatisfied(i)) return false;
    }
    return allConnected();
}

function pointerToCell(x, y) {
    const cell = CANVAS_PX / GRID;
    return { r: Math.floor(y / cell), c: Math.floor(x / cell) };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function toggleBridge(i, j) {
    if (state !== 'running') return;
    if (i === j || !neighbors[i] || !neighbors[i].includes(j)) return;

    const k = key(i, j);
    const cur = bridges[k] || 0;
    const next = (cur + 1) % 3;

    if (next > cur && cur === 0 && wouldCross(i, j)) return; // crossing blocked

    if (next === 0) delete bridges[k];
    else bridges[k] = next;

    moves++;
    checkWin();
    updateHUD();
    render();
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------
function loadLevel(lv) {
    if (lv != null) level = lv;
    const def = LEVELS[level];
    GRID = def.grid;
    islands = def.islands.map((isl) => ({ r: isl.r, c: isl.c, req: isl.req }));
    coordIndex = {};
    islands.forEach((isl, i) => { coordIndex[isl.r + ',' + isl.c] = i; });
    computeNeighbours();
    bridges = {};
    moves = 0;
    selected = null;
    pressIdx = null;
}

function startGame(lv) {
    loadLevel(lv);
    state = 'running';
    hideOverlay();
    updateHUD();
    updateLevelButtons();
    render();
}

// ---------------------------------------------------------------------------
// Win handling
// ---------------------------------------------------------------------------
function checkWin() {
    if (state === 'running' && isSolved()) {
        state = 'won';
        recordBest();
        showWinOverlay();
    }
}

function bestKey() {
    return 'hashi-best-' + level;
}

function recordBest() {
    let best = null;
    try { best = localStorage.getItem(bestKey()); } catch (e) {}
    const prev = best == null ? Infinity : parseInt(best, 10);
    if (moves < prev) {
        try { localStorage.setItem(bestKey(), String(moves)); } catch (e) {}
    }
}

function readBest() {
    try { return localStorage.getItem(bestKey()); } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// DOM / HUD
// ---------------------------------------------------------------------------
function updateHUD() {
    const satEl = document.getElementById('satisfied');
    const movesEl = document.getElementById('moves');
    const bestEl = document.getElementById('best');
    if (satEl) satEl.textContent = satisfiedCount() + ' / ' + islands.length;
    if (movesEl) movesEl.textContent = String(moves);
    if (bestEl) {
        const b = readBest();
        bestEl.textContent = b == null ? '—' : b;
    }
}

function showOverlay(title, score, sub, btnLabel) {
    const overlay = document.getElementById('overlay');
    document.getElementById('overlay-title').textContent = title;
    document.getElementById('overlay-score').textContent = score || '';
    document.getElementById('overlay-sub').textContent = sub || '';
    document.getElementById('btn-start').textContent = btnLabel || 'Start Game';
    overlay.classList.add('visible');
}

function hideOverlay() {
    document.getElementById('overlay').classList.remove('visible');
}

function showWinOverlay() {
    updateHUD();
    showOverlay(
        'Solved!',
        'Level ' + (level + 1) + ' in ' + moves + ' move' + (moves === 1 ? '' : 's'),
        level < LEVELS.length - 1 ? 'Press N or Start for the next level' : 'You cleared every level!',
        level < LEVELS.length - 1 ? 'Next Level' : 'Play Again'
    );
}

function buildLevelButtons() {
    const wrap = document.getElementById('levels');
    if (!wrap) return;
    wrap.innerHTML = '';
    LEVELS.forEach((lv, i) => {
        const btn = document.createElement('button');
        btn.className = 'level-btn';
        btn.dataset.level = String(i);
        btn.textContent = 'Level ' + (i + 1);
        btn.addEventListener('click', () => startGame(i));
        wrap.appendChild(btn);
    });
    updateLevelButtons();
}

function updateLevelButtons() {
    document.querySelectorAll('.level-btn').forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.level) === level);
    });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function center(i) {
    const cell = CANVAS_PX / GRID;
    return { x: (islands[i].c + 0.5) * cell, y: (islands[i].r + 0.5) * cell };
}

function render() {
    if (!ctx) return;
    const cell = CANVAS_PX / GRID;

    ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
    ctx.fillStyle = '#0f2233';
    ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

    // faint grid dots
    ctx.fillStyle = '#18324a';
    for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
            ctx.beginPath();
            ctx.arc((c + 0.5) * cell, (r + 0.5) * cell, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // bridges
    ctx.strokeStyle = '#6fd3ff';
    ctx.lineWidth = 3;
    for (const k in bridges) {
        const count = bridges[k];
        if (count <= 0) continue;
        const [i, j] = k.split('-').map(Number);
        const a = center(i);
        const b = center(j);
        const horizontal = islands[i].r === islands[j].r;
        const offsets = count === 2 ? [-4, 4] : [0];
        for (const off of offsets) {
            ctx.beginPath();
            if (horizontal) {
                ctx.moveTo(a.x, a.y + off);
                ctx.lineTo(b.x, b.y + off);
            } else {
                ctx.moveTo(a.x + off, a.y);
                ctx.lineTo(b.x + off, b.y);
            }
            ctx.stroke();
        }
    }

    // islands
    const radius = cell * 0.3;
    for (let i = 0; i < islands.length; i++) {
        const p = center(i);
        const satisfied = isSatisfied(i);
        const over = islandDegree(i) > islands[i].req;

        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = over ? '#e0533f' : satisfied ? '#2fa96b' : '#123a57';
        ctx.fill();

        ctx.lineWidth = i === selected ? 4 : 2;
        ctx.strokeStyle = i === selected ? '#ffd24d' : '#6fd3ff';
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold ' + Math.round(radius * 1.1) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(islands[i].req), p.x, p.y + 1);
    }
}

// ---------------------------------------------------------------------------
// Pointer + keyboard wiring
// ---------------------------------------------------------------------------
function eventIsland(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (CANVAS_PX / rect.width);
    const y = (ev.clientY - rect.top) * (CANVAS_PX / rect.height);
    const { r, c } = pointerToCell(x, y);
    return islandIndexAt(r, c);
}

function initInput() {
    canvas.addEventListener('pointerdown', (ev) => {
        if (state !== 'running') return;
        ev.preventDefault();
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
        // Only record what was pressed; the selection is resolved on pointerup so
        // a press does not clobber an already-armed click-click selection.
        pressIdx = eventIsland(ev);
    });

    canvas.addEventListener('pointerup', (ev) => {
        if (state !== 'running') { pressIdx = null; return; }
        const up = eventIsland(ev);
        const start = pressIdx;
        pressIdx = null;

        if (start == null || start < 0) {
            selected = null;
            render();
            return;
        }

        if (up === start) {
            // A click on an island: complete a click-click bridge if one is armed.
            if (selected != null && selected !== up && neighbors[selected] &&
                neighbors[selected].includes(up)) {
                toggleBridge(selected, up);
                selected = null;
            } else {
                selected = up;
            }
        } else if (up >= 0 && neighbors[start] && neighbors[start].includes(up)) {
            // A drag from one island to a neighbour.
            toggleBridge(start, up);
            selected = null;
        } else {
            selected = null;
        }
        render();
    });

    canvas.addEventListener('pointercancel', () => { pressIdx = null; });

    document.addEventListener('keydown', (ev) => {
        const k = ev.key.toLowerCase();
        if (k === 'r') startGame(level);
        else if (k === 'n') startGame((level + 1) % LEVELS.length);
    });

    document.getElementById('btn-start').addEventListener('click', () => {
        if (state === 'won') {
            startGame(level < LEVELS.length - 1 ? level + 1 : 0);
        } else {
            startGame(level);
        }
    });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function init() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    buildLevelButtons();
    initInput();
    loadLevel(0); // populate the board behind the overlay
    updateHUD();
    render();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
