const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Nearly every spec is about one entity at a time, so the bar is emptied and
// the spawner switched off; specs that care about arrivals re-enable it or call
// spawnPatron() themselves. Turning off `autoStep` stops requestAnimationFrame
// from advancing the simulation behind the spec's back, putting time entirely
// under the spec's control.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
        patrons.length = 0;
        mugs.length = 0;
        tips.length = 0;
        spawnTimer = Infinity;
        pourCooldown = 0;
    });

// Chromium can acknowledge a synthetic key event before the page listener has
// run, so lane changes are confirmed against game state rather than assumed.
const pressLane = async (page, key, expectedLane) => {
    await page.keyboard.press(key);
    await page.waitForFunction((l) => jerk.lane === l, expectedLane);
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

        test('canvas matches the declared board size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '760');
            await expect(canvas).toHaveAttribute('height', '460');
            expect(await page.evaluate(() => [CANVAS_W, CANVAS_H])).toEqual([760, 460]);
        });

        test('there are four counters with distinct ascending y positions', async ({ page }) => {
            const { lanes, ys } = await page.evaluate(() => ({ lanes: LANES, ys: LANE_Y }));
            expect(lanes).toBe(4);
            expect(ys).toHaveLength(4);
            expect(ys).toEqual([...ys].sort((a, b) => a - b));
            expect(new Set(ys).size).toBe(4);
            ys.forEach((y) => {
                expect(y).toBeGreaterThan(0);
                expect(y).toBeLessThan(460);
            });
        });

        test('the taps are left of the door', async ({ page }) => {
            const { left, right, spawn, caught } = await page.evaluate(() => ({
                left: BAR_LEFT,
                right: BAR_RIGHT,
                spawn: SPAWN_X,
                caught: CAUGHT_X,
            }));
            expect(left).toBeLessThan(right);
            expect(caught).toBeGreaterThan(left);
            expect(spawn).toBeLessThan(right);
            expect(spawn).toBeGreaterThan(caught);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the starting score, shift and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#served')).toHaveText('0');
        });

        test('the bar is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => [patrons.length, mugs.length, tips.length])).toEqual([0, 0, 0]);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '7400'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7400');
        });

        test('step() does nothing while idle', async ({ page }) => {
            await page.evaluate(() => {
                autoStep = false;
                spawnPatron(0);
            });
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBe(before);
        });

        test('pour() does nothing while idle', async ({ page }) => {
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a shift
    // -----------------------------------------------------------------------
    test.describe('starting a shift', () => {
        test('the start button begins play and hides the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('space begins play', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.waitForFunction(() => state === 'playing');
        });

        test('the jerk starts at the top counter', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => jerk.lane)).toBe(0);
        });

        test('a fresh shift resets score, lives and shift number', async ({ page }) => {
            await page.evaluate(() => {
                score = 5000;
                lives = 1;
                level = 7;
                served = 42;
                startGame();
            });
            expect(await page.evaluate(() => [score, lives, level, served])).toEqual([0, 3, 1, 0]);
        });

        test('patrons arrive once play begins', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.waitForFunction(() => patrons.length > 0, null, { timeout: 8000 });
        });
    });

    // -----------------------------------------------------------------------
    // Moving between counters
    // -----------------------------------------------------------------------
    test.describe('moving between counters', () => {
        test('arrow down moves one counter down', async ({ page }) => {
            await startQuiet(page);
            await pressLane(page, 'ArrowDown', 1);
        });

        test('arrow up moves one counter up', async ({ page }) => {
            await startQuiet(page);
            await pressLane(page, 'ArrowDown', 1);
            await pressLane(page, 'ArrowUp', 0);
        });

        test('w and s also change counter', async ({ page }) => {
            await startQuiet(page);
            await pressLane(page, 's', 1);
            await pressLane(page, 'w', 0);
        });

        test('the jerk cannot move above the top counter', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => moveLane(-1));
            expect(await page.evaluate(() => jerk.lane)).toBe(0);
        });

        test('the jerk cannot move below the bottom counter', async ({ page }) => {
            await startQuiet(page);
            const bottom = await page.evaluate(() => {
                for (let i = 0; i < 10; i++) moveLane(1);
                return [jerk.lane, LANES - 1];
            });
            expect(bottom[0]).toBe(bottom[1]);
        });

        test('counters cannot be changed while idle', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => jerk.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring sodas', () => {
        test('pour() puts a full mug on the jerk’s counter at the taps', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                jerk.lane = 2;
                pour();
            });
            const mug = await page.evaluate(() => mugs[0]);
            expect(mug.lane).toBe(2);
            expect(mug.kind).toBe('full');
            expect(mug.x).toBeGreaterThanOrEqual(110);
            expect(mug.x).toBeLessThan(160);
        });

        test('space pours while playing', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press(' ');
            await page.waitForFunction(() => mugs.length === 1);
        });

        test('a cooldown stops sodas being spammed', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                pour();
                pour();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('the cooldown expires so pouring resumes', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => pour());
            await advance(page, 60);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('a full mug slides towards the door', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => pour());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            const after = await page.evaluate(() => mugs[0].x);
            const speed = await page.evaluate(() => MUG_SPEED);
            expect(after).toBeGreaterThan(before);
            expect(after - before).toBeCloseTo(speed * 0.5, 0);
        });

        test('mug speed is expressed per second', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => pour());
            const start = await page.evaluate(() => mugs[0].x);
            await advance(page, 1, 1);
            expect(await page.evaluate(() => mugs[0].x) - start).toBeCloseTo(
                await page.evaluate(() => MUG_SPEED),
                3
            );
        });
    });

    // -----------------------------------------------------------------------
    // Serving patrons
    // -----------------------------------------------------------------------
    test.describe('serving patrons', () => {
        test('a soda that reaches a patron is caught and scores', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 400;
                mugs.push({ lane: 0, x: 380, kind: 'full' });
            });
            await advance(page, 30);
            const out = await page.evaluate(() => ({
                full: mugs.filter((m) => m.kind === 'full').length,
                drinks: patrons[0] ? patrons[0].drinks : -1,
                score,
            }));
            expect(out.full).toBe(0);
            expect(out.drinks).toBe(1);
            expect(out.score).toBeGreaterThanOrEqual(50);
        });

        test('catching a soda shoves the patron towards the door', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 400;
                mugs.push({ lane: 0, x: 380, kind: 'full' });
            });
            await advance(page, 1);
            // The shove is applied and partly spent in the same frame, so the
            // budget left is just under a full push distance.
            const { push, dist } = await page.evaluate(() => ({ push: patrons[0].push, dist: PUSH_DIST }));
            expect(push).toBeLessThanOrEqual(dist);
            expect(push).toBeGreaterThan(dist * 0.9);
            await advance(page, 90);
            expect(await page.evaluate(() => (patrons[0] ? patrons[0].x : 999))).toBeGreaterThan(500);
        });

        test('two sodas stack their shoves', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 400;
                patrons[0].push = 0;
                mugs.push({ lane: 0, x: 395, kind: 'full' });
                mugs.push({ lane: 0, x: 393, kind: 'full' });
            });
            await advance(page, 2);
            const { push, dist } = await page.evaluate(() => ({ push: patrons[0].push, dist: PUSH_DIST }));
            expect(push).toBeGreaterThan(dist * 1.5);
        });

        test('a served patron throws the empty mug back at the taps', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 400;
                mugs.push({ lane: 0, x: 380, kind: 'full' });
            });
            await advance(page, 2);
            const empty = await page.evaluate(() => mugs.find((m) => m.kind === 'empty'));
            expect(empty).toBeTruthy();
            expect(empty.lane).toBe(0);
            const before = empty.x;
            await advance(page, 20);
            const after = await page.evaluate(() => {
                const m = mugs.find((x) => x.kind === 'empty');
                return m ? m.x : -1;
            });
            expect(after).toBeLessThan(before);
        });

        test('a soda only reaches patrons on its own counter', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(1);
                patrons[0].x = 400;
                mugs.push({ lane: 0, x: 380, kind: 'full' });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => patrons[0].drinks)).toBe(0);
        });

        test('a patron shoved out of the door leaves and scores', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                seedRng(1);
                spawnPatron(0);
                patrons[0].x = BAR_RIGHT - 10;
                patrons[0].push = 60;
                score = 0;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(250);
        });

        test('the served counter rises when a patron leaves', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = BAR_RIGHT - 10;
                patrons[0].push = 60;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => served)).toBe(1);
            await expect(page.locator('#served')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test('an empty caught at the taps scores and disappears', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                jerk.lane = 0;
                score = 0;
                lives = 3;
                mugs.push({ lane: 0, x: BAR_LEFT + 10, kind: 'empty' });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(100);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an empty reaching an unattended counter costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                jerk.lane = 0;
                lives = 3;
                score = 0;
                mugs.push({ lane: 3, x: BAR_LEFT + 10, kind: 'empty' });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('an empty still in transit costs nothing', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                jerk.lane = 0;
                lives = 3;
                mugs.push({ lane: 3, x: BAR_RIGHT - 20, kind: 'empty' });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Losing lives
    // -----------------------------------------------------------------------
    test.describe('losing lives', () => {
        test('a soda that runs off the far end costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 3;
                mugs.push({ lane: 0, x: BAR_RIGHT - 10, kind: 'full' });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('a patron reaching the taps costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 3;
                spawnPatron(2);
                patrons[0].x = CAUGHT_X + 4;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
        });

        test('losing a life clears only the offending counter', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 3;
                spawnPatron(2);
                patrons[0].x = CAUGHT_X + 2;
                spawnPatron(1);
                patrons[1].x = 500;
                mugs.push({ lane: 2, x: 300, kind: 'full' });
                mugs.push({ lane: 1, x: 300, kind: 'full' });
                tips.push({ lane: 2, x: 400 });
            });
            await advance(page, 60);
            const left = await page.evaluate(() => ({
                lanes: patrons.map((p) => p.lane),
                mugLanes: mugs.map((m) => m.lane),
                tipLanes: tips.map((t) => t.lane),
            }));
            expect(left.lanes).toEqual([1]);
            expect(left.mugLanes).not.toContain(2);
            expect(left.tipLanes).not.toContain(2);
        });

        test('the HUD reflects a lost life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 3;
                mugs.push({ lane: 0, x: BAR_RIGHT - 2, kind: 'full' });
            });
            await advance(page, 10);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('running out of lives ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                mugs.push({ lane: 0, x: BAR_RIGHT - 2, kind: 'full' });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => state)).toBe('over');
            expect(await page.evaluate(() => lives)).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|closed/i);
        });

        test('the simulation freezes once the game is over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                mugs.push({ lane: 0, x: BAR_RIGHT - 2, kind: 'full' });
            });
            await advance(page, 10);
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 400;
            });
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBe(before);
        });

        test('the final score is shown on the overlay', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 1234;
                lives = 1;
                mugs.push({ lane: 0, x: BAR_RIGHT - 2, kind: 'full' });
            });
            await advance(page, 10);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('a game over writes a new best score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 9100;
                lives = 1;
                mugs.push({ lane: 0, x: BAR_RIGHT - 2, kind: 'full' });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => window.localStorage.getItem('sodatapper-best'))).toBe('9100');
            await expect(page.locator('#best')).toHaveText('9100');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '9999'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 10;
                lives = 1;
                mugs.push({ lane: 0, x: BAR_RIGHT - 2, kind: 'full' });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => window.localStorage.getItem('sodatapper-best'))).toBe('9999');
        });

        test('the game can be restarted after a game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                mugs.push({ lane: 0, x: BAR_RIGHT - 2, kind: 'full' });
            });
            await advance(page, 10);
            await page.keyboard.press(' ');
            await page.waitForFunction(() => state === 'playing');
            expect(await page.evaluate(() => [lives, score])).toEqual([3, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Tips
    // -----------------------------------------------------------------------
    test.describe('tips', () => {
        test('a tip slides back towards the taps', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => tips.push({ lane: 0, x: 600 }));
            await advance(page, 30);
            expect(await page.evaluate(() => tips[0].x)).toBeLessThan(600);
        });

        test('a tip collected at the taps scores', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                jerk.lane = 1;
                score = 0;
                tips.push({ lane: 1, x: BAR_LEFT + 5 });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => score)).toBe(500);
            expect(await page.evaluate(() => tips.length)).toBe(0);
        });

        test('a missed tip costs nothing', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                jerk.lane = 0;
                lives = 3;
                score = 0;
                tips.push({ lane: 2, x: BAR_LEFT + 5 });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => [lives, score, tips.length])).toEqual([3, 0, 0]);
        });

        test('leaving patrons sometimes drop a tip', async ({ page }) => {
            await startQuiet(page);
            const dropped = await page.evaluate(() => {
                let count = 0;
                seedRng(12345);
                for (let i = 0; i < 40; i++) {
                    tips.length = 0;
                    patrons.length = 0;
                    spawnPatron(0);
                    patrons[0].x = BAR_RIGHT - 4;
                    patrons[0].push = 40;
                    for (let f = 0; f < 30; f++) step(1 / 60);
                    if (tips.length > 0) count++;
                }
                return count;
            });
            expect(dropped).toBeGreaterThan(0);
            expect(dropped).toBeLessThan(40);
        });
    });

    // -----------------------------------------------------------------------
    // Shifts
    // -----------------------------------------------------------------------
    test.describe('shifts', () => {
        test('later shifts are harder', async ({ page }) => {
            const cfgs = await page.evaluate(() => [1, 2, 3, 6].map((l) => levelConfig(l)));
            expect(cfgs[1].walkSpeed).toBeGreaterThan(cfgs[0].walkSpeed);
            expect(cfgs[1].spawnInterval).toBeLessThan(cfgs[0].spawnInterval);
            expect(cfgs[1].patrons).toBeGreaterThan(cfgs[0].patrons);
            expect(cfgs[3].maxOnScreen).toBeGreaterThanOrEqual(cfgs[0].maxOnScreen);
        });

        test('shift difficulty is bounded so it stays playable', async ({ page }) => {
            const cfg = await page.evaluate(() => levelConfig(50));
            expect(cfg.spawnInterval).toBeGreaterThanOrEqual(1.5);
            expect(cfg.maxOnScreen).toBeLessThanOrEqual(6);
        });

        test('clearing every arrival advances the shift and pays a bonus', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 0;
                spawned = levelConfig(level).patrons;
                patrons.length = 0;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(1000);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('a shift does not end while patrons remain', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawned = levelConfig(level).patrons;
                spawnPatron(0);
                patrons[0].x = 500;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('a new shift starts with a clear bar', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawned = levelConfig(level).patrons;
                mugs.push({ lane: 0, x: 300, kind: 'full' });
                patrons.length = 0;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => [mugs.length, patrons.length, spawned])).toEqual([0, 0, 0]);
        });

        test('arrivals are capped at the shift limit', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            await advance(page, 60 * 120);
            const { spawnedCount, cap } = await page.evaluate(() => ({
                spawnedCount: spawned,
                cap: levelConfig(level).patrons,
            }));
            expect(spawnedCount).toBeLessThanOrEqual(cap);
        });

        test('concurrent patrons never exceed the shift limit', async ({ page }) => {
            const worst = await page.evaluate(() => {
                startGame();
                autoStep = false;
                let peak = 0;
                for (let i = 0; i < 60 * 60; i++) {
                    step(1 / 60);
                    if (state !== 'playing') break;
                    peak = Math.max(peak, patrons.length);
                }
                return { peak, cap: levelConfig(level).maxOnScreen };
            });
            expect(worst.peak).toBeLessThanOrEqual(worst.cap);
        });
    });

    // -----------------------------------------------------------------------
    // Spawning
    // -----------------------------------------------------------------------
    test.describe('patron arrivals', () => {
        test('patrons enter near the door walking inwards', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnPatron(1));
            const p = await page.evaluate(() => patrons[0]);
            expect(p.lane).toBe(1);
            expect(p.x).toBeCloseTo(await page.evaluate(() => SPAWN_X), 3);
            expect(p.drinks).toBe(0);
            expect(p.push).toBe(0);
            const before = p.x;
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBeLessThan(before);
        });

        test('patrons walk at the shift speed', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnPatron(0));
            const start = await page.evaluate(() => patrons[0].x);
            await advance(page, 1, 1);
            const moved = start - (await page.evaluate(() => patrons[0].x));
            expect(moved).toBeCloseTo(await page.evaluate(() => levelConfig(level).walkSpeed), 3);
        });

        test('arrivals are spread across all four counters', async ({ page }) => {
            const lanesUsed = await page.evaluate(() => {
                const seen = new Set();
                seedRng(7);
                for (let i = 0; i < 400; i++) {
                    patrons.length = 0;
                    state = 'playing';
                    spawnTimer = 0;
                    spawned = 0;
                    step(1 / 60);
                    patrons.forEach((p) => seen.add(p.lane));
                }
                return [...seen].sort();
            });
            expect(lanesUsed).toEqual([0, 1, 2, 3]);
        });

        test('arrivals wait for the spawn interval', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
                patrons.length = 0;
                spawnTimer = levelConfig(level).spawnInterval;
            });
            await advance(page, 6);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
            await advance(page, 60 * 5);
            expect(await page.evaluate(() => patrons.length)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('p pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 400;
                togglePause();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBe(400);
        });

        test('pouring is ignored while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                togglePause();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('space resumes a paused game without restarting it', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 777;
                togglePause();
            });
            await page.keyboard.press(' ');
            await page.waitForFunction(() => state === 'playing');
            expect(await page.evaluate(() => score)).toBe(777);
        });

        test('pausing cannot happen while idle', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Pointer input
    // -----------------------------------------------------------------------
    test.describe('pointer input', () => {
        test('clicking a counter jumps to it and pours', async ({ page }) => {
            await startQuiet(page);
            const box = await page.locator('#canvas').boundingBox();
            const laneY = await page.evaluate(() => LANE_Y[2]);
            await page.mouse.click(box.x + 300, box.y + laneY);
            await page.waitForFunction(() => jerk.lane === 2 && mugs.length === 1);
        });

        test('clicking does nothing while idle', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + 300, box.y + 100);
            expect(await page.evaluate(() => [state, mugs.length])).toEqual(['idle', 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('draw() does not mutate game state', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 400;
                pour();
                tips.push({ lane: 1, x: 500 });
            });
            const snapshot = () =>
                page.evaluate(() =>
                    JSON.stringify({ patrons, mugs, tips, score, lives, level, jerk, state })
                );
            const before = await snapshot();
            await page.evaluate(() => {
                for (let i = 0; i < 5; i++) draw();
            });
            expect(await snapshot()).toBe(before);
        });

        test('the canvas is actually painted', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(0);
                pour();
                draw();
            });
            const painted = await page.evaluate(() => {
                const ctx = canvas.getContext('2d');
                const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
                let lit = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] + data[i + 1] + data[i + 2] > 40) lit++;
                }
                return lit;
            });
            expect(painted).toBeGreaterThan(1000);
        });

        test('no console errors during a long unattended run', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            page.on('console', (m) => {
                if (m.type() === 'error') errors.push(m.text());
            });
            await page.evaluate(() => startGame());
            await page.waitForTimeout(2500);
            expect(errors).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Invariants over a long simulated run
    // -----------------------------------------------------------------------
    test.describe('invariants', () => {
        test('entities stay on the bar and on real counters', async ({ page }) => {
            const bad = await page.evaluate(() => {
                startGame();
                autoStep = false;
                seedRng(99);
                const problems = [];
                for (let i = 0; i < 60 * 180; i++) {
                    step(1 / 60);
                    const all = [...patrons, ...mugs, ...tips];
                    all.forEach((e) => {
                        if (!Number.isFinite(e.x)) problems.push(`x=${e.x}`);
                        if (e.lane < 0 || e.lane >= LANES) problems.push(`lane=${e.lane}`);
                        if (e.x < BAR_LEFT - 40 || e.x > BAR_RIGHT + 40) problems.push(`off bar x=${e.x}`);
                    });
                    if (state !== 'playing') break;
                }
                return problems.slice(0, 5);
            });
            expect(bad).toEqual([]);
        });

        test('score and lives stay sane over a long run', async ({ page }) => {
            const out = await page.evaluate(() => {
                startGame();
                autoStep = false;
                seedRng(4242);
                let minLives = 3;
                let lastScore = 0;
                let decreased = false;
                for (let i = 0; i < 60 * 240; i++) {
                    step(1 / 60);
                    if (score < lastScore) decreased = true;
                    lastScore = score;
                    minLives = Math.min(minLives, lives);
                    if (state !== 'playing') break;
                }
                return { decreased, minLives, score, state };
            });
            expect(out.decreased).toBe(false);
            expect(out.minLives).toBeGreaterThanOrEqual(0);
            expect(out.score).toBeGreaterThanOrEqual(0);
        });

        test('an unattended bar eventually ends the game', async ({ page }) => {
            const finalState = await page.evaluate(() => {
                startGame();
                autoStep = false;
                seedRng(5);
                for (let i = 0; i < 60 * 400; i++) {
                    step(1 / 60);
                    if (state === 'over') break;
                }
                return state;
            });
            expect(finalState).toBe('over');
        });

        test('a competent server clears the first shift without losing a life', async ({ page }) => {
            const out = await page.evaluate(() => {
                startGame();
                autoStep = false;
                seedRng(11);
                // A deterministic bot. It only ever has one empty in flight, so
                // it never misses one, and it only pours at a patron that is
                // still walking inwards, so a soda can never outrun its target
                // and smash at the door. The only way it can lose a life is by
                // letting a patron reach the taps.
                let livesAtShift2 = null;
                for (let i = 0; i < 60 * 180; i++) {
                    const incoming = [...mugs.filter((m) => m.kind === 'empty'), ...tips].sort(
                        (a, b) => a.x - b.x
                    )[0];
                    if (incoming) {
                        jerk.lane = incoming.lane;
                    } else {
                        const target = patrons
                            .filter((p) => p.push === 0)
                            .sort((a, b) => a.x - b.x)[0];
                        if (target) {
                            jerk.lane = target.lane;
                            if (!mugs.some((m) => m.kind === 'full' && m.lane === target.lane)) pour();
                        }
                    }
                    step(1 / 60);
                    if (level >= 2 && livesAtShift2 === null) livesAtShift2 = lives;
                    if (state !== 'playing') break;
                }
                return { state, level, score, livesAtShift2 };
            });
            expect(out.level).toBeGreaterThanOrEqual(2);
            expect(out.score).toBeGreaterThan(1000);
            expect(out.livesAtShift2).toBe(3);
        });
    });
});
