const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Most tests drive the simulation by hand: start the game, switch off the
// requestAnimationFrame stepping so wall-clock time can't advance the world
// behind the test's back, then call step(dt) explicitly.
async function startManual(page, seed = 1) {
    await page.evaluate((s) => {
        setSeed(s);
        startGame();
        setAutoStep(false);
        customers.length = 0;
        mugs.length = 0;
        spawnTimer = 999; // no scheduled spawns unless a test asks for them
    }, seed);
}

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

        test('score, wave, lives and best show their starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#wave')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 640x420', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '420');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the bar is empty before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({ c: customers.length, m: mugs.length }));
            expect(counts).toEqual({ c: 0, m: 0 });
        });

        test('there are four lanes with distinct y positions', async ({ page }) => {
            const lanes = await page.evaluate(() => ({ n: LANES, ys: LANE_Y.slice() }));
            expect(lanes.n).toBe(4);
            expect(lanes.ys).toHaveLength(4);
            expect(new Set(lanes.ys).size).toBe(4);
            expect(lanes.ys.every((y) => y > 0 && y < 420)).toBe(true);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('soda-tapper-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });

        test('step does nothing while idle', async ({ page }) => {
            const after = await page.evaluate(() => {
                step(2);
                return { state, customers: customers.length, score };
            });
            expect(after).toEqual({ state: 'idle', customers: 0, score: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a new game starts on wave 1 with full lives and no score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { wave, lives, score, spawned: spawnedThisWave };
            });
            expect(s).toEqual({ wave: 1, lives: 3, score: 0, spawned: 0 });
        });

        test('the player starts in a valid lane', async ({ page }) => {
            const lane = await page.evaluate(() => { startGame(); return player.lane; });
            expect(lane).toBeGreaterThanOrEqual(0);
            expect(lane).toBeLessThan(4);
        });
    });

    // -----------------------------------------------------------------------
    // Player movement
    // -----------------------------------------------------------------------
    test.describe('lane movement', () => {
        test('ArrowUp moves the player up a lane', async ({ page }) => {
            await startManual(page);
            await page.evaluate(() => setLane(2));
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('ArrowDown moves the player down a lane', async ({ page }) => {
            await startManual(page);
            await page.evaluate(() => setLane(1));
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(2);
        });

        test('W and S also move between lanes', async ({ page }) => {
            await startManual(page);
            await page.evaluate(() => setLane(1));
            await page.keyboard.press('KeyS');
            expect(await page.evaluate(() => player.lane)).toBe(2);
            await page.keyboard.press('KeyW');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('the player cannot move above the top lane', async ({ page }) => {
            await startManual(page);
            const lane = await page.evaluate(() => { setLane(0); moveLane(-1); return player.lane; });
            expect(lane).toBe(0);
        });

        test('the player cannot move below the bottom lane', async ({ page }) => {
            await startManual(page);
            const lane = await page.evaluate(() => { setLane(LANES - 1); moveLane(1); return player.lane; });
            expect(lane).toBe(3);
        });

        test('mouse movement selects the lane under the pointer', async ({ page }) => {
            await startManual(page);
            await page.evaluate(() => setLane(0));
            const box = await page.locator('#canvas').boundingBox();
            const targetY = await page.evaluate(() => LANE_Y[2]);
            await page.mouse.move(box.x + box.width / 2, box.y + targetY * (box.height / 420));
            expect(await page.evaluate(() => player.lane)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Serving mugs
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('Space serves a full mug into the player lane', async ({ page }) => {
            await startManual(page);
            await page.evaluate(() => setLane(2));
            await page.keyboard.press('Space');
            const mug = await page.evaluate(() => mugs[0]);
            expect(mug.lane).toBe(2);
            expect(mug.empty).toBe(false);
            expect(mug.x).toBeCloseTo(await page.evaluate(() => MUG_START_X), 5);
        });

        test('serve() reports success and failure', async ({ page }) => {
            await startManual(page);
            const results = await page.evaluate(() => {
                const first = serve();
                const second = serve(); // still on cooldown
                return { first, second, mugs: mugs.length };
            });
            expect(results).toEqual({ first: true, second: false, mugs: 1 });
        });

        test('the cooldown expires so another mug can be served', async ({ page }) => {
            await startManual(page);
            const count = await page.evaluate(() => {
                serve();
                step(SERVE_COOLDOWN + 0.01);
                serve();
                return mugs.length;
            });
            expect(count).toBe(2);
        });

        test('serving does nothing when the game is not running', async ({ page }) => {
            const served = await page.evaluate(() => serve());
            expect(served).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('clicking the canvas serves a mug', async ({ page }) => {
            await startManual(page);
            const box = await page.locator('#canvas').boundingBox();
            const targetY = await page.evaluate(() => LANE_Y[1]);
            await page.mouse.click(box.x + box.width / 2, box.y + targetY * (box.height / 420));
            const mug = await page.evaluate(() => mugs[0]);
            expect(mug.lane).toBe(1);
            expect(mug.empty).toBe(false);
        });

        test('a full mug slides left at the wave mug speed', async ({ page }) => {
            await startManual(page);
            const moved = await page.evaluate(() => {
                serve();
                const before = mugs[0].x;
                step(0.5);
                return { before, after: mugs[0].x, expected: before - mugSpeed() * 0.5 };
            });
            expect(moved.after).toBeLessThan(moved.before);
            expect(moved.after).toBeCloseTo(moved.expected, 1);
        });

        test('an empty mug slides right', async ({ page }) => {
            await startManual(page);
            const moved = await page.evaluate(() => {
                const m = spawnMug({ lane: 0, x: 200, empty: true });
                step(0.5);
                return { after: m.x, expected: 200 + EMPTY_SPEED * 0.5 };
            });
            expect(moved.after).toBeCloseTo(moved.expected, 1);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test('customers advance toward the tap station', async ({ page }) => {
            await startManual(page);
            const moved = await page.evaluate(() => {
                const c = spawnCustomer({ lane: 1, x: 100 });
                step(1);
                return { after: c.x, expected: 100 + customerSpeed() };
            });
            expect(moved.after).toBeCloseTo(moved.expected, 1);
        });

        test('a customer reaching the station costs a life', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                spawnCustomer({ lane: 0, x: GRAB_X - 1 });
                step(0.5);
                return { lives, customers: customers.length };
            });
            expect(after.lives).toBe(2);
            expect(after.customers).toBe(0);
        });

        test('a mug knocks a customer back and is consumed', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                const c = spawnCustomer({ lane: 1, x: 300, drinks: 2 });
                spawnMug({ lane: 1, x: 320, empty: false });
                step(0.05);
                return { x: c.x, drinks: c.drinks, full: mugs.filter((m) => !m.empty).length };
            });
            expect(after.drinks).toBe(1);
            expect(after.x).toBeLessThan(300);
            expect(after.full).toBe(0);
        });

        test('a drink sends an empty mug back down the same lane', async ({ page }) => {
            await startManual(page);
            const empties = await page.evaluate(() => {
                spawnCustomer({ lane: 2, x: 300, drinks: 2 });
                spawnMug({ lane: 2, x: 320, empty: false });
                step(0.05);
                return mugs.filter((m) => m.empty).map((m) => m.lane);
            });
            expect(empties).toEqual([2]);
        });

        test('a mug in another lane passes the customer by', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                const c = spawnCustomer({ lane: 1, x: 300, drinks: 2 });
                spawnMug({ lane: 3, x: 320, empty: false });
                step(0.05);
                return { drinks: c.drinks, x: c.x };
            });
            expect(after.drinks).toBe(2);
            expect(after.x).toBeGreaterThanOrEqual(300);
        });

        test('a mug hits the nearest customer when several share a lane', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                const far = spawnCustomer({ lane: 0, x: 200, drinks: 2 });
                const near = spawnCustomer({ lane: 0, x: 300, drinks: 2 });
                spawnMug({ lane: 0, x: 310, empty: false });
                step(0.05);
                return { far: far.drinks, near: near.drinks };
            });
            expect(after).toEqual({ far: 2, near: 1 });
        });

        test('a customer with no drinks left leaves the bar', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                spawnCustomer({ lane: 1, x: 300, drinks: 1 });
                spawnMug({ lane: 1, x: 320, empty: false });
                step(0.05);
                return { customers: customers.length, score };
            });
            expect(after.customers).toBe(0);
            expect(after.score).toBe(60); // SERVE_POINTS + LEAVE_POINTS at wave 1
        });

        test('a customer knocked off the end of the bar leaves', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                spawnCustomer({ lane: 1, x: BAR_LEFT + 4, drinks: 3 });
                spawnMug({ lane: 1, x: BAR_LEFT + 20, empty: false });
                step(0.05);
                return { customers: customers.length, lives };
            });
            expect(after.customers).toBe(0);
            expect(after.lives).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Losing a life
    // -----------------------------------------------------------------------
    test.describe('losing a life', () => {
        test('a full mug that runs off the end of the bar costs a life', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                spawnMug({ lane: 0, x: BAR_LEFT + 2, empty: false });
                step(0.5);
                return { lives, mugs: mugs.length };
            });
            expect(after.lives).toBe(2);
            expect(after.mugs).toBe(0);
        });

        test('an empty mug caught in the player lane scores points', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                setLane(2);
                spawnMug({ lane: 2, x: CATCH_X - 4, empty: true });
                step(0.2);
                return { lives, score, mugs: mugs.length };
            });
            expect(after.lives).toBe(3);
            expect(after.score).toBe(5); // EMPTY_POINTS at wave 1
            expect(after.mugs).toBe(0);
        });

        test('an empty mug arriving in another lane shatters and costs a life', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                setLane(0);
                spawnMug({ lane: 2, x: CATCH_X - 4, empty: true });
                step(0.2);
                return { lives, score, mugs: mugs.length };
            });
            expect(after.lives).toBe(2);
            expect(after.score).toBe(0);
            expect(after.mugs).toBe(0);
        });

        test('losing a life clears the bar and restarts the wave spawns', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                spawnCustomer({ lane: 0, x: 120 });
                spawnCustomer({ lane: 3, x: 200 });
                spawnMug({ lane: 1, x: 300, empty: false });
                spawnedThisWave = 3;
                loseLife();
                return { customers: customers.length, mugs: mugs.length, spawned: spawnedThisWave, wave };
            });
            expect(after).toEqual({ customers: 0, mugs: 0, spawned: 0, wave: 1 });
        });

        test('the HUD shows the remaining lives', async ({ page }) => {
            await startManual(page);
            await page.evaluate(() => { loseLife(); step(0); });
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('customers spawn on the wave timer into valid lanes', async ({ page }) => {
            await startManual(page, 7);
            const spawned = await page.evaluate(() => {
                spawnTimer = 0.01;
                step(spawnInterval() * 2.5);
                return customers.map((c) => c.lane);
            });
            expect(spawned.length).toBeGreaterThan(0);
            expect(spawned.every((l) => l >= 0 && l < 4)).toBe(true);
        });

        test('a wave never spawns more customers than it should', async ({ page }) => {
            await startManual(page, 3);
            const spawned = await page.evaluate(() => {
                spawnTimer = 0.01;
                for (let i = 0; i < 60; i++) {
                    step(spawnInterval());
                    customers.length = 0; // clear the bar so nobody reaches the station
                    mugs.length = 0;
                    if (spawnedThisWave >= customersInWave()) break;
                }
                return { spawned: spawnedThisWave, expected: customersInWave() };
            });
            expect(spawned.spawned).toBeLessThanOrEqual(spawned.expected);
        });

        test('clearing every customer completes the wave', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                spawnedThisWave = customersInWave();
                customers.length = 0;
                step(0.05);
                return { wave, lives, score, spawned: spawnedThisWave };
            });
            expect(after.wave).toBe(2);
            expect(after.score).toBe(100); // WAVE_BONUS at wave 1
            expect(after.lives).toBe(4);   // bonus life, capped at MAX_LIVES
            expect(after.spawned).toBe(0);
        });

        test('the wave bonus life is capped', async ({ page }) => {
            await startManual(page);
            const livesAfter = await page.evaluate(() => {
                lives = MAX_LIVES;
                spawnedThisWave = customersInWave();
                customers.length = 0;
                step(0.05);
                return lives;
            });
            expect(livesAfter).toBe(await page.evaluate(() => MAX_LIVES));
        });

        test('completing a wave clears mugs still in flight', async ({ page }) => {
            await startManual(page);
            const mugsLeft = await page.evaluate(() => {
                spawnMug({ lane: 0, x: 300, empty: true });
                spawnedThisWave = customersInWave();
                customers.length = 0;
                step(0.05);
                return mugs.length;
            });
            expect(mugsLeft).toBe(0);
        });

        test('later waves are harder and pay more', async ({ page }) => {
            await startManual(page);
            const curve = await page.evaluate(() => {
                const at = (w) => {
                    wave = w;
                    return {
                        cust: customerSpeed(),
                        mug: mugSpeed(),
                        interval: spawnInterval(),
                        drinks: drinksPerCustomer(),
                        count: customersInWave(),
                    };
                };
                return { w1: at(1), w5: at(5) };
            });
            expect(curve.w5.cust).toBeGreaterThan(curve.w1.cust);
            expect(curve.w5.mug).toBeGreaterThanOrEqual(curve.w1.mug);
            expect(curve.w5.interval).toBeLessThan(curve.w1.interval);
            expect(curve.w5.drinks).toBeGreaterThan(curve.w1.drinks);
            expect(curve.w5.count).toBeGreaterThan(curve.w1.count);
        });

        test('the spawn interval never drops below its floor', async ({ page }) => {
            const interval = await page.evaluate(() => { wave = 99; return spawnInterval(); });
            expect(interval).toBeGreaterThanOrEqual(await page.evaluate(() => SPAWN_MIN));
        });

        test('points scale with the wave number', async ({ page }) => {
            await startManual(page);
            const score = await page.evaluate(() => {
                wave = 3;
                spawnCustomer({ lane: 0, x: 300, drinks: 1 });
                spawnMug({ lane: 0, x: 320, empty: false });
                step(0.05);
                return score;
            });
            expect(score).toBe(180); // (10 + 50) * 3
        });
    });

    // -----------------------------------------------------------------------
    // Pause / game over / restart
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes the game', async ({ page }) => {
            await startManual(page);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the world does not advance while paused', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                const c = spawnCustomer({ lane: 0, x: 120 });
                togglePause();
                step(2);
                return c.x;
            });
            expect(after).toBe(120);
        });

        test('serving is ignored while paused', async ({ page }) => {
            await startManual(page);
            const count = await page.evaluate(() => { togglePause(); serve(); return mugs.length; });
            expect(count).toBe(0);
        });

        test('P does nothing before the game starts', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    test.describe('game over', () => {
        test('running out of lives ends the game', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                loseLife(); loseLife(); loseLife();
                return { state, lives };
            });
            expect(after).toEqual({ state: 'over', lives: 0 });
        });

        test('the overlay reports the final score', async ({ page }) => {
            await startManual(page);
            await page.evaluate(() => {
                score = 420;
                loseLife(); loseLife(); loseLife();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
            await expect(page.locator('#overlay-score')).toContainText('420');
        });

        test('the world stops advancing after game over', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                loseLife(); loseLife(); loseLife();
                const c = spawnCustomer({ lane: 0, x: 100 });
                step(2);
                return c.x;
            });
            expect(after).toBe(100);
        });

        test('the best score is persisted', async ({ page }) => {
            await startManual(page);
            await page.evaluate(() => {
                score = 777;
                loseLife(); loseLife(); loseLife();
            });
            await expect(page.locator('#best')).toHaveText('777');
            expect(await page.evaluate(() => window.localStorage.getItem('soda-tapper-best'))).toBe('777');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('soda-tapper-best', '900'));
            await page.reload();
            await startManual(page);
            await page.evaluate(() => {
                score = 100;
                loseLife(); loseLife(); loseLife();
            });
            await expect(page.locator('#best')).toHaveText('900');
        });

        test('Space restarts after game over', async ({ page }) => {
            await startManual(page);
            await page.evaluate(() => { score = 50; loseLife(); loseLife(); loseLife(); });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, score, lives, wave }));
            expect(s).toEqual({ state: 'running', score: 0, lives: 3, wave: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Determinism & the real-time loop
    // -----------------------------------------------------------------------
    test.describe('determinism', () => {
        test('the same seed produces the same wave', async ({ page }) => {
            const run = () => page.evaluate(() => {
                setSeed(2024);
                startGame();
                setAutoStep(false);
                customers.length = 0;
                spawnTimer = 0.01;
                for (let i = 0; i < 5; i++) {
                    step(spawnInterval());
                    mugs.length = 0;
                }
                return customers.map((c) => c.lane).join(',');
            });
            const first = await run();
            const second = await run();
            expect(second).toBe(first);
            expect(first.length).toBeGreaterThan(0);
        });

        test('different seeds can produce different waves', async ({ page }) => {
            const run = (seed) => page.evaluate((s) => {
                setSeed(s);
                startGame();
                setAutoStep(false);
                customers.length = 0;
                spawnTimer = 0.01;
                for (let i = 0; i < 5; i++) {
                    step(spawnInterval());
                    mugs.length = 0;
                }
                return customers.map((c) => c.lane).join(',');
            }, seed);
            const a = await run(1);
            const b = await run(99);
            expect(a).not.toBe(b);
        });

        test('sub-stepping stops a fast mug tunnelling through a customer', async ({ page }) => {
            await startManual(page);
            const after = await page.evaluate(() => {
                wave = 20; // fastest mugs
                const c = spawnCustomer({ lane: 0, x: 300, drinks: 5 });
                spawnMug({ lane: 0, x: 560, empty: false });
                step(1.5);
                return { drinks: c.drinks, full: mugs.filter((m) => !m.empty).length };
            });
            expect(after.drinks).toBe(4);
            expect(after.full).toBe(0);
        });

        test('the requestAnimationFrame loop advances the game in real time', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                customers.length = 0;
                mugs.length = 0;
                spawnTimer = 999;
                spawnCustomer({ lane: 0, x: 100 });
            });
            await page.waitForTimeout(400);
            const x = await page.evaluate(() => customers[0].x);
            expect(x).toBeGreaterThan(100);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas draws something', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnCustomer({ lane: 1, x: 200 });
                serve();
                draw();
            });
            const nonBlank = await page.evaluate(() => {
                const data = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                    if (seen.size > 3) return true;
                }
                return false;
            });
            expect(nonBlank).toBe(true);
        });

        test('the help text documents the controls', async ({ page }) => {
            const help = page.locator('.help');
            await expect(help).toContainText(/serve/i);
            await expect(help).toContainText(/pause/i);
        });
    });
});
