// ---------------------------------------------------------------------------
// Chess — rules, notation, engine, rendering and input.
// ---------------------------------------------------------------------------
// board[r][c]: r = 0 is rank 8 (top of the screen), c = 0 is file a.
// A square holds '' or one FEN character: PNBRQK = White, pnbrqk = Black.
// A position is { board, turn, castling, ep, halfmove, fullmove } and
// applyMove() returns a new one rather than mutating the old.
// ---------------------------------------------------------------------------

const ROWS = 8;
const COLS = 8;
const SQUARE = 70;

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const HUMAN = 'w';
const ENGINE = 'b';
const SEARCH_DEPTH = 3;
const QUIESCE_DEPTH = 4;
const ENGINE_DELAY = 280;
const MATE = 100000;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const statusEl = document.getElementById('status');
const moveListEl = document.getElementById('move-list');
const promotionEl = document.getElementById('promotion');
const capturedByWhiteEl = document.getElementById('captured-by-white');
const capturedByBlackEl = document.getElementById('captured-by-black');

const CLR = {
    light: '#eadbbe',
    dark: '#9c6b43',
    coord: 'rgba(0, 0, 0, 0.35)',
    coordLight: 'rgba(255, 255, 255, 0.5)',
    last: 'rgba(244, 213, 141, 0.42)',
    select: 'rgba(250, 204, 21, 0.55)',
    target: 'rgba(63, 185, 111, 0.65)',
    check: 'rgba(225, 72, 72, 0.6)',
    white: '#f6f7fb',
    whiteEdge: '#2a2f3a',
    black: '#242933',
    blackEdge: '#0a0d13',
};

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

// --- State ---
let pos = loadFen(START_FEN);
let startFen = START_FEN;
let state = 'ready'; // ready | playing | promoting | over
let result = null; // null | '1-0' | '0-1' | '1/2-1/2'
let selected = null; // null | [r, c]
let moveHistory = []; // [{ fen, san }] — fen is the position *before* the move
let lastMove = null;
let pendingPromotion = null; // { from, to } awaiting the player's choice
let aiEnabled = true;
let engineTimer = null;

// ---------------------------------------------------------------------------
// Squares and pieces
// ---------------------------------------------------------------------------

function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function squareName(r, c) {
    return String.fromCharCode(97 + c) + (8 - r);
}

function parseSquare(name) {
    return [8 - Number(name[1]), name.charCodeAt(0) - 97];
}

function pieceColor(ch) {
    if (!ch) return '';
    return ch === ch.toUpperCase() ? 'w' : 'b';
}

function other(color) {
    return color === 'w' ? 'b' : 'w';
}

function emptyBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(''));
}

// ---------------------------------------------------------------------------
// FEN
// ---------------------------------------------------------------------------

function loadFen(fen) {
    const parts = fen.trim().split(/\s+/);
    const board = emptyBoard();
    let r = 0;
    let c = 0;
    for (const ch of parts[0]) {
        if (ch === '/') {
            r++;
            c = 0;
        } else if (/\d/.test(ch)) {
            c += Number(ch);
        } else {
            board[r][c++] = ch;
        }
    }
    const castling = !parts[2] || parts[2] === '-' ? '' : parts[2];
    return {
        board,
        turn: parts[1] === 'b' ? 'b' : 'w',
        castling,
        ep: parts[3] && parts[3] !== '-' ? parseSquare(parts[3]) : null,
        halfmove: Number(parts[4] || 0),
        fullmove: Number(parts[5] || 1),
    };
}

function toFen(p) {
    const rows = [];
    for (let r = 0; r < ROWS; r++) {
        let row = '';
        let gap = 0;
        for (let c = 0; c < COLS; c++) {
            const ch = p.board[r][c];
            if (ch) {
                if (gap) row += gap;
                gap = 0;
                row += ch;
            } else {
                gap++;
            }
        }
        if (gap) row += gap;
        rows.push(row);
    }
    const rights = 'KQkq'
        .split('')
        .filter((ch) => p.castling.includes(ch))
        .join('');
    return [
        rows.join('/'),
        p.turn,
        rights || '-',
        p.ep ? squareName(p.ep[0], p.ep[1]) : '-',
        p.halfmove,
        p.fullmove,
    ].join(' ');
}

