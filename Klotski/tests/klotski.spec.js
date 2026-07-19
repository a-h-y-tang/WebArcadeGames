const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Klotski', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Klotski', async ({ page }) => {
            await expect(page).toHaveTitle('Klotski');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Click');
        });

        test('canvas is 400×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '400');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('grid is 4 wide × 5 tall', async ({ page }) => {
            const dims = await page.evaluate(() => ({ w: GRID_W, h: GRID_H }));
            expect(dims).toEqual({ w: 4, h: 5 });
        });

        test('there are 10 pieces', async ({ page }) => {
            const n = await page.evaluate(() => pieces.length);
            expect(n).toBe(10);
        });

        test('exactly one 2×2 block exists', async ({ page }) => {
            const n = await page.evaluate(
                () => pieces.filter(p => p.w === 2 && p.h === 2).length
            );
            expect(n).toBe(1);
        });

        test('the big block starts at (0,1)', async ({ page }) => {
            const p = await page.evaluate(() => {
                const b = pieceById('cao');
                return { r: b.r, c: b.c, w: b.w, h: b.h };
            });
            expect(p).toEqual({ r: 0, c: 1, w: 2, h: 2 });
        });

        test('exactly two cells are empty at the start', async ({ page }) => {
            const n = await page.evaluate(() => {
                let count = 0;
                for (let r = 0; r < GRID_H; r++)
                    for (let c = 0; c < GRID_W; c++)
                        if (isEmpty(r, c)) count++;
                return count;
            });
            expect(n).toBe(2);
        });

        test('the empty cells are (4,1) and (4,2)', async ({ page }) => {
            const res = await page.evaluate(() => ({
                a: isEmpty(4, 1), b: isEmpty(4, 2),
                filled: isEmpty(0, 0),
            }));
            expect(res).toEqual({ a: true, b: true, filled: false });
        });

        test('occupied cell count is 18', async ({ page }) => {
            const n = await page.evaluate(
                () => pieces.reduce((s, p) => s + p.w * p.h, 0)
            );
            expect(n).toBe(18);
        });

        test('move counter starts at 0', async ({ page }) => {
            await expect(page.locator('#moves')).toHaveText('0');
        });

        test('best shows a dash when there is no record', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('–');
        });

        test('the puzzle is not solved at the start', async ({ page }) => {
            const solved = await page.evaluate(() => isSolved());
            expect(solved).toBe(false);
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

        test('game state is playing after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => state);
            expect(s).toBe('playing');
        });

        test('a key press starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Geometry helpers
    // -----------------------------------------------------------------------
    test.describe('geometry', () => {
        test('pieceAt returns the big block for all four of its cells', async ({ page }) => {
            const ids = await page.evaluate(() => [
                pieceAt(0, 1).id, pieceAt(0, 2).id,
                pieceAt(1, 1).id, pieceAt(1, 2).id,
            ]);
            expect(ids).toEqual(['cao', 'cao', 'cao', 'cao']);
        });

        test('pieceAt is null on an empty cell', async ({ page }) => {
            const p = await page.evaluate(() => pieceAt(4, 1));
            expect(p).toBeNull();
        });

        test('pieceAt is null out of bounds', async ({ page }) => {
            const p = await page.evaluate(() => pieceAt(5, 0));
            expect(p).toBeNull();
        });

        test('cellsOf lists all four cells of the big block', async ({ page }) => {
            const cells = await page.evaluate(() => {
                return cellsOf(pieceById('cao'))
                    .map(x => `${x.r},${x.c}`)
                    .sort();
            });
            expect(cells).toEqual(['0,1', '0,2', '1,1', '1,2']);
        });
    });

    // -----------------------------------------------------------------------
    // Move rules
    // -----------------------------------------------------------------------
    test.describe('move rules', () => {
        test('opening move: soldier s3 can slide right', async ({ page }) => {
            const ok = await page.evaluate(() => canMove('s3', 0, 1));
            expect(ok).toBe(true);
        });

        test('opening move: soldier s4 can slide left', async ({ page }) => {
            const ok = await page.evaluate(() => canMove('s4', 0, -1));
            expect(ok).toBe(true);
        });

        test('opening move: soldier s1 can slide down', async ({ page }) => {
            const ok = await page.evaluate(() => canMove('s1', 1, 0));
            expect(ok).toBe(true);
        });

        test('the big block cannot move at the start', async ({ page }) => {
            const res = await page.evaluate(() => ({
                down: canMove('cao', 1, 0),
                up: canMove('cao', -1, 0),
                left: canMove('cao', 0, -1),
                right: canMove('cao', 0, 1),
            }));
            expect(res).toEqual({ down: false, up: false, left: false, right: false });
        });

        test('a move off the top edge is illegal', async ({ page }) => {
            const ok = await page.evaluate(() => canMove('g1', -1, 0));
            expect(ok).toBe(false);
        });

        test('movePiece slides the soldier and frees its old cell', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const ok = movePiece('s3', 0, 1);
                return {
                    ok,
                    nowAt: pieceAt(4, 1) && pieceAt(4, 1).id,
                    oldEmpty: isEmpty(4, 0),
                    moves: moveCount,
                };
            });
            expect(res).toEqual({ ok: true, nowAt: 's3', oldEmpty: true, moves: 1 });
        });

        test('an illegal move returns false and does not count', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const ok = movePiece('cao', 1, 0); // blocked
                return { ok, moves: moveCount };
            });
            expect(res).toEqual({ ok: false, moves: 0 });
        });

        test('the move counter updates the HUD', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { movePiece('s3', 0, 1); });
            await expect(page.locator('#moves')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Click interaction
    // -----------------------------------------------------------------------
    test.describe('click interaction', () => {
        test('handleClick selects the clicked piece', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => handleClick(0, 1));
            const sel = await page.evaluate(() => selected);
            expect(sel).toBe('cao');
        });

        test('clicking the canvas over a piece selects it', async ({ page }) => {
            await page.locator('#btn-start').click();
            // big block occupies cols 1-2, rows 0-1: pixel (150, 50) -> (0,1)
            await page.locator('#canvas').click({ position: { x: 150, y: 50 } });
            const sel = await page.evaluate(() => selected);
            expect(sel).toBe('cao');
        });

        test('arrow keys slide the selected piece', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => selectPiece('s3'));
            await page.evaluate(() => moveDir(0, 1)); // right
            const nowAt = await page.evaluate(() => pieceAt(4, 1) && pieceAt(4, 1).id);
            expect(nowAt).toBe('s3');
        });

        test('clicking an empty cell slides the selected piece there', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                handleClick(4, 0); // select s3
                handleClick(4, 1); // empty neighbour -> slide right
            });
            const nowAt = await page.evaluate(() => pieceAt(4, 1) && pieceAt(4, 1).id);
            expect(nowAt).toBe('s3');
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('isSolved is true when the big block reaches (3,1)', async ({ page }) => {
            const solved = await page.evaluate(() => {
                const b = pieceById('cao');
                b.r = 3; b.c = 1;
                return isSolved();
            });
            expect(solved).toBe(true);
        });

        test('reaching the goal switches state to won', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                const b = pieceById('cao');
                b.r = 3; b.c = 1;
                checkWin();
                return state;
            });
            expect(s).toBe('won');
        });

        test('the win overlay says Solved', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                const b = pieceById('cao');
                b.r = 3; b.c = 1;
                checkWin();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Solved');
        });

        test('the win overlay reports the move count', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                moveCount = 42;
                const b = pieceById('cao');
                b.r = 3; b.c = 1;
                checkWin();
            });
            await expect(page.locator('#overlay-score')).toContainText('42');
        });

        test('best records the fewest moves and persists', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                moveCount = 90;
                const b = pieceById('cao');
                b.r = 3; b.c = 1;
                checkWin();
            });
            await expect(page.locator('#best')).toHaveText('90');
            const stored = await page.evaluate(() => localStorage.getItem('klotski-best'));
            expect(parseInt(stored)).toBe(90);
        });

        test('best keeps the smaller of two solves', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                moveCount = 90;
                const b = pieceById('cao');
                b.r = 3; b.c = 1;
                checkWin();
            });
            // Solve again in fewer moves.
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                moveCount = 85;
                const b = pieceById('cao');
                b.r = 3; b.c = 1;
                checkWin();
            });
            await expect(page.locator('#best')).toHaveText('85');
        });
    });

    // -----------------------------------------------------------------------
    // Reset
    // -----------------------------------------------------------------------
    test.describe('reset', () => {
        test('starting again restores the layout and zeroes the counter', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                movePiece('s3', 0, 1);
                movePiece('s4', 0, -1);
            });
            await page.evaluate(() => startGame()); // restart (as the overlay button does)
            const res = await page.evaluate(() => {
                const b = pieceById('cao');
                return { r: b.r, c: b.c, moves: moveCount, s3IsBack: pieceAt(4, 0).id };
            });
            expect(res).toEqual({ r: 0, c: 1, moves: 0, s3IsBack: 's3' });
        });
    });
});
