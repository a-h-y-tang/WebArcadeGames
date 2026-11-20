// =========================================================================
// Chinese Checkers (Sternhalma)
//
// Two players on the classic six-pointed star of 121 holes: the player's ten
// green pegs start in the south point and race to the north point, the
// computer's ten amber pegs come the other way. Pegs are never captured; the
// game is won by filling the point opposite your own.
//
// One plain script with globals, like the other games in this collection, so
// the Playwright suite can reach the board model and the rules directly.
// =========================================================================

// ------------------------------------------------------------- the board
// Holes per row, top to bottom: the north point, the central hexagon with the
// four side points growing out of it, then the south point. 121 in all.
const ROW_COUNTS = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1];

const STEP = 40;                      // distance between neighbouring holes
const ROW_H = STEP * Math.sqrt(3) / 2; // row pitch of an equilateral lattice
const HOLE_R = 9;                      // empty hole
const PEG_R = 15;                      // a peg sitting in one

// The six lattice directions as [dr, du]. Opposite directions are paired, so
// direction `d` and direction `d ^ 1` always point against each other.
const DIRS = [
    [0, 2], [0, -2],     // right, left
    [-1, 1], [1, -1],    // up-right, down-left
    [-1, -1], [1, 1],    // up-left, down-right
];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const CX = canvas.width / 2;
const CY = canvas.height / 2;

// Which point of the star a hole belongs to ('hex' for the middle).
function zoneOf(r, u) {
    const n = ROW_COUNTS[r];
    if (r <= 3) return 'north';
    if (r >= 13) return 'south';
    if (r >= 4 && r <= 7) {
        const k = 8 - r;                 // 4 holes wide at row 4, 1 at row 7
        if (u <= -(n - 1) + 2 * (k - 1)) return 'nw';
        if (u >= (n - 1) - 2 * (k - 1)) return 'ne';
    }
    if (r >= 9 && r <= 12) {
        const k = r - 8;
        if (u <= -(n - 1) + 2 * (k - 1)) return 'sw';
        if (u >= (n - 1) - 2 * (k - 1)) return 'se';
    }
    return 'hex';
}

const HOLES = [];
const INDEX = new Map();               // "r,u" -> hole id

ROW_COUNTS.forEach((n, r) => {
    for (let i = 0; i < n; i++) {
        const u = -(n - 1) + 2 * i;
        const id = HOLES.length;
        HOLES.push({
            id, r, u,
            x: CX + u * STEP / 2,
            y: CY + (r - 8) * ROW_H,
            zone: zoneOf(r, u),
        });
        INDEX.set(`${r},${u}`, id);
    }
});

function holeAt(r, u) {
    const id = INDEX.get(`${r},${u}`);
    return id === undefined ? -1 : id;
}

const holeCentre = (id) => ({ x: HOLES[id].x, y: HOLES[id].y });

// NEIGHBOURS[id][d] / JUMPS[id][d]: one and two holes away in direction d, or -1.
const NEIGHBOURS = HOLES.map((h) => DIRS.map(([dr, du]) => holeAt(h.r + dr, h.u + du)));
const JUMPS = HOLES.map((h) => DIRS.map(([dr, du]) => holeAt(h.r + 2 * dr, h.u + 2 * du)));

const ZONES = {};
for (const h of HOLES) (ZONES[h.zone] = ZONES[h.zone] || []).push(h.id);
const zoneHoles = (zone) => ZONES[zone].slice();

const HOME = { player: 'south', cpu: 'north' };    // where each side starts
const TARGET = { player: 'north', cpu: 'south' };  // and where it is heading
const PEGS_PER_SIDE = 10;

// The outline of the star: the six tips and the six inner corners, in order.
const OUTLINE = [[0, 0], [4, 4], [4, 12], [8, 8], [12, 12], [12, 4],
                 [16, 0], [12, -4], [12, -12], [8, -8], [4, -12], [4, -4]]
    .map(([r, u]) => HOLES[holeAt(r, u)]);

// ------------------------------------------------------------------ state
let board = new Array(HOLES.length).fill(null);  // null | 'player' | 'cpu'
let turn = 'player';
let selected = null;        // hole id of the peg in hand
let chain = [];             // holes visited this turn: [start, ...landings]
let winner = null;
let moves = 0;              // completed player turns
let history = [];           // positions before each of the player's turns
let difficulty = 'gentle';  // 'gentle' | 'keen'
let cursor = holeAt(16, 0); // keyboard cursor
let keyboardActive = false; // the cursor ring only shows once keys are used
let cpuTimer = null;
let cpuDelayMs = 400;       // thinking pause, so a move can be followed by eye

