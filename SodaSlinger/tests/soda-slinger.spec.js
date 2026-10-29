const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a level and freeze the animation loop, so a test can place customers
// and mugs itself and advance the simulation one fixed timestep at a time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
    });
}

// Empty every counter: no customers, no filled mugs, no empties.
async function clearWorld(page) {
    await page.evaluate(() => {
        customers.length = 0;
        mugs.length = 0;
        empties.length = 0;
        spawnTimer = 999;
    });
}

// Put a customer on a counter at a known position.
async function addCustomer(page, c) {
    await page.evaluate((spec) => {
        customers.push({
            lane: spec.lane,
            x: spec.x,
            state: spec.state || 'advancing',
            drink: spec.drink || 0,
        });
    }, c);
}

// Put a filled mug on a counter at a known position, sliding right.
async function addMug(page, m) {
    await page.evaluate((spec) => {
        mugs.push({ lane: spec.lane, x: spec.x });
    }, m);
}

// Put an empty mug on a counter at a known position, sliding left.
async function addEmpty(page, m) {
    await page.evaluate((spec) => {
        empties.push({ lane: spec.lane, x: spec.x });
    }, m);
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(1 / 120);
    }, steps);
}

// Advance the frozen simulation by a number of simulated seconds.
async function stepSeconds(page, seconds) {
    await step(page, Math.round(seconds * 120));
}

