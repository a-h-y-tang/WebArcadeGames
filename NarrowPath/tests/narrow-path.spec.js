const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// The page's own requestAnimationFrame loop is switched off in every spec so
// the simulation only moves when a spec moves it; `advance` is the only clock.
const quiet = (page) => page.evaluate(() => { simulate = false; });

const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => { for (let i = 0; i < f; i++) step(d); }, [frames, dt]);

const run = (page) => page.evaluate(() => { startGame(); });

// Roll with the board held at a fixed lean. The tilt is re-applied every  frame
// because `step` springs an unheld board back to level, exactly as it does for
// a player who lets go of the key.
const roll = (page, tx, ty, frames, dt = 1 / 60) =>
    page.evaluate(([tx, ty, f, d]) => {
        for (let i = 0; i < f; i++) { tilt.x = tx; tilt.y = ty; step(d); }
    }, [tx, ty, frames, dt]);

// Put the stone on a cell centre (or an arbitrary point) at rest.
const placeCell = (page, col, row, vx = 0, vy = 0) =>
    page.evaluate(([c, r, vx, vy]) => {
        const p = cellCentre(c, r);
        ball.x = p.x; ball.y = p.y; ball.vx = vx; ball.vy = vy;
    }, [col, row, vx, vy]);

const placeAt = (page, x, y, vx = 0, vy = 0) =>
    page.evaluate(([x, y, vx, vy]) => {
        ball.x = x; ball.y = y; ball.vx = vx; ball.vy = vy;
    }, [x, y, vx, vy]);

// Gather every waymark on the board the honest way: roll the stone onto each.
const gatherAll = (page) =>
    page.evaluate(() => {
        for (const w of waymarks) {
            ball.x = w.x; ball.y = w.y; ball.vx = 0; ball.vy = 0;
            step(1 / 60);
        }
    });

const snapshot = (page) =>
    page.evaluate(() => ({
        state, level, lives, score, elapsed, waymarksLeft, gateOpen,
        ball: { ...ball }, tilt: { ...tilt },
    }));

