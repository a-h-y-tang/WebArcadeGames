// =======================================================================
// Ultimate Tic-Tac-Toe
//
// A 3x3 grid of 3x3 boards. X (player 1, human) vs O (player 2, computer).
// Win three mini-boards in a row to win. The cell you play sends your
// opponent to the matching mini-board (the forced-board rule).
//
// State and pure-logic helpers are top-level globals so the Playwright
// suite can drive them directly via page.evaluate.
// =======================================================================

// --- Geometry ---
const SIZE = 540;      // canvas is SIZE x SIZE
const MINI = 180;      // a mini-board is MINI px square
const CELL = 60;       // a cell is CELL px square

const X = 1;
const O = 2;
const DRAW = 3;        // macro value: a full mini-board with no winner

const STORAGE_KEY = 'uttt-score';

// The eight winning lines (indices into a 9-array), shared by mini and macro.
const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],   // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8],   // cols
    [0, 4, 8], [2, 4, 6],              // diagonals
];

// Positional weight of a square: corners 3, edges 1, centre 4.
const POS = [3, 1, 3, 1, 4, 1, 3, 1, 3];

const COLORS = {
    boardBg: '#131a28',
    miniBg: '#1a2232',
    miniActive: '#243350',
    miniDecided: '#0e1420',
    thin: '#2c3648',
    thickLine: '#55617e',
    x: '#4aa3ff',
    o: '#ff6b6b',
    xFaint: 'rgba(74,163,255,0.16)',
    oFaint: 'rgba(255,107,107,0.16)',
    win: '#f5c518',
};

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const statusEl = document.getElementById('status');
const xWinsEl = document.getElementById('x-wins');
const oWinsEl = document.getElementById('o-wins');
const drawsEl = document.getElementById('draws');
const btnNew = document.getElementById('btn-new');

// --- State (var so tests can read/assign them as globals) ---
var boards, macro, currentPlayer, activeBoard, state, winner, winLine, scores;
var aiThinking;
var aiTimer = null;

// -----------------------------------------------------------------------
// Board construction
// -----------------------------------------------------------------------
function emptyBoards() {
    const b = [];
    for (let i = 0; i < 9; i++) b.push(new Array(9).fill(0));
    return b;
}

// -----------------------------------------------------------------------
// Line / mini-board logic
// -----------------------------------------------------------------------

// Return 1 or 2 if a 9-cell array has three of that mark in a line, else 0.
// (Only values 1 and 2 count as winners; 0 is empty.)
function lineWinner(arr) {
    for (const [a, b, c] of LINES) {
        const v = arr[a];
        if ((v === 1 || v === 2) && arr[b] === v && arr[c] === v) return v;
    }
    return 0;
}

function miniWinner(b) {
    return lineWinner(boards[b]);
}

function isMiniFull(b) {
    return boards[b].every(c => c !== 0);
}

// Recompute the macro status of mini-board b: winner (1/2), draw (3), or 0.
function updateMacro(b) {
    const w = miniWinner(b);
    macro[b] = w ? w : (isMiniFull(b) ? DRAW : 0);
}

// The three macro indices forming a completed line, or null.
function macroWinningLine() {
    for (const line of LINES) {
        const v = macro[line[0]];
        if ((v === 1 || v === 2) && macro[line[1]] === v && macro[line[2]] === v) return line;
    }
    return null;
}

function macroWinner() {
    const line = macroWinningLine();
    return line ? macro[line[0]] : 0;
}

function isMacroFull() {
    return macro.every(m => m !== 0);
}

// -----------------------------------------------------------------------
// Legality
// -----------------------------------------------------------------------
function isLegal(b, c) {
    if (state !== 'playing') return false;
    if (b < 0 || b > 8 || c < 0 || c > 8) return false;
    if (macro[b] !== 0) return false;          // decided mini-board
    if (boards[b][c] !== 0) return false;      // occupied cell
    if (activeBoard !== -1 && b !== activeBoard) return false;
    return true;
}

