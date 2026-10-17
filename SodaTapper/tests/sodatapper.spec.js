const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Most specs are about one entity at a time, so the bar is emptied and the
// wave's spawn clock pushed out of reach; the wave specs drive spawning
// themselves. Switching `autoStep` off stops the requestAnimationFrame loop
// from advancing the simulation behind the spec's back, leaving time entirely
// under test control.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
        customers.length = 0;
        mugs.length = 0;
        empties.length = 0;
        spawnTimer = 9999;
        bannerTimer = 0;
        serveTimer = 0;
    });

// Chromium can acknowledge a synthetic key event before the page listener has
// run, so key presses are confirmed against the game state before the
// simulation is advanced.
const pressAndSettle = async (page, key, check) => {
    await page.keyboard.press(key);
    await page.waitForFunction(check);
};

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

        test('canvas matches the bar size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('four counters span the canvas', async ({ page }) => {
            expect(await page.evaluate(() => [LANES, LANE_H, LANE_TOP])).toEqual([4, 96, 48]);
            expect(await page.evaluate(() => LANE_TOP + LANE_H * LANES)).toBeLessThanOrEqual(480);
        });

        test('laneY returns the centre line of each counter', async ({ page }) => {
            expect(await page.evaluate(() => [0, 1, 2, 3].map(laneY))).toEqual([96, 192, 288, 384]);
        });

        test('counter ends sit inside the canvas', async ({ page }) => {
            const [left, right] = await page.evaluate(() => [COUNTER_LEFT, COUNTER_RIGHT]);
            expect(left).toBeGreaterThan(0);
            expect(right).toBeLessThan(720);
            expect(right).toBeGreaterThan(left);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the bar is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => [customers.length, mugs.length, empties.length]))
                .toEqual([0, 0, 0]);
        });

        test('HUD shows the starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#served')).toHaveText('0');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('sodatapper-best', '1234'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('stepping does nothing while idle', async ({ page }) => {
            await page.evaluate(() => {
                autoStep = false;
                spawnCustomer(0);
            });
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a shift
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await pressAndSettle(page, 'Space', () => state === 'playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('starting resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                level = 7;
                served = 5;
                startGame();
            });
            expect(await page.evaluate(() => [score, lives, level, served]))
                .toEqual([0, 3, 1, 0]);
        });

        test('the bartender starts at the top counter', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => bartenderLane)).toBe(0);
        });

        test('a new shift opens with a banner pause before anyone walks in', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            expect(await page.evaluate(() => bannerTimer)).toBeGreaterThan(0);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between counters
    // -----------------------------------------------------------------------
    test.describe('bartender movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowDown moves down one counter', async ({ page }) => {
            await pressAndSettle(page, 'ArrowDown', () => bartenderLane === 1);
        });

        test('ArrowUp moves back up', async ({ page }) => {
            await pressAndSettle(page, 'ArrowDown', () => bartenderLane === 1);
            await pressAndSettle(page, 'ArrowUp', () => bartenderLane === 0);
        });

        test('S and W also move the bartender', async ({ page }) => {
            await pressAndSettle(page, 'KeyS', () => bartenderLane === 1);
            await pressAndSettle(page, 'KeyW', () => bartenderLane === 0);
        });

        test('the bartender cannot climb above the top counter', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await page.waitForTimeout(50);
            expect(await page.evaluate(() => bartenderLane)).toBe(0);
        });

        test('the bartender cannot walk past the bottom counter', async ({ page }) => {
            for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(50);
            const lanes = await page.evaluate(() => LANES);
            expect(await page.evaluate(() => bartenderLane)).toBe(lanes - 1);
        });

        test('the bartender does not move while idle', async ({ page }) => {
            await page.evaluate(() => {
                state = 'idle';
                bartenderLane = 0;
            });
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(50);
            expect(await page.evaluate(() => bartenderLane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space pours a drink down the current counter', async ({ page }) => {
            await pressAndSettle(page, 'Space', () => mugs.length === 1);
            expect(await page.evaluate(() => mugs[0].lane)).toBe(0);
        });

        test('a drink starts at the tap end', async ({ page }) => {
            await page.evaluate(() => serve());
            expect(await page.evaluate(() => mugs[0].x)).toBe(await page.evaluate(() => COUNTER_RIGHT));
        });

        test('drinks are poured into the counter the bartender is at', async ({ page }) => {
            await page.evaluate(() => {
                bartenderLane = 2;
                serve();
            });
            expect(await page.evaluate(() => mugs[0].lane)).toBe(2);
        });

        test('a drink slides towards the far end', async ({ page }) => {
            await page.evaluate(() => serve());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeLessThan(before);
            expect(before - after).toBeCloseTo(await page.evaluate(() => MUG_SPEED * 0.5), 0);
        });

        test('the tap has a cooldown between drinks', async ({ page }) => {
            await page.evaluate(() => {
                serve();
                serve();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('the tap recovers after the cooldown', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 20);
            await page.evaluate(() => serve());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('no drinks are poured while paused', async ({ page }) => {
            await page.evaluate(() => {
                state = 'paused';
                serve();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('no drinks are poured before the game starts', async ({ page }) => {
            await page.evaluate(() => {
                state = 'idle';
                serve();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a customer enters at the far end of the counter', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(1));
            const left = await page.evaluate(() => COUNTER_LEFT);
            expect(await page.evaluate(() => [customers[0].lane, customers[0].x]))
                .toEqual([1, left]);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
        });

        test('a customer walks towards the taps', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0));
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            const after = await page.evaluate(() => customers[0].x);
            expect(after).toBeGreaterThan(before);
            expect(after - before).toBeCloseTo(await page.evaluate(() => customerSpeed), 0);
        });

        test('a customer that reaches the taps costs a life', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = COUNTER_RIGHT - 1;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('losing a life clears the bar', async ({ page }) => {
            // The drink goes down counter 3 so it cannot be snatched by the
            // customer who is about to reach the taps on counter 0.
            await page.evaluate(() => {
                spawnCustomer(0);
                spawnCustomer(3);
                bartenderLane = 3;
                serve();
                customers[0].x = COUNTER_RIGHT - 1;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => [customers.length, mugs.length, empties.length]))
                .toEqual([0, 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Serving customers
    // -----------------------------------------------------------------------
    test.describe('catching a drink', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a drink that reaches a customer is caught', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 90);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('catching a drink scores', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 90);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => SERVE_POINTS));
        });

        test('a served customer slides back towards the door', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 70);
            expect(await page.evaluate(() => customers[0].state)).toBe('sliding');
            const x = await page.evaluate(() => customers[0].x);
            expect(x).toBeLessThan(400);
        });

        test('the push-back is a fixed distance', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 400;
                customerSpeed = 0;
                serve();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
            const x = await page.evaluate(() => customers[0].x);
            const push = await page.evaluate(() => PUSH_DIST);
            expect(x).toBeCloseTo(400 - push, 0);
        });

        test('a served customer hands back an empty glass', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 90);
            expect(await page.evaluate(() => empties.length)).toBe(1);
            expect(await page.evaluate(() => empties[0].lane)).toBe(0);
        });

        test('a drink only reaches customers in its own counter', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(2);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 100);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
            expect(await page.evaluate(() => mugs.length)).toBe(1);
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThan(400);
        });

        test('a drink is taken by the customer nearest the taps', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                spawnCustomer(0);
                customers[0].x = 200;
                customers[1].x = 500;
                serve();
            });
            await advance(page, 40);
            expect(await page.evaluate(() => customers[1].state)).toBe('sliding');
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
        });

        test('a drink nobody catches smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 240);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a customer pushed out of the door leaves satisfied', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = COUNTER_LEFT + 20;
                serve();
            });
            await advance(page, 200);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => served)).toBe(1);
            expect(await page.evaluate(() => score))
                .toBe(await page.evaluate(() => SERVE_POINTS + EXIT_POINTS));
        });

        test('a customer leaving does not cost a life', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = COUNTER_LEFT + 20;
                serve();
            });
            await advance(page, 200);
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Empty glasses
    // -----------------------------------------------------------------------
    test.describe('empty glasses', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty slides back towards the taps', async ({ page }) => {
            await page.evaluate(() => empties.push({ lane: 0, x: 300 }));
            await advance(page, 30);
            const x = await page.evaluate(() => empties[0].x);
            expect(x).toBeCloseTo(300 + (await page.evaluate(() => EMPTY_SPEED)) * 0.5, 0);
        });

        test('an empty is caught when the bartender is at that counter', async ({ page }) => {
            await page.evaluate(() => {
                bartenderLane = 1;
                empties.push({ lane: 1, x: COUNTER_RIGHT - 20 });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => EMPTY_POINTS));
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an empty that nobody catches smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => {
                bartenderLane = 0;
                empties.push({ lane: 2, x: COUNTER_RIGHT - 20 });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('empties pass customers without disturbing them', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                empties.push({ lane: 0, x: 200 });
            });
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
            expect(await page.evaluate(() => empties.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the game ends when the last life is lost', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                spawnCustomer(0);
                customers[0].x = COUNTER_RIGHT - 1;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => state)).toBe('gameover');
            expect(await page.evaluate(() => lives)).toBe(0);
        });

        test('game over shows the overlay with the score', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                score = 420;
                spawnCustomer(0);
                customers[0].x = COUNTER_RIGHT - 1;
            });
            await advance(page, 10);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
            await expect(page.locator('#overlay-score')).toContainText('420');
        });

        test('the best score is kept', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                score = 777;
                spawnCustomer(0);
                customers[0].x = COUNTER_RIGHT - 1;
            });
            await advance(page, 10);
            await expect(page.locator('#best')).toHaveText('777');
            expect(await page.evaluate(() => localStorage.getItem('sodatapper-best'))).toBe('777');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('sodatapper-best', '5000'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                score = 10;
                spawnCustomer(0);
                customers[0].x = COUNTER_RIGHT - 1;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => localStorage.getItem('sodatapper-best'))).toBe('5000');
        });

        test('Space restarts after game over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                spawnCustomer(0);
                customers[0].x = COUNTER_RIGHT - 1;
            });
            await advance(page, 10);
            await pressAndSettle(page, 'Space', () => state === 'playing');
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('the simulation stops once the game is over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                spawnCustomer(0);
                customers[0].x = COUNTER_RIGHT - 1;
            });
            await advance(page, 10);
            await page.evaluate(() => spawnCustomer(0));
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the first wave has a fixed size', async ({ page }) => {
            expect(await page.evaluate(() => waveSize))
                .toBe(await page.evaluate(() => WAVE_BASE));
        });

        test('customers arrive on the spawn clock', async ({ page }) => {
            await page.evaluate(() => {
                spawnTimer = 0.01;
                bannerTimer = 0;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => customers.length)).toBe(1);
            expect(await page.evaluate(() => spawned)).toBe(1);
            expect(await page.evaluate(() => spawnTimer)).toBeGreaterThan(0);
        });

        test('nobody arrives during the between-waves banner', async ({ page }) => {
            await page.evaluate(() => {
                spawnTimer = 0.01;
                bannerTimer = 2;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });

        test('the wave stops spawning once everyone has arrived', async ({ page }) => {
            await page.evaluate(() => {
                waveSize = 2;
                spawned = 2;
                spawnTimer = 0.01;
                bannerTimer = 0;
                spawnCustomer(0);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => customers.length)).toBe(1);
        });

        test('clearing a wave advances the level', async ({ page }) => {
            await page.evaluate(() => {
                waveSize = 1;
                spawned = 1;
            });
            await advance(page, 1);
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('clearing a wave pays a bonus', async ({ page }) => {
            await page.evaluate(() => {
                waveSize = 1;
                spawned = 1;
                score = 0;
            });
            await advance(page, 1);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => LEVEL_BONUS));
        });

        test('a wave is not clear while a drink is still sliding', async ({ page }) => {
            await page.evaluate(() => {
                waveSize = 1;
                spawned = 1;
                serve();
            });
            await advance(page, 1);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('a wave is not clear while an empty is still sliding', async ({ page }) => {
            await page.evaluate(() => {
                waveSize = 1;
                spawned = 1;
                empties.push({ lane: 0, x: 200 });
            });
            await advance(page, 1);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('later waves are bigger and faster', async ({ page }) => {
            const speed1 = await page.evaluate(() => customerSpeed);
            await page.evaluate(() => {
                waveSize = 1;
                spawned = 1;
            });
            await advance(page, 1);
            expect(await page.evaluate(() => waveSize))
                .toBe(await page.evaluate(() => WAVE_BASE + WAVE_STEP));
            expect(await page.evaluate(() => customerSpeed)).toBeGreaterThan(speed1);
            expect(await page.evaluate(() => spawned)).toBe(0);
        });

        test('a new wave opens with the banner', async ({ page }) => {
            await page.evaluate(() => {
                waveSize = 1;
                spawned = 1;
            });
            await advance(page, 1);
            expect(await page.evaluate(() => bannerTimer)).toBeGreaterThan(0);
        });

        test('the spawn interval has a floor', async ({ page }) => {
            const floor = await page.evaluate(() => SPAWN_MIN);
            const interval = await page.evaluate(() => spawnIntervalFor(50));
            expect(interval).toBe(floor);
        });

        test('lane choice is reproducible from a seed', async ({ page }) => {
            const run = () =>
                page.evaluate(() => {
                    setSeed(7);
                    customers.length = 0;
                    const lanes = [];
                    for (let i = 0; i < 8; i++) {
                        spawnNextCustomer();
                        lanes.push(customers[customers.length - 1].lane);
                    }
                    return lanes;
                });
            const first = await run();
            const second = await run();
            expect(second).toEqual(first);
            expect(new Set(first).size).toBeGreaterThan(1);
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
            await pressAndSettle(page, 'KeyP', () => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0));
            await pressAndSettle(page, 'KeyP', () => state === 'paused');
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });

        test('P resumes the game', async ({ page }) => {
            await pressAndSettle(page, 'KeyP', () => state === 'paused');
            await pressAndSettle(page, 'KeyP', () => state === 'playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('pause does nothing before the game starts', async ({ page }) => {
            await page.evaluate(() => {
                state = 'idle';
            });
            await page.keyboard.press('KeyP');
            await page.waitForTimeout(50);
            expect(await page.evaluate(() => state)).toBe('idle');
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
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 90);
            await expect(page.locator('#score')).toHaveText(String(await page.evaluate(() => SERVE_POINTS)));
        });

        test('the lives readout follows the lives', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = COUNTER_RIGHT - 1;
            });
            await advance(page, 10);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the level readout follows the level', async ({ page }) => {
            await page.evaluate(() => {
                waveSize = 1;
                spawned = 1;
            });
            await advance(page, 1);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the served readout counts satisfied customers', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = COUNTER_LEFT + 20;
                serve();
            });
            await advance(page, 200);
            await expect(page.locator('#served')).toHaveText('1');
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
                draw();
            });
            const painted = await page.evaluate(() => {
                const ctx = canvas.getContext('2d');
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] || data[i + 1] || data[i + 2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('drawing never throws in any state', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (const s of ['idle', 'playing', 'paused', 'gameover']) {
                    state = s;
                    draw();
                }
                return true;
            });
            expect(ok).toBe(true);
        });
    });
});
