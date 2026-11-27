/*
 * Bezalel's Tiles — a tangram-style shape-fitting puzzle.
 *
 * Seven tiles are laid inside a shadowed figure so that they cover it exactly.
 * Everything lives on an integer lattice: a tile's edges are lattice lines or
 * 45-degree cell diagonals, so a placed tile always covers a whole number of
 * quarter cells (each unit cell is cut by both diagonals into the triangles
 * 'n', 'e', 's' and 'w'). "Is the figure finished?" is then an exact set
 * comparison rather than a tolerance check. See DESIGN.md.
 */

// ---------------------------------------------------------------------------
// Board, tray and canvas geometry
// ---------------------------------------------------------------------------
const UNIT = 44;                                     // pixels per lattice unit
const BOARD = { x: 100, y: 16, cols: 10, rows: 7 };  // playing field, in units
const TRAY = { y: 368, gap: 16 };

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------------------
// The seven tiles. Points are lattice coordinates with y growing downwards.
// ---------------------------------------------------------------------------
const PIECES = [
    { id: 'large1', label: 'Large triangle', color: '#c2703f', pts: [[0, 0], [4, 0], [2, 2]] },
    { id: 'large2', label: 'Large triangle', color: '#d9a441', pts: [[0, 0], [4, 0], [2, 2]] },
    { id: 'medium', label: 'Medium triangle', color: '#6f9b6a', pts: [[0, 0], [2, 0], [0, 2]] },
    { id: 'square', label: 'Square', color: '#4d7ca8', pts: [[1, 0], [2, 1], [1, 2], [0, 1]] },
    { id: 'para', label: 'Parallelogram', color: '#9a6fa8', pts: [[0, 0], [2, 0], [3, 1], [1, 1]] },
    { id: 'small1', label: 'Small triangle', color: '#cbb23f', pts: [[0, 0], [2, 0], [1, 1]] },
    { id: 'small2', label: 'Small triangle', color: '#8aa84a', pts: [[0, 0], [2, 0], [1, 1]] },
];

const PIECE_BY_ID = Object.fromEntries(PIECES.map((p) => [p.id, p]));

