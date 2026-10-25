const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start a level and freeze the animation loop so a test can place the marker
// itself and advance the simulation one deterministic step at a time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
    });
}

// Clear the threats out of the way and park the Qix in a far corner of the open
// area, so a test can drive the marker without anything interrupting it.
async function isolate(page) {
    await page.evaluate(() => {
        sparx.length = 0;
        setQix(53.5 * CELL, 55.5 * CELL, 57.5 * CELL, 55.5 * CELL);
    });
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) stepGame(DT);
    }, steps);
}

// Put the marker on a lattice point with no line in progress.
async function place(page, px, py) {
    await page.evaluate(([x, y]) => setPlayerAt(x, y), [px, py]);
}

// Walk a list of [dx, dy] lattice steps, returning whether each was accepted.
async function walk(page, dirs) {
    return page.evaluate((list) => list.map(([dx, dy]) => tryStep(dx, dy)), dirs);
}

// Claim the whole grid, then carve one open rectangle of cells out of it, so a
// claim can be set up with a known shape and a known answer.
async function openOnly(page, x0, x1, y0, y1) {
    await page.evaluate(([ax, bx, ay, by]) => {
        for (let x = 0; x < GRID_W; x++) {
            for (let y = 0; y < GRID_H; y++) setClaimed(x, y, true);
        }
        for (let x = ax; x <= bx; x++) {
            for (let y = ay; y <= by; y++) setClaimed(x, y, false);
        }
        recountClaimed();
    }, [x0, x1, y0, y1]);
}

const FRAME_CELLS = 236; // the one-cell border of a 60x60 grid

