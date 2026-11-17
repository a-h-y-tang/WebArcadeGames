// ---------------------------------------------------------------------------
// Hearts — four-handed, against three computer players.
// ---------------------------------------------------------------------------
// The rules are pure functions over plain data; rendering and input sit on top
// and hold no rules of their own, so the Playwright suite can install an exact
// deal and drive it without touching pixels.
//
// card    = { rank: 2..14, suit: 'S' | 'H' | 'D' | 'C' }   (14 is the ace)
// players = 0 South (you), 1 West, 2 North, 3 East — clockwise, so "left" is +1
// ---------------------------------------------------------------------------

const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK_LABEL = { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SEATS = ['You', 'West', 'North', 'East'];
const TARGET_SCORE = 100;

const CARD_W = 62;
const CARD_H = 88;
const HAND_SPACING = 46;
const BACK_W = 40;
const BACK_H = 58;
const PLAY_DELAY = 520;
const TRICK_PAUSE = 950;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnPass = document.getElementById('btn-pass');
const statusEl = document.getElementById('status');
const scoreEls = [0, 1, 2, 3].map((i) => document.getElementById(`score-${i}`));
const playerEls = [0, 1, 2, 3].map((i) => document.getElementById(`player-${i}`));

// --- State ---
let hands = [[], [], [], []];
let taken = [[], [], [], []];
let scores = [0, 0, 0, 0];
let trick = []; // [{ player, card }] in the order played
let turn = 0;
let leader = 0;
let trickNumber = 0; // 1 is the first trick of the hand
let handNumber = 0; // 0-based; decides the passing direction
let heartsBroken = false;
let state = 'ready'; // ready | passing | playing | handover | over
let selectedCards = []; // card codes chosen for the pass
let lastTrickWinner = null;
let aiEnabled = true;
let timers = [];

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function makeCard(rank, suit) {
    return { rank, suit };
}

function cardName(card) {
    return (RANK_LABEL[card.rank] || String(card.rank)) + card.suit;
}

function parseCard(code) {
    const label = code[0];
    const rank = Number(label) || Number(Object.keys(RANK_LABEL).find((r) => RANK_LABEL[r] === label));
    return { rank, suit: code[1] };
}

function sameCard(a, b) {
    return a && b && a.rank === b.rank && a.suit === b.suit;
}

function newDeck() {
    const deck = [];
    for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) deck.push(makeCard(rank, suit));
    return deck;
}

