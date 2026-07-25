const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Build an empty ROWS x COLS grid in the page.
async function emptyGrid(page) {
    return page.evaluate(() => {
        const s = window.getState();
        return Array.from({ length: s.rows }, () => new Array(s.cols).fill(0));
    });
}

test.describe('Blob Drop', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state / page scaffolding
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Blob Drop', async ({ page }) => {
            await expect(page).toHaveTitle('Blob Drop');
        });

        test('start overlay is visible before starting', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('chain');
        });

        test('canvas exists with fixed pixel size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', /\d+/);
            await expect(canvas).toHaveAttribute('height', /\d+/);
        });

        test('score starts at zero', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('phase is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => window.getState().phase)).toBe('idle');
        });

        test('exposes the game API on window', async ({ page }) => {
            const api = await page.evaluate(() => {
                const names = [
                    'settleGravity', 'findGroups', 'resolveBoard',
                    'newGame', 'getState', 'getGrid', 'loadGrid', 'spawn', 'isGameOver',
                    'moveLeft', 'moveRight', 'rotateCW', 'rotateCCW',
                    'softDrop', 'hardDrop', 'tick', 'setCurrentPiece', 'setAutoFall',
                ];
                const out = {};
                for (const n of names) out[n] = typeof window[n];
                return out;
            });
            for (const k of Object.keys(api)) expect(api[k], k).toBe('function');
        });
    });

    // -----------------------------------------------------------------------
    // Pure engine: settleGravity
    // -----------------------------------------------------------------------
    test.describe('settleGravity (pure)', () => {
        test('a floating blob falls to the floor', async ({ page }) => {
            const grid = await emptyGrid(page);
            grid[3][2] = 1;
            const out = await page.evaluate((g) => window.settleGravity(g), grid);
            const rows = out.length;
            expect(out[rows - 1][2]).toBe(1);
            expect(out[3][2]).toBe(0);
        });

        test('a stack settles with no gaps and preserves order', async ({ page }) => {
            const grid = await emptyGrid(page);
            // column 0: blob at top, gap, blob — should compact to the floor.
            grid[2][0] = 1;
            grid[8][0] = 2;
            const out = await page.evaluate((g) => window.settleGravity(g), grid);
            const rows = out.length;
            expect(out[rows - 1][0]).toBe(2); // was lower, stays at bottom
            expect(out[rows - 2][0]).toBe(1); // sits right on top
            expect(out[2][0]).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pure engine: findGroups
    // -----------------------------------------------------------------------
    test.describe('findGroups (pure)', () => {
        test('finds a connected group of four', async ({ page }) => {
            const grid = await emptyGrid(page);
            const r = grid.length - 1;
            grid[r][0] = grid[r][1] = grid[r][2] = grid[r][3] = 1;
            const groups = await page.evaluate((g) => window.findGroups(g), grid);
            expect(groups).toHaveLength(1);
            expect(groups[0]).toHaveLength(4);
        });

        test('ignores a group of only three', async ({ page }) => {
            const grid = await emptyGrid(page);
            const r = grid.length - 1;
            grid[r][0] = grid[r][1] = grid[r][2] = 1;
            const groups = await page.evaluate((g) => window.findGroups(g), grid);
            expect(groups).toHaveLength(0);
        });

        test('does not merge groups of different colours', async ({ page }) => {
            const grid = await emptyGrid(page);
            const r = grid.length - 1;
            grid[r][0] = grid[r][1] = 1;
            grid[r][2] = grid[r][3] = 2;
            const groups = await page.evaluate((g) => window.findGroups(g), grid);
            expect(groups).toHaveLength(0); // two colours, each only size 2
        });
    });

    // -----------------------------------------------------------------------
    // Pure engine: resolveBoard
    // -----------------------------------------------------------------------
    test.describe('resolveBoard (pure)', () => {
        test('a single group of four clears in one chain', async ({ page }) => {
            const grid = await emptyGrid(page);
            const r = grid.length - 1;
            grid[r][0] = grid[r][1] = grid[r][2] = grid[r][3] = 1;
            const res = await page.evaluate((g) => window.resolveBoard(g), grid);
            expect(res.chains).toBe(1);
            expect(res.cleared).toBe(4);
            // the cleared cells are now empty
            expect(res.grid[r][0]).toBe(0);
        });

        test('a stacked setup resolves as a two-step chain', async ({ page }) => {
            const grid = await emptyGrid(page);
            const A = 1, B = 2;
            const rows = grid.length;
            // col 0 (bottom up): A A A A then B on top
            grid[rows - 1][0] = A;
            grid[rows - 2][0] = A;
            grid[rows - 3][0] = A;
            grid[rows - 4][0] = A;
            grid[rows - 5][0] = B;
            // col 1 (bottom up): B B B
            grid[rows - 1][1] = B;
            grid[rows - 2][1] = B;
            grid[rows - 3][1] = B;
            const res = await page.evaluate((g) => window.resolveBoard(g), grid);
            // First the four A's pop; the lone B drops down and completes the
            // fourth B, which pops on the second chain step.
            expect(res.chains).toBe(2);
            expect(res.cleared).toBe(8);
        });

        test('an unresolvable board reports zero chains', async ({ page }) => {
            const grid = await emptyGrid(page);
            const r = grid.length - 1;
            grid[r][0] = grid[r][1] = grid[r][2] = 1; // only three
            const res = await page.evaluate((g) => window.resolveBoard(g), grid);
            expect(res.chains).toBe(0);
            expect(res.cleared).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // New game / board
    // -----------------------------------------------------------------------
    test.describe('new game', () => {
        test('newGame(seed) is deterministic', async ({ page }) => {
            const [a, b] = await page.evaluate(() => {
                window.newGame(4242);
                const s1 = JSON.stringify(window.getState());
                window.newGame(4242);
                const s2 = JSON.stringify(window.getState());
                return [s1, s2];
            });
            expect(a).toBe(b);
        });

        test('newGame starts play with an empty board and a current pair', async ({ page }) => {
            const s = await page.evaluate(() => {
                window.newGame(7);
                return {
                    state: window.getState(),
                    filled: window.getGrid().flat().filter((v) => v !== 0).length,
                };
            });
            expect(s.state.phase).toBe('playing');
            expect(s.state.score).toBe(0);
            expect(s.state.current).not.toBeNull();
            expect(s.state.current.colors).toHaveLength(2);
            expect(s.filled).toBe(0);
        });

        test('newGame hides the overlay', async ({ page }) => {
            await page.evaluate(() => window.newGame(7));
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Piece movement
    // -----------------------------------------------------------------------
    test.describe('piece movement', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => {
                window.newGame(7);
                window.setAutoFall(false);
            });
        });

        test('moveLeft and moveRight shift the pivot column', async ({ page }) => {
            const res = await page.evaluate(() => {
                window.setCurrentPiece({ colors: [1, 2], col: 3, orientation: 0 });
                const start = window.getState().current.pivot.c;
                window.moveLeft();
                const left = window.getState().current.pivot.c;
                window.moveRight();
                window.moveRight();
                const right = window.getState().current.pivot.c;
                return { start, left, right };
            });
            expect(res.left).toBe(res.start - 1);
            expect(res.right).toBe(res.start + 1);
        });

        test('cannot move past the left wall', async ({ page }) => {
            const c = await page.evaluate(() => {
                window.setCurrentPiece({ colors: [1, 2], col: 0, orientation: 0 });
                window.moveLeft();
                return window.getState().current.pivot.c;
            });
            expect(c).toBe(0);
        });

        test('rotateCW cycles the orientation', async ({ page }) => {
            const res = await page.evaluate(() => {
                window.setCurrentPiece({ colors: [1, 2], col: 3, orientation: 0 });
                window.rotateCW();
                const a = window.getState().current.orientation;
                window.rotateCW();
                const b = window.getState().current.orientation;
                return { a, b };
            });
            expect(res.a).toBe(1);
            expect(res.b).toBe(2);
        });

        test('softDrop lowers the pair by one row', async ({ page }) => {
            const res = await page.evaluate(() => {
                window.setCurrentPiece({ colors: [1, 2], col: 3, orientation: 0 });
                const before = window.getState().current.pivot.r;
                window.softDrop();
                const after = window.getState().current.pivot.r;
                return { before, after };
            });
            expect(res.after).toBe(res.before + 1);
        });
    });

    // -----------------------------------------------------------------------
    // Locking, clearing, scoring
    // -----------------------------------------------------------------------
    test.describe('locking and scoring', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => {
                window.newGame(7);
                window.setAutoFall(false);
            });
        });

        test('hardDrop locks the pair into the grid and spawns a new one', async ({ page }) => {
            const res = await page.evaluate(() => {
                // empty board, drop a mismatched vertical pair so nothing clears
                const g = window.getGrid().map((row) => row.map(() => 0));
                window.loadGrid(g);
                window.setCurrentPiece({ colors: [1, 2], col: 3, orientation: 0 });
                window.hardDrop();
                return {
                    filled: window.getGrid().flat().filter((v) => v !== 0).length,
                    hasCurrent: window.getState().current !== null,
                };
            });
            expect(res.filled).toBe(2); // both blobs landed, nothing cleared
            expect(res.hasCurrent).toBe(true); // a fresh pair spawned
        });

        test('completing a group of four clears it and scores points', async ({ page }) => {
            const res = await page.evaluate(() => {
                const g = window.getGrid().map((row) => row.map(() => 0));
                const rows = g.length;
                // three of colour 1 along the floor, cols 0..2
                g[rows - 1][0] = 1;
                g[rows - 1][1] = 1;
                g[rows - 1][2] = 1;
                window.loadGrid(g);
                // drop a vertical 1/1 pair into col 3 -> floor cell completes the four
                window.setCurrentPiece({ colors: [1, 1], col: 3, orientation: 0 });
                window.hardDrop();
                return {
                    score: window.getState().score,
                    // the four floor blobs should be gone; at most the leftover
                    // top blob from the dropped pair remains
                    floorCount: window.getGrid()[rows - 1].filter((v) => v !== 0).length,
                };
            });
            expect(res.score).toBeGreaterThan(0);
            expect(res.floorCount).toBeLessThan(4);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('spawning into an occupied spawn cell ends the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                window.newGame(7);
                window.setAutoFall(false);
                const g = window.getGrid().map((row) => row.map(() => 0));
                // Block the whole top two rows so a new pair cannot appear.
                for (let c = 0; c < g[0].length; c++) {
                    g[0][c] = 1;
                    g[1][c] = 1;
                }
                window.loadGrid(g);
                window.spawn();
                return { over: window.isGameOver(), phase: window.getState().phase };
            });
            expect(res.over).toBe(true);
            expect(res.phase).toBe('gameover');
        });

        test('game over overlay is shown', async ({ page }) => {
            await page.evaluate(() => {
                window.newGame(7);
                window.setAutoFall(false);
                const g = window.getGrid().map((row) => row.map(() => 0));
                for (let c = 0; c < g[0].length; c++) {
                    g[0][c] = 1;
                    g[1][c] = 1;
                }
                window.loadGrid(g);
                window.spawn();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard controls
    // -----------------------------------------------------------------------
    test.describe('keyboard controls', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => {
                window.newGame(7);
                window.setAutoFall(false);
                window.setCurrentPiece({ colors: [1, 2], col: 3, orientation: 0 });
            });
            await page.locator('#canvas').focus();
        });

        test('arrow keys move the pair', async ({ page }) => {
            const before = await page.evaluate(() => window.getState().current.pivot.c);
            await page.keyboard.press('ArrowLeft');
            const after = await page.evaluate(() => window.getState().current.pivot.c);
            expect(after).toBe(before - 1);
        });

        test('up arrow rotates the pair', async ({ page }) => {
            const before = await page.evaluate(() => window.getState().current.orientation);
            await page.keyboard.press('ArrowUp');
            const after = await page.evaluate(() => window.getState().current.orientation);
            expect(after).not.toBe(before);
        });

        test('space hard-drops and locks the pair', async ({ page }) => {
            await page.evaluate(() => {
                const g = window.getGrid().map((row) => row.map(() => 0));
                window.loadGrid(g);
                window.setCurrentPiece({ colors: [1, 2], col: 3, orientation: 0 });
            });
            await page.locator('#canvas').focus();
            await page.keyboard.press('Space');
            const filled = await page.evaluate(
                () => window.getGrid().flat().filter((v) => v !== 0).length
            );
            expect(filled).toBe(2);
        });
    });
});
