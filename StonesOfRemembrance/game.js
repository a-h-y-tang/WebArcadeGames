// ---------------------------------------------------------------------------
// Stones of Remembrance — a stone-pushing puzzle in the bed of the Jordan.
//
//   "Take twelve stones from the middle of the Jordan ... These stones are to
//    be a memorial to the people of Israel for ever" — Joshua 4:3, 7
//
// Israel crossed the Jordan on dry ground, and twelve men each carried a stone
// up out of the riverbed to set up at Gilgal, so that when later generations
// asked what the stones meant, the crossing would be told again. You are one of
// the bearers. Walk the dry bed and push every stone onto a memorial place.
//
// The rules are the classic push-only ones: you can shove a stone away from
// you, never pull it towards you, and never shift two at once. That makes a
// stone shoved into a corner wedged for good — hence Undo.
//
// Written as a single classic (non-module) script so the pure rule functions
// and the board state are reachable from the Playwright suite as plain globals,
// matching the other puzzle games in this repo. Levels are hand-built maps in
// the usual Sokoban notation; the test suite solves each one from the map alone
// to prove it can be finished, and checks the difficulty actually climbs.
// ---------------------------------------------------------------------------

// Map notation: '#' bank (wall), ' ' dry bed (floor), '$' stone,
// '.' memorial place, '*' stone already on a memorial place,
// '@' bearer, '+' bearer standing on a memorial place.
const LEVELS = [
    {
        id: 'riverbed',
        name: 'The Riverbed',
        note: 'Two stones out of the river. Stand behind a stone to push it.',
        map: [
            '#########',
            '#       #',
            '#  @$ . #',
            '#       #',
            '#  $  . #',
            '#       #',
            '#########',
        ],
    },
    {
        id: 'dry-ground',
        name: 'Dry Ground',
        note: 'Three stones in a row — the order you move them matters.',
        map: [
            '##########',
            '#        #',
            '#  #...  #',
            '#  $$$   #',
            '#   @    #',
            '#        #',
            '##########',
        ],
    },
    {
        id: 'crossing',
        name: 'The Crossing',
        note: 'The banks narrow. Plan a way round to the far side of each stone.',
        map: [
            '##########',
            '#        #',
            '# $      #',
            '#  ## ## #',
            '#. $  @  #',
            '#  ##.## #',
            '#  $    .#',
            '##########',
        ],
    },
    {
        id: 'gilgal',
        name: 'Gilgal',
        note: 'Four stones, and a bank down the middle of the camp.',
        map: [
            '###########',
            '#    #    #',
            '#  $ #  $ #',
            '#    #    #',
            '## ##   ###',
            '#  $   $  #',
            '#   . .   #',
            '# .  @  . #',
            '###########',
        ],
    },
    {
        id: 'memorial',
        name: 'The Memorial',
        note: 'The memorial itself: four stones into a chamber with one way in.',
        map: [
            '##########',
            '#   ##   #',
            '# $      #',
            '#  #..#  #',
            '# $#..#$ #',
            '#  #  #  #',
            '#   $@   #',
            '#        #',
            '##########',
        ],
    },
];

// Step offsets, in reading order: up, down, left, right.
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Which step each key asks for.
const KEY_STEPS = {
    ArrowUp: [-1, 0], KeyW: [-1, 0],
    ArrowDown: [1, 0], KeyS: [1, 0],
    ArrowLeft: [0, -1], KeyA: [0, -1],
    ArrowRight: [0, 1], KeyD: [0, 1],
};

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const levelLabelEl = document.getElementById('level-label');
const stonesLeftEl = document.getElementById('stones-left');
const movesEl = document.getElementById('moves');
const pushesEl = document.getElementById('pushes');
const statusEl = document.getElementById('status');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnUndo = document.getElementById('btn-undo');
const btnReset = document.getElementById('btn-reset');
const btnNext = document.getElementById('btn-next');
const levelBtns = Array.from(document.querySelectorAll('.level-btn'));

// --- State (script scope, read by the tests) ---
let levelIndex;   // index into LEVELS
let rows, cols;   // board size of the level on screen
let walls;        // rows×cols booleans — the banks
let goals;        // rows×cols booleans — the memorial places
let stones;       // rows×cols booleans — where the stones are now
let player;       // { r, c } — the bearer
let facing;       // [dr, dc] the bearer last moved in, for the sketch of them
let moves;        // steps taken on this level
let pushes;       // of those steps, how many shifted a stone
let solved;       // every stone on a memorial place
let undoStack;    // one record per step taken, newest last

