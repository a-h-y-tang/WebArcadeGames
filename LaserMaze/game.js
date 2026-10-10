// Laser Maze — rotate mirrors and beam splitters so one laser lights every
// target ring without touching a mine.
//
// Everything lives on the global scope on purpose: the Playwright suite drives
// the engine directly (loadLevel, rotate, traceBeam, retrace, step, draw).

const COLS = 10;
const ROWS = 8;
const TILE = 60;

// Direction indices: 0 = East, 1 = South, 2 = West, 3 = North.
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
// A diagonal mirror maps each incoming direction to an outgoing one.
const SLASH = [3, 2, 1, 0];      // '/'  : E->N  S->W  W->S  N->E
const BACKSLASH = [1, 0, 3, 2];  // '\'  : E->S  S->E  W->N  N->W

// Level maps. One character per cell:
//   .  empty          #  wall             T  target ring      *  mine
//   >  < ^ v  emitter facing east/west/north/south
//   /  \  rotatable mirror starting in that orientation
//   A  B  rotatable beam splitter starting as '/' or '\'
//   (  )  fixed mirror ('/' or '\') that the player cannot turn
//
// `par` is the fewest rotations that solve the level from the printed start;
// every level below was brute-forced to confirm it is solvable and that par is
// exact.
const LEVELS = [
    {
        name: 'First Light',
        par: 1,
        rows: [
            '..........',
            '..........',
            '..>..../..',
            '..........',
            '..........',
            '.......T..',
            '..........',
            '..........',
        ],
    },
    {
        name: 'Double Back',
        par: 2,
        rows: [
            '..........',
            '>......./.',
            '..........',
            '..........',
            '....##....',
            '..........',
            '..T.....\\.',
            '..........',
        ],
    },
    {
        name: 'Crossfire',
        par: 2,
        rows: [
            '..........',
            '.......*..',
            '..........',
            '>..T.../..',
            '..........',
            '..........',
            '..T....\\..',
            '..........',
        ],
    },
    {
        name: 'Split Decision',
        par: 2,
        rows: [
            '....T.....',
            '..........',
            '..........',
            '>...B.../.',
            '..........',
            '..........',
            '....*...T.',
            '..........',
        ],
    },
    {
        name: 'Switchback',
        par: 3,
        rows: [
            '>......./.',
            '.T........',
            '....##....',
            '..........',
            './...T..\\.',
            '..........',
            '.*........',
            '..........',
        ],
    },
    {
        name: 'Triple Threat',
        par: 2,
        rows: [
            '......T...',
            '...T......',
            '..........',
            '>..B..B..T',
            '..........',
            '..........',
            '...*..*...',
            '..........',
        ],
    },
    {
        name: 'Labyrinth',
        par: 3,
        rows: [
            '..........',
            '...T..)...',
            '..........',
            '......T...',
            '*.\\..T..#.',
            '..........',
            '>.B...\\...',
            '......*...',
        ],
    },
    {
        name: 'Grand Prism',
        par: 3,
        rows: [
            '>...A.../.',
            '..........',
            '....T.....',
            '.*......T.',
            '..........',
            '....A..T(.',
            '.*........',
            '..../..T#.',
        ],
    },
];

const BEST_KEY = 'lasermaze-best';
const PROGRESS_KEY = 'lasermaze-progress';

let grid = [];
let level = 0;
let moves = 0;
let state = 'playing';           // 'playing' | 'solved' | 'complete'
let beam = { segments: [], lit: new Set(), litCount: 0, targets: 0, hitMine: false };
let cursor = { c: 0, r: 0 };
let message = '';
let bests = {};
let progress = 1;                // highest level number unlocked (1-based)
let pulse = 0;
let autoStep = true;

let canvas = null;
let ctx = null;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function loadSaved() {
    try {
        bests = JSON.parse(window.localStorage.getItem(BEST_KEY)) || {};
    } catch (err) {
        bests = {};
    }
    if (!bests || typeof bests !== 'object') bests = {};
    const stored = Number(window.localStorage.getItem(PROGRESS_KEY));
    progress = Number.isFinite(stored) && stored >= 1 ? Math.min(stored, LEVELS.length) : 1;
}

