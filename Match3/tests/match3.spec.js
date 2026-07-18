const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Deterministic helper: start a game, turn off random refills and load an exact
// board so clears / gravity / cascades / scoring are fully reproducible.
async function loadDeterministic(page, rows) {
    await page.evaluate((r) => {
        startGame();
        autoRefill = false;
        loadBoard(r);
    }, rows);
}

test.describe('Match-3', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Match-3', async ({ page }) => {
            await expect(page).toHaveTitle('Match-3');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to press/start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('moves start at MAX_MOVES (20)', async ({ page }) => {
            await expect(page.locator('#moves')).toHaveText('20');
            expect(await page.evaluate(() => MAX_MOVES)).toBe(20);
        });

        test('canvas is 480×480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('grid constants are 8×8 with 6 gem types', async ({ page }) => {
            const c = await page.evaluate(() => ({ GRID, NUM_TYPES, CELL }));
            expect(c.GRID).toBe(8);
            expect(c.NUM_TYPES).toBe(6);
            expect(c.CELL).toBe(60);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('clicking Start begins the game and hides the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('board is a full 8×8 grid with no empty cells', async ({ page }) => {
            await page.locator('#btn-start').click();
            const info = await page.evaluate(() => ({
                rows: board.length,
                cols: board[0].length,
                empties: board.flat().filter((v) => v < 0).length,
                allValid: board.flat().every((v) => v >= 0 && v < NUM_TYPES),
            }));
            expect(info.rows).toBe(8);
            expect(info.cols).toBe(8);
            expect(info.empties).toBe(0);
            expect(info.allValid).toBe(true);
        });

        test('a fresh board has no pre-existing matches', async ({ page }) => {
            await page.locator('#btn-start').click();
            const matches = await page.evaluate(() => findMatches().length);
            expect(matches).toBe(0);
        });

        test('a fresh board always has at least one legal move', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => hasPossibleMove())).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Match detection (deterministic boards)
    // -----------------------------------------------------------------------
    test.describe('findMatches', () => {
        test('detects a horizontal run of three', async ({ page }) => {
            await loadDeterministic(page, [
                '11101010',
                '01010101',
                '10101010',
                '01010101',
                '10101010',
                '01010101',
                '10101010',
                '01010101',
            ]);
            const n = await page.evaluate(() => findMatches().length);
            expect(n).toBe(3);
        });

        test('detects a vertical run of three', async ({ page }) => {
            await loadDeterministic(page, [
                '20101010',
                '21010101',
                '20101010',
                '01010101',
                '10101010',
                '01010101',
                '10101010',
                '01010101',
            ]);
            // column 0 rows 0..2 are all "2"
            const n = await page.evaluate(() => findMatches().length);
            expect(n).toBe(3);
        });

        test('detects a horizontal run of four (4 cells)', async ({ page }) => {
            await loadDeterministic(page, [
                '33330101',
                '01010101',
                '10101010',
                '01010101',
                '10101010',
                '01010101',
                '10101010',
                '01010101',
            ]);
            const n = await page.evaluate(() => findMatches().length);
            expect(n).toBe(4);
        });

        test('returns nothing for a match-free board', async ({ page }) => {
            await loadDeterministic(page, [
                '01010101',
                '10101010',
                '01010101',
                '10101010',
                '01010101',
                '10101010',
                '01010101',
                '10101010',
            ]);
            const n = await page.evaluate(() => findMatches().length);
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Adjacency & swapping
    // -----------------------------------------------------------------------
    test.describe('swapping', () => {
        test('areAdjacent is true for orthogonal neighbours only', async ({ page }) => {
            const r = await page.evaluate(() => ({
                right: areAdjacent({ r: 3, c: 3 }, { r: 3, c: 4 }),
                down: areAdjacent({ r: 3, c: 3 }, { r: 4, c: 3 }),
                diag: areAdjacent({ r: 3, c: 3 }, { r: 4, c: 4 }),
                far: areAdjacent({ r: 3, c: 3 }, { r: 3, c: 6 }),
                same: areAdjacent({ r: 3, c: 3 }, { r: 3, c: 3 }),
            }));
            expect(r.right).toBe(true);
            expect(r.down).toBe(true);
            expect(r.diag).toBe(false);
            expect(r.far).toBe(false);
            expect(r.same).toBe(false);
        });

        test('a swap that forms a match is accepted, spends a move, scores', async ({ page }) => {
            await loadDeterministic(page, [
                '........',
                '........',
                '........',
                '........',
                '........',
                '1.......',
                '1.......',
                '21......',
            ]);
            const res = await page.evaluate(() => {
                const before = movesLeft;
                const ok = trySwap({ r: 7, c: 0 }, { r: 7, c: 1 });
                return { ok, before, after: movesLeft, score };
            });
            expect(res.ok).toBe(true);
            expect(res.after).toBe(res.before - 1);
            expect(res.score).toBeGreaterThan(0);
        });

        test('a swap that forms no match is rejected and reverted', async ({ page }) => {
            await loadDeterministic(page, [
                '........',
                '........',
                '........',
                '........',
                '........',
                '........',
                '........',
                '21......',
            ]);
            const res = await page.evaluate(() => {
                const before = movesLeft;
                const ok = trySwap({ r: 7, c: 0 }, { r: 7, c: 1 });
                return { ok, before, after: movesLeft, a: board[7][0], b: board[7][1] };
            });
            expect(res.ok).toBe(false);
            expect(res.after).toBe(res.before); // no move spent
            expect(res.a).toBe(2); // reverted
            expect(res.b).toBe(1);
        });

        test('a non-adjacent swap is rejected', async ({ page }) => {
            await loadDeterministic(page, [
                '........',
                '........',
                '........',
                '........',
                '........',
                '1.......',
                '1.......',
                '2..1....',
            ]);
            const res = await page.evaluate(() => {
                const before = movesLeft;
                const ok = trySwap({ r: 7, c: 0 }, { r: 7, c: 3 });
                return { ok, before, after: movesLeft };
            });
            expect(res.ok).toBe(false);
            expect(res.after).toBe(res.before);
        });

        test('clicking two adjacent gems performs a swap', async ({ page }) => {
            await loadDeterministic(page, [
                '........',
                '........',
                '........',
                '........',
                '........',
                '1.......',
                '1.......',
                '21......',
            ]);
            const res = await page.evaluate(() => {
                clickCell(7, 0); // select
                const sel = selected ? { ...selected } : null;
                clickCell(7, 1); // swap with adjacent
                return { sel, scoreAfter: score, selCleared: selected === null };
            });
            expect(res.sel).toEqual({ r: 7, c: 0 });
            expect(res.scoreAfter).toBeGreaterThan(0);
            expect(res.selCleared).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Clearing, gravity & cascades (deterministic, autoRefill off)
    // -----------------------------------------------------------------------
    test.describe('clearing & gravity', () => {
        test('clearMatches empties the matched cells', async ({ page }) => {
            await loadDeterministic(page, [
                '11101010',
                '01010101',
                '10101010',
                '01010101',
                '10101010',
                '01010101',
                '10101010',
                '01010101',
            ]);
            const emptied = await page.evaluate(() => {
                const m = findMatches();
                clearMatches(m);
                return [board[0][0], board[0][1], board[0][2]];
            });
            expect(emptied).toEqual([-1, -1, -1]);
        });

        test('applyGravity drops gems to the bottom of their column', async ({ page }) => {
            await loadDeterministic(page, [
                '1.......',
                '........',
                '2.......',
                '........',
                '........',
                '........',
                '........',
                '........',
            ]);
            const col = await page.evaluate(() => {
                applyGravity();
                return { bottom: board[7][0], next: board[6][0], top: board[0][0] };
            });
            expect(col.bottom).toBe(2);
            expect(col.next).toBe(1);
            expect(col.top).toBe(-1);
        });

        test('a single match with no cascade scores 30 (3 gems × 10 × 1)', async ({ page }) => {
            await loadDeterministic(page, [
                '22210101',
                '10101010',
                '01010101',
                '10101010',
                '01010101',
                '10101010',
                '01010101',
                '10101010',
            ]);
            const res = await page.evaluate(() => {
                const gained = resolveBoard();
                return { gained, score, remaining: findMatches().length };
            });
            expect(res.gained).toBe(30);
            expect(res.score).toBe(30);
            expect(res.remaining).toBe(0);
        });

        test('a cascade applies an increasing multiplier (30 + 60 = 90)', async ({ page }) => {
            // Vertical 1,1,1 in col0 clears; the 2 above falls to the bottom row
            // and lines up 2,2,2 across the bottom → a second, ×2 clear.
            await loadDeterministic(page, [
                '........',
                '........',
                '........',
                '........',
                '2.......',
                '1.......',
                '1.......',
                '122.....',
            ]);
            const res = await page.evaluate(() => {
                const gained = resolveBoard();
                return { gained, score, remaining: findMatches().length };
            });
            expect(res.gained).toBe(90);
            expect(res.score).toBe(90);
            expect(res.remaining).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Game over & best score
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('running out of moves ends the game', async ({ page }) => {
            await loadDeterministic(page, [
                '........',
                '........',
                '........',
                '........',
                '........',
                '1.......',
                '1.......',
                '21......',
            ]);
            const st = await page.evaluate(() => {
                movesLeft = 1;
                trySwap({ r: 7, c: 0 }, { r: 7, c: 1 });
                return { state, moves: movesLeft };
            });
            expect(st.moves).toBe(0);
            expect(st.state).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Over');
        });

        test('game over persists the best score to localStorage', async ({ page }) => {
            await loadDeterministic(page, [
                '........',
                '........',
                '........',
                '........',
                '........',
                '1.......',
                '1.......',
                '21......',
            ]);
            const stored = await page.evaluate(() => {
                movesLeft = 1;
                trySwap({ r: 7, c: 0 }, { r: 7, c: 1 });
                return localStorage.getItem('match3-best');
            });
            expect(stored).toBe('30');
            await expect(page.locator('#best')).toHaveText('30');
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test('the score element reflects the score after a resolve', async ({ page }) => {
            await loadDeterministic(page, [
                '22210101',
                '10101010',
                '01010101',
                '10101010',
                '01010101',
                '10101010',
                '01010101',
                '10101010',
            ]);
            await page.evaluate(() => resolveBoard());
            await expect(page.locator('#score')).toHaveText('30');
        });
    });
});
