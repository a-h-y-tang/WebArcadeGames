const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Stacker', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Stacker', async ({ page }) => {
            await expect(page).toHaveTitle('Stacker');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains how to drop', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('drop');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 480×640', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '640');
        });

        test('the tower starts with a single base block', async ({ page }) => {
            const n = await page.evaluate(() => tower.length);
            expect(n).toBe(1);
        });

        test('the base block is centred', async ({ page }) => {
            const r = await page.evaluate(() => ({ x: tower[0].x, w: tower[0].w, W: WIDTH }));
            expect(r.x + r.w / 2).toBeCloseTo(r.W / 2, 0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses the overlay', async ({ page }) => {
            await page.keyboard.press(' ');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is running after start', async ({ page }) => {
            await page.keyboard.press(' ');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('an active sliding block exists after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            const ok = await page.evaluate(() => active != null && active.w > 0);
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // The sliding block
    // -----------------------------------------------------------------------
    test.describe('sliding block', () => {
        test('the active block slides over time', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                active.x = 100; active.w = 200; active.vx = 150;
                const x0 = active.x;
                update(0.1);
                return { x0, x1: active.x };
            });
            expect(r.x1).not.toBe(r.x0);
        });

        test('the block bounces off the left wall', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                active.x = 1; active.w = 200; active.vx = -200;
                update(0.1);
                return { x: active.x, vx: active.vx };
            });
            expect(r.vx).toBeGreaterThan(0); // reversed to rightward
            expect(r.x).toBeGreaterThanOrEqual(0);
        });

        test('the block bounces off the right wall', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                active.w = 200; active.x = WIDTH - active.w - 1; active.vx = 300;
                update(0.1);
                return { x: active.x, vx: active.vx, W: WIDTH, w: active.w };
            });
            expect(r.vx).toBeLessThan(0); // reversed to leftward
            expect(r.x + r.w).toBeLessThanOrEqual(r.W + 0.001);
        });
    });

    // -----------------------------------------------------------------------
    // Dropping — the core trim logic
    // -----------------------------------------------------------------------
    test.describe('dropping', () => {
        test('a perfect drop keeps the full width', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                tower = [{ x: 140, w: 200 }];
                active = { x: 140, w: 200, vx: 100 }; // exactly aligned
                drop();
                const top = tower[tower.length - 1];
                return { w: top.w };
            });
            expect(r.w).toBe(200);
        });

        test('a successful drop grows the tower and scores', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                tower = [{ x: 140, w: 200 }];
                active = { x: 140, w: 200, vx: 100 };
                score = 0;
                drop();
                return { n: tower.length, score };
            });
            expect(r.n).toBe(2);
            expect(r.score).toBe(1);
        });

        test('a partial drop trims the block to the overlap width', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                tower = [{ x: 140, w: 200 }];      // spans 140..340
                active = { x: 170, w: 200, vx: 0 }; // spans 170..370, overlap 170..340 = 170
                drop();
                const top = tower[tower.length - 1];
                return { x: top.x, w: top.w };
            });
            expect(r.w).toBe(170);
            expect(r.x).toBe(170);
        });

        test('the width never exceeds the base width', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                // a narrow top; a perfect drop should regrow but never beyond BASE_W
                tower = [{ x: 200, w: 80 }];
                active = { x: 200, w: 80, vx: 0 };
                drop();
                const top = tower[tower.length - 1];
                return { w: top.w, BASE_W };
            });
            expect(r.w).toBeGreaterThan(80);       // regrew
            expect(r.w).toBeLessThanOrEqual(r.BASE_W);
        });

        test('successive imperfect drops shrink the tower', async ({ page }) => {
            await page.locator('#btn-start').click();
            const w = await page.evaluate(() => {
                state = 'paused';
                tower = [{ x: 140, w: 200 }];
                active = { x: 180, w: 200, vx: 0 }; // offset right
                drop();
                let top = tower[tower.length - 1];
                active = { x: top.x + 20, w: top.w, vx: 0 }; // offset again
                drop();
                top = tower[tower.length - 1];
                return top.w;
            });
            expect(w).toBeLessThan(200);
        });

        test('a non-overlapping drop ends the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                state = 'paused';
                tower = [{ x: 0, w: 100 }];         // spans 0..100
                active = { x: 380, w: 100, vx: 0 };  // spans 380..480, no overlap
                drop();
                return state;
            });
            expect(s).toBe('over');
        });

        test('the score display updates in the DOM after a drop', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                tower = [{ x: 140, w: 200 }];
                active = { x: 140, w: 200, vx: 100 };
                score = 0;
                drop();
            });
            await expect(page.locator('#score')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Difficulty ramp
    // -----------------------------------------------------------------------
    test.describe('difficulty', () => {
        test('the block slides faster as the tower grows', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                const v0 = Math.abs(active.vx);
                for (let i = 0; i < 5; i++) {
                    const t = tower[tower.length - 1];
                    active.x = t.x; active.w = t.w; // perfect each time
                    drop();
                }
                return { v0, v1: Math.abs(active.vx) };
            });
            expect(r.v1).toBeGreaterThan(r.v0);
        });
    });

    // -----------------------------------------------------------------------
    // Game over & best score
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('game over shows the overlay with "Game Over"', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 3; endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('best score rises to match a higher score on game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            const best = await page.evaluate(() => { best = 0; score = 17; endGame(); return best; });
            expect(best).toBeGreaterThanOrEqual(17);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { best = 0; score = 9; endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('stacker-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(9);
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 2; endGame(); });
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets the score and tower', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                tower = [{ x: 0, w: 50 }, { x: 0, w: 50 }, { x: 0, w: 50 }];
                score = 42; endGame();
            });
            await page.locator('#btn-start').click();
            await expect(page.locator('#score')).toHaveText('0');
            const n = await page.evaluate(() => tower.length);
            expect(n).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            const s = await page.evaluate(() => state);
            expect(s).toBe('paused');
        });

        test('pause overlay shows "Paused"', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('the block does not slide while paused', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            const before = await page.evaluate(() => active.x);
            await page.waitForTimeout(300);
            const after = await page.evaluate(() => active.x);
            expect(after).toBe(before);
        });
    });
});
