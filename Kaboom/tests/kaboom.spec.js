const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Kaboom!', () => {
    // Each test runs in a fresh browser context, so localStorage starts empty
    // — no manual clearing needed (and clearing on reload would break the
    // best-score persistence test below).
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state / DOM
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Kaboom!', async ({ page }) => {
            await expect(page).toHaveTitle('Kaboom!');
        });

        test('canvas is 480×640', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '640');
        });

        test('start overlay is visible before play', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/catch/i);
        });

        test('game starts in idle state', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });

        test('starts with 3 buckets', async ({ page }) => {
            const b = await page.evaluate(() => buckets);
            expect(b).toBe(3);
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('wave starts at 1', async ({ page }) => {
            await expect(page.locator('#wave')).toHaveText('1');
        });

        test('buckets readout starts at 3', async ({ page }) => {
            await expect(page.locator('#buckets')).toHaveText('3');
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('clicking Start hides the overlay and enters playing', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('playing');
        });

        test('Space starts the game', async ({ page }) => {
            await page.locator('#canvas').focus().catch(() => {});
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => state);
            expect(s).toBe('playing');
        });

        test('a fresh game resets score, wave and buckets', async ({ page }) => {
            const st = await page.evaluate(() => {
                score = 999; wave = 7; buckets = 1;
                startGame();
                return { score, wave, buckets, state };
            });
            expect(st).toEqual({ score: 0, wave: 1, buckets: 3, state: 'playing' });
        });
    });

    // -----------------------------------------------------------------------
    // Paddle movement
    // -----------------------------------------------------------------------
    test.describe('paddle', () => {
        test('movePaddle shifts the stack right', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                paddleX = 240;
                movePaddle(50);
                return paddleX;
            });
            expect(x).toBe(290);
        });

        test('paddle is clamped to the left wall', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                paddleX = 240;
                movePaddle(-10000);
                return paddleLeft() >= 0;
            });
            expect(ok).toBe(true);
        });

        test('paddle is clamped to the right wall', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                paddleX = 240;
                movePaddle(10000);
                return paddleRight() <= 480;
            });
            expect(ok).toBe(true);
        });

        test('ArrowRight moves the paddle right', async ({ page }) => {
            await page.locator('#btn-start').click();
            const before = await page.evaluate(() => paddleX);
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowRight');
            const after = await page.evaluate(() => paddleX);
            expect(after).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Catching bombs
    // -----------------------------------------------------------------------
    test.describe('catching', () => {
        test('a bomb over the paddle at the bucket line is caught', async ({ page }) => {
            const caught = await page.evaluate(() => {
                startGame();
                paddleX = 240;
                return bombCaught({ x: 240, y: BUCKET_Y, r: 8 });
            });
            expect(caught).toBe(true);
        });

        test('a bomb far to the side is not caught', async ({ page }) => {
            const caught = await page.evaluate(() => {
                startGame();
                paddleX = 240;
                return bombCaught({ x: 10, y: BUCKET_Y, r: 8 });
            });
            expect(caught).toBe(false);
        });

        test('a bomb well above the bucket line is not yet caught', async ({ page }) => {
            const caught = await page.evaluate(() => {
                startGame();
                paddleX = 240;
                return bombCaught({ x: 240, y: 100, r: 8 });
            });
            expect(caught).toBe(false);
        });

        test('catching a bomb increases score by the wave value', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                wave = 3;
                paddleX = 240;
                score = 0;
                bombs = [{ x: 240, y: BUCKET_Y, r: 8 }];
                stepBombs(0);
                return { score, bombCount: bombs.length };
            });
            expect(res.score).toBe(3);
            expect(res.bombCount).toBe(0);
        });

        test('score HUD updates after a catch', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                wave = 1;
                paddleX = 240;
                bombs = [{ x: 240, y: BUCKET_Y, r: 8 }];
                stepBombs(0);
            });
            await expect(page.locator('#score')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Missing bombs
    // -----------------------------------------------------------------------
    test.describe('missing', () => {
        test('a bomb falling past the bottom costs a bucket', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                buckets = 3;
                paddleX = 0; // paddle far away so no catch
                bombs = [{ x: 470, y: 700, r: 8 }];
                stepBombs(0);
                return { buckets, bombCount: bombs.length };
            });
            expect(res.buckets).toBe(2);
            expect(res.bombCount).toBe(0);
        });

        test('a miss clears all bombs on screen', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                paddleX = 0;
                bombs = [
                    { x: 470, y: 700, r: 8 },
                    { x: 100, y: 100, r: 8 },
                    { x: 200, y: 300, r: 8 },
                ];
                stepBombs(0);
                return bombs.length;
            });
            expect(n).toBe(0);
        });

        test('losing the last bucket ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                buckets = 1;
                paddleX = 0;
                bombs = [{ x: 470, y: 700, r: 8 }];
                stepBombs(0);
                return state;
            });
            expect(s).toBe('over');
        });

        test('game over shows the overlay again', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                buckets = 1;
                paddleX = 0;
                bombs = [{ x: 470, y: 700, r: 8 }];
                stepBombs(0);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });
    });

    // -----------------------------------------------------------------------
    // Falling physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('bombs fall downward over time', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                paddleX = 0;
                bombs = [{ x: 240, y: 100, r: 8 }];
                const before = bombs[0].y;
                stepBombs(0.1);
                return bombs[0].y - before;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('fall speed increases with wave', async ({ page }) => {
            const res = await page.evaluate(() => {
                wave = 1; const s1 = fallSpeed();
                wave = 5; const s5 = fallSpeed();
                return { s1, s5 };
            });
            expect(res.s5).toBeGreaterThan(res.s1);
        });

        test('the bomber stays within the play field', async ({ page }) => {
            const within = await page.evaluate(() => {
                startGame();
                let ok = true;
                for (let i = 0; i < 500; i++) {
                    stepBomber(0.1);
                    if (bomber.x < 0 || bomber.x > 480) ok = false;
                }
                return ok;
            });
            expect(within).toBe(true);
        });

        test('dropBomb adds a bomb at the bomber x', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                bombs = [];
                bomber.x = 123;
                dropBomb();
                return { n: bombs.length, x: bombs[0].x };
            });
            expect(res.n).toBe(1);
            expect(res.x).toBe(123);
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('catching a full wave advances to the next wave', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                wave = 1;
                paddleX = 240;
                caughtThisWave = 0;
                spawnedThisWave = BOMBS_PER_WAVE;
                // catch the final bomb of the wave
                caughtThisWave = BOMBS_PER_WAVE - 1;
                bombs = [{ x: 240, y: BUCKET_Y, r: 8 }];
                stepBombs(0);
                return wave;
            });
            expect(res).toBe(2);
        });

        test('a new wave resets the wave counters', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                wave = 1;
                paddleX = 240;
                spawnedThisWave = BOMBS_PER_WAVE;
                caughtThisWave = BOMBS_PER_WAVE - 1;
                bombs = [{ x: 240, y: BUCKET_Y, r: 8 }];
                stepBombs(0);
                return { spawnedThisWave, caughtThisWave };
            });
            expect(res).toEqual({ spawnedThisWave: 0, caughtThisWave: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Best score persistence
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best is stored and reloaded from localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 42;
                buckets = 1;
                paddleX = 0;
                bombs = [{ x: 470, y: 700, r: 8 }];
                stepBombs(0); // triggers game over -> saves best
            });
            await expect(page.locator('#best')).toHaveText('42');
            await page.reload();
            await expect(page.locator('#best')).toHaveText('42');
        });
    });
});
