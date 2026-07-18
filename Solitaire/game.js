// ---------------------------------------------------------------------------
// Klondike Solitaire — build all four foundations from Ace to King. The rules
// engine is a set of pure functions over plain card objects, all exposed on
// `window` so the Playwright suite can install exact boards and drive moves
// without touching pixels. Rendering and mouse handling sit on top and hold no
// rules of their own.
//
// Card: { rank: 1..13, suit: 'S'|'H'|'D'|'C', faceUp: bool }
// ---------------------------------------------------------------------------

const SUITS = ['S', 'H', 'D', 'C'];
const RANK_LABEL = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const movesEl = document.getElementById('moves');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnNew = document.getElementById('btn-new');

// --- Canonical state (kept on window; array refs stay stable for tests) ---
window.stock = [];
window.waste = [];
window.foundations = [[], [], [], []];
window.tableau = [[], [], [], [], [], [], []];
window.state = 'idle';        // 'idle' | 'playing' | 'won'
window.moves = 0;

let selected = null;          // { type:'waste' } | { type:'foundation', idx } | { type:'tableau', col, index }

// ---------------------------------------------------------------------------
// Card helpers
// ---------------------------------------------------------------------------
function makeCard(rank, suit, faceUp = true) {
    return { rank, suit, faceUp };
}

function color(card) {
    return card.suit === 'H' || card.suit === 'D' ? 'red' : 'black';
}

function isValidRun(cards) {
    for (let i = 0; i < cards.length; i++) {
        if (!cards[i].faceUp) return false;
        if (i > 0) {
            const prev = cards[i - 1];
            const cur = cards[i];
            if (cur.rank !== prev.rank - 1) return false;
            if (color(cur) === color(prev)) return false;
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Rule predicates
// ---------------------------------------------------------------------------
function canMoveToFoundation(card, fIdx) {
    const pile = window.foundations[fIdx];
    if (!pile) return false;
    if (pile.length === 0) return card.rank === 1;
    const top = pile[pile.length - 1];
    return top.suit === card.suit && card.rank === top.rank + 1;
}

function canMoveToTableau(card, col) {
    const pile = window.tableau[col];
    if (!pile) return false;
    if (pile.length === 0) return card.rank === 13;
    const top = pile[pile.length - 1];
    if (!top.faceUp) return false;
    return color(top) !== color(card) && card.rank === top.rank - 1;
}

// ---------------------------------------------------------------------------
// Dealing
// ---------------------------------------------------------------------------
function buildDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (let rank = 1; rank <= 13; rank++) deck.push(makeCard(rank, suit, false));
    }
    return deck;
}

// Deterministic PRNG (mulberry32) so a seed always deals the same game.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(deck, rng) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = deck[i];
        deck[i] = deck[j];
        deck[j] = tmp;
    }
}

function newGame(seed) {
    const s = seed === undefined ? Math.floor(Math.random() * 0xffffffff) : seed;
    const rng = mulberry32(s);
    const deck = buildDeck();
    shuffle(deck, rng);

    window.tableau = [[], [], [], [], [], [], []];
    for (let col = 0; col < 7; col++) {
        for (let k = 0; k <= col; k++) {
            const card = deck.pop();
            card.faceUp = k === col;
            window.tableau[col].push(card);
        }
    }
    // Remaining cards form the stock, all face down.
    window.stock = deck.map((c) => {
        c.faceUp = false;
        return c;
    });
    window.waste = [];
    window.foundations = [[], [], [], []];
    window.moves = 0;
    window.state = 'playing';
    selected = null;
    hideOverlay();
    updateHud();
    draw();
    return true;
}

// Install an exact board (used by tests). Missing piles default to empty.
function loadState(board = {}) {
    const norm = (card, defFaceUp) => ({
        rank: card.rank,
        suit: card.suit,
        faceUp: card.faceUp === undefined ? defFaceUp : card.faceUp,
    });
    window.stock = (board.stock || []).map((c) => norm(c, false));
    window.stock.forEach((c) => { c.faceUp = false; });
    window.waste = (board.waste || []).map((c) => norm(c, true));

    window.foundations = [[], [], [], []];
    (board.foundations || []).forEach((pile, i) => {
        if (i < 4) window.foundations[i] = pile.map((c) => norm(c, true));
    });

    window.tableau = [[], [], [], [], [], [], []];
    (board.tableau || []).forEach((pile, i) => {
        if (i < 7) window.tableau[i] = pile.map((c) => norm(c, true));
    });

    window.moves = 0;
    window.state = 'playing';
    selected = null;
    hideOverlay();
    updateHud();
    draw();
    return true;
}

