const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
// The page's own animation loop is switched off in beforeEach (autoStep = false)
// so these are the only frames the game ever sees during a spec.
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with the door closed, so a spec only ever sees the patrons it
// puts on the bars itself. Specs about spawning leave the door open.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
    });

const read = (page, fn) => page.evaluate(fn);

test.describe('Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(() => {
            autoStep = false;
            localStorage.removeItem('tapper-best');
            best = 0;
        });
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tapper', async ({ page }) => {
            await expect(page).toHaveTitle('Tapper');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await read(page, () => state)).toBe('idle');
        });

        test('there are four bars', async ({ page }) => {
            expect(await read(page, () => LANE_COUNT)).toBe(4);
            expect(await read(page, () => LANE_Y.length)).toBe(4);
        });

        test('HUD shows starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('the bars start empty', async ({ page }) => {
            const counts = await read(page, () => [mugs.length, customers.length, tips.length]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('stepping while idle changes nothing', async ({ page }) => {
            await advance(page, 120);
            expect(await read(page, () => state)).toBe('idle');
            expect(await read(page, () => score)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting a game', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'playing');
        });

        test('the bartender starts on the top bar', async ({ page }) => {
            await startQuiet(page);
            expect(await read(page, () => bartender.lane)).toBe(0);
        });

        test('starting resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                score = 999;
                lives = 1;
                level = 7;
                startGame();
            });
            const startLives = await read(page, () => START_LIVES);
            const s = await read(page, () => [score, lives, level]);
            expect(s).toEqual([0, startLives, 1]);
        });
    });

    // -----------------------------------------------------------------------
    // Bartender movement
    // -----------------------------------------------------------------------
    test.describe('bartender movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowDown moves down a bar', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.waitForFunction(() => bartender.lane === 1);
        });

        test('ArrowUp moves back up a bar', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.waitForFunction(() => bartender.lane === 1);
            await page.keyboard.press('ArrowUp');
            await page.waitForFunction(() => bartender.lane === 0);
        });

        test('the bartender cannot go above the top bar', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await page.keyboard.press('ArrowUp');
            expect(await read(page, () => bartender.lane)).toBe(0);
        });

        test('the bartender cannot go below the bottom bar', async ({ page }) => {
            for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
            await page.waitForFunction(() => bartender.lane === LANE_COUNT - 1);
            expect(await read(page, () => bartender.lane)).toBe(3);
        });

        test('W and S also move the bartender', async ({ page }) => {
            await page.keyboard.press('s');
            await page.waitForFunction(() => bartender.lane === 1);
            await page.keyboard.press('w');
            await page.waitForFunction(() => bartender.lane === 0);
        });

        test('the bartender does not move while idle', async ({ page }) => {
            await page.evaluate(() => { state = 'idle'; });
            await page.keyboard.press('ArrowDown');
            expect(await read(page, () => bartender.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring a mug', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('serve() puts a full mug at the tap in the current lane', async ({ page }) => {
            const mug = await page.evaluate(() => {
                bartender.lane = 2;
                serve();
                return mugs[0];
            });
            expect(mug.lane).toBe(2);
            expect(mug.dir).toBe(-1);
            expect(mug.x).toBeCloseTo(await read(page, () => TAP_X), 3);
        });

        test('a full mug slides away from the tap', async ({ page }) => {
            await page.evaluate(() => serve());
            const before = await read(page, () => mugs[0].x);
            await advance(page, 30);
            const after = await read(page, () => mugs[0].x);
            expect(after).toBeLessThan(before);
        });

        test('Space pours a mug while playing', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => mugs.length === 1);
        });

        test('a bar holds at most MAX_MUGS_PER_LANE full mugs', async ({ page }) => {
            const count = await page.evaluate(() => {
                serve();
                serve();
                serve();
                serve();
                return mugs.length;
            });
            expect(count).toBe(await read(page, () => MAX_MUGS_PER_LANE));
        });

        test('the per-lane cap is per lane, not global', async ({ page }) => {
            const count = await page.evaluate(() => {
                serve();
                serve();
                bartender.lane = 1;
                serve();
                return mugs.length;
            });
            expect(count).toBe(3);
        });

        test('serve() does nothing while idle', async ({ page }) => {
            const count = await page.evaluate(() => {
                state = 'idle';
                serve();
                return mugs.length;
            });
            expect(count).toBe(0);
        });

        test('a full mug that reaches the far end shatters and costs a life', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 200);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => lives)).toBe(await read(page, () => START_LIVES - 1));
        });
    });

    // -----------------------------------------------------------------------
    // Patrons
    // -----------------------------------------------------------------------
    test.describe('patrons', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('spawnCustomer() puts a patron at the door', async ({ page }) => {
            const c = await page.evaluate(() => {
                spawnCustomer(1);
                return customers[0];
            });
            expect(c.lane).toBe(1);
            expect(c.x).toBeCloseTo(await read(page, () => BAR_LEFT), 3);
            expect(c.drinking).toBe(false);
        });

        test('a patron walks towards the tap', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0));
            const before = await read(page, () => customers[0].x);
            await advance(page, 60);
            const after = await read(page, () => customers[0].x);
            expect(after).toBeGreaterThan(before);
        });

        test('a patron who reaches the bartender costs a life', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = GRAB_X - 4;
            });
            await advance(page, 30);
            expect(await read(page, () => lives)).toBe(await read(page, () => START_LIVES - 1));
            expect(await read(page, () => customers.length)).toBe(0);
        });

        test('losing a life sweeps the bars clean', async ({ page }) => {
            await page.evaluate(() => {
                bartender.lane = 3;
                serve();
                spawnCustomer(0);
                customers[0].x = GRAB_X - 2;
            });
            await advance(page, 30);
            const counts = await read(page, () => [mugs.length, customers.length, tips.length]);
            expect(counts).toEqual([0, 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Serving: mug meets patron
    // -----------------------------------------------------------------------
    test.describe('serving a patron', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a mug that reaches a patron is consumed and shoves them back', async ({ page }) => {
            const before = await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                serve();
                return customers[0].x;
            });
            // The mug meets the patron around frame 50 and the drink lasts
            // another 42 frames, so 70 lands mid-drink: mug gone, patron shoved.
            await advance(page, 70);
            const c = await read(page, () => customers[0]);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(c.x).toBeLessThan(before - 50);
            expect(c.drinking).toBe(true);
        });

        test('serving scores points', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                serve();
            });
            await advance(page, 120);
            expect(await read(page, () => score)).toBeGreaterThanOrEqual(
                await read(page, () => SERVE_POINTS)
            );
        });

        test('a mug only reaches a patron on its own bar', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(1);
                customers[0].x = 300;
                bartender.lane = 0;
                serve();
            });
            // Stop short of frame 117, where the mug would run off the end of
            // its own empty bar and sweep the bars clean.
            await advance(page, 60);
            expect(await read(page, () => customers[0].drinking)).toBe(false);
        });

        test('a drinking patron stands still', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                customers[0].drinking = true;
                customers[0].drinkTimer = 5;
            });
            await advance(page, 60);
            expect(await read(page, () => customers[0].x)).toBeCloseTo(300, 3);
        });

        test('a finished drinker sends the empty mug back', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                customers[0].drinking = true;
                customers[0].drinkTimer = 0.1;
            });
            await advance(page, 12);
            const mug = await read(page, () => mugs[0]);
            expect(mug.dir).toBe(1);
            expect(mug.lane).toBe(0);
            expect(await read(page, () => customers[0].drinking)).toBe(false);
        });

        test('a patron shoved out of the door leaves satisfied', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = BAR_LEFT + 20;
                serve();
            });
            await advance(page, 300);
            expect(await read(page, () => customers.length)).toBe(0);
            expect(await read(page, () => satisfied)).toBe(1);
            expect(await read(page, () => score)).toBeGreaterThanOrEqual(
                await read(page, () => SERVE_POINTS + SATISFIED_POINTS)
            );
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs coming back
    // -----------------------------------------------------------------------
    test.describe('catching empties', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty caught in the right lane scores and costs no life', async ({ page }) => {
            await page.evaluate(() => {
                bartender.lane = 2;
                mugs.push({ lane: 2, x: CATCH_X - 60, dir: 1 });
            });
            await advance(page, 60);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => lives)).toBe(await read(page, () => START_LIVES));
            expect(await read(page, () => score)).toBe(await read(page, () => CATCH_POINTS));
        });

        test('an empty missed at the tap shatters and costs a life', async ({ page }) => {
            await page.evaluate(() => {
                bartender.lane = 0;
                mugs.push({ lane: 2, x: CATCH_X - 60, dir: 1 });
            });
            await advance(page, 60);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => lives)).toBe(await read(page, () => START_LIVES - 1));
        });
    });

    // -----------------------------------------------------------------------
    // Tips
    // -----------------------------------------------------------------------
    test.describe('tips', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a tip slides towards the tap', async ({ page }) => {
            await page.evaluate(() => spawnTip(0));
            const before = await read(page, () => tips[0].x);
            await advance(page, 20);
            expect(await read(page, () => tips[0].x)).toBeGreaterThan(before);
        });

        test('a tip caught in the right lane pays a bonus', async ({ page }) => {
            await page.evaluate(() => {
                bartender.lane = 1;
                spawnTip(1);
                tips[0].x = CATCH_X - 40;
            });
            await advance(page, 60);
            expect(await read(page, () => tips.length)).toBe(0);
            expect(await read(page, () => score)).toBe(await read(page, () => TIP_POINTS));
        });

        test('a missed tip costs nothing', async ({ page }) => {
            await page.evaluate(() => {
                bartender.lane = 3;
                spawnTip(1);
                tips[0].x = CATCH_X - 40;
            });
            await advance(page, 60);
            expect(await read(page, () => tips.length)).toBe(0);
            expect(await read(page, () => score)).toBe(0);
            expect(await read(page, () => lives)).toBe(await read(page, () => START_LIVES));
        });

        test('every TIP_EVERY-th satisfied patron leaves a tip', async ({ page }) => {
            const count = await page.evaluate(() => {
                for (let i = 0; i < TIP_EVERY; i++) {
                    spawnCustomer(0);
                    customers[0].x = BAR_LEFT + 10;
                    customers[0].drinking = true;
                    customers[0].drinkTimer = 0;
                    customers[0].x = BAR_LEFT - 5;
                    step(1 / 60);
                }
                return tips.length;
            });
            expect(count).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the level quota grows with the level', async ({ page }) => {
            const [q1, q2] = await page.evaluate(() => {
                const a = quotaFor(1);
                const b = quotaFor(2);
                return [a, b];
            });
            expect(q2).toBeGreaterThan(q1);
        });

        test('clearing the wave advances the level and pays a bonus', async ({ page }) => {
            await page.evaluate(() => {
                levelQuota = 1;
                spawnedCount = 1;
                satisfied = 1;
                score = 0;
            });
            await advance(page, 2);
            expect(await read(page, () => level)).toBe(2);
            expect(await read(page, () => score)).toBeGreaterThan(0);
            expect(await read(page, () => satisfied)).toBe(0);
        });

        test('the wave does not clear while patrons are still on the bars', async ({ page }) => {
            await page.evaluate(() => {
                levelQuota = 1;
                spawnedCount = 1;
                satisfied = 1;
                spawnCustomer(2);
            });
            await advance(page, 2);
            expect(await read(page, () => level)).toBe(1);
        });

        test('patrons walk faster at higher levels', async ({ page }) => {
            const [slow, fast] = await page.evaluate(() => [customerSpeed(1), customerSpeed(5)]);
            expect(fast).toBeGreaterThan(slow);
        });

        test('the door opens more often at higher levels', async ({ page }) => {
            const [slow, fast] = await page.evaluate(() => [spawnInterval(1), spawnInterval(5)]);
            expect(fast).toBeLessThan(slow);
        });
    });

    // -----------------------------------------------------------------------
    // Spawning
    // -----------------------------------------------------------------------
    test.describe('spawning', () => {
        test('patrons arrive over time once the game starts', async ({ page }) => {
            await page.evaluate(() => startGame());
            await advance(page, 60 * 5);
            expect(await read(page, () => customers.length)).toBeGreaterThan(0);
        });

        test('no more than MAX_PER_LANE patrons share a bar', async ({ page }) => {
            const worst = await page.evaluate(() => {
                startGame();
                levelQuota = 40;
                for (let i = 0; i < 60 * 40; i++) {
                    step(1 / 60);
                    customers.forEach((c) => { c.x = BAR_LEFT; });
                    if (state !== 'playing') break;
                }
                const per = [0, 0, 0, 0];
                customers.forEach((c) => { per[c.lane] += 1; });
                return Math.max(...per);
            });
            expect(worst).toBeLessThanOrEqual(await read(page, () => MAX_PER_LANE));
        });

        test('no more patrons arrive than the level quota', async ({ page }) => {
            const spawned = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 60 * 120; i++) {
                    step(1 / 60);
                    customers.forEach((c) => { c.x = BAR_LEFT; });
                    if (state !== 'playing') break;
                }
                return spawnedCount;
            });
            expect(spawned).toBeLessThanOrEqual(await read(page, () => levelQuota));
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                togglePause();
            });
            const before = await read(page, () => customers[0].x);
            await advance(page, 60);
            expect(await read(page, () => customers[0].x)).toBeCloseTo(before, 3);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'playing');
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                spawnCustomer(0);
                customers[0].x = GRAB_X - 1;
            });
            await advance(page, 30);
            expect(await read(page, () => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the overlay reports the final score', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                score = 1234;
                spawnCustomer(0);
                customers[0].x = GRAB_X - 1;
            });
            await advance(page, 30);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('a new best score is kept', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                score = 4321;
                spawnCustomer(0);
                customers[0].x = GRAB_X - 1;
            });
            await advance(page, 30);
            expect(await read(page, () => best)).toBe(4321);
            expect(await read(page, () => localStorage.getItem('tapper-best'))).toBe('4321');
            await expect(page.locator('#best')).toHaveText('4321');
        });

        test('stepping after game over changes nothing', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                spawnCustomer(0);
                customers[0].x = GRAB_X - 1;
            });
            await advance(page, 30);
            const scoreAfter = await read(page, () => score);
            await advance(page, 120);
            expect(await read(page, () => score)).toBe(scoreAfter);
        });

        test('Space starts a fresh game after game over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                spawnCustomer(0);
                customers[0].x = GRAB_X - 1;
            });
            await advance(page, 30);
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'playing');
            expect(await read(page, () => lives)).toBe(await read(page, () => START_LIVES));
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test('the HUD tracks score, lives and level', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 777;
                lives = 2;
                level = 3;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('777');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#level')).toHaveText('3');
        });

        test('the HUD shows progress towards the quota', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                satisfied = 2;
                levelQuota = 9;
                updateHud();
            });
            await expect(page.locator('#served')).toContainText('2');
            await expect(page.locator('#served')).toContainText('9');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0);
                serve();
                spawnTip(2);
                draw();
            });
            const blank = await page.evaluate(() => {
                const ctx = canvas.getContext('2d');
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] || data[i + 1] || data[i + 2]) return false;
                }
                return true;
            });
            expect(blank).toBe(false);
        });
    });
});
