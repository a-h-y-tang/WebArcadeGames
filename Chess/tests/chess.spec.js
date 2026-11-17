const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ---------------------------------------------------------------------------
// Helpers. The engine is a set of pure functions over a position object, so
// most tests load a FEN and ask a question about it without touching the UI.
// ---------------------------------------------------------------------------

// Legal destinations from one square, as square names ('e4'), sorted.
async function destinations(page, fen, square) {
    return page.evaluate(([fen, square]) => {
        const p = loadFen(fen);
        const [r, c] = parseSquare(square);
        return movesFrom(p, r, c)
            .map((m) => squareName(m.to[0], m.to[1]) + (m.promo || ''))
            .sort();
    }, [fen, square]);
}

// Every legal move in the position, as 'from-to' strings, sorted.
async function allMoves(page, fen) {
    return page.evaluate((fen) => {
        const p = loadFen(fen);
        return legalMoves(p)
            .map(
                (m) =>
                    squareName(m.from[0], m.from[1]) +
                    squareName(m.to[0], m.to[1]) +
                    (m.promo || '')
            )
            .sort();
    }, fen);
}

async function perft(page, fen, depth) {
    return page.evaluate(([fen, depth]) => perft(loadFen(fen), depth), [fen, depth]);
}

// Play a list of 'e2e4' style moves on the live position (no engine replies).
async function play(page, fen, moves) {
    return page.evaluate(([fen, moves]) => {
        let p = loadFen(fen);
        for (const uci of moves) {
            const [fr, fc] = parseSquare(uci.slice(0, 2));
            const [tr, tc] = parseSquare(uci.slice(2, 4));
            const promo = uci[4] || null;
            const move = legalMoves(p).find(
                (m) =>
                    m.from[0] === fr &&
                    m.from[1] === fc &&
                    m.to[0] === tr &&
                    m.to[1] === tc &&
                    (promo ? m.promo === promo : true)
            );
            if (!move) throw new Error(`illegal move ${uci} in ${toFen(p)}`);
            p = applyMove(p, move);
        }
        return toFen(p);
    }, [fen, moves]);
}

// Put an exact position on the board for UI tests, engine off by default.
async function setup(page, fen, { ai = false } = {}) {
    await page.evaluate(
        ([fen, ai]) => {
            startGame();
            aiEnabled = ai;
            setupPosition(fen);
        },
        [fen, ai]
    );
}

async function clickSquareName(page, square) {
    const pos = await page.evaluate((square) => {
        const [r, c] = parseSquare(square);
        return squareCentre(r, c);
    }, square);
    await page.locator('#canvas').click({ position: pos });
}

async function boardAt(page, square) {
    return page.evaluate((square) => {
        const [r, c] = parseSquare(square);
        return pos.board[r][c];
    }, square);
}

