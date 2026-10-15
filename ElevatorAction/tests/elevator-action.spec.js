const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a run and freeze the animation loop so a test can place the agent,
// the cars and the guards itself and advance the simulation one fixed step at
// a time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
        enemies.length = 0;
        bullets.length = 0;
        spawnCd = 1e6; // no guard walks in unless a test asks for one
    });
}

// Advance the frozen simulation by `steps` fixed timesteps (1/60 s each).
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(1 / 60);
    }, steps);
}

// Put the agent on a floor at a known x, out of any elevator.
async function placeAgent(page, floor, x) {
    await page.evaluate(([f, px]) => {
        player.riding = null;
        player.floor = f;
        player.y = floorY(f);
        player.x = px;
        player.invuln = 0;
    }, [floor, x]);
}

// Park both cars on given floors so a test knows exactly where they are.
async function parkCars(page, floors) {
    await page.evaluate((list) => {
        elevators.forEach((car, i) => {
            const f = list[i] === undefined ? car.floor : list[i];
            car.floor = f;
            car.y = floorY(f);
            car.targetFloor = f;
            car.moving = false;
        });
    }, floors);
}

const centerOfShaft = (shaft) => shaft.x + shaft.w / 2;

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
            await expect(page.locator('#docs')).toHaveText('4');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no guards, bullets or doors before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
            expect(await page.evaluate(() => doors.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '8600'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('8600');
        });

        test('the help legend explains riding, shooting and documents', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/elevator/i);
            await expect(page.locator('.help')).toContainText(/shoot|fire/i);
            await expect(page.locator('.help')).toContainText(/document/i);
        });

        test('the page loads without console errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
            await page.reload();
            await page.waitForTimeout(250);
            expect(errors).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Building geometry
    // -----------------------------------------------------------------------
    test.describe('building layout', () => {
        test('the building has 8 floors 68px apart', async ({ page }) => {
            expect(await page.evaluate(() => FLOORS)).toBe(8);
            expect(await page.evaluate(() => FLOOR_H)).toBe(68);
            expect(await page.evaluate(() => floorY(1))).toBe(568);
            expect(await page.evaluate(() => floorY(8))).toBe(92);
            expect(await page.evaluate(() => floorY(3) - floorY(4))).toBe(68);
        });

        test('every floor surface sits inside the canvas', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: FLOORS }, (_, i) => floorY(i + 1))
            );
            ys.forEach((y) => {
                expect(y).toBeGreaterThan(0);
                expect(y).toBeLessThan(640);
            });
        });

        test('there are two elevator shafts inside the canvas', async ({ page }) => {
            const shafts = await page.evaluate(() => SHAFTS);
            expect(shafts).toHaveLength(2);
            shafts.forEach((s) => {
                expect(s.x).toBeGreaterThan(0);
                expect(s.x + s.w).toBeLessThan(480);
            });
            expect(shafts[0].x + shafts[0].w).toBeLessThan(shafts[1].x);
        });

        test('shaftAt finds the shaft under an x and -1 elsewhere', async ({ page }) => {
            const shafts = await page.evaluate(() => SHAFTS);
            expect(await page.evaluate((x) => shaftAt(x), centerOfShaft(shafts[0]))).toBe(0);
            expect(await page.evaluate((x) => shaftAt(x), centerOfShaft(shafts[1]))).toBe(1);
            expect(await page.evaluate(() => shaftAt(10))).toBe(-1);
        });

        test('no door overlaps an elevator shaft', async ({ page }) => {
            await startFrozen(page);
            const bad = await page.evaluate(() =>
                doors.filter((d) =>
                    SHAFTS.some((s) => d.x < s.x + s.w && d.x + DOOR_W > s.x)
                ).length
            );
            expect(bad).toBe(0);
        });

        test('every door sits inside the canvas on a real floor', async ({ page }) => {
            await startFrozen(page);
            const bad = await page.evaluate(() =>
                doors.filter(
                    (d) => d.x < 0 || d.x + DOOR_W > 480 || d.floor < 1 || d.floor > FLOORS
                ).length
            );
            expect(bad).toBe(0);
        });

        test('the exit is on the ground floor and clear of the ground-floor doors', async ({ page }) => {
            await startFrozen(page);
            const exit = await page.evaluate(() => EXIT);
            expect(exit.floor).toBe(1);
            const clash = await page.evaluate(() =>
                doors.filter(
                    (d) => d.floor === EXIT.floor && d.x < EXIT.x + EXIT.w && d.x + DOOR_W > EXIT.x
                ).length
            );
            expect(clash).toBe(0);
        });

        test('an elevator car starts on a floor in each shaft', async ({ page }) => {
            await startFrozen(page);
            const cars = await page.evaluate(() =>
                elevators.map((c) => ({ floor: c.floor, moving: c.moving, y: c.y, shaft: c.shaft }))
            );
            expect(cars).toHaveLength(2);
            cars.forEach((c, i) => {
                expect(c.shaft).toBe(i);
                expect(c.floor).toBeGreaterThanOrEqual(1);
                expect(c.floor).toBeLessThanOrEqual(8);
                expect(c.moving).toBe(false);
            });
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting a run', () => {
        test('clicking Start Game starts the run and hides the overlay', async ({ page }) => {
            await page.click('#btn-start');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Space starts the run', async ({ page }) => {
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the agent starts on the top floor facing right', async ({ page }) => {
            await startFrozen(page);
            const p = await page.evaluate(() => ({
                floor: player.floor,
                y: player.y,
                dir: player.dir,
                riding: player.riding,
            }));
            expect(p.floor).toBe(8);
            expect(p.y).toBe(await page.evaluate(() => floorY(FLOORS)));
            expect(p.dir).toBe(1);
            expect(p.riding).toBeNull();
        });

        test('the agent does not spawn on top of a document door', async ({ page }) => {
            await startFrozen(page);
            const touching = await page.evaluate(() =>
                doors.filter((d) => d.floor === player.floor && overlaps(playerRect(), doorRect(d))).length
            );
            expect(touching).toBe(0);
        });

        test('a level hides exactly four documents behind red doors', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => DOCS_PER_LEVEL)).toBe(4);
            expect(await page.evaluate(() => doors.filter((d) => d.kind === 'red').length)).toBe(4);
            expect(await page.evaluate(() => docsLeft)).toBe(4);
            expect(await page.evaluate(() => docsTotal)).toBe(4);
            expect(await page.evaluate(() => docsRemaining())).toBe(4);
        });

        test('no document door starts opened', async ({ page }) => {
            await startFrozen(page);
            expect(
                await page.evaluate(() => doors.filter((d) => d.kind === 'red' && d.opened).length)
            ).toBe(0);
        });

        test('documents are never hidden on the ground floor', async ({ page }) => {
            await startFrozen(page);
            expect(
                await page.evaluate(() => doors.filter((d) => d.kind === 'red' && d.floor === 1).length)
            ).toBe(0);
        });

        test('a fresh run resets score, level and lives', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 4200;
                level = 3;
                lives = 1;
                startGame();
            });
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('the same level number always builds the same building', async ({ page }) => {
            const a = await page.evaluate(() => JSON.stringify(buildLevel(2)));
            const b = await page.evaluate(() => JSON.stringify(buildLevel(2)));
            expect(a).toBe(b);
        });
    });

    // -----------------------------------------------------------------------
    // Walking
    // -----------------------------------------------------------------------
    test.describe('walking', () => {
        test('holding right walks the agent right at the walking speed', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 8, 120);
            await page.keyboard.down('ArrowRight');
            await step(page, 60);
            await page.keyboard.up('ArrowRight');
            const x = await page.evaluate(() => player.x);
            expect(x - 120).toBeCloseTo(await page.evaluate(() => WALK_SPEED), 0);
            expect(await page.evaluate(() => player.dir)).toBe(1);
        });

        test('holding left walks the agent left and turns it around', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 8, 240);
            await page.keyboard.down('ArrowLeft');
            await step(page, 30);
            await page.keyboard.up('ArrowLeft');
            expect(await page.evaluate(() => player.x)).toBeLessThan(240);
            expect(await page.evaluate(() => player.dir)).toBe(-1);
        });

        test('A and D walk as well as the arrow keys', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 8, 240);
            await page.keyboard.down('d');
            await step(page, 10);
            await page.keyboard.up('d');
            const right = await page.evaluate(() => player.x);
            expect(right).toBeGreaterThan(240);
            await page.keyboard.down('a');
            await step(page, 20);
            await page.keyboard.up('a');
            expect(await page.evaluate(() => player.x)).toBeLessThan(right);
        });

        test('the agent cannot walk out of the building', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 8, 120);
            await page.keyboard.down('ArrowLeft');
            await step(page, 240);
            await page.keyboard.up('ArrowLeft');
            expect(await page.evaluate(() => player.x)).toBeGreaterThanOrEqual(
                await page.evaluate(() => PLAYER_W / 2)
            );
            await page.keyboard.down('ArrowRight');
            await step(page, 480);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => player.x)).toBeLessThanOrEqual(
                await page.evaluate(() => 480 - PLAYER_W / 2)
            );
        });

        test('walking keeps the agent on its floor', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 5, 240);
            await page.keyboard.down('ArrowRight');
            await step(page, 30);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => player.y)).toBe(await page.evaluate(() => floorY(5)));
            expect(await page.evaluate(() => player.floor)).toBe(5);
        });

        test('nothing simulates while the run is idle', async ({ page }) => {
            await page.evaluate(() => {
                autoRun = false;
            });
            const before = await page.evaluate(() => JSON.stringify({ enemies, bullets }));
            await step(page, 60);
            expect(await page.evaluate(() => JSON.stringify({ enemies, bullets }))).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Elevators
    // -----------------------------------------------------------------------
    test.describe('elevators', () => {
        test('pressing up away from a shaft does nothing', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 8, 120);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.riding)).toBeNull();
            expect(await page.evaluate(() => elevators.some((c) => c.moving))).toBe(false);
        });

        test('pressing up inside a shaft with the car there boards it and goes up', async ({ page }) => {
            await startFrozen(page);
            await parkCars(page, [4, 4]);
            const shafts = await page.evaluate(() => SHAFTS);
            await placeAgent(page, 4, centerOfShaft(shafts[0]));
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.riding)).not.toBeNull();
            expect(await page.evaluate(() => elevators[0].moving)).toBe(true);
            expect(await page.evaluate(() => elevators[0].targetFloor)).toBe(5);
        });

        test('boarding snaps the agent to the middle of the car', async ({ page }) => {
            await startFrozen(page);
            await parkCars(page, [4, 4]);
            const shafts = await page.evaluate(() => SHAFTS);
            await placeAgent(page, 4, shafts[0].x + 4);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.x)).toBeCloseTo(centerOfShaft(shafts[0]), 5);
        });

        test('a riding agent travels with the car and lands on the next floor', async ({ page }) => {
            await startFrozen(page);
            await parkCars(page, [4, 4]);
            const shafts = await page.evaluate(() => SHAFTS);
            await placeAgent(page, 4, centerOfShaft(shafts[0]));
            await page.keyboard.press('ArrowUp');
            await step(page, 10);
            expect(await page.evaluate(() => player.y)).toBe(await page.evaluate(() => elevators[0].y));
            expect(await page.evaluate(() => player.y)).toBeLessThan(await page.evaluate(() => floorY(4)));
            await step(page, 120);
            expect(await page.evaluate(() => elevators[0].moving)).toBe(false);
            expect(await page.evaluate(() => elevators[0].floor)).toBe(5);
            expect(await page.evaluate(() => elevators[0].y)).toBe(await page.evaluate(() => floorY(5)));
            expect(await page.evaluate(() => player.floor)).toBe(5);
        });

        test('down takes a riding agent one floor lower', async ({ page }) => {
            await startFrozen(page);
            await parkCars(page, [4, 4]);
            const shafts = await page.evaluate(() => SHAFTS);
            await placeAgent(page, 4, centerOfShaft(shafts[0]));
            await page.keyboard.press('ArrowDown');
            await step(page, 120);
            expect(await page.evaluate(() => elevators[0].floor)).toBe(3);
            expect(await page.evaluate(() => player.floor)).toBe(3);
        });

        test('a car never leaves the building', async ({ page }) => {
            await startFrozen(page);
            await parkCars(page, [1, 8]);
            const shafts = await page.evaluate(() => SHAFTS);
            await placeAgent(page, 1, centerOfShaft(shafts[0]));
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => elevators[0].targetFloor)).toBe(1);
            expect(await page.evaluate(() => elevators[0].moving)).toBe(false);
            await page.evaluate(() => {
                player.riding = null;
            });
            await placeAgent(page, 8, centerOfShaft(shafts[1]));
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => elevators[1].targetFloor)).toBe(8);
            expect(await page.evaluate(() => elevators[1].moving)).toBe(false);
        });

        test('a car in flight ignores further floor requests', async ({ page }) => {
            await startFrozen(page);
            await parkCars(page, [4, 4]);
            const shafts = await page.evaluate(() => SHAFTS);
            await placeAgent(page, 4, centerOfShaft(shafts[0]));
            await page.keyboard.press('ArrowUp');
            await step(page, 5);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => elevators[0].targetFloor)).toBe(5);
        });

        test('pressing up in a shaft whose car is elsewhere calls the car down', async ({ page }) => {
            await startFrozen(page);
            await parkCars(page, [7, 4]);
            const shafts = await page.evaluate(() => SHAFTS);
            await placeAgent(page, 2, centerOfShaft(shafts[0]));
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.riding)).toBeNull();
            expect(await page.evaluate(() => elevators[0].moving)).toBe(true);
            expect(await page.evaluate(() => elevators[0].targetFloor)).toBe(2);
        });

        test('a called car stops at the waiting agent and can then be boarded', async ({ page }) => {
            await startFrozen(page);
            await parkCars(page, [5, 4]);
            const shafts = await page.evaluate(() => SHAFTS);
            await placeAgent(page, 2, centerOfShaft(shafts[0]));
            await page.keyboard.press('ArrowUp');
            await step(page, 600);
            expect(await page.evaluate(() => elevators[0].floor)).toBe(2);
            expect(await page.evaluate(() => elevators[0].moving)).toBe(false);
            expect(await page.evaluate(() => player.riding)).toBeNull();
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.riding)).not.toBeNull();
        });

        test('stepping sideways out of a stopped car leaves it on that floor', async ({ page }) => {
            await startFrozen(page);
            await parkCars(page, [4, 4]);
            const shafts = await page.evaluate(() => SHAFTS);
            await placeAgent(page, 4, centerOfShaft(shafts[0]));
            await page.keyboard.press('ArrowUp');
            await step(page, 120);
            await page.keyboard.down('ArrowRight');
            await step(page, 10);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => player.riding)).toBeNull();
            expect(await page.evaluate(() => player.floor)).toBe(5);
            expect(await page.evaluate(() => player.y)).toBe(await page.evaluate(() => floorY(5)));
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(centerOfShaft(shafts[0]));
        });

        test('the agent cannot step out of a moving car', async ({ page }) => {
            await startFrozen(page);
            await parkCars(page, [4, 4]);
            const shafts = await page.evaluate(() => SHAFTS);
            await placeAgent(page, 4, centerOfShaft(shafts[0]));
            await page.keyboard.press('ArrowUp');
            await step(page, 5);
            await page.keyboard.down('ArrowRight');
            await step(page, 5);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => player.riding)).not.toBeNull();
            expect(await page.evaluate(() => player.x)).toBeCloseTo(centerOfShaft(shafts[0]), 5);
        });

        test('W and S work like up and down', async ({ page }) => {
            await startFrozen(page);
            await parkCars(page, [4, 4]);
            const shafts = await page.evaluate(() => SHAFTS);
            await placeAgent(page, 4, centerOfShaft(shafts[1]));
            await page.keyboard.press('w');
            expect(await page.evaluate(() => elevators[1].targetFloor)).toBe(5);
            await step(page, 120);
            await page.keyboard.press('s');
            expect(await page.evaluate(() => elevators[1].targetFloor)).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('Space fires a shot in the direction the agent faces', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 8, 240);
            await page.keyboard.press(' ');
            const shots = await page.evaluate(() => bullets.map((b) => ({ vx: b.vx, from: b.from })));
            expect(shots).toHaveLength(1);
            expect(shots[0].from).toBe('player');
            expect(shots[0].vx).toBeGreaterThan(0);
        });

        test('facing left fires to the left', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 8, 240);
            await page.keyboard.down('ArrowLeft');
            await step(page, 5);
            await page.keyboard.up('ArrowLeft');
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => bullets[0].vx)).toBeLessThan(0);
        });

        test('shots leave from chest height on the agent floor', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 5, 240);
            await page.keyboard.press(' ');
            const b = await page.evaluate(() => ({ x: bullets[0].x, y: bullets[0].y }));
            expect(b.y).toBeLessThan(await page.evaluate(() => floorY(5)));
            expect(b.y).toBeGreaterThan(await page.evaluate(() => floorY(5) - PLAYER_H));
            expect(b.x).toBeGreaterThan(240);
        });

        test('the gun has a cooldown between shots', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 8, 240);
            await page.keyboard.press(' ');
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
            await step(page, 30);
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => bullets.length)).toBe(2);
        });

        test('at most three of the agent shots are in the air', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 8, 60);
            for (let i = 0; i < 6; i++) {
                await page.evaluate(() => {
                    player.fireCd = 0;
                    fire();
                });
            }
            expect(await page.evaluate(() => bullets.filter((b) => b.from === 'player').length)).toBe(3);
        });

        test('a shot flies across the floor and is dropped at the wall', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 8, 240);
            await page.keyboard.press(' ');
            const x0 = await page.evaluate(() => bullets[0].x);
            await step(page, 6);
            expect(await page.evaluate(() => bullets[0].x)).toBeGreaterThan(x0);
            await step(page, 240);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a shot drops a guard on the same floor and scores it', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 6, 200);
            await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: 260, y: floorY(6), floor: 6, dir: -1, fireCd: 99, speed: 0 });
                score = 0;
            });
            await page.keyboard.press(' ');
            await step(page, 30);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => KILL_POINTS));
        });

        test('a shot passes guards on other floors by', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 6, 200);
            await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: 260, y: floorY(3), floor: 3, dir: -1, fireCd: 99, speed: 0 });
            });
            await page.keyboard.press(' ');
            await step(page, 30);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
        });

        test('a guard shot cannot hurt another guard', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: 300, y: floorY(6), floor: 6, dir: -1, fireCd: 99, speed: 0 });
                bullets.push({ x: 320, y: floorY(6) - 16, vx: -300, from: 'enemy' });
            });
            await step(page, 20);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Guards
    // -----------------------------------------------------------------------
    test.describe('guards', () => {
        test('a guard walks out of a door on the floor it is sent to', async ({ page }) => {
            await startFrozen(page);
            const spawned = await page.evaluate(() => {
                const e = spawnEnemy(5);
                return { floor: e.floor, y: e.y, atDoor: doors.some((d) => d.floor === 5 && Math.abs(d.x + DOOR_W / 2 - e.x) < 1) };
            });
            expect(spawned.floor).toBe(5);
            expect(spawned.y).toBe(await page.evaluate(() => floorY(5)));
            expect(spawned.atDoor).toBe(true);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
        });

        test('guards never come out of a document door', async ({ page }) => {
            await startFrozen(page);
            const fromRed = await page.evaluate(() => {
                let bad = 0;
                for (let f = 2; f <= FLOORS; f++) {
                    for (let i = 0; i < 6; i++) {
                        const e = spawnEnemy(f);
                        if (
                            doors.some(
                                (d) => d.kind === 'red' && d.floor === f && Math.abs(d.x + DOOR_W / 2 - e.x) < 1
                            )
                        )
                            bad++;
                    }
                }
                return bad;
            });
            expect(fromRed).toBe(0);
        });

        test('a guard on the agent floor walks toward the agent', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 4, 100);
            await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: 400, y: floorY(4), floor: 4, dir: 1, fireCd: 99, speed: 60 });
            });
            await step(page, 30);
            expect(await page.evaluate(() => enemies[0].x)).toBeLessThan(400);
            expect(await page.evaluate(() => enemies[0].dir)).toBe(-1);
        });

        test('a guard on another floor patrols and turns at the wall', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 8, 120);
            await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: 450, y: floorY(2), floor: 2, dir: 1, fireCd: 99, speed: 60 });
            });
            await step(page, 60);
            expect(await page.evaluate(() => enemies[0].dir)).toBe(-1);
            expect(await page.evaluate(() => enemies[0].x)).toBeLessThanOrEqual(480);
        });

        test('a guard shoots when it faces the agent on its floor', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 4, 150);
            await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: 300, y: floorY(4), floor: 4, dir: -1, fireCd: 0, speed: 0 });
                player.invuln = 99;
            });
            await step(page, 2);
            const shots = await page.evaluate(() => bullets.filter((b) => b.from === 'enemy'));
            expect(shots.length).toBe(1);
            expect(shots[0].vx).toBeLessThan(0);
        });

        test('a guard holds its fire while it faces away', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 4, 150);
            await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: 300, y: floorY(4), floor: 4, dir: 1, fireCd: 0, speed: 0 });
                player.invuln = 99;
            });
            await step(page, 2);
            expect(await page.evaluate(() => bullets.filter((b) => b.from === 'enemy').length)).toBe(0);
        });

        test('a guard on another floor never shoots', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 4, 150);
            await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: 300, y: floorY(7), floor: 7, dir: -1, fireCd: 0, speed: 0 });
                player.invuln = 99;
            });
            await step(page, 20);
            expect(await page.evaluate(() => bullets.filter((b) => b.from === 'enemy').length)).toBe(0);
        });

        test('a guard reloads between shots', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 4, 150);
            await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: 300, y: floorY(4), floor: 4, dir: -1, fireCd: 0, speed: 0 });
                player.invuln = 99;
            });
            await step(page, 3);
            expect(await page.evaluate(() => bullets.filter((b) => b.from === 'enemy').length)).toBe(1);
            await page.evaluate(() => {
                bullets.length = 0;
            });
            await step(page, 3);
            expect(await page.evaluate(() => bullets.filter((b) => b.from === 'enemy').length)).toBe(0);
        });

        test('a guard that patrols an empty floor goes back through its door', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 8, 120);
            await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemy(2);
            });
            expect(await page.evaluate(() => enemies.length)).toBe(1);
            await step(page, 60 * 12);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('a guard on the agent floor keeps its patience', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 4, 240);
            await page.evaluate(() => {
                player.invuln = 1e6;
                enemies.length = 0;
                enemies.push({ x: 60, y: floorY(4), floor: 4, dir: 1, fireCd: 1e6, speed: 0, patience: 1 });
            });
            await step(page, 60 * 12);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
            expect(await page.evaluate(() => enemies[0].patience)).toBe(
                await page.evaluate(() => GUARD_PATIENCE)
            );
        });

        test('a guard never steps out right next to the agent', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 5, 240);
            const tooClose = await page.evaluate(() => {
                let bad = 0;
                for (let i = 0; i < 40; i++) {
                    enemies.length = 0;
                    const e = spawnEnemy(player.floor);
                    if (Math.abs(e.x - player.x) <= SAFE_SPAWN_GAP) bad++;
                }
                return bad;
            });
            expect(tooClose).toBe(0);
        });

        test('most guards are sent to the agent floor or next to it', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 4, 240);
            const near = await page.evaluate(() => {
                let n = 0;
                for (let i = 0; i < 200; i++) {
                    if (Math.abs(pickSpawnFloor() - player.floor) <= 1) n++;
                }
                return n;
            });
            expect(near).toBeGreaterThan(100);
        });

        test('the building sends more guards on later levels', async ({ page }) => {
            const a = await page.evaluate(() => [maxEnemies(1), spawnInterval(1), enemySpeed(1)]);
            const b = await page.evaluate(() => [maxEnemies(4), spawnInterval(4), enemySpeed(4)]);
            expect(b[0]).toBeGreaterThan(a[0]);
            expect(b[1]).toBeLessThan(a[1]);
            expect(b[2]).toBeGreaterThan(a[2]);
        });

        test('guards arrive on their own while the run is on', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                spawnCd = 0;
            });
            await step(page, 2);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
            expect(await page.evaluate(() => spawnCd)).toBeGreaterThan(0);
        });

        test('no more than the level cap of guards is in the building', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                for (let i = 0; i < 40; i++) {
                    spawnCd = 0;
                    physicsStep(1 / 60);
                }
            });
            expect(await page.evaluate(() => enemies.length)).toBeLessThanOrEqual(
                await page.evaluate(() => maxEnemies(level))
            );
        });
    });

    // -----------------------------------------------------------------------
    // Getting hit
    // -----------------------------------------------------------------------
    test.describe('getting hit', () => {
        test('a guard shot costs a life and sends the agent back to the roof', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 3, 240);
            await page.evaluate(() => {
                bullets.push({ x: 250, y: floorY(3) - 16, vx: -300, from: 'enemy' });
            });
            await step(page, 10);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => player.floor)).toBe(8);
            expect(await page.evaluate(() => player.riding)).toBeNull();
            expect(await page.evaluate(() => player.invuln)).toBeGreaterThan(0);
        });

        test('the shot that hit is cleared away', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 3, 240);
            await page.evaluate(() => {
                bullets.push({ x: 250, y: floorY(3) - 16, vx: -300, from: 'enemy' });
            });
            await step(page, 10);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a fresh agent is briefly untouchable', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 3, 240);
            await page.evaluate(() => {
                player.invuln = 1;
                bullets.push({ x: 250, y: floorY(3) - 16, vx: -300, from: 'enemy' });
            });
            await step(page, 6);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('invulnerability wears off', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                player.invuln = 0.1;
            });
            await step(page, 20);
            expect(await page.evaluate(() => player.invuln)).toBe(0);
        });

        test('walking into a guard costs a life', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 3, 240);
            await page.evaluate(() => {
                enemies.length = 0;
                enemies.push({ x: 244, y: floorY(3), floor: 3, dir: -1, fireCd: 99, speed: 0 });
            });
            await step(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('documents already collected survive a hit', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                docsLeft = 2;
                doors.filter((d) => d.kind === 'red').slice(0, 2).forEach((d) => (d.opened = true));
                player.invuln = 0;
                bullets.push({ x: player.x, y: player.y - 16, vx: -300, from: 'enemy' });
            });
            await step(page, 4);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => docsLeft)).toBe(2);
        });

        test('the last life ends the run', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 3, 240);
            await page.evaluate(() => {
                lives = 1;
                bullets.push({ x: 250, y: floorY(3) - 16, vx: -300, from: 'enemy' });
            });
            await step(page, 10);
            expect(await page.evaluate(() => state)).toBe('gameover');
            expect(await page.evaluate(() => lives)).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('Space starts a new run after a game over', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 1;
                player.invuln = 0;
                hitPlayer();
            });
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Documents and the exit
    // -----------------------------------------------------------------------
    test.describe('documents and the exit', () => {
        test('standing at a red door takes the document', async ({ page }) => {
            await startFrozen(page);
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.kind === 'red');
                player.riding = null;
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x + DOOR_W / 2;
                score = 0;
                return { floor: d.floor, x: d.x };
            });
            await step(page, 2);
            expect(await page.evaluate(() => docsLeft)).toBe(3);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => DOC_POINTS));
            expect(
                await page.evaluate(
                    (d) => doors.find((x) => x.floor === d.floor && x.x === d.x).opened,
                    door
                )
            ).toBe(true);
            await expect(page.locator('#docs')).toHaveText('3');
        });

        test('a door cannot be looted twice', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                const d = doors.find((x) => x.kind === 'red');
                player.riding = null;
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x + DOOR_W / 2;
                score = 0;
            });
            await step(page, 60);
            expect(await page.evaluate(() => docsLeft)).toBe(3);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => DOC_POINTS));
        });

        test('plain doors hold nothing', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                const d = doors.find((x) => x.kind === 'plain' && x.floor > 1);
                player.riding = null;
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x + DOOR_W / 2;
                score = 0;
            });
            await step(page, 10);
            expect(await page.evaluate(() => docsLeft)).toBe(4);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('a red door one floor away is not collected', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                const d = doors.find((x) => x.kind === 'red' && x.floor > 2);
                player.riding = null;
                player.floor = d.floor - 1;
                player.y = floorY(d.floor - 1);
                player.x = d.x + DOOR_W / 2;
            });
            await step(page, 10);
            expect(await page.evaluate(() => docsLeft)).toBe(4);
        });

        test('the exit stays shut while documents are missing', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                player.riding = null;
                player.floor = 1;
                player.y = floorY(1);
                player.x = EXIT.x + EXIT.w / 2;
            });
            await step(page, 10);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('reaching the exit with every document clears the level', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                doors.forEach((d) => {
                    if (d.kind === 'red') d.opened = true;
                });
                docsLeft = 0;
                score = 0;
                lives = 3;
                player.riding = null;
                player.floor = 1;
                player.y = floorY(1);
                player.x = EXIT.x + EXIT.w / 2;
            });
            await step(page, 2);
            expect(await page.evaluate(() => state)).toBe('levelclear');
            expect(await page.evaluate(() => score)).toBe(
                await page.evaluate(() => LEVEL_BONUS + LIFE_BONUS * 3)
            );
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/clear|escap/i);
        });

        test('Space after a clear starts the next level', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                docsLeft = 0;
                completeLevel();
            });
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => docsLeft)).toBe(4);
            expect(await page.evaluate(() => player.floor)).toBe(8);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('lives carry over into the next level', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 2;
                docsLeft = 0;
                completeLevel();
                nextLevel();
            });
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and shows the overlay', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('a paused building does not move', async ({ page }) => {
            await startFrozen(page);
            await placeAgent(page, 4, 240);
            await page.evaluate(() => {
                enemies.push({ x: 400, y: floorY(4), floor: 4, dir: -1, fireCd: 99, speed: 60 });
            });
            await page.keyboard.press('p');
            const before = await page.evaluate(() => enemies[0].x);
            await page.keyboard.down('ArrowRight');
            await step(page, 30);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => enemies[0].x)).toBe(before);
            expect(await page.evaluate(() => player.x)).toBe(240);
        });

        test('P again resumes the run', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('P does nothing before a run starts', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('shooting is off while paused', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('p');
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => bullets.length)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('paused');
        });
    });

    // -----------------------------------------------------------------------
    // Score keeping
    // -----------------------------------------------------------------------
    test.describe('score keeping', () => {
        test('the HUD follows the score, docs and lives', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 1234;
                lives = 2;
                docsLeft = 1;
            });
            await step(page, 1);
            await expect(page.locator('#score')).toHaveText('1234');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#docs')).toHaveText('1');
        });

        test('a game over stores the best score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 5500;
                lives = 1;
                player.invuln = 0;
                hitPlayer();
            });
            expect(await page.evaluate(() => best)).toBe(5500);
            expect(
                await page.evaluate(() => window.localStorage.getItem('elevatoraction-best'))
            ).toBe('5500');
            await expect(page.locator('#best')).toHaveText('5500');
        });

        test('a lower score leaves the best alone', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '9000'));
            await page.reload();
            await startFrozen(page);
            await page.evaluate(() => {
                score = 120;
                lives = 1;
                player.invuln = 0;
                hitPlayer();
            });
            expect(await page.evaluate(() => best)).toBe(9000);
        });

        test('clearing a level can set a new best', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 7000;
                docsLeft = 0;
                completeLevel();
            });
            expect(await page.evaluate(() => best)).toBeGreaterThanOrEqual(7000);
        });
    });

    // -----------------------------------------------------------------------
    // The live loop
    // -----------------------------------------------------------------------
    test.describe('the live game', () => {
        test('the run advances on its own once started', async ({ page }) => {
            await page.click('#btn-start');
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(350);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(120);
        });

        test('guards show up without being asked', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnCd = 0.05;
            });
            await page.waitForTimeout(400);
            expect(await page.evaluate(() => enemies.length)).toBeGreaterThan(0);
        });

        test('a live run throws no errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.click('#btn-start');
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(400);
            await page.keyboard.up('ArrowRight');
            await page.keyboard.press(' ');
            await page.keyboard.press('ArrowUp');
            await page.waitForTimeout(400);
            expect(errors).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Repository integration
    // -----------------------------------------------------------------------
    test.describe('repository integration', () => {
        test('the game browser catalogue lists the game', () => {
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
