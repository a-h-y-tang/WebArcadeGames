const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');
const FLOORS_EXPECTED = 10;

// Start a run and freeze the animation loop so each test advances the
// simulation itself, one fixed timestep at a time.
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

// Hold (or release) a key the way the input layer sees it.
async function hold(page, code, down = true) {
    await page.evaluate(([c, d]) => {
        keys[c] = d;
    }, [code, down]);
}

// Put the player in a known place and pose.
async function place(page, patch) {
    await page.evaluate((p) => {
        Object.assign(player, p);
        if (p.floor !== undefined && p.y === undefined) player.y = floorY(p.floor);
    }, patch);
}

// Run the simulation until the player lands on `floor`, then let go of the
// climb key: stairwells chain from one floor to the next, so a climb that is
// never released simply carries on past the landing.
async function climbUntil(page, floor, limit = 600) {
    await page.evaluate(
        ([f, max]) => {
            for (let i = 0; i < max; i++) {
                physicsStep(1 / 120);
                if (player.mode === 'floor' && player.floor === f) break;
            }
            keys.ArrowUp = false;
            keys.ArrowDown = false;
        },
        [floor, limit]
    );
}

// Clear the things that spawn on their own so a test sees only its own actors.
async function quiet(page) {
    await page.evaluate(() => {
        enemies.length = 0;
        bullets.length = 0;
        spawnTimer = -1e6;
    });
}