// ---------------------------------------------------------------------------
// The figures. `poly` is the outline on the lattice; `solution` is one known
// way to tile it, used by the hint button and by the tests. Both are stored in
// the figure's own coordinates and shifted onto the board when it is loaded.
// ---------------------------------------------------------------------------
const FIGURES = [
    {
        name: 'The Cornerstone',
        verse: '"The stone which the builders refused is become the head stone of the corner." — Psalm 118:22',
        poly: [[0, 0], [4, 0], [4, 4], [0, 4]],
        solution: [
            { id: 'large1', rot: 0, flip: false, x: 0, y: 0 },
            { id: 'large2', rot: 3, flip: false, x: 0, y: 0 },
            { id: 'para', rot: 1, flip: false, x: 3, y: 0 },
            { id: 'small1', rot: 1, flip: false, x: 2, y: 1 },
            { id: 'square', rot: 0, flip: false, x: 1, y: 2 },
            { id: 'medium', rot: 1, flip: true, x: 2, y: 2 },
            { id: 'small2', rot: 2, flip: false, x: 0, y: 3 },
        ],
    },
    {
        name: 'The Tent of Meeting',
        verse: '"Moses took the tabernacle, and pitched it without the camp, afar off from the camp." — Exodus 33:7',
        poly: [[0, 4], [4, 0], [8, 4]],
        solution: [
            { id: 'large1', rot: 1, flip: false, x: 2, y: 0 },
            { id: 'para', rot: 1, flip: true, x: 4, y: 0 },
            { id: 'small1', rot: 3, flip: false, x: 5, y: 1 },
            { id: 'large2', rot: 2, flip: false, x: 0, y: 2 },
            { id: 'medium', rot: 2, flip: true, x: 4, y: 2 },
            { id: 'square', rot: 0, flip: false, x: 5, y: 2 },
            { id: 'small2', rot: 2, flip: false, x: 6, y: 3 },
        ],
    },
    {
        name: "Noah's Ark",
        verse: '"Make thee an ark of gopher wood; rooms shalt thou make in the ark." — Genesis 6:14',
        poly: [[2, 0], [4, 2], [8, 2], [6, 4], [2, 4], [0, 2]],
        solution: [
            { id: 'large1', rot: 1, flip: false, x: 0, y: 0 },
            { id: 'para', rot: 1, flip: true, x: 2, y: 0 },
            { id: 'small1', rot: 3, flip: false, x: 3, y: 1 },
            { id: 'medium', rot: 2, flip: true, x: 2, y: 2 },
            { id: 'square', rot: 0, flip: false, x: 3, y: 2 },
            { id: 'large2', rot: 0, flip: false, x: 4, y: 2 },
            { id: 'small2', rot: 2, flip: false, x: 4, y: 3 },
        ],
    },
    {
        name: 'The House on the Rock',
        verse: '"A wise man, which built his house upon a rock." — Matthew 7:24',
        poly: [[2, 0], [4, 2], [6, 2], [6, 4], [0, 4], [0, 2]],
        solution: [
            { id: 'square', rot: 0, flip: false, x: 1, y: 0 },
            { id: 'para', rot: 1, flip: false, x: 0, y: 1 },
            { id: 'small1', rot: 3, flip: false, x: 1, y: 1 },
            { id: 'small2', rot: 2, flip: false, x: 2, y: 1 },
            { id: 'large1', rot: 2, flip: false, x: 0, y: 2 },
            { id: 'large2', rot: 0, flip: false, x: 2, y: 2 },
            { id: 'medium', rot: 1, flip: true, x: 4, y: 2 },
        ],
    },
    {
        name: 'The Fish',
        verse: '"Follow me, and I will make you fishers of men." — Matthew 4:19',
        poly: [[0, 0], [2, 2], [0, 4], [4, 4], [6, 2], [4, 0]],
        solution: [
            { id: 'large1', rot: 0, flip: false, x: 0, y: 0 },
            { id: 'medium', rot: 1, flip: true, x: 2, y: 0 },
            { id: 'para', rot: 1, flip: true, x: 4, y: 0 },
            { id: 'small1', rot: 3, flip: false, x: 5, y: 1 },
            { id: 'large2', rot: 2, flip: false, x: 0, y: 2 },
            { id: 'small2', rot: 0, flip: false, x: 2, y: 2 },
            { id: 'square', rot: 0, flip: false, x: 3, y: 2 },
        ],
    },
    {
        name: 'The Breastplate Jewel',
        verse: '"Thou shalt set in it settings of stones, even four rows of stones." — Exodus 28:17',
        poly: [[0, 2], [2, 0], [4, 0], [6, 2], [4, 4], [2, 4]],
        solution: [
            { id: 'large1', rot: 1, flip: false, x: 0, y: 0 },
            { id: 'medium', rot: 0, flip: true, x: 2, y: 0 },
            { id: 'large2', rot: 3, flip: false, x: 2, y: 0 },
            { id: 'para', rot: 1, flip: true, x: 4, y: 0 },
            { id: 'small1', rot: 3, flip: false, x: 5, y: 1 },
            { id: 'square', rot: 0, flip: false, x: 3, y: 2 },
            { id: 'small2', rot: 2, flip: false, x: 2, y: 3 },
        ],
    },
    {
        name: 'The Fishing Boat',
        verse: '"He entered into one of the ships, which was Simon\'s, and taught the people out of the ship." — Luke 5:3',
        poly: [[4, 0], [4, 4], [6, 4], [4, 6], [2, 6], [0, 4]],
        solution: [
            { id: 'large1', rot: 1, flip: false, x: 2, y: 0 },
            { id: 'large2', rot: 1, flip: false, x: 0, y: 2 },
            { id: 'para', rot: 1, flip: true, x: 2, y: 2 },
            { id: 'small1', rot: 3, flip: false, x: 3, y: 3 },
            { id: 'medium', rot: 2, flip: true, x: 2, y: 4 },
            { id: 'square', rot: 0, flip: false, x: 3, y: 4 },
            { id: 'small2', rot: 0, flip: false, x: 4, y: 4 },
        ],
    },
    {
        name: 'The Dove',
        verse: '"The dove came in to him in the evening; and, lo, in her mouth was an olive leaf." — Genesis 8:11',
        poly: [[0, 2], [2, 0], [6, 0], [8, 2], [6, 2], [4, 4], [2, 2]],
        solution: [
            { id: 'large1', rot: 2, flip: false, x: 0, y: 0 },
            { id: 'large2', rot: 0, flip: false, x: 2, y: 0 },
            { id: 'square', rot: 0, flip: false, x: 5, y: 0 },
            { id: 'para', rot: 1, flip: false, x: 4, y: 1 },
            { id: 'small1', rot: 3, flip: false, x: 5, y: 1 },
            { id: 'small2', rot: 2, flip: false, x: 6, y: 1 },
            { id: 'medium', rot: 0, flip: true, x: 2, y: 2 },
        ],
    },
];

