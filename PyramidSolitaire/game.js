// ---------------------------------------------------------------------------
// Pyramid Solitaire — clear a 7-row pyramid by removing pairs of exposed
// cards that sum to 13 (Kings, worth 13, go alone).
//
// Written as a single classic (non-module) script so all state and logic are
// reachable from the Playwright tests as plain globals, matching the repo's
// existing games. The game is turn-based — no animation loop — so the rules
// are pure functions over the global card arrays and the canvas is simply
// redrawn after each action. The deal uses a seeded PRNG (not Math.random)
// so any given seed reproduces the same board, which keeps tests reproducible.
// ---------------------------------------------------------------------------

// --- Layout ---
const CANVAS_W = 760;
const CANVAS_H = 600;
const CARD_W = 64;
const CARD_H = 90;
const SPACING_X = 64;          // horizontal centre-to-centre spacing in a row
const ROW_STEP = 34;           // vertical spacing between pyramid rows (overlap)
const PYRAMID_TOP = 22;
const CENTER_X = CANVAS_W / 2;
const PILE_Y = 470;
const STOCK_X = 244;
const WASTE_X = 452;

const SUITS = ['♠', '♥', '♦', '♣']; // spade heart diamond club
const RED_SUITS = new Set([1, 2]);                      // hearts, diamonds
const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const BEST_KEY = 'pyramid-best';

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const remainingEl = document.getElementById('remaining');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnNew = document.getElementById('btn-new');

// --- State (globals for the tests) ---
let state;                 // 'playing' | 'won'
let pyramid;               // jagged 7-row array of card objects
let stock;                 // array; top of pile is the last element
let waste;                 // array; top of pile is the last element
let selected;              // currently selected card object, or null
let score, best;

// ---------------------------------------------------------------------------
// Deterministic shuffle
// ---------------------------------------------------------------------------
function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function buildDeck() {
    const deck = [];
    let id = 0;
    for (let s = 0; s < 4; s++) {
        for (let r = 1; r <= 13; r++) {
            deck.push({ id: id++, suit: s, rank: r, value: r, loc: null, r: -1, c: -1, removed: false });
        }
    }
    return deck;
}

function shuffle(deck, rng) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
function loadBest() {
    const raw = parseInt(window.localStorage.getItem(BEST_KEY) || '0', 10);
    best = Number.isFinite(raw) ? raw : 0;
}

function newGame(seed) {
    const s = (seed === undefined ? (Date.now() >>> 0) : seed) >>> 0;
    const rng = mulberry32(s);
    const deck = shuffle(buildDeck(), rng);

    pyramid = [];
    let k = 0;
    for (let r = 0; r < 7; r++) {
        const row = [];
        for (let c = 0; c <= r; c++) {
            const card = deck[k++];
            card.loc = 'pyramid';
            card.r = r;
            card.c = c;
            card.removed = false;
            row.push(card);
        }
        pyramid.push(row);
    }

    stock = deck.slice(28);
    stock.forEach((card) => { card.loc = 'stock'; card.removed = false; });
    waste = [];

    selected = null;
    score = 0;
    state = 'playing';
    hideOverlay();
    updateHud();
    draw();
}

// ---------------------------------------------------------------------------
// Rules — pure functions over the card arrays
// ---------------------------------------------------------------------------
function cardValue(card) {
    return card.value;
}

function isExposed(r, c) {
    const card = pyramid[r] && pyramid[r][c];
    if (!card || card.removed) return false;
    if (r === 6) return true;                       // bottom row is never covered
    return pyramid[r + 1][c].removed && pyramid[r + 1][c + 1].removed;
}

function remaining() {
    let n = 0;
    for (const row of pyramid) for (const card of row) if (!card.removed) n++;
    return n;
}

function anyMovesLeft() {
    const playable = [];
    for (let r = 0; r < 7; r++) {
        for (let c = 0; c <= r; c++) {
            if (isExposed(r, c)) playable.push(pyramid[r][c]);
        }
    }
    if (waste.length) playable.push(waste[waste.length - 1]);
    for (const card of playable) {
        if (card.value === 13) return true;
        for (const other of playable) {
            if (other !== card && card.value + other.value === 13) return true;
        }
    }
    return false;
}

// Remove a set of cards from play. Pyramid cards score +5 each.
function removeCards(cards) {
    for (const card of cards) {
        if (card.loc === 'pyramid') {
            card.removed = true;
            score += 5;
        } else if (card.loc === 'waste') {
            const idx = waste.indexOf(card);
            if (idx >= 0) waste.splice(idx, 1);
        }
    }
}

function afterMove() {
    if (remaining() === 0) {
        score += 100;               // pyramid-cleared bonus
        state = 'won';
        updateHud();
        showOverlay('You cleared the pyramid!', `Score ${score} · Press N to play again`);
    } else {
        updateHud();
    }
    draw();
}

// Try to act on `card` (already known to be playable). Returns without effect
// for an unavailable card.
function pickCard(card) {
    if (state !== 'playing') return;

    if (card.value === 13) {        // King removed on its own
        removeCards([card]);
        selected = null;
        afterMove();
        return;
    }
    if (selected && selected.id === card.id) {  // deselect
        selected = null;
        draw();
        return;
    }
    if (selected && cardValue(selected) + cardValue(card) === 13) {
        removeCards([selected, card]);
        selected = null;
        afterMove();
        return;
    }
    selected = card;                // (re)select
    draw();
}

