const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a level, freeze the animation loop, and silence agent spawning so a
// test only sees the characters it put on the board itself.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
        agents.length = 0;
        bullets.length = 0;
        spawnInterval = Infinity;
        spawnTimer = 0;
    });
}

// Put the player on a known floor at a known x, out of any elevator.
async function placePlayer(page, floor, x, opts = {}) {
    await page.evaluate(({ floor, x, opts }) => {
        player.inElevator = null;
        player.floor = floor;
        player.y = floorY(floor);
        player.x = x;
        player.crouch = !!opts.crouch;
        player.dir = opts.dir === undefined ? 1 : opts.dir;
        player.cooldown = 0;
    }, { floor, x, opts });
}

// Drop an agent onto the board with a known stance.
async function addAgent(page, floor, x, opts = {}) {
    await page.evaluate(({ floor, x, opts }) => {
        agents.push({
            x,
            y: floorY(floor),
            floor,
            dir: opts.dir === undefined ? -1 : opts.dir,
            cooldown: opts.cooldown === undefined ? 0 : opts.cooldown,
        });
    }, { floor, x, opts });
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(1 / 120);
    }, steps);
}

async function hold(page, ...codes) {
    await page.evaluate((list) => list.forEach((c) => { keys[c] = true; }), codes);
}

async function release(page, ...codes) {
    await page.evaluate((list) => list.forEach((c) => { keys[c] = false; }), codes);
}