// ---------------------------------------------------------------------------
// Lattice geometry
// ---------------------------------------------------------------------------

// Turn `rot` quarter turns clockwise and optionally mirror, then push the
// shape back against the origin so (x, y) always means "bounding box corner".
function transformPoints(pts, rot, flip) {
    let out = pts.map(([x, y]) => [flip ? -x : x, y]);
    for (let i = 0; i < ((rot % 4) + 4) % 4; i++) out = out.map(([x, y]) => [-y, x]);
    const minX = Math.min(...out.map((p) => p[0]));
    const minY = Math.min(...out.map((p) => p[1]));
    return out.map(([x, y]) => [x - minX, y - minY]);
}

// The outline of a tile where it currently lies, in lattice coordinates.
function placedPolygon(piece) {
    const def = PIECE_BY_ID[piece.id];
    return transformPoints(def.pts, piece.rot || 0, !!piece.flip)
        .map(([x, y]) => [x + (piece.x || 0), y + (piece.y || 0)]);
}

function polygonBounds(poly) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    return {
        x0: Math.min(...xs), y0: Math.min(...ys),
        x1: Math.max(...xs), y1: Math.max(...ys),
    };
}

function pieceSize(piece) {
    const pts = transformPoints(PIECE_BY_ID[piece.id].pts, piece.rot || 0, !!piece.flip);
    const b = polygonBounds(pts);
    return { w: b.x1 - b.x0, h: b.y1 - b.y0 };
}

// Exact point-in-polygon on sixths of a unit cell, so no rounding creeps in.
function insideSixths(poly, px, py) {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0] * 6, yi = poly[i][1] * 6;
        const xj = poly[j][0] * 6, yj = poly[j][1] * 6;
        if ((yi > py) !== (yj > py)) {
            const side = (xj - xi) * (py - yi) - (yj - yi) * (px - xi);
            if ((side > 0) === (yj > yi)) hit = !hit;
        }
    }
    return hit;
}

const TRI_DIRS = ['n', 'e', 's', 'w'];
// Centroid of each quarter triangle, in sixths of a cell.
const TRI_CENTROID = { n: [3, 1], e: [5, 3], s: [3, 5], w: [1, 3] };

// Every quarter triangle a lattice polygon covers, as "cellX,cellY,dir" keys.
function trianglesOfPolygon(poly) {
    const b = polygonBounds(poly);
    const out = [];
    for (let cy = b.y0; cy < b.y1; cy++) {
        for (let cx = b.x0; cx < b.x1; cx++) {
            for (const dir of TRI_DIRS) {
                const [ox, oy] = TRI_CENTROID[dir];
                if (insideSixths(poly, cx * 6 + ox, cy * 6 + oy)) out.push(`${cx},${cy},${dir}`);
            }
        }
    }
    return out;
}