// ---------------------------------------------------------------------------
// Moves — each returns true when the move was legal and applied.
// ---------------------------------------------------------------------------
function afterMove() {
    window.moves += 1;
    updateHud();
    if (isWon()) handleWin();
    draw();
}

function flipExposed(col) {
    const pile = window.tableau[col];
    if (pile.length && !pile[pile.length - 1].faceUp) {
        pile[pile.length - 1].faceUp = true;
    }
}

function drawFromStock() {
    if (window.state !== 'playing') return false;
    if (window.stock.length) {
        const card = window.stock.pop();
        card.faceUp = true;
        window.waste.push(card);
    } else if (window.waste.length) {
        // Recycle: waste returns to the stock, face down, order preserved.
        while (window.waste.length) {
            const card = window.waste.pop();
            card.faceUp = false;
            window.stock.push(card);
        }
    } else {
        return false;
    }
    window.moves += 1;
    updateHud();
    draw();
    return true;
}

function moveWasteToFoundation(fIdx) {
    if (window.state !== 'playing' || !window.waste.length) return false;
    const card = window.waste[window.waste.length - 1];
    if (!canMoveToFoundation(card, fIdx)) return false;
    window.foundations[fIdx].push(window.waste.pop());
    afterMove();
    return true;
}

function moveWasteToTableau(col) {
    if (window.state !== 'playing' || !window.waste.length) return false;
    const card = window.waste[window.waste.length - 1];
    if (!canMoveToTableau(card, col)) return false;
    window.tableau[col].push(window.waste.pop());
    afterMove();
    return true;
}

function moveTableauToFoundation(col, fIdx) {
    if (window.state !== 'playing') return false;
    const pile = window.tableau[col];
    if (!pile || !pile.length) return false;
    const card = pile[pile.length - 1];
    if (!card.faceUp || !canMoveToFoundation(card, fIdx)) return false;
    window.foundations[fIdx].push(pile.pop());
    flipExposed(col);
    afterMove();
    return true;
}

function moveTableauToTableau(fromCol, count, toCol) {
    if (window.state !== 'playing') return false;
    const from = window.tableau[fromCol];
    const to = window.tableau[toCol];
    if (!from || !to || fromCol === toCol) return false;
    if (count <= 0 || count > from.length) return false;
    const moving = from.slice(from.length - count);
    if (!isValidRun(moving)) return false;
    if (!canMoveToTableau(moving[0], toCol)) return false;
    from.splice(from.length - count, count);
    for (const c of moving) to.push(c);
    flipExposed(fromCol);
    afterMove();
    return true;
}

function moveFoundationToTableau(fIdx, col) {
    if (window.state !== 'playing') return false;
    const pile = window.foundations[fIdx];
    if (!pile || !pile.length) return false;
    const card = pile[pile.length - 1];
    if (!canMoveToTableau(card, col)) return false;
    window.tableau[col].push(pile.pop());
    afterMove();
    return true;
}

