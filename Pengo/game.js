// ---------------------------------------------------------------------------
// Pengo — a maze-action arcade game on an HTML5 canvas.
//
// A penguin trapped in a field of ice blocks is hunted by Sno-Bees. Push a block
// and it slides across the ice until it hits something, crushing any Sno-Bee in
// its path. Flatten every Sno-Bee to clear the level.
//
// A single classic (non-module) script so the game state and pure helpers are
// reachable from the Playwright tests as globals, mirroring the other games in
// this repo.
// ---------------------------------------------------------------------------

// --- Geometry ---
const COLS = 13;
const ROWS = 13;
const CELL = 36;
const W = COLS * CELL; // 468
const H = ROWS * CELL; // 468

// --- Tiles ---
const EMPTY = 0;
const ICE = 1;
const DIAMOND = 2;

// --- Scoring ---
const SCORE_CRUSH = 100;
const SCORE_BREAK = 10;
const SCORE_DIAMOND = 500;
const MAX_ENEMIES = 6;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State (var/globals so tests can read & assign them) ---
var grid, player, enemies, score, lives, level, best, state;
var playerStart, enemySpawns, awardedDiamond, enemyInterval, animId;

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------
function buildLevel(lvl) {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
            row.push((r % 2 === 0 && c % 2 === 0) ? ICE : EMPTY);
        }
        grid.push(row);
    }

    // Penguin starts at the bottom centre on a cleared cell.
    playerStart = { r: ROWS - 1, c: 6 };
    grid[playerStart.r][playerStart.c] = EMPTY;
    player = { r: playerStart.r, c: playerStart.c };

    // Three diamonds, deliberately not pre-aligned.
    for (const [r, c] of [[4, 4], [8, 8], [4, 8]]) grid[r][c] = DIAMOND;

    // Sno-Bees spawn on open cells near the top; one more per level (capped).
    const count = Math.min(3 + (lvl - 1), MAX_ENEMIES);
    const pool = [[1, 6], [1, 4], [1, 8], [3, 6], [1, 2], [1, 10]];
    enemySpawns = pool.slice(0, count).map(([r, c]) => ({ r, c }));
    enemies = enemySpawns.map(s => ({ r: s.r, c: s.c, alive: true }));

    awardedDiamond = false;
    enemyInterval = Math.max(160, 520 - (lvl - 1) * 50);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function enemyAt(r, c) {
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.alive && e.r === r && e.c === c) return i;
    }
    return -1;
}

function levelCleared() {
    return enemies.filter(e => e.alive).length === 0;
}

// True when all three diamonds sit in three consecutive cells of one line.
function diamondsAligned() {
    const ds = [];
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            if (grid[r][c] === DIAMOND) ds.push([r, c]);
    if (ds.length !== 3) return false;

    const rows = ds.map(d => d[0]);
    const cols = ds.map(d => d[1]);
    const consecutive = (arr) => {
        const s = [...arr].sort((a, b) => a - b);
        return s[1] === s[0] + 1 && s[2] === s[1] + 1;
    };
    if (rows.every(r => r === rows[0])) return consecutive(cols);
    if (cols.every(c => c === cols[0])) return consecutive(rows);
    return false;
}

// ---------------------------------------------------------------------------
// Pushing / sliding blocks
// ---------------------------------------------------------------------------
// Slide the block at (r, c) in direction (dr, dc). It travels over empty cells,
// crushing any Sno-Bee it passes, until the next cell is a block or the wall.
// Returns { moved, broke, crushed, type }.
function pushBlock(r, c, dr, dc) {
    const type = grid[r][c];
    if (type !== ICE && type !== DIAMOND) return { moved: false, broke: false, crushed: 0 };

    let curR = r, curC = c, dist = 0, crushed = 0;
    while (true) {
        const tr = curR + dr, tc = curC + dc;
        if (!inBounds(tr, tc)) break;      // wall
        if (grid[tr][tc] !== EMPTY) break; // another block
        const ei = enemyAt(tr, tc);
        if (ei !== -1) { enemies[ei].alive = false; crushed++; }
        curR = tr; curC = tc; dist++;
    }

    if (dist === 0) {
        if (type === ICE) { grid[r][c] = EMPTY; return { moved: false, broke: true, crushed: 0 }; }
        return { moved: false, broke: false, crushed: 0 }; // diamond is immovable
    }

    grid[r][c] = EMPTY;
    grid[curR][curC] = type;
    return { moved: true, broke: false, crushed, type };
}

