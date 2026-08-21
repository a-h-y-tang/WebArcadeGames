const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

const TILE = 28;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Every spec below drives the clock itself, so the page's own
// requestAnimationFrame loop is told not to step the simulation. draw() keeps
// running, so the canvas still renders while the world is frozen.
const freeze = (page) => page.evaluate(() => { autoLoop = false; });

// Start a level with a fixed seed (same maze every run) and no enemy spawner,
// so long simulations stay deterministic. Specs about enemies spawn their own.
const startQuiet = (page, seed = 1234) =>
    page.evaluate((s) => {
        startGame(s);
        spawnEnabled = false;
        enemies.length = 0;
        bullets.length = 0;
        powerups.length = 0;
    }, seed);

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so a press is confirmed against game state before the clock advances.
const KEY_DIR = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down',
};

const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction((want) => heldDir() === want, KEY_DIR[key]);
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction(() => heldDir() === null);
};

// Put the player on a known tile with a known facing, on cleared ground.
const place = (page, col, row, dir = 'right') =>
    page.evaluate(([c, r, d]) => {
        placeTank(player, c, r);
        player.dir = d;
        player.shield = 0;
    }, [col, row, dir]);

const clearRow = (page, row, from, to) =>
    page.evaluate(([r, a, b]) => {
        for (let c = a; c <= b; c++) setTile(c, r, T_EMPTY);
    }, [row, from, to]);

