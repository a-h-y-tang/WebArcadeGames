const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Pengo', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.removeItem('pengo-best'); } catch (e) {}
        });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Pengo', async ({ page }) => {
            await expect(page).toHaveTitle('Pengo');
        });

        test('canvas has the documented dimensions', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '468');
            await expect(canvas).toHaveAttribute('height', '468');
        });

        test('the field is 13 rows by 13 columns', async ({ page }) => {
            const dims = await page.evaluate(() => ({ rows: grid.length, cols: grid[0].length }));
            expect(dims).toEqual({ rows: 13, cols: 13 });
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('score, lives and level start at 0 / 3 / 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('the Start button begins play with a penguin and enemies', async ({ page }) => {
            await page.locator('#btn-start').click();
            const res = await page.evaluate(() => ({
                state,
                hasPlayer: !!player,
                enemies: enemies.filter(e => e.alive).length,
                hasBlocks: grid.flat().some(v => v === ICE),
            }));
            expect(res.state).toBe('playing');
            expect(res.hasPlayer).toBe(true);
            expect(res.enemies).toBeGreaterThan(0);
            expect(res.hasBlocks).toBe(true);
        });

        test('an arrow key dismisses the overlay and starts play', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // Movement and pushing
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('the penguin steps into an empty cell', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                enemies = [];
                player.r = 6; player.c = 6;
                const moved = movePlayer(-1, 0); // up
                return { moved, r: player.r, c: player.c };
            });
            expect(res.moved).toBe(true);
            expect(res).toMatchObject({ r: 5, c: 6 });
        });

        test('the penguin cannot walk off the field (wall)', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                enemies = [];
                player.r = 0; player.c = 6;
                const moved = movePlayer(-1, 0); // into the top wall
                return { moved, r: player.r };
            });
            expect(res.moved).toBe(false);
            expect(res.r).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pushing / sliding blocks
    // -----------------------------------------------------------------------
    test.describe('pushing blocks', () => {
        test('pushing an ice block slides it to the far wall', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                enemies = [];
                grid[6][6] = ICE;
                player.r = 6; player.c = 7;
                const moved = movePlayer(0, -1); // push left
                return {
                    moved,
                    atWall: grid[6][0], oldCell: grid[6][6],
                    pr: player.r, pc: player.c,
                };
            });
            expect(res.moved).toBe(true);
            expect(res.atWall).toBe(1);   // ICE slid to column 0
            expect(res.oldCell).toBe(0);  // vacated
            expect(res).toMatchObject({ pr: 6, pc: 6 });
        });

        test('an ice block with no room to slide breaks', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                enemies = [];
                grid[6][0] = ICE;         // already against the left wall
                player.r = 6; player.c = 1;
                const moved = movePlayer(0, -1); // push left into the wall
                return { moved, cell: grid[6][0], pc: player.c };
            });
            expect(res.moved).toBe(false);
            expect(res.cell).toBe(0);   // ice broke and vanished
            expect(res.pc).toBe(1);     // penguin stayed put
        });

        test('a diamond block with no room to slide does not break', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                enemies = [];
                grid[6][0] = DIAMOND;     // against the left wall
                player.r = 6; player.c = 1;
                const moved = movePlayer(0, -1);
                return { moved, cell: grid[6][0], pc: player.c };
            });
            expect(res.moved).toBe(false);
            expect(res.cell).toBe(2);   // diamond survives
            expect(res.pc).toBe(1);
        });

        test('pushBlock stops a slide against another block', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                enemies = [];
                grid[6][6] = ICE;
                grid[6][2] = ICE;   // a wall for the slide
                player.r = 6; player.c = 7;
                movePlayer(0, -1); // push the (6,6) block left
                return { rest: grid[6][3], vacated: grid[6][6], blocker: grid[6][2] };
            });
            expect(res.rest).toBe(1);     // block came to rest just right of the blocker
            expect(res.vacated).toBe(0);
            expect(res.blocker).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Crushing enemies with a sliding block
    // -----------------------------------------------------------------------
    test.describe('crushing', () => {
        test('a sliding block crushes a Sno-Bee in its path', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                grid[6][6] = ICE;
                // Two enemies so clearing one does not complete the level.
                enemies = [{ r: 6, c: 3, alive: true }, { r: 0, c: 0, alive: true }];
                player.r = 6; player.c = 7;
                const before = score;
                movePlayer(0, -1); // slide the block left across the enemy at (6,3)
                return {
                    victimAlive: enemies[0].alive,
                    survivorAlive: enemies[1].alive,
                    scoreUp: score > before,
                    rest: grid[6][0],
                };
            });
            expect(res.victimAlive).toBe(false);
            expect(res.survivorAlive).toBe(true);
            expect(res.scoreUp).toBe(true);
            expect(res.rest).toBe(1);   // block slid on through to the wall
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('enemyAt reports a living Sno-Bee at a cell', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                enemies = [{ r: 4, c: 5, alive: true }];
                return { hit: enemyAt(4, 5), miss: enemyAt(0, 0) };
            });
            expect(res.hit).toBe(0);   // index of the enemy
            expect(res.miss).toBe(-1);
        });

        test('enemyStep moves a Sno-Bee closer to the penguin', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                enemies = [{ r: 1, c: 1, alive: true }];
                player.r = 8; player.c = 8;
                const before = Math.abs(1 - 8) + Math.abs(1 - 8);
                enemyStep();
                const after = Math.abs(enemies[0].r - 8) + Math.abs(enemies[0].c - 8);
                return { before, after };
            });
            expect(res.after).toBeLessThan(res.before);
        });

        test('a Sno-Bee cannot step into a block', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                enemies = [{ r: 1, c: 1, alive: true }];
                player.r = 1; player.c = 8;      // straight to the right
                grid[1][2] = ICE;                // block the only reducing move
                enemyStep();
                return { r: enemies[0].r, c: enemies[0].c };
            });
            expect(res).toMatchObject({ r: 1, c: 1 }); // stuck, did not enter the block
        });

        test('a Sno-Bee stepping onto the penguin costs a life', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                const before = lives;
                enemies = [{ r: 5, c: 4, alive: true }];
                player.r = 5; player.c = 5;      // enemy is one step to the left
                enemyStep();
                return { before, after: lives };
            });
            expect(res.after).toBe(res.before - 1);
        });

        test('walking onto a Sno-Bee costs a life', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                const before = lives;
                enemies = [{ r: 5, c: 6, alive: true }];
                player.r = 5; player.c = 5;
                movePlayer(0, 1); // step right onto the enemy
                return { before, after: lives };
            });
            expect(res.after).toBe(res.before - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Diamonds
    // -----------------------------------------------------------------------
    test.describe('diamonds', () => {
        test('diamondsAligned is true for three in a consecutive row', async ({ page }) => {
            const aligned = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                grid[5][4] = DIAMOND; grid[5][5] = DIAMOND; grid[5][6] = DIAMOND;
                return diamondsAligned();
            });
            expect(aligned).toBe(true);
        });

        test('diamondsAligned is false when they are scattered', async ({ page }) => {
            const aligned = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                grid[5][4] = DIAMOND; grid[5][6] = DIAMOND; grid[8][4] = DIAMOND;
                return diamondsAligned();
            });
            expect(aligned).toBe(false);
        });

        test('sliding the last diamond into line awards a bonus', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                enemies = [];
                grid[5][4] = DIAMOND; grid[5][5] = DIAMOND; grid[5][7] = DIAMOND;
                player.r = 5; player.c = 8;
                const before = score;
                movePlayer(0, -1); // push (5,7) diamond left; it rests at (5,6) → aligned
                return {
                    aligned: diamondsAligned(),
                    scoreUp: score - before,
                };
            });
            expect(res.aligned).toBe(true);
            expect(res.scoreUp).toBeGreaterThanOrEqual(500);
        });
    });

    // -----------------------------------------------------------------------
    // Level clear and game over
    // -----------------------------------------------------------------------
    test.describe('progression', () => {
        test('crushing the last Sno-Bee clears the level and advances', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                grid[6][6] = ICE;
                enemies = [{ r: 6, c: 3, alive: true }];
                player.r = 6; player.c = 7;
                const beforeLevel = level;
                movePlayer(0, -1); // crush the only enemy
                return { beforeLevel, afterLevel: level, cleared: enemies.filter(e => e.alive).length };
            });
            expect(res.afterLevel).toBe(res.beforeLevel + 1);
        });

        test('losing the last life ends the game and shows the overlay', async ({ page }) => {
            await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                lives = 1;
                score = 250;
                enemies = [{ r: 5, c: 4, alive: true }];
                player.r = 5; player.c = 5;
                enemyStep(); // enemy walks onto the penguin → last life lost
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay')).toContainText(/over/i);
        });

        test('a new best score is persisted on game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                lives = 1;
                score = 777;
                enemies = [{ r: 5, c: 4, alive: true }];
                player.r = 5; player.c = 5;
                enemyStep();
            });
            const stored = await page.evaluate(() => Number(localStorage.getItem('pengo-best')));
            expect(stored).toBe(777);
        });
    });

    // -----------------------------------------------------------------------
    // Reset
    // -----------------------------------------------------------------------
    test.describe('reset', () => {
        test('pressing R restarts to a fresh playing game', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 999; lives = 1; level = 5;
            });
            await page.keyboard.press('r');
            const res = await page.evaluate(() => ({ score, lives, level, state }));
            expect(res).toMatchObject({ score: 0, lives: 3, level: 1, state: 'playing' });
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard input
    // -----------------------------------------------------------------------
    test.describe('input', () => {
        test('ArrowRight moves the penguin right into empty space', async ({ page }) => {
            await page.evaluate(() => {
                startGame(); stopLoop();
                grid = grid.map(row => row.map(() => EMPTY));
                enemies = [];
                player.r = 6; player.c = 6;
            });
            await page.keyboard.press('ArrowRight');
            const c = await page.evaluate(() => player.c);
            expect(c).toBe(7);
        });
    });
});
