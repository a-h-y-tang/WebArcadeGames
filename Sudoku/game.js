// ===========================================================================
// Sudoku — the classic 9×9 number-placement puzzle.
//
// Logic lives in small functions over module-level globals so the Playwright
// suite can drive and inspect the game directly via page.evaluate.
// ===========================================================================

// --- Constants -------------------------------------------------------------
const N = 9;
const CELL = 56;             // px per cell → 504 × 504 canvas

// Puzzle bank. Each entry is an 81-char string, row-major, 0 = empty.
// Every puzzle was verified offline (backtracking solver) to be internally
// consistent and to have exactly one solution.
const PUZZLES = {
    easy: [
        '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
        '100920000524010000000000070050008102000000000402700090060000000000030945000071006',
    ],
    medium: [
        '000260701680070090190004500820100040004602900050003028009300074040050036703018000',
        '300000000970010000600583000200000900500621003008000005000435002000090056000000001',
    ],
    hard: [
        '800000000003600000070090200050007000000045700000100030001000068008500010090000400',
        '000000907000420180000705026100904000050000040000507009920108000034059000507000000',
    ],
};

// Colors
const CLR = {
    bg: '#0d1117',
    boxLine: '#3a4453',
    thinLine: '#222a35',
    given: '#e6edf3',
    entry: '#38bdf8',
    conflict: '#f87171',
    selected: 'rgba(56, 189, 248, 0.20)',
    peer: 'rgba(56, 189, 248, 0.07)',
};

// --- DOM -------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const difficultyLabel = document.getElementById('difficulty-label');
const timerEl = document.getElementById('timer');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');

// --- State -----------------------------------------------------------------
let board;                   // N×N digits, 0 = empty
let given;                   // N×N booleans, true = fixed clue
let selected;                // { r, c } or null
let state;                   // 'playing' | 'won'
let difficulty;              // 'easy' | 'medium' | 'hard'
let puzzleIndex;
let startTime;
let elapsed;                 // seconds
let rafId;

// --- Helpers ---------------------------------------------------------------
function parsePuzzle(str) {
    const b = [], g = [];
    for (let r = 0; r < N; r++) {
        b[r] = []; g[r] = [];
        for (let c = 0; c < N; c++) {
            const v = parseInt(str[r * N + c], 10) || 0;
            b[r][c] = v;
            g[r][c] = v !== 0;
        }
    }
    return { b, g };
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function formatTime(sec) {
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// --- Game setup ------------------------------------------------------------
function newGame(diff, index) {
    difficulty = (diff && PUZZLES[diff]) ? diff : 'easy';
    const bank = PUZZLES[difficulty];
    puzzleIndex = (typeof index === 'number') ? index : Math.floor(Math.random() * bank.length);
    const { b, g } = parsePuzzle(bank[puzzleIndex]);
    board = b;
    given = g;
    selected = null;
    state = 'playing';
    startTime = performance.now();
    elapsed = 0;

    difficultyLabel.textContent = capitalize(difficulty);
    timerEl.textContent = '0:00';
    overlay.classList.remove('visible');

    draw();
    startTimerLoop();
}

// --- Selection -------------------------------------------------------------
function selectCell(r, c) {
    if (r < 0 || r >= N || c < 0 || c >= N) return;
    selected = { r, c };
    draw();
}

function moveSelection(dr, dc) {
    if (!selected) { selected = { r: 0, c: 0 }; draw(); return; }
    const r = Math.max(0, Math.min(N - 1, selected.r + dr));
    const c = Math.max(0, Math.min(N - 1, selected.c + dc));
    selected = { r, c };
    draw();
}

// --- Editing ---------------------------------------------------------------
function isGiven(r, c) { return given[r][c]; }

function enterDigit(n) {
    if (state !== 'playing' || !selected) return;
    const { r, c } = selected;
    if (given[r][c]) return;
    if (n >= 1 && n <= 9) {
        board[r][c] = n;
        draw();
        checkWin();
    }
}

function clearCell() {
    if (state !== 'playing' || !selected) return;
    const { r, c } = selected;
    if (given[r][c]) return;
    board[r][c] = 0;
    draw();
}

// --- Conflicts & win -------------------------------------------------------
function hasConflict(r, c) {
    const v = board[r][c];
    if (v === 0) return false;
    for (let i = 0; i < N; i++) {
        if (i !== c && board[r][i] === v) return true;
        if (i !== r && board[i][c] === v) return true;
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            const rr = br + i, cc = bc + j;
            if ((rr !== r || cc !== c) && board[rr][cc] === v) return true;
        }
    }
    return false;
}

function findConflicts() {
    const out = [];
    for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++)
            if (board[r][c] !== 0 && hasConflict(r, c)) out.push({ r, c });
    return out;
}

