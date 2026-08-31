const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// The page's requestAnimationFrame loop is switched off (`autoStep = false`) as
// soon as the game loads, so every spec drives the simulation itself through
// `step(dt)` and nothing depends on wall-clock timing.
const load = async (page) => {
    await page.goto(GAME_URL);
    await page.evaluate(() => {
        autoStep = false;
    });
};

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

const seconds = (s) => Math.ceil(s * 60);

// Start a level with the guards frozen, so movement specs stay deterministic.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        guardsEnabled = false;
    });

// Drop the runner into a specific cell, cancelling any move in flight.
const place = (page, col, row) =>
    page.evaluate(([c, r]) => {
        runner.col = c;
        runner.row = r;
        runner.move = null;
        runner.digging = null;
    }, [col, row]);

const setDir = (page, x, y) =>
    page.evaluate(([dx, dy]) => {
        runner.dir.x = dx;
        runner.dir.y = dy;
    }, [x, y]);

const cell = (page) => page.evaluate(() => ({ col: runner.col, row: runner.row }));

const tile = (page, col, row) => page.evaluate(([c, r]) => grid[r][c], [col, row]);

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so key presses are confirmed against the game state before stepping.
const KEY_DIR = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
};

const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction(
        (want) => runner.dir.x === want.x && runner.dir.y === want.y,
        KEY_DIR[key]
    );
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction(() => runner.dir.x === 0 && runner.dir.y === 0);
};

