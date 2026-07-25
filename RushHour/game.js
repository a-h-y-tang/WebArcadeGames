// ---------------------------------------------------------------------------
// Rush Hour — the sliding-block "unblock the red car" puzzle on the HTML5
// canvas.
//
// The board is a 6×6 grid holding vehicles ({id, r, c, len, orient}). Each
// vehicle slides only along its own axis and no two may overlap. The rules —
// parseLevel / buildGrid / cellsOf / canMove / moveVehicle / isWon — are pure
// functions over the vehicle list, kept separate from rendering, so the
// Playwright suite (including a BFS that proves every level is solvable) can
// build an exact position and assert the outcome with zero timing dependence.
// ---------------------------------------------------------------------------

const CELLS = 6;             // 6×6 board
const CELL = 80;             // 480 / 6
const W = CELLS * CELL;
const H = CELLS * CELL;
const EXIT_ROW = 2;          // the red car's row, exit on the right wall

// Bundled puzzles, authored as 6×6 text grids ('.' empty, letters = vehicles,
// 'X' = the red target car). Ordered easy → hard. Every one is proven solvable
// and not-already-solved by the BFS test in tests/rushhour.spec.js.
const LEVELS = [
    [
        '...A..',
        '...A..',
        'XX.A..',
        '......',
        '......',
        '......',
    ],
    [
        '...QQ.',
        '...P..',
        'XX.P..',
        '......',
        '......',
        '......',
    ],
    [
        '...A..',
        '...A..',
        'XXBA..',
        '..B...',
        '......',
        '......',
    ],
    [
        'AABB..',
        '....C.',
        'XX.DC.',
        '...D..',
        '..EE..',
        '......',
    ],
];

// Colours keyed by vehicle id (X is always the red target).
const CLR = {
    bg:      '#141b24',
    gridLine: 'rgba(120,140,180,0.10)',
    hole:    '#0c121a',
    exit:    '#f43f5e',
    target:  '#f43f5e',
    targetEdge: '#fb7185',
    ink:     '#0b0f14',
    select:  '#ffd166',
};

const PALETTE = [
    '#38bdf8', '#34d399', '#a78bfa', '#f59e0b',
    '#22d3ee', '#84cc16', '#e879f9', '#fbbf24',
    '#60a5fa', '#4ade80', '#c084fc', '#fb923c',
];

// --- DOM -------------------------------------------------------------------
const canvas       = document.getElementById('canvas');
const ctx          = canvas.getContext('2d');
const movesEl      = document.getElementById('moves');
const levelEl      = document.getElementById('level');
const bestEl       = document.getElementById('best');
const overlay      = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub   = document.getElementById('overlay-sub');
const btnStart     = document.getElementById('btn-start');

// --- State (var so tests can reach it as window.*) -------------------------
var vehicles, level, moves, best, state, selectedId;

// --- Level parsing ---------------------------------------------------------
// Turn a 6-row text grid into a list of vehicle objects.
function parseLevel(rows) {
    const cellsById = {};
    for (let r = 0; r < rows.length; r++) {
        const line = rows[r];
        for (let c = 0; c < line.length; c++) {
            const ch = line[c];
            if (ch === '.' || ch === ' ') continue;
            (cellsById[ch] = cellsById[ch] || []).push([r, c]);
        }
    }
    const list = [];
    for (const id of Object.keys(cellsById)) {
        const cells = cellsById[id];
        const rowsUsed = new Set(cells.map(([r]) => r));
        const colsUsed = new Set(cells.map(([, c]) => c));
        const orient = rowsUsed.size === 1 ? 'H' : 'V';
        const r = Math.min(...cells.map(([rr]) => rr));
        const c = Math.min(...cells.map(([, cc]) => cc));
        list.push({ id, r, c, len: cells.length, orient });
    }
    return list;
}

// --- Pure board helpers ----------------------------------------------------
function cellsOf(v) {
    const out = [];
    for (let i = 0; i < v.len; i++) {
        if (v.orient === 'H') out.push([v.r, v.c + i]);
        else out.push([v.r + i, v.c]);
    }
    return out;
}

function emptyGrid() {
    return Array.from({ length: CELLS }, () => Array(CELLS).fill(null));
}

