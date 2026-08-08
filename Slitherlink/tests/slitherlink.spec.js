const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Helper: recompute the loop validity of the stored solution inside the page.
const SOLUTION_IS_SINGLE_LOOP = () => {
    const lines = [];
    for (let r = 0; r <= R; r++) {
        for (let c = 0; c < C; c++) {
            if (solution.H[r][c] === 1) lines.push(['h', r, c]);
        }
    }
    for (let r = 0; r < R; r++) {
        for (let c = 0; c <= C; c++) {
            if (solution.V[r][c] === 1) lines.push(['v', r, c]);
        }
    }
    if (lines.length === 0) return { ok: false, why: 'no lines' };

    // degree of every dot must be 0 or 2
    const deg = new Map();
    const bump = (r, c) => {
        const k = r + ',' + c;
        deg.set(k, (deg.get(k) || 0) + 1);
    };
    for (const [kind, r, c] of lines) {
        if (kind === 'h') { bump(r, c); bump(r, c + 1); }
        else { bump(r, c); bump(r + 1, c); }
    }
    for (const [, d] of deg) if (d !== 2) return { ok: false, why: 'degree ' + d };

    // all lines connected
    const adj = new Map();
    const link = (a, b) => {
        if (!adj.has(a)) adj.set(a, []);
        adj.get(a).push(b);
    };
    for (const [kind, r, c] of lines) {
        const a = r + ',' + c;
        const b = kind === 'h' ? r + ',' + (c + 1) : (r + 1) + ',' + c;
        link(a, b); link(b, a);
    }
    const startDot = adj.keys().next().value;
    const seen = new Set([startDot]);
    const stack = [startDot];
    while (stack.length) {
        for (const nb of adj.get(stack.pop()) || []) {
            if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
        }
    }
    if (seen.size !== deg.size) return { ok: false, why: 'disconnected' };

    // clues satisfied
    for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
            if (clues[r][c] < 0) continue;
            let n = 0;
            if (solution.H[r][c] === 1) n++;
            if (solution.H[r + 1][c] === 1) n++;
            if (solution.V[r][c] === 1) n++;
            if (solution.V[r][c + 1] === 1) n++;
            if (n !== clues[r][c]) return { ok: false, why: 'clue ' + r + ',' + c };
        }
    }
    return { ok: true, lines: lines.length };
};

// Click the middle of an edge on the canvas.
async function clickEdge(page, kind, r, c, options = {}) {
    const pt = await page.evaluate(([kind, r, c]) => {
        const a = dotPos(r, c);
        const b = kind === 'h' ? dotPos(r, c + 1) : dotPos(r + 1, c);
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }, [kind, r, c]);
    const box = await page.locator('#canvas').boundingBox();
    await page.mouse.click(box.x + pt.x * (box.width / 560), box.y + pt.y * (box.height / 560), options);
}

