// Boulder Dash — dig through the earth, collect diamonds, and escape without
// getting crushed by a falling boulder.
//
// The world is a tile grid. The player acts on key presses; the world's
// falling-rock physics advance on a fixed timer via a discrete `step()`.
// State lives in top-level (global-scope) variables and the simulation is
// separated from rendering, so the Playwright tests can carve an exact grid,
// call `step()` / `movePlayer()` directly, and assert on the result — with no
// reliance on wall-clock timing.

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------
const EMPTY = 0;
const DIRT = 1;
const WALL = 2;
const BOULDER = 3;
const DIAMOND = 4;
const EXIT = 5;

// ---------------------------------------------------------------------------
// Board constants
// ---------------------------------------------------------------------------
const COLS = 20;
const ROWS = 14;
const TILE = 32;

const DIAMOND_POINTS = 25;
const DIAMONDS_REQUIRED = 7;   // quota that unlocks the exit
const STEP_S = 0.15;           // seconds between physics ticks
const BEST_KEY = 'boulderdash-best';

// A fixed, hand-designed level. Deterministic, so every run starts the same.
//   W wall   . dirt   O boulder   * diamond   P player   E exit   (space) empty
const LEVEL = [
    'WWWWWWWWWWWWWWWWWWWW',
    'WP.......O..*......W',
    'W..O....*....O.....W',
    'W.....*...O......O.W',
    'W..O......*.....O..W',
    'W......O.....*.....W',
    'W..*......O....O...W',
    'W.....O......*....OW',
    'W..O....*.....O....W',
    'W......*....O......W',
    'W...O......*....O..W',
    'W.....O....*...O...W',
    'W..........*.....E.W',
    'WWWWWWWWWWWWWWWWWWWW',
];

const CHAR_TO_TILE = { 'W': WALL, '.': DIRT, 'O': BOULDER, '*': DIAMOND, 'E': EXIT, ' ': EMPTY, 'P': EMPTY };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = 'ready';           // 'ready' | 'running' | 'paused' | 'won' | 'over'
let grid = [];                 // grid[y][x]
let player = { x: 1, y: 1 };
let score = 0;
let collected = 0;
let best = 0;
let falling = new Set();       // keys of cells whose object is currently falling
let acc = 0;

function key(x, y) { return y * COLS + x; }

// ---------------------------------------------------------------------------
// Level setup
// ---------------------------------------------------------------------------
function loadLevel() {
    grid = [];
    for (let y = 0; y < ROWS; y++) {
        const row = [];
        for (let x = 0; x < COLS; x++) {
            const ch = LEVEL[y][x];
            row.push(CHAR_TO_TILE[ch]);
            if (ch === 'P') { player = { x, y }; }
        }
        grid.push(row);
    }
    falling = new Set();
}

// ---------------------------------------------------------------------------
// Player action
// ---------------------------------------------------------------------------
function movePlayer(dx, dy) {
    if (state !== 'running') return;
    const nx = player.x + dx, ny = player.y + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return;

    const t = grid[ny][nx];

    if (t === WALL) return;

    if (t === BOULDER) {
        if (dy !== 0) return;                 // boulders only shove sideways
        const bx = nx + dx;
        if (bx < 0 || bx >= COLS) return;
        if (grid[ny][bx] !== EMPTY) return;   // no room behind it
        grid[ny][bx] = BOULDER;
        grid[ny][nx] = EMPTY;
        player.x = nx; player.y = ny;
        return;
    }

    if (t === EXIT) {
        if (exitOpen()) win();
        return;                               // a locked exit is a wall
    }

    if (t === DIRT) grid[ny][nx] = EMPTY;     // dig
    if (t === DIAMOND) {                       // collect
        grid[ny][nx] = EMPTY;
        collected++;
        score += DIAMOND_POINTS;
    }
    player.x = nx; player.y = ny;
    syncHud();
}

function exitOpen() {
    return collected >= DIAMONDS_REQUIRED;
}

// ---------------------------------------------------------------------------
// Physics — one discrete tick. Boulders and diamonds fall into empty space and
// roll off rounded objects. A falling object that reaches the player crushes
// them. Processed bottom-up so each object settles before the one above it.
// ---------------------------------------------------------------------------
function roundable(t) { return t === BOULDER || t === DIAMOND; }

function step() {
    const g = grid;
    const next = new Set();
    let killed = false;

    for (let y = ROWS - 2; y >= 0; y--) {
        for (let x = 0; x < COLS; x++) {
            const t = g[y][x];
            if (t !== BOULDER && t !== DIAMOND) continue;

            const wasFalling = falling.has(key(x, y));
            const belowIsPlayer = (player.x === x && player.y === y + 1);
            const below = g[y + 1][x];

            if (below === EMPTY && !belowIsPlayer) {
                // Fall straight down one cell.
                g[y + 1][x] = t;
                g[y][x] = EMPTY;
                next.add(key(x, y + 1));
            } else if (belowIsPlayer && wasFalling) {
                // A boulder that was already falling lands on the player.
                killed = true;
            } else if (roundable(below)) {
                // Rest is a rounded object → try to roll off it.
                const clear = (cx, cy) =>
                    g[cy][cx] === EMPTY && !(player.x === cx && player.y === cy);
                if (x > 0 && clear(x - 1, y) && clear(x - 1, y + 1)) {
                    g[y][x - 1] = t; g[y][x] = EMPTY; next.add(key(x - 1, y));
                } else if (x < COLS - 1 && clear(x + 1, y) && clear(x + 1, y + 1)) {
                    g[y][x + 1] = t; g[y][x] = EMPTY; next.add(key(x + 1, y));
                }
            }
        }
    }

    falling = next;
    if (killed) gameOver();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function startGame() {
    loadLevel();
    score = 0;
    collected = 0;
    acc = 0;
    state = 'running';
    overlay.classList.remove('visible');
    syncHud();
    render();
}

function win() {
    state = 'won';
    recordBest();
    overlayTitle.textContent = 'You Escaped!';
    overlayScore.textContent = 'Score: ' + score;
    overlaySub.textContent = 'Press Space or the button to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function gameOver() {
    state = 'over';
    recordBest();
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = 'Score: ' + score;
    overlaySub.textContent = 'A boulder got you — press Space to try again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function recordBest() {
    if (score > best) {
        best = score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
    }
    bestEl.textContent = String(best);
}

function pauseGame() {
    if (state !== 'running') return;
    state = 'paused';
    overlayTitle.textContent = 'Paused';
    overlayScore.textContent = '';
    overlaySub.textContent = 'Press P to resume';
    overlay.classList.add('visible');
}

function resumeGame() {
    if (state !== 'paused') return;
    state = 'running';
    acc = 0;
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// DOM handles
// ---------------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const collectedEl = document.getElementById('collected');
const requiredEl = document.getElementById('required');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

function syncHud() {
    scoreEl.textContent = String(score);
    collectedEl.textContent = String(collected);
    requiredEl.textContent = String(DIAMONDS_REQUIRED);
    bestEl.textContent = String(best);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            drawTile(x, y, grid[y][x]);
        }
    }
    drawPlayer(player.x, player.y);
}

