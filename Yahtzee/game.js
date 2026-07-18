// ---------------------------------------------------------------------------
// Yahtzee — the classic five-dice game.
//
// Each turn: roll up to three times, holding any dice between rolls, then bank
// the result into one of thirteen categories. Fill all thirteen to finish; a
// 63+ upper section earns a 35-point bonus. Highest grand total wins.
//
// Game state and the scoring helpers are intentionally global so the Playwright
// tests can build exact dice and score them deterministically.
// ---------------------------------------------------------------------------

// --- Categories ------------------------------------------------------------
const CATEGORIES = [
    { key: 'ones', label: 'Ones', section: 'upper' },
    { key: 'twos', label: 'Twos', section: 'upper' },
    { key: 'threes', label: 'Threes', section: 'upper' },
    { key: 'fours', label: 'Fours', section: 'upper' },
    { key: 'fives', label: 'Fives', section: 'upper' },
    { key: 'sixes', label: 'Sixes', section: 'upper' },
    { key: 'threeKind', label: 'Three of a Kind', section: 'lower' },
    { key: 'fourKind', label: 'Four of a Kind', section: 'lower' },
    { key: 'fullHouse', label: 'Full House', section: 'lower' },
    { key: 'smallStraight', label: 'Small Straight', section: 'lower' },
    { key: 'largeStraight', label: 'Large Straight', section: 'lower' },
    { key: 'yahtzee', label: 'Yahtzee', section: 'lower' },
    { key: 'chance', label: 'Chance', section: 'lower' },
];

const UPPER_KEYS = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const UPPER_BONUS_THRESHOLD = 63;
const UPPER_BONUS = 35;
const MAX_ROLLS = 3;
const NUM_DICE = 5;

// --- Mutable game state ----------------------------------------------------
let dice = [1, 1, 1, 1, 1];                 // current dice faces (1..6)
let held = [false, false, false, false, false];
let rollsLeft = MAX_ROLLS;
let scores = freshScores();                 // category key -> number | null
let turn = 0;                               // categories filled this game
let state = 'ready';                        // 'ready' | 'running' | 'over'
let best = 0;

// --- DOM references --------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const rollsEl = document.getElementById('rolls');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnRoll = document.getElementById('btn-roll');
const cardBody = document.getElementById('scorecard-body');

// --- Pure scoring ----------------------------------------------------------
function freshScores() {
    const s = {};
    for (const c of CATEGORIES) s[c.key] = null;
    return s;
}

function faceCounts(d) {
    const c = [0, 0, 0, 0, 0, 0, 0]; // indices 1..6 used
    for (const v of d) c[v]++;
    return c;
}

function sumDice(d) {
    return d.reduce((a, b) => a + b, 0);
}

function hasRun(counts, len) {
    let run = 0;
    for (let i = 1; i <= 6; i++) {
        if (counts[i] > 0) {
            run++;
            if (run >= len) return true;
        } else {
            run = 0;
        }
    }
    return false;
}

// Score `d` (array of 5 faces) as if banked in category `key`.
function scoreFor(key, d) {
    const c = faceCounts(d);
    switch (key) {
        case 'ones': return c[1] * 1;
        case 'twos': return c[2] * 2;
        case 'threes': return c[3] * 3;
        case 'fours': return c[4] * 4;
        case 'fives': return c[5] * 5;
        case 'sixes': return c[6] * 6;
        case 'threeKind': return c.some((n) => n >= 3) ? sumDice(d) : 0;
        case 'fourKind': return c.some((n) => n >= 4) ? sumDice(d) : 0;
        case 'fullHouse': return c.some((n) => n === 3) && c.some((n) => n === 2) ? 25 : 0;
        case 'smallStraight': return hasRun(c, 4) ? 30 : 0;
        case 'largeStraight': return hasRun(c, 5) ? 40 : 0;
        case 'yahtzee': return c.some((n) => n === 5) ? 50 : 0;
        case 'chance': return sumDice(d);
        default: return 0;
    }
}

// --- Totals ----------------------------------------------------------------
function upperSubtotal() {
    let t = 0;
    for (const k of UPPER_KEYS) if (scores[k] !== null) t += scores[k];
    return t;
}

