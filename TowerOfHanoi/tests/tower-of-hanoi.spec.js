const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Tower of Hanoi', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.removeItem('tower-of-hanoi-best'); } catch (e) {}
        });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tower of Hanoi', async ({ page }) => {
            await expect(page).toHaveTitle('Tower of Hanoi');
        });

        test('canvas has the documented dimensions', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '360');
        });

        test('there are three pegs', async ({ page }) => {
            const n = await page.evaluate(() => pegs.length);
            expect(n).toBe(3);
        });

        test('the default puzzle has 4 disks, all stacked on peg A', async ({ page }) => {
            const info = await page.evaluate(() => ({
                numDisks,
                pegA: pegs[0].slice(),
                pegB: pegs[1].slice(),
                pegC: pegs[2].slice(),
            }));
            expect(info.numDisks).toBe(4);
            // bottom-to-top: largest (4) at the bottom, smallest (1) on top
            expect(info.pegA).toEqual([4, 3, 2, 1]);
            expect(info.pegB).toEqual([]);
            expect(info.pegC).toEqual([]);
        });

        test('move count starts at 0 and the game is playing', async ({ page }) => {
            const s = await page.evaluate(() => ({ moves, state, selected }));
            expect(s.moves).toBe(0);
            expect(s.state).toBe('playing');
            expect(s.selected).toBe(null);
        });

        test('minMoves is 2^n - 1', async ({ page }) => {
            const m = await page.evaluate(() => minMoves);
            expect(m).toBe(15); // 2^4 - 1
        });

        test('the move counter is shown in the HUD', async ({ page }) => {
            await expect(page.locator('#moves')).toHaveText('0');
            await expect(page.locator('#min-moves')).toHaveText('15');
        });
    });

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    test.describe('helpers', () => {
        test('topDisk returns the smallest disk on a peg, or null when empty', async ({ page }) => {
            const r = await page.evaluate(() => ({
                a: topDisk(0), // top of [4,3,2,1] is 1
                b: topDisk(1), // empty
            }));
            expect(r.a).toBe(1);
            expect(r.b).toBe(null);
        });

        test('canMove allows the top disk onto an empty peg', async ({ page }) => {
            const ok = await page.evaluate(() => canMove(0, 1));
            expect(ok).toBe(true);
        });

        test('canMove forbids moving from an empty peg', async ({ page }) => {
            const ok = await page.evaluate(() => canMove(1, 2));
            expect(ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Moving disks
    // -----------------------------------------------------------------------
    test.describe('moving disks', () => {
        test('a legal move transfers the top disk and counts', async ({ page }) => {
            const r = await page.evaluate(() => {
                const ok = moveDisk(0, 1);
                return { ok, pegA: pegs[0].slice(), pegB: pegs[1].slice(), moves };
            });
            expect(r.ok).toBe(true);
            expect(r.pegA).toEqual([4, 3, 2]);
            expect(r.pegB).toEqual([1]);
            expect(r.moves).toBe(1);
        });

        test('a larger disk cannot be placed on a smaller one', async ({ page }) => {
            const r = await page.evaluate(() => {
                moveDisk(0, 1);        // disk 1 -> B
                const ok = moveDisk(0, 1); // try disk 2 onto disk 1 (illegal)
                return { ok, pegB: pegs[1].slice(), pegA: pegs[0].slice(), moves };
            });
            expect(r.ok).toBe(false);
            expect(r.pegB).toEqual([1]);       // unchanged
            expect(r.pegA).toEqual([4, 3, 2]);  // disk 2 stayed put
            expect(r.moves).toBe(1);            // illegal move not counted
        });

        test('a smaller disk can be placed on a larger one', async ({ page }) => {
            const r = await page.evaluate(() => {
                moveDisk(0, 1);        // disk 1 -> B
                moveDisk(0, 2);        // disk 2 -> C
                const ok = moveDisk(1, 2); // disk 1 onto disk 2 (legal)
                return { ok, pegC: pegs[2].slice() };
            });
            expect(r.ok).toBe(true);
            expect(r.pegC).toEqual([2, 1]);
        });

        test('moving from an empty peg does nothing', async ({ page }) => {
            const r = await page.evaluate(() => {
                const ok = moveDisk(2, 1); // C is empty
                return { ok, moves };
            });
            expect(r.ok).toBe(false);
            expect(r.moves).toBe(0);
        });

        test('a move to the same peg is rejected', async ({ page }) => {
            const r = await page.evaluate(() => moveDisk(0, 0));
            expect(r).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('isWon is true only when all disks are on peg C', async ({ page }) => {
            const r = await page.evaluate(() => {
                const before = isWon();
                pegs = [[], [], [4, 3, 2, 1]];
                const after = isWon();
                return { before, after };
            });
            expect(r.before).toBe(false);
            expect(r.after).toBe(true);
        });

        test('completing the stack on peg C wins and announces it', async ({ page }) => {
            await page.evaluate(() => {
                // One move from victory: everything on C except the smallest,
                // which sits alone on B.
                pegs = [[], [1], [4, 3, 2]];
                moves = 14;
                state = 'playing';
                moveDisk(1, 2); // disk 1 -> C completes the tower
            });
            const s = await page.evaluate(() => ({ state, moves }));
            expect(s.state).toBe('won');
            expect(s.moves).toBe(15);
            await expect(page.locator('#status')).toContainText(/solved|win|congrat/i);
        });

        test('no moves are accepted after the puzzle is solved', async ({ page }) => {
            const r = await page.evaluate(() => {
                pegs = [[], [1], [4, 3, 2]];
                state = 'playing';
                moveDisk(1, 2);          // win
                const ok = moveDisk(2, 0); // should be rejected
                return { ok, state, pegC: pegs[2].slice() };
            });
            expect(r.ok).toBe(false);
            expect(r.state).toBe('won');
            expect(r.pegC).toEqual([4, 3, 2, 1]);
        });
    });

    // -----------------------------------------------------------------------
    // The optimal solver
    // -----------------------------------------------------------------------
    test.describe('solver', () => {
        test('solutionMoves(n) has exactly 2^n - 1 moves', async ({ page }) => {
            const lens = await page.evaluate(() => [1, 2, 3, 4, 5].map(n => solutionMoves(n).length));
            expect(lens).toEqual([1, 3, 7, 15, 31]);
        });

        test('applying solutionMoves from the start solves the puzzle', async ({ page }) => {
            const r = await page.evaluate(() => {
                reset(4);
                for (const [f, t] of solutionMoves(4)) moveDisk(f, t);
                return { won: isWon(), moves, state };
            });
            expect(r.won).toBe(true);
            expect(r.moves).toBe(15);
            expect(r.state).toBe('won');
        });

        test('every move in the canonical solution is legal', async ({ page }) => {
            const allLegal = await page.evaluate(() => {
                reset(4);
                for (const [f, t] of solutionMoves(4)) {
                    if (!canMove(f, t)) return false;
                    moveDisk(f, t);
                }
                return true;
            });
            expect(allLegal).toBe(true);
        });

        test('the Solve button drives the puzzle to a won state', async ({ page }) => {
            await page.evaluate(() => setDiskCount(3)); // 7 moves, quick to animate
            await page.locator('#btn-solve').click();
            await page.waitForFunction(() => state === 'won', null, { timeout: 8000 });
            const m = await page.evaluate(() => moves);
            expect(m).toBe(7);
        });
    });

    // -----------------------------------------------------------------------
    // Click interaction
    // -----------------------------------------------------------------------
    test.describe('click interaction', () => {
        test('clicking a peg selects its top disk', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await canvas.click({ position: { x: 100, y: 180 } }); // peg A region
            const sel = await page.evaluate(() => selected);
            expect(sel).toBe(0);
        });

        test('clicking a source then a destination moves the disk', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await canvas.click({ position: { x: 100, y: 180 } }); // select A
            await canvas.click({ position: { x: 300, y: 180 } }); // move to B
            const r = await page.evaluate(() => ({ pegB: pegs[1].slice(), selected }));
            expect(r.pegB).toEqual([1]);
            expect(r.selected).toBe(null);
        });

        test('clicking the selected peg again cancels the selection', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await canvas.click({ position: { x: 100, y: 180 } });
            await canvas.click({ position: { x: 100, y: 180 } });
            const sel = await page.evaluate(() => selected);
            expect(sel).toBe(null);
        });

        test('clicking an empty peg first selects nothing', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await canvas.click({ position: { x: 300, y: 180 } }); // peg B is empty
            const sel = await page.evaluate(() => selected);
            expect(sel).toBe(null);
        });

        test('an illegal destination reselects that peg instead of moving', async ({ page }) => {
            const r = await page.evaluate(() => {
                moveDisk(0, 1);   // disk 1 -> B
                handlePegClick(0); // select A (top is disk 2)
                handlePegClick(1); // B holds disk 1; can't drop 2 on 1
                return { selected, pegB: pegs[1].slice() };
            });
            expect(r.pegB).toEqual([1]); // no move happened
            expect(r.selected).toBe(1);  // reselected the clicked peg
        });
    });

    // -----------------------------------------------------------------------
    // Disk count selection
    // -----------------------------------------------------------------------
    test.describe('disk count', () => {
        test('setDiskCount rebuilds the puzzle with the new count', async ({ page }) => {
            const r = await page.evaluate(() => {
                setDiskCount(3);
                return { numDisks, pegA: pegs[0].slice(), minMoves, moves };
            });
            expect(r.numDisks).toBe(3);
            expect(r.pegA).toEqual([3, 2, 1]);
            expect(r.minMoves).toBe(7);
            expect(r.moves).toBe(0);
        });

        test('the 5-disk button switches the puzzle', async ({ page }) => {
            await page.locator('#btn-disks-5').click();
            const r = await page.evaluate(() => ({ numDisks, minMoves }));
            expect(r.numDisks).toBe(5);
            expect(r.minMoves).toBe(31);
        });
    });

    // -----------------------------------------------------------------------
    // Reset & best score
    // -----------------------------------------------------------------------
    test.describe('reset and best', () => {
        test('pressing R restores the current puzzle', async ({ page }) => {
            await page.evaluate(() => { moveDisk(0, 1); moveDisk(0, 2); });
            await page.keyboard.press('r');
            const r = await page.evaluate(() => ({
                pegA: pegs[0].slice(), moves, state, selected,
            }));
            expect(r.pegA).toEqual([4, 3, 2, 1]);
            expect(r.moves).toBe(0);
            expect(r.state).toBe('playing');
            expect(r.selected).toBe(null);
        });

        test('the Reset button restores the puzzle', async ({ page }) => {
            await page.evaluate(() => { moveDisk(0, 1); });
            await page.locator('#btn-reset').click();
            const pegA = await page.evaluate(() => pegs[0].slice());
            expect(pegA).toEqual([4, 3, 2, 1]);
        });

        test('winning records the best (fewest) move count for that disk count', async ({ page }) => {
            await page.evaluate(() => {
                reset(3);
                for (const [f, t] of solutionMoves(3)) moveDisk(f, t); // optimal: 7
            });
            await expect(page.locator('#best')).toHaveText('7');
            const stored = await page.evaluate(() =>
                JSON.parse(localStorage.getItem('tower-of-hanoi-best') || '{}'));
            expect(stored['3']).toBe(7);
        });
    });
});
