const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a run and freeze the animation loop so a test can set up an exact
// situation and advance the simulation one fixed step at a time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
    });
}

// Advance the frozen simulation by `steps` fixed timesteps (1/120 s each).
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(1 / 120);
    }, steps);
}

// Advance by roughly `seconds` of simulated time.
async function stepSeconds(page, seconds) {
    await step(page, Math.round(seconds * 120));
}

// Empty the floors: no agents, no shots, and no further spawns.
async function quietBuilding(page) {
    await page.evaluate(() => {
        enemies.length = 0;
        bullets.length = 0;
        spawnTimer = 1e6;
    });
}

// Put the player on a floor at an exact spot, out of a car and vulnerable.
async function placePlayer(page, { floor, x, crouch = false }) {
    await page.evaluate(
        (p) => {
            player.inCar = null;
            player.floor = p.floor;
            player.y = floorY(p.floor);
            player.x = p.x;
            player.crouch = p.crouch;
            player.invuln = 0;
            player.dir = 1;
        },
        { floor, x, crouch }
    );
}

// Hold a set of key codes down (and release everything else).
async function holdKeys(page, codes) {
    await page.evaluate((list) => {
        for (const code of Object.keys(keys)) keys[code] = false;
        for (const code of list) keys[code] = true;
    }, codes);
}

async function releaseKeys(page) {
    await holdKeys(page, []);
}

// Mark every document as collected, as if the player had picked them all up.
async function collectAllDocuments(page) {
    await page.evaluate(() => {
        doors.forEach((d) => {
            if (d.type === 'document') d.collected = true;
        });
        updateHud();
    });
}

async function playerState(page) {
    return page.evaluate(() => ({
        x: player.x,
        y: player.y,
        floor: player.floor,
        dir: player.dir,
        crouch: player.crouch,
        inCar: player.inCar,
        invuln: player.invuln,
    }));
}

