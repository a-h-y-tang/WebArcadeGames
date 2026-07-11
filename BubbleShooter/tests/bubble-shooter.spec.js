const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Helper: clear the whole board to all-null so tests can build deterministic setups.
async function clearGrid(page) {
    await page.evaluate(() => {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < grid[r].length; c++) grid[r][c] = null;
        }
    });
}

test.describe('Bubble Shooter', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Bubble Shooter', async ({ page }) => {
            await expect(page).toHaveTitle('Bubble Shooter');
        });

        test('intro overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay title names the game', async ({ page }) => {
            await expect(page.locator('#overlay-title')).toHaveText('Bubble Shooter');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state starts as idle', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('board is seeded with the configured number of initial rows', async ({ page }) => {
            const { filledRows, initialRows } = await page.evaluate(() => ({
                filledRows: grid.filter(row => row.some(cell => cell !== null)).length,
                initialRows: INITIAL_ROWS,
            }));
            expect(filledRows).toBe(initialRows);
        });

        test('launcher has a current and next colour from the palette', async ({ page }) => {
            const ok = await page.evaluate(() =>
                COLORS.includes(shooter.color) && COLORS.includes(shooter.nextColor)
            );
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Grid geometry
    // -----------------------------------------------------------------------
    test.describe('grid geometry', () => {
        test('canvas width equals COLS * bubble diameter', async ({ page }) => {
            const ok = await page.evaluate(() => canvas.width === COLS * (2 * R));
            expect(ok).toBe(true);
        });

        test('pixelToGrid is the inverse of gridToPixel for interior cells', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (const [r, c] of [[0, 0], [0, 5], [1, 0], [2, 3], [3, 4]]) {
                    const p = gridToPixel(r, c);
                    const g = pixelToGrid(p.x, p.y);
                    if (g.r !== r || g.c !== c) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('even interior cell has 6 neighbours', async ({ page }) => {
            const n = await page.evaluate(() => neighbors(2, 3).length);
            expect(n).toBe(6);
        });

        test('top-left corner cell has fewer than 6 neighbours', async ({ page }) => {
            const n = await page.evaluate(() => neighbors(0, 0).length);
            expect(n).toBeLessThan(6);
        });

        test('neighbours are symmetric', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const ns = neighbors(2, 3);
                return ns.every(([nr, nc]) =>
                    neighbors(nr, nc).some(([br, bc]) => br === 2 && bc === 3)
                );
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses the overlay and enters ready state', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('ready');
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space'); // enter ready state
        });

        test('launcher starts aiming straight up', async ({ page }) => {
            const a = await page.evaluate(() => shooter.angle);
            expect(a).toBeCloseTo(-Math.PI / 2, 5);
        });

        test('ArrowLeft aims further left (smaller angle)', async ({ page }) => {
            const before = await page.evaluate(() => shooter.angle);
            await page.keyboard.press('ArrowLeft');
            const after = await page.evaluate(() => shooter.angle);
            expect(after).toBeLessThan(before);
        });

        test('ArrowRight aims further right (larger angle)', async ({ page }) => {
            const before = await page.evaluate(() => shooter.angle);
            await page.keyboard.press('ArrowRight');
            const after = await page.evaluate(() => shooter.angle);
            expect(after).toBeGreaterThan(before);
        });

        test('aim is clamped and never points downward', async ({ page }) => {
            for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
            const a = await page.evaluate(() => shooter.angle);
            expect(a).toBeLessThan(0); // still above horizontal
            expect(a).toBeLessThanOrEqual(await page.evaluate(() => MAX_ANGLE) + 1e-9);
        });
    });

    // -----------------------------------------------------------------------
    // Firing physics
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('fire() creates a moving bubble and enters firing state', async ({ page }) => {
            const res = await page.evaluate(() => {
                fire();
                return { state, hasBubble: movingBubble !== null };
            });
            expect(res.state).toBe('firing');
            expect(res.hasBubble).toBe(true);
        });

        test('a straight-up shot on an empty board lands and returns to ready', async ({ page }) => {
            await clearGrid(page);
            const res = await page.evaluate(() => {
                shooter.angle = -Math.PI / 2;
                const before = shotsFired;
                fire();
                let steps = 0;
                while (state === 'firing' && steps < 500) { stepMovingBubble(); steps++; }
                return { state, movingBubble, shotsDelta: shotsFired - before };
            });
            expect(res.state).toBe('ready');
            expect(res.movingBubble).toBeNull();
            expect(res.shotsDelta).toBe(1);
        });

        test('a landed shot occupies a grid cell', async ({ page }) => {
            await clearGrid(page);
            const filled = await page.evaluate(() => {
                shooter.angle = -Math.PI / 2;
                fire();
                let steps = 0;
                while (state === 'firing' && steps < 500) { stepMovingBubble(); steps++; }
                return grid.flat().filter(c => c !== null).length;
            });
            expect(filled).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Matching & popping
    // -----------------------------------------------------------------------
    test.describe('matching and popping', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
            await clearGrid(page);
        });

        test('completing a group of three pops all three', async ({ page }) => {
            const res = await page.evaluate(() => {
                grid[0][0] = 'r'; grid[0][1] = 'r';   // two reds on the ceiling
                const result = landBubble(1, 0, 'r');  // (1,0) neighbours both -> group of 3
                return { result, remaining: grid.flat().filter(c => c !== null).length };
            });
            expect(res.result.popped).toBe(3);
            expect(res.remaining).toBe(0);
        });

        test('a group of two does not pop', async ({ page }) => {
            const res = await page.evaluate(() => {
                grid[0][0] = 'r';
                const result = landBubble(1, 0, 'r'); // only two reds
                return { result, remaining: grid.flat().filter(c => c !== null).length };
            });
            expect(res.result.popped).toBe(0);
            expect(res.remaining).toBe(2);
        });

        test('popping increases the score', async ({ page }) => {
            const score = await page.evaluate(() => {
                grid[0][0] = 'r'; grid[0][1] = 'r';
                landBubble(1, 0, 'r');
                return score;
            });
            expect(score).toBeGreaterThan(0);
        });

        test('score is reflected in the DOM', async ({ page }) => {
            await page.evaluate(() => {
                grid[0][0] = 'r'; grid[0][1] = 'r';
                landBubble(1, 0, 'r');
            });
            await expect(page.locator('#score')).not.toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Floating bubbles drop
    // -----------------------------------------------------------------------
    test.describe('floating bubbles', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
            await clearGrid(page);
        });

        test('a bubble left unconnected to the ceiling drops', async ({ page }) => {
            const res = await page.evaluate(() => {
                grid[0][0] = 'b';           // blue anchor connected to the ceiling
                grid[1][0] = 'r'; grid[1][1] = 'r'; // red bridge
                grid[2][0] = 'g';           // green hangs only from the red bridge
                const result = landBubble(1, 2, 'r'); // reds become a group of 3 -> pop
                return { result, remaining: grid.flat().filter(c => c !== null) };
            });
            expect(res.result.popped).toBe(3);   // three reds
            expect(res.result.dropped).toBe(1);  // the orphaned green
            // Only the blue anchor should remain.
            expect(res.remaining).toEqual(['b']);
        });

        test('dropped bubbles are worth score', async ({ page }) => {
            const gained = await page.evaluate(() => {
                const before = score;
                grid[0][0] = 'b';
                grid[1][0] = 'r'; grid[1][1] = 'r';
                grid[2][0] = 'g';
                landBubble(1, 2, 'r');
                return score - before;
            });
            // 3 popped * 10 + 1 dropped * 20 = 50
            expect(gained).toBe(50);
        });
    });

    // -----------------------------------------------------------------------
    // Win / lose
    // -----------------------------------------------------------------------
    test.describe('win and lose', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
            await clearGrid(page);
        });

        test('clearing the board wins the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                grid[0][0] = 'r'; grid[0][1] = 'r';
                landBubble(1, 0, 'r'); // pops the last three -> board empty
                return state;
            });
            expect(s).toBe('won');
        });

        test('winning shows the overlay with a win message', async ({ page }) => {
            await page.evaluate(() => {
                grid[0][0] = 'r'; grid[0][1] = 'r';
                landBubble(1, 0, 'r');
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win/i);
        });

        test('landing a bubble below the death line loses the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                // find a row whose pixel centre is below the death line
                let deathRow = 0;
                for (let r = 0; r < ROWS; r++) {
                    if (gridToPixel(r, 0).y > DEATH_Y) { deathRow = r; break; }
                }
                landBubble(deathRow, 0, 'r'); // lone bubble, no pop
                return state;
            });
            expect(s).toBe('lost');
        });

        test('losing shows the overlay with a game over message', async ({ page }) => {
            await page.evaluate(() => {
                let deathRow = 0;
                for (let r = 0; r < ROWS; r++) {
                    if (gridToPixel(r, 0).y > DEATH_Y) { deathRow = r; break; }
                }
                landBubble(deathRow, 0, 'r');
            });
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });
    });

    // -----------------------------------------------------------------------
    // Best score persistence
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best score persists to localStorage on win', async ({ page }) => {
            await page.keyboard.press('Space');
            await clearGrid(page);
            await page.evaluate(() => {
                grid[0][0] = 'r'; grid[0][1] = 'r';
                landBubble(1, 0, 'r'); // score 30, then win
            });
            const stored = await page.evaluate(() =>
                parseInt(localStorage.getItem('bubble-shooter-best') || '0', 10)
            );
            expect(stored).toBeGreaterThan(0);
        });
    });
});
