const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with wave spawning switched off and the bar cleared, so the
// specs control exactly which customers and mugs exist.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
        customers.length = 0;
        mugs.length = 0;
    });

// Put a customer on `lane` at `x` and hand it back to the spec.
const addCustomer = (page, lane, x) =>
    page.evaluate(([l, px]) => spawnCustomer(l, px), [lane, x]);

// Move the bartender to `lane` without depending on key-event timing.
const setLane = (page, lane) => page.evaluate((l) => { bartender.lane = l; }, lane);

test.describe('Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // The specs own the clock: the animation loop keeps painting but stops
        // advancing the simulation, so `advance()` is the only source of time.
        // The loop's own stepping is covered by the 'animation loop' spec.
        await page.evaluate(() => { autoStep = false; });
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

        test('canvas is 640x460', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('there are four bars', async ({ page }) => {
            expect(await page.evaluate(() => LANE_COUNT)).toBe(4);
        });

        test('HUD shows starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('the bar is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('the bartender starts on the top bar', async ({ page }) => {
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-best', '3300'));
            await page.reload();
            await page.evaluate(() => { autoStep = false; });
            await expect(page.locator('#best')).toHaveText('3300');
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
        });

        test('starting resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => { score = 900; lives = 1; level = 5; });
            await startQuiet(page);
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('a fresh wave of customers is queued', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => remaining)).toBe(
                await page.evaluate(() => levelCustomers(1))
            );
        });
    });

    // -----------------------------------------------------------------------
    // Moving between bars
    // -----------------------------------------------------------------------
    test.describe('bartender movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowDown steps to the next bar down', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await expect.poll(() => page.evaluate(() => bartender.lane)).toBe(1);
        });

        test('ArrowUp steps back up', async ({ page }) => {
            await setLane(page, 2);
            await page.keyboard.press('ArrowUp');
            await expect.poll(() => page.evaluate(() => bartender.lane)).toBe(1);
        });

        test('w and s also move the bartender', async ({ page }) => {
            await page.keyboard.press('s');
            await expect.poll(() => page.evaluate(() => bartender.lane)).toBe(1);
            await page.keyboard.press('w');
            await expect.poll(() => page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('movement is clamped at the top bar', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('movement is clamped at the bottom bar', async ({ page }) => {
            for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
            await expect.poll(() => page.evaluate(() => bartender.lane)).toBe(3);
        });

        test('the bartender does not move while idle', async ({ page }) => {
            await page.evaluate(() => { state = 'idle'; });
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('pouring puts a full mug on the bartender\'s bar', async ({ page }) => {
            await setLane(page, 2);
            await page.evaluate(() => pour());
            const mug = await page.evaluate(() => mugs[0]);
            expect(mug).toBeTruthy();
            expect(mug.lane).toBe(2);
            expect(mug.full).toBe(true);
            expect(mug.x).toBeGreaterThan(await page.evaluate(() => TAP_X - 40));
        });

        test('Space pours while the game is running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect.poll(() => page.evaluate(() => mugs.length)).toBe(1);
        });

        test('a full mug slides towards the far end of the bar', async ({ page }) => {
            await page.evaluate(() => pour());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 12);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeLessThan(before);
        });

        test('the tap has a cooldown between pours', async ({ page }) => {
            await page.evaluate(() => { pour(); pour(); });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('the tap can be used again once the cooldown elapses', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 30);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('at most three full mugs share a bar', async ({ page }) => {
            await page.evaluate(() => {
                for (let i = 0; i < 8; i++) { pour(); bartender.pourCooldown = 0; }
            });
            expect(await page.evaluate(() => mugs.filter((m) => m.full).length)).toBe(3);
        });

        test('pouring is ignored while the game is not running', async ({ page }) => {
            await page.evaluate(() => { state = 'idle'; pour(); });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving customers
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a customer catches a full mug that reaches them', async ({ page }) => {
            await addCustomer(page, 0, 300);
            await page.evaluate(() => pour());
            await advance(page, 120);
            expect(await page.evaluate(() => mugs.filter((m) => m.full).length)).toBe(0);
            expect(await page.evaluate(() => customers[0].drinking)).toBe(true);
        });

        test('a drinking customer is pushed back down the bar', async ({ page }) => {
            await addCustomer(page, 0, 300);
            await page.evaluate(() => pour());
            await advance(page, 70);
            const x1 = await page.evaluate(() => customers[0].x);
            await advance(page, 20);
            const x2 = await page.evaluate(() => customers[0].x);
            expect(x2).toBeLessThan(x1);
        });

        test('a finished customer sends the empty mug back', async ({ page }) => {
            await addCustomer(page, 0, 300);
            await page.evaluate(() => pour());
            await advance(page, 180);
            const empties = await page.evaluate(() => mugs.filter((m) => !m.full).length);
            expect(empties).toBe(1);
        });

        test('the empty mug travels back towards the tap', async ({ page }) => {
            await addCustomer(page, 0, 300);
            await page.evaluate(() => pour());
            await advance(page, 180);
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 10);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeGreaterThan(before);
        });

        test('a customer pushed off the end of the bar is served and scores', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0, LEAVE_X + 30));
            await page.evaluate(() => pour());
            await advance(page, 400);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(100);
        });

        test('a customer that is not pushed far enough keeps coming', async ({ page }) => {
            await addCustomer(page, 0, 400);
            await page.evaluate(() => pour());
            await advance(page, 400);
            expect(await page.evaluate(() => customers.length)).toBe(1);
            expect(await page.evaluate(() => customers[0].drinking)).toBe(false);
            const x1 = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeGreaterThan(x1);
        });

        test('the mug is caught by the customer nearest the tap', async ({ page }) => {
            await addCustomer(page, 0, 200);
            await addCustomer(page, 0, 400);
            await page.evaluate(() => pour());
            await advance(page, 60);
            const drinking = await page.evaluate(() =>
                customers.filter((c) => c.drinking).map((c) => Math.round(c.x))
            );
            expect(drinking.length).toBe(1);
            expect(drinking[0]).toBeLessThanOrEqual(400);
            expect(drinking[0]).toBeGreaterThan(250);
        });

        test('a mug slides past a customer who is already drinking', async ({ page }) => {
            await addCustomer(page, 0, 420);
            await addCustomer(page, 0, 150);
            // Pour, run on until the near customer is mid-drink, then pour again.
            await page.evaluate(() => {
                pour();
                for (let i = 0; i < 600 && !customers[0].drinking; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => customers[0].drinking)).toBe(true);
            await page.evaluate(() => { bartender.pourCooldown = 0; pour(); });
            await advance(page, 180);
            const counts = await page.evaluate(() => customers.map((c) => c.drinkCount));
            expect(counts.length).toBe(2);
            expect(counts.every((n) => n > 0)).toBe(true);
        });

        test('mugs only interact with customers on the same bar', async ({ page }) => {
            await addCustomer(page, 1, 300);
            await setLane(page, 0);
            await page.evaluate(() => pour());
            await advance(page, 150);
            expect(await page.evaluate(() => customers[0].drinking)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Catching empties
    // -----------------------------------------------------------------------
    test.describe('catching empties', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty mug caught at the tap scores points', async ({ page }) => {
            await page.evaluate(() => { score = 0; mugs.push({ lane: 0, x: TAP_X - 40, full: false }); });
            await setLane(page, 0);
            await advance(page, 120);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(50);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an empty mug that reaches the tap on another bar smashes', async ({ page }) => {
            await page.evaluate(() => { mugs.push({ lane: 3, x: TAP_X - 40, full: false }); });
            await setLane(page, 0);
            await advance(page, 40);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });
    });

    // -----------------------------------------------------------------------
    // Losing a life
    // -----------------------------------------------------------------------
    test.describe('losing a life', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a full mug nobody catches smashes at the end of the bar', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 130);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('a customer who reaches the tap costs a life', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0, GRAB_X - 4));
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('the bar is cleared and play resumes after the pause', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0, GRAB_X - 4));
            await advance(page, 60);
            await advance(page, 200);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('nothing moves during the pause', async ({ page }) => {
            await page.evaluate(() => { mugs.push({ lane: 2, x: 300, full: true }); });
            await page.evaluate(() => spawnCustomer(0, GRAB_X - 4));
            await advance(page, 60);
            const x = await page.evaluate(() => mugs[0] && mugs[0].x);
            await advance(page, 10);
            expect(await page.evaluate(() => mugs[0] && mugs[0].x)).toBe(x);
        });

        test('the last life ends the game', async ({ page }) => {
            await page.evaluate(() => { lives = 1; pour(); });
            await advance(page, 300);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('the game can be restarted after game over', async ({ page }) => {
            await page.evaluate(() => { lives = 1; pour(); });
            await advance(page, 300);
            await page.keyboard.press('Space');
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Waves and levels
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('later levels queue more customers', async ({ page }) => {
            const [a, b] = await page.evaluate(() => [levelCustomers(1), levelCustomers(3)]);
            expect(b).toBeGreaterThan(a);
        });

        test('later levels send customers in faster', async ({ page }) => {
            const [a, b] = await page.evaluate(() => [customerSpeed(1), customerSpeed(4)]);
            expect(b).toBeGreaterThan(a);
        });

        test('customers arrive over time on valid bars', async ({ page }) => {
            await page.evaluate(() => startGame());
            await advance(page, 600);
            const lanes = await page.evaluate(() => customers.map((c) => c.lane));
            expect(lanes.length).toBeGreaterThan(0);
            for (const lane of lanes) {
                expect(lane).toBeGreaterThanOrEqual(0);
                expect(lane).toBeLessThan(4);
            }
        });

        test('spawning a customer reduces the queue', async ({ page }) => {
            await page.evaluate(() => startGame());
            const before = await page.evaluate(() => remaining);
            await advance(page, 600);
            expect(await page.evaluate(() => remaining)).toBeLessThan(before);
        });

        test('clearing the wave advances to the next level', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { remaining = 0; });
            await advance(page, 5);
            expect(await page.evaluate(() => state)).toBe('levelclear');
            await advance(page, 200);
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => remaining)).toBe(
                await page.evaluate(() => levelCustomers(2))
            );
        });

        test('clearing the wave awards a bonus', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { score = 0; remaining = 0; });
            await advance(page, 5);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await expect.poll(() => page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the simulation is frozen while paused', async ({ page }) => {
            await startQuiet(page);
            await addCustomer(page, 0, 300);
            await page.keyboard.press('p');
            await expect.poll(() => page.evaluate(() => state)).toBe('paused');
            const x = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(x);
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the score readout follows the score', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0, LEAVE_X + 30));
            await page.evaluate(() => pour());
            await advance(page, 400);
            await expect(page.locator('#score')).not.toHaveText('0');
        });

        test('the lives readout follows the lives', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 300);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the level readout follows the level', async ({ page }) => {
            await page.evaluate(() => { remaining = 0; });
            await advance(page, 205);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the queue readout follows the wave', async ({ page }) => {
            await page.evaluate(() => { remaining = 4; updateHud(); });
            await expect(page.locator('#left')).toHaveText('4');
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('a new best is stored on game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { score = 8800; lives = 1; pour(); });
            await advance(page, 300);
            await expect.poll(() => page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#best')).toHaveText('8800');
            expect(await page.evaluate(() => window.localStorage.getItem('tapper-best'))).toBe('8800');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-best', '9999'));
            await page.reload();
            await page.evaluate(() => { autoStep = false; });
            await startQuiet(page);
            await page.evaluate(() => { score = 10; lives = 1; pour(); });
            await advance(page, 300);
            await expect.poll(() => page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#best')).toHaveText('9999');
        });
    });

    // -----------------------------------------------------------------------
    // Animation loop
    // -----------------------------------------------------------------------
    test.describe('animation loop', () => {
        test('the game advances on its own once started', async ({ page }) => {
            await page.evaluate(() => {
                autoStep = true;
                startGame();
                spawnEnabled = false;
                customers.length = 0;
                mugs.length = 0;
                spawnCustomer(0, 200);
            });
            const x0 = await page.evaluate(() => customers[0].x);
            await page.waitForFunction((x) => customers[0].x > x, x0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted once a game starts', async ({ page }) => {
            await startQuiet(page);
            await addCustomer(page, 1, 300);
            await page.evaluate(() => { pour(); draw(); });
            const painted = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const first = [data[0], data[1], data[2]];
                for (let i = 4; i < data.length; i += 4) {
                    if (data[i] !== first[0] || data[i + 1] !== first[1] || data[i + 2] !== first[2]) {
                        return true;
                    }
                }
                return false;
            });
            expect(painted).toBe(true);
        });
    });
});
