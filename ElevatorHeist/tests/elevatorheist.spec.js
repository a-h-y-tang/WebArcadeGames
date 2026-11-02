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

// Start a game with the building to ourselves: no agents, no bullets, and the
// requestAnimationFrame loop no longer advancing the simulation behind the
// spec's back, so time is entirely under the spec's control.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        agents.length = 0;
        bullets.length = 0;
        autoStep = false;
        spawnCd = 1e9;
    });

// Hold a key for `frames` frames and release it. Discrete actions (boarding,
// opening a door, firing) are edge-triggered inside step(), so the release
// frame matters: it is what re-arms the action.
const press = (page, flag, frames = 1, dt = 1 / 60) =>
    page.evaluate(
        ([f, n, d]) => {
            keys[f] = true;
            for (let i = 0; i < n; i++) step(d);
            keys[f] = false;
            step(d);
        },
        [flag, frames, dt]
    );

// Hold a key down without releasing it, advancing `frames` frames.
const holdFor = (page, flag, frames, dt = 1 / 60) =>
    page.evaluate(
        ([f, n, d]) => {
            keys[f] = true;
            for (let i = 0; i < n; i++) step(d);
        },
        [flag, frames, dt]
    );

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

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas matches the declared building size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '520');
            expect(await page.evaluate(() => [CANVAS_W, CANVAS_H])).toEqual([720, 520]);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the starting score, level, lives and documents', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#docs')).toHaveText(`0/${await page.evaluate(() => docsNeeded)}`);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatorheist-best', '7400'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7400');
        });

        test('no agents or bullets before starting', async ({ page }) => {
            expect(await page.evaluate(() => [agents.length, bullets.length])).toEqual([0, 0]);
        });

        test('step() does nothing while idle', async ({ page }) => {
            await page.evaluate(() => {
                autoStep = false;
                keys.right = true;
            });
            const before = await page.evaluate(() => player.x);
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Level generation — the procedural buildings have to stay playable
    // -----------------------------------------------------------------------
    test.describe('level layout', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('level specs grow and then clamp', async ({ page }) => {
            const specs = await page.evaluate(() => [1, 2, 5, 12].map((n) => levelSpec(n)));
            expect(specs[0].floors).toBe(6);
            expect(specs.map((s) => s.floors)).toEqual([...specs].map((s) => s.floors).sort((a, b) => a - b));
            expect(specs[3].floors).toBe(9);
            expect(specs[0].docs).toBe(3);
            expect(specs[3].docs).toBe(6);
            expect(specs[3].maxAgents).toBe(5);
            expect(specs[3].agentSpeed).toBeGreaterThan(specs[0].agentSpeed);
        });

        test('floors are evenly spaced and fit inside the canvas', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: FLOORS }, (_, i) => floorY(i))
            );
            expect(ys.length).toBeGreaterThanOrEqual(6);
            expect(ys.length).toBeLessThanOrEqual(9);
            for (let i = 1; i < ys.length; i++) {
                expect(ys[i] - ys[i - 1]).toBeCloseTo(await page.evaluate(() => FLOOR_H), 5);
            }
            expect(ys[0]).toBeGreaterThan(0);
            expect(ys[ys.length - 1]).toBeLessThan(await page.evaluate(() => CANVAS_H));
        });

        test('shafts sit inside the walls and do not overlap', async ({ page }) => {
            const info = await page.evaluate(() => ({
                shafts: shaftX.slice(),
                w: SHAFT_W,
                left: WALL_L,
                right: WALL_R,
            }));
            expect(info.shafts.length).toBe(2);
            const [a, b] = [...info.shafts].sort((p, q) => p - q);
            expect(a).toBeGreaterThan(info.left);
            expect(b + info.w).toBeLessThan(info.right);
            expect(b - (a + info.w)).toBeGreaterThan(60);
        });

        test('doors stay inside the walls and clear of every shaft', async ({ page }) => {
            const bad = await page.evaluate(() =>
                doors.filter((d) => {
                    const l = d.x - DOOR_W / 2;
                    const r = d.x + DOOR_W / 2;
                    if (l < WALL_L || r > WALL_R) return true;
                    return shaftX.some((sx) => r > sx - 8 && l < sx + SHAFT_W + 8);
                })
            );
            expect(bad).toEqual([]);
        });

        test('no floor is overcrowded with doors', async ({ page }) => {
            const perFloor = await page.evaluate(() => {
                const counts = Array.from({ length: FLOORS }, () => 0);
                doors.forEach((d) => counts[d.floor]++);
                return { counts, max: DOORS_PER_FLOOR };
            });
            perFloor.counts.forEach((c) => expect(c).toBeLessThanOrEqual(perFloor.max));
            expect(Math.max(...perFloor.counts)).toBeGreaterThan(0);
        });

        test('red doors match the documents the level needs', async ({ page }) => {
            const info = await page.evaluate(() => ({
                red: doors.filter((d) => d.kind === 'red').length,
                needed: docsNeeded,
                spec: levelSpec(1).docs,
            }));
            expect(info.red).toBe(info.needed);
            expect(info.needed).toBe(info.spec);
        });

        test('every shaft has exactly one car, parked level with a floor', async ({ page }) => {
            const info = await page.evaluate(() =>
                cars.map((car) => ({
                    shaft: car.shaft,
                    onFloor: Array.from({ length: FLOORS }, (_, i) => floorY(i)).some(
                        (y) => Math.abs(y - car.y) < 0.001
                    ),
                }))
            );
            expect(info.map((c) => c.shaft)).toEqual([0, 1]);
            info.forEach((c) => expect(c.onFloor).toBe(true));
        });

        test('the spy starts on the top floor, clear of the shafts', async ({ page }) => {
            const info = await page.evaluate(() => ({
                floor: player.floor,
                y: player.y,
                top: floorY(0),
                inShaft: shaftX.some((sx) => player.x > sx - 4 && player.x < sx + SHAFT_W + 4),
                riding: player.riding,
            }));
            expect(info.floor).toBe(0);
            expect(info.y).toBeCloseTo(info.top, 5);
            expect(info.inShaft).toBe(false);
            expect(info.riding).toBe(null);
        });

        test('a level number always generates the same building', async ({ page }) => {
            const sigs = await page.evaluate(() => {
                loadLevel(3);
                const a = layoutSignature();
                loadLevel(3);
                const b = layoutSignature();
                loadLevel(4);
                const c = layoutSignature();
                return [a, b, c];
            });
            expect(sigs[0]).toBe(sigs[1]);
            expect(sigs[0]).not.toBe(sigs[2]);
        });
    });

    // -----------------------------------------------------------------------
    // Running along a floor
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('holding right runs right and faces right', async ({ page }) => {
            const before = await page.evaluate(() => player.x);
            await holdFor(page, 'right', 30);
            const after = await page.evaluate(() => ({ x: player.x, dir: player.dir }));
            expect(after.x).toBeGreaterThan(before + 40);
            expect(after.dir).toBe(1);
        });

        test('holding left runs left and faces left', async ({ page }) => {
            const before = await page.evaluate(() => player.x);
            await holdFor(page, 'left', 30);
            const after = await page.evaluate(() => ({ x: player.x, dir: player.dir }));
            expect(after.x).toBeLessThan(before - 40);
            expect(after.dir).toBe(-1);
        });

        test('the spy cannot run through the outer walls', async ({ page }) => {
            await holdFor(page, 'right', 600);
            const right = await page.evaluate(() => ({ x: player.x, wall: WALL_R, w: PLAYER_W }));
            expect(right.x + right.w / 2).toBeLessThanOrEqual(right.wall + 0.001);
            await page.evaluate(() => {
                keys.right = false;
            });
            await holdFor(page, 'left', 600);
            const left = await page.evaluate(() => ({ x: player.x, wall: WALL_L, w: PLAYER_W }));
            expect(left.x - left.w / 2).toBeGreaterThanOrEqual(left.wall - 0.001);
        });

        test('there is no way up except an elevator', async ({ page }) => {
            await page.evaluate(() => {
                player.floor = 2;
                player.y = floorY(2);
                player.x = (WALL_L + WALL_R) / 2;
                // Park both cars away from floor 2.
                cars.forEach((car) => {
                    car.y = floorY(FLOORS - 1);
                });
            });
            await holdFor(page, 'up', 60);
            const after = await page.evaluate(() => ({ y: player.y, floor: player.floor, riding: player.riding, at: floorY(2) }));
            expect(after.y).toBeCloseTo(after.at, 5);
            expect(after.floor).toBe(2);
            expect(after.riding).toBe(null);
        });
    });

    // -----------------------------------------------------------------------
    // Elevators
    // -----------------------------------------------------------------------
    test.describe('elevators', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            // Stand in shaft 0 on floor 2 with the car level with that floor.
            await page.evaluate(() => {
                player.floor = 2;
                player.y = floorY(2);
                player.x = shaftCenter(0);
                player.riding = null;
                cars[0].y = floorY(2);
                cars[1].y = floorY(FLOORS - 1);
            });
        });

        test('pressing up inside a shaft with a level car boards it', async ({ page }) => {
            await press(page, 'up');
            expect(await page.evaluate(() => player.riding)).toBe(0);
            expect(await page.evaluate(() => Math.abs(player.x - shaftCenter(0)) < 0.001)).toBe(true);
        });

        test('a car that is not level cannot be boarded', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(2) - FLOOR_H / 2;
            });
            await press(page, 'up', 10);
            expect(await page.evaluate(() => player.riding)).toBe(null);
            // ...but the press does call the car toward the floor.
            expect(await page.evaluate(() => cars[0].y)).toBeGreaterThan(
                await page.evaluate(() => floorY(2) - FLOOR_H / 2)
            );
        });

        test('riding up lifts the car and the spy together', async ({ page }) => {
            await press(page, 'up');
            const before = await page.evaluate(() => cars[0].y);
            await holdFor(page, 'up', 30);
            const after = await page.evaluate(() => ({ car: cars[0].y, y: player.y }));
            expect(after.car).toBeLessThan(before - 20);
            expect(after.y).toBeCloseTo(after.car, 5);
        });

        test('riding down lowers the car', async ({ page }) => {
            await press(page, 'down');
            expect(await page.evaluate(() => player.riding)).toBe(0);
            const before = await page.evaluate(() => cars[0].y);
            await holdFor(page, 'down', 30);
            expect(await page.evaluate(() => cars[0].y)).toBeGreaterThan(before + 20);
        });

        test('a car stops at the top and the bottom of its shaft', async ({ page }) => {
            await press(page, 'up');
            await holdFor(page, 'up', 600);
            const top = await page.evaluate(() => ({ car: cars[0].y, limit: floorY(0) }));
            expect(top.car).toBeCloseTo(top.limit, 5);
            await page.evaluate(() => {
                keys.up = false;
            });
            await holdFor(page, 'down', 1200);
            const bottom = await page.evaluate(() => ({ car: cars[0].y, limit: floorY(FLOORS - 1) }));
            expect(bottom.car).toBeCloseTo(bottom.limit, 5);
        });

        test('stepping off a level car puts the spy on that floor', async ({ page }) => {
            await press(page, 'up');
            await page.evaluate(() => {
                cars[0].y = floorY(1);
                player.y = cars[0].y;
            });
            await press(page, 'right');
            const after = await page.evaluate(() => ({
                riding: player.riding,
                floor: player.floor,
                y: player.y,
                at: floorY(1),
                x: player.x,
                center: shaftCenter(0),
            }));
            expect(after.riding).toBe(null);
            expect(after.floor).toBe(1);
            expect(after.y).toBeCloseTo(after.at, 5);
            expect(after.x).toBeGreaterThan(after.center);
        });

        test('a car cannot be left between floors', async ({ page }) => {
            await press(page, 'up');
            await page.evaluate(() => {
                cars[0].y = floorY(1) + FLOOR_H / 2;
                player.y = cars[0].y;
            });
            await press(page, 'right', 10);
            expect(await page.evaluate(() => player.riding)).toBe(0);
        });

        test('a car that is away is called to the floor you are standing on', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(FLOORS - 1);
            });
            await press(page, 'up');
            const moved = await page.evaluate(() => cars[0].y);
            expect(moved).toBeLessThan(await page.evaluate(() => floorY(FLOORS - 1)));
            // It arrives, stops exactly level, and can then be boarded.
            await advance(page, 600);
            const arrived = await page.evaluate(() => ({ car: cars[0].y, want: floorY(2) }));
            expect(arrived.car).toBeCloseTo(arrived.want, 5);
            await press(page, 'up');
            expect(await page.evaluate(() => player.riding)).toBe(0);
        });

        test('a called car does not overshoot its floor', async ({ page }) => {
            await page.evaluate(() => {
                cars[0].y = floorY(0);
            });
            await press(page, 'down');
            await advance(page, 900);
            const after = await page.evaluate(() => ({ car: cars[0].y, want: floorY(2) }));
            expect(after.car).toBeCloseTo(after.want, 5);
        });

        test('calling a car does not strand the spy after losing a life', async ({ page }) => {
            // Both cars parked at the bottom, spy respawned at the top.
            await page.evaluate(() => {
                cars.forEach((c) => {
                    c.y = floorY(FLOORS - 1);
                });
                loseLife();
                player.x = shaftCenter(0);
            });
            expect(await page.evaluate(() => player.floor)).toBe(0);
            await press(page, 'down');
            await advance(page, 900);
            await press(page, 'down');
            expect(await page.evaluate(() => player.riding)).toBe(0);
        });

        test('a descending car crushes an agent standing in the shaft', async ({ page }) => {
            await page.evaluate(() => {
                score = 0;
                spawnAgent(3, shaftCenter(0));
            });
            await press(page, 'down');
            await holdFor(page, 'down', 90);
            const after = await page.evaluate(() => ({ agents: agents.length, score }));
            expect(after.agents).toBe(0);
            expect(after.score).toBe(await page.evaluate(() => SCORE_CRUSH));
        });
    });

    // -----------------------------------------------------------------------
    // Doors and documents
    // -----------------------------------------------------------------------
    test.describe('doors', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('opening a red door takes the document and scores', async ({ page }) => {
            await page.evaluate(() => {
                score = 0;
                const door = doors.find((d) => d.kind === 'red');
                player.floor = door.floor;
                player.y = floorY(door.floor);
                player.x = door.x;
            });
            await press(page, 'up');
            const after = await page.evaluate(() => ({
                taken: docsTaken,
                score,
                opened: doors.find((d) => d.kind === 'red' && d.opened) !== undefined,
                value: SCORE_DOC,
            }));
            expect(after.taken).toBe(1);
            expect(after.score).toBe(after.value);
            expect(after.opened).toBe(true);
            await expect(page.locator('#docs')).toHaveText(`1/${await page.evaluate(() => docsNeeded)}`);
        });

        test('the same red door cannot be looted twice', async ({ page }) => {
            await page.evaluate(() => {
                const door = doors.find((d) => d.kind === 'red');
                player.floor = door.floor;
                player.y = floorY(door.floor);
                player.x = door.x;
            });
            await press(page, 'up');
            await press(page, 'up');
            expect(await page.evaluate(() => docsTaken)).toBe(1);
        });

        test('a blue door holds no document', async ({ page }) => {
            await page.evaluate(() => {
                score = 0;
                const door = doors.find((d) => d.kind === 'blue');
                player.floor = door.floor;
                player.y = floorY(door.floor);
                player.x = door.x;
            });
            await press(page, 'up');
            expect(await page.evaluate(() => [docsTaken, score])).toEqual([0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.floor = 2;
                player.y = floorY(2);
                player.x = (WALL_L + WALL_R) / 2;
                player.dir = 1;
                score = 0;
            });
        });

        test('firing sends a bullet off in the direction the spy faces', async ({ page }) => {
            await press(page, 'fire');
            const shot = await page.evaluate(() => bullets.map((b) => ({ vx: b.vx, owner: b.owner, x: b.x })));
            expect(shot.length).toBe(1);
            expect(shot[0].owner).toBe('player');
            expect(shot[0].vx).toBeGreaterThan(0);
            const x0 = shot[0].x;
            await advance(page, 5);
            expect(await page.evaluate(() => bullets[0].x)).toBeGreaterThan(x0);
        });

        test('facing left fires to the left', async ({ page }) => {
            await page.evaluate(() => {
                player.dir = -1;
            });
            await press(page, 'fire');
            expect(await page.evaluate(() => bullets[0].vx)).toBeLessThan(0);
        });

        test('only one spy bullet is in flight at a time', async ({ page }) => {
            await press(page, 'fire');
            await press(page, 'fire');
            expect(await page.evaluate(() => bullets.filter((b) => b.owner === 'player').length)).toBe(1);
        });

        test('a bullet kills an agent and scores', async ({ page }) => {
            await page.evaluate(() => {
                spawnAgent(2, player.x + 120);
            });
            await press(page, 'fire');
            await advance(page, 40);
            const after = await page.evaluate(() => ({
                agents: agents.length,
                bullets: bullets.filter((b) => b.owner === 'player').length,
                score,
                value: SCORE_AGENT,
            }));
            expect(after.agents).toBe(0);
            expect(after.bullets).toBe(0);
            expect(after.score).toBe(after.value);
        });

        test('a bullet that reaches the wall disappears', async ({ page }) => {
            await press(page, 'fire');
            await advance(page, 120);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Agents
    // -----------------------------------------------------------------------
    test.describe('agents', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.floor = 2;
                player.y = floorY(2);
                player.x = (WALL_L + WALL_R) / 2;
            });
        });

        test('an agent on the same floor closes in on the spy', async ({ page }) => {
            await page.evaluate(() => {
                spawnAgent(2, player.x + 200);
                agents[0].fireCd = 1e9; // keep it walking rather than shooting
            });
            const before = await page.evaluate(() => Math.abs(agents[0].x - player.x));
            await advance(page, 120); // 0.5s stood in the doorway, then 1.5s of walking
            const after = await page.evaluate(() => Math.abs(agents[0].x - player.x));
            expect(after).toBeLessThan(before - 40);
        });

        test('an agent bullet costs the standing spy a life', async ({ page }) => {
            await page.evaluate(() => {
                spawnAgent(2, player.x + 150);
                agents[0].fireCd = 0;
            });
            await advance(page, 90);
            const after = await page.evaluate(() => ({ lives, floor: player.floor, shots: agentShots }));
            expect(after.shots).toBeGreaterThan(0);
            expect(after.lives).toBe(2);
            expect(after.floor).toBe(0); // reset to the level start
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('a ducking spy is missed by agent fire', async ({ page }) => {
            await page.evaluate(() => {
                spawnAgent(2, player.x + 150);
                agents[0].fireCd = 0;
                keys.down = true;
            });
            await advance(page, 90);
            const after = await page.evaluate(() => ({ lives, duck: player.duck, shots: agentShots }));
            expect(after.duck).toBe(true);
            expect(after.shots).toBeGreaterThan(0); // the agent really did shoot
            expect(after.lives).toBe(3);
        });

        test('ducking roots the spy in place', async ({ page }) => {
            const x0 = await page.evaluate(() => {
                keys.down = true;
                keys.right = true;
                return player.x;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBeCloseTo(x0, 5);
        });

        test('agents spawn over time up to the level cap', async ({ page }) => {
            await page.evaluate(() => {
                spawnCd = 0;
            });
            await advance(page, 60 * 10);
            const after = await page.evaluate(() => ({
                n: agents.length,
                spawned: agentsSpawned,
                cap: levelSpec(level).maxAgents,
            }));
            expect(after.spawned).toBeGreaterThan(0);
            expect(after.n).toBeLessThanOrEqual(after.cap);
        });

        test('security never materialises right on top of the spy', async ({ page }) => {
            const worst = await page.evaluate(() => {
                let closest = Infinity;
                for (let i = 0; i < 400; i++) {
                    agents.length = 0;
                    spawnCd = 0;
                    trySpawnAgent(1 / 60);
                    for (const a of agents) {
                        if (a.floor !== player.floor) continue;
                        closest = Math.min(closest, Math.abs(a.x - player.x));
                    }
                }
                return { closest, limit: SAFE_SPAWN_GAP };
            });
            expect(worst.closest).toBeGreaterThanOrEqual(worst.limit);
        });

        test('a life lost clears the floor of agents and bullets', async ({ page }) => {
            await page.evaluate(() => {
                spawnAgent(2, player.x + 60);
                bullets.push({ x: player.x, y: player.y - 22, vx: 100, owner: 'agent' });
                loseLife();
            });
            expect(await page.evaluate(() => [agents.length, bullets.length])).toEqual([0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Escaping, levels and game over
    // -----------------------------------------------------------------------
    test.describe('escape and progression', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        const goToExit = (page) =>
            page.evaluate(() => {
                player.riding = null;
                player.floor = FLOORS - 1;
                player.y = floorY(FLOORS - 1);
                player.x = WALL_L + PLAYER_W / 2;
            });

        test('the getaway car is locked until every document is taken', async ({ page }) => {
            await goToExit(page);
            await advance(page, 30);
            expect(await page.evaluate(() => [level, state])).toEqual([1, 'playing']);
        });

        test('escaping with every document clears the level', async ({ page }) => {
            await page.evaluate(() => {
                score = 0;
                doors.filter((d) => d.kind === 'red').forEach((d) => {
                    d.opened = true;
                });
                docsTaken = docsNeeded;
            });
            await goToExit(page);
            await advance(page, 30);
            const after = await page.evaluate(() => ({ level, docsTaken, score, state }));
            expect(after.level).toBe(2);
            expect(after.docsTaken).toBe(0);
            expect(after.score).toBeGreaterThanOrEqual(await page.evaluate(() => SCORE_LEVEL));
            expect(after.state).toBe('playing');
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the last life ends the game and records the best score', async ({ page }) => {
            await page.evaluate(() => {
                score = 3210;
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|caught/i);
            expect(await page.evaluate(() => window.localStorage.getItem('elevatorheist-best'))).toBe('3210');
            await expect(page.locator('#best')).toHaveText('3210');
        });

        test('pausing freezes the building', async ({ page }) => {
            await page.evaluate(() => togglePause());
            expect(await page.evaluate(() => state)).toBe('paused');
            const x0 = await page.evaluate(() => player.x);
            await holdFor(page, 'right', 60);
            expect(await page.evaluate(() => player.x)).toBeCloseTo(x0, 5);
            await page.evaluate(() => {
                keys.right = false;
                togglePause();
            });
            expect(await page.evaluate(() => state)).toBe('playing');
            await holdFor(page, 'right', 30);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(x0);
        });

        test('restarting after a loss resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                level = 4;
                lives = 1;
                loseLife();
                startGame();
            });
            const after = await page.evaluate(() => ({ score, level, lives, state, docsTaken }));
            expect(after).toEqual({ score: 0, level: 1, lives: 3, state: 'playing', docsTaken: 0 });
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // A real run through the building, driven only through the key state —
    // nothing here reaches in and moves the spy or a car by hand.
    // -----------------------------------------------------------------------
    test.describe('playthrough', () => {
        test('the spy can walk into a shaft, ride down, step off and loot a door', async ({ page }) => {
            const trace = await page.evaluate(() => {
                const dt = 1 / 60;
                const log = {};
                startGame();
                autoStep = false;
                agents.length = 0;
                spawnCd = 1e9;

                const run = (flag, limit, done) => {
                    keys[flag] = true;
                    let n = 0;
                    while (n++ < limit && !done()) step(dt);
                    keys[flag] = false;
                    step(dt);
                    return done();
                };

                // Shaft 0 is to the left of the spy's start, and its car is
                // parked level with the top floor.
                log.reachedShaft = run('left', 600, () => player.x > shaftX[0] && player.x < shaftX[0] + SHAFT_W);
                log.boarded = run('down', 4, () => player.riding === 0);

                // Ride down to the second floor and step off to the right.
                log.rodeDown = run('down', 600, () => Math.abs(cars[0].y - floorY(2)) < 1.2 && player.riding === 0);
                log.steppedOff = run('right', 4, () => player.riding === null && player.floor === 2);

                // Walk to a door on this floor and open it.
                const door = doors.filter((d) => d.floor === 2).sort((a, b) => a.x - b.x).pop();
                log.hasDoor = !!door;
                if (door) {
                    const toward = door.x > player.x ? 'right' : 'left';
                    log.reachedDoor = run(toward, 900, () => Math.abs(player.x - door.x) < 6);
                    log.opened = run('up', 2, () => door.flash > 0);
                    log.kind = door.kind;
                    log.docs = docsTaken;
                }
                log.alive = state;
                return log;
            });

            expect(trace.reachedShaft).toBe(true);
            expect(trace.boarded).toBe(true);
            expect(trace.rodeDown).toBe(true);
            expect(trace.steppedOff).toBe(true);
            expect(trace.hasDoor).toBe(true);
            expect(trace.reachedDoor).toBe(true);
            expect(trace.opened).toBe(true);
            expect(trace.docs).toBe(trace.kind === 'red' ? 1 : 0);
            expect(trace.alive).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard and buttons wired to the page
    // -----------------------------------------------------------------------
    test.describe('controls', () => {
        test('space starts the game from the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('arrow keys set the key state', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.down('ArrowRight');
            await page.waitForFunction(() => keys.right);
            await page.keyboard.up('ArrowRight');
            await page.waitForFunction(() => !keys.right);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the canvas is actually painted', async ({ page }) => {
            await page.locator('#btn-start').click();
            const painted = await page.evaluate(() => {
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                let lit = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] + data[i + 1] + data[i + 2] > 60) lit++;
                }
                return lit;
            });
            expect(painted).toBeGreaterThan(1000);
        });
    });
    // -----------------------------------------------------------------------
    // Integration with the repo's game browser
    // -----------------------------------------------------------------------
    test.describe('catalogue', () => {
        const catalogue = () =>
            JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );

        test('games.json lists Elevator Heist', () => {
            const entry = catalogue().find((g) => g.id === 'elevator-heist');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Elevator Heist');
            expect(entry.dir).toBe('ElevatorHeist');
            expect(entry.path).toBe('games/ElevatorHeist/index.html');
            expect(entry.thumbnail).toBe('games/ElevatorHeist/screenshot.png');
            expect(entry.category).toBe('Action');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = catalogue();
            const i = games.findIndex((g) => g.id === 'elevator-heist');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorHeist/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game with a status', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            const row = readme.split('\n').find((l) => l.includes('[ElevatorHeist/]'));
            expect(row).toBeTruthy();
            expect(row).toMatch(/\| (In Progress|Complete) \|/);
        });

        test('the game folder ships a README and a design doc', () => {
            ['README.md', 'DESIGN.md'].forEach((f) => {
                expect(fs.existsSync(path.join(REPO_ROOT, 'ElevatorHeist', f))).toBe(true);
            });
        });
    });
});
