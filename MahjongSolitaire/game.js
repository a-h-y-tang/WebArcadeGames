// ---------------------------------------------------------------------------
// Mahjong Solitaire — match free pairs of identical tiles to clear a stacked,
// pyramid-shaped board. A tile is "free" when nothing sits on top of it and at
// least one side is open. Every deal is generated solvable (see `deal`).
//
// All the rules are pure functions over the global `tiles` array — `isFree`,
// `tileAt`, `remaining`, `anyMovesLeft`, `findHint`, `removePair`, `clickTile` —
// with no animation dependence, so tests build exact geometries and assert the
// free / match / win / stuck outcome directly.
// ---------------------------------------------------------------------------

const WIDTH = 480;
const HEIGHT = 500;

// Tile / layout geometry (a simplified one-tile-per-cell grid).
const TILE_W = 52;
const TILE_H = 64;
const OFF_X = 9;                 // per-layer draw offset (up-and-left, 3-D look)
const OFF_Y = 12;
const ORIGIN_X = 30;
const ORIGIN_Y = 70;

// 16 distinct faces; each is dealt four times (64 = 16 × 4).
const FACES = ['🀄', '🌸', '🎋', '🍀', '⭐', '🌙', '🔥', '💧',
    '🍃', '🎐', '🏮', '🎴', '🦋', '🐟', '🌊', '🐢'];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const remainingEl = document.getElementById('remaining');
const timeEl = document.getElementById('time');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnHint = document.getElementById('btn-hint');
const btnUndo = document.getElementById('btn-undo');
const btnNew = document.getElementById('btn-new');

// --- State ---
// tiles: array of { id, layer, r, c, face, removed }.
// selected: id of the currently selected tile, or null.
// undoStack: array of [idA, idB] removed pairs, newest last.
// solutionPlan: the 32 pairs, in a valid removal order, from the generator.
let tiles = [];
let selected = null;
let undoStack = [];
let solutionPlan = [];
let state;                        // 'idle' | 'playing' | 'won' | 'stuck'
let hintPair = null;
let startedAt = 0;
let elapsed = 0;
let best;
let animId;

// ---------------------------------------------------------------------------
// Layout — a centred three-layer pyramid (40 + 18 + 6 = 64).
// ---------------------------------------------------------------------------
function buildLayout() {
    const pos = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) pos.push({ layer: 0, r, c });
    for (let r = 1; r < 4; r++) for (let c = 1; c < 7; c++) pos.push({ layer: 1, r, c });
    for (let c = 1; c < 7; c++) pos.push({ layer: 2, r: 2, c });
    return pos;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
function tileAt(layer, r, c) {
    for (const t of tiles) {
        if (!t.removed && t.layer === layer && t.r === r && t.c === c) return t;
    }
    return null;
}

// A tile is free when it is not covered (no tile in the layer directly above at
// the same row/column) and at least one horizontal neighbour cell is empty.
function isFree(t) {
    if (!t || t.removed) return false;
    if (tileAt(t.layer + 1, t.r, t.c)) return false;
    const left = tileAt(t.layer, t.r, t.c - 1);
    const right = tileAt(t.layer, t.r, t.c + 1);
    return !(left && right);
}

function remaining() {
    let n = 0;
    for (const t of tiles) if (!t.removed) n++;
    return n;
}

function freeTiles() {
    return tiles.filter(t => !t.removed && isFree(t));
}

// The first matching pair among free tiles, as [idA, idB], or null.
function findHint() {
    const free = freeTiles();
    for (let i = 0; i < free.length; i++) {
        for (let j = i + 1; j < free.length; j++) {
            if (free[i].face === free[j].face) return [free[i].id, free[j].id];
        }
    }
    return null;
}

function anyMovesLeft() {
    return findHint() !== null;
}

// Remove a matched pair. Pure: it does not check freeness or trigger end-state,
// so tests can drive it directly; end detection lives in `afterRemove`.
function removePair(a, b) {
    a.removed = true;
    b.removed = true;
    undoStack.push([a.id, b.id]);
    updateHud();
}

