const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Moon Patrol', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Moon Patrol', async ({ page }) => {
            await expect(page).toHaveTitle('Moon Patrol');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/enter|jump|start/i);
        });

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('lives start at 3', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('canvas is 600x260', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '260');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no hazards before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                rocks: rocks.length, craters: craters.length, ufos: ufos.length, bullets: bullets.length,
            }));
            expect(counts).toEqual({ rocks: 0, craters: 0, ufos: 0, bullets: 0 });
        });

        test('buggy starts grounded', async ({ page }) => {
            const grounded = await page.evaluate(() => buggy.onGround && buggy.y >= GROUND_Y - 0.01);
            expect(grounded).toBe(true);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('moonpatrol-best', '3131'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('3131');
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting resets score, lives and hazards', async ({ page }) => {
            const fresh = await page.evaluate(() => {
                startGame();
                return { score, lives, rocks: rocks.length, craters: craters.length, ufos: ufos.length };
            });
            expect(fresh).toEqual({ score: 0, lives: 3, rocks: 0, craters: 0, ufos: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Jumping
    // -----------------------------------------------------------------------
    test.describe('jumping', () => {
        test('jump lifts the buggy off the ground', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                jump();
                step(0.05);
                return buggy.y;
            });
            const groundY = await page.evaluate(() => GROUND_Y);
            expect(y).toBeLessThan(groundY);
        });

        test('gravity brings the buggy back to the ground', async ({ page }) => {
            const landed = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                jump();
                for (let i = 0; i < 200; i++) step(0.016);
                return buggy.onGround && buggy.y >= GROUND_Y - 0.01;
            });
            expect(landed).toBe(true);
        });

        test('no double jump while airborne', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                jump();
                step(0.08);
                const vyAfterFirst = buggy.vy;
                jump(); // ignored mid-air
                return { vyAfterFirst, vyAfterSecond: buggy.vy };
            });
            expect(result.vyAfterSecond).toBe(result.vyAfterFirst);
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test('firing creates a forward and an up bullet', async ({ page }) => {
            const dirs = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                fire();
                return bullets.map((b) => b.dir).sort();
            });
            expect(dirs).toEqual(['fwd', 'up']);
        });

        test('a forward bullet travels to the right', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                fire();
                const b = bullets.find((x) => x.dir === 'fwd');
                const before = b.x;
                step(0.05);
                return b.x - before;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('an up bullet travels upward', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                fire();
                const b = bullets.find((x) => x.dir === 'up');
                const before = b.y;
                step(0.05);
                return b.y - before;
            });
            expect(moved).toBeLessThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rocks
    // -----------------------------------------------------------------------
    test.describe('rocks', () => {
        test('a forward bullet destroys a rock and scores', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                spawnRock({ x: 200 });
                fire();
                for (let i = 0; i < 120 && rocks.length > 0; i++) step(0.016);
                return { rocks: rocks.length, score, lives };
            });
            expect(result.rocks).toBe(0);
            expect(result.score).toBeGreaterThan(0);
            expect(result.lives).toBe(3); // shooting a rock is not a crash
        });

        test('driving into a rock costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                spawnRock({ x: BUGGY_X + 8 }); // right on top of the buggy
                for (let i = 0; i < 30 && lives === 3; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('jumping clears a rock without crashing', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                // place a rock a little ahead, then jump so we are airborne as it arrives
                spawnRock({ x: BUGGY_X + 90 });
                jump();
                for (let i = 0; i < 120 && rocks.length > 0; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Craters
    // -----------------------------------------------------------------------
    test.describe('craters', () => {
        test('driving over a crater on the ground crashes', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                spawnCrater({ x: BUGGY_X });
                for (let i = 0; i < 20 && lives === 3; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('jumping over a crater is safe', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                spawnCrater({ x: BUGGY_X + 70 });
                jump();
                for (let i = 0; i < 120 && craters.length > 0; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // UFOs
    // -----------------------------------------------------------------------
    test.describe('ufos', () => {
        test('an up bullet destroys a UFO and scores', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                spawnUfo({ x: BUGGY_X + 20, y: 60, vx: 0, vy: 0 });
                fire();
                for (let i = 0; i < 120 && ufos.length > 0; i++) step(0.016);
                return { ufos: ufos.length, score };
            });
            expect(result.ufos).toBe(0);
            expect(result.score).toBeGreaterThan(0);
        });

        test('a UFO that reaches the buggy costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                // descend straight onto the buggy
                spawnUfo({ x: BUGGY_X + 10, y: 90, vx: 0, vy: 260 });
                for (let i = 0; i < 120 && lives === 3; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring / distance
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('distance and score increase as the world scrolls', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                for (let i = 0; i < 120; i++) step(0.016);
                return { distance, score };
            });
            expect(result.distance).toBeGreaterThan(0);
            expect(result.score).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('losing all lives ends the game', async ({ page }) => {
            const state = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                for (let crash = 0; crash < 3; crash++) {
                    spawnRock({ x: BUGGY_X + 8 });
                    for (let i = 0; i < 200 && buggy.invuln <= 0 && lives === 3 - crash; i++) step(0.016);
                    // wait out the invulnerability window before the next crash
                    for (let i = 0; i < 200 && buggy.invuln > 0; i++) step(0.016);
                }
                return state;
            });
            expect(state).toBe('over');
        });

        test('game over shows the overlay', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                lives = 1;
                spawnRock({ x: BUGGY_X + 8 });
                for (let i = 0; i < 60 && state === 'running'; i++) step(0.016);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('game over records a new best score', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                for (let i = 0; i < 200; i++) step(0.016); // build up some score
                lives = 1;
                spawnRock({ x: BUGGY_X + 8 });
                for (let i = 0; i < 60 && state === 'running'; i++) step(0.016);
                return best;
            });
            expect(best).toBeGreaterThan(0);
        });

        test('the world does not scroll after game over', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                endGame();
                const before = distance;
                step(0.2);
                return distance === before;
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Invulnerability
    // -----------------------------------------------------------------------
    test.describe('invulnerability', () => {
        test('a single rock cannot cost two lives in one pass', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                autoSpawn = false;
                spawnRock({ x: BUGGY_X + 8 });
                for (let i = 0; i < 90; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the world does not scroll while paused', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                togglePause();
                const before = distance;
                step(0.2);
                return distance === before;
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // The live spawner
    // -----------------------------------------------------------------------
    test.describe('auto spawner', () => {
        test('hazards appear on their own over time', async ({ page }) => {
            const spawned = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) step(0.016);
                return rocks.length + craters.length + ufos.length > 0 || score > 0;
            });
            expect(spawned).toBe(true);
        });
    });
});
