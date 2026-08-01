// ---------------------------------------------------------------------------
// Quoridor — the two-player abstract strategy race, played against a computer
// opponent on an HTML5 canvas.
//
// Each side owns a pawn and a stock of ten fences. On your turn you either step
// your pawn one square or drop a two-square fence into the grooves between
// cells. The catch: a fence may never leave *either* pawn without a route to
// its goal row, so every wall placement is validated with a breadth-first
// search before it is accepted.
//
// Written as a single classic (non-module) script so the game state and rules
// are reachable from Playwright as plain globals, mirroring Kaboom, Snake and
// Tetris in this repo. The rules layer is pure and synchronous — no timers, no
// randomness — so tests drive whole games deterministically by calling
// `movePawn`, `placeWall` and `aiMove` directly.
// ---------------------------------------------------------------------------

// --- Rules ---
const BOARD_SIZE = 9;              // 9x9 cells
const SLOT_SIZE = BOARD_SIZE - 1;  // 8x8 grooves between them
const WALLS_PER_PLAYER = 10;

// --- Geometry (canvas units) ---
const MARGIN = 14;
const CELL = 52;
const GAP = 8;
const STEP = CELL + GAP;           // pitch from one cell to the next
const CANVAS_W = MARGIN * 2 + BOARD_SIZE * CELL + SLOT_SIZE * GAP; // 560
const CANVAS_H = CANVAS_W;
const SLOT_TOLERANCE = 14;         // how close a click must land to a groove

// --- Presentation ---
const AI_DELAY = 420;              // ms of "thinking" before the computer acts
const COLORS = ['#38bdf8', '#f472b6'];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const turnEl = document.getElementById('turn');
const wallsEls = [document.getElementById('walls-0'), document.getElementById('walls-1')];
const statusEl = document.getElementById('status');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnNew = document.getElementById('btn-new');
const btnOrientation = document.getElementById('btn-orientation');

// --- State ---
// state: 'idle' | 'playing' | 'over'
let state = 'idle';
let turn = 0;                      // 0 = human (moves up), 1 = computer
let winner = null;
let wallOrientation = 'h';         // orientation used by the next wall click
let autoAI = true;                 // tests switch this off to step the AI by hand
let aiTimer = null;
let pawns = [{ r: 8, c: 4 }, { r: 0, c: 4 }];
let wallsLeft = [WALLS_PER_PLAYER, WALLS_PER_PLAYER];
const walls = [];                  // { r, c, o } with r,c in 0..7 and o in 'h'|'v'
let hoverSlot = null;
let hoverCell = null;

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

function goalRow(player) {
    return player === 0 ? 0 : BOARD_SIZE - 1;
}

function inBoard(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function inSlotGrid(r, c) {
    return r >= 0 && r < SLOT_SIZE && c >= 0 && c < SLOT_SIZE;
}

function wallAt(r, c, o, list) {
    return (list || walls).some((w) => w.r === r && w.c === c && (!o || w.o === o));
}

// True when a fence stands between two orthogonally adjacent cells.
//   horizontal wall (r,c): separates rows r/r+1 across columns c and c+1
//   vertical   wall (r,c): separates columns c/c+1 across rows r and r+1
function isBlocked(r1, c1, r2, c2, list) {
    const set = list || walls;
    if (r1 === r2) {
        const c = Math.min(c1, c2);          // crossing the groove right of column c
        return set.some((w) => w.o === 'v' && w.c === c && (w.r === r1 || w.r === r1 - 1));
    }
    if (c1 === c2) {
        const r = Math.min(r1, r2);          // crossing the groove below row r
        return set.some((w) => w.o === 'h' && w.r === r && (w.c === c1 || w.c === c1 - 1));
    }
    return true;                              // not adjacent — treat as impassable
}

// Cells reachable in one plain step, ignoring the other pawn.
function openNeighbors(r, c, list) {
    const out = [];
    const deltas = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of deltas) {
        const nr = r + dr, nc = c + dc;
        if (!inBoard(nr, nc)) continue;
        if (isBlocked(r, c, nr, nc, list)) continue;
        out.push({ r: nr, c: nc });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Legal pawn moves (including the jump rules)
// ---------------------------------------------------------------------------

function legalMoves(player, list) {
    const me = pawns[player];
    const foe = pawns[1 - player];
    const moves = [];
    const add = (r, c) => {
        if (!inBoard(r, c)) return;
        if (r === foe.r && c === foe.c) return;
        if (!moves.some((m) => m.r === r && m.c === c)) moves.push({ r, c });
    };

    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = me.r + dr, nc = me.c + dc;
        if (!inBoard(nr, nc)) continue;
        if (isBlocked(me.r, me.c, nr, nc, list)) continue;

        if (nr !== foe.r || nc !== foe.c) {
            add(nr, nc);
            continue;
        }

        // The opponent is in the way: try to hop straight over it first.
        const jr = nr + dr, jc = nc + dc;
        const straightOk = inBoard(jr, jc) && !isBlocked(nr, nc, jr, jc, list);
        if (straightOk) {
            add(jr, jc);
        } else {
            // Blocked behind (wall or edge) — step diagonally around instead.
            for (const [sr, sc] of dr === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]]) {
                const ar = nr + sr, ac = nc + sc;
                if (!inBoard(ar, ac)) continue;
                if (isBlocked(nr, nc, ar, ac, list)) continue;
                add(ar, ac);
            }
        }
    }
    return moves;
}