function isComplete() {
    for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++)
            if (board[r][c] === 0) return false;
    return true;
}

function isSolved() {
    return isComplete() && findConflicts().length === 0;
}

function checkWin() {
    if (isSolved()) {
        state = 'won';
        elapsed = (performance.now() - startTime) / 1000;
        timerEl.textContent = formatTime(elapsed);
        overlayTitle.textContent = 'Solved!';
        overlayScore.textContent = `Time: ${formatTime(elapsed)}`;
        overlaySub.textContent = 'Press New Game to play again';
        overlay.classList.add('visible');
        draw();
    }
}

// --- Timer -----------------------------------------------------------------
function startTimerLoop() {
    cancelAnimationFrame(rafId);
    const tick = () => {
        if (state !== 'playing') return;
        elapsed = (performance.now() - startTime) / 1000;
        timerEl.textContent = formatTime(elapsed);
        rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
}

// --- Rendering -------------------------------------------------------------
function draw() {
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Highlight selected cell and its peers (row/col/box).
    if (selected) {
        const { r: sr, c: sc } = selected;
        const bsr = Math.floor(sr / 3) * 3, bsc = Math.floor(sc / 3) * 3;
        for (let r = 0; r < N; r++) {
            for (let c = 0; c < N; c++) {
                const peer = r === sr || c === sc ||
                    (r >= bsr && r < bsr + 3 && c >= bsc && c < bsc + 3);
                if (peer && !(r === sr && c === sc)) {
                    ctx.fillStyle = CLR.peer;
                    ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
                }
            }
        }
        ctx.fillStyle = CLR.selected;
        ctx.fillRect(sc * CELL, sr * CELL, CELL, CELL);
    }

    const conflicts = findConflicts();
    const conflictSet = new Set(conflicts.map(({ r, c }) => r * N + c));

    // Digits.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            const v = board[r][c];
            if (v === 0) continue;
            const cx = c * CELL + CELL / 2;
            const cy = r * CELL + CELL / 2;
            if (conflictSet.has(r * N + c)) {
                ctx.fillStyle = CLR.conflict;
                ctx.font = 'bold 30px system-ui, sans-serif';
            } else if (given[r][c]) {
                ctx.fillStyle = CLR.given;
                ctx.font = 'bold 30px system-ui, sans-serif';
            } else {
                ctx.fillStyle = CLR.entry;
                ctx.font = '30px system-ui, sans-serif';
            }
            ctx.fillText(String(v), cx, cy);
        }
    }

    // Grid lines — thin for cells, thick for 3×3 boxes.
    for (let i = 0; i <= N; i++) {
        const thick = i % 3 === 0;
        ctx.strokeStyle = thick ? CLR.boxLine : CLR.thinLine;
        ctx.lineWidth = thick ? 2.5 : 1;
        const p = i * CELL;
        ctx.beginPath();
        ctx.moveTo(p, 0); ctx.lineTo(p, N * CELL);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p); ctx.lineTo(N * CELL, p);
        ctx.stroke();
    }
}

// --- Input -----------------------------------------------------------------
document.addEventListener('keydown', e => {
    if (state !== 'playing') return;
    if (e.key >= '1' && e.key <= '9') { enterDigit(parseInt(e.key, 10)); e.preventDefault(); return; }
    if (e.key === '0' || e.key === 'Backspace' || e.key === 'Delete') { clearCell(); e.preventDefault(); return; }
    switch (e.key) {
        case 'ArrowUp': moveSelection(-1, 0); e.preventDefault(); break;
        case 'ArrowDown': moveSelection(1, 0); e.preventDefault(); break;
        case 'ArrowLeft': moveSelection(0, -1); e.preventDefault(); break;
        case 'ArrowRight': moveSelection(0, 1); e.preventDefault(); break;
    }
});

canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    if (r >= 0 && r < N && c >= 0 && c < N) selectCell(r, c);
});

document.getElementById('btn-new').addEventListener('click', () => newGame(difficulty));
document.getElementById('btn-easy').addEventListener('click', () => newGame('easy'));
document.getElementById('btn-medium').addEventListener('click', () => newGame('medium'));
document.getElementById('btn-hard').addEventListener('click', () => newGame('hard'));
document.getElementById('btn-play-again').addEventListener('click', () => newGame(difficulty));

// --- Init ------------------------------------------------------------------
newGame('easy', 0);
