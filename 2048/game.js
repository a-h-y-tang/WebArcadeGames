const SIZE = 4;
const PAD = 12;                                   // gap between cells (px)
const CELL = (400 - PAD * (SIZE + 1)) / SIZE;     // 85 px

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

const TILE_COLORS = {
    0: '#cdc1b4',
    2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563',
    32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61',
    512: '#edc850', 1024: '#edc53f', 2048: '#edc22e',
};
const BOARD_BG = '#bbada0';

const DIRS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down',
    A: 'left', D: 'right', W: 'up', S: 'down',
};

// --- State ---
let grid, score, best, state, won;

function emptyGrid() {
    return Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
}

// -------------------------------------------------------------------------
// Core rule: slide a line toward index 0, merging equal neighbours once each.
// Returns the new 4-length line and the score gained.
// -------------------------------------------------------------------------
function collapse(line) {
    const nonzero = line.filter(v => v !== 0);
    const result = [];
    let gained = 0;
    for (let i = 0; i < nonzero.length; i++) {
        if (i + 1 < nonzero.length && nonzero[i] === nonzero[i + 1]) {
            const merged = nonzero[i] * 2;
            result.push(merged);
            gained += merged;
            i++; // consume the merged partner
        } else {
            result.push(nonzero[i]);
        }
    }
    while (result.length < SIZE) result.push(0);
    return { line: result, gained };
}

// Apply a directional move to the whole grid. Returns whether anything moved.
function applyMove(dir) {
    let moved = false;
    let gained = 0;

    if (dir === 'left' || dir === 'right') {
        for (let r = 0; r < SIZE; r++) {
            let line = grid[r].slice();
            if (dir === 'right') line.reverse();
            const res = collapse(line);
            let out = res.line;
            if (dir === 'right') out = out.slice().reverse();
            gained += res.gained;
            for (let c = 0; c < SIZE; c++) {
                if (grid[r][c] !== out[c]) moved = true;
            }
            grid[r] = out;
        }
    } else {
        for (let c = 0; c < SIZE; c++) {
            let line = [grid[0][c], grid[1][c], grid[2][c], grid[3][c]];
            if (dir === 'down') line.reverse();
            const res = collapse(line);
            let out = res.line;
            if (dir === 'down') out = out.slice().reverse();
            gained += res.gained;
            for (let r = 0; r < SIZE; r++) {
                if (grid[r][c] !== out[r]) moved = true;
                grid[r][c] = out[r];
            }
        }
    }

    if (moved) score += gained;
    return moved;
}

function addRandomTile() {
    const empty = [];
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (grid[r][c] === 0) empty.push({ r, c });
    if (empty.length === 0) return;
    const { r, c } = empty[Math.floor(Math.random() * empty.length)];
    grid[r][c] = Math.random() < 0.9 ? 2 : 4;
}

function canMove() {
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (grid[r][c] === 0) return true;
            if (c + 1 < SIZE && grid[r][c] === grid[r][c + 1]) return true;
            if (r + 1 < SIZE && grid[r][c] === grid[r + 1][c]) return true;
        }
    }
    return false;
}

function isGameOver() {
    return !canMove();
}

// A full turn triggered by input.
function move(dir) {
    if (state !== 'running') return false;
    const moved = applyMove(dir);
    if (moved) {
        addRandomTile();
        if (score > best) {
            best = score;
            localStorage.setItem('best-2048', best);
        }
        updateHud();
        if (!won && grid.flat().includes(2048)) {
            winGame();
        } else if (isGameOver()) {
            endGame();
        }
    }
    draw();
    return moved;
}

// --- Lifecycle ---
function startGame() {
    grid = emptyGrid();
    score = 0;
    won = false;
    state = 'running';
    addRandomTile();
    addRandomTile();
    updateHud();
    overlay.classList.remove('visible');
    draw();
}

function winGame() {
    state = 'won';
    won = true;
    overlayTitle.textContent = 'You Win!';
    overlayScore.textContent = `${score}`;
    overlaySub.textContent = 'Press any key to keep going';
    btnStart.textContent = 'Keep Going';
    overlay.classList.add('visible');
}

function resumeFromWin() {
    state = 'running';
    overlay.classList.remove('visible');
    draw();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        localStorage.setItem('best-2048', best);
    }
    updateHud();
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score}`;
    overlaySub.textContent = 'Press any key to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
}

// --- Rendering ---
function cellPos(i) {
    return PAD + i * (CELL + PAD);
}

function tileTextColor(v) {
    return v <= 4 ? '#776e65' : '#f9f6f2';
}

function tileFontSize(v) {
    const digits = String(v).length;
    if (digits <= 2) return 40;
    if (digits === 3) return 32;
    return 26;
}

function draw() {
    // Board background
    ctx.fillStyle = BOARD_BG;
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 8);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const v = grid ? grid[r][c] : 0;
            const x = cellPos(c);
            const y = cellPos(r);

            ctx.fillStyle = TILE_COLORS[v] || '#3c3a32';
            ctx.beginPath();
            ctx.roundRect(x, y, CELL, CELL, 6);
            ctx.fill();

            if (v) {
                ctx.fillStyle = tileTextColor(v);
                ctx.font = `bold ${tileFontSize(v)}px 'Segoe UI', system-ui, sans-serif`;
                ctx.fillText(String(v), x + CELL / 2, y + CELL / 2 + 2);
            }
        }
    }
}

// --- Input ---
function isStartKey(e) {
    return !!DIRS[e.key] || e.key === ' ' || e.code === 'Space';
}

document.addEventListener('keydown', e => {
    if (state === 'running') {
        const dir = DIRS[e.key];
        if (dir) { move(dir); e.preventDefault(); }
        return;
    }
    if (state === 'won') {
        if (isStartKey(e)) { resumeFromWin(); e.preventDefault(); }
        return;
    }
    // idle or over
    if (isStartKey(e)) { startGame(); e.preventDefault(); }
});

btnStart.addEventListener('click', () => {
    if (state === 'won') resumeFromWin();
    else startGame();
});

// --- Init ---
best = parseInt(localStorage.getItem('best-2048') || '0', 10);
grid = emptyGrid();
score = 0;
won = false;
state = 'idle';
updateHud();
draw();
