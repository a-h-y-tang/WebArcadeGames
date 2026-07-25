// --- Grid & timing constants ---
const COLS = 13;
const ROWS = 15;
const CELL = 30;
const WIDTH = COLS * CELL;   // 390
const HEIGHT = ROWS * CELL;  // 450

const START_LIVES = 3;

// Cadences, in milliseconds. Motion is advanced by step(dt) so the simulation
// is frame-rate independent and the tests can drive it deterministically.
const PLAYER_STEP_MS = 110;  // one dig-step while a direction is held
const ENEMY_STEP_MS = 340;   // monsters are slower than the digger
const ROCK_FALL_MS = 90;     // one cell of falling per tick
const GHOST_MS = 2200;       // time a sealed-off monster waits before ghosting
const DEFLATE_MS = 600;      // an un-pumped monster loses one inflation step

const HARPOON_RANGE = 3;     // cells the harpoon can reach through tunnel
const INFLATE_MAX = 4;       // pumps needed to pop a monster

const POP_SCORE = 200;
const CRUSH_SCORE = 350;

const ROCK_COUNT = 4;

const DIR_LIST = [
    { name: 'up', dr: -1, dc: 0 },
    { name: 'down', dr: 1, dc: 0 },
    { name: 'left', dr: 0, dc: -1 },
    { name: 'right', dr: 0, dc: 1 },
];
const DIRS = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 },
};

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let state, grid, player, enemies, rocks, score, best, lives, level;
let lastTime, animId, clock;
let playerMoveAccum, enemyMoveAccum;
let harpoon = { cells: [], timer: 0 };
const keys = {};

// -----------------------------------------------------------------------
// Seeded RNG (mulberry32) — keeps level generation self-contained.
// -----------------------------------------------------------------------
let rngState = 0x9e3779b9;
function seedRng(s) { rngState = s >>> 0; }
function rand() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randInt(n) { return Math.floor(rand() * n); }

// -----------------------------------------------------------------------
// Grid helpers
// -----------------------------------------------------------------------
function inBounds(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
function isDug(r, c) { return inBounds(r, c) && grid[r][c] === true; }
function hasRock(r, c) { return rocks.some(rk => rk.r === r && rk.c === c); }
function enemyAt(r, c) { return enemies.find(e => e.r === r && e.c === c) || null; }

// -----------------------------------------------------------------------
// Level generation
// -----------------------------------------------------------------------
function makeGrid() {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
        const row = new Array(COLS).fill(false);
        grid.push(row);
    }
    // The top row is open surface/sky.
    for (let c = 0; c < COLS; c++) grid[0][c] = true;
}

function generateLevel(lv) {
    makeGrid();
    rocks = [];
    enemies = [];

    const startC = Math.floor(COLS / 2);
    player = { r: 0, c: startC, dir: 'down' };
    grid[0][startC] = true;
    // A short starting shaft so the digger can drop in.
    grid[1][startC] = true;

    // Rocks: embedded in soil with soil directly beneath (so they rest).
    let attempts = 0;
    while (rocks.length < ROCK_COUNT && attempts < 200) {
        attempts++;
        const r = 3 + randInt(ROWS - 5);
        const c = randInt(COLS);
        if (grid[r][c]) continue;                 // not in a tunnel
        if (c === startC && r <= 2) continue;     // not in the entry shaft
        if (hasRock(r, c)) continue;
        if (inBounds(r + 1, c) && grid[r + 1][c]) continue; // must be supported
        rocks.push({ r, c, falling: false, fallAccum: 0, fell: false });
    }

    // Monsters: each sits in its own little dug pocket, away from the surface.
    // Two on the opening level, one more with every level after.
    const count = 1 + lv;
    attempts = 0;
    while (enemies.length < count && attempts < 400) {
        attempts++;
        const r = 4 + randInt(ROWS - 5);
        const c = randInt(COLS);
        if (hasRock(r, c)) continue;
        if (enemies.some(e => e.r === r && e.c === c)) continue;
        if (Math.abs(r - player.r) + Math.abs(c - player.c) < 4) continue;
        grid[r][c] = true; // carve the pocket
        enemies.push({ r, c, inflate: 0, spawnR: r, spawnC: c, ghostTimer: 0, lastPump: -1e9 });
    }
}