function save() {
    try {
        window.localStorage.setItem(BEST_KEY, JSON.stringify(bests));
        window.localStorage.setItem(PROGRESS_KEY, String(progress));
    } catch (err) {
        /* storage can be unavailable; scores are a nicety, not a requirement */
    }
}

// ---------------------------------------------------------------------------
// Level setup
// ---------------------------------------------------------------------------

function cellFromChar(ch) {
    switch (ch) {
        case '#': return { kind: 'wall' };
        case '>': return { kind: 'emitter', dir: 0 };
        case 'v': return { kind: 'emitter', dir: 1 };
        case '<': return { kind: 'emitter', dir: 2 };
        case '^': return { kind: 'emitter', dir: 3 };
        case '/': return { kind: 'mirror', state: 0 };
        case '\\': return { kind: 'mirror', state: 1 };
        case 'A': return { kind: 'splitter', state: 0 };
        case 'B': return { kind: 'splitter', state: 1 };
        case '(': return { kind: 'mirror', state: 0, fixed: true };
        case ')': return { kind: 'mirror', state: 1, fixed: true };
        case 'T': return { kind: 'target', lit: false };
        case '*': return { kind: 'mine' };
        default: return { kind: 'empty' };
    }
}

function loadLevel(index) {
    level = Math.max(0, Math.min(LEVELS.length - 1, index));
    grid = LEVELS[level].rows.map((row) => [...row].map(cellFromChar));
    moves = 0;
    state = 'playing';
    cursor = { c: 0, r: 0 };
    hideOverlay();
    retrace();
    renderLevelButtons();
}

function resetLevel() {
    loadLevel(level);
}

function nextLevel() {
    if (level + 1 < LEVELS.length) loadLevel(level + 1);
}

// ---------------------------------------------------------------------------
// Beam tracing
// ---------------------------------------------------------------------------

const centre = (c, r) => ({ x: (c + 0.5) * TILE, y: (r + 0.5) * TILE });

function countTargets() {
    let total = 0;
    for (const row of grid) for (const cell of row) if (cell.kind === 'target') total++;
    return total;
}

// Walk the beam from the emitter, collecting the segments to draw and the
// targets it passes through. Splitters push a second beam onto the stack; the
// `seen` set makes a mirror loop terminate instead of spinning forever. Pure:
// it reads the board but never changes it.
function traceBeam() {
    const segments = [];
    const lit = new Set();
    const seen = new Set();
    let hitMine = false;
    const stack = [];

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = grid[r][c];
            if (cell.kind !== 'emitter') continue;
            const [dx, dy] = DIRS[cell.dir];
            stack.push({ c: c + dx, r: r + dy, d: cell.dir, from: centre(c, r) });
        }
    }

    while (stack.length) {
        const branch = stack.pop();
        let { c, r, d } = branch;
        let start = branch.from;   // where the current straight run began
        let last = branch.from;    // last point the beam actually reached
        const flush = (to) => {
            if (to.x !== start.x || to.y !== start.y) {
                segments.push({ x1: start.x, y1: start.y, x2: to.x, y2: to.y });
            }
        };

        for (;;) {
            const [dx, dy] = DIRS[d];
            if (c < 0 || r < 0 || c >= COLS || r >= ROWS) {
                // Run half a cell past the edge so the beam visibly leaves.
                flush({ x: last.x + dx * TILE / 2, y: last.y + dy * TILE / 2 });
                break;
            }
            const key = `${c},${r},${d}`;
            if (seen.has(key)) {
                flush(last);
                break;
            }
            seen.add(key);

            const cell = grid[r][c];
            const mid = centre(c, r);

            if (cell.kind === 'wall' || cell.kind === 'emitter') {
                flush({ x: mid.x - dx * TILE / 2, y: mid.y - dy * TILE / 2 });
                break;
            }

            last = mid;

            if (cell.kind === 'mine') {
                flush(mid);
                hitMine = true;
                break;
            }
            if (cell.kind === 'target') lit.add(`${c},${r}`);

            if (cell.kind === 'mirror') {
                const turned = (cell.state === 0 ? SLASH : BACKSLASH)[d];
                if (turned !== d) {
                    flush(mid);
                    start = mid;
                }
                d = turned;
            } else if (cell.kind === 'splitter') {
                const rd = (cell.state === 0 ? SLASH : BACKSLASH)[d];
                stack.push({ c: c + DIRS[rd][0], r: r + DIRS[rd][1], d: rd, from: mid });
            }

            c += DIRS[d][0];
            r += DIRS[d][1];
        }
    }

    const targets = countTargets();
    return { segments, lit, litCount: lit.size, targets, hitMine };
}