// Tie-breaking randomness, seeded so a test can replay a game exactly.
let rngSeed = (Date.now() ^ 0x5f3759df) & 0x7fffffff;
let rngState = rngSeed;
function rng() {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
}

// ------------------------------------------------------------------ rules
const other = (side) => (side === 'player' ? 'cpu' : 'player');

function pegsIn(zone, side) {
    return ZONES[zone].reduce((n, id) => n + (board[id] === side ? 1 : 0), 0);
}

const zoneFull = (zone) => ZONES[zone].every((id) => board[id] !== null);

// All the holes the peg on `id` may move to right now. Mid-chain that is jumps
// only, and never a hole the chain has already touched.
function legalDestinations(id) {
    if (winner || id < 0 || id >= HOLES.length || board[id] === null) return [];
    const midChain = chain.length > 1 && selected === id;
    const out = [];
    if (!midChain) {
        for (const n of NEIGHBOURS[id]) if (n >= 0 && board[n] === null) out.push(n);
    }
    for (const j of jumpTargets(id, midChain ? chain : [])) out.push(j);
    return out;
}

// Holes reachable by a single jump from `id`, skipping anything in `visited`.
function jumpTargets(id, visited = []) {
    const out = [];
    for (let d = 0; d < DIRS.length; d++) {
        const mid = NEIGHBOURS[id][d];
        const land = JUMPS[id][d];
        if (mid < 0 || land < 0) continue;
        if (board[mid] === null || board[land] !== null) continue;
        if (visited.includes(land)) continue;
        out.push(land);
    }
    return out;
}

const isJumpMove = (from, to) => JUMPS[from].includes(to);

function whoWins() {
    for (const side of ['player', 'cpu']) {
        const home = pegsIn(TARGET[side], side);
        // All ten home, or as many as can fit because the other side is squatting.
        if (home === PEGS_PER_SIDE) return side;
        if (home >= PEGS_PER_SIDE - 1 && zoneFull(TARGET[side])) return side;
    }
    return null;
}

// ------------------------------------------------------------ making moves
function snapshotState() {
    return { board: board.slice(), moves, rngState };
}

function restoreState(s) {
    board = s.board.slice();
    moves = s.moves;
    rngState = s.rngState;
}

function select(id) {
    selected = id;
    chain = [id];
    cursor = id;
    setStatus('Click a ringed hole to move there.');
    draw();
}

function deselect() {
    selected = null;
    chain = [];
    setStatus(statusForTurn());
    draw();
}

// Move the peg in hand to `to`. Returns true when the whole turn is over.
function movePeg(from, to) {
    const side = board[from];
    if (side === null) return false;
    if (chain.length === 0) chain = [from];
    if (chain.length === 1 && side === 'player') history.push(snapshotState());

    const jumped = isJumpMove(from, to);
    board[to] = side;
    board[from] = null;
    chain.push(to);
    selected = to;
    cursor = to;

    // A chain may carry on only after a jump, and only if another jump exists.
    if (jumped && jumpTargets(to, chain).length > 0) {
        if (side === 'player') setStatus('Jump again, or press Esc to stop here.');
        draw();
        return false;
    }
    finishTurn(side);
    return true;
}

function finishTurn(side) {
    if (side === 'player') moves += 1;
    selected = null;
    chain = [];
    winner = whoWins();
    updateHud();
    if (winner) {
        showOverlay();
        setStatus(winner === 'player' ? 'You filled the far point — you win!' : 'The computer got home first.');
        draw();
        return;
    }
    turn = other(side);
    setStatus(statusForTurn());
    draw();
    if (turn === 'cpu') scheduleCpu();
}

// End the turn where the peg stands, part-way through a chain of jumps.
function stopChain() {
    if (chain.length > 1) finishTurn(board[selected]);
    else deselect();
}

// ------------------------------------------------------- the computer player
// Every move the side can make, as { from, to, path }.
function allMoves(side) {
    const out = [];
    for (const h of HOLES) {
        if (board[h.id] !== side) continue;
        for (const n of NEIGHBOURS[h.id]) {
            if (n >= 0 && board[n] === null) out.push({ from: h.id, to: n, path: [h.id, n] });
        }
        // Jump chains: walk the jump graph with the peg lifted off its hole.
        board[h.id] = null;
        const seen = new Set([h.id]);
        const queue = [[h.id]];
        while (queue.length) {
            const path = queue.shift();
            const here = path[path.length - 1];
            for (const land of jumpTargets(here, path)) {
                if (seen.has(land)) continue;
                seen.add(land);
                const next = [...path, land];
                out.push({ from: h.id, to: land, path: next });
                queue.push(next);
            }
        }
        board[h.id] = side;
    }
    return out;
}

