// ---------------------------------------------------------------------------
// Blackjack — beat the dealer's hand without going over 21.
// Dealer stands on all 17s; a natural blackjack pays 3:2. All game logic lives
// at module scope so the Playwright suite can drive it deterministically by
// setting `deck`, `playerHand`, and `dealerHand` directly.
// ---------------------------------------------------------------------------

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const RED_SUITS = new Set(['♥', '♦']);

const MIN_BET = 5;
const BET_STEP = 5;
const START_BALANCE = 100;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const balanceEl = document.getElementById('balance');
const betEl = document.getElementById('bet');
const bestEl = document.getElementById('best');
const messageEl = document.getElementById('message');
const betLabelEl = document.getElementById('bet-label');
const btnDeal = document.getElementById('btn-deal');
const btnHit = document.getElementById('btn-hit');
const btnStand = document.getElementById('btn-stand');
const btnBetUp = document.getElementById('btn-bet-up');
const btnBetDown = document.getElementById('btn-bet-down');

// --- State (module scope, poked by tests) ---
let state;          // 'betting' | 'playerTurn' | 'dealerTurn' | 'roundOver'
let balance, bet, best;
let deck, playerHand, dealerHand;
let result;         // '' | 'win' | 'lose' | 'push' | 'blackjack'
let message;
let revealDealer;   // whether the dealer's hole card is face up

// --------------------------------------------------------------------------
// Cards & hand values
// --------------------------------------------------------------------------
function shuffledDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
    for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = d[i]; d[i] = d[j]; d[j] = t;
    }
    return d;
}

function drawCard() {
    if (deck.length === 0) deck = shuffledDeck();
    return deck.pop();
}

function cardValue(rank) {
    if (rank === 'A') return 11;
    if (rank === 'K' || rank === 'Q' || rank === 'J' || rank === '10') return 10;
    return parseInt(rank, 10);
}

