const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt). The
// real animation loop is running too, but every spec drives the state it cares
// about through step() so nothing depends on wall-clock timing.
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

const KEY_DIR = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    a: { x: -1, y: 0 },
    d: { x: 1, y: 0 },
    w: { x: 0, y: -1 },
    s: { x: 0, y: 1 },
};

// Chromium can acknowledge a synthetic key before the page listener has run, so
// confirm the press landed in the game state before simulating any frames.
const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction(
        (want) => ship.dir.x === want.x && ship.dir.y === want.y,
        KEY_DIR[key]
    );
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction(() => ship.dir.x === 0 && ship.dir.y === 0);
};

// Start a run with nothing in the canyon and no fuel drain, so long simulations
// stay deterministic. Specs about targets or fuel opt back in.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        fuelDrainEnabled = false;
        rockets.length = 0;
        tanks.length = 0;
    });

// Flatten the terrain so the ship can be parked anywhere without crashing.
const flatten = (page, ground = 40) =>
    page.evaluate((g) => {
        for (const col of terrain) {
            col.ground = g;
            col.ceil = 0;
        }
    }, ground);

test.describe('Scramble', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Scramble', async ({ page }) => {
            await expect(page).toHaveTitle('Scramble');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 640x420', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '420');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level, lives and fuel', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#fuel')).toHaveText('100');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('scramble-best', '7300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7300');
        });

        test('nothing moves while idle', async ({ page }) => {
            const before = await page.evaluate(() => camX);
            await advance(page, 60);
            expect(await page.evaluate(() => camX)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Terrain generation
    // -----------------------------------------------------------------------
    test.describe('terrain', () => {
        test('a level of columns is generated up front', async ({ page }) => {
            const { cols, levelCols } = await page.evaluate(() => ({
                cols: terrain.length,
                levelCols: LEVEL_COLS,
            }));
            expect(cols).toBeGreaterThan(levelCols);
        });

        test('every column has a flyable corridor', async ({ page }) => {
            const worst = await page.evaluate(() =>
                Math.min(...terrain.map((c) => CANVAS_H - c.ground - c.ceil))
            );
            expect(worst).toBeGreaterThanOrEqual(await page.evaluate(() => MIN_GAP));
        });

        test('ground height stays inside its bounds', async ({ page }) => {
            const ok = await page.evaluate(() =>
                terrain.every((c) => c.ground >= GROUND_MIN && c.ground <= GROUND_MAX)
            );
            expect(ok).toBe(true);
        });

        test('the launch area is flat and open', async ({ page }) => {
            const ok = await page.evaluate(() =>
                terrain.slice(0, SAFE_COLS).every((c) => c.ceil === 0 && c.ground === GROUND_MIN)
            );
            expect(ok).toBe(true);
        });

        test('level 1 has no ceiling', async ({ page }) => {
            const maxCeil = await page.evaluate(() => Math.max(...terrain.map((c) => c.ceil)));
            expect(maxCeil).toBe(0);
        });

        test('later levels grow a ceiling', async ({ page }) => {
            const maxCeil = await page.evaluate(() => {
                level = 3;
                buildLevel();
                return Math.max(...terrain.map((c) => c.ceil));
            });
            expect(maxCeil).toBeGreaterThan(0);
        });

        test('the same level always generates the same canyon', async ({ page }) => {
            const same = await page.evaluate(() => {
                level = 4;
                buildLevel();
                const a = terrain.map((c) => `${c.ground}/${c.ceil}`).join(',');
                buildLevel();
                const b = terrain.map((c) => `${c.ground}/${c.ceil}`).join(',');
                return a === b;
            });
            expect(same).toBe(true);
        });

        test('different levels generate different canyons', async ({ page }) => {
            const same = await page.evaluate(() => {
                level = 1;
                buildLevel();
                const a = terrain.map((c) => c.ground).join(',');
                level = 2;
                buildLevel();
                const b = terrain.map((c) => c.ground).join(',');
                return a === b;
            });
            expect(same).toBe(false);
        });

        test('groundHeightAt samples the column under a world x', async ({ page }) => {
            const match = await page.evaluate(() => {
                const x = COL_W * 20 + 5;
                return groundHeightAt(x) === terrain[20].ground && columnIndexAt(x) === 20;
            });
            expect(match).toBe(true);
        });

        test('terrain sampling clamps outside the array', async ({ page }) => {
            const ok = await page.evaluate(
                () =>
                    groundHeightAt(-500) === terrain[0].ground &&
                    groundHeightAt(1e9) === terrain[terrain.length - 1].ground
            );
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press(' ');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh run resets score, lives, level and fuel', async ({ page }) => {
            const stats = await page.evaluate(() => {
                score = 999;
                lives = 1;
                level = 5;
                fuel = 12;
                startGame();
                return { score, lives, level, fuel };
            });
            expect(stats).toEqual({ score: 0, lives: 3, level: 1, fuel: 100 });
        });

        test('the ship starts alive in the safe zone', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                return { alive: ship.alive, sx: shipScreenX(), y: ship.y, camX };
            });
            expect(info.alive).toBe(true);
            expect(info.camX).toBe(0);
            expect(info.sx).toBeGreaterThan(0);
            expect(info.y).toBeGreaterThan(0);
        });

        test('a level is stocked with fuel dumps and rockets', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                return { tanks: tanks.length, rockets: rockets.length };
            });
            expect(counts.tanks).toBeGreaterThan(0);
            expect(counts.rockets).toBeGreaterThan(0);
        });

        test('targets stand on the canyon floor', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return [...tanks, ...rockets].every(
                    (t) => Math.abs(t.y + t.h - (CANVAS_H - groundHeightAt(t.x))) < 1.5
                );
            });
            expect(ok).toBe(true);
        });

        test('no targets sit in the safe launch zone', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return [...tanks, ...rockets].every((t) => t.x > SAFE_COLS * COL_W);
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Scrolling and flight
    // -----------------------------------------------------------------------
    test.describe('flight', () => {
        test('the canyon scrolls past at the level speed', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            const moved = await page.evaluate(() => {
                const before = camX;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return camX - before;
            });
            const want = await page.evaluate(() => scrollSpeed());
            expect(moved).toBeCloseTo(want, 0);
        });

        test('the ship is carried along with the camera', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            const drift = await page.evaluate(() => {
                const before = shipScreenX();
                for (let i = 0; i < 60; i++) step(1 / 60);
                return Math.abs(shipScreenX() - before);
            });
            expect(drift).toBeLessThan(0.5);
        });

        test('scroll speed rises with the level', async ({ page }) => {
            const faster = await page.evaluate(() => {
                level = 1;
                const a = scrollSpeed();
                level = 4;
                return scrollSpeed() > a;
            });
            expect(faster).toBe(true);
        });

        test('ArrowUp climbs', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            const before = await page.evaluate(() => ship.y);
            await hold(page, 'ArrowUp');
            await advance(page, 20);
            await release(page, 'ArrowUp');
            expect(await page.evaluate(() => ship.y)).toBeLessThan(before);
        });

        test('ArrowDown dives', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            const before = await page.evaluate(() => ship.y);
            await hold(page, 'ArrowDown');
            await advance(page, 20);
            await release(page, 'ArrowDown');
            expect(await page.evaluate(() => ship.y)).toBeGreaterThan(before);
        });

        test('ArrowRight pushes the ship forward on screen', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            const before = await page.evaluate(() => shipScreenX());
            await hold(page, 'ArrowRight');
            await advance(page, 20);
            await release(page, 'ArrowRight');
            expect(await page.evaluate(() => shipScreenX())).toBeGreaterThan(before);
        });

        test('ArrowLeft drops the ship back on screen', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            const before = await page.evaluate(() => shipScreenX());
            await hold(page, 'ArrowLeft');
            await advance(page, 20);
            await release(page, 'ArrowLeft');
            expect(await page.evaluate(() => shipScreenX())).toBeLessThan(before);
        });

        test('WASD works as well as the arrows', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            const before = await page.evaluate(() => ship.y);
            await hold(page, 'w');
            await advance(page, 20);
            await release(page, 'w');
            expect(await page.evaluate(() => ship.y)).toBeLessThan(before);
        });

        test('the ship cannot leave its screen window', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            await hold(page, 'ArrowRight');
            await advance(page, 600);
            await release(page, 'ArrowRight');
            const sx = await page.evaluate(() => shipScreenX());
            const max = await page.evaluate(() => SHIP_MAX_SX);
            expect(sx).toBeLessThanOrEqual(max + 0.5);

            await hold(page, 'ArrowLeft');
            await advance(page, 600);
            await release(page, 'ArrowLeft');
            const sx2 = await page.evaluate(() => shipScreenX());
            const min = await page.evaluate(() => SHIP_MIN_SX);
            expect(sx2).toBeGreaterThanOrEqual(min - 0.5);
        });

        test('the ship cannot fly off the top of the screen', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            await hold(page, 'ArrowUp');
            await advance(page, 600);
            await release(page, 'ArrowUp');
            expect(await page.evaluate(() => ship.y)).toBeGreaterThanOrEqual(
                await page.evaluate(() => SHIP_HH)
            );
        });

        test('the ship does not move while dead', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            const still = await page.evaluate(() => {
                crash();
                const y = ship.y;
                for (let i = 0; i < 10; i++) step(1 / 60);
                return ship.y === y;
            });
            expect(still).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test('fuel drains while flying', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                rockets.length = 0;
                tanks.length = 0;
            });
            await flatten(page);
            const drained = await page.evaluate(() => {
                const before = fuel;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return before - fuel;
            });
            expect(drained).toBeCloseTo(await page.evaluate(() => FUEL_DRAIN), 1);
        });

        test('the HUD fuel readout follows the tank', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                fuel = 42;
                step(0);
            });
            await expect(page.locator('#fuel')).toHaveText('42');
        });

        test('the fuel bar width tracks the tank', async ({ page }) => {
            // Read the bar inside the same evaluate, so the live animation loop
            // cannot drain a sliver of fuel between setting and reading.
            const width = await page.evaluate(() => {
                startGame();
                fuel = 50;
                step(0);
                return document.getElementById('fuel-fill').style.width;
            });
            expect(width).toBe('50%');
        });

        test('the fuel bar warns when low', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                fuel = 15;
                step(0);
            });
            await expect(page.locator('#fuel-fill')).toHaveClass(/critical/);
        });

        test('running dry costs a life', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                rockets.length = 0;
                tanks.length = 0;
                fuel = 0.01;
                step(1 / 60);
                return { lives, alive: ship.alive, fuel };
            });
            expect(after.lives).toBe(2);
            expect(after.alive).toBe(false);
            expect(after.fuel).toBe(0);
        });

        test('a destroyed fuel dump refills the tank', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                fuel = 40;
                const tank = tanks[0];
                destroyTarget(tank);
                return fuel;
            });
            expect(after).toBeCloseTo(55, 5);
        });

        test('fuel never exceeds the maximum', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                fuel = 98;
                destroyTarget(tanks[0]);
                return fuel;
            });
            expect(after).toBe(100);
        });
    });

    // -----------------------------------------------------------------------
    // Weapons
    // -----------------------------------------------------------------------
    test.describe('weapons', () => {
        test('Space fires a laser', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press(' ');
            await page.waitForFunction(() => bullets.length === 1);
        });

        test('the laser travels forward through the world', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            const moved = await page.evaluate(() => {
                fire();
                const before = bullets[0].x;
                for (let i = 0; i < 10; i++) step(1 / 60);
                return bullets.length ? bullets[0].x - before : 0;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('only a few lasers may be in the air', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 20; i++) fire();
                return bullets.length;
            });
            expect(count).toBe(await page.evaluate(() => BULLET_MAX));
        });

        test('lasers expire once they leave the screen', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            const gone = await page.evaluate(() => {
                fire();
                for (let i = 0; i < 400; i++) step(1 / 60);
                return bullets.length;
            });
            expect(gone).toBe(0);
        });

        test('lasers are stopped by the canyon wall', async ({ page }) => {
            const gone = await page.evaluate(() => {
                startGame();
                for (const col of terrain) {
                    col.ground = 40;
                    col.ceil = 0;
                }
                ship.y = CANVAS_H - 50;
                fire();
                // Raise a wall just ahead of the muzzle.
                const idx = columnIndexAt(bullets[0].x + 30);
                for (let i = idx; i < idx + 4; i++) terrain[i].ground = GROUND_MAX;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return bullets.length;
            });
            expect(gone).toBe(0);
        });

        test('B drops a bomb', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('b');
            await page.waitForFunction(() => bombs.length === 1);
        });

        test('bombs arc forward and down', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            const arc = await page.evaluate(() => {
                ship.y = 80;
                dropBomb();
                const b = bombs[0];
                const x0 = b.x;
                const y0 = b.y;
                for (let i = 0; i < 10; i++) step(1 / 60);
                return { dx: b.x - x0, dy: b.y - y0, vy: b.vy };
            });
            expect(arc.dx).toBeGreaterThan(0);
            expect(arc.dy).toBeGreaterThan(0);
            expect(arc.vy).toBeGreaterThan(0);
        });

        test('only a few bombs may be in the air', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 20; i++) dropBomb();
                return bombs.length;
            });
            expect(count).toBe(await page.evaluate(() => BOMB_MAX));
        });

        test('a bomb explodes when it reaches the floor', async ({ page }) => {
            await startQuiet(page);
            await flatten(page);
            const gone = await page.evaluate(() => {
                ship.y = 80;
                dropBomb();
                let frames = 0;
                while (bombs.length && frames < 600) {
                    step(1 / 60);
                    frames++;
                }
                return { bombs: bombs.length, blasts: blasts.length, frames };
            });
            expect(gone.bombs).toBe(0);
            expect(gone.frames).toBeLessThan(600);
            expect(gone.blasts).toBeGreaterThan(0);
        });

        test('no weapons fire while the ship is dead', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                crash();
                fire();
                dropBomb();
                return { bullets: bullets.length, bombs: bombs.length };
            });
            expect(counts).toEqual({ bullets: 0, bombs: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Targets
    // -----------------------------------------------------------------------
    test.describe('targets', () => {
        test('a laser destroys a fuel dump and scores', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                rockets.length = 0;
                // Flatten the canyon so the shot has clear air to the dump.
                for (const col of terrain) {
                    col.ground = GROUND_MIN;
                    col.ceil = 0;
                }
                const tank = tanks[0];
                tank.y = CANVAS_H - GROUND_MIN - tank.h;
                // Line the ship up just behind the dump.
                ship.x = tank.x - 60;
                camX = ship.x - 90;
                ship.y = tank.y + tank.h / 2;
                fire();
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { alive: tank.alive, score };
            });
            expect(after.alive).toBe(false);
            expect(after.score).toBeGreaterThanOrEqual(100);
        });

        test('a laser destroys a rocket and scores', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                tanks.length = 0;
                for (const col of terrain) {
                    col.ground = GROUND_MIN;
                    col.ceil = 0;
                }
                const rocket = rockets[0];
                rocket.y = CANVAS_H - GROUND_MIN - rocket.h;
                ship.x = rocket.x - 60;
                camX = ship.x - 90;
                ship.y = rocket.y + rocket.h / 2;
                fire();
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { alive: rocket.alive, score };
            });
            expect(after.alive).toBe(false);
            expect(after.score).toBeGreaterThanOrEqual(80);
        });

        test('a bomb blast clears nearby targets', async ({ page }) => {
            const alive = await page.evaluate(() => {
                startGame();
                const tank = tanks[0];
                explode(tank.x, CANVAS_H - groundHeightAt(tank.x));
                return tank.alive;
            });
            expect(alive).toBe(false);
        });

        test('a bomb blast spares distant targets', async ({ page }) => {
            const alive = await page.evaluate(() => {
                startGame();
                const tank = tanks[0];
                explode(tank.x + BLAST_R * 6, CANVAS_H - groundHeightAt(tank.x));
                return tank.alive;
            });
            expect(alive).toBe(true);
        });

        test('destroyed targets stop counting as hazards', async ({ page }) => {
            const survived = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                const rocket = rockets[0];
                destroyTarget(rocket);
                // The camera has to come along: the ship is pinned to a window
                // on screen, so a bare ship.x would just be clamped back.
                camX = rocket.x - 90;
                ship.x = rocket.x;
                ship.y = rocket.y + rocket.h / 2;
                step(1 / 60);
                return ship.alive;
            });
            expect(survived).toBe(true);
        });

        test('a rocket launches when the ship gets close', async ({ page }) => {
            const launched = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                const rocket = rockets[0];
                ship.x = rocket.x - ROCKET_TRIGGER + 10;
                camX = ship.x - 90;
                ship.y = 60;
                step(1 / 60);
                return rocket.launched;
            });
            expect(launched).toBe(true);
        });

        test('a launched rocket climbs', async ({ page }) => {
            const climbed = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                const rocket = rockets[0];
                rocket.launched = true;
                const y0 = rocket.y;
                ship.y = 40;
                ship.x = rocket.x - 300;
                camX = ship.x - 90;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return y0 - rocket.y;
            });
            expect(climbed).toBeGreaterThan(0);
        });

        test('a rocket that flies off the top is retired', async ({ page }) => {
            const alive = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                const rocket = rockets[0];
                rocket.launched = true;
                rocket.y = -100;
                ship.x = rocket.x - 400;
                camX = ship.x - 90;
                step(1 / 60);
                return rocket.alive;
            });
            expect(alive).toBe(false);
        });

        test('a distant rocket stays on the ground', async ({ page }) => {
            const launched = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                const rocket = rockets[rockets.length - 1];
                step(1 / 60);
                return rocket.launched;
            });
            expect(launched).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Crashes
    // -----------------------------------------------------------------------
    test.describe('crashes', () => {
        test('flying into the floor costs a life', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                ship.y = CANVAS_H - 5;
                step(1 / 60);
                return { lives, alive: ship.alive };
            });
            expect(after).toEqual({ lives: 2, alive: false });
        });

        test('flying into the ceiling costs a life', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                terrain[columnIndexAt(ship.x)].ceil = 200;
                ship.y = 60;
                step(1 / 60);
                return { lives, alive: ship.alive };
            });
            expect(after).toEqual({ lives: 2, alive: false });
        });

        test('touching a rocket costs a life', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                const rocket = rockets[0];
                camX = rocket.x - 90;
                ship.x = rocket.x;
                ship.y = rocket.y + rocket.h / 2;
                step(1 / 60);
                return { lives, alive: ship.alive };
            });
            expect(after).toEqual({ lives: 2, alive: false });
        });

        test('touching a fuel dump costs a life', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                rockets.length = 0;
                const tank = tanks[0];
                camX = tank.x - 90;
                ship.x = tank.x;
                ship.y = tank.y + tank.h / 2;
                step(1 / 60);
                return { lives, alive: ship.alive };
            });
            expect(after).toEqual({ lives: 2, alive: false });
        });

        test('the level restarts after a crash', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                camX = 900;
                ship.x = 990;
                fuel = 20;
                crash();
                for (let i = 0; i < 80; i++) step(1 / 60);
                return { camX, alive: ship.alive, fuel, level };
            });
            expect(after.alive).toBe(true);
            expect(after.camX).toBeLessThan(60);
            expect(after.fuel).toBe(100);
            expect(after.level).toBe(1);
        });

        test('a crash restores the level targets', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                tanks.forEach((t) => (t.alive = false));
                crash();
                for (let i = 0; i < 80; i++) step(1 / 60);
                return tanks.every((t) => t.alive);
            });
            expect(after).toBe(true);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                lives = 1;
                crash();
                return state;
            });
            expect(after).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('game over shows the final score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 4321;
                lives = 1;
                crash();
            });
            await expect(page.locator('#overlay-score')).toContainText('4321');
        });

        test('the best score is kept in localStorage', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                score = 5500;
                lives = 1;
                crash();
                return window.localStorage.getItem('scramble-best');
            });
            expect(best).toBe('5500');
            await expect(page.locator('#best')).toHaveText('5500');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            const best = await page.evaluate(() => {
                window.localStorage.setItem('scramble-best', '9000');
                best = 9000;
                startGame();
                score = 100;
                lives = 1;
                crash();
                return window.localStorage.getItem('scramble-best');
            });
            expect(best).toBe('9000');
        });

        test('no simulation runs after the game is over', async ({ page }) => {
            const still = await page.evaluate(() => {
                startGame();
                lives = 1;
                crash();
                const x = camX;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return camX === x;
            });
            expect(still).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Level progression
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('reaching the end of the canyon advances the level', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                ship.x = LEVEL_LEN + 5;
                camX = ship.x - 90;
                step(1 / 60);
                return { level, camX };
            });
            expect(after.level).toBe(2);
            expect(after.camX).toBe(0);
        });

        test('clearing a level scores a bonus', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                fuel = 60;
                score = 0;
                ship.x = LEVEL_LEN + 5;
                step(1 / 60);
                return score;
            });
            expect(after).toBe(500 + 60 * 5);
        });

        test('a new level refills the tank and rebuilds the canyon', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                const before = terrain.map((c) => c.ground).join(',');
                fuel = 30;
                ship.x = LEVEL_LEN + 5;
                step(1 / 60);
                return { fuel, changed: terrain.map((c) => c.ground).join(',') !== before };
            });
            expect(after.fuel).toBe(100);
            expect(after.changed).toBe(true);
        });

        test('a new level clears leftover shots', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                fire();
                dropBomb();
                ship.x = LEVEL_LEN + 5;
                step(1 / 60);
                return bullets.length + bombs.length;
            });
            expect(after).toBe(0);
        });

        test('the HUD level counter updates', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                fuelDrainEnabled = false;
                ship.x = LEVEL_LEN + 5;
                step(1 / 60);
            });
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the canyon freezes while paused', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            const still = await page.evaluate(() => {
                const x = camX;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return camX === x;
            });
            expect(still).toBe(true);
        });

        test('the pause overlay is shown', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });

        test('pausing cannot resurrect a finished game', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                lives = 1;
                crash();
                togglePause();
                return state;
            });
            expect(after).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // HUD and rendering
    // -----------------------------------------------------------------------
    test.describe('HUD and rendering', () => {
        test('the score readout follows the score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                step(0);
            });
            await expect(page.locator('#score')).toHaveText('1234');
        });

        test('the lives readout follows the lives', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                crash();
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the canvas is actually painted', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const ctx = document.getElementById('canvas').getContext('2d');
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4 * 97) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(painted).toBeGreaterThan(2);
        });

        test('restarting after game over begins a fresh run', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 700;
                lives = 1;
                crash();
            });
            await page.keyboard.press(' ');
            const after = await page.evaluate(() => ({ state, score, lives }));
            expect(after).toEqual({ state: 'running', score: 0, lives: 3 });
        });
    });
});
