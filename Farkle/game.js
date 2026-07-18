// ---------------------------------------------------------------------------
// Farkle — the push-your-luck dice game.
//
// Roll six dice, set aside the ones that score, then choose to bank your points
// or reroll the rest for more. Roll no scoring dice and you Farkle, losing the
// turn's points. First to 10,000 wins — the goal is to do it in as few turns as
// possible.
//
// All logic and mutable state live at module scope so the Playwright suite can
// drive the game deterministically. In particular `rollNDice` is a reassignable
// binding a test can replace to supply fixed dice.
// ---------------------------------------------------------------------------

const WIN_TARGET = 10000;
const NUM_DICE = 6;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const totalEl = document.getElementById('total');
const turnScoreEl = document.getElementById('turn-score');
const turnNumberEl = document.getElementById('turn-number');
const bestEl = document.getElementById('best');
const messageEl = document.getElementById('message');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnRoll = document.getElementById('btn-roll');
const btnSetAside = document.getElementById('btn-setaside');
const btnBank = document.getElementById('btn-bank');

// --- State (module scope, poked by tests) ---
let state;          // 'ready' | 'playing' | 'over'
let turnPhase;      // 'await-roll' | 'select'
let dice;           // current rolled faces (array of 1..6)
let selected;       // parallel array of booleans
let totalScore;     // committed points
let turnScore;      // points set aside this turn, not yet banked
let remainingDice;  // dice available to roll next
let turnNumber;     // 1-based count of turns taken
let best;           // fewest turns to win, or null
let message;

// The dice roller — reassignable so tests can make roll() deterministic.
let rollNDice = function (n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(1 + Math.floor(Math.random() * 6));
    return out;
};

// --------------------------------------------------------------------------
// Pure scoring
// --------------------------------------------------------------------------
// Scores a set of dice and reports whether every die contributed. Dice showing
// 2/3/4/6 only score as part of a three-or-more-of-a-kind, a full straight, or
// three pairs. See DESIGN.md for the full table.
function scoreDice(diceSet) {
    const n = diceSet.length;
    const counts = [0, 0, 0, 0, 0, 0, 0]; // index by face 1..6
    for (const d of diceSet) counts[d]++;

    // Whole-set bonuses only apply to all six dice.
    if (n === 6) {
        const isStraight = [1, 2, 3, 4, 5, 6].every(v => counts[v] === 1);
        if (isStraight) return { score: 1500, allUsed: true };
        const pairs = [1, 2, 3, 4, 5, 6].filter(v => counts[v] === 2).length;
        if (pairs === 3) return { score: 1500, allUsed: true };
    }

    let score = 0;
    let used = 0;
    for (let v = 1; v <= 6; v++) {
        const c = counts[v];
        if (c >= 3) {
            if (c === 6) { score += 3000; used += 6; }
            else if (c === 5) { score += 2000; used += 5; }
            else if (c === 4) { score += 1000; used += 4; }
            else { score += (v === 1 ? 1000 : v * 100); used += 3; }
        } else if (v === 1) {
            score += 100 * c; used += c;
        } else if (v === 5) {
            score += 50 * c; used += c;
        }
    }
    return { score, allUsed: n > 0 && used === n };
}

// Does a roll contain any scoring dice at all? (Used to detect a farkle.)
function hasScore(diceSet) {
    return scoreDice(diceSet).score > 0;
}

// Score of the dice currently selected by the player.
function selectedScore() {
    return scoreDice(selectedDice());
}

function selectedDice() {
    const out = [];
    for (let i = 0; i < dice.length; i++) if (selected[i]) out.push(dice[i]);
    return out;
}

// --------------------------------------------------------------------------
// Game flow
// --------------------------------------------------------------------------
function startGame() {
    state = 'playing';
    turnPhase = 'await-roll';
    dice = [];
    selected = [];
    totalScore = 0;
    turnScore = 0;
    remainingDice = NUM_DICE;
    turnNumber = 1;
    message = 'Roll to begin your turn.';
    render();
}

