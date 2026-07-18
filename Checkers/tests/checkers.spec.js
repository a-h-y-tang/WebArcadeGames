const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start a game, then clear the board and place an exact position, with the AI
// disabled so tests fully control the board.
async function setup(page, place, player = 1) {
    await page.evaluate(
        ({ place, player }) => {
            startGame();
            aiEnabled = false;
            for (let r = 0; r < ROWS; r++)
                for (let c = 0; c < COLS; c++) board[r][c] = 0;
            for (const [r, c, v] of place) board[r][c] = v;
            currentPlayer = player;
            selected = null;
            state = 'playing';
        },
        { place, player }
    );
}

test.describe('Checkers', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => localStorage.clear());
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Checkers', async ({ page }) => {
            await expect(page).toHaveTitle('Checkers');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('state starts as ready', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('ready');
        });

        test('canvas is 560×560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('board is 8×8', async ({ page }) => {
            const dims = await page.evaluate(() => ({
                rows: board.length,
                cols: board[0].length,
                ROWS,
                COLS,
            }));
            expect(dims).toEqual({ rows: 8, cols: 8, ROWS: 8, COLS: 8 });
        });

        test('each side starts with 12 pieces', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                red: countPieces(1),
                black: countPieces(2),
            }));
            expect(counts).toEqual({ red: 12, black: 12 });
        });

        test('red starts on the bottom rows, black on the top rows', async ({ page }) => {
            const info = await page.evaluate(() => ({
                topDark: board[0][1],
                bottomDark: board[7][0],
                midEmpty: board[3][2],
            }));
            expect(info.topDark).toBe(2); // black
            expect(info.bottomDark).toBe(1); // red
            expect(info.midEmpty).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    test.describe('piece helpers', () => {
        test('ownerOf identifies sides', async ({ page }) => {
            const o = await page.evaluate(() => [
                ownerOf(0), ownerOf(1), ownerOf(2), ownerOf(3), ownerOf(4),
            ]);
            expect(o).toEqual([0, 1, 2, 1, 2]);
        });

        test('isKing identifies kings', async ({ page }) => {
            const k = await page.evaluate(() => [
                isKing(1), isKing(2), isKing(3), isKing(4),
            ]);
            expect(k).toEqual([false, false, true, true]);
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('a red man has two forward diagonal moves on an open board', async ({ page }) => {
            await setup(page, [[5, 2, 1]]);
            const moves = await page.evaluate(() => getPieceMoves(5, 2));
            const targets = moves.map((m) => m.to.join(',')).sort();
            expect(targets).toEqual(['4,1', '4,3']);
        });

        test('a red man never moves backward', async ({ page }) => {
            await setup(page, [[5, 2, 1]]);
            const rows = await page.evaluate(() =>
                getPieceMoves(5, 2).map((m) => m.to[0])
            );
            expect(rows.every((r) => r < 5)).toBe(true);
        });

        test('a black man moves downward', async ({ page }) => {
            await setup(page, [[2, 3, 2]], 2);
            const targets = await page.evaluate(() =>
                getPieceMoves(2, 3).map((m) => m.to.join(',')).sort()
            );
            expect(targets).toEqual(['3,2', '3,4']);
        });

        test('applying a simple move relocates the piece', async ({ page }) => {
            await setup(page, [[5, 2, 1]]);
            await page.evaluate(() => {
                const m = getPieceMoves(5, 2).find((x) => x.to[0] === 4 && x.to[1] === 1);
                applyMove(m);
            });
            const cells = await page.evaluate(() => ({
                from: board[5][2],
                to: board[4][1],
            }));
            expect(cells).toEqual({ from: 0, to: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Captures
    // -----------------------------------------------------------------------
    test.describe('captures', () => {
        test('a capture is available over an adjacent enemy', async ({ page }) => {
            await setup(page, [[5, 2, 1], [4, 3, 2]]);
            const moves = await page.evaluate(() => getMoves(1));
            expect(moves.length).toBe(1);
            expect(moves[0].to).toEqual([3, 4]);
            expect(moves[0].captures).toEqual([[4, 3]]);
        });

        test('captures are mandatory — simple moves are excluded', async ({ page }) => {
            await setup(page, [[5, 2, 1], [4, 3, 2]]);
            const allCaptures = await page.evaluate(() =>
                getMoves(1).every((m) => m.captures.length > 0)
            );
            expect(allCaptures).toBe(true);
        });

        test('applying a capture removes the jumped piece', async ({ page }) => {
            await setup(page, [[5, 2, 1], [4, 3, 2]]);
            await page.evaluate(() => applyMove(getMoves(1)[0]));
            const info = await page.evaluate(() => ({
                jumped: board[4][3],
                landed: board[3][4],
                blackLeft: countPieces(2),
            }));
            expect(info.jumped).toBe(0);
            expect(info.landed).toBe(1);
            expect(info.blackLeft).toBe(0);
        });

        test('a double jump captures two pieces in one move', async ({ page }) => {
            await setup(page, [[5, 4, 1], [4, 3, 2], [2, 3, 2]]);
            const move = await page.evaluate(() =>
                getPieceMoves(5, 4).find((m) => m.captures.length === 2)
            );
            expect(move).toBeTruthy();
            expect(move.to).toEqual([1, 4]);
        });

        test('applying a double jump removes both pieces', async ({ page }) => {
            await setup(page, [[5, 4, 1], [4, 3, 2], [2, 3, 2]]);
            await page.evaluate(() => {
                const m = getPieceMoves(5, 4).find((x) => x.captures.length === 2);
                applyMove(m);
            });
            const black = await page.evaluate(() => countPieces(2));
            expect(black).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Kings
    // -----------------------------------------------------------------------
    test.describe('kings', () => {
        test('a red man reaching the top row is crowned', async ({ page }) => {
            await setup(page, [[1, 2, 1]]);
            await page.evaluate(() => {
                const m = getPieceMoves(1, 2).find((x) => x.to[0] === 0 && x.to[1] === 1);
                applyMove(m);
            });
            const v = await page.evaluate(() => board[0][1]);
            expect(v).toBe(3); // red king
        });

        test('a king moves both forward and backward', async ({ page }) => {
            await setup(page, [[4, 4, 3]]); // red king, open board
            const targets = await page.evaluate(() =>
                getPieceMoves(4, 4).map((m) => m.to.join(',')).sort()
            );
            expect(targets).toEqual(['3,3', '3,5', '5,3', '5,5']);
        });
    });

    // -----------------------------------------------------------------------
    // AI
    // -----------------------------------------------------------------------
    test.describe('AI', () => {
        test('bestMove returns a well-formed move', async ({ page }) => {
            await setup(page, [[5, 2, 1], [2, 3, 2]], 2);
            const m = await page.evaluate(() => bestMove(2));
            expect(Array.isArray(m.from)).toBe(true);
            expect(Array.isArray(m.to)).toBe(true);
            expect(m.from.length).toBe(2);
        });

        test('the AI makes a mandatory capture when one exists', async ({ page }) => {
            await setup(page, [[3, 2, 2], [4, 3, 1]], 2);
            const m = await page.evaluate(() => bestMove(2));
            expect(m.captures.length).toBeGreaterThan(0);
            expect(m.to).toEqual([5, 4]);
        });

        test('the AI is deterministic for the same position', async ({ page }) => {
            await setup(page, [[5, 2, 1], [5, 4, 1], [2, 3, 2], [2, 5, 2]], 2);
            const [a, b] = await page.evaluate(() => [
                JSON.stringify(bestMove(2)),
                JSON.stringify(bestMove(2)),
            ]);
            expect(a).toBe(b);
        });

        test('after the human moves the AI responds automatically', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => applyMove(getMoves(1)[0]));
            await page.waitForFunction(() => currentPlayer === 1, null, {
                timeout: 8000,
            });
            const p = await page.evaluate(() => currentPlayer);
            expect(p).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('getMoves is empty for a side with no pieces', async ({ page }) => {
            await setup(page, [[5, 2, 1]]);
            const n = await page.evaluate(() => getMoves(2).length);
            expect(n).toBe(0);
        });

        test('an immobile side has no legal moves', async ({ page }) => {
            // A lone black man on the very bottom row cannot move down.
            await setup(page, [[7, 0, 2]], 2);
            const n = await page.evaluate(() => getMoves(2).length);
            expect(n).toBe(0);
        });

        test('capturing the last enemy piece ends the game', async ({ page }) => {
            await setup(page, [[5, 2, 1], [4, 3, 2]]);
            await page.evaluate(() => applyMove(getMoves(1)[0]));
            const info = await page.evaluate(() => ({ state, winner }));
            expect(info.state).toBe('over');
            expect(info.winner).toBe(1);
        });

        test('game over overlay announces the winner', async ({ page }) => {
            await setup(page, [[5, 2, 1], [4, 3, 2]]);
            await page.evaluate(() => applyMove(getMoves(1)[0]));
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('win');
        });

        test('no moves are accepted after game over', async ({ page }) => {
            await setup(page, [[5, 2, 1], [4, 3, 2]]);
            await page.evaluate(() => applyMove(getMoves(1)[0])); // red wins
            const before = await page.evaluate(() => countPieces(1));
            await page.evaluate(() => clickSquare(3, 4));
            await page.evaluate(() => clickSquare(2, 5));
            const after = await page.evaluate(() => countPieces(1));
            expect(after).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Selection and clicking
    // -----------------------------------------------------------------------
    test.describe('selection', () => {
        test('clicking your own movable piece selects it', async ({ page }) => {
            await setup(page, [[5, 2, 1]]);
            await page.evaluate(() => clickSquare(5, 2));
            const sel = await page.evaluate(() => selected);
            expect(sel).toEqual([5, 2]);
        });

        test('clicking an opponent piece does not select it', async ({ page }) => {
            await setup(page, [[5, 2, 1], [2, 3, 2]]);
            await page.evaluate(() => clickSquare(2, 3));
            const sel = await page.evaluate(() => selected);
            expect(sel).toBeNull();
        });

        test('clicking a legal target moves the selected piece', async ({ page }) => {
            await setup(page, [[5, 2, 1]]);
            await page.evaluate(() => {
                clickSquare(5, 2);
                clickSquare(4, 1);
            });
            const info = await page.evaluate(() => ({
                from: board[5][2],
                to: board[4][1],
                sel: selected,
            }));
            expect(info.from).toBe(0);
            expect(info.to).toBe(1);
            expect(info.sel).toBeNull();
        });

        test('clicking an empty non-target square deselects', async ({ page }) => {
            await setup(page, [[5, 2, 1]]);
            await page.evaluate(() => {
                clickSquare(5, 2);
                clickSquare(3, 6); // not a legal destination
            });
            const info = await page.evaluate(() => ({
                sel: selected,
                stillThere: board[5][2],
            }));
            expect(info.sel).toBeNull();
            expect(info.stillThere).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Restart
    // -----------------------------------------------------------------------
    test.describe('restart', () => {
        test('R restarts to the opening position', async ({ page }) => {
            await setup(page, [[5, 2, 1]]);
            await page.keyboard.press('r');
            const info = await page.evaluate(() => ({
                red: countPieces(1),
                black: countPieces(2),
                state,
            }));
            expect(info).toEqual({ red: 12, black: 12, state: 'playing' });
        });

        test('Play Again restarts after game over', async ({ page }) => {
            await setup(page, [[5, 2, 1], [4, 3, 2]]);
            await page.evaluate(() => applyMove(getMoves(1)[0])); // game over
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const counts = await page.evaluate(() => ({
                red: countPieces(1),
                black: countPieces(2),
            }));
            expect(counts).toEqual({ red: 12, black: 12 });
        });
    });
});
