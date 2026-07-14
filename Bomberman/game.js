// =======================================================================
// Bomberman — a self-contained HTML5 canvas game.
//
// State and helpers live on the global scope (the pattern the other games in
// this repo use) so the Playwright suite can drive the simulation
// deterministically: set the grid, place bombs/enemies at exact tiles, and
// advance step(dt) by known amounts — no test depends on Math.random.
// =======================================================================

// --- Grid & tile dimensions ---
const CELL = 40;
const COLS = 13;
const ROWS = 11;
const WIDTH = COLS * CELL;   // 520
const HEIGHT = ROWS * CELL;  // 440

// --- Timings (milliseconds) — motion/timers are frame-rate independent ---
const MOVE_CD = 130;         // per-tile cooldown for held-key movement
const ENEMY_MOVE_CD = 420;   // per-tile cooldown for enemies
const BOMB_FUSE = 2000;      // fuse before a bomb detonates
const BLAST_LIFE = 500;      // how long an explosion tile stays lethal
const RESPAWN_INVULN = 2000; // invulnerability after (re)spawning

const START_LIVES = 3;
const BRICK_DENSITY = 0.72;
const SCORE_BRICK = 10;
const SCORE_POWERUP = 50;
const SCORE_ENEMY = 100;
const BASE_SEED = 0x1b873593;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const enemiesEl = document.getElementById('enemies');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let grid, player, enemies, bombs, explosions, powerups, brickPowerups;
let score, best, lives, level, state, lastTime, animId;
const keys = {};

// -----------------------------------------------------------------------
// Seeded PRNG (mulberry32) — reproducible levels; tests never rely on it.
// -----------------------------------------------------------------------
let rngState = 1;
function seedRng(seed) { rngState = seed >>> 0; }
function rng() {
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rngRange(min, max) { return min + rng() * (max - min); }
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// -----------------------------------------------------------------------
// Grid helpers
// -----------------------------------------------------------------------
function cellAt(c, r) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return 'wall';
    return grid[r][c];
}
function isSolid(c, r) {
    const v = cellAt(c, r);
    return v === 'wall' || v === 'brick';
}
function bombAt(c, r) { return bombs.find(b => b.col === c && b.row === r); }
function enemyAt(c, r) { return enemies.find(e => e.col === c && e.row === r); }
function explosionAt(c, r) { return explosions.some(x => x.col === c && x.row === r); }
function canWalk(c, r) { return cellAt(c, r) === 'empty' && !bombAt(c, r); }

function setEntityPixel(e) {
    e.x = e.col * CELL + CELL / 2;
    e.y = e.row * CELL + CELL / 2;
}

function enemiesForLevel(lvl) { return 2 + lvl; }

// -----------------------------------------------------------------------
// Level construction
// -----------------------------------------------------------------------
function makePlayer() {
    const p = { col: 1, row: 1, x: 0, y: 0, range: 1, maxBombs: 1,
        invuln: 0, moveCooldown: 0, facing: { dc: 0, dr: 1 } };
    setEntityPixel(p);
    return p;
}

function spawnEnemy(c, r) {
    const e = { col: c, row: r, x: 0, y: 0, dir: null, moveCooldown: rngRange(0, ENEMY_MOVE_CD) };
    setEntityPixel(e);
    enemies.push(e);
    return e;
}

