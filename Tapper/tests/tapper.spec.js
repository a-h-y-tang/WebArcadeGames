const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with customer spawning switched off, so long simulations stay
// deterministic. Specs that are about spawning leave it on.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
        customers.length = 0;
    });

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so lane changes are confirmed against game state before continuing.
const pressLane = async (page, key, wantLane) => {
    await page.keyboard.press(key);
    await page.waitForFunction((lane) => player.lane === lane, wantLane);
};

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

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, lives and level', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('there are four bars', async ({ page }) => {
            expect(await page.evaluate(() => LANES)).toBe(4);
        });

        test('nothing is in play before starting', async ({ page }) => {
            const counts = await page.evaluate(() => [
                customers.length,
                mugs.length,
                empties.length,
            ]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('stepping while idle changes nothing', async ({ page }) => {
            await advance(page, 120);
            expect(await page.evaluate(() => state)).toBe('idle');
            expect(await page.evaluate(() => customers.length)).toBe(0);
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

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'playing');
        });

        test('starting resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                score = 999;
                lives = 1;
                level = 7;
                startGame();
            });
            expect(await page.evaluate(() => [score, lives, level])).toEqual([0, 3, 1]);
        });

        test('the barkeep starts on the top bar', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between bars
    // -----------------------------------------------------------------------
    test.describe('barkeep movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowDown moves down a bar', async ({ page }) => {
            await pressLane(page, 'ArrowDown', 1);
        });

        test('ArrowUp moves back up a bar', async ({ page }) => {
            await pressLane(page, 'ArrowDown', 1);
            await pressLane(page, 'ArrowUp', 0);
        });

        test('s and w move down and up', async ({ page }) => {
            await pressLane(page, 's', 1);
            await pressLane(page, 'w', 0);
        });

        test('cannot move above the top bar', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await page.waitForTimeout(50);
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('cannot move below the bottom bar', async ({ page }) => {
            const bottom = await page.evaluate(() => {
                player.lane = LANES - 1;
                return player.lane;
            });
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(50);
            expect(await page.evaluate(() => player.lane)).toBe(bottom);
        });

        test('movement is ignored while idle', async ({ page }) => {
            await page.reload();
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(50);
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring mugs
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space pours a mug on the barkeep\'s bar', async ({ page }) => {
            await page.evaluate(() => {
                player.lane = 2;
            });
            await page.keyboard.press('Space');
            await page.waitForFunction(() => mugs.length === 1);
            expect(await page.evaluate(() => mugs[0].lane)).toBe(2);
        });

        test('a poured mug starts at the tap end of the bar', async ({ page }) => {
            const x = await page.evaluate(() => pourMug().x);
            expect(x).toBeGreaterThan(await page.evaluate(() => BAR_RIGHT - 60));
            expect(x).toBeLessThanOrEqual(await page.evaluate(() => BAR_RIGHT));
        });

        test('a mug slides toward the far end of the bar', async ({ page }) => {
            const before = await page.evaluate(() => pourMug().x);
            await advance(page, 30);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeLessThan(before);
        });

        test('pouring is rate limited', async ({ page }) => {
            await page.evaluate(() => {
                pourMug();
                pourMug();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('another mug can be poured once the tap recovers', async ({ page }) => {
            await page.evaluate(() => pourMug());
            await advance(page, 30);
            await page.evaluate(() => pourMug());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('a mug that runs off the far end costs a life', async ({ page }) => {
            await page.evaluate(() => pourMug());
            await advance(page, 240);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('no mug is poured while idle', async ({ page }) => {
            await page.reload();
            await page.evaluate(() => {
                // Space starts the game, so pour directly to prove the guard.
                pourMug();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test('customers arrive once the game is running', async ({ page }) => {
            await page.evaluate(() => startGame());
            await advance(page, 600);
            expect(await page.evaluate(() => customers.length)).toBeGreaterThan(0);
        });

        test('no customers arrive while spawning is disabled', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 600);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });

        test('a customer walks toward the tap', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => spawnCustomer(0, BAR_LEFT).x);
            await advance(page, 120);
            const after = await page.evaluate(() => customers[0].x);
            expect(after).toBeGreaterThan(before);
        });

        test('a customer reaching the tap costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnCustomer(0, TAP_X - CUSTOMER_W - 4));
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });

        test('customers walk faster on later levels', async ({ page }) => {
            const [l1, l2] = await page.evaluate(() => [customerSpeed(1), customerSpeed(2)]);
            expect(l2).toBeGreaterThan(l1);
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a mug that reaches a customer is caught and scores', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0, BAR_RIGHT - 120));
            await page.evaluate(() => pourMug());
            await advance(page, 120);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => HIT_POINTS));
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('a served customer is pushed back down the bar', async ({ page }) => {
            const start = await page.evaluate(() => spawnCustomer(0, BAR_RIGHT - 120).x);
            await page.evaluate(() => pourMug());
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBeLessThan(start);
        });

        test('a mug only reaches customers on its own bar', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(2, BAR_RIGHT - 120));
            await page.evaluate(() => pourMug()); // barkeep is on lane 0
            await advance(page, 60); // the mug is now well past the customer's x
            expect(await page.evaluate(() => customers[0].state)).toBe('walking');
            expect(await page.evaluate(() => mugs.length)).toBe(1);

            await advance(page, 180); // ...and runs off the far end
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a customer pushed off the far end is served for points', async ({ page }) => {
            await page.evaluate(() => {
                const c = spawnCustomer(0, BAR_LEFT + 10);
                c.state = 'sliding';
                c.timer = 1;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => served)).toBe(1);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => SERVE_POINTS));
        });

        test('a customer who has had a drink comes back faster', async ({ page }) => {
            const before = await page.evaluate(() => spawnCustomer(0, BAR_RIGHT - 120).speed);
            await page.evaluate(() => pourMug());
            await advance(page, 60);
            const after = await page.evaluate(() => customers[0].speed);
            expect(after).toBeGreaterThan(before);
            expect(await page.evaluate(() => customers[0].hits)).toBe(1);
        });

        test('thirst has a ceiling', async ({ page }) => {
            const speed = await page.evaluate(() => {
                const c = spawnCustomer(0, BAR_RIGHT - 120);
                for (let i = 0; i < 40; i++) {
                    c.state = 'walking';
                    c.x = BAR_RIGHT - 120;
                    pourMug();
                    for (let f = 0; f < 60; f++) step(1 / 60);
                }
                return { speed: c.speed, base: c.base };
            });
            expect(speed.speed).toBeLessThanOrEqual(speed.base * 1.9 + 1e-6);
        });

        test('a drinking customer sends an empty mug back', async ({ page }) => {
            await page.evaluate(() => {
                const c = spawnCustomer(0, BAR_RIGHT - 200);
                c.state = 'drinking';
                c.timer = 0.05;
            });
            await advance(page, 12);
            expect(await page.evaluate(() => empties.length)).toBe(1);
            expect(await page.evaluate(() => empties[0].lane)).toBe(0);
            expect(await page.evaluate(() => customers[0].state)).toBe('walking');
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty mug slides back toward the tap', async ({ page }) => {
            const before = await page.evaluate(() => spawnEmpty(0, BAR_LEFT + 40).x);
            await advance(page, 30);
            expect(await page.evaluate(() => empties[0].x)).toBeGreaterThan(before);
        });

        test('the barkeep catches an empty on their own bar', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(0, CATCH_X - 10));
            await advance(page, 30);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => CATCH_POINTS));
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an empty on another bar smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(3, CATCH_X - 10));
            await advance(page, 60);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('losing a life clears the bars and pauses briefly', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(1, BAR_LEFT + 20);
                spawnEmpty(2, BAR_LEFT + 20);
                loseLife();
            });
            expect(await page.evaluate(() => [customers.length, mugs.length, empties.length]))
                .toEqual([0, 0, 0]);
            expect(await page.evaluate(() => state)).toBe('respawn');
        });

        test('play resumes after the respawn pause', async ({ page }) => {
            await page.evaluate(() => loseLife());
            await advance(page, 180);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('a customer removed by a life loss is spawned again later', async ({ page }) => {
            const before = await page.evaluate(() => {
                spawnCustomer(1, BAR_LEFT + 20);
                return toSpawn;
            });
            await page.evaluate(() => loseLife());
            expect(await page.evaluate(() => toSpawn)).toBe(before + 1);
        });

        test('the reason a life was lost is remembered', async ({ page }) => {
            await page.evaluate(() => pourMug());
            await advance(page, 240);
            expect(await page.evaluate(() => lastLoss)).toBe('spilled');

            await page.evaluate(() => {
                state = 'playing';
                spawnEmpty(3, CATCH_X - 5);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => lastLoss)).toBe('smashed');
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-score')).toContainText(/game over/i);
        });

        test('the game over overlay shows the final score', async ({ page }) => {
            await page.evaluate(() => {
                score = 450;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#overlay-score')).toContainText('450');
        });

        test('Space starts a fresh game after a game over', async ({ page }) => {
            await page.evaluate(() => {
                score = 450;
                lives = 1;
                loseLife();
            });
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'playing');
            expect(await page.evaluate(() => [score, lives])).toEqual([0, 3]);
        });

        test('the simulation is frozen after a game over', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT);
                lives = 1;
                loseLife();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => state)).toBe('gameover');
        });
    });

    // -----------------------------------------------------------------------
    // Waves and levels
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a wave has customers left to serve at the start', async ({ page }) => {
            expect(await page.evaluate(() => toSpawn)).toBeGreaterThan(0);
            expect(await page.evaluate(() => served)).toBe(0);
        });

        test('serving the whole wave clears the bar', async ({ page }) => {
            await page.evaluate(() => {
                served = waveTotal;
                toSpawn = 0;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('wave');
        });

        test('the next level starts after the wave break', async ({ page }) => {
            await page.evaluate(() => {
                served = waveTotal;
                toSpawn = 0;
            });
            await advance(page, 240);
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('playing');
            expect(await page.evaluate(() => served)).toBe(0);
        });

        test('a later wave has more customers', async ({ page }) => {
            const first = await page.evaluate(() => waveTotal);
            await page.evaluate(() => startWave(3));
            expect(await page.evaluate(() => waveTotal)).toBeGreaterThan(first);
        });

        test('the wave does not clear while mugs are still in play', async ({ page }) => {
            await page.evaluate(() => {
                served = waveTotal;
                toSpawn = 0;
                pourMug();
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('P pauses and shows the overlay', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'playing');
        });

        test('nothing moves while paused', async ({ page }) => {
            const x = await page.evaluate(() => {
                const c = spawnCustomer(0, BAR_LEFT);
                togglePause();
                return c.x;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => customers[0].x)).toBe(x);
        });
    });

    // -----------------------------------------------------------------------
    // HUD and persistence
    // -----------------------------------------------------------------------
    test.describe('HUD and persistence', () => {
        test('the HUD tracks score, lives and level', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 320;
                lives = 2;
                level = 4;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('320');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#level')).toHaveText('4');
        });

        test('a new best score is stored', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 1234;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#best')).toHaveText('1234');
            expect(await page.evaluate(() => localStorage.getItem('tapper-best'))).toBe('1234');
        });

        test('the best score survives a reload', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 777;
                lives = 1;
                loseLife();
            });
            await page.reload();
            await expect(page.locator('#best')).toHaveText('777');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('drawing a busy bar does not throw', async ({ page }) => {
            await startQuiet(page);
            const ok = await page.evaluate(() => {
                spawnCustomer(0, BAR_LEFT + 40);
                spawnCustomer(1, BAR_LEFT + 90);
                spawnEmpty(2, BAR_LEFT + 60);
                pourMug();
                draw();
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the animation loop runs without errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => startGame());
            await page.waitForTimeout(400);
            expect(errors).toEqual([]);
        });
    });
});
