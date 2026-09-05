const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// The cap the flight spec checks against, kept next to the other tuning numbers
// the specs assert on so the expectations read as plain values.
const MAX_VX_LIMIT = 430;
const LANDER_SCORE = 150;
const MUTANT_SCORE = 250;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so every held key is confirmed against the game's input state before the
// simulation is advanced. Without this the specs race the key handler.
const KEY_INPUT = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    a: 'left',
    d: 'right',
    w: 'up',
    s: 'down',
};

const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction((slot) => input[slot] === true, KEY_INPUT[key]);
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction((slot) => input[slot] === false, KEY_INPUT[key]);
};

// Start a game with no aliens at all: spawning and alien fire are switched off
// and the opening wave is cleared, so a spec can place exactly the aliens it
// wants to reason about. `waveSpawned` is zeroed too, otherwise the empty sky
// would immediately count as a cleared wave.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
        alienFireEnabled = false;
        aliens.length = 0;
        waveSpawned = 0;
    });

test.describe('Defender', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // Drive the simulation from the specs instead of requestAnimationFrame,
        // so nothing advances between two evaluate() calls.
        await page.evaluate(() => {
            autoStep = false;
        });
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
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 760x520', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '760');
            await expect(canvas).toHaveAttribute('height', '520');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the starting score, wave, lives, bombs and humanoids', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#wave')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#bombs')).toHaveText('3');
            await expect(page.locator('#humans')).toHaveText('10');
        });

        test('ten humanoids stand on the ground', async ({ page }) => {
            const ground = await page.evaluate(
                () => humanoids.filter((h) => h.state === 'ground').length
            );
            expect(ground).toBe(10);
        });

        test('humanoids rest on the terrain surface', async ({ page }) => {
            const offsets = await page.evaluate(() =>
                humanoids.map((h) => Math.abs(terrainY(h.x) - h.y))
            );
            for (const off of offsets) expect(off).toBeLessThan(20);
        });

        test('no aliens, lasers or alien fire before the game starts', async ({ page }) => {
            const counts = await page.evaluate(() => [
                aliens.length,
                bullets.length,
                alienShots.length,
            ]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('step does nothing while idle', async ({ page }) => {
            const before = await page.evaluate(() => ({ x: ship.x, y: ship.y }));
            await advance(page, 60);
            const after = await page.evaluate(() => ({ x: ship.x, y: ship.y }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('wave 1 spawns five landers', async ({ page }) => {
            await page.evaluate(() => startGame());
            const kinds = await page.evaluate(() => aliens.map((a) => a.type));
            expect(kinds).toEqual(['lander', 'lander', 'lander', 'lander', 'lander']);
        });

        test('starting resets score, wave, lives and bombs', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 4321;
                lives = 1;
                wave = 7;
                smartBombs = 0;
                startGame();
            });
            const stats = await page.evaluate(() => ({ score, lives, wave, smartBombs }));
            expect(stats).toEqual({ score: 0, lives: 3, wave: 1, smartBombs: 3 });
        });

        test('starting again restores all ten humanoids', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                humanoids[0].state = 'lost';
                humanoids[1].state = 'lost';
                startGame();
            });
            const ground = await page.evaluate(
                () => humanoids.filter((h) => h.state === 'ground').length
            );
            expect(ground).toBe(10);
        });

        test('aliens spawn in the sky, above the terrain', async ({ page }) => {
            await page.evaluate(() => startGame());
            const ok = await page.evaluate(() =>
                aliens.every((a) => a.y > SKY_TOP && a.y < terrainY(a.x) - 40)
            );
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Ship flight
    // -----------------------------------------------------------------------
    test.describe('ship flight', () => {
        test('holding right accelerates the ship to the right', async ({ page }) => {
            await startQuiet(page);
            const x0 = await page.evaluate(() => ship.x);
            await hold(page, 'ArrowRight');
            await advance(page, 30);
            const after = await page.evaluate(() => ({
                x: ship.x,
                vx: ship.vx,
                facing: ship.facing,
            }));
            await release(page, 'ArrowRight');
            expect(after.vx).toBeGreaterThan(0);
            expect(after.x).toBeGreaterThan(x0);
            expect(after.facing).toBe(1);
        });

        test('holding left turns the ship around and flies left', async ({ page }) => {
            await startQuiet(page);
            const x0 = await page.evaluate(() => ship.x);
            await hold(page, 'ArrowLeft');
            await advance(page, 30);
            const after = await page.evaluate(() => ({
                x: ship.x,
                vx: ship.vx,
                facing: ship.facing,
            }));
            await release(page, 'ArrowLeft');
            expect(after.vx).toBeLessThan(0);
            expect(after.x).toBeLessThan(x0);
            expect(after.facing).toBe(-1);
        });

        test('W and S climb and dive', async ({ page }) => {
            await startQuiet(page);
            const y0 = await page.evaluate(() => ship.y);
            await hold(page, 'w');
            await advance(page, 30);
            const climbed = await page.evaluate(() => ship.y);
            await release(page, 'w');
            expect(climbed).toBeLessThan(y0);

            await hold(page, 's');
            await advance(page, 40);
            const dived = await page.evaluate(() => ship.y);
            await release(page, 's');
            expect(dived).toBeGreaterThan(climbed);
        });

        test('the ship coasts to a stop when the keys are released', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'ArrowRight');
            await advance(page, 40);
            const moving = await page.evaluate(() => ship.vx);
            await release(page, 'ArrowRight');
            await advance(page, 150);
            const drifting = await page.evaluate(() => ship.vx);
            expect(moving).toBeGreaterThan(50);
            expect(drifting).toBeLessThan(moving);
            expect(Math.abs(drifting)).toBeLessThan(30);
        });

        test('horizontal speed is capped', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'ArrowRight');
            await advance(page, 600);
            const vx = await page.evaluate(() => ship.vx);
            await release(page, 'ArrowRight');
            expect(vx).toBeLessThanOrEqual(MAX_VX_LIMIT);
        });

        test('the ship cannot climb above the sky ceiling', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'ArrowUp');
            await advance(page, 400);
            const y = await page.evaluate(() => ship.y);
            const skyTop = await page.evaluate(() => SKY_TOP);
            await release(page, 'ArrowUp');
            expect(y).toBeGreaterThanOrEqual(skyTop);
        });

        test('the ship cannot dive through the terrain', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'ArrowDown');
            await advance(page, 400);
            const clear = await page.evaluate(() => terrainY(ship.x) - ship.y);
            await release(page, 'ArrowDown');
            expect(clear).toBeGreaterThan(0);
        });

        test('the world wraps horizontally', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                ship.x = WORLD_W - 10;
                ship.vx = 400;
            });
            await advance(page, 30);
            const x = await page.evaluate(() => ship.x);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(200);
        });

        test('the camera keeps the ship on screen', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'ArrowRight');
            await advance(page, 200);
            const sx = await page.evaluate(() => screenX(ship.x));
            await release(page, 'ArrowRight');
            expect(sx).toBeGreaterThan(0);
            expect(sx).toBeLessThan(760);
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test('Space fires a laser in the direction the ship faces', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('Space');
            const shot = await page.evaluate(() => ({ n: bullets.length, vx: bullets[0].vx }));
            expect(shot.n).toBe(1);
            expect(shot.vx).toBeGreaterThan(0);
        });

        test('lasers fly the other way after turning around', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'ArrowLeft');
            await page.evaluate(() => fire());
            await release(page, 'ArrowLeft');
            const vx = await page.evaluate(() => bullets[0].vx);
            expect(vx).toBeLessThan(0);
        });

        test('the cannon has a cooldown', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                fire();
                fire();
                fire();
            });
            expect(await page.evaluate(() => bullets.length)).toBe(1);
            await advance(page, 20);
            await page.evaluate(() => fire());
            expect(await page.evaluate(() => bullets.length)).toBe(2);
        });

        test('lasers expire so they do not circle the planet forever', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => fire());
            await advance(page, 20);
            expect(await page.evaluate(() => bullets.length)).toBe(1);
            await advance(page, 60);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('no more than six lasers are in flight', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                for (let i = 0; i < 12; i++) {
                    fireTimer = 0;
                    fire();
                }
            });
            expect(await page.evaluate(() => bullets.length)).toBeLessThanOrEqual(6);
        });

        test('firing does nothing while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => togglePause());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting aliens
    // -----------------------------------------------------------------------
    test.describe('shooting aliens', () => {
        test('a laser destroys a lander and scores 150', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                ship.vx = 0;
                spawnLander(wrapX(ship.x + 120), ship.y);
                spawnLander(wrapX(ship.x - 900), 200); // decoy, keeps the wave alive
                fire();
            });
            await advance(page, 20);
            const after = await page.evaluate(() => ({ n: aliens.length, score }));
            expect(after.n).toBe(1);
            expect(after.score).toBe(LANDER_SCORE);
        });

        test('lasers miss aliens that are not in their path', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                ship.vx = 0;
                spawnLander(wrapX(ship.x + 120), ship.y - 120);
                fire();
            });
            await advance(page, 20);
            const after = await page.evaluate(() => ({ n: aliens.length, score }));
            expect(after).toEqual({ n: 1, score: 0 });
        });

        test('a destroyed alien leaves an explosion', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                ship.vx = 0;
                spawnLander(wrapX(ship.x + 120), ship.y);
                spawnLander(wrapX(ship.x - 900), 200);
                fire();
            });
            await advance(page, 20);
            expect(await page.evaluate(() => particles.length)).toBeGreaterThan(0);
        });

        test('a mutant is worth 250', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                ship.vx = 0;
                const m = spawnLander(wrapX(ship.x + 120), ship.y);
                m.type = 'mutant';
                spawnLander(wrapX(ship.x - 900), 200);
                fire();
            });
            await advance(page, 20);
            expect(await page.evaluate(() => score)).toBe(MUTANT_SCORE);
        });
    });

    // -----------------------------------------------------------------------
    // Landers and humanoids
    // -----------------------------------------------------------------------
    test.describe('abduction', () => {
        test('a lander descends towards a humanoid and grabs it', async ({ page }) => {
            await startQuiet(page);
            const grabbed = await page.evaluate(() => {
                const h = humanoids[0];
                const lander = spawnLander(h.x, SKY_TOP + 60);
                for (let i = 0; i < 400; i++) step(1 / 60);
                return { carrying: lander.carrying === h, hstate: h.state, mode: lander.mode };
            });
            expect(grabbed).toEqual({ carrying: true, hstate: 'abducted', mode: 'lift' });
        });

        test('a carried humanoid rides under the lander', async ({ page }) => {
            await startQuiet(page);
            const rel = await page.evaluate(() => {
                const h = humanoids[0];
                const lander = spawnLander(h.x, 200);
                h.state = 'abducted';
                lander.carrying = h;
                lander.mode = 'lift';
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { dx: Math.abs(h.x - lander.x), dy: h.y - lander.y, rising: lander.y < 200 };
            });
            expect(rel.dx).toBeLessThan(2);
            expect(rel.dy).toBeGreaterThan(0);
            expect(rel.rising).toBe(true);
        });

        test('a lander that reaches the top mutates and the humanoid is lost', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                const h = humanoids[0];
                const lander = spawnLander(h.x, SKY_TOP + 120);
                h.state = 'abducted';
                lander.carrying = h;
                lander.mode = 'lift';
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { type: lander.type, hstate: h.state, carrying: lander.carrying };
            });
            expect(out.type).toBe('mutant');
            expect(out.hstate).toBe('lost');
            expect(out.carrying).toBe(null);
        });

        test('the humanoid counter drops when one is lost', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const h = humanoids[0];
                const lander = spawnLander(h.x, SKY_TOP + 120);
                h.state = 'abducted';
                lander.carrying = h;
                lander.mode = 'lift';
                for (let i = 0; i < 300; i++) step(1 / 60);
            });
            await expect(page.locator('#humans')).toHaveText('9');
        });

        test('shooting a carrying lander makes the humanoid fall', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                ship.vx = 0;
                const h = humanoids[0];
                const lander = spawnLander(wrapX(ship.x + 120), ship.y);
                spawnLander(wrapX(ship.x - 900), 200);
                h.state = 'abducted';
                h.x = lander.x;
                h.y = lander.y + 16;
                lander.carrying = h;
                lander.mode = 'lift';
                fire();
                for (let i = 0; i < 20; i++) step(1 / 60);
                return { hstate: h.state, aliens: aliens.length };
            });
            expect(out).toEqual({ hstate: 'falling', aliens: 1 });
        });

        test('a falling humanoid lands safely on the terrain', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                const h = humanoids[0];
                h.state = 'falling';
                h.y = SKY_TOP + 60;
                h.vy = 0;
                for (let i = 0; i < 400; i++) step(1 / 60);
                return { state: h.state, offset: Math.abs(terrainY(h.x) - h.y) };
            });
            expect(out.state).toBe('ground');
            expect(out.offset).toBeLessThan(20);
        });

        test('a lander with no humanoid left to take patrols instead', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                for (const h of humanoids) h.state = 'aboard';
                const lander = spawnLander(wrapX(ship.x + 700), 200);
                for (let i = 0; i < 240; i++) step(1 / 60);
                return { carrying: lander.carrying, alive: aliens.includes(lander), state };
            });
            expect(out).toEqual({ carrying: null, alive: true, state: 'running' });
        });
    });

    // -----------------------------------------------------------------------
    // Rescuing humanoids
    // -----------------------------------------------------------------------
    test.describe('rescue', () => {
        test('flying into a falling humanoid catches it and scores 250', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                const h = humanoids[0];
                h.state = 'falling';
                h.x = ship.x;
                h.y = ship.y;
                h.vy = 0;
                step(1 / 60);
                return { state: h.state, score };
            });
            expect(out).toEqual({ state: 'aboard', score: 250 });
        });

        test('a caught humanoid rides with the ship', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                const h = humanoids[0];
                h.state = 'aboard';
                ship.x = 500;
                ship.y = SKY_TOP + 100;
                ship.vx = 0;
                ship.vy = 0;
                for (let i = 0; i < 10; i++) step(1 / 60);
                return { dx: Math.abs(h.x - ship.x), dy: h.y - ship.y, state: h.state };
            });
            expect(out.state).toBe('aboard');
            expect(out.dx).toBeLessThan(2);
            expect(out.dy).toBeGreaterThan(0);
        });

        test('carrying a humanoid down to the ground scores 500 and sets it free', async ({
            page,
        }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                const h = humanoids[0];
                h.state = 'aboard';
                score = 0;
                ship.y = terrainY(ship.x) - 40;
                input.down = true;
                for (let i = 0; i < 120; i++) step(1 / 60);
                input.down = false;
                return { state: h.state, score, offset: Math.abs(terrainY(h.x) - h.y) };
            });
            expect(out.state).toBe('ground');
            expect(out.score).toBe(500);
            expect(out.offset).toBeLessThan(20);
        });

        test('a lost humanoid never comes back', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                const h = humanoids[0];
                h.state = 'lost';
                for (let i = 0; i < 120; i++) step(1 / 60);
                return h.state;
            });
            expect(out).toBe('lost');
        });

        test('losing every humanoid mutates the remaining landers', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                const lander = spawnLander(wrapX(ship.x + 900), 200);
                for (const h of humanoids) loseHumanoid(h);
                step(1 / 60);
                return { type: lander.type, planetDead };
            });
            expect(out).toEqual({ type: 'mutant', planetDead: true });
        });
    });

    // -----------------------------------------------------------------------
    // Smart bombs
    // -----------------------------------------------------------------------
    test.describe('smart bomb', () => {
        test('B clears the aliens on screen and spends a bomb', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnLander(wrapX(ship.x + 60), ship.y - 60);
                spawnLander(wrapX(ship.x - 60), ship.y - 90);
            });
            await page.keyboard.press('b');
            const out = await page.evaluate(() => ({ n: aliens.length, bombs: smartBombs, score }));
            expect(out).toEqual({ n: 0, bombs: 2, score: 2 * LANDER_SCORE });
        });

        test('a smart bomb spares aliens off screen', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                spawnLander(wrapX(ship.x + 1400), 200);
                useSmartBomb();
                return aliens.length;
            });
            expect(out).toBe(1);
        });

        test('a smart bomb drops any humanoid being carried', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                const h = humanoids[0];
                const lander = spawnLander(wrapX(ship.x + 60), ship.y - 60);
                h.state = 'abducted';
                lander.carrying = h;
                lander.mode = 'lift';
                useSmartBomb();
                return h.state;
            });
            expect(out).toBe('falling');
        });

        test('bombs cannot go negative', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                smartBombs = 0;
                const used = useSmartBomb();
                return { used, smartBombs };
            });
            expect(out).toEqual({ used: false, smartBombs: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Damage and lives
    // -----------------------------------------------------------------------
    test.describe('damage', () => {
        test('colliding with an alien costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnLander(ship.x, ship.y);
                spawnLander(wrapX(ship.x - 900), 200); // decoy, keeps the wave alive
                step(1 / 60);
            });
            const out = await page.evaluate(() => ({ state, lives }));
            expect(out).toEqual({ state: 'dying', lives: 2 });
        });

        test('an alien shot costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                alienShots.push({ x: ship.x, y: ship.y, vx: 0, vy: 0, life: 3 });
                step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('the ship respawns after the death pause', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnLander(ship.x, ship.y);
                spawnLander(wrapX(ship.x - 900), 200);
                step(1 / 60);
            });
            await advance(page, 120);
            const out = await page.evaluate(() => ({
                state,
                vx: ship.vx,
                shots: alienShots.length,
            }));
            expect(out).toEqual({ state: 'running', vx: 0, shots: 0 });
        });

        test('a humanoid aboard falls when the ship is destroyed', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                const h = humanoids[0];
                h.state = 'aboard';
                spawnLander(ship.x, ship.y);
                step(1 / 60);
                return h.state;
            });
            expect(out).toBe('falling');
        });

        test('running out of lives ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                spawnLander(ship.x, ship.y);
                spawnLander(wrapX(ship.x - 900), 200);
                step(1 / 60);
            });
            await advance(page, 120);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('the best score is remembered', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                spawnLander(ship.x, ship.y);
                spawnLander(wrapX(ship.x - 900), 200);
                step(1 / 60);
            });
            await advance(page, 120);
            await expect(page.locator('#best')).toHaveText('900');
            expect(await page.evaluate(() => localStorage.getItem('defender-best'))).toBe('900');
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('clearing every alien ends the wave', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                ship.vx = 0;
                spawnLander(wrapX(ship.x + 120), ship.y);
                fire();
                for (let i = 0; i < 20; i++) step(1 / 60);
                return state;
            });
            expect(out).toBe('waveclear');
        });

        test('surviving humanoids pay a bonus at the end of a wave', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                ship.vx = 0;
                spawnLander(wrapX(ship.x + 120), ship.y);
                fire();
                for (let i = 0; i < 20; i++) step(1 / 60);
                return score;
            });
            expect(out).toBe(LANDER_SCORE + 10 * 100);
        });

        test('the next wave is larger', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                alienFireEnabled = false;
                aliens.length = 0;
                nextWave();
            });
            const out = await page.evaluate(() => ({ wave, n: aliens.length }));
            expect(out).toEqual({ wave: 2, n: 6 });
        });

        test('a new wave starts after the wave-clear pause', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                alienFireEnabled = false;
                aliens.length = 0;
                waveSpawned = 1;
                step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('waveclear');
            await advance(page, 150);
            const out = await page.evaluate(() => ({ state, wave, n: aliens.length }));
            expect(out).toEqual({ state: 'running', wave: 2, n: 6 });
        });

        test('every third wave grants a smart bomb', async ({ page }) => {
            const out = await page.evaluate(() => {
                startGame();
                spawnEnabled = false;
                const before = smartBombs;
                nextWave(); // wave 2
                const two = smartBombs;
                nextWave(); // wave 3
                return { before, two, three: smartBombs };
            });
            expect(out).toEqual({ before: 3, two: 3, three: 4 });
        });
    });

    // -----------------------------------------------------------------------
    // Alien fire
    // -----------------------------------------------------------------------
    test.describe('alien fire', () => {
        test('landers shoot at the ship', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                alienFireEnabled = true;
                const lander = spawnLander(wrapX(ship.x + 200), ship.y - 100);
                lander.fireTimer = 0.01;
                for (let i = 0; i < 5; i++) step(1 / 60);
                return alienShots.length;
            });
            expect(out).toBeGreaterThan(0);
        });

        test('alien shots travel towards the ship', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                alienFireEnabled = true;
                ship.x = 400;
                ship.y = 300;
                const lander = spawnLander(600, 300);
                lander.fireTimer = 0.01;
                step(1 / 60);
                return alienShots[0].vx;
            });
            expect(out).toBeLessThan(0);
        });

        test('alien shots expire', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                alienShots.push({ x: 100, y: 100, vx: 0, vy: 0, life: 0.2 });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => alienShots.length)).toBe(0);
        });

        test('lasers destroy alien shots', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => {
                ship.vx = 0;
                alienShots.push({ x: wrapX(ship.x + 150), y: ship.y, vx: 0, vy: 0, life: 3 });
                fire();
                for (let i = 0; i < 20; i++) step(1 / 60);
                return alienShots.length;
            });
            expect(out).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, HUD and the animation loop
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                ship.vx = 200;
                togglePause();
            });
            const before = await page.evaluate(() => ship.x);
            await advance(page, 60);
            expect(await page.evaluate(() => ship.x)).toBe(before);
        });

        test('the pause overlay offers to resume', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText(/resume/i);
        });
    });

    test.describe('HUD and rendering', () => {
        test('the HUD tracks score, wave, lives and bombs', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 1234;
                wave = 4;
                lives = 2;
                smartBombs = 1;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('1234');
            await expect(page.locator('#wave')).toHaveText('4');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#bombs')).toHaveText('1');
        });

        test('drawing every kind of entity does not throw', async ({ page }) => {
            await startQuiet(page);
            const ok = await page.evaluate(() => {
                const m = spawnLander(wrapX(ship.x + 100), 200);
                m.type = 'mutant';
                spawnLander(wrapX(ship.x + 200), 240);
                humanoids[1].state = 'falling';
                humanoids[2].state = 'aboard';
                humanoids[3].state = 'lost';
                alienShots.push({ x: ship.x, y: 200, vx: 10, vy: 0, life: 2 });
                fire();
                draw();
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the canvas is painted', async ({ page }) => {
            await page.evaluate(() => startGame());
            await advance(page, 10);
            const painted = await page.evaluate(() => {
                draw();
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                let lit = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] + data[i + 1] + data[i + 2] > 90) lit++;
                }
                return lit;
            });
            expect(painted).toBeGreaterThan(500);
        });

        test('the animation loop advances the game on its own', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                alienFireEnabled = false;
                aliens.length = 0;
                waveSpawned = 0;
                spawnLander(wrapX(ship.x + 400), 150);
                autoStep = true;
            });
            const before = await page.evaluate(() => aliens[0].y);
            await page.waitForTimeout(300);
            const after = await page.evaluate(() => aliens[0].y);
            await page.evaluate(() => {
                autoStep = false;
            });
            expect(after).toBeGreaterThan(before);
        });
    });
});
