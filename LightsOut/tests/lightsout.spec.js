const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Lights Out', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => localStorage.clear());
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Lights Out', async ({ page }) => {
            await expect(page).toHaveTitle('Lights Out');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('off');
        });

        test('moves start at 0', async ({ page }) => {
            await expect(page.locator('#moves')).toHaveText('0');
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('best starts as — when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('canvas is 400×400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '400');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('game state is idle before start', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('grid is 5×5', async ({ page }) => {
            const dims = await page.evaluate(() => [grid.length, grid[0].length]);
            expect(dims).toEqual([5, 5]);
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

        test('starting deals a board with some lights on', async ({ page }) => {
            await page.locator('#btn-start').click();
            const on = await page.evaluate(() => lightsOn());
            expect(on).toBeGreaterThan(0);
        });

        test('starting resets moves to 0', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => moves)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // The toggle rule
    // -----------------------------------------------------------------------
    test.describe('toggle rule', () => {
        test('pressing a centre cell flips it and its four neighbours', async ({ page }) => {
            await page.locator('#btn-start').click();
            const flipped = await page.evaluate(() => {
                // Clear the board, then press the centre.
                for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid[r][c] = false;
                press(2, 2);
                return [
                    grid[2][2], grid[1][2], grid[3][2], grid[2][1], grid[2][3],
                ];
            });
            expect(flipped).toEqual([true, true, true, true, true]);
        });

        test('pressing a centre cell leaves diagonals untouched', async ({ page }) => {
            await page.locator('#btn-start').click();
            const diagonals = await page.evaluate(() => {
                for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid[r][c] = false;
                press(2, 2);
                return [grid[1][1], grid[1][3], grid[3][1], grid[3][3]];
            });
            expect(diagonals).toEqual([false, false, false, false]);
        });

        test('a corner press flips only three cells (neighbours off-board ignored)', async ({ page }) => {
            await page.locator('#btn-start').click();
            const count = await page.evaluate(() => {
                for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid[r][c] = false;
                press(0, 0);
                return lightsOn();
            });
            expect(count).toBe(3); // (0,0), (0,1), (1,0)
        });

        test('an edge press flips four cells', async ({ page }) => {
            await page.locator('#btn-start').click();
            const count = await page.evaluate(() => {
                for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid[r][c] = false;
                press(0, 2);
                return lightsOn();
            });
            expect(count).toBe(4); // (0,2),(0,1),(0,3),(1,2)
        });

        test('pressing the same cell twice restores the board', async ({ page }) => {
            await page.locator('#btn-start').click();
            const same = await page.evaluate(() => {
                const before = grid.map(row => row.slice());
                press(1, 3);
                press(1, 3);
                return JSON.stringify(before) === JSON.stringify(grid);
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Move counting
    // -----------------------------------------------------------------------
    test.describe('move counting', () => {
        test('each press increments the move counter', async ({ page }) => {
            await page.locator('#btn-start').click();
            const moves = await page.evaluate(() => {
                window.moves = 0;
                press(0, 0);
                press(4, 4);
                return window.moves;
            });
            expect(moves).toBe(2);
        });

        test('the move counter is reflected in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { press(2, 2); });
            await expect(page.locator('#moves')).not.toHaveText('0');
        });

        test('pressing does nothing when not playing', async ({ page }) => {
            // Before start (idle): press should be ignored.
            const moves = await page.evaluate(() => {
                window.moves = 0;
                press(2, 2);
                return window.moves;
            });
            expect(moves).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Clicking the canvas
    // -----------------------------------------------------------------------
    test.describe('clicking the canvas', () => {
        test('clicking a tile toggles the matching cell', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid[r][c] = false;
                draw();
            });
            // Cell (2,2) centre is at (2*80+40, 2*80+40) = (200, 200)
            await page.locator('#canvas').click({ position: { x: 200, y: 200 } });
            const on = await page.evaluate(() => grid[2][2]);
            expect(on).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('clearing every light wins the level', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                // Board where pressing (2,2) once turns everything off:
                for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid[r][c] = false;
                grid[2][2] = grid[1][2] = grid[3][2] = grid[2][1] = grid[2][3] = true;
                press(2, 2);
                return state;
            });
            expect(s).toBe('won');
        });

        test('winning shows the solved overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid[r][c] = false;
                grid[2][2] = grid[1][2] = grid[3][2] = grid[2][1] = grid[2][3] = true;
                press(2, 2);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Solved');
        });

        test('a board that is not empty does not win', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid[r][c] = false;
                grid[0][0] = true; // lone light, unaffected by a distant press
                press(4, 4);
                return state;
            });
            expect(s).toBe('playing');
        });

        test('advancing to the next level increments the level and re-fills the board', async ({ page }) => {
            await page.locator('#btn-start').click();
            const result = await page.evaluate(() => {
                for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid[r][c] = false;
                grid[2][2] = grid[1][2] = grid[3][2] = grid[2][1] = grid[2][3] = true;
                press(2, 2);              // solves level 1
                const beforeLevel = level;
                nextLevel();
                return { beforeLevel, afterLevel: level, on: lightsOn(), state };
            });
            expect(result.afterLevel).toBe(result.beforeLevel + 1);
            expect(result.on).toBeGreaterThan(0);
            expect(result.state).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best (fewest moves)', () => {
        test('best updates on a solve and shows the move count', async ({ page }) => {
            await page.locator('#btn-start').click();
            const best = await page.evaluate(() => {
                for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid[r][c] = false;
                grid[2][2] = grid[1][2] = grid[3][2] = grid[2][1] = grid[2][3] = true;
                window.moves = 0;
                press(2, 2); // solve in 1 move
                return bestEl.textContent;
            });
            expect(best).toBe('1');
        });

        test('best persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            const stored = await page.evaluate(() => {
                for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid[r][c] = false;
                grid[2][2] = grid[1][2] = grid[3][2] = grid[2][1] = grid[2][3] = true;
                window.moves = 0;
                press(2, 2);
                return localStorage.getItem('lightsout-best');
            });
            expect(parseInt(stored)).toBe(1);
        });

        test('best only improves (a slower solve does not overwrite a faster one)', async ({ page }) => {
            await page.locator('#btn-start').click();
            const best = await page.evaluate(() => {
                // First solve in 1 move.
                for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid[r][c] = false;
                grid[2][2] = grid[1][2] = grid[3][2] = grid[2][1] = grid[2][3] = true;
                window.moves = 0;
                press(2, 2);
                // Now pretend a 9-move solve happens.
                state = 'playing';
                for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid[r][c] = false;
                grid[2][2] = grid[1][2] = grid[3][2] = grid[2][1] = grid[2][3] = true;
                window.moves = 8;
                press(2, 2); // moves becomes 9
                return best;
            });
            expect(best).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // New board / reset
    // -----------------------------------------------------------------------
    test.describe('new board and reset', () => {
        test('N deals a new board and resets moves', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { press(0, 0); press(1, 1); });
            await page.keyboard.press('n');
            expect(await page.evaluate(() => moves)).toBe(0);
            expect(await page.evaluate(() => lightsOn())).toBeGreaterThan(0);
        });

        test('R restores the current board to its start and zeroes moves', async ({ page }) => {
            await page.locator('#btn-start').click();
            const restored = await page.evaluate(() => {
                const start = grid.map(row => row.slice());
                press(0, 0);
                press(2, 3);
                page_moves_check = moves; // sanity: moves > 0
                resetPuzzle();
                return {
                    same: JSON.stringify(start) === JSON.stringify(grid),
                    moves,
                };
            });
            expect(restored.same).toBe(true);
            expect(restored.moves).toBe(0);
        });
    });
});
