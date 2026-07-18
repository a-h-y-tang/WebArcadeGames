const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Known full-cover solution for level 0 (5x5). Each entry is a colour's ordered
// pipe from one endpoint to the other.
const LEVEL0_SOLUTION = [
    [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 4], [2, 4], [3, 4]], // color 0
    [[1, 0], [1, 1], [1, 2], [1, 3]],                                 // color 1
    [[2, 0], [2, 1], [2, 2], [2, 3]],                                 // color 2
    [[3, 0], [3, 1], [3, 2], [3, 3]],                                 // color 3
    [[4, 0], [4, 1], [4, 2], [4, 3], [4, 4]],                         // color 4
];

// Solve the current level in-page given a solution (array of pipes, indexed by colour).
async function solve(page, solution) {
    await page.evaluate((sol) => {
        for (const pipe of sol) {
            beginPath(pipe[0][0], pipe[0][1]);
            for (let i = 1; i < pipe.length; i++) extendPath(pipe[i][0], pipe[i][1]);
            endDrag();
        }
    }, solution);
}

test.describe('Flow', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                for (let i = 0; i < 10; i++) localStorage.removeItem('flow-best-' + i);
            } catch (e) {}
        });
        await page.goto(GAME_URL);
    });

    // ---------------------------------------------------------------------
    // Initial state
    // ---------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Flow', async ({ page }) => {
            await expect(page).toHaveTitle('Flow');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('canvas is 560x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('there are at least 3 levels', async ({ page }) => {
            const n = await page.evaluate(() => LEVELS.length);
            expect(n).toBeGreaterThanOrEqual(3);
        });

        test('level 0 is a 5x5 grid', async ({ page }) => {
            const size = await page.evaluate(() => LEVELS[0].size);
            expect(size).toBe(5);
        });

        test('state starts as ready', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('ready');
        });

        test('best starts as em dash when localStorage empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('one level button exists per level', async ({ page }) => {
            const levels = await page.evaluate(() => LEVELS.length);
            await expect(page.locator('.level-btn')).toHaveCount(levels);
        });
    });

    // ---------------------------------------------------------------------
    // Puzzle definitions
    // ---------------------------------------------------------------------
    test.describe('puzzle definitions', () => {
        test('every level has distinct endpoints within bounds', async ({ page }) => {
            const ok = await page.evaluate(() => {
                return LEVELS.every((lv) => {
                    const seen = new Set();
                    for (const e of lv.ends) {
                        for (const p of [e.a, e.b]) {
                            const [r, c] = p;
                            if (r < 0 || c < 0 || r >= lv.size || c >= lv.size) return false;
                            const key = r + ',' + c;
                            if (seen.has(key)) return false;
                            seen.add(key);
                        }
                    }
                    return true;
                });
            });
            expect(ok).toBe(true);
        });

        test('endpoint colours are 0..n-1', async ({ page }) => {
            const ok = await page.evaluate(() =>
                LEVELS.every((lv) => lv.ends.every((e, i) => e.color === i))
            );
            expect(ok).toBe(true);
        });
    });

    // ---------------------------------------------------------------------
    // Starting the game
    // ---------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Start button dismisses overlay and sets running', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('a fresh level has both endpoints of each colour filled', async ({ page }) => {
            await page.locator('#btn-start').click();
            const res = await page.evaluate(() => ({
                filled: filledCount(),
                colors: LEVELS[level].ends.length,
            }));
            expect(res.filled).toBe(res.colors * 2);
        });

        test('a fresh level has zero moves and no connected flows', async ({ page }) => {
            await page.locator('#btn-start').click();
            const res = await page.evaluate(() => ({ moves, connected: connectedCount() }));
            expect(res).toEqual({ moves: 0, connected: 0 });
        });

        test('SIZE matches the started level', async ({ page }) => {
            await page.locator('#btn-start').click();
            const size = await page.evaluate(() => SIZE);
            expect(size).toBe(5);
        });
    });

    // ---------------------------------------------------------------------
    // Path building
    // ---------------------------------------------------------------------
    test.describe('path building', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame(0));
        });

        test('beginPath at an endpoint starts a one-cell pipe', async ({ page }) => {
            const res = await page.evaluate(() => {
                beginPath(0, 0);
                return { len: paths[0].length, color: cellColor[0][0] };
            });
            expect(res).toEqual({ len: 1, color: 0 });
        });

        test('extendPath adds an adjacent cell', async ({ page }) => {
            const len = await page.evaluate(() => {
                beginPath(0, 0);
                extendPath(0, 1);
                return paths[0].length;
            });
            expect(len).toBe(2);
        });

        test('extendPath ignores a non-adjacent cell', async ({ page }) => {
            const len = await page.evaluate(() => {
                beginPath(0, 0);
                extendPath(2, 2);
                return paths[0].length;
            });
            expect(len).toBe(1);
        });

        test('dragging back onto the previous cell shortens the pipe', async ({ page }) => {
            const res = await page.evaluate(() => {
                beginPath(0, 0);
                extendPath(0, 1);
                extendPath(0, 2);
                extendPath(0, 1); // backtrack
                return { len: paths[0].length, cleared: cellColor[0][2] };
            });
            expect(res).toEqual({ len: 2, cleared: -1 });
        });

        test('a pipe cannot pass through another colour endpoint', async ({ page }) => {
            // color 0 at (0,0); (1,0) is color 1's endpoint.
            const len = await page.evaluate(() => {
                beginPath(0, 0);
                extendPath(1, 0); // (1,0) is an endpoint of a different colour
                return paths[0].length;
            });
            expect(len).toBe(1);
        });

        test('a pipe cannot loop back onto its own body', async ({ page }) => {
            const len = await page.evaluate(() => {
                beginPath(0, 0);
                extendPath(0, 1);
                extendPath(0, 2);
                extendPath(0, 1); // this is backtrack, allowed
                extendPath(0, 0); // trying to re-enter its own tail -> backtrack again
                return paths[0].length;
            });
            expect(len).toBe(1);
        });

        test('crossing another colour truncates that colour', async ({ page }) => {
            const res = await page.evaluate(() => {
                // build color 1 across row 1
                beginPath(1, 0);
                extendPath(1, 1);
                extendPath(1, 2);
                endDrag();
                // color 2 comes up into (1,1)
                beginPath(2, 0);
                extendPath(2, 1);
                extendPath(1, 1); // overwrites color 1's (1,1)
                endDrag();
                return {
                    color1Len: paths[1].length,
                    at11: cellColor[1][1],
                    at12: cellColor[1][2],
                };
            });
            expect(res.at11).toBe(2);   // now owned by color 2
            expect(res.at12).toBe(-1);  // color 1 tail erased
            expect(res.color1Len).toBe(1);
        });
    });

    // ---------------------------------------------------------------------
    // Connection detection
    // ---------------------------------------------------------------------
    test.describe('connection detection', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame(0));
        });

        test('a colour is not connected before its pipe reaches the far endpoint', async ({ page }) => {
            const c = await page.evaluate(() => {
                beginPath(1, 0);
                extendPath(1, 1);
                return isConnected(1);
            });
            expect(c).toBe(false);
        });

        test('reaching the far endpoint connects the colour', async ({ page }) => {
            const c = await page.evaluate(() => {
                beginPath(1, 0);
                extendPath(1, 1);
                extendPath(1, 2);
                extendPath(1, 3); // (1,3) is the other endpoint of color 1
                return isConnected(1);
            });
            expect(c).toBe(true);
        });

        test('connectedCount reflects completed flows', async ({ page }) => {
            const n = await page.evaluate(() => {
                beginPath(1, 0); extendPath(1, 1); extendPath(1, 2); extendPath(1, 3); endDrag();
                beginPath(2, 0); extendPath(2, 1); extendPath(2, 2); extendPath(2, 3); endDrag();
                return connectedCount();
            });
            expect(n).toBe(2);
        });
    });

    // ---------------------------------------------------------------------
    // Solving / winning
    // ---------------------------------------------------------------------
    test.describe('solving', () => {
        test('the known solution fills the whole board', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await solve(page, LEVEL0_SOLUTION);
            const res = await page.evaluate(() => ({ filled: filledCount(), total: SIZE * SIZE }));
            expect(res.filled).toBe(res.total);
        });

        test('the known solution connects every colour', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await solve(page, LEVEL0_SOLUTION);
            const res = await page.evaluate(() => ({
                connected: connectedCount(),
                total: LEVELS[0].ends.length,
            }));
            expect(res.connected).toBe(res.total);
        });

        test('solving sets isSolved and state to won', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await solve(page, LEVEL0_SOLUTION);
            const res = await page.evaluate(() => ({ solved: isSolved(), state }));
            expect(res).toEqual({ solved: true, state: 'won' });
        });

        test('win overlay is shown with a solved message', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await solve(page, LEVEL0_SOLUTION);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Solved');
        });

        test('a partially connected board is not solved', async ({ page }) => {
            await page.evaluate(() => {
                startGame(0);
                beginPath(1, 0); extendPath(1, 1); extendPath(1, 2); extendPath(1, 3); endDrag();
            });
            const solved = await page.evaluate(() => isSolved());
            expect(solved).toBe(false);
        });

        test('best score is stored after a win', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await solve(page, LEVEL0_SOLUTION);
            const stored = await page.evaluate(() => localStorage.getItem('flow-best-0'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(1);
        });

        test('best display updates after a win', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await solve(page, LEVEL0_SOLUTION);
            await expect(page.locator('#best')).not.toHaveText('—');
        });
    });

    // ---------------------------------------------------------------------
    // Mouse interaction
    // ---------------------------------------------------------------------
    test.describe('mouse interaction', () => {
        test('dragging with the mouse builds and connects a flow', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            const box = await page.locator('#canvas').boundingBox();
            const cell = await page.evaluate(() => 560 / SIZE);
            const center = (r, c) => ({
                x: box.x + (c + 0.5) * cell,
                y: box.y + (r + 0.5) * cell,
            });
            const pipe = [[1, 0], [1, 1], [1, 2], [1, 3]];
            const start = center(pipe[0][0], pipe[0][1]);
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            for (let i = 1; i < pipe.length; i++) {
                const p = center(pipe[i][0], pipe[i][1]);
                await page.mouse.move(p.x, p.y, { steps: 4 });
            }
            await page.mouse.up();
            const connected = await page.evaluate(() => isConnected(1));
            expect(connected).toBe(true);
        });
    });

    // ---------------------------------------------------------------------
    // Restart / navigation
    // ---------------------------------------------------------------------
    test.describe('restart and navigation', () => {
        test('R restarts the current level and clears pipes', async ({ page }) => {
            await page.evaluate(() => {
                startGame(0);
                beginPath(1, 0); extendPath(1, 1); endDrag();
            });
            await page.keyboard.press('r');
            const res = await page.evaluate(() => ({ moves, len: paths[1].length, state }));
            expect(res).toEqual({ moves: 0, len: 0, state: 'running' });
        });

        test('N advances to the next level', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await page.keyboard.press('n');
            const lv = await page.evaluate(() => level);
            expect(lv).toBe(1);
        });

        test('clicking a level button loads that level', async ({ page }) => {
            await page.locator('.level-btn[data-level="1"]').click();
            const res = await page.evaluate(() => ({ level, size: SIZE, expected: LEVELS[1].size }));
            expect(res.level).toBe(1);
            expect(res.size).toBe(res.expected);
        });
    });
});
