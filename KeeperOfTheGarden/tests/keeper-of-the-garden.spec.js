const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Put the world in a known state: one caterpillar of `len` segments laid out
// head-first along a row, nothing else moving.
async function placeCaterpillar(page, { col = 5, row = 5, len = 1, dx = 1, dy = 1 } = {}) {
    await page.evaluate(({ col, row, len, dx, dy }) => {
        startGame();
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) thistles[r][c] = 0;
        drops = [];
        snail = null;
        bee = null;
        const cells = [];
        for (let i = 0; i < len; i++) {
            cells.push({ col: col - i * dx, row, prevCol: col - i * dx, prevRow: row });
        }
        caterpillars = [{ cells, dx, dy }];
        catProgress = 0;
    }, { col, row, len, dx, dy });
}

// Read the caterpillars as plain data.
async function readCaterpillars(page) {
    return page.evaluate(() =>
        caterpillars.map((c) => ({
            dx: c.dx,
            dy: c.dy,
            cells: c.cells.map((s) => ({ col: s.col, row: s.row })),
        }))
    );
}

// Drop a water droplet right on top of a segment so the next step hits it.
async function aimAtSegment(page, catIndex, segIndex) {
    return page.evaluate(({ catIndex, segIndex }) => {
        const seg = caterpillars[catIndex].cells[segIndex];
        const c = segmentCenter(seg);
        drops = [{ x: c.x, y: c.y }];
        return { col: seg.col, row: seg.row };
    }, { catIndex, segIndex });
}