// --- Layout ---
const PAD = 12;        // smallest gap between the board and the canvas edge
const MAX_CELL = 60;   // cap so the small levels are not blown up
let cellSize;          // pixel size of one square
let originX, originY;  // pixel offset of the board's top-left corner

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------
function blankGrid(h, w, value) {
    return Array.from({ length: h }, () => new Array(w).fill(value));
}

function inBounds(r, c) {
    return r >= 0 && c >= 0 && r < rows && c < cols;
}

// Read a Sokoban-notation map into plain grids.
function parseMap(map) {
    const h = map.length;
    const w = Math.max(...map.map((row) => row.length));
    const parsed = {
        rows: h,
        cols: w,
        walls: blankGrid(h, w, false),
        goals: blankGrid(h, w, false),
        stones: blankGrid(h, w, false),
        player: null,
    };
    for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
            const ch = map[r][c] ?? ' ';
            if (ch === '#') parsed.walls[r][c] = true;
            if (ch === '.' || ch === '*' || ch === '+') parsed.goals[r][c] = true;
            if (ch === '$' || ch === '*') parsed.stones[r][c] = true;
            if (ch === '@' || ch === '+') parsed.player = { r, c };
        }
    }
    return parsed;
}

// Every stone on the board, as [r, c] pairs in reading order.
function stoneList() {
    const out = [];
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) if (stones[r][c]) out.push([r, c]);
    return out;
}

// How many stones are standing on a memorial place.
function stonesHome() {
    return stoneList().filter(([r, c]) => goals[r][c]).length;
}

function stoneCount() {
    return stoneList().length;
}

// ---------------------------------------------------------------------------
// Pure rule functions
// ---------------------------------------------------------------------------

// A square a stone could never be pushed out of: not a memorial place, and
// walled off on two perpendicular sides, so neither axis is open to a bearer.
function isDeadCell(r, c) {
    if (!inBounds(r, c) || walls[r][c] || goals[r][c]) return false;
    const blocked = (rr, cc) => !inBounds(rr, cc) || walls[rr][cc];
    const vertical = blocked(r - 1, c) || blocked(r + 1, c);
    const horizontal = blocked(r, c - 1) || blocked(r, c + 1);
    return vertical && horizontal;
}

// The stones that are wedged in such a square, as [r, c] pairs.
function stuckStones() {
    return stoneList().filter(([r, c]) => isDeadCell(r, c));
}

// Is every stone on a memorial place?
function isSolved() {
    const all = stoneList();
    return all.length > 0 && all.every(([r, c]) => goals[r][c]);
}

// ---------------------------------------------------------------------------
// Moving
// ---------------------------------------------------------------------------

// Take one step in direction (dr, dc), pushing a stone if one is in the way.
// Returns 'walk', 'push' or 'blocked'.
function step(dr, dc) {
    if (solved) return 'blocked';
    const r = player.r + dr;
    const c = player.c + dc;
    if (!inBounds(r, c) || walls[r][c]) return 'blocked';

    let pushed = false;
    if (stones[r][c]) {
        const br = r + dr;
        const bc = c + dc;
        if (!inBounds(br, bc) || walls[br][bc] || stones[br][bc]) return 'blocked';
        stones[r][c] = false;
        stones[br][bc] = true;
        pushed = true;
    }

    undoStack.push({ r: player.r, c: player.c, dr, dc, pushed, facing });
    player = { r, c };
    facing = [dr, dc];
    moves++;
    if (pushed) pushes++;
    afterMove();
    return pushed ? 'push' : 'walk';
}

// Take back the last step, dragging a pushed stone back with it.
function undoMove() {
    const last = undoStack.pop();
    if (!last) return false;
    if (last.pushed) {
        const sr = player.r + last.dr;
        const sc = player.c + last.dc;
        stones[sr][sc] = false;
        stones[player.r][player.c] = true;
        pushes--;
    }
    player = { r: last.r, c: last.c };
    facing = last.facing;
    moves--;
    solved = false;
    afterMove();
    return true;
}

function resetLevel() {
    loadLevel(levelIndex);
}

function nextLevel() {
    if (!solved || levelIndex >= LEVELS.length - 1) return false;
    loadLevel(levelIndex + 1);
    return true;
}

// ---------------------------------------------------------------------------
// Level loading
// ---------------------------------------------------------------------------
function loadLevel(index) {
    levelIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
    const level = LEVELS[levelIndex];
    const parsed = parseMap(level.map);
    rows = parsed.rows;
    cols = parsed.cols;
    walls = parsed.walls;
    goals = parsed.goals;
    stones = parsed.stones;
    player = { ...parsed.player };
    facing = [1, 0];
    moves = 0;
    pushes = 0;
    solved = false;
    undoStack = [];

    cellSize = Math.min(
        (canvas.width - 2 * PAD) / cols,
        (canvas.height - 2 * PAD) / rows,
        MAX_CELL
    );
    originX = (canvas.width - cellSize * cols) / 2;
    originY = (canvas.height - cellSize * rows) / 2;

    levelLabelEl.textContent = level.name;
    levelBtns.forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.level) === levelIndex);
    });
    afterMove();
}

