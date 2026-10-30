const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a level and freeze the animation loop, so a test can arrange the
// counters itself and advance the simulation one fixed step at a time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
    });
}

// Replace everything in play with exactly what a test cares about.
async function setBoard(page, board) {
    await page.evaluate((b) => {
        customers.length = 0;
        mugs.length = 0;
        empties.length = 0;
        spawnQueue.length = 0;
        (b.customers || []).forEach((c) =>
            customers.push({
                lane: c.lane,
                x: c.x,
                drinking: !!c.drinking,
                drinkTimer: c.drinkTimer || 0,
            })
        );
        (b.mugs || []).forEach((m) => mugs.push({ lane: m.lane, x: m.x }));
        (b.empties || []).forEach((m) => empties.push({ lane: m.lane, x: m.x }));
        (b.queue || [{ lane: 0, t: 1e6 }]).forEach((q) => spawnQueue.push({ lane: q.lane, t: q.t }));
        if (b.lane !== undefined) server.lane = b.lane;
        levelTime = b.levelTime || 0;
        server.pourCooldown = 0;
    }, board);
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(DT);
    }, steps);
}

// Advance the frozen simulation by roughly `seconds` of game time.
async function advance(page, seconds) {
    await page.evaluate((s) => {
        const n = Math.round(s / DT);
        for (let i = 0; i < n; i++) physicsStep(DT);
    }, seconds);
}

const read = (page, expr) => page.evaluate(expr);

