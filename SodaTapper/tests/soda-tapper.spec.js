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

        test('score, level, lives and best show their starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 720x440', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '440');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the counter is empty before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                customers: customers.length,
                mugs: mugs.length,
                empties: empties.length,
            }));
            expect(counts).toEqual({ customers: 0, mugs: 0, empties: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('soda-tapper-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });

        test('there are four lanes, ordered top to bottom', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: LANE_COUNT }, (_, i) => laneY(i)));
            expect(ys.length).toBe(4);
            for (let i = 1; i < ys.length; i++) {
                expect(ys[i]).toBeGreaterThan(ys[i - 1]);
            }
            expect(ys[ys.length - 1]).toBeLessThan(440);
            expect(ys[0]).toBeGreaterThan(0);
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

        test('game starts on level 1 with 3 lives and no score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, lives, score, state };
            });
            expect(s).toEqual({ level: 1, lives: 3, score: 0, state: 'running' });
        });

        test('the bartender starts in a valid lane', async ({ page }) => {
            const lane = await page.evaluate(() => { startGame(); return player.lane; });
            expect(lane).toBeGreaterThanOrEqual(0);
            expect(lane).toBeLessThan(4);
        });
    });

    // -----------------------------------------------------------------------
    // Bartender movement
    // -----------------------------------------------------------------------
    test.describe('bartender movement', () => {
        test('moving down increases the lane index', async ({ page }) => {
            const lane = await page.evaluate(() => {
                startGame();
                setLane(1);
                moveLane(1);
                return player.lane;
            });
            expect(lane).toBe(2);
        });

        test('moving up decreases the lane index', async ({ page }) => {
            const lane = await page.evaluate(() => {
                startGame();
                setLane(2);
                moveLane(-1);
                return player.lane;
            });
            expect(lane).toBe(1);
        });

        test('the bartender cannot move above the top lane', async ({ page }) => {
            const lane = await page.evaluate(() => {
                startGame();
                setLane(0);
                moveLane(-1);
                moveLane(-1);
                return player.lane;
            });
            expect(lane).toBe(0);
        });

        test('the bartender cannot move below the bottom lane', async ({ page }) => {
            const lane = await page.evaluate(() => {
                startGame();
                setLane(LANE_COUNT - 1);
                moveLane(1);
                moveLane(1);
                return player.lane;
            });
            expect(lane).toBe(3);
        });

        test('ArrowDown moves the bartender down a lane', async ({ page }) => {
            await page.evaluate(() => { startGame(); setLane(0); });
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('ArrowUp moves the bartender up a lane', async ({ page }) => {
            await page.evaluate(() => { startGame(); setLane(3); });
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(2);
        });

        test('W and S also move the bartender', async ({ page }) => {
            await page.evaluate(() => { startGame(); setLane(1); });
            await page.keyboard.press('s');
            expect(await page.evaluate(() => player.lane)).toBe(2);
            await page.keyboard.press('w');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring mugs
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test('pouring adds a mug in the bartender lane at the tap end', async ({ page }) => {
            const mug = await page.evaluate(() => {
                startGame();
                setLane(2);
                mugs.length = 0;
                pourMug();
                return { count: mugs.length, lane: mugs[0].lane, x: mugs[0].x };
            });
            expect(mug.count).toBe(1);
            expect(mug.lane).toBe(2);
            expect(mug.x).toBe(660);
        });

        test('mugs slide toward the doors', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                mugs.length = 0;
                spawnMug(0, 500);
                const before = mugs[0].x;
                for (let i = 0; i < 5; i++) step(0.016);
                return { before, after: mugs[0].x };
            });
            expect(after).toBeLessThan(before);
        });

        test('pouring is rate limited by a cooldown', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                mugs.length = 0;
                pourMug();
                pourMug();
                pourMug();
                return mugs.length;
            });
            expect(count).toBe(1);
        });

        test('the cooldown expires so another mug can be poured', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                mugs.length = 0;
                pourMug();
                for (let i = 0; i < 40; i++) step(0.016);
                pourMug();
                return mugs.length;
            });
            expect(count).toBe(2);
        });

        test('pourMug reports whether a mug was actually poured', async ({ page }) => {
            const results = await page.evaluate(() => {
                startGame();
                mugs.length = 0;
                return [pourMug(), pourMug()];
            });
            expect(results).toEqual([true, false]);
        });

        test('Space pours a mug while the game is running', async ({ page }) => {
            await page.evaluate(() => { startGame(); mugs.length = 0; });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('no mug can be poured while paused', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                mugs.length = 0;
                togglePause();
                pourMug();
                return mugs.length;
            });
            expect(count).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test('spawnCustomer places a customer in the given lane', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                spawnCustomer(3, 200);
                return { count: customers.length, lane: customers[0].lane, x: customers[0].x };
            });
            expect(c).toEqual({ count: 1, lane: 3, x: 200 });
        });

        test('customers walk toward the taps over time', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                spawnCustomer(0, 200);
                const before = customers[0].x;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: customers[0].x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('customers arrive automatically as time passes', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                for (let i = 0; i < 300; i++) step(0.016);
                return customers.length;
            });
            expect(count).toBeGreaterThan(0);
        });

        test('customers walk faster in later levels', async ({ page }) => {
            const { slow, fast } = await page.evaluate(() => {
                startGame();
                level = 1;
                const slow = customerSpeed();
                level = 5;
                const fast = customerSpeed();
                return { slow, fast };
            });
            expect(fast).toBeGreaterThan(slow);
        });

        test('customers arrive more often in later levels', async ({ page }) => {
            const { early, late } = await page.evaluate(() => {
                startGame();
                level = 1;
                const early = spawnInterval();
                level = 5;
                const late = spawnInterval();
                return { early, late };
            });
            expect(late).toBeLessThan(early);
        });

        test('a customer reaching the taps costs a life', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                spawnCustomer(1, BAR_RIGHT - 2);
                for (let i = 0; i < 20; i++) step(0.016);
                return { lives, customers: customers.length };
            });
            expect(result.lives).toBe(2);
            expect(result.customers).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('a mug that reaches a customer knocks them back and scores', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                mugs.length = 0;
                spawnCustomer(0, 400);
                spawnMug(0, 410);
                for (let i = 0; i < 5; i++) step(0.016);
                return { x: customers[0] && customers[0].x, mugs: mugs.length, score };
            });
            expect(result.mugs).toBe(0);
            expect(result.x).toBeLessThan(400);
            expect(result.score).toBeGreaterThan(0);
        });

        test('serving a customer sends an empty mug back', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                mugs.length = 0;
                empties.length = 0;
                spawnCustomer(2, 400);
                spawnMug(2, 410);
                for (let i = 0; i < 5; i++) step(0.016);
                return { count: empties.length, lane: empties[0] && empties[0].lane };
            });
            expect(result.count).toBe(1);
            expect(result.lane).toBe(2);
        });

        test('a mug only serves a customer in its own lane', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                mugs.length = 0;
                spawnCustomer(0, 400);
                spawnMug(1, 410);
                for (let i = 0; i < 5; i++) step(0.016);
                return { customerX: customers[0].x, mugs: mugs.length };
            });
            expect(result.mugs).toBe(1);
            expect(result.customerX).toBeGreaterThan(400);
        });

        test('a customer knocked back to the doors leaves satisfied', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                mugs.length = 0;
                score = 0;
                spawnCustomer(0, BAR_LEFT + 5);
                spawnMug(0, BAR_LEFT + 15);
                for (let i = 0; i < 5; i++) step(0.016);
                return { customers: customers.length, score };
            });
            expect(result.customers).toBe(0);
            expect(result.score).toBe(60); // POINTS_HIT + POINTS_SERVED
        });

        test('a customer far from the doors needs more than one mug', async ({ page }) => {
            const remaining = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                mugs.length = 0;
                spawnCustomer(0, BAR_RIGHT - 20);
                spawnMug(0, BAR_RIGHT - 10);
                for (let i = 0; i < 3; i++) step(0.016);
                return customers.length;
            });
            expect(remaining).toBe(1);
        });

        test('a mug serves the rightmost customer it overlaps', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                mugs.length = 0;
                spawnCustomer(0, 300);
                spawnCustomer(0, 310);
                spawnMug(0, 320);
                for (let i = 0; i < 3; i++) step(0.016);
                // the customer that started at 310 should have been knocked back
                const xs = customers.map((c) => c.x).sort((a, b) => a - b);
                return xs;
            });
            expect(result[0]).toBeLessThan(300);
            // the left-hand customer was untouched — only its own walking moved it
            expect(result[1]).toBeGreaterThanOrEqual(300);
            expect(result[1]).toBeLessThan(305);
        });

        test('a mug that reaches the doors untouched costs a life', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                mugs.length = 0;
                spawnMug(0, BAR_LEFT + 5);
                for (let i = 0; i < 10; i++) step(0.016);
                return { lives, mugs: mugs.length };
            });
            expect(result.lives).toBe(2);
            expect(result.mugs).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test('empties slide back toward the taps', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                empties.length = 0;
                spawnEmpty(0, 200);
                const before = empties[0].x;
                for (let i = 0; i < 5; i++) step(0.016);
                return { before, after: empties[0].x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('an empty caught in the bartender lane scores', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                empties.length = 0;
                score = 0;
                setLane(1);
                spawnEmpty(1, BAR_RIGHT - 5);
                for (let i = 0; i < 10; i++) step(0.016);
                return { empties: empties.length, score, lives };
            });
            expect(result.empties).toBe(0);
            expect(result.score).toBe(25);
            expect(result.lives).toBe(3);
        });

        test('an empty missed in another lane costs a life', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                empties.length = 0;
                setLane(0);
                spawnEmpty(3, BAR_RIGHT - 5);
                for (let i = 0; i < 10; i++) step(0.016);
                return { empties: empties.length, lives };
            });
            expect(result.empties).toBe(0);
            expect(result.lives).toBe(2);
        });

        test('empties slide slower than fresh mugs', async ({ page }) => {
            const slower = await page.evaluate(() => EMPTY_SPEED < MUG_SPEED);
            expect(slower).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Lives & game over
    // -----------------------------------------------------------------------
    test.describe('lives', () => {
        test('losing a life clears mugs and empties but not customers', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                mugs.length = 0;
                empties.length = 0;
                spawnCustomer(0, 200);
                spawnMug(1, 400);
                spawnEmpty(2, 300);
                loseLife();
                return { customers: customers.length, mugs: mugs.length, empties: empties.length };
            });
            expect(result).toEqual({ customers: 1, mugs: 0, empties: 0 });
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

        test('the simulation stops advancing once the game is over', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                customers.length = 0;
                spawnCustomer(0, 200);
                const before = customers[0].x;
                endGame();
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: customers[0].x };
            });
            expect(after).toBe(before);
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('the lives HUD reflects a lost life', async ({ page }) => {
            await page.evaluate(() => { startGame(); loseLife(); });
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('later levels send more customers through the doors', async ({ page }) => {
            const { early, late } = await page.evaluate(() => {
                startGame();
                level = 1;
                const early = customersForLevel();
                level = 4;
                const late = customersForLevel();
                return { early, late };
            });
            expect(late).toBeGreaterThan(early);
        });

        test('clearing the counter after every customer spawned advances the level', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                spawnedThisLevel = customersForLevel();
                customers.length = 0;
                step(0.016);
                return { level, spawned: spawnedThisLevel };
            });
            expect(result.level).toBe(2);
            expect(result.spawned).toBe(0);
        });

        test('clearing a level awards a bonus', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                score = 0;
                level = 2;
                spawnedThisLevel = customersForLevel();
                customers.length = 0;
                step(0.016);
                return score;
            });
            expect(score).toBe(200); // POINTS_LEVEL * level
        });

        test('clearing a level restores a life up to the cap', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                lives = 2;
                spawnedThisLevel = customersForLevel();
                customers.length = 0;
                step(0.016);
                return lives;
            });
            expect(lives).toBe(3);
        });

        test('lives never exceed the maximum', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                lives = MAX_LIVES;
                spawnedThisLevel = customersForLevel();
                customers.length = 0;
                step(0.016);
                return { lives, max: MAX_LIVES };
            });
            expect(result.lives).toBe(result.max);
        });

        test('a level does not end while customers are still at the counter', async ({ page }) => {
            const level = await page.evaluate(() => {
                startGame();
                spawnedThisLevel = customersForLevel();
                customers.length = 0;
                spawnCustomer(0, 200);
                step(0.016);
                return level;
            });
            expect(level).toBe(1);
        });

        test('no more customers spawn once the level quota is reached', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                spawnedThisLevel = customersForLevel();
                customers.length = 0;
                spawnCustomer(0, 100); // keeps the level alive
                for (let i = 0; i < 400; i++) step(0.016);
                return customers.length;
            });
            expect(count).toBeLessThanOrEqual(1);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 780;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('780');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 640;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('soda-tapper-best'));
            expect(parseInt(stored, 10)).toBe(640);
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

        test('the score HUD tracks the score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                customers.length = 0;
                mugs.length = 0;
                score = 0;
                spawnCustomer(0, BAR_LEFT + 5);
                spawnMug(0, BAR_LEFT + 15);
                for (let i = 0; i < 5; i++) step(0.016);
            });
            await expect(page.locator('#score')).toHaveText('60');
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
                spawnCustomer(0, 200);
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
                spawnCustomer(0, 200);
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

        test('restart after game over resets everything', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                score = 999;
                level = 6;
                lives = 1;
                spawnCustomer(0, 300);
                spawnMug(1, 300);
                spawnEmpty(2, 300);
                endGame();
                startGame();
                return {
                    score, level, lives, state,
                    customers: customers.length,
                    mugs: mugs.length,
                    empties: empties.length,
                };
            });
            expect(result).toEqual({
                score: 0, level: 1, lives: 3, state: 'running',
                customers: 0, mugs: 0, empties: 0,
            });
        });
    });

    // -----------------------------------------------------------------------
    // Full-game smoke test
    // -----------------------------------------------------------------------
    test.describe('smoke', () => {
        test('a long unattended run ends the game without throwing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            const finalState = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 3000 && state === 'running'; i++) step(0.016);
                return state;
            });
            expect(errors).toEqual([]);
            expect(finalState).toBe('over');
        });

        test('an autoplaying bartender can serve customers and score', async ({ page }) => {
            const run = await page.evaluate(() => {
                startGame();
                let frames = 0;
                for (let i = 0; i < 3000 && state === 'running'; i++) {
                    // greedily chase whatever is most urgent: an inbound empty,
                    // otherwise the customer closest to the taps whose lane does
                    // not already have a mug on the way.
                    const empty = empties.slice().sort((a, b) => b.x - a.x)[0];
                    const customer = customers
                        .filter((c) => !mugs.some((m) => m.lane === c.lane))
                        .sort((a, b) => b.x - a.x)[0];
                    if (empty && empty.x > BAR_RIGHT - 140) setLane(empty.lane);
                    else if (customer) { setLane(customer.lane); pourMug(); }
                    step(0.016);
                    frames++;
                }
                return { frames, score, level };
            });
            expect(run.frames).toBeGreaterThan(600);
            expect(run.score).toBeGreaterThan(200);
        });

        test('the canvas actually draws something', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                spawnCustomer(0, 300);
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, 720, 440).data;
                let distinct = new Set();
                for (let i = 0; i < data.length; i += 4 * 97) {
                    distinct.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return distinct.size;
            });
            expect(painted).toBeGreaterThan(2);
        });
    });
});
