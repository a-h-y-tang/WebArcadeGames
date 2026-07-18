// --- Field & grid ---
const WIDTH = 500;
const HEIGHT = 500;
const GRID = 3;                 // 3×3
const HOLE_COUNT = GRID * GRID; // 9

// --- Tuning (time in milliseconds) ---
const GAME_TIME = 30000;        // total round length
const HIT_POINTS = 10;          // points per successful whack
const MOLE_UP_TIME = 1200;      // how long a mole stays up at level 1
const HIT_FLASH = 160;          // how long a bopped mole shows before clearing
const SPAWN_BASE = 900;         // base gap between spawns at level 1
const LEVEL_EVERY = 10000;      // a new level every 10s of play

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const timeEl = document.getElementById('time');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let holes, score, best, timeLeft, level, misses, elapsed, state;
let spawnTimer, autoSpawn, lastTime, animId;

// -----------------------------------------------------------------------
// Difficulty curves
// -----------------------------------------------------------------------
function moleUpTime() {
    return Math.max(500, MOLE_UP_TIME - (level - 1) * 180);
}

function spawnInterval() {
    return Math.max(350, SPAWN_BASE - (level - 1) * 150);
}

function levelForElapsed(ms) {
    return 1 + Math.floor(ms / LEVEL_EVERY);
}

// -----------------------------------------------------------------------
// Grid setup
// -----------------------------------------------------------------------
function buildHoles() {
    holes = [];
    const cellW = WIDTH / GRID;
    const cellH = HEIGHT / GRID;
    const r = Math.min(cellW, cellH) * 0.3;
    for (let i = 0; i < HOLE_COUNT; i++) {
        const row = Math.floor(i / GRID);
        const col = i % GRID;
        holes.push({
            index: i,
            x: (col + 0.5) * cellW,
            y: (row + 0.5) * cellH,
            r,
            state: 'empty', // 'empty' | 'up' | 'hit'
            timer: 0,
        });
    }
}

function holeAt(x, y) {
    for (const h of holes) {
        if (Math.hypot(x - h.x, y - h.y) <= h.r) return h.index;
    }
    return -1;
}

// -----------------------------------------------------------------------
// Moles
// -----------------------------------------------------------------------
function popMole(i) {
    const h = holes[i];
    if (!h || h.state !== 'empty') return;
    h.state = 'up';
    h.timer = moleUpTime();
}

function spawnRandomMole() {
    const empty = holes.filter(h => h.state === 'empty');
    if (empty.length === 0) return;
    const h = empty[Math.floor(Math.random() * empty.length)];
    popMole(h.index);
}

function whack(i) {
    if (state !== 'running') return false;
    const h = holes[i];
    if (!h || h.state !== 'up') return false;
    h.state = 'hit';
    h.timer = HIT_FLASH;
    score += HIT_POINTS;
    scoreEl.textContent = score;
    return true;
}

// -----------------------------------------------------------------------
// Game lifecycle
// -----------------------------------------------------------------------
function updateTime() {
    timeEl.textContent = Math.ceil(timeLeft / 1000);
}