// ---------------------------------------------------------------------------
// The penguin
// ---------------------------------------------------------------------------
function movePlayer(dr, dc) {
    if (state !== 'playing' || !player) return false;
    const nr = player.r + dr, nc = player.c + dc;
    if (!inBounds(nr, nc)) return false; // wall

    if (grid[nr][nc] === EMPTY) {
        player.r = nr; player.c = nc;
        if (enemyAt(nr, nc) !== -1) loseLife();
        updateHUD(); draw();
        return true;
    }

    // Push the block we walked into.
    const res = pushBlock(nr, nc, dr, dc);
    if (res.broke) score += SCORE_BREAK;
    if (res.crushed) score += SCORE_CRUSH * res.crushed;
    if (res.moved) {
        player.r = nr; player.c = nc; // advance into the vacated cell
        if (res.type === DIAMOND && !awardedDiamond && diamondsAligned()) {
            score += SCORE_DIAMOND;
            awardedDiamond = true;
        }
    }
    updateHUD(); draw();

    if (res.crushed && levelCleared()) completeLevel();
    return res.moved;
}

// ---------------------------------------------------------------------------
// The Sno-Bees
// ---------------------------------------------------------------------------
function canEnemyEnter(r, c) {
    return inBounds(r, c) && grid[r][c] === EMPTY && enemyAt(r, c) === -1;
}

function enemyStep() {
    if (state !== 'playing') return;
    const list = enemies; // snapshot: loseLife may reassign the global
    for (const e of list) {
        if (!e.alive) continue;
        const rd = player.r - e.r, cd = player.c - e.c;
        const vdir = Math.sign(rd), hdir = Math.sign(cd);

        // Try the axis we are farther along first (vertical wins a tie).
        const tries = [];
        if (Math.abs(rd) >= Math.abs(cd)) {
            if (vdir !== 0) tries.push([vdir, 0]);
            if (hdir !== 0) tries.push([0, hdir]);
        } else {
            if (hdir !== 0) tries.push([0, hdir]);
            if (vdir !== 0) tries.push([vdir, 0]);
        }

        for (const [ddr, ddc] of tries) {
            const tr = e.r + ddr, tc = e.c + ddc;
            if (canEnemyEnter(tr, tc)) {
                e.r = tr; e.c = tc;
                if (player.r === tr && player.c === tc) { loseLife(); draw(); return; }
                break;
            }
        }
    }
    draw();
}

// ---------------------------------------------------------------------------
// Lives, levels, game over
// ---------------------------------------------------------------------------
function respawn() {
    player = { r: playerStart.r, c: playerStart.c };
    enemies = enemySpawns.map(s => ({ r: s.r, c: s.c, alive: true }));
    draw();
}

function loseLife() {
    lives--;
    updateHUD();
    if (lives <= 0) { gameOver(); return; }
    respawn();
}

function completeLevel() {
    level++;
    score += level * 200;
    buildLevel(level);
    updateHUD();
    draw();
}

function gameOver() {
    state = 'over';
    stopLoop();
    if (score > best) { best = score; saveBest(); }
    updateHUD();
    showOverlay('Game Over', 'Score ' + score + ' — press R or Start to play again.');
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------
function startGame() {
    stopLoop();
    score = 0; lives = 3; level = 1;
    buildLevel(1);
    state = 'playing';
    hideOverlay();
    updateHUD();
    draw();
    startLoop();
}

function reset() {
    stopLoop();
    score = 0; lives = 3; level = 1;
    buildLevel(1);
    state = 'idle';
    showOverlay('Pengo', 'Slide ice blocks to crush the Sno-Bees.');
    updateHUD();
    draw();
}

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        stopLoop();
        showOverlay('Paused', 'Press P to resume.');
    } else if (state === 'paused') {
        state = 'playing';
        hideOverlay();
        startLoop();
    }
}

