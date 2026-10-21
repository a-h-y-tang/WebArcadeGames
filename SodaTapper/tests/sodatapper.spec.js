const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with an empty bar and time under the spec's control: no
// requestAnimationFrame stepping behind our back, no customers wandering in
// from the spawn timer. Specs that want customers place them themselves.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
        customers.length = 0;
        mugs.length = 0;
        spawnTimer = Infinity;
    });

// Step until the page-side condition holds, up to a frame budget. Used where
// a spec waits on a chain of delays (mug travel, then drinking, then the mug
// coming back) and pinning an exact frame count would be brittle.
const advanceUntil = async (page, body, maxFrames = 900) => {
    const held = await page.evaluate(
        ([src, budget]) => {
            const cond = new Function(`return (${src});`);
            for (let i = 0; i < budget; i++) {
                if (cond()) return true;
                step(1 / 60);
            }
            return cond();
        },
        [body, maxFrames]
    );
    expect(held, `condition never held: ${body}`).toBe(true);
};

// Put a customer on the bar at a known spot, bypassing the spawn timer.
const placeCustomer = (page, lane, x) =>
    page.evaluate(([l, px]) => {
        const c = spawnCustomer(l);
        c.x = px;
        return c;
    }, [lane, x]);

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

        test('canvas is the documented size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
            expect(await page.evaluate(() => [CANVAS_W, CANVAS_H])).toEqual([720, 480]);
        });

        test('there are four counters', async ({ page }) => {
            expect(await page.evaluate(() => LANES)).toBe(4);
        });

        test('counter geometry runs left to right', async ({ page }) => {
            const geo = await page.evaluate(() => [BAR_LEFT, TAP_X, CATCH_X, BAR_RIGHT, PLAYER_X]);
            const [barLeft, tapX, catchX, barRight] = geo;
            expect(barLeft).toBeLessThan(catchX);
            expect(catchX).toBeLessThanOrEqual(tapX);
            expect(tapX).toBeLessThanOrEqual(barRight);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows the starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('bar is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => [customers.length, mugs.length])).toEqual([0, 0]);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('step() does nothing while idle', async ({ page }) => {
            await page.evaluate(() => {
                autoStep = false;
                spawnTimer = 0.0001;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('starting hides the overlay', async ({ page }) => {
            await startQuiet(page);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the server starts on the top counter at the station', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => [player.lane, player.x])).toEqual([0, await page.evaluate(() => PLAYER_X)]);
        });

        test('a fresh game resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 999;
                lives = 1;
                level = 5;
                startGame();
            });
            expect(await page.evaluate(() => [score, lives, level])).toEqual([0, 3, 1]);
        });

        test('level 1 wants a full wave of customers served', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => waveSize)).toBe(6);
            expect(await page.evaluate(() => served)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between counters
    // -----------------------------------------------------------------------
    test.describe('the server', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('arrow down moves one counter down', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('arrow up moves one counter up', async ({ page }) => {
            await page.evaluate(() => moveLane(2));
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('W and S move up and down too', async ({ page }) => {
            await page.keyboard.press('s');
            expect(await page.evaluate(() => player.lane)).toBe(1);
            await page.keyboard.press('w');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('cannot move above the top counter', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('cannot move below the bottom counter', async ({ page }) => {
            await page.evaluate(() => moveLane(LANES));
            expect(await page.evaluate(() => player.lane)).toBe(3);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(3);
        });

        test('holding an arrow key does not repeat the move', async ({ page }) => {
            await page.keyboard.down('ArrowDown');
            await advance(page, 120);
            expect(await page.evaluate(() => player.lane)).toBe(1);
            await page.keyboard.up('ArrowDown');
        });

        test('the server stays at the station', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(await page.evaluate(() => PLAYER_X));
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('space pours a mug on the current counter', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Space');
            const mug = await page.evaluate(() => mugs.map((m) => ({ lane: m.lane, dir: m.dir, x: m.x })));
            expect(mug).toHaveLength(1);
            expect(mug[0].lane).toBe(1);
            expect(mug[0].dir).toBe(-1);
            expect(mug[0].x).toBe(await page.evaluate(() => TAP_X));
        });

        test('clicking the canvas pours a mug', async ({ page }) => {
            await page.locator('#canvas').click({ position: { x: 10, y: 10 } });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('a poured mug slides towards the far end at MUG_SPEED', async ({ page }) => {
            await page.evaluate(() => pour());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeLessThan(before);
            const speed = await page.evaluate(() => MUG_SPEED);
            expect(before - after).toBeCloseTo(speed * 0.5, 0);
        });

        test('the cooldown stops a second mug in the same instant', async ({ page }) => {
            await page.evaluate(() => {
                pour();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('a second mug can be poured once the cooldown expires', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 30);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('pouring does nothing while paused', async ({ page }) => {
            await page.evaluate(() => togglePause());
            await page.keyboard.press('Space');
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

        test('a spawned customer starts at the far end and advances', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(2));
            const start = await page.evaluate(() => customers[0].x);
            expect(start).toBeCloseTo(await page.evaluate(() => BAR_LEFT), 0);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBeGreaterThan(start);
        });

        test('customers only ever walk on their own counter', async ({ page }) => {
            await placeCustomer(page, 3, 300);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].lane)).toBe(3);
        });

        test('the spawn timer brings customers in', async ({ page }) => {
            await page.evaluate(() => {
                spawnTimer = 0.01;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => customers.length)).toBe(1);
            expect(await page.evaluate(() => spawned)).toBe(1);
        });

        test('no more than MAX_ONSCREEN customers at once', async ({ page }) => {
            await page.evaluate(() => {
                level = 9;
                waveSize = 50;
                spawnTimer = 0.001;
            });
            await advance(page, 1200);
            expect(await page.evaluate(() => customers.length)).toBeLessThanOrEqual(
                await page.evaluate(() => MAX_ONSCREEN)
            );
        });

        test('no more customers spawn than the wave holds', async ({ page }) => {
            await page.evaluate(() => {
                waveSize = 2;
                spawnTimer = 0.001;
            });
            await advance(page, 600);
            expect(await page.evaluate(() => spawned)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a mug reaching a customer is taken', async ({ page }) => {
            await placeCustomer(page, 0, 300);
            await page.evaluate(() => pour());
            await advance(page, 120);
            expect(await page.evaluate(() => mugs.filter((m) => m.dir === -1).length)).toBe(0);
            expect(await page.evaluate(() => customers[0].drinks)).toBe(1);
        });

        test('taking a mug shoves the customer back', async ({ page }) => {
            await placeCustomer(page, 0, 300);
            const before = await page.evaluate(() => customers[0].x);
            await page.evaluate(() => pour());
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBeLessThan(before);
        });

        test('serving a mug scores points', async ({ page }) => {
            await placeCustomer(page, 0, 300);
            await page.evaluate(() => pour());
            await advance(page, 120);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => SCORE_SERVE_MUG));
        });

        test('a drinking customer stands still, then moves again', async ({ page }) => {
            await placeCustomer(page, 0, 300);
            await page.evaluate(() => pour());
            await advanceUntil(page, "customers[0].state === 'drinking'");
            const during = await page.evaluate(() => customers[0].x);
            await advance(page, 6);
            expect(await page.evaluate(() => customers[0].x)).toBe(during);
            await advanceUntil(page, "customers[0].state === 'advancing'");
        });

        test('a mug only serves a customer on its own counter', async ({ page }) => {
            await placeCustomer(page, 2, 300);
            await page.evaluate(() => pour()); // player is on lane 0
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].drinks)).toBe(0);
        });

        test('the nearest customer takes the mug', async ({ page }) => {
            await placeCustomer(page, 0, 200);
            await placeCustomer(page, 0, 400);
            await page.evaluate(() => pour());
            await advance(page, 120);
            const drinks = await page.evaluate(() => customers.map((c) => c.drinks));
            expect(drinks).toEqual([0, 1]);
        });

        test('a customer who has had enough leaves and is counted', async ({ page }) => {
            await placeCustomer(page, 0, 400);
            await page.evaluate(() => {
                customers[0].drinks = DRINKS_NEEDED - 1;
                pour();
            });
            await advanceUntil(page, "customers[0].state === 'drinking'");
            await advanceUntil(page, "customers[0].state === 'leaving'");
            await advance(page, 400);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => served)).toBe(1);
        });

        test('a served customer is worth more than a mug', async ({ page }) => {
            const [mugPts, custPts] = await page.evaluate(() => [SCORE_SERVE_MUG, SCORE_CUSTOMER]);
            expect(custPts).toBeGreaterThan(mugPts);
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('finishing a drink sends an empty mug back', async ({ page }) => {
            await placeCustomer(page, 0, 300);
            await page.evaluate(() => pour());
            await advanceUntil(page, 'mugs.some((m) => m.dir === 1)');
            const empties = await page.evaluate(() => mugs.filter((m) => m.dir === 1).length);
            expect(empties).toBe(1);
        });

        test('an empty mug slides towards the station', async ({ page }) => {
            await page.evaluate(() => mugs.push(makeMug(0, 200, 1)));
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            expect(await page.evaluate(() => mugs[0].x)).toBeGreaterThan(before);
        });

        test('an empty mug is caught when the server is on its counter', async ({ page }) => {
            await page.evaluate(() => mugs.push(makeMug(0, CATCH_X - 20, 1)));
            await advance(page, 60);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => SCORE_CATCH));
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an empty mug missed on another counter shatters', async ({ page }) => {
            await page.evaluate(() => mugs.push(makeMug(2, CATCH_X - 20, 1)));
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => lastLoss)).toBe('shatter');
        });

        test('catching does not count as a served customer', async ({ page }) => {
            await page.evaluate(() => mugs.push(makeMug(0, CATCH_X - 20, 1)));
            await advance(page, 60);
            expect(await page.evaluate(() => served)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Losing a life
    // -----------------------------------------------------------------------
    test.describe('losing a life', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a mug that reaches the far end spills', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 300);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => lastLoss)).toBe('spill');
        });

        test('a customer reaching the station grabs the server', async ({ page }) => {
            await placeCustomer(page, 1, 600);
            await advance(page, 600);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => lastLoss)).toBe('grabbed');
        });

        test('losing a life clears the bar', async ({ page }) => {
            await placeCustomer(page, 1, 600);
            await page.evaluate(() => {
                player.lane = 1;
                pour();
            });
            await advanceUntil(page, 'lives < 3');
            expect(await page.evaluate(() => [customers.length, mugs.length])).toEqual([0, 0]);
        });

        test('losing a life re-queues the lost customers', async ({ page }) => {
            await page.evaluate(() => {
                spawnTimer = 0.001;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => spawned)).toBe(1);
            await page.evaluate(() => {
                spawnTimer = Infinity;
                customers[0].x = BAR_RIGHT;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => spawned)).toBe(0);
        });

        test('play pauses briefly after a life is lost', async ({ page }) => {
            await page.evaluate(() => pour());
            await advanceUntil(page, 'lives < 3');
            expect(await page.evaluate(() => state)).toBe('respawn');
            await advanceUntil(page, "state === 'playing'");
        });

        test('the overlay names what went wrong', async ({ page }) => {
            await page.evaluate(() => pour());
            await advanceUntil(page, 'lives < 3');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/spill/i);
        });

        test('the HUD loses a life', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 300);
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('serving the whole wave clears the level', async ({ page }) => {
            await page.evaluate(() => {
                waveSize = 1;
                spawned = 1;
                const c = spawnCustomer(0);
                spawned = 1;
                c.x = BAR_LEFT + 10;
                c.state = 'leaving';
            });
            await advance(page, 120);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('a cleared level pays a bonus and advances', async ({ page }) => {
            await page.evaluate(() => {
                score = 0;
                waveSize = 1;
                const c = spawnCustomer(0);
                spawned = 1;
                c.x = BAR_LEFT + 10;
                c.state = 'leaving';
            });
            await advance(page, 120);
            expect(await page.evaluate(() => score)).toBe(
                (await page.evaluate(() => SCORE_CUSTOMER)) + 200
            );
            await advance(page, 180);
            expect(await page.evaluate(() => [level, state])).toEqual([2, 'playing']);
        });

        test('a new level resets the wave counters', async ({ page }) => {
            await page.evaluate(() => startLevel(3));
            expect(await page.evaluate(() => [level, served, spawned, waveSize])).toEqual([3, 0, 0, 10]);
        });

        test('later levels send customers in faster', async ({ page }) => {
            const first = await page.evaluate(() => {
                startLevel(1);
                return [spawnInterval(), customerSpeed()];
            });
            const later = await page.evaluate(() => {
                startLevel(6);
                return [spawnInterval(), customerSpeed()];
            });
            expect(later[0]).toBeLessThan(first[0]);
            expect(later[1]).toBeGreaterThan(first[1]);
        });

        test('clearing a level does not cost a life', async ({ page }) => {
            await page.evaluate(() => {
                waveSize = 1;
                const c = spawnCustomer(0);
                spawned = 1;
                c.x = BAR_LEFT + 10;
                c.state = 'leaving';
            });
            await advance(page, 300);
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Pause and game over
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('nothing moves while paused', async ({ page }) => {
            await placeCustomer(page, 0, 300);
            await page.evaluate(() => togglePause());
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBe(300);
        });

        test('space resumes from pause', async ({ page }) => {
            await page.evaluate(() => togglePause());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the pause overlay is shown', async ({ page }) => {
            await page.evaluate(() => togglePause());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });
    });

    test.describe('game over', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the game ends when the last life is lost', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                pour();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => [lives, state])).toEqual([0, 'over']);
        });

        test('the game over overlay reports the score', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                score = 1234;
                pour();
            });
            await advance(page, 300);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('nothing moves after the game is over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                pour();
            });
            await advance(page, 300);
            await page.evaluate(() => {
                const c = spawnCustomer(0);
                c.x = 300;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBe(300);
        });

        test('the best score is kept', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                score = 777;
                pour();
            });
            await advance(page, 300);
            await expect(page.locator('#best')).toHaveText('777');
            expect(await page.evaluate(() => window.localStorage.getItem('sodatapper-best'))).toBe('777');
        });

        test('space starts a new game after game over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                pour();
            });
            await advance(page, 300);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => [state, lives, score])).toEqual(['playing', 3, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas draws something once a game is running', async ({ page }) => {
            await startQuiet(page);
            await placeCustomer(page, 0, 300);
            await page.evaluate(() => {
                pour();
                draw();
            });
            const blank = await page.evaluate(() => {
                const ctx = document.getElementById('canvas').getContext('2d');
                const d = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return false;
                }
                return true;
            });
            expect(blank).toBe(false);
        });

        test('drawing does not change the simulation', async ({ page }) => {
            await startQuiet(page);
            await placeCustomer(page, 0, 300);
            await page.evaluate(() => pour());
            const before = await page.evaluate(() => JSON.stringify([customers, mugs, score, lives]));
            await page.evaluate(() => {
                draw();
                draw();
            });
            expect(await page.evaluate(() => JSON.stringify([customers, mugs, score, lives]))).toBe(before);
        });
    });
});