test.describe('Soda Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Soda Tapper', async ({ page }) => {
            await expect(page).toHaveTitle(/Soda Tapper/i);
        });

        test('the canvas is present and sized', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toBeVisible();
            expect(await canvas.getAttribute('width')).toBe('640');
            expect(await canvas.getAttribute('height')).toBe('480');
        });

        test('the start overlay is visible with a start button', async ({ page }) => {
            await expect(page.locator('#overlay')).toBeVisible();
            await expect(page.locator('#btn-start')).toBeVisible();
        });

        test('the game waits in the idle state', async ({ page }) => {
            expect(await read(page, () => state)).toBe('idle');
        });

        test('the HUD starts at zero score, level 1 and three lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#served')).toHaveText('0');
        });

        test('nothing is in play before the game starts', async ({ page }) => {
            const counts = await read(page, () => [customers.length, mugs.length, empties.length]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('the server starts on the top counter', async ({ page }) => {
            expect(await read(page, () => server.lane)).toBe(0);
        });

        test('there are four counters', async ({ page }) => {
            expect(await read(page, () => LANE_Y.length)).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('the start button begins a game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await read(page, () => state)).toBe('running');
            await expect(page.locator('#overlay')).toBeHidden();
        });

        test('Space begins a game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await read(page, () => state)).toBe('running');
        });

        test('starting fills a spawn queue for the level', async ({ page }) => {
            await startFrozen(page);
            expect(await read(page, () => spawnQueue.length)).toBeGreaterThan(0);
        });

        test('starting resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                level = 4;
                served = 7;
            });
            await startFrozen(page);
            expect(await read(page, () => [score, lives, level, served])).toEqual([0, 3, 1, 0]);
        });

        test('customers arrive from the queue as time passes', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { queue: [{ lane: 2, t: 0.5 }] });
            expect(await read(page, () => customers.length)).toBe(0);
            await advance(page, 0.6);
            expect(await read(page, () => customers.length)).toBe(1);
            expect(await read(page, () => customers[0].lane)).toBe(2);
        });

        test('a spawned customer enters at the far end of the counter', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { queue: [{ lane: 1, t: 0 }] });
            await step(page, 1);
            expect(await read(page, () => customers[0].x - LANE_LEFT)).toBeCloseTo(0, 0);
        });

        test('the queue only releases customers whose time has come', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                queue: [
                    { lane: 0, t: 0.1 },
                    { lane: 1, t: 5 },
                ],
            });
            await advance(page, 0.2);
            expect(await read(page, () => customers.length)).toBe(1);
            expect(await read(page, () => spawnQueue.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between counters
    // -----------------------------------------------------------------------
    test.describe('server movement', () => {
        test('ArrowDown moves down one counter', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('ArrowDown');
            expect(await read(page, () => server.lane)).toBe(1);
        });

        test('ArrowUp moves back up one counter', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowUp');
            expect(await read(page, () => server.lane)).toBe(1);
        });

        test('W and S also move between counters', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyS');
            expect(await read(page, () => server.lane)).toBe(1);
            await page.keyboard.press('KeyW');
            expect(await read(page, () => server.lane)).toBe(0);
        });

        test('the server cannot move above the top counter', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('ArrowUp');
            expect(await read(page, () => server.lane)).toBe(0);
        });

        test('the server cannot move below the bottom counter', async ({ page }) => {
            await startFrozen(page);
            for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
            const lanes = await read(page, () => LANE_Y.length);
            expect(await read(page, () => server.lane)).toBe(lanes - 1);
        });

        test('a keypress moves exactly one counter', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('ArrowDown');
            await advance(page, 1);
            expect(await read(page, () => server.lane)).toBe(1);
        });

        test('the counters cannot be changed while idle', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect(await read(page, () => server.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring mugs
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test('Space slides a mug down the server\'s counter', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { lane: 2 });
            await page.keyboard.press('Space');
            const inFlight = await read(page, () => mugs.map((m) => ({ lane: m.lane, x: m.x })));
            expect(inFlight).toHaveLength(1);
            expect(inFlight[0].lane).toBe(2);
            expect(inFlight[0].x).toBeCloseTo(await read(page, () => LANE_RIGHT), 0);
        });

        test('a mug starts at the taps end of the counter', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => pour());
            expect(await read(page, () => mugs[0].x - LANE_RIGHT)).toBeCloseTo(0, 0);
        });

        test('the pour cooldown stops a second mug immediately', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                pour();
                pour();
            });
            expect(await read(page, () => mugs.length)).toBe(1);
        });

        test('a mug can be poured again once the cooldown expires', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => pour());
            await advance(page, await read(page, () => POUR_COOLDOWN) + 0.05);
            await page.evaluate(() => pour());
            expect(await read(page, () => mugs.length)).toBe(2);
        });

        test('pouring does nothing while idle', async ({ page }) => {
            await page.evaluate(() => pour());
            expect(await read(page, () => mugs.length)).toBe(0);
        });

        test('clicking a counter moves the server there and pours', async ({ page }) => {
            await startFrozen(page);
            const box = await page.locator('#canvas').boundingBox();
            const laneY = await read(page, () => LANE_Y[3]);
            await page.mouse.click(box.x + box.width * (400 / 640), box.y + box.height * (laneY / 480));
            expect(await read(page, () => server.lane)).toBe(3);
            expect(await read(page, () => mugs.length)).toBe(1);
            expect(await read(page, () => mugs[0].lane)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Mug travel
    // -----------------------------------------------------------------------
    test.describe('mug travel', () => {
        test('a full mug slides toward the far end', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { mugs: [{ lane: 0, x: 400 }] });
            await advance(page, 0.5);
            const x = await read(page, () => mugs[0].x);
            expect(x).toBeLessThan(400);
            expect(x).toBeCloseTo(400 - 250 * 0.5, 0);
        });

        test('a mug that reaches the far end smashes', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { mugs: [{ lane: 0, x: 80 }] });
            await advance(page, 0.5);
            expect(await read(page, () => mugs.length)).toBe(0);
        });

        test('a smashed mug costs a life', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { mugs: [{ lane: 0, x: 90 }] });
            await advance(page, 0.5);
            expect(await read(page, () => lives)).toBe(2);
        });

        test('a mug slides past a customer who is drinking', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [{ lane: 0, x: 300, drinking: true, drinkTimer: 5 }],
                mugs: [{ lane: 0, x: 360 }],
            });
            await advance(page, 0.3);
            expect(await read(page, () => mugs.length)).toBe(1);
            expect(await read(page, () => mugs[0].x)).toBeLessThan(300);
            expect(await read(page, () => customers[0].x)).toBe(300);
        });

        test('a mug ignores customers on other counters', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [{ lane: 1, x: 300 }],
                mugs: [{ lane: 0, x: 360 }],
            });
            await advance(page, 0.3);
            expect(await read(page, () => mugs.length)).toBe(1);
            expect(await read(page, () => score)).toBe(0);
        });

        test('several mugs can be in flight on different counters', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                mugs: [
                    { lane: 0, x: 500 },
                    { lane: 1, x: 500 },
                    { lane: 3, x: 500 },
                ],
            });
            await advance(page, 0.2);
            expect(await read(page, () => mugs.length)).toBe(3);
            expect(await read(page, () => new Set(mugs.map((m) => m.lane)).size)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving a customer', () => {
        test('a mug reaching a customer is caught', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [{ lane: 0, x: 300 }],
                mugs: [{ lane: 0, x: 340 }],
            });
            await advance(page, 0.3);
            expect(await read(page, () => mugs.length)).toBe(0);
        });

        test('serving scores points', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [{ lane: 0, x: 300 }],
                mugs: [{ lane: 0, x: 340 }],
            });
            await advance(page, 0.3);
            expect(await read(page, () => score)).toBe(50);
        });

        test('serving pushes the customer back toward the entrance', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [{ lane: 0, x: 400 }],
                mugs: [{ lane: 0, x: 440 }],
            });
            await advance(page, 0.3);
            expect(await read(page, () => customers[0].x)).toBeCloseTo(400 - 130, -1);
        });

        test('a served customer starts drinking and stops walking', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [{ lane: 0, x: 400 }],
                mugs: [{ lane: 0, x: 440 }],
            });
            await advance(page, 0.3);
            expect(await read(page, () => customers[0].drinking)).toBe(true);
            const x = await read(page, () => customers[0].x);
            await advance(page, 0.2);
            expect(await read(page, () => customers[0].x)).toBe(x);
        });

        test('the customer nearest the taps gets the mug', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [
                    { lane: 0, x: 200 },
                    { lane: 0, x: 400 },
                ],
                mugs: [{ lane: 0, x: 440 }],
            });
            await advance(page, 0.3);
            const drinkers = await read(page, () => customers.filter((c) => c.drinking).map((c) => c.x));
            expect(drinkers).toHaveLength(1);
            expect(drinkers[0]).toBeCloseTo(400 - 130, -1);
        });

        test('one mug serves only one customer', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [
                    { lane: 0, x: 380 },
                    { lane: 0, x: 400 },
                ],
                mugs: [{ lane: 0, x: 440 }],
            });
            await advance(page, 0.3);
            expect(await read(page, () => customers.filter((c) => c.drinking).length)).toBe(1);
            expect(await read(page, () => score)).toBe(50);
        });
    });

    // -----------------------------------------------------------------------
    // Drinking and empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test('a customer sends an empty mug back when the drink is done', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [{ lane: 2, x: 300, drinking: true, drinkTimer: 0.2 }],
            });
            expect(await read(page, () => empties.length)).toBe(0);
            await advance(page, 0.3);
            expect(await read(page, () => empties.length)).toBe(1);
            expect(await read(page, () => empties[0].lane)).toBe(2);
        });

        test('the customer resumes walking after drinking', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [{ lane: 0, x: 300, drinking: true, drinkTimer: 0.1 }],
            });
            await advance(page, 0.6);
            expect(await read(page, () => customers[0].drinking)).toBe(false);
            expect(await read(page, () => customers[0].x)).toBeGreaterThan(300);
        });

        test('an empty mug travels toward the taps', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { empties: [{ lane: 0, x: 200 }] });
            await advance(page, 0.5);
            expect(await read(page, () => empties[0].x)).toBeCloseTo(200 + 190 * 0.5, 0);
        });

        test('an empty mug is caught when the server is on that counter', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { lane: 1, empties: [{ lane: 1, x: 540 }] });
            await advance(page, 0.5);
            expect(await read(page, () => empties.length)).toBe(0);
            expect(await read(page, () => lives)).toBe(3);
            expect(await read(page, () => score)).toBe(25);
        });

        test('an empty mug smashes when the server is elsewhere', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { lane: 0, empties: [{ lane: 3, x: 540 }] });
            await advance(page, 0.5);
            expect(await read(page, () => empties.length)).toBe(0);
            expect(await read(page, () => lives)).toBe(2);
            expect(await read(page, () => score)).toBe(0);
        });

        test('moving to the right counter in time saves the mug', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { lane: 0, empties: [{ lane: 2, x: 400 }] });
            await advance(page, 0.2);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await advance(page, 1.2);
            expect(await read(page, () => lives)).toBe(3);
            expect(await read(page, () => score)).toBe(25);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test('a customer walks toward the taps', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { customers: [{ lane: 0, x: 200 }] });
            await advance(page, 1);
            const x = await read(page, () => customers[0].x);
            expect(x).toBeGreaterThan(200);
            expect(x).toBeCloseTo(220, 0);
        });

        test('customers walk faster on later levels', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { customers: [{ lane: 0, x: 200 }] });
            await advance(page, 1);
            const slow = (await read(page, () => customers[0].x)) - 200;
            await page.evaluate(() => {
                level = 5;
            });
            await setBoard(page, { customers: [{ lane: 0, x: 200 }] });
            await advance(page, 1);
            const fast = (await read(page, () => customers[0].x)) - 200;
            expect(fast).toBeGreaterThan(slow);
        });

        test('a customer reaching the taps costs a life', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { customers: [{ lane: 0, x: 550 }] });
            await advance(page, 1.5);
            expect(await read(page, () => lives)).toBe(2);
            expect(await read(page, () => customers.length)).toBe(0);
        });

        test('a customer pushed past the entrance leaves happy', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [{ lane: 0, x: 120 }],
                mugs: [{ lane: 0, x: 160 }],
            });
            await advance(page, 1.5);
            expect(await read(page, () => customers.length)).toBe(0);
            expect(await read(page, () => served)).toBe(1);
            expect(await read(page, () => score)).toBe(50 + 150);
        });

        test('a happy customer still sends the empty mug back', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [{ lane: 0, x: 120 }],
                mugs: [{ lane: 0, x: 160 }],
            });
            await advance(page, 1.5);
            expect(await read(page, () => empties.length)).toBe(1);
        });

        test('a customer served mid-counter needs more than one mug', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [{ lane: 0, x: 480 }],
                mugs: [{ lane: 0, x: 520 }],
            });
            await advance(page, 1.3);
            expect(await read(page, () => customers.length)).toBe(1);
            expect(await read(page, () => served)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Level flow
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing every customer ends the level', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { queue: [] });
            await step(page, 1);
            expect(await read(page, () => state)).toBe('levelclear');
        });

        test('clearing a level scores a bonus', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { queue: [] });
            await step(page, 1);
            expect(await read(page, () => score)).toBe(300);
        });

        test('the level is not clear while a mug is still in flight', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { queue: [], mugs: [{ lane: 0, x: 400 }] });
            await step(page, 1);
            expect(await read(page, () => state)).toBe('running');
        });

        test('the level is not clear while customers remain queued', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { queue: [{ lane: 0, t: 9 }] });
            await step(page, 1);
            expect(await read(page, () => state)).toBe('running');
        });

        test('Space starts the next level', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { queue: [] });
            await step(page, 1);
            await page.keyboard.press('Space');
            expect(await read(page, () => state)).toBe('running');
            expect(await read(page, () => level)).toBe(2);
        });

        test('the next level keeps the score and lives', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 2;
            });
            await setBoard(page, { queue: [] });
            await step(page, 1);
            await page.keyboard.press('Space');
            expect(await read(page, () => [score, lives])).toEqual([300, 2]);
        });

        test('the next level queues more customers than the first', async ({ page }) => {
            const first = await page.evaluate(() => buildLevel(1).length);
            const fifth = await page.evaluate(() => buildLevel(5).length);
            expect(fifth).toBeGreaterThan(first);
        });

        test('a level always builds the same wave', async ({ page }) => {
            const [a, b] = await page.evaluate(() => [
                JSON.stringify(buildLevel(3)),
                JSON.stringify(buildLevel(3)),
            ]);
            expect(a).toBe(b);
        });

        test('every queued customer is on a real counter at a sane time', async ({ page }) => {
            const ok = await page.evaluate(() =>
                [1, 2, 3, 7].every((n) =>
                    buildLevel(n).every(
                        (q, i, all) =>
                            q.lane >= 0 &&
                            q.lane < LANE_Y.length &&
                            q.t >= 0 &&
                            (i === 0 || q.t >= all[i - 1].t)
                    )
                )
            );
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Losing
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('running out of lives ends the game', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 1;
            });
            await setBoard(page, { lane: 0, empties: [{ lane: 3, x: 550 }] });
            await advance(page, 0.5);
            expect(await read(page, () => lives)).toBe(0);
            expect(await read(page, () => state)).toBe('gameover');
        });

        test('the overlay returns on game over', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 1;
            });
            await setBoard(page, { lane: 0, empties: [{ lane: 3, x: 550 }] });
            await advance(page, 0.5);
            await expect(page.locator('#overlay')).toBeVisible();
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the simulation stops after game over', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 1;
            });
            await setBoard(page, { lane: 0, empties: [{ lane: 3, x: 550 }], customers: [{ lane: 0, x: 200 }] });
            await advance(page, 0.5);
            const x = await read(page, () => customers[0].x);
            await advance(page, 1);
            expect(await read(page, () => customers[0].x)).toBe(x);
        });

        test('the best score is remembered', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 1;
                score = 1234;
            });
            await setBoard(page, { lane: 0, empties: [{ lane: 3, x: 550 }] });
            await advance(page, 0.5);
            expect(await page.evaluate(() => localStorage.getItem('sodatapper-best'))).toBe('1234');
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('a game can be restarted after game over', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 1;
            });
            await setBoard(page, { lane: 0, empties: [{ lane: 3, x: 550 }] });
            await advance(page, 0.5);
            await page.keyboard.press('Space');
            expect(await read(page, () => state)).toBe('running');
            expect(await read(page, () => [score, lives, level])).toEqual([0, 3, 1]);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses a running game', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            expect(await read(page, () => state)).toBe('paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            expect(await read(page, () => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { customers: [{ lane: 0, x: 200 }] });
            await page.keyboard.press('KeyP');
            await advance(page, 1);
            expect(await read(page, () => customers[0].x)).toBe(200);
        });

        test('pausing does not start an idle game', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await read(page, () => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test('the score readout tracks the score', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [{ lane: 0, x: 300 }],
                mugs: [{ lane: 0, x: 340 }],
            });
            await advance(page, 0.3);
            await expect(page.locator('#score')).toHaveText('50');
        });

        test('the lives readout tracks lost lives', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { mugs: [{ lane: 0, x: 90 }] });
            await advance(page, 0.3);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the level readout tracks the level', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, { queue: [] });
            await step(page, 1);
            await page.keyboard.press('Space');
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the served readout counts happy customers', async ({ page }) => {
            await startFrozen(page);
            await setBoard(page, {
                customers: [{ lane: 0, x: 120 }],
                mugs: [{ lane: 0, x: 160 }],
            });
            await advance(page, 1.5);
            await expect(page.locator('#served')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Robustness
    // -----------------------------------------------------------------------
    test.describe('robustness', () => {
        test('a long unattended game raises no errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => startGame());
            await page.waitForTimeout(1500);
            expect(errors).toEqual([]);
        });

        test('rendering every phase of the game raises no errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await startFrozen(page);
            await setBoard(page, {
                customers: [
                    { lane: 0, x: 200 },
                    { lane: 1, x: 300, drinking: true, drinkTimer: 1 },
                ],
                mugs: [{ lane: 2, x: 400 }],
                empties: [{ lane: 3, x: 300 }],
            });
            await page.evaluate(() => {
                render();
                state = 'paused';
                render();
                state = 'gameover';
                render();
                state = 'levelclear';
                render();
            });
            expect(errors).toEqual([]);
        });

        test('nothing in play ever leaves its counter', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.waitForTimeout(1200);
            const stray = await page.evaluate(() => {
                const all = [...mugs, ...empties, ...customers];
                return all.find((o) => o.x < LANE_LEFT - 40 || o.x > LANE_RIGHT + 40) || null;
            });
            expect(stray).toBeNull();
        });

        test('keys pressed before the game starts do not break it', async ({ page }) => {
            for (const key of ['ArrowDown', 'Space', 'KeyP', 'ArrowUp', 'KeyW']) {
                await page.keyboard.press(key);
            }
            await page.keyboard.press('Space');
            expect(await read(page, () => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Game browser integration
    // -----------------------------------------------------------------------
    test.describe('game browser integration', () => {
        test('games.json lists Soda Tapper', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'soda-tapper');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Soda Tapper');
            expect(entry.dir).toBe('SodaTapper');
            expect(entry.path).toBe('games/SodaTapper/index.html');
            expect(entry.thumbnail).toBe('games/SodaTapper/screenshot.png');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const i = games.findIndex((g) => g.id === 'soda-tapper');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            if (i + 1 < games.length) {
                expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
            }
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaTapper/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(
                /\|\s*Soda Tapper\s*\|\s*\[SodaTapper\/\]\(SodaTapper\/\)\s*\|\s*(Complete|In Progress)\s*\|/
            );
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaTapper/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaTapper/DESIGN.md'))).toBe(true);
        });
    });
});
