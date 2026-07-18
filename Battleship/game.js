// ---------------------------------------------------------------------------
// Battleship — place a fleet, then trade single shots with a CPU that hunts on
// a checkerboard parity and switches to finishing a ship the moment it lands a
// hit. Every rule (placement validity, hit/miss/sunk, fleet defeat, CPU target
// choice) is a pure function of the board state — no wall-clock time, and the
// only randomness is fleet placement — so tests drive it all deterministically.
// ---------------------------------------------------------------------------

const BOARD = 10;
const CELL = 30;
const BOARD_PX = BOARD * CELL;         // 300
const LX = 20;                         // enemy board origin x
const RX = LX + BOARD_PX + 40;         // your board origin x  (= 360)
const BY = 44;                         // both boards' origin y
const W = RX + BOARD_PX + 20;          // 660
const H = BY + BOARD_PX + 16;          // 360

const SHIP_DEFS = [
    { name: 'Carrier', size: 5 },
    { name: 'Battleship', size: 4 },
    { name: 'Cruiser', size: 3 },
    { name: 'Submarine', size: 3 },
    { name: 'Destroyer', size: 2 },
];

// DOM -----------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const enemyShipsEl = document.getElementById('enemy-ships');
const yourShipsEl = document.getElementById('your-ships');
const shotsEl = document.getElementById('shots');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnRandom = document.getElementById('btn-random');
const hintEl = document.getElementById('hint');

// State ---------------------------------------------------------------------
let enemyBoard, playerBoard;
let state, result, placingIndex, orient, aiQueue, shotsFired, best;
let hover = null;

// ---------------------------------------------------------------------------
// Board model
// ---------------------------------------------------------------------------
function makeBoard() {
    const grid = [];
    const shot = [];
    for (let r = 0; r < BOARD; r++) {
        grid.push(new Array(BOARD).fill(null));
        shot.push(new Array(BOARD).fill(false));
    }
    return { grid, shot, ships: [] };
}

function shipCells(size, r, c, o) {
    const cells = [];
    for (let i = 0; i < size; i++) cells.push(o === 'h' ? { r, c: c + i } : { r: r + i, c });
    return cells;
}

function canPlace(board, size, r, c, o) {
    for (const cell of shipCells(size, r, c, o)) {
        if (cell.r < 0 || cell.r >= BOARD || cell.c < 0 || cell.c >= BOARD) return false;
        if (board.grid[cell.r][cell.c] !== null) return false;
    }
    return true;
}

function placeShip(board, name, size, r, c, o) {
    if (!canPlace(board, size, r, c, o)) return false;
    const cells = shipCells(size, r, c, o);
    const idx = board.ships.length;
    for (const cell of cells) board.grid[cell.r][cell.c] = idx;
    board.ships.push({ name, size, cells, hits: 0 });
    return true;
}

function autoPlace(board) {
    for (const def of SHIP_DEFS) {
        let placed = false;
        let guard = 0;
        while (!placed && guard++ < 2000) {
            const o = Math.random() < 0.5 ? 'h' : 'v';
            const r = Math.floor(Math.random() * BOARD);
            const c = Math.floor(Math.random() * BOARD);
            placed = placeShip(board, def.name, def.size, r, c, o);
        }
    }
}

function shipSunk(board, idx) {
    const s = board.ships[idx];
    return s.hits >= s.size;
}

function isFleetSunk(board) {
    return board.ships.length > 0 && board.ships.every((s) => s.hits >= s.size);
}

function shipsRemaining(board) {
    return board.ships.filter((s) => s.hits < s.size).length;
}

// ---------------------------------------------------------------------------
// Firing — the pure resolver.
// ---------------------------------------------------------------------------
function fireAt(board, r, c) {
    if (r < 0 || r >= BOARD || c < 0 || c >= BOARD) return null;
    if (board.shot[r][c]) return null;
    board.shot[r][c] = true;
    const idx = board.grid[r][c];
    if (idx === null) return { result: 'miss', sunk: null };
    const ship = board.ships[idx];
    ship.hits++;
    return { result: 'hit', sunk: ship.hits >= ship.size ? idx : null };
}

