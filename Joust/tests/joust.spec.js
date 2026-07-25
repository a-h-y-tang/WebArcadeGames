const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

async function start(page) {
    await page.keyboard.press('Space');
}

test.describe('Joust', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Joust', async ({ page }) => {
            await expect(page).toHaveTitle('Joust');
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

        test('wave starts at 1', async ({ page }) => {
            await expect(page.locator('#wave')).toHaveText('1');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 700×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '700');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('platforms are defined', async ({ page }) => {
            expect(await page.evaluate(() => platforms.length)).toBeGreaterThan(0);
        });

        test('no enemies before the game starts', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('the player is inside the arena', async ({ page }) => {
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
        test('Space dismisses the overlay', async ({ page }) => {
            await start(page);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('arrow key starts the game', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state is running after start', async ({ page }) => {
            await start(page);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a wave of enemies spawns on start', async ({ page }) => {
            await start(page);
            expect(await page.evaluate(() => enemies.length)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Flight physics
    // -----------------------------------------------------------------------
    test.describe('flight physics', () => {
        test('flapping pushes the mount upward', async ({ page }) => {
            await start(page);
            const vy = await page.evaluate(() => {
                player.vy = 0;
                flap();
                return player.vy;
            });
            expect(vy).toBeLessThan(0);
        });

        test('gravity pulls the mount down over time', async ({ page }) => {
            await start(page);
            const grew = await page.evaluate(() => {
                enemies.length = 0;
                player.x = 350;
                player.y = 150;
                player.vx = 0;
                player.vy = 0;
                player.onGround = false;
                const before = player.vy;
                step(30);
                return player.vy > before;
            });
            expect(grew).toBe(true);
        });

        test('ArrowRight moves the mount right', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { enemies.length = 0; });
            const startX = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowRight');
            const endX = await page.evaluate(() => player.x);
            expect(endX).toBeGreaterThan(startX);
        });

        test('the mount wraps around the right edge', async ({ page }) => {
            await start(page);
            const x = await page.evaluate(() => {
                enemies.length = 0;
                player.x = WIDTH + 5;
                player.y = 150;
                player.vx = 0.1;
                player.vy = 0;
                step(16);
                return player.x;
            });
            expect(x).toBeLessThan(0);
        });

        test('the mount wraps around the left edge', async ({ page }) => {
            await start(page);
            const x = await page.evaluate(() => {
                enemies.length = 0;
                player.x = -player.w - 5;
                player.y = 150;
                player.vx = -0.1;
                player.vy = 0;
                step(16);
                return player.x;
            });
            expect(x).toBeGreaterThan(350); // WIDTH / 2 — wrapped to the right side
        });

        test('a falling mount lands on a platform', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                enemies.length = 0;
                const p = platforms[0];
                player.x = p.x + p.w / 2 - player.w / 2;
                player.y = p.y - player.h - 3;
                player.vx = 0;
                player.vy = 0.2; // falling
                player.onGround = false;
                step(50);
                return { onGround: player.onGround, vy: player.vy, restY: player.y, top: p.y - player.h };
            });
            expect(r.onGround).toBe(true);
            expect(r.vy).toBe(0);
            expect(r.restY).toBeCloseTo(r.top, 1);
        });
    });

    // -----------------------------------------------------------------------
    // Lava
    // -----------------------------------------------------------------------
    test.describe('lava', () => {
        test('touching the lava costs a life and respawns', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                enemies.length = 0;
                lives = 3;
                player.y = LAVA_Y;
                step(1);
                return { lives, belowLava: player.y + player.h >= LAVA_Y, state };
            });
            expect(r.lives).toBe(2);
            expect(r.belowLava).toBe(false);
            expect(r.state).toBe('running');
        });

        test('touching the lava with one life left ends the game', async ({ page }) => {
            await start(page);
            const s = await page.evaluate(() => {
                enemies.length = 0;
                lives = 1;
                player.y = LAVA_Y;
                step(1);
                return state;
            });
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // The joust (combat)
    // -----------------------------------------------------------------------
    test.describe('combat', () => {
        test('combatOutcome reports win / lose / bounce by height', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                const mk = (y) => ({ x: player.x, y, w: player.w, h: player.h });
                player.y = 200;
                return {
                    win: combatOutcome(mk(200 + player.h)),   // enemy well below -> win
                    lose: combatOutcome(mk(200 - player.h)),  // enemy well above -> lose
                    bounce: combatOutcome(mk(200)),           // same height -> bounce
                };
            });
            expect(r).toEqual({ win: 'win', lose: 'lose', bounce: 'bounce' });
        });

        test('jousting from above defeats the enemy, drops an egg and scores', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                enemies.length = 0;
                eggs.length = 0;
                player.x = 300;
                player.y = 200;
                enemies.push(makeEnemy(300, 214)); // slightly below -> player is higher
                const before = score;
                resolveCombat();
                return { enemies: enemies.length, eggs: eggs.length, gained: score - before };
            });
            expect(r.enemies).toBe(0);
            expect(r.eggs).toBe(1);
            expect(r.gained).toBe(await page.evaluate(() => ENEMY_POINTS));
        });

        test('jousting from below costs a life', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                enemies.length = 0;
                player.x = 300;
                player.y = 220;
                enemies.push(makeEnemy(300, 200)); // enemy above -> player loses
                const before = lives;
                resolveCombat();
                return { before, after: lives };
            });
            expect(r.after).toBe(r.before - 1);
        });

        test('an equal-height collision bounces both riders without a defeat', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                enemies.length = 0;
                player.x = 300;
                player.y = 200;
                player.vx = 0;
                enemies.push(makeEnemy(312, 200)); // same height -> bounce
                const beforeLives = lives;
                resolveCombat();
                return { enemies: enemies.length, lives, beforeLives, pushed: player.vx !== 0 };
            });
            expect(r.enemies).toBe(1);
            expect(r.lives).toBe(r.beforeLives);
            expect(r.pushed).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Eggs
    // -----------------------------------------------------------------------
    test.describe('eggs', () => {
        test('touching an egg collects it for points', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                enemies.length = 0;
                eggs.length = 0;
                player.x = 300;
                player.y = 200;
                eggs.push({ x: 300, y: 205, vx: 0, vy: 0, w: 22, h: 24, landed: false, hatchT: 0 });
                const before = score;
                step(1);
                return { eggs: eggs.length, gained: score - before };
            });
            expect(r.eggs).toBe(0);
            expect(r.gained).toBe(await page.evaluate(() => EGG_POINTS));
        });

        test('an un-collected egg hatches into a new enemy', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                enemies.length = 0;
                eggs.length = 0;
                player.x = 600; // keep the player away from the egg
                player.y = 150;
                eggs.push({ x: 100, y: 380, vx: 0, vy: 0, w: 22, h: 24, landed: true, hatchT: HATCH_TIME });
                step(1);
                return { eggs: eggs.length, enemies: enemies.length };
            });
            expect(r.eggs).toBe(0);
            expect(r.enemies).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('clearing all enemies and eggs advances to the next wave', async ({ page }) => {
            await start(page);
            const r = await page.evaluate(() => {
                enemies.length = 0;
                eggs.length = 0;
                const beforeWave = wave;
                step(1);
                return { beforeWave, wave, enemies: enemies.length };
            });
            expect(r.wave).toBe(r.beforeWave + 1);
            expect(r.enemies).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await start(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('pause overlay shows "Paused"', async ({ page }) => {
            await start(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await start(page);
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the world does not advance while paused', async ({ page }) => {
            await start(page);
            await page.keyboard.press('p');
            const r = await page.evaluate(() => {
                player.x = 350;
                player.y = 150;
                player.vy = 0.3;
                const before = { x: player.x, y: player.y };
                step(500);
                return { before, after: { x: player.x, y: player.y } };
            });
            expect(r.after).toEqual(r.before);
        });

        test('flapping is ignored while paused', async ({ page }) => {
            await start(page);
            await page.keyboard.press('p');
            const vy = await page.evaluate(() => {
                player.vy = 0;
                flap();
                return player.vy;
            });
            expect(vy).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Game over & restart
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('game over overlay is shown with a title and replay button', async ({ page }) => {
            await start(page);
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets score, lives and wave', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                score = 5000;
                lives = 1;
                wave = 4;
                endGame();
            });
            await start(page);
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#wave')).toHaveText('1');
        });

        test('best score updates on game over if higher', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                score = 3200;
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent(), 10);
            expect(best).toBeGreaterThanOrEqual(3200);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                score = 4444;
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('joust-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(4444);
        });
    });
});
