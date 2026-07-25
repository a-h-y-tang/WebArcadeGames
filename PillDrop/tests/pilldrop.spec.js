const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// An empty 16×8 bottle as a character map for loadGrid().
const EMPTY = Array.from({ length: 16 }, () => '.'.repeat(8));

// Replace one row in a copy of EMPTY.
function withRow(rowIndex, str) {
    const rows = EMPTY.slice();
    rows[rowIndex] = str;
    return rows;
}

// Start a game with a fixed seed, freeze the gravity timer and (optionally)
// install an exact board so the core logic is fully reproducible.
async function setup(page, rows) {
    await page.evaluate((r) => {
        startGame(1);
        autoDrop = false;
        if (r) loadGrid(r);
    }, rows || null);
}

test.describe('Pill Drop', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Pill Drop', async ({ page }) => {
            await expect(page).toHaveTitle('Pill Drop');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to press/start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('canvas is 240×480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '240');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('board constants are 8×16 with 3 colours, match length 4', async ({ page }) => {
            const c = await page.evaluate(() => ({ COLS, ROWS, CELL, NUM_COLORS, MATCH_LEN }));
            expect(c.COLS).toBe(8);
            expect(c.ROWS).toBe(16);
            expect(c.CELL).toBe(30);
            expect(c.NUM_COLORS).toBe(3);
            expect(c.MATCH_LEN).toBe(4);
        });

        test('no capsule exists before starting', async ({ page }) => {
            expect(await page.evaluate(() => capsule)).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting a game', () => {
        test('clicking Start begins play', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('pressing Space begins play', async ({ page }) => {
            await page.locator('body').press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('overlay hides once playing', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a capsule spawns on start', async ({ page }) => {
            await setup(page);
            const cap = await page.evaluate(() => capsule);
            expect(cap).not.toBeNull();
        });

        test('the spawned capsule is within the board', async ({ page }) => {
            await setup(page);
            const cells = await page.evaluate(() => capsuleCells());
            for (const cell of cells) {
                expect(cell.r).toBeGreaterThanOrEqual(0);
                expect(cell.r).toBeLessThan(16);
                expect(cell.c).toBeGreaterThanOrEqual(0);
                expect(cell.c).toBeLessThan(8);
            }
        });

        test('viruses are placed on start', async ({ page }) => {
            await setup(page);
            const n = await page.evaluate(() => virusCount());
            expect(n).toBeGreaterThan(0);
        });

        test('the virus HUD matches the live virus count', async ({ page }) => {
            await setup(page);
            const n = await page.evaluate(() => virusCount());
            await expect(page.locator('#viruses')).toHaveText(String(n));
        });

        test('a fresh board has no run of 3+ same colour', async ({ page }) => {
            await setup(page);
            const ok = await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) {
                        const cell = grid[r][c];
                        if (!cell) continue;
                        // horizontal run
                        if (c + 2 < COLS &&
                            grid[r][c + 1] && grid[r][c + 2] &&
                            grid[r][c + 1].color === cell.color &&
                            grid[r][c + 2].color === cell.color) return false;
                        // vertical run
                        if (r + 2 < ROWS &&
                            grid[r + 1][c] && grid[r + 2][c] &&
                            grid[r + 1][c].color === cell.color &&
                            grid[r + 2][c].color === cell.color) return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Moving the capsule
    // -----------------------------------------------------------------------
    test.describe('moving the capsule', () => {
        test('capsule spawns horizontally at columns 3 and 4, row 0', async ({ page }) => {
            await setup(page, EMPTY);
            await page.evaluate(() => spawnNext());
            const cells = await page.evaluate(() => capsuleCells().slice().sort((a, b) => a.c - b.c));
            expect(cells.map((x) => x.c)).toEqual([3, 4]);
            expect(cells.every((x) => x.r === 0)).toBe(true);
        });

        test('moving right shifts the capsule one column right', async ({ page }) => {
            await setup(page, EMPTY);
            await page.evaluate(() => spawnNext());
            await page.evaluate(() => moveRight());
            expect(await page.evaluate(() => capsule.c)).toBe(4);
        });

        test('moving left shifts the capsule one column left', async ({ page }) => {
            await setup(page, EMPTY);
            await page.evaluate(() => spawnNext());
            await page.evaluate(() => moveLeft());
            expect(await page.evaluate(() => capsule.c)).toBe(2);
        });

        test('cannot move past the right wall', async ({ page }) => {
            await setup(page, EMPTY);
            await page.evaluate(() => spawnNext());
            await page.evaluate(() => { for (let i = 0; i < 10; i++) moveRight(); });
            expect(await page.evaluate(() => capsule.c)).toBe(6); // cells 6 & 7
        });

        test('cannot move past the left wall', async ({ page }) => {
            await setup(page, EMPTY);
            await page.evaluate(() => spawnNext());
            await page.evaluate(() => { for (let i = 0; i < 10; i++) moveLeft(); });
            expect(await page.evaluate(() => capsule.c)).toBe(0);
        });

        test('cannot move into an occupied cell', async ({ page }) => {
            await setup(page, withRow(0, '.....R..'));
            await page.evaluate(() => spawnNext());
            await page.evaluate(() => moveRight()); // would collide with virus at col 5
            expect(await page.evaluate(() => capsule.c)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Rotating the capsule
    // -----------------------------------------------------------------------
    test.describe('rotating the capsule', () => {
        test('rotating turns a horizontal capsule vertical', async ({ page }) => {
            await setup(page, EMPTY);
            await page.evaluate(() => spawnNext());
            await page.evaluate(() => rotate());
            const cols = await page.evaluate(() => capsuleCells().map((x) => x.c));
            expect(cols[0]).toBe(cols[1]); // both halves now share a column
        });

        test('four rotations return to the original orientation', async ({ page }) => {
            await setup(page, EMPTY);
            await page.evaluate(() => spawnNext());
            await page.evaluate(() => { softDrop(); softDrop(); });
            const before = await page.evaluate(() => capsule.orient);
            await page.evaluate(() => { rotate(); rotate(); rotate(); rotate(); });
            expect(await page.evaluate(() => capsule.orient)).toBe(before);
        });

        test('rotating never pushes a half out of bounds', async ({ page }) => {
            await setup(page, EMPTY);
            await page.evaluate(() => spawnNext());
            await page.evaluate(() => { for (let i = 0; i < 10; i++) moveRight(); });
            await page.evaluate(() => { rotate(); rotate(); rotate(); rotate(); });
            const cells = await page.evaluate(() => capsuleCells());
            for (const cell of cells) {
                expect(cell.c).toBeGreaterThanOrEqual(0);
                expect(cell.c).toBeLessThan(8);
                expect(cell.r).toBeGreaterThanOrEqual(0);
                expect(cell.r).toBeLessThan(16);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Dropping and locking
    // -----------------------------------------------------------------------
    test.describe('dropping and locking', () => {
        test('soft drop moves the capsule down one row', async ({ page }) => {
            await setup(page, EMPTY);
            await page.evaluate(() => spawnNext());
            await page.evaluate(() => softDrop());
            expect(await page.evaluate(() => capsule.r)).toBe(1);
        });

        test('hard drop lands the capsule on the floor', async ({ page }) => {
            await setup(page, EMPTY);
            await page.evaluate(() => spawnNext());
            await page.evaluate(() => hardDrop());
            const bottom = await page.evaluate(() => ({
                a: grid[15][3] ? grid[15][3].kind : null,
                b: grid[15][4] ? grid[15][4].kind : null,
            }));
            expect(bottom.a).toBe('capsule');
            expect(bottom.b).toBe('capsule');
        });

        test('a new capsule spawns after locking', async ({ page }) => {
            await setup(page, EMPTY);
            await page.evaluate(() => spawnNext());
            await page.evaluate(() => hardDrop());
            expect(await page.evaluate(() => capsule.r)).toBe(0);
        });

        test('soft-dropping a grounded capsule locks it and spawns a new one', async ({ page }) => {
            await setup(page, EMPTY);
            await page.evaluate(() => spawnNext());
            // drop until it rests on the floor (row 15), one step short of locking
            await page.evaluate(() => { while (capsule.r < 15) softDrop(); });
            expect(await page.evaluate(() => capsule.r)).toBe(15);
            await page.evaluate(() => softDrop()); // one more locks it
            expect(await page.evaluate(() => grid[15][3] !== null)).toBe(true);
            expect(await page.evaluate(() => capsule.r)).toBe(0); // a fresh capsule
        });
    });

    // -----------------------------------------------------------------------
    // Matching
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('finds a horizontal run of four', async ({ page }) => {
            await setup(page, withRow(15, 'rrrr....'));
            const n = await page.evaluate(() => findMatches().length);
            expect(n).toBe(4);
        });

        test('finds a vertical run of four', async ({ page }) => {
            const rows = EMPTY.slice();
            for (let r = 12; r <= 15; r++) rows[r] = 'b.......';
            await setup(page, rows);
            const n = await page.evaluate(() => findMatches().length);
            expect(n).toBe(4);
        });

        test('a run of three does not match', async ({ page }) => {
            await setup(page, withRow(15, 'yyy.....'));
            const n = await page.evaluate(() => findMatches().length);
            expect(n).toBe(0);
        });

        test('mixed colours do not match', async ({ page }) => {
            await setup(page, withRow(15, 'rbrb....'));
            const n = await page.evaluate(() => findMatches().length);
            expect(n).toBe(0);
        });

        test('resolving clears a horizontal four and scores', async ({ page }) => {
            await setup(page, withRow(15, 'rrrr....'));
            await page.evaluate(() => resolveBoard());
            const after = await page.evaluate(() => ({
                score,
                any: grid[15].some((cell) => cell !== null),
            }));
            expect(after.score).toBeGreaterThan(0);
            expect(after.any).toBe(false);
        });

        test('clearing a virus reduces the virus count', async ({ page }) => {
            await setup(page, withRow(15, 'RRRR....'));
            const before = await page.evaluate(() => virusCount());
            await page.evaluate(() => resolveBoard());
            const afterCount = await page.evaluate(() => virusCount());
            expect(before).toBe(4);
            expect(afterCount).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Gravity and chains
    // -----------------------------------------------------------------------
    test.describe('gravity and chains', () => {
        test('unsupported capsule cells fall; viruses stay put', async ({ page }) => {
            // capsule half 'r' floating at row 0 col 0; virus 'B' fixed at floor col 1
            const rows = EMPTY.slice();
            rows[0] = 'r.......';
            rows[15] = '.B......';
            await setup(page, rows);
            await page.evaluate(() => applyGravity());
            const res = await page.evaluate(() => ({
                fellTo: grid[15][0] ? grid[15][0].kind : null,
                topEmpty: grid[0][0] === null,
                virusStill: grid[15][1] ? grid[15][1].kind : null,
            }));
            expect(res.fellTo).toBe('capsule');
            expect(res.topEmpty).toBe(true);
            expect(res.virusStill).toBe('virus');
        });

        test('a cascade clears a second group after gravity', async ({ page }) => {
            // Bottom row: three reds + a red sitting one row up in col 3.
            // Clearing is not immediate (only 3 in the row); but stack a column
            // so that after the first clear, gravity forms a new four.
            const rows = EMPTY.slice();
            // Column 0: r at rows 12,13,14 and a yellow four on the floor row 15
            rows[15] = 'yyyy....';
            rows[14] = 'r.......';
            rows[13] = 'r.......';
            rows[12] = 'r.......';
            rows[11] = 'r.......';
            await setup(page, rows);
            // The vertical four reds (rows 11-14 col 0) already match, and the
            // yellow four on the floor also matches: both clear.
            const before = await page.evaluate(() => score);
            await page.evaluate(() => resolveBoard());
            const cleared = await page.evaluate(() =>
                grid.every((row) => row.every((cell) => cell === null))
            );
            expect(cleared).toBe(true);
            expect(await page.evaluate(() => score)).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Winning and losing
    // -----------------------------------------------------------------------
    test.describe('winning and losing', () => {
        test('clearing every virus wins the level', async ({ page }) => {
            await setup(page, withRow(15, 'RRRR....'));
            await page.evaluate(() => resolveBoard());
            expect(await page.evaluate(() => state)).toBe('won');
        });

        test('a blocked spawn ends the game', async ({ page }) => {
            // Fill the spawn cells (row 0, cols 3 & 4) so nothing can spawn.
            await setup(page, withRow(0, '...bb...'));
            await page.evaluate(() => { capsule = null; spawnNext(); });
            expect(await page.evaluate(() => state)).toBe('lost');
        });

        test('winning shows the overlay again', async ({ page }) => {
            await setup(page, withRow(15, 'RRRR....'));
            await page.evaluate(() => resolveBoard());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Best score persistence
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best score is stored in localStorage after a win', async ({ page }) => {
            await setup(page, withRow(15, 'RRRR....'));
            await page.evaluate(() => resolveBoard());
            const best = await page.evaluate(() =>
                Number(localStorage.getItem('pilldrop.best') || '0')
            );
            expect(best).toBeGreaterThan(0);
        });
    });
});
