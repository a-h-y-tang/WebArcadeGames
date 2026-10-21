const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Most specs are about one customer or one mug at a time. `startQuiet` starts a
// real round and then empties the counters and replaces the spawn schedule with
// a single entry parked in the far future, so nothing arrives unannounced and
// the round can never clear itself mid-spec. Turning `autoStep` off stops the
// requestAnimationFrame loop from advancing time behind the spec's back.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
        customers.length = 0;
        mugs.length = 0;
        spawnQueue.length = 0;
        spawnQueue.push({ lane: 0, time: 1e6 });
        spawnIndex = 0;
        levelTime = 0;
    });

// Chromium can acknowledge a synthetic key event before the page listener has
// run, so lane changes are confirmed against the game's own state.
const pressLane = async (page, key, expected) => {
    await page.keyboard.press(key);
    await page.waitForFunction((l) => bartender.lane === l, expected);
};

test.describe('Soda Rush', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Soda Rush', async ({ page }) => {
            await expect(page).toHaveTitle('Soda Rush');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas matches the declared size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '760');
            await expect(canvas).toHaveAttribute('height', '480');
            expect(await page.evaluate(() => [CANVAS_W, CANVAS_H])).toEqual([760, 480]);
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
            await page.evaluate(() => window.localStorage.setItem('sodarush-best', '4820'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4820');
        });

        test('a corrupt stored best falls back to zero', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodarush-best', 'nonsense'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('0');
            expect(await page.evaluate(() => best)).toBe(0);
        });

        test('no customers or mugs before starting', async ({ page }) => {
            expect(await page.evaluate(() => [customers.length, mugs.length])).toEqual([0, 0]);
        });

        test('step() does nothing while idle', async ({ page }) => {
            await advance(page, 120);
            expect(await page.evaluate(() => [customers.length, mugs.length, levelTime])).toEqual([0, 0, 0]);
        });

        test('pour() does nothing while idle', async ({ page }) => {
            expect(await page.evaluate(() => pour())).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Geometry — the whole game is one x per counter, so it has to line up
    // -----------------------------------------------------------------------
    test.describe('geometry', () => {
        test('there are four counters', async ({ page }) => {
            expect(await page.evaluate(() => LANES)).toBe(4);
        });

        test('the tap is left of the open end', async ({ page }) => {
            const [tap, end] = await page.evaluate(() => [TAP_X, END_X]);
            expect(tap).toBeLessThan(end);
            expect(tap).toBeGreaterThan(0);
            expect(end).toBeLessThan(760);
        });

        test('counters are evenly spaced top to bottom and fit the canvas', async ({ page }) => {
            const ys = await page.evaluate(() => Array.from({ length: LANES }, (_, i) => laneY(i)));
            expect(ys).toEqual([...ys].sort((a, b) => a - b));
            const gaps = ys.slice(1).map((y, i) => y - ys[i]);
            expect(new Set(gaps).size).toBe(1);
            expect(ys[0]).toBeGreaterThan(0);
            expect(ys[ys.length - 1]).toBeLessThan(480);
        });

        test('laneAt() maps a counter centre back to its own lane', async ({ page }) => {
            const back = await page.evaluate(() =>
                Array.from({ length: LANES }, (_, i) => laneAt(laneY(i)))
            );
            expect(back).toEqual([0, 1, 2, 3]);
        });

        test('laneAt() clamps clicks above and below the bar', async ({ page }) => {
            expect(await page.evaluate(() => [laneAt(-500), laneAt(5000)])).toEqual([0, 3]);
        });
    });

    // -----------------------------------------------------------------------
    // Round configuration and the seeded spawn schedule
    // -----------------------------------------------------------------------
    test.describe('round configuration', () => {
        test('rounds get bigger and faster', async ({ page }) => {
            const cfgs = await page.evaluate(() => [1, 2, 3, 8].map((n) => levelConfig(n)));
            expect(cfgs[0].customers).toBeLessThan(cfgs[1].customers);
            expect(cfgs[1].customers).toBeLessThan(cfgs[2].customers);
            expect(cfgs[0].gap).toBeGreaterThan(cfgs[1].gap);
            expect(cfgs[0].walkSpeed).toBeLessThan(cfgs[1].walkSpeed);
            expect(cfgs[3].walkSpeed).toBeGreaterThan(cfgs[2].walkSpeed);
        });

        test('round one is the gentle one', async ({ page }) => {
            const cfg = await page.evaluate(() => levelConfig(1));
            expect(cfg).toEqual({ customers: 6, gap: 2.4, walkSpeed: 30 });
        });

        test('difficulty is capped so late rounds stay playable', async ({ page }) => {
            const cfg = await page.evaluate(() => levelConfig(99));
            expect(cfg.customers).toBeLessThanOrEqual(20);
            expect(cfg.gap).toBeGreaterThanOrEqual(0.8);
            expect(cfg.walkSpeed).toBeLessThanOrEqual(95);
        });

        test('the queue has one entry per customer, in time order, on real lanes', async ({ page }) => {
            const report = await page.evaluate(() =>
                [1, 2, 5].map((n) => {
                    const q = buildQueue(n);
                    return {
                        count: q.length,
                        expected: levelConfig(n).customers,
                        ordered: q.every((e, i) => i === 0 || e.time >= q[i - 1].time),
                        lanesOk: q.every((e) => Number.isInteger(e.lane) && e.lane >= 0 && e.lane < LANES),
                        firstPositive: q[0].time > 0,
                    };
                })
            );
            for (const r of report) {
                expect(r.count).toBe(r.expected);
                expect(r.ordered).toBe(true);
                expect(r.lanesOk).toBe(true);
                expect(r.firstPositive).toBe(true);
            }
        });

        test('the queue is seeded by the round number, so it is reproducible', async ({ page }) => {
            const [a, b] = await page.evaluate(() => [
                JSON.stringify(buildQueue(3)),
                JSON.stringify(buildQueue(3)),
            ]);
            expect(a).toBe(b);
            const fresh = await page.evaluate(() => JSON.stringify(buildQueue(3)));
            await page.reload();
            expect(await page.evaluate(() => JSON.stringify(buildQueue(3)))).toBe(fresh);
        });

        test('different rounds deal different schedules', async ({ page }) => {
            const [one, two] = await page.evaluate(() => [
                JSON.stringify(buildQueue(1)),
                JSON.stringify(buildQueue(2)),
            ]);
            expect(one).not.toBe(two);
        });

        test('no lane gets three arrivals in a row', async ({ page }) => {
            const worst = await page.evaluate(() => {
                let run = 1;
                let worst = 1;
                for (let n = 1; n <= 12; n++) {
                    const q = buildQueue(n);
                    run = 1;
                    for (let i = 1; i < q.length; i++) {
                        run = q[i].lane === q[i - 1].lane ? run + 1 : 1;
                        worst = Math.max(worst, run);
                    }
                }
                return worst;
            });
            expect(worst).toBeLessThan(3);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a round
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('the start button begins the round', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('space begins the round', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'playing');
        });

        test('a fresh round resets score, lives, level and combo', async ({ page }) => {
            await page.evaluate(() => {
                score = 999;
                lives = 1;
                level = 7;
                combo = 4;
                startGame();
            });
            expect(await page.evaluate(() => ({ score, lives, level, combo, start: START_LIVES }))).toEqual({
                score: 0,
                lives: await page.evaluate(() => START_LIVES),
                level: 1,
                combo: 0,
                start: 3,
            });
        });

        test('the bartender starts at the tap on the top counter', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('the round loads its schedule and nothing has spawned yet', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            expect(await page.evaluate(() => spawnQueue.length)).toBe(6);
            expect(await page.evaluate(() => [spawnIndex, customers.length, resolved])).toEqual([0, 0, 0]);
        });

        test('the HUD shows how many customers the round holds', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            await expect(page.locator('#served')).toHaveText('0/6');
        });
    });

    // -----------------------------------------------------------------------
    // Moving between counters
    // -----------------------------------------------------------------------
    test.describe('the bartender', () => {
        test.beforeEach(({ page }) => startQuiet(page));

        test('arrow keys walk down and up the bar', async ({ page }) => {
            await pressLane(page, 'ArrowDown', 1);
            await pressLane(page, 'ArrowDown', 2);
            await pressLane(page, 'ArrowUp', 1);
        });

        test('W and S work as well', async ({ page }) => {
            await pressLane(page, 'KeyS', 1);
            await pressLane(page, 'KeyW', 0);
        });

        test('the top and bottom counters clamp', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
            await page.evaluate(() => setLane(3));
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(3);
        });

        test('number keys jump straight to a counter', async ({ page }) => {
            await pressLane(page, 'Digit3', 2);
            await pressLane(page, 'Digit1', 0);
        });

        test('setLane() rejects counters that do not exist', async ({ page }) => {
            await page.evaluate(() => setLane(2));
            await page.evaluate(() => setLane(9));
            expect(await page.evaluate(() => bartender.lane)).toBe(2);
            await page.evaluate(() => setLane(-1));
            expect(await page.evaluate(() => bartender.lane)).toBe(2);
        });

        test('clicking a counter moves there and pours in one gesture', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            const y = await page.evaluate(() => laneY(2));
            await page.mouse.click(box.x + box.width / 2, box.y + (y * box.height) / 480);
            await page.waitForFunction(() => mugs.length === 1);
            expect(await page.evaluate(() => [bartender.lane, mugs[0].lane])).toEqual([2, 2]);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test.beforeEach(({ page }) => startQuiet(page));

        test('a poured mug starts full, at the tap, on the bartender lane', async ({ page }) => {
            const mug = await page.evaluate(() => {
                setLane(2);
                pour();
                return { mugs: mugs.map((m) => ({ lane: m.lane, x: m.x, full: m.full, resting: m.resting })), tap: TAP_X };
            });
            expect(mug.mugs).toEqual([{ lane: 2, x: mug.tap, full: true, resting: false }]);
        });

        test('a full mug slides towards the open end at the mug speed', async ({ page }) => {
            const run = await page.evaluate(() => {
                pour();
                const from = mugs[0].x;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { moved: mugs[0].x - from, speed: MUG_SPEED };
            });
            expect(run.moved).toBeGreaterThan(0);
            expect(run.moved).toBeCloseTo(run.speed * 0.5, 0);
        });

        test('space pours while playing instead of restarting', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => mugs.length === 1);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the tap has a cooldown', async ({ page }) => {
            expect(await page.evaluate(() => pour())).toBe(true);
            expect(await page.evaluate(() => pour())).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('the cooldown expires', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, Math.ceil(0.25 * 60));
            expect(await page.evaluate(() => pour())).toBe(true);
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('two counters can have mugs in flight at once', async ({ page }) => {
            await page.evaluate(() => {
                pour();
                bartender.pourCooldown = 0;
                setLane(3);
                pour();
            });
            expect(await page.evaluate(() => mugs.map((m) => m.lane))).toEqual([0, 3]);
        });
    });

    // -----------------------------------------------------------------------
    // Serving a customer
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(({ page }) => startQuiet(page));

        test('a full mug that reaches a customer is caught and scores', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, 400);
                pour();
            });
            const caught = await page.evaluate(() => {
                for (let i = 0; i < 300 && customers[0].state === 'walking'; i++) step(1 / 60);
                return { state: customers[0].state, full: mugs.filter((m) => m.full).length, score, unit: SCORE_SERVE };
            });
            expect(caught.full).toBe(0);
            expect(caught.state).toBe('drinking');
            expect(caught.score).toBe(caught.unit);
        });

        test('the mug stops at the customer, not past them', async ({ page }) => {
            const where = await page.evaluate(() => {
                const c = spawnCustomer(1, 500);
                setLane(1);
                pour();
                for (let i = 0; i < 300 && customers[0].state === 'walking'; i++) step(1 / 60);
                return { cust: c.x, tap: TAP_X, end: END_X };
            });
            expect(where.cust).toBeGreaterThan(where.tap);
            expect(where.cust).toBeLessThan(where.end);
        });

        test('only the customer nearest the tap takes the mug', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, 600);
                spawnCustomer(0, 300);
                pour();
            });
            await advance(page, 120);
            const states = await page.evaluate(() => customers.map((c) => c.state));
            expect(states.filter((s) => s === 'walking').length).toBe(1);
            expect(states.filter((s) => s !== 'walking').length).toBe(1);
            const drinker = await page.evaluate(() => customers.find((c) => c.state !== 'walking').x);
            const walker = await page.evaluate(() => customers.find((c) => c.state === 'walking').x);
            expect(drinker).toBeLessThan(walker);
        });

        test('a customer on another counter is not served', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(2, 400);
                setLane(0);
                pour();
            });
            await advance(page, 180);
            expect(await page.evaluate(() => customers[0].state)).toBe('walking');
        });

        test('a drinking customer holds still, then leaves and releases the empty', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, 420);
                pour();
                for (let i = 0; i < 120 && customers[0].state === 'walking'; i++) step(1 / 60);
            });
            const parked = await page.evaluate(() => customers[0].x);
            await advance(page, 20);
            expect(await page.evaluate(() => customers[0].x)).toBe(parked);
            expect(await page.evaluate(() => mugs.length)).toBe(0);

            const released = await page.evaluate(() => {
                for (let i = 0; i < 300 && customers[0].state === 'drinking'; i++) step(1 / 60);
                return { state: customers[0].state, mugs: mugs.map((m) => ({ full: m.full, lane: m.lane, x: m.x })) };
            });
            expect(released.state).toBe('leaving');
            expect(released.mugs.length).toBe(1);
            expect(released.mugs[0].full).toBe(false);
            expect(released.mugs[0].lane).toBe(0);
            // released where the customer stood, already a frame into its slide back
            expect(released.mugs[0].x).toBeLessThanOrEqual(parked);
            expect(released.mugs[0].x).toBeGreaterThan(parked - 10);
        });

        test('a leaving customer runs off the open end, satisfied', async ({ page }) => {
            await page.evaluate(() => {
                const c = spawnCustomer(0, 420);
                c.state = 'leaving';
            });
            await advance(page, 300);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => [score, resolved, lives])).toEqual([
                await page.evaluate(() => SCORE_SATISFIED),
                1,
                3,
            ]);
        });

        test('a leaving customer ignores further mugs', async ({ page }) => {
            await page.evaluate(() => {
                const c = spawnCustomer(0, 300);
                c.state = 'leaving';
                pour();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => lives)).toBe(2); // the second mug smashed
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(({ page }) => startQuiet(page));

        test('an empty slides back towards the tap and parks there', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(1, 600));
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThan(before);

            const parked = await page.evaluate(() => {
                setLane(3);
                for (let i = 0; i < 600 && !(mugs[0] && mugs[0].resting); i++) step(1 / 60);
                return { x: mugs[0].x, resting: mugs[0].resting, tap: TAP_X, lives };
            });
            expect(parked.resting).toBe(true);
            expect(parked.x).toBe(parked.tap);
            expect(parked.lives).toBe(3);
        });

        test('an empty is collected when the bartender is on that counter', async ({ page }) => {
            await page.evaluate(() => {
                setLane(1);
                spawnEmpty(1, 400);
            });
            await advance(page, 300);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => [lives, combo])).toEqual([3, 1]);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => SCORE_EMPTY));
        });

        test('arriving on the counter during the grace window still saves it', async ({ page }) => {
            await page.evaluate(() => {
                setLane(0);
                spawnEmpty(2, 200);
            });
            await page.evaluate(() => {
                for (let i = 0; i < 300 && !(mugs[0] && mugs[0].resting); i++) step(1 / 60);
            });
            expect(await page.evaluate(() => mugs[0].resting)).toBe(true);
            await page.evaluate(() => setLane(2));
            await advance(page, 2);
            expect(await page.evaluate(() => [mugs.length, lives])).toEqual([0, 3]);
        });

        test('an empty left alone smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => {
                setLane(0);
                spawnEmpty(3, 200);
            });
            await advance(page, 600);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the grace window is real, not instant death', async ({ page }) => {
            await page.evaluate(() => {
                setLane(0);
                spawnEmpty(3, TAP_X + 1);
            });
            await advance(page, Math.ceil(0.5 * 60));
            expect(await page.evaluate(() => [mugs.length, lives])).toEqual([1, 3]);
        });

        test('a mug on its last frame is caught, not lost, if you arrive for it', async ({ page }) => {
            const out = await page.evaluate(() => {
                setLane(0);
                const m = spawnEmpty(1, TAP_X);
                m.resting = true;
                m.timer = 1 / 120;      // expires inside the next frame
                setLane(1);
                step(1 / 60);
                return { mugs: mugs.length, lives, combo };
            });
            expect(out).toEqual({ mugs: 0, lives: 3, combo: 1 });
        });

        test('two empties on different counters can both be saved', async ({ page }) => {
            await page.evaluate(() => {
                setLane(0);
                spawnEmpty(1, TAP_X + 40);
                spawnEmpty(2, TAP_X + 40);
            });
            await page.evaluate(() => {
                for (let i = 0; i < 600 && mugs.length; i++) {
                    const resting = mugs.filter((m) => m.resting);
                    if (resting.length) setLane(resting[0].lane);
                    step(1 / 60);
                }
            });
            expect(await page.evaluate(() => [mugs.length, lives, combo])).toEqual([0, 3, 2]);
        });

        test('the combo multiplies collected empties and caps out', async ({ page }) => {
            const scores = await page.evaluate(() => {
                const seen = [];
                for (let i = 0; i < 8; i++) {
                    const before = score;
                    spawnEmpty(bartender.lane, TAP_X + 20);
                    for (let f = 0; f < 120 && mugs.length; f++) step(1 / 60);
                    seen.push({ combo, gained: score - before });
                }
                return { seen, cap: COMBO_MAX, unit: SCORE_EMPTY };
            });
            expect(scores.seen.map((s) => s.combo)).toEqual([1, 2, 3, 4, 5, 5, 5, 5]);
            expect(scores.seen.map((s) => s.gained)).toEqual(
                scores.seen.map((s) => s.combo * scores.unit)
            );
            expect(scores.cap).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Losing lives
    // -----------------------------------------------------------------------
    test.describe('losing a life', () => {
        test.beforeEach(({ page }) => startQuiet(page));

        test('a full mug poured at an empty counter smashes', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 300);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('a customer that reaches the tap costs a life and is resolved', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0, TAP_X + 40));
            await advance(page, 600);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => [lives, resolved])).toEqual([2, 1]);
        });

        test('losing a life resets the combo', async ({ page }) => {
            await page.evaluate(() => {
                combo = 4;
                pour();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => combo)).toBe(0);
        });

        test('losing a life clears the counters and pushes customers back', async ({ page }) => {
            const out = await page.evaluate(() => {
                const c = spawnCustomer(2, 400);
                const before = c.x;
                // one mug a frame from smashing, one innocently mid-counter
                mugs.push({ lane: 0, x: END_X - 1, full: true, resting: false, timer: 0 });
                mugs.push({ lane: 3, x: TAP_X + 50, full: true, resting: false, timer: 0 });
                step(1 / 60);
                return { before, after: c.x, mugs: mugs.length, lives, push: RESET_PUSH };
            });
            expect(out.mugs).toBe(0);
            expect(out.lives).toBe(2);
            expect(out.after).toBeGreaterThan(out.before);
            expect(out.after - out.before).toBeLessThanOrEqual(out.push);
        });

        test('a pushed-back customer never goes past the open end', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(2, END_X - 5);
                pour();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => customers[0].x)).toBeLessThanOrEqual(
                await page.evaluate(() => END_X)
            );
        });

        test('two disasters in one frame cost only one life', async ({ page }) => {
            await page.evaluate(() => {
                setLane(0);
                // a mug one frame from the open end and a customer one frame from the tap
                mugs.push({ lane: 1, x: END_X - 1, full: true, resting: false, timer: 0 });
                spawnCustomer(2, TAP_X + 1);
            });
            await advance(page, 1);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the banner names which mistake cost the life', async ({ page }) => {
            const seen = await page.evaluate(() => {
                const run = (setup) => {
                    mugs.length = 0;
                    customers.length = 0;
                    notice = 0;
                    lives = 9;
                    setup();
                    for (let i = 0; i < 600 && !notice; i++) step(1 / 60);
                    return noticeText;
                };
                setLane(0);
                return {
                    spilled: run(() => mugs.push({ lane: 1, x: END_X - 1, full: true, resting: false, timer: 0 })),
                    grabbed: run(() => spawnCustomer(2, TAP_X + 1)),
                    dropped: run(() => {
                        const m = spawnEmpty(3, TAP_X);
                        m.resting = true;
                        m.timer = 0.05;
                    }),
                };
            });
            expect(seen.spilled).toMatch(/end/i);
            expect(seen.grabbed).toMatch(/customer/i);
            expect(seen.dropped).toMatch(/smash/i);
            expect(new Set(Object.values(seen)).size).toBe(3);
        });

        test('the banner fades on its own', async ({ page }) => {
            await page.evaluate(() => {
                pour();
                for (let i = 0; i < 600 && lives === 3; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => notice)).toBeGreaterThan(0);
            await advance(page, Math.ceil((await page.evaluate(() => NOTICE_TIME)) * 60) + 5);
            expect(await page.evaluate(() => notice)).toBe(0);
        });

        test('the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                pour();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => [lives, state])).toEqual([0, 'over']);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('game over clears the banners instead of freezing them on screen', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                pour();
                for (let i = 0; i < 600 && state === 'playing'; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('over');
            expect(await page.evaluate(() => [notice, hitFlash])).toEqual([0, 0]);
        });

        test('game over freezes the simulation', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                pour();
            });
            await advance(page, 300);
            await page.evaluate(() => spawnCustomer(0, 400));
            const x = await page.evaluate(() => customers[0].x);
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBe(x);
        });

        test('game over records a new best score', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                score = 3200;
                pour();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => best)).toBe(3200);
            expect(await page.evaluate(() => window.localStorage.getItem('sodarush-best'))).toBe('3200');
            await expect(page.locator('#best')).toHaveText('3200');
        });

        test('a worse score leaves the best alone', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodarush-best', '9000'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                score = 10;
                pour();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => window.localStorage.getItem('sodarush-best'))).toBe('9000');
        });

        test('the game can be restarted after it ends', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                pour();
            });
            await advance(page, 300);
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'playing');
            expect(await page.evaluate(() => [lives, score, level])).toEqual([3, 0, 1]);
        });
    });

    // -----------------------------------------------------------------------
    // Customers arriving
    // -----------------------------------------------------------------------
    test.describe('arrivals', () => {
        test('a queued customer appears at the open end of its counter', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
                customers.length = 0;
                mugs.length = 0;
                spawnQueue.length = 0;
                spawnQueue.push({ lane: 2, time: 0.5 });
                spawnIndex = 0;
                levelTime = 0;
            });
            await advance(page, 20);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            const arrival = await page.evaluate(() => {
                for (let i = 0; i < 120 && !customers.length; i++) step(1 / 60);
                return { seen: customers.map((c) => ({ lane: c.lane, x: c.x, state: c.state })), end: END_X, idx: spawnIndex };
            });
            expect(arrival.seen).toEqual([{ lane: 2, x: arrival.end, state: 'walking' }]);
            expect(arrival.idx).toBe(1);
            await advance(page, 10);
            expect(await page.evaluate(() => customers[0].x)).toBeLessThan(arrival.end);
        });

        test('customers walk towards the tap at the round speed', async ({ page }) => {
            await startQuiet(page);
            const moved = await page.evaluate(() => {
                const c = spawnCustomer(0, 600);
                const from = c.x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { delta: from - c.x, speed: levelConfig(level).walkSpeed };
            });
            expect(moved.delta).toBeCloseTo(moved.speed, 0);
        });

        test('a backlog of due arrivals all come in', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
                customers.length = 0;
                mugs.length = 0;
                spawnQueue.length = 0;
                spawnQueue.push({ lane: 0, time: 0.1 }, { lane: 1, time: 0.1 }, { lane: 2, time: 0.1 });
                spawnIndex = 0;
                levelTime = 0;
            });
            await advance(page, 12);
            expect(await page.evaluate(() => customers.map((c) => c.lane))).toEqual([0, 1, 2]);
        });
    });

    // -----------------------------------------------------------------------
    // Clearing a round
    // -----------------------------------------------------------------------
    test.describe('clearing a round', () => {
        test('a round only clears once the counters are empty', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
                customers.length = 0;
                mugs.length = 0;
                spawnQueue.length = 0;
                spawnIndex = 0;
                levelTime = 0;
                const c = spawnCustomer(0, 400);
                c.state = 'leaving';
            });
            await advance(page, 10);
            expect(await page.evaluate(() => level)).toBe(1);
            await advance(page, 300);
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('a round does not clear while a mug is still sliding', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
                customers.length = 0;
                mugs.length = 0;
                spawnQueue.length = 0;
                spawnIndex = 0;
                levelTime = 0;
                spawnEmpty(0, 600);
                setLane(0);
            });
            await advance(page, 5);
            expect(await page.evaluate(() => level)).toBe(1);
            await advance(page, 400);
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('clearing pays a bonus, deals a new schedule and keeps the score', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                autoStep = false;
                customers.length = 0;
                mugs.length = 0;
                spawnQueue.length = 0;
                spawnIndex = 0;
                levelTime = 5;
                score = 100;
                for (let i = 0; i < 5; i++) step(1 / 60);
                return { score, level, queue: spawnQueue.length, idx: spawnIndex, t: levelTime, bonus: SCORE_LEVEL };
            });
            expect(after.level).toBe(2);
            expect(after.score).toBe(100 + after.bonus);
            expect(after.queue).toBe(8);
            expect(after.idx).toBe(0);
            expect(after.t).toBeLessThan(0.1);
        });

        test('the round bonus grows with the round number', async ({ page }) => {
            const gains = await page.evaluate(() => {
                const clear = () => {
                    customers.length = 0;
                    mugs.length = 0;
                    spawnQueue.length = 0;
                    spawnIndex = 0;
                    const before = score;
                    for (let i = 0; i < 5; i++) step(1 / 60);
                    return score - before;
                };
                startGame();
                autoStep = false;
                return [clear(), clear()];
            });
            expect(gains[1]).toBeGreaterThan(gains[0]);
        });

        test('clearing resets the served counter in the HUD', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
                resolved = 4;
                customers.length = 0;
                mugs.length = 0;
                spawnQueue.length = 0;
                spawnIndex = 0;
                for (let i = 0; i < 5; i++) step(1 / 60);
            });
            await expect(page.locator('#served')).toHaveText('0/8');
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(({ page }) => startQuiet(page));

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('KeyP');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('KeyP');
            await page.waitForFunction(() => state === 'playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, 500);
                pour();
                togglePause();
            });
            const snap = await page.evaluate(() => [customers[0].x, mugs[0].x]);
            await advance(page, 120);
            expect(await page.evaluate(() => [customers[0].x, mugs[0].x])).toEqual(snap);
        });

        test('space resumes a paused game without restarting it', async ({ page }) => {
            await page.evaluate(() => {
                score = 777;
                togglePause();
            });
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'playing');
            expect(await page.evaluate(() => score)).toBe(777);
        });

        test('pausing is ignored when the game is not running', async ({ page }) => {
            await page.evaluate(() => {
                state = 'over';
                togglePause();
            });
            expect(await page.evaluate(() => state)).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Presentation — draw() must stay a pure read of the state
    // -----------------------------------------------------------------------
    test.describe('presentation', () => {
        test('draw() does not touch the simulation', async ({ page }) => {
            await startQuiet(page);
            const snap = await page.evaluate(() => {
                spawnCustomer(1, 500);
                spawnEmpty(2, 400);
                pour();
                const before = JSON.stringify({ customers, mugs, score, lives, level, combo });
                for (let i = 0; i < 10; i++) draw();
                return [before, JSON.stringify({ customers, mugs, score, lives, level, combo })];
            });
            expect(snap[1]).toBe(snap[0]);
        });

        test('the HUD tracks the score and the round', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 1234;
                level = 5;
                resolved = 3;
                lives = 2;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('1234');
            await expect(page.locator('#level')).toHaveText('5');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#served')).toHaveText('3/14');
        });

        test('smashing glass throws shards that fade', async ({ page }) => {
            await startQuiet(page);
            const burst = await page.evaluate(() => {
                pour();
                for (let i = 0; i < 600 && lives === 3; i++) step(1 / 60);
                return shards.length;
            });
            expect(burst).toBeGreaterThan(0);
            await advance(page, Math.ceil(await page.evaluate(() => SHARD_LIFE) * 60) + 5);
            expect(await page.evaluate(() => shards.length)).toBe(0);
        });

        test('the canvas renders something once the round is running', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForTimeout(150);
            const blank = await page.evaluate(() => {
                const ctx = canvas.getContext('2d');
                const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
                let seen = new Set();
                for (let i = 0; i < data.length; i += 4000) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                return seen.size;
            });
            expect(blank).toBeGreaterThan(3);
        });
    });

    // -----------------------------------------------------------------------
    // Game browser integration
    // -----------------------------------------------------------------------
    test.describe('game browser integration', () => {
        const catalogue = () =>
            JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8'));

        test('games.json lists Soda Rush', () => {
            const entry = catalogue().find((g) => g.id === 'soda-rush');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Soda Rush');
            expect(entry.dir).toBe('SodaRush');
            expect(entry.path).toBe('games/SodaRush/index.html');
            expect(entry.thumbnail).toBe('games/SodaRush/screenshot.png');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the entry sits in alphabetical order among its neighbours', () => {
            const games = catalogue();
            const i = games.findIndex((g) => g.id === 'soda-rush');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
        });

        test('the file the browser links to is really there', () => {
            const entry = catalogue().find((g) => g.id === 'soda-rush');
            expect(fs.existsSync(path.join(REPO_ROOT, entry.dir, 'index.html'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaRush/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(/\|\s*Soda Rush\s*\|\s*\[SodaRush\/\]\(SodaRush\/\)\s*\|\s*(Complete|In Progress)\s*\|/);
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaRush/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaRush/DESIGN.md'))).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // End to end — the game has to be winnable with the real rules
    // -----------------------------------------------------------------------
    test.describe('playability', () => {
        // A deliberately simple greedy bartender: collect whatever empty is
        // closest to smashing, and otherwise pour at the customer nearest the
        // tap on a counter that has no mug of its own in flight. If the rules
        // are fair, this is enough to clear the opening rounds untouched.
        const autoplay = (page, targetLevel, seconds) =>
            page.evaluate(
                ([target, limit]) => {
                    const dt = 1 / 60;
                    let t = 0;
                    while (t < limit && state === 'playing' && level < target) {
                        const resting = mugs.filter((m) => !m.full && m.resting);
                        const returning = mugs.filter((m) => !m.full && !m.resting);
                        if (resting.length) {
                            resting.sort((a, b) => a.timer - b.timer);
                            setLane(resting[0].lane);
                        } else if (returning.length) {
                            returning.sort((a, b) => a.x - b.x);
                            setLane(returning[0].lane);
                        }
                        const keep = bartender.lane;
                        if (bartender.pourCooldown <= 0) {
                            const needy = customers
                                .filter(
                                    (c) =>
                                        c.state === 'walking' &&
                                        !mugs.some((m) => m.full && m.lane === c.lane)
                                )
                                .sort((a, b) => a.x - b.x);
                            if (needy.length) {
                                setLane(needy[0].lane);
                                pour();
                                setLane(keep);
                            }
                        }
                        step(dt);
                        t += dt;
                    }
                    return { level, lives, score, state, elapsed: t, left: customers.length };
                },
                [targetLevel, seconds]
            );

        test('round one can be cleared without losing a life', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            const out = await autoplay(page, 2, 90);
            expect(out.state).toBe('playing');
            expect(out.level).toBe(2);
            expect(out.lives).toBe(3);
            expect(out.score).toBeGreaterThan(0);
        });

        test('the first three rounds can be cleared without losing a life', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            const out = await autoplay(page, 4, 240);
            expect(out.state).toBe('playing');
            expect(out.level).toBe(4);
            expect(out.lives).toBe(3);
        });

        test('every customer in a cleared round is accounted for', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            const totals = await page.evaluate(() => {
                const dt = 1 / 60;
                let t = 0;
                let peakResolved = 0;
                const seen = new Set();
                while (t < 90 && state === 'playing' && level < 2) {
                    customers.forEach((c) => seen.add(c));
                    const resting = mugs.filter((m) => !m.full && m.resting);
                    if (resting.length) setLane(resting.sort((a, b) => a.timer - b.timer)[0].lane);
                    const keep = bartender.lane;
                    if (bartender.pourCooldown <= 0) {
                        const needy = customers
                            .filter((c) => c.state === 'walking' && !mugs.some((m) => m.full && m.lane === c.lane))
                            .sort((a, b) => a.x - b.x);
                        if (needy.length) {
                            setLane(needy[0].lane);
                            pour();
                            setLane(keep);
                        }
                    }
                    step(dt);
                    peakResolved = Math.max(peakResolved, resolved);
                    t += dt;
                }
                return { seen: seen.size, satisfied: peakResolved, level, score };
            });
            expect(totals.seen).toBe(6);
            expect(totals.satisfied).toBe(6);
            expect(totals.level).toBe(2);
            // 6 served + 6 satisfied + 6 empties collected at a rising combo + round bonus
            expect(totals.score).toBeGreaterThanOrEqual(6 * 50 + 6 * 100 + 300);
        });

        test('ignoring the bar loses the game', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
                for (let i = 0; i < 60 * 120 && state === 'playing'; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('over');
            expect(await page.evaluate(() => lives)).toBe(0);
        });
    });
});
