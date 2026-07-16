const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Tower Stack', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // Deterministic start every test.
        await page.evaluate(() => localStorage.clear());
        await page.reload();
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tower Stack', async ({ page }) => {
            await expect(page).toHaveTitle('Tower Stack');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to press space', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space/i);
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 400×600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '400');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('game state is idle before start', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('tower has a single base block that is centered', async ({ page }) => {
            const info = await page.evaluate(() => ({
                len: tower.length,
                base: tower[0],
                w: CANVAS_W,
                iw: INITIAL_W,
            }));
            expect(info.len).toBe(1);
            expect(info.base.w).toBe(info.iw);
            // Centered
            expect(info.base.x).toBeCloseTo((info.w - info.iw) / 2, 1);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('clicking the canvas starts the game', async ({ page }) => {
            await page.locator('#canvas').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a moving block exists once running', async ({ page }) => {
            await page.keyboard.press('Space');
            const cur = await page.evaluate(() => ({ ...current }));
            expect(cur.w).toBeGreaterThan(0);
        });

        test('starting does not immediately drop a block', async ({ page }) => {
            await page.keyboard.press('Space');
            const len = await page.evaluate(() => tower.length);
            expect(len).toBe(1); // still just the base
        });
    });

    // -----------------------------------------------------------------------
    // Block movement
    // -----------------------------------------------------------------------
    test.describe('block movement', () => {
        test('the moving block slides horizontally over time', async ({ page }) => {
            await page.keyboard.press('Space');
            const x1 = await page.evaluate(() => current.x);
            await page.waitForTimeout(200);
            const x2 = await page.evaluate(() => current.x);
            expect(x2).not.toBe(x1);
        });

        test('the block bounces and stays within the canvas', async ({ page }) => {
            await page.keyboard.press('Space');
            let minSeen = Infinity;
            let maxSeen = -Infinity;
            for (let i = 0; i < 15; i++) {
                const { x, w, cw } = await page.evaluate(() => ({
                    x: current.x, w: current.w, cw: CANVAS_W,
                }));
                minSeen = Math.min(minSeen, x);
                maxSeen = Math.max(maxSeen, x + w);
                expect(x).toBeGreaterThanOrEqual(-0.5);
                expect(x + w).toBeLessThanOrEqual(cw + 0.5);
                await page.waitForTimeout(40);
            }
            // It genuinely moved across a meaningful span.
            expect(maxSeen - minSeen).toBeGreaterThan(20);
        });
    });

    // -----------------------------------------------------------------------
    // Dropping blocks
    // -----------------------------------------------------------------------
    test.describe('dropping blocks', () => {
        test('a perfectly aligned drop grows the tower and scores', async ({ page }) => {
            await page.keyboard.press('Space');
            const result = await page.evaluate(() => {
                // Align current exactly over the tower top, then drop.
                const top = tower[tower.length - 1];
                current.x = top.x;
                current.w = top.w;
                dropBlock();
                return { len: tower.length, score };
            });
            expect(result.len).toBe(2);
            expect(result.score).toBeGreaterThanOrEqual(1);
        });

        test('a partial overlap trims the placed block to the overlap width', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => {
                const top = tower[tower.length - 1];
                // Offset far enough to beat the perfect tolerance but still overlap.
                current.x = top.x + 40;
                current.w = top.w;
                dropBlock();
                const placed = tower[tower.length - 1];
                return { placedW: placed.w, placedX: placed.x, topX: top.x, topW: top.w };
            });
            // Overlap of a block offset right by 40 with width == top.w is top.w - 40.
            expect(r.placedW).toBeCloseTo(r.topW - 40, 1);
            // Placed block's left edge is the right edge of the overlap region.
            expect(r.placedX).toBeCloseTo(r.topX + 40, 1);
        });

        test('the placed block is never wider than the block below it', async ({ page }) => {
            await page.keyboard.press('Space');
            const ok = await page.evaluate(() => {
                const top = tower[tower.length - 1];
                current.x = top.x + 25;
                current.w = top.w;
                dropBlock();
                const placed = tower[tower.length - 1];
                return placed.w <= top.w + 0.001;
            });
            expect(ok).toBe(true);
        });

        test('score increments on each successful drop', async ({ page }) => {
            await page.keyboard.press('Space');
            const scores = await page.evaluate(() => {
                const out = [];
                for (let i = 0; i < 3; i++) {
                    const top = tower[tower.length - 1];
                    current.x = top.x; // perfect each time
                    current.w = top.w;
                    dropBlock();
                    out.push(score);
                }
                return out;
            });
            expect(scores[0]).toBeLessThan(scores[1]);
            expect(scores[1]).toBeLessThan(scores[2]);
        });

        test('score display updates in the DOM after a drop', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                const top = tower[tower.length - 1];
                current.x = top.x;
                current.w = top.w;
                dropBlock();
            });
            await expect(page.locator('#score')).not.toHaveText('0');
        });

        test('a new moving block spawns after a successful drop', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => {
                const top = tower[tower.length - 1];
                current.x = top.x;
                current.w = top.w;
                dropBlock();
                return { hasCurrent: !!current, curW: current.w, running: state === 'running' };
            });
            expect(r.hasCurrent).toBe(true);
            expect(r.curW).toBeGreaterThan(0);
            expect(r.running).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Perfect drops
    // -----------------------------------------------------------------------
    test.describe('perfect drops', () => {
        test('a perfect drop keeps the full width (no trim)', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => {
                const top = tower[tower.length - 1];
                current.x = top.x + 2; // within PERFECT_TOL
                current.w = top.w;
                dropBlock();
                const placed = tower[tower.length - 1];
                return { placedW: placed.w, topW: top.w, tol: PERFECT_TOL };
            });
            expect(r.tol).toBeGreaterThanOrEqual(2);
            expect(r.placedW).toBeGreaterThanOrEqual(r.topW);
        });

        test('a perfect drop scores more than a sloppy drop', async ({ page }) => {
            const perfectGain = await page.evaluate(() => {
                startGame();
                const top = tower[tower.length - 1];
                current.x = top.x;
                current.w = top.w;
                const before = score;
                dropBlock();
                return score - before;
            });
            const sloppyGain = await page.evaluate(() => {
                startGame();
                const top = tower[tower.length - 1];
                current.x = top.x + 30;
                current.w = top.w;
                const before = score;
                dropBlock();
                return score - before;
            });
            expect(perfectGain).toBeGreaterThan(sloppyGain);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('dropping with no overlap ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                const top = tower[tower.length - 1];
                // Push the block entirely past the right edge of the block below.
                current.x = top.x + top.w + 5;
                current.w = top.w;
                dropBlock();
                return state;
            });
            expect(s).toBe('over');
        });

        test('a missed drop does not add a block to the tower', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => {
                const before = tower.length;
                const top = tower[tower.length - 1];
                current.x = top.x + top.w + 10;
                current.w = top.w;
                dropBlock();
                return { before, after: tower.length };
            });
            expect(r.after).toBe(r.before);
        });

        test('game over overlay is shown with "Game Over"', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('Play Again button appears after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText(/play again/i);
        });

        test('space after game over restarts with score 0', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                const top = tower[tower.length - 1];
                current.x = top.x;
                current.w = top.w;
                dropBlock(); // score up
                endGame();
            });
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#score')).toHaveText('0');
            expect(await page.evaluate(() => tower.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Best score persistence
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best score updates on game over when the score is higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                for (let i = 0; i < 3; i++) {
                    const top = tower[tower.length - 1];
                    current.x = top.x;
                    current.w = top.w;
                    dropBlock();
                }
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent(), 10);
            expect(best).toBeGreaterThanOrEqual(3);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                const top = tower[tower.length - 1];
                current.x = top.x;
                current.w = top.w;
                dropBlock();
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('tower-stack-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(1);
        });

        test('a lower score does not overwrite a higher best', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('tower-stack-best', '99'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('99');
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                const top = tower[tower.length - 1];
                current.x = top.x;
                current.w = top.w;
                dropBlock();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('99');
        });
    });
});
