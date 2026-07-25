const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// The known full-coverage solution for LEVELS[0] (a 5×5 interlocking board).
// Each path begins at one endpoint and ends at the matching one, and together
// they tile all 25 cells — this is what the game is built to accept.
const LEVEL0_SOLUTION = {
    R: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1]],
    G: [[0, 1], [0, 2], [0, 3], [0, 4]],
    B: [[1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2]],
    Y: [[1, 1], [1, 2], [1, 3], [2, 3], [3, 3]],
    P: [[2, 1], [2, 2], [3, 2], [3, 1]],
};

// Draw a full solution map ({color: [[r,c],…]}) through the public API.
async function drawSolution(page, solution) {
    await page.evaluate((sol) => {
        for (const color of Object.keys(sol)) {
            const cells = sol[color];
            startPath(cells[0][0], cells[0][1]);
            for (let i = 1; i < cells.length; i++) extendPath(cells[i][0], cells[i][1]);
            endPath();
        }
    }, solution);
}

test.describe('Flow', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Flow', async ({ page }) => {
            await expect(page).toHaveTitle('Flow');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('start');
        });

        test('level, moves and pipe start at 1 / 0 / 0%', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#moves')).toHaveText('0');
            await expect(page.locator('#pipe')).toHaveText('0%');
        });

        test('best starts blank when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('–');
        });

        test('canvas is 480×480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('first level is a 5×5 board', async ({ page }) => {
            const s = await page.evaluate(() => size);
            expect(s).toBe(5);
        });

        test('state is idle before starting', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });

        test('every colour has two endpoints', async ({ page }) => {
            const ok = await page.evaluate(() =>
                Object.values(ep).every(pair => pair.length === 2));
            expect(ok).toBe(true);
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

        test('state is playing after clicking Start', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => state);
            expect(s).toBe('playing');
        });

        test('pressing a key dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Drawing pipes
    // -----------------------------------------------------------------------
    test.describe('drawing pipes', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => loadLevel(1)); // border 5×5 with predictable endpoints
        });

        test('starting on an endpoint begins a one-cell path', async ({ page }) => {
            const len = await page.evaluate(() => { startPath(1, 1); return paths.B.length; });
            expect(len).toBe(1);
        });

        test('starting a path increments the moves counter', async ({ page }) => {
            await page.evaluate(() => { startPath(1, 1); });
            await expect(page.locator('#moves')).toHaveText('1');
        });

        test('starting on an empty cell does nothing', async ({ page }) => {
            const started = await page.evaluate(() => startPath(2, 2));
            expect(started).toBe(false);
        });

        test('extending to an adjacent empty cell grows the path', async ({ page }) => {
            const len = await page.evaluate(() => {
                startPath(1, 1);
                extendPath(1, 2);
                return paths.B.length;
            });
            expect(len).toBe(2);
        });

        test('extending to a non-adjacent cell is rejected', async ({ page }) => {
            const result = await page.evaluate(() => {
                startPath(1, 1);
                const ok = extendPath(1, 3); // two cells away
                return { ok, len: paths.B.length };
            });
            expect(result.ok).toBe(false);
            expect(result.len).toBe(1);
        });

        test('backtracking onto the previous cell erases the head', async ({ page }) => {
            const len = await page.evaluate(() => {
                startPath(1, 1);
                extendPath(1, 2);
                extendPath(1, 1); // step back
                return paths.B.length;
            });
            expect(len).toBe(1);
        });

        test('reaching the matching endpoint connects the colour', async ({ page }) => {
            const connected = await page.evaluate(() => {
                startPath(1, 1);
                extendPath(1, 2);
                extendPath(1, 3); // B's other endpoint
                return isConnected('B');
            });
            expect(connected).toBe(true);
        });

        test('routing through another colour\'s endpoint is rejected', async ({ page }) => {
            const result = await page.evaluate(() => {
                startPath(2, 1);           // Y endpoint
                const ok = extendPath(1, 1); // B's endpoint directly above
                return { ok, owner: board[1][1] };
            });
            expect(result.ok).toBe(false);
            expect(result.owner).toBe('B'); // still B's endpoint
        });

        test('crossing another colour\'s pipe cuts it', async ({ page }) => {
            const result = await page.evaluate(() => {
                // Draw B across the middle of row 1.
                startPath(1, 1); extendPath(1, 2); extendPath(1, 3); endPath();
                // Route Y up into B's middle cell (1,2), cutting it.
                startPath(2, 1); extendPath(2, 2); extendPath(1, 2); endPath();
                return { owner: board[1][2], bLen: paths.B.length };
            });
            expect(result.owner).toBe('Y');
            expect(result.bLen).toBe(1); // B truncated back to just its first endpoint
        });
    });

    // -----------------------------------------------------------------------
    // Solving
    // -----------------------------------------------------------------------
    test.describe('solving', () => {
        test('the board is not solved at the start', async ({ page }) => {
            const solved = await page.evaluate(() => isSolved());
            expect(solved).toBe(false);
        });

        test('drawing the full solution solves the level', async ({ page }) => {
            await page.evaluate(() => loadLevel(0));
            await drawSolution(page, LEVEL0_SOLUTION);
            const solved = await page.evaluate(() => isSolved());
            expect(solved).toBe(true);
        });

        test('a solved board fills every cell (pipe 100%)', async ({ page }) => {
            await page.evaluate(() => loadLevel(0));
            await drawSolution(page, LEVEL0_SOLUTION);
            await expect(page.locator('#pipe')).toHaveText('100%');
        });

        test('solving shows the Level Solved overlay', async ({ page }) => {
            await page.evaluate(() => loadLevel(0));
            await drawSolution(page, LEVEL0_SOLUTION);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Solved');
        });

        test('state becomes solved once the level is complete', async ({ page }) => {
            await page.evaluate(() => loadLevel(0));
            await drawSolution(page, LEVEL0_SOLUTION);
            const s = await page.evaluate(() => state);
            expect(s).toBe('solved');
        });

        test('solving records the best move count in localStorage', async ({ page }) => {
            await page.evaluate(() => loadLevel(0));
            await drawSolution(page, LEVEL0_SOLUTION);
            const stored = await page.evaluate(() => localStorage.getItem('flow-best-1'));
            expect(parseInt(stored)).toBe(5); // one gesture per colour
        });
    });

    // -----------------------------------------------------------------------
    // Reset & level progression
    // -----------------------------------------------------------------------
    test.describe('reset and progression', () => {
        test('resetting clears every drawn pipe', async ({ page }) => {
            const filled = await page.evaluate(() => {
                loadLevel(1);
                startPath(1, 1); extendPath(1, 2); endPath();
                resetLevel();
                // Only the endpoints remain filled.
                return { moves, paths: Object.values(paths).every(p => p.length <= 1) };
            });
            expect(filled.moves).toBe(0);
            expect(filled.paths).toBe(true);
        });

        test('advancing to the next level increases the level number', async ({ page }) => {
            await page.evaluate(() => { loadLevel(0); nextLevel(); });
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the third level is a 6×6 board', async ({ page }) => {
            const s = await page.evaluate(() => { loadLevel(2); return size; });
            expect(s).toBe(6);
        });

        test('there are at least three levels', async ({ page }) => {
            const n = await page.evaluate(() => LEVELS.length);
            expect(n).toBeGreaterThanOrEqual(3);
        });
    });

    // -----------------------------------------------------------------------
    // Pointer input
    // -----------------------------------------------------------------------
    test.describe('pointer input', () => {
        test('cellFromXY maps canvas coordinates to grid cells', async ({ page }) => {
            const cell = await page.evaluate(() => {
                loadLevel(1); // 5×5 → 96px cells
                return cellFromXY(96 * 2 + 10, 96 * 3 + 10); // column 2, row 3
            });
            expect(cell).toEqual({ r: 3, c: 2 });
        });

        test('dragging on the canvas draws a pipe', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => loadLevel(1));
            const box = await page.locator('#canvas').boundingBox();
            const cell = 96; // 480 / 5
            const cx = (c) => box.x + c * cell + cell / 2;
            const cy = (r) => box.y + r * cell + cell / 2;
            // B endpoints at (1,1) and (1,3): drag across the row.
            await page.mouse.move(cx(1), cy(1));
            await page.mouse.down();
            await page.mouse.move(cx(2), cy(1));
            await page.mouse.move(cx(3), cy(1));
            await page.mouse.up();
            const connected = await page.evaluate(() => isConnected('B'));
            expect(connected).toBe(true);
        });
    });
});
