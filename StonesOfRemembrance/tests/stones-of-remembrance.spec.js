const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// ---------------------------------------------------------------------------
// An independent Sokoban solver, used to prove that every level the game ships
// can actually be finished. It is deliberately written from the level maps
// alone and shares no code with the game.
//
// Breadth-first over *pushes* rather than steps: a state is the set of stone
// cells plus the region the bearer can walk in, named by its smallest cell, so
// two states that differ only in where the bearer stands inside one region
// collapse into one. Stones parked in a non-goal corner can never move again,
// so those branches are pruned.
// ---------------------------------------------------------------------------
function parseMap(rows) {
    const h = rows.length;
    const w = rows[0].length;
    const walls = new Uint8Array(h * w);
    const goals = new Uint8Array(h * w);
    const stones = [];
    let player = -1;
    for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
            const ch = rows[r][c] ?? ' ';
            const i = r * w + c;
            if (ch === '#') walls[i] = 1;
            if (ch === '.' || ch === '*' || ch === '+') goals[i] = 1;
            if (ch === '$' || ch === '*') stones.push(i);
            if (ch === '@' || ch === '+') player = i;
        }
    }
    return { rows: h, cols: w, walls, goals, stones, player };
}

function solve(level, limit = 2_000_000) {
    const { rows: h, cols: w, walls, goals, player } = level;
    const n = h * w;
    const step = [-w, w, -1, 1];

    // A non-goal cell walled off on two perpendicular sides is a dead corner.
    const dead = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (walls[i] || goals[i]) continue;
        if ((walls[i - w] || walls[i + w]) && (walls[i - 1] || walls[i + 1])) dead[i] = 1;
    }

    const occupied = new Uint8Array(n);
    const newBuffer = () => ({ seen: new Int32Array(n), queue: new Int32Array(n), stamp: 0 });
    const AREA = newBuffer();   // region of the state being expanded
    const PROBE = newBuffer();  // region of each successor, computed without disturbing AREA

    function flood(buf, start) {
        const mark = ++buf.stamp;
        buf.seen[start] = mark;
        buf.queue[0] = start;
        let head = 0, tail = 1, canon = start;
        while (head < tail) {
            const cell = buf.queue[head++];
            for (let d = 0; d < 4; d++) {
                const next = cell + step[d];
                if (walls[next] || occupied[next] || buf.seen[next] === mark) continue;
                buf.seen[next] = mark;
                if (next < canon) canon = next;
                buf.queue[tail++] = next;
            }
        }
        return { mark, canon };
    }

    const sorted = (xs) => Int32Array.from(xs).sort();
    const keyOf = (stones, canon) => String.fromCharCode(...stones) + ':' + canon;
    const allHome = (stones) => Array.from(stones).every((i) => goals[i]);

    const start = sorted(level.stones);
    if (allHome(start)) return { solved: true, pushes: 0 };
    for (const i of start) occupied[i] = 1;
    const first = flood(AREA, player);

    const seen = new Set([keyOf(start, first.canon)]);
    let frontier = [[start, player, 0]];
    let expanded = 0;

    while (frontier.length) {
        const next = [];
        for (const [stones, from, pushes] of frontier) {
            occupied.fill(0);
            for (const i of stones) occupied[i] = 1;
            const area = flood(AREA, from);
            for (const stone of stones) {
                for (let d = 0; d < 4; d++) {
                    const stand = stone - step[d];
                    if (AREA.seen[stand] !== area.mark) continue;  // bearer can't get behind it
                    const target = stone + step[d];
                    if (walls[target] || occupied[target] || dead[target]) continue;
                    const moved = sorted(Array.from(stones, (i) => (i === stone ? target : i)));
                    if (allHome(moved)) return { solved: true, pushes: pushes + 1, expanded };
                    occupied[stone] = 0;
                    occupied[target] = 1;
                    const after = flood(PROBE, stone);
                    occupied[target] = 0;
                    occupied[stone] = 1;
                    const key = keyOf(moved, after.canon);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    if (++expanded > limit) return { solved: false, reason: 'limit' };
                    next.push([moved, stone, pushes + 1]);
                }
            }
        }
        frontier = next;
    }
    return { solved: false, reason: 'exhausted' };
}

