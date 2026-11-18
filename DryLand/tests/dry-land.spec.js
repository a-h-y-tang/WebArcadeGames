const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// ---------------------------------------------------------------------------
// Helpers
//
// The game exposes its puzzle, its grid and its solvers as globals, so a test
// can generate a puzzle from a fixed seed and check the rules of Nurikabe
// directly instead of going through the canvas.
// ---------------------------------------------------------------------------

async function newPuzzle(page, size = 0, seed = 2024) {
    await page.evaluate(([size, seed]) => newPuzzle(size, seed), [size, seed]);
}

async function clickCell(page, r, c, options = {}) {
    const pos = await page.evaluate(([r, c]) => {
        const rect = cellRect(r, c);
        return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    }, [r, c]);
    await page.locator('#canvas').click({ position: pos, ...options });
}

async function cellState(page, r, c) {
    return page.evaluate(([r, c]) => grid[r * cols + c], [r, c]);
}

// Marks every sea cell of the solution, which must finish the puzzle.
async function fillSolution(page) {
    await page.evaluate(() => {
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++)
                if (solution[r * cols + c] === SEA) mark(r, c, SEA);
    });
}

// The rules of the puzzle, checked against a solution grid.
async function ruleReport(page) {
    return page.evaluate(() => {
        const idx = (r, c) => r * cols + c;
        const nbs = (r, c) =>
            [[-1, 0], [1, 0], [0, -1], [0, 1]]
                .map(([dr, dc]) => [r + dr, c + dc])
                .filter(([nr, nc]) => nr >= 0 && nr < rows && nc >= 0 && nc < cols);
        const comp = (r0, c0, match) => {
            const seen = new Set([idx(r0, c0)]);
            const stack = [[r0, c0]];
            const out = [];
            while (stack.length) {
                const [r, c] = stack.pop();
                out.push([r, c]);
                for (const [nr, nc] of nbs(r, c)) {
                    if (!match(nr, nc) || seen.has(idx(nr, nc))) continue;
                    seen.add(idx(nr, nc));
                    stack.push([nr, nc]);
                }
            }
            return out;
        };
        const isLand = (r, c) => solution[idx(r, c)] === LAND;

        // every island holds exactly one clue, of exactly its own size
        const islands = [];
        const seen = new Set();
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++) {
                if (!isLand(r, c) || seen.has(idx(r, c))) continue;
                const cells = comp(r, c, isLand);
                for (const [a, b] of cells) seen.add(idx(a, b));
                islands.push(cells);
            }
        const clueOf = (cells) => clues.filter((cl) => cells.some(([r, c]) => r === cl.r && c === cl.c));
        const badIslands = islands.filter((cells) => {
            const own = clueOf(cells);
            return own.length !== 1 || own[0].n !== cells.length;
        }).length;

        // the sea is one body
        const seaCells = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!isLand(r, c)) seaCells.push([r, c]);
        const seaWhole =
            seaCells.length > 0 &&
            comp(seaCells[0][0], seaCells[0][1], (r, c) => !isLand(r, c)).length === seaCells.length;

        // the sea never fills a square
        let pools = 0;
        for (let r = 0; r + 1 < rows; r++)
            for (let c = 0; c + 1 < cols; c++)
                if (!isLand(r, c) && !isLand(r, c + 1) && !isLand(r + 1, c) && !isLand(r + 1, c + 1)) pools++;

        return { islands: islands.length, badIslands, seaWhole, pools, seaCells: seaCells.length };
    });
}

