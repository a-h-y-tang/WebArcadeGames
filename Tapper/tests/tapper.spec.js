const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so lane changes are confirmed against game state before the simulation is
// advanced. Without this the specs race the real animation loop.
const pressLane = async (page, key, wantLane) => {
    await page.keyboard.press(key);
    await page.waitForFunction((lane) => barkeep.lane === lane, wantLane);
};

// Start a game with customer spawning switched off so long simulations stay
// deterministic. Specs that are about spawning leave it on.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
    });

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

        test('canvas is 640x460', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level, lives and customers left', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#remaining')).toHaveText(
                String(await page.evaluate(() => customersForLevel(1)))
            );
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-best', '3300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('3300');
        });

        test('the bar is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => empties.length)).toBe(0);
        });

        test('there are four bars', async ({ page }) => {
            expect(await page.evaluate(() => LANES)).toBe(4);
            expect(await page.evaluate(() => LANE_Y.length)).toBe(4);
        });

        test('step() does nothing while idle', async ({ page }) => {
            const before = await page.evaluate(() => barkeep.lane);
            await advance(page, 60);
            expect(await page.evaluate(() => barkeep.lane)).toBe(before);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the barkeep starts at the top bar behind the taps', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => barkeep.lane)).toBe(0);
            expect(await page.evaluate(() => barkeep.x)).toBe(await page.evaluate(() => BARKEEP_X));
            expect(await page.evaluate(() => BARKEEP_X)).toBeGreaterThan(
                await page.evaluate(() => BAR_RIGHT)
            );
        });

        test('a fresh level has its full quota of customers to serve', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => remaining())).toBe(
                await page.evaluate(() => customersForLevel(1))
            );
        });
    });

    // -----------------------------------------------------------------------
    // Barkeep movement
    // -----------------------------------------------------------------------
    test.describe('barkeep', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowDown moves down one bar', async ({ page }) => {
            await pressLane(page, 'ArrowDown', 1);
            expect(await page.evaluate(() => barkeep.lane)).toBe(1);
        });

        test('ArrowUp moves back up one bar', async ({ page }) => {
            await pressLane(page, 'ArrowDown', 1);
            await pressLane(page, 'ArrowUp', 0);
            expect(await page.evaluate(() => barkeep.lane)).toBe(0);
        });

        test('S and W also move between bars', async ({ page }) => {
            await pressLane(page, 's', 1);
            await pressLane(page, 'w', 0);
            expect(await page.evaluate(() => barkeep.lane)).toBe(0);
        });

        test('the barkeep cannot go above the top bar', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await advance(page, 10);
            expect(await page.evaluate(() => barkeep.lane)).toBe(0);
        });

        test('the barkeep cannot go below the bottom bar', async ({ page }) => {
            await page.evaluate(() => placeBarkeep(LANES - 1));
            await page.keyboard.press('ArrowDown');
            await advance(page, 10);
            expect(await page.evaluate(() => barkeep.lane)).toBe(3);
        });

        test('the barkeep follows the bar it is standing at', async ({ page }) => {
            await page.evaluate(() => placeBarkeep(2));
            expect(await page.evaluate(() => barkeep.y)).toBe(await page.evaluate(() => LANE_Y[2]));
        });

        test('the barkeep does not move while idle', async ({ page }) => {
            await page.reload();
            await page.keyboard.press('ArrowDown');
            await advance(page, 10);
            expect(await page.evaluate(() => barkeep.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space pours a mug', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => mugs.length === 1);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('a poured mug starts at the taps on the barkeep bar', async ({ page }) => {
            await page.evaluate(() => {
                placeBarkeep(2);
                pour();
            });
            const mug = await page.evaluate(() => ({ lane: mugs[0].lane, x: mugs[0].x }));
            expect(mug.lane).toBe(2);
            expect(mug.x).toBeLessThanOrEqual(await page.evaluate(() => BAR_RIGHT));
            expect(mug.x).toBeGreaterThan(await page.evaluate(() => BAR_RIGHT - 40));
        });

        test('a poured mug slides down the bar to the left', async ({ page }) => {
            await page.evaluate(() => pour());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 20);
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThan(before);
        });

        test('pouring twice in a row is blocked by the tap cooldown', async ({ page }) => {
            await page.evaluate(() => {
                pour();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('the tap can be used again after the cooldown', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 30);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('pouring does nothing while idle', async ({ page }) => {
            await page.reload();
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('a mug that reaches the end of the bar smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 200);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test('customers arrive over time', async ({ page }) => {
            const peak = await page.evaluate(() => {
                startGame();
                let most = 0;
                for (let i = 0; i < 900; i++) {
                    step(1 / 60);
                    most = Math.max(most, customers.length);
                }
                return most;
            });
            expect(peak).toBeGreaterThan(0);
        });

        test('a customer walks toward the taps', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => spawnCustomer(1, BAR_LEFT + 100).x);
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBeGreaterThan(before);
        });

        test('a customer reaching the taps costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnCustomer(0, GRAB_X - 2));
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('a served customer catches the mug and drinks', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeBarkeep(1);
                spawnCustomer(1, BAR_LEFT + 200);
                pour();
            });
            await advance(page, 180);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => customers[0].state)).toBe('drinking');
        });

        test('serving scores points', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeBarkeep(1);
                spawnCustomer(1, BAR_LEFT + 200);
                pour();
            });
            await advance(page, 180);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(
                await page.evaluate(() => SERVE_POINTS)
            );
        });

        test('a drinking customer is pushed back down the bar', async ({ page }) => {
            await startQuiet(page);
            const start = await page.evaluate(() => {
                placeBarkeep(1);
                const c = spawnCustomer(1, BAR_LEFT + 200);
                pour();
                return c.x;
            });
            await advance(page, 180);
            expect(await page.evaluate(() => customers[0].x)).toBeLessThan(start);
        });

        test('a mug only reaches customers on its own bar', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeBarkeep(0);
                spawnCustomer(3, BAR_LEFT + 200);
                pour();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
        });

        test('serving hands the empty mug back down the bar', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeBarkeep(1);
                spawnCustomer(1, BAR_LEFT + 200);
                pour();
            });
            // Stop before the empty has slid all the way back to the taps, where
            // the barkeep would catch it.
            await advance(page, 110);
            expect(await page.evaluate(() => empties.length)).toBe(1);
            expect(await page.evaluate(() => empties[0].lane)).toBe(1);
        });

        test('a customer pushed off the end of the bar leaves happy', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeBarkeep(1);
                spawnCustomer(1, BAR_LEFT + 8);
                pour();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => served)).toBe(1);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(
                await page.evaluate(() => LEAVE_POINTS)
            );
        });

        test('a customer far from the end needs more than one round', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeBarkeep(1);
                spawnCustomer(1, BAR_LEFT + 300);
                pour();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => customers.length)).toBe(1);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
        });

        test('serving reduces the customers left for the level', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => remaining());
            await page.evaluate(() => {
                placeBarkeep(1);
                spawnCustomer(1, BAR_LEFT + 8);
                pour();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => remaining())).toBe(before - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty mug slides back toward the taps', async ({ page }) => {
            const before = await page.evaluate(() => spawnEmpty(2, BAR_LEFT + 100).x);
            await advance(page, 20);
            expect(await page.evaluate(() => empties[0].x)).toBeGreaterThan(before);
        });

        test('the barkeep catches an empty mug on the same bar', async ({ page }) => {
            await page.evaluate(() => {
                placeBarkeep(2);
                spawnEmpty(2, BAR_LEFT + 100);
            });
            await advance(page, 200);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => EMPTY_POINTS));
        });

        test('an uncaught empty mug smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => {
                placeBarkeep(0);
                spawnEmpty(2, BAR_LEFT + 100);
            });
            await advance(page, 200);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('moving into the bar in time still catches the mug', async ({ page }) => {
            await page.evaluate(() => {
                placeBarkeep(0);
                spawnEmpty(3, BAR_LEFT + 100);
            });
            await advance(page, 60);
            await page.evaluate(() => placeBarkeep(3));
            await advance(page, 140);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => empties.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Tips
    // -----------------------------------------------------------------------
    test.describe('tips', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('every fourth happy customer leaves a tip', async ({ page }) => {
            const tipEvery = await page.evaluate(() => TIP_EVERY);
            const counts = await page.evaluate(() => {
                const seen = [];
                for (let n = 0; n < TIP_EVERY; n++) {
                    tips.length = 0;
                    placeBarkeep(1);
                    spawnCustomer(1, BAR_LEFT + 8);
                    pour();
                    for (let i = 0; i < 300; i++) step(1 / 60);
                    seen.push(tips.length);
                    empties.length = 0;
                    tapCooldown = 0;
                }
                return seen;
            });
            expect(counts.filter((c) => c > 0).length).toBe(1);
            expect(counts[tipEvery - 1]).toBe(1);
        });

        test('a tip slides toward the taps and can be collected', async ({ page }) => {
            await page.evaluate(() => {
                placeBarkeep(2);
                spawnTip(2, BAR_LEFT + 100);
            });
            const before = await page.evaluate(() => score);
            await advance(page, 200);
            expect(await page.evaluate(() => tips.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(
                before + (await page.evaluate(() => TIP_POINTS))
            );
        });

        test('a missed tip is harmless', async ({ page }) => {
            await page.evaluate(() => {
                placeBarkeep(0);
                spawnTip(2, BAR_LEFT + 100);
            });
            await advance(page, 200);
            expect(await page.evaluate(() => tips.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the bar is cleared after a life is lost', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, GRAB_X - 2);
                spawnCustomer(2, BAR_LEFT + 50);
                spawnEmpty(1, BAR_LEFT + 50);
            });
            await advance(page, 200);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('progress through the level survives a lost life', async ({ page }) => {
            await page.evaluate(() => {
                placeBarkeep(1);
                spawnCustomer(1, BAR_LEFT + 8);
                pour();
            });
            await advance(page, 300);
            const left = await page.evaluate(() => remaining());
            await page.evaluate(() => spawnCustomer(0, GRAB_X - 2));
            await advance(page, 220);
            expect(await page.evaluate(() => remaining())).toBe(left);
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                spawnCustomer(0, GRAB_X - 2);
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(0);
            await advance(page, 200);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('nothing is simulated after a game over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                spawnCustomer(0, GRAB_X - 2);
            });
            await advance(page, 240);
            await page.evaluate(() => spawnCustomer(1, BAR_LEFT + 100));
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Level flow
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('serving the whole level clears it', async ({ page }) => {
            await page.evaluate(() => serveEveryoneForTest());
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('the next level starts with a fresh, larger crowd', async ({ page }) => {
            await page.evaluate(() => serveEveryoneForTest());
            await advance(page, 180);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => remaining())).toBe(
                await page.evaluate(() => customersForLevel(2))
            );
            expect(await page.evaluate(() => customersForLevel(2))).toBeGreaterThan(
                await page.evaluate(() => customersForLevel(1))
            );
        });

        test('the level-clear overlay clears with it', async ({ page }) => {
            await page.evaluate(() => serveEveryoneForTest());
            await advance(page, 2);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await advance(page, 180);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('score carries into the next level', async ({ page }) => {
            await page.evaluate(() => {
                score = 2500;
                serveEveryoneForTest();
            });
            await advance(page, 180);
            expect(await page.evaluate(() => score)).toBe(2500);
        });

        test('customers get thirstier and faster each level', async ({ page }) => {
            const l1 = await page.evaluate(() => customerSpeed());
            await page.evaluate(() => {
                level = 5;
            });
            expect(await page.evaluate(() => customerSpeed())).toBeGreaterThan(l1);
        });

        test('customers never outrun a poured mug', async ({ page }) => {
            await page.evaluate(() => {
                level = 50;
            });
            expect(await page.evaluate(() => customerSpeed())).toBeLessThan(
                await page.evaluate(() => MUG_SPEED)
            );
        });

        test('a chain of mugs beats a walking customer at any level', async ({ page }) => {
            // Keeping a customer drinking pushes them back faster than they can
            // ever walk, so no board can become impossible to clear.
            await page.evaluate(() => {
                level = 50;
            });
            expect(await page.evaluate(() => customerSpeed())).toBeLessThan(
                await page.evaluate(() => DRINK_SPEED)
            );
        });

        test('customers arrive more often at higher levels', async ({ page }) => {
            const l1 = await page.evaluate(() => spawnInterval());
            await page.evaluate(() => {
                level = 6;
            });
            expect(await page.evaluate(() => spawnInterval())).toBeLessThan(l1);
        });

        test('a level ends only once the bar is empty', async ({ page }) => {
            await page.evaluate(() => {
                serveEveryoneForTest();
                spawnCustomer(2, BAR_LEFT + 100);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('running');
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
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(1, BAR_LEFT + 100);
                togglePause();
            });
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });

        test('the taps are shut while paused', async ({ page }) => {
            await page.evaluate(() => {
                togglePause();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring persistence
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('a new best is stored on game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 6400;
                lives = 1;
                spawnCustomer(0, GRAB_X - 2);
            });
            await advance(page, 240);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#best')).toHaveText('6400');
            expect(await page.evaluate(() => window.localStorage.getItem('tapper-best'))).toBe(
                '6400'
            );
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-best', '9100'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 20;
                lives = 1;
                spawnCustomer(0, GRAB_X - 2);
            });
            await advance(page, 240);
            await expect(page.locator('#best')).toHaveText('9100');
        });

        test('restarting after game over resets the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 700;
                level = 4;
                lives = 1;
                spawnCustomer(0, GRAB_X - 2);
            });
            await advance(page, 240);
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => served)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 30);
            const painted = await page.evaluate(() => {
                draw();
                const d = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i] > 20 || d[i + 1] > 20 || d[i + 2] > 20) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('drawing works in every state without throwing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                draw(); // idle
                startGame();
                spawnEnabled = false;
                spawnCustomer(1, BAR_LEFT + 120);
                spawnCustomer(3, BAR_LEFT + 60);
                spawnEmpty(2, BAR_LEFT + 90);
                spawnTip(0, BAR_LEFT + 90);
                placeBarkeep(1);
                pour();
                for (let i = 0; i < 60; i++) step(1 / 60);
                draw(); // running
                togglePause();
                draw(); // paused
                togglePause();
                lives = 1;
                spawnCustomer(0, GRAB_X - 2);
                step(1 / 60);
                draw(); // dying
                for (let i = 0; i < 200; i++) step(1 / 60);
                draw(); // over
                startGame();
                spawnEnabled = false;
                serveEveryoneForTest();
                step(1 / 60);
                draw(); // level clear
                for (let i = 0; i < 200; i++) step(1 / 60);
                draw();
            });
            expect(errors).toEqual([]);
        });
    });
});
