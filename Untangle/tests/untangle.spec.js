const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Load a fully-known graph so geometry assertions are exact. `nodes` is an
// array of {x, y}; `edges` is an array of [i, j] index pairs.
async function loadGraph(page, nodes, edges) {
    await page.evaluate(
        ({ nodes, edges }) => window.loadCustomGraph(nodes, edges),
        { nodes, edges }
    );
}

async function crossings(page) {
    return page.evaluate(() => window.countCrossings());
}

// A unit square's four corners, indices 0..3:
//   0=(0,0)  1=(200,0)  2=(200,200)  3=(0,200)
const SQUARE = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 200 },
    { x: 0, y: 200 },
];

test.describe('Untangle', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // ---------------------------------------------------------------------
    // Initial state
    // ---------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Untangle', async ({ page }) => {
            await expect(page).toHaveTitle('Untangle');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/cross/i);
        });

        test('canvas exists with fixed pixel size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', /\d+/);
            await expect(canvas).toHaveAttribute('height', /\d+/);
        });

        test('crossings counter is present', async ({ page }) => {
            await expect(page.locator('#crossings')).toBeVisible();
        });

        test('level indicator starts at level 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('exposes the game API on window', async ({ page }) => {
            const api = await page.evaluate(() => ({
                moveNode: typeof window.moveNode,
                pickNode: typeof window.pickNode,
                countCrossings: typeof window.countCrossings,
                isSolved: typeof window.isSolved,
                loadCustomGraph: typeof window.loadCustomGraph,
                loadLevel: typeof window.loadLevel,
                reset: typeof window.reset,
                segmentsIntersect: typeof window.segmentsIntersect,
            }));
            expect(api).toEqual({
                moveNode: 'function',
                pickNode: 'function',
                countCrossings: 'function',
                isSolved: 'function',
                loadCustomGraph: 'function',
                loadLevel: 'function',
                reset: 'function',
                segmentsIntersect: 'function',
            });
        });
    });

    // ---------------------------------------------------------------------
    // Starting the game
    // ---------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state is running after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => window.state)).toBe('running');
        });
    });

    // ---------------------------------------------------------------------
    // Segment intersection primitive
    // ---------------------------------------------------------------------
    test.describe('segmentsIntersect', () => {
        test('detects two crossing segments', async ({ page }) => {
            const hit = await page.evaluate(() =>
                window.segmentsIntersect(
                    { x: 0, y: 0 }, { x: 10, y: 10 },
                    { x: 0, y: 10 }, { x: 10, y: 0 }
                )
            );
            expect(hit).toBe(true);
        });

        test('reports no intersection for disjoint segments', async ({ page }) => {
            const hit = await page.evaluate(() =>
                window.segmentsIntersect(
                    { x: 0, y: 0 }, { x: 10, y: 0 },
                    { x: 0, y: 5 }, { x: 10, y: 5 }
                )
            );
            expect(hit).toBe(false);
        });
    });

    // ---------------------------------------------------------------------
    // Crossing count
    // ---------------------------------------------------------------------
    test.describe('countCrossings', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('the two diagonals of a square cross once', async ({ page }) => {
            await loadGraph(page, SQUARE, [[0, 2], [1, 3]]);
            expect(await crossings(page)).toBe(1);
        });

        test('opposite sides of a square do not cross', async ({ page }) => {
            await loadGraph(page, SQUARE, [[0, 1], [2, 3]]);
            expect(await crossings(page)).toBe(0);
        });

        test('edges sharing a node are not counted as crossing', async ({ page }) => {
            // Two edges meeting at node 1 — adjacency, never a crossing.
            await loadGraph(page, SQUARE, [[0, 1], [1, 2]]);
            expect(await crossings(page)).toBe(0);
        });

        test('a tangled graph reports its exact crossing count', async ({ page }) => {
            // Both diagonals plus one side: diagonals cross each other (1); the
            // side [0,1] shares a node with each diagonal, so no extra crossings.
            await loadGraph(page, SQUARE, [[0, 2], [1, 3], [0, 1]]);
            expect(await crossings(page)).toBe(1);
        });
    });

    // ---------------------------------------------------------------------
    // Solving by moving nodes
    // ---------------------------------------------------------------------
    test.describe('moving nodes and solving', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('a graph with no crossings is already solved', async ({ page }) => {
            await loadGraph(page, SQUARE, [[0, 1], [2, 3]]);
            expect(await page.evaluate(() => window.isSolved())).toBe(true);
        });

        test('a graph with a crossing is not solved', async ({ page }) => {
            await loadGraph(page, SQUARE, [[0, 2], [1, 3]]);
            expect(await page.evaluate(() => window.isSolved())).toBe(false);
        });

        test('moving a node to remove the crossing solves the puzzle', async ({ page }) => {
            await loadGraph(page, SQUARE, [[0, 2], [1, 3]]);
            expect(await crossings(page)).toBe(1);
            // Drag node 3 far to the right so edge 1-3 no longer meets edge 0-2.
            await page.evaluate(() => window.moveNode(3, 400, 0));
            expect(await crossings(page)).toBe(0);
            expect(await page.evaluate(() => window.isSolved())).toBe(true);
        });

        test('moveNode clamps positions inside the canvas', async ({ page }) => {
            await loadGraph(page, SQUARE, [[0, 1]]);
            await page.evaluate(() => window.moveNode(0, -500, 99999));
            const n = await page.evaluate(() => window.nodes[0]);
            const size = await page.evaluate(() => ({
                w: document.getElementById('canvas').width,
                h: document.getElementById('canvas').height,
            }));
            expect(n.x).toBeGreaterThanOrEqual(0);
            expect(n.y).toBeGreaterThanOrEqual(0);
            expect(n.x).toBeLessThanOrEqual(size.w);
            expect(n.y).toBeLessThanOrEqual(size.h);
        });
    });

    // ---------------------------------------------------------------------
    // pickNode
    // ---------------------------------------------------------------------
    test.describe('pickNode', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('returns the index of a nearby node', async ({ page }) => {
            await loadGraph(page, SQUARE, [[0, 1]]);
            const i = await page.evaluate(() => window.pickNode(202, 3));
            expect(i).toBe(1); // nearest to (200,0)
        });

        test('returns -1 when the point is far from every node', async ({ page }) => {
            await loadGraph(page, SQUARE, [[0, 1]]);
            const i = await page.evaluate(() => window.pickNode(100, 100));
            expect(i).toBe(-1);
        });
    });

    // ---------------------------------------------------------------------
    // Winning
    // ---------------------------------------------------------------------
    test.describe('winning', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('solving updates state to won', async ({ page }) => {
            await loadGraph(page, SQUARE, [[0, 2], [1, 3]]);
            await page.evaluate(() => window.moveNode(3, 400, 0));
            expect(await page.evaluate(() => window.state)).toBe('won');
        });

        test('solving shows the win overlay', async ({ page }) => {
            await loadGraph(page, SQUARE, [[0, 2], [1, 3]]);
            await page.evaluate(() => window.moveNode(3, 400, 0));
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/solved|untangl|clear/i);
        });

        test('the crossings HUD reaches zero on solving', async ({ page }) => {
            await loadGraph(page, SQUARE, [[0, 2], [1, 3]]);
            await page.evaluate(() => window.moveNode(3, 400, 0));
            await expect(page.locator('#crossings')).toHaveText('0');
        });
    });

    // ---------------------------------------------------------------------
    // Reset
    // ---------------------------------------------------------------------
    test.describe('reset', () => {
        test('reset restores the level to its starting positions', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => window.loadLevel(0));
            const before = await page.evaluate(() => JSON.stringify(window.nodes));
            await page.evaluate(() => window.moveNode(0, 5, 5));
            const moved = await page.evaluate(() => JSON.stringify(window.nodes));
            expect(moved).not.toBe(before);
            await page.evaluate(() => window.reset());
            const after = await page.evaluate(() => JSON.stringify(window.nodes));
            expect(after).toBe(before);
        });
    });

    // ---------------------------------------------------------------------
    // Bundled levels
    // ---------------------------------------------------------------------
    test.describe('bundled levels', () => {
        test('there are at least three levels', async ({ page }) => {
            const n = await page.evaluate(() => window.LEVELS.length);
            expect(n).toBeGreaterThanOrEqual(3);
        });

        test('every bundled level starts tangled but is solvable', async ({ page }) => {
            await page.locator('#btn-start').click();
            const report = await page.evaluate(() => {
                const out = [];
                for (let i = 0; i < window.LEVELS.length; i++) {
                    window.loadLevel(i);
                    out.push({
                        nodes: window.nodes.length,
                        edges: window.edges.length,
                        startCrossings: window.countCrossings(),
                        // Crossings if every node sat at its known solution
                        // position — must be zero (proves the level is planar).
                        solutionCrossings: window.solutionCrossings(),
                    });
                }
                return out;
            });
            expect(report.length).toBeGreaterThanOrEqual(3);
            for (const lvl of report) {
                expect(lvl.nodes).toBeGreaterThanOrEqual(4);
                expect(lvl.edges).toBeGreaterThanOrEqual(lvl.nodes - 1);
                expect(lvl.startCrossings).toBeGreaterThan(0);
                expect(lvl.solutionCrossings).toBe(0);
            }
        });

        test('later levels have at least as many nodes as earlier ones', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const c = [];
                for (let i = 0; i < window.LEVELS.length; i++) {
                    window.loadLevel(i);
                    c.push(window.nodes.length);
                }
                return c;
            });
            for (let i = 1; i < counts.length; i++) {
                expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
            }
        });
    });
});
