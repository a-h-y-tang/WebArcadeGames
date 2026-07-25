const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Deal a deterministic board, then clear the tableau/free/foundations so a test
// can build an exact position by hand. Leaves the game in the 'running' state.
async function blankBoard(page) {
    await page.evaluate(() => {
        dealGame(1);
        tableau = [[], [], [], [], [], [], [], []];
        free = [null, null, null, null];
        found = { C: 0, D: 0, H: 0, S: 0 };
        moves = 0;
        updateHud();
        render();
    });
}

test.describe('FreeCell', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is FreeCell', async ({ page }) => {
            await expect(page).toHaveTitle('FreeCell');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('start');
        });

        test('moves counter starts at 0', async ({ page }) => {
            await expect(page.locator('#moves')).toHaveText('0');
        });

        test('best shows a placeholder when none is stored', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('there are 8 tableau columns, 4 free cells and 4 foundations', async ({ page }) => {
            const shape = await page.evaluate(() => ({
                cols: tableau.length,
                free: free.length,
                found: Object.keys(found).length,
            }));
            expect(shape).toEqual({ cols: 8, free: 4, found: 4 });
        });

        test('state is idle before starting', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Dealing
    // -----------------------------------------------------------------------
    test.describe('dealing', () => {
        test('New Game button deals and dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('a deal lays out all 52 cards', async ({ page }) => {
            await page.evaluate(() => dealGame(1));
            const total = await page.evaluate(() =>
                tableau.reduce((n, col) => n + col.length, 0));
            expect(total).toBe(52);
        });

        test('columns 0-3 get 7 cards and columns 4-7 get 6', async ({ page }) => {
            await page.evaluate(() => dealGame(1));
            const counts = await page.evaluate(() => tableau.map(c => c.length));
            expect(counts).toEqual([7, 7, 7, 7, 6, 6, 6, 6]);
        });

        test('a deal contains 52 distinct cards', async ({ page }) => {
            await page.evaluate(() => dealGame(1));
            const distinct = await page.evaluate(() => {
                const seen = new Set();
                for (const col of tableau)
                    for (const card of col) seen.add(card.rank + card.suit);
                return seen.size;
            });
            expect(distinct).toBe(52);
        });

        test('the same game number always deals the same board', async ({ page }) => {
            const same = await page.evaluate(() => {
                dealGame(617);
                const a = tableau.map(col => col.map(c => c.rank + c.suit).join(','));
                dealGame(617);
                const b = tableau.map(col => col.map(c => c.rank + c.suit).join(','));
                return JSON.stringify(a) === JSON.stringify(b);
            });
            expect(same).toBe(true);
        });

        test('free cells and foundations are empty after a deal', async ({ page }) => {
            await page.evaluate(() => dealGame(1));
            const empties = await page.evaluate(() => ({
                free: free.every(f => f === null),
                found: Object.values(found).every(v => v === 0),
            }));
            expect(empties).toEqual({ free: true, found: true });
        });
    });

    // -----------------------------------------------------------------------
    // Card colours
    // -----------------------------------------------------------------------
    test.describe('card colours', () => {
        test('hearts and diamonds are red, clubs and spades are black', async ({ page }) => {
            const colors = await page.evaluate(() => ({
                h: cardColor({ rank: 5, suit: 'H' }),
                d: cardColor({ rank: 5, suit: 'D' }),
                c: cardColor({ rank: 5, suit: 'C' }),
                s: cardColor({ rank: 5, suit: 'S' }),
            }));
            expect(colors).toEqual({ h: 'red', d: 'red', c: 'black', s: 'black' });
        });
    });

    // -----------------------------------------------------------------------
    // Foundation rules
    // -----------------------------------------------------------------------
    test.describe('foundation rules', () => {
        test('an Ace is accepted onto an empty foundation', async ({ page }) => {
            await blankBoard(page);
            const ok = await page.evaluate(() => foundationAccepts({ rank: 1, suit: 'S' }));
            expect(ok).toBe(true);
        });

        test('a 2 is rejected onto an empty foundation', async ({ page }) => {
            await blankBoard(page);
            const ok = await page.evaluate(() => foundationAccepts({ rank: 2, suit: 'S' }));
            expect(ok).toBe(false);
        });

        test('a 2 is accepted once its Ace is on the foundation', async ({ page }) => {
            await blankBoard(page);
            const ok = await page.evaluate(() => {
                found.S = 1; // Ace of spades already up
                return foundationAccepts({ rank: 2, suit: 'S' });
            });
            expect(ok).toBe(true);
        });

        test('moving an Ace from the tableau to its foundation works', async ({ page }) => {
            await blankBoard(page);
            const result = await page.evaluate(() => {
                tableau[0] = [{ rank: 1, suit: 'H' }];
                const ok = moveTableauToFoundation(0);
                return { ok, found: found.H, col: tableau[0].length };
            });
            expect(result).toEqual({ ok: true, found: 1, col: 0 });
        });

        test('moving a non-matching card to a foundation is rejected', async ({ page }) => {
            await blankBoard(page);
            const result = await page.evaluate(() => {
                tableau[0] = [{ rank: 5, suit: 'H' }];
                const ok = moveTableauToFoundation(0);
                return { ok, found: found.H, col: tableau[0].length };
            });
            expect(result).toEqual({ ok: false, found: 0, col: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Tableau rules
    // -----------------------------------------------------------------------
    test.describe('tableau rules', () => {
        test('a red card stacks on a black card one rank higher', async ({ page }) => {
            await blankBoard(page);
            const ok = await page.evaluate(() => {
                tableau[1] = [{ rank: 7, suit: 'S' }];
                return tableauAccepts({ rank: 6, suit: 'H' }, 1);
            });
            expect(ok).toBe(true);
        });

        test('same-colour stacking is rejected', async ({ page }) => {
            await blankBoard(page);
            const ok = await page.evaluate(() => {
                tableau[1] = [{ rank: 7, suit: 'S' }];
                return tableauAccepts({ rank: 6, suit: 'C' }, 1);
            });
            expect(ok).toBe(false);
        });

        test('wrong-rank stacking is rejected', async ({ page }) => {
            await blankBoard(page);
            const ok = await page.evaluate(() => {
                tableau[1] = [{ rank: 7, suit: 'S' }];
                return tableauAccepts({ rank: 5, suit: 'H' }, 1);
            });
            expect(ok).toBe(false);
        });

        test('any card is accepted onto an empty column', async ({ page }) => {
            await blankBoard(page);
            const ok = await page.evaluate(() => tableauAccepts({ rank: 9, suit: 'C' }, 3));
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Free cells
    // -----------------------------------------------------------------------
    test.describe('free cells', () => {
        test('a tableau card moves into the first empty free cell', async ({ page }) => {
            await blankBoard(page);
            const result = await page.evaluate(() => {
                tableau[2] = [{ rank: 4, suit: 'D' }];
                const ok = moveTableauToFree(2);
                return { ok, cell: free[0], col: tableau[2].length };
            });
            expect(result).toEqual({ ok: true, cell: { rank: 4, suit: 'D' }, col: 0 });
        });

        test('moving to a free cell fails when all cells are full', async ({ page }) => {
            await blankBoard(page);
            const ok = await page.evaluate(() => {
                free = [{ rank: 2, suit: 'C' }, { rank: 3, suit: 'C' },
                        { rank: 4, suit: 'C' }, { rank: 5, suit: 'C' }];
                tableau[2] = [{ rank: 9, suit: 'H' }];
                return moveTableauToFree(2);
            });
            expect(ok).toBe(false);
        });

        test('a free-cell card moves onto a matching tableau column', async ({ page }) => {
            await blankBoard(page);
            const result = await page.evaluate(() => {
                free[0] = { rank: 6, suit: 'H' };
                tableau[1] = [{ rank: 7, suit: 'S' }];
                const ok = moveFreeToTableau(0, 1);
                return { ok, cell: free[0], top: tableau[1][tableau[1].length - 1] };
            });
            expect(result).toEqual({ ok: true, cell: null, top: { rank: 6, suit: 'H' } });
        });
    });

    // -----------------------------------------------------------------------
    // Supermove capacity
    // -----------------------------------------------------------------------
    test.describe('supermove capacity', () => {
        test('with 4 free cells and no empty columns, up to 5 cards move', async ({ page }) => {
            await blankBoard(page);
            const cap = await page.evaluate(() => {
                for (let i = 0; i < 8; i++) tableau[i] = [{ rank: 13, suit: 'S' }];
                return maxMove(false);
            });
            expect(cap).toBe(5);
        });

        test('one empty column doubles the capacity to 10', async ({ page }) => {
            await blankBoard(page);
            const cap = await page.evaluate(() => {
                for (let i = 0; i < 7; i++) tableau[i] = [{ rank: 13, suit: 'S' }];
                tableau[7] = []; // one empty column
                return maxMove(false);
            });
            expect(cap).toBe(10);
        });

        test('moving onto an empty column does not count that column', async ({ page }) => {
            await blankBoard(page);
            const cap = await page.evaluate(() => {
                for (let i = 0; i < 7; i++) tableau[i] = [{ rank: 13, suit: 'S' }];
                tableau[7] = []; // the only empty column, used as destination
                return maxMove(true);
            });
            expect(cap).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Sequences & tableau-to-tableau moves
    // -----------------------------------------------------------------------
    test.describe('tableau-to-tableau moves', () => {
        test('isSequence recognises a descending alternating run', async ({ page }) => {
            const ok = await page.evaluate(() => isSequence([
                { rank: 8, suit: 'S' }, { rank: 7, suit: 'H' }, { rank: 6, suit: 'C' },
            ]));
            expect(ok).toBe(true);
        });

        test('isSequence rejects a same-colour run', async ({ page }) => {
            const ok = await page.evaluate(() => isSequence([
                { rank: 8, suit: 'S' }, { rank: 7, suit: 'C' },
            ]));
            expect(ok).toBe(false);
        });

        test('a valid two-card run moves between columns', async ({ page }) => {
            await blankBoard(page);
            const result = await page.evaluate(() => {
                tableau[0] = [{ rank: 8, suit: 'H' }, { rank: 7, suit: 'S' }];
                tableau[1] = [{ rank: 9, suit: 'C' }]; // black 9 accepts red 8
                const ok = moveTableauToTableau(0, 1, 2);
                return { ok, from: tableau[0].length, to: tableau[1].map(c => c.rank + c.suit) };
            });
            expect(result).toEqual({ ok: true, from: 0, to: ['9C', '8H', '7S'] });
        });

        test('a run that does not fit the destination is rejected', async ({ page }) => {
            await blankBoard(page);
            const result = await page.evaluate(() => {
                tableau[0] = [{ rank: 8, suit: 'H' }, { rank: 7, suit: 'S' }];
                tableau[1] = [{ rank: 9, suit: 'H' }]; // red 9 cannot take red 8
                const ok = moveTableauToTableau(0, 1, 2);
                return { ok, from: tableau[0].length };
            });
            expect(result).toEqual({ ok: false, from: 2 });
        });

        test('a move exceeding the supermove capacity is rejected', async ({ page }) => {
            await blankBoard(page);
            const result = await page.evaluate(() => {
                // No free cells, no empty columns -> capacity is 1.
                free = [{ rank: 2, suit: 'C' }, { rank: 3, suit: 'C' },
                        { rank: 4, suit: 'C' }, { rank: 5, suit: 'C' }];
                for (let i = 2; i < 8; i++) tableau[i] = [{ rank: 13, suit: 'S' }];
                tableau[0] = [{ rank: 8, suit: 'H' }, { rank: 7, suit: 'S' }];
                tableau[1] = [{ rank: 9, suit: 'C' }];
                return moveTableauToTableau(0, 1, 2); // wants to move 2, capacity 1
            });
            expect(result).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Move counting
    // -----------------------------------------------------------------------
    test.describe('move counting', () => {
        test('a successful move increments the move counter', async ({ page }) => {
            await blankBoard(page);
            await page.evaluate(() => {
                tableau[0] = [{ rank: 1, suit: 'H' }];
                moveTableauToFoundation(0);
            });
            await expect(page.locator('#moves')).toHaveText('1');
        });

        test('a rejected move does not change the counter', async ({ page }) => {
            await blankBoard(page);
            await page.evaluate(() => {
                tableau[0] = [{ rank: 5, suit: 'H' }];
                moveTableauToFoundation(0);
            });
            await expect(page.locator('#moves')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Auto-collect & winning
    // -----------------------------------------------------------------------
    test.describe('auto-collect and winning', () => {
        test('autoCollect sends available aces to the foundations', async ({ page }) => {
            await blankBoard(page);
            const founds = await page.evaluate(() => {
                tableau[0] = [{ rank: 1, suit: 'H' }];
                tableau[1] = [{ rank: 1, suit: 'S' }];
                free[0] = { rank: 1, suit: 'C' };
                autoCollect();
                return { H: found.H, S: found.S, C: found.C };
            });
            expect(founds).toEqual({ H: 1, S: 1, C: 1 });
        });

        test('isWon is true only when all four foundations reach the King', async ({ page }) => {
            await blankBoard(page);
            const states = await page.evaluate(() => {
                const before = isWon();
                found = { C: 13, D: 13, H: 13, S: 13 };
                const after = isWon();
                return { before, after };
            });
            expect(states).toEqual({ before: false, after: true });
        });

        test('completing the foundations wins the game', async ({ page }) => {
            await blankBoard(page);
            await page.evaluate(() => {
                found = { C: 13, D: 13, H: 12, S: 13 };
                tableau[0] = [{ rank: 13, suit: 'H' }];
                moveTableauToFoundation(0); // the final King
            });
            const s = await page.evaluate(() => state);
            expect(s).toBe('won');
        });

        test('the win overlay is shown on a win', async ({ page }) => {
            await blankBoard(page);
            await page.evaluate(() => {
                found = { C: 13, D: 13, H: 12, S: 13 };
                tableau[0] = [{ rank: 13, suit: 'H' }];
                moveTableauToFoundation(0);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('You Win');
        });
    });

    // -----------------------------------------------------------------------
    // Best (fewest moves) persistence
    // -----------------------------------------------------------------------
    test.describe('best moves persistence', () => {
        test('best updates to the winning move count', async ({ page }) => {
            await blankBoard(page);
            await page.evaluate(() => {
                moves = 42;
                found = { C: 13, D: 13, H: 12, S: 13 };
                tableau[0] = [{ rank: 13, suit: 'H' }];
                moveTableauToFoundation(0); // move 43 wins
            });
            await expect(page.locator('#best')).toHaveText('43');
        });

        test('best persists to localStorage', async ({ page }) => {
            await blankBoard(page);
            await page.evaluate(() => {
                moves = 9;
                found = { C: 13, D: 13, H: 12, S: 13 };
                tableau[0] = [{ rank: 13, suit: 'H' }];
                moveTableauToFoundation(0);
            });
            const stored = await page.evaluate(() => localStorage.getItem('freecell-best'));
            expect(parseInt(stored)).toBe(10);
        });
    });
});
