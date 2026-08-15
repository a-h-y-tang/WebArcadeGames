const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// ---------------------------------------------------------------------------
// Helpers shared by the specs below.
// ---------------------------------------------------------------------------

const COLS = 28;
const ROWS = 18;

/** A full-width brick floor, handy for sandbox levels. */
const FLOOR = '#'.repeat(COLS);

/**
 * Build a full-size sandbox level from a sparse description so a single
 * mechanic can be exercised in isolation. `rows` is an object keyed by row
 * index; each value is painted starting at column 0 and the rest of the row is
 * filled with '.'.
 */
function sandbox(rows) {
    const out = [];
    for (let r = 0; r < ROWS; r++) {
        const painted = rows[r] || '';
        out.push((painted + '.'.repeat(COLS)).slice(0, COLS));
    }
    return out;
}

/** Advance the simulation by `seconds` in 60 Hz slices, inside the page. */
async function run(page, seconds) {
    await page.evaluate((s) => {
        const frames = Math.round(s * 60);
        for (let i = 0; i < frames; i++) step(1 / 60);
    }, seconds);
}

/** Load a sandbox level and put the game into the running state. */
async function loadSandbox(page, rows) {
    await page.evaluate((lvl) => {
        startGame();
        loadLevelData(lvl);
    }, rows);
}

async function playerTile(page) {
    return page.evaluate(() => ({ c: player.c, r: player.r }));
}

