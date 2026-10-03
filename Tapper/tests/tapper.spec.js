const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Nearly every spec is about a bar the spec itself arranged, so the wave timer
// and the requestAnimationFrame loop are both switched off: time and patrons
// are then entirely under the spec's control.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
        autoSpawn = false;
        customers.length = 0;
        mugs.length = 0;
        empties.length = 0;
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

        test('canvas matches the declared board size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '760');
            await expect(canvas).toHaveAttribute('height', '480');
            expect(await page.evaluate(() => [CANVAS_W, CANVAS_H, LANES])).toEqual([760, 480, 4]);
        });

        test('lane centres are evenly spaced down the board', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: LANES }, (_, i) => laneY(i)),
            );
            expect(ys).toEqual([92, 196, 300, 404]);
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
            await page.evaluate(() => window.localStorage.setItem('tapper-best', '7400'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7400');
        });

        test('bar is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => [customers.length, mugs.length, empties.length]))
                .toEqual([0, 0, 0]);
        });

        test('step() does nothing while idle', async ({ page }) => {
            await page.evaluate(() => {
                autoStep = false;
                spawnCustomer(0, BAR_LEFT);
            });
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeCloseTo(before, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('a new game resets score, level and lives', async ({ page }) => {
            await page.evaluate(() => {
                score = 5000;
                level = 6;
                lives = 1;
                startGame();
            });
            expect(await page.evaluate(() => [score, level, lives])).toEqual([0, 1, 3]);
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('the bartender starts in the top lane', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('the wave target is announced in the HUD', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => waveSize)).toBe(4);
            await expect(page.locator('#served')).toHaveText('0/4');
        });
    });

    // -----------------------------------------------------------------------
    // Moving between lanes
    // -----------------------------------------------------------------------
    test.describe('lane movement', () => {
        test('ArrowDown moves down a lane', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('ArrowUp moves back up a lane', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('W and S also move between lanes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('s');
            expect(await page.evaluate(() => player.lane)).toBe(1);
            await page.keyboard.press('w');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('the bartender cannot leave the bar at either end', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(0);
            for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(
                await page.evaluate(() => LANES - 1),
            );
        });

        test('lanes do not change while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => togglePause());
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test('Space pours a mug into the current lane', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Space');
            const poured = await page.evaluate(() => mugs.map((m) => m.lane));
            expect(poured).toEqual([1]);
        });

        test('a poured mug starts at the tap end', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThanOrEqual(await page.evaluate(() => TAP_X));
            expect(await page.evaluate(() => mugs[0].x)).toBeGreaterThan(600);
        });

        test('the tap has a cooldown between pours', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                pour();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
            await advance(page, Math.ceil(60 * 0.4));
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('a poured mug slides towards the door end at the mug speed', async ({ page }) => {
            await startQuiet(page);
            const moved = await page.evaluate(() => {
                pour();
                const start = mugs[0].x;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { travelled: start - mugs[0].x, expected: MUG_SPEED * 0.5 };
            });
            expect(moved.travelled).toBeGreaterThan(0);
            expect(moved.travelled).toBeCloseTo(moved.expected, 1);
        });

        test('clicking a lane moves the bartender there and pours', async ({ page }) => {
            await startQuiet(page);
            const box = await page.locator('#canvas').boundingBox();
            const y = await page.evaluate(() => laneY(2));
            await page.mouse.click(box.x + box.width / 2, box.y + (y / 480) * box.height);
            expect(await page.evaluate(() => player.lane)).toBe(2);
            expect(await page.evaluate(() => mugs.map((m) => m.lane))).toEqual([2]);
        });

        test('pouring does nothing while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                togglePause();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving patrons
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('a mug that reaches a patron is drunk and scores', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0, 400);
                pour();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(
                await page.evaluate(() => SERVE_POINTS),
            );
            expect(await page.evaluate(() => customers[0].state)).not.toBe('advancing');
        });

        test('a served patron is pushed back down the bar', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0, 400);
                pour();
            });
            await advance(page, 30);
            const atHit = await page.evaluate(() => customers[0].x);
            await advance(page, 30);
            expect(await page.evaluate(() => customers[0].x)).toBeLessThan(atHit);
        });

        test('mugs only hit patrons in their own lane', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(2, 400);
                pour(); // bartender is in lane 0
            });
            // Long enough for the mug to pass the patron's position, well short
            // of the smash at the door end.
            await advance(page, 90);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThan(400);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('the right-most patron in a lane is served first', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0, 200);
                spawnCustomer(0, 420);
                pour();
            });
            await advance(page, 60);
            const states = await page.evaluate(() => customers.map((c) => c.state));
            expect(states[0]).toBe('advancing');
            expect(states[1]).not.toBe('advancing');
        });

        test('a patron on their way out does not take another mug', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0, 300);
                customers[0].state = 'leaving';
                pour();
            });
            await advance(page, 90);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThan(300);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('a drinking patron sends an empty mug back up the lane', async ({ page }) => {
            await startQuiet(page);
            const seen = await page.evaluate(() => {
                spawnCustomer(1, 400);
                player.lane = 1;
                pour();
                let most = 0;
                for (let i = 0; i < 300; i++) {
                    step(1 / 60);
                    most = Math.max(most, empties.length);
                }
                return most;
            });
            expect(seen).toBeGreaterThan(0);
        });

        test('a satisfied patron leaves and scores', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0, 300);
                customers[0].need = 1;
                player.lane = 0;
                pour();
            });
            // Long enough for the push, the walk out of the door and the catch.
            await advance(page, 600);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => served)).toBe(1);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(
                await page.evaluate(() => SERVE_POINTS + LEAVE_POINTS),
            );
        });

        test('a patron needing two drinks keeps advancing after the first', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0, 400);
                customers[0].need = 2;
                pour();
            });
            await advance(page, 240);
            expect(await page.evaluate(() => customers.length)).toBe(1);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
            expect(await page.evaluate(() => customers[0].need)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Catching empties
    // -----------------------------------------------------------------------
    test.describe('catching empties', () => {
        test('an empty mug in the bartender lane is caught for points', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.lane = 2;
                empties.push({ lane: 2, x: CATCH_X - 40 });
            });
            await advance(page, 120);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => CATCH_POINTS));
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an empty mug in another lane shatters and costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.lane = 0;
                empties.push({ lane: 3, x: CATCH_X - 40 });
            });
            await advance(page, 120);
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Losing a life
    // -----------------------------------------------------------------------
    test.describe('losing a life', () => {
        test('a patron reaching the taps costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnCustomer(0, TAP_X - 40));
            await advance(page, 600);
            expect(await page.evaluate(() => lives)).toBe(2);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('a mug that smashes at the door end costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => pour());
            await advance(page, 180);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('losing a life clears the bar and replays the wave', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 900;
                spawnCustomer(0, TAP_X - 10);
            });
            await advance(page, 10);
            expect(await page.evaluate(() => state)).toBe('dying');
            await advance(page, 180);
            expect(await page.evaluate(() => [customers.length, mugs.length, empties.length]))
                .toEqual([0, 0, 0]);
            expect(await page.evaluate(() => [state, served, spawned])).toEqual(['playing', 0, 0]);
            expect(await page.evaluate(() => score)).toBe(900);
        });

        test('only one life is lost per incident', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0, TAP_X - 10);
                spawnCustomer(1, TAP_X - 10);
            });
            await advance(page, 10);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the game ends when the last life is lost', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                spawnCustomer(0, TAP_X - 10);
            });
            await advance(page, 10);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('game over records a new best score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                score = 3300;
                spawnCustomer(0, TAP_X - 10);
            });
            await advance(page, 10);
            await expect(page.locator('#best')).toHaveText('3300');
            expect(await page.evaluate(() => window.localStorage.getItem('tapper-best'))).toBe('3300');
        });

        test('Space restarts after a game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                spawnCustomer(0, TAP_X - 10);
            });
            await advance(page, 10);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => [state, lives])).toEqual(['playing', 3]);
        });
    });

    // -----------------------------------------------------------------------
    // Waves and levels
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('patrons arrive on their own with the wave timer running', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            await advance(page, 60 * 10);
            expect(await page.evaluate(() => spawned)).toBeGreaterThan(0);
        });

        test('no more patrons arrive than the wave calls for', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
                lives = 99;
            });
            await advance(page, 60 * 90);
            expect(await page.evaluate(() => spawned)).toBeLessThanOrEqual(
                await page.evaluate(() => waveSize),
            );
        });

        test('patrons enter at the door end of a real lane', async ({ page }) => {
            const first = await page.evaluate(() => {
                startGame();
                autoStep = false;
                for (let i = 0; i < 60 * 10 && customers.length === 0; i++) step(1 / 60);
                const c = customers[0];
                return c ? { lane: c.lane, x: c.x, state: c.state, door: BAR_LEFT } : null;
            });
            expect(first).not.toBeNull();
            expect(first.lane).toBeGreaterThanOrEqual(0);
            expect(first.lane).toBeLessThan(4);
            expect(first.state).toBe('advancing');
            expect(first.x).toBeLessThan(first.door + 60);
        });

        test('clearing the wave advances the level and pays a bonus', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawned = waveSize;
                served = waveSize;
            });
            await advance(page, 5);
            expect(await page.evaluate(() => state)).toBe('clear');
            expect(await page.evaluate(() => score)).toBe(
                await page.evaluate(() => CLEAR_BONUS * 1),
            );
            await advance(page, 180);
            expect(await page.evaluate(() => [state, level, served, spawned]))
                .toEqual(['playing', 2, 0, 0]);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('later levels send more patrons, and faster', async ({ page }) => {
            const [w1, w5, s1, s5] = await page.evaluate(() => [
                waveFor(1),
                waveFor(5),
                customerSpeed(1),
                customerSpeed(5),
            ]);
            expect(w5).toBeGreaterThan(w1);
            expect(s5).toBeGreaterThan(s1);
        });

        test('a level plays out the same way twice', async ({ page }) => {
            const run = () =>
                page.evaluate(() => {
                    startGame();
                    autoStep = false;
                    lives = 99;
                    const lanes = [];
                    for (let i = 0; i < 60 * 60; i++) {
                        const before = spawned;
                        step(1 / 60);
                        if (spawned > before) lanes.push(customers[customers.length - 1].lane);
                    }
                    return lanes;
                });
            const a = await run();
            const b = await run();
            expect(a.length).toBeGreaterThan(0);
            expect(a).toEqual(b);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0, 300);
                pour();
                togglePause();
            });
            const before = await page.evaluate(() => [customers[0].x, mugs[0].x]);
            await advance(page, 120);
            expect(await page.evaluate(() => [customers[0].x, mugs[0].x])).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the board draws something', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0, 300);
                pour();
                draw();
            });
            const blank = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) {
                        return false;
                    }
                }
                return true;
            });
            expect(blank).toBe(false);
        });

        test('no console errors during a run', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                startGame();
                autoStep = false;
                lives = 99;
                for (let i = 0; i < 60 * 30; i++) {
                    step(1 / 60);
                    if (i % 17 === 0) pour();
                    if (i % 31 === 0) moveLane(1);
                    draw();
                }
            });
            expect(errors).toEqual([]);
        });
    });
});