function pieceTriangles(piece) {
    return trianglesOfPolygon(placedPolygon(piece));
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const state = {
    figure: 0,
    origin: { x: 0, y: 0 },   // where the figure sits on the board
    pieces: [],
    selected: null,
    hints: 0,
    hintsHere: 0,
    done: new Array(FIGURES.length).fill(false),
    solved: false,
    drag: null,
};

function pieceById(id) {
    return state.pieces.find((p) => p.id === id) || null;
}

function freshPieces() {
    return PIECES.map((def) => ({ id: def.id, x: 0, y: 0, rot: 0, flip: false, inTray: true }));
}

// The figure's outline and solution, shifted to where it sits on the board.
function figurePolygon() {
    return FIGURES[state.figure].poly.map(([x, y]) => [x + state.origin.x, y + state.origin.y]);
}

function figureSolution() {
    return FIGURES[state.figure].solution.map((s) => ({
        ...s, x: s.x + state.origin.x, y: s.y + state.origin.y,
    }));
}

function targetTriangles() {
    return trianglesOfPolygon(figurePolygon()).sort();
}

function coveredTriangles() {
    const out = new Set();
    for (const piece of state.pieces) {
        if (piece.inTray) continue;
        for (const t of pieceTriangles(piece)) out.add(t);
    }
    return [...out].sort();
}

// Tiles that share at least one quarter triangle with another tile.
function overlappingPieces() {
    const owner = new Map();
    const clashing = new Set();
    for (const piece of state.pieces) {
        if (piece.inTray) continue;
        for (const t of pieceTriangles(piece)) {
            if (owner.has(t)) {
                clashing.add(owner.get(t));
                clashing.add(piece.id);
            } else {
                owner.set(t, piece.id);
            }
        }
    }
    return [...clashing];
}

// Seven tiles always cover 64 triangles counted with repeats, so an exact match
// with the figure's 64 triangles rules out both gaps and overlaps.
function isSolved() {
    if (state.pieces.some((p) => p.inTray)) return false;
    const covered = coveredTriangles();
    const target = targetTriangles();
    return covered.length === target.length && covered.every((t, i) => t === target[i]);
}

// ---------------------------------------------------------------------------
// Moving tiles
// ---------------------------------------------------------------------------
function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
}

function placePiece(id, spot = {}) {
    const piece = pieceById(id);
    if (!piece) return;
    if (spot.rot !== undefined) piece.rot = ((spot.rot % 4) + 4) % 4;
    if (spot.flip !== undefined) piece.flip = !!spot.flip;
    const size = pieceSize(piece);
    piece.x = clamp(spot.x !== undefined ? spot.x : piece.x, 0, BOARD.cols - size.w);
    piece.y = clamp(spot.y !== undefined ? spot.y : piece.y, 0, BOARD.rows - size.h);
    piece.inTray = false;
    checkSolved();
    draw();
}

function returnToTray(id) {
    const piece = pieceById(id);
    if (!piece) return;
    piece.inTray = true;
    piece.rot = 0;
    piece.flip = false;
    state.solved = false;
    draw();
}

// Turning and flipping keep the tile roughly where it was, then re-snap it.
function reorient(id, change) {
    const piece = pieceById(id);
    if (!piece) return;
    if (piece.inTray) liftToBoard(piece);
    const before = pieceSize(piece);
    const cx = piece.x + before.w / 2;
    const cy = piece.y + before.h / 2;
    change(piece);
    const after = pieceSize(piece);
    placePiece(id, { x: Math.round(cx - after.w / 2), y: Math.round(cy - after.h / 2) });
}

function rotatePiece(id, dir = 1) {
    reorient(id, (piece) => { piece.rot = ((piece.rot + dir) % 4 + 4) % 4; });
}

function flipPiece(id) {
    reorient(id, (piece) => { piece.flip = !piece.flip; });
}

