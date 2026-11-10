// =========================================================================
// Land of Inheritance
//
// A rectangle-partition logic puzzle ("divide the grid into rectangles, one
// numbered square each, area equal to the number") themed on Joshua dividing
// Canaan among the tribes of Israel (Joshua 14-19).
//
// One classic script, like the other puzzle games here, so the pure rules and
// the board state stay reachable from the Playwright suite as plain globals.
// =========================================================================

// ---------------------------------------------------------------- constants
const PAD = 12;          // breathing room between the board and the canvas edge
const MIN_AREA = 2;      // a one-square allotment would give the puzzle away

const TRIBES = [
    'Judah', 'Benjamin', 'Simeon', 'Zebulun', 'Issachar', 'Asher',
    'Naphtali', 'Manasseh', 'Ephraim', 'Reuben', 'Gad', 'Dan',
];

// A soft, earthy hue per tribe so neighbouring fields stay easy to tell apart.
const TRIBE_COLOURS = [
    '#8d6b3f', '#6b7f4a', '#7a5c7d', '#4f7a79', '#99653f', '#5f6f92',
    '#8a7b35', '#6d8a5a', '#8b5a52', '#4c6b85', '#86723f', '#737a4b',
];

const LEVELS = [
    { name: 'Hill country', cols: 7, rows: 7, maxArea: 6 },
    { name: 'Shephelah', cols: 9, rows: 9, maxArea: 8 },
    { name: 'Beyond Jordan', cols: 11, rows: 11, maxArea: 9 },
];

// ------------------------------------------------------------------- state
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let levelIndex = 0;
let cols = LEVELS[0].cols;
let rows = LEVELS[0].rows;
let cellSize = 0;
let ORIGIN_X = 0;
let ORIGIN_Y = 0;

let puzzle = null;          // { cols, rows, solution: [rect], clues: [{r,c,n,tribe}] }
let regions = [];           // the player's fields, as { r, c, w, h }
let cursor = { r: 0, c: 0 };// keyboard cursor
let anchor = null;          // first corner set with the keyboard
let dragStart = null;       // first corner of a mouse drag
let dragEnd = null;
let keyboardActive = false;    // the cursor box only appears once keys are used
let hintsUsed = 0;
let solved = false;
let seedCounter = 1;

// ------------------------------------------------------------- pure helpers
function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

// Small deterministic PRNG (mulberry32), so a seed always builds the same land.
function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function rand() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function rectArea(rect) {
    return rect.w * rect.h;
}

// Both corners of a drag, in any order, describe the same field.
function normalizeRect(r1, c1, r2, c2) {
    const r = Math.min(r1, r2);
    const c = Math.min(c1, c2);
    return { r, c, w: Math.abs(c2 - c1) + 1, h: Math.abs(r2 - r1) + 1 };
}

function rectsOverlap(a, b) {
    return a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h;
}

function rectContains(rect, r, c) {
    return r >= rect.r && r < rect.r + rect.h && c >= rect.c && c < rect.c + rect.w;
}

function sameRect(a, b) {
    return a.r === b.r && a.c === b.c && a.w === b.w && a.h === b.h;
}

function cluesInRect(rect, clues) {
    const list = clues || (puzzle ? puzzle.clues : []);
    return list.filter((clue) => rectContains(rect, clue.r, clue.c));
}

// A field is exact when it holds one stone and as many squares as it asks for.
function isExact(rect) {
    const held = cluesInRect(rect);
    return held.length === 1 && held[0].n === rectArea(rect);
}

function regionIndexAt(r, c) {
    return regions.findIndex((region) => rectContains(region, r, c));
}

function coveredCount() {
    return regions.reduce((sum, region) => sum + rectArea(region), 0);
}

function exactCount() {
    return regions.filter(isExact).length;
}

// Every square claimed and every field exact: the land is divided. Fields can
// never overlap, so full cover plus "one stone each" leaves nothing undivided.
function isSolved() {
    return !!puzzle && coveredCount() === cols * rows && regions.length > 0 && regions.every(isExact);
}