// --- helpers against the running page ---------------------------------------

const press = async (page, ...keys) => {
    for (const key of keys) await page.keyboard.press(key);
};

// The bearer's position and the counters, in one round trip.
const snapshot = (page) => page.evaluate(() => ({
    player: { r: player.r, c: player.c },
    stones: stoneList(),
    moves,
    pushes,
    solved,
    level: levelIndex,
}));

const levelMaps = (page) => page.evaluate(() => LEVELS.map((l) => ({ name: l.name, map: l.map })));

// Centre of cell (r, c) in canvas pixels.
const cellCentre = (page, r, c) => page.evaluate(([r, c]) => ({
    x: originX + c * cellSize + cellSize / 2,
    y: originY + r * cellSize + cellSize / 2,
}), [r, c]);

async function clickCell(page, r, c) {
    const position = await cellCentre(page, r, c);
    await page.locator('#canvas').click({ position });
}

// The ten keystrokes that finish "The Riverbed": two pushes right, walk
// around and below the second stone, then three pushes right.
const RIVERBED_SOLUTION = [
    'ArrowRight', 'ArrowRight',
    'ArrowDown', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowDown',
    'ArrowRight', 'ArrowRight', 'ArrowRight',
];

test.describe('Stones of Remembrance', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Stones of Remembrance', async ({ page }) => {
            await expect(page).toHaveTitle('Stones of Remembrance');
        });

        test('canvas is 560x460', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('starts on the first level, The Riverbed', async ({ page }) => {
            expect(await page.evaluate(() => levelIndex)).toBe(0);
            expect(await page.evaluate(() => LEVELS[levelIndex].name)).toBe('The Riverbed');
            await expect(page.locator('#level-label')).toHaveText('The Riverbed');
        });

        test('counters start at zero and nothing is solved', async ({ page }) => {
            const state = await snapshot(page);
            expect(state.moves).toBe(0);
            expect(state.pushes).toBe(0);
            expect(state.solved).toBe(false);
            await expect(page.locator('#moves')).toHaveText('0');
            await expect(page.locator('#pushes')).toHaveText('0');
        });

        test('the bearer and the two stones start where the map puts them', async ({ page }) => {
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 2, c: 3 });
            expect(state.stones.sort()).toEqual([[2, 4], [4, 3]].sort());
        });

        test('stones left to place counts the stones off their memorial', async ({ page }) => {
            await expect(page.locator('#stones-left')).toHaveText('2');
        });

        test('the solved overlay is hidden at start', async ({ page }) => {
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the whole board fits inside the canvas', async ({ page }) => {
            const fits = await page.evaluate(() =>
                originX >= 0 && originY >= 0 &&
                originX + cellSize * cols <= canvas.width + 0.001 &&
                originY + cellSize * rows <= canvas.height + 0.001);
            expect(fits).toBe(true);
        });

        test('the board is drawn, not left blank', async ({ page }) => {
            const colours = await page.evaluate(() => {
                const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(colours).toBeGreaterThan(5);
        });
    });

    // -----------------------------------------------------------------------
    // Level data: every level must be well formed and actually finishable
    // -----------------------------------------------------------------------
    test.describe('level data', () => {
        test('there are five levels, each with a name and a map', async ({ page }) => {
            const levels = await levelMaps(page);
            expect(levels).toHaveLength(5);
            expect(levels.map((l) => l.name)).toEqual([
                'The Riverbed', 'Dry Ground', 'The Crossing', 'Gilgal', 'The Memorial',
            ]);
            for (const level of levels) expect(level.map.length).toBeGreaterThan(4);
        });

        test('every map is rectangular and walled all the way round', async ({ page }) => {
            const levels = await levelMaps(page);
            for (const { name, map } of levels) {
                const widths = new Set(map.map((row) => row.length));
                expect(widths.size, `${name} has ragged rows`).toBe(1);
                const last = map.length - 1;
                expect(map[0], `${name} top edge`).toMatch(/^#+$/);
                expect(map[last], `${name} bottom edge`).toMatch(/^#+$/);
                for (const row of map) {
                    expect(row[0], `${name} left edge`).toBe('#');
                    expect(row[row.length - 1], `${name} right edge`).toBe('#');
                }
            }
        });

        test('every map has one bearer and as many stones as memorial places', async ({ page }) => {
            const levels = await levelMaps(page);
            for (const { name, map } of levels) {
                const level = parseMap(map);
                expect(level.player, `${name} has no bearer`).toBeGreaterThanOrEqual(0);
                expect(level.walls[level.player], `${name} bearer stands in a wall`).toBe(0);
                const goals = level.goals.reduce((a, b) => a + b, 0);
                expect(level.stones.length, `${name} stone/memorial count`).toBe(goals);
                expect(level.stones.length).toBeGreaterThanOrEqual(2);
                expect(level.stones).not.toContain(level.player);
            }
        });

        test('no stone starts wedged in a corner it can never leave', async ({ page }) => {
            const levels = await levelMaps(page);
            for (const { name, map } of levels) {
                const { cols, walls, goals, stones } = parseMap(map);
                for (const i of stones) {
                    const corner = (walls[i - cols] || walls[i + cols]) && (walls[i - 1] || walls[i + 1]);
                    expect(Boolean(corner && !goals[i]), `${name} stone at ${i} starts dead`).toBe(false);
                }
            }
        });

        for (const index of [0, 1, 2, 3, 4]) {
            test(`level ${index + 1} can be solved`, async ({ page }) => {
                const levels = await levelMaps(page);
                const { name, map } = levels[index];
                const result = solve(parseMap(map));
                expect(result.solved, `${name} is not solvable: ${result.reason}`).toBe(true);
                expect(result.pushes).toBeGreaterThan(0);
            });
        }

        test('the levels get harder: each needs at least as many pushes as the last', async ({ page }) => {
            const levels = await levelMaps(page);
            const pushes = levels.map(({ map }) => solve(parseMap(map)).pushes);
            for (let i = 1; i < pushes.length; i++) {
                expect(pushes[i], `level ${i + 1} vs ${i}`).toBeGreaterThan(pushes[i - 1]);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Walking
    // -----------------------------------------------------------------------
    test.describe('walking', () => {
        test('stepping onto open ground moves the bearer and counts one move', async ({ page }) => {
            await press(page, 'ArrowDown');
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 3, c: 3 });
            expect(state.moves).toBe(1);
            expect(state.pushes).toBe(0);
            await expect(page.locator('#moves')).toHaveText('1');
        });

        test('a wall stops the bearer and costs no move', async ({ page }) => {
            // Walk up to the top wall, then try to keep going.
            await press(page, 'ArrowUp');
            const atWall = await snapshot(page);
            expect(atWall.player).toEqual({ r: 1, c: 3 });
            await press(page, 'ArrowUp');
            const after = await snapshot(page);
            expect(after.player).toEqual({ r: 1, c: 3 });
            expect(after.moves).toBe(1);
        });

        test('WASD walks as well as the arrow keys', async ({ page }) => {
            await press(page, 'KeyS', 'KeyA', 'KeyW');
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 2, c: 2 });
            expect(state.moves).toBe(3);
        });

        test('step() reports whether it walked, pushed or was blocked', async ({ page }) => {
            expect(await page.evaluate(() => step(1, 0))).toBe('walk');     // down onto open bed
            expect(await page.evaluate(() => step(-1, 0))).toBe('walk');    // back up
            expect(await page.evaluate(() => step(0, 1))).toBe('push');     // into the stone
            expect(await page.evaluate(() => step(-1, 0))).toBe('walk');    // up beside it
            expect(await page.evaluate(() => step(-1, 0))).toBe('blocked'); // into the bank
        });
    });

    // -----------------------------------------------------------------------
    // Pushing
    // -----------------------------------------------------------------------
    test.describe('pushing stones', () => {
        test('pushing a stone moves bearer and stone together', async ({ page }) => {
            await press(page, 'ArrowRight');
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 2, c: 4 });
            expect(state.stones).toContainEqual([2, 5]);
            expect(state.moves).toBe(1);
            expect(state.pushes).toBe(1);
            await expect(page.locator('#pushes')).toHaveText('1');
        });

        test('a stone cannot be pushed into a wall', async ({ page }) => {
            // Put a stone against the top wall, then try to push it through.
            await page.evaluate(() => { loadLevel(0); player = { r: 3, c: 4 }; });
            await press(page, 'ArrowUp');      // stone (2,4) -> (1,4)
            const packed = await snapshot(page);
            expect(packed.stones).toContainEqual([1, 4]);
            expect(packed.player).toEqual({ r: 2, c: 4 });
            await press(page, 'ArrowUp');      // (0,4) is wall
            const after = await snapshot(page);
            expect(after.stones).toContainEqual([1, 4]);
            expect(after.player).toEqual({ r: 2, c: 4 });
            expect(after.pushes).toBe(1);
        });

        test('a stone cannot be pushed into another stone', async ({ page }) => {
            await page.evaluate(() => {
                loadLevel(0);
                stones = blankGrid(rows, cols, false);
                stones[2][4] = true;
                stones[2][5] = true;
                player = { r: 2, c: 3 };
                draw();
            });
            await press(page, 'ArrowRight');
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 2, c: 3 });
            expect(state.stones.sort()).toEqual([[2, 4], [2, 5]].sort());
            expect(state.pushes).toBe(0);
        });

        test('a stone on its memorial place no longer counts as left to place', async ({ page }) => {
            await press(page, 'ArrowRight', 'ArrowRight');
            expect(await page.evaluate(() => stonesHome())).toBe(1);
            await expect(page.locator('#stones-left')).toHaveText('1');
        });

        test('the bearer can walk back off a stone it has placed', async ({ page }) => {
            await press(page, 'ArrowRight', 'ArrowRight', 'ArrowDown');
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 3, c: 5 });
            expect(state.stones).toContainEqual([2, 6]);
        });
    });

    // -----------------------------------------------------------------------
    // Undo
    // -----------------------------------------------------------------------
    test.describe('undo', () => {
        test('undo takes back a walk', async ({ page }) => {
            await press(page, 'ArrowDown', 'KeyU');
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 2, c: 3 });
            expect(state.moves).toBe(0);
        });

        test('undo takes back a push, stone and all', async ({ page }) => {
            await press(page, 'ArrowRight', 'KeyU');
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 2, c: 3 });
            expect(state.stones).toContainEqual([2, 4]);
            expect(state.moves).toBe(0);
            expect(state.pushes).toBe(0);
        });

        test('undo walks all the way back to the start of the level', async ({ page }) => {
            await press(page, ...RIVERBED_SOLUTION.slice(0, 6));
            for (let i = 0; i < 6; i++) await press(page, 'KeyU');
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 2, c: 3 });
            expect(state.stones.sort()).toEqual([[2, 4], [4, 3]].sort());
            expect(state.moves).toBe(0);
            expect(state.pushes).toBe(0);
        });

        test('undo at the start of a level does nothing', async ({ page }) => {
            expect(await page.evaluate(() => undoMove())).toBe(false);
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 2, c: 3 });
            expect(state.moves).toBe(0);
        });

        test('the Undo button undoes too', async ({ page }) => {
            await press(page, 'ArrowRight');
            await page.locator('#btn-undo').click();
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 2, c: 3 });
            expect(state.pushes).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Reset
    // -----------------------------------------------------------------------
    test.describe('reset', () => {
        test('R puts every stone and the bearer back', async ({ page }) => {
            await press(page, 'ArrowRight', 'ArrowDown', 'KeyR');
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 2, c: 3 });
            expect(state.stones.sort()).toEqual([[2, 4], [4, 3]].sort());
            expect(state.moves).toBe(0);
            expect(state.pushes).toBe(0);
            expect(state.level).toBe(0);
        });

        test('the Reset button resets the level in play, not the first one', async ({ page }) => {
            await page.locator('.level-btn[data-level="2"]').click();
            await press(page, 'ArrowLeft');
            await page.locator('#btn-reset').click();
            const state = await snapshot(page);
            expect(state.level).toBe(2);
            expect(state.moves).toBe(0);
        });

        test('reset clears the undo history', async ({ page }) => {
            await press(page, 'ArrowRight', 'KeyR');
            expect(await page.evaluate(() => undoStack.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Solving a level
    // -----------------------------------------------------------------------
    test.describe('solving', () => {
        test('placing the last stone solves the level and shows the overlay', async ({ page }) => {
            await press(page, ...RIVERBED_SOLUTION);
            const state = await snapshot(page);
            expect(state.solved).toBe(true);
            expect(state.moves).toBe(10);
            expect(state.pushes).toBe(5);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#stones-left')).toHaveText('0');
            await expect(page.locator('#status')).toHaveClass(/good/);
        });

        test('the overlay reports the moves and pushes taken', async ({ page }) => {
            await press(page, ...RIVERBED_SOLUTION);
            await expect(page.locator('#overlay-sub')).toContainText('10');
            await expect(page.locator('#overlay-sub')).toContainText('5');
        });

        test('once solved, further keys do not move anything', async ({ page }) => {
            await press(page, ...RIVERBED_SOLUTION);
            const before = await snapshot(page);
            await press(page, 'ArrowUp', 'ArrowLeft', 'ArrowDown');
            const after = await snapshot(page);
            expect(after.player).toEqual(before.player);
            expect(after.moves).toBe(before.moves);
        });

        test('N moves on to the next level once solved', async ({ page }) => {
            await press(page, ...RIVERBED_SOLUTION);
            await press(page, 'KeyN');
            const state = await snapshot(page);
            expect(state.level).toBe(1);
            expect(state.solved).toBe(false);
            expect(state.moves).toBe(0);
            await expect(page.locator('#level-label')).toHaveText('Dry Ground');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('N does nothing while the level is unsolved', async ({ page }) => {
            await press(page, 'KeyN');
            expect(await page.evaluate(() => levelIndex)).toBe(0);
        });

        test('the Next button appears only once the level is solved', async ({ page }) => {
            await expect(page.locator('#btn-next')).toBeHidden();
            await press(page, ...RIVERBED_SOLUTION);
            await expect(page.locator('#btn-next')).toBeVisible();
            await page.locator('#btn-next').click();
            expect(await page.evaluate(() => levelIndex)).toBe(1);
        });

        test('solving the last level says the memorial stands at Gilgal', async ({ page }) => {
            // Set every stone but one on its memorial place, and stand the
            // bearer ready to push the last one home.
            const dir = await page.evaluate(() => {
                loadLevel(LEVELS.length - 1);
                const places = [];
                for (let r = 0; r < rows; r++)
                    for (let c = 0; c < cols; c++) if (goals[r][c]) places.push([r, c]);
                const open = (r, c) =>
                    r >= 0 && c >= 0 && r < rows && c < cols && !walls[r][c] && !goals[r][c];
                let setup = null;
                for (const [r, c] of places) {
                    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                        // Push along (dr, dc): the stone sits one short of the
                        // place and the bearer one short of the stone.
                        if (open(r - dr, c - dc) && open(r - 2 * dr, c - 2 * dc)) {
                            setup = { place: [r, c], dr, dc };
                            break;
                        }
                    }
                    if (setup) break;
                }
                const [pr, pc] = setup.place;
                stones = blankGrid(rows, cols, false);
                for (const [r, c] of places) if (r !== pr || c !== pc) stones[r][c] = true;
                stones[pr - setup.dr][pc - setup.dc] = true;
                player = { r: pr - 2 * setup.dr, c: pc - 2 * setup.dc };
                draw();
                return { dr: setup.dr, dc: setup.dc };
            });
            const key = { '-1,0': 'ArrowUp', '1,0': 'ArrowDown', '0,-1': 'ArrowLeft', '0,1': 'ArrowRight' };
            await press(page, key[`${dir.dr},${dir.dc}`]);
            expect(await page.evaluate(() => solved)).toBe(true);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Gilgal');
            await expect(page.locator('#btn-next')).toBeHidden();
        });
    });

    // -----------------------------------------------------------------------
    // Choosing a level
    // -----------------------------------------------------------------------
    test.describe('level buttons', () => {
        test('there is a button for every level and the first is active', async ({ page }) => {
            await expect(page.locator('.level-btn')).toHaveCount(5);
            await expect(page.locator('.level-btn[data-level="0"]')).toHaveClass(/active/);
        });

        test('clicking a level loads it and marks the button active', async ({ page }) => {
            await page.locator('.level-btn[data-level="3"]').click();
            const state = await snapshot(page);
            expect(state.level).toBe(3);
            expect(state.stones).toHaveLength(4);
            expect(state.moves).toBe(0);
            await expect(page.locator('#level-label')).toHaveText('Gilgal');
            await expect(page.locator('.level-btn[data-level="3"]')).toHaveClass(/active/);
            await expect(page.locator('.level-btn[data-level="0"]')).not.toHaveClass(/active/);
        });

        test('every level loads with its bearer on open ground', async ({ page }) => {
            for (let i = 0; i < 5; i++) {
                await page.locator(`.level-btn[data-level="${i}"]`).click();
                const ok = await page.evaluate(() =>
                    !walls[player.r][player.c] && !stones[player.r][player.c]);
                expect(ok, `level ${i + 1}`).toBe(true);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Warning about a wedged stone
    // -----------------------------------------------------------------------
    test.describe('wedged stones', () => {
        test('a non-goal corner is a dead cell, a memorial place never is', async ({ page }) => {
            const checks = await page.evaluate(() => {
                loadLevel(0);
                return { corner: isDeadCell(1, 1), open: isDeadCell(1, 4), goal: isDeadCell(2, 6) };
            });
            expect(checks.corner).toBe(true);   // tucked into the top-left corner
            expect(checks.open).toBe(false);    // open ground along the top wall
            expect(checks.goal).toBe(false);    // a memorial place is never dead
        });

        test('pushing a stone into a corner warns that it is wedged', async ({ page }) => {
            // Push the lower stone down into the bottom-left area and into the corner.
            await page.evaluate(() => {
                loadLevel(0);
                stones = blankGrid(rows, cols, false);
                stones[5][2] = true;
                player = { r: 5, c: 3 };
                draw();
            });
            await press(page, 'ArrowLeft');  // stone (5,2) -> (5,1), a dead corner
            expect(await page.evaluate(() => stuckStones().length)).toBe(1);
            await expect(page.locator('#status')).toHaveClass(/bad/);
            await expect(page.locator('#status')).toContainText(/wedged|stuck/i);
        });

        test('undoing frees the stone and clears the warning', async ({ page }) => {
            await page.evaluate(() => {
                loadLevel(0);
                stones = blankGrid(rows, cols, false);
                stones[5][2] = true;
                player = { r: 5, c: 3 };
                draw();
            });
            await press(page, 'ArrowLeft', 'KeyU');
            expect(await page.evaluate(() => stuckStones().length)).toBe(0);
            await expect(page.locator('#status')).not.toHaveClass(/bad/);
        });
    });

    // -----------------------------------------------------------------------
    // Pointer control, for touch screens
    // -----------------------------------------------------------------------
    test.describe('clicking the board', () => {
        test('clicking a cell in line with the bearer takes one step that way', async ({ page }) => {
            await clickCell(page, 5, 3);
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 3, c: 3 });
            expect(state.moves).toBe(1);
        });

        test('clicking in line with a stone pushes it', async ({ page }) => {
            await clickCell(page, 2, 7);
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 2, c: 4 });
            expect(state.pushes).toBe(1);
        });

        test('clicking a diagonal cell does nothing', async ({ page }) => {
            await clickCell(page, 3, 2);
            const state = await snapshot(page);
            expect(state.player).toEqual({ r: 2, c: 3 });
            expect(state.moves).toBe(0);
        });

        test('clicking the bearer itself does nothing', async ({ page }) => {
            await clickCell(page, 2, 3);
            expect((await snapshot(page)).moves).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Theme
    // -----------------------------------------------------------------------
    test.describe('theme', () => {
        test('the page carries the Joshua 4 memorial verse', async ({ page }) => {
            await expect(page.locator('#verse')).toContainText('Joshua 4');
            await expect(page.locator('#verse')).toContainText(/memorial/i);
        });

        test('the rules explain the stones and the memorial places', async ({ page }) => {
            const rules = page.locator('#rules');
            await expect(rules).toContainText(/stone/i);
            await expect(rules).toContainText(/memorial/i);
            await expect(rules).toContainText(/push/i);
        });

        test('the heading names the game', async ({ page }) => {
            await expect(page.locator('h1')).toHaveText('Stones of Remembrance');
        });
    });
});
