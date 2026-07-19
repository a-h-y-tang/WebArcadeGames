const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// A small, fully-known test level with a verified full-coverage solution.
//   0: R . . . R
//   1: G . . . .
//   2: G . . . .
//   3: B . . . .
//   4: B . . . .
// Solution:
//   R: top row (0,0)->(0,4)
//   G: snake over rows 1-2, (1,0)->..->(1,4)->(2,4)->..->(2,0)
//   B: snake over rows 3-4, (3,0)->..->(3,4)->(4,4)->..->(4,0)
const TEST_LEVEL = ['R...R', 'G....', 'G....', 'B....', 'B....'];

const SOLUTION = {
    R: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
    G: [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [2, 4], [2, 3], [2, 2], [2, 1], [2, 0]],
    B: [[3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0]],
};

async function loadTest(page) {
    await page.evaluate((rows) => window.loadCustomLevel(rows), TEST_LEVEL);
}

async function draw(page, cells) {
    return page.evaluate((c) => window.drawPath(c), cells);
}

test.describe('ColorFlow', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial page / DOM
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is ColorFlow', async ({ page }) => {
            await expect(page).toHaveTitle('ColorFlow');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/connect|fill|pipe/i);
        });

        test('canvas exists with fixed pixel size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', /\d+/);
            await expect(canvas).toHaveAttribute('height', /\d+/);
        });

        test('level indicator starts at level 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('exposes the game API on window', async ({ page }) => {
            const api = await page.evaluate(() => ({
                loadCustomLevel: typeof window.loadCustomLevel,
                loadLevel: typeof window.loadLevel,
                startPath: typeof window.startPath,
                extendPath: typeof window.extendPath,
                endPath: typeof window.endPath,
                drawPath: typeof window.drawPath,
                isWon: typeof window.isWon,
                getState: typeof window.getState,
                resetLevel: typeof window.resetLevel,
                getColorAt: typeof window.getColorAt,
                isEndpoint: typeof window.isEndpoint,
                isColorComplete: typeof window.isColorComplete,
            }));
            for (const k of Object.keys(api)) {
                expect(api[k], `window.${k}`).toBe('function');
            }
        });
    });

    // -----------------------------------------------------------------------
    // Level loading
    // -----------------------------------------------------------------------
    test.describe('level loading', () => {
        test('parses grid dimensions from the level', async ({ page }) => {
            await loadTest(page);
            const state = await page.evaluate(() => window.getState());
            expect(state.rows).toBe(5);
            expect(state.cols).toBe(5);
        });

        test('endpoints are placed and coloured', async ({ page }) => {
            await loadTest(page);
            expect(await page.evaluate(() => window.isEndpoint(0, 0))).toBe(true);
            expect(await page.evaluate(() => window.isEndpoint(0, 4))).toBe(true);
            expect(await page.evaluate(() => window.getColorAt(0, 0))).toBe('R');
            expect(await page.evaluate(() => window.getColorAt(0, 4))).toBe('R');
        });

        test('non-endpoint cells start empty', async ({ page }) => {
            await loadTest(page);
            expect(await page.evaluate(() => window.getColorAt(2, 2))).toBe(null);
            expect(await page.evaluate(() => window.isEndpoint(2, 2))).toBe(false);
        });

        test('reports the number of colour pairs', async ({ page }) => {
            await loadTest(page);
            const state = await page.evaluate(() => window.getState());
            expect(state.colorCount).toBe(3);
        });

        test('nothing is solved on a fresh level', async ({ page }) => {
            await loadTest(page);
            expect(await page.evaluate(() => window.isWon())).toBe(false);
            const state = await page.evaluate(() => window.getState());
            expect(state.connectedCount).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Drawing basics
    // -----------------------------------------------------------------------
    test.describe('drawing', () => {
        test('startPath only works on an endpoint or existing pipe', async ({ page }) => {
            await loadTest(page);
            expect(await page.evaluate(() => window.startPath(2, 2))).toBe(false); // empty cell
            expect(await page.evaluate(() => window.startPath(0, 0))).toBe(true);  // endpoint
        });

        test('extending onto an adjacent empty cell colours it', async ({ page }) => {
            await loadTest(page);
            await page.evaluate(() => window.startPath(0, 0));
            expect(await page.evaluate(() => window.extendPath(0, 1))).toBe(true);
            expect(await page.evaluate(() => window.getColorAt(0, 1))).toBe('R');
            await page.evaluate(() => window.endPath());
        });

        test('diagonal and non-adjacent moves are rejected', async ({ page }) => {
            await loadTest(page);
            await page.evaluate(() => window.startPath(0, 0));
            expect(await page.evaluate(() => window.extendPath(1, 1))).toBe(false); // diagonal
            expect(await page.evaluate(() => window.extendPath(0, 3))).toBe(false); // far
            expect(await page.evaluate(() => window.getColorAt(1, 1))).toBe(null);
            await page.evaluate(() => window.endPath());
        });

        test('backtracking onto the previous cell removes the last segment', async ({ page }) => {
            await loadTest(page);
            await page.evaluate(() => window.startPath(0, 0));
            await page.evaluate(() => window.extendPath(0, 1));
            await page.evaluate(() => window.extendPath(0, 2));
            expect(await page.evaluate(() => window.getColorAt(0, 2))).toBe('R');
            // pull back to (0,1) -> (0,2) should clear
            expect(await page.evaluate(() => window.extendPath(0, 1))).toBe(true);
            expect(await page.evaluate(() => window.getColorAt(0, 2))).toBe(null);
            expect(await page.evaluate(() => window.getColorAt(0, 1))).toBe('R');
            await page.evaluate(() => window.endPath());
        });

        test('reaching the matching endpoint completes the colour', async ({ page }) => {
            await loadTest(page);
            const ok = await draw(page, SOLUTION.R);
            expect(ok).toBe(true);
            expect(await page.evaluate(() => window.isColorComplete('R'))).toBe(true);
            const state = await page.evaluate(() => window.getState());
            expect(state.connectedCount).toBe(1);
        });

        test('cannot extend through a different colour endpoint', async ({ page }) => {
            await loadTest(page);
            // Start R at (0,0), try to walk down the left column into G's endpoint (1,0)
            await page.evaluate(() => window.startPath(0, 0));
            expect(await page.evaluate(() => window.extendPath(1, 0))).toBe(false);
            expect(await page.evaluate(() => window.getColorAt(1, 0))).toBe('G'); // unchanged
            await page.evaluate(() => window.endPath());
        });

        test('starting a colour afresh discards its previous pipe', async ({ page }) => {
            await loadTest(page);
            await draw(page, [[0, 0], [0, 1], [0, 2]]);
            expect(await page.evaluate(() => window.getColorAt(0, 2))).toBe('R');
            // start again from the same endpoint
            await page.evaluate(() => window.startPath(0, 0));
            await page.evaluate(() => window.endPath());
            expect(await page.evaluate(() => window.getColorAt(0, 1))).toBe(null);
            expect(await page.evaluate(() => window.getColorAt(0, 2))).toBe(null);
        });
    });

    // -----------------------------------------------------------------------
    // Overwrite semantics
    // -----------------------------------------------------------------------
    test.describe('overwriting another colour', () => {
        test('drawing over another pipe cuts it at the stolen cell', async ({ page }) => {
            await loadTest(page);
            // G draws down-and-right into the middle: (1,0)->(1,1)->(1,2)->(2,2)
            await draw(page, [[1, 0], [1, 1], [1, 2], [2, 2]]);
            expect(await page.evaluate(() => window.getColorAt(1, 2))).toBe('G');
            expect(await page.evaluate(() => window.getColorAt(2, 2))).toBe('G');
            // B steals (2,2): start B at (3,0) and route up into (2,2)
            await draw(page, [[3, 0], [2, 0]]); // just to have B somewhere is not needed; do direct steal
            // Directly steal: start a fresh B path and claim (2,2) via (3,2)->(2,2)
            await page.evaluate(() => window.resetLevel());
            await draw(page, [[1, 0], [1, 1], [1, 2], [2, 2], [3, 2]]); // G occupies (2,2),(3,2)
            expect(await page.evaluate(() => window.getColorAt(3, 2))).toBe('G');
            // B steals (3,2)
            await page.evaluate(() => window.startPath(3, 0));
            await page.evaluate(() => window.extendPath(3, 1));
            const stole = await page.evaluate(() => window.extendPath(3, 2));
            expect(stole).toBe(true);
            expect(await page.evaluate(() => window.getColorAt(3, 2))).toBe('B');
            // G lost (3,2) and everything drawn after it (nothing after here)
            const gpath = (await page.evaluate(() => window.getState())).paths.G;
            expect(gpath.some(([r, c]) => r === 3 && c === 2)).toBe(false);
            await page.evaluate(() => window.endPath());
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('connecting all pairs but not filling the board is NOT a win', async ({ page }) => {
            await loadTest(page);
            // Connect G and B trivially via the short adjacent route (leaves cells empty),
            // and R across the top (fills top row only).
            await draw(page, SOLUTION.R);
            await draw(page, [[1, 0], [2, 0]]); // G connected directly, minimal
            await draw(page, [[3, 0], [4, 0]]); // B connected directly, minimal
            const state = await page.evaluate(() => window.getState());
            expect(state.connectedCount).toBe(3);
            expect(await page.evaluate(() => window.isWon())).toBe(false); // board not full
        });

        test('full-coverage solution wins the level', async ({ page }) => {
            await loadTest(page);
            await draw(page, SOLUTION.R);
            await draw(page, SOLUTION.G);
            await draw(page, SOLUTION.B);
            const state = await page.evaluate(() => window.getState());
            expect(state.flowPercent).toBe(100);
            expect(state.connectedCount).toBe(3);
            expect(await page.evaluate(() => window.isWon())).toBe(true);
        });

        test('winning reveals the solved overlay', async ({ page }) => {
            await page.evaluate(() => window.loadCustomLevel(['R...R', 'G....', 'G....', 'B....', 'B....']));
            await draw(page, SOLUTION.R);
            await draw(page, SOLUTION.G);
            await draw(page, SOLUTION.B);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/solv|win|clear|complete/i);
        });
    });

    // -----------------------------------------------------------------------
    // Reset
    // -----------------------------------------------------------------------
    test.describe('reset', () => {
        test('reset clears all pipes but keeps endpoints', async ({ page }) => {
            await loadTest(page);
            await draw(page, SOLUTION.R);
            expect(await page.evaluate(() => window.getColorAt(0, 2))).toBe('R');
            await page.evaluate(() => window.resetLevel());
            expect(await page.evaluate(() => window.getColorAt(0, 2))).toBe(null); // pipe gone
            expect(await page.evaluate(() => window.getColorAt(0, 0))).toBe('R');  // endpoint kept
            expect(await page.evaluate(() => window.isEndpoint(0, 0))).toBe(true);
            expect(await page.evaluate(() => window.isWon())).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Built-in levels
    // -----------------------------------------------------------------------
    test.describe('built-in levels', () => {
        test('at least three levels ship and each is well-formed', async ({ page }) => {
            const count = await page.evaluate(() => window.getLevelCount());
            expect(count).toBeGreaterThanOrEqual(3);
            for (let i = 0; i < count; i++) {
                const info = await page.evaluate((idx) => {
                    window.loadLevel(idx);
                    const s = window.getState();
                    return { rows: s.rows, cols: s.cols, colorCount: s.colorCount };
                }, i);
                expect(info.rows).toBeGreaterThanOrEqual(5);
                expect(info.cols).toBeGreaterThanOrEqual(5);
                expect(info.colorCount).toBeGreaterThanOrEqual(3);
            }
        });

        test('every endpoint colour appears exactly twice in each level', async ({ page }) => {
            const count = await page.evaluate(() => window.getLevelCount());
            for (let i = 0; i < count; i++) {
                const counts = await page.evaluate((idx) => {
                    window.loadLevel(idx);
                    const s = window.getState();
                    const tally = {};
                    for (let r = 0; r < s.rows; r++) {
                        for (let c = 0; c < s.cols; c++) {
                            if (window.isEndpoint(r, c)) {
                                const col = window.getColorAt(r, c);
                                tally[col] = (tally[col] || 0) + 1;
                            }
                        }
                    }
                    return tally;
                }, i);
                for (const col of Object.keys(counts)) {
                    expect(counts[col], `level ${i} colour ${col}`).toBe(2);
                }
            }
        });
    });
});
