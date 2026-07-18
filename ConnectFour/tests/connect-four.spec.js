const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Connect Four', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.removeItem('connect-four-score'); } catch (e) {}
        });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Connect Four', async ({ page }) => {
            await expect(page).toHaveTitle('Connect Four');
        });

        test('canvas has the documented dimensions', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('the board is 6 rows by 7 columns and empty', async ({ page }) => {
            const info = await page.evaluate(() => ({
                rows: board.length,
                cols: board[0].length,
                empty: board.every(r => r.every(c => c === 0)),
            }));
            expect(info.rows).toBe(6);
            expect(info.cols).toBe(7);
            expect(info.empty).toBe(true);
        });

        test('Red moves first', async ({ page }) => {
            const p = await page.evaluate(() => currentPlayer);
            expect(p).toBe(1);
        });

        test('state is playing and there is no winner', async ({ page }) => {
            const s = await page.evaluate(() => ({ state, winner }));
            expect(s.state).toBe('playing');
            expect(s.winner).toBe(0);
        });

        test('the status line names Red', async ({ page }) => {
            await expect(page.locator('#status')).toContainText(/Red/i);
        });

        test('the score counters start at 0', async ({ page }) => {
            await expect(page.locator('#red-wins')).toHaveText('0');
            await expect(page.locator('#yellow-wins')).toHaveText('0');
            await expect(page.locator('#draws')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Dropping discs (gravity + turns)
    // -----------------------------------------------------------------------
    test.describe('dropping discs', () => {
        test('a dropped disc falls to the bottom row', async ({ page }) => {
            const res = await page.evaluate(() => {
                const row = dropDisc(3);
                return { row, cell: board[5][3] };
            });
            expect(res.row).toBe(5);
            expect(res.cell).toBe(1);
        });

        test('a second disc in the same column stacks on top', async ({ page }) => {
            const res = await page.evaluate(() => {
                dropDisc(3);        // red at row 5
                const row = dropDisc(3); // yellow at row 4
                return { row, cell: board[4][3] };
            });
            expect(res.row).toBe(4);
            expect(res.cell).toBe(2);
        });

        test('the turn alternates after a move', async ({ page }) => {
            const res = await page.evaluate(() => {
                const p0 = currentPlayer;
                dropDisc(0);
                const p1 = currentPlayer;
                dropDisc(1);
                const p2 = currentPlayer;
                return { p0, p1, p2 };
            });
            expect(res.p0).toBe(1);
            expect(res.p1).toBe(2);
            expect(res.p2).toBe(1);
        });

        test('dropping into a full column is rejected', async ({ page }) => {
            const res = await page.evaluate(() => {
                for (let i = 0; i < 6; i++) dropDisc(2); // fill column 2
                const full = isColumnFull(2);
                const row = dropDisc(2);
                return { full, row };
            });
            expect(res.full).toBe(true);
            expect(res.row).toBe(-1);
        });

        test('legalColumns lists only non-full columns', async ({ page }) => {
            const cols = await page.evaluate(() => {
                for (let i = 0; i < 6; i++) dropDisc(4); // fill column 4
                return legalColumns();
            });
            expect(cols).not.toContain(4);
            expect(cols).toEqual([0, 1, 2, 3, 5, 6]);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('four in a horizontal row wins', async ({ page }) => {
            const res = await page.evaluate(() => {
                setCell(5, 0, 1); setCell(5, 1, 1); setCell(5, 2, 1);
                currentPlayer = 1;
                dropDisc(3); // completes 0-1-2-3 on the bottom row
                return { winner, state };
            });
            expect(res.winner).toBe(1);
            expect(res.state).toBe('over');
        });

        test('four in a vertical column wins', async ({ page }) => {
            const res = await page.evaluate(() => {
                setCell(5, 6, 2); setCell(4, 6, 2); setCell(3, 6, 2);
                currentPlayer = 2;
                dropDisc(6); // stacks a fourth yellow in column 6
                return { winner, state };
            });
            expect(res.winner).toBe(2);
            expect(res.state).toBe('over');
        });

        test('four on a diagonal wins', async ({ page }) => {
            const res = await page.evaluate(() => {
                // Build an ascending diagonal for red: (5,0),(4,1),(3,2),(2,3)
                setCell(5, 0, 1);
                setCell(5, 1, 2); setCell(4, 1, 1);
                setCell(5, 2, 2); setCell(4, 2, 2); setCell(3, 2, 1);
                setCell(5, 3, 2); setCell(4, 3, 2); setCell(3, 3, 2);
                currentPlayer = 1;
                dropDisc(3); // lands at (2,3) completing the diagonal
                return { winner, state, cell: board[2][3] };
            });
            expect(res.cell).toBe(1);
            expect(res.winner).toBe(1);
            expect(res.state).toBe('over');
        });

        test('the winner is announced in the status line', async ({ page }) => {
            await page.evaluate(() => {
                setCell(5, 0, 1); setCell(5, 1, 1); setCell(5, 2, 1);
                currentPlayer = 1;
                dropDisc(3);
            });
            await expect(page.locator('#status')).toContainText(/Red wins/i);
        });

        test('the winning side\'s score counter increments', async ({ page }) => {
            await page.evaluate(() => {
                setCell(5, 0, 1); setCell(5, 1, 1); setCell(5, 2, 1);
                currentPlayer = 1;
                dropDisc(3);
            });
            await expect(page.locator('#red-wins')).toHaveText('1');
        });

        test('no further moves are accepted after the game is over', async ({ page }) => {
            const res = await page.evaluate(() => {
                setCell(5, 0, 1); setCell(5, 1, 1); setCell(5, 2, 1);
                currentPlayer = 1;
                dropDisc(3);            // red wins
                const row = dropDisc(4); // should be rejected
                return { row, cell: board[5][4] };
            });
            expect(res.row).toBe(-1);
            expect(res.cell).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Draw
    // -----------------------------------------------------------------------
    test.describe('draw', () => {
        test('a full board with no line is a draw', async ({ page }) => {
            const res = await page.evaluate(() => {
                const full = [
                    [1, 1, 2, 1, 1, 2, 1],
                    [2, 1, 1, 2, 1, 1, 1],
                    [1, 2, 1, 1, 2, 1, 2],
                    [2, 1, 1, 2, 2, 1, 2],
                    [2, 2, 2, 1, 2, 2, 1],
                    [1, 1, 2, 1, 1, 2, 2],
                ];
                for (let r = 0; r < 6; r++)
                    for (let c = 0; c < 7; c++)
                        setCell(r, c, full[r][c]);
                setCell(0, 0, 0); // reopen the top of column 0
                currentPlayer = 1; // its original owner
                dropDisc(0);       // drops the last disc, filling the board
                return { winner, state };
            });
            expect(res.winner).toBe('draw');
            expect(res.state).toBe('over');
        });

        test('a draw is announced in the status line', async ({ page }) => {
            await page.evaluate(() => {
                const full = [
                    [1, 1, 2, 1, 1, 2, 1],
                    [2, 1, 1, 2, 1, 1, 1],
                    [1, 2, 1, 1, 2, 1, 2],
                    [2, 1, 1, 2, 2, 1, 2],
                    [2, 2, 2, 1, 2, 2, 1],
                    [1, 1, 2, 1, 1, 2, 2],
                ];
                for (let r = 0; r < 6; r++)
                    for (let c = 0; c < 7; c++)
                        setCell(r, c, full[r][c]);
                setCell(0, 0, 0);
                currentPlayer = 1;
                dropDisc(0);
            });
            await expect(page.locator('#status')).toContainText(/Draw/i);
            await expect(page.locator('#draws')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // The Yellow AI
    // -----------------------------------------------------------------------
    test.describe('AI', () => {
        test('prefers the centre column on an empty board', async ({ page }) => {
            const c = await page.evaluate(() => aiChooseColumn());
            expect(c).toBe(3);
        });

        test('takes an immediate winning move', async ({ page }) => {
            const res = await page.evaluate(() => {
                setCell(5, 6, 2); setCell(4, 6, 2); setCell(3, 6, 2);
                currentPlayer = 2;
                const chosen = aiChooseColumn();
                aiMove();
                return { chosen, winner };
            });
            expect(res.chosen).toBe(6);
            expect(res.winner).toBe(2);
        });

        test('blocks the opponent\'s immediate winning move', async ({ page }) => {
            const chosen = await page.evaluate(() => {
                setCell(5, 0, 1); setCell(4, 0, 1); setCell(3, 0, 1);
                currentPlayer = 2;
                return aiChooseColumn();
            });
            expect(chosen).toBe(0);
        });

        test('prefers winning over blocking', async ({ page }) => {
            const res = await page.evaluate(() => {
                // Yellow can win in column 6 (vertical); Red threatens column 0.
                setCell(5, 6, 2); setCell(4, 6, 2); setCell(3, 6, 2);
                setCell(5, 0, 1); setCell(4, 0, 1); setCell(3, 0, 1);
                currentPlayer = 2;
                return { chosen: aiChooseColumn() };
            });
            expect(res.chosen).toBe(6);
        });

        test('aiMove does nothing when it is not Yellow\'s turn', async ({ page }) => {
            const res = await page.evaluate(() => {
                currentPlayer = 1;
                aiMove();
                return { empty: board.every(r => r.every(c => c === 0)), player: currentPlayer };
            });
            expect(res.empty).toBe(true);
            expect(res.player).toBe(1);
        });

        test('aiMove does nothing once the game is over', async ({ page }) => {
            const res = await page.evaluate(() => {
                setCell(5, 0, 1); setCell(5, 1, 1); setCell(5, 2, 1);
                currentPlayer = 1;
                dropDisc(3); // red wins, state over
                const before = JSON.stringify(board);
                currentPlayer = 2;
                aiMove();
                return { unchanged: JSON.stringify(board) === before };
            });
            expect(res.unchanged).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Human input drives a full turn (human move + AI reply)
    // -----------------------------------------------------------------------
    test.describe('input', () => {
        test('clicking a column drops a red disc and the AI replies', async ({ page }) => {
            const canvas = page.locator('#canvas');
            // Column 3 centre is x = 3*80 + 40 = 280.
            await canvas.click({ position: { x: 280, y: 240 } });
            await page.waitForFunction(() => currentPlayer === 1
                && board.flat().filter(v => v === 2).length === 1);
            const res = await page.evaluate(() => ({
                red: board.flat().filter(v => v === 1).length,
                yellow: board.flat().filter(v => v === 2).length,
                redInCol3: board[5][3],
            }));
            expect(res.red).toBe(1);
            expect(res.yellow).toBe(1);
            expect(res.redInCol3).toBe(1);
        });

        test('number keys 1-7 drop into the matching column', async ({ page }) => {
            await page.keyboard.press('1');
            await page.waitForFunction(() => currentPlayer === 1
                && board.flat().filter(v => v === 2).length === 1);
            const cell = await page.evaluate(() => board[5][0]);
            expect(cell).toBe(1);
        });

        test('the human cannot move while it is the AI\'s turn', async ({ page }) => {
            const res = await page.evaluate(() => {
                // Force it to be Yellow's turn, then try a human drop.
                currentPlayer = 2;
                handleHumanDrop(1);
                return { player: currentPlayer, cell: board[5][1] };
            });
            expect(res.cell).toBe(0);
            expect(res.player).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Reset
    // -----------------------------------------------------------------------
    test.describe('reset', () => {
        test('pressing R starts a fresh game', async ({ page }) => {
            await page.evaluate(() => {
                dropDisc(0); dropDisc(1); dropDisc(2);
            });
            await page.keyboard.press('r');
            const res = await page.evaluate(() => ({
                empty: board.every(r => r.every(c => c === 0)),
                player: currentPlayer,
                state,
                winner,
            }));
            expect(res.empty).toBe(true);
            expect(res.player).toBe(1);
            expect(res.state).toBe('playing');
            expect(res.winner).toBe(0);
        });

        test('the New Game button resets the board', async ({ page }) => {
            await page.evaluate(() => { dropDisc(0); });
            await page.locator('#btn-new').click();
            const empty = await page.evaluate(() => board.every(r => r.every(c => c === 0)));
            expect(empty).toBe(true);
        });

        test('resetting keeps the match score', async ({ page }) => {
            await page.evaluate(() => {
                setCell(5, 0, 1); setCell(5, 1, 1); setCell(5, 2, 1);
                currentPlayer = 1;
                dropDisc(3); // red wins → red score 1
            });
            await page.keyboard.press('r');
            await expect(page.locator('#red-wins')).toHaveText('1');
        });
    });
});
