const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

const advanceSeconds = (page, seconds) => advance(page, Math.round(seconds * 60));

// The game's tuning constants, read out of the page.
const rules = (page) =>
    page.evaluate(() => ({
        GOLD_POINTS,
        ENEMY_POINTS,
        LEVEL_BONUS,
        HOLE_FILL_SECONDS,
        HOLE,
        BRICK,
    }));

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so key presses are confirmed against the game's own held-key set before
// the simulation is advanced.
const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction((k) => heldKeys.has(k), key);
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction((k) => !heldKeys.has(k), key);
};

// Start a level with the enemies removed, so long simulations stay
// deterministic. Specs that are about enemies leave them in place.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        enemies.length = 0;
    });

const place = (page, col, row) =>
    page.evaluate(([c, r]) => placeActor(player, c, r), [col, row]);

const cell = (page) => page.evaluate(() => ({ col: player.col, row: player.row }));

test.describe('Lode Runner', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // Take the animation loop out of the picture so every spec below drives
        // the simulation itself, one exact frame at a time.
        await page.evaluate(() => {
            autoStep = false;
        });
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Lode Runner', async ({ page }) => {
            await expect(page).toHaveTitle('Lode Runner');
        });

        test('canvas matches the tile grid', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '672');
            await expect(canvas).toHaveAttribute('height', '384');
        });

        test('starts idle with the overlay showing', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toHaveText('LODE RUNNER');
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('HUD shows the gold remaining on level 1', async ({ page }) => {
            const remaining = await page.evaluate(() => goldRemaining);
            expect(remaining).toBeGreaterThan(0);
            await expect(page.locator('#gold')).toHaveText(String(remaining));
        });

        test('step() does nothing while idle', async ({ page }) => {
            const before = await cell(page);
            await advance(page, 60);
            expect(await cell(page)).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Level data
    // -----------------------------------------------------------------------
    test.describe('level data', () => {
        test('every level is a 28x16 grid', async ({ page }) => {
            const shapes = await page.evaluate(() =>
                LEVELS.map((rows) => ({
                    rows: rows.length,
                    widths: [...new Set(rows.map((r) => r.length))],
                }))
            );
            expect(shapes.length).toBeGreaterThanOrEqual(3);
            for (const shape of shapes) {
                expect(shape.rows).toBe(16);
                expect(shape.widths).toEqual([28]);
            }
        });

        test('every level has exactly one player spawn', async ({ page }) => {
            const counts = await page.evaluate(() =>
                LEVELS.map((rows) => rows.join('').split('P').length - 1)
            );
            expect(counts.every((c) => c === 1)).toBe(true);
        });

        test('every level has gold and enemies', async ({ page }) => {
            const stats = await page.evaluate(() =>
                LEVELS.map((rows) => {
                    const flat = rows.join('');
                    return {
                        gold: flat.split('$').length - 1,
                        enemies: flat.split('E').length - 1,
                    };
                })
            );
            for (const s of stats) {
                expect(s.gold).toBeGreaterThan(0);
                expect(s.enemies).toBeGreaterThan(0);
            }
        });

        test('every escape ladder runs unbroken to the top row', async ({ page }) => {
            const ok = await page.evaluate(() =>
                LEVELS.every((rows) => {
                    const cols = [...rows[0]]
                        .map((ch, c) => (ch === 'S' ? c : -1))
                        .filter((c) => c >= 0);
                    if (!cols.length) return false;
                    return cols.some((c) => rows.every((row, r) => r === 15 || row[c] === 'S'));
                })
            );
            expect(ok).toBe(true);
        });

        // Walks the level with the runner's own movement rules — including the
        // dig-and-drop that is the only way into a sealed pocket — so a level
        // can never ship with gold or an exit that cannot be reached.
        test('every coin and the exit are reachable from the spawn', async ({ page }) => {
            const results = await page.evaluate(() => {
                const flood = (startCol, startRow) => {
                    const seen = new Set([startRow * COLS + startCol]);
                    const queue = [[startCol, startRow]];
                    const push = (c, r) => {
                        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
                        const id = r * COLS + c;
                        if (seen.has(id)) return;
                        seen.add(id);
                        queue.push([c, r]);
                    };
                    while (queue.length) {
                        const [c, r] = queue.pop();
                        if (!isSupported(c, r)) {
                            if (passable(c, r + 1)) push(c, r + 1);
                            continue;
                        }
                        if (climbable(c, r) && climbable(c, r - 1)) push(c, r - 1);
                        if (passable(c, r + 1)) push(c, r + 1);
                        if (passable(c - 1, r)) push(c - 1, r);
                        if (passable(c + 1, r)) push(c + 1, r);
                        for (const d of [-1, 1]) {
                            if (tileAt(c + d, r + 1) === BRICK && passable(c + d, r)) push(c + d, r + 1);
                        }
                    }
                    return seen;
                };

                return LEVELS.map((rows, index) => {
                    loadLevel(index);
                    const fromSpawn = flood(player.spawnCol, player.spawnRow);
                    const unreachableGold = goldCells.filter(
                        (g) => !fromSpawn.has(g.row * COLS + g.col)
                    ).length;
                    escapeRevealed = true;
                    const withExit = flood(player.spawnCol, player.spawnRow);
                    const exitCol = rows[0].indexOf('S');
                    return { unreachableGold, exitReached: withExit.has(exitCol) };
                });
            });
            for (const level of results) {
                expect(level.unreachableGold).toBe(0);
                expect(level.exitReached).toBe(true);
            }
        });

        test('loadLevel builds the grid from the level strings', async ({ page }) => {
            const info = await page.evaluate(() => {
                loadLevel(0);
                return {
                    rows: grid.length,
                    cols: grid[0].length,
                    bottomSolid: grid[ROWS - 1].every((t) => t === SOLID),
                    gold: goldCells.length,
                    enemies: enemies.length,
                };
            });
            expect(info.rows).toBe(16);
            expect(info.cols).toBe(28);
            expect(info.bottomSolid).toBe(true);
            expect(info.gold).toBeGreaterThan(0);
            expect(info.enemies).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press(' ');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the player spawns on the level P marker', async ({ page }) => {
            const spawn = await page.evaluate(() => {
                startGame();
                const rows = LEVELS[0];
                const row = rows.findIndex((r) => r.includes('P'));
                return { col: rows[row].indexOf('P'), row, at: { col: player.col, row: player.row } };
            });
            expect(spawn.at).toEqual({ col: spawn.col, row: spawn.row });
        });
    });

    // -----------------------------------------------------------------------
    // Walking
    // -----------------------------------------------------------------------
    test.describe('walking', () => {
        test('holding right walks one cell per move', async ({ page }) => {
            await startQuiet(page);
            await place(page, 10, 14);
            await hold(page, 'ArrowRight');
            await advance(page, 10);
            await release(page, 'ArrowRight');
            expect(await cell(page)).toEqual({ col: 11, row: 14 });
        });

        test('holding left walks the other way', async ({ page }) => {
            await startQuiet(page);
            await place(page, 10, 14);
            await hold(page, 'ArrowLeft');
            await advance(page, 20);
            await release(page, 'ArrowLeft');
            expect(await cell(page)).toEqual({ col: 8, row: 14 });
        });

        test('A and D work as well as the arrow keys', async ({ page }) => {
            await startQuiet(page);
            await place(page, 10, 14);
            await hold(page, 'd');
            await advance(page, 10);
            await release(page, 'd');
            expect((await cell(page)).col).toBe(11);
        });

        test('the player cannot walk off the left edge', async ({ page }) => {
            await startQuiet(page);
            await place(page, 0, 14);
            await hold(page, 'ArrowLeft');
            await advance(page, 30);
            await release(page, 'ArrowLeft');
            expect((await cell(page)).col).toBe(0);
        });

        test('brick blocks horizontal movement', async ({ page }) => {
            await startQuiet(page);
            await place(page, 10, 14);
            await page.evaluate(() => setTile(11, 14, BRICK));
            await hold(page, 'ArrowRight');
            await advance(page, 30);
            await release(page, 'ArrowRight');
            expect((await cell(page)).col).toBe(10);
        });

        test('releasing the key stops the player on a cell boundary', async ({ page }) => {
            await startQuiet(page);
            await place(page, 10, 14);
            await hold(page, 'ArrowRight');
            await advance(page, 10);
            await release(page, 'ArrowRight');
            await advance(page, 30);
            const snapped = await page.evaluate(() => ({
                col: player.col,
                moving: player.moving,
                onGrid: player.x === cellX(player.col) && player.y === cellY(player.row),
            }));
            expect(snapped).toEqual({ col: 11, moving: false, onGrid: true });
        });
    });

    // -----------------------------------------------------------------------
    // Falling
    // -----------------------------------------------------------------------
    test.describe('falling', () => {
        // Column 26 of level 1 is an open shaft from row 4 down to the floor.
        test('an unsupported player falls to the floor below', async ({ page }) => {
            await startQuiet(page);
            await place(page, 26, 4);
            await advance(page, 120);
            expect(await cell(page)).toEqual({ col: 26, row: 14 });
        });

        test('falling is flagged while it happens', async ({ page }) => {
            await startQuiet(page);
            await place(page, 26, 4);
            await advance(page, 3);
            expect(await page.evaluate(() => player.mode)).toBe('fall');
        });

        test('the player cannot steer while falling', async ({ page }) => {
            await startQuiet(page);
            await place(page, 26, 4);
            await hold(page, 'ArrowLeft');
            await advance(page, 12);
            await release(page, 'ArrowLeft');
            expect((await cell(page)).col).toBe(26);
        });

        test('a falling player lands on top of a ladder', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => setTile(26, 9, LADDER));
            await place(page, 26, 4);
            await advance(page, 60);
            expect(await cell(page)).toEqual({ col: 26, row: 8 });
        });

        test('a rope catches a falling player', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => setTile(26, 9, ROPE));
            await place(page, 26, 4);
            await advance(page, 60);
            expect(await cell(page)).toEqual({ col: 26, row: 9 });
        });

        test('a hidden escape ladder is only air to fall through', async ({ page }) => {
            await startQuiet(page);
            const col = await page.evaluate(() => LEVELS[0][0].indexOf('S'));
            await place(page, col, 1);
            await advance(page, 120);
            expect(await cell(page)).toEqual({ col, row: 14 });
        });
    });

    // -----------------------------------------------------------------------
    // Ladders and ropes
    // -----------------------------------------------------------------------
    test.describe('ladders', () => {
        test('holding up climbs a ladder', async ({ page }) => {
            await startQuiet(page);
            await place(page, 5, 14);
            await hold(page, 'ArrowUp');
            await advance(page, 36);
            await release(page, 'ArrowUp');
            expect(await cell(page)).toEqual({ col: 5, row: 11 });
        });

        test('the player cannot climb past the top of a ladder', async ({ page }) => {
            await startQuiet(page);
            await place(page, 5, 11);
            await hold(page, 'ArrowUp');
            await advance(page, 60);
            await release(page, 'ArrowUp');
            expect(await cell(page)).toEqual({ col: 5, row: 11 });
        });

        test('holding down climbs back down', async ({ page }) => {
            await startQuiet(page);
            await place(page, 5, 12);
            await hold(page, 'ArrowDown');
            await advance(page, 24);
            await release(page, 'ArrowDown');
            expect(await cell(page)).toEqual({ col: 5, row: 14 });
        });

        test('the player can step off a ladder onto a floor', async ({ page }) => {
            await startQuiet(page);
            await place(page, 5, 11);
            await hold(page, 'ArrowRight');
            await advance(page, 10);
            await release(page, 'ArrowRight');
            expect(await cell(page)).toEqual({ col: 6, row: 11 });
        });

        test('up does nothing without a ladder', async ({ page }) => {
            await startQuiet(page);
            await place(page, 10, 14);
            await hold(page, 'ArrowUp');
            await advance(page, 30);
            await release(page, 'ArrowUp');
            expect(await cell(page)).toEqual({ col: 10, row: 14 });
        });
    });

    test.describe('ropes', () => {
        test('a rope holds the player up', async ({ page }) => {
            await startQuiet(page);
            await place(page, 12, 7);
            await advance(page, 30);
            expect(await cell(page)).toEqual({ col: 12, row: 7 });
        });

        test('the player can travel hand over hand along a rope', async ({ page }) => {
            await startQuiet(page);
            await place(page, 12, 7);
            await hold(page, 'ArrowRight');
            await advance(page, 20);
            await release(page, 'ArrowRight');
            expect(await cell(page)).toEqual({ col: 14, row: 7 });
        });

        test('pressing down drops off the rope', async ({ page }) => {
            await startQuiet(page);
            await place(page, 12, 7);
            await hold(page, 'ArrowDown');
            await advance(page, 20);
            await release(page, 'ArrowDown');
            expect(await cell(page)).toEqual({ col: 12, row: 8 });
        });
    });

    // -----------------------------------------------------------------------
    // Gold and finishing a level
    // -----------------------------------------------------------------------
    test.describe('gold', () => {
        test('walking over gold scores points and clears the cell', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => {
                const g = goldCells[0];
                placeActor(player, g.col - 1, g.row);
                return { score, remaining: goldRemaining, col: g.col, row: g.row };
            });
            await hold(page, 'ArrowRight');
            await advance(page, 12);
            await release(page, 'ArrowRight');
            const after = await page.evaluate(
                ([c, r]) => ({
                    score,
                    remaining: goldRemaining,
                    stillThere: goldCells.some((g) => g.col === c && g.row === r),
                }),
                [before.col, before.row]
            );
            const { GOLD_POINTS } = await rules(page);
            expect(after.score).toBe(before.score + GOLD_POINTS);
            expect(after.remaining).toBe(before.remaining - 1);
            expect(after.stillThere).toBe(false);
        });

        test('the HUD gold counter follows the level', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const g = goldCells[0];
                placeActor(player, g.col - 1, g.row);
            });
            const before = await page.evaluate(() => goldRemaining);
            await hold(page, 'ArrowRight');
            await advance(page, 12);
            await release(page, 'ArrowRight');
            await expect(page.locator('#gold')).toHaveText(String(before - 1));
        });

        test('the escape ladder stays hidden until the last coin', async ({ page }) => {
            await startQuiet(page);
            const state1 = await page.evaluate(() => escapeRevealed);
            expect(state1).toBe(false);
            const state2 = await page.evaluate(() => {
                while (goldCells.length > 1) takeGold(goldCells[0]);
                return escapeRevealed;
            });
            expect(state2).toBe(false);
        });

        test('collecting every coin reveals the escape ladder', async ({ page }) => {
            await startQuiet(page);
            const revealed = await page.evaluate(() => {
                while (goldCells.length) takeGold(goldCells[0]);
                return { escapeRevealed, goldRemaining };
            });
            expect(revealed).toEqual({ escapeRevealed: true, goldRemaining: 0 });
        });

        test('the escape ladder is only climbable once revealed', async ({ page }) => {
            await startQuiet(page);
            const escape = await page.evaluate(() => {
                const c = LEVELS[0][0].indexOf('S');
                return { col: c, before: climbable(c, 2) };
            });
            expect(escape.before).toBe(false);
            const after = await page.evaluate((c) => {
                while (goldCells.length) takeGold(goldCells[0]);
                return climbable(c, 2);
            }, escape.col);
            expect(after).toBe(true);
        });
    });

    test.describe('finishing a level', () => {
        const escapeToTop = async (page) => {
            await startQuiet(page);
            await page.evaluate(() => {
                while (goldCells.length) takeGold(goldCells[0]);
                placeActor(player, LEVELS[0][0].indexOf('S'), 1);
            });
            await hold(page, 'ArrowUp');
            await advance(page, 20);
            await release(page, 'ArrowUp');
        };

        test('reaching the top clears the level', async ({ page }) => {
            await escapeToTop(page);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('clearing a level awards the level bonus', async ({ page }) => {
            await escapeToTop(page);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(
                await page.evaluate(() => LEVEL_BONUS)
            );
        });

        test('Space moves on to the next level', async ({ page }) => {
            await escapeToTop(page);
            await page.keyboard.press(' ');
            const next = await page.evaluate(() => ({ levelIndex, state }));
            expect(next).toEqual({ levelIndex: 1, state: 'playing' });
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('clearing the last level wins the game', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                levelIndex = LEVELS.length - 1;
                loadLevel(levelIndex);
                enemies.length = 0;
                while (goldCells.length) takeGold(goldCells[0]);
                placeActor(player, LEVELS[levelIndex][0].indexOf('S'), 1);
            });
            await hold(page, 'ArrowUp');
            await advance(page, 20);
            await release(page, 'ArrowUp');
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Digging
    // -----------------------------------------------------------------------
    test.describe('digging', () => {
        test('X digs the brick down and to the right', async ({ page }) => {
            await startQuiet(page);
            await place(page, 10, 11);
            await page.keyboard.press('x');
            expect(await page.evaluate(() => tileAt(11, 12))).toBe(await page.evaluate(() => HOLE));
        });

        test('Z digs the brick down and to the left', async ({ page }) => {
            await startQuiet(page);
            await place(page, 10, 11);
            await page.keyboard.press('z');
            expect(await page.evaluate(() => tileAt(9, 12))).toBe(await page.evaluate(() => HOLE));
        });

        test('a dug hole can be fallen through', async ({ page }) => {
            await startQuiet(page);
            await place(page, 10, 11);
            await page.evaluate(() => dig(1));
            await place(page, 11, 11);
            await advance(page, 30);
            expect((await cell(page)).row).toBeGreaterThan(11);
        });

        test('digging fails when there is no brick to dig', async ({ page }) => {
            await startQuiet(page);
            await place(page, 10, 14);
            const dug = await page.evaluate(() => dig(1));
            expect(dug).toBe(false);
        });

        test('digging fails on a ladder', async ({ page }) => {
            await startQuiet(page);
            await place(page, 5, 13);
            const dug = await page.evaluate(() => dig(1));
            expect(dug).toBe(false);
        });

        test('digging fails while falling', async ({ page }) => {
            await startQuiet(page);
            await place(page, 12, 3);
            await advance(page, 3);
            const dug = await page.evaluate(() => dig(1));
            expect(dug).toBe(false);
        });

        test('a hole fills itself back in', async ({ page }) => {
            const { HOLE_FILL_SECONDS, HOLE, BRICK } = await rules(page);
            await startQuiet(page);
            await place(page, 10, 11);
            await page.evaluate(() => dig(1));
            await advanceSeconds(page, 1);
            expect(await page.evaluate(() => tileAt(11, 12))).toBe(HOLE);
            await advanceSeconds(page, HOLE_FILL_SECONDS);
            expect(await page.evaluate(() => tileAt(11, 12))).toBe(BRICK);
        });

        test('being caught in a closing hole costs a life', async ({ page }) => {
            const { HOLE_FILL_SECONDS } = await rules(page);
            await startQuiet(page);
            const before = await page.evaluate(() => {
                placeActor(player, 10, 11);
                dig(1);
                setTile(11, 13, BRICK);   // give the pit a floor to stand on
                placeActor(player, 11, 12);
                return lives;
            });
            await advanceSeconds(page, HOLE_FILL_SECONDS + 0.5);
            expect(await page.evaluate(() => lives)).toBe(before - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('one enemy spawns per E marker', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                return { spawned: enemies.length, markers: LEVELS[0].join('').split('E').length - 1 };
            });
            expect(counts.spawned).toBe(counts.markers);
        });

        test('enemies hunt the player', async ({ page }) => {
            const closing = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                placeActor(enemies[0], 20, 14);
                placeActor(player, 10, 14);
                const before = Math.abs(enemies[0].col - player.col);
                for (let i = 0; i < 240; i++) step(1 / 60);
                return { before, after: Math.abs(enemies[0].col - player.col) };
            });
            expect(closing.after).toBeLessThan(closing.before);
        });

        test('an enemy that falls into a hole is trapped', async ({ page }) => {
            const trapped = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                placeActor(player, 0, 14);
                placeActor(enemies[0], 11, 11);
                setTile(11, 12, HOLE);
                holes.push({ col: 11, row: 12, timer: HOLE_FILL_SECONDS });
                for (let i = 0; i < 40; i++) step(1 / 60);
                return { row: enemies[0].row, trapped: enemies[0].trapped };
            });
            expect(trapped).toEqual({ row: 12, trapped: true });
        });

        test('a trapped enemy climbs back out', async ({ page }) => {
            const out = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                placeActor(player, 0, 14);
                placeActor(enemies[0], 11, 12);
                setTile(11, 12, HOLE);
                holes.push({ col: 11, row: 12, timer: 60 });
                let frames = 0;
                while (frames < 400 && (frames < 2 || enemies[0].trapped)) {
                    step(1 / 60);
                    frames++;
                }
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { row: enemies[0].row, trapped: enemies[0].trapped };
            });
            expect(out.trapped).toBe(false);
            expect(out.row).toBeLessThan(12);
        });

        test('a trapped enemy is harmless and can be walked over', async ({ page }) => {
            const survived = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                placeActor(enemies[0], 11, 12);
                enemies[0].trapped = true;
                enemies[0].trapTimer = 60;
                setTile(11, 12, HOLE);
                const before = lives;
                placeActor(player, 11, 11);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { before, after: lives, row: player.row };
            });
            expect(survived.after).toBe(survived.before);
            expect(survived.row).toBe(11);
        });

        test('a hole closing on an enemy kills it and scores points', async ({ page }) => {
            const killed = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                placeActor(player, 0, 14);
                placeActor(enemies[0], 11, 12);
                enemies[0].trapped = true;
                enemies[0].trapTimer = 60;
                setTile(11, 12, HOLE);
                holes.push({ col: 11, row: 12, timer: 0.2 });
                const before = score;
                for (let i = 0; i < 30 && score === before; i++) step(1 / 60);
                return {
                    gained: score - before,
                    trapped: enemies[0].trapped,
                    backAtSpawn:
                        enemies[0].col === enemies[0].spawnCol && enemies[0].row === enemies[0].spawnRow,
                };
            });
            const { ENEMY_POINTS } = await rules(page);
            expect(killed.gained).toBe(ENEMY_POINTS);
            expect(killed.trapped).toBe(false);
            expect(killed.backAtSpawn).toBe(true);
        });

        test('touching an enemy costs a life and resets the level positions', async ({ page }) => {
            const hit = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                placeActor(player, 10, 14);
                placeActor(enemies[0], 10, 14);
                const before = lives;
                step(1 / 60);
                return { before, after: lives, atSpawn: player.col === player.spawnCol };
            });
            expect(hit.after).toBe(hit.before - 1);
            expect(hit.atSpawn).toBe(true);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                lives = 1;
                placeActor(player, 10, 14);
                placeActor(enemies[0], 10, 14);
                step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toHaveText('GAME OVER');
        });

        test('collected gold survives losing a life', async ({ page }) => {
            const kept = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                takeGold(goldCells[0]);
                const remaining = goldRemaining;
                placeActor(player, 10, 14);
                placeActor(enemies[0], 10, 14);
                step(1 / 60);
                return { remaining, after: goldRemaining };
            });
            expect(kept.after).toBe(kept.remaining);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, restart and best score
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('nothing moves while paused', async ({ page }) => {
            await startQuiet(page);
            await place(page, 12, 3);
            await page.keyboard.press('p');
            await advance(page, 60);
            expect(await cell(page)).toEqual({ col: 12, row: 3 });
        });
    });

    test.describe('rendering', () => {
        test('the level is painted onto the canvas', async ({ page }) => {
            const painted = await page.evaluate(async () => {
                startGame();
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                let lit = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] > 40 || data[i + 1] > 40 || data[i + 2] > 40) lit++;
                }
                return lit;
            });
            expect(painted).toBeGreaterThan(1000);
        });

        test('a full level of play raises no page errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (err) => errors.push(err.message));
            await page.evaluate(() => {
                autoStep = true;
                startGame();
            });
            await page.waitForTimeout(1500);
            expect(errors).toEqual([]);
        });
    });

    test.describe('scoring', () => {
        test('the best score is kept in localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 4321;
                lives = 1;
                enemies.length = 1;
                placeActor(player, 10, 14);
                placeActor(enemies[0], 10, 14);
                step(1 / 60);
            });
            expect(await page.evaluate(() => localStorage.getItem('loderunner-best'))).toBe('4321');
            await expect(page.locator('#best')).toHaveText('4321');
        });

        test('a new game resets score, lives and level', async ({ page }) => {
            const fresh = await page.evaluate(() => {
                startGame();
                score = 900;
                lives = 1;
                levelIndex = 1;
                startGame();
                return { score, lives, levelIndex, state };
            });
            expect(fresh).toEqual({ score: 0, lives: 3, levelIndex: 0, state: 'playing' });
        });
    });
});
