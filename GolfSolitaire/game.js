// ---------------------------------------------------------------------------
// Golf Solitaire — clear seven columns of five face-up cards onto a single
// foundation. You may play the exposed (bottom) card of any column whenever its
// rank is exactly one away from the foundation card's rank (no wrap-around:
// King and Ace are not adjacent). Flip the stock when you're stuck. Clear every
// tableau card to win.
//
// The entire rule is the PURE predicate `canPlay(card, foundation)`. Because it
// is pure and `columns` / `stock` / `foundation` are directly settable, tests
// build exact positions and assert outcomes with no reliance on the shuffle
// (the only randomness in the game).
// ---------------------------------------------------------------------------

const WIDTH = 720;
const HEIGHT = 520;

const NUM_COLS = 7;
const COL_SIZE = 5;        // cards dealt per column
const TABLEAU = NUM_COLS * COL_SIZE; // 35

// --- Card geometry ---------------------------------------------------------
const CARD_W = 84;
const CARD_H = 118;
const COL_GAP = 8;
const COL_TOP = 26;
const FAN = 27;            // vertical offset between fanned cards
const ROW_START_X = (WIDTH - (NUM_COLS * CARD_W + (NUM_COLS - 1) * COL_GAP)) / 2;
const PILE_Y = 360;
const STOCK_X = WIDTH / 2 - CARD_W - 30;
const FOUND_X = WIDTH / 2 + 30;

const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];
const RANK_LABELS = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

// --- DOM -------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State -----------------------------------------------------------------
// state: 'idle' | 'playing' | 'won' | 'lost'
// card: { rank: 1..13, suit: 0..3 }
let state, score, best;
let columns, stock, foundation;

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------
function makeDeck() {
    const d = [];
    for (let suit = 0; suit < 4; suit++) {
        for (let rank = 1; rank <= 13; rank++) {
            d.push({ rank, suit });
        }
    }
    return d;
}

function shuffle(d) {
    for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = d[i];
        d[i] = d[j];
        d[j] = t;
    }
    return d;
}

// ---------------------------------------------------------------------------
// The rule — pure
// ---------------------------------------------------------------------------
function canPlay(card, found) {
    if (!card || !found) return false;
    return Math.abs(card.rank - found.rank) === 1;
}

function hasAnyMove() {
    return columns.some(col => col.length > 0 && canPlay(col[col.length - 1], foundation));
}

// ---------------------------------------------------------------------------
// Persistence & HUD
// ---------------------------------------------------------------------------
function loadBest() {
    return parseInt(localStorage.getItem('golf-solitaire-best') || '0', 10) || 0;
}

function saveBest() {
    try { localStorage.setItem('golf-solitaire-best', String(best)); } catch (e) {}
}

function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
}