// The repetition key: everything that makes two positions "the same" position.
function repKey(p) {
    return toFen(p).split(' ').slice(0, 4).join(' ');
}

// ---------------------------------------------------------------------------
// Attack detection
// ---------------------------------------------------------------------------

const KNIGHT_HOPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const DIAGONALS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTHOGONALS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const ALL_DIRS = [...DIAGONALS, ...ORTHOGONALS];

// Is (r, c) attacked by any piece of `by`? Looks outwards from the square, so
// it never needs a move list.
function squareAttacked(p, r, c, by) {
    const bd = p.board;
    const want = (ch) => (by === 'w' ? ch.toUpperCase() : ch.toLowerCase());

    for (const [dr, dc] of KNIGHT_HOPS) {
        const [nr, nc] = [r + dr, c + dc];
        if (inBounds(nr, nc) && bd[nr][nc] === want('n')) return true;
    }

    // Pawns: a white pawn attacks upwards, so it sits one row below.
    const pawnRow = by === 'w' ? r + 1 : r - 1;
    for (const dc of [-1, 1]) {
        if (inBounds(pawnRow, c + dc) && bd[pawnRow][c + dc] === want('p')) return true;
    }

    for (const [dr, dc] of ALL_DIRS) {
        const [nr, nc] = [r + dr, c + dc];
        if (inBounds(nr, nc) && bd[nr][nc] === want('k')) return true;
    }

    for (const [dr, dc] of ORTHOGONALS) {
        let nr = r + dr;
        let nc = c + dc;
        while (inBounds(nr, nc)) {
            const ch = bd[nr][nc];
            if (ch) {
                if (ch === want('r') || ch === want('q')) return true;
                break;
            }
            nr += dr;
            nc += dc;
        }
    }

    for (const [dr, dc] of DIAGONALS) {
        let nr = r + dr;
        let nc = c + dc;
        while (inBounds(nr, nc)) {
            const ch = bd[nr][nc];
            if (ch) {
                if (ch === want('b') || ch === want('q')) return true;
                break;
            }
            nr += dr;
            nc += dc;
        }
    }

    return false;
}

function findKing(p, color) {
    const king = color === 'w' ? 'K' : 'k';
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) if (p.board[r][c] === king) return [r, c];
    return null;
}

function inCheck(p, color) {
    const sq = findKing(p, color);
    if (!sq) return false;
    return squareAttacked(p, sq[0], sq[1], other(color));
}

// ---------------------------------------------------------------------------
// Move generation
// ---------------------------------------------------------------------------

function makeMove(from, to, piece, capture, extra = {}) {
    return {
        from,
        to,
        piece,
        capture: capture || '',
        promo: null,
        castle: null,
        ep: false,
        dbl: false,
        ...extra,
    };
}

const PROMO_PIECES = ['q', 'r', 'b', 'n'];

function pawnMoves(p, r, c, piece, out) {
    const bd = p.board;
    const color = pieceColor(piece);
    const dir = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;
    const promoRow = color === 'w' ? 0 : 7;

    const oneR = r + dir;
    if (inBounds(oneR, c) && !bd[oneR][c]) {
        if (oneR === promoRow) {
            for (const promo of PROMO_PIECES)
                out.push(makeMove([r, c], [oneR, c], piece, '', { promo }));
        } else {
            out.push(makeMove([r, c], [oneR, c], piece, ''));
            const twoR = r + 2 * dir;
            if (r === startRow && !bd[twoR][c])
                out.push(makeMove([r, c], [twoR, c], piece, '', { dbl: true }));
        }
    }

    for (const dc of [-1, 1]) {
        const [nr, nc] = [r + dir, c + dc];
        if (!inBounds(nr, nc)) continue;
        const target = bd[nr][nc];
        if (target && pieceColor(target) !== color) {
            if (nr === promoRow) {
                for (const promo of PROMO_PIECES)
                    out.push(makeMove([r, c], [nr, nc], piece, target, { promo }));
            } else {
                out.push(makeMove([r, c], [nr, nc], piece, target));
            }
        } else if (!target && p.ep && p.ep[0] === nr && p.ep[1] === nc) {
            out.push(makeMove([r, c], [nr, nc], piece, bd[r][nc], { ep: true }));
        }
    }
}

