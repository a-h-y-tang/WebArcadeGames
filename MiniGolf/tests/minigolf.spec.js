const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Mini Golf', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Mini Golf', async ({ page }) => {
            await expect(page).toHaveTitle('Mini Golf');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to press a key', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('hole counter starts at 1', async ({ page }) => {
            await expect(page.locator('#hole')).toHaveText(/^1\b/);
        });

        test('strokes start at 0', async ({ page }) => {
            await expect(page.locator('#strokes')).toHaveText('0');
        });

        test('total strokes start at 0', async ({ page }) => {
            await expect(page.locator('#total')).toHaveText('0');
        });

        test('best starts blank/dash when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText(/^(–|-|—)$/);
        });

        test('canvas is 500×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the ball rests on the first tee', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const tee = COURSE[0].tee;
                return Math.abs(ball.x - tee.x) < 1 &&
                       Math.abs(ball.y - tee.y) < 1 &&
                       ball.moving === false;
            });
            expect(ok).toBe(true);
        });

        test('there is a target cup for the first hole', async ({ page }) => {
            const ok = await page.evaluate(() =>
                typeof target.x === 'number' &&
                typeof target.y === 'number' &&
                target.r > 0);
            expect(ok).toBe(true);
        });

        test('the course has multiple holes', async ({ page }) => {
            expect(await page.evaluate(() => COURSE.length)).toBeGreaterThan(1);
        });

        test('step() does nothing while idle', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const x0 = ball.x, y0 = ball.y;
                step(100);
                return ball.x !== x0 || ball.y !== y0;
            });
            expect(moved).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('clicking start hides the overlay and runs', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('pressing Space starts the game', async ({ page }) => {
            await page.locator('#canvas').focus();
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('ball is at rest right after starting', async ({ page }) => {
            const moving = await page.evaluate(() => { startGame(); return ball.moving; });
            expect(moving).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming & power
    // -----------------------------------------------------------------------
    test.describe('aiming and power', () => {
        test('setAim sets the aim angle', async ({ page }) => {
            const a = await page.evaluate(() => { startGame(); setAim(1.23); return aim.angle; });
            expect(a).toBeCloseTo(1.23, 5);
        });

        test('aimLeft and aimRight change the angle in opposite directions', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                setAim(0);
                aimRight();
                const afterRight = aim.angle;
                setAim(0);
                aimLeft();
                const afterLeft = aim.angle;
                return { afterRight, afterLeft };
            });
            expect(d.afterRight).not.toBe(0);
            expect(Math.sign(d.afterRight)).toBe(-Math.sign(d.afterLeft));
        });

        test('power is clamped to the allowed range', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setPower(999);
                const hi = aim.power;
                setPower(-999);
                const lo = aim.power;
                return { hi, lo };
            });
            expect(r.hi).toBeLessThanOrEqual(await page.evaluate(() => MAX_POWER) + 1e-9);
            expect(r.lo).toBeGreaterThanOrEqual(await page.evaluate(() => MIN_POWER) - 1e-9);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('shooting launches the ball and counts a stroke', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setAim(-Math.PI / 2);
                setPower(0.5);
                shoot();
                const speed = Math.hypot(ball.vx, ball.vy);
                return { moving: ball.moving, speed, strokes, total: totalStrokes };
            });
            expect(r.moving).toBe(true);
            expect(r.speed).toBeGreaterThan(0);
            expect(r.strokes).toBe(1);
            expect(r.total).toBe(1);
        });

        test('cannot shoot again while the ball is moving', async ({ page }) => {
            const strokes = await page.evaluate(() => {
                startGame();
                setPower(0.5);
                shoot();       // stroke 1, ball now moving
                shoot();       // should be ignored
                return strokes;
            });
            expect(strokes).toBe(1);
        });

        test('shooting up sends the ball upward (toward the cup)', async ({ page }) => {
            const dy = await page.evaluate(() => {
                startGame();
                setAim(-Math.PI / 2); // straight up
                setPower(0.5);
                const y0 = ball.y;
                shoot();
                step(16);
                return ball.y - y0; // negative = moved up
            });
            expect(dy).toBeLessThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('friction slows the ball over time', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setAim(-Math.PI / 2);
                setPower(0.6);
                shoot();
                step(16);
                const s1 = Math.hypot(ball.vx, ball.vy);
                for (let i = 0; i < 10; i++) step(16);
                const s2 = Math.hypot(ball.vx, ball.vy);
                return { s1, s2 };
            });
            expect(r.s2).toBeLessThan(r.s1);
        });

        test('the ball eventually comes to rest', async ({ page }) => {
            const moving = await page.evaluate(() => {
                startGame();
                setAim(-Math.PI / 2);
                setPower(0.4);
                shoot();
                for (let i = 0; i < 400; i++) step(16);
                return ball.moving;
            });
            expect(moving).toBe(false);
        });

        test('the ball bounces off the left wall', async ({ page }) => {
            const vx = await page.evaluate(() => {
                startGame();
                ball.x = BALL_R + 0.5;
                ball.y = 250;
                ball.vx = -0.3;
                ball.vy = 0;
                ball.moving = true;
                step(16);
                return ball.vx;
            });
            expect(vx).toBeGreaterThan(0);
        });

        test('the ball bounces off the right wall', async ({ page }) => {
            const vx = await page.evaluate(() => {
                startGame();
                ball.x = WIDTH - BALL_R - 0.5;
                ball.y = 250;
                ball.vx = 0.3;
                ball.vy = 0;
                ball.moving = true;
                step(16);
                return ball.vx;
            });
            expect(vx).toBeLessThan(0);
        });

        test('the ball stays inside the playfield', async ({ page }) => {
            const inside = await page.evaluate(() => {
                startGame();
                ball.x = 250; ball.y = 250;
                ball.vx = 0.7; ball.vy = 0.5;
                ball.moving = true;
                for (let i = 0; i < 300; i++) step(16);
                return ball.x >= BALL_R - 0.5 && ball.x <= WIDTH - BALL_R + 0.5 &&
                       ball.y >= BALL_R - 0.5 && ball.y <= HEIGHT - BALL_R + 0.5;
            });
            expect(inside).toBe(true);
        });

        test('the ball bounces off an obstacle', async ({ page }) => {
            const bounced = await page.evaluate(() => {
                startGame();
                // Use a hole that has at least one wall.
                const holeWithWall = COURSE.findIndex(h => h.walls.length > 0);
                loadHole(holeWithWall);
                const w = walls[0];
                // Place the ball just left of the wall, moving right into it.
                ball.x = w.x - BALL_R - 1;
                ball.y = w.y + w.h / 2;
                ball.vx = 0.4;
                ball.vy = 0;
                ball.moving = true;
                for (let i = 0; i < 20; i++) step(16);
                return ball.vx < 0; // reflected back to the left
            });
            expect(bounced).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Sinking the ball & scoring
    // -----------------------------------------------------------------------
    test.describe('sinking and scoring', () => {
        test('a slow ball over the cup is sunk and advances to the next hole', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const before = holeIndex;
                // Drop the ball onto the cup slowly.
                ball.x = target.x;
                ball.y = target.y;
                ball.vx = 0;
                ball.vy = 0.05;
                ball.moving = true;
                step(16);
                return { before, after: holeIndex };
            });
            expect(r.after).toBe(r.before + 1);
        });

        test('strokes reset when a new hole begins but total is kept', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setPower(0.5);
                shoot();               // total 1, hole strokes 1
                const totalBefore = totalStrokes;
                // sink it
                ball.x = target.x; ball.y = target.y;
                ball.vx = 0; ball.vy = 0.05; ball.moving = true;
                step(16);
                return { strokes, totalStrokes, totalBefore };
            });
            expect(r.strokes).toBe(0);
            expect(r.totalStrokes).toBe(r.totalBefore);
        });

        test('sinking the last hole wins the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                loadHole(COURSE.length - 1);
                ball.x = target.x; ball.y = target.y;
                ball.vx = 0; ball.vy = 0.05; ball.moving = true;
                step(16);
                return state;
            });
            expect(s).toBe('won');
        });

        test('a fast ball passing over the cup is NOT sunk', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const before = holeIndex;
                ball.x = target.x - 20;
                ball.y = target.y;
                ball.vx = 0.8; // very fast across the cup
                ball.vy = 0;
                ball.moving = true;
                step(16);
                return { before, after: holeIndex, state };
            });
            expect(r.after).toBe(r.before);
            expect(r.state).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Course & holes
    // -----------------------------------------------------------------------
    test.describe('course', () => {
        test('every hole defines a tee, a cup and a par', async ({ page }) => {
            const ok = await page.evaluate(() => COURSE.every(h =>
                h.tee && typeof h.tee.x === 'number' &&
                h.cup && typeof h.cup.x === 'number' &&
                typeof h.par === 'number' && h.par > 0 &&
                Array.isArray(h.walls)));
            expect(ok).toBe(true);
        });

        test('loadHole moves the ball to that hole\'s tee', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                loadHole(1);
                const tee = COURSE[1].tee;
                return holeIndex === 1 &&
                       Math.abs(ball.x - tee.x) < 1 &&
                       Math.abs(ball.y - tee.y) < 1 &&
                       ball.moving === false;
            });
            expect(ok).toBe(true);
        });

        test('the hole counter in the HUD updates', async ({ page }) => {
            await page.evaluate(() => { startGame(); loadHole(1); });
            await expect(page.locator('#hole')).toHaveText(/^2\b/);
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('winning stores the total as the best (lower is better)', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                // Take a couple of strokes so the total is non-trivial.
                setPower(0.5); shoot();
                ball.moving = false;
                loadHole(COURSE.length - 1);
                setPower(0.5); shoot();
                const total = totalStrokes;
                ball.x = target.x; ball.y = target.y;
                ball.vx = 0; ball.vy = 0.05; ball.moving = true;
                step(16);
                return { total, best, stored: Number(localStorage.getItem('minigolf-best')) };
            });
            expect(r.best).toBe(r.total);
            expect(r.stored).toBe(r.total);
        });

        test('restarting after a win resets strokes and state', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                loadHole(COURSE.length - 1);
                ball.x = target.x; ball.y = target.y;
                ball.vx = 0; ball.vy = 0.05; ball.moving = true;
                step(16); // win
                startGame();
                return { state, holeIndex, totalStrokes, strokes };
            });
            expect(r.state).toBe('running');
            expect(r.holeIndex).toBe(0);
            expect(r.totalStrokes).toBe(0);
            expect(r.strokes).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes the game', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.locator('#canvas').focus();
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('physics are frozen while paused', async ({ page }) => {
            const still = await page.evaluate(() => {
                startGame();
                ball.vx = 0.5; ball.vy = 0; ball.moving = true;
                state = 'paused';
                const x0 = ball.x;
                step(100);
                return ball.x === x0;
            });
            expect(still).toBe(true);
        });
    });
});