// ---------------------------------------------------------------------------
// Real-time loop (time-based so enemy speed is frame-rate independent)
// ---------------------------------------------------------------------------
function startLoop() {
    let last = performance.now();
    let acc = 0;
    const tick = (now) => {
        if (state !== 'playing') return;
        acc += now - last; last = now;
        while (acc >= enemyInterval) {
            acc -= enemyInterval;
            enemyStep();
            if (state !== 'playing') return;
        }
        animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
}

function stopLoop() {
    if (animId) cancelAnimationFrame(animId);
    animId = null;
}

// ---------------------------------------------------------------------------
// HUD, overlay, persistence
// ---------------------------------------------------------------------------
function updateHUD() {
    scoreEl.textContent = score;
    livesEl.textContent = lives;
    levelEl.textContent = level;
    bestEl.textContent = best;
}

function showOverlay(title, sub) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function saveBest() {
    try { localStorage.setItem('pengo-best', String(best)); } catch (e) {}
}

function loadBest() {
    try {
        const raw = localStorage.getItem('pengo-best');
        if (raw != null) return Number(raw) | 0;
    } catch (e) {}
    return 0;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawIce(x, y) {
    ctx.save();
    roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 6);
    const g = ctx.createLinearGradient(x, y, x, y + CELL);
    g.addColorStop(0, '#dbeeff');
    g.addColorStop(1, '#8fc7e6');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#5a9cc4';
    ctx.lineWidth = 2;
    ctx.stroke();
    // frosty crack
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 9, y + 9); ctx.lineTo(x + CELL - 12, y + CELL - 14);
    ctx.stroke();
    ctx.restore();
}

function drawDiamond(x, y) {
    const cx = x + CELL / 2, cy = y + CELL / 2, s = CELL * 0.34;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx, cy + s);
    ctx.lineTo(cx - s, cy);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx, cy - s, cx, cy + s);
    g.addColorStop(0, '#b8fff0');
    g.addColorStop(1, '#22c3a6');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#0e8f78';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s);
    ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
}

function drawPenguin(x, y) {
    const cx = x + CELL / 2, cy = y + CELL / 2;
    ctx.save();
    // body
    ctx.fillStyle = '#22303a';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 1, CELL * 0.30, CELL * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    // belly
    ctx.fillStyle = '#fdfdfd';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 3, CELL * 0.18, CELL * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    // eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx - 5, cy - 6, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 5, cy - 6, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(cx - 5, cy - 6, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 5, cy - 6, 1.6, 0, Math.PI * 2); ctx.fill();
    // beak
    ctx.fillStyle = '#ffb02e';
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy - 1); ctx.lineTo(cx + 3, cy - 1); ctx.lineTo(cx, cy + 3);
    ctx.closePath(); ctx.fill();
    ctx.restore();
}

function drawSnoBee(x, y) {
    const cx = x + CELL / 2, cy = y + CELL / 2, r = CELL * 0.30;
    ctx.save();
    const g = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, r);
    g.addColorStop(0, '#7ad0ff');
    g.addColorStop(1, '#2b6fd6');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#12408f';
    ctx.lineWidth = 2; ctx.stroke();
    // angry eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx - 4, cy - 3, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 4, cy - 3, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(cx - 4, cy - 2, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 4, cy - 2, 1.4, 0, Math.PI * 2); ctx.fill();
    // little legs
    ctx.strokeStyle = '#12408f';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + r - 1); ctx.lineTo(cx - 8, cy + r + 3);
    ctx.moveTo(cx + 6, cy + r - 1); ctx.lineTo(cx + 8, cy + r + 3);
    ctx.stroke();
    ctx.restore();
}

function draw() {
    // Icy floor.
    ctx.fillStyle = '#0d2438';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(120,180,220,0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
        ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, H); ctx.stroke();
    }
    for (let i = 1; i < ROWS; i++) {
        ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke();
    }

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = c * CELL, y = r * CELL;
            if (grid[r][c] === ICE) drawIce(x, y);
            else if (grid[r][c] === DIAMOND) drawDiamond(x, y);
        }
    }

    for (const e of enemies) {
        if (e.alive) drawSnoBee(e.c * CELL, e.r * CELL);
    }

    if (player) drawPenguin(player.c * CELL, player.r * CELL);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const MOVES = {
    ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    w: [-1, 0], W: [-1, 0], s: [1, 0], S: [1, 0],
    a: [0, -1], A: [0, -1], d: [0, 1], D: [0, 1],
};

document.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'r' || k === 'R') { e.preventDefault(); startGame(); return; }
    if (k === 'p' || k === 'P') { e.preventDefault(); togglePause(); return; }

    if (state === 'idle' || state === 'over') {
        if (MOVES[k]) { e.preventDefault(); startGame(); }
        return;
    }
    if (state !== 'playing') return;

    const m = MOVES[k];
    if (m) { e.preventDefault(); movePlayer(m[0], m[1]); }
});

btnStart.addEventListener('click', () => {
    if (state !== 'playing') startGame();
});

canvas.addEventListener('click', () => {
    if (state === 'idle' || state === 'over') startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
best = loadBest();
reset();