function stepMoves(p, r, c, piece, dirs, out) {
    const color = pieceColor(piece);
    for (const [dr, dc] of dirs) {
        const [nr, nc] = [r + dr, c + dc];
        if (!inBounds(nr, nc)) continue;
        const target = p.board[nr][nc];
        if (target && pieceColor(target) === color) continue;
        out.push(makeMove([r, c], [nr, nc], piece, target));
    }
}

function slideMoves(p, r, c, piece, dirs, out) {
    const color = pieceColor(piece);
    for (const [dr, dc] of dirs) {
        let nr = r + dr;
        let nc = c + dc;
        while (inBounds(nr, nc)) {
            const target = p.board[nr][nc];
            if (target) {
                if (pieceColor(target) !== color)
                    out.push(makeMove([r, c], [nr, nc], piece, target));
                break;
            }
            out.push(makeMove([r, c], [nr, nc], piece, ''));
            nr += dr;
            nc += dc;
        }
    }
}

// Castling is generated fully legal: rights, clear squares, and the king
// neither standing in, passing through, nor landing on an attacked square.
function castlingMoves(p, color, out) {
    const row = color === 'w' ? 7 : 0;
    const king = color === 'w' ? 'K' : 'k';
    const rook = color === 'w' ? 'R' : 'r';
    const foe = other(color);
    if (p.board[row][4] !== king) return;
    if (squareAttacked(p, row, 4, foe)) return;

    const kingSide = color === 'w' ? 'K' : 'k';
    if (p.castling.includes(kingSide) && p.board[row][7] === rook) {
        if (
            !p.board[row][5] &&
            !p.board[row][6] &&
            !squareAttacked(p, row, 5, foe) &&
            !squareAttacked(p, row, 6, foe)
        ) {
            out.push(makeMove([row, 4], [row, 6], king, '', { castle: 'K' }));
        }
    }

    const queenSide = color === 'w' ? 'Q' : 'q';
    if (p.castling.includes(queenSide) && p.board[row][0] === rook) {
        if (
            !p.board[row][1] &&
            !p.board[row][2] &&
            !p.board[row][3] &&
            !squareAttacked(p, row, 3, foe) &&
            !squareAttacked(p, row, 2, foe)
        ) {
            out.push(makeMove([row, 4], [row, 2], king, '', { castle: 'Q' }));
        }
    }
}

// Pseudo-legal moves: everything but "does this leave my own king in check".
function generateMoves(p, color = p.turn) {
    const out = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const piece = p.board[r][c];
            if (!piece || pieceColor(piece) !== color) continue;
            switch (piece.toLowerCase()) {
                case 'p':
                    pawnMoves(p, r, c, piece, out);
                    break;
                case 'n':
                    stepMoves(p, r, c, piece, KNIGHT_HOPS, out);
                    break;
                case 'b':
                    slideMoves(p, r, c, piece, DIAGONALS, out);
                    break;
                case 'r':
                    slideMoves(p, r, c, piece, ORTHOGONALS, out);
                    break;
                case 'q':
                    slideMoves(p, r, c, piece, ALL_DIRS, out);
                    break;
                case 'k':
                    stepMoves(p, r, c, piece, ALL_DIRS, out);
                    break;
            }
        }
    }
    castlingMoves(p, color, out);
    return out;
}

function applyMove(p, m) {
    const board = p.board.map((row) => row.slice());
    const piece = board[m.from[0]][m.from[1]] || m.piece;
    const color = pieceColor(piece);
    const kind = piece.toLowerCase();

    board[m.from[0]][m.from[1]] = '';
    board[m.to[0]][m.to[1]] = m.promo
        ? color === 'w'
            ? m.promo.toUpperCase()
            : m.promo
        : piece;

    if (m.ep) board[m.from[0]][m.to[1]] = '';

    if (m.castle) {
        const row = m.from[0];
        if (m.castle === 'K') {
            board[row][5] = board[row][7];
            board[row][7] = '';
        } else {
            board[row][3] = board[row][0];
            board[row][0] = '';
        }
    }

    let castling = p.castling;
    const drop = (ch) => {
        castling = castling.replace(ch, '');
    };
    if (kind === 'k') {
        if (color === 'w') {
            drop('K');
            drop('Q');
        } else {
            drop('k');
            drop('q');
        }
    }
    // A rook that leaves, or a rook that is captured, loses that corner.
    for (const [r, c] of [m.from, m.to]) {
        if (r === 7 && c === 7) drop('K');
        else if (r === 7 && c === 0) drop('Q');
        else if (r === 0 && c === 7) drop('k');
        else if (r === 0 && c === 0) drop('q');
    }

    return {
        board,
        turn: other(color),
        castling,
        ep: m.dbl ? [(m.from[0] + m.to[0]) / 2, m.from[1]] : null,
        halfmove: kind === 'p' || m.capture ? 0 : p.halfmove + 1,
        fullmove: color === 'b' ? p.fullmove + 1 : p.fullmove,
    };
}