// ------------------------------------------------------- puzzle generation
// Cuts a rectangle up until every piece is a legal allotment. Only splits that
// leave both halves at least MIN_AREA squares are considered, so no piece is
// ever a single square.
function splitRect(rect, maxArea, rand, out) {
    const area = rectArea(rect);
    const options = [];
    for (let k = 1; k < rect.w; k++) {
        const left = { r: rect.r, c: rect.c, w: k, h: rect.h };
        const right = { r: rect.r, c: rect.c + k, w: rect.w - k, h: rect.h };
        if (rectArea(left) >= MIN_AREA && rectArea(right) >= MIN_AREA) options.push([left, right]);
    }
    for (let k = 1; k < rect.h; k++) {
        const top = { r: rect.r, c: rect.c, w: rect.w, h: k };
        const bottom = { r: rect.r + k, c: rect.c, w: rect.w, h: rect.h - k };
        if (rectArea(top) >= MIN_AREA && rectArea(bottom) >= MIN_AREA) options.push([top, bottom]);
    }

    // A board of nothing but two-square fields solves itself, so a piece that
    // is already a decent size is likely to be kept and a small one is not.
    const roomy = Math.max(4, Math.ceil(maxArea * 0.6));
    const stopChance = area >= roomy ? 0.75 : 0.06;
    if (area >= MIN_AREA && area <= maxArea && (!options.length || rand() < stopChance)) {
        out.push(rect);
        return;
    }

    if (!options.length) {        // nothing legal left to cut: keep it as it is
        out.push(rect);
        return;
    }

    // Prefer cuts that leave two useful pieces rather than shaving off a sliver.
    const generous = options.filter(([a, b]) => rectArea(a) >= 3 && rectArea(b) >= 3);
    const pool = generous.length && rand() < 0.85 ? generous : options;
    const [a, b] = pool[Math.floor(rand() * pool.length)];
    splitRect(a, maxArea, rand, out);
    splitRect(b, maxArea, rand, out);
}

function generatePartition(cols, rows, maxArea, rand) {
    const out = [];
    splitRect({ r: 0, c: 0, w: cols, h: rows }, maxArea, rand, out);
    return out;
}

// Every rectangle of the right size that could belong to one boundary stone:
// it must hold that stone and no other, and sit inside the land.
function rectOptionsFor(clue, clues, gridCols, gridRows) {
    const out = [];
    for (let h = 1; h <= clue.n; h++) {
        if (clue.n % h) continue;
        const w = clue.n / h;
        if (w > gridCols || h > gridRows) continue;
        const firstRow = Math.max(0, clue.r - h + 1);
        const lastRow = Math.min(clue.r, gridRows - h);
        const firstCol = Math.max(0, clue.c - w + 1);
        const lastCol = Math.min(clue.c, gridCols - w);
        for (let r = firstRow; r <= lastRow; r++) {
            for (let c = firstCol; c <= lastCol; c++) {
                const rect = { r, c, w, h };
                if (cluesInRect(rect, clues).length === 1) out.push(rect);
            }
        }
    }
    return out;
}

// How many lawful divisions a land has, counting no further than `limit`. The
// stone with the fewest remaining choices is always placed first, which keeps
// the search tiny. A proper puzzle has exactly one.
function countSolutions(candidate, limit) {
    const cap = limit || 2;
    const { cols: gridCols, rows: gridRows, clues } = candidate;
    const options = clues.map((clue) => rectOptionsFor(clue, clues, gridCols, gridRows));
    const taken = Array.from({ length: gridRows }, () => new Array(gridCols).fill(false));
    const used = new Array(clues.length).fill(false);
    let found = 0;

    const fits = (rect) => {
        for (let r = rect.r; r < rect.r + rect.h; r++)
            for (let c = rect.c; c < rect.c + rect.w; c++) if (taken[r][c]) return false;
        return true;
    };
    const mark = (rect, value) => {
        for (let r = rect.r; r < rect.r + rect.h; r++)
            for (let c = rect.c; c < rect.c + rect.w; c++) taken[r][c] = value;
    };

    (function place(done) {
        if (found >= cap) return;
        if (done === clues.length) { found++; return; }

        let best = -1;
        let bestOptions = null;
        for (let i = 0; i < clues.length; i++) {
            if (used[i]) continue;
            const list = options[i].filter(fits);
            if (!list.length) return;                    // this stone is boxed in
            if (!bestOptions || list.length < bestOptions.length) { best = i; bestOptions = list; }
            if (bestOptions.length === 1) break;
        }

        used[best] = true;
        for (const rect of bestOptions) {
            mark(rect, true);
            place(done + 1);
            mark(rect, false);
            if (found >= cap) break;
        }
        used[best] = false;
    })(0);

    return found;
}