function recordBest() {
    if (score > best) {
        best = score;
        saveBest();
        updateHud();
    }
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------
function startGame() {
    const deck = shuffle(makeDeck());
    columns = [];
    for (let c = 0; c < NUM_COLS; c++) {
        columns.push(deck.splice(0, COL_SIZE));
    }
    stock = deck;                 // 17 remaining
    foundation = stock.pop();     // flip the first → 16 left
    score = 0;
    state = 'playing';
    overlay.classList.remove('visible');
    updateHud();
    render();
}

function checkEnd() {
    if (state !== 'playing') return;
    if (columns.every(c => c.length === 0)) {
        state = 'won';
        recordBest();
        showOverlay('You Win!', `Cleared all ${TABLEAU} cards!`, 'Play Again');
    } else if (stock.length === 0 && !hasAnyMove()) {
        state = 'lost';
        recordBest();
        showOverlay('Out of Moves', `You cleared ${score} of ${TABLEAU} cards.`, 'New Deal');
    }
}

// Play the exposed card of column i onto the foundation, if legal.
function playColumn(i) {
    if (state !== 'playing') return;
    const col = columns[i];
    if (!col || col.length === 0) return;
    const card = col[col.length - 1];
    if (!canPlay(card, foundation)) return;
    col.pop();
    foundation = card;
    score += 1;
    updateHud();
    checkEnd();
    render();
}

// Flip the top stock card onto the foundation.
function drawStock() {
    if (state !== 'playing') return;
    if (stock.length === 0) return;
    foundation = stock.pop();
    checkEnd();
    render();
}

function showOverlay(title, scoreLine, buttonLabel) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = 'Click a column to play its bottom card; flip the stock when stuck.';
    btnStart.textContent = buttonLabel;
    overlay.classList.add('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function colX(i) {
    return ROW_START_X + i * (CARD_W + COL_GAP);
}

function rankLabel(rank) {
    return RANK_LABELS[rank] || String(rank);
}

function drawSlot(x, y) {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    roundRect(x, y, CARD_W, CARD_H, 9);
    ctx.stroke();
}

function drawCardBack(x, y) {
    ctx.fillStyle = '#123a6b';
    roundRect(x, y, CARD_W, CARD_H, 9);
    ctx.fill();
    ctx.strokeStyle = '#2a5fa0';
    ctx.lineWidth = 3;
    roundRect(x + 7, y + 7, CARD_W - 14, CARD_H - 14, 6);
    ctx.stroke();
}

function drawCard(card, x, y, dimTop) {
    ctx.fillStyle = '#fbfbf7';
    roundRect(x, y, CARD_W, CARD_H, 9);
    ctx.fill();
    ctx.strokeStyle = '#d5d5cc';
    ctx.lineWidth = 1;
    ctx.stroke();

    const red = card.suit === 1 || card.suit === 2;
    ctx.fillStyle = red ? '#c8283c' : '#151515';
    const label = rankLabel(card.rank);
    const sym = SUIT_SYMBOLS[card.suit];

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 22px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(label, x + 8, y + 6);
    ctx.font = '18px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(sym, x + 9, y + 30);

    // Only the fully-visible (exposed) cards get a big centre pip.
    if (!dimTop) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '46px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(sym, x + CARD_W / 2, y + CARD_H / 2 + 10);
    }
}

function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (!columns) return;

    // Columns (fanned downward; the last card is the exposed / playable one).
    for (let i = 0; i < NUM_COLS; i++) {
        const col = columns[i];
        const x = colX(i);
        if (col.length === 0) {
            drawSlot(x, COL_TOP);
            continue;
        }
        for (let j = 0; j < col.length; j++) {
            const y = COL_TOP + j * FAN;
            const isExposed = j === col.length - 1;
            // highlight a legally-playable exposed card
            if (isExposed && state === 'playing' && canPlay(col[j], foundation)) {
                ctx.save();
                ctx.shadowColor = 'rgba(255,213,74,0.9)';
                ctx.shadowBlur = 16;
                drawCard(col[j], x, y, false);
                ctx.restore();
            } else {
                drawCard(col[j], x, y, !isExposed);
            }
        }
    }

    // Stock pile
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '15px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Stock (' + (stock ? stock.length : 0) + ')', STOCK_X + CARD_W / 2, PILE_Y - 6);
    if (stock && stock.length > 0) drawCardBack(STOCK_X, PILE_Y);
    else drawSlot(STOCK_X, PILE_Y);

    // Foundation
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('Foundation', FOUND_X + CARD_W / 2, PILE_Y - 6);
    if (foundation) drawCard(foundation, FOUND_X, PILE_Y, false);
    else drawSlot(FOUND_X, PILE_Y);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function hitColumn(mx, my) {
    for (let i = 0; i < NUM_COLS; i++) {
        const col = columns[i];
        const x = colX(i);
        const bottom = COL_TOP + Math.max(0, col.length - 1) * FAN + CARD_H;
        if (mx >= x && mx <= x + CARD_W && my >= COL_TOP && my <= bottom) {
            return i;
        }
    }
    return -1;
}

function inRect(mx, my, x, y) {
    return mx >= x && mx <= x + CARD_W && my >= y && my <= y + CARD_H;
}

canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    if (inRect(mx, my, STOCK_X, PILE_Y)) {
        drawStock();
        return;
    }
    const c = hitColumn(mx, my);
    if (c >= 0) playColumn(c);
});

document.addEventListener('keydown', e => {
    const k = e.key;
    if (k === 'n' || k === 'N') {
        startGame();
        return;
    }
    if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
        e.preventDefault();
        if (state === 'playing') drawStock();
        else startGame();
    }
});

btnStart.addEventListener('click', startGame);

// ---------------------------------------------------------------------------
// Init — idle behind the start overlay.
// ---------------------------------------------------------------------------
best = loadBest();
score = 0;
columns = [[], [], [], [], [], [], []];
stock = [];
foundation = null;
state = 'idle';
updateHud();
render();
