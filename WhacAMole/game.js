const GRID = 3;
const CELL = 160;          // pixels per hole (3×160 = 480)
const HOLES = GRID * GRID;
const GAME_SECONDS = 30;
const MAX_UP = 3;          // most moles up at once

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const timeEl = document.getElementById('time');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// Colors
const CLR = {
    bg:       '#0d1117',
    holeRim:  '#1f2a1a',
    hole:     '#0a0f08',
    dirt:     '#3f2d1e',
    mole:     '#a97142',
    moleDark: '#8a5a34',
    belly:    '#e7c9a0',
    eye:      '#1b1b1b',
    nose:     '#5b2d1a',
};

// --- State ---
// moles: one entry per hole, { up, until, shownAt }.
let moles, score, best, state, timeLeft, endTime, nextSpawnAt, pauseRemaining, animId;

function now() {
    return performance.now();
}

function elapsedFraction() {
    // 0 at the start of the round → 1 at the end.
    const remaining = endTime - now();
    return Math.min(1, Math.max(0, 1 - remaining / (GAME_SECONDS * 1000)));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function spawnInterval() {
    return lerp(900, 380, elapsedFraction());
}

function upDuration() {
    return lerp(1300, 650, elapsedFraction());
}

function startGame() {
    moles = Array.from({ length: HOLES }, () => ({ up: false, until: 0, shownAt: 0 }));
    score = 0;
    state = 'running';
    endTime = now() + GAME_SECONDS * 1000;
    nextSpawnAt = now() + 500;
    timeLeft = GAME_SECONDS;

    scoreEl.textContent = score;
    timeEl.textContent = timeLeft;
    overlay.classList.remove('visible');

    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';

    // Every mole ducks when the round ends.
    if (moles) moles.forEach(m => { m.up = false; });

    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('whackamole-best', best);
    }

    overlayTitle.textContent = "Time's Up!";
    overlayScore.textContent = `${score} whacked`;
    overlaySub.textContent = 'Press Space or click to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

// Raise a mole in hole `i` (used by the spawner and by tests).
function spawnMole(i) {
    if (state !== 'running') return;
    if (i < 0 || i >= HOLES) return;
    if (moles[i].up) return;
    moles[i].up = true;
    moles[i].shownAt = now();
    moles[i].until = now() + upDuration();
}

// Whack hole `i`. Returns true on a successful hit.
function whack(i) {
    if (state !== 'running') return false;
    if (i < 0 || i >= HOLES) return false;
    if (!moles[i].up) return false;
    moles[i].up = false;
    score++;
    scoreEl.textContent = score;
    return true;
}

function randomEmptyHole() {
    const empty = [];
    for (let i = 0; i < HOLES; i++) {
        if (!moles[i].up) empty.push(i);
    }
    if (empty.length === 0) return -1;
    return empty[Math.floor(Math.random() * empty.length)];
}

// --- Game loop (timestamp-driven) ---
function loop() {
    if (state !== 'running') return;
    const t = now();

    // Countdown
    timeLeft = Math.max(0, Math.ceil((endTime - t) / 1000));
    timeEl.textContent = timeLeft;
    if (t >= endTime) {
        endGame();
        return;
    }

    // Auto-hide moles whose window has passed
    for (let i = 0; i < HOLES; i++) {
        if (moles[i].up && t >= moles[i].until) {
            moles[i].up = false;
        }
    }

    // Spawn new moles on a shrinking interval
    if (t >= nextSpawnAt) {
        const upCount = moles.filter(m => m.up).length;
        if (upCount < MAX_UP) {
            const i = randomEmptyHole();
            if (i >= 0) spawnMole(i);
        }
        nextSpawnAt = t + spawnInterval();
    }

    draw();
    animId = requestAnimationFrame(loop);
}

// --- Rendering ---
function holeCenter(i) {
    const col = i % GRID;
    const row = Math.floor(i / GRID);
    return { cx: col * CELL + CELL / 2, cy: row * CELL + CELL / 2 };
}

function drawMole(cx, cy, riseT) {
    const r = CELL * 0.28;
    // riseT 0 → hidden below the rim, 1 → fully up.
    const peek = (1 - riseT) * (r * 2.2);
    ctx.save();
    // Clip to the hole so the mole appears to rise out of it.
    ctx.beginPath();
    ctx.ellipse(cx, cy + CELL * 0.12, CELL * 0.34, CELL * 0.22, 0, 0, Math.PI * 2);
    ctx.rect(cx - CELL * 0.4, cy - CELL * 0.5, CELL * 0.8, CELL * 0.62);
    ctx.clip();

    const my = cy + peek;
    // Body
    ctx.fillStyle = CLR.mole;
    ctx.beginPath();
    ctx.arc(cx, my, r, 0, Math.PI * 2);
    ctx.fill();
    // Belly
    ctx.fillStyle = CLR.belly;
    ctx.beginPath();
    ctx.ellipse(cx, my + r * 0.35, r * 0.55, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Eyes
    ctx.fillStyle = CLR.eye;
    ctx.beginPath();
    ctx.arc(cx - r * 0.35, my - r * 0.35, r * 0.12, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.35, my - r * 0.35, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    // Nose
    ctx.fillStyle = CLR.nose;
    ctx.beginPath();
    ctx.arc(cx, my - r * 0.02, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function draw() {
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < HOLES; i++) {
        const { cx, cy } = holeCenter(i);

        // Dirt rim
        ctx.fillStyle = CLR.holeRim;
        ctx.beginPath();
        ctx.ellipse(cx, cy + CELL * 0.12, CELL * 0.38, CELL * 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
        // Hole
        ctx.fillStyle = CLR.hole;
        ctx.beginPath();
        ctx.ellipse(cx, cy + CELL * 0.12, CELL * 0.32, CELL * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Mole (with a short rise animation)
        if (moles && moles[i].up) {
            const riseT = Math.min(1, (now() - moles[i].shownAt) / 130);
            drawMole(cx, cy, riseT);
        }
    }
}

// --- Input ---
const START_KEYS = new Set([' ', 'Spacebar', 'Enter']);

function pause() {
    state = 'paused';
    pauseRemaining = endTime - now();
    overlayTitle.textContent = 'Paused';
    overlayScore.textContent = '';
    overlaySub.textContent = 'Press P to resume';
    btnStart.textContent = 'Resume';
    overlay.classList.add('visible');
}

function resumeGame() {
    state = 'running';
    // Shift the deadlines forward by the paused duration.
    endTime = now() + pauseRemaining;
    nextSpawnAt = now() + 200;
    overlay.classList.remove('visible');
    animId = requestAnimationFrame(loop);
}

function holeAt(x, y) {
    const col = Math.floor(x / CELL);
    const row = Math.floor(y / CELL);
    if (col < 0 || col >= GRID || row < 0 || row >= GRID) return -1;
    return row * GRID + col;
}

document.addEventListener('keydown', e => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running') pause();
        else if (state === 'paused') resumeGame();
        return;
    }
    if (START_KEYS.has(e.key)) {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'paused') resumeGame();
        e.preventDefault();
    }
});

canvas.addEventListener('mousedown', e => {
    if (state === 'running') {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);
        whack(holeAt(x, y));
    } else if (state === 'idle' || state === 'over') {
        startGame();
    }
});

btnStart.addEventListener('click', e => {
    e.stopPropagation();
    if (state === 'paused') resumeGame();
    else startGame();
});

// --- Init ---
best = parseInt(localStorage.getItem('whackamole-best') || '0', 10);
bestEl.textContent = best;
state = 'idle';
score = 0;
timeLeft = GAME_SECONDS;
timeEl.textContent = timeLeft;

// Seed holes so the first draw shows the empty board.
moles = Array.from({ length: HOLES }, () => ({ up: false, until: 0, shownAt: 0 }));
draw();