// ---------------------------------------------------------------------------
// Solvable deal — pair-peel the empty layout, then paint faces onto the pairs.
// ---------------------------------------------------------------------------
function deal() {
    const positions = buildLayout();
    tiles = positions.map((p, i) => ({ id: i, layer: p.layer, r: p.r, c: p.c, face: null, removed: false }));

    for (let attempt = 0; attempt < 300; attempt++) {
        const plan = peelPairs();
        if (plan) {
            solutionPlan = plan;
            for (let j = 0; j < plan.length; j++) {
                const face = FACES[Math.floor(j / 2) % FACES.length];
                tiles[plan[j][0]].face = face;
                tiles[plan[j][1]].face = face;
            }
            return;
        }
    }
    // Extremely unlikely fallback: pair tiles up arbitrarily (still even count).
    solutionPlan = [];
    for (let i = 0; i < tiles.length; i += 2) {
        const face = FACES[Math.floor(i / 4) % FACES.length];
        tiles[i].face = face;
        tiles[i + 1].face = face;
        solutionPlan.push([i, i + 1]);
    }
}

// Repeatedly remove two currently-free tiles until the board is empty, recording
// the pairs. Returns the 32-pair plan, or null if it ever gets stuck (retry).
function peelPairs() {
    const present = new Set(tiles.map(t => t.id));
    const at = (layer, r, c) => {
        for (const t of tiles) {
            if (present.has(t.id) && t.layer === layer && t.r === r && t.c === c) return t;
        }
        return null;
    };
    const free = (t) => {
        if (at(t.layer + 1, t.r, t.c)) return false;
        const l = at(t.layer, t.r, t.c - 1);
        const rt = at(t.layer, t.r, t.c + 1);
        return !(l && rt);
    };

    const plan = [];
    while (present.size > 0) {
        const freeList = tiles.filter(t => present.has(t.id) && free(t));
        if (freeList.length < 2) return null;
        const i1 = Math.floor(Math.random() * freeList.length);
        let i2 = Math.floor(Math.random() * (freeList.length - 1));
        if (i2 >= i1) i2++;
        const a = freeList[i1], b = freeList[i2];
        plan.push([a.id, b.id]);
        present.delete(a.id);
        present.delete(b.id);
    }
    return plan;
}

// ---------------------------------------------------------------------------
// Interaction — the core click step (used by the canvas handler and tests).
// ---------------------------------------------------------------------------
function clickTile(id) {
    if (state !== 'playing') return;
    const t = tiles[id];
    if (!t || t.removed || !isFree(t)) return; // blocked / gone → ignore

    if (selected == null) {
        selected = id;
    } else if (selected === id) {
        selected = null;                        // click again to deselect
    } else {
        const s = tiles[selected];
        if (s.face === t.face) {
            removePair(s, t);
            selected = null;
            afterRemove();
        } else {
            selected = id;                      // switch selection
        }
    }
    hintPair = null;
    draw();
}

function afterRemove() {
    if (remaining() === 0) {
        win();
    } else if (!anyMovesLeft()) {
        state = 'stuck';
        showOverlay('No Moves Left', '',
            'Every free pair is exhausted — Undo a move or start a New Game.', 'New Game');
    }
}

// ---------------------------------------------------------------------------
// Undo / hint
// ---------------------------------------------------------------------------
function undo() {
    if (undoStack.length === 0) return;
    const [i, j] = undoStack.pop();
    tiles[i].removed = false;
    tiles[j].removed = false;
    selected = null;
    hintPair = null;
    if (state === 'won' || state === 'stuck') {
        state = 'playing';
        overlay.classList.remove('visible');
        loop();
    }
    updateHud();
    draw();
}