// Can the land be worked out by forced moves alone, with no guessing? Two
// rules are applied until nothing more follows: a stone with only one field
// left to it must take that field, and a square that only one candidate field
// can reach settles that field too. A land that falls to these is a land a
// player can reason all the way through.
function isDeducible(candidate) {
    const { cols: gridCols, rows: gridRows, clues } = candidate;
    const all = clues.map((clue) => rectOptionsFor(clue, clues, gridCols, gridRows));
    const taken = Array.from({ length: gridRows }, () => new Array(gridCols).fill(false));
    const settled = new Array(clues.length).fill(false);

    const fits = (rect) => {
        for (let r = rect.r; r < rect.r + rect.h; r++)
            for (let c = rect.c; c < rect.c + rect.w; c++) if (taken[r][c]) return false;
        return true;
    };
    const claim = (rect, i) => {
        for (let r = rect.r; r < rect.r + rect.h; r++)
            for (let c = rect.c; c < rect.c + rect.w; c++) taken[r][c] = true;
        settled[i] = true;
    };

    for (let changed = true; changed;) {
        changed = false;
        const live = all.map((options, i) => (settled[i] ? [] : options.filter(fits)));

        for (let i = 0; i < live.length; i++) {
            if (settled[i]) continue;
            if (!live[i].length) return false;              // the land fell apart
            if (live[i].length === 1) { claim(live[i][0], i); changed = true; }
        }
        if (changed) continue;

        // Which fields could still reach each unclaimed square?
        const reach = new Map();
        live.forEach((options, i) => options.forEach((rect) => {
            for (let r = rect.r; r < rect.r + rect.h; r++)
                for (let c = rect.c; c < rect.c + rect.w; c++) {
                    const key = r * gridCols + c;
                    if (!reach.has(key)) reach.set(key, []);
                    reach.get(key).push({ i, rect });
                }
        }));

        for (let r = 0; r < gridRows && !changed; r++) {
            for (let c = 0; c < gridCols && !changed; c++) {
                if (taken[r][c]) continue;
                const options = reach.get(r * gridCols + c) || [];
                if (!options.length) return false;          // a square no field can reach
                if (options.length === 1) { claim(options[0].rect, options[0].i); changed = true; }
            }
        }
    }

    return settled.every(Boolean);
}

// A partition is usable only when every piece is between MIN_AREA and maxArea;
// an awkward cut can strand an oversized strip, so retry with a nudged seed.
function buildPuzzle(gridCols, gridRows, maxArea, seed) {
    // Cutting at random strands a lot of two-square slivers, which make a dull
    // puzzle, so several lands are cut and the roomiest are tried first: fewest
    // fields, then fewest two-square fields. The first one that can be divided
    // in exactly one lawful way is the puzzle; failing that, the roomiest.
    const candidates = [];
    for (let attempt = 0; attempt < 64; attempt++) {
        const rand = makeRng(Math.imul(seed >>> 0 || 1, 7919) + attempt * 104729 + 1);
        const pieces = generatePartition(gridCols, gridRows, maxArea, rand);
        if (!pieces.every((p) => rectArea(p) >= MIN_AREA && rectArea(p) <= maxArea)) continue;
        const twos = pieces.filter((p) => rectArea(p) === MIN_AREA).length;
        candidates.push({ rand, pieces, score: pieces.length * 10 + twos * 7, order: attempt });
    }
    if (!candidates.length) {
        const rand = makeRng((seed >>> 0 || 1) + 7);
        candidates.push({ rand, pieces: generatePartition(gridCols, gridRows, gridCols * gridRows, rand), score: 0, order: 0 });
    }
    candidates.sort((a, b) => (a.score - b.score) || (a.order - b.order));

    let best = null;
    let onlyUnique = null;
    let examined = 0;
    for (const candidate of candidates.slice(0, 48)) {
        // Where each stone stands changes what can be deduced, so try a few
        // placements of the stones on the same cut of the land.
        for (let round = 0; round < 6 && examined < 110; round++) {
            const built = placeStones(candidate.pieces, candidate.rand, gridCols, gridRows);
            examined++;
            if (!best) best = built;
            if (isDeducible(built)) return built;                  // no guessing needed
            if (!onlyUnique && examined <= 8 && countSolutions(built, 2) === 1) onlyUnique = built;
        }
    }
    return onlyUnique || best;
}

