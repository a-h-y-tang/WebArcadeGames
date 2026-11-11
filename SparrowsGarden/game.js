// ---------------------------------------------------------------------------
// Sparrow's Garden — a maze dot-muncher on an HTML5 canvas.
//
// A sparrow hops the gravel paths of a walled kitchen garden pecking up every
// seed while four garden cats prowl. Peck a sunflower head and the cats turn
// shy; reach one then and it scampers home to the shed.
//
// A single classic (non-module) script so the game state and the pure helpers
// are reachable from the Playwright tests as globals, mirroring the other games
// in this repo. requestAnimationFrame only ever calls tick(dt), so a test can
// call stopLoop() and then step time by hand.
// ---------------------------------------------------------------------------

// --- Geometry ---
const CELL = 24;

// --- Tiles ---
const WALL = 0;
const PATH = 1;
const SEED = 2;
const SUNFLOWER = 3;

// --- The garden. '#' hedge, '.' seed, 'o' sunflower, 'S' sparrow start,
// --- 'C' a cat's place in the shed, 'B' the berry spot (bare earth). ---
const MAZE_SRC = [
    '###################',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o...............o#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.#.#.#.#.#.####',
    '#....#.......#....#',
    '#.##.#.#####.#.##.#',
    '#.....C.C.C.C.....#',
    '#.##.#.#####.#.##.#',
    '#....#...B...#....#',
    '####.#.#.#.#.#.####',
    '#....#...#...#....#',
    '#.##.#.#####.#.##.#',
    '#o...............o#',
    '#.##.###.#.###.##.#',
    '#........#........#',
    '#.###.#######.###.#',
    '#........S........#',
    '###################',
];

const ROWS = MAZE_SRC.length;        // 21
const COLS = MAZE_SRC[0].length;     // 19
const W = COLS * CELL;               // 456
const H = ROWS * CELL;               // 504

// --- Scoring ---
const SEED_POINTS = 10;
const SUNFLOWER_POINTS = 50;
const BERRY_POINTS = 100;
const SHOO_POINTS = 200;
const LIVES_START = 3;

// --- Speeds, in cells per second ---
const PLAYER_SPEED = 5;
const CAT_SPEED_BASE = 4.2;
const CAT_SPEED_STEP = 0.4;
const CAT_SPEED_CAP = 6.5;
const SHY_SPEED = 2.6;

// --- Timers, in milliseconds ---
const SUNFLOWER_MS = 7000;       // at garden 1; shorter later
const SUNFLOWER_MS_MIN = 2500;
const SUNFLOWER_MS_STEP = 800;
const HOME_MS = 3000;            // a shooed cat sits in the shed this long
const BERRY_MS = 8000;
const SCATTER_MS = 5000;
const CHASE_MS = 20000;
const PHASES = [
    { mode: 'scatter', ms: SCATTER_MS },
    { mode: 'chase', ms: CHASE_MS },
    { mode: 'scatter', ms: SCATTER_MS },
    { mode: 'chase', ms: Infinity },
];

// --- Other rules ---
const BERRY_AT = 60;                        // seeds eaten before a berry ripens
const BERRY_CELL = { r: 11, c: 9 };
const SNOWY_RANGE = 8;                      // cells; outside it Snowy goes home
const CATCH_RADIUS = 0.5;                   // cells, on each axis
const BEST_KEY = 'sparrows-garden-best';

const DIRS = [
    { dr: -1, dc: 0 },   // up    — also the tie-break order for the cats
    { dr: 0, dc: -1 },   // left
    { dr: 1, dc: 0 },    // down
    { dr: 0, dc: 1 },    // right
];

const CAT_LOOK = [
    { name: 'Tabby', colour: '#d98a3d', corner: { r: 1, c: 17 } },
    { name: 'Ginger', colour: '#e5643c', corner: { r: 1, c: 1 } },
    { name: 'Smoke', colour: '#8f9bb3', corner: { r: 19, c: 17 } },
    { name: 'Snowy', colour: '#e8e4da', corner: { r: 19, c: 1 } },
];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const seedsEl = document.getElementById('seeds');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnPause = document.getElementById('btn-pause');
const btnRestart = document.getElementById('btn-restart');