function legalMoves() {
    const out = [];
    for (let b = 0; b < 9; b++)
        for (let c = 0; c < 9; c++)
            if (isLegal(b, c)) out.push([b, c]);
    return out;
}

// -----------------------------------------------------------------------
// Applying a move
// -----------------------------------------------------------------------
function applyMove(b, c, player) {
    if (!isLegal(b, c)) return false;
    boards[b][c] = player;
    updateMacro(b);

    const line = macroWinningLine();
    if (line) {
        winLine = line;
        winner = macro[line[0]];
        state = 'won';
        recordResult(winner);
    } else if (isMacroFull()) {
        state = 'draw';
        winner = 0;
        recordResult(0);
    } else {
        currentPlayer = player === X ? O : X;
        // The cell index c dictates the opponent's next board.
        activeBoard = (macro[c] === 0) ? c : -1;
    }
    updateStatus();
    render();
    return true;
}

// -----------------------------------------------------------------------
// Game flow
// -----------------------------------------------------------------------
function humanMove(b, c) {
    if (state !== 'playing') return;
    if (currentPlayer !== X) return;
    if (!isLegal(b, c)) return;
    applyMove(b, c, X);
    if (state === 'playing' && currentPlayer === O) scheduleAi();
}

function aiMove() {
    if (state !== 'playing') return;
    if (currentPlayer !== O) return;
    aiThinking = false;
    const mv = chooseAiMove();
    if (!mv) return;
    applyMove(mv[0], mv[1], O);
}

function scheduleAi() {
    aiThinking = true;
    updateStatus();
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = setTimeout(() => { aiTimer = null; aiMove(); }, 300);
}

function newGame() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    boards = emptyBoards();
    macro = new Array(9).fill(0);
    currentPlayer = X;
    activeBoard = -1;
    state = 'playing';
    winner = 0;
    winLine = null;
    aiThinking = false;
    updateStatus();
    render();
}

// -----------------------------------------------------------------------
// AI (deterministic)
// -----------------------------------------------------------------------

// Would placing `player` at (b, c) immediately win the whole game?
function winsGame(b, c, player) {
    if (macro[b] !== 0 || boards[b][c] !== 0) return false;
    const prevCell = boards[b][c];
    const prevMacro = macro[b];
    boards[b][c] = player;
    const w = miniWinner(b);
    macro[b] = w ? w : (isMiniFull(b) ? DRAW : 0);
    const gw = macroWinner();
    boards[b][c] = prevCell;
    macro[b] = prevMacro;
    return gw === player;
}

// All empty cells reachable given an `active` constraint (-1 = any board).
function movesForActive(active) {
    const out = [];
    for (let b = 0; b < 9; b++) {
        if (macro[b] !== 0) continue;
        if (active !== -1 && b !== active) continue;
        for (let c = 0; c < 9; c++) if (boards[b][c] === 0) out.push([b, c]);
    }
    return out;
}

function canWinGame(player, active) {
    for (const [b, c] of movesForActive(active)) if (winsGame(b, c, player)) return true;
    return false;
}

function canWinAnyMini(player, active) {
    for (const [b, c] of movesForActive(active)) {
        const prev = boards[b][c];
        boards[b][c] = player;
        const w = miniWinner(b);
        boards[b][c] = prev;
        if (w === player) return true;
    }
    return false;
}

// How many macro lines does `player` have two-of with the third still open?
function macroThreats(player) {
    let n = 0;
    for (const [a, b, c] of LINES) {
        const vals = [macro[a], macro[b], macro[c]];
        const mine = vals.filter(v => v === player).length;
        const blocked = vals.some(v => v !== 0 && v !== player);
        if (mine === 2 && !blocked) n++;
    }
    return n;
}

