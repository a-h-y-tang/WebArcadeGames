const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('SameGame', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is SameGame', async ({ page }) => {
            await expect(page).toHaveTitle('SameGame');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay mentions groups', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('group');
        });

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 504×360', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '504');
            await expect(canvas).toHaveAttribute('height', '360');
        });

        test('board is 10 rows × 14 columns', async ({ page }) => {
            const dims = await page.evaluate(() => ({ rows: board.length, cols: board[0].length }));
            expect(dims).toEqual({ rows: 10, cols: 14 });
        });

        test('every tile has a colour in range', async ({ page }) => {
            const ok = await page.evaluate(() =>
                board.flat().every(v => v !== null && v >= 0 && v < NUM_COLORS));
            expect(ok).toBe(true);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Start button dismisses overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state is running after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a freshly dealt board always has at least one move', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => hasMoves())).toBe(true);
        });

        test('a key press dismisses the overlay and starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Groups
    // -----------------------------------------------------------------------
    test.describe('groups', () => {
        test('groupAt collects connected same-colour tiles', async ({ page }) => {
            await page.locator('#btn-start').click();
            const size = await page.evaluate(() => {
                clearBoard();
                board[0][0] = 1; board[0][1] = 1; board[1][0] = 1; // an L of colour 1
                board[1][1] = 2; // different colour, excluded
                return groupAt(0, 0).length;
            });
            expect(size).toBe(3);
        });

        test('groupAt of a lone tile is size 1', async ({ page }) => {
            await page.locator('#btn-start').click();
            const size = await page.evaluate(() => {
                clearBoard();
                board[5][5] = 3;
                return groupAt(5, 5).length;
            });
            expect(size).toBe(1);
        });

        test('diagonal neighbours are not connected', async ({ page }) => {
            await page.locator('#btn-start').click();
            const size = await page.evaluate(() => {
                clearBoard();
                board[0][0] = 1; board[1][1] = 1; // only diagonally adjacent
                return groupAt(0, 0).length;
            });
            expect(size).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Removing groups
    // -----------------------------------------------------------------------
    test.describe('removing groups', () => {
        test('removing a group of 3 clears those tiles', async ({ page }) => {
            await page.locator('#btn-start').click();
            const removed = await page.evaluate(() => {
                clearBoard();
                board[ROWS - 1][0] = 1; board[ROWS - 1][1] = 1; board[ROWS - 1][2] = 1;
                return removeGroup(ROWS - 1, 0);
            });
            expect(removed).toBe(3);
            expect(await page.evaluate(() => tilesLeft())).toBe(0);
        });

        test('a lone tile cannot be removed', async ({ page }) => {
            await page.locator('#btn-start').click();
            const removed = await page.evaluate(() => {
                clearBoard();
                board[ROWS - 1][0] = 1;
                return removeGroup(ROWS - 1, 0);
            });
            expect(removed).toBe(0);
            expect(await page.evaluate(() => tilesLeft())).toBe(1);
        });

        test('clicking an empty cell does nothing', async ({ page }) => {
            await page.locator('#btn-start').click();
            const removed = await page.evaluate(() => {
                clearBoard();
                board[ROWS - 1][0] = 1; board[ROWS - 1][1] = 1;
                return removeGroup(0, 5); // empty cell
            });
            expect(removed).toBe(0);
        });

        test('a real click removes the group under the cursor', async ({ page }) => {
            await page.locator('#btn-start').click();
            const before = await page.evaluate(() => {
                clearBoard();
                // Two adjacent tiles in the top-left corner cells (0,0) & (0,1).
                board[0][0] = 1; board[0][1] = 1;
                draw();
                return tilesLeft();
            });
            expect(before).toBe(2);
            // Cell (0,0) centre = (CELL/2, CELL/2) = (18, 18).
            await page.locator('#canvas').click({ position: { x: 18, y: 18 } });
            expect(await page.evaluate(() => tilesLeft())).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('scoreFor grows quadratically', async ({ page }) => {
            const vals = await page.evaluate(() => [scoreFor(2), scoreFor(3), scoreFor(4), scoreFor(5)]);
            expect(vals).toEqual([2, 6, 12, 20]);
        });

        test('removing a group of 4 adds 12 points', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                clearBoard();
                score = 0; updateHud();
                board[ROWS - 1][0] = 2; board[ROWS - 1][1] = 2;
                board[ROWS - 1][2] = 2; board[ROWS - 1][3] = 2;
                board[ROWS - 1][10] = 0; // a lone leftover so the board is not fully cleared
                removeGroup(ROWS - 1, 0);
            });
            await expect(page.locator('#score')).toHaveText('12');
        });
    });

    // -----------------------------------------------------------------------
    // Gravity & column collapse
    // -----------------------------------------------------------------------
    test.describe('gravity and collapse', () => {
        test('applyGravity drops floating tiles to the floor', async ({ page }) => {
            await page.locator('#btn-start').click();
            const bottom = await page.evaluate(() => {
                clearBoard();
                board[0][3] = 2;
                applyGravity();
                return board[ROWS - 1][3];
            });
            expect(bottom).toBe(2);
        });

        test('empty columns collapse to the left', async ({ page }) => {
            await page.locator('#btn-start').click();
            const res = await page.evaluate(() => {
                clearBoard();
                board[ROWS - 1][2] = 1; // only column 2 has a tile
                collapseColumns();
                return { c0: board[ROWS - 1][0], c2: board[ROWS - 1][2] };
            });
            expect(res.c0).toBe(1);
            expect(res.c2).toBe(null);
        });

        test('removing a group makes the tiles above fall down', async ({ page }) => {
            await page.locator('#btn-start').click();
            const top = await page.evaluate(() => {
                clearBoard();
                // Column 0: bottom two are the group (colour 1), one tile above (colour 2).
                board[ROWS - 1][0] = 1; board[ROWS - 2][0] = 1;
                board[ROWS - 3][0] = 2;
                // Give colour-1 group a partner in column 1 so it is >= 2 and removable.
                board[ROWS - 1][1] = 1;
                removeGroup(ROWS - 1, 0);
                return board[ROWS - 1][0];
            });
            expect(top).toBe(2); // the colour-2 tile fell to the floor
        });
    });

    // -----------------------------------------------------------------------
    // Game over & board clear
    // -----------------------------------------------------------------------
    test.describe('game over and clearing', () => {
        test('hasMoves is false when no two neighbours share a colour', async ({ page }) => {
            await page.locator('#btn-start').click();
            const moves = await page.evaluate(() => {
                clearBoard();
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++)
                        board[r][c] = (r + c) % 2; // checkerboard of 0/1 -> no orthogonal pair
                return hasMoves();
            });
            expect(moves).toBe(false);
        });

        test('running out of moves ends the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                clearBoard();
                // A removable pair plus an unmatchable leftover so the board is not cleared.
                board[ROWS - 1][0] = 1; board[ROWS - 1][1] = 1;
                board[ROWS - 1][5] = 2; // lone tile, no partner after the pair goes
                removeGroup(ROWS - 1, 0);
            });
            expect(await page.evaluate(() => state)).toBe('over');
        });

        test('game over overlay is shown', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame(false));
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('clearing the whole board awards the clear bonus', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                clearBoard();
                score = 0; updateHud();
                board[ROWS - 1][0] = 3; board[ROWS - 1][1] = 3; // the only tiles
                removeGroup(ROWS - 1, 0);
            });
            // scoreFor(2) + CLEAR_BONUS = 2 + 1000
            await expect(page.locator('#score')).toHaveText('1002');
            await expect(page.locator('#overlay-title')).toContainText('Cleared');
        });
    });

    // -----------------------------------------------------------------------
    // Best score & restart
    // -----------------------------------------------------------------------
    test.describe('best score and restart', () => {
        test('Play Again button is shown after game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame(false));
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('best score updates on game over when higher', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 260; updateHud(); endGame(false); });
            await expect(page.locator('#best')).toHaveText('260');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 175; updateHud(); endGame(false); });
            const stored = await page.evaluate(() => localStorage.getItem('samegame-best'));
            expect(parseInt(stored)).toBe(175);
        });

        test('restarting after game over resets the score', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 300; updateHud(); endGame(false); });
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#score')).toHaveText('0');
        });
    });
});