function startGame() {
    score = 0;
    level = 1;
    misses = 0;
    timeLeft = GAME_TIME;
    elapsed = 0;
    autoSpawn = true;
    spawnTimer = spawnInterval();
    buildHoles();
    state = 'running';

    scoreEl.textContent = score;
    levelEl.textContent = level;
    updateTime();
    overlay.classList.remove('visible');

    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('whack-a-mole-best', best);
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} pts`;
    overlaySub.textContent = 'Press Space to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function pauseGame() {
    state = 'paused';
    overlayTitle.textContent = 'Paused';
    overlayScore.textContent = '';
    overlaySub.textContent = 'Press P to resume';
    btnStart.textContent = 'Resume';
    overlay.classList.add('visible');
}

function resumeGame() {
    state = 'running';
    overlay.classList.remove('visible');
    lastTime = null;
    animId = requestAnimationFrame(loop);
}

// -----------------------------------------------------------------------
// Simulation — advance everything by dt milliseconds
// -----------------------------------------------------------------------
function step(dt) {
    if (state !== 'running') return;

    // Game clock
    timeLeft -= dt;
    if (timeLeft <= 0) {
        timeLeft = 0;
        updateTime();
        endGame();
        return;
    }
    updateTime();

    // Level progression
    elapsed += dt;
    const lvl = levelForElapsed(elapsed);
    if (lvl !== level) {
        level = lvl;
        levelEl.textContent = level;
    }

    // Mole timers
    for (const h of holes) {
        if (h.state === 'up') {
            h.timer -= dt;
            if (h.timer <= 0) {
                h.state = 'empty';
                misses++;
            }
        } else if (h.state === 'hit') {
            h.timer -= dt;
            if (h.timer <= 0) h.state = 'empty';
        }
    }

    // Spawning
    if (autoSpawn) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            spawnRandomMole();
            spawnTimer = spawnInterval();
        }
    }
}

// -----------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------
function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const frameDt = Math.min(50, timestamp - lastTime); // clamp big gaps
    lastTime = timestamp;

    if (state === 'running') step(frameDt);
    draw();

    if (state === 'running') animId = requestAnimationFrame(loop);
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function draw() {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    for (const h of holes) {
        drawHole(h);
    }
}

function drawHole(h) {
    // Pit
    ctx.fillStyle = '#161b22';
    ctx.beginPath();
    ctx.ellipse(h.x, h.y + h.r * 0.35, h.r, h.r * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth = 3;
    ctx.stroke();

    if (h.state === 'up' || h.state === 'hit') {
        drawMole(h);
    }

    // Faint number key hint
    ctx.fillStyle = '#30363d';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(h.index + 1), h.x, h.y + h.r + 18);
}

function drawMole(h) {
    const hit = h.state === 'hit';
    const bodyR = h.r * 0.72;
    const cy = h.y - h.r * 0.15;

    // Body
    ctx.fillStyle = hit ? '#f59e0b' : '#a3e635';
    ctx.shadowColor = hit ? '#f59e0baa' : '#a3e63588';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(h.x, cy, bodyR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Snout
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.ellipse(h.x, cy + bodyR * 0.35, bodyR * 0.5, bodyR * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    const eyeDx = bodyR * 0.35;
    const eyeY = cy - bodyR * 0.2;
    ctx.strokeStyle = '#0d1117';
    ctx.lineWidth = 3;
    if (hit) {
        // dizzy X eyes
        for (const dx of [-eyeDx, eyeDx]) {
            ctx.beginPath();
            ctx.moveTo(h.x + dx - 4, eyeY - 4);
            ctx.lineTo(h.x + dx + 4, eyeY + 4);
            ctx.moveTo(h.x + dx + 4, eyeY - 4);
            ctx.lineTo(h.x + dx - 4, eyeY + 4);
            ctx.stroke();
        }
    } else {
        ctx.fillStyle = '#0d1117';
        for (const dx of [-eyeDx, eyeDx]) {
            ctx.beginPath();
            ctx.arc(h.x + dx, eyeY, 3.2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
document.addEventListener('keydown', e => {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    if (state !== 'running' && state !== 'paused' && k === ' ') {
        startGame();
        e.preventDefault();
        return;
    }

    if (state === 'running' && k >= '1' && k <= '9') {
        whack(parseInt(k, 10) - 1);
        e.preventDefault();
    }
});

canvas.addEventListener('click', e => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (WIDTH / rect.width);
    const my = (e.clientY - rect.top) * (HEIGHT / rect.height);
    const idx = holeAt(mx, my);
    if (idx >= 0) whack(idx);
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
best = parseInt(localStorage.getItem('whack-a-mole-best') || '0', 10);
bestEl.textContent = best;
score = 0;
level = 1;
misses = 0;
timeLeft = GAME_TIME;
elapsed = 0;
autoSpawn = true;
state = 'idle';
buildHoles();
updateTime();
draw();
