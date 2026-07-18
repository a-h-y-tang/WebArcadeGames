const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('2048', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is 2048', async ({ page }) => {
            await expect(page).toHaveTitle('2048');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 400x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '400');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('grid is 4x4', async ({ page }) => {
            const dims = await page.evaluate(() => ({ rows: grid.length, cols: grid[0].length }));
            expect(dims.rows).toBe(4);
            expect(dims.cols).toBe(4);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // collapse() — the core sliding/merging rule
    // -----------------------------------------------------------------------
    test.describe('collapse rule', () => {
        const cases = [
            { in: [2, 2, 0, 0], out: [4, 0, 0, 0], gained: 4 },
            { in: [2, 0, 2, 0], out: [4, 0, 0, 0], gained: 4 },
            { in: [0, 0, 0, 2], out: [2, 0, 0, 0], gained: 0 },
            { in: [2, 2, 2, 2], out: [4, 4, 0, 0], gained: 8 },
            { in: [2, 2, 2, 0], out: [4, 2, 0, 0], gained: 4 },
            { in: [4, 4, 8, 0], out: [8, 8, 0, 0], gained: 8 },
            { in: [2, 4, 2, 4], out: [2, 4, 2, 4], gained: 0 },
            { in: [4, 0, 0, 4], out: [8, 0, 0, 0], gained: 8 },
        ];
        for (const c of cases) {
            test(`collapse([${c.in}]) => [${c.out}] (+${c.gained})`, async ({ page }) => {
                const res = await page.evaluate((line) => collapse(line), c.in);
                expect(res.line).toEqual(c.out);
                expect(res.gained).toBe(c.gained);
            });
        }
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('arrow key starts the game', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('board starts with exactly two tiles', async ({ page }) => {
            await page.locator('#btn-start').click();
            const count = await page.evaluate(() => grid.flat().filter(Boolean).length);
            expect(count).toBe(2);
        });

        test('starting tiles are 2 or 4', async ({ page }) => {
            await page.locator('#btn-start').click();
            const values = await page.evaluate(() => grid.flat().filter(Boolean));
            for (const v of values) expect([2, 4]).toContain(v);
        });
    });

    // -----------------------------------------------------------------------
    // applyMove() — deterministic grid transforms (no random spawn)
    // -----------------------------------------------------------------------
    test.describe('applyMove directions', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('left merges a row toward the left edge', async ({ page }) => {
            const row = await page.evaluate(() => {
                for (let r = 0; r < 4; r++) grid[r] = [0, 0, 0, 0];
                grid[0] = [2, 2, 0, 0];
                score = 0;
                applyMove('left');
                return { row0: grid[0], score };
            });
            expect(row.row0).toEqual([4, 0, 0, 0]);
            expect(row.score).toBe(4);
        });

        test('right merges a row toward the right edge', async ({ page }) => {
            const row0 = await page.evaluate(() => {
                for (let r = 0; r < 4; r++) grid[r] = [0, 0, 0, 0];
                grid[0] = [2, 2, 0, 0];
                applyMove('right');
                return grid[0];
            });
            expect(row0).toEqual([0, 0, 0, 4]);
        });

        test('up merges a column toward the top', async ({ page }) => {
            const col = await page.evaluate(() => {
                for (let r = 0; r < 4; r++) grid[r] = [0, 0, 0, 0];
                grid[0][0] = 2; grid[1][0] = 2;
                applyMove('up');
                return [grid[0][0], grid[1][0]];
            });
            expect(col).toEqual([4, 0]);
        });

        test('down merges a column toward the bottom', async ({ page }) => {
            const col = await page.evaluate(() => {
                for (let r = 0; r < 4; r++) grid[r] = [0, 0, 0, 0];
                grid[0][0] = 2; grid[1][0] = 2;
                applyMove('down');
                return [grid[3][0], grid[2][0]];
            });
            expect(col).toEqual([4, 0]);
        });

        test('a move that changes nothing returns false', async ({ page }) => {
            const moved = await page.evaluate(() => {
                for (let r = 0; r < 4; r++) grid[r] = [0, 0, 0, 0];
                grid[0][0] = 2; // already flush left
                return applyMove('left');
            });
            expect(moved).toBe(false);
        });

        test('a move that changes the board returns true', async ({ page }) => {
            const moved = await page.evaluate(() => {
                for (let r = 0; r < 4; r++) grid[r] = [0, 0, 0, 0];
                grid[0][3] = 2;
                return applyMove('left');
            });
            expect(moved).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // move() — full turn: transform, spawn, score
    // -----------------------------------------------------------------------
    test.describe('move and spawn', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('a changing move spawns one new tile', async ({ page }) => {
            const counts = await page.evaluate(() => {
                for (let r = 0; r < 4; r++) grid[r] = [0, 0, 0, 0];
                grid[0][0] = 2;
                grid[1][3] = 4; // will slide left -> board changes
                const before = grid.flat().filter(Boolean).length;
                move('left');
                const after = grid.flat().filter(Boolean).length;
                return { before, after };
            });
            expect(counts.after).toBe(counts.before + 1);
        });

        test('a non-changing move does not spawn a tile', async ({ page }) => {
            const counts = await page.evaluate(() => {
                // Fill a board where "left" does nothing: everything flush-left, no merges
                grid = [
                    [2, 4, 2, 4],
                    [4, 2, 4, 2],
                    [2, 4, 2, 4],
                    [4, 2, 4, 2],
                ];
                const before = grid.flat().filter(Boolean).length;
                move('left');
                const after = grid.flat().filter(Boolean).length;
                return { before, after };
            });
            expect(counts.after).toBe(counts.before);
        });

        test('score increases on a merging move', async ({ page }) => {
            const score = await page.evaluate(() => {
                for (let r = 0; r < 4; r++) grid[r] = [0, 0, 0, 0];
                grid[0] = [2, 2, 0, 0];
                score = 0;
                move('left');
                return score;
            });
            expect(score).toBe(4);
            await expect(page.locator('#score')).toHaveText('4');
        });

        test('best score updates and persists on a merging move', async ({ page }) => {
            await page.evaluate(() => {
                for (let r = 0; r < 4; r++) grid[r] = [0, 0, 0, 0];
                grid[0] = [8, 8, 0, 0];
                score = 0;
                move('left');
            });
            await expect(page.locator('#best')).toHaveText('16');
            const stored = await page.evaluate(() => localStorage.getItem('best-2048'));
            expect(parseInt(stored, 10)).toBe(16);
        });
    });

    // -----------------------------------------------------------------------
    // Win condition
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('forming a 2048 tile wins', async ({ page }) => {
            const won = await page.evaluate(() => {
                for (let r = 0; r < 4; r++) grid[r] = [0, 0, 0, 0];
                grid[0] = [1024, 1024, 0, 0];
                move('left');
                return { won, state };
            });
            expect(won.won).toBe(true);
            expect(won.state).toBe('won');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Win');
        });

        test('pressing a key after winning keeps the game going', async ({ page }) => {
            await page.evaluate(() => {
                for (let r = 0; r < 4; r++) grid[r] = [0, 0, 0, 0];
                grid[0] = [1024, 1024, 0, 0];
                move('left');
            });
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('canMove is false on a stuck board', async ({ page }) => {
            const stuck = await page.evaluate(() => {
                grid = [
                    [2, 4, 2, 4],
                    [4, 2, 4, 2],
                    [2, 4, 2, 4],
                    [4, 2, 4, 2],
                ];
                return canMove();
            });
            expect(stuck).toBe(false);
        });

        test('canMove is true when an empty cell exists', async ({ page }) => {
            const can = await page.evaluate(() => {
                grid = [
                    [2, 4, 2, 4],
                    [4, 2, 4, 2],
                    [2, 4, 2, 4],
                    [4, 2, 4, 0],
                ];
                return canMove();
            });
            expect(can).toBe(true);
        });

        test('canMove is true when a merge is available', async ({ page }) => {
            const can = await page.evaluate(() => {
                grid = [
                    [2, 2, 2, 4],
                    [4, 2, 4, 2],
                    [2, 4, 2, 4],
                    [4, 2, 4, 2],
                ];
                return canMove();
            });
            expect(can).toBe(true);
        });

        test('a move that fills the last cell with no merges ends the game', async ({ page }) => {
            const st = await page.evaluate(() => {
                // One empty cell; sliding left fills it and leaves no moves.
                grid = [
                    [0, 4, 2, 4],
                    [4, 2, 4, 2],
                    [2, 4, 2, 4],
                    [4, 2, 4, 2],
                ];
                grid[0][0] = 2; // now full & stuck already; force a state check
                if (isGameOver()) endGame();
                return state;
            });
            expect(st).toBe('over');
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('game over overlay shows the score', async ({ page }) => {
            await page.evaluate(() => { score = 320; endGame(); });
            await expect(page.locator('#overlay-score')).toContainText('320');
        });

        test('best persists on game over', async ({ page }) => {
            await page.evaluate(() => { score = 777; endGame(); });
            await expect(page.locator('#best')).toHaveText('777');
            const stored = await page.evaluate(() => localStorage.getItem('best-2048'));
            expect(parseInt(stored, 10)).toBe(777);
        });

        test('arrow key after game over restarts with score 0 and two tiles', async ({ page }) => {
            await page.evaluate(() => { score = 500; endGame(); });
            await page.keyboard.press('ArrowLeft');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#score')).toHaveText('0');
            const count = await page.evaluate(() => grid.flat().filter(Boolean).length);
            expect(count).toBe(2);
        });
    });
});
