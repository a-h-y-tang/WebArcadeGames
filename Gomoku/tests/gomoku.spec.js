const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Gomoku', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Gomoku', async ({ page }) => {
            await expect(page).toHaveTitle(/Gomoku/);
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('start');
        });

        test('canvas is 540×540', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '540');
            await expect(canvas).toHaveAttribute('height', '540');
        });

        test('the board is 15×15', async ({ page }) => {
            const n = await page.evaluate(() => BOARD_SIZE);
            expect(n).toBe(15);
        });

        test('the board starts empty', async ({ page }) => {
            const filled = await page.evaluate(() =>
                board.flat().filter((v) => v !== 0).length);
            expect(filled).toBe(0);
        });

        test('move count starts at 0', async ({ page }) => {
            const n = await page.evaluate(() => moveCount);
            expect(n).toBe(0);
        });

        test('state is idle before starting', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });

        test('wins counter starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#wins')).toHaveText('0');
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

        test('state is playing after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => state);
            expect(s).toBe('playing');
        });

        test('Black (the human) moves first', async ({ page }) => {
            await page.locator('#btn-start').click();
            const p = await page.evaluate(() => currentPlayer);
            expect(p).toBe(1);
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            const s = await page.evaluate(() => state);
            expect(s).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // Placing stones
    // -----------------------------------------------------------------------
    test.describe('placing stones', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('placeStone puts a Black stone on the board', async ({ page }) => {
            const r = await page.evaluate(() => {
                const ok = placeStone(7, 7);
                return { ok, cell: board[7][7], moves: moveCount };
            });
            expect(r.ok).toBe(true);
            expect(r.cell).toBe(1);
            expect(r.moves).toBe(1);
        });

        test('the turn passes to White after a Black move', async ({ page }) => {
            const p = await page.evaluate(() => { placeStone(7, 7); return currentPlayer; });
            expect(p).toBe(2);
        });

        test('turns alternate between the two players', async ({ page }) => {
            const seq = await page.evaluate(() => {
                const out = [];
                placeStone(0, 0); out.push(board[0][0]); // Black
                placeStone(1, 1); out.push(board[1][1]); // White
                placeStone(0, 1); out.push(board[0][1]); // Black
                return out;
            });
            expect(seq).toEqual([1, 2, 1]);
        });

        test('placing on an occupied cell is rejected', async ({ page }) => {
            const r = await page.evaluate(() => {
                placeStone(7, 7);           // Black
                const before = { cell: board[7][7], moves: moveCount, player: currentPlayer };
                const ok = placeStone(7, 7); // White tries the same cell
                return { ok, before, after: { cell: board[7][7], moves: moveCount, player: currentPlayer } };
            });
            expect(r.ok).toBe(false);
            expect(r.after).toEqual(r.before);
        });

        test('placing off the board is rejected', async ({ page }) => {
            const r = await page.evaluate(() => ({
                neg: placeStone(-1, 5),
                over: placeStone(15, 0),
                moves: moveCount,
            }));
            expect(r.neg).toBe(false);
            expect(r.over).toBe(false);
            expect(r.moves).toBe(0);
        });

        test('clicking the board places a Black stone at the nearest intersection', async ({ page }) => {
            // Centre intersection (7,7) sits at MARGIN + 7*CELL = 32 + 238 = 270.
            await page.locator('#canvas').click({ position: { x: 270, y: 270 } });
            const cell = await page.evaluate(() => board[7][7]);
            expect(cell).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Win detection
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('checkWin detects a horizontal five', async ({ page }) => {
            const win = await page.evaluate(() => {
                for (let c = 0; c < 5; c++) board[3][c] = 1;
                return checkWin(3, 4, 1);
            });
            expect(win).toBe(true);
        });

        test('checkWin detects a vertical five', async ({ page }) => {
            const win = await page.evaluate(() => {
                for (let r = 2; r < 7; r++) board[r][8] = 2;
                return checkWin(4, 8, 2);
            });
            expect(win).toBe(true);
        });

        test('checkWin detects a diagonal five', async ({ page }) => {
            const win = await page.evaluate(() => {
                for (let i = 0; i < 5; i++) board[5 + i][5 + i] = 1;
                return checkWin(7, 7, 1);
            });
            expect(win).toBe(true);
        });

        test('four in a row is not a win', async ({ page }) => {
            const win = await page.evaluate(() => {
                for (let c = 0; c < 4; c++) board[3][c] = 1;
                return checkWin(3, 3, 1);
            });
            expect(win).toBe(false);
        });

        test('completing five ends the game with the right winner', async ({ page }) => {
            const r = await page.evaluate(() => {
                board[6][0] = 1; board[6][1] = 1; board[6][2] = 1; board[6][3] = 1;
                currentPlayer = 1;
                const ok = placeStone(6, 4); // Black completes the row
                return { ok, state, winner };
            });
            expect(r.ok).toBe(true);
            expect(r.state).toBe('over');
            expect(r.winner).toBe(1);
        });

        test('no further stones can be placed after the game is over', async ({ page }) => {
            const r = await page.evaluate(() => {
                board[6][0] = 1; board[6][1] = 1; board[6][2] = 1; board[6][3] = 1;
                currentPlayer = 1;
                placeStone(6, 4);            // win -> over
                const ok = placeStone(0, 0); // ignored
                return { ok, cell: board[0][0] };
            });
            expect(r.ok).toBe(false);
            expect(r.cell).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Draw
    // -----------------------------------------------------------------------
    test.describe('draw', () => {
        test('a full board with no five is a draw', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                // Fill every cell with White, leave (0,0) open, then drop a lone
                // Black there so its placement makes no five.
                for (let rr = 0; rr < BOARD_SIZE; rr++)
                    for (let cc = 0; cc < BOARD_SIZE; cc++) board[rr][cc] = 2;
                board[0][0] = 0;
                moveCount = BOARD_SIZE * BOARD_SIZE - 1;
                currentPlayer = 1;
                const ok = placeStone(0, 0);
                return { ok, state, winner };
            });
            expect(r.ok).toBe(true);
            expect(r.state).toBe('over');
            expect(r.winner).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // The AI opponent
    // -----------------------------------------------------------------------
    test.describe('AI opponent', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('aiMove places a White stone and returns the turn to Black', async ({ page }) => {
            const r = await page.evaluate(() => {
                placeStone(7, 7);                 // Black; now White to move
                const whitesBefore = board.flat().filter((v) => v === 2).length;
                aiMove();
                const whitesAfter = board.flat().filter((v) => v === 2).length;
                return { whitesBefore, whitesAfter, player: currentPlayer };
            });
            expect(r.whitesBefore).toBe(0);
            expect(r.whitesAfter).toBe(1);
            expect(r.player).toBe(1);             // back to Black
        });

        test('the AI completes its own five when it can', async ({ page }) => {
            const r = await page.evaluate(() => {
                board[9][1] = 2; board[9][2] = 2; board[9][3] = 2; board[9][4] = 2;
                currentPlayer = 2;                // White to move
                aiMove();
                return { state, winner, cell: board[9][0] === 2 || board[9][5] === 2 };
            });
            expect(r.cell).toBe(true);            // played the winning end
            expect(r.state).toBe('over');
            expect(r.winner).toBe(2);
        });

        test('the AI blocks an open Black four', async ({ page }) => {
            const blocked = await page.evaluate(() => {
                board[7][3] = 1; board[7][4] = 1; board[7][5] = 1; board[7][6] = 1;
                currentPlayer = 2;                // White to move; must block (7,2) or (7,7)
                aiMove();
                return board[7][2] === 2 || board[7][7] === 2;
            });
            expect(blocked).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // HUD, game over and restart
    // -----------------------------------------------------------------------
    test.describe('HUD and game over', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('the move counter updates in the DOM', async ({ page }) => {
            await page.evaluate(() => { placeStone(7, 7); });
            await expect(page.locator('#moves')).toHaveText('1');
        });

        test('the turn indicator reflects the current player', async ({ page }) => {
            await expect(page.locator('#turn')).toContainText(/black/i);
            await page.evaluate(() => { placeStone(7, 7); });
            await expect(page.locator('#turn')).toContainText(/white/i);
        });

        test('the game over overlay names the winner', async ({ page }) => {
            await page.evaluate(() => {
                board[6][0] = 1; board[6][1] = 1; board[6][2] = 1; board[6][3] = 1;
                currentPlayer = 1;
                placeStone(6, 4);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/black wins|you win/i);
        });

        test('a Play Again button is offered after the game ends', async ({ page }) => {
            await page.evaluate(() => {
                board[6][0] = 1; board[6][1] = 1; board[6][2] = 1; board[6][3] = 1;
                currentPlayer = 1;
                placeStone(6, 4);
            });
            await expect(page.locator('#btn-start')).toBeVisible();
        });

        test('restarting clears the board and resets state', async ({ page }) => {
            await page.evaluate(() => {
                placeStone(7, 7); placeStone(1, 1);
                board[6][0] = 1; board[6][1] = 1; board[6][2] = 1; board[6][3] = 1;
                currentPlayer = 1; placeStone(6, 4); // force game over
            });
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => ({
                filled: board.flat().filter((v) => v !== 0).length,
                moves: moveCount,
                state,
                player: currentPlayer,
            }));
            expect(r).toEqual({ filled: 0, moves: 0, state: 'playing', player: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Wins counter persistence
    // -----------------------------------------------------------------------
    test.describe('wins counter', () => {
        test('winning as Black increments the wins counter', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                board[6][0] = 1; board[6][1] = 1; board[6][2] = 1; board[6][3] = 1;
                currentPlayer = 1;
                placeStone(6, 4);
            });
            await expect(page.locator('#wins')).toHaveText('1');
        });

        test('the wins counter persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                board[6][0] = 1; board[6][1] = 1; board[6][2] = 1; board[6][3] = 1;
                currentPlayer = 1;
                placeStone(6, 4);
            });
            const stored = await page.evaluate(() => localStorage.getItem('gomoku.wins'));
            expect(Number(stored)).toBe(1);
        });

        test('losing to the AI does not increment the wins counter', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                board[9][0] = 2; board[9][1] = 2; board[9][2] = 2; board[9][3] = 2;
                currentPlayer = 2;
                placeStone(9, 4); // White (AI colour) completes five
            });
            await expect(page.locator('#wins')).toHaveText('0');
        });
    });
});
