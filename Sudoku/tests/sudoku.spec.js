const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// A complete, valid solution to the "easy" puzzle used below, so tests can
// drive the board to a solved state deterministically.
// Puzzle (easy):
//   530070000600195000098000060800060003400803001700020006060000280000419005000080079
const EASY_SOLUTION = [
    [5, 3, 4, 6, 7, 8, 9, 1, 2],
    [6, 7, 2, 1, 9, 5, 3, 4, 8],
    [1, 9, 8, 3, 4, 2, 5, 6, 7],
    [8, 5, 9, 7, 6, 1, 4, 2, 3],
    [4, 2, 6, 8, 5, 3, 7, 9, 1],
    [7, 1, 3, 9, 2, 4, 8, 5, 6],
    [9, 6, 1, 5, 3, 7, 2, 8, 4],
    [2, 8, 7, 4, 1, 9, 6, 3, 5],
    [3, 4, 5, 2, 8, 6, 1, 7, 9],
];

test.describe('Sudoku', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // Force a known puzzle so tests are deterministic.
        await page.evaluate(() => newGame('easy', 0));
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Sudoku', async ({ page }) => {
            await expect(page).toHaveTitle('Sudoku');
        });

        test('canvas is 504×504', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '504');
            await expect(canvas).toHaveAttribute('height', '504');
        });

        test('board is 9×9', async ({ page }) => {
            const info = await page.evaluate(() => ({ rows: board.length, cols: board[0].length, N }));
            expect(info.rows).toBe(9);
            expect(info.cols).toBe(9);
            expect(info.N).toBe(9);
        });

        test('state is playing', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the puzzle has given clues', async ({ page }) => {
            const givens = await page.evaluate(() =>
                given.flat().filter(Boolean).length);
            expect(givens).toBeGreaterThan(16);
            expect(givens).toBeLessThan(81);
        });

        test('given cells match the loaded puzzle values', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let r = 0; r < N; r++)
                    for (let c = 0; c < N; c++)
                        if (given[r][c] && board[r][c] === 0) return false;
                return true;
            });
            expect(ok).toBe(true);
        });

        test('non-given cells start empty', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let r = 0; r < N; r++)
                    for (let c = 0; c < N; c++)
                        if (!given[r][c] && board[r][c] !== 0) return false;
                return true;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Selection
    // -----------------------------------------------------------------------
    test.describe('selection', () => {
        test('selectCell sets the selection', async ({ page }) => {
            const sel = await page.evaluate(() => { selectCell(4, 5); return selected; });
            expect(sel).toEqual({ r: 4, c: 5 });
        });

        test('arrow keys move the selection', async ({ page }) => {
            const sel = await page.evaluate(() => {
                selectCell(4, 4);
                moveSelection(0, 1);
                return selected;
            });
            expect(sel).toEqual({ r: 4, c: 5 });
        });

        test('the selection cannot leave the board', async ({ page }) => {
            const sel = await page.evaluate(() => {
                selectCell(0, 0);
                moveSelection(-1, -1);
                return selected;
            });
            expect(sel).toEqual({ r: 0, c: 0 });
        });

        test('clicking the canvas selects the cell under the pointer', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            const cell = await page.evaluate(() => CELL);
            // Click roughly the center of cell (row 2, col 3).
            await page.mouse.click(box.x + cell * 3 + cell / 2, box.y + cell * 2 + cell / 2);
            const sel = await page.evaluate(() => selected);
            expect(sel).toEqual({ r: 2, c: 3 });
        });
    });

    // -----------------------------------------------------------------------
    // Entering and clearing digits
    // -----------------------------------------------------------------------
    test.describe('entering digits', () => {
        // Find an empty (non-given) cell for these tests.
        async function firstEmpty(page) {
            return page.evaluate(() => {
                for (let r = 0; r < N; r++)
                    for (let c = 0; c < N; c++)
                        if (!given[r][c]) return { r, c };
                return null;
            });
        }

        test('entering a digit fills an empty cell', async ({ page }) => {
            const { r, c } = await firstEmpty(page);
            const v = await page.evaluate(({ r, c }) => {
                selectCell(r, c);
                enterDigit(7);
                return board[r][c];
            }, { r, c });
            expect(v).toBe(7);
        });

        test('typing a number key fills the selected cell', async ({ page }) => {
            const { r, c } = await firstEmpty(page);
            await page.evaluate(({ r, c }) => selectCell(r, c), { r, c });
            await page.keyboard.press('5');
            const v = await page.evaluate(({ r, c }) => board[r][c], { r, c });
            expect(v).toBe(5);
        });

        test('a given cell cannot be overwritten', async ({ page }) => {
            const g = await page.evaluate(() => {
                for (let r = 0; r < N; r++)
                    for (let c = 0; c < N; c++)
                        if (given[r][c]) return { r, c, v: board[r][c] };
                return null;
            });
            const after = await page.evaluate(({ r, c }) => {
                selectCell(r, c);
                enterDigit(1);
                return board[r][c];
            }, g);
            expect(after).toBe(g.v);
        });

        test('clearing empties a filled cell', async ({ page }) => {
            const { r, c } = await firstEmpty(page);
            const v = await page.evaluate(({ r, c }) => {
                selectCell(r, c);
                enterDigit(9);
                clearCell();
                return board[r][c];
            }, { r, c });
            expect(v).toBe(0);
        });

        test('Backspace clears the selected cell', async ({ page }) => {
            const { r, c } = await firstEmpty(page);
            await page.evaluate(({ r, c }) => { selectCell(r, c); enterDigit(3); }, { r, c });
            await page.keyboard.press('Backspace');
            const v = await page.evaluate(({ r, c }) => board[r][c], { r, c });
            expect(v).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Conflicts
    // -----------------------------------------------------------------------
    test.describe('conflicts', () => {
        test('a duplicate in a row is a conflict', async ({ page }) => {
            const res = await page.evaluate(() => {
                // Row 0 of the easy puzzle: 5 3 . . 7 . . . .  → cols 2,3,5,6,7,8 empty.
                // Put a 5 in an empty cell of row 0; it clashes with the given 5 at (0,0).
                selectCell(0, 2);
                enterDigit(5);
                return { self: hasConflict(0, 2), other: hasConflict(0, 0) };
            });
            expect(res.self).toBe(true);
            expect(res.other).toBe(true);
        });

        test('a duplicate in a column is a conflict', async ({ page }) => {
            const res = await page.evaluate(() => {
                // Column 0 given at (0,0)=5, (1,0)=6, (3,0)=8, (4,0)=4, (5,0)=7.
                // (2,0) is empty; placing 6 clashes with (1,0).
                selectCell(2, 0);
                enterDigit(6);
                return hasConflict(2, 0);
            });
            expect(res).toBe(true);
        });

        test('a duplicate in a 3×3 box is a conflict', async ({ page }) => {
            const res = await page.evaluate(() => {
                // Top-left box has given 3 at (0,1). (2,0) is empty and its row/column
                // contain no 3, so placing 3 there clashes *only* via the 3×3 box.
                selectCell(2, 0);
                enterDigit(3);
                return hasConflict(2, 0);
            });
            expect(res).toBe(true);
        });

        test('a non-duplicate placement is not a conflict', async ({ page }) => {
            const res = await page.evaluate(() => {
                // (0,2) with 4 is valid in the solution and clashes with nothing given.
                selectCell(0, 2);
                enterDigit(4);
                return hasConflict(0, 2);
            });
            expect(res).toBe(false);
        });

        test('findConflicts reports all conflicting cells', async ({ page }) => {
            const n = await page.evaluate(() => {
                selectCell(0, 2);
                enterDigit(5); // clashes with the given 5 at (0,0)
                return findConflicts().length;
            });
            expect(n).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        async function solveBoard(page) {
            await page.evaluate((sol) => {
                for (let r = 0; r < N; r++)
                    for (let c = 0; c < N; c++)
                        if (!given[r][c]) { selectCell(r, c); enterDigit(sol[r][c]); }
            }, EASY_SOLUTION);
        }

        test('isSolved is false on a fresh puzzle', async ({ page }) => {
            expect(await page.evaluate(() => isSolved())).toBe(false);
        });

        test('a completed correct board is solved', async ({ page }) => {
            await solveBoard(page);
            expect(await page.evaluate(() => isSolved())).toBe(true);
        });

        test('solving switches state to won and shows the overlay', async ({ page }) => {
            await solveBoard(page);
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/Solved|You Win/i);
        });

        test('a full board with a wrong digit is not solved', async ({ page }) => {
            await solveBoard(page);
            // Break one non-given cell.
            const broke = await page.evaluate(() => {
                for (let r = 0; r < N; r++)
                    for (let c = 0; c < N; c++)
                        if (!given[r][c]) {
                            const wrong = board[r][c] === 9 ? 8 : 9;
                            board[r][c] = wrong;
                            return true;
                        }
                return false;
            });
            expect(broke).toBe(true);
            expect(await page.evaluate(() => isComplete())).toBe(true);
            expect(await page.evaluate(() => isSolved())).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // New game / difficulty
    // -----------------------------------------------------------------------
    test.describe('new game', () => {
        test('New Game button reloads a puzzle in playing state', async ({ page }) => {
            await page.evaluate(() => { selectCell(0, 2); enterDigit(4); });
            await page.locator('#btn-new').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('starting a new game clears previous entries', async ({ page }) => {
            const { r, c } = await page.evaluate(() => {
                for (let r = 0; r < N; r++)
                    for (let c = 0; c < N; c++) if (!given[r][c]) return { r, c };
            });
            await page.evaluate(({ r, c }) => { selectCell(r, c); enterDigit(7); }, { r, c });
            await page.evaluate(() => newGame('easy', 0));
            const empties = await page.evaluate(() => {
                let n = 0;
                for (let r = 0; r < N; r++)
                    for (let c = 0; c < N; c++) if (!given[r][c] && board[r][c] !== 0) n++;
                return n;
            });
            expect(empties).toBe(0);
        });

        test('choosing Hard loads a hard puzzle with fewer givens than Easy', async ({ page }) => {
            const easyGivens = await page.evaluate(() => {
                newGame('easy', 0);
                return given.flat().filter(Boolean).length;
            });
            const hardGivens = await page.evaluate(() => {
                newGame('hard', 0);
                return given.flat().filter(Boolean).length;
            });
            expect(await page.evaluate(() => difficulty)).toBe('hard');
            expect(hardGivens).toBeLessThan(easyGivens);
        });

        test('difficulty buttons load the chosen difficulty', async ({ page }) => {
            await page.locator('#btn-medium').click();
            expect(await page.evaluate(() => difficulty)).toBe('medium');
            expect(await page.evaluate(() => state)).toBe('playing');
        });
    });
});
