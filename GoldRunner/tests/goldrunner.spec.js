const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Most specs are about one entity at a time, so the guards are cleared out of
// the way; the guard specs spawn exactly the guards they care about. Switching
// `autoStep` off stops the requestAnimationFrame loop from advancing the
// simulation behind the spec's back, leaving time entirely under test control.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        guards.length = 0;
        autoStep = false;
    });

// Chromium can acknowledge a synthetic key event before the page listener has
// run, so key presses are confirmed against the game's key state before the
// simulation is advanced.
const hold = async (page, key, flag) => {
    await page.keyboard.down(key);
    await page.waitForFunction((f) => keys[f], flag);
};

test.describe('Gold Runner', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Gold Runner', async ({ page }) => {
            await expect(page).toHaveTitle('Gold Runner');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas matches the grid size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '420');
            expect(await page.evaluate(() => [COLS, ROWS, TILE])).toEqual([24, 14, 30]);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('goldrunner-best', '8250'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('8250');
        });

        test('no guards before starting', async ({ page }) => {
            expect(await page.evaluate(() => guards.length)).toBe(0);
        });

        test('step() does nothing while idle', async ({ page }) => {
            await page.evaluate(() => {
                keys.right = true;
            });
            const before = await page.evaluate(() => player.x);
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Level data — the hand-authored layouts have to stay playable
    // -----------------------------------------------------------------------
    test.describe('level data', () => {
        test('there are three levels', async ({ page }) => {
            expect(await page.evaluate(() => LEVELS.length)).toBe(3);
        });

        test('every level is a full 24x14 grid of known tiles', async ({ page }) => {
            const bad = await page.evaluate(() =>
                LEVELS.flatMap((lvl, i) => {
                    const errs = [];
                    if (lvl.length !== ROWS) errs.push(`level ${i + 1} has ${lvl.length} rows`);
                    lvl.forEach((row, r) => {
                        if (row.length !== COLS) errs.push(`level ${i + 1} row ${r} is ${row.length} wide`);
                        [...row].forEach((ch, c) => {
                            if (!'.#@H-S$PG'.includes(ch)) errs.push(`level ${i + 1} ${c},${r} is '${ch}'`);
                        });
                    });
                    return errs;
                })
            );
            expect(bad).toEqual([]);
        });

        test('every level has one start, guards, gold and an escape ladder', async ({ page }) => {
            const counts = await page.evaluate(() =>
                LEVELS.map((lvl) => {
                    const flat = lvl.join('');
                    const n = (ch) => [...flat].filter((c) => c === ch).length;
                    return { player: n('P'), guards: n('G'), gold: n('$'), escape: n('S') };
                })
            );
            for (const c of counts) {
                expect(c.player).toBe(1);
                expect(c.guards).toBeGreaterThanOrEqual(2);
                expect(c.gold).toBeGreaterThanOrEqual(6);
                expect(c.escape).toBeGreaterThanOrEqual(4);
            }
        });

        test('every gold bar is reachable from the start of its level', async ({ page }) => {
            const unreachable = await page.evaluate(() => {
                const bad = [];
                for (let i = 1; i <= LEVELS.length; i++) {
                    loadLevel(i);
                    const seen = reachableCells(false);
                    for (let r = 0; r < ROWS; r++)
                        for (let c = 0; c < COLS; c++)
                            if (grid[r][c] === '$' && !seen.has(`${c},${r}`))
                                bad.push(`level ${i} gold ${c},${r}`);
                }
                return bad;
            });
            expect(unreachable).toEqual([]);
        });

        test('the escape row is reachable once the escape ladders switch on', async ({ page }) => {
            const bad = await page.evaluate(() => {
                const out = [];
                for (let i = 1; i <= LEVELS.length; i++) {
                    loadLevel(i);
                    const seen = reachableCells(true);
                    const top = [...Array(COLS).keys()].some((c) => seen.has(`${c},0`));
                    if (!top) out.push(`level ${i}`);
                }
                return out;
            });
            expect(bad).toEqual([]);
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
            await page.waitForFunction(() => state === 'running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the player starts on the level P marker', async ({ page }) => {
            const where = await page.evaluate(() => {
                startGame();
                let mark = null;
                LEVELS[0].forEach((row, r) => {
                    const c = row.indexOf('P');
                    if (c >= 0) mark = { c, r };
                });
                return { mark, player: { x: player.x, y: player.y } };
            });
            expect(where.player).toEqual({ x: where.mark.c, y: where.mark.r });
        });

        test('a guard is spawned for every G marker', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                const marks = LEVELS[0].join('').split('G').length - 1;
                return { marks, guards: guards.length };
            });
            expect(counts.guards).toBe(counts.marks);
            expect(counts.guards).toBeGreaterThan(0);
        });

        test('gold left matches the level layout', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                return { marks: LEVELS[0].join('').split('$').length - 1, left: goldLeft };
            });
            expect(counts.left).toBe(counts.marks);
        });

        test('the entity markers are cleared out of the grid', async ({ page }) => {
            await page.evaluate(() => startGame());
            const flat = await page.evaluate(() => grid.map((r) => r.join('')).join(''));
            expect(flat).not.toContain('P');
            expect(flat).not.toContain('G');
        });

        test('the HUD shows the gold still to collect', async ({ page }) => {
            await page.evaluate(() => startGame());
            const left = await page.evaluate(() => goldLeft);
            await expect(page.locator('#gold')).toHaveText(String(left));
        });
    });

    // -----------------------------------------------------------------------
    // Running, climbing, ropes and gravity
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('holding right runs the player right', async ({ page }) => {
            const before = await page.evaluate(() => player.x);
            await hold(page, 'ArrowRight', 'right');
            await advance(page, 20);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(before);
        });

        test('holding left runs the player left', async ({ page }) => {
            const before = await page.evaluate(() => player.x);
            await hold(page, 'ArrowLeft', 'left');
            await advance(page, 20);
            expect(await page.evaluate(() => player.x)).toBeLessThan(before);
        });

        test('W A S D also drive the player', async ({ page }) => {
            const before = await page.evaluate(() => player.x);
            await hold(page, 'd', 'right');
            await advance(page, 20);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(before);
        });

        test('running sets the facing direction', async ({ page }) => {
            await page.evaluate(() => {
                keys.left = true;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => player.facing)).toBe(-1);
            await page.evaluate(() => {
                keys.left = false;
                keys.right = true;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => player.facing)).toBe(1);
        });

        test('the player stops at a wall of bricks', async ({ page }) => {
            const stopped = await page.evaluate(() => {
                // Row 12 of level 1 is walled by the stone floor below and the
                // grid edge on the left.
                placePlayer(3, 12);
                keys.left = true;
                for (let i = 0; i < 600; i++) step(1 / 60);
                return player.x;
            });
            expect(stopped).toBe(0);
        });

        test('the player cannot walk off the right edge', async ({ page }) => {
            const stopped = await page.evaluate(() => {
                placePlayer(20, 12);
                keys.right = true;
                for (let i = 0; i < 600; i++) step(1 / 60);
                return player.x;
            });
            expect(stopped).toBe(23);
        });

        test('walking off a ledge makes the player fall', async ({ page }) => {
            const fell = await page.evaluate(() => {
                // Level 1 row 4 has a gap at columns 13-15.
                placePlayer(12, 3);
                keys.right = true;
                let sawFall = false;
                for (let i = 0; i < 120; i++) {
                    step(1 / 60);
                    if (player.falling) sawFall = true;
                }
                return { sawFall, y: player.y };
            });
            expect(fell.sawFall).toBe(true);
            expect(fell.y).toBeGreaterThan(3);
        });

        test('a fall is caught by the rope below', async ({ page }) => {
            const landed = await page.evaluate(() => {
                // Column 13 falls out of row 3 onto the rope on row 5.
                placePlayer(13, 3);
                for (let i = 0; i < 180; i++) step(1 / 60);
                return { x: player.x, y: player.y, falling: player.falling };
            });
            expect(landed.y).toBe(5);
            expect(landed.falling).toBe(false);
            expect(await page.evaluate(() => isRope(13, 5))).toBe(true);
        });

        test('the player cannot steer while falling', async ({ page }) => {
            const drift = await page.evaluate(() => {
                placePlayer(13, 3);
                keys.right = true;
                const x0 = player.x;
                let maxDrift = 0;
                for (let i = 0; i < 12; i++) {
                    step(1 / 60);
                    if (player.falling) maxDrift = Math.max(maxDrift, Math.abs(player.x - x0));
                }
                return maxDrift;
            });
            expect(drift).toBe(0);
        });

        test('a fall ends on the floor below', async ({ page }) => {
            const y = await page.evaluate(() => {
                // Column 15 drops through the gap in row 4 with no rope to
                // catch it, so the fall runs on down to the next brick floor.
                placePlayer(15, 3);
                for (let i = 0; i < 240; i++) step(1 / 60);
                return player.y;
            });
            expect(y).toBe(6);
        });

        test('holding down carries on through a rope', async ({ page }) => {
            const y = await page.evaluate(() => {
                placePlayer(11, 6); // above the gap in row 7 of level 1
                keys.down = true;
                for (let i = 0; i < 240; i++) step(1 / 60);
                return player.y;
            });
            expect(y).toBe(9); // past the rope on row 8, down to the floor
        });

        test('pressing up on a ladder climbs', async ({ page }) => {
            await page.evaluate(() => {
                placePlayer(7, 6);
                keys.up = true;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => player.y)).toBeLessThan(6);
        });

        test('holding up stops at the top of the ladder', async ({ page }) => {
            const y = await page.evaluate(() => {
                placePlayer(7, 6);
                keys.up = true;
                for (let i = 0; i < 300; i++) step(1 / 60);
                return player.y;
            });
            expect(y).toBe(3);
        });

        test('holding down stops at the bottom of the ladder', async ({ page }) => {
            const y = await page.evaluate(() => {
                placePlayer(7, 3);
                keys.down = true;
                for (let i = 0; i < 300; i++) step(1 / 60);
                return player.y;
            });
            expect(y).toBe(6);
        });

        test('the player cannot climb where there is no ladder', async ({ page }) => {
            const y = await page.evaluate(() => {
                placePlayer(5, 3);
                keys.up = true;
                for (let i = 0; i < 120; i++) step(1 / 60);
                return player.y;
            });
            expect(y).toBe(3);
        });

        test('hanging on a rope holds the player up', async ({ page }) => {
            const hung = await page.evaluate(() => {
                placePlayer(10, 5);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { y: player.y, falling: player.falling };
            });
            expect(hung).toEqual({ y: 5, falling: false });
        });

        test('the player traverses a rope sideways', async ({ page }) => {
            const moved = await page.evaluate(() => {
                placePlayer(10, 5);
                keys.right = true;
                for (let i = 0; i < 15; i++) step(1 / 60);
                return { x: player.x, y: player.y };
            });
            expect(moved.x).toBeGreaterThan(10);
            expect(moved.y).toBe(5);
        });

        test('pressing down lets go of the rope', async ({ page }) => {
            const dropped = await page.evaluate(() => {
                placePlayer(10, 5);
                keys.down = true;
                for (let i = 0; i < 180; i++) step(1 / 60);
                return player.y;
            });
            expect(dropped).toBe(6);
        });

        test('the player can stand on top of a ladder', async ({ page }) => {
            const stood = await page.evaluate(() => {
                placePlayer(3, 6); // ladder at column 3 runs from row 6 down
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { y: player.y, falling: player.falling };
            });
            expect(stood).toEqual({ y: 6, falling: false });
        });
    });

    // -----------------------------------------------------------------------
    // Gold
    // -----------------------------------------------------------------------
    test.describe('gold', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('walking onto gold collects it', async ({ page }) => {
            const before = await page.evaluate(() => goldLeft);
            const after = await page.evaluate(() => {
                placePlayer(5, 3); // gold sits at 4,3 in level 1
                keys.left = true;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { left: goldLeft, score, tile: grid[3][4] };
            });
            expect(after.left).toBe(before - 1);
            expect(after.score).toBe(250);
            expect(after.tile).toBe('.');
        });

        test('the HUD counts the gold down', async ({ page }) => {
            const before = await page.evaluate(() => goldLeft);
            await page.evaluate(() => {
                placePlayer(5, 3);
                keys.left = true;
                for (let i = 0; i < 60; i++) step(1 / 60);
            });
            await expect(page.locator('#gold')).toHaveText(String(before - 1));
        });

        test('gold is collected by falling through it', async ({ page }) => {
            const collected = await page.evaluate(() => {
                // Column 13 drops out of row 3 through the gap in the brick row.
                grid[4][13] = '$';
                goldLeft++;
                const before = goldLeft;
                placePlayer(13, 3);
                for (let i = 0; i < 240; i++) step(1 / 60);
                return { taken: before - goldLeft, y: player.y };
            });
            expect(collected.taken).toBe(1);
            expect(collected.y).toBe(5);
        });

        test('the escape ladders stay inert while gold remains', async ({ page }) => {
            expect(await page.evaluate(() => escapeActive())).toBe(false);
            const col = await page.evaluate(() => grid[2].indexOf('S'));
            expect(col).toBeGreaterThanOrEqual(0);
            expect(await page.evaluate((c) => isLadder(c, 2), col)).toBe(false);
        });

        test('collecting the last gold arms the escape ladders', async ({ page }) => {
            await page.evaluate(() => collectAllGoldForTest());
            expect(await page.evaluate(() => goldLeft)).toBe(0);
            expect(await page.evaluate(() => escapeActive())).toBe(true);
            const col = await page.evaluate(() => grid[2].indexOf('S'));
            expect(await page.evaluate((c) => isLadder(c, 2), col)).toBe(true);
        });

        test('the armed escape ladder can be climbed', async ({ page }) => {
            const out = await page.evaluate(() => {
                collectAllGoldForTest();
                const col = grid[3].indexOf('S');
                placePlayer(col, 3);
                keys.up = true;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { y: player.y, state };
            });
            // Reaching the top row is the escape, so the level ends there.
            expect(Math.round(out.y)).toBe(0);
            expect(out.state).toBe('levelclear');
        });
    });

    // -----------------------------------------------------------------------
    // Digging
    // -----------------------------------------------------------------------
    test.describe('digging', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('digging right opens the brick below and to the right', async ({ page }) => {
            const dug = await page.evaluate(() => {
                placePlayer(5, 3);
                const ok = dig(1);
                return { ok, tile: grid[4][6], holes: holes.length };
            });
            expect(dug.ok).toBe(true);
            expect(dug.tile).toBe('.');
            expect(dug.holes).toBe(1);
        });

        test('digging left opens the brick below and to the left', async ({ page }) => {
            const dug = await page.evaluate(() => {
                placePlayer(5, 3);
                const ok = dig(-1);
                return { ok, tile: grid[4][4] };
            });
            expect(dug.ok).toBe(true);
            expect(dug.tile).toBe('.');
        });

        test('Z and X dig on either side', async ({ page }) => {
            await page.evaluate(() => placePlayer(5, 3));
            await page.keyboard.press('x');
            await page.waitForFunction(() => grid[4][6] === '.');
            await page.evaluate(() => {
                player.digCooldown = 0;
            });
            await page.keyboard.press('z');
            await page.waitForFunction(() => grid[4][4] === '.');
        });

        test('stone cannot be dug', async ({ page }) => {
            const dug = await page.evaluate(() => {
                placePlayer(5, 12); // the vault floor on row 13 is stone
                return { ok: dig(1), tile: grid[13][6] };
            });
            expect(dug.ok).toBe(false);
            expect(dug.tile).toBe('@');
        });

        test('the player cannot dig while on a ladder', async ({ page }) => {
            const dug = await page.evaluate(() => {
                placePlayer(9, 9); // ladder column 9 in level 1
                return { ladder: isLadder(9, 9), ok: dig(1) };
            });
            expect(dug.ladder).toBe(true);
            expect(dug.ok).toBe(false);
        });

        test('the player cannot dig while hanging on a rope', async ({ page }) => {
            const dug = await page.evaluate(() => {
                placePlayer(10, 5);
                return { rope: isRope(10, 5), ok: dig(1) };
            });
            expect(dug.rope).toBe(true);
            expect(dug.ok).toBe(false);
        });

        test('the player can dig on the run', async ({ page }) => {
            const dug = await page.evaluate(() => {
                placePlayer(5, 3);
                keys.right = true;
                step(1 / 60); // now in transit, which must not block the drill
                return { moving: !!player.move, ok: dig(1) };
            });
            expect(dug.moving).toBe(true);
            expect(dug.ok).toBe(true);
        });

        test('the player cannot dig while falling', async ({ page }) => {
            const dug = await page.evaluate(() => {
                placePlayer(13, 3);
                step(1 / 60);
                return { falling: player.falling, ok: dig(1) };
            });
            expect(dug.falling).toBe(true);
            expect(dug.ok).toBe(false);
        });

        test('digging into the grid edge fails', async ({ page }) => {
            const ok = await page.evaluate(() => {
                placePlayer(0, 3);
                return dig(-1);
            });
            expect(ok).toBe(false);
        });

        test('digging has a cooldown', async ({ page }) => {
            const second = await page.evaluate(() => {
                placePlayer(5, 3);
                dig(1);
                return dig(-1);
            });
            expect(second).toBe(false);
        });

        test('the hole knits itself back together', async ({ page }) => {
            await page.evaluate(() => {
                placePlayer(5, 3);
                dig(1);
            });
            expect(await page.evaluate(() => grid[4][6])).toBe('.');
            await advance(page, 60 * 6);
            expect(await page.evaluate(() => grid[4][6])).toBe('#');
            expect(await page.evaluate(() => holes.length)).toBe(0);
        });

        test('a fresh hole is a way down to the floor below', async ({ page }) => {
            const y = await page.evaluate(() => {
                placePlayer(5, 3);
                dig(1);
                keys.right = true;
                for (let i = 0; i < 240; i++) {
                    step(1 / 60);
                    if (player.falling) keys.right = false; // stop once committed
                    if (!player.falling && player.y > 3) break;
                }
                return player.y;
            });
            expect(y).toBe(6); // through the brick row and down to the next floor
        });

        test('a hole closing over the player costs a life', async ({ page }) => {
            const out = await page.evaluate(() => {
                // Give the hole a floor so the player sits in it: the bricks on
                // either side then make it inescapable.
                grid[5][4] = '#';
                placePlayer(5, 3);
                dig(-1);
                keys.left = true;
                for (let i = 0; i < 60 * 4; i++) step(1 / 60);
                const trapped = { x: player.x, y: player.y, lives };
                for (let i = 0; i < 60 * 4; i++) step(1 / 60);
                return { trapped, lives, state };
            });
            expect(out.trapped).toEqual({ x: 4, y: 4, lives: 3 });
            expect(out.lives).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Guards
    // -----------------------------------------------------------------------
    test.describe('guards', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a guard closes in on the player', async ({ page }) => {
            const gap = await page.evaluate(() => {
                placePlayer(1, 12);
                const g = spawnGuard(20, 12);
                const before = Math.abs(g.x - player.x);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { before, after: Math.abs(guards[0].x - player.x) };
            });
            expect(gap.after).toBeLessThan(gap.before);
        });

        test('a guard climbs toward a player on another floor', async ({ page }) => {
            const rows = await page.evaluate(() => {
                placePlayer(9, 9);
                const g = spawnGuard(12, 12);
                const before = g.y;
                for (let i = 0; i < 60 * 6; i++) step(1 / 60);
                return { before, after: guards[0].y };
            });
            expect(rows.after).toBeLessThan(rows.before);
        });

        test('touching a guard costs a life', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(10, 12);
                spawnGuard(10, 12);
                step(1 / 60);
                return { lives, state };
            });
            expect(out.lives).toBe(2);
            expect(out.state).toBe('dying');
        });

        test('a guard falls into a hole and is stuck', async ({ page }) => {
            const trapped = await page.evaluate(() => {
                placePlayer(5, 3);
                dig(1);
                const g = spawnGuard(8, 3);
                for (let i = 0; i < 90; i++) step(1 / 60);
                return { state: g.state, y: g.y };
            });
            expect(trapped.state).toBe('trapped');
            expect(trapped.y).toBe(4);
        });

        test('a trapped guard cannot hurt the player', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(5, 3);
                dig(1);
                const g = spawnGuard(6, 4);
                g.state = 'trapped';
                g.timer = 99;
                placePlayer(6, 4);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { lives, state };
            });
            expect(out.lives).toBe(3);
            expect(out.state).toBe('running');
        });

        test('a trapped guard climbs back out', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(5, 3);
                dig(1);
                const g = spawnGuard(6, 4);
                g.state = 'trapped';
                g.timer = GUARD_TRAP_TIME;
                // Keep the player far away so the guard is not chasing into a wall.
                placePlayer(1, 12);
                let freed = null;
                for (let i = 0; i < 60 * 5; i++) {
                    step(1 / 60);
                    // Sample the moment it is loose again: the hole is still open
                    // for a while afterwards, so it may well drop back in.
                    if (freed === null && g.state === 'active') freed = { y: g.y, at: i / 60 };
                }
                return freed;
            });
            expect(out).not.toBeNull();
            expect(out.y).toBe(3);
            expect(out.at).toBeGreaterThan(3);
        });

        test('a hole closing on a guard crushes it', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(5, 3);
                dig(1);
                const g = spawnGuard(6, 4);
                g.state = 'trapped';
                g.timer = 99; // never climbs out
                placePlayer(1, 12);
                for (let i = 0; i < 60 * 8; i++) step(1 / 60);
                return { score, guards: guards.length, state: guards[0].state, brick: grid[4][6] };
            });
            expect(out.score).toBeGreaterThanOrEqual(75);
            expect(out.brick).toBe('#');
            expect(out.guards).toBe(1);
        });

        test('a crushed guard comes back at its start', async ({ page }) => {
            const out = await page.evaluate(() => {
                placePlayer(1, 12);
                const g = spawnGuard(6, 4);
                const home = { c: g.spawn.c, r: g.spawn.r };
                crushGuard(g);
                let back = null;
                for (let i = 0; i < 60 * 4; i++) {
                    step(1 / 60);
                    if (back === null && g.state === 'active') back = { x: g.x, y: g.y, at: i / 60 };
                }
                return { home, back };
            });
            expect(out.back).not.toBeNull();
            expect(out.back.x).toBe(out.home.c);
            expect(out.back.y).toBe(out.home.r);
            expect(out.back.at).toBeGreaterThan(1);
        });

        test('guards get faster with the level but never outrun the player', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                const l1 = guardSpeed();
                level = 6;
                const l6 = guardSpeed();
                level = 60;
                return { l1, l6, fast: guardSpeed(), run: RUN_SPEED };
            });
            expect(speeds.l6).toBeGreaterThan(speeds.l1);
            expect(speeds.fast).toBeLessThan(speeds.run);
        });

        test('guards obey the walls', async ({ page }) => {
            const inside = await page.evaluate(() => {
                placePlayer(1, 12);
                spawnGuard(20, 12);
                let ok = true;
                for (let i = 0; i < 60 * 8; i++) {
                    step(1 / 60);
                    for (const g of guards) {
                        if (g.x < 0 || g.x > COLS - 1 || g.y < 0 || g.y > ROWS - 1) ok = false;
                        if (isBlocking(Math.round(g.x), Math.round(g.y))) ok = false;
                    }
                    if (state !== 'running') break;
                }
                return ok;
            });
            expect(inside).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Dying and level flow
    // -----------------------------------------------------------------------
    test.describe('level flow', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('reaching the top without the gold does nothing', async ({ page }) => {
            const out = await page.evaluate(() => {
                const col = grid[0].indexOf('S');
                player.x = col;
                player.y = 0;
                player.move = null;
                step(1 / 60);
                return state;
            });
            expect(out).toBe('running');
        });

        test('escaping with all the gold clears the level', async ({ page }) => {
            const out = await page.evaluate(() => {
                collectAllGoldForTest();
                const col = grid[0].indexOf('S');
                placePlayer(col, 0);
                step(1 / 60);
                return { state, score };
            });
            expect(out.state).toBe('levelclear');
            expect(out.score).toBeGreaterThanOrEqual(1500);
        });

        test('the next level loads after the clear pause', async ({ page }) => {
            await page.evaluate(() => {
                collectAllGoldForTest();
                placePlayer(grid[0].indexOf('S'), 0);
                step(1 / 60);
            });
            await advance(page, 60 * 3);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => goldLeft)).toBeGreaterThan(0);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('score carries into the next level', async ({ page }) => {
            await page.evaluate(() => {
                score = 4000;
                collectAllGoldForTest();
                placePlayer(grid[0].indexOf('S'), 0);
                step(1 / 60);
            });
            await advance(page, 60 * 3);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(5500);
        });

        test('the levels cycle back round with the run intact', async ({ page }) => {
            const out = await page.evaluate(() => {
                loadLevel(LEVELS.length + 1);
                return { gold: goldLeft, first: LEVELS[0].join('').split('$').length - 1 };
            });
            expect(out.gold).toBe(out.first);
        });

        test('dying restores the level and its gold', async ({ page }) => {
            const out = await page.evaluate(() => {
                const full = goldLeft;
                placePlayer(5, 3);
                keys.left = true;
                for (let i = 0; i < 60; i++) step(1 / 60); // take the gold at 4,3
                const taken = goldLeft;
                keys.left = false;
                spawnGuard(Math.round(player.x), Math.round(player.y));
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { full, taken, now: goldLeft, state, lives };
            });
            expect(out.taken).toBe(out.full - 1);
            expect(out.now).toBe(out.full);
            expect(out.state).toBe('running');
            expect(out.lives).toBe(2);
        });

        test('the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                placePlayer(10, 12);
                spawnGuard(10, 12);
                step(1 / 60);
            });
            expect(await page.evaluate(() => lives)).toBe(0);
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('restarting after game over resets the run', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                level = 3;
                lives = 1;
                placePlayer(10, 12);
                spawnGuard(10, 12);
                step(1 / 60);
            });
            await advance(page, 60 * 4);
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => [score, level, lives])).toEqual([0, 1, 3]);
        });
    });

    // -----------------------------------------------------------------------
    // Playability — every shipped level is beaten with the real physics, not
    // just with the abstract reachability graph.
    // -----------------------------------------------------------------------
    test.describe('playability', () => {
        for (const n of [1, 2, 3]) {
            test(`level ${n} can be cleared`, async ({ page }) => {
                const out = await page.evaluate((lvl) => {
                    startGame();
                    autoStep = false;
                    level = lvl;
                    loadLevel(lvl);
                    guards.length = 0;
                    state = 'running';

                    // Steer the player one cell at a time along the same route
                    // the guards' pathfinder would take. `done` lets a run stop
                    // early when a bar is swept up on the way past it.
                    const driveTo = (tc, tr, limit, done) => {
                        let frames = 0;
                        while (frames < limit) {
                            if (state !== 'running') return true; // escaped or died
                            if (done && done()) return true;
                            // Let a move (or a fall) finish before re-planning.
                            if (player.move || player.falling) {
                                step(1 / 60);
                                frames++;
                                continue;
                            }
                            const c = Math.round(player.x);
                            const r = Math.round(player.y);
                            if (c === tc && r === tr) return true;
                            const next = bfsStep(c, r, tc, tr);
                            if (!next) return false;
                            keys.left = keys.right = keys.up = keys.down = false;
                            if (next[0] < c) keys.left = true;
                            else if (next[0] > c) keys.right = true;
                            else if (next[1] < r) keys.up = true;
                            else if (next[1] > r) keys.down = true;
                            step(1 / 60);
                            frames++;
                            keys.left = keys.right = keys.up = keys.down = false;
                        }
                        return false;
                    };

                    // Distance to every cell the player can currently get to.
                    const distances = () => {
                        const d = new Map();
                        const start = `${Math.round(player.x)},${Math.round(player.y)}`;
                        d.set(start, 0);
                        const queue = [[Math.round(player.x), Math.round(player.y)]];
                        while (queue.length) {
                            const [c, r] = queue.shift();
                            const base = d.get(`${c},${r}`);
                            for (const [nc, nr] of neighbors(c, r)) {
                                const k = `${nc},${nr}`;
                                if (d.has(k)) continue;
                                d.set(k, base + 1);
                                queue.push([nc, nr]);
                            }
                        }
                        return d;
                    };

                    const nextGold = () => {
                        const d = distances();
                        let best = null;
                        for (let r = 0; r < ROWS; r++)
                            for (let c = 0; c < COLS; c++) {
                                if (grid[r][c] !== '$') continue;
                                const dist = d.get(`${c},${r}`);
                                if (dist === undefined) continue;
                                if (!best || dist < best.d) best = { c, r, d: dist };
                            }
                        return best;
                    };

                    const missed = [];
                    let bars = 0;
                    while (goldLeft > 0 && bars < 40) {
                        const target = nextGold();
                        if (!target) break;
                        const ok = driveTo(target.c, target.r, 4000, () => grid[target.r][target.c] !== '$');
                        if (!ok) {
                            missed.push(`${target.c},${target.r}`);
                            break;
                        }
                        bars++;
                    }
                    if (goldLeft === 0) {
                        let col = -1;
                        for (let c = 0; c < COLS; c++) if (grid[0][c] === 'S') col = c;
                        driveTo(col, 0, 4000);
                    }
                    return { goldLeft, state, score, missed };
                }, n);

                expect(out.missed).toEqual([]); // names any bar it could not reach
                expect(out.goldLeft).toBe(0);
                expect(out.state).toBe('levelclear');
                expect(out.score).toBeGreaterThan(1500);
            });
        }
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
            const before = await page.evaluate(() => player.x);
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(before);
        });

        test('holes do not knit shut while paused', async ({ page }) => {
            await page.evaluate(() => {
                placePlayer(5, 3);
                dig(1);
                togglePause();
            });
            await advance(page, 60 * 8);
            expect(await page.evaluate(() => grid[4][6])).toBe('.');
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('a new best is stored on game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 6100;
                lives = 1;
                placePlayer(10, 12);
                spawnGuard(10, 12);
                step(1 / 60);
            });
            await advance(page, 60 * 4);
            await expect(page.locator('#best')).toHaveText('6100');
            expect(await page.evaluate(() => window.localStorage.getItem('goldrunner-best'))).toBe('6100');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('goldrunner-best', '9000'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 100;
                lives = 1;
                placePlayer(10, 12);
                spawnGuard(10, 12);
                step(1 / 60);
            });
            await advance(page, 60 * 4);
            await expect(page.locator('#best')).toHaveText('9000');
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
                placePlayer(5, 3);
                dig(1);
                for (let i = 0; i < 60; i++) step(1 / 60);
                draw(); // running
                togglePause();
                draw(); // paused
                togglePause();
                collectAllGoldForTest();
                draw(); // escape ladders armed
                placePlayer(grid[0].indexOf('S'), 0);
                step(1 / 60);
                draw(); // level clear
                for (let i = 0; i < 200; i++) step(1 / 60);
                lives = 1;
                placePlayer(10, 12);
                spawnGuard(10, 12);
                step(1 / 60);
                draw(); // dying
                for (let i = 0; i < 300; i++) step(1 / 60);
                draw(); // over
            });
            expect(errors).toEqual([]);
        });
    });
});
