const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Defender', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Defender', async ({ page }) => {
            await expect(page).toHaveTitle('Defender');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/enter|start/i);
        });

        test('score, wave and best show their starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#wave')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 800x460', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '800');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no enemies or bullets before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({ e: enemies.length, b: bullets.length }));
            expect(counts).toEqual({ e: 0, b: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('defender-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a new game has full lives, bombs and score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { lives, smartBombs, score, wave, planetDead };
            });
            expect(s).toEqual({
                lives: 3, smartBombs: 3, score: 0, wave: 1, planetDead: false,
            });
        });

        test('a new game populates the planet with humanoids', async ({ page }) => {
            const h = await page.evaluate(() => {
                startGame();
                return { count: humanoids.length, expected: HUMANOID_COUNT, alive: humanoidsAlive() };
            });
            expect(h.count).toBe(h.expected);
            expect(h.alive).toBe(h.expected);
        });

        test('humanoids start on the ground line', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return humanoids.every((h) => h.state === 'ground' && Math.abs(h.y - GROUND_Y) < 2);
            });
            expect(ok).toBe(true);
        });

        test('a new game spawns the first wave of landers', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { enemies: enemies.length, expected: landersForWave(1) };
            });
            expect(s.enemies).toBe(s.expected);
            expect(s.enemies).toBeGreaterThan(0);
        });

        test('every spawned enemy sits inside the world', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return enemies.every((e) => e.x >= 0 && e.x < WORLD_W && e.y >= 0 && e.y < GROUND_Y);
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // World wrapping helpers
    // -----------------------------------------------------------------------
    test.describe('world wrapping', () => {
        test('wrapX folds coordinates into the world', async ({ page }) => {
            const r = await page.evaluate(() => ({
                over: wrapX(WORLD_W + 10),
                under: wrapX(-10),
                inside: wrapX(100),
                exact: wrapX(WORLD_W),
                world: WORLD_W,
            }));
            expect(r.over).toBe(10);
            expect(r.under).toBe(r.world - 10);
            expect(r.inside).toBe(100);
            expect(r.exact).toBe(0);
        });

        test('worldDx takes the short way round the seam', async ({ page }) => {
            const r = await page.evaluate(() => ({
                fwd: worldDx(100, 300),
                back: worldDx(300, 100),
                seam: worldDx(WORLD_W - 20, 30),
                seamBack: worldDx(30, WORLD_W - 20),
            }));
            expect(r.fwd).toBe(200);
            expect(r.back).toBe(-200);
            expect(r.seam).toBe(50);
            expect(r.seamBack).toBe(-50);
        });

        test('the ship wraps around the world edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                player.x = WORLD_W - 5;
                player.vx = 600;
                for (let i = 0; i < 20; i++) step(0.016);
                return player.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(200);
        });
    });

    // -----------------------------------------------------------------------
    // Flying
    // -----------------------------------------------------------------------
    test.describe('flight', () => {
        test('thrusting right builds rightward velocity', async ({ page }) => {
            const vx = await page.evaluate(() => {
                startGame();
                setThrust(1);
                for (let i = 0; i < 20; i++) step(0.016);
                return player.vx;
            });
            expect(vx).toBeGreaterThan(0);
        });

        test('thrusting left builds leftward velocity and flips the ship', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setThrust(-1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { vx: player.vx, dir: player.dir };
            });
            expect(r.vx).toBeLessThan(0);
            expect(r.dir).toBe(-1);
        });

        test('speed is capped', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setThrust(1);
                for (let i = 0; i < 600; i++) step(0.016);
                return { vx: player.vx, max: MAX_SPEED };
            });
            expect(r.vx).toBeLessThanOrEqual(r.max + 0.01);
        });

        test('releasing thrust lets the ship coast to a stop', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setThrust(1);
                for (let i = 0; i < 40; i++) step(0.016);
                const moving = player.vx;
                setThrust(0);
                for (let i = 0; i < 200; i++) step(0.016);
                return { moving, coasted: player.vx };
            });
            expect(r.moving).toBeGreaterThan(0);
            expect(r.coasted).toBeLessThan(r.moving);
            expect(Math.abs(r.coasted)).toBeLessThan(20);
        });

        test('climbing decreases y, diving increases it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                player.y = 200;
                setVertical(-1);
                for (let i = 0; i < 10; i++) step(0.016);
                const up = player.y;
                setVertical(1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { up, down: player.y };
            });
            expect(r.up).toBeLessThan(200);
            expect(r.down).toBeGreaterThan(r.up);
        });

        test('the ship cannot fly above the sky ceiling', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setVertical(-1);
                for (let i = 0; i < 400; i++) step(0.016);
                return { y: player.y, ceiling: SKY_Y };
            });
            expect(r.y).toBeGreaterThanOrEqual(r.ceiling);
        });

        test('the ship cannot fly below the ground', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                setVertical(1);
                for (let i = 0; i < 400; i++) step(0.016);
                return { y: player.y, ground: GROUND_Y };
            });
            expect(r.y).toBeLessThanOrEqual(r.ground);
        });

        test('the camera follows the ship', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                player.x = 1500;
                for (let i = 0; i < 200; i++) step(0.016);
                return { offset: worldDx(camera.x, player.x), view: VIEW_W };
            });
            expect(r.offset).toBeGreaterThan(0);
            expect(r.offset).toBeLessThan(r.view);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('firing spawns a player bullet travelling the way the ship faces', async ({ page }) => {
            const b = await page.evaluate(() => {
                startGame();
                bullets.length = 0;
                player.dir = 1;
                fire();
                return { n: bullets.length, vx: bullets[0].vx, from: bullets[0].from };
            });
            expect(b.n).toBe(1);
            expect(b.vx).toBeGreaterThan(0);
            expect(b.from).toBe('player');
        });

        test('facing left fires left', async ({ page }) => {
            const vx = await page.evaluate(() => {
                startGame();
                bullets.length = 0;
                player.dir = -1;
                fire();
                return bullets[0].vx;
            });
            expect(vx).toBeLessThan(0);
        });

        test('firing has a cooldown', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                bullets.length = 0;
                fire();
                fire();
                fire();
                return bullets.length;
            });
            expect(n).toBe(1);
        });

        test('the cooldown expires so the ship can fire again', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                bullets.length = 0;
                fire();
                for (let i = 0; i < 30; i++) step(0.016);
                fire();
                return bullets.length;
            });
            expect(n).toBeGreaterThanOrEqual(2);
        });

        test('bullets expire instead of orbiting the planet forever', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                bullets.length = 0;
                fire();
                for (let i = 0; i < 300; i++) step(0.016);
                return bullets.filter((b) => b.from === 'player').length;
            });
            expect(n).toBe(0);
        });

        test('Space fires from the keyboard', async ({ page }) => {
            await page.evaluate(() => { startGame(); bullets.length = 0; });
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => bullets.filter((b) => b.from === 'player').length);
            expect(n).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Killing enemies
    // -----------------------------------------------------------------------
    test.describe('combat', () => {
        test('a player bullet destroys a lander and scores', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                bullets.length = 0;
                score = 0;
                const lander = spawnLander({ x: 500, y: 200 });
                spawnBullet({ x: 495, y: 200, vx: 600, vy: 0, from: 'player' });
                for (let i = 0; i < 5; i++) step(0.016);
                return { enemies: enemies.length, score, dead: !enemies.includes(lander) };
            });
            expect(r.enemies).toBe(0);
            expect(r.dead).toBe(true);
            expect(r.score).toBe(150);
        });

        test('a player bullet destroys a mutant and scores', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                bullets.length = 0;
                score = 0;
                spawnMutant({ x: 500, y: 200 });
                spawnBullet({ x: 495, y: 200, vx: 600, vy: 0, from: 'player' });
                for (let i = 0; i < 5; i++) step(0.016);
                return { enemies: enemies.length, score };
            });
            expect(r.enemies).toBe(0);
            expect(r.score).toBe(150);
        });

        test('a player bullet that misses leaves the enemy alone', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                bullets.length = 0;
                spawnLander({ x: 500, y: 50 });
                spawnBullet({ x: 495, y: 300, vx: 600, vy: 0, from: 'player' });
                for (let i = 0; i < 5; i++) step(0.016);
                return enemies.length;
            });
            expect(n).toBe(1);
        });

        test('enemy bullets do not harm other enemies', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                bullets.length = 0;
                spawnLander({ x: 500, y: 200 });
                spawnBullet({ x: 495, y: 200, vx: 600, vy: 0, from: 'enemy' });
                for (let i = 0; i < 5; i++) step(0.016);
                return enemies.length;
            });
            expect(n).toBe(1);
        });

        test('an enemy bullet costs the player a life', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                bullets.length = 0;
                player.invuln = 0;
                player.x = 400;
                player.y = 200;
                spawnBullet({ x: 395, y: 200, vx: 400, vy: 0, from: 'enemy' });
                for (let i = 0; i < 5; i++) step(0.016);
                return { lives, invuln: player.invuln };
            });
            expect(r.lives).toBe(2);
            expect(r.invuln).toBeGreaterThan(0);
        });

        test('an invulnerable ship shrugs off enemy fire', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                bullets.length = 0;
                player.invuln = 2;
                player.x = 400;
                player.y = 200;
                spawnBullet({ x: 395, y: 200, vx: 400, vy: 0, from: 'enemy' });
                for (let i = 0; i < 5; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(3);
        });

        test('colliding with an enemy costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                bullets.length = 0;
                player.invuln = 0;
                player.x = 400;
                player.y = 200;
                spawnMutant({ x: 402, y: 200 });
                step(0.016);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                lives = 1;
                killPlayer();
                return { state, lives };
            });
            expect(r.state).toBe('over');
            expect(r.lives).toBe(0);
        });

        test('dying clears enemy bullets so the respawn is fair', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                bullets.length = 0;
                spawnBullet({ x: 100, y: 100, vx: 10, vy: 0, from: 'enemy' });
                spawnBullet({ x: 200, y: 100, vx: 10, vy: 0, from: 'enemy' });
                killPlayer();
                return bullets.length;
            });
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Smart bombs
    // -----------------------------------------------------------------------
    test.describe('smart bombs', () => {
        test('a smart bomb clears on-screen enemies and scores them', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 0;
                player.x = 400;
                camera.x = 0;
                spawnLander({ x: 200, y: 100 });
                spawnLander({ x: 600, y: 150 });
                smartBomb();
                return { enemies: enemies.length, score, bombs: smartBombs };
            });
            expect(r.enemies).toBe(0);
            expect(r.score).toBe(300);
            expect(r.bombs).toBe(2);
        });

        test('a smart bomb spares enemies on the far side of the world', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                camera.x = 0;
                spawnLander({ x: 1800, y: 100 });
                smartBomb();
                return enemies.length;
            });
            expect(n).toBe(1);
        });

        test('smart bombs run out', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                smartBombs = 1;
                smartBomb();
                smartBomb();
                smartBomb();
                return smartBombs;
            });
            expect(r).toBe(0);
        });

        test('B triggers a smart bomb', async ({ page }) => {
            await page.evaluate(() => { startGame(); smartBombs = 3; });
            await page.keyboard.press('b');
            expect(await page.evaluate(() => smartBombs)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Humanoids, abduction and rescue
    // -----------------------------------------------------------------------
    test.describe('humanoids', () => {
        test('a lander descends toward a humanoid', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                humanoids.length = 0;
                const h = spawnHumanoid({ x: 800 });
                const lander = spawnLander({ x: 800, y: 60 });
                const before = lander.y;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: lander.y };
            });
            expect(r.after).toBeGreaterThan(r.before);
        });

        test('a lander grabs a humanoid it reaches', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                humanoids.length = 0;
                const h = spawnHumanoid({ x: 800 });
                const lander = spawnLander({ x: 800, y: GROUND_Y - 40 });
                for (let i = 0; i < 120; i++) step(0.016);
                return { state: h.state, carrying: lander.carrying === h };
            });
            expect(r.state).toBe('carried');
            expect(r.carrying).toBe(true);
        });

        test('a carried humanoid rides up with the lander', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                humanoids.length = 0;
                const h = spawnHumanoid({ x: 800 });
                const lander = spawnLander({ x: 800, y: 200, carrying: h });
                const before = lander.y;
                for (let i = 0; i < 30; i++) step(0.016);
                return { rose: lander.y < before, together: Math.abs(h.y - lander.y) < 40 };
            });
            expect(r.rose).toBe(true);
            expect(r.together).toBe(true);
        });

        test('a lander that reaches the top becomes a mutant', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                humanoids.length = 0;
                const h = spawnHumanoid({ x: 800 });
                spawnLander({ x: 800, y: 30, carrying: h });
                for (let i = 0; i < 200; i++) step(0.016);
                return { types: enemies.map((e) => e.type), alive: humanoidsAlive() };
            });
            expect(r.types).toContain('mutant');
            expect(r.types).not.toContain('lander');
            expect(r.alive).toBe(0);
        });

        test('shooting a carrying lander drops the humanoid', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                humanoids.length = 0;
                bullets.length = 0;
                const h = spawnHumanoid({ x: 800 });
                spawnLander({ x: 800, y: 150, carrying: h });
                spawnBullet({ x: 795, y: 150, vx: 600, vy: 0, from: 'player' });
                for (let i = 0; i < 5; i++) step(0.016);
                return { enemies: enemies.length, state: h.state };
            });
            expect(r.enemies).toBe(0);
            expect(r.state).toBe('falling');
        });

        test('a humanoid dropped from high up dies on impact', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                humanoids.length = 0;
                enemies.length = 0;
                const h = spawnHumanoid({ x: 800 });
                h.state = 'falling';
                h.y = 60;
                h.fallFrom = 60;
                for (let i = 0; i < 400; i++) step(0.016);
                return { state: h.state, alive: humanoidsAlive() };
            });
            expect(r.state).toBe('dead');
            expect(r.alive).toBe(0);
        });

        test('a humanoid dropped from just above the ground survives', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                humanoids.length = 0;
                enemies.length = 0;
                const h = spawnHumanoid({ x: 800 });
                h.state = 'falling';
                h.y = GROUND_Y - 40;
                h.fallFrom = GROUND_Y - 40;
                for (let i = 0; i < 200; i++) step(0.016);
                return h.state;
            });
            expect(r).toBe('ground');
        });

        test('flying into a falling humanoid catches it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                humanoids.length = 0;
                enemies.length = 0;
                const h = spawnHumanoid({ x: 800 });
                h.state = 'falling';
                h.y = 150;
                h.fallFrom = 150;
                player.x = 800;
                player.y = 155;
                step(0.016);
                return h.state;
            });
            expect(r).toBe('held');
        });

        test('a held humanoid rides along with the ship', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                humanoids.length = 0;
                enemies.length = 0;
                const h = spawnHumanoid({ x: 800 });
                h.state = 'held';
                player.x = 800;
                player.y = 150;
                player.vx = 0;
                setThrust(1);
                for (let i = 0; i < 30; i++) step(0.016);
                return Math.abs(worldDx(h.x, player.x));
            });
            expect(r).toBeLessThan(12);
        });

        test('landing a held humanoid returns it to the ground for 500 points', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                humanoids.length = 0;
                enemies.length = 0;
                score = 0;
                const h = spawnHumanoid({ x: 800 });
                h.state = 'held';
                player.x = 800;
                player.y = 200;
                setVertical(1);
                // Long enough to fly down and set the humanoid on the ground,
                // short enough that the empty sky has not yet ended the wave.
                for (let i = 0; i < 100; i++) step(0.016);
                return { state: h.state, score, y: h.y };
            });
            expect(r.state).toBe('ground');
            expect(r.score).toBe(500);
            expect(Math.abs(r.y - 360)).toBeLessThan(3);
        });

        test('grounded humanoids wander but stay on the ground', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ys = new Set();
                for (let i = 0; i < 300; i++) step(0.016);
                humanoids.forEach((h) => ys.add(Math.round(h.y)));
                return { ys: [...ys], ground: GROUND_Y };
            });
            expect(r.ys).toEqual([r.ground]);
        });
    });

    // -----------------------------------------------------------------------
    // Planet death
    // -----------------------------------------------------------------------
    test.describe('planet death', () => {
        test('losing the last humanoid kills the planet', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                humanoids.forEach((h) => { h.state = 'dead'; });
                humanoids[0].state = 'falling';
                humanoids[0].y = 60;
                humanoids[0].fallFrom = 60;
                for (let i = 0; i < 400; i++) step(0.016);
                return { planetDead, alive: humanoidsAlive() };
            });
            expect(r.alive).toBe(0);
            expect(r.planetDead).toBe(true);
        });

        test('planet death mutates every remaining lander', async ({ page }) => {
            const types = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                spawnLander({ x: 300, y: 100 });
                spawnLander({ x: 900, y: 120 });
                humanoids.forEach((h) => { h.state = 'dead'; });
                humanoids[0].state = 'falling';
                humanoids[0].y = 60;
                humanoids[0].fallFrom = 60;
                for (let i = 0; i < 400; i++) step(0.016);
                return enemies.map((e) => e.type);
            });
            expect(types.length).toBeGreaterThan(0);
            expect(types.every((t) => t === 'mutant')).toBe(true);
        });

        test('the next wave restocks the planet', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                humanoids.forEach((h) => { h.state = 'dead'; });
                planetDead = true;
                nextWave();
                return { alive: humanoidsAlive(), planetDead, wave };
            });
            expect(r.alive).toBe(10);
            expect(r.planetDead).toBe(false);
            expect(r.wave).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('later waves send more landers, up to a cap', async ({ page }) => {
            const r = await page.evaluate(() => ({
                w1: landersForWave(1),
                w2: landersForWave(2),
                w20: landersForWave(20),
            }));
            expect(r.w2).toBeGreaterThan(r.w1);
            expect(r.w20).toBeLessThanOrEqual(15);
        });

        test('clearing every enemy advances the wave', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                for (let i = 0; i < 200; i++) step(0.016);
                return { wave, enemies: enemies.length, expected: landersForWave(2) };
            });
            expect(r.wave).toBe(2);
            expect(r.enemies).toBe(r.expected);
        });

        test('clearing a wave pays a bonus for surviving humanoids', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                score = 0;
                nextWave();
                return score;
            });
            expect(r).toBe(100 * 2 * 10);
        });

        test('clearing a wave grants a smart bomb up to the cap', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                smartBombs = 3;
                nextWave();
                const after = smartBombs;
                smartBombs = MAX_SMART_BOMBS;
                nextWave();
                return { after, capped: smartBombs, cap: MAX_SMART_BOMBS };
            });
            expect(r.after).toBe(4);
            expect(r.capped).toBe(r.cap);
        });
    });

    // -----------------------------------------------------------------------
    // Scanner
    // -----------------------------------------------------------------------
    test.describe('scanner', () => {
        test('scannerX maps world coordinates into the strip', async ({ page }) => {
            const r = await page.evaluate(() => {
                camera.x = 0;
                return { left: scannerX(0), mid: scannerX(WORLD_W / 2), width: VIEW_W };
            });
            expect(r.left).toBeGreaterThanOrEqual(0);
            expect(r.left).toBeLessThanOrEqual(r.width);
            expect(r.mid).toBeGreaterThanOrEqual(0);
            expect(r.mid).toBeLessThanOrEqual(r.width);
        });

        test('isOnScreen is true near the camera and false far away', async ({ page }) => {
            const r = await page.evaluate(() => {
                camera.x = 0;
                return { near: isOnScreen(100), far: isOnScreen(1800) };
            });
            expect(r.near).toBe(true);
            expect(r.far).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, game over, restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the world', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const lander = spawnLander({ x: 800, y: 100 });
                togglePause();
                const before = { x: lander.x, y: lander.y };
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: { x: lander.x, y: lander.y }, state };
            });
            expect(r.state).toBe('paused');
            expect(r.after).toEqual(r.before);
        });

        test('resuming unfreezes the world', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                player.x = 500;
                player.vx = 200;
                togglePause();
                togglePause();
                const before = player.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return player.x !== before;
            });
            expect(moved).toBe(true);
        });

        test('P toggles pause', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 7350;
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('7350');
            const stored = await page.evaluate(() => localStorage.getItem('defender-best'));
            expect(parseInt(stored, 10)).toBe(7350);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('defender-best', '99000'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 10; endGame(); });
            await expect(page.locator('#best')).toHaveText('99000');
        });

        test('restarting resets score, wave, lives, bombs and the planet', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 5000;
                wave = 7;
                lives = 1;
                smartBombs = 0;
                planetDead = true;
                humanoids.forEach((h) => { h.state = 'dead'; });
                endGame();
                startGame();
                return { score, wave, lives, smartBombs, planetDead, alive: humanoidsAlive(), state };
            });
            expect(r).toEqual({
                score: 0, wave: 1, lives: 3, smartBombs: 3,
                planetDead: false, alive: 10, state: 'running',
            });
        });

        test('the HUD reflects the live game state', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                wave = 4;
                lives = 2;
                smartBombs = 5;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('1234');
            await expect(page.locator('#wave')).toHaveText('4');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#bombs')).toHaveText('5');
            await expect(page.locator('#humans')).toHaveText('10');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering smoke test
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas actually draws something', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 10; i++) step(0.016);
                draw();
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] > 40 || data[i + 1] > 40 || data[i + 2] > 40) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('a long simulated run stays stable', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            const r = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 2000; i++) {
                    step(0.016);
                    if (i % 20 === 0) fire();
                }
                return {
                    finite: enemies.every((e) => Number.isFinite(e.x) && Number.isFinite(e.y))
                        && Number.isFinite(player.x) && Number.isFinite(player.y),
                    inWorld: enemies.every((e) => e.x >= 0 && e.x < WORLD_W),
                    state,
                };
            });
            expect(errors).toEqual([]);
            expect(r.finite).toBe(true);
            expect(r.inWorld).toBe(true);
        });
    });
});