test.describe('Lode Runner', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Page furniture / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Lode Runner', async ({ page }) => {
            await expect(page).toHaveTitle('Lode Runner');
        });

        test('canvas matches the tile grid', async ({ page }) => {
            const dims = await page.evaluate(() => ({
                w: canvas.width, h: canvas.height,
                cols: COLS, rows: ROWS, tile: TILE,
            }));
            expect(dims.w).toBe(dims.cols * dims.tile);
            expect(dims.h).toBe(dims.rows * dims.tile);
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD starts at zero score, three lives, level 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle does not move the player', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const before = { c: player.c, r: player.r };
                heldKeys.add('right');
                for (let i = 0; i < 60; i++) step(1 / 60);
                return player.c !== before.c || player.r !== before.r;
            });
            expect(moved).toBe(false);
        });

        test('best score is read from localStorage', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('lode-runner-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Level data
    // -----------------------------------------------------------------------
    test.describe('level data', () => {
        test('every level is a full rectangle of known tiles', async ({ page }) => {
            const problems = await page.evaluate(() => {
                const bad = [];
                LEVELS.forEach((lvl, i) => {
                    if (lvl.length !== ROWS) bad.push(`level ${i} has ${lvl.length} rows`);
                    lvl.forEach((row, r) => {
                        if (row.length !== COLS) bad.push(`level ${i} row ${r} is ${row.length} wide`);
                        for (const ch of row) {
                            if (!'.#@H-$EPG'.includes(ch)) bad.push(`level ${i} row ${r} has '${ch}'`);
                        }
                    });
                });
                return bad;
            });
            expect(problems).toEqual([]);
        });

        test('there are at least three levels', async ({ page }) => {
            expect(await page.evaluate(() => LEVELS.length)).toBeGreaterThanOrEqual(3);
        });

        test('every level has exactly one player start, gold, guards and an escape ladder', async ({ page }) => {
            const stats = await page.evaluate(() =>
                LEVELS.map((lvl) => {
                    const all = lvl.join('');
                    const count = (ch) => all.split('').filter((x) => x === ch).length;
                    return { p: count('P'), g: count('G'), gold: count('$'), e: count('E') };
                })
            );
            for (const s of stats) {
                expect(s.p).toBe(1);
                expect(s.g).toBeGreaterThanOrEqual(1);
                expect(s.gold).toBeGreaterThanOrEqual(5);
                expect(s.e).toBeGreaterThanOrEqual(2);
            }
        });

        test('every gold and the escape row can be reached from the player start', async ({ page }) => {
            const levels = await page.evaluate(() => ({ LEVELS, COLS, ROWS }));
            const { COLS, ROWS } = levels;

            for (const [index, lvl] of levels.LEVELS.entries()) {
                const g = lvl.map((row) => row.split(''));
                let start = null;
                const gold = [];
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) {
                        if (g[r][c] === 'P') { start = [c, r]; g[r][c] = '.'; }
                        else if (g[r][c] === 'G') g[r][c] = '.';
                        else if (g[r][c] === '$') gold.push([c, r]);
                    }
                }
                const at = (c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS ? '#' : g[r][c]);
                const solid = (c, r) => '#@'.includes(at(c, r));
                const ladder = (c, r) => 'HE'.includes(at(c, r));
                const rope = (c, r) => at(c, r) === '-';
                const supported = (c, r) =>
                    ladder(c, r) || rope(c, r) || r + 1 >= ROWS || solid(c, r + 1) || ladder(c, r + 1);

                const seen = new Set([start.join(',')]);
                const queue = [start];
                while (queue.length) {
                    const [c, r] = queue.shift();
                    const next = [];
                    if (!supported(c, r)) {
                        if (!solid(c, r + 1)) next.push([c, r + 1]);
                    } else {
                        if (ladder(c, r - 1)) next.push([c, r - 1]);
                        if (!solid(c, r + 1)) next.push([c, r + 1]);
                        for (const d of [-1, 1]) if (!solid(c + d, r)) next.push([c + d, r]);
                        // digging a brick diagonally below drops you into it
                        if (solid(c, r + 1) && !ladder(c, r) && !rope(c, r)) {
                            for (const d of [-1, 1]) {
                                if (at(c + d, r + 1) === '#' && !solid(c + d, r)) next.push([c + d, r + 1]);
                            }
                        }
                    }
                    for (const n of next) {
                        const key = n.join(',');
                        if (!seen.has(key)) { seen.add(key); queue.push(n); }
                    }
                }

                const unreachableGold = gold.filter(([c, r]) => !seen.has(`${c},${r}`));
                expect(unreachableGold, `level ${index + 1} has unreachable gold`).toEqual([]);
                const escape = [...Array(COLS).keys()].some((c) => seen.has(`${c},0`));
                expect(escape, `level ${index + 1} escape row is unreachable`).toBe(true);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh game begins on level 1 with three lives and no score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { state, score, lives, levelIndex, goldLeft, goldTotal };
            });
            expect(s.state).toBe('running');
            expect(s.score).toBe(0);
            expect(s.lives).toBe(3);
            expect(s.levelIndex).toBe(0);
            expect(s.goldLeft).toBe(s.goldTotal);
            expect(s.goldTotal).toBeGreaterThan(0);
        });

        test('the player and guards spawn on their level markers', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const marks = [];
                LEVELS[0].forEach((row, r) => {
                    [...row].forEach((ch, c) => { if (ch === 'P' || ch === 'G') marks.push({ ch, c, r }); });
                });
                return {
                    marks,
                    player: { c: player.c, r: player.r },
                    guards: guards.map((g) => ({ c: g.c, r: g.r })),
                };
            });
            const p = s.marks.find((m) => m.ch === 'P');
            expect(s.player).toEqual({ c: p.c, r: p.r });
            const gs = s.marks.filter((m) => m.ch === 'G').map((m) => ({ c: m.c, r: m.r }));
            expect(s.guards).toEqual(gs);
        });

        test('spawn markers are stripped out of the playable grid', async ({ page }) => {
            const chars = await page.evaluate(() => {
                startGame();
                return [...new Set(grid.flat())].sort().join('');
            });
            expect(chars).not.toContain('P');
            expect(chars).not.toContain('G');
        });

        test('the escape ladder starts hidden', async ({ page }) => {
            expect(await page.evaluate(() => { startGame(); return exitRevealed; })).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Running, climbing, hanging and falling
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('the player runs right along a floor', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '............', 10: '############' }));
            await page.evaluate(() => { placeAt(player, 1, 9); heldKeys.add('right'); });
            await run(page, 1);
            const p = await playerTile(page);
            expect(p.c).toBeGreaterThan(3);
            expect(p.r).toBe(9);
        });

        test('the player runs left along a floor', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '............', 10: '############' }));
            await page.evaluate(() => { placeAt(player, 8, 9); heldKeys.add('left'); });
            await run(page, 1);
            expect((await playerTile(page)).c).toBeLessThan(6);
        });

        test('a brick blocks horizontal movement', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '....#.......', 10: '############' }));
            await page.evaluate(() => { placeAt(player, 1, 9); heldKeys.add('right'); });
            await run(page, 3);
            expect((await playerTile(page)).c).toBe(3);
        });

        test('the level edge blocks the player', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '', 10: '############' }));
            await page.evaluate(() => { placeAt(player, 0, 9); heldKeys.add('left'); });
            await run(page, 2);
            expect((await playerTile(page)).c).toBe(0);
        });

        test('an unsupported player falls until it lands', async ({ page }) => {
            await loadSandbox(page, sandbox({ 10: '############' }));
            await page.evaluate(() => placeAt(player, 3, 2));
            await run(page, 3);
            const p = await playerTile(page);
            expect(p).toEqual({ c: 3, r: 9 });
        });

        test('the player cannot steer while falling', async ({ page }) => {
            await loadSandbox(page, sandbox({ 10: '############' }));
            await page.evaluate(() => { placeAt(player, 3, 0); heldKeys.add('right'); });
            await page.evaluate(() => { for (let i = 0; i < 12; i++) step(1 / 60); });
            const mid = await playerTile(page);
            expect(mid.c).toBe(3);
            expect(mid.r).toBeGreaterThan(0);
        });

        test('the player climbs a ladder upwards', async ({ page }) => {
            await loadSandbox(page, sandbox({ 6: '...H', 7: '...H', 8: '...H', 9: '...H', 10: '####' }));
            await page.evaluate(() => { placeAt(player, 3, 9); heldKeys.add('up'); });
            await run(page, 1);
            expect((await playerTile(page)).r).toBeLessThan(8);
        });

        test('the player climbs down a ladder', async ({ page }) => {
            await loadSandbox(page, sandbox({ 6: '...H', 7: '...H', 8: '...H', 9: '...H', 10: '####' }));
            await page.evaluate(() => { placeAt(player, 3, 6); heldKeys.add('down'); });
            await run(page, 1);
            expect((await playerTile(page)).r).toBeGreaterThan(7);
        });

        test('a ladder top stops the climb', async ({ page }) => {
            await loadSandbox(page, sandbox({ 8: '...H', 9: '...H', 10: '####' }));
            await page.evaluate(() => { placeAt(player, 3, 9); heldKeys.add('up'); });
            await run(page, 3);
            expect((await playerTile(page)).r).toBe(8);
        });

        test('standing on top of a ladder is supported', async ({ page }) => {
            await loadSandbox(page, sandbox({ 8: '...H', 9: '...H', 10: '####' }));
            await page.evaluate(() => placeAt(player, 3, 7));
            await run(page, 2);
            expect((await playerTile(page)).r).toBe(7);
        });

        test('the player hangs on a rope and traverses it', async ({ page }) => {
            await loadSandbox(page, sandbox({ 5: '--------', 10: '########' }));
            await page.evaluate(() => { placeAt(player, 1, 5); heldKeys.add('right'); });
            await run(page, 1);
            const p = await playerTile(page);
            expect(p.r).toBe(5);
            expect(p.c).toBeGreaterThan(2);
        });

        test('pressing down on a rope drops off it', async ({ page }) => {
            await loadSandbox(page, sandbox({ 5: '--------', 10: '########' }));
            await page.evaluate(() => { placeAt(player, 3, 5); heldKeys.add('down'); });
            await run(page, 2);
            expect((await playerTile(page)).r).toBe(9);
        });

        test('falling onto a rope catches the player', async ({ page }) => {
            await loadSandbox(page, sandbox({ 5: '--------', 10: '########' }));
            await page.evaluate(() => placeAt(player, 3, 1));
            await run(page, 2);
            expect((await playerTile(page)).r).toBe(5);
        });

        test('the player cannot walk up through a solid tile', async ({ page }) => {
            await loadSandbox(page, sandbox({ 8: '###@####', 9: '........', 10: '########' }));
            await page.evaluate(() => { placeAt(player, 3, 9); heldKeys.add('up'); });
            await run(page, 2);
            expect((await playerTile(page)).r).toBe(9);
        });
    });

    // -----------------------------------------------------------------------
    // Gold
    // -----------------------------------------------------------------------
    test.describe('gold', () => {
        test('running over gold collects it and scores', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '..$.....', 10: '########' }));
            const before = await page.evaluate(() => ({ gold: goldLeft, score }));
            await page.evaluate(() => { placeAt(player, 0, 9); heldKeys.add('right'); });
            await run(page, 1);
            const after = await page.evaluate(() => ({
                gold: goldLeft, score, tile: grid[9][2], goldScore: GOLD_SCORE,
            }));
            expect(after.gold).toBe(before.gold - 1);
            expect(after.score).toBe(before.score + after.goldScore);
            expect(after.tile).toBe('.');
        });

        test('the gold counter reaches zero when the last coin is taken', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '..$.....', 10: '########' }));
            expect(await page.evaluate(() => goldLeft)).toBe(1);
            await page.evaluate(() => { placeAt(player, 0, 9); heldKeys.add('right'); });
            await run(page, 1);
            expect(await page.evaluate(() => goldLeft)).toBe(0);
        });

        test('collecting the last coin reveals the escape ladder', async ({ page }) => {
            await loadSandbox(page, sandbox({ 0: 'E', 1: 'E', 9: '..$.....', 10: '########' }));
            expect(await page.evaluate(() => isLadder(0, 1))).toBe(false);
            await page.evaluate(() => { placeAt(player, 0, 9); heldKeys.add('right'); });
            await run(page, 1);
            expect(await page.evaluate(() => exitRevealed)).toBe(true);
            expect(await page.evaluate(() => isLadder(0, 1))).toBe(true);
        });

        test('gold is collected while falling past it', async ({ page }) => {
            await loadSandbox(page, sandbox({ 5: '...$', 10: '####' }));
            await page.evaluate(() => placeAt(player, 3, 1));
            await run(page, 2);
            expect(await page.evaluate(() => goldLeft)).toBe(0);
        });

        test('the HUD shows the gold still on the level', async ({ page }) => {
            await page.evaluate(() => startGame());
            const left = await page.evaluate(() => goldLeft);
            await expect(page.locator('#gold')).toHaveText(String(left));
        });
    });

    // -----------------------------------------------------------------------
    // Digging
    // -----------------------------------------------------------------------
    test.describe('digging', () => {
        test('dig right removes the brick below and to the right', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '........', 10: '########' }));
            const dug = await page.evaluate(() => {
                placeAt(player, 3, 9);
                const ok = dig(1);
                return { ok, tile: grid[10][4], holes: holes.length };
            });
            expect(dug.ok).toBe(true);
            expect(dug.tile).toBe('.');
            expect(dug.holes).toBe(1);
        });

        test('dig left removes the brick below and to the left', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '........', 10: '########' }));
            expect(await page.evaluate(() => { placeAt(player, 3, 9); return dig(-1); })).toBe(true);
            expect(await page.evaluate(() => grid[10][2])).toBe('.');
        });

        test('solid stone cannot be dug', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '........', 10: '####@###' }));
            expect(await page.evaluate(() => { placeAt(player, 3, 9); return dig(1); })).toBe(false);
            expect(await page.evaluate(() => grid[10][4])).toBe('@');
        });

        test('empty space cannot be dug', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '........', 10: '###.####' }));
            expect(await page.evaluate(() => { placeAt(player, 4, 9); return dig(-1); })).toBe(false);
        });

        test('digging is blocked when the tile above the target is solid', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '....#...', 10: '########' }));
            expect(await page.evaluate(() => { placeAt(player, 3, 9); return dig(1); })).toBe(false);
        });

        test('the player cannot dig from a ladder', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '...H....', 10: '########' }));
            expect(await page.evaluate(() => { placeAt(player, 3, 9); return dig(1); })).toBe(false);
        });

        test('the player cannot dig while hanging on a rope', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '---------', 10: '########' }));
            expect(await page.evaluate(() => { placeAt(player, 3, 9); return dig(1); })).toBe(false);
        });

        test('the player cannot dig in mid-air', async ({ page }) => {
            await loadSandbox(page, sandbox({ 10: '########' }));
            expect(await page.evaluate(() => { placeAt(player, 3, 5); return dig(1); })).toBe(false);
        });

        test('a hole refills after HOLE_TIME', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '........', 10: '########' }));
            await page.evaluate(() => { placeAt(player, 3, 9); dig(1); });
            await run(page, 1);
            expect(await page.evaluate(() => grid[10][4])).toBe('.');
            await run(page, await page.evaluate(() => HOLE_TIME));
            expect(await page.evaluate(() => grid[10][4])).toBe('#');
            expect(await page.evaluate(() => holes.length)).toBe(0);
        });

        test('the player can drop into a freshly dug hole', async ({ page }) => {
            await loadSandbox(page, sandbox({ 10: FLOOR, 11: FLOOR }));
            await page.evaluate(() => { placeAt(player, 3, 9); dig(1); heldKeys.add('right'); });
            await run(page, 1);
            expect(await playerTile(page)).toEqual({ c: 4, r: 10 });
        });

        test('the Z and X keys dig left and right', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '........', 10: '########' }));
            await page.evaluate(() => placeAt(player, 3, 9));
            await page.keyboard.press('KeyZ');
            expect(await page.evaluate(() => grid[10][2])).toBe('.');
            await page.evaluate(() => placeAt(player, 3, 9));
            await page.keyboard.press('KeyX');
            expect(await page.evaluate(() => grid[10][4])).toBe('.');
        });
    });

    // -----------------------------------------------------------------------
    // Guards
    // -----------------------------------------------------------------------
    test.describe('guards', () => {
        test('a guard walks toward the player', async ({ page }) => {
            await loadSandbox(page, sandbox({ 10: FLOOR }));
            await page.evaluate(() => {
                placeAt(player, 1, 9);
                guards.length = 0;
                spawnGuard(10, 9);
            });
            await run(page, 1.5);
            expect(await page.evaluate(() => guards[0].c)).toBeLessThan(9);
        });

        test('a guard climbs a ladder to reach the player', async ({ page }) => {
            await loadSandbox(page, sandbox({
                6: '...H', 7: '...H', 8: '...H', 9: '...H', 10: FLOOR,
            }));
            await page.evaluate(() => {
                placeAt(player, 3, 6);
                guards.length = 0;
                spawnGuard(7, 9);
            });
            // Track the highest point the guard reaches: it dies on contact with
            // the player, which reloads the level, so sample as we go.
            const highest = await page.evaluate(() => {
                let best = 99;
                for (let i = 0; i < 180; i++) {
                    step(1 / 60);
                    if (guards[0]) best = Math.min(best, guards[0].r);
                }
                return best;
            });
            expect(highest).toBeLessThan(9);
        });

        test('touching a guard costs a life', async ({ page }) => {
            await loadSandbox(page, sandbox({ 10: FLOOR }));
            await page.evaluate(() => {
                placeAt(player, 4, 9);
                guards.length = 0;
                spawnGuard(6, 9);
            });
            await run(page, 3);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a guard falls into a hole and is trapped', async ({ page }) => {
            await loadSandbox(page, sandbox({ 10: FLOOR }));
            await page.evaluate(() => {
                placeAt(player, 25, 9);
                guards.length = 0;
                spawnGuard(6, 9);
                grid[10][7] = '.';
                holes.push({ c: 7, r: 10, t: 0 });
            });
            await run(page, 2);
            const g = await page.evaluate(() => ({ c: guards[0].c, r: guards[0].r, trapped: guards[0].trapped }));
            expect(g).toMatchObject({ c: 7, r: 10 });
            expect(g.trapped).toBeGreaterThan(0);
        });

        test('a trapped guard climbs back out', async ({ page }) => {
            await loadSandbox(page, sandbox({ 10: FLOOR }));
            await page.evaluate(() => {
                placeAt(player, 25, 9);
                guards.length = 0;
                spawnGuard(6, 9);
                grid[10][7] = '.';
                holes.push({ c: 7, r: 10, t: 0 });
            });
            await run(page, 2);
            expect(await page.evaluate(() => guards[0].r)).toBe(10);
            await run(page, await page.evaluate(() => TRAP_TIME + 1));
            expect(await page.evaluate(() => guards[0].r)).toBe(9);
        });

        test('a guard caught by a refilling hole respawns at its start', async ({ page }) => {
            await loadSandbox(page, sandbox({ 10: FLOOR }));
            await page.evaluate(() => {
                placeAt(player, 25, 9);
                guards.length = 0;
                spawnGuard(6, 9);
                grid[10][7] = '.';
                holes.push({ c: 7, r: 10, t: HOLE_TIME - 1.2 });
            });
            // Sample on the exact frame the brick heals over: the guard is put
            // back on its spawn tile and immediately resumes the chase.
            const g = await page.evaluate(() => {
                let refilledAfter = -1;
                for (let i = 0; i < 180; i++) {
                    step(1 / 60);
                    if (grid[10][7] === '#') { refilledAfter = i; break; }
                }
                return {
                    refilledAfter,
                    c: Math.round(guards[0].c), r: Math.round(guards[0].r),
                    spawn: [guards[0].spawnC, guards[0].spawnR],
                    trapped: guards[0].trapped,
                };
            });
            expect(g.refilledAfter).toBeGreaterThan(0);
            expect([g.c, g.r]).toEqual(g.spawn);
            expect(g.trapped).toBe(0);
        });

        test('the player can stand on a trapped guard', async ({ page }) => {
            await loadSandbox(page, sandbox({ 10: FLOOR }));
            await page.evaluate(() => {
                guards.length = 0;
                spawnGuard(5, 10);
                guards[0].trapped = 60;
                grid[10][5] = '.';
                holes.push({ c: 5, r: 10, t: 0 });
                placeAt(player, 5, 9);
            });
            await run(page, 1);
            expect(await playerTile(page)).toEqual({ c: 5, r: 9 });
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('guards do not stack on the same tile', async ({ page }) => {
            await loadSandbox(page, sandbox({ 10: FLOOR }));
            await page.evaluate(() => {
                placeAt(player, 0, 9);
                guards.length = 0;
                spawnGuard(8, 9);
                spawnGuard(9, 9);
            });
            const overlapped = await page.evaluate(() => {
                let bad = false;
                for (let i = 0; i < 180; i++) {
                    step(1 / 60);
                    if (guards.length === 2
                        && Math.abs(guards[0].c - guards[1].c) < 0.5
                        && Math.abs(guards[0].r - guards[1].r) < 0.5) bad = true;
                }
                return bad;
            });
            expect(overlapped).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Dying
    // -----------------------------------------------------------------------
    test.describe('losing a life', () => {
        test('a refilling hole crushes the player', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '........', 10: '########', 11: '########' }));
            await page.evaluate(() => {
                placeAt(player, 3, 9);
                dig(1);
                placeAt(player, 4, 10);
                holes[0].t = HOLE_TIME - 0.1;
            });
            await run(page, 0.5);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('dying reloads the level and keeps the score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 700;
                goldLeft = 1;
                loseLife();
            });
            const s = await page.evaluate(() => ({ score, lives, goldLeft, goldTotal, levelIndex }));
            expect(s.score).toBe(700);
            expect(s.lives).toBe(2);
            expect(s.goldLeft).toBe(s.goldTotal);
            expect(s.levelIndex).toBe(0);
        });

        test('the player respawns on the start marker', async ({ page }) => {
            await page.evaluate(() => { startGame(); placeAt(player, 20, 13); loseLife(); });
            const p = await playerTile(page);
            const start = await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++) {
                    const c = LEVELS[0][r].indexOf('P');
                    if (c >= 0) return { c, r };
                }
                return null;
            });
            expect(p).toEqual(start);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate(() => { startGame(); lives = 1; loseLife(); });
            expect(await page.evaluate(() => state)).toBe('over');
            expect(await page.evaluate(() => lives)).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('Space starts a new game after a game over', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 1234; lives = 1; loseLife(); });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, score, lives }));
            expect(s).toEqual({ state: 'running', score: 0, lives: 3 });
        });
    });

    // -----------------------------------------------------------------------
    // Finishing levels
    // -----------------------------------------------------------------------
    test.describe('escaping', () => {
        test('reaching the top row before the gold is gone does nothing', async ({ page }) => {
            await loadSandbox(page, sandbox({ 0: 'H', 1: 'H', 9: '..$', 10: '####' }));
            await page.evaluate(() => placeAt(player, 0, 0));
            await run(page, 0.5);
            expect(await page.evaluate(() => levelIndex)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('reaching the top row with all gold collected advances the level', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                goldLeft = 0;
                exitRevealed = true;
                placeAt(player, 5, 0);
            });
            await run(page, 0.2);
            expect(await page.evaluate(() => levelIndex)).toBe(1);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('finishing a level awards the level bonus', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                goldLeft = 0;
                exitRevealed = true;
                placeAt(player, 5, 0);
                const before = score;
                step(1 / 60);
                return { before, after: score, bonus: LEVEL_BONUS };
            });
            expect(s.after).toBe(s.before + s.bonus);
        });

        test('the next level is loaded fresh with its own gold', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                goldLeft = 0;
                exitRevealed = true;
                placeAt(player, 5, 0);
                step(1 / 60);
                return { goldLeft, goldTotal, exitRevealed, guards: guards.length };
            });
            expect(s.goldLeft).toBe(s.goldTotal);
            expect(s.goldLeft).toBeGreaterThan(0);
            expect(s.exitRevealed).toBe(false);
            expect(s.guards).toBeGreaterThan(0);
        });

        test('escaping the last level wins the game', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                levelIndex = LEVELS.length - 1;
                loadLevel(levelIndex);
                goldLeft = 0;
                exitRevealed = true;
                placeAt(player, 5, 0);
                step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/win|complete|escaped/i);
        });

        test('a route-finding runner can clear every level and win', async ({ page }) => {
            // Drive the real game with a breadth-first route finder over the
            // same moves a human has (including digging through to gold below).
            // Guards are cleared out so this measures level design, not luck.
            const result = await page.evaluate(() => {
                startGame();

                const edges = (c, r) => {
                    const out = [];
                    if (!isSupported(c, r)) {
                        if (!isSolid(c, r + 1)) out.push({ dc: 0, dr: 1 });
                        return out;
                    }
                    if (isLadder(c, r - 1)) out.push({ dc: 0, dr: -1 });
                    if (r + 1 < ROWS && !isSolid(c, r + 1)) out.push({ dc: 0, dr: 1 });
                    if (!isSolid(c - 1, r)) out.push({ dc: -1, dr: 0 });
                    if (!isSolid(c + 1, r)) out.push({ dc: 1, dr: 0 });
                    if (isSolid(c, r + 1) && !isLadder(c, r) && !isRope(c, r)) {
                        for (const d of [-1, 1]) {
                            if (tile(c + d, r + 1) === '#' && tile(c + d, r) === '.') {
                                out.push({ dc: d, dr: 1, dig: d });
                            }
                        }
                    }
                    return out;
                };

                const goalKeys = () => {
                    const list = [];
                    if (exitRevealed) {
                        for (let c = 0; c < COLS; c++) list.push(`${c},0`);
                        return list;
                    }
                    for (let r = 0; r < ROWS; r++) {
                        for (let c = 0; c < COLS; c++) if (grid[r][c] === '$') list.push(`${c},${r}`);
                    }
                    return list;
                };

                let target = null;
                const plan = (sc, sr) => {
                    const all = goalKeys();
                    if (target && !all.includes(target)) target = null;
                    const want = new Set(target ? [target] : all);
                    if (want.has(`${sc},${sr}`)) return null;
                    const seen = new Set([`${sc},${sr}`]);
                    const first = new Map();
                    const queue = [[sc, sr]];
                    for (let qi = 0; qi < queue.length; qi++) {
                        const [c, r] = queue[qi];
                        const from = first.get(`${c},${r}`);
                        for (const e of edges(c, r)) {
                            const nc = c + e.dc;
                            const nr = r + e.dr;
                            if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
                            const key = `${nc},${nr}`;
                            if (seen.has(key)) continue;
                            seen.add(key);
                            first.set(key, from || e);
                            if (want.has(key)) { target = key; return first.get(key); }
                            queue.push([nc, nr]);
                        }
                    }
                    target = null;
                    return null;
                };

                const DIR = { '-1,0': 'left', '1,0': 'right', '0,-1': 'up', '0,1': 'down' };
                const cleared = [];
                let seenLevel = 0;
                let frames = 0;
                while (state === 'running' && frames < 60 * 400) {
                    guards.length = 0;                     // each level reload respawns them
                    // Plan from the tile being entered so the key is already
                    // held when the runner lands on it.
                    const c = player.moving ? player.tc : player.c;
                    const r = player.moving ? player.tr : player.r;
                    const move = plan(c, r);
                    heldKeys.clear();
                    if (move && move.dig) {
                        if (!player.moving) dig(move.dig);
                    } else if (move) {
                        heldKeys.add(DIR[`${move.dc},${move.dr}`]);
                    }
                    step(1 / 60);
                    frames++;
                    if (levelIndex !== seenLevel && levelIndex < LEVELS.length) {
                        cleared.push(seenLevel + 1);
                        seenLevel = levelIndex;
                        target = null;
                    }
                }
                if (state === 'won') cleared.push(LEVELS.length);
                return { state, score, cleared, seconds: frames / 60, levels: LEVELS.length };
            });

            expect(result.cleared).toEqual([...Array(result.levels).keys()].map((i) => i + 1));
            expect(result.state).toBe('won');
            expect(result.score).toBeGreaterThan(0);
        });

        test('the level number in the HUD counts from one', async ({ page }) => {
            await page.evaluate(() => { startGame(); levelIndex = 1; loadLevel(1); updateHud(); });
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Scoring / HUD / pausing
    // -----------------------------------------------------------------------
    test.describe('score and HUD', () => {
        test('the score display follows the score', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '..$.....', 10: '########' }));
            await page.evaluate(() => { placeAt(player, 0, 9); heldKeys.add('right'); });
            await run(page, 1);
            const points = await page.evaluate(() => score);
            await expect(page.locator('#score')).toHaveText(String(points));
            expect(points).toBeGreaterThan(0);
        });

        test('a new best score is stored', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 3000; lives = 1; loseLife(); });
            expect(await page.evaluate(() => localStorage.getItem('lode-runner-best'))).toBe('3000');
            await expect(page.locator('#best')).toHaveText('3000');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('lode-runner-best', '9000'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 100; lives = 1; loseLife(); });
            expect(await page.evaluate(() => localStorage.getItem('lode-runner-best'))).toBe('9000');
        });

        test('the lives display follows the lives', async ({ page }) => {
            await page.evaluate(() => { startGame(); loseLife(); });
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await loadSandbox(page, sandbox({ 9: '............', 10: '############' }));
            await page.evaluate(() => { placeAt(player, 1, 9); heldKeys.add('right'); togglePause(); });
            await run(page, 1);
            expect((await playerTile(page)).c).toBe(1);
        });

        test('the pause overlay explains itself', async ({ page }) => {
            await page.evaluate(() => { startGame(); togglePause(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas draws the level', async ({ page }) => {
            await page.evaluate(() => { startGame(); draw(); });
            const distinct = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                    if (seen.size > 6) break;
                }
                return seen.size;
            });
            expect(distinct).toBeGreaterThan(3);
        });

        test('the player is drawn at its tile', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                placeAt(player, 10, 9);
                draw();
                const px = ctx.getImageData(10 * TILE + TILE / 2, 9 * TILE + TILE / 2, 1, 1).data;
                return [px[0], px[1], px[2]];
            });
            expect(painted.some((v) => v > 40)).toBe(true);
        });

        test('the animation loop keeps running', async ({ page }) => {
            await page.evaluate(() => startGame());
            const first = await page.evaluate(() => frameCount);
            await page.waitForTimeout(200);
            const second = await page.evaluate(() => frameCount);
            expect(second).toBeGreaterThan(first);
        });
    });
});
