const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Pong', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Pong', async ({ page }) => {
            await expect(page).toHaveTitle('Pong');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains how to move', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('move');
        });

        test('player score starts at 0', async ({ page }) => {
            await expect(page.locator('#score-player')).toHaveText('0');
        });

        test('CPU score starts at 0', async ({ page }) => {
            await expect(page.locator('#score-cpu')).toHaveText('0');
        });

        test('best rally starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 700×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '700');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('the player paddle is on the left, the CPU on the right', async ({ page }) => {
            const r = await page.evaluate(() => ({ px: player.x, cx: cpu.x, W: WIDTH }));
            expect(r.px).toBeLessThan(r.W / 2);
            expect(r.cx).toBeGreaterThan(r.W / 2);
        });

        test('the ball starts near the centre', async ({ page }) => {
            const r = await page.evaluate(() => ({ x: ball.x, y: ball.y, W: WIDTH, H: HEIGHT }));
            expect(r.x).toBeCloseTo(r.W / 2, 0);
            expect(r.y).toBeCloseTo(r.H / 2, 0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('a move key dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is running after start', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('the ball has a velocity after serving', async ({ page }) => {
            await page.locator('#btn-start').click();
            const v = await page.evaluate(() => Math.hypot(ball.vx, ball.vy));
            expect(v).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Paddle control (deterministic: freeze the loop, drive update() directly)
    // -----------------------------------------------------------------------
    test.describe('paddle control', () => {
        test('ArrowUp / W moves the player paddle up', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.y = 250;
                const y0 = player.y;
                keys.up = true; keys.down = false;
                update(0.1);
                keys.up = false;
                return { y0, y1: player.y };
            });
            expect(r.y1).toBeLessThan(r.y0);
        });

        test('ArrowDown / S moves the player paddle down', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.y = 250;
                const y0 = player.y;
                keys.down = true; keys.up = false;
                update(0.1);
                keys.down = false;
                return { y0, y1: player.y };
            });
            expect(r.y1).toBeGreaterThan(r.y0);
        });

        test('the player paddle is clamped inside the board', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.y = 20;
                keys.up = true;
                for (let i = 0; i < 60; i++) update(0.1); // slam into the top wall
                keys.up = false;
                return { top: player.y - player.h / 2, H: HEIGHT };
            });
            expect(r.top).toBeGreaterThanOrEqual(-0.001);
        });
    });

    // -----------------------------------------------------------------------
    // Ball physics
    // -----------------------------------------------------------------------
    test.describe('ball physics', () => {
        test('the ball moves over time', async ({ page }) => {
            await page.locator('#btn-start').click();
            const moved = await page.evaluate(() => {
                state = 'paused';
                const x0 = ball.x, y0 = ball.y;
                update(0.1);
                return Math.hypot(ball.x - x0, ball.y - y0) > 0;
            });
            expect(moved).toBe(true);
        });

        test('the ball bounces off the top wall', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                ball.x = 350; ball.y = 4; ball.vx = 0; ball.vy = -300;
                update(0.05);
                return { vy: ball.vy };
            });
            expect(r.vy).toBeGreaterThan(0); // reversed to downward
        });

        test('the ball bounces off the bottom wall', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                ball.x = 350; ball.y = HEIGHT - 4; ball.vx = 0; ball.vy = 300;
                update(0.05);
                return { vy: ball.vy };
            });
            expect(r.vy).toBeLessThan(0); // reversed to upward
        });

        test('the ball bounces off the player paddle and heads right', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.y = 250;
                ball.y = 250;
                ball.x = player.x + player.w / 2 + ball.r - 1; // just touching the paddle face
                ball.vx = -300; ball.vy = 0;
                update(0.016);
                return { vx: ball.vx };
            });
            expect(r.vx).toBeGreaterThan(0); // now moving right, away from the player
        });

        test('a paddle hit speeds the ball up', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.y = 250; ball.y = 250;
                ball.x = player.x + player.w / 2 + ball.r - 1;
                ball.vx = -300; ball.vy = 0;
                const before = Math.hypot(ball.vx, ball.vy);
                update(0.016);
                const after = Math.hypot(ball.vx, ball.vy);
                return { before, after };
            });
            expect(r.after).toBeGreaterThan(r.before);
        });

        test('a paddle hit increments the rally count', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                rally = 0;
                player.y = 250; ball.y = 250;
                ball.x = player.x + player.w / 2 + ball.r - 1;
                ball.vx = -300; ball.vy = 0;
                update(0.016);
                return rally;
            });
            expect(r).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('the player scores when the ball passes the right edge', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0;
                ball.x = WIDTH + 30; ball.y = 250; ball.vx = 400; ball.vy = 0;
                update(0.016);
                return { p: playerScore, c: cpuScore };
            });
            expect(r.p).toBe(1);
            expect(r.c).toBe(0);
        });

        test('the CPU scores when the ball passes the left edge', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0;
                ball.x = -30; ball.y = 250; ball.vx = -400; ball.vy = 0;
                update(0.016);
                return { p: playerScore, c: cpuScore };
            });
            expect(r.p).toBe(0);
            expect(r.c).toBe(1);
        });

        test('the ball re-centres after a point', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0;
                ball.x = WIDTH + 30; ball.y = 120; ball.vx = 400; ball.vy = 200;
                update(0.016);
                return { x: ball.x, y: ball.y, W: WIDTH, H: HEIGHT };
            });
            expect(r.x).toBeCloseTo(r.W / 2, 0);
            expect(r.y).toBeCloseTo(r.H / 2, 0);
        });

        test('the score display updates in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0;
                ball.x = WIDTH + 30; ball.y = 250; ball.vx = 400; ball.vy = 0;
                update(0.016);
            });
            await expect(page.locator('#score-player')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Best rally
    // -----------------------------------------------------------------------
    test.describe('best rally', () => {
        test('the best rally rises to match a longer rally', async ({ page }) => {
            await page.locator('#btn-start').click();
            const best = await page.evaluate(() => {
                state = 'paused';
                bestRally = 0;
                for (let n = 0; n < 3; n++) {
                    player.y = 250; ball.y = 250;
                    ball.x = player.x + player.w / 2 + ball.r - 1;
                    ball.vx = -300; ball.vy = 0;
                    update(0.016);
                }
                return bestRally;
            });
            expect(best).toBeGreaterThanOrEqual(3);
        });

        test('the best rally persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                bestRally = 0; rally = 0;
                player.y = 250; ball.y = 250;
                ball.x = player.x + player.w / 2 + ball.r - 1;
                ball.vx = -300; ball.vy = 0;
                update(0.016);
            });
            const stored = await page.evaluate(() => localStorage.getItem('pong-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(1);
        });

        test('the rally resets to 0 after a point', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                rally = 5;
                playerScore = 0; cpuScore = 0;
                ball.x = WIDTH + 30; ball.y = 250; ball.vx = 400; ball.vy = 0;
                update(0.016);
                return rally;
            });
            expect(r).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // The AI opponent
    // -----------------------------------------------------------------------
    test.describe('the CPU opponent', () => {
        test('the CPU paddle tracks the incoming ball', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                cpu.y = 250;
                const y0 = cpu.y;
                // ball approaching the CPU (moving right) and well below the paddle
                ball.x = 400; ball.y = 460; ball.vx = 300; ball.vy = 0;
                for (let i = 0; i < 10; i++) update(0.05);
                return { y0, y1: cpu.y };
            });
            expect(r.y1).toBeGreaterThan(r.y0); // moved down toward the ball
        });
    });

    // -----------------------------------------------------------------------
    // Winning the match
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('reaching the winning score ends the match', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                state = 'paused';
                playerScore = WIN_SCORE - 1; cpuScore = 0;
                ball.x = WIDTH + 30; ball.y = 250; ball.vx = 400; ball.vy = 0;
                update(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('winning shows a "You Win" overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                playerScore = WIN_SCORE - 1; cpuScore = 0;
                ball.x = WIDTH + 30; ball.y = 250; ball.vx = 400; ball.vy = 0;
                update(0.016);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('You Win');
        });

        test('losing shows a game-over overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                cpuScore = WIN_SCORE - 1; playerScore = 0;
                ball.x = -30; ball.y = 250; ball.vx = -400; ball.vy = 0;
                update(0.016);
            });
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('Play Again button is shown after the match ends', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame('player'));
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets both scores to 0', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { playerScore = 5; cpuScore = 6; endGame('cpu'); });
            await page.locator('#btn-start').click();
            await expect(page.locator('#score-player')).toHaveText('0');
            await expect(page.locator('#score-cpu')).toHaveText('0');
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

        test('the ball does not move while paused', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ x: ball.x, y: ball.y }));
            await page.waitForTimeout(300);
            const after = await page.evaluate(() => ({ x: ball.x, y: ball.y }));
            expect(after).toEqual(before);
        });
    });
});