test.describe('Elevator Action', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Page shell and idle state
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

        test('the building is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => doors.length)).toBe(0);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '8200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('8200');
        });

        test('the help legend explains the elevator and shooting', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/elevator|ride/i);
            await expect(page.locator('.help')).toContainText(/fire|shoot/i);
        });

        test('the help legend explains crouching', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/crouch|duck/i);
        });

        test('no console errors on load', async ({ page }) => {
            const errors = [];
            page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
            page.on('pageerror', (e) => errors.push(e.message));
            await page.reload();
            await page.waitForTimeout(250);
            expect(errors).toEqual([]);
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

        test('a fresh run resets score, level and lives', async ({ page }) => {
            await page.evaluate(() => {
                score = 4321;
                level = 4;
                lives = 1;
                startGame();
                autoRun = false;
            });
            expect(await page.evaluate(() => ({ score, level, lives }))).toEqual({
                score: 0,
                level: 1,
                lives: 3,
            });
        });

        test('the player does not start on top of a document', async ({ page }) => {
            await startFrozen(page);
            const touching = await page.evaluate(() =>
                doors.some(
                    (d) =>
                        d.type === 'document' &&
                        d.floor === player.floor &&
                        Math.abs(d.x - player.x) <= DOOR_W / 2 + PLAYER_W / 2
                )
            );
            expect(touching).toBe(false);
        });

        test('no level hands out a document at the drop-in point', async ({ page }) => {
            const freebies = await page.evaluate(() => {
                const out = [];
                for (let n = 1; n <= LEVEL_COUNT; n++) {
                    buildLevel(n);
                    if (docsRemaining() !== doors.filter((d) => d.type === 'document').length) {
                        out.push(n);
                    }
                    for (const d of doors) {
                        if (d.type !== 'document' || d.floor !== player.floor) continue;
                        if (Math.abs(d.x - player.x) <= DOOR_W / 2 + PLAYER_W / 2) out.push(n);
                    }
                }
                return out;
            });
            expect(freebies).toEqual([]);
        });

        test('the player starts on the top floor at the left', async ({ page }) => {
            await startFrozen(page);
            const p = await playerState(page);
            expect(p.floor).toBe(0);
            expect(p.y).toBe(await page.evaluate(() => floorY(0)));
            expect(p.inCar).toBeNull();
            expect(p.x).toBeLessThan(120);
        });

        test('the player starts standing, not crouched', async ({ page }) => {
            await startFrozen(page);
            expect((await playerState(page)).crouch).toBe(false);
        });

        test('a fresh level has no agents or shots in play', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Building layout
    // -----------------------------------------------------------------------
    test.describe('building layout', () => {
        test('the building has six floors', async ({ page }) => {
            expect(await page.evaluate(() => FLOOR_COUNT)).toBe(6);
        });

        test('floors are evenly spaced', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: FLOOR_COUNT }, (_, i) => floorY(i))
            );
            expect(ys[0]).toBe(108);
            expect(ys[ys.length - 1]).toBe(568);
            for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBe(92);
        });

        test('every floor fits inside the canvas', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: FLOOR_COUNT }, (_, i) => floorY(i))
            );
            for (const y of ys) expect(y).toBeGreaterThan(0);
            for (const y of ys) expect(y).toBeLessThan(640);
        });

        test('there are two elevator shafts', async ({ page }) => {
            await startFrozen(page);
            const xs = await page.evaluate(() => elevators.map((e) => e.x));
            expect(xs).toEqual([150, 330]);
        });

        test('the cars start parked at opposite ends of the building', async ({ page }) => {
            await startFrozen(page);
            const ys = await page.evaluate(() => elevators.map((e) => e.y));
            expect(ys[0]).toBe(await page.evaluate(() => floorY(0)));
            expect(ys[1]).toBe(await page.evaluate(() => floorY(FLOOR_COUNT - 1)));
        });

        test('a level has document doors and agent doors', async ({ page }) => {
            await startFrozen(page);
            const counts = await page.evaluate(() => ({
                docs: doors.filter((d) => d.type === 'document').length,
                spawners: doors.filter((d) => d.type === 'enemy').length,
            }));
            expect(counts.docs).toBeGreaterThan(0);
            expect(counts.spawners).toBeGreaterThan(0);
        });

        test('every door sits on a real floor, clear of the shafts', async ({ page }) => {
            await startFrozen(page);
            const bad = await page.evaluate(() =>
                doors.filter(
                    (d) =>
                        d.floor < 0 ||
                        d.floor >= FLOOR_COUNT ||
                        elevators.some((e) => Math.abs(e.x - d.x) < SHAFT_W / 2 + DOOR_W / 2)
                )
            );
            expect(bad).toEqual([]);
        });

        test('every door stays inside the walls', async ({ page }) => {
            await startFrozen(page);
            const bad = await page.evaluate(() =>
                doors.filter((d) => d.x - DOOR_W / 2 < WALL_L || d.x + DOOR_W / 2 > WALL_R)
            );
            expect(bad).toEqual([]);
        });

        test('no two doors share a spot', async ({ page }) => {
            await startFrozen(page);
            const dupes = await page.evaluate(() => {
                const seen = new Set();
                let n = 0;
                for (const d of doors) {
                    const key = `${d.floor}:${d.x}`;
                    if (seen.has(key)) n++;
                    seen.add(key);
                }
                return n;
            });
            expect(dupes).toBe(0);
        });

        test('the exit sits on the ground floor', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => exitZone.floor)).toBe(
                await page.evaluate(() => FLOOR_COUNT - 1)
            );
        });

        test('layouts are deterministic — the same level builds the same building', async ({
            page,
        }) => {
            const a = await page.evaluate(() => {
                buildLevel(3);
                return JSON.stringify(doors);
            });
            const b = await page.evaluate(() => {
                buildLevel(3);
                return JSON.stringify(doors);
            });
            expect(a).toBe(b);
        });

        test('different levels are different buildings', async ({ page }) => {
            const a = await page.evaluate(() => {
                buildLevel(1);
                return JSON.stringify(doors.map((d) => [d.floor, d.x, d.type]));
            });
            const b = await page.evaluate(() => {
                buildLevel(2);
                return JSON.stringify(doors.map((d) => [d.floor, d.x, d.type]));
            });
            expect(a).not.toBe(b);
        });
    });

    // -----------------------------------------------------------------------
    // Walking
    // -----------------------------------------------------------------------
    test.describe('walking', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quietBuilding(page);
        });

        test('holding right walks right at the walking speed', async ({ page }) => {
            await placePlayer(page, { floor: 0, x: 52 });
            await holdKeys(page, ['ArrowRight']);
            await stepSeconds(page, 0.5);
            const p = await playerState(page);
            const speed = await page.evaluate(() => PLAYER_SPEED);
            expect(p.x).toBeCloseTo(52 + speed * 0.5, 1);
        });

        test('holding left walks left', async ({ page }) => {
            await placePlayer(page, { floor: 0, x: 110 });
            await holdKeys(page, ['ArrowLeft']);
            await stepSeconds(page, 0.5);
            const speed = await page.evaluate(() => PLAYER_SPEED);
            expect((await playerState(page)).x).toBeCloseTo(110 - speed * 0.5, 1);
        });

        test('A and D walk as well as the arrow keys', async ({ page }) => {
            await placePlayer(page, { floor: 0, x: 52 });
            await holdKeys(page, ['KeyD']);
            await stepSeconds(page, 0.25);
            const right = (await playerState(page)).x;
            expect(right).toBeGreaterThan(52);
            await holdKeys(page, ['KeyA']);
            await stepSeconds(page, 0.25);
            expect((await playerState(page)).x).toBeCloseTo(52, 1);
        });

        test('walking sets the facing direction', async ({ page }) => {
            await placePlayer(page, { floor: 0, x: 80 });
            await holdKeys(page, ['ArrowLeft']);
            await step(page, 2);
            expect((await playerState(page)).dir).toBe(-1);
            await holdKeys(page, ['ArrowRight']);
            await step(page, 2);
            expect((await playerState(page)).dir).toBe(1);
        });

        test('releasing the keys stops the player', async ({ page }) => {
            await placePlayer(page, { floor: 0, x: 52 });
            await holdKeys(page, ['ArrowRight']);
            await stepSeconds(page, 0.2);
            const x = (await playerState(page)).x;
            await releaseKeys(page);
            await stepSeconds(page, 0.5);
            expect((await playerState(page)).x).toBe(x);
        });

        test('the left wall stops the player', async ({ page }) => {
            await placePlayer(page, { floor: 0, x: 52 });
            await holdKeys(page, ['ArrowLeft']);
            await stepSeconds(page, 3);
            const { x } = await playerState(page);
            const limit = await page.evaluate(() => WALL_L + PLAYER_W / 2);
            expect(x).toBeCloseTo(limit, 3);
        });

        test('the right wall stops the player', async ({ page }) => {
            await placePlayer(page, { floor: 5, x: 400 });
            await holdKeys(page, ['ArrowRight']);
            await stepSeconds(page, 3);
            const { x } = await playerState(page);
            const limit = await page.evaluate(() => WALL_R - PLAYER_W / 2);
            expect(x).toBeCloseTo(limit, 3);
        });

        test('walking never changes the floor', async ({ page }) => {
            await placePlayer(page, { floor: 2, x: 60 });
            await holdKeys(page, ['ArrowRight']);
            await stepSeconds(page, 1);
            expect((await playerState(page)).floor).toBe(2);
        });

        test('pressing both directions at once cancels out', async ({ page }) => {
            await placePlayer(page, { floor: 0, x: 80 });
            await holdKeys(page, ['ArrowLeft', 'ArrowRight']);
            await stepSeconds(page, 0.5);
            expect((await playerState(page)).x).toBeCloseTo(80, 3);
        });
    });

    // -----------------------------------------------------------------------
    // Shafts as walls
    // -----------------------------------------------------------------------
    test.describe('shafts without a car', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quietBuilding(page);
            // Park both cars away from the third floor.
            await page.evaluate(() => {
                elevators[0].y = floorY(0);
                elevators[1].y = floorY(5);
            });
        });

        test('an empty shaft blocks the player from the left', async ({ page }) => {
            await placePlayer(page, { floor: 2, x: 80 });
            await holdKeys(page, ['ArrowRight']);
            await stepSeconds(page, 3);
            const { x } = await playerState(page);
            const edge = await page.evaluate(() => 150 - SHAFT_W / 2 - PLAYER_W / 2);
            expect(x).toBeCloseTo(edge, 3);
        });

        test('an empty shaft blocks the player from the right', async ({ page }) => {
            await placePlayer(page, { floor: 2, x: 250 });
            await holdKeys(page, ['ArrowLeft']);
            await stepSeconds(page, 3);
            const { x } = await playerState(page);
            const edge = await page.evaluate(() => 150 + SHAFT_W / 2 + PLAYER_W / 2);
            expect(x).toBeCloseTo(edge, 3);
        });

        test('a blocked player never enters a car that is elsewhere', async ({ page }) => {
            await placePlayer(page, { floor: 2, x: 80 });
            await holdKeys(page, ['ArrowRight']);
            await stepSeconds(page, 3);
            expect((await playerState(page)).inCar).toBeNull();
        });

        test('the player never falls down a shaft', async ({ page }) => {
            await placePlayer(page, { floor: 2, x: 80 });
            await holdKeys(page, ['ArrowRight']);
            await stepSeconds(page, 3);
            const p = await playerState(page);
            expect(p.y).toBe(await page.evaluate(() => floorY(2)));
            expect(p.floor).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Riding the elevator
    // -----------------------------------------------------------------------
    test.describe('elevators', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quietBuilding(page);
        });

        test('walking into a car that is level with the floor boards it', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(2);
            });
            await placePlayer(page, { floor: 2, x: 100 });
            await holdKeys(page, ['ArrowRight']);
            await stepSeconds(page, 1.5);
            const p = await playerState(page);
            expect(p.inCar).toBe(0);
            expect(p.x).toBe(150);
        });

        test('boarding the second shaft works the same way', async ({ page }) => {
            await page.evaluate(() => {
                elevators[1].y = floorY(4);
            });
            await placePlayer(page, { floor: 4, x: 290 });
            await holdKeys(page, ['ArrowRight']);
            await stepSeconds(page, 1.5);
            expect((await playerState(page)).inCar).toBe(1);
        });

        test('Up drives the car upwards at the car speed', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(3);
                player.inCar = 0;
                player.x = elevators[0].x;
                player.y = elevators[0].y;
                player.floor = 3;
            });
            await holdKeys(page, ['ArrowUp']);
            await stepSeconds(page, 1);
            const speed = await page.evaluate(() => ELEVATOR_SPEED);
            const y = await page.evaluate(() => elevators[0].y);
            expect(y).toBeCloseTo((await page.evaluate(() => floorY(3))) - speed, 1);
        });

        test('Down drives the car downwards', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(2);
                player.inCar = 0;
                player.x = elevators[0].x;
                player.y = elevators[0].y;
                player.floor = 2;
            });
            await holdKeys(page, ['ArrowDown']);
            await stepSeconds(page, 1);
            const speed = await page.evaluate(() => ELEVATOR_SPEED);
            const y = await page.evaluate(() => elevators[0].y);
            expect(y).toBeCloseTo((await page.evaluate(() => floorY(2))) + speed, 1);
        });

        test('the rider moves with the car', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(2);
                player.inCar = 0;
                player.x = elevators[0].x;
                player.y = elevators[0].y;
            });
            await holdKeys(page, ['ArrowDown']);
            await stepSeconds(page, 0.5);
            const p = await playerState(page);
            expect(p.y).toBe(await page.evaluate(() => elevators[0].y));
        });

        test('W and S drive the car as well as the arrows', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(3);
                player.inCar = 0;
                player.y = elevators[0].y;
                player.x = elevators[0].x;
            });
            await holdKeys(page, ['KeyW']);
            await stepSeconds(page, 0.3);
            const up = await page.evaluate(() => elevators[0].y);
            expect(up).toBeLessThan(await page.evaluate(() => floorY(3)));
            await holdKeys(page, ['KeyS']);
            await stepSeconds(page, 0.3);
            expect(await page.evaluate(() => elevators[0].y)).toBeCloseTo(
                await page.evaluate(() => floorY(3)),
                1
            );
        });

        test('a car stops at the top floor', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(1);
                player.inCar = 0;
                player.y = elevators[0].y;
                player.x = elevators[0].x;
            });
            await holdKeys(page, ['ArrowUp']);
            await stepSeconds(page, 6);
            expect(await page.evaluate(() => elevators[0].y)).toBe(
                await page.evaluate(() => floorY(0))
            );
        });

        test('a car stops at the ground floor', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(4);
                player.inCar = 0;
                player.y = elevators[0].y;
                player.x = elevators[0].x;
            });
            await holdKeys(page, ['ArrowDown']);
            await stepSeconds(page, 6);
            expect(await page.evaluate(() => elevators[0].y)).toBe(
                await page.evaluate(() => floorY(FLOOR_COUNT - 1))
            );
        });

        test('a rider between floors belongs to no floor', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(2);
                player.inCar = 0;
                player.y = elevators[0].y;
                player.x = elevators[0].x;
            });
            await holdKeys(page, ['ArrowDown']);
            await stepSeconds(page, 0.3);
            expect((await playerState(page)).floor).toBe(-1);
        });

        test('arriving at a floor registers that floor', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(2);
                player.inCar = 0;
                player.y = elevators[0].y;
                player.x = elevators[0].x;
            });
            await holdKeys(page, ['ArrowDown']);
            await stepSeconds(page, 6);
            expect((await playerState(page)).floor).toBe(await page.evaluate(() => FLOOR_COUNT - 1));
        });

        test('letting go settles the car on the nearest floor', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(2) + 20;
                player.inCar = 0;
                player.y = elevators[0].y;
                player.x = elevators[0].x;
                player.floor = -1;
            });
            await releaseKeys(page);
            await stepSeconds(page, 2);
            expect(await page.evaluate(() => elevators[0].y)).toBe(
                await page.evaluate(() => floorY(2))
            );
            expect((await playerState(page)).floor).toBe(2);
        });

        test('a settling car picks the floor it is closest to', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(3) - 20;
                player.inCar = 0;
                player.y = elevators[0].y;
                player.x = elevators[0].x;
            });
            await releaseKeys(page);
            await stepSeconds(page, 2);
            expect(await page.evaluate(() => elevators[0].y)).toBe(
                await page.evaluate(() => floorY(3))
            );
        });

        test('a settled car stays put', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(1);
                player.inCar = 0;
                player.y = elevators[0].y;
                player.x = elevators[0].x;
            });
            await releaseKeys(page);
            await stepSeconds(page, 2);
            expect(await page.evaluate(() => elevators[0].y)).toBe(
                await page.evaluate(() => floorY(1))
            );
        });

        test('walking out of a car level with a floor leaves the car', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(3);
                player.inCar = 0;
                player.y = elevators[0].y;
                player.x = elevators[0].x;
                player.floor = 3;
            });
            await holdKeys(page, ['ArrowRight']);
            await step(page, 1);
            const p = await playerState(page);
            expect(p.inCar).toBeNull();
            expect(p.floor).toBe(3);
            expect(p.x).toBeGreaterThan(150);
        });

        test('stepping out to the left puts the player left of the shaft', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(3);
                player.inCar = 0;
                player.y = elevators[0].y;
                player.x = elevators[0].x;
                player.floor = 3;
            });
            await holdKeys(page, ['ArrowLeft']);
            await step(page, 1);
            const p = await playerState(page);
            expect(p.inCar).toBeNull();
            expect(p.x).toBeLessThan(150 - (await page.evaluate(() => SHAFT_W / 2)));
        });

        test('a rider between floors cannot step out', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(2) + 20;
                player.inCar = 0;
                player.y = elevators[0].y;
                player.x = elevators[0].x;
                player.floor = -1;
            });
            await holdKeys(page, ['ArrowRight']);
            await step(page, 2);
            expect((await playerState(page)).inCar).toBe(0);
        });

        test('a rider cannot crouch', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(3);
                player.inCar = 0;
                player.y = elevators[0].y;
                player.x = elevators[0].x;
                player.crouch = true;
            });
            await holdKeys(page, ['ArrowDown']);
            await step(page, 2);
            expect((await playerState(page)).crouch).toBe(false);
        });

        test('the free car does not move on its own', async ({ page }) => {
            const before = await page.evaluate(() => elevators[1].y);
            await holdKeys(page, ['ArrowUp']);
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => elevators[1].y)).toBe(before);
        });

        test('an elevator ride can cross the whole building', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(0);
                player.inCar = 0;
                player.y = elevators[0].y;
                player.x = elevators[0].x;
                player.floor = 0;
            });
            await holdKeys(page, ['ArrowDown']);
            await stepSeconds(page, 12);
            const p = await playerState(page);
            expect(p.floor).toBe(await page.evaluate(() => FLOOR_COUNT - 1));
            expect(p.y).toBe(await page.evaluate(() => floorY(FLOOR_COUNT - 1)));
        });
    });

    // -----------------------------------------------------------------------
    // Crouching
    // -----------------------------------------------------------------------
    test.describe('crouching', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quietBuilding(page);
        });

        test('Down crouches a player standing on a floor', async ({ page }) => {
            await placePlayer(page, { floor: 1, x: 60 });
            await holdKeys(page, ['ArrowDown']);
            await step(page, 2);
            expect((await playerState(page)).crouch).toBe(true);
        });

        test('S crouches too', async ({ page }) => {
            await placePlayer(page, { floor: 1, x: 60 });
            await holdKeys(page, ['KeyS']);
            await step(page, 2);
            expect((await playerState(page)).crouch).toBe(true);
        });

        test('releasing Down stands the player back up', async ({ page }) => {
            await placePlayer(page, { floor: 1, x: 60 });
            await holdKeys(page, ['ArrowDown']);
            await step(page, 2);
            await releaseKeys(page);
            await step(page, 2);
            expect((await playerState(page)).crouch).toBe(false);
        });

        test('a crouched player holds position', async ({ page }) => {
            await placePlayer(page, { floor: 1, x: 60 });
            await holdKeys(page, ['ArrowDown', 'ArrowRight']);
            await stepSeconds(page, 0.5);
            expect((await playerState(page)).x).toBeCloseTo(60, 3);
        });

        test('a crouched player is shorter', async ({ page }) => {
            const heights = await page.evaluate(() => [PLAYER_H, CROUCH_H]);
            expect(heights[1]).toBeLessThan(heights[0]);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quietBuilding(page);
            await placePlayer(page, { floor: 2, x: 60 });
        });

        test('firing creates a shot in front of the player', async ({ page }) => {
            await page.evaluate(() => fire());
            const b = await page.evaluate(() => bullets[0]);
            expect(b.from).toBe('player');
            expect(b.x).toBeGreaterThan(60);
            expect(b.floor).toBe(2);
        });

        test('a shot travels in the direction the player faces', async ({ page }) => {
            await page.evaluate(() => {
                player.dir = -1;
                fire();
            });
            expect(await page.evaluate(() => bullets[0].vx)).toBeLessThan(0);
        });

        test('a shot moves at the bullet speed', async ({ page }) => {
            await page.evaluate(() => fire());
            const x0 = await page.evaluate(() => bullets[0].x);
            await stepSeconds(page, 0.25);
            const x1 = await page.evaluate(() => (bullets[0] ? bullets[0].x : null));
            const speed = await page.evaluate(() => BULLET_SPEED);
            expect(x1 - x0).toBeCloseTo(speed * 0.25, 0);
        });

        test('Space fires while running', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('only a few shots can be in the air at once', async ({ page }) => {
            await page.evaluate(() => {
                for (let i = 0; i < 12; i++) fire();
            });
            const max = await page.evaluate(() => MAX_PLAYER_BULLETS);
            expect(await page.evaluate(() => bullets.length)).toBe(max);
        });

        test('a shot fired standing is a high shot', async ({ page }) => {
            await page.evaluate(() => fire());
            expect(await page.evaluate(() => bullets[0].low)).toBe(false);
        });

        test('a shot fired crouched is a low shot', async ({ page }) => {
            await page.evaluate(() => {
                player.crouch = true;
                fire();
            });
            const b = await page.evaluate(() => bullets[0]);
            expect(b.low).toBe(true);
            expect(b.y).toBeGreaterThan(await page.evaluate(() => player.y - BULLET_HIGH));
        });

        test('a shot leaving the building is removed', async ({ page }) => {
            await page.evaluate(() => fire());
            await stepSeconds(page, 3);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a shot hits an agent on the same floor', async ({ page }) => {
            await page.evaluate(() => {
                enemies.push(makeEnemy(200, 2, -1));
                fire();
            });
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('shooting an agent scores points', async ({ page }) => {
            const before = await page.evaluate(() => score);
            await page.evaluate(() => {
                enemies.push(makeEnemy(200, 2, -1));
                fire();
            });
            await stepSeconds(page, 1);
            const points = await page.evaluate(() => ENEMY_POINTS);
            expect(await page.evaluate(() => score)).toBe(before + points);
        });

        test('a hit shot is consumed', async ({ page }) => {
            await page.evaluate(() => {
                enemies.push(makeEnemy(200, 2, -1));
                fire();
            });
            await stepSeconds(page, 0.6);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a low shot still kills a standing agent', async ({ page }) => {
            await page.evaluate(() => {
                enemies.push(makeEnemy(200, 2, -1));
                player.crouch = true;
                fire();
            });
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('a shot misses an agent on another floor', async ({ page }) => {
            await page.evaluate(() => {
                enemies.push(makeEnemy(200, 4, -1));
                fire();
            });
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
        });

        test('the player cannot fire outside a running game', async ({ page }) => {
            await page.evaluate(() => {
                state = 'paused';
                fire();
            });
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Enemy agents
    // -----------------------------------------------------------------------
    test.describe('agents', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quietBuilding(page);
        });

        test('an agent patrols its floor', async ({ page }) => {
            await placePlayer(page, { floor: 0, x: 52 });
            await page.evaluate(() => enemies.push(makeEnemy(220, 3, 1)));
            const x0 = await page.evaluate(() => enemies[0].x);
            await stepSeconds(page, 0.5);
            expect(await page.evaluate(() => enemies[0].x)).toBeGreaterThan(x0);
        });

        test('an agent turns at a wall', async ({ page }) => {
            await placePlayer(page, { floor: 0, x: 52 });
            await page.evaluate(() => enemies.push(makeEnemy(430, 3, 1)));
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => enemies[0].dir)).toBe(-1);
        });

        test('an agent turns at a shaft instead of walking into it', async ({ page }) => {
            await placePlayer(page, { floor: 0, x: 52 });
            await page.evaluate(() => enemies.push(makeEnemy(200, 3, -1)));
            await stepSeconds(page, 2);
            const e = await page.evaluate(() => ({ x: enemies[0].x, dir: enemies[0].dir }));
            expect(e.dir).toBe(1);
            expect(e.x).toBeGreaterThan(150 + (await page.evaluate(() => SHAFT_W / 2)));
        });

        test('an agent stays on its own floor', async ({ page }) => {
            await placePlayer(page, { floor: 0, x: 52 });
            await page.evaluate(() => enemies.push(makeEnemy(220, 3, 1)));
            await stepSeconds(page, 3);
            const e = await page.evaluate(() => ({ floor: enemies[0].floor, y: enemies[0].y }));
            expect(e.floor).toBe(3);
            expect(e.y).toBe(await page.evaluate(() => floorY(3)));
        });

        test('an agent shoots at the player on its floor', async ({ page }) => {
            await placePlayer(page, { floor: 3, x: 60 });
            await page.evaluate(() => {
                player.invuln = 1e6; // survive the shot, just watch it appear
                enemies.push(makeEnemy(260, 3, -1));
                enemies[0].cooldown = 0;
            });
            await step(page, 2);
            const shots = await page.evaluate(() =>
                bullets.filter((b) => b.from === 'enemy').length
            );
            expect(shots).toBe(1);
        });

        test('an agent does not shoot at a player on another floor', async ({ page }) => {
            await placePlayer(page, { floor: 1, x: 60 });
            await page.evaluate(() => {
                enemies.push(makeEnemy(260, 3, -1));
                enemies[0].cooldown = 0;
            });
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('an agent does not shoot behind itself', async ({ page }) => {
            await placePlayer(page, { floor: 3, x: 60 });
            await page.evaluate(() => {
                player.invuln = 1e6;
                enemies.push(makeEnemy(260, 3, 1)); // facing away from the player
                enemies[0].cooldown = 0;
            });
            await step(page, 2);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('agent fire is always a high shot', async ({ page }) => {
            await placePlayer(page, { floor: 3, x: 60 });
            await page.evaluate(() => {
                player.invuln = 1e6;
                enemies.push(makeEnemy(260, 3, -1));
                enemies[0].cooldown = 0;
            });
            await step(page, 2);
            expect(await page.evaluate(() => bullets[0].low)).toBe(false);
        });

        test('an agent waits out its cooldown between shots', async ({ page }) => {
            await placePlayer(page, { floor: 3, x: 60 });
            await page.evaluate(() => {
                player.invuln = 1e6;
                enemies.push(makeEnemy(260, 3, -1));
                enemies[0].cooldown = 0;
            });
            await step(page, 2);
            const first = await page.evaluate(() => bullets.length);
            await step(page, 4);
            expect(await page.evaluate(() => bullets.length)).toBe(first);
        });
    });

    // -----------------------------------------------------------------------
    // Spawning
    // -----------------------------------------------------------------------
    test.describe('spawning', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                enemies.length = 0;
                bullets.length = 0;
            });
        });

        test('an agent appears when the spawn timer runs out', async ({ page }) => {
            await page.evaluate(() => {
                spawnTimer = 0;
            });
            await step(page, 1);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
        });

        test('an agent spawns at an agent door', async ({ page }) => {
            await page.evaluate(() => {
                spawnTimer = 0;
            });
            await step(page, 1);
            const match = await page.evaluate(() => {
                const e = enemies[0];
                return doors.some(
                    (d) => d.type === 'enemy' && d.floor === e.floor && d.x === e.spawnX
                );
            });
            expect(match).toBe(true);
        });

        test('the spawn timer resets after a spawn', async ({ page }) => {
            await page.evaluate(() => {
                spawnTimer = 0;
            });
            await step(page, 1);
            expect(await page.evaluate(() => spawnTimer)).toBeGreaterThan(0);
        });

        test('spawns stop at the level cap', async ({ page }) => {
            await stepSeconds(page, 90);
            const cap = await page.evaluate(() => config.maxEnemies);
            expect(await page.evaluate(() => enemies.length)).toBeLessThanOrEqual(cap);
        });

        test('spawns walk through the agent doors in turn', async ({ page }) => {
            const floors = await page.evaluate(() => {
                const out = [];
                for (let i = 0; i < 3; i++) {
                    spawnTimer = 0;
                    physicsStep(1 / 120);
                    out.push(enemies[enemies.length - 1].spawnX);
                }
                return out;
            });
            expect(new Set(floors).size).toBeGreaterThan(1);
        });

        test('later levels spawn faster and move quicker', async ({ page }) => {
            const a = await page.evaluate(() => {
                buildLevel(1);
                return { interval: config.spawnInterval, speed: config.enemySpeed };
            });
            const b = await page.evaluate(() => {
                buildLevel(4);
                return { interval: config.spawnInterval, speed: config.enemySpeed };
            });
            expect(b.interval).toBeLessThan(a.interval);
            expect(b.speed).toBeGreaterThan(a.speed);
        });
    });

    // -----------------------------------------------------------------------
    // Taking damage
    // -----------------------------------------------------------------------
    test.describe('damage', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quietBuilding(page);
            await placePlayer(page, { floor: 2, x: 200 });
        });

        test('a high shot hits a standing player', async ({ page }) => {
            await page.evaluate(() => {
                bullets.push(makeEnemyBullet(player.x + 40, player.floor, -1));
            });
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a crouched player ducks a high shot', async ({ page }) => {
            await holdKeys(page, ['ArrowDown']);
            await page.evaluate(() => {
                bullets.push(makeEnemyBullet(player.x + 40, player.floor, -1));
            });
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('a shot on another floor misses the player', async ({ page }) => {
            await page.evaluate(() => {
                bullets.push(makeEnemyBullet(player.x + 40, 4, -1));
            });
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('touching an agent costs a life', async ({ page }) => {
            await page.evaluate(() => {
                enemies.push(makeEnemy(player.x + 4, player.floor, -1));
            });
            await step(page, 1);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('losing a life sends the player back to the top floor', async ({ page }) => {
            await page.evaluate(() => loseLife());
            const p = await playerState(page);
            expect(p.floor).toBe(0);
            expect(p.inCar).toBeNull();
        });

        test('losing a life grants brief immunity', async ({ page }) => {
            await page.evaluate(() => loseLife());
            expect((await playerState(page)).invuln).toBeGreaterThan(0);
        });

        test('immunity shrugs off a hit', async ({ page }) => {
            await page.evaluate(() => {
                player.invuln = 5;
                bullets.push(makeEnemyBullet(player.x + 40, player.floor, -1));
            });
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('immunity wears off', async ({ page }) => {
            await page.evaluate(() => {
                player.invuln = 0.25;
            });
            await stepSeconds(page, 1);
            expect((await playerState(page)).invuln).toBe(0);
        });

        test('losing a life clears the shots in the air', async ({ page }) => {
            await page.evaluate(() => {
                bullets.push(makeEnemyBullet(player.x + 40, player.floor, -1));
                loseLife();
            });
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('the HUD tracks the lives left', async ({ page }) => {
            await page.evaluate(() => loseLife());
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('losing the last life ends the run', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
        });

        test('the overlay returns on game over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the frozen simulation stops after a game over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            await placePlayer(page, { floor: 2, x: 200 });
            await page.evaluate(() => {
                state = 'gameover';
            });
            await holdKeys(page, ['ArrowRight']);
            await stepSeconds(page, 1);
            expect((await playerState(page)).x).toBe(200);
        });

        test('Space starts a new run after a game over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ state, lives }))).toEqual({
                state: 'running',
                lives: 3,
            });
        });
    });

    // -----------------------------------------------------------------------
    // Documents
    // -----------------------------------------------------------------------
    test.describe('documents', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quietBuilding(page);
        });

        test('every document starts uncollected', async ({ page }) => {
            const uncollected = await page.evaluate(
                () => doors.filter((d) => d.type === 'document' && !d.collected).length
            );
            expect(uncollected).toBe(await page.evaluate(() => docsRemaining()));
        });

        test('the HUD shows the documents left', async ({ page }) => {
            const left = await page.evaluate(() => docsRemaining());
            await expect(page.locator('#docs')).toHaveText(String(left));
        });

        test('walking onto a document door collects it', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'document');
                return { x: d.x, floor: d.floor };
            });
            await placePlayer(page, { floor: door.floor, x: door.x });
            await step(page, 1);
            const collected = await page.evaluate(
                (d) => doors.find((x) => x.x === d.x && x.floor === d.floor).collected,
                door
            );
            expect(collected).toBe(true);
        });

        test('collecting a document scores points', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'document');
                return { x: d.x, floor: d.floor };
            });
            const before = await page.evaluate(() => score);
            await placePlayer(page, { floor: door.floor, x: door.x });
            await step(page, 1);
            const points = await page.evaluate(() => DOC_POINTS);
            expect(await page.evaluate(() => score)).toBe(before + points);
        });

        test('a document only pays out once', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'document');
                return { x: d.x, floor: d.floor };
            });
            await placePlayer(page, { floor: door.floor, x: door.x });
            await step(page, 1);
            const after = await page.evaluate(() => score);
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => score)).toBe(after);
        });

        test('the documents-left counter drops on a pickup', async ({ page }) => {
            const before = await page.evaluate(() => docsRemaining());
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'document');
                return { x: d.x, floor: d.floor };
            });
            await placePlayer(page, { floor: door.floor, x: door.x });
            await step(page, 1);
            expect(await page.evaluate(() => docsRemaining())).toBe(before - 1);
            await expect(page.locator('#docs')).toHaveText(String(before - 1));
        });

        test('a document on another floor is not collected', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'document' && x.floor !== 0);
                return { x: d.x, floor: d.floor };
            });
            await placePlayer(page, { floor: 0, x: door.x });
            await stepSeconds(page, 1);
            const collected = await page.evaluate(
                (d) => doors.find((x) => x.x === d.x && x.floor === d.floor).collected,
                door
            );
            expect(collected).toBe(false);
        });

        test('an agent door is not a pickup', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'enemy');
                return { x: d.x, floor: d.floor };
            });
            const before = await page.evaluate(() => score);
            await placePlayer(page, { floor: door.floor, x: door.x });
            await page.evaluate(() => {
                spawnTimer = 1e6;
            });
            await step(page, 1);
            expect(await page.evaluate(() => score)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // The exit and finishing a level
    // -----------------------------------------------------------------------
    test.describe('the exit', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await quietBuilding(page);
        });

        test('the exit stays shut while documents remain', async ({ page }) => {
            await page.evaluate(() => {
                player.inCar = null;
                player.floor = FLOOR_COUNT - 1;
                player.y = floorY(FLOOR_COUNT - 1);
                player.x = exitZone.x + exitZone.w / 2;
            });
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('atExit() reports standing in the doorway', async ({ page }) => {
            await page.evaluate(() => {
                player.inCar = null;
                player.floor = FLOOR_COUNT - 1;
                player.y = floorY(FLOOR_COUNT - 1);
                player.x = exitZone.x + exitZone.w / 2;
            });
            expect(await page.evaluate(() => atExit())).toBe(true);
        });

        test('atExit() is false elsewhere in the building', async ({ page }) => {
            await placePlayer(page, { floor: 0, x: 60 });
            expect(await page.evaluate(() => atExit())).toBe(false);
        });

        test('reaching the exit with every document finishes the level', async ({ page }) => {
            await collectAllDocuments(page);
            await page.evaluate(() => {
                player.inCar = null;
                player.floor = FLOOR_COUNT - 1;
                player.y = floorY(FLOOR_COUNT - 1);
                player.x = exitZone.x + exitZone.w / 2;
            });
            await step(page, 1);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('finishing a level pays a bonus', async ({ page }) => {
            await collectAllDocuments(page);
            const before = await page.evaluate(() => score);
            await page.evaluate(() => {
                player.inCar = null;
                player.floor = FLOOR_COUNT - 1;
                player.y = floorY(FLOOR_COUNT - 1);
                player.x = exitZone.x + exitZone.w / 2;
            });
            await step(page, 1);
            const expected = await page.evaluate(() => CLEAR_BONUS + LIFE_BONUS * lives);
            expect(await page.evaluate(() => score)).toBe(before + expected);
        });

        test('the overlay congratulates the player between levels', async ({ page }) => {
            await collectAllDocuments(page);
            await page.evaluate(() => {
                player.inCar = null;
                player.floor = FLOOR_COUNT - 1;
                player.y = floorY(FLOOR_COUNT - 1);
                player.x = exitZone.x + exitZone.w / 2;
            });
            await step(page, 1);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/clear|escape/i);
        });

        test('advancing from a cleared level builds the next building', async ({ page }) => {
            await collectAllDocuments(page);
            await page.evaluate(() => {
                player.inCar = null;
                player.floor = FLOOR_COUNT - 1;
                player.y = floorY(FLOOR_COUNT - 1);
                player.x = exitZone.x + exitZone.w / 2;
                physicsStep(1 / 120);
                advance();
            });
            const after = await page.evaluate(() => ({
                state,
                level,
                docs: docsRemaining(),
                floor: player.floor,
            }));
            expect(after.state).toBe('running');
            expect(after.level).toBe(2);
            expect(after.docs).toBeGreaterThan(0);
            expect(after.floor).toBe(0);
        });

        test('the next level keeps the score', async ({ page }) => {
            await collectAllDocuments(page);
            await page.evaluate(() => {
                player.inCar = null;
                player.floor = FLOOR_COUNT - 1;
                player.y = floorY(FLOOR_COUNT - 1);
                player.x = exitZone.x + exitZone.w / 2;
                physicsStep(1 / 120);
            });
            const earned = await page.evaluate(() => score);
            await page.evaluate(() => advance());
            expect(await page.evaluate(() => score)).toBe(earned);
        });

        test('clearing the last level wins the run', async ({ page }) => {
            await page.evaluate(() => {
                level = LEVEL_COUNT;
                buildLevel(LEVEL_COUNT);
                doors.forEach((d) => {
                    if (d.type === 'document') d.collected = true;
                });
                player.inCar = null;
                player.floor = FLOOR_COUNT - 1;
                player.y = floorY(FLOOR_COUNT - 1);
                player.x = exitZone.x + exitZone.w / 2;
            });
            await step(page, 1);
            expect(await page.evaluate(() => state)).toBe('won');
        });

        test('a win is announced on the overlay', async ({ page }) => {
            await page.evaluate(() => {
                level = LEVEL_COUNT;
                buildLevel(LEVEL_COUNT);
                doors.forEach((d) => {
                    if (d.type === 'document') d.collected = true;
                });
                player.inCar = null;
                player.floor = FLOOR_COUNT - 1;
                player.y = floorY(FLOOR_COUNT - 1);
                player.x = exitZone.x + exitZone.w / 2;
                physicsStep(1 / 120);
            });
            await expect(page.locator('#overlay-title')).toContainText(/win|clear|escape/i);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses a running game', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('P unpauses', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the overlay shows while paused', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('nothing moves while paused', async ({ page }) => {
            await startFrozen(page);
            await quietBuilding(page);
            await placePlayer(page, { floor: 2, x: 200 });
            await page.evaluate(() => {
                state = 'paused';
            });
            await holdKeys(page, ['ArrowRight']);
            await stepSeconds(page, 1);
            expect((await playerState(page)).x).toBe(200);
        });

        test('P does nothing before the game starts', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Score keeping
    // -----------------------------------------------------------------------
    test.describe('score', () => {
        test('the HUD mirrors the score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 1234;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('1234');
        });

        test('the HUD mirrors the level', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                level = 3;
                updateHud();
            });
            await expect(page.locator('#level')).toHaveText('3');
        });

        test('a game over stores a new best score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 5600;
                lives = 1;
                loseLife();
            });
            expect(
                await page.evaluate(() => window.localStorage.getItem('elevatoraction-best'))
            ).toBe('5600');
        });

        test('a weaker run leaves the best score alone', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '9000'));
            await page.reload();
            await startFrozen(page);
            await page.evaluate(() => {
                score = 100;
                lives = 1;
                loseLife();
            });
            expect(
                await page.evaluate(() => window.localStorage.getItem('elevatoraction-best'))
            ).toBe('9000');
        });

        test('the best score shows on the game over overlay', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 2500;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#overlay-score')).toContainText('2500');
            await expect(page.locator('#best')).toHaveText('2500');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering and the loop
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is drawn on, not left blank', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => draw());
            const distinct = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, 480, 640).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(distinct).toBeGreaterThan(4);
        });

        test('the simulation advances on its own once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                enemies.length = 0;
                spawnTimer = 1e6;
                player.x = 60;
                keys['ArrowRight'] = true;
            });
            await page.waitForTimeout(400);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(60);
        });

        test('the simulation is frame-rate independent', async ({ page }) => {
            await startFrozen(page);
            await quietBuilding(page);
            await placePlayer(page, { floor: 0, x: 40 });
            await holdKeys(page, ['ArrowRight']);
            await stepSeconds(page, 0.5);
            const coarse = (await playerState(page)).x;

            await placePlayer(page, { floor: 0, x: 40 });
            await page.evaluate(() => {
                for (let i = 0; i < 120; i++) physicsStep(1 / 240);
            });
            const fine = (await playerState(page)).x;
            expect(Math.abs(coarse - fine)).toBeLessThan(0.001);
        });

        test('replaying the same inputs gives the same result', async ({ page }) => {
            const run = () =>
                page.evaluate(() => {
                    startGame();
                    autoRun = false;
                    keys['ArrowRight'] = true;
                    for (let i = 0; i < 600; i++) physicsStep(1 / 120);
                    keys['ArrowRight'] = false;
                    return JSON.stringify({
                        x: player.x,
                        y: player.y,
                        score,
                        enemies: enemies.map((e) => [e.x, e.floor, e.dir]),
                    });
                });
            expect(await run()).toBe(await run());
        });

        test('a scripted raid rides down and escapes', async ({ page }) => {
            await startFrozen(page);
            const result = await page.evaluate(() => {
                // An empty building: this test is about the route, not the fight.
                spawnTimer = 1e6;
                enemies.length = 0;
                doors.forEach((d) => {
                    if (d.type === 'document') d.collected = true;
                });

                const run = (held, steps, until) => {
                    for (const code of Object.keys(keys)) keys[code] = false;
                    held.forEach((c) => (keys[c] = true));
                    for (let i = 0; i < steps; i++) {
                        physicsStep(1 / 120);
                        if (until && until()) break;
                    }
                };

                // Walk into the car parked on the roof floor, then ride it down.
                run(['ArrowRight'], 400, () => player.inCar !== null);
                const boarded = player.inCar;
                run(['ArrowDown'], 1200, () => player.floor === FLOOR_COUNT - 1);
                const arrived = player.floor;

                // Tap right along the ground floor: each tap steps out of a car
                // and walks on until the next shaft.
                for (let tap = 0; tap < 12 && state === 'running'; tap++) {
                    run([], 2);
                    run(['ArrowRight'], 400, () => state !== 'running');
                }

                return { boarded, arrived, state, score };
            });

            expect(result.boarded).toBe(0);
            expect(result.arrived).toBe(5);
            expect(result.state).toBe('levelclear');
            expect(result.score).toBeGreaterThan(0);
        });

        test('a long unattended run stays stable', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await startFrozen(page);
            await stepSeconds(page, 120);
            expect(errors).toEqual([]);
            expect(await page.evaluate(() => bullets.length)).toBeLessThan(60);
            expect(['running', 'gameover']).toContain(await page.evaluate(() => state));
        });
    });

    // -----------------------------------------------------------------------
    // Repository integration
    // -----------------------------------------------------------------------
    test.describe('repository integration', () => {
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

        test('the game browser category is one the browser knows', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'elevator-action');
            expect(['Action', 'Puzzle', 'Strategy', 'Board Game', 'Card Game', 'Sports']).toContain(
                entry.category
            );
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

        test('the DESIGN doc records the assumptions made', () => {
            const design = fs.readFileSync(
                path.join(REPO_ROOT, 'ElevatorAction/DESIGN.md'),
                'utf8'
            );
            expect(design).toMatch(/## Assumptions/);
            expect(design).toMatch(/## Controls/);
        });
    });
});