// --- State (var/globals so the tests can read and assign them) ---
var grid, player, cats, playerStart, catStarts;
var score, best, lives, level, state;
var seedsLeft, seedsEaten, berry, sunflowerTimer, shooStreak;
var phaseTimer, animId, lastFrame, pulse, looping;

// ---------------------------------------------------------------------------
// Building the garden
// ---------------------------------------------------------------------------
function buildGarden() {
    grid = [];
    catStarts = [];
    playerStart = { r: ROWS - 2, c: (COLS - 1) / 2 };
    seedsLeft = 0;

    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
            const ch = MAZE_SRC[r][c];
            if (ch === '#') { row.push(WALL); continue; }
            if (ch === '.') { row.push(SEED); seedsLeft++; continue; }
            if (ch === 'o') { row.push(SUNFLOWER); seedsLeft++; continue; }
            if (ch === 'S') playerStart = { r, c };
            if (ch === 'C') catStarts.push({ r, c });
            row.push(PATH);
        }
        grid.push(row);
    }

    seedsEaten = 0;
    berry = null;
    sunflowerTimer = 0;
    shooStreak = 0;
    phaseTimer = 0;
}

function makeCats() {
    cats = CAT_LOOK.map((look, i) => {
        const start = catStarts[i % catStarts.length];
        return {
            name: look.name,
            colour: look.colour,
            corner: look.corner,
            start: { r: start.r, c: start.c },
            r: start.r,
            c: start.c,
            dir: null,
            prog: 0,
            mode: PHASES[0].mode,
            homeTimer: 0,
        };
    });
}

