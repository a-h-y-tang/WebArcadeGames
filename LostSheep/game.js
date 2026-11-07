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

// Colors: a green pasture, a shepherd leading his flock, and a lost lamb
const CLR = {
    bg:        '#1f3d24',
    grid:      '#26482b',
    snakeHead: '#a16207',   // the shepherd's cloak
    snakeBody: '#f8fafc',   // the flock's wool
    food:      '#fef9c3',   // the lost lamb
    foodGlow:  '#fde68a99',
    face:      '#1f2937',
    skin:      '#fcd9b6',
    staff:     '#78350f',
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

    // The lost lamb, with a warm glow so it is easy to spot
    ctx.shadowColor = CLR.foodGlow;
    ctx.shadowBlur = 14;
    drawSheep(food.x, food.y, CLR.food, 0.8);
    ctx.shadowBlur = 0;

    // The flock following the shepherd (tail → neck, skip head)
    for (let i = 1; i < snake.length; i++) {
        drawSheep(snake[i].x, snake[i].y, CLR.snakeBody, 1);
    }

    // The shepherd at the front
    drawShepherd(snake[0].x, snake[0].y);
}

// A woolly sheep: a cluster of fleece puffs and a dark face.
function drawSheep(cx, cy, wool, scale) {
    const x = cx * CELL + CELL / 2;
    const y = cy * CELL + CELL / 2;
    const r = (CELL / 4.2) * scale;
    ctx.fillStyle = wool;
    for (const [dx, dy] of [[-1, -0.6], [1, -0.6], [-1, 0.6], [1, 0.6], [0, 0]]) {
        ctx.beginPath();
        ctx.arc(x + dx * r * 0.8, y + dy * r * 0.8, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = CLR.face;
    ctx.beginPath();
    ctx.ellipse(x + r * 1.2, y, r * 0.55, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
}

// The shepherd: a brown cloak, a face, and a crook over the shoulder.
function drawShepherd(cx, cy) {
    const x = cx * CELL;
    const y = cy * CELL;
    ctx.fillStyle = CLR.snakeHead;
    roundRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 6);
    ctx.fillStyle = CLR.skin;
    ctx.beginPath();
    ctx.arc(x + CELL / 2, y + CELL / 2, CELL / 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = CLR.staff;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + CELL - 4, y + CELL - 2);
    ctx.lineTo(x + CELL - 4, y + 5);
    ctx.arc(x + CELL - 7, y + 5, 3, 0, Math.PI, true);
    ctx.stroke();
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
