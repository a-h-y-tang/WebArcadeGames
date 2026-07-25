const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Fill every cell with its stored solution digit — a guaranteed win.
async function fillSolution(page) {
    await page.evaluate(() => {
        for (let r = 0; r < N; r++)
            for (let c = 0; c < N; c++)
                setValue(r, c, solutionAt(r, c));
    });
}

test.describe('Calcudoku', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // --------------------------------------------------------------- initial
    test.describe('initial state', () => {
        test('page title is Calcudoku', async ({ page }) => {
            await expect(page).toHaveTitle(/Calcudoku/i);
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('game state is idle before start', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('overlay explains the goal (rows, columns, cages)', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/row|column|cage|target/i);
        });

        test('canvas has fixed pixel dimensions', async ({ page }) => {
            const c = page.locator('#canvas');
            expect(parseInt(await c.getAttribute('width'))).toBeGreaterThan(0);
            expect(parseInt(await c.getAttribute('height'))).toBeGreaterThan(0);
        });

        test('grid is N x N', async ({ page }) => {
            const dims = await page.evaluate(() => [SOLUTION.length, SOLUTION[0].length, N]);
            expect(dims).toEqual([dims[2], dims[2], dims[2]]);
            expect(dims[2]).toBeGreaterThanOrEqual(4);
        });
    });

    // ------------------------------------------------------- puzzle integrity
    test.describe('puzzle integrity', () => {
        test('the solution is a Latin square', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let i = 0; i < N; i++) {
                    const row = new Set(), col = new Set();
                    for (let j = 0; j < N; j++) {
                        if (SOLUTION[i][j] < 1 || SOLUTION[i][j] > N) return false;
                        row.add(SOLUTION[i][j]); col.add(SOLUTION[j][i]);
                    }
                    if (row.size !== N || col.size !== N) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('cages cover every cell exactly once', async ({ page }) => {
            const res = await page.evaluate(() => {
                const seen = new Set();
                let overlap = false;
                for (const cage of CAGES)
                    for (const [r, c] of cage.cells) {
                        const k = r + ',' + c;
                        if (seen.has(k)) overlap = true;
                        seen.add(k);
                    }
                return { size: seen.size, overlap };
            });
            expect(res.overlap).toBe(false);
            expect(res.size).toBe(await page.evaluate(() => N * N));
        });

        test('every cage has a positive target and a known operator', async ({ page }) => {
            const ok = await page.evaluate(() =>
                CAGES.every(c => c.target > 0 && ['+', '-', 'x', '/', '='].includes(c.op)));
            expect(ok).toBe(true);
        });

        test('subtraction and division cages have exactly two cells', async ({ page }) => {
            const ok = await page.evaluate(() =>
                CAGES.filter(c => c.op === '-' || c.op === '/').every(c => c.cells.length === 2));
            expect(ok).toBe(true);
        });

        test('the stored solution satisfies every cage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await fillSolution(page);
            const ok = await page.evaluate(() => CAGES.every((c, i) => isCageSolved(i)));
            expect(ok).toBe(true);
        });
    });

    // ------------------------------------------------------------------ start
    test.describe('starting', () => {
        test('clicking start begins play', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('start hides the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a new game starts with an empty grid', async ({ page }) => {
            await page.locator('#btn-start').click();
            const empty = await page.evaluate(() => {
                for (let r = 0; r < N; r++)
                    for (let c = 0; c < N; c++)
                        if (valueAt(r, c) !== 0) return false;
                return true;
            });
            expect(empty).toBe(true);
        });
    });

    // ------------------------------------------------------------- data entry
    test.describe('entering digits', () => {
        test.beforeEach(async ({ page }) => { await page.locator('#btn-start').click(); });

        test('setValue writes a digit into a cell', async ({ page }) => {
            const v = await page.evaluate(() => { setValue(0, 0, 3); return valueAt(0, 0); });
            expect(v).toBe(3);
        });

        test('digits above N are ignored, and 0 clears', async ({ page }) => {
            const res = await page.evaluate(() => {
                setValue(0, 0, 2);
                setValue(0, 0, N + 1);      // out of range → ignored
                const afterBad = valueAt(0, 0);
                setValue(0, 0, 0);          // clear
                return { afterBad, cleared: valueAt(0, 0) };
            });
            expect(res.afterBad).toBe(2);
            expect(res.cleared).toBe(0);
        });

        test('typing a digit fills the selected cell', async ({ page }) => {
            await page.evaluate(() => selectCell(1, 1));
            await page.keyboard.press('3');
            expect(await page.evaluate(() => valueAt(1, 1))).toBe(3);
        });

        test('Backspace clears the selected cell', async ({ page }) => {
            await page.evaluate(() => { selectCell(2, 2); setValue(2, 2, 3); });
            await page.keyboard.press('Backspace');
            expect(await page.evaluate(() => valueAt(2, 2))).toBe(0);
        });
    });

    // -------------------------------------------------------------- selection
    test.describe('selection', () => {
        test.beforeEach(async ({ page }) => { await page.locator('#btn-start').click(); });

        test('arrow navigation stays inside the grid', async ({ page }) => {
            const inBounds = await page.evaluate(() => {
                selectCell(0, 0);
                for (const [dr, dc] of [[-1, 0], [0, -1], [1, 0], [0, 1], [1, 0], [0, 1]]) {
                    moveSelection(dr, dc);
                    if (selected.r < 0 || selected.r >= N || selected.c < 0 || selected.c >= N) return false;
                }
                return true;
            });
            expect(inBounds).toBe(true);
        });
    });

    // -------------------------------------------------------------- conflicts
    test.describe('conflict detection', () => {
        test.beforeEach(async ({ page }) => { await page.locator('#btn-start').click(); });

        test('a repeated digit in a row is flagged', async ({ page }) => {
            const flagged = await page.evaluate(() => {
                setValue(0, 0, 3);
                setValue(0, 1, 3);            // same value twice in row 0
                const s = conflictSet();
                return s.has('0,0') && s.has('0,1');
            });
            expect(flagged).toBe(true);
        });

        test('a repeated digit in a column is flagged', async ({ page }) => {
            const flagged = await page.evaluate(() => {
                setValue(0, 0, 2);
                setValue(1, 0, 2);            // same value twice in column 0
                const s = conflictSet();
                return s.has('0,0') && s.has('1,0');
            });
            expect(flagged).toBe(true);
        });

        test('a correctly filled cage has no conflicts', async ({ page }) => {
            const clean = await page.evaluate(() => {
                const cage = CAGES[0];
                cage.cells.forEach(([r, c]) => setValue(r, c, solutionAt(r, c)));
                const s = conflictSet();
                return cage.cells.every(([r, c]) => !s.has(r + ',' + c));
            });
            expect(clean).toBe(true);
        });
    });

    // -------------------------------------------------------------- solving
    test.describe('solving', () => {
        test.beforeEach(async ({ page }) => { await page.locator('#btn-start').click(); });

        test('an empty grid is not solved', async ({ page }) => {
            expect(await page.evaluate(() => isSolved())).toBe(false);
        });

        test('a partially filled grid is not solved', async ({ page }) => {
            const solved = await page.evaluate(() => { setValue(0, 0, solutionAt(0, 0)); return isSolved(); });
            expect(solved).toBe(false);
        });

        test('a full Latin square that breaks a cage is not solved', async ({ page }) => {
            // Fill the solution everywhere, then swap two cells in a way that keeps
            // rows/cols valid but violates a cage — still Latin, but not a win.
            const solved = await page.evaluate(() => {
                for (let r = 0; r < N; r++)
                    for (let c = 0; c < N; c++)
                        setValue(r, c, ((solutionAt(r, c)) % N) + 1); // a shifted (still-Latin) but wrong grid
                return isSolved();
            });
            expect(solved).toBe(false);
        });

        test('filling the full solution wins the game', async ({ page }) => {
            await fillSolution(page);
            const res = await page.evaluate(() => ({ solved: isSolved(), state }));
            expect(res.solved).toBe(true);
            expect(res.state).toBe('won');
        });

        test('winning reveals the overlay with a win message', async ({ page }) => {
            await fillSolution(page);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/solved|win|congrat/i);
        });
    });

    // -------------------------------------------------------------- restart
    test.describe('restarting', () => {
        test('R clears the grid and resets to playing', async ({ page }) => {
            await page.locator('#btn-start').click();
            await fillSolution(page);            // reach the won state
            await page.keyboard.press('r');
            const res = await page.evaluate(() => {
                let filled = 0;
                for (let r = 0; r < N; r++)
                    for (let c = 0; c < N; c++)
                        if (valueAt(r, c) !== 0) filled++;
                return { state, filled };
            });
            expect(res.state).toBe('playing');
            expect(res.filled).toBe(0);
        });
    });
});
