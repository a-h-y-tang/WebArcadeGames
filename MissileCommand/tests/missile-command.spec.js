const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Missile Command', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Missile Command', async ({ page }) => {
            await expect(page).toHaveTitle('Missile Command');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/Click|Press/);
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('all cities are present', async ({ page }) => {
            const info = await page.evaluate(() => ({
                total: cities.length,
                alive: cities.filter(c => c.alive).length,
                n: NUM_CITIES,
            }));
            expect(info.total).toBe(info.n);
            expect(info.alive).toBe(info.n);
        });

        test('cities HUD shows the full count', async ({ page }) => {
            await expect(page.locator('#cities')).toHaveText(String(await page.evaluate(() => NUM_CITIES)));
        });

        test('wave starts at 1', async ({ page }) => {
            await expect(page.locator('#wave')).toHaveText('1');
        });

        test('ammo starts full', async ({ page }) => {
            await expect(page.locator('#ammo')).toHaveText(String(await page.evaluate(() => AMMO_PER_WAVE)));
        });

        test('canvas is 600×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state is idle before starting', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });

        test('no missiles, interceptors or explosions before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                e: enemyMissiles.length,
                i: interceptors.length,
                x: explosions.length,
            }));
            expect(counts).toEqual({ e: 0, i: 0, x: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
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

        test('starting does not immediately fire an interceptor', async ({ page }) => {
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => interceptors.length);
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Firing interceptors
    // -----------------------------------------------------------------------
    test.describe('firing interceptors', () => {
        test('fireInterceptor launches from the battery', async ({ page }) => {
            await page.keyboard.press('Space');
            const start = await page.evaluate(() => {
                fireInterceptor(300, 100);
                return { x: interceptors[0].x, y: interceptors[0].y, bx: BASE.x, by: BASE.y };
            });
            expect(start.x).toBeCloseTo(start.bx, 5);
            expect(start.y).toBeCloseTo(start.by, 5);
        });

        test('firing consumes one unit of ammo', async ({ page }) => {
            await page.keyboard.press('Space');
            const { before, after } = await page.evaluate(() => {
                const before = ammo;
                fireInterceptor(300, 100);
                return { before, after: ammo };
            });
            expect(after).toBe(before - 1);
        });

        test('cannot fire with no ammo', async ({ page }) => {
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => {
                ammo = 0;
                fireInterceptor(300, 100);
                return interceptors.length;
            });
            expect(n).toBe(0);
        });

        test('clicking the field while running fires an interceptor', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.locator('#canvas').click();
            const n = await page.evaluate(() => interceptors.length);
            expect(n).toBe(1);
        });

        test('an interceptor travels toward its target over time', async ({ page }) => {
            await page.keyboard.press('Space');
            const moved = await page.evaluate(() => {
                fireInterceptor(300, 100);
                const y0 = interceptors[0].y;
                step(50);
                return interceptors[0].y < y0; // heading up toward the target
            });
            expect(moved).toBe(true);
        });

        test('an interceptor detonates into a blast on arrival', async ({ page }) => {
            await page.keyboard.press('Space');
            const result = await page.evaluate(() => {
                fireInterceptor(300, 100);
                step(5000); // long enough to arrive
                return { interceptors: interceptors.length, explosions: explosions.length };
            });
            expect(result.interceptors).toBe(0);
            expect(result.explosions).toBeGreaterThanOrEqual(1);
        });
    });

    // -----------------------------------------------------------------------
    // Explosions
    // -----------------------------------------------------------------------
    test.describe('explosions', () => {
        test('a blast expands over time', async ({ page }) => {
            await page.keyboard.press('Space');
            const grew = await page.evaluate(() => {
                explosions.push({ x: 300, y: 200, r: 0, maxR: EXPLOSION_MAX_R, phase: 'grow' });
                const r0 = explosions[0].r;
                step(50);
                return explosions[0].r > r0;
            });
            expect(grew).toBe(true);
        });

        test('a blast eventually fades away', async ({ page }) => {
            await page.keyboard.press('Space');
            const gone = await page.evaluate(() => {
                explosions.push({ x: 300, y: 200, r: 0, maxR: EXPLOSION_MAX_R, phase: 'grow' });
                step(100000); // grow fully then shrink away
                return explosions.length;
            });
            expect(gone).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Enemy missiles
    // -----------------------------------------------------------------------
    test.describe('enemy missiles', () => {
        test('spawnEnemyMissile adds a missile heading down', async ({ page }) => {
            await page.keyboard.press('Space');
            const vy = await page.evaluate(() => {
                spawnEnemyMissile();
                return enemyMissiles[0].vy;
            });
            expect(vy).toBeGreaterThan(0);
        });

        test('an enemy missile advances over time', async ({ page }) => {
            await page.keyboard.press('Space');
            const fell = await page.evaluate(() => {
                spawnEnemyMissile();
                const y0 = enemyMissiles[0].y;
                step(50);
                return enemyMissiles[0].y > y0;
            });
            expect(fell).toBe(true);
        });

        test('a missile reaching its city destroys it', async ({ page }) => {
            await page.keyboard.press('Space');
            const aliveBefore = await page.evaluate(() => cities.filter(c => c.alive).length);
            await page.evaluate(() => {
                const c = cities[0];
                enemyMissiles.push({
                    x: c.x + c.w / 2, y: c.y, vx: 0, vy: 0.06,
                    targetX: c.x + c.w / 2, targetY: c.y, cityIndex: 0,
                });
                step(1);
            });
            const aliveAfter = await page.evaluate(() => cities.filter(c => c.alive).length);
            expect(aliveAfter).toBe(aliveBefore - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Interception
    // -----------------------------------------------------------------------
    test.describe('interception', () => {
        test('a blast destroys an enemy missile in its radius', async ({ page }) => {
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => {
                explosions.push({ x: 300, y: 200, r: 40, maxR: EXPLOSION_MAX_R, phase: 'grow' });
                enemyMissiles.push({ x: 300, y: 200, vx: 0, vy: 0.06, targetX: 300, targetY: 470, cityIndex: null });
                step(1);
                return enemyMissiles.length;
            });
            expect(n).toBe(0);
        });

        test('intercepting a missile increases the score', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                explosions.push({ x: 300, y: 200, r: 40, maxR: EXPLOSION_MAX_R, phase: 'grow' });
                enemyMissiles.push({ x: 300, y: 200, vx: 0, vy: 0.06, targetX: 300, targetY: 470, cityIndex: null });
                step(1);
            });
            const score = parseInt(await page.locator('#score').textContent());
            expect(score).toBeGreaterThan(0);
        });

        test('a missile outside the blast radius survives', async ({ page }) => {
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => {
                explosions.push({ x: 100, y: 100, r: 20, maxR: EXPLOSION_MAX_R, phase: 'grow' });
                enemyMissiles.push({ x: 400, y: 300, vx: 0, vy: 0.06, targetX: 400, targetY: 470, cityIndex: null });
                step(1);
                return enemyMissiles.length;
            });
            expect(n).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('nextWave increments the wave number', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => nextWave());
            await expect(page.locator('#wave')).toHaveText('2');
        });

        test('nextWave refills ammo', async ({ page }) => {
            await page.keyboard.press('Space');
            const refilled = await page.evaluate(() => {
                ammo = 0;
                nextWave();
                return ammo === AMMO_PER_WAVE;
            });
            expect(refilled).toBe(true);
        });

        test('surviving cities earn a bonus at wave end', async ({ page }) => {
            await page.keyboard.press('Space');
            const gained = await page.evaluate(() => {
                score = 0;
                const before = score;
                nextWave();
                return score > before;
            });
            expect(gained).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('destroying every city ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                cities.forEach(c => (c.alive = false));
                step(1);
            });
            const s = await page.evaluate(() => state);
            expect(s).toBe('over');
        });

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

        test('restarting resets score, cities, wave and ammo', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 999;
                wave = 5;
                ammo = 1;
                cities.forEach(c => (c.alive = false));
                endGame();
            });
            await page.keyboard.press('Space');
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#wave')).toHaveText('1');
            await expect(page.locator('#cities')).toHaveText(String(await page.evaluate(() => NUM_CITIES)));
            await expect(page.locator('#ammo')).toHaveText(String(await page.evaluate(() => AMMO_PER_WAVE)));
        });

        test('best score updates on game over if higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 500;
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent());
            expect(best).toBeGreaterThanOrEqual(500);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 750;
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('missile-command-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(750);
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
            await page.evaluate(() => spawnEnemyMissile());
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ x: enemyMissiles[0].x, y: enemyMissiles[0].y }));
            await page.evaluate(() => step(200));
            const after = await page.evaluate(() => ({ x: enemyMissiles[0].x, y: enemyMissiles[0].y }));
            expect(after).toEqual(before);
        });
    });
});
