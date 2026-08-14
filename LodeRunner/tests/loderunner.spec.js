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
// run, so every key press is confirmed against the game state before the
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

const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction(
        (want) => input.x === want.x && input.y === want.y,
        KEY_DIR[key]
    );
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction(() => input.x === 0 && input.y === 0);
};

// Start a run with the animation loop detached from the simulation, so the
// specs drive time themselves and nothing races the real clock.
const startFrozen = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
    });

// The same, with the guards removed — for specs that are not about guards.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
        guards.length = 0;
    });

test.describe('Lode Runner', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Lode Runner', async ({ page }) => {
            await expect(page).toHaveTitle('Lode Runner');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas matches the tile grid', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '320');
            expect(await page.evaluate(() => [COLS, ROWS, TILE])).toEqual([28, 16, 20]);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the first level is loaded behind the overlay', async ({ page }) => {
            expect(await page.evaluate(() => grid.length)).toBe(16);
            expect(await page.evaluate(() => grid[0].length)).toBe(28);
            expect(await page.evaluate(() => goldLeft())).toBeGreaterThan(0);
            expect(await page.evaluate(() => guards.length)).toBeGreaterThan(0);
        });

        test('HUD shows the starting score, level, gold, lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#gold')).toHaveText(
                String(await page.evaluate(() => goldLeft()))
            );
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('loderunner-best', '9100'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('9100');
        });

        test('the exit ladder starts closed', async ({ page }) => {
            expect(await page.evaluate(() => exitOpen)).toBe(false);
            expect(
                await page.evaluate(() => exitCells.every(({ c, r }) => !isLadder(c, r)))
            ).toBe(true);
        });

        test('step() does nothing while idle', async ({ page }) => {
            const before = await page.evaluate(() => runner.x);
            await advance(page, 60);
            expect(await page.evaluate(() => runner.x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Level data
    // -----------------------------------------------------------------------
    test.describe('level data', () => {
        test('there are several levels', async ({ page }) => {
            expect(await page.evaluate(() => LEVELS.length)).toBeGreaterThanOrEqual(3);
        });

        test('every level is a full 28x16 grid of known tiles', async ({ page }) => {
            const bad = await page.evaluate(() =>
                LEVELS.flatMap((lvl, i) => {
                    const out = [];
                    if (lvl.rows.length !== ROWS) out.push(`level ${i} has ${lvl.rows.length} rows`);
                    lvl.rows.forEach((row, r) => {
                        if (row.length !== COLS) out.push(`level ${i} row ${r} is ${row.length}`);
                        [...row].forEach((ch, c) => {
                            if (!' #BH-$&@S'.includes(ch))
                                out.push(`level ${i} (${c},${r}) is '${ch}'`);
                        });
                    });
                    return out;
                })
            );
            expect(bad).toEqual([]);
        });

        test('every level has one runner, gold, guards and an exit', async ({ page }) => {
            const counts = await page.evaluate(() =>
                LEVELS.map((lvl) => {
                    const all = lvl.rows.join('');
                    const n = (ch) => [...all].filter((x) => x === ch).length;
                    return { runner: n('@'), gold: n('$'), guards: n('&'), exit: n('S') };
                })
            );
            for (const c of counts) {
                expect(c.runner).toBe(1);
                expect(c.gold).toBeGreaterThan(0);
                expect(c.guards).toBeGreaterThan(0);
                expect(c.exit).toBeGreaterThan(0);
            }
        });

        // Walks the same movement graph the guards use, so a level can never
        // ship with gold walled off behind terrain.
        test('all gold and the top row are reachable from the spawn', async ({ page }) => {
            const problems = await page.evaluate(() => {
                const out = [];
                const reach = () => {
                    const start = { c: Math.round(runner.x), r: Math.round(runner.y) };
                    const seen = new Set([`${start.c},${start.r}`]);
                    const queue = [start];
                    while (queue.length) {
                        const { c, r } = queue.shift();
                        const next = [{ c, r: r + 1 }];
                        if (canStand(c, r)) next.push({ c: c - 1, r }, { c: c + 1, r });
                        if (isLadder(c, r)) next.push({ c, r: r - 1 });
                        for (const n of next) {
                            if (n.c < 0 || n.c >= COLS || n.r < 0 || n.r >= ROWS) continue;
                            if (blocking(n.c, n.r)) continue;
                            const key = `${n.c},${n.r}`;
                            if (seen.has(key)) continue;
                            seen.add(key);
                            queue.push(n);
                        }
                    }
                    return seen;
                };
                for (let i = 1; i <= LEVELS.length; i++) {
                    loadLevel(i);
                    const closed = reach();
                    for (const g of gold)
                        if (!closed.has(`${g.c},${g.r}`))
                            out.push(`level ${i}: gold ${g.c},${g.r} unreachable`);
                    exitOpen = true;
                    const open = reach();
                    let top = false;
                    for (let c = 0; c < COLS; c++) if (open.has(`${c},0`)) top = true;
                    if (!top) out.push(`level ${i}: cannot escape`);
                }
                return out;
            });
            expect(problems).toEqual([]);
        });

        test('levels cycle once the last one is cleared', async ({ page }) => {
            const first = await page.evaluate(() => {
                loadLevel(1);
                return grid.map((r) => r.join('')).join('|');
            });
            const wrapped = await page.evaluate(() => {
                loadLevel(LEVELS.length + 1);
                return grid.map((r) => r.join('')).join('|');
            });
            expect(wrapped).toBe(first);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the runner starts on the level spawn, standing still', async ({ page }) => {
            await startQuiet(page);
            const spawn = await page.evaluate(() => {
                const rows = LEVELS[0].rows;
                for (let r = 0; r < ROWS; r++) {
                    const c = rows[r].indexOf('@');
                    if (c >= 0) return { c, r };
                }
                return null;
            });
            expect(await page.evaluate(() => ({ x: runner.x, y: runner.y }))).toEqual({
                x: spawn.c,
                y: spawn.r,
            });
            await advance(page, 30);
            expect(await page.evaluate(() => runner.falling)).toBe(false);
            expect(await page.evaluate(() => ({ x: runner.x, y: runner.y }))).toEqual({
                x: spawn.c,
                y: spawn.r,
            });
        });
    });

    // -----------------------------------------------------------------------
    // Running, climbing, hanging, falling
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('holding right runs the runner right', async ({ page }) => {
            const before = await page.evaluate(() => runner.x);
            await hold(page, 'ArrowRight');
            await advance(page, 30);
            expect(await page.evaluate(() => runner.x)).toBeGreaterThan(before);
            expect(await page.evaluate(() => runner.facing)).toBe(1);
        });

        test('holding left runs the runner left', async ({ page }) => {
            await page.evaluate(() => placeRunner(10, 14));
            await hold(page, 'ArrowLeft');
            await advance(page, 30);
            expect(await page.evaluate(() => runner.x)).toBeLessThan(10);
            expect(await page.evaluate(() => runner.facing)).toBe(-1);
        });

        test('W A S D also drive the runner', async ({ page }) => {
            await page.evaluate(() => placeRunner(10, 14));
            await hold(page, 'd');
            await advance(page, 30);
            expect(await page.evaluate(() => runner.x)).toBeGreaterThan(10);
        });

        test('the runner is stopped by a wall', async ({ page }) => {
            await page.evaluate(() => {
                grid[14][6] = 'B';
                placeRunner(4, 14);
            });
            await hold(page, 'ArrowRight');
            await advance(page, 120);
            expect(await page.evaluate(() => runner.x)).toBe(5);
        });

        test('running off a ledge starts a fall', async ({ page }) => {
            await page.evaluate(() => placeRunner(19, 11));
            await hold(page, 'ArrowRight');
            await advance(page, 20);
            expect(await page.evaluate(() => runner.falling)).toBe(true);
            expect(await page.evaluate(() => runner.mode)).toBe('fall');
        });

        test('a fall lands on the first floor below', async ({ page }) => {
            await page.evaluate(() => placeRunner(19, 11));
            await hold(page, 'ArrowRight');
            await advance(page, 120);
            expect(await page.evaluate(() => runner.falling)).toBe(false);
            expect(await page.evaluate(() => Math.round(runner.y))).toBe(14);
        });

        test('a falling runner cannot be steered', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(22, 11);
                runner.falling = true;
                input.x = -1;
            });
            const x = await page.evaluate(() => runner.x);
            await advance(page, 10);
            expect(await page.evaluate(() => runner.x)).toBe(x);
            expect(await page.evaluate(() => runner.y)).toBeGreaterThan(11);
        });

        test('pressing up on a ladder climbs', async ({ page }) => {
            await page.evaluate(() => placeRunner(5, 5));
            await hold(page, 'ArrowUp');
            await advance(page, 20);
            expect(await page.evaluate(() => runner.y)).toBeLessThan(5);
            expect(await page.evaluate(() => runner.mode)).toBe('climb');
        });

        test('climbing stops standing on the top of the ladder', async ({ page }) => {
            await page.evaluate(() => placeRunner(5, 5));
            await hold(page, 'ArrowUp');
            await advance(page, 180);
            expect(await page.evaluate(() => runner.y)).toBe(2);
            expect(await page.evaluate(() => runner.falling)).toBe(false);
        });

        test('climbing down stops at the foot of the ladder', async ({ page }) => {
            await page.evaluate(() => placeRunner(5, 2));
            await hold(page, 'ArrowDown');
            await advance(page, 180);
            expect(await page.evaluate(() => runner.y)).toBe(5);
            expect(await page.evaluate(() => runner.falling)).toBe(false);
        });

        test('the runner cannot climb thin air', async ({ page }) => {
            await page.evaluate(() => placeRunner(10, 14));
            await hold(page, 'ArrowUp');
            await advance(page, 60);
            expect(await page.evaluate(() => runner.y)).toBe(14);
        });

        test('moving onto a bar leaves the runner hanging', async ({ page }) => {
            await page.evaluate(() => placeRunner(11, 5));
            await hold(page, 'ArrowRight');
            await advance(page, 40);
            expect(await page.evaluate(() => Math.round(runner.x))).toBeGreaterThanOrEqual(12);
            expect(await page.evaluate(() => runner.falling)).toBe(false);
            expect(await page.evaluate(() => runner.mode)).toBe('hang');
        });

        test('the runner travels the length of a bar', async ({ page }) => {
            await page.evaluate(() => placeRunner(12, 5));
            await hold(page, 'ArrowRight');
            await advance(page, 60);
            expect(await page.evaluate(() => runner.y)).toBe(5);
            expect(await page.evaluate(() => runner.x)).toBeGreaterThan(14);
        });

        test('pressing down drops off a bar', async ({ page }) => {
            await page.evaluate(() => placeRunner(14, 5));
            await hold(page, 'ArrowDown');
            await advance(page, 5);
            expect(await page.evaluate(() => runner.falling)).toBe(true);
            await advance(page, 120);
            expect(await page.evaluate(() => Math.round(runner.y))).toBe(8);
        });

        test('a fall passes straight through a bar', async ({ page }) => {
            // Dig through the floor above the bar at row 5 and drop in: the bar
            // is not a net, so the runner carries on down to row 8.
            await page.evaluate(() => {
                placeRunner(12, 2);
                dig(1);
                placeRunner(13, 2);
            });
            await advance(page, 120);
            expect(await page.evaluate(() => isBar(13, 5))).toBe(true);
            expect(await page.evaluate(() => Math.round(runner.y))).toBe(8);
        });

        test('the runner stays on the board', async ({ page }) => {
            await page.evaluate(() => placeRunner(26, 14));
            await hold(page, 'ArrowRight');
            await advance(page, 180);
            const x = await page.evaluate(() => runner.x);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(await page.evaluate(() => COLS - 1));
        });
    });

    // -----------------------------------------------------------------------
    // Digging
    // -----------------------------------------------------------------------
    test.describe('digging', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('digging right opens a hole below and to the right', async ({ page }) => {
            const dug = await page.evaluate(() => {
                placeRunner(10, 2);
                return dig(1);
            });
            expect(dug).toBe(true);
            expect(await page.evaluate(() => holes.length)).toBe(1);
            expect(await page.evaluate(() => holes[0])).toMatchObject({ c: 11, r: 3 });
            expect(await page.evaluate(() => blocking(11, 3))).toBe(false);
        });

        test('digging left opens a hole below and to the left', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(10, 2);
                dig(-1);
            });
            expect(await page.evaluate(() => holes[0])).toMatchObject({ c: 9, r: 3 });
        });

        test('the Z and X keys dig', async ({ page }) => {
            await page.evaluate(() => placeRunner(10, 2));
            await page.keyboard.press('x');
            await page.waitForFunction(() => holes.length === 1);
            expect(await page.evaluate(() => holes[0].c)).toBe(11);
            await page.keyboard.press('z');
            await page.waitForFunction(() => holes.length === 2);
            expect(await page.evaluate(() => holes[1].c)).toBe(9);
        });

        test('the comma and period keys dig too', async ({ page }) => {
            await page.evaluate(() => placeRunner(10, 2));
            await page.keyboard.press('.');
            await page.waitForFunction(() => holes.length === 1);
            await page.keyboard.press(',');
            await page.waitForFunction(() => holes.length === 2);
        });

        test('stone cannot be dug', async ({ page }) => {
            const dug = await page.evaluate(() => {
                placeRunner(10, 14);
                return dig(1);
            });
            expect(dug).toBe(false);
            expect(await page.evaluate(() => holes.length)).toBe(0);
        });

        test('the runner cannot dig from a ladder', async ({ page }) => {
            const dug = await page.evaluate(() => {
                placeRunner(5, 4);
                return dig(1);
            });
            expect(dug).toBe(false);
        });

        test('the runner cannot dig from a bar', async ({ page }) => {
            const dug = await page.evaluate(() => {
                placeRunner(14, 5);
                return dig(1);
            });
            expect(dug).toBe(false);
        });

        test('the runner cannot dig while falling', async ({ page }) => {
            const dug = await page.evaluate(() => {
                placeRunner(22, 11);
                step(1 / 60);
                return runner.falling && dig(1);
            });
            expect(dug).toBe(false);
        });

        test('a covered brick cannot be dug', async ({ page }) => {
            const dug = await page.evaluate(() => {
                grid[2][11] = 'B';
                placeRunner(10, 2);
                return dig(1);
            });
            expect(dug).toBe(false);
        });

        test('the same hole cannot be dug twice', async ({ page }) => {
            const second = await page.evaluate(() => {
                placeRunner(10, 2);
                dig(1);
                return dig(1);
            });
            expect(second).toBe(false);
            expect(await page.evaluate(() => holes.length)).toBe(1);
        });

        test('a hole heals back into brick', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(10, 2);
                dig(1);
            });
            await advance(page, Math.ceil((await page.evaluate(() => HOLE_REFILL)) * 60) + 5);
            expect(await page.evaluate(() => holes.length)).toBe(0);
            expect(await page.evaluate(() => blocking(11, 3))).toBe(true);
        });

        test('the runner can drop through a fresh hole', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(10, 2);
                dig(1);
                placeRunner(11, 2);
            });
            await advance(page, 120);
            expect(await page.evaluate(() => Math.round(runner.y))).toBe(5);
        });

        test('a healing hole crushes the runner', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(10, 2);
                dig(1);
                holes[0].t = HOLE_REFILL - 0.001;
                placeRunner(11, 3);
            });
            await advance(page, 1);
            expect(await page.evaluate(() => state)).toBe('dying');
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Gold and clearing a level
    // -----------------------------------------------------------------------
    test.describe('gold', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('stepping onto gold collects it', async ({ page }) => {
            const before = await page.evaluate(() => goldLeft());
            await page.evaluate(() => placeRunner(11, 14));
            await advance(page, 1);
            expect(await page.evaluate(() => goldLeft())).toBe(before - 1);
            expect(await page.evaluate(() => score)).toBe(
                await page.evaluate(() => GOLD_SCORE)
            );
            await expect(page.locator('#score')).toHaveText(
                String(await page.evaluate(() => GOLD_SCORE))
            );
            await expect(page.locator('#gold')).toHaveText(String(before - 1));
        });

        test('running into gold collects it', async ({ page }) => {
            const before = await page.evaluate(() => goldLeft());
            await page.evaluate(() => placeRunner(9, 14));
            await hold(page, 'ArrowRight');
            await advance(page, 60);
            expect(await page.evaluate(() => goldLeft())).toBe(before - 1);
        });

        test('gold is only collected once', async ({ page }) => {
            await page.evaluate(() => placeRunner(11, 14));
            await advance(page, 60);
            expect(await page.evaluate(() => score)).toBe(
                await page.evaluate(() => GOLD_SCORE)
            );
        });

        test('the exit ladder opens when the last gold is taken', async ({ page }) => {
            await page.evaluate(() => collectAllGoldForTest());
            await advance(page, 1);
            expect(await page.evaluate(() => goldLeft())).toBe(0);
            expect(await page.evaluate(() => exitOpen)).toBe(true);
            expect(
                await page.evaluate(() => exitCells.every(({ c, r }) => isLadder(c, r)))
            ).toBe(true);
        });

        test('the runner can climb the exit ladder to the top', async ({ page }) => {
            await page.evaluate(() => {
                collectAllGoldForTest();
                step(1 / 60);
                const exit = exitCells.reduce((a, b) => (a.r > b.r ? a : b));
                placeRunner(exit.c, exit.r);
                input.y = -1;
            });
            // Stops on the escape: staying any longer rolls into the next level.
            await advance(page, 60);
            expect(await page.evaluate(() => Math.round(runner.y))).toBe(0);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('reaching the top row does nothing while gold remains', async ({ page }) => {
            await page.evaluate(() => placeRunner(12, 0));
            await advance(page, 1);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('clearing a level scores a bonus and loads the next one', async ({ page }) => {
            await page.evaluate(() => {
                collectAllGoldForTest();
                step(1 / 60);
                score = 0;
                placeRunner(12, 0);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('levelclear');
            expect(await page.evaluate(() => score)).toBe(
                await page.evaluate(() => LEVEL_SCORE)
            );
            await advance(page, 200);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => goldLeft())).toBeGreaterThan(0);
            expect(await page.evaluate(() => exitOpen)).toBe(false);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('lives carry into the next level', async ({ page }) => {
            await page.evaluate(() => {
                lives = 2;
                collectAllGoldForTest();
                step(1 / 60);
                placeRunner(12, 0);
            });
            await advance(page, 202);
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Guards
    // -----------------------------------------------------------------------
    test.describe('guards', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a guard closes in on the runner', async ({ page }) => {
            const gap = await page.evaluate(() => {
                placeRunner(20, 14);
                spawnGuard(6, 14);
                return Math.abs(guards[0].x - runner.x);
            });
            await advance(page, 120);
            expect(await page.evaluate(() => Math.abs(guards[0].x - runner.x))).toBeLessThan(
                gap
            );
        });

        test('a guard climbs toward a runner on another floor', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(5, 2);
                spawnGuard(8, 5);
            });
            await advance(page, 120);
            expect(await page.evaluate(() => Math.round(guards[0].y))).toBeLessThan(5);
        });

        test('touching a guard costs a life', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(10, 14);
                spawnGuard(10, 14);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('the level restarts after a death', async ({ page }) => {
            const total = await page.evaluate(() => goldLeft());
            await page.evaluate(() => {
                placeRunner(11, 14);
                step(1 / 60);
                spawnGuard(11, 14);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('dying');
            await advance(page, 150);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => goldLeft())).toBe(total);
            expect(await page.evaluate(() => holes.length)).toBe(0);
        });

        test('a guard falls into a hole and is trapped', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(10, 2);
                dig(1);
                spawnGuard(11, 2);
                placeRunner(1, 14);
            });
            await advance(page, 40);
            expect(await page.evaluate(() => guards[0].state)).toBe('trapped');
            expect(await page.evaluate(() => Math.round(guards[0].y))).toBe(3);
        });

        test('a trapped guard is harmless', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(10, 2);
                dig(1);
                spawnGuard(11, 2);
            });
            await advance(page, 40);
            await page.evaluate(() => {
                runner.x = guards[0].x;
                runner.y = guards[0].y;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a trapped guard is a floor to run across', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(10, 2);
                dig(1);
                spawnGuard(11, 2);
                placeRunner(1, 14);
            });
            await advance(page, 40);
            await page.evaluate(() => placeRunner(11, 2));
            await advance(page, 3);
            expect(await page.evaluate(() => runner.falling)).toBe(false);
            expect(await page.evaluate(() => Math.round(runner.y))).toBe(2);
        });

        test('a trapped guard climbs back out', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(10, 2);
                dig(1);
                spawnGuard(11, 2);
                placeRunner(1, 14);
            });
            await advance(page, 40);
            expect(await page.evaluate(() => guards[0].state)).toBe('trapped');
            // Stops the moment the guard is loose: once free it hunts the
            // runner again and may well drop straight back into the hole.
            const result = await page.evaluate(() => {
                let elapsed = 0;
                while (elapsed < 6 && guards[0].state === 'trapped') {
                    step(1 / 60);
                    elapsed += 1 / 60;
                }
                const leaving = guards[0].state;
                for (let i = 0; i < Math.ceil(GUARD_CLIMB * 60) + 2; i++) step(1 / 60);
                return { leaving, state: guards[0].state, y: guards[0].y, elapsed };
            });
            expect(result.leaving).toBe('climbing');
            // The 40 frames above already burned two thirds of a second of it.
            expect(result.elapsed).toBeGreaterThan(1.4);
            expect(result.state).toBe('active');
            expect(result.y).toBeLessThan(3);
        });

        test('a healing hole buries a trapped guard', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(10, 2);
                dig(1);
                spawnGuard(11, 2);
                placeRunner(1, 14);
            });
            await advance(page, 40);
            await page.evaluate(() => {
                holes[0].t = HOLE_REFILL - 0.001;
            });
            await advance(page, 1);
            expect(await page.evaluate(() => guards[0].state)).toBe('dead');
            expect(await page.evaluate(() => score)).toBe(
                await page.evaluate(() => GUARD_SCORE)
            );
        });

        test('a buried guard comes back', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(10, 2);
                dig(1);
                spawnGuard(11, 2);
                placeRunner(1, 14);
            });
            await advance(page, 40);
            await page.evaluate(() => {
                holes[0].t = HOLE_REFILL - 0.001;
            });
            await advance(page, 1);
            await advance(page, Math.ceil((await page.evaluate(() => GUARD_RESPAWN)) * 60) + 10);
            expect(await page.evaluate(() => guards[0].state)).toBe('active');
        });

        test('guards speed up with the level but never outrun the runner', async ({ page }) => {
            const first = await page.evaluate(() => guardSpeed());
            await page.evaluate(() => {
                level = 5;
            });
            expect(await page.evaluate(() => guardSpeed())).toBeGreaterThan(first);
            await page.evaluate(() => {
                level = 60;
            });
            expect(await page.evaluate(() => guardSpeed())).toBeLessThan(
                await page.evaluate(() => RUN_SPEED)
            );
        });
    });

    // -----------------------------------------------------------------------
    // Lives, game over, best score
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('running out of lives ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                placeRunner(10, 14);
                spawnGuard(10, 14);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(0);
            await advance(page, 150);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('a new best is stored', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 5250;
                lives = 1;
                placeRunner(10, 14);
                spawnGuard(10, 14);
            });
            await advance(page, 152);
            await expect(page.locator('#best')).toHaveText('5250');
            expect(
                await page.evaluate(() => window.localStorage.getItem('loderunner-best'))
            ).toBe('5250');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('loderunner-best', '9999'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 10;
                lives = 1;
                placeRunner(10, 14);
                spawnGuard(10, 14);
            });
            await advance(page, 152);
            await expect(page.locator('#best')).toHaveText('9999');
        });

        test('restarting resets the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 700;
                level = 3;
                lives = 1;
                placeRunner(10, 14);
                spawnGuard(10, 14);
            });
            await advance(page, 152);
            expect(await page.evaluate(() => state)).toBe('over');
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
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
                placeRunner(10, 14);
                spawnGuard(20, 14);
                input.x = 1;
                togglePause();
            });
            const before = await page.evaluate(() => ({ x: runner.x, g: guards[0].x }));
            await advance(page, 60);
            expect(await page.evaluate(() => ({ x: runner.x, g: guards[0].x }))).toEqual(before);
        });

        test('holes do not heal while paused', async ({ page }) => {
            await page.evaluate(() => {
                placeRunner(10, 2);
                dig(1);
                togglePause();
            });
            await advance(page, Math.ceil((await page.evaluate(() => HOLE_REFILL)) * 60) + 30);
            expect(await page.evaluate(() => holes.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 10);
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
                autoStep = false;
                placeRunner(10, 2);
                dig(1);
                dig(-1);
                spawnGuard(11, 2);
                for (let i = 0; i < 120; i++) step(1 / 60);
                draw(); // running, with a trapped guard
                togglePause();
                draw(); // paused
                togglePause();
                collectAllGoldForTest();
                step(1 / 60);
                draw(); // exit open
                placeRunner(12, 0);
                step(1 / 60);
                draw(); // level clear
                for (let i = 0; i < 200; i++) step(1 / 60);
                lives = 1;
                placeRunner(10, 14);
                spawnGuard(10, 14);
                step(1 / 60);
                draw(); // dying
                for (let i = 0; i < 200; i++) step(1 / 60);
                draw(); // over
            });
            expect(errors).toEqual([]);
        });

        test('the animation loop runs on its own', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.evaluate(() => {
                input.x = 1;
                placeRunner(10, 14);
            });
            await page.waitForFunction(() => runner.x > 10.2);
        });
    });
});
