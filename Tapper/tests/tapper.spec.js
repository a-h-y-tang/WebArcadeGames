const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with the animation loop's stepping and the spawn timer switched
// off, so the only simulation progress is what a spec asks for explicitly and
// the only patrons on the bars are the ones a spec places itself.
const startFrozen = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
        spawnEnabled = false;
    });

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so key presses are confirmed against game state before advancing.
const pressLane = async (page, key, wantLane) => {
    await page.keyboard.press(key);
    await page.waitForFunction((lane) => bartender.lane === lane, wantLane);
};

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

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-best', '7350'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7350');
        });

        test('no patrons or mugs exist while idle', async ({ page }) => {
            const counts = await page.evaluate(() => [
                customers.length,
                mugs.length,
                emptyMugs.length,
            ]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('there are four bars', async ({ page }) => {
            expect(await page.evaluate(() => LANES)).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting a game', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
        });

        test('overlay hides once running', async ({ page }) => {
            await startFrozen(page);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('starting resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                level = 5;
                startGame();
                autoStep = false;
            });
            expect(await page.evaluate(() => [score, lives, level])).toEqual([0, 3, 1]);
        });

        test('the barkeep starts on the top bar', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('patrons spawn on a timer once running', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            await advance(page, 60 * 10);
            expect(await page.evaluate(() => customers.length)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Barkeep movement
    // -----------------------------------------------------------------------
    test.describe('barkeep movement', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
        });

        test('ArrowDown moves down a bar', async ({ page }) => {
            await pressLane(page, 'ArrowDown', 1);
        });

        test('ArrowUp moves back up a bar', async ({ page }) => {
            await pressLane(page, 'ArrowDown', 1);
            await pressLane(page, 'ArrowUp', 0);
        });

        test('S and W also move the barkeep', async ({ page }) => {
            await pressLane(page, 's', 1);
            await pressLane(page, 'w', 0);
        });

        test('cannot move above the top bar', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('cannot move below the bottom bar', async ({ page }) => {
            for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(3);
        });

        test('the barkeep does not move while idle', async ({ page }) => {
            await page.evaluate(() => {
                state = 'idle';
            });
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving mugs
    // -----------------------------------------------------------------------
    test.describe('serving mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
        });

        test('Space pours a mug', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => mugs.length === 1);
        });

        test('a mug is poured into the barkeep\'s lane', async ({ page }) => {
            await page.evaluate(() => {
                bartender.lane = 2;
                serve();
            });
            expect(await page.evaluate(() => mugs[0].lane)).toBe(2);
        });

        test('a mug starts near the right end of the bar', async ({ page }) => {
            await page.evaluate(() => serve());
            const x = await page.evaluate(() => mugs[0].x);
            expect(x).toBeLessThan(600);
            expect(x).toBeGreaterThan(500);
        });

        test('a mug slides left over time', async ({ page }) => {
            await page.evaluate(() => serve());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeLessThan(before);
        });

        test('the serve cooldown blocks an immediate second mug', async ({ page }) => {
            await page.evaluate(() => {
                serve();
                serve();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('another mug can be poured after the cooldown', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 30);
            await page.evaluate(() => serve());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('serving does nothing while idle', async ({ page }) => {
            await page.evaluate(() => {
                state = 'idle';
                serve();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Patrons
    // -----------------------------------------------------------------------
    test.describe('patrons', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
        });

        test('a patron spawns at the left end of its bar', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(1));
            const c = await page.evaluate(() => ({ lane: customers[0].lane, x: customers[0].x }));
            expect(c.lane).toBe(1);
            expect(c.x).toBeLessThan(80);
        });

        test('a patron walks to the right', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0));
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeGreaterThan(before);
        });

        test('a new patron is walking and has drunk nothing', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0));
            const c = await page.evaluate(() => ({
                state: customers[0].state,
                mugs: customers[0].mugs,
            }));
            expect(c).toEqual({ state: 'walking', mugs: 0 });
        });

        test('patrons need one mug on level 1', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0));
            expect(await page.evaluate(() => customers[0].need)).toBe(1);
        });

        test('patrons need more mugs on later levels', async ({ page }) => {
            await page.evaluate(() => {
                level = 5;
                spawnCustomer(0);
            });
            expect(await page.evaluate(() => customers[0].need)).toBeGreaterThan(1);
        });

        test('patrons walk faster on later levels', async ({ page }) => {
            const distance = (lvl) =>
                page.evaluate((l) => {
                    level = l;
                    customers.length = 0;
                    spawnCustomer(0);
                    const start = customers[0].x;
                    for (let i = 0; i < 60; i++) step(1 / 60);
                    return customers[0].x - start;
                }, lvl);
            const slow = await distance(1);
            const fast = await distance(6);
            expect(fast).toBeGreaterThan(slow);
        });
    });

    // -----------------------------------------------------------------------
    // Serving patrons
    // -----------------------------------------------------------------------
    test.describe('serving patrons', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
        });

        test('a mug is consumed when it reaches a patron', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('a mug in another lane passes the patron by', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(1);
                customers[0].x = 400;
                serve(); // barkeep is on lane 0
            });
            await advance(page, 60);
            const c = await page.evaluate(() => customers[0].mugs);
            expect(c).toBe(0);
        });

        test('a patron that needs two mugs drinks and stays', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, 2);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 120);
            const c = await page.evaluate(() => ({
                len: customers.length,
                mugs: customers[0].mugs,
                state: customers[0].state,
            }));
            expect(c).toEqual({ len: 1, mugs: 1, state: 'drinking' });
        });

        test('a caught mug shoves the patron back down the bar', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, 2);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBeLessThan(400);
        });

        test('a drinking patron does not advance', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, 2);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 120);
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 20);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });

        test('a patron walks again once it has finished drinking', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, 2);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => customers[0].state)).toBe('walking');
        });

        test('a sip scores points', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, 2);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
        });

        test('a fully served patron turns around and leaves', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, 1);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].state)).toBe('leaving');
        });

        test('a leaving patron walks off the left end and is removed', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, 1);
                customers[0].x = 400;
                serve();
            });
            await advance(page, 60 * 12);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });

        test('serving a patron out sends an empty mug back', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, 1);
                customers[0].x = 400;
                serve();
            });
            // Stop short of the barkeep, who would otherwise catch the empty.
            await advance(page, 40);
            const mug = await page.evaluate(() => ({
                len: emptyMugs.length,
                lane: emptyMugs[0].lane,
            }));
            expect(mug).toEqual({ len: 1, lane: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
        });

        test('an empty mug slides to the right', async ({ page }) => {
            await page.evaluate(() => spawnEmptyMug(0, 300));
            await advance(page, 30);
            expect(await page.evaluate(() => emptyMugs[0].x)).toBeGreaterThan(300);
        });

        test('the barkeep catches an empty mug in their lane', async ({ page }) => {
            await page.evaluate(() => {
                bartender.lane = 2;
                spawnEmptyMug(2, 560);
                score = 0;
            });
            await advance(page, 60 * 2);
            const s = await page.evaluate(() => ({ score, lives, len: emptyMugs.length }));
            expect(s).toEqual({ score: 50, lives: 3, len: 0 });
        });

        test('a missed empty mug costs a life', async ({ page }) => {
            await page.evaluate(() => {
                bartender.lane = 0;
                spawnEmptyMug(3, 560);
            });
            await advance(page, 60 * 2);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a missed empty mug is removed from play', async ({ page }) => {
            await page.evaluate(() => {
                bartender.lane = 0;
                spawnEmptyMug(3, 560);
            });
            await advance(page, 60 * 2);
            expect(await page.evaluate(() => emptyMugs.length)).toBe(0);
        });

        test('an empty mug still in transit costs nothing', async ({ page }) => {
            await page.evaluate(() => spawnEmptyMug(0, 100));
            await advance(page, 30);
            const s = await page.evaluate(() => ({ lives, len: emptyMugs.length }));
            expect(s).toEqual({ lives: 3, len: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Losing lives
    // -----------------------------------------------------------------------
    test.describe('losing lives', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
        });

        test('a mug that reaches the left end smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 60 * 4);
            const s = await page.evaluate(() => ({ lives, len: mugs.length }));
            expect(s).toEqual({ lives: 2, len: 0 });
        });

        test('a patron reaching the barkeep costs a life', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 560;
            });
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('losing a life clears the bars', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(1);
                spawnCustomer(2);
                spawnCustomer(0);
                customers[2].x = 560;
            });
            await advance(page, 60 * 4);
            const counts = await page.evaluate(() => [
                customers.length,
                mugs.length,
                emptyMugs.length,
            ]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('losing a life pauses the action', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('play resumes after the pause', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 60 * 4);
            await advance(page, 60 * 3);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the HUD shows the lost life', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 60 * 4);
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
        });

        test('the game ends when the last life is lost', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                serve();
            });
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => state)).toBe('over');
        });

        test('the overlay returns on game over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                serve();
            });
            await advance(page, 60 * 4);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the final score is shown on the overlay', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                score = 425;
                serve();
            });
            await advance(page, 60 * 4);
            await expect(page.locator('#overlay-score')).toContainText('425');
        });

        test('a new best score is stored', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                score = 1234;
                serve();
            });
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => window.localStorage.getItem('tapper-best'))).toBe('1234');
        });

        test('the simulation stops once the game is over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                serve();
            });
            await advance(page, 60 * 4);
            await page.evaluate(() => spawnCustomer(0));
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });

        test('Space starts a fresh game after game over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                serve();
            });
            await advance(page, 60 * 4);
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
        });

        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
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

        test('the overlay explains the pause', async ({ page }) => {
            await page.evaluate(() => togglePause());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
        });

        test('a level has a fixed number of patrons', async ({ page }) => {
            expect(await page.evaluate(() => levelCustomers)).toBeGreaterThan(0);
        });

        test('clearing the wave enters the level-up break', async ({ page }) => {
            await page.evaluate(() => {
                spawnedThisLevel = levelCustomers;
            });
            await advance(page, 5);
            expect(await page.evaluate(() => state)).toBe('levelup');
        });

        test('the wave is not cleared while patrons remain', async ({ page }) => {
            await page.evaluate(() => {
                spawnedThisLevel = levelCustomers;
                spawnCustomer(0);
            });
            await advance(page, 5);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('clearing the wave awards a bonus', async ({ page }) => {
            await page.evaluate(() => {
                score = 0;
                spawnedThisLevel = levelCustomers;
            });
            await advance(page, 5);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
        });

        test('the next level starts after the break', async ({ page }) => {
            await page.evaluate(() => {
                spawnedThisLevel = levelCustomers;
            });
            await advance(page, 60 * 3);
            const s = await page.evaluate(() => ({ state, level, spawned: spawnedThisLevel }));
            expect(s).toEqual({ state: 'running', level: 2, spawned: 0 });
        });

        test('later levels have more patrons', async ({ page }) => {
            const first = await page.evaluate(() => levelCustomers);
            await page.evaluate(() => {
                spawnedThisLevel = levelCustomers;
            });
            await advance(page, 60 * 3);
            expect(await page.evaluate(() => levelCustomers)).toBeGreaterThan(first);
        });

        test('the HUD shows the new level', async ({ page }) => {
            await page.evaluate(() => {
                spawnedThisLevel = levelCustomers;
            });
            await advance(page, 60 * 3);
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // HUD and rendering
    // -----------------------------------------------------------------------
    test.describe('HUD and rendering', () => {
        test('the HUD score follows the game score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 675;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('675');
        });

        test('the canvas is actually drawn on', async ({ page }) => {
            await startFrozen(page);
            const painted = await page.evaluate(() => {
                draw();
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the help text documents the controls', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/space/i);
        });

        test('the animation loop runs on its own', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnEnabled = false;
                spawnCustomer(0);
            });
            const before = await page.evaluate(() => customers[0].x);
            await page.waitForFunction((x) => customers[0].x > x, before);
        });
    });
});
