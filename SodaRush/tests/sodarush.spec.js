const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Nearly every spec is about one lane at a time, so the automatic customer
// stream and the requestAnimationFrame loop are both switched off: the spec
// places exactly the customers and mugs it cares about and owns the clock.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        autoSpawn = false;
        autoStep = false;
        customers.length = 0;
        mugs.length = 0;
    });

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

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas matches the declared size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
            expect(await page.evaluate(() => [CANVAS_W, CANVAS_H])).toEqual([720, 480]);
        });

        test('counter runs between the serving end and the drop-off end', async ({ page }) => {
            expect(await page.evaluate(() => [LANES, BAR_LEFT, BAR_RIGHT])).toEqual([4, 70, 640]);
            expect(await page.evaluate(() => LANE_Y.length)).toBe(4);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the starting score, lives and level', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodarush-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('no customers or mugs before starting', async ({ page }) => {
            expect(await page.evaluate(() => [customers.length, mugs.length])).toEqual([0, 0]);
        });

        test('step() does nothing while idle', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0));
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeCloseTo(before, 5);
        });

        test('serving is ignored while idle', async ({ page }) => {
            expect(await page.evaluate(() => serveSoda())).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('overlay is hidden once playing', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a fresh game starts with three lives, no score and level 1', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => [lives, score, level])).toEqual([3, 0, 1]);
        });

        test('the server starts in the top lane', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => server.lane)).toBe(0);
        });

        test('the wave goal is shown in the HUD', async ({ page }) => {
            await startQuiet(page);
            const waveGoal = await page.evaluate(() => goal);
            await expect(page.locator('#served')).toHaveText(`0 / ${waveGoal}`);
        });

        test('restarting after a game over clears the previous score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => [state, score, lives])).toEqual(['playing', 0, 3]);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between lanes
    // -----------------------------------------------------------------------
    test.describe('lane movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowDown moves the server down one lane', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => server.lane)).toBe(1);
        });

        test('ArrowUp moves the server up one lane', async ({ page }) => {
            await page.evaluate(() => setLane(2));
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => server.lane)).toBe(1);
        });

        test('W and S also change lanes', async ({ page }) => {
            await page.keyboard.press('s');
            expect(await page.evaluate(() => server.lane)).toBe(1);
            await page.keyboard.press('w');
            expect(await page.evaluate(() => server.lane)).toBe(0);
        });

        test('the server cannot move above the top lane', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => server.lane)).toBe(0);
        });

        test('the server cannot move below the bottom lane', async ({ page }) => {
            const bottom = await page.evaluate(() => setLane(LANES - 1));
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => server.lane)).toBe(bottom);
        });

        test('lane changes are ignored while idle', async ({ page }) => {
            await page.evaluate(() => {
                state = 'idle';
                setLane(0);
            });
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => server.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring and sliding sodas
    // -----------------------------------------------------------------------
    test.describe('serving sodas', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space pours a soda into the server lane', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.length)).toBe(1);
            expect(await page.evaluate(() => mugs[0].lane)).toBe(0);
        });

        test('a poured soda starts at the serving end of the counter', async ({ page }) => {
            await page.evaluate(() => serveSoda());
            expect(await page.evaluate(() => mugs[0].x)).toBeCloseTo(640, 5);
        });

        test('a poured soda is full and slides towards the customers', async ({ page }) => {
            await page.evaluate(() => serveSoda());
            expect(await page.evaluate(() => mugs[0].empty)).toBe(false);
            expect(await page.evaluate(() => mugs[0].vx)).toBeLessThan(0);
        });

        test('a soda is poured into whichever lane the server stands in', async ({ page }) => {
            await page.evaluate(() => {
                setLane(2);
                serveSoda();
            });
            expect(await page.evaluate(() => mugs[0].lane)).toBe(2);
        });

        test('a sliding soda moves left over time', async ({ page }) => {
            await page.evaluate(() => serveSoda());
            await advance(page, 30);
            const [x, speed] = await page.evaluate(() => [mugs[0].x, MUG_SPEED]);
            expect(x).toBeLessThan(640);
            expect(x).toBeCloseTo(640 - speed * 0.5, 0);
        });

        test('a soda nobody catches falls off the end and costs a life', async ({ page }) => {
            await page.evaluate(() => serveSoda());
            await advance(page, 300);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('several sodas can be in flight at once', async ({ page }) => {
            await page.evaluate(() => {
                serveSoda();
                setLane(1);
                serveSoda();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a spawned customer starts at the far end of its lane', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(1));
            expect(await page.evaluate(() => customers[0].lane)).toBe(1);
            expect(await page.evaluate(() => customers[0].x)).toBeCloseTo(70, 5);
        });

        test('a customer starts out advancing and thirsty', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0));
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
            expect(await page.evaluate(() => customers[0].thirst)).toBeGreaterThan(0);
        });

        test('a customer walks towards the server', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0));
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeGreaterThan(70);
        });

        test('customers walk faster on later levels', async ({ page }) => {
            const speed = (lvl) =>
                page.evaluate((l) => {
                    level = l;
                    customers.length = 0;
                    spawnCustomer(0);
                    return customers[0].speed;
                }, lvl);
            expect(await speed(4)).toBeGreaterThan(await speed(1));
        });

        test('a customer reaching the server costs a life', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = CUSTOMER_LIMIT - 1;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });

        test('losing a life clears the counter', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(1);
                spawnCustomer(2);
                customers[0].x = CUSTOMER_LIMIT - 1;
                serveSoda(); // a soda in lane 0, clear of both customers
            });
            await advance(page, 10);
            expect(await page.evaluate(() => [customers.length, mugs.length])).toEqual([0, 0]);
        });

        test('automatic spawning fills the counter while playing', async ({ page }) => {
            await page.evaluate(() => {
                autoSpawn = true;
                spawnTimer = 0;
            });
            await advance(page, 5);
            expect(await page.evaluate(() => customers.length)).toBeGreaterThan(0);
        });

        test('a lane never holds more than the per-lane limit', async ({ page }) => {
            const [count, limit] = await page.evaluate(() => {
                for (let i = 0; i < 10; i++) spawnCustomer(0);
                return [customers.length, MAX_PER_LANE];
            });
            expect(limit).toBeGreaterThan(0);
            expect(count).toBe(limit);
        });
    });

    // -----------------------------------------------------------------------
    // Catching sodas and scoring
    // -----------------------------------------------------------------------
    test.describe('serving customers', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a customer catches a soda that reaches them', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                serveSoda();
            });
            await advance(page, 80);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => customers[0].thirst)).toBe(0);
        });

        test('a served customer is pushed back down the counter', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                serveSoda();
            });
            await advance(page, 80);
            expect(await page.evaluate(() => customers[0].x)).toBeLessThan(300);
        });

        test('a satisfied customer heads back to the far end', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                customers[0].thirst = 1;
                serveSoda();
            });
            await advance(page, 80);
            expect(await page.evaluate(() => customers[0].state)).toBe('retreating');
        });

        test('a customer needing two sodas keeps advancing after the first', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                customers[0].thirst = 2;
                serveSoda();
            });
            await advance(page, 80);
            expect(await page.evaluate(() => customers[0].thirst)).toBe(1);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
        });

        test('a soda only reaches customers in its own lane', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(1);
                customers[0].x = 300;
                serveSoda(); // server is in lane 0
            });
            // The soda slides past the lane-1 customer without being caught ...
            await advance(page, 90);
            expect(await page.evaluate(() => customers[0].thirst)).toBeGreaterThan(0);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
            // ... and then drops off the far end, which costs a life.
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a retreating customer leaving the counter scores points', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = BAR_LEFT + 5;
                customers[0].state = 'retreating';
            });
            await advance(page, 60);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
            expect(await page.evaluate(() => served)).toBe(1);
        });

        test('a departing customer leaves an empty mug rolling back', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = BAR_LEFT + 5;
                customers[0].state = 'retreating';
            });
            await advance(page, 60);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
            expect(await page.evaluate(() => mugs[0].empty)).toBe(true);
            expect(await page.evaluate(() => mugs[0].vx)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs coming back
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty mug rolls towards the server', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(0, BAR_LEFT));
            await advance(page, 30);
            expect(await page.evaluate(() => mugs[0].x)).toBeGreaterThan(70);
        });

        test('catching an empty mug scores points', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(0, BAR_RIGHT - 10));
            await advance(page, 30);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => CATCH_POINTS));
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an empty mug in another lane smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => {
                setLane(0);
                spawnEmpty(3, BAR_RIGHT - 10);
            });
            await advance(page, 30);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('empty mugs pass straight through customers', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                spawnEmpty(0, 200);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].thirst)).toBeGreaterThan(0);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('the server can switch lanes to meet a returning mug', async ({ page }) => {
            await page.evaluate(() => {
                setLane(0);
                spawnEmpty(2, BAR_RIGHT - 120);
                setLane(2);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the HUD tracks lost lives', async ({ page }) => {
            await page.evaluate(() => loseLife());
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the game ends when the last life is lost', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => state)).toBe('over');
            expect(await page.evaluate(() => lives)).toBe(0);
        });

        test('the overlay reports the final score', async ({ page }) => {
            await page.evaluate(() => {
                score = 1234;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('the best score is kept in localStorage', async ({ page }) => {
            await page.evaluate(() => {
                score = 2500;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#best')).toHaveText('2500');
            expect(await page.evaluate(() => localStorage.getItem('sodarush-best'))).toBe('2500');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => {
                best = 9000;
                score = 10;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('step() does nothing once the game is over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife();
                spawnCustomer(0);
            });
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeCloseTo(before, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the overlay shows while paused', async ({ page }) => {
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                togglePause();
            });
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeCloseTo(before, 5);
        });

        test('serving is ignored while paused', async ({ page }) => {
            await page.evaluate(() => togglePause());
            expect(await page.evaluate(() => serveSoda())).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('Space resumes a paused game without pouring', async ({ page }) => {
            await page.evaluate(() => togglePause());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Waves and levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('clearing the wave goal advances the level', async ({ page }) => {
            await page.evaluate(() => {
                served = goal;
                spawned = goal;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('the level only advances once the counter is clear', async ({ page }) => {
            await page.evaluate(() => {
                served = goal;
                spawned = goal;
                spawnCustomer(0);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('a new level resets the served counter and raises the goal', async ({ page }) => {
            const firstGoal = await page.evaluate(() => goal);
            await page.evaluate(() => {
                served = goal;
                spawned = goal;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => served)).toBe(0);
            expect(await page.evaluate(() => goal)).toBeGreaterThan(firstGoal);
        });

        test('no more customers spawn than the wave needs', async ({ page }) => {
            await page.evaluate(() => {
                autoSpawn = true;
                spawned = goal;
                spawnTimer = 0;
            });
            await advance(page, 80);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });

        test('losing a life lets the wave re-send its unserved customers', async ({ page }) => {
            await page.evaluate(() => {
                spawned = 4;
                served = 1;
                loseLife();
            });
            expect(await page.evaluate(() => spawned)).toBe(1);
        });

        test('the HUD shows wave progress', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = BAR_LEFT + 2;
                customers[0].state = 'retreating';
            });
            await advance(page, 30);
            const waveGoal = await page.evaluate(() => goal);
            await expect(page.locator('#served')).toHaveText(`1 / ${waveGoal}`);
        });
    });

    // -----------------------------------------------------------------------
    // A whole wave, start to finish
    // -----------------------------------------------------------------------
    test.describe('playing a wave', () => {
        test('a full wave can be served and cleared without losing a life', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoStep = false;
                autoSpawn = false;
                customers.length = 0;
                mugs.length = 0;

                const run = (seconds) => {
                    for (let i = 0; i < Math.round(seconds * 60); i++) step(1 / 60);
                };

                // Serve the wave one customer at a time down the top counter:
                // pour until they have had enough, then let them walk out and
                // catch the empty they shove back. `goal` is read up front
                // because clearing the wave resets it for the next level.
                const target = goal;
                for (let i = 0; i < target && lives === 3; i++) {
                    const c = spawnCustomer(0);
                    setLane(0);
                    while (c.thirst > 0 && lives === 3) {
                        serveSoda();
                        run(2.5);
                    }
                    run(12);
                }
                return { level, lives, score, served, customers: customers.length, mugs: mugs.length };
            });

            // The wave cleared, so the level ticked over and the counters are empty.
            expect(result.lives).toBe(3);
            expect(result.level).toBe(2);
            expect(result.served).toBe(0); // reset by the new wave
            expect(result.customers).toBe(0);
            expect(result.mugs).toBe(0);
            // Six customers served plus six empties caught.
            expect(result.score).toBe(6 * 100 + 6 * 50);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('draw() runs without throwing while idle', async ({ page }) => {
            expect(await page.evaluate(() => { draw(); return true; })).toBe(true);
        });

        test('draw() runs with a full counter', async ({ page }) => {
            await startQuiet(page);
            expect(
                await page.evaluate(() => {
                    for (let l = 0; l < LANES; l++) {
                        spawnCustomer(l);
                        spawnEmpty(l, 200);
                    }
                    serveSoda();
                    draw();
                    return true;
                })
            ).toBe(true);
        });

        test('the canvas paints something', async ({ page }) => {
            const painted = await page.evaluate(() => {
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });
    });
});
