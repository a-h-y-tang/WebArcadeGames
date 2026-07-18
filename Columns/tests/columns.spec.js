const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Wipe the board and detach the active piece so a test can build an exact
// board state. Mirrors the direct-manipulation seam the other games use.
async function clearBoard(page) {
    await page.evaluate(() => {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) board[r][c] = null;
        }
        piece = null;
    });
}

test.describe('Columns', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Columns', async ({ page }) => {
            await expect(page).toHaveTitle('Columns');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to press a key', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 240×560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '240');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('state is idle before starting', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });

        test('board is ROWS×COLS and empty', async ({ page }) => {
            const info = await page.evaluate(() => {
                let allNull = true;
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) if (board[r][c] !== null) allNull = false;
                }
                return { rows: board.length, cols: board[0].length, ROWS, COLS, allNull };
            });
            expect(info.rows).toBe(info.ROWS);
            expect(info.cols).toBe(info.COLS);
            expect(info.allNull).toBe(true);
        });

        test('no active piece at idle', async ({ page }) => {
            const p = await page.evaluate(() => piece);
            expect(p).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('arrow key dismisses overlay', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state is running after start', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('a group spawns at the top centre column with three colours', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => ({
                col: piece.col,
                row: piece.row,
                spawn: SPAWN_COL,
                len: piece.cells.length,
                inRange: piece.cells.every(c => c >= 0 && c < NUM_COLORS),
            }));
            expect(info.col).toBe(info.spawn);
            expect(info.row).toBe(0);
            expect(info.len).toBe(3);
            expect(info.inRange).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Moving the group
    // -----------------------------------------------------------------------
    test.describe('moving the group', () => {
        test('ArrowRight moves the group right', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { piece.col = 2; piece.row = 4; });
            await page.keyboard.press('ArrowRight');
            const col = await page.evaluate(() => piece.col);
            expect(col).toBe(3);
        });

        test('ArrowLeft moves the group left', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { piece.col = 2; piece.row = 4; });
            await page.keyboard.press('ArrowLeft');
            const col = await page.evaluate(() => piece.col);
            expect(col).toBe(1);
        });

        test('the group cannot move past the left wall', async ({ page }) => {
            await page.keyboard.press('Space');
            const col = await page.evaluate(() => {
                piece.col = 0;
                piece.row = 4;
                const ok = movePiece(-1);
                return { col: piece.col, ok };
            });
            expect(col.col).toBe(0);
            expect(col.ok).toBe(false);
        });

        test('the group cannot move past the right wall', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                piece.col = COLS - 1;
                piece.row = 4;
                const ok = movePiece(1);
                return { col: piece.col, ok, max: COLS - 1 };
            });
            expect(res.col).toBe(res.max);
            expect(res.ok).toBe(false);
        });

        test('the group cannot move into a filled cell', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            const res = await page.evaluate(() => {
                piece = { col: 3, row: 5, cells: [0, 1, 2] };
                board[6][2] = 4; // block the middle of the destination column
                const ok = movePiece(-1);
                return { col: piece.col, ok };
            });
            expect(res.col).toBe(3);
            expect(res.ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Cycling colours
    // -----------------------------------------------------------------------
    test.describe('cycling colours', () => {
        test('cycle moves the bottom colour to the top', async ({ page }) => {
            await page.keyboard.press('Space');
            const cells = await page.evaluate(() => {
                piece.cells = [1, 2, 3];
                cyclePiece();
                return piece.cells.slice();
            });
            expect(cells).toEqual([3, 1, 2]);
        });

        test('ArrowUp cycles the group', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { piece.cells = [1, 2, 3]; });
            await page.keyboard.press('ArrowUp');
            const cells = await page.evaluate(() => piece.cells.slice());
            expect(cells).toEqual([3, 1, 2]);
        });

        test('cycling three times returns to the original order', async ({ page }) => {
            await page.keyboard.press('Space');
            const cells = await page.evaluate(() => {
                piece.cells = [1, 2, 3];
                cyclePiece();
                cyclePiece();
                cyclePiece();
                return piece.cells.slice();
            });
            expect(cells).toEqual([1, 2, 3]);
        });
    });

    // -----------------------------------------------------------------------
    // Dropping & gravity
    // -----------------------------------------------------------------------
    test.describe('dropping and gravity', () => {
        test('soft drop moves the group down one cell', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            const res = await page.evaluate(() => {
                piece = { col: 3, row: 5, cells: [0, 1, 2] };
                const ok = softDrop();
                return { row: piece.row, ok };
            });
            expect(res.row).toBe(6);
            expect(res.ok).toBe(true);
        });

        test('ArrowDown soft-drops the group', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            await page.evaluate(() => { piece = { col: 3, row: 5, cells: [0, 1, 2] }; });
            await page.keyboard.press('ArrowDown');
            const row = await page.evaluate(() => piece.row);
            expect(row).toBe(6);
        });

        test('a grounded group does not soft-drop through the floor', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            const res = await page.evaluate(() => {
                piece = { col: 3, row: ROWS - 3, cells: [0, 1, 2] }; // bottom cell on the floor
                const ok = softDrop();
                return { row: piece.row, ok, floorTop: ROWS - 3 };
            });
            expect(res.row).toBe(res.floorTop);
            expect(res.ok).toBe(false);
        });

        test('gravity locks a grounded group into the board', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            const res = await page.evaluate(() => {
                piece = { col: 3, row: ROWS - 3, cells: [1, 2, 3] };
                gravityDrop();
                return {
                    a: board[ROWS - 3][3],
                    b: board[ROWS - 2][3],
                    c: board[ROWS - 1][3],
                    newRow: piece ? piece.row : null,
                };
            });
            expect(res.a).toBe(1);
            expect(res.b).toBe(2);
            expect(res.c).toBe(3);
            expect(res.newRow).toBe(0); // a fresh group entered at the top
        });

        test('gravity moves a floating group down instead of locking', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            const res = await page.evaluate(() => {
                piece = { col: 3, row: 4, cells: [1, 2, 3] };
                gravityDrop();
                return { row: piece.row };
            });
            expect(res.row).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Matching
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('a horizontal run of three is found', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            const n = await page.evaluate(() => {
                board[ROWS - 1][0] = 2;
                board[ROWS - 1][1] = 2;
                board[ROWS - 1][2] = 2;
                return findMatches().length;
            });
            expect(n).toBe(3);
        });

        test('a vertical run of three is found', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            const n = await page.evaluate(() => {
                board[ROWS - 3][0] = 1;
                board[ROWS - 2][0] = 1;
                board[ROWS - 1][0] = 1;
                return findMatches().length;
            });
            expect(n).toBe(3);
        });

        test('a diagonal run of three is found', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            const n = await page.evaluate(() => {
                board[ROWS - 1][0] = 5;
                board[ROWS - 2][1] = 5;
                board[ROWS - 3][2] = 5;
                return findMatches().length;
            });
            expect(n).toBe(3);
        });

        test('two in a row is not a match', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            const n = await page.evaluate(() => {
                board[ROWS - 1][0] = 2;
                board[ROWS - 1][1] = 2;
                return findMatches().length;
            });
            expect(n).toBe(0);
        });

        test('resolving clears a match and adds to the score', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            const res = await page.evaluate(() => {
                score = 0;
                board[ROWS - 1][0] = 2;
                board[ROWS - 1][1] = 2;
                board[ROWS - 1][2] = 2;
                const cleared = resolveBoard();
                return {
                    cleared,
                    score,
                    a: board[ROWS - 1][0],
                    b: board[ROWS - 1][1],
                    c: board[ROWS - 1][2],
                };
            });
            expect(res.cleared).toBe(3);
            expect(res.score).toBeGreaterThan(0);
            expect(res.a).toBeNull();
            expect(res.b).toBeNull();
            expect(res.c).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Collapse & cascades
    // -----------------------------------------------------------------------
    test.describe('collapse and cascades', () => {
        test('a floating jewel collapses to the bottom', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            const res = await page.evaluate(() => {
                board[ROWS - 4][0] = 3; // floating, nothing beneath
                collapse();
                return { top: board[ROWS - 4][0], bottom: board[ROWS - 1][0] };
            });
            expect(res.top).toBeNull();
            expect(res.bottom).toBe(3);
        });

        test('collapse preserves vertical order within a column', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            const res = await page.evaluate(() => {
                board[5][0] = 1;  // upper
                board[9][0] = 2;  // lower
                collapse();
                return { bottom: board[ROWS - 1][0], above: board[ROWS - 2][0] };
            });
            expect(res.bottom).toBe(2);  // the lower jewel stays lower
            expect(res.above).toBe(1);
        });

        test('a cascade clears a second match formed after collapse', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            const res = await page.evaluate(() => {
                score = 0;
                const R = 0, C = 1;
                // Bottom row has R at col 0 and col 2, with a gap (col 1) between.
                board[ROWS - 1][0] = R;
                board[ROWS - 1][2] = R;
                // A vertical C-triple fills col 1's bottom three rows...
                board[ROWS - 1][1] = C;
                board[ROWS - 2][1] = C;
                board[ROWS - 3][1] = C;
                // ...with an R sitting just above it. When the C-triple clears,
                // this R drops to the bottom of col 1 and completes R-R-R.
                board[ROWS - 4][1] = R;
                const cleared = resolveBoard();
                return { cleared, score };
            });
            // 3 (the C column) + 3 (the R row formed by the cascade) = 6.
            expect(res.cleared).toBe(6);
            // Chain scoring: 3×10×1 + 3×10×2 = 90.
            expect(res.score).toBe(90);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing enough jewels raises the level', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                cleared = JEWELS_PER_LEVEL; // pretend a level's worth has cleared
                updateLevel();
                return { level, shown: levelEl.textContent };
            });
            expect(res.level).toBe(2);
            expect(res.shown).toBe('2');
        });

        test('a higher level falls faster', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => ({
                slow: dropIntervalFor(1),
                fast: dropIntervalFor(5),
            }));
            expect(res.fast).toBeLessThan(res.slow);
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const s = await page.evaluate(() => state);
            expect(s).toBe('paused');
        });

        test('pause overlay shows "Paused"', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('gravity does nothing while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearBoard(page);
            await page.evaluate(() => { piece = { col: 3, row: 4, cells: [1, 2, 3] }; });
            await page.keyboard.press('p');
            const res = await page.evaluate(() => {
                gravityDrop();
                return { row: piece.row };
            });
            expect(res.row).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('spawning into a filled centre column ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                board[0][SPAWN_COL] = 0; // block the entrance
                spawnPiece();
                return state;
            });
            expect(s).toBe('over');
        });

        test('game over overlay is shown', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('game over score shows points', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay-score')).toContainText('pts');
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets score, level and board', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 500;
                level = 4;
                board[ROWS - 1][0] = 2;
                scoreEl.textContent = score;
                endGame();
            });
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                let filled = 0;
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) if (board[r][c] !== null) filled++;
                }
                return { score, level, filled };
            });
            expect(res.score).toBe(0);
            expect(res.level).toBe(1);
            expect(res.filled).toBe(0);
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score updates on game over if higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 200;
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent());
            expect(best).toBeGreaterThanOrEqual(200);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 321;
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('columns-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(321);
        });
    });
});
