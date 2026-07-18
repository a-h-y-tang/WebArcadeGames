// ---------------------------------------------------------------------------
// Mastermind — HTML5 Canvas
//
// The code-breaking classic. A hidden 4-peg code is drawn from 6 colours
// (repeats allowed); you have 10 guesses. Each guess is scored with black
// pegs (right colour, right place) and white pegs (right colour, wrong place).
//
// Top-level bindings (COLORS, secret, guesses, current, state, ...) and the
// core functions (newGame, setSecret, pickColor, submitGuess, scoreGuess, ...)
// are intentionally global so the Playwright suite can drive the game and
// inspect its state via page.evaluate(), matching the repo's convention.
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// --- Config ----------------------------------------------------------------
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];
const COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const CODE_LENGTH = 4;
const MAX_GUESSES = 10;

// --- Layout ----------------------------------------------------------------
const BOARD_TOP = 18;
const ROW_H = 46;
const PEG_R = 15;
const GUESS_X0 = 42;           // centre x of the first guess peg
const GUESS_DX = 40;           // spacing between guess pegs
const FB_X0 = 232;             // feedback cluster origin
const FB_DX = 18;              // feedback peg spacing
const FB_R = 6;
const SW_Y = 506;              // palette row
const SW_W = 44;
const SW_H = 44;
const SW_GAP = 10;
const SW_X0 = 20;

// --- State -----------------------------------------------------------------
let state = 'idle';            // idle | playing | won | lost
let secret = [];               // the hidden code, length CODE_LENGTH
let guesses = [];              // [{ code:[...], black, white }]
let current = [];              // pegs picked for the row in progress

// --- DOM -------------------------------------------------------------------
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const remainingEl = document.getElementById('remaining');

// ---------------------------------------------------------------------------
// Layout helpers (also used by the test suite for click targets)
// ---------------------------------------------------------------------------
function guessCenter(row, col) {
    return { x: GUESS_X0 + col * GUESS_DX, y: BOARD_TOP + ROW_H / 2 + row * ROW_H };
}

