const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Pipe Dream', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.removeItem('pipe-best'); } catch (e) { /* ignore */ }
        });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Pipe Dream', async ({ page }) => {
            await expect(page).toHaveTitle('Pipe Dream');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains how to play', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('pipe');
        });

        test('the pipe score starts at 0', async ({ page }) => {
            await expect(page.locator('#score-pipes')).toHaveText('0');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas matches WIDTH×HEIGHT', async ({ page }) => {
            const r = await page.evaluate(() => ({ w: WIDTH, h: HEIGHT }));
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', String(r.w));
            await expect(canvas).toHaveAttribute('height', String(r.h));
        });

        test('the grid dimensions match the canvas', async ({ page }) => {
            const r = await page.evaluate(() => ({ cols: COLS, rows: ROWS, cell: CELL, w: WIDTH, h: HEIGHT }));
            expect(r.cols * r.cell).toBe(r.w);
            expect(r.rows * r.cell).toBe(r.h);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('a source piece sits on the board with one opening', async ({ page }) => {
            const r = await page.evaluate(() => {
                const s = grid[START.y][START.x];
                return { type: s && s.type, dir: START.dir };
            });
            expect(r.type).toBe('source');
            expect(['N', 'E', 'S', 'W']).toContain(r.dir);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('the Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is running after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the queue is filled with upcoming pieces after start', async ({ page }) => {
            const r = await page.evaluate(() => ({ len: queue.length, want: QUEUE_LEN }));
            expect(r.len).toBe(r.want);
        });

        test('every queued piece is a valid placeable type', async ({ page }) => {
            const ok = await page.evaluate(() => queue.every(t => PIECES[t] && t !== 'source'));
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Placing pipes
    // -----------------------------------------------------------------------
    test.describe('placing pipes', () => {
        test('placing on an empty cell drops the front queue piece there', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const front = queue[0];
                const placed = placeAt(3, 2);
                return { placed, front, cell: grid[2][3] && grid[2][3].type };
            });
            expect(r.placed).toBe(true);
            expect(r.cell).toBe(r.front);
        });

        test('placing advances the queue but keeps its length', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const before = queue.length;
                placeAt(3, 2);
                return { before, after: queue.length };
            });
            expect(r.after).toBe(r.before);
            expect(r.after).toBe(await page.evaluate(() => QUEUE_LEN));
        });

        test('placing on an occupied cell is rejected', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                placeAt(3, 2);
                const type1 = grid[2][3].type;
                const placed = placeAt(3, 2); // again — should fail
                return { placed, sameType: grid[2][3].type === type1 };
            });
            expect(r.placed).toBe(false);
            expect(r.sameType).toBe(true);
        });

        test('the source cell cannot be built over', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                return placeAt(START.x, START.y);
            });
            expect(r).toBe(false);
        });

        test('placing out of bounds is rejected', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                return placeAt(COLS + 5, 2) || placeAt(-1, 0);
            });
            expect(r).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // The flow (deterministic: drive flowStep() directly)
    // -----------------------------------------------------------------------
    test.describe('the flow', () => {
        test('flow into a correctly connected pipe fills it and scores', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 0;
                flow = { x: 2, y: 2, dir: 'E' };     // water about to move east
                grid[2][3] = { type: 'h', filled: false }; // straight E-W, accepts entry from W
                const result = flowStep();
                return { result, filled: grid[2][3].filled, score, fx: flow.x, fy: flow.y };
            });
            expect(r.result).toBe('flow');
            expect(r.filled).toBe(true);
            expect(r.score).toBe(1);
            expect(r.fx).toBe(3);
            expect(r.fy).toBe(2);
        });

        test('a curve redirects the flow around a corner', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                flow = { x: 2, y: 2, dir: 'E' };
                grid[2][3] = { type: 'sw', filled: false }; // openings S + W: enter W, exit S
                flowStep();
                return { dir: flow.dir, fx: flow.x, fy: flow.y };
            });
            expect(r.dir).toBe('S');
            expect(r.fx).toBe(3);
            expect(r.fy).toBe(2);
        });

        test('a cross pipe passes the flow straight through', async ({ page }) => {
            const dir = await page.evaluate(() => {
                startGame();
                flow = { x: 2, y: 2, dir: 'E' };
                grid[2][3] = { type: 'x', filled: false };
                flowStep();
                return flow.dir;
            });
            expect(dir).toBe('E');
        });

        test('flow into an empty cell springs a leak and ends the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                flow = { x: 2, y: 2, dir: 'E' };
                grid[2][3] = null; // nothing there
                const result = flowStep();
                return { result, state };
            });
            expect(r.result).toBe('leak');
            expect(r.state).toBe('over');
        });

        test('flow into a misaligned pipe springs a leak', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                flow = { x: 2, y: 2, dir: 'E' };
                grid[2][3] = { type: 'v', filled: false }; // openings N,S — no W opening
                const result = flowStep();
                return { result, state };
            });
            expect(r.result).toBe('leak');
            expect(r.state).toBe('over');
        });

        test('flow off the edge of the board springs a leak', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                flow = { x: COLS - 1, y: 2, dir: 'E' }; // moving off the right edge
                const result = flowStep();
                return { result, state };
            });
            expect(r.result).toBe('leak');
            expect(r.state).toBe('over');
        });

        test('reaching the target length wins the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = TARGET - 1;
                flow = { x: 2, y: 2, dir: 'E' };
                grid[2][3] = { type: 'h', filled: false };
                const result = flowStep();
                return { result, state, score };
            });
            expect(r.score).toBe(await page.evaluate(() => TARGET));
            expect(r.result).toBe('win');
            expect(r.state).toBe('win');
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring and best', () => {
        test('the pipe score updates in the DOM', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 0;
                flow = { x: 2, y: 2, dir: 'E' };
                grid[2][3] = { type: 'h', filled: false };
                flowStep();
            });
            await expect(page.locator('#score-pipes')).toHaveText('1');
        });

        test('best rises to match a new high score at game over', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                best = 0; score = 7;
                endGame('over');
                return best;
            });
            expect(best).toBe(7);
        });

        test('best persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                best = 0; score = 5;
                endGame('over');
            });
            const stored = await page.evaluate(() => localStorage.getItem('pipe-best'));
            expect(parseInt(stored, 10)).toBe(5);
        });

        test('best does not drop for a lower score', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                best = 10; score = 3;
                endGame('over');
                return best;
            });
            expect(best).toBe(10);
        });
    });

    // -----------------------------------------------------------------------
    // Winning / losing overlay
    // -----------------------------------------------------------------------
    test.describe('end of game', () => {
        test('a win shows a "You Win" overlay', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame('win'); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('You Win');
        });

        test('a leak shows a "Game Over" overlay', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame('over'); });
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('the button reads "Play Again" after the game ends', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame('over'); });
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets the score and starts running', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 9; endGame('over'); });
            await page.locator('#btn-start').click();
            await expect(page.locator('#score-pipes')).toHaveText('0');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('the pause overlay shows "Paused"', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the flow does not advance while paused', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                state = 'paused';
                flowDelay = 0;
                const fx0 = flow.x, fy0 = flow.y;
                for (let i = 0; i < 20; i++) update(1.0); // plenty of time
                return { fx0, fy0, fx1: flow.x, fy1: flow.y };
            });
            expect(r.fx1).toBe(r.fx0);
            expect(r.fy1).toBe(r.fy0);
        });
    });
});
