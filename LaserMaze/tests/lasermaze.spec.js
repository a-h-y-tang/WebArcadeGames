const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

const COLS = 10;
const ROWS = 8;
const TILE = 60;

// Direction indices used by the engine: 0=East 1=South 2=West 3=North.
const E = 0, S = 1, W = 2, N = 3;

// Click the centre of a grid cell. The canvas may be laid out smaller than its
// backing store on narrow viewports, so the click is scaled by the real box.
async function clickCell(page, c, r) {
    const box = await page.locator('#canvas').boundingBox();
    const scale = box.width / (COLS * TILE);
    await page.mouse.click(box.x + (c + 0.5) * TILE * scale, box.y + (r + 0.5) * TILE * scale);
}

// Replace the board with a hand-built one so a single rule can be tested in
// isolation. `cells` is a list of [c, r, cell].
const buildBoard = (page, cells) =>
    page.evaluate((list) => {
        grid = Array.from({ length: ROWS }, () =>
            Array.from({ length: COLS }, () => ({ kind: 'empty' })));
        for (const [c, r, cell] of list) grid[r][c] = cell;
        retrace();
        return beam;
    }, cells);

// Does any traced segment cover the centre of cell (c, r)?
const beamCovers = (page, c, r) =>
    page.evaluate(([c, r]) => {
        const x = (c + 0.5) * TILE, y = (r + 0.5) * TILE;
        return beam.segments.some((s) => {
            const onX = Math.min(s.x1, s.x2) - 0.01 <= x && x <= Math.max(s.x1, s.x2) + 0.01;
            const onY = Math.min(s.y1, s.y2) - 0.01 <= y && y <= Math.max(s.y1, s.y2) + 0.01;
            return onX && onY;
        });
    }, [c, r]);

// Brute-force every orientation of a level's rotatable devices, returning the
// fewest rotations that solve it from the authored starting state.
const minimumRotations = (page, levelIndex) =>
    page.evaluate((n) => {
        loadLevel(n);
        const knobs = [];
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const cell = grid[r][c];
                const turnable = cell.kind === 'mirror' || cell.kind === 'splitter';
                if (turnable && !cell.fixed) knobs.push([c, r, cell.state]);
            }
        }
        let best = Infinity, bestMask = -1;
        for (let mask = 0; mask < (1 << knobs.length); mask++) {
            knobs.forEach(([c, r], i) => { grid[r][c].state = (mask >> i) & 1; });
            const traced = traceBeam();
            if (traced.hitMine || traced.targets === 0) continue;
            if (traced.litCount !== traced.targets) continue;
            let turns = 0;
            knobs.forEach(([, , from], i) => { if (((mask >> i) & 1) !== from) turns++; });
            if (turns < best) { best = turns; bestMask = mask; }
        }
        knobs.forEach(([c, r, from], i) => { grid[r][c].state = from; });
        retrace();
        const solution = knobs
            .map(([c, r, from], i) => [c, r, (bestMask >> i) & 1, from])
            .filter(([, , want, from]) => want !== from)
            .map(([c, r]) => [c, r]);
        return { knobs: knobs.length, best, par: LEVELS[n].par, solution };
    }, levelIndex);

// Solve the current level by rotating exactly the devices that need it.
const solveLevel = async (page, levelIndex) => {
    const { solution } = await minimumRotations(page, levelIndex);
    await page.evaluate((cells) => {
        loadLevel(cells.levelIndex);
        for (const [c, r] of cells.list) rotate(c, r);
    }, { levelIndex, list: solution });
};

