const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Snake', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Snake', async ({ page }) => {
            await expect(page).toHaveTitle('Snake');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to press a key', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press an arrow key');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 500×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('snake starts with 3 segments', async ({ page }) => {
            const len = await page.evaluate(() => snake.length);
            expect(len).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('arrow key dismisses overlay', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('WASD key dismisses overlay', async ({ page }) => {
            await page.keyboard.press('d');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start Game button dismisses overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is running after start', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Snake movement
    // -----------------------------------------------------------------------
    test.describe('snake movement', () => {
        test('snake head moves right after ArrowRight', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            const startX = await page.evaluate(() => snake[0].x);
            await page.waitForTimeout(500); // ≥3 ticks at 150 ms
            const endX = await page.evaluate(() => snake[0].x);
            expect(endX).toBeGreaterThan(startX);
        });

        test('snake head moves down after ArrowDown', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            const startY = await page.evaluate(() => snake[0].y);
            await page.waitForTimeout(500);
            const endY = await page.evaluate(() => snake[0].y);
            expect(endY).toBeGreaterThan(startY);
        });

        test('direction reversal is ignored', async ({ page }) => {
            // Start moving right, immediately press left — should keep going right
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowLeft');
            await page.waitForTimeout(200);
            const dx = await page.evaluate(() => dir.x);
            expect(dx).toBe(1); // still moving right
        });
    });

    // -----------------------------------------------------------------------
    // Eating food
    // -----------------------------------------------------------------------
    test.describe('eating food', () => {
        test('score increments when food is eaten', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            // Place food one step ahead of the snake's head
            await page.evaluate(() => {
                food = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
            });
            await page.waitForTimeout(200);
            const score = parseInt(await page.locator('#score').textContent());
            expect(score).toBeGreaterThanOrEqual(1);
        });

        test('snake grows when food is eaten', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            const initialLength = await page.evaluate(() => snake.length);
            await page.evaluate(() => {
                food = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
            });
            await page.waitForTimeout(200);
            const newLength = await page.evaluate(() => snake.length);
            expect(newLength).toBeGreaterThan(initialLength);
        });

        test('score display updates in the DOM', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await page.evaluate(() => {
                food = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
            });
            await page.waitForTimeout(200);
            await expect(page.locator('#score')).not.toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P key pauses a running game', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('p');
            const s = await page.evaluate(() => state);
            expect(s).toBe('paused');
        });

        test('pause overlay shows "Paused"', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P key resumes a paused game', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('Resume button resumes a paused game', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('p');
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('snake does not move while paused', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('p');
            const headBefore = await page.evaluate(() => ({ ...snake[0] }));
            await page.waitForTimeout(400);
            const headAfter = await page.evaluate(() => ({ ...snake[0] }));
            expect(headAfter).toEqual(headBefore);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('hitting a wall ends the game', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            // Place snake head one step from the right wall, facing right
            await page.evaluate(() => {
                snake = [{ x: COLS - 1, y: 10 }, { x: COLS - 2, y: 10 }];
                dir = DIR.ArrowRight;
                pendingDir = null;
            });
            await page.waitForTimeout(200);
            const s = await page.evaluate(() => state);
            expect(s).toBe('over');
        });

        test('game over overlay is shown', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('game over title includes the score', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            // Eat one food item so score > 0
            await page.evaluate(() => {
                food = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
            });
            await page.waitForTimeout(200);
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay-title')).toContainText('pts');
        });

        test('Play Again button is visible after game over', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('arrow key after game over restarts with score 0', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await page.evaluate(() => endGame());
            await page.keyboard.press('ArrowRight');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score updates on game over if score is higher', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            // Eat 3 food items
            for (let i = 0; i < 3; i++) {
                await page.evaluate(() => {
                    food = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
                });
                await page.waitForTimeout(200);
            }
            await page.evaluate(() => endGame());
            const best = parseInt(await page.locator('#best').textContent());
            expect(best).toBeGreaterThanOrEqual(3);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await page.evaluate(() => {
                food = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
            });
            await page.waitForTimeout(200);
            await page.evaluate(() => endGame());
            const stored = await page.evaluate(() => localStorage.getItem('snake-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(1);
        });
    });
});
