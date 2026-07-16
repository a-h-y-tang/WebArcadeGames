// ---------------------------------------------------------------------------
// Video Poker (Jacks or Better) — a single-hand draw-poker machine.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Snake,
// Tetris and Dino Run in this repo. The heart of the game — `evaluateHand` — is
// a pure, deterministic function, and the round flow (`deal` / `draw`) reads and
// writes plain globals (`hand`, `held`, `deck`, `credits`, `bet`), so the tests
// drive everything with no randomness or wall-clock timing.
// ---------------------------------------------------------------------------

// --- Layout ---
const CANVAS_W = 640;
const CANVAS_H = 420;
const CARD_W = 96;
const CARD_H = 140;
const CARD_GAP = 20;
const CARD_Y = 96;
const CARDS_X = (CANVAS_W - (5 * CARD_W + 4 * CARD_GAP)) / 2;

const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣']; // ♠ ♥ ♦ ♣
const SUIT_RED = [false, true, true, false];                   // hearts & diamonds are red
const RANK_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

// --- Pay table (credits paid per coin bet) ---
const PAYTABLE = {
    'Royal Flush': 250,
    'Straight Flush': 50,
    'Four of a Kind': 25,
    'Full House': 9,
    'Flush': 6,
    'Straight': 4,
    'Three of a Kind': 3,
    'Two Pair': 2,
    'Jacks or Better': 1,
    'No Win': 0,
};
const PAYTABLE_ORDER = [
    'Royal Flush', 'Straight Flush', 'Four of a Kind', 'Full House',
    'Flush', 'Straight', 'Three of a Kind', 'Two Pair', 'Jacks or Better',
];

const START_CREDITS = 100;
const MAX_BET = 5;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const creditsEl = document.getElementById('credits');
const betEl = document.getElementById('bet');
const bestEl = document.getElementById('best');
const resultEl = document.getElementById('result');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'holding' | 'result' | 'over'
let state = 'idle';
let credits = START_CREDITS;
let bet = 1;
let best = 0;
let hand = [];           // array of up to 5 { rank, suit }
let held = [];           // parallel array of booleans
let deck = [];           // remaining draw pile
let lastResult = null;   // { name, payout } from the most recent draw

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

function buildDeck() {
    const d = [];
    for (let r = 2; r <= 14; r++) {
        for (let s = 0; s < 4; s++) d.push({ rank: r, suit: s });
    }
    return d;
}

function shuffle(d) {
    for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = d[i]; d[i] = d[j]; d[j] = tmp;
    }
    return d;
}

// ---------------------------------------------------------------------------
// Hand evaluation — pure and deterministic.
// ---------------------------------------------------------------------------

function evaluateHand(cards) {
    const suits = cards.map((c) => c.suit);
    const isFlush = suits.every((s) => s === suits[0]);

    const counts = {};
    for (const c of cards) counts[c.rank] = (counts[c.rank] || 0) + 1;
    const uniq = Object.keys(counts).map(Number).sort((a, b) => a - b);
    const countVals = Object.values(counts).sort((a, b) => b - a);

    // Straight (5 distinct consecutive ranks, or the low-ace wheel A-2-3-4-5).
    let isStraight = false;
    let straightHigh = 0;
    if (uniq.length === 5) {
        if (uniq[4] - uniq[0] === 4) {
            isStraight = true;
            straightHigh = uniq[4];
        } else if (uniq[0] === 2 && uniq[1] === 3 && uniq[2] === 4 && uniq[3] === 5 && uniq[4] === 14) {
            isStraight = true;
            straightHigh = 5; // ace plays low
        }
    }

    let name = 'No Win';
    if (isStraight && isFlush) {
        name = straightHigh === 14 ? 'Royal Flush' : 'Straight Flush';
    } else if (countVals[0] === 4) {
        name = 'Four of a Kind';
    } else if (countVals[0] === 3 && countVals[1] === 2) {
        name = 'Full House';
    } else if (isFlush) {
        name = 'Flush';
    } else if (isStraight) {
        name = 'Straight';
    } else if (countVals[0] === 3) {
        name = 'Three of a Kind';
    } else if (countVals[0] === 2 && countVals[1] === 2) {
        name = 'Two Pair';
    } else if (countVals[0] === 2) {
        const pairRank = uniq.find((r) => counts[r] === 2);
        name = pairRank >= 11 ? 'Jacks or Better' : 'No Win';
    }

    return { name, payout: PAYTABLE[name] };
}

// ---------------------------------------------------------------------------
// Round flow
// ---------------------------------------------------------------------------

function deal() {
    if (credits < bet) {
        endGame();
        return;
    }
    credits -= bet;
    const d = shuffle(buildDeck());
    hand = d.slice(0, 5);
    deck = d.slice(5);
    held = [false, false, false, false, false];
    lastResult = null;
    state = 'holding';
    setResult('Hold cards, then Draw');
    hideOverlay();
    syncHud();
}

