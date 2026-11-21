const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Stop the animation-frame loop and start a game, so the test owns the clock
// and advances it itself through step(dt).
async function startStill(page) {
    await page.evaluate(() => {
        stopLoop();
        startGame();
    });
}

// Lay a known section on a cell by forcing the head of the queue first.
async function lay(page, r, c, type) {
    return page.evaluate(([r, c, type]) => {
        queue[0] = type;
        return placePiece(r, c);
    }, [r, c, type]);
}

// A known, rock-free board with the spring and pool on chosen rows.
async function buildBoard(page, springRow, poolRow, level = 1) {
    await page.evaluate(([springRow, poolRow, level]) => {
        buildLevel({ level, springRow, poolRow, rocks: 0 });
    }, [springRow, poolRow, level]);
}

// Lay a straight run of channel from the spring row to the pool column.
async function layStraightRoute(page, row) {
    const cols = await page.evaluate(() => COLS);
    for (let c = 1; c <= cols - 2; c++) await lay(page, row, c, 'h');
}

async function cellCentre(page, r, c) {
    return page.evaluate(([r, c]) => cellCentre(r, c), [r, c]);
}

async function clickCell(page, r, c) {
    const pos = await cellCentre(page, r, c);
    await page.locator('#canvas').click({ position: pos });
}

// Run the water until something happens (or the budget runs out).
async function runWater(page, seconds = 30) {
    return page.evaluate((seconds) => {
        grace = 0;
        for (let i = 0; i < seconds * 20 && state === 'running'; i++) step(0.05);
        return state;
    }, seconds);
}

async function snapshot(page) {
    return page.evaluate(() => ({ state, score, days, level, flooded, grace, flow }));
}