function isLegalMove(player, r, c) {
    return legalMoves(player).some((m) => m.r === r && m.c === c);
}

// ---------------------------------------------------------------------------
// Pathfinding — breadth-first search from a pawn to its goal row.
// The opposing pawn is ignored (it can always be jumped or walked around), which
// keeps the search a pure function of the wall layout.
// ---------------------------------------------------------------------------

function shortestPath(player, list) {
    const start = pawns[player];
    const goal = goalRow(player);
    if (start.r === goal) return 0;

    const seen = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
    let frontier = [start];
    seen[start.r * BOARD_SIZE + start.c] = 1;
    let dist = 0;

    while (frontier.length) {
        dist += 1;
        const next = [];
        for (const cell of frontier) {
            for (const n of openNeighbors(cell.r, cell.c, list)) {
                const key = n.r * BOARD_SIZE + n.c;
                if (seen[key]) continue;
                if (n.r === goal) return dist;
                seen[key] = 1;
                next.push(n);
            }
        }
        frontier = next;
    }
    return null;
}

function hasPath(player, list) {
    return shortestPath(player, list) !== null;
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

function wallConflicts(r, c, o, list) {
    const set = list || walls;
    if (wallAt(r, c, null, set)) return true;                 // slot taken (also blocks crosses)
    if (o === 'h') {
        return wallAt(r, c - 1, 'h', set) || wallAt(r, c + 1, 'h', set);
    }
    return wallAt(r - 1, c, 'v', set) || wallAt(r + 1, c, 'v', set);
}

function canPlaceWall(r, c, o) {
    if (state !== 'playing') return false;
    if (o !== 'h' && o !== 'v') return false;
    if (!inSlotGrid(r, c)) return false;
    if (wallsLeft[turn] <= 0) return false;
    if (wallConflicts(r, c, o)) return false;

    // A fence may never seal either pawn away from its goal row.
    const probe = walls.concat([{ r, c, o }]);
    return hasPath(0, probe) && hasPath(1, probe);
}

function placeWall(r, c, o) {
    if (!canPlaceWall(r, c, o)) return false;
    walls.push({ r, c, o });
    wallsLeft[turn] -= 1;
    endTurn();
    return true;
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

function movePawn(r, c) {
    if (state !== 'playing') return false;
    if (!isLegalMove(turn, r, c)) return false;
    pawns[turn] = { r, c };
    if (r === goalRow(turn)) {
        endGame(turn);
        return true;
    }
    endTurn();
    return true;
}

function endTurn() {
    turn = 1 - turn;
    updateHud();
    if (turn === 1 && state === 'playing' && autoAI) {
        clearTimeout(aiTimer);
        aiTimer = setTimeout(() => { aiTimer = null; aiMove(); }, AI_DELAY);
    }
}

function endGame(who) {
    state = 'over';
    winner = who;
    clearTimeout(aiTimer);
    aiTimer = null;
    const title = who === 0 ? 'You win!' : 'Computer wins';
    const sub = who === 0
        ? 'You crossed the board first. Press Space to play again.'
        : 'The computer got home first. Press Space to try again.';
    showOverlay(title, sub, 'Play Again');
    setStatus(title);
    updateHud();
}

function startGame() {
    clearTimeout(aiTimer);
    aiTimer = null;
    state = 'playing';
    turn = 0;
    winner = null;
    pawns = [{ r: 8, c: 4 }, { r: 0, c: 4 }];
    wallsLeft = [WALLS_PER_PLAYER, WALLS_PER_PLAYER];
    walls.length = 0;
    hoverSlot = null;
    hoverCell = null;
    hideOverlay();
    setStatus('Your move — step forward or drop a fence.');
    updateHud();
}

// ---------------------------------------------------------------------------
// Computer opponent
//
// One-ply greedy search. Every candidate action is scored by how the race looks
// afterwards: `opponentDistance - ownDistance`. Pawn steps are preferred on a
// tie, so a fence is only spent when it buys strictly more than walking does —
// in practice, when it costs the human at least two extra steps.
// ---------------------------------------------------------------------------

function evaluateForAI() {
    const mine = shortestPath(1);
    const theirs = shortestPath(0);
    if (mine === null) return -Infinity;
    if (theirs === null) return Infinity;
    return theirs - mine;
}

function bestPawnMove() {
    const save = { ...pawns[1] };
    let best = null;
    for (const m of legalMoves(1)) {
        pawns[1] = m;
        const score = m.r === goalRow(1) ? Infinity : evaluateForAI();
        pawns[1] = save;
        if (!best || score > best.score) best = { move: m, score };
    }
    return best;
}

function bestWall() {
    if (wallsLeft[1] <= 0) return null;
    let best = null;
    for (let r = 0; r < SLOT_SIZE; r++) {
        for (let c = 0; c < SLOT_SIZE; c++) {
            for (const o of ['h', 'v']) {
                if (!canPlaceWall(r, c, o)) continue;
                walls.push({ r, c, o });
                const score = evaluateForAI();
                walls.pop();
                if (!best || score > best.score) best = { wall: { r, c, o }, score };
            }
        }
    }
    return best;
}

function aiMove() {
    if (state !== 'playing') return;
    turn = 1;

    const move = bestPawnMove();
    const wall = bestWall();

    if (wall && (!move || wall.score > move.score)) {
        setStatus('The computer drops a fence.');
        placeWall(wall.wall.r, wall.wall.c, wall.wall.o);
        return;
    }
    if (move) {
        setStatus('The computer advances.');
        movePawn(move.move.r, move.move.c);
    }
}

// ---------------------------------------------------------------------------
// Canvas geometry
// ---------------------------------------------------------------------------

function cellOrigin(r, c) {
    return { x: MARGIN + c * STEP, y: MARGIN + r * STEP };
}

function cellCenter(r, c) {
    const o = cellOrigin(r, c);
    return { x: o.x + CELL / 2, y: o.y + CELL / 2 };
}

// Centre of the groove intersection south-east of cell (r, c).
function slotCenter(r, c) {
    return {
        x: MARGIN + (c + 1) * STEP - GAP / 2,
        y: MARGIN + (r + 1) * STEP - GAP / 2,
    };
}

function cellFromPoint(x, y) {
    const axis = (v) => {
        const i = Math.floor((v - MARGIN) / STEP);
        if (i < 0 || i >= BOARD_SIZE) return -1;
        const offset = v - MARGIN - i * STEP;
        return offset >= 0 && offset <= CELL ? i : -1;
    };
    const c = axis(x), r = axis(y);
    return r < 0 || c < 0 ? null : { r, c };
}

function slotFromPoint(x, y) {
    const axis = (v) => {
        const i = Math.round((v - MARGIN - STEP + GAP / 2) / STEP);
        if (i < 0 || i >= SLOT_SIZE) return -1;
        const centre = MARGIN + (i + 1) * STEP - GAP / 2;
        return Math.abs(v - centre) <= SLOT_TOLERANCE ? i : -1;
    };
    const c = axis(x), r = axis(y);
    return r < 0 || c < 0 ? null : { r, c };
}

function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (CANVAS_W / rect.width),
        y: (e.clientY - rect.top) * (CANVAS_H / rect.height),
    };
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    wallsEls[0].textContent = String(wallsLeft[0]);
    wallsEls[1].textContent = String(wallsLeft[1]);
    turnEl.textContent = state === 'over'
        ? (winner === 0 ? 'You won' : 'CPU won')
        : (turn === 0 ? 'You' : 'CPU');
    btnOrientation.textContent = wallOrientation === 'h' ? 'Wall: Horizontal' : 'Wall: Vertical';
}