function resetPositions() {
    player = {
        r: playerStart.r,
        c: playerStart.c,
        dir: null,
        want: { dr: 0, dc: 0 },
        prog: 0,
    };
    const mode = phaseMode();
    for (const cat of cats) {
        cat.r = cat.start.r;
        cat.c = cat.start.c;
        cat.dir = null;
        cat.prog = 0;
        cat.mode = mode;
        cat.homeTimer = 0;
    }
    sunflowerTimer = 0;
    shooStreak = 0;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
function openAt(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS && grid[r][c] !== WALL;
}

function isDir(d) {
    return !!d && (d.dr !== 0 || d.dc !== 0);
}

function reverseOf(d) {
    return { dr: -d.dr, dc: -d.dc };
}

function sameDir(a, b) {
    return !!a && !!b && a.dr === b.dr && a.dc === b.dc;
}

// Continuous position, in cells, of a mover part-way between two cells.
function posOf(m) {
    const d = isDir(m.dir) ? m.dir : { dr: 0, dc: 0 };
    return { x: m.c + d.dc * m.prog, y: m.r + d.dr * m.prog };
}

function catSpeed() {
    return Math.min(CAT_SPEED_CAP, CAT_SPEED_BASE + (level - 1) * CAT_SPEED_STEP);
}

function sunflowerMs(lvl) {
    return Math.max(SUNFLOWER_MS_MIN, SUNFLOWER_MS - (lvl - 1) * SUNFLOWER_MS_STEP);
}

function phaseMode() {
    let t = phaseTimer;
    for (const phase of PHASES) {
        if (t < phase.ms) return phase.mode;
        t -= phase.ms;
    }
    return PHASES[PHASES.length - 1].mode;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------
// Choose the sparrow's direction at a cell: the queued turn if it is open, else
// carry on, else stop.
function choosePlayerDir() {
    if (isDir(player.want) && openAt(player.r + player.want.dr, player.c + player.want.dc)) {
        return { dr: player.want.dr, dc: player.want.dc };
    }
    if (isDir(player.dir) && openAt(player.r + player.dir.dr, player.c + player.dir.dc)) {
        return player.dir;
    }
    return null;
}

// Where a cat is heading, by name and mode.
function catTarget(cat) {
    if (cat.mode !== 'chase') {
        if (cat.mode === 'shy') return { r: player.r, c: player.c };
        return cat.corner;
    }
    const dir = isDir(player.dir) ? player.dir : { dr: 0, dc: 0 };
    if (cat.name === 'Ginger') {
        return { r: player.r + dir.dr * 4, c: player.c + dir.dc * 4 };
    }
    if (cat.name === 'Smoke') {
        const tabby = cats.find(k => k.name === 'Tabby') || cat;
        const ahead = { r: player.r + dir.dr * 2, c: player.c + dir.dc * 2 };
        return { r: ahead.r * 2 - tabby.r, c: ahead.c * 2 - tabby.c };
    }
    if (cat.name === 'Snowy') {
        const away = Math.hypot(cat.r - player.r, cat.c - player.c);
        return away > SNOWY_RANGE ? cat.corner : { r: player.r, c: player.c };
    }
    return { r: player.r, c: player.c };
}

// A cat picks the open neighbour nearest its target (furthest, when shy),
// never reversing unless there is nowhere else to go. Ties break up, left,
// down, right.
function chooseCatDir(cat) {
    const back = isDir(cat.dir) ? reverseOf(cat.dir) : null;
    let options = DIRS.filter(d => openAt(cat.r + d.dr, cat.c + d.dc));
    const forward = options.filter(d => !sameDir(d, back));
    if (forward.length) options = forward;
    if (!options.length) return null;

    const target = catTarget(cat);
    const flee = cat.mode === 'shy';
    let bestDir = null;
    let bestScore = null;
    for (const d of options) {
        const dr = cat.r + d.dr - target.r;
        const dc = cat.c + d.dc - target.c;
        const dist = dr * dr + dc * dc;
        if (bestScore === null || (flee ? dist > bestScore : dist < bestScore)) {
            bestScore = dist;
            bestDir = d;
        }
    }
    return bestDir;
}

// Walk a mover forward speed * dt/1000 cells, re-deciding at every cell.
function advance(m, speed, dt) {
    let remaining = (speed * dt) / 1000;
    let guard = 0;
    while (remaining > 1e-9 && guard++ < 1000) {
        if (m.prog === 0) {
            const dir = m === player ? choosePlayerDir() : chooseCatDir(m);
            if (!dir) { m.dir = m === player ? null : m.dir; return; }
            m.dir = dir;
        }
        const stepLeft = 1 - m.prog;
        if (remaining < stepLeft - 1e-9) {
            m.prog += remaining;
            remaining = 0;
        } else {
            remaining -= stepLeft;
            m.r += m.dir.dr;
            m.c += m.dir.dc;
            m.prog = 0;
            if (m === player) collectAt(m.r, m.c);
        }
    }
}

// ---------------------------------------------------------------------------
// Pecking
// ---------------------------------------------------------------------------
function collectAt(r, c) {
    const cell = grid[r][c];
    if (cell === SEED) {
        grid[r][c] = PATH;
        score += SEED_POINTS;
        seedsLeft--;
        seedsEaten++;
        if (seedsEaten === BERRY_AT) spawnBerry();
    } else if (cell === SUNFLOWER) {
        grid[r][c] = PATH;
        score += SUNFLOWER_POINTS;
        seedsLeft--;
        makeCatsShy();
    }
    if (berry && berry.r === r && berry.c === c) {
        score += BERRY_POINTS;
        berry = null;
    }
    if (seedsLeft <= 0) nextGarden();
    updateHud();
}

function spawnBerry() {
    berry = { r: BERRY_CELL.r, c: BERRY_CELL.c, ms: BERRY_MS };
}

function makeCatsShy() {
    sunflowerTimer = sunflowerMs(level);
    shooStreak = 0;
    for (const cat of cats) {
        if (cat.mode === 'home') continue;
        cat.mode = 'shy';
    }
}

function shooCat(cat) {
    score += SHOO_POINTS * Math.pow(2, shooStreak);
    shooStreak++;
    cat.mode = 'home';
    cat.homeTimer = HOME_MS;
    cat.r = cat.start.r;
    cat.c = cat.start.c;
    cat.prog = 0;
    cat.dir = null;
    updateHud();
}

function nextGarden() {
    level++;
    buildGarden();
    makeCats();
    resetPositions();
    updateHud();
}

// ---------------------------------------------------------------------------
// Cats meeting the sparrow
// ---------------------------------------------------------------------------
function checkCats() {
    if (state !== 'playing') return;
    const p = posOf(player);
    for (const cat of cats) {
        if (cat.mode === 'home') continue;
        const k = posOf(cat);
        if (Math.abs(k.x - p.x) >= CATCH_RADIUS || Math.abs(k.y - p.y) >= CATCH_RADIUS) continue;
        if (cat.mode === 'shy') {
            shooCat(cat);
        } else {
            loseLife();
            return;
        }
    }
}

function loseLife() {
    lives--;
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    resetPositions();
    updateHud();
}

function gameOver() {
    state = 'gameover';
    saveBest();
    stopLoop();
    showOverlay('The cats win this round', 'Score ' + score + ' — press Start to try again.');
    updateHud();
}

function saveBest() {
    if (score > best) {
        best = score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
    }
}

function loadBest() {
    try {
        const raw = localStorage.getItem(BEST_KEY);
        best = raw ? parseInt(raw, 10) || 0 : 0;
    } catch (e) {
        best = 0;
    }
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------
function tick(dt) {
    if (state !== 'playing') return;
    pulse += dt;

    // Scatter / chase schedule.
    const before = phaseMode();
    phaseTimer += dt;
    const now = phaseMode();
    if (now !== before) {
        for (const cat of cats) {
            if (cat.mode === 'shy' || cat.mode === 'home') continue;
            cat.mode = now;
        }
    }

    // Shyness wearing off.
    if (sunflowerTimer > 0) {
        sunflowerTimer = Math.max(0, sunflowerTimer - dt);
        if (sunflowerTimer === 0) {
            for (const cat of cats) if (cat.mode === 'shy') cat.mode = now;
        }
    }

    // Cats coming back out of the shed.
    for (const cat of cats) {
        if (cat.mode !== 'home') continue;
        cat.homeTimer -= dt;
        if (cat.homeTimer <= 0) {
            cat.homeTimer = 0;
            cat.mode = sunflowerTimer > 0 ? 'shy' : now;
        }
    }

    // The berry going over.
    if (berry) {
        berry.ms -= dt;
        if (berry.ms <= 0) berry = null;
    }

    advance(player, PLAYER_SPEED, dt);
    if (state !== 'playing') { draw(); return; }   // the garden may have been cleared

    const prowl = catSpeed();
    for (const cat of cats) {
        if (cat.mode === 'home') continue;
        advance(cat, cat.mode === 'shy' ? SHY_SPEED : prowl, dt);
    }

    checkCats();
    draw();
    updateHud();
}

function startLoop() {
    stopLoop();
    looping = true;
    lastFrame = null;
    const frame = (now) => {
        if (!looping) return;
        if (lastFrame === null) lastFrame = now;
        const dt = Math.min(50, now - lastFrame);
        lastFrame = now;
        if (state === 'playing') tick(dt);
        // tick() may have ended the game, which stops the loop.
        if (looping) animId = requestAnimationFrame(frame);
    };
    animId = requestAnimationFrame(frame);
}

function stopLoop() {
    looping = false;
    if (animId) cancelAnimationFrame(animId);
    animId = null;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function startGame() {
    score = 0;
    lives = LIVES_START;
    level = 1;
    pulse = 0;
    buildGarden();
    makeCats();
    resetPositions();
    state = 'playing';
    hideOverlay();
    updateHud();
    draw();
    startLoop();
}

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        showOverlay('Paused', 'Press P to carry on.');
    } else if (state === 'paused') {
        state = 'playing';
        hideOverlay();
        lastFrame = null;
    }
}

function showOverlay(title, sub) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    livesEl.textContent = String(lives);
    levelEl.textContent = String(level);
    seedsEl.textContent = String(Math.max(0, seedsLeft));
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const KEY_DIRS = {
    ArrowUp: { dr: -1, dc: 0 }, w: { dr: -1, dc: 0 }, W: { dr: -1, dc: 0 },
    ArrowDown: { dr: 1, dc: 0 }, s: { dr: 1, dc: 0 }, S: { dr: 1, dc: 0 },
    ArrowLeft: { dr: 0, dc: -1 }, a: { dr: 0, dc: -1 }, A: { dr: 0, dc: -1 },
    ArrowRight: { dr: 0, dc: 1 }, d: { dr: 0, dc: 1 }, D: { dr: 0, dc: 1 },
};

document.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'playing' || state === 'paused') togglePause();
        return;
    }
    const dir = KEY_DIRS[e.key];
    if (dir) {
        e.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        if (state === 'playing') player.want = { dr: dir.dr, dc: dir.dc };
        return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
    }
});

