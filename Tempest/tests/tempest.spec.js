const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Constants mirrored from game.js for the Node test scope.
const LANES_JS = 16;
const START_LIVES_JS = 3;
const POINTS_PER_ENEMY_JS = 150;
const MAX_BULLETS_JS = 6;

test.describe('Tempest', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tempest', async ({ page }) => {
            await expect(page).toHaveTitle('Tempest');
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

        test('lives start at 3', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600×600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the well has 16 lanes', async ({ page }) => {
            expect(await page.evaluate(() => LANES)).toBe(LANES_JS);
        });

        test('the blaster starts on lane 0', async ({ page }) => {
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('no enemies or bullets at the start', async ({ page }) => {
            const empty = await page.evaluate(() => enemies.length === 0 && bullets.length === 0);
            expect(empty).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Geometry
    // -----------------------------------------------------------------------
    test.describe('geometry', () => {
        test('depth 1 lies on the outer rim and depth 0 at the inner ring', async ({ page }) => {
            const res = await page.evaluate(() => {
                const c = { x: WIDTH / 2, y: HEIGHT / 2 };
                const outer = lanePoint(0, 1);
                const inner = lanePoint(0, 0);
                const dist = p => Math.hypot(p.x - c.x, p.y - c.y);
                return { outer: dist(outer), inner: dist(inner) };
            });
            expect(res.outer).toBeCloseTo(R_OUT_JS, 1);
            expect(res.inner).toBeCloseTo(R_IN_JS, 1);
        });

        test('lane indices wrap around the ring', async ({ page }) => {
            const res = await page.evaluate(() => ({
                below: normalizeLane(-1),
                above: normalizeLane(LANES),
                far: normalizeLane(LANES + 3),
            }));
            expect(res.below).toBe(LANES_JS - 1);
            expect(res.above).toBe(0);
            expect(res.far).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses the overlay and starts', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('an arrow key starts the game from idle', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Blaster movement
    // -----------------------------------------------------------------------
    test.describe('blaster movement', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('movePlayer(1) advances one lane clockwise', async ({ page }) => {
            const lane = await page.evaluate(() => { player.lane = 5; movePlayer(1); return player.lane; });
            expect(lane).toBe(6);
        });

        test('movePlayer(-1) retreats one lane', async ({ page }) => {
            const lane = await page.evaluate(() => { player.lane = 5; movePlayer(-1); return player.lane; });
            expect(lane).toBe(4);
        });

        test('moving past lane 0 wraps to the last lane', async ({ page }) => {
            const lane = await page.evaluate(() => { player.lane = 0; movePlayer(-1); return player.lane; });
            expect(lane).toBe(LANES_JS - 1);
        });

        test('ArrowRight rotates the blaster clockwise', async ({ page }) => {
            await page.evaluate(() => { player.lane = 2; });
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => player.lane)).toBe(3);
        });

        test('ArrowLeft rotates the blaster anticlockwise', async ({ page }) => {
            await page.evaluate(() => { player.lane = 2; });
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('fire() spawns a bullet on the blaster lane at the rim', async ({ page }) => {
            const res = await page.evaluate(() => {
                bullets.length = 0;
                player.lane = 7;
                fire();
                return { count: bullets.length, lane: bullets[0].lane, depth: bullets[0].depth };
            });
            expect(res.count).toBe(1);
            expect(res.lane).toBe(7);
            expect(res.depth).toBeGreaterThan(0.9);
        });

        test('no more than MAX_BULLETS may be in flight', async ({ page }) => {
            const count = await page.evaluate(() => {
                bullets.length = 0;
                for (let i = 0; i < 20; i++) fire();
                return bullets.length;
            });
            expect(count).toBe(MAX_BULLETS_JS);
        });

        test('moveBullets carries bullets inward (depth decreases)', async ({ page }) => {
            const res = await page.evaluate(() => {
                bullets.length = 0;
                enemies.length = 0;
                fire();
                const before = bullets[0].depth;
                moveBullets();
                return { before, after: bullets.length ? bullets[0].depth : 0 };
            });
            expect(res.after).toBeLessThan(res.before);
        });

        test('a bullet is removed once it reaches the centre', async ({ page }) => {
            const count = await page.evaluate(() => {
                bullets.length = 0;
                enemies.length = 0;
                fire();
                bullets[0].depth = 0.01;
                moveBullets();
                return bullets.length;
            });
            expect(count).toBe(0);
        });

        test('Space fires while running', async ({ page }) => {
            const count = await page.evaluate(() => { bullets.length = 0; return bullets.length; });
            expect(count).toBe(0);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('spawnEnemy adds a flipper at the centre by default', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemy(4);
                return { count: enemies.length, lane: enemies[0].lane, depth: enemies[0].depth, atRim: enemies[0].atRim };
            });
            expect(res.count).toBe(1);
            expect(res.lane).toBe(4);
            expect(res.depth).toBe(0);
            expect(res.atRim).toBe(false);
        });

        test('moveEnemies climbs a flipper outward (depth increases)', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.length = 0; bullets.length = 0;
                spawnEnemy(9);
                enemies[0].depth = 0.3;
                player.lane = 0; // keep away
                moveEnemies();
                return enemies.length ? enemies[0].depth : null;
            });
            expect(res).toBeGreaterThan(0.3);
        });

        test('a flipper that reaches the rim latches on', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.length = 0; bullets.length = 0;
                spawnEnemy(8);
                enemies[0].depth = 0.99;
                player.lane = 0; // opposite side, no collision
                moveEnemies();
                return enemies.length ? { atRim: enemies[0].atRim, depth: enemies[0].depth } : null;
            });
            expect(res.atRim).toBe(true);
            expect(res.depth).toBeCloseTo(1, 5);
        });

        test('a rim flipper chases the blaster around the ring', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.length = 0; bullets.length = 0;
                spawnEnemy(8);
                enemies[0].atRim = true; enemies[0].depth = 1;
                player.lane = 12; // shortest way is clockwise (8 -> 9)
                moveEnemies();
                return enemies.length ? enemies[0].lane : null;
            });
            expect(res).toBe(9);
        });
    });

    // -----------------------------------------------------------------------
    // Combat
    // -----------------------------------------------------------------------
    test.describe('combat', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('a bullet destroys a flipper on the same lane', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.length = 0; bullets.length = 0;
                spawnEnemy(3); enemies[0].depth = 0.5;
                bullets.push({ lane: 3, depth: 0.5 });
                const before = score;
                checkBulletHits();
                return { enemies: enemies.length, bullets: bullets.length, gained: score - before };
            });
            expect(res.enemies).toBe(0);
            expect(res.bullets).toBe(0);
            expect(res.gained).toBe(POINTS_PER_ENEMY_JS);
        });

        test('a bullet misses a flipper on a different lane', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.length = 0; bullets.length = 0;
                spawnEnemy(3); enemies[0].depth = 0.5;
                bullets.push({ lane: 5, depth: 0.5 });
                checkBulletHits();
                return { enemies: enemies.length, bullets: bullets.length };
            });
            expect(res.enemies).toBe(1);
            expect(res.bullets).toBe(1);
        });

        test('a bullet that has not yet reached the flipper does not hit', async ({ page }) => {
            const remaining = await page.evaluate(() => {
                enemies.length = 0; bullets.length = 0;
                spawnEnemy(3); enemies[0].depth = 0.3; // flipper is deep in the tube
                bullets.push({ lane: 3, depth: 0.9 });  // bullet still near the rim
                checkBulletHits();
                return enemies.length;
            });
            expect(remaining).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Player hit & lives
    // -----------------------------------------------------------------------
    test.describe('player hit and lives', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('a rim flipper on the blaster lane costs a life', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.length = 0; bullets.length = 0;
                player.lane = 6;
                spawnEnemy(6); enemies[0].atRim = true; enemies[0].depth = 1;
                const before = lives;
                checkPlayerHit();
                return { before, lives };
            });
            expect(res.lives).toBe(res.before - 1);
        });

        test('a rim flipper on a different lane is harmless', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.length = 0; bullets.length = 0;
                player.lane = 6;
                spawnEnemy(1); enemies[0].atRim = true; enemies[0].depth = 1;
                const before = lives;
                checkPlayerHit();
                return { before, lives };
            });
            expect(res.lives).toBe(res.before);
        });

        test('losing a life clears the well', async ({ page }) => {
            const count = await page.evaluate(() => {
                enemies.length = 0; bullets.length = 0;
                spawnEnemy(1); spawnEnemy(2); spawnEnemy(3);
                loseLife();
                return enemies.length;
            });
            expect(count).toBe(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => { lives = 1; loseLife(); return state; });
            expect(s).toBe('over');
        });

        test('game over overlay is shown', async ({ page }) => {
            await page.evaluate(() => { lives = 1; loseLife(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });
    });

    // -----------------------------------------------------------------------
    // Superzapper
    // -----------------------------------------------------------------------
    test.describe('superzapper', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('the superzapper clears every enemy', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemy(1); spawnEnemy(5); spawnEnemy(9);
                const ok = superzap();
                return { ok, count: enemies.length };
            });
            expect(res.ok).toBe(true);
            expect(res.count).toBe(0);
        });

        test('the superzapper only works once per level', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemy(1);
                superzap();          // consume it
                spawnEnemy(2);       // a new enemy appears
                const second = superzap();
                return { second, count: enemies.length };
            });
            expect(res.second).toBe(false);
            expect(res.count).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Level progression
    // -----------------------------------------------------------------------
    test.describe('level progression', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('clearing the well advances to the next level with a bonus', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.length = 0;
                spawnRemaining = 0;      // no more will spawn
                const beforeLevel = level;
                const beforeScore = score;
                maybeAdvanceLevel();     // well is empty and quota done
                return { level, beforeLevel, gained: score - beforeScore };
            });
            expect(res.level).toBe(res.beforeLevel + 1);
            expect(res.gained).toBeGreaterThan(0);
        });

        test('the level does not advance while enemies remain', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.length = 0;
                spawnRemaining = 0;
                spawnEnemy(4);
                const beforeLevel = level;
                maybeAdvanceLevel();
                return { level, beforeLevel };
            });
            expect(res.level).toBe(res.beforeLevel);
        });

        test('advancing a level recharges the superzapper', async ({ page }) => {
            const ready = await page.evaluate(() => {
                superReady = false;
                enemies.length = 0;
                spawnRemaining = 0;
                maybeAdvanceLevel();
                return superReady;
            });
            expect(ready).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Game over / restart / best score
    // -----------------------------------------------------------------------
    test.describe('game over and best score', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('restarting resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => { score = 5000; level = 4; lives = 1; loseLife(); });
            await page.keyboard.press('Space');
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('best score updates on game over if higher', async ({ page }) => {
            await page.evaluate(() => { score = 3000; lives = 1; loseLife(); });
            const best = parseInt(await page.locator('#best').textContent(), 10);
            expect(best).toBeGreaterThanOrEqual(3000);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => { score = 4200; lives = 1; loseLife(); });
            const stored = await page.evaluate(() => localStorage.getItem('tempest-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(4200);
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('P pauses a running game', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('pause overlay shows "Paused"', async ({ page }) => {
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('firing does nothing while paused', async ({ page }) => {
            const res = await page.evaluate(() => {
                bullets.length = 0;
                pauseGame();
                fire();
                return bullets.length;
            });
            expect(res).toBe(0);
        });
    });
});

// Constants mirrored from game.js (injected into the Node scope by Playwright).
const R_OUT_JS = 250;
const R_IN_JS = 45;
