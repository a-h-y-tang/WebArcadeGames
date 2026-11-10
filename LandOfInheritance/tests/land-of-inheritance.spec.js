const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// ---------------------------------------------------------------------------
// Helpers — the canvas renders 1:1 at the default viewport, so cell centres in
// board coordinates double as click / drag positions.
// ---------------------------------------------------------------------------
async function cellCentre(page, r, c) {
    return page.evaluate(([r, c]) => cellCentre(r, c), [r, c]);
}

async function dragCells(page, r1, c1, r2, c2) {
    const box = await page.locator('#canvas').boundingBox();
    const a = await cellCentre(page, r1, c1);
    const b = await cellCentre(page, r2, c2);
    await page.mouse.move(box.x + a.x, box.y + a.y);
    await page.mouse.down();
    await page.mouse.move(box.x + (a.x + b.x) / 2, box.y + (a.y + b.y) / 2);
    await page.mouse.move(box.x + b.x, box.y + b.y);
    await page.mouse.up();
}

async function clickCell(page, r, c, options = {}) {
    const pos = await cellCentre(page, r, c);
    await page.locator('#canvas').click({ position: pos, ...options });
}

// The generated solution: one rectangle per numbered boundary stone.
async function solutionRects(page) {
    return page.evaluate(() => puzzle.solution.map((s) => ({ r: s.r, c: s.c, w: s.w, h: s.h, n: s.n })));
}

// Draw every rectangle of the solution, which must finish the puzzle.
async function solvePuzzle(page) {
    const rects = await solutionRects(page);
    for (const s of rects) {
        await dragCells(page, s.r, s.c, s.r + s.h - 1, s.c + s.w - 1);
    }
}