function buildLevel() {
    seedRng(BASE_SEED + level);
    grid = [];
    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
            const border = r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1;
            const pillar = r % 2 === 0 && c % 2 === 0;
            if (border || pillar) row.push('wall');
            else row.push(rng() < BRICK_DENSITY ? 'brick' : 'empty');
        }
        grid.push(row);
    }

    // Keep the spawn corner and its two neighbours clear.
    for (const [c, r] of [[1, 1], [2, 1], [1, 2]]) grid[r][c] = 'empty';

    // Hide a few power-ups under bricks.
    brickPowerups = {};
    const brickCells = [];
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            if (grid[r][c] === 'brick') brickCells.push([c, r]);
    shuffle(brickCells);
    const nPow = Math.min(5, brickCells.length);
    for (let i = 0; i < nPow; i++) {
        const [c, r] = brickCells[i];
        brickPowerups[`${c},${r}`] = i % 2 === 0 ? 'flame' : 'extraBomb';
    }

    // Spawn enemies on cleared cells away from the player.
    enemies = [];
    const spots = [];
    for (let r = 1; r < ROWS - 1; r++)
        for (let c = 1; c < COLS - 1; c++) {
            if (grid[r][c] === 'wall') continue;
            if (Math.abs(c - 1) + Math.abs(r - 1) < 6) continue;
            spots.push([c, r]);
        }
    shuffle(spots);
    const count = enemiesForLevel(level);
    for (let i = 0; i < count && i < spots.length; i++) {
        const [c, r] = spots[i];
        grid[r][c] = 'empty';
        spawnEnemy(c, r);
    }

    // Reset the player to the corner (keeps range/maxBombs across levels).
    player.col = 1;
    player.row = 1;
    setEntityPixel(player);
    player.moveCooldown = 0;
    player.invuln = RESPAWN_INVULN;

    bombs = [];
    explosions = [];
    powerups = [];
}

// -----------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------
function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    player = makePlayer();
    buildLevel();
    state = 'running';

    overlay.classList.remove('visible');
    updateHud();

    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function nextLevel() {
    level++;
    buildLevel();
    updateHud();
}

