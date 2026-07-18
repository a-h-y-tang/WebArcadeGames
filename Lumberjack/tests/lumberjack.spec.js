const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Lumberjack', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Lumberjack', async ({ page }) => {
            await expect(page).toHaveTitle('Lumberjack');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts how to play', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('chop');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 400×600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '400');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('game starts in the idle state', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Left arrow starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('the trunk is fully populated once running', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => ({ len: trunk.length, visible: VISIBLE }));
            expect(info.len).toBe(info.visible);
        });

        test('the first input starts without chopping (score stays 0)', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await expect(page.locator('#score')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Chopping
    // -----------------------------------------------------------------------
    test.describe('chopping', () => {
        test('chopping left puts the lumberjack on the left', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { trunk[1].branch = 'none'; chop('left'); });
            const side = await page.evaluate(() => player.side);
            expect(side).toBe('left');
        });

        test('chopping right puts the lumberjack on the right', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { trunk[1].branch = 'none'; chop('right'); });
            const side = await page.evaluate(() => player.side);
            expect(side).toBe('right');
        });

        test('a safe chop increments the score', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { trunk[1].branch = 'none'; chop('left'); });
            const score = parseInt(await page.locator('#score').textContent());
            expect(score).toBe(1);
        });

        test('the trunk length stays constant after a chop', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => trunk.length);
            await page.evaluate(() => { trunk[1].branch = 'none'; chop('right'); });
            const after = await page.evaluate(() => trunk.length);
            expect(after).toBe(before);
        });

        test('chopping into a branch on your side ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { trunk[1].branch = 'left'; chop('left'); });
            const s = await page.evaluate(() => state);
            expect(s).toBe('over');
        });

        test('chopping the safe side when a branch is present survives', async ({ page }) => {
            await page.keyboard.press('Space');
            const result = await page.evaluate(() => {
                trunk[1].branch = 'left';
                chop('right');
                return { state, score };
            });
            expect(result.state).toBe('running');
            expect(result.score).toBe(1);
        });

        test('a chop while running can be driven from the keyboard', async ({ page }) => {
            await page.keyboard.press('Space'); // start
            // Make the incoming segment safe on the left, then chop left.
            await page.evaluate(() => { trunk[1].branch = 'right'; });
            await page.keyboard.press('ArrowLeft');
            const score = parseInt(await page.locator('#score').textContent());
            expect(score).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Timer
    // -----------------------------------------------------------------------
    test.describe('timer', () => {
        test('the timer drains over time while running', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => timer);
            await page.waitForTimeout(250);
            const after = await page.evaluate(() => timer);
            expect(after).toBeLessThan(before);
        });

        test('a chop tops the timer back up', async ({ page }) => {
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => {
                timer = 0.3;
                trunk[1].branch = 'none';
                chop('left');
                return timer;
            });
            expect(after).toBeGreaterThan(0.3);
        });

        test('the timer is capped at 1', async ({ page }) => {
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => {
                timer = 0.98;
                trunk[1].branch = 'none';
                chop('left');
                return timer;
            });
            expect(after).toBeLessThanOrEqual(1);
        });

        test('the game ends when the timer runs out', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { timer = 0.03; });
            await expect.poll(() => page.evaluate(() => state), { timeout: 3000 }).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('game over overlay is shown with a Game Over title', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('Play Again button appears after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('the game over overlay reports the score', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { trunk[1].branch = 'none'; chop('left'); endGame(); });
            await expect(page.locator('#overlay-score')).toContainText('pts');
        });

        test('best score updates and persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                for (let i = 0; i < 3; i++) { trunk[1].branch = 'none'; chop('left'); }
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent());
            expect(best).toBeGreaterThanOrEqual(3);
            const stored = await page.evaluate(() => localStorage.getItem('lumberjack-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(3);
        });

        test('a chop after game over does nothing', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            const before = await page.evaluate(() => score);
            await page.evaluate(() => { trunk[1].branch = 'none'; chop('left'); });
            const after = await page.evaluate(() => score);
            expect(after).toBe(before);
        });

        test('restarting resets the score, trunk and timer', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                for (let i = 0; i < 2; i++) { trunk[1].branch = 'none'; chop('left'); }
                endGame();
            });
            await page.keyboard.press('Space'); // restart
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#score')).toHaveText('0');
            const info = await page.evaluate(() => ({ len: trunk.length, visible: VISIBLE, timer, state }));
            expect(info.len).toBe(info.visible);
            expect(info.timer).toBeGreaterThan(0.9);
            expect(info.state).toBe('running');
        });
    });
});
