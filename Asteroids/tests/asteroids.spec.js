const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Asteroids', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Asteroids', async ({ page }) => {
            await expect(page).toHaveTitle('Asteroids');
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

        test('a wave of asteroids exists at the start', async ({ page }) => {
            const n = await page.evaluate(() => asteroids.length);
            expect(n).toBeGreaterThan(0);
        });

        test('ship starts centered and stationary', async ({ page }) => {
            const info = await page.evaluate(() => ({
                cx: Math.abs(ship.x - WIDTH / 2) < 1,
                cy: Math.abs(ship.y - HEIGHT / 2) < 1,
                still: ship.vx === 0 && ship.vy === 0,
            }));
            expect(info.cx).toBe(true);
            expect(info.cy).toBe(true);
            expect(info.still).toBe(true);
        });

        test('no bullets exist before starting', async ({ page }) => {
            const n = await page.evaluate(() => bullets.length);
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('arrow key dismisses overlay', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
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

        test('starting does not immediately fire a bullet', async ({ page }) => {
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => bullets.length);
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Ship rotation & thrust
    // -----------------------------------------------------------------------
    test.describe('ship control', () => {
        test('ArrowRight rotates the ship (angle increases)', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => ship.angle);
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => ship.angle);
            expect(after).toBeGreaterThan(before);
        });

        test('ArrowLeft rotates the ship the other way', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => ship.angle);
            await page.keyboard.down('ArrowLeft');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowLeft');
            const after = await page.evaluate(() => ship.angle);
            expect(after).toBeLessThan(before);
        });

        test('thrust accelerates the ship along its heading (upward at angle 0)', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                ship.angle = 0; // pointing up
                ship.vx = 0;
                ship.vy = 0;
                keys.thrust = true;
                step(100);
                keys.thrust = false;
            });
            const vy = await page.evaluate(() => ship.vy);
            expect(vy).toBeLessThan(0); // moving up = negative y
        });

        test('drag slows a coasting ship down', async ({ page }) => {
            await page.keyboard.press('Space');
            const speeds = await page.evaluate(() => {
                ship.vx = 0.3;
                ship.vy = 0;
                keys.thrust = false;
                const before = Math.hypot(ship.vx, ship.vy);
                step(500);
                const after = Math.hypot(ship.vx, ship.vy);
                return { before, after };
            });
            expect(speeds.after).toBeLessThan(speeds.before);
        });
    });

    // -----------------------------------------------------------------------
    // Screen wrapping
    // -----------------------------------------------------------------------
    test.describe('wrapping', () => {
        test('ship wraps from right edge to left', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                ship.x = WIDTH + 5;
                ship.y = HEIGHT / 2;
                ship.vx = 0; ship.vy = 0;
                step(1);
                return { x: ship.x, w: WIDTH };
            });
            expect(res.x).toBeLessThan(res.w);
            expect(res.x).toBeGreaterThanOrEqual(0);
        });

        test('ship wraps from left edge to right', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                ship.x = -5;
                ship.y = HEIGHT / 2;
                ship.vx = 0; ship.vy = 0;
                step(1);
                return { x: ship.x, w: WIDTH };
            });
            expect(res.x).toBeGreaterThan(0);
            expect(res.x).toBeLessThanOrEqual(res.w);
        });

        test('an asteroid wraps around the edges too', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                asteroids.length = 0;
                spawnAsteroid(WIDTH + 5, HEIGHT / 2, 3, 0.01, 0);
                step(1);
                return { x: asteroids[0].x, w: WIDTH };
            });
            expect(res.x).toBeLessThan(res.w);
        });
    });

    // -----------------------------------------------------------------------
    // Firing bullets
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test('Space fires a bullet while running', async ({ page }) => {
            await page.keyboard.press('Space'); // start
            await page.keyboard.press('Space'); // fire
            const n = await page.evaluate(() => bullets.length);
            expect(n).toBe(1);
        });

        test('bullet travels in the ship facing direction (up at angle 0)', async ({ page }) => {
            await page.keyboard.press('Space');
            const vy = await page.evaluate(() => {
                ship.angle = 0;
                ship.vx = 0; ship.vy = 0;
                fireBullet();
                return bullets[bullets.length - 1].vy;
            });
            expect(vy).toBeLessThan(0);
        });

        test('bullets are capped at MAX_BULLETS', async ({ page }) => {
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => {
                for (let i = 0; i < MAX_BULLETS + 5; i++) fireBullet();
                return bullets.length;
            });
            expect(n).toBeLessThanOrEqual(await page.evaluate(() => MAX_BULLETS));
        });

        test('a bullet expires after its lifetime', async ({ page }) => {
            await page.keyboard.press('Space');
            const gone = await page.evaluate(() => {
                bullets.length = 0;
                fireBullet();
                const had = bullets.length;
                step(BULLET_LIFE + 50);
                return had === 1 && bullets.length === 0;
            });
            expect(gone).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting asteroids
    // -----------------------------------------------------------------------
    test.describe('shooting asteroids', () => {
        test('a bullet hitting a small asteroid destroys it', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                asteroids.length = 0;
                bullets.length = 0;
                spawnAsteroid(WIDTH / 2, HEIGHT / 2, 1, 0, 0); // small, still
                bullets.push({ x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0, life: BULLET_LIFE });
                step(1);
                return asteroids.length;
            });
            // small asteroid destroyed and no wave-refill happens mid-step check here
            // (level advance repopulates, so just assert it is not the original small one)
            expect(res).not.toBe(1);
        });

        test('shooting an asteroid increases the score', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                asteroids.length = 0;
                bullets.length = 0;
                spawnAsteroid(WIDTH / 2, HEIGHT / 2, 2, 0, 0);
                bullets.push({ x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0, life: BULLET_LIFE });
                step(1);
            });
            const score = parseInt(await page.locator('#score').textContent());
            expect(score).toBeGreaterThan(0);
        });

        test('a large asteroid splits into two smaller ones', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                asteroids.length = 0;
                bullets.length = 0;
                spawnAsteroid(WIDTH / 2, HEIGHT / 2, 3, 0, 0); // one large
                bullets.push({ x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0, life: BULLET_LIFE });
                step(1);
                return {
                    count: asteroids.length,
                    sizes: asteroids.map(a => a.size),
                };
            });
            expect(res.count).toBe(2);
            expect(res.sizes.every(s => s === 2)).toBe(true);
        });

        test('the bullet is consumed when it hits an asteroid', async ({ page }) => {
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => {
                asteroids.length = 0;
                bullets.length = 0;
                spawnAsteroid(WIDTH / 2, HEIGHT / 2, 3, 0, 0);
                bullets.push({ x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0, life: BULLET_LIFE });
                step(1);
                return bullets.length;
            });
            expect(n).toBe(0);
        });

        test('clearing the last asteroid advances to the next wave', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                asteroids.length = 0;
                bullets.length = 0;
                spawnAsteroid(WIDTH / 2, HEIGHT / 2, 1, 0, 0); // single small rock
                bullets.push({ x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0, life: BULLET_LIFE });
                step(1);
            });
            await expect(page.locator('#level')).toHaveText('2');
            const n = await page.evaluate(() => asteroids.length);
            expect(n).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Lives & collisions
    // -----------------------------------------------------------------------
    test.describe('lives and collisions', () => {
        test('colliding with an asteroid costs a life', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                ship.invuln = 0;
                asteroids.length = 0;
                spawnAsteroid(ship.x, ship.y, 3, 0, 0); // rock on top of the ship
                step(1);
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('ship respawns at center after a collision', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                ship.invuln = 0;
                ship.x = 100; ship.y = 100;
                asteroids.length = 0;
                spawnAsteroid(ship.x, ship.y, 3, 0, 0);
                step(1);
                return {
                    cx: Math.abs(ship.x - WIDTH / 2) < 1,
                    cy: Math.abs(ship.y - HEIGHT / 2) < 1,
                };
            });
            expect(res.cx).toBe(true);
            expect(res.cy).toBe(true);
        });

        test('ship is invulnerable briefly after respawn', async ({ page }) => {
            await page.keyboard.press('Space');
            const inv = await page.evaluate(() => {
                ship.invuln = 0;
                asteroids.length = 0;
                spawnAsteroid(ship.x, ship.y, 3, 0, 0);
                step(1); // triggers a life loss + respawn
                return ship.invuln;
            });
            expect(inv).toBeGreaterThan(0);
        });

        test('an invulnerable ship survives an overlapping asteroid', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                ship.invuln = 2000;
                asteroids.length = 0;
                spawnAsteroid(ship.x, ship.y, 3, 0, 0);
                step(1);
            });
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                lives = 1;
                ship.invuln = 0;
                asteroids.length = 0;
                spawnAsteroid(ship.x, ship.y, 3, 0, 0);
                step(1);
                return state;
            });
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

        test('nothing moves while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const same = await page.evaluate(() => {
                asteroids.length = 0;
                spawnAsteroid(100, 100, 3, 0.1, 0.1);
                const before = { x: asteroids[0].x, y: asteroids[0].y };
                step(100);
                const after = { x: asteroids[0].x, y: asteroids[0].y };
                return before.x === after.x && before.y === after.y;
            });
            expect(same).toBe(true);
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

        test('restarting resets score, lives and level', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 42;
                lives = 1;
                level = 5;
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
                score = 555;
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent());
            expect(best).toBeGreaterThanOrEqual(555);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 777;
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('asteroids-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(777);
        });
    });

    // -----------------------------------------------------------------------
    // Title-screen ambience
    // -----------------------------------------------------------------------
    test.describe('idle drift', () => {
        test('asteroids drift on the title screen while idle', async ({ page }) => {
            const before = await page.evaluate(() => asteroids.map(a => ({ x: a.x, y: a.y })));
            await page.evaluate(() => driftAsteroids(100));
            const after = await page.evaluate(() => asteroids.map(a => ({ x: a.x, y: a.y })));
            const moved = before.some((b, i) => b.x !== after[i].x || b.y !== after[i].y);
            expect(moved).toBe(true);
            // Still idle — drifting must not start the game.
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('idle drift never removes asteroids from the wave', async ({ page }) => {
            const n = await page.evaluate(() => {
                driftAsteroids(1000);
                return asteroids.length;
            });
            expect(n).toBeGreaterThan(0);
        });
    });
});
