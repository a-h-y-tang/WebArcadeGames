const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Soda Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Soda Tapper', async ({ page }) => {
            await expect(page).toHaveTitle('Soda Tapper');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the bar is empty before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                customers: customers.length,
                mugs: mugs.length,
                empties: empties.length,
            }));
            expect(counts).toEqual({ customers: 0, mugs: 0, empties: 0 });
        });

        test('there are four lanes with distinct y positions', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: LANE_COUNT }, (_, i) => laneY(i))
            );
            expect(ys.length).toBe(4);
            expect(new Set(ys).size).toBe(4);
            for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('soda-tapper-best', '742'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('742');
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

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('game starts on wave 1 with the starting lives and no score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { wave, lives, score, start: START_LIVES };
            });
            expect(s.wave).toBe(1);
            expect(s.lives).toBe(s.start);
            expect(s.score).toBe(0);
        });

        test('the bartender starts in a valid lane', async ({ page }) => {
            const lane = await page.evaluate(() => { startGame(); return player.lane; });
            expect(lane).toBeGreaterThanOrEqual(0);
            expect(lane).toBeLessThan(4);
        });

        test('starting clears the bar', async ({ page }) => {
            const counts = await page.evaluate(() => {
                spawnCustomer({ lane: 0, x: 200 });
                spawnMug({ lane: 1, x: 300 });
                spawnEmpty({ lane: 2, x: 300 });
                startGame();
                return { c: customers.length, m: mugs.length, e: empties.length };
            });
            expect(counts).toEqual({ c: 0, m: 0, e: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Bartender movement
    // -----------------------------------------------------------------------
    test.describe('bartender movement', () => {
        test('moving down increases the lane', async ({ page }) => {
            const lane = await page.evaluate(() => {
                startGame();
                setPlayerLane(0);
                movePlayer(1);
                return player.lane;
            });
            expect(lane).toBe(1);
        });

        test('moving up decreases the lane', async ({ page }) => {
            const lane = await page.evaluate(() => {
                startGame();
                setPlayerLane(2);
                movePlayer(-1);
                return player.lane;
            });
            expect(lane).toBe(1);
        });

        test('the bartender cannot move above the top lane', async ({ page }) => {
            const lane = await page.evaluate(() => {
                startGame();
                setPlayerLane(0);
                movePlayer(-1);
                movePlayer(-1);
                return player.lane;
            });
            expect(lane).toBe(0);
        });

        test('the bartender cannot move below the bottom lane', async ({ page }) => {
            const lane = await page.evaluate(() => {
                startGame();
                setPlayerLane(LANE_COUNT - 1);
                movePlayer(1);
                movePlayer(1);
                return player.lane;
            });
            expect(lane).toBe(3);
        });

        test('setPlayerLane clamps out-of-range lanes', async ({ page }) => {
            const lanes = await page.evaluate(() => {
                startGame();
                setPlayerLane(-5);
                const low = player.lane;
                setPlayerLane(99);
                return { low, high: player.lane };
            });
            expect(lanes.low).toBe(0);
            expect(lanes.high).toBe(3);
        });

        test('ArrowDown moves the bartender down a lane', async ({ page }) => {
            await page.evaluate(() => { startGame(); setPlayerLane(0); });
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('ArrowUp moves the bartender up a lane', async ({ page }) => {
            await page.evaluate(() => { startGame(); setPlayerLane(3); });
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test('pourMug puts a mug on the bartender lane at the tap', async ({ page }) => {
            const mug = await page.evaluate(() => {
                startGame();
                setPlayerLane(2);
                pourMug();
                return { count: mugs.length, lane: mugs[0].lane, x: mugs[0].x, bar: BAR_X };
            });
            expect(mug.count).toBe(1);
            expect(mug.lane).toBe(2);
            expect(mug.x).toBe(mug.bar);
        });

        test('mugs slide away from the tap', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                stopSpawning();
                pourMug();
                const before = mugs[0].x;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: mugs[0].x };
            });
            expect(after).toBeLessThan(before);
        });

        test('the tap has a cooldown between pours', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                stopSpawning();
                pourMug();
                pourMug();
                return mugs.length;
            });
            expect(count).toBe(1);
        });

        test('a second mug can be poured once the cooldown expires', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                stopSpawning();
                pourMug();
                for (let i = 0; i < 20; i++) step(0.016);
                pourMug();
                return mugs.length;
            });
            expect(count).toBe(2);
        });

        test('Space pours a mug while the game is running', async ({ page }) => {
            await page.evaluate(() => { startGame(); stopSpawning(); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('pouring does nothing when the game is not running', async ({ page }) => {
            const count = await page.evaluate(() => { pourMug(); return mugs.length; });
            expect(count).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test('spawnCustomer adds a customer in the requested lane', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                spawnCustomer({ lane: 3, x: 150 });
                return { count: customers.length, lane: customers[0].lane, x: customers[0].x };
            });
            expect(c.count).toBe(1);
            expect(c.lane).toBe(3);
            expect(c.x).toBe(150);
        });

        test('customers advance toward the tap', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnCustomer({ lane: 1, x: 150 });
                const before = customers[0].x;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: customers[0].x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('customers arrive automatically as time passes', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                for (let i = 0; i < 200; i++) step(0.016);
                return customers.length;
            });
            expect(count).toBeGreaterThan(0);
        });

        test('a customer reaching the tap costs a life and leaves', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnCustomer({ lane: 0, x: BAR_X - 2 });
                for (let i = 0; i < 60; i++) step(0.016);
                return { lives, customers: customers.length };
            });
            expect(r.lives).toBe(2);
            expect(r.customers).toBe(0);
        });

        test('customers never spawn outside the lanes', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) step(0.016);
                return customers.every((c) => c.lane >= 0 && c.lane < LANE_COUNT);
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('a mug reaching a customer is consumed', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnCustomer({ lane: 0, x: 300 });
                spawnMug({ lane: 0, x: 340 });
                for (let i = 0; i < 20; i++) step(0.016);
                return mugs.length;
            });
            expect(count).toBe(0);
        });

        test('a served customer is pushed back toward the door', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnCustomer({ lane: 0, x: 400 });
                const before = customers[0].x;
                spawnMug({ lane: 0, x: 440 });
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: customers[0].x };
            });
            expect(after).toBeLessThan(before);
        });

        test('a hit leaves an empty mug travelling back toward the tap', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnCustomer({ lane: 2, x: 300 });
                spawnMug({ lane: 2, x: 340 });
                for (let i = 0; i < 20; i++) step(0.016);
                const first = empties[0].x;
                for (let i = 0; i < 10; i++) step(0.016);
                return { count: empties.length, lane: empties[0].lane, first, later: empties[0].x };
            });
            expect(r.count).toBe(1);
            expect(r.lane).toBe(2);
            expect(r.later).toBeGreaterThan(r.first);
        });

        test('pushing a customer out of the door serves them and scores', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnCustomer({ lane: 0, x: LANE_LEFT });
                spawnMug({ lane: 0, x: LANE_LEFT + 40 });
                for (let i = 0; i < 20; i++) step(0.016);
                return { customers: customers.length, score, served: servedThisWave };
            });
            expect(r.customers).toBe(0);
            expect(r.served).toBe(1);
            expect(r.score).toBeGreaterThan(0);
        });

        test('a customer far from the door needs more than one mug', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnCustomer({ lane: 0, x: BAR_X - 40 });
                spawnMug({ lane: 0, x: BAR_X - 10 });
                for (let i = 0; i < 20; i++) step(0.016);
                return { customers: customers.length, served: servedThisWave };
            });
            expect(r.customers).toBe(1);
            expect(r.served).toBe(0);
        });

        test('a mug does not reach customers in other lanes', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnCustomer({ lane: 3, x: 300 });
                spawnMug({ lane: 0, x: 340 });
                for (let i = 0; i < 20; i++) step(0.016);
                return { customers: customers.length, x: customers[0].x, mugs: mugs.length };
            });
            expect(r.customers).toBe(1);
            expect(r.x).toBeGreaterThanOrEqual(300);
            expect(r.mugs).toBe(1);
        });

        test('a mug hits the customer nearest the tap first', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnCustomer({ lane: 1, x: 200 });
                spawnCustomer({ lane: 1, x: 400 });
                spawnMug({ lane: 1, x: 440 });
                for (let i = 0; i < 20; i++) step(0.016);
                return { back: customers[0].x, front: customers[1].x };
            });
            // Only the customer closest to the tap (the one that started at 400)
            // is pushed back; the one further down the bar keeps walking.
            expect(r.front).toBeLessThan(300);
            expect(r.back).toBeGreaterThanOrEqual(200);
            expect(r.back).toBeLessThan(230);
        });

        test('a mug that slides off the end of the bar costs a life', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnMug({ lane: 0, x: LANE_LEFT + 20 });
                for (let i = 0; i < 30; i++) step(0.016);
                return { lives, mugs: mugs.length };
            });
            expect(r.lives).toBe(2);
            expect(r.mugs).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test('an empty reaching the tap in the bartender lane is caught and scores', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                stopSpawning();
                setPlayerLane(1);
                spawnEmpty({ lane: 1, x: BAR_X - 20 });
                for (let i = 0; i < 30; i++) step(0.016);
                return { empties: empties.length, lives, score };
            });
            expect(r.empties).toBe(0);
            expect(r.lives).toBe(3);
            expect(r.score).toBeGreaterThan(0);
        });

        test('an empty reaching the tap in another lane costs a life', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                stopSpawning();
                setPlayerLane(0);
                spawnEmpty({ lane: 3, x: BAR_X - 20 });
                for (let i = 0; i < 30; i++) step(0.016);
                return { empties: empties.length, lives };
            });
            expect(r.empties).toBe(0);
            expect(r.lives).toBe(2);
        });

        test('an empty still short of the tap is not caught yet', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                stopSpawning();
                setPlayerLane(1);
                spawnEmpty({ lane: 1, x: 100 });
                for (let i = 0; i < 5; i++) step(0.016);
                return empties.length;
            });
            expect(count).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        // Plays out one complete wave: every customer is spawned at the door and
        // immediately served by a mug placed just up-bar of them.
        const runWave = (opts) => {
            startGame();
            if (opts.maxLives) lives = MAX_LIVES;
            stopSpawning();
            setPlayerLane(0);
            for (let n = 0; n < CUSTOMERS_PER_WAVE; n++) {
                customers.length = 0;
                mugs.length = 0;
                empties.length = 0;
                spawnCustomer({ lane: 0, x: LANE_LEFT });
                spawnMug({ lane: 0, x: LANE_LEFT + 40 });
                for (let i = 0; i < 20; i++) step(0.016);
            }
            return {
                wave, served: servedThisWave, lives, score,
                max: MAX_LIVES, start: START_LIVES,
                c: customers.length, m: mugs.length, e: empties.length,
            };
        };

        test('serving a full round of customers advances the wave', async ({ page }) => {
            const r = await page.evaluate(runWave, {});
            expect(r.wave).toBe(2);
            expect(r.served).toBe(0);
            expect(r.score).toBeGreaterThan(0);
        });

        test('a new wave clears the bar', async ({ page }) => {
            const r = await page.evaluate(runWave, {});
            expect({ c: r.c, m: r.m, e: r.e }).toEqual({ c: 0, m: 0, e: 0 });
        });

        test('clearing a wave awards a bonus life up to the cap', async ({ page }) => {
            const r = await page.evaluate(runWave, {});
            expect(r.lives).toBe(r.start + 1);
        });

        test('lives never exceed the maximum', async ({ page }) => {
            const r = await page.evaluate(runWave, { maxLives: true });
            expect(r.lives).toBe(r.max);
        });

        test('a wave still ends when a customer slips through to the tap', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                stopSpawning();
                setPlayerLane(0);
                for (let n = 0; n < CUSTOMERS_PER_WAVE - 1; n++) {
                    customers.length = 0;
                    mugs.length = 0;
                    empties.length = 0;
                    spawnCustomer({ lane: 0, x: LANE_LEFT });
                    spawnMug({ lane: 0, x: LANE_LEFT + 40 });
                    for (let i = 0; i < 20; i++) step(0.016);
                }
                // The last customer of the wave walks straight through to the tap.
                customers.length = 0;
                mugs.length = 0;
                empties.length = 0;
                spawnCustomer({ lane: 0, x: BAR_X - 2 });
                for (let i = 0; i < 60; i++) step(0.016);
                return { wave, state, customers: customers.length };
            });
            expect(r.wave).toBe(2);
            expect(r.state).toBe('running');
            expect(r.customers).toBe(0);
        });

        test('customers walk faster in later waves', async ({ page }) => {
            const { slow, fast } = await page.evaluate(() => {
                startGame();
                stopSpawning();
                wave = 1;
                const slow = customerSpeed();
                wave = 6;
                const fast = customerSpeed();
                return { slow, fast };
            });
            expect(fast).toBeGreaterThan(slow);
        });

        test('customers arrive more often in later waves', async ({ page }) => {
            const { early, late } = await page.evaluate(() => {
                startGame();
                wave = 1;
                const early = spawnInterval();
                wave = 8;
                const late = spawnInterval();
                return { early, late };
            });
            expect(late).toBeLessThan(early);
        });

        test('serving is worth more in later waves', async ({ page }) => {
            const { w1, w4 } = await page.evaluate(() => {
                startGame();
                wave = 1;
                const w1 = pointsPerServe();
                wave = 4;
                return { w1, w4: pointsPerServe() };
            });
            expect(w4).toBeGreaterThan(w1);
        });
    });

    // -----------------------------------------------------------------------
    // Lives & game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test('losing a life clears the mugs on the bar', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnMug({ lane: 1, x: 400 });
                spawnEmpty({ lane: 2, x: 200 });
                loseLife();
                return { m: mugs.length, e: empties.length, lives };
            });
            expect(r).toEqual({ m: 0, e: 0, lives: 2 });
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                loseLife();
                return { state, lives };
            });
            expect(s.state).toBe('over');
            expect(s.lives).toBe(0);
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('the simulation stops once the game is over', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnCustomer({ lane: 0, x: 200 });
                endGame();
                const before = customers[0].x;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: customers[0].x };
            });
            expect(after).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 654;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('654');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 222;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('soda-tapper-best'));
            expect(parseInt(stored, 10)).toBe(222);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('soda-tapper-best', '9000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 10;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('the HUD reflects wave and lives', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                wave = 7;
                lives = 2;
                updateHud();
            });
            await expect(page.locator('#wave')).toHaveText('7');
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the customers', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnCustomer({ lane: 0, x: 200 });
                togglePause();
                const before = customers[0].x;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: customers[0].x };
            });
            expect(after).toBe(before);
        });

        test('resuming lets the customers walk again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                stopSpawning();
                spawnCustomer({ lane: 0, x: 200 });
                togglePause();
                togglePause();
                const before = customers[0].x;
                for (let i = 0; i < 60; i++) step(0.016);
                return customers[0].x > before;
            });
            expect(moved).toBe(true);
        });

        test('P toggles pause', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('restart after game over resets score, wave, lives and the bar', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 999;
                wave = 5;
                lives = 1;
                spawnCustomer({ lane: 0, x: 300 });
                endGame();
                startGame();
                return { score, wave, lives, customers: customers.length, state };
            });
            expect(r.score).toBe(0);
            expect(r.wave).toBe(1);
            expect(r.lives).toBe(3);
            expect(r.customers).toBe(0);
            expect(r.state).toBe('running');
        });
    });
});
