const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Space Invaders', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Space Invaders', async ({ page }) => {
            await expect(page).toHaveTitle('Space Invaders');
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
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the invader formation is built as a full grid', async ({ page }) => {
            const info = await page.evaluate(() => ({
                total: invaders.length,
                alive: invaders.filter(i => i.alive).length,
                rows: INVADER_ROWS,
                cols: INVADER_COLS,
            }));
            expect(info.total).toBe(info.rows * info.cols);
            expect(info.alive).toBe(info.rows * info.cols);
        });

        test('the cannon is centered horizontally near the bottom', async ({ page }) => {
            const info = await page.evaluate(() => ({
                centered: Math.abs((player.x + player.w / 2) - WIDTH / 2) < 1,
                nearBottom: player.y > HEIGHT * 0.8,
            }));
            expect(info.centered).toBe(true);
            expect(info.nearBottom).toBe(true);
        });

        test('no bullets or bombs before starting', async ({ page }) => {
            const info = await page.evaluate(() => ({
                bullets: playerBullets.length,
                bombs: bombs.length,
            }));
            expect(info.bullets).toBe(0);
            expect(info.bombs).toBe(0);
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

        test('an arrow key dismisses the overlay', async ({ page }) => {
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

        test('starting rebuilds a full formation', async ({ page }) => {
            await page.locator('#btn-start').click();
            const alive = await page.evaluate(() => invaders.filter(i => i.alive).length);
            expect(alive).toBe(await page.evaluate(() => INVADER_ROWS * INVADER_COLS));
        });
    });

    // -----------------------------------------------------------------------
    // Cannon movement
    // -----------------------------------------------------------------------
    test.describe('cannon movement', () => {
        test('ArrowRight moves the cannon right', async ({ page }) => {
            await page.keyboard.press('Space');
            const startX = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowRight');
            const endX = await page.evaluate(() => player.x);
            expect(endX).toBeGreaterThan(startX);
        });

        test('ArrowLeft moves the cannon left', async ({ page }) => {
            await page.keyboard.press('Space');
            const startX = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowLeft');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowLeft');
            const endX = await page.evaluate(() => player.x);
            expect(endX).toBeLessThan(startX);
        });

        test('the cannon is clamped to the right edge', async ({ page }) => {
            await page.evaluate(() => movePlayerTo(WIDTH + 500));
            const ok = await page.evaluate(() => player.x + player.w <= WIDTH + 0.001);
            expect(ok).toBe(true);
        });

        test('the cannon is clamped to the left edge', async ({ page }) => {
            await page.evaluate(() => movePlayerTo(-500));
            expect(await page.evaluate(() => player.x)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test('firePlayerBullet adds an upward bullet', async ({ page }) => {
            await page.keyboard.press('Space');
            const b = await page.evaluate(() => {
                playerBullets = [];
                firePlayerBullet();
                return { n: playerBullets.length, vy: playerBullets[0].vy };
            });
            expect(b.n).toBe(1);
            expect(b.vy).toBeLessThan(0);
        });

        test('Space fires while the game is running', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { playerBullets = []; });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => playerBullets.length)).toBeGreaterThan(0);
        });

        test('the number of simultaneous bullets is capped', async ({ page }) => {
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => {
                playerBullets = [];
                for (let i = 0; i < MAX_PLAYER_BULLETS + 5; i++) firePlayerBullet();
                return playerBullets.length;
            });
            expect(n).toBe(await page.evaluate(() => MAX_PLAYER_BULLETS));
        });

        test('a bullet that leaves the top of the screen is removed', async ({ page }) => {
            await page.keyboard.press('Space');
            const gone = await page.evaluate(() => {
                playerBullets = [{ x: WIDTH / 2, y: 2, w: 3, h: 10, vy: -0.7 }];
                step(50);
                return playerBullets.length;
            });
            expect(gone).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // The marching swarm
    // -----------------------------------------------------------------------
    test.describe('marching swarm', () => {
        test('the swarm advances horizontally over a step', async ({ page }) => {
            await page.keyboard.press('Space');
            const moved = await page.evaluate(() => {
                invaderDir = 1;
                const before = invaders.find(i => i.alive).x;
                step(50);
                return invaders.find(i => i.alive).x > before;
            });
            expect(moved).toBe(true);
        });

        test('the swarm reverses and drops at the right edge', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => {
                // isolate a single invader pinned to the right edge
                invaders.forEach(i => (i.alive = false));
                const inv = invaders[0];
                inv.alive = true;
                inv.x = WIDTH - inv.w;
                inv.y = 60;
                invaderDir = 1;
                const beforeY = inv.y;
                step(50);
                return { dir: invaderDir, dropped: inv.y > beforeY };
            });
            expect(r.dir).toBe(-1);
            expect(r.dropped).toBe(true);
        });

        test('the swarm reverses and drops at the left edge', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => {
                invaders.forEach(i => (i.alive = false));
                const inv = invaders[0];
                inv.alive = true;
                inv.x = 0;
                inv.y = 60;
                invaderDir = -1;
                const beforeY = inv.y;
                step(50);
                return { dir: invaderDir, dropped: inv.y > beforeY };
            });
            expect(r.dir).toBe(1);
            expect(r.dropped).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting invaders
    // -----------------------------------------------------------------------
    test.describe('shooting invaders', () => {
        async function shootRow(page, row) {
            return page.evaluate((r) => {
                const inv = invaders.find(i => i.alive && i.row === r);
                playerBullets = [{ x: inv.x + inv.w / 2, y: inv.y + inv.h / 2, w: 3, h: 10, vy: -0.7 }];
                bombs = [];
                const before = score;
                step(1);
                return { killed: !inv.alive, gained: score - before, bullets: playerBullets.length };
            }, row);
        }

        test('a bullet destroys the invader it hits', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await shootRow(page, 2);
            expect(r.killed).toBe(true);
        });

        test('the bullet is consumed on impact', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await shootRow(page, 2);
            expect(r.bullets).toBe(0);
        });

        test('the top row is worth 30 points', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await shootRow(page, 0);
            expect(r.gained).toBe(30);
        });

        test('a middle row is worth 20 points', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await shootRow(page, 2);
            expect(r.gained).toBe(20);
        });

        test('the bottom row is worth 10 points', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await shootRow(page, INVADER_ROWS_CONST - 1);
            expect(r.gained).toBe(10);
        });

        test('the score display updates in the DOM', async ({ page }) => {
            await page.keyboard.press('Space');
            await shootRow(page, 0);
            const shown = parseInt(await page.locator('#score').textContent(), 10);
            expect(shown).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Alien fire
    // -----------------------------------------------------------------------
    test.describe('alien fire', () => {
        test('dropBomb adds a downward-moving bomb', async ({ page }) => {
            await page.keyboard.press('Space');
            const b = await page.evaluate(() => {
                bombs = [];
                dropBomb();
                return { n: bombs.length, vy: bombs[0].vy };
            });
            expect(b.n).toBe(1);
            expect(b.vy).toBeGreaterThan(0);
        });

        test('a bomb that leaves the bottom is removed', async ({ page }) => {
            await page.keyboard.press('Space');
            const gone = await page.evaluate(() => {
                bombs = [{ x: WIDTH / 2, y: HEIGHT - 2, w: 3, h: 10, vy: 0.2 }];
                step(60);
                return bombs.length;
            });
            expect(gone).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Lives, collisions and game over
    // -----------------------------------------------------------------------
    test.describe('lives and loss', () => {
        test('a bomb hitting the cannon costs a life', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                bombs = [{ x: player.x + player.w / 2, y: player.y, w: 3, h: 10, vy: 0.2 }];
                step(1);
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the hitting bomb is removed', async ({ page }) => {
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => {
                bombs = [{ x: player.x + player.w / 2, y: player.y, w: 3, h: 10, vy: 0.2 }];
                step(1);
                return bombs.length;
            });
            expect(n).toBe(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                lives = 1;
                bombs = [{ x: player.x + player.w / 2, y: player.y, w: 3, h: 10, vy: 0.2 }];
                step(1);
                return state;
            });
            expect(s).toBe('over');
        });

        test('an invader reaching the cannon row ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                const inv = invaders.find(i => i.alive);
                inv.y = player.y - inv.h + 2;
                step(1);
                return state;
            });
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('clearing the formation advances to the next level', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                invaders.forEach(i => (i.alive = false));
                const inv = invaders[0];
                inv.alive = true;
                playerBullets = [{ x: inv.x + inv.w / 2, y: inv.y + inv.h / 2, w: 3, h: 10, vy: -0.7 }];
                bombs = [];
                step(1);
            });
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('a fresh full formation spawns on the next level', async ({ page }) => {
            await page.keyboard.press('Space');
            const alive = await page.evaluate(() => {
                invaders.forEach(i => (i.alive = false));
                const inv = invaders[0];
                inv.alive = true;
                playerBullets = [{ x: inv.x + inv.w / 2, y: inv.y + inv.h / 2, w: 3, h: 10, vy: -0.7 }];
                bombs = [];
                step(1);
                return invaders.filter(i => i.alive).length;
            });
            expect(alive).toBe(await page.evaluate(() => INVADER_ROWS * INVADER_COLS));
        });
    });

    // -----------------------------------------------------------------------
    // Pause and resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
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
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the swarm does not move while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const still = await page.evaluate(() => {
                const before = invaders.find(i => i.alive).x;
                step(200);
                return invaders.find(i => i.alive).x === before;
            });
            expect(still).toBe(true);
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
                level = 3;
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
            const best = parseInt(await page.locator('#best').textContent(), 10);
            expect(best).toBeGreaterThanOrEqual(555);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 777;
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('space-invaders-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(777);
        });
    });
});

// Mirror of INVADER_ROWS for the bottom-row scoring test (used outside evaluate).
const INVADER_ROWS_CONST = 5;
