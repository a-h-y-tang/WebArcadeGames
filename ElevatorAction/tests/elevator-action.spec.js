const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a building and freeze the animation loop. Every test that cares about
// motion steps the simulation itself so the assertions are about a known number
// of fixed timesteps rather than wall-clock time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
    });
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(1 / 120);
    }, steps);
}

// Turn off the two ambient systems (idle cars homing to the player's floor and
// agent spawning) so a test can set up an exact situation.
async function calm(page) {
    await page.evaluate(() => {
        carHoming = false;
        spawnEnabled = false;
        enemies.length = 0;
        bullets.length = 0;
    });
}

// Stand the player on a floor at a given x, off any car.
async function placeOnFloor(page, floor, x) {
    await page.evaluate(([f, px]) => {
        player.onCar = -1;
        player.x = px;
        player.y = floorSurfaceY(f);
    }, [floor, x]);
}

// Park a shaft's car on one of the floors it serves.
async function parkCar(page, shaft, floor) {
    await page.evaluate(([i, f]) => {
        shafts[i].y = floorSurfaceY(f);
    }, [shaft, floor]);
}

// Hold a key down for `steps` timesteps, then release it.
async function holdFor(page, key, steps) {
    await page.keyboard.down(key);
    await step(page, steps);
    await page.keyboard.up(key);
}

