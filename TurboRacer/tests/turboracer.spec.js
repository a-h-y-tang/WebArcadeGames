const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Turbo Racer', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Turbo Racer', async ({ page }) => {
            await expect(page).toHaveTitle('Turbo Racer');
        });

        test('canvas is 400×600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '400');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no traffic before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('player car starts on the road', async ({ page }) => {
            const onRoad = await page.evaluate(
                () => player.x >= ROAD_LEFT && player.x + player.w <= ROAD_RIGHT
            );
            expect(onRoad).toBe(true);
        });

        test('player car sits near the bottom of the canvas', async ({ page }) => {
            const low = await page.evaluate(() => player.y > HEIGHT / 2);
            expect(low).toBe(true);
        });

        test('road is centred with verges on both sides', async ({ page }) => {
            const ok = await page.evaluate(
                () => ROAD_LEFT > 0 && ROAD_RIGHT < WIDTH && ROAD_RIGHT > ROAD_LEFT
            );
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a steering key dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state is running after start', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting resets the score to 0', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => score)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Steering
    // -----------------------------------------------------------------------
    test.describe('steering', () => {
        test('ArrowRight moves the car right', async ({ page }) => {
            await page.keyboard.press('Space');
            const start = await page.evaluate(() => player.x);
            const end = await page.evaluate(() => {
                keys.right = true;
                step(200);
                keys.right = false;
                return player.x;
            });
            expect(end).toBeGreaterThan(start);
        });

        test('ArrowLeft moves the car left', async ({ page }) => {
            await page.keyboard.press('Space');
            const end = await page.evaluate(() => {
                player.x = WIDTH / 2;
                const before = player.x;
                keys.left = true;
                step(200);
                keys.left = false;
                return { before, after: player.x };
            });
            expect(end.after).toBeLessThan(end.before);
        });

        test('car cannot steer off the right edge of the road', async ({ page }) => {
            await page.keyboard.press('Space');
            const x = await page.evaluate(() => {
                keys.right = true;
                for (let i = 0; i < 60; i++) step(100);
                keys.right = false;
                return player.x;
            });
            const roadRight = await page.evaluate(() => ROAD_RIGHT - player.w);
            expect(x).toBeLessThanOrEqual(roadRight + 0.001);
        });

        test('car cannot steer off the left edge of the road', async ({ page }) => {
            await page.keyboard.press('Space');
            const x = await page.evaluate(() => {
                keys.left = true;
                for (let i = 0; i < 60; i++) step(100);
                keys.left = false;
                return player.x;
            });
            const roadLeft = await page.evaluate(() => ROAD_LEFT);
            expect(x).toBeGreaterThanOrEqual(roadLeft - 0.001);
        });
    });

    // -----------------------------------------------------------------------
    // Traffic & scrolling
    // -----------------------------------------------------------------------
    test.describe('traffic', () => {
        test('traffic appears once the game is running', async ({ page }) => {
            await page.keyboard.press('Space');
            const count = await page.evaluate(() => {
                for (let i = 0; i < 40; i++) step(100);
                return enemies.length;
            });
            expect(count).toBeGreaterThan(0);
        });

        test('every spawned car sits inside a lane on the road', async ({ page }) => {
            await page.keyboard.press('Space');
            const ok = await page.evaluate(() => {
                for (let i = 0; i < 60; i++) step(100);
                return enemies.every(
                    (e) => e.x >= ROAD_LEFT - 0.001 && e.x + e.w <= ROAD_RIGHT + 0.001
                );
            });
            expect(ok).toBe(true);
        });

        test('traffic moves downward over time', async ({ page }) => {
            await page.keyboard.press('Space');
            const moved = await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: ROAD_LEFT, y: -CAR_H, w: CAR_W, h: CAR_H, speed: 0.1, lane: 0 });
                const e = enemies[0];
                const before = e.y;
                step(100);
                return e.y > before;
            });
            expect(moved).toBe(true);
        });

        test('cars that pass the bottom are removed', async ({ page }) => {
            await page.keyboard.press('Space');
            const gone = await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: ROAD_LEFT, y: HEIGHT + 200, w: CAR_W, h: CAR_H, speed: 0, lane: 0 });
                step(16);
                return enemies.length === 0;
            });
            expect(gone).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & difficulty
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('score increases while driving', async ({ page }) => {
            await page.keyboard.press('Space');
            const grew = await page.evaluate(() => {
                enemies.length = 0;
                const before = score;
                for (let i = 0; i < 40; i++) {
                    enemies.length = 0; // keep the road clear so we survive
                    step(100);
                }
                return score > before;
            });
            expect(grew).toBe(true);
        });

        test('the HUD score reflects the game score', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                for (let i = 0; i < 30; i++) {
                    enemies.length = 0;
                    step(100);
                }
            });
            const hud = await page.locator('#score').textContent();
            const s = await page.evaluate(() => score);
            expect(Number(hud)).toBe(s);
        });

        test('scroll speed ramps up with distance', async ({ page }) => {
            await page.keyboard.press('Space');
            const faster = await page.evaluate(() => {
                enemies.length = 0;
                const slow = scroll;
                for (let i = 0; i < 200; i++) {
                    enemies.length = 0;
                    step(100);
                }
                return scroll > slow;
            });
            expect(faster).toBe(true);
        });

        test('scroll speed is capped at MAX_SCROLL', async ({ page }) => {
            await page.keyboard.press('Space');
            const capped = await page.evaluate(() => {
                enemies.length = 0;
                for (let i = 0; i < 2000; i++) {
                    enemies.length = 0;
                    step(100);
                }
                return scroll <= MAX_SCROLL + 1e-9;
            });
            expect(capped).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Collisions & game over
    // -----------------------------------------------------------------------
    test.describe('collisions', () => {
        test('hitting a car ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({
                    x: player.x, y: player.y, w: CAR_W, h: CAR_H, speed: 0, lane: 0,
                });
                step(16);
                return state;
            });
            expect(s).toBe('gameover');
        });

        test('a car in a different lane does not end the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                player.x = ROAD_LEFT;
                enemies.length = 0;
                enemies.push({
                    x: ROAD_RIGHT - CAR_W, y: player.y, w: CAR_W, h: CAR_H, speed: 0, lane: 0,
                });
                step(16);
                return state;
            });
            expect(s).toBe('running');
        });

        test('game over shows the overlay again', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: player.x, y: player.y, w: CAR_W, h: CAR_H, speed: 0, lane: 0 });
                step(16);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('game over records a best score', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                enemies.length = 0;
                for (let i = 0; i < 30; i++) { enemies.length = 0; step(100); }
                enemies.push({ x: player.x, y: player.y, w: CAR_W, h: CAR_H, speed: 0, lane: 0 });
                step(16);
            });
            const best = await page.evaluate(() => best);
            expect(best).toBeGreaterThan(0);
        });

        test('the game does not advance after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            const same = await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: player.x, y: player.y, w: CAR_W, h: CAR_H, speed: 0, lane: 0 });
                step(16);
                const s = score;
                step(1000);
                return score === s;
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause & restart', () => {
        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('P again resumes the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not advance', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            const same = await page.evaluate(() => {
                enemies.length = 0;
                const s = score;
                step(1000);
                return score === s;
            });
            expect(same).toBe(true);
        });

        test('restarting after game over resets the score', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                enemies.length = 0;
                for (let i = 0; i < 30; i++) { enemies.length = 0; step(100); }
                enemies.push({ x: player.x, y: player.y, w: CAR_W, h: CAR_H, speed: 0, lane: 0 });
                step(16);
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });
});
