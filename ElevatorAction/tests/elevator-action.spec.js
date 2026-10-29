const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// --- helpers ---------------------------------------------------------------

// Start a run and freeze the animation loop so a test can set the world up
// itself and advance the simulation one fixed timestep at a time.
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

// Hold exactly these key codes down and release everything else.
async function hold(page, codes) {
    await page.evaluate((cs) => {
        Object.keys(keys).forEach((k) => (keys[k] = false));
        cs.forEach((c) => (keys[c] = true));
    }, codes);
}

async function releaseAll(page) {
    await hold(page, []);
}

// Put the agent on a known floor at a known x, out of any shaft.
async function place(page, floor, x, opts = {}) {
    await page.evaluate(({ floor, x, opts }) => {
        player.floor = floor;
        player.x = x;
        player.y = floorY(floor);
        player.inShaft = -1;
        player.crouching = false;
        player.shootCd = 0;
        if (opts.facing !== undefined) player.facing = opts.facing;
    }, { floor, x, opts });
}

// Drop the agent onto an elevator car, with the car parked at `carY`.
async function board(page, shaft, carY) {
    await page.evaluate(({ shaft, carY }) => {
        elevators[shaft].y = carY;
        player.inShaft = shaft;
        player.x = elevators[shaft].x;
        player.y = carY;
        player.crouching = false;
    }, { shaft, carY });
}

async function snapshot(page) {
    return page.evaluate(() => ({
        state,
        score,
        level,
        lives,
        docs,
        player: { ...player },
        enemies: enemies.map((e) => ({ ...e })),
        bullets: bullets.map((b) => ({ ...b })),
        elevators: elevators.map((e) => ({ ...e })),
        camY: cam.y,
    }));
}

