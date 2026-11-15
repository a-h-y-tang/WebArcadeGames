const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// --- helpers ---------------------------------------------------------------

// Every legal move from one square, as sorted "to" square names. A promotion
// gets its piece letter appended, e.g. "a8q".
function movesFrom(page, fen, from) {
    return page.evaluate(([fen, from]) => {
        const pos = parseFEN(fen);
        return generateMoves(pos)
            .filter((m) => squareName(m.from) === from)
            .map((m) => squareName(m.to) + (m.promo || ''))
            .sort();
    }, [fen, from]);
}

// Every legal move in a position, as sorted "e2e4" strings.
function allMoves(page, fen) {
    return page.evaluate((fen) => {
        const pos = parseFEN(fen);
        return generateMoves(pos)
            .map((m) => squareName(m.from) + squareName(m.to) + (m.promo || ''))
            .sort();
    }, fen);
}

// Play a list of "e2e4" moves into the live game; hands back the FEN after.
function play(page, moves) {
    return page.evaluate((moves) => {
        for (const text of moves) {
            const from = squareOf(text.slice(0, 2));
            const to = squareOf(text.slice(2, 4));
            const promo = text[4] || null;
            if (!tryMove(from, to, promo)) throw new Error('illegal move in fixture: ' + text);
        }
        return toFEN(position);
    }, moves);
}

// Put the live game into a given position.
function setUp(page, fen) {
    return page.evaluate((fen) => loadPosition(fen), fen);
}

// The standard algebraic notation of one move in a position.
function san(page, fen, from, to, promo = null) {
    return page.evaluate(([fen, from, to, promo]) => {
        const pos = parseFEN(fen);
        const move = generateMoves(pos).find(
            (m) => squareName(m.from) === from && squareName(m.to) === to &&
                (promo ? m.promo === promo : !m.promo)
        );
        if (!move) throw new Error('no such legal move: ' + from + to + (promo || ''));
        return moveToSAN(pos, move);
    }, [fen, from, to, promo]);
}