// Best hand total, demoting aces from 11 to 1 as needed to avoid busting.
function handValue(hand) {
    let total = 0;
    let aces = 0;
    for (const c of hand) {
        total += cardValue(c.rank);
        if (c.rank === 'A') aces++;
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
}

function isBlackjack(hand) {
    return hand.length === 2 && handValue(hand) === 21;
}

// --------------------------------------------------------------------------
// Round flow
// --------------------------------------------------------------------------
function deal() {
    if (state === 'playerTurn' || state === 'dealerTurn') return;

    if (balance < MIN_BET) balance = START_BALANCE; // friendly re-buy
    if (deck.length < 4) deck = shuffledDeck();
    bet = Math.max(MIN_BET, Math.min(bet, balance));

    playerHand = [];
    dealerHand = [];
    result = '';
    revealDealer = false;

    playerHand.push(drawCard());
    dealerHand.push(drawCard());
    playerHand.push(drawCard());
    dealerHand.push(drawCard());

    state = 'playerTurn';
    message = 'Hit or stand?';

    // Naturals end the round immediately.
    const pBJ = isBlackjack(playerHand);
    const dBJ = isBlackjack(dealerHand);
    if (pBJ || dBJ) {
        revealDealer = true;
        if (pBJ && dBJ) finishRound('push');
        else if (pBJ) finishRound('blackjack');
        else finishRound('lose');
    }

    render();
}

function hit() {
    if (state !== 'playerTurn') return;
    playerHand.push(drawCard());
    if (handValue(playerHand) > 21) {
        revealDealer = true;
        finishRound('lose'); // bust
    } else {
        message = 'Hit or stand?';
        updateUI();
    }
    render();
}

function stand() {
    if (state !== 'playerTurn') return;
    state = 'dealerTurn';
    revealDealer = true;

    // Dealer draws to a hard/soft 17 or better, then stands.
    let guard = 0;
    while (handValue(dealerHand) < 17 && guard++ < 30) {
        dealerHand.push(drawCard());
    }

    const p = handValue(playerHand);
    const d = handValue(dealerHand);
    let res;
    if (d > 21) res = 'win';
    else if (p > d) res = 'win';
    else if (p < d) res = 'lose';
    else res = 'push';

    finishRound(res);
    render();
}

function finishRound(res) {
    result = res;
    if (res === 'blackjack') balance += Math.floor(bet * 1.5);
    else if (res === 'win') balance += bet;
    else if (res === 'lose') balance -= bet;
    // push: balance unchanged

    if (balance < 0) balance = 0;
    if (balance > best) best = balance;

    state = 'roundOver';
    message = messageFor(res);
    persist();
    updateUI();
}

function messageFor(res) {
    const d = handValue(dealerHand);
    const p = handValue(playerHand);
    switch (res) {
        case 'blackjack': return `Blackjack! Pays 3:2  (+${Math.floor(bet * 1.5)})`;
        case 'win':
            if (p > 21) return 'You busted — dealer wins.'; // unreachable (win)
            if (d > 21) return `Dealer busts — you win!  (+${bet})`;
            return `You win!  (+${bet})`;
        case 'lose':
            if (p > 21) return `Bust! You lose.  (-${bet})`;
            return `Dealer wins.  (-${bet})`;
        case 'push': return 'Push — bet returned.';
        default: return '';
    }
}

// --------------------------------------------------------------------------
// Betting
// --------------------------------------------------------------------------
function betUp() {
    if (state === 'playerTurn' || state === 'dealerTurn') return;
    const cap = Math.max(MIN_BET, balance);
    bet = Math.min(bet + BET_STEP, cap);
    updateUI();
}

function betDown() {
    if (state === 'playerTurn' || state === 'dealerTurn') return;
    bet = Math.max(MIN_BET, bet - BET_STEP);
    updateUI();
}

// --------------------------------------------------------------------------
// Persistence
// --------------------------------------------------------------------------
function persist() {
    try {
        localStorage.setItem('blackjack-balance', String(balance));
        localStorage.setItem('blackjack-best', String(best));
    } catch (e) { /* ignore */ }
}

// --------------------------------------------------------------------------
// UI
// --------------------------------------------------------------------------
function updateUI() {
    balanceEl.textContent = balance;
    betEl.textContent = bet;
    bestEl.textContent = best;
    betLabelEl.textContent = bet;
    messageEl.textContent = message;

    const inPlay = state === 'playerTurn';
    const canBet = state === 'betting' || state === 'roundOver';
    btnHit.disabled = !inPlay;
    btnStand.disabled = !inPlay;
    btnDeal.disabled = !canBet;
    btnBetUp.disabled = !canBet;
    btnBetDown.disabled = !canBet;
    btnDeal.textContent = state === 'roundOver' ? 'Deal Again' : 'Deal';
}

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------
const CARD_W = 74;
const CARD_H = 104;
const CARD_GAP = 22;

function render() {
    drawTable();
    drawHand(dealerHand, 56, true);
    drawHand(playerHand, 300, false);
    drawLabels();
    if (state === 'roundOver' && result) drawResultBanner();
    updateUI();
}

function drawTable() {
    const g = ctx.createRadialGradient(canvas.width / 2, 200, 60, canvas.width / 2, 200, 460);
    g.addColorStop(0, '#166534');
    g.addColorStop(1, '#0b3d22');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Table trim arc.
    ctx.strokeStyle = '#0a2e1a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, -60, 470, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    // Center felt text.
    ctx.fillStyle = '#ffffff18';
    ctx.font = 'bold 26px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BLACKJACK PAYS 3 TO 2', canvas.width / 2, 232);
    ctx.font = '13px Segoe UI, sans-serif';
    ctx.fillText('Dealer stands on all 17s', canvas.width / 2, 254);
}

function drawHand(hand, y, isDealer) {
    if (!hand || hand.length === 0) return;
    const totalW = hand.length * CARD_W + (hand.length - 1) * CARD_GAP;
    let x = (canvas.width - totalW) / 2;
    hand.forEach((card, i) => {
        const hidden = isDealer && i === 1 && !revealDealer;
        if (hidden) drawCardBack(x, y);
        else drawCardFace(x, y, card);
        x += CARD_W + CARD_GAP;
    });
}

function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