function loseLife() {
    lives--;
    if (lives <= 0) {
        endGame();
        return;
    }
    player.col = 1;
    player.row = 1;
    setEntityPixel(player);
    player.invuln = RESPAWN_INVULN;
    player.moveCooldown = 0;
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('bomberman-best', best); } catch (e) {}
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} pts`;
    overlaySub.textContent = 'Press Space to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    updateHud();
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

function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
    livesEl.textContent = Math.max(0, lives);
    levelEl.textContent = level;
    enemiesEl.textContent = enemies.length;
}

// -----------------------------------------------------------------------
// Actions (also called directly by tests)
// -----------------------------------------------------------------------
function movePlayer(dc, dr) {
    if (state !== 'running') return false;
    player.facing = { dc, dr };
    const c = player.col + dc, r = player.row + dr;
    if (!canWalk(c, r)) return false;
    player.col = c;
    player.row = r;
    setEntityPixel(player);
    player.moveCooldown = MOVE_CD;
    return true;
}

function placeBomb() {
    if (state !== 'running') return false;
    if (bombs.length >= player.maxBombs) return false;
    if (bombAt(player.col, player.row)) return false;
    bombs.push({ col: player.col, row: player.row, fuse: BOMB_FUSE, range: player.range });
    return true;
}

// -----------------------------------------------------------------------
// Explosions
// -----------------------------------------------------------------------
function addExplosion(c, r) {
    const existing = explosions.find(x => x.col === c && x.row === r);
    if (existing) existing.life = BLAST_LIFE;
    else explosions.push({ col: c, row: r, life: BLAST_LIFE });
}

function destroyBrick(c, r) {
    grid[r][c] = 'empty';
    score += SCORE_BRICK;
    const key = `${c},${r}`;
    if (brickPowerups[key]) {
        powerups.push({ col: c, row: r, type: brickPowerups[key] });
        delete brickPowerups[key];
    }
}

function explodeBomb(bomb, exploded) {
    if (exploded.has(bomb)) return;
    exploded.add(bomb);
    const idx = bombs.indexOf(bomb);
    if (idx >= 0) bombs.splice(idx, 1);

    addExplosion(bomb.col, bomb.row);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dc, dr] of dirs) {
        for (let d = 1; d <= bomb.range; d++) {
            const c = bomb.col + dc * d, r = bomb.row + dr * d;
            if (cellAt(c, r) === 'wall') break;
            addExplosion(c, r);
            if (cellAt(c, r) === 'brick') { destroyBrick(c, r); break; }
            const other = bombAt(c, r);
            if (other) explodeBomb(other, exploded); // chain reaction
        }
    }
}

function applyPowerup(p) {
    if (p.type === 'flame') player.range++;
    else if (p.type === 'extraBomb') player.maxBombs++;
    score += SCORE_POWERUP;
}

// -----------------------------------------------------------------------
// Simulation — advance the world by dt milliseconds
// -----------------------------------------------------------------------
function moveEnemy(e) {
    if (e.dir && canWalk(e.col + e.dir[0], e.row + e.dir[1])) {
        e.col += e.dir[0];
        e.row += e.dir[1];
        setEntityPixel(e);
        return;
    }
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const valid = dirs.filter(d => canWalk(e.col + d[0], e.row + d[1]));
    if (valid.length === 0) { e.dir = null; return; }
    const d = valid[Math.floor(rng() * valid.length)];
    e.dir = d;
    e.col += d[0];
    e.row += d[1];
    setEntityPixel(e);
}

function step(dt) {
    if (state !== 'running') return;

    // Player timers
    if (player.moveCooldown > 0) player.moveCooldown = Math.max(0, player.moveCooldown - dt);
    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);

    // Enemy movement (at most one tile per step call)
    for (const e of enemies) {
        e.moveCooldown -= dt;
        if (e.moveCooldown <= 0) {
            moveEnemy(e);
            e.moveCooldown = ENEMY_MOVE_CD;
        }
    }

    // Age existing explosions first, so blasts created this step stay lethal.
    for (const x of explosions) x.life -= dt;
    explosions = explosions.filter(x => x.life > 0);

    // Detonate bombs whose fuse has run out (with chain reactions).
    for (const b of bombs) b.fuse -= dt;
    const exploded = new Set();
    for (const b of [...bombs]) if (b.fuse <= 0) explodeBomb(b, exploded);

    // Enemies caught in a blast are destroyed.
    const survivors = [];
    for (const e of enemies) {
        if (explosionAt(e.col, e.row)) score += SCORE_ENEMY;
        else survivors.push(e);
    }
    enemies = survivors;

    // Player death: caught in a blast or touching an enemy.
    if (player.invuln <= 0 && state === 'running') {
        if (explosionAt(player.col, player.row) || enemyAt(player.col, player.row)) {
            loseLife();
        }
    }

    // Collect any power-up the player is standing on.
    for (let i = powerups.length - 1; i >= 0; i--) {
        const p = powerups[i];
        if (p.col === player.col && p.row === player.row) {
            applyPowerup(p);
            powerups.splice(i, 1);
        }
    }

    // Clearing every enemy advances the level.
    if (state === 'running' && enemies.length === 0) {
        nextLevel();
    }

    updateHud();
}

// -----------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------
function readInput() {
    if (player.moveCooldown > 0) return;
    let dc = 0, dr = 0;
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) dc = -1;
    else if (keys['ArrowRight'] || keys['d'] || keys['D']) dc = 1;
    else if (keys['ArrowUp'] || keys['w'] || keys['W']) dr = -1;
    else if (keys['ArrowDown'] || keys['s'] || keys['S']) dr = 1;
    if (dc !== 0 || dr !== 0) movePlayer(dc, dr);
}

function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = Math.min(50, timestamp - lastTime);
    lastTime = timestamp;

    if (state === 'running') {
        readInput();
        step(elapsed);
    }

    draw();

    if (state === 'running') {
        animId = requestAnimationFrame(loop);
    }
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function draw() {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Tiles
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const v = grid[r][c];
            const x = c * CELL, y = r * CELL;
            if (v === 'wall') {
                ctx.fillStyle = '#30363d';
                ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
                ctx.fillStyle = '#3f4650';
                ctx.fillRect(x + 4, y + 4, CELL - 12, CELL - 12);
            } else if (v === 'brick') {
                ctx.fillStyle = '#8b5a2b';
                ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
                ctx.strokeStyle = '#0d1117';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x + 2, y + CELL / 2); ctx.lineTo(x + CELL - 2, y + CELL / 2);
                ctx.moveTo(x + CELL / 2, y + 2); ctx.lineTo(x + CELL / 2, y + CELL / 2);
                ctx.moveTo(x + CELL / 4, y + CELL / 2); ctx.lineTo(x + CELL / 4, y + CELL - 2);
                ctx.moveTo(x + 3 * CELL / 4, y + CELL / 2); ctx.lineTo(x + 3 * CELL / 4, y + CELL - 2);
                ctx.stroke();
            } else {
                ctx.fillStyle = '#161b22';
                ctx.fillRect(x, y, CELL, CELL);
            }
        }
    }

    // Power-ups
    for (const p of powerups) {
        const x = p.col * CELL, y = p.row * CELL;
        ctx.fillStyle = p.type === 'flame' ? '#f97316' : '#38bdf8';
        ctx.fillRect(x + 8, y + 8, CELL - 16, CELL - 16);
        ctx.fillStyle = '#0d1117';
        ctx.font = 'bold 16px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.type === 'flame' ? 'F' : 'B', x + CELL / 2, y + CELL / 2 + 1);
    }

    // Bombs
    for (const b of bombs) {
        const pulse = 1 + 0.12 * Math.sin((BOMB_FUSE - b.fuse) / 90);
        ctx.fillStyle = '#e6edf3';
        ctx.beginPath();
        ctx.arc(b.col * CELL + CELL / 2, b.row * CELL + CELL / 2, (CELL / 2 - 6) * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fb923c';
        ctx.fillRect(b.col * CELL + CELL / 2 - 2, b.row * CELL + 5, 4, 6);
    }

    // Explosions
    for (const x of explosions) {
        const a = Math.max(0.25, x.life / BLAST_LIFE);
        ctx.fillStyle = `rgba(251, 146, 60, ${a})`;
        ctx.fillRect(x.col * CELL + 3, x.row * CELL + 3, CELL - 6, CELL - 6);
        ctx.fillStyle = `rgba(254, 240, 138, ${a})`;
        ctx.fillRect(x.col * CELL + 10, x.row * CELL + 10, CELL - 20, CELL - 20);
    }

    // Enemies
    for (const e of enemies) {
        ctx.fillStyle = '#f472b6';
        ctx.fillRect(e.x - CELL / 2 + 6, e.y - CELL / 2 + 6, CELL - 12, CELL - 12);
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(e.x - 6, e.y - 3, 4, 4);
        ctx.fillRect(e.x + 2, e.y - 3, 4, 4);
    }

    // Player (blink while invulnerable)
    if (player && !(player.invuln > 0 && Math.floor(player.invuln / 120) % 2 === 0)) {
        ctx.fillStyle = '#fb923c';
        ctx.fillRect(player.x - CELL / 2 + 5, player.y - CELL / 2 + 5, CELL - 10, CELL - 10);
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(player.x - 5, player.y - 4, 3, 4);
        ctx.fillRect(player.x + 2, player.y - 4, 3, 4);
    }
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'a', 'A', 'd', 'D', 'w', 'W', 's', 'S'];
const START_KEYS = [' ', 'Spacebar', ...MOVE_KEYS];

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
        if (k === ' ' || k === 'Spacebar') {
            placeBomb();
            e.preventDefault();
            return;
        }
        keys[k] = true;
        if (MOVE_KEYS.includes(k)) e.preventDefault();
    }
});

document.addEventListener('keyup', e => { keys[e.key] = false; });

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// -----------------------------------------------------------------------
// Init (idle screen)
// -----------------------------------------------------------------------
best = parseInt((typeof localStorage !== 'undefined' && localStorage.getItem('bomberman-best')) || '0', 10);
score = 0;
lives = START_LIVES;
level = 1;
state = 'idle';
player = makePlayer();
buildLevel();
updateHud();
draw();
