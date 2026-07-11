const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Doodle Jump', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Doodle Jump', async ({ page }) => {
            await expect(page).toHaveTitle('Doodle Jump');
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

        test('platforms are generated', async ({ page }) => {
            const count = await page.evaluate(() => platforms.length);
            expect(count).toBeGreaterThan(0);
        });

        test('every generated gap is reachable by a single jump', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const apex = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
                const ys = platforms.map(p => p.y).sort((a, b) => a - b);
                for (let i = 1; i < ys.length; i++) {
                    if (ys[i] - ys[i - 1] > apex) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('player rests on the starting platform (no velocity)', async ({ page }) => {
            const resting = await page.evaluate(() => player.vy === 0 && player.vx === 0);
            expect(resting).toBe(true);
        });

        test('player is inside the canvas', async ({ page }) => {
            const inside = await page.evaluate(
                () => player.x >= 0 && player.x + player.w <= WIDTH && player.y + player.h <= HEIGHT
            );
            expect(inside).toBe(true);
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

        test('arrow key dismisses overlay', async ({ page }) => {
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

        test('player launches upward after start', async ({ page }) => {
            await page.keyboard.press('Space');
            const vy = await page.evaluate(() => player.vy);
            expect(vy).toBeLessThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Horizontal movement
    // -----------------------------------------------------------------------
    test.describe('horizontal movement', () => {
        test('ArrowRight moves the player right', async ({ page }) => {
            await page.keyboard.press('Space');
            const startX = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowRight');
            const endX = await page.evaluate(() => player.x);
            expect(endX).toBeGreaterThan(startX);
        });

        test('ArrowLeft moves the player left', async ({ page }) => {
            await page.keyboard.press('Space');
            // Nudge to the middle so a left move can't immediately wrap.
            await page.evaluate(() => { player.x = WIDTH / 2; });
            const startX = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowLeft');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowLeft');
            const endX = await page.evaluate(() => player.x);
            expect(endX).toBeLessThan(startX);
        });

        test('player wraps around the right edge', async ({ page }) => {
            await page.keyboard.press('Space');
            const x = await page.evaluate(() => {
                player.x = WIDTH + 1;
                player.vy = -0.1;
                step(1);
                return player.x;
            });
            expect(x).toBeLessThan(WIDTH_JS);
        });

        test('player wraps around the left edge', async ({ page }) => {
            await page.keyboard.press('Space');
            const x = await page.evaluate(() => {
                player.x = -player.w - 1;
                player.vy = -0.1;
                step(1);
                return player.x;
            });
            expect(x).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Gravity & bouncing
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('gravity pulls the player down over time', async ({ page }) => {
            await page.keyboard.press('Space');
            const grew = await page.evaluate(() => {
                // Put the player in open air, far from any platform, moving up.
                platforms.length = 0;
                player.x = WIDTH / 2;
                player.y = 100;
                player.vy = -0.2;
                const before = player.vy;
                step(20);
                return player.vy > before;
            });
            expect(grew).toBe(true);
        });

        test('player position advances when running', async ({ page }) => {
            await page.keyboard.press('Space');
            const moved = await page.evaluate(() => {
                platforms.length = 0;
                player.y = 100;
                player.vy = 0.2;
                const before = player.y;
                step(20);
                return player.y !== before;
            });
            expect(moved).toBe(true);
        });

        test('player bounces up off a normal platform', async ({ page }) => {
            await page.keyboard.press('Space');
            const vy = await page.evaluate(() => {
                platforms.length = 0;
                platforms.push({ x: WIDTH / 2 - PLATFORM_W / 2, y: 300, w: PLATFORM_W, h: PLATFORM_H, type: 'normal', alive: true, vx: 0 });
                player.x = WIDTH / 2 - PLAYER_W / 2;
                player.y = 300 - PLAYER_H - 2; // feet just above the platform top
                player.vx = 0;
                player.vy = 0.3; // falling
                step(16);
                return player.vy;
            });
            expect(vy).toBeLessThan(0); // now heading up
        });

        test('a rising player does not bounce off a platform', async ({ page }) => {
            await page.keyboard.press('Space');
            const vy = await page.evaluate(() => {
                platforms.length = 0;
                platforms.push({ x: WIDTH / 2 - PLATFORM_W / 2, y: 300, w: PLATFORM_W, h: PLATFORM_H, type: 'normal', alive: true, vx: 0 });
                player.x = WIDTH / 2 - PLAYER_W / 2;
                player.y = 300 + PLATFORM_H; // just below the platform, moving up through it
                player.vx = 0;
                player.vy = -0.3; // rising
                step(16);
                return player.vy;
            });
            expect(vy).toBeLessThan(0); // still rising, no bounce
        });

        test('every bounce reaches the same apex velocity', async ({ page }) => {
            await page.keyboard.press('Space');
            const vy = await page.evaluate(() => {
                platforms.length = 0;
                platforms.push({ x: WIDTH / 2 - PLATFORM_W / 2, y: 300, w: PLATFORM_W, h: PLATFORM_H, type: 'normal', alive: true, vx: 0 });
                player.x = WIDTH / 2 - PLAYER_W / 2;
                player.y = 300 - PLAYER_H - 2;
                player.vy = 0.5; // arbitrary fall speed
                step(16);
                return player.vy;
            });
            expect(vy).toBeCloseTo(-JUMP_VELOCITY_JS, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Platform types
    // -----------------------------------------------------------------------
    test.describe('platform types', () => {
        test('breakable platform breaks on contact', async ({ page }) => {
            await page.keyboard.press('Space');
            const alive = await page.evaluate(() => {
                platforms.length = 0;
                platforms.push({ x: WIDTH / 2 - PLATFORM_W / 2, y: 300, w: PLATFORM_W, h: PLATFORM_H, type: 'breakable', alive: true, vx: 0 });
                player.x = WIDTH / 2 - PLAYER_W / 2;
                player.y = 300 - PLAYER_H - 2;
                player.vy = 0.3;
                step(16);
                return platforms[0].alive;
            });
            expect(alive).toBe(false);
        });

        test('breakable platform gives no bounce', async ({ page }) => {
            await page.keyboard.press('Space');
            const vy = await page.evaluate(() => {
                platforms.length = 0;
                platforms.push({ x: WIDTH / 2 - PLATFORM_W / 2, y: 300, w: PLATFORM_W, h: PLATFORM_H, type: 'breakable', alive: true, vx: 0 });
                player.x = WIDTH / 2 - PLAYER_W / 2;
                player.y = 300 - PLAYER_H - 2;
                player.vy = 0.3;
                step(16);
                return player.vy;
            });
            expect(vy).toBeGreaterThan(0); // still falling through
        });

        test('moving platform drifts horizontally', async ({ page }) => {
            await page.keyboard.press('Space');
            const moved = await page.evaluate(() => {
                platforms.length = 0;
                platforms.push({ x: 100, y: 200, w: PLATFORM_W, h: PLATFORM_H, type: 'moving', alive: true, vx: 0.1 });
                // Keep the player away so it doesn't collide.
                player.y = -100;
                player.vy = -0.1;
                const before = platforms[0].x;
                step(20);
                return platforms[0].x !== before;
            });
            expect(moved).toBe(true);
        });

        test('moving platform reverses at the right edge', async ({ page }) => {
            await page.keyboard.press('Space');
            const vx = await page.evaluate(() => {
                platforms.length = 0;
                platforms.push({ x: WIDTH - PLATFORM_W, y: 200, w: PLATFORM_W, h: PLATFORM_H, type: 'moving', alive: true, vx: 0.2 });
                player.y = -100;
                player.vy = -0.1;
                step(20);
                return platforms[0].vx;
            });
            expect(vx).toBeLessThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Camera scroll & scoring
    // -----------------------------------------------------------------------
    test.describe('scrolling and scoring', () => {
        test('climbing above the camera line scrolls the world down', async ({ page }) => {
            await page.keyboard.press('Space');
            const moved = await page.evaluate(() => {
                platforms.length = 0;
                platforms.push({ x: 100, y: 400, w: PLATFORM_W, h: PLATFORM_H, type: 'normal', alive: true, vx: 0, tag: 'watch' });
                player.x = 100;
                player.y = CAMERA_LINE - 40;
                player.vy = -0.3; // rising above the camera line
                const before = platforms.find(p => p.tag === 'watch').y;
                step(16);
                const watched = platforms.find(p => p.tag === 'watch');
                return watched ? watched.y > before : true;
            });
            expect(moved).toBe(true);
        });

        test('climbing increases the score', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                platforms.length = 0;
                player.x = WIDTH / 2;
                player.y = CAMERA_LINE - 40;
                player.vy = -0.3;
                const before = score;
                step(16);
                return { before, after: score };
            });
            expect(info.after).toBeGreaterThan(info.before);
        });

        test('the player is pinned at the camera line while climbing', async ({ page }) => {
            await page.keyboard.press('Space');
            const y = await page.evaluate(() => {
                platforms.length = 0;
                player.x = WIDTH / 2;
                player.y = CAMERA_LINE - 40;
                player.vy = -0.3;
                step(16);
                return player.y;
            });
            expect(y).toBeCloseTo(CAMERA_LINE_JS, 1);
        });

        test('descending within the screen does not reduce the score', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                platforms.length = 0;
                player.x = WIDTH / 2;
                player.y = HEIGHT / 2;
                player.vy = 0.3; // falling but still on screen
                const before = score;
                step(16);
                return { before, after: score };
            });
            expect(info.after).toBe(info.before);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('falling below the bottom ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                platforms.length = 0;
                player.y = HEIGHT + 10;
                player.vy = 0.3;
                step(1);
                return state;
            });
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

        test('restarting resets the score', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 123;
                scoreEl.textContent = score;
                endGame();
            });
            await page.keyboard.press('Space');
            await expect(page.locator('#score')).toHaveText('0');
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
            const stored = await page.evaluate(() => localStorage.getItem('doodlejump-best'));
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

        test('player does not move while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ x: player.x, y: player.y }));
            await page.evaluate(() => step(100));
            const after = await page.evaluate(() => ({ x: player.x, y: player.y }));
            expect(after).toEqual(before);
        });
    });
});

// Constants mirrored from game.js so the specs can reference them outside
// page.evaluate (Playwright injects these into the Node test scope).
const WIDTH_JS = 400;
const CAMERA_LINE_JS = 600 * 0.4;
const JUMP_VELOCITY_JS = 0.62;
