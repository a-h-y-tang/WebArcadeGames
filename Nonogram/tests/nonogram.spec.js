const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// A small, fully-known 3x3 puzzle used for exact clue/solve assertions:
//   # # .      row clues: [2] [1] [3]
//   . # .      col clues: [1,1] [3] [1]
//   # # #
const P3 = ['##.', '.#.', '###'];

async function load(page, rows) {
    await page.evaluate((rows) => window.game.loadPuzzle(rows), rows);
}

// Fill every cell that is filled in the solution — i.e. solve the puzzle.
async function solve(page) {
    await page.evaluate(() => {
        const g = window.game;
        for (let y = 0; y < g.ROWS; y++) {
            for (let x = 0; x < g.COLS; x++) {
                if (g.solution[y][x]) g.toggleFill(x, y);
            }
        }
    });
}

test.describe('Nonogram', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Nonogram', async ({ page }) => {
            await expect(page).toHaveTitle('Nonogram');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the puzzle', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/clue|nonogram|picross/i);
        });

        test('canvas exists with fixed pixel size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', /\d+/);
            await expect(canvas).toHaveAttribute('height', /\d+/);
        });

        test('state starts as ready', async ({ page }) => {
            expect(await page.evaluate(() => window.game.state)).toBe('ready');
        });

        test('exposes the game API', async ({ page }) => {
            const api = await page.evaluate(() => {
                const g = window.game;
                return {
                    toggleFill: typeof g.toggleFill,
                    toggleMark: typeof g.toggleMark,
                    setCell: typeof g.setCell,
                    isSolved: typeof g.isSolved,
                    mistakes: typeof g.mistakes,
                    reset: typeof g.reset,
                    loadPuzzle: typeof g.loadPuzzle,
                    loadBuiltin: typeof g.loadBuiltin,
                    lineClue: typeof g.lineClue,
                    start: typeof g.start,
                };
            });
            expect(api).toEqual({
                toggleFill: 'function', toggleMark: 'function', setCell: 'function',
                isSolved: 'function', mistakes: 'function', reset: 'function',
                loadPuzzle: 'function', loadBuiltin: 'function', lineClue: 'function',
                start: 'function',
            });
        });

        test('there is at least one built-in puzzle', async ({ page }) => {
            expect(await page.evaluate(() => window.PUZZLES.length)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // lineClue helper
    // -----------------------------------------------------------------------
    test.describe('lineClue', () => {
        test('counts consecutive runs', async ({ page }) => {
            const r = await page.evaluate(() =>
                window.game.lineClue([true, true, false, true]));
            expect(r).toEqual([2, 1]);
        });

        test('an empty line clues to [0]', async ({ page }) => {
            const r = await page.evaluate(() =>
                window.game.lineClue([false, false, false]));
            expect(r).toEqual([0]);
        });

        test('a full line clues to its length', async ({ page }) => {
            const r = await page.evaluate(() =>
                window.game.lineClue([true, true, true]));
            expect(r).toEqual([3]);
        });
    });

    // -----------------------------------------------------------------------
    // Clue derivation from a puzzle
    // -----------------------------------------------------------------------
    test.describe('clue derivation', () => {
        test('row and column clues match the known 3x3 puzzle', async ({ page }) => {
            await load(page, P3);
            const clues = await page.evaluate(() => ({
                rows: window.game.rowClues,
                cols: window.game.colClues,
            }));
            expect(clues.rows).toEqual([[2], [1], [3]]);
            expect(clues.cols).toEqual([[1, 1], [3], [1]]);
        });

        test('grid dimensions follow the loaded puzzle', async ({ page }) => {
            await load(page, P3);
            const d = await page.evaluate(() => ({
                cols: window.game.COLS, rows: window.game.ROWS,
                gy: window.game.grid.length, gx: window.game.grid[0].length,
            }));
            expect(d).toEqual({ cols: 3, rows: 3, gy: 3, gx: 3 });
        });
    });

    // -----------------------------------------------------------------------
    // Filling and marking
    // -----------------------------------------------------------------------
    test.describe('cell interaction', () => {
        test.beforeEach(async ({ page }) => { await load(page, P3); });

        test('a fresh puzzle starts with an all-empty grid', async ({ page }) => {
            const anyFilled = await page.evaluate(() =>
                window.game.grid.flat().some((c) => c !== 0));
            expect(anyFilled).toBe(false);
        });

        test('toggleFill fills then clears a cell', async ({ page }) => {
            const states = await page.evaluate(() => {
                const out = [];
                window.game.toggleFill(0, 0); out.push(window.game.grid[0][0]);
                window.game.toggleFill(0, 0); out.push(window.game.grid[0][0]);
                return out;
            });
            expect(states).toEqual([1, 0]);
        });

        test('toggleMark marks then clears a cell', async ({ page }) => {
            const states = await page.evaluate(() => {
                const out = [];
                window.game.toggleMark(1, 1); out.push(window.game.grid[1][1]);
                window.game.toggleMark(1, 1); out.push(window.game.grid[1][1]);
                return out;
            });
            expect(states).toEqual([2, 0]);
        });

        test('marking a filled cell replaces the fill', async ({ page }) => {
            const s = await page.evaluate(() => {
                window.game.toggleFill(2, 2);
                window.game.toggleMark(2, 2);
                return window.game.grid[2][2];
            });
            expect(s).toBe(2);
        });

        test('a mark does not count towards the solution', async ({ page }) => {
            // Mark every solution cell instead of filling them: not solved.
            await page.evaluate(() => {
                const g = window.game;
                for (let y = 0; y < g.ROWS; y++)
                    for (let x = 0; x < g.COLS; x++)
                        if (g.solution[y][x]) g.toggleMark(x, y);
            });
            expect(await page.evaluate(() => window.game.isSolved())).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Solving
    // -----------------------------------------------------------------------
    test.describe('solving', () => {
        test('an untouched puzzle is not solved', async ({ page }) => {
            await load(page, P3);
            expect(await page.evaluate(() => window.game.isSolved())).toBe(false);
        });

        test('filling exactly the solution solves it', async ({ page }) => {
            await load(page, P3);
            await solve(page);
            expect(await page.evaluate(() => window.game.isSolved())).toBe(true);
        });

        test('missing one cell is not solved', async ({ page }) => {
            await load(page, P3);
            await solve(page);
            await page.evaluate(() => window.game.toggleFill(0, 0)); // remove one fill
            expect(await page.evaluate(() => window.game.isSolved())).toBe(false);
        });

        test('an extra wrong fill breaks a clue and is not solved', async ({ page }) => {
            await load(page, P3);
            await solve(page);
            // (2,0) is empty in the solution; filling it changes row 0's clue.
            await page.evaluate(() => window.game.toggleFill(2, 0));
            expect(await page.evaluate(() => window.game.isSolved())).toBe(false);
        });

        test('mistakes counts filled cells that are not in the solution', async ({ page }) => {
            await load(page, P3);
            const m = await page.evaluate(() => {
                window.game.toggleFill(2, 0); // wrong
                window.game.toggleFill(0, 1); // wrong
                window.game.toggleFill(0, 0); // correct
                return window.game.mistakes();
            });
            expect(m).toBe(2);
        });

        test('a solvable-by-alternative pattern still satisfies the clues', async ({ page }) => {
            // Row/col clues of all-1 blocks on the diagonal: only one pattern.
            await load(page, ['#..', '.#.', '..#']);
            await solve(page);
            expect(await page.evaluate(() => window.game.isSolved())).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Winning overlay & reset
    // -----------------------------------------------------------------------
    test.describe('winning and reset', () => {
        test('solving sets state to won and shows the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await load(page, P3);
            await solve(page);
            expect(await page.evaluate(() => window.game.state)).toBe('won');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/solved|win|complete|nice/i);
        });

        test('reset clears the grid but keeps the puzzle', async ({ page }) => {
            await load(page, P3);
            await page.evaluate(() => window.game.toggleFill(0, 0));
            await page.evaluate(() => window.game.reset());
            const r = await page.evaluate(() => ({
                anyFilled: window.game.grid.flat().some((c) => c !== 0),
                clues: window.game.rowClues,
            }));
            expect(r.anyFilled).toBe(false);
            expect(r.clues).toEqual([[2], [1], [3]]);
        });

        test('the R key resets the puzzle', async ({ page }) => {
            await page.locator('#btn-start').click();
            await load(page, P3);
            await page.evaluate(() => window.game.toggleFill(0, 0));
            await page.keyboard.press('r');
            const anyFilled = await page.evaluate(() =>
                window.game.grid.flat().some((c) => c !== 0));
            expect(anyFilled).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Pointer input
    // -----------------------------------------------------------------------
    test.describe('pointer input', () => {
        test('left-clicking a cell fills it', async ({ page }) => {
            await page.locator('#btn-start').click();
            await load(page, P3);
            const geom = await page.evaluate(() => ({
                cell: window.game.CELL, ox: window.game.ORIGIN_X, oy: window.game.ORIGIN_Y,
            }));
            const box = await page.locator('#canvas').boundingBox();
            const cx = box.x + geom.ox + geom.cell * 1 + geom.cell / 2;
            const cy = box.y + geom.oy + geom.cell * 2 + geom.cell / 2;
            await page.mouse.click(cx, cy);
            expect(await page.evaluate(() => window.game.grid[2][1])).toBe(1);
        });

        test('right-clicking a cell marks it', async ({ page }) => {
            await page.locator('#btn-start').click();
            await load(page, P3);
            const geom = await page.evaluate(() => ({
                cell: window.game.CELL, ox: window.game.ORIGIN_X, oy: window.game.ORIGIN_Y,
            }));
            const box = await page.locator('#canvas').boundingBox();
            const cx = box.x + geom.ox + geom.cell * 0 + geom.cell / 2;
            const cy = box.y + geom.oy + geom.cell * 0 + geom.cell / 2;
            await page.mouse.click(cx, cy, { button: 'right' });
            expect(await page.evaluate(() => window.game.grid[0][0])).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Built-in puzzles
    // -----------------------------------------------------------------------
    test.describe('built-in puzzles', () => {
        test('every puzzle is rectangular and non-empty', async ({ page }) => {
            const report = await page.evaluate(() => window.PUZZLES.map((p) => {
                const w = p.rows[0].length;
                const rectangular = p.rows.every((r) => r.length === w);
                const filled = p.rows.join('').split('').filter((c) => c === '#').length;
                return { rectangular, filled, name: p.name };
            }));
            for (const p of report) {
                expect(p.rectangular).toBe(true);
                expect(p.filled).toBeGreaterThan(0);
            }
        });

        test('loadBuiltin makes the puzzle solvable by its own solution', async ({ page }) => {
            await page.evaluate(() => window.game.loadBuiltin(0));
            await solve(page);
            expect(await page.evaluate(() => window.game.isSolved())).toBe(true);
        });
    });
});
