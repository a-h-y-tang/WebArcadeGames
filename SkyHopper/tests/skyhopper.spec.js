const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Fixed seed used wherever a test needs a reproducible platform layout.
const SEED = 1234;

test.describe('Sky Hopper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Sky Hopper', async ({ page }) => {
            await expect(page).toHaveTitle('Sky Hopper');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/press|click|space/i);
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

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('platforms exist on the idle screen', async ({ page }) => {
            expect(await page.evaluate(() => platforms.length)).toBeGreaterThan(0);
        });

        test('hopper starts horizontally centered', async ({ page }) => {
            const centered = await page.evaluate(() => Math.abs(player.x - WIDTH / 2) < 1);
            expect(centered).toBe(true);
        });

        test('there is a platform directly beneath the hopper', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const feet = player.y + PLAYER_H / 2;
                return platforms.some(p =>
                    p.y >= feet - 1 &&
                    p.y < feet + 120 &&
                    player.x >= p.x && player.x <= p.x + p.w);
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('pressing Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('clicking the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('score resets to 0 on start', async ({ page }) => {
            await page.evaluate(() => { score = 999; updateHud(); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('starting with a seed is reproducible', async ({ page }) => {
            const layoutA = await page.evaluate((s) => {
                startGame(s);
                return platforms.map(p => [Math.round(p.x), Math.round(p.y)]);
            }, SEED);
            const layoutB = await page.evaluate((s) => {
                startGame(s);
                return platforms.map(p => [Math.round(p.x), Math.round(p.y)]);
            }, SEED);
            expect(layoutA).toEqual(layoutB);
            expect(layoutA.length).toBeGreaterThan(3);
        });
    });

    // -----------------------------------------------------------------------
    // Physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('gravity accelerates the hopper downward', async ({ page }) => {
            const grew = await page.evaluate((s) => {
                startGame(s);
                // Put the hopper in empty air, well above any platform.
                player.y = -400;
                player.vy = 0;
                const before = player.vy;
                step(16);
                return player.vy > before;
            }, SEED);
            expect(grew).toBe(true);
        });

        test('the hopper bounces up off a platform', async ({ page }) => {
            const launched = await page.evaluate((s) => {
                startGame(s);
                // Hand-place a platform right under the falling hopper.
                platforms.length = 0;
                platforms.push({ x: player.x - 40, y: player.y + 30, w: 80, type: 'normal', vx: 0 });
                player.vy = 0.2;            // moving downward
                player.y = platforms[0].y - PLAYER_H / 2 - 2; // feet just above the top
                step(16);
                return player.vy;
            }, SEED);
            expect(launched).toBeLessThan(0); // now moving upward
        });

        test('the hopper does not bounce while rising through a platform', async ({ page }) => {
            const vy = await page.evaluate((s) => {
                startGame(s);
                platforms.length = 0;
                platforms.push({ x: player.x - 40, y: player.y, w: 80, type: 'normal', vx: 0 });
                player.vy = -0.4;          // moving upward
                player.y = platforms[0].y - PLAYER_H / 2 - 2;
                step(16);
                return player.vy;
            }, SEED);
            expect(vy).toBeLessThan(0); // still rising, was not launched/stopped
        });

        test('left/right keys steer the hopper', async ({ page }) => {
            const moved = await page.evaluate((s) => {
                startGame(s);
                const x0 = player.x;
                keys.right = true;
                step(50);
                const dxRight = player.x - x0;
                keys.right = false;
                keys.left = true;
                const x1 = player.x;
                step(50);
                const dxLeft = player.x - x1;
                keys.left = false;
                return { dxRight, dxLeft };
            }, SEED);
            expect(moved.dxRight).toBeGreaterThan(0);
            expect(moved.dxLeft).toBeLessThan(0);
        });

        test('the hopper wraps around the horizontal edges', async ({ page }) => {
            const wrapped = await page.evaluate((s) => {
                startGame(s);
                player.x = 1;
                keys.left = true;
                step(50);
                keys.left = false;
                return player.x;
            }, SEED);
            expect(wrapped).toBeGreaterThan(200); // reappeared on the right
        });
    });

    // -----------------------------------------------------------------------
    // Camera & scoring
    // -----------------------------------------------------------------------
    test.describe('camera and scoring', () => {
        test('camera follows the hopper upward and score rises', async ({ page }) => {
            const res = await page.evaluate((s) => {
                startGame(s);
                const camBefore = cameraY;
                player.y = -1000;          // far above the start
                player.vy = -0.1;
                step(16);
                return { camBefore, camAfter: cameraY, score };
            }, SEED);
            expect(res.camAfter).toBeLessThan(res.camBefore); // camera moved up
            expect(res.score).toBeGreaterThan(0);
        });

        test('score never decreases when the hopper falls back down', async ({ page }) => {
            const res = await page.evaluate((s) => {
                startGame(s);
                player.y = -1000; player.vy = -0.1; step(16);
                const high = score;
                const camHigh = cameraY;
                // Now fall back down.
                player.y = 0; player.vy = 0.4; step(16);
                return { high, after: score, camHigh, camAfter: cameraY };
            }, SEED);
            expect(res.after).toBe(res.high);           // score monotonic
            expect(res.camAfter).toBe(res.camHigh);      // camera does not drop
        });
    });

    // -----------------------------------------------------------------------
    // Platform generation / recycling
    // -----------------------------------------------------------------------
    test.describe('platform generation', () => {
        test('new platforms are generated above as the hopper climbs', async ({ page }) => {
            const res = await page.evaluate((s) => {
                startGame(s);
                const topBefore = Math.min(...platforms.map(p => p.y));
                player.y = -2000; player.vy = -0.1; step(16);
                const topAfter = Math.min(...platforms.map(p => p.y));
                return { topBefore, topAfter };
            }, SEED);
            expect(res.topAfter).toBeLessThan(res.topBefore); // higher platforms appeared
        });

        test('platforms that scroll off the bottom are recycled', async ({ page }) => {
            const offscreen = await page.evaluate((s) => {
                startGame(s);
                player.y = -3000; player.vy = -0.1;
                for (let i = 0; i < 5; i++) step(16);
                // No platform should remain far below the bottom of the view.
                return platforms.filter(p => p.y - cameraY > HEIGHT + 200).length;
            }, SEED);
            expect(offscreen).toBe(0);
        });

        test('vertical gaps stay within reach of a bounce', async ({ page }) => {
            const reachable = await page.evaluate((s) => {
                startGame(s);
                for (let i = 0; i < 40; i++) { player.y -= 200; player.vy = -0.1; step(16); }
                const ys = platforms.map(p => p.y).sort((a, b) => a - b);
                const maxBounce = (JUMP_V * JUMP_V) / (2 * GRAVITY);
                let maxGap = 0;
                for (let i = 1; i < ys.length; i++) maxGap = Math.max(maxGap, ys[i] - ys[i - 1]);
                return { maxGap, maxBounce };
            }, SEED);
            expect(reachable.maxGap).toBeLessThan(reachable.maxBounce);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('falling below the screen ends the game', async ({ page }) => {
            const over = await page.evaluate((s) => {
                startGame(s);
                player.y = cameraY + HEIGHT + 200; // below the bottom edge
                player.vy = 0.5;
                step(16);
                return state;
            }, SEED);
            expect(over).toBe('over');
        });

        test('game over shows the overlay again', async ({ page }) => {
            await page.evaluate((s) => {
                startGame(s);
                player.y = cameraY + HEIGHT + 200; player.vy = 0.5; step(16);
            }, SEED);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('best score is updated and persisted after game over', async ({ page }) => {
            await page.evaluate((s) => {
                startGame(s);
                player.y = -1200; player.vy = -0.1; step(16); // rack up some score
                const earned = score;
                player.y = cameraY + HEIGHT + 300; player.vy = 0.5; step(16); // die
                window.__earned = earned;
            }, SEED);
            const earned = await page.evaluate(() => window.__earned);
            expect(earned).toBeGreaterThan(0);
            await expect(page.locator('#best')).toHaveText(String(earned));
            const stored = await page.evaluate(() => parseInt(localStorage.getItem('skyhopper-best')));
            expect(stored).toBe(earned);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('physics does not advance while paused', async ({ page }) => {
            const same = await page.evaluate((s) => {
                startGame(s);
                state = 'paused';
                const y0 = player.y, vy0 = player.vy;
                step(16);
                return player.y === y0 && player.vy === vy0;
            }, SEED);
            expect(same).toBe(true);
        });
    });
});
