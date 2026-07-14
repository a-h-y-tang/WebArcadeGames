const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Dino Run', () => {
    test.beforeEach(async ({ page }) => {
        // Each test runs in a fresh browser context, so localStorage is already
        // isolated and empty unless a test explicitly seeds it.
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Dino Run', async ({ page }) => {
            await expect(page).toHaveTitle('Dino Run');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/jump|space/i);
        });

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600x200', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '200');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no obstacles before starting', async ({ page }) => {
            expect(await page.evaluate(() => obstacles.length)).toBe(0);
        });

        test('dino starts grounded', async ({ page }) => {
            const grounded = await page.evaluate(() => dino.y >= GROUND_Y - 0.01);
            expect(grounded).toBe(true);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('dino-best', '4242'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4242');
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('ArrowUp starts the game', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Jump physics
    // -----------------------------------------------------------------------
    test.describe('jumping', () => {
        test('jump lifts the dino off the ground', async ({ page }) => {
            await page.evaluate(() => { startGame(); jump(); step(0.05); });
            const y = await page.evaluate(() => dino.y);
            const groundY = await page.evaluate(() => GROUND_Y);
            expect(y).toBeLessThan(groundY);
        });

        test('gravity brings the dino back to the ground', async ({ page }) => {
            const landed = await page.evaluate(() => {
                startGame();
                nextSpawnDist = Number.MAX_VALUE; // isolate physics from obstacles
                jump();
                for (let i = 0; i < 200; i++) step(0.016);
                return dino.y >= GROUND_Y - 0.01 && dino.vy === 0;
            });
            expect(landed).toBe(true);
        });

        test('no double jump while airborne', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                jump();
                step(0.1);
                const vyAfterFirst = dino.vy;
                jump(); // should be ignored mid-air
                return { vyAfterFirst, vyAfterSecond: dino.vy };
            });
            expect(result.vyAfterSecond).toBe(result.vyAfterFirst);
        });

        test('can jump again after landing', async ({ page }) => {
            const airborne = await page.evaluate(() => {
                startGame();
                nextSpawnDist = Number.MAX_VALUE; // isolate physics from obstacles
                jump();
                for (let i = 0; i < 200; i++) step(0.016); // land
                jump();
                step(0.05);
                return dino.y < GROUND_Y;
            });
            expect(airborne).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Ducking
    // -----------------------------------------------------------------------
    test.describe('ducking', () => {
        test('ducking shrinks the dino hitbox height', async ({ page }) => {
            const { standing, ducking } = await page.evaluate(() => {
                startGame();
                const standing = dinoHitbox().h;
                setDuck(true);
                const ducking = dinoHitbox().h;
                return { standing, ducking };
            });
            expect(ducking).toBeLessThan(standing);
        });

        test('releasing duck restores the hitbox height', async ({ page }) => {
            const { ducking, restored } = await page.evaluate(() => {
                startGame();
                setDuck(true);
                const ducking = dinoHitbox().h;
                setDuck(false);
                const restored = dinoHitbox().h;
                return { ducking, restored };
            });
            expect(restored).toBeGreaterThan(ducking);
        });

        test('ducking in the air makes the dino fall faster', async ({ page }) => {
            const { normalY, fastY } = await page.evaluate(() => {
                startGame();
                jump();
                step(0.2);
                const normalY = dino.y;
                // reset and repeat with duck held during descent
                startGame();
                jump();
                step(0.1);
                setDuck(true);
                step(0.1);
                const fastY = dino.y;
                setDuck(false);
                return { normalY, fastY };
            });
            expect(fastY).toBeGreaterThan(normalY);
        });
    });

    // -----------------------------------------------------------------------
    // Obstacles & scrolling
    // -----------------------------------------------------------------------
    test.describe('obstacles', () => {
        test('spawnObstacle adds an obstacle at the right edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                obstacles.length = 0;
                spawnObstacle('cactus');
                return obstacles[0].x;
            });
            expect(x).toBeGreaterThanOrEqual(600);
        });

        test('obstacles scroll left as the world advances', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                obstacles.length = 0;
                spawnObstacle('cactus');
                const before = obstacles[0].x;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: obstacles[0].x };
            });
            expect(after).toBeLessThan(before);
        });

        test('obstacles that scroll off-screen are removed', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                obstacles.length = 0;
                spawnObstacle('cactus');
                obstacles[0].x = -100; // already past the left edge
                step(0.016);
                return obstacles.length;
            });
            expect(count).toBe(0);
        });

        test('bird obstacles can be created at a given height', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                obstacles.length = 0;
                spawnObstacle('bird', { y: 60 });
                return obstacles[0].y;
            });
            expect(y).toBe(60);
        });

        test('world speed increases with distance', async ({ page }) => {
            const { slow, fast } = await page.evaluate(() => {
                startGame();
                const slow = speed;
                for (let i = 0; i < 600; i++) step(0.016);
                return { slow, fast: speed };
            });
            expect(fast).toBeGreaterThan(slow);
        });
    });

    // -----------------------------------------------------------------------
    // Collision & game over
    // -----------------------------------------------------------------------
    test.describe('collision', () => {
        test('running into a cactus ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                obstacles.length = 0;
                // place a cactus overlapping the dino
                spawnObstacle('cactus');
                obstacles[0].x = dino.x;
                step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('a high bird passes over a ducking dino without collision', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                obstacles.length = 0;
                spawnObstacle('bird', { y: 10 }); // near the top
                obstacles[0].x = dino.x;
                setDuck(true);
                step(0.016);
                return state;
            });
            expect(s).toBe('running');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('score increases as distance grows', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 300; i++) step(0.016);
                return score;
            });
            expect(score).toBeGreaterThan(0);
        });

        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 777;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('dino-best'));
            expect(parseInt(stored, 10)).toBe(777);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('dino-best', '5000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 10;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('5000');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the world', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                obstacles.length = 0;
                spawnObstacle('cactus');
                togglePause();
                const before = obstacles[0].x;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: obstacles[0].x };
            });
            expect(after).toBe(before);
        });

        test('resuming lets the world move again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                obstacles.length = 0;
                spawnObstacle('cactus');
                togglePause();
                togglePause();
                const before = obstacles[0].x;
                for (let i = 0; i < 10; i++) step(0.016);
                return obstacles[0].x < before;
            });
            expect(moved).toBe(true);
        });

        test('restart after game over resets score and obstacles', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                score = 999;
                spawnObstacle('cactus');
                endGame();
                startGame();
                return { score, obstacles: obstacles.length, state };
            });
            expect(result.score).toBe(0);
            expect(result.obstacles).toBe(0);
            expect(result.state).toBe('running');
        });
    });
});
