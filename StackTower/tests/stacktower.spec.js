const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Stack Tower', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Stack Tower', async ({ page }) => {
            await expect(page).toHaveTitle('Stack Tower');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/drop|space|tap/i);
        });

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 400x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '400');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no blocks before starting', async ({ page }) => {
            expect(await page.evaluate(() => blocks.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('stack-best', '99'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('99');
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('ArrowUp starts the game', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting places exactly one base block', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return blocks.length; });
            expect(n).toBe(1);
        });

        test('starting spawns a moving block above the base', async ({ page }) => {
            const above = await page.evaluate(() => {
                startGame();
                return moving && moving.y < blocks[0].y;
            });
            expect(above).toBe(true);
        });

        test('score is 0 right after starting', async ({ page }) => {
            expect(await page.evaluate(() => { startGame(); return score; })).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Moving block motion
    // -----------------------------------------------------------------------
    test.describe('moving block', () => {
        test('the block moves horizontally over time', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const before = moving.x;
                step(0.1);
                return { before, after: moving.x };
            });
            expect(after).not.toBe(before);
        });

        test('the block stays within the canvas bounds', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    if (moving.x < -0.001) return false;
                    if (moving.x + moving.w > CANVAS_W + 0.001) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the block bounces off the walls (direction reverses)', async ({ page }) => {
            const reversed = await page.evaluate(() => {
                startGame();
                const startDir = Math.sign(moving.vx);
                for (let i = 0; i < 600; i++) {
                    step(0.016);
                    if (Math.sign(moving.vx) === -startDir) return true;
                }
                return false;
            });
            expect(reversed).toBe(true);
        });

        test('the moving block does not advance while idle', async ({ page }) => {
            const moved = await page.evaluate(() => {
                // no startGame — still idle
                step(0.2);
                return typeof moving !== 'undefined' && moving !== null;
            });
            expect(moved).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Dropping — partial overlap slices the block
    // -----------------------------------------------------------------------
    test.describe('dropping and slicing', () => {
        test('a partial overlap narrows the tower', async ({ page }) => {
            const { topW, newW } = await page.evaluate(() => {
                startGame();
                const top = blocks[blocks.length - 1];
                const topW = top.w;
                // offset the moving block by a quarter of its width to the right
                moving.x = top.x + top.w / 4;
                dropBlock();
                const placed = blocks[blocks.length - 1];
                return { topW, newW: placed.w };
            });
            expect(newW).toBeLessThan(topW);
            expect(newW).toBeCloseTo(topW * 0.75, 1);
        });

        test('a successful drop stacks a new block and scores a point', async ({ page }) => {
            const { count, score } = await page.evaluate(() => {
                startGame();
                const top = blocks[blocks.length - 1];
                moving.x = top.x + 10; // small overlap loss, still lands
                dropBlock();
                return { count: blocks.length, score };
            });
            expect(count).toBe(2);
            expect(score).toBe(1);
        });

        test('the placed block sits one block-height above the previous top', async ({ page }) => {
            const dy = await page.evaluate(() => {
                startGame();
                const prevTopY = blocks[blocks.length - 1].y;
                moving.x = blocks[blocks.length - 1].x + 8;
                dropBlock();
                return prevTopY - blocks[blocks.length - 1].y;
            });
            expect(dy).toBeCloseTo(await page.evaluate(() => BLOCK_H), 1);
        });

        test('after a drop a fresh moving block spawns with the new width', async ({ page }) => {
            const { placedW, movingW } = await page.evaluate(() => {
                startGame();
                const top = blocks[blocks.length - 1];
                moving.x = top.x + top.w / 4;
                dropBlock();
                const placed = blocks[blocks.length - 1];
                return { placedW: placed.w, movingW: moving.w };
            });
            expect(movingW).toBeCloseTo(placedW, 5);
        });

        test('dropping speeds up the next block', async ({ page }) => {
            const { s1, s2 } = await page.evaluate(() => {
                startGame();
                const s1 = Math.abs(moving.vx);
                moving.x = blocks[blocks.length - 1].x;
                dropBlock();
                const s2 = Math.abs(moving.vx);
                return { s1, s2 };
            });
            expect(s2).toBeGreaterThan(s1);
        });
    });

    // -----------------------------------------------------------------------
    // Perfect drops
    // -----------------------------------------------------------------------
    test.describe('perfect drops', () => {
        test('a perfectly aligned drop keeps the full width', async ({ page }) => {
            const { topW, newW } = await page.evaluate(() => {
                startGame();
                const top = blocks[blocks.length - 1];
                moving.x = top.x; // exact alignment
                dropBlock();
                return { topW: top.w, newW: blocks[blocks.length - 1].w };
            });
            expect(newW).toBeCloseTo(topW, 5);
        });

        test('a near-perfect drop within epsilon snaps and keeps width', async ({ page }) => {
            const { topX, topW, newX, newW } = await page.evaluate(() => {
                startGame();
                const top = blocks[blocks.length - 1];
                moving.x = top.x + PERFECT_EPS * 0.5; // inside the epsilon window
                dropBlock();
                const placed = blocks[blocks.length - 1];
                return { topX: top.x, topW: top.w, newX: placed.x, newW: placed.w };
            });
            expect(newW).toBeCloseTo(topW, 5);
            expect(newX).toBeCloseTo(topX, 5); // snapped exactly onto the top
        });

        test('perfect drops build a combo, imperfect resets it', async ({ page }) => {
            const combos = await page.evaluate(() => {
                startGame();
                const out = [];
                // two perfects in a row
                moving.x = blocks[blocks.length - 1].x;
                dropBlock();
                out.push(combo);
                moving.x = blocks[blocks.length - 1].x;
                dropBlock();
                out.push(combo);
                // now an imperfect drop
                moving.x = blocks[blocks.length - 1].x + blocks[blocks.length - 1].w / 4;
                dropBlock();
                out.push(combo);
                return out;
            });
            expect(combos[0]).toBe(1);
            expect(combos[1]).toBe(2);
            expect(combos[2]).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Missing — game over
    // -----------------------------------------------------------------------
    test.describe('missing and game over', () => {
        test('a complete miss ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const top = blocks[blocks.length - 1];
                // make both narrow and separate them so there is genuinely no overlap
                top.w = 40; top.x = 20;   // spans 20..60
                moving.w = 40; moving.x = 300; // spans 300..340 — no overlap
                dropBlock();
                return state;
            });
            expect(s).toBe('over');
        });

        test('a miss does not add a block to the tower', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                // make the base narrow and park it far left so a right-side drop misses
                const top = blocks[blocks.length - 1];
                top.w = 40; top.x = 20;
                moving.w = 40; moving.x = 300;
                const before = blocks.length;
                dropBlock();
                return { before, after: blocks.length };
            });
            expect(after).toBe(before);
        });

        test('game over shows the overlay with a restart button', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText(/again|restart/i);
        });

        test('dropping after game over does nothing', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                endGame();
                const before = blocks.length;
                dropBlock();
                return blocks.length - before;
            });
            expect(count).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 25;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('25');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 17;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('stack-best'));
            expect(parseInt(stored, 10)).toBe(17);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('stack-best', '50'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 3;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('50');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the moving block', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                togglePause();
                const before = moving.x;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: moving.x };
            });
            expect(after).toBe(before);
        });

        test('resuming lets the block move again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                togglePause();
                togglePause();
                const before = moving.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return moving.x !== before;
            });
            expect(moved).toBe(true);
        });

        test('dropping is ignored while paused', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                togglePause();
                const before = blocks.length;
                dropBlock();
                return blocks.length - before;
            });
            expect(count).toBe(0);
        });

        test('restart after game over resets score and tower', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                score = 42;
                moving.x = blocks[blocks.length - 1].x;
                dropBlock();
                endGame();
                startGame();
                return { score, blocks: blocks.length, state };
            });
            expect(result.score).toBe(0);
            expect(result.blocks).toBe(1); // just the base again
            expect(result.state).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Camera
    // -----------------------------------------------------------------------
    test.describe('camera', () => {
        test('the camera scrolls up as the tower grows tall', async ({ page }) => {
            const rose = await page.evaluate(() => {
                startGame();
                const start = cameraY;
                // stack many perfect blocks
                for (let i = 0; i < 20; i++) {
                    moving.x = blocks[blocks.length - 1].x;
                    dropBlock();
                }
                // let the camera lerp toward its target
                for (let i = 0; i < 120; i++) step(0.016);
                return cameraY < start; // world y decreases upward, camera follows
            });
            expect(rose).toBe(true);
        });
    });
});
