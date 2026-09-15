const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Advance roughly `seconds` of simulated time at a fixed 60 Hz.
const advanceSeconds = (page, seconds) => advance(page, Math.round(seconds * 60));

// Start a run with ship spawning switched off and the requestAnimationFrame
// loop detached from the simulation, so specs advance time themselves and never
// race the real clock. Specs that are about ships turn spawning back on or call
// spawnShip() directly; the spec that is about the loop starts the game itself.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        shipSpawnEnabled = false;
        autoStep = false;
    });

// Start a run and jump straight to the named phase.
const startInPhase = async (page, wanted) => {
    await startQuiet(page);
    await page.evaluate((want) => {
        let guard = 0;
        while (phase !== want && guard++ < 5) endPhase();
    }, wanted);
};

test.describe('Rampart', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Page / shell
    // -----------------------------------------------------------------------
    test.describe('page shell', () => {
        test('page title is Rampart', async ({ page }) => {
            await expect(page).toHaveTitle('Rampart');
        });

        test('canvas is 560x440', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '440');
        });

        test('start overlay is visible before the first game', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows the starting score and round', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#round')).toHaveText('1');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('rampart-best', '7300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7300');
        });

        test('help text mentions the controls', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/rotate/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('draw() runs without throwing while idle', async ({ page }) => {
            await page.evaluate(() => draw());
        });
    });

    // -----------------------------------------------------------------------
    // Board layout
    // -----------------------------------------------------------------------
    test.describe('board layout', () => {
        test('grid dimensions match the canvas', async ({ page }) => {
            const dims = await page.evaluate(() => ({
                cols: COLS,
                rows: ROWS,
                cell: CELL,
                w: CANVAS_W,
                h: CANVAS_H,
            }));
            expect(dims.cols * dims.cell).toBe(dims.w);
            expect(dims.rows * dims.cell).toBe(dims.h);
        });

        test('terrain and structures cover every cell', async ({ page }) => {
            const shape = await page.evaluate(() => ({
                tRows: terrain.length,
                tCols: terrain[0].length,
                sRows: structures.length,
                sCols: structures[0].length,
            }));
            expect(shape).toEqual({ tRows: 22, tCols: 28, sRows: 22, sCols: 28 });
        });

        test('the sea sits on the left of a ragged coastline', async ({ page }) => {
            const ok = await page.evaluate(() =>
                terrain.every((row, r) =>
                    row.every((t, c) => t === (c < shore[r] ? WATER : LAND))
                )
            );
            expect(ok).toBe(true);
        });

        test('the coastline stays within the sea margin', async ({ page }) => {
            const range = await page.evaluate(() => [Math.min(...shore), Math.max(...shore)]);
            expect(range[0]).toBeGreaterThanOrEqual(7);
            expect(range[1]).toBeLessThanOrEqual(9);
        });

        test('the coastline is ragged, not a straight edge', async ({ page }) => {
            const distinct = await page.evaluate(() => new Set(shore).size);
            expect(distinct).toBeGreaterThan(1);
        });

        test('there are three castles, each 3x3 on land', async ({ page }) => {
            const castleInfo = await page.evaluate(() =>
                castles.map((k) => ({
                    size: k.size,
                    cells: [0, 1, 2].flatMap((dr) =>
                        [0, 1, 2].map((dc) => ({
                            t: terrain[k.row + dr][k.col + dc],
                            s: structures[k.row + dr][k.col + dc],
                        }))
                    ),
                }))
            );
            expect(castleInfo).toHaveLength(3);
            for (const k of castleInfo) {
                expect(k.size).toBe(3);
                expect(k.cells).toHaveLength(9);
                expect(k.cells.every((c) => c.t === 1 && c.s === 2)).toBe(true);
            }
        });

        test('the middle castle starts ringed by a wall', async ({ page }) => {
            const enclosed = await page.evaluate(() => {
                computeOutside();
                return castles.map((k) => isEnclosed(k));
            });
            expect(enclosed).toEqual([false, true, false]);
        });

        test('the starting ring is made of wall cells on land', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const cells = [];
                for (let c = RING.left; c <= RING.right; c++) {
                    cells.push([RING.top, c], [RING.bottom, c]);
                }
                for (let r = RING.top; r <= RING.bottom; r++) {
                    cells.push([r, RING.left], [r, RING.right]);
                }
                return cells.every(
                    ([r, c]) => structures[r][c] === WALL && terrain[r][c] === LAND
                );
            });
            expect(ok).toBe(true);
        });

        test('no cannons or ships exist before the first game', async ({ page }) => {
            const counts = await page.evaluate(() => [cannons.length, ships.length, shots.length]);
            expect(counts).toEqual([0, 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Enclosure / territory
    // -----------------------------------------------------------------------
    test.describe('enclosure', () => {
        test('cells inside the ring are not reachable from the border', async ({ page }) => {
            const inside = await page.evaluate(() => {
                computeOutside();
                return outside[RING.top + 1][RING.left + 1];
            });
            expect(inside).toBe(false);
        });

        test('cells outside the ring are reachable from the border', async ({ page }) => {
            const out = await page.evaluate(() => {
                computeOutside();
                return outside[0][COLS - 1] && outside[RING.top - 1][RING.left - 1];
            });
            expect(out).toBe(true);
        });

        test('a single breach in the ring un-encloses the castle', async ({ page }) => {
            const enclosed = await page.evaluate(() => {
                structures[RING.top][RING.left + 2] = EMPTY;
                computeOutside();
                return isEnclosed(castles[1]);
            });
            expect(enclosed).toBe(false);
        });

        test('sealing the breach encloses the castle again', async ({ page }) => {
            const enclosed = await page.evaluate(() => {
                structures[RING.top][RING.left + 2] = EMPTY;
                computeOutside();
                const broken = isEnclosed(castles[1]);
                structures[RING.top][RING.left + 2] = WALL;
                computeOutside();
                return [broken, isEnclosed(castles[1])];
            });
            expect(enclosed).toEqual([false, true]);
        });

        test('territory counts only enclosed, empty land', async ({ page }) => {
            const info = await page.evaluate(() => {
                computeOutside();
                return { territory: countTerritory(), ring: RING };
            });
            const interior = 7 * 7; // cells inside a 9x9 ring
            expect(info.territory).toBe(interior - 9); // minus the 3x3 castle
        });

        test('water inside a ring is not placeable territory', async ({ page }) => {
            const territory = await page.evaluate(() => {
                // Flood the interior with water; it stays enclosed but unbuildable.
                for (let r = RING.top + 1; r < RING.bottom; r++) {
                    for (let c = RING.left + 1; c < RING.right; c++) {
                        if (structures[r][c] === EMPTY) terrain[r][c] = WATER;
                    }
                }
                computeOutside();
                return countTerritory();
            });
            expect(territory).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting a run', () => {
        test('startGame() begins the placement phase of round 1', async ({ page }) => {
            const info = await startQuiet(page).then(() =>
                page.evaluate(() => ({
                    state,
                    phase,
                    round,
                    score,
                    fullClock: phaseTime === PLACE_TIME,
                }))
            );
            expect(info).toEqual({
                state: 'running',
                phase: 'place',
                round: 1,
                score: 0,
                fullClock: true,
            });
        });

        test('the overlay is hidden once the game starts', async ({ page }) => {
            await startQuiet(page);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the first placement phase grants cannons for the held castle', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => cannonsLeft)).toBe(3);
        });

        test('pressing Space starts the game from the title screen', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
        });

        test('the HUD names the current phase', async ({ page }) => {
            await startQuiet(page);
            await expect(page.locator('#phase')).toContainText(/place/i);
        });

        test('starting again resets score, round and the board', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 900;
                round = 4;
                placeCannon(RING.left + 1, RING.top + 1);
            });
            const after = await page.evaluate(() => {
                startGame();
                return { score, round, cannons: cannons.length };
            });
            expect(after).toEqual({ score: 0, round: 1, cannons: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Phase clock
    // -----------------------------------------------------------------------
    test.describe('phase clock', () => {
        test('the phase timer counts down while running', async ({ page }) => {
            await startQuiet(page);
            await advanceSeconds(page, 2);
            const left = await page.evaluate(() => PLACE_TIME - phaseTime);
            expect(left).toBeGreaterThan(1.9);
            expect(left).toBeLessThan(2.1);
        });

        test('placement rolls into battle when the clock runs out', async ({ page }) => {
            await startQuiet(page);
            await advanceSeconds(page, 11);
            const info = await page.evaluate(() => ({ phase, time: phaseTime }));
            expect(info.phase).toBe('battle');
            expect(info.time).toBeGreaterThan(25);
        });

        test('battle rolls into repair', async ({ page }) => {
            await startInPhase(page, 'battle');
            await advanceSeconds(page, 31);
            expect(await page.evaluate(() => phase)).toBe('repair');
        });

        test('the phase order is place, battle, repair, place', async ({ page }) => {
            await startQuiet(page);
            const seen = await page.evaluate(() => {
                const order = [phase];
                for (let i = 0; i < 3; i++) {
                    endPhase();
                    order.push(phase);
                }
                return order;
            });
            expect(seen).toEqual(['place', 'battle', 'repair', 'place']);
        });

        test('the repair clock tightens as rounds go by', async ({ page }) => {
            const times = await page.evaluate(() => [1, 3, 9].map((r) => repairTime(r)));
            expect(times[0]).toBeGreaterThan(times[1]);
            expect(times[1]).toBeGreaterThan(times[2]);
            expect(times[2]).toBeGreaterThanOrEqual(15);
        });

        test('the HUD timer shows whole seconds remaining', async ({ page }) => {
            await startQuiet(page);
            await expect(page.locator('#timer')).toHaveText('10');
            await advanceSeconds(page, 3);
            await page.evaluate(() => draw());
            await expect(page.locator('#timer')).toHaveText('7');
        });
    });

    // -----------------------------------------------------------------------
    // Cannon placement
    // -----------------------------------------------------------------------
    test.describe('cannon placement', () => {
        test('a cannon can be placed on enclosed empty land', async ({ page }) => {
            await startQuiet(page);
            const ok = await page.evaluate(() => placeCannon(RING.left + 1, RING.top + 1));
            expect(ok).toBe(true);
            const cells = await page.evaluate(() =>
                [0, 1].flatMap((dr) =>
                    [0, 1].map((dc) => structures[RING.top + 1 + dr][RING.left + 1 + dc])
                )
            );
            expect(cells).toEqual([3, 3, 3, 3]);
        });

        test('a placed cannon occupies a 2x2 footprint in the cannon list', async ({ page }) => {
            await startQuiet(page);
            const cannon = await page.evaluate(() => {
                placeCannon(RING.left + 1, RING.top + 1);
                return { ...cannons[0], size: CANNON_SIZE };
            });
            expect(cannon.col).toBe(await page.evaluate(() => RING.left + 1));
            expect(cannon.size).toBe(2);
        });

        test('placing a cannon spends one of the allowance', async ({ page }) => {
            await startQuiet(page);
            const left = await page.evaluate(() => {
                placeCannon(RING.left + 1, RING.top + 1);
                return cannonsLeft;
            });
            expect(left).toBe(2);
        });

        test('cannons cannot be placed once the allowance is spent', async ({ page }) => {
            await startQuiet(page);
            const results = await page.evaluate(() => {
                cannonsLeft = 1;
                return [
                    placeCannon(RING.left + 1, RING.top + 1),
                    placeCannon(RING.left + 1, RING.top + 4),
                ];
            });
            expect(results).toEqual([true, false]);
        });

        test('cannons cannot overlap a wall', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => placeCannon(RING.left, RING.top))).toBe(false);
        });

        test('cannons cannot overlap the castle', async ({ page }) => {
            await startQuiet(page);
            expect(
                await page.evaluate(() => placeCannon(castles[1].col, castles[1].row))
            ).toBe(false);
        });

        test('cannons cannot overlap another cannon', async ({ page }) => {
            await startQuiet(page);
            const second = await page.evaluate(() => {
                placeCannon(RING.left + 1, RING.top + 1);
                return placeCannon(RING.left + 2, RING.top + 2);
            });
            expect(second).toBe(false);
        });

        test('cannons cannot be placed on open ground outside the walls', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => placeCannon(COLS - 3, ROWS - 3))).toBe(false);
        });

        test('cannons cannot be placed in the sea', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => placeCannon(0, 0))).toBe(false);
        });

        test('cannons cannot be placed off the board', async ({ page }) => {
            await startQuiet(page);
            const results = await page.evaluate(() => [
                placeCannon(COLS - 1, 5),
                placeCannon(5, ROWS - 1),
                placeCannon(-1, 5),
            ]);
            expect(results).toEqual([false, false, false]);
        });

        test('cannons cannot be placed outside the placement phase', async ({ page }) => {
            await startInPhase(page, 'battle');
            expect(
                await page.evaluate(() => placeCannon(RING.left + 1, RING.top + 1))
            ).toBe(false);
        });

        test('unspent cannon allowance does not carry into the battle', async ({ page }) => {
            await startInPhase(page, 'battle');
            expect(await page.evaluate(() => cannonsLeft)).toBe(0);
        });

        test('cannons survive into later phases', async ({ page }) => {
            await startQuiet(page);
            const count = await page.evaluate(() => {
                placeCannon(RING.left + 1, RING.top + 1);
                endPhase();
                return cannons.length;
            });
            expect(count).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Ships
    // -----------------------------------------------------------------------
    test.describe('ships', () => {
        test('ships spawn in the sea during the battle', async ({ page }) => {
            await startInPhase(page, 'battle');
            const ship = await page.evaluate(() => {
                const s = spawnShip(6);
                return { x: s.x, row: s.row, hp: s.hp };
            });
            expect(ship.row).toBe(6);
            expect(ship.hp).toBeGreaterThan(0);
            expect(ship.x).toBeLessThanOrEqual(0);
        });

        test('ships sail toward the coast', async ({ page }) => {
            await startInPhase(page, 'battle');
            await page.evaluate(() => spawnShip(6));
            const before = await page.evaluate(() => ships[0].x);
            await advanceSeconds(page, 3);
            const after = await page.evaluate(() => ships[0].x);
            expect(after).toBeGreaterThan(before);
        });

        test('ships stop short of the shoreline', async ({ page }) => {
            await startInPhase(page, 'battle');
            await page.evaluate(() => {
                spawnShip(6);
                phaseTime = 999;
            });
            await advanceSeconds(page, 30);
            const gap = await page.evaluate(() => shore[6] * CELL - (ships[0].x + SHIP_W));
            expect(gap).toBeGreaterThan(0);
        });

        test('the battle spawns ships on its own when spawning is enabled', async ({ page }) => {
            await startInPhase(page, 'battle');
            await page.evaluate(() => {
                shipSpawnEnabled = true;
            });
            await advanceSeconds(page, 12);
            expect(await page.evaluate(() => ships.length)).toBeGreaterThan(0);
        });

        test('no ships spawn outside the battle phase', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                shipSpawnEnabled = true;
            });
            await advanceSeconds(page, 9);
            expect(await page.evaluate(() => ships.length)).toBe(0);
        });

        test('the sea is cleared when the battle ends', async ({ page }) => {
            await startInPhase(page, 'battle');
            await page.evaluate(() => {
                spawnShip(6);
                spawnShip(12);
                endPhase();
            });
            expect(await page.evaluate(() => ships.length)).toBe(0);
        });

        test('ships shell the walls', async ({ page }) => {
            await startInPhase(page, 'battle');
            const hit = await page.evaluate(() => {
                const ship = spawnShip(6);
                const target = { col: RING.left, row: RING.top + 3 };
                launchShell(ship, target.col, target.row);
                return { shots: shots.length, side: shots[0].side };
            });
            expect(hit).toEqual({ shots: 1, side: 'ship' });
        });

        test('a shell landing on a wall blows a hole in it', async ({ page }) => {
            await startInPhase(page, 'battle');
            const before = await page.evaluate(
                () => structures[RING.top + 3][RING.left]
            );
            await page.evaluate(() => {
                const ship = spawnShip(6);
                ship.fire = 999; // stay quiet on the run in, so one shell is in play
                launchShell(ship, RING.left, RING.top + 3);
            });
            // Long enough for the shell to land, short enough that the ship is
            // still out of its own firing range.
            await advanceSeconds(page, 3);
            const after = await page.evaluate(() => ({
                cell: structures[RING.top + 3][RING.left],
                shots: shots.length,
            }));
            expect(before).toBe(1);
            expect(after).toEqual({ cell: 0, shots: 0 });
        });

        test('a shell cannot destroy a castle', async ({ page }) => {
            await startInPhase(page, 'battle');
            await page.evaluate(() => {
                explode(cellCenter(castles[1].col + 1), cellCenter(castles[1].row + 1), 'ship');
            });
            const still = await page.evaluate(
                () => structures[castles[1].row + 1][castles[1].col + 1]
            );
            expect(still).toBe(2);
        });

        test('a shell destroys a cannon it lands on', async ({ page }) => {
            await startQuiet(page);
            const result = await page.evaluate(() => {
                placeCannon(RING.left + 1, RING.top + 1);
                endPhase(); // into battle
                explode(cellCenter(RING.left + 1), cellCenter(RING.top + 1), 'ship');
                return {
                    cannons: cannons.length,
                    cell: structures[RING.top + 1][RING.left + 1],
                };
            });
            expect(result).toEqual({ cannons: 0, cell: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        const withCannon = async (page) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeCannon(RING.left + 1, RING.top + 1);
                endPhase(); // into battle
            });
        };

        test('firing launches a shell from every loaded cannon', async ({ page }) => {
            await withCannon(page);
            const fired = await page.evaluate(() => fireAt(60, 120));
            expect(fired).toBe(1);
            const shot = await page.evaluate(() => ({ ...shots[0] }));
            expect(shot.side).toBe('player');
            expect(shot.tx).toBe(60);
            expect(shot.ty).toBe(120);
        });

        test('a cannon must reload before firing again', async ({ page }) => {
            await withCannon(page);
            const immediate = await page.evaluate(() => {
                fireAt(60, 120);
                return fireAt(60, 120);
            });
            expect(immediate).toBe(0);
            await advanceSeconds(page, 2);
            expect(await page.evaluate(() => fireAt(60, 120))).toBe(1);
        });

        test('firing does nothing outside the battle phase', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => placeCannon(RING.left + 1, RING.top + 1));
            expect(await page.evaluate(() => fireAt(60, 120))).toBe(0);
        });

        test('firing with no cannons does nothing', async ({ page }) => {
            await startInPhase(page, 'battle');
            expect(await page.evaluate(() => fireAt(60, 120))).toBe(0);
        });

        test('targets beyond cannon range are not fired at', async ({ page }) => {
            await withCannon(page);
            expect(await page.evaluate(() => fireAt(CANVAS_W - 1, CANVAS_H - 1))).toBe(0);
        });

        test('a shell in flight lands on its target and disappears', async ({ page }) => {
            await withCannon(page);
            await page.evaluate(() => fireAt(60, 120));
            await advance(page, 6);
            const mid = await page.evaluate(() => ({ ...shots[0] }));
            expect(mid.t).toBeGreaterThan(0);
            await advanceSeconds(page, 4);
            expect(await page.evaluate(() => shots.length)).toBe(0);
        });

        test('a direct hit sinks a ship and scores', async ({ page }) => {
            await withCannon(page);
            const result = await page.evaluate(() => {
                const ship = spawnShip(6);
                ship.x = 40;
                explode(ship.x + SHIP_W / 2, cellCenter(ship.row), 'player');
                return { ships: ships.length, sunk: shipsSunk, score };
            });
            expect(result.ships).toBe(0);
            expect(result.sunk).toBe(1);
            expect(result.score).toBe(200);
        });

        test('a near miss leaves the ship afloat', async ({ page }) => {
            await withCannon(page);
            const afloat = await page.evaluate(() => {
                const ship = spawnShip(6);
                ship.x = 40;
                explode(ship.x - 120, cellCenter(ship.row), 'player');
                return ships.length;
            });
            expect(afloat).toBe(1);
        });

        test('your own shells knock out your walls too', async ({ page }) => {
            await withCannon(page);
            const after = await page.evaluate(() => {
                explode(cellCenter(RING.left), cellCenter(RING.top + 3), 'player');
                return structures[RING.top + 3][RING.left];
            });
            expect(after).toBe(0);
        });

        test('your own shells spare your cannons', async ({ page }) => {
            await withCannon(page);
            const after = await page.evaluate(() => {
                explode(cellCenter(RING.left + 1), cellCenter(RING.top + 1), 'player');
                return cannons.length;
            });
            expect(after).toBe(1);
        });

        test('sinking ships raises the score shown in the HUD', async ({ page }) => {
            await withCannon(page);
            await page.evaluate(() => {
                const ship = spawnShip(6);
                ship.x = 40;
                explode(ship.x + SHIP_W / 2, cellCenter(ship.row), 'player');
                draw();
            });
            await expect(page.locator('#score')).toHaveText('200');
        });
    });

    // -----------------------------------------------------------------------
    // Repair phase
    // -----------------------------------------------------------------------
    test.describe('repair phase', () => {
        test('the repair phase deals a current and a next piece', async ({ page }) => {
            await startInPhase(page, 'repair');
            const pieces = await page.evaluate(() => ({
                current: currentPiece.cells.length,
                next: nextPiece.cells.length,
            }));
            expect(pieces.current).toBeGreaterThan(0);
            expect(pieces.next).toBeGreaterThan(0);
        });

        test('pieces are normalised to the origin', async ({ page }) => {
            await startInPhase(page, 'repair');
            const mins = await page.evaluate(() => [
                Math.min(...currentPiece.cells.map((c) => c[0])),
                Math.min(...currentPiece.cells.map((c) => c[1])),
            ]);
            expect(mins).toEqual([0, 0]);
        });

        test('placing a piece turns its cells into wall', async ({ page }) => {
            await startInPhase(page, 'repair');
            const result = await page.evaluate(() => {
                const cells = currentPiece.cells.map(([dc, dr]) => [22 + dc, 2 + dr]);
                const ok = placePiece(22, 2);
                return { ok, walls: cells.map(([c, r]) => structures[r][c]) };
            });
            expect(result.ok).toBe(true);
            expect(result.walls.every((s) => s === 1)).toBe(true);
        });

        test('placing a piece advances the queue', async ({ page }) => {
            await startInPhase(page, 'repair');
            const names = await page.evaluate(() => {
                const wasNext = nextPiece.name;
                placePiece(22, 2);
                return { wasNext, current: currentPiece.name, hasNext: !!nextPiece };
            });
            expect(names.current).toBe(names.wasNext);
            expect(names.hasNext).toBe(true);
        });

        test('pieces cannot be placed in the sea', async ({ page }) => {
            await startInPhase(page, 'repair');
            expect(await page.evaluate(() => placePiece(0, 0))).toBe(false);
        });

        test('pieces cannot overlap existing structures', async ({ page }) => {
            await startInPhase(page, 'repair');
            expect(
                await page.evaluate(() => placePiece(castles[1].col, castles[1].row))
            ).toBe(false);
        });

        test('pieces cannot hang off the edge of the board', async ({ page }) => {
            await startInPhase(page, 'repair');
            const results = await page.evaluate(() => [
                placePiece(COLS - 1, 2),
                placePiece(22, ROWS - 1),
            ]);
            expect(results).toEqual([false, false]);
        });

        test('pieces cannot be placed outside the repair phase', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => placePiece(22, 2))).toBe(false);
        });

        test('rotating keeps the piece size and normalisation', async ({ page }) => {
            await startInPhase(page, 'repair');
            const info = await page.evaluate(() => {
                const before = currentPiece.cells.length;
                rotatePiece();
                return {
                    before,
                    after: currentPiece.cells.length,
                    minC: Math.min(...currentPiece.cells.map((c) => c[0])),
                    minR: Math.min(...currentPiece.cells.map((c) => c[1])),
                };
            });
            expect(info.after).toBe(info.before);
            expect([info.minC, info.minR]).toEqual([0, 0]);
        });

        test('four rotations return a piece to its starting shape', async ({ page }) => {
            await startInPhase(page, 'repair');
            const same = await page.evaluate(() => {
                const key = (p) =>
                    p.cells
                        .map((c) => c.join(','))
                        .sort()
                        .join(' ');
                const start = key(currentPiece);
                for (let i = 0; i < 4; i++) rotatePiece();
                return start === key(currentPiece);
            });
            expect(same).toBe(true);
        });

        test('rotation actually changes a non-square piece', async ({ page }) => {
            await startInPhase(page, 'repair');
            const changed = await page.evaluate(() => {
                const key = (p) =>
                    p.cells
                        .map((c) => c.join(','))
                        .sort()
                        .join(' ');
                // Skip past the symmetric pieces to find one that turns.
                for (let i = 0; i < 12; i++) {
                    const before = key(currentPiece);
                    rotatePiece();
                    if (key(currentPiece) !== before) return true;
                    placePiece(22 + ((i * 2) % 4), 2 + i);
                }
                return false;
            });
            expect(changed).toBe(true);
        });

        test('repair work can seal a breach blown open in the battle', async ({ page }) => {
            await startInPhase(page, 'battle');
            await page.evaluate(() => {
                structures[RING.top][RING.left + 2] = EMPTY;
                endPhase(); // into repair
            });
            const sealed = await page.evaluate(() => {
                currentPiece = makePiece('dot');
                const ok = placePiece(RING.left + 2, RING.top);
                computeOutside();
                return { ok, enclosed: isEnclosed(castles[1]) };
            });
            expect(sealed).toEqual({ ok: true, enclosed: true });
        });
    });

    // -----------------------------------------------------------------------
    // Round progression
    // -----------------------------------------------------------------------
    test.describe('round progression', () => {
        test('holding a castle advances to the next round', async ({ page }) => {
            await startInPhase(page, 'repair');
            const after = await page.evaluate(() => {
                endPhase();
                return { round, phase };
            });
            expect(after).toEqual({ round: 2, phase: 'place' });
        });

        test('each surviving castle pays a bonus', async ({ page }) => {
            await startInPhase(page, 'repair');
            const scored = await page.evaluate(() => {
                score = 0;
                endPhase();
                return { score, bonus: CASTLE_BONUS };
            });
            expect(scored.score).toBe(scored.bonus);
            expect(scored.bonus).toBeGreaterThan(0);
        });

        test('holding more castles grants more cannons', async ({ page }) => {
            await startInPhase(page, 'repair');
            const allowance = await page.evaluate(() => {
                // Wall in a second castle so two are held at the checkpoint.
                const k = castles[0];
                for (let c = k.col - 1; c <= k.col + k.size; c++) {
                    structures[k.row - 1][c] = WALL;
                    structures[k.row + k.size][c] = WALL;
                }
                for (let r = k.row - 1; r <= k.row + k.size; r++) {
                    structures[r][k.col - 1] = WALL;
                    structures[r][k.col + k.size] = WALL;
                }
                endPhase();
                return { cannonsLeft, held: castles.filter((c) => isEnclosed(c)).length };
            });
            expect(allowance).toEqual({ cannonsLeft: 4, held: 2 });
        });

        test('losing every castle ends the game', async ({ page }) => {
            await startInPhase(page, 'repair');
            const over = await page.evaluate(() => {
                structures[RING.top][RING.left + 2] = EMPTY;
                endPhase();
                return state;
            });
            expect(over).toBe('over');
        });

        test('the game-over overlay reports the score', async ({ page }) => {
            await startInPhase(page, 'repair');
            await page.evaluate(() => {
                score = 1234;
                structures[RING.top][RING.left + 2] = EMPTY;
                endPhase();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|fallen/i);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('the best score is kept in localStorage', async ({ page }) => {
            await startInPhase(page, 'repair');
            await page.evaluate(() => {
                score = 5150;
                structures[RING.top][RING.left + 2] = EMPTY;
                endPhase();
            });
            const best = await page.evaluate(() => window.localStorage.getItem('rampart-best'));
            expect(best).toBe('5150');
        });

        test('the simulation stops once the game is over', async ({ page }) => {
            await startInPhase(page, 'repair');
            await page.evaluate(() => {
                structures[RING.top][RING.left + 2] = EMPTY;
                endPhase();
            });
            const before = await page.evaluate(() => phaseTime);
            await advanceSeconds(page, 3);
            expect(await page.evaluate(() => phaseTime)).toBe(before);
        });

        test('later rounds send more ships', async ({ page }) => {
            const counts = await page.evaluate(() => [1, 5].map((r) => shipsForRound(r)));
            expect(counts[1]).toBeGreaterThan(counts[0]);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes the run', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await expect.poll(() => page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            await expect.poll(() => page.evaluate(() => state)).toBe('running');
        });

        test('the clock is frozen while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => togglePause());
            const before = await page.evaluate(() => phaseTime);
            await advanceSeconds(page, 3);
            expect(await page.evaluate(() => phaseTime)).toBe(before);
        });

        test('pausing shows the overlay', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => togglePause());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });
    });

    // -----------------------------------------------------------------------
    // Input
    // -----------------------------------------------------------------------
    test.describe('input', () => {
        test('the arrow keys walk the cursor around the board', async ({ page }) => {
            await startQuiet(page);
            const start = await page.evaluate(() => ({ ...cursor }));
            await page.keyboard.press('ArrowRight');
            await expect
                .poll(() => page.evaluate(() => cursor.col))
                .toBe(start.col + 1);
            await page.keyboard.press('ArrowDown');
            await expect.poll(() => page.evaluate(() => cursor.row)).toBe(start.row + 1);
        });

        test('the cursor stays on the board', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                cursor.col = 0;
                cursor.row = 0;
            });
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowUp');
            const at = await page.evaluate(() => ({ ...cursor }));
            expect(at).toEqual({ col: 0, row: 0 });
        });

        test('Space places a cannon at the cursor', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                cursor.col = RING.left + 1;
                cursor.row = RING.top + 1;
            });
            await page.keyboard.press('Space');
            await expect.poll(() => page.evaluate(() => cannons.length)).toBe(1);
        });

        test('Space fires during the battle', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeCannon(RING.left + 1, RING.top + 1);
                endPhase();
                cursor.col = 2;
                cursor.row = RING.top + 1;
            });
            await page.keyboard.press('Space');
            await expect.poll(() => page.evaluate(() => shots.length)).toBe(1);
        });

        test('R rotates the repair piece', async ({ page }) => {
            await startInPhase(page, 'repair');
            await page.evaluate(() => {
                // Park a piece that visibly turns under rotation.
                currentPiece = makePiece('L');
            });
            const before = await page.evaluate(() =>
                currentPiece.cells.map((c) => c.join(',')).sort().join(' ')
            );
            await page.keyboard.press('r');
            await expect
                .poll(() =>
                    page.evaluate(() =>
                        currentPiece.cells.map((c) => c.join(',')).sort().join(' ')
                    )
                )
                .not.toBe(before);
        });

        test('moving the mouse moves the cursor', async ({ page }) => {
            await startQuiet(page);
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 250 + 0.5, box.y + 150 + 0.5);
            await expect.poll(() => page.evaluate(() => cursor.col)).toBe(12);
            expect(await page.evaluate(() => cursor.row)).toBe(7);
        });

        test('clicking the canvas places a cannon', async ({ page }) => {
            await startQuiet(page);
            const box = await page.locator('#canvas').boundingBox();
            const target = await page.evaluate(() => ({
                x: (RING.left + 1) * CELL + 2,
                y: (RING.top + 1) * CELL + 2,
            }));
            await page.mouse.click(box.x + target.x, box.y + target.y);
            await expect.poll(() => page.evaluate(() => cannons.length)).toBe(1);
        });

        test('right-clicking rotates the repair piece', async ({ page }) => {
            await startInPhase(page, 'repair');
            await page.evaluate(() => {
                currentPiece = makePiece('L');
            });
            const before = await page.evaluate(() =>
                currentPiece.cells.map((c) => c.join(',')).sort().join(' ')
            );
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + 460, box.y + 60, { button: 'right' });
            await expect
                .poll(() =>
                    page.evaluate(() =>
                        currentPiece.cells.map((c) => c.join(',')).sort().join(' ')
                    )
                )
                .not.toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('draw() paints something on the canvas', async ({ page }) => {
            const painted = await page.evaluate(() => {
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(painted).toBeGreaterThan(3);
        });

        test('draw() runs in every phase without throwing', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                for (let i = 0; i < 4; i++) {
                    draw();
                    endPhase();
                }
                draw();
            });
        });

        test('the animation loop keeps running on its own', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                shipSpawnEnabled = false;
            });
            const before = await page.evaluate(() => phaseTime);
            await page.waitForTimeout(400);
            const after = await page.evaluate(() => phaseTime);
            expect(after).toBeLessThan(before);
        });
    });
});
