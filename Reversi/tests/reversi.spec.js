const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Cell value constants mirrored from game.js.
const EMPTY = 0, BLACK = 1, WHITE = 2;

test.describe('Reversi', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Scaffolding & initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Reversi', async ({ page }) => {
            await expect(page).toHaveTitle('Reversi');
        });

        test('canvas exists and is 480x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toBeVisible();
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('exposes a game object on window', async ({ page }) => {
            expect(await page.evaluate(() => typeof window.game)).toBe('object');
        });

        test('board is 8x8', async ({ page }) => {
            const dims = await page.evaluate(() => ({
                rows: game.board.length,
                cols: game.board[0].length,
            }));
            expect(dims).toEqual({ rows: 8, cols: 8 });
        });

        test('opening position has the four centre discs', async ({ page }) => {
            const cells = await page.evaluate(() => ({
                a: game.board[3][3],
                b: game.board[4][4],
                c: game.board[3][4],
                d: game.board[4][3],
            }));
            expect(cells).toEqual({ a: WHITE, b: WHITE, c: BLACK, d: BLACK });
        });

        test('all non-centre cells start empty', async ({ page }) => {
            const empties = await page.evaluate(() => {
                let n = 0;
                for (let r = 0; r < 8; r++)
                    for (let c = 0; c < 8; c++)
                        if (game.board[r][c] === 0) n++;
                return n;
            });
            expect(empties).toBe(60);
        });

        test('black moves first', async ({ page }) => {
            expect(await page.evaluate(() => game.currentPlayer)).toBe(BLACK);
        });

        test('starts in the playing state', async ({ page }) => {
            expect(await page.evaluate(() => game.state)).toBe('playing');
        });

        test('opening score is 2-2', async ({ page }) => {
            const s = await page.evaluate(() => game.scores());
            expect(s).toEqual({ black: 2, white: 2 });
        });

        test('HUD shows the opening scores', async ({ page }) => {
            await expect(page.locator('#black-score')).toHaveText('2');
            await expect(page.locator('#white-score')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Legal move detection
    // -----------------------------------------------------------------------
    test.describe('legal moves', () => {
        test('black has exactly four opening moves', async ({ page }) => {
            const moves = await page.evaluate(() =>
                game.legalMoves(BLACK).map(([r, c]) => r + ',' + c).sort()
            );
            expect(moves).toEqual(['2,3', '3,2', '4,5', '5,4']);
        });

        test('isLegalMove is true for a flanking cell', async ({ page }) => {
            expect(await page.evaluate(() => game.isLegalMove(2, 3, BLACK))).toBe(true);
        });

        test('isLegalMove is false for a non-flanking empty cell', async ({ page }) => {
            expect(await page.evaluate(() => game.isLegalMove(0, 0, BLACK))).toBe(false);
        });

        test('isLegalMove is false for an occupied cell', async ({ page }) => {
            expect(await page.evaluate(() => game.isLegalMove(3, 3, BLACK))).toBe(false);
        });

        test('white also has four opening moves', async ({ page }) => {
            const n = await page.evaluate(() => game.legalMoves(WHITE).length);
            expect(n).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Playing a move / flipping
    // -----------------------------------------------------------------------
    test.describe('playing a move', () => {
        test('playing (2,3) as black flips the flanked white disc', async ({ page }) => {
            const res = await page.evaluate(() => {
                const ok = game.play(2, 3);
                return {
                    ok,
                    placed: game.board[2][3],
                    flipped: game.board[3][3], // was white, now black
                };
            });
            expect(res.ok).toBe(true);
            expect(res.placed).toBe(BLACK);
            expect(res.flipped).toBe(BLACK);
        });

        test('a legal move updates the score to 4-1', async ({ page }) => {
            const s = await page.evaluate(() => {
                game.play(2, 3);
                return game.scores();
            });
            expect(s).toEqual({ black: 4, white: 1 });
        });

        test('the turn passes to white after a black move', async ({ page }) => {
            const p = await page.evaluate(() => {
                game.play(2, 3);
                return game.currentPlayer;
            });
            expect(p).toBe(WHITE);
        });

        test('an illegal move is rejected and changes nothing', async ({ page }) => {
            const res = await page.evaluate(() => {
                const ok = game.play(0, 0);
                return { ok, player: game.currentPlayer, scores: game.scores() };
            });
            expect(res.ok).toBe(false);
            expect(res.player).toBe(BLACK);
            expect(res.scores).toEqual({ black: 2, white: 2 });
        });

        test('cannot play on an occupied cell', async ({ page }) => {
            expect(await page.evaluate(() => game.play(3, 3))).toBe(false);
        });

        test('flipping captures a run of two in one direction', async ({ page }) => {
            const res = await page.evaluate(() => {
                // Row 4: black at col 1, white at cols 2 and 3, empty at col 4.
                const g = Array.from({ length: 8 }, () => Array(8).fill(0));
                g[4][1] = 1; g[4][2] = 2; g[4][3] = 2;
                game.setBoard(g, 1); // black to move
                const ok = game.play(4, 4); // flanks (4,2)&(4,3)
                return {
                    ok,
                    c2: game.board[4][2],
                    c3: game.board[4][3],
                    c4: game.board[4][4],
                };
            });
            expect(res.ok).toBe(true);
            expect(res).toMatchObject({ c2: BLACK, c3: BLACK, c4: BLACK });
        });
    });

    // -----------------------------------------------------------------------
    // Passing & game over (via the setBoard hook)
    // -----------------------------------------------------------------------
    test.describe('passing and game over', () => {
        test('a player with no move is passed automatically', async ({ page }) => {
            const player = await page.evaluate(() => {
                // Board where black (to move) has no legal move but white does.
                // Fill top rows with white, leave a spot only white can use.
                const g = Array.from({ length: 8 }, () => Array(8).fill(0));
                // A lone white disc with an adjacent black gives white a move but
                // black nothing to flank.
                g[0][0] = 2; g[0][1] = 1; // white, black
                // Black has no way to flank (no white between two blacks anywhere).
                game.setBoard(g, 1); // ask black to move
                return game.currentPlayer;
            });
            // Black cannot move, so the turn is handed to white.
            expect(player).toBe(WHITE);
        });

        test('game ends when neither player can move', async ({ page }) => {
            const res = await page.evaluate(() => {
                // Completely full board, black leads 3 to 1 in this corner sample.
                const g = Array.from({ length: 8 }, () => Array(8).fill(1)); // all black
                g[0][0] = 2; // one white
                game.setBoard(g, 1);
                return { state: game.state, winner: game.winner };
            });
            expect(res.state).toBe('gameover');
            expect(res.winner).toBe('black');
        });

        test('a tied full board is a draw', async ({ page }) => {
            const res = await page.evaluate(() => {
                const g = Array.from({ length: 8 }, (_, r) =>
                    Array.from({ length: 8 }, () => (r < 4 ? 1 : 2))
                );
                game.setBoard(g, 1);
                return { state: game.state, winner: game.winner, scores: game.scores() };
            });
            expect(res.state).toBe('gameover');
            expect(res.scores).toEqual({ black: 32, white: 32 });
            expect(res.winner).toBe('draw');
        });

        test('white wins when it has more discs on a locked board', async ({ page }) => {
            const winner = await page.evaluate(() => {
                const g = Array.from({ length: 8 }, () => Array(8).fill(2)); // all white
                g[0][0] = 1;
                game.setBoard(g, 1);
                return game.winner;
            });
            expect(winner).toBe('white');
        });
    });

    // -----------------------------------------------------------------------
    // AI opponent
    // -----------------------------------------------------------------------
    test.describe('AI', () => {
        test('aiMove plays a legal white move and changes the board', async ({ page }) => {
            const res = await page.evaluate(() => {
                game.play(2, 3);          // black moves, now white's turn
                const before = game.scores().white;
                const legalBefore = game.legalMoves(WHITE).length;
                game.aiMove();            // white responds
                return {
                    legalBefore,
                    whiteBefore: before,
                    whiteAfter: game.scores().white,
                    player: game.currentPlayer,
                };
            });
            expect(res.legalBefore).toBeGreaterThan(0);
            // White placed a disc and flipped at least one black -> count rose.
            expect(res.whiteAfter).toBeGreaterThan(res.whiteBefore);
        });

        test('aiMove prefers a corner when one is available', async ({ page }) => {
            const corner = await page.evaluate(() => {
                // Set up so that white can take corner (0,0) by flanking (0,1)
                // over a black disc, and give a duller alternative elsewhere.
                const g = Array.from({ length: 8 }, () => Array(8).fill(0));
                g[0][1] = 1; g[0][2] = 2;     // white can play (0,0) to take corner
                g[5][5] = 1; g[5][6] = 2;     // white can also play (5,4)... a plain move
                g[4][4] = 2;                  // keep board from being trivial
                game.setBoard(g, 2);          // white to move
                game.aiMove();
                return game.board[0][0];      // did the AI grab the corner?
            });
            expect(corner).toBe(WHITE);
        });

        test('aiMove does nothing when it is not white to move', async ({ page }) => {
            const res = await page.evaluate(() => {
                const before = JSON.stringify(game.board);
                game.aiMove(); // black to move -> no-op
                return { changed: JSON.stringify(game.board) !== before, player: game.currentPlayer };
            });
            expect(res.changed).toBe(false);
            expect(res.player).toBe(BLACK);
        });
    });

    // -----------------------------------------------------------------------
    // Reset
    // -----------------------------------------------------------------------
    test.describe('reset', () => {
        test('reset restores the opening position', async ({ page }) => {
            const res = await page.evaluate(() => {
                game.play(2, 3);
                game.reset();
                return {
                    player: game.currentPlayer,
                    state: game.state,
                    scores: game.scores(),
                    centre: [game.board[3][3], game.board[4][4], game.board[3][4], game.board[4][3]],
                };
            });
            expect(res.player).toBe(BLACK);
            expect(res.state).toBe('playing');
            expect(res.scores).toEqual({ black: 2, white: 2 });
            expect(res.centre).toEqual([WHITE, WHITE, BLACK, BLACK]);
        });

        test('New Game button resets the board', async ({ page }) => {
            await page.evaluate(() => game.play(2, 3));
            await page.locator('#new-game').click();
            const s = await page.evaluate(() => game.scores());
            expect(s).toEqual({ black: 2, white: 2 });
        });

        test('pressing R resets the board', async ({ page }) => {
            await page.evaluate(() => game.play(2, 3));
            await page.keyboard.press('r');
            const s = await page.evaluate(() => game.scores());
            expect(s).toEqual({ black: 2, white: 2 });
        });
    });

    // -----------------------------------------------------------------------
    // Pointer input
    // -----------------------------------------------------------------------
    test.describe('input', () => {
        test('clicking a legal cell places a black disc there', async ({ page }) => {
            // Cell (2,3): centre at x=3*60+30, y=2*60+30.
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + 3 * 60 + 30, box.y + 2 * 60 + 30);
            // Black's disc lands immediately (AI reply happens after a delay).
            const placed = await page.evaluate(() => game.board[2][3]);
            expect(placed).toBe(BLACK);
        });

        test('clicking an illegal cell does nothing', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + 0 * 60 + 30, box.y + 0 * 60 + 30); // (0,0) illegal
            const cell = await page.evaluate(() => game.board[0][0]);
            expect(cell).toBe(EMPTY);
        });

        test('the AI eventually replies after a human move', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + 3 * 60 + 30, box.y + 2 * 60 + 30); // black plays (2,3)
            // Wait for the AI's scheduled reply.
            await page.waitForFunction(() => game.currentPlayer === 1 &&
                game.board.flat().filter((v) => v === 2).length >= 2, null, { timeout: 3000 });
            const whiteDiscs = await page.evaluate(() =>
                game.board.flat().filter((v) => v === 2).length
            );
            expect(whiteDiscs).toBeGreaterThanOrEqual(2);
        });
    });
});
