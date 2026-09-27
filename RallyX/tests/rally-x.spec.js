const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Nearly every test drives the simulation by hand with `step(dt)`, so the
// real-time animation loop is switched off first to keep results
// deterministic. The few tests that exercise the live loop turn it back on.
async function openManual(page) {
    await page.goto(GAME_URL);
    await page.evaluate(() => setAutoPlay(false));
}

async function openPlaying(page) {
    await openManual(page);
    await page.evaluate(() => startGame());
}

/** Advance the simulation by `seconds`, in fixed 1/60 s slices. */
async function advance(page, seconds) {
    await page.evaluate((s) => {
        const dt = 1 / 60;
        for (let t = 0; t < s - 1e-9; t += dt) step(dt);
    }, seconds);
}

/** Take the chasers off the board so they cannot interfere with a test. */
async function clearEnemies(page) {
    await page.evaluate(() => { enemies.length = 0; });
}

/** Keep a single chaser and park it in the far corner of the maze. */
async function soloEnemy(page) {
    await page.evaluate(() => {
        enemies.length = 1;
        for (let r = ROWS - 2; r > 0; r--) {
            for (let c = COLS - 2; c > 0; c--) {
                if (!isWall(c, r)) { placeAt(enemies[0], c, r); return; }
            }
        }
    });
}

