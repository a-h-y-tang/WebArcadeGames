const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a run and switch the animation loop off so a test can place customers
// and mugs itself and advance the simulation one fixed step at a time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
    });
}

// Empty the bar completely: nobody waiting, nobody walking, nothing in flight.
async function clearBar(page) {
    await page.evaluate(() => {
        customers.length = 0;
        mugs.length = 0;
        spawnQueue.length = 0;
    });
}

async function setLane(page, lane) {
    await page.evaluate((l) => {
        server.lane = l;
    }, lane);
}

async function addCustomer(page, c) {
    await page.evaluate((spec) => {
        customers.push({
            lane: spec.lane,
            x: spec.x,
            phase: spec.phase || 'advancing',
            drinkTimer: spec.drinkTimer || 0,
        });
    }, c);
}

// Park an inert customer on counter 0 so the bar is never empty: a wave that
// completes pays a bonus, which would show up in a test that is measuring the
// points from one serve or catch.
async function holdWave(page) {
    await page.evaluate(() => {
        customers.push({ lane: 0, x: 100, phase: 'drinking', drinkTimer: 1e9 });
    });
}

async function addMug(page, m) {
    await page.evaluate((spec) => {
        mugs.push({ lane: spec.lane, x: spec.x, kind: spec.kind });
    }, m);
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(DT);
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

        test('canvas is 760x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '760');
            await expect(canvas).toHaveAttribute('height', '600');
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
            await expect(page.locator('#served')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await read(page, () => state)).toBe('idle');
        });

        test('the bar is empty before starting', async ({ page }) => {
            expect(await read(page, () => customers.length)).toBe(0);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => spawnQueue.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '4825'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4825');
        });

        test('there are four counters', async ({ page }) => {
            expect(await read(page, () => LANES)).toBe(4);
        });

        test('every lane sits inside the canvas', async ({ page }) => {
            const inside = await read(page, () => {
                for (let i = 0; i < LANES; i++) {
                    const y = laneY(i);
                    if (y < 40 || y > H - 40) return false;
                }
                return true;
            });
            expect(inside).toBe(true);
        });

        test('the tap line is right of the door end', async ({ page }) => {
            expect(await read(page, () => TAP_X)).toBeGreaterThan(await read(page, () => BAR_LEFT));
        });

        test('the grab line is just short of the tap line', async ({ page }) => {
            const grab = await read(page, () => GRAB_X);
            const tap = await read(page, () => TAP_X);
            expect(grab).toBeLessThan(tap);
            expect(grab).toBeGreaterThan(await read(page, () => CLOSE_X));
        });

        test('the help legend explains moving and pouring', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/counter|lane/i);
            await expect(page.locator('.help')).toContainText(/pour/i);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
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

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a run starts on wave 1 with three lives and no score', async ({ page }) => {
            await startFrozen(page);
            expect(await read(page, () => wave)).toBe(1);
            expect(await read(page, () => lives)).toBe(await read(page, () => LIVES_START));
            expect(await read(page, () => score)).toBe(0);
        });

        test('wave 1 queues up customers', async ({ page }) => {
            await startFrozen(page);
            expect(await read(page, () => spawnQueue.length)).toBeGreaterThan(0);
        });

        test('the server starts on a real counter', async ({ page }) => {
            await startFrozen(page);
            const lane = await read(page, () => server.lane);
            expect(lane).toBeGreaterThanOrEqual(0);
            expect(lane).toBeLessThan(await read(page, () => LANES));
        });

        test('nothing is on the bar on the first frame of a wave', async ({ page }) => {
            await startFrozen(page);
            expect(await read(page, () => customers.length)).toBe(0);
            expect(await read(page, () => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Wave schedules
    // -----------------------------------------------------------------------
    test.describe('wave schedules', () => {
        test('buildWave is deterministic', async ({ page }) => {
            const same = await read(page, () =>
                JSON.stringify(buildWave(3)) === JSON.stringify(buildWave(3))
            );
            expect(same).toBe(true);
        });

        test('later waves bring more customers', async ({ page }) => {
            const counts = await read(page, () => [1, 2, 3, 4, 5].map((n) => buildWave(n).length));
            expect(counts[0]).toBe(8);
            for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
        });

        test('every spawn targets a real lane at a positive time', async ({ page }) => {
            const ok = await read(page, () =>
                buildWave(4).every((s) => s.lane >= 0 && s.lane < LANES && s.t > 0)
            );
            expect(ok).toBe(true);
        });

        test('spawn times are sorted', async ({ page }) => {
            const sorted = await read(page, () => {
                const w = buildWave(5);
                return w.every((s, i) => i === 0 || s.t >= w[i - 1].t);
            });
            expect(sorted).toBe(true);
        });

        test('a wave uses more than one lane', async ({ page }) => {
            const lanes = await read(page, () => new Set(buildWave(2).map((s) => s.lane)).size);
            expect(lanes).toBeGreaterThan(1);
        });

        test('later waves walk faster', async ({ page }) => {
            const speeds = await read(page, () => [1, 3, 5].map((n) => customerSpeed(n)));
            expect(speeds[1]).toBeGreaterThan(speeds[0]);
            expect(speeds[2]).toBeGreaterThan(speeds[1]);
        });

        test('queued customers walk onto the bar when due', async ({ page }) => {
            await startFrozen(page);
            const firstT = await read(page, () => spawnQueue[0].t);
            await step(page, Math.ceil((firstT + 0.1) * 120));
            expect(await read(page, () => customers.length)).toBeGreaterThan(0);
        });

        test('a spawned customer enters at the door end, advancing', async ({ page }) => {
            await startFrozen(page);
            const firstT = await read(page, () => spawnQueue[0].t);
            await step(page, Math.ceil((firstT + 0.01) * 120));
            const c = await read(page, () => customers[0]);
            expect(c.phase).toBe('advancing');
            expect(c.x).toBeLessThan(120);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between counters
    // -----------------------------------------------------------------------
    test.describe('moving', () => {
        test('ArrowDown moves down a counter', async ({ page }) => {
            await startFrozen(page);
            await setLane(page, 1);
            await page.keyboard.press('ArrowDown');
            expect(await read(page, () => server.lane)).toBe(2);
        });

        test('ArrowUp moves up a counter', async ({ page }) => {
            await startFrozen(page);
            await setLane(page, 2);
            await page.keyboard.press('ArrowUp');
            expect(await read(page, () => server.lane)).toBe(1);
        });

        test('W and S move too', async ({ page }) => {
            await startFrozen(page);
            await setLane(page, 1);
            await page.keyboard.press('KeyS');
            expect(await read(page, () => server.lane)).toBe(2);
            await page.keyboard.press('KeyW');
            expect(await read(page, () => server.lane)).toBe(1);
        });

        test('the server cannot walk off the top', async ({ page }) => {
            await startFrozen(page);
            await setLane(page, 0);
            await page.keyboard.press('ArrowUp');
            expect(await read(page, () => server.lane)).toBe(0);
        });

        test('the server cannot walk off the bottom', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                server.lane = LANES - 1;
            });
            await page.keyboard.press('ArrowDown');
            expect(await read(page, () => server.lane)).toBe(await read(page, () => LANES - 1));
        });

        test('the mouse jumps the server to the counter under the pointer', async ({ page }) => {
            await startFrozen(page);
            await setLane(page, 0);
            const box = await page.locator('#canvas').boundingBox();
            const y = await read(page, () => laneY(2));
            await page.mouse.move(box.x + 300, box.y + y);
            expect(await read(page, () => server.lane)).toBe(2);
        });

        test('moving does nothing before the game starts', async ({ page }) => {
            const before = await read(page, () => server.lane);
            await page.keyboard.press('ArrowDown');
            expect(await read(page, () => server.lane)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test('pouring puts a full mug on the server\'s counter at the tap', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await setLane(page, 2);
            await page.evaluate(() => pour());
            const mug = await read(page, () => mugs[0]);
            expect(mug.kind).toBe('full');
            expect(mug.lane).toBe(2);
            expect(mug.x).toBe(await read(page, () => TAP_X));
        });

        test('Space pours while running', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await page.keyboard.press('Space');
            expect(await read(page, () => mugs.length)).toBe(1);
        });

        test('clicking the bar pours', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await page.locator('#canvas').click({ position: { x: 300, y: 105 } });
            expect(await read(page, () => mugs.length)).toBe(1);
        });

        test('the cooldown blocks an instant second pour', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            expect(await read(page, () => pour())).toBe(true);
            expect(await read(page, () => pour())).toBe(false);
            expect(await read(page, () => mugs.length)).toBe(1);
        });

        test('pouring works again once the cooldown elapses', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await page.evaluate(() => pour());
            const cooldown = await read(page, () => POUR_COOLDOWN);
            await step(page, Math.ceil(cooldown * 120) + 2);
            expect(await read(page, () => pour())).toBe(true);
            expect(await read(page, () => mugs.length)).toBe(2);
        });

        test('pouring does nothing when the game is not running', async ({ page }) => {
            expect(await read(page, () => pour())).toBe(false);
            expect(await read(page, () => mugs.length)).toBe(0);
        });

        test('a full mug slides toward the door end', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await page.evaluate(() => pour());
            const before = await read(page, () => mugs[0].x);
            await step(page, 60);
            const after = await read(page, () => mugs[0].x);
            expect(after).toBeLessThan(before);
            expect(before - after).toBeCloseTo(await read(page, () => MUG_SPEED * 0.5), 0);
        });

        test('a mug stays in the lane it was poured in', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await setLane(page, 3);
            await page.evaluate(() => pour());
            await step(page, 60);
            expect(await read(page, () => mugs[0].lane)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('a mug reaching a customer is taken and scores', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addCustomer(page, { lane: 1, x: 300 });
            await addMug(page, { lane: 1, x: 330, kind: 'full' });
            await step(page, 40);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => customers[0].phase)).toBe('drinking');
            expect(await read(page, () => score)).toBe(await read(page, () => SERVE_POINTS));
            expect(await read(page, () => served)).toBe(1);
        });

        test('serving close to the taps pays the close-call bonus', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            const closeX = await read(page, () => CLOSE_X);
            await addCustomer(page, { lane: 0, x: closeX + 40 });
            await addMug(page, { lane: 0, x: closeX + 70, kind: 'full' });
            await step(page, 40);
            const expected = await read(page, () => SERVE_POINTS + CLOSE_BONUS);
            expect(await read(page, () => score)).toBe(expected);
        });

        test('serving far from the taps pays no bonus', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addCustomer(page, { lane: 0, x: 200 });
            await addMug(page, { lane: 0, x: 230, kind: 'full' });
            await step(page, 40);
            expect(await read(page, () => score)).toBe(await read(page, () => SERVE_POINTS));
        });

        test('a mug only serves customers in its own lane', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addCustomer(page, { lane: 2, x: 300 });
            await addMug(page, { lane: 1, x: 330, kind: 'full' });
            await step(page, 40);
            expect(await read(page, () => customers[0].phase)).toBe('advancing');
            expect(await read(page, () => mugs.length)).toBe(1);
        });

        test('a mug serves the frontmost customer in the lane', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addCustomer(page, { lane: 1, x: 200 });
            await addCustomer(page, { lane: 1, x: 400 });
            await addMug(page, { lane: 1, x: 430, kind: 'full' });
            await step(page, 40);
            const phases = await read(page, () => customers.map((c) => [Math.round(c.x), c.phase]));
            const front = phases.find(([x]) => x > 300);
            const back = phases.find(([x]) => x < 300);
            expect(front[1]).toBe('drinking');
            expect(back[1]).toBe('advancing');
        });

        test('a mug slides past a drinking customer to the one behind', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addCustomer(page, { lane: 1, x: 400, phase: 'drinking', drinkTimer: 99 });
            await addCustomer(page, { lane: 1, x: 250 });
            await addMug(page, { lane: 1, x: 430, kind: 'full' });
            await step(page, 120);
            const phases = await read(page, () => customers.map((c) => c.phase));
            expect(phases.filter((p) => p === 'drinking').length).toBe(2);
        });

        test('a drinking customer does not advance', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addCustomer(page, { lane: 1, x: 300, phase: 'drinking', drinkTimer: 99 });
            await step(page, 60);
            expect(await read(page, () => customers[0].x)).toBe(300);
        });

        test('a customer who finishes drinking leaves and releases an empty mug', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addCustomer(page, { lane: 2, x: 300, phase: 'drinking', drinkTimer: 0.04 });
            await step(page, 6);
            expect(await read(page, () => customers[0].phase)).toBe('leaving');
            const mug = await read(page, () => mugs[0]);
            expect(mug.kind).toBe('empty');
            expect(mug.lane).toBe(2);
            expect(mug.x).toBeGreaterThanOrEqual(295);
            expect(mug.x).toBeLessThanOrEqual(305);
        });

        test('a served customer walks back out and is removed at the door', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addCustomer(page, { lane: 2, x: 120, phase: 'leaving' });
            await step(page, 120);
            expect(await read(page, () => customers.length)).toBe(0);
            expect(await read(page, () => lives)).toBe(await read(page, () => LIVES_START));
        });

        test('a drink takes DRINK_TIME seconds', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addCustomer(page, { lane: 1, x: 300 });
            await addMug(page, { lane: 1, x: 305, kind: 'full' });
            await step(page, 2);
            const drinkTime = await read(page, () => DRINK_TIME);
            await step(page, Math.floor(drinkTime * 120) - 4);
            expect(await read(page, () => customers[0].phase)).toBe('drinking');
            await step(page, 6);
            expect(await read(page, () => customers[0].phase)).toBe('leaving');
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs coming back
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test('an empty mug slides back toward the taps', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addMug(page, { lane: 0, x: 200, kind: 'empty' });
            await step(page, 60);
            expect(await read(page, () => mugs[0].x)).toBeGreaterThan(200);
        });

        test('standing in the lane catches the empty mug', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await holdWave(page);
            await setLane(page, 2);
            await addMug(page, { lane: 2, x: 640, kind: 'empty' });
            await step(page, 30);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => lives)).toBe(await read(page, () => LIVES_START));
            expect(await read(page, () => score)).toBe(await read(page, () => CATCH_POINTS));
            expect(await read(page, () => caught)).toBe(1);
        });

        test('an empty mug smashes when the server is elsewhere', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await holdWave(page);
            await setLane(page, 0);
            await addMug(page, { lane: 3, x: 640, kind: 'empty' });
            await step(page, 30);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => lives)).toBe((await read(page, () => LIVES_START)) - 1);
            expect(await read(page, () => score)).toBe(0);
        });

        test('a smashed mug leaves a splash marker', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await setLane(page, 0);
            await addMug(page, { lane: 3, x: 645, kind: 'empty' });
            await step(page, 30);
            expect(await read(page, () => splashes.length)).toBeGreaterThan(0);
        });

        test('an empty mug is caught only at the tap line, not before', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await setLane(page, 1);
            await addMug(page, { lane: 1, x: 300, kind: 'empty' });
            await step(page, 10);
            expect(await read(page, () => mugs.length)).toBe(1);
            expect(await read(page, () => score)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Losing lives
    // -----------------------------------------------------------------------
    test.describe('hazards', () => {
        test('a full mug that runs the whole counter costs a life', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            const left = await read(page, () => BAR_LEFT);
            await addMug(page, { lane: 1, x: left + 5, kind: 'full' });
            await step(page, 10);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => lives)).toBe((await read(page, () => LIVES_START)) - 1);
        });

        test('a customer reaching the taps costs a life and is removed', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            const grab = await read(page, () => GRAB_X);
            await addCustomer(page, { lane: 1, x: grab - 2 });
            await step(page, 30);
            expect(await read(page, () => customers.length)).toBe(0);
            expect(await read(page, () => lives)).toBe((await read(page, () => LIVES_START)) - 1);
        });

        test('losing a life does not clear the rest of the bar', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            const left = await read(page, () => BAR_LEFT);
            await addCustomer(page, { lane: 3, x: 200 });
            await addMug(page, { lane: 1, x: left + 5, kind: 'full' });
            await step(page, 10);
            expect(await read(page, () => lives)).toBe(2);
            expect(await read(page, () => customers.length)).toBe(1);
            expect(await read(page, () => state)).toBe('running');
        });

        test('the last life ends the run', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await page.evaluate(() => {
                lives = 1;
            });
            const left = await read(page, () => BAR_LEFT);
            await addMug(page, { lane: 1, x: left + 5, kind: 'full' });
            await step(page, 10);
            expect(await read(page, () => lives)).toBe(0);
            expect(await read(page, () => state)).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('game over records the best score', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await page.evaluate(() => {
                lives = 1;
                score = 3400;
            });
            const left = await read(page, () => BAR_LEFT);
            await addMug(page, { lane: 1, x: left + 5, kind: 'full' });
            await step(page, 10);
            expect(await read(page, () => window.localStorage.getItem('sodatapper-best'))).toBe('3400');
            await expect(page.locator('#best')).toHaveText('3400');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '9000'));
            await page.reload();
            await startFrozen(page);
            await clearBar(page);
            await page.evaluate(() => {
                lives = 1;
                score = 10;
            });
            const left = await read(page, () => BAR_LEFT);
            await addMug(page, { lane: 1, x: left + 5, kind: 'full' });
            await step(page, 10);
            expect(await read(page, () => window.localStorage.getItem('sodatapper-best'))).toBe('9000');
        });

        test('the simulation stops once the run is over', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await page.evaluate(() => {
                lives = 1;
                state = 'gameover';
            });
            await addCustomer(page, { lane: 1, x: 300 });
            await step(page, 60);
            expect(await read(page, () => customers[0].x)).toBe(300);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses a running game', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            expect(await read(page, () => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('P resumes a paused game', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            expect(await read(page, () => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addCustomer(page, { lane: 1, x: 300 });
            await page.keyboard.press('KeyP');
            await step(page, 120);
            expect(await read(page, () => customers[0].x)).toBe(300);
        });

        test('P does nothing before the game starts', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await read(page, () => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Wave completion
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('clearing the bar completes the wave and pays a bonus', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            const bonus = await read(page, () => waveBonus());
            await step(page, 1);
            expect(await read(page, () => state)).toBe('wavecomplete');
            expect(await read(page, () => score)).toBe(bonus);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('the bonus rewards surviving lives', async ({ page }) => {
            await startFrozen(page);
            const full = await read(page, () => waveBonus());
            await page.evaluate(() => {
                lives = 1;
            });
            const hurt = await read(page, () => waveBonus());
            expect(full).toBeGreaterThan(hurt);
        });

        test('a wave is not complete while a mug is still in flight', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addMug(page, { lane: 1, x: 300, kind: 'full' });
            await step(page, 1);
            expect(await read(page, () => state)).toBe('running');
        });

        test('a wave is not complete while a customer is still on the bar', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addCustomer(page, { lane: 1, x: 300 });
            await step(page, 1);
            expect(await read(page, () => state)).toBe('running');
        });

        test('a wave is not complete while customers are still queued', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                customers.length = 0;
                mugs.length = 0;
            });
            await step(page, 1);
            expect(await read(page, () => state)).toBe('running');
        });

        test('Space starts the next wave', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await step(page, 1);
            await page.keyboard.press('Space');
            expect(await read(page, () => state)).toBe('running');
            expect(await read(page, () => wave)).toBe(2);
            expect(await read(page, () => spawnQueue.length)).toBe(await read(page, () => buildWave(2).length));
        });

        test('the next wave starts with a clean bar and a reset timer', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await step(page, 1);
            await page.evaluate(() => advance());
            expect(await read(page, () => customers.length)).toBe(0);
            expect(await read(page, () => mugs.length)).toBe(0);
            expect(await read(page, () => waveTimer)).toBe(0);
        });

        test('the score carries over between waves', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await step(page, 1);
            const after = await read(page, () => score);
            await page.evaluate(() => advance());
            expect(await read(page, () => score)).toBe(after);
        });

        test('clearing the last wave wins the run', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await page.evaluate(() => {
                wave = WAVE_COUNT;
            });
            await step(page, 1);
            expect(await read(page, () => state)).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/win|won|closing/i);
        });

        test('a win records the best score', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await page.evaluate(() => {
                wave = WAVE_COUNT;
                score = 7777;
            });
            await step(page, 1);
            expect(Number(await read(page, () => window.localStorage.getItem('sodatapper-best')))).toBeGreaterThanOrEqual(7777);
        });

        test('Space after a game over restarts from wave 1', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                state = 'gameover';
                wave = 4;
                score = 500;
            });
            await page.keyboard.press('Space');
            expect(await read(page, () => state)).toBe('running');
            expect(await read(page, () => wave)).toBe(1);
            expect(await read(page, () => score)).toBe(0);
            expect(await read(page, () => lives)).toBe(await read(page, () => LIVES_START));
        });

        test('Space after a win restarts from wave 1', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                state = 'won';
            });
            await page.keyboard.press('Space');
            expect(await read(page, () => state)).toBe('running');
            expect(await read(page, () => wave)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test('the score readout follows a serve', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addCustomer(page, { lane: 1, x: 200 });
            await addMug(page, { lane: 1, x: 230, kind: 'full' });
            await step(page, 40);
            await expect(page.locator('#score')).toHaveText(String(await read(page, () => SERVE_POINTS)));
            await expect(page.locator('#served')).toHaveText('1');
        });

        test('the lives readout follows a smash', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await setLane(page, 0);
            await addMug(page, { lane: 3, x: 645, kind: 'empty' });
            await step(page, 30);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the wave readout follows the wave', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await step(page, 1);
            await page.evaluate(() => advance());
            await expect(page.locator('#wave')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is actually painted', async ({ page }) => {
            await startFrozen(page);
            const painted = await page.evaluate(() => {
                draw();
                const data = ctx.getImageData(0, 0, W, H).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] || data[i + 1] || data[i + 2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('drawing a busy bar does not throw', async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await addCustomer(page, { lane: 0, x: 200 });
            await addCustomer(page, { lane: 1, x: 420, phase: 'drinking', drinkTimer: 1 });
            await addCustomer(page, { lane: 2, x: 150, phase: 'leaving' });
            await addMug(page, { lane: 3, x: 400, kind: 'full' });
            await addMug(page, { lane: 0, x: 300, kind: 'empty' });
            const ok = await page.evaluate(() => {
                try {
                    draw();
                    return true;
                } catch (err) {
                    return String(err);
                }
            });
            expect(ok).toBe(true);
        });

        test('the animation loop runs the simulation on its own', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => waveTimer > 0.4);
            expect(await read(page, () => waveTimer)).toBeGreaterThan(0.4);
        });

        test('an unattended game eventually loses a life', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                wave = 5;
                spawnQueue.length = 0;
                customers.push({ lane: 0, x: GRAB_X - 20, phase: 'advancing', drinkTimer: 0 });
            });
            await page.waitForFunction(() => lives < LIVES_START, null, { timeout: 5000 });
            expect(await read(page, () => lives)).toBeLessThan(await read(page, () => LIVES_START));
        });
    });

    // -----------------------------------------------------------------------
    // Repository integration
    // -----------------------------------------------------------------------
    test.describe('repository integration', () => {
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
            expect(readme).toMatch(/\|\s*Soda Tapper\s*\|\s*\[SodaTapper\/\]\(SodaTapper\/\)\s*\|\s*(Complete|In Progress)\s*\|/);
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaTapper/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaTapper/DESIGN.md'))).toBe(true);
        });
    });
});
