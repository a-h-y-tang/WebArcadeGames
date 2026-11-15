// ---------------------------------------------------------------------------
// Chess — the whole standard game against a computer opponent.
//
// Written as one classic (non-module) script so the rule functions, the search
// and the board state are all reachable from the Playwright suite as plain
// globals, the same arrangement the other games in this repo use.
//
// Squares are numbered 0-63 from a8 to h1 — the order a FEN writes them, and
// the order the board is drawn in with white at the bottom:
//
//        a  b  c  d  e  f  g  h
//     8  0  1  2  3  4  5  6  7
//     7  8  9 10 11 12 13 14 15
//     ...
//     1 56 57 58 59 60 61 62 63
//
// Pieces are single characters: upper case for white, lower case for black,
// '' for an empty square. A position is a plain object and every function that
// takes one treats it as read-only; `makeMove` returns a new one.
// ---------------------------------------------------------------------------

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';

// Where the kings and rooks start, as square numbers.
const E1 = 60, H1 = 63, A1 = 56, E8 = 4, H8 = 7, A8 = 0;

// ---------------------------------------------------------------------------
// Squares
// ---------------------------------------------------------------------------

// 0 for file a, 7 for file h.
function fileOf(sq) {
    return sq & 7;
}

// The row the square sits in, counted from the top: 0 is rank 8, 7 is rank 1.
function rankOf(sq) {
    return sq >> 3;
}

function squareAt(row, col) {
    return row * 8 + col;
}

