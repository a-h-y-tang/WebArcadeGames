const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const fs = require('fs');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Nearly every spec is about one entity at a time, so the patrolling agents are
// cleared out of the way and the agent-respawn timer is pushed out of reach; the
// agent specs place exactly the agents they care about. Switching `autoStep` off
// stops the requestAnimationFrame loop from advancing the simulation behind the
// spec's back, leaving time entirely under the spec's control.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        agents.length = 0;
        spawnTimer = 1e9;
        autoStep = false;
    });

// Chromium can acknowledge a synthetic key event before the page listener has
// run, so key presses are confirmed against the game's key state before the
// simulation is advanced.
const hold = async (page, key, flag) => {
    await page.keyboard.down(key);
    await page.waitForFunction((f) => keys[f], flag);
};

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

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas matches the building size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
            expect(await page.evaluate(() => [CANVAS_W, CANVAS_H])).toEqual([720, 480]);
        });

        test('the building has six floors seventy pixels apart', async ({ page }) => {
            expect(await page.evaluate(() => [FLOORS, FLOOR_H, TOP_MARGIN])).toEqual([6, 70, 50]);
            expect(await page.evaluate(() => [floorY(0), floorY(5)])).toEqual([50, 400]);
        });

        test('two shafts split every floor into three segments', async ({ page }) => {
            expect(await page.evaluate(() => SHAFT_XS)).toEqual([250, 470]);
            expect(await page.evaluate(() => SHAFT_W)).toBe(56);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('HUD shows how many documents the level needs', async ({ page }) => {
            await expect(page.locator('#docs')).toHaveText('0 / 3');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '7400'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7400');
        });

        test('no agents or bullets before starting', async ({ page }) => {
            expect(await page.evaluate(() => [agents.length, bullets.length])).toEqual([0, 0]);
        });

        test('step() does nothing while idle', async ({ page }) => {
            const before = await page.evaluate(() => player.x);
            await page.evaluate(() => { keys.right = true; });
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.click('#btn-start');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the spy starts on the roof, walking, facing right', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => [player.floor, player.ride, player.dir])).toEqual([0, -1, 1]);
        });

        test('the level loads its doors, three of them red', async ({ page }) => {
            await startQuiet(page);
            const counts = await page.evaluate(() => [doors.length, doors.filter((d) => d.red).length, docsRequired]);
            expect(counts[0]).toBeGreaterThan(8);
            expect(counts[1]).toBe(3);
            expect(counts[2]).toBe(3);
        });

        test('every door sits inside a walkable segment', async ({ page }) => {
            await startQuiet(page);
            const bad = await page.evaluate(() =>
                doors.filter((d) =>
                    SHAFT_XS.some((sx) => Math.abs(d.x - sx) < SHAFT_W / 2 + DOOR_W / 2) ||
                    d.x - DOOR_W / 2 < WALL ||
                    d.x + DOOR_W / 2 > CANVAS_W - WALL));
            expect(bad).toEqual([]);
        });

        test('every floor plan is well formed', async ({ page }) => {
            await startQuiet(page);
            const problems = await page.evaluate(() => {
                const bad = [];
                LAYOUTS.forEach((layout, i) => {
                    if (!layout.doors.some(([, , red]) => red)) bad.push(`layout ${i} has no documents`);
                    layout.doors.concat(layout.agents).forEach(([floor, x]) => {
                        if (floor < 0 || floor >= FLOORS) bad.push(`layout ${i}: floor ${floor}`);
                        if (SHAFT_XS.some((sx) => Math.abs(x - sx) < SHAFT_W / 2 + DOOR_W / 2)) {
                            bad.push(`layout ${i}: x ${x} on floor ${floor} overlaps a shaft`);
                        }
                        if (x - DOOR_W / 2 < WALL || x + DOOR_W / 2 > CANVAS_W - WALL) {
                            bad.push(`layout ${i}: x ${x} on floor ${floor} is inside a wall`);
                        }
                    });
                    // Nothing may sit on top of the escape door.
                    layout.doors.forEach(([floor, x]) => {
                        if (floor === FLOORS - 1 && x - DOOR_W / 2 <= EXIT_X) {
                            bad.push(`layout ${i}: door at ${x} blocks the exit`);
                        }
                    });
                });
                return bad;
            });
            expect(problems).toEqual([]);
        });

        test('one car waits on the roof so the spy can move', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => carFloor(cars[0]))).toBe(0);
        });

        test('restarting after game over resets score, lives and documents', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 900;
                lives = 0;
                docsCollected = 2;
                state = 'over';
                startGame();
            });
            expect(await page.evaluate(() => [score, lives, docsCollected, level])).toEqual([0, 3, 0, 1]);
        });
    });

    // -----------------------------------------------------------------------
    // Walking
    // -----------------------------------------------------------------------
    test.describe('walking', () => {
        test('holding right walks the spy right', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => player.x);
            await hold(page, 'ArrowRight', 'right');
            await advance(page, 30);
            const after = await page.evaluate(() => player.x);
            expect(after).toBeCloseTo(before + PLAYER_HALF_SECOND, 1);
        });

        test('holding left walks the spy left and turns them around', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => player.x);
            await hold(page, 'ArrowLeft', 'left');
            await advance(page, 30);
            expect(await page.evaluate(() => player.x)).toBeLessThan(before);
            expect(await page.evaluate(() => player.dir)).toBe(-1);
        });

        test('A and D walk as well as the arrow keys', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'd', 'right');
            await advance(page, 10);
            expect(await page.evaluate(() => player.dir)).toBe(1);
            await page.keyboard.up('d');
            await hold(page, 'a', 'left');
            await advance(page, 10);
            expect(await page.evaluate(() => player.dir)).toBe(-1);
        });

        test('the outer wall stops the spy', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'ArrowLeft', 'left');
            await advance(page, 300);
            expect(await page.evaluate(() => player.x)).toBe(WALL_STOP_LEFT);
        });

        test('an empty shaft is solid', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.floor = 1;
                player.x = 120;
                cars[0].y = floorY(4);
                cars[0].target = 4;
            });
            await hold(page, 'ArrowRight', 'right');
            await advance(page, 300);
            expect(await page.evaluate(() => player.x)).toBe(SHAFT_STOP_LEFT);
            expect(await page.evaluate(() => player.ride)).toBe(-1);
        });

        test('releasing the keys stops the spy', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'ArrowRight', 'right');
            await advance(page, 10);
            await page.keyboard.up('ArrowRight');
            await page.waitForFunction(() => !keys.right);
            const stopped = await page.evaluate(() => player.x);
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(stopped);
        });
    });

    // -----------------------------------------------------------------------
    // Elevators
    // -----------------------------------------------------------------------
    test.describe('elevators', () => {
        test('walking into a levelled car boards it', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'ArrowRight', 'right');
            await advance(page, 300);
            expect(await page.evaluate(() => player.ride)).toBe(0);
            expect(await page.evaluate(() => player.x)).toBe(250);
        });

        test('pressing down sends the car to the next floor down', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.ride = 0; player.x = 250; player.floor = 0; });
            await hold(page, 'ArrowDown', 'down');
            await advance(page, 30);
            expect(await page.evaluate(() => cars[0].target)).toBe(1);
            expect(await page.evaluate(() => cars[0].y)).toBeCloseTo(85, 0);
            await advance(page, 30);
            expect(await page.evaluate(() => cars[0].y)).toBe(120);
            expect(await page.evaluate(() => player.floor)).toBe(1);
        });

        test('a rider between floors has no floor', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.ride = 0; player.x = 250; });
            await hold(page, 'ArrowDown', 'down');
            await advance(page, 20);
            expect(await page.evaluate(() => player.floor)).toBe(-1);
        });

        test('the rider moves with the car', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.ride = 0; player.x = 250; });
            await hold(page, 'ArrowDown', 'down');
            await advance(page, 60);
            expect(await page.evaluate(() => player.y)).toBe(await page.evaluate(() => cars[0].y - PLAYER_H));
        });

        test('a car in transit ignores further input', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.ride = 0; player.x = 250; });
            await hold(page, 'ArrowDown', 'down');
            await advance(page, 20);
            await page.keyboard.up('ArrowDown');
            await hold(page, 'ArrowUp', 'up');
            await advance(page, 5);
            expect(await page.evaluate(() => cars[0].target)).toBe(1);
        });

        test('the car cannot climb above the roof', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.ride = 0; player.x = 250; });
            await hold(page, 'ArrowUp', 'up');
            await advance(page, 120);
            expect(await page.evaluate(() => cars[0].target)).toBe(0);
            expect(await page.evaluate(() => cars[0].y)).toBe(50);
        });

        test('the car cannot sink below the ground floor', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                cars[0].y = floorY(FLOORS - 1);
                cars[0].target = FLOORS - 1;
                player.ride = 0;
                player.x = 250;
            });
            await hold(page, 'ArrowDown', 'down');
            await advance(page, 120);
            expect(await page.evaluate(() => cars[0].y)).toBe(400);
        });

        test('pressing left steps off a levelled car to the left', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.ride = 0; player.x = 250; });
            await hold(page, 'ArrowLeft', 'left');
            // One frame: the spy steps off, and keeps walking from there.
            await advance(page, 1);
            expect(await page.evaluate(() => player.ride)).toBe(-1);
            expect(await page.evaluate(() => player.floor)).toBe(0);
            expect(await page.evaluate(() => player.x)).toBe(SHAFT_STEP_OFF_LEFT);
        });

        test('pressing right steps off a levelled car to the right', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.ride = 0; player.x = 250; });
            await hold(page, 'ArrowRight', 'right');
            // One frame: the spy steps off, and keeps walking from there.
            await advance(page, 1);
            expect(await page.evaluate(() => player.ride)).toBe(-1);
            expect(await page.evaluate(() => player.x)).toBe(SHAFT_STEP_OFF_RIGHT);
        });

        test('you cannot step off a car in transit', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.ride = 0; player.x = 250; });
            await hold(page, 'ArrowDown', 'down');
            await advance(page, 20);
            await page.keyboard.up('ArrowDown');
            await hold(page, 'ArrowLeft', 'left');
            await advance(page, 5);
            expect(await page.evaluate(() => player.ride)).toBe(0);
        });

        test('the second shaft works the same way', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.floor = carFloor(cars[1]);
                player.ride = -1;
                player.x = 400;
            });
            await hold(page, 'ArrowRight', 'right');
            await advance(page, 300);
            expect(await page.evaluate(() => player.ride)).toBe(1);
            expect(await page.evaluate(() => player.x)).toBe(470);
        });
    });

    // -----------------------------------------------------------------------
    // Documents
    // -----------------------------------------------------------------------
    test.describe('documents', () => {
        const standOnRedDoor = (page) =>
            page.evaluate(() => {
                const d = doors.find((x) => x.red && !x.collected);
                player.ride = -1;
                player.floor = d.floor;
                player.x = d.x;
                return d.floor;
            });

        test('walking onto a red door collects the document', async ({ page }) => {
            await startQuiet(page);
            await standOnRedDoor(page);
            await advance(page, 1);
            expect(await page.evaluate(() => docsCollected)).toBe(1);
        });

        test('collecting a document scores 100', async ({ page }) => {
            await startQuiet(page);
            await standOnRedDoor(page);
            await advance(page, 1);
            expect(await page.evaluate(() => score)).toBe(100);
        });

        test('a collected door cannot be collected twice', async ({ page }) => {
            await startQuiet(page);
            await standOnRedDoor(page);
            await advance(page, 60);
            expect(await page.evaluate(() => docsCollected)).toBe(1);
        });

        test('the HUD counts documents', async ({ page }) => {
            await startQuiet(page);
            await standOnRedDoor(page);
            await advance(page, 1);
            await expect(page.locator('#docs')).toHaveText('1 / 3');
        });

        test('plain doors hold nothing', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const d = doors.find((x) => !x.red);
                player.ride = -1;
                player.floor = d.floor;
                player.x = d.x;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => docsCollected)).toBe(0);
        });

        test('a rider between floors collects nothing', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const d = doors.find((x) => x.red);
                player.ride = 0;
                player.floor = -1;
                player.x = d.x;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => docsCollected)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('Space fires a bullet in the direction faced', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('Space');
            const b = await page.evaluate(() => bullets.map((x) => ({ dir: x.dir, from: x.from, floor: x.floor })));
            expect(b).toEqual([{ dir: 1, from: 'player', floor: 0 }]);
        });

        test('the cooldown limits the rate of fire', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { shoot(); shoot(); shoot(); });
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('the gun is ready again after the cooldown', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => shoot());
            await advance(page, 30);
            await page.evaluate(() => { bullets.length = 0; shoot(); });
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('bullets travel along their floor', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.x = 100; shoot(); });
            await advance(page, 6);
            expect(await page.evaluate(() => bullets[0].x)).toBeCloseTo(100 + 33, 0);
        });

        test('bullets are removed at the wall', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.x = 100; shoot(); });
            await advance(page, 300);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a bullet kills an agent on the same floor', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 60;
                player.floor = 0;
                agents.push(makeAgent(0, 200, -1));
                shoot();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => agents.length)).toBe(0);
        });

        test('killing an agent scores 200', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 60;
                player.floor = 0;
                agents.push(makeAgent(0, 200, -1));
                shoot();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => score)).toBe(200);
        });

        test('a bullet misses an agent on another floor', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 60;
                player.floor = 0;
                agents.push(makeAgent(2, 200, -1));
                shoot();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => agents.length)).toBe(1);
        });

        test('the bullet is spent on the agent it kills', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 60;
                player.floor = 0;
                agents.push(makeAgent(0, 150, -1), makeAgent(0, 200, -1));
                shoot();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => agents.length)).toBe(1);
        });

        test('a rider cannot shoot', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.ride = 0; player.floor = -1; shoot(); });
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Agents
    // -----------------------------------------------------------------------
    test.describe('agents', () => {
        test('an agent on the spy\'s floor closes in', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 60;
                player.floor = 0;
                agents.push(makeAgent(0, 200, 1));
            });
            await advance(page, 30);
            expect(await page.evaluate(() => agents[0].dir)).toBe(-1);
            expect(await page.evaluate(() => agents[0].x)).toBeLessThan(200);
        });

        test('an agent patrols and turns at the wall', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.floor = 5; agents.push(makeAgent(2, 60, -1)); });
            await advance(page, 120);
            expect(await page.evaluate(() => agents[0].dir)).toBe(1);
        });

        test('an agent turns at an empty shaft', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.floor = 5;
                cars[0].y = floorY(4);
                cars[0].target = 4;
                agents.push(makeAgent(2, 120, 1));
            });
            await advance(page, 180);
            expect(await page.evaluate(() => agents[0].dir)).toBe(-1);
            expect(await page.evaluate(() => agents[0].x)).toBeLessThan(222);
        });

        test('an agent fires at the spy', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 60;
                player.floor = 0;
                player.invuln = 99;
                agents.push(makeAgent(0, 200, -1));
            });
            // An agent bullet reaches the wall and vanishes within a second, so the
            // spec watches every frame instead of sampling one moment in time.
            const fired = await page.evaluate(() => {
                for (let i = 0; i < 300; i++) {
                    step(1 / 60);
                    if (bullets.some((b) => b.from === 'agent')) return true;
                }
                return false;
            });
            expect(fired).toBe(true);
        });

        test('an agent holds fire when the spy is elsewhere', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.floor = 5; agents.push(makeAgent(2, 200, -1)); });
            const fired = await page.evaluate(() => {
                for (let i = 0; i < 300; i++) {
                    step(1 / 60);
                    if (bullets.length) return true;
                }
                return false;
            });
            expect(fired).toBe(false);
        });

        test('agents step out of plain doors over time', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { setSeed(7); spawnTimer = 0.1; player.floor = -1; });
            // A fresh agent starts walking straight away, so the door it came out
            // of is checked on the frame it appears.
            const spawnedAtDoor = await page.evaluate(() => {
                for (let i = 0; i < 60; i++) {
                    step(1 / 60);
                    if (agents.length) {
                        return doors.some((d) => !d.red && d.floor === agents[0].floor && Math.abs(d.x - agents[0].x) < 1);
                    }
                }
                return false;
            });
            expect(spawnedAtDoor).toBe(true);
            expect(await page.evaluate(() => agents.length)).toBe(1);
        });

        test('the agent population is capped', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { setSeed(3); player.floor = -1; });
            await advance(page, 60 * 120);
            expect(await page.evaluate(() => agents.length)).toBeLessThanOrEqual(await page.evaluate(() => maxAgents()));
        });
    });

    // -----------------------------------------------------------------------
    // Getting hit
    // -----------------------------------------------------------------------
    test.describe('getting hit', () => {
        const shootAtPlayer = (page) =>
            page.evaluate(() => {
                player.x = 300;
                player.floor = 2;
                player.ride = -1;
                player.invuln = 0;
                bullets.push({ x: 360, floor: 2, dir: -1, from: 'agent' });
            });

        test('an agent bullet costs a life', async ({ page }) => {
            await startQuiet(page);
            await shootAtPlayer(page);
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('being hit sends the spy back to the roof', async ({ page }) => {
            await startQuiet(page);
            await shootAtPlayer(page);
            await advance(page, 60);
            expect(await page.evaluate(() => [player.floor, player.ride])).toEqual([0, -1]);
        });

        test('being hit clears the air of bullets', async ({ page }) => {
            await startQuiet(page);
            await shootAtPlayer(page);
            await advance(page, 60);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a death clears bullets that were still to be stepped this frame', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 300;
                player.floor = 2;
                player.ride = -1;
                player.invuln = 0;
                // The hit is resolved first; the trailing bullets are later in the
                // same array and must not survive the wipe.
                bullets.push({ x: 303, floor: 2, dir: -1, from: 'agent' });
                bullets.push({ x: 600, floor: 2, dir: -1, from: 'agent' });
                bullets.push({ x: 650, floor: 4, dir: 1, from: 'agent' });
            });
            await advance(page, 1);
            expect(await page.evaluate(() => [lives, bullets.length])).toEqual([2, 0]);
        });

        test('the spy is briefly invulnerable after being hit', async ({ page }) => {
            await startQuiet(page);
            await shootAtPlayer(page);
            await advance(page, 60);
            expect(await page.evaluate(() => player.invuln)).toBeGreaterThan(0);
            await page.evaluate(() => {
                bullets.push({ x: player.x + 4, floor: player.floor, dir: -1, from: 'agent' });
            });
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('touching an agent costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 300;
                player.floor = 2;
                player.invuln = 0;
                agents.push(makeAgent(2, 305, -1));
            });
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the roof car is recalled so a respawn is never stranded', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                cars[0].y = floorY(4);
                cars[0].target = 4;
            });
            await shootAtPlayer(page);
            await advance(page, 60);
            expect(await page.evaluate(() => carFloor(cars[0]))).toBe(0);
        });

        test('documents already collected survive a death', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { docsCollected = 2; });
            await shootAtPlayer(page);
            await advance(page, 60);
            expect(await page.evaluate(() => docsCollected)).toBe(2);
        });

        test('the spy\'s own bullets are harmless', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 300;
                player.floor = 2;
                player.invuln = 0;
                bullets.push({ x: 360, floor: 2, dir: -1, from: 'player' });
            });
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('the last life ends the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { lives = 1; });
            await shootAtPlayer(page);
            await advance(page, 60);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the best score is stored after a run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { lives = 1; score = 1234; });
            await shootAtPlayer(page);
            await advance(page, 60);
            expect(await page.evaluate(() => window.localStorage.getItem('elevatoraction-best'))).toBe('1234');
            await expect(page.locator('#best')).toHaveText('1234');
        });
    });

    // -----------------------------------------------------------------------
    // Escaping
    // -----------------------------------------------------------------------
    test.describe('escaping', () => {
        const goToExit = (page) =>
            page.evaluate(() => {
                player.ride = -1;
                player.floor = FLOORS - 1;
                player.x = 40;
            });

        test('the exit does nothing while documents are missing', async ({ page }) => {
            await startQuiet(page);
            await goToExit(page);
            await advance(page, 30);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('escaping with every document clears the level', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { doors.forEach((d) => { if (d.red) d.collected = true; }); docsCollected = docsRequired; });
            await goToExit(page);
            await advance(page, 5);
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('clearing a level scores 1000', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { docsCollected = docsRequired; });
            await goToExit(page);
            await advance(page, 5);
            expect(await page.evaluate(() => score)).toBe(1000);
        });

        test('the next level starts fresh on the roof', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { docsCollected = docsRequired; });
            await goToExit(page);
            await advance(page, 5);
            expect(await page.evaluate(() => [player.floor, docsCollected, bullets.length])).toEqual([0, 0, 0]);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the next level has its own documents to find', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { docsCollected = docsRequired; });
            await goToExit(page);
            await advance(page, 5);
            expect(await page.evaluate(() => docsRequired)).toBe(await page.evaluate(() => doors.filter((d) => d.red).length));
            expect(await page.evaluate(() => docsRequired)).toBeGreaterThan(0);
        });

        test('later levels send out faster agents', async ({ page }) => {
            await startQuiet(page);
            const slow = await page.evaluate(() => agentSpeed());
            await page.evaluate(() => { level = 5; });
            expect(await page.evaluate(() => agentSpeed())).toBeGreaterThan(slow);
        });
    });

    // -----------------------------------------------------------------------
    // A whole level, start to finish
    // -----------------------------------------------------------------------
    test.describe('playthrough', () => {
        // Every document on level 1 sits in a different segment, so clearing the
        // level exercises both shafts and every step-off direction. Driving the
        // real key state through the real step loop proves the floor plan is
        // actually solvable rather than merely well formed.
        test('a scripted route collects all three documents and escapes', async ({ page }) => {
            await startQuiet(page);
            const result = await page.evaluate(() => {
                const press = (k) => {
                    keys.left = keys.right = keys.up = keys.down = false;
                    if (k) keys[k] = true;
                };
                // A key is always released between legs: boarding latches the key
                // that carried the spy in, exactly as it does for a human player.
                const run = (k, frames) => {
                    press(k);
                    for (let i = 0; i < frames; i++) step(1 / 60);
                    press(null);
                    step(1 / 60);   // one frame with the key released, as a real player gets
                };
                const rideDown = () => { run('down', 1); run(null, 70); };

                run('right', 60);           // roof: walk into the levelled car
                rideDown();                 // -> floor 1
                run('left', 60);            // step off left, walk over the red door at 100
                run('right', 75);           // back to the car
                rideDown();                 // -> floor 2
                run('right', 60);           // step off right, walk over the red door at 400
                run('left', 75);            // back to the car
                rideDown();                 // -> floor 3
                run('right', 90);           // step off right, cross to the second shaft
                run('right', 90);           // step off it right, walk over the red door at 660
                run('left', 110);           // back to the second shaft
                run('left', 130);           // step off left, back to the first shaft
                rideDown();                 // -> floor 4
                rideDown();                 // -> floor 5
                run('left', 90);            // step off left and walk into the exit

                return { level, score, docs: docsCollected, required: docsRequired, lives };
            });

            expect(result.level).toBe(2);
            expect(result.score).toBe(1300);        // three documents plus the level bonus
            expect(result.lives).toBe(3);           // no agents were in the building
            expect(result.docs).toBe(0);            // the next level starts empty-handed
            expect(result.required).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and shows the overlay', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('a paused game does not advance', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'ArrowRight', 'right');
            await page.keyboard.press('p');
            const x = await page.evaluate(() => player.x);
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(x);
        });

        test('P resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Space resumes a paused game rather than restarting it', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { score = 500; });
            await page.keyboard.press('p');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => [state, score])).toEqual(['playing', 500]);
        });
    });

    // -----------------------------------------------------------------------
    // Game browser integration
    // -----------------------------------------------------------------------
    test.describe('game browser integration', () => {
        const readGames = () =>
            JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8'));

        test('games.json lists Elevator Action', () => {
            const entry = readGames().find((g) => g.id === 'elevator-action');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Elevator Action');
            expect(entry.dir).toBe('ElevatorAction');
            expect(entry.path).toBe('games/ElevatorAction/index.html');
            expect(entry.thumbnail).toBe('games/ElevatorAction/screenshot.png');
            expect(entry.category).toBe('Action');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = readGames();
            const i = games.findIndex((g) => g.id === 'elevator-action');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorAction/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(
                /\|\s*Elevator Action\s*\|\s*\[ElevatorAction\/\]\(ElevatorAction\/\)\s*\|\s*(Complete|In Progress)\s*\|/);
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorAction/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorAction/DESIGN.md'))).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => draw());
            const blank = await page.evaluate(() => {
                const ctx = document.getElementById('canvas').getContext('2d');
                const d = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < d.length; i += 4) if (d[i] || d[i + 1] || d[i + 2]) return false;
                return true;
            });
            expect(blank).toBe(false);
        });

        test('drawing is safe in every state', async ({ page }) => {
            await page.evaluate(() => draw());
            await startQuiet(page);
            await page.evaluate(() => { agents.push(makeAgent(2, 200, 1)); shoot(); draw(); });
            await page.evaluate(() => { state = 'over'; draw(); });
            expect(await page.evaluate(() => true)).toBe(true);
        });
    });
});

// Geometry the specs assert against, derived the same way the game derives it:
// wall 20, player 18 wide, shaft 56 wide centred on 250.
const WALL = 20;
const PLAYER_W = 18;
const WALL_STOP_LEFT = WALL + PLAYER_W / 2;            // 29
const SHAFT_STOP_LEFT = 250 - 56 / 2 - PLAYER_W / 2;   // 213
const SHAFT_STEP_OFF_LEFT = 250 - 56 / 2 - PLAYER_W / 2 - 2;   // 211
const SHAFT_STEP_OFF_RIGHT = 250 + 56 / 2 + PLAYER_W / 2 + 2;  // 289
const PLAYER_HALF_SECOND = 120 * 0.5;                  // 60px at 120 px/s
