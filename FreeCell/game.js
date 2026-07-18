// ---------------------------------------------------------------------------
// FreeCell — the classic open-information solitaire on an HTML5 canvas.
//
// All 52 cards are dealt face-up into eight tableau columns. Four free cells
// hold one card each; four foundations are built up A→K per suit. Descending,
// alternating-colour runs move together as "supermoves". Win by moving every
// card to its foundation.
//
// A single classic (non-module) script so the game state and rule functions are
// reachable from the Playwright tests as globals, mirroring the other games in
// this repo.
// ---------------------------------------------------------------------------

const SUITS = ['C', 'D', 'H', 'S'];
const SUIT_SYMBOL = { C: '♣', D: '♦', H: '♥', S: '♠' };
const RED = new Set(['H', 'D']);

// --- Layout ---
const CARD_W = 68;
const CARD_H = 94;
const COL_GAP = 8;
const MARGIN = 12;
const TOP_Y = 14;                          // free cell / foundation row
const TABLEAU_Y = TOP_Y + CARD_H + 22;     // first tableau card row
const FAN = 26;                            // vertical offset between fanned cards

const COL_X = Array.from({ length: 8 }, (_, i) => MARGIN + i * (CARD_W + COL_GAP));
const FREE_X = COL_X.slice(0, 4);
const FOUND_X = COL_X.slice(4, 8);

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const movesEl = document.getElementById('moves');
const timeEl = document.getElementById('time');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnNew = document.getElementById('btn-new');
const btnAuto = document.getElementById('btn-auto');

// --- State ---
let tableau, free, found, moves, best, state, selection, gameNo, startTime, clockId;

// ---------------------------------------------------------------------------
// Cards & dealing
// ---------------------------------------------------------------------------

function cardColor(card) {
    return RED.has(card.suit) ? 'red' : 'black';
}

function rankLabel(rank) {
    return { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[rank] || String(rank);
}

// Deal a fully deterministic board using the well-known Microsoft FreeCell
// linear-congruential shuffle, keyed by a game number.
function dealGame(seed) {
    clearInterval(clockId);
    gameNo = seed;
    tableau = [[], [], [], [], [], [], [], []];
    free = [null, null, null, null];
    found = { C: 0, D: 0, H: 0, S: 0 };
    moves = 0;
    selection = null;
    state = 'running';

    let st = seed >>> 0;
    const rnd = () => {
        st = (Math.imul(st, 214013) + 2531011) >>> 0;
        return (st >>> 16) & 0x7fff;
    };

    const deck = Array.from({ length: 52 }, (_, i) => i);
    const dealt = [];
    let n = 52;
    for (let i = 0; i < 52; i++) {
        const j = rnd() % n;
        dealt.push(deck[j]);
        deck[j] = deck[n - 1];
        n--;
    }
    for (let i = 0; i < 52; i++) {
        const code = dealt[i];
        tableau[i % 8].push({ rank: Math.floor(code / 4) + 1, suit: SUITS[code % 4] });
    }

    startTime = performance.now();
    clockId = setInterval(updateClock, 500);
    overlay.classList.remove('visible');
    updateHud();
    updateClock();
    render();
}

function newGame() {
    dealGame(Math.floor(Math.random() * 1_000_000) + 1);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function topOf(col) {
    return col.length ? col[col.length - 1] : null;
}

// A foundation accepts the next rank up for the card's suit (Ace first).
function foundationAccepts(card) {
    return found[card.suit] === card.rank - 1;
}

// A tableau column accepts a card if empty, or if its top card is one rank
// higher and the opposite colour.
function tableauAccepts(card, col) {
    const t = topOf(tableau[col]);
    if (!t) return true;
    return cardColor(card) !== cardColor(t) && card.rank === t.rank - 1;
}

// Is a stack of cards (top-of-run first) a valid descending, alternating run?
function isSequence(cards) {
    for (let i = 1; i < cards.length; i++) {
        if (cards[i].rank !== cards[i - 1].rank - 1) return false;
        if (cardColor(cards[i]) === cardColor(cards[i - 1])) return false;
    }
    return true;
}

function freeCount() {
    return free.filter(f => f === null).length;
}

function emptyColCount() {
    return tableau.filter(c => c.length === 0).length;
}

// How many cards can move in one supermove. Moving onto an empty column means
// that column can't be used as intermediate space, so it isn't counted.
function maxMove(toEmpty) {
    const empties = emptyColCount() - (toEmpty ? 1 : 0);
    return (freeCount() + 1) * Math.pow(2, Math.max(0, empties));
}

// ---------------------------------------------------------------------------
// Moves — each returns true on success and counts as one move.
// ---------------------------------------------------------------------------

function afterMove() {
    moves++;
    updateHud();
    render();
    maybeWin();
}

function moveTableauToFree(col) {
    if (tableau[col].length === 0) return false;
    const idx = free.indexOf(null);
    if (idx === -1) return false;
    free[idx] = tableau[col].pop();
    afterMove();
    return true;
}

function moveFreeToTableau(i, col) {
    const card = free[i];
    if (!card || !tableauAccepts(card, col)) return false;
    tableau[col].push(card);
    free[i] = null;
    afterMove();
    return true;
}

function moveTableauToFoundation(col) {
    const card = topOf(tableau[col]);
    if (!card || !foundationAccepts(card)) return false;
    found[card.suit] = card.rank;
    tableau[col].pop();
    afterMove();
    return true;
}

function moveFreeToFoundation(i) {
    const card = free[i];
    if (!card || !foundationAccepts(card)) return false;
    found[card.suit] = card.rank;
    free[i] = null;
    afterMove();
    return true;
}

function moveTableauToTableau(from, to, count) {
    const col = tableau[from];
    if (count < 1 || count > col.length) return false;
    const run = col.slice(col.length - count);
    if (!isSequence(run)) return false;
    const toEmpty = tableau[to].length === 0;
    if (count > maxMove(toEmpty)) return false;
    if (!tableauAccepts(run[0], to)) return false;
    tableau[from] = col.slice(0, col.length - count);
    for (const c of run) tableau[to].push(c);
    afterMove();
    return true;
}

// A card is safe to auto-play home if it can never be needed to hold a lower,
// opposite-coloured card — i.e. both opposite-colour foundations are high
// enough. Aces and twos are always safe.
function safeToCollect(card) {
    if (card.rank <= 2) return true;
    const opp = cardColor(card) === 'red' ? ['C', 'S'] : ['H', 'D'];
    return found[opp[0]] >= card.rank - 1 && found[opp[1]] >= card.rank - 1;
}

// Sweep every card that can safely go to a foundation. Returns the count moved.
function autoCollect() {
    let moved = 0, changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i < 4; i++) {
            const c = free[i];
            if (c && foundationAccepts(c) && safeToCollect(c)) {
                moveFreeToFoundation(i); moved++; changed = true;
            }
        }
        for (let col = 0; col < 8; col++) {
            const c = topOf(tableau[col]);
            if (c && foundationAccepts(c) && safeToCollect(c)) {
                moveTableauToFoundation(col); moved++; changed = true;
            }
        }
    }
    return moved;
}

