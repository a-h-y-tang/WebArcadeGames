// --- Geometry ---
const W = 600;
const H = 360;
const NUM_PEGS = 3;
const PEG_X = [100, 300, 500];   // centre x of each peg
const PEG_LABELS = ['A', 'B', 'C'];
const BASE_Y = H - 40;           // y of the top of the base bar (disks rest here)
const DISK_H = 26;               // disk height
const MIN_DISKS = 3;
const MAX_DISKS = 6;
const DEFAULT_DISKS = 4;

// Disk colours by size (1..MAX). A pleasant graduated ramp.
const DISK_COLORS = {
    1: '#e5484d',
    2: '#f2820c',
    3: '#f5c518',
    4: '#46b955',
    5: '#3aa0e0',
    6: '#9b6bd8',
};

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const movesEl = document.getElementById('moves');
const minMovesEl = document.getElementById('min-moves');
const bestEl = document.getElementById('best');
const btnSolve = document.getElementById('btn-solve');
const btnReset = document.getElementById('btn-reset');

// --- State (var so tests can read/assign them as globals) ---
var pegs, numDisks, moves, minMoves, state, selected, best;
var solving, solveTimer;

// -----------------------------------------------------------------------
// Core model
// -----------------------------------------------------------------------
function topDisk(peg) {
    const stack = pegs[peg];
    return stack.length ? stack[stack.length - 1] : null;
}

// Whether the top disk of `from` may legally land on `to` (non-mutating).
function canMove(from, to) {
    if (from === to) return false;
    if (from < 0 || from >= NUM_PEGS || to < 0 || to >= NUM_PEGS) return false;
    const disk = topDisk(from);
    if (disk === null) return false;      // nothing to move
    const target = topDisk(to);
    if (target === null) return true;     // empty peg accepts anything
    return disk < target;                 // only onto a larger disk
}

function moveDisk(from, to) {
    if (state !== 'playing') return false;
    if (!canMove(from, to)) return false;
    const disk = pegs[from].pop();
    pegs[to].push(disk);
    moves++;
    if (isWon()) winGame();
    updateHUD();
    draw();
    return true;
}

function isWon() {
    return pegs[2].length === numDisks;
}

function winGame() {
    state = 'won';
    const key = String(numDisks);
    if (best[key] === undefined || moves < best[key]) {
        best[key] = moves;
        saveBest();
    }
}

// -----------------------------------------------------------------------
// The optimal solver
// -----------------------------------------------------------------------
// Canonical recursive solution: move n disks from `from` to `to` via `via`.
function solutionMoves(n, from, to, via) {
    if (from === undefined) { from = 0; to = 2; via = 1; }
    const out = [];
    function hanoi(k, f, t, v) {
        if (k === 0) return;
        hanoi(k - 1, f, v, t);
        out.push([f, t]);
        hanoi(k - 1, v, t, f);
    }
    hanoi(n, from, to, via);
    return out;
}

function solve() {
    if (solving) return;
    clearTimeout(solveTimer);
    reset(numDisks);            // solve from a clean position
    solving = true;
    selected = null;
    const seq = solutionMoves(numDisks);
    let i = 0;
    function step() {
        if (i >= seq.length || state !== 'playing') { solving = false; return; }
        const [f, t] = seq[i++];
        moveDisk(f, t);
        if (state === 'playing') solveTimer = setTimeout(step, 420);
        else solving = false;
    }
    step();
}

// -----------------------------------------------------------------------
// Game flow
// -----------------------------------------------------------------------
function reset(n) {
    clearTimeout(solveTimer);
    solving = false;
    if (typeof n === 'number') numDisks = n;
    if (!numDisks) numDisks = DEFAULT_DISKS;
    numDisks = Math.max(MIN_DISKS, Math.min(MAX_DISKS, numDisks));
    pegs = [[], [], []];
    for (let s = numDisks; s >= 1; s--) pegs[0].push(s); // largest at the bottom
    moves = 0;
    minMoves = Math.pow(2, numDisks) - 1;
    state = 'playing';
    selected = null;
    updateHUD();
    updateDiskButtons();
    draw();
}

function setDiskCount(n) {
    reset(n);
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
function handlePegClick(i) {
    if (state !== 'playing' || solving) return;
    if (i < 0 || i >= NUM_PEGS) return;

    if (selected === null) {
        if (pegs[i].length > 0) selected = i;
    } else if (selected === i) {
        selected = null;                       // cancel
    } else if (moveDisk(selected, i)) {
        selected = null;                       // successful move
    } else {
        // Illegal drop: reselect the clicked peg if it holds a disk.
        selected = pegs[i].length > 0 ? i : null;
    }
    updateStatus();
    draw();
}

function pegFromX(x) {
    // Three equal columns across the canvas width.
    return Math.max(0, Math.min(NUM_PEGS - 1, Math.floor(x / (W / NUM_PEGS))));
}

canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    handlePegClick(pegFromX(x));
});

