const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Road Rush', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Road Rush', async ({ page }) => {
            await expect(page).toHaveTitle('Road Rush');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains how to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('arrow');
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

        test('player starts in a valid lane near the bottom', async ({ page }) => {
            const ok = await page.evaluate(() => {
                return player.lane >= 0 && player.lane < NUM_LANES && player.y > H / 2;
            });
            expect(ok).toBe(true);
        });

        test('no traffic on screen before the game starts', async ({ page }) => {
            const n = await page.evaluate(() => cars.length);
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

        test('game state is running after start', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Lane movement (discrete, one lane per press)
    // -----------------------------------------------------------------------
    test.describe('lane movement', () => {
        test('ArrowRight moves the player one lane right', async ({ page }) => {
            await page.keyboard.press('Space');
            const start = await page.evaluate(() => player.lane);
            await page.keyboard.press('ArrowRight');
            const after = await page.evaluate(() => player.lane);
            expect(after).toBe(start + 1);
        });

        test('ArrowLeft moves the player one lane left', async ({ page }) => {
            await page.keyboard.press('Space');
            const start = await page.evaluate(() => player.lane);
            await page.keyboard.press('ArrowLeft');
            const after = await page.evaluate(() => player.lane);
            expect(after).toBe(start - 1);
        });

        test('D key also moves right', async ({ page }) => {
            await page.keyboard.press('Space');
            const start = await page.evaluate(() => player.lane);
            await page.keyboard.press('d');
            const after = await page.evaluate(() => player.lane);
            expect(after).toBe(start + 1);
        });

        test('cannot move left past the leftmost lane', async ({ page }) => {
            await page.keyboard.press('Space');
            for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
            const lane = await page.evaluate(() => player.lane);
            expect(lane).toBe(0);
        });

        test('cannot move right past the rightmost lane', async ({ page }) => {
            await page.keyboard.press('Space');
            for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
            const lane = await page.evaluate(() => player.lane);
            expect(lane).toBe(await page.evaluate(() => NUM_LANES - 1));
        });

        test('player x matches its lane', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('ArrowRight');
            const ok = await page.evaluate(() => {
                return Math.abs(player.x - laneX(player.lane)) < 1;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Physics — exercised deterministically via step() while paused
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('traffic moves down the screen', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                state = 'paused';
                cars.length = 0;
                cars.push({ lane: 0, x: laneX(0), y: 100 });
                const y0 = cars[0].y;
                for (let i = 0; i < 5; i++) step(16);
                return { y0, y1: cars[0].y };
            });
            expect(result.y1).toBeGreaterThan(result.y0);
        });

        test('a car that passes the bottom is removed and counted as dodged', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                state = 'paused';
                cars.length = 0;
                cars.push({ lane: 3, x: laneX(3), y: H - 1 });
                const before = carsDodged;
                for (let i = 0; i < 10; i++) step(16);
                return { removed: cars.length === 0, dodged: carsDodged - before };
            });
            expect(result.removed).toBe(true);
            expect(result.dodged).toBeGreaterThanOrEqual(1);
        });

        test('score increases as distance is travelled', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                state = 'paused';
                cars.length = 0;
                const s0 = score;
                for (let i = 0; i < 10; i++) step(16);
                return { s0, s1: score };
            });
            expect(result.s1).toBeGreaterThan(result.s0);
        });

        test('road speed ramps up with distance', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                state = 'paused';
                cars.length = 0;
                step(16);
                const v0 = speed;
                for (let i = 0; i < 400; i++) step(16);
                const v1 = speed;
                return { v0, v1 };
            });
            expect(result.v1).toBeGreaterThan(result.v0);
        });

        test('score display in the DOM updates', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                state = 'paused';
                cars.length = 0;
                for (let i = 0; i < 20; i++) step(16);
            });
            const shown = parseInt(await page.locator('#score').textContent(), 10);
            expect(shown).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Collisions
    // -----------------------------------------------------------------------
    test.describe('collisions', () => {
        test('a car in the player\'s lane at the player ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                state = 'paused';
                cars.length = 0;
                player.lane = 1;
                player.x = laneX(1);
                cars.push({ lane: 1, x: laneX(1), y: player.y });
                step(16);
                return state;
            });
            expect(s).toBe('over');
        });

        test('a car in a different lane does not end the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                state = 'paused';
                cars.length = 0;
                player.lane = 1;
                player.x = laneX(1);
                cars.push({ lane: 3, x: laneX(3), y: player.y });
                step(16);
                return state;
            });
            expect(s).not.toBe('over');
        });

        test('a car far above the player does not end the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                state = 'paused';
                cars.length = 0;
                player.lane = 1;
                player.x = laneX(1);
                cars.push({ lane: 1, x: laneX(1), y: 0 });
                step(16);
                return state;
            });
            expect(s).not.toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P key pauses a running game', async ({ page }) => {
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

        test('P key resumes a paused game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('score does not advance while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const before = await page.evaluate(() => score);
            await page.waitForTimeout(300);
            const after = await page.evaluate(() => score);
            expect(after).toBe(before);
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

        test('Play Again button is visible after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('Space after game over dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('restarting resets the score to 0', async ({ page }) => {
            // The road advances every frame, so verify the reset synchronously
            // (freeze the loop immediately after the restart before it ramps up).
            const s = await page.evaluate(() => {
                startGame();
                score = 500;
                scoreEl.textContent = '500';
                endGame();
                startGame();       // restart
                state = 'paused';  // freeze before the loop advances distance
                return { score, shown: scoreEl.textContent };
            });
            expect(s.score).toBe(0);
            expect(s.shown).toBe('0');
        });

        test('restarting clears traffic', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                cars.push({ lane: 0, x: laneX(0), y: 50 });
                endGame();
            });
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => cars.length);
            expect(n).toBe(0);
        });

        test('best score updates on game over if score is higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 800;
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent(), 10);
            expect(best).toBeGreaterThanOrEqual(800);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 654;
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('roadrush-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(654);
        });
    });
});
