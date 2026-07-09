const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Replace the live board with a deterministic layout: mines at the given
// [col, row] coordinates, adjacency recomputed, and mine placement "locked" so
// the next reveal does not scatter fresh random mines.
async function setBoard(page, mines) {
    await page.evaluate((mineList) => {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const cell = board[r][c];
                cell.mine = false;
                cell.revealed = false;
                cell.flagged = false;
            }
        }
        for (const [c, r] of mineList) board[r][c].mine = true;
        computeAdjacency();
        minesPlaced = true;
        renderHud();
    }, mines);
}

test.describe('Minesweeper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Minesweeper', async ({ page }) => {
            await expect(page).toHaveTitle('Minesweeper');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('start');
        });

        test('mine counter shows the total mine count', async ({ page }) => {
            await expect(page.locator('#mines')).toHaveText('10');
        });

        test('best time shows a placeholder when none is stored', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('canvas is 360×360', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '360');
            await expect(canvas).toHaveAttribute('height', '360');
        });

        test('board is a 9×9 grid with 10 mines', async ({ page }) => {
            const dims = await page.evaluate(() => ({ cols: COLS, rows: ROWS, mines: MINES }));
            expect(dims).toEqual({ cols: 9, rows: 9, mines: 10 });
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting a game', () => {
        test('a key dismisses the overlay and starts running', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('the Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the board is fully covered at the start', async ({ page }) => {
            await page.keyboard.press('Enter');
            const anyRevealed = await page.evaluate(() =>
                board.some(row => row.some(cell => cell.revealed)));
            expect(anyRevealed).toBe(false);
        });

        test('mines are not placed until the first reveal', async ({ page }) => {
            await page.keyboard.press('Enter');
            const placed = await page.evaluate(() => minesPlaced);
            expect(placed).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // First-click safety
    // -----------------------------------------------------------------------
    test.describe('first-click safety', () => {
        test('the first revealed cell is never a mine', async ({ page }) => {
            await page.keyboard.press('Enter');
            // Try several fresh games; the first reveal must always be safe.
            for (let i = 0; i < 20; i++) {
                const safe = await page.evaluate(() => {
                    startGame();
                    reveal(4, 4);
                    return board[4][4].mine === false && state !== 'lost';
                });
                expect(safe).toBe(true);
            }
        });

        test('exactly 10 mines are placed after the first reveal', async ({ page }) => {
            await page.keyboard.press('Enter');
            const count = await page.evaluate(() => {
                reveal(4, 4);
                return board.flat().filter(cell => cell.mine).length;
            });
            expect(count).toBe(10);
        });

        test('placement is locked after the first reveal', async ({ page }) => {
            await page.keyboard.press('Enter');
            const placed = await page.evaluate(() => {
                reveal(4, 4);
                return minesPlaced;
            });
            expect(placed).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Revealing cells
    // -----------------------------------------------------------------------
    test.describe('revealing cells', () => {
        test('revealing a numbered cell shows its adjacent-mine count', async ({ page }) => {
            await page.keyboard.press('Enter');
            await setBoard(page, [[0, 0]]); // single mine, top-left
            const result = await page.evaluate(() => {
                reveal(1, 1); // diagonally adjacent to the mine
                return { revealed: board[1][1].revealed, adjacent: board[1][1].adjacent };
            });
            expect(result.revealed).toBe(true);
            expect(result.adjacent).toBe(1);
        });

        test('a numbered cell does not cascade to the rest of the board', async ({ page }) => {
            await page.keyboard.press('Enter');
            await setBoard(page, [[0, 0]]);
            const farRevealed = await page.evaluate(() => {
                reveal(1, 1);
                return board[8][8].revealed;
            });
            expect(farRevealed).toBe(false);
        });

        test('revealing an empty cell flood-fills neighbours', async ({ page }) => {
            await page.keyboard.press('Enter');
            await setBoard(page, [[0, 0]]);
            const count = await page.evaluate(() => {
                reveal(8, 8); // far from the mine, adjacent count 0
                return board.flat().filter(cell => cell.revealed).length;
            });
            expect(count).toBeGreaterThan(1);
        });

        test('revealing a mine loses the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await setBoard(page, [[3, 3]]);
            const s = await page.evaluate(() => {
                reveal(3, 3);
                return state;
            });
            expect(s).toBe('lost');
        });

        test('a flagged cell cannot be revealed', async ({ page }) => {
            await page.keyboard.press('Enter');
            await setBoard(page, [[0, 0]]);
            const revealed = await page.evaluate(() => {
                toggleFlag(5, 5);
                reveal(5, 5);
                return board[5][5].revealed;
            });
            expect(revealed).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Flagging
    // -----------------------------------------------------------------------
    test.describe('flagging', () => {
        test('toggling a flag marks the cell', async ({ page }) => {
            await page.keyboard.press('Enter');
            const flagged = await page.evaluate(() => {
                toggleFlag(2, 2);
                return board[2][2].flagged;
            });
            expect(flagged).toBe(true);
        });

        test('flagging decrements the mine counter', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.evaluate(() => toggleFlag(2, 2));
            await expect(page.locator('#mines')).toHaveText('9');
        });

        test('un-flagging restores the mine counter', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.evaluate(() => { toggleFlag(2, 2); toggleFlag(2, 2); });
            await expect(page.locator('#mines')).toHaveText('10');
        });

        test('a revealed cell cannot be flagged', async ({ page }) => {
            await page.keyboard.press('Enter');
            await setBoard(page, [[0, 0]]);
            const flagged = await page.evaluate(() => {
                reveal(4, 4);
                toggleFlag(4, 4);
                return board[4][4].flagged;
            });
            expect(flagged).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('revealing every safe cell wins the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await setBoard(page, [[0, 0]]);
            const s = await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) {
                        if (!board[r][c].mine) reveal(c, r);
                    }
                }
                return state;
            });
            expect(s).toBe('won');
        });

        test('the win overlay is shown', async ({ page }) => {
            await page.keyboard.press('Enter');
            await setBoard(page, [[0, 0]]);
            await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++)
                        if (!board[r][c].mine) reveal(c, r);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('You Win');
        });

        test('a best time is recorded and persisted on a win', async ({ page }) => {
            await page.keyboard.press('Enter');
            await setBoard(page, [[0, 0]]);
            await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++)
                        if (!board[r][c].mine) reveal(c, r);
            });
            await expect(page.locator('#best')).not.toHaveText('—');
            const stored = await page.evaluate(() => localStorage.getItem('minesweeper-best'));
            expect(stored).not.toBeNull();
            expect(parseInt(stored)).toBeGreaterThanOrEqual(0);
        });
    });

    // -----------------------------------------------------------------------
    // Losing and restarting
    // -----------------------------------------------------------------------
    test.describe('losing and restarting', () => {
        test('the game-over overlay is shown on a loss', async ({ page }) => {
            await page.keyboard.press('Enter');
            await setBoard(page, [[3, 3]]);
            await page.evaluate(() => reveal(3, 3));
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('all mines are exposed on a loss', async ({ page }) => {
            await page.keyboard.press('Enter');
            await setBoard(page, [[3, 3], [5, 5], [7, 1]]);
            const allShown = await page.evaluate(() => {
                reveal(3, 3);
                return board.flat().filter(c => c.mine).every(c => c.revealed);
            });
            expect(allShown).toBe(true);
        });

        test('Play Again button appears after the game ends', async ({ page }) => {
            await page.keyboard.press('Enter');
            await setBoard(page, [[3, 3]]);
            await page.evaluate(() => reveal(3, 3));
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting after a loss resets the board and counter', async ({ page }) => {
            await page.keyboard.press('Enter');
            await setBoard(page, [[3, 3]]);
            await page.evaluate(() => reveal(3, 3));
            await page.keyboard.press('Enter'); // restart
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#mines')).toHaveText('10');
            const clean = await page.evaluate(() =>
                board.every(row => row.every(cell => !cell.revealed && !cell.flagged)));
            expect(clean).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Mouse input
    // -----------------------------------------------------------------------
    test.describe('mouse input', () => {
        test('left-clicking a cell reveals it', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.locator('#canvas').click({ position: { x: 4 * 40 + 20, y: 4 * 40 + 20 } });
            const revealed = await page.evaluate(() => board[4][4].revealed);
            expect(revealed).toBe(true);
        });

        test('right-clicking a cell flags it', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.locator('#canvas').click({
                button: 'right',
                position: { x: 2 * 40 + 20, y: 2 * 40 + 20 },
            });
            const flagged = await page.evaluate(() => board[2][2].flagged);
            expect(flagged).toBe(true);
        });
    });
});
