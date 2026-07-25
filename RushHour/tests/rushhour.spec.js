const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// A blank 6-row grid with a helper to drop vehicles onto it for tests.
const BLANK = ['......', '......', '......', '......', '......', '......'];

test.describe('Rush Hour', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => localStorage.clear());
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Rush Hour', async ({ page }) => {
            await expect(page).toHaveTitle('Rush Hour');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('red');
        });

        test('moves start at 0', async ({ page }) => {
            await expect(page.locator('#moves')).toHaveText('0');
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('best starts as — when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('canvas is 480×480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('game state is idle before start', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('there is at least one bundled level', async ({ page }) => {
            expect(await page.evaluate(() => LEVELS.length)).toBeGreaterThan(0);
        });

        test('the target car X is present, horizontal, on the exit row', async ({ page }) => {
            const x = await page.evaluate(() => {
                const v = findVehicle(vehicles, 'X');
                return { orient: v.orient, row: v.r, exit: EXIT_ROW };
            });
            expect(x.orient).toBe('H');
            expect(x.row).toBe(x.exit);
        });
    });

    // -----------------------------------------------------------------------
    // Level parsing
    // -----------------------------------------------------------------------
    test.describe('parseLevel', () => {
        test('parses a horizontal car and a vertical truck', async ({ page }) => {
            const vs = await page.evaluate(() => parseLevel([
                'AAB...',
                '..B...',
                'XXB...',
                '......',
                '......',
                '......',
            ]));
            const byId = Object.fromEntries(vs.map(v => [v.id, v]));
            expect(byId.A).toEqual({ id: 'A', r: 0, c: 0, len: 2, orient: 'H' });
            expect(byId.B).toEqual({ id: 'B', r: 0, c: 2, len: 3, orient: 'V' });
            expect(byId.X).toEqual({ id: 'X', r: 2, c: 0, len: 2, orient: 'H' });
        });

        test('ignores dots and returns one object per letter', async ({ page }) => {
            const n = await page.evaluate(() => parseLevel([
                'AA....',
                '......',
                'XX....',
                '......',
                '......',
                '......',
            ]).length);
            expect(n).toBe(2); // A and X
        });
    });

    // -----------------------------------------------------------------------
    // Occupancy grid
    // -----------------------------------------------------------------------
    test.describe('buildGrid', () => {
        test('maps every cell to its vehicle id or null', async ({ page }) => {
            const info = await page.evaluate(() => {
                const vs = parseLevel([
                    'AA....',
                    '......',
                    'XX....',
                    '......',
                    '......',
                    '......',
                ]);
                const g = buildGrid(vs);
                let occupied = 0;
                for (let r = 0; r < CELLS; r++)
                    for (let c = 0; c < CELLS; c++)
                        if (g[r][c] !== null) occupied++;
                return { a00: g[0][0], a01: g[0][1], x20: g[2][0], empty: g[0][2], occupied };
            });
            expect(info.a00).toBe('A');
            expect(info.a01).toBe('A');
            expect(info.x20).toBe('X');
            expect(info.empty).toBe(null);
            expect(info.occupied).toBe(4); // AA + XX
        });
    });

    // -----------------------------------------------------------------------
    // cellsOf
    // -----------------------------------------------------------------------
    test.describe('cellsOf', () => {
        test('lists the cells of a horizontal vehicle left-to-right', async ({ page }) => {
            const cells = await page.evaluate(() =>
                cellsOf({ id: 'X', r: 2, c: 1, len: 2, orient: 'H' }));
            expect(cells).toEqual([[2, 1], [2, 2]]);
        });

        test('lists the cells of a vertical vehicle top-to-bottom', async ({ page }) => {
            const cells = await page.evaluate(() =>
                cellsOf({ id: 'B', r: 0, c: 3, len: 3, orient: 'V' }));
            expect(cells).toEqual([[0, 3], [1, 3], [2, 3]]);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a key starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the starting position is not already solved', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => isWon(vehicles))).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Moving vehicles
    // -----------------------------------------------------------------------
    test.describe('moving a vehicle', () => {
        async function start(page) {
            await page.locator('#btn-start').click();
        }

        test('a horizontal car slides right across free cells', async ({ page }) => {
            await start(page);
            const result = await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', 'XX....', '......', '......', '......']);
                const ok = moveVehicle('X', 3);
                return { ok, c: findVehicle(vehicles, 'X').c };
            });
            expect(result.ok).toBe(true);
            expect(result.c).toBe(3);
        });

        test('a horizontal car slides left', async ({ page }) => {
            await start(page);
            const result = await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', '...XX.', '......', '......', '......']);
                const ok = moveVehicle('X', -2);
                return { ok, c: findVehicle(vehicles, 'X').c };
            });
            expect(result.ok).toBe(true);
            expect(result.c).toBe(1);
        });

        test('a vertical truck slides down', async ({ page }) => {
            await start(page);
            const result = await page.evaluate(() => {
                vehicles = parseLevel(['...B..', '...B..', 'XX.B..', '......', '......', '......']);
                const ok = moveVehicle('B', 3);
                return { ok, r: findVehicle(vehicles, 'B').r };
            });
            expect(result.ok).toBe(true);
            expect(result.r).toBe(3);
        });

        test('a legal move increments the move counter', async ({ page }) => {
            await start(page);
            const moved = await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', 'XX....', '......', '......', '......']);
                window.moves = 0;
                moveVehicle('X', 2);
                return window.moves;
            });
            expect(moved).toBe(1);
        });

        test('a move blocked by another vehicle is rejected', async ({ page }) => {
            await start(page);
            const result = await page.evaluate(() => {
                // Vertical car C sits at (2,2) directly in X's path.
                vehicles = parseLevel(['......', '..C...', 'XXC...', '......', '......', '......']);
                window.moves = 0;
                const ok = moveVehicle('X', 1); // would enter (2,2) which is occupied
                return { ok, c: findVehicle(vehicles, 'X').c, moves: window.moves };
            });
            expect(result.ok).toBe(false);
            expect(result.c).toBe(0);       // unchanged
            expect(result.moves).toBe(0);   // did not count
        });

        test('a move off the edge of the board is rejected', async ({ page }) => {
            await start(page);
            const result = await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', '....XX', '......', '......', '......']);
                const ok = moveVehicle('X', 1); // (2,5) is the right wall — no room
                return { ok, c: findVehicle(vehicles, 'X').c };
            });
            expect(result.ok).toBe(false);
            expect(result.c).toBe(4); // unchanged
        });

        test('a vehicle cannot move perpendicular to its orientation', async ({ page }) => {
            await start(page);
            const okDown = await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', 'XX....', '......', '......', '......']);
                // moveVehicle only slides along the axis; there is no way to ask a
                // horizontal car to change rows, so its row is invariant.
                moveVehicle('X', 2);
                return findVehicle(vehicles, 'X').r;
            });
            expect(okDown).toBe(2); // still on the exit row
        });

        test('moving does nothing when not playing', async ({ page }) => {
            const result = await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', 'XX....', '......', '......', '......']);
                window.moves = 0;
                const ok = moveVehicle('X', 2);
                return { ok, moves: window.moves };
            });
            expect(result.ok).toBe(false);
            expect(result.moves).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // canMove (pure)
    // -----------------------------------------------------------------------
    test.describe('canMove', () => {
        test('true when the path is clear', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const vs = parseLevel(['......', '......', 'XX....', '......', '......', '......']);
                return canMove(vs, 'X', 4);
            });
            expect(ok).toBe(true);
        });

        test('false when a cell in the path is occupied', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const vs = parseLevel(['......', '...C..', 'XX.C..', '......', '......', '......']);
                return canMove(vs, 'X', 4); // (2,3) is occupied by C
            });
            expect(ok).toBe(false);
        });

        test('false when the move runs off the board', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const vs = parseLevel(['......', '......', 'XX....', '......', '......', '......']);
                return canMove(vs, 'X', 5); // would need column 6
            });
            expect(ok).toBe(false);
        });

        test('a delta of 0 is not a move', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const vs = parseLevel(['......', '......', 'XX....', '......', '......', '......']);
                return canMove(vs, 'X', 0);
            });
            expect(ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('isWon is true when X reaches the right wall', async ({ page }) => {
            const won = await page.evaluate(() =>
                isWon(parseLevel(['......', '......', '....XX', '......', '......', '......'])));
            expect(won).toBe(true);
        });

        test('isWon is false when X is short of the wall', async ({ page }) => {
            const won = await page.evaluate(() =>
                isWon(parseLevel(['......', '......', '...XX.', '......', '......', '......'])));
            expect(won).toBe(false);
        });

        test('sliding X to the exit wins the level', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', '...XX.', '......', '......', '......']);
                moveVehicle('X', 1); // X -> columns 4,5
                return state;
            });
            expect(s).toBe('won');
        });

        test('winning shows the solved overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', '...XX.', '......', '......', '......']);
                moveVehicle('X', 1);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Solved');
        });

        test('no more moves are accepted after winning', async ({ page }) => {
            await page.locator('#btn-start').click();
            const result = await page.evaluate(() => {
                vehicles = parseLevel(['B.....', 'B.....', '...XXX'.slice(0, 6), '......', '......', '......']);
                // Put X two cells from the wall and a spare car B off to the side.
                vehicles = parseLevel(['B.....', 'B.....', '...XX.', '......', '......', '......']);
                moveVehicle('X', 1);          // win
                const movesAtWin = window.moves;
                const ok = moveVehicle('B', 1); // B could slide down, but game is won
                return { ok, movesAtWin, movesNow: window.moves };
            });
            expect(result.ok).toBe(false);
            expect(result.movesNow).toBe(result.movesAtWin);
        });
    });

    // -----------------------------------------------------------------------
    // Best (fewest moves)
    // -----------------------------------------------------------------------
    test.describe('best (fewest moves)', () => {
        test('best updates on a solve and shows the move count', async ({ page }) => {
            await page.locator('#btn-start').click();
            const best = await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', '...XX.', '......', '......', '......']);
                window.moves = 0;
                moveVehicle('X', 1); // solve in 1 move
                return bestEl.textContent;
            });
            expect(best).toBe('1');
        });

        test('best persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            const stored = await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', '...XX.', '......', '......', '......']);
                window.moves = 0;
                moveVehicle('X', 1);
                return localStorage.getItem('rushhour-best');
            });
            expect(parseInt(stored, 10)).toBe(1);
        });

        test('best only improves (a slower solve does not overwrite a faster one)', async ({ page }) => {
            await page.locator('#btn-start').click();
            const best = await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', '...XX.', '......', '......', '......']);
                window.moves = 0;
                moveVehicle('X', 1);         // best = 1
                state = 'playing';
                vehicles = parseLevel(['......', '......', '...XX.', '......', '......', '......']);
                window.moves = 8;
                moveVehicle('X', 1);         // moves becomes 9
                return best;
            });
            expect(best).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Selection and input
    // -----------------------------------------------------------------------
    test.describe('selection and input', () => {
        test('clicking a vehicle selects it', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', 'XX....', '......', '......', '......']);
                draw();
            });
            // X occupies cell (2,0); its centre is (0*80+40, 2*80+40) = (40, 200).
            await page.locator('#canvas').click({ position: { x: 40, y: 200 } });
            expect(await page.evaluate(() => selectedId)).toBe('X');
        });

        test('ArrowRight slides the selected horizontal car right', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', 'XX....', '......', '......', '......']);
                selectedId = 'X';
                draw();
            });
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => findVehicle(vehicles, 'X').c)).toBe(1);
        });

        test('ArrowDown slides the selected vertical truck down', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                vehicles = parseLevel(['...B..', '...B..', 'XX.B..', '......', '......', '......']);
                selectedId = 'B';
                draw();
            });
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => findVehicle(vehicles, 'B').r)).toBe(1);
        });

        test('a horizontal car ignores vertical arrow keys', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                vehicles = parseLevel(['......', '......', 'XX....', '......', '......', '......']);
                selectedId = 'X';
                return findVehicle(vehicles, 'X').r;
            });
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => findVehicle(vehicles, 'X').r)).toBe(r);
        });
    });

    // -----------------------------------------------------------------------
    // Restart / next level
    // -----------------------------------------------------------------------
    test.describe('restart and next level', () => {
        test('R restarts the level, restoring positions and zeroing moves', async ({ page }) => {
            await page.locator('#btn-start').click();
            const restored = await page.evaluate(() => {
                const before = JSON.stringify(vehicles);
                // Make a real move.
                const x = findVehicle(vehicles, 'X');
                const moved = canMove(vehicles, 'X', 1) ? moveVehicle('X', 1) : true;
                restartLevel();
                return { same: JSON.stringify(vehicles) === before, moves };
            });
            expect(restored.same).toBe(true);
            expect(restored.moves).toBe(0);
        });

        test('N advances to the next level and resets moves', async ({ page }) => {
            await page.locator('#btn-start').click();
            const result = await page.evaluate(() => {
                const startLevel = level;
                window.moves = 5;
                nextLevel();
                return { startLevel, afterLevel: level, moves };
            });
            // With more than one level, N moves forward; either way moves reset.
            expect(result.moves).toBe(0);
            if (await page.evaluate(() => LEVELS.length) > 1) {
                expect(result.afterLevel).not.toBe(result.startLevel);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Every bundled level is solvable (BFS over the move graph)
    // -----------------------------------------------------------------------
    test.describe('level integrity', () => {
        test('all bundled levels are solvable and none start solved', async ({ page }) => {
            const results = await page.evaluate(() => {
                function key(vs) {
                    return vs.map(v => `${v.id}:${v.r},${v.c}`).sort().join('|');
                }
                function clone(vs) { return vs.map(v => ({ ...v })); }
                function successors(vs) {
                    const out = [];
                    for (const v of vs) {
                        for (const dir of [1, -1]) {
                            let delta = dir;
                            while (canMove(vs, v.id, delta)) {
                                const nv = clone(vs);
                                const t = nv.find(x => x.id === v.id);
                                if (t.orient === 'H') t.c += delta; else t.r += delta;
                                out.push(nv);
                                delta += dir;
                            }
                        }
                    }
                    return out;
                }
                return LEVELS.map(rows => {
                    const start = parseLevel(rows);
                    if (isWon(start)) return { solvable: false, alreadySolved: true };
                    const seen = new Set([key(start)]);
                    let frontier = [start];
                    for (let depth = 0; depth < 60 && frontier.length; depth++) {
                        const next = [];
                        for (const st of frontier) {
                            for (const nb of successors(st)) {
                                if (isWon(nb)) return { solvable: true, alreadySolved: false };
                                const k = key(nb);
                                if (!seen.has(k)) { seen.add(k); next.push(nb); }
                            }
                        }
                        frontier = next;
                    }
                    return { solvable: false, alreadySolved: false };
                });
            });
            for (const r of results) {
                expect(r.alreadySolved).toBe(false);
                expect(r.solvable).toBe(true);
            }
        });
    });
});
