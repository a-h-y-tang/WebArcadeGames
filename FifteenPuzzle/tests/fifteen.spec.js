const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

const SOLVED = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0];

test.describe('15 Puzzle', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title mentions 15 Puzzle', async ({ page }) => {
            await expect(page).toHaveTitle(/15 Puzzle/i);
        });

        test('canvas is 500×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('SIZE is 4', async ({ page }) => {
            expect(await page.evaluate(() => SIZE)).toBe(4);
        });

        test('board holds 16 cells', async ({ page }) => {
            expect(await page.evaluate(() => board.length)).toBe(16);
        });

        test('board is a permutation of 0..15', async ({ page }) => {
            const sorted = await page.evaluate(() => [...board].sort((a, b) => a - b));
            expect(sorted).toEqual([...Array(16).keys()]);
        });

        test('blankIndex points at the empty (0) cell', async ({ page }) => {
            const ok = await page.evaluate(() => board[blankIndex] === 0);
            expect(ok).toBe(true);
        });

        test('moves start at 0', async ({ page }) => {
            await expect(page.locator('#moves')).toHaveText('0');
        });

        test('game state starts as playing', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the board starts scrambled (not already solved)', async ({ page }) => {
            expect(await page.evaluate(() => isSolved())).toBe(false);
        });

        test('timer starts at 00:00', async ({ page }) => {
            await expect(page.locator('#time')).toHaveText('00:00');
        });
    });

    // -----------------------------------------------------------------------
    // Solved detection
    // -----------------------------------------------------------------------
    test.describe('isSolved', () => {
        test('true for the ordered board', async ({ page }) => {
            const r = await page.evaluate(s => { setBoard(s); return isSolved(); }, SOLVED);
            expect(r).toBe(true);
        });

        test('false when two tiles are swapped', async ({ page }) => {
            const swapped = [...SOLVED];
            [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
            const r = await page.evaluate(s => { setBoard(s); return isSolved(); }, swapped);
            expect(r).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Sliding tiles
    // -----------------------------------------------------------------------
    test.describe('sliding', () => {
        test('canSlide is true for a tile adjacent to the blank', async ({ page }) => {
            // Blank at index 15 (row 3, col 3); tile at 14 and 11 are adjacent.
            const res = await page.evaluate(s => {
                setBoard(s);
                return { adj14: canSlide(14), adj11: canSlide(11), far0: canSlide(0) };
            }, SOLVED);
            expect(res.adj14).toBe(true);
            expect(res.adj11).toBe(true);
            expect(res.far0).toBe(false);
        });

        test('sliding an adjacent tile moves it into the blank', async ({ page }) => {
            const after = await page.evaluate(s => {
                setBoard(s);          // blank at 15
                slideTile(14);        // tile 15 slides right into 15
                return { at14: board[14], at15: board[15], blank: blankIndex };
            }, SOLVED);
            expect(after.at15).toBe(15); // the tile value 15 moved to index 15
            expect(after.at14).toBe(0);  // blank is now where the tile was
            expect(after.blank).toBe(14);
        });

        test('sliding increments the move counter', async ({ page }) => {
            await page.evaluate(s => { setBoard(s); }, SOLVED);
            await page.evaluate(() => slideTile(14));
            await expect(page.locator('#moves')).toHaveText('1');
        });

        test('sliding a non-adjacent tile does nothing', async ({ page }) => {
            const res = await page.evaluate(s => {
                setBoard(s);
                const before = [...board];
                const moved = slideTile(0); // far from blank at 15
                return { moved, changed: JSON.stringify(before) !== JSON.stringify(board) };
            }, SOLVED);
            expect(res.moved).toBe(false);
            expect(res.changed).toBe(false);
        });

        test('a non-move does not increment the counter', async ({ page }) => {
            await page.evaluate(s => { setBoard(s); }, SOLVED);
            await page.evaluate(() => slideTile(0));
            await expect(page.locator('#moves')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Arrow-key controls
    // -----------------------------------------------------------------------
    test.describe('arrow keys', () => {
        test('ArrowRight slides the tile left of the blank rightwards', async ({ page }) => {
            // Blank at 15; tile at 14 is to its left → ArrowRight moves it right.
            const res = await page.evaluate(s => {
                setBoard(s);
                moveByArrow('ArrowRight');
                return { at15: board[15], blank: blankIndex };
            }, SOLVED);
            expect(res.at15).toBe(15);
            expect(res.blank).toBe(14);
        });

        test('ArrowDown slides the tile above the blank downwards', async ({ page }) => {
            const res = await page.evaluate(s => {
                setBoard(s);          // blank at 15, tile above is index 11 (value 12)
                moveByArrow('ArrowDown');
                return { at15: board[15], blank: blankIndex };
            }, SOLVED);
            expect(res.at15).toBe(12);
            expect(res.blank).toBe(11);
        });

        test('an arrow with no tile to move does nothing', async ({ page }) => {
            // Blank at 15 (bottom-right). ArrowLeft would need a tile to the
            // right of the blank — there is none.
            const res = await page.evaluate(s => {
                setBoard(s);
                const before = [...board];
                moveByArrow('ArrowLeft');
                return JSON.stringify(before) === JSON.stringify(board);
            }, SOLVED);
            expect(res).toBe(true);
        });

        test('pressing a real arrow key slides a tile', async ({ page }) => {
            await page.evaluate(s => { setBoard(s); }, SOLVED);
            await page.keyboard.press('ArrowRight');
            const at15 = await page.evaluate(() => board[15]);
            expect(at15).toBe(15);
        });
    });

    // -----------------------------------------------------------------------
    // Mouse input
    // -----------------------------------------------------------------------
    test.describe('mouse input', () => {
        test('clicking an adjacent tile slides it', async ({ page }) => {
            await page.evaluate(s => { setBoard(s); }, SOLVED);
            const { x, y } = await page.evaluate(() => cellCenter(14));
            await page.locator('#canvas').click({ position: { x, y } });
            expect(await page.evaluate(() => board[15])).toBe(15);
        });

        test('indexAtPixel maps a tile centre back to its index', async ({ page }) => {
            const idx = await page.evaluate(() => {
                const p = cellCenter(6);
                return indexAtPixel(p.x, p.y);
            });
            expect(idx).toBe(6);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('completing the puzzle sets state to won', async ({ page }) => {
            const st = await page.evaluate(() => {
                // one move from solved: tile 15 sits at index 14, blank at 15... invert
                setBoard([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15]);
                slideTile(15); // slide the 15 into place
                return state;
            });
            expect(st).toBe('won');
        });

        test('win overlay appears on solve', async ({ page }) => {
            await page.evaluate(() => {
                setBoard([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15]);
                slideTile(15);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/Solved|Complete|You win/i);
        });

        test('no more moves are counted after the win', async ({ page }) => {
            await page.evaluate(() => {
                setBoard([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15]);
                slideTile(15);              // win
            });
            const movesAtWin = await page.locator('#moves').textContent();
            await page.evaluate(() => slideTile(14)); // should be ignored
            await expect(page.locator('#moves')).toHaveText(movesAtWin);
        });

        test('best move count is stored on win', async ({ page }) => {
            await page.evaluate(() => {
                setBoard([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15]);
                slideTile(15);
            });
            const best = await page.evaluate(() => localStorage.getItem('fifteen-best-moves'));
            expect(best).not.toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Shuffle / new game
    // -----------------------------------------------------------------------
    test.describe('new game', () => {
        test('New Game reshuffles to a solvable, unsolved permutation', async ({ page }) => {
            await page.locator('#btn-new').click();
            const res = await page.evaluate(() => ({
                perm: [...board].sort((a, b) => a - b),
                solved: isSolved(),
            }));
            expect(res.perm).toEqual([...Array(16).keys()]);
            expect(res.solved).toBe(false);
        });

        test('New Game resets the move counter to 0', async ({ page }) => {
            await page.evaluate(s => { setBoard(s); slideTile(14); }, SOLVED);
            await page.locator('#btn-new').click();
            await expect(page.locator('#moves')).toHaveText('0');
        });

        test('New Game clears a won state back to playing', async ({ page }) => {
            await page.evaluate(() => {
                setBoard([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15]);
                slideTile(15);
            });
            await page.locator('#btn-new').click();
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('shuffle only produces reachable (solvable) boards', async ({ page }) => {
            // Applying the same random-legal-move shuffle many times must always
            // yield a board solvable back to SOLVED. We verify the invariant that
            // the blank parity + permutation parity stays even (solvable).
            const solvable = await page.evaluate(() => {
                function parityOK(b) {
                    // count inversions ignoring blank
                    const tiles = b.filter(v => v !== 0);
                    let inv = 0;
                    for (let i = 0; i < tiles.length; i++)
                        for (let j = i + 1; j < tiles.length; j++)
                            if (tiles[i] > tiles[j]) inv++;
                    const blankRowFromBottom = SIZE - Math.floor(b.indexOf(0) / SIZE);
                    // For 4-wide boards: solvable iff (blankRowFromBottom even) == (inv odd)
                    return (blankRowFromBottom % 2 === 0) === (inv % 2 === 1);
                }
                for (let t = 0; t < 20; t++) {
                    newGame();
                    if (!parityOK(board)) return false;
                }
                return true;
            });
            expect(solvable).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Timer
    // -----------------------------------------------------------------------
    test.describe('timer', () => {
        test('timer advances after the first move', async ({ page }) => {
            await page.evaluate(s => { setBoard(s); }, SOLVED);
            await page.evaluate(() => slideTile(14)); // first move starts clock
            await page.waitForTimeout(1100);
            const t = await page.locator('#time').textContent();
            expect(t).not.toBe('00:00');
        });
    });
});
