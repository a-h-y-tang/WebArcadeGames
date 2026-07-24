const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start playing on a chosen level without going through the overlay, and clear
// the board so a test can build an exact position deterministically.
async function play(page, level = 0) {
    await page.evaluate((lv) => {
        loadLevel(lv);
        state = 'playing';
        hideOverlay();
        draw();
    }, level);
}

test.describe('Light Up (Akari)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title mentions Light Up', async ({ page }) => {
            await expect(page).toHaveTitle(/Light Up|Akari/i);
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal (light / illuminate)', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/light|illumin|bulb/i);
        });

        test('game state is idle before start', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('grid is 7×7', async ({ page }) => {
            const r = await page.evaluate(() => [N, wall.length, wall[0].length, bulbs.length]);
            expect(r).toEqual([7, 7, 7, 7]);
        });

        test('at least four puzzles ship with the game', async ({ page }) => {
            expect(await page.evaluate(() => levels.length)).toBeGreaterThanOrEqual(4);
        });

        test('canvas has fixed pixel dimensions', async ({ page }) => {
            const c = page.locator('#canvas');
            expect(parseInt(await c.getAttribute('width'), 10)).toBeGreaterThan(0);
            expect(parseInt(await c.getAttribute('height'), 10)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('starting loads the first puzzle with no bulbs placed', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => ({
                level: levelIndex,
                bulbCount: bulbs.flat().filter(Boolean).length,
            }));
            expect(r).toEqual({ level: 0, bulbCount: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Parsing the puzzle grid
    // -----------------------------------------------------------------------
    test.describe('puzzle parsing', () => {
        test.beforeEach(async ({ page }) => play(page, 0));

        test('walls come from the level grid', async ({ page }) => {
            // Level 0 grid row 0 is "1.3...1" → walls at (0,0), (0,2), (0,6).
            const r = await page.evaluate(() => ({
                w00: isWall(0, 0), w01: isWall(0, 1), w02: isWall(0, 2), w06: isWall(0, 6),
            }));
            expect(r).toEqual({ w00: true, w01: false, w02: true, w06: true });
        });

        test('wall numbers are parsed', async ({ page }) => {
            // (0,0)=1, (0,2)=3, (0,6)=1, and a 0-wall exists at (4,0).
            const r = await page.evaluate(() => ({
                n00: wallNum(0, 0), n02: wallNum(0, 2), n06: wallNum(0, 6), n40: wallNum(4, 0),
            }));
            expect(r).toEqual({ n00: 1, n02: 3, n06: 1, n40: 0 });
        });

        test('white cells report no wall number', async ({ page }) => {
            expect(await page.evaluate(() => wallNum(3, 3))).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Placing bulbs
    // -----------------------------------------------------------------------
    test.describe('placing bulbs', () => {
        test.beforeEach(async ({ page }) => play(page, 0));

        test('toggleBulb places a bulb on a white cell', async ({ page }) => {
            const v = await page.evaluate(() => { toggleBulb(3, 3); return bulbs[3][3]; });
            expect(v).toBe(true);
        });

        test('toggling the same cell removes the bulb', async ({ page }) => {
            const v = await page.evaluate(() => { toggleBulb(3, 3); toggleBulb(3, 3); return bulbs[3][3]; });
            expect(v).toBe(false);
        });

        test('a bulb cannot be placed on a wall', async ({ page }) => {
            const v = await page.evaluate(() => { toggleBulb(0, 0); return bulbs[0][0]; });
            expect(v).toBe(false);
        });

        test('placing a bulb clears a mark on that cell', async ({ page }) => {
            const r = await page.evaluate(() => {
                toggleMark(3, 3);
                const marked = marks[3][3];
                toggleBulb(3, 3);
                return { marked, afterMark: marks[3][3], bulb: bulbs[3][3] };
            });
            expect(r).toEqual({ marked: true, afterMark: false, bulb: true });
        });

        test('placing does nothing before the game starts', async ({ page }) => {
            await page.reload();
            const r = await page.evaluate(() => { toggleBulb(3, 3); return { v: bulbs[3][3], state }; });
            expect(r).toEqual({ v: false, state: 'idle' });
        });
    });

    // -----------------------------------------------------------------------
    // Marks
    // -----------------------------------------------------------------------
    test.describe('marks', () => {
        test.beforeEach(async ({ page }) => play(page, 0));

        test('toggleMark marks a white cell', async ({ page }) => {
            expect(await page.evaluate(() => { toggleMark(3, 3); return marks[3][3]; })).toBe(true);
        });

        test('a cell holding a bulb cannot be marked', async ({ page }) => {
            const v = await page.evaluate(() => { toggleBulb(3, 3); toggleMark(3, 3); return marks[3][3]; });
            expect(v).toBe(false);
        });

        test('marks never affect the solved state', async ({ page }) => {
            const solved = await page.evaluate(() => {
                for (const [r, c] of levels[0].sol) toggleBulb(r, c);
                // sprinkle a few marks on remaining empty white cells
                for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
                    if (!isWall(r, c) && !bulbs[r][c]) toggleMark(r, c);
                return isSolved();
            });
            expect(solved).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Illumination
    // -----------------------------------------------------------------------
    test.describe('illumination', () => {
        test.beforeEach(async ({ page }) => play(page, 0));

        test('a bulb lights its own cell', async ({ page }) => {
            const lit = await page.evaluate(() => { toggleBulb(3, 3); return isLit(3, 3); });
            expect(lit).toBe(true);
        });

        test('a bulb lights along its row and column', async ({ page }) => {
            const r = await page.evaluate(() => {
                toggleBulb(3, 3);
                return { right: isLit(3, 4), left: isLit(3, 2), up: isLit(2, 3), down: isLit(4, 3) };
            });
            expect(r).toEqual({ right: true, left: true, up: true, down: true });
        });

        test('light does not pass through a wall', async ({ page }) => {
            // Row 0: walls at (0,0) and (0,2). A bulb at (0,1) is boxed in — it
            // must not light (0,3), which is on the far side of the (0,2) wall.
            const r = await page.evaluate(() => {
                toggleBulb(0, 1);
                return { near: isLit(0, 1), blocked: isLit(0, 3) };
            });
            expect(r).toEqual({ near: true, blocked: false });
        });

        test('an unlit cell reports not lit', async ({ page }) => {
            expect(await page.evaluate(() => isLit(6, 6))).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Conflicts (two bulbs seeing each other)
    // -----------------------------------------------------------------------
    test.describe('conflicts', () => {
        test.beforeEach(async ({ page }) => play(page, 0));

        test('two bulbs in the same open row conflict', async ({ page }) => {
            const r = await page.evaluate(() => {
                toggleBulb(3, 1); toggleBulb(3, 5);
                return { a: bulbConflict(3, 1), b: bulbConflict(3, 5) };
            });
            expect(r).toEqual({ a: true, b: true });
        });

        test('two bulbs separated by a wall do not conflict', async ({ page }) => {
            // Row 0: wall at (0,2) sits between columns 1 and 3.
            const r = await page.evaluate(() => {
                toggleBulb(0, 1); toggleBulb(0, 3);
                return { a: bulbConflict(0, 1), b: bulbConflict(0, 3) };
            });
            expect(r).toEqual({ a: false, b: false });
        });

        test('a lone bulb has no conflict', async ({ page }) => {
            expect(await page.evaluate(() => { toggleBulb(3, 3); return bulbConflict(3, 3); })).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Wall constraints
    // -----------------------------------------------------------------------
    test.describe('wall constraints', () => {
        test.beforeEach(async ({ page }) => play(page, 0));

        test('adjBulbCount counts orthogonally adjacent bulbs', async ({ page }) => {
            // Wall at (0,2); neighbours are (0,1),(0,3),(1,2). Put bulbs on two.
            const n = await page.evaluate(() => {
                toggleBulb(0, 1); toggleBulb(1, 2);
                return adjBulbCount(0, 2);
            });
            expect(n).toBe(2);
        });

        test('a numbered wall is satisfied at its exact count', async ({ page }) => {
            // (0,6)=1 → needs exactly one adjacent bulb. Neighbours (0,5),(1,6).
            const r = await page.evaluate(() => {
                const before = wallSatisfied(0, 6);
                toggleBulb(1, 6);
                return { before, after: wallSatisfied(0, 6) };
            });
            expect(r).toEqual({ before: false, after: true });
        });

        test('a zero wall is satisfied only with no adjacent bulbs', async ({ page }) => {
            // (4,0)=0. Its white neighbour (4,1) must stay empty.
            const r = await page.evaluate(() => {
                const empty = wallSatisfied(4, 0);
                toggleBulb(4, 1);
                return { empty, withBulb: wallSatisfied(4, 0) };
            });
            expect(r).toEqual({ empty: true, withBulb: false });
        });
    });

    // -----------------------------------------------------------------------
    // Solving / winning
    // -----------------------------------------------------------------------
    test.describe('solving', () => {
        test.beforeEach(async ({ page }) => play(page, 0));

        test('an empty board is not solved', async ({ page }) => {
            expect(await page.evaluate(() => isSolved())).toBe(false);
        });

        test('the embedded solution solves the puzzle', async ({ page }) => {
            const solved = await page.evaluate(() => {
                for (const [r, c] of levels[0].sol) toggleBulb(r, c);
                return isSolved();
            });
            expect(solved).toBe(true);
        });

        test('a board with an unlit cell is not solved', async ({ page }) => {
            const solved = await page.evaluate(() => {
                const sol = levels[0].sol;
                for (let i = 0; i < sol.length - 1; i++) toggleBulb(sol[i][0], sol[i][1]); // omit one
                return isSolved();
            });
            expect(solved).toBe(false);
        });

        test('completing the solution sets state to won', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (const [r, c] of levels[0].sol) toggleBulb(r, c);
                return state;
            });
            expect(r).toBe('won');
        });

        test('the win overlay appears and announces success', async ({ page }) => {
            await page.evaluate(() => { for (const [r, c] of levels[0].sol) toggleBulb(r, c); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/solved|complete|win|lit/i);
        });

        test('bulbs cannot be toggled after the puzzle is won', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (const [r, c] of levels[0].sol) toggleBulb(r, c);
                const before = bulbs.flat().filter(Boolean).length;
                toggleBulb(6, 6); // any empty white cell
                return { state, unchanged: bulbs.flat().filter(Boolean).length === before };
            });
            expect(r.state).toBe('won');
            expect(r.unchanged).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Clicking the canvas
    // -----------------------------------------------------------------------
    test.describe('clicking the canvas', () => {
        test.beforeEach(async ({ page }) => play(page, 0));

        test('left-click on a white cell places a bulb', async ({ page }) => {
            const { x, y } = await page.evaluate(() => cellCenter(3, 3));
            await page.locator('#canvas').click({ position: { x, y } });
            expect(await page.evaluate(() => bulbs[3][3])).toBe(true);
        });

        test('right-click on a white cell places a mark', async ({ page }) => {
            const { x, y } = await page.evaluate(() => cellCenter(3, 3));
            await page.locator('#canvas').click({ button: 'right', position: { x, y } });
            expect(await page.evaluate(() => marks[3][3])).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Reset and next level
    // -----------------------------------------------------------------------
    test.describe('reset and progression', () => {
        test('R clears all bulbs on the current puzzle', async ({ page }) => {
            await play(page, 0);
            await page.evaluate(() => { toggleBulb(3, 3); toggleBulb(6, 6); });
            await page.keyboard.press('r');
            const r = await page.evaluate(() => ({
                bulbCount: bulbs.flat().filter(Boolean).length,
                level: levelIndex, state,
            }));
            expect(r).toEqual({ bulbCount: 0, level: 0, state: 'playing' });
        });

        test('advancing to the next puzzle loads a different grid', async ({ page }) => {
            await play(page, 0);
            const before = await page.evaluate(() => JSON.stringify(levels[levelIndex].grid));
            await page.evaluate(() => nextLevel());
            const r = await page.evaluate(() => ({
                level: levelIndex,
                grid: JSON.stringify(levels[levelIndex].grid),
                bulbCount: bulbs.flat().filter(Boolean).length,
            }));
            expect(r.level).toBe(1);
            expect(r.grid).not.toBe(before);
            expect(r.bulbCount).toBe(0);
        });

        test('the next-puzzle button appears after solving and advances the level', async ({ page }) => {
            await play(page, 0);
            await page.evaluate(() => { for (const [r, c] of levels[0].sol) toggleBulb(r, c); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => ({ level: levelIndex, state: state }))).toEqual({ level: 1, state: 'playing' });
        });
    });

    // -----------------------------------------------------------------------
    // Every shipped puzzle is solvable by its embedded solution
    // -----------------------------------------------------------------------
    test.describe('all puzzles', () => {
        test('each embedded solution solves its puzzle', async ({ page }) => {
            const results = await page.evaluate(() => {
                const out = [];
                for (let i = 0; i < levels.length; i++) {
                    loadLevel(i);
                    state = 'playing';
                    for (const [r, c] of levels[i].sol) toggleBulb(r, c);
                    out.push(state === 'won');
                }
                return out;
            });
            expect(results.every(Boolean)).toBe(true);
            expect(results.length).toBeGreaterThanOrEqual(4);
        });
    });
});
