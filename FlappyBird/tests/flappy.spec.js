const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Flappy Bird', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => localStorage.clear());
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Flappy Bird', async ({ page }) => {
            await expect(page).toHaveTitle('Flappy Bird');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/flap|space/i);
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

        test('bird starts with zero vertical velocity', async ({ page }) => {
            const vy = await page.evaluate(() => bird.vy);
            expect(vy).toBe(0);
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
        test('Space dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('ArrowUp dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('clicking the start screen starts the game', async ({ page }) => {
            await page.locator('#overlay').click({ position: { x: 200, y: 120 } });
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('clicking the canvas flaps while running', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { bird.vy = 5; }); // falling
            await page.locator('#canvas').click({ position: { x: 200, y: 300 } });
            const vy = await page.evaluate(() => bird.vy);
            expect(vy).toBeLessThan(0);
        });

        test('state is running after start', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('starting flaps the bird upward immediately', async ({ page }) => {
            await page.keyboard.press('Space');
            const vy = await page.evaluate(() => bird.vy);
            expect(vy).toBeLessThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Physics: gravity and flapping
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('gravity increases downward velocity over time', async ({ page }) => {
            await page.keyboard.press('Space');
            // Zero the velocity, then let gravity act with no flapping.
            await page.evaluate(() => { bird.vy = 0; });
            const before = await page.evaluate(() => bird.vy);
            await page.waitForTimeout(200);
            const after = await page.evaluate(() => bird.vy);
            expect(after).toBeGreaterThan(before);
        });

        test('the bird falls when not flapping', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { bird.vy = 0; });
            const y0 = await page.evaluate(() => bird.y);
            await page.waitForTimeout(200);
            const y1 = await page.evaluate(() => bird.y);
            expect(y1).toBeGreaterThan(y0);
        });

        test('flapping sets an upward velocity', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { bird.vy = 5; }); // falling
            await page.keyboard.press('Space');
            const vy = await page.evaluate(() => bird.vy);
            expect(vy).toBeLessThan(0);
        });

        test('the bird cannot pass the ceiling', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { bird.y = -50; bird.vy = -20; });
            await page.waitForTimeout(120);
            const y = await page.evaluate(() => bird.y);
            expect(y).toBeGreaterThanOrEqual(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pipes
    // -----------------------------------------------------------------------
    test.describe('pipes', () => {
        test('at least one pipe exists after starting', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForTimeout(120);
            const count = await page.evaluate(() => pipes.length);
            expect(count).toBeGreaterThanOrEqual(1);
        });

        test('pipes scroll to the left', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForTimeout(60);
            const x0 = await page.evaluate(() => pipes[0].x);
            await page.waitForTimeout(200);
            const x1 = await page.evaluate(() => pipes[0].x);
            expect(x1).toBeLessThan(x0);
        });

        test('passing a pipe increments the score', async ({ page }) => {
            await page.keyboard.press('Space');
            // Place a single unpassed pipe just to the left of the bird so its
            // right edge has already cleared the bird's x on the next tick.
            await page.evaluate(() => {
                pipes = [{ x: BIRD_X - PIPE_W - 1, gapY: 200, passed: false }];
            });
            await page.waitForTimeout(120);
            const score = parseInt(await page.locator('#score').textContent(), 10);
            expect(score).toBeGreaterThanOrEqual(1);
        });
    });

    // -----------------------------------------------------------------------
    // Collision / game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('hitting the ground ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { bird.y = HEIGHT; bird.vy = 10; });
            await page.waitForTimeout(120);
            const s = await page.evaluate(() => state);
            expect(s).toBe('over');
        });

        test('hitting a pipe ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            // Column of pipe on top of the bird, gap off-screen -> guaranteed hit.
            await page.evaluate(() => {
                pipes = [{ x: BIRD_X - BIRD_R, gapY: HEIGHT, passed: false }];
            });
            await page.waitForTimeout(120);
            const s = await page.evaluate(() => state);
            expect(s).toBe('over');
        });

        test('game over overlay is shown', async ({ page }) => {
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

        test('restarting resets the score to 0', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 7; scoreEl.textContent = score; });
            await page.evaluate(() => endGame());
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('the bird stops moving after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            const y0 = await page.evaluate(() => bird.y);
            await page.waitForTimeout(200);
            const y1 = await page.evaluate(() => bird.y);
            expect(y1).toBe(y0);
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best score updates on game over when the score is higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 5; scoreEl.textContent = score; endGame(); });
            const best = parseInt(await page.locator('#best').textContent(), 10);
            expect(best).toBeGreaterThanOrEqual(5);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 4; scoreEl.textContent = score; endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('flappy-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(4);
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

        test('pause overlay shows "Paused"', async ({ page }) => {
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

        test('the bird does not move while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const y0 = await page.evaluate(() => bird.y);
            await page.waitForTimeout(200);
            const y1 = await page.evaluate(() => bird.y);
            expect(y1).toBe(y0);
        });
    });
});
