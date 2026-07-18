const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Whack-a-Mole', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Whack-a-Mole', async ({ page }) => {
            await expect(page).toHaveTitle('Whack-a-Mole');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to press a key', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('time shows the full game length', async ({ page }) => {
            const expected = await page.evaluate(() => Math.ceil(GAME_TIME / 1000));
            await expect(page.locator('#time')).toHaveText(String(expected));
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('canvas is 500×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state is idle before starting', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });

        test('there are nine holes', async ({ page }) => {
            const n = await page.evaluate(() => holes.length);
            expect(n).toBe(9);
        });

        test('all holes start empty', async ({ page }) => {
            const allEmpty = await page.evaluate(() => holes.every(h => h.state === 'empty'));
            expect(allEmpty).toBe(true);
        });

        test('holes are laid out on a 3×3 grid', async ({ page }) => {
            const grid = await page.evaluate(() => GRID);
            expect(grid).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state is running after start', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('time is full right after starting', async ({ page }) => {
            await page.keyboard.press('Space');
            // The animation loop may have ticked a frame; allow for that.
            const remaining = await page.evaluate(() => GAME_TIME - timeLeft);
            expect(remaining).toBeGreaterThanOrEqual(0);
            expect(remaining).toBeLessThan(200);
        });
    });

    // -----------------------------------------------------------------------
    // Moles
    // -----------------------------------------------------------------------
    test.describe('moles', () => {
        test('popMole raises a mole in the given hole', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                autoSpawn = false;
                popMole(4);
                return holes[4].state;
            });
            expect(s).toBe('up');
        });

        test('an un-whacked mole ducks back down after its up-time', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                autoSpawn = false;
                popMole(4);
                step(MOLE_UP_TIME + 500);
                return holes[4].state;
            });
            expect(s).toBe('empty');
        });

        test('a mole that escapes counts as a miss', async ({ page }) => {
            await page.keyboard.press('Space');
            const misses = await page.evaluate(() => {
                autoSpawn = false;
                misses = 0;
                popMole(4);
                step(MOLE_UP_TIME + 500);
                return misses;
            });
            expect(misses).toBe(1);
        });

        test('moles do not change while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                autoSpawn = false;
                popMole(4);
            });
            await page.keyboard.press('p');
            const before = await page.evaluate(() => holes[4].state);
            await page.evaluate(() => step(10000));
            const after = await page.evaluate(() => holes[4].state);
            expect(before).toBe('up');
            expect(after).toBe('up');
        });
    });

    // -----------------------------------------------------------------------
    // Whacking
    // -----------------------------------------------------------------------
    test.describe('whacking', () => {
        test('whacking an up mole scores points', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                autoSpawn = false;
                popMole(2);
                whack(2);
            });
            const score = parseInt(await page.locator('#score').textContent());
            expect(score).toBe(await page.evaluate(() => HIT_POINTS));
        });

        test('whacking an up mole drops it', async ({ page }) => {
            await page.keyboard.press('Space');
            const stillUp = await page.evaluate(() => {
                autoSpawn = false;
                popMole(2);
                whack(2);
                return holes[2].state === 'up';
            });
            expect(stillUp).toBe(false);
        });

        test('whacking an empty hole scores nothing', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                autoSpawn = false;
                whack(0);
            });
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('the same mole cannot be scored twice', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                autoSpawn = false;
                popMole(5);
                whack(5);
                whack(5);
            });
            const score = parseInt(await page.locator('#score').textContent());
            expect(score).toBe(await page.evaluate(() => HIT_POINTS));
        });

        test('a whacked mole is not counted as a miss', async ({ page }) => {
            await page.keyboard.press('Space');
            const misses = await page.evaluate(() => {
                autoSpawn = false;
                misses = 0;
                popMole(1);
                whack(1);
                step(MOLE_UP_TIME + 500);
                return misses;
            });
            expect(misses).toBe(0);
        });

        test('number key 1 whacks the first hole', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { autoSpawn = false; popMole(0); });
            await page.keyboard.press('1');
            const score = parseInt(await page.locator('#score').textContent());
            expect(score).toBeGreaterThan(0);
        });

        test('clicking a hole whacks the mole there', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { autoSpawn = false; popMole(4); });
            const box = await page.locator('#canvas').boundingBox();
            const c = await page.evaluate(() => ({ x: holes[4].x, y: holes[4].y }));
            await page.mouse.click(box.x + c.x, box.y + c.y);
            const score = parseInt(await page.locator('#score').textContent());
            expect(score).toBeGreaterThan(0);
        });

        test('whacking does nothing before the game starts', async ({ page }) => {
            await page.evaluate(() => whack(0));
            await expect(page.locator('#score')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Timer & levels
    // -----------------------------------------------------------------------
    test.describe('timer and levels', () => {
        test('the clock counts down as time passes', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => timeLeft);
            await page.evaluate(() => { autoSpawn = false; step(1000); });
            const after = await page.evaluate(() => timeLeft);
            expect(after).toBeLessThan(before);
        });

        test('the displayed seconds decrease', async ({ page }) => {
            await page.keyboard.press('Space');
            const full = await page.evaluate(() => Math.ceil(GAME_TIME / 1000));
            await page.evaluate(() => { autoSpawn = false; step(3000); });
            const shown = parseInt(await page.locator('#time').textContent());
            expect(shown).toBeLessThan(full);
        });

        test('the level rises as time elapses', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { autoSpawn = false; step(10000); });
            const level = parseInt(await page.locator('#level').textContent());
            expect(level).toBeGreaterThan(1);
        });

        test('the game ends when the clock runs out', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                autoSpawn = false;
                step(GAME_TIME + 100);
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

        test('the clock does not tick while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const before = await page.evaluate(() => timeLeft);
            await page.evaluate(() => step(5000));
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
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('game over score shows points', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay-score')).toContainText('pts');
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets score, time and level', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 120;
                level = 3;
                timeLeft = 5000;
                misses = 7;
                endGame();
            });
            await page.keyboard.press('Space');
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            const full = await page.evaluate(() => Math.ceil(GAME_TIME / 1000));
            await expect(page.locator('#time')).toHaveText(String(full));
            const misses = await page.evaluate(() => misses);
            expect(misses).toBe(0);
        });

        test('best score updates on game over if higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 200;
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent());
            expect(best).toBeGreaterThanOrEqual(200);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 300;
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('whack-a-mole-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(300);
        });
    });
});
