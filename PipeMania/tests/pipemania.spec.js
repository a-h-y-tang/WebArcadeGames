const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Rebuild a clean, deterministic board with the source at (row, col 0)
// flowing East. Returns nothing; mutates the page globals in place.
async function freshBoard(page, { startRow = 3, goal = 5 } = {}) {
    await page.evaluate(({ startRow, goal }) => {
        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++) grid[r][c] = null;
        startR = startRow;
        startC = 0;
        startDir = 'E';
        grid[startR][startC] = 'sE';
        window.goal = goal;
    }, { startRow, goal });
}

test.describe('Pipe Mania', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => localStorage.clear());
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Pipe Mania', async ({ page }) => {
            await expect(page).toHaveTitle('Pipe Mania');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('water');
        });

        test('canvas is 540×420', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '540');
            await expect(canvas).toHaveAttribute('height', '420');
        });

        test('game state is idle before start', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('grid is 7 rows × 9 columns', async ({ page }) => {
            const dims = await page.evaluate(() => [grid.length, grid[0].length]);
            expect(dims).toEqual([7, 9]);
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('best starts as — when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });
    });

    // -----------------------------------------------------------------------
    test.describe('pure pipe logic', () => {
        test('opposite() flips each direction', async ({ page }) => {
            const r = await page.evaluate(() =>
                [opposite('N'), opposite('S'), opposite('E'), opposite('W')]);
            expect(r).toEqual(['S', 'N', 'W', 'E']);
        });

        test('connects() reports a piece\'s open sides', async ({ page }) => {
            const r = await page.evaluate(() => [
                connects('H', 'E'), connects('H', 'N'),
                connects('NE', 'N'), connects('NE', 'S'),
                connects('X', 'W'),
            ]);
            expect(r).toEqual([true, false, true, false, true]);
        });

        test('exitDir() returns the other opening of a straight pipe', async ({ page }) => {
            const r = await page.evaluate(() => [exitDir('H', 'W'), exitDir('V', 'S')]);
            expect(r).toEqual(['E', 'N']);
        });

        test('exitDir() turns the corner of an elbow', async ({ page }) => {
            // ES opens East+South: enter from East, exit South.
            const r = await page.evaluate(() => exitDir('ES', 'E'));
            expect(r).toBe('S');
        });

        test('exitDir() passes straight through the cross', async ({ page }) => {
            const r = await page.evaluate(() => [exitDir('X', 'W'), exitDir('X', 'N')]);
            expect(r).toEqual(['E', 'S']);
        });

        test('exitDir() returns null when the entry side is closed', async ({ page }) => {
            const r = await page.evaluate(() => exitDir('V', 'E'));
            expect(r).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Start button puts the game in building state', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('building');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a key starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('building');
        });

        test('starting places a source pipe on the board', async ({ page }) => {
            await page.locator('#btn-start').click();
            const sourceOk = await page.evaluate(() => {
                const t = grid[startR][startC];
                return t !== null && OPENINGS[t].length === 1;
            });
            expect(sourceOk).toBe(true);
        });

        test('starting builds a queue of upcoming pieces', async ({ page }) => {
            await page.locator('#btn-start').click();
            const len = await page.evaluate(() => queue.length);
            expect(len).toBeGreaterThanOrEqual(5);
        });

        test('score starts at 0', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => pipesFilled)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    test.describe('placing pieces', () => {
        test('placing drops the front-of-queue piece and advances the queue', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                const front = queue[0];
                const second = queue[1];
                placePiece(0, 4);
                return { placed: grid[0][4], front, newFront: queue[0], second };
            });
            expect(r.placed).toBe(r.front);
            expect(r.newFront).toBe(r.second);
        });

        test('placing keeps the queue topped up', async ({ page }) => {
            await page.locator('#btn-start').click();
            const len = await page.evaluate(() => {
                placePiece(0, 4);
                return queue.length;
            });
            expect(len).toBeGreaterThanOrEqual(5);
        });

        test('cannot place on an occupied cell', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                placePiece(0, 4);
                const there = grid[0][4];
                const before = queue[0];
                placePiece(0, 4);          // same cell again
                return { unchanged: grid[0][4] === there, queueUntouched: queue[0] === before };
            });
            expect(r.unchanged).toBe(true);
            expect(r.queueUntouched).toBe(true);
        });

        test('cannot place on the source cell', async ({ page }) => {
            await page.locator('#btn-start').click();
            const sourceType = await page.evaluate(() => {
                const before = grid[startR][startC];
                placePiece(startR, startC);
                return { same: grid[startR][startC] === before };
            });
            expect(sourceType.same).toBe(true);
        });

        test('placing does nothing when idle', async ({ page }) => {
            const placed = await page.evaluate(() => {
                placePiece(1, 1);
                return grid[1][1];
            });
            expect(placed).toBeNull();
        });

        test('clicking the canvas places a piece in the matching cell', async ({ page }) => {
            await page.locator('#btn-start').click();
            const front = await page.evaluate(() => queue[0]);
            // Cell (row 1, col 2) centre = (2*60+30, 1*60+30) = (150, 90)
            await page.locator('#canvas').click({ position: { x: 150, y: 90 } });
            const placed = await page.evaluate(() => grid[1][2]);
            expect(placed).toBe(front);
        });
    });

    // -----------------------------------------------------------------------
    test.describe('the flow', () => {
        test('startFlow seeds the head just beyond the source', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, { startRow: 3 });
            const head = await page.evaluate(() => {
                startFlow();
                return { r: flowHead.r, c: flowHead.c, fromDir: flowHead.fromDir, state };
            });
            expect(head).toEqual({ r: 3, c: 1, fromDir: 'W', state: 'flowing' });
        });

        test('water advances one filled pipe per step', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, { startRow: 3, goal: 99 });
            const counts = await page.evaluate(() => {
                grid[3][1] = 'H'; grid[3][2] = 'H'; grid[3][3] = 'H';
                startFlow();
                const c1 = (stepFlow(), pipesFilled);
                const c2 = (stepFlow(), pipesFilled);
                return [c1, c2];
            });
            expect(counts).toEqual([1, 2]);
        });

        test('a straight run to the goal wins the level', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, { startRow: 3, goal: 4 });
            const result = await page.evaluate(() => {
                for (let c = 1; c <= 4; c++) grid[3][c] = 'H';
                startFlow();
                for (let i = 0; i < 4; i++) stepFlow();
                return { state, pipesFilled };
            });
            expect(result.state).toBe('won');
            expect(result.pipesFilled).toBe(4);
        });

        test('water spilling into an empty cell loses', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, { startRow: 3, goal: 99 });
            const result = await page.evaluate(() => {
                grid[3][1] = 'H'; grid[3][2] = 'H';   // col 3 left empty
                startFlow();
                stepFlow(); stepFlow();               // fill 1 and 2
                stepFlow();                            // step into empty col 3
                return { state, pipesFilled };
            });
            expect(result.state).toBe('lost');
            expect(result.pipesFilled).toBe(2);
        });

        test('water hitting a mis-aligned pipe loses', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, { startRow: 3, goal: 99 });
            const result = await page.evaluate(() => {
                grid[3][1] = 'V';   // vertical has no West opening — water enters from West
                startFlow();
                stepFlow();
                return { state, pipesFilled };
            });
            expect(result.state).toBe('lost');
            expect(result.pipesFilled).toBe(0);
        });

        test('elbows route the water around a corner', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, { startRow: 3, goal: 99 });
            const path = await page.evaluate(() => {
                // East into an ES elbow (turn South), then a V downward.
                grid[3][1] = 'ES';   // enter W? no — enters from W... ES opens E,S
                grid[3][1] = 'SW';   // enter from West, exit South
                grid[4][1] = 'V';    // enter from North, exit South
                startFlow();
                stepFlow();          // fill (3,1) SW -> head to (4,1) fromDir N
                const afterElbow = { r: flowHead.r, c: flowHead.c, fromDir: flowHead.fromDir };
                stepFlow();          // fill (4,1) V -> head to (5,1) fromDir N
                const afterV = { r: flowHead.r, c: flowHead.c, fromDir: flowHead.fromDir };
                return { afterElbow, afterV, pipesFilled };
            });
            expect(path.afterElbow).toEqual({ r: 4, c: 1, fromDir: 'N' });
            expect(path.afterV).toEqual({ r: 5, c: 1, fromDir: 'N' });
            expect(path.pipesFilled).toBe(2);
        });

        test('re-entering a filled cell (a loop) loses', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, { startRow: 3, goal: 99 });
            const result = await page.evaluate(() => {
                grid[3][1] = 'H';
                startFlow();
                filled[3][1] = true;   // pretend already flooded
                stepFlow();            // head is (3,1) — already filled
                return { state, pipesFilled };
            });
            expect(result.state).toBe('lost');
        });
    });

    // -----------------------------------------------------------------------
    test.describe('HUD and scoring', () => {
        test('score is reflected in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, { startRow: 3, goal: 99 });
            await page.evaluate(() => {
                grid[3][1] = 'H';
                startFlow();
                stepFlow();
            });
            await expect(page.locator('#score')).toHaveText('1');
        });

        test('goal is shown in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            const goalText = await page.locator('#goal').textContent();
            expect(parseInt(goalText, 10)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best updates and persists after a run', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, { startRow: 3, goal: 99 });
            const stored = await page.evaluate(() => {
                grid[3][1] = 'H'; grid[3][2] = 'H';   // then spill
                startFlow();
                stepFlow(); stepFlow(); stepFlow();    // fill 2, spill on 3rd -> lost
                return localStorage.getItem('pipemania-best');
            });
            expect(parseInt(stored, 10)).toBe(2);
            await expect(page.locator('#best')).toHaveText('2');
        });

        test('best only improves', async ({ page }) => {
            await page.locator('#btn-start').click();
            const best = await page.evaluate(() => {
                // First run: fill 3.
                for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) grid[r][c] = null;
                startR = 3; startC = 0; startDir = 'E'; grid[3][0] = 'sE';
                window.goal = 99;
                grid[3][1] = 'H'; grid[3][2] = 'H'; grid[3][3] = 'H';
                startFlow();
                stepFlow(); stepFlow(); stepFlow(); stepFlow();   // fill 3, spill -> lost
                const afterFirst = localStorage.getItem('pipemania-best');
                // Second run: only fill 1.
                for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) grid[r][c] = null;
                grid[3][0] = 'sE';
                grid[3][1] = 'H';
                startFlow();
                stepFlow(); stepFlow();
                return { afterFirst, afterSecond: localStorage.getItem('pipemania-best') };
            });
            expect(parseInt(best.afterFirst, 10)).toBe(3);
            expect(parseInt(best.afterSecond, 10)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    test.describe('winning and levels', () => {
        test('winning shows the level-clear overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, { startRow: 3, goal: 2 });
            await page.evaluate(() => {
                grid[3][1] = 'H'; grid[3][2] = 'H';
                startFlow();
                stepFlow(); stepFlow();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/clear/i);
        });

        test('advancing to the next level increments the level', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                const before = level;
                nextLevel();
                return { before, after: level, state };
            });
            expect(r.after).toBe(r.before + 1);
            expect(r.state).toBe('building');
        });

        test('the goal grows with the level', async ({ page }) => {
            await page.locator('#btn-start').click();
            const goals = await page.evaluate(() => {
                const g1 = goal;
                nextLevel();
                const g2 = goal;
                return [g1, g2];
            });
            expect(goals[1]).toBeGreaterThan(goals[0]);
        });
    });

    // -----------------------------------------------------------------------
    test.describe('releasing the water', () => {
        test('Space releases the water from building state', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('building');
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => state)).toBe('flowing');
        });
    });
});
