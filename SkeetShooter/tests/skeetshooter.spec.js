const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Skeet Shooter', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Skeet Shooter', async ({ page }) => {
            await expect(page).toHaveTitle('Skeet Shooter');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains how to shoot', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/shoot|aim|click/i);
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('misses start at 0', async ({ page }) => {
            await expect(page.locator('#misses')).toHaveText('0');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 700×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '700');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('there are no clays before the game starts', async ({ page }) => {
            const n = await page.evaluate(() => clays.length);
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('the Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is running after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('pressing Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Aiming
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test('moving the mouse over the range moves the crosshair', async ({ page }) => {
            await page.locator('#btn-start').click();
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 123, box.y + 234);
            const m = await page.evaluate(() => ({ x: mouse.x, y: mouse.y }));
            expect(m.x).toBeGreaterThan(90);
            expect(m.x).toBeLessThan(160);
            expect(m.y).toBeGreaterThan(200);
            expect(m.y).toBeLessThan(270);
        });
    });

    // -----------------------------------------------------------------------
    // Clay physics
    // -----------------------------------------------------------------------
    test.describe('clay physics', () => {
        test('spawning a clay adds one to the field', async ({ page }) => {
            await page.locator('#btn-start').click();
            const n = await page.evaluate(() => {
                state = 'paused';
                clays.length = 0;
                spawnClay();
                return clays.length;
            });
            expect(n).toBe(1);
        });

        test('a freshly launched clay is heading upward', async ({ page }) => {
            await page.locator('#btn-start').click();
            const vy = await page.evaluate(() => {
                state = 'paused';
                clays.length = 0;
                spawnClay();
                return clays[0].vy;
            });
            expect(vy).toBeLessThan(0); // up is -y
        });

        test('gravity pulls a clay downward over time', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                spawnTimer = 999; // suppress new spawns
                clays.length = 0;
                clays.push({ x: 350, y: 250, vx: 0, vy: -200, r: CLAY_R, alive: true });
                update(0.1);
                const v1 = clays[0].vy;
                update(0.1);
                const v2 = clays[0].vy;
                return { v1, v2 };
            });
            expect(r.v2).toBeGreaterThan(r.v1); // accelerating downward
        });

        test('a clay moves across the field', async ({ page }) => {
            await page.locator('#btn-start').click();
            const moved = await page.evaluate(() => {
                state = 'paused';
                spawnTimer = 999;
                clays.length = 0;
                clays.push({ x: 100, y: 250, vx: 150, vy: -200, r: CLAY_R, alive: true });
                const x0 = clays[0].x;
                update(0.1);
                return clays[0].x - x0;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('clays spawn over time while running', async ({ page }) => {
            await page.locator('#btn-start').click();
            const grew = await page.evaluate(() => {
                state = 'paused';
                clays.length = 0;
                spawnTimer = 0.001; // due immediately
                const before = clays.length;
                update(0.01);
                return clays.length > before;
            });
            expect(grew).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('firing at a clay shatters it and scores a point', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                spawnTimer = 999;
                score = 0;
                clays.length = 0;
                clays.push({ x: 300, y: 200, vx: 0, vy: 0, r: CLAY_R, alive: true });
                const hit = fireAt(300, 200);
                return { hit, score, remaining: clays.filter(c => c.alive).length };
            });
            expect(r.hit).toBe(true);
            expect(r.score).toBe(1);
            expect(r.remaining).toBe(0);
        });

        test('a near-miss inside the tolerance still counts as a hit', async ({ page }) => {
            await page.locator('#btn-start').click();
            const hit = await page.evaluate(() => {
                state = 'paused';
                spawnTimer = 999;
                clays.length = 0;
                clays.push({ x: 300, y: 200, vx: 0, vy: 0, r: CLAY_R, alive: true });
                return fireAt(300 + CLAY_R + HIT_SLOP - 1, 200);
            });
            expect(hit).toBe(true);
        });

        test('firing at empty sky does not score and leaves the clay', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                spawnTimer = 999;
                score = 0;
                clays.length = 0;
                clays.push({ x: 300, y: 200, vx: 0, vy: 0, r: CLAY_R, alive: true });
                const hit = fireAt(50, 50); // nowhere near
                return { hit, score, remaining: clays.filter(c => c.alive).length };
            });
            expect(r.hit).toBe(false);
            expect(r.score).toBe(0);
            expect(r.remaining).toBe(1);
        });

        test('a single shot hits at most one clay', async ({ page }) => {
            await page.locator('#btn-start').click();
            const remaining = await page.evaluate(() => {
                state = 'paused';
                spawnTimer = 999;
                score = 0;
                clays.length = 0;
                clays.push({ x: 300, y: 200, vx: 0, vy: 0, r: CLAY_R, alive: true });
                clays.push({ x: 305, y: 202, vx: 0, vy: 0, r: CLAY_R, alive: true });
                fireAt(300, 200);
                return clays.filter(c => c.alive).length;
            });
            expect(remaining).toBe(1);
        });

        test('a shot does not score against an already-shattered clay', async ({ page }) => {
            await page.locator('#btn-start').click();
            const score = await page.evaluate(() => {
                state = 'paused';
                spawnTimer = 999;
                score = 0;
                clays.length = 0;
                clays.push({ x: 300, y: 200, vx: 0, vy: 0, r: CLAY_R, alive: false });
                fireAt(300, 200);
                return score;
            });
            expect(score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Misses
    // -----------------------------------------------------------------------
    test.describe('misses', () => {
        test('a clay that leaves the screen counts as a miss', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                spawnTimer = 999;
                misses = 0;
                clays.length = 0;
                clays.push({ x: WIDTH + CLAY_R + 5, y: 250, vx: 100, vy: 0, r: CLAY_R, alive: true });
                update(0.02);
                return { misses, remaining: clays.filter(c => c.alive).length };
            });
            expect(r.misses).toBe(1);
            expect(r.remaining).toBe(0);
        });

        test('a shattered clay leaving the screen is NOT a miss', async ({ page }) => {
            await page.locator('#btn-start').click();
            const misses = await page.evaluate(() => {
                state = 'paused';
                spawnTimer = 999;
                misses = 0;
                clays.length = 0;
                clays.push({ x: WIDTH + CLAY_R + 5, y: 250, vx: 100, vy: 0, r: CLAY_R, alive: false });
                update(0.02);
                return misses;
            });
            expect(misses).toBe(0);
        });

        test('the miss display updates in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                spawnTimer = 999;
                misses = 0;
                clays.length = 0;
                clays.push({ x: -CLAY_R - 5, y: 250, vx: -100, vy: 0, r: CLAY_R, alive: true });
                update(0.02);
            });
            await expect(page.locator('#misses')).toHaveText('1');
        });

        test('reaching the miss limit ends the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                state = 'paused';
                spawnTimer = 999;
                misses = MAX_MISSES - 1;
                clays.length = 0;
                clays.push({ x: WIDTH + CLAY_R + 5, y: 250, vx: 100, vy: 0, r: CLAY_R, alive: true });
                update(0.02);
                return state;
            });
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('game over shows the overlay with a title', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('the button reads Play Again after game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('the best score persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 12; endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('skeet-best'));
            expect(parseInt(stored, 10)).toBe(12);
        });

        test('restarting resets score and misses to 0', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 9; misses = 3; endGame(); });
            await page.locator('#btn-start').click();
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#misses')).toHaveText('0');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
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

        test('clays do not move while paused', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                clays.length = 0;
                clays.push({ x: 200, y: 200, vx: 150, vy: -200, r: CLAY_R, alive: true });
            });
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ x: clays[0].x, y: clays[0].y }));
            await page.waitForTimeout(300);
            const after = await page.evaluate(() => ({ x: clays[0].x, y: clays[0].y }));
            expect(after).toEqual(before);
        });
    });
});
