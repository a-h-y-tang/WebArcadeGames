const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Centre of cell (r, c) in canvas pixels — the canvas is rendered 1:1 at the
// default viewport, so these double as click positions.
async function cellCentre(page, r, c) {
    return page.evaluate(([r, c]) => ({
        x: ORIGIN + c * cellSize + cellSize / 2,
        y: ORIGIN + r * cellSize + cellSize / 2,
    }), [r, c]);
}

async function clickCell(page, r, c, options = {}) {
    const pos = await cellCentre(page, r, c);
    await page.locator('#canvas').click({ position: pos, ...options });
}

// Every booth of the current puzzle's solution, as [r, c] pairs.
async function solutionCells(page) {
    return page.evaluate(() => {
        const out = [];
        for (let r = 0; r < size; r++)
            for (let c = 0; c < size; c++) if (puzzle.solution[r][c]) out.push([r, c]);
        return out;
    });
}

test.describe('Feast of Booths', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Feast of Booths', async ({ page }) => {
            await expect(page).toHaveTitle('Feast of Booths');
        });

        test('canvas is 460x460', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '460');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('the whole board fits inside the canvas', async ({ page }) => {
            const fits = await page.evaluate(() =>
                ORIGIN + cellSize * size <= canvas.width - PAD + 0.001);
            expect(fits).toBe(true);
        });

        test('starts on the small camp: 8x8 with 10 booths', async ({ page }) => {
            expect(await page.evaluate(() => size)).toBe(8);
            expect(await page.evaluate(() => LEVELS[levelIndex].name)).toBe('Small camp');
            expect(await page.evaluate(() => LEVELS[levelIndex].booths)).toBe(10);
        });

        test('the board starts with no marks and is not solved', async ({ page }) => {
            const anyMark = await page.evaluate(() => marks.flat().some((v) => v !== EMPTY));
            expect(anyMark).toBe(false);
            expect(await page.evaluate(() => solved)).toBe(false);
        });

        test('the solved overlay is hidden at start', async ({ page }) => {
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('there is one palm tree per booth in the solution', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                trees: puzzle.trees.flat().filter(Boolean).length,
                booths: puzzle.solution.flat().filter(Boolean).length,
                target: LEVELS[levelIndex].booths,
            }));
            expect(counts.trees).toBe(counts.target);
            expect(counts.booths).toBe(counts.target);
        });

        test('the clues match the solution row and column totals', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const counts = boothCounts(puzzle.solution);
                return JSON.stringify(counts.rows) === JSON.stringify(puzzle.rowClue) &&
                       JSON.stringify(counts.cols) === JSON.stringify(puzzle.colClue);
            });
            expect(ok).toBe(true);
        });

        test('the booths-left readout starts at the full count', async ({ page }) => {
            await expect(page.locator('#booths-left')).toHaveText('10');
        });

        test('the small camp button is the active level', async ({ page }) => {
            await expect(page.locator('.level-btn[data-level="0"]')).toHaveClass(/active/);
        });
    });

    // -----------------------------------------------------------------------
    // Neighbourhood helpers
    // -----------------------------------------------------------------------
    test.describe('neighbour helpers', () => {
        test('neighbours4 gives four cells in the middle of the board', async ({ page }) => {
            expect(await page.evaluate(() => neighbours4(3, 3, 8).length)).toBe(4);
        });

        test('neighbours4 clips at a corner', async ({ page }) => {
            expect(await page.evaluate(() => neighbours4(0, 0, 8).length)).toBe(2);
        });

        test('neighbours8 gives eight cells in the middle of the board', async ({ page }) => {
            expect(await page.evaluate(() => neighbours8(3, 3, 8).length)).toBe(8);
        });

        test('neighbours8 clips at a corner', async ({ page }) => {
            expect(await page.evaluate(() => neighbours8(0, 0, 8).length)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Pure rule functions
    // -----------------------------------------------------------------------
    test.describe('boothCounts', () => {
        test('counts booths per row and per column', async ({ page }) => {
            const counts = await page.evaluate(() => boothCounts([
                [1, 0, 0],
                [0, 0, 1],
                [1, 0, 1],
            ]));
            expect(counts.rows).toEqual([1, 1, 2]);
            expect(counts.cols).toEqual([2, 0, 2]);
        });

        test('sand marks are not counted as booths', async ({ page }) => {
            const counts = await page.evaluate(() => boothCounts([
                [SAND, SAND],
                [SAND, BOOTH],
            ]));
            expect(counts.rows).toEqual([0, 1]);
        });
    });

    test.describe('touchingBooths', () => {
        test('flags two booths side by side', async ({ page }) => {
            const bad = await page.evaluate(() => [...touchingBooths([[1, 1], [0, 0]])].sort());
            expect(bad).toEqual(['0,0', '0,1']);
        });

        test('flags two booths that touch only at a corner', async ({ page }) => {
            const bad = await page.evaluate(() => [...touchingBooths([[1, 0], [0, 1]])].sort());
            expect(bad).toEqual(['0,0', '1,1']);
        });

        test('a lone booth is never flagged', async ({ page }) => {
            const bad = await page.evaluate(() => touchingBooths([[1, 0], [0, 0]]).size);
            expect(bad).toBe(0);
        });

        test('booths a clear cell apart are not flagged', async ({ page }) => {
            const bad = await page.evaluate(() => touchingBooths([
                [1, 0, 1],
                [0, 0, 0],
                [1, 0, 1],
            ]).size);
            expect(bad).toBe(0);
        });
    });

    test.describe('maxMatching (one booth per palm)', () => {
        test('a booth beside a palm matches it', async ({ page }) => {
            const n = await page.evaluate(() => maxMatching([[0, 0]], [[0, 1]]));
            expect(n).toBe(1);
        });

        test('a booth away from every palm matches nothing', async ({ page }) => {
            const n = await page.evaluate(() => maxMatching([[0, 0]], [[2, 2]]));
            expect(n).toBe(0);
        });

        test('a diagonal palm does not count as beside a booth', async ({ page }) => {
            const n = await page.evaluate(() => maxMatching([[0, 0]], [[1, 1]]));
            expect(n).toBe(0);
        });

        test('two booths sharing one palm can only match once', async ({ page }) => {
            const n = await page.evaluate(() => maxMatching([[1, 1]], [[0, 1], [2, 1]]));
            expect(n).toBe(1);
        });

        test('two booths with a palm each match twice', async ({ page }) => {
            const n = await page.evaluate(() => maxMatching([[0, 0], [3, 3]], [[0, 1], [3, 2]]));
            expect(n).toBe(2);
        });

        test('re-assigns an earlier booth to free a palm when it can', async ({ page }) => {
            // Booth A sits between both palms; booth B touches only the second.
            const n = await page.evaluate(() => maxMatching([[0, 1], [0, 3]], [[0, 2], [1, 3]]));
            expect(n).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Win condition
    // -----------------------------------------------------------------------
    test.describe('isSolved', () => {
        test('the generated solution solves the puzzle', async ({ page }) => {
            const ok = await page.evaluate(() => isSolved(puzzle, puzzle.solution));
            expect(ok).toBe(true);
        });

        test('sand marks alongside the right booths still solve it', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const m = puzzle.solution.map((row) => row.map((v) => (v ? BOOTH : SAND)));
                return isSolved(puzzle, m);
            });
            expect(ok).toBe(true);
        });

        test('an empty board is not solved', async ({ page }) => {
            const ok = await page.evaluate(() => isSolved(puzzle, marks));
            expect(ok).toBe(false);
        });

        test('one booth short is not solved', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const m = puzzle.solution.map((row) => row.slice());
                outer: for (let r = 0; r < size; r++)
                    for (let c = 0; c < size; c++) if (m[r][c] === BOOTH) { m[r][c] = EMPTY; break outer; }
                return isSolved(puzzle, m);
            });
            expect(ok).toBe(false);
        });

        test('right counts but two booths touching is not solved', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const p = {
                    size: 3,
                    trees: [[0, 0, 1], [0, 0, 0], [0, 0, 0]].map((r) => r.map(Boolean)),
                    rowClue: [1, 1, 0],
                    colClue: [0, 0, 2],
                    solution: null,
                };
                // Both booths in column 2, stacked — they touch.
                const m = [[0, 0, BOOTH], [0, 0, BOOTH], [0, 0, 0]];
                return isSolved(p, m);
            });
            expect(ok).toBe(false);
        });

        test('right counts and no touching but a palm left unused is not solved', async ({ page }) => {
            const ok = await page.evaluate(() => {
                // Two palms: one at (0,1), one at (3,0). Both booths sit beside the
                // first palm, so the palm at (3,0) is left without a booth.
                const p = {
                    size: 4,
                    trees: [
                        [false, true, false, false],
                        [false, false, false, false],
                        [false, false, false, false],
                        [true, false, false, false],
                    ],
                    rowClue: [2, 0, 0, 0],
                    colClue: [1, 0, 1, 0],
                    solution: null,
                };
                const m = [
                    [BOOTH, 0, BOOTH, 0],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0],
                ];
                return {
                    solved: isSolved(p, m),
                    touching: touchingBooths(m).size,
                    rows: boothCounts(m).rows.join(),
                };
            });
            expect(ok).toEqual({ solved: false, touching: 0, rows: '2,0,0,0' });
        });
    });

    test.describe('violations and clue trouble', () => {
        test('touching booths are reported as violations', async ({ page }) => {
            const n = await page.evaluate(() => {
                const m = marks.map((row) => row.slice());
                m[0][0] = BOOTH;
                m[0][1] = BOOTH;
                return violations(puzzle, m).size;
            });
            expect(n).toBe(2);
        });

        test('a booth on a palm tree is a violation', async ({ page }) => {
            const n = await page.evaluate(() => {
                const m = marks.map((row) => row.slice());
                let key = null;
                outer: for (let r = 0; r < size; r++)
                    for (let c = 0; c < size; c++) if (puzzle.trees[r][c]) { m[r][c] = BOOTH; key = r + ',' + c; break outer; }
                return violations(puzzle, m).has(key) ? 1 : 0;
            });
            expect(n).toBe(1);
        });

        test('too many booths in a row is flagged as clue trouble', async ({ page }) => {
            const flagged = await page.evaluate(() => {
                // Pick the row with the smallest clue and put one booth too many in it.
                let row = 0;
                for (let r = 1; r < size; r++) if (puzzle.rowClue[r] < puzzle.rowClue[row]) row = r;
                const m = marks.map((x) => x.slice());
                let want = puzzle.rowClue[row] + 1;
                for (let c = 0; c < size && want > 0; c += 2) { m[row][c] = BOOTH; want--; }
                return clueTrouble(puzzle, m).rows.has(row);
            });
            expect(flagged).toBe(true);
        });

        test('an empty board has no clue trouble', async ({ page }) => {
            const t = await page.evaluate(() => {
                const bad = clueTrouble(puzzle, marks);
                return bad.rows.size + bad.cols.size;
            });
            expect(t).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Puzzle generation
    // -----------------------------------------------------------------------
    test.describe('generatePuzzle', () => {
        test('is deterministic for a given level and seed', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = generatePuzzle(0, 7);
                const b = generatePuzzle(0, 7);
                return JSON.stringify(a) === JSON.stringify(b);
            });
            expect(same).toBe(true);
        });

        test('different seeds give different camps', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = generatePuzzle(0, 7);
                const b = generatePuzzle(0, 8);
                return JSON.stringify(a.trees) === JSON.stringify(b.trees);
            });
            expect(same).toBe(false);
        });

        test('no palm tree sits where a booth goes', async ({ page }) => {
            const clash = await page.evaluate(() => {
                for (let seed = 1; seed <= 6; seed++) {
                    const p = generatePuzzle(0, seed);
                    for (let r = 0; r < p.size; r++)
                        for (let c = 0; c < p.size; c++)
                            if (p.trees[r][c] && p.solution[r][c]) return true;
                }
                return false;
            });
            expect(clash).toBe(false);
        });

        test('generated puzzles have exactly one solution', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const out = [];
                for (let seed = 1; seed <= 5; seed++) {
                    const p = generatePuzzle(0, seed);
                    out.push(countSolutions(p.trees, p.rowClue, p.colClue, 3));
                }
                return out;
            });
            expect(counts).toEqual([1, 1, 1, 1, 1]);
        });

        test('each level has its own size and booth count', async ({ page }) => {
            const shapes = await page.evaluate(() => LEVELS.map((lvl, i) => {
                const p = generatePuzzle(i, 3);
                return [p.size, lvl.size, p.solution.flat().filter(Boolean).length, lvl.booths];
            }));
            for (const [size, wantSize, booths, wantBooths] of shapes) {
                expect(size).toBe(wantSize);
                expect(booths).toBe(wantBooths);
            }
        });

        test('every level generates a solvable camp', async ({ page }) => {
            const ok = await page.evaluate(() => LEVELS.every((_, i) => {
                const p = generatePuzzle(i, 11);
                return isSolved(p, p.solution);
            }));
            expect(ok).toBe(true);
        });
    });

    test.describe('countSolutions', () => {
        test('finds the single answer to a tiny camp', async ({ page }) => {
            const n = await page.evaluate(() => {
                // One palm at (0,0); the only booth spot allowed by the clues is (0,1).
                const trees = [[true, false], [false, false]];
                return countSolutions(trees, [1, 0], [0, 1], 5);
            });
            expect(n).toBe(1);
        });

        test('reports no answer when the clues cannot be met', async ({ page }) => {
            const n = await page.evaluate(() => {
                const trees = [[true, false], [false, false]];
                return countSolutions(trees, [0, 0], [0, 0], 5);
            });
            expect(n).toBe(0);
        });

        test('counts both answers of an ambiguous camp', async ({ page }) => {
            const n = await page.evaluate(() => {
                // Palms at (0,1) and (2,1) on a 3x3 with one booth in the top row
                // and one in the bottom row, one in each outer column: the pair can
                // run either diagonal, so there are two answers.
                const trees = [
                    [false, true, false],
                    [false, false, false],
                    [false, true, false],
                ];
                return countSolutions(trees, [1, 0, 1], [1, 0, 1], 5);
            });
            expect(n).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Interaction
    // -----------------------------------------------------------------------
    test.describe('placing booths', () => {
        test('clicking an open cell pitches a booth', async ({ page }) => {
            const spot = await page.evaluate(() => {
                for (let r = 0; r < size; r++)
                    for (let c = 0; c < size; c++) if (!puzzle.trees[r][c]) return [r, c];
            });
            await clickCell(page, spot[0], spot[1]);
            expect(await page.evaluate(([r, c]) => marks[r][c] === BOOTH, spot)).toBe(true);
        });

        test('a second click lays down sand, a third clears the cell', async ({ page }) => {
            const spot = await page.evaluate(() => {
                for (let r = 0; r < size; r++)
                    for (let c = 0; c < size; c++) if (!puzzle.trees[r][c]) return [r, c];
            });
            await clickCell(page, spot[0], spot[1]);
            await clickCell(page, spot[0], spot[1]);
            expect(await page.evaluate(([r, c]) => marks[r][c] === SAND, spot)).toBe(true);
            await clickCell(page, spot[0], spot[1]);
            expect(await page.evaluate(([r, c]) => marks[r][c] === EMPTY, spot)).toBe(true);
        });

        test('a palm tree cell cannot be marked', async ({ page }) => {
            const tree = await page.evaluate(() => {
                for (let r = 0; r < size; r++)
                    for (let c = 0; c < size; c++) if (puzzle.trees[r][c]) return [r, c];
            });
            await clickCell(page, tree[0], tree[1]);
            expect(await page.evaluate(([r, c]) => marks[r][c] === EMPTY, tree)).toBe(true);
        });

        test('right-clicking cycles the other way, straight to sand', async ({ page }) => {
            const spot = await page.evaluate(() => {
                for (let r = 0; r < size; r++)
                    for (let c = 0; c < size; c++) if (!puzzle.trees[r][c]) return [r, c];
            });
            await clickCell(page, spot[0], spot[1], { button: 'right' });
            expect(await page.evaluate(([r, c]) => marks[r][c] === SAND, spot)).toBe(true);
        });

        test('the booths-left readout counts down as booths go up', async ({ page }) => {
            const spot = await page.evaluate(() => {
                for (let r = 0; r < size; r++)
                    for (let c = 0; c < size; c++) if (!puzzle.trees[r][c]) return [r, c];
            });
            await clickCell(page, spot[0], spot[1]);
            await expect(page.locator('#booths-left')).toHaveText('9');
        });

        test('the status line warns when two booths touch', async ({ page }) => {
            await page.evaluate(() => {
                marks[0][0] = BOOTH;
                marks[0][1] = BOOTH;
                render();
            });
            await expect(page.locator('#status')).toContainText('touch');
        });

        test('placing a booth repaints the canvas', async ({ page }) => {
            const before = await page.evaluate(() => canvas.toDataURL());
            const spot = await page.evaluate(() => {
                for (let r = 0; r < size; r++)
                    for (let c = 0; c < size; c++) if (!puzzle.trees[r][c]) return [r, c];
            });
            await clickCell(page, spot[0], spot[1]);
            const after = await page.evaluate(() => canvas.toDataURL());
            expect(after).not.toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Buttons
    // -----------------------------------------------------------------------
    test.describe('controls', () => {
        test('reset clears every mark but keeps the camp', async ({ page }) => {
            const treesBefore = await page.evaluate(() => JSON.stringify(puzzle.trees));
            await page.evaluate(() => { marks[0][0] = BOOTH; render(); });
            await page.locator('#btn-reset').click();
            expect(await page.evaluate(() => marks.flat().every((v) => v === EMPTY))).toBe(true);
            expect(await page.evaluate(() => JSON.stringify(puzzle.trees))).toBe(treesBefore);
        });

        test('new camp changes the puzzle and clears marks', async ({ page }) => {
            const before = await page.evaluate(() => JSON.stringify(puzzle.trees));
            await page.evaluate(() => { marks[0][0] = BOOTH; render(); });
            await page.locator('#btn-new').click();
            expect(await page.evaluate(() => JSON.stringify(puzzle.trees))).not.toBe(before);
            expect(await page.evaluate(() => marks.flat().every((v) => v === EMPTY))).toBe(true);
        });

        test('choosing the large camp resizes the board', async ({ page }) => {
            await page.locator('.level-btn[data-level="2"]').click();
            expect(await page.evaluate(() => size)).toBe(12);
            await expect(page.locator('.level-btn[data-level="2"]')).toHaveClass(/active/);
            await expect(page.locator('.level-btn[data-level="0"]')).not.toHaveClass(/active/);
            await expect(page.locator('#booths-left')).toHaveText('22');
        });

        test('the level name is shown in the readout', async ({ page }) => {
            await page.locator('.level-btn[data-level="1"]').click();
            await expect(page.locator('#level-label')).toHaveText('Middle camp');
        });

        test('a hint pitches one booth from the solution', async ({ page }) => {
            await page.locator('#btn-hint').click();
            const ok = await page.evaluate(() => {
                let placed = 0, wrong = 0;
                for (let r = 0; r < size; r++)
                    for (let c = 0; c < size; c++) {
                        if (marks[r][c] !== BOOTH) continue;
                        placed++;
                        if (!puzzle.solution[r][c]) wrong++;
                    }
                return { placed, wrong };
            });
            expect(ok).toEqual({ placed: 1, wrong: 0 });
            await expect(page.locator('#booths-left')).toHaveText('9');
        });

        test('repeated hints never duplicate a booth', async ({ page }) => {
            await page.locator('#btn-hint').click();
            await page.locator('#btn-hint').click();
            await page.locator('#btn-hint').click();
            const placed = await page.evaluate(() => marks.flat().filter((v) => v === BOOTH).length);
            expect(placed).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('solving the camp', () => {
        test('clicking every solution cell wins the game', async ({ page }) => {
            for (const [r, c] of await solutionCells(page)) await clickCell(page, r, c);
            expect(await page.evaluate(() => solved)).toBe(true);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#status')).toContainText('Camp complete');
            await expect(page.locator('#booths-left')).toHaveText('0');
        });

        test('the board is frozen once the camp is complete', async ({ page }) => {
            for (const [r, c] of await solutionCells(page)) await clickCell(page, r, c);
            const spot = await page.evaluate(() => {
                for (let r = 0; r < size; r++)
                    for (let c = 0; c < size; c++)
                        if (!puzzle.trees[r][c] && marks[r][c] === EMPTY) return [r, c];
            });
            await clickCell(page, spot[0], spot[1]);
            expect(await page.evaluate(([r, c]) => marks[r][c] === EMPTY, spot)).toBe(true);
        });

        test('a new camp after winning clears the overlay', async ({ page }) => {
            for (const [r, c] of await solutionCells(page)) await clickCell(page, r, c);
            await page.locator('#btn-new').click();
            expect(await page.evaluate(() => solved)).toBe(false);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Theme
    // -----------------------------------------------------------------------
    test.describe('theme', () => {
        test('the page names the feast and its verse', async ({ page }) => {
            await expect(page.locator('h1')).toHaveText(/Feast of Booths/i);
            await expect(page.locator('#verse')).toContainText('Leviticus 23:42');
        });

        test('the rules explain palms, booths and counts', async ({ page }) => {
            const rules = page.locator('#rules');
            await expect(rules).toContainText('palm');
            await expect(rules).toContainText('booth');
        });
    });
});
