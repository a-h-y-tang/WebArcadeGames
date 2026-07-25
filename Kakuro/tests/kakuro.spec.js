const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Fill every white cell from the bundled solution — used to reach a solved board.
function solveScript() {
    for (let r = 0; r < gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
            if (isWhite(r, c)) setCell(r, c, solution[r][c]);
        }
    }
}

test.describe('Kakuro', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Kakuro', async ({ page }) => {
            await expect(page).toHaveTitle('Kakuro');
        });

        test('first puzzle name is shown', async ({ page }) => {
            const name = await page.evaluate(() => PUZZLES[0].name);
            await expect(page.locator('#puzzle-name')).toHaveText(name);
        });

        test('state is playing', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('nothing is selected initially', async ({ page }) => {
            expect(await page.evaluate(() => selected)).toBeNull();
        });

        test('overlay is hidden initially', async ({ page }) => {
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('best shows a dash when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('canvas is sized to the puzzle grid', async ({ page }) => {
            const { w, h, cols, rows, cell } = await page.evaluate(() => ({
                w: +document.getElementById('canvas').width,
                h: +document.getElementById('canvas').height,
                cols: gridCols, rows: gridRows, cell: CELL,
            }));
            expect(w).toBe(cols * cell);
            expect(h).toBe(rows * cell);
        });

        test('every white cell starts empty', async ({ page }) => {
            const anyFilled = await page.evaluate(() => {
                for (let r = 0; r < gridRows; r++)
                    for (let c = 0; c < gridCols; c++)
                        if (isWhite(r, c) && grid[r][c].value !== 0) return true;
                return false;
            });
            expect(anyFilled).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Clues derived from the solution
    // -----------------------------------------------------------------------
    test.describe('clues', () => {
        test('clue sums are derived from the solution', async ({ page }) => {
            // Verify every clued run's stored sum equals the sum of the solution
            // digits in that run (i.e. clues were computed, never hand-typed).
            const mismatches = await page.evaluate(() => {
                let bad = 0;
                for (const run of runs) {
                    const s = run.cells.reduce((a, cell) => a + solution[cell.r][cell.c], 0);
                    if (s !== run.sum) bad++;
                }
                return bad;
            });
            expect(mismatches).toBe(0);
        });

        test('a block cell exposes right and down clue sums', async ({ page }) => {
            // Puzzle 0 block (1,0) begins a right run; block (0,1) begins a down run.
            const right = await page.evaluate(() => grid[1][0].right);
            const down = await page.evaluate(() => grid[0][1].down);
            expect(right).toBeGreaterThan(0);
            expect(down).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Selection & entry
    // -----------------------------------------------------------------------
    test.describe('selection and entry', () => {
        test('selecting a white cell records it', async ({ page }) => {
            await page.evaluate(() => selectCell(2, 2));
            expect(await page.evaluate(() => selected)).toEqual({ r: 2, c: 2 });
        });

        test('selecting a block cell does not change the selection', async ({ page }) => {
            await page.evaluate(() => { selectCell(2, 2); selectCell(0, 0); });
            expect(await page.evaluate(() => selected)).toEqual({ r: 2, c: 2 });
        });

        test('clicking the canvas selects the cell under the pointer', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            const cell = await page.evaluate(() => CELL);
            // click the centre of white cell (2,2)
            await page.mouse.click(box.x + 2 * cell + cell / 2, box.y + 2 * cell + cell / 2);
            expect(await page.evaluate(() => selected)).toEqual({ r: 2, c: 2 });
        });

        test('typing a digit fills the selected cell', async ({ page }) => {
            await page.evaluate(() => selectCell(2, 2));
            await page.keyboard.press('5');
            expect(await page.evaluate(() => grid[2][2].value)).toBe(5);
        });

        test('typing over a value replaces it', async ({ page }) => {
            await page.evaluate(() => selectCell(2, 2));
            await page.keyboard.press('5');
            await page.keyboard.press('8');
            expect(await page.evaluate(() => grid[2][2].value)).toBe(8);
        });

        test('Backspace clears the selected cell', async ({ page }) => {
            await page.evaluate(() => { selectCell(2, 2); setCell(2, 2, 7); });
            await page.keyboard.press('Backspace');
            expect(await page.evaluate(() => grid[2][2].value)).toBe(0);
        });

        test('0 clears the selected cell', async ({ page }) => {
            await page.evaluate(() => { selectCell(2, 2); setCell(2, 2, 7); });
            await page.keyboard.press('0');
            expect(await page.evaluate(() => grid[2][2].value)).toBe(0);
        });

        test('arrow keys move the selection to the next white cell', async ({ page }) => {
            await page.evaluate(() => selectCell(2, 1));
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => selected)).toEqual({ r: 2, c: 2 });
        });

        test('digits outside 1-9 are ignored for entry', async ({ page }) => {
            await page.evaluate(() => { selectCell(2, 2); setCell(2, 2, 3); });
            const before = await page.evaluate(() => grid[2][2].value);
            await page.evaluate(() => setCell(2, 2, 15));
            expect(await page.evaluate(() => grid[2][2].value)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Run validation / feedback
    // -----------------------------------------------------------------------
    test.describe('run validation', () => {
        test('a full, correct run reads as good', async ({ page }) => {
            const status = await page.evaluate(() => {
                // fill puzzle 0's right run at block (1,0) from the solution
                const run = runs.find(rn => rn.cells.some(c => c.r === 1 && c.c === 1) &&
                    rn.cells.every(c => c.r === 1));
                run.cells.forEach(c => setCell(c.r, c.c, solution[c.r][c.c]));
                return runStatus(run);
            });
            expect(status).toBe('good');
        });

        test('a full run with the wrong sum reads as bad', async ({ page }) => {
            const status = await page.evaluate(() => {
                const run = runs.find(rn => rn.cells.some(c => c.r === 1 && c.c === 1) &&
                    rn.cells.every(c => c.r === 1));
                // deliberately fill 1,2,3... which will not match the target sum
                run.cells.forEach((c, i) => setCell(c.r, c.c, i + 1));
                return runStatus(run);
            });
            expect(status).toBe('bad');
        });

        test('a run with a repeated digit reads as bad', async ({ page }) => {
            const status = await page.evaluate(() => {
                const run = runs.find(rn => rn.cells.some(c => c.r === 1 && c.c === 1) &&
                    rn.cells.every(c => c.r === 1));
                run.cells.forEach(c => setCell(c.r, c.c, 5)); // all 5s → repeat
                return runStatus(run);
            });
            expect(status).toBe('bad');
        });

        test('an incomplete run reads as neutral', async ({ page }) => {
            const status = await page.evaluate(() => {
                const run = runs.find(rn => rn.cells.length >= 2);
                run.cells.forEach(c => setCell(c.r, c.c, 0)); // empty
                return runStatus(run);
            });
            expect(status).toBe('neutral');
        });
    });

    // -----------------------------------------------------------------------
    // Solving
    // -----------------------------------------------------------------------
    test.describe('solving', () => {
        test('isSolved is false at the start', async ({ page }) => {
            expect(await page.evaluate(() => isSolved())).toBe(false);
        });

        test('filling the whole grid correctly solves it', async ({ page }) => {
            await page.evaluate(solveScript);
            expect(await page.evaluate(() => isSolved())).toBe(true);
            expect(await page.evaluate(() => state)).toBe('solved');
        });

        test('solving reveals the solved overlay', async ({ page }) => {
            await page.evaluate(solveScript);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/solved/i);
        });

        test('an almost-complete grid is not solved', async ({ page }) => {
            const solved = await page.evaluate(() => {
                for (let r = 0; r < gridRows; r++)
                    for (let c = 0; c < gridCols; c++)
                        if (isWhite(r, c)) setCell(r, c, solution[r][c]);
                // clear one cell
                outer: for (let r = 0; r < gridRows; r++)
                    for (let c = 0; c < gridCols; c++)
                        if (isWhite(r, c)) { clearCell(r, c); break outer; }
                return isSolved();
            });
            expect(solved).toBe(false);
        });

        test('the timer stops after solving', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                solveScriptInline();
                function solveScriptInline() {
                    for (let r = 0; r < gridRows; r++)
                        for (let c = 0; c < gridCols; c++)
                            if (isWhite(r, c)) setCell(r, c, solution[r][c]);
                }
                const before = elapsed;
                tick(5);
                return { before, after: elapsed };
            });
            expect(after).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Timer & best time
    // -----------------------------------------------------------------------
    test.describe('best time', () => {
        test('solving records a best time', async ({ page }) => {
            await page.evaluate(() => { tick(12); });
            await page.evaluate(solveScript);
            const best = await page.evaluate(() => bestTimes[puzzleIndex]);
            expect(typeof best).toBe('number');
            await expect(page.locator('#best')).not.toHaveText('—');
        });

        test('best time persists to localStorage', async ({ page }) => {
            await page.evaluate(() => { tick(9); });
            await page.evaluate(solveScript);
            const stored = await page.evaluate(() => window.localStorage.getItem('kakuro-best'));
            expect(stored).toBeTruthy();
            const idx = await page.evaluate(() => puzzleIndex);
            expect(JSON.parse(stored)).toHaveProperty(String(idx));
        });

        test('a faster solve improves the best time', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('kakuro-best', JSON.stringify({ 0: 999 })));
            await page.reload();
            await page.evaluate(() => { tick(10); });
            await page.evaluate(solveScript);
            const best = await page.evaluate(() => bestTimes[0]);
            expect(best).toBeLessThan(999);
        });
    });

    // -----------------------------------------------------------------------
    // Controls
    // -----------------------------------------------------------------------
    test.describe('controls', () => {
        test('restart clears all entries and resets state', async ({ page }) => {
            await page.evaluate(() => { selectCell(2, 2); setCell(2, 2, 6); tick(4); });
            await page.evaluate(() => restart());
            const res = await page.evaluate(() => ({
                filled: grid[2][2].value, state, selected, elapsed,
            }));
            expect(res).toEqual({ filled: 0, state: 'playing', selected: null, elapsed: 0 });
        });

        test('restart button works', async ({ page }) => {
            await page.evaluate(() => { selectCell(2, 2); setCell(2, 2, 6); });
            await page.locator('#btn-restart').click();
            expect(await page.evaluate(() => grid[2][2].value)).toBe(0);
        });

        test('next puzzle loads the following puzzle', async ({ page }) => {
            await page.evaluate(() => nextPuzzle());
            expect(await page.evaluate(() => puzzleIndex)).toBe(1);
            const name = await page.evaluate(() => PUZZLES[1].name);
            await expect(page.locator('#puzzle-name')).toHaveText(name);
        });

        test('next puzzle wraps around at the end', async ({ page }) => {
            const wrapped = await page.evaluate(() => {
                const n = PUZZLES.length;
                for (let i = 0; i < n; i++) nextPuzzle();
                return puzzleIndex;
            });
            expect(wrapped).toBe(0);
        });

        test('the next button on the solved overlay advances the puzzle', async ({ page }) => {
            await page.evaluate(solveScript);
            await page.locator('#btn-next').click();
            expect(await page.evaluate(() => puzzleIndex)).toBe(1);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Puzzle integrity (guards the bundled data)
    // -----------------------------------------------------------------------
    test.describe('puzzle data integrity', () => {
        test('every bundled puzzle has a valid, non-repeating solution', async ({ page }) => {
            const problems = await page.evaluate(() => {
                const issues = [];
                for (let p = 0; p < PUZZLES.length; p++) {
                    loadPuzzle(p);
                    for (const run of runs) {
                        const vals = run.cells.map(c => solution[c.r][c.c]);
                        if (vals.some(v => v < 1 || v > 9)) issues.push(`p${p} bad digit`);
                        if (new Set(vals).size !== vals.length) issues.push(`p${p} repeat`);
                        if (run.cells.length < 2) issues.push(`p${p} short run`);
                    }
                }
                return issues;
            });
            expect(problems).toEqual([]);
        });

        test('the bundled solution actually solves each puzzle', async ({ page }) => {
            const allSolve = await page.evaluate(() => {
                for (let p = 0; p < PUZZLES.length; p++) {
                    loadPuzzle(p);
                    for (let r = 0; r < gridRows; r++)
                        for (let c = 0; c < gridCols; c++)
                            if (isWhite(r, c)) setCell(r, c, solution[r][c]);
                    if (!isSolved()) return false;
                }
                return true;
            });
            expect(allSolve).toBe(true);
        });
    });
});
