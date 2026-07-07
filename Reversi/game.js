/* Reversi (Othello) — classic disc-flipping board game on an HTML5 canvas.
 *
 * The human plays black, a deterministic heuristic AI plays white. All game
 * logic lives in the `game` object exposed on `window` so the Playwright suite
 * can drive it deterministically. Turn / pass / game-over are always derived
 * from the board, never stored as a flag that could drift. */

const N = 8;          // board size
const CELL = 60;      // pixels per cell
const EMPTY = 0, BLACK = 1, WHITE = 2;

const DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
];

// Positional weights for the AI: corners are gold, cells next to empty corners
// are traps.
const WEIGHTS = [
    [120, -20,  20,   5,   5,  20, -20, 120],
    [-20, -40,  -5,  -5,  -5,  -5, -40, -20],
    [ 20,  -5,  15,   3,   3,  15,  -5,  20],
    [  5,  -5,   3,   3,   3,   3,  -5,   5],
    [  5,  -5,   3,   3,   3,   3,  -5,   5],
    [ 20,  -5,  15,   3,   3,  15,  -5,  20],
    [-20, -40,  -5,  -5,  -5,  -5, -40, -20],
    [120, -20,  20,   5,   5,  20, -20, 120],
];

const AI_DELAY = 420; // ms pause before the AI replies

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const blackScoreEl = document.getElementById('black-score');
const whiteScoreEl = document.getElementById('white-score');
const turnEl = document.getElementById('turn-indicator');
const messageEl = document.getElementById('message');
const chipBlack = document.getElementById('chip-black');
const chipWhite = document.getElementById('chip-white');
const newGameBtn = document.getElementById('new-game');

// -------------------------------------------------------------------------
// Pure helpers (operate on an explicit board so they are easy to reason about)
// -------------------------------------------------------------------------
function inBounds(r, c) {
    return r >= 0 && r < N && c >= 0 && c < N;
}

function other(player) {
    return player === BLACK ? WHITE : BLACK;
}

function emptyBoard() {
    return Array.from({ length: N }, () => Array(N).fill(EMPTY));
}

// Discs that placing `player` at (r,c) would flip. Empty array => illegal.
function capturesOn(board, r, c, player) {
    if (!inBounds(r, c) || board[r][c] !== EMPTY) return [];
    const opp = other(player);
    const flips = [];
    for (const [dr, dc] of DIRS) {
        const line = [];
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc) && board[nr][nc] === opp) {
            line.push([nr, nc]);
            nr += dr; nc += dc;
        }
        if (line.length && inBounds(nr, nc) && board[nr][nc] === player) {
            flips.push(...line);
        }
    }
    return flips;
}

function legalMovesOn(board, player) {
    const moves = [];
    for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++)
            if (board[r][c] === EMPTY && capturesOn(board, r, c, player).length)
                moves.push([r, c]);
    return moves;
}

function countOn(board) {
    let black = 0, white = 0;
    for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
            if (board[r][c] === BLACK) black++;
            else if (board[r][c] === WHITE) white++;
        }
    return { black, white };
}

// -------------------------------------------------------------------------
// Game object
// -------------------------------------------------------------------------
const game = {
    board: emptyBoard(),
    currentPlayer: BLACK,
    state: 'playing', // 'playing' | 'gameover'
    winner: null,     // null | 'black' | 'white' | 'draw'

    reset() {
        this.board = emptyBoard();
        this.board[3][3] = WHITE;
        this.board[4][4] = WHITE;
        this.board[3][4] = BLACK;
        this.board[4][3] = BLACK;
        this.currentPlayer = BLACK;
        this.state = 'playing';
        this.winner = null;
        afterChange();
    },

    scores() {
        return countOn(this.board);
    },

    legalMoves(player) {
        return legalMovesOn(this.board, player);
    },

    isLegalMove(r, c, player) {
        return capturesOn(this.board, r, c, player).length > 0;
    },

    // Apply a move for the current player. Returns true if it was legal.
    play(r, c) {
        if (this.state !== 'playing') return false;
        const player = this.currentPlayer;
        const flips = capturesOn(this.board, r, c, player);
        if (!flips.length) return false;
        this.board[r][c] = player;
        for (const [fr, fc] of flips) this.board[fr][fc] = player;
        advanceTurn(this);
        afterChange();
        return true;
    },

    // The white AI chooses and plays its best move.
    aiMove() {
        if (this.state !== 'playing' || this.currentPlayer !== WHITE) return false;
        const moves = this.legalMoves(WHITE);
        if (!moves.length) return false;
        let best = null, bestScore = -Infinity;
        for (const [r, c] of moves) { // scan order => deterministic tie-break
            const score = WEIGHTS[r][c] + capturesOn(this.board, r, c, WHITE).length;
            if (score > bestScore) { bestScore = score; best = [r, c]; }
        }
        return this.play(best[0], best[1]);
    },

    // Test hook: install an arbitrary position and whose turn it is, then
    // normalise (auto-pass / detect game over) exactly as real play would.
    setBoard(grid, currentPlayer) {
        this.board = grid.map((row) => row.slice());
        this.currentPlayer = currentPlayer;
        this.state = 'playing';
        this.winner = null;
        normaliseMover(this);
        afterChange();
    },
};

