const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// A hand-verified 8x8 board (6 colours) that has NO existing matches and NO
// possible swap that would create one — i.e. a deadlock / game-over board.
const DEADLOCK = [
    [2, 1, 5, 2, 1, 3, 2, 5],
    [4, 5, 2, 3, 5, 4, 3, 1],
    [2, 3, 4, 1, 3, 2, 4, 5],
    [3, 4, 1, 0, 5, 5, 0, 2],
    [0, 5, 2, 0, 4, 4, 2, 5],
    [3, 1, 4, 1, 2, 0, 3, 0],
    [2, 1, 4, 5, 5, 1, 4, 1],
    [5, 2, 0, 2, 3, 2, 0, 4],
];

test.describe('Gem Crush', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Gem Crush', async ({ page }) => {
            await expect(page).toHaveTitle('Gem Crush');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('board is 8x8', async ({ page }) => {
            const dims = await page.evaluate(() => [board.length, board[0].length]);
            expect(dims).toEqual([8, 8]);
        });

        test('every cell holds a valid colour index', async ({ page }) => {
            const ok = await page.evaluate(() =>
                board.every(row => row.every(v => Number.isInteger(v) && v >= 0 && v < COLORS.length))
            );
            expect(ok).toBe(true);
        });

        test('starting board contains no pre-existing matches', async ({ page }) => {
            const matches = await page.evaluate(() => findMatches(board).size);
            expect(matches).toBe(0);
        });

        test('starting board has at least one valid move', async ({ page }) => {
            const has = await page.evaluate(() => hasValidMove(board));
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

        test('a key press starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Match detection (pure logic)
    // -----------------------------------------------------------------------
    test.describe('match detection', () => {
        test('detects a horizontal run of three', async ({ page }) => {
            const size = await page.evaluate(() => {
                const b = [
                    [0, 0, 0, 1],
                    [1, 2, 3, 2],
                    [2, 3, 1, 3],
                    [3, 1, 2, 1],
                ];
                return findMatches(b).size;
            });
            expect(size).toBe(3);
        });

        test('detects a vertical run of three', async ({ page }) => {
            const size = await page.evaluate(() => {
                const b = [
                    [0, 1, 2, 3],
                    [0, 2, 3, 1],
                    [0, 3, 1, 2],
                    [1, 2, 3, 1],
                ];
                return findMatches(b).size;
            });
            expect(size).toBe(3);
        });

        test('a run of four counts all four cells', async ({ page }) => {
            const size = await page.evaluate(() => {
                const b = [
                    [5, 5, 5, 5],
                    [1, 2, 3, 2],
                    [2, 3, 1, 3],
                    [3, 1, 2, 1],
                ];
                return findMatches(b).size;
            });
            expect(size).toBe(4);
        });

        test('two-in-a-row is not a match', async ({ page }) => {
            const size = await page.evaluate(() => {
                const b = [
                    [0, 0, 1, 2],
                    [1, 2, 3, 0],
                    [2, 3, 1, 3],
                    [3, 1, 2, 1],
                ];
                return findMatches(b).size;
            });
            expect(size).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Swapping
    // -----------------------------------------------------------------------
    test.describe('swapping', () => {
        test('a swap that creates a match sticks and scores', async ({ page }) => {
            await page.locator('#btn-start').click();
            const scored = await page.evaluate(() => {
                // Row 0 is 1,0,0,... ; swapping (0,0) with (1,0)=0 makes 0,0,0
                board = [
                    [1, 0, 0, 2, 3, 4, 5, 1],
                    [0, 2, 3, 4, 5, 1, 2, 3],
                    [3, 4, 5, 1, 2, 3, 4, 5],
                    [4, 5, 1, 2, 3, 4, 5, 1],
                    [5, 1, 2, 3, 4, 5, 1, 2],
                    [1, 2, 3, 4, 5, 1, 2, 3],
                    [2, 3, 4, 5, 1, 2, 3, 4],
                    [3, 4, 5, 1, 2, 3, 4, 5],
                ];
                const before = score;
                const stuck = trySwap({ r: 0, c: 0 }, { r: 1, c: 0 });
                return { stuck, gained: score - before };
            });
            expect(scored.stuck).toBe(true);
            expect(scored.gained).toBeGreaterThan(0);
        });

        test('the score display updates after a scoring swap', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                board = [
                    [1, 0, 0, 2, 3, 4, 5, 1],
                    [0, 2, 3, 4, 5, 1, 2, 3],
                    [3, 4, 5, 1, 2, 3, 4, 5],
                    [4, 5, 1, 2, 3, 4, 5, 1],
                    [5, 1, 2, 3, 4, 5, 1, 2],
                    [1, 2, 3, 4, 5, 1, 2, 3],
                    [2, 3, 4, 5, 1, 2, 3, 4],
                    [3, 4, 5, 1, 2, 3, 4, 5],
                ];
                trySwap({ r: 0, c: 0 }, { r: 1, c: 0 });
            });
            await expect(page.locator('#score')).not.toHaveText('0');
        });

        test('a swap that creates no match is reverted', async ({ page }) => {
            await page.locator('#btn-start').click();
            const result = await page.evaluate(() => {
                board = [
                    [0, 1, 2, 3, 4, 5, 0, 1],
                    [1, 2, 3, 4, 5, 0, 1, 2],
                    [2, 3, 4, 5, 0, 1, 2, 3],
                    [3, 4, 5, 0, 1, 2, 3, 4],
                    [4, 5, 0, 1, 2, 3, 4, 5],
                    [5, 0, 1, 2, 3, 4, 5, 0],
                    [0, 1, 2, 3, 4, 5, 0, 1],
                    [1, 2, 3, 4, 5, 0, 1, 2],
                ];
                const a = board[0][0], bcell = board[0][1];
                const stuck = trySwap({ r: 0, c: 0 }, { r: 0, c: 1 });
                return { stuck, restoredA: board[0][0] === a, restoredB: board[0][1] === bcell };
            });
            expect(result.stuck).toBe(false);
            expect(result.restoredA).toBe(true);
            expect(result.restoredB).toBe(true);
        });

        test('non-adjacent cells are not swapped by a click sequence', async ({ page }) => {
            await page.locator('#btn-start').click();
            const changed = await page.evaluate(() => {
                const snapshot = board.map(r => r.slice());
                handleCellClick(0, 0);
                handleCellClick(3, 3); // not adjacent → just moves selection
                // boards should be identical (no swap happened)
                return JSON.stringify(board) !== JSON.stringify(snapshot);
            });
            expect(changed).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Gravity & refill
    // -----------------------------------------------------------------------
    test.describe('gravity and refill', () => {
        test('gravity drops gems to fill holes below them', async ({ page }) => {
            const col0 = await page.evaluate(() => {
                const b = [
                    [1, 9, 9, 9],
                    [null, 9, 9, 9],
                    [2, 9, 9, 9],
                    [null, 9, 9, 9],
                ];
                applyGravity(b);
                return [b[0][0], b[1][0], b[2][0], b[3][0]];
            });
            // The two non-null values (1 then 2) should end up at the bottom,
            // in order, with nulls pushed to the top.
            expect(col0).toEqual([null, null, 1, 2]);
        });

        test('after a resolve the board has no empty cells', async ({ page }) => {
            await page.locator('#btn-start').click();
            const anyNull = await page.evaluate(() => {
                board = [
                    [1, 0, 0, 2, 3, 4, 5, 1],
                    [0, 2, 3, 4, 5, 1, 2, 3],
                    [3, 4, 5, 1, 2, 3, 4, 5],
                    [4, 5, 1, 2, 3, 4, 5, 1],
                    [5, 1, 2, 3, 4, 5, 1, 2],
                    [1, 2, 3, 4, 5, 1, 2, 3],
                    [2, 3, 4, 5, 1, 2, 3, 4],
                    [3, 4, 5, 1, 2, 3, 4, 5],
                ];
                trySwap({ r: 0, c: 0 }, { r: 1, c: 0 });
                return board.some(row => row.some(v => v === null));
            });
            expect(anyNull).toBe(false);
        });

        test('resolving leaves no matches on the board', async ({ page }) => {
            await page.locator('#btn-start').click();
            const remaining = await page.evaluate(() => {
                board = [
                    [1, 0, 0, 2, 3, 4, 5, 1],
                    [0, 2, 3, 4, 5, 1, 2, 3],
                    [3, 4, 5, 1, 2, 3, 4, 5],
                    [4, 5, 1, 2, 3, 4, 5, 1],
                    [5, 1, 2, 3, 4, 5, 1, 2],
                    [1, 2, 3, 4, 5, 1, 2, 3],
                    [2, 3, 4, 5, 1, 2, 3, 4],
                    [3, 4, 5, 1, 2, 3, 4, 5],
                ];
                trySwap({ r: 0, c: 0 }, { r: 1, c: 0 });
                return findMatches(board).size;
            });
            expect(remaining).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Deadlock detection
    // -----------------------------------------------------------------------
    test.describe('deadlock detection', () => {
        test('hasValidMove is true when an adjacent swap can match', async ({ page }) => {
            const has = await page.evaluate(() => {
                const b = [
                    [0, 1, 0, 2],
                    [0, 2, 3, 1], // swapping (0,1)&(1,1) makes column 1 => 0,1,... no; use col 0
                    [3, 0, 1, 2],
                    [1, 2, 3, 0],
                ];
                return hasValidMove(b);
            });
            expect(has).toBe(true);
        });

        test('hasValidMove is false on a deadlocked board', async ({ page }) => {
            const has = await page.evaluate((b) => hasValidMove(b), DEADLOCK);
            expect(has).toBe(false);
        });

        test('a deadlocked board also has no existing matches', async ({ page }) => {
            const size = await page.evaluate((b) => findMatches(b).size, DEADLOCK);
            expect(size).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('reaching a deadlock ends the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate((dead) => {
                // Force the board into a deadlock, then trigger the post-swap check.
                board = dead.map(r => r.slice());
                checkGameOver();
                return state;
            }, DEADLOCK);
            expect(s).toBe('over');
        });

        test('game over overlay shows a final message', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('No Moves');
        });

        test('Play Again button appears after game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('starting again after game over resets the score', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 500; scoreEl.textContent = score; endGame(); });
            await page.locator('#btn-start').click();
            await expect(page.locator('#score')).toHaveText('0');
            const has = await page.evaluate(() => hasValidMove(board));
            expect(has).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best score updates on game over when the score is higher', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 250; scoreEl.textContent = score; endGame(); });
            await expect(page.locator('#best')).toHaveText('250');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 320; scoreEl.textContent = score; endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('gemcrush-best'));
            expect(parseInt(stored, 10)).toBe(320);
        });
    });

    // -----------------------------------------------------------------------
    // Canvas interaction
    // -----------------------------------------------------------------------
    test.describe('canvas interaction', () => {
        test('clicking a gem selects it', async ({ page }) => {
            await page.locator('#btn-start').click();
            const cell = await page.evaluate(() => CELL);
            await page.locator('#canvas').click({ position: { x: cell / 2, y: cell / 2 } });
            const sel = await page.evaluate(() => selected);
            expect(sel).toEqual({ r: 0, c: 0 });
        });

        test('clicking two adjacent gems performs a swap attempt', async ({ page }) => {
            await page.locator('#btn-start').click();
            // Swapping (0,0)<->(1,0) turns row 0 into 0,0,0 — a match.
            await page.evaluate(() => {
                board = [
                    [1, 0, 0, 2, 3, 4, 5, 1],
                    [0, 2, 3, 4, 5, 1, 2, 3],
                    [3, 4, 5, 1, 2, 3, 4, 5],
                    [4, 5, 1, 2, 3, 4, 5, 1],
                    [5, 1, 2, 3, 4, 5, 1, 2],
                    [1, 2, 3, 4, 5, 1, 2, 3],
                    [2, 3, 4, 5, 1, 2, 3, 4],
                    [3, 4, 5, 1, 2, 3, 4, 5],
                ];
                draw();
            });
            const cell = await page.evaluate(() => CELL);
            await page.locator('#canvas').click({ position: { x: cell / 2, y: cell / 2 } });        // (0,0)
            await page.locator('#canvas').click({ position: { x: cell / 2, y: cell * 1.5 } });      // (1,0)
            await expect(page.locator('#score')).not.toHaveText('0');
            const sel = await page.evaluate(() => selected);
            expect(sel).toBeNull();
        });
    });
});
