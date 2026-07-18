// ---------------------------------------------------------------------------
// TriPeaks Solitaire — clear three overlapping pyramids by playing cards one
// rank above or below the top of the waste pile (Aces wrap A–K and A–2).
//
// The rules engine is a set of pure functions over plain card objects, all
// exposed on `window` so the Playwright suite can install exact boards with
// `loadState()` and drive moves without touching pixels. Rendering and mouse
// handling sit on top and hold no rules of their own — mirroring the Klondike
// and FreeCell games in this repo.
//
// Card: { rank: 1..13, suit: 'S'|'H'|'D'|'C' }   (suit is cosmetic only)
// ---------------------------------------------------------------------------

const SUITS = ['S', 'H', 'D', 'C'];
const RANK_LABEL = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const WIN_BONUS = 20;

// Which lower cards overlap (cover) each of the 28 tableau cards. A card is
// exposed only when every id listed here has been removed. Ids run 0–27 in
// reading order: row0 = 0–2, row1 = 3–8, row2 = 9–17, row3 = 18–27.
const COVERED_BY = [
    [3, 4], [5, 6], [7, 8],                                  // row 0 (peaks)
    [9, 10], [10, 11], [12, 13], [13, 14], [15, 16], [16, 17], // row 1
    [18, 19], [19, 20], [20, 21], [21, 22], [22, 23],        // row 2 …
    [23, 24], [24, 25], [25, 26], [26, 27],                  // … row 2
    [], [], [], [], [], [], [], [], [], [],                  // row 3 (exposed)
];

// Column position (in card-width units) and row for each tableau id — the
// three-peaks silhouette. Bottom row 0..9; each higher row centred between
// the two cards it rests on.
const LAYOUT = [
    // row 0
    { u: 1.5, r: 0 }, { u: 4.5, r: 0 }, { u: 7.5, r: 0 },
    // row 1
    { u: 1, r: 1 }, { u: 2, r: 1 }, { u: 4, r: 1 }, { u: 5, r: 1 }, { u: 7, r: 1 }, { u: 8, r: 1 },
    // row 2
    { u: 0.5, r: 2 }, { u: 1.5, r: 2 }, { u: 2.5, r: 2 }, { u: 3.5, r: 2 }, { u: 4.5, r: 2 },
    { u: 5.5, r: 2 }, { u: 6.5, r: 2 }, { u: 7.5, r: 2 }, { u: 8.5, r: 2 },
    // row 3
    { u: 0, r: 3 }, { u: 1, r: 3 }, { u: 2, r: 3 }, { u: 3, r: 3 }, { u: 4, r: 3 },
    { u: 5, r: 3 }, { u: 6, r: 3 }, { u: 7, r: 3 }, { u: 8, r: 3 }, { u: 9, r: 3 },
];

// --- Geometry ---
const CANVAS_W = 760;
const CANVAS_H = 470;
const CW = 64, CH = 90;
const HSTEP = 64, VSTEP = 34;
const MARGIN_X = (CANVAS_W - (9 * HSTEP + CW)) / 2;
const MARGIN_Y = 24;
const STOCK_X = CANVAS_W / 2 - CW - 40, STOCK_Y = 328;
const WASTE_X = CANVAS_W / 2 + 40, WASTE_Y = 328;

// Precompute top-left pixel corner of every tableau slot.
const POS = LAYOUT.map(({ u, r }) => ({
    x: MARGIN_X + u * HSTEP,
    y: MARGIN_Y + r * VSTEP,
}));

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const streakEl = document.getElementById('streak');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- Canonical state (kept on window; refs matter for tests) ---
window.tableau = new Array(28).fill(null);
window.stock = [];
window.waste = [];
window.state = 'idle';   // 'idle' | 'playing' | 'won' | 'lost'
window.score = 0;
window.streak = 0;
window.best = 0;
window.COVERED_BY = COVERED_BY;

const DEAL_SUB = 'Clear the peaks by playing cards one rank above or below the waste pile. Aces wrap around. Deal to begin.';

// ---------------------------------------------------------------------------
// Card helpers
// ---------------------------------------------------------------------------
function makeCard(rank, suit) {
    return { rank, suit };
}

function isRed(card) {
    return card.suit === 'H' || card.suit === 'D';
}

