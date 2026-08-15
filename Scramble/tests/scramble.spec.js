const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so every held key is confirmed against the game state before the
// simulation is advanced. Without this the specs race the real animation loop.
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

// Start a run with rocket launching switched off and the animation loop
// detached, so the spec owns the clock and long simulations stay deterministic.
// Specs that are about rockets leave launching on; one spec leaves the loop on
// to prove it really drives the game.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        launchEnabled = false;
        autoRun = false;
    });

// Same, but with rockets live.
const startArmed = (page) =>
    page.evaluate(() => {
        startGame();
        autoRun = false;
        rockets.length = 0;
        tanks.length = 0;
    });

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
            await page.evaluate(() => window.localStorage.setItem('scramble-best', '6400'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('6400');
        });

        test('nothing is in flight before starting', async ({ page }) => {
            expect(await page.evaluate(() => bullets.length)).toBe(0);
            expect(await page.evaluate(() => bombs.length)).toBe(0);
            expect(await page.evaluate(() => explosions.length)).toBe(0);
        });

        test('step() does nothing while idle', async ({ page }) => {
            const before = await page.evaluate(() => ({ x: scrollX, fuel }));
            await advance(page, 60);
            const after = await page.evaluate(() => ({ x: scrollX, fuel }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Terrain generation
    // -----------------------------------------------------------------------
    test.describe('terrain', () => {
        test('the level is a full grid of columns', async ({ page }) => {
            expect(await page.evaluate(() => groundH.length)).toBe(
                await page.evaluate(() => LEVEL_COLUMNS)
            );
            expect(await page.evaluate(() => ceilH.length)).toBe(
                await page.evaluate(() => LEVEL_COLUMNS)
            );
            expect(await page.evaluate(() => WORLD_W)).toBe(
                await page.evaluate(() => LEVEL_COLUMNS * COLUMN_W)
            );
        });

        test('the world is wider than the window', async ({ page }) => {
            expect(await page.evaluate(() => WORLD_W)).toBeGreaterThan(
                await page.evaluate(() => CANVAS_W)
            );
        });

        test('every column leaves a flyable corridor', async ({ page }) => {
            const worst = await page.evaluate(() => {
                let min = Infinity;
                for (let c = 0; c < LEVEL_COLUMNS; c++) {
                    min = Math.min(min, CANVAS_H - groundH[c] - ceilH[c]);
                }
                return min;
            });
            expect(worst).toBeGreaterThanOrEqual(await page.evaluate(() => MIN_GAP));
        });

        test('the ground never leaves the canvas', async ({ page }) => {
            expect(
                await page.evaluate(() => groundH.every((h) => h > 0 && h < CANVAS_H))
            ).toBe(true);
        });

        test('the first two sections are open sky', async ({ page }) => {
            expect(
                await page.evaluate(() =>
                    ceilH.slice(0, 2 * SECTION_COLUMNS).every((h) => h === 0)
                )
            ).toBe(true);
        });

        test('the cave section has a ceiling', async ({ page }) => {
            expect(
                await page.evaluate(() =>
                    ceilH
                        .slice(2 * SECTION_COLUMNS, 3 * SECTION_COLUMNS)
                        .some((h) => h > 0)
                )
            ).toBe(true);
        });

        test('the start of the level is flat and clear', async ({ page }) => {
            const start = await page.evaluate(() => groundH.slice(0, 6));
            expect(new Set(start).size).toBe(1);
            expect(await page.evaluate(() => ceilH.slice(0, 6).every((h) => h === 0))).toBe(true);
        });

        test('the run-in to the base is clear of ceiling', async ({ page }) => {
            expect(
                await page.evaluate(() =>
                    ceilH.slice(LEVEL_COLUMNS - BASE_COLUMNS).every((h) => h === 0)
                )
            ).toBe(true);
        });

        test('a level is reproducible from its number', async ({ page }) => {
            const same = await page.evaluate(() => {
                buildLevel(1);
                const a = groundH.join(',');
                buildLevel(2);
                buildLevel(1);
                return a === groundH.join(',');
            });
            expect(same).toBe(true);
        });

        test('different levels have different terrain', async ({ page }) => {
            const differs = await page.evaluate(() => {
                buildLevel(1);
                const a = groundH.join(',');
                buildLevel(2);
                return a !== groundH.join(',');
            });
            expect(differs).toBe(true);
        });

        test('there are fuel dumps and rockets to shoot', async ({ page }) => {
            expect(await page.evaluate(() => tanks.length)).toBeGreaterThan(4);
            expect(await page.evaluate(() => rockets.length)).toBeGreaterThan(4);
        });

        test('targets sit on the ground', async ({ page }) => {
            expect(
                await page.evaluate(() =>
                    [...tanks, ...rockets].every(
                        (t) => Math.abs(t.y + t.h - groundYAt(t.x + t.w / 2)) < 1
                    )
                )
            ).toBe(true);
        });

        test('there is a base at the end of the level', async ({ page }) => {
            const b = await page.evaluate(() => ({ x: base.x, alive: base.alive }));
            expect(b.alive).toBe(true);
            expect(b.x).toBeGreaterThan(
                await page.evaluate(() => WORLD_W - BASE_COLUMNS * COLUMN_W * 2)
            );
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the ship starts at the left of an unscrolled world with full fuel', async ({
            page,
        }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => scrollX)).toBe(0);
            expect(await page.evaluate(() => fuel)).toBe(await page.evaluate(() => FUEL_MAX));
            expect(await page.evaluate(() => screenX(ship.x))).toBeLessThan(
                await page.evaluate(() => CANVAS_W / 3)
            );
        });

        test('the ship starts inside the corridor', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => hitsTerrain(ship.x, ship.y, SHIP_HW, SHIP_HH))).toBe(
                false
            );
        });
    });

    // -----------------------------------------------------------------------
    // Flying
    // -----------------------------------------------------------------------
    test.describe('flying', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the world scrolls forward on its own', async ({ page }) => {
            await advance(page, 60);
            expect(await page.evaluate(() => scrollX)).toBeCloseTo(
                await page.evaluate(() => scrollSpeed()),
                0
            );
        });

        test('the ship carries along with the scroll', async ({ page }) => {
            const before = await page.evaluate(() => screenX(ship.x));
            await advance(page, 60);
            expect(await page.evaluate(() => screenX(ship.x))).toBeCloseTo(before, 1);
        });

        test('holding up climbs', async ({ page }) => {
            const before = await page.evaluate(() => ship.y);
            await hold(page, 'ArrowUp');
            await advance(page, 20);
            expect(await page.evaluate(() => ship.y)).toBeLessThan(before);
        });

        test('holding down dives', async ({ page }) => {
            const before = await page.evaluate(() => ship.y);
            await hold(page, 'ArrowDown');
            await advance(page, 20);
            expect(await page.evaluate(() => ship.y)).toBeGreaterThan(before);
        });

        test('holding right pushes forward in the window', async ({ page }) => {
            const before = await page.evaluate(() => screenX(ship.x));
            await hold(page, 'ArrowRight');
            await advance(page, 20);
            expect(await page.evaluate(() => screenX(ship.x))).toBeGreaterThan(before);
        });

        test('holding left hangs back in the window', async ({ page }) => {
            const before = await page.evaluate(() => screenX(ship.x));
            await hold(page, 'ArrowLeft');
            await advance(page, 20);
            expect(await page.evaluate(() => screenX(ship.x))).toBeLessThan(before);
        });

        test('W A S D also steer the ship', async ({ page }) => {
            const before = await page.evaluate(() => ship.y);
            await hold(page, 'w');
            await advance(page, 20);
            expect(await page.evaluate(() => ship.y)).toBeLessThan(before);
            await release(page, 'w');
            await hold(page, 's');
            await advance(page, 40);
            expect(await page.evaluate(() => ship.y)).toBeGreaterThan(before);
        });

        test('the ship cannot climb off the top of the screen', async ({ page }) => {
            await hold(page, 'ArrowUp');
            await advance(page, 180);
            expect(await page.evaluate(() => ship.y)).toBe(await page.evaluate(() => SHIP_MIN_Y));
        });

        test('the ship cannot be pushed out of the front of the window', async ({ page }) => {
            await hold(page, 'ArrowRight');
            await advance(page, 240);
            expect(await page.evaluate(() => screenX(ship.x))).toBeCloseTo(
                await page.evaluate(() => SHIP_MAX_SX),
                1
            );
        });

        test('the ship cannot drop out of the back of the window', async ({ page }) => {
            await hold(page, 'ArrowLeft');
            await advance(page, 240);
            expect(await page.evaluate(() => screenX(ship.x))).toBeCloseTo(
                await page.evaluate(() => SHIP_MIN_SX),
                1
            );
        });
    });

    // -----------------------------------------------------------------------
    // Laser
    // -----------------------------------------------------------------------
    test.describe('laser', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space fires a bullet', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => bullets.length === 1);
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('the bullet leaves the nose of the ship', async ({ page }) => {
            await page.evaluate(() => fireLaser());
            const b = await page.evaluate(() => ({ x: bullets[0].x, y: bullets[0].y }));
            const s = await page.evaluate(() => ({ x: ship.x, y: ship.y }));
            expect(b.x).toBeGreaterThan(s.x);
            expect(Math.abs(b.y - s.y)).toBeLessThan(6);
        });

        test('the bullet flies forward', async ({ page }) => {
            await page.evaluate(() => fireLaser());
            const before = await page.evaluate(() => bullets[0].x);
            await advance(page, 10);
            expect(await page.evaluate(() => bullets[0].x)).toBeGreaterThan(before);
        });

        test('the laser has a cooldown', async ({ page }) => {
            await page.evaluate(() => {
                fireLaser();
                fireLaser();
            });
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('the laser can fire again once the cooldown expires', async ({ page }) => {
            await page.evaluate(() => fireLaser());
            await advance(page, 20);
            await page.evaluate(() => fireLaser());
            expect(await page.evaluate(() => bullets.length)).toBe(2);
        });

        test('only a few bullets can be in flight at once', async ({ page }) => {
            const most = await page.evaluate(() => {
                let peak = 0;
                for (let i = 0; i < 200; i++) {
                    fireLaser();
                    step(1 / 60);
                    peak = Math.max(peak, bullets.length);
                }
                return peak;
            });
            expect(most).toBeLessThanOrEqual(await page.evaluate(() => MAX_BULLETS));
        });

        test('a bullet that leaves the window is dropped', async ({ page }) => {
            await page.evaluate(() => {
                placeShip(scrollX + SHIP_MIN_SX, SHIP_MIN_Y + 20);
                fireLaser();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a bullet is stopped by the terrain', async ({ page }) => {
            await page.evaluate(() => {
                bullets.push({ x: ship.x + 40, y: groundYAt(ship.x + 40) + 10 });
            });
            await advance(page, 1);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('the laser destroys a rocket for points', async ({ page }) => {
            const gained = await page.evaluate(() => {
                const before = score;
                clearTargetsForTest();
                // A frozen, airborne rocket at the ship's altitude: the shot is
                // what is under test, not the flight path down to the ground.
                const r = spawnRocket(ship.x + 120);
                r.frozen = true;
                r.y = ship.y - r.h / 2;
                fireLaser();
                for (let i = 0; i < 40; i++) step(1 / 60);
                return { gained: score - before, alive: r.alive };
            });
            expect(gained.alive).toBe(false);
            expect(gained.gained).toBe(await page.evaluate(() => ROCKET_LASER_POINTS));
        });

        test('the bullet is spent on the target it destroys', async ({ page }) => {
            await page.evaluate(() => {
                clearTargetsForTest();
                const r = spawnRocket(ship.x + 120);
                r.frozen = true;
                r.y = ship.y - r.h / 2;
                fireLaser();
            });
            await advance(page, 40);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('the laser destroys a fuel dump and refuels the ship', async ({ page }) => {
            const after = await page.evaluate(() => {
                clearTargetsForTest();
                fuel = 50;
                const t = spawnTank(ship.x + 120);
                t.y = ship.y - t.h / 2;
                fireLaser();
                for (let i = 0; i < 40; i++) step(1 / 60);
                return { fuel, alive: t.alive };
            });
            expect(after.alive).toBe(false);
            expect(after.fuel).toBeGreaterThan(50);
        });

        test('the laser cannot be fired while not running', async ({ page }) => {
            await page.evaluate(() => {
                togglePause();
                fireLaser();
            });
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Bombs
    // -----------------------------------------------------------------------
    test.describe('bombs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('B drops a bomb', async ({ page }) => {
            await page.keyboard.press('b');
            await page.waitForFunction(() => bombs.length === 1);
            expect(await page.evaluate(() => bombs.length)).toBe(1);
        });

        test('the bomb starts under the ship', async ({ page }) => {
            await page.evaluate(() => dropBomb());
            const b = await page.evaluate(() => ({ x: bombs[0].x, y: bombs[0].y }));
            const s = await page.evaluate(() => ({ x: ship.x, y: ship.y }));
            expect(b.y).toBeGreaterThan(s.y);
            expect(Math.abs(b.x - s.x)).toBeLessThan(12);
        });

        test('the bomb falls faster the longer it falls', async ({ page }) => {
            await page.evaluate(() => {
                placeShip(ship.x, SHIP_MIN_Y + 10);
                dropBomb();
            });
            const first = await page.evaluate(() => {
                const y0 = bombs[0].y;
                for (let i = 0; i < 10; i++) step(1 / 60);
                return bombs[0].y - y0;
            });
            const second = await page.evaluate(() => {
                const y0 = bombs[0].y;
                for (let i = 0; i < 10; i++) step(1 / 60);
                return bombs[0].y - y0;
            });
            expect(second).toBeGreaterThan(first);
        });

        test('the bomb carries the ship forward momentum', async ({ page }) => {
            await page.evaluate(() => {
                placeShip(ship.x, SHIP_MIN_Y + 10);
                dropBomb();
            });
            const before = await page.evaluate(() => bombs[0].x);
            await advance(page, 10);
            expect(await page.evaluate(() => bombs[0].x)).toBeGreaterThan(before);
        });

        test('the bomb explodes on the ground', async ({ page }) => {
            await page.evaluate(() => {
                placeShip(ship.x, SHIP_MIN_Y + 10);
                dropBomb();
            });
            // Long enough for the bomb to reach the ground, short enough that
            // the explosion it leaves has not faded yet.
            await advance(page, 75);
            expect(await page.evaluate(() => bombs.length)).toBe(0);
            expect(await page.evaluate(() => explosions.length)).toBeGreaterThan(0);
        });

        test('explosions fade away', async ({ page }) => {
            await page.evaluate(() => {
                placeShip(ship.x, SHIP_MIN_Y + 10);
                dropBomb();
            });
            await advance(page, 240);
            expect(await page.evaluate(() => explosions.length)).toBe(0);
        });

        test('the bomb has a cooldown', async ({ page }) => {
            await page.evaluate(() => {
                dropBomb();
                dropBomb();
            });
            expect(await page.evaluate(() => bombs.length)).toBe(1);
        });

        test('only a few bombs can be in flight at once', async ({ page }) => {
            const most = await page.evaluate(() => {
                placeShip(ship.x, SHIP_MIN_Y + 10);
                let peak = 0;
                for (let i = 0; i < 200; i++) {
                    dropBomb();
                    step(1 / 60);
                    peak = Math.max(peak, bombs.length);
                }
                return peak;
            });
            expect(most).toBeLessThanOrEqual(await page.evaluate(() => MAX_BOMBS));
        });

        test('a bomb destroys a fuel dump for points and fuel', async ({ page }) => {
            const after = await page.evaluate(() => {
                clearTargetsForTest();
                fuel = 40;
                const before = score;
                const t = spawnTank(ship.x + 200);
                placeShip(ship.x, SHIP_MIN_Y + 10);
                bombs.push({ x: t.x + t.w / 2, y: t.y - 4, vx: 0, vy: 60 });
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { fuel, alive: t.alive, gained: score - before };
            });
            expect(after.alive).toBe(false);
            expect(after.fuel).toBeGreaterThan(40);
            expect(after.gained).toBe(await page.evaluate(() => TANK_POINTS));
        });

        test('a bomb is worth more than a laser against a rocket', async ({ page }) => {
            expect(await page.evaluate(() => ROCKET_BOMB_POINTS)).toBeGreaterThan(
                await page.evaluate(() => ROCKET_LASER_POINTS)
            );
            const gained = await page.evaluate(() => {
                clearTargetsForTest();
                const before = score;
                const r = spawnRocket(ship.x + 200);
                bombs.push({ x: r.x + r.w / 2, y: r.y - 4, vx: 0, vy: 60 });
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { gained: score - before, alive: r.alive };
            });
            expect(gained.alive).toBe(false);
            expect(gained.gained).toBe(await page.evaluate(() => ROCKET_BOMB_POINTS));
        });

        test('the blast reaches targets next to the impact', async ({ page }) => {
            const alive = await page.evaluate(() => {
                clearTargetsForTest();
                const t = spawnTank(ship.x + 300);
                const r = spawnRocket(t.x + t.w + 6);
                bombs.push({ x: t.x + t.w / 2, y: t.y - 4, vx: 0, vy: 60 });
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { tank: t.alive, rocket: r.alive };
            });
            expect(alive.tank).toBe(false);
            expect(alive.rocket).toBe(false);
        });

        test('the blast does not reach clear across the map', async ({ page }) => {
            const alive = await page.evaluate(() => {
                clearTargetsForTest();
                const t = spawnTank(ship.x + 300);
                const far = spawnTank(t.x + 400);
                bombs.push({ x: t.x + t.w / 2, y: t.y - 4, vx: 0, vy: 60 });
                for (let i = 0; i < 30; i++) step(1 / 60);
                return far.alive;
            });
            expect(alive).toBe(true);
        });

        test('bombing the base is worth a bonus', async ({ page }) => {
            const gained = await page.evaluate(() => {
                clearTargetsForTest();
                const before = score;
                bombs.push({ x: base.x + base.w / 2, y: base.y - 4, vx: 0, vy: 60 });
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { gained: score - before, alive: base.alive };
            });
            expect(gained.alive).toBe(false);
            expect(gained.gained).toBe(await page.evaluate(() => BASE_POINTS));
        });

        test('a bomb cannot be dropped while not running', async ({ page }) => {
            await page.evaluate(() => {
                togglePause();
                dropBomb();
            });
            expect(await page.evaluate(() => bombs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('fuel drains as you fly', async ({ page }) => {
            await advance(page, 60);
            const left = await page.evaluate(() => fuel);
            expect(left).toBeLessThan(await page.evaluate(() => FUEL_MAX));
            expect(left).toBeCloseTo(
                (await page.evaluate(() => FUEL_MAX)) - (await page.evaluate(() => FUEL_DRAIN)),
                1
            );
        });

        test('the HUD shows the fuel remaining', async ({ page }) => {
            await page.evaluate(() => {
                fuel = 42;
                updateHud();
            });
            await expect(page.locator('#fuel')).toHaveText('42');
        });

        test('a fuel dump tops the tank back up', async ({ page }) => {
            const after = await page.evaluate(() => {
                clearTargetsForTest();
                fuel = 20;
                const t = spawnTank(ship.x + 200);
                bombs.push({ x: t.x + t.w / 2, y: t.y - 4, vx: 0, vy: 60 });
                for (let i = 0; i < 30; i++) step(1 / 60);
                return fuel;
            });
            // The tank pays out while fuel is still draining, so this checks
            // most of a dump's worth arrived rather than an exact figure.
            expect(after).toBeGreaterThan(30);
        });

        test('fuel never goes over the maximum', async ({ page }) => {
            const after = await page.evaluate(() => {
                clearTargetsForTest();
                const t = spawnTank(ship.x + 200);
                bombs.push({ x: t.x + t.w / 2, y: t.y - 4, vx: 0, vy: 60 });
                for (let i = 0; i < 30; i++) step(1 / 60);
                return fuel;
            });
            expect(after).toBeLessThanOrEqual(await page.evaluate(() => FUEL_MAX));
        });

        test('running out of fuel crashes the ship', async ({ page }) => {
            await page.evaluate(() => {
                fuel = 0.01;
            });
            await advance(page, 3);
            expect(await page.evaluate(() => fuel)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('dying');
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('invulnerability does not save you from an empty tank', async ({ page }) => {
            await page.evaluate(() => {
                ship.invuln = 99;
                fuel = 0.01;
            });
            await advance(page, 3);
            expect(await page.evaluate(() => state)).toBe('dying');
        });
    });

    // -----------------------------------------------------------------------
    // Rockets
    // -----------------------------------------------------------------------
    test.describe('rockets', () => {
        test('a rocket launches when the ship comes near', async ({ page }) => {
            await startArmed(page);
            await page.evaluate(() => spawnRocket(ship.x + 60));
            await advance(page, 5);
            expect(await page.evaluate(() => rockets[0].launched)).toBe(true);
        });

        test('a rocket stays put while the ship is far away', async ({ page }) => {
            await startArmed(page);
            await page.evaluate(() => spawnRocket(ship.x + 3 * LAUNCH_RANGE));
            await advance(page, 5);
            expect(await page.evaluate(() => rockets[0].launched)).toBe(false);
        });

        test('a launched rocket climbs', async ({ page }) => {
            await startArmed(page);
            const climbed = await page.evaluate(() => {
                const r = spawnRocket(ship.x + 60);
                const y0 = r.y;
                for (let i = 0; i < 20; i++) step(1 / 60);
                return y0 - r.y;
            });
            expect(climbed).toBeGreaterThan(0);
        });

        test('rockets fly faster at higher levels', async ({ page }) => {
            const slow = await page.evaluate(() => rocketSpeed());
            const fast = await page.evaluate(() => {
                level = 5;
                return rocketSpeed();
            });
            expect(fast).toBeGreaterThan(slow);
        });

        test('rockets are denser at higher levels', async ({ page }) => {
            const l1 = await page.evaluate(() => {
                buildLevel(1);
                return rockets.length;
            });
            const l6 = await page.evaluate(() => {
                buildLevel(6);
                return rockets.length;
            });
            expect(l6).toBeGreaterThan(l1);
        });

        test('a rocket that flies off the top is dropped', async ({ page }) => {
            await startArmed(page);
            await page.evaluate(() => spawnRocket(ship.x + 60));
            await advance(page, 600);
            expect(await page.evaluate(() => rockets.length)).toBe(0);
        });

        test('flying into a rocket costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const r = spawnRocket(ship.x + 200);
                placeShip(r.x + r.w / 2, r.y + r.h / 2);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('flying into a fuel dump costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const t = spawnTank(ship.x + 200);
                placeShip(t.x + t.w / 2, t.y + t.h / 2);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Crashing, checkpoints and lives
    // -----------------------------------------------------------------------
    test.describe('crashing', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('flying into the ground costs a life', async ({ page }) => {
            await page.evaluate(() => placeShip(ship.x, groundYAt(ship.x) - 1));
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('dying');
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('flying into the cave roof costs a life', async ({ page }) => {
            await page.evaluate(() => {
                scrollX = 2.5 * SECTION_COLUMNS * COLUMN_W;
                let c = 0;
                while (ceilH[colAt(scrollX + 100)] === 0 && c++ < LEVEL_COLUMNS) scrollX += COLUMN_W;
                placeShip(scrollX + 100, ceilingYAt(scrollX + 100) + 1);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('dying');
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a crash makes an explosion', async ({ page }) => {
            await page.evaluate(() => placeShip(ship.x, groundYAt(ship.x) - 1));
            await advance(page, 2);
            expect(await page.evaluate(() => explosions.length)).toBeGreaterThan(0);
        });

        test('the ship comes back after a crash', async ({ page }) => {
            await page.evaluate(() => placeShip(ship.x, groundYAt(ship.x) - 1));
            await advance(page, 120);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => fuel)).toBeGreaterThan(
                (await page.evaluate(() => FUEL_MAX)) - 10
            );
            expect(await page.evaluate(() => hitsTerrain(ship.x, ship.y, SHIP_HW, SHIP_HH))).toBe(
                false
            );
        });

        test('the ship comes back briefly invulnerable', async ({ page }) => {
            await page.evaluate(() => placeShip(ship.x, groundYAt(ship.x) - 1));
            await advance(page, 120);
            expect(await page.evaluate(() => ship.invuln)).toBeGreaterThan(0);
        });

        test('a crash restarts the current section', async ({ page }) => {
            await page.evaluate(() => {
                scrollX = 2 * SECTION_COLUMNS * COLUMN_W + 300;
                ship.invuln = 0;
                placeShip(scrollX + 100, groundYAt(scrollX + 100) - 1);
            });
            await advance(page, 120);
            // The world starts scrolling again the moment the ship is back, so
            // this checks it resumed from the section mouth, not the crash site.
            const after = await page.evaluate(() => scrollX);
            expect(after).toBeGreaterThanOrEqual(await page.evaluate(() => 2 * SECTION_W));
            expect(after).toBeLessThan(await page.evaluate(() => 2 * SECTION_W + 200));
        });

        test('the shots and rockets in the air are cleared', async ({ page }) => {
            await page.evaluate(() => {
                fireLaser();
                dropBomb();
                placeShip(ship.x, groundYAt(ship.x) - 1);
            });
            await advance(page, 120);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
            expect(await page.evaluate(() => bombs.length)).toBe(0);
        });

        test('targets ahead of the checkpoint are restored', async ({ page }) => {
            const restored = await page.evaluate(() => {
                const t = tanks.find((k) => k.x > 2 * SECTION_COLUMNS * COLUMN_W);
                t.alive = false;
                placeShip(ship.x, groundYAt(ship.x) - 1);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return t.alive;
            });
            expect(restored).toBe(true);
        });

        test('the score survives a crash', async ({ page }) => {
            await page.evaluate(() => {
                score = 640;
                placeShip(ship.x, groundYAt(ship.x) - 1);
            });
            await advance(page, 120);
            expect(await page.evaluate(() => score)).toBe(640);
        });

        test('an invulnerable ship flies through everything', async ({ page }) => {
            await page.evaluate(() => {
                ship.invuln = 99;
                placeShip(ship.x, groundYAt(ship.x) - 1);
            });
            await advance(page, 10);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                placeShip(ship.x, groundYAt(ship.x) - 1);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(0);
            await advance(page, 120);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('the game over panel reports the score', async ({ page }) => {
            await page.evaluate(() => {
                score = 1500;
                lives = 1;
                placeShip(ship.x, groundYAt(ship.x) - 1);
            });
            await advance(page, 130);
            await expect(page.locator('#overlay-score')).toContainText('1500');
        });
    });

    // -----------------------------------------------------------------------
    // Level flow
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('reaching the end of the world clears the level', async ({ page }) => {
            await page.evaluate(() => {
                ship.invuln = 999;
                scrollX = WORLD_W - CANVAS_W - 2;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('clearing a level pays a bonus', async ({ page }) => {
            const gained = await page.evaluate(() => {
                const before = score;
                ship.invuln = 999;
                scrollX = WORLD_W - CANVAS_W - 2;
                for (let i = 0; i < 10; i++) step(1 / 60);
                return score - before;
            });
            expect(gained).toBe(await page.evaluate(() => LEVEL_BONUS * 1));
        });

        test('the next level starts fresh', async ({ page }) => {
            await page.evaluate(() => {
                ship.invuln = 999;
                fuel = 12;
                scrollX = WORLD_W - CANVAS_W - 2;
            });
            await advance(page, 200);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => scrollX)).toBeLessThan(200);
            expect(await page.evaluate(() => fuel)).toBeGreaterThan(
                (await page.evaluate(() => FUEL_MAX)) - 20
            );
        });

        test('the score carries into the next level', async ({ page }) => {
            await page.evaluate(() => {
                score = 2000;
                ship.invuln = 999;
                scrollX = WORLD_W - CANVAS_W - 2;
            });
            await advance(page, 200);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(2000);
        });

        test('the world scrolls faster each level', async ({ page }) => {
            const l1 = await page.evaluate(() => scrollSpeed());
            await page.evaluate(() => {
                level = 4;
            });
            expect(await page.evaluate(() => scrollSpeed())).toBeGreaterThan(l1);
        });

        test('the scroll speed is capped', async ({ page }) => {
            await page.evaluate(() => {
                level = 99;
            });
            expect(await page.evaluate(() => scrollSpeed())).toBe(
                await page.evaluate(() => SCROLL_MAX)
            );
        });

        test('the level after a clear is a different world', async ({ page }) => {
            const differs = await page.evaluate(() => {
                const a = groundH.join(',');
                ship.invuln = 999;
                scrollX = WORLD_W - CANVAS_W - 2;
                for (let i = 0; i < 200; i++) step(1 / 60);
                return a !== groundH.join(',');
            });
            expect(differs).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => togglePause());
            const before = await page.evaluate(() => ({ x: scrollX, f: fuel }));
            await advance(page, 60);
            const after = await page.evaluate(() => ({ x: scrollX, f: fuel }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('a new best is stored on game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 8800;
                lives = 1;
                placeShip(ship.x, groundYAt(ship.x) - 1);
            });
            await advance(page, 130);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#best')).toHaveText('8800');
            expect(await page.evaluate(() => window.localStorage.getItem('scramble-best'))).toBe(
                '8800'
            );
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('scramble-best', '12000'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 30;
                lives = 1;
                placeShip(ship.x, groundYAt(ship.x) - 1);
            });
            await advance(page, 130);
            await expect(page.locator('#best')).toHaveText('12000');
        });

        test('restarting after game over resets the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 500;
                level = 3;
                lives = 1;
                placeShip(ship.x, groundYAt(ship.x) - 1);
            });
            await advance(page, 130);
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => scrollX)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Animation loop
    // -----------------------------------------------------------------------
    test.describe('animation loop', () => {
        test('the loop drives the game with no help from the spec', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            const before = await page.evaluate(() => scrollX);
            await page.waitForFunction((x) => scrollX > x + 20, before);
            expect(await page.evaluate(() => fuel)).toBeLessThan(
                await page.evaluate(() => FUEL_MAX)
            );
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 30);
            const painted = await page.evaluate(() => {
                draw();
                const d = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i] > 20 || d[i + 1] > 20 || d[i + 2] > 20) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the cave section paints a ceiling', async ({ page }) => {
            await startQuiet(page);
            const roofPixels = await page.evaluate(() => {
                scrollX = 2.5 * SECTION_COLUMNS * COLUMN_W;
                let c = 0;
                while (ceilH[colAt(scrollX + 320)] < 20 && c++ < LEVEL_COLUMNS) scrollX += COLUMN_W;
                placeShip(scrollX + 100, corridorMidY(scrollX + 100));
                draw();
                const d = ctx.getImageData(320, 2, 1, 20).data;
                let lit = 0;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i] > 20 || d[i + 1] > 20 || d[i + 2] > 20) lit++;
                }
                return lit;
            });
            expect(roofPixels).toBeGreaterThan(0);
        });

        test('drawing works in every state without throwing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                draw(); // idle
                startGame();
                launchEnabled = false;
                fireLaser();
                dropBomb();
                spawnRocket(ship.x + 100).launched = true;
                for (let i = 0; i < 60; i++) step(1 / 60);
                draw(); // running
                togglePause();
                draw(); // paused
                togglePause();
                placeShip(ship.x, groundYAt(ship.x) - 1);
                step(1 / 60);
                draw(); // dying
                for (let i = 0; i < 120; i++) step(1 / 60);
                draw(); // respawned
                ship.invuln = 999;
                scrollX = WORLD_W - CANVAS_W - 2;
                step(1 / 60);
                draw(); // level clear
                for (let i = 0; i < 200; i++) step(1 / 60);
                draw(); // next level
                lives = 1;
                ship.invuln = 0;
                placeShip(ship.x, groundYAt(ship.x) - 1);
                for (let i = 0; i < 130; i++) step(1 / 60);
                draw(); // game over
            });
            expect(errors).toEqual([]);
        });
    });
});
