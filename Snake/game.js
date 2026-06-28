const COLS = 20;
const ROWS = 20;
const CELL = 25; // pixels per grid cell

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// Directions as unit vectors
const DIR = {
    ArrowUp:    { x: 0, y: -1 },
    ArrowDown:  { x: 0, y:  1 },
    ArrowLeft:  { x: -1, y: 0 },
    ArrowRight: { x:  1, y: 0 },
    w: { x: 0, y: -1 },
    s: { x: 0, y:  1 },
    a: { x: -1, y: 0 },
    d: { x:  1, y: 0 },
};

const OPPOSITE = {
    ArrowUp: 'ArrowDown', ArrowDown: 'ArrowUp',
    ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft',
    w: 's', s: 'w', a: 'd', d: 'a',
};

// Colors
const CLR = {
    bg:        '#0d1117',
    grid:      '#161b22',
    snakeHead: '#86efac',
    snakeBody: '#22c55e',
    food:      '#ef4444',
    foodGlow:  '#ef444466',
};

// --- State ---
let snake, dir, pendingDir, food, score, best, state, lastTime, animId;

function speedMs(s) {
    // Starts at 150ms, floors at 70ms as score climbs
    return Math.max(70, 150 - s * 4);
}

function randomCell(exclude) {
    let pos;
    do {
        pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    } while (exclude.some(s => s.x === pos.x && s.y === pos.y));
    return pos;
}

function startGame() {
    snake = [
        { x: 10, y: 10 },
        { x: 9,  y: 10 },
        { x: 8,  y: 10 },
    ];
    dir = DIR.ArrowRight;
    pendingDir = null;
    score = 0;
    food = randomCell(snake);
    state = 'running';
    lastTime = null;

    scoreEl.textContent = score;
    overlay.classList.remove('visible');

    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('snake-best', best);
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} pts`;
    overlaySub.textContent = 'Press an arrow key or WASD to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

// --- Game loop (timestamp-driven, not setInterval) ---
function loop(timestamp) {
    if (state !== 'running') return;

    if (!lastTime) lastTime = timestamp;
    const elapsed = timestamp - lastTime;

    if (elapsed >= speedMs(score)) {
        lastTime = timestamp;
        tick();
    }

    draw();
    animId = requestAnimationFrame(loop);
}

function tick() {
    if (pendingDir) {
        dir = pendingDir;
        pendingDir = null;
    }

    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // Wall collision
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
        endGame();
        return;
    }

    // Self collision (skip tail tip — it moves away this tick)
    for (let i = 0; i < snake.length - 1; i++) {
        if (snake[i].x === head.x && snake[i].y === head.y) {
            endGame();
            return;
        }
    }

    snake.unshift(head);

    if (head.x === food.x && head.y === food.y) {
        score++;
        scoreEl.textContent = score;
        food = randomCell(snake);
        // Don't pop: snake grows by one segment
    } else {
        snake.pop();
    }
}

// --- Rendering ---
function draw() {
    // Background
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle grid
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

    // Food with glow
    ctx.shadowColor = CLR.foodGlow;
    ctx.shadowBlur = 12;
    ctx.fillStyle = CLR.food;
    roundRect(ctx, food.x * CELL + 3, food.y * CELL + 3, CELL - 6, CELL - 6, 4);
    ctx.shadowBlur = 0;

    // Snake body (tail → neck, skip head)
    ctx.fillStyle = CLR.snakeBody;
    for (let i = 1; i < snake.length; i++) {
        roundRect(ctx, snake[i].x * CELL + 1, snake[i].y * CELL + 1, CELL - 2, CELL - 2, 4);
    }

    // Snake head (slightly different color)
    ctx.fillStyle = CLR.snakeHead;
    roundRect(ctx, snake[0].x * CELL + 1, snake[0].y * CELL + 1, CELL - 2, CELL - 2, 5);
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
}

// --- Input ---
document.addEventListener('keydown', e => {
    // Start / restart from overlay
    if (state !== 'running' && DIR[e.key]) {
        startGame();
        // Apply the key that started the game as the first direction
        const d = DIR[e.key];
        dir = d;
        return;
    }

    // Pause
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running') {
            state = 'paused';
            overlayTitle.textContent = 'Paused';
            overlayScore.textContent = '';
            overlaySub.textContent = 'Press P to resume';
            btnStart.textContent = 'Resume';
            overlay.classList.add('visible');
        } else if (state === 'paused') {
            resumeGame();
        }
        return;
    }

    // Direction — queue one pending change; reject reversal
    if (state === 'running' && DIR[e.key]) {
        const currentKey = Object.keys(DIR).find(k => DIR[k] === dir);
        if (e.key !== OPPOSITE[currentKey]) {
            pendingDir = DIR[e.key];
        }
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') {
        resumeGame();
    } else {
        startGame();
    }
});

function resumeGame() {
    state = 'running';
    lastTime = null;
    overlay.classList.remove('visible');
    animId = requestAnimationFrame(loop);
}

// --- Init ---
best = parseInt(localStorage.getItem('snake-best') || '0', 10);
bestEl.textContent = best;
state = 'idle';

// Seed state before first draw so draw() has valid snake/food/dir
snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
food = { x: 14, y: 10 };
dir = DIR.ArrowRight;
draw();