function upperBonus() {
    return upperSubtotal() >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
}

function grandTotal() {
    let t = upperBonus();
    for (const c of CATEGORIES) if (scores[c.key] !== null) t += scores[c.key];
    return t;
}

// --- Persistence -----------------------------------------------------------
function loadBest() {
    const v = parseInt(localStorage.getItem('yahtzee-best'), 10);
    return Number.isFinite(v) ? v : 0;
}

function saveBest(v) {
    try {
        localStorage.setItem('yahtzee-best', String(v));
    } catch (e) {
        /* localStorage may be unavailable; ignore */
    }
}

// --- Overlay / HUD ---------------------------------------------------------
function showOverlay(title, big, sub, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = big;
    overlaySub.textContent = sub;
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function updateHud() {
    scoreEl.textContent = String(grandTotal());
    bestEl.textContent = String(best);
    rollsEl.textContent = String(rollsLeft);
    const rollable = state === 'running' && rollsLeft > 0;
    btnRoll.disabled = !rollable;
}

// --- Game lifecycle --------------------------------------------------------
function newTurn() {
    rollsLeft = MAX_ROLLS;
    held = [false, false, false, false, false];
    dice = [1, 1, 1, 1, 1];
}

function startGame() {
    scores = freshScores();
    turn = 0;
    state = 'running';
    newTurn();
    hideOverlay();
    updateHud();
    render();
    renderCard();
}

function rollDie() {
    return 1 + Math.floor(Math.random() * 6);
}

function rollDice() {
    if (state !== 'running' || rollsLeft <= 0) return;
    for (let i = 0; i < NUM_DICE; i++) {
        if (!held[i]) dice[i] = rollDie();
    }
    rollsLeft--;
    updateHud();
    render();
    renderCard();
}

function toggleHold(i) {
    if (state !== 'running' || rollsLeft === MAX_ROLLS) return; // must roll first
    if (i < 0 || i >= NUM_DICE) return;
    held[i] = !held[i];
    render();
}

function scoreCategory(key) {
    if (state !== 'running') return;
    if (rollsLeft === MAX_ROLLS) return;   // must roll at least once
    if (!(key in scores) || scores[key] !== null) return; // unknown or already used

    scores[key] = scoreFor(key, dice);
    turn++;
    updateHud();

    if (turn >= CATEGORIES.length) {
        endGame();
        return;
    }
    newTurn();
    updateHud();
    render();
    renderCard();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    const total = grandTotal();
    if (total > best) {
        best = total;
        saveBest(best);
    }
    updateHud();
    showOverlay('Game Over', String(total), 'Press Space or Enter to play again', 'Play Again');
}

// --- Dice rendering --------------------------------------------------------
const DIE_SIZE = 74;
const DIE_GAP = 16;
const PIP = 7;

function dieX(i) {
    const totalW = NUM_DICE * DIE_SIZE + (NUM_DICE - 1) * DIE_GAP;
    const startX = (canvas.width - totalW) / 2;
    return startX + i * (DIE_SIZE + DIE_GAP);
}

const DIE_Y = (130 - DIE_SIZE) / 2;

// Pip layout per face, in a 3×3 grid of unit coordinates (0,1,2).
const PIP_LAYOUT = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
};

function drawDie(i) {
    const x = dieX(i);
    const y = DIE_Y;
    const face = dice[i];
    const isHeld = held[i];

    ctx.fillStyle = isHeld ? '#f43f5e' : '#f5f5f4';
    roundRect(x, y, DIE_SIZE, DIE_SIZE, 12);
    ctx.fill();

    if (isHeld) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#fda4af';
        roundRect(x + 1.5, y + 1.5, DIE_SIZE - 3, DIE_SIZE - 3, 11);
        ctx.stroke();
    }

    ctx.fillStyle = isHeld ? '#ffffff' : '#1c1917';
    const pad = 18;
    const step = (DIE_SIZE - 2 * pad) / 2;
    for (const [gx, gy] of PIP_LAYOUT[face]) {
        const cx = x + pad + gx * step;
        const cy = y + pad + gy * step;
        ctx.beginPath();
        ctx.arc(cx, cy, PIP, 0, Math.PI * 2);
        ctx.fill();
    }
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

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (state === 'ready') return;
    for (let i = 0; i < NUM_DICE; i++) drawDie(i);
}