test.describe('Rally-X', () => {
    // -------------------------------------------------------------------
    // Initial / idle state
    // -------------------------------------------------------------------
    test.describe('initial state', () => {
        test.beforeEach(async ({ page }) => openManual(page));

        test('page title is Rally-X', async ({ page }) => {
            await expect(page).toHaveTitle('Rally-X');
        });

        test('the viewport canvas is 480x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('the radar canvas is 144x144', async ({ page }) => {
            const radar = page.locator('#radar');
            await expect(radar).toHaveAttribute('width', '144');
            await expect(radar).toHaveAttribute('height', '144');
        });

        test('the world is four viewports in area', async ({ page }) => {
            const g = await page.evaluate(() => ({ COLS, ROWS, TILE, VIEW_W, VIEW_H }));
            expect(g.COLS * g.TILE).toBe(768);
            expect(g.ROWS * g.TILE).toBe(768);
            expect(g.VIEW_W).toBe(480);
            expect(g.VIEW_H).toBe(480);
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before the game begins', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the scoreboard starts at zero with three cars on level 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
        });
    });

    // -------------------------------------------------------------------
    // Maze generation
    // -------------------------------------------------------------------
    test.describe('maze', () => {
        test.beforeEach(async ({ page }) => openManual(page));

        test('the maze grid matches COLS x ROWS', async ({ page }) => {
            const m = await page.evaluate(() => ({ rows: maze.length, cols: maze[0].length, COLS, ROWS }));
            expect(m.rows).toBe(m.ROWS);
            expect(m.cols).toBe(m.COLS);
        });

        test('the border is solid wall all the way round', async ({ page }) => {
            const leaks = await page.evaluate(() => {
                const bad = [];
                for (let c = 0; c < COLS; c++) {
                    if (!isWall(c, 0)) bad.push([c, 0]);
                    if (!isWall(c, ROWS - 1)) bad.push([c, ROWS - 1]);
                }
                for (let r = 0; r < ROWS; r++) {
                    if (!isWall(0, r)) bad.push([0, r]);
                    if (!isWall(COLS - 1, r)) bad.push([COLS - 1, r]);
                }
                return bad;
            });
            expect(leaks).toEqual([]);
        });

        test('out-of-bounds tiles count as wall', async ({ page }) => {
            const oob = await page.evaluate(() => [
                isWall(-1, 5), isWall(5, -1), isWall(COLS, 5), isWall(5, ROWS),
            ]);
            expect(oob).toEqual([true, true, true, true]);
        });

        test('every open tile is reachable from the start', async ({ page }) => {
            const unreachable = await page.evaluate(() => {
                const seen = new Set();
                const start = tileOf(player);
                const q = [[start.col, start.row]];
                seen.add(start.col + ',' + start.row);
                while (q.length) {
                    const [c, r] = q.shift();
                    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nc = c + dc, nr = r + dr, k = nc + ',' + nr;
                        if (!isWall(nc, nr) && !seen.has(k)) { seen.add(k); q.push([nc, nr]); }
                    }
                }
                let open = 0;
                for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!isWall(c, r)) open++;
                return open - seen.size;
            });
            expect(unreachable).toBe(0);
        });

        test('the maze leaves plenty of road to drive on', async ({ page }) => {
            const open = await page.evaluate(() => {
                let n = 0;
                for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!isWall(c, r)) n++;
                return n;
            });
            expect(open).toBeGreaterThan(200);
        });

        test('the same level always generates the same maze', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = maze.map((row) => row.join('')).join('|');
                buildLevel(1);
                const b = maze.map((row) => row.join('')).join('|');
                return a === b;
            });
            expect(same).toBe(true);
        });

        test('different levels generate different mazes', async ({ page }) => {
            const differ = await page.evaluate(() => {
                buildLevel(1);
                const a = maze.map((row) => row.join('')).join('|');
                buildLevel(2);
                const b = maze.map((row) => row.join('')).join('|');
                return a !== b;
            });
            expect(differ).toBe(true);
        });
    });

    // -------------------------------------------------------------------
    // Starting a game
    // -------------------------------------------------------------------
    test.describe('starting', () => {
        test.beforeEach(async ({ page }) => openManual(page));

        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('a fresh game lays out ten flags and a full tank', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { flags: flags.length, fuel, max: FUEL_MAX, score, lives, level };
            });
            expect(s.flags).toBe(10);
            expect(s.fuel).toBe(s.max);
            expect(s.score).toBe(0);
            expect(s.lives).toBe(3);
            expect(s.level).toBe(1);
        });

        test('exactly one flag is the lucky flag', async ({ page }) => {
            const lucky = await page.evaluate(() => {
                startGame();
                return flags.filter((f) => f.lucky).length;
            });
            expect(lucky).toBe(1);
        });

        test('level 1 starts four chasers', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return enemies.length; });
            expect(n).toBe(4);
        });

        test('nothing spawns inside a wall', async ({ page }) => {
            const inWall = await page.evaluate(() => {
                startGame();
                const bad = [];
                const check = (o) => { const t = tileOf(o); if (isWall(t.col, t.row)) bad.push(t); };
                check(player);
                enemies.forEach(check);
                flags.forEach((f) => { if (isWall(f.col, f.row)) bad.push(f); });
                return bad;
            });
            expect(inWall).toEqual([]);
        });

        test('no flag or chaser spawns on top of the player', async ({ page }) => {
            const close = await page.evaluate(() => {
                startGame();
                const p = tileOf(player);
                const d = (c, r) => Math.abs(c - p.col) + Math.abs(r - p.row);
                return {
                    flag: Math.min(...flags.map((f) => d(f.col, f.row))),
                    enemy: Math.min(...enemies.map((e) => { const t = tileOf(e); return d(t.col, t.row); })),
                };
            });
            expect(close.flag).toBeGreaterThanOrEqual(8);
            expect(close.enemy).toBeGreaterThanOrEqual(10);
        });

        test('the flags-remaining readout shows ten', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#flags')).toHaveText('10');
        });
    });

    // -------------------------------------------------------------------
    // Driving
    // -------------------------------------------------------------------
    test.describe('driving', () => {
        test.beforeEach(async ({ page }) => { await openPlaying(page); await clearEnemies(page); });

        test('arrow keys set the wanted direction', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => player.want)).toEqual({ dx: -1, dy: 0 });
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.want)).toEqual({ dx: 0, dy: -1 });
        });

        test('WASD steers as well as the arrows', async ({ page }) => {
            await page.keyboard.press('d');
            expect(await page.evaluate(() => player.want)).toEqual({ dx: 1, dy: 0 });
            await page.keyboard.press('s');
            expect(await page.evaluate(() => player.want)).toEqual({ dx: 0, dy: 1 });
        });

        test('the car drives down an open corridor at PLAYER_SPEED', async ({ page }) => {
            const moved = await page.evaluate(() => {
                // Find a tile with a clear run of three to the right.
                for (let r = 1; r < ROWS - 1; r++) {
                    for (let c = 1; c < COLS - 4; c++) {
                        if (!isWall(c, r) && !isWall(c + 1, r) && !isWall(c + 2, r) && !isWall(c + 3, r)) {
                            placeAt(player, c, r);
                            const x0 = player.x;
                            player.want = { dx: 1, dy: 0 };
                            for (let i = 0; i < 30; i++) step(1 / 60);
                            return { dx: player.x - x0, expect: PLAYER_SPEED * 0.5, y: player.y };
                        }
                    }
                }
                return null;
            });
            expect(moved.dx).toBeGreaterThan(moved.expect * 0.9);
            expect(moved.dx).toBeLessThanOrEqual(moved.expect + 0.5);
        });

        test('the car stops at a wall instead of driving through it', async ({ page }) => {
            const r = await page.evaluate(() => {
                // Put the player immediately left of a wall, facing it.
                for (let row = 1; row < ROWS - 1; row++) {
                    for (let col = 1; col < COLS - 1; col++) {
                        if (!isWall(col, row) && isWall(col + 1, row)) {
                            placeAt(player, col, row);
                            player.want = { dx: 1, dy: 0 };
                            for (let i = 0; i < 120; i++) step(1 / 60);
                            const t = tileOf(player);
                            return { col: t.col, row: t.row, wanted: col, x: player.x, centre: col * TILE + TILE / 2 };
                        }
                    }
                }
                return null;
            });
            expect(r.col).toBe(r.wanted);
            expect(Math.abs(r.x - r.centre)).toBeLessThan(0.001);
        });

        test('a turn is taken at the junction and snaps to the lane centre', async ({ page }) => {
            const r = await page.evaluate(() => {
                // A tile that is open to the right and open downward.
                for (let row = 1; row < ROWS - 2; row++) {
                    for (let col = 1; col < COLS - 2; col++) {
                        if (!isWall(col, row) && !isWall(col + 1, row) && !isWall(col, row + 1) && !isWall(col, row + 2)) {
                            placeAt(player, col, row);
                            player.dir = { dx: 1, dy: 0 };
                            player.want = { dx: 0, dy: 1 };
                            for (let i = 0; i < 30; i++) step(1 / 60);
                            return { dir: player.dir, x: player.x, centre: col * TILE + TILE / 2, y: player.y, y0: row * TILE + TILE / 2 };
                        }
                    }
                }
                return null;
            });
            expect(r.dir).toEqual({ dx: 0, dy: 1 });
            expect(Math.abs(r.x - r.centre)).toBeLessThan(0.001);
            expect(r.y).toBeGreaterThan(r.y0);
        });

        test('a turn into a wall is refused and the car keeps its heading', async ({ page }) => {
            const dir = await page.evaluate(() => {
                for (let row = 1; row < ROWS - 1; row++) {
                    for (let col = 1; col < COLS - 2; col++) {
                        if (!isWall(col, row) && !isWall(col + 1, row) && isWall(col, row + 1) && isWall(col, row - 1)) {
                            placeAt(player, col, row);
                            player.dir = { dx: 1, dy: 0 };
                            player.want = { dx: 0, dy: 1 };
                            for (let i = 0; i < 10; i++) step(1 / 60);
                            return player.dir;
                        }
                    }
                }
                return null;
            });
            expect(dir).toEqual({ dx: 1, dy: 0 });
        });

        test('the car can always reverse', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (let row = 1; row < ROWS - 1; row++) {
                    for (let col = 2; col < COLS - 2; col++) {
                        if (!isWall(col - 1, row) && !isWall(col, row) && !isWall(col + 1, row)) {
                            placeAt(player, col, row);
                            player.dir = { dx: 1, dy: 0 };
                            player.want = { dx: -1, dy: 0 };
                            const x0 = player.x;
                            for (let i = 0; i < 10; i++) step(1 / 60);
                            return { dir: player.dir, moved: player.x - x0 };
                        }
                    }
                }
                return null;
            });
            expect(r.dir).toEqual({ dx: -1, dy: 0 });
            expect(r.moved).toBeLessThan(0);
        });

        test('the car never leaves the world', async ({ page }) => {
            const inside = await page.evaluate(() => {
                const dirs = [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 0, dy: -1 }];
                for (let i = 0; i < 400; i++) {
                    player.want = dirs[i % 4];
                    for (let k = 0; k < 6; k++) step(1 / 60);
                    if (player.x < 0 || player.y < 0 || player.x > COLS * TILE || player.y > ROWS * TILE) return false;
                }
                return true;
            });
            expect(inside).toBe(true);
        });
    });

    // -------------------------------------------------------------------
    // Camera
    // -------------------------------------------------------------------
    test.describe('camera', () => {
        test.beforeEach(async ({ page }) => { await openPlaying(page); await clearEnemies(page); });

        test('the camera stays inside the world bounds', async ({ page }) => {
            const r = await page.evaluate(() => {
                placeAt(player, 1, 1);
                step(1 / 60);
                const topLeft = { x: camera.x, y: camera.y };
                placeAt(player, COLS - 2, ROWS - 2);
                step(1 / 60);
                return { topLeft, bottomRight: { x: camera.x, y: camera.y }, maxX: COLS * TILE - VIEW_W, maxY: ROWS * TILE - VIEW_H };
            });
            expect(r.topLeft).toEqual({ x: 0, y: 0 });
            expect(r.bottomRight.x).toBe(r.maxX);
            expect(r.bottomRight.y).toBe(r.maxY);
        });

        test('in open country the camera centres on the car', async ({ page }) => {
            const r = await page.evaluate(() => {
                let c = Math.floor(COLS / 2), row = Math.floor(ROWS / 2);
                while (isWall(c, row)) c++;
                placeAt(player, c, row);
                step(1 / 60);
                return { cx: camera.x + VIEW_W / 2, cy: camera.y + VIEW_H / 2, px: player.x, py: player.y };
            });
            expect(Math.abs(r.cx - r.px)).toBeLessThan(1);
            expect(Math.abs(r.cy - r.py)).toBeLessThan(1);
        });
    });

    // -------------------------------------------------------------------
    // Flags
    // -------------------------------------------------------------------
    test.describe('flags', () => {
        test.beforeEach(async ({ page }) => { await openPlaying(page); await clearEnemies(page); });

        test('driving onto a flag collects it and scores 100', async ({ page }) => {
            const r = await page.evaluate(() => {
                const f = flags.find((x) => !x.lucky);
                placeAt(player, f.col, f.row);
                step(1 / 60);
                return { score, left: flags.length };
            });
            expect(r.score).toBe(100);
            expect(r.left).toBe(9);
        });

        test('the flags-remaining readout counts down', async ({ page }) => {
            await page.evaluate(() => {
                const f = flags.find((x) => !x.lucky);
                placeAt(player, f.col, f.row);
                step(1 / 60);
            });
            await expect(page.locator('#flags')).toHaveText('9');
            await expect(page.locator('#score')).toHaveText('100');
        });

        test('a collected flag does not score twice', async ({ page }) => {
            const score = await page.evaluate(() => {
                const f = flags.find((x) => !x.lucky);
                placeAt(player, f.col, f.row);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return score;
            });
            expect(score).toBe(100);
        });

        test('the lucky flag scores 100 but doubles every flag after it', async ({ page }) => {
            const r = await page.evaluate(() => {
                const lucky = flags.find((x) => x.lucky);
                placeAt(player, lucky.col, lucky.row);
                step(1 / 60);
                const afterLucky = score;
                const next = flags.find((x) => !x.lucky);
                placeAt(player, next.col, next.row);
                step(1 / 60);
                return { afterLucky, afterNext: score, flagValue };
            });
            expect(r.afterLucky).toBe(100);
            expect(r.afterNext).toBe(300);
            expect(r.flagValue).toBe(200);
        });

        test('flags collected before the lucky flag are worth 100', async ({ page }) => {
            const score = await page.evaluate(() => {
                const plain = flags.filter((x) => !x.lucky).slice(0, 2);
                for (const f of plain) { placeAt(player, f.col, f.row); step(1 / 60); }
                return score;
            });
            expect(score).toBe(200);
        });
    });

    // -------------------------------------------------------------------
    // Fuel
    // -------------------------------------------------------------------
    test.describe('fuel', () => {
        test.beforeEach(async ({ page }) => { await openPlaying(page); await clearEnemies(page); });

        test('fuel drains while driving', async ({ page }) => {
            const r = await page.evaluate(() => {
                const before = fuel;
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { before, after: fuel, drain: FUEL_DRAIN };
            });
            expect(r.after).toBeCloseTo(r.before - r.drain * 2, 3);
        });

        test('the fuel gauge shrinks as the tank empties', async ({ page }) => {
            const before = await page.locator('#fuel-bar').evaluate((el) => el.style.width);
            await advance(page, 10);
            const after = await page.locator('#fuel-bar').evaluate((el) => el.style.width);
            expect(parseFloat(after)).toBeLessThan(parseFloat(before));
            expect(parseFloat(after)).toBeGreaterThan(0);
        });

        test('fuel never goes negative', async ({ page }) => {
            const f = await page.evaluate(() => {
                for (let i = 0; i < 60 * 200; i++) step(1 / 60);
                return fuel;
            });
            expect(f).toBe(0);
        });

        test('an empty tank halves the car speed', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (let row = 1; row < ROWS - 1; row++) {
                    for (let col = 1; col < COLS - 4; col++) {
                        if (!isWall(col, row) && !isWall(col + 1, row) && !isWall(col + 2, row) && !isWall(col + 3, row)) {
                            fuel = 0;
                            placeAt(player, col, row);
                            player.want = { dx: 1, dy: 0 };
                            const x0 = player.x;
                            for (let i = 0; i < 30; i++) step(1 / 60);
                            return { dx: player.x - x0, full: PLAYER_SPEED * 0.5, factor: EMPTY_SPEED_FACTOR };
                        }
                    }
                }
                return null;
            });
            expect(r.dx).toBeGreaterThan(r.full * r.factor * 0.9);
            expect(r.dx).toBeLessThan(r.full * 0.75);
        });

        test('the last flag pays a bonus of ten points per litre left', async ({ page }) => {
            const r = await page.evaluate(() => {
                fuel = 40;
                while (flags.length > 1) { const f = flags[0]; placeAt(player, f.col, f.row); step(1 / 60); }
                const before = score;
                const val = flagValue;
                const last = flags[0];
                placeAt(player, last.col, last.row);
                step(1 / 60);
                return { gain: score - before, val, left: fuel, bonus: FUEL_BONUS, state };
            });
            expect(r.state).toBe('levelclear');
            expect(r.gain).toBe(r.val + Math.round(r.left) * r.bonus);
        });

        test('the next level starts with a full tank', async ({ page }) => {
            const r = await page.evaluate(() => {
                fuel = 40;
                while (flags.length) { const f = flags[0]; placeAt(player, f.col, f.row); step(1 / 60); }
                while (state === 'levelclear') step(1 / 60);
                return { fuel, max: FUEL_MAX, level };
            });
            expect(r.level).toBe(2);
            expect(r.fuel).toBe(r.max);
        });
    });

    // -------------------------------------------------------------------
    // Smoke screen
    // -------------------------------------------------------------------
    test.describe('smoke screen', () => {
        test.beforeEach(async ({ page }) => { await openPlaying(page); await soloEnemy(page); });

        test('Space drops a smoke cloud behind the car and burns fuel', async ({ page }) => {
            const before = await page.evaluate(() => ({ smokes: smokes.length, fuel }));
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => ({ smokes: smokes.length, fuel, cost: SMOKE_COST }));
            expect(before.smokes).toBe(0);
            expect(after.smokes).toBe(1);
            expect(after.fuel).toBeCloseTo(before.fuel - after.cost, 3);
        });

        test('the cloud lands behind the car, not on it', async ({ page }) => {
            const r = await page.evaluate(() => {
                player.dir = { dx: 1, dy: 0 };
                dropSmoke();
                return { sx: smokes[0].x, px: player.x, sy: smokes[0].y, py: player.y };
            });
            expect(r.sx).toBeLessThan(r.px);
            expect(Math.abs(r.sy - r.py)).toBeLessThan(1);
        });

        test('smoke expires after SMOKE_LIFE', async ({ page }) => {
            await page.evaluate(() => dropSmoke());
            expect(await page.evaluate(() => smokes.length)).toBe(1);
            await advance(page, 1.0);
            expect(await page.evaluate(() => smokes.length)).toBe(1);
            await advance(page, 2.5);
            expect(await page.evaluate(() => smokes.length)).toBe(0);
        });

        test('no smoke can be made on an empty tank', async ({ page }) => {
            const n = await page.evaluate(() => { fuel = 0; dropSmoke(); return smokes.length; });
            expect(n).toBe(0);
        });

        test('smoke cannot be made when the game is not running', async ({ page }) => {
            const n = await page.evaluate(() => { state = 'gameover'; dropSmoke(); return smokes.length; });
            expect(n).toBe(0);
        });

        test('a chaser that drives into smoke spins out', async ({ page }) => {
            const r = await page.evaluate(() => {
                const t = tileOf(player);
                placeAt(enemies[0], t.col, t.row);
                enemies[0].x = player.x + 60;
                dropSmoke();
                smokes[0].x = enemies[0].x;
                smokes[0].y = enemies[0].y;
                step(1 / 60);
                return { spin: enemies[0].spin, time: SPIN_TIME };
            });
            expect(r.spin).toBeGreaterThan(0);
            expect(r.spin).toBeLessThanOrEqual(r.time);
        });

        test('a spinning chaser does not move and is harmless', async ({ page }) => {
            const r = await page.evaluate(() => {
                const t = tileOf(player);
                placeAt(enemies[0], t.col, t.row);
                enemies[0].spin = SPIN_TIME;
                const before = { x: enemies[0].x, y: enemies[0].y };
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { before, after: { x: enemies[0].x, y: enemies[0].y }, state, lives };
            });
            expect(r.after).toEqual(r.before);
            expect(r.state).toBe('playing');
            expect(r.lives).toBe(3);
        });

        test('a chaser recovers once the spin runs out', async ({ page }) => {
            const spin = await page.evaluate(() => {
                enemies[0].spin = SPIN_TIME;
                for (let i = 0; i < 60 * 4; i++) step(1 / 60);
                return enemies[0].spin;
            });
            expect(spin).toBe(0);
        });
    });

    // -------------------------------------------------------------------
    // Chasers
    // -------------------------------------------------------------------
    test.describe('chasers', () => {
        test.beforeEach(async ({ page }) => openPlaying(page));

        test('chasers are slower than the player', async ({ page }) => {
            const r = await page.evaluate(() => ({ p: PLAYER_SPEED, e: enemySpeed() }));
            expect(r.e).toBeLessThan(r.p);
        });

        test('chasers get faster on later levels', async ({ page }) => {
            const r = await page.evaluate(() => {
                const a = enemySpeed();
                level = 4;
                return { a, b: enemySpeed() };
            });
            expect(r.b).toBeGreaterThan(r.a);
        });

        test('later levels send more chasers, up to a cap', async ({ page }) => {
            const counts = await page.evaluate(() => [1, 2, 3, 9].map((l) => enemyCountFor(l)));
            expect(counts[0]).toBe(4);
            expect(counts[1]).toBe(5);
            expect(counts[2]).toBe(6);
            expect(counts[3]).toBe(6);
        });

        test('chasers stay out of the walls while hunting', async ({ page }) => {
            const inWall = await page.evaluate(() => {
                for (let i = 0; i < 60 * 12; i++) {
                    step(1 / 60);
                    if (state !== 'playing') continue;
                    for (const e of enemies) {
                        const t = tileOf(e);
                        if (isWall(t.col, t.row)) return { col: t.col, row: t.row };
                    }
                }
                return null;
            });
            expect(inWall).toBeNull();
        });

        test('a chaser closes on a stationary player', async ({ page }) => {
            const r = await page.evaluate(() => {
                const dist = () => Math.hypot(enemies[0].x - player.x, enemies[0].y - player.y);
                // Leave only one chaser so the others cannot end the run early.
                enemies.length = 1;
                const before = dist();
                let best = before;
                for (let i = 0; i < 60 * 20 && state === 'playing'; i++) {
                    step(1 / 60);
                    best = Math.min(best, dist());
                }
                return { before, best };
            });
            expect(r.best).toBeLessThan(r.before * 0.6);
        });

        test('touching a chaser wrecks the car', async ({ page }) => {
            const r = await page.evaluate(() => {
                const t = tileOf(player);
                placeAt(enemies[0], t.col, t.row);
                step(1 / 60);
                return { state, lives };
            });
            expect(r.state).toBe('dying');
            expect(r.lives).toBe(2);
        });

        test('after a wreck everything returns to its spawn with flags kept', async ({ page }) => {
            const r = await page.evaluate(() => {
                const f = flags[0];
                placeAt(player, f.col, f.row);
                step(1 / 60);
                const kept = flags.length;
                const spawn = { col: player.spawn.col, row: player.spawn.row };
                const t0 = tileOf(player);
                placeAt(enemies[0], t0.col, t0.row);
                step(1 / 60);
                for (let i = 0; i < 60 * 2; i++) step(1 / 60);
                const t = tileOf(player);
                return { kept, flags: flags.length, state, col: t.col, row: t.row, spawn };
            });
            expect(r.kept).toBe(9);
            expect(r.flags).toBe(9);
            expect(r.state).toBe('playing');
            expect(r.col).toBe(r.spawn.col);
            expect(r.row).toBe(r.spawn.row);
        });

        test('a wreck does not refill the tank', async ({ page }) => {
            const fuel = await page.evaluate(() => {
                fuel = 30;
                const t = tileOf(player);
                placeAt(enemies[0], t.col, t.row);
                step(1 / 60);
                for (let i = 0; i < 60 * 2; i++) step(1 / 60);
                return window.fuel;
            });
            expect(fuel).toBeLessThan(31);
        });
    });

    // -------------------------------------------------------------------
    // Level progression
    // -------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => { await openPlaying(page); await clearEnemies(page); });

        test('taking the last flag clears the level', async ({ page }) => {
            const s = await page.evaluate(() => {
                while (flags.length) { const f = flags[0]; placeAt(player, f.col, f.row); step(1 / 60); }
                return state;
            });
            expect(s).toBe('levelclear');
        });

        test('the clear banner names the level', async ({ page }) => {
            await page.evaluate(() => {
                while (flags.length) { const f = flags[0]; placeAt(player, f.col, f.row); step(1 / 60); }
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/level 1 clear/i);
        });

        test('the next level brings a new maze, ten fresh flags and an extra chaser', async ({ page }) => {
            const r = await page.evaluate(() => {
                const before = maze.map((row) => row.join('')).join('|');
                while (flags.length) { const f = flags[0]; placeAt(player, f.col, f.row); step(1 / 60); }
                for (let i = 0; i < 60 * 3; i++) step(1 / 60);
                return {
                    level, state, flags: flags.length, enemies: enemies.length,
                    changed: maze.map((row) => row.join('')).join('|') !== before,
                    flagValue, base: FLAG_BASE,
                };
            });
            expect(r.level).toBe(2);
            expect(r.state).toBe('playing');
            expect(r.flags).toBe(10);
            expect(r.enemies).toBe(5);
            expect(r.changed).toBe(true);
            expect(r.flagValue).toBe(r.base);
        });

        test('the level readout updates', async ({ page }) => {
            await page.evaluate(() => {
                while (flags.length) { const f = flags[0]; placeAt(player, f.col, f.row); step(1 / 60); }
                for (let i = 0; i < 60 * 3; i++) step(1 / 60);
            });
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('smoke on the road is cleared between levels', async ({ page }) => {
            const n = await page.evaluate(() => {
                dropSmoke();
                while (flags.length) { const f = flags[0]; placeAt(player, f.col, f.row); step(1 / 60); }
                for (let i = 0; i < 60 * 3; i++) step(1 / 60);
                return smokes.length;
            });
            expect(n).toBe(0);
        });
    });

    // -------------------------------------------------------------------
    // Losing and restarting
    // -------------------------------------------------------------------
    test.describe('game over', () => {
        test.beforeEach(async ({ page }) => openPlaying(page));

        test('the lives readout drops after a wreck', async ({ page }) => {
            await page.evaluate(() => {
                const t = tileOf(player);
                placeAt(enemies[0], t.col, t.row);
                step(1 / 60);
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('losing the last car ends the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (let n = 0; n < 3; n++) {
                    const t = tileOf(player);
                    placeAt(enemies[0], t.col, t.row);
                    step(1 / 60);
                    for (let i = 0; i < 60 * 2; i++) step(1 / 60);
                }
                return { state, lives };
            });
            expect(r.state).toBe('gameover');
            expect(r.lives).toBe(0);
        });

        test('the game over overlay reports the score', async ({ page }) => {
            await page.evaluate(() => {
                const f = flags[0];
                placeAt(player, f.col, f.row);
                step(1 / 60);
                for (let n = 0; n < 3; n++) {
                    const t = tileOf(player);
                    placeAt(enemies[0], t.col, t.row);
                    step(1 / 60);
                    for (let i = 0; i < 60 * 2; i++) step(1 / 60);
                }
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
            await expect(page.locator('#overlay-score')).toContainText('100');
        });

        test('the game does not keep running after game over', async ({ page }) => {
            const r = await page.evaluate(() => {
                for (let n = 0; n < 3; n++) {
                    const t = tileOf(player);
                    placeAt(enemies[0], t.col, t.row);
                    step(1 / 60);
                    for (let i = 0; i < 60 * 2; i++) step(1 / 60);
                }
                const before = { x: player.x, y: player.y, fuel };
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { before, after: { x: player.x, y: player.y, fuel } };
            });
            expect(r.after).toEqual(r.before);
        });

        test('Space restarts a finished game from scratch', async ({ page }) => {
            await page.evaluate(() => {
                const f = flags[0];
                placeAt(player, f.col, f.row);
                step(1 / 60);
                for (let n = 0; n < 3; n++) {
                    const t = tileOf(player);
                    placeAt(enemies[0], t.col, t.row);
                    step(1 / 60);
                    for (let i = 0; i < 60 * 2; i++) step(1 / 60);
                }
            });
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => ({ state, score, lives, level, flags: flags.length, fuel, max: FUEL_MAX }));
            expect(r.state).toBe('playing');
            expect(r.score).toBe(0);
            expect(r.lives).toBe(3);
            expect(r.level).toBe(1);
            expect(r.flags).toBe(10);
            expect(r.fuel).toBe(r.max);
        });
    });

    // -------------------------------------------------------------------
    // Pause
    // -------------------------------------------------------------------
    test.describe('pause', () => {
        test.beforeEach(async ({ page }) => openPlaying(page));

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('nothing moves and no fuel burns while paused', async ({ page }) => {
            const r = await page.evaluate(() => {
                state = 'paused';
                const before = { x: player.x, y: player.y, fuel, e: enemies.map((e) => e.x) };
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { before, after: { x: player.x, y: player.y, fuel, e: enemies.map((e) => e.x) } };
            });
            expect(r.after).toEqual(r.before);
        });

        test('P does nothing before the game has started', async ({ page }) => {
            await page.evaluate(() => resetGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -------------------------------------------------------------------
    // The live loop and rendering
    // -------------------------------------------------------------------
    test.describe('live loop', () => {
        test('the animation loop advances the game on its own', async ({ page }) => {
            await page.goto(GAME_URL);
            await page.evaluate(() => { startGame(); player.want = { dx: 0, dy: 0 }; });
            const before = await page.evaluate(() => fuel);
            await page.waitForTimeout(600);
            const after = await page.evaluate(() => fuel);
            expect(after).toBeLessThan(before);
        });

        test('the canvases are actually painted', async ({ page }) => {
            await page.goto(GAME_URL);
            await page.evaluate(() => startGame());
            await page.waitForTimeout(200);
            const painted = await page.evaluate(() => {
                const check = (id) => {
                    const c = document.getElementById(id);
                    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
                    const first = [d[0], d[1], d[2]].join();
                    for (let i = 4; i < d.length; i += 4) {
                        if ([d[i], d[i + 1], d[i + 2]].join() !== first) return true;
                    }
                    return false;
                };
                return { main: check('canvas'), radar: check('radar') };
            });
            expect(painted.main).toBe(true);
            expect(painted.radar).toBe(true);
        });

        test('arrow keys do not scroll the page', async ({ page }) => {
            await page.goto(GAME_URL);
            await page.evaluate(() => startGame());
            const prevented = await page.evaluate(() => {
                const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true });
                window.dispatchEvent(ev);
                return ev.defaultPrevented;
            });
            expect(prevented).toBe(true);
        });

        test('a long run of real gameplay never throws', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await openManual(page);
            await page.evaluate(() => {
                startGame();
                const dirs = [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 0, dy: -1 }];
                for (let i = 0; i < 60 * 90; i++) {
                    if (i % 37 === 0) player.want = dirs[(i / 37) % 4];
                    if (i % 211 === 0) dropSmoke();
                    step(1 / 60);
                }
            });
            expect(errors).toEqual([]);
        });
    });
});