// How well `side` stands: forward progress first, then hugging the open middle
// of the board, then settling into the deep holes of the target point.
function scorePosition(side) {
    const target = TARGET[side];
    let score = 0;
    for (const h of HOLES) {
        if (board[h.id] !== side) continue;
        const forward = side === 'cpu' ? h.r : 16 - h.r;
        score += forward * 10;
        score -= Math.abs(h.u) * 0.6;
        if (h.zone === target) score += 25 + forward;
        else if (h.zone === HOME[side]) score -= 8;   // don't dawdle at home
    }
    return score;
}

function withMove(move, fn) {
    const side = board[move.from];
    board[move.from] = null;
    board[move.to] = side;
    const result = fn();
    board[move.to] = null;
    board[move.from] = side;
    return result;
}

function chooseMove(side) {
    const moveList = allMoves(side);
    if (!moveList.length) return null;

    const base = scorePosition(side);
    const scored = moveList.map((move) => ({
        move,
        value: withMove(move, () => scorePosition(side)) - base + rng() * 0.4,
    }));
    scored.sort((a, b) => b.value - a.value);

    if (difficulty !== 'keen') {
        // Pick at random among the moves within a whisker of the best one.
        const cut = scored[0].value - 2;
        const good = scored.filter((s) => s.value >= cut);
        return good[Math.floor(rng() * good.length)].move;
    }

    // Keen: of the strongest candidates, prefer the one that leaves the other
    // side the least to work with.
    const foe = other(side);
    let best = scored[0];
    let bestValue = -Infinity;
    for (const candidate of scored.slice(0, 8)) {
        const reply = withMove(candidate.move, () => {
            const foeBase = scorePosition(foe);
            return allMoves(foe).reduce(
                (max, m) => Math.max(max, withMove(m, () => scorePosition(foe)) - foeBase),
                0
            );
        });
        const value = candidate.value - reply * 0.5;
        if (value > bestValue) {
            bestValue = value;
            best = candidate;
        }
    }
    return best.move;
}

function scheduleCpu() {
    clearTimeout(cpuTimer);
    cpuTimer = setTimeout(playCpuTurn, cpuDelayMs);
}

function playCpuTurn() {
    cpuTimer = null;
    if (winner || turn !== 'cpu') return;
    const move = chooseMove('cpu');
    if (!move) {               // cannot happen on a 121-hole board, but be safe
        finishTurn('cpu');
        return;
    }
    // Replay the chosen path so the board passes through every landing hole.
    chain = [move.from];
    selected = move.from;
    for (let i = 1; i < move.path.length; i++) {
        const from = move.path[i - 1];
        const to = move.path[i];
        board[to] = 'cpu';
        board[from] = null;
        chain.push(to);
        selected = to;
    }
    const hops = move.path.length - 1;
    finishTurn('cpu');
    if (!winner) {
        setStatus(hops > 1
            ? `The computer rode a chain of ${hops} jumps — your move.`
            : 'The computer moved — your move.');
    }
}