test.describe('Laser Maze', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Laser Maze', async ({ page }) => {
            await expect(page).toHaveTitle('Laser Maze');
        });

        test('canvas matches the grid size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', String(COLS * TILE));
            await expect(canvas).toHaveAttribute('height', String(ROWS * TILE));
            expect(await page.evaluate(() => [COLS, ROWS, TILE])).toEqual([COLS, ROWS, TILE]);
        });

        test('the first level is loaded and playable', async ({ page }) => {
            expect(await page.evaluate(() => [level, moves, state])).toEqual([0, 0, 'playing']);
        });

        test('grid is ROWS x COLS cells', async ({ page }) => {
            expect(await page.evaluate(() => [grid.length, grid[0].length])).toEqual([ROWS, COLS]);
        });

        test('HUD shows level, moves and par', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#moves')).toHaveText('0');
            await expect(page.locator('#par')).toHaveText(String(await page.evaluate(() => LEVELS[0].par)));
        });

        test('HUD names the level', async ({ page }) => {
            const name = await page.evaluate(() => LEVELS[0].name);
            await expect(page.locator('#level-name')).toHaveText(name);
        });

        test('HUD counts lit targets out of the level total', async ({ page }) => {
            const total = await page.evaluate(() => beam.targets);
            expect(total).toBeGreaterThan(0);
            await expect(page.locator('#targets')).toHaveText(`0 / ${total}`);
        });

        test('no best score is shown before a level is solved', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('the solved overlay is hidden while playing', async ({ page }) => {
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the help text explains the controls', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/rotate/i);
        });
    });

    // -----------------------------------------------------------------------
    // Level data
    // -----------------------------------------------------------------------
    test.describe('level data', () => {
        test('there are eight levels', async ({ page }) => {
            expect(await page.evaluate(() => LEVELS.length)).toBe(8);
        });

        test('every level is a ROWS x COLS map with a name and a par', async ({ page }) => {
            const bad = await page.evaluate(() => LEVELS
                .map((lv, i) => ({ i, lv }))
                .filter(({ lv }) => lv.rows.length !== ROWS
                    || lv.rows.some((row) => row.length !== COLS)
                    || !lv.name
                    || !(lv.par > 0))
                .map(({ i }) => i));
            expect(bad).toEqual([]);
        });

        test('every level has exactly one emitter and at least one target', async ({ page }) => {
            const counts = await page.evaluate(() => LEVELS.map((lv, i) => {
                loadLevel(i);
                let emitters = 0, targets = 0;
                for (const row of grid) {
                    for (const cell of row) {
                        if (cell.kind === 'emitter') emitters++;
                        if (cell.kind === 'target') targets++;
                    }
                }
                return { emitters, targets };
            }));
            expect(counts.every((c) => c.emitters === 1)).toBe(true);
            expect(counts.every((c) => c.targets >= 1)).toBe(true);
        });

        test('no level starts out already solved', async ({ page }) => {
            const solvedAtStart = await page.evaluate(() => LEVELS.map((lv, i) => {
                loadLevel(i);
                return beam.litCount === beam.targets && !beam.hitMine;
            }));
            expect(solvedAtStart).toEqual(new Array(8).fill(false));
        });
    });

    // -----------------------------------------------------------------------
    // Beam tracing
    // -----------------------------------------------------------------------
    test.describe('beam tracing', () => {
        test('the beam leaves the emitter in the emitter direction', async ({ page }) => {
            const traced = await buildBoard(page, [[1, 4, { kind: 'emitter', dir: E }]]);
            expect(traced.segments.length).toBe(1);
            expect(traced.segments[0].y1).toBeCloseTo(traced.segments[0].y2);
            expect(traced.segments[0].x2).toBeGreaterThan(traced.segments[0].x1);
        });

        test("a '/' mirror turns an eastbound beam north", async ({ page }) => {
            await buildBoard(page, [
                [1, 4, { kind: 'emitter', dir: E }],
                [5, 4, { kind: 'mirror', state: 0 }],
                [5, 1, { kind: 'target' }],
            ]);
            await page.evaluate(() => retrace());
            expect(await page.evaluate(() => grid[1][5].lit)).toBe(true);
        });

        test("a '\\' mirror turns an eastbound beam south", async ({ page }) => {
            await buildBoard(page, [
                [1, 1, { kind: 'emitter', dir: E }],
                [5, 1, { kind: 'mirror', state: 1 }],
                [5, 6, { kind: 'target' }],
            ]);
            await page.evaluate(() => retrace());
            expect(await page.evaluate(() => grid[6][5].lit)).toBe(true);
        });

        test("a '/' mirror turns a southbound beam west", async ({ page }) => {
            await buildBoard(page, [
                [5, 0, { kind: 'emitter', dir: S }],
                [5, 4, { kind: 'mirror', state: 0 }],
                [1, 4, { kind: 'target' }],
            ]);
            await page.evaluate(() => retrace());
            expect(await page.evaluate(() => grid[4][1].lit)).toBe(true);
        });

        test("a '\\' mirror turns a northbound beam west", async ({ page }) => {
            await buildBoard(page, [
                [5, 7, { kind: 'emitter', dir: N }],
                [5, 2, { kind: 'mirror', state: 1 }],
                [1, 2, { kind: 'target' }],
            ]);
            await page.evaluate(() => retrace());
            expect(await page.evaluate(() => grid[2][1].lit)).toBe(true);
        });

        test('a wall stops the beam', async ({ page }) => {
            await buildBoard(page, [
                [0, 4, { kind: 'emitter', dir: E }],
                [4, 4, { kind: 'wall' }],
                [7, 4, { kind: 'target' }],
            ]);
            await page.evaluate(() => retrace());
            expect(await page.evaluate(() => grid[4][7].lit)).toBe(false);
            expect(await beamCovers(page, 2, 4)).toBe(true);
            expect(await beamCovers(page, 6, 4)).toBe(false);
        });

        test('a target lets the beam through and lights up', async ({ page }) => {
            await buildBoard(page, [
                [0, 4, { kind: 'emitter', dir: E }],
                [3, 4, { kind: 'target' }],
                [7, 4, { kind: 'target' }],
            ]);
            await page.evaluate(() => retrace());
            expect(await page.evaluate(() => [grid[4][3].lit, grid[4][7].lit])).toEqual([true, true]);
            expect(await page.evaluate(() => beam.litCount)).toBe(2);
        });

        test('a mine swallows the beam and is reported', async ({ page }) => {
            await buildBoard(page, [
                [0, 4, { kind: 'emitter', dir: E }],
                [4, 4, { kind: 'mine' }],
                [7, 4, { kind: 'target' }],
            ]);
            await page.evaluate(() => retrace());
            expect(await page.evaluate(() => beam.hitMine)).toBe(true);
            expect(await page.evaluate(() => grid[4][7].lit)).toBe(false);
        });

        test('a mine hit is called out in the message line', async ({ page }) => {
            await buildBoard(page, [
                [0, 4, { kind: 'emitter', dir: E }],
                [4, 4, { kind: 'mine' }],
                [7, 4, { kind: 'target' }],
            ]);
            await page.evaluate(() => retrace());
            await expect(page.locator('#message')).toContainText(/mine/i);
        });

        test('a splitter both reflects and passes the beam through', async ({ page }) => {
            await buildBoard(page, [
                [0, 4, { kind: 'emitter', dir: E }],
                [4, 4, { kind: 'splitter', state: 0 }],
                [4, 1, { kind: 'target' }],
                [8, 4, { kind: 'target' }],
            ]);
            await page.evaluate(() => retrace());
            expect(await page.evaluate(() => [grid[1][4].lit, grid[4][8].lit])).toEqual([true, true]);
        });

        test('a mine on one splitter arm still spoils the board', async ({ page }) => {
            await buildBoard(page, [
                [0, 4, { kind: 'emitter', dir: E }],
                [4, 4, { kind: 'splitter', state: 1 }],
                [4, 7, { kind: 'mine' }],
                [8, 4, { kind: 'target' }],
            ]);
            await page.evaluate(() => retrace());
            expect(await page.evaluate(() => [beam.hitMine, grid[4][8].lit])).toEqual([true, true]);
            expect(await page.evaluate(() => solved())).toBe(false);
        });

        test('the beam cannot re-enter the emitter', async ({ page }) => {
            // Beam runs east, south, west, north and dies on the emitter cell.
            const traced = await buildBoard(page, [
                [2, 2, { kind: 'emitter', dir: E }],
                [6, 2, { kind: 'mirror', state: 1 }],
                [6, 5, { kind: 'mirror', state: 0 }],
                [2, 5, { kind: 'mirror', state: 1 }],
            ]);
            expect(traced.segments.length).toBe(4);
            expect(await beamCovers(page, 4, 2)).toBe(true);
            expect(await beamCovers(page, 2, 3)).toBe(true);
            expect(await beamCovers(page, 2, 1)).toBe(false);
        });

        test('a closed mirror loop terminates', async ({ page }) => {
            const traced = await buildBoard(page, [
                [2, 7, { kind: 'emitter', dir: N }],
                [2, 5, { kind: 'splitter', state: 1 }],
                [2, 2, { kind: 'mirror', state: 0 }],
                [6, 2, { kind: 'mirror', state: 1 }],
                [6, 5, { kind: 'mirror', state: 0 }],
            ]);
            expect(traced.segments.length).toBeLessThan(COLS * ROWS * 4);
        });

        test('tracing does not change the board', async ({ page }) => {
            const stable = await page.evaluate(() => {
                const before = JSON.stringify(grid.map((row) => row.map((c) => c.state ?? null)));
                traceBeam();
                return before === JSON.stringify(grid.map((row) => row.map((c) => c.state ?? null)));
            });
            expect(stable).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Rotating devices
    // -----------------------------------------------------------------------
    test.describe('rotating devices', () => {
        test('clicking a mirror flips it and costs a move', async ({ page }) => {
            const { c, r, before } = await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) {
                        if (grid[r][c].kind === 'mirror') return { c, r, before: grid[r][c].state };
                    }
                }
                return null;
            });
            await clickCell(page, c, r);
            expect(await page.evaluate(([c, r]) => grid[r][c].state, [c, r])).toBe(1 - before);
            await expect(page.locator('#moves')).toHaveText('1');
        });

        test('rotating twice returns the mirror to where it started', async ({ page }) => {
            await buildBoard(page, [
                [0, 4, { kind: 'emitter', dir: E }],
                [4, 4, { kind: 'mirror', state: 0 }],
                [9, 0, { kind: 'target' }],
            ]);
            await page.evaluate(() => { rotate(4, 4); rotate(4, 4); });
            expect(await page.evaluate(() => [grid[4][4].state, moves])).toEqual([0, 2]);
        });

        test('clicking an empty cell costs nothing', async ({ page }) => {
            const empty = await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) if (grid[r][c].kind === 'empty') return [c, r];
                }
                return null;
            });
            await clickCell(page, empty[0], empty[1]);
            await expect(page.locator('#moves')).toHaveText('0');
        });

        test('fixed mirrors cannot be rotated', async ({ page }) => {
            await page.evaluate(() => {
                loadLevel(0);
                grid[4][4] = { kind: 'mirror', state: 0, fixed: true };
            });
            const turned = await page.evaluate(() => rotate(4, 4));
            expect(turned).toBe(false);
            expect(await page.evaluate(() => [grid[4][4].state, moves])).toEqual([0, 0]);
        });

        test('walls, targets and mines cannot be rotated', async ({ page }) => {
            await buildBoard(page, [
                [1, 1, { kind: 'wall' }],
                [2, 2, { kind: 'target' }],
                [3, 3, { kind: 'mine' }],
            ]);
            expect(await page.evaluate(() => [rotate(1, 1), rotate(2, 2), rotate(3, 3)]))
                .toEqual([false, false, false]);
        });

        test('rotating off the board is harmless', async ({ page }) => {
            expect(await page.evaluate(() => [rotate(-1, 0), rotate(0, ROWS), rotate(COLS, 0)]))
                .toEqual([false, false, false]);
        });

        test('rotating retraces the beam', async ({ page }) => {
            await buildBoard(page, [
                [0, 4, { kind: 'emitter', dir: E }],
                [4, 4, { kind: 'mirror', state: 1 }],
                [4, 1, { kind: 'target' }],
            ]);
            await page.evaluate(() => retrace());
            expect(await page.evaluate(() => grid[1][4].lit)).toBe(false);
            await page.evaluate(() => rotate(4, 4));
            expect(await page.evaluate(() => grid[1][4].lit)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard control
    // -----------------------------------------------------------------------
    test.describe('keyboard', () => {
        test('the cursor starts at the top-left cell', async ({ page }) => {
            expect(await page.evaluate(() => [cursor.c, cursor.r])).toEqual([0, 0]);
        });

        test('arrow keys move the cursor', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => [cursor.c, cursor.r])).toEqual([1, 2]);
        });

        test('the cursor stops at the board edge', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => [cursor.c, cursor.r])).toEqual([0, 0]);
            await page.evaluate(() => { cursor.c = COLS - 1; cursor.r = ROWS - 1; });
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => [cursor.c, cursor.r])).toEqual([COLS - 1, ROWS - 1]);
        });

        test('space rotates the device under the cursor', async ({ page }) => {
            const { c, r, before } = await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) {
                        if (grid[r][c].kind === 'mirror') return { c, r, before: grid[r][c].state };
                    }
                }
                return null;
            });
            await page.evaluate(([c, r]) => { cursor.c = c; cursor.r = r; }, [c, r]);
            await page.keyboard.press('Space');
            expect(await page.evaluate(([c, r]) => grid[r][c].state, [c, r])).toBe(1 - before);
        });

        test('R resets the level', async ({ page }) => {
            const { c, r } = await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) {
                        if (grid[r][c].kind === 'mirror') return { c, r };
                    }
                }
                return null;
            });
            await page.evaluate(([c, r]) => rotate(c, r), [c, r]);
            await page.keyboard.press('r');
            await expect(page.locator('#moves')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Reset
    // -----------------------------------------------------------------------
    test.describe('reset', () => {
        test('the reset button restores the starting orientations', async ({ page }) => {
            const before = await page.evaluate(() => JSON.stringify(grid.map((row) => row.map((c) => c.state ?? null))));
            await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) rotate(c, r);
                }
            });
            await page.locator('#btn-reset').click();
            const after = await page.evaluate(() => JSON.stringify(grid.map((row) => row.map((c) => c.state ?? null))));
            expect(after).toBe(before);
            await expect(page.locator('#moves')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Solving
    // -----------------------------------------------------------------------
    test.describe('solving', () => {
        test('solved() is false until every target is lit', async ({ page }) => {
            expect(await page.evaluate(() => solved())).toBe(false);
        });

        for (let i = 0; i < 8; i++) {
            test(`level ${i + 1} is solvable and its par is the minimum rotation count`, async ({ page }) => {
                const { knobs, best, par } = await minimumRotations(page, i);
                expect(knobs).toBeGreaterThan(0);
                expect(best).toBeLessThan(Infinity);
                expect(best).toBe(par);
            });

            test(`level ${i + 1} reports solved once the beam reaches every target`, async ({ page }) => {
                await solveLevel(page, i);
                const { state: st, moves: mv, par } = await page.evaluate(() => ({
                    state, moves, par: LEVELS[level].par,
                }));
                expect(['solved', 'complete']).toContain(st);
                expect(mv).toBe(par);
            });
        }

        test('the overlay congratulates the player and reports the score', async ({ page }) => {
            await solveLevel(page, 0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/solved/i);
            await expect(page.locator('#overlay-sub')).toContainText(/1 move/i);
        });

        test('a run that matches par is called perfect', async ({ page }) => {
            await solveLevel(page, 0);
            await expect(page.locator('#overlay-sub')).toContainText(/perfect/i);
        });

        test('a run over par is not called perfect', async ({ page }) => {
            const { solution } = await minimumRotations(page, 1);
            await page.evaluate((cells) => {
                loadLevel(1);
                rotate(cells[0][0], cells[0][1]);
                rotate(cells[0][0], cells[0][1]);
                for (const [c, r] of cells) rotate(c, r);
            }, solution);
            await expect(page.locator('#overlay-sub')).toContainText('4 moves — par 2');
            await expect(page.locator('#overlay-sub')).not.toContainText(/perfect/i);
        });

        test('rotations are ignored once the level is solved', async ({ page }) => {
            await solveLevel(page, 0);
            const before = await page.evaluate(() => moves);
            await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) rotate(c, r);
                }
            });
            expect(await page.evaluate(() => moves)).toBe(before);
        });

        test('the next button advances to the following level', async ({ page }) => {
            await solveLevel(page, 0);
            await page.locator('#btn-next').click();
            expect(await page.evaluate(() => [level, moves, state])).toEqual([1, 0, 'playing']);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('N also advances to the following level', async ({ page }) => {
            await solveLevel(page, 0);
            await page.keyboard.press('n');
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('solving the last level finishes the game', async ({ page }) => {
            await solveLevel(page, 7);
            expect(await page.evaluate(() => state)).toBe('complete');
            await expect(page.locator('#overlay-title')).toContainText(/complete/i);
            await expect(page.locator('#btn-next')).toBeHidden();
        });
    });

    // -----------------------------------------------------------------------
    // Progress and best scores
    // -----------------------------------------------------------------------
    test.describe('progress', () => {
        test('solving a level stores its best move count', async ({ page }) => {
            await solveLevel(page, 0);
            const best = await page.evaluate(() => JSON.parse(localStorage.getItem('lasermaze-best')));
            expect(best['1']).toBe(1);
            await expect(page.locator('#best')).toHaveText('1');
        });

        test('a worse run does not overwrite the stored best', async ({ page }) => {
            await solveLevel(page, 1);
            expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lasermaze-best'))['2'])).toBe(2);

            const { solution } = await minimumRotations(page, 1);
            await page.evaluate((cells) => {
                loadLevel(1);
                // Waste two rotations on the first mirror before solving.
                rotate(cells[0][0], cells[0][1]);
                rotate(cells[0][0], cells[0][1]);
                for (const [c, r] of cells) rotate(c, r);
            }, solution);

            expect(await page.evaluate(() => [moves, state])).toEqual([4, 'solved']);
            const best = await page.evaluate(() => JSON.parse(localStorage.getItem('lasermaze-best')));
            expect(best['2']).toBe(2);
        });

        test('stored bests are read back on reload', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('lasermaze-best', JSON.stringify({ 1: 4 })));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4');
        });

        test('solving a level unlocks the next one', async ({ page }) => {
            await solveLevel(page, 0);
            expect(await page.evaluate(() => Number(localStorage.getItem('lasermaze-progress')))).toBe(2);
        });

        test('level buttons beyond the unlocked range are disabled', async ({ page }) => {
            await expect(page.locator('.level-btn')).toHaveCount(8);
            await expect(page.locator('.level-btn').nth(0)).toBeEnabled();
            await expect(page.locator('.level-btn').nth(1)).toBeDisabled();
        });

        test('an unlocked level button loads that level', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('lasermaze-progress', '4'));
            await page.reload();
            await page.locator('.level-btn').nth(2).click();
            expect(await page.evaluate(() => [level, moves])).toEqual([2, 0]);
            await expect(page.locator('#level')).toHaveText('3');
        });

        test('the current level button is marked', async ({ page }) => {
            await expect(page.locator('.level-btn').nth(0)).toHaveClass(/current/);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is not blank', async ({ page }) => {
            const painted = await page.evaluate(() => {
                const ctx = document.getElementById('canvas').getContext('2d');
                const { data } = ctx.getImageData(0, 0, COLS * TILE, ROWS * TILE);
                for (let i = 0; i < data.length; i += 4) if (data[i] || data[i + 1] || data[i + 2]) return true;
                return false;
            });
            expect(painted).toBe(true);
        });

        test('step() advances the glow animation without touching the board', async ({ page }) => {
            const before = await page.evaluate(() => {
                autoStep = false;
                return [pulse, JSON.stringify(grid.map((row) => row.map((c) => c.state ?? null)))];
            });
            await page.evaluate(() => { for (let i = 0; i < 30; i++) step(1 / 60); });
            const after = await page.evaluate(() => [pulse, JSON.stringify(grid.map((row) => row.map((c) => c.state ?? null)))]);
            expect(after[0]).toBeGreaterThan(before[0]);
            expect(after[1]).toBe(before[1]);
        });

        test('draw() can be called at any time without throwing', async ({ page }) => {
            expect(await page.evaluate(() => { draw(); return true; })).toBe(true);
        });
    });
});
