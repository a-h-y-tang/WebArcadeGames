// ---------------------------------------------------------------------------
// Kakuro ("Cross Sums") — a number-crossword logic puzzle on an HTML5 canvas.
//
// Written as a single classic (non-module) script so all state and logic are
// reachable from the Playwright tests as plain globals, mirroring Sudoku,
// Nonogram and Snake in this repo. Puzzle clue sums are DERIVED from each
// puzzle's bundled solution at load time, so the data can never carry an
// inconsistent hand-typed sum. The timer is advanced through `tick(dt)`,
// separate from all puzzle logic, so tests stay deterministic and never depend
// on requestAnimationFrame wall-clock timing.
//
// Top-level state uses `var` (not `let`) so values are reachable both as bare
// identifiers and as `window.*` properties from `page.evaluate`.
// ---------------------------------------------------------------------------

// --- Bundled puzzles. `#` = black/clue cell, `.` = white/entry cell.
// Each solution is a full, valid, unique fill; its uniqueness was verified with
// an exhaustive solver during authoring (see DESIGN.md → Assumptions).
var PUZZLES = [
    {
        name: 'Warm-up',
        template: ['#####', '#..##', '#...#', '#...#', '##..#'],
        solution: ['#####', '#49##', '#132#', '#289#', '##57#'],
    },
    {
        name: 'Crossroads',
        template: ['######', '##...#', '#.....', '#..#..', '##....', '###..#'],
        solution: ['######', '##735#', '#73125', '#98#41', '##9173', '###89#'],
    },
    {
        name: 'Lattice',
        template: ['#######', '#..#..#', '#......', '##..#..', '#..#..#', '#......', '##..#..'],
        solution: ['#######', '#93#35#', '#653241', '##68#65', '#91#82#', '#628314', '##76#32'],
    },
];

var CELL = 54; // pixel size of each grid cell

// --- DOM ---
var canvas = document.getElementById('canvas');
var ctx = canvas.getContext('2d');
var nameEl = document.getElementById('puzzle-name');
var timeEl = document.getElementById('time');
var bestEl = document.getElementById('best');
var overlay = document.getElementById('overlay');
var overlayTitle = document.getElementById('overlay-title');
var overlayScore = document.getElementById('overlay-score');
var overlaySub = document.getElementById('overlay-sub');
var btnNext = document.getElementById('btn-next');
var btnRestart = document.getElementById('btn-restart');
var btnNewNext = document.getElementById('btn-newnext');

// --- Colours ---
var CLR = {
    bg:        '#0d1426',
    block:     '#1c2740',
    blockLine: '#0d1426',
    clue:      '#a9b8da',
    white:     '#1a2440',
    whiteSel:  '#2c3e6e',
    good:      '#1c3b2e',
    bad:       '#4a1f2a',
    grid:      '#2a3554',
    ink:       '#eaf1ff',
    accent:    '#5dd0ff',
};

// --- Mutable state ---
var puzzleIndex = 0;
var grid = [];             // grid[r][c] = {type:'block', right, down} | {type:'white', value}
var solution = [];         // solution[r][c] = digit (1-9) for white cells, null for blocks
var runs = [];             // [{ cells:[{r,c}], sum }]
var cellRuns = [];         // cellRuns[r][c] = [runIndex...] for white cells
var gridRows = 0, gridCols = 0;
var state = 'playing';     // 'playing' | 'solved'
var selected = null;       // {r,c} | null
var elapsed = 0;           // seconds on the current puzzle
var bestTimes = {};        // { puzzleIndex: seconds }
var lastTime = 0;

// --- Helpers ---
function isWhite(r, c) {
    return r >= 0 && r < gridRows && c >= 0 && c < gridCols && grid[r][c] && grid[r][c].type === 'white';
}

function formatTime(sec) {
    var s = Math.max(0, Math.floor(sec));
    var m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
}

function loadBestTimes() {
    try {
        var raw = window.localStorage.getItem('kakuro-best');
        bestTimes = raw ? JSON.parse(raw) : {};
        if (!bestTimes || typeof bestTimes !== 'object') bestTimes = {};
    } catch (e) {
        bestTimes = {};
    }
}

function saveBestTimes() {
    window.localStorage.setItem('kakuro-best', JSON.stringify(bestTimes));
}