function legalMoves(p, color = p.turn) {
    return generateMoves(p, color).filter((m) => !inCheck(applyMove(p, m), color));
}

function movesFrom(p, r, c) {
    const piece = p.board[r][c];
    if (!piece) return [];
    return legalMoves(p, pieceColor(piece)).filter(
        (m) => m.from[0] === r && m.from[1] === c
    );
}

// Leaf-node count of the move tree — the standard move generation test.
function perft(p, depth) {
    if (depth <= 0) return 1;
    const moves = legalMoves(p);
    if (depth === 1) return moves.length;
    let nodes = 0;
    for (const m of moves) nodes += perft(applyMove(p, m), depth - 1);
    return nodes;
}

// ---------------------------------------------------------------------------
// Game state: mate, stalemate and the draws
// ---------------------------------------------------------------------------

function insufficientMaterial(p) {
    let minors = { w: 0, b: 0 };
    for (const row of p.board) {
        for (const ch of row) {
            if (!ch) continue;
            const kind = ch.toLowerCase();
            if (kind === 'p' || kind === 'r' || kind === 'q') return false;
            if (kind === 'b' || kind === 'n') minors[pieceColor(ch)]++;
        }
    }
    return minors.w <= 1 && minors.b <= 1;
}

// 'playing' | 'checkmate' | 'stalemate' | 'fifty-move' | 'insufficient' | 'repetition'
function gameStatus(p, keys = null) {
    if (legalMoves(p).length === 0) return inCheck(p, p.turn) ? 'checkmate' : 'stalemate';
    if (p.halfmove >= 100) return 'fifty-move';
    if (insufficientMaterial(p)) return 'insufficient';
    if (keys) {
        const key = repKey(p);
        if (keys.filter((k) => k === key).length >= 3) return 'repetition';
    }
    return 'playing';
}

// ---------------------------------------------------------------------------
// Standard algebraic notation
// ---------------------------------------------------------------------------

