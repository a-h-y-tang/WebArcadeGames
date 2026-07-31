const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Berzerk', () => {
    test.beforeEach(async ({ page }) => {
        // Test-only helper installed in the page: strips every interior wall so
        // movement / AI tests run in a predictable open arena. It only touches
        // state the game already exposes as globals.
        await page.addInitScript(() => {
            window.emptyArena = () => {
                for (let r = 1; r < ROWS - 1; r++) {
                    for (let c = 1; c < COLS - 1; c++) walls[r][c] = false;
                }
            };
        });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Berzerk', async ({ page }) => {
            await expect(page).toHaveTitle('Berzerk');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('HUD starts at zero score, three lives, room 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#room')).toHaveText('1');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no robots or bullets before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({ r: robots.length, b: bullets.length }));
            expect(counts).toEqual({ r: 0, b: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('berzerk-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
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

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a new game begins in room 1 with 3 lives and no score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { room, lives, score }; });
            expect(s).toEqual({ room: 1, lives: 3, score: 0 });
        });

        test('the player starts inside the room and not inside a wall', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                const col = Math.floor(player.x / CELL);
                const row = Math.floor(player.y / CELL);
                return player.x > 0 && player.x < CANVAS_W &&
                    player.y > 0 && player.y < CANVAS_H && !isWall(col, row);
            });
            expect(ok).toBe(true);
        });

        test('robots are spawned and none overlap a wall', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const inWall = robots.some((r) => isWall(Math.floor(r.x / CELL), Math.floor(r.y / CELL)));
                return { count: robots.length, inWall };
            });
            expect(res.count).toBeGreaterThan(0);
            expect(res.inWall).toBe(false);
        });

        test('later rooms hold at least as many robots as room 1', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const first = robots.length;
                enterRoom(6);
                return { first, later: robots.length };
            });
            expect(res.later).toBeGreaterThanOrEqual(res.first);
        });
    });

    // -----------------------------------------------------------------------
    // Maze generation
    // -----------------------------------------------------------------------
    test.describe('maze', () => {
        test('the border is walled except at the exits', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                let solid = 0, open = 0;
                for (let c = 0; c < COLS; c++) {
                    for (const r of [0, ROWS - 1]) (isWall(c, r) ? solid++ : open++);
                }
                for (let r = 0; r < ROWS; r++) {
                    for (const c of [0, COLS - 1]) (isWall(c, r) ? solid++ : open++);
                }
                return { solid, open };
            });
            expect(res.solid).toBeGreaterThan(0);
            expect(res.open).toBe(10); // 2 exits x 3 rows + 2 exits x 2 cols
        });

        test('every exit gap is reachable from the player start', async ({ page }) => {
            const unreachable = await page.evaluate(() => {
                startGame();
                const start = [Math.floor(player.x / CELL), Math.floor(player.y / CELL)];
                const seen = new Set([start.join(',')]);
                const queue = [start];
                while (queue.length) {
                    const [c, r] = queue.shift();
                    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nc = c + dc, nr = r + dr;
                        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
                        const key = nc + ',' + nr;
                        if (seen.has(key) || isWall(nc, nr)) continue;
                        seen.add(key);
                        queue.push([nc, nr]);
                    }
                }
                return exitCells().filter(([c, r]) => !seen.has(c + ',' + r));
            });
            expect(unreachable).toEqual([]);
        });

        test('every generated room keeps its exits reachable', async ({ page }) => {
            const bad = await page.evaluate(() => {
                const broken = [];
                for (let n = 1; n <= 25; n++) {
                    enterRoom(n);
                    const start = [Math.floor(player.x / CELL), Math.floor(player.y / CELL)];
                    const seen = new Set([start.join(',')]);
                    const queue = [start];
                    while (queue.length) {
                        const [c, r] = queue.shift();
                        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                            const nc = c + dc, nr = r + dr;
                            if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
                            const key = nc + ',' + nr;
                            if (seen.has(key) || isWall(nc, nr)) continue;
                            seen.add(key);
                            queue.push([nc, nr]);
                        }
                    }
                    if (exitCells().some(([c, r]) => !seen.has(c + ',' + r))) broken.push(n);
                }
                return broken;
            });
            expect(bad).toEqual([]);
        });

        test('room layout is deterministic for a given room number', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = JSON.stringify(generateWalls(7));
                const b = JSON.stringify(generateWalls(7));
                return a === b;
            });
            expect(same).toBe(true);
        });

        test('different rooms have different layouts', async ({ page }) => {
            const distinct = await page.evaluate(() => {
                const seen = new Set();
                for (let n = 1; n <= 8; n++) seen.add(JSON.stringify(generateWalls(n)));
                return seen.size;
            });
            expect(distinct).toBeGreaterThan(1);
        });
    });

    // -----------------------------------------------------------------------
    // Player movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('holding right moves the player right', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                emptyArena();
                const before = player.x;
                setDir(1, 0);
                step(0.2);
                return player.x - before;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('holding up moves the player up', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                emptyArena();
                const before = player.y;
                setDir(0, -1);
                step(0.2);
                return player.y - before;
            });
            expect(moved).toBeLessThan(0);
        });

        test('arrow keys drive the player', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { emptyArena(); robots.length = 0; });
            const before = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => player.x);
            expect(after).toBeGreaterThan(before);
        });

        test('walls block the player', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                emptyArena();
                // Drop a wall directly to the player's right.
                const col = Math.floor(player.x / CELL) + 1;
                const row = Math.floor(player.y / CELL);
                walls[row][col] = true;
                setDir(1, 0);
                step(1.0);
                return { x: player.x, wallLeftEdge: col * CELL };
            });
            expect(res.x).toBeLessThanOrEqual(res.wallLeftEdge);
        });

        test('the player cannot walk through the top border', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                emptyArena();
                player.x = CELL * 2 + CELL / 2; // away from the top exit gap
                setDir(0, -1);
                step(3.0);
                return player.y;
            });
            expect(y).toBeGreaterThan(0);
        });

        test('diagonal movement is not faster than straight movement', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                const sx = player.x, sy = player.y;
                setDir(1, 1);
                step(0.1);
                const diag = Math.hypot(player.x - sx, player.y - sy);
                player.x = sx; player.y = sy;
                setDir(1, 0);
                step(0.1);
                const straight = Math.hypot(player.x - sx, player.y - sy);
                return { diag, straight };
            });
            expect(res.diag).toBeLessThanOrEqual(res.straight + 0.01);
            expect(res.diag).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('firing creates a bullet travelling in the facing direction', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                setDir(1, 0);
                step(0.05);
                setDir(0, 0);
                fire();
                const b = bullets[0];
                const x0 = b.x;
                step(0.1);
                return { count: bullets.length, owner: b.owner, dx: b.x - x0 };
            });
            expect(res.count).toBe(1);
            expect(res.owner).toBe('player');
            expect(res.dx).toBeGreaterThan(0);
        });

        test('only one player bullet can be in flight at a time', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                emptyArena();
                fire(); fire(); fire();
                return bullets.filter((b) => b.owner === 'player').length;
            });
            expect(count).toBe(1);
        });

        test('a bullet is absorbed by a wall', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                bullets.length = 0;
                player.x = 100; player.y = 240;
                const row = Math.floor(player.y / CELL);
                walls[row][8] = true;
                setDir(1, 0);
                step(0.001);
                setDir(0, 0);
                fire();
                let maxX = bullets[0].x;
                for (let i = 0; i < 40 && bullets.length; i++) {
                    step(0.02);
                    if (bullets.length) maxX = Math.max(maxX, bullets[0].x);
                }
                return { bullets: bullets.length, maxX, wallLeft: 8 * CELL };
            });
            expect(res.bullets).toBe(0);
            expect(res.maxX).toBeLessThanOrEqual(res.wallLeft + 2);
        });

        test('Space fires while the game is running', async ({ page }) => {
            await page.keyboard.press('Space'); // start
            await page.evaluate(() => { bullets.length = 0; });
            await page.keyboard.press('Space'); // fire
            const count = await page.evaluate(() => bullets.filter((b) => b.owner === 'player').length);
            expect(count).toBe(1);
        });

        test('shooting a robot destroys it and scores points', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                bullets.length = 0;
                player.x = 100; player.y = 240;
                spawnRobot(220, 240);
                setDir(1, 0);
                step(0.001);
                setDir(0, 0);
                fire();
                const before = score;
                step(1.0);
                return { robots: robots.length, gained: score - before };
            });
            expect(res.robots).toBe(0);
            expect(res.gained).toBe(50);
        });

        test('a robot bullet destroys another robot without scoring', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                bullets.length = 0;
                player.x = 600; player.y = 400;
                spawnRobot(220, 400);
                const before = score;
                bullets.push({ x: 120, y: 400, vx: ROBOT_BULLET_SPEED, vy: 0, owner: 'robot' });
                step(1.0);
                return { robots: robots.length, gained: score - before };
            });
            expect(res.robots).toBe(0);
            expect(res.gained).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Robots
    // -----------------------------------------------------------------------
    test.describe('robots', () => {
        test('robots close in on the player', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                bullets.length = 0;
                player.x = 320; player.y = 240;
                const r = spawnRobot(600, 240);
                const before = Math.hypot(r.x - player.x, r.y - player.y);
                setDir(0, 0);
                step(1.0);
                const after = robots.length ? Math.hypot(robots[0].x - player.x, robots[0].y - player.y) : 0;
                return { before, after };
            });
            expect(res.after).toBeLessThan(res.before);
        });

        test('touching a robot costs a life', async ({ page }) => {
            const remaining = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                bullets.length = 0;
                player.x = 320; player.y = 240;
                spawnRobot(324, 240);
                step(0.05);
                return lives;
            });
            expect(remaining).toBe(2);
        });

        test('a robot bullet costs a life', async ({ page }) => {
            const remaining = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                player.x = 320; player.y = 240;
                bullets.length = 0;
                bullets.push({ x: 260, y: 240, vx: ROBOT_BULLET_SPEED, vy: 0, owner: 'robot' });
                step(0.6);
                return lives;
            });
            expect(remaining).toBe(2);
        });

        test("the player's own bullet is harmless to the player", async ({ page }) => {
            const remaining = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                player.x = 320; player.y = 240;
                bullets.length = 0;
                bullets.push({ x: 316, y: 240, vx: BULLET_SPEED, vy: 0, owner: 'player' });
                step(0.05);
                return lives;
            });
            expect(remaining).toBe(3);
        });

        test('robots eventually shoot back', async ({ page }) => {
            const fired = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                bullets.length = 0;
                player.x = 40; player.y = 240;
                spawnRobot(600, 240);
                let seen = 0;
                for (let i = 0; i < 100 && state === 'running'; i++) {
                    step(0.05);
                    seen += bullets.filter((b) => b.owner === 'robot').length;
                }
                return seen;
            });
            expect(fired).toBeGreaterThan(0);
        });

        test('walls block robots too', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                bullets.length = 0;
                player.x = 100; player.y = 240;
                const r = spawnRobot(400, 240);
                for (let row = 1; row < ROWS - 1; row++) walls[row][8] = true;
                step(2.0);
                return { x: r.x, wallRight: 9 * CELL };
            });
            expect(res.x).toBeGreaterThanOrEqual(res.wallRight);
        });
    });

    // -----------------------------------------------------------------------
    // Rooms
    // -----------------------------------------------------------------------
    test.describe('rooms', () => {
        test('walking out of the right exit advances to the next room', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                bullets.length = 0;
                player.y = exitCells().filter(([c]) => c === COLS - 1)[0][1] * CELL + CELL / 2;
                player.x = CANVAS_W - CELL;
                setDir(1, 0);
                step(1.0);
                return { room, x: player.x };
            });
            expect(res.room).toBe(2);
            expect(res.x).toBeLessThan(100); // re-entered from the left side
        });

        test('clearing every robot before leaving awards a bonus', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                robots.length = 0;
                bullets.length = 0;
                const before = score;
                exitRoom('right');
                return { gained: score - before, bonus: ROOM_BONUS };
            });
            expect(res.bonus).toBeGreaterThan(0);
            expect(res.gained).toBe(res.bonus);
        });

        test('leaving robots alive earns no bonus', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                const before = score;
                exitRoom('right');
                return score - before;
            });
            expect(gained).toBe(0);
        });

        test('a new room brings a fresh set of robots', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                robots.length = 0;
                enterRoom(3);
                return robots.length;
            });
            expect(count).toBeGreaterThan(0);
        });

        test('entering a room clears leftover bullets and Evil Otto', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                bullets.push({ x: 10, y: 10, vx: 100, vy: 0, owner: 'robot' });
                spawnOtto();
                enterRoom(4);
                return { bullets: bullets.length, otto: otto === null };
            });
            expect(res).toEqual({ bullets: 0, otto: true });
        });
    });

    // -----------------------------------------------------------------------
    // Evil Otto
    // -----------------------------------------------------------------------
    test.describe('Evil Otto', () => {
        test('Otto is absent when a room begins', async ({ page }) => {
            const absent = await page.evaluate(() => { startGame(); return otto === null; });
            expect(absent).toBe(true);
        });

        test('Otto appears once the room timer passes the delay', async ({ page }) => {
            const present = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                bullets.length = 0;
                player.x = 320; player.y = 240;
                for (let i = 0; i < Math.ceil(OTTO_DELAY / 0.1) + 2; i++) {
                    if (otto) break;
                    step(0.1);
                }
                return otto !== null;
            });
            expect(present).toBe(true);
        });

        test('Otto chases the player through walls', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                robots.length = 0;
                bullets.length = 0;
                player.x = 320; player.y = 240;
                spawnOtto();
                otto.x = 100; otto.y = 240;
                for (let row = 1; row < ROWS - 1; row++) walls[row][6] = true;
                const before = Math.abs(otto.x - player.x);
                step(1.0);
                const after = otto ? Math.abs(otto.x - player.x) : 0;
                return { before, after };
            });
            expect(res.after).toBeLessThan(res.before);
        });

        test('bullets cannot destroy Otto', async ({ page }) => {
            const alive = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                bullets.length = 0;
                player.x = 40; player.y = 240;
                spawnOtto();
                otto.x = 300; otto.y = 240;
                bullets.push({ x: 200, y: 240, vx: BULLET_SPEED, vy: 0, owner: 'player' });
                step(0.6);
                return otto !== null;
            });
            expect(alive).toBe(true);
        });

        test('touching Otto costs a life', async ({ page }) => {
            const remaining = await page.evaluate(() => {
                startGame();
                emptyArena();
                robots.length = 0;
                bullets.length = 0;
                player.x = 320; player.y = 240;
                spawnOtto();
                otto.x = 322; otto.y = 240;
                step(0.05);
                return lives;
            });
            expect(remaining).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Lives, death and game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test('dying restarts the same room with new robots', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                const before = room;
                robots.length = 0;
                killPlayer();
                return { room, before, robots: robots.length, lives };
            });
            expect(res.room).toBe(res.before);
            expect(res.robots).toBeGreaterThan(0);
            expect(res.lives).toBe(2);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                killPlayer(); killPlayer(); killPlayer();
                return { state, lives };
            });
            expect(res).toEqual({ state: 'over', lives: 0 });
        });

        test('game over shows the overlay', async ({ page }) => {
            await page.evaluate(() => { startGame(); killPlayer(); killPlayer(); killPlayer(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('the best score is persisted', async ({ page }) => {
            const stored = await page.evaluate(() => {
                startGame();
                score = 1234;
                killPlayer(); killPlayer(); killPlayer();
                return window.localStorage.getItem('berzerk-best');
            });
            expect(stored).toBe('1234');
        });

        test('the simulation is frozen after game over', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                killPlayer(); killPlayer(); killPlayer();
                const x = player.x;
                setDir(1, 0);
                step(0.5);
                return player.x - x;
            });
            expect(moved).toBe(0);
        });

        test('Space restarts after game over', async ({ page }) => {
            await page.evaluate(() => { startGame(); killPlayer(); killPlayer(); killPlayer(); });
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => ({ state, lives, room }));
            expect(res).toEqual({ state: 'running', lives: 3, room: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                togglePause();
                const x = player.x;
                setDir(1, 0);
                step(0.5);
                return player.x - x;
            });
            expect(moved).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // HUD & rendering
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test('the HUD tracks score, lives and room', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 350;
                lives = 2;
                room = 4;
                step(0.01);
            });
            await expect(page.locator('#score')).toHaveText('350');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#room')).toHaveText('4');
        });

        test('the game runs without page errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.reload();
            await page.keyboard.press('Space');
            await page.waitForTimeout(400);
            expect(errors).toEqual([]);
        });
    });
});