// Two ranks are adjacent if consecutive, with Ace wrapping King↔Ace↔Two.
function adjacent(a, b) {
    if (a == null || b == null) return false;
    const d = Math.abs(a - b);
    return d === 1 || d === 12;
}

function wasteTop() {
    return window.waste.length ? window.waste[window.waste.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Rule predicates
// ---------------------------------------------------------------------------
function isExposed(id) {
    return COVERED_BY[id].every((c) => window.tableau[c] === null);
}

function isPlayable(id) {
    const card = window.tableau[id];
    if (!card) return false;
    if (!isExposed(id)) return false;
    const top = wasteTop();
    return !!top && adjacent(top.rank, card.rank);
}

function hasMoves() {
    for (let id = 0; id < 28; id++) if (isPlayable(id)) return true;
    return false;
}

function tableauEmpty() {
    return window.tableau.every((c) => c === null);
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------
function playCard(id) {
    if (window.state !== 'playing') return false;
    if (!isPlayable(id)) return false;
    window.waste.push(window.tableau[id]);
    window.tableau[id] = null;
    window.streak += 1;
    window.score += window.streak;
    updateHud();
    settle();
    draw();
    return true;
}

function drawFromStock() {
    if (window.state !== 'playing') return false;
    if (window.stock.length === 0) return false;
    window.waste.push(window.stock.pop());
    window.streak = 0;
    updateHud();
    settle();
    draw();
    return true;
}

// Recompute the win / loss / playing status after any state change.
function settle() {
    if (tableauEmpty()) {
        if (window.state !== 'won') win();
        return;
    }
    if (!hasMoves() && window.stock.length === 0) {
        window.state = 'lost';
        showOverlay('NO MORE MOVES', DEAL_SUB, true);
        return;
    }
    window.state = 'playing';
    hideOverlay();
}

function win() {
    window.state = 'won';
    window.score += WIN_BONUS;
    saveBest();
    updateHud();
    showOverlay('YOU CLEARED THE PEAKS!', 'Deal again for a fresh set.', true);
}

function saveBest() {
    if (window.score > window.best) {
        window.best = window.score;
        try { localStorage.setItem('tripeaks-best', String(window.best)); } catch (e) { /* ignore */ }
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Dealing
// ---------------------------------------------------------------------------
function buildDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (let rank = 1; rank <= 13; rank++) deck.push(makeCard(rank, suit));
    }
    return deck;
}

// Deterministic PRNG (mulberry32) so tests can pass a seed for reproducibility.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(deck, rng) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    return deck;
}

function newGame(seed) {
    const rng = (seed === undefined) ? Math.random : mulberry32(seed);
    const deck = shuffle(buildDeck(), rng);
    window.tableau = deck.slice(0, 28);
    window.stock = deck.slice(28);      // 24 cards
    window.waste = [window.stock.pop()]; // flip one → stock 23, waste 1
    window.score = 0;
    window.streak = 0;
    window.state = 'playing';
    updateHud();
    hideOverlay();
    settle();   // in the unlikely event a deal is immediately dead
    draw();
}

// Install an exact board (used by the test suite).
function loadState(board) {
    window.tableau = (board.tableau || []).slice(0, 28).map((c) => (c ? { ...c } : null));
    while (window.tableau.length < 28) window.tableau.push(null);
    window.stock = (board.stock || []).map((c) => ({ ...c }));
    window.waste = (board.waste || []).map((c) => ({ ...c }));
    window.score = board.score || 0;
    window.streak = board.streak || 0;
    window.state = 'playing';
    updateHud();
    settle();
    draw();
}

// ---------------------------------------------------------------------------
// HUD + overlay
// ---------------------------------------------------------------------------
function updateHud() {
    scoreEl.textContent = window.score;
    streakEl.textContent = window.streak;
    bestEl.textContent = window.best;
}

function showOverlay(title, sub, showScore) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlayScore.textContent = showScore ? `Score ${window.score}` : '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
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

function drawCardFace(x, y, card, opts = {}) {
    const { highlight = false, dim = false } = opts;
    roundRect(x, y, CW, CH, 8);
    ctx.fillStyle = dim ? '#dfe6f0' : '#f7fafc';
    ctx.fill();
    ctx.lineWidth = highlight ? 3 : 1.5;
    ctx.strokeStyle = highlight ? '#34d399' : '#26365a';
    ctx.stroke();

    const label = RANK_LABEL[card.rank] || String(card.rank);
    const glyph = SUIT_GLYPH[card.suit];
    ctx.fillStyle = isRed(card) ? '#d43a52' : '#1c2740';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillText(label, x + 7, y + 6);
    ctx.font = '16px "Segoe UI", sans-serif';
    ctx.fillText(glyph, x + 8, y + 26);
    // Centre pip.
    ctx.textAlign = 'center';
    ctx.font = '30px "Segoe UI", sans-serif';
    ctx.fillText(glyph, x + CW / 2, y + CH / 2 - 6);

    if (dim) {
        roundRect(x, y, CW, CH, 8);
        ctx.fillStyle = 'rgba(10, 20, 40, 0.34)';
        ctx.fill();
    }
}

function drawCardBack(x, y) {
    roundRect(x, y, CW, CH, 8);
    ctx.fillStyle = '#1d4ed8';
    ctx.fill();
    ctx.strokeStyle = '#0b1f52';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    for (let i = -CH; i < CW; i += 10) {
        ctx.beginPath();
        ctx.moveTo(x + Math.max(0, i), y + Math.max(0, -i));
        ctx.lineTo(x + Math.min(CW, i + CH), y + Math.min(CH, CH - i));
        ctx.stroke();
    }
}

function drawEmptySlot(x, y, glyph) {
    roundRect(x, y, CW, CH, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    if (glyph) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '22px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(glyph, x + CW / 2, y + CH / 2);
    }
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Tableau — ascending id so lower rows paint over higher ones (correct overlap).
    for (let id = 0; id < 28; id++) {
        const card = window.tableau[id];
        if (!card) continue;
        const { x, y } = POS[id];
        if (isExposed(id)) {
            drawCardFace(x, y, card, { highlight: window.state === 'playing' && isPlayable(id) });
        } else {
            drawCardFace(x, y, card, { dim: true });
        }
    }

    // Stock.
    if (window.stock.length > 0) {
        drawCardBack(STOCK_X, STOCK_Y);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = 'bold 14px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(String(window.stock.length), STOCK_X + CW / 2, STOCK_Y + CH + 6);
    } else {
        drawEmptySlot(STOCK_X, STOCK_Y, '↻');
    }

    // Waste.
    const top = wasteTop();
    if (top) drawCardFace(WASTE_X, WASTE_Y, top);
    else drawEmptySlot(WASTE_X, WASTE_Y, '');

    // Labels.
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('STOCK', STOCK_X + CW / 2, STOCK_Y - 18);
    ctx.fillText('WASTE', WASTE_X + CW / 2, WASTE_Y - 18);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function pointInRect(px, py, x, y, w, h) {
    return px >= x && px <= x + w && py >= y && py <= y + h;
}

canvas.addEventListener('click', (e) => {
    if (window.state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const scale = CANVAS_W / rect.width;
    const px = (e.clientX - rect.left) * scale;
    const py = (e.clientY - rect.top) * scale;

    // Stock first.
    if (pointInRect(px, py, STOCK_X, STOCK_Y, CW, CH)) {
        drawFromStock();
        return;
    }
    // Tableau, front-most (highest id) first.
    for (let id = 27; id >= 0; id--) {
        const card = window.tableau[id];
        if (!card || !isExposed(id)) continue;
        const { x, y } = POS[id];
        if (pointInRect(px, py, x, y, CW, CH)) {
            playCard(id);
            return;
        }
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'n' || e.key === 'N') {
        newGame();
        e.preventDefault();
    } else if ((e.key === ' ' || e.key === 'Spacebar') && (window.state === 'idle' || window.state === 'won' || window.state === 'lost')) {
        newGame();
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => newGame());

// ---------------------------------------------------------------------------
// Expose the rules API for the test suite.
// ---------------------------------------------------------------------------
Object.assign(window, {
    makeCard, adjacent, isExposed, isPlayable, hasMoves,
    playCard, drawFromStock, newGame, loadState,
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
window.best = parseInt(localStorage.getItem('tripeaks-best') || '0', 10) || 0;
window.state = 'idle';
updateHud();
showOverlay('TRIPEAKS SOLITAIRE', DEAL_SUB, false);
draw();