// Everything that has to happen once the board has changed.
function afterMove() {
    solved = isSolved();
    const stuck = stuckStones().length;

    stonesLeftEl.textContent = String(stoneCount() - stonesHome());
    movesEl.textContent = String(moves);
    pushesEl.textContent = String(pushes);

    statusEl.classList.remove('good', 'bad');
    if (solved) {
        statusEl.classList.add('good');
        statusEl.textContent = 'Every stone is set up. The crossing is remembered.';
    } else if (stuck > 0) {
        statusEl.classList.add('bad');
        statusEl.textContent = stuck === 1
            ? 'A stone is wedged in a corner — press U to take it back.'
            : `${stuck} stones are wedged in corners — press U to take them back.`;
    } else {
        statusEl.textContent = LEVELS[levelIndex].note;
    }

    const last = levelIndex === LEVELS.length - 1;
    btnNext.hidden = !solved || last;
    overlay.classList.toggle('visible', solved);
    if (solved) {
        overlayTitle.textContent = last
            ? 'The memorial stands at Gilgal'
            : 'Memorial set up!';
        overlaySub.textContent = last
            ? `Set up in ${moves} steps and ${pushes} pushes. All five crossings are remembered — `
              + 'press R to walk any of them again.'
            : `Set up in ${moves} steps and ${pushes} pushes. Press N for the next crossing.`;
    }

    draw();
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

// A small deterministic generator, so the grit on the riverbed is the same
// every time a level is drawn.
function rng(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function cellRect(r, c) {
    return { x: originX + c * cellSize, y: originY + r * cellSize, s: cellSize };
}

function drawBed(r, c) {
    const { x, y, s } = cellRect(r, c);
    ctx.fillStyle = '#2b2314';
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = '#342a18';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);

    // A few grains of river grit.
    const next = rng((r * 131 + c) * 977 + levelIndex * 7919);
    ctx.fillStyle = '#3c3019';
    for (let i = 0; i < 5; i++) {
        const gx = x + 4 + next() * (s - 8);
        const gy = y + 4 + next() * (s - 8);
        ctx.beginPath();
        ctx.arc(gx, gy, 1 + next(), 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBank(r, c) {
    const { x, y, s } = cellRect(r, c);
    ctx.fillStyle = '#4a3a1c';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#5f4a24';
    ctx.fillRect(x, y, s, Math.max(3, s * 0.16));
    ctx.fillStyle = '#3a2d14';
    ctx.fillRect(x, y + s - Math.max(2, s * 0.1), s, Math.max(2, s * 0.1));
    ctx.strokeStyle = '#2a2010';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
}

// A memorial place: a ring scratched into the bed, waiting for its stone.
function drawPlace(r, c) {
    const { x, y, s } = cellRect(r, c);
    const cx = x + s / 2;
    const cy = y + s / 2;
    ctx.save();
    ctx.strokeStyle = '#e8b74a';
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.33, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#e8b74a';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.5, s * 0.06), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
}

// A memorial stone. Set on its place it warms to gold; wedged in a corner it
// is outlined in red so the dead end is obvious.
function drawStone(r, c) {
    const { x, y, s } = cellRect(r, c);
    const home = goals[r][c];
    const stuck = !home && isDeadCell(r, c);
    const inset = s * 0.14;
    const x0 = x + inset;
    const y0 = y + inset;
    const w = s - 2 * inset;

    ctx.save();
    ctx.beginPath();
    const radius = w * 0.26;
    ctx.moveTo(x0 + radius, y0);
    ctx.lineTo(x0 + w - radius, y0);
    ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + radius);
    ctx.lineTo(x0 + w, y0 + w - radius);
    ctx.quadraticCurveTo(x0 + w, y0 + w, x0 + w - radius, y0 + w);
    ctx.lineTo(x0 + radius, y0 + w);
    ctx.quadraticCurveTo(x0, y0 + w, x0, y0 + w - radius);
    ctx.lineTo(x0, y0 + radius);
    ctx.quadraticCurveTo(x0, y0, x0 + radius, y0);
    ctx.closePath();

    const grad = ctx.createLinearGradient(x0, y0, x0 + w, y0 + w);
    if (home) {
        grad.addColorStop(0, '#f6d98f');
        grad.addColorStop(1, '#c08f2e');
    } else {
        grad.addColorStop(0, '#b3ab9c');
        grad.addColorStop(1, '#6b655a');
    }
    // A stone set on its place glows a little, so a finished memorial reads at
    // a glance even across a crowded board.
    if (home) {
        ctx.shadowColor = 'rgba(232, 183, 74, 0.55)';
        ctx.shadowBlur = s * 0.3;
    }
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = stuck ? '#e5705b' : home ? '#fff0c4' : '#4a463d';
    ctx.lineWidth = stuck ? 3 : 2;
    ctx.stroke();

    // Two quarry grooves, so the stones read as cut blocks rather than tiles.
    ctx.strokeStyle = home ? 'rgba(126, 92, 24, 0.8)' : 'rgba(70, 66, 58, 0.8)';
    ctx.lineWidth = Math.max(1, w * 0.05);
    ctx.beginPath();
    ctx.moveTo(x0 + w * 0.2, y0 + w * 0.36);
    ctx.lineTo(x0 + w * 0.55, y0 + w * 0.36);
    ctx.moveTo(x0 + w * 0.46, y0 + w * 0.66);
    ctx.lineTo(x0 + w * 0.78, y0 + w * 0.66);
    ctx.moveTo(x0 + w * 0.26, y0 + w * 0.62);
    ctx.lineTo(x0 + w * 0.3, y0 + w * 0.74);
    ctx.stroke();
    ctx.restore();
}

// The bearer: a figure in a robe, carrying a staff, with a bright pip on the
// side they are facing so the next push is easy to line up.
function drawBearer() {
    const { x, y, s } = cellRect(player.r, player.c);
    const cx = x + s / 2;
    const cy = y + s / 2;
    const [dr, dc] = facing || [1, 0];

    ctx.save();

    // Facing pip, drawn at the edge of the square the bearer would step into.
    ctx.fillStyle = '#e8b74a';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    const px = cx + dc * s * 0.36;
    const py = cy + dr * s * 0.36;
    const tip = s * 0.09;
    ctx.moveTo(px + dc * tip, py + dr * tip);
    ctx.lineTo(px - dr * tip + -dc * tip, py - dc * tip + -dr * tip);
    ctx.lineTo(px + dr * tip + -dc * tip, py + dc * tip + -dr * tip);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Staff, carried across the back, well inside the square so it never
    // runs into the facing pip.
    ctx.strokeStyle = '#8a6f33';
    ctx.lineWidth = Math.max(1.5, s * 0.045);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.15, cy + s * 0.25);
    ctx.lineTo(cx + s * 0.16, cy - s * 0.27);
    ctx.stroke();

    // Robe.
    ctx.fillStyle = '#5287ad';
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.1);
    ctx.lineTo(cx + s * 0.2, cy + s * 0.28);
    ctx.lineTo(cx - s * 0.2, cy + s * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2f5b7d';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Sash.
    ctx.strokeStyle = '#d9a23f';
    ctx.lineWidth = Math.max(1.5, s * 0.045);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.12, cy + s * 0.11);
    ctx.lineTo(cx + s * 0.12, cy + s * 0.11);
    ctx.stroke();

    // Head.
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.2, s * 0.115, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a5794c';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
}

function draw() {
    ctx.fillStyle = '#19140b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (walls[r][c]) drawBank(r, c);
            else drawBed(r, c);
        }
    }
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) if (goals[r][c]) drawPlace(r, c);
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) if (stones[r][c]) drawStone(r, c);
    drawBearer();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (event) => {
    const dir = KEY_STEPS[event.code];
    if (dir) {
        event.preventDefault();
        step(dir[0], dir[1]);
        return;
    }
    if (event.code === 'KeyU') { event.preventDefault(); undoMove(); }
    else if (event.code === 'KeyR') { event.preventDefault(); resetLevel(); }
    else if (event.code === 'KeyN') { event.preventDefault(); nextLevel(); }
});

// Clicking (or tapping) a square in line with the bearer steps one square that
// way — the whole game on a touch screen, without an on-screen D-pad.
canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const x = (event.clientX - rect.left) * scale;
    const y = (event.clientY - rect.top) * scale;
    const c = Math.floor((x - originX) / cellSize);
    const r = Math.floor((y - originY) / cellSize);
    if (!inBounds(r, c)) return;
    if (r === player.r && c !== player.c) step(0, Math.sign(c - player.c));
    else if (c === player.c && r !== player.r) step(Math.sign(r - player.r), 0);
});

btnUndo.addEventListener('click', () => undoMove());
btnReset.addEventListener('click', () => resetLevel());
btnNext.addEventListener('click', () => nextLevel());
levelBtns.forEach((btn) => {
    btn.addEventListener('click', () => loadLevel(Number(btn.dataset.level)));
});

loadLevel(0);