// Drops one numbered boundary stone inside each field and names it after a tribe.
function placeStones(pieces, rand, gridCols, gridRows) {
    const ordered = pieces.slice().sort((a, b) => (a.r - b.r) || (a.c - b.c));
    const solution = [];
    const clues = [];
    ordered.forEach((piece, i) => {
        const tribe = TRIBES[i % TRIBES.length];
        const n = rectArea(piece);
        const offset = Math.floor(rand() * n);
        clues.push({
            r: piece.r + Math.floor(offset / piece.w),
            c: piece.c + (offset % piece.w),
            n,
            tribe,
        });
        solution.push({ r: piece.r, c: piece.c, w: piece.w, h: piece.h, n, tribe });
    });
    return { cols: gridCols, rows: gridRows, solution, clues };
}

// --------------------------------------------------------------- geometry
function layout() {
    cellSize = Math.floor((canvas.width - PAD * 2) / Math.max(cols, rows));
    ORIGIN_X = Math.round((canvas.width - cols * cellSize) / 2);
    ORIGIN_Y = Math.round((canvas.height - rows * cellSize) / 2);
}

function cellCentre(r, c) {
    return {
        x: ORIGIN_X + c * cellSize + cellSize / 2,
        y: ORIGIN_Y + r * cellSize + cellSize / 2,
    };
}

function cellFromPixel(x, y) {
    return {
        r: clamp(Math.floor((y - ORIGIN_Y) / cellSize), 0, rows - 1),
        c: clamp(Math.floor((x - ORIGIN_X) / cellSize), 0, cols - 1),
    };
}

function cellFromEvent(event) {
    const box = canvas.getBoundingClientRect();
    const x = (event.clientX - box.left) * (canvas.width / box.width);
    const y = (event.clientY - box.top) * (canvas.height / box.height);
    return cellFromPixel(x, y);
}

// ------------------------------------------------------------ board moves
// Why a field was refused, or null when it may be marked out.
function rejectReason(rect) {
    if (regions.some((region) => rectsOverlap(region, rect))) return 'overlap';
    const held = cluesInRect(rect);
    if (held.length === 0) return 'no-stone';
    if (held.length > 1) return 'many-stones';
    return null;
}

function addRegion(rect) {
    if (solved) return { ok: false, reason: 'solved' };
    const reason = rejectReason(rect);
    if (reason) {
        setStatus(REJECTIONS[reason], 'bad');
        return { ok: false, reason };
    }

    regions.push(rect);
    const clue = cluesInRect(rect)[0];
    if (isExact(rect)) {
        setStatus(`${clue.tribe} receives its inheritance — ${clue.n} squares.`, 'good');
    } else {
        setStatus(`That field holds ${rectArea(rect)} squares, but the stone says ${clue.n}.`, 'bad');
    }
    finishMove();
    return { ok: true };
}

const REJECTIONS = {
    overlap: 'That ground is already allotted to another tribe.',
    'no-stone': 'Every field must take in one boundary stone.',
    'many-stones': 'Two tribes cannot share one field — one stone each.',
};

function removeRegionAt(r, c) {
    if (solved) return false;
    const index = regionIndexAt(r, c);
    if (index < 0) return false;
    regions.splice(index, 1);
    setStatus('Field cleared.', '');
    finishMove();
    return true;
}

function finishMove() {
    if (isSolved()) {
        solved = true;
        showWin();
    }
    updateHud();
    draw();
}

