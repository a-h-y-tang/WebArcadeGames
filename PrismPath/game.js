// Prism Path — route a laser through mirrors, prisms and colour filters until
// every target glows in the colour it asks for.
//
// The board is a 10x10 grid of cells. Everything except the mirrors is fixed,
// so a level is a pure routing puzzle: flip mirrors, re-trace, check targets.
// State lives in top-level bindings (grid, state, level, moves, score, beams,
// cursor) on purpose — the Playwright suite drives the game through exactly
// these names. See DESIGN.md for the rules behind the constants.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const GRID_W = 10;
const GRID_H = 10;
const CELL = 48;                     // canvas is GRID_W * CELL square
const MAX_BEAM_STEPS = 4000;         // belt to the visited-state braces

// Colours are 3-bit masks over red / green / blue.
const R = 1, G = 2, B = 4;
const MASKS = {
    r: R, g: G, b: B,
    y: R | G, c: G | B, m: R | B, w: R | G | B,
};
const WHITE = MASKS.w;

const INK = {
    1: '#ff4d4d',                    // red
    2: '#45e06a',                    // green
    4: '#5aa9ff',                    // blue
    3: '#ffd24d',                    // yellow
    6: '#4de3e3',                    // cyan
    5: '#ff5ae0',                    // magenta
    7: '#ffffff',                    // white
};

const DIRS = {
    right: { dx: 1, dy: 0 },
    left: { dx: -1, dy: 0 },
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
};

// A '/' mirror runs bottom-left to top-right, a '\' mirror top-left to
// bottom-right. Reflection is just a lookup.
const REFLECT = {
    '/': { right: 'up', left: 'down', up: 'right', down: 'left' },
    '\\': { right: 'down', left: 'up', up: 'left', down: 'right' },
};

const EMITTER_DIRS = { '>': 'right', '<': 'left', '^': 'up', 'v': 'down' };

const BEST_KEY = 'prismpath-best';
const CLEAR_SCORE = 100;             // paid for solving a level at all
const PAR_BONUS = 25;                // per move saved against par

// --- levels ----------------------------------------------------------------
// '.' empty   '#' wall   '>' '<' '^' 'v' emitter   '/' '\' mirror (turnable)
// '(' ')' prism   'r g b y c m' filter   'R G B Y C M W' target

const levels = [
    {
        name: 'First Light',
        par: 1,
        rows: [
            '..........',
            '..........',
            '..........',
            '..........',
            '>.../.....',
            '..........',
            '..........',
            '....W.....',
            '..........',
            '..........',
        ],
    },
    {
        name: 'Red Shift',
        par: 2,
        rows: [
            '>....../..',
            '..........',
            '..........',
            '...#......',
            '..........',
            '.......r..',
            '..........',
            '..........',
            '..R....\\..',
            '..........',
        ],
    },
    {
        name: 'Split Decision',
        par: 2,
        rows: [
            '..........',
            '........W.',
            '..........',
            '..........',
            '>...)...\\.',
            '..........',
            '..........',
            '..........',
            '..../...W.',
            '..........',
        ],
    },
    {
        name: 'Two Tone',
        par: 3,
        rows: [
            '....v.....',
            '\\..R......',
            '..........',
            '..........',
            '/.r.(.....',
            '..........',
            '....b.....',
            '..........',
            '..../...B.',
            '..........',
        ],
    },
    {
        name: 'Crossfire',
        par: 4,
        rows: [
            '>../.#....',
            '..........',
            '......\\..C',
            '.#.g......',
            '..........',
            '......c...',
            'G..\\....#.',
            '..........',
            '..........',
            '....../..<',
        ],
    },
    {
        name: 'Grand Finale',
        par: 5,
        rows: [
            '....v.....',
            '..........',
            '....).y./.',
            '..........',
            '\\.b.(.....',
            '......Y.\\.',
            '..#.......',
            '....r..#..',
            '/.B.......',
            '..../...R.',
        ],
    },
];

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | playing | levelclear | won
let level = 1;                       // 1-based, for display
let levelIndex = 0;
let moves = 0;
let score = 0;
let best = loadBest();
let grid = [];                       // grid[y][x] cell objects
let beams = [];                      // drawable segments from the last trace
let pulse = 0;                       // cosmetic animation clock
const cursor = { x: 0, y: 0 };

function loadBest() {
    try {
        return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
        return 0;
    }
}

function saveBest() {
    try {
        localStorage.setItem(BEST_KEY, String(best));
    } catch (err) {
        /* storage can be blocked; the run still works without it */
    }
}

