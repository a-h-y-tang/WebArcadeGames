const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Frogger', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Frogger', async ({ page }) => {
            await expect(page).toHaveTitle('Frogger');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('lives start at 3', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 520×520', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '520');
            await expect(canvas).toHaveAttribute('height', '520');
        });

        test('frog starts on the bottom start row, centre column', async ({ page }) => {
            const info = await page.evaluate(() => ({
                col: Math.round(frog.x / CELL),
                row: Math.round(frog.y / CELL),
                start: START_COL,
                bottom: ROWS - 1,
            }));
            expect(info.col).toBe(info.start);
            expect(info.row).toBe(info.bottom);
        });

        test('state is idle before starting', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('an arrow key dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state is running after start', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('obstacles are present once running', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            const n = await page.evaluate(() => obstacles.length);
            expect(n).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Frog movement (start the game via the button so no hop is consumed)
    // -----------------------------------------------------------------------
    test.describe('frog movement', () => {
        test('ArrowUp hops the frog one row toward the goal', async ({ page }) => {
            await page.locator('#btn-start').click();
            const before = await page.evaluate(() => ({ y: frog.y, cell: CELL }));
            await page.keyboard.press('ArrowUp');
            const y1 = await page.evaluate(() => frog.y);
            expect(y1).toBe(before.y - before.cell);
        });

        test('ArrowDown is clamped at the start row', async ({ page }) => {
            await page.locator('#btn-start').click();
            const y0 = await page.evaluate(() => frog.y);
            await page.keyboard.press('ArrowDown');
            const y1 = await page.evaluate(() => frog.y);
            expect(y1).toBe(y0); // already on the bottom row
        });

        test('ArrowRight hops the frog one column right', async ({ page }) => {
            await page.locator('#btn-start').click();
            const before = await page.evaluate(() => ({ x: frog.x, cell: CELL }));
            await page.keyboard.press('ArrowRight');
            const x1 = await page.evaluate(() => frog.x);
            expect(x1).toBe(before.x + before.cell);
        });

        test('horizontal movement is clamped at the left edge', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { frog.x = 0; });
            await page.keyboard.press('ArrowLeft');
            const x = await page.evaluate(() => frog.x);
            expect(x).toBe(0);
        });

        test('advancing to a new row scores points', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s0 = await page.evaluate(() => score);
            await page.keyboard.press('ArrowUp');
            const s1 = await page.evaluate(() => score);
            expect(s1).toBeGreaterThan(s0);
        });
    });

    // -----------------------------------------------------------------------
    // Road hazards
    // -----------------------------------------------------------------------
    test.describe('road hazards', () => {
        test('a car overlapping the frog costs a life', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                // Put the frog on a road row and drop a car right on top of it.
                const carRow = LANES.find(l => l.type === 'car').row;
                frog.x = 6 * CELL;
                frog.y = carRow * CELL;
                obstacles.length = 0;
                obstacles.push({ row: carRow, x: 6 * CELL - CELL, w: 3 * CELL, dir: 1, speed: 0, type: 'car' });
            });
            await page.waitForTimeout(120);
            const lives = await page.evaluate(() => lives);
            expect(lives).toBeLessThan(3);
        });

        test('dying resets the frog to the start row', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => die());
            const info = await page.evaluate(() => ({
                col: Math.round(frog.x / CELL),
                row: Math.round(frog.y / CELL),
                start: START_COL,
                bottom: ROWS - 1,
            }));
            expect(info.col).toBe(info.start);
            expect(info.row).toBe(info.bottom);
        });
    });

    // -----------------------------------------------------------------------
    // River hazards
    // -----------------------------------------------------------------------
    test.describe('river hazards', () => {
        test('being on water with no log drowns the frog', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                const waterRow = LANES.find(l => l.type === 'log').row;
                obstacles.length = 0; // remove every log
                frog.x = 6 * CELL;
                frog.y = waterRow * CELL;
            });
            await page.waitForTimeout(120);
            const lives = await page.evaluate(() => lives);
            expect(lives).toBeLessThan(3);
        });

        test('a log carries the frog along and keeps it alive', async ({ page }) => {
            await page.locator('#btn-start').click();
            const result = await page.evaluate(async () => {
                const waterRow = LANES.find(l => l.type === 'log').row;
                obstacles.length = 0;
                frog.x = 6 * CELL;
                frog.y = waterRow * CELL;
                // A wide, right-moving log centred under the frog.
                obstacles.push({ row: waterRow, x: 4 * CELL, w: 5 * CELL, dir: 1, speed: 80, type: 'log' });
                const x0 = frog.x;
                await new Promise(r => setTimeout(r, 200));
                return { x0, x1: frog.x, lives };
            });
            expect(result.lives).toBe(3);      // did not drown
            expect(result.x1).toBeGreaterThan(result.x0); // rode the log right
        });
    });

    // -----------------------------------------------------------------------
    // Reaching home
    // -----------------------------------------------------------------------
    test.describe('reaching home', () => {
        test('landing in an empty bay fills it and scores', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                frog.x = BAY_COLS[0] * CELL;
                frog.y = 1 * CELL; // row just below the goal row
                const s0 = score;
                moveFrog(0, -1); // hop up into the bay
                return { filled: bays[0], gained: score - s0 };
            });
            expect(r.filled).toBe(true);
            expect(r.gained).toBeGreaterThan(0);
        });

        test('a filled bay returns the frog to the start row', async ({ page }) => {
            await page.locator('#btn-start').click();
            const info = await page.evaluate(() => {
                frog.x = BAY_COLS[1] * CELL;
                frog.y = 1 * CELL;
                moveFrog(0, -1);
                return { row: Math.round(frog.y / CELL), bottom: ROWS - 1 };
            });
            expect(info.row).toBe(info.bottom);
        });

        test('hopping up into a non-bay column is fatal', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                // Find a top-row column that is NOT a bay.
                let col = 0;
                while (BAY_COLS.includes(col)) col++;
                frog.x = col * CELL;
                frog.y = 1 * CELL;
                moveFrog(0, -1);
                return lives;
            });
            expect(r).toBeLessThan(3);
        });

        test('filling every bay advances the level and resets the bays', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                // Pre-fill all bays but the last, then land in the last.
                for (let i = 0; i < bays.length - 1; i++) bays[i] = true;
                const last = bays.length - 1;
                frog.x = BAY_COLS[last] * CELL;
                frog.y = 1 * CELL;
                const lvl0 = level;
                moveFrog(0, -1);
                return { lvl0, lvl1: level, anyFilled: bays.some(Boolean) };
            });
            expect(r.lvl1).toBe(r.lvl0 + 1);
            expect(r.anyFilled).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test('lives display updates in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => die());
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { lives = 1; die(); });
            const s = await page.evaluate(() => state);
            expect(s).toBe('over');
        });

        test('game over overlay is shown', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('game over score element shows points', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('ArrowUp'); // score a little
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay-score')).toContainText('pts');
        });

        test('Play Again button is visible after game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets score and lives', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 500; lives = 1; endGame(); });
            await page.locator('#btn-start').click();
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('best score updates on game over if higher', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 120; endGame(); });
            const best = parseInt(await page.locator('#best').textContent(), 10);
            expect(best).toBe(120);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 90; endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('frogger-best'));
            expect(parseInt(stored, 10)).toBe(90);
        });
    });

    // -----------------------------------------------------------------------
    // Pause and resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            const s = await page.evaluate(() => state);
            expect(s).toBe('paused');
        });

        test('pause overlay shows "Paused"', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('obstacles do not move while paused', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            const before = await page.evaluate(() => obstacles[0].x);
            await page.waitForTimeout(250);
            const after = await page.evaluate(() => obstacles[0].x);
            expect(after).toBe(before);
        });

        test('the frog cannot hop while paused', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            const before = await page.evaluate(() => frog.y);
            await page.keyboard.press('ArrowUp');
            const after = await page.evaluate(() => frog.y);
            expect(after).toBe(before);
        });
    });
});
