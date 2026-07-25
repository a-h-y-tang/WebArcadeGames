const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Helper: overwrite the board with an exact layout and refresh the DOM/render.
// Each row is a string of single-digit gem types, '.' meaning an empty cell.
async function setGrid(page, rows) {
    await page.evaluate((rows) => {
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const ch = rows[r][c];
                grid[r][c] = ch === '.' ? EMPTY : Number(ch);
            }
        }
    }, rows);
}

test.describe('Gem Match', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Gem Match', async ({ page }) => {
            await expect(page).toHaveTitle('Gem Match');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains how to play', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/swap/i);
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('moves display shows the starting move budget', async ({ page }) => {
            const moves = await page.evaluate(() => MAX_MOVES);
            await expect(page.locator('#moves')).toHaveText(String(moves));
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 480×480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('the board is 8×8', async ({ page }) => {
            const s = await page.evaluate(() => SIZE);
            expect(s).toBe(8);
        });

        test('the board is full — every cell holds a gem', async ({ page }) => {
            const empties = await page.evaluate(() => {
                let n = 0;
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (grid[r][c] === EMPTY) n++;
                return n;
            });
            expect(empties).toBe(0);
        });

        test('the starting board has no pre-made matches', async ({ page }) => {
            const n = await page.evaluate(() => findMatches().size);
            expect(n).toBe(0);
        });

        test('the starting board has at least one legal move', async ({ page }) => {
            const has = await page.evaluate(() => hasAvailableMove());
            expect(has).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is running after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('moves left is the full budget after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            const m = await page.evaluate(() => movesLeft);
            const max = await page.evaluate(() => MAX_MOVES);
            expect(m).toBe(max);
        });
    });

    // -----------------------------------------------------------------------
    // Match detection (pure logic on an injected board)
    // -----------------------------------------------------------------------
    test.describe('match detection', () => {
        test('finds a horizontal run of three', async ({ page }) => {
            await setGrid(page, [
                '01234501',
                '11123452',
                '22234513',
                '33345124',
                '44451235',
                '55123401',
                '01234512',
                '12345023',
            ]);
            const cells = await page.evaluate(() => [...findMatches()].sort());
            // row 1 cols 0,1,2 are all gem '1'
            expect(cells).toContain('1,0');
            expect(cells).toContain('1,1');
            expect(cells).toContain('1,2');
        });

        test('finds a vertical run of three', async ({ page }) => {
            await setGrid(page, [
                '50123450',
                '01234501',
                '51230145',
                '52301234',
                '43012345',
                '10123401',
                '21234512',
                '32345023',
            ]);
            const cells = await page.evaluate(() => [...findMatches()]);
            // col 0 rows 2,3,4 are all gem '5','5','4'? verify programmatically instead
            const verified = await page.evaluate(() => {
                // Build a column-3 vertical triple deterministically and re-check
                for (let r = 0; r < SIZE; r++) grid[r][3] = 7;
                const m = findMatches();
                let count = 0;
                for (let r = 0; r < SIZE; r++) if (m.has(r + ',' + 3)) count++;
                return count;
            });
            expect(verified).toBe(8);
        });

        test('a run of four is fully detected', async ({ page }) => {
            await setGrid(page, [
                '22220123',
                '01234501',
                '10123455',
                '21230124',
                '43012345',
                '10123401',
                '21234512',
                '32345023',
            ]);
            const count = await page.evaluate(() => {
                const m = findMatches();
                let n = 0;
                for (let c = 0; c < 4; c++) if (m.has('0,' + c)) n++;
                return n;
            });
            expect(count).toBe(4);
        });

        test('a plain board with no three-in-a-row matches nothing', async ({ page }) => {
            await setGrid(page, [
                '01230123',
                '12301230',
                '23012301',
                '30123012',
                '01230123',
                '12301230',
                '23012301',
                '30123012',
            ]);
            const n = await page.evaluate(() => findMatches().size);
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Adjacency
    // -----------------------------------------------------------------------
    test.describe('adjacency', () => {
        test('orthogonal neighbours are adjacent', async ({ page }) => {
            const r = await page.evaluate(() => [
                isAdjacent({ r: 3, c: 3 }, { r: 3, c: 4 }),
                isAdjacent({ r: 3, c: 3 }, { r: 4, c: 3 }),
                isAdjacent({ r: 3, c: 3 }, { r: 2, c: 3 }),
                isAdjacent({ r: 3, c: 3 }, { r: 3, c: 2 }),
            ]);
            expect(r).toEqual([true, true, true, true]);
        });

        test('diagonal and distant cells are not adjacent', async ({ page }) => {
            const r = await page.evaluate(() => [
                isAdjacent({ r: 3, c: 3 }, { r: 4, c: 4 }),
                isAdjacent({ r: 3, c: 3 }, { r: 3, c: 5 }),
                isAdjacent({ r: 3, c: 3 }, { r: 3, c: 3 }),
            ]);
            expect(r).toEqual([false, false, false]);
        });
    });

    // -----------------------------------------------------------------------
    // Swapping
    // -----------------------------------------------------------------------
    test.describe('swapping', () => {
        test('a swap that forms a match is kept and clears gems', async ({ page }) => {
            await page.locator('#btn-start').click();
            // Put a '1' at (0,2) that, when swapped left with (0,1), completes 1,1,1.
            await setGrid(page, [
                '11010123',
                '23452345',
                '34523452',
                '45234523',
                '52345234',
                '23452345',
                '34523452',
                '45234523',
            ]);
            // (0,1)=1, (0,2)=0. Swap so column0,1,2 -> 1,0,1? That's not a match.
            // Instead set up: row0 = 1 1 0 1 ... swapping (0,2)0 with (0,3)1 gives 1 1 1 ...
            const cleared = await page.evaluate(() => {
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                return trySwap({ r: 0, c: 2 }, { r: 0, c: 3 });
            });
            expect(cleared).toBe(true);
        });

        test('a swap that forms no match is reverted', async ({ page }) => {
            await page.locator('#btn-start').click();
            await setGrid(page, [
                '01230123',
                '12301230',
                '23012301',
                '30123012',
                '01230123',
                '12301230',
                '23012301',
                '30123012',
            ]);
            const r = await page.evaluate(() => {
                const a = grid[0][0], b = grid[0][1];
                const ok = trySwap({ r: 0, c: 0 }, { r: 0, c: 1 });
                return { ok, a, b, after0: grid[0][0], after1: grid[0][1] };
            });
            expect(r.ok).toBe(false);
            // Reverted: cells hold their original values again.
            expect(r.after0).toBe(r.a);
            expect(r.after1).toBe(r.b);
        });

        test('a non-adjacent swap is rejected', async ({ page }) => {
            await page.locator('#btn-start').click();
            const ok = await page.evaluate(() => trySwap({ r: 0, c: 0 }, { r: 5, c: 5 }));
            expect(ok).toBe(false);
        });

        test('a successful swap consumes exactly one move', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                const before = movesLeft;
                trySwap({ r: 0, c: 2 }, { r: 0, c: 3 });
                return { before, after: movesLeft };
            });
            expect(r.after).toBe(r.before - 1);
        });

        test('a reverted swap does NOT consume a move', async ({ page }) => {
            await page.locator('#btn-start').click();
            await setGrid(page, [
                '01230123',
                '12301230',
                '23012301',
                '30123012',
                '01230123',
                '12301230',
                '23012301',
                '30123012',
            ]);
            const r = await page.evaluate(() => {
                const before = movesLeft;
                trySwap({ r: 0, c: 0 }, { r: 0, c: 1 });
                return { before, after: movesLeft };
            });
            expect(r.after).toBe(r.before);
        });
    });

    // -----------------------------------------------------------------------
    // Clearing, gravity and refill
    // -----------------------------------------------------------------------
    test.describe('resolving the board', () => {
        test('a successful swap leaves no matches behind', async ({ page }) => {
            await page.locator('#btn-start').click();
            const remaining = await page.evaluate(() => {
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                trySwap({ r: 0, c: 2 }, { r: 0, c: 3 });
                return findMatches().size;
            });
            expect(remaining).toBe(0);
        });

        test('the board stays full after resolving (gravity + refill)', async ({ page }) => {
            await page.locator('#btn-start').click();
            const empties = await page.evaluate(() => {
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                trySwap({ r: 0, c: 2 }, { r: 0, c: 3 });
                let n = 0;
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (grid[r][c] === EMPTY) n++;
                return n;
            });
            expect(empties).toBe(0);
        });

        test('gravity drops gems into cleared cells', async ({ page }) => {
            const r = await page.evaluate(() => {
                // Column 0 top-to-bottom: mark the bottom three as cleared, others known.
                for (let row = 0; row < SIZE; row++) grid[row][0] = row; // 0..7 distinct-ish
                grid[5][0] = EMPTY; grid[6][0] = EMPTY; grid[7][0] = EMPTY;
                collapseColumns();
                // The three surviving non-empty gems (originally rows 2,3,4 = 2,3,4)
                // must now sit at the bottom, in order.
                return { b5: grid[5][0], b6: grid[6][0], b7: grid[7][0] };
            });
            expect(r.b7).toBe(4);
            expect(r.b6).toBe(3);
            expect(r.b5).toBe(2);
        });

        test('refill fills every empty cell', async ({ page }) => {
            const empties = await page.evaluate(() => {
                grid[0][0] = EMPTY; grid[1][0] = EMPTY; grid[0][7] = EMPTY;
                collapseColumns();
                refill();
                let n = 0;
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (grid[r][c] === EMPTY) n++;
                return n;
            });
            expect(empties).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('clearing gems raises the score', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                score = 0;
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                trySwap({ r: 0, c: 2 }, { r: 0, c: 3 });
                return score;
            });
            expect(r).toBeGreaterThan(0);
        });

        test('the score display updates in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                score = 0;
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                trySwap({ r: 0, c: 2 }, { r: 0, c: 3 });
            });
            const text = await page.locator('#score').textContent();
            expect(Number(text)).toBeGreaterThan(0);
        });

        test('a bigger clear scores more than a minimal three', async ({ page }) => {
            await page.locator('#btn-start').click();
            const three = await page.evaluate(() => {
                // Fill with a no-match pattern, then set up a clean 3-run.
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        grid[r][c] = (r + 2 * c) % 4;
                score = 0;
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                trySwap({ r: 0, c: 2 }, { r: 0, c: 3 });
                return score;
            });
            const five = await page.evaluate(() => {
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        grid[r][c] = (r + 2 * c) % 4 === 1 ? 3 : (r + 2 * c) % 4;
                score = 0;
                // Row 0: 1 1 0 1 1  -> swap makes five 1's in a row.
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1; grid[0][4] = 1;
                trySwap({ r: 0, c: 2 }, { r: 0, c: 3 });
                return score;
            });
            expect(five).toBeGreaterThan(three);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('the game ends when moves run out', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                movesLeft = 1;
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                trySwap({ r: 0, c: 2 }, { r: 0, c: 3 });
                return state;
            });
            expect(s).toBe('over');
        });

        test('the game-over overlay is shown', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                movesLeft = 1;
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                trySwap({ r: 0, c: 2 }, { r: 0, c: 3 });
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('no more swaps are accepted once the game is over', async ({ page }) => {
            await page.locator('#btn-start').click();
            const ok = await page.evaluate(() => {
                movesLeft = 1;
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                trySwap({ r: 0, c: 2 }, { r: 0, c: 3 }); // ends the game
                // Try another valid-looking swap after game over.
                grid[1][0] = 2; grid[1][1] = 2; grid[1][2] = 0; grid[1][3] = 2;
                return trySwap({ r: 1, c: 2 }, { r: 1, c: 3 });
            });
            expect(ok).toBe(false);
        });

        test('the final score is shown on the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                score = 0;
                movesLeft = 1;
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                trySwap({ r: 0, c: 2 }, { r: 0, c: 3 });
            });
            await expect(page.locator('#overlay-score')).not.toHaveText('');
        });
    });

    // -----------------------------------------------------------------------
    // Best score persistence
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('the best score is saved to localStorage on game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                score = 500;
                movesLeft = 1;
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                trySwap({ r: 0, c: 2 }, { r: 0, c: 3 });
            });
            const stored = await page.evaluate(() => localStorage.getItem('gemmatch-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(500);
        });

        test('the best score display updates on a new best', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                score = 999;
                movesLeft = 1;
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                trySwap({ r: 0, c: 2 }, { r: 0, c: 3 });
            });
            const text = await page.locator('#best').textContent();
            expect(Number(text)).toBeGreaterThanOrEqual(999);
        });

        test('a loaded best is shown on page load', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('gemmatch-best', '1234'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('1234');
        });
    });

    // -----------------------------------------------------------------------
    // Restart
    // -----------------------------------------------------------------------
    test.describe('restart', () => {
        test('Play Again resets the score to 0', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 300; movesLeft = 0; endGame(); });
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
            await page.locator('#btn-start').click();
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('Play Again restores the full move budget', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { movesLeft = 0; endGame(); });
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => ({ m: movesLeft, max: MAX_MOVES }));
            expect(r.m).toBe(r.max);
        });

        test('a restarted board is match-free and playable', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { movesLeft = 0; endGame(); });
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => ({
                matches: findMatches().size,
                move: hasAvailableMove(),
            }));
            expect(r.matches).toBe(0);
            expect(r.move).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Mouse interaction
    // -----------------------------------------------------------------------
    test.describe('mouse interaction', () => {
        test('clicking a gem selects it', async ({ page }) => {
            await page.locator('#btn-start').click();
            const canvas = page.locator('#canvas');
            const box = await canvas.boundingBox();
            const cell = await page.evaluate(() => CELL);
            // click the centre of cell (2,3): x = c*CELL + CELL/2, y = r*CELL + CELL/2
            await page.mouse.click(box.x + 3 * cell + cell / 2, box.y + 2 * cell + cell / 2);
            const sel = await page.evaluate(() => selected);
            expect(sel).toEqual({ r: 2, c: 3 });
        });

        test('clicking an adjacent gem attempts a swap and clears the selection', async ({ page }) => {
            await page.locator('#btn-start').click();
            const canvas = page.locator('#canvas');
            const box = await canvas.boundingBox();
            const cell = await page.evaluate(() => CELL);
            // Arrange a guaranteed match: row0 = 1 1 0 1 ...; select (0,2), then (0,3).
            await page.evaluate(() => {
                grid[0][0] = 1; grid[0][1] = 1; grid[0][2] = 0; grid[0][3] = 1;
                render();
            });
            await page.mouse.click(box.x + 2 * cell + cell / 2, box.y + 0 * cell + cell / 2);
            await page.mouse.click(box.x + 3 * cell + cell / 2, box.y + 0 * cell + cell / 2);
            const sel = await page.evaluate(() => selected);
            expect(sel).toBeNull();
        });
    });
});