// -----------------------------------------------------------------------
// Player movement & digging
// -----------------------------------------------------------------------
function movePlayer(dir) {
    player.dir = dir;
    const { dr, dc } = DIRS[dir];
    const nr = player.r + dr;
    const nc = player.c + dc;
    if (!inBounds(nr, nc)) return false;
    if (hasRock(nr, nc)) return false;

    player.r = nr;
    player.c = nc;
    grid[nr][nc] = true; // dig the tunnel

    // Walking straight into a monster gets you caught.
    if (enemyAt(nr, nc)) loseLife();
    return true;
}

// -----------------------------------------------------------------------
// Harpoon / pump
// -----------------------------------------------------------------------
function pump() {
    if (state !== 'running') return false;
    const { dr, dc } = DIRS[player.dir];
    const cells = [];
    let target = null;
    for (let i = 1; i <= HARPOON_RANGE; i++) {
        const r = player.r + dr * i;
        const c = player.c + dc * i;
        if (!isDug(r, c)) break;   // harpoon stops at soil / edge
        cells.push({ r, c });
        const e = enemyAt(r, c);
        if (e) { target = e; break; }
    }
    harpoon = { cells, timer: 130 };

    if (target) {
        target.inflate += 1;
        target.lastPump = clock;
        if (target.inflate >= INFLATE_MAX) popEnemy(target);
        return true;
    }
    return false;
}

function popEnemy(e) {
    const i = enemies.indexOf(e);
    if (i === -1) return;
    enemies.splice(i, 1);
    score += POP_SCORE;
    updateHud();
    if (enemies.length === 0) nextLevel();
}

// -----------------------------------------------------------------------
// Monsters
// -----------------------------------------------------------------------
function bfsDistFromPlayer() {
    const dist = [];
    for (let r = 0; r < ROWS; r++) dist.push(new Array(COLS).fill(-1));
    const q = [[player.r, player.c]];
    dist[player.r][player.c] = 0;
    let head = 0;
    while (head < q.length) {
        const [r, c] = q[head++];
        for (const { dr, dc } of DIR_LIST) {
            const nr = r + dr;
            const nc = c + dc;
            if (!inBounds(nr, nc) || dist[nr][nc] !== -1) continue;
            if (!isDug(nr, nc) || hasRock(nr, nc)) continue;
            dist[nr][nc] = dist[r][c] + 1;
            q.push([nr, nc]);
        }
    }
    return dist;
}

function ghostStep(e) {
    let best = null;
    let bestD = Infinity;
    for (const { dr, dc } of DIR_LIST) {
        const nr = e.r + dr;
        const nc = e.c + dc;
        if (!inBounds(nr, nc) || hasRock(nr, nc)) continue;
        const d = Math.abs(nr - player.r) + Math.abs(nc - player.c);
        if (d < bestD) { bestD = d; best = [nr, nc]; }
    }
    if (best) { e.r = best[0]; e.c = best[1]; }
}

function moveEnemiesOneStep() {
    const dist = bfsDistFromPlayer();
    for (const e of enemies) {
        if (e.inflate > 0) continue; // frozen while inflated

        let best = null;
        let bestD = Infinity;
        for (const { dr, dc } of DIR_LIST) {
            const nr = e.r + dr;
            const nc = e.c + dc;
            if (!inBounds(nr, nc) || hasRock(nr, nc) || !isDug(nr, nc)) continue;
            if (dist[nr][nc] === -1) continue;
            if (dist[nr][nc] < bestD) { bestD = dist[nr][nc]; best = [nr, nc]; }
        }

        if (best) {
            e.r = best[0];
            e.c = best[1];
            e.ghostTimer = 0;
        } else {
            e.ghostTimer += ENEMY_STEP_MS;
            if (e.ghostTimer >= GHOST_MS) { ghostStep(e); e.ghostTimer = 0; }
        }

        if (e.r === player.r && e.c === player.c) { loseLife(); return; }
    }
}

function stepEnemies(dt) {
    enemyMoveAccum += dt;
    while (enemyMoveAccum >= ENEMY_STEP_MS) {
        enemyMoveAccum -= ENEMY_STEP_MS;
        if (state === 'over') break;
        moveEnemiesOneStep();
    }
}

// -----------------------------------------------------------------------
// Falling rocks
// -----------------------------------------------------------------------
function otherRockAt(r, c, self) {
    return rocks.some(rk => rk !== self && rk.r === r && rk.c === c);
}