function roll() {
    if (state !== 'playing' || turnPhase !== 'await-roll') return;
    dice = rollNDice(remainingDice);
    selected = dice.map(() => false);
    if (!hasScore(dice)) {
        // Farkle — lose everything banked this turn.
        message = 'Farkle! No scoring dice — turn lost.';
        turnScore = 0;
        endTurn();
        return;
    }
    turnPhase = 'select';
    message = 'Select scoring dice, then Set Aside.';
    render();
}

function toggleSelect(i) {
    if (state !== 'playing' || turnPhase !== 'select') return;
    if (i < 0 || i >= dice.length) return;
    selected[i] = !selected[i];
    render();
}

function setAside() {
    if (state !== 'playing' || turnPhase !== 'select') return false;
    const chosen = selectedDice();
    if (chosen.length === 0) {
        message = 'Select at least one scoring die.';
        render();
        return false;
    }
    const { score, allUsed } = scoreDice(chosen);
    if (!allUsed || score === 0) {
        message = 'Every selected die must score.';
        render();
        return false;
    }
    turnScore += score;
    remainingDice -= chosen.length;
    if (remainingDice === 0) {
        remainingDice = NUM_DICE; // hot dice
        message = `Hot dice! +${score}. Roll all six again or bank.`;
    } else {
        message = `+${score}. Roll again or bank.`;
    }
    dice = [];
    selected = [];
    turnPhase = 'await-roll';
    render();
    return true;
}

function bank() {
    if (state !== 'playing' || turnPhase !== 'await-roll') return;
    if (turnScore === 0) return;
    totalScore += turnScore;
    const banked = turnScore;
    turnScore = 0;
    if (totalScore >= WIN_TARGET) {
        win();
        return;
    }
    message = `Banked ${banked}. Total ${totalScore}.`;
    nextTurn();
}

function endTurn() {
    if (totalScore >= WIN_TARGET) { win(); return; }
    nextTurn();
}

function nextTurn() {
    turnNumber += 1;
    turnScore = 0;
    remainingDice = NUM_DICE;
    dice = [];
    selected = [];
    turnPhase = 'await-roll';
    render();
}

function win() {
    state = 'over';
    if (best === null || turnNumber < best) {
        best = turnNumber;
        try { localStorage.setItem('farkle-best', String(best)); } catch (e) { /* ignore */ }
    }
    message = `You reached ${totalScore} in ${turnNumber} turns!`;
    render();
}

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------
const DIE = 66;
const DIE_GAP = 12;
const PIP_R = 6;

function dieRect(i) {
    const totalW = NUM_DICE * DIE + (NUM_DICE - 1) * DIE_GAP;
    const x0 = (520 - totalW) / 2;
    return { x: x0 + i * (DIE + DIE_GAP), y: 42, w: DIE, h: DIE };
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

// Standard pip layout for a die face (1..6).
const PIP_LAYOUT = {
    1: [[0.5, 0.5]],
    2: [[0.28, 0.28], [0.72, 0.72]],
    3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
    6: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.5], [0.72, 0.5], [0.28, 0.72], [0.72, 0.72]],
};

