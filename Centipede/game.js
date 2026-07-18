// --- Grid geometry ---
const COLS = 25;
const ROWS = 30;
const CELL = 20;            // pixels per grid cell → 500 × 600 canvas
const PLAYER_TOP = ROWS - 6; // shooter is confined to the bottom 6 rows (rows 24–29)

// --- Tuning ---
const TICK_MS = 100;         // one logic tick
const BASE_CENT_TICKS = 2;   // centipede advances every N ticks at level 1
const BULLET_STEP = 2;       // cells a bullet climbs per tick
const MUSHROOM_HP = 4;       // hits to destroy a mushroom
const INITIAL_MUSHROOMS = 30;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- Colors ---
const CLR = {
    bg:        '#0b0f14',
    grid:      '#12181f',
    zone:      '#161b22',
    mushroom:  ['#0b0f14', '#5a3a2a', '#8a5a36', '#b07a42', '#d99a58'], // by health 0..4
    centBody:  '#7ee787',
    centHead:  '#d2ffd6',
    player:    '#58a6ff',
    playerGlow:'#58a6ff66',
    bullet:    '#f2cc60',
};

// --- Input mapping ---
const MOVE = {
    ArrowLeft:  { x: -1, y: 0 },
    ArrowRight: { x:  1, y: 0 },
    ArrowUp:    { x:  0, y: -1 },
    ArrowDown:  { x:  0, y: 1 },
    a: { x: -1, y: 0 },
    d: { x:  1, y: 0 },
    w: { x:  0, y: -1 },
    s: { x:  0, y: 1 },
};

// --- State ---
let player, bullets, centipede, mushrooms;
let score, best, lives, level, state;
let centStepTicks, centTickCount, lastTime, animId;

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

// --- Mushroom field ---
function makeGrid() {
    const g = [];
    for (let y = 0; y < ROWS; y++) g.push(new Array(COLS).fill(0));
    return g;
}

function clearMushrooms() {
    for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++)
            mushrooms[y][x] = 0;
}

function initMushrooms() {
    mushrooms = makeGrid();
    // Scatter mushrooms across the upper field, clear of the player zone.
    for (let i = 0; i < INITIAL_MUSHROOMS; i++) {
        const x = Math.floor(Math.random() * COLS);
        const y = 2 + Math.floor(Math.random() * (PLAYER_TOP - 4));
        mushrooms[y][x] = MUSHROOM_HP;
    }
}

function addMushroom(x, y) {
    if (y >= 0 && y < ROWS && x >= 0 && x < COLS) mushrooms[y][x] = MUSHROOM_HP;
}

// --- Centipede ---
function spawnCentipede() {
    const len = Math.min(COLS, 10 + (level - 1) * 2);
    centipede = [];
    for (let i = 0; i < len; i++) centipede.push({ x: i, y: 0, dir: 1 });
    centStepTicks = Math.max(1, BASE_CENT_TICKS - (level - 1));
    centTickCount = 0;
}

function updateCentipede() {
    for (const s of centipede) {
        const nx = s.x + s.dir;
        const blocked = nx < 0 || nx >= COLS || mushrooms[s.y][nx] > 0;
        if (blocked) {
            if (s.y < ROWS - 1) s.y += 1; // weave down a row
            s.dir *= -1;                   // and reverse
        } else {
            s.x = nx;
        }
    }
    // Reached the shooter?
    if (centipede.some(s => s.x === player.x && s.y === player.y)) {
        loseLife();
    }
}

// --- Bullets ---
function fire() {
    if (bullets.length > 0) return; // one shot on screen at a time
    bullets.push({ x: player.x, y: player.y - 1 });
}

function updateBullets() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        for (let step = 0; step < BULLET_STEP; step++) {
            b.y -= 1;
            if (b.y < 0) { bullets.splice(i, 1); break; }

            // Hit a centipede segment?
            const si = centipede.findIndex(s => s.x === b.x && s.y === b.y);
            if (si !== -1) {
                centipede.splice(si, 1);
                score += 10;
                addMushroom(b.x, b.y); // a mushroom grows where it died
                updateHud();
                bullets.splice(i, 1);
                break;
            }

            // Hit a mushroom?
            if (mushrooms[b.y][b.x] > 0) {
                mushrooms[b.y][b.x] -= 1;
                if (mushrooms[b.y][b.x] === 0) { score += 1; updateHud(); }
                bullets.splice(i, 1);
                break;
            }
        }
    }
}