// A tray tile driven by the keyboard lands on the board near the middle, on
// the closest spot that no other laid tile is using.
function liftToBoard(piece) {
    const size = pieceSize(piece);
    const midX = Math.round((BOARD.cols - size.w) / 2);
    const midY = Math.round((BOARD.rows - size.h) / 2);
    const taken = new Set();
    for (const other of state.pieces) {
        if (other.inTray || other.id === piece.id) continue;
        pieceTriangles(other).forEach((t) => taken.add(t));
    }
    const spots = [];
    for (let y = 0; y <= BOARD.rows - size.h; y++) {
        for (let x = 0; x <= BOARD.cols - size.w; x++) spots.push({ x, y });
    }
    spots.sort((a, b) =>
        (Math.abs(a.x - midX) + Math.abs(a.y - midY)) - (Math.abs(b.x - midX) + Math.abs(b.y - midY)));
    const free = spots.find((spot) =>
        !pieceTriangles({ ...piece, ...spot }).some((t) => taken.has(t)));
    const chosen = free || { x: midX, y: midY };
    piece.x = chosen.x;
    piece.y = chosen.y;
    piece.inTray = false;
}

function nudge(id, dx, dy) {
    const piece = pieceById(id);
    if (!piece) return;
    if (piece.inTray) {
        liftToBoard(piece);
        checkSolved();
        draw();
        return;
    }
    placePiece(id, { x: piece.x + dx, y: piece.y + dy });
}

// ---------------------------------------------------------------------------
// Figures, hints and the run of play
// ---------------------------------------------------------------------------
function loadFigure(index) {
    state.figure = ((index % FIGURES.length) + FIGURES.length) % FIGURES.length;
    const bounds = polygonBounds(FIGURES[state.figure].poly);
    state.origin = {
        x: Math.round((BOARD.cols - (bounds.x1 - bounds.x0)) / 2) - bounds.x0,
        y: Math.round((BOARD.rows - (bounds.y1 - bounds.y0)) / 2) - bounds.y0,
    };
    state.pieces = freshPieces();
    state.selected = null;
    state.solved = false;
    state.hintsHere = 0;
    hideOverlay();
    setStatus('Lay all seven tiles inside the shadow.');
    updateHud();
    draw();
}

function resetFigure() {
    state.pieces = freshPieces();
    state.selected = null;
    state.solved = false;
    hideOverlay();
    setStatus('The bench is clear. Lay all seven tiles inside the shadow.');
    updateHud();
    draw();
}

function nextFigure() {
    loadFigure(state.figure + 1);
}

// Lay the next tile of the stored solution, clearing anything in its way.
function hint() {
    if (state.solved) return;
    const solution = figureSolution();
    const wanted = solution.find((s) => {
        const piece = pieceById(s.id);
        return piece.inTray || piece.x !== s.x || piece.y !== s.y ||
            piece.rot !== s.rot || piece.flip !== s.flip;
    });
    if (!wanted) return;

    const taken = new Set(pieceTriangles(wanted));
    for (const piece of state.pieces) {
        if (piece.inTray || piece.id === wanted.id) continue;
        if (pieceTriangles(piece).some((t) => taken.has(t))) returnToTray(piece.id);
    }

    state.hints += 1;
    state.hintsHere += 1;
    placePiece(wanted.id, wanted);
    if (!state.solved) {
        setStatus(`A hint: the ${PIECE_BY_ID[wanted.id].label.toLowerCase()} belongs here.`);
    }
    updateHud();
}

function checkSolved() {
    if (state.solved || !isSolved()) return;
    state.solved = true;
    state.done[state.figure] = true;
    const figure = FIGURES[state.figure];
    const hintNote = state.hintsHere
        ? ` — finished with ${state.hintsHere} hint${state.hintsHere === 1 ? '' : 's'}.`
        : ' — finished, and not a hint needed.';
    setStatus(`${figure.name}${hintNote}`, 'good');
    showOverlay(figure);
    updateHud();
}

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------
const statusEl = document.getElementById('status');
const overlayEl = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayVerse = document.getElementById('overlay-verse');
const figureLabel = document.getElementById('figure-label');
const solvedCount = document.getElementById('solved-count');
const hintCount = document.getElementById('hint-count');
const figureButtons = [...document.querySelectorAll('.figure-btn')];