window.game = game;
window.EMPTY = EMPTY;
window.BLACK = BLACK;
window.WHITE = WHITE;

// After a move, hand the turn to whoever can move; end the game if nobody can.
function advanceTurn(g) {
    const opp = other(g.currentPlayer);
    if (legalMovesOn(g.board, opp).length) {
        g.currentPlayer = opp;
    } else if (legalMovesOn(g.board, g.currentPlayer).length) {
        // Opponent passes; same player moves again.
    } else {
        endGame(g);
    }
}

// Ensure the nominated mover actually has a move; otherwise pass or end.
function normaliseMover(g) {
    if (legalMovesOn(g.board, g.currentPlayer).length) return;
    const opp = other(g.currentPlayer);
    if (legalMovesOn(g.board, opp).length) {
        g.currentPlayer = opp;
    } else {
        endGame(g);
    }
}

function endGame(g) {
    g.state = 'gameover';
    const { black, white } = countOn(g.board);
    g.winner = black > white ? 'black' : white > black ? 'white' : 'draw';
}

// -------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------
function render() {
    // Felt board.
    ctx.fillStyle = '#1f6b41';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid lines.
    ctx.strokeStyle = '#12472b';
    ctx.lineWidth = 2;
    for (let i = 0; i <= N; i++) {
        ctx.beginPath();
        ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, canvas.height); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * CELL); ctx.lineTo(canvas.width, i * CELL); ctx.stroke();
    }

    // Legal-move hints for the human (black) player.
    if (game.state === 'playing' && game.currentPlayer === BLACK) {
        ctx.fillStyle = 'rgba(20, 20, 20, 0.28)';
        for (const [r, c] of game.legalMoves(BLACK)) {
            ctx.beginPath();
            ctx.arc(c * CELL + CELL / 2, r * CELL + CELL / 2, 7, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Discs.
    for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++)
            if (game.board[r][c] !== EMPTY) drawDisc(r, c, game.board[r][c]);
}

function drawDisc(r, c, colour) {
    const cx = c * CELL + CELL / 2;
    const cy = r * CELL + CELL / 2;
    const radius = CELL / 2 - 6;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(
        cx - radius * 0.35, cy - radius * 0.35, radius * 0.2,
        cx, cy, radius
    );
    if (colour === BLACK) {
        grad.addColorStop(0, '#5a5a5a');
        grad.addColorStop(1, '#080808');
    } else {
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(1, '#c2c9c4');
    }
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

// -------------------------------------------------------------------------
// HUD
// -------------------------------------------------------------------------
function updateHUD() {
    const { black, white } = game.scores();
    blackScoreEl.textContent = String(black);
    whiteScoreEl.textContent = String(white);

    chipBlack.classList.toggle('active',
        game.state === 'playing' && game.currentPlayer === BLACK);
    chipWhite.classList.toggle('active',
        game.state === 'playing' && game.currentPlayer === WHITE);

    if (game.state === 'gameover') {
        turnEl.textContent = 'Game over';
        messageEl.textContent =
            game.winner === 'black' ? 'You win!' :
            game.winner === 'white' ? 'White wins' : 'Draw';
    } else {
        turnEl.textContent = game.currentPlayer === BLACK
            ? "Black's turn" : 'White is thinking…';
        messageEl.textContent = '';
    }
}

function afterChange() {
    updateHUD();
    render();
}

// -------------------------------------------------------------------------
// Turn driving (UI layer): human clicks, then the AI replies after a pause.
// -------------------------------------------------------------------------
function runAiTurn() {
    if (game.state !== 'playing' || game.currentPlayer !== WHITE) return;
    game.aiMove();
    afterChange();
    // If the human has no move, white keeps going after another pause.
    if (game.state === 'playing' && game.currentPlayer === WHITE) {
        setTimeout(runAiTurn, AI_DELAY);
    }
}

function scheduleAi() {
    if (game.state === 'playing' && game.currentPlayer === WHITE) {
        setTimeout(runAiTurn, AI_DELAY);
    }
}

// -------------------------------------------------------------------------
// Input
// -------------------------------------------------------------------------
canvas.addEventListener('click', (e) => {
    if (game.state !== 'playing' || game.currentPlayer !== BLACK) return;
    const rect = canvas.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left) / CELL);
    const r = Math.floor((e.clientY - rect.top) / CELL);
    if (!inBounds(r, c)) return;
    if (game.play(r, c)) scheduleAi();
});

document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r') game.reset();
});

newGameBtn.addEventListener('click', () => game.reset());

// -------------------------------------------------------------------------
// Boot
// -------------------------------------------------------------------------
game.reset();