test.describe('Soda Slinger', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Soda Slinger', async ({ page }) => {
            await expect(page).toHaveTitle('Soda Slinger');
        });

        test('canvas is 720x540', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '540');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the bar is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => empties.length)).toBe(0);
        });

        test('there are four counters', async ({ page }) => {
            expect(await page.evaluate(() => LANES)).toBe(4);
        });

        test('counter centre lines are evenly spaced down the canvas', async ({ page }) => {
            const ys = await page.evaluate(() => [laneY(0), laneY(1), laneY(2), laneY(3)]);
            expect(ys).toEqual([116, 228, 340, 452]);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodaslinger-best', '4820'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4820');
        });

        test('the help legend explains pouring and moving between counters', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/pour/i);
            await expect(page.locator('.help')).toContainText(/counter/i);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('starting resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                score = 500;
                lives = 1;
                level = 4;
            });
            await startFrozen(page);
            expect(await page.evaluate(() => ({ score, lives, level }))).toEqual({
                score: 0,
                lives: 3,
                level: 1,
            });
        });

        test('the slinger starts at the top counter with nothing served', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => player.lane)).toBe(0);
            expect(await page.evaluate(() => served)).toBe(0);
        });

        test('level 1 asks for eight customers', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => quota)).toBe(8);
        });

        test('the bar starts empty and fills up as the level runs', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            await stepSeconds(page, 4);
            expect(await page.evaluate(() => customers.length)).toBeGreaterThan(0);
        });

        test('spawned customers walk in at the far end of a counter', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => spawnCustomer(2));
            const c = await page.evaluate(() => customers[customers.length - 1]);
            expect(c.lane).toBe(2);
            expect(c.x).toBe(await page.evaluate(() => BAR_RIGHT));
            expect(c.state).toBe('advancing');
        });
    });

    // -----------------------------------------------------------------------
    // Moving between counters
    // -----------------------------------------------------------------------
    test.describe('moving between counters', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearWorld(page);
        });

        test('ArrowDown moves down one counter', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('ArrowUp moves back up one counter', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('S and W work as aliases', async ({ page }) => {
            await page.keyboard.press('KeyS');
            expect(await page.evaluate(() => player.lane)).toBe(1);
            await page.keyboard.press('KeyW');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('the slinger cannot climb above the top counter', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('the slinger cannot drop below the bottom counter', async ({ page }) => {
            for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(3);
        });

        test('counters do not change while the game is idle', async ({ page }) => {
            await page.reload();
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearWorld(page);
        });

        test('pour puts a filled mug at the taps on the current counter', async ({ page }) => {
            await page.evaluate(() => {
                player.lane = 2;
                pour();
            });
            const mug = await page.evaluate(() => mugs[0]);
            expect(mug.lane).toBe(2);
            expect(mug.x).toBe(await page.evaluate(() => TAP_X));
        });

        test('Space pours while the game is running', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('clicking the canvas pours', async ({ page }) => {
            await page.locator('#canvas').click();
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('the pour cooldown blocks an immediate second mug', async ({ page }) => {
            await page.evaluate(() => {
                pour();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('pouring works again once the cooldown has elapsed', async ({ page }) => {
            await page.evaluate(() => pour());
            await stepSeconds(page, 0.25);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('the cooldown is shared across counters', async ({ page }) => {
            await page.evaluate(() => {
                pour();
                player.lane = 3;
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('a filled mug slides toward the far end', async ({ page }) => {
            await page.evaluate(() => pour());
            const before = await page.evaluate(() => mugs[0].x);
            await stepSeconds(page, 0.5);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeGreaterThan(before);
            expect(after - before).toBeCloseTo(150, 0);
        });

        test('pouring does nothing when the game is not running', async ({ page }) => {
            await page.evaluate(() => {
                state = 'paused';
                pourTimer = 0;
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving customers
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearWorld(page);
        });

        test('a mug that reaches a customer serves them and is consumed', async ({ page }) => {
            await addCustomer(page, { lane: 0, x: 300 });
            await addMug(page, { lane: 0, x: 250 });
            await stepSeconds(page, 0.3);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => customers[0].state)).toBe('drinking');
        });

        test('serving scores 50 points and counts toward the quota', async ({ page }) => {
            await addCustomer(page, { lane: 1, x: 300 });
            await addMug(page, { lane: 1, x: 250 });
            await stepSeconds(page, 0.3);
            expect(await page.evaluate(() => score)).toBe(50);
            expect(await page.evaluate(() => served)).toBe(1);
        });

        test('a drinking customer is pushed back toward the far end', async ({ page }) => {
            await addCustomer(page, { lane: 0, x: 300, state: 'drinking', drink: 1.2 });
            await stepSeconds(page, 0.5);
            expect(await page.evaluate(() => customers[0].x)).toBeGreaterThan(300);
        });

        test('a customer who finishes drinking leaves and sends back an empty', async ({ page }) => {
            await addCustomer(page, { lane: 2, x: 300, state: 'drinking', drink: 1.2 });
            await stepSeconds(page, 1.3);
            expect(await page.evaluate(() => customers[0].state)).toBe('leaving');
            expect(await page.evaluate(() => empties.length)).toBe(1);
            expect(await page.evaluate(() => empties[0].lane)).toBe(2);
        });

        test('the empty comes back down the counter toward the taps', async ({ page }) => {
            await addEmpty(page, { lane: 0, x: 500 });
            await stepSeconds(page, 0.5);
            expect(await page.evaluate(() => empties[0].x)).toBeLessThan(500);
        });

        test('a leaving customer walks off the far end and is forgotten', async ({ page }) => {
            await addCustomer(page, { lane: 0, x: 600, state: 'leaving' });
            await stepSeconds(page, 3);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });

        test('a mug serves the customer nearest the taps first', async ({ page }) => {
            await addCustomer(page, { lane: 0, x: 250 });
            await addCustomer(page, { lane: 0, x: 500 });
            await addMug(page, { lane: 0, x: 120 });
            await stepSeconds(page, 0.6);
            const states = await page.evaluate(() => customers.map((c) => c.state));
            expect(states).toEqual(['drinking', 'advancing']);
        });

        test('a mug slides past customers who are already drinking', async ({ page }) => {
            await addCustomer(page, { lane: 0, x: 300, state: 'drinking', drink: 1.2 });
            await addMug(page, { lane: 0, x: 250 });
            await stepSeconds(page, 0.3);
            expect(await page.evaluate(() => served)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('a mug only serves customers on its own counter', async ({ page }) => {
            await addCustomer(page, { lane: 3, x: 300 });
            await addMug(page, { lane: 0, x: 250 });
            await stepSeconds(page, 0.3);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
            expect(await page.evaluate(() => served)).toBe(0);
        });

        test('serving never costs a life', async ({ page }) => {
            await addCustomer(page, { lane: 0, x: 300 });
            await addMug(page, { lane: 0, x: 250 });
            await stepSeconds(page, 0.3);
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Empties
    // -----------------------------------------------------------------------
    test.describe('empties', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearWorld(page);
        });

        test('an empty caught at the taps scores 10 points', async ({ page }) => {
            await page.evaluate(() => {
                player.lane = 1;
            });
            await addEmpty(page, { lane: 1, x: 140 });
            await stepSeconds(page, 0.5);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(10);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an empty that comes back to an unattended counter smashes', async ({ page }) => {
            await page.evaluate(() => {
                player.lane = 0;
            });
            await addEmpty(page, { lane: 3, x: 140 });
            await stepSeconds(page, 0.5);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => score)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Losing lives
    // -----------------------------------------------------------------------
    test.describe('losing lives', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearWorld(page);
        });

        test('a customer who reaches the taps costs a life', async ({ page }) => {
            await addCustomer(page, { lane: 2, x: 130 });
            await stepSeconds(page, 3);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a filled mug that runs off the far end costs a life', async ({ page }) => {
            await addMug(page, { lane: 0, x: 650 });
            await stepSeconds(page, 0.5);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('losing a life clears the counter it happened on', async ({ page }) => {
            await addCustomer(page, { lane: 1, x: 130 });
            await addCustomer(page, { lane: 1, x: 400 });
            await addMug(page, { lane: 1, x: 200 });
            await addEmpty(page, { lane: 1, x: 500 });
            await stepSeconds(page, 3);
            const counts = await page.evaluate(() => ({
                customers: customers.filter((c) => c.lane === 1).length,
                mugs: mugs.filter((m) => m.lane === 1).length,
                empties: empties.filter((m) => m.lane === 1).length,
            }));
            expect(counts).toEqual({ customers: 0, mugs: 0, empties: 0 });
        });

        test('losing a life leaves the other counters alone', async ({ page }) => {
            await addCustomer(page, { lane: 0, x: 130 });
            await addCustomer(page, { lane: 3, x: 500 });
            await stepSeconds(page, 3);
            const survivors = await page.evaluate(() => customers.map((c) => c.lane));
            expect(survivors).toEqual([3]);
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife(0);
            });
            expect(await page.evaluate(() => lives)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('gameover');
        });

        test('the game over overlay shows the final score', async ({ page }) => {
            await page.evaluate(() => {
                score = 730;
                lives = 1;
                loseLife(0);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
            await expect(page.locator('#overlay-score')).toContainText('730');
        });

        test('game over records a new best score', async ({ page }) => {
            await page.evaluate(() => {
                score = 1250;
                lives = 1;
                loseLife(0);
            });
            await expect(page.locator('#best')).toHaveText('1250');
            expect(await page.evaluate(() => window.localStorage.getItem('sodaslinger-best'))).toBe('1250');
        });

        test('a worse run does not overwrite the best score', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodaslinger-best', '9000'));
            await page.reload();
            await startFrozen(page);
            await page.evaluate(() => {
                score = 120;
                lives = 1;
                loseLife(0);
            });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('the HUD shows the remaining lives', async ({ page }) => {
            await page.evaluate(() => loseLife(0));
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('Space starts a fresh game after game over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife(0);
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ state, lives, score }))).toEqual({
                state: 'running',
                lives: 3,
                score: 0,
            });
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearWorld(page);
        });

        test('serving the quota with an empty bar clears the level', async ({ page }) => {
            await page.evaluate(() => {
                served = quota;
                spawned = quota;
            });
            await step(page, 2);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('clearing a level pays a bonus of 100 per level', async ({ page }) => {
            await page.evaluate(() => {
                served = quota;
                spawned = quota;
                score = 400;
            });
            await step(page, 2);
            expect(await page.evaluate(() => score)).toBe(500);
        });

        test('the level stays running while anyone is still at the bar', async ({ page }) => {
            await page.evaluate(() => {
                served = quota;
                spawned = quota;
            });
            await addCustomer(page, { lane: 0, x: 500 });
            await step(page, 2);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the level stays running while a mug is still sliding', async ({ page }) => {
            await page.evaluate(() => {
                served = quota;
                spawned = quota;
            });
            await addMug(page, { lane: 0, x: 300 });
            await step(page, 2);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the level stays running while more customers are still due in', async ({ page }) => {
            await page.evaluate(() => {
                served = quota;
                spawned = quota - 1;
            });
            await step(page, 2);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the level clear overlay names the next level', async ({ page }) => {
            await page.evaluate(() => {
                served = quota;
                spawned = quota;
            });
            await step(page, 2);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/level/i);
        });

        test('Space moves on to the next level', async ({ page }) => {
            await page.evaluate(() => {
                served = quota;
                spawned = quota;
            });
            await step(page, 2);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ state, level, served }))).toEqual({
                state: 'running',
                level: 2,
                served: 0,
            });
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the next level starts with a clean bar and keeps the score', async ({ page }) => {
            await page.evaluate(() => {
                score = 600;
                served = quota;
                spawned = quota;
            });
            await step(page, 2);
            await addCustomer(page, { lane: 0, x: 400 });
            await page.evaluate(() => nextLevel());
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(700);
        });

        test('later levels ask for more customers', async ({ page }) => {
            const quotas = await page.evaluate(() => [1, 2, 3, 4, 5].map((n) => quotaFor(n)));
            for (let i = 1; i < quotas.length; i++) {
                expect(quotas[i]).toBeGreaterThan(quotas[i - 1]);
            }
        });

        test('later levels walk customers in faster', async ({ page }) => {
            const speeds = await page.evaluate(() => [1, 2, 3, 4, 5].map((n) => speedFor(n)));
            for (let i = 1; i < speeds.length; i++) {
                expect(speeds[i]).toBeGreaterThan(speeds[i - 1]);
            }
        });

        test('clearing the last level wins the game', async ({ page }) => {
            await page.evaluate(() => {
                level = LEVEL_COUNT;
                quota = quotaFor(LEVEL_COUNT);
                served = quota;
                spawned = quota;
            });
            await step(page, 2);
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/win|victory|closing time/i);
        });

        test('winning records the best score', async ({ page }) => {
            await page.evaluate(() => {
                level = LEVEL_COUNT;
                quota = quotaFor(LEVEL_COUNT);
                served = quota;
                spawned = quota;
                score = 4000;
            });
            await step(page, 2);
            await expect(page.locator('#best')).toHaveText(/4\d{3}/);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused bar does not move', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                customers.length = 0;
                customers.push({ lane: 0, x: 500, state: 'advancing', drink: 0 });
            });
            await page.keyboard.press('KeyP');
            const before = await page.evaluate(() => customers[0].x);
            await page.waitForTimeout(250);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });

        test('P does nothing while the game is idle', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test('the score in the HUD follows a serve', async ({ page }) => {
            await startFrozen(page);
            await clearWorld(page);
            await addCustomer(page, { lane: 0, x: 300 });
            await addMug(page, { lane: 0, x: 250 });
            await stepSeconds(page, 0.3);
            await expect(page.locator('#score')).toHaveText('50');
        });

        test('the HUD counts served customers against the quota', async ({ page }) => {
            await startFrozen(page);
            await expect(page.locator('#served')).toHaveText('0 / 8');
            await page.evaluate(() => {
                served = 3;
                updateHud();
            });
            await expect(page.locator('#served')).toHaveText('3 / 8');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas keeps repainting while customers walk in', async ({ page }) => {
            await page.keyboard.press('Space');
            const first = await page.locator('#canvas').screenshot();
            await page.waitForTimeout(400);
            const second = await page.locator('#canvas').screenshot();
            expect(Buffer.compare(first, second)).not.toBe(0);
        });

        test('the board is drawn before the game starts', async ({ page }) => {
            const shot = await page.locator('#canvas').screenshot();
            expect(shot.length).toBeGreaterThan(1000);
        });
    });

    // -----------------------------------------------------------------------
    // A real, unassisted game
    // -----------------------------------------------------------------------
    test.describe('playing for real', () => {
        test('a simple strategy serves customers and scores points', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoRun = false;
                // Always attend the most urgent counter: a returning empty close
                // to the taps first, otherwise the customer nearest the taps.
                for (let i = 0; i < 120 * 90 && state === 'running'; i++) {
                    const empty = empties.slice().sort((a, b) => a.x - b.x)[0];
                    const cust = customers
                        .filter((c) => c.state === 'advancing')
                        .sort((a, b) => a.x - b.x)[0];
                    if (empty && empty.x < 260) player.lane = empty.lane;
                    else if (cust) player.lane = cust.lane;
                    if (cust && cust.lane === player.lane && !empties.some((e) => e.x < 260)) pour();
                    physicsStep(1 / 120);
                }
                return { score, served, state, lives };
            });
            expect(result.served).toBeGreaterThanOrEqual(3);
            expect(result.score).toBeGreaterThan(0);
            expect(['running', 'levelclear', 'gameover', 'won']).toContain(result.state);
        });

        test('the spawner respects the per-counter crowd limit', async ({ page }) => {
            const worst = await page.evaluate(() => {
                startGame();
                autoRun = false;
                let worstCount = 0;
                for (let i = 0; i < 120 * 120 && state === 'running'; i++) {
                    physicsStep(1 / 120);
                    for (let lane = 0; lane < LANES; lane++) {
                        const n = customers.filter(
                            (c) => c.lane === lane && c.state === 'advancing'
                        ).length;
                        if (n > worstCount) worstCount = n;
                    }
                }
                return worstCount;
            });
            expect(worst).toBeGreaterThan(0);
            expect(worst).toBeLessThanOrEqual(3);
        });

        test('the spawner never exceeds the level quota', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoRun = false;
                lives = 99;
                for (let i = 0; i < 120 * 300 && state === 'running'; i++) physicsStep(1 / 120);
                return { spawned, quota };
            });
            expect(result.spawned).toBeLessThanOrEqual(result.quota);
        });

        test('a level played out with no input loses lives but never breaks', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoRun = false;
                for (let i = 0; i < 120 * 200 && state === 'running'; i++) physicsStep(1 / 120);
                const bad = customers.filter(
                    (c) => !Number.isFinite(c.x) || c.x < -200 || c.x > BAR_RIGHT + 200
                );
                return { state, lives, bad: bad.length, score };
            });
            expect(['gameover', 'levelclear']).toContain(result.state);
            expect(result.lives).toBeLessThan(3);
            expect(result.bad).toBe(0);
        });

        test('nothing ever leaves the canvas horizontally', async ({ page }) => {
            const escaped = await page.evaluate(() => {
                startGame();
                autoRun = false;
                lives = 99;
                for (let i = 0; i < 120 * 200 && state === 'running'; i++) {
                    physicsStep(1 / 120);
                    const all = [...mugs, ...empties];
                    for (const m of all) {
                        if (m.x < -40 || m.x > W + 40) return { x: m.x };
                    }
                }
                return null;
            });
            expect(escaped).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Game browser integration
    // -----------------------------------------------------------------------
    test.describe('game browser integration', () => {
        test('games.json lists Soda Slinger', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'soda-slinger');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Soda Slinger');
            expect(entry.dir).toBe('SodaSlinger');
            expect(entry.path).toBe('games/SodaSlinger/index.html');
            expect(entry.thumbnail).toBe('games/SodaSlinger/screenshot.png');
            expect(entry.category).toBe('Action');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const i = games.findIndex((g) => g.id === 'soda-slinger');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            if (i + 1 < games.length) {
                expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
            }
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaSlinger/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(
                /\|\s*Soda Slinger\s*\|\s*\[SodaSlinger\/\]\(SodaSlinger\/\)\s*\|\s*(Complete|In Progress)\s*\|/
            );
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaSlinger/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaSlinger/DESIGN.md'))).toBe(true);
        });
    });
});