test.describe('Chess', () => {
    const errors = [];

    test.beforeEach(async ({ page }) => {
        errors.length = 0;
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Page and initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Chess', async ({ page }) => {
            await expect(page).toHaveTitle('Chess');
        });

        test('canvas is 560x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('start overlay is visible and state is ready', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('ready');
        });

        test('board starts in the opening position', async ({ page }) => {
            expect(await page.evaluate(() => toFen(pos))).toBe(START_FEN);
        });

        test('loads with no page or console errors', async ({ page }) => {
            await page.waitForTimeout(250);
            expect(errors).toEqual([]);
        });

        test('Space starts the game from the opening screen', async ({ page }) => {
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start Game begins play with White to move', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
            expect(await page.evaluate(() => pos.turn)).toBe('w');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // FEN
    // -----------------------------------------------------------------------
    test.describe('FEN', () => {
        test('round-trips the opening position', async ({ page }) => {
            expect(await page.evaluate((fen) => toFen(loadFen(fen)), START_FEN)).toBe(START_FEN);
        });

        const fens = [
            'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
            '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
            'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3',
            '4k3/8/8/8/8/8/8/4K3 b - - 12 34',
        ];
        for (const fen of fens) {
            test(`round-trips ${fen}`, async ({ page }) => {
                expect(await page.evaluate((f) => toFen(loadFen(f)), fen)).toBe(fen);
            });
        }

        test('parses piece placement onto the right squares', async ({ page }) => {
            const got = await page.evaluate((fen) => {
                const p = loadFen(fen);
                const at = (sq) => {
                    const [r, c] = parseSquare(sq);
                    return p.board[r][c] || '.';
                };
                return [at('a8'), at('e8'), at('e1'), at('d1'), at('e2'), at('e5')].join('');
            }, START_FEN);
            expect(got).toBe('rkKQP.');
        });

        test('squareName and parseSquare agree', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let r = 0; r < 8; r++)
                    for (let c = 0; c < 8; c++) {
                        const [r2, c2] = parseSquare(squareName(r, c));
                        if (r2 !== r || c2 !== c) return false;
                    }
                return squareName(7, 0) === 'a1' && squareName(0, 7) === 'h8';
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Piece movement
    // -----------------------------------------------------------------------
    test.describe('pawns', () => {
        test('may step one or two squares from the start', async ({ page }) => {
            expect(await destinations(page, 'k7/8/8/8/8/8/4P3/7K w - - 0 1', 'e2')).toEqual([
                'e3',
                'e4',
            ]);
        });

        test('may only step one square after leaving the start', async ({ page }) => {
            expect(await destinations(page, 'k7/8/8/8/8/4P3/8/7K w - - 0 1', 'e3')).toEqual(['e4']);
        });

        test('cannot step onto an occupied square', async ({ page }) => {
            expect(await destinations(page, 'k7/8/8/8/8/4n3/4P3/7K w - - 0 1', 'e2')).toEqual([]);
        });

        test('cannot jump a piece on the double step', async ({ page }) => {
            expect(await destinations(page, 'k7/8/8/8/4n3/8/4P3/7K w - - 0 1', 'e2')).toEqual([
                'e3',
            ]);
        });

        test('captures diagonally but not straight ahead', async ({ page }) => {
            expect(
                await destinations(page, 'k7/8/8/8/8/3n1n2/4P3/7K w - - 0 1', 'e2')
            ).toEqual(['d3', 'e3', 'e4', 'f3']);
        });

        test('black pawns move down the board', async ({ page }) => {
            expect(await destinations(page, 'k7/4p3/8/8/8/8/8/7K b - - 0 1', 'e7')).toEqual([
                'e5',
                'e6',
            ]);
        });

        test('capture en passant is offered on the next ply only', async ({ page }) => {
            const fen = 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3';
            expect(await destinations(page, fen, 'e5')).toEqual(['e6', 'f6']);
            const without = fen.replace(' f6 ', ' - ');
            expect(await destinations(page, without, 'e5')).toEqual(['e6']);
        });

        test('capturing en passant removes the passed pawn', async ({ page }) => {
            const after = await play(
                page,
                'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3',
                ['e5f6']
            );
            expect(after).toBe('rnbqkbnr/ppp1p1pp/5P2/3p4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3');
        });

        test('a double step sets the en passant square', async ({ page }) => {
            const after = await play(page, START_FEN, ['e2e4']);
            expect(after).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
        });

        test('reaching the last rank offers four promotions', async ({ page }) => {
            expect(await destinations(page, '8/P7/8/8/8/8/8/K6k w - - 0 1', 'a7')).toEqual([
                'a8b',
                'a8n',
                'a8q',
                'a8r',
            ]);
        });

        test('promotion puts the chosen piece on the board', async ({ page }) => {
            expect(await play(page, '8/P7/8/8/8/8/8/K6k w - - 0 1', ['a7a8n'])).toBe(
                'N7/8/8/8/8/8/8/K6k b - - 0 1'
            );
        });
    });

    test.describe('knights', () => {
        test('have eight moves from the centre', async ({ page }) => {
            expect(await destinations(page, 'k7/8/8/8/3N4/8/8/7K w - - 0 1', 'd4')).toEqual([
                'b3',
                'b5',
                'c2',
                'c6',
                'e2',
                'e6',
                'f3',
                'f5',
            ]);
        });

        test('have two moves from a corner', async ({ page }) => {
            expect(await destinations(page, 'k7/8/8/8/8/8/8/N6K w - - 0 1', 'a1')).toEqual([
                'b3',
                'c2',
            ]);
        });

        test('are blocked only by friendly pieces on the landing square', async ({ page }) => {
            // Walled in by its own pawns, the knight has nowhere to land.
            expect(await destinations(page, '7k/8/8/8/8/1P6/2P5/N6K w - - 0 1', 'a1')).toEqual([]);
            // The same wall in enemy colours is two captures, jumped into.
            expect(await destinations(page, '7k/8/8/8/8/1p6/2p5/N6K w - - 0 1', 'a1')).toEqual([
                'b3',
                'c2',
            ]);
        });
    });

    test.describe('sliding pieces', () => {
        test('a rook sweeps its rank and file', async ({ page }) => {
            const moves = await destinations(page, '7k/8/8/8/8/8/8/R6K w - - 0 1', 'a1');
            expect(moves).toEqual(
                ['a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1'].sort()
            );
        });

        test('a rook stops before a friendly piece and on an enemy', async ({ page }) => {
            expect(await destinations(page, '7k/8/8/8/8/8/R7/R6K w - - 0 1', 'a1')).toEqual(
                ['b1', 'c1', 'd1', 'e1', 'f1', 'g1'].sort()
            );
            expect(await destinations(page, '7k/8/8/8/8/8/r7/R6K w - - 0 1', 'a1')).toEqual(
                ['a2', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1'].sort()
            );
        });

        test('a bishop sweeps its diagonals', async ({ page }) => {
            expect(await destinations(page, 'k7/8/8/8/3B4/8/8/7K w - - 0 1', 'd4')).toEqual(
                ['a1', 'b2', 'c3', 'e5', 'f6', 'g7', 'h8', 'c5', 'b6', 'a7', 'e3', 'f2', 'g1'].sort()
            );
        });

        test('a queen sweeps both', async ({ page }) => {
            const count = await page.evaluate(() => {
                const p = loadFen('k7/8/8/8/3Q4/8/8/7K w - - 0 1');
                return movesFrom(p, ...parseSquare('d4')).length;
            });
            expect(count).toBe(27);
        });
    });

    test.describe('kings', () => {
        test('step one square in any direction', async ({ page }) => {
            expect(await destinations(page, 'k7/8/8/3K4/8/8/8/8 w - - 0 1', 'd5')).toEqual(
                ['c4', 'c5', 'c6', 'd4', 'd6', 'e4', 'e5', 'e6'].sort()
            );
        });

        test('may not step into check', async ({ page }) => {
            // Black rook on e8 covers the whole e-file.
            expect(await destinations(page, '4r2k/8/8/8/8/8/8/3K4 w - - 0 1', 'd1')).toEqual(
                ['c1', 'c2', 'd2'].sort()
            );
        });

        test('may not stay adjacent to the other king', async ({ page }) => {
            expect(await destinations(page, '8/8/8/3k4/8/3K4/8/8 w - - 0 1', 'd3')).toEqual(
                ['c2', 'c3', 'd2', 'e2', 'e3'].sort()
            );
        });

        test('a pinned piece may not abandon the king', async ({ page }) => {
            // White knight d2 is pinned by the black rook on d8.
            expect(await destinations(page, '3r3k/8/8/8/8/8/3N4/3K4 w - - 0 1', 'd2')).toEqual([]);
        });

        test('when in check only moves that answer it are legal', async ({ page }) => {
            const moves = await allMoves(page, '4r2k/8/8/8/8/8/8/4K3 w - - 0 1');
            expect(moves).toEqual(['e1d1', 'e1d2', 'e1f1', 'e1f2'].sort());
        });
    });

    // -----------------------------------------------------------------------
    // Castling
    // -----------------------------------------------------------------------
    test.describe('castling', () => {
        const open = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

        test('both sides are available when the squares are clear', async ({ page }) => {
            expect(await destinations(page, open, 'e1')).toEqual(
                ['c1', 'd1', 'd2', 'e2', 'f1', 'f2', 'g1'].sort()
            );
        });

        test('moves the rook to the far side of the king', async ({ page }) => {
            expect(await play(page, open, ['e1g1'])).toBe('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1');
            expect(await play(page, open, ['e1c1'])).toBe('r3k2r/8/8/8/8/8/8/2KR3R b kq - 1 1');
        });

        test('black castles too', async ({ page }) => {
            const fen = 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1';
            expect(await play(page, fen, ['e8g8'])).toBe('r4rk1/8/8/8/8/8/8/R3K2R w KQ - 1 2');
            expect(await play(page, fen, ['e8c8'])).toBe('2kr3r/8/8/8/8/8/8/R3K2R w KQ - 1 2');
        });

        test('is refused when a square between is occupied', async ({ page }) => {
            const dests = await destinations(page, 'r3k2r/8/8/8/8/8/8/R2QK2R w KQkq - 0 1', 'e1');
            expect(dests).toContain('g1');
            expect(dests).not.toContain('c1');
        });

        test('is refused while the king is in check', async ({ page }) => {
            const dests = await destinations(page, 'r3k2r/8/8/8/4r3/8/8/R3K2R w KQkq - 0 1', 'e1');
            expect(dests).not.toContain('g1');
            expect(dests).not.toContain('c1');
        });

        test('is refused through an attacked square', async ({ page }) => {
            const dests = await destinations(page, 'r3k2r/8/8/8/5r2/8/8/R3K2R w KQkq - 0 1', 'e1');
            expect(dests).not.toContain('g1');
            expect(dests).toContain('c1');
        });

        test('is refused onto an attacked square', async ({ page }) => {
            const dests = await destinations(page, 'r3k2r/8/8/8/6r1/8/8/R3K2R w KQkq - 0 1', 'e1');
            expect(dests).not.toContain('g1');
            expect(dests).toContain('c1');
        });

        test('queenside is allowed when only b1 is attacked', async ({ page }) => {
            const dests = await destinations(page, 'r3k2r/8/8/8/1r6/8/8/R3K2R w KQkq - 0 1', 'e1');
            expect(dests).toContain('c1');
        });

        test('is refused once the rights are gone', async ({ page }) => {
            const dests = await destinations(page, 'r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1', 'e1');
            expect(dests).not.toContain('g1');
            expect(dests).not.toContain('c1');
        });

        test('moving the king clears both rights', async ({ page }) => {
            expect(await play(page, open, ['e1e2'])).toBe('r3k2r/8/8/8/8/8/4K3/R6R b kq - 1 1');
        });

        test('moving a rook clears that side only', async ({ page }) => {
            expect(await play(page, open, ['h1h2'])).toBe('r3k2r/8/8/8/8/8/7R/R3K3 b Qkq - 1 1');
            expect(await play(page, open, ['a1a2'])).toBe('r3k2r/8/8/8/8/8/R7/4K2R b Kkq - 1 1');
        });

        test('capturing a rook clears the rights on that corner', async ({ page }) => {
            expect(await play(page, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['a1a8'])).toBe(
                'R3k2r/8/8/8/8/8/8/4K2R b Kk - 0 1'
            );
        });
    });

    // -----------------------------------------------------------------------
    // Check, mate and draws
    // -----------------------------------------------------------------------
    test.describe('check and mate', () => {
        test('inCheck sees a checking rook', async ({ page }) => {
            const got = await page.evaluate(() => {
                const p = loadFen('4r2k/8/8/8/8/8/8/4K3 w - - 0 1');
                return [inCheck(p, 'w'), inCheck(p, 'b')];
            });
            expect(got).toEqual([true, false]);
        });

        test("recognises the fool's mate", async ({ page }) => {
            const fen = await play(page, START_FEN, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
            const status = await page.evaluate((f) => gameStatus(loadFen(f)), fen);
            expect(status).toBe('checkmate');
            expect(await page.evaluate((f) => legalMoves(loadFen(f)).length, fen)).toBe(0);
        });

        test('recognises a back-rank mate', async ({ page }) => {
            const fen = await play(page, '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1', ['a1a8']);
            expect(await page.evaluate((f) => gameStatus(loadFen(f)), fen)).toBe('checkmate');
        });

        test('recognises stalemate', async ({ page }) => {
            const fen = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
            expect(await page.evaluate((f) => gameStatus(loadFen(f)), fen)).toBe('stalemate');
            expect(await page.evaluate((f) => inCheck(loadFen(f), 'b'), fen)).toBe(false);
        });

        test('a position with moves is still playing', async ({ page }) => {
            expect(await page.evaluate((f) => gameStatus(loadFen(f)), START_FEN)).toBe('playing');
        });

        test('claims the fifty-move rule', async ({ page }) => {
            expect(
                await page.evaluate(() => gameStatus(loadFen('4k3/8/4r3/8/8/4R3/8/4K3 w - - 100 80')))
            ).toBe('fifty-move');
        });

        test('claims insufficient material', async ({ page }) => {
            const got = await page.evaluate(() =>
                [
                    '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
                    '4k3/8/8/8/8/8/8/3BK3 w - - 0 1',
                    '4k3/8/8/8/8/8/8/3NK3 w - - 0 1',
                    '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
                    '4k3/8/8/8/8/8/8/3RK3 w - - 0 1',
                ].map((f) => gameStatus(loadFen(f)))
            );
            expect(got).toEqual([
                'insufficient',
                'insufficient',
                'insufficient',
                'playing',
                'playing',
            ]);
        });
    });

    // -----------------------------------------------------------------------
    // perft — the real test of move generation
    // -----------------------------------------------------------------------
    test.describe('perft', () => {
        test.setTimeout(60_000);

        const cases = [
            ['opening', START_FEN, [20, 400, 8902]],
            [
                'kiwipete',
                'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
                [48, 2039],
            ],
            ['en passant edges', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]],
            [
                'promotions and pins',
                'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
                [6, 264, 9467],
            ],
            ['tangled middlegame', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486]],
        ];

        for (const [name, fen, counts] of cases) {
            for (let depth = 1; depth <= counts.length; depth++) {
                test(`${name} perft(${depth}) = ${counts[depth - 1]}`, async ({ page }) => {
                    expect(await perft(page, fen, depth)).toBe(counts[depth - 1]);
                });
            }
        }
    });

    // -----------------------------------------------------------------------
    // Algebraic notation
    // -----------------------------------------------------------------------
    test.describe('notation', () => {
        async function san(page, fen, uci) {
            return page.evaluate(([fen, uci]) => {
                const p = loadFen(fen);
                const [fr, fc] = parseSquare(uci.slice(0, 2));
                const [tr, tc] = parseSquare(uci.slice(2, 4));
                const promo = uci[4] || null;
                const move = legalMoves(p).find(
                    (m) =>
                        m.from[0] === fr &&
                        m.from[1] === fc &&
                        m.to[0] === tr &&
                        m.to[1] === tc &&
                        (promo ? m.promo === promo : true)
                );
                return moveSan(p, move);
            }, [fen, uci]);
        }

        test('a quiet pawn move is just the square', async ({ page }) => {
            expect(await san(page, START_FEN, 'e2e4')).toBe('e4');
        });

        test('a piece move carries its letter', async ({ page }) => {
            expect(await san(page, START_FEN, 'g1f3')).toBe('Nf3');
        });

        test('a pawn capture names the file it left', async ({ page }) => {
            const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
            expect(await san(page, fen, 'e4d5')).toBe('exd5');
        });

        test('a piece capture uses x', async ({ page }) => {
            expect(await san(page, 'k7/8/8/8/3r4/8/8/3RK3 w - - 0 1', 'd1d4')).toBe('Rxd4');
        });

        test('castling is O-O and O-O-O', async ({ page }) => {
            const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
            expect(await san(page, fen, 'e1g1')).toBe('O-O');
            expect(await san(page, fen, 'e1c1')).toBe('O-O-O');
        });

        test('promotion is marked with =', async ({ page }) => {
            expect(await san(page, '8/P7/8/4k3/8/8/8/K7 w - - 0 1', 'a7a8q')).toBe('a8=Q');
        });

        test('check adds + and mate adds #', async ({ page }) => {
            expect(await san(page, '4k3/8/8/8/8/8/8/4KR2 w - - 0 1', 'f1f8')).toBe('Rf8+');
            expect(await san(page, '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1', 'a1a8')).toBe('Ra8#');
        });

        test('two knights that can reach a square are told apart by file', async ({ page }) => {
            const fen = '7k/8/8/8/8/5N2/8/1N2K3 w - - 0 1';
            expect(await san(page, fen, 'b1d2')).toBe('Nbd2');
            expect(await san(page, fen, 'f3d2')).toBe('Nfd2');
            expect(await san(page, fen, 'f3g5')).toBe('Ng5');
        });

        test('pieces on the same file are told apart by rank', async ({ page }) => {
            expect(await san(page, '7k/8/8/8/R7/8/8/R3K3 w - - 0 1', 'a1a3')).toBe('R1a3');
            expect(await san(page, '7k/8/8/8/R7/8/8/R3K3 w - - 0 1', 'a4a3')).toBe('R4a3');
        });
    });

    // -----------------------------------------------------------------------
    // Playing with the mouse
    // -----------------------------------------------------------------------
    test.describe('playing by clicking', () => {
        test('clicking a white piece selects it', async ({ page }) => {
            await setup(page, START_FEN);
            await clickSquareName(page, 'e2');
            expect(await page.evaluate(() => selected)).toEqual([6, 4]);
        });

        test('clicking a black piece selects nothing', async ({ page }) => {
            await setup(page, START_FEN);
            await clickSquareName(page, 'e7');
            expect(await page.evaluate(() => selected)).toBe(null);
        });

        test('clicking an empty square selects nothing', async ({ page }) => {
            await setup(page, START_FEN);
            await clickSquareName(page, 'e4');
            expect(await page.evaluate(() => selected)).toBe(null);
        });

        test('the selected piece offers its legal targets', async ({ page }) => {
            await setup(page, START_FEN);
            await clickSquareName(page, 'g1');
            const targets = await page.evaluate(() =>
                legalTargets().map(([r, c]) => squareName(r, c)).sort()
            );
            expect(targets).toEqual(['f3', 'h3']);
        });

        test('clicking a target square makes the move', async ({ page }) => {
            await setup(page, START_FEN);
            await clickSquareName(page, 'e2');
            await clickSquareName(page, 'e4');
            expect(await boardAt(page, 'e4')).toBe('P');
            expect(await boardAt(page, 'e2')).toBe('');
            expect(await page.evaluate(() => pos.turn)).toBe('b');
            expect(await page.evaluate(() => selected)).toBe(null);
        });

        test('clicking the piece again deselects it', async ({ page }) => {
            await setup(page, START_FEN);
            await clickSquareName(page, 'e2');
            await clickSquareName(page, 'e2');
            expect(await page.evaluate(() => selected)).toBe(null);
        });

        test('clicking another of your pieces switches the selection', async ({ page }) => {
            await setup(page, START_FEN);
            await clickSquareName(page, 'e2');
            await clickSquareName(page, 'd2');
            expect(await page.evaluate(() => selected)).toEqual([6, 3]);
        });

        test('clicking an illegal target leaves the board alone', async ({ page }) => {
            await setup(page, START_FEN);
            await clickSquareName(page, 'e2');
            await clickSquareName(page, 'e5');
            expect(await boardAt(page, 'e2')).toBe('P');
            expect(await page.evaluate(() => pos.turn)).toBe('w');
        });

        test('the move list records the move in notation', async ({ page }) => {
            await setup(page, START_FEN);
            await clickSquareName(page, 'g1');
            await clickSquareName(page, 'f3');
            await expect(page.locator('#move-list')).toContainText('Nf3');
        });

        test('a pawn reaching the last rank asks which piece', async ({ page }) => {
            await setup(page, '4k3/P7/8/8/8/8/4P3/4K3 w - - 0 1');
            await clickSquareName(page, 'a7');
            await clickSquareName(page, 'a8');
            await expect(page.locator('#promotion')).toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('promoting');
            await page.locator('#promote-n').click();
            expect(await boardAt(page, 'a8')).toBe('N');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#promotion')).not.toHaveClass(/visible/);
        });

        test('promoting to a queen is the default button', async ({ page }) => {
            await setup(page, '4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
            await clickSquareName(page, 'a7');
            await clickSquareName(page, 'a8');
            await page.locator('#promote-q').click();
            expect(await boardAt(page, 'a8')).toBe('Q');
        });
    });

    // -----------------------------------------------------------------------
    // Status, undo and restart
    // -----------------------------------------------------------------------
    test.describe('status and controls', () => {
        test('the status line says whose move it is', async ({ page }) => {
            await setup(page, START_FEN);
            await expect(page.locator('#status')).toContainText(/your move/i);
        });

        test('the status line announces check', async ({ page }) => {
            await setup(page, '4r2k/8/8/8/8/8/8/4K3 w - - 0 1');
            await expect(page.locator('#status')).toContainText(/check/i);
        });

        test('checkmate ends the game and names the winner', async ({ page }) => {
            await setup(page, '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1');
            await clickSquareName(page, 'a1');
            await clickSquareName(page, 'a8');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('over');
            expect(await page.evaluate(() => result)).toBe('1-0');
            await expect(page.locator('#overlay-title')).toContainText(/checkmate/i);
        });

        test('the game-over overlay offers another game', async ({ page }) => {
            await setup(page, '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1');
            await clickSquareName(page, 'a1');
            await clickSquareName(page, 'a8');
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => toFen(pos))).toBe(START_FEN);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('stalemate ends the game as a draw', async ({ page }) => {
            await setup(page, '7k/6Q1/8/8/8/8/8/K7 w - - 0 1');
            await clickSquareName(page, 'g7');
            await clickSquareName(page, 'g6');
            expect(await page.evaluate(() => state)).toBe('over');
            expect(await page.evaluate(() => result)).toBe('1/2-1/2');
            await expect(page.locator('#overlay-title')).toContainText(/draw|stalemate/i);
        });

        test('U takes back your move', async ({ page }) => {
            await setup(page, START_FEN);
            await clickSquareName(page, 'e2');
            await clickSquareName(page, 'e4');
            await page.keyboard.press('u');
            expect(await page.evaluate(() => toFen(pos))).toBe(START_FEN);
            expect(await page.evaluate(() => pos.turn)).toBe('w');
        });

        test('U with nothing to undo is harmless', async ({ page }) => {
            await setup(page, START_FEN);
            await page.keyboard.press('u');
            expect(await page.evaluate(() => toFen(pos))).toBe(START_FEN);
            expect(errors).toEqual([]);
        });

        test('R starts a new game from the opening position', async ({ page }) => {
            await setup(page, '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1');
            await page.keyboard.press('r');
            expect(await page.evaluate(() => toFen(pos))).toBe(START_FEN);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('U takes back the engine reply as well as your move', async ({ page }) => {
            await setup(page, START_FEN, { ai: true });
            await clickSquareName(page, 'e2');
            await clickSquareName(page, 'e4');
            await page.waitForFunction(() => pos.turn === 'w', null, { timeout: 5000 });
            await page.keyboard.press('u');
            expect(await page.evaluate(() => toFen(pos))).toBe(START_FEN);
            expect(await page.evaluate(() => moveHistory.length)).toBe(0);
        });

        test('taking back while the engine is thinking cancels its reply', async ({ page }) => {
            await setup(page, START_FEN, { ai: true });
            await clickSquareName(page, 'e2');
            await clickSquareName(page, 'e4');
            await page.keyboard.press('u');
            await page.waitForTimeout(700);
            expect(await page.evaluate(() => toFen(pos))).toBe(START_FEN);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('threefold repetition is a draw', async ({ page }) => {
            await setup(page, '4k2r/8/8/8/8/8/8/R3K3 w - - 0 1');
            // Rooks shuffle back and forth until the position shows up a third time.
            const shuffle = [
                ['a1', 'b1'],
                ['h8', 'g8'],
                ['b1', 'a1'],
                ['g8', 'h8'],
                ['a1', 'b1'],
                ['h8', 'g8'],
                ['b1', 'a1'],
                ['g8', 'h8'],
            ];
            for (const [from, to] of shuffle) {
                if ((await page.evaluate(() => state)) !== 'playing') break;
                await page.evaluate(
                    ([from, to]) => {
                        const [fr, fc] = parseSquare(from);
                        const [tr, tc] = parseSquare(to);
                        const move = legalMoves(pos).find(
                            (m) =>
                                m.from[0] === fr && m.from[1] === fc && m.to[0] === tr && m.to[1] === tc
                        );
                        commitMove(move);
                    },
                    [from, to]
                );
            }
            expect(await page.evaluate(() => state)).toBe('over');
            expect(await page.evaluate(() => result)).toBe('1/2-1/2');
        });
    });

    // -----------------------------------------------------------------------
    // The engine
    // -----------------------------------------------------------------------
    test.describe('the engine', () => {
        test.setTimeout(30_000);

        test('evaluation counts material from White\'s point of view', async ({ page }) => {
            const got = await page.evaluate(() => [
                Math.sign(evaluate(loadFen('4k3/8/8/8/8/8/8/3QK3 w - - 0 1'))),
                Math.sign(evaluate(loadFen('3qk3/8/8/8/8/8/8/4K3 w - - 0 1'))),
                Math.sign(evaluate(loadFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1'))),
            ]);
            expect(got).toEqual([1, -1, 0]);
        });

        test('answers a move within a second and keeps it legal', async ({ page }) => {
            await setup(page, START_FEN, { ai: true });
            await clickSquareName(page, 'e2');
            await clickSquareName(page, 'e4');
            await page.waitForFunction(() => pos.turn === 'w', null, { timeout: 5000 });
            const fen = await page.evaluate(() => toFen(pos));
            expect(fen).not.toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
            expect(await page.evaluate(() => moveHistory.length)).toBe(2);
            expect(errors).toEqual([]);
        });

        test('takes a free queen', async ({ page }) => {
            await setup(page, '4q2k/8/8/8/8/8/8/4Q2K b - - 0 1', { ai: true });
            await page.evaluate(() => engineMove());
            await page.waitForFunction(() => pos.turn === 'w', null, { timeout: 5000 });
            expect(await boardAt(page, 'e1')).toBe('q');
        });

        test('finds a mate in one', async ({ page }) => {
            await setup(page, '6rk/8/8/8/8/8/5q2/7K b - - 0 1', { ai: true });
            await page.evaluate(() => engineMove());
            await page.waitForFunction(() => state === 'over', null, { timeout: 5000 });
            expect(await page.evaluate(() => result)).toBe('0-1');
        });

        test('escapes a mate threat rather than ignoring it', async ({ page }) => {
            // Black is a rook up but must answer the threat of Rh8#.
            await setup(page, '6k1/5ppp/8/8/8/8/1r6/R6K b - - 0 1', { ai: true });
            await page.evaluate(() => engineMove());
            await page.waitForFunction(() => pos.turn === 'w', null, { timeout: 5000 });
            const mated = await page.evaluate(() => {
                const mate = legalMoves(pos).some(
                    (m) => gameStatus(applyMove(pos, m)) === 'checkmate'
                );
                return mate;
            });
            expect(mated).toBe(false);
        });

        test('does not move when it is not its turn', async ({ page }) => {
            await setup(page, START_FEN, { ai: true });
            await page.waitForTimeout(400);
            expect(await page.evaluate(() => toFen(pos))).toBe(START_FEN);
        });
    });
});
