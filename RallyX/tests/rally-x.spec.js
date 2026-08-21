const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Rally-X', () => {
    test.beforeEach(async ({ page }) => {
        // Test-only helper: drive the car over every flag still on the board.
        await page.addInitScript(() => {
            // Find an open tile whose neighbour in `open` is clear and whose
            // neighbour in `blocked` (optional) is a wall, so the driving tests
            // work whatever maze the generator produced.
            window.findTile = (open, blocked) => {
                for (let y = 1; y < ROWS - 1; y++) {
                    for (let x = 1; x < COLS - 1; x++) {
                        if (isWall(x, y)) continue;
                        if (isWall(x + open[0], y + open[1])) continue;
                        if (blocked && !isWall(x + blocked[0], y + blocked[1])) continue;
                        return [x, y];
                    }
                }
                throw new Error('no tile matching ' + JSON.stringify([open, blocked]));
            };
            // Find a tile whose neighbour in `dir` is open but the tile beyond
            // that is a wall — a corridor the car can drive into and then run
            // out of.
            window.findDeadEnd = (dir) => {
                for (let y = 1; y < ROWS - 1; y++) {
                    for (let x = 1; x < COLS - 1; x++) {
                        if (isWall(x, y)) continue;
                        if (isWall(x + dir[0], y + dir[1])) continue;
                        if (!isWall(x + dir[0] * 2, y + dir[1] * 2)) continue;
                        return [x, y];
                    }
                }
                throw new Error('no dead end along ' + JSON.stringify(dir));
            };
            window.sweepFlags = () => {
                const remaining = flags.length;
                for (let i = 0; i < remaining; i++) {
                    const f = flags[0];
                    placeCarAt(Math.floor(f.x / TILE), Math.floor(f.y / TILE));
                    step(0.016);
                }
            };
        });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
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

        test('the game canvas is 560x420', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '420');
        });

        test('the radar canvas is 180x180', async ({ page }) => {
            const radar = page.locator('#radar');
            await expect(radar).toHaveAttribute('width', '180');
            await expect(radar).toHaveAttribute('height', '180');
        });

        test('score starts at 0 and lives at 3', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle does nothing', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const before = { x: car.x, y: car.y, fuel };
                for (let i = 0; i < 30; i++) step(0.016);
                return car.x !== before.x || car.y !== before.y || fuel !== before.fuel;
            });
            expect(moved).toBe(false);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('rally-x-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // The maze
    // -----------------------------------------------------------------------
    test.describe('maze', () => {
        test('the world is bigger than the viewport', async ({ page }) => {
            const g = await page.evaluate(() => ({ ww: WORLD_W, wh: WORLD_H, vw: VIEW_W, vh: VIEW_H }));
            expect(g.ww).toBeGreaterThan(g.vw);
            expect(g.wh).toBeGreaterThan(g.vh);
        });

        test('the maze is walled all the way around', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let c = 0; c < COLS; c++) {
                    if (!isWall(c, 0) || !isWall(c, ROWS - 1)) return false;
                }
                for (let r = 0; r < ROWS; r++) {
                    if (!isWall(0, r) || !isWall(COLS - 1, r)) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('tiles outside the grid count as walls', async ({ page }) => {
            const ok = await page.evaluate(() => isWall(-1, 5) && isWall(5, -1) && isWall(COLS, 5) && isWall(5, ROWS));
            expect(ok).toBe(true);
        });

        test('the car starts on an open tile', async ({ page }) => {
            const open = await page.evaluate(() => {
                startGame();
                return !isWall(Math.floor(car.x / TILE), Math.floor(car.y / TILE));
            });
            expect(open).toBe(true);
        });

        test('every flag is reachable from the start', async ({ page }) => {
            const unreachable = await page.evaluate(() => {
                startGame();
                const start = [Math.floor(car.x / TILE), Math.floor(car.y / TILE)];
                const seen = new Set([start.join(',')]);
                const queue = [start];
                while (queue.length) {
                    const [cx, cy] = queue.shift();
                    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nx = cx + dx, ny = cy + dy, key = nx + ',' + ny;
                        if (isWall(nx, ny) || seen.has(key)) continue;
                        seen.add(key);
                        queue.push([nx, ny]);
                    }
                }
                return flags.filter((f) => !seen.has(Math.floor(f.x / TILE) + ',' + Math.floor(f.y / TILE))).length;
            });
            expect(unreachable).toBe(0);
        });

        test('the same level always generates the same maze', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                const a = maze.map((row) => row.join('')).join('|');
                startGame();
                const b = maze.map((row) => row.join('')).join('|');
                return a === b;
            });
            expect(same).toBe(true);
        });

        test('a different level generates a different maze', async ({ page }) => {
            const different = await page.evaluate(() => {
                startGame();
                const a = maze.map((row) => row.join('')).join('|');
                level = 2;
                buildLevel();
                const b = maze.map((row) => row.join('')).join('|');
                return a !== b;
            });
            expect(different).toBe(true);
        });

        test('the maze has loops, not just dead ends', async ({ page }) => {
            const { nodes, edges } = await page.evaluate(() => {
                startGame();
                let nodes = 0, edges = 0;
                for (let y = 0; y < ROWS; y++) {
                    for (let x = 0; x < COLS; x++) {
                        if (isWall(x, y)) continue;
                        nodes++;
                        if (!isWall(x + 1, y)) edges++;
                        if (!isWall(x, y + 1)) edges++;
                    }
                }
                return { nodes, edges };
            });
            // A tree (a perfect maze) has exactly nodes - 1 edges; anything more
            // means the carving step opened real loops to drive around.
            expect(edges).toBeGreaterThan(nodes - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh game resets score, lives, level and fuel', async ({ page }) => {
            const s = await page.evaluate(() => {
                score = 999; lives = 1; level = 4; fuel = 3;
                startGame();
                return { score, lives, level, fuel, max: FUEL_MAX, start: START_LIVES };
            });
            expect(s.score).toBe(0);
            expect(s.lives).toBe(s.start);
            expect(s.level).toBe(1);
            expect(s.fuel).toBe(s.max);
        });

        test('a fresh level places all the flags', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                return { flags: flags.length, want: FLAG_COUNT };
            });
            expect(n.flags).toBe(n.want);
        });

        test('exactly one flag is the special flag', async ({ page }) => {
            const specials = await page.evaluate(() => {
                startGame();
                return flags.filter((f) => f.special).length;
            });
            expect(specials).toBe(1);
        });

        test('no flag sits on top of the car', async ({ page }) => {
            const minDist = await page.evaluate(() => {
                startGame();
                return Math.min(...flags.map((f) => Math.hypot(f.x - car.x, f.y - car.y))) / TILE;
            });
            expect(minDist).toBeGreaterThanOrEqual(4);
        });

        test('chase cars are on the board and on open tiles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return {
                    count: enemies.length,
                    allOpen: enemies.every((e) => !isWall(Math.floor(e.x / TILE), Math.floor(e.y / TILE))),
                };
            });
            expect(s.count).toBeGreaterThanOrEqual(2);
            expect(s.allOpen).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Driving
    // -----------------------------------------------------------------------
    test.describe('driving', () => {
        test('the car drives in the direction it faces', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                placeCarAt(...findTile([1, 0]));
                setDirection(1, 0);
                const before = car.x;
                for (let i = 0; i < 10; i++) step(0.016);
                return car.x - before;
            });
            expect(d).toBeGreaterThan(0);
        });

        test('the car turns when the new direction is open', async ({ page }) => {
            const dy = await page.evaluate(() => {
                startGame();
                placeCarAt(...findTile([0, 1]));
                setDirection(0, 1);
                const before = car.y;
                for (let i = 0; i < 10; i++) step(0.016);
                return car.y - before;
            });
            expect(dy).toBeGreaterThan(0);
        });

        for (const [name, dir] of [
            ['left', [-1, 0]],
            ['right', [1, 0]],
            ['up', [0, -1]],
            ['down', [0, 1]],
        ]) {
            test(`the car will not turn ${name} into a wall`, async ({ page }) => {
                const s = await page.evaluate((dir) => {
                    startGame();
                    // A tile that is open the other way but walled off in `dir`.
                    const across = dir[0] === 0 ? [1, 0] : [0, 1];
                    const [cx, cy] = findTile(across, dir);
                    placeCarAt(cx, cy);
                    setDirection(dir[0], dir[1]);
                    for (let i = 0; i < 60; i++) step(0.016);
                    return {
                        tile: [Math.floor(car.x / TILE), Math.floor(car.y / TILE)],
                        want: [cx, cy],
                    };
                }, dir);
                // The car coasts to the middle of its tile and stays there.
                expect(s.tile).toEqual(s.want);
            });

            test(`a car driving ${name} stops where the corridor ends`, async ({ page }) => {
                const s = await page.evaluate((dir) => {
                    // A tile whose neighbour is open but the tile beyond is a wall,
                    // so the car has to be driving when the corridor runs out.
                    startGame();
                    const [cx, cy] = findDeadEnd(dir);
                    placeCarAt(cx, cy);
                    setDirection(dir[0], dir[1]);
                    for (let i = 0; i < 60; i++) step(0.016);
                    return {
                        tile: [Math.floor(car.x / TILE), Math.floor(car.y / TILE)],
                        want: [cx + dir[0], cy + dir[1]],
                    };
                }, dir);
                expect(s.tile).toEqual(s.want);
            });
        }

        test('a turn into a wall is queued until it becomes possible', async ({ page }) => {
            const turned = await page.evaluate(() => {
                startGame();
                placeCarAt(...findTile([1, 0], [0, -1]));     // open right, wall above
                setDirection(1, 0);
                for (let i = 0; i < 5; i++) step(0.016);
                setDirection(0, -1);                          // up is a wall: impossible
                for (let i = 0; i < 5; i++) step(0.016);
                return { dir: { ...car.dir }, next: { ...car.nextDir } };
            });
            expect(turned.dir).toEqual({ x: 1, y: 0 });
            expect(turned.next).toEqual({ x: 0, y: -1 });
        });

        test('the car never leaves the world', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
                for (let i = 0; i < 600; i++) {
                    if (i % 20 === 0) setDirection(...dirs[(i / 20) % 4]);
                    step(0.016);
                    if (car.x < 0 || car.y < 0 || car.x > WORLD_W || car.y > WORLD_H) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the car never ends a step inside a wall', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
                for (let i = 0; i < 900; i++) {
                    if (i % 13 === 0) setDirection(...dirs[(i / 13 | 0) % 4]);
                    step(0.016);
                    if (isWall(Math.floor(car.x / TILE), Math.floor(car.y / TILE))) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('arrow keys steer the car', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => ({ ...car.nextDir }))).toEqual({ x: 0, y: 1 });
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => ({ ...car.nextDir }))).toEqual({ x: 1, y: 0 });
        });

        test('WASD steers the car', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('s');
            expect(await page.evaluate(() => ({ ...car.nextDir }))).toEqual({ x: 0, y: 1 });
            await page.keyboard.press('d');
            expect(await page.evaluate(() => ({ ...car.nextDir }))).toEqual({ x: 1, y: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Camera / radar
    // -----------------------------------------------------------------------
    test.describe('camera', () => {
        test('the camera keeps the car on screen', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                placeCarAt(COLS - 2, ROWS - 2);
                setDirection(-1, 0);
                for (let i = 0; i < 200; i++) {
                    step(0.016);
                    const sx = car.x - camera.x, sy = car.y - camera.y;
                    if (sx < 0 || sy < 0 || sx > VIEW_W || sy > VIEW_H) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the camera never shows outside the world', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                placeCarAt(1, 1);
                for (let i = 0; i < 30; i++) step(0.016);
                if (camera.x < 0 || camera.y < 0) return false;
                placeCarAt(COLS - 2, ROWS - 2);
                for (let i = 0; i < 30; i++) step(0.016);
                return camera.x + VIEW_W <= WORLD_W && camera.y + VIEW_H <= WORLD_H;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Flags & scoring
    // -----------------------------------------------------------------------
    test.describe('flags', () => {
        test('driving over a flag collects it and scores', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const f = flags.find((x) => !x.special);
                placeCarAt(Math.floor(f.x / TILE), Math.floor(f.y / TILE));
                step(0.016);
                return { score, left: flags.length, points: FLAG_POINTS };
            });
            expect(s.score).toBe(s.points);
            expect(s.left).toBe(7);
        });

        test('the flag counter in the HUD counts down', async ({ page }) => {
            await expect(page.locator('#flags')).toHaveText('8');
            await page.evaluate(() => {
                startGame();
                const f = flags.find((x) => !x.special);
                placeCarAt(Math.floor(f.x / TILE), Math.floor(f.y / TILE));
                step(0.016);
            });
            await expect(page.locator('#flags')).toHaveText('7');
        });

        test('the special flag doubles every flag collected after it', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const special = flags.find((x) => x.special);
                placeCarAt(Math.floor(special.x / TILE), Math.floor(special.y / TILE));
                step(0.016);
                const afterSpecial = score;
                const next = flags.find((x) => !x.special);
                placeCarAt(Math.floor(next.x / TILE), Math.floor(next.y / TILE));
                step(0.016);
                return { afterSpecial, afterNext: score, points: FLAG_POINTS };
            });
            expect(s.afterSpecial).toBe(s.points);
            expect(s.afterNext - s.afterSpecial).toBe(s.points * 2);
        });

        test('flags collected before the special one score single', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const plain = flags.filter((x) => !x.special).slice(0, 2);
                for (const f of plain) {
                    placeCarAt(Math.floor(f.x / TILE), Math.floor(f.y / TILE));
                    step(0.016);
                }
                return { score, points: FLAG_POINTS };
            });
            expect(s.score).toBe(s.points * 2);
        });

        test('collecting every flag advances to the next level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                sweepFlags();
                return { level, flags: flags.length, fuel, max: FUEL_MAX, want: FLAG_COUNT };
            });
            expect(s.level).toBe(2);
            expect(s.flags).toBe(s.want);
            expect(s.fuel).toBe(s.max);
        });

        test('clearing a level awards a bonus for the fuel left in the tank', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                fuel = 20;
                sweepFlags();
                const lean = score;
                startGame();
                fuel = 80;
                sweepFlags();
                return { lean, rich: score };
            });
            expect(s.rich).toBeGreaterThan(s.lean);
        });

        test('later levels add another chase car', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const first = enemies.length;
                sweepFlags();
                return { first, second: enemies.length };
            });
            expect(s.second).toBe(s.first + 1);
        });

        test('the level counter in the HUD updates', async ({ page }) => {
            await page.evaluate(() => { startGame(); sweepFlags(); });
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test('fuel burns while driving', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const before = fuel;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: fuel };
            });
            expect(s.after).toBeLessThan(s.before);
        });

        test('the fuel gauge reflects the tank', async ({ page }) => {
            await page.evaluate(() => { startGame(); fuel = FUEL_MAX / 2; step(0); });
            const width = await page.locator('#fuel-bar').evaluate((el) => el.style.width);
            expect(parseFloat(width)).toBeGreaterThan(45);
            expect(parseFloat(width)).toBeLessThan(55);
        });

        test('a low tank flags the gauge as low', async ({ page }) => {
            await page.evaluate(() => { startGame(); fuel = 10; step(0); });
            await expect(page.locator('#fuel-bar')).toHaveClass(/low/);
        });

        test('a full tank is not flagged low', async ({ page }) => {
            await page.evaluate(() => { startGame(); step(0); });
            await expect(page.locator('#fuel-bar')).not.toHaveClass(/low/);
        });

        test('running out of fuel wrecks the car', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                fuel = 0.01;
                const before = lives;
                for (let i = 0; i < 5; i++) step(0.016);
                return { before, after: lives, fuel };
            });
            expect(s.after).toBe(s.before - 1);
            expect(s.fuel).toBeGreaterThan(0);
        });

        test('fuel never goes negative', async ({ page }) => {
            const f = await page.evaluate(() => {
                startGame();
                fuel = 0.001;
                for (let i = 0; i < 30; i++) step(0.016);
                return fuel;
            });
            expect(f).toBeGreaterThanOrEqual(0);
        });
    });

    // -----------------------------------------------------------------------
    // Smoke screen
    // -----------------------------------------------------------------------
    test.describe('smoke screen', () => {
        test('dropping smoke adds a cloud and burns fuel', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const before = fuel;
                dropSmoke();
                return { clouds: smokes.length, spent: before - fuel, cost: SMOKE_COST };
            });
            expect(s.clouds).toBe(1);
            expect(s.spent).toBeCloseTo(s.cost, 5);
        });

        test('smoke is laid behind the car', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                placeCarAt(...findTile([1, 0]));
                setDirection(1, 0);
                for (let i = 0; i < 4; i++) step(0.016);
                dropSmoke();
                return { smokeX: smokes[0].x, carX: car.x };
            });
            expect(s.smokeX).toBeLessThan(s.carX);
        });

        test('smoke cannot be dropped without enough fuel', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                fuel = SMOKE_COST - 1;
                dropSmoke();
                return { clouds: smokes.length, fuel };
            });
            expect(s.clouds).toBe(0);
            expect(s.fuel).toBe(await page.evaluate(() => SMOKE_COST - 1));
        });

        test('Space drops smoke while running', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => smokes.length)).toBe(1);
        });

        test('smoke expires', async ({ page }) => {
            const left = await page.evaluate(() => {
                startGame();
                dropSmoke();
                const steps = Math.ceil(SMOKE_LIFE / 0.016) + 5;
                for (let i = 0; i < steps; i++) step(0.016);
                return smokes.length;
            });
            expect(left).toBe(0);
        });

        test('a chase car driving into smoke spins out', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                smokes.push({ x: e.x, y: e.y, life: SMOKE_LIFE });
                step(0.016);
                return { stun: e.stun, time: STUN_TIME };
            });
            expect(s.stun).toBeGreaterThan(0);
            expect(s.stun).toBeLessThanOrEqual(s.time);
        });

        test('a spun-out chase car does not move', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                e.stun = STUN_TIME;
                const before = { x: e.x, y: e.y };
                for (let i = 0; i < 30; i++) step(0.016);
                return e.x !== before.x || e.y !== before.y;
            });
            expect(moved).toBe(false);
        });

        test('a spun-out chase car recovers', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                e.stun = 0.05;
                for (let i = 0; i < 10; i++) step(0.016);
                return e.stun;
            });
            expect(s).toBe(0);
        });

        test('a spun-out chase car cannot wreck the player', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                e.stun = STUN_TIME;
                e.x = car.x;
                e.y = car.y;
                const before = lives;
                step(0.016);
                return { before, after: lives };
            });
            expect(s.after).toBe(s.before);
        });
    });

    // -----------------------------------------------------------------------
    // Chase cars
    // -----------------------------------------------------------------------
    test.describe('chase cars', () => {
        test('a chase car closes on the player', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const e = enemies[0];
                const dist = () => Math.hypot(e.x - car.x, e.y - car.y);
                const before = dist();
                for (let i = 0; i < 180; i++) step(0.016);
                return { before, after: dist() };
            });
            expect(s.after).toBeLessThan(s.before);
        });

        test('chase cars stay out of the walls', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    for (const e of enemies) {
                        if (isWall(Math.floor(e.x / TILE), Math.floor(e.y / TILE))) return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('chase cars stay inside the world', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    for (const e of enemies) {
                        if (e.x < 0 || e.y < 0 || e.x > WORLD_W || e.y > WORLD_H) return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('being rammed costs a life', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const before = lives;
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(0.016);
                return { before, after: lives };
            });
            expect(s.after).toBe(s.before - 1);
        });

        test('a wreck sends everyone back to their starting tiles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const start = { x: car.x, y: car.y };
                placeCarAt(COLS - 2, ROWS - 2);
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(0.016);
                return { start, now: { x: car.x, y: car.y } };
            });
            expect(s.now).toEqual(s.start);
        });

        test('a wreck keeps the flags already collected', async ({ page }) => {
            const left = await page.evaluate(() => {
                startGame();
                const f = flags[0];
                placeCarAt(Math.floor(f.x / TILE), Math.floor(f.y / TILE));
                step(0.016);
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(0.016);
                return flags.length;
            });
            expect(left).toBe(7);
        });

        test('the HUD shows the remaining lives', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(0.016);
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(0.016);
                return { state, lives };
            });
            expect(s.lives).toBe(0);
            expect(s.state).toBe('over');
        });

        test('the overlay announces the game over and the score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1500;
                lives = 1;
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(0.016);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
            await expect(page.locator('#overlay-score')).toContainText('1500');
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('nothing moves once the game is over', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                lives = 1;
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(0.016);
                const before = { x: car.x, y: car.y, e: enemies[0].x };
                for (let i = 0; i < 30; i++) step(0.016);
                return car.x !== before.x || car.y !== before.y || enemies[0].x !== before.e;
            });
            expect(moved).toBe(false);
        });

        test('the best score is kept and stored', async ({ page }) => {
            const stored = await page.evaluate(() => {
                startGame();
                score = 2600;
                lives = 1;
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(0.016);
                return window.localStorage.getItem('rally-x-best');
            });
            expect(parseInt(stored, 10)).toBe(2600);
            await expect(page.locator('#best')).toHaveText('2600');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('rally-x-best', '9000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 100;
                lives = 1;
                enemies[0].x = car.x;
                enemies[0].y = car.y;
                step(0.016);
            });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ state, score, lives }))).toEqual(
                await page.evaluate(() => ({ state: 'running', score: 0, lives: START_LIVES })),
            );
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('pausing freezes the car and the fuel', async ({ page }) => {
            const changed = await page.evaluate(() => {
                startGame();
                setDirection(1, 0);
                togglePause();
                const before = { x: car.x, y: car.y, fuel };
                for (let i = 0; i < 20; i++) step(0.016);
                return car.x !== before.x || car.y !== before.y || fuel !== before.fuel;
            });
            expect(changed).toBe(false);
        });

        test('the overlay explains the pause', async ({ page }) => {
            await page.evaluate(() => { startGame(); togglePause(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('pausing is ignored before the game starts', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('smoke cannot be dropped while paused', async ({ page }) => {
            const clouds = await page.evaluate(() => {
                startGame();
                togglePause();
                dropSmoke();
                return smokes.length;
            });
            expect(clouds).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the game draws something on the canvas', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const ctx = document.getElementById('canvas').getContext('2d');
                const data = ctx.getImageData(0, 0, VIEW_W, VIEW_H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                    if (seen.size > 3) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the radar draws the whole map', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const ctx = document.getElementById('radar').getContext('2d');
                const data = ctx.getImageData(0, 0, RADAR_W, RADAR_H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                    if (seen.size > 2) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the animation loop runs without errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => startGame());
            await page.waitForTimeout(500);
            expect(errors).toEqual([]);
            expect(await page.evaluate(() => state)).not.toBe('idle');
        });
    });
});
