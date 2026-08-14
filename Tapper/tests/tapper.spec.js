const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a run with customer spawning switched off, so specs that place their
// own customers stay deterministic. Specs about spawning leave it on.
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

        test('HUD shows starting score, level, lives and served count', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#served')).toHaveText('0/6');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-best', '3300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('3300');
        });

        test('there are four bars', async ({ page }) => {
            expect(await page.evaluate(() => LANES)).toBe(4);
            expect(await page.evaluate(() => LANE_Y.length)).toBe(4);
        });

        test('bars are evenly spaced down the canvas', async ({ page }) => {
            const gaps = await page.evaluate(() =>
                LANE_Y.slice(1).map((y, i) => y - LANE_Y[i])
            );
            expect(new Set(gaps).size).toBe(1);
            expect(await page.evaluate(() => LANE_Y[LANES - 1])).toBeLessThan(
                await page.evaluate(() => CANVAS_H)
            );
        });

        test('no customers or mugs before starting', async ({ page }) => {
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('step() does nothing while idle', async ({ page }) => {
            await advance(page, 120);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the bartender starts on the top bar', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('a fresh run has the level-one customer target', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => levelTarget)).toBe(
                await page.evaluate(() => customersForLevel(1))
            );
            expect(await page.evaluate(() => servedThisLevel)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Bartender movement
    // -----------------------------------------------------------------------
    test.describe('bartender', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowDown moves down a bar', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.waitForFunction(() => bartender.lane === 1);
        });

        test('ArrowUp moves back up a bar', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.waitForFunction(() => bartender.lane === 1);
            await page.keyboard.press('ArrowUp');
            await page.waitForFunction(() => bartender.lane === 0);
        });

        test('W and S also move between bars', async ({ page }) => {
            await page.keyboard.press('s');
            await page.waitForFunction(() => bartender.lane === 1);
            await page.keyboard.press('w');
            await page.waitForFunction(() => bartender.lane === 0);
        });

        test('the bartender cannot go above the top bar', async ({ page }) => {
            await page.evaluate(() => {
                moveLane(-1);
                moveLane(-1);
            });
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('the bartender cannot go below the bottom bar', async ({ page }) => {
            await page.evaluate(() => {
                for (let i = 0; i < 8; i++) moveLane(1);
            });
            expect(await page.evaluate(() => bartender.lane)).toBe(
                (await page.evaluate(() => LANES)) - 1
            );
        });

        test('the bartender does not move while idle', async ({ page }) => {
            await page.reload();
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring and mug travel
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space pours a mug', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => mugs.length === 1);
            expect(await page.evaluate(() => mugs[0].full)).toBe(true);
        });

        test('a poured mug starts at the tap on the bartender lane', async ({ page }) => {
            await page.evaluate(() => {
                moveLane(1);
                pour();
            });
            const mug = await page.evaluate(() => mugs[0]);
            expect(mug.lane).toBe(1);
            expect(mug.x).toBeCloseTo(await page.evaluate(() => TAP_X), 5);
        });

        test('a full mug slides left', async ({ page }) => {
            await page.evaluate(() => pour());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 20);
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThan(before);
        });

        test('pouring twice in a row is rate limited', async ({ page }) => {
            await page.evaluate(() => {
                pour();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('pouring works again after the cooldown', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 60);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('a full mug that reaches the end of the bar smashes and costs a life', async ({
            page,
        }) => {
            await page.evaluate(() => pour());
            await advance(page, 150);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('no pouring while idle', async ({ page }) => {
            await page.reload();
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
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

        test('a customer enters at the far end of its bar', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(2));
            const c = await page.evaluate(() => customers[0]);
            expect(c.lane).toBe(2);
            expect(c.x).toBeCloseTo(await page.evaluate(() => BAR_LEFT), 5);
            expect(c.state).toBe('advancing');
        });

        test('a customer walks toward the bartender', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0));
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeGreaterThan(before);
        });

        test('customers spawn over time while running', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
            });
            await advance(page, 240);
            expect(await page.evaluate(() => customers.length)).toBeGreaterThan(0);
        });

        test('spawning stops once the level target has entered', async ({ page }) => {
            const spawned = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 60 * 120; i++) step(1 / 60);
                return spawnedThisLevel;
            });
            expect(spawned).toBeLessThanOrEqual(await page.evaluate(() => levelTarget));
        });

        test('a customer reaching the bartender costs a life', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = GRAB_X - 1;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('a served customer drinks, then leaves', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                pour();
            });
            await page.evaluate(() => {
                for (let i = 0; i < 600 && customers.length && customers[0].state !== 'drinking'; i++)
                    step(1 / 60);
            });
            expect(await page.evaluate(() => customers[0].state)).toBe('drinking');
            await advance(page, 120);
            expect(await page.evaluate(() => customers.length === 0 || customers[0].state)).not.toBe(
                'advancing'
            );
        });

        test('a drinking customer is pushed back down the bar', async ({ page }) => {
            const moved = await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                pour();
                let start = null;
                for (let i = 0; i < 600; i++) {
                    step(1 / 60);
                    if (customers.length && customers[0].state === 'drinking') {
                        if (start === null) start = customers[0].x;
                        else if (customers[0].x < start) return true;
                    }
                }
                return false;
            });
            expect(moved).toBe(true);
        });

        test('serving a customer scores points', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                pour();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(
                await page.evaluate(() => SERVE_POINTS)
            );
            expect(await page.evaluate(() => servedThisLevel)).toBe(1);
        });

        test('the mug is consumed when a customer catches it', async ({ page }) => {
            const caught = await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                pour();
                for (let i = 0; i < 600; i++) {
                    step(1 / 60);
                    if (customers[0].state === 'drinking') return mugs.length === 0;
                }
                return false;
            });
            expect(caught).toBe(true);
        });

        test('a mug only serves a customer on its own bar', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(2);
                customers[0].x = 300;
                pour(); // bartender is on lane 0
            });
            await advance(page, 80);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
            expect(await page.evaluate(() => servedThisLevel)).toBe(0);
        });

        test('a finished customer sends an empty mug back', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                pour();
            });
            await advance(page, 150);
            const empties = await page.evaluate(() => mugs.filter((m) => !m.full).length);
            expect(empties).toBe(1);
        });

        test('customers get faster each level', async ({ page }) => {
            const l1 = await page.evaluate(() => customerSpeed());
            await page.evaluate(() => {
                level = 5;
            });
            expect(await page.evaluate(() => customerSpeed())).toBeGreaterThan(l1);
        });

        test('customers never outrun a poured mug', async ({ page }) => {
            await page.evaluate(() => {
                level = 60;
            });
            expect(await page.evaluate(() => customerSpeed())).toBeLessThan(
                await page.evaluate(() => MUG_SPEED)
            );
        });

        test('more customers arrive at higher levels', async ({ page }) => {
            expect(await page.evaluate(() => customersForLevel(4))).toBeGreaterThan(
                await page.evaluate(() => customersForLevel(1))
            );
        });

        test('customers arrive more often at higher levels', async ({ page }) => {
            const l1 = await page.evaluate(() => spawnInterval());
            await page.evaluate(() => {
                level = 6;
            });
            expect(await page.evaluate(() => spawnInterval())).toBeLessThan(l1);
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty mug slides back toward the bar', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(0, 200));
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 20);
            expect(await page.evaluate(() => mugs[0].x)).toBeGreaterThan(before);
        });

        test('the bartender catches an empty mug on their bar', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(0, CATCH_X - 40));
            await advance(page, 60);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => CATCH_POINTS));
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an uncaught empty mug smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(3, CATCH_X - 40));
            await advance(page, 60);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('moving to the right bar in time saves the mug', async ({ page }) => {
            await page.evaluate(() => {
                spawnEmpty(2, CATCH_X - 120);
                moveLane(1);
                moveLane(1);
            });
            await advance(page, 90);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
        });

        test('an empty mug does not serve a customer', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                spawnEmpty(0, 200);
            });
            await advance(page, 30);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('losing', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the bar is cleared after a mistake', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(1);
                spawnCustomer(2);
                spawnEmpty(3, CATCH_X - 5);
            });
            await advance(page, 200);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('one mistake only costs one life', async ({ page }) => {
            await page.evaluate(() => {
                spawnEmpty(3, CATCH_X - 5);
                spawnEmpty(3, CATCH_X - 6);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the level target survives a mistake', async ({ page }) => {
            await page.evaluate(() => {
                servedThisLevel = 2;
                spawnEmpty(3, CATCH_X - 5);
            });
            await advance(page, 200);
            expect(await page.evaluate(() => servedThisLevel)).toBe(2);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                spawnEmpty(3, CATCH_X - 5);
            });
            await advance(page, 200);
            expect(await page.evaluate(() => lives)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('the game over overlay shows the score', async ({ page }) => {
            await page.evaluate(() => {
                score = 850;
                lives = 1;
                spawnEmpty(3, CATCH_X - 5);
            });
            await advance(page, 200);
            await expect(page.locator('#overlay-score')).toContainText('850');
        });
    });

    // -----------------------------------------------------------------------
    // Level flow
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('serving everyone clears the level', async ({ page }) => {
            await page.evaluate(() => serveEverythingForTest());
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('a level is not clear while a customer is still waiting', async ({ page }) => {
            await page.evaluate(() => {
                serveEverythingForTest();
                spawnCustomer(0);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a level is not clear while a mug is in flight', async ({ page }) => {
            await page.evaluate(() => {
                serveEverythingForTest();
                spawnEmpty(0, 200);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('clearing a level scores a bonus', async ({ page }) => {
            await page.evaluate(() => {
                score = 0;
                serveEverythingForTest();
            });
            await advance(page, 2);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(
                await page.evaluate(() => LEVEL_BONUS)
            );
        });

        test('the next level starts with a fresh, larger crowd', async ({ page }) => {
            await page.evaluate(() => serveEverythingForTest());
            await advance(page, 220);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => servedThisLevel)).toBe(0);
            expect(await page.evaluate(() => spawnedThisLevel)).toBe(0);
            expect(await page.evaluate(() => levelTarget)).toBe(
                await page.evaluate(() => customersForLevel(2))
            );
        });

        test('score and lives carry into the next level', async ({ page }) => {
            await page.evaluate(() => {
                score = 1000;
                lives = 2;
                serveEverythingForTest();
            });
            await advance(page, 220);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(1000);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the HUD tracks progress through the level', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                pour();
            });
            await advance(page, 120);
            await expect(page.locator('#served')).toHaveText(/^1\//);
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
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                togglePause();
            });
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });

        test('pouring is ignored while paused', async ({ page }) => {
            await page.evaluate(() => {
                togglePause();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('a new best is stored on game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 6400;
                lives = 1;
                spawnEmpty(3, CATCH_X - 5);
            });
            await advance(page, 220);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#best')).toHaveText('6400');
            expect(await page.evaluate(() => window.localStorage.getItem('tapper-best'))).toBe(
                '6400'
            );
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-best', '9000'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 10;
                lives = 1;
                spawnEmpty(3, CATCH_X - 5);
            });
            await advance(page, 220);
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('restarting after game over resets the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 500;
                level = 3;
                lives = 1;
                spawnEmpty(3, CATCH_X - 5);
            });
            await advance(page, 220);
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(1);
                pour();
            });
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
                spawnCustomer(0);
                spawnCustomer(2);
                customers[1].x = 320;
                pour();
                spawnEmpty(3, 300);
                for (let i = 0; i < 60; i++) step(1 / 60);
                draw(); // running
                togglePause();
                draw(); // paused
                togglePause();
                lives = 1;
                spawnEmpty(3, CATCH_X - 2);
                step(1 / 60);
                draw(); // dying
                for (let i = 0; i < 200; i++) step(1 / 60);
                draw(); // over
                startGame();
                spawnEnabled = false;
                serveEverythingForTest();
                step(1 / 60);
                draw(); // level clear
                for (let i = 0; i < 220; i++) step(1 / 60);
                draw();
            });
            expect(errors).toEqual([]);
        });
    });
});
