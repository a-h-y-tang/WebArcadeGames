const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Tetris', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tetris', async ({ page }) => {
            await expect(page).toHaveTitle('Tetris');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to press a key', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('arrow');
        });

        test('score, lines and level start at 0 / 0 / 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lines')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 250×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '250');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('board is 20 rows × 10 columns and empty', async ({ page }) => {
            const dims = await page.evaluate(() => ({
                rows: board.length,
                cols: board[0].length,
                filled: board.flat().filter(Boolean).length,
            }));
            expect(dims).toEqual({ rows: 20, cols: 10, filled: 0 });
        });

        test('state is idle before starting', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('arrow key dismisses overlay', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start Game button dismisses overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is running after start', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('a current piece exists after start', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            const has = await page.evaluate(() => current !== null && Array.isArray(current.matrix));
            expect(has).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Piece movement
    // -----------------------------------------------------------------------
    test.describe('piece movement', () => {
        test('ArrowRight moves the piece right', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => spawn('O'));
            const before = await page.evaluate(() => current.x);
            await page.keyboard.press('ArrowRight');
            const after = await page.evaluate(() => current.x);
            expect(after).toBe(before + 1);
        });

        test('ArrowLeft moves the piece left', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => spawn('O'));
            const before = await page.evaluate(() => current.x);
            await page.keyboard.press('ArrowLeft');
            const after = await page.evaluate(() => current.x);
            expect(after).toBe(before - 1);
        });

        test('ArrowDown soft-drops the piece one row', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => spawn('O'));
            const before = await page.evaluate(() => current.y);
            await page.keyboard.press('ArrowDown');
            const after = await page.evaluate(() => current.y);
            expect(after).toBe(before + 1);
        });

        test('piece cannot move through the left wall', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => { spawn('O'); current.x = 0; });
            await page.keyboard.press('ArrowLeft');
            const x = await page.evaluate(() => current.x);
            expect(x).toBe(0);
        });

        test('piece cannot move through the right wall', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            const startX = await page.evaluate(() => { spawn('O'); current.x = COLS - 2; return current.x; });
            await page.keyboard.press('ArrowRight');
            const x = await page.evaluate(() => current.x);
            expect(x).toBe(startX);
        });

        test('gravity moves the piece down over time', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => { spawn('O'); current.y = 0; });
            const before = await page.evaluate(() => current.y);
            await page.waitForTimeout(900); // ≥ one drop interval
            const after = await page.evaluate(() => current.y);
            expect(after).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Rotation
    // -----------------------------------------------------------------------
    test.describe('rotation', () => {
        test('ArrowUp rotates the piece (matrix changes)', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => { spawn('T'); current.x = 4; current.y = 5; });
            const before = await page.evaluate(() => JSON.stringify(current.matrix));
            await page.keyboard.press('ArrowUp');
            const after = await page.evaluate(() => JSON.stringify(current.matrix));
            expect(after).not.toBe(before);
        });

        test('rotating an O piece leaves its cell set unchanged', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => { spawn('O'); current.x = 4; current.y = 5; });
            const before = await page.evaluate(() =>
                JSON.stringify(cellsOf(current).map(c => [c.x, c.y]).sort()));
            await page.keyboard.press('ArrowUp');
            const after = await page.evaluate(() =>
                JSON.stringify(cellsOf(current).map(c => [c.x, c.y]).sort()));
            expect(after).toBe(before);
        });

        test('four rotations return the piece to its start orientation', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => { spawn('T'); current.x = 4; current.y = 5; });
            const before = await page.evaluate(() => JSON.stringify(current.matrix));
            for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
            const after = await page.evaluate(() => JSON.stringify(current.matrix));
            expect(after).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Locking & line clears
    // -----------------------------------------------------------------------
    test.describe('locking and line clears', () => {
        test('hard drop locks the piece into the board', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => spawn('O'));
            await page.keyboard.press('Space');
            const filled = await page.evaluate(() => board.flat().filter(Boolean).length);
            expect(filled).toBe(4); // an O tetromino has 4 cells
        });

        test('hard drop spawns a fresh piece at the top', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => spawn('O'));
            await page.keyboard.press('Space');
            const y = await page.evaluate(() => current.y);
            expect(y).toBeLessThanOrEqual(1);
        });

        test('a completed row is cleared and counted', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            const cleared = await page.evaluate(() => {
                // Fill the entire bottom row
                for (let x = 0; x < COLS; x++) board[ROWS - 1][x] = 'I';
                return clearLines();
            });
            expect(cleared).toBe(1);
            const bottomFilled = await page.evaluate(() =>
                board[ROWS - 1].filter(Boolean).length);
            expect(bottomFilled).toBe(0);
        });

        test('clearing one line increments the lines counter', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => {
                for (let x = 0; x < COLS; x++) board[ROWS - 1][x] = 'I';
                clearLines();
            });
            await expect(page.locator('#lines')).toHaveText('1');
        });

        test('clearing one line awards 100 points at level 1', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => {
                score = 0; updateHud();
                for (let x = 0; x < COLS; x++) board[ROWS - 1][x] = 'I';
                clearLines();
            });
            await expect(page.locator('#score')).toHaveText('100');
        });

        test('clearing four lines (a Tetris) awards 800 points', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => {
                score = 0; updateHud();
                for (let y = ROWS - 4; y < ROWS; y++)
                    for (let x = 0; x < COLS; x++) board[y][x] = 'I';
                clearLines();
            });
            await expect(page.locator('#score')).toHaveText('800');
            await expect(page.locator('#lines')).toHaveText('4');
        });

        test('a partially filled row is not cleared', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            const cleared = await page.evaluate(() => {
                for (let x = 0; x < COLS - 1; x++) board[ROWS - 1][x] = 'I';
                return clearLines();
            });
            expect(cleared).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Levelling
    // -----------------------------------------------------------------------
    test.describe('levelling', () => {
        test('reaching 10 cleared lines advances to level 2', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => {
                for (let i = 0; i < 10; i++) {
                    for (let x = 0; x < COLS; x++) board[ROWS - 1][x] = 'I';
                    clearLines();
                }
            });
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P key pauses a running game', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('p');
            const s = await page.evaluate(() => state);
            expect(s).toBe('paused');
        });

        test('pause overlay shows "Paused"', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P key resumes a paused game', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('piece does not fall while paused', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await page.evaluate(() => { spawn('O'); current.y = 0; });
            await page.keyboard.press('p');
            const before = await page.evaluate(() => current.y);
            await page.waitForTimeout(900);
            const after = await page.evaluate(() => current.y);
            expect(after).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('spawning into a filled board ends the game', async ({ page }) => {
            await page.keyboard.press('ArrowLeft'); // start
            await page.evaluate(() => {
                // Fill the top rows so a new piece cannot fit
                for (let y = 0; y < 3; y++)
                    for (let x = 0; x < COLS; x++) board[y][x] = 'I';
                spawn('O');
            });
            const s = await page.evaluate(() => state);
            expect(s).toBe('over');
        });

        test('game over overlay is shown', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('Play Again button is visible after game over', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('arrow key after game over restarts with score 0', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await page.evaluate(() => endGame());
            await page.keyboard.press('ArrowLeft');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score updates on game over if score is higher', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await page.evaluate(() => { score = 500; updateHud(); endGame(); });
            await expect(page.locator('#best')).toHaveText('500');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await page.evaluate(() => { score = 340; updateHud(); endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('tetris-best'));
            expect(parseInt(stored)).toBe(340);
        });
    });
});