test.describe('Elevator Action', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Elevator Action', async ({ page }) => {
            await expect(page).toHaveTitle('Elevator Action');
        });

        test('canvas is 640x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '600');
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
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no building, agents or bullets before starting', async ({ page }) => {
            expect(await page.evaluate(() => doors.length)).toBe(0);
            expect(await page.evaluate(() => shafts.length)).toBe(0);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '12500'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('12500');
        });

        test('the help legend explains the elevator and shooting', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/elevator/i);
            await expect(page.locator('.help')).toContainText(/shoot/i);
        });

        test('pressing Space while idle does not fire a shot', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a building
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

        test('level 1 is eight floors with three shafts', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => floorCount)).toBe(8);
            expect(await page.evaluate(() => shafts.length)).toBe(3);
            expect(await page.evaluate(() => worldH)).toBe(800);
        });

        test('level 1 hides four documents', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => docsRemaining())).toBe(4);
            await expect(page.locator('#docs')).toHaveText('4');
        });

        test('the player starts on the top floor facing right', async ({ page }) => {
            await startFrozen(page);
            const info = await page.evaluate(() => ({
                floor: floorAt(player.y),
                top: floorCount - 1,
                facing: player.facing,
                onCar: player.onCar,
            }));
            expect(info.floor).toBe(info.top);
            expect(info.facing).toBe(1);
            expect(info.onCar).toBe(-1);
        });

        test('a fresh run has three lives and no score', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('every car starts at the top of its own shaft', async ({ page }) => {
            await startFrozen(page);
            const parked = await page.evaluate(() =>
                shafts.map((s) => Math.abs(s.y - floorSurfaceY(s.hi)) < 0.001)
            );
            expect(parked).toEqual([true, true, true]);
        });
    });

    // -----------------------------------------------------------------------
    // Building geometry
    // -----------------------------------------------------------------------
    test.describe('geometry', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
        });

        test('higher floors sit higher on the screen', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: floorCount }, (_, i) => floorSurfaceY(i))
            );
            for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]);
        });

        test('floors are one FLOOR_H apart', async ({ page }) => {
            const gap = await page.evaluate(() => floorSurfaceY(0) - floorSurfaceY(1));
            expect(gap).toBeCloseTo(100, 5);
        });

        test('floorAt inverts floorSurfaceY', async ({ page }) => {
            const round = await page.evaluate(() =>
                Array.from({ length: floorCount }, (_, i) => floorAt(floorSurfaceY(i)))
            );
            expect(round).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        });

        test('floorAt returns -1 between floors', async ({ page }) => {
            const mid = await page.evaluate(() => floorAt(floorSurfaceY(2) - 50));
            expect(mid).toBe(-1);
        });

        test('no door sits inside an elevator shaft', async ({ page }) => {
            const clash = await page.evaluate(() =>
                doors.some((d) =>
                    shafts.some(
                        (s) => d.x + DOOR_W / 2 > s.x && d.x - DOOR_W / 2 < s.x + s.w
                    )
                )
            );
            expect(clash).toBe(false);
        });

        test('no shaft serves the whole building', async ({ page }) => {
            const spans = await page.evaluate(() =>
                shafts.map((s) => ({ lo: s.lo, hi: s.hi, floors: floorCount }))
            );
            for (const s of spans) {
                expect(s.lo).toBeGreaterThanOrEqual(0);
                expect(s.hi).toBeLessThanOrEqual(s.floors - 1);
                expect(s.hi).toBeGreaterThan(s.lo);
                expect(s.hi - s.lo).toBeLessThan(s.floors - 1);
            }
        });

        test('a route from the roof to the lobby exists', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const top = floorCount - 1;
                const roof = shafts.find((s) => s.hi === top);
                const lobby = shafts.find((s) => s.lo === 0);
                if (!roof || !lobby) return false;
                // the two shafts must share at least one floor to transfer on
                return roof.lo <= lobby.hi && lobby.lo <= roof.hi;
            });
            expect(ok).toBe(true);
        });

        test('documents are never on the roof floor or in the lobby', async ({ page }) => {
            const floors = await page.evaluate(() =>
                doors.filter((d) => d.red).map((d) => d.floor)
            );
            const top = await page.evaluate(() => floorCount - 1);
            for (const f of floors) {
                expect(f).toBeGreaterThan(0);
                expect(f).toBeLessThan(top);
            }
        });

        test('the lobby keeps its right-hand corner clear for the getaway car', async ({ page }) => {
            const clear = await page.evaluate(() =>
                doors
                    .filter((d) => d.floor === 0)
                    .every((d) => d.x - DOOR_W / 2 > exitZone.x + exitZone.w || d.x + DOOR_W / 2 < exitZone.x)
            );
            expect(clear).toBe(true);
        });

        test('every document can actually be walked to', async ({ page }) => {
            const stranded = await page.evaluate(() => {
                const bad = [];
                for (let n = 1; n <= LEVEL_COUNT; n++) {
                    const b = buildLevel(n);
                    const reach = reachableRegions(b.floorCount, b.shafts, b.floorCount - 1, PLAYER_START_X);
                    for (const d of b.doors) {
                        if (!d.red) continue;
                        const segments = floorSegments(d.floor, b.shafts);
                        if (!reach.has(`${d.floor}:${segmentIndexAt(segments, d.x)}`)) {
                            bad.push(`L${n} floor ${d.floor} x${d.x}`);
                        }
                    }
                }
                return bad;
            });
            expect(stranded).toEqual([]);
        });

        test('the getaway car can be walked to in every building', async ({ page }) => {
            const blocked = await page.evaluate(() => {
                const bad = [];
                for (let n = 1; n <= LEVEL_COUNT; n++) {
                    const b = buildLevel(n);
                    const reach = reachableRegions(b.floorCount, b.shafts, b.floorCount - 1, PLAYER_START_X);
                    const segments = floorSegments(0, b.shafts);
                    const x = exitZone.x + exitZone.w / 2;
                    if (!reach.has(`0:${segmentIndexAt(segments, x)}`)) bad.push(`L${n}`);
                }
                return bad;
            });
            expect(blocked).toEqual([]);
        });

        test('every building places its whole set of documents', async ({ page }) => {
            const counts = await page.evaluate(() =>
                Array.from({ length: LEVEL_COUNT }, (_, i) => buildLevel(i + 1).doors.filter((d) => d.red).length)
            );
            expect(counts).toEqual([4, 5, 6, 7]);
        });

        test('documents sit one to a floor', async ({ page }) => {
            const dupes = await page.evaluate(() => {
                const bad = [];
                for (let n = 1; n <= LEVEL_COUNT; n++) {
                    const seen = new Set();
                    for (const d of buildLevel(n).doors.filter((x) => x.red)) {
                        if (seen.has(d.floor)) bad.push(`L${n} floor ${d.floor}`);
                        seen.add(d.floor);
                    }
                }
                return bad;
            });
            expect(dupes).toEqual([]);
        });

        test('buildLevel is deterministic', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = JSON.stringify(buildLevel(3));
                const b = JSON.stringify(buildLevel(3));
                return a === b;
            });
            expect(same).toBe(true);
        });

        test('the camera stays inside the building', async ({ page }) => {
            const bounds = await page.evaluate(() => {
                const out = [];
                for (const f of [0, 3, floorCount - 1]) {
                    player.onCar = -1;
                    player.y = floorSurfaceY(f);
                    updateCamera();
                    out.push(camera.y);
                }
                return { out, max: worldH - H };
            });
            for (const y of bounds.out) {
                expect(y).toBeGreaterThanOrEqual(0);
                expect(y).toBeLessThanOrEqual(bounds.max);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Walking
    // -----------------------------------------------------------------------
    test.describe('walking', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await calm(page);
        });

        test('ArrowRight walks right', async ({ page }) => {
            await placeOnFloor(page, 7, 220);
            await holdFor(page, 'ArrowRight', 12);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(220);
        });

        test('ArrowLeft walks left', async ({ page }) => {
            await placeOnFloor(page, 7, 220);
            await holdFor(page, 'ArrowLeft', 12);
            expect(await page.evaluate(() => player.x)).toBeLessThan(220);
        });

        test('D and A also walk', async ({ page }) => {
            await placeOnFloor(page, 7, 220);
            await holdFor(page, 'KeyD', 12);
            const right = await page.evaluate(() => player.x);
            expect(right).toBeGreaterThan(220);
            await holdFor(page, 'KeyA', 24);
            expect(await page.evaluate(() => player.x)).toBeLessThan(right);
        });

        test('walking flips the facing', async ({ page }) => {
            await placeOnFloor(page, 7, 220);
            await holdFor(page, 'ArrowLeft', 2);
            expect(await page.evaluate(() => player.facing)).toBe(-1);
            await holdFor(page, 'ArrowRight', 2);
            expect(await page.evaluate(() => player.facing)).toBe(1);
        });

        test('walking covers PLAYER_SPEED pixels per second', async ({ page }) => {
            await placeOnFloor(page, 7, 220);
            await holdFor(page, 'ArrowRight', 60); // half a second
            const moved = await page.evaluate(() => player.x - 220);
            const expected = await page.evaluate(() => PLAYER_SPEED * 0.5);
            expect(moved).toBeCloseTo(expected, 1);
        });

        test('the player cannot walk off the right edge', async ({ page }) => {
            await placeOnFloor(page, 7, 600);
            await holdFor(page, 'ArrowRight', 240);
            const x = await page.evaluate(() => player.x);
            const limit = await page.evaluate(() => W);
            expect(x).toBeLessThan(limit);
        });

        test('the player cannot walk off the left edge', async ({ page }) => {
            await placeOnFloor(page, 7, 40);
            await holdFor(page, 'ArrowLeft', 240);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(0);
        });

        test('an empty shaft blocks the way', async ({ page }) => {
            // shaft 0 serves the middle floors, so on floor 7 its car is absent
            await page.evaluate(() => {
                shafts[0].y = floorSurfaceY(shafts[0].lo);
            });
            await placeOnFloor(page, 7, 60);
            await holdFor(page, 'ArrowRight', 240);
            const res = await page.evaluate(() => ({ x: player.x, lip: shafts[0].x }));
            expect(res.x).toBeLessThanOrEqual(res.lip);
            expect(res.x).toBeGreaterThan(res.lip - 30);
        });

        test('walking into a shaft with a car level puts the player on the car', async ({ page }) => {
            const floor = await page.evaluate(() => shafts[0].hi);
            await parkCar(page, 0, floor);
            await placeOnFloor(page, floor, 60);
            await holdFor(page, 'ArrowRight', 60);
            const res = await page.evaluate(() => ({ onCar: player.onCar, y: player.y, carY: shafts[0].y }));
            expect(res.onCar).toBe(0);
            expect(res.y).toBeCloseTo(res.carY, 5);
        });

        test('a car between floors cages the player inside it', async ({ page }) => {
            await page.evaluate(() => {
                player.onCar = 0;
                shafts[0].y = floorSurfaceY(shafts[0].lo) - 50; // mid-shaft
                player.x = shafts[0].x + 10;
                player.y = shafts[0].y;
            });
            await holdFor(page, 'ArrowRight', 240);
            const res = await page.evaluate(() => ({
                onCar: player.onCar,
                x: player.x,
                right: shafts[0].x + shafts[0].w,
            }));
            expect(res.onCar).toBe(0);
            expect(res.x).toBeLessThanOrEqual(res.right);
        });

        test('the player can step off a car that is level with a floor', async ({ page }) => {
            const floor = await page.evaluate(() => shafts[0].hi);
            await parkCar(page, 0, floor);
            await page.evaluate(() => {
                player.onCar = 0;
                player.x = shafts[0].x + shafts[0].w - 6;
                player.y = shafts[0].y;
            });
            await holdFor(page, 'ArrowRight', 60);
            const res = await page.evaluate(([f]) => ({
                onCar: player.onCar,
                y: player.y,
                surface: floorSurfaceY(f),
            }), [floor]);
            expect(res.onCar).toBe(-1);
            expect(res.y).toBeCloseTo(res.surface, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Elevators
    // -----------------------------------------------------------------------
    test.describe('elevators', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await calm(page);
        });

        // Put the player on shaft 0's car, parked at `floor`.
        async function ride(page, shaft, floor) {
            await page.evaluate(([i, f]) => {
                shafts[i].y = floorSurfaceY(f);
                player.onCar = i;
                player.x = shafts[i].x + shafts[i].w / 2;
                player.y = shafts[i].y;
            }, [shaft, floor]);
        }

        test('holding Down drives the car down', async ({ page }) => {
            const mid = await page.evaluate(() => shafts[0].hi);
            await ride(page, 0, mid);
            const before = await page.evaluate(() => shafts[0].y);
            await holdFor(page, 'ArrowDown', 60);
            expect(await page.evaluate(() => shafts[0].y)).toBeGreaterThan(before);
        });

        test('holding Up drives the car up', async ({ page }) => {
            const lo = await page.evaluate(() => shafts[0].lo);
            await ride(page, 0, lo);
            const before = await page.evaluate(() => shafts[0].y);
            await holdFor(page, 'ArrowUp', 60);
            expect(await page.evaluate(() => shafts[0].y)).toBeLessThan(before);
        });

        test('S and W also drive the car', async ({ page }) => {
            const hi = await page.evaluate(() => shafts[0].hi);
            await ride(page, 0, hi);
            await holdFor(page, 'KeyS', 40);
            const down = await page.evaluate(() => shafts[0].y);
            expect(down).toBeGreaterThan(await page.evaluate(() => floorSurfaceY(shafts[0].hi)));
            await holdFor(page, 'KeyW', 80);
            expect(await page.evaluate(() => shafts[0].y)).toBeLessThan(down);
        });

        test('the car moves at ELEV_SPEED', async ({ page }) => {
            const hi = await page.evaluate(() => shafts[0].hi);
            await ride(page, 0, hi);
            const before = await page.evaluate(() => shafts[0].y);
            await holdFor(page, 'ArrowDown', 60); // half a second
            const moved = await page.evaluate((y0) => shafts[0].y - y0, before);
            const expected = await page.evaluate(() => ELEV_SPEED * 0.5);
            expect(moved).toBeCloseTo(expected, 1);
        });

        test('the car stops at the bottom of its shaft', async ({ page }) => {
            const hi = await page.evaluate(() => shafts[0].hi);
            await ride(page, 0, hi);
            await holdFor(page, 'ArrowDown', 1200);
            const res = await page.evaluate(() => ({ y: shafts[0].y, bottom: floorSurfaceY(shafts[0].lo) }));
            expect(res.y).toBeCloseTo(res.bottom, 5);
        });

        test('the car stops at the top of its shaft', async ({ page }) => {
            const lo = await page.evaluate(() => shafts[0].lo);
            await ride(page, 0, lo);
            await holdFor(page, 'ArrowUp', 1200);
            const res = await page.evaluate(() => ({ y: shafts[0].y, top: floorSurfaceY(shafts[0].hi) }));
            expect(res.y).toBeCloseTo(res.top, 5);
        });

        test('the player rides the car', async ({ page }) => {
            const hi = await page.evaluate(() => shafts[0].hi);
            await ride(page, 0, hi);
            await holdFor(page, 'ArrowDown', 60);
            const res = await page.evaluate(() => ({ y: player.y, carY: shafts[0].y }));
            expect(res.y).toBeCloseTo(res.carY, 5);
        });

        test('elevator keys do nothing while standing on a floor', async ({ page }) => {
            await placeOnFloor(page, 7, 60);
            const before = await page.evaluate(() => shafts.map((s) => s.y));
            await holdFor(page, 'ArrowDown', 60);
            expect(await page.evaluate(() => shafts.map((s) => s.y))).toEqual(before);
        });

        test('an idle car homes toward the floor the player is on', async ({ page }) => {
            await page.evaluate(() => {
                carHoming = true;
            });
            const target = await page.evaluate(() => shafts[2].lo);
            await page.evaluate(() => {
                shafts[2].y = floorSurfaceY(shafts[2].hi);
            });
            await placeOnFloor(page, target, 420);
            const before = await page.evaluate(() => shafts[2].y);
            await step(page, 60);
            const after = await page.evaluate(() => shafts[2].y);
            expect(after).toBeGreaterThan(before);
            expect(after).toBeLessThanOrEqual(await page.evaluate(() => floorSurfaceY(shafts[2].lo)));
        });

        test('an idle car ignores a floor its shaft does not serve', async ({ page }) => {
            await page.evaluate(() => {
                carHoming = true;
            });
            // shaft 2 stops below the roof, so standing on the roof must not call it
            await placeOnFloor(page, await page.evaluate(() => floorCount - 1), 420);
            const before = await page.evaluate(() => shafts[2].y);
            await step(page, 120);
            expect(await page.evaluate(() => shafts[2].y)).toBeCloseTo(before, 5);
        });

        test('idle cars hold still while the player is between floors', async ({ page }) => {
            await page.evaluate(() => {
                carHoming = true;
                player.onCar = 0;
                shafts[0].y = floorSurfaceY(shafts[0].lo) - 50;
                player.x = shafts[0].x + 10;
                player.y = shafts[0].y;
            });
            const before = await page.evaluate(() => shafts.map((s) => s.y));
            await step(page, 120);
            expect(await page.evaluate(() => shafts.map((s) => s.y))).toEqual(before);
        });

        test('carHoming = false freezes idle cars', async ({ page }) => {
            const target = await page.evaluate(() => shafts[2].lo);
            await placeOnFloor(page, target, 420);
            const before = await page.evaluate(() => shafts.map((s) => s.y));
            await step(page, 120);
            expect(await page.evaluate(() => shafts.map((s) => s.y))).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Documents
    // -----------------------------------------------------------------------
    test.describe('documents', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await calm(page);
        });

        test('standing at a red door collects its document', async ({ page }) => {
            const taken = await page.evaluate(() => {
                const d = doors.find((x) => x.red);
                player.onCar = -1;
                player.x = d.x;
                player.y = floorSurfaceY(d.floor);
                physicsStep(1 / 120);
                return d.taken;
            });
            expect(taken).toBe(true);
        });

        test('a document is worth DOC_POINTS', async ({ page }) => {
            const res = await page.evaluate(() => {
                const d = doors.find((x) => x.red);
                player.onCar = -1;
                player.x = d.x;
                player.y = floorSurfaceY(d.floor);
                physicsStep(1 / 120);
                return { score, points: DOC_POINTS };
            });
            expect(res.score).toBe(res.points);
        });

        test('collecting lowers the remaining count and the HUD', async ({ page }) => {
            await page.evaluate(() => {
                const d = doors.find((x) => x.red);
                player.onCar = -1;
                player.x = d.x;
                player.y = floorSurfaceY(d.floor);
                physicsStep(1 / 120);
            });
            expect(await page.evaluate(() => docsRemaining())).toBe(3);
            await expect(page.locator('#docs')).toHaveText('3');
        });

        test('a document cannot be collected twice', async ({ page }) => {
            const score = await page.evaluate(() => {
                const d = doors.find((x) => x.red);
                player.onCar = -1;
                player.x = d.x;
                player.y = floorSurfaceY(d.floor);
                for (let i = 0; i < 60; i++) physicsStep(1 / 120);
                return score;
            });
            expect(score).toBe(await page.evaluate(() => DOC_POINTS));
        });

        test('a grey door holds nothing', async ({ page }) => {
            const res = await page.evaluate(() => {
                const d = doors.find((x) => !x.red && x.floor > 0);
                player.onCar = -1;
                player.x = d.x;
                player.y = floorSurfaceY(d.floor);
                for (let i = 0; i < 60; i++) physicsStep(1 / 120);
                return { score, docs: docsRemaining() };
            });
            expect(res.score).toBe(0);
            expect(res.docs).toBe(4);
        });

        test('a document on another floor is out of reach', async ({ page }) => {
            const res = await page.evaluate(() => {
                const d = doors.find((x) => x.red && x.floor > 1);
                player.onCar = -1;
                player.x = d.x;
                player.y = floorSurfaceY(d.floor - 1);
                for (let i = 0; i < 60; i++) physicsStep(1 / 120);
                return { taken: d.taken, score };
            });
            expect(res.taken).toBe(false);
            expect(res.score).toBe(0);
        });

        test('a document further than DOOR_REACH away is not collected', async ({ page }) => {
            const taken = await page.evaluate(() => {
                const d = doors.find((x) => x.red);
                player.onCar = -1;
                player.x = d.x + DOOR_REACH + 8;
                player.y = floorSurfaceY(d.floor);
                physicsStep(1 / 120);
                return d.taken;
            });
            expect(taken).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await calm(page);
            await placeOnFloor(page, 7, 220);
        });

        test('Space fires a player bullet', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => ({ n: bullets.length, owner: bullets[0] && bullets[0].owner }));
            expect(res.n).toBe(1);
            expect(res.owner).toBe('player');
        });

        test('the bullet leaves in the direction the player faces', async ({ page }) => {
            await page.evaluate(() => {
                player.facing = -1;
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets[0].vx)).toBeLessThan(0);
            await page.evaluate(() => {
                bullets.length = 0;
                player.shotCd = 0;
                player.facing = 1;
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets[0].vx)).toBeGreaterThan(0);
        });

        test('the bullet travels at BULLET_SPEED', async ({ page }) => {
            await page.keyboard.press('Space');
            const x0 = await page.evaluate(() => bullets[0].x);
            await step(page, 12); // 0.1s
            const moved = await page.evaluate((x) => bullets[0].x - x, x0);
            expect(moved).toBeCloseTo(await page.evaluate(() => BULLET_SPEED * 0.1), 1);
        });

        test('the gun has a cooldown', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('the gun fires again once the cooldown elapses', async ({ page }) => {
            await page.keyboard.press('Space');
            await step(page, 40); // longer than SHOT_COOLDOWN
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(2);
        });

        test('a bullet that leaves the building is removed', async ({ page }) => {
            await page.keyboard.press('Space');
            await step(page, 240);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a bullet kills an agent and scores', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: player.x + 60, y: player.y, floor: floorAt(player.y), facing: -1, shootCd: 99 });
                bullets.push({ x: player.x + 20, y: player.y - 22, vx: BULLET_SPEED, owner: 'player' });
                for (let i = 0; i < 20; i++) physicsStep(1 / 120);
                return { enemies: enemies.length, bullets: bullets.length, score, points: SHOOT_POINTS };
            });
            expect(res.enemies).toBe(0);
            expect(res.bullets).toBe(0);
            expect(res.score).toBe(res.points);
        });

        test('a bullet misses an agent on another floor', async ({ page }) => {
            const left = await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({
                    x: player.x + 60,
                    y: floorSurfaceY(floorAt(player.y) - 1),
                    floor: floorAt(player.y) - 1,
                    facing: -1,
                    shootCd: 99,
                });
                bullets.push({ x: player.x + 20, y: player.y - 22, vx: BULLET_SPEED, owner: 'player' });
                for (let i = 0; i < 20; i++) physicsStep(1 / 120);
                return enemies.length;
            });
            expect(left).toBe(1);
        });

        test('an agent bullet costs a life', async ({ page }) => {
            const res = await page.evaluate(() => {
                bullets.push({ x: player.x - 20, y: player.y - 22, vx: EBULLET_SPEED, owner: 'enemy' });
                for (let i = 0; i < 20; i++) physicsStep(1 / 120);
                return { lives, state };
            });
            expect(res.lives).toBe(2);
            expect(res.state).toBe('dying');
        });

        test('losing a life clears the floor of agents and bullets', async ({ page }) => {
            const res = await page.evaluate(() => {
                enemies.push({ x: 80, y: player.y, floor: floorAt(player.y), facing: 1, shootCd: 99 });
                bullets.push({ x: player.x - 20, y: player.y - 22, vx: EBULLET_SPEED, owner: 'enemy' });
                for (let i = 0; i < 20; i++) physicsStep(1 / 120);
                return { enemies: enemies.length, bullets: bullets.length };
            });
            expect(res.enemies).toBe(0);
            expect(res.bullets).toBe(0);
        });

        test('the player comes back at the roof after RESPAWN_DELAY', async ({ page }) => {
            const res = await page.evaluate(() => {
                bullets.push({ x: player.x - 20, y: player.y - 22, vx: EBULLET_SPEED, owner: 'enemy' });
                for (let i = 0; i < 20; i++) physicsStep(1 / 120);
                const during = state;
                for (let i = 0; i < 200; i++) physicsStep(1 / 120);
                return { during, after: state, floor: floorAt(player.y), top: floorCount - 1 };
            });
            expect(res.during).toBe('dying');
            expect(res.after).toBe('running');
            expect(res.floor).toBe(res.top);
        });

        test('the last life ends the run', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                bullets.push({ x: player.x - 20, y: player.y - 22, vx: EBULLET_SPEED, owner: 'enemy' });
                for (let i = 0; i < 20; i++) physicsStep(1 / 120);
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
            expect(await page.evaluate(() => lives)).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('no shooting while dying', async ({ page }) => {
            await page.evaluate(() => {
                state = 'dying';
                respawnTimer = 1;
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Agents
    // -----------------------------------------------------------------------
    test.describe('agents', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await calm(page);
        });

        test('an agent walks toward the player on its floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                player.onCar = -1;
                player.x = 60;
                player.y = floorSurfaceY(7);
                enemies.push({ x: 100, y: floorSurfaceY(7), floor: 7, facing: 1, shootCd: 99 });
                const x0 = enemies[0].x;
                for (let i = 0; i < 30; i++) physicsStep(1 / 120);
                return { x0, x1: enemies[0].x, facing: enemies[0].facing };
            });
            expect(res.x1).toBeLessThan(res.x0);
            expect(res.facing).toBe(-1);
        });

        test('an agent on another floor patrols and turns at the wall', async ({ page }) => {
            const res = await page.evaluate(() => {
                player.onCar = -1;
                player.x = 300;
                player.y = floorSurfaceY(7);
                enemies.push({ x: 60, y: floorSurfaceY(3), floor: 3, facing: -1, shootCd: 99 });
                for (let i = 0; i < 120; i++) physicsStep(1 / 120);
                return { facing: enemies[0].facing, x: enemies[0].x };
            });
            expect(res.facing).toBe(1);
            expect(res.x).toBeGreaterThan(0);
        });

        test('an empty shaft blocks an agent too', async ({ page }) => {
            const res = await page.evaluate(() => {
                const s = shafts[0];
                s.y = floorSurfaceY(s.lo);
                player.onCar = -1;
                player.x = s.x + s.w + 120;
                player.y = floorSurfaceY(7);
                enemies.push({ x: s.x - 80, y: floorSurfaceY(7), floor: 7, facing: 1, shootCd: 99 });
                for (let i = 0; i < 480; i++) physicsStep(1 / 120);
                return { x: enemies[0].x, lip: s.x };
            });
            expect(res.x).toBeLessThanOrEqual(res.lip);
        });

        test('an agent shoots at the player on its floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                player.onCar = -1;
                player.x = 420;
                player.y = floorSurfaceY(7);
                enemies.push({ x: 380, y: floorSurfaceY(7), floor: 7, facing: 1, shootCd: 0 });
                physicsStep(1 / 120);
                return { n: bullets.length, owner: bullets[0] && bullets[0].owner, vx: bullets[0] && bullets[0].vx };
            });
            expect(res.n).toBe(1);
            expect(res.owner).toBe('enemy');
            expect(res.vx).toBeGreaterThan(0);
        });

        test('an agent does not shoot at a player on another floor', async ({ page }) => {
            const n = await page.evaluate(() => {
                player.onCar = -1;
                player.x = 420;
                player.y = floorSurfaceY(6);
                enemies.push({ x: 380, y: floorSurfaceY(7), floor: 7, facing: 1, shootCd: 0 });
                for (let i = 0; i < 60; i++) physicsStep(1 / 120);
                return bullets.length;
            });
            expect(n).toBe(0);
        });

        test('agent fire is rate limited', async ({ page }) => {
            const n = await page.evaluate(() => {
                player.onCar = -1;
                player.x = 500;
                player.y = floorSurfaceY(7);
                enemies.push({ x: 380, y: floorSurfaceY(7), floor: 7, facing: 1, shootCd: 0 });
                for (let i = 0; i < 30; i++) physicsStep(1 / 120);
                return bullets.filter((b) => b.owner === 'enemy').length;
            });
            expect(n).toBe(1);
        });

        test('agents spawn from grey doors over time', async ({ page }) => {
            const res = await page.evaluate(() => {
                spawnEnabled = true;
                spawnTimer = 0;
                physicsStep(1 / 120);
                const e = enemies[0];
                return {
                    n: enemies.length,
                    atDoor: doors.some((d) => !d.red && d.floor === e.floor && Math.abs(d.x - e.x) < 1),
                };
            });
            expect(res.n).toBe(1);
            expect(res.atDoor).toBe(true);
        });

        test('agents never exceed MAX_ENEMIES', async ({ page }) => {
            const res = await page.evaluate(() => {
                spawnEnabled = true;
                for (let i = 0; i < 4000; i++) physicsStep(1 / 120);
                return { n: enemies.length, max: MAX_ENEMIES };
            });
            expect(res.n).toBeLessThanOrEqual(res.max);
        });

        test('spawnEnabled = false stops spawning', async ({ page }) => {
            const n = await page.evaluate(() => {
                spawnTimer = 0;
                for (let i = 0; i < 600; i++) physicsStep(1 / 120);
                return enemies.length;
            });
            expect(n).toBe(0);
        });

        test('agents spawn near the player', async ({ page }) => {
            const res = await page.evaluate(() => {
                spawnEnabled = true;
                player.onCar = -1;
                player.x = 300;
                player.y = floorSurfaceY(4);
                const seen = [];
                for (let i = 0; i < 2000; i++) {
                    physicsStep(1 / 120);
                    enemies.forEach((e) => seen.push(e.floor));
                    enemies.length = 0;
                }
                return seen;
            });
            expect(res.length).toBeGreaterThan(0);
            for (const f of res) expect(Math.abs(f - 4)).toBeLessThanOrEqual(2);
        });
    });

    // -----------------------------------------------------------------------
    // Crushing agents with a car
    // -----------------------------------------------------------------------
    test.describe('crushing', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await calm(page);
        });

        test('a descending car crushes an agent standing under it', async ({ page }) => {
            const res = await page.evaluate(() => {
                const s = shafts[0];
                const floor = s.lo + 1;
                s.y = floorSurfaceY(floor) - 40;
                player.onCar = 0;
                player.x = s.x + s.w / 2;
                player.y = s.y;
                enemies.push({ x: s.x + s.w / 2, y: floorSurfaceY(floor), floor, facing: 1, shootCd: 99 });
                keys['ArrowDown'] = true;
                for (let i = 0; i < 90; i++) physicsStep(1 / 120);
                keys['ArrowDown'] = false;
                return { n: enemies.length, score, points: CRUSH_POINTS };
            });
            expect(res.n).toBe(0);
            expect(res.score).toBe(res.points);
        });

        test('a rising car does not crush', async ({ page }) => {
            const res = await page.evaluate(() => {
                const s = shafts[0];
                const floor = s.hi - 1;
                s.y = floorSurfaceY(floor);
                player.onCar = 0;
                player.x = s.x + s.w / 2;
                player.y = s.y;
                enemies.push({ x: s.x + s.w / 2, y: floorSurfaceY(floor), floor, facing: 1, shootCd: 99 });
                keys['ArrowUp'] = true;
                for (let i = 0; i < 90; i++) physicsStep(1 / 120);
                keys['ArrowUp'] = false;
                return { n: enemies.length, score };
            });
            expect(res.n).toBe(1);
            expect(res.score).toBe(0);
        });

        test('a car misses an agent standing clear of the shaft', async ({ page }) => {
            const res = await page.evaluate(() => {
                const s = shafts[0];
                const floor = s.lo + 1;
                s.y = floorSurfaceY(floor) - 40;
                player.onCar = 0;
                player.x = s.x + s.w / 2;
                player.y = s.y;
                enemies.push({ x: s.x + s.w + 60, y: floorSurfaceY(floor), floor, facing: 1, shootCd: 99 });
                keys['ArrowDown'] = true;
                for (let i = 0; i < 90; i++) physicsStep(1 / 120);
                keys['ArrowDown'] = false;
                return { n: enemies.length, score };
            });
            expect(res.n).toBe(1);
            expect(res.score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Escaping and level progression
    // -----------------------------------------------------------------------
    test.describe('escaping', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await calm(page);
        });

        test('the getaway car is ignored while documents remain', async ({ page }) => {
            const res = await page.evaluate(() => {
                player.onCar = -1;
                player.x = exitZone.x + exitZone.w / 2;
                player.y = floorSurfaceY(0);
                for (let i = 0; i < 60; i++) physicsStep(1 / 120);
                return { state, docs: docsRemaining() };
            });
            expect(res.state).toBe('running');
            expect(res.docs).toBe(4);
        });

        test('reaching the getaway car with every document clears the building', async ({ page }) => {
            const res = await page.evaluate(() => {
                doors.forEach((d) => {
                    if (d.red) d.taken = true;
                });
                score = 0;
                player.onCar = -1;
                player.x = exitZone.x + exitZone.w / 2;
                player.y = floorSurfaceY(0);
                physicsStep(1 / 120);
                return { state, score, expected: LEVEL_BONUS + LIFE_BONUS * lives };
            });
            expect(res.state).toBe('levelclear');
            expect(res.score).toBe(res.expected);
        });

        test('clearing a building shows the overlay', async ({ page }) => {
            await page.evaluate(() => {
                doors.forEach((d) => {
                    if (d.red) d.taken = true;
                });
                player.onCar = -1;
                player.x = exitZone.x + exitZone.w / 2;
                player.y = floorSurfaceY(0);
                physicsStep(1 / 120);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/clear|escape/i);
        });

        test('the next building is taller and hides more documents', async ({ page }) => {
            await page.evaluate(() => {
                doors.forEach((d) => {
                    if (d.red) d.taken = true;
                });
                player.onCar = -1;
                player.x = exitZone.x + exitZone.w / 2;
                player.y = floorSurfaceY(0);
                physicsStep(1 / 120);
                advance();
            });
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => floorCount)).toBe(9);
            expect(await page.evaluate(() => docsRemaining())).toBe(5);
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('clearing the last building wins the run', async ({ page }) => {
            const res = await page.evaluate(() => {
                level = LEVEL_COUNT;
                startLevel();
                doors.forEach((d) => {
                    if (d.red) d.taken = true;
                });
                player.onCar = -1;
                player.x = exitZone.x + exitZone.w / 2;
                player.y = floorSurfaceY(0);
                physicsStep(1 / 120);
                const cleared = state;
                advance();
                return { cleared, final: state };
            });
            expect(res.cleared).toBe('levelclear');
            expect(res.final).toBe('won');
        });

        test('the win overlay reports the score', async ({ page }) => {
            await page.evaluate(() => {
                score = 9999;
                state = 'won';
                showOverlay('YOU ESCAPED', '');
            });
            await expect(page.locator('#overlay-score')).toContainText('9999');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await calm(page);
        });

        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('nothing moves while paused', async ({ page }) => {
            await placeOnFloor(page, 7, 220);
            await page.keyboard.press('KeyP');
            await holdFor(page, 'ArrowRight', 120);
            expect(await page.evaluate(() => player.x)).toBe(220);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('pausing does nothing from the idle screen', async ({ page }) => {
            await page.evaluate(() => {
                state = 'idle';
            });
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // HUD, persistence and rendering
    // -----------------------------------------------------------------------
    test.describe('hud and rendering', () => {
        test('the HUD tracks the score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 4200;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('4200');
        });

        test('a new best score is stored', async ({ page }) => {
            await startFrozen(page);
            const stored = await page.evaluate(() => {
                score = 7777;
                lives = 1;
                bullets.push({ x: player.x - 20, y: player.y - 22, vx: EBULLET_SPEED, owner: 'enemy' });
                for (let i = 0; i < 20; i++) physicsStep(1 / 120);
                return window.localStorage.getItem('elevatoraction-best');
            });
            expect(stored).toBe('7777');
            await expect(page.locator('#best')).toHaveText('7777');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '50000'));
            await page.reload();
            await startFrozen(page);
            const stored = await page.evaluate(() => {
                score = 10;
                lives = 1;
                bullets.push({ x: player.x - 20, y: player.y - 22, vx: EBULLET_SPEED, owner: 'enemy' });
                for (let i = 0; i < 20; i++) physicsStep(1 / 120);
                return window.localStorage.getItem('elevatoraction-best');
            });
            expect(stored).toBe('50000');
        });

        test('the canvas draws something', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => draw());
            const painted = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, W, H).data;
                let lit = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] + data[i + 1] + data[i + 2] > 90) lit++;
                }
                return lit;
            });
            expect(painted).toBeGreaterThan(1000);
        });

        test('the game runs for a while without a console error', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            page.on('console', (m) => {
                if (m.type() === 'error') errors.push(m.text());
            });
            await page.goto(GAME_URL);
            await page.keyboard.press('Space');
            await page.waitForTimeout(1200);
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(400);
            await page.keyboard.up('ArrowRight');
            await page.keyboard.press('Space');
            await page.waitForTimeout(600);
            expect(errors).toEqual([]);
        });

        test('the simulation survives a long unattended run', async ({ page }) => {
            await startFrozen(page);
            const res = await page.evaluate(() => {
                for (let i = 0; i < 6000; i++) physicsStep(1 / 120);
                return { state, lives, finite: Number.isFinite(player.x) && Number.isFinite(player.y) };
            });
            expect(res.finite).toBe(true);
            expect(['running', 'dying', 'gameover']).toContain(res.state);
        });
    });

    // -----------------------------------------------------------------------
    // Repository integration
    // -----------------------------------------------------------------------
    test.describe('repository integration', () => {
        test('games.json lists Elevator Action', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'elevator-action');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Elevator Action');
            expect(entry.dir).toBe('ElevatorAction');
            expect(entry.path).toBe('games/ElevatorAction/index.html');
            expect(entry.thumbnail).toBe('games/ElevatorAction/screenshot.png');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const i = games.findIndex((g) => g.id === 'elevator-action');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            if (i + 1 < games.length) {
                expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
            }
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorAction/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(
                /\|\s*Elevator Action\s*\|\s*\[ElevatorAction\/\]\(ElevatorAction\/\)\s*\|\s*(Complete|In Progress)\s*\|/
            );
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorAction/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorAction/DESIGN.md'))).toBe(true);
        });
    });
});
