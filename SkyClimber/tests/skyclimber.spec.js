const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Sky Climber', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Sky Climber', async ({ page }) => {
            await expect(page).toHaveTitle('Sky Climber');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains how to steer', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('steer');
        });

        test('height score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 480×640', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '640');
        });

        test('the hopper starts near the horizontal centre', async ({ page }) => {
            const r = await page.evaluate(() => ({ x: hopper.x, W: WIDTH }));
            expect(r.x).toBeCloseTo(r.W / 2, 0);
        });

        test('there is at least one platform to land on', async ({ page }) => {
            const n = await page.evaluate(() => platforms.length);
            expect(n).toBeGreaterThan(0);
        });

        test('the hopper starts resting above the bottom of the board', async ({ page }) => {
            const r = await page.evaluate(() => ({ y: hopper.y, H: HEIGHT }));
            expect(r.y).toBeLessThan(r.H);
            expect(r.y).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('a steer key dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is running after start', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Steering (deterministic: freeze the loop, drive update() directly)
    // -----------------------------------------------------------------------
    test.describe('steering', () => {
        test('ArrowRight / D moves the hopper right', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                hopper.x = 240;
                const x0 = hopper.x;
                keys.right = true; keys.left = false;
                update(0.05);
                keys.right = false;
                return { x0, x1: hopper.x };
            });
            expect(r.x1).toBeGreaterThan(r.x0);
        });

        test('ArrowLeft / A moves the hopper left', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                hopper.x = 240;
                const x0 = hopper.x;
                keys.left = true; keys.right = false;
                update(0.05);
                keys.left = false;
                return { x0, x1: hopper.x };
            });
            expect(r.x1).toBeLessThan(r.x0);
        });

        test('leaving the right edge wraps the hopper to the left', async ({ page }) => {
            await page.locator('#btn-start').click();
            const x = await page.evaluate(() => {
                state = 'paused';
                hopper.x = WIDTH - 2;
                keys.right = true; keys.left = false;
                update(0.1);
                keys.right = false;
                return hopper.x;
            });
            expect(x).toBeLessThan(240); // reappeared on the left half
        });

        test('leaving the left edge wraps the hopper to the right', async ({ page }) => {
            await page.locator('#btn-start').click();
            const x = await page.evaluate(() => {
                state = 'paused';
                hopper.x = 2;
                keys.left = true; keys.right = false;
                update(0.1);
                keys.left = false;
                return hopper.x;
            });
            expect(x).toBeGreaterThan(240); // reappeared on the right half
        });

        test('releasing the keys stops horizontal motion', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                hopper.x = 240;
                keys.left = false; keys.right = false;
                const x0 = hopper.x;
                update(0.1);
                return { x0, x1: hopper.x };
            });
            expect(r.x1).toBe(r.x0);
        });
    });

    // -----------------------------------------------------------------------
    // Vertical physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('gravity accelerates the hopper downward', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                platforms = []; // nothing to bounce off
                hopper.x = 240; hopper.y = 300; hopper.vy = 0;
                update(0.1);
                return hopper.vy;
            });
            expect(r).toBeGreaterThan(0);
        });

        test('the hopper moves over time', async ({ page }) => {
            await page.locator('#btn-start').click();
            const moved = await page.evaluate(() => {
                state = 'paused';
                platforms = [];
                hopper.x = 240; hopper.y = 300; hopper.vy = 40;
                const y0 = hopper.y;
                update(0.1);
                return hopper.y !== y0;
            });
            expect(moved).toBe(true);
        });

        test('the hopper bounces off a platform it lands on', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                const p = { x: 240, y: 400, w: 68, h: 16, type: 'static', vx: 0 };
                platforms = [p];
                const top = p.y - p.h / 2;
                hopper.x = 240;
                hopper.y = top - 1 - hopper.h / 2; // feet 1px above the platform top
                hopper.vy = 60; // falling
                update(0.05);
                return hopper.vy;
            });
            expect(r).toBeLessThan(0); // now heading upward
        });

        test('a bounce launches at exactly JUMP_SPEED', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                const p = { x: 240, y: 400, w: 68, h: 16, type: 'static', vx: 0 };
                platforms = [p];
                const top = p.y - p.h / 2;
                hopper.x = 240;
                hopper.y = top - 1 - hopper.h / 2;
                hopper.vy = 60;
                update(0.05);
                return { vy: hopper.vy, jump: JUMP_SPEED };
            });
            expect(r.vy).toBeCloseTo(-r.jump, 5);
        });

        test('the hopper passes up through platforms while rising', async ({ page }) => {
            await page.locator('#btn-start').click();
            const vy = await page.evaluate(() => {
                state = 'paused';
                const p = { x: 240, y: 400, w: 68, h: 16, type: 'static', vx: 0 };
                platforms = [p];
                const top = p.y - p.h / 2;
                hopper.x = 240;
                hopper.y = top + 1 + hopper.h / 2; // feet just below the platform top
                hopper.vy = -100; // rising
                update(0.05);
                return hopper.vy;
            });
            expect(vy).toBeGreaterThan(-200); // not launched to -JUMP_SPEED
        });

        test('a bounce only happens when the hopper is over the platform', async ({ page }) => {
            await page.locator('#btn-start').click();
            const vy = await page.evaluate(() => {
                state = 'paused';
                const p = { x: 60, y: 400, w: 68, h: 16, type: 'static', vx: 0 };
                platforms = [p];
                const top = p.y - p.h / 2;
                hopper.x = 400; // far to the right of the platform
                hopper.y = top - 1 - hopper.h / 2;
                hopper.vy = 60;
                update(0.05);
                return hopper.vy;
            });
            expect(vy).toBeGreaterThan(0); // still falling, no bounce
        });
    });

    // -----------------------------------------------------------------------
    // Camera / scrolling / scoring
    // -----------------------------------------------------------------------
    test.describe('camera and scoring', () => {
        test('climbing above the camera line scrolls the world and scores', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                score = 0;
                // A platform high enough that a small scroll won't push it off-screen.
                platforms = [{ x: 240, y: 400, w: 68, h: 16, type: 'static', vx: 0 }];
                const py0 = platforms[0].y;
                hopper.x = 240; hopper.y = 200; hopper.vy = -50; // just above the camera line
                update(0.016);
                return { py0, py1: platforms[0].y, score, line: CAMERA_LINE, hy: hopper.y };
            });
            expect(r.py1).toBeGreaterThan(r.py0); // platform scrolled downward
            expect(r.score).toBeGreaterThan(0);
            expect(r.hy).toBeCloseTo(r.line, 0); // hopper pinned to the camera line
        });

        test('the hopper does not scroll the world below the camera line', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                score = 0;
                platforms = [{ x: 240, y: 500, w: 68, h: 16, type: 'static', vx: 0 }];
                const py0 = platforms[0].y;
                hopper.x = 240; hopper.y = 550; hopper.vy = 10; // below the camera line
                update(0.016);
                return { py0, py1: platforms[0].y, score };
            });
            expect(r.py1).toBe(r.py0); // no scroll
            expect(r.score).toBe(0);
        });

        test('the score display updates in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                score = 0;
                platforms = [{ x: 240, y: 500, w: 68, h: 16, type: 'static', vx: 0 }];
                hopper.x = 240; hopper.y = 60; hopper.vy = -50;
                update(0.016);
            });
            const shown = await page.evaluate(() => parseInt(document.getElementById('score').textContent, 10));
            expect(shown).toBeGreaterThan(0);
        });

        test('a platform that scrolls off the bottom is recycled to the top', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                platforms = [
                    { x: 100, y: 100, w: 68, h: 16, type: 'static', vx: 0 },
                    { x: 300, y: HEIGHT + 80, w: 68, h: 16, type: 'static', vx: 0 }, // below the board
                ];
                const n0 = platforms.length;
                hopper.x = 240; hopper.y = 300; hopper.vy = 5; // safe, no scroll
                update(0.016);
                const recycled = platforms[1];
                return { n0, n1: platforms.length, newY: recycled.y };
            });
            expect(r.n1).toBe(r.n0);          // count preserved
            expect(r.newY).toBeLessThan(100); // moved above the existing platform
        });
    });

    // -----------------------------------------------------------------------
    // Best height (localStorage)
    // -----------------------------------------------------------------------
    test.describe('best height', () => {
        test('the best rises to match a new high score', async ({ page }) => {
            await page.locator('#btn-start').click();
            const best = await page.evaluate(() => {
                state = 'paused';
                bestScore = 0; score = 0;
                platforms = [{ x: 240, y: 500, w: 68, h: 16, type: 'static', vx: 0 }];
                hopper.x = 240; hopper.y = 40; hopper.vy = -50;
                update(0.016);
                return bestScore;
            });
            expect(best).toBeGreaterThan(0);
        });

        test('the best persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                bestScore = 0; score = 0;
                platforms = [{ x: 240, y: 500, w: 68, h: 16, type: 'static', vx: 0 }];
                hopper.x = 240; hopper.y = 40; hopper.vy = -50;
                update(0.016);
            });
            const stored = await page.evaluate(() => parseInt(localStorage.getItem('sky-climber-best'), 10));
            expect(stored).toBeGreaterThan(0);
        });

        test('the best does not drop below a previous high', async ({ page }) => {
            await page.locator('#btn-start').click();
            const best = await page.evaluate(() => {
                state = 'paused';
                bestScore = 999; score = 0;
                platforms = [{ x: 240, y: 500, w: 68, h: 16, type: 'static', vx: 0 }];
                hopper.x = 240; hopper.y = 200; hopper.vy = -50;
                update(0.016);
                return bestScore;
            });
            expect(best).toBe(999);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('falling off the bottom', () => {
        test('falling past the bottom ends the run', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                state = 'paused';
                platforms = [];
                hopper.x = 240; hopper.y = HEIGHT + 60; hopper.vy = 200;
                update(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('game over shows an overlay with a Game Over title', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                platforms = [];
                hopper.x = 240; hopper.y = HEIGHT + 60; hopper.vy = 200;
                update(0.016);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('Play Again button is shown after the run ends', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets the score to 0', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 42; endGame(); });
            await page.locator('#btn-start').click();
            await expect(page.locator('#score')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Moving platforms
    // -----------------------------------------------------------------------
    test.describe('moving platforms', () => {
        test('a moving platform slides horizontally', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                const p = { x: 240, y: 300, w: 68, h: 16, type: 'moving', vx: 120 };
                platforms = [p];
                hopper.x = 240; hopper.y = 100; hopper.vy = 5; // out of the way, no bounce/scroll
                const x0 = p.x;
                update(0.05);
                return { x0, x1: platforms[0].x };
            });
            expect(r.x1).not.toBe(r.x0);
        });

        test('a moving platform bounces off the side wall', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                const p = { x: WIDTH - 4, y: 300, w: 68, h: 16, type: 'moving', vx: 120 };
                platforms = [p];
                hopper.x = 240; hopper.y = 100; hopper.vy = 5;
                update(0.05);
                return platforms[0].vx;
            });
            expect(r).toBeLessThan(0); // reversed away from the right wall
        });
    });

    // -----------------------------------------------------------------------
    // Layout reachability invariant
    // -----------------------------------------------------------------------
    test.describe('layout', () => {
        test('every vertical gap in the starting layout is jumpable', async ({ page }) => {
            const r = await page.evaluate(() => {
                const ys = platforms.map(p => p.y).sort((a, b) => a - b);
                let maxGap = 0;
                for (let i = 1; i < ys.length; i++) maxGap = Math.max(maxGap, ys[i] - ys[i - 1]);
                return { maxGap, reach: MAX_JUMP_HEIGHT };
            });
            expect(r.maxGap).toBeLessThan(r.reach);
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

        test('the pause overlay shows "Paused"', async ({ page }) => {
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

        test('the hopper does not move while paused', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ x: hopper.x, y: hopper.y }));
            await page.waitForTimeout(300);
            const after = await page.evaluate(() => ({ x: hopper.x, y: hopper.y }));
            expect(after).toEqual(before);
        });
    });
});
