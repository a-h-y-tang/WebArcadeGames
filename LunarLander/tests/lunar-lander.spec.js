const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Lunar Lander', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Lunar Lander', async ({ page }) => {
            await expect(page).toHaveTitle('Lunar Lander');
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

        test('lives start at 3', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('canvas is 600×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('lander starts at rest near the top with a full tank', async ({ page }) => {
            const l = await page.evaluate(() => ({
                vx: lander.vx, vy: lander.vy, angle: lander.angle,
                fuel: lander.fuel, full: FUEL_START, y: lander.y, h: HEIGHT,
            }));
            expect(l.vx).toBe(0);
            expect(l.vy).toBe(0);
            expect(l.angle).toBe(0);
            expect(l.fuel).toBe(l.full);
            expect(l.y).toBeLessThan(l.h / 2);
        });

        test('the landing pad sits on the surface within the screen', async ({ page }) => {
            const ok = await page.evaluate(() =>
                pad.x >= 0 && pad.x + pad.w <= WIDTH && Math.abs(pad.y - groundY) < 0.001
            );
            expect(ok).toBe(true);
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

        test('state is running after start', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Flight physics
    // -----------------------------------------------------------------------
    test.describe('flight physics', () => {
        test('gravity pulls the lander down when drifting', async ({ page }) => {
            await page.keyboard.press('Space');
            const { vyAfter, yBefore, yAfter } = await page.evaluate(() => {
                lander.vx = 0; lander.vy = 0; lander.thrusting = false; lander.angle = 0;
                const yBefore = lander.y;
                step(100);
                return { vyAfter: lander.vy, yBefore, yAfter: lander.y };
            });
            expect(vyAfter).toBeGreaterThan(0);
            expect(yAfter).toBeGreaterThan(yBefore);
        });

        test('upright thrust overcomes gravity (net upward acceleration)', async ({ page }) => {
            await page.keyboard.press('Space');
            const vy = await page.evaluate(() => {
                lander.vx = 0; lander.vy = 0; lander.angle = 0;
                lander.fuel = FUEL_START;
                lander.thrusting = true;
                step(100);
                return lander.vy;
            });
            expect(vy).toBeLessThan(0);
        });

        test('thrusting burns fuel', async ({ page }) => {
            await page.keyboard.press('Space');
            const { before, after } = await page.evaluate(() => {
                lander.fuel = FUEL_START;
                lander.thrusting = true;
                const before = lander.fuel;
                step(100);
                return { before, after: lander.fuel };
            });
            expect(after).toBeLessThan(before);
        });

        test('an empty tank produces no thrust', async ({ page }) => {
            await page.keyboard.press('Space');
            const vy = await page.evaluate(() => {
                lander.vx = 0; lander.vy = 0; lander.angle = 0;
                lander.fuel = 0;
                lander.thrusting = true;
                step(100);
                return lander.vy;
            });
            expect(vy).toBeGreaterThan(0); // only gravity acts
        });

        test('fuel never goes negative', async ({ page }) => {
            await page.keyboard.press('Space');
            const fuel = await page.evaluate(() => {
                lander.fuel = 1;
                lander.thrusting = true;
                step(10000);
                return lander.fuel;
            });
            expect(fuel).toBeGreaterThanOrEqual(0);
        });

        test('rotate-right input increases the angle', async ({ page }) => {
            await page.keyboard.press('Space');
            const { before, after } = await page.evaluate(() => {
                lander.angle = 0;
                rotInput = 1;
                const before = lander.angle;
                step(100);
                return { before, after: lander.angle };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('rotate-left input decreases the angle', async ({ page }) => {
            await page.keyboard.press('Space');
            const { before, after } = await page.evaluate(() => {
                lander.angle = 0;
                rotInput = -1;
                const before = lander.angle;
                step(100);
                return { before, after: lander.angle };
            });
            expect(after).toBeLessThan(before);
        });

        test('horizontal velocity moves the lander sideways', async ({ page }) => {
            await page.keyboard.press('Space');
            const { before, after } = await page.evaluate(() => {
                lander.x = WIDTH / 2;
                lander.y = 100;
                lander.vx = 0.05; lander.vy = 0;
                lander.thrusting = false;
                const before = lander.x;
                step(100);
                return { before, after: lander.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('the lander is clamped to the screen sides', async ({ page }) => {
            await page.keyboard.press('Space');
            const x = await page.evaluate(() => {
                lander.x = WIDTH + 500;
                lander.y = 100;
                lander.vx = 1;
                step(50);
                return lander.x;
            });
            expect(x).toBeLessThanOrEqual(600);
        });
    });

    // -----------------------------------------------------------------------
    // Landing & crashing
    // -----------------------------------------------------------------------
    // Position the lander just above the pad with the given velocity/angle,
    // advance one small step, and report the outcome.
    async function touchdown(page, { vx, vy, angle, overPad = true }) {
        return page.evaluate(({ vx, vy, angle, overPad }) => {
            const targetX = overPad ? pad.x + pad.w / 2 : 10; // 10px is off any centred pad
            lander.x = targetX;
            lander.y = groundY - LANDER_H / 2 - 0.5;
            lander.vx = vx; lander.vy = vy; lander.angle = angle;
            lander.thrusting = false;
            rotInput = 0;
            const livesBefore = lives, levelBefore = level, scoreBefore = score;
            step(60);
            return {
                livesBefore, levelBefore, scoreBefore,
                lives, level, score, state,
            };
        }, { vx, vy, angle, overPad });
    }

    test.describe('landing and crashing', () => {
        test('a gentle, upright, on-pad touchdown is a successful landing', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await touchdown(page, { vx: 0.005, vy: 0.02, angle: 0 });
            expect(r.level).toBe(r.levelBefore + 1);   // advanced a level
            expect(r.lives).toBe(r.livesBefore);       // no life lost
            expect(r.score).toBeGreaterThan(r.scoreBefore);
        });

        test('touching down too fast is a crash', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await touchdown(page, { vx: 0, vy: 0.3, angle: 0 });
            expect(r.lives).toBe(r.livesBefore - 1);
            expect(r.level).toBe(r.levelBefore);
        });

        test('touching down at too steep an angle is a crash', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await touchdown(page, { vx: 0.005, vy: 0.02, angle: 0.6 });
            expect(r.lives).toBe(r.livesBefore - 1);
        });

        test('landing off the pad is a crash', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await touchdown(page, { vx: 0.005, vy: 0.02, angle: 0, overPad: false });
            expect(r.lives).toBe(r.livesBefore - 1);
        });

        test('crashing with lives remaining keeps the game running', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await touchdown(page, { vx: 0, vy: 0.3, angle: 0 });
            expect(r.state).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Level progression
    // -----------------------------------------------------------------------
    test.describe('level progression', () => {
        test('a successful landing lifts the lander back to the top with fuel', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => {
                lander.x = pad.x + pad.w / 2;
                lander.y = groundY - LANDER_H / 2 - 0.5;
                lander.vx = 0.005; lander.vy = 0.02; lander.angle = 0;
                lander.thrusting = false;
                step(60);
                return { y: lander.y, fuel: lander.fuel, h: HEIGHT };
            });
            expect(r.y).toBeLessThan(r.h / 2);
            expect(r.fuel).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('crashing the last lander ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                lives = 1;
                lander.x = pad.x + pad.w / 2;
                lander.y = groundY - LANDER_H / 2 - 0.5;
                lander.vx = 0; lander.vy = 0.3; lander.angle = 0;
                lander.thrusting = false;
                step(60);
                return state;
            });
            expect(s).toBe('over');
        });

        test('the overlay shows Game Over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                lives = 1;
                lander.x = pad.x + pad.w / 2;
                lander.y = groundY - LANDER_H / 2 - 0.5;
                lander.vx = 0; lander.vy = 0.3; lander.angle = 0;
                step(60);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toHaveText('Game Over');
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { lives = 1; score = 10; endGame(); });
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets score, lives, level and fuel', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 500; lives = 1; level = 5; lander.fuel = 3; endGame(); });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({
                score, lives, level, fuel: lander.fuel, full: FUEL_START, state,
            }));
            expect(s.score).toBe(0);
            expect(s.lives).toBe(3);
            expect(s.level).toBe(1);
            expect(s.fuel).toBe(s.full);
            expect(s.state).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('the overlay shows Paused when paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay-title')).toHaveText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not advance physics', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const same = await page.evaluate(() => {
                lander.vx = 0; lander.vy = 0;
                const before = lander.y;
                step(200);
                return before === lander.y;
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Best score persistence
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best score updates on game over when higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 250; endGame(); });
            await expect(page.locator('#best')).toHaveText('250');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 340; endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('lunar-lander-best'));
            expect(stored).toBe('340');
        });

        test('best score is read back from localStorage on reload', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('lunar-lander-best', '900'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('900');
        });
    });
});
