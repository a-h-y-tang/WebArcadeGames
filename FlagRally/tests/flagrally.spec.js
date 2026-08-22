const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt). All
// motion in the game is expressed per-second and applied through step(), so the
// specs never have to race requestAnimationFrame.
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

const KEY_DIR = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    a: { x: -1, y: 0 },
    d: { x: 1, y: 0 },
    w: { x: 0, y: -1 },
    s: { x: 0, y: 1 },
};

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so every steer is confirmed against `car.want` before the simulation is
// advanced.
const steer = async (page, key) => {
    await page.keyboard.press(key);
    await page.waitForFunction(
        (want) => car.want.x === want.x && car.want.y === want.y,
        KEY_DIR[key]
    );
};

// Start a level with the rivals removed, so long simulations stay deterministic
// and a wandering rival cannot wreck a run mid-assertion. Specs that are about
// rivals leave them in place.
const startQuiet = (page, seed = 4242) =>
    page.evaluate((s) => {
        setSeed(s);
        startGame();
        enemies.length = 0;
    }, seed);

// Put the car on the centre of a given cell, travelling in `dir`.
const placeCar = (page, c, r, dir = { x: 1, y: 0 }) =>
    page.evaluate(([cc, rr, d]) => {
        car.x = centerX(cc);
        car.y = centerY(rr);
        car.dir = { ...d };
        car.want = { ...d };
    }, [c, r, dir]);