// Convenience: send a card to the first foundation that accepts it.
function sendToFoundation(source) {
    for (let f = 0; f < 4; f++) {
        if (source.type === 'waste' && moveWasteToFoundation(f)) return true;
        if (source.type === 'tableau' && moveTableauToFoundation(source.col, f)) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Win handling & persistence
// ---------------------------------------------------------------------------
function isWon() {
    return window.foundations.reduce((n, p) => n + p.length, 0) === 52;
}

function bestKey() {
    return 'solitaire.best';
}

function handleWin() {
    window.state = 'won';
    let best = null;
    try {
        const prev = parseInt(localStorage.getItem(bestKey()), 10);
        if (isNaN(prev) || window.moves < prev) {
            localStorage.setItem(bestKey(), String(window.moves));
        }
        best = localStorage.getItem(bestKey());
    } catch (e) { /* localStorage unavailable */ }
    updateHud();
    showOverlay('You win! 🎉', `Solved in ${window.moves} moves${best ? ` · best ${best}` : ''}.`, 'Play again');
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------
function updateHud() {
    movesEl.textContent = String(window.moves);
    let best = null;
    try {
        best = localStorage.getItem(bestKey());
    } catch (e) {
        best = null;
    }
    bestEl.textContent = best === null ? '–' : best;
}

function showOverlay(title, sub, buttonLabel) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    if (buttonLabel) btnStart.textContent = buttonLabel;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Layout & rendering
// ---------------------------------------------------------------------------
const CARD_W = 96;
const CARD_H = 132;
const GAP = 14;
const MARGIN_X = 20;
const TOP_Y = 20;
const TABLEAU_Y = TOP_Y + CARD_H + 28;
const FAN = 30;               // vertical offset between fanned tableau cards

function colX(col) {
    return MARGIN_X + col * (CARD_W + GAP);
}

// Screen rectangles for the top-row piles.
const stockRect = () => ({ x: colX(0), y: TOP_Y, w: CARD_W, h: CARD_H });
const wasteRect = () => ({ x: colX(1), y: TOP_Y, w: CARD_W, h: CARD_H });
const foundationRect = (i) => ({ x: colX(3 + i), y: TOP_Y, w: CARD_W, h: CARD_H });

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawEmptySlot(x, y, glyph) {
    roundRect(x, y, CARD_W, CARD_H, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (glyph) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '40px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(glyph, x + CARD_W / 2, y + CARD_H / 2);
    }
}

function drawCardBack(x, y) {
    roundRect(x, y, CARD_W, CARD_H, 8);
    ctx.fillStyle = '#2b4c8c';
    ctx.fill();
    roundRect(x + 6, y + 6, CARD_W - 12, CARD_H - 12, 6);
    ctx.strokeStyle = '#6f96d8';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    for (let i = -CARD_H; i < CARD_W; i += 12) {
        ctx.beginPath();
        ctx.moveTo(x + Math.max(0, i), y + Math.max(0, -i));
        ctx.lineTo(x + Math.min(CARD_W, i + CARD_H), y + Math.min(CARD_H, CARD_H - i));
        ctx.stroke();
    }
}

function drawCardFace(x, y, card, highlight) {
    roundRect(x, y, CARD_W, CARD_H, 8);
    ctx.fillStyle = '#fbfbf7';
    ctx.fill();
    ctx.strokeStyle = highlight ? '#ffd479' : '#c8c8bf';
    ctx.lineWidth = highlight ? 3 : 1.5;
    ctx.stroke();

    const red = color(card) === 'red';
    ctx.fillStyle = red ? '#c62828' : '#1a1a1a';
    const label = RANK_LABEL[card.rank] || String(card.rank);
    const glyph = SUIT_GLYPH[card.suit];

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 22px Arial';
    ctx.fillText(label, x + 8, y + 7);
    ctx.font = '20px serif';
    ctx.fillText(glyph, x + 8, y + 30);

    // Large centre pip
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '52px serif';
    ctx.fillText(glyph, x + CARD_W / 2, y + CARD_H / 2 + 6);

    // Mirrored corner
    ctx.save();
    ctx.translate(x + CARD_W, y + CARD_H);
    ctx.rotate(Math.PI);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 22px Arial';
    ctx.fillText(label, 8, 7);
    ctx.font = '20px serif';
    ctx.fillText(glyph, 8, 30);
    ctx.restore();
}

function isSelectedCard(type, col, index) {
    if (!selected) return false;
    if (selected.type !== type) return false;
    if (type === 'waste') return true;
    if (type === 'foundation') return selected.idx === col;
    if (type === 'tableau') return selected.col === col && index >= selected.index;
    return false;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Stock
    const sr = stockRect();
    if (window.stock.length) drawCardBack(sr.x, sr.y);
    else drawEmptySlot(sr.x, sr.y, '↻');

    // Waste (top card)
    const wr = wasteRect();
    if (window.waste.length) {
        drawCardFace(wr.x, wr.y, window.waste[window.waste.length - 1], isSelectedCard('waste'));
    } else {
        drawEmptySlot(wr.x, wr.y, '');
    }

    // Foundations
    for (let i = 0; i < 4; i++) {
        const fr = foundationRect(i);
        const pile = window.foundations[i];
        if (pile.length) drawCardFace(fr.x, fr.y, pile[pile.length - 1], isSelectedCard('foundation', i));
        else drawEmptySlot(fr.x, fr.y, SUIT_GLYPH[SUITS[i]]);
    }

    // Tableau
    for (let col = 0; col < 7; col++) {
        const x = colX(col);
        const pile = window.tableau[col];
        if (!pile.length) {
            drawEmptySlot(x, TABLEAU_Y, '');
            continue;
        }
        for (let i = 0; i < pile.length; i++) {
            const y = TABLEAU_Y + i * FAN;
            const card = pile[i];
            if (card.faceUp) drawCardFace(x, y, card, isSelectedCard('tableau', col, i));
            else drawCardBack(x, y);
        }
    }
}

// ---------------------------------------------------------------------------
// Mouse interaction
// ---------------------------------------------------------------------------
function within(rect, px, py) {
    return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

// Return what was clicked: {zone,...} or null.
function hitTest(px, py) {
    if (within(stockRect(), px, py)) return { zone: 'stock' };
    if (within(wasteRect(), px, py)) return { zone: 'waste' };
    for (let i = 0; i < 4; i++) {
        if (within(foundationRect(i), px, py)) return { zone: 'foundation', idx: i };
    }
    for (let col = 0; col < 7; col++) {
        const x = colX(col);
        if (px < x || px > x + CARD_W) continue;
        const pile = window.tableau[col];
        if (!pile.length) {
            if (py >= TABLEAU_Y && py <= TABLEAU_Y + CARD_H) return { zone: 'tableau', col, index: -1 };
            continue;
        }
        // Find the deepest card whose visible region contains py.
        for (let i = pile.length - 1; i >= 0; i--) {
            const y = TABLEAU_Y + i * FAN;
            const h = i === pile.length - 1 ? CARD_H : FAN;
            if (py >= y && py <= y + h) return { zone: 'tableau', col, index: i };
        }
    }
    return null;
}

function tryMoveSelectedTo(hit) {
    if (!selected) return false;
    if (hit.zone === 'foundation') {
        if (selected.type === 'waste') return moveWasteToFoundation(hit.idx);
        if (selected.type === 'tableau') {
            const pile = window.tableau[selected.col];
            // Only a single top card can go to a foundation.
            if (selected.index === pile.length - 1) return moveTableauToFoundation(selected.col, hit.idx);
        }
        return false;
    }
    if (hit.zone === 'tableau') {
        if (selected.type === 'waste') return moveWasteToTableau(hit.col);
        if (selected.type === 'foundation') return moveFoundationToTableau(selected.idx, hit.col);
        if (selected.type === 'tableau') {
            const count = window.tableau[selected.col].length - selected.index;
            return moveTableauToTableau(selected.col, count, hit.col);
        }
    }
    return false;
}

function onClick(evt) {
    if (window.state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const px = (evt.clientX - rect.left) * (canvas.width / rect.width);
    const py = (evt.clientY - rect.top) * (canvas.height / rect.height);
    const hit = hitTest(px, py);
    if (!hit) { selected = null; draw(); return; }

    if (hit.zone === 'stock') { selected = null; drawFromStock(); return; }

    if (selected) {
        const moved = tryMoveSelectedTo(hit);
        selected = null;
        if (!moved) selectAt(hit); // allow re-selecting the clicked pile
        draw();
        return;
    }
    selectAt(hit);
    draw();
}

function selectAt(hit) {
    selected = null;
    if (hit.zone === 'waste' && window.waste.length) {
        selected = { type: 'waste' };
    } else if (hit.zone === 'foundation' && window.foundations[hit.idx].length) {
        selected = { type: 'foundation', idx: hit.idx };
    } else if (hit.zone === 'tableau' && hit.index >= 0) {
        const card = window.tableau[hit.col][hit.index];
        if (card && card.faceUp) selected = { type: 'tableau', col: hit.col, index: hit.index };
    }
}

function onDblClick(evt) {
    if (window.state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const px = (evt.clientX - rect.left) * (canvas.width / rect.width);
    const py = (evt.clientY - rect.top) * (canvas.height / rect.height);
    const hit = hitTest(px, py);
    if (!hit) return;
    if (hit.zone === 'waste' && window.waste.length) sendToFoundation({ type: 'waste' });
    else if (hit.zone === 'tableau' && hit.index === window.tableau[hit.col].length - 1) {
        sendToFoundation({ type: 'tableau', col: hit.col });
    }
    selected = null;
    draw();
}

canvas.addEventListener('click', onClick);
canvas.addEventListener('dblclick', onDblClick);

btnStart.addEventListener('click', () => newGame());
btnNew.addEventListener('click', () => newGame());

document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'n') {
        e.preventDefault();
        newGame();
    }
});

// ---------------------------------------------------------------------------
// Expose API for tests
// ---------------------------------------------------------------------------
window.makeCard = makeCard;
window.color = color;
window.newGame = newGame;
window.loadState = loadState;
window.drawFromStock = drawFromStock;
window.canMoveToFoundation = canMoveToFoundation;
window.canMoveToTableau = canMoveToTableau;
window.moveWasteToFoundation = moveWasteToFoundation;
window.moveWasteToTableau = moveWasteToTableau;
window.moveTableauToFoundation = moveTableauToFoundation;
window.moveTableauToTableau = moveTableauToTableau;
window.moveFoundationToTableau = moveFoundationToTableau;
window.isWon = isWon;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
window.state = 'idle';
updateHud();
draw();
