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
// run, so every held key is confirmed against the game's input state before the
// simulation is advanced. Without this the specs race the real animation loop.
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

// Start a game with the guards frozen, so long simulations stay deterministic.
// Specs that are about guards switch them back on.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        guardsEnabled = false;
    });

const place = (page, col, row) =>
    page.evaluate(([c, r]) => placeRunner(c, r), [col, row]);

const runnerCell = (page) =>
    page.evaluate(() => ({ c: colOf(runner.x), r: rowOf(runner.y) }));

const consts = (page) =>
    page.evaluate(() => ({
        TILE,
        COLS,
        ROWS,
        GOLD_POINTS,
        LEVEL_POINTS,
        HOLE_REFILL,
        TRAP_ESCAPE,
    }));

const clearAllGold = (page) =>
    page.evaluate(() => {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) if (grid[r][c] === '$') grid[r][c] = ' ';
        }
        for (const g of guards) g.gold = 0;
    });

// Find the first cell matching a predicate evaluated in page context. The
// predicate is passed as source so the specs can search the *loaded* level
// instead of hard coding coordinates that level edits would break.
const findCell = (page, predicateSource) =>
    page.evaluate((src) => {
        const pred = new Function('c', 'r', `return (${src})(c, r);`);
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) if (pred(c, r)) return { c, r };
        }
        return null;
    }, predicateSource);

// A cell the runner can stand on with diggable brick under both sides.
const DIG_SPOT = `(c, r) => c > 0 && c < COLS - 1 && tileAt(c, r) === ' ' &&
    tileAt(c, r - 1) === ' ' && isBlocking(c, r + 1) &&
    tileAt(c - 1, r) === ' ' && tileAt(c + 1, r) === ' ' &&
    tileAt(c - 1, r + 1) === '#' && tileAt(c + 1, r + 1) === '#' &&
    !isLadderAt(c, r) && !isRopeAt(c, r)`;

