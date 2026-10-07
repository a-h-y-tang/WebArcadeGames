const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// A marker parked far beyond the view so an emptied level never counts itself
// complete in the middle of a test.
const FAR_MARKER = { kind: 'tank', x: 20, z: 100000 };

// Start a run and freeze the animation loop, so a test can place exactly the
// obstacle it cares about and step the simulation one fixed tick at a time.
async function startFrozen(page) {
    await page.evaluate((marker) => {
        startGame();
        autoRun = false;
        objects.length = 0;
        objects.push(makeObject(marker));
    }, FAR_MARKER);
}

// Start a run without touching the level layout (for tests about the layout).
async function startLevel(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
    });
}

// Replace the world with the given objects, keeping the far marker.
async function setObjects(page, specs) {
    await page.evaluate(([list, marker]) => {
        objects.length = 0;
        list.forEach((o) => objects.push(makeObject(o)));
        objects.push(makeObject(marker));
    }, [specs, FAR_MARKER]);
}

// Put the ship at a known spot.
async function placeShip(page, x, alt) {
    await page.evaluate(([sx, salt]) => {
        ship.x = sx;
        ship.alt = salt;
    }, [x, alt]);
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(1 / 120);
    }, steps);
}

// Hold a key down inside the simulation (bypasses real key events).
async function hold(page, code, down = true) {
    await page.evaluate(([c, d]) => {
        keys[c] = d;
    }, [code, down]);
}

// Clear the invulnerability window a fresh start/crash leaves behind.
async function clearInvuln(page) {
    await page.evaluate(() => {
        invuln = 0;
    });
}

// Count the objects that are still real obstacles (ignores the far marker,
// which the scroll drags along with everything else).
function liveCount(page) {
    return page.evaluate((marker) => objects.filter((o) => o.z < marker.z / 2).length, FAR_MARKER);
}

