const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start a game with the random arrival timer switched off and the counters
// empty, so every spec controls exactly what is on the board.
async function startClean(page) {
    await page.evaluate(() => {
        startGame();
        spawnEnabled = false;
        customers.length = 0;
        mugs.length = 0;
    });
}

// Advance the simulation by `seconds` in 1/60s slices, the way the rAF loop does.
async function advance(page, seconds) {
    await page.evaluate((s) => {
        const dt = 1 / 60;
        for (let i = 0; i < Math.round(s / dt); i++) step(dt);
    }, seconds);
}

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

        test('canvas is 720x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('score, level, lives and served are shown at their starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#served')).toContainText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle changes nothing', async ({ page }) => {
            const changed = await page.evaluate(() => {
                for (let i = 0; i < 120; i++) step(1 / 60);
                return customers.length > 0 || mugs.length > 0 || score !== 0;
            });
            expect(changed).toBe(false);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('soda-tapper-best', '1234'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('there are four counters and they are ordered top to bottom', async ({ page }) => {
            const info = await page.evaluate(() => ({
                count: LANE_COUNT,
                ys: Array.from({ length: LANE_COUNT }, (_, i) => laneY(i)),
                h: CANVAS_H,
            }));
            expect(info.count).toBe(4);
            expect(info.ys).toEqual([...info.ys].sort((a, b) => a - b));
            expect(Math.max(...info.ys)).toBeLessThan(info.h);
        });

        test('the counter runs from the exit lip to the server station', async ({ page }) => {
            const g = await page.evaluate(() => ({ EXIT_X, COUNTER_LEFT, GRAB_X, SERVER_X, CATCH_X }));
            expect(g.EXIT_X).toBeLessThan(g.COUNTER_LEFT);
            expect(g.COUNTER_LEFT).toBeLessThan(g.GRAB_X);
            expect(g.GRAB_X).toBeLessThan(g.SERVER_X);
            expect(g.CATCH_X).toBeLessThanOrEqual(g.SERVER_X);
        });
    });

    // -----------------------------------------------------------------------
    // Starting, pausing, restarting
    // -----------------------------------------------------------------------
    test.describe('game flow', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh game starts on level 1 with 3 lives and no score', async ({ page }) => {
            await startClean(page);
            const s = await page.evaluate(() => ({ score, lives, level, served }));
            expect(s).toEqual({ score: 0, lives: 3, level: 1, served: 0 });
        });

        test('the player starts on the top counter', async ({ page }) => {
            await startClean(page);
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not simulate', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { spawnCustomer(0); customers[0].x = 300; togglePause(); });
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 1);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });

        test('P does nothing on the title screen', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('restarting clears the board and the score', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                spawnCustomer(1);
                score = 500;
                lives = 1;
                level = 4;
                startGame();
            });
            const s = await page.evaluate(() => ({
                score, lives, level, customers: customers.length, mugs: mugs.length, state,
            }));
            expect(s).toEqual({ score: 0, lives: 3, level: 1, customers: 0, mugs: 0, state: 'running' });
        });
    });

    // -----------------------------------------------------------------------
    // Moving between counters
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('ArrowDown moves down a counter', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('ArrowUp moves back up a counter', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('W and S move too', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('s');
            await page.keyboard.press('s');
            expect(await page.evaluate(() => player.lane)).toBe(2);
            await page.keyboard.press('w');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('the player cannot move above the top counter', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('the player cannot move below the bottom counter', async ({ page }) => {
            await startClean(page);
            for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(3);
        });

        test('the player cannot move while paused', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('p');
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring mugs
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test('Space pours a full mug into the current lane', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { player.lane = 2; pour(); });
            const mug = await page.evaluate(() => mugs[0]);
            expect(mug).toBeTruthy();
            expect(mug.lane).toBe(2);
            expect(mug.full).toBe(true);
        });

        test('a poured mug starts at the tap and slides left', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => pour());
            const startX = await page.evaluate(() => mugs[0].x);
            await advance(page, 0.2);
            const laterX = await page.evaluate(() => mugs[0].x);
            expect(startX).toBeGreaterThan(500);
            expect(laterX).toBeLessThan(startX);
        });

        test('the tap has a cooldown so mugs cannot be spammed in one frame', async ({ page }) => {
            await startClean(page);
            const count = await page.evaluate(() => {
                for (let i = 0; i < 5; i++) pour();
                return mugs.length;
            });
            expect(count).toBe(1);
        });

        test('the tap can be used again after the cooldown', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => pour());
            await advance(page, 0.5);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.filter((m) => m.full).length)).toBe(2);
        });

        test('the Space key pours', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { spawnEnabled = false; customers.length = 0; mugs.length = 0; });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('pouring does nothing while paused', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { togglePause(); pour(); });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test('a spawned customer starts at the far end of its counter', async ({ page }) => {
            await startClean(page);
            const c = await page.evaluate(() => { spawnCustomer(1); return customers[0]; });
            expect(c.lane).toBe(1);
            expect(c.x).toBeCloseTo(await page.evaluate(() => COUNTER_LEFT), 1);
        });

        test('customers advance toward the player', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => spawnCustomer(0));
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 1);
            const after = await page.evaluate(() => customers[0].x);
            expect(after).toBeGreaterThan(before);
        });

        test('customers advance faster on later levels', async ({ page }) => {
            const walk = async (lvl) => {
                await startClean(page);
                return page.evaluate((l) => {
                    level = l;
                    customers.length = 0;
                    spawnCustomer(0);
                    const from = customers[0].x;
                    for (let i = 0; i < 60; i++) step(1 / 60);
                    return customers[0].x - from;
                }, lvl);
            };
            const slow = await walk(1);
            const fast = await walk(6);
            expect(fast).toBeGreaterThan(slow);
        });

        test('the arrival timer brings customers in when spawning is enabled', async ({ page }) => {
            await page.evaluate(() => { startGame(); customers.length = 0; });
            await advance(page, 12);
            expect(await page.evaluate(() => customers.length)).toBeGreaterThan(0);
        });

        test('no more than MAX_CUSTOMERS are ever on the counters', async ({ page }) => {
            await page.evaluate(() => { startGame(); customers.length = 0; });
            await advance(page, 60);
            expect(await page.evaluate(() => customers.length)).toBeLessThanOrEqual(
                await page.evaluate(() => MAX_CUSTOMERS));
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('a mug that reaches a customer is caught and the customer drinks', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { spawnCustomer(0); customers[0].x = 400; pour(); });
            await advance(page, 1);
            const s = await page.evaluate(() => ({
                mugs: mugs.length, drinking: customers[0].drinking,
            }));
            expect(s.mugs).toBe(0);
            expect(s.drinking).toBe(true);
        });

        test('a drinking customer is pushed back toward the exit', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { spawnCustomer(0); customers[0].x = 400; pour(); });
            await advance(page, 0.6);
            const hitX = await page.evaluate(() => customers[0].x);
            await advance(page, 0.5);
            expect(await page.evaluate(() => customers[0].x)).toBeLessThan(hitX);
        });

        test('a mug only reaches customers in its own lane', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                spawnCustomer(2);
                customers[0].x = 400;
                player.lane = 0;
                pour();
            });
            await advance(page, 0.8);
            expect(await page.evaluate(() => customers[0].drinking)).toBe(false);
        });

        test('a customer pushed past the exit is served and scores', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { spawnCustomer(0); pour(); });
            await advance(page, 3);
            const s = await page.evaluate(() => ({ served, score, customers: customers.length }));
            expect(s.served).toBe(1);
            expect(s.score).toBeGreaterThan(0);
            expect(s.customers).toBe(0);
        });

        test('a served customer leaves an empty mug sliding back', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { spawnCustomer(0); pour(); });
            await advance(page, 3);
            const empties = await page.evaluate(() => mugs.filter((m) => !m.full));
            expect(empties.length).toBe(1);
            expect(empties[0].lane).toBe(0);
            const x1 = empties[0].x;
            await advance(page, 0.3);
            expect(await page.evaluate(() => mugs[0].x)).toBeGreaterThan(x1);
        });

        test('a customer far from the exit needs more than one mug', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { spawnCustomer(0); customers[0].x = 500; pour(); });
            await advance(page, 3);
            const s = await page.evaluate(() => ({ served, alive: customers.length }));
            expect(s.served).toBe(0);
            expect(s.alive).toBe(1);
        });

        test('the nearest customer to the tap catches the mug', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                spawnCustomer(0);
                spawnCustomer(0);
                customers[0].x = 200;
                customers[1].x = 500;
                pour();
            });
            await advance(page, 0.6);
            const drinking = await page.evaluate(() => customers.map((c) => c.drinking));
            expect(drinking).toEqual([false, true]);
        });
    });

    // -----------------------------------------------------------------------
    // Catching empty mugs
    // -----------------------------------------------------------------------
    test.describe('catching empties', () => {
        test('an empty mug reaching the station in your lane is caught for points', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                player.lane = 1;
                mugs.push({ lane: 1, x: 300, full: false });
                score = 0;
            });
            await advance(page, 3);
            const s = await page.evaluate(() => ({ mugs: mugs.length, score, lives }));
            expect(s.mugs).toBe(0);
            expect(s.score).toBeGreaterThan(0);
            expect(s.lives).toBe(3);
        });

        test('an empty mug missed in another lane smashes and costs a life', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                player.lane = 0;
                mugs.push({ lane: 3, x: 300, full: false });
            });
            await advance(page, 3);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('catching an empty mug is worth more than serving a customer', async ({ page }) => {
            const points = await page.evaluate(() => ({ serve: SERVE_POINTS, katch: CATCH_POINTS }));
            expect(points.katch).toBeGreaterThan(points.serve);
        });
    });

    // -----------------------------------------------------------------------
    // Losing lives
    // -----------------------------------------------------------------------
    test.describe('losing lives', () => {
        test('a full mug that runs off the far end smashes and costs a life', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => pour());
            await advance(page, 3);
            const s = await page.evaluate(() => ({ lives, mugs: mugs.length }));
            expect(s.lives).toBe(2);
            expect(s.mugs).toBe(0);
        });

        test('a customer that reaches the station costs a life', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { spawnCustomer(0); customers[0].x = GRAB_X - 5; });
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('losing a life clears the counters', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                spawnCustomer(1);
                spawnCustomer(2);
                customers[0].x = GRAB_X - 2;
            });
            await advance(page, 1);
            const s = await page.evaluate(() => ({ customers: customers.length, mugs: mugs.length }));
            expect(s).toEqual({ customers: 0, mugs: 0 });
        });

        test('spawning pauses briefly after a life is lost', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                customers.length = 0;
                spawnCustomer(0);
                customers[0].x = GRAB_X - 2;
                for (let i = 0; i < 30; i++) step(1 / 60);
            });
            const justAfter = await page.evaluate(() => customers.length);
            expect(justAfter).toBe(0);
            await advance(page, 10);
            expect(await page.evaluate(() => customers.length)).toBeGreaterThan(0);
        });

        test('the HUD shows the remaining lives', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => pour());
            await advance(page, 3);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('losing the last life ends the game', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { lives = 1; pour(); });
            await advance(page, 3);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|closing/i);
        });

        test('a finished game stops simulating', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { lives = 1; pour(); });
            await advance(page, 3);
            const before = await page.evaluate(() => score);
            await page.evaluate(() => { spawnCustomer(0); });
            await advance(page, 2);
            expect(await page.evaluate(() => score)).toBe(before);
        });

        test('Space starts a new game after game over', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { lives = 1; pour(); });
            await advance(page, 3);
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, lives, score }));
            expect(s).toEqual({ state: 'running', lives: 3, score: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('level 1 has a serve target', async ({ page }) => {
            await startClean(page);
            expect(await page.evaluate(() => target)).toBe(await page.evaluate(() => LEVEL_BASE + 2));
        });

        test('serving the target number of customers advances the level', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { served = target - 1; spawnCustomer(0); pour(); });
            await advance(page, 4);
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('a new level resets the served count and raises the target', async ({ page }) => {
            await startClean(page);
            const firstTarget = await page.evaluate(() => target);
            await page.evaluate(() => { served = target - 1; spawnCustomer(0); pour(); });
            await advance(page, 4);
            const s = await page.evaluate(() => ({ served, target }));
            expect(s.served).toBe(0);
            expect(s.target).toBeGreaterThan(firstTarget);
        });

        test('clearing a level awards a bonus', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { served = target - 1; score = 0; spawnCustomer(0); pour(); });
            await advance(page, 4);
            expect(await page.evaluate(() => score)).toBeGreaterThan(
                await page.evaluate(() => SERVE_POINTS + CATCH_POINTS));
        });

        test('the counters are cleared between levels', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                served = target - 1;
                spawnCustomer(0);
                spawnCustomer(3);
                customers[1].x = 300;
                pour();
            });
            await advance(page, 4);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });

        test('the HUD shows the level and the serve progress', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { spawnCustomer(0); pour(); });
            await advance(page, 3);
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#served')).toContainText('1');
        });

        test('customers arrive more often on later levels', async ({ page }) => {
            const gaps = await page.evaluate(() => [spawnInterval(1), spawnInterval(8)]);
            expect(gaps[1]).toBeLessThan(gaps[0]);
        });

        test('the arrival gap never drops below the floor', async ({ page }) => {
            const g = await page.evaluate(() => ({ far: spawnInterval(99), min: SPAWN_MIN }));
            expect(g.far).toBeGreaterThanOrEqual(g.min);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('serving a customer scores SERVE_POINTS on level 1', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { score = 0; spawnCustomer(0); pour(); });
            await advance(page, 3);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => SERVE_POINTS));
        });

        test('serving scores more on later levels', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { level = 3; score = 0; spawnCustomer(0); pour(); });
            await advance(page, 3);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => SERVE_POINTS * 3));
        });

        test('the HUD score updates as points are earned', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { spawnCustomer(0); pour(); });
            await advance(page, 3);
            await expect(page.locator('#score')).not.toHaveText('0');
        });

        test('the best score is stored and survives a reload', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('soda-tapper-best', '0'));
            await page.reload();
            await startClean(page);
            await page.evaluate(() => { score = 777; lives = 1; pour(); });
            await advance(page, 3);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#best')).toHaveText('777');
            await page.reload();
            await expect(page.locator('#best')).toHaveText('777');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('soda-tapper-best', '5000'));
            await page.reload();
            await startClean(page);
            await page.evaluate(() => { score = 10; lives = 1; pour(); });
            await advance(page, 3);
            await expect(page.locator('#best')).toHaveText('5000');
        });

        test('the game over overlay reports the final score', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { score = 420; lives = 1; pour(); });
            await advance(page, 3);
            await expect(page.locator('#overlay-score')).toContainText('420');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering & robustness
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { spawnCustomer(0); spawnCustomer(2); pour(); draw(); });
            const blank = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const first = [data[0], data[1], data[2]];
                for (let i = 4; i < data.length; i += 4) {
                    if (data[i] !== first[0] || data[i + 1] !== first[1] || data[i + 2] !== first[2]) return false;
                }
                return true;
            });
            expect(blank).toBe(false);
        });

        test('the game runs on its own without errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.keyboard.press('Space');
            await page.waitForTimeout(1200);
            expect(errors).toEqual([]);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a long unattended simulation stays consistent', async ({ page }) => {
            await page.evaluate(() => startGame());
            await advance(page, 90);
            const s = await page.evaluate(() => ({
                lives, state, mugs: mugs.length, customers: customers.length,
                offCounter: customers.some((c) => c.x < EXIT_X - 40 || c.x > SERVER_X),
            }));
            expect(s.lives).toBeLessThanOrEqual(3);
            expect(['running', 'over', 'interlude']).toContain(s.state);
            expect(s.offCounter).toBe(false);
        });

        test('a big time step does not tunnel a mug past the exit check', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { spawnCustomer(0); customers[0].x = 300; pour(); step(1.0); });
            const s = await page.evaluate(() => ({ lives, drinking: customers[0] && customers[0].drinking }));
            expect(s.lives).toBe(3);
            expect(s.drinking).toBe(true);
        });
    });
});