// --- Puzzle loading & clue derivation ---
function loadPuzzle(i) {
    puzzleIndex = ((i % PUZZLES.length) + PUZZLES.length) % PUZZLES.length;
    var puz = PUZZLES[puzzleIndex];
    gridRows = puz.template.length;
    gridCols = puz.template[0].length;

    // solution digits (numbers) / null for blocks
    solution = [];
    for (var r = 0; r < gridRows; r++) {
        var row = [];
        for (var c = 0; c < gridCols; c++) {
            var ch = puz.solution[r][c];
            row.push(ch === '#' ? null : Number(ch));
        }
        solution.push(row);
    }

    // start every cell as a plain block or empty white
    grid = [];
    for (r = 0; r < gridRows; r++) {
        var grow = [];
        for (c = 0; c < gridCols; c++) {
            if (puz.template[r][c] === '.') grow.push({ type: 'white', value: 0 });
            else grow.push({ type: 'block', right: null, down: null });
        }
        grid.push(grow);
    }

    // build runs + derive clue sums from the solution
    runs = [];
    cellRuns = [];
    for (r = 0; r < gridRows; r++) {
        cellRuns.push(new Array(gridCols).fill(null).map(function () { return []; }));
    }
    for (r = 0; r < gridRows; r++) {
        for (c = 0; c < gridCols; c++) {
            if (grid[r][c].type !== 'block') continue;
            // right run
            if (isWhite(r, c + 1)) {
                var cells = [];
                var cc = c + 1;
                while (isWhite(r, cc)) { cells.push({ r: r, c: cc }); cc++; }
                var sum = cells.reduce(function (a, cel) { return a + solution[cel.r][cel.c]; }, 0);
                grid[r][c].right = sum;
                registerRun(cells, sum);
            }
            // down run
            if (isWhite(r + 1, c)) {
                var dcells = [];
                var rr = r + 1;
                while (isWhite(rr, c)) { dcells.push({ r: rr, c: c }); rr++; }
                var dsum = dcells.reduce(function (a, cel) { return a + solution[cel.r][cel.c]; }, 0);
                grid[r][c].down = dsum;
                registerRun(dcells, dsum);
            }
        }
    }

    selected = null;
    elapsed = 0;
    state = 'playing';
    resizeCanvas();
    hideOverlay();
    updateHud();
    draw();
}

function registerRun(cells, sum) {
    var idx = runs.length;
    runs.push({ cells: cells, sum: sum });
    cells.forEach(function (cel) { cellRuns[cel.r][cel.c].push(idx); });
}

function resizeCanvas() {
    canvas.width = gridCols * CELL;
    canvas.height = gridRows * CELL;
}

// --- HUD ---
function updateHud() {
    nameEl.textContent = PUZZLES[puzzleIndex].name;
    timeEl.textContent = formatTime(elapsed);
    var b = bestTimes[puzzleIndex];
    bestEl.textContent = (typeof b === 'number') ? formatTime(b) : '—';
}