// Clear the field so stray enemies and bullets cannot interfere with a test.
async function clearField(page) {
    await page.evaluate(() => {
        enemies.length = 0;
        bullets.length = 0;
        spawnTimer = 1e6;
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

        test('canvas is 900x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '900');
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
            await expect(page.locator('#docs')).toHaveText('0/6');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('help text explains the controls', async ({ page }) => {
            const help = page.locator('.help');
            await expect(help).toContainText(/Space/i);
            await expect(help).toContainText(/P/);
        });

        test('the game starts idle and simulates nothing', async ({ page }) => {
            const before = await snapshot(page);
            expect(before.state).toBe('idle');
            await step(page, 60);
            const after = await snapshot(page);
            expect(after.player.x).toBe(before.player.x);
            expect(after.enemies.length).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Building geometry
    // -----------------------------------------------------------------------
    test.describe('building geometry', () => {
        test('the building is ten floors of 90px', async ({ page }) => {
            const geo = await page.evaluate(() => ({
                floors: FLOORS,
                floorH: FLOOR_H,
                top: floorY(0),
                bottom: floorY(FLOORS - 1),
            }));
            expect(geo.floors).toBe(10);
            expect(geo.floorH).toBe(90);
            expect(geo.top).toBe(90);
            expect(geo.bottom).toBe(900);
        });

        test('there are three elevator shafts with overlapping ranges', async ({ page }) => {
            const shafts = await page.evaluate(() => SHAFTS.map((s) => ({ ...s })));
            expect(shafts).toHaveLength(3);
            // Consecutive shafts must share at least one floor, or the agent
            // could never cross from one to the next.
            for (let i = 1; i < shafts.length; i++) {
                expect(shafts[i].top).toBeLessThanOrEqual(shafts[i - 1].bottom);
            }
            expect(shafts[0].top).toBe(0);
            expect(shafts[shafts.length - 1].bottom).toBe(9);
        });

        test('every shaft starts with a car parked at its top floor', async ({ page }) => {
            const ok = await page.evaluate(() =>
                elevators.every((e, i) => e.y === floorY(SHAFTS[i].top) && e.x === SHAFTS[i].x)
            );
            expect(ok).toBe(true);
        });

        test('doors are laid out on every floor and six of them are red', async ({ page }) => {
            const info = await page.evaluate(() => ({
                total: doors.length,
                red: doors.filter((d) => d.type === 'red').length,
                floors: [...new Set(doors.map((d) => d.floor))].sort((a, b) => a - b),
                inBounds: doors.every(
                    (d) => d.x > BUILDING_LEFT && d.x < BUILDING_RIGHT
                ),
                clearOfShafts: doors.every((d) =>
                    SHAFTS.every((s) => Math.abs(d.x - s.x) > SHAFT_W / 2 + DOOR_W / 2)
                ),
            }));
            expect(info.red).toBe(6);
            expect(info.total).toBeGreaterThan(30);
            expect(info.floors).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
            expect(info.inBounds).toBe(true);
            expect(info.clearOfShafts).toBe(true);
        });

        test('the exit sits on the bottom floor', async ({ page }) => {
            const exit = await page.evaluate(() => ({ ...EXIT, bottom: FLOORS - 1 }));
            expect(exit.floor).toBe(exit.bottom);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting a run', () => {
        test('startGame puts the agent on the top floor', async ({ page }) => {
            await startFrozen(page);
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.player.floor).toBe(0);
            expect(s.player.inShaft).toBe(-1);
            expect(s.player.y).toBe(90);
            expect(s.lives).toBe(3);
            expect(s.docs).toBe(0);
            expect(s.score).toBe(0);
            expect(s.enemies).toHaveLength(0);
            expect(s.bullets).toHaveLength(0);
        });

        test('the overlay hides once the run starts', async ({ page }) => {
            await startFrozen(page);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('pressing Space on the start screen begins the run', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button begins the run', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Walking
    // -----------------------------------------------------------------------
    test.describe('walking the corridors', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearField(page);
        });

        test('holding right walks right and faces right', async ({ page }) => {
            await place(page, 0, 90);
            await hold(page, ['ArrowRight']);
            await step(page, 60); // half a second
            const s = await snapshot(page);
            expect(s.player.x).toBeGreaterThan(145);
            expect(s.player.x).toBeLessThan(185);
            expect(s.player.facing).toBe(1);
        });

        test('holding left walks left and faces left', async ({ page }) => {
            await place(page, 0, 300);
            await hold(page, ['ArrowLeft']);
            await step(page, 60);
            const s = await snapshot(page);
            expect(s.player.x).toBeLessThan(240);
            expect(s.player.facing).toBe(-1);
        });

        test('A and D work as well as the arrow keys', async ({ page }) => {
            await place(page, 0, 90);
            await hold(page, ['KeyD']);
            await step(page, 30);
            const s = await snapshot(page);
            expect(s.player.x).toBeGreaterThan(100);
        });

        test('the agent cannot walk out of the building', async ({ page }) => {
            await place(page, 0, 820);
            await hold(page, ['ArrowRight']);
            await step(page, 240);
            let s = await snapshot(page);
            expect(s.player.x).toBeLessThanOrEqual(860 - 11);

            await place(page, 0, 60);
            await hold(page, ['ArrowLeft']);
            await step(page, 240);
            s = await snapshot(page);
            expect(s.player.x).toBeGreaterThanOrEqual(40 + 11);
        });

        test('an empty shaft is walked across, not into', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(3);
            });
            await place(page, 0, 150);
            await hold(page, ['ArrowRight']);
            await step(page, 120); // one second, 150px: past the whole shaft
            const s = await snapshot(page);
            expect(s.player.inShaft).toBe(-1);
            expect(s.player.x).toBeGreaterThan(266);
        });

        test('a corridor can be walked from wall to wall', async ({ page }) => {
            await place(page, 2, 51);
            await hold(page, ['ArrowRight']);
            await step(page, 700); // long enough to cross every shaft
            const s = await snapshot(page);
            expect(s.player.inShaft).toBe(-1);
            expect(s.player.x).toBe(860 - 11);
        });

        test('walking over a level car does not board it', async ({ page }) => {
            await place(page, 0, 150);
            await hold(page, ['ArrowRight']);
            await step(page, 60); // stops inside shaft A, whose car is level
            const s = await snapshot(page);
            expect(s.player.x).toBeGreaterThan(194);
            expect(s.player.x).toBeLessThan(266);
            expect(s.player.inShaft).toBe(-1);
        });

        test('every document sits on a floor some shaft serves', async ({ page }) => {
            const ok = await page.evaluate(() =>
                doors
                    .filter((d) => d.type === 'red')
                    .every((d) => SHAFTS.some((s) => d.floor >= s.top && d.floor <= s.bottom))
            );
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Elevators
    // -----------------------------------------------------------------------
    test.describe('riding the elevators', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearField(page);
        });

        test('pressing down on a level car boards it and drives it down', async ({ page }) => {
            await place(page, 0, 230); // shaft A's car is parked at floor 0
            await hold(page, ['ArrowDown']);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.player.inShaft).toBe(0);
            expect(s.player.crouching).toBe(false);
            expect(s.elevators[0].y).toBeGreaterThan(90);
            expect(s.player.y).toBe(s.elevators[0].y);
        });

        test('pressing up on a level car drives it up', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(4);
            });
            await place(page, 4, 230);
            await hold(page, ['ArrowUp']);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.player.inShaft).toBe(0);
            expect(s.elevators[0].y).toBeLessThan(450);
        });

        test('a car that is not level cannot be boarded from the floor', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(3);
            });
            await place(page, 0, 230);
            await hold(page, ['ArrowDown']);
            await step(page, 60);
            const s = await snapshot(page);
            expect(s.player.inShaft).toBe(-1);
            expect(s.player.crouching).toBe(true);
            expect(s.elevators[0].y).toBe(await page.evaluate(() => floorY(3)));
        });

        test('holding down drives the car down and the agent rides it', async ({ page }) => {
            await board(page, 0, 90);
            await hold(page, ['ArrowDown']);
            await step(page, 120); // one second
            const s = await snapshot(page);
            expect(s.elevators[0].y).toBeGreaterThan(150);
            expect(s.elevators[0].y).toBeLessThan(175);
            expect(s.player.y).toBe(s.elevators[0].y);
            expect(s.player.inShaft).toBe(0);
        });

        test('holding up drives the car up', async ({ page }) => {
            await board(page, 0, 360);
            await hold(page, ['ArrowUp']);
            await step(page, 120);
            const s = await snapshot(page);
            expect(s.elevators[0].y).toBeLessThan(300);
            expect(s.player.y).toBe(s.elevators[0].y);
        });

        test('a car stops at the limits of its own shaft', async ({ page }) => {
            await board(page, 0, 90);
            await hold(page, ['ArrowDown']);
            await step(page, 1200); // ten seconds, far past the bottom
            let s = await snapshot(page);
            expect(s.elevators[0].y).toBe(await page.evaluate(() => floorY(SHAFTS[0].bottom)));

            await hold(page, ['ArrowUp']);
            await step(page, 1200);
            s = await snapshot(page);
            expect(s.elevators[0].y).toBe(await page.evaluate(() => floorY(SHAFTS[0].top)));
        });

        test('the agent can step off when the car is level with a floor', async ({ page }) => {
            const carY = await page.evaluate(() => floorY(4));
            await board(page, 0, carY);
            await hold(page, ['ArrowRight']);
            await step(page, 60);
            const s = await snapshot(page);
            expect(s.player.inShaft).toBe(-1);
            expect(s.player.floor).toBe(4);
            expect(s.player.y).toBe(carY);
        });

        test('the agent cannot step off between floors', async ({ page }) => {
            const carY = await page.evaluate(() => floorY(1) + 45);
            await board(page, 0, carY);
            await hold(page, ['ArrowRight']);
            await step(page, 120);
            const s = await snapshot(page);
            expect(s.player.inShaft).toBe(0);
            expect(s.player.x).toBeLessThanOrEqual(230 + 36);
        });

        test('a car released near a floor snaps level with it', async ({ page }) => {
            const target = await page.evaluate(() => floorY(2));
            await board(page, 0, target + 3);
            await releaseAll(page);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.elevators[0].y).toBe(target);
            expect(s.player.y).toBe(target);
        });

        test('the shafts chain together to reach the bottom floor', async ({ page }) => {
            const reach = await page.evaluate(() => {
                let lowest = 0;
                for (const s of SHAFTS) {
                    if (s.top <= lowest) lowest = Math.max(lowest, s.bottom);
                }
                return lowest;
            });
            expect(reach).toBe(9);
        });
    });

    // -----------------------------------------------------------------------
    // Crouching
    // -----------------------------------------------------------------------
    test.describe('crouching', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearField(page);
        });

        test('holding down on a floor crouches instead of moving', async ({ page }) => {
            await place(page, 2, 400);
            await hold(page, ['ArrowDown', 'ArrowRight']);
            await step(page, 60);
            const s = await snapshot(page);
            expect(s.player.crouching).toBe(true);
            expect(s.player.x).toBe(400);
        });

        test('a crouching agent ducks under an enemy bullet', async ({ page }) => {
            await place(page, 2, 400);
            await hold(page, ['ArrowDown']);
            await page.evaluate(() => {
                bullets.push({ x: 600, y: floorY(2) - 26, vx: -300, from: 'enemy' });
            });
            await step(page, 120);
            const s = await snapshot(page);
            expect(s.lives).toBe(3);
            expect(s.player.floor).toBe(2);
        });

        test('a standing agent is hit by the same bullet', async ({ page }) => {
            await place(page, 2, 400);
            await releaseAll(page);
            await page.evaluate(() => {
                bullets.push({ x: 600, y: floorY(2) - 26, vx: -300, from: 'enemy' });
            });
            await step(page, 120);
            const s = await snapshot(page);
            expect(s.lives).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearField(page);
        });

        test('Space fires a bullet in the direction the agent faces', async ({ page }) => {
            await place(page, 3, 400, { facing: 1 });
            await hold(page, ['Space']);
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.bullets).toHaveLength(1);
            expect(s.bullets[0].from).toBe('player');
            expect(s.bullets[0].vx).toBeGreaterThan(0);
            expect(s.bullets[0].y).toBeLessThan(s.player.y);
        });

        test('facing left fires left', async ({ page }) => {
            await place(page, 3, 400, { facing: -1 });
            await hold(page, ['Space']);
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.bullets[0].vx).toBeLessThan(0);
        });

        test('no more than three of the agent bullets are in the air', async ({ page }) => {
            await place(page, 3, 60, { facing: 1 });
            await hold(page, ['Space']);
            await step(page, 60);
            const s = await snapshot(page);
            expect(s.bullets.filter((b) => b.from === 'player').length).toBeLessThanOrEqual(3);
        });

        test('bullets expire at the walls', async ({ page }) => {
            await place(page, 3, 800, { facing: 1 });
            await hold(page, ['Space']);
            await step(page, 1);
            await releaseAll(page);
            await step(page, 120);
            const s = await snapshot(page);
            expect(s.bullets).toHaveLength(0);
        });

        test('an agent bullet kills an enemy and scores', async ({ page }) => {
            await place(page, 3, 200, { facing: 1 });
            await page.evaluate(() => {
                enemies.push({ x: 400, y: floorY(3), floor: 3, dir: -1, shootCd: 1e6 });
            });
            await hold(page, ['Space']);
            await step(page, 1);
            await releaseAll(page);
            await step(page, 80);
            const s = await snapshot(page);
            expect(s.enemies).toHaveLength(0);
            expect(s.score).toBe(300);
            expect(s.lives).toBe(3);
        });

        test('a bullet on another floor misses', async ({ page }) => {
            await place(page, 3, 200, { facing: 1 });
            await page.evaluate(() => {
                enemies.push({ x: 400, y: floorY(5), floor: 5, dir: -1, shootCd: 1e6 });
            });
            await hold(page, ['Space']);
            await step(page, 1);
            await releaseAll(page);
            await step(page, 80);
            const s = await snapshot(page);
            expect(s.enemies).toHaveLength(1);
            expect(s.score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemy agents', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearField(page);
        });

        test('an enemy on the same floor walks toward the agent', async ({ page }) => {
            await place(page, 4, 200);
            await page.evaluate(() => {
                enemies.push({ x: 600, y: floorY(4), floor: 4, dir: 1, shootCd: 1e6 });
            });
            await releaseAll(page);
            await step(page, 120);
            const s = await snapshot(page);
            expect(s.enemies[0].x).toBeLessThan(600);
            expect(s.enemies[0].dir).toBe(-1);
        });

        test('an enemy shoots along its own floor', async ({ page }) => {
            await place(page, 4, 200);
            await page.evaluate(() => {
                enemies.push({ x: 500, y: floorY(4), floor: 4, dir: -1, shootCd: 0 });
            });
            await releaseAll(page);
            await step(page, 1);
            const s = await snapshot(page);
            const shots = s.bullets.filter((b) => b.from === 'enemy');
            expect(shots).toHaveLength(1);
            expect(shots[0].vx).toBeLessThan(0);
        });

        test('touching an enemy costs a life and restarts at the top', async ({ page }) => {
            await place(page, 5, 300);
            await page.evaluate(() => {
                enemies.push({ x: 308, y: floorY(5), floor: 5, dir: -1, shootCd: 1e6 });
            });
            await releaseAll(page);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.lives).toBe(2);
            expect(s.player.floor).toBe(0);
            expect(s.enemies).toHaveLength(0);
            expect(s.state).toBe('running');
        });

        test('a car crushes an agent caught in the shaft', async ({ page }) => {
            const carY = await page.evaluate(() => floorY(2));
            await board(page, 0, carY);
            await page.evaluate(() => {
                enemies.push({ x: 230, y: floorY(2), floor: 2, dir: 1, shootCd: 1e6 });
            });
            await hold(page, ['ArrowDown']);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.enemies).toHaveLength(0);
            expect(s.lives).toBe(3);
            expect(s.score).toBe(300);
        });

        test('a car standing still is no shelter', async ({ page }) => {
            const carY = await page.evaluate(() => floorY(2));
            await board(page, 0, carY);
            await page.evaluate(() => {
                enemies.push({ x: 230, y: floorY(2), floor: 2, dir: 1, shootCd: 1e6 });
            });
            await releaseAll(page);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.lives).toBe(2);
            expect(s.score).toBe(0);
        });

        test('enemies spawn from blue doors over time', async ({ page }) => {
            await place(page, 4, 400);
            await page.evaluate(() => {
                spawnTimer = 0;
            });
            await releaseAll(page);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.enemies.length).toBeGreaterThan(0);
            const floors = await page.evaluate(() => enemies.map((e) => e.floor));
            expect(floors.every((f) => f >= 0 && f < 10)).toBe(true);
        });

        test('the field is capped at the level enemy limit', async ({ page }) => {
            await place(page, 4, 400);
            await page.evaluate(() => {
                spawnTimer = 0;
            });
            await releaseAll(page);
            await step(page, 1200);
            const s = await snapshot(page);
            const cap = await page.evaluate(() => maxEnemies());
            expect(s.enemies.length).toBeLessThanOrEqual(cap);
        });
    });

    // -----------------------------------------------------------------------
    // Documents
    // -----------------------------------------------------------------------
    test.describe('collecting documents', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearField(page);
        });

        test('holding up at a red door takes the document', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'red');
                return { floor: d.floor, x: d.x };
            });
            await place(page, door.floor, door.x);
            await hold(page, ['ArrowUp']);
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.docs).toBe(1);
            expect(s.score).toBe(500);
            await expect(page.locator('#docs')).toHaveText('1/6');
        });

        test('a document is only ever collected once', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'red');
                return { floor: d.floor, x: d.x };
            });
            await place(page, door.floor, door.x);
            await hold(page, ['ArrowUp']);
            await step(page, 120);
            const s = await snapshot(page);
            expect(s.docs).toBe(1);
            expect(s.score).toBe(500);
        });

        test('a blue door holds nothing', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'blue');
                return { floor: d.floor, x: d.x };
            });
            await place(page, door.floor, door.x);
            await hold(page, ['ArrowUp']);
            await step(page, 60);
            const s = await snapshot(page);
            expect(s.docs).toBe(0);
            expect(s.score).toBe(0);
        });

        test('standing away from the door collects nothing', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'red');
                return { floor: d.floor, x: d.x };
            });
            await place(page, door.floor, door.x + 90);
            await hold(page, ['ArrowUp']);
            await step(page, 60);
            const s = await snapshot(page);
            expect(s.docs).toBe(0);
        });

        test('documents survive losing a life', async ({ page }) => {
            const door = await page.evaluate(() => {
                const d = doors.find((x) => x.type === 'red');
                return { floor: d.floor, x: d.x };
            });
            await place(page, door.floor, door.x);
            await hold(page, ['ArrowUp']);
            await step(page, 1);
            await place(page, 5, 300);
            await page.evaluate(() => {
                enemies.push({ x: 305, y: floorY(5), floor: 5, dir: -1, shootCd: 1e6 });
            });
            await releaseAll(page);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.lives).toBe(2);
            expect(s.docs).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // The exit
    // -----------------------------------------------------------------------
    test.describe('the exit', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearField(page);
        });

        test('the exit is locked until every document is taken', async ({ page }) => {
            const exit = await page.evaluate(() => ({ ...EXIT }));
            await place(page, exit.floor, exit.x);
            await releaseAll(page);
            await step(page, 10);
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.docs).toBe(0);
        });

        test('reaching the exit with every document clears the level', async ({ page }) => {
            await page.evaluate(() => {
                doors.filter((d) => d.type === 'red').forEach((d) => (d.collected = true));
                docs = DOC_TOTAL;
            });
            const exit = await page.evaluate(() => ({ ...EXIT }));
            await place(page, exit.floor, exit.x);
            await releaseAll(page);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.state).toBe('levelclear');
            expect(s.score).toBeGreaterThanOrEqual(1000);
        });

        test('clearing a level shows the overlay', async ({ page }) => {
            await page.evaluate(() => {
                doors.filter((d) => d.type === 'red').forEach((d) => (d.collected = true));
                docs = DOC_TOTAL;
            });
            const exit = await page.evaluate(() => ({ ...EXIT }));
            await place(page, exit.floor, exit.x);
            await step(page, 2);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/clear/i);
        });
    });

    // -----------------------------------------------------------------------
    // Levels and run end
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('advancing from a cleared level rebuilds the building', async ({ page }) => {
            await startFrozen(page);
            await clearField(page);
            await page.evaluate(() => {
                doors.filter((d) => d.type === 'red').forEach((d) => (d.collected = true));
                docs = DOC_TOTAL;
                state = 'levelclear';
                advance();
            });
            const s = await snapshot(page);
            expect(s.level).toBe(2);
            expect(s.state).toBe('running');
            expect(s.docs).toBe(0);
            expect(s.player.floor).toBe(0);
            const anyCollected = await page.evaluate(() => doors.some((d) => d.collected));
            expect(anyCollected).toBe(false);
        });

        test('enemies get tougher each level', async ({ page }) => {
            const first = await page.evaluate(() => {
                startGame();
                return { cap: maxEnemies(), speed: enemySpeed() };
            });
            const later = await page.evaluate(() => {
                level = 3;
                return { cap: maxEnemies(), speed: enemySpeed() };
            });
            expect(later.cap).toBeGreaterThan(first.cap);
            expect(later.speed).toBeGreaterThan(first.speed);
        });

        test('clearing the last level wins the run', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                level = LEVEL_COUNT;
                state = 'levelclear';
                advance();
            });
            const s = await snapshot(page);
            expect(s.state).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/win/i);
        });

        test('running out of lives ends the run', async ({ page }) => {
            await startFrozen(page);
            await clearField(page);
            await page.evaluate(() => {
                lives = 1;
            });
            await place(page, 5, 300);
            await page.evaluate(() => {
                enemies.push({ x: 305, y: floorY(5), floor: 5, dir: -1, shootCd: 1e6 });
            });
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.state).toBe('gameover');
            expect(s.lives).toBe(0);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the best score is remembered', async ({ page }) => {
            await startFrozen(page);
            await clearField(page);
            await page.evaluate(() => {
                score = 4200;
                lives = 1;
            });
            await place(page, 5, 300);
            await page.evaluate(() => {
                enemies.push({ x: 305, y: floorY(5), floor: 5, dir: -1, shootCd: 1e6 });
            });
            await step(page, 2);
            await expect(page.locator('#best')).toHaveText('4200');
            const stored = await page.evaluate(() => window.localStorage.getItem('elevatoraction-best'));
            expect(Number(stored)).toBe(4200);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                state = 'gameover';
            });
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.lives).toBe(3);
            expect(s.score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pause and camera
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and unpauses', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('P does nothing on the start screen', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    test.describe('camera', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearField(page);
        });

        test('the view is pinned to the top of the building up high', async ({ page }) => {
            await place(page, 0, 300);
            await step(page, 1);
            expect((await snapshot(page)).camY).toBe(0);
        });

        test('the view is pinned to the bottom of the building down low', async ({ page }) => {
            await place(page, 9, 300);
            await step(page, 1);
            const camY = (await snapshot(page)).camY;
            expect(camY).toBe(await page.evaluate(() => BUILDING_H - H));
            // The street the agent is standing on has to be on screen.
            const groundOnScreen = await page.evaluate(
                () => floorY(FLOORS - 1) + SLAB_H - cam.y <= H
            );
            expect(groundOnScreen).toBe(true);
        });

        test('the view follows the agent in between', async ({ page }) => {
            await place(page, 5, 300);
            await step(page, 1);
            const camY = (await snapshot(page)).camY;
            expect(camY).toBeGreaterThan(0);
            expect(camY).toBeLessThan(await page.evaluate(() => BUILDING_H - H));
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas draws the building', async ({ page }) => {
            await startFrozen(page);
            await step(page, 1);
            const colors = await page.evaluate(() => {
                draw();
                const data = ctx.getImageData(0, 0, W, H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4 * 97) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(colors).toBeGreaterThan(3);
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
            expect(['Action', 'Puzzle', 'Strategy', 'Board Game', 'Card Game', 'Sports'])
                .toContain(entry.category);
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