function drawTile(x, y, t) {
    const px = x * TILE, py = y * TILE;
    switch (t) {
        case DIRT:
            ctx.fillStyle = '#5a3d24';
            ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = 'rgba(0,0,0,0.18)';
            for (let i = 0; i < 4; i++) {
                ctx.fillRect(px + 6 + (i * 7) % TILE, py + 5 + (i * 11) % TILE, 2, 2);
            }
            break;
        case WALL:
            ctx.fillStyle = '#8a8a8a';
            ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = '#6f6f6f';
            ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
            break;
        case BOULDER:
            ctx.fillStyle = '#0d0a08';
            ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = '#b9b3a6';
            ctx.beginPath();
            ctx.arc(px + TILE / 2, py + TILE / 2, TILE / 2 - 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.beginPath();
            ctx.arc(px + TILE / 2 - 5, py + TILE / 2 - 5, 4, 0, Math.PI * 2);
            ctx.fill();
            break;
        case DIAMOND:
            ctx.fillStyle = '#0d0a08';
            ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = '#4fe0ff';
            ctx.beginPath();
            ctx.moveTo(px + TILE / 2, py + 5);
            ctx.lineTo(px + TILE - 6, py + TILE / 2);
            ctx.lineTo(px + TILE / 2, py + TILE - 5);
            ctx.lineTo(px + 6, py + TILE / 2);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.beginPath();
            ctx.moveTo(px + TILE / 2, py + 8);
            ctx.lineTo(px + TILE / 2 + 6, py + TILE / 2 - 3);
            ctx.lineTo(px + TILE / 2, py + TILE / 2);
            ctx.closePath();
            ctx.fill();
            break;
        case EXIT:
            ctx.fillStyle = exitOpen() ? '#ffcf5c' : '#2a2018';
            ctx.fillRect(px, py, TILE, TILE);
            ctx.strokeStyle = exitOpen() ? '#fff2c0' : '#5a4a34';
            ctx.lineWidth = 3;
            ctx.strokeRect(px + 4, py + 4, TILE - 8, TILE - 8);
            break;
        default: // EMPTY
            ctx.fillStyle = '#0d0a08';
            ctx.fillRect(px, py, TILE, TILE);
    }
}

function drawPlayer(x, y) {
    const px = x * TILE, py = y * TILE;
    ctx.fillStyle = '#0d0a08';
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = '#ff5a3c';
    ctx.beginPath();
    ctx.arc(px + TILE / 2, py + TILE / 2, TILE / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(px + TILE / 2 - 5, py + TILE / 2 - 3, 4, 0, Math.PI * 2);
    ctx.arc(px + TILE / 2 + 5, py + TILE / 2 - 3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d0a08';
    ctx.beginPath();
    ctx.arc(px + TILE / 2 - 5, py + TILE / 2 - 3, 2, 0, Math.PI * 2);
    ctx.arc(px + TILE / 2 + 5, py + TILE / 2 - 3, 2, 0, Math.PI * 2);
    ctx.fill();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastTime = 0;
function loop(t) {
    if (!lastTime) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.1) dt = 0.1;
    if (state === 'running') {
        acc += dt;
        while (acc >= STEP_S) {
            acc -= STEP_S;
            step();
            if (state !== 'running') break;
        }
        syncHud();
    }
    render();
    requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
    switch (e.key) {
        case 'ArrowLeft': case 'a': case 'A': movePlayer(-1, 0); e.preventDefault(); break;
        case 'ArrowRight': case 'd': case 'D': movePlayer(1, 0); e.preventDefault(); break;
        case 'ArrowUp': case 'w': case 'W': movePlayer(0, -1); e.preventDefault(); break;
        case 'ArrowDown': case 's': case 'S': movePlayer(0, 1); e.preventDefault(); break;
        case ' ': case 'Spacebar':
            if (state === 'ready' || state === 'over' || state === 'won') startGame();
            e.preventDefault();
            break;
        case 'p': case 'P':
            if (state === 'running') pauseGame();
            else if (state === 'paused') resumeGame();
            break;
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
loadLevel();          // show the level behind the start overlay
syncHud();
render();
requestAnimationFrame(loop);

// Every binding above is a top-level let/const/function, so it lives in the
// global scope and the Playwright suite drives it directly by name
// (`grid`, `player`, `step`, `movePlayer`, …) — the convention the other games
// in this repo follow.
