const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

const EMPTY = 0;
const LINE = 1;
const CROSS = 2;

/** Draw every edge of the current level's solution. */
async function applySolution(page) {
    await page.evaluate(() => {
        for (const key of LEVELS[level].solution) setEdge(key, 1);
    });
}

test.describe('Slitherlink', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                for (let i = 0; i < 20; i++) localStorage.removeItem('slitherlink-best-' + i);
            } catch (e) { /* ignore */ }
        });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Slitherlink', async ({ page }) => {
            await expect(page).toHaveTitle(/Slitherlink/i);
        });

        test('canvas is 560x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('state starts as ready', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('ready');
        });

        test('there are at least 4 levels', async ({ page }) => {
            expect(await page.evaluate(() => LEVELS.length)).toBeGreaterThanOrEqual(4);
        });

        test('one level button exists per level', async ({ page }) => {
            const n = await page.evaluate(() => LEVELS.length);
            await expect(page.locator('.level-btn')).toHaveCount(n);
        });

        test('moves start at zero', async ({ page }) => {
            await expect(page.locator('#moves')).toHaveText('0');
        });

        test('best shows an em dash when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('board is drawn behind the overlay', async ({ page }) => {
            const blank = await page.evaluate(() => {
                const c = document.createElement('canvas');
                c.width = canvas.width;
                c.height = canvas.height;
                return c.toDataURL();
            });
            const drawn = await page.evaluate(() => canvas.toDataURL());
            expect(drawn).not.toBe(blank);
        });
    });

    // -----------------------------------------------------------------
    // Level data integrity
    // -----------------------------------------------------------------
    test.describe('level definitions', () => {
        test('every level has a clue grid matching its dimensions', async ({ page }) => {
            const bad = await page.evaluate(() => LEVELS.filter((L) =>
                L.clues.length !== L.rows || L.clues.some((row) => row.length !== L.cols)).length);
            expect(bad).toBe(0);
        });

        test('clues are null or 0..3', async ({ page }) => {
            const bad = await page.evaluate(() => LEVELS.filter((L) => L.clues.some((row) =>
                row.some((v) => v !== null && !(Number.isInteger(v) && v >= 0 && v <= 3)))).length);
            expect(bad).toBe(0);
        });

        test('every level has at least one clue', async ({ page }) => {
            const bad = await page.evaluate(() => LEVELS.filter((L) =>
                L.clues.every((row) => row.every((v) => v === null))).length);
            expect(bad).toBe(0);
        });

        test('every solution edge key is inside its grid', async ({ page }) => {
            const bad = await page.evaluate(() => LEVELS.filter((L) => L.solution.some((k) => {
                const [t, r, c] = k.split(':');
                const rr = +r, cc = +c;
                if (t === 'H') return !(rr >= 0 && rr <= L.rows && cc >= 0 && cc < L.cols);
                if (t === 'V') return !(rr >= 0 && rr < L.rows && cc >= 0 && cc <= L.cols);
                return true;
            })).length);
            expect(bad).toBe(0);
        });

        test('levels grow in size', async ({ page }) => {
            const sizes = await page.evaluate(() => LEVELS.map((L) => L.rows * L.cols));
            for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
        });

        test('every level solution solves that level', async ({ page }) => {
            const failures = await page.evaluate(() => {
                const bad = [];
                for (let i = 0; i < LEVELS.length; i++) {
                    startGame(i);
                    for (const key of LEVELS[i].solution) setEdge(key, 1);
                    if (!isSolved()) bad.push(i);
                }
                return bad;
            });
            expect(failures).toEqual([]);
        });
    });

    // -----------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------
    test.describe('starting', () => {
        test('clicking start hides the overlay and begins play', async ({ page }) => {
            await page.click('#btn-start');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('pressing Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('a level button starts that level', async ({ page }) => {
            await page.locator('.level-btn').nth(2).click();
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('starting clears the board and the move counter', async ({ page }) => {
            await page.click('#btn-start');
            await page.evaluate(() => cycleEdge('H:0:0'));
            await page.evaluate(() => startGame(0));
            expect(await page.evaluate(() => moves)).toBe(0);
            expect(await page.evaluate(() => edgeState('H:0:0'))).toBe(0);
        });

        test('level name is shown in the HUD', async ({ page }) => {
            await page.click('#btn-start');
            const name = await page.evaluate(() => LEVELS[level].name);
            await expect(page.locator('#level')).toHaveText(name);
        });
    });

    // -----------------------------------------------------------------
    // Edge editing
    // -----------------------------------------------------------------
    test.describe('edges', () => {
        test.beforeEach(async ({ page }) => {
            await page.click('#btn-start');
        });

        test('all edges start empty', async ({ page }) => {
            const nonEmpty = await page.evaluate(() =>
                allEdgeKeys().filter((k) => edgeState(k) !== 0).length);
            expect(nonEmpty).toBe(0);
        });

        test('edge count matches the grid dimensions', async ({ page }) => {
            const [n, rows, cols] = await page.evaluate(() =>
                [allEdgeKeys().length, LEVELS[level].rows, LEVELS[level].cols]);
            expect(n).toBe((rows + 1) * cols + rows * (cols + 1));
        });

        test('cycling goes empty -> line -> cross -> empty', async ({ page }) => {
            const seq = await page.evaluate(() => {
                const out = [];
                for (let i = 0; i < 3; i++) { cycleEdge('H:0:0'); out.push(edgeState('H:0:0')); }
                return out;
            });
            expect(seq).toEqual([LINE, CROSS, EMPTY]);
        });

        test('cycling backwards goes empty -> cross -> line -> empty', async ({ page }) => {
            const seq = await page.evaluate(() => {
                const out = [];
                for (let i = 0; i < 3; i++) { cycleEdge('V:0:0', true); out.push(edgeState('V:0:0')); }
                return out;
            });
            expect(seq).toEqual([2, 1, 0]);
        });

        test('each cycle counts as one move', async ({ page }) => {
            await page.evaluate(() => { cycleEdge('H:0:0'); cycleEdge('H:0:1'); cycleEdge('H:0:1'); });
            await expect(page.locator('#moves')).toHaveText('3');
        });

        test('cycling an unknown edge is ignored', async ({ page }) => {
            const before = await page.evaluate(() => moves);
            await page.evaluate(() => cycleEdge('H:99:99'));
            expect(await page.evaluate(() => moves)).toBe(before);
        });

        test('edges cannot be changed before the game starts', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await page.evaluate(() => { state = 'ready'; });
            await page.evaluate(() => cycleEdge('H:0:0'));
            expect(await page.evaluate(() => edgeState('H:0:0'))).toBe(0);
        });

        test('reset clears every edge but keeps the level', async ({ page }) => {
            await page.evaluate(() => { cycleEdge('H:0:0'); cycleEdge('H:0:1'); resetBoard(); });
            const nonEmpty = await page.evaluate(() =>
                allEdgeKeys().filter((k) => edgeState(k) !== 0).length);
            expect(nonEmpty).toBe(0);
            expect(await page.evaluate(() => moves)).toBe(0);
        });
    });

    // -----------------------------------------------------------------
    // Rules: clues, degrees, loops
    // -----------------------------------------------------------------
    test.describe('rules', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame(0));
        });

        test('lines around a cell counts only line edges, not crosses', async ({ page }) => {
            const n = await page.evaluate(() => {
                setEdge('H:0:0', 1);
                setEdge('V:0:0', 1);
                setEdge('V:0:1', 2);
                return linesAroundCell(0, 0);
            });
            expect(n).toBe(2);
        });

        test('a cell with no clue is never unsatisfied', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const L = LEVELS[level];
                for (let r = 0; r < L.rows; r++) {
                    for (let c = 0; c < L.cols; c++) {
                        if (L.clues[r][c] === null && clueStatus(r, c) !== 'blank') return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('clue status reports under, ok and over', async ({ page }) => {
            const res = await page.evaluate(() => {
                // find a clue of value 1 or more
                const L = LEVELS[level];
                let target = null;
                for (let r = 0; r < L.rows && !target; r++) {
                    for (let c = 0; c < L.cols; c++) {
                        if (L.clues[r][c] === 1) { target = [r, c]; break; }
                    }
                }
                const [r, c] = target;
                const under = clueStatus(r, c);
                setEdge(`H:${r}:${c}`, 1);
                const ok = clueStatus(r, c);
                setEdge(`V:${r}:${c}`, 1);
                const over = clueStatus(r, c);
                return { under, ok, over };
            });
            expect(res).toEqual({ under: 'under', ok: 'ok', over: 'over' });
        });

        test('dot degree counts incident line edges', async ({ page }) => {
            const d = await page.evaluate(() => {
                setEdge('H:1:0', 1); // dot(1,0) - dot(1,1)
                setEdge('V:0:0', 1); // dot(0,0) - dot(1,0)
                setEdge('V:1:0', 2); // cross, must not count
                return [dotDegree(1, 0), dotDegree(0, 0)];
            });
            expect(d).toEqual([2, 1]);
        });

        test('an empty board is not a single loop', async ({ page }) => {
            expect(await page.evaluate(() => isSingleLoop())).toBe(false);
        });

        test('an open path is not a single loop', async ({ page }) => {
            const res = await page.evaluate(() => {
                setEdge('H:0:0', 1);
                setEdge('V:0:0', 1);
                return isSingleLoop();
            });
            expect(res).toBe(false);
        });

        test('a single small square is a loop', async ({ page }) => {
            const res = await page.evaluate(() => {
                for (const k of ['H:0:0', 'H:1:0', 'V:0:0', 'V:0:1']) setEdge(k, 1);
                return isSingleLoop();
            });
            expect(res).toBe(true);
        });

        test('two disjoint squares are not a single loop', async ({ page }) => {
            const res = await page.evaluate(() => {
                for (const k of ['H:0:0', 'H:1:0', 'V:0:0', 'V:0:1']) setEdge(k, 1);
                for (const k of ['H:2:2', 'H:3:2', 'V:2:2', 'V:2:3']) setEdge(k, 1);
                return isSingleLoop();
            });
            expect(res).toBe(false);
        });

        test('a dot with three lines is not a single loop', async ({ page }) => {
            const res = await page.evaluate(() => {
                for (const k of ['H:0:0', 'H:1:0', 'V:0:0', 'V:0:1']) setEdge(k, 1);
                setEdge('H:0:1', 1); // extra line off dot(0,1)
                return isSingleLoop();
            });
            expect(res).toBe(false);
        });

        test('a loop that ignores the clues is not a solution', async ({ page }) => {
            const res = await page.evaluate(() => {
                for (const k of ['H:0:0', 'H:1:0', 'V:0:0', 'V:0:1']) setEdge(k, 1);
                return { loop: isSingleLoop(), solved: isSolved() };
            });
            expect(res.loop).toBe(true);
            expect(res.solved).toBe(false);
        });

        test('crosses do not affect solving', async ({ page }) => {
            await applySolution(page);
            const solved = await page.evaluate(() => {
                for (const k of allEdgeKeys()) if (edgeState(k) === 0) setEdge(k, 2);
                return isSolved();
            });
            expect(solved).toBe(true);
        });

        test('removing one solution edge un-solves the puzzle', async ({ page }) => {
            await applySolution(page);
            const solved = await page.evaluate(() => {
                setEdge(LEVELS[level].solution[0], 0);
                return isSolved();
            });
            expect(solved).toBe(false);
        });
    });

    // -----------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------
    test.describe('winning', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame(0));
        });

        test('completing the loop wins the game', async ({ page }) => {
            await page.evaluate(() => {
                const sol = LEVELS[level].solution;
                for (let i = 0; i < sol.length - 1; i++) setEdge(sol[i], 1);
                cycleEdge(sol[sol.length - 1]); // final user move
            });
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toHaveText(/solved/i);
        });

        test('a won board cannot be edited further', async ({ page }) => {
            await page.evaluate(() => {
                const sol = LEVELS[level].solution;
                for (let i = 0; i < sol.length - 1; i++) setEdge(sol[i], 1);
                cycleEdge(sol[sol.length - 1]);
            });
            const key = await page.evaluate(() =>
                allEdgeKeys().find((k) => edgeState(k) === 0));
            await page.evaluate((k) => cycleEdge(k), key);
            expect(await page.evaluate((k) => edgeState(k), key)).toBe(0);
        });

        test('winning stores a best move count', async ({ page }) => {
            await page.evaluate(() => {
                const sol = LEVELS[level].solution;
                for (const k of sol) cycleEdge(k);
            });
            expect(await page.evaluate(() => state)).toBe('won');
            const best = await page.evaluate(() => localStorage.getItem('slitherlink-best-0'));
            expect(Number(best)).toBe(await page.evaluate(() => LEVELS[0].solution.length));
            await expect(page.locator('#best')).toHaveText(String(best));
        });

        test('a worse run does not overwrite the best', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('slitherlink-best-0', '5'));
            await page.evaluate(() => startGame(0));
            await page.evaluate(() => { for (const k of LEVELS[level].solution) cycleEdge(k); });
            expect(await page.evaluate(() => localStorage.getItem('slitherlink-best-0'))).toBe('5');
        });

        test('the start button advances to the next level after a win', async ({ page }) => {
            await page.evaluate(() => { for (const k of LEVELS[level].solution) cycleEdge(k); });
            await page.click('#btn-start');
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => state)).toBe('playing');
        });
    });

    // -----------------------------------------------------------------
    // Keyboard shortcuts
    // -----------------------------------------------------------------
    test.describe('keyboard', () => {
        test('R restarts the current level', async ({ page }) => {
            await page.evaluate(() => startGame(1));
            await page.evaluate(() => cycleEdge('H:0:0'));
            await page.keyboard.press('r');
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => moves)).toBe(0);
            expect(await page.evaluate(() => edgeState('H:0:0'))).toBe(0);
        });

        test('N moves to the next level', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await page.keyboard.press('n');
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('N wraps around at the last level', async ({ page }) => {
            await page.evaluate(() => startGame(LEVELS.length - 1));
            await page.keyboard.press('n');
            expect(await page.evaluate(() => level)).toBe(0);
        });
    });

    // -----------------------------------------------------------------
    // Pointer mapping
    // -----------------------------------------------------------------
    test.describe('pointer', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame(0));
        });

        test('a point on the top-left horizontal edge maps to H:0:0', async ({ page }) => {
            const key = await page.evaluate(() => {
                const p = dotPoint(0, 0);
                const q = dotPoint(0, 1);
                return pointerToEdge((p.x + q.x) / 2, p.y);
            });
            expect(key).toBe('H:0:0');
        });

        test('a point on the left vertical edge maps to V:0:0', async ({ page }) => {
            const key = await page.evaluate(() => {
                const p = dotPoint(0, 0);
                const q = dotPoint(1, 0);
                return pointerToEdge(p.x, (p.y + q.y) / 2);
            });
            expect(key).toBe('V:0:0');
        });

        test('a point far from the grid maps to nothing', async ({ page }) => {
            expect(await page.evaluate(() => pointerToEdge(-100, -100))).toBe(null);
        });

        test('every solution edge round-trips through its midpoint', async ({ page }) => {
            const bad = await page.evaluate(() => LEVELS[level].solution.filter((k) => {
                const m = edgeMidpoint(k);
                return pointerToEdge(m.x, m.y) !== k;
            }));
            expect(bad).toEqual([]);
        });

        test('clicking the canvas draws a line on the nearest edge', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            const m = await page.evaluate(() => edgeMidpoint('H:0:0'));
            await page.mouse.click(box.x + m.x, box.y + m.y);
            expect(await page.evaluate(() => edgeState('H:0:0'))).toBe(1);
        });

        test('right-clicking the canvas marks a cross', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            const m = await page.evaluate(() => edgeMidpoint('V:0:0'));
            await page.mouse.click(box.x + m.x, box.y + m.y, { button: 'right' });
            expect(await page.evaluate(() => edgeState('V:0:0'))).toBe(2);
        });
    });

    // -----------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------
    test.describe('rendering', () => {
        test('drawing a line changes the canvas', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            const before = await page.evaluate(() => canvas.toDataURL());
            await page.evaluate(() => cycleEdge('H:0:0'));
            const after = await page.evaluate(() => canvas.toDataURL());
            expect(after).not.toBe(before);
        });

        test('every level renders without throwing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                for (let i = 0; i < LEVELS.length; i++) { startGame(i); render(); }
            });
            expect(errors).toEqual([]);
        });

        test('the remaining-clue counter drops to zero when solved', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            const total = await page.locator('#remaining').textContent();
            expect(Number(total)).toBeGreaterThan(0);
            await applySolution(page);
            await page.evaluate(() => updateHUD());
            await expect(page.locator('#remaining')).toHaveText('0');
        });
    });
});
