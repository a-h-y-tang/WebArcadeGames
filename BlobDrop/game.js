'use strict';

// ===========================================================================
// Blob Drop
// A Puyo-style falling-pair chain-clearing game. See DESIGN.md for the full
// design. The clearing engine (settleGravity / findGroups / resolveBoard) is a
// set of pure functions, so the whole game is deterministic and testable.
// ===========================================================================

// --- Constants -------------------------------------------------------------
const COLS = 6;
const ROWS = 12;
const COLORS = 4;
const CLEAR_THRESHOLD = 4;
const CELL = 40;
const SPAWN_COL = 2;
const GRAVITY_MS = 650;
const BEST_KEY = 'blob-drop-best';

const PALETTE = {
    1: '#ef476f', // red
    2: '#ffd166', // yellow
    3: '#06d6a0', // green
    4: '#4d9de0', // blue
};

// Satellite offset per orientation: 0 up, 1 right, 2 down, 3 left.
const SAT_OFFSET = [
    [-1, 0],
    [0, 1],
    [1, 0],
    [0, -1],
];

// --- Mutable state ---------------------------------------------------------
let grid = makeEmpty();
let current = null; // { pivot:{r,c}, orientation, colors:[pivot, satellite] }
let nextColors = [1, 1];
let rng = mulberry32(1);
let phase = 'idle'; // 'idle' | 'playing' | 'paused' | 'gameover'
let score = 0;
let best = 0;
let lastChain = 0;
let autoFall = true;

// --- Utilities -------------------------------------------------------------
function makeEmpty() {
    const g = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) g[r] = new Array(COLS).fill(0);
    return g;
}

function cloneGrid(g) {
    return g.map(function (row) {
        return row.slice();
    });
}

function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function randColor() {
    return 1 + Math.floor(rng() * COLORS);
}

// ===========================================================================
// Pure clearing engine
// ===========================================================================

// Drop every blob in every column down onto the floor / the blob below,
// preserving vertical order. Returns a new grid.
function settleGravity(g) {
    const rows = g.length;
    const cols = g[0].length;
    const out = [];
    for (let r = 0; r < rows; r++) out.push(new Array(cols).fill(0));
    for (let c = 0; c < cols; c++) {
        let write = rows - 1;
        for (let r = rows - 1; r >= 0; r--) {
            if (g[r][c] !== 0) {
                out[write][c] = g[r][c];
                write--;
            }
        }
    }
    return out;
}

// Flood-fill same-colour orthogonal groups; return those of size >= threshold.
// Each group is an array of [r, c] pairs.
function findGroups(g) {
    const rows = g.length;
    const cols = g[0].length;
    const seen = [];
    for (let r = 0; r < rows; r++) seen.push(new Array(cols).fill(false));
    const groups = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (g[r][c] === 0 || seen[r][c]) continue;
            const color = g[r][c];
            const stack = [[r, c]];
            seen[r][c] = true;
            const comp = [];
            while (stack.length) {
                const cell = stack.pop();
                const cr = cell[0];
                const cc = cell[1];
                comp.push([cr, cc]);
                const nbrs = [
                    [cr - 1, cc],
                    [cr + 1, cc],
                    [cr, cc - 1],
                    [cr, cc + 1],
                ];
                for (let i = 0; i < nbrs.length; i++) {
                    const nr = nbrs[i][0];
                    const nc = nbrs[i][1];
                    if (
                        nr >= 0 && nr < rows && nc >= 0 && nc < cols &&
                        !seen[nr][nc] && g[nr][nc] === color
                    ) {
                        seen[nr][nc] = true;
                        stack.push([nr, nc]);
                    }
                }
            }
            if (comp.length >= CLEAR_THRESHOLD) groups.push(comp);
        }
    }
    return groups;
}

// Fully resolve a board: settle, clear matched groups, repeat. Pure.
// Returns { grid, chains, cleared }.
function resolveBoard(input) {
    let g = settleGravity(cloneGrid(input));
    let chains = 0;
    let cleared = 0;
    for (;;) {
        const groups = findGroups(g);
        if (groups.length === 0) break;
        for (let i = 0; i < groups.length; i++) {
            const comp = groups[i];
            cleared += comp.length;
            for (let j = 0; j < comp.length; j++) {
                g[comp[j][0]][comp[j][1]] = 0;
            }
        }
        chains++;
        g = settleGravity(g);
    }
    return { grid: g, chains: chains, cleared: cleared };
}

