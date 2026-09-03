const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

/** Pump the deterministic simulation for n frames of 16 ms. */
const FRAME = 0.016;

test.describe('Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
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

        test('score, lives and level start at their opening values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('canvas is 640x460', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle changes nothing', async ({ page }) => {
            const counts = await page.evaluate((dt) => {
                for (let i = 0; i < 200; i++) step(dt);
                return { customers: customers.length, mugs: mugs.length, score };
            }, FRAME);
            expect(counts).toEqual({ customers: 0, mugs: 0, score: 0 });
        });

        test('the four bars are evenly spaced inside the canvas', async ({ page }) => {
            const geom = await page.evaluate(() => ({
                lanes: LANE_COUNT,
                ys: Array.from({ length: LANE_COUNT }, (_, i) => laneY(i)),
                h: CANVAS_H,
                left: BAR_LEFT,
                right: BAR_RIGHT,
                tap: TAP_X,
            }));
            expect(geom.lanes).toBe(4);
            expect(geom.ys).toHaveLength(4);
            for (const y of geom.ys) {
                expect(y).toBeGreaterThan(0);
                expect(y).toBeLessThan(geom.h);
            }
            expect(geom.ys[1] - geom.ys[0]).toBeCloseTo(geom.ys[3] - geom.ys[2], 5);
            expect(geom.tap).toBeLessThan(geom.left);
            expect(geom.left).toBeLessThan(geom.right);
        });

        test('the high score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-high', '4200'));
            await page.reload();
            await expect(page.locator('#high')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Starting a shift
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting hides the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a fresh game opens with a full bar and an empty screen', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return {
                    score, lives, level, served,
                    customers: customers.length,
                    mugs: mugs.length,
                    empties: empties.length,
                    start: LIVES_START,
                };
            });
            expect(s.score).toBe(0);
            expect(s.lives).toBe(s.start);
            expect(s.level).toBe(1);
            expect(s.served).toBe(0);
            expect(s.customers).toBe(0);
            expect(s.mugs).toBe(0);
            expect(s.empties).toBe(0);
        });

        test('the bartender starts at the top bar', async ({ page }) => {
            expect(await page.evaluate(() => { startGame(); return player.lane; })).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between bars
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('moving down goes to the next bar', async ({ page }) => {
            expect(await page.evaluate(() => {
                startGame();
                moveDown();
                return player.lane;
            })).toBe(1);
        });

        test('moving up goes back to the previous bar', async ({ page }) => {
            expect(await page.evaluate(() => {
                startGame();
                player.lane = 2;
                moveUp();
                return player.lane;
            })).toBe(1);
        });

        test('the bartender cannot go above the top bar', async ({ page }) => {
            expect(await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 6; i++) moveUp();
                return player.lane;
            })).toBe(0);
        });

        test('the bartender cannot go below the bottom bar', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 10; i++) moveDown();
                return { lane: player.lane, lanes: LANE_COUNT };
            });
            expect(s.lane).toBe(s.lanes - 1);
        });

        test('ArrowDown moves down a bar', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('ArrowUp moves up a bar', async ({ page }) => {
            await page.evaluate(() => { startGame(); player.lane = 3; });
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(2);
        });

        test('W and S also move between bars', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('s');
            await page.keyboard.press('s');
            expect(await page.evaluate(() => player.lane)).toBe(2);
            await page.keyboard.press('w');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test('pouring puts a mug at the left end of the current bar', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                player.lane = 2;
                pour();
                return { count: mugs.length, lane: mugs[0].lane, x: mugs[0].x, left: BAR_LEFT };
            });
            expect(s.count).toBe(1);
            expect(s.lane).toBe(2);
            expect(s.x).toBeCloseTo(s.left, 5);
        });

        test('a poured mug slides toward the far end', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                pour();
                const before = mugs[0].x;
                for (let i = 0; i < 10; i++) step(dt);
                return { before, after: mugs[0].x };
            }, FRAME);
            expect(s.after).toBeGreaterThan(s.before);
        });

        test('the pour cooldown stops a lane being flooded in one frame', async ({ page }) => {
            expect(await page.evaluate(() => {
                startGame();
                pour();
                pour();
                pour();
                return mugs.length;
            })).toBe(1);
        });

        test('the cooldown expires so another mug can be poured', async ({ page }) => {
            expect(await page.evaluate((dt) => {
                startGame();
                pour();
                for (let i = 0; i < 40; i++) step(dt);
                pour();
                return mugs.length;
            }, FRAME)).toBe(2);
        });

        test('Space pours while the game is running', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('a mug that reaches the far end is spilled and costs a life', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                pour();
                for (let i = 0; i < 300; i++) step(dt);
                return { lives, mugs: mugs.length, start: LIVES_START };
            }, FRAME);
            expect(s.lives).toBe(s.start - 1);
            expect(s.mugs).toBe(0);
        });

        test('pouring while paused does nothing', async ({ page }) => {
            expect(await page.evaluate(() => {
                startGame();
                togglePause();
                pour();
                return mugs.length;
            })).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test('a spawned customer arrives at the door end of its bar', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                spawnCustomer(1);
                return { count: customers.length, lane: customers[0].lane, x: customers[0].x, right: BAR_RIGHT };
            });
            expect(s.count).toBe(1);
            expect(s.lane).toBe(1);
            expect(s.x).toBeGreaterThanOrEqual(s.right - 1);
        });

        test('customers walk toward the taps', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                spawnCustomer(0, 400);
                const before = customers[0].x;
                for (let i = 0; i < 30; i++) step(dt);
                return { before, after: customers[0].x };
            }, FRAME);
            expect(s.after).toBeLessThan(s.before);
        });

        test('a customer stays in its own lane', async ({ page }) => {
            expect(await page.evaluate((dt) => {
                startGame();
                spawnCustomer(3, 400);
                for (let i = 0; i < 60; i++) step(dt);
                return customers[0].lane;
            }, FRAME)).toBe(3);
        });

        test('a customer reaching the taps costs a life', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                spawnCustomer(0, BAR_LEFT + 8);
                for (let i = 0; i < 120; i++) step(dt);
                return { lives, start: LIVES_START };
            }, FRAME);
            expect(s.lives).toBe(s.start - 1);
        });

        test('losing a life clears the screen', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                spawnCustomer(0, BAR_LEFT + 8);
                spawnCustomer(2, 500);
                player.lane = 3;                   // a mug in flight somewhere else
                pour();
                for (let i = 0; i < 120; i++) step(dt);
                return { customers: customers.length, mugs: mugs.length, empties: empties.length };
            }, FRAME);
            expect(s).toEqual({ customers: 0, mugs: 0, empties: 0 });
        });

        test('a customer does not walk through the one in front of it', async ({ page }) => {
            const gap = await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                spawnCustomer(0, 300);
                spawnCustomer(0, 340);
                for (let i = 0; i < 200; i++) step(dt);
                if (customers.length < 2) return null;
                const xs = customers.map((c) => c.x).sort((a, b) => a - b);
                return xs[1] - xs[0];
            }, FRAME);
            expect(gap).not.toBeNull();
            expect(gap).toBeGreaterThan(0);
        });

        test('customers walk faster on later levels', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const one = levelSpeed();
                level = 4;
                return { one, four: levelSpeed() };
            });
            expect(s.four).toBeGreaterThan(s.one);
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('a mug that reaches a customer is consumed', async ({ page }) => {
            expect(await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                spawnCustomer(0, 300);
                pour();
                for (let i = 0; i < 60; i++) step(dt);
                return mugs.length;
            }, FRAME)).toBe(0);
        });

        test('a served drink shoves the customer back toward the door', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                spawnCustomer(0, 300);
                pour();
                for (let i = 0; i < 40; i++) step(dt);   // mug still travelling
                const before = customers[0].x;
                for (let i = 0; i < 60; i++) step(dt);   // hit + shove
                return { before, after: customers[0] ? customers[0].x : Infinity };
            }, FRAME);
            expect(s.after).toBeGreaterThan(s.before);
        });

        test('a drinking customer holds still before walking again', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                spawnCustomer(0, 300);
                pour();
                for (let i = 0; i < 200; i++) {
                    step(dt);
                    if (customers[0] && customers[0].drink > 0 && customers[0].push <= 0) {
                        const x = customers[0].x;
                        step(dt);
                        return { held: customers[0].x === x, drink: customers[0].drink };
                    }
                }
                return { held: false, drink: -1 };
            }, FRAME);
            expect(s.drink).toBeGreaterThan(0);
            expect(s.held).toBe(true);
        });

        test('a customer shoved out of the door is served and scores', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                spawnCustomer(0, BAR_RIGHT - 40);
                pour();
                for (let i = 0; i < 300; i++) step(dt);
                return { score, served, customers: customers.length, points: SERVE_POINTS };
            }, FRAME);
            expect(s.customers).toBe(0);
            expect(s.served).toBe(1);
            expect(s.score).toBeGreaterThanOrEqual(s.points);
        });

        test('a served customer sends an empty mug back', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                player.lane = 3;                       // keep the empty in flight
                spawnCustomer(0, BAR_RIGHT - 40);
                pour();                                // lane 3 mug would miss, so pour in lane 0
                mugs.length = 0;
                mugs.push({ lane: 0, x: BAR_LEFT });
                for (let i = 0; i < 200; i++) {
                    step(dt);
                    if (empties.length) return { count: empties.length, lane: empties[0].lane };
                }
                return { count: empties.length, lane: -1 };
            }, FRAME);
            expect(s.count).toBe(1);
            expect(s.lane).toBe(0);
        });

        test('a customer far from the door is only pushed back, not served', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                spawnCustomer(0, 300);
                pour();
                for (let i = 0; i < 120; i++) step(dt);
                return { served, customers: customers.length };
            }, FRAME);
            expect(s.served).toBe(0);
            expect(s.customers).toBe(1);
        });

        test('a mug only hits customers in its own lane', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                player.lane = 0;
                spawnCustomer(2, 300);
                pour();                                 // lane 0
                // Stop before the mug reaches the far end, so the only thing
                // that could disturb the customer is the mug itself.
                for (let i = 0; i < 90; i++) step(dt);
                return { customerX: customers.length ? customers[0].x : null, mugs: mugs.length, served };
            }, FRAME);
            expect(s.served).toBe(0);
            expect(s.mugs).toBe(1);                     // sailed past, unclaimed
            expect(s.customerX).toBeLessThan(300);      // walked on undisturbed
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs coming back
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test('an empty mug travels back toward the taps', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                player.lane = 0;
                empties.push({ lane: 1, x: 500 });
                const before = empties[0].x;
                for (let i = 0; i < 10; i++) step(dt);
                return { before, after: empties[0].x };
            }, FRAME);
            expect(s.after).toBeLessThan(s.before);
        });

        test('catching an empty scores and removes it', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                player.lane = 1;
                empties.push({ lane: 1, x: BAR_LEFT + 30 });
                for (let i = 0; i < 60; i++) step(dt);
                return { score, empties: empties.length, points: CATCH_POINTS, lives, start: LIVES_START };
            }, FRAME);
            expect(s.empties).toBe(0);
            expect(s.score).toBe(s.points);
            expect(s.lives).toBe(s.start);
        });

        test('an empty mug nobody catches smashes and costs a life', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                player.lane = 3;
                empties.push({ lane: 1, x: BAR_LEFT + 30 });
                for (let i = 0; i < 60; i++) step(dt);
                return { lives, start: LIVES_START, empties: empties.length, score };
            }, FRAME);
            expect(s.lives).toBe(s.start - 1);
            expect(s.empties).toBe(0);
            expect(s.score).toBe(0);
        });

        test('an empty passes customers standing in the lane', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                player.lane = 0;
                spawnCustomer(0, 400);
                empties.push({ lane: 0, x: 500 });
                for (let i = 0; i < 20; i++) step(dt);
                return { x: empties[0].x, customers: customers.length };
            }, FRAME);
            expect(s.x).toBeLessThan(450);
            expect(s.customers).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test('the HUD shows the remaining lives', async ({ page }) => {
            await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                spawnCustomer(0, BAR_LEFT + 8);
                for (let i = 0; i < 120; i++) step(dt);
            }, FRAME);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('losing the last life ends the game', async ({ page }) => {
            expect(await page.evaluate((dt) => {
                startGame();
                spawned = quota;
                lives = 1;
                spawnCustomer(0, BAR_LEFT + 8);
                for (let i = 0; i < 120; i++) step(dt);
                return state;
            }, FRAME)).toBe('over');
        });

        test('the overlay announces the end of the game and the score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|closed|time/i);
            await expect(page.locator('#overlay-score')).toContainText('1234');
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('nothing moves once the game is over', async ({ page }) => {
            expect(await page.evaluate((dt) => {
                startGame();
                endGame();
                spawnCustomer(0, 300);
                const before = customers[0].x;
                for (let i = 0; i < 60; i++) step(dt);
                return customers[0].x === before;
            }, FRAME)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Shifts (levels)
    // -----------------------------------------------------------------------
    test.describe('shifts', () => {
        test('level 1 asks for a quota of customers', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { quota, expected: quotaFor(1) };
            });
            expect(s.quota).toBe(s.expected);
            expect(s.quota).toBeGreaterThan(0);
        });

        test('later shifts ask for more customers', async ({ page }) => {
            const s = await page.evaluate(() => ({ one: quotaFor(1), three: quotaFor(3) }));
            expect(s.three).toBeGreaterThan(s.one);
        });

        test('meeting the quota with a clear bar starts the next shift', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                served = quota - 1;
                spawned = quota;                       // this is the last customer of the shift
                player.lane = 0;
                spawnCustomer(0, BAR_RIGHT - 40);
                pour();
                for (let i = 0; i < 400; i++) step(dt);
                return { level, served };
            }, FRAME);
            expect(s.level).toBe(2);
            expect(s.served).toBe(0);
        });

        test('the shift does not turn over while an empty is still rolling', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                served = quota - 1;
                spawned = quota;                       // this is the last customer of the shift
                player.lane = 0;
                spawnCustomer(0, BAR_RIGHT - 40);
                pour();
                for (let i = 0; i < 400; i++) {
                    step(dt);
                    if (empties.length) return { level, empties: empties.length };
                }
                return { level, empties: 0 };
            }, FRAME);
            expect(s.empties).toBe(1);
            expect(s.level).toBe(1);
        });

        test('the HUD shows the current shift', async ({ page }) => {
            await page.evaluate(() => { startGame(); nextLevel(); });
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('a new shift starts with a clear bar', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                spawnCustomer(0, 300);
                empties.push({ lane: 0, x: 300 });
                nextLevel();
                return { customers: customers.length, empties: empties.length, mugs: mugs.length };
            });
            expect(s).toEqual({ customers: 0, empties: 0, mugs: 0 });
        });

        test('customers keep arriving during a shift', async ({ page }) => {
            expect(await page.evaluate((dt) => {
                startGame();
                for (let i = 0; i < 400; i++) step(dt);
                return customers.length;
            }, FRAME)).toBeGreaterThan(0);
        });

        test('a shift never spawns more customers than its quota', async ({ page }) => {
            const s = await page.evaluate((dt) => {
                startGame();
                lives = 99;
                for (let i = 0; i < 2000; i++) step(dt);
                return { spawned, quota, level };
            }, FRAME);
            if (s.level === 1) expect(s.spawned).toBeLessThanOrEqual(s.quota);
        });
    });

    // -----------------------------------------------------------------------
    // Score and high score
    // -----------------------------------------------------------------------
    test.describe('score', () => {
        test('the HUD shows the score', async ({ page }) => {
            await page.evaluate((dt) => {
                startGame();
                player.lane = 2;
                empties.push({ lane: 2, x: BAR_LEFT + 20 });
                for (let i = 0; i < 30; i++) step(dt);
            }, FRAME);
            await expect(page.locator('#score')).toHaveText(String(await page.evaluate(() => CATCH_POINTS)));
        });

        test('the high score is recorded when the game ends', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 900;
                endGame();
            });
            await expect(page.locator('#high')).toHaveText('900');
        });

        test('the high score persists to localStorage', async ({ page }) => {
            const stored = await page.evaluate(() => {
                startGame();
                score = 777;
                endGame();
                return window.localStorage.getItem('tapper-high');
            });
            expect(parseInt(stored, 10)).toBe(777);
        });

        test('a weaker game does not lower the high score', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-high', '5000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 10;
                endGame();
            });
            await expect(page.locator('#high')).toHaveText('5000');
        });
    });

    // -----------------------------------------------------------------------
    // Pause and restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the customers', async ({ page }) => {
            expect(await page.evaluate((dt) => {
                startGame();
                spawnCustomer(0, 300);
                togglePause();
                const before = customers[0].x;
                for (let i = 0; i < 30; i++) step(dt);
                return customers[0].x === before;
            }, FRAME)).toBe(true);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('resuming lets the customers walk again', async ({ page }) => {
            expect(await page.evaluate((dt) => {
                startGame();
                spawnCustomer(0, 300);
                togglePause();
                togglePause();
                const before = customers[0].x;
                for (let i = 0; i < 30; i++) step(dt);
                return customers[0].x < before;
            }, FRAME)).toBe(true);
        });

        test('the pause overlay explains how to resume', async ({ page }) => {
            await page.evaluate(() => { startGame(); togglePause(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });

        test('restarting resets the score, lives and shift', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 500;
                lives = 1;
                level = 4;
                endGame();
                startGame();
                return { score, lives, level, state, start: LIVES_START };
            });
            expect(s.score).toBe(0);
            expect(s.lives).toBe(s.start);
            expect(s.level).toBe(1);
            expect(s.state).toBe('running');
        });

        test('Space restarts after the game is over', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            expect(await page.evaluate(() => {
                startGame();
                spawnCustomer(0, 300);
                pour();
                empties.push({ lane: 2, x: 400 });
                draw();
                const ctx = document.getElementById('canvas').getContext('2d');
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
                return false;
            })).toBe(true);
        });

        test('drawing works in every state without throwing', async ({ page }) => {
            expect(await page.evaluate(() => {
                for (const s of ['idle', 'running', 'paused', 'over']) {
                    state = s;
                    draw();
                }
                return true;
            })).toBe(true);
        });
    });
});
