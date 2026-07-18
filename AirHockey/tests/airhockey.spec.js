const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Air Hockey', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => window.localStorage.clear());
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Air Hockey', async ({ page }) => {
            await expect(page).toHaveTitle('Air Hockey');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains how to move', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/move/i);
        });

        test('player score starts at 0', async ({ page }) => {
            await expect(page.locator('#score-player')).toHaveText('0');
        });

        test('CPU score starts at 0', async ({ page }) => {
            await expect(page.locator('#score-cpu')).toHaveText('0');
        });

        test('wins starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#wins')).toHaveText('0');
        });

        test('canvas is 460×700 (portrait)', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '460');
            await expect(canvas).toHaveAttribute('height', '700');
        });

        test('the player mallet is on the bottom, the CPU on the top', async ({ page }) => {
            const r = await page.evaluate(() => ({ py: player.y, cy: cpu.y, H: HEIGHT }));
            expect(r.py).toBeGreaterThan(r.H / 2);
            expect(r.cy).toBeLessThan(r.H / 2);
        });

        test('the puck starts near the centre', async ({ page }) => {
            const r = await page.evaluate(() => ({ x: puck.x, y: puck.y, W: WIDTH, H: HEIGHT }));
            expect(r.x).toBeCloseTo(r.W / 2, 0);
            expect(r.y).toBeCloseTo(r.H / 2, 0);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('an arrow key dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state is running after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the puck has a velocity after serving', async ({ page }) => {
            await page.locator('#btn-start').click();
            const v = await page.evaluate(() => Math.hypot(puck.vx, puck.vy));
            expect(v).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Player mallet control (deterministic: freeze the loop, drive update())
    // -----------------------------------------------------------------------
    test.describe('mallet control', () => {
        test('Left / A moves the player mallet left', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.x = 230; player.px = 230;
                const x0 = player.x;
                keys.left = true; keys.right = false;
                update(0.1);
                keys.left = false;
                return { x0, x1: player.x };
            });
            expect(r.x1).toBeLessThan(r.x0);
        });

        test('Right / D moves the player mallet right', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.x = 230; player.px = 230;
                const x0 = player.x;
                keys.right = true; keys.left = false;
                update(0.1);
                keys.right = false;
                return { x0, x1: player.x };
            });
            expect(r.x1).toBeGreaterThan(r.x0);
        });

        test('Down / Up moves the player mallet vertically', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.y = 550; player.py = 550;
                const y0 = player.y;
                keys.up = true; keys.down = false;
                update(0.1);
                keys.up = false;
                return { y0, y1: player.y };
            });
            expect(r.y1).toBeLessThan(r.y0);
        });

        test('the player mallet cannot cross the centre line into the top half', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.y = HEIGHT / 2 + 20; player.py = player.y;
                keys.up = true;
                for (let i = 0; i < 60; i++) update(0.1);
                keys.up = false;
                return { y: player.y, H: HEIGHT };
            });
            expect(r.y).toBeGreaterThanOrEqual(r.H / 2 - 0.001);
        });

        test('the player mallet is clamped inside the side walls', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.x = 40; player.px = 40;
                keys.left = true;
                for (let i = 0; i < 60; i++) update(0.1);
                keys.left = false;
                return { left: player.x - player.r };
            });
            expect(r.left).toBeGreaterThanOrEqual(-0.001);
        });
    });

    // -----------------------------------------------------------------------
    // Puck physics
    // -----------------------------------------------------------------------
    test.describe('puck physics', () => {
        test('the puck moves over time', async ({ page }) => {
            await page.locator('#btn-start').click();
            const moved = await page.evaluate(() => {
                state = 'paused';
                puck.x = 230; puck.y = 350; puck.vx = 200; puck.vy = 100;
                const x0 = puck.x, y0 = puck.y;
                update(0.05);
                return Math.hypot(puck.x - x0, puck.y - y0) > 0;
            });
            expect(moved).toBe(true);
        });

        test('the puck bounces off the left wall', async ({ page }) => {
            await page.locator('#btn-start').click();
            const vx = await page.evaluate(() => {
                state = 'paused';
                puck.x = puck.r + 2; puck.y = 350; puck.vx = -300; puck.vy = 0;
                update(0.05);
                return puck.vx;
            });
            expect(vx).toBeGreaterThan(0);
        });

        test('the puck bounces off the right wall', async ({ page }) => {
            await page.locator('#btn-start').click();
            const vx = await page.evaluate(() => {
                state = 'paused';
                puck.x = WIDTH - puck.r - 2; puck.y = 350; puck.vx = 300; puck.vy = 0;
                update(0.05);
                return puck.vx;
            });
            expect(vx).toBeLessThan(0);
        });

        test('the puck bounces off the top wall away from the goal mouth', async ({ page }) => {
            await page.locator('#btn-start').click();
            const vy = await page.evaluate(() => {
                state = 'paused';
                puck.x = 50; puck.y = puck.r - 2; puck.vx = 0; puck.vy = -300;
                update(0.05);
                return puck.vy;
            });
            expect(vy).toBeGreaterThan(0); // reflected downward
        });

        test('the puck passes through the top goal mouth without bouncing', async ({ page }) => {
            await page.locator('#btn-start').click();
            const vy = await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0;
                puck.x = WIDTH / 2; puck.y = puck.r - 2; puck.vx = 0; puck.vy = -300;
                update(0.016);
                return puck.vy;
            });
            expect(vy).toBeLessThan(0); // still heading up, no bounce
        });

        test('friction slows the puck down', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                puck.x = 230; puck.y = 350; puck.vx = 400; puck.vy = 0;
                const before = Math.hypot(puck.vx, puck.vy);
                update(0.1);
                const after = Math.hypot(puck.vx, puck.vy);
                return { before, after };
            });
            expect(r.after).toBeLessThan(r.before);
        });
    });

    // -----------------------------------------------------------------------
    // Mallet collisions
    // -----------------------------------------------------------------------
    test.describe('mallet collisions', () => {
        test('the puck rebounds off the player mallet', async ({ page }) => {
            await page.locator('#btn-start').click();
            const vy = await page.evaluate(() => {
                state = 'paused';
                player.x = 230; player.y = 600; player.px = 230; player.py = 600;
                keys.up = keys.down = keys.left = keys.right = false;
                // puck just above the mallet, moving down into it
                puck.x = 230; puck.y = 600 - (puck.r + player.r) + 3;
                puck.vx = 0; puck.vy = 250;
                update(0.016);
                return puck.vy;
            });
            expect(vy).toBeLessThan(0); // knocked back upward
        });

        test('the puck is pushed clear of the mallet (no overlap left)', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.x = 230; player.y = 600; player.px = 230; player.py = 600;
                puck.x = 230; puck.y = 600 - (puck.r + player.r) + 3;
                puck.vx = 0; puck.vy = 250;
                update(0.016);
                const dist = Math.hypot(puck.x - player.x, puck.y - player.y);
                return { dist, minDist: puck.r + player.r };
            });
            expect(r.dist).toBeGreaterThanOrEqual(r.minDist - 0.5);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('the player scores when the puck exits the top goal', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0;
                puck.x = WIDTH / 2; puck.y = -puck.r - 5; puck.vx = 0; puck.vy = -200;
                update(0.016);
                return { p: playerScore, c: cpuScore };
            });
            expect(r.p).toBe(1);
            expect(r.c).toBe(0);
        });

        test('the CPU scores when the puck exits the bottom goal', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0;
                puck.x = WIDTH / 2; puck.y = HEIGHT + puck.r + 5; puck.vx = 0; puck.vy = 200;
                update(0.016);
                return { p: playerScore, c: cpuScore };
            });
            expect(r.p).toBe(0);
            expect(r.c).toBe(1);
        });

        test('the puck re-centres after a goal', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0;
                puck.x = WIDTH / 2; puck.y = -puck.r - 5; puck.vx = 0; puck.vy = -200;
                update(0.016);
                return { x: puck.x, y: puck.y, W: WIDTH, H: HEIGHT };
            });
            expect(r.x).toBeCloseTo(r.W / 2, 0);
            expect(r.y).toBeCloseTo(r.H / 2, 0);
        });

        test('the score display updates in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0;
                puck.x = WIDTH / 2; puck.y = -puck.r - 5; puck.vx = 0; puck.vy = -200;
                update(0.016);
            });
            await expect(page.locator('#score-player')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // The AI opponent
    // -----------------------------------------------------------------------
    test.describe('the CPU opponent', () => {
        test('the CPU mallet tracks the puck in its half', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                cpu.x = WIDTH / 2; cpu.px = WIDTH / 2;
                // puck in the CPU's half, over to the left
                puck.x = 90; puck.y = 150; puck.vx = 0; puck.vy = 0;
                const x0 = cpu.x;
                for (let i = 0; i < 12; i++) update(0.05);
                return { x0, x1: cpu.x };
            });
            expect(r.x1).toBeLessThan(r.x0); // slid left toward the puck
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
                puck.x = WIDTH / 2; puck.y = -puck.r - 5; puck.vx = 0; puck.vy = -200;
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
                puck.x = WIDTH / 2; puck.y = -puck.r - 5; puck.vx = 0; puck.vy = -200;
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
                puck.x = WIDTH / 2; puck.y = HEIGHT + puck.r + 5; puck.vx = 0; puck.vy = 200;
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
    // Wins tally (persisted)
    // -----------------------------------------------------------------------
    test.describe('wins tally', () => {
        test('winning a match increments the wins tally', async ({ page }) => {
            await page.locator('#btn-start').click();
            const w = await page.evaluate(() => {
                wins = 0;
                endGame('player');
                return wins;
            });
            expect(w).toBe(1);
        });

        test('losing a match does not increment the wins tally', async ({ page }) => {
            await page.locator('#btn-start').click();
            const w = await page.evaluate(() => {
                wins = 3;
                endGame('cpu');
                return wins;
            });
            expect(w).toBe(3);
        });

        test('the wins tally persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { wins = 0; endGame('player'); });
            const stored = await page.evaluate(() => localStorage.getItem('airhockey-wins'));
            expect(parseInt(stored, 10)).toBe(1);
        });

        test('the wins display updates in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { wins = 4; endGame('player'); });
            await expect(page.locator('#wins')).toHaveText('5');
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
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
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the puck does not move while paused', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ x: puck.x, y: puck.y }));
            await page.waitForTimeout(250);
            const after = await page.evaluate(() => ({ x: puck.x, y: puck.y }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Real play-through (drives the actual requestAnimationFrame loop)
    // -----------------------------------------------------------------------
    test.describe('real play-through', () => {
        test('the puck keeps moving under the real game loop', async ({ page }) => {
            await page.locator('#btn-start').click();
            const p0 = await page.evaluate(() => ({ x: puck.x, y: puck.y }));
            await page.waitForFunction((s) =>
                Math.hypot(puck.x - s.x, puck.y - s.y) > 5, p0, { timeout: 8000 });
            expect(true).toBe(true);
        });
    });
});