// ===========================================================================
// Piece helpers
// ===========================================================================
function pieceCells(p) {
    const off = SAT_OFFSET[p.orientation];
    return [
        { r: p.pivot.r, c: p.pivot.c },
        { r: p.pivot.r + off[0], c: p.pivot.c + off[1] },
    ];
}

function canPlace(g, piece) {
    const cells = pieceCells(piece);
    for (let i = 0; i < cells.length; i++) {
        const r = cells[i].r;
        const c = cells[i].c;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
        if (g[r][c] !== 0) return false;
    }
    return true;
}

// ===========================================================================
// Lifecycle
// ===========================================================================
function newGame(seed) {
    const s = seed === undefined ? Math.floor(Math.random() * 1e9) >>> 0 : seed >>> 0;
    rng = mulberry32(s);
    grid = makeEmpty();
    score = 0;
    lastChain = 0;
    phase = 'playing';
    current = null;
    nextColors = [randColor(), randColor()];
    autoFall = true;
    spawn();
    hideOverlay();
    updateHud();
    draw();
}

function spawn() {
    const colors = nextColors.slice();
    nextColors = [randColor(), randColor()];
    const piece = {
        pivot: { r: 1, c: SPAWN_COL },
        orientation: 0,
        colors: colors,
    };
    if (!canPlace(grid, piece)) {
        current = null;
        phase = 'gameover';
        if (score > best) {
            best = score;
            try {
                localStorage.setItem(BEST_KEY, String(best));
            } catch (e) {
                /* ignore */
            }
        }
        showGameOver();
        draw();
        return;
    }
    current = piece;
    draw();
}

function setCurrentPiece(spec) {
    current = {
        pivot: { r: spec.row == null ? 1 : spec.row, c: spec.col },
        orientation: spec.orientation || 0,
        colors: spec.colors.slice(),
    };
    draw();
}

// ===========================================================================
// Movement
// ===========================================================================
function tryMove(dr, dc) {
    if (!current || phase !== 'playing') return false;
    const moved = {
        pivot: { r: current.pivot.r + dr, c: current.pivot.c + dc },
        orientation: current.orientation,
        colors: current.colors,
    };
    if (canPlace(grid, moved)) {
        current.pivot.r += dr;
        current.pivot.c += dc;
        draw();
        return true;
    }
    return false;
}

function moveLeft() {
    return tryMove(0, -1);
}

function moveRight() {
    return tryMove(0, 1);
}

function rotate(dir) {
    if (!current || phase !== 'playing') return false;
    const newOri = (current.orientation + dir + 4) % 4;
    // Try in place, then a one-cell horizontal wall kick.
    const kicks = [0, -1, 1];
    for (let i = 0; i < kicks.length; i++) {
        const cand = {
            pivot: { r: current.pivot.r, c: current.pivot.c + kicks[i] },
            orientation: newOri,
            colors: current.colors,
        };
        if (canPlace(grid, cand)) {
            current.pivot.c += kicks[i];
            current.orientation = newOri;
            draw();
            return true;
        }
    }
    return false;
}

function rotateCW() {
    return rotate(1);
}

function rotateCCW() {
    return rotate(-1);
}

function softDrop() {
    if (!current || phase !== 'playing') return;
    if (!tryMove(1, 0)) lockPiece();
}

function tick() {
    softDrop();
}

function hardDrop() {
    if (!current || phase !== 'playing') return;
    while (tryMove(1, 0)) {
        /* keep dropping */
    }
    lockPiece();
}

function lockPiece() {
    if (!current) return;
    const cells = pieceCells(current);
    for (let i = 0; i < cells.length; i++) {
        const r = cells[i].r;
        const c = cells[i].c;
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) grid[r][c] = current.colors[i];
    }
    current = null;

    const res = resolveBoard(grid);
    grid = res.grid;
    lastChain = res.chains;
    if (res.cleared > 0) score += res.cleared * 10 * res.chains;

    updateHud();
    if (phase === 'playing') spawn();
    draw();
}