function setStatus(text, kind = '') {
    statusEl.textContent = text;
    statusEl.className = kind;
}

function showOverlay(figure) {
    overlayTitle.textContent = `${figure.name} is finished!`;
    overlayVerse.textContent = figure.verse;
    overlayEl.classList.add('visible');
}

function hideOverlay() {
    overlayEl.classList.remove('visible');
}

function updateHud() {
    figureLabel.textContent = FIGURES[state.figure].name;
    solvedCount.textContent = `${state.done.filter(Boolean).length} / ${FIGURES.length}`;
    hintCount.textContent = String(state.hints);
    figureButtons.forEach((button, i) => {
        button.classList.toggle('active', i === state.figure);
        button.classList.toggle('done', state.done[i]);
    });
}

// ---------------------------------------------------------------------------
// Pixel geometry: where things are drawn
// ---------------------------------------------------------------------------
function latticeToPixel(x, y) {
    return { x: BOARD.x + x * UNIT, y: BOARD.y + y * UNIT };
}

// Fixed slots on the bench, laid out from the tiles' own sizes.
const TRAY_SLOTS = (() => {
    const rows = [['large1', 'large2', 'medium', 'square'], ['para', 'small1', 'small2']];
    const slots = {};
    let y = TRAY.y;
    for (const row of rows) {
        const sizes = row.map((id) => pieceSize({ id, rot: 0, flip: false }));
        const width = sizes.reduce((sum, s) => sum + s.w * UNIT, 0) + TRAY.gap * (row.length - 1);
        let x = (canvas.width - width) / 2;
        let tallest = 0;
        row.forEach((id, i) => {
            slots[id] = { x, y, w: sizes[i].w * UNIT, h: sizes[i].h * UNIT };
            x += sizes[i].w * UNIT + TRAY.gap;
            tallest = Math.max(tallest, sizes[i].h * UNIT);
        });
        y += tallest + TRAY.gap;
    }
    return slots;
})();

const TRAY_BOTTOM = Math.max(...Object.values(TRAY_SLOTS).map((s) => s.y + s.h));

// Top-left corner of a tile as drawn, in canvas pixels.
function piecePixel(piece) {
    if (state.drag && state.drag.id === piece.id) {
        return { x: state.drag.x, y: state.drag.y };
    }
    if (piece.inTray) {
        const slot = TRAY_SLOTS[piece.id];
        const size = pieceSize(piece);
        return { x: slot.x + (slot.w - size.w * UNIT) / 2, y: slot.y + (slot.h - size.h * UNIT) / 2 };
    }
    return latticeToPixel(piece.x, piece.y);
}

function pieceBox(id) {
    const piece = pieceById(id);
    const corner = piecePixel(piece);
    const size = pieceSize(piece);
    return { x: corner.x, y: corner.y, w: size.w * UNIT, h: size.h * UNIT };
}

// Outline of a tile in canvas pixels, wherever it is drawn.
function piecePixelPolygon(piece) {
    const corner = piecePixel(piece);
    return transformPoints(PIECE_BY_ID[piece.id].pts, piece.rot, piece.flip)
        .map(([x, y]) => [corner.x + x * UNIT, corner.y + y * UNIT]);
}

// A point safely inside a tile — the shapes are convex, so the average of the
// corners will do. Used for hit tests in the tests and for dragging.
function pieceGrabPoint(id) {
    const poly = piecePixelPolygon(pieceById(id));
    const sum = poly.reduce((acc, [x, y]) => ({ x: acc.x + x, y: acc.y + y }), { x: 0, y: 0 });
    return { x: sum.x / poly.length, y: sum.y / poly.length };
}

