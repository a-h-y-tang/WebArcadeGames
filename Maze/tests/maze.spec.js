const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Solve the current maze by replaying the exposed shortest path.
async function solveCurrentMaze(page) {
    const path = await page.evaluate(() => solvePath());
    for (const key of path) {
        await page.evaluate((k) => movePlayer(k), key);
    }
}

test.describe('Maze', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.clear(); } catch (e) {}
        });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Maze', async ({ page }) => {
            await expect(page).toHaveTitle('Maze');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/start/i);
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 500×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('a maze grid is generated on load', async ({ page }) => {
            const dims = await page.evaluate(() => ({ rows: maze.length, cols: maze[0].length }));
            expect(dims.rows).toBeGreaterThan(1);
            expect(dims.cols).toBeGreaterThan(1);
        });

        test('every cell exposes four wall flags', async ({ page }) => {
            const ok = await page.evaluate(() =>
                maze.every((row) => row.every((c) =>
                    Array.isArray(c.walls) && c.walls.length === 4)));
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Maze structure
    // -----------------------------------------------------------------------
    test.describe('maze structure', () => {
        test('the maze is fully solvable (a path to the exit exists)', async ({ page }) => {
            await page.evaluate(() => startGame());
            const path = await page.evaluate(() => solvePath());
            expect(Array.isArray(path)).toBe(true);
            expect(path.length).toBeGreaterThan(0);
        });

        test("the top border wall of the start cell is closed", async ({ page }) => {
            await page.evaluate(() => startGame());
            // Border walls are never removed → wall[0] (top) of (0,0) stays closed.
            const closed = await page.evaluate(() => maze[0][0].walls[0]);
            expect(closed).toBe(true);
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

        test('starting sets state to playing', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('player starts at the top-left corner', async ({ page }) => {
            await page.evaluate(() => startGame());
            const p = await page.evaluate(() => ({ ...player }));
            expect(p).toEqual({ x: 0, y: 0 });
        });

        test('exit is at the bottom-right corner', async ({ page }) => {
            await page.evaluate(() => startGame());
            const info = await page.evaluate(() => ({ exit: { ...exit }, cols: COLS, rows: ROWS }));
            expect(info.exit).toEqual({ x: info.cols - 1, y: info.rows - 1 });
        });

        test('level starts at 1', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => level)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('moving through an open wall changes the player position', async ({ page }) => {
            await page.evaluate(() => startGame());
            const dir = await page.evaluate(() => {
                const c = maze[player.y][player.x];
                const order = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
                for (let i = 0; i < 4; i++) if (!c.walls[i]) return order[i];
                return null;
            });
            expect(dir).not.toBeNull();
            const before = await page.evaluate(() => ({ ...player }));
            const moved = await page.evaluate((k) => movePlayer(k), dir);
            const after = await page.evaluate(() => ({ ...player }));
            expect(moved).toBe(true);
            expect(after).not.toEqual(before);
        });

        test('moving into a closed border wall is blocked', async ({ page }) => {
            await page.evaluate(() => startGame());
            // From (0,0) the top wall is a closed border wall.
            const before = await page.evaluate(() => ({ ...player }));
            const moved = await page.evaluate(() => movePlayer('ArrowUp'));
            const after = await page.evaluate(() => ({ ...player }));
            expect(moved).toBe(false);
            expect(after).toEqual(before);
        });

        test('the player never leaves the grid', async ({ page }) => {
            await page.evaluate(() => startGame());
            // Hammer every direction many times; player must stay in bounds.
            await page.evaluate(() => {
                const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
                for (let i = 0; i < 400; i++) movePlayer(keys[i % 4]);
            });
            const ok = await page.evaluate(() =>
                player.x >= 0 && player.x < COLS && player.y >= 0 && player.y < ROWS);
            expect(ok).toBe(true);
        });

        test('WASD keys also move the player', async ({ page }) => {
            await page.evaluate(() => startGame());
            const dir = await page.evaluate(() => {
                const c = maze[player.y][player.x];
                const map = { ArrowUp: 'w', ArrowRight: 'd', ArrowDown: 's', ArrowLeft: 'a' };
                const order = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
                for (let i = 0; i < 4; i++) if (!c.walls[i]) return map[order[i]];
                return null;
            });
            const before = await page.evaluate(() => ({ ...player }));
            await page.evaluate((k) => movePlayer(k), dir);
            const after = await page.evaluate(() => ({ ...player }));
            expect(after).not.toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Solving a level
    // -----------------------------------------------------------------------
    test.describe('solving a level', () => {
        test('reaching the exit increments the score', async ({ page }) => {
            await page.evaluate(() => startGame());
            await solveCurrentMaze(page);
            await expect(page.locator('#score')).toHaveText('1');
        });

        test('reaching the exit advances to the next level', async ({ page }) => {
            await page.evaluate(() => startGame());
            await solveCurrentMaze(page);
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('solving resets the player to the start of the new maze', async ({ page }) => {
            await page.evaluate(() => startGame());
            await solveCurrentMaze(page);
            const p = await page.evaluate(() => ({ ...player }));
            expect(p).toEqual({ x: 0, y: 0 });
        });

        test('clearing two levels raises the score to 2', async ({ page }) => {
            await page.evaluate(() => startGame());
            await solveCurrentMaze(page);
            await solveCurrentMaze(page);
            await expect(page.locator('#score')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Timer
    // -----------------------------------------------------------------------
    test.describe('timer', () => {
        test('timeLeft is positive while playing', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => timeLeft)).toBeGreaterThan(0);
        });

        test('timeLeft decreases over time', async ({ page }) => {
            await page.evaluate(() => startGame());
            const t1 = await page.evaluate(() => timeLeft);
            await page.waitForTimeout(500);
            const t2 = await page.evaluate(() => timeLeft);
            expect(t2).toBeLessThan(t1);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('endGame sets the state to over', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.evaluate(() => endGame());
            expect(await page.evaluate(() => state)).toBe('over');
        });

        test('game over overlay is shown', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|time/i);
        });

        test('Play Again button appears after game over', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('a stopped game does not move the player', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.evaluate(() => endGame());
            const before = await page.evaluate(() => ({ ...player }));
            await page.evaluate(() => {
                ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].forEach((k) => movePlayer(k));
            });
            const after = await page.evaluate(() => ({ ...player }));
            expect(after).toEqual(before);
        });

        test('restarting resets the score to 0', async ({ page }) => {
            await page.evaluate(() => startGame());
            await solveCurrentMaze(page); // score -> 1
            await expect(page.locator('#score')).toHaveText('1');
            await page.evaluate(() => endGame());
            await page.locator('#btn-start').click();
            await expect(page.locator('#score')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best score updates when the game ends with a higher score', async ({ page }) => {
            await page.evaluate(() => startGame());
            await solveCurrentMaze(page);
            await solveCurrentMaze(page);
            await page.evaluate(() => endGame());
            const best = parseInt(await page.locator('#best').textContent(), 10);
            expect(best).toBeGreaterThanOrEqual(2);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => startGame());
            await solveCurrentMaze(page);
            await page.evaluate(() => endGame());
            const stored = await page.evaluate(() => localStorage.getItem('maze-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(1);
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard start
    // -----------------------------------------------------------------------
    test.describe('keyboard', () => {
        test('an arrow key starts the game from idle', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('overlay is dismissed after starting with a key', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });
});
