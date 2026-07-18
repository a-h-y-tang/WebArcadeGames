'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const COLS = 8;                 // bottle width
const ROWS = 16;                // bottle height
const CELL = 30;                // pixels per cell
const WIDTH = COLS * CELL;      // 240
const HEIGHT = ROWS * CELL;     // 480
const NUM_COLORS = 3;           // red, blue, yellow
const MATCH_LEN = 4;            // clear 4+ in a line
const VIRUS_MIN_ROW = 6;        // viruses only spawn at row 6 or below

// Colour palette [red, blue, yellow] with a darker shade for depth.
const COLORS = ['#f85149', '#58a6ff', '#f2cc60'];
const COLORS_DARK = ['#a01f1a', '#1f6feb', '#a17f16'];
const COLORS_LIGHT = ['#ff9d97', '#a5d6ff', '#ffe08a'];

// Second-half offset for each of the four capsule orientations.
const SECOND_OFFSET = [
    { dr: 0, dc: 1 },   // 0: horizontal, partner to the right
    { dr: 1, dc: 0 },   // 1: vertical,   partner below
    { dr: 0, dc: -1 },  // 2: horizontal, partner to the left
    { dr: -1, dc: 0 },  // 3: vertical,   partner above
];

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const levelEl = document.getElementById('level');
const virusesEl = document.getElementById('viruses');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// State (exposed as script-scope globals for the Playwright suite)
// ---------------------------------------------------------------------------
let grid;                       // grid[r][c] = null | { color, kind:'virus'|'capsule' }
let capsule;                    // { r, c, orient, colors:[a,b] } | null
let state;                      // 'idle' | 'playing' | 'won' | 'lost' | 'paused'
let score;
let best;
let level;
let levelViruses;               // viruses placed when the current level began
let autoDrop = true;            // test hook: false freezes the gravity timer
let frame = 0;                  // animation counter (no Date usage)

// ---------------------------------------------------------------------------
// Seeded RNG (deterministic — see design.md)
// ---------------------------------------------------------------------------
let rngState = 1;
function setSeed(n) {
    rngState = (n >>> 0) || 1;
}
function rng() {
    // Numerical Recipes LCG.
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
}
function randInt(n) {
    return Math.floor(rng() * n);
}
function randColor() {
    return randInt(NUM_COLORS);
}
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = randInt(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------
function emptyGrid() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function virusCount() {
    let n = 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (grid[r][c] && grid[r][c].kind === 'virus') n++;
        }
    }
    return n;
}

// Does placing the (already-set) cell at (r,c) create a run of 3+ same colour?
function createsRun3(r, c) {
    const color = grid[r][c].color;
    let h = 1;
    for (let cc = c - 1; cc >= 0 && grid[r][cc] && grid[r][cc].color === color; cc--) h++;
    for (let cc = c + 1; cc < COLS && grid[r][cc] && grid[r][cc].color === color; cc++) h++;
    if (h >= 3) return true;
    let v = 1;
    for (let rr = r - 1; rr >= 0 && grid[rr][c] && grid[rr][c].color === color; rr--) v++;
    for (let rr = r + 1; rr < ROWS && grid[rr][c] && grid[rr][c].color === color; rr++) v++;
    return v >= 3;
}

function virusesForLevel(lvl) {
    return Math.min(4 + lvl * 4, 64);
}

function placeViruses(n) {
    let placed = 0;
    let attempts = 0;
    const region = (ROWS - VIRUS_MIN_ROW) * COLS;
    n = Math.min(n, region - 4);
    while (placed < n && attempts < 5000) {
        attempts++;
        const r = VIRUS_MIN_ROW + randInt(ROWS - VIRUS_MIN_ROW);
        const c = randInt(COLS);
        if (grid[r][c]) continue;
        let chosen = -1;
        for (const col of shuffle([0, 1, 2])) {
            grid[r][c] = { color: col, kind: 'virus' };
            if (!createsRun3(r, c)) { chosen = col; break; }
            grid[r][c] = null;
        }
        if (chosen === -1) continue;
        placed++;
    }
    levelViruses = placed;
}

