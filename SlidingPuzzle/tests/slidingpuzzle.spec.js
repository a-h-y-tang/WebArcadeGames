const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Read/write game globals through the page.
const getTiles = (page) => page.evaluate(() => tiles.slice());
const setTiles = (page, arr) => page.evaluate((a) => { setBoard(a); }, arr);
const getMoves = (page) => page.evaluate(() => moves);

// A board that is one move from solved: goal, but the last two cells swapped
// so the blank sits at index 14 and tile 15 sits at index 15.
const ALMOST = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15];
const GOAL_ARR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0];

test.describe('Sliding Puzzle', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state / scaffolding
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Sliding Puzzle', async ({ page }) => {
            await expect(page).toHaveTitle('Sliding Puzzle');
        });

        test('canvas is 480x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('grid size is 4 with 16 cells', async ({ page }) => {
            const { size, count } = await page.evaluate(() => ({ size: SIZE, count: tiles.length }));
            expect(size).toBe(4);
            expect(count).toBe(16);
        });

        test('goal is numbers in order with blank last', async ({ page }) => {
            const goal = await page.evaluate(() => GOAL.slice());
            expect(goal).toEqual(GOAL_ARR);
        });

        test('move counter starts at 0', async ({ page }) => {
            await expect(page.locator('#moves')).toHaveText('0');
        });

        test('a new game contains every number 0..15 exactly once', async ({ page }) => {
            const sorted = (await getTiles(page)).slice().sort((a, b) => a - b);
            expect(sorted).toEqual([...Array(16).keys()]);
        });

        test('a new game is not already solved', async ({ page }) => {
            expect(await page.evaluate(() => isSolved())).toBe(false);
        });

        test('a new game is solvable (inversion parity)', async ({ page }) => {
            const solvable = await page.evaluate(() => {
                // Standard 4x4 solvability test.
                const flat = tiles.filter((n) => n !== 0);
                let inv = 0;
                for (let i = 0; i < flat.length; i++)
                    for (let j = i + 1; j < flat.length; j++)
                        if (flat[i] > flat[j]) inv++;
                const blankIndex = tiles.indexOf(0);
                const blankRowFromBottom = SIZE - Math.floor(blankIndex / SIZE);
                // For even width, the solved board has (inv + blankRowFromBottom)
                // odd (0 + 1); a solvable board shares that parity.
                return (inv + blankRowFromBottom) % 2 === 1;
            });
            expect(solvable).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Movement mechanics
    // -----------------------------------------------------------------------
    test.describe('moveTile', () => {
        test('slides a tile adjacent to the blank', async ({ page }) => {
            await setTiles(page, ALMOST); // blank at 14, tile 15 at 15
            await page.evaluate(() => moveTile(15)); // tile 15 slides left into blank
            expect(await getTiles(page)).toEqual(GOAL_ARR);
        });

        test('a successful move increments the counter', async ({ page }) => {
            await setTiles(page, ALMOST);
            await page.evaluate(() => moveTile(15));
            expect(await getMoves(page)).toBe(1);
        });

        test('a tile not sharing a row or column with the blank does not move', async ({ page }) => {
            // blank at index 14 (row 3, col 2). Tile at index 0 (row 0, col 0) shares neither.
            await setTiles(page, ALMOST);
            await page.evaluate(() => moveTile(0));
            expect(await getTiles(page)).toEqual(ALMOST);
            expect(await getMoves(page)).toBe(0);
        });

        test('clicking the blank itself is a no-op', async ({ page }) => {
            await setTiles(page, ALMOST);
            await page.evaluate(() => moveTile(14)); // 14 is the blank
            expect(await getTiles(page)).toEqual(ALMOST);
            expect(await getMoves(page)).toBe(0);
        });

        test('a multi-tile row slide moves every tile between target and blank', async ({ page }) => {
            // Row 3 = indices 12..15 = [13, 14, 15, 0]; blank at 15.
            // Click index 12: tiles 13,14,15 each slide one step right, blank -> 12.
            await setTiles(page, GOAL_ARR);
            await page.evaluate(() => moveTile(12));
            const t = await getTiles(page);
            expect(t.slice(12)).toEqual([0, 13, 14, 15]);
            expect(await getMoves(page)).toBe(1); // one action, even though 3 tiles moved
        });

        test('a column slide works the same way', async ({ page }) => {
            // Blank at 15 (col 3). Column 3 = indices 3,7,11,15 = [4,8,12,0].
            // Click index 3: tiles 4,8,12 slide down, blank -> 3.
            await setTiles(page, GOAL_ARR);
            await page.evaluate(() => moveTile(3));
            const t = await getTiles(page);
            expect([t[3], t[7], t[11], t[15]]).toEqual([0, 4, 8, 12]);
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard
    // -----------------------------------------------------------------------
    test.describe('keyboard', () => {
        test('ArrowRight slides the tile left of the blank rightward', async ({ page }) => {
            await setTiles(page, ALMOST); // blank at 14, tile 14(value) at 13
            await page.keyboard.press('ArrowRight');
            const t = await getTiles(page);
            expect(t[14]).toBe(14); // value 14 slid right into the gap
            expect(t[13]).toBe(0);  // gap is now where 14 was
        });

        test('ArrowDown slides the tile above the blank downward', async ({ page }) => {
            await setTiles(page, ALMOST); // blank at 14 (row3,col2); above is index 10 = value 11
            await page.keyboard.press('ArrowDown');
            const t = await getTiles(page);
            expect(t[14]).toBe(11);
            expect(t[10]).toBe(0);
        });

        test('WASD also moves tiles', async ({ page }) => {
            await setTiles(page, ALMOST);
            await page.keyboard.press('d'); // same as ArrowRight
            expect((await getTiles(page))[14]).toBe(14);
        });

        test('an arrow with no tile to pull is a no-op', async ({ page }) => {
            // blank at 14 (row 3, bottom row). ArrowUp needs a tile below -> none.
            await setTiles(page, ALMOST);
            await page.keyboard.press('ArrowUp');
            expect(await getTiles(page)).toEqual(ALMOST);
            expect(await getMoves(page)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Clicking the canvas
    // -----------------------------------------------------------------------
    test.describe('canvas clicks', () => {
        test('clicking a tile adjacent to the blank moves it', async ({ page }) => {
            await setTiles(page, ALMOST); // blank at index 14 = row 3, col 2; tile 15 at col 3
            // Click cell (row 3, col 3): center at (3*120+60, 3*120+60) = (420, 420).
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + 420, box.y + 420);
            expect(await getTiles(page)).toEqual(GOAL_ARR);
        });
    });

    // -----------------------------------------------------------------------
    // Solving
    // -----------------------------------------------------------------------
    test.describe('solving', () => {
        test('isSolved is true for the goal board', async ({ page }) => {
            await setTiles(page, GOAL_ARR);
            expect(await page.evaluate(() => isSolved())).toBe(true);
        });

        test('completing the puzzle flips state to won', async ({ page }) => {
            await setTiles(page, ALMOST);
            await page.evaluate(() => moveTile(15));
            expect(await page.evaluate(() => state)).toBe('won');
        });

        test('completing the puzzle shows the win overlay', async ({ page }) => {
            await setTiles(page, ALMOST);
            await page.evaluate(() => moveTile(15));
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Solved');
        });

        test('no moves are accepted after the puzzle is won', async ({ page }) => {
            await setTiles(page, ALMOST);
            await page.evaluate(() => moveTile(15)); // solve
            await page.keyboard.press('ArrowDown');  // should be ignored
            expect(await getTiles(page)).toEqual(GOAL_ARR);
            expect(await getMoves(page)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Best score persistence
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best starts as a dash when storage is empty', async ({ page }) => {
            await page.evaluate(() => localStorage.removeItem('sliding-puzzle-best'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('solving records the best move count', async ({ page }) => {
            await page.evaluate(() => localStorage.removeItem('sliding-puzzle-best'));
            await page.reload();
            await setTiles(page, ALMOST);
            await page.evaluate(() => moveTile(15));
            await expect(page.locator('#best')).toHaveText('1');
            const stored = await page.evaluate(() => localStorage.getItem('sliding-puzzle-best'));
            expect(stored).toBe('1');
        });
    });

    // -----------------------------------------------------------------------
    // New game
    // -----------------------------------------------------------------------
    test.describe('new game', () => {
        test('New Game button resets moves and hides the overlay', async ({ page }) => {
            await setTiles(page, ALMOST);
            await page.evaluate(() => moveTile(15)); // win
            await page.locator('#btn-new').click();
            await expect(page.locator('#moves')).toHaveText('0');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('pressing N starts a new game', async ({ page }) => {
            await setTiles(page, ALMOST);
            await page.evaluate(() => moveTile(15));
            await page.keyboard.press('n');
            expect(await page.evaluate(() => isSolved())).toBe(false);
            await expect(page.locator('#moves')).toHaveText('0');
        });
    });
});
