const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with the level spawner switched off so scripted scenarios are
// not disturbed by customers arriving on their own schedule.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
        autoStep = false; // the specs drive step() themselves
    });

// Start a game that keeps its own spawner but still steps only when asked.
const startLoud = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
    });

// Chromium can acknowledge a synthetic key event before the page listener has
// run, so key presses are confirmed against game state before continuing.
const pressLane = async (page, key, wantLane) => {
    await page.keyboard.press(key);
    await page.waitForFunction((l) => bartender.lane === l, wantLane);
};

const consts = (page) =>
    page.evaluate(() => ({
        BAR_LEFT,
        BAR_RIGHT,
        LANE_Y,
        MUG_SPEED,
        EMPTY_SPEED,
        SERVE_COOLDOWN,
        DRINK_TIME,
        PUSH_BACK,
        SCORE_SERVE,
        SCORE_CATCH,
        SCORE_CLEAR,
        START_LIVES,
        LEVEL_PAUSE,
        LANE_COUNT,
    }));

test.describe('Soda Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(() => localStorage.clear());
        await page.reload();
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Soda Tapper', async ({ page }) => {
            await expect(page).toHaveTitle('Soda Tapper');
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

        test('HUD shows starting score, level, lives, served and best', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#served')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('there are four lanes', async ({ page }) => {
            const { LANE_COUNT, LANE_Y } = await consts(page);
            expect(LANE_COUNT).toBe(4);
            expect(LANE_Y).toHaveLength(4);
        });

        test('the bar runs left to right inside the canvas', async ({ page }) => {
            const { BAR_LEFT, BAR_RIGHT } = await consts(page);
            expect(BAR_LEFT).toBeGreaterThan(0);
            expect(BAR_RIGHT).toBeGreaterThan(BAR_LEFT);
            expect(BAR_RIGHT).toBeLessThan(640);
        });

        test('step does nothing while idle', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0));
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeCloseTo(before, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.click('#btn-start');
            await page.waitForFunction(() => state === 'running');
        });

        test('a fresh game has an empty bar and full lives', async ({ page }) => {
            await startQuiet(page);
            const s = await page.evaluate(() => ({
                mugs: mugs.length,
                empties: empties.length,
                customers: customers.length,
                lives,
                score,
                level,
                served,
                lane: bartender.lane,
            }));
            expect(s).toEqual({
                mugs: 0,
                empties: 0,
                customers: 0,
                lives: 3,
                score: 0,
                level: 1,
                served: 0,
                lane: 0,
            });
        });
    });

    // -----------------------------------------------------------------------
    // Bartender movement
    // -----------------------------------------------------------------------
    test.describe('bartender movement', () => {
        test('arrow down moves down a lane', async ({ page }) => {
            await startQuiet(page);
            await pressLane(page, 'ArrowDown', 1);
            await pressLane(page, 'ArrowDown', 2);
        });

        test('arrow up moves back up a lane', async ({ page }) => {
            await startQuiet(page);
            await pressLane(page, 'ArrowDown', 1);
            await pressLane(page, 'ArrowUp', 0);
        });

        test('w and s also move the bartender', async ({ page }) => {
            await startQuiet(page);
            await pressLane(page, 's', 1);
            await pressLane(page, 'w', 0);
        });

        test('movement is clamped to the top lane', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('ArrowUp');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('movement is clamped to the bottom lane', async ({ page }) => {
            await startQuiet(page);
            for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(3);
        });

        test('the bartender does not move while idle', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving mugs
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('serve pours a mug in the bartender lane at the right end', async ({ page }) => {
            const { BAR_RIGHT } = await consts(page);
            await startQuiet(page);
            await pressLane(page, 'ArrowDown', 1);
            await pressLane(page, 'ArrowDown', 2);
            await page.evaluate(() => serve());
            const mug = await page.evaluate(() => mugs[0]);
            expect(mug.lane).toBe(2);
            expect(mug.x).toBeCloseTo(BAR_RIGHT, 5);
        });

        test('space serves while the game is running', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('Space');
            await page.waitForFunction(() => mugs.length === 1);
        });

        test('the serve cooldown blocks an immediate second mug', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => serve())).toBe(true);
            expect(await page.evaluate(() => serve())).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('a mug can be poured again once the cooldown elapses', async ({ page }) => {
            const { SERVE_COOLDOWN } = await consts(page);
            await startQuiet(page);
            await page.evaluate(() => serve());
            await advance(page, Math.ceil(SERVE_COOLDOWN * 60) + 2);
            expect(await page.evaluate(() => serve())).toBe(true);
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('a poured mug slides left at the mug speed', async ({ page }) => {
            const { MUG_SPEED, BAR_RIGHT } = await consts(page);
            await startQuiet(page);
            await page.evaluate(() => serve());
            await advance(page, 30);
            const x = await page.evaluate(() => mugs[0].x);
            expect(x).toBeCloseTo(BAR_RIGHT - MUG_SPEED * 0.5, 1);
        });

        test('serving is ignored while idle', async ({ page }) => {
            expect(await page.evaluate(() => serve())).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('serving is ignored while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => togglePause());
            expect(await page.evaluate(() => serve())).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test('a spawned customer starts at the left end and advances', async ({ page }) => {
            const { BAR_LEFT } = await consts(page);
            await startQuiet(page);
            await page.evaluate(() => spawnCustomer(1));
            const c0 = await page.evaluate(() => ({ ...customers[0] }));
            expect(c0.lane).toBe(1);
            expect(c0.x).toBeCloseTo(BAR_LEFT, 5);
            expect(c0.mode).toBe('advancing');

            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeGreaterThan(BAR_LEFT);
        });

        test('a customer that reaches the bartender costs a life', async ({ page }) => {
            const { BAR_RIGHT } = await consts(page);
            await startQuiet(page);
            await page.evaluate((x) => {
                spawnCustomer(0);
                customers[0].x = x - 1;
            }, BAR_RIGHT);
            await advance(page, 20);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Serving customers
    // -----------------------------------------------------------------------
    test.describe('drinks', () => {
        test('a mug reaching a customer is caught and scores', async ({ page }) => {
            const { SCORE_SERVE, BAR_RIGHT } = await consts(page);
            await startQuiet(page);
            await page.evaluate((x) => {
                spawnCustomer(0);
                customers[0].x = x - 200;
                serve();
            }, BAR_RIGHT);
            await advance(page, 120);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(SCORE_SERVE);
        });

        test('catching a mug pushes the customer back and starts a drink', async ({ page }) => {
            const { BAR_RIGHT, PUSH_BACK } = await consts(page);
            await startQuiet(page);
            const startX = BAR_RIGHT - 220;
            await page.evaluate(
                ([x]) => {
                    spawnCustomer(0);
                    customers[0].x = x;
                    customers[0].speed = 0; // isolate the push-back from walking
                    serve();
                },
                [startX]
            );
            await advance(page, 55); // long enough to catch, short of the drink ending
            const c = await page.evaluate(() => ({ ...customers[0] }));
            expect(c.mode).toBe('drinking');
            expect(c.x).toBeLessThanOrEqual(startX - PUSH_BACK + 1);
        });

        test('catching a mug sends an empty mug back', async ({ page }) => {
            const { BAR_RIGHT } = await consts(page);
            await startQuiet(page);
            await page.evaluate((x) => {
                spawnCustomer(0);
                customers[0].x = x - 220;
                customers[0].speed = 0;
                serve();
            }, BAR_RIGHT);
            await advance(page, 55); // the empty is still on its way back
            expect(await page.evaluate(() => empties.length)).toBe(1);
            const e = await page.evaluate(() => ({ ...empties[0] }));
            expect(e.lane).toBe(0);
            expect(e.x).toBeLessThan(BAR_RIGHT);
        });

        test('a drinking customer resumes advancing after the drink time', async ({ page }) => {
            const { DRINK_TIME } = await consts(page);
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                customers[0].mode = 'drinking';
                customers[0].drinkTimer = DRINK_TIME;
            });
            await advance(page, Math.ceil(DRINK_TIME * 60) - 4);
            expect(await page.evaluate(() => customers[0].mode)).toBe('drinking');
            await advance(page, 10);
            expect(await page.evaluate(() => customers[0].mode)).toBe('advancing');
        });

        test('a drinking customer does not catch another mug', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                customers[0].speed = 0;
                customers[0].mode = 'drinking';
                customers[0].drinkTimer = 99;
                serve();
            });
            await advance(page, 120);
            // The mug slid past the drinker and smashed at the far end.
            expect(await page.evaluate(() => customers.length)).toBe(1);
            expect(await page.evaluate(() => customers[0].mode)).toBe('drinking');
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a customer pushed off the left end is served and scores', async ({ page }) => {
            const { BAR_LEFT, SCORE_CLEAR, PUSH_BACK } = await consts(page);
            await startQuiet(page);
            await page.evaluate(
                ([left, push]) => {
                    spawnCustomer(0);
                    customers[0].x = left + push - 10;
                    customers[0].speed = 0;
                    serve();
                },
                [BAR_LEFT, PUSH_BACK]
            );
            await advance(page, 180);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => served)).toBe(1);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(SCORE_CLEAR);
            await expect(page.locator('#served')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test('an empty mug slides right at the empty speed', async ({ page }) => {
            const { EMPTY_SPEED } = await consts(page);
            await startQuiet(page);
            await page.evaluate(() => empties.push({ lane: 0, x: 200 }));
            await advance(page, 30);
            expect(await page.evaluate(() => empties[0].x)).toBeCloseTo(200 + EMPTY_SPEED * 0.5, 1);
        });

        test('an empty mug in the bartender lane is caught and scores', async ({ page }) => {
            const { BAR_RIGHT, SCORE_CATCH } = await consts(page);
            await startQuiet(page);
            await page.evaluate((x) => empties.push({ lane: 0, x: x - 10 }), BAR_RIGHT);
            await advance(page, 20);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(SCORE_CATCH);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an empty mug in another lane smashes and costs a life', async ({ page }) => {
            const { BAR_RIGHT } = await consts(page);
            await startQuiet(page);
            await page.evaluate((x) => empties.push({ lane: 3, x: x - 10 }), BAR_RIGHT);
            await advance(page, 20);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => score)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Wasted mugs
    // -----------------------------------------------------------------------
    test.describe('wasted mugs', () => {
        test('a full mug reaching the far end smashes and costs a life', async ({ page }) => {
            const { BAR_LEFT } = await consts(page);
            await startQuiet(page);
            await page.evaluate((left) => {
                serve();
                mugs[0].x = left + 10;
            }, BAR_LEFT);
            await advance(page, 20);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('p pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the simulation is frozen while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0);
                togglePause();
            });
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeCloseTo(before, 5);
        });

        test('the start button resumes a paused game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => togglePause());
            await page.click('#btn-start');
            await page.waitForFunction(() => state === 'running');
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        const loseAll = (page) =>
            page.evaluate(() => {
                lives = 1;
                empties.push({ lane: 3, x: BAR_RIGHT - 1 });
                bartender.lane = 0;
                for (let i = 0; i < 20; i++) step(1 / 60);
            });

        test('running out of lives ends the game', async ({ page }) => {
            await startQuiet(page);
            await loseAll(page);
            expect(await page.evaluate(() => state)).toBe('over');
            expect(await page.evaluate(() => lives)).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|closed/i);
        });

        test('the final score is shown on the overlay', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 375;
            });
            await loseAll(page);
            await expect(page.locator('#overlay-score')).toContainText('375');
        });

        test('the best score is stored and shown', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 420;
            });
            await loseAll(page);
            await expect(page.locator('#best')).toHaveText('420');
            expect(await page.evaluate(() => localStorage.getItem('sodatapper-best'))).toBe('420');
        });

        test('the best score survives a reload', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 640;
            });
            await loseAll(page);
            await page.reload();
            await expect(page.locator('#best')).toHaveText('640');
        });

        test('the simulation is frozen after game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnCustomer(0));
            await loseAll(page);
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeCloseTo(before, 5);
        });

        test('space restarts after game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 90;
            });
            await loseAll(page);
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            const s = await page.evaluate(() => ({ score, lives, level, served }));
            expect(s).toEqual({ score: 0, lives: 3, level: 1, served: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        const clearLevel = (page) =>
            page.evaluate(() => {
                spawned = levelTotal;
                served = levelTotal;
                customers.length = 0;
                mugs.length = 0;
                empties.length = 0;
                step(1 / 60);
            });

        test('clearing every customer starts an interlude', async ({ page }) => {
            await startQuiet(page);
            await clearLevel(page);
            expect(await page.evaluate(() => state)).toBe('interlude');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/shift/i);
        });

        test('the interlude advances to the next level', async ({ page }) => {
            const { LEVEL_PAUSE } = await consts(page);
            await startQuiet(page);
            await clearLevel(page);
            await advance(page, Math.ceil(LEVEL_PAUSE * 60) + 4);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the served counter resets each level', async ({ page }) => {
            const { LEVEL_PAUSE } = await consts(page);
            await startQuiet(page);
            await clearLevel(page);
            await advance(page, Math.ceil(LEVEL_PAUSE * 60) + 4);
            expect(await page.evaluate(() => served)).toBe(0);
        });

        test('later levels send more, faster customers', async ({ page }) => {
            const { LEVEL_PAUSE } = await consts(page);
            await startQuiet(page);
            const first = await page.evaluate(() => ({
                total: levelTotal,
                speed: customerSpeed,
                interval: spawnInterval,
            }));
            await clearLevel(page);
            await advance(page, Math.ceil(LEVEL_PAUSE * 60) + 4);
            const second = await page.evaluate(() => ({
                total: levelTotal,
                speed: customerSpeed,
                interval: spawnInterval,
            }));
            expect(second.total).toBeGreaterThan(first.total);
            expect(second.speed).toBeGreaterThan(first.speed);
            expect(second.interval).toBeLessThan(first.interval);
        });

        test('lives carry over into the next level', async ({ page }) => {
            const { LEVEL_PAUSE } = await consts(page);
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 2;
            });
            await clearLevel(page);
            await advance(page, Math.ceil(LEVEL_PAUSE * 60) + 4);
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Automatic spawning
    // -----------------------------------------------------------------------
    test.describe('spawner', () => {
        test('customers arrive on their own once the game is running', async ({ page }) => {
            await startLoud(page);
            await advance(page, 60 * 12);
            expect(await page.evaluate(() => spawned)).toBeGreaterThan(0);
        });

        test('the spawner stops at the level total', async ({ page }) => {
            await startLoud(page);
            await advance(page, 60 * 90);
            expect(await page.evaluate(() => spawned)).toBeLessThanOrEqual(
                await page.evaluate(() => levelTotal)
            );
        });

        test('every spawned customer lands on a real lane', async ({ page }) => {
            await startLoud(page);
            await advance(page, 60 * 20);
            const lanes = await page.evaluate(() => customers.map((c) => c.lane));
            for (const lane of lanes) {
                expect(lane).toBeGreaterThanOrEqual(0);
                expect(lane).toBeLessThan(4);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is drawn to', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0);
                serve();
                empties.push({ lane: 2, x: 300 });
                draw();
            });
            const blank = await page.evaluate(() => {
                const ctx = canvas.getContext('2d');
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) {
                        return false;
                    }
                }
                return true;
            });
            expect(blank).toBe(false);
        });

        test('drawing works in every game state', async ({ page }) => {
            await startQuiet(page);
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                draw();
                togglePause();
                draw();
                togglePause();
                state = 'interlude';
                draw();
                state = 'over';
                draw();
                state = 'running';
            });
            expect(errors).toEqual([]);
        });
    });
});