test.describe('Lode Runner', () => {
    test.beforeEach(async ({ page }) => {
        await load(page);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Lode Runner', async ({ page }) => {
            await expect(page).toHaveTitle('Lode Runner');
        });

        test('canvas is 672x384', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '672');
            await expect(canvas).toHaveAttribute('height', '384');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level, lives and gold', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#gold')).toHaveText('6');
        });
    });

    // -----------------------------------------------------------------------
    // Level data
    // -----------------------------------------------------------------------
    test.describe('level maps', () => {
        test('there are three levels', async ({ page }) => {
            expect(await page.evaluate(() => LEVELS.length)).toBe(3);
        });

        test('every level is 16 rows of 28 columns', async ({ page }) => {
            const shapes = await page.evaluate(() =>
                LEVELS.map((lv) => ({ rows: lv.length, widths: [...new Set(lv.map((r) => r.length))] }))
            );
            for (const shape of shapes) {
                expect(shape.rows).toBe(16);
                expect(shape.widths).toEqual([28]);
            }
        });

        test('every level has one runner, gold, guards and an exit ladder', async ({ page }) => {
            const counts = await page.evaluate(() =>
                LEVELS.map((lv) => {
                    const all = lv.join('');
                    const n = (ch) => all.split(ch).length - 1;
                    return { runner: n('R'), gold: n('$'), guards: n('G'), exit: n('S') };
                })
            );
            for (const c of counts) {
                expect(c.runner).toBe(1);
                expect(c.gold).toBeGreaterThan(0);
                expect(c.guards).toBeGreaterThan(0);
                expect(c.exit).toBeGreaterThan(0);
            }
        });

        // Walking, climbing and falling alone must be enough to finish every
        // level: digging is a tactic against the guards, never a requirement.
        test('every level can be cleared without digging', async ({ page }) => {
            const report = await page.evaluate(() => {
                const out = [];
                for (let n = 1; n <= LEVELS.length; n++) {
                    loadLevel(n);
                    exitRevealed = true;
                    const seen = new Set([runner.row * COLS + runner.col]);
                    const queue = [[runner.col, runner.row]];
                    while (queue.length) {
                        const [c, r] = queue.shift();
                        for (const [dx, dy] of movesFrom(c, r, false)) {
                            const nc = c + dx;
                            const nr = r + dy;
                            if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
                            const key = nr * COLS + nc;
                            if (seen.has(key)) continue;
                            seen.add(key);
                            queue.push([nc, nr]);
                        }
                    }
                    out.push({
                        level: n,
                        unreachableGold: gold.filter((g) => !seen.has(g.row * COLS + g.col)).length,
                        topReached: [...Array(COLS).keys()].some((c) => seen.has(c)),
                    });
                }
                return out;
            });
            for (const lv of report) {
                expect(lv.unreachableGold, `level ${lv.level} gold`).toBe(0);
                expect(lv.topReached, `level ${lv.level} escape`).toBe(true);
            }
        });

        // End to end: an autopilot that walks the shortest route to the nearest
        // coin, and then to the top of the screen, clears every level.
        test('every level can actually be played through to the exit', async ({ page }) => {
            await startQuiet(page);
            const results = await page.evaluate(() => {
                const nearest = () => {
                    if (gold.length) {
                        return gold
                            .slice()
                            .sort(
                                (a, b) =>
                                    Math.abs(a.col - runner.col) + Math.abs(a.row - runner.row) -
                                    (Math.abs(b.col - runner.col) + Math.abs(b.row - runner.row))
                            )[0];
                    }
                    // Head for whichever exit-ladder cell sits on the top row.
                    for (let c = 0; c < COLS; c++) if (grid[0][c] === 'S') return { col: c, row: 0 };
                    return null;
                };

                const out = [];
                for (let n = 1; n <= LEVELS.length; n++) {
                    level = n;
                    loadLevel(n);
                    guards.length = 0;   // this is about the map, not the chase
                    state = 'running';
                    score = 0;
                    const coins = gold.length;
                    for (let i = 0; i < 60 * 120 && state === 'running'; i++) {
                        const target = nearest();
                        const dir = target ? chaseStep(runner, target, false) : null;
                        runner.dir.x = dir ? dir[0] : 0;
                        runner.dir.y = dir ? dir[1] : 0;
                        step(1 / 60);
                    }
                    out.push({ level: n, state, score, left: gold.length, expected: coins * 100 + 250 });
                }
                return out;
            });
            for (const r of results) {
                expect(r.left, `level ${r.level} gold left`).toBe(0);
                expect(r.state, `level ${r.level} state`).toBe('levelclear');
                expect(r.score, `level ${r.level} score`).toBe(r.expected);
            }
        });

        test('only known tile characters are used', async ({ page }) => {
            const unknown = await page.evaluate(() =>
                [...new Set(LEVELS.flat().join('').split(''))].filter((ch) => !'.#=H-S$RG'.includes(ch))
            );
            expect(unknown).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting a game', () => {
        test('startGame() runs level 1 and hides the overlay', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(1);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('runner and guards spawn on their map cells', async ({ page }) => {
            await startQuiet(page);
            expect(await cell(page)).toEqual({ col: 1, row: 14 });
            const guards = await page.evaluate(() => guards.map((g) => ({ col: g.col, row: g.row })));
            expect(guards).toEqual([{ col: 20, row: 14 }]);
        });

        test('all level gold is on the board', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => gold.length)).toBe(6);
        });

        test('space starts the game from the title screen', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Running and climbing
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('holding right runs right', async ({ page }) => {
            await hold(page, 'ArrowRight');
            await advance(page, seconds(0.5));
            await release(page, 'ArrowRight');
            expect((await cell(page)).col).toBeGreaterThan(1);
            expect((await cell(page)).row).toBe(14);
        });

        test('holding left runs left', async ({ page }) => {
            await place(page, 10, 14);
            await hold(page, 'ArrowLeft');
            await advance(page, seconds(0.5));
            await release(page, 'ArrowLeft');
            expect((await cell(page)).col).toBeLessThan(10);
        });

        test('the runner cannot leave the left edge', async ({ page }) => {
            await place(page, 0, 14);
            await setDir(page, -1, 0);
            await advance(page, seconds(1));
            expect(await cell(page)).toEqual({ col: 0, row: 14 });
        });

        test('the runner cannot leave the right edge', async ({ page }) => {
            await place(page, 27, 14);
            await setDir(page, 1, 0);
            await advance(page, seconds(1));
            expect(await cell(page)).toEqual({ col: 27, row: 14 });
        });

        test('brick walls block running', async ({ page }) => {
            await page.evaluate(() => {
                grid[14][5] = '#';
            });
            await place(page, 4, 14);
            await setDir(page, 1, 0);
            await advance(page, seconds(1));
            expect(await cell(page)).toEqual({ col: 4, row: 14 });
        });

        test('the runner falls when nothing is underfoot', async ({ page }) => {
            await place(page, 23, 5);
            await advance(page, seconds(1));
            expect(await cell(page)).toEqual({ col: 23, row: 6 });
        });

        test('falling stops on a ladder', async ({ page }) => {
            await place(page, 22, 8);
            await advance(page, seconds(1));
            expect(await cell(page)).toEqual({ col: 22, row: 10 });
        });

        test('the runner climbs a ladder upwards', async ({ page }) => {
            await place(page, 22, 14);
            await setDir(page, 0, -1);
            await advance(page, seconds(2));
            expect(await cell(page)).toEqual({ col: 22, row: 10 });
        });

        test('the runner cannot climb past the top of a ladder', async ({ page }) => {
            await place(page, 22, 10);
            await setDir(page, 0, -1);
            await advance(page, seconds(1));
            expect(await cell(page)).toEqual({ col: 22, row: 10 });
        });

        test('the runner cannot climb where there is no ladder', async ({ page }) => {
            await place(page, 3, 14);
            await setDir(page, 0, -1);
            await advance(page, seconds(1));
            expect(await cell(page)).toEqual({ col: 3, row: 14 });
        });

        test('the runner climbs down a ladder and stops on the floor', async ({ page }) => {
            await place(page, 22, 10);
            await setDir(page, 0, 1);
            await advance(page, seconds(2));
            expect(await cell(page)).toEqual({ col: 22, row: 14 });
        });

        test('the runner hangs from a rope instead of falling', async ({ page }) => {
            await place(page, 15, 5);
            await advance(page, seconds(1));
            expect(await cell(page)).toEqual({ col: 15, row: 5 });
        });

        test('the runner slides along a rope and falls off the end', async ({ page }) => {
            await place(page, 15, 5);
            await setDir(page, 1, 0);
            await advance(page, seconds(1.5));
            expect((await cell(page)).row).toBeGreaterThan(5);
        });

        test('pressing down drops off a rope', async ({ page }) => {
            await place(page, 15, 5);
            await setDir(page, 0, 1);
            await advance(page, seconds(1.5));
            expect(await cell(page)).toEqual({ col: 15, row: 6 });
        });
    });

    // -----------------------------------------------------------------------
    // Gold
    // -----------------------------------------------------------------------
    test.describe('gold', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('running over gold collects it and scores', async ({ page }) => {
            await place(page, 2, 14);
            await setDir(page, 1, 0);
            await advance(page, seconds(0.6));
            expect(await page.evaluate(() => score)).toBe(100);
            expect(await page.evaluate(() => gold.length)).toBe(5);
        });

        test('the HUD shows the gold still to collect', async ({ page }) => {
            await place(page, 2, 14);
            await setDir(page, 1, 0);
            await advance(page, seconds(0.6));
            await expect(page.locator('#gold')).toHaveText('5');
            await expect(page.locator('#score')).toHaveText('100');
        });

        test('gold is only scored once', async ({ page }) => {
            await place(page, 2, 14);
            await setDir(page, 1, 0);
            await advance(page, seconds(0.6));
            await setDir(page, 0, 0);
            await advance(page, seconds(1));
            expect(await page.evaluate(() => score)).toBe(100);
        });
    });

    // -----------------------------------------------------------------------
    // Digging
    // -----------------------------------------------------------------------
    test.describe('digging', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('digging right opens a hole in the brick below-right', async ({ page }) => {
            await place(page, 10, 10);
            await page.evaluate(() => dig(1));
            await advance(page, seconds(0.6));
            expect(await tile(page, 11, 11)).toBe('.');
            expect(await page.evaluate(() => holes.length)).toBe(1);
        });

        test('digging left opens a hole in the brick below-left', async ({ page }) => {
            await place(page, 10, 10);
            await page.evaluate(() => dig(-1));
            await advance(page, seconds(0.6));
            expect(await tile(page, 9, 11)).toBe('.');
        });

        test('the runner cannot move while digging', async ({ page }) => {
            await place(page, 10, 10);
            await page.evaluate(() => dig(1));
            await setDir(page, -1, 0);
            await advance(page, seconds(0.2));
            expect(await cell(page)).toEqual({ col: 10, row: 10 });
        });

        test('the X key digs to the right', async ({ page }) => {
            await place(page, 10, 10);
            await page.keyboard.press('x');
            await expect.poll(() => page.evaluate(() => runner.digging !== null)).toBe(true);
            await advance(page, seconds(0.6));
            expect(await tile(page, 11, 11)).toBe('.');
        });

        test('the Z key digs to the left', async ({ page }) => {
            await place(page, 10, 10);
            await page.keyboard.press('z');
            await expect.poll(() => page.evaluate(() => runner.digging !== null)).toBe(true);
            await advance(page, seconds(0.6));
            expect(await tile(page, 9, 11)).toBe('.');
        });

        test('a dig asked for mid-stride fires once the runner settles', async ({ page }) => {
            await place(page, 9, 10);
            await setDir(page, 1, 0);
            await advance(page, 2);          // the runner is now between cells
            expect(await page.evaluate(() => runner.move !== null)).toBe(true);
            await page.evaluate(() => dig(1));
            expect(await page.evaluate(() => runner.pendingDig !== null)).toBe(true);
            await setDir(page, 0, 0);
            await advance(page, seconds(0.8));
            expect(await tile(page, 11, 11)).toBe('.');
        });

        test('a hole fills itself in again', async ({ page }) => {
            await place(page, 10, 10);
            await page.evaluate(() => dig(1));
            await advance(page, seconds(0.6));
            expect(await tile(page, 11, 11)).toBe('.');
            await advance(page, seconds(7));
            expect(await tile(page, 11, 11)).toBe('#');
            expect(await page.evaluate(() => holes.length)).toBe(0);
        });

        test('solid stone cannot be dug', async ({ page }) => {
            await place(page, 5, 14);
            await page.evaluate(() => dig(1));
            await advance(page, seconds(0.6));
            expect(await tile(page, 6, 15)).toBe('=');
            expect(await page.evaluate(() => holes.length)).toBe(0);
        });

        test('ladders cannot be dug out', async ({ page }) => {
            await place(page, 21, 10);
            await page.evaluate(() => dig(1));
            await advance(page, seconds(0.6));
            expect(await tile(page, 22, 11)).toBe('H');
            expect(await page.evaluate(() => holes.length)).toBe(0);
        });

        test('the runner cannot dig while hanging from a rope', async ({ page }) => {
            await place(page, 15, 5);
            await page.evaluate(() => dig(1));
            await advance(page, seconds(0.6));
            expect(await page.evaluate(() => holes.length)).toBe(0);
        });

        test('the runner cannot dig an open hole twice', async ({ page }) => {
            await place(page, 10, 10);
            await page.evaluate(() => dig(1));
            await advance(page, seconds(0.6));
            await page.evaluate(() => dig(1));
            await advance(page, seconds(0.6));
            expect(await page.evaluate(() => holes.length)).toBe(1);
        });

        test('the runner drops through its own hole to the floor below', async ({ page }) => {
            await place(page, 10, 10);
            await page.evaluate(() => dig(1));
            await advance(page, seconds(0.6));
            await setDir(page, 1, 0);
            await advance(page, seconds(1));
            expect(await cell(page)).toMatchObject({ row: 14 });
        });

        // Over the thick ledge on the right there is solid brick under the
        // hole, so the runner lands in it and cannot climb out.
        test('a runner caught in a filling hole loses a life', async ({ page }) => {
            await place(page, 25, 10);
            await page.evaluate(() => dig(1));
            await advance(page, seconds(0.6));
            await setDir(page, 1, 0);
            await advance(page, seconds(0.6));
            expect(await cell(page)).toEqual({ col: 26, row: 11 });
            await setDir(page, 0, 0);
            await advance(page, seconds(5.5));
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });
    });

    // -----------------------------------------------------------------------
    // Guards
    // -----------------------------------------------------------------------
    test.describe('guards', () => {
        test('guards stay put while frozen', async ({ page }) => {
            await startQuiet(page);
            await advance(page, seconds(2));
            const guards = await page.evaluate(() => guards.map((g) => ({ col: g.col, row: g.row })));
            expect(guards).toEqual([{ col: 20, row: 14 }]);
        });

        test('a guard hunts the runner', async ({ page }) => {
            await page.evaluate(() => startGame());
            await place(page, 5, 14);
            await setDir(page, 0, 0);
            await advance(page, seconds(2));
            const guardCol = await page.evaluate(() => guards[0].col);
            expect(guardCol).toBeLessThan(20);
        });

        test('being caught costs a life and resets the level positions', async ({ page }) => {
            await page.evaluate(() => startGame());
            await place(page, 18, 14);
            await setDir(page, 0, 0);
            await advance(page, seconds(1));
            expect(await page.evaluate(() => lives)).toBe(2);
            await page.evaluate(() => {
                guardsEnabled = false;
            });
            await advance(page, seconds(2));
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await cell(page)).toEqual({ col: 1, row: 14 });
            const guards = await page.evaluate(() => guards.map((g) => ({ col: g.col, row: g.row })));
            expect(guards).toEqual([{ col: 20, row: 14 }]);
        });

        test('a guard falls into a hole and is trapped', async ({ page }) => {
            await startQuiet(page);
            await place(page, 10, 10);
            await page.evaluate(() => dig(1));
            await advance(page, seconds(0.6));
            await page.evaluate(() => {
                guards[0].col = 11;
                guards[0].row = 10;
                guards[0].move = null;
                guardsEnabled = true;
            });
            await advance(page, seconds(1));
            const guard = await page.evaluate(() => ({
                col: guards[0].col,
                row: guards[0].row,
                trapped: guards[0].trapped,
            }));
            expect(guard).toMatchObject({ col: 11, row: 11, trapped: true });
        });

        test('a trapped guard climbs back out', async ({ page }) => {
            await startQuiet(page);
            await place(page, 8, 10);
            await page.evaluate(() => dig(1));
            await advance(page, seconds(0.6));
            await place(page, 2, 14);
            await page.evaluate(() => {
                guards[0].col = 9;
                guards[0].row = 10;
                guards[0].move = null;
                guardsEnabled = true;
            });
            await advance(page, seconds(1));
            expect(await page.evaluate(() => guards[0].trapped)).toBe(true);
            await advance(page, seconds(1.6));
            expect(await page.evaluate(() => guards[0].trapped)).toBe(false);
            expect(await page.evaluate(() => guards[0].row)).toBe(10);
        });

        test('a guard buried by a filling hole respawns and scores', async ({ page }) => {
            await startQuiet(page);
            await place(page, 10, 10);
            await page.evaluate(() => dig(1));
            await advance(page, seconds(0.6));
            await page.evaluate(() => {
                guards[0].col = 11;
                guards[0].row = 10;
                guards[0].move = null;
                guardsEnabled = true;
                guardsCanEscape = false;
            });
            // Run up to just before the brick grows back, then freeze the
            // guards so the assertion sees the respawn rather than the chase
            // that immediately follows it.
            await advance(page, seconds(5.5));
            await page.evaluate(() => {
                guardsEnabled = false;
            });
            await advance(page, seconds(1));
            expect(await page.evaluate(() => score)).toBe(75);
            expect(await page.evaluate(() => guards[0].row)).toBe(14);
            expect(await page.evaluate(() => guards[0].col)).toBe(20);
        });
    });

    // -----------------------------------------------------------------------
    // Escaping the level
    // -----------------------------------------------------------------------
    test.describe('escaping', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the exit ladder is hidden while gold remains', async ({ page }) => {
            expect(await page.evaluate(() => exitRevealed)).toBe(false);
            await place(page, 26, 2);
            await setDir(page, 0, -1);
            await advance(page, seconds(1));
            expect(await cell(page)).toEqual({ col: 26, row: 2 });
        });

        test('collecting the last gold reveals the exit ladder', async ({ page }) => {
            await page.evaluate(() => {
                gold.length = 0;
            });
            await advance(page, 1);
            expect(await page.evaluate(() => exitRevealed)).toBe(true);
        });

        test('climbing the exit ladder to the top clears the level', async ({ page }) => {
            await page.evaluate(() => {
                gold.length = 0;
            });
            await advance(page, 1);
            await place(page, 26, 2);
            await setDir(page, 0, -1);
            await advance(page, seconds(1.5));
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('clearing a level scores a bonus and loads the next one', async ({ page }) => {
            await page.evaluate(() => {
                gold.length = 0;
            });
            await advance(page, 1);
            await place(page, 26, 2);
            await setDir(page, 0, -1);
            await advance(page, seconds(1.5));
            await advance(page, seconds(3));
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => score)).toBe(250);
            expect(await page.evaluate(() => gold.length)).toBe(8);
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Lives, game over, pausing
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('running out of lives ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                killRunner();
            });
            await advance(page, seconds(2));
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('the best score is remembered', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 400;
                lives = 1;
                killRunner();
            });
            await advance(page, seconds(2));
            expect(await page.evaluate(() => localStorage.getItem('loderunner-best'))).toBe('400');
            await expect(page.locator('#best')).toHaveText('400');
        });

        test('space starts a fresh game after game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 400;
                lives = 1;
                killRunner();
            });
            await advance(page, seconds(2));
            await page.keyboard.press('Space');
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    test.describe('pausing', () => {
        test('P pauses and resumes the game', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await expect.poll(() => page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);

            const before = await cell(page);
            await setDir(page, 1, 0);
            await advance(page, seconds(1));
            expect(await cell(page)).toEqual(before);

            await page.keyboard.press('p');
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });
});