function isWon() {
    return found.C === 13 && found.D === 13 && found.H === 13 && found.S === 13;
}

function maybeWin() {
    if (state !== 'won' && isWon()) winGame();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function winGame() {
    state = 'won';
    clearInterval(clockId);
    if (best === null || moves < best) {
        best = moves;
        localStorage.setItem('freecell-best', best);
    }
    updateHud();
    showOverlay('You Win!', `${moves} moves`, 'Click New Game to play again', 'New Game');
}

function showOverlay(title, scoreText, sub, btn) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = btn;
    overlay.classList.add('visible');
}

function updateHud() {
    movesEl.textContent = moves;
    bestEl.textContent = best === null ? '—' : best;
}

function updateClock() {
    if (state !== 'running') return;
    const s = Math.floor((performance.now() - startTime) / 1000);
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawSlot(x, y, label) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, CARD_W, CARD_H, 8);
    ctx.stroke();
    if (label) {
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.font = '28px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + CARD_W / 2, y + CARD_H / 2);
    }
    ctx.restore();
}

function drawCard(x, y, card, highlighted) {
    ctx.save();
    ctx.fillStyle = '#f7f7f2';
    ctx.strokeStyle = highlighted ? '#facc15' : 'rgba(0,0,0,0.45)';
    ctx.lineWidth = highlighted ? 3 : 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1, 8);
    ctx.fill();
    ctx.stroke();

    const color = cardColor(card) === 'red' ? '#c81e1e' : '#1a1a1a';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 18px "Segoe UI", sans-serif';
    ctx.fillText(rankLabel(card.rank), x + 6, y + 5);
    ctx.font = '16px "Segoe UI", sans-serif';
    ctx.fillText(SUIT_SYMBOL[card.suit], x + 6, y + 24);

    // large centre pip
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '34px "Segoe UI", sans-serif';
    ctx.fillText(SUIT_SYMBOL[card.suit], x + CARD_W / 2, y + CARD_H / 2 + 4);
    ctx.restore();
}

