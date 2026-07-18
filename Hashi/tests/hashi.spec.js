const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Level 0 is the 4-island corner loop. Its unique solution is a single bridge
// around the perimeter: 0-1, 1-2, 2-3, 3-0.
const LEVEL0_SOLUTION = [[0, 1], [1, 2], [2, 3], [3, 0]];

async function solveLevel0(page) {
    await page.evaluate((sol) => {
        for (const [i, j] of sol) toggleBridge(i, j);
    }, LEVEL0_SOLUTION);
}

test.describe('Hashi', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                for (let i = 0; i < 10; i++) localStorage.removeItem('hashi-best-' + i);
            } catch (e) {}
        });
        await page.goto(GAME_URL);
    });

    // ---------------------------------------------------------------------
    // Initial state
    // ---------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Hashi', async ({ page }) => {
            await expect(page).toHaveTitle(/Hashi/);
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
        test('every island is within its grid and has a positive requirement', async ({ page }) => {
            const ok = await page.evaluate(() =>
                LEVELS.every((lv) =>
                    lv.islands.every(
                        (isl) =>
                            isl.r >= 0 && isl.c >= 0 && isl.r < lv.grid && isl.c < lv.grid &&
                            isl.req >= 1 && isl.req <= 8
                    )
                )
            );
            expect(ok).toBe(true);
        });

        test('no two islands share a cell in any level', async ({ page }) => {
            const ok = await page.evaluate(() =>
                LEVELS.every((lv) => {
                    const seen = new Set();
                    for (const isl of lv.islands) {
                        const key = isl.r + ',' + isl.c;
                        if (seen.has(key)) return false;
                        seen.add(key);
                    }
                    return true;
                })
            );
            expect(ok).toBe(true);
        });

        test('each level is solvable: its stored solution satisfies every island and connects all', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let lv = 0; lv < LEVELS.length; lv++) {
                    startGame(lv);
                    for (const [i, j, count] of LEVELS[lv].solution) {
                        // apply `count` toggles to reach the desired bridge count
                        for (let t = 0; t < count; t++) toggleBridge(i, j);
                    }
                    if (!isSolved()) return false;
                }
                return true;
            });
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

        test('a fresh level has zero moves and no satisfied islands', async ({ page }) => {
            await page.locator('#btn-start').click();
            const res = await page.evaluate(() => ({ moves, satisfied: satisfiedCount() }));
            expect(res).toEqual({ moves: 0, satisfied: 0 });
        });

        test('GRID matches the started level', async ({ page }) => {
            await page.locator('#btn-start').click();
            const res = await page.evaluate(() => ({ grid: GRID, expected: LEVELS[0].grid }));
            expect(res.grid).toBe(res.expected);
        });
    });

    // ---------------------------------------------------------------------
    // Neighbours
    // ---------------------------------------------------------------------
    test.describe('neighbours', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame(0));
        });

        test('corner islands each have exactly two neighbours', async ({ page }) => {
            const counts = await page.evaluate(() =>
                islands.map((_, i) => neighborsOf(i).length)
            );
            expect(counts).toEqual([2, 2, 2, 2]);
        });

        test('neighbour relation is symmetric', async ({ page }) => {
            const ok = await page.evaluate(() =>
                islands.every((_, i) => neighborsOf(i).every((j) => neighborsOf(j).includes(i)))
            );
            expect(ok).toBe(true);
        });
    });

    // ---------------------------------------------------------------------
    // Bridge toggling
    // ---------------------------------------------------------------------
    test.describe('bridge toggling', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame(0));
        });

        test('toggling a neighbour pair cycles 0 -> 1 -> 2 -> 0', async ({ page }) => {
            const seq = await page.evaluate(() => {
                const out = [bridgeCount(0, 1)];
                toggleBridge(0, 1); out.push(bridgeCount(0, 1));
                toggleBridge(0, 1); out.push(bridgeCount(0, 1));
                toggleBridge(0, 1); out.push(bridgeCount(0, 1));
                return out;
            });
            expect(seq).toEqual([0, 1, 2, 0]);
        });

        test('bridge count is symmetric regardless of argument order', async ({ page }) => {
            const eq = await page.evaluate(() => {
                toggleBridge(0, 1);
                return bridgeCount(1, 0) === bridgeCount(0, 1) && bridgeCount(0, 1) === 1;
            });
            expect(eq).toBe(true);
        });

        test('toggling non-neighbours is ignored', async ({ page }) => {
            const res = await page.evaluate(() => {
                // 0 (0,0) and 2 (4,4) are diagonal — not neighbours
                const before = bridgeCount(0, 2);
                toggleBridge(0, 2);
                return { before, after: bridgeCount(0, 2), neighbour: neighborsOf(0).includes(2) };
            });
            expect(res).toEqual({ before: 0, after: 0, neighbour: false });
        });

        test('island degree reflects attached bridges', async ({ page }) => {
            const deg = await page.evaluate(() => {
                toggleBridge(0, 1); // 1
                toggleBridge(0, 3); // 1
                return islandDegree(0);
            });
            expect(deg).toBe(2);
        });

        test('an island is satisfied when its degree equals its requirement', async ({ page }) => {
            const res = await page.evaluate(() => {
                toggleBridge(0, 1);
                const half = isSatisfied(0);
                toggleBridge(0, 3);
                const full = isSatisfied(0);
                return { half, full };
            });
            expect(res).toEqual({ half: false, full: true });
        });

        test('a successful toggle counts as one move; a rejected one does not', async ({ page }) => {
            const res = await page.evaluate(() => {
                const m0 = moves;
                toggleBridge(0, 1);      // valid -> +1
                const m1 = moves;
                toggleBridge(0, 2);      // invalid (not neighbours) -> no move
                const m2 = moves;
                return { m0, m1, m2 };
            });
            expect(res).toEqual({ m0: 0, m1: 1, m2: 1 });
        });
    });

    // ---------------------------------------------------------------------
    // Crossing rule (level 2 has interior islands that can cross)
    // ---------------------------------------------------------------------
    test.describe('crossing rule', () => {
        test('a bridge that would cross an existing perpendicular bridge is rejected', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(2);
                // In level 2, island 3 (2,0)->4 (2,4) is horizontal through (2,2);
                // island 1 (0,2)->6 (4,2) is vertical through (2,2). They cross.
                toggleBridge(3, 4);            // place horizontal
                const placed = bridgeCount(3, 4);
                toggleBridge(1, 6);            // attempt crossing vertical
                const blocked = bridgeCount(1, 6);
                return { placed, blocked };
            });
            expect(res.placed).toBe(1);
            expect(res.blocked).toBe(0);
        });

        test('the perpendicular bridge is allowed once the crossing one is removed', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(2);
                toggleBridge(3, 4);                 // place horizontal
                toggleBridge(3, 4); toggleBridge(3, 4); // cycle 2 -> 0 (remove)
                toggleBridge(1, 6);                 // now allowed
                return bridgeCount(1, 6);
            });
            expect(res).toBe(1);
        });
    });

    // ---------------------------------------------------------------------
    // Connectivity & solving
    // ---------------------------------------------------------------------
    test.describe('solving', () => {
        test('an unconnected but fully-numbered board is not solved', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(0);
                // Give islands 0 and 1 two bridges to each other: satisfies both,
                // but leaves 2 and 3 empty and the graph disconnected.
                toggleBridge(0, 1); toggleBridge(0, 1); // 0-1 = 2
                return { connected: allConnected(), solved: isSolved() };
            });
            expect(res.connected).toBe(false);
            expect(res.solved).toBe(false);
        });

        test('the known solution connects every island', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await solveLevel0(page);
            const connected = await page.evaluate(() => allConnected());
            expect(connected).toBe(true);
        });

        test('solving sets isSolved and state to won', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await solveLevel0(page);
            const res = await page.evaluate(() => ({ solved: isSolved(), state }));
            expect(res).toEqual({ solved: true, state: 'won' });
        });

        test('every island is satisfied after solving', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await solveLevel0(page);
            const res = await page.evaluate(() => ({
                satisfied: satisfiedCount(),
                total: islands.length,
            }));
            expect(res.satisfied).toBe(res.total);
        });

        test('win overlay is shown with a solved message', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await solveLevel0(page);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Solved');
        });

        test('best score is stored after a win', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await solveLevel0(page);
            const stored = await page.evaluate(() => localStorage.getItem('hashi-best-0'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(1);
        });

        test('best display updates after a win', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await solveLevel0(page);
            await expect(page.locator('#best')).not.toHaveText('—');
        });

        test('bridges cannot be changed once solved', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(0);
                for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0]]) toggleBridge(i, j);
                const before = bridgeCount(0, 1);
                toggleBridge(0, 1); // game is won -> ignored
                return { state, before, after: bridgeCount(0, 1) };
            });
            expect(res.state).toBe('won');
            expect(res.after).toBe(res.before);
        });
    });

    // ---------------------------------------------------------------------
    // Mouse interaction
    // ---------------------------------------------------------------------
    test.describe('mouse interaction', () => {
        test('dragging from one island to a neighbour builds a bridge', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            const box = await page.locator('#canvas').boundingBox();
            const cell = await page.evaluate(() => 560 / GRID);
            const center = (r, c) => ({
                x: box.x + (c + 0.5) * cell,
                y: box.y + (r + 0.5) * cell,
            });
            const a = await page.evaluate(() => ({ r: islands[0].r, c: islands[0].c }));
            const b = await page.evaluate(() => ({ r: islands[1].r, c: islands[1].c }));
            const pa = center(a.r, a.c);
            const pb = center(b.r, b.c);
            await page.mouse.move(pa.x, pa.y);
            await page.mouse.down();
            await page.mouse.move(pb.x, pb.y, { steps: 6 });
            await page.mouse.up();
            const count = await page.evaluate(() => bridgeCount(0, 1));
            expect(count).toBe(1);
        });

        test('clicking two neighbour islands in turn builds a bridge', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            const box = await page.locator('#canvas').boundingBox();
            const cell = await page.evaluate(() => 560 / GRID);
            const center = (r, c) => ({
                x: box.x + (c + 0.5) * cell,
                y: box.y + (r + 0.5) * cell,
            });
            const a = await page.evaluate(() => ({ r: islands[0].r, c: islands[0].c }));
            const b = await page.evaluate(() => ({ r: islands[3].r, c: islands[3].c }));
            const pa = center(a.r, a.c);
            const pb = center(b.r, b.c);
            await page.mouse.click(pa.x, pa.y);
            await page.mouse.click(pb.x, pb.y);
            const count = await page.evaluate(() => bridgeCount(0, 3));
            expect(count).toBe(1);
        });
    });

    // ---------------------------------------------------------------------
    // Restart / navigation
    // ---------------------------------------------------------------------
    test.describe('restart and navigation', () => {
        test('R restarts the current level and clears bridges', async ({ page }) => {
            await page.evaluate(() => {
                startGame(0);
                toggleBridge(0, 1);
            });
            await page.keyboard.press('r');
            const res = await page.evaluate(() => ({ moves, count: bridgeCount(0, 1), state }));
            expect(res).toEqual({ moves: 0, count: 0, state: 'running' });
        });

        test('N advances to the next level', async ({ page }) => {
            await page.evaluate(() => startGame(0));
            await page.keyboard.press('n');
            const lv = await page.evaluate(() => level);
            expect(lv).toBe(1);
        });

        test('clicking a level button loads that level', async ({ page }) => {
            await page.locator('.level-btn[data-level="1"]').click();
            const res = await page.evaluate(() => ({ level, grid: GRID, expected: LEVELS[1].grid }));
            expect(res.level).toBe(1);
            expect(res.grid).toBe(res.expected);
        });
    });
});