// --- Scorecard rendering ---------------------------------------------------
function buildCard() {
    cardBody.innerHTML = '';

    const sectionHeader = (text) => {
        const tr = document.createElement('tr');
        tr.className = 'section-row';
        const td = document.createElement('td');
        td.colSpan = 2;
        td.textContent = text;
        tr.appendChild(td);
        cardBody.appendChild(tr);
    };

    const catRow = (cat) => {
        const tr = document.createElement('tr');
        tr.className = 'cat-row';
        tr.id = 'row-' + cat.key;
        tr.dataset.key = cat.key;

        const label = document.createElement('td');
        label.className = 'cat-label';
        label.textContent = cat.label;

        const val = document.createElement('td');
        val.className = 'cat-score';
        val.id = 'val-' + cat.key;

        tr.appendChild(label);
        tr.appendChild(val);
        tr.addEventListener('click', () => {
            if (state === 'running' && rollsLeft < MAX_ROLLS && scores[cat.key] === null) {
                scoreCategory(cat.key);
            }
        });
        cardBody.appendChild(tr);
    };

    const subtotalRow = (id, label) => {
        const tr = document.createElement('tr');
        tr.className = 'subtotal-row';
        const l = document.createElement('td');
        l.textContent = label;
        const v = document.createElement('td');
        v.className = 'cat-score';
        v.id = id;
        tr.appendChild(l);
        tr.appendChild(v);
        cardBody.appendChild(tr);
    };

    sectionHeader('Upper Section');
    for (const c of CATEGORIES) if (c.section === 'upper') catRow(c);
    subtotalRow('upper-subtotal', 'Subtotal / Bonus');
    sectionHeader('Lower Section');
    for (const c of CATEGORIES) if (c.section === 'lower') catRow(c);
    subtotalRow('grand-total', 'Grand Total');
}

function renderCard() {
    const canScore = state === 'running' && rollsLeft < MAX_ROLLS;
    for (const cat of CATEGORIES) {
        const row = document.getElementById('row-' + cat.key);
        const val = document.getElementById('val-' + cat.key);
        if (!row || !val) continue;

        if (scores[cat.key] !== null) {
            row.classList.add('filled');
            row.classList.remove('playable');
            val.classList.remove('preview');
            val.textContent = String(scores[cat.key]);
        } else if (canScore) {
            row.classList.add('playable');
            row.classList.remove('filled');
            val.classList.add('preview');
            val.textContent = String(scoreFor(cat.key, dice));
        } else {
            row.classList.remove('playable', 'filled');
            val.classList.remove('preview');
            val.textContent = '';
        }
    }

    const subEl = document.getElementById('upper-subtotal');
    if (subEl) subEl.textContent = `${upperSubtotal()} (+${upperBonus()})`;
    const totEl = document.getElementById('grand-total');
    if (totEl) totEl.textContent = String(grandTotal());
}

// --- Input -----------------------------------------------------------------
window.addEventListener('keydown', (e) => {
    const k = e.key;

    if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
        e.preventDefault();
        if (state === 'ready' || state === 'over') startGame();
        else if (state === 'running') rollDice();
        return;
    }

    if (k >= '1' && k <= '5') {
        toggleHold(parseInt(k, 10) - 1);
    }
});

canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    for (let i = 0; i < NUM_DICE; i++) {
        const dx = dieX(i);
        if (x >= dx && x <= dx + DIE_SIZE && y >= DIE_Y && y <= DIE_Y + DIE_SIZE) {
            toggleHold(i);
            return;
        }
    }
});

btnRoll.addEventListener('click', () => {
    if (state === 'running') rollDice();
});

btnStart.addEventListener('click', () => {
    if (state === 'ready' || state === 'over') startGame();
});

// --- Boot ------------------------------------------------------------------
function init() {
    best = loadBest();
    buildCard();
    scores = freshScores();
    state = 'ready';
    updateHud();
    render();
    renderCard();
    showOverlay('Yahtzee', '', 'Press Space or Enter to start', 'Start Game');
}

init();