test.describe('Chess', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // Rules, notation and interface tests drive both colours by hand, so the
        // board only changes when the test asks it to. The engine tests below
        // switch the computer back on for themselves.
        await page.evaluate(() => setOpponent('human'));
    });

    // =======================================================================
    // Page and starting state
    // =======================================================================
    test.describe('initial state', () => {
        test('page title is Chess', async ({ page }) => {
            await expect(page).toHaveTitle('Chess');
        });

        test('canvas is 480x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('board starts in the standard opening position', async ({ page }) => {
            expect(await page.evaluate(() => toFEN(position))).toBe(START_FEN);
        });

        test('white is to move and the status says so', async ({ page }) => {
            expect(await page.evaluate(() => position.turn)).toBe('w');
            await expect(page.locator('#turn')).toHaveText(/white/i);
        });

        test('game state is playing with an empty move list', async ({ page }) => {
            expect(await page.evaluate(() => gameState)).toBe('playing');
            expect(await page.evaluate(() => history.length)).toBe(0);
            await expect(page.locator('#movelist .ply')).toHaveCount(0);
        });

        test('no overlay and no promotion chooser on load', async ({ page }) => {
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#promotion')).not.toHaveClass(/visible/);
        });

        test('white has twenty legal first moves', async ({ page }) => {
            expect(await page.evaluate(() => generateMoves(position).length)).toBe(20);
        });

        test('the board is drawn on load', async ({ page }) => {
            expect(await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                return data.some((v, i) => i % 4 !== 3 && v !== 0);
            })).toBe(true);
        });
    });

    // =======================================================================
    // Squares and FEN
    // =======================================================================
    test.describe('squares and FEN', () => {
        test('square 0 is a8 and square 63 is h1', async ({ page }) => {
            expect(await page.evaluate(() => [squareName(0), squareName(63)])).toEqual(['a8', 'h1']);
        });

        test('squareOf is the inverse of squareName', async ({ page }) => {
            expect(await page.evaluate(() => {
                for (let sq = 0; sq < 64; sq++) if (squareOf(squareName(sq)) !== sq) return sq;
                return 'ok';
            })).toBe('ok');
        });

        test('files and ranks read off a square', async ({ page }) => {
            expect(await page.evaluate(() => {
                const e4 = squareOf('e4');
                return { file: fileOf(e4), rank: rankOf(e4), name: squareName(e4) };
            })).toEqual({ file: 4, rank: 4, name: 'e4' });
        });

        test('the starting board parses into the right pieces', async ({ page }) => {
            expect(await page.evaluate(() => {
                const pos = parseFEN(START_FEN);
                return ['e1', 'e8', 'd1', 'a8', 'e2', 'e7', 'e4'].map((s) => pos.board[squareOf(s)]);
            })).toEqual(['K', 'k', 'Q', 'r', 'P', 'p', '']);
        });

        test('FEN round-trips through the parser', async ({ page }) => {
            const fens = [
                START_FEN,
                'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
                'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3',
                '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 b - - 13 42',
            ];
            for (const fen of fens) {
                expect(await page.evaluate((f) => toFEN(parseFEN(f)), fen)).toBe(fen);
            }
        });

        test('castling rights and en passant square survive the round trip', async ({ page }) => {
            expect(await page.evaluate(() => {
                const pos = parseFEN('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w Kq f6 0 3');
                return {
                    castling: pos.castling,
                    ep: squareName(pos.ep),
                    halfmove: pos.halfmove,
                    fullmove: pos.fullmove,
                };
            })).toEqual({
                castling: { wK: true, wQ: false, bK: false, bQ: true },
                ep: 'f6',
                halfmove: 0,
                fullmove: 3,
            });
        });
    });

    // =======================================================================
    // How the pieces move
    // =======================================================================
    test.describe('piece movement', () => {
        test('a knight in the corner has two moves', async ({ page }) => {
            expect(await movesFrom(page, '4k3/8/8/8/8/8/8/N3K3 w - - 0 1', 'a1'))
                .toEqual(['b3', 'c2']);
        });

        test('a knight in the middle has eight moves', async ({ page }) => {
            expect(await movesFrom(page, '4k3/8/8/8/4N3/8/8/4K3 w - - 0 1', 'e4'))
                .toEqual(['c3', 'c5', 'd2', 'd6', 'f2', 'f6', 'g3', 'g5']);
        });

        test('a knight jumps over its own pieces', async ({ page }) => {
            expect(await movesFrom(page, START_FEN, 'g1')).toEqual(['f3', 'h3']);
        });

        test('a rook sweeps rank and file until it is blocked', async ({ page }) => {
            expect(await movesFrom(page, '4k3/8/8/8/3Rp3/8/8/4K3 w - - 0 1', 'd4'))
                .toEqual(['a4', 'b4', 'c4', 'd1', 'd2', 'd3', 'd5', 'd6', 'd7', 'd8', 'e4']);
        });

        test('a bishop sweeps the diagonals', async ({ page }) => {
            expect(await movesFrom(page, '4k3/8/8/8/8/2B5/8/6K1 w - - 0 1', 'c3'))
                .toEqual(['a1', 'a5', 'b2', 'b4', 'd2', 'd4', 'e1', 'e5', 'f6', 'g7', 'h8']);
        });

        test('a queen is exactly a rook plus a bishop', async ({ page }) => {
            const rook = await movesFrom(page, '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1');
            const bishop = await movesFrom(page, '4k3/8/8/8/8/8/8/B3K3 w - - 0 1', 'a1');
            const queen = await movesFrom(page, '4k3/8/8/8/8/8/8/Q3K3 w - - 0 1', 'a1');
            expect(queen).toEqual([...new Set([...rook, ...bishop])].sort());
        });

        test('a king steps one square in any direction', async ({ page }) => {
            expect(await movesFrom(page, '7k/8/8/8/4K3/8/8/8 w - - 0 1', 'e4'))
                .toEqual(['d3', 'd4', 'd5', 'e3', 'e5', 'f3', 'f4', 'f5']);
        });

        test('a king may not step next to the other king', async ({ page }) => {
            expect(await movesFrom(page, '8/8/8/3k4/8/3K4/8/8 w - - 0 1', 'd3'))
                .toEqual(['c2', 'c3', 'd2', 'e2', 'e3']);
        });

        test('a pawn pushes one square, or two from its home rank', async ({ page }) => {
            expect(await movesFrom(page, START_FEN, 'e2')).toEqual(['e3', 'e4']);
        });

        test('a pawn that has left home pushes only one square', async ({ page }) => {
            expect(await movesFrom(page, '4k3/8/8/8/8/4P3/8/4K3 w - - 0 1', 'e3')).toEqual(['e4']);
        });

        test('a pawn cannot push onto an occupied square', async ({ page }) => {
            expect(await movesFrom(page, '4k3/8/8/8/8/4p3/4P3/4K3 w - - 0 1', 'e2')).toEqual([]);
        });

        test('a pawn cannot jump a piece on its double push', async ({ page }) => {
            expect(await movesFrom(page, '4k3/4p3/8/4N3/8/8/8/4K3 b - - 0 1', 'e7')).toEqual(['e6']);
        });

        test('a pawn captures diagonally but not straight ahead', async ({ page }) => {
            expect(await movesFrom(page, '4k3/8/8/8/3p1p2/4P3/8/4K3 w - - 0 1', 'e3'))
                .toEqual(['d4', 'e4', 'f4']);
        });

        test('black pawns move down the board', async ({ page }) => {
            expect(await movesFrom(page, '4k3/4p3/8/8/8/8/8/4K3 b - - 0 1', 'e7')).toEqual(['e5', 'e6']);
        });
    });

    // =======================================================================
    // En passant
    // =======================================================================
    test.describe('en passant', () => {
        const EP_FEN = 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3';

        test('a double push sets the en passant square', async ({ page }) => {
            const fen = await play(page, ['e2e4', 'd7d5']);
            expect(fen.split(' ')[3]).toBe('d6');
        });

        test('a single push leaves no en passant square', async ({ page }) => {
            const fen = await play(page, ['e2e3']);
            expect(fen.split(' ')[3]).toBe('-');
        });

        test('the pawn beside it may capture en passant', async ({ page }) => {
            expect(await movesFrom(page, EP_FEN, 'e5')).toEqual(['e6', 'f6']);
        });

        test('capturing en passant removes the pawn that ran past', async ({ page }) => {
            expect(await page.evaluate((fen) => {
                const pos = parseFEN(fen);
                const move = generateMoves(pos).find((m) => m.flags.includes('ep'));
                const after = makeMove(pos, move);
                return {
                    to: squareName(move.to),
                    f6: after.board[squareOf('f6')],
                    f5: after.board[squareOf('f5')],
                    e5: after.board[squareOf('e5')],
                };
            }, EP_FEN)).toEqual({ to: 'f6', f6: 'P', f5: '', e5: '' });
        });

        test('the right to capture en passant lasts one move only', async ({ page }) => {
            const fen = await play(page, ['e2e4', 'd7d5', 'g1f3', 'g8f6']);
            expect(fen.split(' ')[3]).toBe('-');
            expect(await movesFrom(page, fen, 'e4')).toEqual(['d5', 'e5']);
        });

        test('en passant is refused when it would expose the king', async ({ page }) => {
            // White king e5, black rook h5: taking on g6 would open the rank.
            expect(await movesFrom(page, '8/8/8/4KPpr/8/8/8/4k3 w - g6 0 1', 'f5')).toEqual(['f6']);
        });
    });

    // =======================================================================
    // Castling
    // =======================================================================
    test.describe('castling', () => {
        const OPEN = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

        test('both castling moves are offered when nothing is in the way', async ({ page }) => {
            expect(await movesFrom(page, OPEN, 'e1'))
                .toEqual(['c1', 'd1', 'd2', 'e2', 'f1', 'f2', 'g1']);
        });

        test('castling king side puts the king on g1 and the rook on f1', async ({ page }) => {
            expect(await page.evaluate((fen) => {
                const pos = parseFEN(fen);
                const move = generateMoves(pos).find((m) => m.flags.includes('castle-k'));
                const after = makeMove(pos, move);
                return {
                    g1: after.board[squareOf('g1')],
                    f1: after.board[squareOf('f1')],
                    e1: after.board[squareOf('e1')],
                    h1: after.board[squareOf('h1')],
                    rights: after.castling,
                };
            }, OPEN)).toEqual({
                g1: 'K', f1: 'R', e1: '', h1: '',
                rights: { wK: false, wQ: false, bK: true, bQ: true },
            });
        });

        test('castling queen side puts the king on c1 and the rook on d1', async ({ page }) => {
            expect(await page.evaluate((fen) => {
                const pos = parseFEN(fen);
                const move = generateMoves(pos).find((m) => m.flags.includes('castle-q'));
                const after = makeMove(pos, move);
                return {
                    c1: after.board[squareOf('c1')],
                    d1: after.board[squareOf('d1')],
                    a1: after.board[squareOf('a1')],
                };
            }, OPEN)).toEqual({ c1: 'K', d1: 'R', a1: '' });
        });

        test('black castles the same way', async ({ page }) => {
            expect(await page.evaluate(() => {
                const pos = parseFEN('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
                const move = generateMoves(pos).find((m) => m.flags.includes('castle-q'));
                const after = makeMove(pos, move);
                return { c8: after.board[squareOf('c8')], d8: after.board[squareOf('d8')] };
            })).toEqual({ c8: 'k', d8: 'r' });
        });

        test('a piece in the way blocks castling on that side', async ({ page }) => {
            expect(await movesFrom(page, 'r3k2r/8/8/8/8/8/8/R2QK2R w KQkq - 0 1', 'e1'))
                .toEqual(['d2', 'e2', 'f1', 'f2', 'g1']);
        });

        test('castling rights alone are not enough without the rook', async ({ page }) => {
            expect(await movesFrom(page, 'r3k2r/8/8/8/8/8/8/R3K3 w KQkq - 0 1', 'e1'))
                .toEqual(['c1', 'd1', 'd2', 'e2', 'f1', 'f2']);
        });

        test('a king in check may not castle', async ({ page }) => {
            expect(await movesFrom(page, '4rk2/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1'))
                .toEqual(['d1', 'd2', 'f1', 'f2']);
        });

        test('a king may not castle through an attacked square', async ({ page }) => {
            // Black rook on f8 covers f1 and f2.
            expect(await movesFrom(page, 'r4rk1/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1'))
                .toEqual(['c1', 'd1', 'd2', 'e2']);
        });

        test('a king may not castle onto an attacked square', async ({ page }) => {
            // Black rook on g8 covers g1, the king's landing square.
            expect(await movesFrom(page, 'r5rk/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1'))
                .toEqual(['c1', 'd1', 'd2', 'e2', 'f1', 'f2']);
        });

        test('an attacked rook does not stop castling', async ({ page }) => {
            // Black rook on h8 covers h1 — the rook's own square, which is allowed.
            expect(await movesFrom(page, 'k6r/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1'))
                .toContain('g1');
        });

        test('moving the king gives up both rights', async ({ page }) => {
            await setUp(page, OPEN);
            const fen = await play(page, ['e1e2']);
            expect(fen.split(' ')[2]).toBe('kq');
        });

        test('moving a rook gives up that side only', async ({ page }) => {
            await setUp(page, OPEN);
            const fen = await play(page, ['h1h2']);
            expect(fen.split(' ')[2]).toBe('Qkq');
        });

        test('capturing a rook on its home square takes away that right', async ({ page }) => {
            expect(await page.evaluate((fen) => {
                const pos = parseFEN(fen);
                const move = generateMoves(pos).find(
                    (m) => squareName(m.from) === 'a1' && squareName(m.to) === 'a8'
                );
                return toFEN(makeMove(pos, move)).split(' ')[2];
            }, OPEN)).toBe('Kk');
        });
    });

    // =======================================================================
    // Promotion
    // =======================================================================
    test.describe('promotion', () => {
        const PROMO = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';

        test('a pawn reaching the last rank offers four promotions', async ({ page }) => {
            expect(await movesFrom(page, PROMO, 'a7')).toEqual(['a8b', 'a8n', 'a8q', 'a8r']);
        });

        test('promoting puts the chosen piece on the board', async ({ page }) => {
            expect(await page.evaluate((fen) => {
                const pos = parseFEN(fen);
                const out = {};
                for (const promo of ['q', 'r', 'b', 'n']) {
                    const move = generateMoves(pos).find((m) => m.promo === promo);
                    out[promo] = makeMove(pos, move).board[squareOf('a8')];
                }
                return out;
            }, PROMO)).toEqual({ q: 'Q', r: 'R', b: 'B', n: 'N' });
        });

        test('black promotes to lower case pieces', async ({ page }) => {
            expect(await page.evaluate(() => {
                const pos = parseFEN('4k3/8/8/8/8/8/p7/4K3 b - - 0 1');
                const move = generateMoves(pos).find((m) => m.promo === 'q');
                return makeMove(pos, move).board[squareOf('a1')];
            })).toBe('q');
        });

        test('a capture onto the last rank is still a promotion', async ({ page }) => {
            expect(await movesFrom(page, '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7'))
                .toEqual(['a8b', 'a8n', 'a8q', 'a8r', 'b8b', 'b8n', 'b8q', 'b8r']);
        });

        test('the pawn is gone from the board after promoting', async ({ page }) => {
            expect(await page.evaluate((fen) => {
                const pos = parseFEN(fen);
                const move = generateMoves(pos).find((m) => m.promo === 'q');
                return makeMove(pos, move).board[squareOf('a7')];
            }, PROMO)).toBe('');
        });
    });

    // =======================================================================
    // Check, pins and legality
    // =======================================================================
    test.describe('check and legality', () => {
        test('inCheck sees a rook check', async ({ page }) => {
            expect(await page.evaluate(() => {
                const pos = parseFEN('4k2R/8/8/8/8/8/8/4K3 b - - 0 1');
                return [inCheck(pos, 'b'), inCheck(pos, 'w')];
            })).toEqual([true, false]);
        });

        test('isSquareAttacked covers every attacker type', async ({ page }) => {
            expect(await page.evaluate(() => ({
                knight: isSquareAttacked(parseFEN('8/8/8/8/4N3/8/8/4k2K w - - 0 1'), squareOf('d6'), 'w'),
                pawn: isSquareAttacked(parseFEN('8/8/8/8/4P3/8/8/4k2K w - - 0 1'), squareOf('d5'), 'w'),
                pawnBackwards: isSquareAttacked(parseFEN('8/8/8/8/4P3/8/8/4k2K w - - 0 1'), squareOf('d3'), 'w'),
                bishop: isSquareAttacked(parseFEN('8/8/8/8/4B3/8/8/4k2K w - - 0 1'), squareOf('h7'), 'w'),
                throughPiece: isSquareAttacked(parseFEN('8/8/6p1/8/4B3/8/8/4k2K w - - 0 1'), squareOf('h7'), 'w'),
                king: isSquareAttacked(parseFEN('8/8/8/8/8/8/8/4k2K w - - 0 1'), squareOf('g2'), 'w'),
                empty: isSquareAttacked(parseFEN('8/8/8/8/8/8/8/4k2K w - - 0 1'), squareOf('a4'), 'w'),
            }))).toEqual({
                knight: true, pawn: true, pawnBackwards: false, bishop: true,
                throughPiece: false, king: true, empty: false,
            });
        });

        test('a pinned knight cannot move at all', async ({ page }) => {
            expect(await movesFrom(page, '4k3/4n3/8/8/8/8/4R3/4K3 b - - 0 1', 'e7')).toEqual([]);
        });

        test('a pinned rook may still move along the pin', async ({ page }) => {
            expect(await movesFrom(page, '4k3/4r3/8/8/8/8/4R3/4K3 b - - 0 1', 'e7'))
                .toEqual(['e2', 'e3', 'e4', 'e5', 'e6']);
        });

        test('in check, only the king moves that escape are legal', async ({ page }) => {
            expect(await allMoves(page, '4k2R/8/8/8/8/8/8/4K3 b - - 0 1'))
                .toEqual(['e8d7', 'e8e7', 'e8f7']);
        });

        test('a check may be answered by moving, blocking or capturing', async ({ page }) => {
            expect(await allMoves(page, '4k3/8/8/8/6N1/4r3/R7/4K3 w - - 0 1'))
                .toEqual(['a2e2', 'e1d1', 'e1d2', 'e1f1', 'e1f2', 'g4e3']);
        });

        test('a king cannot move into check', async ({ page }) => {
            expect(await movesFrom(page, '4k3/8/8/8/8/8/r7/4K3 w - - 0 1', 'e1'))
                .toEqual(['d1', 'f1']);
        });

        test('a king cannot retreat along the ray it is checked on', async ({ page }) => {
            expect(await movesFrom(page, '4k3/8/8/8/8/8/8/4R1K1 b - - 0 1', 'e8'))
                .toEqual(['d7', 'd8', 'f7', 'f8']);
        });

        test('the king may capture the piece that checks it', async ({ page }) => {
            expect(await allMoves(page, '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1'))
                .toEqual(['e1d1', 'e1e2', 'e1f1']);
        });
    });

    // =======================================================================
    // Perft — published move-path counts. These are the real test of the move
    // generator: get one rule wrong and the numbers do not match.
    // =======================================================================
    test.describe('perft', () => {
        const cases = [
            { name: 'start position', fen: START_FEN, counts: [20, 400, 8902, 197281] },
            {
                name: 'kiwipete',
                fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
                counts: [48, 2039, 97862],
            },
            {
                name: 'endgame with en passant pins',
                fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
                counts: [14, 191, 2812, 43238],
            },
            {
                name: 'promotions and pins',
                fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
                counts: [6, 264, 9467],
            },
            {
                name: 'tangled middlegame',
                fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
                counts: [44, 1486, 62379],
            },
            {
                name: 'quiet middlegame',
                fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 10 10',
                counts: [46, 2079, 89890],
            },
        ];

        for (const { name, fen, counts } of cases) {
            test(name, async ({ page }) => {
                test.setTimeout(180_000);
                const got = await page.evaluate(
                    ([fen, depth]) => {
                        const pos = parseFEN(fen);
                        const out = [];
                        for (let d = 1; d <= depth; d++) out.push(perft(pos, d));
                        return out;
                    },
                    [fen, counts.length]
                );
                expect(got).toEqual(counts);
            });
        }
    });

    // =======================================================================
    // How a game ends
    // =======================================================================
    test.describe('game outcomes', () => {
        test('back rank mate is checkmate', async ({ page }) => {
            expect(await page.evaluate(() => gameStatus(parseFEN('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1'))))
                .toBe('checkmate');
        });

        test('smothered mate is checkmate', async ({ page }) => {
            expect(await page.evaluate(() => gameStatus(parseFEN('6rk/5Npp/8/8/8/8/8/6K1 b - - 0 1'))))
                .toBe('checkmate');
        });

        test('a position with a legal escape is still playing', async ({ page }) => {
            expect(await page.evaluate(() => gameStatus(parseFEN('4k2R/8/8/8/8/8/8/4K3 b - - 0 1'))))
                .toBe('playing');
        });

        test('no moves and no check is stalemate', async ({ page }) => {
            expect(await page.evaluate(() => gameStatus(parseFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))))
                .toBe('stalemate');
        });

        test('a hundred half-moves without progress is a draw', async ({ page }) => {
            expect(await page.evaluate(() => gameStatus(parseFEN('8/8/4k3/8/8/4K3/8/7R w - - 100 60'))))
                .toBe('draw-fifty');
            expect(await page.evaluate(() => gameStatus(parseFEN('8/8/4k3/8/8/4K3/8/7R w - - 99 60'))))
                .toBe('playing');
        });

        test('king against king is a draw by material', async ({ page }) => {
            expect(await page.evaluate(() => gameStatus(parseFEN('8/8/4k3/8/8/4K3/8/8 w - - 0 1'))))
                .toBe('draw-material');
        });

        test('king and one minor piece is a draw by material', async ({ page }) => {
            for (const fen of ['8/8/4k3/8/8/4KB2/8/8 w - - 0 1', '8/8/4kn2/8/8/4K3/8/8 w - - 0 1']) {
                expect(await page.evaluate((f) => gameStatus(parseFEN(f)), fen)).toBe('draw-material');
            }
        });

        test('king and rook is not a draw by material', async ({ page }) => {
            expect(await page.evaluate(() => gameStatus(parseFEN('8/8/4k3/8/8/4KR2/8/8 w - - 0 1'))))
                .toBe('playing');
        });

        test('a pawn on the board is never a draw by material', async ({ page }) => {
            expect(await page.evaluate(() => gameStatus(parseFEN('8/8/4k3/8/8/4KP2/8/8 w - - 0 1'))))
                .toBe('playing');
        });

        test('the same position three times is a draw', async ({ page }) => {
            await setUp(page, '4k3/8/8/8/8/8/8/R3K2R w - - 0 1');
            await play(page, ['a1b1', 'e8d8', 'b1a1', 'd8e8', 'a1b1', 'e8d8', 'b1a1']);
            expect(await page.evaluate(() => gameState)).toBe('playing');
            await play(page, ['d8e8']);
            expect(await page.evaluate(() => gameStatus(position, historyFens()))).toBe('draw-repetition');
            expect(await page.evaluate(() => gameState)).toBe('over');
            await expect(page.locator('#overlay-sub')).toHaveText(/repetition/i);
        });

        test('checkmate on the live board ends the game and shows the result', async ({ page }) => {
            await setUp(page, '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
            await play(page, ['a1a8']);
            expect(await page.evaluate(() => gameState)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toHaveText(/checkmate/i);
            await expect(page.locator('#overlay-sub')).toHaveText(/white wins/i);
            await expect(page.locator('#status')).toHaveText(/checkmate/i);
        });

        test('stalemate on the live board is announced as a draw', async ({ page }) => {
            await setUp(page, '7k/8/5QK1/8/8/8/8/8 w - - 0 1');
            await play(page, ['f6f7']);
            expect(await page.evaluate(() => gameState)).toBe('over');
            await expect(page.locator('#overlay-title')).toHaveText(/draw/i);
            await expect(page.locator('#overlay-sub')).toHaveText(/stalemate/i);
        });

        test('black can win too', async ({ page }) => {
            await setUp(page, 'r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1');
            await play(page, ['a8a1']);
            await expect(page.locator('#overlay-sub')).toHaveText(/black wins/i);
        });

        test('the result overlay can be clicked away to see the board', async ({ page }) => {
            await setUp(page, '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
            await play(page, ['a1a8']);
            await page.locator('#overlay').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#status')).toHaveText(/checkmate/i);
        });

        test('two knights are not an automatic draw, as the rules have it', async ({ page }) => {
            expect(await page.evaluate(() => gameStatus(parseFEN('8/8/4k3/8/8/3NKN2/8/8 w - - 0 1'))))
                .toBe('playing');
        });

        test('bishops on the same colour square are a draw', async ({ page }) => {
            // c6 and f3 are both light squares, so neither side can ever mate.
            expect(await page.evaluate(() => gameStatus(parseFEN('8/8/2b1k3/8/8/4KB2/8/8 w - - 0 1'))))
                .toBe('draw-material');
        });

        test('bishops on opposite colour squares are not', async ({ page }) => {
            // g7 is dark and f3 is light, so a mate is still possible.
            expect(await page.evaluate(() => gameStatus(parseFEN('8/6b1/4k3/8/8/4KB2/8/8 w - - 0 1'))))
                .toBe('playing');
        });

        test('no moves can be played once the game is over', async ({ page }) => {
            await setUp(page, '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
            await play(page, ['a1a8']);
            expect(await page.evaluate(() => tryMove(squareOf('g1'), squareOf('g2'), null))).toBe(false);
        });

        test('check is announced in the status line', async ({ page }) => {
            await setUp(page, '4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
            await play(page, ['a1a8']);
            expect(await page.evaluate(() => inCheck(position, 'b'))).toBe(true);
            await expect(page.locator('#status')).toHaveText(/check/i);
        });
    });

    // =======================================================================
    // Notation
    // =======================================================================
    test.describe('algebraic notation', () => {
        test('a pawn push is just the square', async ({ page }) => {
            expect(await san(page, START_FEN, 'e2', 'e4')).toBe('e4');
        });

        test('a piece move carries its letter', async ({ page }) => {
            expect(await san(page, START_FEN, 'g1', 'f3')).toBe('Nf3');
        });

        test('a piece capture is written with an x', async ({ page }) => {
            expect(await san(page, '4k3/8/8/3p4/8/4N3/8/4K3 w - - 0 1', 'e3', 'd5')).toBe('Nxd5');
        });

        test('a pawn capture names the file it came from', async ({ page }) => {
            expect(await san(page, '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e4', 'd5')).toBe('exd5');
        });

        test('castling is written O-O and O-O-O', async ({ page }) => {
            const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
            expect(await san(page, fen, 'e1', 'g1')).toBe('O-O');
            expect(await san(page, fen, 'e1', 'c1')).toBe('O-O-O');
        });

        test('promotion is written with an equals sign', async ({ page }) => {
            expect(await san(page, '4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7', 'a8', 'q')).toBe('a8=Q+');
            expect(await san(page, '7k/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7', 'a8', 'n')).toBe('a8=N');
        });

        test('a check gets a plus and a mate gets a hash', async ({ page }) => {
            expect(await san(page, '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1', 'a8')).toBe('Ra8+');
            expect(await san(page, '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1', 'a8')).toBe('Ra8#');
        });

        test('two knights on the same rank are told apart by file', async ({ page }) => {
            const fen = '4k3/8/8/8/8/2N3N1/8/4K3 w - - 0 1';
            expect(await san(page, fen, 'c3', 'e4')).toBe('Nce4');
            expect(await san(page, fen, 'g3', 'e4')).toBe('Nge4');
        });

        test('two rooks on the same file are told apart by rank', async ({ page }) => {
            const fen = 'R7/8/8/4k3/8/8/8/R6K w - - 0 1';
            expect(await san(page, fen, 'a1', 'a4')).toBe('R1a4');
            expect(await san(page, fen, 'a8', 'a4')).toBe('R8a4');
        });

        test('three queens need file, rank or both', async ({ page }) => {
            const fen = '8/8/1k6/8/7Q/8/8/K3Q2Q w - - 0 1';
            expect(await san(page, fen, 'e1', 'e4')).toBe('Qee4');
            expect(await san(page, fen, 'h4', 'e4')).toBe('Q4e4');
            expect(await san(page, fen, 'h1', 'e4')).toBe('Qh1e4');
        });

        test('a pawn capture that promotes shows both', async ({ page }) => {
            expect(await san(page, '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7', 'b8', 'q')).toBe('axb8=Q+');
        });
    });

    // =======================================================================
    // The computer opponent
    // =======================================================================
    test.describe('the engine', () => {
        test('the search returns a legal move', async ({ page }) => {
            expect(await page.evaluate(() => {
                const pos = parseFEN(START_FEN);
                const best = searchBestMove(pos, 2);
                return generateMoves(pos).some(
                    (m) => m.from === best.from && m.to === best.to && (m.promo || null) === (best.promo || null)
                );
            })).toBe(true);
        });

        test('it finds mate in one for white', async ({ page }) => {
            expect(await page.evaluate(() => {
                const best = searchBestMove(parseFEN('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'), 2);
                return squareName(best.from) + squareName(best.to);
            })).toBe('a1a8');
        });

        test('it finds mate in one for black', async ({ page }) => {
            expect(await page.evaluate(() => {
                const best = searchBestMove(parseFEN('r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1'), 2);
                return squareName(best.from) + squareName(best.to);
            })).toBe('a8a1');
        });

        test('a forced mate scores as a mate', async ({ page }) => {
            expect(await page.evaluate(() => {
                const best = searchBestMove(parseFEN('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'), 4);
                return best.score > 9000;
            })).toBe(true);
        });

        test('it takes a free queen', async ({ page }) => {
            expect(await page.evaluate(() => {
                const best = searchBestMove(parseFEN('4k3/8/8/6q1/8/8/8/4K1R1 w - - 0 1'), 3);
                return squareName(best.from) + squareName(best.to);
            })).toBe('g1g5');
        });

        test('it does not give a rook away for a pawn', async ({ page }) => {
            expect(await page.evaluate(() => {
                const best = searchBestMove(parseFEN('8/3pk3/8/8/8/8/8/3RK3 w - - 0 1'), 3);
                return squareName(best.to);
            })).not.toBe('d7');
        });

        test('it answers a check with a legal move', async ({ page }) => {
            expect(await page.evaluate(() => {
                const pos = parseFEN('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
                const best = searchBestMove(pos, 2);
                return generateMoves(pos).some((m) => m.from === best.from && m.to === best.to);
            })).toBe(true);
        });

        test('evaluation is read from the point of view of the side to move', async ({ page }) => {
            expect(await page.evaluate(() => [
                evaluate(parseFEN('4k3/8/8/8/8/8/8/4K1QR w - - 0 1')) > 800,
                evaluate(parseFEN('4k1qr/8/8/8/8/8/8/4K3 w - - 0 1')) < -800,
                Math.abs(evaluate(parseFEN(START_FEN))) < 100,
            ])).toEqual([true, true, true]);
        });

        test('the three difficulties search to different depths', async ({ page }) => {
            expect(await page.evaluate(() => DIFFICULTIES.map((d) => d.depth))).toEqual([1, 3, 4]);
        });
    });

    // =======================================================================
    // Playing with the mouse
    // =======================================================================
    test.describe('the board', () => {
        // Click the centre of a named square, whichever way the board faces.
        async function clickOn(page, name) {
            const box = await page.locator('#canvas').boundingBox();
            const point = await page.evaluate((name) => squareCentre(squareOf(name)), name);
            const scale = box.width / (await page.evaluate(() => canvas.width));
            await page.mouse.click(box.x + point.x * scale, box.y + point.y * scale);
        }

        test('clicking a piece selects it and shows its moves', async ({ page }) => {
            await clickOn(page, 'e2');
            expect(await page.evaluate(() => squareName(selected))).toBe('e2');
            expect(await page.evaluate(() => legalTargets.map(squareName).sort())).toEqual(['e3', 'e4']);
        });

        test('clicking an empty square selects nothing', async ({ page }) => {
            await clickOn(page, 'e4');
            expect(await page.evaluate(() => selected)).toBe(-1);
        });

        test('clicking the other side\'s piece selects nothing', async ({ page }) => {
            await clickOn(page, 'e7');
            expect(await page.evaluate(() => selected)).toBe(-1);
        });

        test('clicking a legal target plays the move', async ({ page }) => {
            await clickOn(page, 'e2');
            await clickOn(page, 'e4');
            expect(await page.evaluate(() => [position.board[squareOf('e4')], position.board[squareOf('e2')]]))
                .toEqual(['P', '']);
            expect(await page.evaluate(() => position.turn)).toBe('b');
            expect(await page.evaluate(() => selected)).toBe(-1);
        });

        test('clicking an illegal target just clears the selection', async ({ page }) => {
            await clickOn(page, 'e2');
            await clickOn(page, 'e6');
            expect(await page.evaluate(() => toFEN(position))).toBe(START_FEN);
            expect(await page.evaluate(() => selected)).toBe(-1);
        });

        test('clicking another of your own pieces moves the selection', async ({ page }) => {
            await clickOn(page, 'e2');
            await clickOn(page, 'd2');
            expect(await page.evaluate(() => squareName(selected))).toBe('d2');
        });

        test('Escape clears the selection', async ({ page }) => {
            await clickOn(page, 'e2');
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => selected)).toBe(-1);
        });

        test('the flipped board maps clicks to the same squares', async ({ page }) => {
            await page.locator('#btn-flip').click();
            expect(await page.evaluate(() => flipped)).toBe(true);
            await clickOn(page, 'e2');
            expect(await page.evaluate(() => squareName(selected))).toBe('e2');
            await clickOn(page, 'e4');
            expect(await page.evaluate(() => position.board[squareOf('e4')])).toBe('P');
        });

        test('the last move is remembered for highlighting', async ({ page }) => {
            await play(page, ['d2d4']);
            expect(await page.evaluate(() => [squareName(lastMove.from), squareName(lastMove.to)]))
                .toEqual(['d2', 'd4']);
        });

        test('it is not possible to move the other side\'s pieces', async ({ page }) => {
            expect(await page.evaluate(() => tryMove(squareOf('e7'), squareOf('e5'), null))).toBe(false);
        });
    });

    // =======================================================================
    // The furniture around the board
    // =======================================================================
    test.describe('move list, captures and buttons', () => {
        test('the move list fills up in algebraic notation', async ({ page }) => {
            await play(page, ['e2e4', 'e7e5', 'g1f3']);
            await expect(page.locator('#movelist .ply')).toHaveCount(3);
            expect(await page.locator('#movelist .ply').allInnerTexts()).toEqual(['e4', 'e5', 'Nf3']);
        });

        test('the move list numbers the moves', async ({ page }) => {
            await play(page, ['e2e4', 'e7e5', 'g1f3']);
            expect(await page.locator('#movelist .num').allInnerTexts()).toEqual(['1.', '2.']);
        });

        test('the move just played is marked in the list', async ({ page }) => {
            await play(page, ['e2e4', 'e7e5']);
            await expect(page.locator('#movelist .ply.current')).toHaveCount(1);
            await expect(page.locator('#movelist .ply.current')).toHaveText('e5');
            await page.locator('#btn-undo').click();
            await expect(page.locator('#movelist .ply.current')).toHaveText('e4');
        });

        test('the turn indicator follows the move', async ({ page }) => {
            await expect(page.locator('#turn')).toHaveText(/white/i);
            await play(page, ['e2e4']);
            await expect(page.locator('#turn')).toHaveText(/black/i);
        });

        test('captured pieces are listed for the side that took them', async ({ page }) => {
            await setUp(page, '4k3/4p3/8/8/8/8/3P4/4K3 w - - 0 1');
            await play(page, ['d2d4', 'e7e5', 'd4e5']);
            await expect(page.locator('#captured-white')).toHaveText('♟');
            await expect(page.locator('#captured-black')).toHaveText('');
        });

        test('undo takes back the last move', async ({ page }) => {
            await play(page, ['e2e4']);
            await page.locator('#btn-undo').click();
            expect(await page.evaluate(() => toFEN(position))).toBe(START_FEN);
            await expect(page.locator('#movelist .ply')).toHaveCount(0);
        });

        test('the U key takes back a move as well', async ({ page }) => {
            await play(page, ['e2e4']);
            await page.keyboard.press('u');
            expect(await page.evaluate(() => toFEN(position))).toBe(START_FEN);
        });

        test('undo on an empty game does nothing', async ({ page }) => {
            await page.locator('#btn-undo').click();
            expect(await page.evaluate(() => toFEN(position))).toBe(START_FEN);
        });

        test('undo clears a finished game', async ({ page }) => {
            await setUp(page, '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
            await play(page, ['a1a8']);
            expect(await page.evaluate(() => gameState)).toBe('over');
            await page.locator('#btn-undo').click();
            expect(await page.evaluate(() => gameState)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('against the computer undo takes back both replies', async ({ page }) => {
            await page.evaluate(() => {
                setOpponent('computer');
                setDifficulty('gentle');
                loadPosition('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
                tryMove(squareOf('e2'), squareOf('e4'), null);
                playComputerMove();   // the reply, without waiting on a timer
            });
            expect(await page.evaluate(() => history.length)).toBe(2);
            await page.locator('#btn-undo').click();
            expect(await page.evaluate(() => history.length)).toBe(0);
            expect(await page.evaluate(() => position.turn)).toBe('w');
        });

        test('New Game puts the pieces back', async ({ page }) => {
            await play(page, ['e2e4', 'e7e5']);
            await page.locator('#btn-new').click();
            expect(await page.evaluate(() => toFEN(position))).toBe(START_FEN);
            await expect(page.locator('#movelist .ply')).toHaveCount(0);
            expect(await page.evaluate(() => gameState)).toBe('playing');
            await expect(page.locator('#captured-white')).toHaveText('');
        });

        test('the difficulty select drives the search depth', async ({ page }) => {
            await page.locator('#opponent').selectOption('computer');
            await page.locator('#difficulty').selectOption('sharp');
            expect(await page.evaluate(() => difficulty.depth)).toBe(4);
            await page.locator('#difficulty').selectOption('gentle');
            expect(await page.evaluate(() => difficulty.depth)).toBe(1);
        });

        test('the chosen difficulty is remembered', async ({ page }) => {
            await page.locator('#opponent').selectOption('computer');
            await page.locator('#difficulty').selectOption('sharp');
            await page.reload();
            await expect(page.locator('#difficulty')).toHaveValue('sharp');
            expect(await page.evaluate(() => difficulty.depth)).toBe(4);
        });

        test('the difficulty select is disabled in two player mode', async ({ page }) => {
            await expect(page.locator('#difficulty')).toBeDisabled();
            await page.locator('#opponent').selectOption('computer');
            await expect(page.locator('#difficulty')).toBeEnabled();
        });

        test('two player mode leaves both sides to the player', async ({ page }) => {
            await play(page, ['e2e4']);
            await page.waitForTimeout(500);
            expect(await page.evaluate(() => history.length)).toBe(1);
            expect(await page.evaluate(() => position.turn)).toBe('b');
        });

        test('choosing to play black flips the board and lets the computer open', async ({ page }) => {
            await page.locator('#opponent').selectOption('computer');
            await page.locator('#difficulty').selectOption('gentle');
            await page.locator('#side').selectOption('black');
            await page.locator('#btn-new').click();
            expect(await page.evaluate(() => playerColor)).toBe('b');
            expect(await page.evaluate(() => flipped)).toBe(true);
            await expect(page.locator('#movelist .ply')).toHaveCount(1, { timeout: 20_000 });
            expect(await page.evaluate(() => position.turn)).toBe('b');
        });

        test('the computer answers a move on its own', async ({ page }) => {
            await page.locator('#opponent').selectOption('computer');
            await page.locator('#difficulty').selectOption('gentle');
            await play(page, ['e2e4']);
            await expect(page.locator('#movelist .ply')).toHaveCount(2, { timeout: 20_000 });
            expect(await page.evaluate(() => position.turn)).toBe('w');
        });
    });

    // =======================================================================
    // Promotion through the interface
    // =======================================================================
    test.describe('the promotion chooser', () => {
        test.beforeEach(async ({ page }) => {
            await setUp(page, '4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
            await page.evaluate(() => { clickSquare(squareOf('a7')); clickSquare(squareOf('a8')); });
        });

        test('a promoting move opens the chooser and waits', async ({ page }) => {
            await expect(page.locator('#promotion')).toHaveClass(/visible/);
            expect(await page.evaluate(() => position.board[squareOf('a8')])).toBe('');
            expect(await page.evaluate(() => pendingPromotion !== null)).toBe(true);
        });

        test('the chooser offers all four pieces', async ({ page }) => {
            await expect(page.locator('.promo-btn')).toHaveCount(4);
        });

        test('picking a piece completes the move', async ({ page }) => {
            await page.locator('.promo-btn[data-piece="r"]').click();
            expect(await page.evaluate(() => position.board[squareOf('a8')])).toBe('R');
            await expect(page.locator('#promotion')).not.toHaveClass(/visible/);
            expect(await page.locator('#movelist .ply').allInnerTexts()).toEqual(['a8=R+']);
        });

        test('picking the queen is the common case', async ({ page }) => {
            await page.locator('.promo-btn[data-piece="q"]').click();
            expect(await page.evaluate(() => position.board[squareOf('a8')])).toBe('Q');
        });

        test('Escape abandons the promotion', async ({ page }) => {
            await page.keyboard.press('Escape');
            await expect(page.locator('#promotion')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => pendingPromotion)).toBe(null);
            expect(await page.evaluate(() => position.turn)).toBe('w');
            expect(await page.evaluate(() => position.board[squareOf('a7')])).toBe('P');
        });
    });

    // =======================================================================
    // A whole short game against the computer
    // =======================================================================
    test.describe('a game against the computer', () => {
        test('the computer answers every move and the game stays legal', async ({ page }) => {
            test.setTimeout(120_000);
            const result = await page.evaluate(() => {
                setOpponent('computer');
                setDifficulty('gentle');
                newGame();
                for (let i = 0; i < 12 && gameState !== 'over'; i++) {
                    const mine = generateMoves(position);
                    if (!mine.length) break;
                    const move = mine[0];
                    if (!tryMove(move.from, move.to, move.promo || null)) break;
                    if (gameState === 'over') break;
                    playComputerMove();
                }
                return {
                    plies: history.length,
                    status: gameStatus(position, historyFens()),
                    fenStable: toFEN(position) === toFEN(parseFEN(toFEN(position))),
                };
            });
            expect(result.plies).toBeGreaterThanOrEqual(12);
            expect(result.fenStable).toBe(true);
            expect(['playing', 'checkmate', 'stalemate', 'draw-fifty', 'draw-material', 'draw-repetition'])
                .toContain(result.status);
        });
    });
});