// Park both cars in the basement, out of the way of a floor-level test.
async function parkCars(page) {
    await page.evaluate(() => {
        cars.forEach((c) => {
            c.y = floorY(FLOORS - 1);
        });
    });
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

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#docs')).toHaveText('0/5');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('game starts idle with nothing in play', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '8600'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('8600');
        });

        test('the help legend explains movement and shooting', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/shoot/i);
            await expect(page.locator('.help')).toContainText(/crouch/i);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting a run', () => {
        test('Space starts the run and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the run', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the player starts standing on the top floor', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => player.floor)).toBe(0);
            expect(await page.evaluate(() => player.mode)).toBe('floor');
            expect(await page.evaluate(() => player.y === floorY(0))).toBe(true);
        });

        test('a fresh run resets score, lives and documents', async ({ page }) => {
            await page.evaluate(() => {
                score = 999;
                lives = 1;
                docsCollected = 3;
                startGame();
            });
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => docsCollected)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Building layout
    // -----------------------------------------------------------------------
    test.describe('building layout', () => {
        test.beforeEach(async ({ page }) => startFrozen(page));

        test('floorY maps a floor index to its feet level', async ({ page }) => {
            expect(await page.evaluate(() => floorY(0))).toBe(76);
            expect(await page.evaluate(() => floorY(3))).toBe(4 * 76);
            expect(await page.evaluate(() => floorY(FLOORS - 1) === BUILDING_H)).toBe(true);
            expect(await page.evaluate(() => BUILDING_H)).toBe(FLOORS_EXPECTED * 76);
        });

        test('the building has ten floors and two elevator shafts', async ({ page }) => {
            expect(await page.evaluate(() => FLOORS)).toBe(10);
            expect(await page.evaluate(() => shafts.length)).toBe(2);
            expect(await page.evaluate(() => cars.length)).toBe(2);
        });

        test('floors are labelled like a lift panel', async ({ page }) => {
            expect(await page.evaluate(() => floorLabel(0))).toBe('9');
            expect(await page.evaluate(() => floorLabel(8))).toBe('1');
            expect(await page.evaluate(() => floorLabel(9))).toBe('B');
        });

        test('there are exactly five red document doors', async ({ page }) => {
            expect(await page.evaluate(() => doors.filter((d) => d.red).length)).toBe(5);
            expect(await page.evaluate(() => DOC_TOTAL)).toBe(5);
        });

        test('no doors are placed in the basement', async ({ page }) => {
            expect(await page.evaluate(() => doors.some((d) => d.floor === FLOORS - 1))).toBe(false);
        });

        test('every adjacent pair of floors is joined by at least one stairwell', async ({ page }) => {
            const missing = await page.evaluate(() => {
                const gaps = [];
                for (let i = 0; i < FLOORS - 1; i++) {
                    if (!stairs.some((s) => s.upper === i && s.lower === i + 1)) gaps.push(i);
                }
                return gaps;
            });
            expect(missing).toEqual([]);
        });

        test('stairwells span exactly one floor height', async ({ page }) => {
            const bad = await page.evaluate(() =>
                stairs.filter((s) => s.bottom - s.top !== FLOOR_H).length
            );
            expect(bad).toBe(0);
        });

        test('no door sits inside an elevator shaft', async ({ page }) => {
            const clashes = await page.evaluate(() =>
                doors.filter((d) =>
                    shafts.some((s) => Math.abs(d.x - s.x) < s.w / 2 + DOOR_W / 2)
                ).length
            );
            expect(clashes).toBe(0);
        });

        test('the same level always builds the same building', async ({ page }) => {
            const first = await page.evaluate(() => JSON.stringify(doors));
            await page.evaluate(() => startGame());
            const second = await page.evaluate(() => JSON.stringify(doors));
            expect(second).toBe(first);
        });
    });

    // -----------------------------------------------------------------------
    // Walking
    // -----------------------------------------------------------------------
    test.describe('walking', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quiet(page);
            await parkCars(page);
        });

        test('holding Right walks the player right', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await hold(page, 'ArrowRight');
            await step(page, 60);
            const x = await page.evaluate(() => player.x);
            const walked = await page.evaluate(() => (WALK_SPEED * 60) / 120);
            expect(x).toBeGreaterThan(300);
            expect(x).toBeCloseTo(300 + walked, 0);
        });

        test('holding Left walks the player left and turns them around', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await hold(page, 'ArrowLeft');
            await step(page, 30);
            expect(await page.evaluate(() => player.x)).toBeLessThan(300);
            expect(await page.evaluate(() => player.dir)).toBe(-1);
        });

        test('A and D walk as well as the arrow keys', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await hold(page, 'KeyD');
            await step(page, 20);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(300);
        });

        test('the player cannot walk through the left wall', async ({ page }) => {
            await place(page, { floor: 4, x: 40 });
            await hold(page, 'ArrowLeft');
            await step(page, 240);
            expect(await page.evaluate(() => player.x)).toBeGreaterThanOrEqual(
                await page.evaluate(() => WALL + PLAYER_W / 2)
            );
        });

        test('the player cannot walk through the right wall', async ({ page }) => {
            await place(page, { floor: 4, x: 600 });
            await hold(page, 'ArrowRight');
            await step(page, 240);
            expect(await page.evaluate(() => player.x)).toBeLessThanOrEqual(
                await page.evaluate(() => W - WALL - PLAYER_W / 2)
            );
        });

        test('an empty shaft blocks the player', async ({ page }) => {
            await page.evaluate(() => {
                player.floor = 4;
                player.y = floorY(4);
                player.x = shafts[0].x - 60;
                player.mode = 'floor';
            });
            await hold(page, 'ArrowRight');
            await step(page, 120);
            const { x, left, mode } = await page.evaluate(() => ({
                x: player.x,
                left: shafts[0].x - shafts[0].w / 2,
                mode: player.mode,
            }));
            expect(mode).toBe('floor');
            expect(x).toBeLessThanOrEqual(left);
        });
    });

    // -----------------------------------------------------------------------
    // Crouching
    // -----------------------------------------------------------------------
    test.describe('crouching', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quiet(page);
            await parkCars(page);
        });

        test('holding Down on a floor crouches', async ({ page }) => {
            await page.evaluate(() => {
                // Somewhere with no stairwell underfoot.
                player.floor = 4;
                player.y = floorY(4);
                player.x = 320;
                while (stairs.some((s) => s.top === floorY(4) && Math.abs(s.x - player.x) <= 12)) {
                    player.x += 40;
                }
            });
            await hold(page, 'ArrowDown');
            await step(page, 2);
            expect(await page.evaluate(() => player.crouch)).toBe(true);
            expect(await page.evaluate(() => playerHeight())).toBe(await page.evaluate(() => CROUCH_H));
        });

        test('releasing Down stands the player back up', async ({ page }) => {
            await place(page, { floor: 4, x: 320, crouch: true });
            await hold(page, 'ArrowDown', false);
            await step(page, 2);
            expect(await page.evaluate(() => player.crouch)).toBe(false);
            expect(await page.evaluate(() => playerHeight())).toBe(await page.evaluate(() => PLAYER_H));
        });
    });

    // -----------------------------------------------------------------------
    // Stairwells
    // -----------------------------------------------------------------------
    test.describe('stairwells', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quiet(page);
            await parkCars(page);
        });

        test('Down at the top of a stairwell starts a climb down', async ({ page }) => {
            await page.evaluate(() => {
                const s = stairs.find((st) => st.upper === 3);
                player.floor = 3;
                player.y = floorY(3);
                player.x = s.x;
                player.mode = 'floor';
            });
            await hold(page, 'ArrowDown');
            await step(page, 10);
            expect(await page.evaluate(() => player.mode)).toBe('ladder');
            expect(await page.evaluate(() => player.y > floorY(3))).toBe(true);
            expect(await page.evaluate(() => player.crouch)).toBe(false);
        });

        test('climbing all the way down lands on the floor below', async ({ page }) => {
            await page.evaluate(() => {
                const s = stairs.find((st) => st.upper === 3);
                player.floor = 3;
                player.y = floorY(3);
                player.x = s.x;
                player.mode = 'floor';
            });
            await hold(page, 'ArrowDown');
            await climbUntil(page, 4);
            expect(await page.evaluate(() => player.mode)).toBe('floor');
            expect(await page.evaluate(() => player.floor)).toBe(4);
            expect(await page.evaluate(() => player.y === floorY(4))).toBe(true);
        });

        test('Up at the bottom of a stairwell climbs back up', async ({ page }) => {
            await page.evaluate(() => {
                const s = stairs.find((st) => st.upper === 3);
                player.floor = 4;
                player.y = floorY(4);
                player.x = s.x;
                player.mode = 'floor';
            });
            await hold(page, 'ArrowUp');
            await climbUntil(page, 3);
            expect(await page.evaluate(() => player.mode)).toBe('floor');
            expect(await page.evaluate(() => player.floor)).toBe(3);
        });

        test('a stairwell is not a lift: no key means no movement', async ({ page }) => {
            await page.evaluate(() => {
                const s = stairs.find((st) => st.upper === 3);
                player.mode = 'ladder';
                player.stair = stairs.indexOf(s);
                player.x = s.x;
                player.y = (s.top + s.bottom) / 2;
            });
            const before = await page.evaluate(() => player.y);
            await step(page, 60);
            expect(await page.evaluate(() => player.y)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Elevators
    // -----------------------------------------------------------------------
    test.describe('elevators', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quiet(page);
        });

        test('walking onto a car level with the floor boards it', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(4);
                player.floor = 4;
                player.y = floorY(4);
                player.x = shafts[0].x - 40;
                player.mode = 'floor';
            });
            await hold(page, 'ArrowRight');
            await step(page, 40);
            expect(await page.evaluate(() => player.mode)).toBe('elevator');
            expect(await page.evaluate(() => player.car)).toBe(0);
        });

        test('Up drives the car and the player up together', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(5);
                player.mode = 'elevator';
                player.car = 0;
                player.x = shafts[0].x;
                player.y = cars[0].y;
            });
            await hold(page, 'ArrowUp');
            await step(page, 60);
            const { carY, py, start } = await page.evaluate(() => ({
                carY: cars[0].y,
                py: player.y,
                start: floorY(5),
            }));
            expect(carY).toBeLessThan(start);
            expect(py).toBe(carY);
        });

        test('Down drives the car down', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(5);
                player.mode = 'elevator';
                player.car = 0;
                player.x = shafts[0].x;
                player.y = cars[0].y;
            });
            await hold(page, 'ArrowDown');
            await step(page, 60);
            expect(await page.evaluate(() => cars[0].y)).toBeGreaterThan(5 * 76 + 76);
        });

        test('a car cannot be driven above the top floor', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(1);
                player.mode = 'elevator';
                player.car = 0;
                player.x = shafts[0].x;
                player.y = cars[0].y;
            });
            await hold(page, 'ArrowUp');
            await step(page, 600);
            expect(await page.evaluate(() => cars[0].y)).toBe(await page.evaluate(() => floorY(0)));
        });

        test('a car cannot be driven below the basement', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(FLOORS - 2);
                player.mode = 'elevator';
                player.car = 0;
                player.x = shafts[0].x;
                player.y = cars[0].y;
            });
            await hold(page, 'ArrowDown');
            await step(page, 600);
            expect(await page.evaluate(() => cars[0].y)).toBe(
                await page.evaluate(() => floorY(FLOORS - 1))
            );
        });

        test('stepping off a level car puts the player back on that floor', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(6);
                player.mode = 'elevator';
                player.car = 0;
                player.x = shafts[0].x;
                player.y = cars[0].y;
            });
            await hold(page, 'ArrowLeft');
            await step(page, 120);
            expect(await page.evaluate(() => player.mode)).toBe('floor');
            expect(await page.evaluate(() => player.floor)).toBe(6);
            expect(await page.evaluate(() => player.x)).toBeLessThan(
                await page.evaluate(() => shafts[0].x - shafts[0].w / 2)
            );
        });

        test('holding the call key beside a shaft calls the car toward your floor', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(6);
                player.floor = 4;
                player.y = floorY(4);
                player.x = shafts[0].x - shafts[0].w / 2 - 4;
                player.mode = 'floor';
            });
            await hold(page, 'KeyE');
            await step(page, 120);
            const { carY, lo, hi } = await page.evaluate(() => ({
                carY: cars[0].y,
                lo: floorY(4),
                hi: floorY(6),
            }));
            expect(carY).toBeLessThan(hi);
            expect(carY).toBeGreaterThan(lo);
        });

        test('a called car stops level with the floor and can be boarded', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(6);
                player.floor = 4;
                player.y = floorY(4);
                player.x = shafts[0].x - shafts[0].w / 2 - 4;
                player.mode = 'floor';
            });
            await hold(page, 'KeyE');
            await step(page, 600);
            expect(await page.evaluate(() => cars[0].y)).toBe(await page.evaluate(() => floorY(4)));
            expect(await page.evaluate(() => player.mode)).toBe('floor');

            await hold(page, 'KeyE', false);
            await hold(page, 'ArrowRight');
            await step(page, 40);
            expect(await page.evaluate(() => player.mode)).toBe('elevator');
        });

        test('calling never drags a car past the player floor', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(2);
                player.floor = 5;
                player.y = floorY(5);
                player.x = shafts[0].x + shafts[0].w / 2 + 32;
                player.mode = 'floor';
            });
            await hold(page, 'KeyE');
            await step(page, 900);
            expect(await page.evaluate(() => cars[0].y)).toBe(await page.evaluate(() => floorY(5)));
        });

        test('the call key works from a stairwell too, without climbing it', async ({ page }) => {
            await page.evaluate(() => {
                // A stairwell slot sits close enough to a shaft that Up or Down
                // there would mean "climb"; the call key is unambiguous.
                const s = stairs.find(
                    (st) =>
                        st.upper === 3 &&
                        shafts.some((sh) => Math.abs(st.x - sh.x) <= sh.w / 2 + CALL_DX)
                );
                cars[0].y = floorY(8);
                cars[1].y = floorY(8);
                player.floor = 3;
                player.y = floorY(3);
                player.x = s.x;
                player.mode = 'floor';
            });
            await hold(page, 'KeyE');
            await step(page, 20);
            expect(await page.evaluate(() => player.mode)).toBe('floor');
            const moved = await page.evaluate(() =>
                cars.some((c) => Math.abs(c.y - floorY(8)) > 0.5)
            );
            expect(moved).toBe(true);
        });

        test('Up or Down beside a shaft still means stairs and crouching', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(8);
                player.floor = 4;
                player.y = floorY(4);
                player.x = shafts[0].x - shafts[0].w / 2 - 4;
                player.mode = 'floor';
            });
            await hold(page, 'ArrowDown');
            await step(page, 20);
            expect(await page.evaluate(() => cars[0].y)).toBe(await page.evaluate(() => floorY(8)));
            const pose = await page.evaluate(() => player.mode);
            // Either a stairwell is underfoot, or the player simply crouches —
            // never a lift call.
            expect(['floor', 'ladder']).toContain(pose);
        });

        test('the call key does nothing away from a shaft', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(8);
                cars[1].y = floorY(8);
                player.floor = 4;
                player.y = floorY(4);
                player.x = 320;
                player.mode = 'floor';
            });
            await hold(page, 'KeyE');
            await step(page, 60);
            const moved = await page.evaluate(() =>
                cars.some((c) => Math.abs(c.y - floorY(8)) > 0.001)
            );
            expect(moved).toBe(false);
        });

        test('a player cannot walk out of a car between floors', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(6) - FLOOR_H / 2;
                player.mode = 'elevator';
                player.car = 0;
                player.x = shafts[0].x;
                player.y = cars[0].y;
            });
            await hold(page, 'ArrowLeft');
            await step(page, 120);
            expect(await page.evaluate(() => player.mode)).toBe('elevator');
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(
                await page.evaluate(() => cars[0].x - CAR_W / 2 - 1)
            );
        });
    });

    // -----------------------------------------------------------------------
    // Documents
    // -----------------------------------------------------------------------
    test.describe('documents', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quiet(page);
            await parkCars(page);
        });

        test('walking into a red door collects its document', async ({ page }) => {
            await page.evaluate(() => {
                const d = doors.find((x) => x.red);
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x;
                player.mode = 'floor';
            });
            await step(page, 2);
            expect(await page.evaluate(() => docsCollected)).toBe(1);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => DOC_POINTS));
            expect(await page.evaluate(() => doors.find((d) => d.red).open)).toBe(true);
            await expect(page.locator('#docs')).toHaveText('1/5');
        });

        test('a collected door does not pay twice', async ({ page }) => {
            await page.evaluate(() => {
                const d = doors.find((x) => x.red);
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x;
                player.mode = 'floor';
            });
            await step(page, 120);
            expect(await page.evaluate(() => docsCollected)).toBe(1);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => DOC_POINTS));
        });

        test('plain doors hold nothing', async ({ page }) => {
            await page.evaluate(() => {
                const d = doors.find((x) => !x.red);
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x;
                player.mode = 'floor';
            });
            await step(page, 10);
            expect(await page.evaluate(() => docsCollected)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('collecting every document is reflected in the HUD', async ({ page }) => {
            await page.evaluate(() => {
                doors.filter((d) => d.red).forEach((d) => collectDoor(d));
            });
            expect(await page.evaluate(() => docsCollected)).toBe(5);
            await expect(page.locator('#docs')).toHaveText('5/5');
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quiet(page);
            await parkCars(page);
            await place(page, { floor: 4, x: 320, dir: 1 });
        });

        test('holding Space fires a single bullet', async ({ page }) => {
            await hold(page, 'Space');
            await step(page, 1);
            expect(await page.evaluate(() => bullets.length)).toBe(1);
            expect(await page.evaluate(() => bullets[0].from)).toBe('player');
        });

        test('the shot cooldown stops the key being spammed', async ({ page }) => {
            await hold(page, 'Space');
            await step(page, 20);
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('the cooldown expires and a second shot follows', async ({ page }) => {
            await hold(page, 'Space');
            await step(page, 60);
            expect(await page.evaluate(() => bullets.length)).toBeGreaterThan(1);
        });

        test('a bullet flies in the direction the player faces', async ({ page }) => {
            await place(page, { dir: -1 });
            await hold(page, 'Space');
            await step(page, 1);
            expect(await page.evaluate(() => bullets[0].vx)).toBeLessThan(0);
        });

        test('bullets leave the building and are cleaned up', async ({ page }) => {
            await page.evaluate(() => {
                bullets.push({ x: W - 10, y: floorY(4) - TORSO, vx: BULLET_SPEED, from: 'player' });
            });
            await step(page, 60);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a bullet kills an agent and scores', async ({ page }) => {
            await page.evaluate(() => {
                enemies.push(makeEnemy(4, 420));
                bullets.push({ x: 400, y: floorY(4) - TORSO, vx: BULLET_SPEED, from: 'player' });
            });
            await step(page, 20);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => ENEMY_POINTS));
        });

        test('a player bullet passes agents on other floors', async ({ page }) => {
            await page.evaluate(() => {
                enemies.push(makeEnemy(6, 420));
                bullets.push({ x: 400, y: floorY(4) - TORSO, vx: BULLET_SPEED, from: 'player' });
            });
            await step(page, 20);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Agents
    // -----------------------------------------------------------------------
    test.describe('agents', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quiet(page);
            await parkCars(page);
        });

        test('an agent walks toward the player on its floor', async ({ page }) => {
            await place(page, { floor: 4, x: 200 });
            await page.evaluate(() => enemies.push(makeEnemy(4, 500)));
            await step(page, 60);
            expect(await page.evaluate(() => enemies[0].x)).toBeLessThan(500);
        });

        test('an agent shoots at a standing player', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await page.evaluate(() => {
                const e = makeEnemy(4, 420);
                e.cooldown = 0;
                enemies.push(e);
            });
            await step(page, 2);
            expect(await page.evaluate(() => bullets.filter((b) => b.from === 'enemy').length)).toBe(1);
        });

        test('enemy fire costs the standing player a life', async ({ page }) => {
            await place(page, { floor: 4, x: 300, crouch: false, invuln: 0 });
            await page.evaluate(() => {
                player.invuln = 0;
                bullets.push({ x: 330, y: floorY(4) - TORSO, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await step(page, 20);
            expect(await page.evaluate(() => lives)).toBe(2);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('enemy fire passes over a crouched player', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await hold(page, 'ArrowDown');
            await page.evaluate(() => {
                player.invuln = 0;
                bullets.push({ x: 360, y: floorY(4) - TORSO, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await step(page, 1);
            expect(await page.evaluate(() => player.crouch)).toBe(true);
            await step(page, 40);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('a player bullet does not hurt the player', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await page.evaluate(() => {
                player.invuln = 0;
                bullets.push({ x: 300, y: floorY(4) - TORSO, vx: BULLET_SPEED, from: 'player' });
            });
            await step(page, 5);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('walking into an agent costs a life', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await page.evaluate(() => {
                player.invuln = 0;
                enemies.push(makeEnemy(4, 306));
            });
            await step(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('losing a life clears the floor and grants brief immunity', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await page.evaluate(() => {
                player.invuln = 0;
                enemies.push(makeEnemy(4, 306));
                enemies.push(makeEnemy(4, 500));
            });
            await step(page, 2);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
            expect(await page.evaluate(() => player.invuln)).toBeGreaterThan(0);
        });

        test('immunity stops a second hit landing straight away', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await page.evaluate(() => {
                player.invuln = 1;
                enemies.push(makeEnemy(4, 302));
            });
            await step(page, 2);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('agents spawn from plain doors near the player', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await page.evaluate(() => {
                spawnTimer = 0;
                enemies.length = 0;
                player.invuln = 1e6; // the test is about where agents come from
            });
            await step(page, 600);
            const spawned = await page.evaluate(() => enemies.length);
            expect(spawned).toBeGreaterThan(0);
            const floors = await page.evaluate(() => enemies.map((e) => e.floor));
            floors.forEach((f) => expect(Math.abs(f - 4)).toBeLessThanOrEqual(1));
        });

        test('agents never outnumber the cap', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await page.evaluate(() => {
                player.invuln = 1e6;
                spawnTimer = 0;
            });
            await step(page, 3000);
            expect(await page.evaluate(() => enemies.length)).toBeLessThanOrEqual(
                await page.evaluate(() => MAX_ENEMIES)
            );
        });
    });

    // -----------------------------------------------------------------------
    // Escaping
    // -----------------------------------------------------------------------
    test.describe('escaping', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quiet(page);
        });

        test('reaching the getaway car with every document wins', async ({ page }) => {
            await page.evaluate(() => {
                doors.filter((d) => d.red).forEach((d) => collectDoor(d));
                score = 0;
                player.mode = 'floor';
                player.floor = FLOORS - 1;
                player.y = floorY(FLOORS - 1);
                player.x = ESCAPE_X - 1;
            });
            await step(page, 2);
            expect(await page.evaluate(() => state)).toBe('won');
            expect(await page.evaluate(() => score)).toBe(
                await page.evaluate(() => ESCAPE_BONUS + lives * LIFE_BONUS)
            );
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/escape|win/i);
        });

        test('reaching the getaway car without the documents does nothing', async ({ page }) => {
            await page.evaluate(() => {
                player.mode = 'floor';
                player.floor = FLOORS - 1;
                player.y = floorY(FLOORS - 1);
                player.x = ESCAPE_X - 1;
            });
            await step(page, 10);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a win is saved as the best score', async ({ page }) => {
            await page.evaluate(() => {
                doors.filter((d) => d.red).forEach((d) => collectDoor(d));
                player.mode = 'floor';
                player.floor = FLOORS - 1;
                player.y = floorY(FLOORS - 1);
                player.x = ESCAPE_X - 1;
            });
            await step(page, 2);
            const best = await page.evaluate(() => window.localStorage.getItem('elevatoraction-best'));
            expect(Number(best)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quiet(page);
            await parkCars(page);
        });

        test('running out of lives ends the game', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await page.evaluate(() => {
                lives = 1;
                player.invuln = 0;
                enemies.push(makeEnemy(4, 304));
            });
            await step(page, 2);
            expect(await page.evaluate(() => state)).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('a game over stores the best score', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await page.evaluate(() => {
                score = 4321;
                lives = 1;
                player.invuln = 0;
                enemies.push(makeEnemy(4, 304));
            });
            await step(page, 2);
            await expect(page.locator('#best')).toHaveText('4321');
            expect(await page.evaluate(() => window.localStorage.getItem('elevatoraction-best'))).toBe(
                '4321'
            );
        });

        test('a weaker run does not lower the best score', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '9000'));
            await page.reload();
            await startFrozen(page);
            await quiet(page);
            await place(page, { floor: 4, x: 300 });
            await page.evaluate(() => {
                score = 100;
                lives = 1;
                player.invuln = 0;
                enemies.push(makeEnemy(4, 304));
            });
            await step(page, 2);
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('the simulation stops once the game is over', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await page.evaluate(() => {
                lives = 1;
                player.invuln = 0;
                enemies.push(makeEnemy(4, 304));
            });
            await step(page, 2);
            const x = await page.evaluate(() => player.x);
            await hold(page, 'ArrowRight');
            await step(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(x);
        });

        test('Space after a game over starts a fresh run', async ({ page }) => {
            await place(page, { floor: 4, x: 300 });
            await page.evaluate(() => {
                score = 500;
                lives = 1;
                player.invuln = 0;
                enemies.push(makeEnemy(4, 304));
            });
            await step(page, 2);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => player.floor)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await startFrozen(page);
            await quiet(page);
            await parkCars(page);
            await place(page, { floor: 4, x: 300 });
            await page.keyboard.press('KeyP');
            await hold(page, 'ArrowRight');
            await step(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(300);
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