test.describe('Qix', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Qix', async ({ page }) => {
            await expect(page).toHaveTitle('Qix');
        });

        test('canvas is 600x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('the grid matches the canvas', async ({ page }) => {
            const dims = await page.evaluate(() => ({
                w: GRID_W * CELL,
                h: GRID_H * CELL,
                cw: W,
                ch: H,
            }));
            expect(dims.w).toBe(dims.cw);
            expect(dims.h).toBe(dims.ch);
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('qix-best', '48250'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('48250');
        });

        test('the help legend explains moving, drawing and the target', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/move/i);
            await expect(page.locator('.help')).toContainText(/draw/i);
            await expect(page.locator('.help')).toContainText(/75%/);
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

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('clicking the board starts the game', async ({ page }) => {
            await page.locator('#overlay').click({ position: { x: 300, y: 60 } });
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the border frame starts claimed and the middle open', async ({ page }) => {
            await startFrozen(page);
            const g = await page.evaluate(() => ({
                topLeft: isClaimed(0, 0),
                topMid: isClaimed(30, 0),
                bottomRight: isClaimed(GRID_W - 1, GRID_H - 1),
                inner: isClaimed(1, 1),
                middle: isClaimed(30, 30),
            }));
            expect(g.topLeft).toBe(true);
            expect(g.topMid).toBe(true);
            expect(g.bottomRight).toBe(true);
            expect(g.inner).toBe(false);
            expect(g.middle).toBe(false);
        });

        test('only the frame is claimed at the start', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => claimedCells)).toBe(FRAME_CELLS);
        });

        test('the HUD reports the claimed percentage', async ({ page }) => {
            await startFrozen(page);
            await expect(page.locator('#claimed')).toHaveText('6%');
        });

        test('the marker starts on the boundary with no line drawn', async ({ page }) => {
            await startFrozen(page);
            const p = await page.evaluate(() => ({
                boundary: isBoundaryPoint(player.px, player.py),
                drawing,
                stix: stix.length,
                moving: player.moving,
            }));
            expect(p.boundary).toBe(true);
            expect(p.drawing).toBe(false);
            expect(p.stix).toBe(0);
            expect(p.moving).toBe(false);
        });

        test('the Qix starts in the open middle', async ({ page }) => {
            await startFrozen(page);
            const open = await page.evaluate(() => {
                const c1 = cellOf(qix.p1);
                const c2 = cellOf(qix.p2);
                return !isClaimed(c1.cx, c1.cy) && !isClaimed(c2.cx, c2.cy);
            });
            expect(open).toBe(true);
        });

        test('two Sparx patrol at level 1', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => sparx.length)).toBe(2);
        });

        test('every Sparx starts on a boundary point', async ({ page }) => {
            await startFrozen(page);
            const onBoundary = await page.evaluate(() =>
                sparx.every((s) => isBoundaryPoint(s.px, s.py))
            );
            expect(onBoundary).toBe(true);
        });

        test('later levels add more Sparx, up to a cap', async ({ page }) => {
            await startFrozen(page);
            const counts = await page.evaluate(() => {
                const out = [];
                for (const lv of [1, 3, 9]) {
                    level = lv;
                    resetLevel();
                    out.push(sparx.length);
                }
                return out;
            });
            expect(counts[0]).toBe(2);
            expect(counts[1]).toBe(4);
            expect(counts[2]).toBe(5);
        });

        test('the game starts with three lives and no score', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => score)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Grid geometry
    // -----------------------------------------------------------------------
    test.describe('grid geometry', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
        });

        test('anything outside the grid counts as claimed', async ({ page }) => {
            const outside = await page.evaluate(
                () => isClaimed(-1, 5) && isClaimed(5, -1) && isClaimed(GRID_W, 5) && isClaimed(5, GRID_H)
            );
            expect(outside).toBe(true);
        });

        test('a point touching the frame is a boundary point', async ({ page }) => {
            expect(await page.evaluate(() => isBoundaryPoint(1, 1))).toBe(true);
            expect(await page.evaluate(() => isBoundaryPoint(30, 1))).toBe(true);
            expect(await page.evaluate(() => isBoundaryPoint(1, 30))).toBe(true);
        });

        test('a point out in the open is not a boundary point', async ({ page }) => {
            expect(await page.evaluate(() => isBoundaryPoint(30, 30))).toBe(false);
            expect(await page.evaluate(() => isBoundaryPoint(2, 2))).toBe(false);
        });

        test('the marker cannot step into solid claimed ground', async ({ page }) => {
            await place(page, 30, 1);
            expect(await page.evaluate(() => canMove(0, -1))).toBe(false);
        });

        test('the marker cannot step off the grid', async ({ page }) => {
            await place(page, 1, 1);
            expect(await page.evaluate(() => canMove(-1, 0))).toBe(false);
            expect(await page.evaluate(() => canMove(0, -1))).toBe(false);
        });

        test('the marker may walk the boundary and may head into the open', async ({ page }) => {
            await place(page, 30, 1);
            expect(await page.evaluate(() => canMove(1, 0))).toBe(true);
            expect(await page.evaluate(() => canMove(-1, 0))).toBe(true);
            expect(await page.evaluate(() => canMove(0, 1))).toBe(true);
        });

        test('a frame corner can be walked around but not drawn from', async ({ page }) => {
            await place(page, 1, 1);
            const m = await page.evaluate(() => ({
                right: canMove(1, 0),
                down: canMove(0, 1),
                drawsRight: startsLine(1, 0),
                drawsDown: startsLine(0, 1),
            }));
            expect(m.right).toBe(true);
            expect(m.down).toBe(true);
            expect(m.drawsRight).toBe(false);
            expect(m.drawsDown).toBe(false);
        });

        test('heading inward from the middle of a wall starts a line', async ({ page }) => {
            await place(page, 30, 1);
            expect(await page.evaluate(() => startsLine(0, 1))).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Walking the boundary
    // -----------------------------------------------------------------------
    test.describe('walking the boundary', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await place(page, 30, 1);
        });

        test('a step along the wall moves the marker without drawing', async ({ page }) => {
            const ok = await walk(page, [[1, 0]]);
            expect(ok).toEqual([true]);
            const p = await page.evaluate(() => ({ px: player.px, py: player.py, drawing, stix: stix.length }));
            expect(p.px).toBe(31);
            expect(p.py).toBe(1);
            expect(p.drawing).toBe(false);
            expect(p.stix).toBe(0);
        });

        test('a step into the wall is rejected', async ({ page }) => {
            const ok = await walk(page, [[0, -1]]);
            expect(ok).toEqual([false]);
            expect(await page.evaluate(() => player.py)).toBe(1);
        });

        test('holding ArrowRight walks the marker right', async ({ page }) => {
            await page.keyboard.down('ArrowRight');
            await step(page, 16);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => player.px)).toBeGreaterThan(30);
            expect(await page.evaluate(() => player.py)).toBe(1);
        });

        test('holding ArrowLeft walks the marker left', async ({ page }) => {
            await page.keyboard.down('ArrowLeft');
            await step(page, 16);
            await page.keyboard.up('ArrowLeft');
            expect(await page.evaluate(() => player.px)).toBeLessThan(30);
        });

        test('D and A also move the marker', async ({ page }) => {
            await page.keyboard.down('KeyD');
            await step(page, 16);
            await page.keyboard.up('KeyD');
            await step(page, 10);
            const right = await page.evaluate(() => player.px);
            expect(right).toBeGreaterThan(30);
            await page.keyboard.down('KeyA');
            await step(page, 16);
            await page.keyboard.up('KeyA');
            await step(page, 10);
            expect(await page.evaluate(() => player.px)).toBeLessThan(right);
        });

        test('holding a blocked direction leaves the marker where it is', async ({ page }) => {
            await page.keyboard.down('ArrowUp');
            await step(page, 60);
            await page.keyboard.up('ArrowUp');
            const p = await page.evaluate(() => ({ px: player.px, py: player.py, moving: player.moving }));
            expect(p).toEqual({ px: 30, py: 1, moving: false });
        });

        test('releasing the key stops the marker on a lattice point', async ({ page }) => {
            await page.keyboard.down('ArrowRight');
            await step(page, 16);
            await page.keyboard.up('ArrowRight');
            await step(page, 30);
            const p = await page.evaluate(() => ({ t: player.t, moving: player.moving }));
            expect(p.moving).toBe(false);
            expect(p.t).toBe(0);
        });

        test('the marker turns the corner of the frame', async ({ page }) => {
            await place(page, 2, 1);
            await page.keyboard.down('ArrowLeft');
            await step(page, 20);
            await page.keyboard.up('ArrowLeft');
            await page.keyboard.down('ArrowDown');
            await step(page, 20);
            await page.keyboard.up('ArrowDown');
            const p = await page.evaluate(() => ({ px: player.px, py: player.py }));
            expect(p.px).toBe(1);
            expect(p.py).toBeGreaterThan(1);
        });
    });

    // -----------------------------------------------------------------------
    // Drawing a line
    // -----------------------------------------------------------------------
    test.describe('drawing', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await place(page, 30, 1);
        });

        test('stepping into the open starts a line at the marker', async ({ page }) => {
            await walk(page, [[0, 1]]);
            const s = await page.evaluate(() => ({ drawing, stix: stix.slice() }));
            expect(s.drawing).toBe(true);
            expect(s.stix).toEqual([
                { x: 30, y: 1 },
                { x: 30, y: 2 },
            ]);
        });

        test('each step extends the line', async ({ page }) => {
            await walk(page, [[0, 1], [0, 1], [0, 1]]);
            expect(await page.evaluate(() => stix.length)).toBe(4);
            expect(await page.evaluate(() => player.py)).toBe(4);
        });

        test('a line can turn corners in the open', async ({ page }) => {
            const ok = await walk(page, [[0, 1], [0, 1], [1, 0], [1, 0], [0, 1]]);
            expect(ok).toEqual([true, true, true, true, true]);
            const last = await page.evaluate(() => stix[stix.length - 1]);
            expect(last).toEqual({ x: 32, y: 4 });
        });

        test('a line may not cross itself', async ({ page }) => {
            await walk(page, [[0, 1], [0, 1], [1, 0], [0, -1]]);
            // Back at y = 2 on x = 31; stepping left would land on (30, 2), already drawn.
            expect(await page.evaluate(() => canMove(-1, 0))).toBe(false);
        });

        test('a line may not double back on its own last step', async ({ page }) => {
            await walk(page, [[0, 1]]);
            expect(await page.evaluate(() => canMove(0, -1))).toBe(false);
        });

        test('drawing is slower than walking when Shift is held', async ({ page }) => {
            const speeds = await page.evaluate(() => [DRAW_SLOW, DRAW_FAST, BOUNDARY_SPEED]);
            expect(speeds[0]).toBeLessThan(speeds[1]);
            expect(speeds[1]).toBe(speeds[2]);
        });

        test('holding Shift while starting a line sets the double multiplier', async ({ page }) => {
            await page.keyboard.down('ShiftLeft');
            await page.keyboard.down('ArrowDown');
            await step(page, 20);
            await page.keyboard.up('ArrowDown');
            await page.keyboard.up('ShiftLeft');
            expect(await page.evaluate(() => drawing)).toBe(true);
            expect(await page.evaluate(() => drawMultiplier)).toBe(2);
        });

        test('a fast line keeps the single multiplier', async ({ page }) => {
            await walk(page, [[0, 1]]);
            expect(await page.evaluate(() => drawMultiplier)).toBe(1);
        });

        test('the marker keeps drawing while a direction is held', async ({ page }) => {
            await page.keyboard.down('ArrowDown');
            await step(page, 60);
            await page.keyboard.up('ArrowDown');
            const s = await page.evaluate(() => ({ drawing, py: player.py, stix: stix.length }));
            expect(s.drawing).toBe(true);
            expect(s.py).toBeGreaterThan(5);
            expect(s.stix).toBeGreaterThan(5);
        });
    });

    // -----------------------------------------------------------------------
    // Closing a loop and claiming
    // -----------------------------------------------------------------------
    test.describe('claiming', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
        });

        // Down the x = 10 line, then left along y = 5 back to the left wall.
        // That seals cells x 1..9, y 1..4 — thirty-six of them.
        const CORNER_LOOP = [
            [0, 1], [0, 1], [0, 1], [0, 1],
            [-1, 0], [-1, 0], [-1, 0], [-1, 0], [-1, 0], [-1, 0], [-1, 0], [-1, 0], [-1, 0],
        ];

        test('touching owned ground again closes the line', async ({ page }) => {
            await place(page, 10, 1);
            await walk(page, CORNER_LOOP);
            const s = await page.evaluate(() => ({ drawing, stix: stix.length, px: player.px, py: player.py }));
            expect(s.drawing).toBe(false);
            expect(s.stix).toBe(0);
            expect(s.px).toBe(1);
            expect(s.py).toBe(5);
        });

        test('the enclosed cells become claimed', async ({ page }) => {
            await place(page, 10, 1);
            await walk(page, CORNER_LOOP);
            expect(await page.evaluate(() => claimedCells)).toBe(FRAME_CELLS + 36);
            const filled = await page.evaluate(() => {
                for (let x = 1; x <= 9; x++) {
                    for (let y = 1; y <= 4; y++) if (!isClaimed(x, y)) return false;
                }
                return true;
            });
            expect(filled).toBe(true);
        });

        test('cells outside the loop stay open', async ({ page }) => {
            await place(page, 10, 1);
            await walk(page, CORNER_LOOP);
            expect(await page.evaluate(() => isClaimed(10, 1))).toBe(false);
            expect(await page.evaluate(() => isClaimed(5, 5))).toBe(false);
            expect(await page.evaluate(() => isClaimed(30, 30))).toBe(false);
        });

        test('a fast claim scores ten a cell', async ({ page }) => {
            await place(page, 10, 1);
            await walk(page, CORNER_LOOP);
            expect(await page.evaluate(() => score)).toBe(360);
            await expect(page.locator('#score')).toHaveText('360');
        });

        test('a slow claim scores double', async ({ page }) => {
            await place(page, 10, 1);
            await page.evaluate(() => {
                drawSlow = true;
            });
            await walk(page, CORNER_LOOP);
            expect(await page.evaluate(() => score)).toBe(720);
        });

        test('the claimed percentage grows with the claim', async ({ page }) => {
            await place(page, 10, 1);
            await walk(page, CORNER_LOOP);
            const pct = await page.evaluate(() => claimedPercent());
            expect(pct).toBeCloseTo(((236 + 36) / 3600) * 100, 6);
            await expect(page.locator('#claimed')).toHaveText('7%');
        });

        test('the marker is left standing on the new boundary', async ({ page }) => {
            await place(page, 10, 1);
            await walk(page, CORNER_LOOP);
            const p = await page.evaluate(() => ({
                boundary: isBoundaryPoint(player.px, player.py),
                free: hasBorderEdge(player.px, player.py),
            }));
            expect(p.boundary).toBe(true);
            expect(p.free).toBe(true);
        });

        test('the side the Qix is on is never claimed', async ({ page }) => {
            // Open rectangle x 1..9, y 1..8; a line down x = 5 splits it in two.
            await openOnly(page, 1, 9, 1, 8);
            await page.evaluate(() => setQix(7.5 * CELL, 4.5 * CELL, 8.5 * CELL, 4.5 * CELL));
            await place(page, 5, 1);
            await walk(page, [[0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1]]);
            const g = await page.evaluate(() => ({
                left: isClaimed(2, 4),
                qixSide: isClaimed(7, 4),
                gained: claimedCells,
            }));
            expect(g.left).toBe(true);
            expect(g.qixSide).toBe(false);
            expect(g.gained).toBe(3600 - 40);
        });

        test('a line that fails to separate the field claims nothing', async ({ page }) => {
            // An open ring: a single line from the outer edge to the island in
            // the middle leaves one region, and the Qix is in it.
            await openOnly(page, 1, 9, 1, 9);
            await page.evaluate(() => {
                setClaimed(5, 5, true);
                recountClaimed();
                setQix(7.2 * CELL, 8.5 * CELL, 8.8 * CELL, 8.5 * CELL);
            });
            const before = await page.evaluate(() => claimedCells);
            await place(page, 5, 1);
            const ok = await walk(page, [[0, 1], [0, 1], [0, 1], [0, 1]]);
            expect(ok).toEqual([true, true, true, true]);
            expect(await page.evaluate(() => drawing)).toBe(false);
            expect(await page.evaluate(() => claimedCells)).toBe(before);
            expect(await page.evaluate(() => isClaimed(2, 2))).toBe(false);
            expect(await page.evaluate(() => isClaimed(8, 8))).toBe(false);
        });

        test('reaching the target clears the level', async ({ page }) => {
            await openOnly(page, 1, 9, 1, 8);
            await place(page, 5, 1);
            await walk(page, [[0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1]]);
            expect(await page.evaluate(() => claimedPercent())).toBeGreaterThanOrEqual(75);
            expect(await page.evaluate(() => state)).toBe('levelclear');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('clearing a level starts a fresh field at the next level', async ({ page }) => {
            await openOnly(page, 1, 9, 1, 8);
            await place(page, 5, 1);
            await walk(page, [[0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1]]);
            await page.keyboard.press('Space');
            const g = await page.evaluate(() => ({ state, level, claimedCells, sparx: sparx.length }));
            expect(g.state).toBe('running');
            expect(g.level).toBe(2);
            expect(g.claimedCells).toBe(FRAME_CELLS);
            expect(g.sparx).toBe(3);
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // The Qix
    // -----------------------------------------------------------------------
    test.describe('the Qix', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                sparx.length = 0;
            });
        });

        test('the Qix drifts around on its own', async ({ page }) => {
            const before = await page.evaluate(() => ({ x: qix.p1.x, y: qix.p1.y }));
            await step(page, 60);
            const after = await page.evaluate(() => ({ x: qix.p1.x, y: qix.p1.y }));
            expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(1);
        });

        test('the Qix never wanders onto claimed ground', async ({ page }) => {
            const stayedOpen = await page.evaluate(() => {
                for (let i = 0; i < 2400; i++) {
                    stepGame(DT);
                    for (const p of [qix.p1, qix.p2]) {
                        const c = cellOf(p);
                        if (isClaimed(c.cx, c.cy)) return false;
                    }
                }
                return true;
            });
            expect(stayedOpen).toBe(true);
        });

        test('the Qix keeps roughly its own length', async ({ page }) => {
            const worst = await page.evaluate(() => {
                let longest = 0;
                for (let i = 0; i < 600; i++) {
                    stepGame(DT);
                    longest = Math.max(longest, Math.hypot(qix.p2.x - qix.p1.x, qix.p2.y - qix.p1.y));
                }
                return longest;
            });
            const max = await page.evaluate(() => QIX_LEN);
            expect(worst).toBeGreaterThan(0);
            expect(worst).toBeLessThanOrEqual(max + 0.001);
        });

        test('the Qix gets faster on later levels', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                const out = [];
                for (const lv of [1, 5]) {
                    level = lv;
                    out.push(qixSpeed());
                }
                return out;
            });
            expect(speeds[1]).toBeGreaterThan(speeds[0]);
        });

        test('the Qix kills the marker when it crosses the line', async ({ page }) => {
            await place(page, 30, 1);
            await walk(page, [[0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1]]);
            await page.evaluate(() => setQix(28 * CELL, 4.5 * CELL, 32 * CELL, 4.5 * CELL));
            await step(page, 1);
            const g = await page.evaluate(() => ({ lives, drawing, stix: stix.length }));
            expect(g.lives).toBe(2);
            expect(g.drawing).toBe(false);
            expect(g.stix).toBe(0);
        });

        test('the Qix cannot touch the marker on the boundary', async ({ page }) => {
            await place(page, 30, 1);
            await page.evaluate(() => setQix(29.5 * CELL, 1.5 * CELL, 30.5 * CELL, 1.5 * CELL));
            await step(page, 2);
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Sparx
    // -----------------------------------------------------------------------
    test.describe('Sparx', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => setQix(53.5 * CELL, 55.5 * CELL, 57.5 * CELL, 55.5 * CELL));
        });

        test('Sparx travel along the boundary', async ({ page }) => {
            const before = await page.evaluate(() => sparx.map((s) => ({ px: s.px, py: s.py })));
            await step(page, 120);
            const after = await page.evaluate(() => sparx.map((s) => ({ px: s.px, py: s.py })));
            expect(after.some((s, i) => s.px !== before[i].px || s.py !== before[i].py)).toBe(true);
        });

        test('Sparx stay on boundary points', async ({ page }) => {
            const onBoundary = await page.evaluate(() => {
                for (let i = 0; i < 1200; i++) {
                    stepGame(DT);
                    if (!sparx.every((s) => isBoundaryPoint(s.px, s.py))) return false;
                }
                return true;
            });
            expect(onBoundary).toBe(true);
        });

        test('Sparx never stand on claimed-in ground', async ({ page }) => {
            const ok = await page.evaluate(() =>
                sparx.every((s) => hasBorderEdge(s.px, s.py))
            );
            expect(ok).toBe(true);
        });

        test('a Sparx kills the marker on contact', async ({ page }) => {
            await place(page, 30, 1);
            await page.evaluate(() => {
                sparx.length = 1;
                sparx[0] = makeSparx(30, 1, 1, 0);
            });
            await step(page, 1);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a Sparx far away is harmless', async ({ page }) => {
            await place(page, 30, 1);
            await page.evaluate(() => {
                sparx.length = 1;
                sparx[0] = makeSparx(1, 30, 0, 1);
            });
            await step(page, 1);
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // The fuse
    // -----------------------------------------------------------------------
    test.describe('the fuse', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await place(page, 30, 1);
        });

        test('the fuse sleeps while nothing is being drawn', async ({ page }) => {
            await step(page, 120);
            expect(await page.evaluate(() => fuse.active)).toBe(false);
        });

        test('stopping mid-line wakes the fuse', async ({ page }) => {
            await walk(page, [[0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1]]);
            expect(await page.evaluate(() => fuse.active)).toBe(false);
            await step(page, 60);
            expect(await page.evaluate(() => fuse.active)).toBe(true);
        });

        test('the fuse creeps along the line that was drawn', async ({ page }) => {
            await walk(page, new Array(12).fill([0, 1]));
            await step(page, 100);
            const f = await page.evaluate(() => ({ idx: fuse.idx, active: fuse.active, lives }));
            expect(f.active).toBe(true);
            expect(f.idx).toBeGreaterThan(0);
            expect(f.idx).toBeLessThan(11);
            expect(f.lives).toBe(3);
        });

        test('the fuse holds still while the marker keeps moving', async ({ page }) => {
            await walk(page, new Array(12).fill([0, 1]));
            await step(page, 100);
            const parked = await page.evaluate(() => fuse.idx);
            await page.keyboard.down('ArrowDown');
            await step(page, 60);
            await page.keyboard.up('ArrowDown');
            expect(await page.evaluate(() => fuse.idx)).toBe(parked);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('the fuse kills the marker if it catches up', async ({ page }) => {
            await walk(page, [[0, 1], [0, 1], [0, 1]]);
            await step(page, 240);
            const g = await page.evaluate(() => ({ lives, drawing, active: fuse.active }));
            expect(g.lives).toBe(2);
            expect(g.drawing).toBe(false);
            expect(g.active).toBe(false);
        });

        test('closing a loop puts the fuse out', async ({ page }) => {
            await place(page, 10, 1);
            await walk(page, [[0, 1], [0, 1]]);
            await step(page, 60);
            expect(await page.evaluate(() => fuse.active)).toBe(true);
            await walk(page, [[0, 1], [0, 1], ...new Array(9).fill([-1, 0])]);
            const f = await page.evaluate(() => ({ active: fuse.active, idx: fuse.idx, drawing }));
            expect(f).toEqual({ active: false, idx: 0, drawing: false });
        });
    });

    // -----------------------------------------------------------------------
    // Lives, death and game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
        });

        test('a death costs a life and throws the line away', async ({ page }) => {
            await place(page, 30, 1);
            await walk(page, [[0, 1], [0, 1]]);
            await page.evaluate(() => killPlayer());
            const g = await page.evaluate(() => ({ lives, drawing, stix: stix.length, state }));
            expect(g.lives).toBe(2);
            expect(g.drawing).toBe(false);
            expect(g.stix).toBe(0);
            expect(g.state).toBe('running');
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('a death puts the marker back on the boundary', async ({ page }) => {
            await place(page, 30, 1);
            await walk(page, [[0, 1], [0, 1], [0, 1]]);
            await page.evaluate(() => killPlayer());
            const p = await page.evaluate(() => ({
                boundary: isBoundaryPoint(player.px, player.py),
                free: hasBorderEdge(player.px, player.py),
                moving: player.moving,
            }));
            expect(p.boundary).toBe(true);
            expect(p.free).toBe(true);
            expect(p.moving).toBe(false);
        });

        test('a death keeps the ground already claimed', async ({ page }) => {
            await place(page, 10, 1);
            await walk(page, [
                [0, 1], [0, 1], [0, 1], [0, 1],
                ...new Array(9).fill([-1, 0]),
            ]);
            const held = await page.evaluate(() => claimedCells);
            await page.evaluate(() => killPlayer());
            expect(await page.evaluate(() => claimedCells)).toBe(held);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                killPlayer();
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
            expect(await page.evaluate(() => lives)).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('game over shows the final score', async ({ page }) => {
            await page.evaluate(() => {
                score = 4820;
                lives = 1;
                killPlayer();
            });
            await expect(page.locator('#overlay-score')).toContainText('4820');
        });

        test('game over records a new best score', async ({ page }) => {
            await page.evaluate(() => {
                score = 9990;
                lives = 1;
                killPlayer();
            });
            expect(await page.evaluate(() => window.localStorage.getItem('qix-best'))).toBe('9990');
            await expect(page.locator('#best')).toHaveText('9990');
        });

        test('a worse score leaves the best alone', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('qix-best', '50000'));
            await page.reload();
            await startFrozen(page);
            await page.evaluate(() => {
                score = 120;
                lives = 1;
                killPlayer();
            });
            expect(await page.evaluate(() => window.localStorage.getItem('qix-best'))).toBe('50000');
        });

        test('the simulation stops once the game is over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                killPlayer();
            });
            const before = await page.evaluate(() => ({ x: qix.p1.x, y: qix.p1.y }));
            await step(page, 120);
            const after = await page.evaluate(() => ({ x: qix.p1.x, y: qix.p1.y }));
            expect(after).toEqual(before);
        });

        test('Space after game over starts a clean run', async ({ page }) => {
            await page.evaluate(() => {
                score = 700;
                lives = 1;
                killPlayer();
            });
            await page.keyboard.press('Space');
            const g = await page.evaluate(() => ({ state, lives, score, level, claimedCells }));
            expect(g).toEqual({ state: 'running', lives: 3, score: 0, level: 1, claimedCells: FRAME_CELLS });
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the overlay says the game is paused', async ({ page }) => {
            await page.keyboard.press('KeyP');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.keyboard.press('KeyP');
            const before = await page.evaluate(() => ({ x: qix.p1.x, y: qix.p1.y }));
            await step(page, 120);
            expect(await page.evaluate(() => ({ x: qix.p1.x, y: qix.p1.y }))).toEqual(before);
        });

        test('P does nothing before the game starts', async ({ page }) => {
            await page.reload();
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });
});
