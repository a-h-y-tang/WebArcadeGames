const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Mirrors TILE in game.js; used for spec-side distance assertions.
const TILE_SIZE = 32;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

const KEY_DIR = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    a: 'left',
    d: 'right',
    w: 'up',
    s: 'down',
};

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so every press is confirmed against the game state before the simulation
// is advanced. Without this the specs race the input handler.
const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction(
        (want) => player.dir === want && player.moving,
        KEY_DIR[key]
    );
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction(() => !player.moving);
};

// Start a level with the animation loop and enemy spawner switched off, so the
// specs own every simulated frame.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        loopEnabled = false;
        spawnEnabled = false;
        enemies.length = 0;
        bullets.length = 0;
    });

// Empty the battlefield apart from the base and its wall, giving movement and
// bullet specs a known arena.
const clearArena = (page) =>
    page.evaluate(() => {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (tileAt(c, r) !== BASE) setTile(c, r, EMPTY);
            }
        }
    });

test.describe('Tank Battle', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(() => localStorage.removeItem('tankbattle-best'));
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tank Battle', async ({ page }) => {
            await expect(page).toHaveTitle('Tank Battle');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 416x416', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '416');
            await expect(canvas).toHaveAttribute('height', '416');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('grid is 13 x 13 tiles', async ({ page }) => {
            const dims = await page.evaluate(() => ({
                rows: grid.length,
                cols: grid[0].length,
                COLS,
                ROWS,
            }));
            expect(dims).toEqual({ rows: 13, cols: 13, COLS: 13, ROWS: 13 });
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the player tank spawns alive on its spawn tile facing up', async ({ page }) => {
            await startQuiet(page);
            const p = await page.evaluate(() => ({
                col: Math.floor(player.x / TILE),
                row: Math.floor(player.y / TILE),
                dir: player.dir,
                alive: player.alive,
                spawn: PLAYER_SPAWN,
            }));
            expect(p.col).toBe(p.spawn.col);
            expect(p.row).toBe(p.spawn.row);
            expect(p.dir).toBe('up');
            expect(p.alive).toBe(true);
        });

        test('the base starts intact behind a brick wall', async ({ page }) => {
            await startQuiet(page);
            const info = await page.evaluate(() => ({
                baseAlive,
                baseTile: tileAt(BASE_COL, BASE_ROW),
                wall: [
                    tileAt(BASE_COL - 1, BASE_ROW),
                    tileAt(BASE_COL + 1, BASE_ROW),
                    tileAt(BASE_COL - 1, BASE_ROW - 1),
                    tileAt(BASE_COL, BASE_ROW - 1),
                    tileAt(BASE_COL + 1, BASE_ROW - 1),
                ],
                BRICK,
                BASE,
            }));
            expect(info.baseAlive).toBe(true);
            expect(info.baseTile).toBe(info.BASE);
            expect(info.wall.every((t) => t === info.BRICK)).toBe(true);
        });

        test('a level starts with a squad of enemies still to spawn', async ({ page }) => {
            await startQuiet(page);
            const info = await page.evaluate(() => ({ left: enemiesLeft, alive: enemies.length }));
            expect(info.left).toBeGreaterThanOrEqual(8);
            expect(info.alive).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Level layout
    // -----------------------------------------------------------------------
    test.describe('level layout', () => {
        test('spawn tiles are clear of obstacles', async ({ page }) => {
            await startQuiet(page);
            const blocked = await page.evaluate(() =>
                [PLAYER_SPAWN, ...ENEMY_SPAWNS].filter((s) => blocksTank(tileAt(s.col, s.row)))
            );
            expect(blocked).toEqual([]);
        });

        test('every tile holds a known terrain type', async ({ page }) => {
            await startQuiet(page);
            const unknown = await page.evaluate(() => {
                const known = [EMPTY, BRICK, STEEL, WATER, TREES, BASE];
                return grid.flat().filter((t) => !known.includes(t));
            });
            expect(unknown).toEqual([]);
        });

        test('enemy spawns can reach the base through destructible terrain', async ({ page }) => {
            const unreachable = await page.evaluate(() => {
                const bad = [];
                for (let lvl = 1; lvl <= 6; lvl++) {
                    startGame();
                    level = lvl;
                    startLevel();
                    for (const spawn of ENEMY_SPAWNS) {
                        const seen = new Set([spawn.row * COLS + spawn.col]);
                        const queue = [spawn];
                        let found = false;
                        while (queue.length) {
                            const { col, row } = queue.shift();
                            if (col === BASE_COL && row === BASE_ROW) { found = true; break; }
                            for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                                const c = col + dc;
                                const r = row + dr;
                                if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
                                const key = r * COLS + c;
                                if (seen.has(key)) continue;
                                const t = tileAt(c, r);
                                if (t === STEEL || t === WATER) continue;
                                seen.add(key);
                                queue.push({ col: c, row: r });
                            }
                        }
                        if (!found) bad.push({ lvl, spawn });
                    }
                }
                return bad;
            });
            expect(unreachable).toEqual([]);
        });

        test('the same seed rebuilds the same battlefield', async ({ page }) => {
            const [a, b] = await page.evaluate(() => {
                setSeed(1234);
                startLevel();
                const first = grid.flat().join('');
                setSeed(1234);
                startLevel();
                return [first, grid.flat().join('')];
            });
            expect(a).toBe(b);
            expect(a.length).toBe(169);
        });
    });

    // -----------------------------------------------------------------------
    // Driving the tank
    // -----------------------------------------------------------------------
    test.describe('player movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await clearArena(page);
        });

        test('ArrowLeft turns the tank left and starts it moving', async ({ page }) => {
            await hold(page, 'ArrowLeft');
            expect(await page.evaluate(() => player.dir)).toBe('left');
        });

        test('WASD keys steer as well', async ({ page }) => {
            await hold(page, 'w');
            expect(await page.evaluate(() => player.dir)).toBe('up');
        });

        test('holding left drives the tank left', async ({ page }) => {
            const before = await page.evaluate(() => player.x);
            await hold(page, 'ArrowLeft');
            await advance(page, 30);
            expect(await page.evaluate(() => player.x)).toBeLessThan(before - 20);
        });

        test('releasing the key stops the tank but keeps it facing', async ({ page }) => {
            await hold(page, 'ArrowLeft');
            await advance(page, 10);
            await release(page, 'ArrowLeft');
            const x = await page.evaluate(() => player.x);
            await advance(page, 30);
            const after = await page.evaluate(() => ({ x: player.x, dir: player.dir }));
            expect(after.x).toBe(x);
            expect(after.dir).toBe('left');
        });

        test('steel blocks the tank', async ({ page }) => {
            await page.evaluate(() => {
                const col = Math.floor(player.x / TILE);
                const row = Math.floor(player.y / TILE);
                setTile(col - 1, row, STEEL);
            });
            const before = await page.evaluate(() => player.x);
            await hold(page, 'ArrowLeft');
            await advance(page, 60);
            const after = await page.evaluate(() => player.x);
            expect(after).toBeLessThan(before);
            expect(after).toBeGreaterThan(before - TILE_SIZE);
        });

        test('brick blocks the tank', async ({ page }) => {
            await page.evaluate(() => {
                const col = Math.floor(player.x / TILE);
                const row = Math.floor(player.y / TILE);
                setTile(col + 1, row, BRICK);
            });
            const before = await page.evaluate(() => player.x);
            await hold(page, 'ArrowRight');
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBeLessThan(before + TILE_SIZE);
        });

        test('water blocks the tank', async ({ page }) => {
            await page.evaluate(() => {
                const col = Math.floor(player.x / TILE);
                const row = Math.floor(player.y / TILE);
                setTile(col - 1, row, WATER);
            });
            const before = await page.evaluate(() => player.x);
            await hold(page, 'ArrowLeft');
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(before - TILE_SIZE);
        });

        test('the tank drives under trees', async ({ page }) => {
            await page.evaluate(() => {
                const col = Math.floor(player.x / TILE);
                const row = Math.floor(player.y / TILE);
                setTile(col - 1, row, TREES);
                setTile(col - 2, row, TREES);
            });
            const before = await page.evaluate(() => player.x);
            await hold(page, 'ArrowLeft');
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBeLessThan(before - TILE_SIZE);
        });

        test('the tank cannot drive off the battlefield', async ({ page }) => {
            await hold(page, 'ArrowUp');
            await advance(page, 400);
            const y = await page.evaluate(() => player.y);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThan(TILE_SIZE);
        });

        test('turning onto the other axis snaps the tank into its lane', async ({ page }) => {
            const nudged = await page.evaluate(() => {
                player.y += 7;
                return player.y;
            });
            await hold(page, 'ArrowLeft');
            const y = await page.evaluate(() => player.y);
            expect(y).toBe(nudged - 7);
            expect((y - TILE_SIZE / 2) % TILE_SIZE).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await clearArena(page);
        });

        test('Space fires a shell owned by the player', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => bullets.length === 1);
            expect(await page.evaluate(() => bullets[0].owner)).toBe('player');
        });

        test('the player may only have one shell in flight', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => bullets.length === 1);
            await page.keyboard.press('Space');
            await advance(page, 5);
            expect(await page.evaluate(() => bullets.filter((b) => b.owner === 'player').length)).toBe(1);
        });

        test('the shell flies in the direction the tank faces', async ({ page }) => {
            await hold(page, 'ArrowLeft');
            await release(page, 'ArrowLeft');
            await page.keyboard.press('Space');
            await page.waitForFunction(() => bullets.length === 1);
            const before = await page.evaluate(() => bullets[0].x);
            await advance(page, 5);
            expect(await page.evaluate(() => bullets[0].x)).toBeLessThan(before);
        });

        test('a shell smashes a brick and is spent', async ({ page }) => {
            const target = await page.evaluate(() => {
                const col = Math.floor(player.x / TILE);
                const row = Math.floor(player.y / TILE) - 2;
                setTile(col, row, BRICK);
                return { col, row };
            });
            await page.keyboard.press('Space');
            await page.waitForFunction(() => bullets.length === 1);
            await advance(page, 40);
            const after = await page.evaluate(
                (t) => ({ tile: tileAt(t.col, t.row), bullets: bullets.length, EMPTY }),
                target
            );
            expect(after.tile).toBe(after.EMPTY);
            expect(after.bullets).toBe(0);
        });

        test('steel shrugs off a shell', async ({ page }) => {
            const target = await page.evaluate(() => {
                const col = Math.floor(player.x / TILE);
                const row = Math.floor(player.y / TILE) - 2;
                setTile(col, row, STEEL);
                return { col, row };
            });
            await page.keyboard.press('Space');
            await page.waitForFunction(() => bullets.length === 1);
            await advance(page, 40);
            const after = await page.evaluate(
                (t) => ({ tile: tileAt(t.col, t.row), bullets: bullets.length, STEEL }),
                target
            );
            expect(after.tile).toBe(after.STEEL);
            expect(after.bullets).toBe(0);
        });

        test('shells fly over water and trees', async ({ page }) => {
            await page.evaluate(() => {
                const col = Math.floor(player.x / TILE);
                const row = Math.floor(player.y / TILE);
                setTile(col, row - 2, WATER);
                setTile(col, row - 3, TREES);
            });
            await page.keyboard.press('Space');
            await page.waitForFunction(() => bullets.length === 1);
            await advance(page, 20);
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('a shell that reaches the wall is spent', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => bullets.length === 1);
            await advance(page, 200);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('opposing shells cancel each other out', async ({ page }) => {
            await page.evaluate(() => {
                bullets.length = 0;
                spawnBullet(200, 200, 'right', 'player');
                spawnBullet(230, 200, 'left', 'enemy');
            });
            await advance(page, 20);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await clearArena(page);
        });

        test('an enemy tank can be put on the field', async ({ page }) => {
            const n = await page.evaluate(() => {
                spawnEnemyAt(2, 2, 'basic');
                return enemies.length;
            });
            expect(n).toBe(1);
        });

        test('a player shell destroys an enemy and scores 100', async ({ page }) => {
            await page.evaluate(() => {
                const col = Math.floor(player.x / TILE);
                const enemy = spawnEnemyAt(col, Math.floor(player.y / TILE) - 3, 'basic');
                enemy.frozen = true;
                enemy.spawnFlash = 0;
            });
            await page.keyboard.press('Space');
            await page.waitForFunction(() => bullets.length === 1);
            await advance(page, 60);
            const after = await page.evaluate(() => ({ enemies: enemies.length, score }));
            expect(after.enemies).toBe(0);
            expect(after.score).toBe(100);
            await expect(page.locator('#score')).toHaveText('100');
        });

        test('an armoured tank takes two shells and scores more', async ({ page }) => {
            await page.evaluate(() => {
                const enemy = spawnEnemyAt(2, 2, 'armor');
                enemy.frozen = true;
                enemy.spawnFlash = 0;
                spawnBullet(enemy.x - 30, enemy.y, 'right', 'player');
            });
            await advance(page, 30);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
            await page.evaluate(() => spawnBullet(enemies[0].x - 30, enemies[0].y, 'right', 'player'));
            await advance(page, 30);
            const after = await page.evaluate(() => ({ enemies: enemies.length, score }));
            expect(after.enemies).toBe(0);
            expect(after.score).toBeGreaterThan(100);
        });

        test('no more than four enemies are on the field at once', async ({ page }) => {
            const most = await page.evaluate(() => {
                spawnEnabled = true;
                let peak = 0;
                for (let i = 0; i < 3000; i++) {
                    step(1 / 60);
                    peak = Math.max(peak, enemies.length);
                }
                return peak;
            });
            expect(most).toBeGreaterThan(0);
            expect(most).toBeLessThanOrEqual(4);
        });

        test('enemy tanks patrol the battlefield', async ({ page }) => {
            const moved = await page.evaluate(() => {
                spawnEnemyAt(6, 4, 'basic');
                const e = enemies[0];
                const x0 = e.x;
                const y0 = e.y;
                for (let i = 0; i < 180; i++) step(1 / 60);
                return Math.abs(e.x - x0) + Math.abs(e.y - y0);
            });
            expect(moved).toBeGreaterThan(5);
        });

        test('tanks cannot drive through each other', async ({ page }) => {
            await page.evaluate(() => {
                const col = Math.floor(player.x / TILE);
                const row = Math.floor(player.y / TILE);
                spawnEnemyAt(col, row - 1, 'basic');
                enemies[0].frozen = true;
            });
            const before = await page.evaluate(() => player.y);
            await hold(page, 'ArrowUp');
            await advance(page, 60);
            const after = await page.evaluate(() => player.y);
            expect(after).toBeGreaterThan(before - TILE_SIZE);
        });

        test('an enemy shell costs the player a life and respawns the tank', async ({ page }) => {
            await page.evaluate(() => {
                player.invuln = 0;
                spawnBullet(player.x, player.y - 30, 'down', 'enemy');
            });
            await advance(page, 30);
            const after = await page.evaluate(() => ({
                lives,
                invuln: player.invuln,
                col: Math.floor(player.x / TILE),
                row: Math.floor(player.y / TILE),
                spawn: PLAYER_SPAWN,
            }));
            expect(after.lives).toBe(2);
            expect(after.invuln).toBeGreaterThan(0);
            expect(after.col).toBe(after.spawn.col);
            expect(after.row).toBe(after.spawn.row);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('a freshly respawned tank is briefly invulnerable', async ({ page }) => {
            await page.evaluate(() => {
                player.invuln = 2;
                spawnBullet(player.x, player.y - 30, 'down', 'enemy');
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('a shell in the base ends the game', async ({ page }) => {
            await page.evaluate(() =>
                spawnBullet(BASE_COL * TILE + TILE / 2, BASE_ROW * TILE - 20, 'down', 'enemy')
            );
            await advance(page, 40);
            const after = await page.evaluate(() => ({ state, baseAlive }));
            expect(after.baseAlive).toBe(false);
            expect(after.state).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Level progression
    // -----------------------------------------------------------------------
    test.describe('level progression', () => {
        test('wiping out the squad advances to the next level', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { enemiesLeft = 0; enemies.length = 0; });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('levelclear');
            await advance(page, 240);
            const after = await page.evaluate(() => ({ state, level, left: enemiesLeft }));
            expect(after.level).toBe(2);
            expect(after.state).toBe('playing');
            expect(after.left).toBeGreaterThan(0);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('later levels send more tanks', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                const first = enemiesLeft;
                level = 4;
                startLevel();
                return [first, enemiesLeft];
            });
            expect(counts[1]).toBeGreaterThan(counts[0]);
        });

        test('the player keeps their score across levels', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 500;
                enemiesLeft = 0;
                enemies.length = 0;
            });
            await advance(page, 240);
            expect(await page.evaluate(() => score)).toBe(500);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, game over and restart
    // -----------------------------------------------------------------------
    test.describe('pause, game over and restart', () => {
        test('P pauses and resumes the battle', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a paused battle does not advance', async ({ page }) => {
            await startQuiet(page);
            await clearArena(page);
            await hold(page, 'ArrowLeft');
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            const before = await page.evaluate(() => player.x);
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(before);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                player.invuln = 0;
                spawnBullet(player.x, player.y - 30, 'down', 'enemy');
            });
            await advance(page, 30);
            const after = await page.evaluate(() => ({ state, lives }));
            expect(after.state).toBe('gameover');
            expect(after.lives).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the best score is remembered', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 700;
                lives = 1;
                player.invuln = 0;
                spawnBullet(player.x, player.y - 30, 'down', 'enemy');
            });
            await advance(page, 30);
            expect(await page.evaluate(() => best)).toBe(700);
            expect(await page.evaluate(() => localStorage.getItem('tankbattle-best'))).toBe('700');
            await expect(page.locator('#best')).toHaveText('700');
        });

        test('restarting resets score, level and lives', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 900;
                level = 3;
                lives = 1;
                player.invuln = 0;
                spawnBullet(player.x, player.y - 30, 'down', 'enemy');
            });
            await advance(page, 30);
            await page.waitForFunction(() => state === 'gameover');
            await page.locator('#btn-start').click();
            const after = await page.evaluate(() => ({ state, score, level, lives, baseAlive }));
            expect(after).toEqual({ state: 'playing', score: 0, level: 1, lives: 3, baseAlive: true });
        });
    });
});
