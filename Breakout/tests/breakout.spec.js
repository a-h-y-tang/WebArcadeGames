const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Breakout', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Breakout', async ({ page }) => {
            await expect(page).toHaveTitle('Breakout');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to press a key', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('lives start at 3', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('canvas is 500×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state is idle before starting', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });

        test('bricks are built as a full grid', async ({ page }) => {
            const info = await page.evaluate(() => ({
                total: bricks.length,
                alive: bricks.filter(b => b.alive).length,
                rows: BRICK_ROWS,
                cols: BRICK_COLS,
            }));
            expect(info.total).toBe(info.rows * info.cols);
            expect(info.alive).toBe(info.rows * info.cols);
        });

        test('paddle is centered horizontally', async ({ page }) => {
            const centered = await page.evaluate(
                () => Math.abs((paddle.x + PADDLE_W / 2) - WIDTH / 2) < 1
            );
            expect(centered).toBe(true);
        });

        test('ball rests above the paddle before launch', async ({ page }) => {
            const resting = await page.evaluate(() => ball.vy === 0 && ball.vx === 0);
            expect(resting).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('arrow key dismisses overlay', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Space dismisses overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state is running after start', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('ball is launched (has upward velocity) after start', async ({ page }) => {
            await page.keyboard.press('Space');
            const vy = await page.evaluate(() => ball.vy);
            expect(vy).toBeLessThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Paddle movement
    // -----------------------------------------------------------------------
    test.describe('paddle movement', () => {
        test('ArrowRight moves the paddle right', async ({ page }) => {
            await page.keyboard.press('Space');
            const startX = await page.evaluate(() => paddle.x);
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowRight');
            const endX = await page.evaluate(() => paddle.x);
            expect(endX).toBeGreaterThan(startX);
        });

        test('ArrowLeft moves the paddle left', async ({ page }) => {
            await page.keyboard.press('Space');
            const startX = await page.evaluate(() => paddle.x);
            await page.keyboard.down('ArrowLeft');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowLeft');
            const endX = await page.evaluate(() => paddle.x);
            expect(endX).toBeLessThan(startX);
        });

        test('paddle is clamped to the right edge', async ({ page }) => {
            await page.evaluate(() => movePaddleTo(WIDTH + 500));
            const ok = await page.evaluate(() => paddle.x + PADDLE_W <= WIDTH + 0.001);
            expect(ok).toBe(true);
            const atEdge = await page.evaluate(
                () => Math.abs(paddle.x - (WIDTH - PADDLE_W)) < 0.001
            );
            expect(atEdge).toBe(true);
        });

        test('paddle is clamped to the left edge', async ({ page }) => {
            await page.evaluate(() => movePaddleTo(-500));
            const x = await page.evaluate(() => paddle.x);
            expect(x).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Ball physics
    // -----------------------------------------------------------------------
    test.describe('ball physics', () => {
        test('ball position advances when running', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => ({ x: ball.x, y: ball.y }));
            await page.evaluate(() => step(50));
            const after = await page.evaluate(() => ({ x: ball.x, y: ball.y }));
            expect(after.y).not.toBe(before.y);
        });

        test('ball reflects off the left wall', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                ball.x = BALL_R + 1;
                ball.y = HEIGHT / 2;
                ball.vx = -0.3;
                ball.vy = -0.3;
                step(20);
            });
            const vx = await page.evaluate(() => ball.vx);
            expect(vx).toBeGreaterThan(0);
        });

        test('ball reflects off the right wall', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                ball.x = WIDTH - BALL_R - 1;
                ball.y = HEIGHT / 2;
                ball.vx = 0.3;
                ball.vy = -0.3;
                step(20);
            });
            const vx = await page.evaluate(() => ball.vx);
            expect(vx).toBeLessThan(0);
        });

        test('ball reflects off the top wall', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                ball.x = WIDTH / 2;
                ball.y = BALL_R + 1;
                ball.vx = 0.1;
                ball.vy = -0.3;
                step(20);
            });
            const vy = await page.evaluate(() => ball.vy);
            expect(vy).toBeGreaterThan(0);
        });

        test('ball bounces up off the paddle', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                // Clear all bricks so the ball can't hit one on the way.
                bricks.forEach(b => (b.alive = false));
                paddle.x = WIDTH / 2 - PADDLE_W / 2;
                ball.x = WIDTH / 2;
                ball.y = paddle.y - BALL_R - 1;
                ball.vx = 0;
                ball.vy = 0.3; // moving down toward the paddle
                step(20);
            });
            const vy = await page.evaluate(() => ball.vy);
            expect(vy).toBeLessThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Bricks
    // -----------------------------------------------------------------------
    test.describe('breaking bricks', () => {
        test('hitting a brick destroys it', async ({ page }) => {
            await page.keyboard.press('Space');
            const aliveBefore = await page.evaluate(() => bricks.filter(b => b.alive).length);
            await page.evaluate(() => {
                const b = bricks.find(br => br.alive);
                ball.x = b.x + b.w / 2;
                ball.y = b.y + b.h / 2;
                ball.vx = 0;
                ball.vy = -0.3;
                step(1);
            });
            const aliveAfter = await page.evaluate(() => bricks.filter(b => b.alive).length);
            expect(aliveAfter).toBe(aliveBefore - 1);
        });

        test('score increases when a brick is destroyed', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                const b = bricks.find(br => br.alive);
                ball.x = b.x + b.w / 2;
                ball.y = b.y + b.h / 2;
                ball.vx = 0;
                ball.vy = -0.3;
                step(1);
            });
            const score = parseInt(await page.locator('#score').textContent());
            expect(score).toBeGreaterThan(0);
        });

        test('ball reflects after hitting a brick', async ({ page }) => {
            await page.keyboard.press('Space');
            const vy = await page.evaluate(() => {
                const b = bricks.find(br => br.alive);
                ball.x = b.x + b.w / 2;
                ball.y = b.y + b.h / 2;
                ball.vx = 0;
                ball.vy = -0.3; // heading up into the brick
                step(1);
                return ball.vy;
            });
            expect(vy).toBeGreaterThan(0); // now heading back down
        });

        test('clearing all bricks advances to the next level', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                bricks.forEach(b => (b.alive = false));
                // knock out the very last brick via a hit to trigger the check
                bricks[0].alive = true;
                const b = bricks[0];
                ball.x = b.x + b.w / 2;
                ball.y = b.y + b.h / 2;
                ball.vx = 0;
                ball.vy = -0.3;
                step(1);
            });
            await expect(page.locator('#level')).toHaveText('2');
            const alive = await page.evaluate(() => bricks.filter(b => b.alive).length);
            expect(alive).toBe(await page.evaluate(() => BRICK_ROWS * BRICK_COLS));
        });
    });

    // -----------------------------------------------------------------------
    // Lives
    // -----------------------------------------------------------------------
    test.describe('lives', () => {
        test('ball falling below the paddle costs a life', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                ball.x = WIDTH / 2;
                ball.y = HEIGHT + 50; // already below the field
                ball.vx = 0.1;
                ball.vy = 0.3;
                step(1);
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('ball is re-served on the paddle after losing a life', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                ball.x = WIDTH / 2;
                ball.y = HEIGHT + 50;
                ball.vx = 0.1;
                ball.vy = 0.3;
                step(1);
            });
            const onPaddle = await page.evaluate(() => ball.y < HEIGHT && ball.vy < 0);
            expect(onPaddle).toBe(true);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                lives = 1;
                ball.x = WIDTH / 2;
                ball.y = HEIGHT + 50;
                ball.vx = 0;
                ball.vy = 0.3;
                step(1);
            });
            const s = await page.evaluate(() => state);
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const s = await page.evaluate(() => state);
            expect(s).toBe('paused');
        });

        test('pause overlay shows "Paused"', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('ball does not move while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ x: ball.x, y: ball.y }));
            await page.evaluate(() => step(100));
            const after = await page.evaluate(() => ({ x: ball.x, y: ball.y }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('game over overlay is shown', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('game over score shows points', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay-score')).toContainText('pts');
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets score and lives', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 42;
                lives = 1;
                endGame();
            });
            await page.keyboard.press('Space');
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('best score updates on game over if higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 55;
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent());
            expect(best).toBeGreaterThanOrEqual(55);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 77;
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('breakout-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(77);
        });
    });
});