function setStatus(text) {
    statusEl.textContent = text;
}

function showOverlay(title, sub, buttonText) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    btnStart.textContent = buttonText;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function toggleOrientation() {
    wallOrientation = wallOrientation === 'h' ? 'v' : 'h';
    updateHud();
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

function drawWallBar(w, style) {
    const o = cellOrigin(w.r, w.c);
    ctx.fillStyle = style;
    if (w.o === 'h') {
        roundRect(o.x, o.y + CELL, CELL * 2 + GAP, GAP, GAP / 2);
    } else {
        roundRect(o.x + CELL, o.y, GAP, CELL * 2 + GAP, GAP / 2);
    }
    ctx.fill();
}

function draw() {
    ctx.fillStyle = '#0e1526';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Cells, with each player's goal row tinted in their colour.
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const o = cellOrigin(r, c);
            ctx.fillStyle = r === 0 ? '#17304d' : r === 8 ? '#3a1d33' : '#1a2338';
            roundRect(o.x, o.y, CELL, CELL, 6);
            ctx.fill();
        }
    }

    // Legal destinations for the human player.
    if (state === 'playing' && turn === 0) {
        for (const m of legalMoves(0)) {
            const p = cellCenter(m.r, m.c);
            ctx.fillStyle = 'rgba(56, 189, 248, 0.28)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Placed fences.
    for (const w of walls) drawWallBar(w, '#c8873f');

    // Wall preview under the pointer.
    if (state === 'playing' && turn === 0 && hoverSlot) {
        const ok = canPlaceWall(hoverSlot.r, hoverSlot.c, wallOrientation);
        drawWallBar(
            { r: hoverSlot.r, c: hoverSlot.c, o: wallOrientation },
            ok ? 'rgba(74, 222, 128, 0.65)' : 'rgba(248, 113, 113, 0.5)',
        );
    }

    // Pawns.
    for (let i = 0; i < 2; i++) {
        const p = cellCenter(pawns[i].r, pawns[i].c);
        ctx.fillStyle = COLORS[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(9, 13, 25, 0.75)';
        ctx.lineWidth = 3;
        ctx.stroke();
        if (turn === i && state === 'playing') {
            ctx.strokeStyle = COLORS[i];
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 23, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

function frame() {
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

canvas.addEventListener('mousemove', (e) => {
    const p = pointFromEvent(e);
    hoverCell = cellFromPoint(p.x, p.y);
    hoverSlot = slotFromPoint(p.x, p.y);
});

canvas.addEventListener('mouseleave', () => {
    hoverCell = null;
    hoverSlot = null;
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    toggleOrientation();
});

canvas.addEventListener('click', (e) => {
    if (state !== 'playing' || turn !== 0) return;
    const p = pointFromEvent(e);

    const cell = cellFromPoint(p.x, p.y);
    if (cell && isLegalMove(0, cell.r, cell.c)) {
        movePawn(cell.r, cell.c);
        return;
    }

    const slot = slotFromPoint(p.x, p.y);
    if (!slot) return;
    if (placeWall(slot.r, slot.c, wallOrientation)) return;

    if (wallsLeft[0] <= 0) setStatus('You are out of fences — you have to walk.');
    else if (wallConflicts(slot.r, slot.c, wallOrientation)) setStatus('A fence already crosses that groove.');
    else setStatus('That fence would trap a pawn — not allowed.');
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
        toggleOrientation();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state !== 'playing') startGame();
        e.preventDefault();
        return;
    }
    const dirs = {
        ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
        w: [-1, 0], s: [1, 0], a: [0, -1], d: [0, 1],
    };
    const dir = dirs[e.key];
    if (!dir) return;
    e.preventDefault();
    if (state !== 'playing' || turn !== 0) return;
    // Step one square, or jump the two-square hop when the pawns are face to face.
    const target = { r: pawns[0].r + dir[0], c: pawns[0].c + dir[1] };
    const jump = { r: pawns[0].r + dir[0] * 2, c: pawns[0].c + dir[1] * 2 };
    if (isLegalMove(0, target.r, target.c)) movePawn(target.r, target.c);
    else if (isLegalMove(0, jump.r, jump.c)) movePawn(jump.r, jump.c);
});

btnStart.addEventListener('click', () => startGame());
btnNew.addEventListener('click', () => startGame());
btnOrientation.addEventListener('click', () => toggleOrientation());

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

updateHud();
requestAnimationFrame(frame);
