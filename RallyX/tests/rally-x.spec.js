const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Tiny hand-built courses used to put cars in an exact situation.
// '#' wall  '.' road  'F' flag  'S' special flag  'P' player  'E' chaser
const CORRIDOR = [
    '##########',
    '#P.......#',
    '##########',
];

const JUNCTION = [
    '#####',
    '##.##',
    '#.P.#',
    '##.##',
    '#####',
];

const TWO_FLAGS = [
    '##########',
    '#P.F.F...#',
    '##########',
];

// Three flags, so collecting two of them does not clear the round.
const SPECIAL = [
    '##########',
    '#P.S.F.F.#',
    '##########',
];

const ONE_FLAG = [
    '##########',
    '#P.F.....#',
    '##########',
];

const CHASE = [
    '##########',
    '#P......E#',
    '##########',
];

const SMOKE_LANE = [
    '##########',
    '#P...E...#',
    '##########',
];

/** Drive the simulation until `expr` (evaluated in the page) is true, or time out. */
async function runUntil(page, expr, { slice = 0.05, maxFrames = 400 } = {}) {
    const reached = await page.evaluate(
        ([src, dt, max]) => {
            const done = new Function(`return (${src});`);
            for (let i = 0; i < max; i++) {
                if (done()) return true;
                step(dt);
            }
            return done();
        },
        [expr, slice, maxFrames],
    );
    expect(reached, `condition never became true: ${expr}`).toBe(true);
}

/** Drive the simulation for `seconds` in small fixed slices. */
async function run(page, seconds, slice = 0.05) {
    await page.evaluate(
        ([total, dt]) => {
            // Exact slice count: accumulating floats would silently drop one.
            const frames = Math.round(total / dt);
            for (let i = 0; i < frames; i++) step(dt);
        },
        [seconds, slice],
    );
}