test.describe('Flag Rally', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Flag Rally', async ({ page }) => {
            await expect(page).toHaveTitle('Flag Rally');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 660x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '660');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('game starts idle with a full HUD', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('idle simulation does not move the car', async ({ page }) => {
            const before = await page.evaluate(() => ({ x: car.x, y: car.y }));
            await advance(page, 60);
            const after = await page.evaluate(() => ({ x: car.x, y: car.y }));
            expect(after).toEqual(before);
        });

        test('help text documents the controls', async ({ page }) => {
            const help = page.locator('.help');
            await expect(help).toContainText(/smoke/i);
            await expect(help).toContainText(/pause/i);
        });
    });

    // -----------------------------------------------------------------------
    // Course generation
    // -----------------------------------------------------------------------
    test.describe('course', () => {
        test('world is larger than the scrolling window on both axes', async ({ page }) => {
            const dims = await page.evaluate(() => ({
                ww: WORLD_W, wh: WORLD_H, vw: VIEW_W, vh: VIEW_H,
                cols: COLS, rows: ROWS, tile: TILE,
            }));
            expect(dims.ww).toBe(dims.cols * dims.tile);
            expect(dims.wh).toBe(dims.rows * dims.tile);
            expect(dims.ww).toBeGreaterThan(dims.vw);
            expect(dims.wh).toBeGreaterThan(dims.vh);
        });

        test('the outer ring is solid wall', async ({ page }) => {
            const leaks = await page.evaluate(() => {
                const bad = [];
                for (let c = 0; c < COLS; c++) {
                    if (isOpen(c, 0)) bad.push([c, 0]);
                    if (isOpen(c, ROWS - 1)) bad.push([c, ROWS - 1]);
                }
                for (let r = 0; r < ROWS; r++) {
                    if (isOpen(0, r)) bad.push([0, r]);
                    if (isOpen(COLS - 1, r)) bad.push([COLS - 1, r]);
                }
                return bad;
            });
            expect(leaks).toEqual([]);
        });

        test('walls only stand on odd/odd interior cells', async ({ page }) => {
            const bad = await page.evaluate(() => {
                const out = [];
                for (let r = 1; r < ROWS - 1; r++) {
                    for (let c = 1; c < COLS - 1; c++) {
                        if (!isOpen(c, r) && !(r % 2 === 1 && c % 2 === 1)) out.push([c, r]);
                    }
                }
                return out;
            });
            expect(bad).toEqual([]);
        });

        test('the course contains some pillars', async ({ page }) => {
            const pillars = await page.evaluate(() => {
                let n = 0;
                for (let r = 1; r < ROWS - 1; r++)
                    for (let c = 1; c < COLS - 1; c++) if (!isOpen(c, r)) n++;
                return n;
            });
            expect(pillars).toBeGreaterThan(10);
        });

        test('every open cell is reachable from the start cell', async ({ page }) => {
            const result = await page.evaluate(() => {
                const open = [];
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++) if (isOpen(c, r)) open.push(c + ',' + r);
                const seen = new Set();
                const queue = [[SPAWN.c, SPAWN.r]];
                seen.add(SPAWN.c + ',' + SPAWN.r);
                while (queue.length) {
                    const [c, r] = queue.shift();
                    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nc = c + dc, nr = r + dr, k = nc + ',' + nr;
                        if (isOpen(nc, nr) && !seen.has(k)) {
                            seen.add(k);
                            queue.push([nc, nr]);
                        }
                    }
                }
                return { open: open.length, reached: seen.size };
            });
            expect(result.reached).toBe(result.open);
            expect(result.open).toBeGreaterThan(200);
        });

        test('the same seed rebuilds the same course', async ({ page }) => {
            const snapshot = () =>
                page.evaluate(() => {
                    setSeed(99);
                    startGame();
                    return {
                        walls: maze.join(''),
                        flags: flags.map((f) => `${f.c},${f.r},${f.special}`).join('|'),
                        rocks: rocks.map((k) => `${k.c},${k.r}`).join('|'),
                    };
                });
            const first = await snapshot();
            const second = await snapshot();
            expect(second).toEqual(first);
            expect(first.walls.length).toBeGreaterThan(0);
        });

        test('different seeds build different courses', async ({ page }) => {
            const walls = (seed) =>
                page.evaluate((s) => {
                    setSeed(s);
                    startGame();
                    return maze.join('');
                }, seed);
            expect(await walls(1)).not.toBe(await walls(2));
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh game has full lives, full fuel and every flag', async ({ page }) => {
            await startQuiet(page);
            const s = await page.evaluate(() => ({
                lives, level, score,
                fuel: Math.round(fuel),
                flags: flags.length,
                left: flags.filter((f) => !f.taken).length,
            }));
            expect(s).toEqual({
                lives: 3, fuel: 100, level: 1, score: 0,
                flags: 10, left: 10,
            });
        });

        test('exactly one flag is the special flag', async ({ page }) => {
            await startQuiet(page);
            const specials = await page.evaluate(() => flags.filter((f) => f.special).length);
            expect(specials).toBe(1);
        });

        test('flags sit on open cells away from the start', async ({ page }) => {
            await startQuiet(page);
            const bad = await page.evaluate(() =>
                flags.filter(
                    (f) =>
                        !isOpen(f.c, f.r) ||
                        Math.abs(f.c - SPAWN.c) + Math.abs(f.r - SPAWN.r) < 6
                ).length
            );
            expect(bad).toBe(0);
        });

        test('no two flags share a cell', async ({ page }) => {
            await startQuiet(page);
            const unique = await page.evaluate(
                () => new Set(flags.map((f) => f.c + ',' + f.r)).size
            );
            expect(unique).toBe(10);
        });

        test('boulders sit on open cells and never share a cell with a flag', async ({ page }) => {
            await startQuiet(page);
            const bad = await page.evaluate(() => {
                const flagCells = new Set(flags.map((f) => f.c + ',' + f.r));
                return rocks.filter((k) => !isOpen(k.c, k.r) || flagCells.has(k.c + ',' + k.r))
                    .length;
            });
            expect(bad).toBe(0);
        });

        test('the car starts on the spawn cell', async ({ page }) => {
            await startQuiet(page);
            const s = await page.evaluate(() => ({
                x: car.x, y: car.y, sx: centerX(SPAWN.c), sy: centerY(SPAWN.r),
            }));
            expect(s.x).toBeCloseTo(s.sx, 5);
            expect(s.y).toBeCloseTo(s.sy, 5);
        });

        test('rivals start away from the car', async ({ page }) => {
            await page.evaluate(() => startGame());
            const far = await page.evaluate(() =>
                enemies.every((e) => Math.hypot(e.x - car.x, e.y - car.y) > 200)
            );
            const count = await page.evaluate(() => enemies.length);
            expect(count).toBeGreaterThanOrEqual(3);
            expect(far).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Driving
    // -----------------------------------------------------------------------
    test.describe('driving', () => {
        test('arrow keys request a direction', async ({ page }) => {
            await startQuiet(page);
            await steer(page, 'ArrowDown');
            expect(await page.evaluate(() => car.want)).toEqual({ x: 0, y: 1 });
        });

        test('WASD steers as well as the arrows', async ({ page }) => {
            await startQuiet(page);
            await steer(page, 's');
            expect(await page.evaluate(() => car.want)).toEqual({ x: 0, y: 1 });
        });

        test('the car drives in the direction it faces', async ({ page }) => {
            await startQuiet(page);
            const moved = await page.evaluate(() => {
                car.x = centerX(2);
                car.y = centerY(2);
                car.dir = { x: 1, y: 0 };
                car.want = { x: 1, y: 0 };
                const x0 = car.x;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return car.x - x0;
            });
            expect(moved).toBeGreaterThan(20);
        });

        // Measured inside one evaluate so the live requestAnimationFrame loop
        // cannot slip extra frames between the two readings.
        test('the car travels at roughly CAR_SPEED px/s', async ({ page }) => {
            await startQuiet(page);
            const r = await page.evaluate(() => {
                car.x = centerX(2);
                car.y = centerY(2);
                car.dir = { x: 0, y: 1 };
                car.want = { x: 0, y: 1 };
                const y0 = car.y;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { moved: car.y - y0, expected: CAR_SPEED };
            });
            expect(r.moved).toBeGreaterThan(r.expected * 0.95);
            expect(r.moved).toBeLessThanOrEqual(r.expected * 1.01);
        });

        test('the car stays on the lane centre line while driving', async ({ page }) => {
            await startQuiet(page);
            await placeCar(page, 2, 2, { x: 1, y: 0 });
            await advance(page, 40);
            const off = await page.evaluate(() => Math.abs(car.y - centerY(rowOf(car.y))));
            expect(off).toBeLessThan(0.001);
        });

        test('a wall stops the car without ending the game', async ({ page }) => {
            await startQuiet(page);
            // Row 2 is guaranteed open end to end; drive left into the border wall.
            await placeCar(page, 3, 2, { x: -1, y: 0 });
            await advance(page, 240);
            const s = await page.evaluate(() => ({
                x: car.x, limit: centerX(1), state,
            }));
            expect(s.state).toBe('running');
            expect(s.x).toBeCloseTo(s.limit, 3);
        });

        test('a turn is taken at the next cell centre', async ({ page }) => {
            await startQuiet(page);
            await placeCar(page, 2, 2, { x: 1, y: 0 });
            await page.evaluate(() => {
                car.want = { x: 0, y: 1 };
            });
            await advance(page, 40);
            const s = await page.evaluate(() => ({ dir: car.dir, x: car.x, lane: centerX(colOf(car.x)) }));
            expect(s.dir).toEqual({ x: 0, y: 1 });
            expect(s.x).toBeCloseTo(s.lane, 5);
        });

        test('a turn into a wall is refused and the car keeps going', async ({ page }) => {
            await startQuiet(page);
            const s = await page.evaluate(() => {
                // Sit on a row-2 cell whose cell above is a pillar, then ask to
                // turn up into it. Done in one evaluate so the live animation
                // loop cannot drive the car into the next column first.
                let target = -1;
                for (let c = 2; c < COLS - 2; c++) if (!isOpen(c, 1)) { target = c; break; }
                if (target < 0) return { target };
                car.x = centerX(target);
                car.y = centerY(2);
                car.dir = { x: 1, y: 0 };
                car.want = { x: 0, y: -1 };
                for (let i = 0; i < 6; i++) step(1 / 60);
                return { target, dir: car.dir, y: car.y, lane: centerY(2), col: colOf(car.x) };
            });
            expect(s.target).toBeGreaterThan(0);
            expect(s.col).toBe(s.target);
            expect(s.dir).toEqual({ x: 1, y: 0 });
            expect(s.y).toBeCloseTo(s.lane, 5);
        });

        test('a reversal is immediate', async ({ page }) => {
            await startQuiet(page);
            await placeCar(page, 4, 2, { x: 1, y: 0 });
            await page.evaluate(() => {
                car.want = { x: -1, y: 0 };
            });
            await advance(page, 1);
            expect(await page.evaluate(() => car.dir)).toEqual({ x: -1, y: 0 });
        });

        test('the car never leaves the course', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                car.dir = { x: -1, y: 0 };
                car.want = { x: -1, y: 0 };
            });
            await advance(page, 120);
            await page.evaluate(() => {
                car.want = { x: 0, y: -1 };
            });
            await advance(page, 120);
            const inside = await page.evaluate(
                () => car.x > 0 && car.y > 0 && car.x < WORLD_W && car.y < WORLD_H
            );
            expect(inside).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Camera
    // -----------------------------------------------------------------------
    test.describe('camera', () => {
        test('the camera follows the car', async ({ page }) => {
            await startQuiet(page);
            const r = await page.evaluate(() => {
                car.x = centerX(2);
                car.y = centerY(2);
                car.dir = { x: 1, y: 0 };
                car.want = { x: 1, y: 0 };
                step(1 / 60);
                const near = camera.x;
                car.x = centerX(COLS - 3);
                step(1 / 60);
                return { near, far: camera.x };
            });
            expect(r.far).toBeGreaterThan(r.near);
        });

        test('the camera is clamped to the course bounds', async ({ page }) => {
            await startQuiet(page);
            const r = await page.evaluate(() => {
                car.x = centerX(2);
                car.y = centerY(2);
                car.dir = { x: -1, y: 0 };
                car.want = { x: -1, y: 0 };
                step(1 / 60);
                const topLeft = { x: camera.x, y: camera.y };
                car.x = centerX(COLS - 2);
                car.y = centerY(ROWS - 2);
                car.dir = { x: 1, y: 0 };
                car.want = { x: 1, y: 0 };
                step(1 / 60);
                return {
                    topLeft,
                    bottomRight: { x: camera.x, y: camera.y },
                    max: { x: WORLD_W - VIEW_W, y: WORLD_H - VIEW_H },
                };
            });
            expect(r.topLeft).toEqual({ x: 0, y: 0 });
            expect(r.bottomRight).toEqual(r.max);
        });
    });

    // -----------------------------------------------------------------------
    // Flags
    // -----------------------------------------------------------------------
    test.describe('flags', () => {
        test('driving over a flag collects it and scores', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const f = flags.find((x) => !x.special);
                car.x = f.x;
                car.y = f.y;
            });
            await advance(page, 1);
            const s = await page.evaluate(() => ({
                score, left: flags.filter((f) => !f.taken).length,
            }));
            expect(s.score).toBe(100);
            expect(s.left).toBe(9);
        });

        test('a collected flag cannot be collected twice', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const f = flags.find((x) => !x.special);
                car.x = f.x;
                car.y = f.y;
                car.dir = { x: 0, y: 0 };
                car.want = { x: 0, y: 0 };
            });
            await advance(page, 30);
            expect(await page.evaluate(() => score)).toBe(100);
        });

        test('the special flag doubles the value of later flags', async ({ page }) => {
            await startQuiet(page);
            const score1 = await page.evaluate(() => {
                const sp = flags.find((f) => f.special);
                car.x = sp.x;
                car.y = sp.y;
                step(1 / 60);
                return score;
            });
            expect(score1).toBe(100);

            const score2 = await page.evaluate(() => {
                const f = flags.find((x) => !x.taken);
                car.x = f.x;
                car.y = f.y;
                step(1 / 60);
                return score;
            });
            expect(score2).toBe(300);
        });

        test('the HUD shows how many flags are left', async ({ page }) => {
            await startQuiet(page);
            await expect(page.locator('#flags')).toHaveText('10');
            await page.evaluate(() => {
                const f = flags.find((x) => !x.taken);
                car.x = f.x;
                car.y = f.y;
                step(1 / 60);
            });
            await expect(page.locator('#flags')).toHaveText('9');
        });

        test('collecting every flag clears the level', async ({ page }) => {
            await startQuiet(page);
            const after = await page.evaluate(() => {
                for (const f of flags) {
                    car.x = f.x;
                    car.y = f.y;
                    step(1 / 60);
                }
                return { level, left: flags.filter((f) => !f.taken).length, fuel, state };
            });
            expect(after.level).toBe(2);
            expect(after.left).toBe(10);
            expect(after.fuel).toBe(100);
            expect(after.state).toBe('running');
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('clearing a level pays a bonus on top of the flags', async ({ page }) => {
            await startQuiet(page);
            const total = await page.evaluate(() => {
                for (const f of flags) {
                    car.x = f.x;
                    car.y = f.y;
                    step(1 / 60);
                }
                return score;
            });
            // 10 flags are worth at most 100 + 9*200 = 1900; the clear bonus adds more.
            expect(total).toBeGreaterThan(1900);
        });

        test('the next level is harder: more rivals, more boulders', async ({ page }) => {
            await page.evaluate(() => {
                setSeed(7);
                startGame();
            });
            const before = await page.evaluate(() => ({ e: enemies.length, k: rocks.length }));
            const after = await page.evaluate(() => {
                for (const f of flags) {
                    car.x = f.x;
                    car.y = f.y;
                    step(1 / 60);
                }
                return { e: enemies.length, k: rocks.length };
            });
            expect(after.e).toBeGreaterThan(before.e);
            expect(after.k).toBeGreaterThan(before.k);
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test('fuel drains while driving', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 60);
            const f = await page.evaluate(() => fuel);
            expect(f).toBeLessThan(100);
            expect(f).toBeGreaterThan(95);
        });

        test('fuel never goes below zero', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                fuel = 1;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => fuel)).toBe(0);
        });

        test('an empty tank slows the car down', async ({ page }) => {
            await startQuiet(page);
            const r = await page.evaluate(() => {
                const run = () => {
                    car.x = centerX(2);
                    car.y = centerY(2);
                    car.dir = { x: 0, y: 1 };
                    car.want = { x: 0, y: 1 };
                    const y0 = car.y;
                    for (let i = 0; i < 30; i++) step(1 / 60);
                    return car.y - y0;
                };
                fuel = 100;
                const full = run();
                fuel = 0;
                const empty = run();
                return { full, empty };
            });
            expect(r.empty).toBeLessThan(r.full * 0.8);
            expect(r.empty).toBeGreaterThan(0);
        });

        test('the fuel gauge is reported in the HUD', async ({ page }) => {
            await startQuiet(page);
            // Paused, so the live animation loop cannot drain the tank between
            // the write and the assertion.
            await page.evaluate(() => {
                togglePause();
                fuel = 100;
                updateHud();
            });
            await expect(page.locator('#fuel')).toHaveText('100');
            await page.evaluate(() => {
                fuel = 42;
                updateHud();
            });
            await expect(page.locator('#fuel')).toHaveText('42');
        });
    });

    // -----------------------------------------------------------------------
    // Smoke screen
    // -----------------------------------------------------------------------
    test.describe('smoke screen', () => {
        test('Space drops a puff of smoke behind the car', async ({ page }) => {
            await startQuiet(page);
            await placeCar(page, 4, 2, { x: 1, y: 0 });
            await page.keyboard.press('Space');
            await page.waitForFunction(() => smokes.length === 1);
            const behind = await page.evaluate(() => smokes[0].x < car.x);
            expect(behind).toBe(true);
        });

        test('smoke costs fuel', async ({ page }) => {
            await startQuiet(page);
            // Read back inside the same evaluate: the live animation loop drains
            // the tank between round trips.
            const left = await page.evaluate(() => {
                fuel = 50;
                dropSmoke();
                return fuel;
            });
            expect(left).toBe(44);
        });

        test('a cooldown stops smoke from being spammed', async ({ page }) => {
            await startQuiet(page);
            const n = await page.evaluate(() => {
                dropSmoke();
                dropSmoke();
                dropSmoke();
                return smokes.length;
            });
            expect(n).toBe(1);
        });

        test('smoke expires', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => dropSmoke());
            expect(await page.evaluate(() => smokes.length)).toBe(1);
            await advance(page, Math.ceil(1.6 * 60) + 10);
            expect(await page.evaluate(() => smokes.length)).toBe(0);
        });

        test('an empty tank produces no smoke', async ({ page }) => {
            await startQuiet(page);
            const n = await page.evaluate(() => {
                fuel = 0;
                dropSmoke();
                return smokes.length;
            });
            expect(n).toBe(0);
        });

        test('a rival that hits smoke spins out and scores', async ({ page }) => {
            await startQuiet(page);
            const s = await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemyAt(colOf(car.x) + 4, rowOf(car.y));
                const e = enemies[0];
                dropSmoke();
                smokes[0].x = e.x;
                smokes[0].y = e.y;
                step(1 / 60);
                return { spin: e.spin, score, smokes: smokes.length };
            });
            expect(s.spin).toBeGreaterThan(0);
            expect(s.score).toBe(200);
            expect(s.smokes).toBe(0);
        });

        test('a spun-out rival does not move', async ({ page }) => {
            await startQuiet(page);
            const moved = await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemyAt(colOf(car.x) + 6, rowOf(car.y));
                const e = enemies[0];
                e.spin = 3;
                const x0 = e.x, y0 = e.y;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return Math.hypot(e.x - x0, e.y - y0);
            });
            expect(moved).toBe(0);
        });

        test('a spun-out rival recovers and drives again', async ({ page }) => {
            await startQuiet(page);
            const after = await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemyAt(colOf(car.x) + 6, rowOf(car.y));
                const e = enemies[0];
                e.spin = 0.2;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { spin: e.spin };
            });
            expect(after.spin).toBe(0);
        });

        test('a spun-out rival is harmless to touch', async ({ page }) => {
            await startQuiet(page);
            const s = await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemyAt(colOf(car.x) + 6, rowOf(car.y));
                const e = enemies[0];
                e.spin = 3;
                e.x = car.x;
                e.y = car.y;
                step(1 / 60);
                return { lives, state };
            });
            expect(s.lives).toBe(3);
            expect(s.state).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Rivals and crashes
    // -----------------------------------------------------------------------
    test.describe('rivals', () => {
        test('rivals close in on the car', async ({ page }) => {
            await page.evaluate(() => {
                setSeed(11);
                startGame();
                car.dir = { x: 0, y: 0 };
                car.want = { x: 0, y: 0 };
                enemies.length = 1;
            });
            const before = await page.evaluate(() =>
                Math.hypot(enemies[0].x - car.x, enemies[0].y - car.y)
            );
            await advance(page, 180);
            const after = await page.evaluate(() =>
                enemies.length ? Math.hypot(enemies[0].x - car.x, enemies[0].y - car.y) : 0
            );
            expect(after).toBeLessThan(before);
        });

        test('rivals stay on open cells', async ({ page }) => {
            await page.evaluate(() => {
                setSeed(3);
                startGame();
            });
            await advance(page, 300);
            const bad = await page.evaluate(() =>
                enemies.filter((e) => !isOpen(colOf(e.x), rowOf(e.y))).length
            );
            expect(bad).toBe(0);
        });

        test('touching a rival costs a life', async ({ page }) => {
            await startQuiet(page);
            const s = await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemyAt(colOf(car.x) + 6, rowOf(car.y));
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(1 / 60);
                return { lives, state };
            });
            expect(s.lives).toBe(2);
            expect(s.state).toBe('crashed');
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('after a wreck the cars return to their start cells', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemyAt(colOf(car.x) + 6, rowOf(car.y));
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(1 / 60);
            });
            await advance(page, Math.ceil(1.2 * 60) + 10);
            const s = await page.evaluate(() => ({
                state, x: car.x, y: car.y, sx: centerX(SPAWN.c), sy: centerY(SPAWN.r),
            }));
            expect(s.state).toBe('running');
            expect(s.x).toBeCloseTo(s.sx, 5);
            expect(s.y).toBeCloseTo(s.sy, 5);
        });

        test('a wreck does not un-collect flags', async ({ page }) => {
            await startQuiet(page);
            const left = await page.evaluate(() => {
                const f = flags.find((x) => !x.taken);
                car.x = f.x;
                car.y = f.y;
                step(1 / 60);
                enemies.length = 0;
                spawnEnemyAt(colOf(car.x) + 6, rowOf(car.y));
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(1 / 60);
                return flags.filter((x) => !x.taken).length;
            });
            expect(left).toBe(9);
        });

        test('a wreck clears the smoke', async ({ page }) => {
            await startQuiet(page);
            const n = await page.evaluate(() => {
                dropSmoke();
                enemies.length = 0;
                spawnEnemyAt(colOf(car.x) + 6, rowOf(car.y));
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(1 / 60);
                return smokes.length;
            });
            expect(n).toBe(0);
        });

        test('the simulation is frozen while wrecked', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                enemies.length = 0;
                spawnEnemyAt(colOf(car.x) + 6, rowOf(car.y));
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(1 / 60);
            });
            const before = await page.evaluate(() => ({ x: car.x, y: car.y }));
            await advance(page, 20);
            const after = await page.evaluate(() => ({ x: car.x, y: car.y }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Boulders
    // -----------------------------------------------------------------------
    test.describe('boulders', () => {
        test('hitting a boulder costs a life', async ({ page }) => {
            await startQuiet(page);
            const s = await page.evaluate(() => {
                const k = rocks[0];
                car.x = k.x;
                car.y = k.y;
                step(1 / 60);
                return { lives, state };
            });
            expect(s.lives).toBe(2);
            expect(s.state).toBe('crashed');
        });

        // Boulders wreck the car, so a flag ringed by boulders would be an
        // uncollectable flag — and an unwinnable level. Every flag must be
        // reachable from the start without driving over one.
        test('boulders never wall a flag off', async ({ page }) => {
            const blocked = await page.evaluate(() => {
                const bad = [];
                for (let s = 1; s <= 40; s++) {
                    setSeed(s);
                    startGame();
                    for (let lv = 1; lv <= 5; lv++) {
                        const rockCells = new Set(rocks.map((k) => k.c + ',' + k.r));
                        const seen = new Set([SPAWN.c + ',' + SPAWN.r]);
                        const queue = [[SPAWN.c, SPAWN.r]];
                        while (queue.length) {
                            const [c, r] = queue.shift();
                            for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                                const nc = c + dc, nr = r + dr, key = nc + ',' + nr;
                                if (!isOpen(nc, nr) || seen.has(key) || rockCells.has(key)) continue;
                                seen.add(key);
                                queue.push([nc, nr]);
                            }
                        }
                        const walled = flags.filter((f) => !seen.has(f.c + ',' + f.r)).length;
                        if (walled) bad.push({ seed: s, level: lv, walled });
                        for (const f of flags) f.taken = true;
                        nextLevel();
                    }
                }
                return bad;
            });
            expect(blocked).toEqual([]);
        });

        test('boulders never sit on the spawn cell', async ({ page }) => {
            await startQuiet(page);
            const onSpawn = await page.evaluate(
                () => rocks.filter((k) => k.c === SPAWN.c && k.r === SPAWN.r).length
            );
            expect(onSpawn).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        const wreck = (page) =>
            page.evaluate(() => {
                enemies.length = 0;
                spawnEnemyAt(colOf(car.x) + 6, rowOf(car.y));
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(1 / 60);
            });

        test('losing the last life ends the game', async ({ page }) => {
            await startQuiet(page);
            for (let i = 0; i < 3; i++) {
                await wreck(page);
                await advance(page, Math.ceil(1.2 * 60) + 10);
            }
            expect(await page.evaluate(() => state)).toBe('over');
            expect(await page.evaluate(() => lives)).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the overlay reports the final score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 1234;
                lives = 1;
            });
            await wreck(page);
            await advance(page, 5);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('the best score is kept', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 4321;
                lives = 1;
            });
            await wreck(page);
            await advance(page, 5);
            await expect(page.locator('#best')).toHaveText('4321');
            const stored = await page.evaluate(() => localStorage.getItem('flagrally-best'));
            expect(stored).toBe('4321');
        });

        test('Space restarts after a game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
            });
            await wreck(page);
            await advance(page, 5);
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, lives, score, level }));
            expect(s).toEqual({ state: 'running', lives: 3, score: 0, level: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await startQuiet(page);
            await placeCar(page, 2, 2, { x: 1, y: 0 });
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ x: car.x, fuel }));
            await advance(page, 60);
            const after = await page.evaluate(() => ({ x: car.x, fuel }));
            expect(after).toEqual(before);
        });

        test('pausing an idle game does nothing', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });
});