function swatchRect(i) {
    return { x: SW_X0 + i * (SW_W + SW_GAP), y: SW_Y, w: SW_W, h: SW_H };
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------
// Standard Mastermind scoring: blacks are exact hits; whites are colour
// matches out of position, counting each colour at most min(guess, secret)
// times so duplicates are never over-credited.
function scoreGuess(guess, code) {
    let black = 0;
    const sCount = {};
    const gCount = {};
    for (let i = 0; i < guess.length; i++) {
        if (guess[i] === code[i]) {
            black++;
        } else {
            sCount[code[i]] = (sCount[code[i]] || 0) + 1;
            gCount[guess[i]] = (gCount[guess[i]] || 0) + 1;
        }
    }
    let white = 0;
    for (const c in gCount) {
        white += Math.min(gCount[c], sCount[c] || 0);
    }
    return { black, white };
}

function randomCode() {
    const code = [];
    for (let i = 0; i < CODE_LENGTH; i++) {
        code.push(Math.floor(Math.random() * COLORS.length));
    }
    return code;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function pickColor(i) {
    if (state !== 'playing') return;
    if (i < 0 || i >= COLORS.length) return;
    if (current.length >= CODE_LENGTH) return;
    current.push(i);
    render();
}

function removeLast() {
    if (state !== 'playing') return;
    current.pop();
    render();
}

function clearCurrent() {
    current = [];
    render();
}

function submitGuess() {
    if (state !== 'playing') return;
    if (current.length !== CODE_LENGTH) return; // row must be full

    const code = current.slice();
    const { black, white } = scoreGuess(code, secret);
    guesses.push({ code, black, white });
    current = [];

    if (black === CODE_LENGTH) {
        win();
    } else if (guesses.length >= MAX_GUESSES) {
        lose();
    }

    renderHud();
    render();
}

// ---------------------------------------------------------------------------
// Endings & flow
// ---------------------------------------------------------------------------
function win() {
    state = 'won';
    showOverlay('Code Cracked!', `${guesses.length}/${MAX_GUESSES} guesses`,
        'Nicely deduced. Press any key to play again.', 'Play Again');
}

function lose() {
    state = 'lost';
    showOverlay('Game Over', `Code: ${secret.map((c) => COLOR_NAMES[c]).join(', ')}`,
        'Out of guesses. Press any key to try a new code.', 'Play Again');
}

function newGame() {
    secret = randomCode();
    guesses = [];
    current = [];
    state = 'playing';
    hideOverlay();
    renderHud();
    render();
}

// For deterministic tests: replace the hidden code.
function setSecret(code) {
    secret = code.slice();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------
function renderHud() {
    remainingEl.textContent = String(Math.max(0, MAX_GUESSES - guesses.length));
}

function showOverlay(title, big, sub, btn) {
    overlayTitle.textContent = title;
    overlayScore.textContent = big;
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
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < MAX_GUESSES; row++) {
        drawRow(row);
    }
    drawPalette();
}

function drawRow(row) {
    const done = row < guesses.length;
    const active = state === 'playing' && row === guesses.length;

    // Active-row highlight strip.
    if (active) {
        ctx.fillStyle = 'rgba(88, 166, 255, 0.08)';
        ctx.fillRect(8, BOARD_TOP + row * ROW_H + 2, canvas.width - 16, ROW_H - 4);
    }

    for (let col = 0; col < CODE_LENGTH; col++) {
        const { x, y } = guessCenter(row, col);
        let color = null;
        if (done) color = guesses[row].code[col];
        else if (active && col < current.length) color = current[col];
        drawPeg(x, y, PEG_R, color);
    }

    if (done) drawFeedback(row, guesses[row].black, guesses[row].white);
}

function drawPeg(x, y, r, colorIndex) {
    if (colorIndex === null || colorIndex === undefined) {
        // Empty hole.
        ctx.fillStyle = '#0d1117';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#30363d';
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
    }
    ctx.fillStyle = COLORS[colorIndex];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // Little highlight for a glossy peg.
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
}

function drawFeedback(row, black, white) {
    const baseY = BOARD_TOP + ROW_H / 2 + row * ROW_H;
    // 2x2 grid of small pegs: blacks first, then whites, then empties.
    const slots = [];
    for (let i = 0; i < black; i++) slots.push('#0d1117');
    for (let i = 0; i < white; i++) slots.push('#e6edf3');
    while (slots.length < CODE_LENGTH) slots.push(null);

    for (let i = 0; i < CODE_LENGTH; i++) {
        const gx = FB_X0 + (i % 2) * FB_DX;
        const gy = baseY - FB_DX / 2 + Math.floor(i / 2) * FB_DX;
        ctx.beginPath();
        ctx.arc(gx, gy, FB_R, 0, Math.PI * 2);
        if (slots[i] === null) {
            ctx.fillStyle = '#161b22';
            ctx.fill();
            ctx.strokeStyle = '#30363d';
            ctx.lineWidth = 1;
            ctx.stroke();
        } else {
            ctx.fillStyle = slots[i];
            ctx.fill();
            ctx.strokeStyle = '#30363d';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }
}

function drawPalette() {
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(10, SW_Y - 12);
    ctx.lineTo(canvas.width - 10, SW_Y - 12);
    ctx.stroke();

    for (let i = 0; i < COLORS.length; i++) {
        const { x, y, w, h } = swatchRect(i);
        ctx.fillStyle = COLORS[i];
        roundRect(x, y, w, h, 8);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        roundRect(x + 4, y + 4, w - 8, 10, 5);
        ctx.fill();
        // Key hint.
        ctx.fillStyle = 'rgba(13,17,23,0.85)';
        ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x + w / 2, y + h - 10);
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

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
    // Overlay states: any key starts a fresh game.
    if (state !== 'playing') {
        newGame();
        e.preventDefault();
        return;
    }

    const k = e.key;
    if (k >= '1' && k <= String(COLORS.length)) {
        pickColor(Number(k) - 1);
        e.preventDefault();
    } else if (k === 'Enter') {
        submitGuess();
        e.preventDefault();
    } else if (k === 'Backspace') {
        removeLast();
        e.preventDefault();
    } else if (k === 'Escape') {
        clearCurrent();
        e.preventDefault();
    }
});

canvas.addEventListener('mousedown', (e) => {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // Palette swatch?
    for (let i = 0; i < COLORS.length; i++) {
        const s = swatchRect(i);
        if (px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h) {
            pickColor(i);
            return;
        }
    }
    // Click the active row's pegs area to submit when full, else remove last.
    if (px > FB_X0 - FB_DX && py < SW_Y - 12) {
        if (current.length === CODE_LENGTH) submitGuess();
    }
});

btnStart.addEventListener('click', () => {
    if (state !== 'playing') newGame();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
secret = randomCode();
renderHud();
render();
showOverlay('Mastermind', '',
    'Crack the hidden 4-colour code in 10 guesses. Keys 1–6 pick colours, Enter submits, Backspace deletes. Press any key to start.',
    'Start Game');