// Marks out one correct allotment, clearing whatever was in its way.
function hint() {
    if (solved || !puzzle) return false;
    const target = puzzle.solution.find(
        (s) => !regions.some((region) => sameRect(region, s)));
    if (!target) return false;

    const rect = { r: target.r, c: target.c, w: target.w, h: target.h };
    regions = regions.filter((region) => !rectsOverlap(region, rect));
    regions.push(rect);
    hintsUsed++;
    setStatus(`${target.tribe} is shown its border — ${target.n} squares.`, '');
    finishMove();
    return true;
}

// ------------------------------------------------------------ game set-up
function newPuzzle(index, seed) {
    levelIndex = clamp(index === undefined ? levelIndex : index, 0, LEVELS.length - 1);
    const level = LEVELS[levelIndex];
    cols = level.cols;
    rows = level.rows;
    puzzle = buildPuzzle(cols, rows, level.maxArea, seed === undefined ? seedCounter++ : seed);
    regions = [];
    cursor = { r: 0, c: 0 };
    anchor = null;
    dragStart = dragEnd = null;
    hintsUsed = 0;
    solved = false;
    keyboardActive = false;
    layout();
    hideWin();
    setStatus('Drag out a field around every boundary stone.', '');
    updateLevelButtons();
    updateHud();
    draw();
}

function resetBoard() {
    regions = [];
    anchor = null;
    dragStart = dragEnd = null;
    solved = false;
    hideWin();
    setStatus('The land lies open again.', '');
    updateHud();
    draw();
}

function setLevel(index) {
    newPuzzle(index);
}

function nextLevel() {
    newPuzzle((levelIndex + 1) % LEVELS.length);
}

// ----------------------------------------------------------------- the HUD
function setStatus(text, kind) {
    const el = document.getElementById('status');
    el.textContent = text;
    el.className = kind || '';
}

function updateHud() {
    document.getElementById('level-label').textContent = LEVELS[levelIndex].name;
    document.getElementById('allotments').textContent =
        `${exactCount()} / ${puzzle ? puzzle.solution.length : 0}`;
    document.getElementById('claimed').textContent = `${coveredCount()} / ${cols * rows}`;
    document.getElementById('hints').textContent = String(hintsUsed);
}

function updateLevelButtons() {
    document.querySelectorAll('.level-btn').forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.level) === levelIndex);
    });
}

function showWin() {
    const level = LEVELS[levelIndex];
    const last = levelIndex === LEVELS.length - 1;
    document.getElementById('overlay-title').textContent = 'The land is divided!';
    document.getElementById('overlay-sub').textContent =
        `${level.name} is shared out among ${puzzle.solution.length} tribes`
        + `${hintsUsed ? ` with ${hintsUsed} hint${hintsUsed > 1 ? 's' : ''}` : ' with no hints at all'}.`
        + ` “The lot is cast into the lap, but its every decision is from the Lord.”`;
    document.getElementById('btn-next').textContent =
        last ? 'Divide the hill country again' : `On to the ${LEVELS[levelIndex + 1].name}`;
    document.getElementById('overlay').classList.add('visible');
    setStatus('Every tribe has its inheritance. Well done!', 'good');
}

function hideWin() {
    document.getElementById('overlay').classList.remove('visible');
}

// ----------------------------------------------------------------- drawing
function cellRect(r, c) {
    return { x: ORIGIN_X + c * cellSize, y: ORIGIN_Y + r * cellSize };
}

function roundRect(x, y, w, h, radius) {
    const rad = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
}

function drawLand() {
    ctx.fillStyle = '#1d1709';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Bare ground, with a woven two-tone so the squares read as fields.
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const { x, y } = cellRect(r, c);
            ctx.fillStyle = (r + c) % 2 ? '#3a3017' : '#423716';
            ctx.fillRect(x, y, cellSize, cellSize);
        }
    }
}

// Where a tribe's name can sit inside its field: the lowest row clear of the
// boundary stone, or failing that the free ground beside it.
function labelSpot(region, clue) {
    const bottom = region.r + region.h - 1;
    for (let r = bottom; r >= region.r; r--) {
        if (clue && clue.r === r) continue;
        return {
            x: ORIGIN_X + (region.c + region.w / 2) * cellSize,
            y: ORIGIN_Y + (r + 0.78) * cellSize,
            width: region.w * cellSize,
        };
    }
    // One row high: use whichever side of the stone has more room.
    const left = clue.c - region.c;
    const right = region.c + region.w - clue.c - 1;
    if (Math.max(left, right) < 1) return null;
    const useLeft = left >= right;
    const span = (useLeft ? left : right) * cellSize;
    const startCol = useLeft ? region.c : clue.c + 1;
    return {
        x: ORIGIN_X + startCol * cellSize + span / 2,
        y: ORIGIN_Y + (region.r + 0.5) * cellSize,
        width: span,
    };
}