function showHint() {
    if (state !== 'playing') return;
    hintPair = findHint();
    draw();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function beginPlay() {
    state = 'playing';
    selected = null;
    hintPair = null;
    startedAt = performance.now();
    elapsed = 0;
    overlay.classList.remove('visible');
    updateHud();
    loop();
}

function newGame() {
    deal();
    selected = null;
    undoStack = [];
    hintPair = null;
    beginPlay();
}

function win() {
    state = 'won';
    elapsed = (performance.now() - startedAt) / 1000;
    if (best == null || elapsed < best) {
        best = elapsed;
        localStorage.setItem('mahjong-best', String(best));
        updateBest();
    }
    showOverlay('You Win!', 'Time: ' + formatTime(elapsed),
        'Board cleared — nicely done!', 'New Game');
}

function showOverlay(title, score, sub, btn) {
    overlayTitle.textContent = title;
    overlayScore.textContent = score;
    overlaySub.textContent = sub;
    btnStart.textContent = btn;
    overlay.classList.add('visible');
    cancelAnimationFrame(animId);
    draw();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function formatTime(s) {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return m + ':' + String(ss).padStart(2, '0');
}

function updateHud() {
    remainingEl.textContent = remaining();
}

function updateBest() {
    bestEl.textContent = best == null ? '—' : formatTime(best);
}

function updateTime() {
    if (state === 'playing') elapsed = (performance.now() - startedAt) / 1000;
    timeEl.textContent = formatTime(elapsed);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function tileScreen(t) {
    return {
        x: ORIGIN_X + t.c * TILE_W - t.layer * OFF_X,
        y: ORIGIN_Y + t.r * TILE_H - t.layer * OFF_Y,
    };
}

function draw() {
    ctx.fillStyle = '#0c231b';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Draw from the bottom layer up so higher tiles overlap correctly.
    const order = tiles.filter(t => !t.removed).slice().sort((a, b) => {
        if (a.layer !== b.layer) return a.layer - b.layer;
        if (a.r !== b.r) return a.r - b.r;
        return a.c - b.c;
    });

    const hint = hintPair || [];
    for (const t of order) {
        const { x, y } = tileScreen(t);
        const isSel = t.id === selected;
        const isHint = hint.includes(t.id);
        drawTile(x, y, t.face, isSel, isHint);
    }
}

function drawTile(x, y, face, selectedTile, hinted) {
    const w = TILE_W - 4, h = TILE_H - 4;

    // side/depth
    ctx.fillStyle = '#b8b09a';
    roundRect(x + 3, y + 4, w, h, 7);
    ctx.fill();

    // face
    ctx.fillStyle = selectedTile ? '#fff4c2' : hinted ? '#d7f0ff' : '#f7f4ea';
    roundRect(x, y, w, h, 7);
    ctx.fill();

    ctx.lineWidth = selectedTile ? 3 : hinted ? 3 : 1.5;
    ctx.strokeStyle = selectedTile ? '#e0a53c' : hinted ? '#3aa0e0' : '#cfc8b4';
    roundRect(x, y, w, h, 7);
    ctx.stroke();

    ctx.font = '30px "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(face, x + w / 2, y + h / 2 + 1);
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// ---------------------------------------------------------------------------
// Game loop — only drives the clock and a redraw while playing.
// ---------------------------------------------------------------------------
function loop() {
    if (state !== 'playing') return;
    updateTime();
    draw();
    animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Input — hit-test the topmost tile under the pointer.
// ---------------------------------------------------------------------------
function tileAtPoint(px, py) {
    // Search top layer first, then front-to-back, so overlaps resolve correctly.
    const order = tiles.filter(t => !t.removed).slice().sort((a, b) => {
        if (a.layer !== b.layer) return b.layer - a.layer;
        if (a.r !== b.r) return b.r - a.r;
        return b.c - a.c;
    });
    for (const t of order) {
        const { x, y } = tileScreen(t);
        if (px >= x && px <= x + TILE_W - 4 && py >= y && py <= y + TILE_H - 4) return t;
    }
    return null;
}

canvas.addEventListener('pointerdown', e => {
    if (state === 'idle' || state === 'won' || state === 'stuck') return;
    const rect = canvas.getBoundingClientRect();
    const scale = WIDTH / rect.width;
    const px = (e.clientX - rect.left) * scale;
    const py = (e.clientY - rect.top) * scale;
    const t = tileAtPoint(px, py);
    if (t) clickTile(t.id);
});

btnStart.addEventListener('click', () => {
    if (state === 'idle') beginPlay();
    else newGame();
});

btnHint.addEventListener('click', showHint);
btnUndo.addEventListener('click', undo);
btnNew.addEventListener('click', newGame);

document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'h') showHint();
    else if (k === 'u') undo();
    else if (k === 'n') newGame();
});

// ---------------------------------------------------------------------------
// Init — deal a board and show it behind the start overlay.
// ---------------------------------------------------------------------------
const storedBest = localStorage.getItem('mahjong-best');
best = storedBest == null ? null : parseFloat(storedBest);
updateBest();
deal();
state = 'idle';
updateHud();
updateTime();
draw();