const solved = () => beam.targets > 0 && beam.litCount === beam.targets && !beam.hitMine;

// Re-run the trace and push the result into the board, the HUD and the
// solved/complete state. Called after every change to the board.
function retrace() {
    beam = traceBeam();
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (grid[r][c].kind === 'target') grid[r][c].lit = beam.lit.has(`${c},${r}`);
        }
    }
    message = beam.hitMine ? 'A mine is swallowing the beam!' : '';
    if (state === 'playing' && solved()) finishLevel();
    updateHud();
}

function finishLevel() {
    const number = String(level + 1);
    const previous = bests[number];
    if (!(previous >= 0) || moves < previous) bests[number] = moves;
    progress = Math.max(progress, Math.min(level + 2, LEVELS.length));
    save();

    const last = level + 1 >= LEVELS.length;
    state = last ? 'complete' : 'solved';
    const plural = moves === 1 ? 'move' : 'moves';
    showOverlay(
        last ? 'ALL LEVELS COMPLETE' : 'LEVEL SOLVED',
        `${moves} ${plural} — par ${LEVELS[level].par}${last ? '. Every beam is home.' : ''}`,
        !last,
    );
    renderLevelButtons();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

// Flip a mirror or splitter between its two diagonals. Returns whether the
// board actually changed, so callers know whether to count a move.
function rotate(c, r) {
    if (state !== 'playing') return false;
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
    const cell = grid[r][c];
    if (cell.kind !== 'mirror' && cell.kind !== 'splitter') return false;
    if (cell.fixed) return false;
    cell.state = cell.state === 0 ? 1 : 0;
    moves++;
    retrace();
    return true;
}

function cellFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = (COLS * TILE) / rect.width;
    const scaleY = (ROWS * TILE) / rect.height;
    const c = Math.floor((event.clientX - rect.left) * scaleX / TILE);
    const r = Math.floor((event.clientY - rect.top) * scaleY / TILE);
    return { c, r };
}

function onCanvasClick(event) {
    const { c, r } = cellFromEvent(event);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
    cursor = { c, r };
    rotate(c, r);
}

function onKeyDown(event) {
    const key = event.key;
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        event.preventDefault();
        if (key === 'ArrowLeft') cursor.c = Math.max(0, cursor.c - 1);
        if (key === 'ArrowRight') cursor.c = Math.min(COLS - 1, cursor.c + 1);
        if (key === 'ArrowUp') cursor.r = Math.max(0, cursor.r - 1);
        if (key === 'ArrowDown') cursor.r = Math.min(ROWS - 1, cursor.r + 1);
        return;
    }
    if (key === ' ' || key === 'Enter') {
        event.preventDefault();
        rotate(cursor.c, cursor.r);
        return;
    }
    if (key === 'r' || key === 'R') {
        resetLevel();
        return;
    }
    if (key === 'n' || key === 'N') {
        if (state === 'solved') nextLevel();
    }
}

// ---------------------------------------------------------------------------
// HUD / DOM
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

function updateHud() {
    $('level').textContent = String(level + 1);
    $('level-name').textContent = LEVELS[level].name;
    $('targets').textContent = `${beam.litCount} / ${beam.targets}`;
    $('moves').textContent = String(moves);
    $('par').textContent = String(LEVELS[level].par);
    const best = bests[String(level + 1)];
    $('best').textContent = best >= 0 ? String(best) : '—';
    $('message').textContent = message;
}