function drawRegion(region, index) {
    const { x, y } = cellRect(region.r, region.c);
    const w = region.w * cellSize;
    const h = region.h * cellSize;
    const exact = isExact(region);
    const match = puzzle.solution.find((s) => sameRect(s, region));
    const colour = match
        ? TRIBE_COLOURS[puzzle.solution.indexOf(match) % TRIBE_COLOURS.length]
        : TRIBE_COLOURS[index % TRIBE_COLOURS.length];

    ctx.save();
    ctx.fillStyle = exact ? colour : '#6d3a32';
    ctx.globalAlpha = exact ? 0.85 : 0.6;
    roundRect(x + 2, y + 2, w - 4, h - 4, 7);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = exact ? '#e8b74a' : '#e5705b';
    if (!exact) ctx.setLineDash([6, 4]);
    roundRect(x + 2, y + 2, w - 4, h - 4, 7);
    ctx.stroke();
    ctx.setLineDash([]);

    // Name the field once it matches the inheritance of a tribe, in a spot the
    // boundary stone does not already occupy.
    if (match && exact) {
        const spot = labelSpot(region, cluesInRect(region)[0]);
        if (spot) {
            ctx.font = '600 10.5px "Segoe UI", system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (ctx.measureText(match.tribe).width + 8 <= spot.width) {
                ctx.fillStyle = '#20180a';
                ctx.fillText(match.tribe, spot.x + 0.5, spot.y + 0.5);
                ctx.fillStyle = '#ffeec2';
                ctx.fillText(match.tribe, spot.x, spot.y);
            }
        }
    }
    ctx.restore();
}

function drawGrid() {
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) {
        const x = ORIGIN_X + c * cellSize + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, ORIGIN_Y);
        ctx.lineTo(x, ORIGIN_Y + rows * cellSize);
        ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
        const y = ORIGIN_Y + r * cellSize + 0.5;
        ctx.beginPath();
        ctx.moveTo(ORIGIN_X, y);
        ctx.lineTo(ORIGIN_X + cols * cellSize, y);
        ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = '#6b5420';
    ctx.lineWidth = 2;
    ctx.strokeRect(ORIGIN_X - 1, ORIGIN_Y - 1, cols * cellSize + 2, rows * cellSize + 2);
}

function drawPreview() {
    let rect = null;
    if (dragStart && dragEnd) rect = normalizeRect(dragStart.r, dragStart.c, dragEnd.r, dragEnd.c);
    else if (anchor) rect = normalizeRect(anchor.r, anchor.c, cursor.r, cursor.c);
    if (!rect) return;

    const reason = rejectReason(rect);
    const held = cluesInRect(rect);
    const good = !reason && held[0].n === rectArea(rect);
    const colour = reason ? '#e5705b' : good ? '#86c06c' : '#e8b74a';
    const { x, y } = cellRect(rect.r, rect.c);

    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, rect.w * cellSize, rect.h * cellSize);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(x + 1, y + 1, rect.w * cellSize - 2, rect.h * cellSize - 2);
    ctx.setLineDash([]);

    // The running square count, so the player can size a field by eye.
    ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#20180a';
    ctx.fillText(String(rectArea(rect)), x + 5.5, y + 4.5);
    ctx.fillStyle = colour;
    ctx.fillText(String(rectArea(rect)), x + 5, y + 4);
    ctx.restore();
}

