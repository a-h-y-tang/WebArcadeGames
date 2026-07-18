const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Fruit Slice', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => window.localStorage.clear());
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Fruit Slice', async ({ page }) => {
            await expect(page).toHaveTitle('Fruit Slice');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains slicing', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/slice/i);
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('lives start at 3', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('canvas is 600×600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('state starts as ready', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('ready');
        });

        test('no objects on screen before starting', async ({ page }) => {
            expect(await page.evaluate(() => objects.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('the Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('state is running after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('gravity accelerates objects downward', async ({ page }) => {
            await page.locator('#btn-start').click();
            const vy = await page.evaluate(() => {
                objects = [{ x: 300, y: 300, vx: 0, vy: 0, r: 28, type: 'fruit', sliced: false }];
                const o = objects[0];
                step(0.05);
                return o.vy;
            });
            expect(vy).toBeGreaterThan(0);
        });

        test('an object drifts horizontally with its velocity', async ({ page }) => {
            await page.locator('#btn-start').click();
            const dx = await page.evaluate(() => {
                objects = [{ x: 300, y: 300, vx: 120, vy: -100, r: 28, type: 'fruit', sliced: false }];
                const o = objects[0];
                const x0 = o.x;
                step(0.05);
                return o.x - x0;
            });
            expect(dx).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Slicing
    // -----------------------------------------------------------------------
    test.describe('slicing', () => {
        test('slicing a fruit scores a point and removes it', async ({ page }) => {
            await page.locator('#btn-start').click();
            const result = await page.evaluate(() => {
                score = 0;
                objects = [{ x: 300, y: 300, vx: 0, vy: 0, r: 28, type: 'fruit', sliced: false }];
                const hit = slice(240, 300, 360, 300); // horizontal line through the fruit
                return { hit, score, remaining: objects.length };
            });
            expect(result.hit).toBe(1);
            expect(result.score).toBeGreaterThanOrEqual(1);
            expect(result.remaining).toBe(0);
        });

        test('a stroke that misses does not score', async ({ page }) => {
            await page.locator('#btn-start').click();
            const result = await page.evaluate(() => {
                score = 0;
                objects = [{ x: 300, y: 300, vx: 0, vy: 0, r: 28, type: 'fruit', sliced: false }];
                const hit = slice(0, 0, 20, 20); // far away
                return { hit, score, remaining: objects.length };
            });
            expect(result.hit).toBe(0);
            expect(result.score).toBe(0);
            expect(result.remaining).toBe(1);
        });

        test('slicing two fruit in one stroke pays a combo bonus', async ({ page }) => {
            await page.locator('#btn-start').click();
            const score = await page.evaluate(() => {
                score = 0;
                objects = [
                    { x: 250, y: 300, vx: 0, vy: 0, r: 28, type: 'fruit', sliced: false },
                    { x: 350, y: 300, vx: 0, vy: 0, r: 28, type: 'fruit', sliced: false },
                ];
                slice(200, 300, 400, 300); // sweeps through both
                return score;
            });
            expect(score).toBeGreaterThan(2); // 2 base points + combo bonus
        });

        test('the score display updates in the DOM after a slice', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                objects = [{ x: 300, y: 300, vx: 0, vy: 0, r: 28, type: 'fruit', sliced: false }];
                slice(240, 300, 360, 300);
            });
            await expect(page.locator('#score')).not.toHaveText('0');
        });

        test('slicing a bomb ends the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                objects = [{ x: 300, y: 300, vx: 0, vy: 0, r: 26, type: 'bomb', sliced: false }];
                slice(240, 300, 360, 300);
                return state;
            });
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Lives / missed fruit
    // -----------------------------------------------------------------------
    test.describe('lives', () => {
        test('a fruit falling off the bottom costs a life', async ({ page }) => {
            await page.locator('#btn-start').click();
            const result = await page.evaluate(() => {
                objects = [{ x: 300, y: HEIGHT - 1, vx: 0, vy: 200, r: 20, type: 'fruit', sliced: false }];
                const before = lives;
                step(0.2); // falls well past the bottom
                return { before, after: lives, remaining: objects.length };
            });
            expect(result.after).toBe(result.before - 1);
            expect(result.remaining).toBe(0);
        });

        test('a bomb falling off the bottom costs no life', async ({ page }) => {
            await page.locator('#btn-start').click();
            const result = await page.evaluate(() => {
                objects = [{ x: 300, y: HEIGHT - 1, vx: 0, vy: 200, r: 20, type: 'bomb', sliced: false }];
                const before = lives;
                step(0.2);
                return { before, after: lives };
            });
            expect(result.after).toBe(result.before);
        });

        test('lives display updates in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                objects = [{ x: 300, y: HEIGHT - 1, vx: 0, vy: 200, r: 20, type: 'fruit', sliced: false }];
                step(0.2);
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                lives = 1;
                objects = [{ x: 300, y: HEIGHT - 1, vx: 0, vy: 200, r: 20, type: 'fruit', sliced: false }];
                step(0.2);
                return state;
            });
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('the pause overlay shows "Paused"', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('step does nothing while paused', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            const same = await page.evaluate(() => {
                objects = [{ x: 300, y: 300, vx: 0, vy: 0, r: 28, type: 'fruit', sliced: false }];
                const o = objects[0];
                step(0.2);
                return o.vy === 0 && o.y === 300;
            });
            expect(same).toBe(true);
        });

        test('slice does nothing while paused', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            const result = await page.evaluate(() => {
                score = 0;
                objects = [{ x: 300, y: 300, vx: 0, vy: 0, r: 28, type: 'fruit', sliced: false }];
                const hit = slice(240, 300, 360, 300);
                return { hit, score };
            });
            expect(result.hit).toBe(0);
            expect(result.score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('the game over overlay is shown', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('the Play Again button appears after game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets score and lives', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 30; lives = 1; updateHud(); endGame(); });
            await page.locator('#btn-start').click();
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('best score updates when the run beats it', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 42; updateHud(); endGame(); });
            const best = parseInt(await page.locator('#best').textContent(), 10);
            expect(best).toBe(42);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 99; updateHud(); endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('fruitslice-best'));
            expect(parseInt(stored, 10)).toBe(99);
        });
    });
});
