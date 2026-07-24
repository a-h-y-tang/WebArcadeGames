const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Clear any stored best scores so tests start from a clean slate.
async function clearStorage(page) {
    await page.addInitScript(() => {
        try {
            for (const n of [6, 9, 12]) localStorage.removeItem(`untangle-best-${n}`);
        } catch (e) {}
    });
}

// Place every node on a clean circle in index order. Because puzzles are
// generated from a triangulation of points in convex (circular) position,
// index-order circle positions are always a crossing-free solution.
function solveLayoutInPage() {
    const n = nodes.length;
    const cx = 250, cy = 250, R = 200;
    for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n - Math.PI / 2;
        moveNode(i, cx + R * Math.cos(a), cy + R * Math.sin(a));
    }
}

test.describe('Untangle', () => {
    test.beforeEach(async ({ page }) => {
        await clearStorage(page);
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
            await expect(page.locator('#overlay-sub')).toContainText(/drag|cross/i);
        });

        test('canvas is 500x500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('best shows em dash when localStorage empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('default difficulty is medium with 9 nodes', async ({ page }) => {
            const info = await page.evaluate(() => ({ d: difficulty, n: nodeCount, len: nodes.length }));
            expect(info.d).toBe('medium');
            expect(info.n).toBe(9);
            expect(info.len).toBe(9);
        });

        test('a triangulation has 2n-3 edges', async ({ page }) => {
            const info = await page.evaluate(() => ({ e: edges.length, n: nodes.length }));
            expect(info.e).toBe(2 * info.n - 3);
        });

        test('every node has x,y within the canvas', async ({ page }) => {
            const ok = await page.evaluate(() =>
                nodes.every(p => p.x >= 0 && p.x <= 500 && p.y >= 0 && p.y <= 500)
            );
            expect(ok).toBe(true);
        });
    });

    // ---------------------------------------------------------------------
    // Graph validity
    // ---------------------------------------------------------------------
    test.describe('graph validity', () => {
        test('edges reference valid, distinct nodes', async ({ page }) => {
            const ok = await page.evaluate(() =>
                edges.every(([a, b]) =>
                    Number.isInteger(a) && Number.isInteger(b) &&
                    a >= 0 && b >= 0 && a < nodes.length && b < nodes.length && a !== b)
            );
            expect(ok).toBe(true);
        });

        test('there are no duplicate edges', async ({ page }) => {
            const dupes = await page.evaluate(() => {
                const seen = new Set();
                for (const [a, b] of edges) {
                    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
                    if (seen.has(key)) return true;
                    seen.add(key);
                }
                return false;
            });
            expect(dupes).toBe(false);
        });

        test('the graph is connected', async ({ page }) => {
            const connected = await page.evaluate(() => {
                const adj = nodes.map(() => []);
                for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
                const seen = new Set([0]);
                const stack = [0];
                while (stack.length) {
                    const v = stack.pop();
                    for (const w of adj[v]) if (!seen.has(w)) { seen.add(w); stack.push(w); }
                }
                return seen.size === nodes.length;
            });
            expect(connected).toBe(true);
        });

        test('every puzzle has a crossing-free solution (solvable)', async ({ page }) => {
            const res = await page.evaluate((solve) => {
                startGame(4242);
                eval('(' + solve + ')()');
                return { crossings: countCrossings(), solved: isSolved() };
            }, solveLayoutInPage.toString());
            expect(res.crossings).toBe(0);
            expect(res.solved).toBe(true);
        });
    });

    // ---------------------------------------------------------------------
    // Determinism
    // ---------------------------------------------------------------------
    test.describe('determinism', () => {
        test('same seed produces identical puzzles', async ({ page }) => {
            const a = await page.evaluate(() => { startGame(777); return JSON.stringify({ nodes, edges }); });
            const b = await page.evaluate(() => { startGame(777); return JSON.stringify({ nodes, edges }); });
            expect(a).toBe(b);
        });

        test('different seeds usually differ', async ({ page }) => {
            const a = await page.evaluate(() => { startGame(1); return JSON.stringify(nodes); });
            const b = await page.evaluate(() => { startGame(2); return JSON.stringify(nodes); });
            expect(a).not.toBe(b);
        });
    });

    // ---------------------------------------------------------------------
    // Segment intersection geometry
    // ---------------------------------------------------------------------
    test.describe('segmentsIntersect', () => {
        test('a clear X-crossing intersects', async ({ page }) => {
            const r = await page.evaluate(() =>
                segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }));
            expect(r).toBe(true);
        });

        test('parallel non-touching segments do not intersect', async ({ page }) => {
            const r = await page.evaluate(() =>
                segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }));
            expect(r).toBe(false);
        });

        test('disjoint far-apart segments do not intersect', async ({ page }) => {
            const r = await page.evaluate(() =>
                segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 50, y: 50 }, { x: 60, y: 40 }));
            expect(r).toBe(false);
        });

        test('segments that merely share an endpoint do NOT count as crossing', async ({ page }) => {
            const r = await page.evaluate(() =>
                segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }));
            expect(r).toBe(false);
        });

        test('an endpoint lying on another segment does not count (proper only)', async ({ page }) => {
            const r = await page.evaluate(() =>
                segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }));
            expect(r).toBe(false);
        });
    });

    // ---------------------------------------------------------------------
    // countCrossings on controlled graphs
    // ---------------------------------------------------------------------
    test.describe('countCrossings', () => {
        test('two crossing edges yield exactly one crossing', async ({ page }) => {
            const c = await page.evaluate(() => {
                nodes = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }];
                edges = [[0, 1], [2, 3]];
                return countCrossings();
            });
            expect(c).toBe(1);
        });

        test('two non-crossing edges yield zero crossings', async ({ page }) => {
            const c = await page.evaluate(() => {
                nodes = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 20 }, { x: 10, y: 20 }];
                edges = [[0, 1], [2, 3]];
                return countCrossings();
            });
            expect(c).toBe(0);
        });

        test('edges sharing a node never cross each other', async ({ page }) => {
            const c = await page.evaluate(() => {
                nodes = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }];
                edges = [[0, 1], [0, 2], [1, 2]];
                return countCrossings();
            });
            expect(c).toBe(0);
        });

        test('isSolved is true exactly when there are no crossings', async ({ page }) => {
            const res = await page.evaluate(() => {
                nodes = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }];
                edges = [[0, 1], [2, 3]];
                const tangled = isSolved();
                edges = [[0, 3], [2, 1]];
                const untangled = isSolved();
                return { tangled, untangled };
            });
            expect(res.tangled).toBe(false);
            expect(res.untangled).toBe(true);
        });
    });

    // ---------------------------------------------------------------------
    // Starting the game
    // ---------------------------------------------------------------------
    test.describe('starting', () => {
        test('Start button dismisses overlay and sets running with 0 moves', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const info = await page.evaluate(() => ({ s: state, m: moves }));
            expect(info.s).toBe('running');
            expect(info.m).toBe(0);
        });

        test('crossings counter reflects the current tangle', async ({ page }) => {
            await page.evaluate(() => startGame(9));
            const shown = await page.locator('#crossings').textContent();
            const actual = await page.evaluate(() => countCrossings());
            expect(parseInt(shown, 10)).toBe(actual);
        });
    });

    // ---------------------------------------------------------------------
    // Hit testing & node movement
    // ---------------------------------------------------------------------
    test.describe('nodeAt & moveNode', () => {
        test('nodeAt finds a node at its own center', async ({ page }) => {
            const i = await page.evaluate(() => { startGame(3); return nodeAt(nodes[2].x, nodes[2].y); });
            expect(i).toBe(2);
        });

        test('nodeAt returns -1 on empty space', async ({ page }) => {
            const i = await page.evaluate(() => {
                startGame(3);
                // A far corner is extremely unlikely to host a node; assert none within radius.
                return nodeAt(-100, -100);
            });
            expect(i).toBe(-1);
        });

        test('moveNode repositions a node', async ({ page }) => {
            const pos = await page.evaluate(() => {
                startGame(3);
                moveNode(1, 123, 234);
                return nodes[1];
            });
            expect(pos.x).toBeCloseTo(123, 5);
            expect(pos.y).toBeCloseTo(234, 5);
        });

        test('moveNode clamps within the canvas', async ({ page }) => {
            const pos = await page.evaluate(() => {
                startGame(3);
                moveNode(0, -500, 9999);
                return nodes[0];
            });
            expect(pos.x).toBeGreaterThanOrEqual(0);
            expect(pos.x).toBeLessThanOrEqual(500);
            expect(pos.y).toBeGreaterThanOrEqual(0);
            expect(pos.y).toBeLessThanOrEqual(500);
        });
    });

    // ---------------------------------------------------------------------
    // Dragging (integration via real mouse events)
    // ---------------------------------------------------------------------
    test.describe('dragging', () => {
        test('dragging a node counts one move', async ({ page }) => {
            await page.evaluate(() => startGame(3));
            const box = await page.locator('#canvas').boundingBox();
            const start = await page.evaluate(() => ({ x: nodes[0].x, y: nodes[0].y }));
            await page.mouse.move(box.x + start.x, box.y + start.y);
            await page.mouse.down();
            await page.mouse.move(box.x + 40, box.y + 40, { steps: 8 });
            await page.mouse.up();
            const moves = await page.evaluate(() => window.moves);
            expect(moves).toBe(1);
        });

        test('a click without movement is not a move', async ({ page }) => {
            await page.evaluate(() => startGame(3));
            const box = await page.locator('#canvas').boundingBox();
            const start = await page.evaluate(() => ({ x: nodes[0].x, y: nodes[0].y }));
            await page.mouse.move(box.x + start.x, box.y + start.y);
            await page.mouse.down();
            await page.mouse.up();
            const moves = await page.evaluate(() => window.moves);
            expect(moves).toBe(0);
        });
    });

    // ---------------------------------------------------------------------
    // Winning
    // ---------------------------------------------------------------------
    test.describe('winning', () => {
        test('reaching zero crossings wins the game', async ({ page }) => {
            const s = await page.evaluate((solve) => {
                startGame(4242);
                eval('(' + solve + ')()');
                return state;
            }, solveLayoutInPage.toString());
            expect(s).toBe('won');
        });

        test('win overlay is shown with a win message', async ({ page }) => {
            await page.evaluate((solve) => {
                startGame(4242);
                eval('(' + solve + ')()');
            }, solveLayoutInPage.toString());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/solved|win|untangled/i);
        });

        test('a best score is stored after winning', async ({ page }) => {
            await page.evaluate((solve) => {
                startGame(4242);
                eval('(' + solve + ')()');
            }, solveLayoutInPage.toString());
            const stored = await page.evaluate(() => localStorage.getItem('untangle-best-9'));
            expect(stored).not.toBeNull();
            expect(Number.isNaN(parseInt(stored, 10))).toBe(false);
        });

        test('no further moves are counted once solved', async ({ page }) => {
            const res = await page.evaluate((solve) => {
                startGame(4242);
                eval('(' + solve + ')()');
                const before = moves;
                moveNode(0, 10, 10);   // fiddling after a win must not re-open play
                return { state, changed: moves !== before };
            }, solveLayoutInPage.toString());
            expect(res.state).toBe('won');
            expect(res.changed).toBe(false);
        });
    });

    // ---------------------------------------------------------------------
    // Restart & difficulty
    // ---------------------------------------------------------------------
    test.describe('restart & difficulty', () => {
        test('N key starts a fresh running puzzle', async ({ page }) => {
            await page.evaluate(() => startGame(3));
            await page.keyboard.press('n');
            const info = await page.evaluate(() => ({ s: state, m: moves }));
            expect(info.s).toBe('running');
            expect(info.m).toBe(0);
        });

        test('New Puzzle button restarts', async ({ page }) => {
            await page.evaluate(() => startGame(3));
            await page.locator('#btn-new').click();
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('setDifficulty(hard) yields 12 nodes and 21 edges', async ({ page }) => {
            const info = await page.evaluate(() => {
                setDifficulty('hard');
                return { d: difficulty, n: nodeCount, nl: nodes.length, e: edges.length, s: state };
            });
            expect(info.d).toBe('hard');
            expect(info.n).toBe(12);
            expect(info.nl).toBe(12);
            expect(info.e).toBe(21);
            expect(info.s).toBe('running');
        });

        test('setDifficulty(easy) yields 6 nodes', async ({ page }) => {
            const n = await page.evaluate(() => { setDifficulty('easy'); return nodes.length; });
            expect(n).toBe(6);
        });

        test('difficulty buttons exist for easy/medium/hard', async ({ page }) => {
            await expect(page.locator('.diff[data-diff="easy"]')).toHaveCount(1);
            await expect(page.locator('.diff[data-diff="medium"]')).toHaveCount(1);
            await expect(page.locator('.diff[data-diff="hard"]')).toHaveCount(1);
        });

        test('best is stored per difficulty', async ({ page }) => {
            await page.evaluate((solve) => {
                setDifficulty('easy');
                startGame(555);
                eval('(' + solve + ')()');
            }, solveLayoutInPage.toString());
            const easyBest = await page.evaluate(() => localStorage.getItem('untangle-best-6'));
            const medBest = await page.evaluate(() => localStorage.getItem('untangle-best-9'));
            expect(easyBest).not.toBeNull();
            expect(medBest).toBeNull();
        });
    });
});