function pointInPixelPolygon(poly, px, py) {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if ((yi > py) !== (yj > py) &&
            px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
}

// Topmost tile under a point: laid tiles sit above the ones on the bench.
function pieceAtPixel(px, py) {
    const selected = state.selected ? pieceById(state.selected) : null;
    if (selected && pointInPixelPolygon(piecePixelPolygon(selected), px, py)) return selected;
    const order = [...state.pieces.filter((p) => p.inTray), ...state.pieces.filter((p) => !p.inTray)];
    for (let i = order.length - 1; i >= 0; i--) {
        if (pointInPixelPolygon(piecePixelPolygon(order[i]), px, py)) return order[i];
    }
    return null;
}

// ---------------------------------------------------------------------------
// Mouse
// ---------------------------------------------------------------------------
function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
}

canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    const point = canvasPoint(event);
    const piece = pieceAtPixel(point.x, point.y);
    if (!piece) {
        state.selected = null;
        draw();
        return;
    }
    const corner = piecePixel(piece);
    state.selected = piece.id;
    state.drag = {
        id: piece.id,
        offsetX: point.x - corner.x,
        offsetY: point.y - corner.y,
        x: corner.x,
        y: corner.y,
    };
    draw();
});

window.addEventListener('mousemove', (event) => {
    if (!state.drag) return;
    const point = canvasPoint(event);
    state.drag.x = point.x - state.drag.offsetX;
    state.drag.y = point.y - state.drag.offsetY;
    draw();
});

window.addEventListener('mouseup', () => {
    if (!state.drag) return;
    const { id, x, y } = state.drag;
    state.drag = null;
    const spot = snapSpot(id, x, y);
    if (spot) {
        placePiece(id, spot);
    } else {
        const piece = pieceById(id);
        if (!piece.inTray) setStatus('That tile landed off the board, so it is back on the bench.');
        returnToTray(id);
    }
});

// Where a tile dropped at these pixels belongs, or null when it is off board.
function snapSpot(id, px, py) {
    const piece = pieceById(id);
    const size = pieceSize(piece);
    const x = Math.round((px - BOARD.x) / UNIT);
    const y = Math.round((py - BOARD.y) / UNIT);
    if (x < 0 || y < 0 || x + size.w > BOARD.cols || y + size.h > BOARD.rows) return null;
    return { x, y };
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLButtonElement && ['Enter', ' '].includes(event.key)) return;
    const key = event.key;

    if (key >= '1' && key <= String(state.pieces.length)) {
        state.selected = state.pieces[Number(key) - 1].id;
        draw();
        return;
    }

    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (moves[key]) {
        event.preventDefault();
        if (state.selected) nudge(state.selected, moves[key][0], moves[key][1]);
        return;
    }

    if (key === 'r' || key === 'R') {
        if (state.selected) rotatePiece(state.selected, event.shiftKey ? -1 : 1);
        return;
    }
    if (key === 'f' || key === 'F') {
        if (state.selected) flipPiece(state.selected);
        return;
    }
    if (key === 'Backspace' || key === 'Delete') {
        event.preventDefault();
        if (state.selected) returnToTray(state.selected);
        return;
    }
    if (key === 'h' || key === 'H') { hint(); return; }
    if (key === 'n' || key === 'N') { nextFigure(); return; }
    if (key === 'Escape') { resetFigure(); }
});

document.getElementById('btn-reset').addEventListener('click', resetFigure);
document.getElementById('btn-hint').addEventListener('click', hint);
document.getElementById('btn-next').addEventListener('click', nextFigure);
document.getElementById('btn-continue').addEventListener('click', nextFigure);
figureButtons.forEach((button) => {
    button.addEventListener('click', () => loadFigure(Number(button.dataset.figure)));
});

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function tracePolygon(poly) {
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
}