function moveSan(p, m) {
    if (!m) return '';
    if (m.castle) return m.castle === 'K' ? 'O-O' : 'O-O-O';

    const kind = m.piece.toLowerCase();
    const to = squareName(m.to[0], m.to[1]);
    const from = squareName(m.from[0], m.from[1]);
    let san = '';

    if (kind === 'p') {
        san = m.capture ? `${from[0]}x${to}` : to;
        if (m.promo) san += `=${m.promo.toUpperCase()}`;
    } else {
        const rivals = legalMoves(p, pieceColor(m.piece)).filter(
            (o) =>
                o.piece === m.piece &&
                o.to[0] === m.to[0] &&
                o.to[1] === m.to[1] &&
                !(o.from[0] === m.from[0] && o.from[1] === m.from[1])
        );
        let hint = '';
        if (rivals.length) {
            const sameFile = rivals.some((o) => o.from[1] === m.from[1]);
            const sameRank = rivals.some((o) => o.from[0] === m.from[0]);
            if (!sameFile) hint = from[0];
            else if (!sameRank) hint = from[1];
            else hint = from;
        }
        san = `${kind.toUpperCase()}${hint}${m.capture ? 'x' : ''}${to}`;
    }

    const next = applyMove(p, m);
    if (inCheck(next, next.turn)) san += legalMoves(next).length === 0 ? '#' : '+';
    return san;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

const PST = {
    p: [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [50, 50, 50, 50, 50, 50, 50, 50],
        [10, 10, 20, 30, 30, 20, 10, 10],
        [5, 5, 10, 25, 25, 10, 5, 5],
        [0, 0, 0, 20, 20, 0, 0, 0],
        [5, -5, -10, 0, 0, -10, -5, 5],
        [5, 10, 10, -20, -20, 10, 10, 5],
        [0, 0, 0, 0, 0, 0, 0, 0],
    ],
    n: [
        [-50, -40, -30, -30, -30, -30, -40, -50],
        [-40, -20, 0, 5, 5, 0, -20, -40],
        [-30, 5, 10, 15, 15, 10, 5, -30],
        [-30, 0, 15, 20, 20, 15, 0, -30],
        [-30, 5, 15, 20, 20, 15, 5, -30],
        [-30, 0, 10, 15, 15, 10, 0, -30],
        [-40, -20, 0, 0, 0, 0, -20, -40],
        [-50, -40, -30, -30, -30, -30, -40, -50],
    ],
    b: [
        [-20, -10, -10, -10, -10, -10, -10, -20],
        [-10, 0, 0, 0, 0, 0, 0, -10],
        [-10, 0, 5, 10, 10, 5, 0, -10],
        [-10, 5, 5, 10, 10, 5, 5, -10],
        [-10, 0, 10, 10, 10, 10, 0, -10],
        [-10, 10, 10, 10, 10, 10, 10, -10],
        [-10, 5, 0, 0, 0, 0, 5, -10],
        [-20, -10, -10, -10, -10, -10, -10, -20],
    ],
    r: [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [5, 10, 10, 10, 10, 10, 10, 5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [0, 0, 0, 5, 5, 0, 0, 0],
    ],
    q: [
        [-20, -10, -10, -5, -5, -10, -10, -20],
        [-10, 0, 0, 0, 0, 0, 0, -10],
        [-10, 0, 5, 5, 5, 5, 0, -10],
        [-5, 0, 5, 5, 5, 5, 0, -5],
        [0, 0, 5, 5, 5, 5, 0, -5],
        [-10, 5, 5, 5, 5, 5, 0, -10],
        [-10, 0, 5, 0, 0, 0, 0, -10],
        [-20, -10, -10, -5, -5, -10, -10, -20],
    ],
    k: [
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-20, -30, -30, -40, -40, -30, -30, -20],
        [-10, -20, -20, -20, -20, -20, -20, -10],
        [20, 20, 0, 0, 0, 0, 20, 20],
        [20, 30, 10, 0, 0, 10, 30, 20],
    ],
};

const KING_ENDGAME_PST = [
    [-50, -40, -30, -20, -20, -30, -40, -50],
    [-30, -20, -10, 0, 0, -10, -20, -30],
    [-30, -10, 20, 30, 30, 20, -10, -30],
    [-30, -10, 30, 40, 40, 30, -10, -30],
    [-30, -10, 30, 40, 40, 30, -10, -30],
    [-30, -10, 20, 30, 30, 20, -10, -30],
    [-30, -30, 0, 0, 0, 0, -30, -30],
    [-50, -30, -30, -30, -30, -30, -30, -50],
];

// Score in centipawns, always from White's point of view.
function evaluate(p) {
    let material = 0;
    let heavy = 0;
    const bishops = { w: 0, b: 0 };
    const pieces = [];

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const ch = p.board[r][c];
            if (!ch) continue;
            const kind = ch.toLowerCase();
            const color = pieceColor(ch);
            const sign = color === 'w' ? 1 : -1;
            material += sign * VALUE[kind];
            if (kind !== 'p' && kind !== 'k') heavy += VALUE[kind];
            if (kind === 'b') bishops[color]++;
            pieces.push([r, c, kind, color, sign]);
        }
    }

    const endgame = heavy <= 1300;
    let placement = 0;
    for (const [r, c, kind, color, sign] of pieces) {
        const table = kind === 'k' && endgame ? KING_ENDGAME_PST : PST[kind];
        placement += sign * table[color === 'w' ? r : 7 - r][c];
    }

    let pair = 0;
    if (bishops.w >= 2) pair += 30;
    if (bishops.b >= 2) pair -= 30;

    return material + placement + pair;
}

