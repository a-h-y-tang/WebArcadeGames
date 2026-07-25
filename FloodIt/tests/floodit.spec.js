const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Flood It', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.removeItem('floodit-best'); } catch (e) {}
        });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Flood It', async ({ page }) => {
            await expect(page).toHaveTitle('Flood It');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('color');
        });

        test('moves-left shows the full budget before starting', async ({ page }) => {
            await expect(page.locator('#moves')).toHaveText('30');
            await expect(page.locator('#max-moves')).toHaveText('30');
        });

        test('best starts as em dash when localStorage empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('canvas is 500x500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('there are 6 color swatches', async ({ page }) => {
            await expect(page.locator('.swatch')).toHaveCount(6);
        });

        test('grid is 14x14 tiles', async ({ page }) => {
            const dims = await page.evaluate(() => ({
                rows: grid.length,
                cols: grid[0].length,
            }));
            expect(dims).toEqual({ rows: 14, cols: 14 });
        });

        test('all grid values are valid color indices 0..5', async ({ page }) => {
            const ok = await page.evaluate(() =>
                grid.every(row => row.every(v => Number.isInteger(v) && v >= 0 && v < 6))
            );
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Determinism
    // -----------------------------------------------------------------------
    test.describe('determinism', () => {
        test('same seed produces identical boards', async ({ page }) => {
            const a = await page.evaluate(() => { startGame(12345); return JSON.stringify(grid); });
            const b = await page.evaluate(() => { startGame(12345); return JSON.stringify(grid); });
            expect(a).toBe(b);
        });

        test('different seeds usually produce different boards', async ({ page }) => {
            const a = await page.evaluate(() => { startGame(1); return JSON.stringify(grid); });
            const b = await page.evaluate(() => { startGame(2); return JSON.stringify(grid); });
            expect(a).not.toBe(b);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Start button dismisses overlay and sets running', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('pressing a color key starts the game', async ({ page }) => {
            await page.keyboard.press('1');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('a fresh game has full move budget', async ({ page }) => {
            await page.locator('#btn-start').click();
            const m = await page.evaluate(() => movesLeft);
            expect(m).toBe(30);
        });
    });

    // -----------------------------------------------------------------------
    // Region / flood color helpers
    // -----------------------------------------------------------------------
    test.describe('region helpers', () => {
        test('floodColor equals the top-left tile', async ({ page }) => {
            const eq = await page.evaluate(() => floodColor() === grid[0][0]);
            expect(eq).toBe(true);
        });

        test('regionSize is at least 1', async ({ page }) => {
            const n = await page.evaluate(() => regionSize());
            expect(n).toBeGreaterThanOrEqual(1);
        });

        test('a fully unified board reports regionSize == 196 and isWon', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(1);
                for (let r = 0; r < grid.length; r++)
                    for (let c = 0; c < grid[0].length; c++) grid[r][c] = 3;
                return { size: regionSize(), won: isWon() };
            });
            expect(res.size).toBe(196);
            expect(res.won).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Picking a color (a move)
    // -----------------------------------------------------------------------
    test.describe('picking a color', () => {
        test('picking a new color recolors the whole flood region', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame(7);
                const target = (grid[0][0] + 1) % 6;
                pickColor(target);
                return floodColor() === target;
            });
            expect(ok).toBe(true);
        });

        test('picking a new color consumes exactly one move', async ({ page }) => {
            const delta = await page.evaluate(() => {
                startGame(7);
                const before = movesLeft;
                pickColor((grid[0][0] + 1) % 6);
                return before - movesLeft;
            });
            expect(delta).toBe(1);
        });

        test('picking the current flood color is a no-op and costs no move', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(7);
                const before = movesLeft;
                pickColor(grid[0][0]);
                return { spent: before - movesLeft };
            });
            expect(res.spent).toBe(0);
        });

        test('a move never shrinks the flood region', async ({ page }) => {
            const grew = await page.evaluate(() => {
                startGame(7);
                const before = regionSize();
                pickColor((grid[0][0] + 1) % 6);
                return regionSize() >= before;
            });
            expect(grew).toBe(true);
        });

        test('clicking a swatch applies that color', async ({ page }) => {
            await page.evaluate(() => startGame(7));
            const target = await page.evaluate(() => (grid[0][0] + 1) % 6);
            await page.locator(`.swatch[data-color="${target}"]`).click();
            const now = await page.evaluate(() => floodColor());
            expect(now).toBe(target);
        });

        test('moves-left display updates in the DOM after a move', async ({ page }) => {
            await page.evaluate(() => startGame(7));
            await page.evaluate(() => pickColor((grid[0][0] + 1) % 6));
            await expect(page.locator('#moves')).toHaveText('29');
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('unifying the board sets state to won', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(1);
                // Force a board that is one pick away from unified: two colors,
                // region is color 0, everything else color 1.
                for (let r = 0; r < grid.length; r++)
                    for (let c = 0; c < grid[0].length; c++) grid[r][c] = 1;
                grid[0][0] = 0;
                pickColor(1);
                return state;
            });
            expect(s).toBe('won');
        });

        test('win overlay is shown with a win message', async ({ page }) => {
            await page.evaluate(() => {
                startGame(1);
                for (let r = 0; r < grid.length; r++)
                    for (let c = 0; c < grid[0].length; c++) grid[r][c] = 1;
                grid[0][0] = 0;
                pickColor(1);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('You Win');
        });

        test('best score is stored after a win', async ({ page }) => {
            await page.evaluate(() => {
                startGame(1);
                for (let r = 0; r < grid.length; r++)
                    for (let c = 0; c < grid[0].length; c++) grid[r][c] = 1;
                grid[0][0] = 0;
                pickColor(1);
            });
            const stored = await page.evaluate(() => localStorage.getItem('floodit-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(1);
        });

        test('best display updates after a win', async ({ page }) => {
            await page.evaluate(() => {
                startGame(1);
                for (let r = 0; r < grid.length; r++)
                    for (let c = 0; c < grid[0].length; c++) grid[r][c] = 1;
                grid[0][0] = 0;
                pickColor(1);
            });
            await expect(page.locator('#best')).not.toHaveText('—');
        });
    });

    // -----------------------------------------------------------------------
    // Losing
    // -----------------------------------------------------------------------
    test.describe('losing', () => {
        test('running out of moves without unifying sets state to lost', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(1);
                // A checkerboard of 2 colors can't be unified in 1 move; set 1 move left.
                for (let r = 0; r < grid.length; r++)
                    for (let c = 0; c < grid[0].length; c++) grid[r][c] = (r + c) % 2;
                movesLeft = 1;
                // Pick a color that changes the region but cannot unify the board.
                pickColor((grid[0][0] + 1) % 2 + 2); // color 2 or 3, definitely not unifying
                return state;
            });
            expect(s).toBe('lost');
        });

        test('lose overlay shows a lose message', async ({ page }) => {
            await page.evaluate(() => {
                startGame(1);
                for (let r = 0; r < grid.length; r++)
                    for (let c = 0; c < grid[0].length; c++) grid[r][c] = (r + c) % 2;
                movesLeft = 1;
                pickColor(3);
            });
            await expect(page.locator('#overlay-title')).toContainText('Out of Moves');
        });

        test('moves cannot be spent once the game is lost', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame(1);
                for (let r = 0; r < grid.length; r++)
                    for (let c = 0; c < grid[0].length; c++) grid[r][c] = (r + c) % 2;
                movesLeft = 1;
                pickColor(3);          // triggers loss
                const m = movesLeft;
                pickColor(4);          // should be ignored
                return { before: m, afterVal: movesLeft };
            });
            expect(after.afterVal).toBe(after.before);
        });
    });

    // -----------------------------------------------------------------------
    // Restart
    // -----------------------------------------------------------------------
    test.describe('restart', () => {
        test('R key starts a new game with a full budget', async ({ page }) => {
            await page.evaluate(() => {
                startGame(1);
                pickColor((grid[0][0] + 1) % 6);
            });
            await page.keyboard.press('r');
            const m = await page.evaluate(() => movesLeft);
            expect(m).toBe(30);
        });

        test('new game after a win resets state to running', async ({ page }) => {
            await page.evaluate(() => {
                startGame(1);
                for (let r = 0; r < grid.length; r++)
                    for (let c = 0; c < grid[0].length; c++) grid[r][c] = 1;
                grid[0][0] = 0;
                pickColor(1);
            });
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });
    });
});