btnStart.addEventListener('click', startGame);
btnRestart.addEventListener('click', startGame);
btnPause.addEventListener('click', () => {
    if (state === 'playing' || state === 'paused') togglePause();
});

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function draw() {
    ctx.fillStyle = '#1d2b1a';
    ctx.fillRect(0, 0, W, H);
    drawEarth();
    drawHedges();
    drawShed();
    drawPickups();
    drawBerryPatch();
    drawBerry();
    drawCats();
    drawSparrow();
}

function drawEarth() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (grid[r][c] === WALL) continue;
            ctx.fillStyle = (r + c) % 2 === 0 ? '#273522' : '#2b3a26';
            ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
        }
    }
}

function drawHedges() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (grid[r][c] !== WALL) continue;
            const x = c * CELL;
            const y = r * CELL;
            ctx.fillStyle = '#2f6d33';
            roundRect(x + 1, y + 1, CELL - 2, CELL - 2, 5);
            ctx.fill();
            ctx.fillStyle = 'rgba(96, 170, 96, 0.55)';
            roundRect(x + 3, y + 2.5, CELL - 6, CELL * 0.34, 4);
            ctx.fill();
        }
    }
}

// The potting shed the cats start from, drawn as scenery behind their row.
function drawShed() {
    if (!catStarts.length) return;
    const row = catStarts[0].r;
    const x = (catStarts[0].c - 1) * CELL;
    const w = (catStarts[catStarts.length - 1].c - catStarts[0].c + 3) * CELL;
    const y = row * CELL + 2;
    const h = CELL - 4;

    ctx.fillStyle = 'rgba(104, 72, 42, 0.38)';
    roundRect(x, y, w, h, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(196, 156, 104, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Plank lines, so it reads as a timber shed rather than a highlight.
    ctx.strokeStyle = 'rgba(70, 48, 28, 0.35)';
    ctx.beginPath();
    for (let px = x + CELL / 2; px < x + w; px += CELL / 2) {
        ctx.moveTo(px, y + 3);
        ctx.lineTo(px, y + h - 3);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(214, 178, 124, 0.3)';
    ctx.fillRect(x + 2, y + 1.5, w - 4, 2);
}

// The bare patch of earth where a berry ripens, so the gap in the seeds reads
// as deliberate.
function drawBerryPatch() {
    if (berry) return;
    const x = BERRY_CELL.c * CELL + CELL / 2;
    const y = BERRY_CELL.r * CELL + CELL / 2;
    ctx.strokeStyle = 'rgba(150, 120, 80, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawPickups() {
    const grow = 1 + 0.18 * Math.sin(pulse / 220);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = grid[r][c];
            if (cell !== SEED && cell !== SUNFLOWER) continue;
            const x = c * CELL + CELL / 2;
            const y = r * CELL + CELL / 2;
            if (cell === SEED) {
                ctx.fillStyle = '#e4c478';
                ctx.beginPath();
                ctx.ellipse(x, y, 2.6, 3.4, 0.6, 0, Math.PI * 2);
                ctx.fill();
            } else {
                const petal = 8.5 * grow;
                ctx.fillStyle = '#f2c231';
                for (let i = 0; i < 8; i++) {
                    const a = (i / 8) * Math.PI * 2;
                    ctx.beginPath();
                    ctx.ellipse(x + Math.cos(a) * petal * 0.55, y + Math.sin(a) * petal * 0.55,
                        petal * 0.42, petal * 0.26, a, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.fillStyle = '#5a3c1b';
                ctx.beginPath();
                ctx.arc(x, y, petal * 0.42, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

function drawBerry() {
    if (!berry) return;
    const x = berry.c * CELL + CELL / 2;
    const y = berry.r * CELL + CELL / 2;
    ctx.fillStyle = '#4a7a33';
    ctx.fillRect(x - 1, y - 10, 2, 6);
    ctx.fillStyle = '#c23a4b';
    for (const [dx, dy] of [[-4, 0], [4, 0], [0, 5]]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 4.6, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(x - 5, y - 1.5, 1.3, 0, Math.PI * 2);
    ctx.fill();
}

function drawCats() {
    for (const cat of cats) {
        const p = posOf(cat);
        const x = p.x * CELL + CELL / 2;
        const y = p.y * CELL + CELL / 2;
        const shy = cat.mode === 'shy';
        const blink = shy && sunflowerTimer < 1500 && Math.floor(pulse / 180) % 2 === 0;
        let body = cat.colour;
        if (shy) body = blink ? '#dfe9f6' : '#5b7fd4';
        if (cat.mode === 'home') body = 'rgba(160, 160, 160, 0.45)';

        ctx.fillStyle = body;
        // ears
        ctx.beginPath();
        ctx.moveTo(x - 7, y - 4);
        ctx.lineTo(x - 4, y - 11);
        ctx.lineTo(x - 1, y - 5);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + 7, y - 4);
        ctx.lineTo(x + 4, y - 11);
        ctx.lineTo(x + 1, y - 5);
        ctx.closePath();
        ctx.fill();
        // head and body
        ctx.beginPath();
        ctx.arc(x, y - 1, 8, Math.PI, 0);
        ctx.lineTo(x + 8, y + 8);
        ctx.lineTo(x - 8, y + 8);
        ctx.closePath();
        ctx.fill();
        // tail
        ctx.strokeStyle = body;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(x + 7, y + 6);
        ctx.quadraticCurveTo(x + 13, y + 4, x + 11, y - 2);
        ctx.stroke();
        // eyes
        if (shy) {
            ctx.strokeStyle = '#1b2440';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(x - 5, y - 2); ctx.lineTo(x - 1.6, y - 2);
            ctx.moveTo(x + 1.6, y - 2); ctx.lineTo(x + 5, y - 2);
            ctx.stroke();
        } else {
            ctx.fillStyle = '#26311d';
            ctx.beginPath(); ctx.arc(x - 3.2, y - 2, 1.6, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(x + 3.2, y - 2, 1.6, 0, Math.PI * 2); ctx.fill();
        }
    }
}

function drawSparrow() {
    if (!player) return;
    const p = posOf(player);
    const x = p.x * CELL + CELL / 2;
    const y = p.y * CELL + CELL / 2;
    const facing = isDir(player.dir) && player.dir.dc !== 0 ? Math.sign(player.dir.dc) : 1;
    const hop = Math.abs(Math.sin(pulse / 140)) * 1.6;

    ctx.save();
    ctx.translate(x, y - hop);
    ctx.scale(facing, 1);
    // body
    ctx.fillStyle = '#c08a4a';
    ctx.beginPath();
    ctx.ellipse(0, 1, 9, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // wing
    ctx.fillStyle = '#8a5f2e';
    ctx.beginPath();
    ctx.ellipse(-1.5, 2, 5.5, 4, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // tail
    ctx.fillStyle = '#8a5f2e';
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(-14, -3);
    ctx.lineTo(-13, 3);
    ctx.closePath();
    ctx.fill();
    // head
    ctx.fillStyle = '#d49a58';
    ctx.beginPath();
    ctx.arc(6, -4.5, 5.2, 0, Math.PI * 2);
    ctx.fill();
    // beak
    ctx.fillStyle = '#f0b53c';
    ctx.beginPath();
    ctx.moveTo(10, -4.5);
    ctx.lineTo(15, -3);
    ctx.lineTo(10, -1.8);
    ctx.closePath();
    ctx.fill();
    // eye
    ctx.fillStyle = '#20170c';
    ctx.beginPath();
    ctx.arc(7.6, -5.6, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function roundRect(x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function init() {
    loadBest();
    score = 0;
    lives = LIVES_START;
    level = 1;
    pulse = 0;
    state = 'idle';
    buildGarden();
    makeCats();
    resetPositions();
    updateHud();
    draw();
    showOverlay("Sparrow's Garden", 'Peck every seed in the garden — mind the cats.');
}

init();