// Heuristic value of `me` playing (b, c). Simulates the move, then restores.
function scoreMove(b, c, me, opp) {
    let score = 0;
    const prevCell = boards[b][c];
    const prevMacro = macro[b];
    boards[b][c] = me;
    const w = miniWinner(b);
    macro[b] = w ? w : (isMiniFull(b) ? DRAW : 0);

    if (w === me) {
        score += 25 + POS[b];
        score += 10 * macroThreats(me);
    }

    // Where does this send the opponent?
    const target = c;
    const oppActive = (macro[target] === 0) ? target : -1;
    if (canWinGame(opp, oppActive)) score -= 1000;      // never hand over a win
    else if (canWinAnyMini(opp, oppActive)) score -= 12;
    if (oppActive === -1) score -= 3;                   // free choice is a small gift

    score += POS[c] * 0.5;   // prefer strong cells
    score += POS[b] * 0.3;   // prefer strong boards

    boards[b][c] = prevCell;
    macro[b] = prevMacro;
    return score;
}

// Choose O's move: take an immediate win, else the best-scoring legal move.
// Deterministic: fixed scan order breaks ties.
function chooseAiMove() {
    const me = O, opp = X;
    const moves = legalMoves();
    if (moves.length === 0) return null;

    for (const [b, c] of moves) if (winsGame(b, c, me)) return [b, c];

    let best = null;
    let bestScore = -Infinity;
    for (const [b, c] of moves) {
        const s = scoreMove(b, c, me, opp);
        if (s > bestScore) { bestScore = s; best = [b, c]; }
    }
    return best;
}

// -----------------------------------------------------------------------
// Score / persistence
// -----------------------------------------------------------------------
function recordResult(who) {
    if (who === X) scores.x++;
    else if (who === O) scores.o++;
    else scores.draws++;
    saveScores();
    renderScores();
}

function loadScores() {
    let s = { x: 0, o: 0, draws: 0 };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const p = JSON.parse(raw);
            s = { x: p.x | 0, o: p.o | 0, draws: p.draws | 0 };
        }
    } catch (e) { /* ignore */ }
    scores = s;
}

function saveScores() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scores)); } catch (e) { /* ignore */ }
}

function renderScores() {
    if (xWinsEl) xWinsEl.textContent = String(scores.x);
    if (oWinsEl) oWinsEl.textContent = String(scores.o);
    if (drawsEl) drawsEl.textContent = String(scores.draws);
}