function onBoard(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function squareName(sq) {
    if (sq < 0 || sq > 63) return '-';
    return FILES[fileOf(sq)] + (8 - rankOf(sq));
}

function squareOf(name) {
    return (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function colorOf(piece) {
    if (!piece) return '';
    return piece === piece.toUpperCase() ? 'w' : 'b';
}

function kindOf(piece) {
    return piece ? piece.toLowerCase() : '';
}

function other(color) {
    return color === 'w' ? 'b' : 'w';
}

// A piece of `kind` in `color`'s case, e.g. ('q', 'b') -> 'q'.
function pieceFor(kind, color) {
    return color === 'w' ? kind.toUpperCase() : kind.toLowerCase();
}

// ---------------------------------------------------------------------------
// FEN
// ---------------------------------------------------------------------------

function parseFEN(fen) {
    const parts = fen.trim().split(/\s+/);
    const board = new Array(64).fill('');
    let sq = 0;
    for (const ch of parts[0]) {
        if (ch === '/') continue;
        if (ch >= '1' && ch <= '8') sq += Number(ch);
        else board[sq++] = ch;
    }
    const rights = parts[2] || '-';
    return {
        board,
        turn: parts[1] === 'b' ? 'b' : 'w',
        castling: {
            wK: rights.includes('K'),
            wQ: rights.includes('Q'),
            bK: rights.includes('k'),
            bQ: rights.includes('q'),
        },
        ep: parts[3] && parts[3] !== '-' ? squareOf(parts[3]) : -1,
        halfmove: parts[4] !== undefined ? Number(parts[4]) : 0,
        fullmove: parts[5] !== undefined ? Number(parts[5]) : 1,
    };
}

function toFEN(pos) {
    let rows = [];
    for (let row = 0; row < 8; row++) {
        let line = '';
        let empty = 0;
        for (let col = 0; col < 8; col++) {
            const piece = pos.board[squareAt(row, col)];
            if (piece) {
                if (empty) { line += empty; empty = 0; }
                line += piece;
            } else empty++;
        }
        if (empty) line += empty;
        rows.push(line);
    }
    const c = pos.castling;
    const rights = (c.wK ? 'K' : '') + (c.wQ ? 'Q' : '') + (c.bK ? 'k' : '') + (c.bQ ? 'q' : '');
    return [
        rows.join('/'),
        pos.turn,
        rights || '-',
        pos.ep >= 0 ? squareName(pos.ep) : '-',
        pos.halfmove,
        pos.fullmove,
    ].join(' ');
}

// The part of a FEN that decides whether two positions are "the same" for the
// repetition rule: everything except the two counters.
function positionKey(pos) {
    return toFEN(pos).split(' ').slice(0, 4).join(' ');
}

// ---------------------------------------------------------------------------
// Move geometry
// ---------------------------------------------------------------------------

const KNIGHT_STEPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const QUEEN_DIRS = ROOK_DIRS.concat(BISHOP_DIRS);

function makeMoveRecord(pos, from, to, flags, promo, capturedSq) {
    const captureSq = capturedSq === undefined ? to : capturedSq;
    return {
        from,
        to,
        piece: pos.board[from],
        captured: pos.board[captureSq] || '',
        promo: promo || null,
        flags: flags || [],
    };
}

// Every move the pieces' geometry allows, without asking whether the mover's
// own king is left in check. `generateMoves` filters these.
function generatePseudoMoves(pos) {
    const moves = [];
    const me = pos.turn;
    for (let sq = 0; sq < 64; sq++) {
        const piece = pos.board[sq];
        if (!piece || colorOf(piece) !== me) continue;
        const kind = kindOf(piece);
        if (kind === 'p') pawnMoves(pos, sq, moves);
        else if (kind === 'n') stepMoves(pos, sq, KNIGHT_STEPS, moves);
        else if (kind === 'k') {
            stepMoves(pos, sq, KING_STEPS, moves);
            castleMoves(pos, sq, moves);
        } else {
            slideMoves(pos, sq, kind === 'r' ? ROOK_DIRS : kind === 'b' ? BISHOP_DIRS : QUEEN_DIRS, moves);
        }
    }
    return moves;
}

function stepMoves(pos, from, steps, moves) {
    const me = pos.turn;
    const row = rankOf(from), col = fileOf(from);
    for (const [dr, dc] of steps) {
        const r = row + dr, c = col + dc;
        if (!onBoard(r, c)) continue;
        const to = squareAt(r, c);
        const target = pos.board[to];
        if (target && colorOf(target) === me) continue;
        moves.push(makeMoveRecord(pos, from, to, target ? ['capture'] : [], null));
    }
}

function slideMoves(pos, from, dirs, moves) {
    const me = pos.turn;
    const row = rankOf(from), col = fileOf(from);
    for (const [dr, dc] of dirs) {
        let r = row + dr, c = col + dc;
        while (onBoard(r, c)) {
            const to = squareAt(r, c);
            const target = pos.board[to];
            if (target && colorOf(target) === me) break;
            moves.push(makeMoveRecord(pos, from, to, target ? ['capture'] : [], null));
            if (target) break;
            r += dr;
            c += dc;
        }
    }
}

const PROMOTION_PIECES = ['q', 'r', 'b', 'n'];

function pawnMoves(pos, from, moves) {
    const me = pos.turn;
    const dir = me === 'w' ? -1 : 1;          // rows count down toward rank 8
    const homeRow = me === 'w' ? 6 : 1;
    const lastRow = me === 'w' ? 0 : 7;
    const row = rankOf(from), col = fileOf(from);

    const oneRow = row + dir;
    if (onBoard(oneRow, col)) {
        const one = squareAt(oneRow, col);
        if (!pos.board[one]) {
            if (oneRow === lastRow) {
                for (const promo of PROMOTION_PIECES) {
                    moves.push(makeMoveRecord(pos, from, one, ['promo'], promo));
                }
            } else {
                moves.push(makeMoveRecord(pos, from, one, [], null));
                if (row === homeRow) {
                    const two = squareAt(row + dir * 2, col);
                    if (!pos.board[two]) moves.push(makeMoveRecord(pos, from, two, ['double'], null));
                }
            }
        }
    }

    for (const dc of [-1, 1]) {
        const r = row + dir, c = col + dc;
        if (!onBoard(r, c)) continue;
        const to = squareAt(r, c);
        const target = pos.board[to];
        if (target && colorOf(target) !== me) {
            if (r === lastRow) {
                for (const promo of PROMOTION_PIECES) {
                    moves.push(makeMoveRecord(pos, from, to, ['capture', 'promo'], promo));
                }
            } else {
                moves.push(makeMoveRecord(pos, from, to, ['capture'], null));
            }
        } else if (!target && to === pos.ep) {
            const grabbed = squareAt(row, c);   // the pawn that ran past, beside us
            moves.push(makeMoveRecord(pos, from, to, ['capture', 'ep'], null, grabbed));
        }
    }
}

// Castling is offered only when the right is still held, the rook is really
// there, the squares between are empty, and the king is not in check on its
// start, pass-through or landing square.
function castleMoves(pos, kingSq, moves) {
    const me = pos.turn;
    const them = other(me);
    if (me === 'w' ? kingSq !== E1 : kingSq !== E8) return;
    const rights = pos.castling;
    const rook = pieceFor('r', me);
    const home = me === 'w' ? E1 : E8;

    const kingSide = me === 'w' ? rights.wK : rights.bK;
    if (kingSide && pos.board[home + 3] === rook && !pos.board[home + 1] && !pos.board[home + 2]) {
        if (!isSquareAttacked(pos, home, them) &&
            !isSquareAttacked(pos, home + 1, them) &&
            !isSquareAttacked(pos, home + 2, them)) {
            moves.push(makeMoveRecord(pos, home, home + 2, ['castle-k'], null));
        }
    }

    const queenSide = me === 'w' ? rights.wQ : rights.bQ;
    if (queenSide && pos.board[home - 4] === rook &&
        !pos.board[home - 1] && !pos.board[home - 2] && !pos.board[home - 3]) {
        if (!isSquareAttacked(pos, home, them) &&
            !isSquareAttacked(pos, home - 1, them) &&
            !isSquareAttacked(pos, home - 2, them)) {
            moves.push(makeMoveRecord(pos, home, home - 2, ['castle-q'], null));
        }
    }
}

// ---------------------------------------------------------------------------
// Attacks and check
// ---------------------------------------------------------------------------

// Asked from the square outwards rather than by generating the attacker's
// moves, so it can be used inside the legality filter without recursion.
function isBoardSquareAttacked(board, sq, by) {
    const row = rankOf(sq), col = fileOf(sq);

    const knight = pieceFor('n', by);
    for (const [dr, dc] of KNIGHT_STEPS) {
        const r = row + dr, c = col + dc;
        if (onBoard(r, c) && board[squareAt(r, c)] === knight) return true;
    }

    const king = pieceFor('k', by);
    for (const [dr, dc] of KING_STEPS) {
        const r = row + dr, c = col + dc;
        if (onBoard(r, c) && board[squareAt(r, c)] === king) return true;
    }

    // A white pawn captures upward, so it stands one row below the square.
    const pawn = pieceFor('p', by);
    const pawnRow = by === 'w' ? row + 1 : row - 1;
    for (const dc of [-1, 1]) {
        const c = col + dc;
        if (onBoard(pawnRow, c) && board[squareAt(pawnRow, c)] === pawn) return true;
    }

    const rook = pieceFor('r', by), queen = pieceFor('q', by), bishop = pieceFor('b', by);
    for (const [dr, dc] of ROOK_DIRS) {
        let r = row + dr, c = col + dc;
        while (onBoard(r, c)) {
            const piece = board[squareAt(r, c)];
            if (piece) {
                if (piece === rook || piece === queen) return true;
                break;
            }
            r += dr;
            c += dc;
        }
    }
    for (const [dr, dc] of BISHOP_DIRS) {
        let r = row + dr, c = col + dc;
        while (onBoard(r, c)) {
            const piece = board[squareAt(r, c)];
            if (piece) {
                if (piece === bishop || piece === queen) return true;
                break;
            }
            r += dr;
            c += dc;
        }
    }
    return false;
}

function isSquareAttacked(pos, sq, by) {
    return isBoardSquareAttacked(pos.board, sq, by);
}

function findKing(board, color) {
    const king = pieceFor('k', color);
    for (let sq = 0; sq < 64; sq++) if (board[sq] === king) return sq;
    return -1;
}

function inCheck(pos, color) {
    const king = findKing(pos.board, color);
    return king >= 0 && isBoardSquareAttacked(pos.board, king, other(color));
}

// ---------------------------------------------------------------------------
// Legal moves
// ---------------------------------------------------------------------------

// Pseudo-legal moves minus the ones that leave the mover's own king attacked.
// That one filter also handles pins, discovered checks and the duty to answer
// a check, so none of those needs its own rule.
//
// The move is tried on the real board and taken straight back off again, which
// keeps this allocation-free — it runs tens of millions of times in a search.
function generateMoves(pos) {
    const board = pos.board;
    const me = pos.turn;
    const them = other(me);
    const myKing = findKing(board, me);
    const legal = [];

    for (const move of generatePseudoMoves(pos)) {
        const captureSq = move.flags.includes('ep')
            ? squareAt(rankOf(move.from), fileOf(move.to))
            : move.to;
        const moved = board[move.from];
        const taken = board[captureSq];

        board[move.from] = '';
        board[captureSq] = '';
        board[move.to] = move.promo ? pieceFor(move.promo, me) : moved;

        const kingSq = kindOf(moved) === 'k' ? move.to : myKing;
        const safe = kingSq < 0 || !isBoardSquareAttacked(board, kingSq, them);

        board[move.from] = moved;
        board[move.to] = move.to === captureSq ? taken : '';
        board[captureSq] = taken;

        if (safe) legal.push(move);
    }
    return legal;
}

// Returns a new position; `pos` is left exactly as it was.
function makeMove(pos, move) {
    const board = pos.board.slice();
    const me = pos.turn;
    const piece = board[move.from];
    const kind = kindOf(piece);

    board[move.from] = '';
    if (move.flags.includes('ep')) board[squareAt(rankOf(move.from), fileOf(move.to))] = '';
    board[move.to] = move.promo ? pieceFor(move.promo, me) : piece;

    if (move.flags.includes('castle-k')) {
        board[move.to + 1] = '';
        board[move.to - 1] = pieceFor('r', me);
    } else if (move.flags.includes('castle-q')) {
        board[move.to - 2] = '';
        board[move.to + 1] = pieceFor('r', me);
    }

    const castling = {
        wK: pos.castling.wK, wQ: pos.castling.wQ,
        bK: pos.castling.bK, bQ: pos.castling.bQ,
    };
    if (kind === 'k') {
        if (me === 'w') { castling.wK = false; castling.wQ = false; }
        else { castling.bK = false; castling.bQ = false; }
    }
    // A rook that leaves its corner, or is taken on it, ends that right.
    if (move.from === H1 || move.to === H1) castling.wK = false;
    if (move.from === A1 || move.to === A1) castling.wQ = false;
    if (move.from === H8 || move.to === H8) castling.bK = false;
    if (move.from === A8 || move.to === A8) castling.bQ = false;

    return {
        board,
        turn: other(me),
        castling,
        ep: move.flags.includes('double') ? (move.from + move.to) / 2 : -1,
        halfmove: kind === 'p' || move.captured ? 0 : pos.halfmove + 1,
        fullmove: me === 'b' ? pos.fullmove + 1 : pos.fullmove,
    };
}

// Move-path count: the standard way to check a move generator.
function perft(pos, depth) {
    if (depth === 0) return 1;
    const moves = generateMoves(pos);
    if (depth === 1) return moves.length;
    let nodes = 0;
    for (const move of moves) nodes += perft(makeMove(pos, move), depth - 1);
    return nodes;
}

// ---------------------------------------------------------------------------
// How a game ends
// ---------------------------------------------------------------------------

// The dead positions that actually come up in play: bare kings, king and one
// minor piece, and bishops of the same colour square.
function insufficientMaterial(pos) {
    const minors = [];
    for (let sq = 0; sq < 64; sq++) {
        const kind = kindOf(pos.board[sq]);
        if (!kind || kind === 'k') continue;
        if (kind === 'p' || kind === 'r' || kind === 'q') return false;
        minors.push({ sq, piece: pos.board[sq] });
    }
    if (minors.length === 0) return true;
    if (minors.length === 1) return true;
    if (minors.length === 2) {
        const [a, b] = minors;
        const bothBishops = kindOf(a.piece) === 'b' && kindOf(b.piece) === 'b';
        const sameShade = (rankOf(a.sq) + fileOf(a.sq)) % 2 === (rankOf(b.sq) + fileOf(b.sq)) % 2;
        return bothBishops && colorOf(a.piece) !== colorOf(b.piece) && sameShade;
    }
    return false;
}

// How many times the position in hand has appeared, given the keys of every
// position in the game so far (see `historyFens`).
function repetitionCount(keys) {
    if (!keys || !keys.length) return 0;
    const last = keys[keys.length - 1];
    let seen = 0;
    for (const key of keys) if (key === last) seen++;
    return seen;
}

function gameStatus(pos, keys) {
    if (generateMoves(pos).length === 0) {
        return inCheck(pos, pos.turn) ? 'checkmate' : 'stalemate';
    }
    if (pos.halfmove >= 100) return 'draw-fifty';
    if (insufficientMaterial(pos)) return 'draw-material';
    if (repetitionCount(keys) >= 3) return 'draw-repetition';
    return 'playing';
}

// ---------------------------------------------------------------------------
// Notation
// ---------------------------------------------------------------------------

function moveToSAN(pos, move) {
    let text;
    if (move.flags.includes('castle-k')) text = 'O-O';
    else if (move.flags.includes('castle-q')) text = 'O-O-O';
    else {
        const kind = kindOf(move.piece);
        const to = squareName(move.to);
        if (kind === 'p') {
            text = move.captured ? FILES[fileOf(move.from)] + 'x' + to : to;
            if (move.promo) text += '=' + move.promo.toUpperCase();
        } else {
            // Only name the starting square as far as it takes to tell this
            // piece apart from the others that could go there.
            const rivals = generateMoves(pos).filter(
                (m) => m.to === move.to && m.from !== move.from && m.piece === move.piece
            );
            let from = '';
            if (rivals.length) {
                const sameFile = rivals.some((m) => fileOf(m.from) === fileOf(move.from));
                const sameRank = rivals.some((m) => rankOf(m.from) === rankOf(move.from));
                if (!sameFile) from = FILES[fileOf(move.from)];
                else if (!sameRank) from = String(8 - rankOf(move.from));
                else from = squareName(move.from);
            }
            text = kind.toUpperCase() + from + (move.captured ? 'x' : '') + to;
        }
    }
    const after = makeMove(pos, move);
    if (generateMoves(after).length === 0 && inCheck(after, after.turn)) text += '#';
    else if (inCheck(after, after.turn)) text += '+';
    return text;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables, written from white's point of view with rank 8 first —
// the same order the board array uses. Black reads them flipped.
const TABLES = {
    p: [
        0, 0, 0, 0, 0, 0, 0, 0,
        50, 50, 50, 50, 50, 50, 50, 50,
        10, 10, 20, 30, 30, 20, 10, 10,
        5, 5, 10, 25, 25, 10, 5, 5,
        0, 0, 0, 20, 20, 0, 0, 0,
        5, -5, -10, 0, 0, -10, -5, 5,
        5, 10, 10, -20, -20, 10, 10, 5,
        0, 0, 0, 0, 0, 0, 0, 0,
    ],
    n: [
        -50, -40, -30, -30, -30, -30, -40, -50,
        -40, -20, 0, 0, 0, 0, -20, -40,
        -30, 0, 10, 15, 15, 10, 0, -30,
        -30, 5, 15, 20, 20, 15, 5, -30,
        -30, 0, 15, 20, 20, 15, 0, -30,
        -30, 5, 10, 15, 15, 10, 5, -30,
        -40, -20, 0, 5, 5, 0, -20, -40,
        -50, -40, -30, -30, -30, -30, -40, -50,
    ],
    b: [
        -20, -10, -10, -10, -10, -10, -10, -20,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -10, 0, 5, 10, 10, 5, 0, -10,
        -10, 5, 5, 10, 10, 5, 5, -10,
        -10, 0, 10, 10, 10, 10, 0, -10,
        -10, 10, 10, 10, 10, 10, 10, -10,
        -10, 5, 0, 0, 0, 0, 5, -10,
        -20, -10, -10, -10, -10, -10, -10, -20,
    ],
    r: [
        0, 0, 0, 0, 0, 0, 0, 0,
        5, 10, 10, 10, 10, 10, 10, 5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        0, 0, 0, 5, 5, 0, 0, 0,
    ],
    q: [
        -20, -10, -10, -5, -5, -10, -10, -20,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -10, 0, 5, 5, 5, 5, 0, -10,
        -5, 0, 5, 5, 5, 5, 0, -5,
        0, 0, 5, 5, 5, 5, 0, -5,
        -10, 5, 5, 5, 5, 5, 0, -10,
        -10, 0, 5, 0, 0, 0, 0, -10,
        -20, -10, -10, -5, -5, -10, -10, -20,
    ],
    k: [
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -20, -30, -30, -40, -40, -30, -30, -20,
        -10, -20, -20, -20, -20, -20, -20, -10,
        20, 20, 0, 0, 0, 0, 20, 20,
        20, 30, 10, 0, 0, 10, 30, 20,
    ],
};

// With the queens and rooks gone the king should walk toward the middle
// instead of hiding, or an endgame never gets won.
const KING_ENDGAME = [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
];

// From the point of view of the side to move: positive means they are better.
function evaluate(pos) {
    let score = 0;
    let heavy = 0;
    for (const piece of pos.board) {
        const kind = kindOf(piece);
        if (kind === 'q' || kind === 'r') heavy += PIECE_VALUE[kind];
    }
    const endgame = heavy <= 1000;

    for (let sq = 0; sq < 64; sq++) {
        const piece = pos.board[sq];
        if (!piece) continue;
        const kind = kindOf(piece);
        const white = colorOf(piece) === 'w';
        const table = kind === 'k' && endgame ? KING_ENDGAME : TABLES[kind];
        const value = PIECE_VALUE[kind] + table[white ? sq : sq ^ 56];
        score += white ? value : -value;
    }
    return pos.turn === 'w' ? score : -score;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const MATE_SCORE = 10000;
const QUIESCENCE_LIMIT = 8;

// Captures first, biggest prize first, so alpha-beta has something to prune.
function orderMoves(moves) {
    return moves.slice().sort((a, b) => scoreForOrder(b) - scoreForOrder(a));
}

function scoreForOrder(move) {
    let score = 0;
    if (move.captured) score += 1000 + PIECE_VALUE[kindOf(move.captured)] - PIECE_VALUE[kindOf(move.piece)] / 10;
    if (move.promo) score += 800;
    return score;
}

// Only captures, so the evaluation is never taken in the middle of a trade.
function quiesce(pos, alpha, beta, ply) {
    const stand = evaluate(pos);
    if (ply >= QUIESCENCE_LIMIT) return stand;
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    for (const move of orderMoves(generateMoves(pos).filter((m) => m.captured))) {
        const score = -quiesce(makeMove(pos, move), -beta, -alpha, ply + 1);
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
    }
    return alpha;
}

function negamax(pos, depth, alpha, beta, ply) {
    const moves = generateMoves(pos);
    if (moves.length === 0) return inCheck(pos, pos.turn) ? -(MATE_SCORE - ply) : 0;
    if (pos.halfmove >= 100 || insufficientMaterial(pos)) return 0;
    if (depth <= 0) return quiesce(pos, alpha, beta, ply);

    let best = -Infinity;
    for (const move of orderMoves(moves)) {
        const score = -negamax(makeMove(pos, move), depth - 1, -beta, -alpha, ply + 1);
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    return best;
}

// The move the engine would play, with its score attached. With a `tolerance`
// above zero it picks at random from the moves that come within that many
// centipawns of the best, which is what keeps the gentle setting from playing
// the same game twice.
function searchBestMove(pos, depth, tolerance, random) {
    const moves = orderMoves(generateMoves(pos));
    if (!moves.length) return null;

    const scored = [];
    let alpha = -Infinity;
    for (const move of moves) {
        // With a tolerance every move needs a score that can be compared, so
        // the root window stays open; otherwise it narrows and prunes.
        const window = tolerance ? -Infinity : -alpha;
        const score = -negamax(makeMove(pos, move), depth - 1, -Infinity, window, 1);
        scored.push(Object.assign({}, move, { score }));
        if (score > alpha) alpha = score;
    }

    const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
    if (!tolerance) return best;
    const close = scored.filter((m) => m.score >= best.score - tolerance);
    const pick = random ? random() : Math.random();
    return close[Math.floor(pick * close.length) % close.length];
}

// ===========================================================================
// Everything below is the page: the board, the panel and the mouse.
// ===========================================================================

const DIFFICULTIES = [
    { id: 'gentle', name: 'Gentle', depth: 1, tolerance: 120 },
    { id: 'steady', name: 'Steady', depth: 3, tolerance: 0 },
    { id: 'sharp', name: 'Sharp', depth: 4, tolerance: 0 },
];
const DIFFICULTY_KEY = 'chess-difficulty';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const turnEl = document.getElementById('turn');
const statusEl = document.getElementById('status');
const moveListEl = document.getElementById('movelist');
const capturedWhiteEl = document.getElementById('captured-white');
const capturedBlackEl = document.getElementById('captured-black');
const overlayEl = document.getElementById('overlay');
const overlayTitleEl = document.getElementById('overlay-title');
const overlaySubEl = document.getElementById('overlay-sub');
const promotionEl = document.getElementById('promotion');
const opponentSelect = document.getElementById('opponent');
const difficultySelect = document.getElementById('difficulty');
const sideSelect = document.getElementById('side');

const SQUARE = canvas.width / 8;

// --- state the tests read --------------------------------------------------
let position = parseFEN(START_FEN);
let history = [];            // { before, move, san } per ply played
let selected = -1;           // square the player has picked up, or -1
let legalTargets = [];       // squares that selection may go to
let lastMove = null;         // for the highlight
let pendingPromotion = null; // { from, to } while the chooser is open
let gameState = 'playing';   // 'playing' | 'over'
let thinking = false;        // the computer is on the clock
let playerColor = 'w';       // the colour the human has
let flipped = false;         // black at the bottom
let opponent = 'computer';   // 'computer' | 'human'
let difficulty = DIFFICULTIES[1];
let captured = { w: [], b: [] };  // pieces each colour has taken
let thinkToken = 0;          // cancels a think that is no longer wanted

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const LIGHT = '#f2e0c0';
const DARK = '#b07f52';
const LIGHT_LABEL = 'rgba(80, 52, 28, 0.55)';
const DARK_LABEL = 'rgba(248, 236, 216, 0.6)';
const WHITE_FILL = '#fdfaf4';
const BLACK_FILL = '#2d2a28';
const OUTLINE = '#1d1a18';

// Where a square's centre sits on the canvas, whichever way the board faces.
function squareCentre(sq) {
    const row = flipped ? 7 - rankOf(sq) : rankOf(sq);
    const col = flipped ? 7 - fileOf(sq) : fileOf(sq);
    return { x: col * SQUARE + SQUARE / 2, y: row * SQUARE + SQUARE / 2 };
}

function squareFromPoint(x, y) {
    let col = Math.floor(x / SQUARE);
    let row = Math.floor(y / SQUARE);
    if (row < 0 || row > 7 || col < 0 || col > 7) return -1;
    if (flipped) { row = 7 - row; col = 7 - col; }
    return squareAt(row, col);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const checkedKing = checkedKingSquare();

    for (let sq = 0; sq < 64; sq++) {
        const { x, y } = squareCentre(sq);
        const left = x - SQUARE / 2, top = y - SQUARE / 2;
        const light = (rankOf(sq) + fileOf(sq)) % 2 === 0;
        ctx.fillStyle = light ? LIGHT : DARK;
        ctx.fillRect(left, top, SQUARE, SQUARE);

        if (lastMove && (sq === lastMove.from || sq === lastMove.to)) {
            ctx.fillStyle = 'rgba(246, 224, 94, 0.45)';
            ctx.fillRect(left, top, SQUARE, SQUARE);
        }
        if (sq === selected) {
            ctx.fillStyle = 'rgba(120, 180, 90, 0.5)';
            ctx.fillRect(left, top, SQUARE, SQUARE);
        }
        if (sq === checkedKing) {
            const glow = ctx.createRadialGradient(x, y, 4, x, y, SQUARE * 0.6);
            glow.addColorStop(0, 'rgba(214, 60, 48, 0.85)');
            glow.addColorStop(1, 'rgba(214, 60, 48, 0)');
            ctx.fillStyle = glow;
            ctx.fillRect(left, top, SQUARE, SQUARE);
        }

        // File letters along the bottom, rank numbers down the left.
        const row = flipped ? 7 - rankOf(sq) : rankOf(sq);
        const col = flipped ? 7 - fileOf(sq) : fileOf(sq);
        ctx.fillStyle = light ? LIGHT_LABEL : DARK_LABEL;
        ctx.font = '600 11px system-ui, sans-serif';
        if (row === 7) {
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(FILES[fileOf(sq)], left + SQUARE - 4, top + SQUARE - 3);
        }
        if (col === 0) {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(String(8 - rankOf(sq)), left + 4, top + 3);
        }
    }

    for (const target of legalTargets) {
        const { x, y } = squareCentre(target);
        const taking = !!position.board[target];
        ctx.strokeStyle = 'rgba(40, 60, 30, 0.45)';
        ctx.fillStyle = 'rgba(40, 60, 30, 0.3)';
        ctx.beginPath();
        if (taking) {
            ctx.lineWidth = 4;
            ctx.arc(x, y, SQUARE * 0.42, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.arc(x, y, SQUARE * 0.13, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    for (let sq = 0; sq < 64; sq++) {
        const piece = position.board[sq];
        if (piece) drawPiece(piece, squareCentre(sq));
    }
}

// The square of a king that is in check, or -1.
function checkedKingSquare() {
    for (const color of ['w', 'b']) {
        if (inCheck(position, color)) return findKing(position.board, color);
    }
    return -1;
}

// Pieces are drawn as paths rather than letters or Unicode glyphs, so they
// look the same in every browser and at any size.
function drawPiece(piece, centre) {
    const white = colorOf(piece) === 'w';
    const unit = SQUARE / 100;
    ctx.save();
    ctx.translate(centre.x, centre.y);
    ctx.scale(unit, unit);
    ctx.fillStyle = white ? WHITE_FILL : BLACK_FILL;
    ctx.strokeStyle = white ? OUTLINE : '#0f0d0c';
    ctx.lineWidth = 3.2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    switch (kindOf(piece)) {
        case 'p': drawPawn(); break;
        case 'r': drawRook(); break;
        case 'n': drawKnight(white); break;
        case 'b': drawBishop(); break;
        case 'q': drawQueen(); break;
        default: drawKing(); break;
    }
    ctx.restore();
}

function base(halfWidth, top) {
    ctx.beginPath();
    ctx.moveTo(-halfWidth, 34);
    ctx.lineTo(halfWidth, 34);
    ctx.lineTo(halfWidth * 0.78, top);
    ctx.lineTo(-halfWidth * 0.78, top);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

function drawPawn() {
    base(22, 22);
    ctx.beginPath();
    ctx.moveTo(-15, 22);
    ctx.quadraticCurveTo(-8, 2, -7, -6);
    ctx.lineTo(7, -6);
    ctx.quadraticCurveTo(8, 2, 15, 22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -17, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
}

function drawRook() {
    base(26, 24);
    ctx.beginPath();
    ctx.moveTo(-17, 24);
    ctx.lineTo(-13, -10);
    ctx.lineTo(13, -10);
    ctx.lineTo(17, 24);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Crenellated top: three merlons with two gaps.
    ctx.beginPath();
    ctx.moveTo(-24, -10);
    ctx.lineTo(-24, -30);
    ctx.lineTo(-14, -30);
    ctx.lineTo(-14, -22);
    ctx.lineTo(-5, -22);
    ctx.lineTo(-5, -30);
    ctx.lineTo(5, -30);
    ctx.lineTo(5, -22);
    ctx.lineTo(14, -22);
    ctx.lineTo(14, -30);
    ctx.lineTo(24, -30);
    ctx.lineTo(24, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

function drawKnight(white) {
    base(24, 26);
    ctx.beginPath();
    ctx.moveTo(-16, 26);
    ctx.quadraticCurveTo(-20, 4, -6, -8);
    ctx.quadraticCurveTo(-14, -10, -18, -4);
    ctx.quadraticCurveTo(-26, -14, -12, -24);
    ctx.quadraticCurveTo(-6, -29, -4, -36);
    ctx.quadraticCurveTo(4, -30, 10, -30);
    ctx.quadraticCurveTo(26, -28, 24, -4);
    ctx.quadraticCurveTo(22, 14, 20, 26);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Eye and mane.
    ctx.fillStyle = white ? OUTLINE : '#cdbfae';
    ctx.beginPath();
    ctx.arc(2, -22, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-3, -33);
    ctx.quadraticCurveTo(8, -26, 12, -10);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = white ? 'rgba(29,26,24,0.45)' : 'rgba(205,191,174,0.5)';
    ctx.stroke();
}

function drawBishop() {
    base(24, 24);
    ctx.beginPath();
    ctx.moveTo(-14, 24);
    ctx.quadraticCurveTo(-10, 8, -4, 2);
    ctx.lineTo(4, 2);
    ctx.quadraticCurveTo(10, 8, 14, 24);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.quadraticCurveTo(17, -18, 13, 2);
    ctx.lineTo(-13, 2);
    ctx.quadraticCurveTo(-17, -18, 0, -34);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6, -20);
    ctx.lineTo(6, -12);
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -38, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
}

function drawQueen() {
    base(26, 26);
    ctx.beginPath();
    ctx.moveTo(-18, 26);
    ctx.quadraticCurveTo(-12, 6, -14, -8);
    ctx.lineTo(14, -8);
    ctx.quadraticCurveTo(12, 6, 18, 26);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Crown: five spikes, tallest in the middle, dipping in between.
    const SPIKES = [[-27, -36], [-14, -40], [0, -46], [14, -40], [27, -36]];
    ctx.beginPath();
    ctx.moveTo(-24, -8);
    ctx.lineTo(-27, -36);
    ctx.lineTo(-20, -18);
    ctx.lineTo(-14, -40);
    ctx.lineTo(-7, -18);
    ctx.lineTo(0, -46);
    ctx.lineTo(7, -18);
    ctx.lineTo(14, -40);
    ctx.lineTo(20, -18);
    ctx.lineTo(27, -36);
    ctx.lineTo(24, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (const [x, y] of SPIKES) {
        ctx.beginPath();
        ctx.arc(x, y, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
}

function drawKing() {
    base(26, 26);
    ctx.beginPath();
    ctx.moveTo(-18, 26);
    ctx.quadraticCurveTo(-12, 6, -15, -6);
    ctx.lineTo(15, -6);
    ctx.quadraticCurveTo(12, 6, 18, 26);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-24, -6);
    ctx.quadraticCurveTo(-26, -22, -10, -20);
    ctx.quadraticCurveTo(0, -19, 10, -20);
    ctx.quadraticCurveTo(26, -22, 24, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Cross on top.
    ctx.beginPath();
    ctx.moveTo(-4, -22);
    ctx.lineTo(-4, -32);
    ctx.lineTo(-12, -32);
    ctx.lineTo(-12, -40);
    ctx.lineTo(-4, -40);
    ctx.lineTo(-4, -48);
    ctx.lineTo(4, -48);
    ctx.lineTo(4, -40);
    ctx.lineTo(12, -40);
    ctx.lineTo(12, -32);
    ctx.lineTo(4, -32);
    ctx.lineTo(4, -22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

const GLYPHS = {
    P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔',
    p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
};

function renderMoveList() {
    const parts = [];
    const last = history.length - 1;
    history.forEach((entry, ply) => {
        if (ply % 2 === 0) parts.push('<span class="num">' + (ply / 2 + 1) + '.</span>');
        const current = ply === last ? ' current' : '';
        parts.push('<span class="ply' + current + '">' + entry.san + '</span>');
    });
    moveListEl.innerHTML = parts.join(' ');
    moveListEl.scrollTop = moveListEl.scrollHeight;
}

function renderCaptured() {
    capturedWhiteEl.textContent = captured.w.map((p) => GLYPHS[p]).join('');
    capturedBlackEl.textContent = captured.b.map((p) => GLYPHS[p]).join('');
}

const SIDE_NAME = { w: 'White', b: 'Black' };

const DRAW_REASON = {
    stalemate: 'Stalemate — no legal moves left',
    'draw-fifty': 'Fifty moves with no capture or pawn move',
    'draw-material': 'Not enough material left to mate',
    'draw-repetition': 'Threefold repetition of the position',
};

function updateStatus() {
    const status = gameStatus(position, historyFens());
    if (status === 'playing') {
        gameState = 'playing';
        overlayEl.classList.remove('visible');
        turnEl.textContent = SIDE_NAME[position.turn];
        if (thinking) statusEl.textContent = 'Thinking…';
        else if (inCheck(position, position.turn)) statusEl.textContent = SIDE_NAME[position.turn] + ' is in check';
        else if (opponent === 'computer') {
            statusEl.textContent = position.turn === playerColor ? 'Your move' : 'Thinking…';
        } else statusEl.textContent = SIDE_NAME[position.turn] + ' to move';
        return;
    }

    gameState = 'over';
    turnEl.textContent = '—';
    if (status === 'checkmate') {
        const winner = SIDE_NAME[other(position.turn)];
        overlayTitleEl.textContent = 'Checkmate';
        overlaySubEl.textContent = winner + ' wins';
        statusEl.textContent = 'Checkmate — ' + winner + ' wins';
    } else {
        overlayTitleEl.textContent = 'Draw';
        overlaySubEl.textContent = DRAW_REASON[status];
        statusEl.textContent = 'Draw — ' + DRAW_REASON[status];
    }
    overlayEl.classList.add('visible');
}

function render() {
    draw();
    renderMoveList();
    renderCaptured();
}

// The keys of every position this game has been in, current one last.
function historyFens() {
    const keys = history.map((entry) => positionKey(entry.before));
    keys.push(positionKey(position));
    return keys;
}

// ---------------------------------------------------------------------------
// Playing moves
// ---------------------------------------------------------------------------

function applyMove(move) {
    history.push({ before: position, move, san: moveToSAN(position, move) });
    if (move.captured) captured[position.turn].push(move.captured);
    position = makeMove(position, move);
    lastMove = move;
    selected = -1;
    legalTargets = [];
    pendingPromotion = null;
    hidePromotion();
    thinking = false;
    updateStatus();
    render();
    if (gameState === 'playing' && opponent === 'computer' && position.turn !== playerColor) {
        scheduleComputerMove();
    }
}

// Play from -> to if that is legal. A promotion with no piece named becomes a
// queen, which is what a player who has not been asked expects.
function tryMove(from, to, promo) {
    if (gameState !== 'playing') return false;
    const candidates = generateMoves(position).filter((m) => m.from === from && m.to === to);
    if (!candidates.length) return false;
    const move = candidates.length === 1
        ? candidates[0]
        : candidates.find((m) => m.promo === (promo || 'q'));
    if (!move) return false;
    applyMove(move);
    return true;
}

function scheduleComputerMove() {
    thinking = true;
    statusEl.textContent = 'Thinking…';
    const token = ++thinkToken;
    // A beat on the timer so the board repaints before the search blocks.
    setTimeout(() => {
        if (token === thinkToken) playComputerMove();
    }, 90);
}

// Search and play at once, cancelling any think already on the timer. The
// tests call this instead of waiting.
function playComputerMove() {
    thinkToken++;
    thinking = false;
    if (gameState !== 'playing') return false;
    const move = searchBestMove(position, difficulty.depth, difficulty.tolerance);
    if (!move) return false;
    applyMove(move);
    return true;
}

function undoMove() {
    thinkToken++;
    thinking = false;
    if (!history.length) return false;
    popPly();
    // Against the computer, roll back its reply as well so it is your turn.
    if (opponent === 'computer' && history.length && position.turn !== playerColor) popPly();
    selected = -1;
    legalTargets = [];
    pendingPromotion = null;
    hidePromotion();
    lastMove = history.length ? history[history.length - 1].move : null;
    updateStatus();
    render();
    if (gameState === 'playing' && opponent === 'computer' && position.turn !== playerColor) {
        scheduleComputerMove();
    }
    return true;
}

function popPly() {
    const entry = history.pop();
    if (entry.move.captured) captured[entry.before.turn].pop();
    position = entry.before;
}

// ---------------------------------------------------------------------------
// New games
// ---------------------------------------------------------------------------

function resetBoardState() {
    history = [];
    captured = { w: [], b: [] };
    selected = -1;
    legalTargets = [];
    lastMove = null;
    pendingPromotion = null;
    hidePromotion();
    thinking = false;
    thinkToken++;
    gameState = 'playing';
}

function newGame() {
    playerColor = sideSelect && sideSelect.value === 'black' ? 'b' : 'w';
    flipped = playerColor === 'b';
    position = parseFEN(START_FEN);
    resetBoardState();
    updateStatus();
    render();
    if (opponent === 'computer' && position.turn !== playerColor) scheduleComputerMove();
}

// Start from any position — used by the test suite, and handy for puzzles.
function loadPosition(fen) {
    position = parseFEN(fen);
    playerColor = position.turn;
    resetBoardState();
    updateStatus();
    render();
}

function setOpponent(value) {
    opponent = value === 'human' ? 'human' : 'computer';
    if (opponentSelect) opponentSelect.value = opponent;
    if (difficultySelect) difficultySelect.disabled = opponent === 'human';
    thinkToken++;
    thinking = false;
    updateStatus();
    if (gameState === 'playing' && opponent === 'computer' && position.turn !== playerColor) {
        scheduleComputerMove();
    }
}

function setDifficulty(id) {
    difficulty = DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];
    if (difficultySelect) difficultySelect.value = difficulty.id;
    try {
        window.localStorage.setItem(DIFFICULTY_KEY, difficulty.id);
    } catch (err) {
        /* private browsing: the setting simply is not remembered */
    }
}

function flipBoard() {
    flipped = !flipped;
    draw();
}

// ---------------------------------------------------------------------------
// Mouse and keyboard
// ---------------------------------------------------------------------------

function selectSquare(sq) {
    const piece = position.board[sq];
    if (piece && colorOf(piece) === position.turn) {
        selected = sq;
        legalTargets = generateMoves(position)
            .filter((m) => m.from === sq)
            .map((m) => m.to)
            .filter((to, i, all) => all.indexOf(to) === i);
    } else {
        selected = -1;
        legalTargets = [];
    }
}

function clickSquare(sq) {
    if (gameState !== 'playing' || pendingPromotion || sq < 0) return;
    if (opponent === 'computer' && position.turn !== playerColor) return;

    if (selected >= 0 && legalTargets.includes(sq)) {
        const promoting = generateMoves(position).some(
            (m) => m.from === selected && m.to === sq && m.promo
        );
        if (promoting) {
            pendingPromotion = { from: selected, to: sq };
            showPromotion();
            draw();
            return;
        }
        tryMove(selected, sq, null);
        return;
    }
    selectSquare(sq);
    draw();
}

function showPromotion() {
    promotionEl.classList.add('visible');
}

function hidePromotion() {
    if (promotionEl) promotionEl.classList.remove('visible');
}

function choosePromotion(piece) {
    if (!pendingPromotion) return false;
    const { from, to } = pendingPromotion;
    pendingPromotion = null;
    hidePromotion();
    return tryMove(from, to, piece);
}

function cancelPromotion() {
    pendingPromotion = null;
    hidePromotion();
    selected = -1;
    legalTargets = [];
    draw();
}

canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);
    clickSquare(squareFromPoint(x, y));
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        if (pendingPromotion) cancelPromotion();
        else {
            selected = -1;
            legalTargets = [];
            draw();
        }
    } else if (event.key === 'u' || event.key === 'U') {
        undoMove();
    }
});

document.getElementById('btn-new').addEventListener('click', newGame);
document.getElementById('btn-undo').addEventListener('click', undoMove);
document.getElementById('btn-flip').addEventListener('click', flipBoard);
document.querySelectorAll('.promo-btn').forEach((button) => {
    button.addEventListener('click', () => choosePromotion(button.dataset.piece));
});
if (opponentSelect) opponentSelect.addEventListener('change', () => setOpponent(opponentSelect.value));
if (difficultySelect) difficultySelect.addEventListener('change', () => setDifficulty(difficultySelect.value));
overlayEl.addEventListener('click', () => overlayEl.classList.remove('visible'));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

let savedDifficulty = null;
try {
    savedDifficulty = window.localStorage.getItem(DIFFICULTY_KEY);
} catch (err) {
    savedDifficulty = null;
}
setDifficulty(savedDifficulty || 'steady');
setOpponent(opponentSelect ? opponentSelect.value : 'computer');
newGame();
