// --- Board geometry ---
const WIDTH = 500;
const HEIGHT = 500;
const COLS = 4;
const ROWS = 4;
const TOTAL_PAIRS = (COLS * ROWS) / 2;   // 8

const CARD = 100;                        // card side in px
const GAP = 16;                          // gap between cards
const GRID_W = COLS * CARD + (COLS - 1) * GAP;
const GRID_H = ROWS * CARD + (ROWS - 1) * GAP;
const OFFSET_X = (WIDTH - GRID_W) / 2;
const OFFSET_Y = (HEIGHT - GRID_H) / 2;

const SYMBOLS = ['🍒', '🍋', '🍇', '🍉', '⭐', '🔔', '💎', '🍀'];

const MISMATCH_DELAY = 700;              // ms a mismatch lingers before flipping back

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const movesEl = document.getElementById('moves');
const pairsEl = document.getElementById('pairs');
const timeEl = document.getElementById('time');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let cards, state, moves, matchedPairs, best;
let firstPick, secondPick, lockBoard, mismatchTimer;
let cursor, elapsed, lastTime, animId;

// -----------------------------------------------------------------------
// Geometry helpers
// -----------------------------------------------------------------------
function cardRect(i) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return {
        x: OFFSET_X + col * (CARD + GAP),
        y: OFFSET_Y + row * (CARD + GAP),
        w: CARD,
        h: CARD,
    };
}

function pointToIndex(px, py) {
    for (let i = 0; i < cards.length; i++) {
        const r = cardRect(i);
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
    }
    return -1;
}

// -----------------------------------------------------------------------
// Deck
// -----------------------------------------------------------------------
function buildDeck() {
    const deck = [];
    for (const sym of SYMBOLS) {
        deck.push(sym, sym);
    }
    // Fisher–Yates shuffle for genuine replay variety
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    cards = deck.map(sym => ({ symbol: sym, faceUp: false, matched: false, reveal: 0 }));
}

// -----------------------------------------------------------------------
// HUD
// -----------------------------------------------------------------------
function updateMovesHud() { movesEl.textContent = moves; }
function updatePairsHud() { pairsEl.textContent = `${matchedPairs}/${TOTAL_PAIRS}`; }
function updateTimeHud() { timeEl.textContent = `${Math.floor(elapsed / 1000)}s`; }
function updateBestHud() { bestEl.textContent = best == null ? '—' : String(best); }