function showOverlay(title, sub, showNext) {
    $('overlay-title').textContent = title;
    $('overlay-sub').textContent = sub;
    $('btn-next').hidden = !showNext;
    $('overlay').classList.add('visible');
}

function hideOverlay() {
    $('overlay').classList.remove('visible');
}

function renderLevelButtons() {
    const host = $('level-select');
    if (!host) return;
    host.innerHTML = '';
    LEVELS.forEach((lv, i) => {
        const button = document.createElement('button');
        button.className = 'level-btn';
        button.textContent = String(i + 1);
        button.dataset.level = String(i);
        button.title = i + 1 <= progress ? lv.name : 'Locked';
        button.disabled = i + 1 > progress;
        if (i === level) button.classList.add('current');
        if (bests[String(i + 1)] >= 0) button.classList.add('cleared');
        button.addEventListener('click', () => loadLevel(i));
        host.appendChild(button);
    });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function step(dt) {
    pulse += dt;
}

function drawGridLines() {
    ctx.strokeStyle = 'rgba(80, 104, 150, 0.18)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(c * TILE + 0.5, 0);
        ctx.lineTo(c * TILE + 0.5, ROWS * TILE);
        ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * TILE + 0.5);
        ctx.lineTo(COLS * TILE, r * TILE + 0.5);
        ctx.stroke();
    }
}

function drawWall(x, y) {
    ctx.fillStyle = '#2b3550';
    ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
    ctx.strokeStyle = '#43527a';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3.5, y + 3.5, TILE - 7, TILE - 7);
    ctx.strokeStyle = 'rgba(16, 22, 38, 0.8)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 3 + i * (TILE - 6) / 3);
        ctx.lineTo(x + TILE - 3, y + 3 + i * (TILE - 6) / 3);
        ctx.stroke();
    }
}

