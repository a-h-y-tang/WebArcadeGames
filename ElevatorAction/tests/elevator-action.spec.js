const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a level and freeze the animation loop so a test can place the spy and
// the agents itself and advance the simulation one fixed timestep at a time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
    });
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(DT);
    }, steps);
}

// Stand the spy on a known floor at a known x, with nothing in flight.
async function placePlayer(page, x, floor) {
    await page.evaluate(
        ({ x, floor }) => {
            player.x = x;
            player.y = FLOOR_Y[floor];
            player.vy = 0;
            player.onCar = null;
            player.invuln = 0;
            player.cooldown = 0;
        },
        { x, floor }
    );
}

// Park an elevator car at a given floor, stationary.
async function placeCar(page, index, floor) {
    await page.evaluate(
        ({ index, floor }) => {
            const car = elevators[index];
            car.floor = floor;
            car.target = floor;
            car.y = FLOOR_Y[floor];
            car.moving = false;
        },
        { index, floor }
    );
}

// Empty the board of everything that moves on its own, and push the next agent
// spawn far into the future, so a test only sees what it put there itself.
async function clearActors(page) {
    await page.evaluate(() => {
        agents.length = 0;
        bullets.length = 0;
        spawnTimer = 9999;
    });
}

async function readPlayer(page) {
    return page.evaluate(() => ({
        x: player.x,
        y: player.y,
        vy: player.vy,
        dir: player.dir,
        onCar: player.onCar,
        invuln: player.invuln,
    }));
}