// -----------------------------------------------------------------------
// Game lifecycle
// -----------------------------------------------------------------------
function startGame() {
    buildDeck();
    state = 'running';
    moves = 0;
    matchedPairs = 0;
    firstPick = null;
    secondPick = null;
    lockBoard = false;
    mismatchTimer = 0;
    cursor = 0;
    elapsed = 0;

    updateMovesHud();
    updatePairsHud();
    updateTimeHud();
    overlay.classList.remove('visible');

    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function winGame() {
    state = 'won';
    for (const c of cards) c.reveal = 1;

    if (best == null || moves < best) {
        best = moves;
        localStorage.setItem('memory-match-best', String(best));
    }
    updateBestHud();

    overlayTitle.textContent = 'You Win!';
    overlayScore.textContent = `${moves} moves · ${Math.floor(elapsed / 1000)}s`;
    overlaySub.textContent = 'Press Space to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    cancelAnimationFrame(animId);
    draw();
}

function pauseGame() {
    state = 'paused';
    overlayTitle.textContent = 'Paused';
    overlayScore.textContent = '';
    overlaySub.textContent = 'Press P to resume';
    btnStart.textContent = 'Resume';
    overlay.classList.add('visible');
    cancelAnimationFrame(animId);
    draw();
}

function resumeGame() {
    state = 'running';
    overlay.classList.remove('visible');
    lastTime = null;
    animId = requestAnimationFrame(loop);
}

// -----------------------------------------------------------------------
// Core rule: reveal a card
// -----------------------------------------------------------------------
function flipAt(i) {
    if (state !== 'running') return;
    if (lockBoard) return;
    if (i < 0 || i >= cards.length) return;

    const c = cards[i];
    if (c.matched || c.faceUp) return;

    c.faceUp = true;

    if (firstPick === null) {
        firstPick = i;
        return;
    }

    // second pick completes an attempt
    secondPick = i;
    moves++;
    updateMovesHud();

    if (cards[firstPick].symbol === c.symbol) {
        cards[firstPick].matched = true;
        c.matched = true;
        matchedPairs++;
        updatePairsHud();
        firstPick = null;
        secondPick = null;
        if (matchedPairs === TOTAL_PAIRS) winGame();
    } else {
        lockBoard = true;
        mismatchTimer = MISMATCH_DELAY;
    }
}

function resolveMismatch() {
    if (firstPick !== null && cards[firstPick]) cards[firstPick].faceUp = false;
    if (secondPick !== null && cards[secondPick]) cards[secondPick].faceUp = false;
    firstPick = null;
    secondPick = null;
    lockBoard = false;
    mismatchTimer = 0;
}

// -----------------------------------------------------------------------
// Cursor
// -----------------------------------------------------------------------
function moveCursor(dx, dy) {
    let col = cursor % COLS;
    let row = Math.floor(cursor / COLS);
    col = Math.max(0, Math.min(COLS - 1, col + dx));
    row = Math.max(0, Math.min(ROWS - 1, row + dy));
    cursor = row * COLS + col;
}

// -----------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------
function loop(ts) {
    if (lastTime == null) lastTime = ts;
    const dt = ts - lastTime;
    lastTime = ts;

    if (state === 'running') {
        elapsed += dt;
        updateTimeHud();

        if (lockBoard) {
            mismatchTimer -= dt;
            if (mismatchTimer <= 0) resolveMismatch();
        }

        // ease card flip animations
        for (const c of cards) {
            const target = (c.faceUp || c.matched) ? 1 : 0;
            c.reveal += (target - c.reveal) * Math.min(1, dt / 90);
            if (Math.abs(target - c.reveal) < 0.01) c.reveal = target;
        }

        draw();
        animId = requestAnimationFrame(loop);
    }
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    g.addColorStop(0, '#0a1330');
    g.addColorStop(1, '#070b16');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    for (let i = 0; i < cards.length; i++) drawCard(i);

    // Selection cursor while playing
    if (state === 'running') {
        const r = cardRect(cursor);
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 3;
        roundRectPath(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 12);
        ctx.stroke();
    }
}

function drawCard(i) {
    const c = cards[i];
    const r = cardRect(i);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;

    // flip scale: full at reveal 0 (back) and 1 (front), pinched at the midpoint
    const scaleX = Math.abs(2 * c.reveal - 1);
    const showFront = c.reveal >= 0.5;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(Math.max(0.02, scaleX), 1);
    ctx.translate(-cx, -cy);

    if (showFront) {
        // Front face
        ctx.fillStyle = c.matched ? '#123726' : '#e8eef7';
        ctx.strokeStyle = c.matched ? '#38f28d' : '#8ab4f8';
        ctx.lineWidth = 3;
        roundRectPath(r.x, r.y, r.w, r.h, 12);
        ctx.fill();
        ctx.stroke();

        ctx.font = '48px "Segoe UI Emoji", "Noto Color Emoji", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = c.matched ? 0.85 : 1;
        ctx.fillText(c.symbol, cx, cy + 2);
        ctx.globalAlpha = 1;
    } else {
        // Back face
        const bg = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
        bg.addColorStop(0, '#2a4a8f');
        bg.addColorStop(1, '#16264d');
        ctx.fillStyle = bg;
        ctx.strokeStyle = '#3a5aa0';
        ctx.lineWidth = 2;
        roundRectPath(r.x, r.y, r.w, r.h, 12);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#4a6bb5';
        ctx.beginPath();
        ctx.arc(cx, cy, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#16264d';
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function roundRectPath(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
document.addEventListener('keydown', e => {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    if (state !== 'running' && state !== 'paused' && (k === ' ' || k === 'Enter')) {
        startGame();
        e.preventDefault();
        return;
    }

    if (state !== 'running') return;

    if (k === 'ArrowLeft') { moveCursor(-1, 0); e.preventDefault(); }
    else if (k === 'ArrowRight') { moveCursor(1, 0); e.preventDefault(); }
    else if (k === 'ArrowUp') { moveCursor(0, -1); e.preventDefault(); }
    else if (k === 'ArrowDown') { moveCursor(0, 1); e.preventDefault(); }
    else if (k === 'Enter' || k === ' ') { flipAt(cursor); e.preventDefault(); }
});

canvas.addEventListener('click', e => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (WIDTH / rect.width);
    const py = (e.clientY - rect.top) * (HEIGHT / rect.height);
    const i = pointToIndex(px, py);
    if (i >= 0) {
        cursor = i;
        flipAt(i);
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
const storedBest = localStorage.getItem('memory-match-best');
best = storedBest == null ? null : parseInt(storedBest, 10);
updateBestHud();
state = 'idle';
moves = 0;
matchedPairs = 0;
firstPick = null;
secondPick = null;
lockBoard = false;
cursor = 0;
elapsed = 0;
buildDeck();
updateMovesHud();
updatePairsHud();
updateTimeHud();
draw();