test.describe('Tank Battle', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await freeze(page);
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

        test('canvas is 560x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('nothing moves while idle', async ({ page }) => {
            await advance(page, 60);
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('overlay is hidden while playing', async ({ page }) => {
            await startQuiet(page);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the base sits at the bottom centre', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => tileAt(BASE_COL, BASE_ROW))).toBe(
                await page.evaluate(() => T_BASE)
            );
            expect(await page.evaluate(() => baseAlive)).toBe(true);
        });

        test('the base is walled in by two layers of brick', async ({ page }) => {
            await startQuiet(page);
            const wall = await page.evaluate(() => ({
                tiles: FORTRESS.map(([c, r]) => tileAt(c, r)),
                brick: T_BRICK,
            }));
            expect(wall.tiles).toHaveLength(6);
            expect(wall.tiles.every((t) => t === wall.brick)).toBe(true);
        });

        test('the base row is armoured with steel', async ({ page }) => {
            await startQuiet(page);
            const flank = await page.evaluate(() => ({
                tiles: FORTRESS_FLANK.map(([c, r]) => tileAt(c, r)),
                steel: T_STEEL,
            }));
            expect(flank.tiles.every((t) => t === flank.steel)).toBe(true);
        });

        test('a shot along the bottom lane cannot reach the base', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeTank(player, 6, 19);
                player.dir = 'right';
                player.power = 2;
                fireBullet(player);
            });
            await advance(page, 120);
            expect(await page.evaluate(() => baseAlive)).toBe(true);
            expect(await page.evaluate(() => tileAt(8, 19))).toBe(await page.evaluate(() => T_STEEL));
        });

        test('the player starts alive on its spawn tile', async ({ page }) => {
            await startQuiet(page);
            const p = await page.evaluate(() => ({ x: player.x, y: player.y, alive: player.alive }));
            expect(p.alive).toBe(true);
            expect(p.x).toBe(6 * TILE);
            expect(p.y).toBe(19 * TILE);
        });

        test('the player spawns shielded', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => player.shield)).toBeGreaterThan(0);
        });

        test('every lane cell is clear so the maze is always connected', async ({ page }) => {
            await startQuiet(page);
            const blocked = await page.evaluate(() => {
                const bad = [];
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) {
                        if (!isLane(c, r)) continue;
                        // the fortress deliberately sits across the bottom lanes
                        if (c >= 8 && c <= 10 && r >= 17) continue;
                        if (tileAt(c, r) !== T_EMPTY) bad.push([c, r, tileAt(c, r)]);
                    }
                }
                return bad;
            });
            expect(blocked).toEqual([]);
        });

        test('a wave of enemies is queued up', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => toSpawn)).toBeGreaterThan(0);
            await expect(page.locator('#enemies')).not.toHaveText('0');
        });

        test('the same seed builds the same maze', async ({ page }) => {
            const first = await page.evaluate(() => { startGame(99); return grid.flat().join(''); });
            const second = await page.evaluate(() => { startGame(99); return grid.flat().join(''); });
            expect(first).toBe(second);
        });

        test('different seeds build different mazes', async ({ page }) => {
            const first = await page.evaluate(() => { startGame(1); return grid.flat().join(''); });
            const second = await page.evaluate(() => { startGame(2); return grid.flat().join(''); });
            expect(first).not.toBe(second);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the overlay explains the pause', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('a paused world does not move', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 16);
            await clearRow(page, 16, 4, 12);
            await page.keyboard.press('p');
            await hold(page, 'ArrowRight');
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(6 * TILE);
            await release(page, 'ArrowRight');
        });
    });

    // -----------------------------------------------------------------------
    // Driving
    // -----------------------------------------------------------------------
    test.describe('driving', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 16);
            await clearRow(page, 16, 0, 19);
        });

        test('holding right faces and moves the tank right', async ({ page }) => {
            await hold(page, 'ArrowRight');
            await advance(page, 30);
            const p = await page.evaluate(() => ({ x: player.x, dir: player.dir }));
            expect(p.dir).toBe('right');
            expect(p.x).toBeGreaterThan(6 * TILE);
            await release(page, 'ArrowRight');
        });

        test('holding left moves the tank left', async ({ page }) => {
            await hold(page, 'ArrowLeft');
            await advance(page, 30);
            expect(await page.evaluate(() => player.x)).toBeLessThan(6 * TILE);
            await release(page, 'ArrowLeft');
        });

        test('WASD drives too', async ({ page }) => {
            await hold(page, 'd');
            await advance(page, 30);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(6 * TILE);
            await release(page, 'd');
        });

        test('releasing the key stops the tank', async ({ page }) => {
            await hold(page, 'ArrowRight');
            await advance(page, 20);
            await release(page, 'ArrowRight');
            const before = await page.evaluate(() => player.x);
            await advance(page, 30);
            expect(await page.evaluate(() => player.x)).toBe(before);
        });

        test('brick stops the tank flush against it', async ({ page }) => {
            await page.evaluate(() => setTile(8, 16, T_BRICK));
            await hold(page, 'ArrowRight');
            await advance(page, 180);
            expect(await page.evaluate(() => player.x)).toBe(7 * TILE);
            await release(page, 'ArrowRight');
        });

        test('steel stops the tank', async ({ page }) => {
            await page.evaluate(() => setTile(8, 16, T_STEEL));
            await hold(page, 'ArrowRight');
            await advance(page, 180);
            expect(await page.evaluate(() => player.x)).toBe(7 * TILE);
            await release(page, 'ArrowRight');
        });

        test('water stops the tank', async ({ page }) => {
            await page.evaluate(() => setTile(8, 16, T_WATER));
            await hold(page, 'ArrowRight');
            await advance(page, 180);
            expect(await page.evaluate(() => player.x)).toBe(7 * TILE);
            await release(page, 'ArrowRight');
        });

        test('forest can be driven through', async ({ page }) => {
            await page.evaluate(() => setTile(8, 16, T_FOREST));
            await hold(page, 'ArrowRight');
            await advance(page, 180);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(8 * TILE);
            await release(page, 'ArrowRight');
        });

        test('the tank cannot leave the board', async ({ page }) => {
            await hold(page, 'ArrowLeft');
            await advance(page, 300);
            expect(await page.evaluate(() => player.x)).toBe(0);
            await release(page, 'ArrowLeft');
        });

        test('turning snaps the tank onto the grid', async ({ page }) => {
            await hold(page, 'ArrowRight');
            await advance(page, 7);
            expect(await page.evaluate(() => player.x % TILE)).not.toBe(0);
            await release(page, 'ArrowRight');
            await hold(page, 'ArrowUp');
            await advance(page, 1);
            const p = await page.evaluate(() => ({ x: player.x, dir: player.dir }));
            expect(p.dir).toBe('up');
            expect(p.x % TILE).toBe(0);
            await release(page, 'ArrowUp');
        });

        test('an enemy tank blocks the player', async ({ page }) => {
            await page.evaluate(() => {
                const e = spawnEnemy('basic', 8, 16);
                e.speed = 0;
                e.fireTimer = 999;
            });
            await hold(page, 'ArrowRight');
            await advance(page, 180);
            expect(await page.evaluate(() => player.x)).toBe(7 * TILE);
            await release(page, 'ArrowRight');
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 16);
            await clearRow(page, 16, 0, 19);
        });

        test('Space fires a bullet', async ({ page }) => {
            await page.keyboard.press(' ');
            const b = await page.evaluate(() => bullets.map((x) => x.side));
            expect(b).toEqual(['player']);
        });

        test('only one bullet is in flight at a time', async ({ page }) => {
            await page.keyboard.press(' ');
            await advance(page, 2);
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('firepower 2 allows two bullets', async ({ page }) => {
            await page.evaluate(() => { player.power = 2; });
            await page.keyboard.press(' ');
            await advance(page, 2);
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => bullets.length)).toBe(2);
        });

        test('a bullet leaves the muzzle in the tank facing', async ({ page }) => {
            const b = await page.evaluate(() => fireBullet(player));
            expect(b.dir).toBe('right');
            expect(b.x).toBeGreaterThan(6 * TILE);
        });

        test('a bullet destroys brick', async ({ page }) => {
            await page.evaluate(() => { setTile(8, 16, T_BRICK); fireBullet(player); });
            await advance(page, 60);
            expect(await page.evaluate(() => tileAt(8, 16))).toBe(await page.evaluate(() => T_EMPTY));
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a plain bullet cannot break steel', async ({ page }) => {
            await page.evaluate(() => { setTile(8, 16, T_STEEL); fireBullet(player); });
            await advance(page, 60);
            expect(await page.evaluate(() => tileAt(8, 16))).toBe(await page.evaluate(() => T_STEEL));
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a fully upgraded bullet breaks steel', async ({ page }) => {
            await page.evaluate(() => { player.power = 3; setTile(8, 16, T_STEEL); fireBullet(player); });
            await advance(page, 60);
            expect(await page.evaluate(() => tileAt(8, 16))).toBe(await page.evaluate(() => T_EMPTY));
        });

        test('bullets fly over water', async ({ page }) => {
            await page.evaluate(() => { setTile(8, 16, T_WATER); fireBullet(player); });
            await advance(page, 30);
            const shot = await page.evaluate(() => bullets.map((b) => b.x));
            expect(shot).toHaveLength(1);
            expect(shot[0]).toBeGreaterThan(9 * TILE);
            expect(await page.evaluate(() => tileAt(8, 16))).toBe(await page.evaluate(() => T_WATER));
        });

        test('bullets fly through forest', async ({ page }) => {
            await page.evaluate(() => { setTile(8, 16, T_FOREST); fireBullet(player); });
            await advance(page, 30);
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('a bullet leaving the board disappears', async ({ page }) => {
            await page.evaluate(() => { for (let c = 7; c < COLS; c++) setTile(c, 16, T_EMPTY); fireBullet(player); });
            await advance(page, 240);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('opposing bullets cancel each other', async ({ page }) => {
            await page.evaluate(() => {
                const e = spawnEnemy('basic', 12, 16);
                e.dir = 'left';
                e.speed = 0;
                fireBullet(player);
                fireBullet(e);
                e.fireTimer = 999;  // one shot each, so only the cancel is measured
            });
            await advance(page, 60);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
        });

        test('a bullet never tunnels through a wall, even on a huge dt', async ({ page }) => {
            await page.evaluate(() => { setTile(8, 16, T_BRICK); setTile(12, 16, T_BRICK); fireBullet(player); });
            await advance(page, 1, 1.0);
            expect(await page.evaluate(() => tileAt(8, 16))).toBe(await page.evaluate(() => T_EMPTY));
            expect(await page.evaluate(() => tileAt(12, 16))).toBe(await page.evaluate(() => T_BRICK));
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 16);
            await clearRow(page, 16, 0, 19);
        });

        test('an enemy can be spawned on a tile', async ({ page }) => {
            const e = await page.evaluate(() => {
                const t = spawnEnemy('fast', 8, 16);
                return { x: t.x, y: t.y, side: t.side, type: t.type };
            });
            expect(e).toEqual({ x: 8 * TILE, y: 16 * TILE, side: 'enemy', type: 'fast' });
        });

        test('shooting an enemy destroys it and scores', async ({ page }) => {
            await page.evaluate(() => {
                const e = spawnEnemy('basic', 9, 16);
                e.speed = 0;
                e.fireTimer = 999;
                fireBullet(player);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(100);
            await expect(page.locator('#score')).toHaveText('100');
        });

        test('tougher enemies are worth more', async ({ page }) => {
            await page.evaluate(() => {
                const e = spawnEnemy('power', 9, 16);
                e.speed = 0;
                e.fireTimer = 999;
                fireBullet(player);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => score)).toBe(300);
        });

        test('an armour tank takes four hits', async ({ page }) => {
            await page.evaluate(() => { spawnEnemy('armor', 9, 16); enemies[0].speed = 0; enemies[0].fireTimer = 999; });
            for (let i = 0; i < 3; i++) {
                await page.evaluate(() => fireBullet(player));
                await advance(page, 60);
            }
            expect(await page.evaluate(() => enemies.length)).toBe(1);
            expect(await page.evaluate(() => enemies[0].hp)).toBe(1);
            await page.evaluate(() => fireBullet(player));
            await advance(page, 60);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(400);
        });

        test('enemy bullets pass through other enemies', async ({ page }) => {
            await page.evaluate(() => {
                const a = spawnEnemy('basic', 8, 16);
                const b = spawnEnemy('basic', 10, 16);
                a.speed = 0; b.speed = 0; b.fireTimer = 999;
                a.dir = 'right';
                fireBullet(a);
            });
            await advance(page, 20);
            expect(await page.evaluate(() => enemies.length)).toBe(2);
        });

        test('an enemy bullet costs the player a life', async ({ page }) => {
            await page.evaluate(() => {
                const e = spawnEnemy('basic', 6, 14);
                e.speed = 0;
                e.dir = 'down';
                setTile(6, 15, T_EMPTY);
                fireBullet(e);
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('a shielded player shrugs off a hit', async ({ page }) => {
            await page.evaluate(() => {
                player.shield = 5;
                const e = spawnEnemy('basic', 6, 14);
                e.speed = 0;
                e.dir = 'down';
                setTile(6, 15, T_EMPTY);
                fireBullet(e);
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => player.alive)).toBe(true);
        });

        test('the player respawns shielded after dying', async ({ page }) => {
            await page.evaluate(() => {
                player.power = 3;
                const e = spawnEnemy('basic', 6, 14);
                e.speed = 0;
                e.dir = 'down';
                e.fireTimer = 999;
                setTile(6, 15, T_EMPTY);
                fireBullet(e);
            });
            await advance(page, 30);
            expect(await page.evaluate(() => player.alive)).toBe(false);
            await advance(page, 180);
            const p = await page.evaluate(() => ({
                alive: player.alive, x: player.x, y: player.y, shield: player.shield, power: player.power,
            }));
            expect(p.alive).toBe(true);
            expect(p.x).toBe(6 * TILE);
            expect(p.y).toBe(19 * TILE);
            expect(p.shield).toBeGreaterThan(0);
            expect(p.power).toBe(1);
        });

        test('enemies drive around instead of sitting still', async ({ page }) => {
            await page.evaluate(() => { spawnEnemy('basic', 0, 0); });
            const before = await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }));
            await advance(page, 120);
            const after = await page.evaluate(() => ({ x: enemies[0].x, y: enemies[0].y }));
            expect(after.x !== before.x || after.y !== before.y).toBe(true);
        });

        test('enemies stay on the board', async ({ page }) => {
            await page.evaluate(() => { spawnEnemy('fast', 0, 0); spawnEnemy('fast', 19, 0); });
            await advance(page, 600);
            const out = await page.evaluate(() =>
                enemies.filter((e) => e.x < 0 || e.y < 0 || e.x > (COLS - 1) * TILE || e.y > (ROWS - 1) * TILE).length
            );
            expect(out).toBe(0);
        });

        test('enemies never end up inside a wall', async ({ page }) => {
            await page.evaluate(() => { spawnEnemy('fast', 0, 0); spawnEnemy('basic', 9, 0); });
            await advance(page, 600);
            const stuck = await page.evaluate(() => enemies.filter((e) => !rectFree(e.x, e.y, e)).length);
            expect(stuck).toBe(0);
        });

        test('the spawner feeds enemies in when enabled', async ({ page }) => {
            await page.evaluate(() => { spawnEnabled = true; });
            await advance(page, 240);
            expect(await page.evaluate(() => enemies.length)).toBeGreaterThan(0);
        });

        test('no more than four enemies are alive at once', async ({ page }) => {
            await page.evaluate(() => { spawnEnabled = true; player.shield = 9999; });
            await advance(page, 1800);
            expect(await page.evaluate(() => enemies.length)).toBeLessThanOrEqual(4);
        });

        test('the HUD counts enemies still to beat', async ({ page }) => {
            await page.evaluate(() => { toSpawn = 3; spawnEnemy('basic', 9, 16); });
            await advance(page, 1);
            expect(await page.evaluate(() => enemiesRemaining())).toBe(3);
            await expect(page.locator('#enemies')).toHaveText('3');
        });
    });

    // -----------------------------------------------------------------------
    // The base
    // -----------------------------------------------------------------------
    test.describe('the base', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a hit on the base ends the game immediately', async ({ page }) => {
            await page.evaluate(() => {
                setTile(9, 18, T_EMPTY);
                const e = spawnEnemy('basic', 9, 17);
                e.speed = 0;
                e.dir = 'down';
                fireBullet(e);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => baseAlive)).toBe(false);
            expect(await page.evaluate(() => state)).toBe('gameover');
            await expect(page.locator('#overlay-title')).toContainText(/base/i);
        });

        test('the fortress soaks up the first shot', async ({ page }) => {
            await page.evaluate(() => {
                const e = spawnEnemy('basic', 9, 17);
                e.speed = 0;
                e.dir = 'down';
                fireBullet(e);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => tileAt(9, 18))).toBe(await page.evaluate(() => T_EMPTY));
            expect(await page.evaluate(() => baseAlive)).toBe(true);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the player can shoot its own base', async ({ page }) => {
            await page.evaluate(() => {
                setTile(9, 18, T_EMPTY);
                placeTank(player, 9, 17);
                player.dir = 'down';
                fireBullet(player);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => state)).toBe('gameover');
        });
    });

    // -----------------------------------------------------------------------
    // Power-ups
    // -----------------------------------------------------------------------
    test.describe('power-ups', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 16);
            await clearRow(page, 16, 0, 19);
        });

        const collect = (page, type) =>
            page.evaluate((t) => { spawnPowerup(t, 6, 16); }, type);

        test('a star raises firepower', async ({ page }) => {
            await collect(page, 'star');
            await advance(page, 2);
            expect(await page.evaluate(() => player.power)).toBe(2);
            expect(await page.evaluate(() => powerups.length)).toBe(0);
        });

        test('firepower caps at three', async ({ page }) => {
            await page.evaluate(() => { player.power = 3; spawnPowerup('star', 6, 16); });
            await advance(page, 2);
            expect(await page.evaluate(() => player.power)).toBe(3);
        });

        test('a shield makes the player invulnerable for a while', async ({ page }) => {
            await page.evaluate(() => { player.shield = 0; spawnPowerup('shield', 6, 16); });
            await advance(page, 2);
            expect(await page.evaluate(() => player.shield)).toBeGreaterThan(5);
        });

        test('an extra life is an extra life', async ({ page }) => {
            await collect(page, 'life');
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(4);
            await expect(page.locator('#lives')).toHaveText('4');
        });

        test('a bomb clears every enemy on screen', async ({ page }) => {
            await page.evaluate(() => {
                spawnEnemy('basic', 0, 0);
                spawnEnemy('basic', 19, 0);
                spawnPowerup('bomb', 6, 16);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThan(500);
        });

        test('a shovel armours the fortress, then it wears off', async ({ page }) => {
            await collect(page, 'shovel');
            await advance(page, 2);
            expect(await page.evaluate(() => tileAt(8, 18))).toBe(await page.evaluate(() => T_STEEL));
            await advance(page, 40, 0.5);
            expect(await page.evaluate(() => tileAt(8, 18))).toBe(await page.evaluate(() => T_BRICK));
        });

        test('collecting scores 500', async ({ page }) => {
            await collect(page, 'star');
            await advance(page, 2);
            expect(await page.evaluate(() => score)).toBe(500);
        });

        test('an uncollected power-up expires', async ({ page }) => {
            await page.evaluate(() => { spawnPowerup('star', 12, 8); });
            await advance(page, 40, 0.5);
            expect(await page.evaluate(() => powerups.length)).toBe(0);
        });

        test('a bonus enemy drops a power-up when destroyed', async ({ page }) => {
            await page.evaluate(() => {
                const e = spawnEnemy('basic', 9, 16);
                e.speed = 0;
                e.fireTimer = 999;
                e.bonus = true;
                fireBullet(player);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => powerups.length)).toBe(1);
        });

        test('an ordinary enemy drops nothing', async ({ page }) => {
            await page.evaluate(() => {
                const e = spawnEnemy('basic', 9, 16);
                e.speed = 0;
                e.fireTimer = 999;
                e.bonus = false;
                fireBullet(player);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => powerups.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Level flow
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 16);
            await clearRow(page, 16, 0, 19);
        });

        test('clearing the wave announces the level', async ({ page }) => {
            await page.evaluate(() => {
                toSpawn = 1;
                const e = spawnEnemy('basic', 9, 16);
                e.speed = 0;
                e.fireTimer = 999;
                fireBullet(player);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => state)).toBe('levelclear');
            await expect(page.locator('#overlay-title')).toContainText(/level/i);
        });

        test('the next level starts on its own', async ({ page }) => {
            await page.evaluate(() => {
                toSpawn = 1;
                const e = spawnEnemy('basic', 9, 16);
                e.speed = 0;
                e.fireTimer = 999;
                fireBullet(player);
            });
            await advance(page, 60);
            await advance(page, 240);
            expect(await page.evaluate(() => state)).toBe('playing');
            expect(await page.evaluate(() => level)).toBe(2);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('a cleared level pays a bonus and keeps the score', async ({ page }) => {
            await page.evaluate(() => {
                score = 1000;
                toSpawn = 1;
                const e = spawnEnemy('basic', 9, 16);
                e.speed = 0;
                e.fireTimer = 999;
                fireBullet(player);
            });
            await advance(page, 300);
            expect(await page.evaluate(() => score)).toBeGreaterThan(1100);
        });

        test('later levels field more enemies', async ({ page }) => {
            const first = await page.evaluate(() => { startGame(5); return toSpawn; });
            const fifth = await page.evaluate(() => { startGame(5); level = 5; newLevel(); return toSpawn; });
            expect(fifth).toBeGreaterThan(first);
        });

        test('a new level rebuilds the maze and re-arms the base', async ({ page }) => {
            const before = await page.evaluate(() => grid.flat().join(''));
            const after = await page.evaluate(() => { level = 2; newLevel(); return grid.flat().join(''); });
            expect(after).not.toBe(before);
            expect(await page.evaluate(() => baseAlive)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 16);
            await clearRow(page, 16, 0, 19);
        });

        const killPlayerOnce = (page) =>
            page.evaluate(() => {
                const e = spawnEnemy('basic', 6, 14);
                e.speed = 0;
                e.dir = 'down';
                e.fireTimer = 999;
                setTile(6, 15, T_EMPTY);
                fireBullet(e);
            });

        test('the last life ends the game', async ({ page }) => {
            await page.evaluate(() => { lives = 1; });
            await killPlayerOnce(page);
            await advance(page, 60);
            expect(await page.evaluate(() => state)).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('the final score is shown', async ({ page }) => {
            await page.evaluate(() => { lives = 1; score = 700; });
            await killPlayerOnce(page);
            await advance(page, 60);
            await expect(page.locator('#overlay-score')).toContainText('700');
        });

        test('the best score is remembered', async ({ page }) => {
            await page.evaluate(() => { lives = 1; score = 4200; });
            await killPlayerOnce(page);
            await advance(page, 60);
            expect(await page.evaluate(() => localStorage.getItem('tankbattle-best'))).toBe('4200');
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('Space starts a fresh game', async ({ page }) => {
            await page.evaluate(() => { lives = 1; score = 700; });
            await killPlayerOnce(page);
            await advance(page, 60);
            await page.keyboard.press(' ');
            const s = await page.evaluate(() => ({ state, score, lives, level }));
            expect(s).toEqual({ state: 'playing', score: 0, lives: 3, level: 1 });
        });

        test('the world is frozen after game over', async ({ page }) => {
            await page.evaluate(() => { lives = 1; });
            await killPlayerOnce(page);
            await advance(page, 60);
            await page.evaluate(() => { spawnEnemy('fast', 0, 0); });
            const before = await page.evaluate(() => enemies[0].x);
            await advance(page, 120);
            expect(await page.evaluate(() => enemies[0].x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // The real animation loop
    // -----------------------------------------------------------------------
    test.describe('live play', () => {
        test('the game runs by itself once started', async ({ page }) => {
            await page.evaluate(() => {
                autoLoop = true;
                startGame(1234);
                placeTank(player, 6, 16);
                player.shield = 999;
                for (let c = 0; c < COLS; c++) setTile(c, 16, T_EMPTY);
            });
            await hold(page, 'ArrowRight');
            await page.waitForFunction(() => player.x > 7 * 28);
            await release(page, 'ArrowRight');
        });

        test('the canvas is actually painted', async ({ page }) => {
            await page.evaluate(() => { autoLoop = true; startGame(1234); });
            await page.waitForTimeout(120);
            const blank = await page.evaluate(() => {
                const ctx = document.getElementById('canvas').getContext('2d');
                const d = ctx.getImageData(0, 0, 560, 560).data;
                for (let i = 0; i < d.length; i += 4) if (d[i] || d[i + 1] || d[i + 2]) return false;
                return true;
            });
            expect(blank).toBe(false);
        });
    });
});