// Mark every document as collected without moving the spy.
async function collectAllDocs(page) {
    await page.evaluate(() => {
        doors.forEach((d) => {
            if (d.type === 'red') d.collected = true;
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
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no doors, agents or bullets before starting', async ({ page }) => {
            expect(await page.evaluate(() => doors.length)).toBe(0);
            expect(await page.evaluate(() => agents.length)).toBe(0);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '12500'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('12500');
        });

        test('the help legend explains moving, riding and shooting', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/move/i);
            await expect(page.locator('.help')).toContainText(/elevator/i);
            await expect(page.locator('.help')).toContainText(/shoot/i);
        });
    });

    // -----------------------------------------------------------------------
    // Building geometry
    // -----------------------------------------------------------------------
    test.describe('the building', () => {
        test('the building has ten floors', async ({ page }) => {
            expect(await page.evaluate(() => FLOOR_COUNT)).toBe(10);
            expect(await page.evaluate(() => FLOOR_Y.length)).toBe(10);
        });

        test('floors are evenly spaced going down', async ({ page }) => {
            const gaps = await page.evaluate(() =>
                FLOOR_Y.slice(1).map((y, i) => y - FLOOR_Y[i])
            );
            expect(new Set(gaps).size).toBe(1);
            expect(gaps[0]).toBe(await page.evaluate(() => FLOOR_H));
        });

        test('the whole building fits in the world and the world is taller than the canvas', async ({
            page,
        }) => {
            const { worldH, lastFloor, h } = await page.evaluate(() => ({
                worldH: WORLD_H,
                lastFloor: FLOOR_Y[FLOOR_COUNT - 1],
                h: H,
            }));
            expect(worldH).toBeGreaterThan(h);
            expect(lastFloor).toBeLessThan(worldH);
        });

        test('there are two elevator shafts, clear of each other', async ({ page }) => {
            const shafts = await page.evaluate(() => SHAFTS.map((s) => ({ x: s.x, w: s.w })));
            expect(shafts).toHaveLength(2);
            expect(shafts[0].x + shafts[0].w).toBeLessThan(shafts[1].x);
        });

        test('inShaft reports the shaft under a point', async ({ page }) => {
            const probe = await page.evaluate(() => ({
                left: inShaft(SHAFTS[0].x + SHAFTS[0].w / 2),
                right: inShaft(SHAFTS[1].x + SHAFTS[1].w / 2),
                wall: inShaft(10),
                between: inShaft((SHAFTS[0].x + SHAFTS[0].w + SHAFTS[1].x) / 2),
            }));
            expect(probe.left).toBe(0);
            expect(probe.right).toBe(1);
            expect(probe.wall).toBe(-1);
            expect(probe.between).toBe(-1);
        });

        test('floorIndexFor maps a floor surface back to its index', async ({ page }) => {
            const idx = await page.evaluate(() => FLOOR_Y.map((y) => floorIndexFor(y)));
            expect(idx).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        });

        test('the exit sits on the bottom floor clear of the shafts', async ({ page }) => {
            const ok = await page.evaluate(
                () => inShaft(EXIT.x) === -1 && inShaft(EXIT.x + EXIT.w) === -1 && EXIT.w > 20
            );
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
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

        test('the spy starts on the top floor', async ({ page }) => {
            await startFrozen(page);
            const p = await readPlayer(page);
            expect(p.y).toBe(await page.evaluate(() => FLOOR_Y[0]));
            expect(await page.evaluate(() => floorIndexFor(player.y))).toBe(0);
        });

        test('the spy starts clear of the shafts and of any door', async ({ page }) => {
            await startFrozen(page);
            const ok = await page.evaluate(
                () =>
                    inShaft(player.x) === -1 &&
                    !doors.some((d) => d.floor === 0 && Math.abs(d.x - player.x) < DOOR_W)
            );
            expect(ok).toBe(true);
        });

        test('the building is stocked with doors', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => doors.length)).toBeGreaterThan(20);
        });

        test('every door is clear of the shafts and inside the building', async ({ page }) => {
            await startFrozen(page);
            const ok = await page.evaluate(() =>
                doors.every(
                    (d) =>
                        inShaft(d.x - DOOR_W / 2) === -1 &&
                        inShaft(d.x + DOOR_W / 2) === -1 &&
                        d.x > DOOR_W &&
                        d.x < W - DOOR_W
                )
            );
            expect(ok).toBe(true);
        });

        test('doors only use the two known types', async ({ page }) => {
            await startFrozen(page);
            const known = await page.evaluate(() =>
                doors.every((d) => d.type === 'red' || d.type === 'grey')
            );
            expect(known).toBe(true);
        });

        test('the bottom floor is a clear lobby with no doors', async ({ page }) => {
            await startFrozen(page);
            const onBottom = await page.evaluate(() =>
                doors.filter((d) => d.floor === FLOOR_COUNT - 1).length
            );
            expect(onBottom).toBe(0);
        });

        test('a level hides exactly DOC_COUNT documents', async ({ page }) => {
            await startFrozen(page);
            const { docs, want } = await page.evaluate(() => ({ docs: docsLeft(), want: DOC_COUNT }));
            expect(docs).toBe(want);
        });

        test('documents are spread over different floors', async ({ page }) => {
            await startFrozen(page);
            const floors = await page.evaluate(() =>
                doors.filter((d) => d.type === 'red').map((d) => d.floor)
            );
            expect(new Set(floors).size).toBe(floors.length);
        });

        test('no document is collected yet', async ({ page }) => {
            await startFrozen(page);
            const any = await page.evaluate(() => doors.some((d) => d.collected));
            expect(any).toBe(false);
        });

        test('both elevator cars start parked at a floor', async ({ page }) => {
            await startFrozen(page);
            const cars = await page.evaluate(() =>
                elevators.map((c) => ({ y: c.y, at: FLOOR_Y.includes(c.y), moving: c.moving }))
            );
            expect(cars).toHaveLength(2);
            cars.forEach((c) => {
                expect(c.at).toBe(true);
                expect(c.moving).toBe(false);
            });
        });

        test('the level starts with three lives and no agents on the board', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => agents.length)).toBe(0);
        });

        test('the HUD reports the documents left and the current floor', async ({ page }) => {
            await startFrozen(page);
            await expect(page.locator('#docs')).toHaveText(String(await page.evaluate(() => docsLeft())));
            await expect(page.locator('#floor')).toHaveText('10');
        });

        test('restarting resets score, lives and documents', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 4200;
                lives = 1;
                doors.forEach((d) => (d.collected = true));
            });
            await startFrozen(page);
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => docsLeft())).toBe(await page.evaluate(() => DOC_COUNT));
        });
    });

    // -----------------------------------------------------------------------
    // Walking
    // -----------------------------------------------------------------------
    test.describe('walking', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearActors(page);
        });

        test('holding ArrowRight walks the spy right', async ({ page }) => {
            await placePlayer(page, 200, 0);
            await page.keyboard.down('ArrowRight');
            await step(page, 30);
            await page.keyboard.up('ArrowRight');
            expect((await readPlayer(page)).x).toBeGreaterThan(200);
        });

        test('holding ArrowLeft walks the spy left', async ({ page }) => {
            await placePlayer(page, 200, 0);
            await page.keyboard.down('ArrowLeft');
            await step(page, 30);
            await page.keyboard.up('ArrowLeft');
            expect((await readPlayer(page)).x).toBeLessThan(200);
        });

        test('D and A also walk', async ({ page }) => {
            await placePlayer(page, 200, 0);
            await page.keyboard.down('KeyD');
            await step(page, 20);
            await page.keyboard.up('KeyD');
            const right = (await readPlayer(page)).x;
            expect(right).toBeGreaterThan(200);
            await page.keyboard.down('KeyA');
            await step(page, 40);
            await page.keyboard.up('KeyA');
            expect((await readPlayer(page)).x).toBeLessThan(right);
        });

        test('walking sets the facing direction', async ({ page }) => {
            await placePlayer(page, 200, 0);
            await page.keyboard.down('ArrowLeft');
            await step(page, 2);
            await page.keyboard.up('ArrowLeft');
            expect((await readPlayer(page)).dir).toBe(-1);
            await page.keyboard.down('ArrowRight');
            await step(page, 2);
            await page.keyboard.up('ArrowRight');
            expect((await readPlayer(page)).dir).toBe(1);
        });

        test('the spy walks at MOVE_SPEED', async ({ page }) => {
            await placePlayer(page, 200, 0);
            const { speed, dt } = await page.evaluate(() => ({ speed: MOVE_SPEED, dt: DT }));
            await page.keyboard.down('ArrowRight');
            await step(page, 60);
            await page.keyboard.up('ArrowRight');
            expect((await readPlayer(page)).x).toBeCloseTo(200 + speed * dt * 60, 1);
        });

        test('the spy cannot walk out through the left wall', async ({ page }) => {
            await placePlayer(page, 40, 0);
            await page.keyboard.down('ArrowLeft');
            await step(page, 200);
            await page.keyboard.up('ArrowLeft');
            const x = (await readPlayer(page)).x;
            expect(x).toBeGreaterThanOrEqual(await page.evaluate(() => PLAYER_W / 2));
        });

        test('the spy cannot walk out through the right wall', async ({ page }) => {
            await placePlayer(page, 440, 0);
            await page.keyboard.down('ArrowRight');
            await step(page, 200);
            await page.keyboard.up('ArrowRight');
            const x = (await readPlayer(page)).x;
            expect(x).toBeLessThanOrEqual(await page.evaluate(() => W - PLAYER_W / 2));
        });

        test('standing on a floor the spy does not fall', async ({ page }) => {
            await placePlayer(page, 200, 3);
            await step(page, 60);
            const p = await readPlayer(page);
            expect(p.y).toBe(await page.evaluate(() => FLOOR_Y[3]));
            expect(p.vy).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Shafts and falling
    // -----------------------------------------------------------------------
    test.describe('shafts', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearActors(page);
        });

        test('an empty shaft is a hole the spy falls into', async ({ page }) => {
            await placeCar(page, 0, 9);
            await page.evaluate(() => {
                player.x = SHAFTS[0].x + SHAFTS[0].w / 2;
                player.y = FLOOR_Y[2];
                player.vy = 0;
                player.onCar = null;
            });
            await step(page, 20);
            const p = await readPlayer(page);
            expect(p.y).toBeGreaterThan(await page.evaluate(() => FLOOR_Y[2]));
            expect(p.vy).toBeGreaterThan(0);
        });

        test('a falling spy lands on the roof of the car below', async ({ page }) => {
            await placeCar(page, 0, 5);
            await page.evaluate(() => {
                player.x = elevators[0].x + CAR_W / 2;
                player.y = FLOOR_Y[2];
                player.vy = 0;
                player.onCar = null;
            });
            await step(page, 400);
            const p = await readPlayer(page);
            expect(p.y).toBe(await page.evaluate(() => FLOOR_Y[5]));
            expect(p.onCar).toBe(0);
            expect(p.vy).toBe(0);
        });

        test('a fall down a clear shaft ends on the lobby floor', async ({ page }) => {
            await placeCar(page, 1, 0);
            await page.evaluate(() => {
                player.x = elevators[1].x + CAR_W / 2;
                player.y = FLOOR_Y[1];
                player.vy = 0;
                player.onCar = null;
            });
            await step(page, 600);
            const p = await readPlayer(page);
            expect(p.y).toBe(await page.evaluate(() => FLOOR_Y[FLOOR_COUNT - 1]));
            expect(p.onCar).toBeNull();
        });

        test('falling never costs a life', async ({ page }) => {
            await placeCar(page, 0, 0);
            await page.evaluate(() => {
                player.x = elevators[0].x + CAR_W / 2;
                player.y = FLOOR_Y[1];
                player.vy = 0;
                player.onCar = null;
            });
            await step(page, 600);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('walking into a level car steps onto it instead of falling', async ({ page }) => {
            await placeCar(page, 0, 4);
            await placePlayer(page, await page.evaluate(() => elevators[0].x + CAR_W / 2), 4);
            await step(page, 10);
            const p = await readPlayer(page);
            expect(p.onCar).toBe(0);
            expect(p.y).toBe(await page.evaluate(() => FLOOR_Y[4]));
        });
    });

    // -----------------------------------------------------------------------
    // Riding the elevator
    // -----------------------------------------------------------------------
    test.describe('riding the elevator', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearActors(page);
            await placeCar(page, 0, 4);
            await placePlayer(page, await page.evaluate(() => elevators[0].x + CAR_W / 2), 4);
            await step(page, 1);
        });

        test('ArrowUp sends the car up one floor and carries the spy', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => elevators[0].moving)).toBe(true);
            await step(page, 600);
            const car = await page.evaluate(() => ({ y: elevators[0].y, floor: elevators[0].floor }));
            expect(car.floor).toBe(3);
            expect(car.y).toBe(await page.evaluate(() => FLOOR_Y[3]));
            expect((await readPlayer(page)).y).toBe(car.y);
        });

        test('ArrowDown sends the car down one floor', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await step(page, 600);
            expect(await page.evaluate(() => elevators[0].floor)).toBe(5);
            expect((await readPlayer(page)).y).toBe(await page.evaluate(() => FLOOR_Y[5]));
        });

        test('W and S also drive the car', async ({ page }) => {
            await page.keyboard.press('KeyW');
            await step(page, 600);
            expect(await page.evaluate(() => elevators[0].floor)).toBe(3);
            await page.keyboard.press('KeyS');
            await step(page, 600);
            expect(await page.evaluate(() => elevators[0].floor)).toBe(4);
        });

        test('a car always stops level with a floor', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await step(page, 600);
            const y = await page.evaluate(() => elevators[0].y);
            expect(await page.evaluate((v) => FLOOR_Y.includes(v), y)).toBe(true);
            expect(await page.evaluate(() => elevators[0].moving)).toBe(false);
        });

        test('holding the drive key keeps the car travelling floor after floor', async ({ page }) => {
            await page.keyboard.down('ArrowUp');
            await step(page, 1200);
            await page.keyboard.up('ArrowUp');
            expect(await page.evaluate(() => elevators[0].floor)).toBeLessThan(3);
        });

        test('the top floor stops the car going up', async ({ page }) => {
            await placeCar(page, 0, 0);
            await page.evaluate(() => {
                player.y = FLOOR_Y[0];
                player.onCar = 0;
            });
            await page.keyboard.down('ArrowUp');
            await step(page, 600);
            await page.keyboard.up('ArrowUp');
            expect(await page.evaluate(() => elevators[0].floor)).toBe(0);
            expect(await page.evaluate(() => elevators[0].y)).toBe(await page.evaluate(() => FLOOR_Y[0]));
        });

        test('the lobby stops the car going down', async ({ page }) => {
            await placeCar(page, 0, await page.evaluate(() => FLOOR_COUNT - 1));
            await page.evaluate(() => {
                player.y = FLOOR_Y[FLOOR_COUNT - 1];
                player.onCar = 0;
            });
            await page.keyboard.down('ArrowDown');
            await step(page, 600);
            await page.keyboard.up('ArrowDown');
            expect(await page.evaluate(() => elevators[0].floor)).toBe(
                await page.evaluate(() => FLOOR_COUNT - 1)
            );
        });

        test('the spy can walk off a parked car onto the floor', async ({ page }) => {
            await page.keyboard.down('ArrowRight');
            await step(page, 120);
            await page.keyboard.up('ArrowRight');
            const p = await readPlayer(page);
            expect(p.onCar).toBeNull();
            expect(p.y).toBe(await page.evaluate(() => FLOOR_Y[4]));
            expect(p.x).toBeGreaterThan(await page.evaluate(() => elevators[0].x + CAR_W));
        });

        test('a car the spy is not on ignores the drive keys', async ({ page }) => {
            const before = await page.evaluate(() => elevators[1].floor);
            await page.keyboard.press('ArrowUp');
            await step(page, 600);
            expect(await page.evaluate(() => elevators[1].floor)).toBe(before);
        });

        test('pressing the other way turns a car round in transit', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await step(page, 20);
            expect(await page.evaluate(() => elevators[0].target)).toBe(5);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => elevators[0].target)).toBe(4);
            await step(page, 600);
            expect(await page.evaluate(() => elevators[0].floor)).toBe(4);
            expect((await readPlayer(page)).y).toBe(await page.evaluate(() => FLOOR_Y[4]));
        });

        test('pressing the same way again does not disturb a car in transit', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await step(page, 20);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => elevators[0].target)).toBe(5);
        });

        test('a car the spy is riding is never called away by the other floor', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await step(page, 10);
            expect(await page.evaluate(() => elevators[0].target)).toBe(5);
        });

        test('riding updates the floor readout in the HUD', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await step(page, 600);
            await expect(page.locator('#floor')).toHaveText('5');
        });
    });

    // -----------------------------------------------------------------------
    // Calling a car
    // -----------------------------------------------------------------------
    test.describe('calling a car', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearActors(page);
        });

        test('pressing up on a floor calls a car to it', async ({ page }) => {
            await placeCar(page, 0, 8);
            await placePlayer(page, 60, 3);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => elevators[0].target)).toBe(3);
            expect(await page.evaluate(() => elevators[0].moving)).toBe(true);
        });

        test('pressing down on a floor calls a car to it too', async ({ page }) => {
            await placeCar(page, 0, 1);
            await placePlayer(page, 60, 5);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => elevators[0].target)).toBe(5);
        });

        test('a called car arrives and parks level with the floor', async ({ page }) => {
            await placeCar(page, 0, 8);
            await placeCar(page, 1, 9);
            await placePlayer(page, 60, 3);
            await page.keyboard.press('ArrowUp');
            await step(page, 1200);
            const car = await page.evaluate(() => ({
                floor: elevators[0].floor,
                y: elevators[0].y,
                moving: elevators[0].moving,
            }));
            expect(car.floor).toBe(3);
            expect(car.y).toBe(await page.evaluate(() => FLOOR_Y[3]));
            expect(car.moving).toBe(false);
        });

        test('the call goes to the car in the nearer shaft', async ({ page }) => {
            await placeCar(page, 0, 8);
            await placeCar(page, 1, 8);
            await placePlayer(page, await page.evaluate(() => SHAFTS[1].x - 20), 3);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => elevators[1].moving)).toBe(true);
            expect(await page.evaluate(() => elevators[0].moving)).toBe(false);
        });

        test('a car already on the floor is not called', async ({ page }) => {
            await placeCar(page, 0, 3);
            await placeCar(page, 1, 3);
            await placePlayer(page, 60, 3);
            await page.keyboard.press('ArrowUp');
            const moving = await page.evaluate(() => elevators.map((c) => c.moving));
            expect(moving).toEqual([false, false]);
        });

        test('a spy stranded in the lobby can still call a car down', async ({ page }) => {
            await placeCar(page, 0, 0);
            await placeCar(page, 1, 1);
            await placePlayer(page, 60, 9);
            await page.keyboard.press('ArrowUp');
            await step(page, 1500);
            const reachable = await page.evaluate(
                () => elevators.some((c) => c.floor === FLOOR_COUNT - 1)
            );
            expect(reachable).toBe(true);
        });

        test('a falling spy cannot call a car', async ({ page }) => {
            await placeCar(page, 0, 9);
            await page.evaluate(() => {
                player.x = SHAFTS[0].x + SHAFTS[0].w / 2;
                player.y = FLOOR_Y[2] + 20;
                player.vy = 100;
                player.onCar = null;
            });
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => elevators[0].moving)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Documents
    // -----------------------------------------------------------------------
    test.describe('documents', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearActors(page);
        });

        test('standing in a red doorway takes the document and scores', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'red');
                return { x: d.x, floor: d.floor };
            });
            await placePlayer(page, door.x, door.floor);
            await step(page, 2);
            const after = await page.evaluate((d) => {
                const door = doors.find((x) => x.type === 'red' && x.floor === d.floor && x.x === d.x);
                return { collected: door.collected, score };
            }, door);
            expect(after.collected).toBe(true);
            expect(after.score).toBe(await page.evaluate(() => DOC_POINTS));
        });

        test('taking a document lowers the documents left', async ({ page }) => {
            const before = await page.evaluate(() => docsLeft());
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'red');
                return { x: d.x, floor: d.floor };
            });
            await placePlayer(page, door.x, door.floor);
            await step(page, 2);
            expect(await page.evaluate(() => docsLeft())).toBe(before - 1);
            await expect(page.locator('#docs')).toHaveText(String(before - 1));
        });

        test('a document is only taken once', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'red');
                return { x: d.x, floor: d.floor };
            });
            await placePlayer(page, door.x, door.floor);
            await step(page, 120);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => DOC_POINTS));
        });

        test('a grey door holds nothing', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'grey');
                return { x: d.x, floor: d.floor };
            });
            await placePlayer(page, door.x, door.floor);
            await step(page, 10);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('a document out of reach along the floor is not taken', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'red');
                return { x: d.x, floor: d.floor };
            });
            await placePlayer(page, door.x + 90, door.floor);
            await step(page, 10);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('a document on another floor is not taken', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'red' && x.floor > 1);
                return { x: d.x, floor: d.floor };
            });
            await placePlayer(page, door.x, door.floor - 1);
            await step(page, 10);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('taking the last document leaves none to find', async ({ page }) => {
            await page.evaluate(() => {
                doors.forEach((d) => {
                    if (d.type === 'red') d.collected = true;
                });
                const last = doors.find((d) => d.type === 'red');
                last.collected = false;
                player.x = last.x;
                player.y = FLOOR_Y[last.floor];
                player.vy = 0;
                player.onCar = null;
            });
            await step(page, 2);
            expect(await page.evaluate(() => docsLeft())).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearActors(page);
            await placePlayer(page, 200, 3);
        });

        test('Space fires a shot', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
            expect(await page.evaluate(() => bullets[0].from)).toBe('player');
        });

        test('a shot flies in the direction the spy faces', async ({ page }) => {
            await page.evaluate(() => (player.dir = -1));
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets[0].vx)).toBeLessThan(0);
            await page.evaluate(() => {
                bullets.length = 0;
                player.cooldown = 0;
                player.dir = 1;
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets[0].vx)).toBeGreaterThan(0);
        });

        test('a shot travels across the floor', async ({ page }) => {
            await page.keyboard.press('Space');
            const x0 = await page.evaluate(() => bullets[0].x);
            await step(page, 20);
            expect(await page.evaluate(() => bullets[0].x)).toBeGreaterThan(x0);
        });

        test('the gun has a cooldown', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('the gun fires again once the cooldown runs out', async ({ page }) => {
            await page.keyboard.press('Space');
            await step(page, 200);
            await page.evaluate(() => (bullets.length = 0));
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('a shot that leaves the building is cleaned up', async ({ page }) => {
            await page.keyboard.press('Space');
            await step(page, 600);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('clicking the canvas also shoots', async ({ page }) => {
            await page.locator('#canvas').click({ position: { x: 240, y: 300 } });
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Agents
    // -----------------------------------------------------------------------
    test.describe('agents', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearActors(page);
            await placePlayer(page, 200, 3);
        });

        test('agents come out of grey doors over time', async ({ page }) => {
            await page.evaluate(() => (spawnTimer = 0));
            await step(page, 4);
            expect(await page.evaluate(() => agents.length)).toBeGreaterThan(0);
            const onGrey = await page.evaluate(() =>
                agents.every((a) => doors.some((d) => d.type === 'grey' && d.floor === a.floor))
            );
            expect(onGrey).toBe(true);
        });

        test('an agent stands on the floor it spawned on', async ({ page }) => {
            await page.evaluate(() => (spawnTimer = 0));
            await step(page, 4);
            const ok = await page.evaluate(() => agents.every((a) => a.y === FLOOR_Y[a.floor]));
            expect(ok).toBe(true);
        });

        test('the board never holds more than the level cap of agents', async ({ page }) => {
            await page.evaluate(() => (spawnTimer = 0));
            await step(page, 3000);
            const { count, cap } = await page.evaluate(() => ({
                count: agents.length,
                cap: maxAgents(),
            }));
            expect(count).toBeLessThanOrEqual(cap);
        });

        test('an agent on the spy’s floor walks towards the spy', async ({ page }) => {
            await page.evaluate(() => {
                agents.push({ x: 380, y: FLOOR_Y[3], floor: 3, dir: 1, cooldown: 99 });
            });
            await step(page, 30);
            const x = await page.evaluate(() => agents[0].x);
            expect(x).toBeLessThan(380);
            expect(await page.evaluate(() => agents[0].dir)).toBe(-1);
        });

        test('an agent turns round at a wall', async ({ page }) => {
            await page.evaluate(() => {
                agents.push({ x: 24, y: FLOOR_Y[6], floor: 6, dir: -1, cooldown: 99 });
            });
            await step(page, 60);
            expect(await page.evaluate(() => agents[0].dir)).toBe(1);
        });

        test('an agent facing the spy on the same floor shoots', async ({ page }) => {
            await page.evaluate(() => {
                agents.push({ x: 320, y: FLOOR_Y[3], floor: 3, dir: -1, cooldown: 0 });
            });
            await step(page, 2);
            const shots = await page.evaluate(() => bullets.filter((b) => b.from === 'agent').length);
            expect(shots).toBe(1);
        });

        test('an agent on another floor does not shoot', async ({ page }) => {
            await page.evaluate(() => {
                agents.push({ x: 320, y: FLOOR_Y[7], floor: 7, dir: -1, cooldown: 0 });
            });
            await step(page, 120);
            const shots = await page.evaluate(() => bullets.filter((b) => b.from === 'agent').length);
            expect(shots).toBe(0);
        });

        test('a shot from the spy drops an agent and scores', async ({ page }) => {
            await page.evaluate(() => {
                agents.push({ x: 300, y: FLOOR_Y[3], floor: 3, dir: -1, cooldown: 99 });
                player.dir = 1;
            });
            await page.keyboard.press('Space');
            await step(page, 120);
            expect(await page.evaluate(() => agents.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => AGENT_POINTS));
        });

        test('a shot passes agents on other floors by', async ({ page }) => {
            await page.evaluate(() => {
                agents.push({ x: 300, y: FLOOR_Y[5], floor: 5, dir: -1, cooldown: 99 });
                player.dir = 1;
            });
            await page.keyboard.press('Space');
            await step(page, 120);
            expect(await page.evaluate(() => agents.length)).toBe(1);
        });

        test('an agent shot costs a life', async ({ page }) => {
            await page.evaluate(() => {
                bullets.push({
                    x: player.x - 20,
                    y: player.y - 16,
                    vx: BULLET_SPEED,
                    from: 'agent',
                });
            });
            await step(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect((await readPlayer(page)).invuln).toBeGreaterThan(0);
        });

        test('the shot that costs a life is spent', async ({ page }) => {
            await page.evaluate(() => {
                bullets.push({ x: player.x - 20, y: player.y - 16, vx: BULLET_SPEED, from: 'agent' });
            });
            await step(page, 30);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a second shot during the blink costs nothing', async ({ page }) => {
            await page.evaluate(() => {
                player.invuln = INVULN_TIME;
                bullets.push({ x: player.x - 20, y: player.y - 16, vx: BULLET_SPEED, from: 'agent' });
            });
            await step(page, 30);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('the spy’s own shots never hurt the spy', async ({ page }) => {
            await page.keyboard.press('Space');
            await step(page, 4);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('walking into an agent costs a life', async ({ page }) => {
            await page.evaluate(() => {
                agents.push({ x: player.x + 6, y: player.y, floor: 3, dir: -1, cooldown: 99 });
            });
            await step(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('an agent does not shoot a spy riding between floors', async ({ page }) => {
            await page.evaluate(() => {
                const car = elevators[0];
                car.floor = 3;
                car.target = 4;
                car.y = FLOOR_Y[3] + 24;
                car.moving = true;
                player.x = car.x + CAR_W / 2;
                player.y = car.y;
                player.onCar = 0;
                agents.push({ x: 300, y: FLOOR_Y[3], floor: 3, dir: -1, cooldown: 0 });
            });
            await step(page, 20);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('an agent cannot touch a spy riding past their floor', async ({ page }) => {
            await page.evaluate(() => {
                const car = elevators[0];
                car.floor = 3;
                car.target = 4;
                car.y = FLOOR_Y[3] + 24;
                car.moving = true;
                player.x = car.x + CAR_W / 2;
                player.y = car.y;
                player.onCar = 0;
                agents.push({
                    x: car.x + CAR_W / 2,
                    y: FLOOR_Y[3],
                    floor: 3,
                    dir: 1,
                    cooldown: 99,
                });
            });
            await step(page, 20);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an agent can still touch a spy parked at their floor', async ({ page }) => {
            await page.evaluate(() => {
                const car = elevators[0];
                car.floor = 3;
                car.target = 3;
                car.y = FLOOR_Y[3];
                car.moving = false;
                player.x = car.x + CAR_W / 2;
                player.y = car.y;
                player.onCar = 0;
                agents.push({
                    x: car.x + CAR_W / 2,
                    y: FLOOR_Y[3],
                    floor: 3,
                    dir: 1,
                    cooldown: 99,
                });
            });
            await step(page, 4);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the blink wears off', async ({ page }) => {
            await page.evaluate(() => (player.invuln = 0.05));
            await step(page, 30);
            expect((await readPlayer(page)).invuln).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Escaping
    // -----------------------------------------------------------------------
    test.describe('escaping', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearActors(page);
        });

        test('the exit is shut while documents are still in the building', async ({ page }) => {
            await placePlayer(page, await page.evaluate(() => EXIT.x + EXIT.w / 2), 9);
            await step(page, 10);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('reaching the exit with every document clears the floor', async ({ page }) => {
            await collectAllDocs(page);
            await placePlayer(page, await page.evaluate(() => EXIT.x + EXIT.w / 2), 9);
            await step(page, 10);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('escaping pays a bonus for the lives left', async ({ page }) => {
            await collectAllDocs(page);
            await page.evaluate(() => (score = 0));
            await placePlayer(page, await page.evaluate(() => EXIT.x + EXIT.w / 2), 9);
            await step(page, 10);
            const { score: s, bonus, perLife } = await page.evaluate(() => ({
                score,
                bonus: ESCAPE_BONUS,
                perLife: LIFE_BONUS,
            }));
            expect(s).toBe(bonus + perLife * 3);
        });

        test('the clear overlay appears', async ({ page }) => {
            await collectAllDocs(page);
            await placePlayer(page, await page.evaluate(() => EXIT.x + EXIT.w / 2), 9);
            await step(page, 10);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/clear|escape/i);
        });

        test('standing in the lobby away from the exit does not escape', async ({ page }) => {
            await collectAllDocs(page);
            await placePlayer(page, 60, 9);
            await step(page, 10);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Space after a clear starts the next level', async ({ page }) => {
            await collectAllDocs(page);
            await placePlayer(page, await page.evaluate(() => EXIT.x + EXIT.w / 2), 9);
            await step(page, 10);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the next level restocks the documents and sends the spy back to the roof', async ({
            page,
        }) => {
            await collectAllDocs(page);
            await placePlayer(page, await page.evaluate(() => EXIT.x + EXIT.w / 2), 9);
            await step(page, 10);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => docsLeft())).toBe(await page.evaluate(() => DOC_COUNT));
            expect((await readPlayer(page)).y).toBe(await page.evaluate(() => FLOOR_Y[0]));
        });

        test('the next level keeps the score and the lives', async ({ page }) => {
            await collectAllDocs(page);
            await page.evaluate(() => (lives = 2));
            await placePlayer(page, await page.evaluate(() => EXIT.x + EXIT.w / 2), 9);
            await step(page, 10);
            const earned = await page.evaluate(() => score);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => score)).toBe(earned);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('later levels send out agents faster', async ({ page }) => {
            const first = await page.evaluate(() => spawnDelay());
            await page.evaluate(() => {
                level = LEVEL_COUNT;
                buildLevel(level);
            });
            expect(await page.evaluate(() => spawnDelay())).toBeLessThan(first);
        });

        test('escaping the last floor wins the game', async ({ page }) => {
            await page.evaluate(() => {
                level = LEVEL_COUNT;
                buildLevel(level);
                doors.forEach((d) => {
                    if (d.type === 'red') d.collected = true;
                });
                player.x = EXIT.x + EXIT.w / 2;
                player.y = FLOOR_Y[FLOOR_COUNT - 1];
                player.vy = 0;
                player.onCar = null;
            });
            await step(page, 10);
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/escape|win|won/i);
        });
    });

    // -----------------------------------------------------------------------
    // Losing
    // -----------------------------------------------------------------------
    test.describe('losing', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearActors(page);
            await placePlayer(page, 200, 3);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                bullets.push({ x: player.x - 20, y: player.y - 16, vx: BULLET_SPEED, from: 'agent' });
            });
            await step(page, 30);
            expect(await page.evaluate(() => lives)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('the game over overlay reports the score', async ({ page }) => {
            await page.evaluate(() => {
                score = 2750;
                lives = 1;
                bullets.push({ x: player.x - 20, y: player.y - 16, vx: BULLET_SPEED, from: 'agent' });
            });
            await step(page, 30);
            await expect(page.locator('#overlay-score')).toContainText('2750');
        });

        test('a best score is kept in localStorage', async ({ page }) => {
            await page.evaluate(() => {
                score = 3300;
                lives = 1;
                bullets.push({ x: player.x - 20, y: player.y - 16, vx: BULLET_SPEED, from: 'agent' });
            });
            await step(page, 30);
            expect(await page.evaluate(() => window.localStorage.getItem('elevatoraction-best'))).toBe(
                '3300'
            );
            await expect(page.locator('#best')).toHaveText('3300');
        });

        test('a worse run does not overwrite the best score', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '9000'));
            await page.reload();
            await startFrozen(page);
            await clearActors(page);
            await placePlayer(page, 200, 3);
            await page.evaluate(() => {
                score = 100;
                lives = 1;
                bullets.push({ x: player.x - 20, y: player.y - 16, vx: BULLET_SPEED, from: 'agent' });
            });
            await step(page, 30);
            expect(await page.evaluate(() => window.localStorage.getItem('elevatoraction-best'))).toBe(
                '9000'
            );
        });

        test('Space after a game over starts a fresh run', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                bullets.push({ x: player.x - 20, y: player.y - 16, vx: BULLET_SPEED, from: 'agent' });
            });
            await step(page, 30);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('losing a life with lives to spare keeps the game running', async ({ page }) => {
            await page.evaluate(() => {
                bullets.push({ x: player.x - 20, y: player.y - 16, vx: BULLET_SPEED, from: 'agent' });
            });
            await step(page, 30);
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearActors(page);
            await placePlayer(page, 200, 3);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the pause overlay shows', async ({ page }) => {
            await page.keyboard.press('KeyP');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paus/i);
        });

        test('a paused game does not simulate', async ({ page }) => {
            await page.evaluate(() => {
                agents.push({ x: 380, y: FLOOR_Y[3], floor: 3, dir: -1, cooldown: 99 });
            });
            await page.keyboard.press('KeyP');
            await step(page, 60);
            expect(await page.evaluate(() => agents[0].x)).toBe(380);
        });

        test('Space resumes a paused game without shooting', async ({ page }) => {
            await page.keyboard.press('KeyP');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('P does nothing before the game starts', async ({ page }) => {
            await page.reload();
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
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
