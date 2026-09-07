const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

const KEY_DIR = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    a: { x: -1, y: 0 },
    d: { x: 1, y: 0 },
    w: { x: 0, y: -1 },
    s: { x: 0, y: 1 },
};

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so every press is confirmed against the game state before the simulation
// is advanced. Without this the specs race the real animation loop.
const press = async (page, key) => {
    await page.keyboard.press(key);
    await page.waitForFunction(
        (want) => player.want.x === want.x && player.want.y === want.y,
        KEY_DIR[key]
    );
};

// Start a run with the pursuers frozen, so long simulations stay deterministic
// and only the specs that are about pursuers have to deal with them.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        enemies.length = 0;
    });

// Park the player on a tile, stopped, so a spec can control exactly what the
// car does next.
const park = (page, r, c) =>
    page.evaluate(([r, c]) => {
        placeAt(player, r, c);
        player.want = { x: 0, y: 0 };
    }, [r, c]);

test.describe('Rally-X', () => {
    const errors = [];

    test.beforeEach(async ({ page }) => {
        errors.length = 0;
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Rally-X', async ({ page }) => {
            await expect(page).toHaveTitle('Rally-X');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 560x460', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('radar canvas mirrors the world at quarter scale', async ({ page }) => {
            const radar = page.locator('#radar');
            await expect(radar).toHaveAttribute('width', '168');
            await expect(radar).toHaveAttribute('height', '136');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level, lives, flags and fuel', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#flags')).toHaveText('10');
            await expect(page.locator('#fuel')).toHaveText('100');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('rallyx-best', '3300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('3300');
        });

        test('help text lists the controls', async ({ page }) => {
            const help = page.locator('.help');
            await expect(help).toContainText(/smoke/i);
            await expect(help).toContainText(/pause/i);
        });

        test('idle simulation does not move the car', async ({ page }) => {
            const before = await page.evaluate(() => ({ x: player.x, y: player.y }));
            await advance(page, 120);
            expect(await page.evaluate(() => ({ x: player.x, y: player.y }))).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Maze
    // -----------------------------------------------------------------------
    test.describe('maze', () => {
        test('grid is COLS x ROWS', async ({ page }) => {
            const dims = await page.evaluate(() => ({
                rows: grid.length,
                cols: grid[0].length,
                ROWS,
                COLS,
            }));
            expect(dims.rows).toBe(dims.ROWS);
            expect(dims.cols).toBe(dims.COLS);
        });

        test('the border is solid wall', async ({ page }) => {
            const openBorder = await page.evaluate(() => {
                const bad = [];
                for (let c = 0; c < COLS; c++) {
                    if (!isWall(0, c)) bad.push([0, c]);
                    if (!isWall(ROWS - 1, c)) bad.push([ROWS - 1, c]);
                }
                for (let r = 0; r < ROWS; r++) {
                    if (!isWall(r, 0)) bad.push([r, 0]);
                    if (!isWall(r, COLS - 1)) bad.push([r, COLS - 1]);
                }
                return bad;
            });
            expect(openBorder).toEqual([]);
        });

        test('every open tile is reachable from every other', async ({ page }) => {
            const result = await page.evaluate(() => {
                const open = [];
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++) if (!isWall(r, c)) open.push([r, c]);
                const seen = new Set([open[0].join(',')]);
                const queue = [open[0]];
                while (queue.length) {
                    const [r, c] = queue.shift();
                    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nr = r + dr, nc = c + dc, key = `${nr},${nc}`;
                        if (isWall(nr, nc) || seen.has(key)) continue;
                        seen.add(key);
                        queue.push([nr, nc]);
                    }
                }
                return { open: open.length, reached: seen.size };
            });
            expect(result.open).toBeGreaterThan(80);
            expect(result.reached).toBe(result.open);
        });

        test('the maze has interior walls, not just a border', async ({ page }) => {
            const interiorWalls = await page.evaluate(() => {
                let n = 0;
                for (let r = 1; r < ROWS - 1; r++)
                    for (let c = 1; c < COLS - 1; c++) if (isWall(r, c)) n++;
                return n;
            });
            expect(interiorWalls).toBeGreaterThan(40);
        });

        test('the car starts on an open tile', async ({ page }) => {
            expect(await page.evaluate(() => isWall(player.r, player.c))).toBe(false);
        });

        test('ten flags sit on distinct open tiles', async ({ page }) => {
            const info = await page.evaluate(() => ({
                count: flags.length,
                onWall: flags.filter((f) => isWall(f.r, f.c)).length,
                distinct: new Set(flags.map((f) => `${f.r},${f.c}`)).size,
                onPlayer: flags.filter((f) => f.r === player.r && f.c === player.c).length,
            }));
            expect(info.count).toBe(10);
            expect(info.onWall).toBe(0);
            expect(info.distinct).toBe(10);
            expect(info.onPlayer).toBe(0);
        });

        test('exactly one flag is the lucky flag', async ({ page }) => {
            expect(await page.evaluate(() => flags.filter((f) => f.special).length)).toBe(1);
        });

        test('pursuers start on open tiles away from the player', async ({ page }) => {
            await page.evaluate(() => startGame());
            const info = await page.evaluate(() => ({
                count: enemies.length,
                onWall: enemies.filter((e) => isWall(e.r, e.c)).length,
                nearest: Math.min(
                    ...enemies.map((e) => Math.hypot(e.x - player.x, e.y - player.y))
                ),
            }));
            expect(info.count).toBeGreaterThanOrEqual(2);
            expect(info.onWall).toBe(0);
            expect(info.nearest).toBeGreaterThan(4 * 32);
        });

        test('each level generates a different maze', async ({ page }) => {
            const first = await page.evaluate(() => JSON.stringify(grid));
            const second = await page.evaluate(() => {
                buildLevel(2);
                return JSON.stringify(grid);
            });
            expect(second).not.toBe(first);
        });

        test('the same level always generates the same maze', async ({ page }) => {
            const [a, b] = await page.evaluate(() => {
                buildLevel(3);
                const a = JSON.stringify(grid);
                buildLevel(7);
                buildLevel(3);
                return [a, JSON.stringify(grid)];
            });
            expect(b).toBe(a);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh run has a full tank, ten flags and three lives', async ({ page }) => {
            // One evaluate: the real animation loop would otherwise burn fuel
            // between starting the game and reading the state back.
            const s = await page.evaluate(() => {
                startGame();
                return { fuel, flags: flags.length, lives, level, score };
            });
            expect(s).toEqual({ fuel: 100, flags: 10, lives: 3, level: 1, score: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Driving
    // -----------------------------------------------------------------------
    test.describe('driving', () => {
        test('the car drives in the direction pressed', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => player.x);
            await press(page, 'ArrowRight');
            await advance(page, 20);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(before);
        });

        test('WASD steers as well as the arrow keys', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => player.y);
            await press(page, 's');
            await advance(page, 20);
            expect(await page.evaluate(() => player.y)).toBeGreaterThan(before);
        });

        test('the car stops at a wall instead of driving through it', async ({ page }) => {
            await startQuiet(page);
            // Row 1 is open along its whole length; the border wall at column 0
            // stops a car driving left.
            await park(page, 1, 1);
            await press(page, 'ArrowLeft');
            await advance(page, 90);
            const p = await page.evaluate(() => ({ r: player.r, c: player.c, wall: isWall(player.r, player.c) }));
            expect(p).toEqual({ r: 1, c: 1, wall: false });
        });

        test('a queued turn is taken at the next opening', async ({ page }) => {
            await startQuiet(page);
            await park(page, 1, 1);
            await press(page, 'ArrowDown');
            await advance(page, 60);
            expect(await page.evaluate(() => player.r)).toBeGreaterThan(1);
        });

        test('reversing is immediate', async ({ page }) => {
            await startQuiet(page);
            await park(page, 1, 1);
            await press(page, 'ArrowRight');
            await advance(page, 10);
            const mid = await page.evaluate(() => player.x);
            await press(page, 'ArrowLeft');
            await advance(page, 20);
            expect(await page.evaluate(() => player.x)).toBeLessThan(mid);
        });

        test('the car never ends up inside a wall while driving around', async ({ page }) => {
            await startQuiet(page);
            const bad = await page.evaluate(() => {
                const dirs = [
                    { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 },
                ];
                const hits = [];
                for (let i = 0; i < 900; i++) {
                    if (i % 25 === 0) player.want = dirs[(i / 25) % dirs.length];
                    step(1 / 60);
                    if (isWall(player.r, player.c) || isWall(player.nr, player.nc)) {
                        hits.push([player.r, player.c]);
                    }
                }
                return hits;
            });
            expect(bad).toEqual([]);
        });

        test('the camera keeps the car on screen', async ({ page }) => {
            await startQuiet(page);
            const inView = await page.evaluate(() => {
                player.want = { x: 1, y: 0 };
                for (let i = 0; i < 400; i++) step(1 / 60);
                return (
                    player.x - camera.x >= 0 &&
                    player.x - camera.x <= CANVAS_W &&
                    player.y - camera.y >= 0 &&
                    player.y - camera.y <= CANVAS_H
                );
            });
            expect(inView).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Flags
    // -----------------------------------------------------------------------
    test.describe('flags', () => {
        test('driving over a flag collects it and scores', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const f = flags.find((x) => !x.special);
                placeAt(player, f.r, f.c);
                step(1 / 60);
            });
            expect(await page.evaluate(() => flags.length)).toBe(9);
            expect(await page.evaluate(() => score)).toBe(100);
            await expect(page.locator('#flags')).toHaveText('9');
            await expect(page.locator('#score')).toHaveText('100');
        });

        test('the lucky flag doubles every flag after it', async ({ page }) => {
            await startQuiet(page);
            const scores = await page.evaluate(() => {
                const lucky = flags.find((x) => x.special);
                placeAt(player, lucky.r, lucky.c);
                step(1 / 60);
                const afterLucky = score;
                const next = flags.find((x) => !x.special);
                placeAt(player, next.r, next.c);
                step(1 / 60);
                return { afterLucky, afterNext: score, multiplier: flagMultiplier };
            });
            expect(scores.afterLucky).toBe(100);
            expect(scores.multiplier).toBe(2);
            expect(scores.afterNext).toBe(300);
        });

        test('a collected flag does not come back', async ({ page }) => {
            await startQuiet(page);
            const tiles = await page.evaluate(() => {
                const f = flags[0];
                placeAt(player, f.r, f.c);
                step(1 / 60);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return flags.filter((x) => x.r === f.r && x.c === f.c).length;
            });
            expect(tiles).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        const clearLevel = (page) =>
            page.evaluate(() => {
                while (flags.length) {
                    const f = flags[0];
                    placeAt(player, f.r, f.c);
                    step(1 / 60);
                }
            });

        test('collecting the last flag clears the level', async ({ page }) => {
            await startQuiet(page);
            await clearLevel(page);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('clearing awards a fuel bonus', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => score);
            await clearLevel(page);
            expect(await page.evaluate(() => score)).toBeGreaterThan(before + 1000);
        });

        test('the next level brings a fresh maze, flags and tank', async ({ page }) => {
            await startQuiet(page);
            await clearLevel(page);
            await advance(page, 150);
            const s = await page.evaluate(() => ({
                state,
                level,
                flags: flags.length,
                fuel,
                multiplier: flagMultiplier,
            }));
            expect(s.state).toBe('running');
            expect(s.level).toBe(2);
            expect(s.flags).toBe(10);
            expect(s.multiplier).toBe(1);
            expect(s.fuel).toBeGreaterThan(90);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('later levels field more pursuers', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                const first = enemies.length;
                buildLevel(4);
                return { first, later: enemies.length };
            });
            expect(counts.later).toBeGreaterThan(counts.first);
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test('fuel drains while driving', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 120);
            const left = await page.evaluate(() => fuel);
            expect(left).toBeLessThan(100);
            expect(left).toBeGreaterThan(90);
        });

        test('the HUD shows the remaining fuel', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 240);
            await expect(page.locator('#fuel')).not.toHaveText('100');
        });

        test('an empty tank costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                fuel = 0.01;
                step(1 / 60);
            });
            const s = await page.evaluate(() => ({ state, lives }));
            expect(s).toEqual({ state: 'dying', lives: 2 });
        });

        test('respawning refills the tank', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                fuel = 0.01;
                step(1 / 60);
            });
            await advance(page, 150);
            const s = await page.evaluate(() => ({ state, fuel }));
            expect(s.state).toBe('running');
            expect(s.fuel).toBeGreaterThan(90);
        });

        test('collected flags survive a respawn', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const f = flags[0];
                placeAt(player, f.r, f.c);
                step(1 / 60);
                fuel = 0.01;
                step(1 / 60);
            });
            await advance(page, 150);
            expect(await page.evaluate(() => flags.length)).toBe(9);
        });
    });

    // -----------------------------------------------------------------------
    // Smoke screen
    // -----------------------------------------------------------------------
    test.describe('smoke screen', () => {
        test('Space drops a puff of smoke and burns fuel', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => fuel);
            await page.keyboard.press('Space');
            await page.waitForFunction(() => smokes.length === 1);
            const after = await page.evaluate(() => fuel);
            // The live animation loop burns a trickle of fuel too, so the drop
            // is checked as a range around the smoke's cost.
            expect(before - after).toBeGreaterThan(5.5);
            expect(before - after).toBeLessThan(7.5);
        });

        test('smoke is dropped at the car', async ({ page }) => {
            await startQuiet(page);
            const d = await page.evaluate(() => {
                dropSmoke();
                return Math.hypot(smokes[0].x - player.x, smokes[0].y - player.y);
            });
            expect(d).toBeLessThan(40);
        });

        test('smoke fades away', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => dropSmoke());
            await advance(page, 60 * 5);
            expect(await page.evaluate(() => smokes.length)).toBe(0);
        });

        test('an empty tank cannot make smoke', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                fuel = 2;
                dropSmoke();
            });
            expect(await page.evaluate(() => smokes.length)).toBe(0);
            expect(await page.evaluate(() => fuel)).toBe(2);
        });

        test('smoke spins out a pursuer', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                placeAt(player, 1, 1);
                placeAt(enemies[0], 1, 2);
                dropSmoke();
                step(1 / 60);
            });
            expect(await page.evaluate(() => enemies[0].spin)).toBeGreaterThan(0);
        });

        test('a spinning pursuer stays put', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                placeAt(player, 5, 1);
                placeAt(enemies[0], 1, 1);
                enemies[0].spin = 2.5;
                const x = enemies[0].x, y = enemies[0].y;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return Math.hypot(enemies[0].x - x, enemies[0].y - y);
            });
            expect(moved).toBe(0);
        });

        test('a pursuer drives again once it stops spinning', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                enemies.length = 1;
                placeAt(player, 13, 17);
                placeAt(enemies[0], 1, 1);
                enemies[0].spin = 0.2;
                const x = enemies[0].x, y = enemies[0].y;
                for (let i = 0; i < 120; i++) step(1 / 60);
                return Math.hypot(enemies[0].x - x, enemies[0].y - y);
            });
            expect(moved).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pursuers
    // -----------------------------------------------------------------------
    test.describe('pursuers', () => {
        test('pursuers stay out of the walls', async ({ page }) => {
            const bad = await page.evaluate(() => {
                startGame();
                const hits = [];
                for (let i = 0; i < 900; i++) {
                    step(1 / 60);
                    for (const e of enemies) {
                        if (isWall(e.r, e.c) || isWall(e.nr, e.nc)) hits.push([e.r, e.c]);
                    }
                }
                return hits;
            });
            expect(bad).toEqual([]);
        });

        test('pursuers close in on a parked car', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                chaseNoise = 0;
                placeAt(player, 1, 1);
                player.want = { x: 0, y: 0 };
                const near = () =>
                    Math.min(...enemies.map((e) => Math.hypot(e.x - player.x, e.y - player.y)));
                const before = near();
                for (let i = 0; i < 240; i++) {
                    step(1 / 60);
                    if (state !== 'running') break;
                    placeAt(player, 1, 1);
                }
                return { before, after: near() };
            });
            expect(d.after).toBeLessThan(d.before);
        });

        test('a collision costs a life', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                placeAt(player, 1, 1);
                placeAt(enemies[0], 1, 1);
                step(1 / 60);
                return { state, lives };
            });
            expect(s).toEqual({ state: 'dying', lives: 2 });
        });

        test('after a crash the cars go back to their starting tiles', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                placeAt(player, 1, 1);
                placeAt(enemies[0], 1, 1);
                step(1 / 60);
            });
            await advance(page, 150);
            const s = await page.evaluate(() => ({
                state,
                far: Math.min(...enemies.map((e) => Math.hypot(e.x - player.x, e.y - player.y))),
            }));
            expect(s.state).toBe('running');
            expect(s.far).toBeGreaterThan(4 * 32);
        });

        test('the last life ends the run', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                placeAt(player, 1, 1);
                placeAt(enemies[0], 1, 1);
                step(1 / 60);
            });
            await advance(page, 150);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('a spinning pursuer is harmless', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                placeAt(player, 1, 1);
                placeAt(enemies[0], 1, 1);
                enemies[0].spin = 2;
                step(1 / 60);
                return { state, lives };
            });
            expect(s).toEqual({ state: 'running', lives: 3 });
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves or burns while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.want = { x: 1, y: 0 };
                step(1 / 60);
                togglePause();
            });
            const before = await page.evaluate(() => ({ x: player.x, y: player.y, fuel }));
            await advance(page, 120);
            expect(await page.evaluate(() => ({ x: player.x, y: player.y, fuel }))).toEqual(before);
        });

        test('pausing is ignored before the game starts', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Game over / best score
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        const gameOver = async (page, points) => {
            await page.evaluate((pts) => {
                startGame();
                enemies.length = 0;
                score = pts;
                lives = 1;
                fuel = 0.01;
                step(1 / 60);
                for (let i = 0; i < 150; i++) step(1 / 60);
            }, points);
        };

        test('a new best is stored', async ({ page }) => {
            await gameOver(page, 5555);
            await expect(page.locator('#best')).toHaveText('5555');
            expect(await page.evaluate(() => window.localStorage.getItem('rallyx-best'))).toBe('5555');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('rallyx-best', '9999'));
            await page.reload();
            await gameOver(page, 120);
            await expect(page.locator('#best')).toHaveText('9999');
        });

        test('the overlay shows the final score', async ({ page }) => {
            await gameOver(page, 4321);
            await expect(page.locator('#overlay-score')).toContainText('4321');
        });

        test('Space starts a fresh run after game over', async ({ page }) => {
            await gameOver(page, 4321);
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, score, lives, level }));
            expect(s).toEqual({ state: 'running', score: 0, lives: 3, level: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('drawing a running game raises no errors', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                dropSmoke();
                for (let i = 0; i < 300; i++) {
                    step(1 / 60);
                    draw();
                }
            });
            expect(errors).toEqual([]);
        });

        test('the canvas is not blank once the game starts', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 60; i++) step(1 / 60);
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(painted).toBeGreaterThan(3);
        });

        test('drawing does not change the simulation', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 30; i++) step(1 / 60);
                const snap = JSON.stringify({ player, enemies, flags, fuel, score });
                draw();
                draw();
                return snap === JSON.stringify({ player, enemies, flags, fuel, score });
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Game browser integration
    // -----------------------------------------------------------------------
    test.describe('game browser', () => {
        test('the game is listed in the browser catalogue', () => {
            const catalogue = JSON.parse(
                fs.readFileSync(
                    path.resolve(__dirname, '../../game-browser/src/assets/games.json'),
                    'utf8'
                )
            );
            const entry = catalogue.find((g) => g.id === 'rally-x');
            expect(entry).toBeTruthy();
            expect(entry.dir).toBe('RallyX');
            expect(entry.path).toBe('games/RallyX/index.html');
            expect(entry.name).toBe('Rally-X');
            expect(entry.category).toBeTruthy();
            expect(entry.description).toBeTruthy();
        });

        test('the catalogue entry points at files that exist', () => {
            const dir = path.resolve(__dirname, '..');
            for (const file of ['index.html', 'game.js', 'style.css', 'README.md', 'DESIGN.md']) {
                expect(fs.existsSync(path.join(dir, file))).toBe(true);
            }
        });
    });
});
