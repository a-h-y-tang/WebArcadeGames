const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// ---------------------------------------------------------------------------
// Helpers. The canvas renders 1:1 at the default viewport, so a cell's centre
// in board coordinates doubles as a click position.
// ---------------------------------------------------------------------------
async function clickCell(page, r, c) {
    const pos = await page.evaluate(([r, c]) => cellCentre(r, c), [r, c]);
    await page.locator('#canvas').click({ position: pos });
}

function clue(page, dir, num) {
    return page.locator(`#${dir}-list .clue[data-num="${num}"]`);
}

async function state(page) {
    return page.evaluate(() => ({
        cols: puzzle.cols,
        rows: puzzle.rows,
        seed: puzzle.seed,
        count: puzzle.entries.length,
        selection: selection && { ...selection },
        hints: hintsUsed,
        solved,
        level: levelIndex,
        letters: letters.map((row) => row.join('|')),
    }));
}

async function entryList(page) {
    return page.evaluate(() =>
        puzzle.entries.map((e) => ({ num: e.num, dir: e.dir, r: e.r, c: e.c, len: e.len, answer: e.answer }))
    );
}

// Fill in the whole scroll through the UI: click each clue, type its answer.
async function solveScroll(page) {
    const entries = await entryList(page);
    for (const e of entries) {
        await clue(page, e.dir, e.num).click();
        await page.keyboard.type(e.answer);
    }
}