function drawBoard() {
    const w = BOARD.cols * UNIT;
    const h = BOARD.rows * UNIT;
    const grd = ctx.createLinearGradient(0, BOARD.y, 0, BOARD.y + h);
    grd.addColorStop(0, '#2b2111');
    grd.addColorStop(1, '#1f180c');
    ctx.fillStyle = grd;
    roundRect(BOARD.x - 10, BOARD.y - 10, w + 20, h + 20, 10);
    ctx.fill();
    ctx.strokeStyle = '#4b3a1d';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'rgba(224, 169, 63, 0.16)';
    for (let y = 0; y <= BOARD.rows; y++) {
        for (let x = 0; x <= BOARD.cols; x++) {
            const p = latticeToPixel(x, y);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawFigureShadow() {
    const poly = figurePolygon().map(([x, y]) => {
        const p = latticeToPixel(x, y);
        return [p.x, p.y];
    });
    ctx.save();
    tracePolygon(poly);
    const bounds = polygonBounds(poly);
    const cut = ctx.createLinearGradient(bounds.x0, bounds.y0, bounds.x1, bounds.y1);
    cut.addColorStop(0, '#0b0804');
    cut.addColorStop(1, '#17110a');
    ctx.fillStyle = cut;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = state.solved ? '#e8c46a' : '#6d5526';
    if (state.solved) {
        ctx.shadowColor = '#e8c46a';
        ctx.shadowBlur = 22;
    }
    ctx.stroke();
    ctx.restore();
}

function drawTray() {
    const top = TRAY.y - 22;
    ctx.fillStyle = '#241c0f';
    roundRect(16, top, canvas.width - 32, TRAY_BOTTOM - top + 14, 10);
    ctx.fill();
    ctx.strokeStyle = '#3d2f17';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#8a7a58';
    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText("THE CRAFTSMAN'S BENCH", 26, top + 14);

    state.pieces.forEach((piece, i) => {
        const slot = TRAY_SLOTS[piece.id];
        if (!piece.inTray) {
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = '#3d2f17';
            ctx.lineWidth = 1;
            ctx.strokeRect(slot.x + 0.5, slot.y + 0.5, slot.w - 1, slot.h - 1);
            ctx.restore();
        }
        ctx.fillStyle = piece.inTray ? '#9b8c6e' : '#5a4c32';
        ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), slot.x + slot.w / 2, slot.y + slot.h + 11);
    });
}

function drawPiece(piece, { ghost = false, clash = false } = {}) {
    const def = PIECE_BY_ID[piece.id];
    const poly = piecePixelPolygon(piece);
    ctx.save();
    tracePolygon(poly);
    if (ghost) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(232, 196, 106, 0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        return;
    }
    if (state.drag && state.drag.id === piece.id) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = 16;
        ctx.shadowOffsetY = 6;
    }
    ctx.fillStyle = def.color;
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // A lighter top edge gives the tiles a little carved depth.
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();

    ctx.lineJoin = 'round';
    if (clash) {
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#e07a5f';
        ctx.lineWidth = 3;
    } else if (state.selected === piece.id) {
        ctx.strokeStyle = '#ffeab0';
        ctx.lineWidth = 3;
    } else {
        ctx.strokeStyle = 'rgba(26, 20, 9, 0.75)';
        ctx.lineWidth = 1.5;
    }
    ctx.stroke();
    ctx.restore();
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

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBoard();
    drawFigureShadow();
    drawTray();

    const clashes = new Set(overlappingPieces());
    const dragging = state.drag ? pieceById(state.drag.id) : null;

    for (const piece of state.pieces) {
        if (piece.inTray && piece !== dragging) drawPiece(piece, { clash: false });
    }
    for (const piece of state.pieces) {
        if (!piece.inTray && piece !== dragging) drawPiece(piece, { clash: clashes.has(piece.id) });
    }
    if (dragging) {
        const spot = snapSpot(dragging.id, state.drag.x, state.drag.y);
        if (spot) {
            drawPiece({ ...dragging, ...spot, inTray: false }, { ghost: true });
        }
        drawPiece(dragging);
    }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
loadFigure(0);
