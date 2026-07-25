const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Road Racer', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Road Racer', async ({ page }) => {
            await expect(page).toHaveTitle('Road Racer');
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

        test('canvas is 400×600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '400');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('state is idle before starting', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });

        test('no traffic on screen before starting', async ({ page }) => {
            const count = await page.evaluate(() => enemies.length);
            expect(count).toBe(0);
        });

        test('player starts on the road surface', async ({ page }) => {
            const ok = await page.evaluate(
                () => player.x >= ROAD_LEFT && player.x + player.w <= ROAD_RIGHT
            );
            expect(ok).toBe(true);
        });

        test('player starts near the bottom, inside the canvas', async ({ page }) => {
            const ok = await page.evaluate(
                () => player.y > HEIGHT / 2 && player.y + player.h <= HEIGHT
            );
            expect(ok).toBe(true);
        });

        test('there are three lanes', async ({ page }) => {
            const n = await page.evaluate(() => LANE_COUNT);
            expect(n).toBe(3);
        });

        test('every lane centre sits on the road', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let i = 0; i < LANE_COUNT; i++) {
                    const c = laneCenter(i);
                    if (c < ROAD_LEFT || c > ROAD_RIGHT) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
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

        test('a steering key dismisses overlay', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
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

        test('player recentres on the road when the game starts', async ({ page }) => {
            await page.keyboard.press('Space');
            const ok = await page.evaluate(
                () => player.x >= ROAD_LEFT && player.x + player.w <= ROAD_RIGHT
            );
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Steering
    // -----------------------------------------------------------------------
    test.describe('steering', () => {
        test('ArrowRight moves the car right', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { player.x = ROAD_LEFT + 10; });
            const startX = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowRight');
            const endX = await page.evaluate(() => player.x);
            expect(endX).toBeGreaterThan(startX);
        });

        test('ArrowLeft moves the car left', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { player.x = ROAD_RIGHT - player.w - 10; });
            const startX = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowLeft');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowLeft');
            const endX = await page.evaluate(() => player.x);
            expect(endX).toBeLessThan(startX);
        });

        test('D also steers right', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { player.x = ROAD_LEFT + 10; });
            const startX = await page.evaluate(() => player.x);
            await page.keyboard.down('d');
            await page.waitForTimeout(200);
            await page.keyboard.up('d');
            const endX = await page.evaluate(() => player.x);
            expect(endX).toBeGreaterThan(startX);
        });

        test('car cannot steer off the right edge of the road', async ({ page }) => {
            await page.keyboard.press('Space');
            const x = await page.evaluate(() => {
                player.x = ROAD_RIGHT + 50; // shove it off-road
                keys.right = true;
                step(50);
                keys.right = false;
                return player.x;
            });
            expect(x).toBeLessThanOrEqual(await page.evaluate(() => ROAD_RIGHT - player.w));
        });

        test('car cannot steer off the left edge of the road', async ({ page }) => {
            await page.keyboard.press('Space');
            const x = await page.evaluate(() => {
                player.x = ROAD_LEFT - 50;
                keys.left = true;
                step(50);
                keys.left = false;
                return player.x;
            });
            expect(x).toBeGreaterThanOrEqual(await page.evaluate(() => ROAD_LEFT));
        });
    });

    // -----------------------------------------------------------------------
    // Traffic & scrolling
    // -----------------------------------------------------------------------
    test.describe('traffic', () => {
        test('traffic appears while driving', async ({ page }) => {
            await page.keyboard.press('Space');
            const count = await page.evaluate(() => {
                enemies.length = 0;
                // Drive a long way; spawns are distance-gated.
                for (let i = 0; i < 200; i++) step(16);
                return enemies.length;
            });
            expect(count).toBeGreaterThan(0);
        });

        test('spawnEnemy places a car on a lane, above the screen', async ({ page }) => {
            await page.keyboard.press('Space');
            const ok = await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemy(1);
                const e = enemies[0];
                return e.y + e.h <= 0 && e.x >= ROAD_LEFT && e.x + e.w <= ROAD_RIGHT;
            });
            expect(ok).toBe(true);
        });

        test('enemy cars scroll downward over time', async ({ page }) => {
            await page.keyboard.press('Space');
            const moved = await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemy(0);
                const before = enemies[0].y;
                step(50);
                return enemies[0].y > before;
            });
            expect(moved).toBe(true);
        });

        test('a car that scrolls off the bottom is removed and counted', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                enemies.length = 0;
                // Park a car just past the bottom, out of the player's row.
                enemies.push({ x: laneCenter(0) - CAR_W / 2, y: HEIGHT + 5, w: CAR_W, h: CAR_H, speedFactor: 0.6, passed: false });
                const before = passedCount;
                step(1);
                return { len: enemies.length, gained: passedCount - before };
            });
            expect(res.len).toBe(0);
            expect(res.gained).toBe(1);
        });

        test('scroll speed increases as the score climbs', async ({ page }) => {
            const faster = await page.evaluate(() => {
                score = 0;
                const slow = currentScrollSpeed();
                score = 600;
                const fast = currentScrollSpeed();
                return fast > slow;
            });
            expect(faster).toBe(true);
        });

        test('scroll speed is capped', async ({ page }) => {
            const capped = await page.evaluate(() => {
                score = 5;
                const mid = currentScrollSpeed();
                score = 1_000_000;
                const huge = currentScrollSpeed();
                return huge <= MAX_SCROLL_SPEED && huge > mid;
            });
            expect(capped).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('score increases while driving', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                enemies.length = 0;
                const before = score;
                for (let i = 0; i < 60; i++) step(16);
                return { before, after: score };
            });
            expect(info.after).toBeGreaterThan(info.before);
        });

        test('distance accumulates with the scroll speed', async ({ page }) => {
            await page.keyboard.press('Space');
            const grew = await page.evaluate(() => {
                enemies.length = 0;
                const before = distance;
                step(100);
                return distance > before;
            });
            expect(grew).toBe(true);
        });

        test('score does not change while idle', async ({ page }) => {
            const info = await page.evaluate(() => {
                const before = score;
                step(500);
                return { before, after: score };
            });
            expect(info.after).toBe(info.before);
        });
    });

    // -----------------------------------------------------------------------
    // Collision & game over
    // -----------------------------------------------------------------------
    test.describe('collision', () => {
        test('overlapping another car ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: player.x, y: player.y, w: CAR_W, h: CAR_H, speedFactor: 0, passed: false });
                step(1);
                return state;
            });
            expect(s).toBe('over');
        });

        test('a car in another lane does not end the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                enemies.length = 0;
                player.x = laneCenter(0) - player.w / 2;
                // Enemy far away in lane 2, above the player.
                enemies.push({ x: laneCenter(2) - CAR_W / 2, y: 40, w: CAR_W, h: CAR_H, speedFactor: 0, passed: false });
                step(1);
                return state;
            });
            expect(s).toBe('running');
        });

        test('game over overlay is shown', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('game over shows the score', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay-score')).toContainText('pts');
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });
    });

    // -----------------------------------------------------------------------
    // Restart & best score
    // -----------------------------------------------------------------------
    test.describe('restart and best score', () => {
        test('restarting resets the score to 0', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 123;
                distance = 123 * 100;
                scoreEl.textContent = score;
                endGame();
            });
            await page.keyboard.press('Space');
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('restarting clears traffic', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                spawnEnemy(0);
                spawnEnemy(1);
                endGame();
            });
            await page.keyboard.press('Space');
            const count = await page.evaluate(() => enemies.length);
            expect(count).toBe(0);
        });

        test('best score updates on game over if higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 200;
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent());
            expect(best).toBeGreaterThanOrEqual(200);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 321;
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('roadracer-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(321);
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

        test('the world does not advance while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { enemies.length = 0; spawnEnemy(1); });
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ y: enemies[0].y, d: distance }));
            await page.evaluate(() => step(200));
            const after = await page.evaluate(() => ({ y: enemies[0].y, d: distance }));
            expect(after).toEqual(before);
        });
    });
});
