// Up to Jerusalem — four pilgrim families race up to the temple for the feast.
// Plain canvas and plain script: no modules, no build step. The globals below
// are the game's whole state, which also makes the Playwright suite able to
// read and drive it directly.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const GRID = 15;                 // the board is 15 x 15 cells
const CELL = canvas.width / GRID; // 40 px
const HOME = -1;                 // a pilgrim waiting in its home town
const TEMPLE = 56;               // path value of the temple courts
const ROAD_LEN = 52;             // cells in the shared road
const LAST_ROAD = 50;            // last path value still on the shared road
const START = [0, 13, 26, 39];   // road index of each family's start cell
const WELLS = [8, 21, 34, 47];   // road index of each family's safe well
const SAFE = new Set([...START, ...WELLS]);
const HUMAN = 0;                 // the family you travel with
const STORE_KEY = 'up-to-jerusalem-wins';

const FAMILIES = [
    { name: 'Nazareth', color: '#5b9bf8', deep: '#1c3f74', pale: '#cfe0fb', town: { r: 0, c: 0 } },
    { name: 'Jericho', color: '#4ec98a', deep: '#17573b', pale: '#cdefdd', town: { r: 0, c: 9 } },
    { name: 'Beersheba', color: '#f0b429', deep: '#6d4e07', pale: '#fbe7bd', town: { r: 9, c: 9 } },
    { name: 'Joppa', color: '#ef6f8c', deep: '#6f2338', town: { r: 9, c: 0 }, pale: '#fbd5de' },
];

// ---------------------------------------------------------------------------
// Board geometry
// ---------------------------------------------------------------------------

// The 52 cells of the shared road, clockwise from Nazareth's start cell.
// Each of the four arms contributes thirteen cells; the road steps across a
// corner between arms, as it does on a printed board.
function buildRoad() {
    const cells = [];
    const add = (r, c) => cells.push({ r, c });
    for (let c = 1; c <= 5; c++) add(6, c);          // 0-4   Nazareth's lane
    for (let r = 5; r >= 0; r--) add(r, 6);          // 5-10
    add(0, 7);                                       // 11    Jericho's ascent gate
    for (let r = 0; r <= 5; r++) add(r, 8);          // 12-17 Jericho's lane
    for (let c = 9; c <= 13; c++) add(6, c);         // 18-22
    add(6, 14); add(7, 14); add(8, 14);              // 23-25 Beersheba's ascent gate
    for (let c = 13; c >= 9; c--) add(8, c);         // 26-30 Beersheba's lane
    for (let r = 9; r <= 14; r++) add(r, 8);         // 31-36
    add(14, 7);                                      // 37    Joppa's ascent gate
    for (let r = 14; r >= 9; r--) add(r, 6);         // 38-43 Joppa's lane
    for (let c = 5; c >= 1; c--) add(8, c);          // 44-48
    add(8, 0); add(7, 0); add(6, 0);                 // 49-51 Nazareth's ascent gate
    return cells;
}

const ROAD = buildRoad();

// Five private cells per family, running from the road into the temple.
const ASCENT = [
    [1, 2, 3, 4, 5].map((c) => ({ r: 7, c })),
    [1, 2, 3, 4, 5].map((r) => ({ r, c: 7 })),
    [13, 12, 11, 10, 9].map((c) => ({ r: 7, c })),
    [13, 12, 11, 10, 9].map((r) => ({ r, c: 7 })),
];

const TEMPLE_CELL = { r: 7, c: 7 };

// Where waiting pilgrims stand in each 6 x 6 home town.
const TOWN = FAMILIES.map((f) => {
    const x0 = f.town.c * CELL;
    const y0 = f.town.r * CELL;
    return [
        { x: x0 + CELL * 1.7, y: y0 + CELL * 1.7 },
        { x: x0 + CELL * 4.3, y: y0 + CELL * 1.7 },
        { x: x0 + CELL * 1.7, y: y0 + CELL * 4.3 },
        { x: x0 + CELL * 4.3, y: y0 + CELL * 4.3 },
    ];
});