test.describe("Scribe's Crossword", () => {
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
        test("page title is Scribe's Crossword", async ({ page }) => {
            await expect(page).toHaveTitle("Scribe's Crossword");
        });

        test('canvas is 460x460', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '460');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('loads with no page or console errors', async ({ page }) => {
            await page.waitForTimeout(250);
            expect(errors).toEqual([]);
        });

        test('shows a Bible reference and the first level name', async ({ page }) => {
            await expect(page.locator('#verse')).toContainText('Ezra 7:10');
            await expect(page.locator('#level-label')).toHaveText('Short scroll');
        });

        test('starts on a 9x9 scroll with at least the level minimum of words', async ({ page }) => {
            const s = await state(page);
            expect(s.cols).toBe(9);
            expect(s.rows).toBe(9);
            const min = await page.evaluate(() => LEVELS[0].minWords);
            expect(s.count).toBeGreaterThanOrEqual(min);
        });

        test('the grid starts empty and the HUD agrees', async ({ page }) => {
            const s = await state(page);
            expect(s.letters.join('')).toMatch(/^[|]*$/);
            const count = s.count;
            await expect(page.locator('#words')).toHaveText(`0 / ${count}`);
            await expect(page.locator('#hints')).toHaveText('0');
            const total = await page.evaluate(() =>
                puzzle.grid.flat().filter((ch) => ch !== null).length
            );
            await expect(page.locator('#filled')).toHaveText(`0 / ${total}`);
        });

        test('every entry gets a clue button in the Across or Down list', async ({ page }) => {
            const entries = await entryList(page);
            const across = entries.filter((e) => e.dir === 'across');
            const down = entries.filter((e) => e.dir === 'down');
            await expect(page.locator('#across-list .clue')).toHaveCount(across.length);
            await expect(page.locator('#down-list .clue')).toHaveCount(down.length);
            for (const e of entries) {
                await expect(clue(page, e.dir, e.num)).toContainText(String(e.num));
            }
        });

        test('clue buttons are listed in numbered order', async ({ page }) => {
            for (const dir of ['across', 'down']) {
                const nums = await page
                    .locator(`#${dir}-list .clue`)
                    .evaluateAll((els) => els.map((el) => Number(el.dataset.num)));
                expect(nums).toEqual([...nums].sort((a, b) => a - b));
            }
        });

        test('the first entry is selected and its clue is shown', async ({ page }) => {
            const entries = await entryList(page);
            const first = entries.reduce((a, b) => (a.num <= b.num ? a : b));
            const s = await state(page);
            expect(s.selection).toMatchObject({ r: first.r, c: first.c });
            await expect(page.locator('#current-clue')).toContainText(first.clue ?? '');
            await expect(page.locator('#current-clue')).toContainText(String(first.num));
        });
    });

    // -------------------------------------------------------------------
    // The generator: the rules that make a grid a crossword
    // -------------------------------------------------------------------
    test.describe('generated scrolls', () => {
        // Builds many scrolls per level inside the page and checks every
        // interlocking rule on each one.
        test('every generated scroll obeys the crossword rules', async ({ page }) => {
            const report = await page.evaluate(() => {
                const problems = [];
                const bank = new Map(WORD_BANK.map(([answer, clueText]) => [answer, clueText]));

                for (let level = 0; level < LEVELS.length; level++) {
                    for (let seed = 1; seed <= 12; seed++) {
                        const p = buildPuzzle(level, seed);
                        const tag = `level ${level} seed ${seed}`;
                        const { cols, rows, grid, entries } = p;

                        if (cols !== LEVELS[level].cols || rows !== LEVELS[level].rows) {
                            problems.push(`${tag}: wrong grid size`);
                        }
                        if (entries.length < LEVELS[level].minWords) {
                            problems.push(`${tag}: only ${entries.length} words`);
                        }

                        // Letters are single capitals, and the solution grid and
                        // the entries agree with each other.
                        for (let r = 0; r < rows; r++) {
                            for (let c = 0; c < cols; c++) {
                                const ch = grid[r][c];
                                if (ch !== null && !/^[A-Z]$/.test(ch)) {
                                    problems.push(`${tag}: bad letter at ${r},${c}`);
                                }
                            }
                        }

                        const answers = new Set();
                        for (const e of entries) {
                            if (answers.has(e.answer)) problems.push(`${tag}: ${e.answer} twice`);
                            answers.add(e.answer);
                            if (bank.get(e.answer) !== e.clue) {
                                problems.push(`${tag}: ${e.answer} has the wrong clue`);
                            }
                            if (e.len !== e.answer.length) problems.push(`${tag}: ${e.answer} bad len`);
                            if (e.answer.length > LEVELS[level].maxLen) {
                                problems.push(`${tag}: ${e.answer} too long for the grid`);
                            }
                            let read = '';
                            for (let i = 0; i < e.len; i++) {
                                const r = e.r + (e.dir === 'down' ? i : 0);
                                const c = e.c + (e.dir === 'across' ? i : 0);
                                if (r >= rows || c >= cols) { read = '?'; break; }
                                read += grid[r][c] ?? '?';
                            }
                            if (read !== e.answer) problems.push(`${tag}: ${e.answer} reads ${read}`);
                        }

                        // Every maximal run of 2+ letters must be an entry, and
                        // every entry must be such a run.
                        const runs = [];
                        for (let r = 0; r < rows; r++) {
                            let c = 0;
                            while (c < cols) {
                                if (grid[r][c] === null) { c++; continue; }
                                let end = c;
                                while (end + 1 < cols && grid[r][end + 1] !== null) end++;
                                if (end > c) runs.push({ dir: 'across', r, c, len: end - c + 1 });
                                c = end + 1;
                            }
                        }
                        for (let c = 0; c < cols; c++) {
                            let r = 0;
                            while (r < rows) {
                                if (grid[r][c] === null) { r++; continue; }
                                let end = r;
                                while (end + 1 < rows && grid[end + 1][c] !== null) end++;
                                if (end > r) runs.push({ dir: 'down', r, c, len: end - r + 1 });
                                r = end + 1;
                            }
                        }
                        const key = (x) => `${x.dir}:${x.r}:${x.c}:${x.len}`;
                        const runKeys = new Set(runs.map(key));
                        const entryKeys = new Set(entries.map(key));
                        for (const k of runKeys) {
                            if (!entryKeys.has(k)) problems.push(`${tag}: run ${k} is not a clued word`);
                        }
                        for (const k of entryKeys) {
                            if (!runKeys.has(k)) problems.push(`${tag}: entry ${k} is not a full run`);
                        }

                        // No letter stands on its own, and the whole grid is one
                        // connected block of letters.
                        const used = new Set();
                        for (const e of entries) {
                            for (let i = 0; i < e.len; i++) {
                                const r = e.r + (e.dir === 'down' ? i : 0);
                                const c = e.c + (e.dir === 'across' ? i : 0);
                                used.add(`${r},${c}`);
                            }
                        }
                        const cells = [];
                        for (let r = 0; r < rows; r++) {
                            for (let c = 0; c < cols; c++) {
                                if (grid[r][c] !== null) cells.push(`${r},${c}`);
                            }
                        }
                        for (const cell of cells) {
                            if (!used.has(cell)) problems.push(`${tag}: letter at ${cell} is in no word`);
                        }
                        const seen = new Set([cells[0]]);
                        const queue = [cells[0]];
                        while (queue.length) {
                            const [r, c] = queue.pop().split(',').map(Number);
                            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                                const nr = r + dr;
                                const nc = c + dc;
                                const k = `${nr},${nc}`;
                                if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
                                if (grid[nr][nc] === null || seen.has(k)) continue;
                                seen.add(k);
                                queue.push(k);
                            }
                        }
                        if (seen.size !== cells.length) problems.push(`${tag}: grid is in pieces`);

                        // Numbering: reading order, 1..n, shared where an across
                        // and a down entry start on the same cell.
                        const starts = [...new Set(entries.map((e) => `${e.r},${e.c}`))].sort((a, b) => {
                            const [ar, ac] = a.split(',').map(Number);
                            const [br, bc] = b.split(',').map(Number);
                            return ar - br || ac - bc;
                        });
                        starts.forEach((cell, i) => {
                            const [r, c] = cell.split(',').map(Number);
                            const here = entries.filter((e) => e.r === r && e.c === c);
                            for (const e of here) {
                                if (e.num !== i + 1) problems.push(`${tag}: ${e.answer} numbered ${e.num}, want ${i + 1}`);
                            }
                        });
                    }
                }
                return problems;
            });
            expect(report).toEqual([]);
        });

        test('the words sit centred on the parchment', async ({ page }) => {
            const off = await page.evaluate(() => {
                const bad = [];
                for (let level = 0; level < LEVELS.length; level++) {
                    for (let seed = 1; seed <= 8; seed++) {
                        const p = buildPuzzle(level, seed);
                        let top = p.rows, bottom = -1, left = p.cols, right = -1;
                        for (let r = 0; r < p.rows; r++) {
                            for (let c = 0; c < p.cols; c++) {
                                if (p.grid[r][c] === null) continue;
                                top = Math.min(top, r); bottom = Math.max(bottom, r);
                                left = Math.min(left, c); right = Math.max(right, c);
                            }
                        }
                        const vert = Math.abs(top - (p.rows - 1 - bottom));
                        const horz = Math.abs(left - (p.cols - 1 - right));
                        if (vert > 1 || horz > 1) bad.push(`level ${level} seed ${seed}: ${vert},${horz}`);
                    }
                }
                return bad;
            });
            expect(off).toEqual([]);
        });

        test('the same seed always builds the same scroll', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = buildPuzzle(1, 4242);
                const b = buildPuzzle(1, 4242);
                return JSON.stringify(a.entries) === JSON.stringify(b.entries);
            });
            expect(same).toBe(true);
        });

        test('the word bank is all Bible answers with clues, letters only', async ({ page }) => {
            const bad = await page.evaluate(() =>
                WORD_BANK.filter(
                    ([answer, clueText]) =>
                        !/^[A-Z]{3,9}$/.test(answer) || typeof clueText !== 'string' || clueText.length < 8
                ).map(([a]) => a)
            );
            expect(bad).toEqual([]);
            const dupes = await page.evaluate(() => {
                const seen = new Set();
                const out = [];
                for (const [a] of WORD_BANK) {
                    if (seen.has(a)) out.push(a);
                    seen.add(a);
                }
                return out;
            });
            expect(dupes).toEqual([]);
            const size = await page.evaluate(() => WORD_BANK.length);
            expect(size).toBeGreaterThanOrEqual(60);
        });
    });

    // -------------------------------------------------------------------
    // Selecting cells and entries
    // -------------------------------------------------------------------
    test.describe('selection', () => {
        test('clicking a letter cell selects it', async ({ page }) => {
            const entries = await entryList(page);
            const down = entries.find((e) => e.dir === 'down');
            await clickCell(page, down.r + 1, down.c);
            const s = await state(page);
            expect(s.selection).toMatchObject({ r: down.r + 1, c: down.c });
        });

        test('clicking the selected cell again turns the direction', async ({ page }) => {
            const entries = await entryList(page);
            // A crossing cell: belongs to an across entry and a down entry.
            const across = entries.filter((e) => e.dir === 'across');
            const downs = entries.filter((e) => e.dir === 'down');
            let crossing = null;
            for (const a of across) {
                for (let i = 0; i < a.len && !crossing; i++) {
                    const c = a.c + i;
                    const d = downs.find((d) => d.c === c && d.r <= a.r && d.r + d.len > a.r);
                    if (d) crossing = { r: a.r, c };
                }
                if (crossing) break;
            }
            expect(crossing).not.toBeNull();
            await clickCell(page, crossing.r, crossing.c);
            const first = (await state(page)).selection.dir;
            await clickCell(page, crossing.r, crossing.c);
            const second = (await state(page)).selection.dir;
            expect(second).not.toBe(first);
            await page.keyboard.press('Space');
            expect((await state(page)).selection.dir).toBe(first);
        });

        test('clicking a clue jumps to the start of that entry', async ({ page }) => {
            const entries = await entryList(page);
            const target = entries[entries.length - 1];
            await clue(page, target.dir, target.num).click();
            expect((await state(page)).selection).toMatchObject({
                r: target.r,
                c: target.c,
                dir: target.dir,
            });
            await expect(page.locator('#current-clue')).toContainText(String(target.num));
            await expect(clue(page, target.dir, target.num)).toHaveClass(/active/);
        });

        test('arrow keys move the selection over letter cells', async ({ page }) => {
            const entries = await entryList(page);
            const across = entries.find((e) => e.dir === 'across' && e.len >= 3);
            await clue(page, 'across', across.num).click();
            await page.keyboard.press('ArrowRight');
            expect((await state(page)).selection).toMatchObject({ r: across.r, c: across.c + 1 });
            await page.keyboard.press('ArrowLeft');
            expect((await state(page)).selection).toMatchObject({ r: across.r, c: across.c });
        });

        test('Tab moves to the next entry and Shift+Tab back', async ({ page }) => {
            const entries = await entryList(page);
            const order = [...entries].sort((a, b) => a.num - b.num || (a.dir === 'across' ? -1 : 1));
            await clue(page, order[0].dir, order[0].num).click();
            await page.keyboard.press('Tab');
            expect((await state(page)).selection).toMatchObject({
                r: order[1].r,
                c: order[1].c,
                dir: order[1].dir,
            });
            await page.keyboard.press('Shift+Tab');
            expect((await state(page)).selection).toMatchObject({
                r: order[0].r,
                c: order[0].c,
                dir: order[0].dir,
            });
        });

        test('Escape clears the selection', async ({ page }) => {
            await page.keyboard.press('Escape');
            expect((await state(page)).selection).toBeNull();
            await expect(page.locator('#current-clue')).toContainText('clue');
        });

        test('clicking blank parchment does not select anything', async ({ page }) => {
            const blank = await page.evaluate(() => {
                for (let r = 0; r < puzzle.rows; r++) {
                    for (let c = 0; c < puzzle.cols; c++) {
                        if (puzzle.grid[r][c] === null) return { r, c };
                    }
                }
                return null;
            });
            expect(blank).not.toBeNull();
            const before = (await state(page)).selection;
            await clickCell(page, blank.r, blank.c);
            expect((await state(page)).selection).toEqual(before);
        });
    });

    // -------------------------------------------------------------------
    // Writing letters
    // -------------------------------------------------------------------
    test.describe('writing letters', () => {
        test('typing fills the entry and stops at its end', async ({ page }) => {
            const entries = await entryList(page);
            const e = entries.find((x) => x.dir === 'across');
            await clue(page, 'across', e.num).click();
            await page.keyboard.type(e.answer + 'ZZZ');
            const read = await page.evaluate(
                ([r, c, len]) => Array.from({ length: len }, (_, i) => letters[r][c + i]).join(''),
                [e.r, e.c, e.len]
            );
            expect(read).toBe(e.answer);
            expect((await state(page)).selection).toMatchObject({ r: e.r, c: e.c + e.len - 1 });
        });

        test('lower case is written as capitals and non-letters are ignored', async ({ page }) => {
            const entries = await entryList(page);
            const e = entries.find((x) => x.dir === 'across' && x.len >= 3);
            await clue(page, 'across', e.num).click();
            await page.keyboard.type('a4-b');
            const read = await page.evaluate(
                ([r, c]) => [letters[r][c], letters[r][c + 1]].join(''),
                [e.r, e.c]
            );
            expect(read).toBe('AB');
        });

        test('Backspace clears a letter and steps back', async ({ page }) => {
            const entries = await entryList(page);
            const e = entries.find((x) => x.dir === 'across' && x.len >= 3);
            await clue(page, 'across', e.num).click();
            await page.keyboard.type('XY');
            await page.keyboard.press('Backspace');   // clears the cell under the cursor
            await page.keyboard.press('Backspace');   // steps back and clears
            const read = await page.evaluate(
                ([r, c]) => [letters[r][c], letters[r][c + 1], letters[r][c + 2]].join('-'),
                [e.r, e.c]
            );
            expect(read).toBe('--');
            expect((await state(page)).selection).toMatchObject({ r: e.r, c: e.c });
        });

        test('a letter written in a crossing shows in both entries and the HUD counts it', async ({ page }) => {
            const entries = await entryList(page);
            const across = entries.find((e) => e.dir === 'across');
            await clue(page, 'across', across.num).click();
            await page.keyboard.type(across.answer);
            await expect(page.locator('#words')).toHaveText(new RegExp(`^1 / ${entries.length}$`));
            const filled = await page.evaluate(() => letters.flat().filter(Boolean).length);
            expect(filled).toBe(across.len);
            await expect(page.locator('#filled')).toContainText(`${across.len} / `);
            // A down entry crossing it now shows the shared letter.
            const down = entries.find(
                (d) => d.dir === 'down' && d.c >= across.c && d.c < across.c + across.len
                    && d.r <= across.r && d.r + d.len > across.r
            );
            if (down) {
                const shared = await page.evaluate(([r, c]) => letters[r][c], [across.r, down.c]);
                expect(shared).toBe(across.answer[down.c - across.c]);
            }
        });

        test('the on-screen keyboard writes letters too', async ({ page }) => {
            const entries = await entryList(page);
            const e = entries.find((x) => x.dir === 'across' && x.len >= 3);
            await clue(page, 'across', e.num).click();
            for (const ch of e.answer.slice(0, 3)) {
                await page.locator(`#keyboard .key[data-key="${ch}"]`).click();
            }
            const read = await page.evaluate(
                ([r, c]) => [letters[r][c], letters[r][c + 1], letters[r][c + 2]].join(''),
                [e.r, e.c]
            );
            expect(read).toBe(e.answer.slice(0, 3));
        });

        test('the on-screen rub-out key clears a letter', async ({ page }) => {
            const entries = await entryList(page);
            const e = entries.find((x) => x.dir === 'across' && x.len >= 3);
            await clue(page, 'across', e.num).click();
            await page.keyboard.type('AB');
            await page.locator('#keyboard .key[data-key="back"]').click();
            const read = await page.evaluate(
                ([r, c]) => [letters[r][c], letters[r][c + 1]].join('-'),
                [e.r, e.c]
            );
            expect(read).toBe('A-');
        });

        test('the on-screen keyboard offers every letter of the alphabet', async ({ page }) => {
            const keys = await page
                .locator('#keyboard .key')
                .evaluateAll((els) => els.map((el) => el.dataset.key));
            const alphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
            expect(keys.filter((k) => k !== 'back').sort()).toEqual(alphabet);
            expect(keys).toContain('back');
        });

        test('a finished entry is marked done in the clue list', async ({ page }) => {
            const entries = await entryList(page);
            const e = entries.find((x) => x.dir === 'across');
            await clue(page, 'across', e.num).click();
            await page.keyboard.type(e.answer);
            await expect(clue(page, 'across', e.num)).toHaveClass(/done/);
        });
    });

    // -------------------------------------------------------------------
    // Check and Reveal Letter
    // -------------------------------------------------------------------
    test.describe('check and hints', () => {
        test('Check counts the wrong letters without fixing them', async ({ page }) => {
            const entries = await entryList(page);
            const e = entries.find((x) => x.dir === 'across' && x.len >= 3);
            await clue(page, 'across', e.num).click();
            const wrong = e.answer[0] === 'Q' ? 'Z' : 'Q';
            await page.keyboard.type(wrong);
            await page.locator('#btn-check').click();
            await expect(page.locator('#status')).toContainText('1');
            await expect(page.locator('#status')).toHaveClass(/bad/);
            expect(await page.evaluate(([r, c]) => letters[r][c], [e.r, e.c])).toBe(wrong);
        });

        test('Check is encouraging when everything written so far is right', async ({ page }) => {
            const entries = await entryList(page);
            const e = entries.find((x) => x.dir === 'across');
            await clue(page, 'across', e.num).click();
            await page.keyboard.type(e.answer);
            await page.locator('#btn-check').click();
            await expect(page.locator('#status')).toHaveClass(/good/);
        });

        test('Reveal Letter writes the right letter and counts a hint', async ({ page }) => {
            const entries = await entryList(page);
            const e = entries.find((x) => x.dir === 'across');
            await clue(page, 'across', e.num).click();
            await page.locator('#btn-hint').click();
            expect(await page.evaluate(([r, c]) => letters[r][c], [e.r, e.c])).toBe(e.answer[0]);
            await expect(page.locator('#hints')).toHaveText('1');
        });

        test('Reveal Letter needs a selected cell', async ({ page }) => {
            await page.keyboard.press('Escape');
            await page.locator('#btn-hint').click();
            await expect(page.locator('#hints')).toHaveText('0');
            await expect(page.locator('#status')).toHaveClass(/bad/);
        });
    });

    // -------------------------------------------------------------------
    // Reset, new scroll, levels
    // -------------------------------------------------------------------
    test.describe('reset, new scroll and levels', () => {
        test('Reset empties the grid but keeps the same scroll', async ({ page }) => {
            const before = await state(page);
            const entries = await entryList(page);
            const e = entries[0];
            await clue(page, e.dir, e.num).click();
            await page.keyboard.type(e.answer);
            await page.locator('#btn-reset').click();
            const after = await state(page);
            expect(after.seed).toBe(before.seed);
            expect(after.letters.join('')).toMatch(/^[|]*$/);
            await expect(page.locator('#words')).toHaveText(`0 / ${before.count}`);
        });

        test('New Scroll builds a different scroll on an empty grid', async ({ page }) => {
            const before = await state(page);
            const beforeEntries = await entryList(page);
            await page.locator('#btn-new').click();
            const after = await state(page);
            const afterEntries = await entryList(page);
            expect(after.seed).not.toBe(before.seed);
            expect(JSON.stringify(afterEntries)).not.toBe(JSON.stringify(beforeEntries));
            expect(after.letters.join('')).toMatch(/^[|]*$/);
            expect(after.hints).toBe(0);
        });

        test('the level buttons switch scroll size', async ({ page }) => {
            await page.locator('.level-btn[data-level="2"]').click();
            const s = await state(page);
            expect(s.cols).toBe(13);
            expect(s.rows).toBe(13);
            await expect(page.locator('#level-label')).toHaveText('Great scroll');
            await expect(page.locator('.level-btn[data-level="2"]')).toHaveClass(/active/);
            await expect(page.locator('.level-btn[data-level="0"]')).not.toHaveClass(/active/);
            const min = await page.evaluate(() => LEVELS[2].minWords);
            expect(s.count).toBeGreaterThanOrEqual(min);
        });
    });

    // -------------------------------------------------------------------
    // Finishing the scroll
    // -------------------------------------------------------------------
    test.describe('finishing', () => {
        test('filling every entry finishes the scroll', async ({ page }) => {
            await solveScroll(page);
            const s = await state(page);
            expect(s.solved).toBe(true);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('scroll');
            await expect(page.locator('#words')).toHaveText(`${s.count} / ${s.count}`);
            expect(errors).toEqual([]);
        });

        test('a finished scroll ignores further typing', async ({ page }) => {
            await solveScroll(page);
            const before = (await state(page)).letters;
            await page.keyboard.type('QQQQ');
            expect((await state(page)).letters).toEqual(before);
        });

        test('the overlay button moves on to the next scroll', async ({ page }) => {
            await solveScroll(page);
            await page.locator('#btn-next').click();
            const s = await state(page);
            expect(s.level).toBe(1);
            expect(s.cols).toBe(11);
            expect(s.solved).toBe(false);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#level-label')).toHaveText('Long scroll');
        });
    });
});
