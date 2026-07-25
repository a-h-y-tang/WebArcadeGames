const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Battleship', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Battleship', async ({ page }) => {
            await expect(page).toHaveTitle('Battleship');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay mentions the fleet', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/fleet/i);
        });

        test('canvas is 660×360', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '660');
            await expect(canvas).toHaveAttribute('height', '360');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the board is 10×10', async ({ page }) => {
            expect(await page.evaluate(() => BOARD)).toBe(10);
        });

        test('the fleet totals 17 cells across five ships', async ({ page }) => {
            const r = await page.evaluate(() => ({
                count: SHIP_DEFS.length,
                cells: SHIP_DEFS.reduce((s, d) => s + d.size, 0),
            }));
            expect(r.count).toBe(5);
            expect(r.cells).toBe(17);
        });
    });

    // -----------------------------------------------------------------------
    // Placement rules
    // -----------------------------------------------------------------------
    test.describe('placement', () => {
        test('the Start button enters the placing phase', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('placing');
        });

        test('a valid placement occupies the ship\'s cells', async ({ page }) => {
            const r = await page.evaluate(() => {
                const b = makeBoard();
                const ok = placeShip(b, 'Destroyer', 2, 3, 4, 'h');
                return { ok, a: b.grid[3][4], b: b.grid[3][5], other: b.grid[3][6] };
            });
            expect(r.ok).toBe(true);
            expect(r.a).not.toBeNull();
            expect(r.b).not.toBeNull();
            expect(r.other).toBeNull();
        });

        test('placement running off the board is rejected', async ({ page }) => {
            const r = await page.evaluate(() => {
                const b = makeBoard();
                return {
                    horiz: canPlace(b, 5, 0, 8, 'h'), // 0,8..0,12 -> off board
                    vert: canPlace(b, 5, 8, 0, 'v'),  // 8,0..12,0 -> off board
                    ok: canPlace(b, 5, 0, 0, 'h'),
                };
            });
            expect(r.horiz).toBe(false);
            expect(r.vert).toBe(false);
            expect(r.ok).toBe(true);
        });

        test('overlapping placement is rejected', async ({ page }) => {
            const r = await page.evaluate(() => {
                const b = makeBoard();
                placeShip(b, 'Cruiser', 3, 5, 5, 'h'); // occupies (5,5),(5,6),(5,7)
                return {
                    overlap: canPlace(b, 2, 5, 6, 'v'), // (5,6),(6,6) hits (5,6)
                    clear: canPlace(b, 2, 7, 5, 'h'),
                };
            });
            expect(r.overlap).toBe(false);
            expect(r.clear).toBe(true);
        });

        test('placing all five ships begins the battle', async ({ page }) => {
            await page.locator('#btn-start').click();
            const st = await page.evaluate(() => {
                // Rows 0..4, each ship horizontal at column 0 — no overlaps.
                for (let i = 0; i < SHIP_DEFS.length; i++) placeCurrent(i, 0);
                return state;
            });
            expect(st).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test('a shot into open water is a miss', async ({ page }) => {
            const res = await page.evaluate(() => {
                const b = makeBoard();
                placeShip(b, 'Destroyer', 2, 0, 0, 'h');
                return fireAt(b, 9, 9);
            });
            expect(res.result).toBe('miss');
            expect(res.sunk).toBeNull();
        });

        test('a shot onto a ship is a hit', async ({ page }) => {
            const res = await page.evaluate(() => {
                const b = makeBoard();
                placeShip(b, 'Destroyer', 2, 0, 0, 'h');
                return fireAt(b, 0, 0);
            });
            expect(res.result).toBe('hit');
            expect(res.sunk).toBeNull();
        });

        test('hitting every cell of a ship sinks it', async ({ page }) => {
            const res = await page.evaluate(() => {
                const b = makeBoard();
                placeShip(b, 'Destroyer', 2, 0, 0, 'h');
                fireAt(b, 0, 0);
                return fireAt(b, 0, 1);
            });
            expect(res.result).toBe('hit');
            expect(res.sunk).not.toBeNull();
        });

        test('firing at the same cell twice is rejected', async ({ page }) => {
            const r = await page.evaluate(() => {
                const b = makeBoard();
                placeShip(b, 'Destroyer', 2, 0, 0, 'h');
                const first = fireAt(b, 5, 5);
                const second = fireAt(b, 5, 5);
                return { first: !!first, second };
            });
            expect(r.first).toBe(true);
            expect(r.second).toBeNull();
        });

        test('isFleetSunk is true only when all ships are down', async ({ page }) => {
            const r = await page.evaluate(() => {
                const b = makeBoard();
                placeShip(b, 'Destroyer', 2, 0, 0, 'h');
                const before = isFleetSunk(b);
                fireAt(b, 0, 0);
                fireAt(b, 0, 1);
                return { before, after: isFleetSunk(b) };
            });
            expect(r.before).toBe(false);
            expect(r.after).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // CPU (deterministic hunt / target)
    // -----------------------------------------------------------------------
    test.describe('CPU', () => {
        test('after a hit the CPU queues the adjacent cells to finish the ship', async ({ page }) => {
            const r = await page.evaluate(() => {
                enemyBoard = makeBoard();
                placeShip(enemyBoard, 'Destroyer', 2, 9, 9, 'h'); // out of the CPU's way
                playerBoard = makeBoard();
                placeShip(playerBoard, 'Destroyer', 2, 0, 0, 'h'); // covers (0,0), the CPU's first parity shot
                aiQueue = [];
                state = 'playing';
                aiTurn(); // CPU hunts (0,0) -> hit, not sunk -> queue neighbours
                return {
                    shotHit: playerBoard.shot[0][0],
                    queue: aiQueue.map((t) => [t.r, t.c]),
                };
            });
            expect(r.shotHit).toBe(true);
            expect(r.queue.length).toBeGreaterThan(0);
            for (const [qr, qc] of r.queue) {
                expect(Math.abs(qr - 0) + Math.abs(qc - 0)).toBe(1); // orthogonally adjacent to (0,0)
            }
        });
    });

    // -----------------------------------------------------------------------
    // Winning & losing
    // -----------------------------------------------------------------------
    test.describe('win and lose', () => {
        test('sinking the enemy fleet wins the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                enemyBoard = makeBoard();
                placeShip(enemyBoard, 'Destroyer', 2, 0, 0, 'h');
                playerBoard = makeBoard();
                placeShip(playerBoard, 'Destroyer', 2, 5, 5, 'h');
                aiQueue = [];
                shotsFired = 0;
                state = 'playing';
                result = null;
                playerFire(0, 0);
                playerFire(0, 1); // sinks the enemy's only ship
                return { state, result };
            });
            expect(r.state).toBe('over');
            expect(r.result).toBe('win');
            await expect(page.locator('#overlay-title')).toContainText(/win/i);
        });

        test('losing your fleet ends the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                // Enemy fleet is far away and stays afloat; player fires misses.
                enemyBoard = makeBoard();
                placeShip(enemyBoard, 'Cruiser', 3, 9, 0, 'h');
                // Player has a lone destroyer on the CPU's first two target cells.
                // Vertical, so it lies along (0,0)->(1,0): the CPU hunts (0,0),
                // then its first queued neighbour (1,0) finishes the ship.
                playerBoard = makeBoard();
                placeShip(playerBoard, 'Destroyer', 2, 0, 0, 'v');
                aiQueue = [];
                shotsFired = 0;
                state = 'playing';
                result = null;
                playerFire(5, 5); // miss -> CPU hits (0,0)
                playerFire(6, 6); // miss -> CPU fires the queued neighbour, sinks (0,1)
                return { state, result };
            });
            expect(r.state).toBe('over');
            expect(r.result).toBe('lose');
            await expect(page.locator('#overlay-title')).toContainText(/over|lose/i);
        });

        test('you cannot fire before the battle starts', async ({ page }) => {
            const r = await page.evaluate(() => {
                state = 'placing';
                return playerFire(0, 0);
            });
            expect(r).toBeNull();
        });
    });
});
