const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt). The
// requestAnimationFrame loop is switched off in beforeEach (autoStep = false),
// so these are the only calls to step() that happen during a spec.
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so every press is confirmed against the game state before the simulation
// is advanced.
const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction((k) => heldKeys.has(k), key);
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction((k) => !heldKeys.has(k), key);
};

// Start a run with nothing random happening: no wave landers, no baiters, no
// enemy fire, and wave-completion switched off so an empty field does not end
// the wave mid-spec. Specs opt back into whichever piece they are about.
const startEmpty = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
        enemyFireEnabled = false;
        waveActive = false;
        enemies.length = 0;
        enemyBullets.length = 0;
    });

test.describe('Planet Defender', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(() => {
            autoStep = false;
            setSeed(12345);
        });
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Planet Defender', async ({ page }) => {
            await expect(page).toHaveTitle('Planet Defender');
        });

        test('canvas is 800x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '800');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, wave, lives and bombs', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#wave')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#bombs')).toHaveText('3');
        });

        test('the planet starts with ten humanoids on the ground', async ({ page }) => {
            const humans = await page.evaluate(() =>
                humanoids.map((h) => ({ state: h.state, dy: Math.abs(h.y - GROUND_Y) }))
            );
            expect(humans).toHaveLength(10);
            expect(humans.every((h) => h.state === 'ground')).toBe(true);
            expect(humans.every((h) => h.dy < 20)).toBe(true);
        });

        test('humanoids are spread around the planet, not stacked', async ({ page }) => {
            const xs = await page.evaluate(() => humanoids.map((h) => h.x));
            expect(new Set(xs.map(Math.round)).size).toBe(10);
            expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(500);
        });

        test('nothing moves before the game starts', async ({ page }) => {
            const before = await page.evaluate(() => ({ x: ship.x, y: ship.y }));
            await advance(page, 60);
            const after = await page.evaluate(() => ({ x: ship.x, y: ship.y }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh wave spawns landers around the planet', async ({ page }) => {
            await page.evaluate(() => startGame());
            const landers = await page.evaluate(() =>
                enemies.filter((e) => e.type === 'lander').length
            );
            expect(landers).toBe(5); // min(4 + wave, 12) with wave === 1
        });

        test('wave landers start in the upper part of the play area', async ({ page }) => {
            await page.evaluate(() => startGame());
            const ys = await page.evaluate(() =>
                enemies.filter((e) => e.type === 'lander').map((e) => e.y)
            );
            const bounds = await page.evaluate(() => ({ top: VIEW_TOP, ground: GROUND_Y }));
            expect(ys.every((y) => y > bounds.top && y < bounds.ground * 0.75)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Ship movement
    // -----------------------------------------------------------------------
    test.describe('ship', () => {
        test('thrusting right builds rightward velocity and faces right', async ({ page }) => {
            await startEmpty(page);
            await hold(page, 'ArrowRight');
            await advance(page, 20);
            const s = await page.evaluate(() => ({ vx: ship.vx, facing: ship.facing }));
            await release(page, 'ArrowRight');
            expect(s.vx).toBeGreaterThan(50);
            expect(s.facing).toBe(1);
        });

        test('thrusting left builds leftward velocity and faces left', async ({ page }) => {
            await startEmpty(page);
            await hold(page, 'ArrowLeft');
            await advance(page, 20);
            const s = await page.evaluate(() => ({ vx: ship.vx, facing: ship.facing }));
            await release(page, 'ArrowLeft');
            expect(s.vx).toBeLessThan(-50);
            expect(s.facing).toBe(-1);
        });

        test('A and D thrust like the arrow keys', async ({ page }) => {
            await startEmpty(page);
            await hold(page, 'd');
            await advance(page, 20);
            const right = await page.evaluate(() => ship.vx);
            await release(page, 'd');
            expect(right).toBeGreaterThan(50);

            await hold(page, 'a');
            await advance(page, 60);
            const left = await page.evaluate(() => ship.vx);
            await release(page, 'a');
            expect(left).toBeLessThan(0);
        });

        test('the ship coasts and slows when thrust is released', async ({ page }) => {
            await startEmpty(page);
            await hold(page, 'ArrowRight');
            await advance(page, 30);
            await release(page, 'ArrowRight');
            const moving = await page.evaluate(() => ship.vx);
            await advance(page, 10);
            const coasting = await page.evaluate(() => ship.vx);
            expect(coasting).toBeGreaterThan(0);
            expect(coasting).toBeLessThan(moving);
        });

        test('horizontal speed is capped', async ({ page }) => {
            await startEmpty(page);
            await hold(page, 'ArrowRight');
            await advance(page, 600);
            const s = await page.evaluate(() => ({ vx: ship.vx, cap: MAX_VX }));
            await release(page, 'ArrowRight');
            expect(s.vx).toBeLessThanOrEqual(s.cap + 0.001);
        });

        test('up and down thrust move the ship vertically', async ({ page }) => {
            await startEmpty(page);
            const y0 = await page.evaluate(() => ship.y);
            await hold(page, 'ArrowUp');
            await advance(page, 30);
            await release(page, 'ArrowUp');
            const up = await page.evaluate(() => ship.y);
            expect(up).toBeLessThan(y0);

            await hold(page, 'ArrowDown');
            await advance(page, 60);
            await release(page, 'ArrowDown');
            expect(await page.evaluate(() => ship.y)).toBeGreaterThan(up);
        });

        test('the ship is clamped inside the play area', async ({ page }) => {
            await startEmpty(page);
            await hold(page, 'ArrowUp');
            await advance(page, 400);
            await release(page, 'ArrowUp');
            const top = await page.evaluate(() => ({ y: ship.y, min: SHIP_MIN_Y }));
            expect(top.y).toBeGreaterThanOrEqual(top.min - 0.001);

            await hold(page, 'ArrowDown');
            await advance(page, 600);
            await release(page, 'ArrowDown');
            const bottom = await page.evaluate(() => ({ y: ship.y, max: SHIP_MAX_Y }));
            expect(bottom.y).toBeLessThanOrEqual(bottom.max + 0.001);
        });

        test('the ship wraps around the planet', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                ship.x = WORLD_W - 10;
                ship.vx = 400;
            });
            await advance(page, 10);
            const x = await page.evaluate(() => ship.x);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(200);
        });

        test('wrapDX returns the shortest signed distance', async ({ page }) => {
            const d = await page.evaluate(() => ({
                across: wrapDX(WORLD_W - 20, 20),
                back: wrapDX(20, WORLD_W - 20),
                near: wrapDX(100, 160),
            }));
            expect(d.across).toBeCloseTo(40, 5);
            expect(d.back).toBeCloseTo(-40, 5);
            expect(d.near).toBeCloseTo(60, 5);
        });

        test('worldToScreen maps the ship near the middle of the canvas', async ({ page }) => {
            await startEmpty(page);
            await advance(page, 60);
            const sx = await page.evaluate(() => worldToScreen(ship.x));
            expect(sx).toBeGreaterThan(0);
            expect(sx).toBeLessThan(800);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('laser', () => {
        test('Space fires a bullet in the direction the ship faces', async ({ page }) => {
            await startEmpty(page);
            await page.keyboard.press('Space');
            const b = await page.evaluate(() => bullets.map((x) => ({ vx: x.vx, y: x.y })));
            expect(b).toHaveLength(1);
            expect(b[0].vx).toBeGreaterThan(0);
        });

        test('firing while facing left sends the bullet left', async ({ page }) => {
            await startEmpty(page);
            await hold(page, 'ArrowLeft');
            await advance(page, 5);
            await release(page, 'ArrowLeft');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets[0].vx)).toBeLessThan(0);
        });

        test('there is a cooldown between shots', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => fire());
            await page.evaluate(() => fire());
            expect(await page.evaluate(() => bullets.length)).toBe(1);
            await advance(page, 20);
            await page.evaluate(() => fire());
            expect(await page.evaluate(() => bullets.length)).toBe(2);
        });

        test('bullets travel and then expire', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => fire());
            const x0 = await page.evaluate(() => bullets[0].x);
            await advance(page, 3);
            expect(await page.evaluate(() => bullets[0].x)).toBeGreaterThan(x0);
            await advance(page, 120);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('no bullets are fired while idle', async ({ page }) => {
            await page.evaluate(() => fire());
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('a bullet destroys a lander and scores 150', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                ship.x = 400;
                ship.y = 200;
                ship.vx = 0;
                ship.facing = 1;
                spawnLander(500, 200);
            });
            await page.evaluate(() => fire());
            await advance(page, 30);
            const r = await page.evaluate(() => ({ enemies: enemies.length, score }));
            expect(r.enemies).toBe(0);
            expect(r.score).toBe(150);
        });

        test('a lander descends toward the nearest humanoid', async ({ page }) => {
            await startEmpty(page);
            const start = await page.evaluate(() => {
                humanoids.length = 0;
                humanoids.push(makeHumanoid(1000));
                spawnLander(1200, 150);
                return { x: enemies[0].x, y: enemies[0].y };
            });
            await advance(page, 60);
            const now = await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }));
            expect(now.y).toBeGreaterThan(start.y);
            expect(now.x).toBeLessThan(start.x);
        });

        test('a lander grabs a humanoid and lifts it away', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                humanoids.length = 0;
                humanoids.push(makeHumanoid(1000));
                spawnLander(1000, 300);
            });
            await advance(page, 120);
            const grabbed = await page.evaluate(() => ({
                humanoid: humanoids[0].state,
                lander: enemies[0].state,
                dx: Math.abs(wrapDX(humanoids[0].x, enemies[0].x)),
            }));
            expect(grabbed.humanoid).toBe('carried');
            expect(grabbed.lander).toBe('lift');
            expect(grabbed.dx).toBeLessThan(4);

            const y0 = await page.evaluate(() => enemies[0].y);
            await advance(page, 30);
            const after = await page.evaluate(() => ({ y: enemies[0].y, hy: humanoids[0].y }));
            expect(after.y).toBeLessThan(y0);
            expect(after.hy).toBeGreaterThan(after.y); // humanoid dangles below
        });

        test('a lander that escapes becomes a mutant and the humanoid is lost', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                humanoids.length = 0;
                humanoids.push(makeHumanoid(1000));
                const l = spawnLander(1000, 300);
                l.state = 'lift';
                l.carrying = humanoids[0];
                humanoids[0].state = 'carried';
                humanoids[0].carrier = l;
            });
            await advance(page, 300);
            const r = await page.evaluate(() => ({
                types: enemies.map((e) => e.type),
                humanoids: humanoids.length,
            }));
            expect(r.types).toEqual(['mutant']);
            expect(r.humanoids).toBe(0);
        });

        test('shooting a carrier drops the humanoid', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                humanoids.length = 0;
                humanoids.push(makeHumanoid(1000));
                const l = spawnLander(500, 200);
                l.state = 'lift';
                l.carrying = humanoids[0];
                humanoids[0].state = 'carried';
                humanoids[0].carrier = l;
                humanoids[0].x = 500;
                humanoids[0].y = 220;
                ship.x = 400;
                ship.y = 200;
                ship.vx = 0;
                ship.facing = 1;
            });
            await page.evaluate(() => fire());
            await advance(page, 30);
            const r = await page.evaluate(() => ({
                enemies: enemies.length,
                state: humanoids[0].state,
            }));
            expect(r.enemies).toBe(0);
            expect(r.state).toBe('falling');
        });

        test('a mutant closes in on the ship', async ({ page }) => {
            await startEmpty(page);
            const d0 = await page.evaluate(() => {
                ship.x = 400;
                ship.y = 300;
                spawnMutant(700, 150);
                return Math.hypot(wrapDX(enemies[0].x, ship.x), ship.y - enemies[0].y);
            });
            await advance(page, 60);
            const d1 = await page.evaluate(() =>
                Math.hypot(wrapDX(enemies[0].x, ship.x), ship.y - enemies[0].y)
            );
            expect(d1).toBeLessThan(d0);
        });

        test('enemies do not spawn baiters while spawning is disabled', async ({ page }) => {
            await startEmpty(page);
            await advance(page, 60 * 40);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('a baiter appears once a wave drags on', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemyFireEnabled = false;
                humanoids.length = 0;   // nothing to abduct, so the lander just loiters
                enemies.length = 0;
                enemies.push(makeLander(100, GROUND_Y - 40)); // keeps the wave alive
                ship.x = 1600;
                ship.y = SHIP_MIN_Y;
            });
            // Stop just after the threshold: a baiter homes in fast enough to
            // ram the ship (and vanish with it) within a couple of seconds.
            await advance(page, 60 * (await page.evaluate(() => BAITER_AFTER)) + 30);
            const types = await page.evaluate(() => enemies.map((e) => e.type));
            expect(types).toContain('baiter');
        });
    });

    // -----------------------------------------------------------------------
    // Rescue
    // -----------------------------------------------------------------------
    test.describe('rescue', () => {
        test('flying into a falling humanoid catches it and scores', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                humanoids.length = 0;
                const h = makeHumanoid(600);
                h.state = 'falling';
                h.y = 200;
                h.vy = 0;
                h.releaseY = 200;
                humanoids.push(h);
                ship.x = 600;
                ship.y = 200;
                ship.vx = 0;
                ship.vy = 0;
            });
            await advance(page, 5);
            const r = await page.evaluate(() => ({ state: humanoids[0].state, score }));
            expect(r.state).toBe('held');
            expect(r.score).toBe(500);
        });

        test('a held humanoid follows the ship', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                humanoids.length = 0;
                const h = makeHumanoid(600);
                h.state = 'held';
                humanoids.push(h);
                ship.held = h;
                ship.x = 600;
                ship.y = 200;
            });
            await hold(page, 'ArrowRight');
            await advance(page, 30);
            await release(page, 'ArrowRight');
            const r = await page.evaluate(() => ({
                dx: Math.abs(wrapDX(humanoids[0].x, ship.x)),
                below: humanoids[0].y > ship.y,
            }));
            expect(r.dx).toBeLessThan(4);
            expect(r.below).toBe(true);
        });

        test('carrying a humanoid to the surface sets it down safely', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                humanoids.length = 0;
                const h = makeHumanoid(600);
                h.state = 'held';
                humanoids.push(h);
                ship.held = h;
                ship.x = 600;
                ship.y = 200;
                score = 0;
            });
            await hold(page, 'ArrowDown');
            await advance(page, 240);
            await release(page, 'ArrowDown');
            const r = await page.evaluate(() => ({
                state: humanoids[0].state,
                held: ship.held,
                score,
                y: humanoids[0].y,
            }));
            expect(r.state).toBe('ground');
            expect(r.held).toBe(null);
            expect(r.score).toBe(500);
            expect(Math.abs(r.y - (await page.evaluate(() => GROUND_Y)))).toBeLessThan(20);
        });

        test('a humanoid dropped from high up dies on impact', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                humanoids.length = 0;
                const h = makeHumanoid(600);
                h.state = 'falling';
                h.y = VIEW_TOP + 20;
                h.releaseY = VIEW_TOP + 20;
                h.vy = 0;
                humanoids.push(h);
            });
            await advance(page, 240);
            expect(await page.evaluate(() => humanoids.length)).toBe(0);
        });

        test('a humanoid dropped from just above the ground survives', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                humanoids.length = 0;
                const h = makeHumanoid(600);
                h.state = 'falling';
                h.y = GROUND_Y - 40;
                h.releaseY = GROUND_Y - 40;
                h.vy = 0;
                humanoids.push(h);
            });
            await advance(page, 120);
            const r = await page.evaluate(() => ({ n: humanoids.length, state: humanoids[0]?.state }));
            expect(r.n).toBe(1);
            expect(r.state).toBe('ground');
        });

        test('losing the last humanoid destroys the planet and mutates the landers', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                humanoids.length = 0;
                const h = makeHumanoid(600);
                h.state = 'falling';
                h.y = VIEW_TOP + 20;
                h.releaseY = VIEW_TOP + 20;
                h.vy = 0;
                humanoids.push(h);
                spawnLander(1500, 200);
                spawnLander(2000, 200);
            });
            await advance(page, 240);
            const r = await page.evaluate(() => ({
                destroyed: planetDestroyed,
                types: enemies.map((e) => e.type),
            }));
            expect(r.destroyed).toBe(true);
            expect(r.types).toEqual(['mutant', 'mutant']);
        });
    });

    // -----------------------------------------------------------------------
    // Smart bombs
    // -----------------------------------------------------------------------
    test.describe('smart bomb', () => {
        test('B clears the enemies on screen and spends a bomb', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                ship.x = 400;
                camX = 0;
                spawnMutant(380, 200);
                spawnMutant(420, 300);
            });
            await page.keyboard.press('b');
            const r = await page.evaluate(() => ({ enemies: enemies.length, bombs: smartBombs, score }));
            expect(r.enemies).toBe(0);
            expect(r.bombs).toBe(2);
            expect(r.score).toBe(300);
        });

        test('a bomb leaves off-screen enemies alone', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                ship.x = 400;
                camX = 0;
                spawnMutant(400, 200);
                spawnMutant(2000, 200);
            });
            await page.evaluate(() => smartBomb());
            expect(await page.evaluate(() => enemies.length)).toBe(1);
        });

        test('bombs cannot be used when none are left', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                smartBombs = 0;
                ship.x = 400;
                camX = 0;
                spawnMutant(400, 200);
                smartBomb();
            });
            const r = await page.evaluate(() => ({ enemies: enemies.length, bombs: smartBombs }));
            expect(r.enemies).toBe(1);
            expect(r.bombs).toBe(0);
        });

        test('the bomb count is shown in the HUD', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => smartBomb());
            await expect(page.locator('#bombs')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Damage, lives and game over
    // -----------------------------------------------------------------------
    test.describe('damage', () => {
        test('touching an enemy costs a life', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                ship.x = 400;
                ship.y = 200;
                spawnMutant(402, 201);
            });
            await advance(page, 2);
            const r = await page.evaluate(() => ({ lives, state }));
            expect(r.lives).toBe(2);
            expect(r.state).toBe('dying');
        });

        test('an enemy bullet costs a life', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                ship.x = 400;
                ship.y = 200;
                enemyBullets.push({ x: 404, y: 201, vx: 0, vy: 0, life: 3 });
            });
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the ship respawns after the death pause', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                ship.x = 400;
                ship.y = 200;
                spawnMutant(402, 201);
            });
            await advance(page, 2);
            await advance(page, 180);
            const r = await page.evaluate(() => ({ state, vx: ship.vx, vy: ship.vy }));
            expect(r.state).toBe('running');
            expect(r.vx).toBe(0);
            expect(r.vy).toBe(0);
        });

        test('a held humanoid is dropped when the ship dies', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                humanoids.length = 0;
                const h = makeHumanoid(400);
                h.state = 'held';
                humanoids.push(h);
                ship.held = h;
                ship.x = 400;
                ship.y = 200;
                spawnMutant(402, 201);
            });
            await advance(page, 2);
            const r = await page.evaluate(() => ({ state: humanoids[0].state, held: ship.held }));
            expect(r.state).toBe('falling');
            expect(r.held).toBe(null);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                lives = 1;
                ship.x = 400;
                ship.y = 200;
                spawnMutant(402, 201);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the best score is kept in localStorage', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                score = 4200;
                lives = 1;
                ship.x = 400;
                ship.y = 200;
                spawnMutant(402, 201);
            });
            await advance(page, 2);
            const best = await page.evaluate(() =>
                parseInt(localStorage.getItem('planet-defender-best') || '0', 10)
            );
            expect(best).toBe(4200);
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('an extra life is awarded every 10000 points', async ({ page }) => {
            await startEmpty(page);
            const after = await page.evaluate(() => {
                addScore(EXTRA_LIFE_EVERY);
                return lives;
            });
            expect(after).toBe(4);
            await expect(page.locator('#lives')).toHaveText('4');
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('clearing every lander finishes the wave and pays a bonus', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnEnabled = false;
                enemyFireEnabled = false;
                enemies.length = 0;
                score = 0;
            });
            await advance(page, 2);
            const r = await page.evaluate(() => ({ state, score, expected: WAVE_BONUS * wave * humanoids.length }));
            expect(r.state).toBe('wavecleared');
            expect(r.score).toBe(r.expected);
            expect(r.score).toBeGreaterThan(0);
        });

        test('the next wave starts with more landers and another bomb', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnEnabled = false;
                enemyFireEnabled = false;
                enemies.length = 0;
            });
            await advance(page, 2);
            await advance(page, 240);
            const r = await page.evaluate(() => ({
                state,
                wave,
                landers: enemies.filter((e) => e.type === 'lander').length,
                bombs: smartBombs,
            }));
            expect(r.state).toBe('running');
            expect(r.wave).toBe(2);
            expect(r.landers).toBe(6);
            expect(r.bombs).toBe(4);
        });

        test('surviving humanoids carry over to the next wave', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnEnabled = false;
                enemyFireEnabled = false;
                enemies.length = 0;
                humanoids.length = 3;
            });
            await advance(page, 250);
            expect(await page.evaluate(() => humanoids.length)).toBe(3);
        });

        test('a destroyed planet is restocked for the next wave', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnEnabled = false;
                enemyFireEnabled = false;
                enemies.length = 0;
                humanoids.length = 0;
                planetDestroyed = true;
            });
            await advance(page, 250);
            const r = await page.evaluate(() => ({ n: humanoids.length, destroyed: planetDestroyed }));
            expect(r.n).toBe(10);
            expect(r.destroyed).toBe(false);
        });

        test('the HUD wave counter updates', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnEnabled = false;
                enemyFireEnabled = false;
                enemies.length = 0;
            });
            await advance(page, 250);
            await expect(page.locator('#wave')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Pause and restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startEmpty(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                ship.vx = 200;
                togglePause();
            });
            const x0 = await page.evaluate(() => ship.x);
            await advance(page, 60);
            expect(await page.evaluate(() => ship.x)).toBe(x0);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await startEmpty(page);
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                ship.x = 400;
                ship.y = 200;
                spawnMutant(402, 201);
            });
            await advance(page, 2);
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => ({ state, score, lives, wave, n: humanoids.length }));
            expect(r.state).toBe('running');
            expect(r.score).toBe(0);
            expect(r.lives).toBe(3);
            expect(r.wave).toBe(1);
            expect(r.n).toBe(10);
        });
    });

    // -----------------------------------------------------------------------
    // Scanner
    // -----------------------------------------------------------------------
    test.describe('scanner', () => {
        test('scannerX maps the whole planet across the canvas', async ({ page }) => {
            const r = await page.evaluate(() => ({
                left: scannerX(0),
                right: scannerX(WORLD_W - 1),
                w: CANVAS_W,
            }));
            expect(r.left).toBeGreaterThanOrEqual(0);
            expect(r.right).toBeLessThanOrEqual(r.w);
            expect(r.right - r.left).toBeGreaterThan(r.w * 0.8);
        });

        test('a full minute of play stays consistent and throws nothing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            const summary = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 60 * 60; i++) {
                    step(1 / 60);
                    draw();
                }
                return {
                    state,
                    score,
                    wave,
                    humanoids: humanoids.map((h) => h.state),
                    enemies: enemies.map((e) => e.type),
                    offWorld: [...enemies, ...humanoids, ...bullets].filter(
                        (o) => o.x < 0 || o.x >= WORLD_W
                    ).length,
                };
            });
            expect(errors).toEqual([]);
            expect(summary.score).toBeGreaterThanOrEqual(0);
            expect(summary.wave).toBeGreaterThanOrEqual(1);
            expect(summary.offWorld).toBe(0);
            expect(
                summary.humanoids.every((s) =>
                    ['ground', 'carried', 'falling', 'held'].includes(s)
                )
            ).toBe(true);
            expect(
                summary.enemies.every((t) => ['lander', 'mutant', 'baiter'].includes(t))
            ).toBe(true);
            expect(['running', 'dying', 'wavecleared', 'over']).toContain(summary.state);
        });

        test('the canvas is actually painted', async ({ page }) => {
            await startEmpty(page);
            await advance(page, 5);
            const painted = await page.evaluate(() => {
                draw();
                const d = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i] || d[i + 1] || d[i + 2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });
    });
});
