const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Helper: clear the board to all-empty and force a clean 'playing' state so a
// test can build an exact position without any leftover stones.
async function clearBoard(page) {
    await page.evaluate(() => {
        for (let r = 0; r < N; r++)
            for (let c = 0; c < N; c++) board[r][c] = 0;
        state = 'playing';
        winner = 0;
        moveCount = 0;
        draw();
    });
}

test.describe('Hex', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Hex', async ({ page }) => {
            await expect(page).toHaveTitle(/Hex/);
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal (connecting sides)', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('connect');
        });

        test('game state is idle before start', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('board is 11×11', async ({ page }) => {
            const dims = await page.evaluate(() => [board.length, board[0].length, N]);
            expect(dims).toEqual([11, 11, 11]);
        });

        test('board starts empty (all zeros)', async ({ page }) => {
            const total = await page.evaluate(() =>
                board.flat().reduce((a, b) => a + b, 0));
            expect(total).toBe(0);
        });

        test('red (player 1) moves first', async ({ page }) => {
            expect(await page.evaluate(() => current)).toBe(1);
        });

        test('move count starts at 0', async ({ page }) => {
            expect(await page.evaluate(() => moveCount)).toBe(0);
        });

        test('canvas has fixed pixel dimensions', async ({ page }) => {
            const c = page.locator('#canvas');
            expect(parseInt(await c.getAttribute('width'))).toBeGreaterThan(0);
            expect(parseInt(await c.getAttribute('height'))).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a key starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('starting deals an empty board with red to move', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => ({
                sum: board.flat().reduce((a, b) => a + b, 0),
                current, moveCount,
            }));
            expect(r).toEqual({ sum: 0, current: 1, moveCount: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Adjacency (the six hex neighbours)
    // -----------------------------------------------------------------------
    test.describe('neighbours', () => {
        test('an interior cell has exactly six neighbours', async ({ page }) => {
            const n = await page.evaluate(() => neighbors(5, 5).length);
            expect(n).toBe(6);
        });

        test('neighbours include the two hex diagonals, exclude the square diagonals', async ({ page }) => {
            const res = await page.evaluate(() => {
                const set = new Set(neighbors(5, 5).map(([r, c]) => r + ',' + c));
                return {
                    upRight:   set.has('4,6'),  // hex diagonal — present
                    downLeft:  set.has('6,4'),  // hex diagonal — present
                    upLeft:    set.has('4,4'),  // square diagonal — absent
                    downRight: set.has('6,6'),  // square diagonal — absent
                    orthoUp:   set.has('4,5'),
                    orthoDown: set.has('6,5'),
                    orthoLeft: set.has('5,4'),
                    orthoRight:set.has('5,6'),
                };
            });
            expect(res).toEqual({
                upRight: true, downLeft: true,
                upLeft: false, downRight: false,
                orthoUp: true, orthoDown: true, orthoLeft: true, orthoRight: true,
            });
        });

        test('acute corners have two neighbours', async ({ page }) => {
            const counts = await page.evaluate(() =>
                [neighbors(0, 0).length, neighbors(10, 10).length]);
            expect(counts).toEqual([2, 2]);
        });

        test('obtuse corners have three neighbours', async ({ page }) => {
            const counts = await page.evaluate(() =>
                [neighbors(0, 10).length, neighbors(10, 0).length]);
            expect(counts).toEqual([3, 3]);
        });

        test('neighbours never leave the board', async ({ page }) => {
            const bad = await page.evaluate(() => {
                for (let r = 0; r < N; r++)
                    for (let c = 0; c < N; c++)
                        for (const [nr, nc] of neighbors(r, c))
                            if (nr < 0 || nr >= N || nc < 0 || nc >= N) return true;
                return false;
            });
            expect(bad).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Placing stones
    // -----------------------------------------------------------------------
    test.describe('placing stones', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('placing sets the cell to the current colour', async ({ page }) => {
            const v = await page.evaluate(() => { place(3, 4); return board[3][4]; });
            expect(v).toBe(1); // red
        });

        test('placing flips the turn to the other player', async ({ page }) => {
            const c = await page.evaluate(() => { place(3, 4); return current; });
            expect(c).toBe(2); // blue's turn now
        });

        test('two placements alternate colours', async ({ page }) => {
            const cells = await page.evaluate(() => {
                place(0, 0); // red
                place(0, 1); // blue
                return [board[0][0], board[0][1], current];
            });
            expect(cells).toEqual([1, 2, 1]); // red, blue, back to red
        });

        test('placing increments the move count', async ({ page }) => {
            const m = await page.evaluate(() => { place(2, 2); place(3, 3); return moveCount; });
            expect(m).toBe(2);
        });

        test('placing on an occupied cell is ignored', async ({ page }) => {
            const r = await page.evaluate(() => {
                place(4, 4);            // red
                const before = current; // blue
                place(4, 4);            // illegal — still blue's turn
                return { colour: board[4][4], turnUnchanged: current === before, moveCount };
            });
            expect(r.colour).toBe(1);
            expect(r.turnUnchanged).toBe(true);
            expect(r.moveCount).toBe(1);
        });

        test('placing does nothing before the game starts', async ({ page }) => {
            await page.reload();
            const r = await page.evaluate(() => { place(5, 5); return { v: board[5][5], moveCount, state }; });
            expect(r).toEqual({ v: 0, moveCount: 0, state: 'idle' });
        });
    });

    // -----------------------------------------------------------------------
    // Connection detection
    // -----------------------------------------------------------------------
    test.describe('connection detection', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
            await clearBoard(page);
        });

        test('an empty board connects for nobody', async ({ page }) => {
            const r = await page.evaluate(() => [connects(1), connects(2)]);
            expect(r).toEqual([false, false]);
        });

        test('a full red column links top to bottom (red wins)', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (let row = 0; row < N; row++) board[row][5] = 1;
                return connects(1);
            });
            expect(r).toBe(true);
        });

        test('a red column short of the bottom does not connect', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (let row = 0; row < N - 1; row++) board[row][5] = 1; // missing last row
                return connects(1);
            });
            expect(r).toBe(false);
        });

        test('a full blue row links left to right (blue wins)', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (let col = 0; col < N; col++) board[6][col] = 2;
                return connects(2);
            });
            expect(r).toBe(true);
        });

        test('a red horizontal row does NOT connect red (wrong edges)', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (let col = 0; col < N; col++) board[6][col] = 1; // red across — irrelevant for red
                return connects(1);
            });
            expect(r).toBe(false);
        });

        test('a staircase using the hex diagonal connects', async ({ page }) => {
            // Walk (0,0)->(1,0)->... impossible past col limits; instead use the
            // down-left diagonal from top-right to bottom-left: (r+1, c-1).
            const r = await page.evaluate(() => {
                let c = N - 1;
                for (let row = 0; row < N; row++) { board[row][c] = 1; c--; }
                return connects(1);
            });
            expect(r).toBe(true);
        });

        test('two separate red groups that never touch do not connect', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (let row = 0; row < 5; row++) board[row][2] = 1;   // top group
                for (let row = 7; row < N; row++) board[row][2] = 1;   // bottom group, gap at rows 5,6
                return connects(1);
            });
            expect(r).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
            await clearBoard(page);
        });

        test('completing a red connection with place() wins for red', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (let row = 0; row < N - 1; row++) board[row][4] = 1; // one short
                current = 1;
                place(N - 1, 4); // the winning stone
                return { state, winner };
            });
            expect(r).toEqual({ state: 'won', winner: 1 });
        });

        test('completing a blue connection with place() wins for blue', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (let col = 0; col < N - 1; col++) board[3][col] = 2; // one short
                current = 2;
                place(3, N - 1);
                return { state, winner };
            });
            expect(r).toEqual({ state: 'won', winner: 2 });
        });

        test('a non-winning move keeps the game playing', async ({ page }) => {
            const r = await page.evaluate(() => {
                current = 1;
                place(5, 5);
                return { state, winner };
            });
            expect(r).toEqual({ state: 'playing', winner: 0 });
        });

        test('placing is refused once the game is won', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (let row = 0; row < N; row++) board[row][4] = 1;
                current = 1;
                checkWin();                 // resolve to won
                const before = moveCount;
                place(9, 9);                // should be ignored
                return { state, moveCount, unchanged: moveCount === before };
            });
            expect(r.state).toBe('won');
            expect(r.unchanged).toBe(true);
        });

        test('winning shows the result overlay naming the winner', async ({ page }) => {
            await page.evaluate(() => {
                for (let row = 0; row < N - 1; row++) board[row][4] = 1;
                current = 1;
                place(N - 1, 4);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/Red/i);
        });
    });

    // -----------------------------------------------------------------------
    // Swap (pie) rule
    // -----------------------------------------------------------------------
    test.describe('swap rule', () => {
        test('swap is not available before anyone has moved', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => swapAvailable)).toBe(false);
        });

        test('swap becomes available right after red’s first move', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => { place(2, 3); return { swapAvailable, current }; });
            expect(r).toEqual({ swapAvailable: true, current: 2 }); // blue to decide
        });

        test('the swap button is shown only when swap is available', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#btn-swap')).toHaveClass(/hidden/);
            await page.evaluate(() => place(2, 3));
            await expect(page.locator('#btn-swap')).not.toHaveClass(/hidden/);
        });

        test('swapping recolours red’s stone to blue and hands the turn back to red', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                place(2, 3);      // red opens
                swap();           // blue takes it
                return { colour: board[2][3], current, swapAvailable, moveCount };
            });
            expect(r).toEqual({ colour: 2, current: 1, swapAvailable: false, moveCount: 1 });
        });

        test('swap is gone after blue makes a normal reply', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                place(2, 3); // red
                place(4, 4); // blue plays instead of swapping
                return swapAvailable;
            });
            expect(r).toBe(false);
        });

        test('swap does nothing when it is not available', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                place(2, 3); // red
                place(4, 4); // blue
                const before = JSON.stringify(board);
                swap();      // no-op
                return { unchanged: JSON.stringify(board) === before, current };
            });
            expect(r.unchanged).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Clicking the canvas
    // -----------------------------------------------------------------------
    test.describe('clicking the canvas', () => {
        test('clicking a cell places a stone there', async ({ page }) => {
            await page.locator('#btn-start').click();
            const { x, y } = await page.evaluate(() => cellCenter(5, 5));
            await page.locator('#canvas').click({ position: { x, y } });
            const v = await page.evaluate(() => board[5][5]);
            expect(v).toBe(1);
        });

        test('a second click places the opponent stone in a different cell', async ({ page }) => {
            await page.locator('#btn-start').click();
            const a = await page.evaluate(() => cellCenter(2, 2));
            const b = await page.evaluate(() => cellCenter(8, 8));
            await page.locator('#canvas').click({ position: { x: a.x, y: a.y } });
            await page.locator('#canvas').click({ position: { x: b.x, y: b.y } });
            const cells = await page.evaluate(() => [board[2][2], board[8][8]]);
            expect(cells).toEqual([1, 2]);
        });
    });

    // -----------------------------------------------------------------------
    // New game / reset
    // -----------------------------------------------------------------------
    test.describe('new game', () => {
        test('R clears the board and starts a fresh game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { place(1, 1); place(2, 2); });
            await page.keyboard.press('r');
            const r = await page.evaluate(() => ({
                sum: board.flat().reduce((a, b) => a + b, 0),
                current, moveCount, state, winner,
            }));
            expect(r).toEqual({ sum: 0, current: 1, moveCount: 0, state: 'playing', winner: 0 });
        });

        test('the New Game button restarts after a win', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) board[r][c] = 0;
                for (let row = 0; row < N - 1; row++) board[row][4] = 1;
                current = 1; state = 'playing'; winner = 0;
                place(N - 1, 4); // red wins
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => ({ state, sum: board.flat().reduce((a, b) => a + b, 0) }));
            expect(r).toEqual({ state: 'playing', sum: 0 });
        });
    });
});