function showOverlay() {
    overlayTitle.textContent = 'SOLVED!';
    overlayScore.textContent = 'Time: ' + formatTime(elapsed);
    var b = bestTimes[puzzleIndex];
    overlaySub.textContent = (typeof b === 'number' && Math.floor(elapsed) <= b)
        ? 'New best time!' : 'Nicely done.';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// --- Entry ---
function selectCell(r, c) {
    if (isWhite(r, c)) selected = { r: r, c: c };
}

function moveSelection(dr, dc) {
    if (!selected) return;
    var r = selected.r + dr, c = selected.c + dc;
    while (r >= 0 && r < gridRows && c >= 0 && c < gridCols) {
        if (isWhite(r, c)) { selected = { r: r, c: c }; draw(); return; }
        r += dr; c += dc;
    }
}

function setCell(r, c, v) {
    if (!isWhite(r, c)) return;
    v = Number(v);
    if (v === 0) { grid[r][c].value = 0; }
    else if (Number.isInteger(v) && v >= 1 && v <= 9) { grid[r][c].value = v; }
    else return; // ignore out-of-range
    afterEdit();
}

function clearCell(r, c) {
    if (!isWhite(r, c)) return;
    grid[r][c].value = 0;
    afterEdit();
}

function afterEdit() {
    if (isSolved()) {
        if (state !== 'solved') onSolved();
    } else if (state === 'solved') {
        state = 'playing';
        hideOverlay();
    }
    draw();
}

// --- Validation ---
function runStatus(run) {
    var vals = run.cells.map(function (cel) { return grid[cel.r][cel.c].value; });
    var filled = vals.filter(function (v) { return v > 0; });
    var sum = filled.reduce(function (a, b) { return a + b; }, 0);
    var dup = new Set(filled).size !== filled.length;
    var complete = filled.length === run.cells.length;
    if (dup) return 'bad';
    if (sum > run.sum) return 'bad';
    if (complete) return sum === run.sum ? 'good' : 'bad';
    return 'neutral';
}

function isSolved() {
    if (!runs.length) return false;
    for (var i = 0; i < runs.length; i++) {
        if (runStatus(runs[i]) !== 'good') return false;
    }
    return true;
}

function onSolved() {
    state = 'solved';
    var t = Math.floor(elapsed);
    var prev = bestTimes[puzzleIndex];
    if (typeof prev !== 'number' || t < prev) {
        bestTimes[puzzleIndex] = t;
        saveBestTimes();
    }
    updateHud();
    showOverlay();
}

// --- Controls ---
function restart() {
    loadPuzzle(puzzleIndex);
}

function nextPuzzle() {
    loadPuzzle(puzzleIndex + 1);
}

// --- Timer ---
function tick(dt) {
    if (state !== 'playing') return;
    elapsed += dt;
    timeEl.textContent = formatTime(elapsed);
}

// --- Rendering ---
function cellFill(r, c) {
    // white cell background tinted by the status of the runs it belongs to
    var worst = 'neutral';
    var idxs = cellRuns[r][c];
    var anyBad = false, allGood = idxs.length > 0;
    for (var i = 0; i < idxs.length; i++) {
        var st = runStatus(runs[idxs[i]]);
        if (st === 'bad') anyBad = true;
        if (st !== 'good') allGood = false;
    }
    if (anyBad) return CLR.bad;
    if (allGood) return CLR.good;
    return CLR.white;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (var r = 0; r < gridRows; r++) {
        for (var c = 0; c < gridCols; c++) {
            var x = c * CELL, y = r * CELL;
            var cell = grid[r][c];
            if (cell.type === 'block') {
                ctx.fillStyle = CLR.block;
                ctx.fillRect(x, y, CELL, CELL);
                if (cell.right != null || cell.down != null) {
                    // diagonal divider
                    ctx.strokeStyle = CLR.blockLine;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + CELL, y + CELL);
                    ctx.stroke();
                    ctx.fillStyle = CLR.clue;
                    ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
                    if (cell.right != null) {
                        ctx.textAlign = 'right';
                        ctx.textBaseline = 'top';
                        ctx.fillText(String(cell.right), x + CELL - 5, y + 4);
                    }
                    if (cell.down != null) {
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'bottom';
                        ctx.fillText(String(cell.down), x + 5, y + CELL - 4);
                    }
                }
            } else {
                ctx.fillStyle = (selected && selected.r === r && selected.c === c)
                    ? CLR.whiteSel : cellFill(r, c);
                ctx.fillRect(x, y, CELL, CELL);
                if (cell.value > 0) {
                    ctx.fillStyle = CLR.ink;
                    ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(String(cell.value), x + CELL / 2, y + CELL / 2 + 1);
                }
            }
            ctx.strokeStyle = CLR.grid;
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, CELL, CELL);
        }
    }
}

// --- Animation loop (drives the timer only) ---
function frame(now) {
    if (!lastTime) lastTime = now;
    var dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    tick(dt);
    requestAnimationFrame(frame);
}

// --- Input ---
function onKeyDown(e) {
    var k = e.key;
    if (k >= '1' && k <= '9') {
        if (selected) { setCell(selected.r, selected.c, Number(k)); e.preventDefault(); }
        return;
    }
    if (k === '0' || k === 'Backspace' || k === 'Delete') {
        if (selected) { clearCell(selected.r, selected.c); e.preventDefault(); }
        return;
    }
    if (k === 'ArrowUp') { moveSelection(-1, 0); e.preventDefault(); }
    else if (k === 'ArrowDown') { moveSelection(1, 0); e.preventDefault(); }
    else if (k === 'ArrowLeft') { moveSelection(0, -1); e.preventDefault(); }
    else if (k === 'ArrowRight') { moveSelection(0, 1); e.preventDefault(); }
    else if (k === 'n' || k === 'N') { nextPuzzle(); }
}

function onCanvasClick(e) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    var c = Math.floor((e.clientX - rect.left) * scaleX / CELL);
    var r = Math.floor((e.clientY - rect.top) * scaleY / CELL);
    selectCell(r, c);
    draw();
}

document.addEventListener('keydown', onKeyDown);
canvas.addEventListener('click', onCanvasClick);
btnNext.addEventListener('click', function () { nextPuzzle(); });
btnRestart.addEventListener('click', function () { restart(); });
btnNewNext.addEventListener('click', function () { nextPuzzle(); });

// --- Boot ---
loadBestTimes();
loadPuzzle(0);
requestAnimationFrame(frame);