function crushAt(r, c) {
    const e = enemyAt(r, c);
    if (e) {
        const i = enemies.indexOf(e);
        enemies.splice(i, 1);
        score += CRUSH_SCORE;
        updateHud();
        if (enemies.length === 0) nextLevel();
    }
    if (player.r === r && player.c === c) loseLife();
}

function stepRocks(dt) {
    for (const rock of [...rocks]) {
        if (!rocks.includes(rock)) continue; // removed by a level regen mid-loop

        if (!rock.falling) {
            const br = rock.r + 1;
            if (inBounds(br, rock.c) && isDug(br, rock.c) && !otherRockAt(br, rock.c, rock)) {
                rock.falling = true;
                rock.fallAccum = 0;
            }
        }

        if (rock.falling) {
            rock.fallAccum += dt;
            while (rock.fallAccum >= ROCK_FALL_MS) {
                rock.fallAccum -= ROCK_FALL_MS;
                const br = rock.r + 1;
                if (inBounds(br, rock.c) && isDug(br, rock.c) && !otherRockAt(br, rock.c, rock)) {
                    grid[rock.r][rock.c] = true; // vacate into tunnel
                    rock.r = br;
                    rock.fell = true;
                    crushAt(rock.r, rock.c);
                    if (!rocks.includes(rock) || state !== 'running') break;
                } else {
                    rock.falling = false;
                    if (rock.fell) removeRock(rock);
                    break;
                }
            }
        }
    }
}

function removeRock(rock) {
    const i = rocks.indexOf(rock);
    if (i !== -1) rocks.splice(i, 1);
}

// -----------------------------------------------------------------------
// Lives & levels
// -----------------------------------------------------------------------
function loseLife() {
    lives -= 1;
    updateHud();
    if (lives <= 0) {
        endGame();
    } else {
        resetPositions();
    }
}

function resetPositions() {
    const startC = Math.floor(COLS / 2);
    player.r = 0;
    player.c = startC;
    player.dir = 'down';
    grid[0][startC] = true;
    grid[1][startC] = true;
    for (const e of enemies) {
        e.r = e.spawnR;
        e.c = e.spawnC;
        e.inflate = 0;
        e.ghostTimer = 0;
        grid[e.r][e.c] = true;
    }
    enemyMoveAccum = 0;
    playerMoveAccum = 0;
}

function nextLevel() {
    level += 1;
    updateHud();
    generateLevel(level);
    enemyMoveAccum = 0;
    playerMoveAccum = 0;
}

// -----------------------------------------------------------------------
// HUD
// -----------------------------------------------------------------------
function updateHud() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    livesEl.textContent = lives;
}