// -----------------------------------------------------------------------
// Status line
// -----------------------------------------------------------------------
function updateStatus() {
    if (!statusEl) return;
    if (state === 'won') {
        statusEl.textContent = winner === X ? 'X wins the game!' : 'O wins the game!';
    } else if (state === 'draw') {
        statusEl.textContent = "It's a draw.";
    } else if (aiThinking) {
        statusEl.textContent = 'O is thinking…';
    } else {
        const who = currentPlayer === X ? 'X' : 'O';
        const where = activeBoard === -1 ? ' — play anywhere' : ' — highlighted board';
        statusEl.textContent = who + ' to move' + where;
    }
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
function cellRect(b, c) {
    const x = (b % 3) * MINI + (c % 3) * CELL;
    const y = Math.floor(b / 3) * MINI + Math.floor(c / 3) * CELL;
    return { x, y };
}

function isPlayable(b) {
    return state === 'playing' && macro[b] === 0 &&
        (activeBoard === -1 || activeBoard === b);
}

function drawMark(cx, cy, r, player, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.lineWidth = Math.max(2, r * 0.22);
    ctx.lineCap = 'round';
    if (player === X) {
        ctx.strokeStyle = COLORS.x;
        ctx.beginPath();
        ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
        ctx.stroke();
    } else {
        ctx.strokeStyle = COLORS.o;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();
}

function render() {
    if (!ctx) return;
    ctx.fillStyle = COLORS.boardBg;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // mini-board backgrounds
    for (let b = 0; b < 9; b++) {
        const bx = (b % 3) * MINI;
        const by = Math.floor(b / 3) * MINI;
        let bg = COLORS.miniBg;
        if (macro[b] !== 0) bg = COLORS.miniDecided;
        else if (isPlayable(b)) bg = COLORS.miniActive;
        ctx.fillStyle = bg;
        ctx.fillRect(bx + 2, by + 2, MINI - 4, MINI - 4);
    }

    // thin cell grid lines
    ctx.strokeStyle = COLORS.thin;
    ctx.lineWidth = 1;
    for (let b = 0; b < 9; b++) {
        const bx = (b % 3) * MINI;
        const by = Math.floor(b / 3) * MINI;
        ctx.beginPath();
        for (let i = 1; i < 3; i++) {
            ctx.moveTo(bx + i * CELL, by + 8);
            ctx.lineTo(bx + i * CELL, by + MINI - 8);
            ctx.moveTo(bx + 8, by + i * CELL);
            ctx.lineTo(bx + MINI - 8, by + i * CELL);
        }
        ctx.stroke();
    }

    // marks in each cell
    for (let b = 0; b < 9; b++) {
        for (let c = 0; c < 9; c++) {
            const v = boards[b][c];
            if (!v) continue;
            const { x, y } = cellRect(b, c);
            drawMark(x + CELL / 2, y + CELL / 2, CELL * 0.3, v, macro[b] !== 0 ? 0.35 : 1);
        }
    }

    // decided mini-boards: big symbol
    for (let b = 0; b < 9; b++) {
        if (macro[b] === 0) continue;
        const bx = (b % 3) * MINI + MINI / 2;
        const by = Math.floor(b / 3) * MINI + MINI / 2;
        if (macro[b] === DRAW) {
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect((b % 3) * MINI + 2, Math.floor(b / 3) * MINI + 2, MINI - 4, MINI - 4);
        } else {
            ctx.fillStyle = macro[b] === X ? COLORS.xFaint : COLORS.oFaint;
            ctx.fillRect((b % 3) * MINI + 2, Math.floor(b / 3) * MINI + 2, MINI - 4, MINI - 4);
            drawMark(bx, by, MINI * 0.3, macro[b], 0.95);
        }
    }

    // thick separators between mini-boards
    ctx.strokeStyle = COLORS.thickLine;
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
        ctx.moveTo(i * MINI, 6); ctx.lineTo(i * MINI, SIZE - 6);
        ctx.moveTo(6, i * MINI); ctx.lineTo(SIZE - 6, i * MINI);
    }
    ctx.stroke();

    // winning macro line highlight
    if (winLine) {
        ctx.strokeStyle = COLORS.win;
        ctx.lineWidth = 6;
        const p0 = macroCentre(winLine[0]);
        const p2 = macroCentre(winLine[2]);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y); ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    }
}

function macroCentre(b) {
    return {
        x: (b % 3) * MINI + MINI / 2,
        y: Math.floor(b / 3) * MINI + MINI / 2,
    };
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------
function pixelToCell(px, py) {
    if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) return null;
    const bCol = Math.floor(px / MINI);
    const bRow = Math.floor(py / MINI);
    const cCol = Math.floor((px - bCol * MINI) / CELL);
    const cRow = Math.floor((py - bRow * MINI) / CELL);
    const b = bRow * 3 + bCol;
    const c = cRow * 3 + cCol;
    if (b < 0 || b > 8 || c < 0 || c > 8) return null;
    return [b, c];
}

function eventToCell(evt) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return pixelToCell((evt.clientX - rect.left) * sx, (evt.clientY - rect.top) * sy);
}

function onClick(evt) {
    if (state !== 'playing' || currentPlayer !== X) return;
    const cell = eventToCell(evt);
    if (!cell) return;
    humanMove(cell[0], cell[1]);
}

function onKey(evt) {
    if (evt.key === 'r' || evt.key === 'R') newGame();
}

// -----------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------
if (canvas) {
    canvas.addEventListener('click', onClick);
    if (btnNew) btnNew.addEventListener('click', newGame);
    window.addEventListener('keydown', onKey);
}

loadScores();
renderScores();
newGame();
