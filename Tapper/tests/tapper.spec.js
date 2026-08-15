const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with customer spawning switched off, so a spec can place
// customers by hand and run long simulations without random lane choices
// getting in the way. Specs about spawning leave it on.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
        autoRun = false;
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

        test('canvas is 640x440', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '440');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('there are four bars', async ({ page }) => {
            expect(await page.evaluate(() => LANE_COUNT)).toBe(4);
            expect(await page.evaluate(() => LANE_Y.length)).toBe(4);
        });

        test('bars are ordered top to bottom', async ({ page }) => {
            const ys = await page.evaluate(() => LANE_Y);
            expect(ys).toEqual([...ys].sort((a, b) => a - b));
        });

        test('the bar spans left to right inside the canvas', async ({ page }) => {
            const { left, right, w } = await page.evaluate(() => ({
                left: BAR_LEFT,
                right: BAR_RIGHT,
                w: CANVAS_W,
            }));
            expect(left).toBeGreaterThan(0);
            expect(right).toBeGreaterThan(left);
            expect(right).toBeLessThan(w);
        });

        test('no customers or mugs before starting', async ({ page }) => {
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => empties.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('step() does nothing while idle', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0, BAR_LEFT));
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

        test('the bartender starts on the top bar with a clean board', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('starting queues a full wave of customers', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => pendingCustomers)).toBe(
                await page.evaluate(() => waveSize(1))
            );
        });
    });

    // -----------------------------------------------------------------------
    // Bartender movement
    // -----------------------------------------------------------------------
    test.describe('bartender', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowDown moves down one bar', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.waitForFunction(() => bartender.lane === 1);
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
        });

        test('ArrowUp moves back up one bar', async ({ page }) => {
            await page.evaluate(() => moveLane(1));
            await page.keyboard.press('ArrowUp');
            await page.waitForFunction(() => bartender.lane === 0);
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('W and S also move the bartender', async ({ page }) => {
            await page.keyboard.press('s');
            await page.waitForFunction(() => bartender.lane === 1);
            await page.keyboard.press('w');
            await page.waitForFunction(() => bartender.lane === 0);
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('the bartender cannot move above the top bar', async ({ page }) => {
            await page.evaluate(() => {
                moveLane(-1);
                moveLane(-1);
            });
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('the bartender cannot move below the bottom bar', async ({ page }) => {
            await page.evaluate(() => {
                for (let i = 0; i < 10; i++) moveLane(1);
            });
            expect(await page.evaluate(() => bartender.lane)).toBe(
                (await page.evaluate(() => LANE_COUNT)) - 1
            );
        });

        test('the drawn position eases toward the new lane', async ({ page }) => {
            await page.evaluate(() => moveLane(1));
            const jumped = await page.evaluate(() => bartender.y === LANE_Y[1]);
            expect(jumped).toBe(false);
            await advance(page, 60);
            expect(await page.evaluate(() => bartender.y)).toBeCloseTo(
                await page.evaluate(() => LANE_Y[1]),
                1
            );
        });

        test('the bartender cannot change lanes while idle', async ({ page }) => {
            await page.reload();
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving mugs
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space serves a mug', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => mugs.length === 1);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('a mug is served into the bartender lane', async ({ page }) => {
            await page.evaluate(() => {
                moveLane(1);
                moveLane(1);
                serve();
            });
            expect(await page.evaluate(() => mugs[0].lane)).toBe(2);
        });

        test('a served mug starts at the bartender end of the bar', async ({ page }) => {
            await page.evaluate(() => serve());
            const x = await page.evaluate(() => mugs[0].x);
            expect(x).toBeLessThanOrEqual(await page.evaluate(() => BAR_RIGHT));
            expect(x).toBeGreaterThan(await page.evaluate(() => BAR_RIGHT - 60));
        });

        test('a mug slides toward the far end of the bar', async ({ page }) => {
            const before = await page.evaluate(() => {
                serve();
                return mugs[0].x;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThan(before);
        });

        test('serving has a cooldown', async ({ page }) => {
            await page.evaluate(() => {
                serve();
                serve();
                serve();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('the cooldown expires so a second mug can be poured', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 60);
            await page.evaluate(() => serve());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('a mug that reaches the far end smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 180);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('mugs cannot be served while paused', async ({ page }) => {
            await page.evaluate(() => {
                togglePause();
                serve();
            });
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

        test('customers walk toward the bartender', async ({ page }) => {
            const before = await page.evaluate(() => spawnCustomer(0, BAR_LEFT).x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeGreaterThan(before);
        });

        test('customers never outrun a mug', async ({ page }) => {
            await page.evaluate(() => {
                level = 40;
            });
            expect(await page.evaluate(() => customerSpeed())).toBeLessThan(
                await page.evaluate(() => MUG_SPEED)
            );
        });

        test('a customer reaching the bartender costs a life', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0, DANGER_X - 4));
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('customers queue up behind each other', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 200);
                spawnCustomer(0, BAR_LEFT + 190);
            });
            await advance(page, 60);
            const gap = await page.evaluate(() => customers[0].x - customers[1].x);
            expect(gap).toBeGreaterThanOrEqual(await page.evaluate(() => CUSTOMER_GAP - 1));
        });

        test('customers in other lanes do not block each other', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 100);
                spawnCustomer(1, BAR_LEFT + 100);
            });
            await advance(page, 60);
            const xs = await page.evaluate(() => customers.map((c) => c.x));
            expect(xs[0]).toBeCloseTo(xs[1], 5);
        });

        test('customers arrive over time once spawning is on', async ({ page }) => {
            const peak = await page.evaluate(() => {
                startGame();
                let most = 0;
                for (let i = 0; i < 600; i++) {
                    step(1 / 60);
                    most = Math.max(most, customers.length);
                }
                return most;
            });
            expect(peak).toBeGreaterThan(0);
        });

        test('spawned customers come from the pending queue', async ({ page }) => {
            const before = await page.evaluate(() => {
                startGame();
                return pendingCustomers;
            });
            await advance(page, 600);
            expect(await page.evaluate(() => pendingCustomers)).toBeLessThan(before);
        });

        test('customers enter at the far end of a bar', async ({ page }) => {
            const lanes = await page.evaluate(() => {
                startGame();
                const seen = [];
                for (let i = 0; i < 900; i++) {
                    step(1 / 60);
                    for (const c of customers) if (!seen.includes(c.lane)) seen.push(c.lane);
                }
                return seen;
            });
            expect(lanes.length).toBeGreaterThan(0);
            expect(lanes.every((l) => l >= 0 && l < 4)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Serving customers
    // -----------------------------------------------------------------------
    test.describe('drinking', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a mug reaching a customer is caught', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, BAR_RIGHT - 120);
                serve();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => customers[0].state)).toBe('drinking');
        });

        test('a drinking customer is pushed back down the bar', async ({ page }) => {
            const before = await page.evaluate(() => {
                const c = spawnCustomer(0, BAR_RIGHT - 120);
                serve();
                return c.x;
            });
            await advance(page, 90);
            expect(await page.evaluate(() => customers[0].x)).toBeLessThan(before);
        });

        test('the rightmost customer gets the mug', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 40);
                spawnCustomer(0, BAR_RIGHT - 140);
                serve();
            });
            await advance(page, 60);
            const states = await page.evaluate(() =>
                customers.slice().sort((a, b) => a.x - b.x).map((c) => c.state)
            );
            expect(states).toEqual(['advancing', 'drinking']);
        });

        test('a mug passes a customer who is already drinking', async ({ page }) => {
            const back = await page.evaluate(() => {
                const behind = spawnCustomer(0, BAR_RIGHT - 200);
                const front = spawnCustomer(0, BAR_RIGHT - 100);
                front.state = 'drinking';
                front.drinkTimer = 99;
                serve();
                for (let i = 0; i < 90; i++) step(1 / 60);
                return behind.state;
            });
            expect(back).toBe('drinking');
        });

        test('a mug only serves customers in its own lane', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(2, BAR_RIGHT - 120);
                serve(); // bartender is in lane 0
            });
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
        });

        test('finishing a drink sends an empty mug back', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, BAR_RIGHT - 260);
                serve();
            });
            await advance(page, 150);
            expect(await page.evaluate(() => empties.length)).toBe(1);
            expect(await page.evaluate(() => empties[0].lane)).toBe(0);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
        });

        test('a customer pushed off the end is served for points', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 4);
                serve();
            });
            await advance(page, 240);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(
                await page.evaluate(() => SERVE_POINTS)
            );
        });

        test('a customer who leaves the bar drops no empty mug', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 4);
                serve();
            });
            await advance(page, 240);
            expect(await page.evaluate(() => empties.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty mug slides back toward the bartender', async ({ page }) => {
            const before = await page.evaluate(() => spawnEmpty(0, BAR_LEFT + 100).x);
            await advance(page, 30);
            expect(await page.evaluate(() => empties[0].x)).toBeGreaterThan(before);
        });

        test('the bartender catches an empty in their lane', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(0, CATCH_X - 20));
            await advance(page, 60);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => CATCH_POINTS));
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('a missed empty smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(3, CATCH_X - 20));
            await advance(page, 60);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('moving into the lane in time saves the mug', async ({ page }) => {
            await page.evaluate(() => {
                spawnEmpty(1, BAR_LEFT + 60);
                moveLane(1);
            });
            await advance(page, 180);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => CATCH_POINTS));
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('losing a life clears the bars', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(1, BAR_LEFT + 40);
                spawnEmpty(0, BAR_LEFT + 40);
                spawnCustomer(0, DANGER_X - 2);
            });
            await advance(page, 30);
            expect(await page.evaluate(() => state)).toBe('dying');
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('customers on screen go back into the queue', async ({ page }) => {
            await page.evaluate(() => {
                pendingCustomers = 2;
                spawnCustomer(1, BAR_LEFT + 40);
                spawnCustomer(0, DANGER_X - 2);
            });
            await advance(page, 30);
            expect(await page.evaluate(() => pendingCustomers)).toBe(4);
        });

        test('play resumes after the pause', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0, DANGER_X - 2));
            await advance(page, 200);
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                spawnCustomer(0, DANGER_X - 2);
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(0);
            await advance(page, 200);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('the game over overlay shows the score', async ({ page }) => {
            await page.evaluate(() => {
                score = 321;
                lives = 1;
                spawnCustomer(0, DANGER_X - 2);
            });
            await advance(page, 230);
            await expect(page.locator('#overlay-score')).toContainText('321');
        });
    });

    // -----------------------------------------------------------------------
    // Level flow
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('clearing every customer clears the level', async ({ page }) => {
            await page.evaluate(() => clearWaveForTest());
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('a wave in progress does not clear the level', async ({ page }) => {
            await page.evaluate(() => {
                clearWaveForTest();
                spawnCustomer(0, BAR_LEFT);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('mugs still in flight hold the level open', async ({ page }) => {
            await page.evaluate(() => {
                clearWaveForTest();
                serve();
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('clearing a level scores a bonus', async ({ page }) => {
            await page.evaluate(() => clearWaveForTest());
            await advance(page, 2);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => CLEAR_BONUS));
        });

        test('the next level starts with a fresh wave', async ({ page }) => {
            await page.evaluate(() => clearWaveForTest());
            await advance(page, 220);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => pendingCustomers)).toBe(
                await page.evaluate(() => waveSize(2))
            );
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('score and lives carry into the next level', async ({ page }) => {
            await page.evaluate(() => {
                score = 1000;
                lives = 2;
                clearWaveForTest();
            });
            await advance(page, 220);
            expect(await page.evaluate(() => score)).toBe(1000 + (await page.evaluate(() => CLEAR_BONUS)));
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('waves get bigger each level', async ({ page }) => {
            const sizes = await page.evaluate(() => [waveSize(1), waveSize(2), waveSize(5)]);
            expect(sizes[1]).toBeGreaterThan(sizes[0]);
            expect(sizes[2]).toBeGreaterThan(sizes[1]);
        });

        test('customers get faster each level', async ({ page }) => {
            const l1 = await page.evaluate(() => customerSpeed());
            await page.evaluate(() => {
                level = 4;
            });
            expect(await page.evaluate(() => customerSpeed())).toBeGreaterThan(l1);
        });

        test('customers arrive more often at higher levels', async ({ page }) => {
            const l1 = await page.evaluate(() => spawnInterval());
            await page.evaluate(() => {
                level = 5;
            });
            expect(await page.evaluate(() => spawnInterval())).toBeLessThan(l1);
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
            const before = await page.evaluate(() => {
                const c = spawnCustomer(0, BAR_LEFT + 100);
                togglePause();
                return c.x;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring persistence
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('a new best is stored on game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 7777;
                lives = 1;
                spawnCustomer(0, DANGER_X - 2);
            });
            await advance(page, 230);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#best')).toHaveText('7777');
            expect(await page.evaluate(() => window.localStorage.getItem('tapper-best'))).toBe(
                '7777'
            );
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-best', '9999'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 10;
                lives = 1;
                spawnCustomer(0, DANGER_X - 2);
            });
            await advance(page, 230);
            await expect(page.locator('#best')).toHaveText('9999');
        });

        test('restarting after game over resets the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 500;
                level = 3;
                lives = 1;
                spawnCustomer(0, DANGER_X - 2);
            });
            await advance(page, 230);
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 100);
                serve();
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
                spawnCustomer(0, BAR_LEFT + 60);
                spawnCustomer(2, BAR_LEFT + 200);
                spawnEmpty(1, BAR_LEFT + 120);
                serve();
                for (let i = 0; i < 120; i++) step(1 / 60);
                draw(); // running
                togglePause();
                draw(); // paused
                togglePause();
                lives = 1;
                spawnCustomer(0, DANGER_X - 2);
                step(1 / 60);
                draw(); // dying
                for (let i = 0; i < 200; i++) step(1 / 60);
                draw(); // over
                startGame();
                spawnEnabled = false;
                clearWaveForTest();
                step(1 / 60);
                draw(); // level clear
                for (let i = 0; i < 200; i++) step(1 / 60);
                draw();
            });
            expect(errors).toEqual([]);
        });

        test('no console errors during a normal run', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 900; i++) {
                    step(1 / 60);
                    if (i % 40 === 0) serve();
                    if (i % 97 === 0) moveLane(1);
                    if (i % 61 === 0) moveLane(-1);
                }
                draw();
            });
            expect(errors).toEqual([]);
        });
    });
});
