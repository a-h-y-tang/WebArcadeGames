const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Pinball', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Pinball', async ({ page }) => {
            await expect(page).toHaveTitle('Pinball');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/launch|space/i);
        });

        test('canvas is 400×620', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '400');
            await expect(canvas).toHaveAttribute('height', '620');
        });

        test('state starts as ready', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('ready');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('balls-left starts at 3', async ({ page }) => {
            expect(await page.evaluate(() => ballsLeft)).toBe(3);
            await expect(page.locator('#balls')).toHaveText('3');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('there are three bumpers', async ({ page }) => {
            expect(await page.evaluate(() => bumpers.length)).toBe(3);
        });

        test('every bumper has a positive point value', async ({ page }) => {
            const ok = await page.evaluate(() => bumpers.every(b => b.value > 0));
            expect(ok).toBe(true);
        });

        test('there are two flippers', async ({ page }) => {
            const has = await page.evaluate(
                () => typeof leftFlipper === 'object' && typeof rightFlipper === 'object'
            );
            expect(has).toBe(true);
        });

        test('the ball starts held in the plunger lane near the bottom', async ({ page }) => {
            const b = await page.evaluate(() => ({ held: ball.held, y: ball.y, vy: ball.vy }));
            expect(b.held).toBe(true);
            expect(b.vy).toBe(0);
            expect(b.y).toBeGreaterThan(400); // low on the table
        });
    });

    // -----------------------------------------------------------------------
    // Starting & launching
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is playing after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the ball is still held (in the plunger) right after starting', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => ball.held)).toBe(true);
        });

        test('launching sends the ball upward and releases the hold', async ({ page }) => {
            await page.locator('#btn-start').click();
            const b = await page.evaluate(() => { launchBall(); return { held: ball.held, vy: ball.vy }; });
            expect(b.held).toBe(false);
            expect(b.vy).toBeLessThan(0); // moving up
        });

        test('you cannot launch a ball that is not held', async ({ page }) => {
            await page.locator('#btn-start').click();
            const vy = await page.evaluate(() => {
                launchBall();            // releases and launches
                const first = ball.vy;
                ball.vy = 200;           // pretend it is now falling in play
                launchBall();            // should be a no-op now
                return { first, second: ball.vy };
            });
            expect(vy.first).toBeLessThan(0);
            expect(vy.second).toBe(200);
        });
    });

    // -----------------------------------------------------------------------
    // Physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('gravity pulls a free ball downward', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                ball.held = false;
                ball.x = 200; ball.y = 200; ball.vx = 0; ball.vy = 0;
                step(0.1);
                return { vy: ball.vy, y: ball.y };
            });
            expect(res.vy).toBeGreaterThan(0);
            expect(res.y).toBeGreaterThan(200);
        });

        test('a held ball does not fall under gravity', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const y0 = ball.y;
                step(0.1);
                return { held: ball.held, vy: ball.vy, moved: ball.y - y0 };
            });
            expect(res.held).toBe(true);
            expect(res.vy).toBe(0);
            expect(res.moved).toBe(0);
        });

        test('the ball bounces off the top wall', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                ball.held = false;
                ball.x = 200; ball.y = 20; ball.vx = 0; ball.vy = -400;
                step(0.05);
                return { vy: ball.vy, y: ball.y };
            });
            expect(res.vy).toBeGreaterThan(0); // now heading down
            expect(res.y).toBeGreaterThanOrEqual(14);
        });

        test('the ball bounces off the left wall', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                ball.held = false;
                ball.x = 18; ball.y = 250; ball.vx = -400; ball.vy = 0;
                step(0.05);
                return { vx: ball.vx, x: ball.x };
            });
            expect(res.vx).toBeGreaterThan(0); // now heading right
            expect(res.x).toBeGreaterThanOrEqual(14);
        });

        test('speed is capped at MAX_SPEED', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                ball.held = false;
                ball.x = 200; ball.y = 300; ball.vx = 99999; ball.vy = 99999;
                step(0.001);
                return { speed: Math.hypot(ball.vx, ball.vy), cap: MAX_SPEED };
            });
            expect(res.speed).toBeLessThanOrEqual(res.cap + 0.001);
        });
    });

    // -----------------------------------------------------------------------
    // Bumpers
    // -----------------------------------------------------------------------
    test.describe('bumpers', () => {
        test('hitting a bumper adds its value to the score', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const b = bumpers[0];
                score = 0;
                // place the ball overlapping the bumper, moving into it
                ball.held = false;
                ball.x = b.x - (b.r + ball.r - 2); ball.y = b.y;
                ball.vx = 300; ball.vy = 0;
                const before = score;
                collideBumper(b);
                return { gained: score - before, value: b.value };
            });
            expect(res.gained).toBe(res.value);
        });

        test('a bumper hit reflects the ball away', async ({ page }) => {
            const vx = await page.evaluate(() => {
                startGame();
                const b = bumpers[0];
                ball.held = false;
                ball.x = b.x - (b.r + ball.r - 2); ball.y = b.y;
                ball.vx = 300; ball.vy = 0;
                collideBumper(b);
                return ball.vx;
            });
            expect(vx).toBeLessThan(0); // was moving right (+), now bounced left
        });

        test('a ball that is not touching a bumper does not score', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                const b = bumpers[0];
                score = 0;
                ball.held = false;
                ball.x = b.x + 200; ball.y = b.y + 200; ball.vx = 0; ball.vy = 0;
                const before = score;
                collideBumper(b);
                return score - before;
            });
            expect(gained).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Flippers
    // -----------------------------------------------------------------------
    test.describe('flippers', () => {
        test('pressing raises the left flipper and releasing lowers it', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const rest = leftFlipper.angle;
                pressLeft();
                const raised = leftFlipper.angle;
                releaseLeft();
                const back = leftFlipper.angle;
                return { rest, raised, back, pressed: leftFlipper.pressed };
            });
            // raising the left flipper lifts the tip -> angle decreases
            expect(res.raised).toBeLessThan(res.rest);
            expect(res.back).toBe(res.rest);
            expect(res.pressed).toBe(false);
        });

        test('pressing raises the right flipper', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const rest = rightFlipper.angle;
                pressRight();
                const raised = rightFlipper.angle;
                releaseRight();
                return { rest, raised };
            });
            // right flipper raises upward -> angle increases (mirrored)
            expect(res.raised).toBeGreaterThan(res.rest);
        });

        test('a raised flipper knocks a resting ball upward', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                pressLeft();
                const seg = flipperSegment(leftFlipper);
                // midpoint of the flipper, ball sitting just above it, drifting down
                const mx = (seg.x1 + seg.x2) / 2;
                const my = (seg.y1 + seg.y2) / 2;
                ball.held = false;
                ball.x = mx; ball.y = my - (ball.r - 2);
                ball.vx = 0; ball.vy = 120;
                collideSegment(seg, leftFlipper.restitution, leftFlipper.pressed ? leftFlipper.kick : 0);
                return ball.vy;
            });
            expect(res).toBeLessThan(0); // bounced upward
        });
    });

    // -----------------------------------------------------------------------
    // Draining & lives
    // -----------------------------------------------------------------------
    test.describe('draining and lives', () => {
        test('draining costs a ball and resets the ball to the plunger', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const before = ballsLeft;
                drainBall();
                return { before, after: ballsLeft, held: ball.held, state };
            });
            expect(res.after).toBe(res.before - 1);
            expect(res.held).toBe(true);
            expect(res.state).toBe('playing');
        });

        test('a ball falling past the drain line is drained during step', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const before = ballsLeft;
                ball.held = false;
                ball.x = 200; ball.y = 650; ball.vx = 0; ball.vy = 300;
                step(0.02);
                return { before, after: ballsLeft };
            });
            expect(res.after).toBe(res.before - 1);
        });

        test('losing the last ball ends the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                ballsLeft = 1;
                drainBall();
                return { ballsLeft, state };
            });
            expect(res.ballsLeft).toBe(0);
            expect(res.state).toBe('over');
        });

        test('game over shows the overlay and a Game Over title', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { ballsLeft = 1; drainBall(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });
    });

    // -----------------------------------------------------------------------
    // HUD, best, restart
    // -----------------------------------------------------------------------
    test.describe('HUD, best and restart', () => {
        test('the score HUD reflects the score', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 250; updateHud(); });
            await expect(page.locator('#score')).toHaveText('250');
        });

        test('the balls HUD reflects balls left', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { ballsLeft = 2; updateHud(); });
            await expect(page.locator('#balls')).toHaveText('2');
        });

        test('best tracks the highest score and persists', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 500; endGame(); });
            await expect(page.locator('#best')).toHaveText('500');
            const stored = await page.evaluate(() => localStorage.getItem('pinball-best'));
            expect(parseInt(stored)).toBe(500);
        });

        test('Play Again button appears after game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText(/again/i);
        });

        test('restarting resets score to 0 and balls to 3', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 500; ballsLeft = 1; endGame(); });
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => ({ s: score, b: ballsLeft }))).toEqual({ s: 0, b: 3 });
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#balls')).toHaveText('3');
        });

        test('a key press starts the game from the overlay', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });
});