// ---------------------------------------------------------------------------
// CPU — deterministic hunt / target.
// ---------------------------------------------------------------------------
function orthogonal(r, c) {
    return [{ r: r - 1, c }, { r: r + 1, c }, { r, c: c - 1 }, { r, c: c + 1 }]
        .filter((t) => t.r >= 0 && t.r < BOARD && t.c >= 0 && t.c < BOARD);
}

function aiChooseTarget() {
    // Target mode: drain queued neighbours of prior hits.
    while (aiQueue.length) {
        const t = aiQueue.shift();
        if (!playerBoard.shot[t.r][t.c]) return t;
    }
    // Hunt mode: first un-shot parity cell, then any un-shot cell.
    for (let r = 0; r < BOARD; r++) {
        for (let c = 0; c < BOARD; c++) {
            if (!playerBoard.shot[r][c] && (r + c) % 2 === 0) return { r, c };
        }
    }
    for (let r = 0; r < BOARD; r++) {
        for (let c = 0; c < BOARD; c++) {
            if (!playerBoard.shot[r][c]) return { r, c };
        }
    }
    return { r: 0, c: 0 };
}

function aiTurn() {
    const t = aiChooseTarget();
    const res = fireAt(playerBoard, t.r, t.c);
    if (res && res.result === 'hit' && res.sunk === null) {
        for (const n of orthogonal(t.r, t.c)) {
            if (!playerBoard.shot[n.r][n.c]) aiQueue.push(n);
        }
    }
    if (isFleetSunk(playerBoard)) endGame('lose');
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------
function playerFire(r, c) {
    if (state !== 'playing') return null;
    const res = fireAt(enemyBoard, r, c);
    if (!res) return null;
    shotsFired++;
    updateHud();
    if (isFleetSunk(enemyBoard)) { endGame('win'); return res; }
    aiTurn();
    updateHud();
    draw();
    return res;
}

// ---------------------------------------------------------------------------
// Placement flow
// ---------------------------------------------------------------------------
function placeCurrent(r, c) {
    if (state !== 'placing' || placingIndex >= SHIP_DEFS.length) return false;
    const def = SHIP_DEFS[placingIndex];
    if (!placeShip(playerBoard, def.name, def.size, r, c, orient)) return false;
    placingIndex++;
    updateHint();
    if (placingIndex >= SHIP_DEFS.length) beginBattle();
    else draw();
    return true;
}

function randomizePlayer() {
    if (state !== 'placing') return;
    playerBoard = makeBoard();
    autoPlace(playerBoard);
    placingIndex = SHIP_DEFS.length;
    beginBattle();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function startPlacement() {
    enemyBoard = makeBoard();
    autoPlace(enemyBoard);
    playerBoard = makeBoard();
    placingIndex = 0;
    orient = 'h';
    shotsFired = 0;
    aiQueue = [];
    result = null;
    state = 'placing';
    overlay.classList.remove('visible');
    updateHud();
    updateHint();
    draw();
}

function beginBattle() {
    state = 'playing';
    aiQueue = [];
    overlay.classList.remove('visible');
    updateHud();
    updateHint();
    draw();
}

function endGame(res) {
    result = res;
    state = 'over';
    if (res === 'win' && (best === 0 || shotsFired < best)) {
        best = shotsFired;
        try { localStorage.setItem('battleship-best', best); } catch (e) { /* ignore */ }
    }
    overlayTitle.textContent = res === 'win' ? 'You Win!' : 'Game Over';
    overlaySub.textContent = res === 'win'
        ? `Enemy fleet sunk in ${shotsFired} shots · press Space to play again`
        : 'Your fleet was destroyed · press Space to try again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    updateHud();
    draw();
}

function updateHud() {
    enemyShipsEl.textContent = enemyBoard ? shipsRemaining(enemyBoard) : SHIP_DEFS.length;
    yourShipsEl.textContent = playerBoard ? shipsRemaining(playerBoard) : SHIP_DEFS.length;
    shotsEl.textContent = shotsFired;
    bestEl.textContent = best > 0 ? best : '—';
}

function updateHint() {
    if (state === 'placing' && placingIndex < SHIP_DEFS.length) {
        const def = SHIP_DEFS[placingIndex];
        hintEl.textContent = `Place your ${def.name} (${def.size}) — click your grid · R to rotate (${orient === 'h' ? 'horizontal' : 'vertical'})`;
    } else if (state === 'playing') {
        hintEl.textContent = 'Click enemy waters to fire';
    } else {
        hintEl.textContent = '';
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawLabel(text, ox) {
    ctx.fillStyle = '#9fb3c8';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, ox, BY - 12);
}

function drawBoard(board, ox, revealShips) {
    for (let r = 0; r < BOARD; r++) {
        for (let c = 0; c < BOARD; c++) {
            const x = ox + c * CELL;
            const y = BY + r * CELL;
            ctx.fillStyle = '#0b2036';
            ctx.fillRect(x, y, CELL, CELL);
            ctx.strokeStyle = '#173650';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, CELL, CELL);

            const idx = board ? board.grid[r][c] : null;
            const hasShip = idx !== null;
            const show = hasShip && (revealShips || shipSunk(board, idx));
            if (show) {
                ctx.fillStyle = shipSunk(board, idx) ? '#3f2130' : '#475569';
                ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
            }
            if (board && board.shot[r][c]) {
                if (hasShip) {
                    ctx.fillStyle = '#ef4444';
                    ctx.beginPath();
                    ctx.arc(x + CELL / 2, y + CELL / 2, 7, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.fillStyle = '#cbd5e1';
                    ctx.beginPath();
                    ctx.arc(x + CELL / 2, y + CELL / 2, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }
}

function drawPreview() {
    if (state !== 'placing' || !hover || hover.board !== 'player' || placingIndex >= SHIP_DEFS.length) return;
    const def = SHIP_DEFS[placingIndex];
    const ok = canPlace(playerBoard, def.size, hover.r, hover.c, orient);
    ctx.fillStyle = ok ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)';
    for (const cell of shipCells(def.size, hover.r, hover.c, orient)) {
        if (cell.r < 0 || cell.r >= BOARD || cell.c < 0 || cell.c >= BOARD) continue;
        ctx.fillRect(RX + cell.c * CELL + 2, BY + cell.r * CELL + 2, CELL - 4, CELL - 4);
    }
}

function draw() {
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, W, H);

    drawLabel('ENEMY WATERS', LX);
    drawLabel('YOUR FLEET', RX);

    // Enemy board: never reveal un-sunk ships. Hidden entirely until battle.
    drawBoard(state === 'idle' ? null : enemyBoard, LX, false);
    // Your board: ships always visible to you.
    drawBoard(state === 'idle' ? null : playerBoard, RX, true);

    drawPreview();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function pixelToCell(px, py) {
    if (py < BY || py >= BY + BOARD_PX) return null;
    const r = Math.floor((py - BY) / CELL);
    if (px >= LX && px < LX + BOARD_PX) return { board: 'enemy', r, c: Math.floor((px - LX) / CELL) };
    if (px >= RX && px < RX + BOARD_PX) return { board: 'player', r, c: Math.floor((px - RX) / CELL) };
    return null;
}

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    hover = pixelToCell((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
    if (state === 'placing') draw();
});

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cell = pixelToCell((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
    if (!cell) return;
    if (state === 'placing' && cell.board === 'player') placeCurrent(cell.r, cell.c);
    else if (state === 'playing' && cell.board === 'enemy') playerFire(cell.r, cell.c);
});

document.addEventListener('keydown', (e) => {
    const k = e.key;
    if ((k === 'r' || k === 'R') && state === 'placing') {
        orient = orient === 'h' ? 'v' : 'h';
        updateHint();
        draw();
        return;
    }
    if ((state === 'idle' || state === 'over') && (k === ' ' || k === 'Spacebar' || k === 'Enter')) {
        startPlacement();
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'idle' || state === 'over') startPlacement();
});

btnRandom.addEventListener('click', () => {
    randomizePlayer();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
best = parseInt(localStorage.getItem('battleship-best') || '0', 10);
enemyBoard = makeBoard();
playerBoard = makeBoard();
shotsFired = 0;
placingIndex = 0;
orient = 'h';
aiQueue = [];
result = null;
state = 'idle';
updateHud();
updateHint();
draw();