// Collect every document on the board without walking the floors.
async function collectAllDocs(page) {
    await page.evaluate(() => {
        doors.forEach((d) => {
            if (d.type === 'red' && !d.collected) d.collected = true;
        });
        updateHud();
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

        test('canvas is 480x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('the world is taller than the canvas', async ({ page }) => {
            const { worldH, vh } = await page.evaluate(() => ({ worldH: WORLD_H, vh: VH }));
            expect(worldH).toBe(960);
            expect(worldH).toBeGreaterThan(vh);
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
            await expect(page.locator('#docs')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the building is empty before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                doors: doors.length,
                agents: agents.length,
                bullets: bullets.length,
            }));
            expect(counts).toEqual({ doors: 0, agents: 0, bullets: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '18200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('18200');
        });

        test('the help legend explains the elevator, ducking and shooting', async ({ page }) => {
            const help = page.locator('.help');
            await expect(help).toContainText(/elevator/i);
            await expect(help).toContainText(/duck|crouch/i);
            await expect(help).toContainText(/shoot|fire/i);
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

        test('clicking the canvas starts the game', async ({ page }) => {
            await page.locator('#canvas').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the player starts on the roof', async ({ page }) => {
            await startFrozen(page);
            const p = await page.evaluate(() => ({
                floor: player.floor,
                y: player.y,
                roofY: floorY(FLOOR_COUNT - 1),
                inElevator: player.inElevator,
            }));
            expect(p.floor).toBe(9);
            expect(p.y).toBe(p.roofY);
            expect(p.inElevator).toBeNull();
        });

        test('level 1 puts four documents in the building', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => docsLeft())).toBe(4);
            await expect(page.locator('#docs')).toHaveText('4');
        });

        test('every floor above the garage has doors', async ({ page }) => {
            await startFrozen(page);
            const floorsWithDoors = await page.evaluate(() =>
                [...new Set(doors.map((d) => d.floor))].sort((a, b) => a - b)
            );
            for (let i = 1; i < 10; i++) expect(floorsWithDoors).toContain(i);
        });

        test('the board is the same building every time for a level', async ({ page }) => {
            const [first, second] = await page.evaluate(() => {
                const snap = () => buildLevel(1).map((d) => `${d.floor}:${d.x}:${d.type}`).join('|');
                return [snap(), snap()];
            });
            expect(first).toBe(second);
        });

        test('doors never sit inside an elevator shaft', async ({ page }) => {
            await startFrozen(page);
            const overlapping = await page.evaluate(() =>
                doors.filter((d) =>
                    SHAFT_X.some((sx) => Math.abs(d.x - sx) < SHAFT_W / 2 + DOOR_W / 2)
                ).length
            );
            expect(overlapping).toBe(0);
        });

        test('restarting after a game over resets score and lives', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                score = 4200;
                lives = 0;
                state = 'gameover';
            });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, score, lives, level }));
            expect(s).toEqual({ state: 'running', score: 0, lives: 3, level: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Walking the floors
    // -----------------------------------------------------------------------
    test.describe('walking', () => {
        test('holding right walks right', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await hold(page, 'ArrowRight');
            await step(page, 60);
            const x = await page.evaluate(() => player.x);
            expect(x).toBeGreaterThan(100);
            expect(x).toBeLessThan(125);
        });

        test('holding left walks left', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 100);
            await hold(page, 'ArrowLeft');
            await step(page, 60);
            expect(await page.evaluate(() => player.x)).toBeLessThan(60);
        });

        test('A and D also walk', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await hold(page, 'KeyD');
            await step(page, 30);
            const after = await page.evaluate(() => player.x);
            expect(after).toBeGreaterThan(60);
            await release(page, 'KeyD');
            await hold(page, 'KeyA');
            await step(page, 30);
            expect(await page.evaluate(() => player.x)).toBeLessThan(after);
        });

        test('facing follows the walk direction', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60, { dir: 1 });
            await hold(page, 'ArrowLeft');
            await step(page, 2);
            expect(await page.evaluate(() => player.dir)).toBe(-1);
            await release(page, 'ArrowLeft');
            await hold(page, 'ArrowRight');
            await step(page, 2);
            expect(await page.evaluate(() => player.dir)).toBe(1);
        });

        test('the player stops at the left wall', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 40);
            await hold(page, 'ArrowLeft');
            await step(page, 240);
            const { x, left } = await page.evaluate(() => ({ x: player.x, left: WALL + PLAYER_HW }));
            expect(x).toBeCloseTo(left, 1);
        });

        test('the player stops at the right wall', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 400);
            await page.evaluate(() => { elevators.forEach((e) => { e.y = floorY(9); }); });
            await hold(page, 'ArrowRight');
            await step(page, 360);
            const { x, right } = await page.evaluate(() => ({ x: player.x, right: W - WALL - PLAYER_HW }));
            expect(x).toBeCloseTo(right, 1);
        });

        test('a shaft with no car at this floor blocks the way', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { elevators[0].y = floorY(2); });
            await placePlayer(page, 9, 60);
            await hold(page, 'ArrowRight');
            await step(page, 240);
            const { x, edge } = await page.evaluate(() => ({
                x: player.x,
                edge: SHAFT_X[0] - SHAFT_W / 2 - PLAYER_HW,
            }));
            expect(x).toBeCloseTo(edge, 1);
        });

        test('a car at this floor opens the shaft to walk across', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { elevators[0].y = floorY(9); elevators[1].y = floorY(9); });
            await placePlayer(page, 9, 60);
            await hold(page, 'ArrowRight');
            await step(page, 360);
            const crossed = await page.evaluate(() => ({
                x: player.x,
                beyond: SHAFT_X[1] + SHAFT_W / 2,
            }));
            expect(crossed.x).toBeGreaterThan(crossed.beyond);
        });

        test('ducking stops the player walking', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60, { crouch: true });
            await hold(page, 'ArrowRight', 'ArrowDown');
            await step(page, 60);
            expect(await page.evaluate(() => player.x)).toBeCloseTo(60, 1);
        });
    });

    // -----------------------------------------------------------------------
    // Ducking
    // -----------------------------------------------------------------------
    test.describe('ducking', () => {
        test('Down ducks when there is no car to board', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.crouch)).toBe(true);
        });

        test('releasing Down stands the player back up', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await hold(page, 'ArrowDown');
            await step(page, 2);
            expect(await page.evaluate(() => player.crouch)).toBe(true);
            await release(page, 'ArrowDown');
            await step(page, 2);
            expect(await page.evaluate(() => player.crouch)).toBe(false);
        });

        test('a ducked player is shorter', async ({ page }) => {
            const heights = await page.evaluate(() => ({ standing: PLAYER_H, ducked: CROUCH_H }));
            expect(heights.ducked).toBeLessThan(heights.standing);
        });

        test('a player in an elevator is never ducked', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await page.evaluate(() => {
                elevators[0].y = floorY(9);
                player.x = SHAFT_X[0];
                keys.ArrowDown = true;
                physicsStep(1 / 120);
            });
            const p = await page.evaluate(() => ({ inElevator: player.inElevator, crouch: player.crouch }));
            expect(p.inElevator).toBe(0);
            expect(p.crouch).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Elevators
    // -----------------------------------------------------------------------
    test.describe('elevators', () => {
        test('there are two shafts, each with a car', async ({ page }) => {
            await startFrozen(page);
            const info = await page.evaluate(() => ({
                shafts: SHAFT_X.length,
                cars: elevators.length,
                ys: elevators.map((e) => e.y),
            }));
            expect(info.shafts).toBe(2);
            expect(info.cars).toBe(2);
            info.ys.forEach((y) => expect(Number.isFinite(y)).toBe(true));
        });

        test('Down boards an aligned car', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { elevators[0].y = floorY(9); player.x = SHAFT_X[0]; });
            await hold(page, 'ArrowDown');
            await step(page, 1);
            expect(await page.evaluate(() => player.inElevator)).toBe(0);
        });

        test('Up boards an aligned car too', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 4, 300);
            await page.evaluate(() => { elevators[1].y = floorY(4); player.x = SHAFT_X[1]; });
            await hold(page, 'ArrowUp');
            await step(page, 1);
            expect(await page.evaluate(() => player.inElevator)).toBe(1);
        });

        test('a car at another floor cannot be boarded', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { elevators[0].y = floorY(3); player.x = SHAFT_X[0]; player.floor = 9; player.y = floorY(9); });
            await hold(page, 'ArrowDown');
            await step(page, 4);
            expect(await page.evaluate(() => player.inElevator)).toBeNull();
        });

        test('holding Down drives the car down and the player with it', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { elevators[0].y = floorY(9); player.x = SHAFT_X[0]; });
            await hold(page, 'ArrowDown');
            await step(page, 120);
            const after = await page.evaluate(() => ({ car: elevators[0].y, feet: player.y, start: floorY(9) }));
            expect(after.car).toBeGreaterThan(after.start + 50);
            expect(after.feet).toBe(after.car);
        });

        test('holding Up drives the car up', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 2, 150);
            await page.evaluate(() => { elevators[0].y = floorY(2); player.x = SHAFT_X[0]; });
            await hold(page, 'ArrowUp');
            await step(page, 2);
            await release(page, 'ArrowUp');
            const boarded = await page.evaluate(() => elevators[0].y);
            await hold(page, 'ArrowUp');
            await step(page, 120);
            expect(await page.evaluate(() => elevators[0].y)).toBeLessThan(boarded - 50);
        });

        test('a car stops at the garage', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { elevators[0].y = floorY(9); player.x = SHAFT_X[0]; });
            await hold(page, 'ArrowDown');
            await step(page, 2000);
            const { car, bottom } = await page.evaluate(() => ({ car: elevators[0].y, bottom: floorY(0) }));
            expect(car).toBeCloseTo(bottom, 1);
        });

        test('a car stops at the roof', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 150);
            await page.evaluate(() => { elevators[0].y = floorY(0); player.x = SHAFT_X[0]; });
            await hold(page, 'ArrowUp');
            await step(page, 2000);
            const { car, top } = await page.evaluate(() => ({ car: elevators[0].y, top: floorY(FLOOR_COUNT - 1) }));
            expect(car).toBeCloseTo(top, 1);
        });

        test('stepping off at a floor puts the player on that floor', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                elevators[0].y = floorY(9);
                player.x = SHAFT_X[0];
                keys.ArrowDown = true;
                physicsStep(1 / 120);
                keys.ArrowDown = false;
                elevators[0].y = floorY(5);
                player.y = elevators[0].y;
            });
            await hold(page, 'ArrowRight');
            await step(page, 2);
            const p = await page.evaluate(() => ({
                inElevator: player.inElevator,
                floor: player.floor,
                y: player.y,
                target: floorY(5),
                x: player.x,
                shaftRight: SHAFT_X[0] + SHAFT_W / 2,
            }));
            expect(p.inElevator).toBeNull();
            expect(p.floor).toBe(5);
            expect(p.y).toBe(p.target);
            expect(p.x).toBeGreaterThanOrEqual(p.shaftRight);
        });

        test('stepping off to the left works as well', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                elevators[0].y = floorY(9);
                player.x = SHAFT_X[0];
                keys.ArrowDown = true;
                physicsStep(1 / 120);
                keys.ArrowDown = false;
                elevators[0].y = floorY(7);
                player.y = elevators[0].y;
            });
            await hold(page, 'ArrowLeft');
            await step(page, 2);
            const p = await page.evaluate(() => ({
                inElevator: player.inElevator,
                floor: player.floor,
                x: player.x,
                shaftLeft: SHAFT_X[0] - SHAFT_W / 2,
            }));
            expect(p.inElevator).toBeNull();
            expect(p.floor).toBe(7);
            expect(p.x).toBeLessThanOrEqual(p.shaftLeft);
        });

        test('the player cannot step out between floors', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                elevators[0].y = floorY(9);
                player.x = SHAFT_X[0];
                keys.ArrowDown = true;
                physicsStep(1 / 120);
                keys.ArrowDown = false;
                elevators[0].y = (floorY(9) + floorY(8)) / 2;
                player.y = elevators[0].y;
            });
            await hold(page, 'ArrowRight');
            await step(page, 4);
            expect(await page.evaluate(() => player.inElevator)).toBe(0);
        });

        test('later levels run the elevators faster', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                loadLevel(1);
                const first = elevatorSpeed();
                loadLevel(3);
                return [first, elevatorSpeed()];
            });
            expect(speeds[1]).toBeGreaterThan(speeds[0]);
        });
    });

    // -----------------------------------------------------------------------
    // Documents
    // -----------------------------------------------------------------------
    test.describe('documents', () => {
        test('walking into a red door collects it', async ({ page }) => {
            await startFrozen(page);
            const before = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'red');
                player.inElevator = null;
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x;
                return { docs: docsLeft(), score };
            });
            await step(page, 1);
            const after = await page.evaluate(() => ({ docs: docsLeft(), score }));
            expect(after.docs).toBe(before.docs - 1);
            expect(after.score).toBe(before.score + 500);
        });

        test('a collected door cannot be collected twice', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'red');
                player.inElevator = null;
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x;
            });
            await step(page, 120);
            expect(await page.evaluate(() => score)).toBe(500);
        });

        test('a red door on another floor is not collected', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'red');
                player.inElevator = null;
                player.floor = d.floor === 9 ? 8 : 9;
                player.y = floorY(player.floor);
                player.x = d.x;
            });
            await step(page, 60);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('a grey door is not a document', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'grey');
                player.inElevator = null;
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x;
            });
            await step(page, 60);
            expect(await page.evaluate(() => ({ score, docs: docsLeft() }))).toEqual({ score: 0, docs: 4 });
        });

        test('the HUD counts documents down', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'red');
                player.inElevator = null;
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x;
            });
            await step(page, 1);
            await expect(page.locator('#docs')).toHaveText('3');
        });

        test('red doors are spread over different floors', async ({ page }) => {
            await startFrozen(page);
            const floors = await page.evaluate(() =>
                doors.filter((d) => d.type === 'red').map((d) => d.floor)
            );
            expect(new Set(floors).size).toBe(floors.length);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('Space fires a bullet while running', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60, { dir: 1 });
            await page.keyboard.press('Space');
            const b = await page.evaluate(() => bullets.map((x) => ({ from: x.from, vx: x.vx })));
            expect(b).toHaveLength(1);
            expect(b[0].from).toBe('player');
            expect(b[0].vx).toBeGreaterThan(0);
        });

        test('the bullet leaves at chest height when standing', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await page.evaluate(() => playerShoot());
            const { y, feet } = await page.evaluate(() => ({ y: bullets[0].y, feet: player.y }));
            expect(feet - y).toBe(22);
        });

        test('the bullet leaves low when ducked', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60, { crouch: true });
            await page.evaluate(() => playerShoot());
            const { y, feet } = await page.evaluate(() => ({ y: bullets[0].y, feet: player.y }));
            expect(feet - y).toBe(10);
        });

        test('shooting left sends the bullet left', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 200, { dir: -1 });
            await page.evaluate(() => playerShoot());
            expect(await page.evaluate(() => bullets[0].vx)).toBeLessThan(0);
        });

        test('there is a cooldown between shots', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await page.evaluate(() => { playerShoot(); playerShoot(); playerShoot(); });
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('the cooldown expires and lets a second shot through', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await page.evaluate(() => playerShoot());
            await step(page, 60);
            await page.evaluate(() => playerShoot());
            expect(await page.evaluate(() => bullets.filter((b) => b.from === 'player').length)).toBeGreaterThan(0);
        });

        test('bullets travel and then expire at the world edge', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60, { dir: 1 });
            await page.evaluate(() => playerShoot());
            const start = await page.evaluate(() => bullets[0].x);
            await step(page, 10);
            expect(await page.evaluate(() => bullets[0].x)).toBeGreaterThan(start);
            await step(page, 400);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a bullet kills an agent on the same floor', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60, { dir: 1 });
            await addAgent(page, 9, 240, { cooldown: 99 });
            await page.evaluate(() => playerShoot());
            await step(page, 120);
            const after = await page.evaluate(() => ({ agents: agents.length, score, bullets: bullets.length }));
            expect(after.agents).toBe(0);
            expect(after.score).toBe(300);
            expect(after.bullets).toBe(0);
        });

        test('a bullet misses an agent on another floor', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60, { dir: 1 });
            await addAgent(page, 8, 240, { cooldown: 99 });
            await page.evaluate(() => playerShoot());
            await step(page, 120);
            expect(await page.evaluate(() => ({ agents: agents.length, score }))).toEqual({ agents: 1, score: 0 });
        });

        test('a ducked shot still hits an agent', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60, { dir: 1, crouch: true });
            await addAgent(page, 9, 220, { cooldown: 99 });
            await page.evaluate(() => playerShoot());
            await step(page, 120);
            expect(await page.evaluate(() => agents.length)).toBe(0);
        });

        test('shooting does nothing before the game starts', async ({ page }) => {
            await page.evaluate(() => playerShoot());
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Agents
    // -----------------------------------------------------------------------
    test.describe('agents', () => {
        test('agents come out of the doors over time', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                for (let i = 0; i < 1200; i++) physicsStep(1 / 120);
            });
            expect(await page.evaluate(() => agents.length)).toBeGreaterThan(0);
        });

        test('agent numbers are capped', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoRun = false;
                let peak = 0;
                for (let i = 0; i < 20000; i++) {
                    physicsStep(1 / 120);
                    peak = Math.max(peak, agents.length);
                }
                return { peak, cap: maxAgents };
            });
            expect(result.peak).toBeLessThanOrEqual(result.cap);
        });

        test('agents spawn at a door', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                autoRun = false;
                for (let i = 0; i < 2000 && agents.length === 0; i++) physicsStep(1 / 120);
                const a = agents[0];
                return doors.some((d) => d.floor === a.floor && Math.abs(d.x - a.x) < 1);
            });
            expect(ok).toBe(true);
        });

        test('an agent walks toward the player on its floor', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await addAgent(page, 9, 300, { cooldown: 99 });
            const before = await page.evaluate(() => agents[0].x);
            await step(page, 60);
            expect(await page.evaluate(() => agents[0].x)).toBeLessThan(before);
        });

        test('an agent faces the player it is chasing', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 400);
            await addAgent(page, 9, 60, { dir: -1, cooldown: 99 });
            await step(page, 4);
            expect(await page.evaluate(() => agents[0].dir)).toBe(1);
        });

        test('an agent shoots at the player on its floor', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await addAgent(page, 9, 200, { dir: -1, cooldown: 0 });
            await step(page, 2);
            const shots = await page.evaluate(() => bullets.filter((b) => b.from === 'agent').length);
            expect(shots).toBeGreaterThan(0);
        });

        test('an agent does not shoot at a player on another floor', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 7, 60);
            await addAgent(page, 9, 200, { dir: -1, cooldown: 0 });
            await step(page, 60);
            expect(await page.evaluate(() => bullets.filter((b) => b.from === 'agent').length)).toBe(0);
        });

        test('an agent bullet flies at chest height', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await addAgent(page, 9, 200, { dir: -1, cooldown: 0 });
            await step(page, 2);
            const b = await page.evaluate(() => {
                const shot = bullets.find((x) => x.from === 'agent');
                return { drop: floorY(9) - shot.y };
            });
            expect(b.drop).toBe(22);
        });

        test('an agent keeps its distance between shots', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await addAgent(page, 9, 200, { dir: -1, cooldown: 0 });
            await step(page, 4);
            const first = await page.evaluate(() => bullets.filter((b) => b.from === 'agent').length);
            await step(page, 20);
            expect(await page.evaluate(() => bullets.filter((b) => b.from === 'agent').length)).toBe(first);
        });

        test('agents never leave the building', async ({ page }) => {
            const escaped = await page.evaluate(() => {
                startGame();
                autoRun = false;
                for (let i = 0; i < 6000; i++) {
                    physicsStep(1 / 120);
                    const bad = agents.find((a) => a.x < WALL || a.x > W - WALL);
                    if (bad) return bad.x;
                }
                return null;
            });
            expect(escaped).toBeNull();
        });

        test('later levels send more agents', async ({ page }) => {
            const caps = await page.evaluate(() => {
                loadLevel(1);
                const a = maxAgents;
                loadLevel(3);
                return [a, maxAgents];
            });
            expect(caps[1]).toBeGreaterThan(caps[0]);
        });
    });

    // -----------------------------------------------------------------------
    // Getting hit
    // -----------------------------------------------------------------------
    test.describe('getting hit', () => {
        test('an agent bullet costs a life', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await addAgent(page, 9, 200, { dir: -1, cooldown: 0 });
            await step(page, 120);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a duck goes under an agent bullet', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60, { crouch: true });
            await hold(page, 'ArrowDown');
            await addAgent(page, 9, 200, { dir: -1, cooldown: 0 });
            await step(page, 120);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('a bullet that has passed the player leaves them alone', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 300);
            await page.evaluate(() => {
                bullets.push({ x: 60, y: floorY(9) - 22, vx: -240, from: 'agent' });
            });
            await step(page, 60);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('touching an agent costs a life even when ducked', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 200, { crouch: true });
            await addAgent(page, 9, 202, { cooldown: 99 });
            await step(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a death clears the board and returns the player to the roof', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 3, 200);
            await addAgent(page, 3, 202, { cooldown: 99 });
            await step(page, 2);
            const after = await page.evaluate(() => ({
                agents: agents.length,
                bullets: bullets.length,
                floor: player.floor,
                y: player.y,
                roof: floorY(FLOOR_COUNT - 1),
                inElevator: player.inElevator,
            }));
            expect(after.agents).toBe(0);
            expect(after.bullets).toBe(0);
            expect(after.floor).toBe(9);
            expect(after.y).toBe(after.roof);
            expect(after.inElevator).toBeNull();
        });

        test('documents already collected survive a death', async ({ page }) => {
            await startFrozen(page);
            await collectAllDocs(page);
            await placePlayer(page, 5, 200);
            await addAgent(page, 5, 202, { cooldown: 99 });
            await step(page, 2);
            expect(await page.evaluate(() => docsLeft())).toBe(0);
        });

        test('the last life ends the run', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { lives = 1; });
            await placePlayer(page, 9, 200);
            await addAgent(page, 9, 202, { cooldown: 99 });
            await step(page, 2);
            expect(await page.evaluate(() => ({ state, lives }))).toEqual({ state: 'gameover', lives: 0 });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('a game over stores the best score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { lives = 1; score = 7700; });
            await placePlayer(page, 9, 200);
            await addAgent(page, 9, 202, { cooldown: 99 });
            await step(page, 2);
            const best = await page.evaluate(() => window.localStorage.getItem('elevatoraction-best'));
            expect(Number(best)).toBe(7700);
            await expect(page.locator('#best')).toHaveText('7700');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '9000'));
            await page.reload();
            await startFrozen(page);
            await page.evaluate(() => { lives = 1; score = 100; });
            await placePlayer(page, 9, 200);
            await addAgent(page, 9, 202, { cooldown: 99 });
            await step(page, 2);
            expect(Number(await page.evaluate(() => window.localStorage.getItem('elevatoraction-best')))).toBe(9000);
        });

        test('the player cannot be hit twice in one death', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 200);
            await addAgent(page, 9, 202, { cooldown: 99 });
            await addAgent(page, 9, 204, { cooldown: 99 });
            await step(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // The getaway
    // -----------------------------------------------------------------------
    test.describe('the getaway', () => {
        test('the exit does nothing while documents are missing', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 440);
            await step(page, 10);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('reaching the exit with every document clears the level', async ({ page }) => {
            await startFrozen(page);
            await collectAllDocs(page);
            await placePlayer(page, 0, 440);
            await step(page, 2);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('clearing a level pays a bonus', async ({ page }) => {
            await startFrozen(page);
            await collectAllDocs(page);
            await page.evaluate(() => { score = 0; });
            await placePlayer(page, 0, 440);
            await step(page, 2);
            expect(await page.evaluate(() => score)).toBe(1000);
        });

        test('the exit only counts on the garage floor', async ({ page }) => {
            await startFrozen(page);
            await collectAllDocs(page);
            await placePlayer(page, 1, 440);
            await step(page, 10);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Space moves on to the next level', async ({ page }) => {
            await startFrozen(page);
            await collectAllDocs(page);
            await placePlayer(page, 0, 440);
            await step(page, 2);
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, level, lives, docs: docsLeft(), floor: player.floor }));
            expect(s.state).toBe('running');
            expect(s.level).toBe(2);
            expect(s.lives).toBe(3);
            expect(s.docs).toBe(5);
            expect(s.floor).toBe(9);
        });

        test('the score carries into the next level', async ({ page }) => {
            await startFrozen(page);
            await collectAllDocs(page);
            await placePlayer(page, 0, 440);
            await step(page, 2);
            const cleared = await page.evaluate(() => score);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => score)).toBe(cleared);
        });

        test('clearing the last level wins the run', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                spawnInterval = Infinity;
                agents.length = 0;
                loadLevel(LEVEL_COUNT);
                doors.forEach((d) => { d.collected = true; });
                player.inElevator = null;
                player.floor = 0;
                player.y = floorY(0);
                player.x = 440;
                physicsStep(1 / 120);
            });
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/win|won/i);
        });

        test('a win stores the best score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                spawnInterval = Infinity;
                agents.length = 0;
                loadLevel(LEVEL_COUNT);
                doors.forEach((d) => { d.collected = true; });
                score = 12000;
                player.inElevator = null;
                player.floor = 0;
                player.y = floorY(0);
                player.x = 440;
                physicsStep(1 / 120);
            });
            expect(Number(await page.evaluate(() => window.localStorage.getItem('elevatoraction-best')))).toBeGreaterThanOrEqual(12000);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await page.keyboard.press('KeyP');
            await hold(page, 'ArrowRight');
            await step(page, 120);
            expect(await page.evaluate(() => player.x)).toBeCloseTo(60, 1);
        });

        test('pausing before the game starts does nothing', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Camera and drawing
    // -----------------------------------------------------------------------
    test.describe('camera and drawing', () => {
        test('the camera sits at the top of the world on the roof', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 9, 60);
            await step(page, 1);
            expect(await page.evaluate(() => camera.y)).toBe(0);
        });

        test('the camera follows the player down the building', async ({ page }) => {
            await startFrozen(page);
            await placePlayer(page, 0, 60);
            await step(page, 1);
            const { y, max } = await page.evaluate(() => ({ y: camera.y, max: WORLD_H - VH }));
            expect(y).toBe(max);
        });

        test('the camera never shows outside the world', async ({ page }) => {
            const worst = await page.evaluate(() => {
                startGame();
                autoRun = false;
                let bad = null;
                for (let f = 0; f < FLOOR_COUNT; f++) {
                    player.inElevator = null;
                    player.floor = f;
                    player.y = floorY(f);
                    physicsStep(1 / 120);
                    if (camera.y < 0 || camera.y > WORLD_H - VH) bad = { f, y: camera.y };
                }
                return bad;
            });
            expect(worst).toBeNull();
        });

        test('the canvas keeps repainting while the game runs', async ({ page }) => {
            await page.keyboard.press('Space');
            const first = await page.locator('#canvas').screenshot();
            await page.waitForTimeout(250);
            const second = await page.locator('#canvas').screenshot();
            expect(Buffer.compare(first, second)).not.toBe(0);
        });

        test('the idle screen is already drawn', async ({ page }) => {
            const shot = await page.locator('#canvas').screenshot();
            expect(shot.length).toBeGreaterThan(1000);
        });
    });

    // -----------------------------------------------------------------------
    // A real, unassisted run
    // -----------------------------------------------------------------------
    test.describe('playing for real', () => {
        test('an unaided run collects documents, shoots agents and ends legally', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoRun = false;

                const clearKeys = () => Object.keys(keys).forEach((k) => { keys[k] = false; });

                // The nearest document still in the building; once they are all
                // collected the garage on floor 0 is the target instead.
                const nextDoc = () =>
                    doors
                        .filter((d) => d.type === 'red' && !d.collected)
                        .sort((a, b) => Math.abs(a.floor - player.floor) - Math.abs(b.floor - player.floor))[0];

                let guard = 0;
                while (state === 'running' && guard++ < 90000) {
                    clearKeys();
                    const doc = nextDoc();

                    // deal with company on this floor before moving
                    if (player.inElevator === null) {
                        const threat = agents.find((a) => a.floor === player.floor);
                        if (threat) {
                            player.dir = threat.x > player.x ? 1 : -1;
                            playerShoot();
                        }
                    }

                    if (player.inElevator !== null) {
                        const car = elevators[player.inElevator];
                        const want = floorY(doc ? doc.floor : 0);
                        if (Math.abs(car.y - want) <= 2) keys.ArrowRight = true;
                        else keys[car.y < want ? 'ArrowDown' : 'ArrowUp'] = true;
                    } else if (doc && doc.floor === player.floor) {
                        keys[doc.x > player.x ? 'ArrowRight' : 'ArrowLeft'] = true;
                    } else if (!doc && player.floor === 0) {
                        keys.ArrowRight = true;
                    } else {
                        // head for a shaft whose car is serving this floor, then board
                        const i = elevators.findIndex(
                            (e) => Math.abs(e.y - floorY(player.floor)) <= ALIGN_TOL
                        );
                        const target = SHAFT_X[i >= 0 ? i : 0];
                        if (Math.abs(player.x - target) <= 2) keys.ArrowDown = true;
                        else keys[target > player.x ? 'ArrowRight' : 'ArrowLeft'] = true;
                    }

                    physicsStep(1 / 120);
                }
                return { state, score, docs: docsLeft(), level, lives };
            });
            expect(['running', 'levelclear', 'gameover', 'won']).toContain(result.state);
            expect(result.score).toBeGreaterThan(0);
        });

        // The shafts are the only way around the building, so a badly placed
        // door or car would leave a level unfinishable. This plays level 1
        // through with the agents held back: it is the level design on trial,
        // not the gunfights.
        test('level 1 can be played through to the getaway car', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoRun = false;
                spawnInterval = Infinity;
                agents.length = 0;

                const segOf = (x) => (x < SHAFT_X[0] ? 0 : x < SHAFT_X[1] ? 1 : 2);
                const nextTarget = () => {
                    const doc = doors.find((d) => d.type === 'red' && !d.collected);
                    return doc ? { floor: doc.floor, x: doc.x } : { floor: 0, x: 440 };
                };

                let guard = 0;
                while (state === 'running' && guard++ < 60000) {
                    Object.keys(keys).forEach((k) => { keys[k] = false; });

                    const t = nextTarget();
                    const tSeg = segOf(t.x);
                    const pSeg = segOf(player.x);
                    // the shaft that opens onto the target's stretch of floor
                    const want = tSeg === 0 ? 0 : tSeg === 2 ? 1 : pSeg === 2 ? 1 : 0;

                    if (player.inElevator !== null) {
                        const j = player.inElevator;
                        const car = elevators[j];
                        // the right shaft goes to the target floor; the wrong one
                        // goes to wherever the right one is parked
                        const goal = j === want ? floorY(t.floor) : elevators[want].y;
                        if (Math.abs(car.y - goal) <= 2) {
                            const side = j === want ? (tSeg <= j ? -1 : 1) : want > j ? 1 : -1;
                            keys[side > 0 ? 'ArrowRight' : 'ArrowLeft'] = true;
                        } else {
                            keys[car.y < goal ? 'ArrowDown' : 'ArrowUp'] = true;
                        }
                    } else if (player.floor === t.floor && pSeg === tSeg) {
                        keys[t.x > player.x ? 'ArrowRight' : 'ArrowLeft'] = true;
                    } else {
                        // board a car that is serving this floor from this stretch
                        const j = [want, 1 - want].find(
                            (k) =>
                                Math.abs(elevators[k].y - floorY(player.floor)) <= ALIGN_TOL &&
                                (pSeg === k || pSeg === k + 1)
                        );
                        const lane = SHAFT_X[j === undefined ? want : j];
                        if (Math.abs(player.x - lane) <= 2) keys.ArrowDown = true;
                        else keys[lane > player.x ? 'ArrowRight' : 'ArrowLeft'] = true;
                    }

                    physicsStep(1 / 120);
                }
                return { state, docs: docsLeft(), score, ticks: guard };
            });
            expect(result.docs).toBe(0);
            expect(result.state).toBe('levelclear');
            expect(result.score).toBe(4 * 500 + 1000);
        });

        test('a long run never puts a character outside the world', async ({ page }) => {
            const bad = await page.evaluate(() => {
                startGame();
                autoRun = false;
                const plan = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'];
                for (let i = 0; i < 24000; i++) {
                    if (i % 240 === 0) {
                        Object.keys(keys).forEach((k) => { keys[k] = false; });
                        keys[plan[(i / 240) % plan.length]] = true;
                    }
                    if (i % 97 === 0) playerShoot();
                    physicsStep(1 / 120);
                    const out = [player, ...agents].find(
                        (c) => c.x < 0 || c.x > W || c.y < 0 || c.y > WORLD_H
                    );
                    if (out) return { x: out.x, y: out.y, i };
                }
                return null;
            });
            expect(bad).toBeNull();
        });

        test('the simulation stays stable over a long session', async ({ page }) => {
            const health = await page.evaluate(() => {
                startGame();
                autoRun = false;
                for (let i = 0; i < 30000; i++) {
                    if (i % 300 === 0) {
                        Object.keys(keys).forEach((k) => { keys[k] = false; });
                        keys.ArrowDown = true;
                    }
                    if (i % 61 === 0) playerShoot();
                    physicsStep(1 / 120);
                }
                return {
                    finite: Number.isFinite(player.x) && Number.isFinite(player.y) && Number.isFinite(score),
                    bullets: bullets.length,
                    agents: agents.length,
                    state,
                };
            });
            expect(health.finite).toBe(true);
            expect(health.bullets).toBeLessThan(60);
            expect(health.agents).toBeLessThanOrEqual(10);
        });
    });

    // -----------------------------------------------------------------------
    // Game browser integration
    // -----------------------------------------------------------------------
    test.describe('game browser integration', () => {
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