// --- board -----------------------------------------------------------------

function makeCell(ch) {
    if (ch === '#') return { type: 'wall' };
    if (EMITTER_DIRS[ch]) return { type: 'emitter', dir: EMITTER_DIRS[ch] };
    if (ch === '/' || ch === '\\') return { type: 'mirror', orient: ch };
    if (ch === '(') return { type: 'splitter', orient: '/' };
    if (ch === ')') return { type: 'splitter', orient: '\\' };
    if (MASKS[ch] !== undefined) return { type: 'filter', mask: MASKS[ch] };
    const upper = ch.toLowerCase();
    if (ch !== upper && MASKS[upper] !== undefined) {
        return { type: 'target', mask: MASKS[upper], lit: false };
    }
    return { type: 'empty' };
}

// Build the grid from ten ten-character rows. Exposed so a test can stand up
// a board of its own without going through the level list.
function loadBoard(rows) {
    grid = rows.map((row) => {
        const cells = [];
        for (let x = 0; x < GRID_W; x++) cells.push(makeCell(row[x] || '.'));
        return cells;
    });
    traceBeams();
    draw();
    return grid;
}

function cellAt(x, y) {
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return null;
    return grid[y][x];
}

// --- beam tracing ----------------------------------------------------------

function centerOf(x, y) {
    return { px: x * CELL + CELL / 2, py: y * CELL + CELL / 2 };
}

