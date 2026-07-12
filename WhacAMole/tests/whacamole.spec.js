const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Whac-A-Mole', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Whac-A-Mole', async ({ page }) => {
            await expect(page).toHaveTitle('Whac-A-Mole');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/Space|click/i);
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('timer shows the full round length', async ({ page }) => {
            const secs = await page.evaluate(() => GAME_SECONDS);
            await expect(page.locator('#time')).toHaveText(String(secs));
        });

        test('canvas matches the grid dimensions', async ({ page }) => {
            const { w, h, grid, cell } = await page.evaluate(() => ({
                w: canvas.width, h: canvas.height, grid: GRID, cell: CELL,
            }));
            expect(w).toBe(grid * cell);
            expect(h).toBe(grid * cell);
        });

        test('there are nine holes and none are up', async ({ page }) => {
            const { count, anyUp } = await page.evaluate(() => ({
                count: moles.length, anyUp: moles.some(m => m.up),
            }));
            expect(count).toBe(9);
            expect(anyUp).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is running after start', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('the timer resets to the full round length on start', async ({ page }) => {
            await page.keyboard.press('Space');
            const { left, secs } = await page.evaluate(() => ({
                left: timeLeft, secs: GAME_SECONDS,
            }));
            expect(left).toBe(secs);
        });
    });

    // -----------------------------------------------------------------------
    // Whacking moles
    // -----------------------------------------------------------------------
    test.describe('whacking moles', () => {
        test('spawnMole raises a mole in the given hole', async ({ page }) => {
            await page.keyboard.press('Space');
            const up = await page.evaluate(() => { spawnMole(4); return moles[4].up; });
            expect(up).toBe(true);
        });

        test('whacking an up mole scores a point', async ({ page }) => {
            await page.keyboard.press('Space');
            const result = await page.evaluate(() => {
                spawnMole(0);
                const hit = whack(0);
                return { hit, score, up: moles[0].up };
            });
            expect(result.hit).toBe(true);
            expect(result.score).toBe(1);
            expect(result.up).toBe(false);
        });

        test('the score display updates in the DOM', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { spawnMole(2); whack(2); });
            await expect(page.locator('#score')).toHaveText('1');
        });

        test('whacking an empty hole does not score', async ({ page }) => {
            await page.keyboard.press('Space');
            const result = await page.evaluate(() => {
                const hit = whack(5); // nothing up here
                return { hit, score };
            });
            expect(result.hit).toBe(false);
            expect(result.score).toBe(0);
        });

        test('a mole cannot be whacked twice', async ({ page }) => {
            await page.keyboard.press('Space');
            const score = await page.evaluate(() => {
                spawnMole(1);
                whack(1);
                whack(1); // already down
                return score;
            });
            expect(score).toBe(1);
        });

        test('whacking does nothing before the game starts', async ({ page }) => {
            const result = await page.evaluate(() => {
                spawnMole(3);
                const hit = whack(3);
                return { hit, score };
            });
            expect(result.hit).toBe(false);
            expect(result.score).toBe(0);
        });

        test('clicking a mole on the canvas whacks it', async ({ page }) => {
            await page.keyboard.press('Space');
            // Put a mole in the centre hole (index 4) and click its centre.
            const { cx, cy } = await page.evaluate(() => {
                spawnMole(4);
                const col = 4 % GRID, row = Math.floor(4 / GRID);
                return { cx: col * CELL + CELL / 2, cy: row * CELL + CELL / 2 };
            });
            await page.locator('#canvas').click({ position: { x: cx, y: cy } });
            await expect(page.locator('#score')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Timer / difficulty
    // -----------------------------------------------------------------------
    test.describe('timer', () => {
        test('the timer counts down over time', async ({ page }) => {
            await page.keyboard.press('Space');
            const start = await page.evaluate(() => timeLeft);
            await page.waitForTimeout(1100);
            const later = await page.evaluate(() => timeLeft);
            expect(later).toBeLessThan(start);
        });

        test('the game ends when the timer runs out', async ({ page }) => {
            await page.keyboard.press('Space');
            // Fast-forward the clock to expiry.
            await page.evaluate(() => { endTime = performance.now() - 1; });
            await page.waitForTimeout(200);
            const s = await page.evaluate(() => state);
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const s = await page.evaluate(() => state);
            expect(s).toBe('paused');
        });

        test('the pause overlay shows "Paused"', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('the timer does not advance while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const before = await page.evaluate(() => timeLeft);
            await page.waitForTimeout(1100);
            const after = await page.evaluate(() => timeLeft);
            expect(after).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('game over overlay is shown', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/Game Over|Time/i);
        });

        test('the final score is shown on game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { spawnMole(0); whack(0); endGame(); });
            await expect(page.locator('#overlay-score')).toContainText('1');
        });

        test('Play Again button is visible after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('Space after game over restarts with score 0', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { spawnMole(0); whack(0); endGame(); });
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#score')).toHaveText('0');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('best score updates on game over when score is higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                for (let i = 0; i < 3; i++) { spawnMole(i); whack(i); }
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent());
            expect(best).toBeGreaterThanOrEqual(3);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { spawnMole(0); whack(0); endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('whackamole-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(1);
        });
    });
});
