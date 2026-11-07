const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a run and land on level 1.
async function start(page) {
    await page.evaluate(() => startGame());
}

// Replace the board with exactly the cells a test cares about. `rows` is the
// same ten-string level format the shipped levels use.
async function setBoard(page, rows) {
    await page.evaluate((r) => {
        loadBoard(r);
    }, rows);
}

// Trace the current board and hand back a plain summary a test can assert on.
async function trace(page) {
    return page.evaluate(() => {
        traceBeams();
        const targets = [];
        for (let y = 0; y < GRID_H; y++) {
            for (let x = 0; x < GRID_W; x++) {
                const c = grid[y][x];
                if (c.type === 'target') targets.push({ x, y, mask: c.mask, lit: c.lit });
            }
        }
        return {
            targets,
            solved: isSolved(),
            segments: beams.map((s) => ({
                x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, color: s.color,
            })),
        };
    });
}

// Brute force every mirror combination for the level currently loaded and
// return one that solves it (or null). Restores the board afterwards.
async function findSolution(page) {
    return page.evaluate(() => {
        const mirrors = [];
        for (let y = 0; y < GRID_H; y++) {
            for (let x = 0; x < GRID_W; x++) {
                if (grid[y][x].type === 'mirror') mirrors.push({ x, y });
            }
        }
        const original = mirrors.map((m) => grid[m.y][m.x].orient);
        let found = null;
        let bestFlips = Infinity;
        for (let combo = 0; combo < (1 << mirrors.length); combo++) {
            const orients = mirrors.map((m, i) => (combo & (1 << i) ? '\\' : '/'));
            const flips = orients.filter((o, i) => o !== original[i]).length;
            if (flips >= bestFlips) continue;
            mirrors.forEach((m, i) => {
                grid[m.y][m.x].orient = orients[i];
            });
            traceBeams();
            if (isSolved()) {
                bestFlips = flips;
                found = mirrors.map((m, i) => ({ x: m.x, y: m.y, orient: orients[i] }));
            }
        }
        mirrors.forEach((m, i) => {
            grid[m.y][m.x].orient = original[i];
        });
        traceBeams();
        return found;
    });
}

// Apply a solution through the public rotate() call, the way a player would.
async function applySolution(page, solution) {
    await page.evaluate((sol) => {
        sol.forEach((m) => {
            if (grid[m.y][m.x].orient !== m.orient) rotate(m.x, m.y);
        });
    }, solution);
}

