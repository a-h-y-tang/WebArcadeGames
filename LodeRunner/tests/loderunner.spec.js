const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Advance roughly `seconds` of game time at 60 fps.
const advanceSeconds = (page, seconds) => advance(page, Math.ceil(seconds * 60));

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so every held key is confirmed against the game state before the
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
        (want) => player.dir.x === want.x && player.dir.y === want.y,
        KEY_DIR[key]
    );
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction(() => player.dir.x === 0 && player.dir.y === 0);
};

// Start a run with the guards switched off, so physics specs stay deterministic.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        guardsEnabled = false;
    });

// Drop the runner onto an exact cell, at rest.
const place = (page, c, r) =>
    page.evaluate(([c, r]) => {
        player.x = c;
        player.y = r;
        player.vx = 0;
        player.vy = 0;
        player.falling = false;
    }, [c, r]);

const cell = (page) => page.evaluate(() => ({ c: Math.round(player.x), r: Math.round(player.y) }));

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

        test('canvas is 672x384', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '672');
            await expect(canvas).toHaveAttribute('height', '384');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('grid is 28 columns by 16 rows', async ({ page }) => {
            const dims = await page.evaluate(() => ({
                cols: COLS,
                rows: ROWS,
                gridRows: grid.length,
                gridCols: grid[0].length,
            }));
            expect(dims).toEqual({ cols: 28, rows: 16, gridRows: 16, gridCols: 28 });
        });
    });

    // -----------------------------------------------------------------------
    // Level data
    // -----------------------------------------------------------------------
    test.describe('level layouts', () => {
        test('three levels ship with the game', async ({ page }) => {
            expect(await page.evaluate(() => LEVELS.length)).toBe(3);
        });

        test('every level is 16 rows of 28 characters', async ({ page }) => {
            const bad = await page.evaluate(() =>
                LEVELS.flatMap((rows, i) =>
                    rows.length !== ROWS
                        ? [`level ${i} has ${rows.length} rows`]
                        : rows
                              .map((row, r) => (row.length !== COLS ? `level ${i} row ${r}` : null))
                              .filter(Boolean)
                )
            );
            expect(bad).toEqual([]);
        });

        test('every level has one start, guards and gold', async ({ page }) => {
            const counts = await page.evaluate(() =>
                LEVELS.map((rows) => {
                    const flat = rows.join('');
                    const n = (ch) => flat.split(ch).length - 1;
                    return { p: n('P'), g: n('G'), gold: n('$') };
                })
            );
            for (const c of counts) {
                expect(c.p).toBe(1);
                expect(c.g).toBeGreaterThan(0);
                expect(c.gold).toBeGreaterThan(0);
            }
        });

        test('every level has a bedrock floor', async ({ page }) => {
            const floors = await page.evaluate(() => LEVELS.map((rows) => rows[ROWS - 1]));
            for (const floor of floors) expect(floor).toMatch(/^=+$/);
        });

        test('every piece of gold is reachable from the start', async ({ page }) => {
            // Walks the same movement graph the guards use, without digging: if
            // this fails a level is unwinnable.
            const missing = await page.evaluate(() => {
                const out = [];
                for (let i = 0; i < LEVELS.length; i++) {
                    loadLevel(i);
                    const seen = reachableFrom(Math.round(player.x), Math.round(player.y));
                    for (const g of golds) {
                        if (!seen.has(`${g.c},${g.r}`)) out.push(`level ${i} gold ${g.c},${g.r}`);
                    }
                }
                return out;
            });
            expect(missing).toEqual([]);
        });

        test('the escape ladders reach the top row once revealed', async ({ page }) => {
            const blocked = await page.evaluate(() => {
                const out = [];
                for (let i = 0; i < LEVELS.length; i++) {
                    loadLevel(i);
                    golds.length = 0;
                    step(0);
                    const seen = reachableFrom(Math.round(player.x), Math.round(player.y));
                    const escaped = [...Array(COLS).keys()].some((c) => seen.has(`${c},0`));
                    if (!escaped) out.push(`level ${i}`);
                }
                return out;
            });
            expect(blocked).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting a run', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the runner starts on the level start cell', async ({ page }) => {
            await startQuiet(page);
            const start = await page.evaluate(() => {
                const rows = LEVELS[0];
                for (let r = 0; r < ROWS; r++) {
                    const c = rows[r].indexOf('P');
                    if (c >= 0) return { c, r };
                }
                return null;
            });
            expect(await cell(page)).toEqual(start);
        });

        test('gold and guards are spawned from the level', async ({ page }) => {
            await startQuiet(page);
            const spawned = await page.evaluate(() => {
                const flat = LEVELS[0].join('');
                return {
                    gold: golds.length,
                    expectedGold: flat.split('$').length - 1,
                    guards: guards.length,
                    expectedGuards: flat.split('G').length - 1,
                    remaining: goldRemaining,
                };
            });
            expect(spawned.gold).toBe(spawned.expectedGold);
            expect(spawned.guards).toBe(spawned.expectedGuards);
            expect(spawned.remaining).toBe(spawned.expectedGold);
        });

        test('the escape ladders stay hidden while gold remains', async ({ page }) => {
            await startQuiet(page);
            const hidden = await page.evaluate(() => ({
                revealed,
                isHidden: grid[1][0] === HIDDEN,
                readsAsEmpty: tileAt(0, 1) === EMPTY,
            }));
            expect(hidden).toEqual({ revealed: false, isHidden: true, readsAsEmpty: true });
        });
    });

    // -----------------------------------------------------------------------
    // Running
    // -----------------------------------------------------------------------
    test.describe('running', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('holding right runs right', async ({ page }) => {
            await place(page, 9, 5);
            await hold(page, 'ArrowRight');
            await advanceSeconds(page, 0.5);
            await release(page, 'ArrowRight');
            expect((await cell(page)).c).toBeGreaterThan(9);
        });

        test('holding left runs left', async ({ page }) => {
            await place(page, 9, 5);
            await hold(page, 'ArrowLeft');
            await advanceSeconds(page, 0.5);
            await release(page, 'ArrowLeft');
            expect((await cell(page)).c).toBeLessThan(9);
        });

        test('A and D also run', async ({ page }) => {
            await place(page, 9, 5);
            await hold(page, 'd');
            await advanceSeconds(page, 0.5);
            await release(page, 'd');
            expect((await cell(page)).c).toBeGreaterThan(9);
        });

        test('brick walls block the runner', async ({ page }) => {
            // Level 3 has a walled pit: bricks at (9,8) and (11,8).
            await page.evaluate(() => loadLevel(2));
            await place(page, 8, 8);
            await hold(page, 'ArrowRight');
            await advanceSeconds(page, 1);
            await release(page, 'ArrowRight');
            expect(await cell(page)).toEqual({ c: 8, r: 8 });
        });

        test('the runner cannot leave the board', async ({ page }) => {
            await place(page, 0, 14);
            await hold(page, 'ArrowLeft');
            await advanceSeconds(page, 1);
            await release(page, 'ArrowLeft');
            expect(await cell(page)).toEqual({ c: 0, r: 14 });
        });

        test('the runner stays put with no input', async ({ page }) => {
            await place(page, 9, 5);
            await advanceSeconds(page, 1);
            expect(await cell(page)).toEqual({ c: 9, r: 5 });
        });
    });

    // -----------------------------------------------------------------------
    // Falling
    // -----------------------------------------------------------------------
    test.describe('falling', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an unsupported runner falls', async ({ page }) => {
            await place(page, 15, 7);
            await advance(page, 5);
            expect(await page.evaluate(() => player.falling)).toBe(true);
        });

        test('a falling runner lands on the floor below', async ({ page }) => {
            await place(page, 15, 7);
            await advanceSeconds(page, 2);
            expect(await cell(page)).toEqual({ c: 15, r: 8 });
            expect(await page.evaluate(() => player.falling)).toBe(false);
        });

        test('a runner standing on brick does not fall', async ({ page }) => {
            await place(page, 9, 5);
            await advanceSeconds(page, 1);
            expect(await page.evaluate(() => player.falling)).toBe(false);
        });

        test('a falling runner stops on a ladder', async ({ page }) => {
            await place(page, 6, 3);
            await page.evaluate(() => {
                player.y = 2.5;
                player.falling = true;
            });
            await advanceSeconds(page, 1);
            expect((await cell(page)).r).toBe(3);
            expect(await page.evaluate(() => player.falling)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Ladders
    // -----------------------------------------------------------------------
    test.describe('ladders', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('holding up climbs a ladder', async ({ page }) => {
            await place(page, 6, 5);
            await hold(page, 'ArrowUp');
            await advanceSeconds(page, 0.5);
            await release(page, 'ArrowUp');
            expect((await cell(page)).r).toBeLessThan(5);
        });

        test('holding down climbs back down', async ({ page }) => {
            await place(page, 6, 3);
            await hold(page, 'ArrowDown');
            await advanceSeconds(page, 0.5);
            await release(page, 'ArrowDown');
            expect((await cell(page)).r).toBeGreaterThan(3);
        });

        test('the runner stops at the top of a ladder', async ({ page }) => {
            await place(page, 6, 5);
            await hold(page, 'ArrowUp');
            await advanceSeconds(page, 3);
            await release(page, 'ArrowUp');
            expect(await cell(page)).toEqual({ c: 6, r: 2 });
        });

        test('standing on top of a ladder is solid ground', async ({ page }) => {
            await place(page, 6, 2);
            await advanceSeconds(page, 1);
            expect(await cell(page)).toEqual({ c: 6, r: 2 });
            expect(await page.evaluate(() => player.falling)).toBe(false);
        });

        test('the runner can step off a ladder sideways', async ({ page }) => {
            await place(page, 6, 5);
            await hold(page, 'ArrowLeft');
            await advanceSeconds(page, 0.5);
            await release(page, 'ArrowLeft');
            expect((await cell(page)).c).toBeLessThan(6);
        });
    });

    // -----------------------------------------------------------------------
    // Ropes
    // -----------------------------------------------------------------------
    test.describe('ropes', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a rope holds the runner up', async ({ page }) => {
            await place(page, 15, 5);
            await advanceSeconds(page, 1);
            expect(await cell(page)).toEqual({ c: 15, r: 5 });
            expect(await page.evaluate(() => player.falling)).toBe(false);
        });

        test('the runner travels hand-over-hand along a rope', async ({ page }) => {
            await place(page, 14, 5);
            await hold(page, 'ArrowRight');
            await advanceSeconds(page, 0.5);
            await release(page, 'ArrowRight');
            const at = await cell(page);
            expect(at.c).toBeGreaterThan(14);
            expect(at.r).toBe(5);
        });

        test('pressing down drops off the rope', async ({ page }) => {
            // Let go of down straight away: held, it would carry on down the
            // ladder that stands under the landing.
            await place(page, 15, 5);
            await hold(page, 'ArrowDown');
            await advanceSeconds(page, 0.1);
            await release(page, 'ArrowDown');
            await advanceSeconds(page, 2);
            expect(await cell(page)).toEqual({ c: 15, r: 8 });
            expect(await page.evaluate(() => player.falling)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Gold
    // -----------------------------------------------------------------------
    test.describe('gold', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('running over gold collects it', async ({ page }) => {
            const before = await page.evaluate(() => goldRemaining);
            await place(page, 7, 2);
            await hold(page, 'ArrowRight');
            await advanceSeconds(page, 1);
            await release(page, 'ArrowRight');
            const after = await page.evaluate(() => ({
                remaining: goldRemaining,
                score,
                left: golds.filter((g) => g.c === 8 && g.r === 2).length,
            }));
            expect(after.remaining).toBe(before - 1);
            expect(after.score).toBe(GOLD_POINTS_EXPECTED);
            expect(after.left).toBe(0);
        });

        test('the HUD shows the gold still on the board', async ({ page }) => {
            const remaining = await page.evaluate(() => goldRemaining);
            await expect(page.locator('#gold')).toHaveText(String(remaining));
        });

        test('collecting the last gold reveals the escape ladders', async ({ page }) => {
            await page.evaluate(() => {
                golds.length = 0;
                step(1 / 60);
            });
            const after = await page.evaluate(() => ({
                revealed,
                tile: tileAt(0, 1),
                remaining: goldRemaining,
            }));
            expect(after.revealed).toBe(true);
            expect(after.tile).toBe(await page.evaluate(() => LADDER));
            expect(after.remaining).toBe(0);
        });

        test('gold carried by a guard still counts as remaining', async ({ page }) => {
            const before = await page.evaluate(() => goldRemaining);
            await page.evaluate(() => {
                golds.length = 0;
                guards[0].gold = true;
                step(1 / 60);
            });
            const after = await page.evaluate(() => ({ revealed, remaining: goldRemaining }));
            expect(before).toBeGreaterThan(0);
            expect(after.remaining).toBe(1);
            expect(after.revealed).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Digging
    // -----------------------------------------------------------------------
    test.describe('digging', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await place(page, 9, 5);
        });

        test('X digs the brick down-right', async ({ page }) => {
            await page.keyboard.press('x');
            const after = await page.evaluate(() => ({
                tile: tileAt(10, 6),
                holes: holes.length,
                hole: holes[0] && { c: holes[0].c, r: holes[0].r },
            }));
            expect(after.tile).toBe(await page.evaluate(() => EMPTY));
            expect(after.holes).toBe(1);
            expect(after.hole).toEqual({ c: 10, r: 6 });
        });

        test('Z digs the brick down-left', async ({ page }) => {
            await page.keyboard.press('z');
            expect(await page.evaluate(() => tileAt(8, 6))).toBe(await page.evaluate(() => EMPTY));
        });

        test('bedrock cannot be dug', async ({ page }) => {
            await place(page, 9, 14);
            await page.keyboard.press('x');
            const after = await page.evaluate(() => ({ tile: tileAt(10, 15), holes: holes.length }));
            expect(after.tile).toBe(await page.evaluate(() => SOLID));
            expect(after.holes).toBe(0);
        });

        test('the runner cannot dig while on a ladder', async ({ page }) => {
            // (22,8) is a ladder rung with diggable brick at (23,9).
            await place(page, 22, 8);
            await page.keyboard.press('x');
            const after = await page.evaluate(() => ({ tile: tileAt(23, 9), holes: holes.length }));
            expect(after.tile).toBe(await page.evaluate(() => BRICK));
            expect(after.holes).toBe(0);
        });

        test('the runner cannot dig while hanging on a rope', async ({ page }) => {
            // (18,5) is the last rope cell, with diggable brick at (19,6).
            await place(page, 18, 5);
            await page.keyboard.press('x');
            const after = await page.evaluate(() => ({ tile: tileAt(19, 6), holes: holes.length }));
            expect(after.tile).toBe(await page.evaluate(() => BRICK));
            expect(after.holes).toBe(0);
        });

        test('the runner cannot dig while falling', async ({ page }) => {
            await page.evaluate(() => {
                player.falling = true;
            });
            await page.keyboard.press('x');
            const after = await page.evaluate(() => ({ tile: tileAt(10, 6), holes: holes.length }));
            expect(after.tile).toBe(await page.evaluate(() => BRICK));
            expect(after.holes).toBe(0);
        });

        test('a dug hole lets the runner drop through the floor', async ({ page }) => {
            await page.keyboard.press('x');
            await hold(page, 'ArrowRight');
            await advanceSeconds(page, 2);
            await release(page, 'ArrowRight');
            expect((await cell(page)).r).toBe(8);
        });

        test('the hole grows back after a while', async ({ page }) => {
            await page.keyboard.press('x');
            await advanceSeconds(page, HOLE_SECONDS_EXPECTED + 0.5);
            const after = await page.evaluate(() => ({ tile: tileAt(10, 6), holes: holes.length }));
            expect(after.tile).toBe(await page.evaluate(() => BRICK));
            expect(after.holes).toBe(0);
        });

        test('the runner is crushed by a hole that grows back around them', async ({ page }) => {
            await page.keyboard.press('x');
            await page.evaluate(() => {
                player.x = 10;
                player.y = 6;
                holes[0].timer = 0.001;
                step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('dying');
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Guards
    // -----------------------------------------------------------------------
    test.describe('guards', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => startGame());
        });

        test('a guard hunts the runner', async ({ page }) => {
            const before = await page.evaluate(() => {
                player.x = 20;
                player.y = 5;
                guards.length = 1;
                guards[0].x = 12;
                guards[0].y = 5;
                return guards[0].x;
            });
            await advanceSeconds(page, 1);
            expect(await page.evaluate(() => guards[0].x)).toBeGreaterThan(before);
        });

        test('a guard finds a route on another floor', async ({ page }) => {
            await page.evaluate(() => {
                player.x = 9;
                player.y = 8;
                guards.length = 1;
                guards[0].x = 3;
                guards[0].y = 5;
            });
            // Short window on purpose: given longer the guard catches the
            // runner, the level resets and the guard is back at its spawn.
            await advanceSeconds(page, 1.2);
            const guard = await page.evaluate(() => ({
                c: Math.round(guards[0].x),
                r: Math.round(guards[0].y),
            }));
            expect(guard.r).toBeGreaterThan(5);
        });

        test('a guard that falls into a hole is trapped and scores', async ({ page }) => {
            await page.evaluate(() => {
                player.x = 9;
                player.y = 5;
                guards.length = 1;
                dig(1);
                guards[0].x = 10;
                guards[0].y = 5;
                guards[0].gold = false;
                score = 0;
            });
            await advanceSeconds(page, 1);
            const after = await page.evaluate(() => ({
                trapped: guards[0].trapped > 0,
                r: Math.round(guards[0].y),
                score,
            }));
            expect(after.trapped).toBe(true);
            expect(after.r).toBe(6);
            expect(after.score).toBe(TRAP_POINTS_EXPECTED);
        });

        test('a trapped guard climbs back out', async ({ page }) => {
            await page.evaluate(() => {
                player.x = 9;
                player.y = 5;
                guards.length = 1;
                dig(1);
                guards[0].x = 10;
                guards[0].y = 5;
            });
            await advanceSeconds(page, 1);
            expect(await page.evaluate(() => guards[0].trapped > 0)).toBe(true);
            await advanceSeconds(page, TRAP_SECONDS_EXPECTED + 0.5);
            const after = await page.evaluate(() => ({
                trapped: guards[0].trapped > 0,
                r: Math.round(guards[0].y),
            }));
            expect(after.trapped).toBe(false);
            expect(after.r).toBeLessThan(6);
        });

        test('a trapped guard drops its gold on the lip of the hole', async ({ page }) => {
            await page.evaluate(() => {
                player.x = 9;
                player.y = 5;
                guards.length = 1;
                dig(1);
                guards[0].x = 10;
                guards[0].y = 5;
                guards[0].gold = true;
            });
            await advanceSeconds(page, 1);
            const after = await page.evaluate(() => ({
                carrying: guards[0].gold,
                dropped: golds.some((g) => g.c === 10 && g.r === 5),
            }));
            expect(after.carrying).toBe(false);
            expect(after.dropped).toBe(true);
        });

        test('a guard crushed by a closing hole respawns', async ({ page }) => {
            await page.evaluate(() => {
                player.x = 9;
                player.y = 5;
                guards.length = 1;
                dig(1);
                guards[0].x = 10;
                guards[0].y = 6;
                guards[0].trapped = 10;
                score = 0;
                holes[0].timer = 0.001;
                step(1 / 60);
            });
            const after = await page.evaluate(() => ({ dead: guards[0].dead > 0, score }));
            expect(after.dead).toBe(true);
            expect(after.score).toBe(CRUSH_POINTS_EXPECTED);
            await advanceSeconds(page, 3);
            expect(await page.evaluate(() => guards[0].dead)).toBe(0);
        });

        test('a guard picks up gold it runs over', async ({ page }) => {
            await page.evaluate(() => {
                guards.length = 1;
                guards[0].x = 8;
                guards[0].y = 2;
                guards[0].gold = false;
                golds.length = 0;
                golds.push({ c: 8, r: 2 });
                step(1 / 60);
            });
            const after = await page.evaluate(() => ({ gold: guards[0].gold, left: golds.length }));
            expect(after).toEqual({ gold: true, left: 0 });
        });

        test('touching a guard costs a life', async ({ page }) => {
            await page.evaluate(() => {
                player.x = 9;
                player.y = 5;
                guards.length = 1;
                guards[0].x = 9;
                guards[0].y = 5;
                guards[0].trapped = 0;
                step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('dying');
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a trapped guard is harmless', async ({ page }) => {
            await page.evaluate(() => {
                player.x = 9;
                player.y = 5;
                guards.length = 1;
                guards[0].x = 9;
                guards[0].y = 5;
                guards[0].trapped = 5;
                step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Dying and game over
    // -----------------------------------------------------------------------
    test.describe('dying', () => {
        test('the level restarts after a death', async ({ page }) => {
            await startQuiet(page);
            const start = await cell(page);
            await page.evaluate(() => {
                golds.pop();
                killPlayer();
            });
            await advanceSeconds(page, 3);
            const after = await page.evaluate(() => ({
                state,
                lives,
                gold: goldRemaining,
                expected: LEVELS[0].join('').split('$').length - 1,
            }));
            expect(after.state).toBe('running');
            expect(after.lives).toBe(2);
            expect(after.gold).toBe(after.expected);
            expect(await cell(page)).toEqual(start);
        });

        test('the score survives a death', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 500;
                killPlayer();
            });
            await advanceSeconds(page, 3);
            expect(await page.evaluate(() => score)).toBe(500);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                killPlayer();
            });
            await advanceSeconds(page, 3);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('Space starts a fresh run after game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                score = 900;
                killPlayer();
            });
            await advanceSeconds(page, 3);
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => ({ state, score, lives, level }));
            expect(after).toEqual({ state: 'running', score: 0, lives: 3, level: 1 });
        });

        test('the best score is remembered', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                score = 1234;
                killPlayer();
            });
            await advanceSeconds(page, 3);
            expect(await page.evaluate(() => localStorage.getItem('loderunner-best'))).toBe('1234');
            await expect(page.locator('#best')).toHaveText('1234');
        });
    });

    // -----------------------------------------------------------------------
    // Clearing a level
    // -----------------------------------------------------------------------
    test.describe('clearing a level', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('reaching the top with gold left does nothing', async ({ page }) => {
            await place(page, 6, 2);
            await page.evaluate(() => {
                player.y = 0;
                step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('reaching the top after the last gold clears the level', async ({ page }) => {
            await page.evaluate(() => {
                golds.length = 0;
                step(1 / 60);
                player.x = 0;
                player.y = 0;
                step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('clearing a level scores and advances', async ({ page }) => {
            await page.evaluate(() => {
                score = 0;
                golds.length = 0;
                step(1 / 60);
                player.x = 0;
                player.y = 0;
                step(1 / 60);
            });
            await advanceSeconds(page, 4);
            const after = await page.evaluate(() => ({ state, level, score, gold: goldRemaining }));
            expect(after.state).toBe('running');
            expect(after.level).toBe(2);
            expect(after.score).toBe(LEVEL_POINTS_EXPECTED);
            expect(after.gold).toBeGreaterThan(0);
        });

        test('levels cycle once the last one is cleared', async ({ page }) => {
            await page.evaluate(() => {
                level = LEVELS.length;
                loadLevel(LEVELS.length - 1);
                golds.length = 0;
                step(1 / 60);
                player.x = Math.round(player.x);
                player.y = 0;
                step(1 / 60);
            });
            await advanceSeconds(page, 4);
            const after = await page.evaluate(() => ({ state, level, gold: goldRemaining }));
            expect(after.state).toBe('running');
            expect(after.level).toBe(4);
            expect(after.gold).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing and HUD
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and freezes the simulation', async ({ page }) => {
            await startQuiet(page);
            await place(page, 9, 5);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await hold(page, 'ArrowRight');
            await advanceSeconds(page, 1);
            await release(page, 'ArrowRight');
            expect(await cell(page)).toEqual({ c: 9, r: 5 });
        });

        test('P resumes the game', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the pause overlay is visible while paused', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });
    });

    test.describe('HUD', () => {
        test('the HUD tracks score, level, lives and gold', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 750;
                lives = 2;
                level = 3;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('750');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#level')).toHaveText('3');
            await expect(page.locator('#gold')).toHaveText(
                String(await page.evaluate(() => goldRemaining))
            );
        });

        test('the canvas is actually painted', async ({ page }) => {
            await startQuiet(page);
            const painted = await page.evaluate(() => {
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                    if (seen.size > 4) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });
    });
});

// Expected scoring / timing constants, asserted against the implementation so a
// change to the rules has to be a deliberate edit in both places.
const GOLD_POINTS_EXPECTED = 250;
const TRAP_POINTS_EXPECTED = 75;
const CRUSH_POINTS_EXPECTED = 150;
const LEVEL_POINTS_EXPECTED = 1500;
const HOLE_SECONDS_EXPECTED = 5;
const TRAP_SECONDS_EXPECTED = 3;

test.describe('rules constants', () => {
    test('the implementation uses the documented scoring and timings', async ({ page }) => {
        await page.goto(GAME_URL);
        const actual = await page.evaluate(() => ({
            gold: GOLD_POINTS,
            trap: TRAP_POINTS,
            crush: CRUSH_POINTS,
            level: LEVEL_POINTS,
            hole: HOLE_TIME,
            climbOut: TRAP_CLIMB,
        }));
        expect(actual).toEqual({
            gold: GOLD_POINTS_EXPECTED,
            trap: TRAP_POINTS_EXPECTED,
            crush: CRUSH_POINTS_EXPECTED,
            level: LEVEL_POINTS_EXPECTED,
            hole: HOLE_SECONDS_EXPECTED,
            climbOut: TRAP_SECONDS_EXPECTED,
        });
    });
});
