const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Fill every editable cell from the stored solution, driving a puzzle to a win.
async function solveCurrent(page) {
    return page.evaluate(() => {
        const sol = puzzles[puzzleIndex].solution;
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++)
                if (!fixed[r][c]) setCell(r, c, sol[r][c]);
    });
}

test.describe('Futoshiki', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Futoshiki', async ({ page }) => {
            await expect(page).toHaveTitle('Futoshiki');
        });

        test('canvas is 480×480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('a 5×5 puzzle is loaded', async ({ page }) => {
            const r = await page.evaluate(() => ({ size: SIZE, rows: grid.length, cols: grid[0].length }));
            expect(r.size).toBe(5);
            expect(r.rows).toBe(5);
            expect(r.cols).toBe(5);
        });

        test('the win overlay is hidden at start', async ({ page }) => {
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state starts as playing', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('playing');
        });

        test('every given cell is placed and marked fixed', async ({ page }) => {
            const ok = await page.evaluate(() => {
                return puzzles[puzzleIndex].givens.every(([r, c, v]) =>
                    grid[r][c] === v && fixed[r][c] === true);
            });
            expect(ok).toBe(true);
        });

        test('non-given cells start empty and editable', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const g = new Set(puzzles[puzzleIndex].givens.map(([r, c]) => r + ',' + c));
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (!g.has(r + ',' + c) && (grid[r][c] !== 0 || fixed[r][c])) return false;
                return true;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Entering & clearing numbers
    // -----------------------------------------------------------------------
    test.describe('entering numbers', () => {
        test('setCell fills an empty editable cell', async ({ page }) => {
            const v = await page.evaluate(() => {
                // find an empty editable cell
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (!fixed[r][c]) { setCell(r, c, 3); return grid[r][c]; }
            });
            expect(v).toBe(3);
        });

        test('setCell(0) clears a cell', async ({ page }) => {
            const v = await page.evaluate(() => {
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (!fixed[r][c]) { setCell(r, c, 4); setCell(r, c, 0); return grid[r][c]; }
            });
            expect(v).toBe(0);
        });

        test('a fixed (given) cell cannot be changed', async ({ page }) => {
            const r = await page.evaluate(() => {
                const [gr, gc, gv] = puzzles[puzzleIndex].givens[0];
                setCell(gr, gc, gv === 1 ? 2 : 1);
                return { after: grid[gr][gc], gv };
            });
            expect(r.after).toBe(r.gv);
        });

        test('out-of-range values are ignored', async ({ page }) => {
            const v = await page.evaluate(() => {
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (!fixed[r][c]) { setCell(r, c, 9); return grid[r][c]; }
            });
            expect(v).toBe(0);
        });

        test('typing a digit fills the selected cell', async ({ page }) => {
            await page.evaluate(() => {
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (!fixed[r][c]) { selectCell(r, c); return; }
            });
            await page.keyboard.press('3');
            const v = await page.evaluate(() => grid[selected.r][selected.c]);
            expect(v).toBe(3);
        });

        test('Backspace clears the selected cell', async ({ page }) => {
            await page.evaluate(() => {
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (!fixed[r][c]) { selectCell(r, c); setCell(r, c, 2); return; }
            });
            await page.keyboard.press('Backspace');
            const v = await page.evaluate(() => grid[selected.r][selected.c]);
            expect(v).toBe(0);
        });

        test('a number-palette button fills the selected cell', async ({ page }) => {
            await page.evaluate(() => {
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (!fixed[r][c]) { selectCell(r, c); return; }
            });
            await page.locator('.num-btn[data-num="5"]').click();
            const v = await page.evaluate(() => grid[selected.r][selected.c]);
            expect(v).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Selection & movement
    // -----------------------------------------------------------------------
    test.describe('selection', () => {
        test('selectCell sets the selection', async ({ page }) => {
            const s = await page.evaluate(() => { selectCell(2, 3); return selected; });
            expect(s).toEqual({ r: 2, c: 3 });
        });

        test('arrow keys move the selection', async ({ page }) => {
            await page.evaluate(() => selectCell(2, 2));
            await page.keyboard.press('ArrowRight');
            let s = await page.evaluate(() => selected);
            expect(s).toEqual({ r: 2, c: 3 });
            await page.keyboard.press('ArrowUp');
            s = await page.evaluate(() => selected);
            expect(s).toEqual({ r: 1, c: 3 });
        });

        test('the selection cannot leave the board', async ({ page }) => {
            const s = await page.evaluate(() => { selectCell(0, 0); moveSelection(-1, -1); return selected; });
            expect(s).toEqual({ r: 0, c: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Inequalities
    // -----------------------------------------------------------------------
    test.describe('inequalities', () => {
        test('hIneq returns the sign between horizontal neighbours', async ({ page }) => {
            const r = await page.evaluate(() => {
                loadPuzzle(0);
                return { at02: hIneq(0, 2), at00: hIneq(0, 0) };
            });
            expect(r.at02).toBe('<'); // puzzle 0 has [0,2,'<']
            expect(r.at00).toBeNull();
        });

        test('vIneq returns the sign between vertical neighbours', async ({ page }) => {
            const r = await page.evaluate(() => {
                loadPuzzle(0);
                return { at03: vIneq(0, 3), at11: vIneq(1, 1) };
            });
            expect(r.at03).toBe('>'); // puzzle 0 has [0,3,'>']
            expect(r.at11).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Conflict detection
    // -----------------------------------------------------------------------
    test.describe('conflicts', () => {
        test('a duplicate in a row is flagged', async ({ page }) => {
            const r = await page.evaluate(() => {
                loadPuzzle(0); // givens: (0,0)=1,(0,1)=2,(0,4)=5
                setCell(0, 2, 2); // duplicate of (0,1)=2
                return { a: cellConflict(0, 2), b: cellConflict(0, 1) };
            });
            expect(r.a).toBe(true);
            expect(r.b).toBe(true);
        });

        test('a violated inequality is flagged', async ({ page }) => {
            const r = await page.evaluate(() => {
                loadPuzzle(0); // (0,2) < (0,3)
                setCell(0, 2, 4);
                setCell(0, 3, 3); // 4 < 3 is false -> violation
                return cellConflict(0, 2);
            });
            expect(r).toBe(true);
        });

        test('a satisfied inequality with distinct values is not flagged', async ({ page }) => {
            const r = await page.evaluate(() => {
                loadPuzzle(0); // (0,2) < (0,3); row0 already has 1,2,_,_,5
                setCell(0, 2, 3);
                setCell(0, 3, 4); // 3 < 4 true, all row values distinct
                return cellConflict(0, 2);
            });
            expect(r).toBe(false);
        });

        test('an empty cell is never flagged', async ({ page }) => {
            const r = await page.evaluate(() => cellConflict(2, 2));
            expect(r).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Completion & winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('isComplete is false with empty cells and true when full', async ({ page }) => {
            const before = await page.evaluate(() => isComplete());
            expect(before).toBe(false);
            await solveCurrent(page);
            const after = await page.evaluate(() => isComplete());
            expect(after).toBe(true);
        });

        test('filling the correct solution solves the puzzle', async ({ page }) => {
            await solveCurrent(page);
            const solved = await page.evaluate(() => isSolved());
            expect(solved).toBe(true);
        });

        test('solving sets state to won and shows the overlay', async ({ page }) => {
            await solveCurrent(page);
            const s = await page.evaluate(() => state);
            expect(s).toBe('won');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Solved');
        });

        test('a full but incorrect grid does not win', async ({ page }) => {
            const solved = await page.evaluate(() => {
                loadPuzzle(3); // 0 givens
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        setCell(r, c, 1); // all ones — every row/col duplicated
                return isSolved();
            });
            expect(solved).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Hint
    // -----------------------------------------------------------------------
    test.describe('hint', () => {
        test('a hint reveals one correct empty cell', async ({ page }) => {
            const r = await page.evaluate(() => {
                loadPuzzle(1);
                const emptyBefore = grid.flat().filter(v => v === 0).length;
                useHint();
                const emptyAfter = grid.flat().filter(v => v === 0).length;
                // find the newly filled cell and check it matches the solution
                let correct = true;
                const sol = puzzles[puzzleIndex].solution;
                for (let rr = 0; rr < SIZE; rr++)
                    for (let cc = 0; cc < SIZE; cc++)
                        if (grid[rr][cc] !== 0 && grid[rr][cc] !== sol[rr][cc]) correct = false;
                return { emptyBefore, emptyAfter, correct };
            });
            expect(r.emptyAfter).toBe(r.emptyBefore - 1);
            expect(r.correct).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Puzzle select & restart
    // -----------------------------------------------------------------------
    test.describe('puzzle select and restart', () => {
        test('difficulty buttons load the matching puzzle', async ({ page }) => {
            await page.locator('.diff-btn[data-index="2"]').click();
            const r = await page.evaluate(() => ({
                idx: puzzleIndex,
                match: puzzles[2].givens.every(([r, c, v]) => grid[r][c] === v),
            }));
            expect(r.idx).toBe(2);
            expect(r.match).toBe(true);
        });

        test('restart clears entries back to the givens', async ({ page }) => {
            await page.evaluate(() => {
                loadPuzzle(0);
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (!fixed[r][c]) setCell(r, c, 1);
            });
            await page.locator('#btn-restart').click();
            const ok = await page.evaluate(() => {
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (!fixed[r][c] && grid[r][c] !== 0) return false;
                return true;
            });
            expect(ok).toBe(true);
        });

        test('loading a puzzle after a win resets state to playing', async ({ page }) => {
            await solveCurrent(page);
            await page.locator('.diff-btn[data-index="1"]').click();
            const s = await page.evaluate(() => state);
            expect(s).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });
});