test.describe('Prism Path', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Prism Path', async ({ page }) => {
            await expect(page).toHaveTitle('Prism Path');
        });

        test('canvas is 480x480', async ({ page }) => {
            await expect(page.locator('#canvas')).toHaveAttribute('width', '480');
            await expect(page.locator('#canvas')).toHaveAttribute('height', '480');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#moves')).toHaveText('0');
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
            await expect(page.locator('#par')).toHaveText('1');
        });

        test('state starts idle', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the grid is 10x10 of 48px cells', async ({ page }) => {
            const dims = await page.evaluate(() => ({ w: GRID_W, h: GRID_H, cell: CELL }));
            expect(dims).toEqual({ w: 10, h: 10, cell: 48 });
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('starting loads level 1 with zero moves', async ({ page }) => {
            await start(page);
            expect(await page.evaluate(() => ({ level, moves, score }))).toEqual({
                level: 1, moves: 0, score: 0,
            });
        });

        test('level 1 has at least one emitter and one target', async ({ page }) => {
            await start(page);
            const counts = await page.evaluate(() => {
                let emitters = 0, targets = 0;
                grid.flat().forEach((c) => {
                    if (c.type === 'emitter') emitters++;
                    if (c.type === 'target') targets++;
                });
                return { emitters, targets };
            });
            expect(counts.emitters).toBeGreaterThanOrEqual(1);
            expect(counts.targets).toBeGreaterThanOrEqual(1);
        });

        test('the HUD names the level', async ({ page }) => {
            await start(page);
            const name = await page.evaluate(() => levels[0].name);
            await expect(page.locator('#level-name')).toHaveText(name);
        });
    });

    // -----------------------------------------------------------------------
    // Board parsing
    // -----------------------------------------------------------------------
    test.describe('board parsing', () => {
        test('every level character maps to the right cell type', async ({ page }) => {
            await setBoard(page, [
                '>.<.^.v.#.',
                '/\\()rgbycm',
                'RGBYCMW...',
                '..........',
                '..........',
                '..........',
                '..........',
                '..........',
                '..........',
                '..........',
            ]);
            const row0 = await page.evaluate(() =>
                grid[0].map((c) => (c.type === 'emitter' ? 'emitter:' + c.dir : c.type)));
            expect(row0).toEqual([
                'emitter:right', 'empty', 'emitter:left', 'empty', 'emitter:up',
                'empty', 'emitter:down', 'empty', 'wall', 'empty',
            ]);

            const row1 = await page.evaluate(() =>
                grid[1].map((c) => c.type + (c.orient || '') + (c.mask ? ':' + c.mask : '')));
            expect(row1).toEqual([
                'mirror/', 'mirror\\', 'splitter/', 'splitter\\',
                'filter:1', 'filter:2', 'filter:4', 'filter:3', 'filter:6', 'filter:5',
            ]);

            const row2 = await page.evaluate(() =>
                grid[2].slice(0, 7).map((c) => c.type + ':' + c.mask));
            expect(row2).toEqual([
                'target:1', 'target:2', 'target:4', 'target:3',
                'target:6', 'target:5', 'target:7',
            ]);
        });

        test('every shipped level is 10 rows of 10 characters', async ({ page }) => {
            const bad = await page.evaluate(() =>
                levels.filter((l) => l.rows.length !== 10 || l.rows.some((r) => r.length !== 10))
                    .map((l) => l.name));
            expect(bad).toEqual([]);
        });

        test('every shipped level has a name and a positive par', async ({ page }) => {
            const bad = await page.evaluate(() =>
                levels.filter((l) => !l.name || !(l.par > 0)).map((l, i) => i));
            expect(bad).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Beam physics
    // -----------------------------------------------------------------------
    test.describe('beam tracing', () => {
        test('a beam with a clear run leaves the grid and lights nothing', async ({ page }) => {
            await setBoard(page, [
                '>........R',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            const r = await trace(page);
            // the white beam reaches the red target but does not match it
            expect(r.targets).toEqual([{ x: 9, y: 0, mask: 1, lit: false }]);
            expect(r.solved).toBe(false);
        });

        test('a white beam lights a white target', async ({ page }) => {
            await setBoard(page, [
                '>........W',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            const r = await trace(page);
            expect(r.targets[0].lit).toBe(true);
            expect(r.solved).toBe(true);
        });

        test('a wall stops the beam', async ({ page }) => {
            await setBoard(page, [
                '>....#...W',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            const r = await trace(page);
            expect(r.targets[0].lit).toBe(false);
        });

        test('a / mirror sends a rightward beam up', async ({ page }) => {
            await setBoard(page, [
                '....W.....',
                '..........', '..........', '..........',
                '>.../.....',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            expect((await trace(page)).solved).toBe(true);
        });

        test('a \\ mirror sends a rightward beam down', async ({ page }) => {
            await setBoard(page, [
                '..........', '..........', '..........', '..........',
                '>...\\.....',
                '..........', '..........', '..........',
                '....W.....',
                '..........',
            ]);
            expect((await trace(page)).solved).toBe(true);
        });

        test('a / mirror sends a downward beam left', async ({ page }) => {
            await setBoard(page, [
                '....v.....',
                '..........', '..........', '..........',
                'W.../.....',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            expect((await trace(page)).solved).toBe(true);
        });

        test('a \\ mirror sends an upward beam left', async ({ page }) => {
            await setBoard(page, [
                '..........', '..........', '..........', '..........',
                'W...\\.....',
                '..........', '..........', '..........',
                '....^.....',
                '..........',
            ]);
            expect((await trace(page)).solved).toBe(true);
        });

        test('a leftward beam off a \\ mirror goes up', async ({ page }) => {
            await setBoard(page, [
                '....W.....',
                '..........', '..........', '..........',
                '....\\...<.',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            expect((await trace(page)).solved).toBe(true);
        });

        test('a red filter turns a white beam red', async ({ page }) => {
            await setBoard(page, [
                '>...r....R',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            expect((await trace(page)).solved).toBe(true);
        });

        test('a filter that removes every channel kills the beam', async ({ page }) => {
            await setBoard(page, [
                '>..r.b...R',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            const r = await trace(page);
            expect(r.targets[0].lit).toBe(false);
        });

        test('stacked filters intersect their masks', async ({ page }) => {
            // white -> yellow (RG) -> cyan (GB) leaves green
            await setBoard(page, [
                '>..y.c...G',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            expect((await trace(page)).solved).toBe(true);
        });

        test('a target only lights on an exact colour match', async ({ page }) => {
            await setBoard(page, [
                '>..y.....R',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            expect((await trace(page)).targets[0].lit).toBe(false);
        });

        test('a prism both reflects and passes the beam through', async ({ page }) => {
            await setBoard(page, [
                '..........', '..........', '..........', '..........',
                '>...)....W',
                '..........', '..........', '..........',
                '....W.....',
                '..........',
            ]);
            const r = await trace(page);
            expect(r.targets.every((t) => t.lit)).toBe(true);
            expect(r.solved).toBe(true);
        });

        test('two emitters are traced independently', async ({ page }) => {
            await setBoard(page, [
                '>........W',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........',
                'W........<',
            ]);
            const r = await trace(page);
            expect(r.targets.filter((t) => t.lit)).toHaveLength(2);
        });

        test('a beam is blocked by another emitter', async ({ page }) => {
            await setBoard(page, [
                '>...v....W',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            expect((await trace(page)).targets[0].lit).toBe(false);
        });

        test('a mirror loop terminates instead of hanging', async ({ page }) => {
            await setBoard(page, [
                '>.....(\\..',
                '..........', '..........', '..........', '..........',
                '......\\/..',
                '..........', '..........', '..........', '..........',
            ]);
            const r = await trace(page);
            expect(r.segments.length).toBeGreaterThan(0);
            expect(r.segments.length).toBeLessThan(2000);
        });

        test('a target absorbs the beam instead of passing it on', async ({ page }) => {
            await setBoard(page, [
                '>...W....W',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            const r = await trace(page);
            expect(r.targets.map((t) => t.lit)).toEqual([true, false]);
        });

        test('a board with no targets is not solved', async ({ page }) => {
            await setBoard(page, [
                '>.........',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            expect((await trace(page)).solved).toBe(false);
        });

        test('beam segments are drawn in canvas pixel coordinates', async ({ page }) => {
            await setBoard(page, [
                '>........W',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            const r = await trace(page);
            const xs = r.segments.flatMap((s) => [s.x1, s.x2]);
            const ys = r.segments.flatMap((s) => [s.y1, s.y2]);
            expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
            expect(Math.max(...xs)).toBeLessThanOrEqual(480);
            expect(new Set(ys).size).toBe(1);
            expect(ys[0]).toBe(24);
        });
    });

    // -----------------------------------------------------------------------
    // Rotating mirrors
    // -----------------------------------------------------------------------
    test.describe('rotating', () => {
        test.beforeEach(async ({ page }) => {
            await start(page);
        });

        test('rotate() flips a mirror and counts a move', async ({ page }) => {
            const result = await page.evaluate(() => {
                const m = grid.flat().find((c) => c.type === 'mirror');
                const pos = [];
                for (let y = 0; y < GRID_H; y++)
                    for (let x = 0; x < GRID_W; x++) if (grid[y][x] === m) pos.push(x, y);
                const before = m.orient;
                const ok = rotate(pos[0], pos[1]);
                return { ok, before, after: m.orient, moves };
            });
            expect(result.ok).toBe(true);
            expect(result.after).not.toBe(result.before);
            expect(result.moves).toBe(1);
        });

        test('rotating twice returns the mirror to its first orientation', async ({ page }) => {
            // the last level needs five flips, so one mirror can be worked
            // without accidentally clearing the board
            await page.evaluate(() => loadLevel(levels.length - 1));
            const same = await page.evaluate(() => {
                let mx = -1, my = -1;
                for (let y = 0; y < GRID_H; y++)
                    for (let x = 0; x < GRID_W; x++)
                        if (grid[y][x].type === 'mirror' && mx < 0) { mx = x; my = y; }
                const before = grid[my][mx].orient;
                rotate(mx, my);
                rotate(mx, my);
                return before === grid[my][mx].orient;
            });
            expect(same).toBe(true);
        });

        test('rotating an empty cell does nothing and costs no move', async ({ page }) => {
            const r = await page.evaluate(() => {
                let ex = -1, ey = -1;
                for (let y = 0; y < GRID_H; y++)
                    for (let x = 0; x < GRID_W; x++)
                        if (grid[y][x].type === 'empty' && ex < 0) { ex = x; ey = y; }
                return { ok: rotate(ex, ey), moves };
            });
            expect(r.ok).toBe(false);
            expect(r.moves).toBe(0);
        });

        test('rotating a prism does nothing', async ({ page }) => {
            await setBoard(page, [
                '>...).....',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            const r = await page.evaluate(() => ({
                ok: rotate(4, 0), orient: grid[0][4].orient,
            }));
            expect(r).toEqual({ ok: false, orient: '\\' });
        });

        test('rotating off the board is ignored', async ({ page }) => {
            expect(await page.evaluate(() => rotate(-1, 4))).toBe(false);
            expect(await page.evaluate(() => rotate(10, 4))).toBe(false);
        });

        test('rotating re-traces the beams', async ({ page }) => {
            await setBoard(page, [
                '..........', '..........', '..........', '..........',
                '>.../.....',
                '..........', '..........', '..........',
                '....W.....',
                '..........',
            ]);
            expect((await trace(page)).solved).toBe(false);
            await page.evaluate(() => rotate(4, 4));
            expect(await page.evaluate(() => isSolved())).toBe(true);
        });

        test('the HUD move counter updates', async ({ page }) => {
            await page.evaluate(() => {
                for (let y = 0; y < GRID_H; y++)
                    for (let x = 0; x < GRID_W; x++)
                        if (grid[y][x].type === 'mirror') { rotate(x, y); return; }
            });
            await expect(page.locator('#moves')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Target counter and colour labels
    // -----------------------------------------------------------------------
    test.describe('readability', () => {
        test('the HUD counts lit targets out of the total', async ({ page }) => {
            await start(page);
            await expect(page.locator('#lit')).toHaveText('0/1');
            await applySolution(page, await findSolution(page));
            await expect(page.locator('#lit')).toHaveText('1/1');
        });

        test('the counter tracks a board with several targets', async ({ page }) => {
            await start(page);
            await setBoard(page, [
                '>........W',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........',
                'W........<',
            ]);
            await expect(page.locator('#lit')).toHaveText('2/2');
            await setBoard(page, [
                '>...#....W',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........',
                'W........<',
            ]);
            await expect(page.locator('#lit')).toHaveText('1/2');
        });

        test('every colour has a one-letter label', async ({ page }) => {
            const labels = await page.evaluate(() =>
                [1, 2, 4, 3, 6, 5, 7].map((mask) => LETTER[mask]));
            expect(labels).toEqual(['R', 'G', 'B', 'Y', 'C', 'M', 'W']);
        });

        test('targets and filters are labelled on the canvas', async ({ page }) => {
            await setBoard(page, [
                '..g.R.....',
                '..........', '..........', '..........', '..........',
                '..........', '..........', '..........', '..........', '..........',
            ]);
            const drawn = await page.evaluate(() => {
                const seen = [];
                const real = ctx.fillText.bind(ctx);
                ctx.fillText = (t, ...rest) => { seen.push(t); return real(t, ...rest); };
                draw();
                ctx.fillText = real;
                return seen;
            });
            expect(drawn).toContain('R');
            expect(drawn).toContain('G');
        });
    });

    // -----------------------------------------------------------------------
    // Input
    // -----------------------------------------------------------------------
    test.describe('input', () => {
        test.beforeEach(async ({ page }) => {
            await start(page);
        });

        test('arrow keys move the cursor', async ({ page }) => {
            await page.evaluate(() => { cursor.x = 4; cursor.y = 4; });
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => ({ x: cursor.x, y: cursor.y }))).toEqual({ x: 5, y: 5 });
        });

        test('WASD moves the cursor', async ({ page }) => {
            await page.evaluate(() => { cursor.x = 4; cursor.y = 4; });
            await page.keyboard.press('KeyA');
            await page.keyboard.press('KeyW');
            expect(await page.evaluate(() => ({ x: cursor.x, y: cursor.y }))).toEqual({ x: 3, y: 3 });
        });

        test('the cursor is clamped to the board', async ({ page }) => {
            await page.evaluate(() => { cursor.x = 0; cursor.y = 0; });
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => ({ x: cursor.x, y: cursor.y }))).toEqual({ x: 0, y: 0 });
            await page.evaluate(() => { cursor.x = 9; cursor.y = 9; });
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => ({ x: cursor.x, y: cursor.y }))).toEqual({ x: 9, y: 9 });
        });

        test('Space flips the mirror under the cursor', async ({ page }) => {
            const before = await page.evaluate(() => {
                for (let y = 0; y < GRID_H; y++)
                    for (let x = 0; x < GRID_W; x++)
                        if (grid[y][x].type === 'mirror') {
                            cursor.x = x; cursor.y = y;
                            return grid[y][x].orient;
                        }
                return null;
            });
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => grid[cursor.y][cursor.x].orient);
            expect(after).not.toBe(before);
            await expect(page.locator('#moves')).toHaveText('1');
        });

        test('clicking a mirror on the canvas flips it', async ({ page }) => {
            const m = await page.evaluate(() => {
                for (let y = 0; y < GRID_H; y++)
                    for (let x = 0; x < GRID_W; x++)
                        if (grid[y][x].type === 'mirror') return { x, y, orient: grid[y][x].orient };
                return null;
            });
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + m.x * 48 + 24, box.y + m.y * 48 + 24);
            const after = await page.evaluate(([x, y]) => grid[y][x].orient, [m.x, m.y]);
            expect(after).not.toBe(m.orient);
        });

        test('moving the mouse moves the cursor', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 7 * 48 + 24, box.y + 2 * 48 + 24);
            expect(await page.evaluate(() => ({ x: cursor.x, y: cursor.y }))).toEqual({ x: 7, y: 2 });
        });

        test('R restarts the level, resetting mirrors and moves', async ({ page }) => {
            await page.evaluate(() => loadLevel(levels.length - 1));
            const before = await page.evaluate(() =>
                grid.flat().filter((c) => c.type === 'mirror').map((c) => c.orient));
            await page.evaluate(() => {
                for (let y = 0; y < GRID_H; y++)
                    for (let x = 0; x < GRID_W; x++)
                        if (grid[y][x].type === 'mirror') { rotate(x, y); return; }
            });
            await page.keyboard.press('KeyR');
            const after = await page.evaluate(() =>
                grid.flat().filter((c) => c.type === 'mirror').map((c) => c.orient));
            expect(after).toEqual(before);
            await expect(page.locator('#moves')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('there are at least six levels', async ({ page }) => {
            expect(await page.evaluate(() => levels.length)).toBeGreaterThanOrEqual(6);
        });

        test('every level is solvable by flipping mirrors', async ({ page }) => {
            await start(page);
            const total = await page.evaluate(() => levels.length);
            for (let i = 0; i < total; i++) {
                await page.evaluate((n) => loadLevel(n), i);
                const solution = await findSolution(page);
                expect(solution, `level ${i + 1} has no solution`).not.toBeNull();
            }
        });

        test('no level starts out already solved', async ({ page }) => {
            await start(page);
            const total = await page.evaluate(() => levels.length);
            for (let i = 0; i < total; i++) {
                const solved = await page.evaluate((n) => {
                    loadLevel(n);
                    traceBeams();
                    return isSolved();
                }, i);
                expect(solved, `level ${i + 1} ships pre-solved`).toBe(false);
            }
        });

        test("every level's par matches the mirrors that must move", async ({ page }) => {
            await start(page);
            const total = await page.evaluate(() => levels.length);
            for (let i = 0; i < total; i++) {
                await page.evaluate((n) => loadLevel(n), i);
                const solution = await findSolution(page);
                const needed = await page.evaluate(
                    (sol) => sol.filter((m) => grid[m.y][m.x].orient !== m.orient).length,
                    solution,
                );
                const par = await page.evaluate((n) => levels[n].par, i);
                expect(par, `level ${i + 1} par`).toBeGreaterThanOrEqual(needed);
            }
        });

        test('each level has between one and sixteen mirrors', async ({ page }) => {
            const counts = await page.evaluate(() =>
                levels.map((l) => l.rows.join('').split('').filter((ch) => ch === '/' || ch === '\\').length));
            counts.forEach((n, i) => {
                expect(n, `level ${i + 1} mirror count`).toBeGreaterThan(0);
                expect(n, `level ${i + 1} mirror count`).toBeLessThanOrEqual(16);
            });
        });
    });

    // -----------------------------------------------------------------------
    // Progression and scoring
    // -----------------------------------------------------------------------
    test.describe('progression', () => {
        test('solving a level clears it and pays a score', async ({ page }) => {
            await start(page);
            const solution = await findSolution(page);
            await applySolution(page, solution);
            expect(await page.evaluate(() => state)).toBe('levelclear');
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/clear|complete|solved/i);
        });

        test('an on-par solve pays the par bonus', async ({ page }) => {
            await start(page);
            const solution = await findSolution(page);
            await applySolution(page, solution);
            const r = await page.evaluate(() => ({ score, moves, par: levels[0].par }));
            expect(r.score).toBe(100 + 25 * Math.max(0, r.par - r.moves));
        });

        test('N advances to the next level and resets moves', async ({ page }) => {
            await start(page);
            await applySolution(page, await findSolution(page));
            await page.keyboard.press('KeyN');
            expect(await page.evaluate(() => ({ level, moves, state })))
                .toEqual({ level: 2, moves: 0, state: 'playing' });
        });

        test('Space also advances to the next level', async ({ page }) => {
            await start(page);
            await applySolution(page, await findSolution(page));
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('clicking the overlay advances exactly one level', async ({ page }) => {
            await start(page);
            await applySolution(page, await findSolution(page));
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => level)).toBe(2);
            await applySolution(page, await findSolution(page));
            await page.locator('#overlay-title').click();
            expect(await page.evaluate(() => level)).toBe(3);
        });

        test('the score carries across levels', async ({ page }) => {
            await start(page);
            await applySolution(page, await findSolution(page));
            const first = await page.evaluate(() => score);
            await page.keyboard.press('KeyN');
            await applySolution(page, await findSolution(page));
            expect(await page.evaluate(() => score)).toBeGreaterThan(first);
        });

        test('clearing every level wins the run', async ({ page }) => {
            await start(page);
            const total = await page.evaluate(() => levels.length);
            for (let i = 0; i < total; i++) {
                await applySolution(page, await findSolution(page));
                expect(await page.evaluate(() => state), `level ${i + 1} did not clear`)
                    .not.toBe('playing');
                if (i < total - 1) await page.keyboard.press('KeyN');
            }
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/win|won|complete|master/i);
        });

        test('the best score is stored and shown', async ({ page }) => {
            await start(page);
            await applySolution(page, await findSolution(page));
            const stored = await page.evaluate(() => localStorage.getItem('prismpath-best'));
            expect(Number(stored)).toBeGreaterThan(0);
            await page.reload();
            await expect(page.locator('#best')).toHaveText(stored);
        });

        test('a worse run does not lower the best score', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('prismpath-best', '99999'));
            await page.reload();
            await start(page);
            await applySolution(page, await findSolution(page));
            expect(await page.evaluate(() => localStorage.getItem('prismpath-best'))).toBe('99999');
            await expect(page.locator('#best')).toHaveText('99999');
        });

        test('rotating after a level clears does not count', async ({ page }) => {
            await start(page);
            await applySolution(page, await findSolution(page));
            const before = await page.evaluate(() => moves);
            await page.evaluate(() => {
                for (let y = 0; y < GRID_H; y++)
                    for (let x = 0; x < GRID_W; x++)
                        if (grid[y][x].type === 'mirror') rotate(x, y);
            });
            expect(await page.evaluate(() => moves)).toBe(before);
        });

        test('restarting after a win starts a fresh run at level 1', async ({ page }) => {
            await start(page);
            const total = await page.evaluate(() => levels.length);
            for (let i = 0; i < total; i++) {
                await applySolution(page, await findSolution(page));
                if (i < total - 1) await page.keyboard.press('KeyN');
            }
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ level, score, state })))
                .toEqual({ level: 1, score: 0, state: 'playing' });
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is not blank once a level is loaded', async ({ page }) => {
            await start(page);
            const ink = await page.evaluate(() => {
                const data = canvas.getContext('2d').getImageData(0, 0, 480, 480).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(ink).toBeGreaterThan(5);
        });

        test('no console errors during a solve', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await start(page);
            await applySolution(page, await findSolution(page));
            await page.keyboard.press('KeyN');
            await page.waitForTimeout(100);
            expect(errors).toEqual([]);
        });

        test('drawing a loop-heavy board does not throw', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await setBoard(page, [
                '>.....(\\..',
                '..........', '..........', '..........', '..........',
                '......\\/..',
                '..........', '..........', '..........', '..........',
            ]);
            await page.evaluate(() => { traceBeams(); draw(); });
            expect(errors).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Repo integration
    // -----------------------------------------------------------------------
    test.describe('repo integration', () => {
        test('the game browser lists the game', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'prism-path');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Prism Path');
            expect(entry.dir).toBe('PrismPath');
            expect(entry.path).toBe('games/PrismPath/index.html');
            expect(entry.thumbnail).toBe('games/PrismPath/screenshot.png');
            expect(entry.category).toBe('Puzzle');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const i = games.findIndex((g) => g.id === 'prism-path');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            if (i + 1 < games.length) {
                expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
            }
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'PrismPath/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(/\|\s*Prism Path\s*\|\s*\[PrismPath\/\]\(PrismPath\/\)\s*\|\s*(Complete|In Progress)\s*\|/);
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'PrismPath/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'PrismPath/DESIGN.md'))).toBe(true);
        });
    });
});
