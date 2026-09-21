const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Most specs care about the player car, not the chase cars, so they start a
// round and then empty the enemy list. Chase cars are only re-created when a
// round begins, so the maze stays quiet for as long as the spec needs.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        enemies.length = 0;
    });

// Drop the car onto a cell centre, travelling in `dir`.
const placeCar = (page, c, r, dir = { x: 0, y: 0 }) =>
    page.evaluate(([cc, rr, d]) => {
        const p = centerOf(cc, rr);
        car.x = p.x;
        car.y = p.y;
        car.dir.x = d.x;
        car.dir.y = d.y;
        car.want.x = d.x;
        car.want.y = d.y;
    }, [c, r, dir]);

const carPos = (page) => page.evaluate(() => ({ x: car.x, y: car.y }));

// Chromium can acknowledge a synthetic key before the page's listener runs, so
// steering is confirmed against the game state before the sim is advanced.
const steer = async (page, key, want) => {
    await page.keyboard.press(key);
    await page.waitForFunction(
        (w) => car.want.x === w.x && car.want.y === w.y,
        want
    );
};

test.describe('Rally-X', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // Freeze the requestAnimationFrame driver so every spec advances the
        // simulation itself through step(dt) — no wall-clock dependence.
        await page.evaluate(() => setAutoStep(false));
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Rally-X', async ({ page }) => {
            await expect(page).toHaveTitle('Rally-X');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('main canvas is the 480x384 viewport', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '384');
        });

        test('radar canvas shows the whole 19x15 maze at 8px a cell', async ({ page }) => {
            const radar = page.locator('#radar');
            await expect(radar).toHaveAttribute('width', '152');
            await expect(radar).toHaveAttribute('height', '120');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level, lives, flags and fuel', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#flags')).toHaveText('10');
            await expect(page.locator('#fuel')).toHaveText('100');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('rallyx-best', '7300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7300');
        });

        test('maze is 19 columns by 15 rows with a solid border', async ({ page }) => {
            const info = await page.evaluate(() => ({
                rows: MAZE.length,
                widths: [...new Set(MAZE.map((row) => row.length))],
                border: MAZE.every((row, r) =>
                    r === 0 || r === ROWS - 1
                        ? [...row].every((ch) => ch === '#')
                        : row[0] === '#' && row[COLS - 1] === '#'
                ),
            }));
            expect(info.rows).toBe(15);
            expect(info.widths).toEqual([19]);
            expect(info.border).toBe(true);
        });

        test('every open cell of the maze is reachable', async ({ page }) => {
            const result = await page.evaluate(() => {
                const open = [];
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++) if (!isWall(c, r)) open.push(`${c},${r}`);
                const seen = new Set([open[0]]);
                const queue = [open[0]];
                while (queue.length) {
                    const [c, r] = queue.shift().split(',').map(Number);
                    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const key = `${c + dc},${r + dr}`;
                        if (!isWall(c + dc, r + dr) && !seen.has(key)) {
                            seen.add(key);
                            queue.push(key);
                        }
                    }
                }
                return { open: open.length, seen: seen.size };
            });
            expect(result.seen).toBe(result.open);
        });

        test('the maze has no dead ends', async ({ page }) => {
            const deadEnds = await page.evaluate(() => {
                const out = [];
                for (let r = 1; r < ROWS - 1; r++) {
                    for (let c = 1; c < COLS - 1; c++) {
                        if (isWall(c, r)) continue;
                        const exits = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(
                            ([dc, dr]) => !isWall(c + dc, r + dr)
                        );
                        if (exits.length < 2) out.push([c, r]);
                    }
                }
                return out;
            });
            expect(deadEnds).toEqual([]);
        });

        test('no chase cars before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('ten flags are laid out, none taken, exactly one lucky', async ({ page }) => {
            const flags = await page.evaluate(() => flags.map((f) => ({ ...f })));
            expect(flags).toHaveLength(10);
            expect(flags.every((f) => !f.taken)).toBe(true);
            expect(flags.filter((f) => f.lucky)).toHaveLength(1);
        });

        test('flags sit on distinct open cells', async ({ page }) => {
            const result = await page.evaluate(() => ({
                allOpen: flags.every((f) => !isWall(f.c, f.r)),
                unique: new Set(flags.map((f) => `${f.c},${f.r}`)).size,
            }));
            expect(result.allOpen).toBe(true);
            expect(result.unique).toBe(10);
        });

        test('the car starts parked at the centre of its start cell', async ({ page }) => {
            const info = await page.evaluate(() => ({
                pos: { x: car.x, y: car.y },
                want: centerOf(START_CELL.c, START_CELL.r),
                dir: { ...car.dir },
            }));
            expect(info.pos).toEqual(info.want);
            expect(info.dir).toEqual({ x: 0, y: 0 });
        });

        test('the tank starts full', async ({ page }) => {
            expect(await page.evaluate(() => fuel)).toBe(await page.evaluate(() => FUEL_MAX));
        });
    });

    // -----------------------------------------------------------------------
    // Starting a round
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('startGame runs the game and hides the overlay', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('level 1 spawns three chase cars on open cells', async ({ page }) => {
            await page.evaluate(() => startGame());
            const info = await page.evaluate(() => ({
                count: enemies.length,
                onOpen: enemies.every((e) => {
                    const cell = cellOf(e.x, e.y);
                    return !isWall(cell.c, cell.r);
                }),
            }));
            expect(info.count).toBe(3);
            expect(info.onOpen).toBe(true);
        });

        test('Space starts the game from the title screen', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Enter starts the game from the title screen', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting resets score, lives, level and fuel', async ({ page }) => {
            await page.evaluate(() => {
                score = 5000;
                lives = 1;
                level = 4;
                fuel = 3;
                startGame();
            });
            const info = await page.evaluate(() => ({ score, lives, level, fuel }));
            expect(info).toEqual({ score: 0, lives: 3, level: 1, fuel: 100 });
        });
    });

    // -----------------------------------------------------------------------
    // Driving
    // -----------------------------------------------------------------------
    test.describe('driving', () => {
        test('the car stays parked until it is steered', async ({ page }) => {
            await startQuiet(page);
            const before = await carPos(page);
            await advance(page, 60);
            expect(await carPos(page)).toEqual(before);
        });

        test('arrow keys set the wanted direction', async ({ page }) => {
            await startQuiet(page);
            await steer(page, 'ArrowRight', { x: 1, y: 0 });
            await steer(page, 'ArrowUp', { x: 0, y: -1 });
            await steer(page, 'ArrowLeft', { x: -1, y: 0 });
            await steer(page, 'ArrowDown', { x: 0, y: 1 });
        });

        test('WASD steers as well', async ({ page }) => {
            await startQuiet(page);
            await steer(page, 'd', { x: 1, y: 0 });
            await steer(page, 'w', { x: 0, y: -1 });
            await steer(page, 'a', { x: -1, y: 0 });
            await steer(page, 's', { x: 0, y: 1 });
        });

        test('a steered car drives at CAR_SPEED', async ({ page }) => {
            await startQuiet(page);
            await placeCar(page, 1, 1);
            await steer(page, 'ArrowRight', { x: 1, y: 0 });
            const before = await carPos(page);
            await advance(page, 60);
            const after = await carPos(page);
            const speed = await page.evaluate(() => CAR_SPEED);
            expect(after.x - before.x).toBeCloseTo(speed, 1);
            expect(after.y).toBeCloseTo(before.y, 5);
        });

        test('the car stops at the centre of the last open cell', async ({ page }) => {
            await startQuiet(page);
            await placeCar(page, 1, 1, { x: 1, y: 0 });
            await advance(page, 400);
            const info = await page.evaluate(() => ({
                pos: { x: car.x, y: car.y },
                wall: centerOf(17, 1),
                dir: { ...car.dir },
            }));
            expect(info.pos).toEqual(info.wall);
            expect(info.dir).toEqual({ x: 0, y: 0 });
        });

        test('a reversal takes effect immediately, mid-corridor', async ({ page }) => {
            await startQuiet(page);
            await placeCar(page, 5, 1, { x: 1, y: 0 });
            await page.evaluate(() => {
                car.x += 7;
                car.want.x = -1;
                car.want.y = 0;
            });
            await advance(page, 1);
            expect(await page.evaluate(() => car.dir.x)).toBe(-1);
        });

        test('a turn waits for a cell centre where the way is open', async ({ page }) => {
            // Driving right along row 1: the way down is blocked at column 3 but
            // open at column 4, so that is where the car should turn.
            await startQuiet(page);
            await placeCar(page, 3, 1, { x: 1, y: 0 });
            await page.evaluate(() => {
                car.want.x = 0;
                car.want.y = 1;
            });
            await advance(page, 30);
            const info = await page.evaluate(() => ({
                dir: { ...car.dir },
                turnX: car.x,
                expected: centerOf(4, 1).x,
            }));
            expect(info.dir).toEqual({ x: 0, y: 1 });
            expect(info.turnX).toBeCloseTo(info.expected, 5);
        });

        test('a turn into a wall is ignored', async ({ page }) => {
            await startQuiet(page);
            await placeCar(page, 1, 1, { x: 1, y: 0 });
            await page.evaluate(() => {
                car.want.x = 0;
                car.want.y = -1; // row 0 is solid wall all the way along
            });
            await advance(page, 60);
            const info = await page.evaluate(() => ({ dir: { ...car.dir }, y: car.y }));
            expect(info.dir).toEqual({ x: 1, y: 0 });
            expect(info.y).toBeCloseTo(48, 5);
        });

        test('the camera follows the car and clamps to the world', async ({ page }) => {
            await startQuiet(page);
            await placeCar(page, 1, 1, { x: 1, y: 0 });
            await advance(page, 1);
            expect(await page.evaluate(() => ({ ...camera }))).toEqual({ x: 0, y: 0 });
            await advance(page, 400);
            const info = await page.evaluate(() => ({
                camera: { ...camera },
                max: { x: WORLD_W - VIEW_W, y: WORLD_H - VIEW_H },
            }));
            expect(info.camera.x).toBe(info.max.x);
            expect(info.camera.y).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Flags and scoring
    // -----------------------------------------------------------------------
    test.describe('flags', () => {
        test('driving over a flag takes it and scores 100', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const f = flags.find((x) => !x.lucky);
                const p = centerOf(f.c, f.r);
                car.x = p.x;
                car.y = p.y;
            });
            await advance(page, 1);
            const info = await page.evaluate(() => ({
                taken: flags.filter((f) => f.taken).length,
                score,
            }));
            expect(info.taken).toBe(1);
            expect(info.score).toBe(100);
        });

        test('a taken flag does not score twice', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const f = flags.find((x) => !x.lucky);
                const p = centerOf(f.c, f.r);
                car.x = p.x;
                car.y = p.y;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => score)).toBe(100);
        });

        test('the HUD counts down the flags left', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const f = flags.find((x) => !x.lucky);
                const p = centerOf(f.c, f.r);
                car.x = p.x;
                car.y = p.y;
            });
            await advance(page, 1);
            await expect(page.locator('#flags')).toHaveText('9');
        });

        test('the lucky flag doubles the value of later flags', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const f = flags.find((x) => x.lucky);
                const p = centerOf(f.c, f.r);
                car.x = p.x;
                car.y = p.y;
            });
            await advance(page, 1);
            expect(await page.evaluate(() => ({ score, multiplier }))).toEqual({
                score: 100,
                multiplier: 2,
            });
            await page.evaluate(() => {
                const f = flags.find((x) => !x.taken);
                const p = centerOf(f.c, f.r);
                car.x = p.x;
                car.y = p.y;
            });
            await advance(page, 1);
            expect(await page.evaluate(() => score)).toBe(300);
        });

        test('clearing every flag ends the round and pays a fuel bonus', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 0;
                fuel = 40;
                flags.forEach((f, i) => {
                    if (i > 0) f.taken = true;
                });
                const f = flags[0];
                const p = centerOf(f.c, f.r);
                car.x = p.x;
                car.y = p.y;
            });
            await advance(page, 1);
            const info = await page.evaluate(() => ({ state, score }));
            expect(info.state).toBe('levelclear');
            // the last flag (100) plus 10 points per whole unit of fuel left
            expect(info.score).toBeGreaterThanOrEqual(100 + 39 * 10);
            expect(info.score).toBeLessThanOrEqual(100 + 40 * 10);
        });

        test('the next round re-lays the flags, refuels and adds a chase car', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                fuel = 40;
                flags.forEach((f) => (f.taken = true));
            });
            await advance(page, 1);
            await advance(page, 150); // ride out the round-clear pause
            const info = await page.evaluate(() => ({
                state,
                level,
                fuel,
                flags: flags.length,
                untaken: flags.filter((f) => !f.taken).length,
                enemies: enemies.length,
                multiplier,
            }));
            expect(info.state).toBe('running');
            expect(info.level).toBe(2);
            // refilled at the start of the round, minus the frames pumped since
            expect(info.fuel).toBeGreaterThan(95);
            expect(info.flags).toBe(10);
            expect(info.untaken).toBe(10);
            expect(info.enemies).toBe(4);
            expect(info.multiplier).toBe(1);
        });

        test('later rounds use a different set of flag spots', async ({ page }) => {
            await startQuiet(page);
            const first = await page.evaluate(() => flags.map((f) => `${f.c},${f.r}`).join('|'));
            await page.evaluate(() => flags.forEach((f) => (f.taken = true)));
            await advance(page, 151);
            const second = await page.evaluate(() => flags.map((f) => `${f.c},${f.r}`).join('|'));
            expect(second).not.toBe(first);
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test('fuel drains while the game runs', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 60);
            const info = await page.evaluate(() => ({ fuel, drain: FUEL_DRAIN }));
            expect(info.fuel).toBeCloseTo(100 - info.drain, 1);
        });

        test('fuel never drops below zero', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                fuel = 0.5;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => fuel)).toBe(0);
        });

        test('an empty tank slows the car down', async ({ page }) => {
            await startQuiet(page);
            await placeCar(page, 1, 1, { x: 1, y: 0 });
            await page.evaluate(() => {
                fuel = 0;
            });
            const before = await carPos(page);
            await advance(page, 60);
            const after = await carPos(page);
            const expected = await page.evaluate(() => CAR_SPEED * LOW_FUEL_FACTOR);
            expect(after.x - before.x).toBeCloseTo(expected, 1);
        });

        test('the fuel gauge tracks the tank', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                fuel = 42;
            });
            await advance(page, 1);
            await expect(page.locator('#fuel')).toHaveText('41');
            const width = await page.locator('#fuel-bar').evaluate((el) => el.style.width);
            expect(parseFloat(width)).toBeGreaterThan(40);
            expect(parseFloat(width)).toBeLessThan(43);
        });
    });

    // -----------------------------------------------------------------------
    // Smoke screen
    // -----------------------------------------------------------------------
    test.describe('smoke screen', () => {
        test('Space drops a smoke cloud and burns fuel', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => fuel);
            await page.keyboard.press('Space');
            await page.waitForFunction(() => smokes.length === 1);
            const info = await page.evaluate(() => ({
                fuel,
                at: { x: smokes[0].x, y: smokes[0].y },
                car: { x: car.x, y: car.y },
                cost: SMOKE_COST,
            }));
            expect(info.fuel).toBeCloseTo(before - info.cost, 5);
            expect(info.at).toEqual(info.car);
        });

        test('no smoke without enough fuel', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                fuel = 1;
                dropSmoke();
            });
            expect(await page.evaluate(() => smokes.length)).toBe(0);
            expect(await page.evaluate(() => fuel)).toBe(1);
        });

        test('a cloud fades away after its lifetime', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => dropSmoke());
            await advance(page, 60);
            expect(await page.evaluate(() => smokes.length)).toBe(1);
            await advance(page, 60 * 5);
            expect(await page.evaluate(() => smokes.length)).toBe(0);
        });

        test('a chase car that hits the smoke spins out', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                dropSmoke();
                // park the player far away, then send one chase car into the cloud
                const p = centerOf(1, 1);
                car.x = p.x;
                car.y = p.y;
                enemies.length = 1;
                enemies[0].x = smokes[0].x;
                enemies[0].y = smokes[0].y;
            });
            await advance(page, 1);
            expect(await page.evaluate(() => enemies[0].stun)).toBeGreaterThan(0);
        });

        test('a spun-out chase car sits still and then recovers', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                enemies[0].stun = STUN_TIME;
            });
            const before = await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }));
            await advance(page, 60);
            expect(await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }))).toEqual(before);
            await advance(page, 60 * 3);
            expect(await page.evaluate(() => enemies[0].stun)).toBe(0);
        });

        test('a spun-out chase car cannot crash the player', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                enemies[0].stun = STUN_TIME;
                enemies[0].x = car.x;
                enemies[0].y = car.y;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => ({ state, lives }))).toEqual({
                state: 'running',
                lives: 3,
            });
        });
    });

    // -----------------------------------------------------------------------
    // Chase cars
    // -----------------------------------------------------------------------
    test.describe('chase cars', () => {
        test('a chase car drives towards the player', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                const e = centerOf(2, 1);
                enemies[0].x = e.x;
                enemies[0].y = e.y;
                graceTimer = 0;
                enemies[0].stun = 0;
                enemies[0].bias = { c: 0, r: 0 };
                enemies[0].wander = 0;
                enemies[0].dir = { x: 1, y: 0 };
                const p = centerOf(14, 1);
                car.x = p.x;
                car.y = p.y;
            });
            const before = await page.evaluate(() => enemies[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => enemies[0].x)).toBeGreaterThan(before);
        });

        test('chase cars stay inside the maze corridors', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 99;
            });
            await advance(page, 60 * 20);
            const info = await page.evaluate(() =>
                enemies.map((e) => {
                    const cell = cellOf(e.x, e.y);
                    const cen = centerOf(cell.c, cell.r);
                    return {
                        wall: isWall(cell.c, cell.r),
                        offAxis: Math.min(Math.abs(e.x - cen.x), Math.abs(e.y - cen.y)),
                    };
                })
            );
            expect(info.every((e) => !e.wall)).toBe(true);
            expect(info.every((e) => e.offAxis < 0.001)).toBe(true);
        });

        test('chase cars hold still for a moment at the start of a life', async ({ page }) => {
            await page.evaluate(() => startGame());
            const at = () => page.evaluate(() => enemies.map((e) => `${e.x},${e.y}`).join('|'));
            const start = await at();
            await advance(page, 60); // still inside the grace period
            expect(await at()).toBe(start);
            await advance(page, 120);
            expect(await at()).not.toBe(start);
        });

        test('the chase plays out the same way every run', async ({ page }) => {
            const run = () =>
                page.evaluate(() => {
                    startGame();
                    lives = 99;
                    for (let i = 0; i < 60 * 10; i++) step(1 / 60);
                    return enemies.map((e) => `${e.x.toFixed(3)},${e.y.toFixed(3)}`).join('|');
                });
            expect(await run()).toBe(await run());
        });

        test('chase cars get faster each round but never outrun a fuelled car', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                const out = [];
                for (let lvl = 1; lvl <= 8; lvl++) out.push(enemySpeed(lvl));
                return out;
            });
            const carSpeed = await page.evaluate(() => CAR_SPEED);
            expect(speeds[1]).toBeGreaterThan(speeds[0]);
            expect(Math.max(...speeds)).toBeLessThan(carSpeed);
        });
    });

    // -----------------------------------------------------------------------
    // Crashing, lives and game over
    // -----------------------------------------------------------------------
    test.describe('crashing', () => {
        const crash = (page) =>
            page.evaluate(() => {
                enemies[0].stun = 0;
                enemies[0].x = car.x;
                enemies[0].y = car.y;
            });

        test('hitting a chase car costs a life', async ({ page }) => {
            await page.evaluate(() => startGame());
            await crash(page);
            await advance(page, 1);
            expect(await page.evaluate(() => ({ state, lives }))).toEqual({
                state: 'dying',
                lives: 2,
            });
        });

        test('after the crash pause everything returns to its start cell', async ({ page }) => {
            await page.evaluate(() => startGame());
            await crash(page);
            await advance(page, 1);
            await advance(page, 120);
            const info = await page.evaluate(() => ({
                state,
                car: { x: car.x, y: car.y },
                start: centerOf(START_CELL.c, START_CELL.r),
                dir: { ...car.dir },
                enemies: enemies.length,
            }));
            expect(info.state).toBe('running');
            expect(info.car).toEqual(info.start);
            expect(info.dir).toEqual({ x: 0, y: 0 });
            expect(info.enemies).toBe(3);
        });

        test('flags already taken stay taken after a crash', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                flags[0].taken = true;
                flags[1].taken = true;
            });
            await crash(page);
            await advance(page, 121);
            expect(await page.evaluate(() => flags.filter((f) => f.taken).length)).toBe(2);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
            });
            await crash(page);
            await advance(page, 121);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('game over records the best score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                score = 1234;
            });
            await crash(page);
            await advance(page, 121);
            const best = await page.evaluate(() => window.localStorage.getItem('rallyx-best'));
            expect(best).toBe('1234');
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('nothing moves once the game is over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
            });
            await crash(page);
            await advance(page, 121);
            await placeCar(page, 1, 1, { x: 1, y: 0 });
            const before = await carPos(page);
            await advance(page, 60);
            expect(await carPos(page)).toEqual(before);
        });

        test('Space starts a fresh game after game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                score = 500;
            });
            await crash(page);
            await advance(page, 121);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ state, score, lives }))).toEqual({
                state: 'running',
                score: 0,
                lives: 3,
            });
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not move or burn fuel', async ({ page }) => {
            await startQuiet(page);
            await placeCar(page, 1, 1, { x: 1, y: 0 });
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ x: car.x, y: car.y, fuel }));
            await advance(page, 60);
            expect(await page.evaluate(() => ({ x: car.x, y: car.y, fuel }))).toEqual(before);
        });

        test('pausing shows the overlay', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('P does nothing on the title screen', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Playability — the whole loop, driven end to end
    // -----------------------------------------------------------------------
    test.describe('playability', () => {
        test('a driver heading for the nearest flag clears the round', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
                // breadth-first search to the nearest flag, one cell of route at a time
                const routeDir = () => {
                    const s = cellOf(car.x, car.y);
                    const prev = new Map();
                    const seen = new Set([`${s.c},${s.r}`]);
                    const queue = [s];
                    let goal = null;
                    while (queue.length) {
                        const cur = queue.shift();
                        if (flags.some((f) => !f.taken && f.c === cur.c && f.r === cur.r)) {
                            goal = cur;
                            break;
                        }
                        for (const d of dirs) {
                            const n = { c: cur.c + d.x, r: cur.r + d.y };
                            const key = `${n.c},${n.r}`;
                            if (isWall(n.c, n.r) || seen.has(key)) continue;
                            seen.add(key);
                            prev.set(key, cur);
                            queue.push(n);
                        }
                    }
                    if (!goal) return null;
                    let cur = goal;
                    for (;;) {
                        const p = prev.get(`${cur.c},${cur.r}`);
                        if (!p) return null;
                        if (p.c === s.c && p.r === s.r) return { x: cur.c - s.c, y: cur.r - s.r };
                        cur = p;
                    }
                };
                let frames = 0;
                while (state === 'running' && frames < 60 * 120) {
                    const d = routeDir();
                    if (d) {
                        car.want.x = d.x;
                        car.want.y = d.y;
                    }
                    step(1 / 60);
                    frames++;
                }
                return { state, left: flags.filter((f) => !f.taken).length, seconds: frames / 60 };
            });
            expect(result.state).toBe('levelclear');
            expect(result.left).toBe(0);
            expect(result.seconds).toBeLessThan(60);
        });

        test('the chase pack catches a player who sits still', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 99;
            });
            await advance(page, 60 * 20);
            expect(await page.evaluate(() => lives)).toBeLessThan(98);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('a running game draws without errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (err) => errors.push(err.message));
            await page.evaluate(() => {
                setAutoStep(true);
                startGame();
                dropSmoke();
            });
            await page.waitForTimeout(400);
            expect(errors).toEqual([]);
        });

        test('the radar draws the maze and the cars', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.waitForTimeout(100);
            const colours = await page.evaluate(() => {
                const ctx = document.getElementById('radar').getContext('2d');
                const { data } = ctx.getImageData(0, 0, 152, 120);
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4)
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                return seen.size;
            });
            expect(colours).toBeGreaterThan(2);
        });

        test('the viewport canvas is painted', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.waitForTimeout(100);
            const painted = await page.evaluate(() => {
                const ctx = document.getElementById('canvas').getContext('2d');
                const { data } = ctx.getImageData(0, 0, 480, 384);
                for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });
    });
});
