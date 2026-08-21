const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
// Every spec switches `autoStep` off first, so the animation loop only draws
// and the clock belongs entirely to the test.
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a run with automatic arrivals switched off, so a spec sees exactly the
// customers it places itself. Specs that are about arrivals leave them on.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
    });

test.describe('Soda Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(() => {
            autoStep = false;
        });
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
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '3300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('3300');
        });

        test('the counters are empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('there are four evenly spaced counters', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: LANE_COUNT }, (_, l) => laneY(l))
            );
            expect(ys).toHaveLength(4);
            expect(ys[1] - ys[0]).toBe(ys[2] - ys[1]);
            expect(ys[2] - ys[1]).toBe(ys[3] - ys[2]);
            expect(ys[3]).toBeLessThan(await page.evaluate(() => CANVAS_H));
        });

        test('the taps sit at the right-hand end of the counters', async ({ page }) => {
            expect(await page.evaluate(() => TAP_X)).toBe(await page.evaluate(() => BAR_RIGHT));
            expect(await page.evaluate(() => BAR_LEFT)).toBeLessThan(
                await page.evaluate(() => BAR_RIGHT)
            );
        });

        test('step() does nothing while idle', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0));
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a fresh run starts empty at level 1 with three lives', async ({ page }) => {
            await startQuiet(page);
            const s = await page.evaluate(() => ({
                score,
                lives,
                level,
                customers: customers.length,
                mugs: mugs.length,
            }));
            expect(s).toEqual({ score: 0, lives: 3, level: 1, customers: 0, mugs: 0 });
        });

        test('the barman starts at the taps in the top lane', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => barman.lane)).toBe(0);
            expect(await page.evaluate(() => barman.x)).toBe(await page.evaluate(() => TAP_X));
        });
    });

    // -----------------------------------------------------------------------
    // Moving between counters
    // -----------------------------------------------------------------------
    test.describe('the barman', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowDown moves down a counter', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => barman.lane)).toBe(1);
        });

        test('ArrowUp moves back up a counter', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => barman.lane)).toBe(1);
        });

        test('W and S also move between counters', async ({ page }) => {
            await page.keyboard.press('s');
            expect(await page.evaluate(() => barman.lane)).toBe(1);
            await page.keyboard.press('w');
            expect(await page.evaluate(() => barman.lane)).toBe(0);
        });

        test('the barman cannot go above the top counter', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => barman.lane)).toBe(0);
        });

        test('the barman cannot go below the bottom counter', async ({ page }) => {
            for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => barman.lane)).toBe(
                (await page.evaluate(() => LANE_COUNT)) - 1
            );
        });

        test('the barman does not move while paused', async ({ page }) => {
            await page.evaluate(() => togglePause());
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => barman.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space pours a full mug into the current lane', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Space');
            const mug = await page.evaluate(() => mugs[0]);
            expect(mug.lane).toBe(1);
            expect(mug.full).toBe(true);
        });

        test('a poured mug starts at the taps', async ({ page }) => {
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThanOrEqual(
                await page.evaluate(() => TAP_X)
            );
            expect(await page.evaluate(() => mugs[0].x)).toBeGreaterThan(
                (await page.evaluate(() => TAP_X)) - 40
            );
        });

        test('a full mug slides away from the taps', async ({ page }) => {
            await page.evaluate(() => pour());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThan(before);
        });

        test('the tap cannot be pulled twice in a row', async ({ page }) => {
            await page.evaluate(() => {
                pour();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('the tap can be pulled again once it has recharged', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 30);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('pouring does nothing while paused', async ({ page }) => {
            await page.evaluate(() => togglePause());
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('clicking a counter moves the barman there and pours', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            const y = await page.evaluate(() => laneY(2));
            await page.mouse.click(box.x + 300, box.y + y - 4);
            expect(await page.evaluate(() => barman.lane)).toBe(2);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
            expect(await page.evaluate(() => mugs[0].lane)).toBe(2);
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

        test('a customer enters at the far end of the counter', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnCustomer(2));
            const c = await page.evaluate(() => customers[0]);
            expect(c.lane).toBe(2);
            expect(c.state).toBe('advancing');
            expect(c.x).toBeCloseTo(await page.evaluate(() => BAR_LEFT), 5);
        });

        test('a customer walks toward the taps', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnCustomer(0));
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeGreaterThan(before);
        });

        test('a customer reaching the taps costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnCustomer(0, TAP_X - 20));
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => lastLoss)).toBe('grabbed');
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('customers get faster each level', async ({ page }) => {
            await startQuiet(page);
            const l1 = await page.evaluate(() => customerSpeed(1));
            expect(await page.evaluate(() => customerSpeed(4))).toBeGreaterThan(l1);
        });

        test('customers never outrun a poured mug', async ({ page }) => {
            expect(await page.evaluate(() => customerSpeed(50))).toBeLessThan(
                await page.evaluate(() => MUG_SPEED)
            );
        });

        test('customers arrive more often at higher levels', async ({ page }) => {
            const l1 = await page.evaluate(() => spawnInterval(1));
            expect(await page.evaluate(() => spawnInterval(6))).toBeLessThan(l1);
        });

        test('later waves hold more customers', async ({ page }) => {
            const l1 = await page.evaluate(() => waveSize(1));
            expect(await page.evaluate(() => waveSize(3))).toBeGreaterThan(l1);
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a full mug reaching a customer is caught and scores', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 300);
                pour();
            });
            await advance(page, 50);
            expect(await page.evaluate(() => mugs.filter((m) => m.full).length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(50);
            expect(await page.evaluate(() => customers[0].state)).toBe('drinking');
        });

        test('a drinking customer is shoved back down the counter', async ({ page }) => {
            const before = await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 300);
                pour();
                for (let i = 0; i < 120 && customers[0].state !== 'drinking'; i++) step(1 / 60);
                return customers[0].x;
            });
            await advance(page, 20);
            expect(await page.evaluate(() => customers[0].x)).toBeLessThan(before);
        });

        test('the customer nearest the taps catches the mug', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 80);
                spawnCustomer(0, BAR_LEFT + 320);
                pour();
            });
            await advance(page, 50);
            const states = await page.evaluate(() => customers.map((c) => c.state));
            expect(states).toEqual(['advancing', 'drinking']);
        });

        test('a mug in another lane does not serve anyone', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(1, BAR_LEFT + 300);
                pour(); // barman is in lane 0
            });
            // Long enough for the mug to pass the customer's position, short
            // enough that it has not yet run off the far end.
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
        });

        test('a served customer throws the empty mug back', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 300);
                pour();
            });
            await advance(page, 180);
            const empties = await page.evaluate(() => mugs.filter((m) => !m.full));
            expect(empties.length).toBe(1);
            expect(empties[0].lane).toBe(0);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
        });

        test('an empty mug travels back toward the taps', async ({ page }) => {
            await page.evaluate(() => spawnMug(0, BAR_LEFT + 100, false));
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            expect(await page.evaluate(() => mugs[0].x)).toBeGreaterThan(before);
        });

        test('a second mug extends the drink and comes back as a second empty', async ({
            page,
        }) => {
            // A mug poured from the taps cannot catch a customer who is already
            // being shoved backwards, so both mugs are placed on the counter
            // right in front of them.
            await page.evaluate(() => {
                const c = spawnCustomer(0, BAR_LEFT + 380);
                const inFront = () => spawnMug(0, c.x + CUST_HW + MUG_HW + 4, true);
                inFront();
                for (let i = 0; i < 5 && c.hold < 1; i++) step(1 / 60);
                inFront();
                for (let i = 0; i < 5 && c.hold < 2; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => customers[0].state)).toBe('drinking');
            expect(await page.evaluate(() => customers[0].hold)).toBe(2);
            await advance(page, 60);
            expect(await page.evaluate(() => mugs.filter((m) => !m.full).length)).toBe(2);
        });

        test('shoving a customer off the far end sends them home happy', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 60);
                pour();
            });
            await advance(page, 180);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(150);
        });

        test('a customer sent home still returns their mug', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 60);
                pour();
            });
            await advance(page, 180);
            expect(await page.evaluate(() => mugs.filter((m) => !m.full).length)).toBe(1);
        });

        test('a full mug that reaches the far end spills and costs a life', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 180);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => lastLoss)).toBe('spill');
        });
    });

    // -----------------------------------------------------------------------
    // Catching empties
    // -----------------------------------------------------------------------
    test.describe('empties', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty is caught when the barman is in its lane', async ({ page }) => {
            await page.evaluate(() => spawnMug(0, TAP_X - 60, false));
            await advance(page, 60);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(25);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an empty smashes when the barman is elsewhere', async ({ page }) => {
            await page.evaluate(() => spawnMug(3, TAP_X - 60, false));
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => lastLoss)).toBe('shatter');
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('moving to the right counter in time saves the mug', async ({ page }) => {
            await page.evaluate(() => spawnMug(3, TAP_X - 200, false));
            await advance(page, 10);
            await page.evaluate(() => {
                barman.lane = 3;
            });
            await advance(page, 90);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => score)).toBe(25);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('losing', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('losing a life clears the counters', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(1, BAR_LEFT + 100);
                spawnMug(3, TAP_X - 10, false);
            });
            await advance(page, 5);
            expect(await page.evaluate(() => state)).toBe('dying');
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('play resumes after the pause for breath', async ({ page }) => {
            await page.evaluate(() => spawnMug(3, TAP_X - 10, false));
            await advance(page, 5);
            await advance(page, 120);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the score survives a life lost', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                spawnMug(3, TAP_X - 10, false);
            });
            await advance(page, 130);
            expect(await page.evaluate(() => score)).toBe(900);
        });

        test('a single frame never costs two lives', async ({ page }) => {
            await page.evaluate(() => {
                spawnMug(3, TAP_X - 2, false);
                spawnMug(2, TAP_X - 2, false);
            });
            await advance(page, 1);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                spawnMug(3, TAP_X - 10, false);
            });
            await advance(page, 5);
            expect(await page.evaluate(() => lives)).toBe(0);
            await advance(page, 130);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('the game over overlay reports the score', async ({ page }) => {
            await page.evaluate(() => {
                score = 1234;
                lives = 1;
                spawnMug(3, TAP_X - 10, false);
            });
            await advance(page, 135);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('clearing every customer clears the wave', async ({ page }) => {
            await page.evaluate(() => serveWaveForTest());
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('waveclear');
        });

        test('an outstanding mug holds the wave open', async ({ page }) => {
            await page.evaluate(() => {
                serveWaveForTest();
                spawnMug(0, BAR_LEFT + 100, false);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('clearing a wave pays a bonus', async ({ page }) => {
            const before = await page.evaluate(() => score);
            await page.evaluate(() => serveWaveForTest());
            await advance(page, 2);
            expect(await page.evaluate(() => score)).toBe(
                before + (await page.evaluate(() => waveBonus(1)))
            );
        });

        test('the next wave starts on a clean set of counters', async ({ page }) => {
            await page.evaluate(() => serveWaveForTest());
            await advance(page, 150);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => spawned)).toBe(0);
        });

        test('the HUD follows the level', async ({ page }) => {
            await page.evaluate(() => serveWaveForTest());
            await advance(page, 150);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('a life lost restarts the wave rather than the game', async ({ page }) => {
            await page.evaluate(() => {
                level = 3;
                spawned = 4;
                spawnMug(3, TAP_X - 10, false);
            });
            await advance(page, 130);
            expect(await page.evaluate(() => level)).toBe(3);
            expect(await page.evaluate(() => spawned)).toBe(0);
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
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                pour();
                togglePause();
            });
            const before = await page.evaluate(() => ({ c: customers[0].x, m: mugs[0].x }));
            await advance(page, 60);
            expect(await page.evaluate(() => ({ c: customers[0].x, m: mugs[0].x }))).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        const endRun = (page) =>
            page.evaluate(() => {
                lives = 1;
                spawnMug(3, TAP_X - 10, false);
                for (let i = 0; i < 140; i++) step(1 / 60);
                return state;
            });

        test('a new best is stored on game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 5555;
            });
            expect(await endRun(page)).toBe('over');
            await expect(page.locator('#best')).toHaveText('5555');
            expect(await page.evaluate(() => window.localStorage.getItem('sodatapper-best'))).toBe(
                '5555'
            );
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '9999'));
            await page.reload();
            await page.evaluate(() => {
                autoStep = false;
            });
            await startQuiet(page);
            await page.evaluate(() => {
                score = 10;
            });
            await endRun(page);
            await expect(page.locator('#best')).toHaveText('9999');
        });

        test('restarting after game over resets the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 500;
                level = 4;
            });
            await endRun(page);
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 200);
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
                spawnCustomer(0, BAR_LEFT + 200);
                spawnCustomer(2, BAR_LEFT + 60);
                pour();
                for (let i = 0; i < 120; i++) step(1 / 60);
                draw(); // running
                togglePause();
                draw(); // paused
                togglePause();
                spawnMug(3, TAP_X - 4, false);
                step(1 / 60);
                draw(); // dying
                for (let i = 0; i < 130; i++) step(1 / 60);
                serveWaveForTest();
                step(1 / 60);
                draw(); // wave clear
                for (let i = 0; i < 150; i++) step(1 / 60);
                draw();
                lives = 1;
                spawnMug(3, TAP_X - 4, false);
                for (let i = 0; i < 140; i++) step(1 / 60);
                draw(); // game over
            });
            expect(errors).toEqual([]);
        });

        test('a long unattended run does not throw', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 3600; i++) {
                    step(1 / 60);
                    if (i % 30 === 0) draw();
                }
            });
            expect(errors).toEqual([]);
        });
    });
});
