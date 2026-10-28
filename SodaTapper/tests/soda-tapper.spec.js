const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a wave and freeze the animation loop, so a test can place patrons and
// mugs itself and advance the simulation one deterministic step at a time.
async function start(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
    });
}

// Push the spawn timer out of reach: the board then only holds what a test puts
// on it. Spawn progress is left alone so the wave cannot complete by accident.
async function quietSpawns(page) {
    await page.evaluate(() => {
        spawnTimer = 9999;
    });
}

// A frozen, empty bar with no incoming patrons.
async function emptyBar(page) {
    await start(page);
    await page.evaluate(() => {
        patrons.length = 0;
        mugs.length = 0;
        splashes.length = 0;
        spawnTimer = 9999;
    });
}

async function addPatron(page, patron) {
    await page.evaluate((p) => {
        patrons.push({
            lane: p.lane,
            x: p.x,
            state: p.state || 'advancing',
            pushTimer: p.pushTimer || 0,
            owed: p.owed === undefined ? 0 : p.owed,
        });
    }, patron);
}

async function addMug(page, mug) {
    await page.evaluate((m) => {
        mugs.push({
            lane: m.lane,
            x: m.x,
            dir: m.full === false ? 1 : -1,
            full: m.full !== false,
        });
    }, mug);
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(1 / 120);
    }, steps);
}

