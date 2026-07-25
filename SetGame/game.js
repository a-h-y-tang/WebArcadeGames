'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CANVAS_W = 600;
const CANVAS_H = 400;
const ROWS = 3;

const DECK_SIZE = 81;            // 3^4 attribute combinations
const HAND_SIZE = 12;            // cards on the table to start
const SET_POINTS = 3;
const MISTAKE_PENALTY = 1;

const COLORS = ['#e11d48', '#16a34a', '#8b5cf6']; // red, green, purple
const BEST_KEY = 'set-best';

// ---------------------------------------------------------------------------
// State (plain globals so the Playwright tests can read/drive them directly)
// ---------------------------------------------------------------------------
let state = 'idle';              // 'idle' | 'running' | 'over'
let deck = [];                   // remaining card ids
let board = [];                  // card ids on the table
let selected = [];               // indices into board (0..2)
let hintCells = [];              // indices briefly highlighted by a hint
let score = 0;
let best = 0;
let setsFound = 0;
let mistakes = 0;

const canvas = document.getElementById('canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Cards & the Set rule
// ---------------------------------------------------------------------------
function decodeCard(id) {
    return {
        count: Math.floor(id / 27) % 3,   // 0,1,2  -> 1,2,3 shapes
        color: Math.floor(id / 9) % 3,
        shape: Math.floor(id / 3) % 3,    // 0 oval, 1 diamond, 2 squiggle
        shading: id % 3,                  // 0 solid, 1 striped, 2 open
    };
}

// Three cards form a Set iff, for every attribute, the three values are all
// equal or all different — equivalently, their sum is divisible by 3.
function isSet(a, b, c) {
    const da = decodeCard(a);
    const db = decodeCard(b);
    const dc = decodeCard(c);
    return ['count', 'color', 'shape', 'shading'].every(
        (k) => (da[k] + db[k] + dc[k]) % 3 === 0
    );
}

// Return the indices [i, j, k] of the first Set in `cards`, or null if none.
function findSetIndices(cards) {
    const n = cards.length;
    for (let i = 0; i < n - 2; i++) {
        for (let j = i + 1; j < n - 1; j++) {
            for (let k = j + 1; k < n; k++) {
                if (isSet(cards[i], cards[j], cards[k])) return [i, j, k];
            }
        }
    }
    return null;
}

function boardHasSet() {
    return findSetIndices(board) !== null;
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
    }
    return arr;
}

// ---------------------------------------------------------------------------
// Persistence & HUD
// ---------------------------------------------------------------------------
function loadBest() {
    let stored = 0;
    try {
        stored = parseInt(window.localStorage.getItem(BEST_KEY) || '0', 10);
    } catch (e) {
        stored = 0;
    }
    best = Number.isFinite(stored) ? stored : 0;
}

function saveBest() {
    try {
        window.localStorage.setItem(BEST_KEY, String(best));
    } catch (e) {
        /* ignore storage errors */
    }
}

function bumpBest() {
    if (score > best) {
        best = score;
        saveBest();
    }
}

function updateHud() {
    if (scoreEl) scoreEl.textContent = String(score);
    if (bestEl) bestEl.textContent = String(best);
}

function showOverlay(title, sub, buttonLabel) {
    if (!overlay) return;
    if (overlayTitle) overlayTitle.textContent = title;
    if (overlaySub) overlaySub.textContent = sub;
    if (btnStart) btnStart.textContent = buttonLabel;
    if (overlayScore) {
        overlayScore.textContent = state === 'over'
            ? `${setsFound} sets found · Score ${score}` : '';
    }
    overlay.classList.add('visible');
}

function hideOverlay() {
    if (overlay) overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Board management
// ---------------------------------------------------------------------------
// Deal three more cards until a Set exists (or the deck is exhausted).
function ensureSolvable() {
    while (!boardHasSet() && deck.length >= 3) {
        board.push(deck.pop(), deck.pop(), deck.pop());
    }
}

function maybeEndGame() {
    if (state === 'running' && deck.length === 0 && !boardHasSet()) {
        endGame();
    }
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------
function startGame() {
    state = 'running';
    score = 0;
    setsFound = 0;
    mistakes = 0;
    selected = [];
    hintCells = [];
    deck = shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i));
    board = deck.splice(0, HAND_SIZE);
    ensureSolvable();
    updateHud();
    hideOverlay();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    bumpBest();
    updateHud();
    showOverlay('GAME OVER', 'Press Space or click to play again', 'Play Again');
}

// ---------------------------------------------------------------------------
// Selection & evaluation
// ---------------------------------------------------------------------------
function selectCard(index) {
    if (state !== 'running') return;
    if (index < 0 || index >= board.length) return;

    const at = selected.indexOf(index);
    if (at !== -1) {
        selected.splice(at, 1); // toggle off
        return;
    }
    if (selected.length >= 3) return;
    selected.push(index);

    if (selected.length === 3) evaluateSelection();
}

function evaluateSelection() {
    const [i, j, k] = selected;
    if (isSet(board[i], board[j], board[k])) {
        // Remove the three matched cards.
        const drop = new Set(selected);
        board = board.filter((_, idx) => !drop.has(idx));
        score += SET_POINTS;
        setsFound += 1;
        bumpBest();
        selected = [];
        hintCells = [];
        // Refill toward twelve, then guarantee a Set is available.
        while (board.length < HAND_SIZE && deck.length >= 3) {
            board.push(deck.pop(), deck.pop(), deck.pop());
        }
        ensureSolvable();
        updateHud();
        maybeEndGame();
    } else {
        mistakes += 1;
        score = Math.max(0, score - MISTAKE_PENALTY);
        selected = [];
        updateHud();
    }
}