// Evaluation from the point of view of the side to move.
function sideEval(p) {
    return (p.turn === 'w' ? 1 : -1) * evaluate(p);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function moveScore(m) {
    let score = 0;
    if (m.capture) score += 1000 + VALUE[m.capture.toLowerCase()] - VALUE[m.piece.toLowerCase()] / 10;
    if (m.promo) score += 800 + VALUE[m.promo];
    if (m.castle) score += 50;
    return score;
}

function orderMoves(moves) {
    return moves
        .map((m) => [moveScore(m), m])
        .sort((a, b) => b[0] - a[0])
        .map(([, m]) => m);
}

// Captures-only search so the engine never stops counting mid-trade. When in
// check it looks at every move instead, or it would miss the escape.
function quiesce(p, alpha, beta, ply, depth) {
    const checked = inCheck(p, p.turn);
    if (checked) {
        const moves = legalMoves(p);
        if (!moves.length) return -(MATE - ply);
        if (depth <= 0) return sideEval(p);
        let best = -Infinity;
        for (const m of orderMoves(moves)) {
            const score = -quiesce(applyMove(p, m), -beta, -alpha, ply + 1, depth - 1);
            if (score > best) best = score;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
        }
        return best;
    }

    const stand = sideEval(p);
    if (depth <= 0 || stand >= beta) return stand;
    if (stand > alpha) alpha = stand;

    const noisy = legalMoves(p).filter((m) => m.capture || m.promo);
    let best = stand;
    for (const m of orderMoves(noisy)) {
        const score = -quiesce(applyMove(p, m), -beta, -alpha, ply + 1, depth - 1);
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    return best;
}

function negamax(p, depth, alpha, beta, ply) {
    const moves = legalMoves(p);
    if (!moves.length) return inCheck(p, p.turn) ? -(MATE - ply) : 0;
    if (p.halfmove >= 100) return 0;
    if (depth <= 0) return quiesce(p, alpha, beta, ply, QUIESCE_DEPTH);

    let best = -Infinity;
    for (const m of orderMoves(moves)) {
        const score = -negamax(applyMove(p, m), depth - 1, -beta, -alpha, ply + 1);
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    return best;
}

// The engine's choice. Exact ties are broken at random so games differ.
function chooseMove(p, depth = SEARCH_DEPTH) {
    const moves = orderMoves(legalMoves(p));
    if (!moves.length) return null;
    let best = -Infinity;
    let bestMoves = [];
    for (const m of moves) {
        const lower = best === -Infinity ? -Infinity : best - 1;
        const score = -negamax(applyMove(p, m), depth - 1, -Infinity, -lower, 1);
        if (score > best) {
            best = score;
            bestMoves = [m];
        } else if (score === best) {
            bestMoves.push(m);
        }
    }
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function cancelEngine() {
    if (engineTimer !== null) {
        clearTimeout(engineTimer);
        engineTimer = null;
    }
}

function historyKeys() {
    return [...moveHistory.map((h) => repKey(loadFen(h.fen))), repKey(pos)];
}

function startGame() {
    cancelEngine();
    pos = loadFen(START_FEN);
    startFen = START_FEN;
    state = 'playing';
    result = null;
    selected = null;
    lastMove = null;
    pendingPromotion = null;
    moveHistory = [];
    hideOverlay();
    hidePromotion();
    updateHud();
    renderMoveList();
}

// Put an exact position on the board — used by the tests and for debugging.
function setupPosition(fen) {
    cancelEngine();
    pos = loadFen(fen);
    startFen = fen;
    state = 'playing';
    result = null;
    selected = null;
    lastMove = null;
    pendingPromotion = null;
    moveHistory = [];
    hideOverlay();
    hidePromotion();
    updateHud();
    renderMoveList();
}

function commitMove(move) {
    if (!move) return;
    moveHistory.push({ fen: toFen(pos), san: moveSan(pos, move) });
    pos = applyMove(pos, move);
    lastMove = move;
    selected = null;
    pendingPromotion = null;
    hidePromotion();
    if (state === 'promoting') state = 'playing';
    renderMoveList();
    updateHud();
    if (!finishIfOver() && aiEnabled && pos.turn === ENGINE) scheduleEngine();
}

function scheduleEngine() {
    cancelEngine();
    engineTimer = setTimeout(() => {
        engineTimer = null;
        engineMove();
    }, ENGINE_DELAY);
}

function engineMove() {
    if (state !== 'playing') return;
    const move = chooseMove(pos, SEARCH_DEPTH);
    if (move) commitMove(move);
}

const END_TEXT = {
    checkmate: ['Checkmate', (p) => (p.turn === HUMAN ? 'The engine mates. Press R for a new game.' : 'You mate. Well played!')],
    stalemate: ['Stalemate — draw', () => 'No legal move, but no check either.'],
    'fifty-move': ['Draw', () => 'Fifty moves with no capture and no pawn move.'],
    insufficient: ['Draw', () => 'Neither side has enough material to mate.'],
    repetition: ['Draw', () => 'The same position has come up three times.'],
};

// Ends the game if the position is final; returns true when it did.
function finishIfOver() {
    const status = gameStatus(pos, historyKeys());
    if (status === 'playing') return false;
    state = 'over';
    if (status === 'checkmate') result = pos.turn === 'w' ? '0-1' : '1-0';
    else result = '1/2-1/2';
    const [title, sub] = END_TEXT[status];
    showOverlay(title, sub(pos));
    updateHud();
    return true;
}

function undo() {
    if (!moveHistory.length) return;
    cancelEngine();
    for (let i = 0; i < 2 && moveHistory.length; i++) {
        const entry = moveHistory.pop();
        pos = loadFen(entry.fen);
        if (pos.turn === HUMAN) break;
    }
    state = 'playing';
    result = null;
    selected = null;
    lastMove = null;
    pendingPromotion = null;
    hideOverlay();
    hidePromotion();
    renderMoveList();
    updateHud();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function legalTargets() {
    if (!selected) return [];
    const seen = new Set();
    const out = [];
    for (const m of movesFrom(pos, selected[0], selected[1])) {
        const key = `${m.to[0]},${m.to[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(m.to);
    }
    return out;
}

function clickSquare(r, c) {
    if (state !== 'playing' || pos.turn !== HUMAN) return;

    if (selected) {
        const [sr, sc] = selected;
        if (sr === r && sc === c) {
            selected = null;
            return;
        }
        const candidates = movesFrom(pos, sr, sc).filter(
            (m) => m.to[0] === r && m.to[1] === c
        );
        if (candidates.length > 1 && candidates[0].promo) {
            pendingPromotion = { from: [sr, sc], to: [r, c] };
            state = 'promoting';
            showPromotion();
            return;
        }
        if (candidates.length === 1) {
            commitMove(candidates[0]);
            return;
        }
    }

    const piece = pos.board[r][c];
    selected = piece && pieceColor(piece) === HUMAN ? [r, c] : null;
}

function choosePromotion(kind) {
    if (state !== 'promoting' || !pendingPromotion) return;
    const { from, to } = pendingPromotion;
    const move = movesFrom(pos, from[0], from[1]).find(
        (m) => m.to[0] === to[0] && m.to[1] === to[1] && m.promo === kind
    );
    if (move) commitMove(move);
}

function squareCentre(r, c) {
    return { x: c * SQUARE + SQUARE / 2, y: r * SQUARE + SQUARE / 2 };
}

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const c = Math.floor(x / SQUARE);
    const r = Math.floor(y / SQUARE);
    if (inBounds(r, c)) clickSquare(r, c);
});

btnStart.addEventListener('click', (e) => {
    e.stopPropagation();
    startGame();
});

for (const button of document.querySelectorAll('#promotion-buttons button')) {
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        choosePromotion(button.dataset.piece);
    });
}

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'r') {
        e.preventDefault();
        startGame();
    } else if (key === 'u') {
        e.preventDefault();
        undo();
    } else if (e.key === ' ' && (state === 'ready' || state === 'over')) {
        e.preventDefault();
        startGame();
    }
});

// ---------------------------------------------------------------------------
// HUD, overlays and the move list
// ---------------------------------------------------------------------------

function showOverlay(title, sub) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function showPromotion() {
    promotionEl.classList.add('visible');
}

function hidePromotion() {
    promotionEl.classList.remove('visible');
}

function statusText() {
    if (state === 'over') {
        if (result === '1-0') return 'Checkmate — you win';
        if (result === '0-1') return 'Checkmate — engine wins';
        return 'Draw';
    }
    if (state === 'promoting') return 'Choose a piece';
    const checked = inCheck(pos, pos.turn);
    if (pos.turn === HUMAN) return checked ? 'Check! Your move' : 'Your move';
    return checked ? 'Engine is in check' : 'Engine thinking…';
}

function updateHud() {
    statusEl.textContent = statusText();
    renderCaptured();
}

function countPieces(board) {
    const counts = {};
    for (const row of board)
        for (const ch of row) if (ch) counts[ch] = (counts[ch] || 0) + 1;
    return counts;
}

// Pieces missing from the board, compared with the position the game began in.
function renderCaptured() {
    const start = countPieces(loadFen(startFen).board);
    const now = countPieces(pos.board);
    const lost = { w: [], b: [] };
    for (const ch of Object.keys(start)) {
        const gone = (start[ch] || 0) - (now[ch] || 0);
        for (let i = 0; i < gone; i++) lost[pieceColor(ch)].push(GLYPH[ch.toLowerCase()]);
    }
    capturedByWhiteEl.textContent = lost.b.join(' ');
    capturedByBlackEl.textContent = lost.w.join(' ');
}

function renderMoveList() {
    moveListEl.innerHTML = '';
    const first = loadFen(startFen);
    const offset = first.turn === 'b' ? 1 : 0;
    const plies = moveHistory.map((h) => h.san);
    if (offset && plies.length) plies.unshift('…');
    for (let i = 0; i < plies.length; i += 2) {
        const li = document.createElement('li');
        const white = document.createElement('span');
        white.className = 'ply';
        white.textContent = plies[i];
        li.appendChild(white);
        if (plies[i + 1] !== undefined) {
            const black = document.createElement('span');
            black.className = 'ply ply-black';
            black.textContent = plies[i + 1];
            li.appendChild(black);
        }
        moveListEl.appendChild(li);
    }
    moveListEl.scrollTop = moveListEl.scrollHeight;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fillSquare(r, c, color) {
    ctx.fillStyle = color;
    ctx.fillRect(c * SQUARE, r * SQUARE, SQUARE, SQUARE);
}

function drawPiece(r, c, ch) {
    const { x, y } = squareCentre(r, c);
    const white = pieceColor(ch) === 'w';
    ctx.font = `${Math.round(SQUARE * 0.76)}px "Segoe UI Symbol", "DejaVu Sans", "Noto Sans Symbols 2", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.fillStyle = white ? CLR.white : CLR.black;
    ctx.strokeStyle = white ? CLR.whiteEdge : CLR.blackEdge;
    const glyph = GLYPH[ch.toLowerCase()];
    ctx.fillText(glyph, x, y + 2);
    ctx.strokeText(glyph, x, y + 2);
}

function render() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            fillSquare(r, c, (r + c) % 2 === 0 ? CLR.light : CLR.dark);
        }
    }

    if (lastMove) {
        fillSquare(lastMove.from[0], lastMove.from[1], CLR.last);
        fillSquare(lastMove.to[0], lastMove.to[1], CLR.last);
    }

    if (state !== 'ready') {
        for (const color of ['w', 'b']) {
            if (!inCheck(pos, color)) continue;
            const sq = findKing(pos, color);
            if (sq) fillSquare(sq[0], sq[1], CLR.check);
        }
    }

    if (selected) fillSquare(selected[0], selected[1], CLR.select);

    // Coordinates along the bottom and left edges.
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    for (let c = 0; c < COLS; c++) {
        ctx.textAlign = 'right';
        ctx.fillStyle = (7 + c) % 2 === 0 ? CLR.coord : CLR.coordLight;
        ctx.fillText(squareName(7, c)[0], (c + 1) * SQUARE - 5, ROWS * SQUARE - 5);
    }
    for (let r = 0; r < ROWS; r++) {
        ctx.textAlign = 'left';
        ctx.fillStyle = r % 2 === 0 ? CLR.coord : CLR.coordLight;
        ctx.fillText(String(8 - r), 5, r * SQUARE + 16);
    }

    for (const [tr, tc] of legalTargets()) {
        const { x, y } = squareCentre(tr, tc);
        ctx.beginPath();
        if (pos.board[tr][tc]) {
            ctx.lineWidth = 5;
            ctx.strokeStyle = CLR.target;
            ctx.arc(x, y, SQUARE * 0.42, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.fillStyle = CLR.target;
            ctx.arc(x, y, SQUARE * 0.14, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const ch = pos.board[r][c];
            if (ch) drawPiece(r, c, ch);
        }
    }

    requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
    pos = loadFen(START_FEN);
    startFen = START_FEN;
    state = 'ready';
    updateHud();
    renderMoveList();
    requestAnimationFrame(render);
}

init();
