const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a run with a fixed maze seed, the chasers frozen and the rAF pump
// switched off, so the specs are the only source of simulated time.
const startQuiet = (page, seed = 1234) =>
    page.evaluate((s) => {
        autoStep = false;
        setSeed(s);
        startGame();
        enemiesEnabled = false;
    }, seed);

// Same, but with the chasers live — for the specs that are about them.
const startWithChasers = (page, seed = 1234) =>
    page.evaluate((s) => {
        autoStep = false;
        setSeed(s);
        startGame();
    }, seed);

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so key presses are confirmed against the game state before the
// simulation is advanced.
const KEY_DIR = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
};

const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction(
        (want) => car.want.x === want.x && car.want.y === want.y,
        KEY_DIR[key]
    );
};

test.describe('Rally-X', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Rally-X', async ({ page }) => {
            await expect(page).toHaveTitle('Rally-X');
        });

        test('canvas is 608x448', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '608');
            await expect(canvas).toHaveAttribute('height', '448');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level, lives and flags', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#flags')).toHaveText('10');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('rallyx-best', '7300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7300');
        });
    });

    // -----------------------------------------------------------------------
    // Maze
    // -----------------------------------------------------------------------
    test.describe('maze', () => {
        test('is walled all the way around', async ({ page }) => {
            const sealed = await page.evaluate(() => {
                for (let c = 0; c < COLS; c++) {
                    if (!isWall(c, 0) || !isWall(c, ROWS - 1)) return false;
                }
                for (let r = 0; r < ROWS; r++) {
                    if (!isWall(0, r) || !isWall(COLS - 1, r)) return false;
                }
                return true;
            });
            expect(sealed).toBe(true);
        });

        test('the same seed rebuilds the same maze', async ({ page }) => {
            const [a, b] = await page.evaluate(() => {
                setSeed(99);
                resetLevel();
                const first = maze.map((row) => row.join('')).join('|');
                setSeed(99);
                resetLevel();
                const second = maze.map((row) => row.join('')).join('|');
                return [first, second];
            });
            expect(a).toBe(b);
        });

        test('different seeds give different mazes', async ({ page }) => {
            const [a, b] = await page.evaluate(() => {
                setSeed(1);
                resetLevel();
                const first = maze.map((row) => row.join('')).join('|');
                setSeed(2);
                resetLevel();
                const second = maze.map((row) => row.join('')).join('|');
                return [first, second];
            });
            expect(a).not.toBe(b);
        });

        test('every open tile is reachable from the car start', async ({ page }) => {
            const unreachable = await page.evaluate(() => {
                setSeed(4242);
                resetLevel();
                const seen = new Set();
                const key = (c, r) => r * COLS + c;
                const stack = [[colOf(car.x), rowOf(car.y)]];
                seen.add(key(stack[0][0], stack[0][1]));
                while (stack.length) {
                    const [c, r] = stack.pop();
                    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nc = c + dc, nr = r + dr;
                        if (isWall(nc, nr) || seen.has(key(nc, nr))) continue;
                        seen.add(key(nc, nr));
                        stack.push([nc, nr]);
                    }
                }
                let open = 0;
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) if (!isWall(c, r)) open++;
                }
                return open - seen.size;
            });
            expect(unreachable).toBe(0);
        });

        test('the car starts on an open tile', async ({ page }) => {
            expect(await page.evaluate(() => isWall(colOf(car.x), rowOf(car.y)))).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Flags
    // -----------------------------------------------------------------------
    test.describe('flags', () => {
        test('ten flags are placed on open tiles', async ({ page }) => {
            await startQuiet(page);
            const info = await page.evaluate(() => ({
                count: flags.length,
                allOpen: flags.every((f) => !isWall(f.col, f.row)),
                onCar: flags.some((f) => f.col === colOf(car.x) && f.row === rowOf(car.y)),
            }));
            expect(info.count).toBe(10);
            expect(info.allOpen).toBe(true);
            expect(info.onCar).toBe(false);
        });

        test('exactly one flag is the special flag', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => flags.filter((f) => f.special).length)).toBe(1);
        });

        test('flags are spread out across the maze', async ({ page }) => {
            await startQuiet(page);
            const minGap = await page.evaluate(() => {
                let m = Infinity;
                for (let i = 0; i < flags.length; i++) {
                    for (let j = i + 1; j < flags.length; j++) {
                        const d = Math.abs(flags[i].col - flags[j].col) +
                            Math.abs(flags[i].row - flags[j].row);
                        if (d < m) m = d;
                    }
                }
                return m;
            });
            expect(minGap).toBeGreaterThanOrEqual(3);
        });

        test('driving onto a flag scores 100 and removes it', async ({ page }) => {
            await startQuiet(page);
            const result = await page.evaluate(() => {
                const f = flags.find((x) => !x.special);
                placeCar(f.col, f.row);
                step(1 / 60);
                return { score, left: flags.length };
            });
            expect(result.score).toBe(100);
            expect(result.left).toBe(9);
            await expect(page.locator('#flags')).toHaveText('9');
        });

        test('the special flag doubles the value of later flags', async ({ page }) => {
            await startQuiet(page);
            const result = await page.evaluate(() => {
                const special = flags.find((x) => x.special);
                placeCar(special.col, special.row);
                step(1 / 60);
                const afterSpecial = score;
                const plain = flags.find((x) => !x.special);
                placeCar(plain.col, plain.row);
                step(1 / 60);
                return { afterSpecial, afterPlain: score };
            });
            expect(result.afterSpecial).toBe(100);
            expect(result.afterPlain).toBe(300); // 100 + doubled 200
        });

        test('taking every flag clears the level and starts the next one', async ({ page }) => {
            await startQuiet(page);
            const cleared = await page.evaluate(() => {
                while (flags.length) {
                    placeCar(flags[0].col, flags[0].row);
                    step(1 / 60);
                }
                return state;
            });
            expect(cleared).toBe('levelclear');

            await advance(page, 200);
            const after = await page.evaluate(() => ({
                state, level, flags: flags.length, fuel,
            }));
            expect(after.state).toBe('running');
            expect(after.level).toBe(2);
            expect(after.flags).toBe(10);
            expect(after.fuel).toBeGreaterThan(90);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('clearing a level pays a bonus for the fuel left in the tank', async ({ page }) => {
            await startQuiet(page);
            const gained = await page.evaluate(() => {
                while (flags.length) {
                    placeCar(flags[0].col, flags[0].row);
                    step(1 / 60);
                }
                const beforeBonus = score;
                const expected = Math.round(fuel) * FUEL_BONUS_PER_UNIT;
                for (let i = 0; i < 200; i++) step(1 / 60);
                return { delta: score - beforeBonus, expected };
            });
            expect(gained.expected).toBeGreaterThan(0);
            expect(gained.delta).toBe(gained.expected);
        });
    });

    // -----------------------------------------------------------------------
    // Driving
    // -----------------------------------------------------------------------
    test.describe('driving', () => {
        test('the arrow keys steer the car', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => car.x);
            await hold(page, 'ArrowRight');
            await advance(page, 20);
            expect(await page.evaluate(() => car.x)).toBeGreaterThan(before);
            await page.keyboard.up('ArrowRight');
        });

        test('WASD steers the car too', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => car.y);
            await page.keyboard.down('s');
            await page.waitForFunction(() => car.want.y === 1);
            await advance(page, 20);
            expect(await page.evaluate(() => car.y)).toBeGreaterThan(before);
            await page.keyboard.up('s');
        });

        test('the car cannot drive through a wall', async ({ page }) => {
            await startQuiet(page);
            const result = await page.evaluate(() => {
                // Drive right into a dead end: an open tile whose right-hand
                // neighbour is a wall, approached from the tile before it.
                for (let r = 1; r < ROWS - 1; r++) {
                    for (let c = 2; c < COLS - 1; c++) {
                        if (isWall(c, r) || !isWall(c + 1, r) || isWall(c - 1, r)) continue;
                        placeCar(c - 1, r);
                        car.want = { x: 1, y: 0 };
                        for (let i = 0; i < 60; i++) step(1 / 60);
                        return {
                            x: car.x,
                            stopAt: tileCenter(c),
                            tileWall: isWall(colOf(car.x), rowOf(car.y)),
                        };
                    }
                }
                return null;
            });
            expect(result).not.toBeNull();
            expect(result.tileWall).toBe(false);
            expect(Math.abs(result.x - result.stopAt)).toBeLessThan(0.51);
        });

        test('a turn is queued until the car reaches a tile where it is legal', async ({ page }) => {
            await startQuiet(page);
            const result = await page.evaluate(() => {
                // A tile where up is blocked, but up is open one tile to the right.
                for (let r = 2; r < ROWS - 1; r++) {
                    for (let c = 1; c < COLS - 2; c++) {
                        if (isWall(c, r) || isWall(c, r - 1)) continue;      // up open here
                        if (isWall(c + 1, r) || !isWall(c + 1, r - 1)) continue; // blocked one to the right
                        // Drive right from (c+1, r) with up wanted: it must not turn
                        // there, but must turn when it gets back to a tile with an
                        // opening. Start at (c+1,r) heading left instead: simpler and
                        // symmetric — up is open at (c, r).
                        placeCar(c + 1, r);
                        car.dir = { x: -1, y: 0 };
                        car.want = { x: 0, y: -1 };
                        step(1 / 60);
                        const turnedImmediately = car.dir.y === -1;
                        for (let i = 0; i < 60; i++) step(1 / 60);
                        return { turnedImmediately, dirY: car.dir.y, row: rowOf(car.y) , startRow: r};
                    }
                }
                return null;
            });
            expect(result).not.toBeNull();
            expect(result.turnedImmediately).toBe(false);
            expect(result.dirY).toBe(-1);
            expect(result.row).toBeLessThan(result.startRow);
        });

        test('the car never ends up inside a wall while driving', async ({ page }) => {
            await startQuiet(page);
            const inWall = await page.evaluate(() => {
                let bad = 0;
                const dirs = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
                for (let i = 0; i < 1200; i++) {
                    if (i % 37 === 0) car.want = dirs[(i / 37) % 4 | 0];
                    step(1 / 60);
                    if (isWall(colOf(car.x), rowOf(car.y))) bad++;
                }
                return bad;
            });
            expect(inWall).toBe(0);
        });

        test('the camera follows the car and stays inside the world', async ({ page }) => {
            await startQuiet(page);
            const cam = await page.evaluate(() => {
                placeCar(1, 1);
                step(1 / 60);
                const topLeft = { x: camera.x, y: camera.y };
                placeCar(COLS - 2, ROWS - 2);
                step(1 / 60);
                return { topLeft, bottomRight: { x: camera.x, y: camera.y } };
            });
            expect(cam.topLeft).toEqual({ x: 0, y: 0 });
            expect(cam.bottomRight.x).toBeGreaterThan(0);
            expect(cam.bottomRight.x).toBeLessThanOrEqual(768 - 448);
            expect(cam.bottomRight.y).toBeLessThanOrEqual(768 - 448);
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test('starts full and drains while driving', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => fuel)).toBe(100);
            await advance(page, 120);
            const left = await page.evaluate(() => fuel);
            expect(left).toBeLessThan(100);
            expect(left).toBeGreaterThan(90);
        });

        test('the fuel gauge shrinks as the tank empties', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { fuel = 50; updateHud(); });
            const width = await page.locator('#fuel-fill').evaluate((el) => el.style.width);
            expect(width).toBe('50%');
        });

        test('running out of fuel costs a life', async ({ page }) => {
            await startQuiet(page);
            const result = await page.evaluate(() => {
                fuel = 0.01;
                step(1 / 60);
                return { state, lives, fuel };
            });
            expect(result.state).toBe('dying');
            expect(result.lives).toBe(2);
            expect(result.fuel).toBe(0);
        });

        test('fuel is refilled after a life is lost', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { fuel = 0.01; step(1 / 60); });
            await advance(page, 200);
            const after = await page.evaluate(() => ({ state, fuel }));
            expect(after.state).toBe('running');
            expect(after.fuel).toBeGreaterThan(90);
        });
    });

    // -----------------------------------------------------------------------
    // Smoke screen
    // -----------------------------------------------------------------------
    test.describe('smoke screen', () => {
        test('space drops a cloud and burns fuel', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => fuel);
            await page.keyboard.press(' ');
            await page.waitForFunction(() => smokes.length === 1);
            const after = await page.evaluate(() => fuel);
            expect(before - after).toBeCloseTo(await page.evaluate(() => SMOKE_COST), 5);
        });

        test('a cloud fades away after a few seconds', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => dropSmoke());
            expect(await page.evaluate(() => smokes.length)).toBe(1);
            await advance(page, 60 * 5);
            expect(await page.evaluate(() => smokes.length)).toBe(0);
        });

        test('no smoke without enough fuel in the tank', async ({ page }) => {
            await startQuiet(page);
            const dropped = await page.evaluate(() => {
                fuel = SMOKE_COST / 2;
                dropSmoke();
                return smokes.length;
            });
            expect(dropped).toBe(0);
        });

        test('a chaser that hits the smoke spins out and scores', async ({ page }) => {
            await startWithChasers(page);
            const result = await page.evaluate(() => {
                const c = colOf(car.x), r = rowOf(car.y);
                dropSmoke();
                // Move the car out of the way so this is about the smoke only.
                placeCar(COLS - 2, ROWS - 2);
                placeEnemy(0, c, r);
                step(1 / 60);
                const stunned = enemies[0].stun;
                const at = { x: enemies[0].x, y: enemies[0].y };
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { stunned, score, moved: Math.hypot(enemies[0].x - at.x, enemies[0].y - at.y) };
            });
            expect(result.stunned).toBeGreaterThan(0);
            expect(result.score).toBe(200);
            expect(result.moved).toBeLessThan(0.001);
        });
    });

    // -----------------------------------------------------------------------
    // Chasers
    // -----------------------------------------------------------------------
    test.describe('chasers', () => {
        test('three chasers are on the board at level 1', async ({ page }) => {
            await startWithChasers(page);
            expect(await page.evaluate(() => enemies.length)).toBe(3);
        });

        test('chasers start on open tiles away from the car', async ({ page }) => {
            await startWithChasers(page);
            const ok = await page.evaluate(() =>
                enemies.every((e) =>
                    !isWall(colOf(e.x), rowOf(e.y)) &&
                    Math.hypot(e.x - car.x, e.y - car.y) > 200
                )
            );
            expect(ok).toBe(true);
        });

        test('chasers stay inside the corridors', async ({ page }) => {
            await startWithChasers(page);
            const bad = await page.evaluate(() => {
                let count = 0;
                for (let i = 0; i < 900; i++) {
                    step(1 / 60);
                    if (state !== 'running') { respawn(); continue; }
                    for (const e of enemies) if (isWall(colOf(e.x), rowOf(e.y))) count++;
                }
                return count;
            });
            expect(bad).toBe(0);
        });

        test('chasers close in on a stationary car', async ({ page }) => {
            await startWithChasers(page);
            const result = await page.evaluate(() => {
                car.dir = { x: 0, y: 0 };
                car.want = { x: 0, y: 0 };
                const dist = () => Math.min(...enemies.map((e) => Math.hypot(e.x - car.x, e.y - car.y)));
                const before = dist();
                for (let i = 0; i < 180 && state === 'running'; i++) step(1 / 60);
                return { before, after: dist() };
            });
            expect(result.after).toBeLessThan(result.before);
        });

        test('being caught costs a life and respawns the car at the start', async ({ page }) => {
            await startWithChasers(page);
            const hit = await page.evaluate(() => {
                const c = colOf(car.x), r = rowOf(car.y);
                placeEnemy(0, c, r);
                step(1 / 60);
                return { state, lives, startCol: c, startRow: r };
            });
            expect(hit.state).toBe('dying');
            expect(hit.lives).toBe(2);

            await advance(page, 200);
            const after = await page.evaluate(() => ({
                state,
                col: colOf(car.x),
                row: rowOf(car.y),
                clear: enemies.every((e) => Math.hypot(e.x - car.x, e.y - car.y) > 100),
            }));
            expect(after.state).toBe('running');
            expect(after.col).toBe(hit.startCol);
            expect(after.row).toBe(hit.startRow);
            expect(after.clear).toBe(true);
        });

        test('flags already collected stay collected after a crash', async ({ page }) => {
            await startWithChasers(page);
            const result = await page.evaluate(() => {
                placeCar(flags[0].col, flags[0].row);
                step(1 / 60);
                const left = flags.length;
                placeEnemy(0, colOf(car.x), rowOf(car.y));
                step(1 / 60);
                for (let i = 0; i < 200; i++) step(1 / 60);
                return { left, after: flags.length };
            });
            expect(result.left).toBe(9);
            expect(result.after).toBe(9);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await startWithChasers(page);
            const over = await page.evaluate(() => {
                for (let life = 0; life < 3; life++) {
                    placeEnemy(0, colOf(car.x), rowOf(car.y));
                    step(1 / 60);
                    for (let i = 0; i < 200; i++) step(1 / 60);
                }
                return { state, lives };
            });
            expect(over.state).toBe('over');
            expect(over.lives).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('the best score is stored when the game ends', async ({ page }) => {
            await startWithChasers(page);
            await page.evaluate(() => {
                score = 5500;
                for (let life = 0; life < 3; life++) {
                    placeEnemy(0, colOf(car.x), rowOf(car.y));
                    step(1 / 60);
                    for (let i = 0; i < 200; i++) step(1 / 60);
                }
            });
            expect(await page.evaluate(() => window.localStorage.getItem('rallyx-best'))).toBe('5500');
            await expect(page.locator('#best')).toHaveText('5500');
        });

        test('a new level adds a chaser and speeds them up', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => ({ n: enemies.length, speed: enemySpeed() }));
            await page.evaluate(() => {
                while (flags.length) {
                    placeCar(flags[0].col, flags[0].row);
                    step(1 / 60);
                }
                for (let i = 0; i < 200; i++) step(1 / 60);
            });
            const after = await page.evaluate(() => ({ n: enemies.length, speed: enemySpeed() }));
            expect(after.n).toBe(before.n + 1);
            expect(after.speed).toBeGreaterThan(before.speed);
        });
    });

    // -----------------------------------------------------------------------
    // Run control
    // -----------------------------------------------------------------------
    test.describe('run control', () => {
        test('space starts the game from the idle screen', async ({ page }) => {
            await page.keyboard.press(' ');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('P pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('paused');

            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not simulate', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { car.dir = { x: 1, y: 0 }; car.want = { x: 1, y: 0 }; });
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ x: car.x, fuel }));
            await advance(page, 60);
            const after = await page.evaluate(() => ({ x: car.x, fuel }));
            expect(after).toEqual(before);
        });

        test('restarting resets score, lives and level', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { score = 999; lives = 1; level = 4; startGame(); });
            const s = await page.evaluate(() => ({ score, lives, level, fuel }));
            expect(s).toEqual({ score: 0, lives: 3, level: 1, fuel: 100 });
        });
    });
});