// Full occupancy grid — every cell holds a vehicle id or null.
function buildGrid(vs) {
    const g = emptyGrid();
    for (const v of vs) {
        for (const [r, c] of cellsOf(v)) {
            if (r >= 0 && r < CELLS && c >= 0 && c < CELLS) g[r][c] = v.id;
        }
    }
    return g;
}

// Occupancy of every vehicle *except* `id` — used to test a candidate slide.
function othersGrid(vs, id) {
    const g = emptyGrid();
    for (const v of vs) {
        if (v.id === id) continue;
        for (const [r, c] of cellsOf(v)) g[r][c] = v.id;
    }
    return g;
}

function findVehicle(vs, id) {
    return vs.find(v => v.id === id) || null;
}

// Can vehicle `id` slide `delta` cells along its axis (sign = direction)?
// Every cell swept must stay on the board and be free of other vehicles.
function canMove(vs, id, delta) {
    const v = findVehicle(vs, id);
    if (!v || delta === 0) return false;
    const g = othersGrid(vs, id);
    const step = delta > 0 ? 1 : -1;
    let r = v.r, c = v.c;
    for (let s = 0; s < Math.abs(delta); s++) {
        let nr, nc;
        if (v.orient === 'H') { nr = r; nc = step > 0 ? c + v.len : c - 1; }
        else                  { nc = c; nr = step > 0 ? r + v.len : r - 1; }
        if (nr < 0 || nr >= CELLS || nc < 0 || nc >= CELLS) return false;
        if (g[nr][nc] !== null) return false;
        if (v.orient === 'H') c += step; else r += step;
    }
    return true;
}

// Win: the red target car has reached the right wall on the exit row.
function isWon(vs) {
    const x = findVehicle(vs, 'X');
    if (!x) return false;
    return x.r === EXIT_ROW && x.c + x.len - 1 === CELLS - 1;
}

// --- Move logic ------------------------------------------------------------
function moveVehicle(id, delta) {
    if (state !== 'playing') return false;
    if (!canMove(vehicles, id, delta)) return false;
    const v = findVehicle(vehicles, id);
    if (v.orient === 'H') v.c += delta; else v.r += delta;
    moves++;
    updateHud();
    draw();
    checkWin();
    return true;
}

// Slide the selected vehicle one cell along an arrow direction.
function slideSelected(dir) {
    const v = findVehicle(vehicles, selectedId);
    if (!v) return false;
    if (v.orient === 'H') {
        if (dir === 'left')  return moveVehicle(v.id, -1);
        if (dir === 'right') return moveVehicle(v.id, 1);
    } else {
        if (dir === 'up')   return moveVehicle(v.id, -1);
        if (dir === 'down') return moveVehicle(v.id, 1);
    }
    return false;
}

// Slide the selected vehicle as far as it legally can toward a target cell.
function slideToward(v, r, c) {
    let want;
    if (v.orient === 'H') want = c - v.c;         // desired column shift
    else want = r - v.r;                          // desired row shift
    if (want === 0) return false;
    const dir = want > 0 ? 1 : -1;
    for (let mag = Math.abs(want); mag >= 1; mag--) {
        if (canMove(vehicles, v.id, dir * mag)) return moveVehicle(v.id, dir * mag);
    }
    return false;
}

function checkWin() {
    if (isWon(vehicles)) win();
}

// --- Lifecycle -------------------------------------------------------------
function loadLevel(i) {
    level = ((i % LEVELS.length) + LEVELS.length) % LEVELS.length;
    vehicles = parseLevel(LEVELS[level]);
    moves = 0;
    selectedId = null;
    state = 'playing';
    overlay.classList.remove('visible');
    btnStart.blur();
    updateHud();
    draw();
}

function startGame() {
    loadLevel(0);
}

function restartLevel() {
    vehicles = parseLevel(LEVELS[level]);
    moves = 0;
    selectedId = null;
    state = 'playing';
    updateHud();
    draw();
}

function nextLevel() {
    loadLevel(level + 1);
}

function win() {
    state = 'won';
    selectedId = null;
    if (best === null || moves < best) {
        best = moves;
        localStorage.setItem('rushhour-best', best);
    }
    updateHud();
    draw();
    overlayTitle.textContent = 'Solved!';
    overlayScore.textContent = `${moves} move${moves === 1 ? '' : 's'}`;
    overlaySub.textContent = 'Press any key or the button for the next level';
    btnStart.textContent = 'Next Level';
    overlay.classList.add('visible');
}

