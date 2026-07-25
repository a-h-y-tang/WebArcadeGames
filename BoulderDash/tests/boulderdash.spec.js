const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Build a clean COLS×ROWS grid of a single tile so a test can carve an exact
// scenario, then return it (used inside page.evaluate).
const FILL = `(code) => {
    for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++)
            grid[y][x] = code;
}`;

test.describe('Boulder Dash', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Boulder Dash', async ({ page }) => {
            await expect(page).toHaveTitle('Boulder Dash');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('diamond');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('collected count starts at 0', async ({ page }) => {
            await expect(page.locator('#collected')).toHaveText('0');
        });

        test('the target is shown in the HUD', async ({ page }) => {
            const req = await page.evaluate(() => DIAMONDS_REQUIRED);
            await expect(page.locator('#required')).toHaveText(String(req));
        });

        test('canvas matches the grid size', async ({ page }) => {
            const r = await page.evaluate(() => ({ w: canvas.width, h: canvas.height, C: COLS, R: ROWS, T: TILE }));
            expect(r.w).toBe(r.C * r.T);
            expect(r.h).toBe(r.R * r.T);
        });

        test('the grid is COLS×ROWS', async ({ page }) => {
            const r = await page.evaluate(() => ({ rows: grid.length, cols: grid[0].length, C: COLS, R: ROWS }));
            expect(r.rows).toBe(r.R);
            expect(r.cols).toBe(r.C);
        });

        test('the border is solid wall', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let x = 0; x < COLS; x++)
                    if (grid[0][x] !== WALL || grid[ROWS - 1][x] !== WALL) return false;
                for (let y = 0; y < ROWS; y++)
                    if (grid[y][0] !== WALL || grid[y][COLS - 1] !== WALL) return false;
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the player starts inside the board', async ({ page }) => {
            const r = await page.evaluate(() => ({ x: player.x, y: player.y, C: COLS, R: ROWS }));
            expect(r.x).toBeGreaterThan(0);
            expect(r.y).toBeGreaterThan(0);
            expect(r.x).toBeLessThan(r.C - 1);
            expect(r.y).toBeLessThan(r.R - 1);
        });

        test('the level contains boulders and diamonds', async ({ page }) => {
            const r = await page.evaluate(() => {
                let b = 0, d = 0;
                for (let y = 0; y < ROWS; y++)
                    for (let x = 0; x < COLS; x++) {
                        if (grid[y][x] === BOULDER) b++;
                        if (grid[y][x] === DIAMOND) d++;
                    }
                return { b, d };
            });
            expect(r.b).toBeGreaterThan(0);
            expect(r.d).toBeGreaterThanOrEqual(await page.evaluate(() => DIAMONDS_REQUIRED));
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Movement and digging
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('moving into dirt digs it and advances the player', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate((fill) => {
                eval('(' + fill + ')')(DIRT);
                player.x = 5; player.y = 5;
                movePlayer(1, 0);
                return { px: player.x, py: player.y, tile: grid[5][6] };
            }, FILL);
            expect(r.px).toBe(6);
            expect(r.py).toBe(5);
            expect(r.tile).toBe(await page.evaluate(() => EMPTY)); // dug out
        });

        test('moving into empty space just moves', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                player.x = 5; player.y = 5;
                movePlayer(0, 1);
                return { px: player.x, py: player.y };
            }, FILL);
            expect(r.px).toBe(5);
            expect(r.py).toBe(6);
        });

        test('walking into a wall is blocked', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                player.x = 5; player.y = 5;
                grid[5][6] = WALL;
                movePlayer(1, 0);
                return { px: player.x, py: player.y };
            }, FILL);
            expect(r.px).toBe(5); // did not move
            expect(r.py).toBe(5);
        });

        test('collecting a diamond raises the count and the score', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                player.x = 5; player.y = 5;
                collected = 0; score = 0;
                grid[5][6] = DIAMOND;
                movePlayer(1, 0);
                return { collected, score, tile: grid[5][6], px: player.x };
            }, FILL);
            expect(r.collected).toBe(1);
            expect(r.score).toBe(await page.evaluate(() => DIAMOND_POINTS));
            expect(r.tile).toBe(await page.evaluate(() => EMPTY));
            expect(r.px).toBe(6);
        });

        test('movement is ignored when the game is not running', async ({ page }) => {
            const r = await page.evaluate((fill) => {
                state = 'ready';
                eval('(' + fill + ')')(EMPTY);
                player.x = 5; player.y = 5;
                movePlayer(1, 0);
                return { px: player.x, py: player.y };
            }, FILL);
            expect(r.px).toBe(5);
            expect(r.py).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Pushing boulders
    // -----------------------------------------------------------------------
    test.describe('pushing boulders', () => {
        test('a boulder is pushed sideways into empty space', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                player.x = 5; player.y = 5;
                grid[5][6] = BOULDER;   // to the right
                grid[5][7] = EMPTY;     // space beyond
                movePlayer(1, 0);
                return { px: player.x, b6: grid[5][6], b7: grid[5][7] };
            }, FILL);
            expect(r.px).toBe(6);                                   // player advanced
            expect(r.b7).toBe(await page.evaluate(() => BOULDER));  // boulder shoved along
            expect(r.b6).toBe(await page.evaluate(() => EMPTY));
        });

        test('a boulder with no room behind it will not move', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                player.x = 5; player.y = 5;
                grid[5][6] = BOULDER;
                grid[5][7] = WALL;      // blocked beyond
                movePlayer(1, 0);
                return { px: player.x, b6: grid[5][6] };
            }, FILL);
            expect(r.px).toBe(5);                                   // player blocked
            expect(r.b6).toBe(await page.evaluate(() => BOULDER));  // boulder unmoved
        });

        test('boulders cannot be pushed vertically', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                player.x = 5; player.y = 5;
                grid[6][5] = BOULDER;   // directly below
                grid[7][5] = EMPTY;
                movePlayer(0, 1);
                return { py: player.y, b6: grid[6][5] };
            }, FILL);
            expect(r.py).toBe(5);                                   // blocked
            expect(r.b6).toBe(await page.evaluate(() => BOULDER));
        });
    });

    // -----------------------------------------------------------------------
    // Falling physics
    // -----------------------------------------------------------------------
    test.describe('falling physics', () => {
        test('a boulder with empty space below falls one cell per step', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                player.x = 1; player.y = 1;
                grid[5][8] = BOULDER;
                step();
                return { at5: grid[5][8], at6: grid[6][8] };
            }, FILL);
            expect(r.at5).toBe(await page.evaluate(() => EMPTY));
            expect(r.at6).toBe(await page.evaluate(() => BOULDER));
        });

        test('a boulder resting on dirt does not fall', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                player.x = 1; player.y = 1;
                grid[5][8] = BOULDER;
                grid[6][8] = DIRT;
                step();
                return { at5: grid[5][8] };
            }, FILL);
            expect(r.at5).toBe(await page.evaluate(() => BOULDER)); // stayed put
        });

        test('a diamond falls just like a boulder', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                player.x = 1; player.y = 1;
                grid[4][10] = DIAMOND;
                step();
                return { at4: grid[4][10], at5: grid[5][10] };
            }, FILL);
            expect(r.at4).toBe(await page.evaluate(() => EMPTY));
            expect(r.at5).toBe(await page.evaluate(() => DIAMOND));
        });

        test('a boulder rolls off another boulder into an empty diagonal', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate((fill) => {
                eval('(' + fill + ')')(WALL);  // everything solid...
                player.x = 1; player.y = 1;
                grid[1][1] = EMPTY;            // ...keep the player legal
                grid[5][8] = BOULDER;          // the roller
                grid[6][8] = BOULDER;          // resting on a boulder
                grid[5][7] = EMPTY;            // empty to the left
                grid[6][7] = EMPTY;            // empty below-left
                step();
                return { at8: grid[5][8], at7: grid[5][7] };
            }, FILL);
            expect(r.at8).toBe(await page.evaluate(() => EMPTY));
            expect(r.at7).toBe(await page.evaluate(() => BOULDER)); // rolled left
        });

        test('a boulder falling onto the player ends the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                player.x = 8; player.y = 7;
                grid[5][8] = BOULDER;   // two cells above the player, empty between
                step();                 // boulder → (6,8), now falling
                step();                 // boulder → onto the player
                return state;
            }, FILL);
            expect(s).toBe('over');
        });

        test('standing under a resting boulder is safe', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                player.x = 8; player.y = 6;
                grid[5][8] = BOULDER;   // directly above the player, nothing between
                step();
                step();
                return { state, at5: grid[5][8] };
            }, FILL);
            expect(r.state).toBe('running');                          // not crushed
            expect(r.at5).toBe(await page.evaluate(() => BOULDER));   // boulder held in place
        });
    });

    // -----------------------------------------------------------------------
    // The exit and winning
    // -----------------------------------------------------------------------
    test.describe('the exit', () => {
        test('the exit is locked until enough diamonds are collected', async ({ page }) => {
            const open = await page.evaluate(() => { collected = 0; return exitOpen(); });
            expect(open).toBe(false);
        });

        test('collecting the target opens the exit', async ({ page }) => {
            const open = await page.evaluate(() => { collected = DIAMONDS_REQUIRED; return exitOpen(); });
            expect(open).toBe(true);
        });

        test('walking into a locked exit is blocked', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                collected = 0;
                player.x = 5; player.y = 5;
                grid[5][6] = EXIT;
                movePlayer(1, 0);
                return { px: player.x, state };
            }, FILL);
            expect(r.px).toBe(5);          // blocked
            expect(r.state).toBe('running');
        });

        test('reaching an open exit wins the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                collected = DIAMONDS_REQUIRED;
                player.x = 5; player.y = 5;
                grid[5][6] = EXIT;
                movePlayer(1, 0);
                return state;
            }, FILL);
            expect(s).toBe('won');
        });

        test('winning shows a victory overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => win());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Escaped');
        });
    });

    // -----------------------------------------------------------------------
    // Game over and restart
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('game over shows the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => gameOver());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('the Start button becomes Play Again after a game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => gameOver());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets score, collected and state', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 300; collected = 4; gameOver(); });
            await page.locator('#btn-start').click();
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#collected')).toHaveText('0');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('a new best score is recorded and persisted', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 175; win(); });
            await expect(page.locator('#best')).toHaveText('175');
            const stored = await page.evaluate(() => localStorage.getItem('boulderdash-best'));
            expect(parseInt(stored, 10)).toBe(175);
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('pause overlay shows "Paused"', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('physics do not advance while paused', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate((fill) => {
                eval('(' + fill + ')')(EMPTY);
                player.x = 1; player.y = 1;
                grid[5][8] = BOULDER;   // would fall if physics ran
            }, FILL);
            await page.keyboard.press('p'); // pause
            const before = await page.evaluate(() => grid[5][8]);
            await page.waitForTimeout(400);
            const after = await page.evaluate(() => grid[5][8]);
            expect(after).toBe(before); // unmoved
        });
    });
});