function drawEmitter(x, y, dir) {
    const cx = x + TILE / 2;
    const cy = y + TILE / 2;
    const glow = 0.6 + 0.4 * Math.sin(pulse * 5);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(dir * Math.PI / 2);
    ctx.fillStyle = '#5e708f';
    ctx.beginPath();
    ctx.roundRect(-20, -16, 30, 32, 6);
    ctx.fill();
    ctx.strokeStyle = '#8fa6d4';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#39445e';
    ctx.fillRect(-14, -9, 8, 18);
    ctx.fillStyle = '#9db3e0';
    ctx.beginPath();
    ctx.roundRect(-2, -7, 20, 14, 3);
    ctx.fill();
    const lens = ctx.createRadialGradient(16, 0, 1, 16, 0, 12);
    lens.addColorStop(0, `rgba(255, 240, 240, ${glow})`);
    lens.addColorStop(0.4, `rgba(255, 93, 115, ${glow})`);
    lens.addColorStop(1, 'rgba(255, 93, 115, 0)');
    ctx.fillStyle = lens;
    ctx.beginPath();
    ctx.arc(16, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawMirror(x, y, cell) {
    const pad = 11;
    if (!cell.fixed) {
        ctx.fillStyle = 'rgba(103, 132, 193, 0.12)';
        ctx.beginPath();
        ctx.roundRect(x + 5, y + 5, TILE - 10, TILE - 10, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(126, 158, 221, 0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    const slash = cell.state === 0;
    const x1 = x + pad;
    const y1 = slash ? y + TILE - pad : y + pad;
    const x2 = x + TILE - pad;
    const y2 = slash ? y + pad : y + TILE - pad;

    if (cell.kind === 'splitter') {
        ctx.strokeStyle = 'rgba(142, 240, 255, 0.35)';
        ctx.lineWidth = 11;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.strokeStyle = '#8ef0ff';
        ctx.lineWidth = 3;
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
    } else {
        ctx.strokeStyle = cell.fixed ? 'rgba(255, 196, 120, 0.3)' : 'rgba(220, 234, 255, 0.28)';
        ctx.lineWidth = 11;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        if (cell.fixed) {
            gradient.addColorStop(0, '#ffd59a');
            gradient.addColorStop(0.5, '#ffb259');
            gradient.addColorStop(1, '#c47a28');
        } else {
            gradient.addColorStop(0, '#ffffff');
            gradient.addColorStop(0.5, '#cfe0ff');
            gradient.addColorStop(1, '#7f93bd');
        }
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }
    ctx.lineCap = 'butt';
}

function drawTarget(x, y, lit) {
    const cx = x + TILE / 2;
    const cy = y + TILE / 2;
    if (lit) {
        const glow = 14 + 4 * Math.sin(pulse * 6);
        const halo = ctx.createRadialGradient(cx, cy, 2, cx, cy, glow + 10);
        halo.addColorStop(0, 'rgba(123, 255, 176, 0.8)');
        halo.addColorStop(1, 'rgba(123, 255, 176, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, glow + 10, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.strokeStyle = lit ? '#7bffb0' : '#8295bd';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = lit ? 'rgba(123, 255, 176, 0.85)' : 'rgba(130, 149, 189, 0.35)';
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
}

function drawMine(x, y) {
    const cx = x + TILE / 2;
    const cy = y + TILE / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(pulse * 0.6);
    ctx.fillStyle = '#ff5d73';
    for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.lineTo(4, -12);
        ctx.lineTo(-4, -12);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#7a1f2d';
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff8c9c';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawBeam() {
    if (!beam.segments.length) return;
    const flicker = 0.85 + 0.15 * Math.sin(pulse * 9);
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(255, 70, 100, ${0.22 * flicker})`;
    ctx.lineWidth = 14;
    for (const s of beam.segments) {
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
    }
    ctx.strokeStyle = `rgba(255, 120, 150, ${0.55 * flicker})`;
    ctx.lineWidth = 6;
    for (const s of beam.segments) {
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
    }
    ctx.strokeStyle = `rgba(255, 245, 245, ${0.9 * flicker})`;
    ctx.lineWidth = 2;
    for (const s of beam.segments) {
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
    }
    ctx.lineCap = 'butt';
}

function drawCursor() {
    const x = cursor.c * TILE;
    const y = cursor.r * TILE;
    const cell = grid[cursor.r] && grid[cursor.r][cursor.c];
    const turnable = cell && (cell.kind === 'mirror' || cell.kind === 'splitter') && !cell.fixed;
    ctx.strokeStyle = turnable ? 'rgba(142, 240, 255, 0.9)' : 'rgba(142, 240, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.setLineDash([]);
}

function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, COLS * TILE, ROWS * TILE);
    const sky = ctx.createLinearGradient(0, 0, 0, ROWS * TILE);
    sky.addColorStop(0, '#111a2c');
    sky.addColorStop(1, '#070a12');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, COLS * TILE, ROWS * TILE);
    drawGridLines();

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = grid[r][c];
            const x = c * TILE;
            const y = r * TILE;
            if (cell.kind === 'wall') drawWall(x, y);
            else if (cell.kind === 'mine') drawMine(x, y);
        }
    }

    drawBeam();

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = grid[r][c];
            const x = c * TILE;
            const y = r * TILE;
            if (cell.kind === 'emitter') drawEmitter(x, y, cell.dir);
            else if (cell.kind === 'mirror' || cell.kind === 'splitter') drawMirror(x, y, cell);
            else if (cell.kind === 'target') drawTarget(x, y, cell.lit);
        }
    }

    drawCursor();
}

let lastFrame = 0;

function frame(now) {
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (autoStep) step(dt);
    draw();
    window.requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function init() {
    canvas = $('canvas');
    ctx = canvas.getContext('2d');
    loadSaved();
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const { c, r } = cellFromEvent(event);
        rotate(c, r);
    });
    window.addEventListener('keydown', onKeyDown);
    $('btn-reset').addEventListener('click', resetLevel);
    $('btn-next').addEventListener('click', nextLevel);
    loadLevel(Math.min(progress - 1, LEVELS.length - 1));
    draw();
    window.requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
