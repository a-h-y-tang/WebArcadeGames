const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start a running game with automatic spawning and the real-time loop switched
// off, so every spec drives the simulation itself through `step(dt)`.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
        spawnEnabled = false;
        customers.length = 0;
        mugs.length = 0;
        empties.length = 0;
    });

// The game's tuning constants, read out of the page so specs can assert
// against the real values instead of duplicating them.
const consts = (page) =>
    page.evaluate(() => ({
        LANE_COUNT,
        TAP_X,
        LEAVE_X,
        GRAB_X,
        SCORE_HIT,
        SCORE_SERVED,
        SCORE_CATCH,
        LEVEL_BONUS,
    }));

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

test.describe('Tavern Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tavern Tapper', async ({ page }) => {
            await expect(page).toHaveTitle('Tavern Tapper');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 600x420', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '420');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('the bar has four lanes', async ({ page }) => {
            expect(await page.evaluate(() => LANE_COUNT)).toBe(4);
        });

        test('no customers, mugs or empties before starting', async ({ page }) => {
            const counts = await page.evaluate(() => [
                customers.length,
                mugs.length,
                empties.length,
            ]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('idle simulation does not spawn anyone', async ({ page }) => {
            await advance(page, 300);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a new game resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                level = 4;
                startGame();
            });
            expect(await page.evaluate(() => [score, lives, level])).toEqual([0, 3, 1]);
        });

        test('the barkeep starts in the top lane', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('customers arrive once the game is running', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            await advance(page, 60 * 20);
            expect(await page.evaluate(() => customers.length)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between lanes
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('ArrowDown moves the barkeep down a lane', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('ArrowUp moves the barkeep back up a lane', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('w and s also change lanes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('s');
            expect(await page.evaluate(() => player.lane)).toBe(1);
            await page.keyboard.press('w');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('the barkeep cannot climb above the top lane', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('the barkeep cannot go below the bottom lane', async ({ page }) => {
            await startQuiet(page);
            const { LANE_COUNT } = await consts(page);
            for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(LANE_COUNT - 1);
        });

        test('lanes do not move while the game is idle', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            // Space/arrow before start only starts the game; lane stays put.
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving mugs
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('Space pours a mug into the current lane', async ({ page }) => {
            await startQuiet(page);
            const { TAP_X } = await consts(page);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Space');
            const mug = await page.evaluate(() => mugs.map((m) => ({ lane: m.lane, x: m.x })));
            expect(mug).toHaveLength(1);
            expect(mug[0].lane).toBe(1);
            expect(mug[0].x).toBeCloseTo(TAP_X, 0);
        });

        test('a served mug slides left along the bar', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeLessThan(before);
        });

        test('the tap has a cooldown between pours', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('Space');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('the tap can pour again after the cooldown', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('Space');
            await advance(page, 60);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Mugs and customers
    // -----------------------------------------------------------------------
    test.describe('serving customers', () => {
        test('a mug that reaches a customer pushes them back and scores', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                customers[0].thirst = 3;
                serve();
                return customers[0].x;
            });
            await advance(page, 100);
            const after = await page.evaluate(() => ({ x: customers[0].x, score, mugs: mugs.length }));
            expect(after.x).toBeLessThan(before);
            expect(after.score).toBeGreaterThan(0);
            expect(after.mugs).toBe(0);
        });

        test('a drinking customer pauses before walking on', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                customers[0].thirst = 3;
                serve();
            });
            await advance(page, 100);
            const drinking = await page.evaluate(() => customers[0].drink > 0);
            expect(drinking).toBe(true);
        });

        test('a patron shoved as far as the door stays until their thirst is done', async ({ page }) => {
            await startQuiet(page);
            const { LEAVE_X } = await consts(page);
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = LEAVE_X + 10;
                customers[0].thirst = 3;
                serve();
            });
            await advance(page, 60 * 3);
            const c = await page.evaluate(() => customers.map((x) => ({ x: x.x, thirst: x.thirst })));
            expect(c).toHaveLength(1);
            expect(c[0].thirst).toBe(2);
            expect(c[0].x).toBeGreaterThanOrEqual(LEAVE_X);
        });

        test('a happy customer sends an empty mug back', async ({ page }) => {
            await startQuiet(page);
            const { SCORE_SERVED } = await consts(page);
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = LEAVE_X + 10;
                customers[0].thirst = 1;
                serve();
            });
            await advance(page, 60 * 3);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => empties.length)).toBe(1);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(SCORE_SERVED);
        });

        test('a patron whose thirst is quenched leaves the tavern', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                customers[0].thirst = 1;
                serve();
            });
            await advance(page, 100);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => empties.length)).toBe(1);
        });

        test('a thirstier patron needs more than one mug', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                customers[0].thirst = 2;
                serve();
            });
            await advance(page, 100);
            expect(await page.evaluate(() => customers.length)).toBe(1);
            expect(await page.evaluate(() => customers[0].thirst)).toBe(1);
        });

        test('customers walk toward the tap over time', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => {
                spawnCustomer(2);
                return customers[0].x;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test('an empty caught in the right lane scores', async ({ page }) => {
            await startQuiet(page);
            const { SCORE_CATCH } = await consts(page);
            await page.evaluate(() => {
                player.lane = 0;
                empties.push({ lane: 0, x: TAP_X - 30 });
            });
            await advance(page, 120);
            expect(await page.evaluate(() => [empties.length, lives])).toEqual([0, 3]);
            expect(await page.evaluate(() => score)).toBe(SCORE_CATCH);
        });

        test('an empty missed in another lane costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.lane = 3;
                empties.push({ lane: 0, x: TAP_X - 30 });
            });
            await advance(page, 120);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => empties.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Losing lives
    // -----------------------------------------------------------------------
    test.describe('losing lives', () => {
        test('a mug that runs off the end of the bar smashes', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => serve());
            await advance(page, 60 * 6);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('a customer reaching the tap costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(1);
                customers[0].x = GRAB_X - 4;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('losing a life clears the bar', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(1);
                customers[0].x = GRAB_X - 4;
                spawnCustomer(2);
                empties.push({ lane: 3, x: 200 });
                serve();
            });
            await advance(page, 120);
            const counts = await page.evaluate(() => [customers.length, mugs.length, empties.length]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('the HUD tracks the lives left', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => loseLife());
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('running out of lives ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                loseLife();
                loseLife();
                loseLife();
            });
            expect(await page.evaluate(() => state)).toBe('over');
        });

        test('the overlay reports the final score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 1234;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('the simulation stops once the game is over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnCustomer(0);
                lives = 1;
                loseLife();
                spawnCustomer(0);
            });
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });

        test('Space starts a fresh game after a game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 500;
                lives = 1;
                loseLife();
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => [state, score, lives])).toEqual(['running', 0, 3]);
        });

        test('the best score is kept in localStorage', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 777;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#best')).toHaveText('777');
            const stored = await page.evaluate(() => localStorage.getItem('tavern-tapper-best'));
            expect(stored).toBe('777');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes the game', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnCustomer(0));
            await page.keyboard.press('p');
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });

        test('the pause overlay is shown while paused', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing a level advances to the next one', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                toSpawn = 0;
            });
            await advance(page, 60 * 3);
            expect(await page.evaluate(() => level)).toBe(2);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('clearing a level awards a bonus', async ({ page }) => {
            await startQuiet(page);
            const { LEVEL_BONUS } = await consts(page);
            await page.evaluate(() => {
                toSpawn = 0;
            });
            await advance(page, 60 * 3);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(LEVEL_BONUS);
        });

        test('a level is not cleared while customers are still drinking', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                toSpawn = 0;
                spawnCustomer(0);
            });
            await advance(page, 30);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('later levels send thirstier, faster customers', async ({ page }) => {
            await startQuiet(page);
            const first = await page.evaluate(() => [customerSpeed(), customerThirst()]);
            await page.evaluate(() => {
                level = 5;
            });
            const later = await page.evaluate(() => [customerSpeed(), customerThirst()]);
            expect(later[0]).toBeGreaterThan(first[0]);
            expect(later[1]).toBeGreaterThan(first[1]);
        });

        test('later levels send more patrons through the door', async ({ page }) => {
            await startQuiet(page);
            const first = await page.evaluate(() => levelCustomers());
            await page.evaluate(() => {
                level = 5;
            });
            expect(await page.evaluate(() => levelCustomers())).toBeGreaterThan(first);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
                spawnCustomer(0);
                draw();
            });
            const blank = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
                return true;
            });
            expect(blank).toBe(false);
        });

        test('the game runs on its own without errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => startGame());
            await page.waitForTimeout(1200);
            expect(errors).toEqual([]);
            expect(await page.evaluate(() => customers.length + score + lives)).toBeGreaterThan(0);
        });
    });
});