// ---------------------------------------------------------------------------
// Input entry points (also called directly by the tests)
// ---------------------------------------------------------------------------
function clickPyramid(r, c) {
    if (state !== 'playing') return;
    if (!isExposed(r, c)) return;   // covered or removed → ignore
    pickCard(pyramid[r][c]);
}

function clickWaste() {
    if (state !== 'playing') return;
    if (waste.length === 0) return;
    pickCard(waste[waste.length - 1]);
}

function clickStock() {
    if (state !== 'playing') return;
    if (stock.length > 0) {
        const card = stock.pop();
        card.loc = 'waste';
        waste.push(card);
    } else {
        // Recycle the waste back into the stock.
        while (waste.length) {
            const card = waste.pop();
            card.loc = 'stock';
            stock.push(card);
        }
    }
    // A drawn card can invalidate a waste selection.
    if (selected && selected.loc === 'stock') selected = null;
    draw();
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function pyramidCardRect(r, c) {
    const cx = CENTER_X + (c - r / 2) * SPACING_X;
    return { x: cx - CARD_W / 2, y: PYRAMID_TOP + r * ROW_STEP, w: CARD_W, h: CARD_H };
}

function inRect(px, py, rect) {
    return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function roundRect(x, y, w, h, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function drawFace(x, y, card, highlight) {
    roundRect(x, y, CARD_W, CARD_H, 8);
    ctx.fillStyle = '#fdfdf6';
    ctx.fill();
    ctx.lineWidth = highlight ? 4 : 1.5;
    ctx.strokeStyle = highlight ? '#ffd23f' : '#33405e';
    ctx.stroke();

    const red = RED_SUITS.has(card.suit);
    ctx.fillStyle = red ? '#d1344b' : '#1c2434';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(RANK_LABELS[card.rank], x + 6, y + 6);
    ctx.font = '26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(SUITS[card.suit], x + CARD_W / 2, y + CARD_H / 2 - 16);
}

function drawBack(x, y) {
    roundRect(x, y, CARD_W, CARD_H, 8);
    ctx.fillStyle = '#26468f';
    ctx.fill();
    ctx.strokeStyle = '#8fb0ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = '#4d74d6';
    for (let i = -CARD_H; i < CARD_W; i += 10) {
        ctx.beginPath();
        ctx.moveTo(x + Math.max(0, i), y + Math.max(0, -i));
        ctx.lineTo(x + Math.min(CARD_W, i + CARD_H), y + Math.min(CARD_H, CARD_H - i));
        ctx.stroke();
    }
}

function drawEmptySlot(x, y, label) {
    roundRect(x, y, CARD_W, CARD_H, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    if (label) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + CARD_W / 2, y + CARD_H / 2);
    }
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Pyramid — draw top rows first so lower rows overlap them.
    for (let r = 0; r < 7; r++) {
        for (let c = 0; c <= r; c++) {
            const card = pyramid[r][c];
            if (card.removed) continue;
            const rect = pyramidCardRect(r, c);
            const exposed = isExposed(r, c);
            drawFace(rect.x, rect.y, card, selected && selected.id === card.id);
            if (!exposed) {
                // Dim covered cards so the playable ones read clearly.
                roundRect(rect.x, rect.y, CARD_W, CARD_H, 8);
                ctx.fillStyle = 'rgba(10,16,34,0.42)';
                ctx.fill();
            }
        }
    }

    // Stock.
    if (stock.length > 0) drawBack(STOCK_X, PILE_Y);
    else drawEmptySlot(STOCK_X, PILE_Y, '↺');
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`Stock (${stock.length})`, STOCK_X + CARD_W / 2, PILE_Y + CARD_H + 8);

    // Waste.
    if (waste.length > 0) {
        const top = waste[waste.length - 1];
        drawFace(WASTE_X, PILE_Y, top, selected && selected.id === top.id);
    } else {
        drawEmptySlot(WASTE_X, PILE_Y, '');
    }
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`Waste (${waste.length})`, WASTE_X + CARD_W / 2, PILE_Y + CARD_H + 8);
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------
function updateHud() {
    if (score > best) {
        best = score;
        window.localStorage.setItem(BEST_KEY, String(best));
    }
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    remainingEl.textContent = String(remaining());
}

function showOverlay(title, sub) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Canvas input → rule entry points
// ---------------------------------------------------------------------------
canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Pyramid: test bottom rows first (frontmost) and only exposed cards.
    for (let r = 6; r >= 0; r--) {
        for (let c = 0; c <= r; c++) {
            if (!isExposed(r, c)) continue;
            if (inRect(x, y, pyramidCardRect(r, c))) {
                clickPyramid(r, c);
                return;
            }
        }
    }
    if (inRect(x, y, { x: STOCK_X, y: PILE_Y, w: CARD_W, h: CARD_H })) {
        clickStock();
        return;
    }
    if (inRect(x, y, { x: WASTE_X, y: PILE_Y, w: CARD_W, h: CARD_H })) {
        clickWaste();
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'n' || e.key === 'N') newGame();
});

btnNew.addEventListener('click', () => newGame());

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
loadBest();
newGame();
