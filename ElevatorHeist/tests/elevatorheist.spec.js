const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Most specs are about one thing at a time, so the agents are cleared out of
// the way and the spawner is switched off; the agent specs place exactly the
// agents they care about. Switching `autoStep` off stops the
// requestAnimationFrame loop from advancing the simulation behind the spec's
// back, leaving time entirely under test control.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        enemies.length = 0;
        bullets.length = 0;
        autoStep = false;
        autoSpawn = false;
    });

// Chromium can acknowledge a synthetic key event before the page listener has
// run, so key presses are confirmed against the game's key state before the
// simulation is advanced.
const hold = async (page, key, flag) => {
    await page.keyboard.down(key);
    await page.waitForFunction((f) => keys[f], flag);
};

test.describe('Elevator Heist', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Elevator Heist', async ({ page }) => {
            await expect(page).toHaveTitle('Elevator Heist');
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
            await expect(canvas).toHaveAttribute('height', '540');
            expect(await page.evaluate(() => [CANVAS_W, CANVAS_H, FLOORS])).toEqual([720, 540, 6]);
        });

        test('floors are evenly spaced', async ({ page }) => {
            const gaps = await page.evaluate(() => {
                const out = [];
                for (let f = 1; f < FLOORS; f++) out.push(floorY(f) - floorY(f - 1));
                return out;
            });
            expect(gaps).toEqual(new Array(5).fill(await page.evaluate(() => FLOOR_H)));
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the starting score, documents, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#docs')).toHaveText('0/3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatorheist-best', '7400'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7400');
        });

        test('no agents or bullets before starting', async ({ page }) => {
            expect(await page.evaluate(() => [enemies.length, bullets.length])).toEqual([0, 0]);
        });

        test('step() does nothing while idle', async ({ page }) => {
            const before = await page.evaluate(() => [player.x, player.y, elevators[0].y]);
            await page.evaluate(() => {
                keys.right = true;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => [player.x, player.y, elevators[0].y])).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.waitForFunction(() => state === 'running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
        });

        test('the player starts on the top floor', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => player.y)).toBe(await page.evaluate(() => floorY(0)));
            expect(await page.evaluate(() => player.onElevator)).toBe(null);
        });

        test('the level lays out three documents', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() => ({
                total: docsTotal,
                collected: docsCollected,
                redDoors: doors.filter((d) => d.doc).length,
                doors: doors.length,
            }));
            expect(out.total).toBe(3);
            expect(out.collected).toBe(0);
            expect(out.redDoors).toBe(3);
            expect(out.doors).toBeGreaterThan(3);
        });

        test('no door sits inside a shaft gap', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => doors.filter((d) => gapAt(d.x) >= 0).length)).toBe(0);
        });

        test('each shaft has a car inside the building', async ({ page }) => {
            await startQuiet(page);
            const out = await page.evaluate(() =>
                elevators.map((c) => [c.shaft, c.y >= floorY(0) && c.y <= floorY(FLOORS - 1)]),
            );
            expect(out).toEqual([
                [0, true],
                [1, true],
            ]);
        });
    });

    // -----------------------------------------------------------------------
    // Running and crouching
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('right moves the player right', async ({ page }) => {
            const before = await page.evaluate(() => player.x);
            await hold(page, 'ArrowRight', 'right');
            await advance(page, 30);
            const after = await page.evaluate(() => player.x);
            expect(after).toBeGreaterThan(before);
            expect(await page.evaluate(() => player.dir)).toBe(1);
        });

        test('left moves the player left', async ({ page }) => {
            await page.evaluate(() => placePlayer(0, 200));
            await hold(page, 'ArrowLeft', 'left');
            await advance(page, 30);
            expect(await page.evaluate(() => player.x)).toBeLessThan(200);
            expect(await page.evaluate(() => player.dir)).toBe(-1);
        });

        test('the player cannot walk through the left wall', async ({ page }) => {
            await page.evaluate(() => {
                placePlayer(0, 60);
                keys.left = true;
            });
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => player.x)).toBeGreaterThanOrEqual(
                await page.evaluate(() => WALL_L + PLAYER_W / 2),
            );
        });

        test('the player cannot walk through the right wall', async ({ page }) => {
            await page.evaluate(() => {
                placePlayer(0, 600);
                keys.right = true;
            });
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => player.x)).toBeLessThanOrEqual(
                await page.evaluate(() => WALL_R - PLAYER_W / 2),
            );
        });

        test('down crouches while standing on a floor', async ({ page }) => {
            await hold(page, 'ArrowDown', 'down');
            await advance(page, 5);
            expect(await page.evaluate(() => player.crouch)).toBe(true);
            await page.keyboard.up('ArrowDown');
            await advance(page, 5);
            expect(await page.evaluate(() => player.crouch)).toBe(false);
        });

        test('a crouching player cannot run', async ({ page }) => {
            await page.evaluate(() => {
                placePlayer(0, 120);
                keys.down = true;
                keys.right = true;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(120);
        });
    });

    // -----------------------------------------------------------------------
    // Shafts and elevators
    // -----------------------------------------------------------------------
    test.describe('elevators', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('cars patrol downward and reverse at the bottom floor', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(FLOORS - 1) - 10;
                elevators[0].dir = 1;
            });
            await advance(page, 60 * 2);
            const car = await page.evaluate(() => ({ y: elevators[0].y, dir: elevators[0].dir }));
            expect(car.dir).toBe(-1);
            expect(car.y).toBeLessThanOrEqual(await page.evaluate(() => floorY(FLOORS - 1)));
        });

        test('cars reverse at the top floor', async ({ page }) => {
            await page.evaluate(() => {
                elevators[1].y = floorY(0) + 10;
                elevators[1].dir = -1;
            });
            await advance(page, 60 * 2);
            const car = await page.evaluate(() => ({ y: elevators[1].y, dir: elevators[1].dir }));
            expect(car.dir).toBe(1);
            expect(car.y).toBeGreaterThanOrEqual(await page.evaluate(() => floorY(0)));
        });

        test('an unserved shaft gap blocks the player', async ({ page }) => {
            await page.evaluate(() => {
                // Park both cars far away from the top floor.
                elevators.forEach((c) => {
                    c.y = floorY(FLOORS - 1);
                    c.dir = -1;
                });
                autoElevators = false;
                placePlayer(0, SHAFT_XS[0] - 70);
                keys.right = true;
            });
            await advance(page, 60 * 3);
            const out = await page.evaluate(() => ({ x: player.x, gap: gapAt(player.x), on: player.onElevator }));
            expect(out.gap).toBe(-1);
            expect(out.on).toBe(null);
            expect(out.x).toBeCloseTo(await page.evaluate(() => SHAFT_XS[0] - SHAFT_W / 2), 1);
        });

        test('the player steps onto a car that is level with the floor', async ({ page }) => {
            await page.evaluate(() => {
                autoElevators = false;
                elevators[0].y = floorY(0);
                placePlayer(0, SHAFT_XS[0] - 40);
                keys.right = true;
            });
            await advance(page, 20); // far enough to enter the gap, not to cross it
            const out = await page.evaluate(() => ({
                on: player.onElevator === elevators[0],
                gap: gapAt(player.x),
                y: player.y,
                cy: elevators[0].y,
            }));
            expect(out.on).toBe(true);
            expect(out.gap).toBe(0);
            expect(out.y).toBe(out.cy);
        });

        test('a rider follows the car', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(1);
                rideForTest(0);
                keys.down = true;
            });
            await advance(page, 60);
            const out = await page.evaluate(() => ({ py: player.y, cy: elevators[0].y, f1: floorY(1) }));
            expect(out.py).toBe(out.cy);
            expect(out.py).toBeGreaterThan(out.f1);
        });

        test('a car with a passenger holds still until asked to move', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(2);
                elevators[0].dir = 1;
                rideForTest(0);
            });
            await advance(page, 60 * 2);
            const out = await page.evaluate(() => ({ cy: elevators[0].y, f2: floorY(2) }));
            expect(out.cy).toBe(out.f2);
        });

        test('an empty car resumes patrolling once the player steps off', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(3);
                rideForTest(0);
                keys.right = true;
            });
            await advance(page, 60 * 2);
            expect(await page.evaluate(() => player.onElevator)).toBe(null);
            const y = await page.evaluate(() => elevators[0].y);
            await advance(page, 60);
            expect(await page.evaluate(() => elevators[0].y)).not.toBe(y);
        });

        test('holding up drives the car upward', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(3);
                elevators[0].dir = 1;
                rideForTest(0);
                keys.up = true;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => elevators[0].dir)).toBe(-1);
            expect(await page.evaluate(() => elevators[0].y)).toBeLessThan(
                await page.evaluate(() => floorY(3)),
            );
        });

        test('holding down drives the car downward', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(2);
                elevators[0].dir = -1;
                rideForTest(0);
                keys.down = true;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => elevators[0].dir)).toBe(1);
            expect(await page.evaluate(() => elevators[0].y)).toBeGreaterThan(
                await page.evaluate(() => floorY(2)),
            );
        });

        test('a rider does not crouch', async ({ page }) => {
            await page.evaluate(() => {
                elevators[0].y = floorY(2);
                rideForTest(0);
                keys.down = true;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => player.crouch)).toBe(false);
        });

        test('the player cannot leave the car between floors', async ({ page }) => {
            await page.evaluate(() => {
                autoElevators = false;
                elevators[0].y = floorY(2) + FLOOR_H / 2;
                rideForTest(0);
                keys.right = true;
            });
            await advance(page, 60 * 2);
            const out = await page.evaluate(() => ({ gap: gapAt(player.x), on: player.onElevator !== null }));
            expect(out.gap).toBe(0);
            expect(out.on).toBe(true);
        });

        test('the player steps off onto a floor the car is level with', async ({ page }) => {
            await page.evaluate(() => {
                autoElevators = false;
                elevators[0].y = floorY(3);
                rideForTest(0);
                keys.right = true;
            });
            await advance(page, 60 * 2);
            const out = await page.evaluate(() => ({
                on: player.onElevator,
                y: player.y,
                f3: floorY(3),
                gap: gapAt(player.x),
            }));
            expect(out.on).toBe(null);
            expect(out.gap).toBe(-1);
            expect(out.y).toBe(out.f3);
        });
    });

    // -----------------------------------------------------------------------
    // Documents
    // -----------------------------------------------------------------------
    test.describe('documents', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('reaching a red door banks a document and scores', async ({ page }) => {
            const out = await page.evaluate(() => {
                const d = doors.find((x) => x.doc);
                placePlayer(d.floor, d.x);
                step(1 / 60);
                return { docs: docsCollected, score, open: d.open, collected: d.collected };
            });
            expect(out.docs).toBe(1);
            expect(out.score).toBe(await page.evaluate(() => DOC_POINTS));
            expect(out.open).toBe(true);
            expect(out.collected).toBe(true);
        });

        test('a door yields only one document', async ({ page }) => {
            const out = await page.evaluate(() => {
                const d = doors.find((x) => x.doc);
                placePlayer(d.floor, d.x);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { docs: docsCollected, score };
            });
            expect(out.docs).toBe(1);
            expect(out.score).toBe(await page.evaluate(() => DOC_POINTS));
        });

        test('plain doors hold nothing', async ({ page }) => {
            const out = await page.evaluate(() => {
                const d = doors.find((x) => !x.doc);
                placePlayer(d.floor, d.x);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { docs: docsCollected, score };
            });
            expect(out).toEqual({ docs: 0, score: 0 });
        });

        test('a document on another floor is out of reach', async ({ page }) => {
            const docs = await page.evaluate(() => {
                const d = doors.find((x) => x.doc);
                placePlayer(d.floor === 0 ? 1 : 0, d.x);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return docsCollected;
            });
            expect(docs).toBe(0);
        });

        test('the HUD tracks document progress', async ({ page }) => {
            await page.evaluate(() => {
                const d = doors.find((x) => x.doc);
                placePlayer(d.floor, d.x);
                step(1 / 60);
            });
            await expect(page.locator('#docs')).toHaveText('1/3');
        });
    });

    // -----------------------------------------------------------------------
    // The exit
    // -----------------------------------------------------------------------
    test.describe('the exit', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the exit is shut while documents are outstanding', async ({ page }) => {
            await page.evaluate(() => placePlayer(FLOORS - 1, EXIT_X));
            await advance(page, 60);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the exit on another floor does nothing', async ({ page }) => {
            await page.evaluate(() => {
                collectAllDocsForTest();
                placePlayer(FLOORS - 2, EXIT_X);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('all documents plus the exit clears the level', async ({ page }) => {
            const out = await page.evaluate(() => {
                collectAllDocsForTest();
                const before = score;
                placePlayer(FLOORS - 1, EXIT_X);
                step(1 / 60);
                return { state, gained: score - before };
            });
            expect(out.state).toBe('levelclear');
            expect(out.gained).toBe(await page.evaluate(() => LEVEL_BONUS));
        });

        test('the next level starts after the clear pause', async ({ page }) => {
            await page.evaluate(() => {
                collectAllDocsForTest();
                placePlayer(FLOORS - 1, EXIT_X);
                step(1 / 60);
            });
            await advance(page, 60 * 4);
            const out = await page.evaluate(() => ({
                state,
                level,
                docsCollected,
                docsTotal,
                y: player.y,
                top: floorY(0),
            }));
            expect(out.state).toBe('running');
            expect(out.level).toBe(2);
            expect(out.docsCollected).toBe(0);
            expect(out.docsTotal).toBe(3);
            expect(out.y).toBe(out.top);
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('shoot() fires in the direction the player faces', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(0, 200);
                player.dir = -1;
                shoot();
                return { n: bullets.length, vx: bullets[0].vx, from: bullets[0].from, y: bullets[0].y };
            });
            expect(out.n).toBe(1);
            expect(out.vx).toBe(await page.evaluate(() => -BULLET_SPEED));
            expect(out.from).toBe('player');
            expect(out.y).toBe(await page.evaluate(() => floorY(0) - 26));
        });

        test('Space fires while running', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.waitForFunction(() => bullets.length === 1);
        });

        test('a bullet travels and leaves the building', async ({ page }) => {
            await page.evaluate(() => {
                placePlayer(0, 200);
                player.dir = 1;
                shoot();
            });
            const x0 = await page.evaluate(() => bullets[0].x);
            await advance(page, 6);
            expect(await page.evaluate(() => bullets[0].x)).toBeGreaterThan(x0);
            await advance(page, 60 * 2);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('only a limited number of rounds are in flight', async ({ page }) => {
            const n = await page.evaluate(() => {
                for (let i = 0; i < 20; i++) {
                    shoot();
                    step(1 / 60);
                }
                return bullets.filter((b) => b.from === 'player').length;
            });
            expect(n).toBeLessThanOrEqual(await page.evaluate(() => MAX_PLAYER_BULLETS));
        });

        test('a bullet kills an agent and scores', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(2, 300);
                player.dir = 1;
                spawnEnemy(2, 380, -1);
                shoot();
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { enemies: enemies.length, score };
            });
            expect(out.enemies).toBe(0);
            expect(out.score).toBe(await page.evaluate(() => ENEMY_POINTS));
        });

        test('a bullet misses an agent on another floor', async ({ page }) => {
            const n = await page.evaluate(() => {
                placePlayer(2, 300);
                player.dir = 1;
                spawnEnemy(3, 380, -1);
                shoot();
                for (let i = 0; i < 60; i++) step(1 / 60);
                return enemies.length;
            });
            expect(n).toBe(1);
        });

        test('a crouched shot still hits a standing agent', async ({ page }) => {
            const n = await page.evaluate(() => {
                placePlayer(2, 300);
                player.dir = 1;
                player.crouch = true;
                keys.down = true;
                spawnEnemy(2, 380, -1);
                shoot();
                for (let i = 0; i < 60; i++) step(1 / 60);
                return enemies.length;
            });
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Agents
    // -----------------------------------------------------------------------
    test.describe('agents', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('spawnEnemy places an agent on a floor', async ({ page }) => {
            const out = await page.evaluate(() => {
                spawnEnemy(3, 350, 1);
                return { n: enemies.length, y: enemies[0].y, f3: floorY(3), x: enemies[0].x };
            });
            expect(out.n).toBe(1);
            expect(out.y).toBe(out.f3);
            expect(out.x).toBe(350);
        });

        test('an agent walks toward the player on its floor', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(3, 300);
                spawnEnemy(3, 400, 1);
                const before = enemies[0].x;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { before, after: enemies[0].x, dir: enemies[0].dir };
            });
            expect(out.after).toBeLessThan(out.before);
            expect(out.dir).toBe(-1);
        });

        test('an agent turns back at a wall', async ({ page }) => {
            const dir = await page.evaluate(() => {
                placePlayer(0, 400); // another floor, so the agent just patrols
                spawnEnemy(3, WALL_L + 30, -1);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return enemies[0].dir;
            });
            expect(dir).toBe(1);
        });

        test('an agent never crosses a shaft', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(0, 100); // another floor
                spawnEnemy(3, SHAFT_XS[0] - 40, 1);
                for (let i = 0; i < 60 * 6; i++) step(1 / 60);
                return { x: enemies[0].x, gap: gapAt(enemies[0].x), left: SHAFT_XS[0] - SHAFT_W / 2 };
            });
            expect(out.gap).toBe(-1);
            expect(out.x).toBeLessThanOrEqual(out.left);
        });

        test('an agent does not chase the player across a shaft', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(3, SHAFT_XS[0] + 80);
                spawnEnemy(3, SHAFT_XS[0] - 40, 1);
                enemies[0].cooldown = Infinity; // keep the spec about walking
                for (let i = 0; i < 60 * 4; i++) step(1 / 60);
                return { gap: gapAt(enemies[0].x), x: enemies[0].x, left: SHAFT_XS[0] - SHAFT_W / 2 };
            });
            expect(out.gap).toBe(-1);
            expect(out.x).toBeLessThanOrEqual(out.left);
        });

        test('an agent shoots at the player on its floor', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(3, 300);
                player.crouch = true; // survive the shot, just count it
                keys.down = true;
                spawnEnemy(3, 400, -1);
                for (let i = 0; i < 60 * 3; i++) step(1 / 60);
                return bullets.filter((b) => b.from === 'enemy').length + enemyShotsForTest;
            });
            expect(out).toBeGreaterThan(0);
        });

        test('an agent does not shoot at a player on another floor', async ({ page }) => {
            const n = await page.evaluate(() => {
                placePlayer(1, 300);
                spawnEnemy(3, 400, -1);
                for (let i = 0; i < 60 * 3; i++) step(1 / 60);
                return enemyShotsForTest;
            });
            expect(n).toBe(0);
        });

        test('an agent bullet kills the player', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(3, 300);
                spawnEnemy(3, 420, -1);
                for (let i = 0; i < 60 * 3 && state === 'running'; i++) step(1 / 60);
                return { state, lives };
            });
            expect(out.state).toBe('dying');
            expect(out.lives).toBe(2);
        });

        test('a crouching player is missed by agent gunfire', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(3, 300);
                player.crouch = true;
                keys.down = true;
                spawnEnemy(3, 460, -1);
                enemies[0].frozen = true; // stay out of contact range
                for (let i = 0; i < 60 * 4; i++) step(1 / 60);
                return { state, lives, shots: enemyShotsForTest };
            });
            expect(out.shots).toBeGreaterThan(0);
            expect(out.state).toBe('running');
            expect(out.lives).toBe(3);
        });

        test('touching an agent kills the player', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(3, 300);
                spawnEnemy(3, 304, -1);
                step(1 / 60);
                return { state, lives };
            });
            expect(out.state).toBe('dying');
            expect(out.lives).toBe(2);
        });

        test('the spawner produces agents over time, up to the cap', async ({ page }) => {
            // A death clears the floor, so the peak is what the cap applies to.
            const out = await page.evaluate(() => {
                autoSpawn = true;
                spawnTimer = 0;
                let peak = 0;
                for (let i = 0; i < 60 * 60; i++) {
                    step(1 / 60);
                    peak = Math.max(peak, enemies.length);
                }
                return { peak, cap: maxEnemies() };
            });
            expect(out.peak).toBeGreaterThan(0);
            expect(out.peak).toBeLessThanOrEqual(out.cap);
        });

        test('agents only come out of doors', async ({ page }) => {
            const out = await page.evaluate(() => {
                autoSpawn = true;
                spawnTimer = 0;
                const bad = [];
                for (let i = 0; i < 60 * 30; i++) {
                    step(1 / 60);
                    for (const e of enemies) {
                        if (e.age > 0) continue; // only judge them as they appear
                        if (!doors.some((d) => d.x === e.x && floorY(d.floor) === e.y)) bad.push([e.x, e.y]);
                    }
                }
                return bad;
            });
            expect(out).toEqual([]);
        });

        test('agents get faster on later levels', async ({ page }) => {
            const out = await page.evaluate(() => {
                const a = enemySpeed();
                level = 4;
                const b = enemySpeed();
                return [a, b];
            });
            expect(out[1]).toBeGreaterThan(out[0]);
        });
    });

    // -----------------------------------------------------------------------
    // Death and game over
    // -----------------------------------------------------------------------
    test.describe('death', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a death costs a life and respawns on the top floor', async ({ page }) => {
            await page.evaluate(() => {
                placePlayer(4, 300);
                spawnEnemy(4, 302, -1);
                step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('dying');
            await advance(page, 60 * 4);
            const out = await page.evaluate(() => ({
                state,
                lives,
                y: player.y,
                top: floorY(0),
                enemies: enemies.length,
                bullets: bullets.length,
            }));
            expect(out.state).toBe('running');
            expect(out.lives).toBe(2);
            expect(out.y).toBe(out.top);
            expect(out.enemies).toBe(0);
            expect(out.bullets).toBe(0);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('collected documents survive a death', async ({ page }) => {
            await page.evaluate(() => {
                const d = doors.find((x) => x.doc);
                placePlayer(d.floor, d.x);
                step(1 / 60);
                placePlayer(4, 300);
                spawnEnemy(4, 302, -1);
                step(1 / 60);
            });
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => docsCollected)).toBe(1);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                placePlayer(4, 300);
                spawnEnemy(4, 302, -1);
                step(1 / 60);
            });
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                placePlayer(4, 300);
                spawnEnemy(4, 302, -1);
                step(1 / 60);
                for (let i = 0; i < 240; i++) step(1 / 60);
            });
            await page.keyboard.press(' ');
            await page.waitForFunction(() => state === 'running');
            const out = await page.evaluate(() => ({ score, lives, level, docs: docsCollected }));
            expect(out).toEqual({ score: 0, lives: 3, level: 1, docs: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                keys.right = true;
                togglePause();
            });
            const before = await page.evaluate(() => [player.x, elevators[0].y]);
            await advance(page, 60);
            expect(await page.evaluate(() => [player.x, elevators[0].y])).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('a new best is stored on game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 5200;
                lives = 1;
                placePlayer(4, 300);
                spawnEnemy(4, 302, -1);
                step(1 / 60);
            });
            await advance(page, 60 * 4);
            await expect(page.locator('#best')).toHaveText('5200');
            expect(await page.evaluate(() => window.localStorage.getItem('elevatorheist-best'))).toBe('5200');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatorheist-best', '9000'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 100;
                lives = 1;
                placePlayer(4, 300);
                spawnEnemy(4, 302, -1);
                step(1 / 60);
            });
            await advance(page, 60 * 4);
            await expect(page.locator('#best')).toHaveText('9000');
        });
    });

    // -----------------------------------------------------------------------
    // Playable end to end
    // -----------------------------------------------------------------------
    test.describe('a full level can be cleared', () => {
        test('driving the real controls collects every document and escapes', async ({ page }) => {
            const out = await page.evaluate(() => {
                startGame();
                autoStep = false;
                autoSpawn = false;
                enemies.length = 0;

                const release = () => {
                    keys.left = keys.right = keys.up = keys.down = false;
                };
                const run = (n) => {
                    for (let i = 0; i < n && state === 'running'; i++) step(1 / 60);
                };

                // Lean on the shaft until a car turns up. Empty cars patrol, so
                // one always comes round to this floor eventually.
                const board = () => {
                    for (let i = 0; i < 3600 && state === 'running'; i++) {
                        if (player.onElevator) break;
                        const shaft =
                            Math.abs(player.x - SHAFT_XS[0]) <= Math.abs(player.x - SHAFT_XS[1]) ? 0 : 1;
                        release();
                        keys[player.x < SHAFT_XS[shaft] ? 'right' : 'left'] = true;
                        step(1 / 60);
                    }
                    release();
                    return player.onElevator !== null;
                };

                const driveTo = (floor) => {
                    if (!board()) return false;
                    const car = player.onElevator;
                    const dist = floorY(floor) - car.y;
                    if (Math.abs(dist) >= 1) {
                        keys[dist > 0 ? 'down' : 'up'] = true;
                        run(Math.ceil(Math.abs(dist) / (ELEVATOR_SPEED / 60)));
                        release();
                    }
                    return Math.abs(car.y - floorY(floor)) < LEVEL_EPS;
                };

                // Walking toward a target crosses shafts on its own: the player
                // waits at the lip, boards the car that arrives, and walks out
                // the far side.
                const walkTo = (x) => {
                    for (let i = 0; i < 3600 && state === 'running'; i++) {
                        if (Math.abs(player.x - x) < 3) break;
                        release();
                        keys[player.x < x ? 'right' : 'left'] = true;
                        step(1 / 60);
                    }
                    release();
                    return Math.abs(player.x - x) < 3 || state === 'levelclear';
                };

                const missed = [];
                for (let leg = 0; leg < 8 && docsCollected < docsTotal; leg++) {
                    const target = doors.find((d) => d.doc && !d.collected);
                    if (!driveTo(target.floor)) {
                        missed.push(`ride to floor ${target.floor}`);
                        break;
                    }
                    if (!walkTo(target.x)) {
                        missed.push(`walk to ${target.x} on floor ${target.floor}`);
                        break;
                    }
                    run(2);
                }
                if (docsCollected === docsTotal) {
                    if (!driveTo(FLOORS - 1)) missed.push('ride to the ground floor');
                    else if (!walkTo(EXIT_X)) missed.push('walk to the exit');
                    run(2);
                }
                return { docsCollected, docsTotal, state, score, missed, lives };
            });

            expect(out.missed).toEqual([]); // names the leg it could not complete
            expect(out.docsCollected).toBe(out.docsTotal);
            expect(out.state).toBe('levelclear');
            expect(out.score).toBeGreaterThan(await page.evaluate(() => LEVEL_BONUS));
            expect(out.lives).toBe(3);
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

        test('drawing works in every state without throwing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                draw(); // idle
                startGame();
                autoSpawn = false;
                placePlayer(2, 300);
                spawnEnemy(2, 420, -1);
                shoot();
                for (let i = 0; i < 30; i++) step(1 / 60);
                draw(); // running
                player.crouch = true;
                draw(); // crouched
                player.crouch = false;
                rideForTest(0);
                step(1 / 60);
                draw(); // riding
                togglePause();
                draw(); // paused
                togglePause();
                collectAllDocsForTest();
                draw(); // exit armed
                placePlayer(FLOORS - 1, EXIT_X);
                step(1 / 60);
                draw(); // level clear
                for (let i = 0; i < 300; i++) step(1 / 60);
                lives = 1;
                placePlayer(4, 300);
                spawnEnemy(4, 302, -1);
                step(1 / 60);
                draw(); // dying
                for (let i = 0; i < 300; i++) step(1 / 60);
                draw(); // over
            });
            expect(errors).toEqual([]);
        });
    });
});