function selectionHas(zone, key, k) {
    if (!selection || selection.zone !== zone) return false;
    if (zone === 'f') return selection.i === key;
    return selection.col === key && k >= tableau[key].length - selection.count;
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!tableau) return;

    // free cells
    for (let i = 0; i < 4; i++) {
        drawSlot(FREE_X[i], TOP_Y);
        if (free[i]) drawCard(FREE_X[i], TOP_Y, free[i], selectionHas('f', i));
    }
    // foundations
    for (let i = 0; i < 4; i++) {
        const suit = SUITS[i];
        drawSlot(FOUND_X[i], TOP_Y, SUIT_SYMBOL[suit]);
        if (found[suit] > 0) drawCard(FOUND_X[i], TOP_Y, { rank: found[suit], suit }, false);
    }
    // tableau
    for (let col = 0; col < 8; col++) {
        const cards = tableau[col];
        if (cards.length === 0) {
            drawSlot(COL_X[col], TABLEAU_Y);
            continue;
        }
        for (let k = 0; k < cards.length; k++) {
            drawCard(COL_X[col], TABLEAU_Y + k * FAN, cards[k], selectionHas('t', col, k));
        }
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function hitTest(x, y) {
    // free cells & foundations share the top row
    if (y >= TOP_Y && y <= TOP_Y + CARD_H) {
        for (let i = 0; i < 4; i++)
            if (x >= FREE_X[i] && x <= FREE_X[i] + CARD_W) return { zone: 'f', i };
        for (let i = 0; i < 4; i++)
            if (x >= FOUND_X[i] && x <= FOUND_X[i] + CARD_W) return { zone: 'o', i };
    }
    // tableau
    for (let col = 0; col < 8; col++) {
        if (x < COL_X[col] || x > COL_X[col] + CARD_W) continue;
        const cards = tableau[col];
        if (cards.length === 0) {
            if (y >= TABLEAU_Y && y <= TABLEAU_Y + CARD_H) return { zone: 't', col, k: 0 };
            return null;
        }
        for (let k = cards.length - 1; k >= 0; k--) {
            const cy = TABLEAU_Y + k * FAN;
            const h = k === cards.length - 1 ? CARD_H : FAN;
            if (y >= cy && y <= cy + h) return { zone: 't', col, k };
        }
    }
    return null;
}

function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - r.left) * (canvas.width / r.width),
        y: (e.clientY - r.top) * (canvas.height / r.height),
    };
}

function handleClick(x, y) {
    if (state !== 'running') return;
    const hit = hitTest(x, y);
    if (!hit) { selection = null; render(); return; }

    if (!selection) {
        if (hit.zone === 't') {
            const cards = tableau[hit.col];
            if (cards.length === 0) return;
            const run = cards.slice(hit.k);
            if (isSequence(run)) selection = { zone: 't', col: hit.col, count: run.length };
        } else if (hit.zone === 'f') {
            if (free[hit.i]) selection = { zone: 'f', i: hit.i, count: 1 };
        }
        render();
        return;
    }

    const src = selection;
    selection = null;
    if (hit.zone === 't') {
        if (src.zone === 't') moveTableauToTableau(src.col, hit.col, src.count);
        else moveFreeToTableau(src.i, hit.col);
    } else if (hit.zone === 'o') {
        if (src.zone === 't' && src.count === 1) moveTableauToFoundation(src.col);
        else if (src.zone === 'f') moveFreeToFoundation(src.i);
    } else if (hit.zone === 'f') {
        if (src.zone === 't' && src.count === 1) moveTableauToFree(src.col);
    }
    render();
}

function handleDoubleClick(x, y) {
    if (state !== 'running') return;
    const hit = hitTest(x, y);
    if (!hit) return;
    selection = null;
    if (hit.zone === 't') moveTableauToFoundation(hit.col);
    else if (hit.zone === 'f') moveFreeToFoundation(hit.i);
    render();
}

canvas.addEventListener('click', e => {
    const { x, y } = canvasPos(e);
    handleClick(x, y);
});

canvas.addEventListener('dblclick', e => {
    const { x, y } = canvasPos(e);
    handleDoubleClick(x, y);
});

document.addEventListener('keydown', e => {
    if (state !== 'running') { newGame(); e.preventDefault(); return; }
    if (e.key === 'a' || e.key === 'A') autoCollect();
});

btnStart.addEventListener('click', newGame);
btnNew.addEventListener('click', newGame);
btnAuto.addEventListener('click', () => { if (state === 'running') autoCollect(); });

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

const storedBest = localStorage.getItem('freecell-best');
best = storedBest === null ? null : parseInt(storedBest, 10);
tableau = [[], [], [], [], [], [], [], []];
free = [null, null, null, null];
found = { C: 0, D: 0, H: 0, S: 0 };
moves = 0;
selection = null;
state = 'idle';
updateHud();
render();
