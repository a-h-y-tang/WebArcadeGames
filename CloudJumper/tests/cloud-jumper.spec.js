const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Cloud Jumper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Cloud Jumper', async ({ page }) => {
            await expect(page).toHaveTitle('Cloud Jumper');
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

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 400×600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '400');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('the world is seeded with platforms', async ({ page }) => {
            const n = await page.evaluate(() => platforms.length);
            expect(n).toBeGreaterThan(3);
        });

        test('the player starts within the horizontal bounds', async ({ page }) => {
            const ok = await page.evaluate(
                () => player.x >= 0 && player.x + PLAYER_W <= W
            );
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses the overlay', async ({ page }) => {
            await page.keyboard.press(' ');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a movement key dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is running after start', async ({ page }) => {
            await page.keyboard.press(' ');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Horizontal movement + wrap
    // -----------------------------------------------------------------------
    test.describe('horizontal movement', () => {
        test('holding a movement key updates the key state', async ({ page }) => {
            await page.keyboard.press(' '); // start
            await page.keyboard.down('ArrowLeft');
            expect(await page.evaluate(() => keys.left)).toBe(true);
            await page.keyboard.up('ArrowLeft');
            expect(await page.evaluate(() => keys.left)).toBe(false);
        });

        test('a physics step moves the player left when left is held', async ({ page }) => {
            const r = await page.evaluate(() => {
                player.x = 200; keys.left = true; keys.right = false;
                const before = player.x;
                step();
                keys.left = false;
                return { before, after: player.x };
            });
            expect(r.after).toBeLessThan(r.before);
        });

        test('a physics step moves the player right when right is held', async ({ page }) => {
            const r = await page.evaluate(() => {
                player.x = 100; keys.right = true; keys.left = false;
                const before = player.x;
                step();
                keys.right = false;
                return { before, after: player.x };
            });
            expect(r.after).toBeGreaterThan(r.before);
        });

        test('the player wraps around the right edge to the left', async ({ page }) => {
            const x = await page.evaluate(() => {
                keys.left = false; keys.right = false;
                player.x = W + 1;
                step();
                return player.x;
            });
            expect(x).toBeLessThan(0);
        });

        test('the player wraps around the left edge to the right', async ({ page }) => {
            const r = await page.evaluate(() => {
                keys.left = false; keys.right = false;
                player.x = -PLAYER_W - 1;
                step();
                return { x: player.x, limit: W - PLAYER_W };
            });
            expect(r.x).toBeGreaterThan(r.limit);
        });
    });

    // -----------------------------------------------------------------------
    // Gravity + bouncing
    // -----------------------------------------------------------------------
    test.describe('gravity and bouncing', () => {
        test('gravity pulls a free player downward', async ({ page }) => {
            const r = await page.evaluate(() => {
                platforms.length = 0;              // no platforms to catch the player
                keys.left = false; keys.right = false;
                player.x = 180; player.y = 300; player.vx = 0; player.vy = 0;
                const y0 = player.y;
                step(); step(); step();
                return { y0, y1: player.y, vy: player.vy };
            });
            expect(r.y1).toBeGreaterThan(r.y0);
            expect(r.vy).toBeGreaterThan(0);
        });

        test('landing on a platform bounces the player upward', async ({ page }) => {
            const vy = await page.evaluate(() => {
                platforms.length = 0;
                platforms.push({ x: 180, y: 400 });
                keys.left = false; keys.right = false;
                player.x = 190;
                player.y = 400 - PLAYER_H - 2;     // just above the platform
                player.vx = 0; player.vy = 5;      // falling
                step();
                return player.vy;
            });
            expect(vy).toBeLessThan(0);            // now moving up
        });

        test('a rising player passes through platforms (no downward snap)', async ({ page }) => {
            const vy = await page.evaluate(() => {
                platforms.length = 0;
                platforms.push({ x: 180, y: 400 });
                keys.left = false; keys.right = false;
                player.x = 190;
                player.y = 400 - PLAYER_H - 2;
                player.vx = 0; player.vy = -8;     // moving up through the platform
                step();
                return player.vy;
            });
            expect(vy).toBeLessThan(0);            // still rising, not caught
        });
    });

    // -----------------------------------------------------------------------
    // Scrolling + scoring
    // -----------------------------------------------------------------------
    test.describe('scrolling and scoring', () => {
        test('climbing above the threshold increases the score', async ({ page }) => {
            const r = await page.evaluate(() => {
                keys.left = false; keys.right = false;
                player.y = 40; player.vy = 0;      // well above the scroll threshold
                const s0 = score;
                step();
                return { s0, s1: score };
            });
            expect(r.s1).toBeGreaterThan(r.s0);
        });

        test('the score display updates in the DOM after climbing', async ({ page }) => {
            await page.evaluate(() => {
                keys.left = false; keys.right = false;
                player.y = 40; player.vy = 0;
                step();
            });
            await expect(page.locator('#score')).not.toHaveText('0');
        });

        test('scrolling keeps the player pinned at the threshold', async ({ page }) => {
            const r = await page.evaluate(() => {
                keys.left = false; keys.right = false;
                player.y = 40; player.vy = 0;
                step();
                return { y: player.y, threshold: SCROLL_THRESHOLD };
            });
            expect(r.y).toBeCloseTo(r.threshold, 0);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('falling below the bottom ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                platforms.length = 0;
                player.y = H + 1; player.vy = 2;
                step();
                return state;
            });
            expect(s).toBe('over');
        });

        test('game over overlay is shown', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('game over overlay shows the score', async ({ page }) => {
            await page.evaluate(() => { score = 42; scoreEl.textContent = score; endGame(); });
            await expect(page.locator('#overlay-score')).toContainText('42');
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('starting after game over resets the score to 0', async ({ page }) => {
            await page.evaluate(() => { score = 30; scoreEl.textContent = score; endGame(); });
            await page.keyboard.press(' ');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score updates on game over when the score is higher', async ({ page }) => {
            await page.evaluate(() => { score = 25; scoreEl.textContent = score; endGame(); });
            const best = parseInt(await page.locator('#best').textContent(), 10);
            expect(best).toBeGreaterThanOrEqual(25);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => { score = 17; scoreEl.textContent = score; endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('cloud-jumper-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(17);
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('pause overlay shows "Paused"', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Resume button resumes a paused game', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.keyboard.press('p');
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the player does not move while paused', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ x: player.x, y: player.y }));
            await page.waitForTimeout(300);
            const after = await page.evaluate(() => ({ x: player.x, y: player.y }));
            expect(after).toEqual(before);
        });
    });
});