function hint() {
    if (state !== 'running') return null;
    const idx = findSetIndices(board);
    if (idx) {
        hintCells = idx.slice();
        clearHintSoon();
    }
    return idx;
}

let hintTimer = null;
function clearHintSoon() {
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hintCells = []; }, 1300);
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------
function columnsForBoard() {
    return Math.max(1, Math.round(board.length / ROWS));
}

function cellRect(index) {
    const cols = columnsForBoard();
    const cw = CANVAS_W / cols;
    const ch = CANVAS_H / ROWS;
    const col = index % cols;
    const row = Math.floor(index / cols);
    return { x: col * cw, y: row * ch, w: cw, h: ch };
}

function cardIndexAt(px, py) {
    const cols = columnsForBoard();
    const cw = CANVAS_W / cols;
    const ch = CANVAS_H / ROWS;
    const col = Math.floor(px / cw);
    const row = Math.floor(py / ch);
    if (col < 0 || col >= cols || row < 0 || row >= ROWS) return -1;
    const index = row * cols + col;
    return index < board.length ? index : -1;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function shapePath(x, y, w, h, shape) {
    ctx.beginPath();
    if (shape === 0) {
        // oval
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else if (shape === 1) {
        // diamond
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w / 2, y + h);
        ctx.lineTo(x, y + h / 2);
        ctx.closePath();
    } else {
        // squiggle (approximated with bezier curves)
        ctx.moveTo(x + w * 0.06, y + h * 0.5);
        ctx.bezierCurveTo(x + w * 0.02, y + h * 0.05, x + w * 0.5, y + h * 0.2, x + w * 0.72, y + h * 0.12);
        ctx.bezierCurveTo(x + w * 0.98, y + h * 0.02, x + w * 0.99, y + h * 0.45, x + w * 0.9, y + h * 0.55);
        ctx.bezierCurveTo(x + w * 0.94, y + h * 0.95, x + w * 0.5, y + h * 0.8, x + w * 0.28, y + h * 0.88);
        ctx.bezierCurveTo(x + w * 0.02, y + h * 0.98, x + w * 0.01, y + h * 0.55, x + w * 0.06, y + h * 0.5);
        ctx.closePath();
    }
}

function drawSymbol(x, y, w, h, shape, color, shading) {
    const col = COLORS[color];
    shapePath(x, y, w, h, shape);
    if (shading === 0) {
        // solid
        ctx.fillStyle = col;
        ctx.fill();
    } else if (shading === 1) {
        // striped: clip to the shape and draw hatching
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        for (let lx = x; lx <= x + w; lx += 5) {
            ctx.beginPath();
            ctx.moveTo(lx, y);
            ctx.lineTo(lx, y + h);
            ctx.stroke();
        }
        ctx.restore();
    }
    // open (and the outline for all shadings)
    shapePath(x, y, w, h, shape);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.stroke();
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

function drawCard(index, ts) {
    const r = cellRect(index);
    const pad = 8;
    const cx = r.x + pad;
    const cy = r.y + pad;
    const cw = r.w - pad * 2;
    const ch = r.h - pad * 2;
    const card = decodeCard(board[index]);

    // card face
    ctx.fillStyle = '#f8fafc';
    roundRect(cx, cy, cw, ch, 10);
    ctx.fill();

    // selection / hint frame
    const isSel = selected.includes(index);
    const isHint = hintCells.includes(index);
    if (isSel || isHint) {
        const pulse = 0.5 + 0.5 * Math.sin(ts / 180);
        ctx.strokeStyle = isSel ? '#a78bfa' : `rgba(56,189,248,${0.5 + 0.4 * pulse})`;
        ctx.lineWidth = isSel ? 4 : 3;
        roundRect(cx + 1, cy + 1, cw - 2, ch - 2, 9);
        ctx.stroke();
    } else {
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        roundRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1, 9);
        ctx.stroke();
    }

    // symbols
    const count = card.count + 1;
    const symW = cw * 0.62;
    const symH = Math.min(30, (ch - 20) / 3);
    const gap = 8;
    const totalH = count * symH + (count - 1) * gap;
    const sx = cx + (cw - symW) / 2;
    let sy = cy + (ch - totalH) / 2;
    for (let s = 0; s < count; s++) {
        drawSymbol(sx, sy, symW, symH, card.shape, card.color, card.shading);
        sy += symH + gap;
    }
}

function render(ts) {
    if (!ctx) return;
    ts = ts || 0;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (state === 'idle') return;
    for (let i = 0; i < board.length; i++) drawCard(i, ts);
}

// ---------------------------------------------------------------------------
// Main loop (render only — the game is turn-based)
// ---------------------------------------------------------------------------
function frame(ts) {
    render(ts);
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function onKeyDown(e) {
    const k = e.key;
    if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
        e.preventDefault();
        if (state !== 'running') startGame();
    } else if (k === 'h' || k === 'H') {
        e.preventDefault();
        hint();
    }
}

function onPointerDown(e) {
    e.preventDefault();
    if (state !== 'running') {
        startGame();
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const idx = cardIndexAt(px, py);
    if (idx !== -1) selectCard(idx);
}

if (canvas) {
    document.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('pointerdown', onPointerDown);
    if (btnStart) {
        btnStart.addEventListener('click', startGame);
    }
    loadBest();
    updateHud();
    render(0);
    requestAnimationFrame(frame);
}
