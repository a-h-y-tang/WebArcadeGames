const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Pixel centre of cell (r, c) for click-based tests.
async function cellCentre(page, r, c) {
    return page.evaluate(([r, c]) => {
        return { x: MARGIN + c * cell + cell / 2, y: MARGIN + r * cell + cell / 2 };
    }, [r, c]);
}

test.describe('Hitori', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Hitori', async ({ page }) => {
            await expect(page).toHaveTitle('Hitori');
        });

        test('canvas is 420x420', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '420');
            await expect(canvas).toHaveAttribute('height', '420');
        });

        test('first puzzle (A) loads, 5x5, nothing shaded', async ({ page }) => {
            expect(await page.evaluate(() => N)).toBe(5);
            expect(await page.evaluate(() => PUZZLES[puzzleIndex].id)).toBe('A');
            const anyShaded = await page.evaluate(() => shade.flat().some(v => v === BLACK));
            expect(anyShaded).toBe(false);
        });

        test('an unshaded board is not solved', async ({ page }) => {
            expect(await page.evaluate(() => solved)).toBe(false);
        });

        test('the puzzle label shows A', async ({ page }) => {
            await expect(page.locator('#puzzle-label')).toHaveText('A');
        });

        test('the solved overlay is hidden at start', async ({ page }) => {
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Pure rule functions
    // -----------------------------------------------------------------------
    test.describe('rule: duplicate whites', () => {
        test('flags a repeated value in a row among white cells', async ({ page }) => {
            const size = await page.evaluate(() => {
                const g = [[1, 1], [2, 3]];
                const s = [[0, 0], [0, 0]];
                return duplicateWhites(g, s).size;
            });
            expect(size).toBe(2); // both 1s flagged
        });

        test('a shaded duplicate is not counted', async ({ page }) => {
            const size = await page.evaluate(() => {
                const g = [[1, 1], [2, 3]];
                const s = [[0, 1], [0, 0]]; // shade the second 1
                return duplicateWhites(g, s).size;
            });
            expect(size).toBe(0);
        });

        test('flags a repeated value down a column', async ({ page }) => {
            const size = await page.evaluate(() => {
                const g = [[5, 2], [5, 3]];
                const s = [[0, 0], [0, 0]];
                return duplicateWhites(g, s).size;
            });
            expect(size).toBe(2);
        });
    });

    test.describe('rule: adjacent blacks', () => {
        test('flags two horizontally adjacent blacks', async ({ page }) => {
            const size = await page.evaluate(() => {
                const s = [[1, 1], [0, 0]];
                return adjacentBlacks(s).size;
            });
            expect(size).toBe(2);
        });

        test('flags two vertically adjacent blacks', async ({ page }) => {
            const size = await page.evaluate(() => {
                const s = [[1, 0], [1, 0]];
                return adjacentBlacks(s).size;
            });
            expect(size).toBe(2);
        });

        test('diagonally adjacent blacks are allowed', async ({ page }) => {
            const size = await page.evaluate(() => {
                const s = [[1, 0], [0, 1]];
                return adjacentBlacks(s).size;
            });
            expect(size).toBe(0);
        });
    });

    test.describe('rule: whites connected', () => {
        test('a fully white board is connected', async ({ page }) => {
            const ok = await page.evaluate(() => whitesConnected([[0, 0], [0, 0]]));
            expect(ok).toBe(true);
        });

        test('a board split by shading is not connected', async ({ page }) => {
            // Column of blacks down the middle isolates left from right.
            const ok = await page.evaluate(() => whitesConnected([
                [0, 1, 0],
                [0, 1, 0],
                [0, 1, 0],
            ]));
            expect(ok).toBe(false);
        });

        test('an all-black board is not a valid (connected) solution', async ({ page }) => {
            const ok = await page.evaluate(() => whitesConnected([[1, 1], [1, 1]]));
            expect(ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Shipped puzzle solutions
    // -----------------------------------------------------------------------
    test.describe('shipped solutions are valid', () => {
        test('every puzzle solution satisfies all three rules', async ({ page }) => {
            const results = await page.evaluate(() =>
                PUZZLES.map(p => isSolved(p.grid, p.solution)));
            expect(results).toEqual([true, true, true]);
        });

        test('applying puzzle A solution marks the board solved', async ({ page }) => {
            const isSolvedFlag = await page.evaluate(() => {
                shade = PUZZLES[0].solution.map(row => row.slice());
                solved = isSolved(grid, shade);
                return solved;
            });
            expect(isSolvedFlag).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Interaction
    // -----------------------------------------------------------------------
    test.describe('interaction', () => {
        test('clicking a cell shades it, clicking again clears it', async ({ page }) => {
            const pt = await cellCentre(page, 0, 2);
            await page.locator('#canvas').click({ position: { x: pt.x, y: pt.y } });
            expect(await page.evaluate(() => shade[0][2])).toBe(1);
            await page.locator('#canvas').click({ position: { x: pt.x, y: pt.y } });
            expect(await page.evaluate(() => shade[0][2])).toBe(0);
        });

        test('solving via clicks shows the solved overlay and locks the board', async ({ page }) => {
            // Click every cell in puzzle A's solution.
            const cells = await page.evaluate(() => {
                const out = [];
                const sol = PUZZLES[0].solution;
                for (let r = 0; r < sol.length; r++)
                    for (let c = 0; c < sol.length; c++)
                        if (sol[r][c] === 1) out.push([r, c, MARGIN + c * cell + cell / 2, MARGIN + r * cell + cell / 2]);
                return out;
            });
            for (const [, , x, y] of cells) {
                await page.locator('#canvas').click({ position: { x, y } });
            }
            expect(await page.evaluate(() => solved)).toBe(true);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#status')).toHaveText(/solved/i);

            // Board is locked once solved: toggleCell is a no-op (and the
            // overlay covers the canvas so clicks can't reach it anyway).
            const before = await page.evaluate(() => JSON.stringify(shade));
            await page.evaluate(() => toggleCell(0, 0));
            const after = await page.evaluate(() => JSON.stringify(shade));
            expect(after).toBe(before);
        });

        test('Reset clears all shading', async ({ page }) => {
            await page.evaluate(() => { shade[0][0] = BLACK; shade[1][2] = BLACK; render(); });
            await page.locator('#btn-reset').click();
            const anyShaded = await page.evaluate(() => shade.flat().some(v => v === BLACK));
            expect(anyShaded).toBe(false);
        });

        test('New Puzzle advances to the next puzzle and clears the board', async ({ page }) => {
            await page.evaluate(() => { shade[0][0] = BLACK; render(); });
            await page.locator('#btn-new').click();
            await expect(page.locator('#puzzle-label')).toHaveText('B');
            const anyShaded = await page.evaluate(() => shade.flat().some(v => v === BLACK));
            expect(anyShaded).toBe(false);
        });

        test('New Puzzle wraps around back to A after the last puzzle', async ({ page }) => {
            await page.locator('#btn-new').click(); // A -> B
            await page.locator('#btn-new').click(); // B -> C
            await page.locator('#btn-new').click(); // C -> A
            await expect(page.locator('#puzzle-label')).toHaveText('A');
        });
    });
});