function updateHud() {
    movesEl.textContent = moves;
    levelEl.textContent = level + 1;
    bestEl.textContent = best === null ? '—' : best;
}

// --- Rendering -------------------------------------------------------------
function colorFor(id) {
    if (id === 'X') return { fill: CLR.target, edge: CLR.targetEdge };
    // Deterministic colour from the id's char code.
    const idx = (id.charCodeAt(0) * 7) % PALETTE.length;
    const fill = PALETTE[idx];
    return { fill, edge: fill };
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, W, H);

    // Grid cells (recessed holes).
    for (let r = 0; r < CELLS; r++) {
        for (let c = 0; c < CELLS; c++) {
            const x = c * CELL, y = r * CELL;
            ctx.fillStyle = CLR.hole;
            roundRect(x + 5, y + 5, CELL - 10, CELL - 10, 8);
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = CLR.gridLine;
            roundRect(x + 5.5, y + 5.5, CELL - 11, CELL - 11, 8);
            ctx.stroke();
        }
    }

    // Exit notch on the right wall of the exit row.
    ctx.fillStyle = CLR.exit;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(W - 4, EXIT_ROW * CELL + 14, 4, CELL - 28);
    ctx.globalAlpha = 1;

    // Vehicles.
    if (vehicles) {
        for (const v of vehicles) {
            const inset = 8;
            const x = v.c * CELL + inset;
            const y = v.r * CELL + inset;
            const w = (v.orient === 'H' ? v.len : 1) * CELL - inset * 2;
            const h = (v.orient === 'V' ? v.len : 1) * CELL - inset * 2;
            const { fill, edge } = colorFor(v.id);

            const grad = ctx.createLinearGradient(x, y, x, y + h);
            grad.addColorStop(0, edge);
            grad.addColorStop(1, fill);
            ctx.fillStyle = grad;
            ctx.shadowColor = 'rgba(0,0,0,0.45)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 3;
            roundRect(x, y, w, h, 12);
            ctx.fill();
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;

            // Windscreen accent for a car-ish look.
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            if (v.orient === 'H') roundRect(x + w * 0.62, y + 6, w * 0.28, h - 12, 6);
            else roundRect(x + 6, y + h * 0.62, w - 12, h * 0.28, 6);
            ctx.fill();

            if (v.id === selectedId) {
                ctx.lineWidth = 3;
                ctx.strokeStyle = CLR.select;
                roundRect(x - 1, y - 1, w + 2, h + 2, 13);
                ctx.stroke();
            }
        }
    }
}

// --- Input -----------------------------------------------------------------
function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    return { r: Math.floor(y / CELL), c: Math.floor(x / CELL) };
}

canvas.addEventListener('click', e => {
    if (state !== 'playing') return;
    const { r, c } = cellFromEvent(e);
    if (r < 0 || r >= CELLS || c < 0 || c >= CELLS) return;
    const g = buildGrid(vehicles);
    const id = g[r][c];
    if (id) {
        selectedId = id;                 // clicked a vehicle → select it
        draw();
    } else if (selectedId) {
        const v = findVehicle(vehicles, selectedId);
        // Only slide when the target cell lies on the vehicle's axis line.
        if (v && ((v.orient === 'H' && r === v.r) || (v.orient === 'V' && c === v.c))) {
            slideToward(v, r, c);
        }
    }
});

const ARROWS = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
};

document.addEventListener('keydown', e => {
    if (state === 'idle') { startGame(); e.preventDefault(); return; }
    if (state === 'won') { nextLevel(); e.preventDefault(); return; }
    // playing
    if (ARROWS[e.key]) { slideSelected(ARROWS[e.key]); e.preventDefault(); }
    else if (e.key === 'r' || e.key === 'R') { restartLevel(); }
    else if (e.key === 'n' || e.key === 'N') { nextLevel(); }
});

btnStart.addEventListener('click', () => {
    if (state === 'won') nextLevel();
    else startGame();
    btnStart.blur();
});

// --- Init ------------------------------------------------------------------
const storedBest = localStorage.getItem('rushhour-best');
best = storedBest === null ? null : parseInt(storedBest, 10);
level = 0;
moves = 0;
selectedId = null;
state = 'idle';
vehicles = parseLevel(LEVELS[0]);     // shown behind the title overlay
updateHud();
draw();