// ------------------------------------------------------------------ drawing
function outlinePath() {
    ctx.beginPath();
    OUTLINE.forEach((h, i) => {
        const dx = h.x - CX;
        const dy = h.y - CY;
        const len = Math.hypot(dx, dy) || 1;
        const x = h.x + (dx / len) * 19;
        const y = h.y + (dy / len) * 19;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.closePath();
}

const ZONE_TINT = {
    north: 'rgba(214, 158, 74, 0.14)',
    south: 'rgba(96, 196, 136, 0.14)',
};

// The triangle of a home point, as a path grown a little past its holes so the
// pegs sitting in them stay inside the tint.
const ZONE_CORNERS = {
    north: [[0, 0], [3, -3], [3, 3]],
    south: [[16, 0], [13, -3], [13, 3]],
};

function zoneTrianglePath(zone) {
    const pts = ZONE_CORNERS[zone].map(([r, u]) => HOLES[holeAt(r, u)]);
    const mx = pts.reduce((s, h) => s + h.x, 0) / 3;
    const my = pts.reduce((s, h) => s + h.y, 0) / 3;
    ctx.beginPath();
    pts.forEach((h, i) => {
        const len = Math.hypot(h.x - mx, h.y - my) || 1;
        const x = h.x + ((h.x - mx) / len) * (PEG_R + 6);
        const y = h.y + ((h.y - my) / len) * (PEG_R + 6);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.closePath();
}

function drawPeg(h, side, lifted) {
    const colours = side === 'player'
        ? { light: '#9fe8bd', mid: '#4cbb83', dark: '#237a52' }
        : { light: '#f6d79a', mid: '#dca245', dark: '#9a6a1c' };
    const grad = ctx.createRadialGradient(h.x - 4, h.y - 5, 2, h.x, h.y, PEG_R);
    grad.addColorStop(0, colours.light);
    grad.addColorStop(0.6, colours.mid);
    grad.addColorStop(1, colours.dark);

    ctx.beginPath();
    ctx.arc(h.x, h.y + 2, PEG_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(h.x, h.y, PEG_R, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = lifted ? 3 : 1.5;
    ctx.strokeStyle = lifted ? '#ffffff' : 'rgba(10, 16, 24, 0.55)';
    ctx.stroke();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // the board plate
    outlinePath();
    ctx.fillStyle = '#20293a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#38465f';
    ctx.stroke();

    // the two home points, tinted
    for (const zone of ['north', 'south']) {
        zoneTrianglePath(zone);
        ctx.fillStyle = ZONE_TINT[zone];
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = zone === 'north' ? 'rgba(214, 158, 74, 0.4)' : 'rgba(96, 196, 136, 0.4)';
        ctx.stroke();
    }

    // the lattice: every line a peg can travel along. Three of the six
    // directions is enough, since the other three draw the same lines.
    ctx.beginPath();
    for (const h of HOLES) {
        for (const d of [0, 2, 5]) {
            const n = NEIGHBOURS[h.id][d];
            if (n < 0) continue;
            ctx.moveTo(h.x, h.y);
            ctx.lineTo(HOLES[n].x, HOLES[n].y);
        }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120, 145, 180, 0.18)';
    ctx.stroke();

    // every hole
    for (const h of HOLES) {
        ctx.beginPath();
        ctx.arc(h.x, h.y, HOLE_R, 0, Math.PI * 2);
        ctx.fillStyle = '#161d29';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(120, 140, 170, 0.35)';
        ctx.stroke();
    }

    // the path a chain of jumps has taken this turn
    if (chain.length > 1) {
        ctx.beginPath();
        chain.forEach((id, i) => {
            const h = HOLES[id];
            if (i === 0) ctx.moveTo(h.x, h.y);
            else ctx.lineTo(h.x, h.y);
        });
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // the pegs
    for (const h of HOLES) {
        if (board[h.id]) drawPeg(h, board[h.id], h.id === selected);
    }

    // where the peg in hand may go
    if (selected !== null && !winner) {
        for (const id of legalDestinations(selected)) {
            const h = HOLES[id];
            ctx.beginPath();
            ctx.arc(h.x, h.y, PEG_R - 2, 0, Math.PI * 2);
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = 'rgba(145, 226, 180, 0.9)';
            ctx.stroke();
        }
    }

    // the keyboard cursor
    if (keyboardActive && !winner) {
        const h = HOLES[cursor];
        ctx.beginPath();
        ctx.arc(h.x, h.y, PEG_R + 4, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

// --------------------------------------------------------------- the chrome
const statusEl = document.getElementById('status');
const overlayEl = document.getElementById('overlay');

function statusForTurn() {
    if (winner) return winner === 'player' ? 'You win!' : 'The computer wins.';
    return turn === 'player' ? 'Your move — pick a green peg.' : 'The computer is thinking…';
}

function setStatus(text) {
    statusEl.textContent = text;
}

function updateHud() {
    document.getElementById('home-player').textContent = `${pegsIn('north', 'player')} / 10`;
    document.getElementById('home-cpu').textContent = `${pegsIn('south', 'cpu')} / 10`;
    document.getElementById('moves').textContent = String(moves);
}

function showOverlay() {
    document.getElementById('overlay-title').textContent =
        winner === 'player' ? 'You win!' : 'The computer wins';
    document.getElementById('overlay-sub').textContent =
        winner === 'player'
            ? `All ten pegs home in ${moves} moves.`
            : 'Its amber pegs filled your point first — try again?';
    overlayEl.classList.add('show');
}

function hideOverlay() {
    overlayEl.classList.remove('show');
}

// ------------------------------------------------------------------- setup
function newGame() {
    clearTimeout(cpuTimer);
    cpuTimer = null;
    rngState = rngSeed;
    rngSeed = (rngSeed * 1103515245 + 12345) & 0x7fffffff;  // the next game differs
    board = new Array(HOLES.length).fill(null);
    for (const id of ZONES.south) board[id] = 'player';
    for (const id of ZONES.north) board[id] = 'cpu';
    turn = 'player';
    selected = null;
    chain = [];
    history = [];
    winner = null;
    moves = 0;
    cursor = holeAt(16, 0);
    hideOverlay();
    updateHud();
    setStatus(statusForTurn());
    draw();
}

// Put an exact position on the board. Used by the tests to reach late-game
// positions without playing a hundred moves first.
function setupPosition({ player = [], cpu = [], turn: whose = 'player' } = {}) {
    clearTimeout(cpuTimer);
    cpuTimer = null;
    board = new Array(HOLES.length).fill(null);
    for (const id of player) board[id] = 'player';
    for (const id of cpu) board[id] = 'cpu';
    turn = whose;
    selected = null;
    chain = [];
    history = [];
    winner = null;
    moves = 0;
    hideOverlay();
    updateHud();
    setStatus(statusForTurn());
    draw();
    if (turn === 'cpu') scheduleCpu();
}

function undo() {
    if (!history.length) return;
    clearTimeout(cpuTimer);
    cpuTimer = null;
    restoreState(history.pop());
    turn = 'player';
    selected = null;
    chain = [];
    winner = null;
    hideOverlay();
    updateHud();
    setStatus(statusForTurn());
    draw();
}

function toggleDifficulty() {
    difficulty = difficulty === 'gentle' ? 'keen' : 'gentle';
    document.getElementById('btn-difficulty').textContent =
        `Computer: ${difficulty === 'gentle' ? 'Gentle' : 'Keen'}`;
}

// ------------------------------------------------------------------- input
function holeAtPoint(x, y) {
    let best = -1;
    let bestDist = PEG_R + 6;
    for (const h of HOLES) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d < bestDist) {
            bestDist = d;
            best = h.id;
        }
    }
    return best;
}

function activate(id) {
    if (winner || turn !== 'player' || id < 0) return;
    if (selected !== null) {
        if (id === selected) {
            stopChain();
            return;
        }
        if (legalDestinations(selected).includes(id)) {
            movePeg(selected, id);
            return;
        }
        if (chain.length <= 1 && board[id] === 'player') select(id);
        return;
    }
    if (board[id] === 'player') select(id);
}

canvas.addEventListener('click', (event) => {
    keyboardActive = false;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    activate(holeAtPoint((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY));
});

function setCursor(id) {
    if (id < 0) return;
    cursor = id;
    keyboardActive = true;
    draw();
}

// The neighbouring hole whose direction best matches the arrow key, so the
// cursor always walks the lattice one hole at a time.
function moveCursor(dx, dy) {
    const from = HOLES[cursor];
    let best = -1;
    let bestAlong = 0.01;
    for (const n of NEIGHBOURS[cursor]) {
        if (n < 0) continue;
        const along = ((HOLES[n].x - from.x) * dx + (HOLES[n].y - from.y) * dy) / STEP;
        if (along < bestAlong - 0.001) continue;
        if (along > bestAlong + 0.001 || best < 0 || HOLES[n].u < HOLES[best].u) {
            bestAlong = Math.max(bestAlong, along);
            best = n;
        }
    }
    keyboardActive = true;
    if (best >= 0) setCursor(best);
    else draw();
}

const ARROWS = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
};

document.addEventListener('keydown', (event) => {
    const key = event.key;
    // Let a focused button keep its own Space / Enter.
    if ((key === ' ' || key === 'Enter') && event.target && event.target.tagName === 'BUTTON') return;
    if (ARROWS[key]) {
        event.preventDefault();
        moveCursor(...ARROWS[key]);
        return;
    }
    if (key === ' ' || key === 'Enter') {
        event.preventDefault();
        keyboardActive = true;
        activate(cursor);
        draw();
        return;
    }
    if (key === 'Escape') {
        if (selected !== null) stopChain();
        return;
    }
    const lower = key.toLowerCase();
    if (lower === 'n') newGame();
    else if (lower === 'u') undo();
    else if (lower === 'd') toggleDifficulty();
});

document.getElementById('btn-new').addEventListener('click', newGame);
document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-difficulty').addEventListener('click', toggleDifficulty);
document.getElementById('btn-again').addEventListener('click', newGame);

newGame();