test.describe('Dry Land', () => {
    const errors = [];

    test.beforeEach(async ({ page }) => {
        errors.length = 0;
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(GAME_URL);
    });

    // -------------------------------------------------------------------
    // Initial state
    // -------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Dry Land', async ({ page }) => {
            await expect(page).toHaveTitle('Dry Land');
        });

        test('canvas is 520x520', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '520');
            await expect(canvas).toHaveAttribute('height', '520');
        });

        test('loads with no page or console errors', async ({ page }) => {
            await page.waitForTimeout(250);
            expect(errors).toEqual([]);
        });

        test('the Genesis 1:9 verse is on the page', async ({ page }) => {
            await expect(page.locator('#verse')).toContainText('Genesis 1:9');
            await expect(page.locator('#verse')).toContainText(/dry land/i);
        });

        test('opens on the small board, seven by seven', async ({ page }) => {
            const size = await page.evaluate(() => ({ rows, cols, size: sizeIndex }));
            expect(size).toEqual({ rows: 7, cols: 7, size: 0 });
        });

        test('the board starts with nothing marked', async ({ page }) => {
            const marked = await page.evaluate(() => [...grid].filter((v) => v !== UNKNOWN).length);
            expect(marked).toBe(0);
        });

        test('the HUD shows the size, the sea count and a clock', async ({ page }) => {
            await expect(page.locator('#size-label')).toContainText(/small/i);
            await expect(page.locator('#sea')).toContainText('/');
            await expect(page.locator('#time')).toHaveText(/0:0\d/);
            await expect(page.locator('#hints')).toHaveText('0');
        });

        test('the whole board fits inside the canvas', async ({ page }) => {
            const fits = await page.evaluate(() => {
                const first = cellRect(0, 0);
                const last = cellRect(rows - 1, cols - 1);
                return (
                    first.x >= 0 &&
                    first.y >= 0 &&
                    last.x + last.w <= canvas.width + 0.001 &&
                    last.y + last.h <= canvas.height + 0.001
                );
            });
            expect(fits).toBe(true);
        });
    });

    // -------------------------------------------------------------------
    // The puzzles themselves
    // -------------------------------------------------------------------
    test.describe('the puzzles', () => {
        test('the solution obeys every rule of the puzzle', async ({ page }) => {
            for (const seed of [11, 404, 7777]) {
                await newPuzzle(page, 0, seed);
                const r = await ruleReport(page);
                expect(r.badIslands, `seed ${seed}`).toBe(0);
                expect(r.seaWhole, `seed ${seed}`).toBe(true);
                expect(r.pools, `seed ${seed}`).toBe(0);
                expect(r.islands).toBeGreaterThan(2);
            }
        });

        test('clue numbers match the islands they stand on', async ({ page }) => {
            await newPuzzle(page, 1, 99);
            const ok = await page.evaluate(() =>
                clues.every((cl) => cl.n >= 1 && cl.n <= 9 && solution[cl.r * cols + cl.c] === LAND)
            );
            expect(ok).toBe(true);
        });

        test('each puzzle has exactly one solution', async ({ page }) => {
            for (const seed of [23, 561]) {
                await newPuzzle(page, 0, seed);
                const n = await page.evaluate(() => countSolutions(clues, 3).solutions);
                expect(n, `seed ${seed}`).toBe(1);
            }
        });

        test('each puzzle can be solved by the rules alone, with no guessing', async ({ page }) => {
            for (const seed of [23, 561, 1234]) {
                await newPuzzle(page, 0, seed);
                const res = await page.evaluate(() => {
                    const out = logicSolve(clues);
                    const wrong = [...out.grid].filter((v, i) => v !== solution[i]).length;
                    return { solved: out.solved, wrong, steps: out.steps.length };
                });
                expect(res.solved, `seed ${seed}`).toBe(true);
                expect(res.wrong, `seed ${seed}`).toBe(0);
                expect(res.steps).toBeGreaterThan(5);
            }
        });

        test('the rules never deduce a square wrongly', async ({ page }) => {
            // The hints come from these deductions, so an unsound rule would hand the
            // player a wrong square. Every deduction is checked against the answer.
            const bad = await page.evaluate(() => {
                const out = [];
                for (const size of [0, 1]) {
                    for (const s of [3, 17, 42, 108, 777]) {
                        newPuzzle(size, s);
                        const res = logicSolve(clues);
                        const wrong = res.steps.filter((st) => res.grid[st.r * cols + st.c] !== solution[st.r * cols + st.c]);
                        if (wrong.length) out.push({ size, s, wrong: wrong.length });
                    }
                }
                return out;
            });
            expect(bad).toEqual([]);
        });

        test('a new puzzle is a different puzzle', async ({ page }) => {
            const first = await page.evaluate(() => JSON.stringify(clues));
            await page.locator('#btn-new').click();
            const second = await page.evaluate(() => JSON.stringify(clues));
            expect(second).not.toBe(first);
        });

        test('every size builds a board of that size', async ({ page }) => {
            for (const [i, n] of [[0, 7], [1, 9], [2, 11]]) {
                await page.evaluate((i) => setSize(i), i);
                const dims = await page.evaluate(() => ({ rows, cols }));
                expect(dims).toEqual({ rows: n, cols: n });
                const fits = await page.evaluate(() => {
                    const last = cellRect(rows - 1, cols - 1);
                    return last.x + last.w <= canvas.width + 0.001 && last.y + last.h <= canvas.height + 0.001;
                });
                expect(fits).toBe(true);
            }
        });

        test('the bigger boards obey the rules too', async ({ page }) => {
            await page.evaluate(() => setSize(2));
            const r = await ruleReport(page);
            expect(r.badIslands).toBe(0);
            expect(r.seaWhole).toBe(true);
            expect(r.pools).toBe(0);
        });

        test('building a puzzle does not take long', async ({ page }) => {
            const ms = await page.evaluate(() => {
                const t0 = performance.now();
                newPuzzle(1, 31337);
                return performance.now() - t0;
            });
            expect(ms).toBeLessThan(4000);
        });
    });

    // -------------------------------------------------------------------
    // Marking the board
    // -------------------------------------------------------------------
    test.describe('marking the board', () => {
        test('clicking an empty cell marks sea', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            const cell = await page.evaluate(() => {
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++) if (!clueAt(r, c)) return { r, c };
            });
            await clickCell(page, cell.r, cell.c);
            expect(await cellState(page, cell.r, cell.c)).toBe(1); // SEA
        });

        test('clicking again marks dry land, and a third click clears it', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            const cell = await page.evaluate(() => {
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++) if (!clueAt(r, c)) return { r, c };
            });
            await clickCell(page, cell.r, cell.c);
            await clickCell(page, cell.r, cell.c);
            expect(await cellState(page, cell.r, cell.c)).toBe(2); // LAND
            await clickCell(page, cell.r, cell.c);
            expect(await cellState(page, cell.r, cell.c)).toBe(0); // UNKNOWN
        });

        test('right-clicking marks dry land first', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            const cell = await page.evaluate(() => {
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++) if (!clueAt(r, c)) return { r, c };
            });
            await clickCell(page, cell.r, cell.c, { button: 'right' });
            expect(await cellState(page, cell.r, cell.c)).toBe(2);
        });

        test('a clue cell cannot be marked', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            const cl = await page.evaluate(() => ({ r: clues[0].r, c: clues[0].c }));
            await clickCell(page, cl.r, cl.c);
            expect(await cellState(page, cl.r, cl.c)).toBe(0);
        });

        test('dragging paints a run of cells the same way', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            const row = await page.evaluate(() => {
                for (let r = 0; r < rows; r++) {
                    const free = [];
                    for (let c = 0; c < cols; c++) if (!clueAt(r, c)) free.push(c);
                    if (free.length >= 4 && free[3] === free[0] + 3) return { r, from: free[0], to: free[3] };
                }
                return null;
            });
            expect(row).not.toBeNull();
            const box = await page.locator('#canvas').boundingBox();
            const at = async (r, c) =>
                page.evaluate(([r, c]) => {
                    const rect = cellRect(r, c);
                    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
                }, [r, c]);
            const a = await at(row.r, row.from);
            const b = await at(row.r, row.to);
            await page.mouse.move(box.x + a.x, box.y + a.y);
            await page.mouse.down();
            for (let c = row.from + 1; c <= row.to; c++) {
                const p = await at(row.r, c);
                await page.mouse.move(box.x + p.x, box.y + p.y);
            }
            await page.mouse.move(box.x + b.x, box.y + b.y);
            await page.mouse.up();
            const painted = await page.evaluate(
                ([r, from, to]) => {
                    let n = 0;
                    for (let c = from; c <= to; c++) if (grid[r * cols + c] === SEA) n++;
                    return n;
                },
                [row.r, row.from, row.to]
            );
            expect(painted).toBe(row.to - row.from + 1);
        });

        test('the keyboard moves a cursor and marks cells', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.evaluate(() => {
                cursor.r = 0;
                cursor.c = 0;
            });
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => ({ ...cursor }))).toMatchObject({ r: 1, c: 1 });
            const wasClue = await page.evaluate(() => !!clueAt(cursor.r, cursor.c));
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => grid[cursor.r * cols + cursor.c]);
            expect(after).toBe(wasClue ? 0 : 1);
        });

        test('the cursor stays on the board', async ({ page }) => {
            await page.evaluate(() => {
                cursor.r = 0;
                cursor.c = 0;
            });
            for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
            for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => ({ ...cursor }))).toMatchObject({ r: 0, c: 0 });
        });

        test('Backspace clears a marked cell', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.evaluate(() => {
                const free = [];
                for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!clueAt(r, c)) free.push([r, c]);
                cursor.r = free[0][0];
                cursor.c = free[0][1];
                mark(cursor.r, cursor.c, SEA);
            });
            await page.keyboard.press('Backspace');
            expect(await page.evaluate(() => grid[cursor.r * cols + cursor.c])).toBe(0);
        });

        test('the sea counter follows the marks', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            const before = await page.locator('#sea').textContent();
            await page.evaluate(() => {
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++)
                        if (!clueAt(r, c) && solution[r * cols + c] === SEA) {
                            mark(r, c, SEA);
                            return;
                        }
            });
            const after = await page.locator('#sea').textContent();
            expect(after).not.toBe(before);
            expect(after.trim().startsWith('1')).toBe(true);
        });
    });

    // -------------------------------------------------------------------
    // Finishing a puzzle
    // -------------------------------------------------------------------
    test.describe('finishing', () => {
        test('marking every sea cell finishes the puzzle', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await fillSolution(page);
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/dry land|appear/i);
        });

        test('a map can be finished by clicking, one square at a time', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            const seaCells = await page.evaluate(() => {
                const out = [];
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++) if (solution[r * cols + c] === SEA) out.push({ r, c });
                return out;
            });
            for (const { r, c } of seaCells) await clickCell(page, r, c);
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('land may be left unmarked - only the sea has to be right', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            const anyLandMarked = await page.evaluate(() => [...grid].some((v) => v === LAND));
            expect(anyLandMarked).toBe(false);
            await fillSolution(page);
            expect(await page.evaluate(() => state)).toBe('won');
        });

        test('one sea cell too many does not finish it', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.evaluate(() => {
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++) if (solution[r * cols + c] === SEA) mark(r, c, SEA);
            });
            await page.evaluate(() => {
                state = 'playing';
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++)
                        if (solution[r * cols + c] === LAND && !clueAt(r, c)) {
                            grid[r * cols + c] = SEA;
                            return;
                        }
            });
            expect(await page.evaluate(() => isSolved())).toBe(false);
        });

        test('a missing sea cell does not finish it', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.evaluate(() => {
                let skipped = false;
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++)
                        if (solution[r * cols + c] === SEA) {
                            if (!skipped) {
                                skipped = true;
                                continue;
                            }
                            mark(r, c, SEA);
                        }
            });
            expect(await page.evaluate(() => state)).toBe('playing');
            expect(await page.evaluate(() => isSolved())).toBe(false);
        });

        test('marking dry land where the sea belongs does not finish it', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.evaluate(() => {
                let first = true;
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++)
                        if (solution[r * cols + c] === SEA) {
                            // the first square of sea is marked as land instead
                            mark(r, c, first ? LAND : SEA);
                            first = false;
                        }
            });
            expect(await page.evaluate(() => isSolved())).toBe(false);
        });

        test('the clock stops when the puzzle is finished', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await fillSolution(page);
            const first = await page.evaluate(() => elapsed);
            await page.waitForTimeout(350);
            expect(await page.evaluate(() => elapsed)).toBe(first);
        });

        test('the finish overlay shows the time taken', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.evaluate(() => {
                elapsed = 83;
            });
            await fillSolution(page);
            await expect(page.locator('#overlay-score')).toContainText('1:23');
        });

        test('the best time for a size is remembered', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.evaluate(() => {
                elapsed = 42;
            });
            await fillSolution(page);
            expect(await page.evaluate(() => window.localStorage.getItem('dry-land-best-0'))).toBe('42');
            await expect(page.locator('#best')).toHaveText('0:42');
        });

        test('a slower run does not replace the best time', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('dry-land-best-0', '30'));
            await page.reload();
            await newPuzzle(page, 0, 5);
            await page.evaluate(() => {
                elapsed = 90;
            });
            await fillSolution(page);
            expect(await page.evaluate(() => window.localStorage.getItem('dry-land-best-0'))).toBe('30');
        });

        test('the clock runs while the puzzle is being solved', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.evaluate(() => {
                elapsed = 0;
            });
            await page.waitForTimeout(1200);
            expect(await page.evaluate(() => elapsed)).toBeGreaterThan(0);
        });
    });

    // -------------------------------------------------------------------
    // Help: hints, checking, undo, reset
    // -------------------------------------------------------------------
    test.describe('help', () => {
        test('a hint fills in one correct cell', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.locator('#btn-hint').click();
            const res = await page.evaluate(() => {
                const marked = [];
                for (let i = 0; i < grid.length; i++) if (grid[i] !== UNKNOWN) marked.push(i);
                return { count: marked.length, correct: marked.every((i) => grid[i] === solution[i]) };
            });
            expect(res.count).toBe(1);
            expect(res.correct).toBe(true);
        });

        test('a hint says which rule it used', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.locator('#btn-hint').click();
            await expect(page.locator('#status')).not.toHaveText('');
            const text = await page.locator('#status').textContent();
            expect(text.trim().length).toBeGreaterThan(8);
        });

        test('hints are counted', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.locator('#btn-hint').click();
            await page.locator('#btn-hint').click();
            await expect(page.locator('#hints')).toHaveText('2');
        });

        test('hints never contradict the solution', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            const ok = await page.evaluate(() => {
                for (let i = 0; i < 25; i++) {
                    hint();
                    for (let j = 0; j < grid.length; j++)
                        if (grid[j] !== UNKNOWN && grid[j] !== solution[j]) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('hints alone can finish a puzzle', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            const done = await page.evaluate(() => {
                for (let i = 0; i < rows * cols + 5 && state === 'playing'; i++) hint();
                return state;
            });
            expect(done).toBe('won');
        });

        test('Check finds a wrong mark', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.evaluate(() => {
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++)
                        if (solution[r * cols + c] === LAND && !clueAt(r, c)) {
                            mark(r, c, SEA);
                            return;
                        }
            });
            await page.locator('#btn-check').click();
            expect(await page.evaluate(() => wrongCells.length)).toBe(1);
            await expect(page.locator('#status')).toContainText(/1/);
        });

        test('Check says so when nothing is wrong', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.evaluate(() => {
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++) if (solution[r * cols + c] === SEA) return mark(r, c, SEA);
            });
            await page.locator('#btn-check').click();
            expect(await page.evaluate(() => wrongCells.length)).toBe(0);
            await expect(page.locator('#status')).toContainText(/so far|right|good/i);
        });

        test('Reset clears the marks but keeps the puzzle', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            const before = await page.evaluate(() => JSON.stringify(clues));
            await page.evaluate(() => {
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++) if (!clueAt(r, c)) mark(r, c, SEA);
            });
            await page.locator('#btn-reset').click();
            const after = await page.evaluate(() => ({
                marked: [...grid].filter((v) => v !== UNKNOWN).length,
                clues: JSON.stringify(clues),
            }));
            expect(after.marked).toBe(0);
            expect(after.clues).toBe(before);
        });

        test('Undo takes back the last mark', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            const cell = await page.evaluate(() => {
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++) if (!clueAt(r, c)) return { r, c };
            });
            await clickCell(page, cell.r, cell.c);
            expect(await cellState(page, cell.r, cell.c)).toBe(1);
            await page.locator('#btn-undo').click();
            expect(await cellState(page, cell.r, cell.c)).toBe(0);
        });

        test('Undo on an untouched board does nothing', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.locator('#btn-undo').click();
            const marked = await page.evaluate(() => [...grid].filter((v) => v !== UNKNOWN).length);
            expect(marked).toBe(0);
            expect(errors).toEqual([]);
        });

        test('Undo takes back a whole dragged run at once', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.evaluate(() => {
                beginStroke();
                let n = 0;
                for (let r = 0; r < rows && n < 3; r++)
                    for (let c = 0; c < cols && n < 3; c++)
                        if (!clueAt(r, c)) {
                            mark(r, c, SEA);
                            n++;
                        }
                endStroke();
            });
            await page.locator('#btn-undo').click();
            const marked = await page.evaluate(() => [...grid].filter((v) => v !== UNKNOWN).length);
            expect(marked).toBe(0);
        });

        test('a new puzzle starts the clock and the board again', async ({ page }) => {
            await newPuzzle(page, 0, 5);
            await page.evaluate(() => {
                elapsed = 55;
                hintsUsed = 3;
                mark(1, 1, SEA);
            });
            await page.locator('#btn-new').click();
            const res = await page.evaluate(() => ({
                elapsed,
                hintsUsed,
                marked: [...grid].filter((v) => v !== UNKNOWN).length,
                state,
            }));
            expect(res.elapsed).toBeLessThan(0.5);
            expect(res).toMatchObject({ hintsUsed: 0, marked: 0, state: 'playing' });
        });
    });

    // -------------------------------------------------------------------
    // Sizes
    // -------------------------------------------------------------------
    test.describe('board sizes', () => {
        test('the size buttons switch board and label', async ({ page }) => {
            await page.locator('.size-btn', { hasText: 'Large' }).click();
            expect(await page.evaluate(() => rows)).toBe(11);
            await expect(page.locator('#size-label')).toContainText(/large/i);
            await expect(page.locator('.size-btn.active')).toHaveText(/large/i);
        });

        test('each size keeps its own best time', async ({ page }) => {
            await page.evaluate(() => {
                window.localStorage.setItem('dry-land-best-0', '20');
                window.localStorage.setItem('dry-land-best-1', '200');
            });
            await page.reload();
            await expect(page.locator('#best')).toHaveText('0:20');
            await page.locator('.size-btn', { hasText: 'Medium' }).click();
            await expect(page.locator('#best')).toHaveText('3:20');
        });

        test('switching size clears the board', async ({ page }) => {
            await page.evaluate(() => mark(0, 0, SEA));
            await page.locator('.size-btn', { hasText: 'Medium' }).click();
            const marked = await page.evaluate(() => [...grid].filter((v) => v !== UNKNOWN).length);
            expect(marked).toBe(0);
        });
    });

    // -------------------------------------------------------------------
    // Rendering and robustness
    // -------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            const lit = await page.evaluate(() => {
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                let n = 0;
                for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 90) n++;
                return n;
            });
            expect(lit).toBeGreaterThan(5000);
        });

        test('clue numbers are drawn on the board', async ({ page }) => {
            const drawn = await page.evaluate(() => {
                draw();
                const ctx = canvas.getContext('2d');
                return clues.every((cl) => {
                    const rect = cellRect(cl.r, cl.c);
                    const d = ctx.getImageData(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4).data;
                    let dark = 0;
                    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 220) dark++;
                    return dark > 10;      // the number's strokes
                });
            });
            expect(drawn).toBe(true);
        });

        test('a marked square is repainted on the next frame', async ({ page }) => {
            // The map is only repainted when something changes, so a mark that did
            // not ask for a repaint would leave the board looking untouched.
            await newPuzzle(page, 0, 5);
            const cell = await page.evaluate(() => {
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++) if (!clueAt(r, c)) return { r, c };
            });
            const sample = () =>
                page.evaluate(([r, c]) => {
                    const rect = cellRect(r, c);
                    const d = canvas.getContext('2d').getImageData(rect.x + 4, rect.y + 4, rect.w - 8, rect.h - 8).data;
                    let sum = 0;
                    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] * 2 + d[i + 2] * 3;
                    return sum;
                }, [cell.r, cell.c]);
            const before = await sample();
            await clickCell(page, cell.r, cell.c);
            await page.waitForTimeout(120);
            expect(await sample()).not.toBe(before);
        });

        test('a burst of random marking raises no error', async ({ page }) => {
            await page.evaluate(() => {
                let s = 7;
                const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
                for (let i = 0; i < 1500; i++) {
                    const r = Math.floor(rnd() * rows);
                    const c = Math.floor(rnd() * cols);
                    const v = Math.floor(rnd() * 3);
                    cycle(r, c, v === 2 ? -1 : 1);
                    if (i % 300 === 0) { check(); hint(); }
                    draw();
                }
            });
            await page.waitForTimeout(100);
            expect(errors).toEqual([]);
        });

        test('solving, starting again and solving once more raises no error', async ({ page }) => {
            await page.evaluate(() => {
                for (let round = 0; round < 3; round++) {
                    newPuzzle(0, 100 + round);
                    for (let i = 0; i < rows * cols + 5 && state === 'playing'; i++) hint();
                }
            });
            expect(await page.evaluate(() => state)).toBe('won');
            expect(errors).toEqual([]);
        });
    });
});