// ===========================================================================
// Queries
// ===========================================================================
function getState() {
    return {
        phase: phase,
        score: score,
        best: best,
        chain: lastChain,
        rows: ROWS,
        cols: COLS,
        current: current
            ? {
                  pivot: { r: current.pivot.r, c: current.pivot.c },
                  orientation: current.orientation,
                  colors: current.colors.slice(),
              }
            : null,
        next: nextColors.slice(),
    };
}

function getGrid() {
    return cloneGrid(grid);
}

function loadGrid(rows) {
    grid = cloneGrid(rows);
    draw();
}

function isGameOver() {
    return phase === 'gameover';
}

function setAutoFall(v) {
    autoFall = !!v;
    accMs = 0;
    lastTs = 0;
}

// ===========================================================================
// Pause
// ===========================================================================
function togglePause() {
    if (phase === 'playing') {
        phase = 'paused';
        showPaused();
    } else if (phase === 'paused') {
        phase = 'playing';
        accMs = 0;
        lastTs = 0;
        hideOverlay();
    }
    draw();
}

// ===========================================================================
// Rendering
// ===========================================================================
const canvas = document.getElementById('canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const nextCanvas = document.getElementById('next');
const nextCtx = nextCanvas ? nextCanvas.getContext('2d') : null;

const els = {
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    chain: document.getElementById('chain'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlaySub: document.getElementById('overlay-sub'),
    btnStart: document.getElementById('btn-start'),
};

function updateHud() {
    if (els.score) els.score.textContent = String(score);
    if (els.best) els.best.textContent = String(best);
    if (els.chain) els.chain.textContent = String(lastChain);
}

function drawBlob(context, x, y, size, color) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const rad = size / 2 - 3;
    context.fillStyle = PALETTE[color] || '#888';
    context.beginPath();
    context.arc(cx, cy, rad, 0, Math.PI * 2);
    context.fill();
    // eyes / highlight for character
    context.fillStyle = 'rgba(255,255,255,0.85)';
    context.beginPath();
    context.arc(cx - rad * 0.32, cy - rad * 0.2, rad * 0.22, 0, Math.PI * 2);
    context.arc(cx + rad * 0.32, cy - rad * 0.2, rad * 0.22, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(20,20,40,0.9)';
    context.beginPath();
    context.arc(cx - rad * 0.32, cy - rad * 0.16, rad * 0.1, 0, Math.PI * 2);
    context.arc(cx + rad * 0.32, cy - rad * 0.16, rad * 0.1, 0, Math.PI * 2);
    context.fill();
}

function draw(flightless) {
    if (!ctx) return;
    // Background well
    ctx.fillStyle = '#0d1226';
    ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(c * CELL, 0);
        ctx.lineTo(c * CELL, ROWS * CELL);
        ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * CELL);
        ctx.lineTo(COLS * CELL, r * CELL);
        ctx.stroke();
    }
    // Settled blobs
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (grid[r][c] !== 0) drawBlob(ctx, c * CELL, r * CELL, CELL, grid[r][c]);
        }
    }
    // Ghost landing preview + current pair
    if (current && phase === 'playing') {
        drawGhost();
        const cells = pieceCells(current);
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (cell.r >= 0) drawBlob(ctx, cell.c * CELL, cell.r * CELL, CELL, current.colors[i]);
        }
    }
    drawNext();
}

function drawGhost() {
    // Find how far the current pair can drop.
    let drop = 0;
    for (;;) {
        const moved = {
            pivot: { r: current.pivot.r + drop + 1, c: current.pivot.c },
            orientation: current.orientation,
            colors: current.colors,
        };
        if (canPlace(grid, moved)) drop++;
        else break;
    }
    if (drop === 0) return;
    const cells = pieceCells({
        pivot: { r: current.pivot.r + drop, c: current.pivot.c },
        orientation: current.orientation,
        colors: current.colors,
    });
    ctx.save();
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < cells.length; i++) {
        if (cells[i].r >= 0) drawBlob(ctx, cells[i].c * CELL, cells[i].r * CELL, CELL, current.colors[i]);
    }
    ctx.restore();
}