function shuffle(cards) {
    const out = cards.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function deal(deck) {
    const out = [[], [], [], []];
    deck.forEach((card, i) => out[i % 4].push(card));
    return out;
}

function pointsOf(card) {
    if (card.suit === 'H') return 1;
    if (card.suit === 'S' && card.rank === 12) return 13;
    return 0;
}

function handPoints(cards) {
    return cards.reduce((total, card) => total + pointsOf(card), 0);
}

// Sorted for display: suit blocks, low to high inside each.
function sortHand(cards) {
    return cards.slice().sort((a, b) => {
        if (a.suit !== b.suit) return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
        return a.rank - b.rank;
    });
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

function passDirection(hand) {
    return ['left', 'right', 'across', 'none'][hand % 4];
}

function passOffset(direction) {
    return { left: 1, right: 3, across: 2, none: 0 }[direction];
}

function hasOnly(cards, predicate) {
    return cards.length > 0 && cards.every(predicate);
}

// Which cards may this player legally play right now?
function legalPlays(player) {
    const hand = hands[player];
    if (!hand || !hand.length || player !== turn) return [];

    const leading = trick.length === 0;
    const first = trickNumber === 1;

    if (first && leading) {
        const two = hand.find((c) => c.suit === 'C' && c.rank === 2);
        return two ? [two] : [];
    }

    if (leading) {
        if (heartsBroken || hasOnly(hand, (c) => c.suit === 'H')) return hand.slice();
        const nonHearts = hand.filter((c) => c.suit !== 'H');
        return nonHearts.length ? nonHearts : hand.slice();
    }

    const led = trick[0].card.suit;
    const following = hand.filter((c) => c.suit === led);
    if (following.length) {
        // On the first trick the queen of spades is still barred, unless it is
        // all that is left of the suit led.
        if (first) {
            const safe = following.filter((c) => pointsOf(c) === 0);
            if (safe.length) return safe;
        }
        return following;
    }

    if (first) {
        const safe = hand.filter((c) => pointsOf(c) === 0);
        if (safe.length) return safe;
    }
    return hand.slice();
}

function trickWinner(cards) {
    const led = cards[0].card.suit;
    let best = cards[0];
    for (const play of cards) {
        if (play.card.suit === led && play.card.rank > best.card.rank) best = play;
    }
    return best.player;
}

// The four hand scores, moon included.
function scoreHand(takenCards) {
    const points = takenCards.map(handPoints);
    const total = points.reduce((a, b) => a + b, 0);
    const shooter = points.findIndex((p) => p === 26);
    if (total === 26 && shooter >= 0) return points.map((_, i) => (i === shooter ? 0 : 26));
    return points;
}

function winners() {
    const best = Math.min(...scores);
    return scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
}

// Play a card. Returns false (and changes nothing) if the move is not legal.
function playCard(player, card) {
    if (state !== 'playing' || player !== turn || !card) return false;
    if (!legalPlays(player).some((c) => sameCard(c, card))) return false;

    hands[player] = hands[player].filter((c) => !sameCard(c, card));
    trick.push({ player, card });
    if (card.suit === 'H') heartsBroken = true;

    if (trick.length === 4) {
        // The trick is resolved at once: the rules never wait on a timer. The
        // pause that lets a human see the cards is a rendering and input hold,
        // not a state of the game.
        const winner = trickWinner(trick);
        taken[winner].push(...trick.map((t) => t.card));
        lastTrick = { winner, plays: trick.slice(), shownAt: Date.now() };
        lastTrickWinner = winner;
        trick = [];
        turn = winner;
        leader = winner;
        if (hands.flat().length === 0) {
            finishHand();
            return true;
        }
        trickNumber++;
        scheduleAi(PLAY_DELAY + TRICK_PAUSE);
    } else {
        turn = (player + 1) % 4;
        scheduleAi();
    }
    updateHud();
    return true;
}

// The last completed trick, kept on the table for a moment.
let lastTrick = null;

// True while the finished trick is still being shown.
function holdingTrick() {
    return !!lastTrick && Date.now() - lastTrick.shownAt < TRICK_PAUSE;
}

function finishHand(handScores = scoreHand(taken)) {
    const moon = handScores.filter((s) => s === 26).length === 3;
    scores = scores.map((s, i) => s + handScores[i]);
    handNumber++;
    trick = [];
    lastTrick = null;
    clearTimers();

    if (Math.max(...scores) >= TARGET_SCORE) {
        state = 'over';
        const names = winners().map((i) => SEATS[i]);
        showOverlay(
            names.length === 1 && names[0] === 'You' ? 'You win!' : `${names.join(' and ')} win`,
            `${scoreLine()}\nPress R for a new game.`
        );
    } else {
        state = 'handover';
        const summary = handScores
            .map((s, i) => `${SEATS[i]} ${s >= 0 ? '+' : ''}${s}`)
            .join('   ');
        showOverlay(moon ? 'Shot the moon!' : 'Hand over', `${summary}\n\n${scoreLine()}`, 'Next hand');
    }
    updateHud();
}

function scoreLine() {
    return scores.map((s, i) => `${SEATS[i]} ${s}`).join('   ');
}

// ---------------------------------------------------------------------------
// Dealing, passing and the run of play
// ---------------------------------------------------------------------------

function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers = [];
}

function later(fn, ms) {
    const id = setTimeout(() => {
        timers = timers.filter((t) => t !== id);
        fn();
    }, ms);
    timers.push(id);
    return id;
}

function startGame() {
    clearTimers();
    scores = [0, 0, 0, 0];
    handNumber = 0;
    state = 'ready';
    newHand();
}

function newHand(options = {}) {
    clearTimers();
    hands = deal(shuffle(newDeck())).map(sortHand);
    taken = [[], [], [], []];
    trick = [];
    lastTrick = null;
    selectedCards = [];
    heartsBroken = false;
    trickNumber = 1;
    lastTrickWinner = null;
    hideOverlay();

    if (!options.skipPass && passDirection(handNumber) !== 'none') {
        state = 'passing';
        updateHud();
        return;
    }
    beginPlay();
}

// The holder of the two of clubs leads.
function beginPlay() {
    state = 'playing';
    hands = hands.map(sortHand);
    const starter = hands.findIndex((hand) => hand.some((c) => c.suit === 'C' && c.rank === 2));
    turn = starter >= 0 ? starter : 0;
    leader = turn;
    trickNumber = 1;
    updateHud();
    scheduleAi();
}

// `chosen` is four arrays of card codes, one per player.
function completePass(chosen) {
    const direction = passDirection(handNumber);
    const offset = passOffset(direction);
    const outgoing = chosen.map((codes, player) =>
        codes.map((code) => hands[player].find((c) => cardName(c) === code)).filter(Boolean)
    );
    for (let player = 0; player < 4; player++) {
        hands[player] = hands[player].filter(
            (card) => !outgoing[player].some((c) => sameCard(c, card))
        );
    }
    for (let player = 0; player < 4; player++) {
        hands[(player + offset) % 4].push(...outgoing[player]);
    }
    hands = hands.map(sortHand);
    selectedCards = [];
    beginPlay();
}

// The player has chosen three cards; the computer players choose theirs.
function confirmPass() {
    if (state !== 'passing' || selectedCards.length !== 3) return;
    const chosen = [
        selectedCards.slice(),
        ...[1, 2, 3].map((p) => aiChoosePass(p).map(cardName)),
    ];
    completePass(chosen);
}

function scheduleAi(delay = PLAY_DELAY) {
    if (!aiEnabled || state !== 'playing' || turn === 0) return;
    later(() => {
        if (state !== 'playing' || turn === 0) return;
        const card = aiChoosePlay(turn);
        if (card) playCard(turn, card);
    }, delay);
}

// Deal exact hands — used by the tests and for debugging.
function setupHands(codes, options = {}) {
    clearTimers();
    hands = codes.map((list) => sortHand(list.map(parseCard)));
    taken = [[], [], [], []];
    trick = [];
    lastTrick = null;
    selectedCards = [];
    heartsBroken = options.heartsBroken || false;
    handNumber = options.handNumber ?? handNumber;
    trickNumber = options.trickNumber ?? 1;
    lastTrickWinner = null;
    hideOverlay();

    if (options.phase === 'passing' && passDirection(handNumber) !== 'none') {
        state = 'passing';
        updateHud();
        return;
    }

    state = 'playing';
    if (options.leader !== undefined) {
        turn = options.leader;
        leader = options.leader;
    } else {
        const starter = hands.findIndex((hand) => hand.some((c) => c.suit === 'C' && c.rank === 2));
        turn = starter >= 0 ? starter : 0;
        leader = turn;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// The computer players
// ---------------------------------------------------------------------------

function cardsOfSuit(hand, suit) {
    return hand.filter((c) => c.suit === suit);
}

function highest(cards) {
    return cards.reduce((best, c) => (c.rank > best.rank ? c : best), cards[0]);
}

function lowest(cards) {
    return cards.reduce((best, c) => (c.rank < best.rank ? c : best), cards[0]);
}

function isQueenOfSpades(card) {
    return card.suit === 'S' && card.rank === 12;
}

// Pass the queen if she is thinly guarded, then the high spades, then the
// highest cards from the shortest non-heart suit.
function aiChoosePass(player) {
    const hand = hands[player].slice();
    const spades = cardsOfSuit(hand, 'S');
    const chosen = [];

    const take = (card) => {
        if (!card || chosen.length >= 3 || chosen.some((c) => sameCard(c, card))) return;
        chosen.push(card);
    };

    const queen = spades.find(isQueenOfSpades);
    if (queen && spades.length < 4) take(queen);
    for (const rank of [14, 13]) {
        const big = spades.find((c) => c.rank === rank);
        if (big && chosen.length < 3) take(big);
    }

    const rest = hand
        .filter((c) => !chosen.some((x) => sameCard(x, c)))
        .sort((a, b) => {
            const suitSize = (card) => cardsOfSuit(hand, card.suit).length;
            if (b.rank !== a.rank) return b.rank - a.rank;
            return suitSize(a) - suitSize(b);
        });
    for (const card of rest) take(card);
    return chosen.slice(0, 3);
}

function aiChoosePlay(player) {
    const options = legalPlays(player);
    if (!options.length) return null;
    if (options.length === 1) return options[0];

    const leading = trick.length === 0;
    if (leading) {
        // Get out of the lead cheaply, and keep off spades while the queen is
        // still about and we hold something she could catch.
        const queenGone =
            taken.flat().some(isQueenOfSpades) || trick.some((t) => isQueenOfSpades(t.card));
        const risky = (card) =>
            card.suit === 'S' && !queenGone && card.rank > 12;
        const safe = options.filter((c) => !risky(c) && c.suit !== 'H');
        const pool = safe.length ? safe : options;
        const bySuitSize = (card) => cardsOfSuit(hands[player], card.suit).length;
        return pool
            .slice()
            .sort((a, b) => a.rank - b.rank || bySuitSize(a) - bySuitSize(b))[0];
    }

    const led = trick[0].card.suit;
    const following = options.filter((c) => c.suit === led);

    if (following.length) {
        const highestSoFar = Math.max(
            ...trick.filter((t) => t.card.suit === led).map((t) => t.card.rank)
        );
        const under = following.filter((c) => c.rank < highestSoFar);
        // Shed the biggest card that still loses the trick.
        if (under.length) return highest(under);
        // Forced to win it: do so as cheaply as possible.
        return lowest(following);
    }

    // Void in the suit led: throw the most dangerous card away.
    const queen = options.find(isQueenOfSpades);
    if (queen) return queen;
    const bigSpade = options.filter((c) => c.suit === 'S' && c.rank > 12);
    if (bigSpade.length) return highest(bigSpade);
    const hearts = options.filter((c) => c.suit === 'H');
    if (hearts.length) return highest(hearts);
    return highest(options);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

// Where each of your cards sits on the canvas.
function handLayout() {
    const hand = hands[0] || [];
    const width = hand.length ? (hand.length - 1) * HAND_SPACING + CARD_W : 0;
    const left = (canvas.width - width) / 2;
    const top = canvas.height - CARD_H - 18;
    return hand.map((card, i) => ({
        card,
        x: left + i * HAND_SPACING,
        y: top - (selectedCards.includes(cardName(card)) ? 16 : 0),
    }));
}

function handCardCentre(code) {
    const spot = handLayout().find((entry) => cardName(entry.card) === code);
    if (!spot) return null;
    // Overlapped cards only show their left edge; click there, except the last.
    const isLast = cardName(handLayout()[handLayout().length - 1].card) === code;
    return {
        x: spot.x + (isLast ? CARD_W / 2 : HAND_SPACING / 2),
        y: spot.y + CARD_H / 2,
    };
}

function cardAt(x, y) {
    const layout = handLayout();
    for (let i = layout.length - 1; i >= 0; i--) {
        const { card, x: cx, y: cy } = layout[i];
        const width = i === layout.length - 1 ? CARD_W : HAND_SPACING;
        if (x >= cx && x <= cx + width && y >= cy && y <= cy + CARD_H) return card;
    }
    return null;
}

function toggleSelected(card) {
    const code = cardName(card);
    const at = selectedCards.indexOf(code);
    if (at >= 0) selectedCards.splice(at, 1);
    else if (selectedCards.length < 3) selectedCards.push(code);
    updateHud();
}

function clickCanvas(x, y) {
    const card = cardAt(x, y);
    if (!card) return;
    if (state === 'passing') {
        toggleSelected(card);
        return;
    }
    if (state === 'playing' && turn === 0 && !holdingTrick()) playCard(0, card);
}

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    clickCanvas(x, y);
});

btnStart.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state === 'handover') newHand();
    else startGame();
});