test.describe('Land of Inheritance', () => {
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
        test('page title is Land of Inheritance', async ({ page }) => {
            await expect(page).toHaveTitle('Land of Inheritance');
        });

        test('canvas is 460x460', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '460');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('loads with no page or console errors', async ({ page }) => {
            await page.waitForTimeout(200);
            expect(errors).toEqual([]);
        });

        test('the whole board fits inside the canvas', async ({ page }) => {
            const fits = await page.evaluate(() =>
                ORIGIN_X >= 0 &&
                ORIGIN_Y >= 0 &&
                ORIGIN_X + cols * cellSize <= canvas.width + 0.001 &&
                ORIGIN_Y + rows * cellSize <= canvas.height + 0.001);
            expect(fits).toBe(true);
        });

        test('starts on the hill country: 7x7', async ({ page }) => {
            expect(await page.evaluate(() => [cols, rows])).toEqual([7, 7]);
            expect(await page.evaluate(() => LEVELS[levelIndex].name)).toBe('Hill country');
            await expect(page.locator('#level-label')).toHaveText('Hill country');
        });

        test('three lands are offered, each larger than the last', async ({ page }) => {
            const sizes = await page.evaluate(() => LEVELS.map((l) => l.cols * l.rows));
            expect(sizes).toHaveLength(3);
            expect(sizes[0]).toBeLessThan(sizes[1]);
            expect(sizes[1]).toBeLessThan(sizes[2]);
        });

        test('no allotments are marked out yet', async ({ page }) => {
            expect(await page.evaluate(() => regions.length)).toBe(0);
            expect(await page.evaluate(() => isSolved())).toBe(false);
        });

        test('the HUD counts allotments and land claimed', async ({ page }) => {
            const total = await page.evaluate(() => puzzle.solution.length);
            await expect(page.locator('#allotments')).toHaveText(`0 / ${total}`);
            await expect(page.locator('#claimed')).toHaveText('0 / 49');
        });

        test('the win overlay is hidden', async ({ page }) => {
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -------------------------------------------------------------------
    // The generated puzzle
    // -------------------------------------------------------------------
    test.describe('puzzle generation', () => {
        test('the solution covers every square exactly once', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const seen = Array.from({ length: rows }, () => new Array(cols).fill(0));
                for (const s of puzzle.solution)
                    for (let r = s.r; r < s.r + s.h; r++)
                        for (let c = s.c; c < s.c + s.w; c++) seen[r][c]++;
                return seen.flat();
            });
            expect(counts.every((n) => n === 1)).toBe(true);
        });

        test('every allotment holds between two squares and the level maximum', async ({ page }) => {
            const bad = await page.evaluate(() => {
                const max = LEVELS[levelIndex].maxArea;
                return puzzle.solution.filter((s) => s.w * s.h < 2 || s.w * s.h > max).length;
            });
            expect(bad).toBe(0);
        });

        test('every allotment carries exactly one boundary stone, numbered with its size', async ({ page }) => {
            const report = await page.evaluate(() => {
                const inside = (s, clue) =>
                    clue.r >= s.r && clue.r < s.r + s.h && clue.c >= s.c && clue.c < s.c + s.w;
                return puzzle.solution.map((s) => {
                    const held = puzzle.clues.filter((clue) => inside(s, clue));
                    return { count: held.length, matches: held.length === 1 && held[0].n === s.w * s.h };
                });
            });
            expect(report.every((x) => x.count === 1 && x.matches)).toBe(true);
            expect(report.length).toBeGreaterThan(3);
        });

        test('there are as many boundary stones as allotments', async ({ page }) => {
            const [clues, sol] = await page.evaluate(() => [puzzle.clues.length, puzzle.solution.length]);
            expect(clues).toBe(sol);
        });

        test('every allotment is named after a tribe of Israel', async ({ page }) => {
            const ok = await page.evaluate(() =>
                puzzle.solution.every((s) => TRIBES.includes(s.tribe)));
            expect(ok).toBe(true);
        });

        test('the same seed always builds the same land', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = buildPuzzle(9, 9, 8, 1234);
                const b = buildPuzzle(9, 9, 8, 1234);
                return JSON.stringify(a) === JSON.stringify(b);
            });
            expect(same).toBe(true);
        });

        test('different seeds build different lands', async ({ page }) => {
            const differ = await page.evaluate(() => {
                const a = JSON.stringify(buildPuzzle(9, 9, 8, 1));
                const b = JSON.stringify(buildPuzzle(9, 9, 8, 2));
                return a !== b;
            });
            expect(differ).toBe(true);
        });

        test('the land on screen can be divided in exactly one lawful way', async ({ page }) => {
            expect(await page.evaluate(() => countSolutions(puzzle, 3))).toBe(1);
        });

        test('every candidate field for a stone holds it, and only it, at the right size', async ({ page }) => {
            const report = await page.evaluate(() => {
                const clue = puzzle.clues[0];
                const options = rectOptionsFor(clue, puzzle.clues, cols, rows);
                return {
                    count: options.length,
                    ok: options.every((rect) =>
                        rect.w * rect.h === clue.n &&
                        cluesInRect(rect, puzzle.clues).length === 1 &&
                        rect.r >= 0 && rect.c >= 0 &&
                        rect.r + rect.h <= rows && rect.c + rect.w <= cols),
                    includesAnswer: options.some((rect) =>
                        puzzle.solution.some((s) =>
                            s.r === rect.r && s.c === rect.c && s.w === rect.w && s.h === rect.h)),
                };
            });
            expect(report.count).toBeGreaterThan(0);
            expect(report.ok).toBe(true);
            expect(report.includesAnswer).toBe(true);
        });

        test('every level builds lands with a single lawful division', async ({ page }) => {
            const report = await page.evaluate(() => {
                const out = [];
                for (const level of LEVELS) {
                    let unique = 0;
                    const seeds = 12;
                    for (let seed = 1; seed <= seeds; seed++) {
                        const p = buildPuzzle(level.cols, level.rows, level.maxArea, seed);
                        if (countSolutions(p, 2) === 1) unique++;
                    }
                    out.push({ name: level.name, unique, seeds });
                }
                return out;
            });
            for (const level of report) expect(level.unique).toBe(level.seeds);
        });

        test('the land on screen needs no guessing', async ({ page }) => {
            expect(await page.evaluate(() => isDeducible(puzzle))).toBe(true);
        });

        test('lands can be worked out by forced moves alone', async ({ page }) => {
            const report = await page.evaluate(() => LEVELS.map((level) => {
                const seeds = 10;
                let deducible = 0;
                let unique = 0;
                for (let seed = 1; seed <= seeds; seed++) {
                    const p = buildPuzzle(level.cols, level.rows, level.maxArea, seed);
                    if (isDeducible(p)) deducible++;
                    if (countSolutions(p, 2) === 1) unique++;
                }
                return { name: level.name, deducible, unique, seeds };
            }));
            for (const level of report) {
                expect(level.unique).toBe(level.seeds);              // never ambiguous
                expect(level.deducible).toBeGreaterThanOrEqual(level.seeds - 1);
            }
        });

        test('a land that needs guessing is rejected by the deduction check', async ({ page }) => {
            // Four stones of 2 in a 2x4 strip can be split two ways, so the
            // check must not call it deducible.
            const verdict = await page.evaluate(() => {
                const ambiguous = {
                    cols: 2, rows: 2,
                    clues: [{ r: 0, c: 0, n: 2, tribe: 'Judah' }, { r: 1, c: 1, n: 2, tribe: 'Dan' }],
                    solution: [],
                };
                return { deducible: isDeducible(ambiguous), solutions: countSolutions(ambiguous, 3) };
            });
            expect(verdict.solutions).toBe(2);
            expect(verdict.deducible).toBe(false);
        });

        test('fields are roomy: four squares each on average, never under three and a half', async ({ page }) => {
            const report = await page.evaluate(() => LEVELS.map((level) => {
                const cells = level.cols * level.rows;
                let fields = 0;
                let worst = 0;
                const seeds = 12;
                for (let seed = 1; seed <= seeds; seed++) {
                    const p = buildPuzzle(level.cols, level.rows, level.maxArea, seed);
                    fields += p.solution.length;
                    worst = Math.max(worst, p.solution.length);
                }
                return { name: level.name, average: cells / (fields / seeds), worst: cells / worst };
            }));
            for (const level of report) {
                expect(level.average).toBeGreaterThanOrEqual(4);
                expect(level.worst).toBeGreaterThan(3.5);
            }
        });

        test('two-square fields stay a minority of the land', async ({ page }) => {
            const shares = await page.evaluate(() => LEVELS.map((level) => {
                let fields = 0;
                let twos = 0;
                for (let seed = 1; seed <= 12; seed++) {
                    const p = buildPuzzle(level.cols, level.rows, level.maxArea, seed);
                    fields += p.solution.length;
                    twos += p.solution.filter((s) => s.w * s.h === 2).length;
                }
                return twos / fields;
            }));
            for (const share of shares) expect(share).toBeLessThan(0.3);
        });

        test('generation holds for every level across many seeds', async ({ page }) => {
            const bad = await page.evaluate(() => {
                const failures = [];
                for (const level of LEVELS) {
                    for (let seed = 1; seed <= 40; seed++) {
                        const p = buildPuzzle(level.cols, level.rows, level.maxArea, seed);
                        const seen = Array.from({ length: level.rows }, () => new Array(level.cols).fill(0));
                        for (const s of p.solution) {
                            const area = s.w * s.h;
                            if (area < 2 || area > level.maxArea) failures.push(`${level.name}/${seed}/area${area}`);
                            for (let r = s.r; r < s.r + s.h; r++)
                                for (let c = s.c; c < s.c + s.w; c++) seen[r][c]++;
                        }
                        if (!seen.flat().every((n) => n === 1)) failures.push(`${level.name}/${seed}/cover`);
                        if (p.clues.length !== p.solution.length) failures.push(`${level.name}/${seed}/clues`);
                    }
                }
                return failures.slice(0, 5);
            });
            expect(bad).toEqual([]);
        });
    });

    // -------------------------------------------------------------------
    // Pure rules
    // -------------------------------------------------------------------
    test.describe('rules', () => {
        test('a drag is read the same way in all four directions', async ({ page }) => {
            const rects = await page.evaluate(() => [
                normalizeRect(1, 2, 3, 5),
                normalizeRect(3, 5, 1, 2),
                normalizeRect(3, 2, 1, 5),
                normalizeRect(1, 5, 3, 2),
            ]);
            for (const rect of rects) expect(rect).toEqual({ r: 1, c: 2, w: 4, h: 3 });
        });

        test('overlapping rectangles are detected', async ({ page }) => {
            const results = await page.evaluate(() => [
                rectsOverlap({ r: 0, c: 0, w: 2, h: 2 }, { r: 1, c: 1, w: 2, h: 2 }),
                rectsOverlap({ r: 0, c: 0, w: 2, h: 2 }, { r: 0, c: 2, w: 2, h: 2 }),
                rectsOverlap({ r: 0, c: 0, w: 2, h: 2 }, { r: 2, c: 0, w: 2, h: 2 }),
                rectsOverlap({ r: 0, c: 0, w: 3, h: 3 }, { r: 1, c: 1, w: 1, h: 1 }),
            ]);
            expect(results).toEqual([true, false, false, true]);
        });

        test('the stones inside a rectangle can be counted', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const clue = puzzle.clues[0];
                return [
                    cluesInRect({ r: clue.r, c: clue.c, w: 1, h: 1 }).length,
                    cluesInRect({ r: 0, c: 0, w: cols, h: rows }).length,
                ];
            });
            expect(counts[0]).toBe(1);
            expect(counts[1]).toBe(await page.evaluate(() => puzzle.clues.length));
        });

        test('an allotment is exact only when its size matches its stone', async ({ page }) => {
            const [exact, wrong] = await page.evaluate(() => {
                const s = puzzle.solution[0];
                const full = { r: s.r, c: s.c, w: s.w, h: s.h };
                const clue = cluesInRect(full)[0];
                const small = { r: clue.r, c: clue.c, w: 1, h: 1 };
                return [isExact(full), isExact(small) && clue.n !== 1];
            });
            expect(exact).toBe(true);
            expect(wrong).toBe(false);
        });
    });

    // -------------------------------------------------------------------
    // Marking out allotments with the mouse
    // -------------------------------------------------------------------
    test.describe('marking out allotments', () => {
        test('dragging over an allotment of the solution claims it', async ({ page }) => {
            const s = (await solutionRects(page))[0];
            await dragCells(page, s.r, s.c, s.r + s.h - 1, s.c + s.w - 1);
            expect(await page.evaluate(() => regions.length)).toBe(1);
            expect(await page.evaluate(() => regions[0])).toEqual({ r: s.r, c: s.c, w: s.w, h: s.h });
            const total = await page.evaluate(() => puzzle.solution.length);
            await expect(page.locator('#allotments')).toHaveText(`1 / ${total}`);
            await expect(page.locator('#claimed')).toHaveText(`${s.n} / 49`);
        });

        test('an allotment that overlaps one already marked out is refused', async ({ page }) => {
            const s = (await solutionRects(page))[0];
            await dragCells(page, s.r, s.c, s.r + s.h - 1, s.c + s.w - 1);
            // A second field that takes in one square of the first one.
            const clash = await page.evaluate(([r, c, h, w]) =>
                (r + h < rows ? { r1: r, c1: c, r2: r + h, c2: c }
                    : { r1: r, c1: c, r2: r, c2: c + w }), [s.r, s.c, s.h, s.w]);
            await dragCells(page, clash.r1, clash.c1, clash.r2, clash.c2);
            expect(await page.evaluate(() => regions.length)).toBe(1);
            await expect(page.locator('#status')).toHaveClass(/bad/);
            await expect(page.locator('#status')).toContainText(/already/i);
        });

        test('an allotment with no boundary stone is refused', async ({ page }) => {
            const empty = await page.evaluate(() => {
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c + 1 < cols; c++) {
                        const rect = { r, c, w: 2, h: 1 };
                        if (cluesInRect(rect).length === 0) return rect;
                    }
                return null;
            });
            expect(empty).not.toBeNull();
            await dragCells(page, empty.r, empty.c, empty.r, empty.c + 1);
            expect(await page.evaluate(() => regions.length)).toBe(0);
            await expect(page.locator('#status')).toContainText(/stone/i);
        });

        test('an allotment holding two boundary stones is refused', async ({ page }) => {
            await dragCells(page, 0, 0, 6, 6);
            expect(await page.evaluate(() => regions.length)).toBe(0);
            await expect(page.locator('#status')).toHaveClass(/bad/);
        });

        test('an allotment of the wrong size is kept but not counted as exact', async ({ page }) => {
            const found = await page.evaluate(() => {
                for (const clue of puzzle.clues) {
                    if (clue.n === 2) continue;
                    const rect = { r: clue.r, c: clue.c, w: 2, h: 1 };
                    if (clue.c + 1 < cols && cluesInRect(rect).length === 1) return { rect, n: clue.n };
                }
                return null;
            });
            expect(found).not.toBeNull();
            await dragCells(page, found.rect.r, found.rect.c, found.rect.r, found.rect.c + 1);
            expect(await page.evaluate(() => regions.length)).toBe(1);
            expect(await page.evaluate(() => isExact(regions[0]))).toBe(false);
            const total = await page.evaluate(() => puzzle.solution.length);
            await expect(page.locator('#allotments')).toHaveText(`0 / ${total}`);
            await expect(page.locator('#claimed')).toHaveText('2 / 49');
        });

        test('clicking inside an allotment clears it', async ({ page }) => {
            const s = (await solutionRects(page))[0];
            await dragCells(page, s.r, s.c, s.r + s.h - 1, s.c + s.w - 1);
            expect(await page.evaluate(() => regions.length)).toBe(1);
            await clickCell(page, s.r, s.c);
            expect(await page.evaluate(() => regions.length)).toBe(0);
            await expect(page.locator('#claimed')).toHaveText('0 / 49');
        });

        test('right-clicking inside an allotment clears it', async ({ page }) => {
            const s = (await solutionRects(page))[0];
            await dragCells(page, s.r, s.c, s.r + s.h - 1, s.c + s.w - 1);
            await clickCell(page, s.r + s.h - 1, s.c + s.w - 1, { button: 'right' });
            expect(await page.evaluate(() => regions.length)).toBe(0);
        });

        test('a drag that leaves the board is clamped to the land', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            const a = await cellCentre(page, 0, 0);
            await page.mouse.move(box.x + a.x, box.y + a.y);
            await page.mouse.down();
            await page.mouse.move(box.x - 200, box.y - 200);
            await page.mouse.up();
            const inside = await page.evaluate(() =>
                regions.every((g) => g.r >= 0 && g.c >= 0 && g.r + g.h <= rows && g.c + g.w <= cols));
            expect(inside).toBe(true);
        });
    });

    // -------------------------------------------------------------------
    // Keyboard play
    // -------------------------------------------------------------------
    test.describe('keyboard play', () => {
        test('the arrow keys move the cursor over the land', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => [cursor.r, cursor.c])).toEqual([2, 1]);
        });

        test('the cursor box stays hidden until a key is pressed', async ({ page }) => {
            expect(await page.evaluate(() => keyboardActive)).toBe(false);
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => keyboardActive)).toBe(true);
            await page.locator('#btn-new').click();
            expect(await page.evaluate(() => keyboardActive)).toBe(false);
        });

        test('the cursor stops at the edge of the land', async ({ page }) => {
            for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp');
            for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => [cursor.r, cursor.c])).toEqual([0, 0]);
        });

        test('space anchors a corner and space again marks the allotment out', async ({ page }) => {
            const s = (await solutionRects(page))[0];
            await page.evaluate(([r, c]) => { cursor.r = r; cursor.c = c; draw(); }, [s.r, s.c]);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => anchor !== null)).toBe(true);
            for (let i = 0; i < s.h - 1; i++) await page.keyboard.press('ArrowDown');
            for (let i = 0; i < s.w - 1; i++) await page.keyboard.press('ArrowRight');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => regions.length)).toBe(1);
            expect(await page.evaluate(() => anchor === null)).toBe(true);
        });

        test('escape drops the anchored corner', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => anchor !== null)).toBe(true);
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => anchor === null)).toBe(true);
            expect(await page.evaluate(() => regions.length)).toBe(0);
        });

        test('backspace clears the allotment under the cursor', async ({ page }) => {
            const s = (await solutionRects(page))[0];
            await dragCells(page, s.r, s.c, s.r + s.h - 1, s.c + s.w - 1);
            await page.evaluate(([r, c]) => { cursor.r = r; cursor.c = c; draw(); }, [s.r, s.c]);
            await page.keyboard.press('Backspace');
            expect(await page.evaluate(() => regions.length)).toBe(0);
        });
    });

    // -------------------------------------------------------------------
    // Buttons
    // -------------------------------------------------------------------
    test.describe('controls', () => {
        test('Reset clears the allotments but keeps the same land', async ({ page }) => {
            const before = await page.evaluate(() => JSON.stringify(puzzle.clues));
            const s = (await solutionRects(page))[0];
            await dragCells(page, s.r, s.c, s.r + s.h - 1, s.c + s.w - 1);
            await page.locator('#btn-reset').click();
            expect(await page.evaluate(() => regions.length)).toBe(0);
            expect(await page.evaluate(() => JSON.stringify(puzzle.clues))).toBe(before);
        });

        test('New Land deals a fresh puzzle and clears the allotments', async ({ page }) => {
            const before = await page.evaluate(() => JSON.stringify(puzzle.clues));
            const s = (await solutionRects(page))[0];
            await dragCells(page, s.r, s.c, s.r + s.h - 1, s.c + s.w - 1);
            await page.locator('#btn-new').click();
            expect(await page.evaluate(() => regions.length)).toBe(0);
            expect(await page.evaluate(() => JSON.stringify(puzzle.clues))).not.toBe(before);
            expect(await page.evaluate(() => [cols, rows])).toEqual([7, 7]);
        });

        test('Hint marks out one correct allotment', async ({ page }) => {
            await page.locator('#btn-hint').click();
            expect(await page.evaluate(() => regions.length)).toBe(1);
            expect(await page.evaluate(() => isExact(regions[0]))).toBe(true);
            expect(await page.evaluate(() => hintsUsed)).toBe(1);
            await expect(page.locator('#hints')).toHaveText('1');
        });

        test('Hint replaces a wrong allotment that is in the way', async ({ page }) => {
            const s = (await solutionRects(page))[0];
            await dragCells(page, s.r, s.c, s.r, s.c + 0);
            await page.locator('#btn-hint').click();
            const ok = await page.evaluate(() => regions.some((g) => isExact(g)));
            expect(ok).toBe(true);
            expect(await page.evaluate(() =>
                regions.every((a, i) => regions.every((b, j) => i === j || !rectsOverlap(a, b))))).toBe(true);
        });

        test('the land buttons switch to a bigger land', async ({ page }) => {
            await page.locator('.level-btn[data-level="2"]').click();
            expect(await page.evaluate(() => [cols, rows])).toEqual([11, 11]);
            await expect(page.locator('#level-label')).toHaveText(await page.evaluate(() => LEVELS[2].name));
            await expect(page.locator('.level-btn[data-level="2"]')).toHaveClass(/active/);
            await expect(page.locator('#claimed')).toHaveText('0 / 121');
        });
    });

    // -------------------------------------------------------------------
    // Winning
    // -------------------------------------------------------------------
    test.describe('dividing the whole land', () => {
        test('marking out every allotment wins the land', async ({ page }) => {
            await solvePuzzle(page);
            expect(await page.evaluate(() => isSolved())).toBe(true);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/divided/i);
            await expect(page.locator('#claimed')).toHaveText('49 / 49');
            await expect(page.locator('#status')).toHaveClass(/good/);
        });

        test('a won land cannot be scribbled on any further', async ({ page }) => {
            await solvePuzzle(page);
            const count = await page.evaluate(() => regions.length);
            // The overlay covers the board, and the board itself refuses edits.
            const after = await page.evaluate(() => {
                addRegion({ r: 0, c: 0, w: 1, h: 1 });
                removeRegionAt(0, 0);
                hint();
                return { count: regions.length, solved };
            });
            expect(after).toEqual({ count, solved: true });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('the overlay button leads on to the next land', async ({ page }) => {
            await solvePuzzle(page);
            await page.locator('#btn-next').click();
            expect(await page.evaluate(() => levelIndex)).toBe(1);
            expect(await page.evaluate(() => [cols, rows])).toEqual([9, 9]);
            expect(await page.evaluate(() => regions.length)).toBe(0);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('solving the land draws it without error', async ({ page }) => {
            await solvePuzzle(page);
            await page.waitForTimeout(100);
            expect(errors).toEqual([]);
        });
    });
});
