const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Galaga', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Galaga', async ({ page }) => {
            await expect(page).toHaveTitle('Galaga');
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

        test('aliens are built as a full grid', async ({ page }) => {
            const info = await page.evaluate(() => ({
                total: enemies.length,
                alive: enemies.filter(e => e.alive).length,
                rows: ENEMY_ROWS,
                cols: ENEMY_COLS,
            }));
            expect(info.total).toBe(info.rows * info.cols);
            expect(info.alive).toBe(info.rows * info.cols);
        });

        test('all aliens start in formation (none diving)', async ({ page }) => {
            const diving = await page.evaluate(() => enemies.filter(e => e.diving).length);
            expect(diving).toBe(0);
        });

        test('fighter is centered horizontally', async ({ page }) => {
            const centered = await page.evaluate(
                () => Math.abs((player.x + PLAYER_W / 2) - WIDTH / 2) < 1
            );
            expect(centered).toBe(true);
        });

        test('no bullets exist before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                p: playerBullets.length,
                e: enemyBullets.length,
            }));
            expect(counts.p).toBe(0);
            expect(counts.e).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('arrow key dismisses overlay', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
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
    });

    // -----------------------------------------------------------------------
    // Fighter movement
    // -----------------------------------------------------------------------
    test.describe('fighter movement', () => {
        test('ArrowRight moves the fighter right', async ({ page }) => {
            await page.keyboard.press('Space');
            const startX = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowRight');
            const endX = await page.evaluate(() => player.x);
            expect(endX).toBeGreaterThan(startX);
        });

        test('ArrowLeft moves the fighter left', async ({ page }) => {
            await page.keyboard.press('Space');
            const startX = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowLeft');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowLeft');
            const endX = await page.evaluate(() => player.x);
            expect(endX).toBeLessThan(startX);
        });

        test('fighter is clamped to the right edge', async ({ page }) => {
            await page.evaluate(() => movePlayerTo(WIDTH + 500));
            const atEdge = await page.evaluate(
                () => Math.abs(player.x - (WIDTH - PLAYER_W)) < 0.001
            );
            expect(atEdge).toBe(true);
        });

        test('fighter is clamped to the left edge', async ({ page }) => {
            await page.evaluate(() => movePlayerTo(-500));
            const x = await page.evaluate(() => player.x);
            expect(x).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('firing creates a fighter shot', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => firePlayerBullet());
            const n = await page.evaluate(() => playerBullets.length);
            expect(n).toBe(1);
        });

        test('Space fires a shot while running', async ({ page }) => {
            await page.keyboard.press('Space'); // start
            await page.keyboard.press('Space'); // fire
            const n = await page.evaluate(() => playerBullets.length);
            expect(n).toBe(1);
        });

        test('at most two fighter shots may be in flight at once', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                firePlayerBullet();
                firePlayerBullet();
                firePlayerBullet();
                firePlayerBullet();
            });
            const n = await page.evaluate(() => playerBullets.length);
            expect(n).toBe(2);
        });

        test('a fighter shot travels upward', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => firePlayerBullet());
            const before = await page.evaluate(() => playerBullets[0].y);
            await page.evaluate(() => step(30));
            const after = await page.evaluate(() => playerBullets[0] ? playerBullets[0].y : -999);
            expect(after).toBeLessThan(before);
        });

        test('a fighter shot leaving the top is removed', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                firePlayerBullet();
                playerBullets[0].y = 1;
                step(50);
            });
            const n = await page.evaluate(() => playerBullets.length);
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Formation & diving
    // -----------------------------------------------------------------------
    test.describe('formation and diving', () => {
        test('the formation sways horizontally', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => enemies[0].x);
            await page.evaluate(() => step(50));
            const after = await page.evaluate(() => enemies[0].x);
            expect(after).not.toBe(before);
        });

        test('the formation never descends on its own', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => enemies[0].y);
            await page.evaluate(() => step(200));
            const after = await page.evaluate(() => enemies[0].y);
            expect(after).toBe(before);
        });

        test('startDive sends an alien swooping downward', async ({ page }) => {
            await page.keyboard.press('Space');
            const result = await page.evaluate(() => {
                const e = enemies.find(en => en.alive);
                const y0 = e.y;
                startDive(e);
                step(60);
                return { diving: e.diving, y0, y1: e.y };
            });
            expect(result.diving).toBe(true);
            expect(result.y1).toBeGreaterThan(result.y0);
        });

        test('a diving alien loops back to formation past the bottom', async ({ page }) => {
            await page.keyboard.press('Space');
            const result = await page.evaluate(() => {
                const e = enemies.find(en => en.alive);
                startDive(e);
                e.y = HEIGHT + 5; // already fallen past the bottom
                step(1);
                return { diving: e.diving, y: e.y, homeY: e.homeY };
            });
            expect(result.diving).toBe(false);
            expect(result.y).toBe(result.homeY);
        });

        test('a fighter shot destroys an alien', async ({ page }) => {
            await page.keyboard.press('Space');
            const aliveBefore = await page.evaluate(() => enemies.filter(e => e.alive).length);
            await page.evaluate(() => {
                firePlayerBullet();
                const e = enemies.find(en => en.alive);
                const b = playerBullets[0];
                b.x = e.x + ENEMY_W / 2;
                b.y = e.y + ENEMY_H / 2;
                step(1);
            });
            const aliveAfter = await page.evaluate(() => enemies.filter(e => e.alive).length);
            expect(aliveAfter).toBe(aliveBefore - 1);
        });

        test('score increases when an alien is destroyed', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                firePlayerBullet();
                const e = enemies.find(en => en.alive);
                const b = playerBullets[0];
                b.x = e.x + ENEMY_W / 2;
                b.y = e.y + ENEMY_H / 2;
                step(1);
            });
            const score = parseInt(await page.locator('#score').textContent());
            expect(score).toBeGreaterThan(0);
        });

        test('a shot is consumed when it hits an alien', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                firePlayerBullet();
                const e = enemies.find(en => en.alive);
                const b = playerBullets[0];
                b.x = e.x + ENEMY_W / 2;
                b.y = e.y + ENEMY_H / 2;
                step(1);
            });
            const n = await page.evaluate(() => playerBullets.length);
            expect(n).toBe(0);
        });

        test('a diving alien is worth double points', async ({ page }) => {
            await page.keyboard.press('Space');
            const actual = await page.evaluate(() => {
                const e = enemies[0]; // top-row alien
                startDive(e);
                firePlayerBullet();
                const b = playerBullets[0];
                b.x = e.x + ENEMY_W / 2;
                b.y = e.y + ENEMY_H / 2;
                step(1);
                return score;
            });
            const base = await page.evaluate(() => enemies[0].points);
            expect(actual).toBe(base * 2);
        });

        test('clearing all aliens advances to the next wave', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                enemies.forEach(e => (e.alive = false));
                enemies[0].alive = true; // leave one to knock out
                firePlayerBullet();
                const e = enemies[0];
                const b = playerBullets[0];
                b.x = e.x + ENEMY_W / 2;
                b.y = e.y + ENEMY_H / 2;
                step(1);
            });
            await expect(page.locator('#level')).toHaveText('2');
            const alive = await page.evaluate(() => enemies.filter(e => e.alive).length);
            expect(alive).toBe(await page.evaluate(() => ENEMY_ROWS * ENEMY_COLS));
        });
    });

    // -----------------------------------------------------------------------
    // Enemy fire, ramming & lives
    // -----------------------------------------------------------------------
    test.describe('enemy fire, ramming and lives', () => {
        test('an enemy bomb hitting the fighter costs a life', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                enemyBullets.push({
                    x: player.x + PLAYER_W / 2,
                    y: player.y,
                    w: BULLET_W,
                    h: BULLET_H,
                });
                step(1);
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('bombs are cleared after the fighter is hit', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                enemyBullets.push({
                    x: player.x + PLAYER_W / 2,
                    y: player.y,
                    w: BULLET_W,
                    h: BULLET_H,
                });
                step(1);
            });
            const n = await page.evaluate(() => enemyBullets.length);
            expect(n).toBe(0);
        });

        test('an enemy bomb falling past the bottom is removed', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                enemyBullets.push({ x: 10, y: HEIGHT + 5, w: BULLET_W, h: BULLET_H });
                step(50);
            });
            const n = await page.evaluate(() => enemyBullets.length);
            expect(n).toBe(0);
        });

        test('a diving alien ramming the fighter costs a life', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                const e = enemies.find(en => en.alive);
                startDive(e);
                e.x = player.x;
                e.y = player.y;
                step(1);
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                lives = 1;
                enemyBullets.push({
                    x: player.x + PLAYER_W / 2,
                    y: player.y,
                    w: BULLET_W,
                    h: BULLET_H,
                });
                step(1);
            });
            const s = await page.evaluate(() => state);
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
            const before = await page.evaluate(() => enemies[0].x);
            await page.evaluate(() => step(100));
            const after = await page.evaluate(() => enemies[0].x);
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
                score = 55;
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent());
            expect(best).toBeGreaterThanOrEqual(55);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 77;
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('galaga-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(77);
        });
    });
});