test.describe('Slitherlink', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // Puzzle generation happens on load; make the tests deterministic.
        await page.evaluate(() => newGame('easy', 42));
    });

    // -----------------------------------------------------------------------
    // Page structure
    // -----------------------------------------------------------------------
    test.describe('page structure', () => {
        test('page title is Slitherlink', async ({ page }) => {
            await expect(page).toHaveTitle('Slitherlink');
        });

        test('canvas is 560x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('HUD shows difficulty, timer, moves, hints and best', async ({ page }) => {
            await expect(page.locator('#difficulty')).toBeVisible();
            await expect(page.locator('#timer')).toBeVisible();
            await expect(page.locator('#moves')).toBeVisible();
            await expect(page.locator('#hints')).toBeVisible();
            await expect(page.locator('#best')).toBeVisible();
        });

        test('control buttons exist', async ({ page }) => {
            for (const id of ['#btn-new', '#btn-undo', '#btn-reset', '#btn-hint',
                '#btn-easy', '#btn-medium', '#btn-hard']) {
                await expect(page.locator(id)).toBeVisible();
            }
        });

        test('help text mentions the loop rule', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/loop/i);
        });

        test('overlay is hidden while playing', async ({ page }) => {
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Puzzle generation
    // -----------------------------------------------------------------------
    test.describe('puzzle generation', () => {
        test('easy puzzle is a 5x5 grid', async ({ page }) => {
            const dims = await page.evaluate(() => ({ R, C }));
            expect(dims).toEqual({ R: 5, C: 5 });
        });

        test('edge arrays are correctly sized', async ({ page }) => {
            const sizes = await page.evaluate(() => ({
                hRows: H.length, hCols: H[0].length, vRows: V.length, vCols: V[0].length,
            }));
            expect(sizes).toEqual({ hRows: 6, hCols: 5, vRows: 5, vCols: 6 });
        });

        test('board starts empty', async ({ page }) => {
            const any = await page.evaluate(() =>
                H.flat().some((e) => e !== 0) || V.flat().some((e) => e !== 0));
            expect(any).toBe(false);
        });

        test('clues are between 0 and 3 with at least a few givens', async ({ page }) => {
            const info = await page.evaluate(() => {
                const flat = clues.flat();
                return {
                    bad: flat.filter((v) => v < -1 || v > 3).length,
                    given: flat.filter((v) => v >= 0).length,
                };
            });
            expect(info.bad).toBe(0);
            expect(info.given).toBeGreaterThan(2);
        });

        test('not every cell is clued (clues get carved away)', async ({ page }) => {
            const given = await page.evaluate(() => clues.flat().filter((v) => v >= 0).length);
            expect(given).toBeLessThan(25);
        });

        test('stored solution is a single closed loop satisfying the clues', async ({ page }) => {
            const res = await page.evaluate(SOLUTION_IS_SINGLE_LOOP);
            expect(res.ok).toBe(true);
            expect(res.lines).toBeGreaterThan(3);
        });

        test('same seed generates the same puzzle', async ({ page }) => {
            const a = await page.evaluate(() => { newGame('easy', 7); return JSON.stringify(clues); });
            const b = await page.evaluate(() => { newGame('easy', 7); return JSON.stringify(clues); });
            expect(a).toBe(b);
        });

        test('different seeds generate different puzzles', async ({ page }) => {
            const a = await page.evaluate(() => { newGame('easy', 1); return JSON.stringify(clues); });
            const b = await page.evaluate(() => { newGame('easy', 2); return JSON.stringify(clues); });
            expect(a).not.toBe(b);
        });

        test('medium and hard puzzles are valid loops too', async ({ page }) => {
            for (const [diff, size] of [['medium', 7], ['hard', 9]]) {
                const dims = await page.evaluate((d) => { newGame(d, 3); return { R, C }; }, diff);
                expect(dims).toEqual({ R: size, C: size });
                const res = await page.evaluate(SOLUTION_IS_SINGLE_LOOP);
                expect(res.ok, `${diff}: ${res.why}`).toBe(true);
            }
        });

        test('hard puzzle generation finishes promptly', async ({ page }) => {
            const ms = await page.evaluate(() => {
                const t = performance.now();
                newGame('hard', 99);
                return performance.now() - t;
            });
            expect(ms).toBeLessThan(5000);
        });
    });

    // -----------------------------------------------------------------------
    // Edge editing
    // -----------------------------------------------------------------------
    test.describe('edge editing', () => {
        test('cycling an edge goes empty -> line -> cross -> empty', async ({ page }) => {
            const seq = await page.evaluate(() => {
                const out = [getEdge('h', 0, 0)];
                for (let i = 0; i < 3; i++) { cycleEdge('h', 0, 0); out.push(getEdge('h', 0, 0)); }
                return out;
            });
            expect(seq).toEqual([0, 1, 2, 0]);
        });

        test('cycling backwards goes empty -> cross -> line -> empty', async ({ page }) => {
            const seq = await page.evaluate(() => {
                const out = [getEdge('v', 0, 0)];
                for (let i = 0; i < 3; i++) { cycleEdge('v', 0, 0, true); out.push(getEdge('v', 0, 0)); }
                return out;
            });
            expect(seq).toEqual([0, 2, 1, 0]);
        });

        test('setEdge rejects out-of-range coordinates', async ({ page }) => {
            const res = await page.evaluate(() => [
                setEdge('h', -1, 0, 1),
                setEdge('h', 0, 5, 1),
                setEdge('v', 5, 0, 1),
                setEdge('v', 0, 6, 1),
                setEdge('h', 6, 0, 1),
            ]);
            expect(res).toEqual([false, false, false, false, false]);
        });

        test('setEdge accepts in-range coordinates', async ({ page }) => {
            const res = await page.evaluate(() => [
                setEdge('h', 5, 4, 1),
                setEdge('v', 4, 5, 1),
            ]);
            expect(res).toEqual([true, true]);
        });

        test('edits increment the move counter', async ({ page }) => {
            const moves = await page.evaluate(() => {
                cycleEdge('h', 0, 0);
                cycleEdge('h', 0, 1);
                return moves;
            });
            expect(moves).toBe(2);
            await expect(page.locator('#moves')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Clue feedback
    // -----------------------------------------------------------------------
    test.describe('clue feedback', () => {
        test('clueLineCount counts only lines, not crosses', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const before = clueLineCount(1, 1);
                setEdge('h', 1, 1, 1);
                const afterLine = clueLineCount(1, 1);
                setEdge('v', 1, 1, 2);
                const afterCross = clueLineCount(1, 1);
                return { before, afterLine, afterCross };
            });
            expect(counts).toEqual({ before: 0, afterLine: 1, afterCross: 1 });
        });

        test('clueStatus reports under / ok / over', async ({ page }) => {
            const res = await page.evaluate(() => {
                // find a cell clued 1 and drive it through the states
                for (let r = 0; r < R; r++) {
                    for (let c = 0; c < C; c++) {
                        if (clues[r][c] !== 1) continue;
                        const under = clueStatus(r, c);
                        setEdge('h', r, c, 1);
                        const ok = clueStatus(r, c);
                        setEdge('h', r + 1, c, 1);
                        const over = clueStatus(r, c);
                        return { under, ok, over };
                    }
                }
                return null;
            });
            expect(res).toEqual({ under: 'under', ok: 'ok', over: 'over' });
        });

        test('unclued cells report no status', async ({ page }) => {
            const status = await page.evaluate(() => {
                for (let r = 0; r < R; r++) {
                    for (let c = 0; c < C; c++) if (clues[r][c] < 0) return clueStatus(r, c);
                }
                return 'none-found';
            });
            expect(status).toBe('none');
        });
    });

    // -----------------------------------------------------------------------
    // Win detection
    // -----------------------------------------------------------------------
    test.describe('win detection', () => {
        test('empty board is not solved', async ({ page }) => {
            expect(await page.evaluate(() => isSolved())).toBe(false);
        });

        test('the stored solution solves the puzzle', async ({ page }) => {
            const res = await page.evaluate(() => { applySolution(); return { solved: isSolved(), state }; });
            expect(res.solved).toBe(true);
            expect(res.state).toBe('solved');
        });

        test('removing one line breaks the loop', async ({ page }) => {
            const solved = await page.evaluate(() => {
                applySolution();
                for (let r = 0; r <= R; r++) {
                    for (let c = 0; c < C; c++) {
                        if (H[r][c] === 1) { H[r][c] = 0; return isSolved(); }
                    }
                }
                return null;
            });
            expect(solved).toBe(false);
        });

        test('an extra branching line breaks the loop', async ({ page }) => {
            const solved = await page.evaluate(() => {
                applySolution();
                for (let r = 0; r <= R; r++) {
                    for (let c = 0; c < C; c++) {
                        if (H[r][c] !== 1) { H[r][c] = 1; return isSolved(); }
                    }
                }
                return null;
            });
            expect(solved).toBe(false);
        });

        test('crosses do not affect a solved board', async ({ page }) => {
            const solved = await page.evaluate(() => {
                applySolution();
                for (let r = 0; r <= R; r++) {
                    for (let c = 0; c < C; c++) {
                        if (H[r][c] === 0) { H[r][c] = 2; break; }
                    }
                }
                return isSolved();
            });
            expect(solved).toBe(true);
        });

        test('a loop that violates a clue is not solved', async ({ page }) => {
            // Draw the unit square around cell (0,0) — a genuine closed loop, but
            // it will not match every clue on the board.
            const solved = await page.evaluate(() => {
                resetBoard();
                H[0][0] = 1; H[1][0] = 1; V[0][0] = 1; V[0][1] = 1;
                return isSolved();
            });
            expect(solved).toBe(false);
        });

        test('solving shows the overlay and stops the board', async ({ page }) => {
            await page.evaluate(() => applySolution());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/solved/i);
            const changed = await page.evaluate(() => setEdge('h', 0, 0, 1));
            expect(changed).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Undo / reset / hint
    // -----------------------------------------------------------------------
    test.describe('undo, reset and hints', () => {
        test('undo restores the previous edge state', async ({ page }) => {
            const res = await page.evaluate(() => {
                cycleEdge('h', 2, 2);
                cycleEdge('h', 2, 2);
                const before = getEdge('h', 2, 2);
                undo();
                const after = getEdge('h', 2, 2);
                undo();
                return { before, after, empty: getEdge('h', 2, 2), moves };
            });
            expect(res.before).toBe(2);
            expect(res.after).toBe(1);
            expect(res.empty).toBe(0);
            expect(res.moves).toBe(0);
        });

        test('undo with nothing to undo is harmless', async ({ page }) => {
            const res = await page.evaluate(() => { undo(); undo(); return moves; });
            expect(res).toBe(0);
        });

        test('reset clears the board but keeps the puzzle', async ({ page }) => {
            const res = await page.evaluate(() => {
                const before = JSON.stringify(clues);
                cycleEdge('h', 0, 0);
                cycleEdge('v', 0, 0);
                resetBoard();
                return {
                    sameClues: before === JSON.stringify(clues),
                    anyEdges: H.flat().some((e) => e !== 0) || V.flat().some((e) => e !== 0),
                    moves,
                };
            });
            expect(res).toEqual({ sameClues: true, anyEdges: false, moves: 0 });
        });

        test('hint fills in a correct edge', async ({ page }) => {
            const res = await page.evaluate(() => {
                hint();
                let wrong = 0, filled = 0;
                for (let r = 0; r <= R; r++) {
                    for (let c = 0; c < C; c++) {
                        if (H[r][c] === 0) continue;
                        filled++;
                        if (H[r][c] !== solution.H[r][c]) wrong++;
                    }
                }
                for (let r = 0; r < R; r++) {
                    for (let c = 0; c <= C; c++) {
                        if (V[r][c] === 0) continue;
                        filled++;
                        if (V[r][c] !== solution.V[r][c]) wrong++;
                    }
                }
                return { wrong, filled, hintsUsed };
            });
            expect(res.wrong).toBe(0);
            expect(res.filled).toBe(1);
            expect(res.hintsUsed).toBe(1);
            await expect(page.locator('#hints')).toHaveText('1');
        });

        test('repeated hints eventually solve the puzzle', async ({ page }) => {
            const res = await page.evaluate(() => {
                for (let i = 0; i < 400 && !isSolved(); i++) hint();
                return { solved: isSolved(), state };
            });
            expect(res.solved).toBe(true);
            expect(res.state).toBe('solved');
        });

        test('hint corrects a wrong edge', async ({ page }) => {
            const res = await page.evaluate(() => {
                // mark every edge of the solution wrong-side-up, then hint
                resetBoard();
                for (let r = 0; r <= R; r++) {
                    for (let c = 0; c < C; c++) {
                        if (solution.H[r][c] === 1) { H[r][c] = 2; break; }
                    }
                }
                hint();
                for (let r = 0; r <= R; r++) {
                    for (let c = 0; c < C; c++) {
                        if (solution.H[r][c] === 1) return H[r][c];
                    }
                }
                return null;
            });
            expect(res).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Mouse input
    // -----------------------------------------------------------------------
    test.describe('mouse input', () => {
        test('edgeAtPoint finds the horizontal edge under a point', async ({ page }) => {
            const hit = await page.evaluate(() => {
                const a = dotPos(0, 0), b = dotPos(0, 1);
                return edgeAtPoint((a.x + b.x) / 2, a.y);
            });
            expect(hit).toEqual({ kind: 'h', r: 0, c: 0 });
        });

        test('edgeAtPoint finds the vertical edge under a point', async ({ page }) => {
            const hit = await page.evaluate(() => {
                const a = dotPos(1, 2), b = dotPos(2, 2);
                return edgeAtPoint(a.x, (a.y + b.y) / 2);
            });
            expect(hit).toEqual({ kind: 'v', r: 1, c: 2 });
        });

        test('edgeAtPoint ignores the middle of a cell', async ({ page }) => {
            const hit = await page.evaluate(() => {
                const a = dotPos(1, 1), b = dotPos(2, 2);
                return edgeAtPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
            });
            expect(hit).toBeNull();
        });

        test('edgeAtPoint ignores points outside the grid', async ({ page }) => {
            const hits = await page.evaluate(() => [edgeAtPoint(2, 2), edgeAtPoint(558, 558)]);
            expect(hits).toEqual([null, null]);
        });

        test('clicking an edge draws a line, clicking again crosses it', async ({ page }) => {
            await clickEdge(page, 'h', 0, 0);
            expect(await page.evaluate(() => getEdge('h', 0, 0))).toBe(1);
            await clickEdge(page, 'h', 0, 0);
            expect(await page.evaluate(() => getEdge('h', 0, 0))).toBe(2);
        });

        test('right-clicking an edge marks a cross first', async ({ page }) => {
            await clickEdge(page, 'v', 0, 0, { button: 'right' });
            expect(await page.evaluate(() => getEdge('v', 0, 0))).toBe(2);
        });

        test('clicking a vertical edge draws it', async ({ page }) => {
            await clickEdge(page, 'v', 2, 3);
            expect(await page.evaluate(() => getEdge('v', 2, 3))).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Buttons and keyboard
    // -----------------------------------------------------------------------
    test.describe('controls', () => {
        test('difficulty buttons change the grid size', async ({ page }) => {
            await page.locator('#btn-medium').click();
            expect(await page.evaluate(() => ({ R, C, difficulty }))).toEqual({ R: 7, C: 7, difficulty: 'medium' });
            await expect(page.locator('#difficulty')).toHaveText(/medium/i);

            await page.locator('#btn-hard').click();
            expect(await page.evaluate(() => R)).toBe(9);

            await page.locator('#btn-easy').click();
            expect(await page.evaluate(() => R)).toBe(5);
        });

        test('the active difficulty button is highlighted', async ({ page }) => {
            await page.locator('#btn-medium').click();
            await expect(page.locator('#btn-medium')).toHaveClass(/active/);
            await expect(page.locator('#btn-easy')).not.toHaveClass(/active/);
        });

        test('New Puzzle button starts a fresh board', async ({ page }) => {
            await page.evaluate(() => { cycleEdge('h', 0, 0); });
            await page.locator('#btn-new').click();
            const res = await page.evaluate(() => ({
                anyEdges: H.flat().some((e) => e !== 0),
                moves, hintsUsed, state,
            }));
            expect(res).toEqual({ anyEdges: false, moves: 0, hintsUsed: 0, state: 'playing' });
        });

        test('Undo button undoes the last edit', async ({ page }) => {
            await page.evaluate(() => cycleEdge('h', 1, 1));
            await page.locator('#btn-undo').click();
            expect(await page.evaluate(() => getEdge('h', 1, 1))).toBe(0);
        });

        test('Reset button clears the board', async ({ page }) => {
            await page.evaluate(() => { cycleEdge('h', 1, 1); cycleEdge('v', 1, 1); });
            await page.locator('#btn-reset').click();
            expect(await page.evaluate(() => H.flat().some((e) => e !== 0))).toBe(false);
        });

        test('Hint button reveals an edge', async ({ page }) => {
            await page.locator('#btn-hint').click();
            expect(await page.evaluate(() => hintsUsed)).toBe(1);
        });

        test('keyboard shortcuts drive new / undo / reset / hint', async ({ page }) => {
            await page.evaluate(() => cycleEdge('h', 0, 0));
            await page.keyboard.press('u');
            expect(await page.evaluate(() => getEdge('h', 0, 0))).toBe(0);

            await page.keyboard.press('h');
            expect(await page.evaluate(() => hintsUsed)).toBe(1);

            await page.keyboard.press('r');
            expect(await page.evaluate(() => H.flat().some((e) => e !== 0))).toBe(false);

            await page.keyboard.press('n');
            expect(await page.evaluate(() => ({ moves, hintsUsed }))).toEqual({ moves: 0, hintsUsed: 0 });
        });

        test('number keys switch difficulty', async ({ page }) => {
            await page.keyboard.press('2');
            expect(await page.evaluate(() => R)).toBe(7);
            await page.keyboard.press('3');
            expect(await page.evaluate(() => R)).toBe(9);
            await page.keyboard.press('1');
            expect(await page.evaluate(() => R)).toBe(5);
        });

        test('the overlay clears when a new puzzle starts', async ({ page }) => {
            await page.evaluate(() => applySolution());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.locator('#btn-new').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Timer and best times
    // -----------------------------------------------------------------------
    test.describe('timer and best times', () => {
        test('timer starts at zero and counts up', async ({ page }) => {
            await expect(page.locator('#timer')).toHaveText('00:00');
            await page.waitForTimeout(1200);
            await expect(page.locator('#timer')).not.toHaveText('00:00');
        });

        test('timer stops once the puzzle is solved', async ({ page }) => {
            const first = await page.evaluate(() => { applySolution(); return elapsedSeconds(); });
            await page.waitForTimeout(1200);
            const second = await page.evaluate(() => elapsedSeconds());
            expect(second).toBe(first);
        });

        test('solving records a best time for the difficulty', async ({ page }) => {
            await page.evaluate(() => applySolution());
            const best = await page.evaluate(() => localStorage.getItem('slitherlink-best-easy'));
            expect(Number(best)).toBeGreaterThanOrEqual(0);
            await expect(page.locator('#best')).toHaveText(/^\d\d:\d\d$/);
        });

        test('a stored best time is shown on load', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('slitherlink-best-easy', '125'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('02:05');
        });

        test('best times are tracked per difficulty', async ({ page }) => {
            await page.evaluate(() => {
                localStorage.setItem('slitherlink-best-easy', '30');
                localStorage.setItem('slitherlink-best-hard', '600');
            });
            await page.reload();
            await expect(page.locator('#best')).toHaveText('00:30');
            await page.locator('#btn-hard').click();
            await expect(page.locator('#best')).toHaveText('10:00');
        });

        test('a slower solve does not overwrite the best time', async ({ page }) => {
            await page.evaluate(() => {
                localStorage.setItem('slitherlink-best-easy', '5');
            });
            await page.reload();
            await page.evaluate(() => {
                newGame('easy', 42);
                timerStart -= 60_000; // pretend a minute has passed
                applySolution();
            });
            expect(await page.evaluate(() => localStorage.getItem('slitherlink-best-easy'))).toBe('5');
        });
    });
});
