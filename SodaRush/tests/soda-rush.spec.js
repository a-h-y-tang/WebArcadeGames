const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Most specs are about one subsystem, so they start a game with customer
// spawning switched off and place entities explicitly. Specs that are about
// spawning turn the switch back on.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
        customers.length = 0;
        sodas.length = 0;
        mugs.length = 0;
    });

// Chromium can acknowledge a synthetic key event before the page's listener
// has run, so key presses are confirmed against the game state before the
// simulation is advanced.
// Drop a soda already touching a customer's right side, so the hit lands on
// the very next step and no travel time has to be simulated.
const sodaTouching = (page, lane, x) =>
    page.evaluate(([l, cx]) => {
        sodas.push({ lane: l, x: cx + CUSTOMER_W / 2 + SODA_W / 2 + 2 });
    }, [lane, x]);

const pressLane = async (page, key, wantLane) => {
    await page.keyboard.press(key);
    await page.waitForFunction((l) => server.lane === l, wantLane);
};

test.describe('Soda Rush', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Soda Rush', async ({ page }) => {
            await expect(page).toHaveTitle('Soda Rush');
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, lives, wave and customers left', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#remaining')).toHaveText(
                String(await page.evaluate(() => quotaFor(1)))
            );
        });

        test('counter is empty before starting', async ({ page }) => {
            const counts = await page.evaluate(() => [customers.length, sodas.length, mugs.length]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('there are four lanes and they are evenly spaced on the canvas', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: LANE_COUNT }, (_, i) => laneY(i))
            );
            expect(ys).toHaveLength(4);
            expect(ys[0]).toBeGreaterThan(0);
            expect(ys[3]).toBeLessThan(480);
            const gaps = [ys[1] - ys[0], ys[2] - ys[1], ys[3] - ys[2]];
            expect(new Set(gaps).size).toBe(1);
            expect(gaps[0]).toBeGreaterThan(0);
        });

        test('the server starts at the top lane', async ({ page }) => {
            expect(await page.evaluate(() => server.lane)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('soda-rush-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('step does nothing while idle', async ({ page }) => {
            await advance(page, 120);
            const snap = await page.evaluate(() => [state, customers.length, score]);
            expect(snap).toEqual(['idle', 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Starting and restarting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('the Start button starts the game and hides the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Space starts the game from the idle screen', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
        });

        test('starting resets score, lives and wave', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                level = 5;
                served = 4;
                startGame();
            });
            const snap = await page.evaluate(() => [score, lives, level, served]);
            expect(snap).toEqual([0, 3, 1, 0]);
        });

        test('starting clears the counter', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                customers.push({ lane: 0, x: 300, state: 'walking', timer: 0, drinks: 0 });
                sodas.push({ lane: 1, x: 300 });
                mugs.push({ lane: 2, x: 100 });
                startGame();
            });
            const counts = await page.evaluate(() => [customers.length, sodas.length, mugs.length]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('restarting after game over is possible with Space', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // The server (player)
    // -----------------------------------------------------------------------
    test.describe('the server', () => {
        test('ArrowDown moves the server one lane down', async ({ page }) => {
            await startQuiet(page);
            await pressLane(page, 'ArrowDown', 1);
        });

        test('ArrowUp moves the server one lane up', async ({ page }) => {
            await startQuiet(page);
            await pressLane(page, 'ArrowDown', 1);
            await pressLane(page, 'ArrowUp', 0);
        });

        test('w and s also change lane', async ({ page }) => {
            await startQuiet(page);
            await pressLane(page, 's', 1);
            await pressLane(page, 'w', 0);
        });

        test('the server cannot move above the top lane', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('ArrowUp');
            await advance(page, 5);
            expect(await page.evaluate(() => server.lane)).toBe(0);
        });

        test('the server cannot move below the bottom lane', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                server.lane = LANE_COUNT - 1;
            });
            await page.keyboard.press('ArrowDown');
            await advance(page, 5);
            expect(await page.evaluate(() => server.lane)).toBe(3);
        });

        test('lane changes are ignored while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => togglePause());
            await page.keyboard.press('ArrowDown');
            await advance(page, 5);
            expect(await page.evaluate(() => server.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving sodas', () => {
        test('Space sends a soda down the server lane', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                server.lane = 2;
            });
            await page.keyboard.press('Space');
            await page.waitForFunction(() => sodas.length === 1);
            const soda = await page.evaluate(() => ({ lane: sodas[0].lane, x: sodas[0].x }));
            expect(soda.lane).toBe(2);
            expect(soda.x).toBeGreaterThan(await page.evaluate(() => CANVAS_W / 2));
        });

        test('a served soda travels left', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => serve());
            const before = await page.evaluate(() => sodas[0].x);
            await advance(page, 10);
            const after = await page.evaluate(() => sodas[0].x);
            expect(after).toBeLessThan(before);
        });

        // Measured inside one evaluate: the real requestAnimationFrame loop is
        // still running, so a before/after pair split across two round trips
        // would pick up the frames it ran in between.
        test('a soda moves at SODA_SPEED pixels per second', async ({ page }) => {
            await startQuiet(page);
            const moved = await page.evaluate(() => {
                serve();
                const before = sodas[0].x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return before - sodas[0].x;
            });
            expect(moved).toBeCloseTo(await page.evaluate(() => SODA_SPEED), 0);
        });

        test('the serve cooldown stops two sodas leaving on the same frame', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                serve();
                serve();
            });
            expect(await page.evaluate(() => sodas.length)).toBe(1);
        });

        test('a second soda can be served once the cooldown elapses', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => serve());
            await page.evaluate(() => {
                for (let i = 0; i < 60; i++) step(SERVE_COOLDOWN / 10);
                serve();
            });
            expect(await page.evaluate(() => sodas.length)).toBe(2);
        });

        test('a lane holds at most MAX_SODAS_PER_LANE sodas', async ({ page }) => {
            await startQuiet(page);
            const got = await page.evaluate(() => {
                for (let i = 0; i < 10; i++) {
                    server.cooldown = 0;
                    serve();
                }
                return sodas.filter((s) => s.lane === server.lane).length;
            });
            expect(got).toBe(await page.evaluate(() => MAX_SODAS_PER_LANE));
        });

        test('serving is ignored while idle', async ({ page }) => {
            await page.evaluate(() => {
                server.cooldown = 0;
                serve();
            });
            expect(await page.evaluate(() => sodas.length)).toBe(0);
        });

        test('serving is ignored while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                togglePause();
                server.cooldown = 0;
                serve();
            });
            expect(await page.evaluate(() => sodas.length)).toBe(0);
        });

        test('serving is ignored once the game is over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                loseLife();
                server.cooldown = 0;
                serve();
            });
            expect(await page.evaluate(() => sodas.length)).toBe(0);
        });

        test('a soda that reaches the far end spills and costs points', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 500;
                serve();
            });
            await advance(page, 240);
            const snap = await page.evaluate(() => [sodas.length, score, spills]);
            expect(snap).toEqual([0, 500 - (await page.evaluate(() => SPILL_PENALTY)), 1]);
        });

        test('a spill never pushes the score below zero', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 0;
                serve();
            });
            await advance(page, 240);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('a spill does not cost a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => serve());
            await advance(page, 240);
            const snap = await page.evaluate(() => [lives, state]);
            expect(snap).toEqual([3, 'running']);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test('a customer walks towards the server', async ({ page }) => {
            await startQuiet(page);
            const moved = await page.evaluate(() => {
                spawnCustomer(0);
                const before = customers[0].x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return customers[0].x - before;
            });
            expect(moved).toBeGreaterThan(0);
            expect(moved).toBeCloseTo(await page.evaluate(() => customerSpeedFor(1)), 0);
        });

        test('a customer spawns at the far end of its lane', async ({ page }) => {
            await startQuiet(page);
            const snap = await page.evaluate(() => {
                spawnCustomer(3);
                return { lane: customers[0].lane, x: customers[0].x, left: LANE_LEFT, right: LANE_RIGHT };
            });
            expect(snap.lane).toBe(3);
            expect(snap.x).toBeGreaterThanOrEqual(snap.left);
            expect(snap.x).toBeLessThan(snap.left + 60);
        });

        test('a customer reaching the counter end costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                customers.push({ lane: 1, x: GRAB_X - 1, state: 'walking', timer: 0, drinks: 0 });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the grabbing customer is removed when a life is lost', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                customers.push({ lane: 1, x: GRAB_X - 1, state: 'walking', timer: 0, drinks: 0 });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });

        test('customers get faster on later waves, up to a cap', async ({ page }) => {
            const speeds = await page.evaluate(() => [1, 2, 3, 20].map((l) => customerSpeedFor(l)));
            expect(speeds[1]).toBeGreaterThan(speeds[0]);
            expect(speeds[2]).toBeGreaterThan(speeds[1]);
            expect(speeds[3]).toBe(await page.evaluate(() => CUSTOMER_SPEED_CAP));
        });
    });

    // -----------------------------------------------------------------------
    // Soda hits
    // -----------------------------------------------------------------------
    test.describe('soda hits', () => {
        test('a soda knocks a customer back and makes it drink', async ({ page }) => {
            await startQuiet(page);
            const snap = await page.evaluate(() => {
                customers.push({ lane: 0, x: 400, state: 'walking', timer: 0, drinks: 0 });
                sodas.push({ lane: 0, x: 400 + CUSTOMER_W / 2 + SODA_W / 2 + 2 });
                step(1 / 60);
                return {
                    x: customers[0].x,
                    state: customers[0].state,
                    drinks: customers[0].drinks,
                    sodas: sodas.length,
                };
            });
            expect(snap.x).toBeCloseTo(400 - (await page.evaluate(() => KNOCKBACK)), 5);
            expect(snap.state).toBe('drinking');
            expect(snap.drinks).toBe(1);
            expect(snap.sodas).toBe(0);
        });

        test('a drinking customer stands still until the drink is finished', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                customers.push({ lane: 0, x: 400, state: 'drinking', timer: DRINK_TIME, drinks: 1 });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => customers[0].x)).toBe(400);
            await page.evaluate(() => {
                for (let i = 0; i < 60; i++) step(DRINK_TIME / 30);
            });
            const snap = await page.evaluate(() => [customers[0].state, customers[0].x > 400]);
            expect(snap).toEqual(['walking', true]);
        });

        test('a soda hits the customer nearest the server, not the one behind it', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                customers.push({ lane: 0, x: 200, state: 'walking', timer: 0, drinks: 0 });
                customers.push({ lane: 0, x: 420, state: 'walking', timer: 0, drinks: 0 });
            });
            await sodaTouching(page, 0, 420);
            await advance(page, 1);
            const drinks = await page.evaluate(() => customers.map((c) => c.drinks));
            expect(drinks).toEqual([0, 1]);
        });

        test('a soda only hits customers in its own lane', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                server.lane = 0;
                customers.push({ lane: 2, x: 200, state: 'walking', timer: 0, drinks: 0 });
                serve();
            });
            await advance(page, 240);
            const snap = await page.evaluate(() => [customers[0].drinks, spills]);
            expect(snap).toEqual([0, 1]);
        });

        test('a customer pushed past the counter end is satisfied and scores', async ({ page }) => {
            await startQuiet(page);
            const x = await page.evaluate(() => {
                const cx = LANE_LEFT + 20;
                customers.push({ lane: 0, x: cx, state: 'walking', timer: 0, drinks: 0 });
                return cx;
            });
            await sodaTouching(page, 0, x);
            await advance(page, 1);
            const snap = await page.evaluate(() => [customers.length, score, served]);
            expect(snap).toEqual([0, await page.evaluate(() => SCORE_SATISFY), 1]);
        });

        test('a satisfied customer sends an empty mug back down the lane', async ({ page }) => {
            await startQuiet(page);
            const x = await page.evaluate(() => {
                const cx = LANE_LEFT + 20;
                server.lane = 3;
                customers.push({ lane: 3, x: cx, state: 'walking', timer: 0, drinks: 0 });
                return cx;
            });
            await sodaTouching(page, 3, x);
            await advance(page, 1);
            const snap = await page.evaluate(() => ({
                count: mugs.length,
                lane: mugs[0] && mugs[0].lane,
                onTheLeft: mugs[0] && mugs[0].x < LANE_LEFT + 30,
            }));
            expect(snap).toEqual({ count: 1, lane: 3, onTheLeft: true });
        });

        test('a hit that does not push a customer out leaves the score alone', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 0;
                customers.push({ lane: 0, x: 400, state: 'walking', timer: 0, drinks: 0 });
            });
            await sodaTouching(page, 0, 400);
            await advance(page, 1);
            const snap = await page.evaluate(() => [score, served, mugs.length]);
            expect(snap).toEqual([0, 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test('a mug slides back towards the server', async ({ page }) => {
            await startQuiet(page);
            const moved = await page.evaluate(() => {
                // Lane 1 so the server, parked on lane 0, cannot catch it.
                mugs.push({ lane: 1, x: 200 });
                for (let i = 0; i < 60; i++) step(1 / 60);
                return mugs[0].x - 200;
            });
            expect(moved).toBeCloseTo(await page.evaluate(() => MUG_SPEED), 0);
        });

        test('the server catches a mug in its own lane and scores', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                server.lane = 1;
                mugs.push({ lane: 1, x: CATCH_X - 20 });
            });
            await advance(page, 60);
            const snap = await page.evaluate(() => [mugs.length, score, caught, lives]);
            expect(snap).toEqual([0, await page.evaluate(() => SCORE_MUG), 1, 3]);
        });

        test('a mug in another lane is missed and smashes, costing a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                server.lane = 0;
                mugs.push({ lane: 2, x: CATCH_X - 20 });
            });
            await advance(page, 120);
            const snap = await page.evaluate(() => [mugs.length, lives, score]);
            expect(snap).toEqual([0, 2, 0]);
        });

        test('moving into the lane in time still catches the mug', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => mugs.push({ lane: 2, x: 200 }));
            await pressLane(page, 'ArrowDown', 1);
            await pressLane(page, 'ArrowDown', 2);
            await advance(page, 240);
            const snap = await page.evaluate(() => [caught, lives]);
            expect(snap).toEqual([1, 3]);
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('the wave quota grows with the level and is capped', async ({ page }) => {
            const quotas = await page.evaluate(() => [1, 2, 3, 50].map((l) => quotaFor(l)));
            expect(quotas[1]).toBeGreaterThan(quotas[0]);
            expect(quotas[2]).toBeGreaterThan(quotas[1]);
            expect(quotas[3]).toBe(await page.evaluate(() => QUOTA_CAP));
        });

        test('meeting the quota clears the wave and awards a bonus', async ({ page }) => {
            await startQuiet(page);
            const x = await page.evaluate(() => {
                const cx = LANE_LEFT + 20;
                score = 0;
                served = quotaFor(level) - 1;
                customers.push({ lane: 0, x: cx, state: 'walking', timer: 0, drinks: 0 });
                return cx;
            });
            await sodaTouching(page, 0, x);
            await advance(page, 1);
            const snap = await page.evaluate(() => [state, score]);
            expect(snap[0]).toBe('waveclear');
            expect(snap[1]).toBe(
                await page.evaluate(() => SCORE_SATISFY + WAVE_BONUS * level)
            );
        });

        test('the next wave starts after the break, with the counter cleared', async ({ page }) => {
            await startQuiet(page);
            const snap = await page.evaluate(() => {
                served = quotaFor(level);
                clearWave();
                customers.push({ lane: 0, x: 300, state: 'walking', timer: 0, drinks: 0 });
                for (let i = 0; i < 90; i++) step(WAVE_PAUSE / 30);
                return [state, level, served, customers.length, mugs.length];
            });
            expect(snap).toEqual(['running', 2, 0, 0, 0]);
        });

        test('the wave overlay names the next wave', async ({ page }) => {
            await startQuiet(page);
            const snap = await page.evaluate(() => {
                served = quotaFor(level);
                clearWave();
                return { visible: overlay.classList.contains('visible'), title: overlayTitle.textContent };
            });
            expect(snap.visible).toBe(true);
            expect(snap.title).toMatch(/wave/i);
        });

        test('customers left in the HUD counts down as they are served', async ({ page }) => {
            await startQuiet(page);
            const quota = await page.evaluate(() => quotaFor(1));
            await expect(page.locator('#remaining')).toHaveText(String(quota));
            const x = await page.evaluate(() => {
                const cx = LANE_LEFT + 20;
                customers.push({ lane: 0, x: cx, state: 'walking', timer: 0, drinks: 0 });
                return cx;
            });
            await sodaTouching(page, 0, x);
            await advance(page, 1);
            await expect(page.locator('#remaining')).toHaveText(String(quota - 1));
        });
    });

    // -----------------------------------------------------------------------
    // Spawning
    // -----------------------------------------------------------------------
    test.describe('spawning', () => {
        test('customers arrive on their own once the game is running', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                srand(7);
            });
            await advance(page, 600);
            expect(await page.evaluate(() => customers.length)).toBeGreaterThan(0);
        });

        test('spawning is deterministic for a fixed seed', async ({ page }) => {
            const run = () =>
                page.evaluate(() => {
                    startGame();
                    srand(99);
                    for (let i = 0; i < 400; i++) step(1 / 60);
                    return customers.map((c) => [c.lane, Math.round(c.x)]);
                });
            const a = await run();
            const b = await run();
            expect(a).toEqual(b);
        });

        test('waves spawn customers more often as the level rises, down to a floor', async ({ page }) => {
            const gaps = await page.evaluate(() => [1, 2, 3, 40].map((l) => spawnIntervalFor(l)));
            expect(gaps[1]).toBeLessThan(gaps[0]);
            expect(gaps[2]).toBeLessThan(gaps[1]);
            expect(gaps[3]).toBe(await page.evaluate(() => SPAWN_MIN));
        });

        test('a lane never spawns a customer on top of another', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                srand(3);
            });
            await advance(page, 1200);
            const bad = await page.evaluate(() => {
                for (const lane of [0, 1, 2, 3]) {
                    const xs = customers.filter((c) => c.lane === lane).map((c) => c.x).sort((a, b) => a - b);
                    for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < CUSTOMER_W) return true;
                }
                return false;
            });
            expect(bad).toBe(false);
        });

        test('no customers spawn while the game is over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                loseLife();
            });
            await advance(page, 600);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('p pauses and resumes the game', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                customers.push({ lane: 0, x: 300, state: 'walking', timer: 0, drinks: 0 });
                mugs.push({ lane: 0, x: 100 });
                serve();
                togglePause();
            });
            const before = await page.evaluate(() => [customers[0].x, mugs[0].x, sodas[0].x]);
            await advance(page, 120);
            const after = await page.evaluate(() => [customers[0].x, mugs[0].x, sodas[0].x]);
            expect(after).toEqual(before);
        });

        test('pausing is ignored when the game is not running', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test('losing a life pauses play briefly and clears the counter', async ({ page }) => {
            await startQuiet(page);
            const snap = await page.evaluate(() => {
                customers.push({ lane: 0, x: 300, state: 'walking', timer: 0, drinks: 0 });
                mugs.push({ lane: 1, x: 200 });
                sodas.push({ lane: 2, x: 400 });
                loseLife();
                return [state, lives, customers.length, mugs.length, sodas.length];
            });
            expect(snap).toEqual(['dying', 2, 0, 0, 0]);
        });

        test('play resumes automatically after the break', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                loseLife();
                for (let i = 0; i < 60; i++) step(DEATH_PAUSE / 30);
            });
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the last life ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            const snap = await page.evaluate(() => [state, lives]);
            expect(snap).toEqual(['over', 0]);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('game over shows the final score and saves the best', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#overlay-score')).toContainText('1234');
            expect(await page.evaluate(() => window.localStorage.getItem('soda-rush-best'))).toBe('1234');
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('a lower score does not overwrite the saved best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('soda-rush-best', '5000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 10;
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => window.localStorage.getItem('soda-rush-best'))).toBe('5000');
        });

        test('nothing moves once the game is over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                loseLife();
                customers.push({ lane: 0, x: 300, state: 'walking', timer: 0, drinks: 0 });
            });
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBe(300);
        });
    });

    // -----------------------------------------------------------------------
    // Score popups (cosmetic, but they should never outlive a round)
    // -----------------------------------------------------------------------
    test.describe('score popups', () => {
        test('serving a customer out of the door raises a popup', async ({ page }) => {
            await startQuiet(page);
            const snap = await page.evaluate(() => {
                const cx = LANE_LEFT + 20;
                customers.push({ lane: 2, x: cx, state: 'walking', timer: 0, drinks: 0 });
                sodas.push({ lane: 2, x: cx + CUSTOMER_W / 2 + SODA_W / 2 + 2 });
                step(1 / 60);
                return { count: popups.length, text: popups[0] && popups[0].text };
            });
            expect(snap).toEqual({ count: 1, text: `+${await page.evaluate(() => SCORE_SATISFY)}` });
        });

        test('a popup drifts up and expires', async ({ page }) => {
            await startQuiet(page);
            const snap = await page.evaluate(() => {
                popup(200, 0, '+100', '#fff');
                const y0 = popups[0].y;
                for (let i = 0; i < 10; i++) step(1 / 60);
                const rose = popups[0].y < y0;
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { rose, left: popups.length };
            });
            expect(snap).toEqual({ rose: true, left: 0 });
        });

        test('popups are cleared when a life is lost', async ({ page }) => {
            await startQuiet(page);
            const left = await page.evaluate(() => {
                popup(200, 0, '+100', '#fff');
                loseLife();
                return popups.length;
            });
            expect(left).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is drawn, not left blank', async ({ page }) => {
            const distinct = await page.evaluate(() => {
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                    if (seen.size > 8) break;
                }
                return seen.size;
            });
            expect(distinct).toBeGreaterThan(3);
        });

        test('entities are drawn without throwing', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                customers.push({ lane: 0, x: 300, state: 'walking', timer: 0, drinks: 0 });
                customers.push({ lane: 2, x: 420, state: 'drinking', timer: 0.3, drinks: 2 });
                sodas.push({ lane: 1, x: 500 });
                mugs.push({ lane: 3, x: 120 });
                draw();
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the game loop advances the simulation on its own', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnEnabled = false;
                customers.length = 0;
                customers.push({ lane: 0, x: 200, state: 'walking', timer: 0, drinks: 0 });
            });
            await page.waitForFunction(() => customers.length && customers[0].x > 203);
        });
    });
});