function drawStones() {
    const radius = Math.max(9, cellSize * 0.3);
    for (const clue of puzzle.clues) {
        const { x, y } = cellCentre(clue.r, clue.c);
        const owner = regionIndexAt(clue.r, clue.c);
        const settled = owner >= 0 && isExact(regions[owner]);

        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y + 1.5, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fill();

        const stone = ctx.createRadialGradient(x - radius * 0.4, y - radius * 0.5, radius * 0.2, x, y, radius);
        stone.addColorStop(0, settled ? '#fff6e0' : '#efe3c6');
        stone.addColorStop(1, settled ? '#d9b464' : '#9c8f73');
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = stone;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = settled ? '#8a6f33' : '#5c4a24';
        ctx.stroke();

        ctx.font = `700 ${Math.round(radius * 1.25)}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#20180a';
        ctx.fillText(String(clue.n), x, y + 0.5);
        ctx.restore();
    }
}

function drawCursor() {
    if (solved || (!keyboardActive && !anchor)) return;
    const { x, y } = cellRect(cursor.r, cursor.c);
    ctx.save();
    ctx.strokeStyle = '#f2e8d5';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;
    ctx.strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
    if (anchor) {
        const corner = cellRect(anchor.r, anchor.c);
        ctx.fillStyle = '#e8b74a';
        ctx.fillRect(corner.x + cellSize / 2 - 3, corner.y + cellSize / 2 - 3, 6, 6);
    }
    ctx.restore();
}

function draw() {
    drawLand();
    regions.forEach(drawRegion);
    drawGrid();
    drawPreview();
    drawStones();
    drawCursor();
}

// ------------------------------------------------------------------- input
canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || solved) return;
    event.preventDefault();
    dragStart = dragEnd = cellFromEvent(event);
    cursor = { r: dragStart.r, c: dragStart.c };
    anchor = null;
    draw();
});

window.addEventListener('pointermove', (event) => {
    if (!dragStart) return;
    dragEnd = cellFromEvent(event);
    cursor = { r: dragEnd.r, c: dragEnd.c };
    draw();
});

window.addEventListener('pointerup', (event) => {
    if (!dragStart) return;
    const end = cellFromEvent(event);
    const start = dragStart;
    dragStart = dragEnd = null;

    if (start.r === end.r && start.c === end.c) {
        // A plain click: clear the field under the pointer, or try a single square.
        if (!removeRegionAt(start.r, start.c)) addRegion(normalizeRect(start.r, start.c, end.r, end.c));
    } else {
        addRegion(normalizeRect(start.r, start.c, end.r, end.c));
    }
    draw();
});

canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const cell = cellFromEvent(event);
    removeRegionAt(cell.r, cell.c);
});

const ARROWS = {
    ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    w: [-1, 0], s: [1, 0], a: [0, -1], d: [0, 1],
};

window.addEventListener('keydown', (event) => {
    const key = event.key;
    const step = ARROWS[key] || ARROWS[key.toLowerCase()];
    if (step && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        keyboardActive = true;
        cursor.r = clamp(cursor.r + step[0], 0, rows - 1);
        cursor.c = clamp(cursor.c + step[1], 0, cols - 1);
        draw();
        return;
    }

    if (key === ' ' || key === 'Enter') {
        event.preventDefault();
        if (solved) return;
        keyboardActive = true;
        if (!anchor) {
            anchor = { r: cursor.r, c: cursor.c };
            setStatus('Corner set — move to the far corner and press Space.', '');
        } else {
            const rect = normalizeRect(anchor.r, anchor.c, cursor.r, cursor.c);
            anchor = null;
            addRegion(rect);
        }
        draw();
        return;
    }

    if (key === 'Escape') {
        anchor = null;
        setStatus('Corner dropped.', '');
        draw();
        return;
    }

    if (key === 'Backspace' || key === 'Delete') {
        event.preventDefault();
        keyboardActive = true;
        if (!removeRegionAt(cursor.r, cursor.c)) setStatus('No field to clear here.', '');
        draw();
        return;
    }

    const lower = key.toLowerCase();
    if (lower === 'h') hint();
    else if (lower === 'n') newPuzzle();
    else if (lower === 'r') resetBoard();
});

document.getElementById('btn-reset').addEventListener('click', resetBoard);
document.getElementById('btn-new').addEventListener('click', () => newPuzzle());
document.getElementById('btn-hint').addEventListener('click', hint);
document.getElementById('btn-next').addEventListener('click', nextLevel);
document.querySelectorAll('.level-btn').forEach((btn) => {
    btn.addEventListener('click', () => setLevel(Number(btn.dataset.level)));
});

newPuzzle(0);