// Dig a hole to the runner's right and drop a guard into it. Returns the hole
// cell, or null when the level has no suitable spot.
const trapGuard = (page, extra = '() => ({})') =>
    page.evaluate(
        ([digSpot, extraSrc]) => {
            const pred = new Function('c', 'r', `return (${digSpot})(c, r);`);
            const after = new Function('hole', `return (${extraSrc})(hole);`);
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    if (!pred(c, r)) continue;
                    guardsEnabled = false;
                    placeRunner(c, r);
                    digRight();
                    placeGuard(guards[0], c + 1, r);
                    guardsEnabled = true;
                    return Object.assign({ c: c + 1, r: r + 1 }, after({ c: c + 1, r: r + 1 }));
                }
            }
            return null;
        },
        [DIG_SPOT, extra]
    );

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
            const { TILE, COLS, ROWS } = await consts(page);
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', String(COLS * TILE));
            await expect(canvas).toHaveAttribute('height', String(ROWS * TILE));
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level, lives and gold', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#gold')).not.toHaveText('0');
        });

        test('help text mentions digging', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/dig/i);
        });
    });

    // -----------------------------------------------------------------------
    // Level data
    // -----------------------------------------------------------------------
    test.describe('level data', () => {
        test('there are three levels', async ({ page }) => {
            expect(await page.evaluate(() => LEVELS.length)).toBe(3);
        });

        test('every level is ROWS rows of COLS characters', async ({ page }) => {
            const bad = await page.evaluate(() =>
                LEVELS.flatMap((lvl, i) => {
                    const out = [];
                    if (lvl.length !== ROWS) out.push(`level ${i} has ${lvl.length} rows`);
                    lvl.forEach((row, r) => {
                        if (row.length !== COLS)
                            out.push(`level ${i} row ${r} has ${row.length} cols`);
                    });
                    return out;
                })
            );
            expect(bad).toEqual([]);
        });

        test('every level has exactly one runner spawn', async ({ page }) => {
            const counts = await page.evaluate(() =>
                LEVELS.map((lvl) => lvl.join('').split('').filter((ch) => ch === 'P').length)
            );
            expect(counts).toEqual([1, 1, 1]);
        });

        test('every level has gold, guards and an exit ladder', async ({ page }) => {
            const stats = await page.evaluate(() =>
                LEVELS.map((lvl) => {
                    const flat = lvl.join('');
                    const n = (ch) => flat.split('').filter((c) => c === ch).length;
                    return { gold: n('$'), guards: n('G'), exit: n('E') };
                })
            );
            for (const s of stats) {
                expect(s.gold).toBeGreaterThan(0);
                expect(s.guards).toBeGreaterThan(0);
                expect(s.exit).toBeGreaterThan(0);
            }
        });

        test('every level uses only known tile characters', async ({ page }) => {
            const unknown = await page.evaluate(() => {
                const known = new Set([' ', '#', '@', 'H', '-', '$', 'E', 'P', 'G']);
                return [...new Set(LEVELS.map((l) => l.join('')).join('').split(''))].filter(
                    (c) => !known.has(c)
                );
            });
            expect(unknown).toEqual([]);
        });

        test('every piece of gold rests on something solid', async ({ page }) => {
            // Gold floating in mid-air can never be picked up, so the level data
            // must always put it on a floor, a ladder or a rope.
            const floating = await page.evaluate(() => {
                const bad = [];
                LEVELS.forEach((lvl, i) => {
                    lvl.forEach((row, r) => {
                        row.split('').forEach((ch, c) => {
                            if (ch !== '$') return;
                            const here = lvl[r][c];
                            const below = r + 1 < ROWS ? lvl[r + 1][c] : '@';
                            const standing = '#@HE'.includes(below) || 'H-E'.includes(here);
                            if (!standing) bad.push(`level ${i} gold at ${c},${r}`);
                        });
                    });
                });
                return bad;
            });
            expect(floating).toEqual([]);
        });

        test('spawn markers are stripped from the loaded grid', async ({ page }) => {
            await startQuiet(page);
            const leftovers = await page.evaluate(() =>
                grid.flat().filter((ch) => ch === 'P' || ch === 'G')
            );
            expect(leftovers).toEqual([]);
        });

        // Model of what the runner can reach without digging: step sideways
        // (falling to wherever that lands you), climb a ladder, or drop off.
        // Used to prove each level is playable rather than merely well formed.
        const REACH = `(startC, startR) => {
            const lands = (c, r) => isLadderAt(c, r) || isBlocking(c, r + 1) || isLadderAt(c, r + 1);
            const landRow = (c, r) => {
                let rr = r;
                while (rr < ROWS - 1 && !lands(c, rr)) rr++;
                return rr;
            };
            const moves = (c, r) => {
                const out = [];
                const standable = isLadderAt(c, r) || isRopeAt(c, r) ||
                    isBlocking(c, r + 1) || isLadderAt(c, r + 1);
                if (standable) {
                    for (const d of [-1, 1]) {
                        const nc = c + d;
                        if (nc < 0 || nc >= COLS || isBlocking(nc, r)) continue;
                        out.push([nc, landRow(nc, r)]);
                    }
                }
                if (isLadderAt(c, r) && r > 0 && !isBlocking(c, r - 1)) out.push([c, r - 1]);
                if (r < ROWS - 1 && !isBlocking(c, r + 1)) {
                    out.push(isLadderAt(c, r + 1) ? [c, r + 1] : [c, landRow(c, r + 1)]);
                }
                return out;
            };
            const seen = new Set([startR * COLS + startC]);
            const queue = [[startC, startR]];
            while (queue.length) {
                const [c, r] = queue.pop();
                for (const [nc, nr] of moves(c, r)) {
                    const k = nr * COLS + nc;
                    if (seen.has(k)) continue;
                    seen.add(k);
                    queue.push([nc, nr]);
                }
            }
            return seen;
        }`;

        test('every piece of gold can be reached from the spawn', async ({ page }) => {
            const bad = await page.evaluate((src) => {
                const reach = new Function('startC', 'startR', `return (${src})(startC, startR);`);
                const out = [];
                for (let i = 0; i < LEVELS.length; i++) {
                    level = i + 1;
                    loadLevel(i);
                    const seen = reach(runnerSpawn.c, runnerSpawn.r);
                    for (let r = 0; r < ROWS; r++)
                        for (let c = 0; c < COLS; c++)
                            if (grid[r][c] === '$' && !seen.has(r * COLS + c))
                                out.push(`level ${i} gold ${c},${r}`);
                }
                level = 1;
                loadLevel(0);
                return out;
            }, REACH);
            expect(bad).toEqual([]);
        });

        test('no reachable cell can strand the runner away from the exit', async ({ page }) => {
            const bad = await page.evaluate((src) => {
                const reach = new Function('startC', 'startR', `return (${src})(startC, startR);`);
                const out = [];
                for (let i = 0; i < LEVELS.length; i++) {
                    level = i + 1;
                    loadLevel(i);
                    exitRevealed = true; // the endgame: the ladder is open
                    const tops = [];
                    for (let c = 0; c < COLS; c++) if (grid[0][c] === 'E') tops.push(c);
                    if (!tops.length) {
                        out.push(`level ${i} has no exit on the top row`);
                        continue;
                    }
                    for (const cell of reach(runnerSpawn.c, runnerSpawn.r)) {
                        const c = cell % COLS;
                        const r = Math.floor(cell / COLS);
                        const from = reach(c, r);
                        if (!tops.some((tc) => from.has(tc))) out.push(`level ${i} strands at ${c},${r}`);
                    }
                }
                level = 1;
                loadLevel(0);
                return out;
            }, REACH);
            expect(bad).toEqual([]);
        });

        test('every exit ladder column reaches the top row', async ({ page }) => {
            // An exit column must run unbroken from its lowest E up to row 0,
            // otherwise revealing it cannot let the runner out.
            const broken = await page.evaluate(() => {
                const bad = [];
                LEVELS.forEach((lvl, i) => {
                    const cols = new Set();
                    lvl.forEach((row) =>
                        row.split('').forEach((ch, c) => {
                            if (ch === 'E') cols.add(c);
                        })
                    );
                    for (const c of cols) {
                        const rows = [];
                        lvl.forEach((row, r) => {
                            if (row[c] === 'E') rows.push(r);
                        });
                        const lowest = Math.max(...rows);
                        for (let r = 0; r <= lowest; r++) {
                            if (lvl[r][c] !== 'E') bad.push(`level ${i} col ${c} row ${r}`);
                        }
                    }
                });
                return bad;
            });
            expect(broken).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting hides the overlay', async ({ page }) => {
            await startQuiet(page);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('runner starts on the level spawn cell', async ({ page }) => {
            await startQuiet(page);
            const s = await page.evaluate(() => ({
                cell: { c: colOf(runner.x), r: rowOf(runner.y) },
                spawn: { c: runnerSpawn.c, r: runnerSpawn.r },
            }));
            expect(s.cell).toEqual(s.spawn);
        });

        test('a fresh game has three lives and no score', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => ({ lives, score, level }))).toEqual({
                lives: 3,
                score: 0,
                level: 1,
            });
        });

        test('guards are spawned from the level markers', async ({ page }) => {
            await startQuiet(page);
            const matches = await page.evaluate(
                () =>
                    guards.length ===
                    LEVELS[0].join('').split('').filter((c) => c === 'G').length
            );
            expect(matches).toBe(true);
        });

        test('the exit ladder starts hidden', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => exitRevealed)).toBe(false);
        });

        test('gold HUD matches the gold left on the level', async ({ page }) => {
            await startQuiet(page);
            const left = await page.evaluate(() => goldRemaining());
            expect(left).toBeGreaterThan(0);
            await expect(page.locator('#gold')).toHaveText(String(left));
        });
    });

    // -----------------------------------------------------------------------
    // Running and falling
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('holding right moves the runner right', async ({ page }) => {
            await startQuiet(page);
            const x0 = await page.evaluate(() => runner.x);
            await hold(page, 'ArrowRight');
            await advance(page, 20);
            await release(page, 'ArrowRight');
            expect(await page.evaluate(() => runner.x)).toBeGreaterThan(x0);
        });

        test('holding left moves the runner left', async ({ page }) => {
            await startQuiet(page);
            const x0 = await page.evaluate(() => {
                placeRunner(8, 14);
                return runner.x;
            });
            await hold(page, 'ArrowLeft');
            await advance(page, 20);
            await release(page, 'ArrowLeft');
            expect(await page.evaluate(() => runner.x)).toBeLessThan(x0);
        });

        test('A and D move the runner too', async ({ page }) => {
            await startQuiet(page);
            const x0 = await page.evaluate(() => runner.x);
            await hold(page, 'd');
            await advance(page, 15);
            await release(page, 'd');
            const x1 = await page.evaluate(() => runner.x);
            expect(x1).toBeGreaterThan(x0);
            await hold(page, 'a');
            await advance(page, 15);
            await release(page, 'a');
            expect(await page.evaluate(() => runner.x)).toBeLessThan(x1);
        });

        test('releasing the key stops the runner', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'ArrowRight');
            await advance(page, 10);
            await release(page, 'ArrowRight');
            const x = await page.evaluate(() => runner.x);
            await advance(page, 30);
            expect(await page.evaluate(() => runner.x)).toBeCloseTo(x, 5);
        });

        test('the runner cannot walk through a brick wall', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(
                page,
                `(c, r) => c > 1 && isBlocking(c, r) && tileAt(c - 1, r) === ' ' &&
                    isBlocking(c - 1, r + 1) && !isLadderAt(c - 1, r) && !isRopeAt(c - 1, r)`
            );
            expect(spot).not.toBeNull();
            await page.evaluate(([c, r]) => placeRunner(c - 1, r), [spot.c, spot.r]);
            await hold(page, 'ArrowRight');
            await advance(page, 60);
            await release(page, 'ArrowRight');
            expect((await runnerCell(page)).c).toBe(spot.c - 1);
        });

        test('the runner cannot leave the left edge', async ({ page }) => {
            await startQuiet(page);
            await place(page, 1, 14);
            await hold(page, 'ArrowLeft');
            await advance(page, 120);
            await release(page, 'ArrowLeft');
            const ok = await page.evaluate(() => runner.x >= TILE / 2 - 0.01);
            expect(ok).toBe(true);
        });

        test('the runner cannot leave the right edge', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => placeRunner(COLS - 2, 14));
            await hold(page, 'ArrowRight');
            await advance(page, 240);
            await release(page, 'ArrowRight');
            const ok = await page.evaluate(() => runner.x <= COLS * TILE - TILE / 2 + 0.01);
            expect(ok).toBe(true);
        });

        test('an unsupported runner falls', async ({ page }) => {
            await startQuiet(page);
            const air = await findCell(
                page,
                `(c, r) => r > 2 && tileAt(c, r) === ' ' && tileAt(c, r + 1) === ' ' &&
                    !isLadderAt(c, r) && !isLadderAt(c, r + 1) && !isRopeAt(c, r)`
            );
            expect(air).not.toBeNull();
            const y0 = await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                return runner.y;
            }, [air.c, air.r]);
            await advance(page, 6);
            expect(await page.evaluate(() => runner.y)).toBeGreaterThan(y0);
        });

        test('a falling runner lands on the first solid floor', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(
                page,
                `(c, r) => r > 3 && isBlocking(c, r) && tileAt(c, r - 1) === ' ' &&
                    tileAt(c, r - 2) === ' ' && !isLadderAt(c, r - 1) && !isLadderAt(c, r - 2) &&
                    !isRopeAt(c, r - 1) && !isRopeAt(c, r - 2)`
            );
            expect(spot).not.toBeNull();
            await page.evaluate(([c, r]) => placeRunner(c, r - 2), [spot.c, spot.r]);
            await advance(page, 90);
            expect(await runnerCell(page)).toEqual({ c: spot.c, r: spot.r - 1 });
        });

        test('the runner does not sink through the floor once landed', async ({ page }) => {
            await startQuiet(page);
            const y0 = await page.evaluate(() => runner.y);
            await advance(page, 120);
            expect(await page.evaluate(() => runner.y)).toBeCloseTo(y0, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Ladders
    // -----------------------------------------------------------------------
    test.describe('ladders', () => {
        test('the runner climbs up a ladder', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(page, `(c, r) => isLadderAt(c, r) && isLadderAt(c, r - 1)`);
            expect(spot).not.toBeNull();
            const y0 = await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                return runner.y;
            }, [spot.c, spot.r]);
            await hold(page, 'ArrowUp');
            await advance(page, 25);
            await release(page, 'ArrowUp');
            expect(await page.evaluate(() => runner.y)).toBeLessThan(y0);
        });

        test('the runner climbs down a ladder', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(page, `(c, r) => isLadderAt(c, r) && isLadderAt(c, r + 1)`);
            expect(spot).not.toBeNull();
            const y0 = await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                return runner.y;
            }, [spot.c, spot.r]);
            await hold(page, 'ArrowDown');
            await advance(page, 25);
            await release(page, 'ArrowDown');
            expect(await page.evaluate(() => runner.y)).toBeGreaterThan(y0);
        });

        test('the runner cannot climb without a ladder', async ({ page }) => {
            await startQuiet(page);
            const y0 = await page.evaluate(() => runner.y);
            await hold(page, 'ArrowUp');
            await advance(page, 40);
            await release(page, 'ArrowUp');
            expect(await page.evaluate(() => runner.y)).toBeCloseTo(y0, 5);
        });

        test('a ladder holds the runner up', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(
                page,
                `(c, r) => r > 1 && r < ROWS - 2 && isLadderAt(c, r) && !isLadderAt(c, r + 1)`
            );
            expect(spot).not.toBeNull();
            // Clear the floor under the ladder so only the ladder can hold it up.
            const y0 = await page.evaluate(([c, r]) => {
                grid[r + 1][c] = ' ';
                placeRunner(c, r);
                return runner.y;
            }, [spot.c, spot.r]);
            await advance(page, 60);
            expect(await page.evaluate(() => runner.y)).toBeCloseTo(y0, 5);
        });

        test('climbing stops at the top of a ladder', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(
                page,
                `(c, r) => r > 1 && isLadderAt(c, r) && !isLadderAt(c, r - 1) && !isBlocking(c, r - 1)`
            );
            expect(spot).not.toBeNull();
            await page.evaluate(([c, r]) => placeRunner(c, r), [spot.c, spot.r]);
            await hold(page, 'ArrowUp');
            await advance(page, 120);
            await release(page, 'ArrowUp');
            expect((await runnerCell(page)).r).toBe(spot.r - 1);
        });

        test('a falling runner is caught by a ladder', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(
                page,
                `(c, r) => r > 2 && isLadderAt(c, r) && tileAt(c, r - 1) === ' ' &&
                    tileAt(c, r - 2) === ' '`
            );
            expect(spot).not.toBeNull();
            await page.evaluate(([c, r]) => placeRunner(c, r - 2), [spot.c, spot.r]);
            await advance(page, 90);
            const cell = await runnerCell(page);
            expect(cell.r).toBeLessThanOrEqual(spot.r);
            expect(cell.r).toBeGreaterThanOrEqual(spot.r - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Ropes
    // -----------------------------------------------------------------------
    test.describe('ropes', () => {
        test('a rope holds the runner up', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(
                page,
                `(c, r) => isRopeAt(c, r) && !isBlocking(c, r + 1) && !isLadderAt(c, r + 1)`
            );
            expect(spot).not.toBeNull();
            const y0 = await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                return runner.y;
            }, [spot.c, spot.r]);
            await advance(page, 60);
            expect(await page.evaluate(() => runner.y)).toBeCloseTo(y0, 5);
        });

        test('the runner traverses a rope sideways', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(page, `(c, r) => isRopeAt(c, r) && isRopeAt(c + 1, r)`);
            expect(spot).not.toBeNull();
            await page.evaluate(([c, r]) => placeRunner(c, r), [spot.c, spot.r]);
            await hold(page, 'ArrowRight');
            await advance(page, 25);
            await release(page, 'ArrowRight');
            expect((await runnerCell(page)).c).toBeGreaterThanOrEqual(spot.c + 1);
        });

        test('pressing down lets go of the rope', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(
                page,
                `(c, r) => isRopeAt(c, r) && !isBlocking(c, r + 1) && !isLadderAt(c, r + 1)`
            );
            expect(spot).not.toBeNull();
            const y0 = await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                return runner.y;
            }, [spot.c, spot.r]);
            await hold(page, 'ArrowDown');
            await advance(page, 20);
            await release(page, 'ArrowDown');
            expect(await page.evaluate(() => runner.y)).toBeGreaterThan(y0 + 10);
        });
    });

    // -----------------------------------------------------------------------
    // Gold and the exit
    // -----------------------------------------------------------------------
    test.describe('gold', () => {
        test('walking onto gold collects it and scores', async ({ page }) => {
            await startQuiet(page);
            const res = await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) {
                        if (grid[r][c] !== '$') continue;
                        const before = { score, gold: goldRemaining() };
                        placeRunner(c, r);
                        step(1 / 60);
                        return {
                            before,
                            score,
                            gold: goldRemaining(),
                            tile: tileAt(c, r),
                            points: GOLD_POINTS,
                        };
                    }
                }
                return null;
            });
            expect(res).not.toBeNull();
            expect(res.tile).toBe(' ');
            expect(res.score).toBe(res.before.score + res.points);
            expect(res.gold).toBe(res.before.gold - 1);
        });

        test('the gold HUD counts down', async ({ page }) => {
            await startQuiet(page);
            const before = Number(await page.locator('#gold').innerText());
            await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++)
                        if (grid[r][c] === '$') {
                            placeRunner(c, r);
                            step(1 / 60);
                            return;
                        }
            });
            await expect(page.locator('#gold')).toHaveText(String(before - 1));
        });

        test('collecting all gold reveals the exit ladder', async ({ page }) => {
            await startQuiet(page);
            await clearAllGold(page);
            await advance(page, 2);
            expect(await page.evaluate(() => exitRevealed)).toBe(true);
        });

        test('a revealed exit tile is climbable', async ({ page }) => {
            await startQuiet(page);
            const exitCell = await findCell(page, `(c, r) => tileAt(c, r) === 'E'`);
            expect(exitCell).not.toBeNull();
            expect(
                await page.evaluate(([c, r]) => isLadderAt(c, r), [exitCell.c, exitCell.r])
            ).toBe(false);
            await clearAllGold(page);
            await advance(page, 2);
            expect(
                await page.evaluate(([c, r]) => isLadderAt(c, r), [exitCell.c, exitCell.r])
            ).toBe(true);
        });

        test('gold carried by a guard still counts as remaining', async ({ page }) => {
            await startQuiet(page);
            // Hand the last nugget straight to a guard, in one go, so the live
            // animation frame never sees a board with no gold on it at all.
            await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++) if (grid[r][c] === '$') grid[r][c] = ' ';
                for (const g of guards) g.gold = 0;
                guards[0].gold = 1;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => goldRemaining())).toBe(1);
            expect(await page.evaluate(() => exitRevealed)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Digging
    // -----------------------------------------------------------------------
    test.describe('digging', () => {
        test('Z digs a hole down-left', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(page, DIG_SPOT);
            expect(spot).not.toBeNull();
            await page.evaluate(([c, r]) => placeRunner(c, r), [spot.c, spot.r]);
            await page.keyboard.press('z');
            const tile = await page.evaluate(([c, r]) => tileAt(c - 1, r + 1), [spot.c, spot.r]);
            expect(tile).toBe(' ');
        });

        test('X digs a hole down-right', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(page, DIG_SPOT);
            expect(spot).not.toBeNull();
            await page.evaluate(([c, r]) => placeRunner(c, r), [spot.c, spot.r]);
            await page.keyboard.press('x');
            const tile = await page.evaluate(([c, r]) => tileAt(c + 1, r + 1), [spot.c, spot.r]);
            expect(tile).toBe(' ');
        });

        test('digging records a hole with a refill timer', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(page, DIG_SPOT);
            expect(spot).not.toBeNull();
            const dug = await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                digLeft();
                return holes.map((h) => ({ c: h.c, r: h.r, t: h.t }));
            }, [spot.c, spot.r]);
            expect(dug).toHaveLength(1);
            expect(dug[0].c).toBe(spot.c - 1);
            expect(dug[0].r).toBe(spot.r + 1);
            expect(dug[0].t).toBeGreaterThan(0);
        });

        test('stone cannot be dug', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(
                page,
                `(c, r) => c > 0 && tileAt(c, r) === ' ' && tileAt(c - 1, r) === ' ' &&
                    isBlocking(c, r + 1) && tileAt(c - 1, r + 1) === '@' &&
                    !isLadderAt(c, r) && !isRopeAt(c, r)`
            );
            test.skip(spot === null, 'this level has no stone under a walkable cell');
            const dug = await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                return digLeft();
            }, [spot.c, spot.r]);
            expect(dug).toBe(false);
        });

        test('a mid-air runner cannot dig', async ({ page }) => {
            await startQuiet(page);
            const air = await findCell(
                page,
                `(c, r) => r > 2 && tileAt(c, r) === ' ' && tileAt(c, r + 1) === ' ' &&
                    !isLadderAt(c, r) && !isRopeAt(c, r)`
            );
            expect(air).not.toBeNull();
            const dug = await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                return digLeft() || digRight();
            }, [air.c, air.r]);
            expect(dug).toBe(false);
        });

        test('a runner on a ladder cannot dig', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(page, `(c, r) => isLadderAt(c, r)`);
            expect(spot).not.toBeNull();
            const dug = await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                return digLeft() || digRight();
            }, [spot.c, spot.r]);
            expect(dug).toBe(false);
        });

        test('digging locks the runner briefly', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(page, DIG_SPOT);
            expect(spot).not.toBeNull();
            const x0 = await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                digRight();
                return runner.x;
            }, [spot.c, spot.r]);
            expect(await page.evaluate(() => runner.digTimer)).toBeGreaterThan(0);
            await hold(page, 'ArrowRight');
            await advance(page, 2);
            const x1 = await page.evaluate(() => runner.x);
            await release(page, 'ArrowRight');
            expect(x1).toBeCloseTo(x0, 5);
        });

        test('the hole refills after its timer expires', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(page, DIG_SPOT);
            expect(spot).not.toBeNull();
            const res = await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                digLeft();
                for (let i = 0; i < Math.ceil((HOLE_REFILL + 0.2) * 60); i++) step(1 / 60);
                return { tile: tileAt(c - 1, r + 1), holes: holes.length };
            }, [spot.c, spot.r]);
            expect(res.tile).toBe('#');
            expect(res.holes).toBe(0);
        });

        test('the runner falls into their own hole', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(page, DIG_SPOT);
            expect(spot).not.toBeNull();
            await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                digRight();
                for (let i = 0; i < 30; i++) step(1 / 60);
                placeRunner(c + 1, r);
            }, [spot.c, spot.r]);
            await advance(page, 30);
            expect((await runnerCell(page)).r).toBeGreaterThan(spot.r);
        });

        test('a refilling brick crushes the runner', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(page, DIG_SPOT);
            expect(spot).not.toBeNull();
            const res = await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                const before = lives;
                digRight();
                for (let i = 0; i < 30; i++) step(1 / 60);
                placeRunner(c + 1, r + 1);
                for (let i = 0; i < Math.ceil(HOLE_REFILL * 60); i++) {
                    placeRunner(c + 1, r + 1);
                    step(1 / 60);
                    if (lives < before) break;
                }
                return { before, lives };
            }, [spot.c, spot.r]);
            expect(res.lives).toBe(res.before - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Guards
    // -----------------------------------------------------------------------
    test.describe('guards', () => {
        test('guards chase the runner', async ({ page }) => {
            await page.evaluate(() => startGame());
            const d0 = await page.evaluate(() => {
                const g = guards[0];
                placeRunner(Math.min(COLS - 2, colOf(g.x) + 6), rowOf(g.y));
                return Math.abs(g.x - runner.x);
            });
            await advance(page, 120);
            const d1 = await page.evaluate(() => Math.abs(guards[0].x - runner.x));
            expect(d1).toBeLessThan(d0);
        });

        test('a frozen guard does not move', async ({ page }) => {
            await startQuiet(page);
            const x0 = await page.evaluate(() => guards[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => guards[0].x)).toBeCloseTo(x0, 5);
        });

        test('touching a guard costs a life', async ({ page }) => {
            await page.evaluate(() => startGame());
            const res = await page.evaluate(() => {
                const before = lives;
                runner.x = guards[0].x;
                runner.y = guards[0].y;
                step(1 / 60);
                return { before, lives };
            });
            expect(res.lives).toBe(res.before - 1);
        });

        test('losing a life returns the runner to the spawn', async ({ page }) => {
            await page.evaluate(() => startGame());
            const s = await page.evaluate(() => {
                runner.x = guards[0].x;
                runner.y = guards[0].y;
                step(1 / 60);
                return {
                    cell: { c: colOf(runner.x), r: rowOf(runner.y) },
                    spawn: { c: runnerSpawn.c, r: runnerSpawn.r },
                };
            });
            expect(s.cell).toEqual(s.spawn);
        });

        test('collected gold survives losing a life', async ({ page }) => {
            await page.evaluate(() => startGame());
            const res = await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++)
                        if (grid[r][c] === '$') {
                            placeRunner(c, r);
                            step(1 / 60);
                            break;
                        }
                const gold = goldRemaining();
                runner.x = guards[0].x;
                runner.y = guards[0].y;
                step(1 / 60);
                return { gold, now: goldRemaining() };
            });
            expect(res.now).toBe(res.gold);
        });

        test('a guard that falls into a hole is trapped and scores', async ({ page }) => {
            await startQuiet(page);
            const hole = await trapGuard(
                page,
                `() => {
                    const before = score;
                    for (let i = 0; i < 60; i++) step(1 / 60);
                    return {
                        trapped: guards[0].trapped,
                        gc: colOf(guards[0].x),
                        gr: rowOf(guards[0].y),
                        gained: score - before,
                    };
                }`
            );
            expect(hole).not.toBeNull();
            expect(hole.trapped).toBe(true);
            expect({ c: hole.gc, r: hole.gr }).toEqual({ c: hole.c, r: hole.r });
            expect(hole.gained).toBeGreaterThan(0);
        });

        test('a trapped guard is harmless and carries the runner', async ({ page }) => {
            await page.evaluate(() => startGame());
            const res = await page.evaluate(() => {
                const g = guards[0];
                g.trapped = true;
                g.trapTimer = 99;
                placeGuard(g, colOf(runner.x), rowOf(runner.y) + 1);
                const before = lives;
                const y = runner.y;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { lives, before, y, now: runner.y };
            });
            expect(res.lives).toBe(res.before);
            expect(res.now).toBeCloseTo(res.y, 5);
        });

        test('a trapped guard climbs out when its timer expires', async ({ page }) => {
            await startQuiet(page);
            const res = await trapGuard(
                page,
                // Sample the moment the guard breaks free: it chases the runner
                // straight afterwards, which would wash out the escape position.
                `() => {
                    let gr = -1;
                    for (let i = 0; i < Math.ceil((TRAP_ESCAPE + 1.2) * 60); i++) {
                        step(1 / 60);
                        if (!guards[0].trapped) { gr = rowOf(guards[0].y); break; }
                    }
                    return { trapped: guards[0].trapped, gr };
                }`
            );
            expect(res).not.toBeNull();
            expect(res.trapped).toBe(false);
            expect(res.gr).toBeLessThan(res.r);
        });

        test('a guard buried by the refilling brick respawns', async ({ page }) => {
            await startQuiet(page);
            const res = await trapGuard(
                page,
                `() => {
                    const before = score;
                    // Pin the escape timer so the brick closes on the guard.
                    const frames = Math.ceil((HOLE_REFILL + RESPAWN_TIME + 0.5) * 60);
                    for (let i = 0; i < frames; i++) {
                        guards[0].trapTimer = 999;
                        step(1 / 60);
                    }
                    return { gained: score - before, dead: guards[0].dead };
                }`
            );
            expect(res).not.toBeNull();
            const tile = await page.evaluate(([c, r]) => tileAt(c, r), [res.c, res.r]);
            expect(tile).toBe('#');
            expect(res.dead).toBe(false);
            expect(res.gained).toBeGreaterThan(0);
        });

        test('a hole holds a guard instead of dropping it through', async ({ page }) => {
            await startQuiet(page);
            const res = await trapGuard(
                page,
                `() => {
                    for (let i = 0; i < 45; i++) step(1 / 60);
                    return { gr: rowOf(guards[0].y) };
                }`
            );
            expect(res).not.toBeNull();
            expect(res.gr).toBe(res.r);
        });

        test('guards pick gold up and it is not lost', async ({ page }) => {
            await startQuiet(page);
            const res = await page.evaluate(() => {
                const before = goldRemaining();
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) {
                        if (grid[r][c] !== '$') continue;
                        placeGuard(guards[0], c, r);
                        guardsEnabled = true;
                        step(1 / 60);
                        return { gold: guards[0].gold, before, now: goldRemaining() };
                    }
                }
                return null;
            });
            expect(res).not.toBeNull();
            expect(res.gold).toBe(1);
            expect(res.now).toBe(res.before);
        });

        test('a trapped guard drops its gold', async ({ page }) => {
            await startQuiet(page);
            const res = await trapGuard(
                page,
                `() => {
                    guards[0].gold = 1;
                    for (let i = 0; i < 60; i++) step(1 / 60);
                    return { gold: guards[0].gold, trapped: guards[0].trapped };
                }`
            );
            expect(res).not.toBeNull();
            expect(res.trapped).toBe(true);
            expect(res.gold).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Level flow
    // -----------------------------------------------------------------------
    test.describe('level flow', () => {
        test('reaching the top with the exit open completes the level', async ({ page }) => {
            await startQuiet(page);
            const res = await page.evaluate(() => {
                const before = score;
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++) if (grid[r][c] === '$') grid[r][c] = ' ';
                for (const g of guards) g.gold = 0;
                step(1 / 60);
                placeRunner(grid[0].indexOf('E'), 0);
                step(1 / 60);
                return { before, level, score, state, points: LEVEL_POINTS };
            });
            expect(res.level).toBe(2);
            expect(res.state).toBe('running');
            expect(res.score).toBe(res.before + res.points);
        });

        test('the next level is loaded fresh', async ({ page }) => {
            await startQuiet(page);
            const s = await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++) if (grid[r][c] === '$') grid[r][c] = ' ';
                for (const g of guards) g.gold = 0;
                step(1 / 60);
                placeRunner(grid[0].indexOf('E'), 0);
                step(1 / 60);
                return {
                    gold: goldRemaining(),
                    exit: exitRevealed,
                    rows: grid.map((r) => r.join('')),
                    want: LEVELS[1].map((r) => r.replace(/[PG]/g, ' ')),
                };
            });
            expect(s.gold).toBeGreaterThan(0);
            expect(s.exit).toBe(false);
            expect(s.rows).toEqual(s.want);
        });

        test('reaching the top with the exit closed does nothing', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const c = grid[0].indexOf('E');
                placeRunner(c >= 0 ? c : 1, 0);
                step(1 / 60);
            });
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('clearing the last level wins the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                for (let i = 0; i < LEVELS.length; i++) {
                    guardsEnabled = false;
                    for (let r = 0; r < ROWS; r++)
                        for (let c = 0; c < COLS; c++) if (grid[r][c] === '$') grid[r][c] = ' ';
                    for (const g of guards) g.gold = 0;
                    step(1 / 60);
                    placeRunner(grid[0].indexOf('E'), 0);
                    step(1 / 60);
                }
            });
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win|clear|complete/i);
        });

        test('R gives up the level and costs a life', async ({ page }) => {
            await startQuiet(page);
            const lives0 = await page.evaluate(() => lives);
            await page.keyboard.press('r');
            expect(await page.evaluate(() => lives)).toBe(lives0 - 1);
        });

        test('running out of lives ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                killRunner();
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('game over shows the final score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 1234;
                lives = 1;
                killRunner();
            });
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('the best score is kept in localStorage', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 4321;
                lives = 1;
                killRunner();
            });
            expect(await page.evaluate(() => localStorage.getItem('loderunner-best'))).toBe('4321');
            await expect(page.locator('#best')).toHaveText('4321');
        });

        test('restarting after game over resets the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 500;
                lives = 1;
                killRunner();
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ state, score, lives, level }))).toEqual({
                state: 'running',
                score: 0,
                lives: 3,
                level: 1,
            });
        });

        test('holes are filled in when a life is lost', async ({ page }) => {
            await startQuiet(page);
            const spot = await findCell(page, DIG_SPOT);
            expect(spot).not.toBeNull();
            const res = await page.evaluate(([c, r]) => {
                placeRunner(c, r);
                digRight();
                const had = holes.length;
                killRunner();
                return { had, now: holes.length, tile: tileAt(c + 1, r + 1) };
            }, [spot.c, spot.r]);
            expect(res.had).toBe(1);
            expect(res.now).toBe(0);
            expect(res.tile).toBe('#');
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
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not simulate', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'ArrowRight');
            await page.keyboard.press('p');
            const x = await page.evaluate(() => runner.x);
            await advance(page, 30);
            expect(await page.evaluate(() => runner.x)).toBeCloseTo(x, 5);
            await page.keyboard.press('p');
            await release(page, 'ArrowRight');
        });

        test('the pause overlay is visible', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            const blank = await page.evaluate(() => {
                draw();
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                const first = [data[0], data[1], data[2]];
                for (let i = 4; i < data.length; i += 4) {
                    if (
                        data[i] !== first[0] ||
                        data[i + 1] !== first[1] ||
                        data[i + 2] !== first[2]
                    )
                        return false;
                }
                return true;
            });
            expect(blank).toBe(false);
        });

        test('drawing does not change the simulation', async ({ page }) => {
            await startQuiet(page);
            const same = await page.evaluate(() => {
                const snap = JSON.stringify([runner.x, runner.y, score, lives, grid]);
                for (let i = 0; i < 10; i++) draw();
                return snap === JSON.stringify([runner.x, runner.y, score, lives, grid]);
            });
            expect(same).toBe(true);
        });

        test('no console errors while playing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            page.on('console', (m) => {
                if (m.type() === 'error') errors.push(m.text());
            });
            await page.evaluate(() => startGame());
            await advance(page, 300);
            await page.evaluate(() => draw());
            expect(errors).toEqual([]);
        });
    });
});