test.describe('Zaxxon', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Zaxxon', async ({ page }) => {
            await expect(page).toHaveTitle('Zaxxon');
        });

        test('canvas is 480x640', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '640');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#fuel')).toHaveText('100');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the world is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => objects.length)).toBe(0);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
            expect(await page.evaluate(() => enemyShots.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('zaxxon-best', '48200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('48200');
        });

        test('the help legend explains climbing and firing', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/climb|altitude/i);
            await expect(page.locator('.help')).toContainText(/fire/i);
        });
    });

    // -----------------------------------------------------------------------
    // Projection
    // -----------------------------------------------------------------------
    test.describe('projection', () => {
        test('the near left corner of the deck sits at the projection origin', async ({ page }) => {
            const p = await page.evaluate(() => proj(0, 0, 0));
            expect(p.sx).toBeCloseTo(40, 5);
            expect(p.sy).toBeCloseTo(560, 5);
        });

        test('depth pushes a point up and to the right', async ({ page }) => {
            const [near, far] = await page.evaluate(() => [proj(100, 0, 0), proj(100, 0, 300)]);
            expect(far.sx).toBeGreaterThan(near.sx);
            expect(far.sy).toBeLessThan(near.sy);
        });

        test('altitude pushes a point straight up', async ({ page }) => {
            const [low, high] = await page.evaluate(() => [proj(100, 0, 120), proj(100, 60, 120)]);
            expect(high.sx).toBeCloseTo(low.sx, 5);
            expect(high.sy).toBeLessThan(low.sy);
        });

        test('the whole playable volume projects inside the canvas', async ({ page }) => {
            const inside = await page.evaluate(() => {
                for (let x = 0; x <= FIELD_W; x += 10) {
                    for (let a = 0; a <= MAX_ALT; a += 10) {
                        for (let z = 0; z <= VIEW_DEPTH; z += 20) {
                            const p = proj(x, a, z);
                            if (p.sx < 0 || p.sx > W || p.sy < 0 || p.sy > H) return false;
                        }
                    }
                }
                return true;
            });
            expect(inside).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the ship starts centred at mid altitude', async ({ page }) => {
            await startLevel(page);
            const s = await page.evaluate(() => ({ x: ship.x, alt: ship.alt }));
            expect(s.x).toBeCloseTo(100, 5);
            expect(s.alt).toBeGreaterThan(0);
            expect(s.alt).toBeLessThan(90);
        });

        test('level 1 builds a fortress to fly over', async ({ page }) => {
            await startLevel(page);
            expect(await page.evaluate(() => objects.length)).toBeGreaterThan(10);
        });

        test('every level is a fixed layout, not a random one', async ({ page }) => {
            const same = await page.evaluate(() =>
                JSON.stringify(buildLevel(1).map((o) => [o.kind, o.x, o.z])) ===
                JSON.stringify(buildLevel(1).map((o) => [o.kind, o.x, o.z]))
            );
            expect(same).toBe(true);
        });

        test('every object sits on the deck and ahead of the ship', async ({ page }) => {
            const ok = await page.evaluate(() =>
                [1, 2, 3, 4].every((n) =>
                    buildLevel(n).every((o) => o.z > 0 && o.x >= 0 && o.x <= FIELD_W)
                )
            );
            expect(ok).toBe(true);
        });

        test('objects are ordered far to near', async ({ page }) => {
            await startLevel(page);
            const sorted = await page.evaluate(() =>
                objects.every((o, i) => i === 0 || objects[i - 1].z >= o.z)
            );
            expect(sorted).toBe(true);
        });

        test('every level ends with a boss', async ({ page }) => {
            const ok = await page.evaluate(() =>
                [1, 2, 3, 4].every((n) => {
                    const level = buildLevel(n);
                    return level[level.length - 1].kind === 'boss';
                })
            );
            expect(ok).toBe(true);
        });

        test('each level carries fuel tanks, turrets, planes and walls', async ({ page }) => {
            const ok = await page.evaluate(() =>
                [1, 2, 3, 4].every((n) => {
                    const kinds = new Set(buildLevel(n).map((o) => o.kind));
                    return ['tank', 'turret', 'plane', 'wall'].every((k) => kinds.has(k));
                })
            );
            expect(ok).toBe(true);
        });

        test('every wall opening is big enough for the ship to fit through', async ({ page }) => {
            const ok = await page.evaluate(() =>
                [1, 2, 3, 4].every((n) =>
                    buildLevel(n)
                        .filter((o) => o.kind === 'wall')
                        .every(
                            (o) =>
                                o.openX[1] - o.openX[0] >= 2 * SHIP_HALF + 20 &&
                                o.openAlt[1] - o.openAlt[0] >= 2 * SHIP_HALF + 20 &&
                                o.openX[0] >= 0 &&
                                o.openX[1] <= FIELD_W &&
                                o.openAlt[0] >= 0 &&
                                o.openAlt[1] <= MAX_ALT
                        )
                )
            );
            expect(ok).toBe(true);
        });

        test('a restart after game over clears the old score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                crash();
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Flying the ship
    // -----------------------------------------------------------------------
    test.describe('flying', () => {
        test('holding left moves the ship across the deck', async ({ page }) => {
            await startFrozen(page);
            await hold(page, 'ArrowLeft');
            await step(page, 60);
            expect(await page.evaluate(() => ship.x)).toBeLessThan(100);
        });

        test('holding right moves the ship the other way', async ({ page }) => {
            await startFrozen(page);
            await hold(page, 'ArrowRight');
            await step(page, 60);
            expect(await page.evaluate(() => ship.x)).toBeGreaterThan(100);
        });

        test('A and D fly the ship too', async ({ page }) => {
            await startFrozen(page);
            await hold(page, 'KeyA');
            await step(page, 30);
            const left = await page.evaluate(() => ship.x);
            expect(left).toBeLessThan(100);
            await hold(page, 'KeyA', false);
            await hold(page, 'KeyD');
            await step(page, 60);
            expect(await page.evaluate(() => ship.x)).toBeGreaterThan(left);
        });

        test('holding up climbs and holding down dives', async ({ page }) => {
            await startFrozen(page);
            await placeShip(page, 100, 40);
            await hold(page, 'ArrowUp');
            await step(page, 30);
            expect(await page.evaluate(() => ship.alt)).toBeGreaterThan(40);
            await hold(page, 'ArrowUp', false);
            await hold(page, 'ArrowDown');
            await step(page, 60);
            expect(await page.evaluate(() => ship.alt)).toBeLessThan(40);
        });

        test('W and S climb and dive too', async ({ page }) => {
            await startFrozen(page);
            await placeShip(page, 100, 40);
            await hold(page, 'KeyW');
            await step(page, 30);
            expect(await page.evaluate(() => ship.alt)).toBeGreaterThan(40);
            await hold(page, 'KeyW', false);
            await hold(page, 'KeyS');
            await step(page, 60);
            expect(await page.evaluate(() => ship.alt)).toBeLessThan(40);
        });

        test('the ship cannot leave the deck sideways', async ({ page }) => {
            await startFrozen(page);
            await hold(page, 'ArrowLeft');
            await step(page, 600);
            expect(await page.evaluate(() => ship.x)).toBeGreaterThanOrEqual(
                await page.evaluate(() => SHIP_HALF)
            );
            await hold(page, 'ArrowLeft', false);
            await hold(page, 'ArrowRight');
            await step(page, 1200);
            const [x, field, half] = await page.evaluate(() => [ship.x, FIELD_W, SHIP_HALF]);
            expect(x).toBeLessThanOrEqual(field - half);
        });

        test('altitude is clamped to the deck and the ceiling', async ({ page }) => {
            await startFrozen(page);
            await hold(page, 'ArrowDown');
            await step(page, 600);
            expect(await page.evaluate(() => ship.alt)).toBe(0);
            await hold(page, 'ArrowDown', false);
            await hold(page, 'ArrowUp');
            await step(page, 600);
            expect(await page.evaluate(() => ship.alt)).toBe(
                await page.evaluate(() => MAX_ALT)
            );
        });

        test('the ship holds its depth plane', async ({ page }) => {
            await startFrozen(page);
            await hold(page, 'ArrowUp');
            await step(page, 120);
            expect(await page.evaluate(() => ship.z || 0)).toBe(0);
        });

        test('the world scrolls toward the ship', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'tank', x: 60, z: 400 }]);
            await step(page, 120);
            const z = await page.evaluate(() => objects[0].z);
            expect(z).toBeLessThan(400);
            expect(z).toBeGreaterThan(200);
        });

        test('later levels scroll faster', async ({ page }) => {
            const speeds = await page.evaluate(() => [1, 2, 3, 4].map((n) => scrollSpeedFor(n)));
            expect(speeds[1]).toBeGreaterThan(speeds[0]);
            expect(speeds[3]).toBeGreaterThan(speeds[2]);
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test('a shot leaves the ship at the ship’s own position', async ({ page }) => {
            await startFrozen(page);
            await placeShip(page, 70, 55);
            await page.evaluate(() => fire());
            const b = await page.evaluate(() => bullets[0]);
            expect(b.x).toBeCloseTo(70, 5);
            expect(b.alt).toBeCloseTo(55, 5);
            expect(b.z).toBeGreaterThanOrEqual(0);
        });

        test('Space fires while running', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('a bullet flies away from the ship', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => fire());
            const before = await page.evaluate(() => bullets[0].z);
            await step(page, 30);
            expect(await page.evaluate(() => bullets[0].z)).toBeGreaterThan(before);
        });

        test('a bullet keeps the altitude it was fired at', async ({ page }) => {
            await startFrozen(page);
            await placeShip(page, 100, 62);
            await page.evaluate(() => fire());
            await step(page, 40);
            expect(await page.evaluate(() => bullets[0].alt)).toBeCloseTo(62, 5);
        });

        test('the gun has a cooldown', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                fire();
                fire();
                fire();
            });
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('no more than three bullets are ever in flight', async ({ page }) => {
            await startFrozen(page);
            await hold(page, 'Space');
            await step(page, 240);
            expect(await page.evaluate(() => bullets.length)).toBeLessThanOrEqual(3);
        });

        test('holding Space keeps firing', async ({ page }) => {
            await startFrozen(page);
            await hold(page, 'Space');
            await step(page, 60);
            expect(await page.evaluate(() => shotsFired)).toBeGreaterThan(1);
        });

        test('a bullet is dropped once it leaves the view', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => fire());
            await step(page, 400);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('firing does nothing while paused', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => togglePause());
            await page.evaluate(() => fire());
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Hitting things — altitude is the aim
    // -----------------------------------------------------------------------
    test.describe('shooting targets', () => {
        test('a low shot destroys a fuel tank', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'tank', x: 100, z: 200 }]);
            await placeShip(page, 100, 10);
            await page.evaluate(() => fire());
            await step(page, 120);
            expect(await liveCount(page)).toBe(0);
        });

        test('a high shot flies straight over a fuel tank', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'tank', x: 100, z: 200 }]);
            await placeShip(page, 100, 80);
            await page.evaluate(() => fire());
            await step(page, 60);
            expect(await liveCount(page)).toBe(1);
        });

        test('a shot misses a tank that is off to the side', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'tank', x: 170, z: 200 }]);
            await placeShip(page, 40, 10);
            await page.evaluate(() => fire());
            await step(page, 120);
            expect(await liveCount(page)).toBe(1);
        });

        test('destroying a fuel tank refills the tank', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'tank', x: 100, z: 200 }]);
            await placeShip(page, 100, 10);
            await page.evaluate(() => {
                fuel = 40;
                fire();
            });
            await step(page, 120);
            expect(await page.evaluate(() => fuel)).toBeGreaterThan(60);
        });

        test('fuel never goes over the maximum', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'tank', x: 100, z: 200 }]);
            await placeShip(page, 100, 10);
            await page.evaluate(() => fire());
            await step(page, 120);
            expect(await page.evaluate(() => fuel)).toBeLessThanOrEqual(
                await page.evaluate(() => FUEL_MAX)
            );
        });

        test('a fuel tank scores points', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'tank', x: 100, z: 200 }]);
            await placeShip(page, 100, 10);
            await page.evaluate(() => fire());
            await step(page, 120);
            expect(await page.evaluate(() => score)).toBe(
                await page.evaluate(() => POINTS.tank)
            );
        });

        test('a turret only dies to a low shot', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'turret', x: 100, z: 200 }]);
            await placeShip(page, 100, 70);
            await page.evaluate(() => fire());
            await step(page, 60);
            expect(await liveCount(page)).toBe(1);

            await placeShip(page, 100, 8);
            await page.evaluate(() => fire());
            await step(page, 120);
            expect(await liveCount(page)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(
                await page.evaluate(() => POINTS.turret)
            );
        });

        test('an enemy plane dies only to a shot at its altitude', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'plane', x: 100, alt: 60, z: 300 }]);
            await placeShip(page, 100, 5);
            await page.evaluate(() => fire());
            await step(page, 30);
            expect(await liveCount(page)).toBe(1);

            await placeShip(page, 100, 60);
            await page.evaluate(() => fire());
            await step(page, 60);
            expect(await liveCount(page)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(
                await page.evaluate(() => POINTS.plane)
            );
        });

        test('a bullet is spent on the object it destroys', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [
                { kind: 'tank', x: 100, z: 200 },
                { kind: 'tank', x: 100, z: 240 },
            ]);
            await placeShip(page, 100, 10);
            await page.evaluate(() => fire());
            await step(page, 120);
            expect(await liveCount(page)).toBe(1);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('bullets cannot destroy a wall', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [
                { kind: 'wall', z: 300, openX: [20, 120], openAlt: [0, 50] },
            ]);
            await placeShip(page, 60, 20);
            await page.evaluate(() => fire());
            await step(page, 60);
            expect(await liveCount(page)).toBe(1);
        });

        test('an enemy plane closes on the ship faster than the scroll', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [
                { kind: 'plane', x: 100, alt: 40, z: 400 },
                { kind: 'tank', x: 20, z: 400 },
            ]);
            await step(page, 60);
            const [planeZ, tankZ] = await page.evaluate(() => [
                objects.find((o) => o.kind === 'plane').z,
                objects.find((o) => o.kind === 'tank').z,
            ]);
            expect(planeZ).toBeLessThan(tankZ);
        });
    });

    // -----------------------------------------------------------------------
    // Crashing
    // -----------------------------------------------------------------------
    test.describe('crashing', () => {
        test('flying low into a fuel tank costs a life', async ({ page }) => {
            await startFrozen(page);
            await clearInvuln(page);
            await setObjects(page, [{ kind: 'tank', x: 100, z: 120 }]);
            await placeShip(page, 100, 0);
            await step(page, 240);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('flying over the same tank is safe', async ({ page }) => {
            await startFrozen(page);
            await clearInvuln(page);
            await setObjects(page, [{ kind: 'tank', x: 100, z: 120 }]);
            await placeShip(page, 100, 80);
            await step(page, 240);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('passing beside a turret is safe', async ({ page }) => {
            await startFrozen(page);
            await clearInvuln(page);
            await setObjects(page, [{ kind: 'turret', x: 180, z: 120 }]);
            await page.evaluate(() => {
                objects[0].cool = 99;            // this test is about the crash, not the gun
            });
            await placeShip(page, 20, 0);
            await step(page, 240);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('a wall opening lets the ship through', async ({ page }) => {
            await startFrozen(page);
            await clearInvuln(page);
            await setObjects(page, [
                { kind: 'wall', z: 150, openX: [60, 140], openAlt: [40, 90] },
            ]);
            await placeShip(page, 100, 65);
            await step(page, 300);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('the wall itself does not', async ({ page }) => {
            await startFrozen(page);
            await clearInvuln(page);
            await setObjects(page, [
                { kind: 'wall', z: 150, openX: [60, 140], openAlt: [40, 90] },
            ]);
            await placeShip(page, 100, 5);
            await step(page, 300);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('being beside the opening is a crash too', async ({ page }) => {
            await startFrozen(page);
            await clearInvuln(page);
            await setObjects(page, [
                { kind: 'wall', z: 150, openX: [60, 140], openAlt: [0, 50] },
            ]);
            await placeShip(page, 20, 20);
            await step(page, 300);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('clipping the edge of an opening is a crash', async ({ page }) => {
            await startFrozen(page);
            await clearInvuln(page);
            await setObjects(page, [
                { kind: 'wall', z: 150, openX: [60, 140], openAlt: [0, 50] },
            ]);
            await placeShip(page, 62, 20);
            await step(page, 300);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('running out of fuel costs a life', async ({ page }) => {
            await startFrozen(page);
            await clearInvuln(page);
            await page.evaluate(() => {
                fuel = 0.01;
            });
            await step(page, 10);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('fuel drains while flying', async ({ page }) => {
            await startFrozen(page);
            await step(page, 240);
            const remaining = await page.evaluate(() => fuel);
            expect(remaining).toBeLessThan(100);
            expect(remaining).toBeGreaterThan(80);
        });

        test('a crash refills the tank and recentres the ship', async ({ page }) => {
            await startFrozen(page);
            await placeShip(page, 10, 90);
            await page.evaluate(() => {
                fuel = 5;
                crash();
            });
            expect(await page.evaluate(() => fuel)).toBe(await page.evaluate(() => FUEL_MAX));
            expect(await page.evaluate(() => ship.x)).toBeCloseTo(100, 5);
        });

        test('a crash grants a moment of invulnerability', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'tank', x: 100, z: 20 }]);
            await placeShip(page, 100, 0);
            await page.evaluate(() => crash());
            expect(await page.evaluate(() => invuln)).toBeGreaterThan(0);
            await placeShip(page, 100, 0);
            await step(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('invulnerability wears off', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => crash());
            await step(page, 400);
            expect(await page.evaluate(() => invuln)).toBe(0);
        });

        test('the last life ends the run', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 1;
                crash();
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
            expect(await page.evaluate(() => lives)).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('game over stores a new best score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 12345;
                lives = 1;
                crash();
            });
            expect(await page.evaluate(() => window.localStorage.getItem('zaxxon-best'))).toBe(
                '12345'
            );
            await expect(page.locator('#best')).toHaveText('12345');
        });
    });

    // -----------------------------------------------------------------------
    // Enemy fire
    // -----------------------------------------------------------------------
    test.describe('enemy fire', () => {
        test('a turret in range shoots at the ship', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'turret', x: 100, z: 200 }]);
            await page.evaluate(() => {
                objects[0].cool = 0;
            });
            await step(page, 2);
            expect(await page.evaluate(() => enemyShots.length)).toBeGreaterThan(0);
        });

        test('a turret far away holds its fire', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'turret', x: 100, z: 500 }]);
            await page.evaluate(() => {
                objects[0].cool = 0;
            });
            await step(page, 2);
            expect(await page.evaluate(() => enemyShots.length)).toBe(0);
        });

        test('a turret shot is aimed where the ship was', async ({ page }) => {
            await startFrozen(page);
            await placeShip(page, 150, 70);
            await setObjects(page, [{ kind: 'turret', x: 40, z: 200 }]);
            await page.evaluate(() => {
                objects[0].cool = 0;
            });
            await step(page, 2);
            const shot = await page.evaluate(() => enemyShots[0]);
            expect(shot.vx).toBeGreaterThan(0);
            expect(shot.valt).toBeGreaterThan(0);
        });

        test('a shot that reaches a stationary ship costs a life', async ({ page }) => {
            await startFrozen(page);
            await clearInvuln(page);
            await placeShip(page, 100, 40);
            await setObjects(page, [{ kind: 'turret', x: 100, z: 200 }]);
            await page.evaluate(() => {
                objects[0].cool = 0;
            });
            await step(page, 240);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('flying out of the way dodges the shot', async ({ page }) => {
            await startFrozen(page);
            await clearInvuln(page);
            await placeShip(page, 100, 10);
            await setObjects(page, [{ kind: 'turret', x: 100, z: 300 }]);
            await page.evaluate(() => {
                objects[0].cool = 0;
            });
            await step(page, 2);
            await hold(page, 'ArrowUp');
            await step(page, 200);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('enemy shots are dropped once they pass the ship', async ({ page }) => {
            await startFrozen(page);
            await placeShip(page, 10, 90);
            await page.evaluate(() => {
                enemyShots.push({ x: 180, alt: 0, z: 30, vz: -SHOT_SPEED, vx: 0, valt: 0 });
            });
            await step(page, 120);
            expect(await page.evaluate(() => enemyShots.length)).toBe(0);
        });

        test('a destroyed turret stops shooting', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'turret', x: 100, z: 200 }]);
            await placeShip(page, 100, 6);
            await page.evaluate(() => {
                objects[0].cool = 99;
                fire();
            });
            await step(page, 120);
            expect(await liveCount(page)).toBe(0);
            expect(await page.evaluate(() => enemyShots.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // The boss and finishing a level
    // -----------------------------------------------------------------------
    test.describe('boss and level flow', () => {
        test('the boss soaks up several hits', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'boss', x: 100, z: 200 }]);
            await placeShip(page, 100, 20);
            await page.evaluate(() => fire());
            await step(page, 120);
            const boss = await page.evaluate(() => objects.find((o) => o.kind === 'boss'));
            expect(boss).toBeTruthy();
            expect(boss.hp).toBeLessThan(await page.evaluate(() => BOSS_HP));
        });

        test('enough hits destroy the boss and score the bonus', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'boss', x: 100, z: 300 }]);
            await placeShip(page, 100, 20);
            await page.evaluate(() => {
                const boss = objects.find((o) => o.kind === 'boss');
                boss.hp = 1;
                fire();
            });
            await step(page, 120);
            expect(await page.evaluate(() => objects.some((o) => o.kind === 'boss'))).toBe(false);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(
                await page.evaluate(() => POINTS.boss)
            );
        });

        test('the boss shoots back', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'boss', x: 100, z: 200 }]);
            await page.evaluate(() => {
                objects[0].cool = 0;
            });
            await step(page, 2);
            expect(await page.evaluate(() => enemyShots.length)).toBeGreaterThan(0);
        });

        test('objects are culled once they pass behind the ship', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'tank', x: 10, z: 40 }]);
            await placeShip(page, 190, 90);
            await step(page, 240);
            expect(await liveCount(page)).toBe(0);
        });

        test('an empty fortress finishes the level', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                objects.length = 0;
            });
            await step(page, 1);
            expect(await page.evaluate(() => state)).toBe('levelclear');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('clearing a level pays a bonus', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 0;
                fuel = 50;
                objects.length = 0;
            });
            await step(page, 1);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(
                await page.evaluate(() => LEVEL_BONUS)
            );
        });

        test('Space moves on to the next level', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                objects.length = 0;
            });
            await step(page, 1);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => objects.length)).toBeGreaterThan(10);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the next level starts with a full tank', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                fuel = 20;
                objects.length = 0;
            });
            await step(page, 1);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => fuel)).toBe(await page.evaluate(() => FUEL_MAX));
        });

        test('lives carry over between levels', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 2;
                objects.length = 0;
            });
            await step(page, 1);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('clearing the last level wins the run', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                level = LEVEL_COUNT;
                objects.length = 0;
            });
            await step(page, 1);
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/win|complete/i);
        });

        test('a win stores the best score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                level = LEVEL_COUNT;
                score = 777;
                objects.length = 0;
            });
            await step(page, 1);
            const final = await page.evaluate(() => score);
            expect(final).toBeGreaterThan(777);
            expect(await page.evaluate(() => window.localStorage.getItem('zaxxon-best'))).toBe(
                String(final)
            );
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses the run', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('P resumes it', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the world is frozen while paused', async ({ page }) => {
            await startFrozen(page);
            await setObjects(page, [{ kind: 'tank', x: 100, z: 300 }]);
            await page.evaluate(() => togglePause());
            await step(page, 120);
            expect(await page.evaluate(() => objects[0].z)).toBe(300);
            expect(await page.evaluate(() => fuel)).toBe(100);
        });

        test('pausing is ignored when no run is in progress', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted before the first start', async ({ page }) => {
            const painted = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, W, H).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] || data[i + 1] || data[i + 2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the altitude ladder marks the ship’s height', async ({ page }) => {
            await startLevel(page);
            const moved = await page.evaluate(() => {
                ship.alt = 0;
                const low = altMarkerY();
                ship.alt = MAX_ALT;
                return low - altMarkerY();
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('the frame draws without throwing in every state', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const states = ['idle', 'running', 'paused', 'levelclear', 'gameover', 'won'];
                startGame();
                autoRun = false;
                enemyShots.push({ x: 100, alt: 40, z: 200, vz: -SHOT_SPEED, vx: 0, valt: 0 });
                fire();
                booms.push({ x: 100, alt: 20, z: 100, t: 0 });
                try {
                    states.forEach((s) => {
                        state = s;
                        draw();
                    });
                } catch (err) {
                    return String(err);
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the live canvas keeps animating on its own', async ({ page }) => {
            await page.keyboard.press('Space');
            const first = await page.evaluate(() => objects[0].z);
            await page.waitForTimeout(350);
            const later = await page.evaluate(() => objects[0].z);
            expect(later).toBeLessThan(first);
        });
    });

    // -----------------------------------------------------------------------
    // Repo integration
    // -----------------------------------------------------------------------
    test.describe('repo integration', () => {
        test('the game browser lists the game', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'zaxxon');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Zaxxon');
            expect(entry.dir).toBe('Zaxxon');
            expect(entry.path).toBe('games/Zaxxon/index.html');
            expect(entry.thumbnail).toBe('games/Zaxxon/screenshot.png');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const i = games.findIndex((g) => g.id === 'zaxxon');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            if (i + 1 < games.length) {
                expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
            }
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'Zaxxon/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(/\|\s*Zaxxon\s*\|\s*\[Zaxxon\/\]\(Zaxxon\/\)\s*\|\s*(Complete|In Progress)\s*\|/);
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'Zaxxon/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'Zaxxon/DESIGN.md'))).toBe(true);
        });
    });
});