// ---------------------------------------------------------------------------
// Capsule geometry
// ---------------------------------------------------------------------------
function cellsFor(cap) {
    const off = SECOND_OFFSET[cap.orient];
    return [
        { r: cap.r, c: cap.c, color: cap.colors[0], kind: 'capsule' },
        { r: cap.r + off.dr, c: cap.c + off.dc, color: cap.colors[1], kind: 'capsule' },
    ];
}

function capsuleCells() {
    return capsule ? cellsFor(capsule) : [];
}

// Can the given capsule occupy the board (both halves in bounds & empty)?
function fits(cap) {
    for (const cell of cellsFor(cap)) {
        if (!inBounds(cell.r, cell.c)) return false;
        if (grid[cell.r][cell.c] !== null) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------
function tryMove(dr, dc) {
    if (!capsule || state !== 'playing') return false;
    const cand = { ...capsule, r: capsule.r + dr, c: capsule.c + dc };
    if (fits(cand)) {
        capsule = cand;
        draw();
        return true;
    }
    return false;
}

function moveLeft() { return tryMove(0, -1); }
function moveRight() { return tryMove(0, 1); }

function rotate(ccw) {
    if (!capsule || state !== 'playing') return false;
    const newOrient = (capsule.orient + (ccw ? 3 : 1)) % 4;
    // Wall/floor kicks: try in place, then nudge one cell.
    const kicks = [
        { dr: 0, dc: 0 },
        { dr: 0, dc: -1 },
        { dr: 0, dc: 1 },
        { dr: -1, dc: 0 },
    ];
    for (const k of kicks) {
        const cand = {
            ...capsule,
            orient: newOrient,
            r: capsule.r + k.dr,
            c: capsule.c + k.dc,
        };
        if (fits(cand)) {
            capsule = cand;
            draw();
            return true;
        }
    }
    return false;
}

function softDrop() {
    if (!capsule || state !== 'playing') return;
    const cand = { ...capsule, r: capsule.r + 1 };
    if (fits(cand)) {
        capsule = cand;
        draw();
    } else {
        lockCapsule();
    }
}

function hardDrop() {
    if (!capsule || state !== 'playing') return;
    while (true) {
        const cand = { ...capsule, r: capsule.r + 1 };
        if (fits(cand)) capsule = cand;
        else break;
    }
    lockCapsule();
}

function lockCapsule() {
    for (const cell of cellsFor(capsule)) {
        grid[cell.r][cell.c] = { color: cell.color, kind: 'capsule' };
    }
    capsule = null;
    resolveBoard();
    if (state === 'playing') spawnNext();
    updateHud();
    draw();
}

// ---------------------------------------------------------------------------
// Matching / gravity / resolution
// ---------------------------------------------------------------------------
function findMatches() {
    const marked = new Set();

    // Horizontal runs.
    for (let r = 0; r < ROWS; r++) {
        let runStart = 0;
        for (let c = 1; c <= COLS; c++) {
            const prev = grid[r][c - 1];
            const cur = c < COLS ? grid[r][c] : null;
            const same = cur && prev && cur.color === prev.color;
            if (!same) {
                if (prev && c - runStart >= MATCH_LEN) {
                    for (let k = runStart; k < c; k++) marked.add(r * COLS + k);
                }
                runStart = c;
            }
        }
    }

    // Vertical runs.
    for (let c = 0; c < COLS; c++) {
        let runStart = 0;
        for (let r = 1; r <= ROWS; r++) {
            const prev = grid[r - 1][c];
            const cur = r < ROWS ? grid[r][c] : null;
            const same = cur && prev && cur.color === prev.color;
            if (!same) {
                if (prev && r - runStart >= MATCH_LEN) {
                    for (let k = runStart; k < r; k++) marked.add(k * COLS + c);
                }
                runStart = r;
            }
        }
    }

    return [...marked].map((idx) => ({ r: Math.floor(idx / COLS), c: idx % COLS }));
}

// Only capsule cells fall; viruses are fixed.
function applyGravity() {
    let moved = true;
    while (moved) {
        moved = false;
        for (let r = ROWS - 2; r >= 0; r--) {
            for (let c = 0; c < COLS; c++) {
                const cell = grid[r][c];
                if (cell && cell.kind === 'capsule' && grid[r + 1][c] === null) {
                    grid[r + 1][c] = cell;
                    grid[r][c] = null;
                    moved = true;
                }
            }
        }
    }
}

function resolveBoard() {
    const virusesBefore = virusCount();
    let combo = 0;
    let cleared = false;

    while (true) {
        const matches = findMatches();
        if (matches.length === 0) break;
        combo++;
        cleared = true;
        let virusesHere = 0;
        for (const { r, c } of matches) {
            if (grid[r][c].kind === 'virus') virusesHere++;
            grid[r][c] = null;
        }
        score += matches.length * 10 + virusesHere * 100 * combo;
        applyGravity();
    }

    if (cleared) updateBest();
    updateHud();

    if (virusesBefore > 0 && virusCount() === 0) {
        winLevel();
    }
    return cleared;
}

// ---------------------------------------------------------------------------
// Spawning, win / lose
// ---------------------------------------------------------------------------
function spawnNext() {
    const cap = { r: 0, c: 3, orient: 0, colors: [randColor(), randColor()] };
    if (!fits(cap)) {
        capsule = null;
        loseGame();
        return false;
    }
    capsule = cap;
    draw();
    return true;
}

function winLevel() {
    score += 1000;
    level++;
    updateBest();
    state = 'won';
    capsule = null;
    updateHud();
    showOverlay('Level cleared!', `Score: ${score}`, 'Press Space for the next level');
}

function loseGame() {
    state = 'lost';
    updateBest();
    updateHud();
    showOverlay('Game Over', `Score: ${score}`, 'Press Space to try again');
}

// ---------------------------------------------------------------------------
// Level / game lifecycle
// ---------------------------------------------------------------------------
function beginLevel() {
    grid = emptyGrid();
    placeViruses(virusesForLevel(level));
    state = 'playing';
    hideOverlay();
    capsule = null;
    spawnNext();
    updateHud();
    draw();
}

function startGame(seed) {
    if (seed !== undefined) setSeed(seed);
    else setSeed(Math.floor(Math.random() * 0xffffffff) + 1);
    score = 0;
    level = 1;
    beginLevel();
}

// Test hook: install an exact board from a character map.
// '.' empty · R/B/Y virus (red/blue/yellow) · r/b/y capsule half.
function loadGrid(rows) {
    grid = emptyGrid();
    for (let r = 0; r < rows.length && r < ROWS; r++) {
        const line = rows[r];
        for (let c = 0; c < line.length && c < COLS; c++) {
            const ch = line[c];
            if (ch === '.') continue;
            const lower = ch.toLowerCase();
            const color = lower === 'r' ? 0 : lower === 'b' ? 1 : lower === 'y' ? 2 : -1;
            if (color < 0) continue;
            const kind = ch === ch.toUpperCase() ? 'virus' : 'capsule';
            grid[r][c] = { color, kind };
        }
    }
    capsule = null;
    state = 'playing';
    updateHud();
    draw();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------
function loadBest() {
    best = Number(localStorage.getItem('pilldrop.best') || '0') || 0;
}

function updateBest() {
    if (score > best) {
        best = score;
        localStorage.setItem('pilldrop.best', String(best));
    }
}

function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    levelEl.textContent = String(level);
    virusesEl.textContent = String(virusCount());
}

function showOverlay(title, scoreText, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText || '';
    overlaySub.textContent = sub || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
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

function drawCapsuleCell(r, c, color) {
    const x = c * CELL;
    const y = r * CELL;
    const pad = 2;
    ctx.fillStyle = COLORS[color];
    roundRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 8);
    ctx.fill();
    // glossy highlight
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    roundRect(x + pad + 3, y + pad + 3, CELL - pad * 2 - 6, (CELL - pad * 2) / 2 - 3, 5);
    ctx.fill();
}

function drawVirus(r, c, color) {
    const x = c * CELL;
    const y = r * CELL;
    const pad = 3;
    const wobble = Math.sin((frame + (r * 3 + c) * 12) * 0.08) * 1.2;
    ctx.fillStyle = COLORS_DARK[color];
    roundRect(x + pad, y + pad + wobble, CELL - pad * 2, CELL - pad * 2, 7);
    ctx.fill();
    ctx.fillStyle = COLORS[color];
    roundRect(x + pad + 2, y + pad + 2 + wobble, CELL - pad * 2 - 4, CELL - pad * 2 - 4, 6);
    ctx.fill();
    // eyes
    ctx.fillStyle = '#010409';
    const cx = x + CELL / 2;
    const ey = y + CELL / 2 - 2 + wobble;
    ctx.beginPath();
    ctx.arc(cx - 5, ey, 2.4, 0, Math.PI * 2);
    ctx.arc(cx + 5, ey, 2.4, 0, Math.PI * 2);
    ctx.fill();
    // mouth
    ctx.strokeStyle = '#010409';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, ey + 5, 4, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
}

function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#010409';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // faint grid
    ctx.strokeStyle = 'rgba(48,54,61,0.35)';
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(c * CELL, 0);
        ctx.lineTo(c * CELL, HEIGHT);
        ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * CELL);
        ctx.lineTo(WIDTH, r * CELL);
        ctx.stroke();
    }

    if (grid) {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const cell = grid[r][c];
                if (!cell) continue;
                if (cell.kind === 'virus') drawVirus(r, c, cell.color);
                else drawCapsuleCell(r, c, cell.color);
            }
        }
    }

    if (capsule) {
        // connector between the two halves
        const cells = cellsFor(capsule);
        for (const cell of cells) {
            if (inBounds(cell.r, cell.c)) drawCapsuleCell(cell.r, cell.c, cell.color);
        }
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function pressStart() {
    if (state === 'won') beginLevel();
    else startGame();
}

document.addEventListener('keydown', (e) => {
    const k = e.key;

    // Paused: only P resumes.
    if (state === 'paused') {
        if (k === 'p' || k === 'P') {
            e.preventDefault();
            hideOverlay();
            state = 'playing';
        }
        return;
    }

    // Not playing (idle / won / lost): Space or Enter starts / continues.
    if (state !== 'playing') {
        if (k === ' ' || k === 'Enter') {
            e.preventDefault();
            pressStart();
        }
        return;
    }

    switch (k) {
        case 'ArrowLeft': case 'a': case 'A': e.preventDefault(); moveLeft(); break;
        case 'ArrowRight': case 'd': case 'D': e.preventDefault(); moveRight(); break;
        case 'ArrowUp': case 'w': case 'W': case 'x': case 'X': e.preventDefault(); rotate(false); break;
        case 'z': case 'Z': e.preventDefault(); rotate(true); break;
        case 'ArrowDown': case 's': case 'S': e.preventDefault(); softDrop(); break;
        case ' ': e.preventDefault(); hardDrop(); break;
        case 'p': case 'P': e.preventDefault(); state = 'paused'; showOverlay('Paused', '', 'Press P to resume'); break;
        default: break;
    }
});

btnStart.addEventListener('click', pressStart);

// ---------------------------------------------------------------------------
// Timers & animation
// ---------------------------------------------------------------------------
function dropInterval() {
    return Math.max(150, 720 - (level - 1) * 60);
}

let dropAccumulator = 0;
let lastStep = 0;

function tick() {
    frame++;
    if (state === 'playing' && autoDrop) {
        dropAccumulator++;
        // ~60fps; step down every dropInterval ms worth of frames
        if (dropAccumulator * 16.7 >= dropInterval()) {
            dropAccumulator = 0;
            softDrop();
        }
    }
    draw();
    requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
grid = emptyGrid();
capsule = null;
state = 'idle';
score = 0;
level = 1;
loadBest();
updateHud();
draw();
requestAnimationFrame(tick);
