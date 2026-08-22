const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so a steering key press is confirmed against the game state before the
// simulation is advanced.
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

const steer = async (page, key) => {
    await page.keyboard.press(key);
    await page.waitForFunction(
        (want) => car.want.x === want.x && car.want.y === want.y,
        KEY_DIR[key]
    );
};

// Start a game with the pursuit cars removed, so long simulations stay
// deterministic. Specs that are about pursuers spawn their own.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        enemies.length = 0;
    });

test.describe('Rally Chase', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Rally Chase', async ({ page }) => {
            await expect(page).toHaveTitle('Rally Chase');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 720x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('the world is larger than the view on both axes', async ({ page }) => {
            const dims = await page.evaluate(() => ({
                ww: WORLD_W,
                wh: WORLD_H,
                vw: VIEW_W,
                vh: VIEW_H,
            }));
            expect(dims.ww).toBeGreaterThan(dims.vw);
            expect(dims.wh).toBeGreaterThan(dims.vh);
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
            await page.evaluate(() => window.localStorage.setItem('rallychase-best', '8600'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('8600');
        });

        test('no pursuers before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('step() does nothing while idle', async ({ page }) => {
            const before = await page.evaluate(() => ({ x: car.x, fuel }));
            await advance(page, 60);
            const after = await page.evaluate(() => ({ x: car.x, fuel }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // The circuit
    // -----------------------------------------------------------------------
    test.describe('circuit', () => {
        test('the outer ring is solid wall', async ({ page }) => {
            const sealed = await page.evaluate(() => {
                for (let c = 0; c < COLS; c++) {
                    if (isOpen(c, 0) || isOpen(c, ROWS - 1)) return false;
                }
                for (let r = 0; r < ROWS; r++) {
                    if (isOpen(0, r) || isOpen(COLS - 1, r)) return false;
                }
                return true;
            });
            expect(sealed).toBe(true);
        });

        test('every third row and column is an open corridor', async ({ page }) => {
            const clear = await page.evaluate(() => {
                for (let c = 1; c < COLS - 1; c++) {
                    for (let r = 1; r < ROWS - 1; r++) {
                        if ((c % 3 === 0 || r % 3 === 0) && !isOpen(c, r)) return false;
                    }
                }
                return true;
            });
            expect(clear).toBe(true);
        });

        test('every open cell is reachable from the start', async ({ page }) => {
            const result = await page.evaluate(() => {
                const seen = new Set();
                const key = (c, r) => c + ',' + r;
                const queue = [[START.col, START.row]];
                seen.add(key(START.col, START.row));
                while (queue.length) {
                    const [c, r] = queue.pop();
                    for (const [dc, dr] of [
                        [1, 0],
                        [-1, 0],
                        [0, 1],
                        [0, -1],
                    ]) {
                        const nc = c + dc;
                        const nr = r + dr;
                        if (isOpen(nc, nr) && !seen.has(key(nc, nr))) {
                            seen.add(key(nc, nr));
                            queue.push([nc, nr]);
                        }
                    }
                }
                let open = 0;
                for (let c = 0; c < COLS; c++) {
                    for (let r = 0; r < ROWS; r++) if (isOpen(c, r)) open++;
                }
                return { open, reached: seen.size };
            });
            expect(result.open).toBeGreaterThan(100);
            expect(result.reached).toBe(result.open);
        });

        test('the circuit is the same every time for a given level', async ({ page }) => {
            const snapshot = () =>
                page.evaluate(() => {
                    let s = '';
                    for (let r = 0; r < ROWS; r++) {
                        for (let c = 0; c < COLS; c++) s += isOpen(c, r) ? '.' : '#';
                    }
                    return s;
                });
            const first = await snapshot();
            await page.reload();
            expect(await snapshot()).toBe(first);
        });

        test('later levels have a different circuit', async ({ page }) => {
            const at = (lvl) =>
                page.evaluate((l) => {
                    buildLevel(l);
                    let s = '';
                    for (let r = 0; r < ROWS; r++) {
                        for (let c = 0; c < COLS; c++) s += isOpen(c, r) ? '.' : '#';
                    }
                    return s;
                }, lvl);
            expect(await at(1)).not.toBe(await at(2));
        });
    });

    // -----------------------------------------------------------------------
    // Flags
    // -----------------------------------------------------------------------
    test.describe('flag layout', () => {
        test('there are ten flags, none collected', async ({ page }) => {
            expect(await page.evaluate(() => flags.length)).toBe(10);
            expect(await page.evaluate(() => flags.every((f) => !f.taken))).toBe(true);
            expect(await page.evaluate(() => flagsLeft())).toBe(10);
        });

        test('every flag sits on an open cell', async ({ page }) => {
            expect(await page.evaluate(() => flags.every((f) => isOpen(f.col, f.row)))).toBe(true);
        });

        test('no two flags share a cell', async ({ page }) => {
            const unique = await page.evaluate(
                () => new Set(flags.map((f) => f.col + ',' + f.row)).size
            );
            expect(unique).toBe(10);
        });

        test('no flag is dropped on top of the start', async ({ page }) => {
            const near = await page.evaluate(() =>
                flags.filter(
                    (f) =>
                        Math.abs(f.col - START.col) <= 2 && Math.abs(f.row - START.row) <= 2
                )
            );
            expect(near).toEqual([]);
        });

        test('exactly one special flag and one fuel flag', async ({ page }) => {
            expect(await page.evaluate(() => flags.filter((f) => f.kind === 'special').length)).toBe(
                1
            );
            expect(await page.evaluate(() => flags.filter((f) => f.kind === 'fuel').length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the car starts still, on the start cell', async ({ page }) => {
            await startQuiet(page);
            const c = await page.evaluate(() => ({
                col: car.col,
                row: car.row,
                dx: car.dir.x,
                dy: car.dir.y,
            }));
            expect(c).toEqual({ col: 12, row: 6, dx: 0, dy: 0 });
        });

        test('level one starts three pursuers on open cells', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => enemies.length)).toBe(3);
            expect(await page.evaluate(() => enemies.every((e) => isOpen(e.col, e.row)))).toBe(true);
        });

        test('the tank starts full', async ({ page }) => {
            // Read inside the same evaluate as the start: the page's real
            // animation loop is draining fuel between statements.
            const startingFuel = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                return fuel;
            });
            expect(startingFuel).toBe(await page.evaluate(() => FUEL_MAX));
        });
    });

    // -----------------------------------------------------------------------
    // Driving
    // -----------------------------------------------------------------------
    test.describe('driving', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('pressing right drives the car right', async ({ page }) => {
            const before = await page.evaluate(() => car.x);
            await steer(page, 'ArrowRight');
            await advance(page, 30);
            expect(await page.evaluate(() => car.x)).toBeGreaterThan(before);
        });

        test('pressing up drives the car up', async ({ page }) => {
            const before = await page.evaluate(() => car.y);
            await steer(page, 'ArrowUp');
            await advance(page, 30);
            expect(await page.evaluate(() => car.y)).toBeLessThan(before);
        });

        test('W A S D also steer the car', async ({ page }) => {
            const before = await page.evaluate(() => car.x);
            await steer(page, 'a');
            await advance(page, 30);
            expect(await page.evaluate(() => car.x)).toBeLessThan(before);
        });

        test('a steering input is remembered until the turn is possible', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(12, 6);
                car.want = { x: 1, y: 0 };
                step(1 / 60);
                car.want = { x: 0, y: -1 };
            });
            await advance(page, 120);
            expect(await page.evaluate(() => car.dir.y)).toBe(-1);
            expect(await page.evaluate(() => car.y)).toBeLessThan(
                await page.evaluate(() => cellCenterY(6))
            );
        });

        test('the car stops at the wall it drives into', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(12, 6);
                car.want = { x: 0, y: -1 };
            });
            await advance(page, 600);
            const c = await page.evaluate(() => ({ row: car.row, y: car.y }));
            expect(c.row).toBe(1);
            expect(c.y).toBe(await page.evaluate(() => cellCenterY(1)));
        });

        test('the car never leaves the circuit', async ({ page }) => {
            const inside = await page.evaluate(() => {
                placeCar(12, 6);
                const dirs = [
                    { x: 1, y: 0 },
                    { x: 0, y: 1 },
                    { x: -1, y: 0 },
                    { x: 0, y: -1 },
                ];
                for (let i = 0; i < 1200; i++) {
                    car.want = dirs[i % 4];
                    step(1 / 60);
                    if (car.x < CELL || car.x > WORLD_W - CELL) return false;
                    if (car.y < CELL || car.y > WORLD_H - CELL) return false;
                    if (!isOpen(Math.floor(car.x / CELL), Math.floor(car.y / CELL))) return false;
                }
                return true;
            });
            expect(inside).toBe(true);
        });

        test('reversing works part-way down a corridor', async ({ page }) => {
            const result = await page.evaluate(() => {
                placeCar(12, 6);
                car.want = { x: 1, y: 0 };
                for (let i = 0; i < 8; i++) step(1 / 60);
                const mid = car.x;
                car.want = { x: -1, y: 0 };
                for (let i = 0; i < 4; i++) step(1 / 60);
                return { mid, after: car.x, dir: car.dir.x };
            });
            expect(result.dir).toBe(-1);
            expect(result.after).toBeLessThan(result.mid);
        });

        test('the car keeps its heading after being blocked', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(12, 6);
                car.want = { x: 0, y: -1 };
                for (let i = 0; i < 600; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => car.dir.y)).toBe(-1);
            await page.evaluate(() => {
                car.want = { x: 0, y: 1 };
            });
            await advance(page, 30);
            expect(await page.evaluate(() => car.dir.y)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Camera
    // -----------------------------------------------------------------------
    test.describe('camera', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the camera centres on the car in open ground', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(12, 6);
                step(1 / 60);
            });
            const cam = await page.evaluate(() => ({ x: camera.x, y: camera.y, cx: car.x, cy: car.y }));
            expect(cam.x).toBeCloseTo(cam.cx - 560 / 2, 5);
            expect(cam.y).toBeCloseTo(cam.cy - 480 / 2, 5);
        });

        test('the camera is clamped at the top-left corner', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(1, 1);
                step(1 / 60);
            });
            expect(await page.evaluate(() => camera.x)).toBe(0);
            expect(await page.evaluate(() => camera.y)).toBe(0);
        });

        test('the camera is clamped at the bottom-right corner', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(COLS - 2, ROWS - 2);
                step(1 / 60);
            });
            expect(await page.evaluate(() => camera.x)).toBe(
                await page.evaluate(() => WORLD_W - VIEW_W)
            );
            expect(await page.evaluate(() => camera.y)).toBe(
                await page.evaluate(() => WORLD_H - VIEW_H)
            );
        });

        test('the camera scrolls as the car drives', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(3, 6);
                step(1 / 60);
            });
            const before = await page.evaluate(() => camera.x);
            await page.evaluate(() => {
                car.want = { x: 1, y: 0 };
                for (let i = 0; i < 180; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => camera.x)).toBeGreaterThan(before);
        });
    });

    // -----------------------------------------------------------------------
    // Collecting flags
    // -----------------------------------------------------------------------
    test.describe('flags', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('driving onto a flag collects it and scores', async ({ page }) => {
            await page.evaluate(() => {
                const f = flags.find((x) => x.kind === 'flag');
                placeCar(f.col, f.row);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => flagsLeft())).toBe(9);
            expect(await page.evaluate(() => score)).toBe(100);
            await expect(page.locator('#flags')).toHaveText('9');
        });

        test('a collected flag cannot be collected twice', async ({ page }) => {
            await page.evaluate(() => {
                const f = flags.find((x) => x.kind === 'flag');
                placeCar(f.col, f.row);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => score)).toBe(100);
            expect(await page.evaluate(() => flagsLeft())).toBe(9);
        });

        test('the special flag doubles the value of later flags', async ({ page }) => {
            const result = await page.evaluate(() => {
                const special = flags.find((f) => f.kind === 'special');
                placeCar(special.col, special.row);
                step(1 / 60);
                const afterSpecial = score;
                const plain = flags.find((f) => f.kind === 'flag' && !f.taken);
                placeCar(plain.col, plain.row);
                step(1 / 60);
                return { multiplier: flagMultiplier, gain: score - afterSpecial };
            });
            expect(result.multiplier).toBe(2);
            expect(result.gain).toBe(200);
        });

        test('the multiplier is capped', async ({ page }) => {
            await page.evaluate(() => {
                flagMultiplier = 4;
                const special = flags.find((f) => f.kind === 'special');
                placeCar(special.col, special.row);
                step(1 / 60);
            });
            expect(await page.evaluate(() => flagMultiplier)).toBe(4);
        });

        test('the fuel flag refills the tank', async ({ page }) => {
            const result = await page.evaluate(() => {
                fuel = 20;
                const f = flags.find((x) => x.kind === 'fuel');
                placeCar(f.col, f.row);
                step(1 / 60);
                return fuel;
            });
            expect(result).toBeGreaterThan(55);
        });

        test('the fuel flag cannot overfill the tank', async ({ page }) => {
            await page.evaluate(() => {
                const f = flags.find((x) => x.kind === 'fuel');
                placeCar(f.col, f.row);
                step(1 / 60);
            });
            expect(await page.evaluate(() => fuel)).toBeLessThanOrEqual(
                await page.evaluate(() => FUEL_MAX)
            );
        });

        test('collecting every flag clears the level', async ({ page }) => {
            await page.evaluate(() => collectAllFlagsForTest());
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('fuel drains while driving', async ({ page }) => {
            await advance(page, 120);
            expect(await page.evaluate(() => fuel)).toBeLessThan(
                await page.evaluate(() => FUEL_MAX)
            );
        });

        test('the HUD tracks the tank', async ({ page }) => {
            await advance(page, 300);
            const shown = await page.locator('#fuel').textContent();
            expect(Number(shown)).toBe(await page.evaluate(() => Math.ceil(fuel)));
        });

        test('fuel does not drain while paused', async ({ page }) => {
            await page.evaluate(() => togglePause());
            const before = await page.evaluate(() => fuel);
            await advance(page, 120);
            expect(await page.evaluate(() => fuel)).toBe(before);
        });

        test('fuel never goes negative', async ({ page }) => {
            await advance(page, 60 * 90);
            expect(await page.evaluate(() => fuel)).toBe(0);
        });

        test('an empty tank slows the car down', async ({ page }) => {
            const full = await page.evaluate(() => carSpeed());
            await page.evaluate(() => {
                fuel = 0;
            });
            expect(await page.evaluate(() => carSpeed())).toBeLessThan(full);
        });

        test('an empty car is slower than the pursuers', async ({ page }) => {
            await page.evaluate(() => {
                fuel = 0;
            });
            expect(await page.evaluate(() => carSpeed())).toBeLessThan(
                await page.evaluate(() => enemySpeed())
            );
        });
    });

    // -----------------------------------------------------------------------
    // Smoke
    // -----------------------------------------------------------------------
    test.describe('smoke', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space drops a puff and burns fuel', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => smokes.length === 1);
            expect(await page.evaluate(() => fuel)).toBeLessThan(
                await page.evaluate(() => FUEL_MAX)
            );
        });

        test('the puff is dropped at the car', async ({ page }) => {
            await page.evaluate(() => dropSmoke());
            const p = await page.evaluate(() => ({
                sx: smokes[0].x,
                sy: smokes[0].y,
                cx: car.x,
                cy: car.y,
            }));
            expect(p.sx).toBeCloseTo(p.cx, 5);
            expect(p.sy).toBeCloseTo(p.cy, 5);
        });

        test('a puff fades away', async ({ page }) => {
            await page.evaluate(() => dropSmoke());
            await advance(page, 60 * 5);
            expect(await page.evaluate(() => smokes.length)).toBe(0);
        });

        test('smoke needs fuel in the tank', async ({ page }) => {
            const result = await page.evaluate(() => {
                fuel = 1;
                dropSmoke();
                return { puffs: smokes.length, fuel: fuel };
            });
            expect(result).toEqual({ puffs: 0, fuel: 1 });
        });

        test('a pursuer driving through smoke spins out', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(12, 6);
                dropSmoke();
                spawnEnemy(12, 6);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => enemies[0].state)).toBe('spun');
        });

        test('spinning a pursuer scores points', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(12, 6);
                dropSmoke();
                spawnEnemy(12, 6);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => score)).toBe(200);
        });

        test('one puff can spin two pursuers', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(12, 6);
                dropSmoke();
                spawnEnemy(12, 6);
                spawnEnemy(12, 6);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => enemies.every((e) => e.state === 'spun'))).toBe(true);
        });

        test('a spun pursuer does not move', async ({ page }) => {
            const before = await page.evaluate(() => {
                placeCar(12, 6);
                dropSmoke();
                const e = spawnEnemy(12, 6);
                step(1 / 60);
                return { x: e.x, y: e.y };
            });
            await advance(page, 60);
            const after = await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }));
            expect(after).toEqual(before);
        });

        test('a spun pursuer cannot cost a life', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(12, 6);
                dropSmoke();
                spawnEnemy(12, 6);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a spin wears off', async ({ page }) => {
            const result = await page.evaluate(() => {
                placeCar(12, 6);
                dropSmoke();
                const e = spawnEnemy(3, 3);
                e.x = car.x;
                e.y = car.y;
                step(1 / 60);
                const spun = e.state;
                // Park the car far away so the pursuer cannot reach it while the
                // spin runs out.
                placeCar(COLS - 2, ROWS - 2);
                smokes.length = 0;
                let elapsed = 0;
                while (elapsed < 8 && e.state === 'spun') {
                    step(1 / 60);
                    elapsed += 1 / 60;
                }
                return { spun, after: e.state, elapsed };
            });
            expect(result.spun).toBe('spun');
            expect(result.after).toBe('active');
            expect(result.elapsed).toBeGreaterThan(2.5);
        });

        test('an already spun pursuer is not scored twice', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(12, 6);
                dropSmoke();
                spawnEnemy(12, 6);
            });
            await advance(page, 90);
            expect(await page.evaluate(() => score)).toBe(200);
        });
    });

    // -----------------------------------------------------------------------
    // Pursuers
    // -----------------------------------------------------------------------
    test.describe('pursuers', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a pursuer closes in on the car', async ({ page }) => {
            const gap = await page.evaluate(() => {
                placeCar(3, 3);
                const e = spawnEnemy(18, 12);
                return Math.hypot(e.x - car.x, e.y - car.y);
            });
            await advance(page, 240);
            const after = await page.evaluate(() =>
                Math.hypot(enemies[0].x - car.x, enemies[0].y - car.y)
            );
            expect(after).toBeLessThan(gap);
        });

        test('pursuers stay on the circuit', async ({ page }) => {
            const inside = await page.evaluate(() => {
                placeCar(3, 3);
                spawnEnemy(18, 12);
                spawnEnemy(18, 3);
                for (let i = 0; i < 600; i++) {
                    step(1 / 60);
                    if (state !== 'running') return true;
                    for (const e of enemies) {
                        if (!isOpen(Math.floor(e.x / CELL), Math.floor(e.y / CELL))) return false;
                    }
                }
                return true;
            });
            expect(inside).toBe(true);
        });

        test('touching a pursuer costs a life', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(12, 6);
                spawnEnemy(12, 6);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('the car returns to the start after a crash', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(12, 6);
                spawnEnemy(12, 6);
            });
            await advance(page, 200);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => car.col)).toBe(await page.evaluate(() => START.col));
            expect(await page.evaluate(() => car.row)).toBe(await page.evaluate(() => START.row));
        });

        test('a crash refills the tank', async ({ page }) => {
            await page.evaluate(() => {
                fuel = 12;
                placeCar(12, 6);
                spawnEnemy(12, 6);
            });
            await advance(page, 200);
            // The page's own animation loop drains a little fuel between
            // statements, so this asserts the tank was refilled, not that it is
            // untouched.
            expect(await page.evaluate(() => fuel)).toBeGreaterThan(90);
        });

        test('collected flags survive a crash', async ({ page }) => {
            await page.evaluate(() => {
                const f = flags.find((x) => x.kind === 'flag');
                placeCar(f.col, f.row);
                step(1 / 60);
                placeCar(12, 6);
                spawnEnemy(12, 6);
            });
            await advance(page, 200);
            expect(await page.evaluate(() => flagsLeft())).toBe(9);
            expect(await page.evaluate(() => score)).toBe(100);
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                placeCar(12, 6);
                spawnEnemy(12, 6);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(0);
            await advance(page, 200);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('nothing hurts the car while it is crashing', async ({ page }) => {
            await page.evaluate(() => {
                placeCar(12, 6);
                spawnEnemy(12, 6);
                spawnEnemy(12, 6);
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('clearing a level starts the next one', async ({ page }) => {
            await page.evaluate(() => collectAllFlagsForTest());
            await advance(page, 200);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => flagsLeft())).toBe(10);
            expect(await page.evaluate(() => fuel)).toBeGreaterThan(90);
        });

        test('the multiplier resets with the level', async ({ page }) => {
            await page.evaluate(() => {
                flagMultiplier = 4;
                collectAllFlagsForTest();
            });
            await advance(page, 200);
            expect(await page.evaluate(() => flagMultiplier)).toBe(1);
        });

        test('leftover fuel pays a bonus', async ({ page }) => {
            const gained = await page.evaluate(() => {
                score = 0;
                fuel = 50;
                collectAllFlagsForTest();
                step(1 / 60);
                return score;
            });
            expect(gained).toBeGreaterThanOrEqual(500);
        });

        test('score carries into the next level', async ({ page }) => {
            await page.evaluate(() => {
                collectAllFlagsForTest();
            });
            await advance(page, 2);
            const carried = await page.evaluate(() => score);
            await advance(page, 200);
            expect(await page.evaluate(() => score)).toBe(carried);
        });

        test('pursuers get faster each level', async ({ page }) => {
            const l1 = await page.evaluate(() => enemySpeed());
            await page.evaluate(() => {
                level = 5;
            });
            expect(await page.evaluate(() => enemySpeed())).toBeGreaterThan(l1);
        });

        test('pursuers never outrun a fuelled car', async ({ page }) => {
            await page.evaluate(() => {
                level = 60;
            });
            expect(await page.evaluate(() => enemySpeed())).toBeLessThan(
                await page.evaluate(() => CAR_SPEED)
            );
        });

        test('later levels field more pursuers, up to a cap', async ({ page }) => {
            expect(await page.evaluate(() => enemyCount(1))).toBe(3);
            expect(await page.evaluate(() => enemyCount(3))).toBeGreaterThan(
                await page.evaluate(() => enemyCount(1))
            );
            expect(await page.evaluate(() => enemyCount(50))).toBe(6);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                car.want = { x: 1, y: 0 };
                step(1 / 60);
                togglePause();
            });
            const before = await page.evaluate(() => car.x);
            await advance(page, 60);
            expect(await page.evaluate(() => car.x)).toBe(before);
        });

        test('smoke cannot be dropped while paused', async ({ page }) => {
            await page.evaluate(() => {
                togglePause();
                dropSmoke();
            });
            expect(await page.evaluate(() => smokes.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('a new best is stored on game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 5150;
                lives = 1;
                placeCar(12, 6);
                spawnEnemy(12, 6);
            });
            await advance(page, 220);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#best')).toHaveText('5150');
            expect(await page.evaluate(() => window.localStorage.getItem('rallychase-best'))).toBe(
                '5150'
            );
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('rallychase-best', '9999'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 10;
                lives = 1;
                placeCar(12, 6);
                spawnEnemy(12, 6);
            });
            await advance(page, 220);
            await expect(page.locator('#best')).toHaveText('9999');
        });

        test('restarting after game over resets the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 600;
                lives = 1;
                level = 3;
                placeCar(12, 6);
                spawnEnemy(12, 6);
            });
            await advance(page, 220);
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => flagsLeft())).toBe(10);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the view is painted', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 30);
            const painted = await page.evaluate(() => {
                draw();
                const d = ctx.getImageData(0, 0, VIEW_W, CANVAS_H).data;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i] > 30 || d[i + 1] > 30 || d[i + 2] > 30) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the radar panel is painted', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 30);
            const painted = await page.evaluate(() => {
                draw();
                const d = ctx.getImageData(VIEW_W, 0, RADAR_W, CANVAS_H).data;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i] > 30 || d[i + 1] > 30 || d[i + 2] > 30) return true;
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
                dropSmoke();
                for (let i = 0; i < 120; i++) step(1 / 60);
                draw(); // running
                togglePause();
                draw(); // paused
                togglePause();
                lives = 1;
                enemies.length = 0;
                placeCar(12, 6);
                spawnEnemy(12, 6);
                step(1 / 60);
                draw(); // crashing
                for (let i = 0; i < 200; i++) step(1 / 60);
                draw(); // over
                startGame();
                enemies.length = 0;
                collectAllFlagsForTest();
                step(1 / 60);
                draw(); // level clear
                for (let i = 0; i < 200; i++) step(1 / 60);
                draw();
            });
            expect(errors).toEqual([]);
        });
    });
});
