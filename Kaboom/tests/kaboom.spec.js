const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Kaboom!', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Kaboom!', async ({ page }) => {
            await expect(page).toHaveTitle('Kaboom!');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no bombs before starting', async ({ page }) => {
            expect(await page.evaluate(() => bombs.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('kaboom-best', '873'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('873');
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

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('game starts on wave 1 with 3 buckets', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { wave, buckets, score }; });
            expect(s.wave).toBe(1);
            expect(s.buckets).toBe(3);
            expect(s.score).toBe(0);
        });

        test('bomber starts within the play field', async ({ page }) => {
            const inBounds = await page.evaluate(() => {
                startGame();
                return bomber.x >= 0 && bomber.x <= CANVAS_W;
            });
            expect(inBounds).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Player movement
    // -----------------------------------------------------------------------
    test.describe('player movement', () => {
        test('moving left decreases the paddle x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setPlayerX(300);
                const before = player.x;
                movePlayer(-1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('moving right increases the paddle x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setPlayerX(300);
                const before = player.x;
                movePlayer(1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('paddle cannot move off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                setPlayerX(50);
                movePlayer(-1);
                for (let i = 0; i < 300; i++) step(0.016);
                return player.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
        });

        test('paddle cannot move off the right edge', async ({ page }) => {
            const { x, w } = await page.evaluate(() => {
                startGame();
                setPlayerX(550);
                movePlayer(1);
                for (let i = 0; i < 300; i++) step(0.016);
                return { x: player.x, w: CANVAS_W };
            });
            expect(x).toBeLessThanOrEqual(w);
        });

        test('ArrowRight key moves the paddle right', async ({ page }) => {
            await page.evaluate(() => { startGame(); setPlayerX(300); });
            const before = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => player.x);
            expect(after).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Bomb spawning & falling
    // -----------------------------------------------------------------------
    test.describe('bombs', () => {
        test('spawnBomb adds a bomb at the given position', async ({ page }) => {
            const bomb = await page.evaluate(() => {
                startGame();
                bombs.length = 0;
                spawnBomb({ x: 123, y: 50 });
                return { x: bombs[0].x, y: bombs[0].y, count: bombs.length };
            });
            expect(bomb.count).toBe(1);
            expect(bomb.x).toBe(123);
            expect(bomb.y).toBe(50);
        });

        test('bombs fall downward over time', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                bombs.length = 0;
                spawnBomb({ x: 300, y: 50 });
                const before = bombs[0].y;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: bombs[0].y };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('the bomber drops bombs automatically as time passes', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                bombs.length = 0;
                for (let i = 0; i < 200; i++) step(0.016);
                return bombs.length;
            });
            expect(count).toBeGreaterThan(0);
        });

        test('the bomber moves and bounces off the walls', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const start = bomber.x;
                let sawMovement = false;
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    if (Math.abs(bomber.x - start) > 1) sawMovement = true;
                    // must always stay in bounds
                    if (bomber.x < 0 || bomber.x > CANVAS_W) return { ok: false };
                }
                return { ok: true, sawMovement };
            });
            expect(moved.ok).toBe(true);
            expect(moved.sawMovement).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Catching
    // -----------------------------------------------------------------------
    test.describe('catching', () => {
        test('a bomb aligned with the paddle is caught and scores', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                bombs.length = 0;
                setPlayerX(300);
                spawnBomb({ x: 300, y: catchLineY() - 5 });
                for (let i = 0; i < 10; i++) step(0.016);
                return { bombs: bombs.length, score };
            });
            expect(result.bombs).toBe(0);
            expect(result.score).toBeGreaterThan(0);
        });

        test('catching increments progress toward the wave', async ({ page }) => {
            const caught = await page.evaluate(() => {
                startGame();
                bombs.length = 0;
                setPlayerX(300);
                spawnBomb({ x: 300, y: catchLineY() - 5 });
                for (let i = 0; i < 10; i++) step(0.016);
                return caughtThisWave;
            });
            expect(caught).toBe(1);
        });

        test('a bomb worth more points in later waves', async ({ page }) => {
            const { w1, w3 } = await page.evaluate(() => {
                startGame();
                bombs.length = 0;
                setPlayerX(300);
                spawnBomb({ x: 300, y: catchLineY() - 5 });
                for (let i = 0; i < 10; i++) step(0.016);
                const w1 = score;
                // jump to wave 3 and catch another
                wave = 3;
                score = 0;
                spawnBomb({ x: 300, y: catchLineY() - 5 });
                for (let i = 0; i < 10; i++) step(0.016);
                const w3 = score;
                return { w1, w3 };
            });
            expect(w3).toBeGreaterThan(w1);
        });
    });

    // -----------------------------------------------------------------------
    // Missing
    // -----------------------------------------------------------------------
    test.describe('missing', () => {
        test('a bomb far from the paddle is missed and costs a bucket', async ({ page }) => {
            // Step only long enough for the miss to resolve; running much longer
            // would let the bomber auto-drop fresh bombs after the board clears.
            const result = await page.evaluate(() => {
                startGame();
                bombs.length = 0;
                setPlayerX(100);
                spawnBomb({ x: 500, y: catchLineY() - 5 });
                for (let i = 0; i < 60; i++) step(0.016);
                return { buckets, bombs: bombs.length };
            });
            expect(result.buckets).toBe(2);
            expect(result.bombs).toBe(0);
        });

        test('a miss detonates every bomb on screen', async ({ page }) => {
            const remaining = await page.evaluate(() => {
                startGame();
                bombs.length = 0;
                setPlayerX(100);
                // one bomb about to be missed, plus two high up
                spawnBomb({ x: 500, y: catchLineY() - 5 });
                spawnBomb({ x: 200, y: 60 });
                spawnBomb({ x: 400, y: 80 });
                for (let i = 0; i < 60; i++) step(0.016);
                return bombs.length;
            });
            expect(remaining).toBe(0);
        });

        test('a miss resets wave progress', async ({ page }) => {
            const caught = await page.evaluate(() => {
                startGame();
                bombs.length = 0;
                setPlayerX(300);
                // catch one
                spawnBomb({ x: 300, y: catchLineY() - 5 });
                for (let i = 0; i < 10; i++) step(0.016);
                // then miss one
                setPlayerX(100);
                spawnBomb({ x: 500, y: catchLineY() - 5 });
                for (let i = 0; i < 60; i++) step(0.016);
                return caughtThisWave;
            });
            expect(caught).toBe(0);
        });

        test('losing the last bucket ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                buckets = 1;
                bombs.length = 0;
                setPlayerX(100);
                spawnBomb({ x: 500, y: catchLineY() - 5 });
                for (let i = 0; i < 200; i++) step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('catching a full group advances to the next wave', async ({ page }) => {
            const { wave, caught } = await page.evaluate(() => {
                startGame();
                setPlayerX(300);
                for (let n = 0; n < BOMBS_PER_WAVE; n++) {
                    bombs.length = 0;
                    spawnBomb({ x: 300, y: catchLineY() - 5 });
                    for (let i = 0; i < 10; i++) step(0.016);
                }
                return { wave, caught: caughtThisWave };
            });
            expect(wave).toBe(2);
            expect(caught).toBe(0);
        });

        test('clearing a wave awards a bonus bucket up to the cap', async ({ page }) => {
            const buckets = await page.evaluate(() => {
                startGame();
                buckets = 3;
                setPlayerX(300);
                for (let n = 0; n < BOMBS_PER_WAVE; n++) {
                    bombs.length = 0;
                    spawnBomb({ x: 300, y: catchLineY() - 5 });
                    for (let i = 0; i < 10; i++) step(0.016);
                }
                return buckets;
            });
            expect(buckets).toBe(4);
        });

        test('buckets never exceed the maximum', async ({ page }) => {
            const { buckets, max } = await page.evaluate(() => {
                startGame();
                buckets = MAX_BUCKETS;
                setPlayerX(300);
                for (let n = 0; n < BOMBS_PER_WAVE; n++) {
                    bombs.length = 0;
                    spawnBomb({ x: 300, y: catchLineY() - 5 });
                    for (let i = 0; i < 10; i++) step(0.016);
                }
                return { buckets, max: MAX_BUCKETS };
            });
            expect(buckets).toBe(max);
        });

        test('bombs fall faster in later waves', async ({ page }) => {
            const { slow, fast } = await page.evaluate(() => {
                startGame();
                wave = 1;
                bombs.length = 0;
                spawnBomb({ x: 50, y: 20 });
                const y0 = bombs[0].y;
                step(0.1);
                const slow = bombs[0].y - y0;
                wave = 6;
                bombs.length = 0;
                spawnBomb({ x: 50, y: 20 });
                const y1 = bombs[0].y;
                step(0.1);
                const fast = bombs[0].y - y1;
                return { slow, fast };
            });
            expect(fast).toBeGreaterThan(slow);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 456;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('456');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 321;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('kaboom-best'));
            expect(parseInt(stored, 10)).toBe(321);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('kaboom-best', '9000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 10;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the bombs', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                bombs.length = 0;
                spawnBomb({ x: 300, y: 50 });
                togglePause();
                const before = bombs[0].y;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: bombs[0].y };
            });
            expect(after).toBe(before);
        });

        test('resuming lets the bombs fall again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                bombs.length = 0;
                spawnBomb({ x: 300, y: 50 });
                togglePause();
                togglePause();
                const before = bombs[0].y;
                for (let i = 0; i < 10; i++) step(0.016);
                return bombs[0].y > before;
            });
            expect(moved).toBe(true);
        });

        test('restart after game over resets score, wave, buckets and bombs', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                score = 999;
                wave = 5;
                buckets = 1;
                spawnBomb({ x: 100, y: 100 });
                endGame();
                startGame();
                return { score, wave, buckets, bombs: bombs.length, state };
            });
            expect(result.score).toBe(0);
            expect(result.wave).toBe(1);
            expect(result.buckets).toBe(3);
            expect(result.bombs).toBe(0);
            expect(result.state).toBe('running');
        });
    });
});