const read = (page, expr) => page.evaluate(expr);

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

        test('canvas is 640x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#wave')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await read(page, () => state)).toBe('idle');
        });

        test('the bar is empty before starting', async ({ page }) => {
            expect(await read(page, () => patrons.length)).toBe(0);
            expect(await read(page, () => mugs.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '8450'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('8450');
        });

        test('the help legend explains the lanes, pouring and catching', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/lane/i);
            await expect(page.locator('.help')).toContainText(/pour|serve/i);
            await expect(page.locator('.help')).toContainText(/catch/i);
        });

        test('there are four lanes', async ({ page }) => {
            expect(await read(page, () => LANE_COUNT)).toBe(4);
        });

        test('every lane sits inside the canvas', async ({ page }) => {
            const inside = await read(page, () => {
                for (let i = 0; i < LANE_COUNT; i++) {
                    const y = laneY(i);
                    if (y < 30 || y > H - 30) return false;
                }
                return true;
            });
            expect(inside).toBe(true);
        });

        test('the bar runs from the doorway to the taps', async ({ page }) => {
            const geometry = await read(page, () => ({
                barLeft: BAR_LEFT,
                grabX: GRAB_X,
                catchX: CATCH_X,
                tapX: TAP_X,
                shatterX: SHATTER_X,
                w: W,
            }));
            expect(geometry.barLeft).toBeGreaterThan(0);
            expect(geometry.barLeft).toBeLessThan(geometry.grabX);
            expect(geometry.grabX).toBeLessThan(geometry.tapX);
            expect(geometry.catchX).toBeLessThan(geometry.tapX);
            expect(geometry.shatterX).toBeGreaterThan(geometry.tapX);
            expect(geometry.shatterX).toBeLessThanOrEqual(geometry.w);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a wave
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await read(page, () => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await read(page, () => state)).toBe('running');
        });

        test('clicking the start overlay starts the game', async ({ page }) => {
            await page.locator('#overlay').click({ position: { x: 20, y: 20 } });
            expect(await read(page, () => state)).toBe('running');
        });

        test('the Start button advances exactly one step', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                spawnedThisWave = waveQuota;
            });
            await step(page, 1);
            await page.locator('#btn-start').click();
            expect(await read(page, () => ({ state, wave }))).toEqual({ state: 'running', wave: 2 });
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a fresh game starts on wave 1 with three lives and no score', async ({ page }) => {
            await start(page);
            expect(await read(page, () => ({ wave, lives, score }))).toEqual({
                wave: 1,
                lives: 3,
                score: 0,
            });
        });

        test('a fresh game has a wave quota and no progress', async ({ page }) => {
            await start(page);
            const s = await read(page, () => ({ waveQuota, spawnedThisWave, servedThisWave }));
            expect(s.waveQuota).toBe(5);
            expect(s.spawnedThisWave).toBe(0);
            expect(s.servedThisWave).toBe(0);
        });

        test('the bar starts empty and the tap is ready', async ({ page }) => {
            await start(page);
            expect(await read(page, () => patrons.length)).toBe(0);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => pourCooldown)).toBe(0);
        });

        test('the server starts in a real lane', async ({ page }) => {
            await start(page);
            const lane = await read(page, () => server.lane);
            expect(lane).toBeGreaterThanOrEqual(0);
            expect(lane).toBeLessThan(4);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between lanes
    // -----------------------------------------------------------------------
    test.describe('the server', () => {
        test('ArrowDown moves down a lane', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                server.lane = 1;
            });
            await page.keyboard.press('ArrowDown');
            expect(await read(page, () => server.lane)).toBe(2);
        });

        test('ArrowUp moves up a lane', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                server.lane = 2;
            });
            await page.keyboard.press('ArrowUp');
            expect(await read(page, () => server.lane)).toBe(1);
        });

        test('S and W move between lanes too', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                server.lane = 1;
            });
            await page.keyboard.press('KeyS');
            expect(await read(page, () => server.lane)).toBe(2);
            await page.keyboard.press('KeyW');
            expect(await read(page, () => server.lane)).toBe(1);
        });

        test('the server cannot walk off the top lane', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                server.lane = 0;
            });
            await page.keyboard.press('ArrowUp');
            expect(await read(page, () => server.lane)).toBe(0);
        });

        test('the server cannot walk off the bottom lane', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                server.lane = 3;
            });
            await page.keyboard.press('ArrowDown');
            expect(await read(page, () => server.lane)).toBe(3);
        });

        test('the mouse picks the lane under the pointer', async ({ page }) => {
            await start(page);
            const y = await read(page, () => laneY(3));
            await page.locator('#canvas').hover({ position: { x: 580, y } });
            expect(await read(page, () => server.lane)).toBe(3);
        });

        test('moving lanes does not score or spend a life', async ({ page }) => {
            await start(page);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowUp');
            expect(await read(page, () => ({ score, lives }))).toEqual({ score: 0, lives: 3 });
        });

        test('lane keys do nothing before the game starts', async ({ page }) => {
            const before = await read(page, () => server.lane);
            await page.keyboard.press('ArrowDown');
            expect(await read(page, () => server.lane)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test('Space pours a full mug into the server lane', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                server.lane = 2;
            });
            await page.keyboard.press('Space');
            const mug = await read(page, () => mugs[0]);
            expect(await read(page, () => mugs.length)).toBe(1);
            expect(mug.lane).toBe(2);
            expect(mug.full).toBe(true);
            expect(mug.dir).toBe(-1);
            expect(mug.x).toBe(await read(page, () => TAP_X));
        });

        test('clicking the bar pours as well', async ({ page }) => {
            await emptyBar(page);
            await page.locator('#canvas').click({ position: { x: 300, y: 200 } });
            expect(await read(page, () => mugs.length)).toBe(1);
        });

        test('pouring starts the tap cooldown', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => pour());
            expect(await read(page, () => pourCooldown)).toBeGreaterThan(0);
        });

        test('the cooldown blocks a second mug', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => pour());
            const second = await read(page, () => pour());
            expect(second).toBe(false);
            expect(await read(page, () => mugs.length)).toBe(1);
        });

        test('the cooldown runs down with time and the tap frees up', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => pour());
            await step(page, 40); // 1/3 s, longer than POUR_COOLDOWN
            expect(await read(page, () => pourCooldown)).toBe(0);
            expect(await read(page, () => pour())).toBe(true);
            expect(await read(page, () => mugs.length)).toBe(2);
        });

        test('pouring while paused does nothing', async ({ page }) => {
            await emptyBar(page);
            await page.keyboard.press('KeyP');
            expect(await read(page, () => pour())).toBe(false);
            expect(await read(page, () => mugs.length)).toBe(0);
        });

        test('each pour lands in the lane the server is standing in', async ({ page }) => {
            await emptyBar(page);
            for (const lane of [0, 1, 2, 3]) {
                await page.evaluate((l) => {
                    server.lane = l;
                    pourCooldown = 0;
                    pour();
                }, lane);
            }
            expect(await read(page, () => mugs.map((m) => m.lane))).toEqual([0, 1, 2, 3]);
        });
    });

    // -----------------------------------------------------------------------
    // Mugs sliding down the bar
    // -----------------------------------------------------------------------
    test.describe('a full mug', () => {
        test('slides toward the doorway', async ({ page }) => {
            await emptyBar(page);
            await addMug(page, { lane: 1, x: 400 });
            await step(page, 60); // half a second
            const x = await read(page, () => mugs[0].x);
            expect(x).toBeCloseTo(400 - 185 / 2, 0);
        });

        test('stays in its own lane', async ({ page }) => {
            await emptyBar(page);
            await addMug(page, { lane: 3, x: 400 });
            await step(page, 30);
            expect(await read(page, () => mugs[0].lane)).toBe(3);
        });

        test('reaching the doorway smashes and costs a life', async ({ page }) => {
            await emptyBar(page);
            await addMug(page, { lane: 0, x: await read(page, () => BAR_LEFT + 4) });
            await step(page, 10);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => lives)).toBe(2);
        });

        test('a smash leaves a splash behind', async ({ page }) => {
            await emptyBar(page);
            await addMug(page, { lane: 0, x: await read(page, () => BAR_LEFT + 4) });
            await step(page, 10);
            expect(await read(page, () => splashes.length)).toBeGreaterThan(0);
        });

        test('a smash does not score', async ({ page }) => {
            await emptyBar(page);
            await addMug(page, { lane: 0, x: await read(page, () => BAR_LEFT + 4) });
            await step(page, 10);
            expect(await read(page, () => score)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving patrons
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('a mug reaching a patron starts them drinking', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: 300 });
            await addMug(page, { lane: 1, x: 315 });
            await step(page, 2);
            expect(await read(page, () => patrons[0].state)).toBe('drinking');
        });

        test('the mug is consumed by the patron', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: 300 });
            await addMug(page, { lane: 1, x: 315 });
            await step(page, 2);
            expect(await read(page, () => mugs.length)).toBe(0);
        });

        test('a drinking patron is pushed back toward the door', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: 300 });
            await addMug(page, { lane: 1, x: 315 });
            await step(page, 2);
            const before = await read(page, () => patrons[0].x);
            await step(page, 30);
            expect(await read(page, () => patrons[0].x)).toBeLessThan(before);
        });

        test('a mug only touches patrons in its own lane', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 2, x: 300 });
            await addMug(page, { lane: 1, x: 315 });
            await step(page, 2);
            expect(await read(page, () => patrons[0].state)).toBe('advancing');
            expect(await read(page, () => mugs.length)).toBe(1);
        });

        test('a mug reaches the patron nearest the taps first', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: 200 });
            await addPatron(page, { lane: 1, x: 320 });
            await addMug(page, { lane: 1, x: 335 });
            await step(page, 2);
            const states = await read(page, () => patrons.map((p) => p.state));
            expect(states).toEqual(['advancing', 'drinking']);
        });

        test('finishing a drink sends an empty mug back up the bar', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: 300, state: 'drinking', pushTimer: 0.02, owed: 1 });
            await step(page, 4);
            const mug = await read(page, () => mugs[0]);
            expect(mug.full).toBe(false);
            expect(mug.dir).toBe(1);
            expect(mug.lane).toBe(1);
        });

        test('a patron goes back to advancing once the drink is done', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: 300, state: 'drinking', pushTimer: 0.02, owed: 1 });
            await step(page, 4);
            expect(await read(page, () => patrons[0].state)).toBe('advancing');
        });

        test('topping up a drinking patron pushes them further', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: 300, state: 'drinking', pushTimer: 0.1, owed: 1 });
            await addMug(page, { lane: 1, x: 312 });
            await step(page, 2);
            expect(await read(page, () => patrons[0].pushTimer)).toBeGreaterThan(0.5);
        });

        test('topping up still returns only one empty mug', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: 300, state: 'drinking', pushTimer: 0.1, owed: 1 });
            await addMug(page, { lane: 1, x: 312 });
            await step(page, 2);
            expect(await read(page, () => patrons[0].owed)).toBe(1);
        });

        test('a patron pushed out of the door is served and scores', async ({ page }) => {
            await emptyBar(page);
            const x = await read(page, () => BAR_LEFT + 2);
            await addPatron(page, { lane: 1, x, state: 'drinking', pushTimer: 0.5, owed: 1 });
            await step(page, 10);
            expect(await read(page, () => patrons.length)).toBe(0);
            expect(await read(page, () => score)).toBe(150);
            expect(await read(page, () => servedThisWave)).toBe(1);
        });

        test('a served patron leaves their empty mug on the bar', async ({ page }) => {
            await emptyBar(page);
            const x = await read(page, () => BAR_LEFT + 2);
            await addPatron(page, { lane: 2, x, state: 'drinking', pushTimer: 0.5, owed: 1 });
            await step(page, 10);
            const mug = await read(page, () => mugs[0]);
            expect(mug.full).toBe(false);
            expect(mug.lane).toBe(2);
            expect(mug.x).toBeGreaterThanOrEqual(await read(page, () => BAR_LEFT));
        });

        test('a patron advances toward the taps on their own', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: 200 });
            await step(page, 120); // one second
            const x = await read(page, () => patrons[0].x);
            expect(x).toBeGreaterThan(200);
            expect(x).toBeCloseTo(200 + 26, 0);
        });
    });

    // -----------------------------------------------------------------------
    // Catching empties
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test('an empty mug slides back toward the taps', async ({ page }) => {
            await emptyBar(page);
            await addMug(page, { lane: 1, x: 200, full: false });
            await step(page, 60);
            expect(await read(page, () => mugs[0].x)).toBeCloseTo(200 + 150 / 2, 0);
        });

        test('the server catches an empty in their own lane', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                server.lane = 1;
            });
            await addMug(page, { lane: 1, x: await read(page, () => CATCH_X - 2), full: false });
            await step(page, 4);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => score)).toBe(25);
            expect(await read(page, () => lives)).toBe(3);
        });

        test('an empty in another lane runs past the server and smashes', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                server.lane = 0;
            });
            await addMug(page, { lane: 3, x: await read(page, () => CATCH_X - 2), full: false });
            await step(page, 90);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => lives)).toBe(2);
            expect(await read(page, () => score)).toBe(0);
        });

        test('the catch window gives the server time to arrive', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                server.lane = 0;
            });
            await addMug(page, { lane: 2, x: await read(page, () => CATCH_X - 20), full: false });
            await step(page, 14);
            expect(await read(page, () => mugs.length)).toBe(1); // still travelling
            await page.evaluate(() => {
                server.lane = 2;
            });
            await step(page, 10);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => score)).toBe(25);
        });

        test('a smashed empty leaves a splash', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                server.lane = 0;
            });
            await addMug(page, { lane: 3, x: await read(page, () => SHATTER_X - 2), full: false });
            await step(page, 4);
            expect(await read(page, () => splashes.length)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Patrons reaching the taps
    // -----------------------------------------------------------------------
    test.describe('a patron reaching the taps', () => {
        test('costs a life', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: await read(page, () => GRAB_X - 1) });
            await step(page, 10);
            expect(await read(page, () => lives)).toBe(2);
        });

        test('removes the patron from the bar', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: await read(page, () => GRAB_X - 1) });
            await step(page, 10);
            expect(await read(page, () => patrons.length)).toBe(0);
        });

        test('does not score', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: await read(page, () => GRAB_X - 1) });
            await step(page, 10);
            expect(await read(page, () => score)).toBe(0);
        });

        test('does not count toward the wave quota', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: await read(page, () => GRAB_X - 1) });
            await step(page, 10);
            expect(await read(page, () => servedThisWave)).toBe(0);
        });

        test('a drinking patron at the taps is safe', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, {
                lane: 1,
                x: await read(page, () => GRAB_X - 1),
                state: 'drinking',
                pushTimer: 0.6,
                owed: 1,
            });
            await step(page, 10);
            expect(await read(page, () => lives)).toBe(3);
            expect(await read(page, () => patrons.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('running out of lives ends the game', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                lives = 1;
            });
            await addMug(page, { lane: 0, x: await read(page, () => BAR_LEFT + 4) });
            await step(page, 10);
            expect(await read(page, () => state)).toBe('gameover');
            expect(await read(page, () => lives)).toBe(0);
        });

        test('the overlay announces the game over', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                lives = 1;
            });
            await addMug(page, { lane: 0, x: await read(page, () => BAR_LEFT + 4) });
            await step(page, 10);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the final score is shown on the overlay', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                lives = 1;
                score = 900;
            });
            await addMug(page, { lane: 0, x: await read(page, () => BAR_LEFT + 4) });
            await step(page, 10);
            await expect(page.locator('#overlay-score')).toContainText('900');
        });

        test('a new best score is saved', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                lives = 1;
                score = 1234;
            });
            await addMug(page, { lane: 0, x: await read(page, () => BAR_LEFT + 4) });
            await step(page, 10);
            expect(await read(page, () => window.localStorage.getItem('sodatapper-best'))).toBe('1234');
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '5000'));
            await page.reload();
            await emptyBar(page);
            await page.evaluate(() => {
                lives = 1;
                score = 10;
            });
            await addMug(page, { lane: 0, x: await read(page, () => BAR_LEFT + 4) });
            await step(page, 10);
            expect(await read(page, () => window.localStorage.getItem('sodatapper-best'))).toBe('5000');
        });

        test('the simulation stops once the game is over', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                lives = 1;
            });
            await addMug(page, { lane: 0, x: await read(page, () => BAR_LEFT + 4) });
            await addPatron(page, { lane: 2, x: 200 });
            await step(page, 10);
            const x = await read(page, () => patrons[0].x);
            await step(page, 120);
            expect(await read(page, () => patrons[0].x)).toBe(x);
        });

        test('Space starts a brand new game from the game over screen', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                lives = 1;
                score = 700;
                wave = 4;
            });
            await addMug(page, { lane: 0, x: await read(page, () => BAR_LEFT + 4) });
            await step(page, 10);
            await page.keyboard.press('Space');
            expect(await read(page, () => ({ state, score, lives, wave }))).toEqual({
                state: 'running',
                score: 0,
                lives: 3,
                wave: 1,
            });
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses a running game', async ({ page }) => {
            await start(page);
            await page.keyboard.press('KeyP');
            expect(await read(page, () => state)).toBe('paused');
        });

        test('the pause overlay appears', async ({ page }) => {
            await start(page);
            await page.keyboard.press('KeyP');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });

        test('nothing moves while paused', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 1, x: 200 });
            await page.keyboard.press('KeyP');
            await step(page, 120);
            expect(await read(page, () => patrons[0].x)).toBe(200);
        });

        test('P resumes and hides the overlay', async ({ page }) => {
            await start(page);
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            expect(await read(page, () => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('P does nothing before the game starts', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await read(page, () => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Spawning
    // -----------------------------------------------------------------------
    test.describe('spawning', () => {
        test('the spawn timer counts down', async ({ page }) => {
            await start(page);
            const before = await read(page, () => spawnTimer);
            await step(page, 12);
            expect(await read(page, () => spawnTimer)).toBeLessThan(before);
        });

        test('patrons arrive at the doorway', async ({ page }) => {
            await start(page);
            await step(page, 240);
            const patron = await read(page, () => patrons[0]);
            expect(patron).toBeTruthy();
            expect(patron.state).toBe('advancing');
            expect(patron.x).toBeGreaterThanOrEqual(await read(page, () => BAR_LEFT));
            expect(patron.x).toBeLessThan(200);
        });

        test('arrivals land in real lanes', async ({ page }) => {
            await start(page);
            await step(page, 1200);
            const ok = await read(page, () =>
                patrons.every((p) => Number.isInteger(p.lane) && p.lane >= 0 && p.lane < LANE_COUNT)
            );
            expect(ok).toBe(true);
        });

        test('no more than the wave quota ever arrives', async ({ page }) => {
            await start(page);
            await step(page, 7200); // a full minute of simulated time
            expect(await read(page, () => spawnedThisWave)).toBeLessThanOrEqual(
                await read(page, () => waveQuota)
            );
        });

        test('a lane never holds more than MAX_PER_LANE patrons', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                wave = 9;
                waveQuota = waveQuotaFor(9);
            });
            await step(page, 3600);
            const counts = await read(page, () => {
                const byLane = [0, 0, 0, 0];
                patrons.forEach((p) => byLane[p.lane]++);
                return byLane;
            });
            const max = await read(page, () => MAX_PER_LANE);
            counts.forEach((c) => expect(c).toBeLessThanOrEqual(max));
        });

        test('arrivals never stack on top of each other', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                seedRng(99);
            });
            await step(page, 2400);
            const spaced = await read(page, () => {
                for (let i = 0; i < patrons.length; i++) {
                    for (let j = i + 1; j < patrons.length; j++) {
                        if (patrons[i].lane !== patrons[j].lane) continue;
                        if (Math.abs(patrons[i].x - patrons[j].x) < 12) return false;
                    }
                }
                return true;
            });
            expect(spaced).toBe(true);
        });

        test('the same seed replays the same arrivals', async ({ page }) => {
            const run = async (seed) => {
                await page.reload();
                await page.evaluate((s) => {
                    seedRng(s);
                    startGame();
                    autoRun = false;
                }, seed);
                await step(page, 1800);
                return read(page, () => patrons.map((p) => [p.lane, Math.round(p.x)]));
            };
            const first = await run(7);
            const second = await run(7);
            expect(second).toEqual(first);
        });
    });

    // -----------------------------------------------------------------------
    // Waves and difficulty
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('clearing the bar after the last arrival finishes the wave', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                spawnedThisWave = waveQuota;
            });
            await step(page, 1);
            expect(await read(page, () => state)).toBe('waveclear');
        });

        test('an unfinished bar keeps the wave running', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                spawnedThisWave = waveQuota;
            });
            await addPatron(page, { lane: 1, x: 200 });
            await step(page, 1);
            expect(await read(page, () => state)).toBe('running');
        });

        test('mugs still on the bar keep the wave running', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                spawnedThisWave = waveQuota;
            });
            await addMug(page, { lane: 1, x: 300 });
            await step(page, 1);
            expect(await read(page, () => state)).toBe('running');
        });

        test('finishing a wave pays a bonus', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                spawnedThisWave = waveQuota;
                score = 100;
            });
            await step(page, 1);
            expect(await read(page, () => score)).toBe(100 + 200);
        });

        test('the overlay reports the finished wave', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                spawnedThisWave = waveQuota;
            });
            await step(page, 1);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/wave/i);
        });

        test('Space starts the next wave', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                spawnedThisWave = waveQuota;
            });
            await step(page, 1);
            await page.keyboard.press('Space');
            expect(await read(page, () => ({ state, wave }))).toEqual({ state: 'running', wave: 2 });
        });

        test('the next wave keeps the score and lives', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                spawnedThisWave = waveQuota;
                score = 400;
                lives = 2;
            });
            await step(page, 1);
            await page.keyboard.press('Space');
            expect(await read(page, () => ({ score, lives }))).toEqual({ score: 600, lives: 2 });
        });

        test('the next wave resets the bar and the progress counters', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                spawnedThisWave = waveQuota;
                servedThisWave = 3;
            });
            await step(page, 1);
            await page.keyboard.press('Space');
            const s = await read(page, () => ({
                spawned: spawnedThisWave,
                served: servedThisWave,
                patrons: patrons.length,
                mugs: mugs.length,
            }));
            expect(s).toEqual({ spawned: 0, served: 0, patrons: 0, mugs: 0 });
        });

        test('later waves ask for more patrons', async ({ page }) => {
            const quotas = await read(page, () => [1, 2, 3, 6].map((w) => waveQuotaFor(w)));
            expect(quotas[1]).toBeGreaterThan(quotas[0]);
            expect(quotas[2]).toBeGreaterThan(quotas[1]);
            expect(quotas[3]).toBeGreaterThan(quotas[2]);
        });

        test('the quota is capped', async ({ page }) => {
            const quota = await read(page, () => waveQuotaFor(99));
            expect(quota).toBe(await read(page, () => QUOTA_MAX));
        });

        test('patrons get faster in later waves', async ({ page }) => {
            const speeds = await read(page, () => [1, 2, 5].map((w) => patronSpeed(w)));
            expect(speeds[1]).toBeGreaterThan(speeds[0]);
            expect(speeds[2]).toBeGreaterThan(speeds[1]);
        });

        test('patron speed is capped', async ({ page }) => {
            expect(await read(page, () => patronSpeed(99))).toBe(
                await read(page, () => PATRON_SPEED_MAX)
            );
        });

        test('arrivals come faster in later waves', async ({ page }) => {
            const gaps = await read(page, () => {
                const sample = (w) => {
                    wave = w;
                    seedRng(1);
                    return spawnInterval();
                };
                const first = sample(1);
                const later = sample(6);
                wave = 1;
                return [first, later];
            });
            expect(gaps[1]).toBeLessThan(gaps[0]);
        });

        test('the push is faster than any patron can walk', async ({ page }) => {
            const [push, walk] = await read(page, () => [PUSH_SPEED, PATRON_SPEED_MAX]);
            expect(push).toBeGreaterThan(walk);
        });

        // The balance rule the difficulty curve rests on: spreading mugs evenly
        // stops working in the late waves, but a lane you commit to is never lost.
        test('a lane fed continuously drives a patron out of the door', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                wave = 20;              // patrons at PATRON_SPEED_MAX
                server.lane = 2;
            });
            await addPatron(page, { lane: 2, x: 400 });
            const served = await page.evaluate(() => {
                for (let i = 0; i < 2400; i++) {   // twenty simulated seconds
                    pour();
                    physicsStep(1 / 120);
                    if (!patrons.length) return true;
                }
                return false;
            });
            expect(served).toBe(true);
            expect(await read(page, () => servedThisWave)).toBe(1);
        });

        test('the arrival gap never drops below the floor', async ({ page }) => {
            const gap = await read(page, () => {
                wave = 50;
                seedRng(1);
                const g = spawnInterval();
                wave = 1;
                return g;
            });
            expect(gap).toBeGreaterThanOrEqual(await read(page, () => SPAWN_MIN));
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('the HUD', () => {
        test('the score updates when a patron is served', async ({ page }) => {
            await emptyBar(page);
            const x = await read(page, () => BAR_LEFT + 2);
            await addPatron(page, { lane: 1, x, state: 'drinking', pushTimer: 0.5, owed: 1 });
            await step(page, 10);
            await expect(page.locator('#score')).toHaveText('150');
        });

        test('the lives counter drops when a mug smashes', async ({ page }) => {
            await emptyBar(page);
            await addMug(page, { lane: 0, x: await read(page, () => BAR_LEFT + 4) });
            await step(page, 10);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the wave counter follows the wave', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                spawnedThisWave = waveQuota;
            });
            await step(page, 1);
            await page.keyboard.press('Space');
            await expect(page.locator('#wave')).toHaveText('2');
        });

        test('the remaining counter shows the patrons still to deal with', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                spawnedThisWave = 2;
                updateHud();
            });
            await expect(page.locator('#left')).toHaveText('3');
            await addPatron(page, { lane: 1, x: 200 });
            await page.evaluate(() => updateHud());
            await expect(page.locator('#left')).toHaveText('4');
        });

        test('the remaining counter reaches zero as the wave ends', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                spawnedThisWave = waveQuota;
            });
            await step(page, 1);
            await expect(page.locator('#left')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the idle bar is drawn, not blank', async ({ page }) => {
            const distinct = await read(page, () => {
                const data = ctx.getImageData(0, 0, W, H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(distinct).toBeGreaterThan(3);
        });

        test('drawing a busy bar does not throw', async ({ page }) => {
            await emptyBar(page);
            await addPatron(page, { lane: 0, x: 150 });
            await addPatron(page, { lane: 1, x: 260, state: 'drinking', pushTimer: 0.4, owed: 1 });
            await addMug(page, { lane: 2, x: 400 });
            await addMug(page, { lane: 3, x: 220, full: false });
            await page.evaluate(() => {
                splashes.push({ x: 200, y: laneY(0), age: 0, life: 0.4, color: '#fff' });
            });
            const error = await page.evaluate(() => {
                try {
                    draw();
                    return null;
                } catch (e) {
                    return String(e);
                }
            });
            expect(error).toBeNull();
        });

        test('drawing every overlay state works', async ({ page }) => {
            const error = await page.evaluate(() => {
                try {
                    for (const s of ['idle', 'running', 'paused', 'waveclear', 'gameover']) {
                        state = s;
                        draw();
                    }
                    state = 'idle';
                    return null;
                } catch (e) {
                    return String(e);
                }
            });
            expect(error).toBeNull();
        });

        test('splashes fade away', async ({ page }) => {
            await emptyBar(page);
            await page.evaluate(() => {
                splashes.push({ x: 200, y: laneY(0), age: 0, life: 0.2, color: '#fff' });
            });
            await step(page, 60);
            expect(await read(page, () => splashes.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // A longer unattended run — the bar must never wedge or corrupt itself
    // -----------------------------------------------------------------------
    test.describe('soak', () => {
        test('two minutes of simulation keeps every invariant', async ({ page }) => {
            await page.evaluate(() => {
                seedRng(2024);
                startGame();
                autoRun = false;
            });
            const bad = await page.evaluate(() => {
                const problems = [];
                for (let i = 0; i < 14400; i++) {
                    physicsStep(1 / 120);
                    if (state === 'waveclear') advance();
                    if (state === 'gameover') break;
                    if (i % 37 === 0) {
                        server.lane = (server.lane + 1) % LANE_COUNT;
                        pour();
                    }
                    patrons.forEach((p) => {
                        if (p.x < BAR_LEFT - 2 || p.x > GRAB_X + 2) problems.push(`patron x ${p.x}`);
                        if (p.lane < 0 || p.lane >= LANE_COUNT) problems.push(`patron lane ${p.lane}`);
                        if (p.state !== 'advancing' && p.state !== 'drinking') {
                            problems.push(`patron state ${p.state}`);
                        }
                    });
                    mugs.forEach((m) => {
                        if (m.x < BAR_LEFT - 4 || m.x > SHATTER_X + 4) problems.push(`mug x ${m.x}`);
                        if (m.lane < 0 || m.lane >= LANE_COUNT) problems.push(`mug lane ${m.lane}`);
                    });
                    if (lives < 0) problems.push(`lives ${lives}`);
                    if (score < 0) problems.push(`score ${score}`);
                    if (problems.length) break;
                }
                return problems.slice(0, 5);
            });
            expect(bad).toEqual([]);
        });

        test('a hands-off bar eventually ends the game rather than wedging', async ({ page }) => {
            await page.evaluate(() => {
                seedRng(5);
                startGame();
                autoRun = false;
            });
            await page.evaluate(() => {
                for (let i = 0; i < 36000 && state === 'running'; i++) physicsStep(1 / 120);
            });
            expect(await read(page, () => state)).toBe('gameover');
        });
    });

    // -----------------------------------------------------------------------
    // Repo integration
    // -----------------------------------------------------------------------
    test.describe('repo integration', () => {
        test('the game browser lists the game', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'soda-tapper');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Soda Tapper');
            expect(entry.dir).toBe('SodaTapper');
            expect(entry.path).toBe('games/SodaTapper/index.html');
            expect(entry.thumbnail).toBe('games/SodaTapper/screenshot.png');
            expect(entry.category).toBe('Action');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const i = games.findIndex((g) => g.id === 'soda-tapper');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            if (i + 1 < games.length) {
                expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
            }
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaTapper/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(
                /\|\s*Soda Tapper\s*\|\s*\[SodaTapper\/\]\(SodaTapper\/\)\s*\|\s*(Complete|In Progress)\s*\|/
            );
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaTapper/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaTapper/DESIGN.md'))).toBe(true);
        });
    });
});