test.describe('The Narrow Path', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await quiet(page);
    });

    // -----------------------------------------------------------------------
    // Page, board and theme
    // -----------------------------------------------------------------------
    test.describe('page and board', () => {
        test('page title is The Narrow Path', async ({ page }) => {
            await expect(page).toHaveTitle('The Narrow Path');
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('the grid of cells fills the canvas exactly', async ({ page }) => {
            expect(await page.evaluate(() => [COLS * CELL, ROWS * CELL]))
                .toEqual([640, 480]);
        });

        test('the title screen quotes Matthew 7:14', async ({ page }) => {
            await expect(page.locator('#verse')).toContainText('Matthew 7:14');
        });

        test('the rules explain waymarks, ditches and the gate', async ({ page }) => {
            const rules = page.locator('#rules');
            await expect(rules).toContainText(/waymark/i);
            await expect(rules).toContainText(/ditch/i);
            await expect(rules).toContainText(/gate/i);
        });

        test('there are four stages, each with a name and a par time', async ({ page }) => {
            const stages = await page.evaluate(() => LEVELS.map((l) => [l.name, l.par]));
            expect(stages.length).toBe(4);
            for (const [name, par] of stages) {
                expect(name.length).toBeGreaterThan(3);
                expect(par).toBeGreaterThan(0);
            }
        });

        test('cellCentre puts a cell in the middle of its square', async ({ page }) => {
            expect(await page.evaluate(() => cellCentre(0, 0))).toEqual({ x: 20, y: 20 });
            expect(await page.evaluate(() => cellCentre(15, 11))).toEqual({ x: 620, y: 460 });
        });
    });

    // -----------------------------------------------------------------------
    // Stage layouts
    // -----------------------------------------------------------------------
    test.describe('stage layouts', () => {
        test('every layout is 12 rows of 16 characters', async ({ page }) => {
            const bad = await page.evaluate(() =>
                LEVELS.filter((l) => l.rows.length !== ROWS ||
                    l.rows.some((r) => r.length !== COLS)).map((l) => l.name));
            expect(bad).toEqual([]);
        });

        test('every layout uses only the known characters', async ({ page }) => {
            const bad = await page.evaluate(() =>
                LEVELS.filter((l) => l.rows.join('').split('')
                    .some((ch) => !'#.So*G'.includes(ch))).map((l) => l.name));
            expect(bad).toEqual([]);
        });

        test('a wall rim runs all the way round every stage', async ({ page }) => {
            const bad = await page.evaluate(() => {
                const out = [];
                LEVELS.forEach((l, i) => {
                    buildLevel(i);
                    for (let c = 0; c < COLS; c++)
                        if (!isWall(c, 0) || !isWall(c, ROWS - 1)) out.push(l.name);
                    for (let r = 0; r < ROWS; r++)
                        if (!isWall(0, r) || !isWall(COLS - 1, r)) out.push(l.name);
                });
                return [...new Set(out)];
            });
            expect(bad).toEqual([]);
        });

        test('every stage has one start, one gate, waymarks and ditches', async ({ page }) => {
            const counts = await page.evaluate(() =>
                LEVELS.map((l, i) => {
                    buildLevel(i);
                    const chars = l.rows.join('');
                    return {
                        name: l.name,
                        starts: chars.split('S').length - 1,
                        gates: chars.split('G').length - 1,
                        waymarks: waymarks.length,
                        pits: pits.length,
                    };
                }));
            for (const c of counts) {
                expect(c.starts, c.name).toBe(1);
                expect(c.gates, c.name).toBe(1);
                expect(c.waymarks, c.name).toBeGreaterThanOrEqual(3);
                expect(c.pits, c.name).toBeGreaterThanOrEqual(2);
            }
        });

        test('the stages grow harder: no stage has fewer ditches than the one before', async ({ page }) => {
            const pitCounts = await page.evaluate(() =>
                LEVELS.map((l, i) => { buildLevel(i); return pits.length; }));
            for (let i = 1; i < pitCounts.length; i++)
                expect(pitCounts[i]).toBeGreaterThanOrEqual(pitCounts[i - 1]);
        });

        test('the gate and every waymark can be reached without crossing a ditch', async ({ page }) => {
            const unreachable = await page.evaluate(() => {
                const out = [];
                LEVELS.forEach((l, i) => {
                    buildLevel(i);
                    const open = reachableCells(i);
                    const key = (c) => `${c.col},${c.row}`;
                    if (!open.has(key(gateCell))) out.push(`${l.name}: gate`);
                    for (const w of waymarks)
                        if (!open.has(key(w))) out.push(`${l.name}: waymark ${key(w)}`);
                });
                return out;
            });
            expect(unreachable).toEqual([]);
        });

        test('the start, the gate and every waymark sit on open floor', async ({ page }) => {
            const bad = await page.evaluate(() => {
                const out = [];
                LEVELS.forEach((l, i) => {
                    buildLevel(i);
                    const cells = [startCell, gateCell, ...waymarks];
                    for (const c of cells)
                        if (isWall(c.col, c.row)) out.push(`${l.name}: ${c.col},${c.row}`);
                });
                return out;
            });
            expect(bad).toEqual([]);
        });

        test('no ditch sits on top of the start or the gate', async ({ page }) => {
            const bad = await page.evaluate(() => {
                const out = [];
                LEVELS.forEach((l, i) => {
                    buildLevel(i);
                    for (const p of pits) {
                        if (p.col === startCell.col && p.row === startCell.row) out.push(`${l.name}: start`);
                        if (p.col === gateCell.col && p.row === gateCell.row) out.push(`${l.name}: gate`);
                    }
                });
                return out;
            });
            expect(bad).toEqual([]);
        });

        test('the stone starts on the start cell, at rest, with no tilt', async ({ page }) => {
            const s = await snapshot(page);
            const want = await page.evaluate(() => cellCentre(startCell.col, startCell.row));
            expect(s.ball.x).toBeCloseTo(want.x, 5);
            expect(s.ball.y).toBeCloseTo(want.y, 5);
            expect([s.ball.vx, s.ball.vy, s.tilt.x, s.tilt.y]).toEqual([0, 0, 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Idle state
    // -----------------------------------------------------------------------
    test.describe('before the run starts', () => {
        test('state is idle and the overlay invites the player in', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/narrow path/i);
            await expect(page.locator('#overlay-hint')).toContainText(/space|start/i);
        });

        test('the HUD shows three journeys, no score and the first stage', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#stage')).toHaveText(await page.evaluate(() => LEVELS[0].name));
            await expect(page.locator('#waymarks')).toHaveText(
                String(await page.evaluate(() => waymarks.length)));
        });

        test('the stone does not move while the board is idle', async ({ page }) => {
            const before = await snapshot(page);
            await page.evaluate(() => { tilt.x = 1; tilt.y = 1; });
            await advance(page, 60);
            const after = await snapshot(page);
            expect([after.ball.x, after.ball.y]).toEqual([before.ball.x, before.ball.y]);
        });

        test('the best score is loaded from localStorage', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('narrow-path-best', '4321'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4321');
        });
    });

    // -----------------------------------------------------------------------
    // Tilt
    // -----------------------------------------------------------------------
    test.describe('tilting the board', () => {
        test.beforeEach(async ({ page }) => {
            await run(page);
        });

        test('holding right tilts the board to the right', async ({ page }) => {
            await page.keyboard.down('ArrowRight');
            await page.waitForFunction(() => tiltTarget().x === 1);
            await advance(page, 10);
            expect((await snapshot(page)).tilt.x).toBeGreaterThan(0);
            await page.keyboard.up('ArrowRight');
        });

        test('tilt never passes the maximum', async ({ page }) => {
            await page.keyboard.down('ArrowRight');
            await page.keyboard.down('ArrowDown');
            await page.waitForFunction(() => tiltTarget().x === 1 && tiltTarget().y === 1);
            await advance(page, 600);
            const t = (await snapshot(page)).tilt;
            const max = await page.evaluate(() => TILT_MAX);
            expect(t.x).toBeCloseTo(max, 5);
            expect(t.y).toBeCloseTo(max, 5);
            await page.keyboard.up('ArrowRight');
            await page.keyboard.up('ArrowDown');
        });

        test('letting go levels the board again', async ({ page }) => {
            await page.keyboard.down('ArrowLeft');
            await page.waitForFunction(() => tiltTarget().x === -1);
            await advance(page, 60);
            expect((await snapshot(page)).tilt.x).toBeLessThan(0);
            await page.keyboard.up('ArrowLeft');
            await page.waitForFunction(() => tiltTarget().x === 0);
            await advance(page, 120);
            expect((await snapshot(page)).tilt.x).toBeCloseTo(0, 5);
        });

        test('opposite keys cancel each other out', async ({ page }) => {
            await page.keyboard.down('ArrowLeft');
            await page.keyboard.down('ArrowRight');
            await page.waitForFunction(() => tiltTarget().x === 0);
            await page.keyboard.up('ArrowLeft');
            await page.keyboard.up('ArrowRight');
        });

        test('WASD tilts the board like the arrow keys', async ({ page }) => {
            await page.keyboard.down('w');
            await page.waitForFunction(() => tiltTarget().y === -1);
            await page.keyboard.up('w');
            await page.keyboard.down('d');
            await page.waitForFunction(() => tiltTarget().x === 1);
            await page.keyboard.up('d');
        });

        test('holding the pointer on the right of the board tilts that way', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2);
            await page.mouse.down();
            await page.waitForFunction(() => tiltTarget().x > 0.5);
            await page.mouse.up();
            await page.waitForFunction(() => tiltTarget().x === 0);
        });
    });

    // -----------------------------------------------------------------------
    // Rolling
    // -----------------------------------------------------------------------
    test.describe('rolling the stone', () => {
        test.beforeEach(async ({ page }) => {
            await run(page);
        });

        test('a tilt to the right rolls the stone to the right', async ({ page }) => {
            const before = await snapshot(page);
            await roll(page, 1, 0, 20);
            const after = await snapshot(page);
            expect(after.ball.vx).toBeGreaterThan(0);
            expect(after.ball.x).toBeGreaterThan(before.ball.x);
        });

        test('a level board lets friction bring the stone to a stop', async ({ page }) => {
            await placeCell(page, 2, 2, 200, 0);
            await page.evaluate(() => { tilt.x = 0; tilt.y = 0; });
            await advance(page, 600);
            const s = await snapshot(page);
            expect(Math.hypot(s.ball.vx, s.ball.vy)).toBeLessThan(5);
        });

        test('the stone never rolls faster than the speed cap', async ({ page }) => {
            const top = await page.evaluate(() => {
                let max = 0;
                for (let i = 0; i < 1200; i++) {
                    tilt.x = 1; tilt.y = 1;
                    step(1 / 60);
                    max = Math.max(max, Math.hypot(ball.vx, ball.vy));
                }
                return max;
            });
            expect(top).toBeLessThanOrEqual(await page.evaluate(() => MAX_SPEED) + 0.001);
        });

        test('the stone bounces back off a wall, slower than it arrived', async ({ page }) => {
            // The rim is a wall, so a stone shoved left from the second column
            // must come back.
            await placeCell(page, 1, 1, -220, 0);
            await page.evaluate(() => { tilt.x = 0; tilt.y = 0; });
            await advance(page, 30);
            const s = await snapshot(page);
            expect(s.ball.vx).toBeGreaterThan(0);
            expect(s.ball.vx).toBeLessThan(220);
        });

        test('a stone pressed into the rim never leaves the board', async ({ page }) => {
            await roll(page, -1, -1, 900);
            const inside = await page.evaluate(() =>
                ball.x >= BALL_R && ball.y >= BALL_R &&
                ball.x <= COLS * CELL - BALL_R && ball.y <= ROWS * CELL - BALL_R);
            expect(inside).toBe(true);
        });

        test('the stone never ends a frame overlapping a wall', async ({ page }) => {
            // Drive it hard round the board in every direction in turn and check
            // after every single frame.
            const stuck = await page.evaluate(() => {
                const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
                for (const [tx, ty] of dirs) {
                    for (let i = 0; i < 240; i++) {
                        tilt.x = tx; tilt.y = ty;
                        step(1 / 60);
                        if (state !== 'running') { startStage(level); state = 'running'; continue; }
                        if (overlapsWall(ball.x, ball.y, BALL_R - 0.5)) return { x: ball.x, y: ball.y };
                    }
                }
                return null;
            });
            expect(stuck).toBeNull();
        });

        test('a stone can squeeze along a one-cell corridor without sticking', async ({ page }) => {
            // Stage four's fifth column is a one-cell-wide corridor.
            const travelled = await page.evaluate(() => {
                startStage(3);
                state = 'running';
                const p = cellCentre(5, 1);
                ball.x = p.x; ball.y = p.y; ball.vx = 0; ball.vy = 0;
                const from = ball.y;
                for (let i = 0; i < 180; i++) { tilt.x = 0; tilt.y = 1; step(1 / 60); }
                return ball.y - from;
            });
            expect(travelled).toBeGreaterThan(120);
        });
    });

    // -----------------------------------------------------------------------
    // Waymarks
    // -----------------------------------------------------------------------
    test.describe('gathering waymarks', () => {
        test.beforeEach(async ({ page }) => {
            await run(page);
        });

        test('rolling onto a waymark gathers it and scores', async ({ page }) => {
            const before = await snapshot(page);
            await page.evaluate(() => {
                const w = waymarks[0];
                ball.x = w.x; ball.y = w.y; ball.vx = 0; ball.vy = 0;
            });
            await advance(page, 1);
            const after = await snapshot(page);
            expect(after.waymarksLeft).toBe(before.waymarksLeft - 1);
            expect(after.score).toBe(before.score + (await page.evaluate(() => WAYMARK_POINTS)));
            expect(await page.evaluate(() => waymarks[0].taken)).toBe(true);
        });

        test('a waymark is only worth points once', async ({ page }) => {
            await page.evaluate(() => {
                const w = waymarks[0];
                ball.x = w.x; ball.y = w.y; ball.vx = 0; ball.vy = 0;
            });
            await advance(page, 30);
            const s = await snapshot(page);
            expect(s.score).toBe(await page.evaluate(() => WAYMARK_POINTS));
            expect(s.waymarksLeft).toBe(await page.evaluate(() => waymarks.length - 1));
        });

        test("a waymark a stone's width away is not gathered", async ({ page }) => {
            await page.evaluate(() => {
                const w = waymarks[0];
                ball.x = w.x + WAYMARK_R + BALL_R + 6; ball.y = w.y; ball.vx = 0; ball.vy = 0;
            });
            await advance(page, 1);
            expect((await snapshot(page)).waymarksLeft)
                .toBe(await page.evaluate(() => waymarks.length));
        });

        test('gathering the last waymark opens the gate', async ({ page }) => {
            expect((await snapshot(page)).gateOpen).toBe(false);
            await gatherAll(page);
            const s = await snapshot(page);
            expect(s.waymarksLeft).toBe(0);
            expect(s.gateOpen).toBe(true);
        });

        test('the HUD counts the waymarks still out there', async ({ page }) => {
            await page.evaluate(() => {
                const w = waymarks[0];
                ball.x = w.x; ball.y = w.y; ball.vx = 0; ball.vy = 0;
            });
            await advance(page, 1);
            await expect(page.locator('#waymarks'))
                .toHaveText(String(await page.evaluate(() => waymarks.length - 1)));
        });
    });

    // -----------------------------------------------------------------------
    // Ditches
    // -----------------------------------------------------------------------
    test.describe('falling into a ditch', () => {
        test.beforeEach(async ({ page }) => {
            await run(page);
        });

        test('rolling over a ditch costs a journey', async ({ page }) => {
            await page.evaluate(() => {
                const p = pits[0];
                ball.x = p.x; ball.y = p.y; ball.vx = 0; ball.vy = 0;
            });
            await advance(page, 1);
            const s = await snapshot(page);
            expect(s.state).toBe('dying');
            expect(s.lives).toBe(2);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('grazing the lip of a ditch is safe', async ({ page }) => {
            await page.evaluate(() => {
                const p = pits[0];
                ball.x = p.x + PIT_R + 1; ball.y = p.y; ball.vx = 0; ball.vy = 0;
            });
            await advance(page, 1);
            expect((await snapshot(page)).state).toBe('running');
        });

        test('after the fall the stone is set back at the start of the stage', async ({ page }) => {
            await page.evaluate(() => {
                const p = pits[0];
                ball.x = p.x; ball.y = p.y; ball.vx = 180; ball.vy = 0;
            });
            await advance(page, 1);
            await advance(page, 240);
            const s = await snapshot(page);
            const start = await page.evaluate(() => cellCentre(startCell.col, startCell.row));
            expect(s.state).toBe('running');
            expect(s.ball.x).toBeCloseTo(start.x, 5);
            expect(s.ball.y).toBeCloseTo(start.y, 5);
            expect([s.ball.vx, s.ball.vy]).toEqual([0, 0]);
        });

        test('waymarks already gathered stay gathered after a fall', async ({ page }) => {
            await page.evaluate(() => {
                const w = waymarks[0];
                ball.x = w.x; ball.y = w.y; ball.vx = 0; ball.vy = 0;
            });
            await advance(page, 1);
            await page.evaluate(() => {
                const p = pits[0];
                ball.x = p.x; ball.y = p.y; ball.vx = 0; ball.vy = 0;
            });
            await advance(page, 240);
            const s = await snapshot(page);
            expect(s.waymarksLeft).toBe(await page.evaluate(() => waymarks.length - 1));
            expect(s.score).toBe(await page.evaluate(() => WAYMARK_POINTS));
        });

        test('the tilt is levelled out while the stone is replaced', async ({ page }) => {
            await page.evaluate(() => {
                tilt.x = 1; tilt.y = 1;
                const p = pits[0];
                ball.x = p.x; ball.y = p.y;
            });
            await advance(page, 1);
            const t = (await snapshot(page)).tilt;
            expect([t.x, t.y]).toEqual([0, 0]);
        });

        test('losing the last journey ends the run', async ({ page }) => {
            await page.evaluate(() => { lives = 1; });
            await page.evaluate(() => {
                const p = pits[0];
                ball.x = p.x; ball.y = p.y;
            });
            await advance(page, 1);
            const s = await snapshot(page);
            expect(s.state).toBe('over');
            expect(s.lives).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the run is over for good: the stone stays put', async ({ page }) => {
            await page.evaluate(() => { lives = 1; const p = pits[0]; ball.x = p.x; ball.y = p.y; });
            await advance(page, 1);
            const before = await snapshot(page);
            await roll(page, 1, 1, 120);
            const after = await snapshot(page);
            expect([after.ball.x, after.ball.y]).toEqual([before.ball.x, before.ball.y]);
        });

        test('a best score is kept when the run ends', async ({ page }) => {
            await page.evaluate(() => {
                const w = waymarks[0];
                ball.x = w.x; ball.y = w.y;
            });
            await advance(page, 1);
            await page.evaluate(() => { lives = 1; const p = pits[0]; ball.x = p.x; ball.y = p.y; });
            await advance(page, 1);
            const best = await page.evaluate(() => localStorage.getItem('narrow-path-best'));
            expect(Number(best)).toBe(await page.evaluate(() => WAYMARK_POINTS));
            await expect(page.locator('#best')).toHaveText(String(await page.evaluate(() => WAYMARK_POINTS)));
        });
    });

    // -----------------------------------------------------------------------
    // The gate and the stages
    // -----------------------------------------------------------------------
    test.describe('the narrow gate', () => {
        test.beforeEach(async ({ page }) => {
            await run(page);
        });

        test('the gate does nothing while waymarks are still out there', async ({ page }) => {
            await page.evaluate(() => {
                const p = cellCentre(gateCell.col, gateCell.row);
                ball.x = p.x; ball.y = p.y; ball.vx = 0; ball.vy = 0;
            });
            await advance(page, 30);
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.level).toBe(0);
            await expect(page.locator('#status')).toContainText(/waymark/i);
        });

        test('reaching the open gate clears the stage', async ({ page }) => {
            await gatherAll(page);
            await page.evaluate(() => {
                const p = cellCentre(gateCell.col, gateCell.row);
                ball.x = p.x; ball.y = p.y; ball.vx = 0; ball.vy = 0;
            });
            await advance(page, 1);
            expect((await snapshot(page)).state).toBe('stageclear');
            await expect(page.locator('#overlay-title')).toContainText(/stage|gate|complete/i);
        });

        test('clearing a stage pays the stage bonus and a bonus for the time left', async ({ page }) => {
            const before = await page.evaluate(() => {
                for (const w of waymarks) { ball.x = w.x; ball.y = w.y; step(1 / 60); }
                elapsed = 10;
                return { score, expected: stageBonus(level, 10) };
            });
            await page.evaluate(() => {
                const p = cellCentre(gateCell.col, gateCell.row);
                ball.x = p.x; ball.y = p.y; ball.vx = 0; ball.vy = 0;
            });
            await advance(page, 1);
            expect((await snapshot(page)).score).toBe(before.score + before.expected);
        });

        test('a quick stage is worth more than a slow one', async ({ page }) => {
            const [quick, slow, late] = await page.evaluate(() =>
                [stageBonus(0, 1), stageBonus(0, LEVELS[0].par - 1), stageBonus(0, LEVELS[0].par + 99)]);
            expect(quick).toBeGreaterThan(slow);
            expect(late).toBe(await page.evaluate(() => STAGE_POINTS));
        });

        test('after the pause the next stage is set up from the top', async ({ page }) => {
            await gatherAll(page);
            await page.evaluate(() => {
                const p = cellCentre(gateCell.col, gateCell.row);
                ball.x = p.x; ball.y = p.y;
            });
            await advance(page, 1);
            await advance(page, 110);
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.level).toBe(1);
            expect(s.waymarksLeft).toBe(await page.evaluate(() => waymarks.length));
            expect(s.gateOpen).toBe(false);
            expect(s.elapsed).toBeLessThan(1);
            const start = await page.evaluate(() => cellCentre(startCell.col, startCell.row));
            expect([s.ball.x, s.ball.y]).toEqual([start.x, start.y]);
            await expect(page.locator('#stage')).toHaveText(await page.evaluate(() => LEVELS[1].name));
        });

        test('journeys and score carry over to the next stage', async ({ page }) => {
            await page.evaluate(() => { lives = 2; });
            await gatherAll(page);
            await page.evaluate(() => {
                const p = cellCentre(gateCell.col, gateCell.row);
                ball.x = p.x; ball.y = p.y;
            });
            await advance(page, 301);
            const s = await snapshot(page);
            expect(s.lives).toBe(2);
            expect(s.score).toBeGreaterThan(0);
        });

        test('clearing the last stage finishes the whole path', async ({ page }) => {
            await page.evaluate(() => { startStage(LEVELS.length - 1); state = 'running'; });
            await gatherAll(page);
            await page.evaluate(() => {
                const p = cellCentre(gateCell.col, gateCell.row);
                ball.x = p.x; ball.y = p.y;
            });
            await advance(page, 1);
            await advance(page, 300);
            expect((await snapshot(page)).state).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/finish|complete|well done|path/i);
        });
    });

    // -----------------------------------------------------------------------
    // Clock
    // -----------------------------------------------------------------------
    test.describe('the clock', () => {
        test('time counts up while the stone is rolling', async ({ page }) => {
            await run(page);
            await advance(page, 120);
            const s = await snapshot(page);
            expect(s.elapsed).toBeGreaterThan(1.9);
            expect(s.elapsed).toBeLessThan(2.1);
            await expect(page.locator('#time')).toHaveText('2');
        });

        test('time stands still while the game is paused', async ({ page }) => {
            await run(page);
            await advance(page, 60);
            await page.evaluate(() => togglePause());
            const before = (await snapshot(page)).elapsed;
            await advance(page, 120);
            expect((await snapshot(page)).elapsed).toBeCloseTo(before, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Controls
    // -----------------------------------------------------------------------
    test.describe('controls', () => {
        test('Space starts the run from the title screen', async ({ page }) => {
            await page.keyboard.press('Space');
            expect((await snapshot(page)).state).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Enter starts the run too', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect((await snapshot(page)).state).toBe('running');
        });

        test('the Start button starts the run', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect((await snapshot(page)).state).toBe('running');
        });

        test('P pauses and unpauses, and the stone holds still', async ({ page }) => {
            await run(page);
            await placeCell(page, 2, 2, 150, 0);
            await page.keyboard.press('p');
            expect((await snapshot(page)).state).toBe('paused');
            const before = await snapshot(page);
            await advance(page, 120);
            const during = await snapshot(page);
            expect([during.ball.x, during.ball.y]).toEqual([before.ball.x, before.ball.y]);
            await page.keyboard.press('p');
            expect((await snapshot(page)).state).toBe('running');
            await roll(page, 1, 0, 30);
            expect((await snapshot(page)).ball.x).toBeGreaterThan(before.ball.x);
        });

        test('the Pause button pauses the run', async ({ page }) => {
            await run(page);
            await page.locator('#btn-pause').click();
            expect((await snapshot(page)).state).toBe('paused');
        });

        test('Space carries on from a pause', async ({ page }) => {
            await run(page);
            await page.evaluate(() => togglePause());
            await page.keyboard.press('Space');
            expect((await snapshot(page)).state).toBe('running');
        });

        test('R starts the whole run again', async ({ page }) => {
            await run(page);
            await page.evaluate(() => {
                score = 900; lives = 1; startStage(2); state = 'running';
            });
            await page.keyboard.press('r');
            const s = await snapshot(page);
            expect(s).toMatchObject({ state: 'running', score: 0, lives: 3, level: 0 });
        });

        test('Space plays again once the run is over', async ({ page }) => {
            await run(page);
            await page.evaluate(() => { lives = 1; const p = pits[0]; ball.x = p.x; ball.y = p.y; });
            await advance(page, 1);
            expect((await snapshot(page)).state).toBe('over');
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s).toMatchObject({ state: 'running', score: 0, lives: 3, level: 0 });
        });

        test('Space plays again once the path is finished', async ({ page }) => {
            await run(page);
            await page.evaluate(() => { state = 'won'; });
            await page.keyboard.press('Space');
            expect((await snapshot(page)).state).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Drawing
    // -----------------------------------------------------------------------
    test.describe('drawing', () => {
        test('the board, the stone and the furniture are drawn', async ({ page }) => {
            const colours = await page.evaluate(() => {
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4)
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                return seen.size;
            });
            expect(colours).toBeGreaterThan(5);
        });

        test('the stone is drawn where the stone is', async ({ page }) => {
            await run(page);
            const moved = await page.evaluate(() => {
                const ctx = canvas.getContext('2d');
                const sample = () => {
                    const p = cellCentre(startCell.col, startCell.row);
                    const d = ctx.getImageData(p.x - 2, p.y - 2, 4, 4).data;
                    return [...d].join(',');
                };
                draw();
                const before = sample();
                ball.x += CELL * 3;
                draw();
                return before !== sample();
            });
            expect(moved).toBe(true);
        });

        test('a gathered waymark stops being drawn', async ({ page }) => {
            await run(page);
            const changed = await page.evaluate(() => {
                const ctx = canvas.getContext('2d');
                const w = waymarks[0];
                const sample = () => [...ctx.getImageData(w.x - 3, w.y - 3, 6, 6).data].join(',');
                draw();
                const before = sample();
                ball.x = w.x; ball.y = w.y;
                step(1 / 60);
                ball.x = cellCentre(startCell.col, startCell.row).x;
                ball.y = cellCentre(startCell.col, startCell.row).y;
                draw();
                return before !== sample();
            });
            expect(changed).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Playability: every stage has to be finishable without falling in, or the
    // board is unfair however pretty it looks. A cautious autopilot steers the
    // stone cell by cell along a route that avoids the ditches and has to
    // gather every waymark and reach the gate.
    // -----------------------------------------------------------------------
    test.describe('playability', () => {
        test('a careful pilgrim can finish every stage without falling in', async ({ page }) => {
            test.setTimeout(60_000);
            const report = await page.evaluate(() => {
                const key = (c) => `${c.col},${c.row}`;
                const blocked = (col, row) => isWall(col, row) ||
                    pits.some((p) => p.col === col && p.row === row);

                function route(from, to) {
                    const prev = new Map([[key(from), null]]);
                    const queue = [from];
                    while (queue.length) {
                        const cur = queue.shift();
                        if (cur.col === to.col && cur.row === to.row) break;
                        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                            const n = { col: cur.col + dc, row: cur.row + dr };
                            if (blocked(n.col, n.row) || prev.has(key(n))) continue;
                            prev.set(key(n), cur);
                            queue.push(n);
                        }
                    }
                    if (!prev.has(key(to))) return null;
                    const out = [];
                    for (let c = to; c; c = prev.get(key(c))) out.push(c);
                    return out.reverse();
                }

                const out = [];
                for (let i = 0; i < LEVELS.length; i++) {
                    startStage(i);
                    state = 'running';
                    let frames = 0, falls = 0, stuck = false;

                    // Nearest waymark first, then the gate.
                    const stops = [];
                    let at = { ...startCell };
                    const todo = [...waymarks];
                    while (todo.length) {
                        todo.sort((a, b) =>
                            (Math.abs(a.col - at.col) + Math.abs(a.row - at.row)) -
                            (Math.abs(b.col - at.col) + Math.abs(b.row - at.row)));
                        at = todo.shift();
                        stops.push(at);
                    }
                    stops.push(gateCell);

                    for (const target of stops) {
                        let cell = { col: Math.floor(ball.x / CELL), row: Math.floor(ball.y / CELL) };
                        let path = route(cell, target);
                        if (!path) { stuck = true; break; }
                        let hop = 1, guard = 0;
                        while (hop < path.length && guard++ < 4000) {
                            const want = cellCentre(path[hop].col, path[hop].row);
                            const dx = want.x - ball.x, dy = want.y - ball.y;
                            const dist = Math.hypot(dx, dy);
                            if (dist < 5) { hop++; continue; }
                            const brake = Math.min(1, dist / 45);
                            const clamp = (v) => Math.max(-1, Math.min(1, v));
                            tilt.x = clamp((dx / 20) * brake - ball.vx / 70);
                            tilt.y = clamp((dy / 20) * brake - ball.vy / 70);
                            step(1 / 60);
                            frames++;
                            if (state === 'dying') {
                                falls++;
                                for (let k = 0; k < 90; k++) step(1 / 60);
                                if (state !== 'running') { state = 'running'; lives = 3; }
                                cell = { col: Math.floor(ball.x / CELL), row: Math.floor(ball.y / CELL) };
                                path = route(cell, target) || path;
                                hop = 1;
                            }
                            if (state === 'stageclear' || state === 'won') break;
                        }
                        if (guard >= 4000) { stuck = true; break; }
                        if (state === 'stageclear' || state === 'won') break;
                    }
                    out.push({
                        stage: LEVELS[i].name,
                        cleared: state === 'stageclear' || state === 'won',
                        falls, stuck, waymarksLeft, seconds: frames / 60,
                    });
                }
                return out;
            });

            for (const r of report) {
                expect(r.stuck, `${r.stage} left the pilgrim stuck`).toBe(false);
                expect(r.falls, `${r.stage} forced a fall`).toBe(0);
                expect(r.waymarksLeft, `${r.stage} kept a waymark out of reach`).toBe(0);
                expect(r.cleared, `${r.stage} was not cleared`).toBe(true);
            }
        });

        test('the par times leave room for a brisk run', async ({ page }) => {
            const pars = await page.evaluate(() => LEVELS.map((l) => l.par));
            // A cell-by-cell autopilot takes 40-85s; par must beat that only for
            // a player who keeps the stone moving.
            expect(Math.min(...pars)).toBeGreaterThanOrEqual(40);
        });
    });
});