function drawCardFace(x, y, card) {
    ctx.save();
    ctx.shadowColor = '#00000055';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#fafafa';
    roundedRect(x, y, CARD_W, CARD_H, 9);
    ctx.fill();
    ctx.restore();

    const red = RED_SUITS.has(card.suit);
    ctx.fillStyle = red ? '#d1293d' : '#1b1f2e';
    ctx.textAlign = 'left';
    ctx.font = 'bold 20px Segoe UI, sans-serif';
    ctx.fillText(card.rank, x + 8, y + 26);
    ctx.font = '18px Segoe UI, sans-serif';
    ctx.fillText(card.suit, x + 8, y + 46);

    // Big center pip.
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px Segoe UI, sans-serif';
    ctx.fillText(card.suit, x + CARD_W / 2, y + CARD_H / 2 + 14);

    // Mirrored corner.
    ctx.save();
    ctx.translate(x + CARD_W, y + CARD_H);
    ctx.rotate(Math.PI);
    ctx.textAlign = 'left';
    ctx.font = 'bold 20px Segoe UI, sans-serif';
    ctx.fillText(card.rank, 8, 26);
    ctx.font = '18px Segoe UI, sans-serif';
    ctx.fillText(card.suit, 8, 46);
    ctx.restore();
}

function drawCardBack(x, y) {
    ctx.save();
    ctx.shadowColor = '#00000055';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#7f1d1d';
    roundedRect(x, y, CARD_W, CARD_H, 9);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#b91c1c';
    roundedRect(x + 7, y + 7, CARD_W - 14, CARD_H - 14, 6);
    ctx.fill();
    ctx.strokeStyle = '#fca5a5aa';
    ctx.lineWidth = 1;
    for (let i = -CARD_H; i < CARD_W; i += 10) {
        ctx.beginPath();
        ctx.moveTo(x + 7 + Math.max(0, i), y + 7 + Math.max(0, -i));
        ctx.lineTo(x + 7 + Math.min(CARD_W - 14, i + CARD_H), y + 7 + Math.min(CARD_H - 14, CARD_H - i));
        ctx.stroke();
    }
}

function drawLabels() {
    ctx.textAlign = 'left';
    ctx.font = 'bold 14px Segoe UI, sans-serif';

    // Dealer total (hidden hole => show only up-card value with a "?").
    ctx.fillStyle = '#e8f5ee';
    let dealerText = 'DEALER';
    if (dealerHand && dealerHand.length) {
        if (revealDealer) dealerText = `DEALER  ·  ${handValue(dealerHand)}`;
        else dealerText = `DEALER  ·  ${cardValue(dealerHand[0].rank)} + ?`;
    }
    ctx.fillText(dealerText, 20, 34);

    let youText = 'YOU';
    if (playerHand && playerHand.length) youText = `YOU  ·  ${handValue(playerHand)}`;
    ctx.fillText(youText, 20, 428);
}

function drawResultBanner() {
    const colors = {
        win: '#3fb950', blackjack: '#f5d64e', push: '#8b949e', lose: '#db6d4a',
    };
    const label = {
        win: 'YOU WIN', blackjack: 'BLACKJACK', push: 'PUSH', lose: 'DEALER WINS',
    };
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000000aa';
    roundedRect(canvas.width / 2 - 150, 178, 300, 60, 12);
    ctx.fill();
    ctx.fillStyle = colors[result] || '#fff';
    ctx.font = 'bold 34px Segoe UI, sans-serif';
    ctx.fillText(label[result] || '', canvas.width / 2, 220);
    ctx.restore();
}

// --------------------------------------------------------------------------
// Input
// --------------------------------------------------------------------------
btnDeal.addEventListener('click', deal);
btnHit.addEventListener('click', hit);
btnStand.addEventListener('click', stand);
btnBetUp.addEventListener('click', betUp);
btnBetDown.addEventListener('click', betDown);

document.addEventListener('keydown', e => {
    const k = e.key;
    if (k === 'h' || k === 'H') { hit(); }
    else if (k === 's' || k === 'S') { stand(); }
    else if (k === 'd' || k === 'D' || k === 'Enter' || k === ' ') { deal(); e.preventDefault(); }
    else if (k === 'ArrowUp') { betUp(); e.preventDefault(); }
    else if (k === 'ArrowDown') { betDown(); e.preventDefault(); }
});

// --------------------------------------------------------------------------
// Init
// --------------------------------------------------------------------------
function loadNumber(key, fallback) {
    const v = parseInt(localStorage.getItem(key), 10);
    return Number.isFinite(v) ? v : fallback;
}

balance = loadNumber('blackjack-balance', START_BALANCE);
best = Math.max(loadNumber('blackjack-best', START_BALANCE), balance);
bet = Math.max(MIN_BET, Math.min(10, balance));
deck = shuffledDeck();
playerHand = [];
dealerHand = [];
result = '';
revealDealer = false;
state = 'betting';
message = 'Place your bet and deal.';

render();