function drawDie(face, x, y, w, h, isSelected, scoresAlone) {
    roundRect(x, y, w, h, 10);
    ctx.fillStyle = isSelected ? '#fff4d6' : '#fbfbf7';
    ctx.fill();
    ctx.lineWidth = isSelected ? 4 : 2;
    ctx.strokeStyle = isSelected ? '#ffca4a' : (scoresAlone ? '#8fd6a8' : '#c9cfc9');
    ctx.stroke();

    ctx.fillStyle = '#20242a';
    for (const [px, py] of PIP_LAYOUT[face]) {
        ctx.beginPath();
        ctx.arc(x + px * w, y + py * h, PIP_R, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawEmptySlot(x, y, w, h) {
    roundRect(x, y, w, h, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
}

function render() {
    // HUD.
    totalEl.textContent = String(totalScore ?? 0);
    turnScoreEl.textContent = String(turnScore ?? 0);
    turnNumberEl.textContent = String(turnNumber ?? 0);
    bestEl.textContent = best === null || best === undefined ? '—' : String(best);
    messageEl.textContent = message;

    // Overlay.
    if (state === 'ready') {
        overlay.classList.add('visible');
        overlayTitle.textContent = 'Farkle';
        overlaySub.textContent = 'Reach 10,000 points in as few turns as you can.';
        btnStart.textContent = 'Start Game';
    } else if (state === 'over') {
        overlay.classList.add('visible');
        overlayTitle.textContent = 'You Win!';
        overlaySub.textContent = `${totalScore} points in ${turnNumber} turns.` +
            (best !== null ? ` Best: ${best} turns.` : '');
        btnStart.textContent = 'Play Again';
    } else {
        overlay.classList.remove('visible');
    }

    // Buttons.
    const playing = state === 'playing';
    btnRoll.disabled = !(playing && turnPhase === 'await-roll');
    btnSetAside.disabled = !(playing && turnPhase === 'select');
    btnBank.disabled = !(playing && turnPhase === 'await-roll' && turnScore > 0);

    // Table.
    ctx.fillStyle = '#1c7a4a';
    ctx.fillRect(0, 0, 520, 150);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 5;
    ctx.strokeRect(3, 3, 514, 144);

    // Dice.
    for (let i = 0; i < NUM_DICE; i++) {
        const r = dieRect(i);
        if (dice && dice[i] !== undefined) {
            const alone = scoreDice([dice[i]]).score > 0; // a 1 or a 5 on its own
            drawDie(dice[i], r.x, r.y, r.w, r.h, selected[i], alone);
        } else {
            drawEmptySlot(r.x, r.y, r.w, r.h);
        }
    }

    // Selection preview.
    if (playing && turnPhase === 'select') {
        const s = selectedScore();
        ctx.fillStyle = s.score > 0 && s.allUsed ? '#eaffdf' : 'rgba(255,255,255,0.6)';
        ctx.font = '13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const label = s.score === 0
            ? 'Select scoring dice'
            : (s.allUsed ? `Selection: ${s.score}` : 'Selection includes a non-scoring die');
        ctx.fillText(label, 260, 144);
    }
}

// --------------------------------------------------------------------------
// Input
// --------------------------------------------------------------------------
btnStart.addEventListener('click', startGame);
btnRoll.addEventListener('click', roll);
btnSetAside.addEventListener('click', setAside);
btnBank.addEventListener('click', bank);

canvas.addEventListener('click', e => {
    if (state !== 'playing' || turnPhase !== 'select') return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    for (let i = 0; i < dice.length; i++) {
        const r = dieRect(i);
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            toggleSelect(i);
            break;
        }
    }
});

document.addEventListener('keydown', e => {
    const k = e.key;
    if (state === 'ready' || state === 'over') {
        if (k === 'Enter' || k === ' ') { startGame(); e.preventDefault(); }
        return;
    }
    if (k === 'r' || k === 'R' || k === ' ') { roll(); e.preventDefault(); }
    else if (k === 'a' || k === 'A') { setAside(); }
    else if (k === 'b' || k === 'B') { bank(); }
    else if (k >= '1' && k <= '6') { toggleSelect(Number(k) - 1); }
});

// --------------------------------------------------------------------------
// Init
// --------------------------------------------------------------------------
function loadBest() {
    const v = parseInt(localStorage.getItem('farkle-best'), 10);
    return Number.isFinite(v) ? v : null;
}

state = 'ready';
turnPhase = 'await-roll';
dice = [];
selected = [];
totalScore = 0;
turnScore = 0;
remainingDice = NUM_DICE;
turnNumber = 0;
best = loadBest();
message = 'Press Start to play.';

render();