function drawNext() {
    if (!nextCtx) return;
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    nextCtx.fillStyle = '#0d1226';
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    const s = 34;
    const x = (nextCanvas.width - s) / 2;
    drawBlob(nextCtx, x, 6, s, nextColors[0]);
    drawBlob(nextCtx, x, 6 + s + 4, s, nextColors[1]);
}

// ===========================================================================
// Overlay
// ===========================================================================
function hideOverlay() {
    if (els.overlay) els.overlay.classList.remove('visible');
}

function showGameOver() {
    if (!els.overlay) return;
    els.overlayTitle.textContent = 'Game Over';
    els.overlaySub.textContent = 'Score: ' + score + '  ·  Best: ' + best + '. Press R or Start to play again.';
    els.btnStart.textContent = 'Play Again';
    els.overlay.classList.add('visible');
    updateHud();
}

function showPaused() {
    if (!els.overlay) return;
    els.overlayTitle.textContent = 'Paused';
    els.overlaySub.textContent = 'Press P to resume.';
    els.btnStart.textContent = 'Resume';
    els.overlay.classList.add('visible');
}

// ===========================================================================
// Auto-fall loop
// ===========================================================================
let accMs = 0;
let lastTs = 0;

function loop(ts) {
    if (phase === 'playing' && autoFall) {
        if (!lastTs) lastTs = ts;
        accMs += ts - lastTs;
        lastTs = ts;
        while (accMs >= GRAVITY_MS) {
            accMs -= GRAVITY_MS;
            softDrop();
        }
    } else {
        lastTs = ts;
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(loop);
}
if (typeof requestAnimationFrame === 'function') requestAnimationFrame(loop);

// ===========================================================================
// Input
// ===========================================================================
document.addEventListener('keydown', function (e) {
    const k = e.key;

    if (phase === 'idle') {
        if (k === ' ' || k === 'Enter') {
            newGame();
            e.preventDefault();
        }
        return;
    }
    if (phase === 'gameover') {
        if (k === 'r' || k === 'R' || k === ' ' || k === 'Enter') {
            newGame();
            e.preventDefault();
        }
        return;
    }
    if (phase === 'paused') {
        if (k === 'p' || k === 'P') {
            togglePause();
            e.preventDefault();
        }
        return;
    }

    switch (k) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
            moveLeft();
            e.preventDefault();
            break;
        case 'ArrowRight':
        case 'd':
        case 'D':
            moveRight();
            e.preventDefault();
            break;
        case 'ArrowUp':
        case 'x':
        case 'X':
        case 'w':
        case 'W':
            rotateCW();
            e.preventDefault();
            break;
        case 'z':
        case 'Z':
            rotateCCW();
            e.preventDefault();
            break;
        case 'ArrowDown':
        case 's':
        case 'S':
            softDrop();
            e.preventDefault();
            break;
        case ' ':
            hardDrop();
            e.preventDefault();
            break;
        case 'p':
        case 'P':
            togglePause();
            e.preventDefault();
            break;
        case 'r':
        case 'R':
            newGame();
            e.preventDefault();
            break;
        default:
            break;
    }
});

if (els.btnStart) {
    els.btnStart.addEventListener('click', function () {
        if (phase === 'paused') togglePause();
        else newGame();
    });
}

// ===========================================================================
// Boot
// ===========================================================================
try {
    best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
} catch (e) {
    best = 0;
}
grid = makeEmpty();
phase = 'idle';
score = 0;
lastChain = 0;
updateHud();
draw();

// ===========================================================================
// Test / debug API
// ===========================================================================
window.settleGravity = settleGravity;
window.findGroups = findGroups;
window.resolveBoard = resolveBoard;
window.newGame = newGame;
window.getState = getState;
window.getGrid = getGrid;
window.loadGrid = loadGrid;
window.spawn = spawn;
window.isGameOver = isGameOver;
window.moveLeft = moveLeft;
window.moveRight = moveRight;
window.rotateCW = rotateCW;
window.rotateCCW = rotateCCW;
window.softDrop = softDrop;
window.hardDrop = hardDrop;
window.tick = tick;
window.setCurrentPiece = setCurrentPiece;
window.setAutoFall = setAutoFall;
