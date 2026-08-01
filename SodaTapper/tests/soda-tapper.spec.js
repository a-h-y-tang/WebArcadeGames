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

        test('no customers or mugs before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                customers: customers.length,
                mugs: mugs.length,
                empties: empties.length,
            }));
            expect(counts).toEqual({ customers: 0, mugs: 0, empties: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('soda-tapper-best', '742'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('742');
        });

        test('there are four bars', async ({ page }) => {
            expect(await page.evaluate(() => LANE_COUNT)).toBe(4);
        });

        test('every lane has a distinct y position inside the canvas', async ({ page }) => {
            const { ys, height } = await page.evaluate(() => ({
                ys: Array.from({ length: LANE_COUNT }, (_, i) => laneY(i)),
                height: CANVAS_H,
            }));
            expect(new Set(ys).size).toBe(ys.length);
            for (const y of ys) {
                expect(y).toBeGreaterThan(0);
                expect(y).toBeLessThan(height);
            }
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

        test('game starts on level 1 with full lives and no score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, lives, score, startLives: START_LIVES };
            });
            expect(s.level).toBe(1);
            expect(s.lives).toBe(s.startLives);
            expect(s.score).toBe(0);
        });

        test('the server starts on a valid lane', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return player.lane >= 0 && player.lane < LANE_COUNT;
            });
            expect(ok).toBe(true);
        });

        test('starting clears any leftover customers and mugs', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                spawnCustomer(0);
                serve();
                startGame();
                return { customers: customers.length, mugs: mugs.length, empties: empties.length };
            });
            expect(counts).toEqual({ customers: 0, mugs: 0, empties: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Moving between lanes
    // -----------------------------------------------------------------------
    test.describe('server movement', () => {
        test('moveLane(1) moves the server down a bar', async ({ page }) => {
            const lane = await page.evaluate(() => {
                startGame();
                player.lane = 1;
                moveLane(1);
                return player.lane;
            });
            expect(lane).toBe(2);
        });

        test('moveLane(-1) moves the server up a bar', async ({ page }) => {
            const lane = await page.evaluate(() => {
                startGame();
                player.lane = 2;
                moveLane(-1);
                return player.lane;
            });
            expect(lane).toBe(1);
        });

        test('the server cannot move above the top bar', async ({ page }) => {
            const lane = await page.evaluate(() => {
                startGame();
                player.lane = 0;
                moveLane(-1);
                moveLane(-1);
                return player.lane;
            });
            expect(lane).toBe(0);
        });

        test('the server cannot move below the bottom bar', async ({ page }) => {
            const lane = await page.evaluate(() => {
                startGame();
                player.lane = LANE_COUNT - 1;
                moveLane(1);
                moveLane(1);
                return { lane: player.lane, last: LANE_COUNT - 1 };
            });
            expect(lane.lane).toBe(lane.last);
        });

        test('ArrowDown moves the server down a bar', async ({ page }) => {
            await page.evaluate(() => { startGame(); player.lane = 0; });
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('ArrowUp moves the server up a bar', async ({ page }) => {
            await page.evaluate(() => { startGame(); player.lane = 3; });
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(2);
        });

        test('the server cannot change lanes while idle', async ({ page }) => {
            await page.evaluate(() => { player.lane = 1; });
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Serving mugs
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('serve() sends a mug down the server lane', async ({ page }) => {
            const mug = await page.evaluate(() => {
                startGame();
                player.lane = 2;
                serve();
                return { count: mugs.length, lane: mugs[0].lane };
            });
            expect(mug.count).toBe(1);
            expect(mug.lane).toBe(2);
        });

        test('a served mug starts at the tap end of the bar', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                serve();
                return mugs[0].x;
            });
            expect(x).toBeGreaterThan(300);
        });

        test('mugs slide left along the bar', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                serve();
                const before = mugs[0].x;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: mugs[0].x };
            });
            expect(after).toBeLessThan(before);
        });

        test('serving costs one mug from the tray', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const before = mugsLeft;
                serve();
                return { before, after: mugsLeft };
            });
            expect(after).toBe(before - 1);
        });

        test('serving with an empty tray does nothing', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                mugsLeft = 0;
                serve();
                return mugs.length;
            });
            expect(count).toBe(0);
        });

        test('serving is throttled so a single lane cannot be spammed', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                serve();
                serve();
                serve();
                return mugs.length;
            });
            expect(count).toBe(1);
        });

        test('a second mug can be served after the cooldown', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                serve();
                for (let i = 0; i < 40; i++) step(0.016);
                serve();
                return mugs.length;
            });
            expect(count).toBe(2);
        });

        test('Space serves a mug while running', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('serving does nothing while idle', async ({ page }) => {
            const count = await page.evaluate(() => {
                serve();
                return mugs.length;
            });
            expect(count).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test('spawnCustomer adds a customer at the far end of the lane', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                spawnCustomer(1);
                return { count: customers.length, lane: customers[0].lane, x: customers[0].x };
            });
            expect(c.count).toBe(1);
            expect(c.lane).toBe(1);
            expect(c.x).toBeLessThan(100);
        });

        test('customers advance toward the tap', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                spawnCustomer(1);
                const before = customers[0].x;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: customers[0].x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('customers appear on their own as the level runs', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                for (let i = 0; i < 300; i++) step(0.016);
                return customers.length;
            });
            expect(count).toBeGreaterThan(0);
        });

        test('customers walk faster on later levels', async ({ page }) => {
            const { slow, fast } = await page.evaluate(() => {
                startGame();
                level = 1;
                customers.length = 0;
                spawnCustomer(0);
                const a0 = customers[0].x;
                step(0.1);
                const slow = customers[0].x - a0;
                level = 6;
                customers.length = 0;
                spawnCustomer(0);
                const b0 = customers[0].x;
                step(0.1);
                const fast = customers[0].x - b0;
                return { slow, fast };
            });
            expect(fast).toBeGreaterThan(slow);
        });
    });

    // -----------------------------------------------------------------------
    // Mug meets customer
    // -----------------------------------------------------------------------
    test.describe('serving customers', () => {
        test('a mug that reaches a customer is consumed and scores', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnTimer = 1e9;
                customers.length = 0;
                mugs.length = 0;
                spawnCustomer(0, 300);
                player.lane = 0;
                serve();
                for (let i = 0; i < 120; i++) step(0.016);
                return { mugs: mugs.length, score };
            });
            expect(r.mugs).toBe(0);
            expect(r.score).toBeGreaterThan(0);
        });

        test('a mug only affects customers in its own lane', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnTimer = 1e9;
                customers.length = 0;
                mugs.length = 0;
                spawnCustomer(3, 300);
                const startX = customers[0].x;
                player.lane = 0;
                serve();
                for (let i = 0; i < 60; i++) step(0.016);
                return { moved: customers[0].x - startX };
            });
            // the lane 3 customer keeps walking forward, never pushed back
            expect(r.moved).toBeGreaterThan(0);
        });

        test('a served customer is pushed back down the bar', async ({ page }) => {
            const pushed = await page.evaluate(() => {
                startGame();
                spawnTimer = 1e9;
                customers.length = 0;
                mugs.length = 0;
                spawnCustomer(0, 300);
                player.lane = 0;
                serve();
                let hitX = null;
                for (let i = 0; i < 240; i++) {
                    const had = mugs.length;
                    step(0.016);
                    if (had && !mugs.length) hitX = customers.length ? customers[0].x : null;
                }
                return { hitX };
            });
            expect(pushed.hitX).not.toBeNull();
            expect(pushed.hitX).toBeLessThan(300);
        });

        test('a customer pushed off the end of the bar leaves', async ({ page }) => {
            const left = await page.evaluate(() => {
                startGame();
                spawnTimer = 1e9;
                customers.length = 0;
                mugs.length = 0;
                spawnCustomer(0, BAR_LEFT + 20);
                player.lane = 0;
                serve();
                for (let i = 0; i < 400; i++) step(0.016);
                return customers.length;
            });
            expect(left).toBe(0);
        });

        test('a departing customer sends an empty mug back', async ({ page }) => {
            // The empty is later caught by the server (same lane), so watch for
            // it appearing rather than inspecting the array at the end.
            const count = await page.evaluate(() => {
                startGame();
                spawnTimer = 1e9;
                customers.length = 0;
                mugs.length = 0;
                empties.length = 0;
                spawnCustomer(0, BAR_LEFT + 20);
                player.lane = 0;
                serve();
                let seen = 0;
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    seen = Math.max(seen, empties.length);
                }
                return seen;
            });
            expect(count).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs coming back
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test('empty mugs slide back toward the tap', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                empties.length = 0;
                spawnEmpty(0, 200);
                const before = empties[0].x;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: empties[0].x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('catching an empty in the right lane scores', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                empties.length = 0;
                score = 0;
                player.lane = 2;
                spawnEmpty(2, CATCH_X - 20);
                for (let i = 0; i < 60; i++) step(0.016);
                return { empties: empties.length, score, lives };
            });
            expect(r.empties).toBe(0);
            expect(r.score).toBeGreaterThan(0);
            expect(r.lives).toBe(3);
        });

        test('missing an empty costs a life', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                empties.length = 0;
                player.lane = 0;
                spawnEmpty(3, CATCH_X - 20);
                for (let i = 0; i < 60; i++) step(0.016);
                return { empties: empties.length, lives };
            });
            expect(r.empties).toBe(0);
            expect(r.lives).toBe(2);
        });

        test('a caught empty returns a mug to the tray', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                empties.length = 0;
                mugsLeft = 1;
                player.lane = 1;
                spawnEmpty(1, CATCH_X - 20);
                for (let i = 0; i < 60; i++) step(0.016);
                return mugsLeft;
            });
            expect(r).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Losing a life
    // -----------------------------------------------------------------------
    test.describe('mistakes', () => {
        test('a mug that runs off the end of the bar costs a life', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnTimer = 1e9;
                customers.length = 0;
                mugs.length = 0;
                player.lane = 0;
                serve();
                for (let i = 0; i < 300; i++) step(0.016);
                return { mugs: mugs.length, lives };
            });
            expect(r.mugs).toBe(0);
            expect(r.lives).toBe(2);
        });

        test('a customer reaching the tap costs a life', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnTimer = 1e9;
                customers.length = 0;
                mugs.length = 0;
                spawnCustomer(0, TAP_X - 10);
                for (let i = 0; i < 120; i++) step(0.016);
                return { customers: customers.length, lives };
            });
            expect(r.lives).toBe(2);
            expect(r.customers).toBe(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                spawnTimer = 1e9;
                lives = 1;
                customers.length = 0;
                spawnCustomer(0, TAP_X - 10);
                for (let i = 0; i < 200; i++) step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('losing a life clears the bars', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnTimer = 1e9;
                customers.length = 0;
                mugs.length = 0;
                empties.length = 0;
                spawnCustomer(0, TAP_X - 10);
                spawnCustomer(2, 200);
                spawnEmpty(1, 200);
                for (let i = 0; i < 120; i++) step(0.016);
                return { customers: customers.length, mugs: mugs.length, empties: empties.length };
            });
            expect(r).toEqual({ customers: 0, mugs: 0, empties: 0 });
        });

        test('losing a life refills the mug tray', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnTimer = 1e9;
                customers.length = 0;
                mugsLeft = 0;
                spawnCustomer(0, TAP_X - 10);
                for (let i = 0; i < 120; i++) step(0.016);
                return { mugsLeft, tray: MUG_TRAY };
            });
            expect(r.mugsLeft).toBe(r.tray);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('customers cleared by a lost life are queued to walk on again', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                // the level has already sent everyone it was going to send
                spawnedThisLevel = customersThisLevel();
                servedThisLevel = 0;
                customers.length = 0;
                spawnCustomer(0, TAP_X - 10);
                for (let i = 0; i < 30; i++) step(0.016);
                return { spawned: spawnedThisLevel, served: servedThisLevel, lives };
            });
            expect(r.lives).toBe(2);
            expect(r.spawned).toBe(r.served);
        });

        test('the level keeps sending customers after a lost life', async ({ page }) => {
            const seen = await page.evaluate(() => {
                startGame();
                spawnedThisLevel = customersThisLevel();
                servedThisLevel = 0;
                customers.length = 0;
                spawnCustomer(0, TAP_X - 10);
                let seen = 0;
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    seen = Math.max(seen, customers.length);
                }
                return seen;
            });
            expect(seen).toBeGreaterThan(0);
        });

        test('a level is never cleared while customers are still owed', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                spawnedThisLevel = customersThisLevel();
                servedThisLevel = 0;
                customers.length = 0;
                spawnCustomer(0, TAP_X - 10);
                for (let i = 0; i < 60; i++) step(0.016);
                return level;
            });
            expect(r).toBe(1);
        });

        test('serving everyone in the level advances to the next one', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                servedThisLevel = customersThisLevel() - 1;
                spawnedThisLevel = customersThisLevel();
                customers.length = 0;
                mugs.length = 0;
                empties.length = 0;
                spawnCustomer(0, BAR_LEFT + 20);
                player.lane = 0;
                serve();
                for (let i = 0; i < 600; i++) step(0.016);
                return { level, served: servedThisLevel };
            });
            expect(r.level).toBe(2);
            expect(r.served).toBe(0);
        });

        test('a new level starts with a fresh tray and no customers', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                nextLevel();
                return {
                    level, customers: customers.length, mugs: mugs.length,
                    empties: empties.length, mugsLeft,
                };
            });
            expect(r).toEqual({
                level: 2, customers: 0, mugs: 0, empties: 0, mugsLeft: 4,
            });
        });

        test('later levels have more customers to serve', async ({ page }) => {
            const { l1, l4 } = await page.evaluate(() => {
                startGame();
                level = 1;
                const l1 = customersThisLevel();
                level = 4;
                const l4 = customersThisLevel();
                return { l1, l4 };
            });
            expect(l4).toBeGreaterThan(l1);
        });

        test('clearing a level awards a bonus', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                score = 100;
                const before = score;
                nextLevel();
                return { before, after: score };
            });
            expect(after).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring, HUD and best score
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('the HUD shows the live score, level and lives', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 250;
                level = 3;
                lives = 2;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('250');
            await expect(page.locator('#level')).toHaveText('3');
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 512;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('512');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 333;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('soda-tapper-best'));
            expect(parseInt(stored, 10)).toBe(333);
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

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the customers', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                spawnCustomer(0);
                togglePause();
                const before = customers[0].x;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: customers[0].x };
            });
            expect(after).toBe(before);
        });

        test('resuming lets the customers walk again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                spawnCustomer(0);
                togglePause();
                togglePause();
                const before = customers[0].x;
                for (let i = 0; i < 10; i++) step(0.016);
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

        test('serving is ignored while paused', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                togglePause();
                serve();
                return mugs.length;
            });
            expect(count).toBe(0);
        });

        test('restart after game over resets score, level and lives', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 999;
                level = 5;
                lives = 1;
                endGame();
                startGame();
                return { score, level, lives, state, customers: customers.length };
            });
            expect(r.score).toBe(0);
            expect(r.level).toBe(1);
            expect(r.lives).toBe(3);
            expect(r.state).toBe('running');
            expect(r.customers).toBe(0);
        });
    });
});