// Where finished pilgrims rest inside the temple courts.
const TEMPLE_SEATS = [
    { x: -1, y: 0 },   // Nazareth comes in from the west
    { x: 0, y: -1 },   // Jericho from the north
    { x: 1, y: 0 },    // Beersheba from the east
    { x: 0, y: 1 },    // Joppa from the south
].map((dir) => {
    const cx = (TEMPLE_CELL.c + 0.5) * CELL + dir.x * CELL * 1.02;
    const cy = (TEMPLE_CELL.r + 0.5) * CELL + dir.y * CELL * 1.02;
    const spread = 9;
    return [
        { x: cx - spread, y: cy - spread },
        { x: cx + spread, y: cy - spread },
        { x: cx - spread, y: cy + spread },
        { x: cx + spread, y: cy + spread },
    ];
});

function cellCentre(r, c) {
    return { x: (c + 0.5) * CELL, y: (r + 0.5) * CELL };
}

// The road index a path value maps to, or -1 off the road.
function roadIndexOf(player, s) {
    if (s < 0 || s > LAST_ROAD) return -1;
    return (START[player] + s) % ROAD_LEN;
}

// The board cell a path value maps to: road, ascent or temple.
function stepTo(player, s) {
    if (s === HOME) return null;
    if (s <= LAST_ROAD) return ROAD[roadIndexOf(player, s)];
    if (s < TEMPLE) return ASCENT[player][s - LAST_ROAD - 1];
    return TEMPLE_CELL;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let pilgrims = [];         // pilgrims[player][0..3] = path value
let current = HUMAN;       // family to act
let phase = 'ready';       // ready | roll | move | over
let die = 0;               // last value rolled, 0 for none
let moves = [];            // legal moves for the current roll
let winner = null;
let sixStreak = 0;
let wins = 0;
let hovered = null;        // { player, index } under the mouse

// Test hooks: forced die values, and how long the computer waits.
let diceQueue = [];
let aiDelay = 450;
let autoPlay = true;
let aiTimer = null;

const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// Opponent pilgrims sent home by a landing on path value `to`.
function capturesFor(player, to) {
    if (to < 0 || to > LAST_ROAD) return [];
    const idx = roadIndexOf(player, to);
    if (SAFE.has(idx)) return [];
    const out = [];
    for (let p = 0; p < 4; p++) {
        if (p === player) continue;
        const hits = [];
        for (let i = 0; i < 4; i++) {
            const s = pilgrims[p][i];
            if (s >= 0 && s <= LAST_ROAD && roadIndexOf(p, s) === idx) hits.push(i);
        }
        if (hits.length === 1) out.push({ player: p, index: hits[0] });
    }
    return out;
}

// Every move the family can make with this roll. Pilgrims standing on the same
// cell would make the same move, so only one of them is offered.
function legalMoves(player, d) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < 4; i++) {
        const from = pilgrims[player][i];
        if (from === TEMPLE) continue;
        let to;
        if (from === HOME) {
            if (d !== 6) continue;
            to = 0;
        } else {
            to = from + d;
            if (to > TEMPLE) continue;   // the temple must be reached exactly
        }
        const key = `${from}>${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ player, index: i, from, to, captures: capturesFor(player, to) });
    }
    return out;
}

function hasWon(player) {
    return pilgrims[player].every((s) => s === TEMPLE);
}

function pilgrimsAt(player, s) {
    return pilgrims[player].filter((v) => v === s).length;
}

// Could an opponent reach this road cell with one roll?
function threatened(player, s) {
    const idx = roadIndexOf(player, s);
    if (idx < 0 || SAFE.has(idx)) return false;
    if (pilgrimsAt(player, s) > 1) return false;
    for (let p = 0; p < 4; p++) {
        if (p === player) continue;
        for (let i = 0; i < 4; i++) {
            const o = pilgrims[p][i];
            if (o < 0 || o > LAST_ROAD) continue;
            const gap = (idx - roadIndexOf(p, o) + ROAD_LEN) % ROAD_LEN;
            if (gap >= 1 && gap <= 6) return true;
        }
    }
    return false;
}

// A readable heuristic: finish, capture, flee, set out, then plain progress.
function bestMove(player, list) {
    if (!list || !list.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const m of list) {
        let score = m.to * 0.6;
        if (m.to === TEMPLE) score += 1000;
        score += m.captures.length * 700;
        if (m.from === HOME) score += 300;
        if (m.to > LAST_ROAD) score += 140;
        else {
            if (SAFE.has(roadIndexOf(player, m.to))) score += 90;
            if (threatened(player, m.to)) score -= 110;
            if (m.from >= 0 && threatened(player, m.from)) score += 80;
        }
        if (score > bestScore) {
            bestScore = score;
            best = m;
        }
    }
    return best;
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------
function startGame() {
    clearTimeout(aiTimer);
    aiTimer = null;
    pilgrims = [0, 1, 2, 3].map(() => [HOME, HOME, HOME, HOME]);
    current = HUMAN;
    phase = 'roll';
    die = 0;
    moves = [];
    winner = null;
    sixStreak = 0;
    hovered = null;
    hideOverlay();
    setStatus('Your family sets out from Nazareth — press Space to roll.');
    draw();
}

function rollDie() {
    if (phase !== 'roll') return 0;
    die = diceQueue.length ? diceQueue.shift() : 1 + Math.floor(Math.random() * 6);
    sixStreak = die === 6 ? sixStreak + 1 : 0;
    const name = FAMILIES[current].name;

    if (sixStreak >= 3) {
        moves = [];
        setStatus(`Three sixes in a row — ${name} waits, and the turn passes on.`);
        endTurn();
        return die;
    }

    moves = legalMoves(current, die);
    if (!moves.length) {
        setStatus(`No move for ${name} with a ${die} — the turn passes on.`);
        endTurn();
        return die;
    }

    phase = 'move';
    setStatus(current === HUMAN
        ? `You rolled a ${die} — choose the pilgrim to send on.`
        : `${name} rolled a ${die}.`);
    draw();
    scheduleAI();
    return die;
}

function applyMove(move) {
    if (phase !== 'move' || !move) return false;
    const player = move.player !== undefined ? move.player : current;
    if (player !== current) return false;

    const captures = capturesFor(player, move.to);
    pilgrims[player][move.index] = move.to;
    captures.forEach((c) => { pilgrims[c.player][c.index] = HOME; });

    const name = FAMILIES[player].name;
    let message;
    if (captures.length) {
        const sent = captures.map((c) => FAMILIES[c.player].name).join(' and ');
        message = `${name} lands on ${sent} — that pilgrim goes back home.`;
    } else if (move.to === TEMPLE) {
        message = `${name} brings a pilgrim into the temple courts.`;
    } else if (move.from === HOME) {
        message = `${name} sets out on the pilgrim road.`;
    } else if (move.to > LAST_ROAD) {
        message = `${name} begins the ascent to the temple.`;
    } else {
        message = `${name} walks on ${die}.`;
    }

    moves = [];

    if (hasWon(player)) {
        finish(player);
        return true;
    }

    if (die === 6 || captures.length) {
        phase = 'roll';
        setStatus(`${message} ${player === HUMAN ? 'Roll again.' : 'They roll again.'}`);
        draw();
        scheduleAI();
        return true;
    }

    setStatus(message);
    endTurn();
    return true;
}

function endTurn() {
    sixStreak = 0;
    moves = [];
    die = 0;
    current = (current + 1) % 4;
    phase = 'roll';
    draw();
    scheduleAI();
}

function finish(player) {
    phase = 'over';
    winner = player;
    moves = [];
    clearTimeout(aiTimer);
    aiTimer = null;
    if (player === HUMAN) {
        wins += 1;
        try {
            localStorage.setItem(STORE_KEY, String(wins));
        } catch (e) { /* storage may be unavailable */ }
        showOverlay('Up to Jerusalem!',
            'All four of your pilgrims are in the temple courts. Press <strong>N</strong> for another journey.');
        setStatus('Your family keeps the feast in Jerusalem!');
    } else {
        const name = FAMILIES[player].name;
        showOverlay(`${name} keeps the feast`,
            `${name} gathered all four pilgrims first. Press <strong>N</strong> to travel again.`);
        setStatus(`${name} reached Jerusalem first.`);
    }
    draw();
}

function scheduleAI() {
    clearTimeout(aiTimer);
    aiTimer = null;
    if (!autoPlay || phase === 'over' || phase === 'ready' || current === HUMAN) return;
    aiTimer = setTimeout(aiStep, aiDelay);
}

function aiStep() {
    aiTimer = null;
    if (phase === 'over' || phase === 'ready' || current === HUMAN) return;
    if (phase === 'roll') rollDie();
    else if (phase === 'move') applyMove(bestMove(current, moves));
}

// ---------------------------------------------------------------------------
// Player input
// ---------------------------------------------------------------------------
function humanRoll() {
    if (phase !== 'roll' || current !== HUMAN) return;
    rollDie();
}

function chooseByIndex(index) {
    if (phase !== 'move' || current !== HUMAN) return;
    const move = moves.find((m) => m.index === index);
    if (move) applyMove(move);
}

function chooseFirst() {
    if (phase !== 'move' || current !== HUMAN) return;
    if (moves.length) applyMove(moves[0]);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

// Pilgrims sharing a cell — from one family or from several — are nudged
// apart so each one can be seen and clicked.
function stackOffset(player, index) {
    const s = pilgrims[player][index];
    if (s === HOME || s === TEMPLE) return { dx: 0, dy: 0 };
    const here = stepTo(player, s);
    const mates = [];
    for (let p = 0; p < 4; p++) {
        for (let i = 0; i < 4; i++) {
            const v = pilgrims[p][i];
            if (v === HOME || v === TEMPLE) continue;
            const cell = stepTo(p, v);
            if (cell.r === here.r && cell.c === here.c) mates.push(`${p}:${i}`);
        }
    }
    if (mates.length < 2) return { dx: 0, dy: 0 };
    const slot = mates.indexOf(`${player}:${index}`);
    const spread = 8;
    return {
        dx: (slot - (mates.length - 1) / 2) * spread,
        dy: slot % 2 ? spread * 0.55 : -spread * 0.55,
    };
}

function pilgrimPoint(player, index) {
    const s = pilgrims[player][index];
    if (s === HOME) {
        const slot = pilgrims[player].slice(0, index).filter((v) => v === HOME).length;
        return TOWN[player][Math.min(slot, 3)];
    }
    if (s === TEMPLE) {
        const slot = pilgrims[player].slice(0, index).filter((v) => v === TEMPLE).length;
        return TEMPLE_SEATS[player][Math.min(slot, 3)];
    }
    const cell = stepTo(player, s);
    const p = cellCentre(cell.r, cell.c);
    const off = stackOffset(player, index);
    return { x: p.x + off.dx, y: p.y + off.dy };
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

function drawCell(r, c, fill, stroke) {
    const x = c * CELL;
    const y = r * CELL;
    ctx.fillStyle = fill;
    roundRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3, 5);
    ctx.fill();
    ctx.strokeStyle = stroke || 'rgba(60, 46, 28, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawWell(r, c) {
    const { x, y } = cellCentre(r, c);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#8fc4ee';
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f6ea8';
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
        const a = (Math.PI / 8) * i - Math.PI / 2;
        const rad = i % 2 ? 4.5 : 11;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawArrow(r, c, player) {
    const { x, y } = cellCentre(r, c);
    const toTemple = { x: (TEMPLE_CELL.c + 0.5) * CELL - x, y: (TEMPLE_CELL.r + 0.5) * CELL - y };
    const angle = Math.atan2(toTemple.y, toTemple.x);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = FAMILIES[player].deep;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -7);
    ctx.lineTo(-5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawTown(player) {
    const f = FAMILIES[player];
    const x = f.town.c * CELL;
    const y = f.town.r * CELL;
    const size = CELL * 6;
    if (player === current && phase !== 'ready' && phase !== 'over') {
        ctx.save();
        ctx.shadowColor = '#f7e3a1';
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#f7e3a1';
        roundRect(x + 1, y + 1, size - 2, size - 2, 17);
        ctx.fill();
        ctx.restore();
    }
    ctx.fillStyle = f.color;
    roundRect(x + 3, y + 3, size - 6, size - 6, 16);
    ctx.fill();
    ctx.fillStyle = 'rgba(253, 246, 227, 0.92)';
    roundRect(x + CELL * 0.75, y + CELL * 0.75, size - CELL * 1.5, size - CELL * 1.5, 12);
    ctx.fill();

    // Waiting places.
    ctx.strokeStyle = f.deep;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    TOWN[player].forEach((spot) => {
        ctx.beginPath();
        ctx.arc(spot.x, spot.y, 15, 0, Math.PI * 2);
        ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Town name along the outer edge of the block.
    ctx.fillStyle = '#fdf6e3';
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const atTop = f.town.r === 0;
    ctx.fillText(f.name.toUpperCase(), x + size / 2, atTop ? y + CELL * 0.4 : y + size - CELL * 0.4);
}

function drawTemple() {
    const x = 6 * CELL;
    const y = 6 * CELL;
    const size = CELL * 3;
    const cx = x + size / 2;
    const cy = y + size / 2;

    // Four approaches, one per family, as coloured triangles.
    const corners = [
        [{ x, y }, { x, y: y + size }],                        // west — Nazareth
        [{ x, y }, { x: x + size, y }],                        // north — Jericho
        [{ x: x + size, y }, { x: x + size, y: y + size }],    // east — Beersheba
        [{ x: x + size, y: y + size }, { x, y: y + size }],    // south — Joppa
    ];
    corners.forEach((pair, p) => {
        ctx.fillStyle = FAMILIES[p].color;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(pair[0].x, pair[0].y);
        ctx.lineTo(pair[1].x, pair[1].y);
        ctx.closePath();
        ctx.fill();
    });

    // The temple itself.
    ctx.fillStyle = '#f7e3a1';
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b4892c';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#8a6514';
    ctx.beginPath();                        // roof
    ctx.moveTo(cx, cy - 23);
    ctx.lineTo(cx + 24, cy - 8);
    ctx.lineTo(cx - 24, cy - 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - 21, cy - 6, 42, 4);   // lintel
    for (let i = -2; i <= 2; i++) {         // pillars
        ctx.fillRect(cx + i * 9 - 2.5, cy - 2, 5, 18);
    }
    ctx.fillRect(cx - 24, cy + 16, 48, 5);  // steps
}

function drawPilgrim(player, index, x, y, radius) {
    const f = FAMILIES[player];
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = 'rgba(20, 16, 32, 0.28)';
    ctx.beginPath();
    ctx.ellipse(1.5, radius * 0.55, radius * 0.85, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = f.deep;
    ctx.lineWidth = 2;
    ctx.stroke();

    // A hooded traveller: pale face under a cloak.
    ctx.fillStyle = f.pale;
    ctx.beginPath();
    ctx.arc(0, -radius * 0.2, radius * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = f.deep;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, radius * 0.25, radius * 0.62, Math.PI * 1.15, Math.PI * 1.85, true);
    ctx.stroke();

    if (player === HUMAN) {
        ctx.fillStyle = f.deep;
        ctx.font = '700 9px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(index + 1), 0, radius * 0.72);
    }
    ctx.restore();
}

function draw() {
    // Board ground.
    ctx.fillStyle = '#2a2138';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let p = 0; p < 4; p++) drawTown(p);

    // The shared road.
    ROAD.forEach((cell, idx) => {
        const owner = START.indexOf(idx);
        const well = WELLS.indexOf(idx);
        let fill = '#fdf6e3';
        if (owner >= 0) fill = FAMILIES[owner].pale;
        drawCell(cell.r, cell.c, fill);
        if (owner >= 0) drawArrow(cell.r, cell.c, owner);
        if (well >= 0) drawWell(cell.r, cell.c);
    });

    // The four ascents.
    for (let p = 0; p < 4; p++) {
        ASCENT[p].forEach((cell, i) => {
            drawCell(cell.r, cell.c, FAMILIES[p].color, FAMILIES[p].deep);
            if (i === 4) return;
            ctx.save();
            ctx.globalAlpha = 0.4;
            drawArrow(cell.r, cell.c, p);
            ctx.restore();
        });
    }

    drawTemple();

    // Highlights for the moves on offer.
    if (phase === 'move' && current === HUMAN) {
        moves.forEach((m) => {
            const from = pilgrimPoint(HUMAN, m.index);
            ctx.save();
            ctx.strokeStyle = '#f7e3a1';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(from.x, from.y, 17, 0, Math.PI * 2);
            ctx.stroke();

            const cell = stepTo(HUMAN, m.to);
            const dest = m.to === TEMPLE
                ? TEMPLE_SEATS[HUMAN][0]
                : cellCentre(cell.r, cell.c);
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = m.captures.length ? '#ff9ea9' : '#f7e3a1';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(dest.x, dest.y, 13, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        });
    }

    // Pilgrims.
    for (let p = 0; p < 4; p++) {
        for (let i = 0; i < 4; i++) {
            const point = pilgrimPoint(p, i);
            const isHover = hovered && hovered.player === p && hovered.index === i;
            drawPilgrim(p, i, point.x, point.y, isHover ? 15 : 13);
        }
    }

    updateHud();
}

function updateHud() {
    el('turn').textContent = FAMILIES[current].name;
    el('die').textContent = die ? String(die) : '–';
    el('wins').textContent = String(wins);
    el('btn-roll').disabled = !(phase === 'roll' && current === HUMAN);

    document.querySelectorAll('#families .family').forEach((node) => {
        const p = Number(node.dataset.player);
        node.classList.toggle('active', p === current && phase !== 'ready' && phase !== 'over');
        node.querySelector('.fhome').textContent = String(pilgrimsAt(p, HOME));
        node.querySelector('.ftemple').textContent = String(pilgrimsAt(p, TEMPLE));
    });
}

function setStatus(text) {
    el('status').textContent = text;
}

function showOverlay(title, subHtml) {
    el('overlay-title').textContent = title;
    el('overlay-sub').innerHTML = subHtml;
    el('btn-start').textContent = 'Travel again';
    el('overlay').classList.add('visible');
}

function hideOverlay() {
    el('overlay').classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((event.clientX - rect.left) / rect.width) * canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
}

function pilgrimUnder(point, player) {
    let found = null;
    let bestDist = 20;
    for (let i = 0; i < 4; i++) {
        const p = pilgrimPoint(player, i);
        const d = Math.hypot(p.x - point.x, p.y - point.y);
        if (d < bestDist) {
            bestDist = d;
            found = { player, index: i };
        }
    }
    return found;
}

canvas.addEventListener('click', (event) => {
    if (phase === 'ready') {
        startGame();
        return;
    }
    if (phase !== 'move' || current !== HUMAN) return;
    const hit = pilgrimUnder(canvasPoint(event), HUMAN);
    if (hit) chooseByIndex(hit.index);
});

canvas.addEventListener('mousemove', (event) => {
    if (phase !== 'move' || current !== HUMAN) {
        if (hovered) {
            hovered = null;
            draw();
        }
        return;
    }
    const hit = pilgrimUnder(canvasPoint(event), HUMAN);
    const movable = hit && moves.some((m) => m.index === hit.index) ? hit : null;
    const changed = (movable && movable.index) !== (hovered && hovered.index);
    hovered = movable;
    canvas.style.cursor = movable ? 'pointer' : 'default';
    if (changed) draw();
});

canvas.addEventListener('mouseleave', () => {
    if (hovered) {
        hovered = null;
        draw();
    }
});

document.addEventListener('keydown', (event) => {
    const key = event.key;
    if (key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        if (phase === 'ready') startGame();
        else if (phase === 'roll') humanRoll();
        return;
    }
    if (key === 'Enter') {
        event.preventDefault();
        if (phase === 'ready') startGame();
        else if (phase === 'roll') humanRoll();
        else if (phase === 'move') chooseFirst();
        return;
    }
    if (key >= '1' && key <= '4') {
        chooseByIndex(Number(key) - 1);
        return;
    }
    if (key.toLowerCase() === 'n') startGame();
});

el('btn-start').addEventListener('click', startGame);
el('btn-new').addEventListener('click', startGame);
el('btn-roll').addEventListener('click', humanRoll);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
try {
    wins = parseInt(localStorage.getItem(STORE_KEY), 10) || 0;
} catch (e) {
    wins = 0;
}
pilgrims = [0, 1, 2, 3].map(() => [HOME, HOME, HOME, HOME]);
draw();
