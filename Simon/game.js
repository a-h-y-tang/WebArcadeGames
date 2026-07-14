// =======================================================================
// Simon — the electronic memory game.
//
// Plain (non-module) script so its top-level bindings are reachable from the
// Playwright suite via page.evaluate. The scoring/failure logic is kept
// separate from the playback timers so it can be driven deterministically:
// a test sets `sequence`, forces `state` to 'input', and calls pressPad().
// =======================================================================

// --- Board ---
const WIDTH = 500;
const HEIGHT = 500;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const OUTER_R = 210;
const INNER_R = 84;
const DEAD_R = 60; // central dead zone (not a pad)

// Pads in reading order: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
const PADS = [
    { name: 'green', dim: '#166534', lit: '#4ade80', start: Math.PI, end: 1.5 * Math.PI },
    { name: 'red', dim: '#7f1d1d', lit: '#f87171', start: 1.5 * Math.PI, end: 2 * Math.PI },
    { name: 'yellow', dim: '#854d0e', lit: '#facc15', start: 0.5 * Math.PI, end: Math.PI },
    { name: 'blue', dim: '#1e3a8a', lit: '#60a5fa', start: 0, end: 0.5 * Math.PI },
];

// --- Timing (ms) ---
const START_DELAY = 400;
const FLASH_MS = 300;
const GAP_MS = 160;
const ROUND_PAUSE = 700;

const SEED = 0x51503a01; // arbitrary fixed seed for reproducible sessions

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let sequence, playerPos, score, best, state, activePad;
let playTimer = null;
let flashTimer = null;
let roundTimer = null;

// -----------------------------------------------------------------------
// Seeded PRNG (mulberry32) — reseeded each game for reproducible sessions.
// -----------------------------------------------------------------------
let rngState = 0x9e3779b9 >>> 0;
function rng() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// -----------------------------------------------------------------------
// Geometry / hit-testing
// -----------------------------------------------------------------------
function padAtPoint(x, y) {
    const dx = x - CX;
    const dy = y - CY;
    if (Math.hypot(dx, dy) < DEAD_R) return -1;
    const left = x < CX;
    const top = y < CY;
    if (top && left) return 0;
    if (top && !left) return 1;
    if (!top && left) return 2;
    return 3;
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function drawPad(i, lit) {
    const gap = 0.045;
    const p = PADS[i];
    ctx.beginPath();
    ctx.arc(CX, CY, OUTER_R, p.start + gap, p.end - gap);
    ctx.arc(CX, CY, INNER_R, p.end - gap, p.start + gap, true);
    ctx.closePath();
    ctx.fillStyle = lit ? p.lit : p.dim;
    ctx.fill();
    if (lit) {
        ctx.save();
        ctx.shadowColor = p.lit;
        ctx.shadowBlur = 30;
        ctx.fill();
        ctx.restore();
    }
}

function drawHub() {
    ctx.beginPath();
    ctx.arc(CX, CY, INNER_R - 6, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0f17';
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.font = '700 18px Segoe UI, sans-serif';
    ctx.fillText('SIMON', CX, CY - 6);
    ctx.fillStyle = '#e6f0ff';
    ctx.font = '700 26px Segoe UI, sans-serif';
    const label =
        state === 'input' || state === 'watch' ? String(sequence.length) : '–';
    ctx.fillText(label, CX, CY + 22);
}

function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    for (let i = 0; i < PADS.length; i++) drawPad(i, activePad === i);
    drawHub();
}

// -----------------------------------------------------------------------
// Pad flashing
// -----------------------------------------------------------------------
function flashPad(i, ms) {
    activePad = i;
    render();
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
        activePad = -1;
        render();
    }, ms);
}

// -----------------------------------------------------------------------
// Sequence / rounds
// -----------------------------------------------------------------------
function addStep() {
    sequence.push(Math.floor(rng() * PADS.length));
}

function playSequence() {
    state = 'watch';
    playerPos = 0;
    activePad = -1;
    render();
    clearTimeout(playTimer);
    let i = 0;
    function playNext() {
        if (i >= sequence.length) {
            state = 'input';
            render();
            return;
        }
        flashPad(sequence[i], FLASH_MS);
        i += 1;
        playTimer = setTimeout(playNext, FLASH_MS + GAP_MS);
    }
    playTimer = setTimeout(playNext, START_DELAY);
}

function nextRound() {
    addStep();
    playSequence();
}

// -----------------------------------------------------------------------
// Player input
// -----------------------------------------------------------------------
function pressPad(i) {
    if (state !== 'input') return;
    flashPad(i, FLASH_MS);

    if (i === sequence[playerPos]) {
        playerPos += 1;
        if (playerPos >= sequence.length) {
            // Whole sequence reproduced — score the round and queue the next.
            score = sequence.length;
            updateHud();
            playerPos = 0;
            state = 'watch';
            clearTimeout(roundTimer);
            roundTimer = setTimeout(nextRound, ROUND_PAUSE);
        }
    } else {
        endGame();
    }
}

// -----------------------------------------------------------------------
// HUD & overlay
// -----------------------------------------------------------------------
function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
}

function showOverlay(title, sub, scoreText = '') {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// -----------------------------------------------------------------------
// Game flow
// -----------------------------------------------------------------------
function clearTimers() {
    clearTimeout(playTimer);
    clearTimeout(flashTimer);
    clearTimeout(roundTimer);
}

function startGame() {
    rngState = SEED >>> 0;
    clearTimers();
    sequence = [];
    score = 0;
    playerPos = 0;
    activePad = -1;
    updateHud();
    hideOverlay();
    btnStart.textContent = 'Start Game';
    state = 'watch';
    addStep();
    playSequence();
}

function endGame() {
    state = 'over';
    clearTimers();
    activePad = -1;
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('simon-best', String(best));
        } catch (e) {
            /* localStorage may be unavailable */
        }
    }
    updateHud();
    render();
    showOverlay('Game Over', 'Press Space to play again', `${score} pts`);
    btnStart.textContent = 'Play Again';
}

// -----------------------------------------------------------------------
// Input wiring
// -----------------------------------------------------------------------
document.addEventListener('keydown', e => {
    const k = e.key;

    if (state === 'idle' || state === 'over') {
        if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
            e.preventDefault();
            startGame();
        }
        return;
    }

    if (state === 'input' && k >= '1' && k <= '4') {
        e.preventDefault();
        pressPad(parseInt(k, 10) - 1);
    }
});

canvas.addEventListener('click', e => {
    if (state !== 'input') return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (WIDTH / rect.width);
    const y = (e.clientY - rect.top) * (HEIGHT / rect.height);
    const pad = padAtPoint(x, y);
    if (pad >= 0) pressPad(pad);
});

btnStart.addEventListener('click', () => startGame());

// -----------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------
function init() {
    best = parseInt(localStorage.getItem('simon-best'), 10) || 0;
    sequence = [];
    score = 0;
    playerPos = 0;
    activePad = -1;
    state = 'idle';
    updateHud();
    render();
}

init();