btnPass.addEventListener('click', (e) => {
    e.stopPropagation();
    confirmPass();
});

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'r') {
        e.preventDefault();
        startGame();
    } else if (e.key === ' ') {
        e.preventDefault();
        if (state === 'ready' || state === 'over') startGame();
        else if (state === 'handover') newHand();
        else if (state === 'passing') confirmPass();
    }
});

// ---------------------------------------------------------------------------
// HUD and overlays
// ---------------------------------------------------------------------------

function showOverlay(title, sub, buttonLabel = 'Start Game') {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    btnStart.textContent = buttonLabel;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function statusText() {
    if (state === 'ready') return 'Press Start';
    if (state === 'over') return `Final: ${scoreLine()}`;
    if (state === 'handover') return 'Hand over';
    if (state === 'passing') {
        const direction = passDirection(handNumber);
        const left = 3 - selectedCards.length;
        return left > 0
            ? `Pass ${direction} — choose ${left} more card${left === 1 ? '' : 's'}`
            : `Pass ${direction} — press Pass`;
    }
    if (turn !== 0) return `${SEATS[turn]} is thinking…`;
    if (trick.length === 0) return trickNumber === 1 ? 'Your lead — play the two of clubs' : 'Your lead';
    return `Your turn — follow ${SUIT_GLYPH[trick[0].card.suit]} if you can`;
}

function updateHud() {
    statusEl.textContent = statusText();
    scores.forEach((score, i) => {
        scoreEls[i].textContent = String(score);
        playerEls[i].classList.toggle('turn', state === 'playing' && turn === i);
    });
    btnPass.disabled = !(state === 'passing' && selectedCards.length === 3);
    btnPass.style.display = state === 'passing' ? '' : 'none';
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

function drawCardBack(x, y, w = BACK_W, h = BACK_H) {
    roundRect(x, y, w, h, 6);
    ctx.fillStyle = '#7d2b3a';
    ctx.fill();
    ctx.strokeStyle = '#d6a0a8';
    ctx.lineWidth = 1.5;
    roundRect(x + 4, y + 4, w - 8, h - 8, 4);
    ctx.stroke();
}

function drawCardFace(x, y, card, options = {}) {
    roundRect(x, y, CARD_W, CARD_H, 8);
    ctx.fillStyle = options.dim ? '#d8d8d2' : '#fbfbf7';
    ctx.fill();
    ctx.strokeStyle = options.highlight ? '#ffd479' : '#c8c8bf';
    ctx.lineWidth = options.highlight ? 3 : 1.5;
    ctx.stroke();

    const red = card.suit === 'H' || card.suit === 'D';
    ctx.fillStyle = options.dim ? '#8a8a84' : red ? '#c62828' : '#1a1a1a';
    const label = RANK_LABEL[card.rank] || String(card.rank);
    const glyph = SUIT_GLYPH[card.suit];

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 19px Arial, sans-serif';
    ctx.fillText(label, x + 6, y + 6);
    ctx.font = '16px serif';
    ctx.fillText(glyph, x + 6, y + 26);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '38px serif';
    ctx.fillText(glyph, x + CARD_W / 2, y + CARD_H / 2 + 6);
}

const TRICK_SPOTS = () => ({
    0: { x: canvas.width / 2 - CARD_W / 2, y: canvas.height / 2 + 26 },
    1: { x: canvas.width / 2 - CARD_W - 50, y: canvas.height / 2 - CARD_H / 2 },
    2: { x: canvas.width / 2 - CARD_W / 2, y: canvas.height / 2 - CARD_H - 26 },
    3: { x: canvas.width / 2 + 50, y: canvas.height / 2 - CARD_H / 2 },
});

function trickLabel(player) {
    const n = taken[player].length / 4;
    return `${SEATS[player]} — ${n} trick${n === 1 ? '' : 's'}`;
}

function drawSeatLabel(text, x, y, active, align = 'center') {
    ctx.font = active ? 'bold 15px system-ui, sans-serif' : '15px system-ui, sans-serif';
    ctx.fillStyle = active ? '#ffd479' : 'rgba(233, 240, 234, 0.75)';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
}

function drawOpponent(player) {
    const count = hands[player].length;
    const active = state === 'playing' && turn === player;
    if (player === 2) {
        const spacing = 22;
        const width = Math.max(0, (count - 1) * spacing + BACK_W);
        const left = (canvas.width - width) / 2;
        for (let i = 0; i < count; i++) drawCardBack(left + i * spacing, 16);
        drawSeatLabel(trickLabel(2), canvas.width / 2, 16 + BACK_H + 16, active);
    } else {
        const spacing = 20;
        const height = Math.max(0, (count - 1) * spacing + BACK_H);
        const top = (canvas.height - height) / 2 - 40;
        const x = player === 1 ? 18 : canvas.width - 18 - BACK_W;
        for (let i = 0; i < count; i++) drawCardBack(x, top + i * spacing);
        drawSeatLabel(
            trickLabel(player),
            player === 1 ? 18 : canvas.width - 18,
            top + height + 18,
            active,
            player === 1 ? 'left' : 'right'
        );
    }
}

function render() {
    ctx.fillStyle = '#15402f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Table felt.
    ctx.save();
    const grad = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 40,
        canvas.width / 2, canvas.height / 2, canvas.width / 1.5
    );
    grad.addColorStop(0, '#1d5540');
    grad.addColorStop(1, '#10301f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    if (state !== 'ready') {
        for (const player of [1, 2, 3]) drawOpponent(player);

        const spots = TRICK_SPOTS();
        const onTable = trick.length === 0 && holdingTrick() ? lastTrick.plays : trick;
        for (const { player, card } of onTable) {
            const spot = spots[player];
            drawCardFace(spot.x, spot.y, card, {
                highlight: onTable === lastTrick?.plays && player === lastTrick.winner,
            });
        }

        // Your hand.
        // Cards only grey out when it is your turn and they cannot be played.
        const choosing = state === 'playing' && turn === 0 && !holdingTrick();
        const legal = choosing ? legalPlays(0) : [];
        for (const { card, x, y } of handLayout()) {
            drawCardFace(x, y, card, {
                highlight: selectedCards.includes(cardName(card)),
                dim: choosing && !legal.some((c) => sameCard(c, card)),
            });
        }

        drawSeatLabel(
            trickLabel(0),
            canvas.width / 2,
            canvas.height - CARD_H - 36,
            state === 'playing' && turn === 0
        );

        if (!heartsBroken && state === 'playing') {
            ctx.font = '13px system-ui, sans-serif';
            ctx.fillStyle = 'rgba(233, 240, 234, 0.5)';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText('hearts not broken', canvas.width - 16, canvas.height - 24);
        }
    }

    requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
    hands = [[], [], [], []];
    state = 'ready';
    updateHud();
    showOverlay(
        'Hearts',
        'Take as few hearts as you can. The queen of spades costs thirteen.'
    );
    requestAnimationFrame(render);
}

init();