function draw() {
    if (state !== 'holding') return;
    for (let i = 0; i < 5; i++) {
        if (!held[i]) hand[i] = deck.pop();
    }
    const res = evaluateHand(hand);
    lastResult = res;
    const win = res.payout * bet;
    if (win > 0) credits += win;
    if (credits > best) {
        best = credits;
        localStorage.setItem('videopoker-best', String(best));
    }
    state = 'result';
    setResult(win > 0 ? `${res.name} — WIN ${win}` : 'No win — deal again');
    syncHud();
}

function toggleHold(i) {
    if (state !== 'holding') return;
    held[i] = !held[i];
}

function raiseBet() {
    if (state === 'holding') return; // can't change the bet mid-hand
    bet = bet >= MAX_BET ? 1 : bet + 1;
    syncHud();
}

function startGame() {
    credits = START_CREDITS;
    bet = 1;
    deal();
}

function endGame() {
    state = 'over';
    setResult('Out of credits');
    showOverlay('Game Over', credits + ' credits', 'Press Space to play again', 'Play Again');
    syncHud();
}

function onPrimary() {
    if (state === 'idle' || state === 'result') deal();
    else if (state === 'holding') draw();
    else if (state === 'over') startGame();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function syncHud() {
    creditsEl.textContent = String(credits);
    betEl.textContent = String(bet);
    bestEl.textContent = String(best);
}

function setResult(text) {
    resultEl.textContent = text && text.length ? text : ' ';
}

function loadBest() {
    const v = parseInt(localStorage.getItem('videopoker-best'), 10);
    best = Number.isFinite(v) ? v : 0;
}

function showOverlay(title, scoreText, sub, btn) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = btn;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function cardX(i) {
    return CARDS_X + i * (CARD_W + CARD_GAP);
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

function drawCardFace(x, y, card) {
    roundRect(x, y, CARD_W, CARD_H, 10);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();

    const label = RANK_LABELS[card.rank] || String(card.rank);
    const symbol = SUIT_SYMBOLS[card.suit];
    ctx.fillStyle = SUIT_RED[card.suit] ? '#dc2626' : '#111827';

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(label, x + 8, y + 8);
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(symbol, x + 9, y + 32);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '52px system-ui, sans-serif';
    ctx.fillText(symbol, x + CARD_W / 2, y + CARD_H / 2 + 4);

    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(label, x + CARD_W - 8, y + CARD_H - 8);
}

function drawCardBack(x, y) {
    roundRect(x, y, CARD_W, CARD_H, 10);
    ctx.fillStyle = '#1e3a8a';
    ctx.fill();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    roundRect(x + 8, y + 8, CARD_W - 16, CARD_H - 16, 6);
    ctx.stroke();
}

function drawHeldBanner(x) {
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(x, CARD_Y - 30, CARD_W, 22);
    ctx.fillStyle = '#0d1117';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText('HELD', x + CARD_W / 2, CARD_Y - 18);
}

function drawPaytable() {
    const px = 24;
    let py = CARD_Y + CARD_H + 26;
    ctx.textBaseline = 'middle';
    ctx.font = '13px system-ui, sans-serif';
    const colW = (CANVAS_W - px * 2) / 3;
    PAYTABLE_ORDER.forEach((nm, idx) => {
        const col = Math.floor(idx / 3);
        const row = idx % 3;
        const x = px + col * colW;
        const y = py + row * 20;
        const winning = lastResult && lastResult.name === nm;
        ctx.fillStyle = winning ? '#fbbf24' : '#a7f3d0';
        ctx.textAlign = 'left';
        ctx.fillText(nm, x, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = winning ? '#fbbf24' : '#e6edf3';
        ctx.fillText(String(PAYTABLE[nm] * bet), x + colW - 24, y);
    });
}

function render() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // felt gradient
    const g = ctx.createRadialGradient(CANVAS_W / 2, CARD_Y + 40, 60, CANVAS_W / 2, CANVAS_H / 2, 420);
    g.addColorStop(0, '#15563f');
    g.addColorStop(1, '#0b3d2e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    for (let i = 0; i < 5; i++) {
        const x = cardX(i);
        if (hand[i]) {
            if (held[i]) drawHeldBanner(x);
            drawCardFace(x, CARD_Y, hand[i]);
        } else {
            drawCardBack(x, CARD_Y);
        }
    }

    drawPaytable();
}

function frame() {
    render();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
        e.preventDefault();
        onPrimary();
        return;
    }
    if (e.key === 'b' || e.key === 'B') {
        raiseBet();
        return;
    }
    if (e.key >= '1' && e.key <= '5') {
        toggleHold(parseInt(e.key, 10) - 1);
    }
});

canvas.addEventListener('click', (e) => {
    if (state !== 'holding') return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const my = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    for (let i = 0; i < 5; i++) {
        const x = cardX(i);
        if (mx >= x && mx <= x + CARD_W && my >= CARD_Y && my <= CARD_Y + CARD_H) {
            toggleHold(i);
            break;
        }
    }
});

btnStart.addEventListener('click', () => onPrimary());

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

loadBest();
syncHud();
setResult('');
requestAnimationFrame(frame);
