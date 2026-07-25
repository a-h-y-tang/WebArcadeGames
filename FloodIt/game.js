const SIZE = 14;          // 14 x 14 grid
const NCOLORS = 6;        // palette size
const MAX_MOVES = 30;     // move budget
const CELL = 500 / SIZE;  // canvas is 500 px wide

// Palette — six visually distinct, colour-blind-friendly-ish hues.
const PALETTE = [
    '#ef4444', // red
    '#f59e0b', // amber
    '#22c55e', // green
    '#38bdf8', // sky
    '#a855f7', // purple
    '#ec4899', // pink
];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const movesEl = document.getElementById('moves');
const maxMovesEl = document.getElementById('max-moves');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const paletteEl = document.getElementById('palette');

// --- State (globals are intentionally exposed for the test-suite) ---
let grid;                 // grid[row][col] -> colour index 0..NCOLORS-1
let movesLeft;
let maxMoves = MAX_MOVES;
let best;                 // fewest winning moves, or null
let state;                // 'idle' | 'running' | 'won' | 'lost'

// --- Seedable PRNG (mulberry32) for reproducible boards ---
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function generateBoard(seed) {
    const rng = mulberry32(seed);
    grid = [];
    for (let r = 0; r < SIZE; r++) {
        const row = [];
        for (let c = 0; c < SIZE; c++) {
            row.push(Math.floor(rng() * NCOLORS));
        }
        grid.push(row);
    }
}

// --- Flood helpers ---
function floodColor() {
    return grid[0][0];
}

// Number of tiles in the connected (4-dir) region that includes the top-left
// tile and shares its colour.
function regionSize() {
    const target = grid[0][0];
    const seen = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));
    const stack = [[0, 0]];
    seen[0][0] = true;
    let count = 0;
    while (stack.length) {
        const [r, c] = stack.pop();
        if (grid[r][c] !== target) continue;
        count++;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE &&
                !seen[nr][nc] && grid[nr][nc] === target) {
                seen[nr][nc] = true;
                stack.push([nr, nc]);
            }
        }
    }
    return count;
}

function isWon() {
    const first = grid[0][0];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (grid[r][c] !== first) return false;
        }
    }
    return true;
}

// Recolour the flood region (connected component of `from` including (0,0))
// to `to`.
function floodFill(from, to) {
    const stack = [[0, 0]];
    while (stack.length) {
        const [r, c] = stack.pop();
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;
        if (grid[r][c] !== from) continue;
        grid[r][c] = to;
        stack.push([r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]);
    }
}

// --- Core move ---
function pickColor(colorIndex) {
    if (state !== 'running') return;
    const cur = grid[0][0];
    if (colorIndex === cur) return;          // no-op: same colour is free

    floodFill(cur, colorIndex);
    movesLeft--;
    updateMoves();

    if (isWon()) {
        win();
    } else if (movesLeft <= 0) {
        lose();
    }
    draw();
}

// --- Lifecycle ---
function startGame(seed) {
    const s = (seed === undefined || seed === null) ? (Date.now() >>> 0) : (seed >>> 0);
    generateBoard(s);
    movesLeft = maxMoves;
    state = 'running';
    updateMoves();
    overlay.classList.remove('visible');
    draw();
}

function win() {
    state = 'won';
    const used = maxMoves - movesLeft;
    if (best === null || used < best) {
        best = used;
        bestEl.textContent = best;
        try { localStorage.setItem('floodit-best', String(best)); } catch (e) {}
    }
    overlayTitle.textContent = 'You Win! 🎉';
    overlayScore.textContent = `${used} move${used === 1 ? '' : 's'}`;
    overlaySub.textContent = 'Fewer moves is better. Try again?';
    btnStart.textContent = 'New Game';
    overlay.classList.add('visible');
}

function lose() {
    state = 'lost';
    overlayTitle.textContent = 'Out of Moves';
    overlayScore.textContent = '';
    overlaySub.textContent = 'The board never became one colour. Give it another go!';
    btnStart.textContent = 'New Game';
    overlay.classList.add('visible');
}

function updateMoves() {
    movesEl.textContent = movesLeft;
}

// --- Rendering ---
function draw() {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            ctx.fillStyle = PALETTE[grid[r][c]];
            // Slight inset gives a subtle tile grid without a separate pass.
            ctx.fillRect(c * CELL + 0.5, r * CELL + 0.5, CELL - 1, CELL - 1);
        }
    }

    // Outline the current flood region's origin so the player can see where
    // the flood spreads from.
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, CELL - 2, CELL - 2);
}

// --- Palette UI ---
function buildPalette() {
    for (let i = 0; i < NCOLORS; i++) {
        const btn = document.createElement('button');
        btn.className = 'swatch';
        btn.dataset.color = String(i);
        btn.style.background = PALETTE[i];
        btn.setAttribute('aria-label', `Color ${i + 1}`);
        const key = document.createElement('span');
        key.className = 'key';
        key.textContent = String(i + 1);
        btn.appendChild(key);
        btn.addEventListener('click', () => chooseColor(i));
        paletteEl.appendChild(btn);
    }
}

// A colour choice from the UI: starts a fresh game if we're not mid-game,
// otherwise it's a move.
function chooseColor(i) {
    if (state === 'running') {
        pickColor(i);
    } else {
        startGame();
    }
}

// --- Input ---
document.addEventListener('keydown', e => {
    if (e.key >= '1' && e.key <= String(NCOLORS)) {
        chooseColor(parseInt(e.key, 10) - 1);
        e.preventDefault();
        return;
    }
    if (e.key === 'r' || e.key === 'R' || e.key === 'n' || e.key === 'N') {
        startGame();
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => startGame());

// --- Init ---
function init() {
    const stored = localStorage.getItem('floodit-best');
    best = stored === null ? null : parseInt(stored, 10);
    bestEl.textContent = best === null ? '—' : best;

    maxMoves = MAX_MOVES;
    movesLeft = MAX_MOVES;
    maxMovesEl.textContent = MAX_MOVES;
    updateMoves();

    buildPalette();
    generateBoard(Date.now() >>> 0);
    state = 'idle';
    draw();
}

init();