test.describe("Hezekiah's Tunnel", () => {
    const errors = [];
    test.beforeEach(async ({ page }) => {
        errors.length = 0;
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(GAME_URL);
    });

    // -------------------------------------------------------------------
    // Initial state
    // -------------------------------------------------------------------
    test.describe('initial state', () => {
        test("page title is Hezekiah's Tunnel", async ({ page }) => {
            await expect(page).toHaveTitle("Hezekiah's Tunnel");
        });

        test('board canvas is 560x420', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '420');
        });

        test('the queue strip shows five slots', async ({ page }) => {
            await expect(page.locator('#queue-canvas')).toHaveAttribute('height', '280');
            expect(await page.evaluate(() => queue.length)).toBe(5);
        });

        test('loads with no page or console errors', async ({ page }) => {
            await page.waitForTimeout(300);
            expect(errors).toEqual([]);
        });

        test('starts idle with a full purse of days and no score', async ({ page }) => {
            expect(await snapshot(page)).toMatchObject({ state: 'idle', score: 0, days: 3, level: 1, flooded: 0 });
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#days')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('the overlay invites the player to start', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('every queued section is a known shape', async ({ page }) => {
            const ok = await page.evaluate(() => queue.every((t) => PIPE_TYPES.includes(t)));
            expect(ok).toBe(true);
        });

        test('the grid is 9 by 7 and fits inside the canvas', async ({ page }) => {
            const info = await page.evaluate(() => ({
                rows: grid.length,
                cols: grid[0].length,
                fits: ORIGIN_X >= 0 && ORIGIN_Y >= 0 &&
                    ORIGIN_X + COLS * CELL <= canvas.width + 0.001 &&
                    ORIGIN_Y + ROWS * CELL <= canvas.height + 0.001,
            }));
            expect(info).toEqual({ rows: 7, cols: 9, fits: true });
        });

        test('the spring and the pool sit on opposite edges', async ({ page }) => {
            const ends = await page.evaluate(() => ({
                spring: grid[springRow][0].kind,
                pool: grid[poolRow][COLS - 1].kind,
            }));
            expect(ends).toEqual({ spring: 'spring', pool: 'pool' });
        });

        test('the title screen carries the 2 Kings reference', async ({ page }) => {
            await expect(page.locator('#verse')).toContainText('2 Kings 20:20');
        });

        test('the best score is read from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('hezekiahs-tunnel-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });

        test('the board is drawn, not blank', async ({ page }) => {
            const painted = await page.evaluate(() => {
                const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                let n = 0;
                for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) n++;
                return n;
            });
            expect(painted).toBeGreaterThan(1000);
        });
    });

    // -------------------------------------------------------------------
    // Level layout
    // -------------------------------------------------------------------
    test.describe('level layout', () => {
        test('the first level scatters exactly its share of rock outcrops', async ({ page }) => {
            const counted = await page.evaluate(() => {
                let n = 0;
                for (let r = 0; r < ROWS; r++)
                    for (let c = 1; c < COLS - 1; c++)
                        if (grid[r][c] && grid[r][c].kind === 'rock') n++;
                return { n, want: LEVELS[0].rocks };
            });
            expect(counted.n).toBe(counted.want);
        });

        test('the outer columns are solid rock apart from the spring and the pool', async ({ page }) => {
            const bad = await page.evaluate(() => {
                const out = [];
                for (let r = 0; r < ROWS; r++) {
                    for (const c of [0, COLS - 1]) {
                        const cell = grid[r][c];
                        const expected = c === 0
                            ? (r === springRow ? 'spring' : 'rock')
                            : (r === poolRow ? 'pool' : 'rock');
                        if (!cell || cell.kind !== expected) out.push(`${r},${c}`);
                    }
                }
                return out;
            });
            expect(bad).toEqual([]);
        });

        test('the cells beside the spring and the pool are diggable', async ({ page }) => {
            const free = await page.evaluate(() => grid[springRow][1] === null && grid[poolRow][COLS - 2] === null);
            expect(free).toBe(true);
        });

        test('a rock-free route always exists from the spring to the pool', async ({ page }) => {
            for (let attempt = 0; attempt < 8; attempt++) {
                const reachable = await page.evaluate(() => {
                    newLevel();
                    const seen = new Set([`${springRow},1`]);
                    const q = [[springRow, 1]];
                    while (q.length) {
                        const [r, c] = q.shift();
                        if (r === poolRow && c === COLS - 2) return true;
                        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            const nr = r + dr, nc = c + dc;
                            if (nr < 0 || nr >= ROWS || nc < 1 || nc > COLS - 2) continue;
                            if (grid[nr][nc] !== null) continue;
                            const key = `${nr},${nc}`;
                            if (seen.has(key)) continue;
                            seen.add(key);
                            q.push([nr, nc]);
                        }
                    }
                    return false;
                });
                expect(reachable).toBe(true);
            }
        });

        test('harder levels bring more rock and faster water', async ({ page }) => {
            const rising = await page.evaluate(() => {
                const r = LEVELS.map((l) => l.rocks);
                const s = LEVELS.map((l) => l.speed);
                const g = LEVELS.map((l) => l.grace);
                const up = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);
                const down = (xs) => xs.every((x, i) => i === 0 || x < xs[i - 1]);
                return { levels: LEVELS.length, rocks: up(r), speed: up(s), grace: down(g) };
            });
            expect(rising).toEqual({ levels: 5, rocks: true, speed: true, grace: true });
        });
    });

    // -------------------------------------------------------------------
    // Starting
    // -------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the dig', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.grace).toBeCloseTo(await page.evaluate(() => LEVELS[0].grace), 1);
        });

        test('the start button starts the dig', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the overlay clears once the dig starts', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the countdown runs down while the water waits', async ({ page }) => {
            await startStill(page);
            const before = await page.evaluate(() => grace);
            await page.evaluate(() => step(1));
            const after = await page.evaluate(() => grace);
            expect(after).toBeCloseTo(before - 1, 2);
            await expect(page.locator('#timer')).toContainText(/\d/);
        });

        test('the animation frame loop runs the clock on its own', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => grace);
            await page.waitForTimeout(500);
            const after = await page.evaluate(() => grace);
            expect(after).toBeLessThan(before);
        });
    });

    // -------------------------------------------------------------------
    // Laying channel
    // -------------------------------------------------------------------
    test.describe('laying channel', () => {
        test('nothing can be laid before the dig starts', async ({ page }) => {
            const placed = await lay(page, 2, 3, 'h');
            expect(placed).toBe(false);
            expect(await page.evaluate(() => grid[2][3])).toBeNull();
        });

        test('clicking an empty cell lays the head of the queue there', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            const next = await page.evaluate(() => queue[0]);
            await clickCell(page, 1, 2);
            const cell = await page.evaluate(() => grid[1][2]);
            expect(cell).toMatchObject({ kind: 'channel', type: next });
        });

        test('the queue refills and moves along', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            const before = await page.evaluate(() => queue.slice());
            await clickCell(page, 1, 2);
            const after = await page.evaluate(() => queue.slice());
            expect(after.length).toBe(5);
            expect(after.slice(0, 4)).toEqual(before.slice(1));
        });

        test('rock cannot be dug', async ({ page }) => {
            await startStill(page);
            const placed = await page.evaluate(() => {
                buildLevel({ level: 1, springRow: 3, poolRow: 3, rocks: 0 });
                grid[1][2] = { kind: 'rock' };
                return placePiece(1, 2);
            });
            expect(placed).toBe(false);
            expect(await page.evaluate(() => grid[1][2].kind)).toBe('rock');
        });

        test('the spring and the pool cannot be built over', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 4);
            const results = await page.evaluate(() => [placePiece(springRow, 0), placePiece(poolRow, COLS - 1)]);
            expect(results).toEqual([false, false]);
        });

        test('a cell that already holds a section is refused', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            expect(await lay(page, 1, 2, 'h')).toBe(true);
            expect(await lay(page, 1, 2, 'v')).toBe(false);
            expect(await page.evaluate(() => grid[1][2].type)).toBe('h');
        });

        test('cells outside the grid are refused', async ({ page }) => {
            await startStill(page);
            const results = await page.evaluate(() => [placePiece(-1, 3), placePiece(ROWS, 3), placePiece(2, COLS + 4)]);
            expect(results).toEqual([false, false, false]);
        });

        test('the arrow keys move the cursor and Space lays a section', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            const start = await page.evaluate(() => ({ ...cursor }));
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowRight');
            const moved = await page.evaluate(() => ({ ...cursor }));
            expect(moved).toEqual({ r: start.r + 1, c: start.c + 1 });
            await page.keyboard.press('Space');
            const cell = await page.evaluate(() => grid[cursor.r][cursor.c]);
            expect(cell.kind).toBe('channel');
        });

        test('the cursor stays inside the diggable area', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
            for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => ({ ...cursor }))).toEqual({ r: 0, c: 1 });
            for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
            for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => ({ ...cursor, c: cursor.c }))).toEqual({ r: 6, c: 7 });
        });

        test('clicking moves the cursor to the clicked cell', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await clickCell(page, 4, 5);
            expect(await page.evaluate(() => ({ ...cursor }))).toEqual({ r: 4, c: 5 });
        });
    });

    // -------------------------------------------------------------------
    // The shapes
    // -------------------------------------------------------------------
    test.describe('channel shapes', () => {
        test('each shape opens onto the right sides', async ({ page }) => {
            const map = await page.evaluate(() => {
                const out = {};
                for (const t of PIPE_TYPES) out[t] = openings(t).slice().sort().join('');
                return out;
            });
            expect(map).toEqual({
                h: 'EW', v: 'NS', ne: 'EN', nw: 'NW', se: 'ES', sw: 'SW', cross: 'ENSW',
            });
        });

        test('water runs straight through straights and crosses', async ({ page }) => {
            const exits = await page.evaluate(() => ({
                hEast: exitDir('h', 'E'),
                hWest: exitDir('h', 'W'),
                vSouth: exitDir('v', 'S'),
                crossEast: exitDir('cross', 'E'),
                crossNorth: exitDir('cross', 'N'),
            }));
            expect(exits).toEqual({ hEast: 'E', hWest: 'W', vSouth: 'S', crossEast: 'E', crossNorth: 'N' });
        });

        test('elbows turn the water', async ({ page }) => {
            const exits = await page.evaluate(() => ({
                nwFromWest: exitDir('nw', 'E'),
                neFromNorth: exitDir('ne', 'S'),
                seFromEast: exitDir('se', 'W'),
                swFromSouth: exitDir('sw', 'N'),
            }));
            expect(exits).toEqual({ nwFromWest: 'N', neFromNorth: 'E', seFromEast: 'S', swFromSouth: 'W' });
        });

        test('a shape with no opening facing the water has no exit', async ({ page }) => {
            const exits = await page.evaluate(() => ({
                vFromWest: exitDir('v', 'E'),
                hFromNorth: exitDir('h', 'S'),
                neFromWest: exitDir('ne', 'E'),
            }));
            expect(exits).toEqual({ vFromWest: null, hFromNorth: null, neFromWest: null });
        });
    });

    // -------------------------------------------------------------------
    // The water
    // -------------------------------------------------------------------
    test.describe('the water', () => {
        test('the water starts at the spring when the countdown ends', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await lay(page, 3, 1, 'h');
            await page.evaluate(() => { grace = 0; step(0.1); });
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.flow).toMatchObject({ r: 3, c: 1, dir: 'E' });
        });

        test('the water fills a cell and scores it', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await lay(page, 3, 1, 'h');
            await lay(page, 3, 2, 'h');
            await page.evaluate(() => { grace = 0; for (let i = 0; i < 40; i++) step(0.05); });
            const s = await snapshot(page);
            expect(s.flooded).toBeGreaterThanOrEqual(1);
            expect(s.score).toBeGreaterThanOrEqual(10);
            expect(await page.evaluate(() => grid[3][1].fill.main)).toBe(1);
        });

        test('the water crosses into the next section', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await lay(page, 3, 1, 'h');
            await lay(page, 3, 2, 'h');
            // 2s at level 1's 0.7 cells/second: through the first cell, into the second.
            await page.evaluate(() => { grace = 0; for (let i = 0; i < 40; i++) step(0.05); });
            expect(await page.evaluate(() => flow.c)).toBe(2);
        });

        test('an elbow sends the water around a corner', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await lay(page, 3, 1, 'nw');
            await lay(page, 2, 1, 'v');
            await page.evaluate(() => { grace = 0; for (let i = 0; i < 40; i++) step(0.05); });
            expect(await page.evaluate(() => ({ r: flow.r, c: flow.c, dir: flow.dir }))).toEqual({ r: 2, c: 1, dir: 'N' });
        });

        test('reaching the pool clears the level and pays a bonus', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await layStraightRoute(page, 3);
            await runWater(page);
            const s = await snapshot(page);
            expect(s.state).toBe('levelclear');
            expect(s.score).toBe(7 * 10 + 200);
            await expect(page.locator('#overlay-title')).toContainText(/Siloam|water|pool/i);
        });

        test('a cross carries one route over another', async ({ page }) => {
            await startStill(page);
            await page.evaluate(() => buildLevel({ level: 1, springRow: 3, poolRow: 4, rocks: 0 }));
            // East along row 3, up and back west over row 2, down through the
            // cross a second time, then east along row 4 to the pool.
            const route = [
                [3, 1, 'h'], [3, 2, 'h'], [3, 3, 'h'], [3, 4, 'cross'], [3, 5, 'nw'],
                [2, 5, 'sw'], [2, 4, 'se'],
                [4, 4, 'ne'], [4, 5, 'h'], [4, 6, 'h'], [4, 7, 'h'],
            ];
            for (const [r, c, t] of route) expect(await lay(page, r, c, t)).toBe(true);
            await runWater(page);
            const s = await snapshot(page);
            expect(s.state).toBe('levelclear');
            const crossFill = await page.evaluate(() => ({ ...grid[3][4].fill }));
            expect(crossFill).toEqual({ h: 1, v: 1 });
        });

        test('sections can still be laid while the water is running', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await lay(page, 3, 1, 'h');
            // The water sets off with only one section down; keep laying ahead of it.
            await page.evaluate(() => { grace = 0; step(0.1); });
            expect(await page.evaluate(() => flow !== null)).toBe(true);
            for (let c = 2; c <= 7; c++) {
                expect(await lay(page, 3, c, 'h')).toBe(true);
                await page.evaluate(() => { for (let i = 0; i < 20; i++) step(0.05); });
            }
            await runWater(page);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('the water keeps running at its own pace, countdown over', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await layStraightRoute(page, 3);
            await page.evaluate(() => { grace = 0; step(0.5); });
            const first = await page.evaluate(() => grid[3][1].fill.main);
            await page.evaluate(() => step(0.5));
            const second = await page.evaluate(() => grid[3][1].fill.main);
            expect(second).toBeGreaterThan(first);
            expect(await page.evaluate(() => grace)).toBe(0);
        });

        test('each channel of a cross scores on its own', async ({ page }) => {
            await startStill(page);
            await page.evaluate(() => buildLevel({ level: 1, springRow: 3, poolRow: 4, rocks: 0 }));
            const route = [
                [3, 1, 'h'], [3, 2, 'h'], [3, 3, 'h'], [3, 4, 'cross'], [3, 5, 'nw'],
                [2, 5, 'sw'], [2, 4, 'se'],
                [4, 4, 'ne'], [4, 5, 'h'], [4, 6, 'h'], [4, 7, 'h'],
            ];
            for (const [r, c, t] of route) await lay(page, r, c, t);
            await runWater(page);
            // Eleven sections, but the cross is filled twice: twelve scoring cells.
            expect(await page.evaluate(() => flooded)).toBe(12);
            expect(await page.evaluate(() => score)).toBe(12 * 10 + 200);
        });

        test('water running into bare ground leaks', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await runWater(page);
            const s = await snapshot(page);
            expect(s.state).toBe('leak');
            expect(s.days).toBe(2);
            await expect(page.locator('#status')).toContainText(/leak|broke|rock/i);
        });

        test('water running into a shape that does not face it leaks', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await lay(page, 3, 1, 'v');
            await runWater(page);
            expect(await page.evaluate(() => state)).toBe('leak');
        });

        test('water running into rock leaks', async ({ page }) => {
            await startStill(page);
            await page.evaluate(() => {
                buildLevel({ level: 1, springRow: 3, poolRow: 3, rocks: 0 });
                grid[3][2] = { kind: 'rock' };
            });
            await lay(page, 3, 1, 'h');
            await runWater(page);
            expect(await page.evaluate(() => state)).toBe('leak');
        });

        test('water running off the edge of the grid leaks', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 0, 3);
            await lay(page, 0, 1, 'nw');
            await runWater(page);
            expect(await page.evaluate(() => state)).toBe('leak');
        });

        test('water running back into a full channel leaks', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await lay(page, 3, 1, 'h');
            const result = await page.evaluate(() => {
                grid[3][1].fill.main = 1;
                enterCell(3, 1, 'E');
                return state;
            });
            expect(result).toBe('leak');
        });

        test('water arriving at the pool from the wrong side leaks', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            const result = await page.evaluate(() => {
                enterCell(poolRow, COLS - 1, 'N');
                return state;
            });
            expect(result).toBe('leak');
        });
    });

    // -------------------------------------------------------------------
    // Days and game over
    // -------------------------------------------------------------------
    test.describe('days and game over', () => {
        test('a leak costs a day and the level is laid out afresh', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await lay(page, 3, 1, 'h');
            await runWater(page);
            expect(await page.evaluate(() => state)).toBe('leak');
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.days).toBe(2);
            expect(s.flooded).toBe(0);
            expect(s.flow).toBeNull();
            expect(s.grace).toBeGreaterThan(0);
            await expect(page.locator('#days')).toHaveText('2');
            const empty = await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++)
                    for (let c = 1; c < COLS - 1; c++)
                        if (grid[r][c] && grid[r][c].kind === 'channel') return false;
                return true;
            });
            expect(empty).toBe(true);
        });

        test('the level number and score survive a lost day', async ({ page }) => {
            await startStill(page);
            await page.evaluate(() => { level = 3; score = 500; });
            await buildBoard(page, 3, 3, 3);
            await runWater(page);
            await page.keyboard.press('Space');
            expect(await snapshot(page)).toMatchObject({ level: 3, score: 500, days: 2, state: 'running' });
        });

        test('losing the last day ends the game', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await page.evaluate(() => { days = 1; });
            await runWater(page);
            expect(await page.evaluate(() => state)).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|dry/i);
        });

        test('the best score is kept after the game ends', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await page.evaluate(() => { days = 1; score = 1234; });
            await runWater(page);
            expect(await page.evaluate(() => window.localStorage.getItem('hezekiahs-tunnel-best'))).toBe('1234');
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('hezekiahs-tunnel-best', '9000'));
            await page.reload();
            await startStill(page);
            await buildBoard(page, 3, 3);
            await page.evaluate(() => { days = 1; score = 12; });
            await runWater(page);
            expect(await page.evaluate(() => window.localStorage.getItem('hezekiahs-tunnel-best'))).toBe('9000');
        });

        test('Space after game over starts a fresh dig', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await page.evaluate(() => { days = 1; score = 70; });
            await runWater(page);
            await page.keyboard.press('Space');
            expect(await snapshot(page)).toMatchObject({ state: 'running', score: 0, days: 3, level: 1 });
        });
    });

    // -------------------------------------------------------------------
    // Levels
    // -------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing a level moves on to the next, faster one', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await layStraightRoute(page, 3);
            await runWater(page);
            const scoreBefore = await page.evaluate(() => score);
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s).toMatchObject({ state: 'running', level: 2, flooded: 0 });
            expect(s.score).toBe(scoreBefore);
            expect(s.grace).toBeCloseTo(await page.evaluate(() => LEVELS[1].grace), 2);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the water moves faster on a later level', async ({ page }) => {
            const travelled = await page.evaluate(() => {
                stopLoop();
                startGame();
                const run = (lvl) => {
                    level = lvl;
                    buildLevel({ level: lvl, springRow: 3, poolRow: 3, rocks: 0 });
                    for (let c = 1; c <= COLS - 2; c++) { queue[0] = 'h'; placePiece(3, c); }
                    grace = 0;
                    step(1);
                    return grid[3][1].fill.main;
                };
                return { slow: run(1), fast: run(5) };
            });
            expect(travelled.fast).toBeGreaterThan(travelled.slow);
        });

        test('clearing the last level wins the game', async ({ page }) => {
            await startStill(page);
            await page.evaluate(() => { level = LEVELS.length; });
            await buildBoard(page, 3, 3, 5);
            await layStraightRoute(page, 3);
            await runWater(page);
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/tunnel|finished|complete|won/i);
        });
    });

    // -------------------------------------------------------------------
    // Pause and new game
    // -------------------------------------------------------------------
    test.describe('pause and new game', () => {
        test('P pauses and resumes, and the clock stops while paused', async ({ page }) => {
            await startStill(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            const before = await page.evaluate(() => grace);
            await page.evaluate(() => { for (let i = 0; i < 20; i++) step(0.25); });
            expect(await page.evaluate(() => grace)).toBeCloseTo(before, 5);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing can be laid while paused', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await page.keyboard.press('p');
            expect(await lay(page, 1, 2, 'h')).toBe(false);
        });

        test('N starts a new game at level one', async ({ page }) => {
            await startStill(page);
            await page.evaluate(() => { level = 4; score = 880; days = 1; });
            await page.keyboard.press('n');
            expect(await snapshot(page)).toMatchObject({ state: 'running', level: 1, score: 0, days: 3 });
        });

        test('the new game button starts a new game', async ({ page }) => {
            await startStill(page);
            await page.evaluate(() => { score = 400; });
            await page.locator('#btn-new').click();
            expect(await snapshot(page)).toMatchObject({ state: 'running', score: 0 });
        });
    });

    // -------------------------------------------------------------------
    // Presentation
    // -------------------------------------------------------------------
    test.describe('presentation', () => {
        test('the status line is announced politely', async ({ page }) => {
            await expect(page.locator('#status')).toHaveAttribute('aria-live', 'polite');
        });

        test('the canvas carries a label for screen readers', async ({ page }) => {
            await expect(page.locator('#canvas')).toHaveAttribute('aria-label', /.+/);
        });

        test('the rules explain the controls', async ({ page }) => {
            await expect(page.locator('#rules')).toContainText(/arrow/i);
            await expect(page.locator('#rules')).toContainText(/space/i);
        });

        test('the HUD shows the countdown, then that the water is running', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await expect(page.locator('#timer')).toContainText(/\d/);
            await lay(page, 3, 1, 'h');
            await lay(page, 3, 2, 'h');
            await page.evaluate(() => { grace = 0; step(0.2); });
            await expect(page.locator('#timer')).toContainText(/flow|running/i);
        });

        test('laying a section changes what is drawn', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            const read = () => page.evaluate(() => {
                const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                let n = 0;
                for (let i = 0; i < d.length; i += 4) n += d[i] + d[i + 1] + d[i + 2];
                return n;
            });
            const before = await read();
            await lay(page, 1, 2, 'cross');
            await page.evaluate(() => draw());
            expect(await read()).not.toBe(before);
        });

        test('the queue strip is drawn', async ({ page }) => {
            const painted = await page.evaluate(() => {
                const q = document.getElementById('queue-canvas');
                const d = q.getContext('2d').getImageData(0, 0, q.width, q.height).data;
                let n = 0;
                for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) n++;
                return n;
            });
            expect(painted).toBeGreaterThan(200);
        });

        test('no errors after a full level is played out', async ({ page }) => {
            await startStill(page);
            await buildBoard(page, 3, 3);
            await layStraightRoute(page, 3);
            await runWater(page);
            await page.keyboard.press('Space');
            await page.waitForTimeout(200);
            expect(errors).toEqual([]);
        });
    });
});