test.describe('Keeper of the Garden', () => {
    const errors = [];
    test.beforeEach(async ({ page }) => {
        errors.length = 0;
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(GAME_URL);
        // The tests are the clock: freeze the animation loop so nothing moves
        // between evaluate() calls and step(dt) is the only thing that advances
        // the world.
        await page.evaluate(() => freezeLoop());
    });

    // -------------------------------------------------------------------
    // Initial state
    // -------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Keeper of the Garden', async ({ page }) => {
            await expect(page).toHaveTitle('Keeper of the Garden');
        });

        test('the start overlay is visible and invites a key press', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('the canvas is 500 x 600', async ({ page }) => {
            await expect(page.locator('#canvas')).toHaveAttribute('width', '500');
            await expect(page.locator('#canvas')).toHaveAttribute('height', '600');
        });

        test('the grid matches the canvas', async ({ page }) => {
            const g = await page.evaluate(() => ({ w: COLS * CELL, h: ROWS * CELL, W: WIDTH, H: HEIGHT }));
            expect(g.w).toBe(g.W);
            expect(g.h).toBe(g.H);
        });

        test('score, lives and level start at 0 / 3 / 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no caterpillars, drops, snail or bee before starting', async ({ page }) => {
            const w = await page.evaluate(() => ({
                cats: caterpillars.length,
                drops: drops.length,
                snail: snail === null,
                bee: bee === null,
            }));
            expect(w).toEqual({ cats: 0, drops: 0, snail: true, bee: true });
        });

        test('the keeper starts centred on the bottom row of the patch', async ({ page }) => {
            const p = await page.evaluate(() => ({
                centred: Math.abs(player.x - WIDTH / 2) < 1,
                bottom: Math.abs(player.y - (HEIGHT - player.h / 2)) < 1,
                inPatch: player.y > PLAYER_TOP_ROW * CELL,
            }));
            expect(p).toEqual({ centred: true, bottom: true, inPatch: true });
        });

        test('the keeper patch is the bottom rows of the grid', async ({ page }) => {
            const r = await page.evaluate(() => ({ top: PLAYER_TOP_ROW, rows: ROWS }));
            expect(r.top).toBeGreaterThan(r.rows / 2);
            expect(r.top).toBeLessThan(r.rows);
        });
    });

    // -------------------------------------------------------------------
    // Thistle field
    // -------------------------------------------------------------------
    test.describe('the thistle field', () => {
        test('a field of thistles is sown when the game starts', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                return thistleCount();
            });
            expect(n).toBeGreaterThan(10);
            expect(n).toBeLessThan(120);
        });

        test('thistles never start on the top or bottom row', async ({ page }) => {
            const bad = await page.evaluate(() => {
                startGame();
                const rows = [];
                for (let c = 0; c < COLS; c++) {
                    if (thistles[0][c] > 0) rows.push(0);
                    if (thistles[1][c] > 0) rows.push(1);
                    if (thistles[ROWS - 1][c] > 0) rows.push(ROWS - 1);
                }
                return rows;
            });
            expect(bad).toEqual([]);
        });

        test('every thistle starts at full health', async ({ page }) => {
            const bad = await page.evaluate(() => {
                startGame();
                const out = [];
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++)
                        if (thistles[r][c] !== 0 && thistles[r][c] !== THISTLE_STAGES) out.push(thistles[r][c]);
                return out;
            });
            expect(bad).toEqual([]);
        });

        test('the same seed sows the same field', async ({ page }) => {
            const same = await page.evaluate(() => {
                setSeed(7);
                startGame();
                const a = JSON.stringify(thistles);
                setSeed(7);
                startGame();
                return a === JSON.stringify(thistles);
            });
            expect(same).toBe(true);
        });

        test('thistleAt is safe outside the grid', async ({ page }) => {
            const out = await page.evaluate(() => [
                thistleAt(-1, 5), thistleAt(COLS, 5), thistleAt(5, -1), thistleAt(5, ROWS),
            ]);
            expect(out).toEqual([0, 0, 0, 0]);
        });
    });

    // -------------------------------------------------------------------
    // Starting, pausing, restarting
    // -------------------------------------------------------------------
    test.describe('starting and pausing', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('an arrow key starts the game', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting spawns a wave of caterpillar segments', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                return segmentCount();
            });
            expect(n).toBeGreaterThanOrEqual(10);
        });

        test('the wave enters on the top row', async ({ page }) => {
            const rows = await page.evaluate(() => {
                startGame();
                return caterpillars.flatMap((c) => c.cells.map((s) => s.row));
            });
            expect([...new Set(rows)]).toEqual([0]);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await placeCaterpillar(page, { col: 5, row: 5, len: 3 });
            const still = await page.evaluate(() => {
                state = 'paused';
                const before = JSON.stringify(caterpillars);
                step(1000);
                return before === JSON.stringify(caterpillars);
            });
            expect(still).toBe(true);
        });
    });

    // -------------------------------------------------------------------
    // The keeper
    // -------------------------------------------------------------------
    test.describe('moving the keeper', () => {
        test('ArrowRight moves the keeper right', async ({ page }) => {
            await page.keyboard.press('Space');
            const moved = await page.evaluate(() => {
                const x = player.x;
                keys.right = true;
                step(100);
                return player.x - x;
            });
            expect(moved).toBeGreaterThan(5);
        });

        test('ArrowLeft moves the keeper left', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.down('ArrowLeft');
            const moved = await page.evaluate(() => {
                const x = player.x;
                step(100);
                return x - player.x;
            });
            expect(moved).toBeGreaterThan(5);
        });

        test('W and S move the keeper up and down', async ({ page }) => {
            await page.keyboard.press('Space');
            const up = await page.evaluate(() => {
                const y = player.y;
                keys.up = true;
                step(100);
                keys.up = false;
                return y - player.y;
            });
            const down = await page.evaluate(() => {
                const y = player.y;
                keys.down = true;
                step(100);
                keys.down = false;
                return player.y - y;
            });
            expect(up).toBeGreaterThan(5);
            expect(down).toBeGreaterThan(5);
        });

        test('the keeper cannot climb out of the patch', async ({ page }) => {
            const top = await page.evaluate(() => {
                startGame();
                keys.up = true;
                step(5000);
                return { y: player.y, limit: PLAYER_TOP_ROW * CELL + player.h / 2 };
            });
            expect(top.y).toBeCloseTo(top.limit, 5);
        });

        test('the keeper stays inside the canvas left and right', async ({ page }) => {
            const edges = await page.evaluate(() => {
                startGame();
                keys.left = true;
                step(5000);
                const left = player.x;
                keys.left = false;
                keys.right = true;
                step(5000);
                return { left, right: player.x, w: player.w };
            });
            expect(edges.left).toBeCloseTo(edges.w / 2, 5);
            expect(edges.right).toBeCloseTo(500 - edges.w / 2, 5);
        });

        test('the keeper cannot sink below the canvas', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                keys.down = true;
                step(5000);
                return { y: player.y, limit: HEIGHT - player.h / 2 };
            });
            expect(y.y).toBeCloseTo(y.limit, 5);
        });
    });

    // -------------------------------------------------------------------
    // Watering
    // -------------------------------------------------------------------
    test.describe('squirting water', () => {
        test('Space squirts a drop from the watering can', async ({ page }) => {
            await page.keyboard.press('Space');
            const d = await page.evaluate(() => {
                drops = [];
                sprayCooldown = 0;
                squirt();
                return drops.map((d) => ({ dx: Math.abs(d.x - player.x), dy: player.y - d.y }));
            });
            expect(d.length).toBe(1);
            expect(d[0].dx).toBeLessThan(2);
            expect(d[0].dy).toBeGreaterThanOrEqual(0);
        });

        test('at most three drops are in flight', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                drops = [];
                for (let i = 0; i < 8; i++) {
                    sprayCooldown = 0;
                    squirt();
                }
                return drops.length;
            });
            expect(n).toBe(3);
            expect(n).toBe(await page.evaluate(() => MAX_DROPS));
        });

        test('a cooldown separates squirts', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                drops = [];
                sprayCooldown = 0;
                squirt();
                squirt();
                return drops.length;
            });
            expect(n).toBe(1);
        });

        test('holding Space keeps squirting once the cooldown passes', async ({ page }) => {
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => {
                for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) thistles[r][c] = 0;
                caterpillars = [];
                drops = [];
                sprayCooldown = 0;
                keys.spray = true;
                step(1);
                step(SPRAY_COOLDOWN + 1);
                return drops.length;
            });
            expect(n).toBe(2);
        });

        test('drops travel upward and leave the top of the garden', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                for (let row = 0; row < ROWS; row++) for (let c = 0; c < COLS; c++) thistles[row][c] = 0;
                caterpillars = [];
                drops = [{ x: 250, y: 500 }];
                step(100);
                const rose = drops.length === 1 && drops[0].y < 500;
                step(3000);
                return { rose, left: drops.length };
            });
            expect(r.rose).toBe(true);
            expect(r.left).toBe(0);
        });
    });

    // -------------------------------------------------------------------
    // Caterpillar movement
    // -------------------------------------------------------------------
    test.describe('the caterpillar crawls', () => {
        test('the head steps sideways in its direction', async ({ page }) => {
            await placeCaterpillar(page, { col: 5, row: 5, dx: 1 });
            await page.evaluate(() => step(stepInterval()));
            const cats = await readCaterpillars(page);
            expect(cats[0].cells[0]).toEqual({ col: 6, row: 5 });
        });

        test('each segment follows the path of the one ahead', async ({ page }) => {
            await placeCaterpillar(page, { col: 5, row: 5, len: 3, dx: 1 });
            await page.evaluate(() => step(stepInterval()));
            const cats = await readCaterpillars(page);
            expect(cats[0].cells).toEqual([
                { col: 6, row: 5 },
                { col: 5, row: 5 },
                { col: 4, row: 5 },
            ]);
        });

        test('one step happens per step interval, no more', async ({ page }) => {
            await placeCaterpillar(page, { col: 2, row: 5, dx: 1 });
            const col = await page.evaluate(() => {
                step(stepInterval() * 3 + 1);
                return caterpillars[0].cells[0].col;
            });
            expect(col).toBe(5);
        });

        test('the caterpillar turns and drops a row at the garden edge', async ({ page }) => {
            await placeCaterpillar(page, { col: 24, row: 5, dx: 1 });
            await page.evaluate(() => step(stepInterval()));
            const cats = await readCaterpillars(page);
            expect(cats[0].cells[0]).toEqual({ col: 24, row: 6 });
            expect(cats[0].dx).toBe(-1);
        });

        test('the caterpillar turns and drops a row at a thistle', async ({ page }) => {
            await placeCaterpillar(page, { col: 5, row: 5, dx: 1 });
            await page.evaluate(() => {
                thistles[5][6] = THISTLE_STAGES;
                step(stepInterval());
            });
            const cats = await readCaterpillars(page);
            expect(cats[0].cells[0]).toEqual({ col: 5, row: 6 });
            expect(cats[0].dx).toBe(-1);
        });

        test('a caterpillar at the bottom row turns around and climbs', async ({ page }) => {
            await placeCaterpillar(page, { col: 24, row: 29, dx: 1, dy: 1 });
            await page.evaluate(() => step(stepInterval()));
            const cats = await readCaterpillars(page);
            expect(cats[0].cells[0]).toEqual({ col: 24, row: 28 });
            expect(cats[0].dy).toBe(-1);
        });

        test('a climbing caterpillar turns back down at the top row', async ({ page }) => {
            await placeCaterpillar(page, { col: 0, row: 0, dx: -1, dy: -1 });
            await page.evaluate(() => step(stepInterval()));
            const cats = await readCaterpillars(page);
            expect(cats[0].cells[0]).toEqual({ col: 0, row: 1 });
            expect(cats[0].dy).toBe(1);
            expect(cats[0].dx).toBe(1);
        });

        test('higher levels crawl faster', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                level = 1;
                const slow = stepInterval();
                level = 5;
                return { slow, fast: stepInterval() };
            });
            expect(speeds.fast).toBeLessThan(speeds.slow);
        });

        test('segments keep their previous cell so drawing can interpolate', async ({ page }) => {
            await placeCaterpillar(page, { col: 5, row: 5, dx: 1 });
            const seg = await page.evaluate(() => {
                step(stepInterval());
                const s = caterpillars[0].cells[0];
                return { col: s.col, row: s.row, prevCol: s.prevCol, prevRow: s.prevRow };
            });
            expect(seg).toEqual({ col: 6, row: 5, prevCol: 5, prevRow: 5 });
        });
    });

    // -------------------------------------------------------------------
    // Watering the caterpillar
    // -------------------------------------------------------------------
    test.describe('watering the caterpillar', () => {
        test('a drop shoos a segment away', async ({ page }) => {
            await placeCaterpillar(page, { col: 5, row: 5, len: 4 });
            await aimAtSegment(page, 0, 1);
            const n = await page.evaluate(() => {
                step(1);
                return { segments: segmentCount(), drops: drops.length };
            });
            expect(n).toEqual({ segments: 3, drops: 0 });
        });

        test('watering a middle segment splits the caterpillar in two', async ({ page }) => {
            await placeCaterpillar(page, { col: 8, row: 5, len: 5 });
            await aimAtSegment(page, 0, 2);
            await page.evaluate(() => step(1));
            const cats = await readCaterpillars(page);
            expect(cats.length).toBe(2);
            expect(cats.map((c) => c.cells.length).sort()).toEqual([2, 2]);
        });

        test('both halves keep crawling in the same direction', async ({ page }) => {
            await placeCaterpillar(page, { col: 8, row: 5, len: 5, dx: -1 });
            await aimAtSegment(page, 0, 2);
            await page.evaluate(() => step(1));
            const cats = await readCaterpillars(page);
            expect(cats.every((c) => c.dx === -1 && c.dy === 1)).toBe(true);
        });

        test('watering the tail leaves one caterpillar', async ({ page }) => {
            await placeCaterpillar(page, { col: 8, row: 5, len: 4 });
            await aimAtSegment(page, 0, 3);
            await page.evaluate(() => step(1));
            const cats = await readCaterpillars(page);
            expect(cats.length).toBe(1);
            expect(cats[0].cells.length).toBe(3);
        });

        test('watering the head leaves one caterpillar with a new head', async ({ page }) => {
            await placeCaterpillar(page, { col: 8, row: 5, len: 4 });
            await aimAtSegment(page, 0, 0);
            await page.evaluate(() => step(1));
            const cats = await readCaterpillars(page);
            expect(cats.length).toBe(1);
            expect(cats[0].cells[0]).toEqual({ col: 7, row: 5 });
        });

        test('a head scores 100 and a body segment 10', async ({ page }) => {
            await placeCaterpillar(page, { col: 8, row: 5, len: 4 });
            await aimAtSegment(page, 0, 0);
            const head = await page.evaluate(() => {
                score = 0;
                step(1);
                return score;
            });
            await placeCaterpillar(page, { col: 8, row: 5, len: 4 });
            await aimAtSegment(page, 0, 2);
            const body = await page.evaluate(() => {
                score = 0;
                step(1);
                return score;
            });
            expect(head).toBe(100);
            expect(body).toBe(10);
        });

        test('a thistle is planted where the segment was', async ({ page }) => {
            await placeCaterpillar(page, { col: 8, row: 5, len: 4 });
            const cell = await aimAtSegment(page, 0, 2);
            const planted = await page.evaluate(
                ({ col, row }) => {
                    step(1);
                    return thistleAt(col, row);
                },
                cell
            );
            expect(planted).toBe(await page.evaluate(() => THISTLE_STAGES));
        });

        test('the score HUD follows the score', async ({ page }) => {
            await placeCaterpillar(page, { col: 8, row: 5, len: 2 });
            await aimAtSegment(page, 0, 1);
            await page.evaluate(() => {
                score = 0;
                step(1);
            });
            await expect(page.locator('#score')).toHaveText('10');
        });

        test('clearing the garden starts the next level with a fresh wave', async ({ page }) => {
            await placeCaterpillar(page, { col: 8, row: 5, len: 1 });
            await aimAtSegment(page, 0, 0);
            const after = await page.evaluate(() => {
                score = 0;
                step(1);
                return { level, score, segments: segmentCount() };
            });
            expect(after.level).toBe(2);
            expect(after.score).toBe(150); // 100 for the head + a 50 wave bonus
            expect(after.segments).toBeGreaterThanOrEqual(10);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('later waves are longer', async ({ page }) => {
            const lens = await page.evaluate(() => {
                startGame();
                const first = Math.max(...caterpillars.map((c) => c.cells.length));
                level = 4;
                spawnWave();
                return { first, later: Math.max(...caterpillars.map((c) => c.cells.length)) };
            });
            expect(lens.later).toBeGreaterThan(lens.first);
        });

        test('later waves bring extra lone crawlers', async ({ page }) => {
            const counts = await page.evaluate(() => {
                level = 1;
                spawnWave();
                const first = caterpillars.length;
                level = 3;
                spawnWave();
                return { first, later: caterpillars.length };
            });
            expect(counts.first).toBe(1);
            expect(counts.later).toBeGreaterThan(1);
        });
    });

    // -------------------------------------------------------------------
    // Thistles
    // -------------------------------------------------------------------
    test.describe('clearing thistles', () => {
        test('a drop takes one stage off a thistle and stops there', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                caterpillars = [];
                thistles[20][10] = THISTLE_STAGES;
                const c = cellCenter(10, 20);
                drops = [{ x: c.x, y: c.y }];
                score = 0;
                step(1);
                return { health: thistleAt(10, 20), drops: drops.length, score };
            });
            expect(r).toEqual({ health: 3, drops: 0, score: 1 });
        });

        test('four drops clear a thistle and pay a bonus', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                caterpillars = [];
                thistles[20][10] = THISTLE_STAGES;
                score = 0;
                for (let i = 0; i < THISTLE_STAGES; i++) {
                    const c = cellCenter(10, 20);
                    drops = [{ x: c.x, y: c.y }];
                    step(1);
                }
                return { health: thistleAt(10, 20), score };
            });
            expect(r.health).toBe(0);
            expect(r.score).toBe(9); // 1 per stage + 5 for clearing it
        });

        test('a drop passes through empty ground', async ({ page }) => {
            const left = await page.evaluate(() => {
                startGame();
                caterpillars = [];
                for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) thistles[r][c] = 0;
                const c = cellCenter(10, 20);
                drops = [{ x: c.x, y: c.y }];
                step(1);
                return drops.length;
            });
            expect(left).toBe(1);
        });
    });

    // -------------------------------------------------------------------
    // The snail
    // -------------------------------------------------------------------
    test.describe('the snail', () => {
        test('it enters the keeper patch from one side', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                spawnSnail();
                return { y: snail.y, patchTop: PLAYER_TOP_ROW * CELL, h: HEIGHT, x: snail.x, w: WIDTH };
            });
            expect(s.y).toBeGreaterThanOrEqual(s.patchTop);
            expect(s.y).toBeLessThanOrEqual(s.h);
            expect(s.x < 0 || s.x > s.w).toBe(true);
        });

        test('it crawls diagonally', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                spawnSnail();
                const { x, y } = snail;
                step(100);
                return { dx: Math.abs(snail.x - x), dy: Math.abs(snail.y - y) };
            });
            expect(moved.dx).toBeGreaterThan(1);
            expect(moved.dy).toBeGreaterThan(1);
        });

        test('it stays inside the keeper patch while it is on screen', async ({ page }) => {
            const inside = await page.evaluate(() => {
                startGame();
                spawnSnail();
                let ok = true;
                for (let i = 0; i < 200; i++) {
                    step(16);
                    if (!snail) break;
                    if (snail.y < PLAYER_TOP_ROW * CELL - 1 || snail.y > HEIGHT + 1) ok = false;
                }
                return ok;
            });
            expect(inside).toBe(true);
        });

        test('it leaves the garden at the far side', async ({ page }) => {
            const gone = await page.evaluate(() => {
                startGame();
                spawnSnail();
                for (let i = 0; i < 400 && snail; i++) step(16);
                return snail === null;
            });
            expect(gone).toBe(true);
        });

        test('it eats the thistles it crawls over', async ({ page }) => {
            const eaten = await page.evaluate(() => {
                startGame();
                for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) thistles[r][c] = 0;
                spawnSnail();
                const col = Math.max(0, Math.min(COLS - 1, Math.round(snail.x / CELL)));
                const row = Math.floor(snail.y / CELL);
                thistles[row][col] = THISTLE_STAGES;
                snail.x = cellCenter(col, row).x;
                snail.y = cellCenter(col, row).y;
                step(1);
                return thistleAt(col, row);
            });
            expect(eaten).toBe(0);
        });

        test('watering the snail scores 300', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                caterpillars = [];
                spawnSnail();
                snail.x = 250;
                snail.y = HEIGHT - 60;
                drops = [{ x: snail.x, y: snail.y }];
                score = 0;
                step(1);
                return { score, snail: snail === null, drops: drops.length };
            });
            expect(r).toEqual({ score: 300, snail: true, drops: 0 });
        });

        test('touching the snail costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                spawnSnail();
                snail.x = player.x;
                snail.y = player.y;
                step(1);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('a snail arrives on its own after a while', async ({ page }) => {
            const came = await page.evaluate(() => {
                startGame();
                caterpillars = [];
                for (let i = 0; i < 2000 && !snail; i++) step(16);
                return snail !== null;
            });
            expect(came).toBe(true);
        });
    });

    // -------------------------------------------------------------------
    // The bee
    // -------------------------------------------------------------------
    test.describe('the bee', () => {
        test('it arrives when the patch runs short of thistles', async ({ page }) => {
            const came = await page.evaluate(() => {
                startGame();
                caterpillars = [];
                for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) thistles[r][c] = 0;
                for (let i = 0; i < 600 && !bee; i++) step(16);
                return bee !== null;
            });
            expect(came).toBe(true);
        });

        test('it stays away while the patch is full of thistles', async ({ page }) => {
            const stayed = await page.evaluate(() => {
                startGame();
                caterpillars = [];
                for (let r = PLAYER_TOP_ROW; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++) thistles[r][c] = THISTLE_STAGES;
                for (let i = 0; i < 600; i++) step(16);
                return bee === null;
            });
            expect(stayed).toBe(true);
        });

        test('it falls straight down and plants thistles', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                caterpillars = [];
                for (let row = 0; row < ROWS; row++) for (let c = 0; c < COLS; c++) thistles[row][c] = 0;
                spawnBee();
                const x0 = bee.x;
                const y0 = bee.y;
                for (let i = 0; i < 40 && bee; i++) step(16);
                return { straight: bee ? Math.abs(bee.x - x0) < 0.001 : true, fell: bee ? bee.y > y0 : true, planted: thistleCount() };
            });
            expect(r.straight).toBe(true);
            expect(r.fell).toBe(true);
            expect(r.planted).toBeGreaterThan(0);
        });

        test('it leaves at the bottom of the garden', async ({ page }) => {
            const gone = await page.evaluate(() => {
                startGame();
                caterpillars = [];
                spawnBee();
                for (let i = 0; i < 400 && bee; i++) step(16);
                return bee === null;
            });
            expect(gone).toBe(true);
        });

        test('the first drop only hurries the bee along', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                caterpillars = [];
                spawnBee();
                bee.y = 200;
                const speed = bee.speed;
                drops = [{ x: bee.x, y: bee.y }];
                score = 0;
                step(1);
                return { there: bee !== null, faster: bee ? bee.speed > speed : false, score };
            });
            expect(r.there).toBe(true);
            expect(r.faster).toBe(true);
            expect(r.score).toBe(0);
        });

        test('the second drop shoos the bee away for 200', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                caterpillars = [];
                spawnBee();
                bee.y = 200;
                score = 0;
                for (let i = 0; i < 2 && bee; i++) {
                    drops = [{ x: bee.x, y: bee.y }];
                    step(1);
                }
                return { gone: bee === null, score };
            });
            expect(r).toEqual({ gone: true, score: 200 });
        });

        test('touching the bee costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                spawnBee();
                bee.x = player.x;
                bee.y = player.y;
                step(1);
                return lives;
            });
            expect(lives).toBe(2);
        });
    });

    // -------------------------------------------------------------------
    // Lives and game over
    // -------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test('touching a caterpillar costs a life', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const col = Math.floor(player.x / CELL);
                const row = Math.floor(player.y / CELL);
                caterpillars = [{ cells: [{ col, row, prevCol: col, prevRow: row }], dx: 1, dy: 1 }];
                catProgress = 0;
                step(1);
                return lives;
            });
            expect(r).toBe(2);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('losing a life recentres the keeper and clears the creatures', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                player.x = 40;
                drops = [{ x: 1, y: 1 }];
                spawnSnail();
                spawnBee();
                loseLife();
                return { x: player.x, drops: drops.length, snail: snail === null, bee: bee === null };
            });
            expect(r).toEqual({ x: 250, drops: 0, snail: true, bee: true });
        });

        test('losing a life keeps the thistle field and the score', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 420;
                thistles[20][10] = 2;
                loseLife();
                return { score, thistle: thistleAt(10, 20) };
            });
            expect(r).toEqual({ score: 420, thistle: 2 });
        });

        test('losing a life restarts the wave', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                caterpillars = [];
                loseLife();
                return segmentCount();
            });
            expect(n).toBeGreaterThanOrEqual(10);
        });

        test('the third life lost ends the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                loseLife();
                loseLife();
                loseLife();
                return { state, lives };
            });
            expect(r).toEqual({ state: 'over', lives: 0 });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/garden|over/i);
        });

        test('the final score is shown on the overlay', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                endGame();
            });
            await expect(page.locator('#overlay-score')).toHaveText('1234');
        });

        test('the best score is kept in localStorage', async ({ page }) => {
            const stored = await page.evaluate(() => {
                startGame();
                score = 777;
                endGame();
                return localStorage.getItem('keeper-of-the-garden-best');
            });
            expect(stored).toBe('777');
            await expect(page.locator('#best')).toHaveText('777');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            const stored = await page.evaluate(() => {
                localStorage.setItem('keeper-of-the-garden-best', '900');
                startGame();
                score = 100;
                endGame();
                return localStorage.getItem('keeper-of-the-garden-best');
            });
            expect(stored).toBe('900');
        });

        test('starting again after a game over resets the garden', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 500;
                level = 4;
                endGame();
                startGame();
                return { state, score, lives, level, segments: segmentCount() };
            });
            expect(r.state).toBe('running');
            expect(r.score).toBe(0);
            expect(r.lives).toBe(3);
            expect(r.level).toBe(1);
            expect(r.segments).toBeGreaterThanOrEqual(10);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                endGame();
                endGame();
                endGame();
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -------------------------------------------------------------------
    // Playing through
    // -------------------------------------------------------------------
    test.describe('playing through', () => {
        test('a long run of steps raises no errors and keeps the world valid', async ({ page }) => {
            const r = await page.evaluate(() => {
                setSeed(3);
                startGame();
                keys.spray = true;
                for (let i = 0; i < 1200; i++) {
                    if (i % 97 === 0) keys.right = !keys.right;
                    if (i % 53 === 0) keys.left = !keys.left;
                    step(16);
                    if (state !== 'running') startGame();
                }
                const cells = caterpillars.flatMap((c) => c.cells);
                return {
                    inGrid: cells.every((s) => s.col >= -COLS && s.col < COLS + 1 && s.row >= 0 && s.row < ROWS),
                    noEmptyCats: caterpillars.every((c) => c.cells.length > 0),
                    drops: drops.length <= MAX_DROPS,
                    playerIn: player.x >= 0 && player.x <= WIDTH && player.y >= PLAYER_TOP_ROW * CELL,
                    score: score >= 0,
                };
            });
            expect(r).toEqual({ inGrid: true, noEmptyCats: true, drops: true, playerIn: true, score: true });
            expect(errors).toEqual([]);
        });

        test('the animation loop runs on its own', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await page.evaluate(async () => {
                const before = caterpillars[0].cells[0].col;
                resumeLoop();
                await new Promise((res) => setTimeout(res, 400));
                return { before, after: caterpillars[0].cells[0].col, state };
            });
            expect(r.state).toBe('running');
            expect(r.after).not.toBe(r.before);
            expect(errors).toEqual([]);
        });

        test('the canvas is actually painted', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => resumeLoop());
            await page.waitForTimeout(200);
            const painted = await page.evaluate(() => {
                const d = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
                let lit = 0;
                for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
                return lit;
            });
            expect(painted).toBeGreaterThan(500);
        });

        test('no console errors on load', async ({ page }) => {
            await page.waitForTimeout(150);
            expect(errors).toEqual([]);
        });
    });
});