document.addEventListener('keydown', e => {
    if (e.key === 'r' || e.key === 'R') reset(numDisks);
});

btnReset.addEventListener('click', () => reset(numDisks));
btnSolve.addEventListener('click', solve);

for (let n = MIN_DISKS; n <= MAX_DISKS; n++) {
    const btn = document.getElementById('btn-disks-' + n);
    if (btn) btn.addEventListener('click', () => setDiskCount(n));
}

// -----------------------------------------------------------------------
// HUD
// -----------------------------------------------------------------------
function updateStatus() {
    if (state === 'won') {
        const optimal = moves === minMoves ? ' — a perfect, optimal solve!' : '';
        statusEl.textContent = 'Solved in ' + moves + ' moves' + optimal + ' 🎉';
    } else if (solving) {
        statusEl.textContent = 'Solving…';
    } else if (selected !== null) {
        statusEl.textContent = 'Holding a disk from peg ' + PEG_LABELS[selected] + ' — pick a peg';
    } else {
        statusEl.textContent = 'Move the stack to peg C';
    }
}

function updateHUD() {
    movesEl.textContent = moves;
    minMovesEl.textContent = minMoves;
    const b = best[String(numDisks)];
    bestEl.textContent = b === undefined ? '–' : b;
    updateStatus();
}

function updateDiskButtons() {
    for (let n = MIN_DISKS; n <= MAX_DISKS; n++) {
        const btn = document.getElementById('btn-disks-' + n);
        if (btn) btn.classList.toggle('active', n === numDisks);
    }
}

function saveBest() {
    try {
        localStorage.setItem('tower-of-hanoi-best', JSON.stringify(best));
    } catch (e) {}
}

function loadBest() {
    try {
        const raw = localStorage.getItem('tower-of-hanoi-best');
        if (raw) return JSON.parse(raw) || {};
    } catch (e) {}
    return {};
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function diskWidth(size) {
    // Largest possible disk spans ~150px; scale down by size.
    const unit = 150 / MAX_DISKS;
    return 46 + size * unit;
}

function drawPeg(i) {
    const x = PEG_X[i];
    const poleTop = BASE_Y - (MAX_DISKS + 0.5) * DISK_H;
    // Pole.
    ctx.fillStyle = '#5a4632';
    ctx.fillRect(x - 6, poleTop, 12, BASE_Y - poleTop);
    // Highlight legal drop targets for the held disk.
    if (selected !== null && canMove(selected, i)) {
        ctx.save();
        ctx.strokeStyle = 'rgba(120, 220, 140, 0.9)';
        ctx.lineWidth = 3;
        ctx.setLineDash([7, 6]);
        const w = 172;
        ctx.strokeRect(x - w / 2, poleTop - 6, w, BASE_Y - poleTop + 12);
        ctx.restore();
    }
    // Peg label.
    ctx.fillStyle = '#8b96b6';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(PEG_LABELS[i], x, BASE_Y + 12);
}

function drawDisk(size, cx, cy, lifted) {
    const w = diskWidth(size);
    const x = cx - w / 2;
    const y = cy - DISK_H / 2;
    const r = 8;
    ctx.save();
    if (lifted) {
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 3;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + DISK_H, r);
    ctx.arcTo(x + w, y + DISK_H, x, y + DISK_H, r);
    ctx.arcTo(x, y + DISK_H, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = DISK_COLORS[size] || '#9aa4bf';
    ctx.fill();
    if (lifted) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
    }
    // Inner sheen.
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x + r, y + 3, w - 2 * r, 5);
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, W, H);

    // Base bar.
    ctx.fillStyle = '#5a4632';
    ctx.fillRect(30, BASE_Y, W - 60, 12);

    for (let i = 0; i < NUM_PEGS; i++) drawPeg(i);

    // Disks resting on each peg.
    for (let i = 0; i < NUM_PEGS; i++) {
        const stack = pegs[i];
        for (let j = 0; j < stack.length; j++) {
            const isTopHeld = selected === i && j === stack.length - 1;
            if (isTopHeld) continue; // drawn lifted below
            const cy = BASE_Y - DISK_H / 2 - j * DISK_H;
            drawDisk(stack[j], PEG_X[i], cy);
        }
    }

    // The held (selected) disk floats above its peg.
    if (selected !== null && pegs[selected].length > 0) {
        const size = topDisk(selected);
        const cy = BASE_Y - (MAX_DISKS + 1) * DISK_H;
        drawDisk(size, PEG_X[selected], cy, true);
    }
}

// -----------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------
best = loadBest();
reset(DEFAULT_DISKS);