// --- Lives / waves ---
function loseLife() {
    lives -= 1;
    updateHud();
    if (lives <= 0) { endGame(); return; }
    bullets = [];
    player = { x: Math.floor(COLS / 2), y: ROWS - 1 };
    spawnCentipede();
}

function checkWaveClear() {
    if (centipede.length === 0) {
        score += 100;
        level += 1;
        updateHud();
        spawnCentipede();
    }
}

// --- Main loop ---
function update() {
    updateBullets();
    centTickCount += 1;
    if (centTickCount >= centStepTicks) {
        centTickCount = 0;
        updateCentipede();
    }
    checkWaveClear();
}

function loop(ts) {
    if (state !== 'running') return;
    if (lastTime === null) lastTime = ts;
    if (ts - lastTime >= TICK_MS) {
        lastTime = ts;
        update();
    }
    draw();
    animId = requestAnimationFrame(loop);
}

// --- Lifecycle ---
function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    player = { x: Math.floor(COLS / 2), y: ROWS - 1 };
    bullets = [];
    initMushrooms();
    spawnCentipede();
    state = 'running';
    lastTime = null;
    updateHud();
    overlay.classList.remove('visible');
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        localStorage.setItem('centipede-best', best);
    }
    updateHud();
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
    lastTime = null;
    overlay.classList.remove('visible');
    animId = requestAnimationFrame(loop);
}

function updateHud() {
    scoreEl.textContent = score;
    livesEl.textContent = lives;
    bestEl.textContent = best;
}

// --- Rendering ---
function draw() {
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Player zone tint
    ctx.fillStyle = CLR.zone;
    ctx.fillRect(0, PLAYER_TOP * CELL, canvas.width, (ROWS - PLAYER_TOP) * CELL);

    // Faint grid
    ctx.strokeStyle = CLR.grid;
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= COLS; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CELL, 0);
        ctx.lineTo(x * CELL, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CELL);
        ctx.lineTo(canvas.width, y * CELL);
        ctx.stroke();
    }

    // Mushrooms
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const hp = mushrooms[y][x];
            if (hp > 0) {
                ctx.fillStyle = CLR.mushroom[hp];
                roundRect(x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6, 4);
            }
        }
    }

    // Bullets
    ctx.fillStyle = CLR.bullet;
    for (const b of bullets) {
        ctx.fillRect(b.x * CELL + CELL / 2 - 2, b.y * CELL + 2, 4, CELL - 4);
    }

    // Centipede
    for (let i = 0; i < centipede.length; i++) {
        const s = centipede[i];
        ctx.fillStyle = i === 0 ? CLR.centHead : CLR.centBody;
        circle(s.x * CELL + CELL / 2, s.y * CELL + CELL / 2, CELL / 2 - 2);
    }

    // Player (a little blaster triangle)
    if (player) {
        const px = player.x * CELL;
        const py = player.y * CELL;
        ctx.save();
        ctx.shadowColor = CLR.playerGlow;
        ctx.shadowBlur = 10;
        ctx.fillStyle = CLR.player;
        ctx.beginPath();
        ctx.moveTo(px + CELL / 2, py + 2);
        ctx.lineTo(px + CELL - 3, py + CELL - 3);
        ctx.lineTo(px + 3, py + CELL - 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
}

function circle(cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
}

// --- Input ---
function isStartKey(k) {
    return MOVE[k] !== undefined || k === ' ' || k === 'Spacebar';
}

document.addEventListener('keydown', e => {
    const k = e.key;

    if (state === 'idle' || state === 'over') {
        if (isStartKey(k)) {
            startGame();
            e.preventDefault();
        }
        return;
    }

    if (state === 'paused') {
        if (k === 'p' || k === 'P') resumeGame();
        return;
    }

    // running
    if (k === 'p' || k === 'P') { pauseGame(); return; }

    if (k === ' ' || k === 'Spacebar') { fire(); e.preventDefault(); return; }

    const mv = MOVE[k];
    if (mv) {
        player.x = clamp(player.x + mv.x, 0, COLS - 1);
        player.y = clamp(player.y + mv.y, PLAYER_TOP, ROWS - 1);
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// --- Init (idle preview) ---
best = parseInt(localStorage.getItem('centipede-best') || '0', 10);
score = 0;
lives = 3;
level = 1;
state = 'idle';
player = { x: Math.floor(COLS / 2), y: ROWS - 1 };
bullets = [];
initMushrooms();
spawnCentipede();
updateHud();
draw();