// -----------------------------------------------------------------------
// Game lifecycle
// -----------------------------------------------------------------------
function startGame() {
    seedRng((0x9e3779b9 ^ (performance.now() * 1000)) >>> 0);
    score = 0;
    lives = START_LIVES;
    level = 1;
    clock = 0;
    playerMoveAccum = 0;
    enemyMoveAccum = 0;
    harpoon = { cells: [], timer: 0 };
    for (const k of Object.keys(keys)) keys[k] = false;

    generateLevel(1);
    state = 'running';
    updateHud();
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
        localStorage.setItem('digdug-best', best);
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score}`;
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
// Simulation step
// -----------------------------------------------------------------------
function heldDir() {
    if (keys['up']) return 'up';
    if (keys['down']) return 'down';
    if (keys['left']) return 'left';
    if (keys['right']) return 'right';
    return null;
}

function step(dt) {
    if (state !== 'running') return;
    clock += dt;

    // Player movement from a held direction.
    const dir = heldDir();
    if (dir) {
        playerMoveAccum += dt;
        while (playerMoveAccum >= PLAYER_STEP_MS) {
            playerMoveAccum -= PLAYER_STEP_MS;
            movePlayer(dir);
            if (state !== 'running') return;
        }
    } else {
        playerMoveAccum = 0;
    }

    stepEnemies(dt);
    if (state !== 'running') return;
    stepRocks(dt);

    // Un-pumped monsters slowly deflate and break free.
    for (const e of enemies) {
        if (e.inflate > 0 && clock - e.lastPump >= DEFLATE_MS) {
            e.inflate -= 1;
            e.lastPump = clock;
        }
    }

    if (harpoon.timer > 0) harpoon.timer -= dt;
}

// -----------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------
function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = Math.min(50, timestamp - lastTime);
    lastTime = timestamp;

    if (state === 'running') step(elapsed);
    draw();

    if (state === 'running') animId = requestAnimationFrame(loop);
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function draw() {
    // Terrain.
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = c * CELL;
            const y = r * CELL;
            if (r === 0) {
                ctx.fillStyle = '#13233b'; // sky band
            } else if (grid[r][c]) {
                ctx.fillStyle = '#120a03'; // open tunnel
            } else {
                // Soil, banded darker with depth.
                const band = Math.floor(r / 3);
                const soils = ['#7c4a1e', '#8a5322', '#6d3f18', '#7c4a1e', '#5c3413'];
                ctx.fillStyle = soils[band % soils.length];
            }
            ctx.fillRect(x, y, CELL, CELL);
        }
    }

    // Faint tunnel outlines for readability.
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (let r = 1; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (grid[r][c]) ctx.strokeRect(c * CELL + 0.5, r * CELL + 0.5, CELL - 1, CELL - 1);
        }
    }

    // Rocks.
    for (const rk of rocks) drawRock(rk.c * CELL, rk.r * CELL);

    // Harpoon line.
    if (harpoon.timer > 0 && harpoon.cells.length) {
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(player.c * CELL + CELL / 2, player.r * CELL + CELL / 2);
        const last = harpoon.cells[harpoon.cells.length - 1];
        ctx.lineTo(last.c * CELL + CELL / 2, last.r * CELL + CELL / 2);
        ctx.stroke();
    }

    // Monsters.
    for (const e of enemies) drawEnemy(e);

    // Digger.
    drawPlayer();
}

function drawRock(x, y) {
    ctx.fillStyle = '#9ca3af';
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 3, CELL - 6, CELL - 6, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.roundRect(x + 5, y + 5, CELL - 16, 6, 3);
    ctx.fill();
}

function drawEnemy(e) {
    const cx = e.c * CELL + CELL / 2;
    const cy = e.r * CELL + CELL / 2;
    const grow = 1 + e.inflate * 0.22;
    const rad = (CELL / 2 - 4) * grow;

    ctx.fillStyle = e.inflate > 0 ? '#fca5a5' : '#ef4444';
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();

    // Goggle eyes.
    ctx.fillStyle = '#fef3c7';
    const ex = rad * 0.4;
    ctx.beginPath();
    ctx.arc(cx - ex, cy - rad * 0.15, rad * 0.32, 0, Math.PI * 2);
    ctx.arc(cx + ex, cy - rad * 0.15, rad * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.arc(cx - ex, cy - rad * 0.15, rad * 0.15, 0, Math.PI * 2);
    ctx.arc(cx + ex, cy - rad * 0.15, rad * 0.15, 0, Math.PI * 2);
    ctx.fill();
}

function drawPlayer() {
    const x = player.c * CELL;
    const y = player.r * CELL;
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const rad = CELL / 2 - 4;

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.roundRect(x + 4, y + 4, CELL - 8, CELL - 8, 6);
    ctx.fill();

    // Blue suit lower half.
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.roundRect(x + 4, y + CELL / 2, CELL - 8, CELL / 2 - 4, 6);
    ctx.fill();

    // Facing indicator.
    const { dr, dc } = DIRS[player.dir];
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(cx + dc * rad * 0.5, cy - CELL * 0.12 + dr * rad * 0.4, 3, 0, Math.PI * 2);
    ctx.fill();
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
const KEY_DIR = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
};
const START_KEYS = [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'];

document.addEventListener('keydown', e => {
    const k = e.key;

    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    if (state !== 'running' && state !== 'paused' && START_KEYS.includes(k)) {
        startGame();
        e.preventDefault();
        return;
    }

    if (state === 'running') {
        if (k === ' ') {
            pump();
            e.preventDefault();
            return;
        }
        const dir = KEY_DIR[k];
        if (dir) {
            keys[dir] = true;
            playerMoveAccum = 0;
            movePlayer(dir); // responsive first step
            e.preventDefault();
        }
    }
});

document.addEventListener('keyup', e => {
    const dir = KEY_DIR[e.key];
    if (dir) keys[dir] = false;
});

canvas.addEventListener('pointerdown', () => {
    if (state !== 'running' && state !== 'paused') startGame();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
best = parseInt(localStorage.getItem('digdug-best') || '0', 10);
bestEl.textContent = best;
score = 0;
lives = START_LIVES;
level = 1;
clock = 0;
playerMoveAccum = 0;
enemyMoveAccum = 0;
seedRng(0x1a2b3c4d);
generateLevel(1);
state = 'idle';
updateHud();
draw();
