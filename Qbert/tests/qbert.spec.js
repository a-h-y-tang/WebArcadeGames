const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start a fresh game and suspend the automatic enemy spawner so hopping /
// colouring tests are fully deterministic.
async function startDeterministic(page) {
    await page.locator('#btn-start').click();
    await page.evaluate(() => { autoSpawn = false; enemies.length = 0; });
    await expect.poll(() => page.evaluate(() => state)).toBe('running');
}

test.describe('Q*bert', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Q*bert', async ({ page }) => {
            await expect(page).toHaveTitle('Q*bert');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('lives start at 3', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 620×560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '620');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('the pyramid has 7 rows and 28 cubes', async ({ page }) => {
            const info = await page.evaluate(() => ({
                rows: ROWS,
                total: cubes.reduce((n, row) => n + row.length, 0),
            }));
            expect(info.rows).toBe(7);
            expect(info.total).toBe(28);
        });

        test('Q*bert starts on the apex cube', async ({ page }) => {
            const q = await page.evaluate(() => ({ r: qbert.r, c: qbert.c }));
            expect(q).toEqual({ r: 0, c: 0 });
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Geometry helpers
    // -----------------------------------------------------------------------
    test.describe('neighbours and bounds', () => {
        test('inBounds accepts on-pyramid cells and rejects off-pyramid ones', async ({ page }) => {
            const r = await page.evaluate(() => ({
                apex: inBounds(0, 0),
                bottomLeft: inBounds(6, 0),
                bottomRight: inBounds(6, 6),
                negRow: inBounds(-1, 0),
                negCol: inBounds(1, -1),
                pastEdge: inBounds(2, 3),
                tooDeep: inBounds(7, 0),
            }));
            expect(r).toEqual({
                apex: true, bottomLeft: true, bottomRight: true,
                negRow: false, negCol: false, pastEdge: false, tooDeep: false,
            });
        });

        test('neighborOf computes the four diagonals', async ({ page }) => {
            const n = await page.evaluate(() => ({
                ul: neighborOf(3, 2, 'upLeft'),
                ur: neighborOf(3, 2, 'upRight'),
                dl: neighborOf(3, 2, 'downLeft'),
                dr: neighborOf(3, 2, 'downRight'),
            }));
            expect(n.ul).toEqual({ r: 2, c: 1 });
            expect(n.ur).toEqual({ r: 2, c: 2 });
            expect(n.dl).toEqual({ r: 4, c: 2 });
            expect(n.dr).toEqual({ r: 4, c: 3 });
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('a hop key dismisses the overlay and starts running', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the apex cube is coloured once the game starts', async ({ page }) => {
            await startDeterministic(page);
            const info = await page.evaluate(() => ({
                apex: cubes[0][0],
                target: TARGET,
                completed: completedCount(),
            }));
            expect(info.apex).toBe(info.target);
            expect(info.completed).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Hopping & colouring
    // -----------------------------------------------------------------------
    test.describe('hopping', () => {
        test('ArrowDown hops down-left', async ({ page }) => {
            await startDeterministic(page);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => ({ r: qbert.r, c: qbert.c }))).toEqual({ r: 1, c: 0 });
        });

        test('ArrowRight hops down-right', async ({ page }) => {
            await startDeterministic(page);
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => ({ r: qbert.r, c: qbert.c }))).toEqual({ r: 1, c: 1 });
        });

        test('ArrowUp hops up-right (back toward the apex)', async ({ page }) => {
            await startDeterministic(page);
            await page.evaluate(() => { qbert.r = 2; qbert.c = 1; });
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => ({ r: qbert.r, c: qbert.c }))).toEqual({ r: 1, c: 1 });
        });

        test('ArrowLeft hops up-left', async ({ page }) => {
            await startDeterministic(page);
            await page.evaluate(() => { qbert.r = 2; qbert.c = 1; });
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => ({ r: qbert.r, c: qbert.c }))).toEqual({ r: 1, c: 0 });
        });

        test('landing on a fresh cube colours it and scores 25', async ({ page }) => {
            await startDeterministic(page);
            await page.keyboard.press('ArrowDown'); // to (1,0)
            const info = await page.evaluate(() => ({ cube: cubes[1][0], target: TARGET }));
            expect(info.cube).toBe(info.target);
            await expect(page.locator('#score')).toHaveText('25');
        });

        test('re-landing on a coloured cube does not score again', async ({ page }) => {
            await startDeterministic(page);
            await page.keyboard.press('ArrowDown'); // (1,0), score 25
            await page.keyboard.press('ArrowUp');   // back to apex (already coloured)
            await page.keyboard.press('ArrowDown'); // (1,0) again — already coloured
            await expect(page.locator('#score')).toHaveText('25');
        });
    });

    // -----------------------------------------------------------------------
    // Falling off the edge
    // -----------------------------------------------------------------------
    test.describe('falling off the pyramid', () => {
        test('hopping off the edge costs a life and respawns on the apex', async ({ page }) => {
            await startDeterministic(page);
            await page.keyboard.press('ArrowLeft'); // up-left from apex -> off the board
            await expect(page.locator('#lives')).toHaveText('2');
            expect(await page.evaluate(() => ({ r: qbert.r, c: qbert.c }))).toEqual({ r: 0, c: 0 });
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('running out of lives ends the game', async ({ page }) => {
            await startDeterministic(page);
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowLeft');
            await expect(page.locator('#lives')).toHaveText('0');
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('spawnEnemy adds a red ball to the board', async ({ page }) => {
            await startDeterministic(page);
            await page.evaluate(() => spawnEnemy(1, 0));
            expect(await page.evaluate(() => enemies.length)).toBe(1);
        });

        test('hopping onto an enemy costs a life', async ({ page }) => {
            await startDeterministic(page);
            await page.evaluate(() => spawnEnemy(1, 0)); // ball sits on (1,0)
            await page.keyboard.press('ArrowDown');      // Q*bert hops onto (1,0)
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Winning a level
    // -----------------------------------------------------------------------
    test.describe('completing a level', () => {
        test('colouring the final cube wins the level', async ({ page }) => {
            await startDeterministic(page);
            // Colour every cube except (1,0), then hop onto it.
            await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c <= r; c++) cubes[r][c] = TARGET;
                cubes[1][0] = 0;
                qbert.r = 0; qbert.c = 0;
            });
            await page.keyboard.press('ArrowDown'); // hop onto (1,0) — the last one
            expect(await page.evaluate(() => completedCount())).toBe(28);
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText('Complete');
        });

        test('continuing advances to the next level with a fresh pyramid', async ({ page }) => {
            await startDeterministic(page);
            await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c <= r; c++) cubes[r][c] = TARGET;
                cubes[1][0] = 0;
                qbert.r = 0; qbert.c = 0;
            });
            await page.keyboard.press('ArrowDown');
            await expect.poll(() => page.evaluate(() => state)).toBe('won');
            await page.locator('#btn-start').click(); // "Continue"
            await expect(page.locator('#level')).toHaveText('2');
            expect(await page.evaluate(() => completedCount())).toBe(1); // only the apex
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses the game and shows the pause overlay', async ({ page }) => {
            await startDeterministic(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await startDeterministic(page);
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Q*bert cannot hop while paused', async ({ page }) => {
            await startDeterministic(page);
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ r: qbert.r, c: qbert.c }));
            await page.keyboard.press('ArrowDown');
            const after = await page.evaluate(() => ({ r: qbert.r, c: qbert.c }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Restarting
    // -----------------------------------------------------------------------
    test.describe('restarting after game over', () => {
        test('a key press restarts the game from a clean slate', async ({ page }) => {
            await startDeterministic(page);
            await page.keyboard.press('ArrowDown'); // score 25
            await page.evaluate(() => { lives = 1; });
            await page.keyboard.press('ArrowLeft');  // fall -> lives 0 -> over
            await expect.poll(() => page.evaluate(() => state)).toBe('over');
            await page.keyboard.press('ArrowDown');  // restart
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });
});
