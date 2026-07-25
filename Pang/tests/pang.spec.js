const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Step the simulation until a predicate holds, the harpoon disappears, or we
// hit a bounded number of frames. Keeps physics assertions deterministic
// without leaning on the real animation clock.
async function stepUntilBallPopped(page, startCount) {
    await page.evaluate((start) => {
        for (let i = 0; i < 120; i++) {
            window.step(16);
            if (window.getState().ballCount !== start) return;
            if (!window.getState().harpoonActive) return;
        }
    }, startCount);
}

test.describe('Pang', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Pang', async ({ page }) => {
            await expect(page).toHaveTitle('Pang');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/ball/i);
        });

        test('canvas exists with fixed pixel size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', /\d+/);
            await expect(canvas).toHaveAttribute('height', /\d+/);
        });

        test('HUD starts at level 1, score 0, lives 3', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('exposes the game API on window', async ({ page }) => {
            const api = await page.evaluate(() => ({
                start: typeof window.start,
                reset: typeof window.reset,
                loadLevel: typeof window.loadLevel,
                movePlayer: typeof window.movePlayer,
                fire: typeof window.fire,
                step: typeof window.step,
                spawnBall: typeof window.spawnBall,
                clearBalls: typeof window.clearBalls,
                getState: typeof window.getState,
                getBalls: typeof window.getBalls,
                getHarpoon: typeof window.getHarpoon,
            }));
            expect(api).toEqual({
                start: 'function', reset: 'function', loadLevel: 'function',
                movePlayer: 'function', fire: 'function', step: 'function',
                spawnBall: 'function', clearBalls: 'function',
                getState: 'function', getBalls: 'function', getHarpoon: 'function',
            });
        });

        test('initial getState snapshot', async ({ page }) => {
            const s = await page.evaluate(() => window.getState());
            expect(s).toMatchObject({
                playerX: 320,
                lives: 3,
                score: 0,
                level: 1,
                state: 'ready',
                harpoonActive: false,
            });
            expect(s.ballCount).toBeGreaterThanOrEqual(1);
        });

        test('level 1 lays at least one ball', async ({ page }) => {
            const balls = await page.evaluate(() => window.getBalls());
            expect(balls.length).toBeGreaterThanOrEqual(1);
            expect(balls[0]).toHaveProperty('tier');
            expect(balls[0]).toHaveProperty('r');
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('start() hides the overlay and enters playing', async ({ page }) => {
            await page.evaluate(() => window.start());
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => window.getState().state)).toBe('playing');
        });

        test('clicking start button begins the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('fire() before start is ignored', async ({ page }) => {
            const fired = await page.evaluate(() => window.fire());
            expect(fired).toBe(false);
            expect(await page.evaluate(() => window.getState().harpoonActive)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => window.start());
        });

        test('movePlayer(-1) moves left, movePlayer(1) moves right', async ({ page }) => {
            const x0 = await page.evaluate(() => window.getState().playerX);
            const xl = await page.evaluate(() => window.movePlayer(-1));
            expect(xl).toBeLessThan(x0);
            const xr = await page.evaluate(() => { window.movePlayer(1); return window.movePlayer(1); });
            expect(xr).toBeGreaterThan(xl);
        });

        test('player is clamped at the left wall', async ({ page }) => {
            const x = await page.evaluate(() => {
                for (let i = 0; i < 100; i++) window.movePlayer(-1);
                return window.getState().playerX;
            });
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(60);
        });

        test('player is clamped at the right wall', async ({ page }) => {
            const x = await page.evaluate(() => {
                for (let i = 0; i < 100; i++) window.movePlayer(1);
                return window.getState().playerX;
            });
            expect(x).toBeLessThanOrEqual(640);
            expect(x).toBeGreaterThan(580);
        });

        test('ArrowRight key moves the player right', async ({ page }) => {
            const x0 = await page.evaluate(() => window.getState().playerX);
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => window.getState().playerX)).toBeGreaterThan(x0);
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { window.start(); window.clearBalls(); });
        });

        test('fire() launches a harpoon from the player', async ({ page }) => {
            const fired = await page.evaluate(() => window.fire());
            expect(fired).toBe(true);
            const h = await page.evaluate(() => window.getHarpoon());
            const px = await page.evaluate(() => window.getState().playerX);
            expect(h).not.toBeNull();
            expect(h.x).toBeCloseTo(px, 0);
        });

        test('only one harpoon can be airborne at a time', async ({ page }) => {
            expect(await page.evaluate(() => window.fire())).toBe(true);
            expect(await page.evaluate(() => window.fire())).toBe(false);
        });

        test('the harpoon travels upward over time', async ({ page }) => {
            await page.evaluate(() => window.fire());
            const top0 = await page.evaluate(() => window.getHarpoon().topY);
            await page.evaluate(() => window.step(50));
            const top1 = await page.evaluate(() => window.getHarpoon().topY);
            expect(top1).toBeLessThan(top0);
        });

        test('a harpoon that reaches the top disappears', async ({ page }) => {
            await page.evaluate(() => window.fire());
            await page.evaluate(() => { for (let i = 0; i < 120; i++) window.step(16); });
            expect(await page.evaluate(() => window.getState().harpoonActive)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Popping & splitting
    // -----------------------------------------------------------------------
    test.describe('popping and splitting', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { window.start(); window.clearBalls(); });
        });

        test('harpoon popping a big ball splits it into two smaller balls', async ({ page }) => {
            await page.evaluate(() => {
                const px = window.getState().playerX;
                window.spawnBall(2, px, 120, 0, 0);
                window.fire();
            });
            await stepUntilBallPopped(page, 1);
            const balls = await page.evaluate(() => window.getBalls());
            expect(balls).toHaveLength(2);
            expect(balls.every((b) => b.tier === 1)).toBe(true);
            expect(await page.evaluate(() => window.getState().score)).toBe(50);
        });

        test('split children fly apart in opposite horizontal directions', async ({ page }) => {
            await page.evaluate(() => {
                const px = window.getState().playerX;
                window.spawnBall(2, px, 120, 0, 0);
                window.fire();
            });
            await stepUntilBallPopped(page, 1);
            const balls = await page.evaluate(() => window.getBalls());
            const signs = balls.map((b) => Math.sign(b.vx));
            expect(signs).toContain(-1);
            expect(signs).toContain(1);
        });

        test('popping the smallest ball makes it vanish (no children)', async ({ page }) => {
            await page.evaluate(() => {
                const px = window.getState().playerX;
                window.spawnBall(0, px, 120, 0, 0);
                window.fire();
            });
            await stepUntilBallPopped(page, 1);
            // Only ball is gone -> level cleared.
            expect(await page.evaluate(() => window.getState().ballCount)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { window.start(); window.clearBalls(); });
        });

        test('gravity pulls a ball downward', async ({ page }) => {
            await page.evaluate(() => window.spawnBall(1, 320, 100, 0, 0));
            await page.evaluate(() => window.step(100));
            const b = await page.evaluate(() => window.getBalls()[0]);
            expect(b.vy).toBeGreaterThan(0);
            expect(b.y).toBeGreaterThan(100);
        });

        test('a ball reflects off the right wall', async ({ page }) => {
            await page.evaluate(() => window.spawnBall(1, 620, 100, 200, 0));
            await page.evaluate(() => window.step(100));
            expect(await page.evaluate(() => window.getBalls()[0].vx)).toBeLessThan(0);
        });

        test('a ball bounces up off the floor', async ({ page }) => {
            // Spawn just above the floor moving down, then step once so it makes
            // exactly one floor contact. Read vy in the same evaluate so no
            // background frame can advance it past the bounce.
            const vy = await page.evaluate(() => {
                // Spawn near the left wall, well away from the player, so this
                // tests the floor bounce and not a player collision.
                window.spawnBall(1, 100, 460, 0, 120);
                window.step(30);
                return window.getBalls()[0].vy;
            });
            expect(vy).toBeLessThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Collisions, lives, game over
    // -----------------------------------------------------------------------
    test.describe('collisions and lives', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { window.start(); window.clearBalls(); });
        });

        test('a ball touching the player costs a life', async ({ page }) => {
            await page.evaluate(() => {
                const px = window.getState().playerX;
                window.spawnBall(1, px, 470, 0, 0);
                window.step(16);
            });
            expect(await page.evaluate(() => window.getState().lives)).toBe(2);
        });

        test('a ball far from the player does not cost a life', async ({ page }) => {
            await page.evaluate(() => {
                window.spawnBall(0, 40, 100, 0, 0);
                window.step(16);
            });
            expect(await page.evaluate(() => window.getState().lives)).toBe(3);
        });

        test('losing all lives ends the game', async ({ page }) => {
            await page.evaluate(() => {
                for (let i = 0; i < 3; i++) {
                    window.clearBalls();
                    const px = window.getState().playerX;
                    window.spawnBall(1, px, 470, 0, 0);
                    window.step(16);
                }
            });
            expect(await page.evaluate(() => window.getState().state)).toBe('gameover');
            expect(await page.evaluate(() => window.getState().lives)).toBe(0);
        });

        test('game-over overlay becomes visible', async ({ page }) => {
            await page.evaluate(() => {
                for (let i = 0; i < 3; i++) {
                    window.clearBalls();
                    const px = window.getState().playerX;
                    window.spawnBall(1, px, 470, 0, 0);
                    window.step(16);
                }
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('clearing every ball wins the level and awards a bonus', async ({ page }) => {
            await page.evaluate(() => {
                window.start(); window.clearBalls();
                const px = window.getState().playerX;
                window.spawnBall(0, px, 120, 0, 0);
                window.fire();
            });
            await stepUntilBallPopped(page, 1);
            const s = await page.evaluate(() => window.getState());
            expect(s.state).toBe('won');
            expect(s.score).toBeGreaterThanOrEqual(50 + 200);
        });
    });

    // -----------------------------------------------------------------------
    // Levels & reset
    // -----------------------------------------------------------------------
    test.describe('levels and reset', () => {
        test('loadLevel(2) sets level 2 and keeps score/lives', async ({ page }) => {
            await page.evaluate(() => { window.start(); });
            await page.evaluate(() => window.loadLevel(2));
            const s = await page.evaluate(() => window.getState());
            expect(s.level).toBe(2);
            expect(s.lives).toBe(3);
        });

        test('reset() returns to a fresh level 1', async ({ page }) => {
            await page.evaluate(() => { window.start(); window.loadLevel(3); });
            await page.evaluate(() => window.reset());
            const s = await page.evaluate(() => window.getState());
            expect(s).toMatchObject({ level: 1, lives: 3, score: 0, state: 'ready' });
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard & pause
    // -----------------------------------------------------------------------
    test.describe('keyboard and pause', () => {
        test('a movement key starts the game from the ready screen', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => window.getState().state)).toBe('playing');
        });

        test('Space fires a harpoon', async ({ page }) => {
            await page.evaluate(() => { window.start(); window.clearBalls(); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => window.getState().harpoonActive)).toBe(true);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => window.start());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => window.getState().state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => window.getState().state)).toBe('playing');
        });
    });
});