// Walk every beam from every emitter, filling `beams` with drawable segments
// and lighting the targets it reaches. A beam state is (cell, direction,
// colour); revisiting one ends that branch, which is what keeps mirror and
// prism loops from spinning forever.
function traceBeams() {
    beams = [];
    grid.forEach((row) => row.forEach((cell) => {
        if (cell.type === 'target') cell.lit = false;
    }));

    const queue = [];
    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            const cell = grid[y][x];
            if (cell.type === 'emitter') queue.push({ x, y, dir: cell.dir, color: WHITE });
        }
    }

    const seen = new Set();
    let steps = 0;

    while (queue.length && steps++ < MAX_BEAM_STEPS) {
        const { x, y, dir, color } = queue.shift();
        const { dx, dy } = DIRS[dir];
        const nx = x + dx;
        const ny = y + dy;
        const from = centerOf(x, y);

        const next = cellAt(nx, ny);
        if (!next) {
            // run off the edge of the board
            beams.push({ x1: from.px, y1: from.py, x2: from.px + dx * CELL, y2: from.py + dy * CELL, color });
            continue;
        }

        const key = `${nx},${ny},${dir},${color}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const to = centerOf(nx, ny);
        beams.push({ x1: from.px, y1: from.py, x2: to.px, y2: to.py, color });

        switch (next.type) {
            case 'wall':
            case 'emitter':
                break;
            case 'target':
                if (next.mask === color) next.lit = true;
                break;
            case 'filter': {
                const tinted = color & next.mask;
                if (tinted) queue.push({ x: nx, y: ny, dir, color: tinted });
                break;
            }
            case 'mirror':
                queue.push({ x: nx, y: ny, dir: REFLECT[next.orient][dir], color });
                break;
            case 'splitter':
                queue.push({ x: nx, y: ny, dir, color });
                queue.push({ x: nx, y: ny, dir: REFLECT[next.orient][dir], color });
                break;
            default:
                queue.push({ x: nx, y: ny, dir, color });
        }
    }

    return beams;
}

function isSolved() {
    const targets = grid.flat().filter((c) => c.type === 'target');
    return targets.length > 0 && targets.every((c) => c.lit);
}

// --- play ------------------------------------------------------------------

function loadLevel(index) {
    levelIndex = Math.max(0, Math.min(levels.length - 1, index));
    level = levelIndex + 1;
    moves = 0;
    state = 'playing';
    cursor.x = 0;
    cursor.y = 0;
    loadBoard(levels[levelIndex].rows);
    hideOverlay();
    updateHud();
    return grid;
}

function startGame() {
    score = 0;
    loadLevel(0);
}

function restartLevel() {
    loadLevel(levelIndex);
}

function nextLevel() {
    if (levelIndex + 1 < levels.length) loadLevel(levelIndex + 1);
    else startGame();
}

// Flip the mirror at (x, y). Returns true when the board actually changed.
function rotate(x, y) {
    if (state !== 'playing') return false;
    const cell = cellAt(x, y);
    if (!cell || cell.type !== 'mirror') return false;

    cell.orient = cell.orient === '/' ? '\\' : '/';
    moves++;
    traceBeams();
    if (isSolved()) clearLevel();
    updateHud();
    draw();
    return true;
}

function clearLevel() {
    const par = levels[levelIndex].par;
    score += CLEAR_SCORE + PAR_BONUS * Math.max(0, par - moves);
    if (score > best) {
        best = score;
        saveBest();
    }
    state = levelIndex + 1 < levels.length ? 'levelclear' : 'won';
    showOverlay();
}

// Space / Enter / a click outside play: start, or move on from a cleared level.
function advance() {
    if (state === 'idle' || state === 'won') startGame();
    else if (state === 'levelclear') nextLevel();
}

// --- HUD and overlay -------------------------------------------------------

const el = {
    level: document.getElementById('level'),
    moves: document.getElementById('moves'),
    par: document.getElementById('par'),
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    name: document.getElementById('level-name'),
    overlay: document.getElementById('overlay'),
    title: document.getElementById('overlay-title'),
    sub: document.getElementById('overlay-sub'),
    oscore: document.getElementById('overlay-score'),
    start: document.getElementById('btn-start'),
};

function updateHud() {
    el.level.textContent = String(level);
    el.moves.textContent = String(moves);
    el.par.textContent = String(levels[levelIndex].par);
    el.score.textContent = String(score);
    el.best.textContent = String(best);
    el.name.textContent = state === 'idle' ? '' : levels[levelIndex].name;
}

function hideOverlay() {
    el.overlay.classList.remove('visible');
}

function showOverlay() {
    if (state === 'levelclear') {
        el.title.textContent = 'LEVEL CLEAR';
        el.oscore.textContent = `${levels[levelIndex].name} solved in ${moves} ` +
            `${moves === 1 ? 'move' : 'moves'} — score ${score}`;
        el.sub.textContent = 'Press N or Space for the next level';
        el.start.textContent = 'Next Level';
    } else if (state === 'won') {
        el.title.textContent = 'LIGHT MASTER';
        el.oscore.textContent = `Every level solved — final score ${score} (best ${best})`;
        el.sub.textContent = 'Press Space to play again';
        el.start.textContent = 'Play Again';
    }
    el.overlay.classList.add('visible');
}

// --- rendering -------------------------------------------------------------

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // board
    ctx.fillStyle = '#0a1120';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(80, 110, 160, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID_W; i++) {
        ctx.beginPath();
        ctx.moveTo(i * CELL + 0.5, 0);
        ctx.lineTo(i * CELL + 0.5, canvas.height);
        ctx.stroke();
    }
    for (let i = 1; i < GRID_H; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * CELL + 0.5);
        ctx.lineTo(canvas.width, i * CELL + 0.5);
        ctx.stroke();
    }

    drawBeams();

    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) drawCell(x, y, grid[y][x]);
    }

    if (state === 'playing') drawCursor();
}

function drawBeams() {
    ctx.save();
    ctx.lineCap = 'round';
    // a wide soft pass under a tight bright one gives the beams their glow
    for (const pass of [{ w: 9, a: 0.18 }, { w: 3, a: 0.95 }]) {
        ctx.lineWidth = pass.w;
        ctx.globalAlpha = pass.a;
        for (const seg of beams) {
            ctx.strokeStyle = INK[seg.color] || '#ffffff';
            ctx.beginPath();
            ctx.moveTo(seg.x1, seg.y1);
            ctx.lineTo(seg.x2, seg.y2);
            ctx.stroke();
        }
    }
    ctx.restore();
}

function drawCell(x, y, cell) {
    const { px, py } = centerOf(x, y);
    const half = CELL / 2 - 6;

    switch (cell.type) {
        case 'wall':
            ctx.fillStyle = '#1b2742';
            roundRect(x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6, 6);
            ctx.fill();
            ctx.strokeStyle = '#2c3d61';
            ctx.lineWidth = 2;
            ctx.stroke();
            break;

        case 'emitter': {
            ctx.fillStyle = '#243352';
            roundRect(x * CELL + 5, y * CELL + 5, CELL - 10, CELL - 10, 8);
            ctx.fill();
            ctx.strokeStyle = '#4e6a9c';
            ctx.lineWidth = 2;
            ctx.stroke();
            const d = DIRS[cell.dir];
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(px + d.dx * 7, py + d.dy * 7, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 0.35;
            ctx.beginPath();
            ctx.arc(px + d.dx * 7, py + d.dy * 7, 11, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            break;
        }

        case 'mirror':
        case 'splitter': {
            const slash = cell.orient === '/';
            const x1 = px + (slash ? -half : -half);
            const y1 = py + (slash ? half : -half);
            const x2 = px + half;
            const y2 = py + (slash ? -half : half);
            if (cell.type === 'splitter') {
                ctx.strokeStyle = 'rgba(255, 210, 120, 0.9)';
                ctx.lineWidth = 7;
                ctx.setLineDash([7, 5]);
            } else {
                const grad = ctx.createLinearGradient(x1, y1, x2, y2);
                grad.addColorStop(0, '#f2f7ff');
                grad.addColorStop(1, '#8ea7cc');
                ctx.strokeStyle = grad;
                ctx.lineWidth = 6;
            }
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.setLineDash([]);
            break;
        }

        case 'filter': {
            const ink = INK[cell.mask];
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(Math.PI / 4);
            ctx.fillStyle = hexToRgba(ink, 0.3);
            ctx.strokeStyle = ink;
            ctx.lineWidth = 2;
            roundRect(-13, -13, 26, 26, 5);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
            break;
        }

        case 'target': {
            const ink = INK[cell.mask];
            const glow = cell.lit ? 1 : 0.28;
            ctx.save();
            ctx.globalAlpha = glow;
            ctx.fillStyle = ink;
            ctx.beginPath();
            ctx.arc(px, py, cell.lit ? 11 + Math.sin(pulse) * 1.2 : 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            ctx.strokeStyle = ink;
            ctx.lineWidth = cell.lit ? 3 : 2;
            ctx.globalAlpha = cell.lit ? 1 : 0.6;
            ctx.beginPath();
            ctx.arc(px, py, 17, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            if (cell.lit) {
                ctx.save();
                ctx.globalAlpha = 0.22;
                ctx.fillStyle = ink;
                ctx.beginPath();
                ctx.arc(px, py, 22 + Math.sin(pulse) * 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
            break;
        }

        default:
            break;
    }
}

function drawCursor() {
    const x = cursor.x * CELL;
    const y = cursor.y * CELL;
    const cell = cellAt(cursor.x, cursor.y);
    const turnable = cell && cell.type === 'mirror';
    ctx.strokeStyle = turnable ? '#7ad7ff' : 'rgba(122, 215, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash(turnable ? [] : [4, 4]);
    roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 7);
    ctx.stroke();
    ctx.setLineDash([]);
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// --- input -----------------------------------------------------------------

function moveCursor(dx, dy) {
    cursor.x = Math.max(0, Math.min(GRID_W - 1, cursor.x + dx));
    cursor.y = Math.max(0, Math.min(GRID_H - 1, cursor.y + dy));
    draw();
}

document.addEventListener('keydown', (e) => {
    switch (e.code) {
        case 'ArrowLeft': case 'KeyA': moveCursor(-1, 0); e.preventDefault(); break;
        case 'ArrowRight': case 'KeyD': moveCursor(1, 0); e.preventDefault(); break;
        case 'ArrowUp': case 'KeyW': moveCursor(0, -1); e.preventDefault(); break;
        case 'ArrowDown': case 'KeyS': moveCursor(0, 1); e.preventDefault(); break;
        case 'Space': case 'Enter':
            e.preventDefault();
            if (state === 'playing') rotate(cursor.x, cursor.y);
            else advance();
            break;
        case 'KeyR':
            if (state === 'playing') restartLevel();
            break;
        case 'KeyN':
            if (state === 'levelclear') nextLevel();
            break;
        default:
            break;
    }
});

function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: Math.floor(((e.clientX - rect.left) * scaleX) / CELL),
        y: Math.floor(((e.clientY - rect.top) * scaleY) / CELL),
    };
}

canvas.addEventListener('mousemove', (e) => {
    const { x, y } = cellFromEvent(e);
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return;
    cursor.x = x;
    cursor.y = y;
    draw();
});

canvas.addEventListener('click', (e) => {
    if (state !== 'playing') {
        advance();
        return;
    }
    const { x, y } = cellFromEvent(e);
    cursor.x = Math.max(0, Math.min(GRID_W - 1, x));
    cursor.y = Math.max(0, Math.min(GRID_H - 1, y));
    rotate(x, y);
});

el.start.addEventListener('click', () => advance());

// --- boot ------------------------------------------------------------------

function frame() {
    pulse += 0.08;
    draw();
    requestAnimationFrame(frame);
}

loadBoard(levels[0].rows);
updateHud();
requestAnimationFrame(frame);