test.describe('Rally-X', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // Detach the simulation from requestAnimationFrame: every test advances
        // it itself through step(dt), so nothing depends on wall-clock timing.
        await page.evaluate(() => setAutoStep(false));
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Rally-X', async ({ page }) => {
            await expect(page).toHaveTitle('Rally-X');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600x360', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '360');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('rally-x-best', '7300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7300');
        });

        test('step() does nothing while idle', async ({ page }) => {
            const before = await page.evaluate(() => ({ x: player.x, y: player.y }));
            await run(page, 1);
            const after = await page.evaluate(() => ({ x: player.x, y: player.y }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Courses
    // -----------------------------------------------------------------------
    test.describe('courses', () => {
        test('there are three built-in courses', async ({ page }) => {
            expect(await page.evaluate(() => LEVELS.length)).toBe(3);
        });

        test('every built-in course is a rectangle of 24x18 cells', async ({ page }) => {
            const shapes = await page.evaluate(() =>
                LEVELS.map((lines) => ({
                    rows: lines.length,
                    widths: [...new Set(lines.map((l) => l.length))],
                })),
            );
            for (const shape of shapes) {
                expect(shape.rows).toBe(18);
                expect(shape.widths).toEqual([24]);
            }
        });

        test('every built-in course has flags, one special flag and chaser spawns', async ({ page }) => {
            const counts = await page.evaluate(() =>
                LEVELS.map((lines) => {
                    const all = lines.join('');
                    const n = (ch) => [...all].filter((c) => c === ch).length;
                    return { flags: n('F'), special: n('S'), player: n('P'), chasers: n('E') };
                }),
            );
            for (const c of counts) {
                expect(c.flags).toBeGreaterThanOrEqual(6);
                expect(c.special).toBe(1);
                expect(c.player).toBe(1);
                expect(c.chasers).toBeGreaterThanOrEqual(3);
            }
        });

        test('every road cell of every course is reachable from the player spawn', async ({ page }) => {
            const unreachable = await page.evaluate(() => {
                const results = [];
                for (let n = 1; n <= LEVELS.length; n++) {
                    loadLevel(n);
                    const open = [];
                    for (let y = 0; y < ROWS; y++) {
                        for (let x = 0; x < COLS; x++) if (isOpen(x, y)) open.push(`${x},${y}`);
                    }
                    const seen = new Set();
                    const queue = [[Math.round(player.x), Math.round(player.y)]];
                    seen.add(`${queue[0][0]},${queue[0][1]}`);
                    while (queue.length) {
                        const [cx, cy] = queue.pop();
                        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                            const nx = cx + dx;
                            const ny = cy + dy;
                            const key = `${nx},${ny}`;
                            if (isOpen(nx, ny) && !seen.has(key)) {
                                seen.add(key);
                                queue.push([nx, ny]);
                            }
                        }
                    }
                    results.push(open.filter((k) => !seen.has(k)));
                }
                return results;
            });
            expect(unreachable).toEqual([[], [], []]);
        });

        test('the course world is larger than the maze viewport, so it scrolls', async ({ page }) => {
            const size = await page.evaluate(() => {
                loadLevel(1);
                return { w: COLS * TILE, h: ROWS * TILE, vw: VIEW_W, vh: VIEW_H };
            });
            expect(size.w).toBeGreaterThan(size.vw);
            expect(size.h).toBeGreaterThan(size.vh);
        });

        test('levels cycle back through the courses', async ({ page }) => {
            const first = await page.evaluate(() => {
                loadLevel(1);
                return grid.map((row) => row.join('')).join('|');
            });
            const fourth = await page.evaluate(() => {
                loadLevel(4);
                return grid.map((row) => row.join('')).join('|');
            });
            expect(fourth).toBe(first);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a new game has full fuel, three lives and level 1', async ({ page }) => {
            await page.evaluate(() => startGame());
            const s = await page.evaluate(() => ({ fuel, lives, level, score }));
            expect(s.fuel).toBe(100);
            expect(s.lives).toBe(3);
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
        });

        test('a new game puts flags and chasers on the course', async ({ page }) => {
            await page.evaluate(() => startGame());
            const s = await page.evaluate(() => ({ flags: flags.length, chasers: enemies.length }));
            expect(s.flags).toBeGreaterThanOrEqual(7);
            expect(s.chasers).toBe(2);
        });

        test('later levels send out more chasers', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const out = [];
                for (const n of [1, 2, 3]) {
                    loadLevel(n);
                    out.push(enemies.length);
                }
                return out;
            });
            expect(counts[1]).toBeGreaterThan(counts[0]);
            expect(counts[2]).toBeGreaterThan(counts[1]);
        });

        test('later levels send out faster chasers, but never faster than the player', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                const out = [];
                for (const n of [1, 2, 6]) {
                    loadLevel(n);
                    out.push(enemySpeed());
                }
                return { out, player: PLAYER_SPEED };
            });
            expect(speeds.out[1]).toBeGreaterThan(speeds.out[0]);
            expect(speeds.out[2]).toBeLessThan(speeds.player);
        });

        test('the HUD reflects a fresh game', async ({ page }) => {
            await page.evaluate(() => startGame());
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#fuel')).toHaveText('100');
        });
    });

    // -----------------------------------------------------------------------
    // Driving
    // -----------------------------------------------------------------------
    test.describe('driving', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
            }, CORRIDOR);
        });

        test('the car starts on its spawn cell', async ({ page }) => {
            const p = await page.evaluate(() => ({ x: player.x, y: player.y }));
            expect(p).toEqual({ x: 1, y: 1 });
        });

        test('the car drives right at the player speed', async ({ page }) => {
            await page.evaluate(() => setInput(1, 0));
            await run(page, 0.5);
            expect(await page.evaluate(() => player.x)).toBeCloseTo(1 + 0.5 * 4, 3);
        });

        test('the car stops at a wall instead of driving through it', async ({ page }) => {
            await page.evaluate(() => setInput(-1, 0));
            await run(page, 2);
            expect(await page.evaluate(() => player.x)).toBeCloseTo(1, 5);
        });

        test('a huge time step cannot tunnel the car through a wall', async ({ page }) => {
            await page.evaluate(() => {
                setInput(1, 0);
                step(10);
            });
            const p = await page.evaluate(() => ({ x: player.x, y: player.y }));
            expect(p.x).toBeLessThanOrEqual(8);
            expect(await page.evaluate(() => isOpen(Math.round(player.x), Math.round(player.y)))).toBe(true);
        });

        test('the car can reverse in the middle of a cell', async ({ page }) => {
            await page.evaluate(() => setInput(1, 0));
            await run(page, 0.1, 0.05);
            const mid = await page.evaluate(() => player.x);
            expect(mid).toBeGreaterThan(1);
            await page.evaluate(() => setInput(-1, 0));
            await run(page, 0.1, 0.05);
            expect(await page.evaluate(() => player.x)).toBeLessThan(mid);
        });

        test('the car keeps driving after the input is released', async ({ page }) => {
            await page.evaluate(() => setInput(1, 0));
            await run(page, 0.25);
            await page.evaluate(() => setInput(0, 0));
            await run(page, 0.25);
            expect(await page.evaluate(() => player.x)).toBeCloseTo(3, 3);
        });

        test('a turn is only taken where the maze allows it', async ({ page }) => {
            await page.evaluate((lines) => loadLevelLines(lines), JUNCTION);
            await page.evaluate(() => setInput(0, 1));
            await run(page, 0.25);
            const p = await page.evaluate(() => ({ x: player.x, y: player.y }));
            expect(p.x).toBeCloseTo(2, 3);
            expect(p.y).toBeCloseTo(3, 3);
        });

        test('steering into a wall leaves the car where it is', async ({ page }) => {
            await page.evaluate((lines) => loadLevelLines(lines), CORRIDOR);
            await page.evaluate(() => setInput(0, -1));
            await run(page, 0.5);
            const p = await page.evaluate(() => ({ x: player.x, y: player.y }));
            expect(p).toEqual({ x: 1, y: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard
    // -----------------------------------------------------------------------
    test.describe('keyboard', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
            }, CORRIDOR);
        });

        test('ArrowRight steers right', async ({ page }) => {
            await page.keyboard.down('ArrowRight');
            await run(page, 0.25);
            expect(await page.evaluate(() => player.x)).toBeCloseTo(2, 3);
        });

        test('D steers right', async ({ page }) => {
            await page.keyboard.down('d');
            await run(page, 0.25);
            expect(await page.evaluate(() => player.x)).toBeCloseTo(2, 3);
        });

        test('releasing the key stops the steering input, not the car', async ({ page }) => {
            await page.keyboard.down('ArrowRight');
            await run(page, 0.25);
            await page.keyboard.up('ArrowRight');
            const input = await page.evaluate(() => ({ x: wantDir.x, y: wantDir.y }));
            expect(input).toEqual({ x: 0, y: 0 });
        });

        test('Space drops smoke while playing', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => smokes.length)).toBe(1);
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Flags and scoring
    // -----------------------------------------------------------------------
    test.describe('flags', () => {
        test('driving over a flag scores and removes it', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setInput(1, 0);
            }, TWO_FLAGS);
            await run(page, 0.5);
            const s = await page.evaluate(() => ({ score, flags: flags.length, level }));
            expect(s.score).toBe(100);
            expect(s.flags).toBe(1);
            expect(s.level).toBe(1);
        });

        test('the flag counter in the HUD tracks the flags left', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
            }, TWO_FLAGS);
            await expect(page.locator('#flags')).toHaveText('2');
            await page.evaluate(() => setInput(1, 0));
            await run(page, 0.5);
            await expect(page.locator('#flags')).toHaveText('1');
        });

        test('the special flag doubles the value of later flags', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setInput(1, 0);
            }, SPECIAL);
            await run(page, 0.5);
            expect(await page.evaluate(() => score)).toBe(100);
            expect(await page.evaluate(() => flagValue)).toBe(200);
            await run(page, 0.5);
            expect(await page.evaluate(() => score)).toBe(300);
        });

        test('clearing every flag advances to the next course', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setInput(1, 0);
            }, ONE_FLAG);
            await runUntil(page, 'level > 1');
            const s = await page.evaluate(() => ({ level, flags: flags.length, fuel }));
            expect(s.level).toBe(2);
            expect(s.flags).toBeGreaterThan(1);
            expect(s.fuel).toBe(100);
        });

        test('clearing a round pays a bonus for the fuel left in the tank', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setFuel(50);
                setInput(1, 0);
            }, ONE_FLAG);
            await run(page, 0.5);
            // 100 for the flag + 10 per unit of the ~50 fuel left at pickup.
            const total = await page.evaluate(() => score);
            expect(total).toBeGreaterThan(100 + 480);
            expect(total).toBeLessThanOrEqual(100 + 500);
        });

        test('the flag value resets with each new round', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                flagValue = 200;
                setInput(1, 0);
            }, ONE_FLAG);
            await run(page, 0.5);
            expect(await page.evaluate(() => flagValue)).toBe(100);
        });
    });

    // -----------------------------------------------------------------------
    // Smoke screen
    // -----------------------------------------------------------------------
    test.describe('smoke screen', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
            }, SMOKE_LANE);
        });

        test('dropping smoke leaves a puff at the car and burns fuel', async ({ page }) => {
            const ok = await page.evaluate(() => dropSmoke());
            expect(ok).toBe(true);
            const s = await page.evaluate(() => ({
                count: smokes.length,
                x: smokes[0].x,
                y: smokes[0].y,
                fuel,
            }));
            expect(s.count).toBe(1);
            expect(s.x).toBeCloseTo(1, 3);
            expect(s.y).toBeCloseTo(1, 3);
            expect(s.fuel).toBeCloseTo(100 - 4, 3);
        });

        test('smoke cannot be dropped twice in the same instant', async ({ page }) => {
            await page.evaluate(() => dropSmoke());
            expect(await page.evaluate(() => dropSmoke())).toBe(false);
            expect(await page.evaluate(() => smokes.length)).toBe(1);
        });

        test('smoke can be dropped again after the cooldown', async ({ page }) => {
            await page.evaluate(() => dropSmoke());
            await run(page, 0.3, 0.05);
            expect(await page.evaluate(() => dropSmoke())).toBe(true);
            expect(await page.evaluate(() => smokes.length)).toBe(2);
        });

        test('smoke cannot be dropped without the fuel for it', async ({ page }) => {
            await page.evaluate(() => setFuel(2));
            expect(await page.evaluate(() => dropSmoke())).toBe(false);
            expect(await page.evaluate(() => smokes.length)).toBe(0);
        });

        test('a puff fades away', async ({ page }) => {
            await page.evaluate(() => dropSmoke());
            await run(page, 2.6, 0.1);
            expect(await page.evaluate(() => smokes.length)).toBe(0);
        });

        test('a chaser driving into smoke spins out', async ({ page }) => {
            await page.evaluate(() => dropSmoke());
            await run(page, 1.5, 0.05);
            const e = await page.evaluate(() => ({ stun: enemies[0].stun, lives }));
            expect(e.stun).toBeGreaterThan(0);
            expect(e.lives).toBe(3);
        });

        test('a spun-out chaser stops moving', async ({ page }) => {
            await page.evaluate(() => dropSmoke());
            await run(page, 1.5, 0.05);
            const before = await page.evaluate(() => enemies[0].x);
            await run(page, 0.5, 0.05);
            expect(await page.evaluate(() => enemies[0].x)).toBeCloseTo(before, 5);
        });

        test('a spun-out chaser is harmless', async ({ page }) => {
            await page.evaluate(() => dropSmoke());
            await run(page, 1.5, 0.05);
            await page.evaluate(() => setInput(1, 0));
            await run(page, 0.5, 0.05);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('a chaser recovers once the spin-out wears off', async ({ page }) => {
            await page.evaluate(() => dropSmoke());
            await run(page, 1.5, 0.05);
            // A chaser parked in the puff keeps being re-stunned until the puff
            // itself fades, so recovery is timed from the end of the smoke.
            await run(page, 4.5, 0.05);
            expect(await page.evaluate(() => enemies[0].stun)).toBe(0);
        });

        test('smoke cannot be dropped while paused', async ({ page }) => {
            await page.evaluate(() => togglePause());
            expect(await page.evaluate(() => dropSmoke())).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Chasers
    // -----------------------------------------------------------------------
    test.describe('chasers', () => {
        test('a chaser closes in on the player', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
            }, CHASE);
            const before = await page.evaluate(() => enemies[0].x - player.x);
            await run(page, 1, 0.05);
            const after = await page.evaluate(() => enemies[0].x - player.x);
            expect(after).toBeLessThan(before);
        });

        test('a chaser never leaves the road', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                setInput(1, 0);
            });
            await run(page, 4, 0.05);
            const offRoad = await page.evaluate(() =>
                enemies.filter((e) => !isOpen(Math.round(e.x), Math.round(e.y))).length,
            );
            expect(offRoad).toBe(0);
        });

        test('being caught costs a life and resets the cars', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
            }, CHASE);
            await runUntil(page, 'lives < 3');
            const s = await page.evaluate(() => ({
                lives,
                px: player.x,
                ex: enemies[0].x,
                fuel,
            }));
            expect(s.lives).toBe(2);
            expect(s.px).toBeCloseTo(1, 3);
            expect(s.ex).toBeCloseTo(8, 3);
            expect(s.fuel).toBe(100);
        });

        test('flags already collected survive losing a life', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                loadLevelLines([
                    '##########',
                    '#P.F.F..E#',
                    '##########',
                ]);
                setInput(1, 0);
            });
            await run(page, 0.5, 0.05);
            expect(await page.evaluate(() => score)).toBe(100);
            // Reverse into the left wall so the car parks and waits to be caught.
            await page.evaluate(() => setInput(-1, 0));
            await run(page, 4, 0.05);
            const s = await page.evaluate(() => ({ lives, flags: flags.length, score, level }));
            expect(s.lives).toBe(2);
            expect(s.flags).toBe(1);
            expect(s.score).toBe(100);
            expect(s.level).toBe(1);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setLives(1);
            }, CHASE);
            await run(page, 4, 0.05);
            expect(await page.evaluate(() => state)).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
            }, CORRIDOR);
        });

        test('fuel drains while driving', async ({ page }) => {
            await run(page, 2, 0.1);
            expect(await page.evaluate(() => fuel)).toBeCloseTo(100 - 2 * 1.8, 3);
        });

        test('the fuel gauge in the HUD follows the tank', async ({ page }) => {
            await page.evaluate(() => setFuel(42));
            await expect(page.locator('#fuel')).toHaveText('42');
        });

        test('running dry costs a life and refills the tank', async ({ page }) => {
            await page.evaluate(() => setFuel(0.5));
            await runUntil(page, 'lives < 3');
            const s = await page.evaluate(() => ({ lives, fuel }));
            expect(s.lives).toBe(2);
            expect(s.fuel).toBe(100);
        });

        test('running dry on the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                setLives(1);
                setFuel(0.5);
            });
            await run(page, 1, 0.1);
            expect(await page.evaluate(() => state)).toBe('gameover');
        });

        test('fuel never drops below zero', async ({ page }) => {
            await page.evaluate(() => setFuel(0.2));
            await run(page, 1, 0.1);
            expect(await page.evaluate(() => fuel)).toBeGreaterThanOrEqual(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setInput(1, 0);
            }, CORRIDOR);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => togglePause());
            const before = await page.evaluate(() => ({ x: player.x, fuel }));
            await run(page, 1, 0.1);
            const after = await page.evaluate(() => ({ x: player.x, fuel }));
            expect(after).toEqual(before);
        });

        test('the pause overlay explains itself', async ({ page }) => {
            await page.evaluate(() => togglePause());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('pausing cannot be toggled when the game is over', async ({ page }) => {
            await page.evaluate(() => {
                setLives(1);
                setFuel(0.1);
                step(0.2);
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
            await page.evaluate(() => togglePause());
            expect(await page.evaluate(() => state)).toBe('gameover');
        });
    });

    // -----------------------------------------------------------------------
    // Game over and restarting
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setInput(1, 0);
            }, TWO_FLAGS);
        });

        test('the overlay shows the final score', async ({ page }) => {
            await run(page, 0.5, 0.05);   // collect a flag, worth 100
            await page.evaluate(() => {
                setLives(1);
                setFuel(0.1);
                step(0.2);
            });
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
            await expect(page.locator('#overlay-score')).toContainText('100');
        });

        test('the best score is kept and stored', async ({ page }) => {
            await run(page, 0.5, 0.05);
            await page.evaluate(() => {
                setLives(1);
                setFuel(0.1);
                step(0.2);
            });
            await expect(page.locator('#best')).toHaveText('100');
            expect(await page.evaluate(() => window.localStorage.getItem('rally-x-best'))).toBe('100');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('rally-x-best', '5000'));
            await page.reload();
            await page.evaluate(() => setAutoStep(false));
            await page.evaluate(() => {
                startGame();
                setLives(1);
                setFuel(0.1);
                step(0.2);
            });
            await expect(page.locator('#best')).toHaveText('5000');
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                setLives(1);
                setFuel(0.1);
                step(0.2);
            });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, score, lives, level, fuel }));
            expect(s.state).toBe('running');
            expect(s.score).toBe(0);
            expect(s.lives).toBe(3);
            expect(s.level).toBe(1);
            expect(s.fuel).toBe(100);
        });

        test('step() does nothing once the game is over', async ({ page }) => {
            await page.evaluate(() => {
                setLives(1);
                setFuel(0.1);
                step(0.2);
            });
            const before = await page.evaluate(() => ({ x: player.x, fuel }));
            await run(page, 1, 0.1);
            expect(await page.evaluate(() => ({ x: player.x, fuel }))).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the maze viewport scrolls to follow the car', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                setInput(1, 0);
            });
            const before = await page.evaluate(() => camera.x);
            await run(page, 2, 0.05);
            expect(await page.evaluate(() => camera.x)).toBeGreaterThan(before);
        });

        test('the camera never scrolls past the edge of the course', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                setInput(-1, 0);
            });
            await run(page, 6, 0.05);
            const cam = await page.evaluate(() => ({
                x: camera.x,
                y: camera.y,
                maxX: COLS * TILE - VIEW_W,
                maxY: ROWS * TILE - VIEW_H,
            }));
            expect(cam.x).toBeGreaterThanOrEqual(0);
            expect(cam.y).toBeGreaterThanOrEqual(0);
            expect(cam.x).toBeLessThanOrEqual(cam.maxX);
            expect(cam.y).toBeLessThanOrEqual(cam.maxY);
        });

        test('a course smaller than the viewport is centred, not scrolled', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
            }, CORRIDOR);
            await run(page, 0.2, 0.05);
            const cam = await page.evaluate(() => ({ x: camera.x, y: camera.y }));
            expect(cam.x).toBeLessThanOrEqual(0);
            expect(cam.y).toBeLessThanOrEqual(0);
        });

        test('the canvas is actually painted', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                draw();
            });
            const painted = await page.evaluate(() => {
                const ctx = document.getElementById('canvas').getContext('2d');
                const data = ctx.getImageData(0, 0, 600, 360).data;
                const colours = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return colours.size;
            });
            expect(painted).toBeGreaterThan(3);
        });
    });
});
