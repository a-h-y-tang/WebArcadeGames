const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Most specs care about one patron or one mug at a time, so the level queue is
// emptied and the real clock is switched off: with `autoStep` false the
// requestAnimationFrame loop stops advancing the simulation behind the spec's
// back, leaving time entirely under the spec's control.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
        pending.length = 0;
        customers.length = 0;
        mugs.length = 0;
        empties.length = 0;
    });

// A patron placed exactly where the spec wants them, bypassing the spawn queue.
const putCustomer = (page, { lane = 0, x = 200, thirst = 1, mode = 'advancing', speed = 0 } = {}) =>
    page.evaluate((c) => {
        customers.push({ lane: c.lane, x: c.x, thirst: c.thirst, mode: c.mode, speed: c.speed, timer: 0, push: 0 });
        return customers.length - 1;
    }, { lane, x, thirst, mode, speed });

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

        test('canvas matches the declared geometry', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '760');
            await expect(canvas).toHaveAttribute('height', '470');
            expect(await page.evaluate(() => [CANVAS_W, CANVAS_H, LANES])).toEqual([760, 470, 4]);
        });

        test('the counters fit inside the canvas', async ({ page }) => {
            const fits = await page.evaluate(() => ({
                left: BAR_LEFT > 0,
                right: BAR_RIGHT < BARMAN_X && BARMAN_X < CANVAS_W,
                bottom: LANE_TOP + LANES * LANE_H <= CANVAS_H,
            }));
            expect(fits).toEqual({ left: true, right: true, bottom: true });
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '4300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4300');
        });

        test('no patrons, mugs or empties before starting', async ({ page }) => {
            expect(await page.evaluate(() => [customers.length, mugs.length, empties.length])).toEqual([0, 0, 0]);
        });

        test('step() does nothing while idle', async ({ page }) => {
            await advance(page, 120);
            expect(await page.evaluate(() => [state, customers.length, score])).toEqual(['idle', 0, 0]);
        });

        test('pouring is impossible while idle', async ({ page }) => {
            expect(await page.evaluate(() => tryServe())).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'playing');
        });

        test('startGame resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                score = 999;
                lives = 1;
                level = 7;
                startGame();
                autoStep = false;
            });
            expect(await page.evaluate(() => [score, lives, level])).toEqual([0, 3, 1]);
        });

        test('level 1 queues its patrons', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            expect(await page.evaluate(() => pending.length)).toBe(8);
        });

        test('every queued patron has a valid lane and a positive thirst', async ({ page }) => {
            const bad = await page.evaluate(() => {
                startGame();
                autoStep = false;
                return pending.filter((p) => !(p.lane >= 0 && p.lane < LANES) || p.thirst < 1 || !(p.at > 0));
            });
            expect(bad).toEqual([]);
        });

        test('the barman starts in a real lane', async ({ page }) => {
            await startQuiet(page);
            const lane = await page.evaluate(() => barman.lane);
            expect(lane).toBeGreaterThanOrEqual(0);
            expect(lane).toBeLessThan(4);
        });

        test('the same seed queues the same patrons', async ({ page }) => {
            const [a, b] = await page.evaluate(() => {
                setSeed(1234);
                startGame();
                autoStep = false;
                const first = pending.map((p) => `${p.lane}:${p.thirst}`).join(',');
                setSeed(1234);
                startGame();
                return [first, pending.map((p) => `${p.lane}:${p.thirst}`).join(',')];
            });
            expect(a).toBe(b);
        });
    });

    // -----------------------------------------------------------------------
    // Barman movement
    // -----------------------------------------------------------------------
    test.describe('barman', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowDown moves the barman one counter down', async ({ page }) => {
            await page.evaluate(() => {
                barman.lane = 1;
            });
            await page.keyboard.press('ArrowDown');
            await page.waitForFunction(() => barman.lane === 2);
        });

        test('ArrowUp moves the barman one counter up', async ({ page }) => {
            await page.evaluate(() => {
                barman.lane = 1;
            });
            await page.keyboard.press('ArrowUp');
            await page.waitForFunction(() => barman.lane === 0);
        });

        test('W and S also move the barman', async ({ page }) => {
            await page.evaluate(() => {
                barman.lane = 1;
            });
            await page.keyboard.press('KeyS');
            await page.waitForFunction(() => barman.lane === 2);
            await page.keyboard.press('KeyW');
            await page.waitForFunction(() => barman.lane === 1);
        });

        test('the barman cannot move above the top counter', async ({ page }) => {
            await page.evaluate(() => {
                barman.lane = 0;
                moveBarman(-1);
            });
            expect(await page.evaluate(() => barman.lane)).toBe(0);
        });

        test('the barman cannot move below the bottom counter', async ({ page }) => {
            await page.evaluate(() => {
                barman.lane = LANES - 1;
                moveBarman(1);
            });
            expect(await page.evaluate(() => barman.lane)).toBe(3);
        });

        test('the barman does not move while paused', async ({ page }) => {
            await page.evaluate(() => {
                barman.lane = 1;
                state = 'paused';
                moveBarman(1);
            });
            expect(await page.evaluate(() => barman.lane)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring and sliding mugs
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a poured mug appears at the taps in the barman lane, moving left', async ({ page }) => {
            const mug = await page.evaluate(() => {
                barman.lane = 2;
                tryServe();
                return mugs[0];
            });
            expect(mug.lane).toBe(2);
            expect(mug.vx).toBeLessThan(0);
            expect(mug.x).toBeGreaterThan(600);
            expect(mug.x).toBeLessThanOrEqual(672);
        });

        test('Space pours a mug', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => mugs.length === 1);
        });

        test('the pour cooldown blocks an instant second mug', async ({ page }) => {
            const [first, second] = await page.evaluate(() => [tryServe(), tryServe()]);
            expect(first).toBe(true);
            expect(second).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('a second mug can be poured once the cooldown expires', async ({ page }) => {
            await page.evaluate(() => tryServe());
            await advance(page, 20); // 0.33s > POUR_COOLDOWN
            expect(await page.evaluate(() => tryServe())).toBe(true);
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('a mug slides left over time', async ({ page }) => {
            await page.evaluate(() => tryServe());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 10);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeLessThan(before - 20);
        });

        test('a mug that reaches the far end smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => tryServe());
            await advance(page, 150);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Serving patrons
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a mug reaching a patron is drunk and scores', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 400 });
            await page.evaluate(() => {
                barman.lane = 0;
                tryServe();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => customers[0].mode)).toBe('drinking');
            expect(await page.evaluate(() => score)).toBe(50);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('a mug in another lane does not reach the patron', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 400 });
            await page.evaluate(() => {
                barman.lane = 1;
                tryServe();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].mode)).toBe('advancing');
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('a drinking patron is shoved back toward the far end', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 400 });
            await page.evaluate(() => {
                barman.lane = 0;
                tryServe();
            });
            await advance(page, 60);
            const x0 = await page.evaluate(() => customers[0].x);
            await advance(page, 30);
            const x1 = await page.evaluate(() => customers[0].x);
            expect(x1).toBeLessThan(x0 - 10);
        });

        test('push-back never shoves a patron past the far end', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 80, mode: 'drinking', thirst: 2 });
            await page.evaluate(() => {
                customers[0].timer = DRINK_TIME;
                customers[0].push = PUSH_BACK;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBeGreaterThanOrEqual(70);
        });

        test('a satisfied patron sends back an empty and leaves', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 400 });
            await page.evaluate(() => {
                barman.lane = 0;
                tryServe();
            });
            await advance(page, 120); // mug lands, drink finishes
            expect(await page.evaluate(() => empties.length)).toBe(1);
            expect(await page.evaluate(() => empties[0].vx)).toBeGreaterThan(0);
            expect(await page.evaluate(() => customers[0].mode)).toBe('leaving');
        });

        test('a two-round patron goes back to advancing after the first drink', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 400, thirst: 2 });
            await page.evaluate(() => {
                barman.lane = 0;
                tryServe();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].mode)).toBe('advancing');
            expect(await page.evaluate(() => customers[0].thirst)).toBe(1);
            expect(await page.evaluate(() => empties.length)).toBe(1);
        });

        test('a patron that walks off the far end scores and is gone', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 120, mode: 'leaving' });
            await advance(page, 120);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(100);
        });

        test('a mug slides straight past a drinking patron and smashes', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 400, mode: 'drinking', thirst: 1 });
            await page.evaluate(() => {
                customers[0].timer = 99;
                barman.lane = 0;
                tryServe();
            });
            await advance(page, 150);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a mug slides straight past a leaving patron', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 500, mode: 'leaving' });
            await page.evaluate(() => {
                barman.lane = 0;
                tryServe();
            });
            await advance(page, 20);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('the front patron takes the mug, not the one behind', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 200 });
            await putCustomer(page, { lane: 0, x: 420 });
            await page.evaluate(() => {
                barman.lane = 0;
                tryServe();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => customers.map((c) => c.mode))).toEqual(['advancing', 'drinking']);
        });
    });

    // -----------------------------------------------------------------------
    // Returning empties
    // -----------------------------------------------------------------------
    test.describe('empties', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty caught in the barman lane scores and costs nothing', async ({ page }) => {
            await page.evaluate(() => {
                barman.lane = 1;
                empties.push({ lane: 1, x: BAR_RIGHT - 40, vx: EMPTY_SPEED });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(25);
            expect(await page.evaluate(() => [lives, state])).toEqual([3, 'playing']);
        });

        test('an empty dropped in another lane smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => {
                barman.lane = 0;
                empties.push({ lane: 3, x: BAR_RIGHT - 40, vx: EMPTY_SPEED });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('moving into the lane in time saves the empty', async ({ page }) => {
            await page.evaluate(() => {
                barman.lane = 0;
                empties.push({ lane: 2, x: 300, vx: EMPTY_SPEED });
            });
            await advance(page, 30);
            await page.evaluate(() => {
                moveBarman(1);
                moveBarman(1);
            });
            await advance(page, 120);
            expect(await page.evaluate(() => [lives, score])).toEqual([3, 25]);
        });
    });

    // -----------------------------------------------------------------------
    // Losing lives
    // -----------------------------------------------------------------------
    test.describe('lives', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a patron reaching the taps costs a life and is removed', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 660, speed: 60 });
            await advance(page, 30);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('losing a life pauses play and clears the glassware', async ({ page }) => {
            await page.evaluate(() => {
                barman.lane = 0;
                empties.push({ lane: 3, x: BAR_RIGHT - 10, vx: EMPTY_SPEED });
                mugs.push({ lane: 1, x: 400, vx: -MUG_SPEED });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => state)).toBe('life');
            expect(await page.evaluate(() => [mugs.length, empties.length])).toEqual([0, 0]);
        });

        test('losing a life shoves the patrons back', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 400 });
            await page.evaluate(() => {
                barman.lane = 1;
                empties.push({ lane: 3, x: BAR_RIGHT - 5, vx: EMPTY_SPEED });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => customers[0].x)).toBeLessThan(360);
        });

        test('play resumes after the pause', async ({ page }) => {
            await page.evaluate(() => {
                barman.lane = 0;
                empties.push({ lane: 3, x: BAR_RIGHT - 5, vx: EMPTY_SPEED });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => state)).toBe('life');
            await advance(page, 80); // > LIFE_PAUSE
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('patrons do not advance during the pause', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 300, speed: 60 });
            await page.evaluate(() => {
                barman.lane = 1;
                empties.push({ lane: 3, x: BAR_RIGHT - 5, vx: EMPTY_SPEED });
            });
            await advance(page, 10);
            const x0 = await page.evaluate(() => customers[0].x);
            await advance(page, 30);
            expect(await page.evaluate(() => customers[0].x)).toBe(x0);
        });

        test('the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                barman.lane = 0;
                empties.push({ lane: 3, x: BAR_RIGHT - 5, vx: EMPTY_SPEED });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => [state, lives])).toEqual(['gameover', 0]);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('game over writes the best score', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                score = 1750;
                barman.lane = 0;
                empties.push({ lane: 3, x: BAR_RIGHT - 5, vx: EMPTY_SPEED });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => window.localStorage.getItem('sodatapper-best'))).toBe('1750');
            await expect(page.locator('#best')).toHaveText('1750');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            await page.evaluate(() => {
                window.localStorage.setItem('sodatapper-best', '9000');
                best = 9000;
                lives = 1;
                score = 10;
                barman.lane = 0;
                empties.push({ lane: 3, x: BAR_RIGHT - 5, vx: EMPTY_SPEED });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => window.localStorage.getItem('sodatapper-best'))).toBe('9000');
        });

        test('Space restarts after game over', async ({ page }) => {
            await page.evaluate(() => {
                state = 'gameover';
            });
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'playing');
            expect(await page.evaluate(() => [score, lives, level])).toEqual([0, 3, 1]);
        });

        test('step() is inert once the game is over', async ({ page }) => {
            await putCustomer(page, { lane: 0, x: 300, speed: 60 });
            await page.evaluate(() => {
                state = 'gameover';
            });
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(300);
        });
    });

    // -----------------------------------------------------------------------
    // Spawning and level progression
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('queued patrons arrive at the far end over time', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            await advance(page, 90); // 1.5s — past the first queued arrival
            const spawned = await page.evaluate(() => customers.length);
            expect(spawned).toBeGreaterThanOrEqual(1);
            const entry = await page.evaluate(() => customers.map((c) => c.x));
            for (const x of entry) expect(x).toBeLessThan(200);
        });

        test('a spawned patron advances toward the taps', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            await advance(page, 90);
            const x0 = await page.evaluate(() => customers[0].x);
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBeGreaterThan(x0);
        });

        test('clearing the level banks a bonus and opens the next shift', async ({ page }) => {
            await startQuiet(page);
            // The level-clear check needs a patron to have been served off the
            // queue, so the counter the spawner keeps is nudged by hand here.
            await page.evaluate(() => {
                spawnedThisLevel = 1;
            });
            await putCustomer(page, { lane: 0, x: 120, mode: 'leaving' });
            await advance(page, 120); // patron walks out -> level clear
            expect(await page.evaluate(() => state)).toBe('clear');
            expect(await page.evaluate(() => score)).toBe(100 + 750);
            await advance(page, 120); // > CLEAR_PAUSE
            expect(await page.evaluate(() => [state, level])).toEqual(['playing', 2]);
            // Level 2 is already under way by now, so count the queue plus
            // whoever has walked in: ten patrons either way.
            expect(await page.evaluate(() => pending.length + customers.length)).toBe(10);
        });

        test('an empty bar with nothing spawned yet is not a cleared level', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 60);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('patrons walk faster on later levels', async ({ page }) => {
            const speeds = await page.evaluate(() => [custSpeed(1), custSpeed(2), custSpeed(5)]);
            expect(speeds[1]).toBeGreaterThan(speeds[0]);
            expect(speeds[2]).toBeGreaterThan(speeds[1]);
        });

        test('later levels queue more patrons on a tighter interval', async ({ page }) => {
            const info = await page.evaluate(() => ({
                counts: [customersForLevel(1), customersForLevel(4)],
                intervals: [spawnInterval(1), spawnInterval(4)],
            }));
            expect(info.counts[1]).toBeGreaterThan(info.counts[0]);
            expect(info.intervals[1]).toBeLessThan(info.intervals[0]);
        });

        test('two patrons never spawn on top of each other', async ({ page }) => {
            const overlaps = await page.evaluate(() => {
                setSeed(99);
                startGame();
                autoStep = false;
                let worst = Infinity;
                for (let i = 0; i < 3600; i++) {
                    step(1 / 60);
                    if (state !== 'playing') continue;
                    for (let a = 0; a < customers.length; a++)
                        for (let b = a + 1; b < customers.length; b++)
                            if (customers[a].lane === customers[b].lane &&
                                customers[a].mode === 'advancing' && customers[b].mode === 'advancing')
                                worst = Math.min(worst, Math.abs(customers[a].x - customers[b].x));
                }
                return worst;
            });
            expect(overlaps).toBeGreaterThan(10);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('KeyP');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('KeyP');
            await page.waitForFunction(() => state === 'playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await startQuiet(page);
            await putCustomer(page, { lane: 0, x: 300, speed: 60 });
            await page.evaluate(() => {
                state = 'paused';
            });
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(300);
        });

        test('pausing while idle does nothing', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // HUD and rendering
    // -----------------------------------------------------------------------
    test.describe('hud and rendering', () => {
        test('the HUD tracks score, lives and patrons left', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 1234;
                lives = 2;
                pending.push({ lane: 0, thirst: 1, at: 99 });
                customers.push({ lane: 0, x: 200, thirst: 1, mode: 'advancing', speed: 0, timer: 0, push: 0 });
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('1234');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#left')).toHaveText('2');
        });

        test('the canvas is actually painted during play', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                barman.lane = 1;
                customers.push({ lane: 2, x: 300, thirst: 1, mode: 'advancing', speed: 20, timer: 0, push: 0 });
                tryServe();
                draw();
            });
            const painted = await page.evaluate(() => {
                const px = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const seen = new Set();
                for (let i = 0; i < px.length; i += 4) seen.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
                return seen.size;
            });
            expect(painted).toBeGreaterThan(50);
        });

        test('a full run raises no console errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
            await page.goto(GAME_URL);
            await page.evaluate(() => {
                setSeed(7);
                startGame();
                autoStep = false;
                for (let i = 0; i < 4000; i++) {
                    step(1 / 60);
                    if (i % 17 === 0) tryServe();
                    if (i % 29 === 0) moveBarman(i % 58 === 0 ? 1 : -1);
                    if (i % 11 === 0) draw();
                }
            });
            expect(errors).toEqual([]);
        });

        test('the simulation stays consistent over a long run', async ({ page }) => {
            const bad = await page.evaluate(() => {
                setSeed(21);
                startGame();
                autoStep = false;
                const problems = [];
                for (let i = 0; i < 6000; i++) {
                    step(1 / 60);
                    if (i % 13 === 0) tryServe();
                    if (i % 23 === 0) moveBarman(1);
                    if (i % 37 === 0) moveBarman(-1);
                    if (lives < 0) problems.push(`lives ${lives}`);
                    if (score < 0) problems.push(`score ${score}`);
                    for (const c of customers) {
                        if (c.x < BAR_LEFT - 40 || c.x > BAR_RIGHT + 1) problems.push(`patron x ${c.x}`);
                        if (!['advancing', 'drinking', 'leaving'].includes(c.mode)) problems.push(`mode ${c.mode}`);
                    }
                    for (const m of mugs) if (m.x < BAR_LEFT - 1 || m.x > BAR_RIGHT + 1) problems.push(`mug x ${m.x}`);
                    for (const e of empties) if (e.x < BAR_LEFT - 1 || e.x > BAR_RIGHT + 1) problems.push(`empty x ${e.x}`);
                    if (problems.length) return problems.slice(0, 5);
                }
                return problems;
            });
            expect(bad).toEqual([]);
        });
    });
});
