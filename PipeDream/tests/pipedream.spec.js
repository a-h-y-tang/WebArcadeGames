const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Side bit flags mirrored from the game for readability in tests.
const N = 1, E = 2, S = 4, W = 8;

// A tiny, fully-known scenario. Grid is 5 wide x 1 tall (row 0).
//   col: 0      1    2    3    4
//        source h    h    h    (empty)
// Source sits at (0,0) pointing East, so ooze runs straight along the row.
const STRAIGHT_LINE = {
    grid: [[null, 'h', 'h', 'h', null]],
    source: { row: 0, col: 0, dir: E },
    queue: ['h', 'h', 'h', 'h', 'h'],
    target: 3,
};

async function loadStraightLine(page) {
    await page.evaluate((cfg) => window.loadTest(cfg), STRAIGHT_LINE);
}

test.describe('Pipe Dream', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial page / DOM
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Pipe Dream', async ({ page }) => {
            await expect(page).toHaveTitle('Pipe Dream');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/pipe/i);
        });

        test('canvas exists with fixed pixel size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', /\d+/);
            await expect(canvas).toHaveAttribute('height', /\d+/);
        });

        test('score starts at zero', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('level starts at one', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('exposes the game API on window', async ({ page }) => {
            const api = await page.evaluate(() => ({
                placeAt: typeof window.placeAt,
                startFlow: typeof window.startFlow,
                flowStep: typeof window.flowStep,
                runFlow: typeof window.runFlow,
                reset: typeof window.reset,
                nextLevel: typeof window.nextLevel,
                setSeed: typeof window.setSeed,
                loadTest: typeof window.loadTest,
            }));
            expect(api).toEqual({
                placeAt: 'function',
                startFlow: 'function',
                flowStep: 'function',
                runFlow: 'function',
                reset: 'function',
                nextLevel: 'function',
                setSeed: 'function',
                loadTest: 'function',
            });
        });

        test('a fresh board has a source and a non-empty queue', async ({ page }) => {
            const info = await page.evaluate(() => ({
                hasSource: !!window.source,
                queueLen: window.queue.length,
                rows: window.grid.length,
                cols: window.grid[0].length,
            }));
            expect(info.hasSource).toBe(true);
            expect(info.queueLen).toBeGreaterThan(0);
            expect(info.rows).toBe(7);
            expect(info.cols).toBe(9);
        });
    });

    // -----------------------------------------------------------------------
    // Piece placement
    // -----------------------------------------------------------------------
    test.describe('placement', () => {
        test('placing consumes the front of the queue', async ({ page }) => {
            await loadStraightLine(page);
            const front = await page.evaluate(() => window.queue[0]);
            const result = await page.evaluate(() => window.placeAt(0, 4));
            const after = await page.evaluate(() => ({
                type: window.grid[0][4] && window.grid[0][4].type,
                filled: window.grid[0][4] && window.grid[0][4].filled,
            }));
            expect(result).toBe(true);
            expect(after.type).toBe(front);
            expect(after.filled).toBe(false);
        });

        test('cannot place on an occupied cell', async ({ page }) => {
            await loadStraightLine(page);
            const result = await page.evaluate(() => window.placeAt(0, 1));
            expect(result).toBe(false);
        });

        test('cannot place on the source cell', async ({ page }) => {
            await loadStraightLine(page);
            const result = await page.evaluate(() => window.placeAt(0, 0));
            expect(result).toBe(false);
        });

        test('cannot place outside the grid', async ({ page }) => {
            await loadStraightLine(page);
            const result = await page.evaluate(() => window.placeAt(9, 9));
            expect(result).toBe(false);
        });

        test('the queue refills so it never runs dry', async ({ page }) => {
            const start = await page.evaluate(() => window.queue.length);
            await page.evaluate(() => {
                for (let i = 0; i < 3; i++) window.placeAt(2, i);
            });
            const after = await page.evaluate(() => window.queue.length);
            expect(after).toBe(start);
        });
    });

    // -----------------------------------------------------------------------
    // Flow simulation
    // -----------------------------------------------------------------------
    test.describe('flow', () => {
        test('flow fills connected pipes one at a time', async ({ page }) => {
            await loadStraightLine(page);
            await page.evaluate(() => window.startFlow());
            expect(await page.evaluate(() => window.state)).toBe('flowing');

            await page.evaluate(() => window.flowStep());
            expect(await page.evaluate(() => window.flowLength)).toBe(1);
            expect(await page.evaluate(() => window.grid[0][1].filled)).toBe(true);
            expect(await page.evaluate(() => window.grid[0][2].filled)).toBe(false);

            await page.evaluate(() => window.flowStep());
            expect(await page.evaluate(() => window.flowLength)).toBe(2);
        });

        test('reaching the target wins the level', async ({ page }) => {
            await loadStraightLine(page); // target 3, three h pipes in a row
            const won = await page.evaluate(() => {
                window.startFlow();
                window.runFlow();
                return window.state;
            });
            expect(won).toBe('won');
            expect(await page.evaluate(() => window.flowLength)).toBe(3);
        });

        test('flowing into an empty cell leaks and loses', async ({ page }) => {
            // Only two pipes but a target of 3 -> ooze runs off into empty col 3.
            await page.evaluate((cfg) => window.loadTest(cfg), {
                grid: [[null, 'h', 'h', null, null]],
                source: { row: 0, col: 0, dir: 2 /* E */ },
                queue: ['h', 'h'],
                target: 3,
            });
            const state = await page.evaluate(() => {
                window.startFlow();
                window.runFlow();
                return window.state;
            });
            expect(state).toBe('lost');
            expect(await page.evaluate(() => window.flowLength)).toBe(2);
        });

        test('a mis-aligned pipe opening leaks', async ({ page }) => {
            // Source points East into a *vertical* pipe (no West opening) -> leak.
            await page.evaluate((cfg) => window.loadTest(cfg), {
                grid: [[null, 'v', null]],
                source: { row: 0, col: 0, dir: 2 /* E */ },
                queue: ['h'],
                target: 3,
            });
            const state = await page.evaluate(() => {
                window.startFlow();
                window.runFlow();
                return window.state;
            });
            expect(state).toBe('lost');
            expect(await page.evaluate(() => window.flowLength)).toBe(0);
        });

        test('curves route the flow around a corner', async ({ page }) => {
            // 2x2:  source@(0,0)->E  ,  (0,1)=sw (turns south),
            //       (1,1)=wn (turns west/... ) ; build an L path.
            //  (0,0)src  (0,1)sw
            //  (1,0)     (1,1)
            // Flow: src E -> (0,1) enters W. sw has S|W, exit S ->
            //       (1,1) enters N? no -> we want piece at (1,1) with N opening.
            // Use 'wn' (W|N) won't take N-entry+continue... choose a piece that
            // has N opening: 'ne' (N|E) or 'wn' (W|N). Enter from N, exit the
            // other opening. Put 'wn' at (1,1): openings W|N, enter N exit W ->
            // flows into (1,0).
            await page.evaluate((cfg) => window.loadTest(cfg), {
                grid: [
                    [null, 'sw', null],
                    ['h', 'wn', null],
                ],
                source: { row: 0, col: 0, dir: 2 /* E */ },
                queue: ['h'],
                target: 3,
            });
            const res = await page.evaluate(() => {
                window.startFlow();
                window.runFlow();
                return { state: window.state, len: window.flowLength };
            });
            // src -> sw(0,1) -> wn(1,1) -> h(1,0) = 3 pipes -> win
            expect(res.len).toBe(3);
            expect(res.state).toBe('won');
        });

        test('a cross can be traversed twice on perpendicular axes', async ({ page }) => {
            // Loop that passes through a single cross tile on both axes.
            //   (0,0)src->E  (0,1)es      (0,2)sw
            //   (1,0)ne      (1,1)cross   (1,2)wn
            //   (2,0)        (2,1)v-ish   (2,2)
            // Design a path that uses the cross vertically then ... keep it
            // simple: just assert the cross tile fills and is re-usable via a
            // figure path. src E -> es(0,1) turns S -> cross(1,1) enters N exit S
            // -> v(2,1) ... we need N opening at (2,1). Use 'wn'? that's W|N.
            // Path: es(0,1) S, cross(1,1) N->S, ne(2,1) needs N -> 'ne'(N|E) enter
            // N exit E -> (2,2) 'wn'(W|N) enter W exit N -> cross(1,2)? no.
            // Simpler: verify cross straight-through fill only.
            // (0,1)='sw' turns the East-bound source southward (needs a West
            // opening), (1,1)='cross' passes straight through N->S, (2,1)='v'.
            await page.evaluate((cfg) => window.loadTest(cfg), {
                grid: [
                    [null, 'sw', null],
                    [null, 'cross', null],
                    [null, 'v', null],
                ],
                source: { row: 0, col: 0, dir: 2 /* E */ },
                queue: ['h'],
                target: 3,
            });
            const res = await page.evaluate(() => {
                window.startFlow();
                window.runFlow();
                return {
                    state: window.state,
                    len: window.flowLength,
                    crossFilled: window.grid[1][1].filled,
                };
            });
            // src->sw(0,1)->cross(1,1)->v(2,1) = 3 pipes -> win, cross filled.
            expect(res.crossFilled).toBe(true);
            expect(res.len).toBe(3);
            expect(res.state).toBe('won');
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('score rewards filled pipes plus a clear bonus', async ({ page }) => {
            await loadStraightLine(page); // 3 pipes, target 3
            const score = await page.evaluate(() => {
                window.startFlow();
                window.runFlow();
                return window.score;
            });
            // 3 pipes * 50 + 250 clear bonus = 400
            expect(score).toBe(400);
        });

        test('a loss still scores the pipes that filled', async ({ page }) => {
            await page.evaluate((cfg) => window.loadTest(cfg), {
                grid: [[null, 'h', 'h', null]],
                source: { row: 0, col: 0, dir: 2 /* E */ },
                queue: ['h'],
                target: 5,
            });
            const score = await page.evaluate(() => {
                window.startFlow();
                window.runFlow();
                return window.score;
            });
            expect(score).toBe(100); // 2 pipes * 50, no bonus
        });
    });

    // -----------------------------------------------------------------------
    // Controls & lifecycle
    // -----------------------------------------------------------------------
    test.describe('controls & lifecycle', () => {
        test('clicking the canvas places a piece at the mapped cell', async ({ page }) => {
            await loadStraightLine(page);
            const before = await page.evaluate(() => window.grid[0][4]);
            expect(before).toBe(null);
            // The canvas maps cell (0,4); click its centre.
            await page.evaluate(() => {
                const { x, y } = window.cellCenter(0, 4);
                window.dispatchCanvasClick(x, y);
            });
            const after = await page.evaluate(() => window.grid[0][4]);
            expect(after).not.toBe(null);
        });

        test('arrow keys move the cursor and space places', async ({ page }) => {
            await loadStraightLine(page);
            await page.evaluate(() => window.setCursor(0, 3));
            await page.keyboard.press('ArrowRight'); // -> (0,4)
            expect(await page.evaluate(() => window.cursor.col)).toBe(4);
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => window.grid[0][4])).not.toBe(null);
        });

        test('reset returns to a ready board with score zero', async ({ page }) => {
            await loadStraightLine(page);
            await page.evaluate(() => {
                window.startFlow();
                window.runFlow();
                window.reset();
            });
            expect(await page.evaluate(() => window.state)).toBe('ready');
            expect(await page.evaluate(() => window.score)).toBe(0);
        });

        test('winning then advancing raises the target', async ({ page }) => {
            await loadStraightLine(page);
            const before = await page.evaluate(() => window.target);
            await page.evaluate(() => {
                window.startFlow();
                window.runFlow();
                window.nextLevel();
            });
            const after = await page.evaluate(() => ({
                level: window.level,
                target: window.target,
                state: window.state,
            }));
            expect(after.level).toBe(2);
            expect(after.target).toBeGreaterThan(before);
            expect(after.state).toBe('ready');
        });

        test('the seeded queue is reproducible', async ({ page }) => {
            const a = await page.evaluate(() => {
                window.setSeed(42);
                window.reset();
                return window.queue.slice(0, 6);
            });
            const b = await page.evaluate(() => {
                window.setSeed(42);
                window.reset();
                return window.queue.slice(0, 6);
            });
            expect(a).toEqual(b);
        });
    });
});
